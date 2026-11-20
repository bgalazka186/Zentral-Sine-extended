"use strict";
/* Shared fake window for the Restore follow-up suites (R4).
 *
 * It boots the REAL `additional/boost/ZentralBoost.uc.js` with the shared tab policy, a panel layer that can hold a
 * live app browser per record, and `gBrowser` fakes that really unload and really reload. Fixture tabs carry real
 * `pinned` / `zen-essential` attributes, so the policy sees the same thing a live Zen tab would show it.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const MB = 1_000_000;

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");

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
    lastAccessed: spec.lastAccessed || 0,
    pinned: Boolean(spec.pinned),
    closing: false,
    isConnected: spec.connected !== false,
    linkedPanel: spec.pending ? null : "panel-" + Math.random(),
    soundPlaying: Boolean(spec.soundPlaying),
    _sharingState: null,
    linkedBrowser: {
      currentURI: { spec: spec.url || "https://example.com/" },
      isPictureInPicture: false,
      audioPlaybackActive: false,
      reload() {
        tab._reloads = (tab._reloads || 0) + 1;
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
  return tab;
}

function makeRecord(appId, { mode = "asleep-allowed", tabLoaded = true, panel = true, pinned = true } = {}) {
  const tab = makeTab({
    url: `https://${appId}.example/`,
    label: appId,
    pinned,
    attrs: pinned ? [["zen-essential", "true"]] : [],
    pending: !tabLoaded,
    lastAccessed: 10,
  });
  const record = { app: { id: appId, name: appId }, tab, backgroundMode: mode };
  if (panel) record.browser = { _bgalazkaAppId: appId, isConnected: true, isRemoteBrowser: true };
  return record;
}

function bootBoost({ tabs = [], records = [], prefs = {} } = {}) {
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
  const unloadCalls = [];
  const closeAppCalls = [];
  const wakeCalls = [];
  const reloadCalls = [];
  const allTabs = [...tabs];
  const appBrowsers = new Map(records.filter((r) => r.browser).map((r) => [r.app.id, r.browser]));
  const essentialPanels = new Map(records.map((r) => [r.app.id, r]));
  for (const tab of allTabs) {
    if (typeof tab.linkedBrowser?.reload !== "function") continue;
    const reload = tab.linkedBrowser.reload;
    tab.linkedBrowser.reload = () => { reloadCalls.push(tab); return reload(); };
  }
  const gBrowser = {
    tabs: allTabs,
    get selectedTab() { return selected; },
    set selectedTab(tab) { selected = tab; },
    async explicitUnloadTabs(list) {
      unloadCalls.push(...list);
      for (const tab of list) {
        tab.setAttribute("pending", "true");
        tab.linkedPanel = null;
      }
      return true;
    },
    addTab(url) {
      const tab = makeTab({ url, label: "Boost parking" });
      tab.setAttribute("zentral-boost-parking", "true");
      allTabs.push(tab);
      return tab;
    },
    removeTab(tab) {
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
      scriptSecurityManager: { getSystemPrincipal: () => ({ system: true }) },
    },
    Cc: { "@mozilla.org/memory-reporter-manager;1": { getService: () => ({ minimizeMemoryUsage: (cb) => cb?.run?.() }) } },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: { getTabState: (t) => JSON.stringify({ entries: [{ url: t.linkedBrowser?.currentURI?.spec || "" }], index: 1 }) },
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
      getAppBrowser: (id) => appBrowsers.get(id) || null,
      closeApp(appId) {
        closeAppCalls.push(appId);
        appBrowsers.delete(appId);
      },
    },
    Panels: {
      essentialPanels,
      getAllAppBrowsers: () => [...appBrowsers.values()],
      loadEssentialInBackground: (record, automatic) => {
        wakeCalls.push({ id: record.app.id, automatic });
        if (!appBrowsers.has(record.app.id)) {
          appBrowsers.set(record.app.id, { _bgalazkaAppId: record.app.id, isConnected: true });
        }
        return true;
      },
      syncAppPanelBrowserActivity() {},
      saveEssentialSettings() {},
    },
  };
  const context = vm.createContext({
    ...win,
    ChromeUtils: { requestProcInfo: () => ({ memory: 6000 * MB, children: [{ memory: 500 * MB }] }), forceGC() {}, forceCC() {} },
    Cc: win.Cc, Ci: win.Ci, console: win.console,
    URL, Promise, Set, Map, WeakMap, WeakSet, Array, Object, Number, Math, String, Symbol, Error, TypeError, Date,
    JSON, globalThis: win,
  });
  win.ZentralTabPolicy = policy;
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  assert.ok(registration?.init, "the Boost module registers a feature");
  registration.init();
  const api = win.ZentralBoost;
  assert.ok(api, "the Boost API is published");

  const microtasks = async (count = 8) => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  return {
    api, win, gBrowser, store, timers, allTabs, appBrowsers, essentialPanels,
    unloadCalls, closeAppCalls, wakeCalls, reloadCalls,
    destroy: () => api.destroy(),
    async flushTimers(ms = 0, rounds = 12) {
      for (let round = 0; round < rounds; round++) {
        for (const [id, timer] of [...timers].filter(([, x]) => ms == null || x.ms === ms)) {
          timers.delete(id);
          timer.fn();
        }
        await microtasks(8);
      }
    },
    async flushAll(rounds = 40) { await this.flushTimers(null, rounds); },
    async sleepGameMode() {
      api.setGameMode(true);
      await this.flushTimers(0);
      api.setGameMode(false);
      await this.flushTimers(0);
    },
  };
}

module.exports = { bootBoost, makeTab, makeRecord, read, ROOT, BOOST_SRC, policy };
