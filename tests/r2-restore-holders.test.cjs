"use strict";
/* R2 — Restore builds only the tasks that match what was freed.
 *
 * RED on the pre-R2 tree: `restoreSnapshotEntries()` made a panel task for every panel entry and
 * `panelNeedsWork()` only asked whether a panel browser existed NOW, so a record freed as a TAB was woken as a
 * Zentral panel and its tab was never reloaded. This suite drives the real engine through `restoreSession()` and
 * the legacy `restore()` door and counts real `loadEssentialInBackground` / `linkedBrowser.reload()` calls.
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
    lastAccessed: spec.lastAccessed || 0,
    pinned: Boolean(spec.pinned),
    hidden: false,
    closing: false,
    isConnected: spec.connected !== false,
    linkedPanel: spec.pending ? null : "panel-" + Math.random(),
    soundPlaying: false,
    _sharingState: null,
    linkedBrowser: {
      currentURI: { spec: spec.url || "https://example.com/" },
      isPictureInPicture: false,
      audioPlaybackActive: false,
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
  return tab;
}

const record = (appId, { mode = "asleep-allowed", tabLoaded = true, panel = true } = {}) => {
  const tab = makeTab({ url: `https://${appId}.example/`, label: appId, pinned: true, pending: !tabLoaded, lastAccessed: 10 });
  const r = { app: { id: appId, name: appId }, tab, backgroundMode: mode };
  if (panel) r.browser = { _bgalazkaAppId: appId, isConnected: true, isRemoteBrowser: true };
  return r;
};

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
  // Count every background reload the engine performs, record tab or ordinary pinned tab.
  for (const tab of allTabs) {
    if (typeof tab.linkedBrowser?.reload !== "function") continue;
    const reload = tab.linkedBrowser.reload;
    tab.linkedBrowser.reload = () => {
      reloadCalls.push(tab);
      return reload();
    };
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
      loadEssentialInBackground: (r, automatic) => {
        wakeCalls.push({ id: r.app.id, automatic });
        if (!appBrowsers.has(r.app.id)) appBrowsers.set(r.app.id, { _bgalazkaAppId: r.app.id, isConnected: true });
        return true;
      },
      syncAppPanelBrowserActivity() {},
      saveEssentialSettings() {},
    },
  };
  const context = vm.createContext({
    ...win,
    ChromeUtils: { requestProcInfo: () => ({ memory: 6000 * MB, children: [] }), forceGC() {}, forceCC() {} },
    Cc: win.Cc, Ci: win.Ci, console: win.console,
    URL, Promise, Set, Map, WeakMap, WeakSet, Array, Object, Number, Math, String, Symbol, Error, TypeError, Date,
    JSON, globalThis: win,
  });
  win.ZentralTabPolicy = policy;
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  registration.init();
  const api = win.ZentralBoost;
  return {
    api, win, gBrowser, store, timers, allTabs, appBrowsers,
    unloadCalls, closeAppCalls, wakeCalls, reloadCalls,
    destroy: () => api.destroy(),
    async flushTimers(ms = 0, rounds = 12) {
      for (let round = 0; round < rounds; round++) {
        for (const [id, t] of [...timers].filter(([, x]) => ms == null || x.ms === ms)) {
          timers.delete(id);
          t.fn();
        }
        await microtasks(8);
      }
    },
    async flushAll(rounds = 40) {
      await this.flushTimers(null, rounds);
    },
    async sleepAll() {
      this.api.setGameMode(true);
      await this.flushTimers(0);
      this.api.setGameMode(false);
      await this.flushTimers(0);
    },
  };
}

/* ---------- 1–4: the four holder rows, restored through the real engine ---------- */

