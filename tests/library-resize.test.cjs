"use strict";
/* OW-38 (part 2): Library Resize. The module has been shipped and only ever read. Here it is started against a fake
 * window: the background priority (an explicit colour beats Arc 2.0, Arc beats Zen's own paint), the opacity mixing,
 * the invalid-colour fallbacks, and the promise that a teardown leaves the root exactly as it found it.
 * The layout half needs Zen's Library panel; the background half is the part a person can see immediately, so that
 * is the half this file proves end to end. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/library/ZentralLibraryResize.uc.js"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}
const json = (v) => JSON.parse(JSON.stringify(v));

function boot(prefs = {}, { supportsColor = () => true } = {}) {
  const attributes = new Map();
  const vars = new Map();
  const observers = [];
  const registrations = [];
  const appended = [];
  const rootStyleProps = new Set();
  const documentElement = {
    getAttribute: (k) => (attributes.has(k) ? attributes.get(k) : null),
    setAttribute: (k, v) => attributes.set(k, v),
    removeAttribute: (k) => attributes.delete(k),
    appendChild: (node) => appended.push(node),
    style: {
      getPropertyValue: (k) => vars.get(k) || "",
      setProperty: (k, v) => { vars.set(k, v); rootStyleProps.add(k); },
      removeProperty: (k) => { vars.delete(k); rootStyleProps.delete(k); },
    },
  };
  const makeNode = (tag) => ({ tagName: tag.toUpperCase(), id: "", textContent: "", remove() { this.removed = true; } });
  const prefsStore = new Map(Object.entries(prefs));
  const Services = {
    prefs: {
      getPrefType: (k) => (prefsStore.has(k) ? typeof prefsStore.get(k) === "string" ? 32 : typeof prefsStore.get(k) === "number" ? 64 : 128 : 0),
      getBoolPref: (k) => Boolean(prefsStore.get(k)),
      getIntPref: (k) => Number(prefsStore.get(k)),
      getStringPref: (k) => String(prefsStore.get(k) ?? ""),
      addObserver: (k, obs) => observers.push({ key: k, obs }),
      removeObserver: (k, obs) => { const i = observers.findIndex((o) => o.key === k && o.obs === obs); if (i >= 0) observers.splice(i, 1); },
      prefHasUserValue: (k) => prefsStore.has(k),
    },
  };
  const window = {
    CSS: { supports: (prop, value) => (prop === "color" ? supportsColor(value) : true) },
    ZentralRuntime: { register: (def) => registrations.push(def) },
  };
  const sandbox = {
    window,
    globalThis: { Services },
    ChromeUtils: { importESModule: () => ({ Services }) },
    document: {
      documentElement,
      createElement: (tag) => makeNode(tag),
      getElementById: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    Services,
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    console,
  };
  sandbox.globalThis.window = window;
  vm.runInNewContext(SRC, sandbox);
  const backgrounds = registrations.filter((r) => r.id === "library-resize");
  assert.equal(backgrounds.length, 1, "one registration");
  return { attributes, vars, observers, appended, documentElement, window, seams: window.__zentralLibraryTestSeam, prefsStore, Services };
}

test("the module always registers the same id, once", () => {
  const env = boot();
  assert.equal(env.window.__zentralLibraryTestSeam.PREF, "zen.workspace.zentral.experimental.library_resize");
  assert.equal(env.window.__zentralLibraryTestSeam.COMPAT_PREF, "zen.workspace.zentral.compat.external_library_layout");
});

test("an explicit colour wins over Arc 2.0", () => {
  const seam = boot().seams;
  const result = seam.resolveLibraryBackground({ customEnabled: true, customColor: "  #123456 ", opacity: 100, arcEnabled: true, arcColor: "rgba(1,2,3,0.5)" });
  assert.deepEqual(json(result), { source: "custom", value: "#123456" }, "the value is trimmed and an untouched colour is not mixed");
});

test("opacity mixes the colour with transparency, and 100% is the plain colour", () => {
  const seam = boot().seams;
  assert.equal(seam.resolveLibraryBackground({ customEnabled: true, customColor: "#abcdef", opacity: 40, arcEnabled: false, arcColor: "" }).value,
    "color-mix(in srgb, #abcdef 40%, transparent)");
  assert.equal(seam.resolveLibraryBackground({ customEnabled: true, customColor: "#abcdef", opacity: 100, arcEnabled: false, arcColor: "" }).value, "#abcdef");
  assert.equal(seam.resolveLibraryBackground({ customEnabled: true, customColor: "#abcdef", opacity: "nonsense", arcEnabled: false, arcColor: "" }).value, "#abcdef",
    "an unreadable opacity leaves the colour alone");
  assert.equal(seam.resolveLibraryBackground({ customEnabled: true, customColor: "#abcdef", opacity: 900, arcEnabled: false, arcColor: "" }).value, "#abcdef",
    "and above 100 % it is still the colour");
});

test("Arc 2.0 applies only when the person asked for it and its own colour exists", () => {
  const seam = boot().seams;
  assert.deepEqual(json(seam.resolveLibraryBackground({ customEnabled: false, customColor: "", opacity: 100, arcEnabled: true, arcColor: " rgba(9,9,9,0.4) " })),
    { source: "arc2", value: "rgba(9,9,9,0.4)" });
  assert.deepEqual(json(seam.resolveLibraryBackground({ customEnabled: false, customColor: "", opacity: 100, arcEnabled: false, arcColor: "rgba(9,9,9,0.4)" })),
    { source: null, value: "" }, "no switch, no paint: Zen keeps its own background");
  assert.deepEqual(json(seam.resolveLibraryBackground({ customEnabled: true, customColor: "", opacity: 100, arcEnabled: true, arcColor: "" })),
    { source: null, value: "" }, "an empty colour is not a colour");
});

test("a colour the platform rejects never reaches the root", () => {
  // The seam is the pure function itself: `supportsColor` is its second argument, exactly as the browser passes it.
  const seam = boot().seams;
  const strict = (v) => /^(#[0-9a-f]{3,8}|rgba?\(|color-mix\()/i.test(v.trim());
  assert.deepEqual(json(seam.resolveLibraryBackground({ customEnabled: true, customColor: "not-a-color", opacity: 100, arcEnabled: true, arcColor: "rgba(1,1,1,0.3)" }, strict)),
    { source: "arc2", value: "rgba(1,1,1,0.3)" }, "an invalid custom colour falls through to Arc, not to a broken paint");
  assert.deepEqual(json(seam.resolveLibraryBackground({ customEnabled: true, customColor: "not-a-color", opacity: 100, arcEnabled: false, arcColor: "" }, strict)),
    { source: null, value: "" });
});

test("the background follows the prefs and a teardown restores the root", () => {
  const attributes = new Map();
  const vars = new Map();
  const appended = [];
  const prefs = new Map([
    ["zen.workspace.zentral.library.custom_background", true],
    ["zen.workspace.zentral.library.custom_background.color", "#220033"],
    ["zen.workspace.zentral.library.custom_background.opacity", 70],
  ]);
  const observers = [];
  const documentElement = {
    getAttribute: (k) => (attributes.has(k) ? attributes.get(k) : null),
    setAttribute: (k, v) => attributes.set(k, v),
    removeAttribute: (k) => attributes.delete(k),
    appendChild: (n) => appended.push(n),
    style: {
      getPropertyValue: (k) => vars.get(k) || "",
      setProperty: (k, v) => vars.set(k, v),
      removeProperty: (k) => vars.delete(k),
    },
  };
  const Services = {
    prefs: {
      getPrefType: (k) => (prefs.has(k) ? (typeof prefs.get(k) === "string" ? 32 : typeof prefs.get(k) === "number" ? 64 : 128) : 0),
      getBoolPref: (k) => Boolean(prefs.get(k)),
      getIntPref: (k) => Number(prefs.get(k)),
      getStringPref: (k) => String(prefs.get(k) ?? ""),
      addObserver: (k, obs) => observers.push({ k, obs }),
      removeObserver: (k, obs) => { const i = observers.findIndex((o) => o.k === k && o.obs === obs); if (i >= 0) observers.splice(i, 1); },
      prefHasUserValue: (k) => prefs.has(k),
    },
    obs: { addObserver: () => {}, removeObserver: () => {} },
  };
  const doc = {
    documentElement,
    createElement: (t) => ({ tagName: t.toUpperCase(), id: "", textContent: "", remove() { this.removed = true; } }),
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  let stopped = null;
  const window = {
    CSS: { supports: () => true },
    document: doc,
    ZentralRuntime: { register: (def) => { if (def.id === "library-resize") stopped = def.init(); } },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const sandbox = {
    window,
    globalThis: { Services },
    ChromeUtils: { importESModule: () => ({ Services }) },
    document: doc,
    Services,
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    console,
  };
  vm.runInNewContext(SRC, sandbox);
  assert.equal(typeof stopped, "function", "the module returns a stop function from init");
  assert.equal(attributes.get("zentral-library-background"), "custom", "the root says which source painted");
  assert.equal(vars.get("--zentral-library-background"), "color-mix(in srgb, #220033 70%, transparent)");
  const styleNode = appended.find((n) => n.id === "zentral-library-background-style");
  assert.ok(styleNode, "one scoped style sheet is added");
  assert.match(styleNode.textContent, /:root\[zentral-library-background\] #zen-library-panel/, "every rule is scoped to the attribute");
  assert.ok(observers.length >= 5, "every background pref is observed");
  stopped();
  assert.equal(attributes.has("zentral-library-background"), false, "teardown removes the attribute");
  assert.equal(vars.has("--zentral-library-background"), false, "and the custom property");
  assert.ok(styleNode.removed, "and the style sheet");
  assert.equal(observers.length, 0, "no observer is left behind");
});

console.log("\nPASS library-resize (" + passed + " tests)");
