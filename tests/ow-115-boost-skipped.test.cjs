"use strict";
const MB = 1_000_000; // Firefox ProcInfo.memory is bytes; fixtures are written in MB.
/* OW-115 (owner audit F5, optional): explain a deep pass that did nothing.
 *
 * `runLevel2` already collects named `skipped` reasons but nothing shows them, and there is no way to
 * see how many loaded tabs are pinned vs unpinned. This suite checks the CURRENT behaviour first:
 * grouped reason counts (not just the five-entry sample), a localized popup row, and state counts.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const WIDGET_SRC = read("additional/widgets/ZentralWidgets.uc.js");
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const SETTINGS = JSON.parse(read("additional/widgets/settings.json"));

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ---------------- widget core, through its own test seam ---------------- */

function loadWidgetCore() {
  const seam = {};
  const win = { __zentralWidgetsTestSeam: seam, ZentralRuntime: { register() {} } };
  win.window = win;
  vm.runInNewContext(WIDGET_SRC, {
    window: win, globalThis: { Services: {} }, URL, Date, JSON, Math, Promise, RegExp, Number, String, Array,
    Object, Map, Set, console,
  });
  return seam.core;
}
const c = loadWidgetCore();

test("the grouped reason line is pure, counted, sorted and localized", () => {
  assert.equal(typeof c.boostSkippedLine, "function", "the pure formatter is exported");
  assert.equal(c.boostSkippedLine({ "audible": 2, "pinned-kept": 12, "pending": 1 }),
    "pinned-kept: 12 \u00b7 audible: 2 \u00b7 pending: 1");
  assert.equal(c.boostSkippedLine({ "audible": 0, "pinned-kept": "junk" }), "", "junk is ignored");
  assert.equal(c.boostSkippedLine(null), "");
  // Both languages have their own words, and the popup row is built from them.
  for (const lang of ["en", "pl"]) {
    assert.ok(c.WIDGET_STRINGS[lang]["boost.skipped"], lang + " has the skipped template");
    assert.ok(c.WIDGET_STRINGS[lang]["boost.loaded"], lang + " has the loaded-tabs template");
  }
  assert.notEqual(c.WIDGET_STRINGS.pl["boost.skipped"], c.WIDGET_STRINGS.en["boost.skipped"]);
  assert.notEqual(c.WIDGET_STRINGS.pl["boost.loaded"], c.WIDGET_STRINGS.en["boost.loaded"]);
});

test("the Boost popup shows the grouped reasons and loaded-tab counts in both languages", () => {
  const skipped = { "pinned-kept": 12, "audible": 2 };
  const loadedTabs = { pinned: 12, unpinned: 7 };
  const en = c.boostMenuItems({ running: false, canDeep: true, skipped, loadedTabs });
  const row = en.find((x) => x.id === "deep-skipped");
  assert.ok(row, "a disabled explanation row appears after a deep pass with skips");
  assert.equal(row.available, false, "it is information, not another action");
  assert.equal(row.label, c.WIDGET_STRINGS.en["boost.skipped"].replace("{reasons}", "pinned-kept: 12 \u00b7 audible: 2"));
  assert.equal(row.hint, c.WIDGET_STRINGS.en["boost.loaded"].replace("{pinned}", "12").replace("{unpinned}", "7"));
  const pl = c.boostMenuItems({ running: false, canDeep: true, skipped, loadedTabs, language: "pl" });
  const plRow = pl.find((x) => x.id === "deep-skipped");
  assert.equal(plRow.label, c.WIDGET_STRINGS.pl["boost.skipped"].replace("{reasons}", "pinned-kept: 12 \u00b7 audible: 2"));
  assert.equal(plRow.hint, c.WIDGET_STRINGS.pl["boost.loaded"].replace("{pinned}", "12").replace("{unpinned}", "7"));
  // No skipped data: the old four-item menu is unchanged (every older test still passes).
  const plain = c.boostMenuItems({ running: false, canDeep: true });
  assert.deepEqual(JSON.parse(JSON.stringify(plain.map((x) => x.id))), ["free-light", "free-deep", "game-mode", "restore"]);
  assert.equal(plain.find((x) => x.id === "deep-skipped"), undefined);
});

test("F5 adds no pref and no setting", () => {
  assert.equal(/zen\.workspace\.zentral\.boost\.(?:skipped|loaded)/.test(WIDGET_SRC), false);
  assert.equal(/zen\.workspace\.zentral\.boost\.(?:skipped|loaded)/.test(BOOST_SRC), false);
  assert.equal(SETTINGS.schema.some((x) => /boost\.(skipped|loaded)/.test(x.property)), false);
});

/* ---------------- Boost state and the real deep pass ---------------- */

