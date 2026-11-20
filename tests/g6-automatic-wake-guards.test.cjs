"use strict";
/* G6 — every path that can load a slept panel/tab WITHOUT a click is guarded by one pause/Game Mode predicate.
 *
 * RED on d16728b (the pre-G6 tree): the shared predicate, the Boost user-wake bookkeeping and the guards in the
 * Startup, badge, Apps preload, Corner Tiles and fallback-polling paths did not exist. These tests lift the shipped
 * bodies into fake scopes, so a static comment cannot make them pass; explicit user/Restore wakes are exercised too.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const BUNDLE_SRC = read("additional/boost/ZentralBoost.standalone.uc.js");
const CORNER = read("extension/panels/corner-tiles/ZentralCornerPanels.uc.js");
const INTEGRATIONS = read("extension/panels/browsers/ZentralBrowserIntegrations.uc.js");
const PANELS = read("extension/panels/ZentralPanels.uc.js");
const LIFECYCLE = read("zentral/apps/controllers/ZentralPanelLifecycle.js");
const NOTIFICATIONS = read("zentral/apps/controllers/ZentralAppNotifications.js");
const STARTUP = read("additional/tabs/startup/ZentralStartup.uc.js");
const APPS = read("zentral/apps/ZentralApps.uc.js");
const SOURCES = Object.freeze({
  "corner-panels": CORNER,
  "browser-integrations": INTEGRATIONS,
  "panels": PANELS,
  "apps-lifecycle": LIFECYCLE,
  "app-notifications": NOTIFICATIONS,
  "startup": STARTUP,
});

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function extractFunction(name, source) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists in the shipped source`);
  let depth = 0, began = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") { depth += 1; began = true; }
    else if (source[i] === "}") {
      depth -= 1;
      if (began && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

function methodBody(name, source) {
  const start = source.indexOf(`${name}(`);
  assert.ok(start >= 0, `${name}() exists in the shipped source`);
  const open = source.indexOf("{", start);
  assert.ok(open >= 0, `${name}() has a body`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces for ${name}()`);
}

function guardSource(source) {
  const start = source.indexOf("const automaticWakeBlocked = () => Boolean(");
  assert.ok(start >= 0, "the shared automatic-wake predicate is present");
  const end = source.indexOf(");", start);
  assert.ok(end > start, "the predicate is a synchronous expression");
  return source.slice(start, end + 2);
}

function compileGuard(source) {
  return new Function("ZentralRuntime", "window", `${guardSource(source)}\nreturn automaticWakeBlocked;`);
}

function predicateState({ runtimePaused = false, standalonePaused = false, game = false, runtimeMissing = false } = {}) {
  const rt = runtimeMissing ? undefined : {
    performance: { isPaused: () => runtimePaused },
  };
  const win = {
    ZentralRuntime: rt,
    __zentralStandaloneRuntime: standalonePaused
      ? { performance: { isPaused: () => true } }
      : undefined,
    ZentralBoost: { gameModeState: () => ({ on: game }) },
  };
  return { rt, win };
}

/* ---------------- Corner Tiles: lifted schedule + explicit/background loader ---------------- */
function makeCornerRunner({ isPaused = () => false, restoreWake = false } = {}) {
  const calls = { getOrCreate: [], noteUserWake: [], timers: [], loads: [] };
  const record = {
    app: { id: "mail", name: "Mail", url: "https://mail.example/", preload: true },
    tab: { isConnected: true, closing: false },
    backgroundMode: "live",
    userContextId: 0,
    preloadPending: false,
    preloadAttempted: false,
    preloadTimer: null,
  };
  const browser = {
    currentURI: { spec: "https://mail.example/" },
    style: { display: "" },
    isConnected: true,
    isRemoteBrowser: true,
    docShellIsActive: false,
    renderLayers: true,
    getAttribute: () => null,
    hasAttribute: () => false,
    fixupAndLoadURIString(url) { calls.loads.push(url); },
  };
  const essentialPanels = new Map([["mail", record]]);
  const win = {
    Zentral: {
      Apps: {
        getOrCreateAppBrowser(app) {
          calls.getOrCreate.push(app.id);
          return { browser, isNew: false };
        },
      },
      Core: { getPref: (_key, fallback = true) => fallback },
    },
    ZentralBoost: {
      isRestoreWake: () => restoreWake,
      noteUserWake: (...args) => calls.noteUserWake.push(args),
    },
  };
  const document = {
    getElementById: () => ({ contains: () => true, hasAttribute: () => false, getAttribute: () => null }),
    documentElement: { hasAttribute: () => false, getAttribute: () => null },
  };
  const Services = {
    io: { newURI: (spec) => ({ spec }) },
    scriptSecurityManager: { createContentPrincipal: () => ({}) },
  };
  const ctx = {
    EXT_PREFS: { SMART_SLEEP: "smart-sleep" },
    getPref: (key, fallback) => (key === "smart-sleep" ? false : fallback),
    setTimeout(fn, ms) {
      const id = calls.timers.length + 1;
      calls.timers.push({ id, fn, ms });
      return id;
    },
    clearTimeout() {},
    retryPanelTask: (_record, fn) => fn(),
    getActiveAppBrowser: () => null,
  };
  const factory = new Function(
    "automaticWakeBlocked", "ctx", "essentialPanels", "window", "document", "Services", "console", "record",
    `let nextPreloadAt = 0;
     const pendingPreloads = new Set();
     ${extractFunction("scheduleEssentialPreload", CORNER)}
     ${extractFunction("loadEssentialInBackground", CORNER)}
     return { scheduleEssentialPreload, loadEssentialInBackground, record };`,
  );
  const api = factory(() => Boolean(isPaused()), ctx, essentialPanels, win, document, Services, console, record);
  return {
    ...api,
    calls,
    runTimers() { for (const item of calls.timers.splice(0)) item.fn(); },
  };
}

