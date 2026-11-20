"use strict";
/* G4 — park and unload the selected tab. RED on the pre-G4 tree: there was no
 * parking tab, no deferred selection, and `game_park_selected` had no writer.
 * The Notes `onZenSelect` hazard is the reason every selection change here is
 * asserted to happen only after a 0 ms scope timer, never inside TabSelect.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const MB = 1_000_000;

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const BUNDLE_SRC = read("additional/boost/ZentralBoost.standalone.uc.js");
const SETTINGS = json("additional/boost/settings.json");
const PARKING_ATTR = "zentral-boost-parking";

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

function bootBoost({
  tabs = [], records = [], prefs = {}, browserApi = true,
  refuseSelection = null, refuseUnload = false, addTabThrows = false,
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
  const addTabCalls = [];
  const removeTabCalls = [];
  const unloadCalls = [];
  const selectionWrites = [];
  const allTabs = [...tabs];
  const gBrowser = {
    tabs: allTabs,
    get selectedTab() { return selected; },
    set selectedTab(tab) {
      selectionWrites.push(tab);
      if (refuseSelection && refuseSelection(tab)) return;
      selected = tab;
    },
    get selectedBrowser() { return selected?.linkedBrowser || null; },
    async explicitUnloadTabs(list) {
      unloadCalls.push(...list);
      if (refuseUnload === "throw") throw new Error("beforeunload refused");
      if (refuseUnload) return false;
      for (const tab of list) {
        tab.setAttribute("pending", "true");
        tab.linkedPanel = null;
      }
      return true;
    },
  };
  if (browserApi) {
    gBrowser.addTab = (url, options) => {
      addTabCalls.push({ url, options });
      if (addTabThrows) throw new Error("addTab refused");
      const tab = makeTab({ url, label: "Boost parking", lastAccessed: Date.now() });
      allTabs.push(tab);
      return tab;
    };
    gBrowser.removeTab = (tab, options) => {
      removeTabCalls.push({ tab, options });
      const index = allTabs.indexOf(tab);
      if (index >= 0) allTabs.splice(index, 1);
      tab.remove?.();
    };
  }
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
    Apps: { appBrowsers: new Map(), closeApp() {} },
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
    api, win, gBrowser, principal, allTabs, store,
    addTabCalls, removeTabCalls, unloadCalls, selectionWrites,
    get selected() { return selected; },
    set selected(tab) { gBrowser.selectedTab = tab; },
    destroy: () => api.destroy(),
    async flushTimers(ms = 0) {
      for (let round = 0; round < 10; round++) {
        const due = [...timers].filter(([, t]) => ms == null || t.ms === ms);
        for (const [id, t] of due) {
          timers.delete(id);
          t.fn();
        }
        for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
  };
}

test("the parking API and the standalone bundle are present", () => {
  const h = bootBoost();
  assert.equal(typeof h.api.parkSelected, "function");
  assert.equal(typeof h.api.unparkSelected, "function");
  assert.equal(typeof h.api.parkingState, "function");
  assert.match(BOOST_SRC, /const PARKING_ATTR = "zentral-boost-parking"/);
  assert.match(BUNDLE_SRC, /function parkSelected\(/);
  assert.doesNotMatch(BOOST_SRC, /setInterval\(/);
  h.destroy();
});

test("one parking tab is created with the right options; selection is deferred", async () => {
  const original = makeTab({ url: "https://selected.example/", label: "Selected", userContextId: 7 });
  const h = bootBoost({ tabs: [original] });
  const first = h.api.parkSelected();
  assert.equal(first.created, true);
  assert.equal(first.deferred, true);
  assert.equal(h.addTabCalls.length, 1);
  assert.equal(h.addTabCalls[0].url, "about:blank");
  assert.equal(h.addTabCalls[0].options.skipAnimation, true);
  assert.equal(h.addTabCalls[0].options.skipSessionStore, true);
  assert.equal(h.addTabCalls[0].options.userContextId, 7);
  assert.equal(h.addTabCalls[0].options.triggeringPrincipal, h.principal);
  const parked = first.tab;
  assert.equal(parked.hasAttribute(PARKING_ATTR), true);
  assert.equal(parked.hasAttribute("skipSessionStore"), true);
  assert.equal(parked.pinned, false);
  assert.equal(h.selected, original, "no selection change during addTab");
  assert.equal(h.selectionWrites.length, 0, "no TabSelect-time selection write");
  assert.equal(h.unloadCalls.length, 0, "nothing is unloaded before the deferred task");
  assert.equal(h.api.parkSelected().created, false, "a second call cannot create another parking tab");
  assert.equal(h.addTabCalls.length, 1);
  await h.flushTimers(0);
  assert.equal(h.selected, parked, "the parking tab is selected from the 0 ms scope timer");
  assert.equal(h.unloadCalls.length, 1);
  assert.equal(h.unloadCalls[0], original);
  assert.equal(original.hasAttribute("pending"), true);
  const state = plain(h.api.sessionState());
  assert.equal(state.active, true);
  assert.equal(state.hasSelected, true);
  assert.equal(state.hasParking, true);
  assert.equal(state.tabs, 1);
  assert.equal(h.api.sessionEntries().tabs[0].parked, true);
  assert.equal(h.api.parkingState().parked, true);
  h.destroy();
});

test("Game Mode ON consumes the planner, and the old selected-tab behavior stays when the kill switch is off", async () => {
  const original = makeTab({ url: "https://game.example/", label: "Game tab" });
  const on = bootBoost({ tabs: [original] });
  on.api.setGameMode(true);
  assert.equal(on.addTabCalls.length, 1, "one parking tab was created");
  assert.equal(on.selected, original);
  assert.equal(on.api.gameModeState().parking.pending, true);
  await on.flushTimers(0);
  const onParkingTab = on.gBrowser.tabs.find((t) => t.hasAttribute(PARKING_ATTR));
  assert.ok(onParkingTab, "the parking tab is in the strip");
  assert.equal(on.selected, onParkingTab, "Game Mode selected it from the deferred task");
  assert.equal(on.unloadCalls.length, 1);
  assert.equal(on.unloadCalls[0], original);
  assert.equal(on.api.gameModeState().parking.parked, true);
  on.destroy();

  const off = bootBoost({
    tabs: [makeTab({ url: "https://off.example/" })],
    prefs: { "zen.workspace.zentral.boost.game_park_selected": false },
  });
  const keep = off.gBrowser.selectedTab;
  off.api.setGameMode(true);
  assert.equal(off.addTabCalls.length, 0);
  assert.equal(off.selected, keep);
  assert.equal(off.api.parkingState().parked, false);
  assert.equal(off.api.parkingState().pending, false);
  assert.equal(SETTINGS.schema.find((x) => x.property === "zen.workspace.zentral.boost.game_park_selected").defaultValue, true);
  off.destroy();
});

test("no browser API or a refused addTab leaves the session unchanged", async () => {
  const noApi = bootBoost({ tabs: [makeTab({ url: "https://a/" })], browserApi: false });
  const a = noApi.gBrowser.selectedTab;
  const result = noApi.api.parkSelected();
  assert.equal(result.created, false);
  assert.equal(noApi.selected, a);
  assert.equal(plain(noApi.api.sessionState()).active, false);
  noApi.destroy();

  const threw = bootBoost({ tabs: [makeTab({ url: "https://b/" })], addTabThrows: true });
  const b = threw.gBrowser.selectedTab;
  assert.equal(threw.api.parkSelected().reason, "addTab-refused");
  await threw.flushTimers(0);
  assert.equal(threw.selected, b);
  assert.equal(threw.unloadCalls.length, 0);
  assert.equal(plain(threw.api.sessionState()).active, false);
  assert.equal(threw.removeTabCalls.length, 0, "no tab was created to close");
  threw.destroy();
});

test("a refused selection or a refused unload rolls back to the old behavior", async () => {
  for (const mode of ["selection", "unload"]) {
    const original = makeTab({ url: `https://${mode}.example/`, label: mode });
    const h = bootBoost({
      tabs: [original],
      refuseSelection: mode === "selection" ? (tab) => tab.hasAttribute(PARKING_ATTR) : null,
      refuseUnload: mode === "unload",
    });
    const parked = h.api.parkSelected().tab;
    await h.flushTimers(0);
    assert.equal(h.selected, original, `${mode}: the original stays selected`);
    assert.equal(h.unloadCalls.length, mode === "selection" ? 0 : 1,
      `${mode}: only the parking path attempted an unload`);
    assert.equal(original.hasAttribute("pending"), false, `${mode}: no forced close`);
    assert.equal(h.removeTabCalls.length, 1, `${mode}: only Boost's parking tab is closed`);
    assert.equal(h.removeTabCalls[0].tab, parked);
    assert.equal(h.allTabs.includes(parked), false);
    assert.equal(plain(h.api.sessionState()).active, false, `${mode}: no snapshot entry`);
    assert.equal(h.api.sessionEntries().tabs.length, 0);
    assert.equal(h.api.parkingState().parked, false);
    assert.equal(h.api.parkingState().pending, false);
    h.destroy();
  }
});

test("Restore selects the original first and closes the parking tab", async () => {
  const original = makeTab({ url: "https://restore.example/", label: "Restore me" });
  const h = bootBoost({ tabs: [original] });
  const parked = h.api.parkSelected().tab;
  await h.flushTimers(0);
  const writesBefore = h.selectionWrites.length;
  const restored = h.api.restore();
  assert.equal(restored.tabs, 1);
  assert.equal(h.selected, parked, "Restore also defers the selection change");
  assert.equal(h.selectionWrites.length, writesBefore);
  assert.equal(plain(h.api.sessionState()).active, false, "the snapshot is cleared on Restore");
  await h.flushTimers(0);
  assert.equal(h.selected, original, "the pending original is selected, so it loads");
  assert.equal(h.removeTabCalls.length, 1);
  assert.equal(h.removeTabCalls[0].tab, parked);
  assert.equal(h.allTabs.includes(parked), false);
  assert.equal(h.api.parkingState().parked, false);
  assert.equal(h.api.sessionState().hasParking, false);
  h.destroy();
});

test("Game Mode off hands the selection back but keeps the snapshot for Restore", async () => {
  const original = makeTab({ url: "https://exit.example/" });
  const h = bootBoost({ tabs: [original] });
  h.api.setGameMode(true);
  await h.flushTimers(0);
  const parkingTab = h.api.gameModeState().parking.parked ? h.selected : h.gBrowser.tabs.find((t) => t.hasAttribute(PARKING_ATTR));
  assert.ok(parkingTab, "a parking tab exists");
  h.api.setGameMode(false);
  assert.equal(h.selected, parkingTab, "exit defers the hand-back too");
  await h.flushTimers(0);
  assert.equal(h.selected, original);
  assert.equal(h.removeTabCalls.some((call) => call.tab === parkingTab), true);
  const state = plain(h.api.sessionState());
  assert.equal(state.active, true, "Restore still works after Game Mode is off");
  assert.equal(state.hasSelected, true, "G5 needs the original as the first restore item");
  assert.equal(state.hasParking, false);
  h.destroy();
});

test("closing the original while parked selects the nearest normal tab", async () => {
  const original = makeTab({ url: "https://closed.example/", label: "closed" });
  const neighbour = makeTab({ url: "https://neighbour.example/", label: "neighbour" });
  const h = bootBoost({ tabs: [original, neighbour] });
  const parked = h.api.parkSelected().tab;
  await h.flushTimers(0);
  h.gBrowser.removeTab(original, { animate: false });
  const restored = h.api.restore();
  assert.equal(restored.tabs, 0, "a closed element is skipped silently");
  await h.flushTimers(0);
  assert.equal(h.selected, neighbour, "the nearest normal tab takes the selection");
  assert.equal(h.removeTabCalls.some((call) => call.tab === parked), true);
  assert.equal(h.allTabs.includes(parked), false);
  assert.equal(plain(h.api.sessionState()).active, false);
  h.destroy();
});

test("the parking tab is excluded from the planner and the deep pass's unload list", async () => {
  const original = makeTab({ url: "https://exclude.example/" });
  const h = bootBoost({ tabs: [original] });
  const parked = h.api.parkSelected().tab;
  await h.flushTimers(0);
  const plan = h.api.previewGameMode();
  assert.ok(plan.keep.some((entry) => entry.reason === "parking-tab"),
    "the pure planner keeps Boost's own tab");
  // Make the parking tab NOT selected, so the policy's selected rule cannot hide a missing G4 guard.
  h.gBrowser.selectedTab = original;
  const level2 = h.api.runLevel2();
  await h.flushTimers(3000);
  const result = await level2;
  assert.ok(result, "the deep pass completed");
  assert.equal(h.unloadCalls.includes(parked), false, "the deep pass never unloads the parking tab");
  assert.equal(result.unloaded.tabs, 0, "the pending original is not counted twice either");
  assert.match(BOOST_SRC, /isBoostParkingTab\(tab\) \|\| tab === parking\.pendingOriginal/);
  h.destroy();
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\ng4-selected-tab-parking (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
