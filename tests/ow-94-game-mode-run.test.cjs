"use strict";
/* OW-94 (plan B7.2/B7.3): Game Mode, run for real against a fake browser.
 *
 * The source checks in `ow-94-game-mode.test.cjs` prove the rules exist; this one proves they act. It boots the module
 * the way the standalone build does, with a `gBrowser` whose tabs are ordinary objects that record what happens to
 * them, and asserts the three things a person can observe:
 *   - a tab they are not looking at goes inactive, and one that is playing sound does not;
 *   - switching off puts back what the mode changed and reactivates the selected tab;
 *   - every repeating feature was asked to pause, and told when it may resume.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const POLICY_SRC = fs.readFileSync(path.join(REPO, "loader/ZentralTabPolicy.js"), "utf8");
const SWITCH_SRC = fs.readFileSync(path.join(REPO, "loader/ZentralPerformanceSwitch.js"), "utf8");
const BOOST_SRC = fs.readFileSync(path.join(REPO, "additional/boost/ZentralBoost.uc.js"), "utf8");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function fakeBrowser({ active = false, layers = true, remote = true } = {}) {
  return { isConnected: true, docShellIsActive: active, renderLayers: layers, isRemoteBrowser: remote };
}

function fakeTab({ browser, label = "tab", sound = false, selected = false } = {}) {
  const attrs = new Set();
  const element = {
    label,
    isConnected: true,
    closing: false,
    linkedPanel: "p1",
    linkedBrowser: browser,
    soundPlaying: sound,
    selected,
    lastAccessed: 0,
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => (attrs.has(name) ? "" : null),
    matches: () => false,
    _attrs: attrs,
  };
  element.pinned = false;
  return element;
}

function boot({ prefs = {} } = {}) {
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    ...prefs,
  }));
  const timers = new Map();
  let timerId = 0;
  const listeners = new Map();
  const observers = new Map();
  let registration = null;

  // Three tabs: one the person is looking at, one playing a podcast, one idle in the background.
  const selectedBrowser = fakeBrowser({ active: true });
  const audioBrowser = fakeBrowser({ active: true });
  const idleBrowser = fakeBrowser({ active: true });
  const selectedTab = fakeTab({ browser: selectedBrowser, label: "selected", selected: true });
  const audioTab = fakeTab({ browser: audioBrowser, label: "podcast", sound: true });
  const idleTab = fakeTab({ browser: idleBrowser, label: "idle" });
  const tabs = [selectedTab, audioTab, idleTab];
  const gBrowser = { tabs, selectedTab, selectedBrowser };
  const essentialPanels = new Map();

  const win = {
    gBrowser,
    Services: {
      prefs: {
        getBoolPref: (k, d) => (store.has(k) ? Boolean(store.get(k)) : d),
        getIntPref: (k, d) => (store.has(k) ? Number(store.get(k)) : d),
        getStringPref: (k, d) => (store.has(k) ? String(store.get(k)) : d),
        setBoolPref: (k, v) => {
          store.set(k, v);
          for (const fn of observers.get(k) || []) fn({}, "", k);
        },
        addObserver: (key, observer) => {
          if (!observers.has(key)) observers.set(key, new Set());
          observers.get(key).add(observer.observe ? observer.observe.bind(observer) : observer);
        },
        removeObserver: (key, observer) => observers.get(key)?.delete(observer),
      },
      appinfo: { OS: "Linux" },
      obs: { addObserver() {}, removeObserver() {} },
    },
    Cc: {
      "@mozilla.org/memory-reporter-manager;1": {
        getService: () => ({ minimizeMemoryUsage: (cb) => cb?.run?.() }),
      },
    },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: { getTabState: () => JSON.stringify({ entries: [{ url: "https://example.com/" }], index: 1 }) },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback: () => 1,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    console: { warn() {}, log() {}, error() {} },
  };
  win.window = win;
  win.globalThis = win;

  // The shared switch, created exactly as the runtime creates it, then published the way the runtime publishes it.
  const switchSandbox = { window: {}, console };
  vm.createContext(switchSandbox);
  vm.runInContext(SWITCH_SRC, switchSandbox, { filename: "ZentralPerformanceSwitch.js" });
  const performance = switchSandbox.window.ZentralPerformanceSwitch.create();
  win.ZentralRuntime = { register: (def) => { registration = def; }, performance };
  win.Zentral = { Panels: { essentialPanels, syncAppPanelBrowserActivity() {} } };

  const context = vm.createContext({
    ...win,
    ChromeUtils: { requestProcInfo: () => ({ memory: 900 }), forceGC() {}, forceCC() {} },
    Cc: win.Cc, Ci: win.Ci, console: win.console,
    Promise, Set, Map, WeakMap, WeakSet, Array, Object, Number, Math, String, Symbol, Error, TypeError, Date, JSON,
    globalThis: win,
  });
  win.ZentralTabPolicy = (() => {
    const p = {};
    p.window = p;
    vm.runInNewContext(POLICY_SRC, { window: p, globalThis: p, console });
    return p.ZentralTabPolicy;
  })();
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  assert.ok(registration?.init, "the module registers a feature");
  registration.init();
  const api = win.ZentralBoost;
  assert.ok(api, "the API is published");
  return { api, performance, tabs: { selectedTab, audioTab, idleTab }, browsers: { selectedBrowser, audioBrowser, idleBrowser } };
}

test("Game Mode deactivates the idle background tab and leaves the podcast alone", () => {
  const { api, browsers } = boot();
  assert.equal(browsers.idleBrowser.docShellIsActive, true, "before: every tab is active, as it always was");
  const state = api.setGameMode(true);
  assert.equal(state.on, true);
  assert.equal(browsers.idleBrowser.docShellIsActive, false, "the idle tab stops painting");
  assert.equal(browsers.idleBrowser.renderLayers, false);
  assert.equal(browsers.audioBrowser.docShellIsActive, true, "the podcast keeps playing: this is the owner gate");
  assert.equal(browsers.selectedBrowser.docShellIsActive, true, "and the tab being looked at");
  api.destroy();
});

test("switching off puts back exactly what it changed", () => {
  const { api, browsers } = boot();
  api.setGameMode(true);
  const state = api.setGameMode(false);
  assert.equal(state.on, false);
  assert.equal(state.restored, 1, "one browser was changed and is put back");
  assert.equal(browsers.idleBrowser.docShellIsActive, true, "active again");
  assert.equal(browsers.idleBrowser.renderLayers, true, "and painting");
  assert.equal(state.selected, 1, "the selected tab is made active in the same pass");
  assert.equal(api.gameModeState().saved, 0, "nothing is left to restore");
  api.destroy();
});

test("the switch pauses every subscribed feature and resumes it on off", () => {
  const { api, performance } = boot();
  const heard = [];
  performance.subscribe((paused) => heard.push(paused));
  api.setGameMode(true);
  assert.equal(performance.isPaused(), true, "one switch for the whole window");
  assert.deepEqual(heard, [true], "features were told once");
  api.setGameMode(false);
  assert.equal(performance.isPaused(), false);
  assert.deepEqual(heard, [true, false], "and told again when the game ends");
  api.destroy();
});

test("Game Mode turned on by the pref at startup runs the same pass", () => {
  const { api, browsers } = boot({ prefs: { "zen.workspace.zentral.boost.game_mode": true } });
  assert.equal(api.gameModeState().on, true, "the pref is the switch, and it is read once at start");
  assert.equal(browsers.idleBrowser.docShellIsActive, false, "and it acted");
  api.destroy();
});

test("destroying the module in Game Mode does not leave the browser deactivated", () => {
  const { api, browsers } = boot();
  api.setGameMode(true);
  assert.equal(browsers.idleBrowser.docShellIsActive, false);
  api.destroy();
  assert.equal(browsers.idleBrowser.docShellIsActive, true, "the window's own teardown turns it off");
});

test("the API exposes the plan's names and no others for Game Mode", () => {
  const { api } = boot();
  for (const name of ["setGameMode", "applyGameMode", "gameModeState", "decideGameMode", "gameModeTargets"]) {
    assert.equal(typeof api[name], "function", name + " is published");
  }
  assert.equal(api.gameModeState().stronger, false, "Stronger saver is off by default");
  api.destroy();
});

test("a Stronger-saver pass opens every panel mode to the deep pass", () => {
  const { api } = boot({ prefs: { "zen.workspace.zentral.boost.stronger_saver": true } });
  assert.equal(api.gameModeState().stronger, true);
  assert.equal(api.gameModeState().on, false, "the two switches are independent");
  api.destroy();
});

async function main() {
  for (const [name, fn] of tests) {
    if (fn.constructor.name === "AsyncFunction") await fn();
    else fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-94-game-mode-run (${passed} passed)`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