test("tab-only record: Restore reloads the TAB once and NEVER wakes a panel", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const arena = record("arena", { tabLoaded: true, panel: false });
  const h = bootBoost({ tabs: [selected, arena.tab], records: [arena] });
  await h.sleepAll();
  assert.equal(h.reloadCalls.length, 0, "nothing was reloaded by the sleep");

  const started = h.api.restoreSession();
  assert.equal(started.panels, 0, "no panel task is queued");
  assert.equal(started.tabTasks, 1);
  await h.flushAll();
  assert.equal(h.reloadCalls.length, 1, "the tab is reloaded in the background");
  assert.equal(h.reloadCalls[0], arena.tab);
  assert.deepEqual(h.wakeCalls, [], "loadEssentialInBackground was never called");
  h.destroy();
});

test("panel-only record: Restore wakes the panel once and does not reload the pending tab", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const whatsapp = record("whatsapp", { tabLoaded: false, panel: true });
  const h = bootBoost({ tabs: [selected, whatsapp.tab], records: [whatsapp] });
  await h.sleepAll();

  const started = h.api.restoreSession();
  assert.equal(started.panels, 1);
  assert.equal(started.tabTasks, 0);
  await h.flushAll();
  assert.equal(h.wakeCalls.length, 1);
  assert.equal(h.wakeCalls[0].id, "whatsapp");
  assert.equal(h.wakeCalls[0].automatic, false, "explicit wake, not a preload");
  assert.equal(h.reloadCalls.length, 0);
  h.destroy();
});

test("both holders: Restore wakes the panel first and then the tab", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const messenger = record("messenger", { tabLoaded: true, panel: true });
  const h = bootBoost({ tabs: [selected, messenger.tab], records: [messenger] });
  await h.sleepAll();

  const started = h.api.restoreSession();
  assert.equal(started.panels, 1);
  assert.equal(started.tabTasks, 1);
  await h.flushAll();
  assert.equal(h.wakeCalls.length, 1, "the panel holder was woken");
  assert.equal(h.reloadCalls.length, 1, "and the tab holder too");
  const log = plain(h.api.restoreState().log).filter((x) => x.startsWith("panel:") || x.startsWith("tab:"));
  assert.deepEqual(log, ["panel:messenger", "tab:https://messenger.example/"],
    "panels run before tabs, and the panel is the first task");
  h.destroy();
});

test("neither holder: nothing was freed, so Restore creates nothing", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const idle = record("idle", { tabLoaded: false, panel: false });
  const h = bootBoost({ tabs: [selected, idle.tab], records: [idle] });
  h.api.setGameMode(true);
  await h.flushTimers(0);
  h.api.setGameMode(false);
  await h.flushTimers(0);

  const started = h.api.restoreSession();
  assert.equal(started.started, false, "an empty snapshot starts no restore");
  await h.flushAll();
  assert.deepEqual(h.wakeCalls, []);
  assert.equal(h.reloadCalls.length, 0);
  h.destroy();
});

test("a tab-only record is not reloaded into a second holder when its app became a live panel", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const arena = record("arena", { tabLoaded: true, panel: false });
  const h = bootBoost({ tabs: [selected, arena.tab], records: [arena] });
  await h.sleepAll();
  assert.equal(h.appBrowsers.has("arena"), false, "the page lived only in its tab");

  // The person opens arena.ai in its panel after the sleep: the page is live again, so Restore must not reload the
  // pending tab and must not wake a second holder.
  h.appBrowsers.set("arena", { _bgalazkaAppId: "arena", isConnected: true });
  const started = h.api.restoreSession();
  await h.flushAll();
  assert.equal(started.panels, 0);
  assert.equal(h.reloadCalls.length, 0, "no second holder was created");
  assert.deepEqual(h.wakeCalls, []);
  assert.ok(plain(h.api.restoreState().log).includes("skip:tab:https://arena.example/"));
  h.destroy();
});

/* ---------- 5: the owner's mixed session ---------- */

