"use strict";
/* OW-121 — Boost UX: all four owner propositions, with no extra widget height.
 *
 * RED on the pre-OW-121 tree; GREEN here. Static checks are screenshot-free and a fake sidebar / fake Gecko
 * drives the real widget and Boost sources. Live popup height/appearance remains an OWNER GATE.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeSidebarHarness } = require("./helpers/fake-widgets-harness.cjs");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const WIDGET_SRC = read("additional/widgets/ZentralWidgets.uc.js");
const WIDGET_CSS = read("additional/widgets/ZentralWidgets.css");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
const DOCS = [
  "docs/ow-121-boost-ux.md",
  "docs/bugfix-2026-11-18.md",
  "docs/perf-results.md",
  "docs/LEGACY_done_rows.md",
  "TODO_notes_roadmap.md",
  "additional/boost/README.md",
  "additional/widgets/README.md",
];

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadWidgetCore() {
  const seam = {};
  const win = { __zentralWidgetsTestSeam: seam, ZentralRuntime: { register() {} } };
  win.window = win;
  vm.runInNewContext(WIDGET_SRC, {
    window: win, globalThis: { Services: {} }, URL, Date, JSON, Math, Promise, RegExp, Number, String,
    Array, Object, Map, Set, console,
  });
  return seam.core;
}
const c = loadWidgetCore();

/* ---------------- 1. clear level cards + deterministic descriptions ---------------- */

test("Boost menu data has three level cards, compact labels and deterministic one-line descriptions", () => {
  const en = c.boostMenuItems({ running: false, canDeep: true });
  const byId = Object.fromEntries(en.map((item) => [item.id, item]));
  assert.deepEqual(["light", "deep", "game"].map((level) =>
    en.find((item) => item.level === level)?.id), ["free-light", "free-deep", "game-mode"],
    "Light, Deep and Game Mode are explicit level cards");
  assert.equal(byId["free-light"].shortLabel, c.WIDGET_STRINGS.en["boost.shortLight"]);
  assert.equal(byId["free-deep"].shortLabel, c.WIDGET_STRINGS.en["boost.shortDeep"]);
  assert.equal(byId["game-mode"].shortLabel, c.WIDGET_STRINGS.en["boost.shortGame"]);
  for (const [id, key] of [
    ["free-light", "boost.levelLight"], ["free-deep", "boost.levelDeep"],
    ["game-mode", "boost.levelGame"], ["restore", "boost.levelRestore"],
  ]) {
    assert.equal(byId[id].description, c.WIDGET_STRINGS.en[key], id + " has a deterministic description");
    assert.match(byId[id].description, /^(?:Light|Deep|Game Mode|Restore): /, id + " names what it touches");
  }
  assert.equal(byId["free-light"].description, "Light: GC/CC + memory minimize. No tabs touched.");
  assert.match(byId["free-deep"].description, /Light clean first.*Restore available/);
  assert.match(byId["game-mode"].description, /pauses repeating features/);
  const pl = c.boostMenuItems({ running: false, canDeep: true, language: "pl" });
  assert.equal(pl.find((x) => x.id === "free-light").description, c.WIDGET_STRINGS.pl["boost.levelLight"]);
  assert.notEqual(c.WIDGET_STRINGS.pl["boost.levelLight"], c.WIDGET_STRINGS.en["boost.levelLight"]);
  for (const key of Object.keys(c.WIDGET_STRINGS.en)) {
    assert.ok(key in c.WIDGET_STRINGS.pl, key + " is translated");
  }
});

/* ---------------- 2. deep clean includes light clean ---------------- */

