"use strict";
/* G8 — Game Mode owns ONE plan-driven unload pass, its settle clean and its late clean.
 *
 * RED on the pre-G8 tree: Game Mode called runLevel2() + optional strongerSaverSleep(), had no second lightClean(),
 * no 30 s one-shot timer, no final freed report, and the limiter/startup trim/manual Level 2 were not gated.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const MB = 1_000_000;

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const BUNDLE_SRC = read("additional/boost/ZentralBoost.standalone.uc.js");
const PARKING_ATTR = "zentral-boost-parking";

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const plain = (value) => JSON.parse(JSON.stringify(value));
const microtasks = async (count = 8) => {
  for (let i = 0; i < count; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function loadPolicy() {
  const w = {};
  w.window = w;
  vm.runInNewContext(POLICY_SRC, { window: w, globalThis: w, console, URL });
  return w.ZentralTabPolicy;
}
const policy = loadPolicy();

function makeTab(spec = {}) {
  const attrs = new Map(spec.attrs || []);
  const tab = {
    label: spec.label || spec.url || "tab",
    url: spec.url || "https://example.com/",
    lastAccessed: spec.lastAccessed || 0,
    pinned: Boolean(spec.pinned),
    hidden: false,
    closing: false,
    isConnected: spec.connected !== false,
    linkedPanel: spec.pending ? null : "panel-" + Math.random(),
    soundPlaying: Boolean(spec.soundPlaying),
    _sharingState: null,
    userContextId: spec.userContextId,
    linkedBrowser: {
      currentURI: { spec: spec.url || "https://example.com/" },
      isPictureInPicture: false,
      audioPlaybackActive: false,
      isRemoteBrowser: true,
      docShellIsActive: true,
      renderLayers: true,
    },
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value = "") => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
    matches: () => false,
    remove() { tab.isConnected = false; },
    _attrs: attrs,
  };
  if (spec.userContextId != null) attrs.set("usercontextid", String(spec.userContextId));
  return tab;
}

function makePanelBrowser(appId) {
  return {
    _bgalazkaAppId: appId,
    isConnected: true,
    audioPlaying: false,
    docShellIsActive: true,
    renderLayers: true,
    isRemoteBrowser: true,
  };
}

function makeRecord(appId, { mode = "live", pinned = true } = {}) {
  const tab = makeTab({ url: `https://${appId}.example/`, label: appId, pinned, lastAccessed: 10 });
  return {
    app: { id: appId, name: appId },
    tab,
    browser: makePanelBrowser(appId),
    backgroundMode: mode,
  };
}

function bootBoost({ tabs = [], records = [], prefs = {}, refuseUnload = false } = {}) {
  const principal = { system: true };
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    ...prefs,
  }));
  const timers = new Map();
  let timerId = 0;
  let registration = null;
  let selected = tabs[0] || null;
  const addTabCalls = [];
  const removeTabCalls = [];
  const unloadCalls = [];
  const closeAppCalls = [];
  const minimizeCalls = [];
  const allTabs = [...tabs];
  const appBrowsers = new Map(records.map((r) => [r.app.id, r.browser]));
  const essentialPanels = new Map(records.map((r) => [r.app.id, r]));
  const gBrowser = {
    tabs: allTabs,
    get selectedTab() { return selected; },
    set selectedTab(tab) { selected = tab; },
    get selectedBrowser() { return selected?.linkedBrowser || null; },
    async explicitUnloadTabs(list) {
      unloadCalls.push(...list);
      if (refuseUnload) return false;
      for (const tab of list) {
        tab.setAttribute("pending", "true");
        tab.linkedPanel = null;
      }
      return true;
    },
    addTab(url, options) {
      addTabCalls.push({ url, options });
      const tab = makeTab({ url, label: "Boost parking", lastAccessed: Date.now() });
      tab.setAttribute(PARKING_ATTR, "true");
      allTabs.push(tab);
      return tab;
    },
    removeTab(tab, options) {
      removeTabCalls.push({ tab, options });
      const index = allTabs.indexOf(tab);
      if (index >= 0) allTabs.splice(index, 1);
      tab.remove?.();
    },
  };
  const win = {
    gBrowser,
    Services: {
      prefs: {
        getBoolPref: (k, d) => (store.has(k) ? Boolean(store.get(k)) : d),
        getStringPref: (k, d) => (store.has(k) ? String(store.get(k)) : d),
        getIntPref: (k, d) => (store.has(k) ? Number(store.get(k)) : d),
        setBoolPref: (k, v) => store.set(k, v),
        setStringPref: (k, v) => store.set(k, v),
        prefHasUserValue: (k) => store.has(k),
        addObserver() {}, removeObserver() {},
      },
      appinfo: { OS: "Linux" },
      obs: { addObserver() {}, removeObserver() {} },
      scriptSecurityManager: { getSystemPrincipal: () => principal },
    },
    Cc: {
      "@mozilla.org/memory-reporter-manager;1": {
        getService: () => ({
          minimizeMemoryUsage(cb) {
            minimizeCalls.push(Date.now());
            cb?.run?.();
          },
        }),
      },
    },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: {
      getTabState: (t) => JSON.stringify({ entries: [{ url: t.linkedBrowser?.currentURI?.spec || "" }], index: 1 }),
    },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback: () => 1,
    cancelIdleCallback() {},
    addEventListener() {}, removeEventListener() {},
    console: { warn() {}, log() {}, error() {} },
    ZentralRuntime: { register: (def) => { registration = def; } },
  };
  win.window = win;
  win.globalThis = win;
  win.Zentral = {
    Apps: {
      appBrowsers,
      closeApp(appId) {
        closeAppCalls.push(appId);
        const browser = appBrowsers.get(appId);
        if (browser) browser.isConnected = false;
        appBrowsers.delete(appId);
      },
    },
    Panels: {
      essentialPanels,
      getAllAppBrowsers: () => [...appBrowsers.values()],
      loadEssentialInBackground: () => true,
      syncAppPanelBrowserActivity() {},
      saveEssentialSettings() {},
    },
  };
  const procInfo = () => {
    // Gecko frees late: the first light clean is still at 9 GB, the settle clean reports 6 GB, and only the
    // one-shot 30 s clean reports the final 5 GB / one parent process. These are on-demand reads, never a poll.
    if (minimizeCalls.length >= 3) return { memory: 5000 * MB, children: [] };
    if (minimizeCalls.length >= 2) return { memory: 5000 * MB, children: [{ memory: 1000 * MB }] };
    return { memory: 8000 * MB, children: [{ memory: 500 * MB }, { memory: 500 * MB }] };
  };
  const context = vm.createContext({
    ...win,
    ChromeUtils: {
      requestProcInfo: procInfo,
      forceGC() {}, forceCC() {},
    },
    Cc: win.Cc, Ci: win.Ci, console: win.console,
    URL, Promise, Set, Map, WeakMap, WeakSet, Array, Object, Number, Math, String,
    Symbol, Error, TypeError, Date, JSON, globalThis: win,
  });
  win.ZentralTabPolicy = policy;
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  registration.init();
  const api = win.ZentralBoost;
  return {
    api, win, gBrowser, principal, allTabs, store, timers,
    addTabCalls, removeTabCalls, unloadCalls, closeAppCalls, minimizeCalls,
    appBrowsers,
    get selected() { return selected; },
    set selected(tab) { gBrowser.selectedTab = tab; },
    destroy: () => api.destroy(),
    async flushTimers(ms = 0, rounds = 10) {
      for (let round = 0; round < rounds; round++) {
        const due = [...timers].filter(([, t]) => ms == null || t.ms === ms);
        for (const [id, t] of due) {
          timers.delete(id);
          t.fn();
        }
        await microtasks(8);
      }
    },
  };
}

function gameFixture(overrides = {}) {
  const selected = makeTab({ url: "https://selected.example/", label: "selected", lastAccessed: 1 });
  const background = makeTab({ url: "https://background.example/", label: "background", lastAccessed: 2 });
  const record = makeRecord("whatsapp", { mode: "live" });
  const h = bootBoost({
    tabs: [selected, background, record.tab],
    records: [record],
    ...overrides,
  });
  return { h, selected, background, record };
}

test("G8 ships one plan-driven pass in both Boost sources, without a second generic saver path", () => {
  assert.match(BOOST_SRC, /const GAME_MODE_LATE_CLEAN_MS = 30000;/);
  assert.match(BOOST_SRC, /async function runGameModePass\(/);
  assert.match(BOOST_SRC, /await sleepPanelRecord\(record, ctx\)/);
  assert.match(BOOST_SRC, /if \(gameMode\.on\) return gameModeState\(\);/);
  assert.match(BOOST_SRC, /freedMB: gameMode\.finalFreedMB/);
  assert.doesNotMatch(BOOST_SRC, /strongerSaverSleep/);
  assert.doesNotMatch(BOOST_SRC, /setInterval\(/);
  assert.match(BUNDLE_SRC, /const GAME_MODE_LATE_CLEAN_MS = 30000;/);
  assert.match(BUNDLE_SRC, /function runGameModePass\(/);
  assert.doesNotMatch(BUNDLE_SRC, /strongerSaverSleep/);
});

test("Game Mode sleeps the whole plan through sleepPanelRecord and refuses a parallel manual Level 2", async () => {
  const { h, selected, background, record } = gameFixture();
  const state = h.api.setGameMode(true);
  assert.equal(state.on, true);
  assert.equal(state.cleanup.firstClean, 0, "the pass waits for G4's deferred parking door");
  assert.equal(h.addTabCalls.length, 1, "G4 parks the selected tab once, before the plan-driven pass");

  await h.flushTimers(0);
  assert.equal(h.api.gameModeState().cleanup.firstClean, 1, "the pass starts with the shared light-clean action list");
  assert.equal(h.addTabCalls[0].url, "about:blank");
  assert.ok(h.unloadCalls.includes(selected), "the deferred parking door unloads the original selected tab");
  assert.ok(h.unloadCalls.includes(background), "the planned ordinary tab is unloaded");
  assert.ok(h.unloadCalls.includes(record.tab), "the planned live panel record is unloaded through the G1 door");
  assert.ok(h.closeAppCalls.includes("whatsapp"), "sleepPanelRecord closes the panel's own app browser too");
  assert.equal(h.unloadCalls.filter((t) => t === record.tab).length, 1, "no second generic sweep unloads it again");
<<<<<<< HEAD
  assert.deepEqual(plain(h.api.gameModeState().unloaded), { tabs: 2, panels: 1 });
=======
  assert.deepEqual(plain(h.api.gameModeState().unloaded), { tabs: 3, panels: 1 },
    "R1 counts the record tab as a tab and its panel browser as an app");
>>>>>>> 3e6d7d32ec15c70a605d41b01dd18c88b7eb08db
  assert.equal(h.api.gameModeState().cleanup.reason, "settling");
  assert.equal(h.api.gameModeState().cleanup.settleArmed, true);
  assert.equal(h.minimizeCalls.length, 1, "the first lightClean() has run; the second waits for the settle");

  const before = h.minimizeCalls.length;
  const manual = await h.api.runLevel2();
  assert.equal(manual.on, true, "manual Level 2 returns Game Mode state, not a parallel pass result");
  assert.equal(manual.cleanup.reason, "settling");
  assert.equal(h.minimizeCalls.length, before, "manual Level 2 did not run lightClean()");
  assert.equal(h.unloadCalls.filter((t) => t === record.tab).length, 1, "manual Level 2 unloaded nothing");
  await h.flushTimers(3000);
  await h.flushTimers(30000);
  h.api.setGameMode(false);
  await h.flushTimers(0);
  h.destroy();
});

test("a beforeunload refusal is reported and never force-closed", async () => {
  const { h, record } = gameFixture({
    prefs: { "zen.workspace.zentral.boost.game_park_selected": false },
    refuseUnload: true,
  });
  h.api.setGameMode(true);
  await h.flushTimers(0);
  assert.equal(h.removeTabCalls.length, 0, "no tab is force-closed after a refusal");
  assert.ok(h.closeAppCalls.includes("whatsapp"), "the public panel unload door still closed the app browser");
  const state = plain(h.api.gameModeState());
  assert.equal(state.unloaded.tabs, 0, "a refused ordinary tab is not counted as slept");
  assert.ok(state.kept.some((item) => item.reason === "refused"), "the refusal is a kept reason, not a silent success");
  assert.equal(record.tab.hasAttribute("pending"), false, "the record tab stayed loaded");
  await h.flushTimers(3000);
  await h.flushTimers(30000);
  h.api.setGameMode(false);
  h.destroy();
});

test("the settle clean and ONE 30 s one-shot clean report the final freed value", async () => {
  const { h } = gameFixture({ prefs: { "zen.workspace.zentral.boost.game_park_selected": false } });
  h.api.setGameMode(true);
  await h.flushTimers(0);
  let state = plain(h.api.gameModeState());
  assert.equal(state.beforeMB, 9000);
  assert.equal(state.freedMB, null, "no fake immediate freed number");
  assert.equal(state.cleanup.secondClean, 0);
  assert.equal(state.cleanup.lateArmed, false);

  await h.flushTimers(3000);
  state = plain(h.api.gameModeState());
  assert.equal(h.minimizeCalls.length, 2, "exactly one second lightClean() ran after the existing settle");
  assert.equal(state.cleanup.secondClean, 1);
  assert.equal(state.cleanup.lateArmed, true, "one 30 s one-shot timer, not a chain or interval");
  assert.equal(state.freedMB, 3000);
  assert.equal(state.finalMB, 6000);
  assert.equal(state.processesBefore, 3);
  assert.equal(state.processesAfter, 2);
  assert.equal(state.cleanup.lateClean, 0);
  assert.ok([...h.timers.values()].some((t) => t.ms === 30000));

  await h.flushTimers(30000);
  state = plain(h.api.gameModeState());
  assert.equal(h.minimizeCalls.length, 3, "the late one-shot lightClean() ran exactly once");
  assert.equal(state.cleanup.lateClean, 1);
  assert.equal(state.cleanup.active, false);
  assert.equal(state.cleanup.reason, "complete");
  assert.equal(state.finalMB, 5000);
  assert.equal(state.freedMB, 4000, "gameModeState() reports the FINAL freed value");
  assert.equal(state.finalFreedMB, 4000);
  assert.equal(state.processesAfter, 1);
  assert.equal(state.afterMB, 5000);
  assert.equal([...h.timers.values()].filter((t) => t.ms === 30000).length, 0, "no second late timer");
  await h.flushTimers(30000);
  assert.equal(h.minimizeCalls.length, 3, "flushing again does not produce a fourth clean");
  h.api.setGameMode(false);
  h.destroy();
});

test("Game Mode OFF before the settle cancels both one-shot cleans", async () => {
  const { h } = gameFixture({ prefs: { "zen.workspace.zentral.boost.game_park_selected": false } });
  h.api.setGameMode(true);
  await h.flushTimers(0);
  assert.equal(h.minimizeCalls.length, 1);
  const off = h.api.setGameMode(false);
  assert.equal(off.on, false);
  const state = plain(h.api.gameModeState());
  assert.equal(state.cleanup.reason, "game-mode-off");
  assert.equal(state.cleanup.active, false);
  assert.equal(state.cleanup.secondClean, 0);
  assert.equal(state.cleanup.lateClean, 0);
  assert.equal(state.freedMB, null);
  assert.equal([...h.timers.values()].filter((t) => t.ms === 3000 || t.ms === 30000).length, 0);
  await h.flushTimers(null);
  assert.equal(h.minimizeCalls.length, 1, "neither the settle nor the late clean runs after exit");
  h.destroy();
});

test("destroy() cancels the Game Mode cleanup chain and leaves no owned timer", async () => {
  const { h } = gameFixture({ prefs: { "zen.workspace.zentral.boost.game_park_selected": false } });
  h.api.setGameMode(true);
  await h.flushTimers(0);
  assert.ok([...h.timers.values()].some((t) => t.ms === 3000));
  h.destroy();
  const state = plain(h.api.gameModeState());
  assert.equal(state.cleanup.reason, "destroy");
  assert.equal(state.cleanup.active, false);
  assert.equal(h.timers.size, 0, "scope-owned timers are torn down");
  await h.flushTimers(null);
  assert.equal(h.minimizeCalls.length, 1, "no clean survives destroy");
});

test("the RAM limiter is idle in Game Mode and re-arms only on exit", async () => {
  const { h } = gameFixture({
    prefs: {
      "zen.workspace.zentral.boost.game_park_selected": false,
      "zen.workspace.zentral.boost.limit_enabled": true,
      "zen.workspace.zentral.boost.limit_mb": 1000,
      "zen.workspace.zentral.boost.limit_mode": "hard",
    },
  });
  assert.equal(h.api.limiterState().armed, true, "an enabled limiter has its normal one-shot timer before Game Mode");
  h.api.setGameMode(true);
  await h.flushTimers(0);
  const onState = h.api.limiterState();
  assert.equal(onState.armed, false, "Game Mode ON clears the limiter timer");
  assert.equal(onState.lastReason, "game-mode");
  assert.equal([...h.timers.values()].filter((t) => t.ms === 60000).length, 0);
  const before = h.unloadCalls.length;
  await h.flushTimers(60000);
  assert.equal(h.api.limiterState().runs, 0, "the limiter tick did not run a second pass");
  assert.equal(h.unloadCalls.length, before);

  h.api.setGameMode(false);
  await h.flushTimers(0);
  assert.equal(h.api.limiterState().armed, true, "the enabled limiter resumes its normal cadence on exit");
  assert.ok([...h.timers.values()].some((t) => t.ms === 60000));
  h.destroy();
});

test("a startup that begins in Game Mode skips the one-shot startup trim", async () => {
  const trimmed = bootBoost({ prefs: { "zen.workspace.zentral.boost.startup_trim": true } });
  assert.ok([...trimmed.timers.values()].some((t) => t.ms === 90000), "without Game Mode, the quiet trim is armed");
  trimmed.destroy();

  const { h } = gameFixture({
    prefs: {
      "zen.workspace.zentral.boost.startup_trim": true,
      "zen.workspace.zentral.boost.game_mode": true,
      "zen.workspace.zentral.boost.game_park_selected": false,
    },
  });
  await h.flushTimers(0);
  assert.equal(h.api.state().trimDone, true, "the one-time startup trim is skipped, not deferred behind the game");
  assert.equal(h.api.state().trimArmed, false);
  assert.equal([...h.timers.values()].filter((t) => t.ms === 90000 || t.ms === 360000).length, 0);
  assert.equal(h.minimizeCalls.length, 1, "only the Game Mode pass ran its first lightClean()");
  await h.flushTimers(3000);
  await h.flushTimers(30000);
  h.api.setGameMode(false);
  h.destroy();
});

test("outside Game Mode, stronger_saver stays the Level 2 all-panel-modes switch", async () => {
  const plainRecord = makeRecord("messenger", { mode: "live" });
  const quiet = makeTab({ url: "https://quiet.example/", label: "quiet", lastAccessed: 1 });
  const plainHarness = bootBoost({ tabs: [quiet, plainRecord.tab], records: [plainRecord] });
  const plainPending = plainHarness.api.runLevel2();
  await plainHarness.flushTimers(3000);
  await plainPending;
  assert.equal(plainHarness.closeAppCalls.includes("messenger"), false, "default Level 2 leaves a live record loaded");
  plainHarness.destroy();

  const strongerRecord = makeRecord("messenger", { mode: "live" });
  const strongerTab = makeTab({ url: "https://stronger.example/", label: "stronger", lastAccessed: 1 });
  const stronger = bootBoost({
    tabs: [strongerTab, strongerRecord.tab],
    records: [strongerRecord],
    prefs: { "zen.workspace.zentral.boost.stronger_saver": true },
  });
  const strongerPending = stronger.api.runLevel2();
  await stronger.flushTimers(3000);
  const result = await strongerPending;
  assert.equal(result.unloaded.panels, 1);
  assert.ok(stronger.closeAppCalls.includes("messenger"), "the pref opens every panel mode to Level 2 outside Game Mode");
  assert.ok(stronger.unloadCalls.includes(strongerRecord.tab));
  stronger.destroy();
});

async function main() {
  for (const [name, fn] of tests) {
    if (fn.constructor.name === "AsyncFunction") await fn();
    else fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\n${passed}/${tests.length} G8 tests passed`);
}
main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
