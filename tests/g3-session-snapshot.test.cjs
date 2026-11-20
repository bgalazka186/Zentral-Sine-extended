"use strict";
/* G3 — the session snapshot that really remembers. RED on the pre-G3 tree:
 * rememberUndone("tabs", { tab: null, ... }) threw away the one object Restore
 * needed (an unloaded tab stays in the strip), and there was no snapshot for
 * Game Mode at all. This suite boots the real Boost module in a fake window.
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

function tab(spec = {}) {
  const attrs = new Set(spec.attrs || []);
  if (spec.pinned) attrs.add("pinned");
  return {
    closing: false,
    isConnected: spec.connected !== false,
    hidden: false,
    linkedPanel: attrs.has("pending") ? null : "panel1",
    linkedBrowser: {
      currentURI: { spec: spec.url || "https://example.com/" },
      isPictureInPicture: false,
      isRemoteBrowser: true,
      docShellIsActive: true,
      renderLayers: true,
    },
    lastAccessed: spec.lastAccessed || 0,
    soundPlaying: Boolean(spec.soundPlaying),
    _sharingState: null,
    label: spec.label || spec.url || "tab",
    pinned: Boolean(spec.pinned),
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => (attrs.has(name) ? "" : null),
    matches: () => false,
    _attrs: attrs,
  };
}
const recordFor = (id, spec = {}) => ({
  app: { id, name: id, url: "https://example.com/" },
  tab: tab({ pinned: true, url: `https://${id}.example/`, ...spec }),
  backgroundMode: "asleep-allowed",
});

function bootBoost({ tabs = [], records = [], browsers = [] } = {}) {
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
  }));
  const timers = new Map();
  let timerId = 0;
  let registration = null;
  const unloadCalls = [];
  const appBrowserMap = new Map(browsers.map((b) => [b._bgalazkaAppId, b]));
  const gBrowser = {
    tabs,
    selectedTab: null,
    explicitUnloadTabs: async (list) => {
      unloadCalls.push(...list);
      for (const t of list) { t.linkedPanel = null; t._attrs.add("pending"); }
      return true;
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
        prefHasUserValue: (k) => store.has(k),
        addObserver() {}, removeObserver() {},
      },
      appinfo: { OS: "Linux" }, obs: { addObserver() {}, removeObserver() {} },
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
      appBrowsers: appBrowserMap,
      getAppBrowser: (id) => appBrowserMap.get(id) || null,
      closeApp(id) { appBrowserMap.delete(id); },
    },
    Panels: {
      essentialPanels: new Map(records.map((r) => [r.app.id, r])),
      getAllAppBrowsers: () => [],
      loadEssentialInBackground: () => true,
      saveEssentialSettings() {},
    },
  };
  const context = vm.createContext({
    ...win,
    ChromeUtils: {
      requestProcInfo: () => ({ memory: 900 * MB, children: [{ memory: 10 * MB }, { memory: 5 * MB }] }),
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
    api, gBrowser, unloadCalls,
    destroy: () => api.destroy(),
    async settle() {
      for (let round = 0; round < 12; round++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (const [id, t] of [...timers].filter(([, x]) => x.ms === 3000)) {
          timers.delete(id);
          t.fn();
        }
        await Promise.resolve();
      }
    },
  };
}

test("the snapshot API exists and starts empty", () => {
  const h = bootBoost();
  assert.equal(typeof h.api.sessionState, "function");
  assert.equal(typeof h.api.sessionEntries, "function");
  assert.equal(typeof h.api.sessionTabsForRestore, "function");
  const state = plain(h.api.sessionState());
  assert.equal(state.active, false);
  assert.equal(state.tabs, 0);
  assert.equal(state.panels, 0);
  assert.equal(state.activity, 0);
  h.destroy();
});

test("Level 2 stores real tab elements, panel record refs and the before/after readings", async () => {
  const a = tab({ url: "https://a/", lastAccessed: 1 });
  const b = tab({ pinned: true, url: "https://b/", lastAccessed: 2 });
  const c = tab({ url: "https://c/", lastAccessed: 3 });
  const r = recordFor("arena");
  const h = bootBoost({ tabs: [a, b, c, r.tab], records: [r] });
  h.gBrowser.selectedTab = null;
  // The pinned ordinary tab needs the consent pref; only a/b/c matter here.
  const pending = h.api.runLevel2({ allowPanels: false });
  await h.settle();
  const result = await pending;
  assert.equal(result.unloaded.tabs, 2, "the pinned ordinary tab stays loaded by policy");
  const state = plain(h.api.sessionState());
  assert.equal(state.active, true);
  assert.equal(state.tabs, 2);
  assert.equal(state.restorableTabs, 2);
  assert.equal(state.beforeMB, 915);
  assert.equal(state.afterMB, 915);
  assert.equal(state.processesBefore, 3, "parent + 2 children");
  assert.equal(state.processesAfter, 3);
  const entries = h.api.sessionEntries();
  assert.equal(entries.tabs.length, 2);
  assert.equal(entries.tabs[0].tab, a, "the REAL tab element, not null");
  assert.equal(entries.tabs[0].url, "https://a/");
  assert.equal(entries.tabs[0].title, "https://a/");
  assert.equal(entries.tabs[0].lastAccessed, 1);
  assert.equal(entries.tabs[0].wasPinned, false);
  assert.equal(entries.tabs[1].tab, c);
  assert.ok(entries.tabs[0].when > 0);
  assert.equal(h.unloadCalls.length, 2);
  h.destroy();
});

const panelBrowserFor = (id) => ({ _bgalazkaAppId: id, isConnected: true, isRemoteBrowser: true });

test("panel entries keep the record reference, its mode and whether its browser was loaded", async () => {
  const r = recordFor("whatsapp", { attrs: ["pending", "pinned"], pinned: true });
  const h = bootBoost({ tabs: [r.tab], records: [r], browsers: [panelBrowserFor("whatsapp")] });
  h.gBrowser.selectedTab = null;
  const pending = h.api.runLevel2();
  await h.settle();
  await pending;
  const entries = h.api.sessionEntries();
  assert.equal(entries.panels.length, 1);
  assert.equal(entries.panels[0].appId, "whatsapp");
  assert.equal(entries.panels[0].recordRef, r, "Restore can wake this exact record");
  assert.equal(entries.panels[0].mode, "asleep-allowed");
  assert.equal(entries.panels[0].wasLoaded, true, "the fixture really had a live panel browser");
  assert.deepEqual(plain(entries.panels[0].holders), { panel: true, tab: false },
    "R1 records which holders existed; this page lived in its panel only");
  assert.equal(entries.tabs.length, 0, "a pending tab was not slept, so it is not a tab entry");
  h.destroy();
});

test("closed tabs are skipped on restore, and Restore clears the snapshot", async () => {
  const a = tab({ url: "https://a/" });
  const b = tab({ url: "https://b/" });
  const h = bootBoost({ tabs: [a, b] });
  h.gBrowser.selectedTab = null;
  const pending = h.api.runLevel2();
  await h.settle();
  await pending;
  b.isConnected = false;
  b.closing = true;
  const restorable = h.api.sessionTabsForRestore();
  assert.equal(restorable.length, 1);
  assert.equal(restorable[0].tab, a);
  const restored = h.api.restore();
  assert.equal(restored.tabs, 1, "a closed element is silently skipped");
  const state = plain(h.api.sessionState());
  assert.equal(state.active, false);
  assert.equal(state.tabs, 0);
  assert.equal(state.panels, 0);
  assert.equal(state.beforeMB, null);
  h.destroy();
});

test("the snapshot is capped at 500 while the limiter's undo list keeps its 50 cap", async () => {
  const tabs = Array.from({ length: 510 }, (_, i) => tab({ url: `https://t${i}/`, lastAccessed: i }));
  const h = bootBoost({ tabs });
  h.gBrowser.selectedTab = null;
  const pending = h.api.runLevel2();
  await h.settle();
  const result = await pending;
  assert.equal(result.unloaded.tabs, 510);
  assert.equal(h.api.undoSize(), 50, "the old cap is unchanged");
  assert.equal(plain(h.api.sessionState()).tabs, 500, "the snapshot's own cap");
  assert.equal(h.api.sessionTabsForRestore().length, 500);
  h.destroy();
});

test("Game Mode's activity map is part of the snapshot, and destroy clears everything", () => {
  const a = tab({ url: "https://a/" });
  const b = tab({ url: "https://b/" });
  const h = bootBoost({ tabs: [a, b] });
  h.gBrowser.selectedTab = a;
  h.api.setGameMode(true);
  const state = plain(h.api.sessionState());
  assert.equal(state.active, true, "turning Game Mode on starts a snapshot");
  assert.ok(state.activity >= 1, "the deactivated browsers are remembered");
  h.api.destroy();
  const after = plain(h.api.sessionState());
  assert.equal(after.active, false);
  assert.equal(after.activity, 0);
  assert.equal(after.tabs, 0);
  assert.equal(after.panels, 0);
  assert.equal(after.hasSelected, false);
  assert.equal(after.hasParking, false);
});

test("no new interval, no new pref and no persistence across destroy", () => {
  assert.doesNotMatch(BOOST_SRC, /setInterval\(/);
  assert.doesNotMatch(BOOST_SRC, /tab:\s*null\s*,/, "no undo entry still stores a null tab element");
  assert.match(BOOST_SRC, /rememberUndone\("tabs", entry\)/);
  const h = bootBoost();
  h.api.sessionState();
  h.api.destroy();
  assert.equal(plain(h.api.sessionState()).active, false);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\ng3-session-snapshot (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
