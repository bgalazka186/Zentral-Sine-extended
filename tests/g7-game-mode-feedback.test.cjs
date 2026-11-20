"use strict";
/* G7 — Game Mode feedback in BOTH Boost card owners.
 * RED on the pre-G7 tree: the full-pack tray only showed the old ON/OFF toast,
 * the standalone card had no event subscription, and gameModeState() had no
 * snapshot summary. G10 must already be done before this suite can pass.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { createFakeSidebarHarness } = require("./helpers/fake-widgets-harness.cjs");
const {
  createFakeStandaloneBoostHarness,
  instrumentStandaloneBoostApi,
} = require("./helpers/fake-standalone-boost-harness.cjs");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const WIDGET_SRC = read("additional/widgets/ZentralWidgets.uc.js");
const EXTRA = read("additional/boost/standalone/ZentralBoostWidget.js");
const BUNDLE = read("additional/boost/ZentralBoost.standalone.uc.js");
const WIDGETS_BUNDLE = read("additional/widgets/ZentralWidgets.standalone.uc.js");
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

function loadWidgetsCore() {
  const seam = {};
  const win = { __zentralWidgetsTestSeam: seam, ZentralRuntime: { register() {} } };
  win.window = win;
  vm.runInNewContext(WIDGET_SRC, {
    window: win, globalThis: { Services: {} }, URL, Date, JSON, Math, Promise, RegExp,
    Number, String, Array, Object, Map, Set, console,
  });
  return seam.core;
}
function loadBoostCardCore() {
  const start = BOOST_SRC.indexOf("  /* G10: strings");
  const end = BOOST_SRC.indexOf("  // B5/OW-92", start);
  assert.ok(start >= 0 && end > start, "Boost owns the pure card-string block");
  return new Function(BOOST_SRC.slice(start, end) +
    "\nreturn { strings: BOOST_WIDGET_STRINGS, text: boostWidgetText, preview: boostWidgetPreviewText," +
    "feedback: boostWidgetFeedbackText, off: boostWidgetOffText, restoreLabel: boostWidgetRestoreLabel };")();
}
const widgetsCore = loadWidgetsCore();
const boostCore = loadBoostCardCore();

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fire = (el, type, extra = {}) => {
  for (const [t, fn] of [...(el._listeners || [])]) {
    if (t === type) fn({ type, target: el, preventDefault() {}, stopPropagation() {}, ...extra });
  }
};

const BASE_PREFS = {
  "zen.workspace.zentral.widgets.enabled": true,
  "zen.workspace.zentral.widgets.clock.enabled": false,
  "zen.workspace.zentral.widgets.date.enabled": false,
  "zen.workspace.zentral.widgets.weather.enabled": false,
  "zen.workspace.zentral.widgets.boost.enabled": true,
};

function makeTrayBoost(options = {}) {
  const calls = { previewGameMode: 0, setGameMode: 0, restoreSession: 0, previewAtSet: 0 };
  const listeners = new Set();
  let on = Boolean(options.gameModeOn);
  let snapshot = { ...(options.snapshot || SNAPSHOT) };
  const boost = {
    calls,
    listeners,
    runLevel1: () => Promise.resolve({ freedMB: 1 }),
    runLevel2: () => Promise.resolve({ freedMB: 2 }),
    onChange() { return () => {}; },
    lastMB: () => 512,
    memoryMB: () => 512,
    startSampling() {},
    stopSampling() {},
    state: () => ({ policy: true, undoSize: 0 }),
    gameModeState: () => ({ on, snapshot: { ...snapshot } }),
    previewGameMode() {
      calls.previewGameMode += 1;
      return { counts: { tabs: 2, panels: 1 } };
    },
    setGameMode(next) {
      calls.setGameMode += 1;
      calls.previewAtSet = calls.previewGameMode;
      on = Boolean(next);
      if (options.autoGameModeEvents) {
        boost.emit(on
          ? { action: "on", state: boost.gameModeState() }
          : { action: "off", state: boost.gameModeState() });
      }
      return { on };
    },
    restoreSession() {
      calls.restoreSession += 1;
      snapshot = { panels: 0, tabs: 0 };
      return { panels: 1, tabs: 2 };
    },
    restore() { return this.restoreSession(); },
    onGameModeEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(event) {
      for (const fn of [...listeners]) fn({ kind: "game-mode", ...event });
    },
  };
  if (options.withApiHelpers !== false) {
    boost.widgetText = (lang, key, params) => boostCore.text(lang, key, params);
    boost.widgetPreviewText = (preview, lang) => boostCore.preview(preview, lang);
    boost.widgetFeedbackText = (state, lang) => boostCore.feedback(state, lang);
    boost.widgetOffText = (state, lang) => boostCore.off(state, lang);
    boost.widgetRestoreLabel = (state, lang) => boostCore.restoreLabel(state, lang);
  }
  return boost;
}

async function mountTray(options = {}) {
  const harness = createFakeSidebarHarness({ ...BASE_PREFS, ...(options.prefs || {}) });
  const boost = makeTrayBoost(options);
  harness.window.ZentralBoost = boost;
  const { api } = harness.start();
  await tick(50);
  const card = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "boost");
  assert.ok(card, "one full-pack Boost card is mounted");
  const body = card.querySelector(".zw-boost");
  return {
    harness,
    api,
    boost,
    card,
    body,
    popup: body.querySelector(".zw-boost-popup"),
    arrow: body.querySelector(".zw-boost-menu-btn"),
    toast: () => api.getTray().querySelector(".zw-toast"),
    restoreRow: () => body.querySelector(".zw-boost-popup").querySelectorAll(".zw-boost-menu-item")[3],
  };
}

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
  for (const action of ["on", "on-settle", "on-final", "off"]) {
    assert.match(BOOST_SRC, new RegExp('action: "' + action + '"'), "the module emits " + action);
  }
  assert.equal(ROOT_PREFS.filter((row) => row && row.property).length, 608,
    "G7 adds words and listeners, not a preference");
});

test("both dictionaries make the same EN/PL report and cap kept reasons at three", () => {
  assert.equal(boostCore.feedback(FEEDBACK_STATE, "en"), EN_FEEDBACK);
  assert.equal(widgetsCore.boostGameModeFeedbackText(FEEDBACK_STATE), EN_FEEDBACK);
  assert.equal(boostCore.feedback(FEEDBACK_STATE, "pl"), PL_FEEDBACK);
  assert.equal(widgetsCore.boostGameModeFeedbackText(FEEDBACK_STATE, { language: "pl" }), PL_FEEDBACK);
  assert.equal(boostCore.preview({ counts: { tabs: 2, panels: 1 } }, "en"), EN_PREVIEW);
  assert.equal(widgetsCore.boostGameModePreviewText({ counts: { tabs: 2, panels: 1 } }), EN_PREVIEW);
  assert.equal(boostCore.preview({ counts: { tabs: 2, panels: 1 } }, "pl"), PL_PREVIEW);
  assert.equal(widgetsCore.boostGameModePreviewText({ counts: { tabs: 2, panels: 1 } }, { language: "pl" }), PL_PREVIEW);
  assert.equal(widgetsCore.boostGameModeOffText(SNAPSHOT), EN_OFF);
  assert.equal(boostCore.off(SNAPSHOT, "en"), EN_OFF);
  assert.equal(widgetsCore.boostGameModeOffText(SNAPSHOT, { language: "pl" }), PL_OFF);
  assert.equal(boostCore.off(SNAPSHOT, "pl"), PL_OFF);
  assert.equal(widgetsCore.boostRestoreSnapshotLabel(SNAPSHOT), "Restore (1 apps, 2 tabs)");
  assert.equal(widgetsCore.boostRestoreSnapshotLabel({ panels: 0, tabs: 0 }), "Nothing to restore yet");
  for (const key of ["boost.gameFeedback", "boost.gamePreview", "boost.gameRestoreAction", "boost.restoreSnapshot"]) {
    assert.ok(widgetsCore.WIDGET_STRINGS.pl[key], key + " is translated");
    assert.notEqual(widgetsCore.WIDGET_STRINGS.pl[key], widgetsCore.WIDGET_STRINGS.en[key]);
  }
});

test("the Widgets menu labels Restore from the snapshot and keeps the legacy undo count", () => {
  const withSnapshot = widgetsCore.boostMenuItems({ running: false, snapshot: SNAPSHOT, gameMode: { on: true } });
  const restore = withSnapshot.find((item) => item.id === "restore");
  assert.equal(restore.label, "Restore (1 apps, 2 tabs)");
  assert.equal(restore.shortLabel, "Restore", "the one-row compact label is unchanged");
  assert.equal(restore.available, true);
  const empty = widgetsCore.boostMenuItems({ running: false, snapshot: { panels: 0, tabs: 0 } });
  const disabled = empty.find((item) => item.id === "restore");
  assert.equal(disabled.label, "Nothing to restore yet");
  assert.equal(disabled.hint, "Nothing to restore yet");
  assert.equal(disabled.available, false);
  const legacy = widgetsCore.boostMenuItems({ running: false, undoSize: 3 });
  assert.equal(legacy.find((item) => item.id === "restore").label, "Restore (3)");
  const polish = widgetsCore.boostMenuItems({ running: false, snapshot: SNAPSHOT, language: "pl" });
  assert.equal(polish.find((item) => item.id === "restore").label, "Przywróć (1 aplikacji, 2 kart)");
});

test("the full-pack tray previews before ON and lets the event door own the toast", async () => {
  const mount = await mountTray({ withApiHelpers: true, autoGameModeEvents: true });
  fire(mount.arrow, "click");
  const game = mount.popup.querySelectorAll(".zw-boost-menu-item")[2];
  fire(game, "mouseenter");
  assert.equal(game.getAttribute("data-zw-boost-preview"), EN_PREVIEW);
  assert.ok(mount.boost.calls.previewGameMode >= 1, "previewGameMode() is read on hover");
  fire(game, "click");
  await tick(20);
  assert.equal(mount.boost.calls.setGameMode, 1);
  assert.ok(mount.boost.calls.previewAtSet > 0, "the dry run precedes the ON switch");
  assert.ok(mount.boost.calls.previewGameMode >= 2, "and is read again immediately before ON");
  assert.equal(mount.toast().textContent, "Game Mode: freeing memory…",
    "the event toast replaces the old generic ON toast");
  assert.equal(mount.boost.listeners.size, 1, "one Game Mode event subscription");
  mount.api.destroy();
  assert.equal(mount.boost.listeners.size, 0, "and it is released with the tray");
});

test("the full-pack tray shows the final report and an OFF toast with a working Restore action", async () => {
  const mount = await mountTray({ withApiHelpers: true });
  mount.boost.emit({ action: "on-settle", state: FEEDBACK_STATE });
  assert.equal(mount.toast().textContent, EN_FEEDBACK);
  mount.boost.emit({ action: "off", state: { snapshot: SNAPSHOT } });
  assert.equal(mount.toast().querySelector(".zw-toast-line").textContent, EN_OFF);
  const action = mount.toast().querySelector(".zw-toast-action");
  assert.equal(action.textContent, "Restore");
  assert.equal(mount.restoreRow().getAttribute("aria-label"), "Restore (1 apps, 2 tabs)");
  fire(action, "click");
  await tick(20);
  assert.equal(mount.boost.calls.restoreSession, 1, "the action calls G5's Restore engine");
  assert.equal(mount.restoreRow().getAttribute("aria-label"), "Nothing to restore yet");
  assert.equal(mount.restoreRow().disabled, true, "and the snapshot label clears after Restore");
  mount.api.destroy();
  assert.equal(mount.boost.listeners.size, 0);
});

test("the standalone Boost card has the same preview, report and OFF Restore action", async () => {
  const h = await bootStandalone();
  assert.equal(h.action("restore").getAttribute("aria-label"), "Restore (1 apps, 2 tabs)");
  assert.equal(h.action("restore").disabled, false);
  h.fire(h.action("game-mode"), "mouseenter");
  assert.equal(h.card().querySelector(".zbsw-hint").textContent, EN_PREVIEW);
  assert.ok(h.calls.previewGameMode > 0, "the standalone card reads the dry run on demand");
  h.emitGameModeEvent({ action: "on-settle", state: FEEDBACK_STATE });
  assert.equal(h.card().querySelector(".zbsw-toast").textContent, EN_FEEDBACK);
  h.emitGameModeEvent({ action: "off", state: { snapshot: SNAPSHOT } });
  assert.equal(h.card().querySelector(".zbsw-toast-line").textContent, EN_OFF);
  const action = h.card().querySelector(".zbsw-toast-action");
  assert.equal(action.textContent, "Restore");
  h.fire(action, "click");
  await h.flush(0);
  assert.equal(h.calls.restoreSession, 1);
  assert.equal(h.action("restore").getAttribute("aria-label"), "Nothing to restore yet");
  assert.equal(h.action("restore").disabled, true);
  h.destroy();
  assert.equal(h.calls.gameModeSubscribe, h.calls.gameModeUnsubscribe, "the event door is balanced");
  assert.equal(h.calls.gameModeListeners.size, 0);
  assert.equal(h.calls.startSampling, h.calls.stopSampling, "G10's sampling balance is unchanged");
  assert.equal(h.calls.subscribe, h.calls.unsubscribe);
});

test("Polish feedback is identical in the standalone card and the tray's pure fallback", async () => {
  const standalone = await bootStandalone({ language: "pl-PL" });
  standalone.emitGameModeEvent({ action: "on-settle", state: FEEDBACK_STATE });
  assert.equal(standalone.card().querySelector(".zbsw-toast").textContent, PL_FEEDBACK);
  standalone.emitGameModeEvent({ action: "off", state: { snapshot: SNAPSHOT } });
  assert.equal(standalone.card().querySelector(".zbsw-toast-line").textContent, PL_OFF);
  assert.equal(standalone.card().querySelector(".zbsw-toast-action").textContent, "Przywróć");
  standalone.destroy();

  const mount = await mountTray({
    withApiHelpers: false,
    prefs: { "zen.workspace.zentral.widgets.language": "pl", "zen.workspace.zentral.notes.language": "pl" },
  });
  mount.boost.emit({ action: "on-settle", state: FEEDBACK_STATE });
  assert.equal(mount.toast().textContent, PL_FEEDBACK);
  mount.boost.emit({ action: "off", state: { snapshot: SNAPSHOT } });
  assert.equal(mount.toast().querySelector(".zw-toast-line").textContent, PL_OFF);
  assert.equal(mount.toast().querySelector(".zw-toast-action").textContent, "Przywróć");
  mount.api.destroy();
});

test("both card owners subscribe to events, never poll, and the generated bundles carry G7", () => {
  const trayCard = WIDGET_SRC.slice(
    WIDGET_SRC.indexOf("// ---- OW-90: the Boost card, which replaces the Status card"),
    WIDGET_SRC.indexOf("const onVisibilityOrResize"),
  );
  assert.match(WIDGET_SRC, /boostGameModeFeedbackText/);
  assert.match(WIDGET_SRC, /subscribeGameMode/);
  assert.match(WIDGET_SRC, /boostFeedbackText: boostGameModeFeedbackText/);
  assert.match(EXTRA, /onGameModeEvent/);
  assert.match(EXTRA, /releaseGameModeEvents/);
  assert.match(EXTRA, /gameModeEventCount/);
  assert.match(BUNDLE, /feedback\.gameOn/);
  assert.match(BUNDLE, /widgetFeedbackText/);
  assert.match(WIDGETS_BUNDLE, /boostGameModeFeedbackText/);
  assert.doesNotMatch(trayCard, /setInterval\s*\(/);
  assert.doesNotMatch(EXTRA, /setInterval\s*\(/);
  assert.doesNotMatch(EXTRA, /MutationObserver/);
  assert.doesNotMatch(EXTRA, /TabSelect/);
  assert.doesNotMatch(BUNDLE, /setInterval\s*\(/);
});

test("the generated standalone package and settings catalog are still current", () => {
  const build = spawnSync(process.execPath, ["tools/build-standalone.cjs", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  assert.match(build.stdout, /Standalone packages are up to date/);
  const coverage = spawnSync(process.execPath, ["tools/check-settings-consistency.cjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(coverage.status, 0, coverage.stdout + coverage.stderr);
  assert.match(coverage.stdout, /catalog checks passed/);
});

test("the active plan, perf report, README and handoff record G7 DONE", () => {
  assert.match(PLAN, /### G7 — Feedback in the UI \(DONE\)/);
  assert.match(PLAN, /\*\*DONE \(G7\):\*\*/);
  assert.match(PLAN, /\| `G7` \| \*\*DONE\*\*/);
  assert.match(PERF, /\| `G7` \|/);
  assert.match(PERF, /tests\/g7-game-mode-feedback\.test\.cjs` \(10 passed\)/);
  assert.match(PERF, /305\/305 passed; 0 failed/);
  assert.match(README, /## G7 UI feedback/);
  assert.match(HANDOFF, /all G0\.\.G11 plan tasks are DONE/);
  assert.match(HANDOFF, /`g7-game-mode-feedback` \(10\)/);
  assert.match(HANDOFF, /305\/305 passed; 0 failed/);
  assert.match(HANDOFF, /`G10` must be done before `G7`/, "the G9 handoff wording remains intact");
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\n${passed}/${tests.length} G7 Game Mode feedback tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
