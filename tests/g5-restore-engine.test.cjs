"use strict";
/* G5 — staggered, ordered Restore. RED on the pre-G5 tree: restoreSession(),
 * the four restore prefs and the background `reload()` wake did not exist. The
 * fake browser keeps load listeners pending until a test emits the event, so
 * the 2-slot concurrency cap and the 8 s timeout are real assertions.
 */
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const MB = 1_000_000;

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const STARTUP_SRC = read("additional/tabs/startup/ZentralStartup.uc.js");
const BUNDLE_SRC = read("additional/boost/ZentralBoost.standalone.uc.js");
const SETTINGS = json("additional/boost/settings.json");
const ROOT_PREFS = json("preferences.json");
const STANDALONE_PREFS = json("additional/boost/preferences.json");
const LAYOUT = json("extension/settings/layout.json");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadPolicy() {
  const w = {};
  w.window = w;
  vm.runInNewContext(POLICY_SRC, { window: w, globalThis: w, console, URL });
  return w.ZentralTabPolicy;
}
const policy = loadPolicy();

function makeBrowser(spec = {}) {
  const listeners = new Map();
  const browser = {
    currentURI: { spec: spec.url || "https://example.com/" },
    isPictureInPicture: false,
    audioPlaybackActive: false,
    isRemoteBrowser: true,
    docShellIsActive: true,
    renderLayers: true,
    isConnected: true,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    get listenerCount() { return [...listeners.values()].reduce((n, set) => n + set.size, 0); },
    emitLoad() {
      for (const set of [listeners.get("load"), listeners.get("DOMContentLoaded")]) {
        for (const fn of [...(set || [])]) fn({ type: "load" });
      }
    },
  };
  browser.reload = () => { spec.onReload?.(browser); };
  return browser;
}
function makeTab(spec = {}) {
  const attrs = new Map(spec.attrs || []);
  const browser = spec.browser || makeBrowser({ url: spec.url, onReload: (b) => spec.onReload?.(b) });
  const tab = {
    label: spec.label || spec.url || "tab",
    lastAccessed: spec.lastAccessed || 0,
    pinned: Boolean(spec.pinned),
    hidden: false,
    closing: false,
    isConnected: spec.connected !== false,
    linkedPanel: spec.pending ? null : "panel-" + Math.random(),
    soundPlaying: Boolean(spec.soundPlaying),
    _sharingState: null,
    linkedBrowser: browser,
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value = "") => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
    matches: () => false,
    remove() { tab.isConnected = false; },
    _attrs: attrs,
  };
  return tab;
}
function markLoaded(tab) {
  tab.linkedPanel = "panel-restored";
  for (const name of ["pending", "discarded", "zen-dormant"]) tab.removeAttribute(name);
}
function makeRecord(id, mode, spec = {}) {
  return {
    app: { id, name: id, url: "https://example.com/" },
    tab: makeTab({ pinned: true, url: `https://${id}.example/`, label: id, ...spec }),
    backgroundMode: mode,
  };
}

