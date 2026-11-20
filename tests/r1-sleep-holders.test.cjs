"use strict";
/* R1 — record what sleepPanelRecord actually freed, per record.
 *
 * RED on the pre-R1 tree: both callers threw `how` away, counted every slept record as a PANEL and wrote only a
 * panel snapshot entry, so a page that lived in its ordinary loaded TAB was restored as a Zentral panel. This suite
 * boots the real ZentralBoost.uc.js with a fake window and asserts the holders (`panelWas`/`tabWas`), the snapshot
 * lists and the counts written by both the Game Mode pass and the deep pass.
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
  if (spec.pinned) attrs.set("pinned", "true");
  if (spec.pending) attrs.set("pending", "true");
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
      reload() {
        tab._reloaded = (tab._reloaded || 0) + 1;
        tab.linkedPanel = "panel-revived";
        attrs.delete("pending");
        return true;
      },
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

/* A record can live in its TAB, its PANEL browser, both or neither. The fixtures below are the four rows of the
 * plan's table, with real `pinned` / `zen-essential` attributes on the tab. */
function makeRecord(appId, { mode = "asleep-allowed", tabLoaded = true, panel = true, extra = {} } = {}) {
  const tab = makeTab({
    url: `https://${appId}.example/`,
    label: appId,
    pinned: true,
    attrs: [["zen-essential", "true"]],
    pending: !tabLoaded,
    lastAccessed: 10,
  });
  const record = {
    app: { id: appId, name: appId },
    tab,
    backgroundMode: mode,
    ...extra,
  };
  if (panel) record.browser = makePanelBrowser(appId);
  return record;
}

function bootBoost({ tabs = [], records = [], prefs = {} } = {}) {
  const principal = { system: true };
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    "zen.workspace.zentral.boost.game_park_selected": false,
    ...prefs,
  }));
  const timers = new Map();
  let timerId = 0;
  let registration = null;
  let selected = tabs[0] || null;
  const addTabCalls = [];
  const unloadCalls = [];
  const closeAppCalls = [];
  const wakeCalls = [];
  const minimizeCalls = [];
  const allTabs = [...tabs];
  const appBrowsers = new Map(
    records.filter((r) => r.browser).map((r) => [r.app.id, r.browser]),
  );
  const essentialPanels = new Map(records.map((r) => [r.app.id, r]));
  const gBrowser = {
    tabs: allTabs,
    get selectedTab() { return selected; },
    set selectedTab(tab) { selected = tab; },
    get selectedBrowser() { return selected?.linkedBrowser || null; },
    async explicitUnloadTabs(list) {
      unloadCalls.push(...list);
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
        getService: () => ({ minimizeMemoryUsage: (cb) => { minimizeCalls.push(Date.now()); cb?.run?.(); } }),
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
      loadEssentialInBackground: (record, automatic) => {
        wakeCalls.push({ id: record.app.id, automatic });
        if (!appBrowsers.has(record.app.id)) appBrowsers.set(record.app.id, makePanelBrowser(record.app.id));
        return true;
      },
      syncAppPanelBrowserActivity() {},
      saveEssentialSettings() {},
    },
  };
  const context = vm.createContext({
    ...win,
    ChromeUtils: {
      requestProcInfo: () => ({ memory: 6000 * MB, children: [{ memory: 400 * MB }] }),
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
    addTabCalls, unloadCalls, closeAppCalls, wakeCalls, minimizeCalls, appBrowsers,
    ctx: {
      keepPinned: false,
      videoSourceTab: null,
      selectedTab: null,
      sessionUrlFor: () => "",
      isHostTab: () => false,
    },
    destroy: () => api.destroy(),
    async flushTimers(ms = 0, rounds = 10) {
      for (let round = 0; round < rounds; round++) {
        for (const [id, t] of [...timers].filter(([, x]) => ms == null || x.ms === ms)) {
          timers.delete(id);
          t.fn();
        }
        await microtasks(8);
      }
    },
  };
}

const entries = (h) => plain(h.api.sessionEntries());

test("sleepPanelRecord reports the holders it found before it acted", async () => {
  const cases = [
    { name: "tab only", tabLoaded: true, panel: false, how: "tab", panelWas: false, tabWas: true },
    { name: "panel only", tabLoaded: false, panel: true, how: "panel", panelWas: true, tabWas: false },
    { name: "both", tabLoaded: true, panel: true, how: "both", panelWas: true, tabWas: true },
    { name: "neither", tabLoaded: false, panel: false, how: "none", panelWas: false, tabWas: false },
  ];
  for (const c of cases) {
    const record = makeRecord("app-" + c.how, c);
    const h = bootBoost({ records: [record] });
    const out = plain(await h.api.sleepPanelRecord(record, h.ctx));
    assert.equal(out.how, c.how, `${c.name}: how`);
    assert.equal(out.panelWas, c.panelWas, `${c.name}: panelWas`);
    assert.equal(out.tabWas, c.tabWas, `${c.name}: tabWas`);
    h.destroy();
  }
});

test("Game Mode: a record loaded only as a TAB writes a TAB entry and no panel entry", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const record = makeRecord("arena", { tabLoaded: true, panel: false });
  const h = bootBoost({ tabs: [selected, record.tab], records: [record] });
  h.api.setGameMode(true);
  await h.flushTimers(0);

  const snapshot = entries(h);
  assert.equal(snapshot.panels.length, 0, "a tab-only record is never a panel entry");
  assert.equal(snapshot.tabs.length, 1, "the record's tab is in the tab snapshot");
  assert.equal(snapshot.tabs[0].recordAppId, "arena");
  assert.equal(snapshot.tabs[0].wasPinned, true, "the fixture tab really carries pinned/zen-essential");
  assert.deepEqual(plain(h.api.gameModeState().unloaded), { tabs: 1, panels: 0 }, "counts follow the holder");
  assert.deepEqual(h.closeAppCalls, [], "no panel existed, so no closeApp");
  assert.equal(h.unloadCalls.length, 1);
  h.api.setGameMode(false);
  await h.flushTimers(0);
  h.destroy();
});

