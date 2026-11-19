"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const doc = fs.readFileSync(path.join(ROOT, "docs/weather-rain-options.md"), "utf8");
const todo = fs.readFileSync(path.join(ROOT, "TODO_notes_roadmap.md"), "utf8");
const widgets = fs.readFileSync(path.join(ROOT, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const readme = fs.readFileSync(path.join(ROOT, "additional/widgets/README.md"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

try {
  test("1. options document records real Open-Meteo capabilities", () => {
    for (const term of [
      "precipitation_probability",
      "precipitation_hours",
      "minutely_15",
      "forecast_minutely_15",
      "timezone=auto",
      "timeformat=unixtime",
      "weather_code",
      "65", "67", "82",
    ]) assert.ok(doc.includes(term), term);
    assert.match(doc, /https:\/\/open-meteo\.com\/en\/docs/);
    assert.match(doc, /interpolates from hourly data/);
    assert.match(readme, /api\.open-meteo\.com\/v1\/forecast/);
  });

  test("2. all four options and the recommendation are present", () => {
    assert.match(doc, /## Option A — Hourly \+ optional 15-minute near-term \(recommended\)/);
    assert.match(doc, /## Option B — Hourly only/);
    assert.match(doc, /## Option C — Daily only/);
    assert.match(doc, /## Option D — 15-minute-first/);
    assert.match(doc, /## Recommendation[\s\S]*Option A/);
  });

  test("3. owner's requested phrases and readability contract are pinned", () => {
    for (const term of ["today", "jutro", "tomorrow", "pojutrze", "45 min", "30 min", "15 min", "9–15", "heavy rain", "all day"]) {
      assert.ok(doc.includes(term), term);
    }
    assert.match(doc, /readable at every widget\s+width\/height/);
    assert.match(doc, /keeps the existing\s+one-request refresh policy/);
  });

  test("4. owner chose Option A and the static implementation is shipped", () => {
    assert.match(doc, /Owner chose \*\*Option A\*\*/);
    assert.match(todo, /Owner chose \*\*Option A\*\*/);
    assert.match(todo, /`OW-128`[^\n]*`DONE`/);
    assert.match(widgets, /weatherRainPlan/);
    assert.match(widgets, /hourly=precipitation,rain,showers,weather_code,precipitation_probability/);
    assert.match(widgets, /minutely_15=precipitation,rain,weather_code/);
    assert.match(widgets, /pojutrze/);
    assert.doesNotMatch(widgets, /Rain tomorrow/, "the hard-coded English outlook is gone");
  });

  console.log(`Weather rain-timing options tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