test("an owner-like session restores 3 panels and 39 tabs, and creates no extra panel", async () => {
  const tabs = [makeTab({ url: "https://selected.example/", label: "selected" })];
  const records = [];
  for (let i = 0; i < 39; i++) {
    const t = makeTab({ url: `https://pinned-${i}.example/`, label: `pinned-${i}`, pinned: true, lastAccessed: 100 + i });
    tabs.push(t);
  }
  for (const id of ["whatsapp", "messenger", "arena-panel"]) {
    const r = record(id, { tabLoaded: false, panel: true });
    tabs.push(r.tab);
    records.push(r);
  }
  const h = bootBoost({ tabs, records });
  h.api.setGameMode(true);
  await h.flushTimers(0);
  const state = plain(h.api.gameModeState());
  assert.deepEqual(state.unloaded, { tabs: 39, panels: 3 }, "39 tabs slept as tabs, 3 apps as apps");
  assert.equal(state.snapshot.tabs, 39);
  assert.equal(state.snapshot.panels, 3);
  h.api.setGameMode(false);
  await h.flushTimers(0);

  const started = h.api.restoreSession();
  assert.equal(started.panels, 3, "exactly the three panel records");
  assert.equal(started.tabTasks, 39, "exactly the 39 tab-only pages");
  await h.flushAll(60);
  assert.equal(h.wakeCalls.length, 3, "three panel wakes");
  assert.equal(h.reloadCalls.length, 39, "39 background tab reloads");
  assert.equal(h.wakeCalls.filter((w) => !["whatsapp", "messenger", "arena-panel"].includes(w.id)).length, 0,
    "no panel was created for a tab-only page");
  h.destroy();
});

/* ---------- 6: legacy entries with no `holders` ---------- */

