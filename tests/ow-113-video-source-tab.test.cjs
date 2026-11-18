"use strict";
/* OW-113 (owner audit F3): Boost's "never unload the Big Picture source tab" rule was dead code.
 *
 * `videoSourceTab()` reads `window.Zentral?.Video?.sourceTab || window.__zentralVideoSourceTab`, but no file
 * under additional/video/** wrote either one. A paused/muted video source could therefore be unloaded and the
 * sidebar preview blanked; only an audible source survived (by a different rule).
 *
 * This suite checks the CURRENT behaviour on both sides: the video module must publish a getter for its own
 * `current` state and tear it down on destroy; Level 2, the limiter and Game Mode must leave that tab loaded.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const VIDEO_SRC = read("additional/video/ZentralVideoPreview.uc.js");
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ---------------- 1. the video module publishes its own source state ---------------- */

// The same "smallest window that starts the module" used by tests/video-preview-rules.test.cjs, with
// the OW-113 seam added by the source. A real <video> is not needed for a state getter.
function bootVideo() {
  const store = new Map();
  const noop = () => {};
  const Services = {
    prefs: {
      getPrefType: (k) => (!store.has(k) ? 0 : typeof store.get(k) === "string" ? 32 : typeof store.get(k) === "number" ? 64 : 128),
      getBoolPref: (k, f = false) => (store.has(k) ? Boolean(store.get(k)) : f),
      getIntPref: (k, f = 0) => (store.has(k) ? Number(store.get(k)) : f),
      getStringPref: (k, f = "") => (store.has(k) ? String(store.get(k)) : f),
      addObserver: noop, removeObserver: noop,
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
  const win = {
    __zentralVideoTestSeam: {},
    ZentralRuntime: { register: (def) => registrations.push(def), services: {} },
    ZentralModuleLoader: {
      load: () => false,
      create: () => new Proxy({ unavailableReason: () => "" }, { get: (target, prop) => (prop in target ? target[prop] : () => undefined) }),
      has: () => false, readText: () => "", sourceFor: () => "", destroy: noop,
    },
    addEventListener: noop, removeEventListener: noop,
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
  };
  win.window = win;
  const document = {
    documentElement: element(), createElement: () => element(), getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop,
    readyState: "complete", visibilityState: "visible", hidden: false,
  };
  const gBrowser = {
    tabs: [], selectedTab: null,
    tabContainer: { addEventListener: noop, removeEventListener: noop, addTabsProgressListener: noop, removeTabsProgressListener: noop },
    addTabsProgressListener: noop, removeTabsProgressListener: noop,
    selectedBrowser: null, browsers: [], tabbrowser: null, pinnedTabCount: 0, visibleTabs: [],
  };
  const sandbox = {
    window: win, document, Services, gBrowser,
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
  try { vm.runInNewContext(VIDEO_SRC, sandbox); } catch (_) {}
  const def = registrations.find((r) => r.id === "video") || registrations[0];
  assert.ok(def?.init, "the video module registers a feature");
  try { def.init(); } catch (error) { assert.fail("video init threw: " + error); }
  return { win, seam: win.__zentralVideoTestSeam };
}

test("the video module publishes a live getter for the tab behind its selected source", () => {
  const { win, seam } = bootVideo();
  const descriptor = Object.getOwnPropertyDescriptor(win, "__zentralVideoSourceTab");
  assert.ok(descriptor && typeof descriptor.get === "function", "the getter exists on the window");
  assert.equal(win.__zentralVideoSourceTab, null, "no source selected: null");

  const tab = { label: "paused video", isConnected: true, closing: false, linkedBrowser: { isConnected: true } };
  // This is the same module state the controllers write (`deps.current = source`).
  assert.equal(typeof seam.setVideoSource, "function", "the test seam can drive that state");
  seam.setVideoSource({ tab, browser: tab.linkedBrowser, data: { kind: "video", paused: true, muted: true } });
  assert.equal(win.__zentralVideoSourceTab, tab, "a paused/muted source is still the source tab");

  // A source that belongs to an app panel has no ordinary tab to protect.
  seam.setVideoSource({ panel: "app", browser: { isConnected: true } });
  assert.equal(win.__zentralVideoSourceTab, null, "a panel-only source has no tab");

  // A disconnected/closing tab is not a live source any more.
  tab.isConnected = false;
  seam.setVideoSource({ tab, browser: tab.linkedBrowser });
  assert.equal(win.__zentralVideoSourceTab, null, "a stale tab is not published");
  tab.isConnected = true;
  seam.setVideoSource(null);
  assert.equal(win.__zentralVideoSourceTab, null, "clearing the state clears the getter");

  win.ZentralVideoPreview.destroy();
  assert.equal(Object.prototype.hasOwnProperty.call(win, "__zentralVideoSourceTab"), false,
    "destroy removes the getter instead of leaving a stale tab behind");
  assert.equal(win.ZentralVideoPreview, undefined, "the public API is removed too");
});

/* ---------------- 2. every Boost pass honours that getter ---------------- */

function tab({ url = "https://example.com/", lastAccessed = 0, soundPlaying = false } = {}) {
  const attrs = new Set();
  return {
    closing: false, isConnected: true, hidden: false, linkedPanel: "p1",
    linkedBrowser: { currentURI: { spec: url }, isPictureInPicture: false, audioPlaybackActive: false,
      isConnected: true, docShellIsActive: true, renderLayers: true, isRemoteBrowser: true },
    lastAccessed, soundPlaying, label: url,
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => (name === "zen-dormant" ? null : attrs.has(name) ? "" : null),
    matches: () => false,
    pinned: false,
  };
}

function bootBoost({ tabs = [], sourceTab = null, zentralVideo = null, readings = [900], prefs = {} } = {}) {
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    ...prefs,
  }));
  const timers = new Map();
  let timerId = 0;
  let readingIndex = 0;
  let registration = null;
  const unloadCalls = [];
  const win = {
    gBrowser: {
      tabs,
      selectedTab: null,
      explicitUnloadTabs: async (list) => {
        for (const t of list) { unloadCalls.push(t); t.linkedPanel = null; }
        return true;
      },
    },
    Services: {
      prefs: {
        getBoolPref: (k, d) => (store.has(k) ? Boolean(store.get(k)) : d),
        getStringPref: (k, d) => (store.has(k) ? String(store.get(k)) : d),
        getIntPref: (k, d) => (store.has(k) ? Number(store.get(k)) : d),
        setBoolPref: (k, v) => store.set(k, v),
        prefHasUserValue: (k) => store.has(k),
        addObserver() {}, removeObserver() {},
      },
      appinfo: { OS: "Linux" },
      obs: { addObserver() {}, removeObserver() {} },
    },
    Cc: { "@mozilla.org/memory-reporter-manager;1": { getService: () => ({ minimizeMemoryUsage: (cb) => cb?.run?.() }) } },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: { getTabState: (t) => JSON.stringify({ entries: [{ url: t.linkedBrowser?.currentURI?.spec || "" }], index: 1 }) },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback: () => 1,
    addEventListener() {}, removeEventListener() {},
    console: { warn() {}, log() {}, error() {} },
    ZentralRuntime: {
      register: (def) => { registration = def; },
      performance: { paused: false, isPaused() { return this.paused; }, setPaused(value) { this.paused = Boolean(value); }, subscribe: () => () => {} },
    },
  };
  win.window = win;
  win.globalThis = win;
  // The exact contract OW-113 adds: a live getter over the video module's state.
  Object.defineProperty(win, "__zentralVideoSourceTab", {
    configurable: true,
    get: () => zentralVideo || sourceTab,
  });
  win.Zentral = { Panels: { essentialPanels: new Map() }, ...(zentralVideo ? { Video: { sourceTab: zentralVideo } } : {}) };
  const context = vm.createContext({
    ...win,
    ChromeUtils: {
      requestProcInfo: () => ({ memory: readings[Math.min(readingIndex++, readings.length - 1)] }),
      forceGC() {}, forceCC() {},
    },
    Cc: win.Cc, Ci: win.Ci, console: win.console,
    Promise, Set, Map, WeakMap, WeakSet, Array, Object, Number, Math, String, Symbol, Error, TypeError, Date, JSON,
    globalThis: win,
  });
  win.ZentralTabPolicy = (() => {
    const w = {}; w.window = w;
    vm.runInNewContext(POLICY_SRC, { window: w, globalThis: w, console });
    return w.ZentralTabPolicy;
  })();
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  registration.init();
  const api = win.ZentralBoost;
  return {
    api, win, unloadCalls, timers, store,
    destroy: () => api.destroy(),
    async settle() {
      for (let round = 0; round < 20; round++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const due = [...timers].filter(([, t]) => t.ms === 3000);
        for (const [id, t] of due) { timers.delete(id); t.fn(); }
        await Promise.resolve();
      }
    },
    async fire(ms) {
      const due = [...timers].filter(([, t]) => t.ms === ms);
      for (const [id, t] of due) { timers.delete(id); t.fn(); }
      for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      return due.length;
    },
  };
}

