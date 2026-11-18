"use strict";
/* OW-96: the calendar's weather line and the two new week-view shapes.
 *
 * Four things are pinned here, and each one is a rule rather than an implementation detail:
 *   1. the span ceiling is 48 and a plan stacks it into two rows of 24 only when both width and height allow it;
 *   2. the trust ladder decays with distance — a forecast a month out is refreshed four times rarer than today's;
 *   3. the calendar reads the widget's cache and never fetches (a calendar repaint is not a network event);
 *   4. a forecast index drops what it cannot draw instead of drawing "undefined" or an empty box.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

const NOTES_SRC = fs.readFileSync(path.join(__dirname, "..", "additional", "notes", "ZentralNotes.uc.js"), "utf8");
const NOTES_CSS = fs.readFileSync(path.join(__dirname, "..", "additional", "notes", "ZentralNotes.css"), "utf8");
const WIDGETS_SRC = fs.readFileSync(path.join(__dirname, "..", "additional", "widgets", "ZentralWidgets.uc.js"), "utf8");

test("the span ceiling is 48, and the model says so everywhere", () => {
  assert.equal(cal.WEEK_DAYS_LIMITS.max, 48);
  assert.equal(cal.WEEK_DAYS_LIMITS.maxRows, 2, "two rows is the shape 48 days are meant to take");
  assert.equal(cal.cleanWeekSpan({ days: 1000 }).days, 48, "a request beyond the ceiling is clamped, not refused");
  assert.equal(cal.visibleDays(new Date(2026, 0, 1).getTime(), 500).length, 48);
});

test("48 days stack into two rows of 24 only when the surface is wide and tall enough", () => {
  const wide = cal.weekGridPlan({ days: 48, widthPx: 2100, heightPx: 700 });
  assert.deepEqual(wide, { count: 48, rows: 2, perRow: 24 }, "the owner's case: two lines of 24");
  const narrow = cal.weekGridPlan({ days: 48, widthPx: 900, heightPx: 700 });
  assert.equal(narrow.rows, 1, "a narrow pane keeps one row and scrolls rather than squeezing two");
  const short = cal.weekGridPlan({ days: 48, widthPx: 2100, heightPx: 320 });
  assert.equal(short.rows, 1, "a short pane keeps one row: two rows in a strip is worse than a scroll");
  const seven = cal.weekGridPlan({ days: 7, widthPx: 900, heightPx: 700 });
  assert.deepEqual(seven, { count: 7, rows: 1, perRow: 7 }, "a normal week never changes shape");
});

test("the plan is safe on junk, because it runs on measured pixels that can be zero", () => {
  assert.deepEqual(cal.weekGridPlan({}), { count: 7, rows: 1, perRow: 7 });
  assert.deepEqual(cal.weekGridPlan({ days: 0, widthPx: 0, heightPx: 0 }), { count: 1, rows: 1, perRow: 1 });
  assert.equal(cal.weekGridPlan({ days: 48, widthPx: 2100, heightPx: 700, maxRows: 1 }).rows, 1, "maxRows is honoured");
  assert.equal(cal.weekGridPlan({ days: 48, widthPx: NaN, heightPx: NaN }).rows, 1, "an unmeasured pane is one row");
});

test("trust decays with distance, and never makes the widget poll harder", () => {
  assert.equal(cal.forecastTrust(0).trust, 1, "today is worth a full refresh");
  assert.equal(cal.forecastTrust(6).trust, 1, "the first week is all today-ish");
  assert.ok(cal.forecastTrust(7).trust < 1, "past a week it starts to decay");
  assert.ok(cal.forecastTrust(14).trust < cal.forecastTrust(7).trust, "and keeps decaying");
  assert.ok(cal.forecastTrust(48).trust >= 0.2, "but never to nothing: a stale symbol is still worth drawing");
  assert.equal(cal.forecastTrust(-5).trust, 1, "a day in the past is treated as today, not as infinitely stale");
  // The interval only ever relaxes.
  assert.equal(cal.forecastRefreshMinutes(30, 0), 30);
  assert.ok(cal.forecastRefreshMinutes(30, 30) > 30, "a month out refreshes rarer");
  assert.ok(cal.forecastRefreshMinutes(30, 30) <= 30 * 4, "and not absurdly rarer");
  assert.equal(cal.forecastRefreshMinutes(0, 0), 30, "a nonsense base falls back to a sane interval, never 0 (a 0 would poll forever)");
});

test("the index keeps what can be drawn and drops what cannot", () => {
  const index = cal.calendarWeatherIndex(
    [
      { key: "2026-11-17", icon: "sun", label: "Clear", high: 21, low: 11, units: "metric" },
      { key: "2026-11-18", icon: "rain", label: "Rain", high: null, low: 9, units: "metric" },
      { key: "2026-11-19", icon: "unknown", label: "?" },
      { key: "", icon: "sun", label: "Clear" },
      null,
    ],
    { todayKey: "2026-11-17" },
  );
  assert.equal(index.size, 2, "the unknown icon and the keyless entry are dropped, not drawn as blanks");
  assert.equal(index.get("2026-11-17").temp, "21\u00b0C");
  assert.equal(index.get("2026-11-17").range, "21\u00b0C / 11\u00b0C");
  assert.equal(index.get("2026-11-17").text, "Clear, 21\u00b0C / 11\u00b0C");
  assert.equal(index.get("2026-11-18").temp, "", "a missing high is empty, never the word undefined");
  assert.ok(!/undefined|NaN/.test(index.get("2026-11-18").text));
  assert.equal(index.get("2026-11-18").distance, 1);
  assert.ok(index.get("2026-11-18").trust <= 1);
});

test("the index labels the numbers with the reading's own units", () => {
  const imperial = cal.calendarWeatherIndex([{ key: "2026-11-17", icon: "sun", label: "Clear", high: 70, low: 50, units: "imperial" }], { todayKey: "2026-11-17" });
  assert.equal(imperial.get("2026-11-17").temp, "70\u00b0F", "an imperial reading is not relabelled as Celsius");
  const fallback = cal.calendarWeatherIndex([{ key: "2026-11-17", icon: "sun", label: "Clear", high: 21 }], { todayKey: "2026-11-17" });
  assert.equal(fallback.get("2026-11-17").temp, "21\u00b0C", "and a unitless entry follows the metric default");
});

test("the calendar asks the widget for its cache and never for a request", () => {
  const fn = NOTES_SRC.slice(NOTES_SRC.indexOf("const calendarWeatherByDay"), NOTES_SRC.indexOf("const calendarWeatherByDay") + 900);
  assert.match(fn, /window\.ZentralWidgets/, "it reads the widget API the module already publishes");
  assert.match(fn, /weatherDays\(\)/, "and only its cached days");
  assert.ok(!/\bfetch\(|XMLHttpRequest|requestRefresh/.test(fn), "a calendar repaint never starts a network request");
  assert.match(fn, /getPref\(PREF\.CAL_WEATHER_WEEK, true\)/, "week weather is on unless the reader says otherwise");
  assert.match(fn, /catch \(_\)/, "and a missing or broken widget is an absent line, never a broken calendar");
});

test("the symbol sits above the weekday name, as the owner asked", () => {
  const start = NOTES_SRC.indexOf('const wx = calWeather');
  assert.ok(start > 0, "the day head reads the forecast");
  const head = NOTES_SRC.slice(start, start + 1400);
  const weatherAt = head.indexOf("zn-cal-weather");
  const strongAt = head.indexOf('h("strong"');
  assert.ok(weatherAt > 0 && strongAt > weatherAt, "the weather line is built before the day-name element");
  assert.match(head, /aria-hidden": "true"/, "the glyph is decoration: the name for screen readers is on the button");
});

test("the stylesheet keeps the calendar symbol small but readable", () => {
  assert.match(NOTES_CSS, /\.zn-cal-weather-icon\s*\{[^}]*font-size: 1\.[0-9]+em/, "the glyph is text-sized, not a 10px speck");
  assert.match(NOTES_CSS, /\.zn-cal-weather-temp\s*\{[^}]*font-variant-numeric: tabular-nums/, "temperatures align down a row");
  assert.match(NOTES_CSS, /is-narrow[^{]{0,60}zn-cal-weather-temp\s*\{[^}]*display: none/, "a narrow column drops the number, not the glyph");
});

test("month view is an option and stays off by default", () => {
  const notesPrefs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "additional", "notes", "preferences.json"), "utf8"));
  const entry = (prop) => notesPrefs.find((e) => e.property === prop);
  assert.equal(entry("zen.workspace.zentral.notes.calendar_weather_week")?.defaultValue, true, "week weather is on");
  assert.equal(entry("zen.workspace.zentral.notes.calendar_weather_month")?.defaultValue, false, "month weather is off");
  assert.ok(entry("zen.workspace.zentral.notes.calendar_weather_month"), "but it exists, because the owner asked for the option");
});

test("the widget publishes the cache seam the calendar relies on", () => {
  assert.match(WIDGETS_SRC, /weatherDays: \(\) => \{/, "the read-only accessor exists");
  const start = WIDGETS_SRC.indexOf("weatherDays: () => {");
  const body = WIDGETS_SRC.slice(start, start + 1200);
  assert.match(body, /getCached\("weather"\)/, "it reads the weather card's cache, not a new request");
  assert.ok(!/\bfetch\(|requestRefresh/.test(body), "and it cannot trigger one either");
});

console.log(`\n${passed} calendar-weather tests passed`);
