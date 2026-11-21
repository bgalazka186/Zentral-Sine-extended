"use strict";
/* R3 — honest counts and labels after the holder fix.
 *
 * The Restore label is built from the live snapshot (`gameSession.panels.length` / `gameSession.tabs.length`), so a
 * record freed only as a tab must show up as a TAB in the shared Boost-card label, in the OFF toast and in
 * `gameModeState().unloaded`. The old `boost.levelRestore` wording ("wakes sleeping panels; sleeping tabs reload on
 * click") described the broken behaviour and is replaced in both languages.
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
const BOOST_WIDGET_HELPERS = (() => {
  const start = BOOST_SRC.indexOf("  const BOOST_WIDGET_STRINGS = Object.freeze({");
  const end = BOOST_SRC.indexOf("  // B5/OW-92", start);
  if (start < 0 || end <= start) throw new Error("Boost-owned card helpers are missing");
  return new Function(BOOST_SRC.slice(start, end) + `
    return {
      strings: BOOST_WIDGET_STRINGS,
      text: boostWidgetText,
      menu: boostWidgetMenuItems,
      preview: boostWidgetPreviewText,
      restoreLabel: boostWidgetRestoreLabel,
      feedback: boostWidgetFeedbackText,
      offText: boostWidgetOffText,
      resultText: boostWidgetResultText,
      skippedCount: boostWidgetSkippedCount,
    };
  `)();
})();

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
  return {
    label: spec.label || spec.url || "tab",
    lastAccessed: spec.lastAccessed || 0,
    pinned: Boolean(spec.pinned),
    closing: false,
    isConnected: true,
    linkedPanel: spec.pending ? null : "panel-" + Math.random(),
    soundPlaying: false,
    _sharingState: null,
    linkedBrowser: {
      currentURI: { spec: spec.url || "https://example.com/" },
      isPictureInPicture: false,
      audioPlaybackActive: false,
      reload() { return true; },
    },
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value = "") => attrs.set(name, String(value)),
    removeAttribute: (name) => attrs.delete(name),
    matches: () => false,
    _attrs: attrs,
  };
}

const record = (appId, { tabLoaded = true, panel = true } = {}) => {
  const tab = makeTab({ url: `https://${appId}.example/`, label: appId, pinned: true, pending: !tabLoaded });
  const r = { app: { id: appId, name: appId }, tab, backgroundMode: "asleep-allowed" };
  if (panel) r.browser = { _bgalazkaAppId: appId, isConnected: true };
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
  const allTabs = [...tabs];
  const appBrowsers = new Map(records.filter((r) => r.browser).map((r) => [r.app.id, r.browser]));
  const essentialPanels = new Map(records.map((r) => [r.app.id, r]));
  const gBrowser = {
    tabs: allTabs,
    get selectedTab() { return selected; },
    set selectedTab(tab) { selected = tab; },
    async explicitUnloadTabs(list) {
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
      closeApp(id) { appBrowsers.delete(id); },
    },
    Panels: {
      essentialPanels,
      getAllAppBrowsers: () => [...appBrowsers.values()],
      loadEssentialInBackground: () => true,
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
  return {
    win,
    api: win.ZentralBoost,
    destroy: () => win.ZentralBoost.destroy(),
    async flushTimers(ms = 0, rounds = 12) {
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

test("a mixed sleep reports tab-only records as TABS in gameModeState().unloaded and the snapshot", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const tabOnly = record("arena", { tabLoaded: true, panel: false });
  const panelOnly = record("whatsapp", { tabLoaded: false, panel: true });
  const h = bootBoost({ tabs: [selected, tabOnly.tab, panelOnly.tab], records: [tabOnly, panelOnly] });
  h.api.setGameMode(true);
  await h.flushTimers(0);
  const state = plain(h.api.gameModeState());
  assert.deepEqual(state.unloaded, { tabs: 1, panels: 1 },
    "arena is a tab, whatsapp is an app");
  assert.deepEqual(state.snapshot, {
    panels: 1, tabs: 1, active: true, hasSelected: false, hasParking: false,
  }, "the snapshot the shared Boost card reads has the same counts");
  h.api.setGameMode(false);
  await h.flushTimers(0);
  h.destroy();
});

test("the pre-ON preview counts by holder, and agrees with what Game Mode then frees", async () => {
  const build = () => {
    const selected = makeTab({ url: "https://selected.example/", label: "selected" });
    const tabOnly = record("arena", { tabLoaded: true, panel: false });
    const panelOnly = record("whatsapp", { tabLoaded: false, panel: true });
    const both = record("messenger", { tabLoaded: true, panel: true });
    return bootBoost({
      tabs: [selected, tabOnly.tab, panelOnly.tab, both.tab],
      records: [tabOnly, panelOnly, both],
    });
  };
  const previewing = build();
  const preview = previewing.api.previewGameMode();
  // arena is a tab-only record, whatsapp a panel-only record, messenger has both holders.
  assert.deepEqual(plain(preview.counts), { tabs: 2, panels: 2 },
    "two tabs (arena, messenger) and two apps (whatsapp, messenger)");
  previewing.destroy();

  const running = build();
  running.api.setGameMode(true);
  await running.flushTimers(0);
  const state = plain(running.api.gameModeState());
  assert.deepEqual(state.unloaded, { tabs: 2, panels: 2 },
    "the preview promised exactly what the pass freed");
  assert.deepEqual(state.snapshot.panels, 2);
  assert.deepEqual(state.snapshot.tabs, 2);
  running.api.setGameMode(false);
  await running.flushTimers(0);
  running.destroy();
  assert.match(BOOST_SRC, /counts: \{ tabs: previewTabs, panels: previewPanels \}/);
});

test("the Boost-owned Restore label reads live snapshot counts, so a tab-only record is a tab", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const tabOnly = record("arena", { tabLoaded: true, panel: false });
  const panelOnly = record("whatsapp", { tabLoaded: false, panel: true });
  const h = bootBoost({ tabs: [selected, tabOnly.tab, panelOnly.tab], records: [tabOnly, panelOnly] });
  h.api.setGameMode(true);
  await h.flushTimers(0);
  const snapshot = plain(h.api.gameModeState().snapshot);
  h.api.setGameMode(false);
  await h.flushTimers(0);
  h.destroy();

  assert.deepEqual(snapshot, { panels: 1, tabs: 1, active: true, hasSelected: false, hasParking: false });
  assert.equal(BOOST_WIDGET_HELPERS.restoreLabel(snapshot, "en"), "Restore (1 apps, 1 tabs)");
  assert.equal(BOOST_WIDGET_HELPERS.restoreLabel(snapshot, "pl"), "Przywróć (1 aplikacji, 1 kart)");
});

test("the Boost-owned OFF toast uses the same snapshot counts in EN and PL", () => {
  const snapshot = { panels: 1, tabs: 2 };
  assert.equal(BOOST_WIDGET_HELPERS.offText(snapshot, "en"), "Game Mode off · Restore (1 apps, 2 tabs)");
  assert.equal(BOOST_WIDGET_HELPERS.offText(snapshot, "pl"), "Tryb gry wyłączony · Przywróć (1 aplikacji, 2 kart)");
  assert.equal(BOOST_WIDGET_HELPERS.offText({ panels: 0, tabs: 0 }, "en"), "Game Mode off");
});

test("Boost-owned descriptions explain Restore in both languages", () => {
  assert.equal(BOOST_WIDGET_HELPERS.strings.en["card.restoreHint"],
    "Restore: reloads what was unloaded — panels as panels, tabs as tabs.");
  assert.equal(BOOST_WIDGET_HELPERS.strings.pl["card.restoreHint"],
    "Przywróć: wczytuje to, co zostało uśpione — panele jako panele, karty jako karty.");
  assert.notEqual(BOOST_WIDGET_HELPERS.strings.pl["card.restoreHint"], BOOST_WIDGET_HELPERS.strings.en["card.restoreHint"]);
});

test("the Boost README documents the holders table and the panels-profile rule", () => {
  const README = read("additional/boost/README.md");
  assert.match(README, /\| Before the sleep \| After Restore \|/);
  assert.match(README, /page lived only in the record's TAB/);
  assert.match(README, /the tab is reloaded in the background; \*\*no\*\* panel is created/);
  assert.match(README, /page lived only in the PANEL app browser/);
  assert.match(README, /both were loaded \| both come back, panel first and then the tab/);
  assert.match(README, /the `panels` profile does \*\*not\*\* reload it/);
  assert.match(README, /- \*\*Restore\*\* — reloads what was unloaded: panels as panels, tabs as tabs\./);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed += 1;
    console.log("ok -", name);
  }
  console.log(`\n${passed}/${tests.length} R3 count/label tests passed`);
})().catch((error) => {
  console.error("FAIL:", error?.message || error);
  console.error(error?.stack || "");
  process.exit(1);
});
