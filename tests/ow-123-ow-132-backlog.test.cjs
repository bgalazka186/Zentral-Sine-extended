"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CURRENT_VERSION = require("../theme.json").version;
const todo = fs.readFileSync(path.join(ROOT, "TODO_notes_roadmap.md"), "utf8");
const flatTodo = todo.replace(/\s+/g, " ");
const weather = fs.readFileSync(path.join(ROOT, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const options = fs.readFileSync(path.join(ROOT, "docs/weather-rain-options.md"), "utf8");
const notes = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
const calendar = fs.readFileSync(path.join(ROOT, "additional/notes/calendar/ZentralNotesCalendar.js"), "utf8");
const hover = fs.readFileSync(path.join(ROOT, "extension/panels/interaction/ZentralPanelHover.js"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const items = [
  ["OW-123", "duplicates have no title but do have a favicon"],
  ["OW-124", "ProblemyProblemy"],
  ["OW-125", "Zen `1.24.3b` compatibility audit"],
  ["OW-126", "Twilight `1.25t` readiness"],
  ["OW-127", "order in which widgets give up space"],
  ["OW-128", "Weather Today view rain timing"],
  ["OW-129", "Clock quick note chevron"],
  ["OW-130", "Pill menu autohide: click vs hold"],
  ["OW-131", "Reminder/event color picker"],
  ["OW-132", "Colored DEMO notes"],
];

try {
  test("1. all ten owner backlog rows are present with stable IDs", () => {
    for (const [id, phrase] of items) {
      assert.ok(todo.includes("`" + id + "`"), id + " row is missing");
      assert.ok(todo.includes(phrase), id + " owner wording is missing");
      assert.ok(todo.includes("#### `" + id + "`"), id + " task block is missing");
    }
  });

  test("2. evidence-first items are not marked fixed without targeted live data", () => {
    assert.match(todo, /OW-123[^\n]*targeted outer-tab evidence required/);
    assert.match(flatTodo, /OW-124[\s\S]*?Do not guess which road duplicates/);
    assert.match(todo, /request only the outer attributes/);
    assert.match(todo, /Do not ask for a full JSON dump/);
  });

  test("3. Zen 1.24.3b and Twilight 1.25t audits are recorded as static, not live-accepted", () => {
    assert.ok(fs.existsSync(path.join(ROOT, "docs/zen-1243b-compat-audit.md")));
    assert.ok(fs.existsSync(path.join(ROOT, "docs/zen-125t-compat-audit.md")));
    assert.match(flatTodo, /No `1\.25t` tag exists yet, so no code guard is guessed/);
    assert.match(todo, /OWNER GATE: live/);
  });

  test("4. widget space priority requires settings, tests and readable responsive behavior", () => {
    assert.match(todo, /add a pure priority resolver and settings\/preferences rows first/);
    assert.match(todo, /Scroll access must be readable/);
    assert.match(todo, /must not add height to the collapsed sidebar/);
  });

  test("5. weather implementation follows the owner's Option A choice", () => {
    assert.match(todo, /Owner chose \*\*Option A\*\*/);
    assert.match(options, /Owner chose \*\*Option A\*\*/);
    assert.match(options, /## Option A — Hourly \+ optional 15-minute near-term \(recommended\)/);
    assert.match(options, /## Option B — Hourly only/);
    assert.match(options, /## Option C — Daily only/);
    assert.match(options, /## Option D — 15-minute-first/);
    assert.match(options, /pojutrze/);
    assert.match(options, /all day/);
    assert.match(options, /heavy rain/);
    assert.match(options, /15\/30\/45 min/);
    assert.match(options, /keeping the existing one-request refresh policy/);
  });

  test("6. Option A source uses bounded rain series and localized phrases, not a hard-coded English outlook", () => {
    assert.match(weather, /weatherRainPlan/);
    assert.match(weather, /readWeatherRainSeries/);
    assert.match(weather, /hourly=precipitation,rain,showers,weather_code,precipitation_probability/);
    assert.match(weather, /minutely_15=precipitation,rain,weather_code/);
    assert.match(weather, /pojutrze/);
    assert.doesNotMatch(weather, /Rain tomorrow/, "the daily-only hard-coded phrase is gone");
  });

  test("7. clock quick note, pill menu, reminder color and DEMO colors keep their explicit contracts", () => {
    assert.match(flatTodo, /hidden until a small\s+bottom-right chevron/);
    assert.match(flatTodo, /short pointer-up or click applies hide\s+once, even when autohide is off; hold toggles the\s+saved preference/);
    assert.match(flatTodo, /inherits the\s+category color but allows another color while keeping the category/);
    assert.match(flatTodo, /stable per-demo color to each `DEMO_NOTES` entry/);
    assert.match(flatTodo, /do not change existing installed demo\s+notes on reinstall/);
    for (const suite of [
      "ow-124-duplicated-sidebar-title.test.cjs",
      "ow-127-widget-space-priority.test.cjs",
      "ow-128-weather-rain-timing.test.cjs",
      "ow-129-clock-quick-note-chevron.test.cjs",
      "ow-130-pill-autohide-gesture.test.cjs",
      "ow-131-ow-132-note-colors.test.cjs",
    ]) assert.ok(fs.existsSync(path.join(ROOT, "tests", suite)), suite + " RED->GREEN suite exists");
    assert.match(weather, /clockQuickNoteVisibility/);
    assert.match(weather, /cleanWidgetSpacePolicy/);
    assert.match(hover, /\/\/ <<OW-130 PIN-STYLE GESTURE>>/);
    assert.match(hover, /pillAutohidePending/);
    assert.match(calendar, /resolveCalendarItemColor/);
    assert.match(notes, /demoNoteColorPlan/);
  });

  test("8. version and release-loop constraints remain pinned", () => {
    assert.ok(flatTodo.includes(`Keep the project version at ${CURRENT_VERSION} unless the owner explicitly authorizes another change`));
    assert.match(flatTodo, /FOLLOW-UP 5 \(C1\).*3\.4\.2.*Boost\/Widgets split/);
    assert.ok(flatTodo.includes(`Version ${CURRENT_VERSION} is the current release update`));
    assert.match(flatTodo, /Do not run `--bump` or change it again without owner authorization/);
    assert.ok(flatTodo.includes("sync-version.cjs --check` should report " + CURRENT_VERSION));
  });

  console.log(`OW-123..OW-132 backlog specification tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