test("Level 2 leaves a non-audible source tab loaded, and no source means no protection", async () => {
  const source = tab({ url: "https://video.example/", lastAccessed: 1 });
  const old = tab({ url: "https://old.example/", lastAccessed: 0 });
  const h = bootBoost({ tabs: [source, old], sourceTab: source });
  const pending = h.api.runLevel2();
  await h.settle();
  const result = await pending;
  assert.equal(result.unloaded.tabs, 1, "the ordinary old tab still sleeps");
  assert.deepEqual(h.unloadCalls, [old], "the paused/muted video source is left alone");
  h.destroy();

  const none = bootBoost({ tabs: [tab({ url: "https://video.example/" })] });
  assert.equal(none.win.__zentralVideoSourceTab, null, "the getter says null when there is no source");
  const pending2 = none.api.runLevel2();
  await none.settle();
  const result2 = await pending2;
  assert.equal(result2.unloaded.tabs, 1, "with no source there is nothing to protect");
  none.destroy();
});

test("the limiter leaves the source tab loaded even above the RAM limit", async () => {
  const source = tab({ url: "https://video.example/", lastAccessed: 0 });
  const old = tab({ url: "https://old.example/", lastAccessed: 1 });
  const h = bootBoost({
    tabs: [source, old], sourceTab: source, readings: [5000, 4800, 4800, 4800],
    prefs: {
      "zen.workspace.zentral.boost.limit_enabled": true,
      "zen.workspace.zentral.boost.limit_mb": 100,
      "zen.workspace.zentral.boost.limit_mode": "hard",
      "zen.workspace.zentral.boost.limit_cooldown_s": 0,
      "zen.workspace.zentral.boost.limit_target_pct": 85,
    },
  });
  await h.fire(60000);
  await h.settle();
  assert.equal(h.api.limiterState().lastAction, "unload", "the limiter really ran a hard pass");
  assert.equal(h.unloadCalls.includes(source), false, "the source survives the limiter");
  assert.equal(h.unloadCalls.includes(old), true, "an ordinary tab does not");
  h.destroy();
});

