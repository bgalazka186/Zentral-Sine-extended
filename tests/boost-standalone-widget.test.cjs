"use strict";
/* G10 — the Boost feature card must exist with ONLY additional/boost/ installed.
 * RED on the pre-G10 tree: the standalone package had no widget source/CSS, no
 * card visibility pref and no marker hand-off; the full-pack tray was the only UI.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createFakeStandaloneBoostHarness } = require("./helpers/fake-standalone-boost-harness.cjs");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const BUNDLE = read("additional/boost/ZentralBoost.standalone.uc.js");
const EXTRA = read("additional/boost/standalone/ZentralBoostWidget.js");
const CSS = read("additional/boost/ZentralBoostWidget.css");
const MANIFEST = json("additional/boost/standalone.json");
const SETTINGS = json("additional/boost/settings.json");
const ROOT_PREFS = json("preferences.json");
const BOOST_PREFS = json("additional/boost/preferences.json");
const THEME = json("additional/boost/theme.json");
const LAYOUT = json("extension/settings/layout.json");
const PLAN = read("docs/PLAN_CODING_AGENT_FOLLOWUP_GAME_MODE.md");
const PERF = read("docs/perf-results.md");
const AUDIT = read("docs/ow-123-standalone-ownership-audit.md");
const WIDGET_PREF = "zen.workspace.zentral.boost.widget_enabled";
const row = (rows, property) => rows.find((item) => item && item.property === property);

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function instrumentApi(api, calls) {
  let gameOn = false;
  api.lastMB = () => 512;
  api.memoryMB = () => 512;
  const origStart = api.startSampling;
  const origStop = api.stopSampling;
  const origOnChange = api.onChange;
  api.startSampling = (...args) => { calls.startSampling += 1; return origStart.apply(api, args); };
  api.stopSampling = (...args) => { calls.stopSampling += 1; return origStop.apply(api, args); };
  api.onChange = (...args) => {
    calls.subscribe += 1;
    const off = origOnChange.apply(api, args);
    return () => { calls.unsubscribe += 1; return off(); };
  };
  api.previewGameMode = () => {
    calls.previewGameMode += 1;
    return { counts: { tabs: 2, panels: 1 } };
  };
  api.sessionState = () => ({ panels: 1, tabs: 2, restorableTabs: 2, active: true });
  api.gameModeState = () => ({ on: gameOn });
  api.runLevel1 = () => { calls.runLevel1 += 1; return Promise.resolve({ freedMB: 10 }); };
  api.runLevel2 = () => { calls.runLevel2 += 1; return Promise.resolve({ freedMB: 20, unloaded: { tabs: 1, panels: 0 } }); };
  api.setGameMode = (on) => { calls.setGameMode += 1; gameOn = Boolean(on); return { on: gameOn }; };
  api.restoreSession = () => { calls.restoreSession += 1; return { panels: 1, tabs: 2 }; };
}
const boot = (options = {}) => createFakeStandaloneBoostHarness({
  instrumentApi: options.instrumentApi || instrumentApi,
  ...options,
}).boot();

test("the standalone manifest, settings, generated package and stylesheet declare the Boost-owned card", () => {
  assert.equal(MANIFEST.css, "ZentralBoostWidget.css");
  assert.equal(MANIFEST.loader, "__zentralBoostLoader");
  assert.deepEqual(MANIFEST.extras, ["standalone/ZentralBoostWidget.js"]);
  assert.equal(THEME.style.chrome, "ZentralBoostWidget.css");
  assert.ok(row(SETTINGS.schema, WIDGET_PREF), "the card has its own kill switch");
  assert.equal(row(SETTINGS.schema, WIDGET_PREF).defaultValue, true);
  assert.ok(row(ROOT_PREFS, WIDGET_PREF), "root preferences ship the kill switch");
  assert.ok(row(BOOST_PREFS, WIDGET_PREF), "standalone preferences ship the kill switch");
  assert.ok(LAYOUT.order.includes(WIDGET_PREF), "G11: the new pref has a placed settings row");
  assert.match(CSS, /max-height:\s*26px\s*!important/, "OW-121's one-row popup rule");
  assert.match(CSS, /flex-direction:\s*row\s*!important/);
  assert.match(EXTRA, /createSidebarHoverCard/);
  assert.match(EXTRA, /nativeSidebarRect/);
  assert.match(EXTRA, /registerHostUnload/);
  assert.match(BUNDLE, /Standalone-only Boost card/);
  assert.doesNotMatch(EXTRA, /setInterval\s*\(/);
  assert.doesNotMatch(BUNDLE, /setInterval\s*\(/);
  assert.doesNotMatch(EXTRA, /MutationObserver/);
  assert.doesNotMatch(EXTRA, /TabSelect/);
});

test("the generated package is current and G11 still reaches every preference", () => {
  const build = spawnSync(process.execPath, ["tools/build-standalone.cjs", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  assert.match(build.stdout, /Standalone packages are up to date/);
  const coverage = spawnSync(process.execPath, ["tools/check-settings-consistency.cjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(coverage.status, 0, coverage.stdout + coverage.stderr);
  assert.match(coverage.stdout, /catalog checks passed/);
});

test("only Boost installed: one visible card, four actions and an on-demand RAM value", async () => {
  const h = await boot();
  const marker = h.win.__zentralBoostStandaloneWidget;
  assert.ok(marker, "the late-tray hand-off marker is published");
  assert.equal(marker.mode, "self");
  assert.equal(marker.visible(), true);
  const card = h.card();
  assert.ok(card, "one self-contained Boost card exists");
  assert.equal(card.hidden, false, "and it is visible without hovering a second widget");
  assert.equal(docCards(h.doc).length, 1, "exactly one Boost card");
  assert.deepEqual(h.actions().map((el) => el.getAttribute("data-zw-boost-action")),
    ["free-light", "free-deep", "game-mode", "restore"]);
  assert.equal(card.querySelector(".zbsw-value").textContent, "512 MB");
  assert.equal(h.calls.startSampling, 1, "sampling starts once while the card is open");
  h.destroy();
});
function docCards(doc) { return doc.querySelectorAll("#zentral-boost-standalone-card"); }

test("clicks call the four real Boost doors, and the Game switch previews before it acts", async () => {
  const h = await boot();
  const game = h.action("game-mode");
  assert.ok(game);
  h.fire(game, "mouseenter");
  assert.match(h.card().querySelector(".zbsw-hint").textContent, /Will free about 2 tabs and 1 apps/);
  assert.ok(h.calls.previewGameMode >= 1, "previewGameMode() is read on demand");
  for (const id of ["free-light", "free-deep", "game-mode", "restore"]) {
    const button = h.action(id);
    assert.ok(button, id + " action exists");
    assert.equal(button.disabled, false, id + " is available");
    h.fire(button, "click");
  }
  await h.flush(0);
  assert.equal(h.calls.runLevel1, 1);
  assert.equal(h.calls.runLevel2, 1);
  assert.equal(h.calls.setGameMode, 1);
  assert.equal(h.calls.restoreSession, 1);
  assert.ok(h.calls.previewGameMode >= 2, "the switch re-reads the dry run before acting");
  h.destroy();
});

test("destroy removes the card, listeners, one-shot timers and balances sampling/subscriptions", async () => {
  const h = await boot();
  h.fire(h.action("free-light"), "click");
  await h.flush(0);
  const beforeDoc = h.listenerCount("doc");
  const beforeWin = h.listenerCount("win");
  assert.ok(beforeDoc > 0 || beforeWin > 0, "the card installed owned listeners");
  h.destroy();
  assert.equal(h.card(), null, "the card node is gone");
  assert.equal(h.anchor(), null, "the hover anchor is gone");
  assert.equal(h.win.__zentralBoostStandaloneWidget, undefined, "the hand-off marker is gone");
  assert.equal(h.timers.size, 0, "no card or sampler timer survives destroy");
  assert.equal(h.calls.startSampling, h.calls.stopSampling, "startSampling/stopSampling are balanced");
  assert.equal(h.calls.subscribe, h.calls.unsubscribe, "onChange subscriptions are balanced");
  assert.ok(h.listenerCount("doc") < beforeDoc || h.listenerCount("win") < beforeWin,
    "owned DOM/window listeners were released");
});

test("English and Polish strings come from Boost's own card dictionary", async () => {
  const en = await boot({ language: "en" });
  assert.equal(en.card().getAttribute("aria-label"), "512 MB \u00b7 Memory Boost");
  assert.deepEqual(en.actions().map((el) => el.textContent), ["Light", "Deep", "Game", "Restore"]);
  en.destroy();
  const pl = await boot({ language: "pl-PL" });
  assert.match(pl.card().getAttribute("aria-label"), /Pamięć Boost/);
  assert.deepEqual(pl.actions().map((el) => el.textContent), ["Lekko", "Głęboko", "Gra", "Przywróć"]);
  pl.destroy();
});

test("full pack present: the standalone bundle returns and creates zero cards", async () => {
  const h = await boot({ runtimePresent: true, instrumentApi: null });
  assert.equal(h.card(), null);
  assert.equal(h.anchor(), null);
  assert.equal(h.win.__zentralStandalone, undefined, "the standalone shim never started");
  assert.equal(h.win.__zentralBoostStandaloneWidget, undefined, "no external marker");
  h.destroy();
});

test("standalone Widgets tray present: zero self-contained cards and one tray registration", async () => {
  const registrations = [];
  const widgets = {
    registrations,
    registerWidget(def) { registrations.push(def); return true; },
    unregisterWidget(id) {
      const at = registrations.findIndex((def) => def.id === id);
      if (at >= 0) registrations.splice(at, 1);
      return true;
    },
    listWidgets: () => registrations.map((def) => ({ id: def.id })),
  };
  const h = await boot({ widgets });
  assert.equal(h.win.__zentralBoostStandaloneWidget.mode, "tray");
  assert.equal(h.card(), null, "no self-contained card");
  assert.equal(registrations.length, 1, "exactly one Boost registration");
  assert.equal(registrations[0].id, "boost");
  const instance = registrations[0].create({ document: h.doc, window: h.win });
  assert.deepEqual(instance.element.querySelectorAll("[data-zw-boost-action]").map((el) => el.getAttribute("data-zw-boost-action")),
    ["free-light", "free-deep", "game-mode", "restore"]);
  h.destroy();
  assert.equal(registrations.length, 0, "Boost teardown unregisters the external tray card");
});

test("Widgets-first load order keeps the tray's built-in Boost card without a duplicate", async () => {
  const registrations = [{ id: "boost" }];
  const widgets = {
    registrations,
    listWidgets: () => registrations.map((def) => ({ id: def.id })),
    registerWidget(def) { registrations.push(def); return true; },
  };
  const h = await boot({ widgets });
  assert.equal(h.card(), null);
  assert.equal(registrations.length, 1, "Boost does not register a second tray card");
  assert.equal(h.win.__zentralBoostStandaloneWidget.mode, "tray");
  h.destroy();
});

test("plan, perf and the frozen ownership audit record the G10 follow-up", () => {
  assert.match(PLAN, /\| `G10` \| \*\*DONE\*\*/);
  assert.match(PERF, /\| `G10` \|/);
  assert.match(PERF, /tests\/boost-standalone-widget\.test\.cjs` \(10 passed\)/);
  assert.match(AUDIT, /## Dated follow-up \(2026-11-19, G10\)/);
  assert.match(AUDIT, /Finding 1 is addressed in code/);
  assert.match(AUDIT.split("## Dated follow-up")[0], /No audit finding was fixed\./,
    "the frozen audit above is not rewritten");
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\n${passed}/${tests.length} G10 standalone widget tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