test("runLevel2 calls the shared light-clean actions before it sleeps any tab", async () => {
  const h = bootBoost();
  const pending = h.api.runLevel2();
  await h.settle();
  const result = await pending;
  assert.equal(result.by, "level2");
  assert.equal(result.light?.by, "minimize", "the deep result says the light clean ran");
  assert.equal(h.calls.light, 1, "minimizeMemoryUsage ran once");
  assert.ok(h.calls.gc >= 1 && h.calls.cc >= 1, "GC and CC ran");
  const significant = h.calls.order.filter((step) => step === "light" || step === "deep");
  assert.deepEqual(significant, ["light", "deep"], "light clean is first, tab sleeping second");
  assert.equal(result.unloaded.tabs, 1, "the eligible background tab still slept");
  h.destroy();
});

/* ---------------- 3. short post-run result line ---------------- */

test("the result line adds a short skipped-protected-tabs suffix without a new card row", () => {
  assert.equal(typeof c.boostSkippedCount, "function", "the pure skip counter is exported");
  assert.equal(c.boostSkippedCount({ skippedCounts: { "pinned-kept": 2, audible: 1 } }), 3);
  assert.equal(c.boostSkippedCount({ skippedCounts: { junk: "x", zero: 0 } }), 0);
  assert.equal(c.boostSkippedCount(null), 0);
  const en = c.boostResultText({
    by: "level2", freedMB: 10, unloaded: { tabs: 1, panels: 0 },
    skippedCounts: { "pinned-kept": 2, audible: 1 },
  });
  assert.equal(en, "Put 1 tab(s) and 0 panel(s) to sleep, freed 10 MB · skipped 3 protected tab(s)");
  const pl = c.boostResultText({ freedMB: 10, skippedCounts: { audible: 2 } }, { language: "pl" });
  assert.match(pl, /Zwolniono 10 MB · pominięto 2 chronionych kart/);
  assert.equal(c.boostResultText({ freedMB: 10 }), "Freed 10 MB", "no skipped data keeps the old short line");
});

/* ---------------- 4. no extra height ---------------- */

test("the popup is one compact horizontal row; note and skipped explanation rows are gone from the DOM", () => {
  const popupBlock = WIDGET_CSS.slice(
    WIDGET_CSS.indexOf("#zentral-sidebar-widgets .zw-boost-popup {"),
    WIDGET_CSS.indexOf("#zentral-sidebar-widgets .zw-boost-popup[hidden]"));
  assert.match(popupBlock, /flex-direction:\s*row\s*!important/);
  assert.match(popupBlock, /flex-wrap:\s*nowrap\s*!important/);
  assert.match(popupBlock, /max-height:\s*26px\s*!important/);
  assert.match(popupBlock, /overflow:\s*hidden\s*!important/);
  assert.doesNotMatch(popupBlock, /flex-direction:\s*column/);
  const itemBlock = WIDGET_CSS.slice(
    WIDGET_CSS.indexOf("#zentral-sidebar-widgets .zw-boost-menu-item {"),
    WIDGET_CSS.indexOf("#zentral-sidebar-widgets .zw-boost-menu-item:hover"));
  assert.match(itemBlock, /height:\s*20px\s*!important/);
  assert.match(itemBlock, /white-space:\s*nowrap\s*!important/);
  assert.match(itemBlock, /text-overflow:\s*ellipsis\s*!important/);
  assert.match(itemBlock, /overflow:\s*hidden\s*!important/);
  const noteBlock = WIDGET_CSS.slice(
    WIDGET_CSS.indexOf("#zentral-sidebar-widgets .zw-boost-menu-note {"),
    WIDGET_CSS.indexOf("/* ---- Built-in Timer widget"));
  assert.match(noteBlock, /display:\s*none\s*!important/);
  const paint = WIDGET_SRC.slice(WIDGET_SRC.indexOf("const paintMenu = () =>"),
    WIDGET_SRC.indexOf("const api = () => boostModule()"));
  assert.doesNotMatch(paint, /createElement\("div"\)/, "no extra note/result div is appended");
  assert.match(paint, /item\.id === "deep-skipped"/, "the old skipped row is folded into a tooltip, not drawn");
  assert.match(paint, /data-zw-boost-level/, "level cards carry their level in the DOM");
});