test("Game Mode exempts the source tab from both Level 2 and the activity pass", async () => {
  const source = tab({ url: "https://video.example/", lastAccessed: 0 });
  const old = tab({ url: "https://old.example/", lastAccessed: 1 });
  const h = bootBoost({ tabs: [source, old], sourceTab: source });
  const targets = h.api.gameModeTargets();
  const sourceTarget = targets.find((t) => t.id === source.linkedBrowser);
  assert.equal(sourceTarget?.exempt, true, "the browser is exempt");
  assert.equal(sourceTarget?.why, "video-source", "with the named reason");
  h.api.setGameMode(true);
  await h.settle();
  assert.equal(h.unloadCalls.includes(source), false, "Game Mode's deep pass does not sleep it");
  assert.equal(h.unloadCalls.includes(old), true, "ordinary tabs still do");
  h.api.setGameMode(false);
  h.destroy();
});

test("the full-pack `Zentral.Video.sourceTab` path still wins when a caller publishes it", () => {
  const source = tab({ url: "https://video.example/" });
  const h = bootBoost({ tabs: [source], zentralVideo: source });
  const targets = h.api.gameModeTargets();
  assert.equal(targets.find((t) => t.id === source.linkedBrowser)?.why, "video-source");
  h.destroy();
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-113-video-source-tab (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
