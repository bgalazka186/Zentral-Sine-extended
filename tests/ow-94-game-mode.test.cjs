"use strict";
/* OW-94 (plan B7): the pause switch, and Game Mode's decisions.
 *
 * Two things are proven here, and they are the two the plan spends its words on:
 *   1. the switch itself — idempotent, notifies synchronously, survives a listener that throws or unsubscribes itself;
 *   2. the exemptions — an audible tab and the video preview's source tab are never deactivated, and `Stronger saver`
 *      is what decides whether a `live` record is a candidate.
 *
 * Every feature is checked for its subscription by reading its shipped source, because "a feature that keeps a timer
 * while paused" is a fact about the code, not about a runtime the test cannot build (there is no browser here: the
 * timers are Gecko's).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// The switch module, loaded exactly as the runtime loads it: a plain script that publishes one global.
function loadSwitch({ now } = {}) {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(read("loader/ZentralPerformanceSwitch.js"), sandbox, { filename: "ZentralPerformanceSwitch.js" });
  return sandbox.window.ZentralPerformanceSwitch.create(now ? { now } : undefined);
}

// A function lifted from a shipped file by name, so the test runs the real body.
function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  let began = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") { depth += 1; began = true; }
    else if (source[i] === "}") {
      depth -= 1;
      if (began && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced " + name);
}

test("the switch starts unpaused and setPaused is idempotent", () => {
  const sw = loadSwitch();
  assert.equal(sw.isPaused(), false);
  sw.setPaused(true);
  assert.equal(sw.isPaused(), true);
  const before = sw.snapshot().changes;
  sw.setPaused(true);
  assert.equal(sw.snapshot().changes, before, "setting the same value twice is one change, not two");
});

test("subscribers hear every change synchronously, and can leave", () => {
  const sw = loadSwitch({ now: () => 1000 });
  const heard = [];
  const off = sw.subscribe((paused, state) => heard.push([paused, state.changes]));
  sw.setPaused(true);
  assert.deepEqual(heard, [[true, 1]], "the listener ran before setPaused returned");
  sw.setPaused(false);
  assert.deepEqual(heard, [[true, 1], [false, 2]]);
  off();
  sw.setPaused(true);
  assert.equal(heard.length, 2, "an unsubscribed listener is not called");
});

test("a listener that throws or unsubscribes itself does not break the others", () => {
  const sw = loadSwitch();
  let second = 0;
  const offFirst = sw.subscribe(() => {
    offFirst();
    throw new Error("boom");
  });
  sw.subscribe(() => { second += 1; });
  sw.setPaused(true);
  sw.setPaused(false);
  assert.equal(second, 2, "the surviving listener heard both changes");
});

test("`onChange` is `subscribe`, and `toggle` is `setPaused(!paused)`", () => {
  const sw = loadSwitch();
  assert.equal(sw.onChange, sw.subscribe, "the plan's name for it is the same function");
  sw.toggle();
  assert.equal(sw.isPaused(), true);
  sw.toggle();
  assert.equal(sw.isPaused(), false);
});

test("the runtime publishes the switch as ZentralRuntime.performance", () => {
  const runtime = read("loader/ZentralRuntime.js");
  assert.match(runtime, /moduleLoader\.load\("loader\/ZentralPerformanceSwitch\.js"\)/,
    "the module is loaded by the runtime");
  assert.match(runtime, /const factory = window\.ZentralPerformanceSwitch\?\.create;/,
    "and its factory is used, with a documented fallback if an old copy loads without it");
  assert.match(runtime, /performance: performanceSwitch,/, "published under the plan's own name");
  // The creation must come BEFORE the runtime literal: the literal reads it eagerly, and a later `const` would be a
  // temporal dead zone error at startup, not at the first game.
  const created = runtime.indexOf("const performanceSwitch = createPerformanceSwitch()");
  const published = runtime.indexOf("performance: performanceSwitch,");
  assert.ok(created > 0 && created < published, "the switch exists before the object that publishes it");
});

test("every repeating feature subscribes and honours the pause", () => {
  // Each row is [file, the moment it asks "are we paused?"]. The point of the table is that the plan's own list —
  // video preview, widgets, RSS, Notes, the panel fallback poll — is covered by a real check, not by a promise.
  const cases = [
    ["additional/video/ZentralVideoPreview.uc.js", /videoPerformancePaused\(\)/, "discovery has no interval while paused"],
    ["additional/widgets/ZentralWidgets.uc.js", /scheduler\.setHeld\(paused, lastArea\)/, "the scheduler is held"],
    ["additional/rss/ZentralRssDisplay.uc.js", /if \(performancePaused\(\)\) \{/, "the scan is skipped"],
    ["additional/notes/ZentralNotes.uc.js", /paused: \(\) => Boolean\(performanceSwitch\?\.isPaused\?\.\(\)\)/, "the minute wake"],
    // G6: the fallback poll now asks the shared pause/Game Mode predicate instead of duplicating the raw check.
    ["extension/panels/ZentralPanels.uc.js", /!automaticWakeBlocked\(\)/, "the fallback poll"],
  ];
  for (const [file, pattern, what] of cases) {
    const source = read(file);
    assert.match(source, pattern, `${file}: ${what}`);
    assert.match(source, /\.subscribe\?\.\(|\.subscribe\(/, `${file} subscribes to the switch`);
  }
  const panels = read("extension/panels/ZentralPanels.uc.js");
  assert.match(panels, /const automaticWakeBlocked = \(\) => Boolean\([\s\S]*?performance\?\.isPaused\?\.\(\)/,
    "the shared fallback-pause predicate still reads the runtime performance switch");
});

test("the video preview stops scanning without touching playback", () => {
  const source = read("additional/video/ZentralVideoPreview.uc.js");
  const scanInterval = extract(source, "scanIntervalMs");
  assert.match(scanInterval, /if \(videoPerformancePaused\(\)\) return 0;/, "zero is the file's own \"no interval\" value");
  // The plan's owner gate is that a podcast keeps playing. Nothing in the pause path may pause media or tear down the
  // receiver: only the discovery/caption/visibility intervals change.
  const subscription = source.slice(source.indexOf("const unsubscribePerformance = videoPerformance"));
  const body = subscription.slice(0, subscription.indexOf("}) || null;") + 10);
  for (const forbidden of [".pause()", "releaseBridge", "resetRendering", "destinationNode", "video.pause"]) {
    assert.equal(body.includes(forbidden), false, `the pause path must not call ${forbidden}`);
  }
});

test("Notes catches up on resume instead of losing the deadline", () => {
  const source = read("additional/notes/ZentralNotes.uc.js");
  assert.match(source, /if \(paused\(\)\) \{ native = null; return; \}/, "a paused service arms nothing");
  assert.match(source, /onPausedChange\(isPaused\) \{ if \(isPaused\) arm\(\); else check\("wake"\); \}/,
    "resume checks immediately, which fires what came due and re-arms");
});

test("Game Mode exemptions: an audible tab and the video source are never deactivated", () => {
  const source = read("additional/boost/ZentralBoost.uc.js");
  const body = extract(source, "gameModeExemptReason");
  assert.match(body, /table\?\.isAudible\?\.\(tab\)/, "audibility comes from the shared policy, not a second definition");
  assert.match(body, /tab === videoSource/, "the Big Picture video source is exempt");
  assert.match(body, /tab === window\.gBrowser\?\.selectedTab/, "and the tab being looked at");
});

test("Stronger saver is the Level 2 all-modes switch outside Game Mode", () => {
  const source = read("additional/boost/ZentralBoost.uc.js");
  // G8: a plain deep pass still defaults to `asleep-allowed`; the pref opens every mode for Level 2 OUTSIDE Game Mode.
  // Game Mode itself uses the G2 planner's consent, so it no longer depends on this pref or a second saver pass.
  assert.match(source, /const modes = Array\.isArray\(options\.allowModes\) \? options\.allowModes :\s*\n?\s*\(prefBool\(PREF\.STRONGER_SAVER, false\) \? \[\.\.\.BACKGROUND_MODES\] : \["asleep-allowed"\]\);/);
  assert.match(source, /if \(gameMode\.on\) return gameModeState\(\);/, "Game Mode blocks a parallel Level 2 pass");
  assert.match(source, /async function runGameModePass\(/, "Game Mode has one plan-driven pass");
  assert.doesNotMatch(source, /strongerSaverSleep/, "no second generic Game Mode saver path remains");
  assert.equal((source.match(/allowModes: \[\.\.\.BACKGROUND_MODES\]/g) || []).length, 0,
    "the pref, not an option from Game Mode, opens every mode");
});

test("switching Game Mode off restores the selected tab, not every browser", () => {
  const source = read("additional/boost/ZentralBoost.uc.js");
  const off = source.slice(source.indexOf("gameMode.on = false;"));
  assert.match(off.slice(0, 900), /restoreGameModeActivity\(\)/, "what it changed is put back");
  assert.match(off.slice(0, 900), /restoreSelectedTabActivity\(\)/, "and the selected tab is made active again");
  const selected = extract(source, "restoreSelectedTabActivity");
  assert.match(selected, /docShellIsActive !== true/);
  assert.equal(/for \(const tab of/.test(selected), false, "it never walks every tab");
});

test("the two prefs exist, are off by default, and the mode is not remembered across a restart", () => {
  const settings = JSON.parse(read("additional/boost/settings.json"));
  const byProp = new Map(settings.schema.map((item) => [item.property, item]));
  for (const name of ["game_mode", "stronger_saver"]) {
    const item = byProp.get(`zen.workspace.zentral.boost.${name}`);
    assert.ok(item, name + " is declared");
    assert.equal(item.defaultValue, false, name + " defaults to off");
    assert.equal(item.type, "checkbox");
  }
  // "Off when the browser restarts" is a promise in the label, so it has to be true of the code: nothing writes the
  // pref on startup and nothing remembers it in a session field.
  const source = read("additional/boost/ZentralBoost.uc.js");
  assert.equal(/setBoolPref\(PREF\.GAME_MODE, true\)/.test(source), false, "nothing turns Game Mode on by itself");
});

async function main() {
  for (const [name, fn] of tests) {
    if (fn.constructor.name === "AsyncFunction") await fn();
    else fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-94-game-mode (${passed} passed)`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
