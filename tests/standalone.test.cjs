"use strict";
/* Simulated-window tests for the standalone Library package. They prove the
 * bundle's own logic (coexistence, cleanup, build rules). They do NOT prove Sine
 * installation or real Gecko behaviour; see docs/SINE-MODULAR-INSTALL.md gates. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  cp = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  dir = path.join(root, "additional/library");
const bundle = fs.readFileSync(
  path.join(dir, "ZentralLibraryResize.standalone.uc.js"),
  "utf8",
);
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}
const tick = () => new Promise((r) => setTimeout(r, 20));

function makeWindow({ fullRuntime = null, prefs = {} } = {}) {
  const listeners = {};
  const attrs = new Map();
  const styles = [];
  const root = {
    attrs,
    hasAttribute: (k) => attrs.has(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" },
    appendChild: (n) => styles.push(n),
    getBoundingClientRect: () => ({}),
  };
  const prefObservers = [];
  const Services = {
    prefs: {
      getPrefType: (k) => (k in prefs ? (typeof prefs[k] === "boolean" ? 128 : typeof prefs[k] === "number" ? 64 : 32) : 0),
      getBoolPref: (k, d) => (k in prefs ? prefs[k] : d),
      getIntPref: (k, d) => (k in prefs ? prefs[k] : d),
      getStringPref: (k, d) => (k in prefs ? prefs[k] : d),
      addObserver: (...a) => prefObservers.push(a),
      removeObserver: (...a) => {
        const i = prefObservers.findIndex((o) => o[0] === a[0] && o[1] === a[1]);
        if (i >= 0) prefObservers.splice(i, 1);
      },
    },
  };
  const warnings = [];
  const window = {
    innerWidth: 1600,
    innerHeight: 900,
    ZentralRuntime: fullRuntime,
    addEventListener: (t, f) => (listeners[t] ||= []).push(f),
    removeEventListener: (t, f) => (listeners[t] = (listeners[t] || []).filter((x) => x !== f)),
    setTimeout: (f, ms) => setTimeout(f, ms),
    clearTimeout: (t) => clearTimeout(t),
    requestAnimationFrame: (f) => setTimeout(f, 0),
    cancelAnimationFrame: (t) => clearTimeout(t),
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  };
  const document = {
    documentElement: root,
    getElementById: () => null,
    createElement: () => ({ remove() {}, textContent: "" }),
    querySelector: () => null,
  };
  const ctx = vm.createContext({
    window,
    document,
    Services,
    globalThis: { Services },
    console: { warn: (...a) => warnings.push(a), error: (...a) => warnings.push(a), log() {} },
    ChromeUtils: { importESModule: () => ({ Services }) },
    setTimeout,
    clearTimeout,
    Promise,
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
  });
  ctx.globalThis = ctx;
  ctx.globalThis.Services = Services;
  return { window, ctx, listeners, root, warnings, styles, prefObservers, Services };
}
const run = (env) => vm.runInContext(bundle, env.ctx);

(async () => {
  await test("bundle has no placeholders and the declared version", () => {
    assert.ok(!bundle.includes("__FEATURE_VERSION__"));
    assert.ok(!bundle.includes("__SIDEBAR_FUNCTIONS__"));
    const theme = JSON.parse(fs.readFileSync(path.join(dir, "theme.json"), "utf8"));
    assert.ok(bundle.includes(`__ZENTRAL_STANDALONE_VERSION__ = "${theme.version}"`));
    assert.deepEqual(Object.keys(theme.scripts), ["ZentralLibraryResize.standalone.uc.js"]);
  });

  await test("sidebar helpers are byte-identical copies of the runtime's", () => {
    const runtime = fs.readFileSync(path.join(root, "loader/ZentralRuntime.js"), "utf8");
    for (const name of ["nativeSidebarElement", "nativeSidebarRect", "nativeSidebarSide"]) {
      const start = runtime.indexOf("function " + name + "(");
      const body = runtime.slice(start, start + 220);
      assert.ok(bundle.includes(body.split("\n").slice(0, 3).join("\n")), name + " drifted");
    }
  });

  await test("standalone: registers once, publishes a handle, init runs after readiness", async () => {
    const env = makeWindow();
    run(env);
    assert.ok(env.window.__zentralStandalone["library-resize"]);
    assert.equal(typeof env.window.__zentralStandalone["library-resize"].dispose, "function");
    await tick();
    // Feature preference is off by default: only the preference observers remain.
    assert.ok(env.prefObservers.length >= 2);
  });

  await test("full pack present first: bundle does nothing", async () => {
    const env = makeWindow({ fullRuntime: { register() { throw new Error("must not register"); } } });
    run(env);
    await tick();
    assert.equal(env.window.__zentralStandalone, undefined);
    assert.equal(env.prefObservers.length, 0);
  });

  await test("full pack arrives after standalone: it disposes the standalone copy", async () => {
    const env = makeWindow();
    run(env);
    await tick();
    const observers = env.prefObservers.length;
    assert.ok(observers > 0);
    // What loader/ZentralRuntime.js does before activating the same feature id:
    env.window.__zentralStandalone?.["library-resize"]?.dispose?.();
    assert.equal(env.prefObservers.length, 0, "observers released");
    assert.equal(env.window.__zentralStandalone["library-resize"], undefined);
  });

  await test("full pack appears while the standalone copy is still waiting: it never starts", async () => {
    const env = makeWindow();
    run(env);
    env.window.ZentralRuntime = { register() {} };
    await tick();
    assert.equal(env.prefObservers.length, 0);
    assert.equal(env.window.__zentralStandalone["library-resize"], undefined);
  });

  await test("window unload disposes the feature", async () => {
    const env = makeWindow();
    run(env);
    await tick();
    for (const f of env.listeners.unload || []) f();
    assert.equal(env.prefObservers.length, 0);
    assert.equal(env.window.__zentralStandalone["library-resize"], undefined);
  });

  await test("live re-run replaces the previous instance (no double hooks)", async () => {
    const env = makeWindow();
    run(env);
    await tick();
    const first = env.prefObservers.length;
    run(env);
    await tick();
    assert.equal(env.prefObservers.length, first);
  });

  await test("dispose during init releases what init created", async () => {
    const env = makeWindow();
    run(env);
    env.window.__zentralStandalone["library-resize"].dispose();
    await tick();
    assert.equal(env.prefObservers.length, 0);
  });

  await test("preferences.json: only the module's keys, all in its schema", () => {
    const prefs = JSON.parse(fs.readFileSync(path.join(dir, "preferences.json"), "utf8"));
    const schema = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).schema;
    assert.deepEqual(prefs.map((p) => p.property), schema.map((p) => p.property));
    assert.ok(prefs.every((p) => p.property.startsWith("zen.workspace.zentral.experimental.library_resize")));
  });

  await test("full pack is untouched: root theme.json still loads only the loader", () => {
    const theme = JSON.parse(fs.readFileSync(path.join(root, "theme.json"), "utf8"));
    assert.deepEqual(Object.keys(theme.scripts), ["loader/Zentral.uc.js"]);
    assert.equal(theme.id, "zentral-sine-extended");
  });

  await test("build: up to date, and refuses changed content without a version bump", () => {
    cp.execFileSync("node", ["tools/build-standalone.cjs", "--check"], { cwd: root });
    const src = path.join(dir, "ZentralLibraryResize.uc.js");
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

  await test("build: rejects a module that needs the loader/lifecycle", () => {
    const tmp = path.join(root, "additional/zz-test");
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, "standalone.json"), JSON.stringify({ id: "zz", themeId: "zz", name: "zz", version: "1.0.0", entry: "a.uc.js", output: "a.standalone.uc.js" }));
    fs.writeFileSync(path.join(tmp, "a.uc.js"), "window.ZentralModuleLoader.load('x');");
    try {
      assert.throws(
        () => cp.execFileSync("node", ["tools/build-standalone.cjs"], { cwd: root, stdio: "pipe" }),
        (e) => /not standalone-ready|does not provide/.test(String(e.stderr)),
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  console.log(`\n${passed} standalone tests passed`);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