test("the fake sidebar draws exactly four compact buttons and no vertical note/skipped row", async () => {
  const h = createFakeSidebarHarness({
    "zen.workspace.zentral.widgets.enabled": true,
    "zen.workspace.zentral.widgets.clock.enabled": false,
    "zen.workspace.zentral.widgets.date.enabled": false,
    "zen.workspace.zentral.widgets.weather.enabled": false,
    "zen.workspace.zentral.widgets.boost.enabled": true,
  });
  h.window.ZentralBoost = makeBoostModule();
  const { api } = h.start();
  await tick(50);
  const card = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "boost");
  const body = card.querySelector(".zw-boost");
  const popup = body.querySelector(".zw-boost-popup");
  const arrow = body.querySelector(".zw-boost-menu-btn");
  fire(arrow, "click");
  assert.equal(popup.children.length, 4, "three levels + Restore, one row");
  assert.ok(popup.children.every((el) => el.localName === "button"), "only the existing buttons, no extra rows");
  assert.equal(popup.querySelector(".zw-boost-menu-note"), null);
  assert.equal(popup.querySelector('[data-zw-boost-action="deep-skipped"]'), null);
  assert.deepEqual(popup.children.slice(0, 3).map((el) => el.getAttribute("data-zw-boost-level")),
    ["light", "deep", "game"]);
  assert.equal(popup.children[0].textContent, "Light");
  assert.equal(popup.children[1].textContent, "Deep");
  assert.match(popup.children[1].getAttribute("title"), /Last deep pass kept: pinned-kept: 2/);
  assert.match(popup.children[1].getAttribute("title"), /Loaded tabs: 2 pinned, 1 unpinned/);
  assert.equal(popup.children[3].getAttribute("aria-label"), "Restore (3)");
  // The post-run line is the existing toast, not another row under the card.
  fire(popup.children[1], "click");
  await tick(30);
  const toast = api.getTray().querySelector(".zw-toast");
  assert.match(toast.textContent, /freed 10 MB · skipped 3 protected tab\(s\)/);
  assert.equal(popup.children.length, 4, "the result did not append a row");
  api.destroy();
});

/* ---------------- docs / generated files / version ---------------- */

test("per-task report, perf, legacy, handoff and both READMEs record OW-121", () => {
  for (const rel of DOCS) assert.match(read(rel), /OW-121/, rel + " records OW-121");
  assert.match(read("docs/ow-121-boost-ux.md"), /no.*height|height.*not/i);
  assert.match(read("docs/ow-121-boost-ux.md"), /OWNER GATE/);
  assert.match(read(".gitignore"), /!docs\/ow-121-boost-ux\.md/);
  assert.match(read("additional/boost/ZentralBoost.standalone.uc.js"), /lightClean/);
  assert.match(read("additional/widgets/ZentralWidgets.standalone.uc.js"), /boost\.levelLight/);
  assert.match(read("loader/Zentral.uc.js"), /3\.4\.0/);
  assert.match(read("docs/bugfix-2026-11-18.md"), /no `--bump` or `sync-version`/);
});

/* ---------------- helpers ---------------- */

function fire(el, type, extra = {}) {
  for (const [t, fn] of [...(el._listeners || [])]) {
    if (t === type) fn({ type, target: el, preventDefault() {}, stopPropagation() {}, ...extra });
  }
}