test("Game Mode: a record loaded only in its PANEL writes one panel entry and no tab entry", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const record = makeRecord("whatsapp", { tabLoaded: false, panel: true });
  const h = bootBoost({ tabs: [selected, record.tab], records: [record] });
  h.api.setGameMode(true);
  await h.flushTimers(0);

  const snapshot = entries(h);
  assert.equal(snapshot.panels.length, 1);
  assert.deepEqual(snapshot.panels[0].holders, { panel: true, tab: false });
  assert.equal(snapshot.panels[0].wasLoaded, true, "the back-compat boolean still says the panel was live");
  assert.equal(snapshot.tabs.length, 0, "a pending tab was not slept, so it is not in the tab snapshot");
  assert.deepEqual(plain(h.api.gameModeState().unloaded), { tabs: 0, panels: 1 });
  assert.deepEqual(h.closeAppCalls, ["whatsapp"]);
  assert.equal(h.unloadCalls.length, 0, "a pending tab is never unloaded twice");
  h.api.setGameMode(false);
  await h.flushTimers(0);
  h.destroy();
});

test("Game Mode: a record loaded in BOTH writes a panel entry with holders.tab and a tab entry", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const record = makeRecord("messenger", { tabLoaded: true, panel: true });
  const h = bootBoost({ tabs: [selected, record.tab], records: [record] });
  h.api.setGameMode(true);
  await h.flushTimers(0);

  const snapshot = entries(h);
  assert.equal(snapshot.panels.length, 1);
  assert.deepEqual(snapshot.panels[0].holders, { panel: true, tab: true });
  assert.equal(snapshot.tabs.length, 1);
  assert.equal(snapshot.tabs[0].recordAppId, "messenger");
  assert.deepEqual(plain(h.api.gameModeState().unloaded), { tabs: 1, panels: 1 });
  assert.deepEqual(h.closeAppCalls, ["messenger"]);
  assert.equal(h.unloadCalls.length, 1);
  h.api.setGameMode(false);
  await h.flushTimers(0);
  h.destroy();
});

test("Game Mode: a record with neither holder is kept and writes no entry", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const record = makeRecord("idle", { tabLoaded: false, panel: false });
  const h = bootBoost({ tabs: [selected, record.tab], records: [record] });
  h.api.setGameMode(true);
  await h.flushTimers(0);

  const snapshot = entries(h);
  assert.equal(snapshot.panels.length, 0);
  assert.equal(snapshot.tabs.length, 0);
  assert.deepEqual(plain(h.api.gameModeState().unloaded), { tabs: 0, panels: 0 });
  assert.ok(h.api.gameModeState().kept.some((entry) => entry.id === "idle"));
  h.api.setGameMode(false);
  await h.flushTimers(0);
  h.destroy();
});

test("the deep pass records a tab-only record as a tab too", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const record = makeRecord("library", { mode: "asleep-allowed", tabLoaded: true, panel: false });
  const h = bootBoost({ tabs: [selected, record.tab], records: [record] });
  // The deep pass ends with the existing 3 s Gecko settle; the fake timers own it, so start it and flush.
  const pending = h.api.runLevel2({ allowModes: ["asleep-allowed"], allowTabs: false });
  await h.flushTimers(3000);
  const result = await pending;
  assert.ok(result, "the deep pass ran");
  const snapshot = entries(h);
  assert.equal(snapshot.panels.length, 0, "no panel entry for a tab-only record");
  assert.equal(snapshot.tabs.length, 1);
  assert.equal(snapshot.tabs[0].recordAppId, "library");
  assert.equal(result.unloaded.panels, 0, "the pass does not count it as an app");
  assert.equal(result.unloaded.tabs, 1);
  h.destroy();
});

test("both sleep callers go through the one holder recorder and no longer guess wasLoaded", () => {
  assert.match(BOOST_SRC, /function recordPanelSleepHolders\(record, appId, slept, mode, extra = \{\}\)/);
  assert.match(BUNDLE_SRC, /function recordPanelSleepHolders\(record, appId, slept, mode, extra = \{\}\)/);
  assert.match(BOOST_SRC, /const counts = recordPanelSleepHolders\(record, appId, slept, modeOf\(record\)\);/);
  assert.match(BOOST_SRC, /const counts = recordPanelSleepHolders\(record, appId, slept, modeOf\(record\), \{ gameMode: true \}\);/);
  const panelLoops = BOOST_SRC.split("recordPanelSleepHolders(").slice(1);
  assert.ok(panelLoops.length >= 3, "the helper plus both callers are present");
  assert.doesNotMatch(BOOST_SRC, /const wasLoaded = Boolean\(appId && livePanelBrowser\(appId\)\)/,
    "the old pre-sleep guess is gone");
  assert.doesNotMatch(BOOST_SRC, /setInterval\(/, "no polling was added");
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed += 1;
    console.log("ok -", name);
  }
  console.log(`\n${passed}/${tests.length} R1 sleep-holder tests passed`);
})().catch((error) => {
  console.error("FAIL:", error?.message || error);
  console.error(error?.stack || "");
  process.exit(1);
});