test("legacy panel entries: wasLoaded false creates no panel, wasLoaded true creates one", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const h = bootBoost({ tabs: [selected] });
  // Data written by an older build: no `holders`, only the old boolean.
  const skipped = h.api.normalizePanelRestoreEntry({ appId: "never-in-panel", wasLoaded: false, when: 1 });
  const restored = h.api.normalizePanelRestoreEntry({ appId: "really-in-panel", wasLoaded: true, when: 2 });
  assert.deepEqual(plain(skipped.holders), { panel: false, tab: false });
  assert.deepEqual(plain(restored.holders), { panel: true, tab: false });
  assert.equal(h.api.panelHadHolder(skipped), false, "no panel task, so no panel is created");
  assert.equal(h.api.panelHadHolder(restored), true, "one panel task");
  // An entry that already carries `holders` is passed through untouched, and a plain tab entry is never an app.
  const modern = { appId: "arena", holders: { panel: false, tab: true }, wasLoaded: false };
  assert.equal(h.api.normalizePanelRestoreEntry(modern), modern);
  assert.equal(h.api.panelHadHolder(modern), false);
  assert.equal(h.api.panelHadHolder({ appId: "x" }), false, "no holders and no wasLoaded means no panel");
  // The engine really uses these two functions, in both the session and the legacy undo road.
  assert.match(BOOST_SRC, /if \(!panelHadHolder\(entry\)\) return false;/);
  assert.match(BOOST_SRC, /if \(!panelHadHolder\(entry\)\) return false;\n(.*\n)*?\s+seenPanels\.add\(id\);/);
  assert.match(BOOST_SRC, /undoState\.panels\.map\(\(entry\) => normalizePanelRestoreEntry\(\{/);
  assert.match(BUNDLE_SRC, /function normalizePanelRestoreEntry\(entry\) \{/);
  h.destroy();
});

/* ---------- 7: deep pass then the legacy restore() door ---------- */

test("a deep pass followed by restore() leaves tab-only records alone", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const tabOnly = record("library", { tabLoaded: true, panel: false });
  const panelOnly = record("whatsapp", { tabLoaded: false, panel: true });
  const h = bootBoost({ tabs: [selected, tabOnly.tab, panelOnly.tab], records: [tabOnly, panelOnly] });
  const pending = h.api.runLevel2({ allowModes: ["asleep-allowed"] });
  await h.flushTimers(3000);
  const result = await pending;
  assert.deepEqual(plain(result.unloaded), { tabs: 1, panels: 1 });

  const restored = h.api.restore();
  assert.equal(restored.panels, 1, "only the record that lived in a panel");
  assert.deepEqual(h.wakeCalls.map((w) => w.id), ["whatsapp"]);
  assert.equal(h.reloadCalls.length, 0, "the panels-only door never reloads a tab");
  h.destroy();
});

/* ---------- 8: idempotence ---------- */

test("a second restoreSession() finds an empty snapshot and creates nothing", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const arena = record("arena", { tabLoaded: true, panel: false });
  const h = bootBoost({ tabs: [selected, arena.tab], records: [arena] });
  await h.sleepAll();
  h.api.restoreSession();
  await h.flushAll();
  assert.equal(h.reloadCalls.length, 1);

  const again = h.api.restoreSession();
  await h.flushAll();
  assert.equal(again.started, false);
  assert.equal(h.reloadCalls.length, 1, "still exactly one reload");
  assert.deepEqual(h.wakeCalls, []);
  h.destroy();
});

/* ---------- 10: profiles still behave with the new entry types ---------- */

test("profiles recent/panels/none/all keep their meaning with record-backed tabs", async () => {
  const build = async (profile, extra = {}) => {
    const selected = makeTab({ url: "https://selected.example/", label: "selected" });
    const t1 = record("tab-old", { tabLoaded: true, panel: false });
    t1.tab.lastAccessed = 10;
    const t2 = record("tab-new", { tabLoaded: true, panel: false });
    t2.tab.lastAccessed = 90;
    const p = record("panel-app", { tabLoaded: false, panel: true });
    const h = bootBoost({ tabs: [selected, t1.tab, t2.tab, p.tab], records: [t1, t2, p] });
    await h.sleepAll();
    const started = h.api.restoreSession({ profile, ...extra });
    await h.flushAll(50);
    return { started, h };
  };

  const all = await build("all");
  assert.equal(all.started.panels, 1);
  assert.equal(all.started.tabTasks, 2);
  assert.equal(all.h.reloadCalls.length, 2);
  all.h.destroy();

  const recent = await build("recent");
  assert.equal(recent.started.tabTasks, 2, "fewer tabs than the recent limit, so both are queued");
  assert.equal(recent.h.reloadCalls.length, 2);
  recent.h.destroy();

  const limited = await build("recent", { recentN: 1 });
  assert.equal(limited.started.tabTasks, 1, "recent limits the tab list to its N");
  assert.equal(limited.h.reloadCalls.length, 1);
  limited.h.destroy();

  const panels = await build("panels");
  assert.equal(panels.started.panels, 1, "the panels profile restores panel entries only");
  assert.equal(panels.started.tabTasks, 0, "a record tab belongs to the tab list");
  assert.equal(panels.h.reloadCalls.length, 0);
  assert.deepEqual(panels.h.wakeCalls.map((w) => w.id), ["panel-app"]);
  panels.h.destroy();

  const none = await build("none");
  assert.equal(none.started.panels, 0);
  assert.equal(none.started.tabTasks, 0);
  assert.deepEqual(none.h.wakeCalls, []);
  assert.equal(none.h.reloadCalls.length, 0);
  none.h.destroy();
});

test("the standalone bundle carries the same holder filter and no polling", () => {
  assert.match(BUNDLE_SRC, /function panelHadHolder\(entry\) \{/);
  assert.match(BUNDLE_SRC, /hadPanelHolder/);
  assert.doesNotMatch(BUNDLE_SRC, /setInterval\(/);
  assert.match(BOOST_SRC, /if \(appId && entry\?\.hadPanelHolder !== true && livePanelBrowser\(appId\)\) return false;/);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed += 1;
    console.log("ok -", name);
  }
  console.log(`\n${passed}/${tests.length} R2 restore-engine tests passed`);
})().catch((error) => {
  console.error("FAIL:", error?.message || error);
  console.error(error?.stack || "");
  process.exit(1);
});