function bootBoost({
  tabs = [], records = [], prefs = {}, browsers = new Map(),
} = {}) {
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
  const allTabs = [...tabs];
  const addTabCalls = [];
  const removeTabCalls = [];
  const unloadCalls = [];
  const reloadCalls = [];
  const wakeCalls = [];
  const selectionWrites = [];
  const appBrowsers = new Map(browsers);
  const gBrowser = {
    tabs: allTabs,
    get selectedTab() { return selected; },
    set selectedTab(tab) { selectionWrites.push(tab); selected = tab; },
    get selectedBrowser() { return selected?.linkedBrowser || null; },
    async explicitUnloadTabs(list) {
      unloadCalls.push(...list);
      for (const tab of list) { tab.setAttribute("pending", "true"); tab.linkedPanel = null; }
      return true;
    },
    addTab(url, options) {
      addTabCalls.push({ url, options });
      const tab = makeTab({ url, label: "Boost parking", lastAccessed: Date.now() });
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
    Cc: { "@mozilla.org/memory-reporter-manager;1": { getService: () => ({ minimizeMemoryUsage: (cb) => cb?.run?.() }) } },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: { getTabState: (t) => JSON.stringify({ entries: [{ url: t.linkedBrowser?.currentURI?.spec || "" }], index: 1 }) },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback: () => 1,
    addEventListener() {}, removeEventListener() {},
    console: { warn() {}, log() {}, error() {} },
    ZentralRuntime: { register: (def) => { registration = def; } },
  };
  win.window = win;
  win.globalThis = win;
  win.Zentral = {
    Apps: {
      appBrowsers,
      getAppBrowser: (id) => appBrowsers.get(id) || null,
      closeApp(id) {
        const browser = appBrowsers.get(id);
        if (browser) browser.isConnected = false;
        appBrowsers.delete(id);
      },
    },
    Panels: {
      essentialPanels: new Map(records.map((r) => [r.app.id, r])),
      getAllAppBrowsers: () => [...appBrowsers.values()],
      loadEssentialInBackground(record, automatic) {
        wakeCalls.push({ id: record?.app?.id || record?.appId, automatic });
        const browser = makeBrowser({ url: record?.app?.url });
        browser._bgalazkaAppId = record?.app?.id || record?.appId;
        appBrowsers.set(browser._bgalazkaAppId, browser);
        return undefined;
      },
      saveEssentialSettings() {},
    },
  };
  // Every tab reload is recorded, but load events are emitted only when a test says so.
  for (const tab of allTabs) {
    const original = tab.linkedBrowser.reload;
    tab.linkedBrowser.reload = () => { reloadCalls.push(tab); original?.(); };
  }
  const context = vm.createContext({
    ...win,
    ChromeUtils: {
      requestProcInfo: () => ({ memory: 900 * MB, children: [{ memory: 10 * MB }] }),
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
    api, win, gBrowser, store, allTabs, appBrowsers,
    addTabCalls, removeTabCalls, unloadCalls, reloadCalls, wakeCalls, selectionWrites,
    get selected() { return selected; },
    set selected(tab) { gBrowser.selectedTab = tab; },
    destroy: () => api.destroy(),
    emitLoad(tab) { tab.linkedBrowser.emitLoad(); },
    async flushTimers(ms = 0, rounds = 1) {
      for (let round = 0; round < rounds; round++) {
        const due = [...timers].filter(([, t]) => ms == null || t.ms === ms);
        for (const [id, t] of due) { timers.delete(id); t.fn(); }
        for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
  };
}

function browserFor(id) {
  const browser = makeBrowser({ url: `https://${id}.example/` });
  browser._bgalazkaAppId = id;
  return browser;
}

async function seedSession({
  tabCount = 4, modes = ["live", "asleep-allowed"], prefs = {}, staggerMs = null,
} = {}) {
  const selected = makeTab({ url: "https://selected.example/", label: "selected", lastAccessed: 900 });
  const ordinary = Array.from({ length: tabCount }, (_, i) => makeTab({
    url: `https://tab-${i}.example/`, label: `tab-${i}`, lastAccessed: i + 1,
  }));
  const records = modes.map((mode, i) => makeRecord(mode === "live" ? "live-app" : `app-${i}`, mode));
  const browsers = new Map(records.map((r) => [r.app.id, browserFor(r.app.id)]));
  const h = bootBoost({
    tabs: [selected, ...ordinary, ...records.map((r) => r.tab)],
    records, prefs, browsers,
  });
  const pending = h.api.runLevel2({ allowModes: ["live", "throttled", "asleep-allowed"] });
  await h.flushTimers(3000, 5);
  await pending;
  const parked = h.api.parkSelected();
  assert.equal(parked.created, true, "the selected tab was parked for the snapshot");
  await h.flushTimers(0, 3);
  if (staggerMs != null) h.store.set("zen.workspace.zentral.boost.game_restore_stagger_ms", staggerMs);
  return { h, selected, ordinary, records };
}

test("the engine, the copied Startup wake and the standalone bundle are present", () => {
  assert.match(BOOST_SRC, /function restoreSession\(/);
  assert.match(BUNDLE_SRC, /function restoreSession\(/);
  assert.match(BOOST_SRC, /const RESTORE_MAX_LOADING = 2/);
  assert.match(BOOST_SRC, /const RESTORE_LOAD_TIMEOUT_MS = 8000/);
  assert.match(BOOST_SRC, /browser\.reload\(\)/);
  assert.match(STARTUP_SRC, /browser\.reload\(\)/, "Startup's own helper is unchanged");
  assert.doesNotMatch(BOOST_SRC, /setInterval\(/);
  const h = bootBoost();
  assert.equal(typeof h.api.restoreSession, "function");
  assert.equal(typeof h.api.restoreState, "function");
  assert.equal(typeof h.api.cancelRestore, "function");
  h.destroy();
});

test("all four restore prefs are owned, placed, generated and covered by G11", () => {
  const keys = [
    "zen.workspace.zentral.boost.game_restore_tabs",
    "zen.workspace.zentral.boost.game_restore_recent_n",
    "zen.workspace.zentral.boost.game_restore_stagger_ms",
    "zen.workspace.zentral.boost.game_restore_on_exit",
  ];
  for (const key of keys) {
    const item = SETTINGS.schema.find((x) => x.property === key);
    assert.ok(item, `${key} is owned by Boost`);
    assert.equal(SETTINGS.settings[key].section, "Game Mode");
    assert.equal(SETTINGS.settings[key].owner, "boost");
    assert.ok(LAYOUT.order.includes(key), `${key} is in layout.order`);
    // Numeric settings are rendered through the generated `_text` twin (G11); string/dropdown fields keep
    // their own property in the generated preference files.
    const generated = item.numeric ? `${key}_text` : key;
    assert.ok(ROOT_PREFS.some((p) => p.property === generated), `${generated} is in root preferences.json`);
    assert.ok(STANDALONE_PREFS.some((p) => p.property === generated), `${generated} is in standalone preferences.json`);
  }
  assert.equal(SETTINGS.schema.find((x) => x.property === keys[0]).defaultValue, "all");
  assert.equal(SETTINGS.schema.find((x) => x.property === keys[1]).defaultValue, 8);
  assert.equal(SETTINGS.schema.find((x) => x.property === keys[2]).defaultValue, 700);
  assert.equal(SETTINGS.schema.find((x) => x.property === keys[3]).defaultValue, "ask");
  assert.equal(SETTINGS.schema.find((x) => x.property === "zen.workspace.zentral.boost.unload_pinned").defaultValue, false);
  assert.equal(SETTINGS.schema.find((x) => x.property === "zen.workspace.zentral.boost.stronger_saver").defaultValue, false);
  for (const key of [keys[1], keys[2]]) {
    assert.ok(ROOT_PREFS.some((p) => p.property === `${key}_text`), `${key}_text twin is generated`);
  }
  const out = cp.spawnSync(process.execPath, [path.join(ROOT, "tools/check-settings-consistency.cjs")],
    { cwd: ROOT, encoding: "utf8" });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /catalog checks passed/);
});

test("no work when the snapshot is empty", () => {
  const h = bootBoost();
  const result = h.api.restoreSession();
  assert.equal(result.started, false);
  assert.equal(result.panels, 0);
  assert.equal(result.tabs, 0);
  const state = plain(h.api.restoreState());
  assert.equal(state.active, false);
  assert.equal(state.timer, false);
  assert.deepEqual(state.log, ["empty"]);
  h.destroy();
});

test("selection, live-first panels and newest-first tabs are restored in order, one per stagger", async () => {
  const { h, ordinary } = await seedSession({ tabCount: 4 });
  const result = h.api.restoreSession();
  assert.equal(result.started, true);
  assert.equal(result.profile, "all");
  assert.equal(result.selection, true);
  assert.equal(plain(h.api.restoreState()).staggerMs, 700);
  assert.equal(h.reloadCalls.length, 0, "nothing is reloaded before the first 0 ms tick");
  await h.flushTimers(0, 1);
  assert.deepEqual(plain(h.api.restoreState().log).slice(0, 2), ["select", "panel:live-app"]);
  assert.equal(h.wakeCalls.length, 1, "one panel wake per 0 ms tick");
  assert.equal(h.reloadCalls.length, 0);
  await h.flushTimers(700, 1);
  assert.equal(h.wakeCalls.length, 2, "the second panel starts on the next 700 ms tick");
  await h.flushTimers(700, 1);
  assert.equal(h.reloadCalls.length, 1, "then the newest tab starts");
  await h.flushTimers(700, 1);
  assert.equal(h.reloadCalls.length, 2, "and one more tab per stagger");
  // The first two tab loads stay pending until a load event; freeing one slot reveals the next newest tab.
  h.emitLoad(h.reloadCalls[0]);
  await h.flushTimers(700, 1);
  const log = plain(h.api.restoreState().log).filter((x) => x.startsWith("panel:") || x.startsWith("tab:"));
  assert.deepEqual(log.slice(0, 2), ["panel:live-app", "panel:app-1"]);
  assert.equal(log[2], "tab:https://selected.example/", "the parked original is newest");
  assert.equal(log[3], `tab:https://tab-3.example/`);
  assert.equal(log[4], `tab:https://tab-2.example/`);
  assert.equal(ordinary[3].label, "tab-3");
  h.destroy();
});

test("at most two items load at once; load events and the 8 s timeout free a slot", async () => {
  const { h } = await seedSession({ tabCount: 5 });
  h.api.restoreSession();
  await h.flushTimers(0, 1); // selection + first panel
  await h.flushTimers(700, 1); // second panel
  await h.flushTimers(700, 1); // tab 1
  await h.flushTimers(700, 1); // tab 2
  await h.flushTimers(700, 1); // cap reached: no third tab yet
  assert.equal(plain(h.api.restoreState()).loading, 2);
  assert.equal(h.reloadCalls.length, 2, "the third tab waits for a slot");
  h.emitLoad(h.reloadCalls[0]);
  assert.equal(plain(h.api.restoreState()).loading, 1);
  await h.flushTimers(700, 1);
  assert.equal(h.reloadCalls.length, 3, "a load event lets the next tab start");
  await h.flushTimers(8000, 1);
  assert.equal(plain(h.api.restoreState()).items, 0, "the 8 s timeout clears every pending load listener");
  assert.ok(h.reloadCalls.length >= 3);
  h.destroy();
});

test("recent, panels and none profiles read the prefs live", async () => {
  const recent = await seedSession({ tabCount: 5, prefs: {
    "zen.workspace.zentral.boost.game_restore_tabs": "recent",
    "zen.workspace.zentral.boost.game_restore_recent_n": 2,
  } });
  const r = recent.h.api.restoreSession();
  assert.equal(r.profile, "recent");
  assert.equal(r.tabTasks, 2);
  assert.equal(plain(recent.h.api.restoreState()).profile, "recent");
  recent.h.destroy();

  const panels = await seedSession({ tabCount: 3, prefs: {
    "zen.workspace.zentral.boost.game_restore_tabs": "panels",
  } });
  const p = panels.h.api.restoreSession();
  assert.equal(p.profile, "panels");
  assert.equal(p.tabTasks, 0);
  assert.ok(p.panels >= 1);
  panels.h.destroy();

  const none = await seedSession({ tabCount: 3, prefs: {
    "zen.workspace.zentral.boost.game_restore_tabs": "none",
  } });
  const n = none.h.api.restoreSession();
  assert.equal(n.profile, "none");
  assert.equal(n.panels, 0);
  assert.equal(n.tabTasks, 0);
  assert.equal(none.h.wakeCalls.length, 0);
  assert.equal(none.h.reloadCalls.length, 0);
  await none.h.flushTimers(0, 1);
  assert.deepEqual(plain(none.h.api.restoreState().log), ["select", "done"]);
  none.h.destroy();
});

test("a user-loaded tab or panel is skipped instead of reloaded twice", async () => {
  const { h, ordinary } = await seedSession({ tabCount: 1 });
  markLoaded(ordinary[0]);
  // Simulate a click on the panel tile recreating its browser before Restore.
  const r = h.api.previewGameMode();
  assert.ok(r, "the dry run still works");
  h.appBrowsers.set("live-app", browserFor("live-app"));
  h.api.restoreSession();
  await h.flushTimers(0, 1);
  await h.flushTimers(700, 1);
  await h.flushTimers(700, 1);
  const log = plain(h.api.restoreState().log);
  assert.ok(log.includes("skip:tab:https://tab-0.example/"), "the loaded tab was skipped");
  assert.ok(log.includes("skip:panel:live-app"), "the loaded panel was skipped");
  assert.equal(h.reloadCalls.includes(ordinary[0]), false);
  assert.equal(h.wakeCalls.length, 1, "only the other panel was woken");
  h.destroy();
});

test("destroy cancels the chain and removes owned load listeners", async () => {
  const { h } = await seedSession({ tabCount: 2 });
  h.api.restoreSession();
  await h.flushTimers(0, 1);
  await h.flushTimers(700, 1);
  await h.flushTimers(700, 1); // first tab is now loading with listeners
  const before = h.reloadCalls.length;
  assert.equal(h.reloadCalls[0]?.linkedBrowser.listenerCount, 2);
  h.api.destroy();
  const state = plain(h.api.restoreState());
  assert.equal(state.active, false);
  assert.equal(state.cancelled, true);
  assert.equal(state.reason, "destroy");
  assert.equal(state.items, 0);
  assert.equal(state.timer, false);
  assert.equal(h.reloadCalls[0]?.linkedBrowser.listenerCount, 0);
  await h.flushTimers(700, 2);
  assert.equal(h.reloadCalls.length, before, "no queued item started after teardown");
});

test("a second Game Mode ON cancels a pending Restore", async () => {
  const { h } = await seedSession({ tabCount: 2 });
  h.api.restoreSession();
  await h.flushTimers(0, 1);
  h.store.set("zen.workspace.zentral.boost.game_park_selected", false); // avoid a fresh parking tab
  const before = h.reloadCalls.length;
  h.api.setGameMode(true);
  const state = plain(h.api.restoreState());
  assert.equal(state.active, false);
  assert.equal(state.cancelled, true);
  assert.equal(state.reason, "game-mode-on");
  await h.flushTimers(700, 2);
  assert.equal(h.reloadCalls.length, before, "the cancelled chain stays asleep");
  h.destroy();
});

test("game_restore_on_exit is the automatic-Restore kill switch", async () => {
  for (const [policy, shouldStart] of [["ask", false], ["always", true], ["never", false]]) {
    const selected = makeTab({ url: "https://selected.example/", label: "selected" });
    const ordinary = makeTab({ url: "https://bg.example/", label: "bg", lastAccessed: 1 });
    const h = bootBoost({
      tabs: [selected, ordinary],
      prefs: {
        "zen.workspace.zentral.boost.game_park_selected": false,
        "zen.workspace.zentral.boost.game_restore_on_exit": policy,
        "zen.workspace.zentral.boost.game_restore_tabs": "all",
      },
    });
    const pending = h.api.runLevel2();
    await h.flushTimers(3000, 5);
    await pending;
    assert.ok(h.api.sessionState().tabs >= 1, "the snapshot has a background tab");
    h.api.setGameMode(true);
    h.api.setGameMode(false);
    const state = plain(h.api.restoreState());
    assert.equal(h.api.gameModeState().restoreOnExit, policy);
    assert.equal(state.active, shouldStart, `${policy}: automatic restore`);
    if (policy === "always") assert.equal(state.profile, "all");
    h.destroy();
  }
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\ng5-restore-engine (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