function tab({ attrs = [], pinned = false, url = "https://example.com/", lastAccessed = 0,
  soundPlaying = false, connected = true } = {}) {
  const attrSet = new Set(attrs);
  if (pinned) attrSet.add("pinned");
  return {
    closing: false, isConnected: connected, hidden: false,
    linkedPanel: attrSet.has("discarded") || attrSet.has("pending") ? null : "p1",
    linkedBrowser: { currentURI: { spec: url }, isPictureInPicture: false },
    lastAccessed, soundPlaying, label: url,
    hasAttribute: (name) => attrSet.has(name),
    getAttribute: (name) => (name === "zen-dormant" ? null : attrSet.has(name) ? "" : null),
    matches: () => false,
    pinned,
  };
}

function bootBoost(tabs) {
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
  }));
  const timers = new Map();
  let timerId = 0;
  let registration = null;
  const unloadCalls = [];
  const win = {
    gBrowser: {
      tabs, selectedTab: null,
      explicitUnloadTabs: async (list) => { for (const t of list) { unloadCalls.push(t); t.linkedPanel = null; } return true; },
    },
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
  win.Zentral = { Panels: { essentialPanels: new Map() } };
  const context = vm.createContext({
    ...win,
    ChromeUtils: { requestProcInfo: () => ({ memory: 900 * MB }), forceGC() {}, forceCC() {} },
    Cc: win.Cc, Ci: win.Ci, console: win.console,
    Promise, Set, Map, WeakMap, WeakSet, Array, Object, Number, Math, String, Symbol, Error, TypeError, Date, JSON,
    globalThis: win,
  });
  win.ZentralTabPolicy = (() => {
    const w = {}; w.window = w;
    vm.runInNewContext(POLICY_SRC, { window: w, globalThis: w, console });
    return w.ZentralTabPolicy;
  })();
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  registration.init();
  const api = win.ZentralBoost;
  return {
    api, unloadCalls, timers,
    destroy: () => api.destroy(),
    async settle() {
      for (let round = 0; round < 20; round++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const due = [...timers].filter(([, t]) => t.ms === 3000);
        for (const [id, t] of due) { timers.delete(id); t.fn(); }
        await Promise.resolve();
      }
    },
  };
}

test("state() counts pinned vs unpinned LOADED tabs, and the deep pass records every skip", async () => {
  const pinned = Array.from({ length: 12 }, (_, i) => tab({ pinned: true, url: `https://pinned${i}/`, lastAccessed: i }));
  const essential = tab({ attrs: ["zen-essential"], url: "https://essential/" });
  const ordinary = [tab({ url: "https://a/", lastAccessed: 100 }), tab({ url: "https://b/", lastAccessed: 200 })];
  const audible = tab({ url: "https://music/", soundPlaying: true });
  const parked = tab({ attrs: ["pending"], pinned: true, url: "https://pending/" });
  const discarded = tab({ attrs: ["discarded"], url: "https://discarded/" });
  const dormant = tab({ attrs: ["zen-dormant"], url: "https://dormant/" });
  const h = bootBoost([...pinned, essential, ...ordinary, audible, parked, discarded, dormant]);

  const before = h.api.state().loadedTabs;
  assert.ok(before, "state publishes the loaded-tab counts");
  assert.equal(before.pinned, 13, "12 pinned + 1 Essential; the parked pinned row is not loaded");
  assert.equal(before.unpinned, 3, "2 ordinary + 1 audible; discarded/dormant are not loaded");

  const pending = h.api.runLevel2();
  await h.settle();
  const result = await pending;
  assert.equal(result.unloaded.tabs, 2, "only the two ordinary tabs sleep");
  assert.ok(result.skipped.length <= 5, "the old sample stays bounded");
  assert.equal(result.skippedCounts["pinned-kept"], 12, "but the counts cover every skip, not just the sample");
  assert.equal(result.skippedCounts["essential-live"], 1);
  assert.equal(result.skippedCounts["audible"], 1);
  const after = h.api.state();
  assert.equal(after.lastSkipped["pinned-kept"], 12, "the popup can read the last run's grouped reasons");
  assert.equal(after.loadedTabs.pinned, 13, "pinned rows are still loaded");
  assert.equal(after.loadedTabs.unpinned, 1, "only the audible unpinned row remains loaded");
  h.destroy();
});

test("state() stays useful with no browser tabs", () => {
  const empty = bootBoost([]);
  const state = empty.api.state();
  assert.deepEqual(JSON.parse(JSON.stringify(state.loadedTabs)), { pinned: 0, unpinned: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(state.lastSkipped)), {});
  empty.destroy();
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-115-boost-skipped (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