/* ---------------- Apps Grid: lifted automatic preload sequence ---------------- */
function makeLifecycleRunner({ pauseAfterFirstCreate = false } = {}) {
  let paused = false;
  const created = [];
  const scheduled = [];
  const state = {
    apps: [
      { id: "a", url: "https://a.example/", preload: true },
      { id: "b", url: "https://b.example/", preload: true },
    ],
    appBrowsers: new Map(),
    activeAppId: null,
  };
  const access = { state };
  const Core = { getPref: (_key, fallback = true) => fallback };
  const Constants = { Apps: { PREF_ENABLED: "apps-enabled" } };
  const setTimeoutStub = (fn, ms) => {
    if (ms === 1500) { fn(); return 99; } // sequence stagger: resolve immediately, no polling
    const item = { fn, ms };
    scheduled.push(item);
    return scheduled.length;
  };
  const clearTimeoutStub = () => {};
  const factory = new Function(
    "Core", "Constants", "access", "console", "setTimeout", "clearTimeout", "Promise", "automaticWakeBlocked", "created",
    `let preloadGeneration = 0, preloadWaitTimer = null, finishPreloadWait = null;
     let pendingSequence = null;
     const api = {
       _destroyed: false,
       _preloadTimer: null,
       badgeLoops: 0,
       cancelAutomaticPreloads() {
         preloadGeneration++;
         clearTimeout(this._preloadTimer);
         this._preloadTimer = null;
         clearTimeout(preloadWaitTimer);
         preloadWaitTimer = null;
         finishPreloadWait?.();
         finishPreloadWait = null;
       },
       getOrCreateAppBrowser(app) {
         created.push(app.id);
         const browser = {
           currentURI: { spec: app.url },
           style: {},
           isRemoteBrowser: true,
           docShellIsActive: false,
           renderLayers: true,
         };
         access.state.appBrowsers.set(app.id, browser);
         return { browser, isNew: false };
       },
       loadAppBrowser() {},
       ensureBadgeSyncLoop() { this.badgeLoops++; },
       async preloadAppsSequence() { ${methodBody("preloadAppsSequence", LIFECYCLE)} },
       scheduleAutomaticPreloads() { ${methodBody("scheduleAutomaticPreloads", LIFECYCLE)} },
     };
     const sequence = api.preloadAppsSequence;
     api.preloadAppsSequence = function (...args) {
       pendingSequence = sequence.apply(this, args);
       return pendingSequence;
     };
     return { api, getPending: () => pendingSequence };`,
  );
  const runner = factory(Core, Constants, access, console, setTimeoutStub, clearTimeoutStub, Promise,
    () => Boolean(paused), created);
  // The caller below toggles the shared predicate; the first browser creation can also turn it on mid-sequence.
  const originalCreate = runner.api.getOrCreateAppBrowser;
  runner.api.getOrCreateAppBrowser = function (app) {
    const result = originalCreate.call(this, app);
    if (pauseAfterFirstCreate && created.length === 1) paused = true;
    return result;
  };
  return {
    api: runner.api,
    created,
    scheduled,
    setPaused(value) { paused = Boolean(value); },
    clearScheduled() { scheduled.length = 0; },
    async runScheduled() {
      for (const item of scheduled.splice(0)) item.fn();
      await runner.getPending();
    },
  };
}

