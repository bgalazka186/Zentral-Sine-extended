"use strict";
/* OW-121 — Boost UX: all four owner propositions, with no extra widget height.
 *
 * RED on the pre-OW-121 tree; GREEN here. Static checks are screenshot-free and a fake sidebar / fake Gecko
 * drives the Boost-owned pure rules and source. Live popup height/appearance remains an OWNER GATE.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const BOOST_WIDGET_SRC = read("additional/boost/ZentralBoostWidget.js");
const BOOST_WIDGET_CSS = read("additional/boost/ZentralBoostWidget.css");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
const DOCS = [
  "docs/ow-121-boost-ux.md",
  "docs/bugfix-2026-11-18.md",
  "docs/perf-results.md",
  "docs/LEGACY_done_rows.md",
  "TODO_notes_roadmap.md",
  "additional/boost/README.md",
];

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadBoostWidgetCore() {
  const start = BOOST_SRC.indexOf("  const BOOST_WIDGET_STRINGS = Object.freeze({");
  const end = BOOST_SRC.indexOf("  // B5/OW-92", start);
  assert.ok(start >= 0 && end > start, "Boost owns the pure card strings and helpers");
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
}
const c = loadBoostWidgetCore();

/* ---------------- 1. clear level cards + deterministic descriptions ---------------- */

test("Boost-owned menu data has three levels, compact labels and deterministic EN/PL descriptions", () => {
  const en = c.menu({
    language: "en", running: false, canDeep: true, canGameMode: true, canRestore: true,
    gameMode: { on: false }, snapshot: { panels: 1, tabs: 2 },
  });
  const byId = Object.fromEntries(en.map((item) => [item.id, item]));
  assert.deepEqual(en.map((item) => item.id), ["free-light", "free-deep", "game-mode", "restore"]);
  for (const [id, shortKey, descriptionKey] of [
    ["free-light", "card.light", "card.lightHint"],
    ["free-deep", "card.deep", "card.deepHint"],
    ["game-mode", "card.game", "card.gameHint"],
    ["restore", "card.restore", "card.restoreHint"],
  ]) {
    assert.equal(byId[id].shortLabel, c.strings.en[shortKey]);
    assert.equal(byId[id].description, c.strings.en[descriptionKey]);
  }
  assert.equal(byId["free-light"].description, "Light: GC/CC + memory minimize. No tabs touched.");
  assert.match(byId["free-deep"].description, /Light clean first.*Restore available/);
  assert.match(byId["game-mode"].description, /pauses repeating features/);
  assert.equal(byId.restore.label, "Restore (1 apps, 2 tabs)");
  const pl = c.menu({
    language: "pl", running: false, canDeep: true, canGameMode: true, canRestore: true,
    gameMode: { on: false }, snapshot: { panels: 1, tabs: 2 },
  });
  assert.deepEqual(pl.map((item) => item.shortLabel), ["Lekko", "Głęboko", "Gra", "Przywróć"]);
  assert.equal(pl.find((item) => item.id === "restore").label, "Przywróć (1 aplikacji, 2 kart)");
  for (const key of Object.keys(c.strings.en)) assert.ok(key in c.strings.pl, key + " is translated");
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

test("Boost-owned result text adds skipped protected tabs without inventing another action", () => {
  assert.equal(typeof c.skippedCount, "function", "the pure skip counter is exported");
  assert.equal(c.skippedCount({ skippedCounts: { "pinned-kept": 2, audible: 1 } }), 3);
  assert.equal(c.skippedCount({ skippedCounts: { junk: "x", zero: 0 } }), 0);
  assert.equal(c.skippedCount(null), 0);
  const en = c.resultText({
    by: "level2", freedMB: 10, unloaded: { tabs: 1, panels: 0 },
    skippedCounts: { "pinned-kept": 2, audible: 1 },
  }, "en");
  assert.equal(en, "Put 1 tab(s) and 0 panel(s) to sleep, freed 10 MB · skipped 3 protected tab(s)");
  const pl = c.resultText({ freedMB: 10, skippedCounts: { audible: 2 } }, "pl");
  assert.match(pl, /Zwolniono 10 MB · pominięto 2 chronionych kart/);
  assert.equal(c.resultText({ freedMB: 10 }, "en"), "Freed 10 MB", "no skipped data keeps the short line");
});

/* ---------------- 4. no extra height ---------------- */

test("the Boost-owned stylesheet and renderer keep one 26 px row with no visible skipped row", () => {
  const rowBlock = BOOST_WIDGET_CSS.slice(
    BOOST_WIDGET_CSS.indexOf(".zbw-row,"), BOOST_WIDGET_CSS.indexOf(".zbw-value {"));
  assert.match(rowBlock, /flex-direction:\s*row !important/);
  assert.match(rowBlock, /flex-wrap:\s*nowrap !important/);
  assert.match(rowBlock, /max-height:\s*26px !important/);
  assert.match(rowBlock, /overflow:\s*hidden !important/);
  const actionBlock = BOOST_WIDGET_CSS.slice(
    BOOST_WIDGET_CSS.indexOf(".zbw-action,"), BOOST_WIDGET_CSS.indexOf(".zbw-action[disabled]"));
  assert.match(actionBlock, /height:\s*20px !important/);
  assert.match(actionBlock, /white-space:\s*nowrap !important/);
  assert.match(actionBlock, /text-overflow:\s*ellipsis !important/);
  assert.match(actionBlock, /overflow:\s*hidden !important/);
  const paint = BOOST_WIDGET_SRC.slice(BOOST_WIDGET_SRC.indexOf("function paintMenu()"),
    BOOST_WIDGET_SRC.indexOf("function handleGameModeEvent"));
  assert.doesNotMatch(paint, /createElement\("div"\)/, "no extra row is appended");
  assert.match(paint, /item.id === "deep-skipped"/, "skip details go into the Deep tooltip");
  assert.match(paint, /popup.appendChild\(button\)/, "the four actions remain buttons");
});

/* ---------------- docs / generated files / version ---------------- */

test("the Boost plan, perf report, README and handoff record OW-121", () => {
  for (const rel of DOCS) assert.match(read(rel), /OW-121/, rel + " records OW-121");
  assert.match(read("docs/ow-121-boost-ux.md"), /no.*height|height.*not/i);
  assert.match(read("docs/ow-121-boost-ux.md"), /OWNER GATE/);
  assert.match(read(".gitignore"), /!docs\/ow-121-boost-ux\.md/);
  assert.match(read("additional/boost/ZentralBoost.standalone.uc.js"), /lightClean/);
  assert.match(read("additional/boost/ZentralBoost.standalone.uc.js"), /widgetMenu/);
  assert.match(read("loader/Zentral.uc.js"), /3\.4\.1/);
  assert.match(read("docs/bugfix-2026-11-18.md"), /no `--bump` and no version change/);
  assert.match(read("docs/bugfix-2026-11-18.md"), /tools\/sync-version\.cjs/);
});

/* ---------------- helpers ---------------- */

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
