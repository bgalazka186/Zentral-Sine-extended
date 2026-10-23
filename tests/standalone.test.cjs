"use strict";
/* Simulated-window tests for every standalone package (every additional/ standalone.json).
 * They prove the shim's coexistence/cleanup logic and that each bundle starts and
 * releases everything in a minimal fake browser. They do NOT prove Sine
 * installation or real Gecko behaviour: see docs/SINE-MODULAR-INSTALL.md gates. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  cp = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  runtimeSource = fs.readFileSync(path.join(root, "loader/ZentralRuntime.js"), "utf8");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)],
  );
}
const manifests = walk(path.join(root, "additional"))
  .filter((f) => f.endsWith("standalone.json"))
  .map((f) => ({ dir: path.dirname(f), m: JSON.parse(fs.readFileSync(f, "utf8")) }));

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// A permissive stand-in for DOM/Gecko objects: any property is a function or object.
function ghost(name = "ghost") {
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === "then") return undefined;
      if (prop === "length") return 0;
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "getBoundingClientRect") return () => ({ left: 0, right: 300, top: 0, bottom: 900, width: 300, height: 900 });
      if (prop === "classList") return { add() {}, remove() {}, contains: () => false, toggle() {} };
      if (prop === "style") return { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" };
      if (prop === "ownerDocument" || prop === "documentElement") return undefined;
      return ghost(name + "." + String(prop));
    },
    apply: () => ghost(name + "()"),
    construct: () => ghost(name + "new"),
    set: () => true,
  });
}

function makeEnv({ fullRuntime = null, prefs = {} } = {}) {
  const counts = { listeners: 0, prefObservers: 0, obsObservers: 0, timers: new Set() };
  const unloadFns = [];
  const attrs = new Map();
  const warnings = [];
  const listeners = [];
  const prefObservers = [],
    obsObservers = [];
  const Services = {
    prefs: {
      getPrefType: (k) =>
        k in prefs
          ? typeof prefs[k] === "boolean" ? 128 : typeof prefs[k] === "number" ? 64 : 32
          : 0,
      getBoolPref: (k, d) => (k in prefs ? prefs[k] : d),
      getIntPref: (k, d) => (k in prefs ? prefs[k] : d),
      getStringPref: (k, d) => (k in prefs ? prefs[k] : d),
      getCharPref: (k, d) => (k in prefs ? prefs[k] : d),
      addObserver: (k, o) => prefObservers.push([k, o]),
      removeObserver: (k, o) => {
        const i = prefObservers.findIndex((x) => x[0] === k && x[1] === o);
        if (i >= 0) prefObservers.splice(i, 1);
      },
    },
    obs: {
      addObserver: (o, t) => obsObservers.push([o, t]),
      removeObserver: (o, t) => {
        const i = obsObservers.findIndex((x) => x[0] === o && x[1] === t);
        if (i >= 0) obsObservers.splice(i, 1);
      },
    },
    io: new Proxy({ newURI: (spec, _c, base) => { let href = String(spec); try { href = new URL(String(spec), base?.spec).href; } catch (_) {} return { spec: href, scheme: href.split(":")[0] }; } }, { get: (t, p) => (p in t ? t[p] : ghost("io." + String(p))) }),
  };
  const docRoot = {
    hasAttribute: (k) => attrs.has(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    toggleAttribute: (k, on) => (on ? attrs.set(k, "") : attrs.delete(k)),
    style: {
      props: new Map(),
      setProperty(k, v) { this.props.set(k, v); },
      removeProperty(k) { this.props.delete(k); },
      getPropertyValue(k) { return this.props.has(k) ? this.props.get(k) : ""; },
    },
    children: [],
    appendChild(node) { this.children.push(node); },
    append() {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, right: 0, width: 0, height: 0 }),
  };
  const window = {
    innerWidth: 1600,
    innerHeight: 900,
    ZentralRuntime: fullRuntime,
    gBrowser: ghost("gBrowser"),
    windowUtils: ghost("windowUtils"),
    addEventListener(type, fn, opts) {
      listeners.push([type, fn]);
    },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((x) => x[0] === type && x[1] === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent() {},
    setTimeout: (f, ms) => {
      const t = setTimeout(() => {
        counts.timers.delete(t);
        f();
      }, Math.min(ms || 0, 5));
      counts.timers.add(t);
      return t;
    },
    clearTimeout: (t) => {
      clearTimeout(t);
      counts.timers.delete(t);
    },
    requestAnimationFrame: (f) => window.setTimeout(f, 0),
    cancelAnimationFrame: (t) => window.clearTimeout(t),
    getComputedStyle: () => ({ display: "block", visibility: "visible", getPropertyValue: () => "" }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    SessionStore: { promiseAllWindowsRestored: Promise.resolve() },
    gZenWorkspaces: { promiseInitialized: Promise.resolve() },
    gZenStartup: { promiseInitialized: Promise.resolve() },
    gZenCompactModeManager: ghost("compact"),
    gBrowserInit: { delayedStartupFinished: true },
    CSS: {
      supports: (prop, value) =>
        prop === "color" && /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|color-mix)\(.*\)|red|blue|black|white)$/i.test(String(value).trim()),
    },
  };
  const document = {
    documentElement: docRoot,
    readyState: "complete",
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) =>
      tag === "style"
        ? { tag, id: "", textContent: "", remove() { const i = docRoot.children.indexOf(this); if (i >= 0) docRoot.children.splice(i, 1); } }
        : ghost("el"),
    createElementNS: () => ghost("el"),
    addEventListener() {},
    removeEventListener() {},
    body: ghost("body"),
  };
  const ctx = vm.createContext({
    window,
    document,
    Services,
    console: { warn: (...a) => warnings.push(a), error: (...a) => warnings.push(a), log() {}, debug() {}, info() {} },
    ChromeUtils: new Proxy({ importESModule: () => ({ Services }) }, { get: (t, p) => (p in t ? t[p] : ghost("ChromeUtils." + String(p))) }),
    Components: new Proxy({ stack: { filename: "chrome://sine/content/zentral-video-preview/ZentralVideoPreview.standalone.uc.js" } }, { get: (t, p) => (p in t ? t[p] : ghost("Components." + String(p))) }),
    Ci: ghost("Ci"),
    Cc: ghost("Cc"),
    Cu: ghost("Cu"),
    setInterval: (f, ms) => window.setTimeout(f, ms),
    clearInterval: (t) => window.clearTimeout(t),
    UC_API: undefined,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    Promise,
    URL,
    CustomEvent: class {},
    Event: class {},
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    DOMParser: class {},
    XMLSerializer: class {},
    Node: { ELEMENT_NODE: 1 },
    Element: class {},
    HTMLElement: class {},
    performance: { now: () => 0 },
    structuredClone: (v) => v,
  });
  ctx.globalThis = ctx;
  ctx.Services = Services;
  // In a real browser window these are globals as well as window properties, and
  // sources use both spellings.
  for (const name of ["gBrowser", "gBrowserInit", "gZenWorkspaces", "gZenStartup", "gZenCompactModeManager", "SessionStore", "windowUtils", "CSS"])
    ctx[name] = window[name];
  const net = () => ({
    // One-shot "unload" listeners die with the window; they are not leaks.
    listeners: listeners.filter((l) => l[0] !== "unload").length,
    leaked: listeners.filter((l) => l[0] !== "unload").map((l) => l[0]),
    pref: prefObservers.length,
    obs: obsObservers.length,
    timers: counts.timers.size,
  });
  const firePref = (key) => {
    for (const [k, o] of [...prefObservers]) if (key === k || key.startsWith(k + ".") && false) o.observe(null, "nsPref:changed", key);
  };
  return { window, ctx, listeners, warnings, net, prefObservers, obsObservers, prefs, docRoot, firePref };
}
const bundleOf = ({ dir, m }) => fs.readFileSync(path.join(dir, m.output), "utf8");
const run = (env, src) => vm.runInContext(src, env.ctx);
const baseline = (env) => {
  const n = env.net();
  return n;
};

(async () => {
  for (const mod of manifests) {
    const { dir, m } = mod;
    const src = bundleOf(mod);
    const label = m.id;

    await test(`${label}: bundle is generated, versioned and placeholder-free`, () => {
      assert.ok(!src.includes("__FEATURE_VERSION__") && !src.includes("__SIDEBAR_FUNCTIONS__") && !src.includes("__SCOPE_FUNCTIONS__"));
      const theme = JSON.parse(fs.readFileSync(path.join(dir, "theme.json"), "utf8"));
      assert.equal(theme.version, m.version);
      assert.ok(src.includes(`__ZENTRAL_STANDALONE_VERSION__ = "${m.version}"`));
      assert.deepEqual(Object.keys(theme.scripts), [m.output]);
      assert.ok(fs.existsSync(path.join(dir, m.output)));
      if (m.css) {
        assert.equal(theme.style.chrome, m.css);
        assert.ok(fs.existsSync(path.join(dir, m.css)));
      }
      const prefs = JSON.parse(fs.readFileSync(path.join(dir, "preferences.json"), "utf8"));
      const schema = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).schema;
      const borrowed = (m.borrowedSettings || []).flatMap((b) => {
        const source = JSON.parse(fs.readFileSync(path.join(root, b.from), "utf8")).schema;
        return b.properties.map((property) => {
          const entry = source.find((e) => e.property === property);
          assert.ok(entry, `${property} missing in ${b.from}`);
          return entry;
        });
      });
      // Every pref the module owns or borrows ships (minus the explicit, reasoned
      // exclusions), each identical to its source entry.
      const excluded = new Set(m.excludePrefs?.properties || []);
      const expected = [...schema, ...borrowed].filter((p) => !excluded.has(p.property));
      const shipped = prefs.filter((p) => p.property);
      assert.deepEqual(shipped.map((p) => p.property).sort(), expected.map((p) => p.property).sort());
      for (const entry of expected)
        assert.deepEqual(shipped.find((p) => p.property === entry.property), entry);
      if (excluded.size) assert.ok(m.excludePrefs.reason.length > 20, "exclusions carry a reason");
    });

    await test(`${label}: starts, then every listener/observer/timer is released on dispose`, async () => {
      const env = makeEnv();
      const before = baseline(env);
      run(env, src);
      const handle = env.window.__zentralStandalone?.[m.id];
      assert.ok(handle, "published a standalone handle");
      await tick();
      const failures = env.warnings.filter((w) => /init failed/.test(String(w[0])));
      assert.deepEqual(failures, [], "init must not fail in the fake browser: " + String(failures[0]?.[2] || ""));
      handle.dispose();
      await tick();
      const after = env.net();
      assert.equal(after.pref, before.pref, "pref observers released");
      assert.equal(after.obs, before.obs, "obs observers released");
      assert.equal(after.timers, 0, "no pending timers");
      assert.equal(env.window.__zentralStandalone[m.id], undefined);
      assert.ok(after.listeners <= before.listeners, `listeners leaked: ${after.leaked.join(",")}`);
    });

    await test(`${label}: full pack present first -> does nothing`, async () => {
      const env = makeEnv({ fullRuntime: { register() { throw new Error("must not register"); } } });
      run(env, src);
      await tick();
      assert.equal(env.window.__zentralStandalone, undefined);
      assert.equal(env.net().pref + env.net().obs, 0);
    });

    await test(`${label}: full pack appears while waiting -> never starts`, async () => {
      const env = makeEnv();
      run(env, src);
      env.window.ZentralRuntime = { register() {} };
      await tick();
      assert.equal(env.net().pref + env.net().obs, 0);
      assert.equal(env.window.__zentralStandalone[m.id], undefined);
    });

    await test(`${label}: window unload disposes it; live re-run does not double hook`, async () => {
      const env = makeEnv();
      run(env, src);
      await tick();
      const once = env.net();
      run(env, src);
      await tick();
      const twice = env.net();
      assert.equal(twice.pref, once.pref, "re-run must replace, not stack");
      assert.equal(twice.obs, once.obs);
      for (const [type, fn] of [...env.listeners]) if (type === "unload") fn();
      await tick();
      assert.equal(env.net().pref + env.net().obs, 0);
      assert.equal(env.window.__zentralStandalone[m.id], undefined);
    });

    await test(`${label}: dispose before init completes releases everything`, async () => {
      const env = makeEnv();
      run(env, src);
      env.window.__zentralStandalone[m.id].dispose();
      await tick();
      assert.equal(env.net().pref + env.net().obs, 0);
    });
  }


  // ---- Library background (custom color / Arc 2.0 match) -------------------
  const libMod = manifests.find((x) => x.m.id === "library-resize");
  const BG = {
    arc: "zen.workspace.zentral.arc2.match_compact_library",
    arcColor: "arc-compact-sidebar-bg",
    custom: "zen.workspace.zentral.library.custom_background",
    color: "zen.workspace.zentral.library.custom_background.color",
    opacity: "zen.workspace.zentral.library.custom_background.opacity",
  };
  const bgState = (env) => ({
    source: env.docRoot.getAttribute("zentral-library-background"),
    value: env.docRoot.style.getPropertyValue("--zentral-library-background"),
    styles: env.docRoot.children.filter((n) => n.id === "zentral-library-background-style").length,
  });
  const startBg = async (prefs, how = "standalone") => {
    const env = makeEnv({ prefs });
    if (how === "standalone") run(env, bundleOf(libMod));
    else {
      // Full pack path: the unmodified source registers with the real runtime.
      let def;
      env.window.ZentralRuntime = { register: (d) => (def = d) };
      run(env, fs.readFileSync(path.join(libMod.dir, libMod.m.entry), "utf8"));
      env.fullDispose = def.init({ lifecycle: {} });
    }
    await tick();
    return env;
  };

  await test("library background: nothing is painted by default", async () => {
    const env = await startBg({});
    assert.deepEqual(bgState(env), { source: null, value: "", styles: 0 });
  });

  await test("library background: Arc 2.0 match copies Arc's color; absent Arc color paints nothing", async () => {
    let env = await startBg({ [BG.arc]: true, [BG.arcColor]: "rgba(20, 22, 30, 0.7)" });
    assert.deepEqual(bgState(env), { source: "arc2", value: "rgba(20, 22, 30, 0.7)", styles: 1 });
    env = await startBg({ [BG.arc]: true });
    assert.deepEqual(bgState(env), { source: null, value: "", styles: 0 }, "Arc 2.0 not installed");
  });

  await test("library background: custom color works without Arc 2.0", async () => {
    const env = await startBg({ [BG.custom]: true, [BG.color]: "#1e1e24cc" });
    assert.deepEqual(bgState(env), { source: "custom", value: "#1e1e24cc", styles: 1 });
  });

  await test("library background: a valid custom color overrides Arc; an invalid one falls back", async () => {
    const both = { [BG.arc]: true, [BG.arcColor]: "rgba(1, 2, 3, 0.5)", [BG.custom]: true };
    let env = await startBg({ ...both, [BG.color]: "#ff0000" });
    assert.equal(bgState(env).source, "custom");
    env = await startBg({ ...both, [BG.color]: "banana" });
    assert.deepEqual(bgState(env), { source: "arc2", value: "rgba(1, 2, 3, 0.5)", styles: 1 });
    env = await startBg({ [BG.custom]: true, [BG.color]: "banana" });
    assert.equal(bgState(env).source, null, "invalid custom color and no Arc: Zen untouched");
    env = await startBg({ [BG.custom]: true, [BG.color]: "   " });
    assert.equal(bgState(env).source, null);
  });

  await test("library background: opacity multiplies the custom color; 100% leaves it alone", async () => {
    let env = await startBg({ [BG.custom]: true, [BG.color]: "#1e1e24", [BG.opacity]: 80 });
    assert.equal(bgState(env).value, "color-mix(in srgb, #1e1e24 80%, transparent)");
    env = await startBg({ [BG.custom]: true, [BG.color]: "#1e1e24", [BG.opacity]: 100 });
    assert.equal(bgState(env).value, "#1e1e24");
  });

  await test("library background: follows pref changes live and clears completely", async () => {
    const env = await startBg({});
    env.prefs[BG.custom] = true;
    env.prefs[BG.color] = "#112233";
    env.firePref(BG.custom);
    assert.deepEqual(bgState(env), { source: "custom", value: "#112233", styles: 1 });
    env.prefs[BG.color] = "#445566";
    env.firePref(BG.color);
    assert.equal(bgState(env).value, "#445566");
    assert.equal(bgState(env).styles, 1, "one style element, never stacked");
    env.prefs[BG.custom] = false;
    env.firePref(BG.custom);
    assert.deepEqual(bgState(env), { source: null, value: "", styles: 0 });
    // Arc changes its color while enabled.
    env.prefs[BG.arc] = true;
    env.prefs[BG.arcColor] = "rgba(9, 9, 9, 0.5)";
    env.firePref(BG.arc);
    assert.equal(bgState(env).value, "rgba(9, 9, 9, 0.5)");
    env.prefs[BG.arcColor] = "rgba(8, 8, 8, 0.4)";
    env.firePref(BG.arcColor);
    assert.equal(bgState(env).value, "rgba(8, 8, 8, 0.4)");
  });

  await test("library background: dispose removes the attribute, variable, style and observers", async () => {
    const env = await startBg({ [BG.custom]: true, [BG.color]: "#abcdef" });
    assert.equal(bgState(env).source, "custom");
    env.window.__zentralStandalone["library-resize"].dispose();
    await tick();
    assert.deepEqual(bgState(env), { source: null, value: "", styles: 0 });
    assert.equal(env.prefObservers.length, 0);
  });

  await test("library background: identical in the full pack path (unmodified source + real runtime)", async () => {
    const env = await startBg({ [BG.custom]: true, [BG.color]: "#123456" }, "full");
    assert.deepEqual(bgState(env), { source: "custom", value: "#123456", styles: 1 });
    env.fullDispose();
    assert.deepEqual(bgState(env), { source: null, value: "", styles: 0 });
    assert.equal(env.prefObservers.length, 0);
  });

  await test("library background: layout switch off does not stop the background", async () => {
    const env = await startBg({ [BG.custom]: true, [BG.color]: "#222222", "zen.workspace.zentral.experimental.library_resize": false });
    assert.equal(bgState(env).source, "custom");
  });

  await test("full pack no longer double-paints: runtime and Appearance.css hand the Library to the module", () => {
    const appearance = fs.readFileSync(path.join(root, "extension/appearance/ZentralAppearance.css"), "utf8");
    assert.ok(!/zentral-arc2-library/.test(appearance) && !/zentral-arc2-library/.test(runtimeSource));
    assert.ok(runtimeSource.includes("arcSidebarPref"), "regular-sidebar match stays in the runtime");
    const rootPrefs = JSON.parse(fs.readFileSync(path.join(root, "preferences.json"), "utf8")).map((p) => p.property);
    for (const key of [BG.custom, BG.color, BG.opacity, BG.arc]) assert.ok(rootPrefs.includes(key), key);
  });

  await test("build: a pref read from another owner must be borrowed; an unknown pref must be declared", () => {
    const run2 = (code, extra = {}) => {
      const tmp = path.join(root, "additional/zz-test");
      fs.mkdirSync(tmp, { recursive: true });
      fs.writeFileSync(path.join(tmp, "standalone.json"), JSON.stringify({ id: "zz", themeId: "zz", name: "zz", version: "1.0.0", entry: "a.uc.js", output: "a.standalone.uc.js", ...extra }));
      fs.writeFileSync(path.join(tmp, "a.uc.js"), code);
      try {
        cp.execFileSync("node", ["tools/build-standalone.cjs"], { cwd: root, stdio: "pipe" });
        return null;
      } catch (e) {
        return String(e.stderr);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    };
    assert.match(run2('const A = "zen.workspace.zentral.compat.external_library_layout";'), /borrowedSettings/);
    assert.match(run2('const A = "zen.view.compact.nonexistent";'), /externalPrefs/);
  });

  // ---- Video (multi-file module with an embedded loader) --------------------
  const videoMod = manifests.find((x) => x.m.id === "video");
  const videoEnv = async (prefs = {}) => {
    const env = makeEnv({ prefs });
    run(env, bundleOf(videoMod));
    await tick(60);
    return env;
  };
  const videoEntry = fs.readFileSync(path.join(videoMod.dir, videoMod.m.entry), "utf8");

  await test("video: uses a private loader and never occupies the full pack's loader name", async () => {
    const env = await videoEnv();
    assert.ok(env.window.__zentralVideoLoader, "private loader published");
    assert.equal(env.window.ZentralModuleLoader, undefined, "loader/Zentral.uc.js would refuse to start if this were set");
    assert.ok(!/window\.ZentralModuleLoader[.?(]/.test(bundleOf(videoMod).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "no code path names the full loader");
    env.window.__zentralStandalone.video.dispose();
    assert.equal(env.window.__zentralVideoLoader, undefined, "loader released on dispose");
    assert.equal(env.window.ZentralVideoPreview, undefined, "public API removed");
  });

  await test("video: every embedded controller loads and every component the entry creates is defined", async () => {
    const env = await videoEnv();
    const loader = env.window.__zentralVideoLoader;
    const rows = loader.sources();
    for (const file of videoMod.m.include) {
      const row = rows.find((r) => r.file === "additional/video/" + file);
      assert.equal(row?.state, "loaded", file);
    }
    const created = [...videoEntry.matchAll(/\.create\(\s*"(video\/[A-Za-z-]+|video\/[A-Za-z]+)"/g)].map((x) => x[1]);
    const optionalAbsent = new Set(["video/ZentralVideoDiagnostics", "video/ZentralVideoSettings"]);
    for (const id of new Set(created)) {
      if (optionalAbsent.has(id)) assert.equal(loader.has(id), false, id + " must be absent (full-pack UI only)");
      else assert.equal(loader.has(id), true, id + " not defined");
    }
    assert.ok(loader.report().components.every((c) => c.state === "initialized"), "no component failed to construct");
  });

  await test("video: loader contract - optional misses return false, required misses and unsafe paths throw, text is the real file", async () => {
    const env = await videoEnv();
    const loader = env.window.__zentralVideoLoader;
    assert.equal(loader.load("additional/video/controllers/ZentralVideoSettings.js", { optional: true }), false);
    assert.throws(() => loader.load("additional/video/controllers/ZentralVideoSettings.js"), /unavailable/);
    assert.throws(() => loader.load("additional/video/../../evil.js"), /Unsafe/);
    assert.throws(() => loader.load("loader/ZentralRuntime.js"), /Unsafe/);
    assert.throws(() => loader.readText("additional/video/content/Other.js"), /unavailable/);
    for (const file of videoMod.m.texts)
      assert.equal(loader.readText("additional/video/" + file), fs.readFileSync(path.join(videoMod.dir, file), "utf8"));
    assert.throws(() => loader.require("video/ZentralVideoNope"), /did not register/);
  });

  await test("video: the window actor resolves next to the installed script, and ships as a real file", async () => {
    const env = await videoEnv();
    assert.equal(env.window.__zentralVideoLoader.rootURI, "chrome://sine/content/zentral-video-preview/");
    const bundle = bundleOf(videoMod);
    assert.ok(bundle.includes('"content/ZentralVideoActor.sys.mjs"') && !/newURI\(\s*"additional\/video\/content\/ZentralVideoActor/.test(bundle));
    for (const asset of videoMod.m.assets) assert.ok(fs.existsSync(path.join(videoMod.dir, asset)), asset + " must ship in the folder");
    // The full pack keeps its original path.
    assert.ok(fs.readFileSync(path.join(videoMod.dir, "controllers/ZentralVideoTransport.js"), "utf8").includes('"additional/video/content/ZentralVideoActor.sys.mjs"'));
    assert.ok(!videoEntry.includes("__zentralVideoLoader"), "source keeps the full pack's loader name");
  });

  await test("video: sidebar control prefs reach the stylesheet's variables, bounded, live, and are removed on dispose", async () => {
    const wrap = "zen.workspace.bgalazka.look.video_controls_wrap",
      gap = "zen.workspace.bgalazka.look.video_controls_gap",
      overlay = "zen.workspace.bgalazka.look.video_overlay_opacity";
    const vars = (env) => ({
      wrap: env.docRoot.style.getPropertyValue("--zentral-sidebar-video-wrap"),
      gap: env.docRoot.style.getPropertyValue("--zentral-sidebar-video-gap"),
      overlay: env.docRoot.style.getPropertyValue("--bgalazka-look-video-overlay-opacity"),
    });
    let env = await videoEnv();
    assert.deepEqual(vars(env), { wrap: "nowrap", gap: "1px", overlay: "40%" }, "defaults match the full pack");
    env = await videoEnv({ [wrap]: true, [gap]: 99, [overlay]: -5 });
    assert.deepEqual(vars(env), { wrap: "wrap", gap: "8px", overlay: "0%" }, "same bounds as the Appearance controller");
    env.prefs[gap] = 3;
    env.prefs[overlay] = 70;
    env.firePref(gap);
    assert.deepEqual(vars(env), { wrap: "wrap", gap: "3px", overlay: "70%" });
    env.window.__zentralStandalone.video.dispose();
    assert.deepEqual(vars(env), { wrap: "", gap: "", overlay: "" });
  });

  await test("video: a start-up failure leaves nothing behind (handle, loader, API)", async () => {
    const env = makeEnv();
    // Fail late, right after the preview has published window.ZentralVideoPreview.
    const origAdd = env.window.addEventListener.bind(env.window);
    env.window.addEventListener = (type, fn, opts) => {
      if (type === "unload") throw new Error("boom");
      return origAdd(type, fn, opts);
    };
    try {
      run(env, bundleOf(videoMod));
    } catch (_) {}
    await tick(60);
    assert.equal(env.window.__zentralStandalone?.video, undefined, "handle released");
    assert.equal(env.window.__zentralVideoLoader, undefined, "private loader destroyed");
    assert.equal(env.window.ZentralVideoPreview, undefined, "half-built API removed");
  });

  await test("sidebar helpers and lifecycle scope are verbatim runtime copies", () => {
    const names = ["nativeSidebarElement", "nativeSidebarRect", "nativeSidebarSide", "createFeatureScope"];
    const src = bundleOf(manifests[0]);
    for (const name of names) {
      const start = runtimeSource.indexOf("function " + name + "(");
      assert.ok(start > 0, name);
      const probe = runtimeSource.slice(start, start + 400).split("\n").slice(0, 6).join("\n");
      assert.ok(src.includes(probe), name + " drifted from loader/ZentralRuntime.js");
    }
  });

  await test("full runtime releases a standalone copy before activating a feature", () => {
    assert.ok(runtimeSource.includes("window.__zentralStandalone?.[m.id]?.dispose?.()"));
  });

  await test("registered ids match the full pack's catalog ids", () => {
    const catalog = fs.readFileSync(path.join(root, "loader/ZentralCatalog.js"), "utf8");
    for (const { m } of manifests) assert.ok(catalog.includes(`id: "${m.id}"`), m.id);
  });

  await test("full pack untouched: root theme.json loads only the loader", () => {
    const theme = JSON.parse(fs.readFileSync(path.join(root, "theme.json"), "utf8"));
    assert.deepEqual(Object.keys(theme.scripts), ["loader/Zentral.uc.js"]);
    assert.equal(theme.id, "zentral-sine-extended");
  });

  await test("build: up to date; refuses changed content without a version bump", () => {
    cp.execFileSync("node", ["tools/build-standalone.cjs", "--check"], { cwd: root });
    const src = path.join(manifests[0].dir, manifests[0].m.entry);
    const original = fs.readFileSync(src, "utf8");
    fs.writeFileSync(src, original + "\n// test change\n");
    try {
      assert.throws(
        () => cp.execFileSync("node", ["tools/build-standalone.cjs"], { cwd: root, stdio: "pipe" }),
        (e) => /version is still/.test(String(e.stderr)),
      );
    } finally {
      fs.writeFileSync(src, original);
    }
    cp.execFileSync("node", ["tools/build-standalone.cjs", "--check"], { cwd: root });
  });

  for (const [label, code, pattern] of [
    ["module loader", "window.ZentralModuleLoader.load('x');", /module loader/],
    ["unprovided runtime member", "window.ZentralRuntime?.snapshot();", /does not provide/],
  ]) {
    await test(`build: rejects a module that needs ${label}`, () => {
      const tmp = path.join(root, "additional/zz-test");
      fs.mkdirSync(tmp, { recursive: true });
      fs.writeFileSync(path.join(tmp, "standalone.json"), JSON.stringify({ id: "zz", themeId: "zz", name: "zz", version: "1.0.0", entry: "a.uc.js", output: "a.standalone.uc.js" }));
      fs.writeFileSync(path.join(tmp, "a.uc.js"), code);
      try {
        assert.throws(
          () => cp.execFileSync("node", ["tools/build-standalone.cjs"], { cwd: root, stdio: "pipe" }),
          (e) => pattern.test(String(e.stderr)),
        );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  console.log(`\n${passed} standalone tests passed`);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