/* ---------------- Badge/title sync: lifted object methods ---------------- */
function makeNotificationRunner() {
  let paused = false;
  const metrics = { titleReads: 0, updates: 0, observers: 0, intervals: 0 };
  const app = { id: "mail", hasNotification: false, notificationCount: 0 };
  const browser = {
    isConnected: true,
    getAttribute: () => "",
    get contentTitle() { metrics.titleReads++; return "Mail (2)"; },
  };
  const access = {
    state: { apps: [app], appBrowsers: new Map([["mail", browser]]) },
    badgePollingObserver: null,
  };
  const win = { ZentralRuntime: { panelContext: { essentialPanels: new Map() } } };
  const Core = { getPref: (_key, fallback) => 1000 };
  const Services = { prefs: { addObserver() { metrics.observers++; } } };
  const setIntervalStub = (fn) => { metrics.intervals++; metrics.intervalCallback = fn; return metrics.intervals; };
  const clearIntervalStub = () => {};
  const factory = new Function(
    "access", "window", "Core", "Services", "setInterval", "clearInterval", "console", "metrics", "automaticWakeBlocked",
    `return {
       _destroyed: false,
       _badgeSyncLoopTimer: null,
       extractBadgeFromTitle() { return { hasNotification: true, notifCount: 2 }; },
       updateAppBadge() { metrics.updates++; },
       stopBadgeSyncLoop() { if (this._badgeSyncLoopTimer) clearInterval(this._badgeSyncLoopTimer); this._badgeSyncLoopTimer = null; },
       syncBadgePollingPreference() { this.stopBadgeSyncLoop(); this.ensureBadgeSyncLoop(); },
       syncAllAppBadges(onlyAppId = null) { ${methodBody("syncAllAppBadges", NOTIFICATIONS)} },
       ensureBadgeSyncLoop() { ${methodBody("ensureBadgeSyncLoop", NOTIFICATIONS)} },
     };`,
  );
  const api = factory(access, win, Core, Services, setIntervalStub, clearIntervalStub, console, metrics,
    () => Boolean(paused));
  return { api, metrics, setPaused(value) { paused = Boolean(value); } };
}

/* ---------------- Startup: whole module through its published init() ---------------- */
const createDom = require("./helpers/fake-dom.cjs");
const STARTUP_PREF = "zen.workspace.zentral.startup.enabled";
const STARTUP_KEY = "zentral-load-at-startup";

