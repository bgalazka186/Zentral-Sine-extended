"use strict";
/* G7 — Game Mode feedback on Boost's one shared card.
 * The full pack and standalone both load additional/boost/ZentralBoostWidget.js; no Widgets-tray copy remains.
 * The live popup size/placement is still an owner gate and is not proven by these fake-DOM tests.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  createFakeStandaloneBoostHarness,
  instrumentStandaloneBoostApi,
} = require("./helpers/fake-standalone-boost-harness.cjs");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const BOOST_WIDGET_SRC = read("additional/boost/ZentralBoostWidget.js");
const BUNDLE = read("additional/boost/ZentralBoost.standalone.uc.js");
const PLAN = read("docs/PLAN_CODING_AGENT_FOLLOWUP_GAME_MODE.md");
const PERF = read("docs/perf-results.md");
const HANDOFF = read("TODO_notes_roadmap.md");
const README = read("additional/boost/README.md");
const ROOT_PREFS = json("preferences.json");

const SNAPSHOT = { panels: 1, tabs: 2 };
const FEEDBACK_STATE = {
  freedMB: 400,
  unloaded: { tabs: 3, panels: 2 },
  kept: [
    { id: "a", kind: "tab", reason: "audio" },
    { id: "b", kind: "panel", reason: "host" },
    { id: "c", kind: "tab", reason: "pinned" },
    { id: "d", kind: "tab", reason: "sharing" },
  ],
};
const EN_FEEDBACK = "Game Mode: freed 400 MB · 3 tabs, 2 apps unloaded · kept: a (audio), b (host), c (pinned), +1 more";
const PL_FEEDBACK = "Tryb gry: zwolniono 400 MB · 3 kart, 2 aplikacji uśpionych · zachowano: a (audio), b (host), c (pinned), +1 więcej";
const EN_PREVIEW = "Will free about 2 tabs and 1 apps before Game Mode starts";
const PL_PREVIEW = "Uśpi około 2 kart i 1 aplikacji przed włączeniem Trybu gry";
const EN_OFF = "Game Mode off · Restore (1 apps, 2 tabs)";
const PL_OFF = "Tryb gry wyłączony · Przywróć (1 aplikacji, 2 kart)";

function loadBoostCardCore() {
  const start = BOOST_SRC.indexOf("  const BOOST_WIDGET_STRINGS = Object.freeze({");
  const end = BOOST_SRC.indexOf("  // B5/OW-92", start);
  assert.ok(start >= 0 && end > start, "Boost owns the pure card strings and helpers");
  return new Function(BOOST_SRC.slice(start, end) + `
    return {
      strings: BOOST_WIDGET_STRINGS,
      text: boostWidgetText,
      menu: boostWidgetMenuItems,
      preview: boostWidgetPreviewText,
      feedback: boostWidgetFeedbackText,
      off: boostWidgetOffText,
      restoreLabel: boostWidgetRestoreLabel,
    };
  `)();
}
const boostCore = loadBoostCardCore();
const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bootStandalone = (options = {}) => createFakeStandaloneBoostHarness({
  language: options.language || "en",
  instrumentApi: (api, calls) => instrumentStandaloneBoostApi(api, calls, {
    gameModeSnapshot: options.snapshot || SNAPSHOT,
    autoGameModeEvents: Boolean(options.autoGameModeEvents),
  }),
}).boot();

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("Boost owns the G8 diagnostic shape, an event door and no new setting", () => {
  const stateBlock = BOOST_SRC.slice(
    BOOST_SRC.indexOf("function gameModeState()"),
    BOOST_SRC.indexOf("// G2: the dry run"),
  );
  for (const field of [
    "freedMB", "beforeMB", "afterMB", "processesBefore", "processesAfter",
    "unloaded", "kept", "snapshot", "panels", "tabs",
  ]) assert.match(stateBlock, new RegExp("\\b" + field + "\\b"), "gameModeState() reports " + field);
  assert.match(BOOST_SRC, /function processCount\(\)[\s\S]{0,180}1 \+ \(Array\.isArray\(info\.children\)/,
    "processesBefore/After are the parent plus its requestProcInfo children");
  assert.match(BOOST_SRC, /onGameModeEvent,/);
  for (const action of ["on", "on-settle", "on-final", "off"])
    assert.match(BOOST_SRC, new RegExp('action: "' + action + '"'), "the module emits " + action);
  assert.equal(ROOT_PREFS.filter((row) => row && row.property).length, 607,
    "W4 removes the retired Widgets toggle; G7 adds no preference");
  assert.equal(ROOT_PREFS.some((row) => row?.property === "zen.workspace.zentral.widgets.boost.enabled"), false,
    "the old Widgets preference is no longer declared");
});

test("Boost's one dictionary makes the EN/PL preview, feedback, OFF and Restore wording", () => {
  assert.equal(boostCore.feedback(FEEDBACK_STATE, "en"), EN_FEEDBACK);
  assert.equal(boostCore.feedback(FEEDBACK_STATE, "pl"), PL_FEEDBACK);
  assert.equal(boostCore.preview({ counts: { tabs: 2, panels: 1 } }, "en"), EN_PREVIEW);
  assert.equal(boostCore.preview({ counts: { tabs: 2, panels: 1 } }, "pl"), PL_PREVIEW);
  assert.equal(boostCore.off(SNAPSHOT, "en"), EN_OFF);
  assert.equal(boostCore.off(SNAPSHOT, "pl"), PL_OFF);
  assert.equal(boostCore.restoreLabel(SNAPSHOT, "en"), "Restore (1 apps, 2 tabs)");
  assert.equal(boostCore.restoreLabel(SNAPSHOT, "pl"), "Przywróć (1 aplikacji, 2 kart)");
  for (const key of Object.keys(boostCore.strings.en)) {
    assert.ok(key in boostCore.strings.pl, key + " has a Polish translation");
    assert.notEqual(boostCore.strings.pl[key], "", key + " is not empty");
  }
});

test("Boost's four action entries use the live snapshot Restore label", () => {
  const items = boostCore.menu({
    language: "en", running: false, canDeep: true, canGameMode: true, canRestore: true,
    gameMode: { on: true }, snapshot: SNAPSHOT,
  });
  assert.deepEqual(items.map((item) => item.id), ["free-light", "free-deep", "game-mode", "restore"]);
  const restore = items.find((item) => item.id === "restore");
  assert.equal(restore.label, EN_OFF.slice("Game Mode off · ".length));
  assert.equal(restore.shortLabel, "Restore");
  assert.equal(restore.available, true);
  const empty = boostCore.menu({
    language: "en", running: false, canDeep: true, canGameMode: true, canRestore: true,
    gameMode: { on: false }, snapshot: { panels: 0, tabs: 0 },
  }).find((item) => item.id === "restore");
  assert.equal(empty.label, "Restore");
  assert.equal(empty.available, false);
});

test("the shared card previews before Game Mode switches on and listens to Boost's event", async () => {
  const h = await bootStandalone({ autoGameModeEvents: true });
  const game = h.action("game-mode");
  h.fire(game, "mouseenter");
  assert.equal(game.getAttribute("data-zbw-preview"), EN_PREVIEW);
  assert.ok(h.calls.previewGameMode >= 1, "the dry run is read on hover");
  h.fire(game, "click");
  await tick(20);
  assert.equal(h.calls.setGameMode, 1, "the action switches through the Boost API");
  assert.ok(h.calls.previewGameMode >= 2, "the dry run is read again before ON");
  assert.equal(h.card().querySelector(".zbw-toast-line").textContent, "Game Mode: freeing memory…");
  assert.equal(h.calls.gameModeListeners.size, 1, "one Boost event subscription");
  h.destroy();
  assert.equal(h.calls.gameModeListeners.size, 0, "and it is released on teardown");
});

test("the shared card shows the final report and OFF Restore action", async () => {
  const h = await bootStandalone();
  assert.equal(h.action("restore").getAttribute("aria-label"), "Restore (1 apps, 2 tabs)");
  assert.equal(h.action("restore").disabled, false);
  h.emitGameModeEvent({ action: "on-settle", state: FEEDBACK_STATE });
  assert.equal(h.card().querySelector(".zbw-toast-line").textContent, EN_FEEDBACK);
  h.emitGameModeEvent({ action: "off", state: { snapshot: SNAPSHOT } });
  assert.equal(h.card().querySelector(".zbw-toast-line").textContent, EN_OFF);
  const action = h.card().querySelector(".zbw-toast-action");
  assert.equal(action.textContent, "Restore");
  h.fire(action, "click");
  await h.flush(0);
  assert.equal(h.calls.restoreSession, 1, "the toast action calls Boost's Restore engine");
  assert.equal(h.action("restore").getAttribute("aria-label"), "Nothing to restore yet");
  assert.equal(h.action("restore").disabled, true);
  h.destroy();
  assert.equal(h.calls.gameModeSubscribe, h.calls.gameModeUnsubscribe);
});

test("the Boost-owned Polish fallback produces the same preview, final report and OFF label", async () => {
  const h = await bootStandalone({ language: "pl-PL" });
  h.fire(h.action("game-mode"), "mouseenter");
  assert.equal(h.action("game-mode").getAttribute("data-zbw-preview"), PL_PREVIEW);
  h.emitGameModeEvent({ action: "on-settle", state: FEEDBACK_STATE });
  assert.equal(h.card().querySelector(".zbw-toast-line").textContent, PL_FEEDBACK);
  h.emitGameModeEvent({ action: "off", state: { snapshot: SNAPSHOT } });
  assert.equal(h.card().querySelector(".zbw-toast-line").textContent, PL_OFF);
  assert.equal(h.card().querySelector(".zbw-toast-action").textContent, "Przywróć");
  h.destroy();
});

test("Boost's shared module is event-driven, timer-safe and independent of the Widgets API", () => {
  assert.match(BOOST_SRC, /additional\/boost\/ZentralBoostWidget\.js/);
  assert.match(BOOST_WIDGET_SRC, /onGameModeEvent/);
  assert.match(BOOST_WIDGET_SRC, /handleGameModeEvent/);
  assert.match(BOOST_WIDGET_SRC, /mountObserver\.observe\(nextHost,\s*\{\s*childList:\s*true\s*\}\)/);
  assert.doesNotMatch(BOOST_WIDGET_SRC, /subtree:\s*true|attributes:\s*true/);
  assert.doesNotMatch(BOOST_SRC + BOOST_WIDGET_SRC, /window\.ZentralWidgets|__zentralWidgets/);
  assert.doesNotMatch(BOOST_SRC + BOOST_WIDGET_SRC + BUNDLE, /setInterval\s*\(/);
  assert.match(BUNDLE, /widgetFeedbackText/);
});

test("the generated standalone package and settings catalog are current", () => {
  const build = spawnSync(process.execPath, ["tools/build-standalone.cjs", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  assert.match(build.stdout, /Standalone packages are up to date/);
  const coverage = spawnSync(process.execPath, ["tools/check-settings-consistency.cjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(coverage.status, 0, coverage.stdout + coverage.stderr);
  assert.match(coverage.stdout, /catalog checks passed/);
});

test("the active plan, perf report, Boost README and handoff record G7 DONE", () => {
  assert.match(PLAN, /### G7 — Feedback in the UI \(DONE\)/);
  assert.match(PLAN, /\*\*DONE \(G7\):\*\*/);
  assert.match(PLAN, /\| `G7` \| \*\*DONE\*\*/);
  assert.match(PERF, /\| `G7` \|/);
  assert.match(PERF, /tests\/g7-game-mode-feedback\.test\.cjs` \(10 passed\)/,
    "the perf ledger keeps the historical pre-W4 G7 test count");
  assert.match(PERF, /306\/306 passed; 0 failed/);
  assert.match(README, /## G7 UI feedback/);
  assert.match(HANDOFF, /all G0\.\.G11 plan tasks are DONE/);
  assert.match(HANDOFF, /`g7-game-mode-feedback` \(10\)/);
  assert.match(HANDOFF, /306\/306 passed; 0 failed/);
  assert.match(HANDOFF, /`G10` must be done before `G7`/, "the G9 handoff wording remains intact");
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\n${passed}/${tests.length} Boost G7 feedback tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