function makeBoostModule() {
  const calls = { runLevel1: 0, runLevel2: 0, startSampling: 0, stopSampling: 0 };
  const listeners = new Set();
  return {
    calls,
    lastValue: 900,
    runLevel1() { calls.runLevel1 += 1; return Promise.resolve({ freedMB: 10, by: "minimize" }); },
    runLevel2() {
      calls.runLevel2 += 1;
      return Promise.resolve({
        by: "level2", freedMB: 10, unloaded: { tabs: 1, panels: 0 },
        skippedCounts: { "pinned-kept": 2, audible: 1 }, light: { by: "minimize" },
      });
    },
    state: () => ({
      policy: true, undoSize: 3, lastSkipped: { "pinned-kept": 2 },
      loadedTabs: { pinned: 2, unpinned: 1 },
    }),
    restore: () => ({ panels: 0, tabs: 0 }),
    setGameMode(on) { this.gameModeOn = Boolean(on); return { on: this.gameModeOn }; },
    gameModeState() { return { on: Boolean(this.gameModeOn), paused: Boolean(this.gameModeOn) }; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    lastMB: () => 900,
    startSampling() { calls.startSampling += 1; },
    stopSampling() { calls.stopSampling += 1; },
  };
}

function loadPolicy() {
  const win = {};
  win.window = win;
  vm.runInNewContext(POLICY_SRC, { window: win, globalThis: win, console });
  return win.ZentralTabPolicy;
}

function tab(url, lastAccessed = 1) {
  const attrs = new Set();
  return {
    closing: false, isConnected: true, hidden: false, linkedPanel: "p1", lastAccessed,
    soundPlaying: false, label: url, pinned: false,
    linkedBrowser: { currentURI: { spec: url }, isPictureInPicture: false },
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => (attrs.has(name) ? "" : null),
    matches: () => false,
  };
}

function bootBoost() {
  const calls = { light: 0, deep: 0, gc: 0, cc: 0, order: [] };
  const timers = new Map();
  let timerId = 0;
  const listeners = new Map();
  let registration = null;
  const bgTab = tab("https://background.example/", 10);
  const selected = tab("https://selected.example/", 20);
  const win = {
    gBrowser: {
      tabs: [selected, bgTab], selectedTab: selected,
      explicitUnloadTabs: async (list) => {
        calls.deep += 1;
        calls.order.push("deep");
        for (const t of list) t.linkedPanel = null;
        return true;
      },
    },
    Services: {
      prefs: {
        getBoolPref: (k, d) => (k === "zen.workspace.zentral.boost.enabled" ? true : d),
        getStringPref: (_k, d) => d,
        getIntPref: (_k, d) => d,
        setBoolPref() {}, prefHasUserValue: () => false,
        addObserver() {}, removeObserver() {},
      },
      appinfo: { OS: "Linux" }, obs: { addObserver() {}, removeObserver() {} },
    },
    Cc: {
      "@mozilla.org/memory-reporter-manager;1": {
        getService: () => ({
          minimizeMemoryUsage: (cb) => {
            calls.light += 1;
            calls.order.push("light");
            cb.run();
          },
        }),
      },
    },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: { getTabState: () => JSON.stringify({ entries: [{ url: "https://background.example/" }], index: 1 }) },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback: () => 1,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    console: { warn() {}, log() {}, error() {} },
    ZentralRuntime: { register: (def) => { registration = def; } },
  };
  win.window = win;
  win.globalThis = win;
  win.ZentralTabPolicy = loadPolicy();
  const context = vm.createContext({
    ...win,
    ChromeUtils: {
      requestProcInfo: () => ({ memory: 900_000_000 }),
      forceGC() { calls.gc += 1; calls.order.push("gc"); },
      forceCC() { calls.cc += 1; calls.order.push("cc"); },
    },
    Cc: win.Cc, Ci: win.Ci, console: win.console, Promise, Set, Map, WeakMap, Array, Object, Number, Math,
    String, Symbol, Error, TypeError, RegExp, Boolean, Date, JSON, globalThis: win,
  });
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  assert.ok(registration?.init, "Boost registers");
  registration.init();
  const api = win.ZentralBoost;
  return {
    calls, api,
    async settle() {
      for (let round = 0; round < 12; round++) {
        await tick(0);
        const due = [...timers].filter(([, t]) => t.ms === 3000);
        for (const [id, t] of due) {
          timers.delete(id);
          t.fn();
        }
        await Promise.resolve();
      }
    },
    destroy: () => api.destroy(),
  };
}

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-121-boost-ux (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