function bootStartup({ startedPaused = false, startedGame = false } = {}) {
  const { document } = createDom();
  document.createXULElement = (tag) => document.createElement(tag);
  const store = new Map([[STARTUP_PREF, true]]);
  const observers = [];
  const Services = {
    prefs: {
      getBoolPref: (key, fallback = false) => (store.has(key) ? Boolean(store.get(key)) : fallback),
      addObserver: (key, observer) => observers.push({ key, observer }),
      removeObserver: () => {},
    },
    obs: { addObserver: () => {}, removeObserver: () => {} },
    io: { newURI: (spec) => ({ spec }) },
  };
  const makeTab = (id) => {
    const tab = document.createElement("tab");
    tab.id = id;
    tab.pinned = true;
    tab.closing = false;
    tab.setAttribute("pending", "true");
    tab.linkedPanel = "";
    tab.linkedBrowser = { reload() { tab.reloads++; } };
    tab.reloads = 0;
    return tab;
  };
  const tab = makeTab("pinned-1");
  const tabStrip = document.createElement("div");
  tabStrip.appendChild(tab);
  document.documentElement.appendChild(tabStrip);
  if (!document.documentElement.toggleAttribute) {
    document.documentElement.toggleAttribute = function (name, force) {
      const on = force === undefined ? !this.hasAttribute(name) : !!force;
      if (on) this.setAttribute(name, ""); else this.removeAttribute(name);
      return on;
    };
  }
  const values = new Map([[STARTUP_KEY + ":pinned-1", "true"]]);
  const sessionStore = {
    getCustomTabValue: (which, key) => values.get(key + ":" + which.id) ?? "",
    setCustomTabValue: (which, key, value) => values.set(key + ":" + which.id, String(value)),
    promiseAllWindowsRestored: Promise.resolve(),
  };
  const timers = [];
  let paused = startedPaused;
  let game = startedGame;
  const pauseListeners = new Set();
  const performanceSwitch = {
    isPaused: () => paused,
    subscribe(fn) { pauseListeners.add(fn); return () => pauseListeners.delete(fn); },
    setPaused(next) {
      const value = Boolean(next);
      if (value === paused) return;
      paused = value;
      for (const fn of [...pauseListeners]) fn(paused, { paused });
    },
  };
  const win = {
    document,
    SessionStore: sessionStore,
    gBrowser: { tabs: [tab], selectedTab: tab },
    gBrowserInit: { delayedStartupFinished: true },
    gZenWorkspaces: {
      workspaceEnabled: true,
      privateWindowOrDisabled: false,
      promiseInitialized: Promise.resolve(),
      allStoredTabs: [tab],
    },
    windowUtils: { USER_SHEET: 1, loadSheet: () => {}, removeSheet: () => {} },
    Services,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    addEventListener() {}, removeEventListener() {},
    ZentralRuntime: {
      rootURI: "resource://zentral/",
      performance: performanceSwitch,
      register: (def) => win.registrations.push(def),
    },
    ZentralBoost: { gameModeState: () => ({ on: game }) },
    registrations: [],
  };
  win.window = win;
  const sandbox = {
    window: win, document, Services, console,
    ChromeUtils: { importESModule: (uri) => (uri.includes("SessionStore") ? { SessionStore: sessionStore } : (() => { throw new Error("no module"); })()) },
    Components: { stack: { filename: "resource://zentral/additional/tabs/startup/ZentralStartup.uc.js" } },
    URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap, WeakSet, Array, Object, String, Boolean, Error, TypeError,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(STARTUP, sandbox, { filename: "ZentralStartup.uc.js" });
  const def = win.registrations.find((item) => item.id === "startup");
  assert.ok(def, "Startup registers itself with the runtime");
  def.init();
  return {
    tab,
    setPaused(value) { performanceSwitch.setPaused(value); },
    setGame(value) { game = Boolean(value); },
    notify() {
      store.set(STARTUP_PREF, true);
      for (const item of observers) if (item.key === STARTUP_PREF) item.observer?.observe?.();
    },
    runTimers() {
      for (let i = 0; i < 10; i++) {
        const next = timers.find((item) => !item.cleared && !item.ran);
        if (!next) break;
        next.ran = true;
        next.fn();
      }
    },
    destroy: () => win.ZentralStartup?.destroy?.(),
  };
}

/* ---------------- Boost: real source in a VM, with a tab/window scope ---------------- */
const MB = 1_000_000;
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
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
    emitLoad() {
      for (const set of [listeners.get("load"), listeners.get("DOMContentLoaded")]) {
        for (const fn of [...(set || [])]) fn({ type: "load" });
      }
    },
  };
  browser.reload = () => {};
  return browser;
}
function makeTab(spec = {}) {
  const attrs = new Map(spec.attrs || []);
  const browser = spec.browser || makeBrowser({ url: spec.url });
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
  };
  return tab;
}
function makeRecord(id, mode, spec = {}) {
  return {
    app: { id, name: id, url: "https://example.com/" },
    tab: makeTab({ pinned: true, url: `https://${id}.example/`, label: id, ...spec }),
    backgroundMode: mode,
  };
}
function bootBoost({ tabs = [], records = [], prefs = {}, browsers = new Map() } = {}) {
  const principal = { system: true };
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    ...prefs,
  }));
  const timers = new Map();
  const listeners = new Map();
  let timerId = 0;
  let registration = null;
  let selected = tabs[0] || null;
  const allTabs = [...tabs];
  const appBrowsers = new Map(browsers);
  const panelWakeChecks = [];
  const noteWakeCalls = [];
  const gBrowser = {
    tabs: allTabs,
    get selectedTab() { return selected; },
    set selectedTab(tab) { selected = tab; },
    get selectedBrowser() { return selected?.linkedBrowser || null; },
    async explicitUnloadTabs(list) {
      for (const tab of list) { tab.setAttribute("pending", "true"); tab.linkedPanel = null; }
      return true;
    },
    addTab(url) {
      const tab = makeTab({ url, label: "Boost parking", lastAccessed: Date.now() });
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
      scriptSecurityManager: { getSystemPrincipal: () => principal },
    },
    Cc: { "@mozilla.org/memory-reporter-manager;1": { getService: () => ({ minimizeMemoryUsage: (cb) => cb?.run?.() }) } },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: { getTabState: (t) => JSON.stringify({ entries: [{ url: t.linkedBrowser?.currentURI?.spec || "" }], index: 1 }) },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback: () => 1,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter((item) => item !== fn));
    },
    console: { warn() {}, log() {}, error() {} },
    ZentralRuntime: { register: (def) => { registration = def; } },
  };
  win.window = win;
  win.globalThis = win;
  win.Zentral = {
    Apps: {
      appBrowsers,
      getAppBrowser: (id) => appBrowsers.get(id) || null,
      closeApp(id) { appBrowsers.delete(id); },
    },
    Panels: {
      essentialPanels: new Map(records.map((r) => [r.app.id, r])),
      getAllAppBrowsers: () => [...appBrowsers.values()],
      loadEssentialInBackground(record, automatic) {
        const id = record?.app?.id || record?.appId;
        const restoreOwned = !automatic && Boolean(win.ZentralBoost?.isRestoreWake?.("panel", id));
        panelWakeChecks.push({ id, automatic, restoreOwned });
        if (!automatic && !restoreOwned) {
          noteWakeCalls.push(id);
          win.ZentralBoost?.noteUserWake?.("panel", id);
        }
        return true;
      },
      saveEssentialSettings() {},
    },
  };
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
  return {
    api: win.ZentralBoost, win, gBrowser, allTabs, appBrowsers, panelWakeChecks, noteWakeCalls,
    listenerCount: (type) => (listeners.get(type) || []).length,
    emit(type, event) { for (const fn of [...(listeners.get(type) || [])]) fn(event); },
    destroy: () => win.ZentralBoost?.destroy?.(),
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
async function seedBoostSession() {
  const selected = makeTab({ url: "https://selected.example/", label: "selected", lastAccessed: 900 });
  const ordinary = Array.from({ length: 4 }, (_, i) => makeTab({
    url: `https://tab-${i}.example/`, label: `tab-${i}`, lastAccessed: i + 1,
  }));
  const records = ["live", "asleep-allowed"].map((mode, i) => makeRecord(`app-${i}`, mode));
  const browsers = new Map(records.map((r) => {
    const browser = makeBrowser({ url: `https://${r.app.id}.example/` });
    browser._bgalazkaAppId = r.app.id;
    return [r.app.id, browser];
  }));
  const h = bootBoost({ tabs: [selected, ...ordinary, ...records.map((r) => r.tab)], records, browsers });
  const pending = h.api.runLevel2({ allowModes: ["live", "throttled", "asleep-allowed"] });
  await h.flushTimers(3000, 5);
  await pending;
  h.api.parkSelected();
  await h.flushTimers(0, 3);
  return { h, selected, ordinary, records };
}

/* ---------------- Tests ---------------- */
test("all audited automatic-wake owners use one synchronous pause/Game Mode predicate", () => {
  for (const [name, source] of Object.entries(SOURCES)) {
    const guard = guardSource(source);
    assert.match(guard, /performance\?\.isPaused\?\.\(\)/, `${name}: runtime pause is consulted`);
    assert.match(guard, /ZentralBoost\?\.gameModeState\?\.\(\)\.on/, `${name}: Game Mode is consulted`);
    assert.doesNotMatch(guard, /setInterval|setTimeout|requestAnimationFrame/, `${name}: the guard starts no polling`);
  }
  assert.match(CORNER, /if \(automatic && automaticWakeBlocked\(\)\) return false;/);
  assert.match(INTEGRATIONS, /const gameModeOn = automaticWakeBlocked\(\);/);
  assert.match(PANELS, /!automaticWakeBlocked\(\) &&\s*panelMaintenanceVisible\(\)/);
  assert.match(LIFECYCLE, /!automaticWakeBlocked\(\) &&\s*Core\.getPref/);
  assert.match(LIFECYCLE, /generation === preloadGeneration &&\s*!automaticWakeBlocked\(\)/);
  assert.match(NOTIFICATIONS, /syncAllAppBadges\(onlyAppId = null\) \{\s*if \(automaticWakeBlocked\(\)\) return;/);
  assert.match(NOTIFICATIONS, /ensureBadgeSyncLoop\(\) \{\s*if \(automaticWakeBlocked\(\)\) return;/);
  assert.match(STARTUP, /function wake\(tab\) \{[\s\S]*?automaticWakeBlocked\(\)/);
  assert.match(STARTUP, /function pump\(\) \{[\s\S]*?automaticWakeBlocked\(\)/);
  assert.match(STARTUP, /function scan\(\) \{[\s\S]*?automaticWakeBlocked\(\)/);
  assert.match(APPS, /scheduleAutomaticPreloads\(\);/, "Apps Grid init and re-enable use the guarded owner");
  assert.match(CORNER, /pauseSwitch\.subscribe/, "Corner Tiles owns its pause re-arm subscription");
  assert.match(CORNER, /ctx\.requestTileSync\?\.\(0\)/, "Corner Tiles re-arms its ordinary one-shot tile sync");
  assert.match(APPS, /installPerformancePauseSubscription\(\)/, "Apps Grid owns its pause subscription");
  assert.match(APPS, /#performanceUnsubscribe/, "Apps Grid tears down its pause subscription");
  assert.match(STARTUP, /hostRuntime\.performance\.subscribe/, "Startup rebuilds its queue on resume");
  assert.match(PANELS, /ctx\.requestTileSync\?\.\(0\)/, "ZentralPanels re-arms the tile sync on resume");
  assert.match(BOOST_SRC, /function noteUserWake\(kind, key\)/);
  assert.match(BOOST_SRC, /function isRestoreWake\(kind, key\)/);
  assert.match(BUNDLE_SRC, /function noteUserWake\(kind, key\)/, "standalone Boost bundle carries G6");
  assert.match(PANELS, /window\.ZentralBoost\?\.noteUserWake\?\.\("panel", id\)/);
  assert.doesNotMatch(BOOST_SRC, /setInterval\(/, "Boost itself still has no polling loop");
});

test("the predicate accepts runtime pause, standalone pause and Game Mode, and passes through when all are off", () => {
  for (const [name, source] of Object.entries(SOURCES)) {
    const compile = compileGuard(source);
    const runtime = predicateState({ runtimePaused: true });
    assert.equal(compile(runtime.rt, runtime.win)(), true, `${name}: runtime pause blocks`);
    const standalone = predicateState({ runtimeMissing: true, standalonePaused: true });
    assert.equal(compile(standalone.rt, standalone.win)(), true, `${name}: standalone runtime pause blocks`);
    const game = predicateState({ game: true });
    assert.equal(compile(game.rt, game.win)(), true, `${name}: Game Mode blocks`);
    const normal = predicateState();
    assert.equal(compile(normal.rt, normal.win)(), false, `${name}: ordinary operation is not blocked`);
  }
});

test("Corner Tiles never arms or runs an automatic preload while paused; explicit and Restore wakes still load", () => {
  const paused = makeCornerRunner({ isPaused: () => true });
  paused.scheduleEssentialPreload(paused.record);
  assert.equal(paused.calls.timers.length, 0, "no preload timer is armed during a game");
  assert.equal(paused.loadEssentialInBackground(paused.record, true), false, "automatic load returns before browser creation");
  assert.equal(paused.calls.getOrCreate.length, 0, "a slept panel stays asleep");
  assert.equal(paused.loadEssentialInBackground(paused.record, false), true, "a click still wakes the panel");
  assert.deepEqual(paused.calls.getOrCreate, ["mail"]);
  assert.deepEqual(paused.calls.noteUserWake, [["panel", "mail"]], "a click is remembered as a user wake");

  let latePause = false;
  const late = makeCornerRunner({ isPaused: () => latePause });
  late.scheduleEssentialPreload(late.record);
  assert.equal(late.calls.timers.length, 1, "the one-shot preload timer is scheduled normally");
  latePause = true;
  late.runTimers();
  assert.equal(late.calls.getOrCreate.length, 0, "Game Mode starting before the timer callback still blocks the load");

  const normal = makeCornerRunner();
  normal.scheduleEssentialPreload(normal.record);
  normal.runTimers();
  assert.deepEqual(normal.calls.getOrCreate, ["mail"], "without a pause the automatic preload works");
  assert.equal(normal.calls.noteUserWake.length, 0, "automatic preloads are not mistaken for user wakes");

  const restoring = makeCornerRunner({ restoreWake: true });
  assert.equal(restoring.loadEssentialInBackground(restoring.record, false), true,
    "Restore's explicit panel wake still creates the browser");
  assert.equal(restoring.calls.noteUserWake.length, 0, "Restore's own wake does not erase its own queue item");
});

test("Apps Grid preloads do not create browsers when paused and stop mid-sequence when a game starts", async () => {
  const paused = makeLifecycleRunner();
  paused.setPaused(true);
  paused.api.scheduleAutomaticPreloads();
  assert.equal(paused.scheduled.length, 0, "no automatic preload timer is armed");
  await paused.api.preloadAppsSequence();
  assert.equal(paused.created.length, 0, "the sequence itself is guarded");

  const late = makeLifecycleRunner();
  late.api.scheduleAutomaticPreloads();
  assert.equal(late.scheduled.length, 1, "normally one one-shot timer is armed");
  late.setPaused(true);
  await late.runScheduled();
  assert.equal(late.created.length, 0, "the deferred callback rechecks the live pause state");

  const normal = makeLifecycleRunner();
  normal.api.scheduleAutomaticPreloads();
  await normal.runScheduled();
  assert.deepEqual(normal.created, ["a", "b"], "ordinary startup preloads still work");
  assert.equal(normal.api.badgeLoops, 1, "badge sync is re-armed only after a completed sequence");

  const midway = makeLifecycleRunner({ pauseAfterFirstCreate: true });
  await midway.api.preloadAppsSequence();
  assert.deepEqual(midway.created, ["a"], "a game starting between staggered items stops the remaining queue");
  assert.equal(midway.api.badgeLoops, 0, "no badge loop is armed after the sequence was interrupted");
});

test("badge and title sync neither reads a panel title nor starts its interval while paused", () => {
  const runner = makeNotificationRunner();
  runner.setPaused(true);
  runner.api.syncAllAppBadges();
  runner.api.ensureBadgeSyncLoop();
  assert.equal(runner.metrics.titleReads, 0, "no automatic browser-title read during a game");
  assert.equal(runner.metrics.updates, 0, "no badge mutation during a game");
  assert.equal(runner.metrics.observers, 0, "no pref observer is installed during a game");
  assert.equal(runner.metrics.intervals, 0, "no new polling interval during a game");

  runner.setPaused(false);
  runner.api.syncAllAppBadges();
  runner.api.ensureBadgeSyncLoop();
  assert.equal(runner.metrics.titleReads, 1, "badge sync works again after the pause");
  assert.equal(runner.metrics.updates, 1);
  assert.equal(runner.metrics.observers, 1);
  assert.equal(runner.metrics.intervals, 1);

  runner.setPaused(true);
  runner.metrics.intervalCallback();
  assert.equal(runner.metrics.titleReads, 1, "an interval that fires after a late pause is still inert");
});

test("BrowserIntegrations keeps a hidden notification panel inactive for runtime pause as well as Game Mode", () => {
  const fnSource = extractFunction("syncAppPanelBrowserActivity", INTEGRATIONS);
  const makeBrowser = () => ({
    isConnected: true, isRemoteBrowser: true, docShellIsActive: true, renderLayers: true,
    _bgalazkaAppId: "mail", style: { display: "none" },
    hasAttribute: () => false, closest: () => null, getClientRects: () => [],
  });
  const run = ({ paused, game }) => {
    const browser = makeBrowser();
    const ctx = {
      essentialPanels: new Map([["mail", {
        app: { id: "mail", preload: true }, tab: { isConnected: true, soundPlaying: false }, backgroundMode: "live",
      }]]),
      getAllAppBrowsers: () => [browser],
    };
    const document = {
      getElementById: () => ({ contains: () => true, hasAttribute: () => false, getAttribute: () => null }),
      documentElement: { hasAttribute: () => false, getAttribute: () => null },
    };
    const state = predicateState({ runtimePaused: paused, game });
    const guard = compileGuard(INTEGRATIONS)(state.rt, state.win);
    const fn = new Function(
      "ctx", "document", "window", "addonHostByAppId", "console", "panelBrowserVisible", "automaticWakeBlocked",
      `${fnSource}\nreturn syncAppPanelBrowserActivity;`,
    )(ctx, document, { ...state.win, Zentral: undefined }, new Map(), console, () => false, guard);
    fn([browser]);
    return browser;
  };
  const paused = run({ paused: true, game: false });
  assert.equal(paused.docShellIsActive, false, "runtime pause deactivates a hidden preload");
  assert.equal(paused.renderLayers, false);
  const game = run({ paused: false, game: true });
  assert.equal(game.docShellIsActive, false, "Game Mode deactivates a hidden preload");
  const normal = run({ paused: false, game: false });
  assert.equal(normal.docShellIsActive, true, "an ordinary live notification panel stays active");
});

test("ZentralPanels fallback maintenance is disarmed by pause/Game Mode and re-armed when both end", () => {
  let paused = true;
  const metrics = { intervals: 0, clears: 0 };
  let panelStatusTimer = null;
  const setIntervalStub = (fn, delay) => { metrics.intervals++; return { id: metrics.intervals, delay, fn }; };
  const clearIntervalStub = () => { metrics.clears++; };
  const ctx = { periodicFallbackPollingEnabled: () => true };
  const factory = new Function(
    "getPref", "BGALAZKA_EXT_PREFS", "ctx", "extensionDisposed", "panelMaintenanceVisible",
    "runPanelFallbackMaintenance", "clearInterval", "setInterval", "automaticWakeBlocked",
    `let panelStatusTimer = null;
     function syncPanelFallbackPolling() { ${methodBody("syncPanelFallbackPolling", PANELS)} }
     return { syncPanelFallbackPolling, getTimer: () => panelStatusTimer };`,
  );
  const api = factory(() => 10000, {}, ctx, false, () => true, () => {}, clearIntervalStub, setIntervalStub,
    () => Boolean(paused));
  api.syncPanelFallbackPolling();
  assert.equal(metrics.intervals, 0, "no fallback interval while paused");
  paused = false;
  api.syncPanelFallbackPolling();
  assert.equal(metrics.intervals, 1, "the existing fallback re-arms when the game ends");
  assert.ok(api.getTimer(), "the one existing timer is owned by this scope");
  paused = true;
  api.syncPanelFallbackPolling();
  assert.equal(metrics.clears, 1, "a late pause clears the owned interval, it does not add a second one");
  assert.equal(metrics.intervals, 1, "no new interval was created while paused");
});

test("Startup wake, pump and scan stay silent during runtime pause or Game Mode, then resume", async () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const pauseBoot = bootStartup({ startedPaused: true });
  await flush();
  pauseBoot.runTimers();
  assert.equal(pauseBoot.tab.reloads, 0, "runtime pause keeps a selected startup tab asleep");
  pauseBoot.setPaused(false); // the owned pause subscription rebuilds the cleared queue; no pref observer is needed
  pauseBoot.runTimers();
  assert.equal(pauseBoot.tab.reloads, 1, "the chosen tab wakes after the pause ends");
  pauseBoot.destroy();

  const gameBoot = bootStartup({ startedGame: true });
  await flush();
  gameBoot.runTimers();
  assert.equal(gameBoot.tab.reloads, 0, "Game Mode keeps a selected startup tab asleep");
  gameBoot.setGame(false);
  gameBoot.notify();
  gameBoot.runTimers();
  assert.equal(gameBoot.tab.reloads, 1, "the explicit startup choice is not lost permanently");
  gameBoot.destroy();
});

test("Boost forgets user-woken tabs and panels from the snapshot and the pending Restore queue", async () => {
  const control = await seedBoostSession();
  const controlStart = control.h.api.restoreSession({ profile: "all", staggerMs: 0 });
  control.h.api.cancelRestore("test");
  control.h.destroy();

  const { h } = await seedBoostSession();
  const entries = h.api.sessionEntries();
  const userTab = entries.tabs.find((entry) => entry.tab && entry.tab.label.startsWith("tab-"));
  const userPanel = entries.panels[0];
  assert.ok(userTab && userPanel, "the G3 snapshot has a real tab and a panel reference");
  assert.ok(h.api.noteUserWake("tab", userTab.tab) > 0, "a real tab wake removes snapshot entries");
  assert.ok(h.api.noteUserWake("panel", userPanel.appId) > 0, "a real panel wake removes snapshot entries");
  const remaining = h.api.sessionEntries();
  assert.ok(!remaining.tabs.some((entry) => entry.tab === userTab.tab), "the woken tab is no longer in the snapshot");
  assert.ok(!remaining.panels.some((entry) => entry.appId === userPanel.appId), "the woken panel is no longer in the snapshot");
  const started = h.api.restoreSession({ profile: "all", staggerMs: 0 });
  assert.equal(started.panels, controlStart.panels - 1, "Restore does not queue the user-woken panel");
  assert.equal(started.tabTasks, controlStart.tabTasks - 1, "Restore does not queue the user-woken tab");
  assert.equal(h.api.restoreState().queue, started.panels + started.tabTasks);
  h.api.cancelRestore("test");
  h.destroy();
});

test("a click or TabSelect during Restore removes only that item; the TabSelect listener is torn down", async () => {
  const { h } = await seedBoostSession();
  const entries = h.api.sessionEntries();
  const tabs = entries.tabs.filter((entry) => entry.tab && entry.tab.label.startsWith("tab-")).map((entry) => entry.tab);
  const panelId = entries.panels[0]?.appId;
  assert.ok(tabs.length >= 2 && panelId, "the snapshot has several tabs and a panel");
  const started = h.api.restoreSession({ profile: "all", staggerMs: 0 });
  assert.ok(started.tabTasks >= 2);
  const before = h.api.restoreState().queue;

  h.win.Zentral.Panels.loadEssentialInBackground({ app: { id: panelId } }, false);
  assert.equal(h.api.restoreState().queue, before - 1, "an explicit panel click is skipped by Restore");
  assert.equal(h.panelWakeChecks.at(-1).restoreOwned, false, "the click was not marked as a Restore-owned wake");
  assert.ok(h.noteWakeCalls.includes(panelId));

  assert.equal(h.listenerCount("TabSelect"), 1, "Boost owns exactly one capture TabSelect listener");
  const beforeSelect = h.api.restoreState().queue;
  h.emit("TabSelect", { target: tabs[0] });
  assert.equal(h.api.restoreState().queue, beforeSelect - 1, "a real tab selection is skipped by Restore");
  const beforeSecond = h.api.restoreState().queue;
  h.emit("TabSelect", { target: tabs[1] });
  assert.equal(h.api.restoreState().queue, beforeSecond - 1, "each user tab wake removes only its own item");

  h.api.cancelRestore("test");
  h.destroy();
  assert.equal(h.listenerCount("TabSelect"), 0, "destroy removes the owned TabSelect listener");
});

test("Restore's own panel wakes are distinguishable from a person's click", async () => {
  const { h } = await seedBoostSession();
  const state = h.api.restore();
  assert.ok(state.panels >= 1, "the panels-only Restore really called the panel loader");
  assert.ok(h.panelWakeChecks.some((entry) => !entry.automatic && entry.restoreOwned),
    "the low-level loader can ask Boost whether this wake belongs to Restore");
  assert.equal(h.noteWakeCalls.length, 0, "Restore did not report its own wakes as user clicks");
  assert.ok(!h.api.restoreState().log.some((line) => line.startsWith("user-wake:")),
    "the Restore log contains no false user-wake entries");
  assert.ok(h.api.restoreState().log.some((line) => line.startsWith("panel:")),
    "the panel wake itself still happened");
  h.destroy();
});

(async () => {
  for (const [name, fn] of tests) await fn();
  passed = tests.length;
  console.log(`\ng6-automatic-wake-guards (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
