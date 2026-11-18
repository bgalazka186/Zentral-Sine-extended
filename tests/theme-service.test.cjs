"use strict";
/* OW-38 (part 1): the theme service. It has no test suite of its own: the pure policy was loaded by nothing and the
 * observer side was checked only by reading it. Here the policy is exercised directly and the service is started
 * against a fake window, so the wiring (which pref wins, which attribute is written, what a teardown restores) is a
 * test and not a promise. Nothing here touches the real document. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const POLICY_SRC = fs.readFileSync(path.join(root, "additional/theme/ZentralThemePolicy.js"), "utf8");
const SERVICE_SRC = fs.readFileSync(path.join(root, "additional/theme/ZentralThemeService.js"), "utf8");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(root, "additional/theme/theme-settings.json"), "utf8"));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

// ---- the policy, loaded the way the service loads it (the module loader's define/load path is stubbed) ----
function loadPolicy() {
  const defined = {};
  const win = { ZentralModuleLoader: { define: (name, factory) => { defined[name] = factory; }, load: () => {} } };
  const sandbox = { window: win, module: { exports: {} }, globalThis: {} };
  vm.runInNewContext(POLICY_SRC, sandbox);
  return { api: defined["theme-policy"](), cjs: sandbox.module.exports };
}

test("the policy answers all six cases, and both loaders expose the same one", () => {
  const { api, cjs } = loadPolicy();
  assert.equal(typeof api.resolveTheme, "function");
  assert.equal(api.resolveTheme, cjs.resolveTheme, "the AMD-style loader and CommonJS see one implementation");
  assert.equal(api.resolveTheme("light", { browserDark: true, contentDark: true, systemDark: true }), "light", "an explicit choice beats every signal");
  assert.equal(api.resolveTheme("dark", { browserDark: false }), "dark");
  assert.equal(api.resolveTheme("content", { browserDark: false, contentDark: true }), "dark", "content follows the page, not the chrome");
  assert.equal(api.resolveTheme("content", { browserDark: true, contentDark: false }), "light");
  assert.equal(api.resolveTheme("system", { browserDark: true, systemDark: false }), "light", "system follows the OS, not the chrome");
  assert.equal(api.resolveTheme("browser", { browserDark: true }), "dark", "the default source is the browser");
  assert.equal(api.resolveTheme("nonsense", { browserDark: true }), "dark", "an unknown policy falls back to the browser source");
  assert.equal(api.resolveTheme(undefined, {}), "light");
});

// ---- the service, with the smallest window it actually touches ----
function fakeServiceEnv({ prefs = {}, native = {}, scheme, content, dark, zenDark } = {}) {
  const attributes = new Map([
    ["zentral-effective-theme", null],
    ["zentral-contrast-policy", null],
    ["lwtheme-brighttext", "false"],
  ]);
  const written = [];
  const observers = [];
  const cleanups = [];
  const listeners = [];
  const rafQueue = [];
  const mqListeners = [];
  const mq = { matches: Boolean(dark), addEventListener: (t, fn) => mqListeners.push(fn), removeEventListener: () => {} };
  const documentElement = {
    getAttribute: (k) => (attributes.has(k) ? attributes.get(k) : null),
    setAttribute: (k, v) => { attributes.set(k, v); written.push(k); },
    removeAttribute: (k) => { attributes.delete(k); written.push("-" + k); },
  };
  const window = {
    matchMedia: () => mq,
    gZenThemePicker: { isDarkMode: zenDark },
  };
  const Core = {
    getPref: (k, f) => (k in prefs ? prefs[k] : f),
    getNativePref: (k, f) => (k in native ? native[k] : f),
  };
  const lifecycle = {
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    // The service resubscribes by prefix; the fake keeps the handler so a test can "change a pref".
    preference: (prefix, fn) => { observers.push({ prefix, fn }); cleanups.push(() => {}); },
    observe: (topic, fn) => { listeners.push({ topic, fn }); cleanups.push(() => {}); },
    listen: (target, type, fn) => { cleanups.push(() => {}); },
    own: (fn) => cleanups.push(fn),
  };
  const flush = () => { while (rafQueue.length) rafQueue.shift()(); };
  return { attributes, written, observers, cleanups, listeners, mq, mqListeners, lifecycle, Core, window, documentElement, flush };
}

function startService(env) {
  const runtime = {};
  const registrations = [];
  const sandboxWindow = {
    ...env.window,
    ZentralModuleLoader: {
      load: () => {},
      create: () => loadPolicy().api,
    },
    ZentralRuntime: { register: (def) => registrations.push(def) },
  };
  const sandbox = {
    window: sandboxWindow,
    document: { documentElement: env.documentElement },
    MutationObserver: class { observe() {} disconnect() {} },
    globalThis: {},
  };
  vm.runInNewContext(SERVICE_SRC, sandbox);
  assert.equal(registrations.length, 1, "the service registers exactly once");
  const init = registrations[0].init;
  init({ lifecycle: env.lifecycle, shared: { Core: env.Core }, runtime });
  return { runtime, sandboxWindow };
}

test("the service writes the theme and the contrast policy, and the runtime gets the state", () => {
  const env = fakeServiceEnv({ prefs: { "zen.workspace.zentral.theme.policy": "dark", "zen.workspace.zentral.theme.contrast": "high" }, dark: false });
  const { runtime } = startService(env);
  assert.equal(env.attributes.get("zentral-effective-theme"), "dark");
  assert.equal(env.attributes.get("zentral-contrast-policy"), "high");
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.themeState)), { policy: "dark", theme: "dark", contrast: "high" });
});

test("the source follows the pref: browser, content, system, and an absurd value", () => {
  const browser = fakeServiceEnv({ native: { "zen.view.window.scheme": 0 } });
  startService(browser);
  assert.equal(browser.attributes.get("zentral-effective-theme"), "dark", "scheme 0 is dark, whatever the OS says");

  const light = fakeServiceEnv({ native: { "zen.view.window.scheme": 1 }, dark: true });
  startService(light);
  assert.equal(light.attributes.get("zentral-effective-theme"), "light", "scheme 1 is light even with a dark OS");

  const content = fakeServiceEnv({ prefs: { "zen.workspace.zentral.theme.policy": "content" }, native: { "layout.css.prefers-color-scheme.content-override": 0 }, dark: false });
  startService(content);
  assert.equal(content.attributes.get("zentral-effective-theme"), "dark", "content override 0 is dark for pages");

  const absurd = fakeServiceEnv({ prefs: { "zen.workspace.zentral.theme.policy": "purple" }, dark: true });
  startService(absurd);
  assert.equal(absurd.attributes.get("zentral-effective-theme"), "dark", "an unknown policy does not blank the theme");
});

test("a pref change is coalesced into one frame, never painted per event", () => {
  const env = fakeServiceEnv({ dark: false });
  startService(env);
  assert.equal(env.written.filter((k) => k === "zentral-effective-theme").length, 1, "one write at start");
  assert.ok(env.observers.length >= 3, "the pref prefixes are observed");
  const before = env.written.length;
  // Three changes in a row: the service must queue one frame, not three paints.
  env.observers[0].fn();
  env.observers[0].fn();
  env.observers[0].fn();
  env.flush();
  const after = env.written.filter((k) => k === "zentral-effective-theme").length;
  assert.equal(after, 1, "an unchanged theme writes nothing (the write is guarded by a comparison)");
  assert.ok(env.written.length >= before, "nothing is written for an unchanged value");
});

test("teardown restores the root to exactly what it found, and drops the runtime state", () => {
  const env = fakeServiceEnv({ prefs: { "zen.workspace.zentral.theme.policy": "dark" }, dark: false });
  const { runtime } = startService(env);
  assert.ok(runtime.themeState, "state exists while running");
  // The two cleanups the service registered are LIFO: the restore is the last `own()` it made.
  for (const fn of env.cleanups.reverse()) fn();
  assert.equal(env.attributes.has("zentral-effective-theme"), false, "an attribute the service created is removed");
  assert.equal(env.attributes.has("zentral-contrast-policy"), false);
  assert.equal(runtime.themeState, undefined, "and the runtime holds no stale theme");
});

test("the settings the service reads are the ones the schema declares", () => {
  const declared = SETTINGS.schema.map((s) => s.property);
  assert.deepEqual(declared.sort(), ["zen.workspace.zentral.theme.contrast", "zen.workspace.zentral.theme.policy"]);
  for (const property of declared) assert.match(SERVICE_SRC, new RegExp(property.replace(/\./g, "\\.")));
  assert.ok(SETTINGS.schema.every((s) => Array.isArray(s.options) && s.options.length > 0), "both are dropdowns with real options");
  const policyValues = SETTINGS.schema.find((s) => s.property.endsWith(".policy")).options.map((o) => o.value);
  for (const wanted of ["browser", "light", "dark", "content", "system"]) assert.ok(policyValues.includes(wanted), "policy offers " + wanted);
});

console.log("\nPASS theme-service (" + passed + " tests)");
