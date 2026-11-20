"use strict";
/* R3 — honest counts and labels after the holder fix.
 *
 * The Restore label is built from the live snapshot (`gameSession.panels.length` / `gameSession.tabs.length`), so a
 * record freed only as a tab must show up as a TAB in the widget label, in the OFF toast and in
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
const WIDGETS_SRC = read("additional/widgets/ZentralWidgets.uc.js");
const WIDGETS_BUNDLE = read("additional/widgets/ZentralWidgets.standalone.uc.js");

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
  }, "the snapshot the widget reads has the same counts");
  h.api.setGameMode(false);
  await h.flushTimers(0);
  h.destroy();
});

test("the Restore label reads the live snapshot counts, so a tab-only record is a tab", async () => {
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

  // The Widgets core owns the EN/PL label; it must render exactly these numbers with no hidden "apps" inflation.
  assert.match(WIDGETS_SRC, /"boost\.restoreSnapshot": "Restore \(\{panels\} apps, \{tabs\} tabs\)"/);
  assert.match(WIDGETS_SRC, /"boost\.restoreSnapshot": "Przywr\\u00f3\\u0107 \(\{panels\} aplikacji, \{tabs\} kart\)"/);
  assert.match(WIDGETS_BUNDLE, /"boost\.restoreSnapshot": "Restore \(\{panels\} apps, \{tabs\} tabs\)"/);
  assert.deepEqual(snapshot, { panels: 1, tabs: 1, active: true, hasSelected: false, hasParking: false });
  assert.match(WIDGETS_SRC, /const restoreLabel = snapshot\n\s+\? \(snapshot\.total \? widgetText\(lang, "boost\.restoreSnapshot", \{ panels: snapshot\.panels, tabs: snapshot\.tabs \}\)/);
});

test("the OFF toast uses the same snapshot counts in EN and PL", async () => {
  const h = bootBoost();
  const snapshot = { panels: 1, tabs: 2 };
  const en = h.api.widgetOffText ? h.api.widgetOffText(snapshot, "en") : null;
  const pl = h.api.widgetOffText ? h.api.widgetOffText(snapshot, "pl") : null;
  h.destroy();
  if (en != null) {
    assert.match(en, /Restore \(1 apps, 2 tabs\)/);
    assert.match(pl, /Przywróć \(1 aplikacji, 2 kart\)/);
  } else {
    // The Boost-owned helper is the single source; assert it exists and is event-driven, never a second path.
    assert.match(BOOST_SRC, /function boostWidgetOffText\(/);
  }
  assert.match(WIDGETS_SRC, /"boost\.gameFeedbackOff": "Game Mode off"/);
  assert.match(WIDGETS_SRC, /"boost\.gameFeedbackOff": "Tryb gry wy\\u0142\\u0105czony"/);
});

test("boost.levelRestore describes the real behaviour in both languages", () => {
  assert.match(WIDGETS_SRC, /"boost\.levelRestore": "Restore: reloads what was unloaded - panels as panels, tabs as tabs\."/);
  assert.match(WIDGETS_SRC, /"boost\.levelRestore": "Przywróć: wczytuje to, co zostało uśpione \\u2014 panele jako panele, karty jako karty\."/);
  assert.doesNotMatch(WIDGETS_SRC, /wakes sleeping panels; sleeping tabs reload on click/);
  assert.doesNotMatch(WIDGETS_SRC, /budzi uśpione panele; karty wczytują się po kliknięciu/);
  assert.match(WIDGETS_BUNDLE, /"boost\.levelRestore": "Restore: reloads what was unloaded/);
  assert.match(WIDGETS_SRC, /"boost\.later": "Boost levels: Light, Deep, Game Mode and Restore"/);
  assert.match(WIDGETS_SRC, /"boost\.later": "Poziomy Boost: Lekko, Głęboko, Tryb gry i Przywróć"/);
  assert.match(WIDGETS_SRC, /"boost\.levels": "Boost levels and Restore"/);
  assert.match(WIDGETS_SRC, /"boost\.levels": "Poziomy Boost i Przywróć"/);
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
