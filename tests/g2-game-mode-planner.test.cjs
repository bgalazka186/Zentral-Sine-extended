"use strict";
/* G2 — the pure Game Mode planner and its on-demand dry run. RED on the
 * pre-G2 tree (no planGameMode / previewGameMode, no game_keep_hosts or
 * game_park_selected). Game Mode consent means pinned/Essential tabs and EVERY
 * panel record mode are candidates; the policy's NEVER rules still win.
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
const BUNDLE_SRC = read("additional/boost/ZentralBoost.standalone.uc.js");
const SETTINGS = json("additional/boost/settings.json");
const ROOT_PREFS = json("preferences.json");
const STANDALONE_PREFS = json("additional/boost/preferences.json");
const LAYOUT = json("extension/settings/layout.json");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
// Arrays built inside the VM realm do not share this realm's prototypes.
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
    isConnected: true,
    hidden: false,
    linkedPanel: attrs.has("pending") || attrs.has("discarded") ? null : "panel1",
    linkedBrowser: {
      currentURI: { spec: spec.url || "https://example.com/" },
      isPictureInPicture: Boolean(spec.pip),
      audioPlaybackActive: false,
    },
    lastAccessed: spec.lastAccessed || 0,
    soundPlaying: Boolean(spec.soundPlaying),
    _sharingState: spec.sharing || null,
    label: spec.label || spec.url || "tab",
    pinned: Boolean(spec.pinned),
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => (attrs.has(name) ? "" : null),
    matches: () => false,
    _attrs: attrs,
  };
}
const record = (id, mode, spec = {}) => ({
  app: { id, name: id, url: "https://example.com/" },
  tab: tab({ pinned: true, url: `https://${id}.example/`, ...spec }),
  backgroundMode: mode,
});

function bootBoost({ tabs = [], records = [], prefs = {}, addTab = true } = {}) {
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    ...prefs,
  }));
  const timers = new Map();
  let timerId = 0;
  let registration = null;
  let procReads = 0;
  const unloadCalls = [];
  const prefWrites = [];
  const gBrowser = {
    tabs,
    selectedTab: tabs[0] || null,
    explicitUnloadTabs: async (list) => { unloadCalls.push(...list); return true; },
    ...(addTab ? { addTab: () => ({ isConnected: true }) } : {}),
  };
  const win = {
    gBrowser,
    Services: {
      prefs: {
        getBoolPref: (k, d) => (store.has(k) ? Boolean(store.get(k)) : d),
        getStringPref: (k, d) => (store.has(k) ? String(store.get(k)) : d),
        getIntPref: (k, d) => (store.has(k) ? Number(store.get(k)) : d),
        setBoolPref: (k, v) => { prefWrites.push([k, v]); store.set(k, v); },
        setStringPref: (k, v) => { prefWrites.push([k, v]); store.set(k, v); },
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
    Apps: { closeApp() {}, appBrowsers: new Map() },
    Panels: {
      essentialPanels: new Map(records.map((r) => [r.app.id, r])),
      getAllAppBrowsers: () => [],
      loadEssentialInBackground: () => true,
    },
  };
  const context = vm.createContext({
    ...win,
    ChromeUtils: {
      requestProcInfo: () => { procReads++; return { memory: 900 * MB }; },
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
    win, api: win.ZentralBoost, gBrowser, store, timers, unloadCalls, prefWrites,
    procReads: () => procReads,
    destroy: () => win.ZentralBoost.destroy(),
  };
}

const ctxFor = (overrides = {}) => ({
  isAudible: (t) => policy.isAudible(t),
  isUnloadable: (t, c) => policy.isUnloadable(t, c),
  isPrivate: () => false,
  hostOf: (t) => {
    try { return new URL(t.linkedBrowser.currentURI.spec).hostname; } catch (_) { return ""; }
  },
  ...overrides,
});

test("the pure planner is exposed and shipped in the standalone bundle", () => {
  const h = bootBoost();
  assert.equal(typeof h.api.planGameMode, "function");
  assert.equal(typeof h.api.previewGameMode, "function");
  assert.match(BOOST_SRC, /function planGameMode\(input/);
  assert.match(BUNDLE_SRC, /function planGameMode\(input/);
  h.destroy();
});

test("Game Mode consent includes pinned, Essential and EVERY panel mode", () => {
  const h = bootBoost();
  const pinned = tab({ pinned: true, url: "https://pinned/" });
  const essential = tab({ attrs: ["zen-essential"], url: "https://essential/" });
  const normal = tab({ url: "https://normal/" });
  const live = record("whatsapp", "live");
  const throttled = record("messenger", "throttled");
  const asleep = record("arena", "asleep-allowed");
  const plan = h.api.planGameMode({
    tabs: [pinned, essential, normal],
    panelRecords: [live, throttled, asleep],
    selectedTab: null,
    ...ctxFor(),
  });
  assert.deepEqual(plain(plan.sleepTabs.map((t) => t.linkedBrowser.currentURI.spec)),
    ["https://pinned/", "https://essential/", "https://normal/"]);
  assert.deepEqual(plain(plan.sleepPanels.map((r) => r.app.id)), ["whatsapp", "messenger", "arena"]);
  assert.equal(plan.keep.length, 0);
  h.destroy();
});

test("every NEVER rule keeps its own named reason, and a refusal is never forced", () => {
  const h = bootBoost();
  const audible = tab({ soundPlaying: true, url: "https://music/" });
  const source = tab({ url: "https://video/" });
  const host = tab({ url: "https://sub.bank.example.com/" });
  const parking = tab({ attrs: ["zentral-boost-parking"], url: "about:blank" });
  const pending = tab({ attrs: ["pending"], url: "https://pending/" });
  const sharing = tab({ sharing: { screen: "window:1" }, url: "https://call/" });
  const pip = tab({ pip: true, url: "https://pip/" });
  const privateTab = tab({ url: "https://private/" });
  const refused = tab({ url: "https://refused/" });
  const ordinary = tab({ url: "https://ordinary/" });
  const tabs = [audible, source, host, parking, pending, sharing, pip, privateTab, refused, ordinary];
  const plan = h.api.planGameMode({
    tabs,
    videoSourceTab: source,
    keepHosts: ["bank.example.com"],
    selectedTab: null,
    ...ctxFor({
      isPrivate: (t) => t === privateTab,
      refused: (t) => t === refused,
    }),
  });
  const byReason = new Map(plan.keep.map((k) => [k.reason, k]));
  for (const reason of ["audible", "video-source", "keep-host", "parking-tab", "pending", "sharing", "picture-in-picture", "private-tab", "refused"])
    assert.ok(byReason.has(reason), `${reason} must be kept`);
  assert.equal(byReason.get("keep-host").kind, "tab");
  assert.equal(plan.sleepTabs.length, 1, "only the ordinary tab may sleep");
  assert.equal(plan.sleepTabs[0], ordinary);
  assert.equal(plan.park, null);
  h.destroy();
});

test("the selected tab is parked only when parking is on and possible", () => {
  const h = bootBoost();
  const selected = tab({ url: "https://selected/" });
  const other = tab({ url: "https://other/" });
  const base = { tabs: [selected, other], selectedTab: selected, ...ctxFor() };
  const on = h.api.planGameMode({ ...base, parkSelected: true, canPark: true });
  assert.equal(on.park, selected, "one parking tab is planned");
  assert.ok(on.sleepTabs.includes(selected), "the selected tab is unloaded too");
  assert.ok(!on.keep.some((k) => k.reason === "selected"));
  for (const opts of [{ parkSelected: false, canPark: true }, { parkSelected: true, canPark: false }]) {
    const off = h.api.planGameMode({ ...base, ...opts });
    assert.equal(off.park, null);
    assert.ok(off.keep.some((k) => k.reason === "selected" && k.kind === "tab"));
    assert.ok(!off.sleepTabs.includes(selected));
  }
  h.destroy();
});

test("a pending panel record still sleeps its app browser, but audible/selected/video panels are kept", () => {
  const h = bootBoost();
  const pendingPanel = record("pending-app", "live", { attrs: ["pending"] });
  const audiblePanel = record("audio-app", "live", { soundPlaying: true });
  const source = record("source-app", "live");
  const selectedPanel = record("selected-app", "live");
  const plan = h.api.planGameMode({
    tabs: [],
    panelRecords: [pendingPanel, audiblePanel, source, selectedPanel],
    videoSourceTab: source.tab,
    selectedTab: selectedPanel.tab,
    parkSelected: false,
    ...ctxFor(),
  });
  assert.deepEqual(plain(plan.sleepPanels.map((r) => r.app.id)), ["pending-app"],
    "a pending tab can still hold a loaded panel browser");
  assert.deepEqual(plain(plan.keep.map((k) => `${k.id}:${k.reason}`).sort()),
    ["audio-app:audible", "selected-app:selected", "source-app:video-source"].sort());
  h.destroy();
});

test("previewGameMode() is a dry run: counts only, no writes, no timers, no RAM sample", () => {
  const ordinary = tab({ url: "https://a/" });
  const pinned = tab({ pinned: true, url: "https://b.example/" });
  const r = record("app", "live");
  const h = bootBoost({
    tabs: [ordinary, pinned, r.tab],
    records: [r],
    prefs: { "zen.workspace.zentral.boost.game_keep_hosts": "b.example" },
  });
  h.gBrowser.selectedTab = ordinary;
  const beforeTimers = h.timers.size;
  const beforeReads = h.procReads();
  const plan = h.api.previewGameMode();
  assert.ok(plan.counts, "counts for the widget hint");
  assert.equal(typeof plan.counts.tabs, "number");
  assert.equal(typeof plan.counts.panels, "number");
  assert.equal(plan.park, ordinary, "parking is planned with the default pref on");
  assert.ok(plan.keep.some((k) => k.reason === "keep-host"), "the host allow-list is read live");
  assert.equal(h.unloadCalls.length, 0, "no tab was unloaded");
  assert.deepEqual(h.prefWrites, [], "no pref was written");
  assert.equal(h.timers.size, beforeTimers, "no timer was armed");
  assert.equal(h.procReads(), beforeReads, "no extra RAM sample");
  h.destroy();
});

test("preview reads the two new prefs live and the old defaults are unchanged", () => {
  const selected = tab({ url: "https://selected/" });
  const h = bootBoost({
    tabs: [selected],
    prefs: { "zen.workspace.zentral.boost.game_park_selected": false },
  });
  h.gBrowser.selectedTab = selected;
  const off = h.api.previewGameMode();
  assert.equal(off.park, null);
  assert.ok(off.keep.some((k) => k.reason === "selected"));
  h.destroy();
  // Defaults of existing switches are not silently changed by G2.
  assert.equal(SETTINGS.schema.find((x) => x.property === "zen.workspace.zentral.boost.unload_pinned").defaultValue, false);
  assert.equal(SETTINGS.schema.find((x) => x.property === "zen.workspace.zentral.boost.stronger_saver").defaultValue, false);
});

test("both new prefs are owned, placed, generated and covered by G11's checker", () => {
  const keys = [
    "zen.workspace.zentral.boost.game_keep_hosts",
    "zen.workspace.zentral.boost.game_park_selected",
  ];
  for (const key of keys) {
    const item = SETTINGS.schema.find((x) => x.property === key);
    assert.ok(item, `${key} is owned by Boost`);
    assert.equal(SETTINGS.settings[key].category, "boost");
    assert.equal(SETTINGS.settings[key].section, "Game Mode");
    assert.equal(SETTINGS.settings[key].owner, "boost");
    assert.ok(LAYOUT.order.includes(key), `${key} is in layout.order`);
    assert.ok(ROOT_PREFS.some((p) => p.property === key), `${key} is in root preferences.json`);
    assert.ok(STANDALONE_PREFS.some((p) => p.property === key), `${key} is in standalone preferences.json`);
  }
  assert.equal(SETTINGS.schema.find((x) => x.property === keys[0]).defaultValue, "");
  assert.equal(SETTINGS.schema.find((x) => x.property === keys[1]).defaultValue, true);
  const out = cp.spawnSync(process.execPath, [path.join(ROOT, "tools/check-settings-consistency.cjs")],
    { cwd: ROOT, encoding: "utf8" });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /catalog checks passed/);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\ng2-game-mode-planner (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
