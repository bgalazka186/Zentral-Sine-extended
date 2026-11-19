"use strict";
/* OW-109: Weather widget default view, direct view switch persistence, Week descriptions & compact dates. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeSidebarHarness } = require("./helpers/fake-widgets-harness.cjs");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/settings.json"), "utf8"));
const STANDALONE = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/standalone.json"), "utf8"));
const WIDGETS_CSS = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.css"), "utf8");
const LAYOUT = JSON.parse(fs.readFileSync(path.join(root, "extension/settings/layout.json"), "utf8"));

const seam = {};
const win = { __zentralWidgetsTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(SRC, {
  window: win,
  globalThis: { Services: {} },
  URL,
  Date,
  JSON,
  Math,
  Promise,
  RegExp,
  Number,
  String,
  Array,
  Object,
  Map,
  Set,
  Intl,
  console,
});
const c = seam.core;
const plain = (v) => JSON.parse(JSON.stringify(v));

const DEFAULT_VIEW_PREF = "zen.workspace.zentral.widgets.weather.default_view";
const ACTIVE_VIEW_PREF = "zen.workspace.zentral.widgets.weather.view";
const LANG_PREF = "zen.workspace.zentral.widgets.language";
const NOTES_LANG_PREF = "zen.workspace.zentral.notes.language";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

test("weather.default_view preference schema, layout, and standalone metadata", () => {
  const entry = (SETTINGS.schema || []).find((x) => x.property === DEFAULT_VIEW_PREF);
  assert.ok(entry, "default_view exists in schema");
  assert.equal(entry.type, "dropdown");
  assert.equal(entry.defaultValue, "today");
  assert.deepEqual(entry.options.map((o) => o.value), ["today", "tomorrow", "week"]);
  assert.ok(SETTINGS.settings[DEFAULT_VIEW_PREF], "default_view has settings metadata");
  assert.ok((LAYOUT.order || []).includes(DEFAULT_VIEW_PREF), "default_view is in layout order");
  assert.ok((STANDALONE.preferenceOrder || []).includes(DEFAULT_VIEW_PREF), "default_view is in standalone preferenceOrder");
  assert.ok((STANDALONE.externalPrefs || []).includes(ACTIVE_VIEW_PREF), "weather.view state pref is declared in externalPrefs");
});

test("resolveWeatherView validates saved selection and configured default", () => {
  assert.equal(c.resolveWeatherView("", "today"), "today");
  assert.equal(c.resolveWeatherView("", "tomorrow"), "tomorrow");
  assert.equal(c.resolveWeatherView("", "week"), "week");
  assert.equal(c.resolveWeatherView("  WEEK ", "today"), "week");
  assert.equal(c.resolveWeatherView("bogus", "tomorrow"), "tomorrow");
  assert.equal(c.resolveWeatherView("bogus", "bogus"), "today");
  assert.equal(c.resolveWeatherView("today", "week"), "today", "explicit manual today overrides default week");
  assert.equal(c.resolveWeatherView("tomorrow", "week"), "tomorrow");
});

test("weatherDayNumberLabel handles ISO dates, unixtime, month boundaries, and locales", () => {
  assert.equal(c.weatherDayNumberLabel("2026-11-18", { lang: "en" }), "18.");
  assert.equal(c.weatherDayNumberLabel("2026-11-19", { lang: "pl" }), "19.");
  // Month boundary: Nov 29 -> Nov 30 -> Dec 1 -> Dec 2
  assert.deepEqual(
    ["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"].map((d) => c.weatherDayNumberLabel(d, { lang: "pl" })),
    ["29.", "30.", "1.", "2."],
  );
  // Jan 31 -> Feb 1 boundary via Unix seconds in Europe/Warsaw
  const jan31 = Math.floor(Date.UTC(2027, 0, 31, 0, 0, 0) / 1000);
  const feb1 = Math.floor(Date.UTC(2027, 1, 1, 0, 0, 0) / 1000);
  assert.equal(c.weatherDayNumberLabel(String(jan31), { timeZone: "Europe/Warsaw", lang: "pl" }), "31.");
  assert.equal(c.weatherDayNumberLabel(String(feb1), { timeZone: "Europe/Warsaw", lang: "pl" }), "1.");
  assert.equal(c.weatherDayNumberLabel("", { lang: "en" }), "");
});

test("weatherViewParts keeps actual Today/Tomorrow descriptions and compact dates in EN and PL", () => {
  const payload = {
    current: { temperature_2m: 11.2, relative_humidity_2m: 74, wind_speed_10m: 12, weather_code: 0, time: 1795003200 },
    timezone: "Europe/Warsaw",
    daily: {
      time: [
        Math.floor(Date.UTC(2026, 10, 29, 0, 0, 0) / 1000),
        Math.floor(Date.UTC(2026, 10, 30, 0, 0, 0) / 1000),
        Math.floor(Date.UTC(2026, 11, 1, 0, 0, 0) / 1000),
      ],
      weather_code: [0, 61, 71],
      temperature_2m_max: [11, 8, 2],
      temperature_2m_min: [3, 2, -3],
    },
  };
  const reduced = c.readWeatherPayload(payload, "metric", "en");

  const enWeek = c.weatherViewParts(reduced, "week", { lang: "en" });
  assert.deepEqual(plain(enWeek.lines.map((l) => l.dateLabel)), ["29.", "30.", "1."]);
  assert.deepEqual(plain(enWeek.lines.map((l) => l.label)), ["Clear sky", "Light rain", "Light snow"]);
  assert.deepEqual(plain(enWeek.lines.map((l) => l.day)), ["Clear sky", "Light rain", "Light snow"]);

  const plWeek = c.weatherViewParts(reduced, "week", { lang: "pl" });
  assert.deepEqual(plain(plWeek.lines.map((l) => l.dateLabel)), ["29.", "30.", "1."]);
  assert.deepEqual(plain(plWeek.lines.map((l) => l.label)), [
    "Bezchmurnie",
    "S\u0142aby deszcz",
    "S\u0142aby \u015bnieg",
  ]);
  assert.equal(plWeek.lines[0].day, "Bezchmurnie", "Polish today keeps description in Week view");
  assert.equal(plWeek.lines[1].day, "S\u0142aby deszcz", "Polish tomorrow keeps description in Week view");

  const plTomorrow = c.weatherViewParts(reduced, "tomorrow", { lang: "pl" });
  assert.equal(plTomorrow.label, "S\u0142aby deszcz");
  assert.match(plTomorrow.text, /^Jutro/);
});

test("Week view shows all seven forecast rows without an inner scroll area", () => {
  const start = WIDGETS_CSS.indexOf('#zentral-sidebar-widgets .zw-weather[data-zw-weather-view="week"] .zw-weather-outlook {');
  assert.ok(start >= 0, "Week view has its own outlook layout rule");
  const end = WIDGETS_CSS.indexOf("}", start);
  const rule = WIDGETS_CSS.slice(start, end);
  assert.ok(rule.includes("max-height: none !important;"), "the seven rows are not height-capped");
  assert.ok(rule.includes("overflow: visible !important;"), "the outlook does not scroll internally");
});

(async () => {
  const places = JSON.stringify([
    { id: "opole", name: "Opole", latitude: 50.67, longitude: 17.92 },
  ]);
  const forecastPayload = {
    timezone: "Europe/Warsaw",
    current: { temperature_2m: 11.4, relative_humidity_2m: 68, wind_speed_10m: 9.2, weather_code: 0, time: 1795003200 },
    daily: {
      time: [
        Math.floor(Date.UTC(2026, 10, 18, 0, 0, 0) / 1000),
        Math.floor(Date.UTC(2026, 10, 19, 0, 0, 0) / 1000),
        Math.floor(Date.UTC(2026, 10, 20, 0, 0, 0) / 1000),
      ],
      weather_code: [0, 61, 71],
      temperature_2m_max: [11, 8, 1],
      temperature_2m_min: [3, 2, -3],
    },
  };

  let fetchCount = 0;
  const prefs = {
    "zen.workspace.zentral.widgets.enabled": true,
    "zen.workspace.zentral.widgets.clock.enabled": false,
    "zen.workspace.zentral.widgets.date.enabled": false,
    "zen.workspace.zentral.widgets.boost.enabled": false,
    "zen.workspace.zentral.widgets.weather.enabled": true,
    "zen.workspace.zentral.widgets.weather.places": places,
    "zen.workspace.zentral.widgets.weather.units": "metric",
    "zen.workspace.zentral.widgets.weather.refresh_minutes": 30,
    [DEFAULT_VIEW_PREF]: "week",
    [ACTIVE_VIEW_PREF]: "",
    [LANG_PREF]: "auto",
    [NOTES_LANG_PREF]: "pl",
  };

  const makeHarness = () =>
    createFakeSidebarHarness(prefs, {
      fetch() {
        fetchCount++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(forecastPayload) });
      },
    });

  // 1) Opens on configured default_view ("week") with Polish labels + compact dates + real descriptions for Today/Tomorrow.
  const h1 = makeHarness();
  const s1 = h1.start();
  await new Promise((r) => setTimeout(r, 40));

  const card1 = s1.api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "weather");
  assert.ok(card1, "weather card mounted");
  const body1 = card1.querySelector(".zw-weather");
  assert.equal(body1.getAttribute("data-zw-weather-view"), "week", "opens on saved default_view=week");

  const buttons1 = card1.querySelectorAll(".zw-weather-view-btn");
  assert.equal(buttons1.length, 3, "direct view switch has 3 buttons");
  assert.deepEqual(buttons1.map((b) => b.textContent), ["Dzi\u015b", "Jutro", "Tydzie\u0144"], "buttons use Polish labels");
  assert.equal(buttons1[2].getAttribute("aria-pressed"), "true", "Week button is active");

  const weekRows = card1.querySelectorAll(".zw-weather-outlook-week-line");
  assert.equal(weekRows.length, 3, "three forecast rows in Week view");
  assert.deepEqual(
    weekRows.map((row) => row.querySelector(".zw-weather-outlook-date")?.textContent),
    ["18.", "19.", "20."],
    "compact day-of-month labels rendered for each day",
  );
  assert.deepEqual(
    weekRows.map((row) => row.querySelector(".zw-weather-outlook-desc")?.textContent),
    ["Bezchmurnie", "S\u0142aby deszcz", "S\u0142aby \u015bnieg"],
    "Week rows show actual weather descriptions for Today and Tomorrow in Polish",
  );

  // 2) Direct view switch button changes to Tomorrow, persists to weather.view without changing default_view, and never fetches.
  const fetchesBeforeSwitch = fetchCount;
  buttons1[1].click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(body1.getAttribute("data-zw-weather-view"), "tomorrow");
  assert.equal(h1.Services.prefs.getStringPref(ACTIVE_VIEW_PREF, ""), "tomorrow", "manual view persisted to weather.view");
  assert.equal(h1.Services.prefs.getStringPref(DEFAULT_VIEW_PREF, ""), "week", "default_view remains untouched");
  assert.equal(fetchCount, fetchesBeforeSwitch, "switching view directly does not fetch");
  assert.equal(card1.querySelector(".zw-weather-label").textContent, "S\u0142aby deszcz");
  assert.equal(card1.querySelector(".zw-weather-temp").textContent, "8\u00b0C");

  // Copy persisted prefs into next session and verify persistence across restart.
  prefs[ACTIVE_VIEW_PREF] = h1.Services.prefs.getStringPref(ACTIVE_VIEW_PREF, "");
  prefs[DEFAULT_VIEW_PREF] = h1.Services.prefs.getStringPref(DEFAULT_VIEW_PREF, "");
  s1.api.destroy();

  // 3) Reopening restores persisted "tomorrow", switching language live updates labels/descriptions, and Today data is intact.
  const h2 = makeHarness();
  const s2 = h2.start();
  await new Promise((r) => setTimeout(r, 40));

  const card2 = s2.api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "weather");
  const body2 = card2.querySelector(".zw-weather");
  assert.equal(body2.getAttribute("data-zw-weather-view"), "tomorrow", "reopened widget preserves persisted user view");

  const fetchesBeforeLang = fetchCount;
  h2.Services.prefs.setStringPref(NOTES_LANG_PREF, "en");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fetchCount, fetchesBeforeLang, "language change repaints without network fetch");
  assert.deepEqual(
    card2.querySelectorAll(".zw-weather-view-btn").map((b) => b.textContent),
    ["Today", "Tomorrow", "Week"],
    "view switch labels update live to English",
  );
  assert.equal(card2.querySelector(".zw-weather-label").textContent, "Light rain", "Tomorrow description updates live to English");

  // Switch directly to Today: current weather reading (11.4°C, Clear sky, 11°C / 3°C) is unchanged.
  card2.querySelectorAll(".zw-weather-view-btn")[0].click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(body2.getAttribute("data-zw-weather-view"), "today");
  assert.equal(card2.querySelector(".zw-weather-temp").textContent, "11\u00b0C");
  assert.equal(card2.querySelector(".zw-weather-label").textContent, "Clear sky");
  assert.equal(card2.querySelector(".zw-weather-range").textContent, "11\u00b0C / 3\u00b0C");
  assert.equal(h2.Services.prefs.getStringPref(ACTIVE_VIEW_PREF, ""), "today");

  // Hold returns to configured default_view ("week") and clears manual override.
  const down = body2._listeners.filter(([type]) => type === "pointerdown");
  down[0][1]({ button: 0 });
  h2.advanceTime(700);
  assert.equal(body2.getAttribute("data-zw-weather-view"), "week", "hold returns to configured default_view");
  assert.equal(h2.Services.prefs.getStringPref(ACTIVE_VIEW_PREF, ""), "", "hold clears manual weather.view override");

  // Updating default_view in Settings while no manual override is active updates the live card immediately.
  h2.Services.prefs.setStringPref(DEFAULT_VIEW_PREF, "today");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(body2.getAttribute("data-zw-weather-view"), "today");
  assert.equal(fetchCount, fetchesBeforeLang, "default_view change repaints without fetching");

  s2.api.destroy();
  console.log(`PASS ow-109-weather-views (${passed} unit + 1 live integration tests)`);
})();
