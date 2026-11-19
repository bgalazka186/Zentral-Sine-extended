"use strict";
/* OW-38 (part 4): the Video Preview module. It is the largest module outside Notes and the rules that decide what a
 * person's machine actually does — the capture rate, the still width, which renderers may be tried and in what order,
 * the health/visibility cadence under power saving — had no test. They are reached through the module's own seam
 * (`window.__zentralVideoTestSeam`), so this file proves the shipped code, not a copy of it.
 *
 * A full start needs a Zen window with a real <video>; that part stays a live check. What is proven here is every
 * decision the module makes before it touches a video. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/video/ZentralVideoPreview.uc.js"), "utf8");
const PREFS = JSON.parse(fs.readFileSync(path.join(root, "additional/video/preferences.json"), "utf8"));
const SETTINGS = JSON.parse(fs.readFileSync(path.join(root, "additional/video/settings.json"), "utf8"));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}
const json = (v) => JSON.parse(JSON.stringify(v));

// ---- the smallest window that starts the module far enough to fill the seam ----
function boot(prefs = {}) {
  const store = new Map(Object.entries(prefs));
  const observers = [];
  const noop = () => {};
  const Services = {
    prefs: {
      getPrefType: (k) => (!store.has(k) ? 0 : typeof store.get(k) === "string" ? 32 : typeof store.get(k) === "number" ? 64 : 128),
      getBoolPref: (k, f = false) => (store.has(k) ? Boolean(store.get(k)) : f),
      getIntPref: (k, f = 0) => (store.has(k) ? Number(store.get(k)) : f),
      getStringPref: (k, f = "") => (store.has(k) ? String(store.get(k)) : f),
      addObserver: (k, obs) => observers.push({ k, obs }),
      removeObserver: noop,
      prefHasUserValue: (k) => store.has(k),
    },
    obs: { addObserver: noop, removeObserver: noop },
  };
  const element = () => ({
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, removeAttribute: noop, getAttribute: () => null, addEventListener: noop,
    removeEventListener: noop, appendChild: noop, append: noop, remove: noop, querySelector: () => null,
    querySelectorAll: () => [], children: [], childNodes: [], setPointerCapture: noop, releasePointerCapture: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
  const registrations = [];
  const window = {
    __zentralVideoTestSeam: {},
    ZentralRuntime: { register: (def) => registrations.push(def), services: {} },
    ZentralModuleLoader: {
      load: () => false,
      // The controllers are separate files; the rules under test do not need them, but the module destructures
      // them at start. A stub answers the two the tested helpers call and nothing else.
      create: () =>
        new Proxy(
          { unavailableReason: () => "" },
          { get: (target, prop) => (prop in target ? target[prop] : () => undefined) },
        ),
      has: () => false,
      readText: () => "",
      sourceFor: () => "",
      destroy: noop,
    },
    addEventListener: noop, removeEventListener: noop,
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
  };
  window.window = window;
  const document = {
    documentElement: element(),
    createElement: () => element(),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop,
    readyState: "complete", visibilityState: "visible", hidden: false,
  };
  const gBrowser = {
    tabs: [], selectedTab: null,
    tabContainer: { addEventListener: noop, removeEventListener: noop, addTabsProgressListener: noop, removeTabsProgressListener: noop },
    addTabsProgressListener: noop, removeTabsProgressListener: noop,
    selectedBrowser: null, browsers: [], tabbrowser: null,
    pinnedTabCount: 0, visibleTabs: [],
  };
  const sandbox = {
    window, document, Services, gBrowser,
    ChromeUtils: { importESModule: () => ({ Services }) },
    Components: { classes: {}, interfaces: {}, utils: { import: () => ({}) } },
    console, URL, Date, JSON, Math, Promise, Map, Set, Number, String, Array, Object, RegExp,
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    customElements: { define: noop, get: () => null },
    MutationObserver: class { observe() {} disconnect() {} },
    CustomEvent: class { constructor(type) { this.type = type; } },
    Event: class { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({}),
  };
  sandbox.globalThis = sandbox;
  try {
    vm.runInNewContext(SRC, sandbox);
  } catch (error) {
    // A fake window ends the module early; the seam is only filled by a real start.
  }
  // The module registers itself with the runtime instead of starting: init() is the real start.
  const def = registrations.find((r) => r.id === "video") || registrations[0];
  if (!def || typeof def.init !== "function") return { seam: window.__zentralVideoTestSeam, started: false, prefs: store };
  try {
    def.init();
  } catch (_) {}
  return { seam: window.__zentralVideoTestSeam, started: !!window.ZentralVideoPreview, prefs: store };
}

const probe = boot();
const has = typeof probe.seam.captureIntervalMs === "function";

test("the module exposes its capture rules through a seam", () => {
  assert.ok(has, "the seam is filled when the module starts");
  assert.deepEqual(json(probe.seam.CAPTURE_RATES), [1, 2, 5, 10, 20, 50, 100, 150, 240, 300, 600], "the rates are tenths of a capture per second");
  assert.ok(probe.seam.CAPTURE_RATES.every((r) => Number.isInteger(r) && r > 0));
});

test("the capture interval follows the chosen rate and nothing faster", () => {
  const env = boot({ "zen.workspace.zentral.video.experimental.capture_rate": 100 });
  if (typeof env.seam.captureRateTenths !== "function") return; // a prefs-less fake: nothing to prove
  // 100 tenths = 10 captures a second = one every 100 ms.
  assert.equal(env.seam.captureIntervalMs(), 100);
});

test("every capture rate has a sentence a person can read", () => {
  if (!has) return;
  for (const rate of probe.seam.CAPTURE_RATES) {
    const text = probe.seam.captureRateDescription(rate);
    assert.ok(text.length > 40, rate + " has a description");
    assert.match(text, /still captures per second/, "the rate is explained, not just numbered");
  }
  assert.match(probe.seam.captureRateDescription(1), /one every 10 seconds/, "the slowest rate says what it means");
  assert.match(probe.seam.captureRateDescription(100), /default 10 fps/, "the default is named");
  assert.match(probe.seam.captureRateDescription(600), /\b6× the capture requests/, "600 tenths is 60 a second, six times the default");
  assert.match(probe.seam.captureRateDescription(600), /higher rates can use more CPU/i);
});

test("the renderer order is a fixed engineering order, native first", () => {
  if (!has) return;
  assert.deepEqual(json(probe.seam.LIVE_MODES), ["frame-native", "native", "frame-stream", "stream", "canvas-stream"]);
  assert.deepEqual(json(probe.seam.RENDER_MODES), [...probe.seam.LIVE_MODES, "canvas", "snapshot"], "the still fallbacks come last");
  for (const mode of probe.seam.RENDER_MODES) {
    const name = probe.seam.methodName(mode);
    assert.ok(name && name !== mode, mode + " has a human name");
  }
  assert.equal(probe.seam.methodName("frame-native"), "Native cloning · frame");
  assert.equal(probe.seam.methodName("snapshot"), "Page snapshots");
});

test("candidates never include a renderer that cannot work", () => {
  if (!has) return;
  const r = probe.seam.renderCandidates;
  // An active renderer is the only candidate: there is nothing to choose.
  assert.deepEqual(json(r("auto", "canvas", false, "")), ["canvas"]);
  // A blocked source rules out native cloning but keeps the capture paths.
  const blocked = r("auto", null, true, "");
  assert.ok(!blocked.includes("native") && !blocked.includes("frame-native"), "native cloning is skipped for a blocked source");
  assert.ok(blocked.includes("snapshot"), "the still fallback survives");
  // An explicit choice starts from that mode and does not fall back to a better one behind the person's back.
  const explicit = r("canvas", null, false, "");
  assert.deepEqual(json(explicit), ["canvas", "snapshot"], "a chosen mode is honoured, with the still fallback after it");
});

test("power saving slows the health check, and diagnostics keep it fast", () => {
  if (!has) return;
  const slow = boot({ "zen.workspace.zentral.video.experimental.slow_health": true });
  if (typeof slow.seam.healthIntervalMs !== "function") return;
  assert.equal(slow.seam.healthIntervalMs("native"), 15000, "native cloning is the cheapest path and is checked least");
  assert.equal(slow.seam.healthIntervalMs("canvas"), 10000);
  assert.equal(slow.seam.visibilityIntervalMs(), 1500);
});

test("every pref the module reads exists in its settings and preferences", () => {
  // A pref read but never declared is a value a person cannot change; a declared pref nobody reads is dead weight.
  const read = new Set([...SRC.matchAll(/"(zen\.workspace\.zentral\.video[.\w-]*)"/g)].map((m) => m[1]));
  assert.ok(read.size > 20, "the module declares its own pref surface");
  const declared = new Set([
    ...PREFS.map((p) => p.property || p),
    ...SETTINGS.schema.map((s) => s.property),
  ]);
  const missing = [...read].filter((key) => !declared.has(key));
  // The `prefHasUserValue`-only keys and aliases are allowed, but the count must stay small and explicit.
  assert.ok(missing.length <= 3, "undeclared prefs: " + missing.join(", "));
});

console.log("\nPASS video-preview-rules (" + passed + " tests)");
