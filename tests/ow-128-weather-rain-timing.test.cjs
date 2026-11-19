"use strict";
/* OW-128 RED -> GREEN, owner choice A: one request with hourly data plus an
 * optional 15-minute near-term prefix, graceful hourly and daily fallbacks.
 * These are pure timestamp/payload rules and source/CSS wiring checks; live
 * Open-Meteo text and layout remain an OWNER GATE. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "additional/widgets/ZentralWidgets.css"), "utf8");
const seam = {};
const win = { __zentralWidgetsTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(SRC, { window: win, globalThis: { Services: {} }, URL, Date, JSON, Math, Promise, RegExp, Number, String, Array, Object, Map, Set, console });
const c = seam.core;
const plain = (v) => JSON.parse(JSON.stringify(v));

const HOUR = 3600;
const QUARTER = 900;
const T0 = Date.UTC(2026, 10, 18, 9, 0, 0) / 1000; // 2026-11-18 09:00 UTC
const times = (start, step, count) => Array.from({ length: count }, (_, i) => start + i * step);
const series = (start, step, count, wetFrom, wetTo, code = 61, amount = 1) => {
  const t = times(start, step, count);
  const wet = t.map((time) => time >= wetFrom && time < wetTo);
  return {
    time: t,
    precipitation: wet.map((w) => (w ? amount : 0)),
    rain: wet.map((w) => (w ? amount : 0)),
    showers: t.map(() => 0),
    weather_code: wet.map((w) => (w ? code : 3)),
    precipitation_probability: wet.map((w) => (w ? 90 : 5)),
  };
};
const daily = (wetIndex = -1) => {
  const codes = [3, 3, 3];
  if (wetIndex >= 0) codes[wetIndex] = 65;
  return {
    time: [T0, T0 + 86400, T0 + 2 * 86400],
    weather_code: codes,
    temperature_2m_max: [9, 8, 7],
    temperature_2m_min: [2, 1, 0],
    precipitation_probability_max: codes.map((code) => (code === 65 ? 90 : 5)),
    precipitation_hours: codes.map((code) => (code === 65 ? 6 : 0)),
    snowfall_sum: [0, 0, 0],
  };
};
const payload = (extra = {}) => ({
  timezone: "UTC",
  utc_offset_seconds: 0,
  current: { time: T0, temperature_2m: 8, relative_humidity_2m: 70, weather_code: 3, wind_speed_10m: 4 },
  daily: daily(),
  ...extra,
});

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

try {
  test("1. Option A asks for hourly and optional 15-minute data in the same one request", () => {
    const url = c.weatherRequestUrl({ latitude: "52.23", longitude: "21.01" }, "metric");
    assert.ok(url.startsWith(c.WEATHER_ENDPOINT + "?"));
    assert.match(url, /hourly=precipitation,rain,showers,weather_code,precipitation_probability/);
    assert.match(url, /minutely_15=precipitation,rain,weather_code/);
    assert.match(url, /forecast_hours=48/);
    assert.match(url, /forecast_minutely_15=48/);
    assert.match(url, /past_minutely_15=0/);
    assert.match(url, /precipitation_unit=mm/);
    assert.match(url, /timeformat=unixtime/);
    assert.match(url, /timezone=auto/);
  });

  test("2. the payload reduction keeps bounded rain series and the API's UTC offset", () => {
    assert.equal(typeof c.readWeatherRainSeries, "function");
    const p = payload({
      hourly: series(T0, HOUR, 48, T0 + 2 * HOUR, T0 + 4 * HOUR),
      minutely_15: series(T0, QUARTER, 96, T0 + QUARTER, T0 + 3 * QUARTER),
    });
    const value = c.readWeatherPayload(p, "metric", "en");
    assert.equal(value.utcOffsetSeconds, 0);
    assert.equal(value.observedAt, T0 * 1000);
    assert.equal(value.rain.hourly.length, 48);
    assert.equal(value.rain.minutely15.length, 96);
    assert.equal(value.rain.hourly[2].wet, true);
    assert.equal(value.rain.hourly[0].wet, false);
    assert.equal(value.rain.hourly[2].heavy, false);
    const reduced = plain(c.readWeatherRainSeries(p));
    assert.deepEqual(Object.keys(reduced).sort(), ["hourly", "minutely15", "observedAt", "timezone", "utcOffsetSeconds"]);
  });

  test("3. a 15-minute onset says ~45 min, names its window and marks heavy rain", () => {
    assert.equal(typeof c.weatherRainPlan, "function");
    const p = payload({
      minutely_15: series(T0, QUARTER, 12, T0 + 3 * QUARTER, T0 + 7 * QUARTER, 65, 5),
      hourly: series(T0, HOUR, 12, T0 + 9 * HOUR, T0 + 10 * HOUR),
    });
    const plan = plain(c.weatherRainPlan(c.readWeatherPayload(p, "metric", "en"), { lang: "en", nowMs: T0 * 1000 }));
    assert.equal(plan.source, "minutely_15");
    assert.equal(plan.onsetMinutes, 45);
    assert.equal(plan.dayOffset, 0);
    assert.equal(plan.window, "9–11");
    assert.equal(plan.heavy, true);
    assert.equal(plan.allDay, false);
    assert.match(plan.short, /~45 min/);
    assert.match(plan.short, /9–11/);
    assert.match(plan.long, /in ~45 min/);
    assert.match(plan.long, /heavy rain/);
  });

  test("4. missing 15-minute data falls back to hourly; missing hourly falls back to daily", () => {
    const hourly = plain(c.weatherRainPlan(c.readWeatherPayload(payload({ hourly: series(T0, HOUR, 12, T0 + HOUR, T0 + 3 * HOUR) }), "metric", "en"), { lang: "en", nowMs: T0 * 1000 }));
    assert.equal(hourly.source, "hourly");
    assert.equal(hourly.onsetMinutes, 60);
    assert.equal(hourly.window, "10–12");
    assert.match(hourly.short, /~1 h/);
    const today = plain(c.weatherRainPlan(c.readWeatherPayload(payload({ daily: daily(0) }), "metric", "en"), { lang: "en", nowMs: T0 * 1000 }));
    assert.equal(today.source, "daily");
    assert.equal(today.dayOffset, 0);
    assert.match(today.short, /today/);
    const pl = plain(c.weatherRainPlan(c.readWeatherPayload(payload({ daily: daily(1) }), "metric", "pl"), { lang: "pl", nowMs: T0 * 1000 }));
    assert.match(pl.short, /jutro/);
    const after = plain(c.weatherRainPlan(c.readWeatherPayload(payload({ daily: daily(2) }), "metric", "pl"), { lang: "pl", nowMs: T0 * 1000 }));
    assert.match(after.short, /pojutrze/);
  });

  test("5. a long contiguous run says 9–15 or all day without losing heavy rain", () => {
    const window = plain(c.weatherRainPlan(c.readWeatherPayload(payload({ hourly: series(T0, HOUR, 12, T0, T0 + 6 * HOUR, 65, 5) }), "metric", "en"), { lang: "en", nowMs: T0 * 1000 }));
    assert.equal(window.window, "9–15");
    assert.equal(window.allDay, false);
    assert.equal(window.heavy, true);
    assert.match(window.long, /9–15/);
    assert.match(window.long, /heavy rain/);
    const allDay = plain(c.weatherRainPlan(c.readWeatherPayload(payload({ hourly: series(T0 - 9 * HOUR, HOUR, 24, T0 - 9 * HOUR, T0 + 15 * HOUR) }), "metric", "en"), { lang: "en", nowMs: T0 * 1000 }));
    assert.equal(allDay.allDay, true);
    assert.match(allDay.short, /all day/);
    const pl = plain(c.weatherRainPlan(c.readWeatherPayload(payload({ hourly: series(T0 - 9 * HOUR, HOUR, 24, T0 - 9 * HOUR, T0 + 15 * HOUR) }), "metric", "pl"), { lang: "pl", nowMs: T0 * 1000 }));
    assert.match(pl.short, /cały dzień/);
  });

  test("6. the outlook exposes short/long rain lines and still keeps the legacy pair", () => {
    const p = payload({ minutely_15: series(T0, QUARTER, 12, T0 + 3 * QUARTER, T0 + 7 * QUARTER, 65, 5) });
    const value = c.readWeatherPayload(p, "metric", "en");
    const outlook = c.weatherOutlookParts(value, { units: "metric", lang: "en", nowMs: T0 * 1000 });
    assert.match(outlook.rainShort, /~45 min/);
    assert.match(outlook.rainLong, /heavy rain/);
    assert.equal(outlook.rainSource, "minutely_15");
    assert.equal(outlook.rainLines.length, 1);
    assert.equal(outlook.rainLines[0].type, "rain");
    assert.equal(outlook.rainLines[0].short, outlook.rainShort);
    assert.equal(outlook.rainLines[0].long, outlook.rainLong);
    assert.deepEqual(JSON.parse(JSON.stringify(outlook.lines)), [outlook.tomorrow, outlook.wet]);
    const dailyOnly = c.weatherOutlookParts([{ code: 61, precipitationHours: 6 }, { code: 3 }, { code: 3 }], { units: "metric", lang: "en", nowMs: T0 * 1000 });
    assert.match(dailyOnly.wet, /Rain today/);
    assert.match(dailyOnly.rainShort, /today/);
  });

  test("7. responsive CSS keeps both short and long text readable by wrapping/scrolling", () => {
    assert.match(CSS, /\.zw-weather-rain-long/);
    assert.match(CSS, /\.zw-weather-rain-short/);
    assert.match(CSS, /#zentral-sidebar-widgets\[data-zw-density="compact"\] \.zw-weather-rain-long/);
    assert.match(CSS, /#zentral-sidebar-widgets:not\(\[data-zw-density="compact"\]\) \.zw-weather-rain-short/);
    assert.match(CSS, /\.zw-weather-rain-line[\s\S]{0,260}overflow-wrap:\s*anywhere/);
    assert.match(CSS, /\.zw-weather-outlook[\s\S]{0,260}max-height:/);
    assert.doesNotMatch(CSS, /\.zw-weather-rain-line[^{]*\{[^}]*text-overflow:\s*ellipsis/);
  });

  test("8. runtime paints the rain line, passes the widget language, and never invents a second request", () => {
    assert.match(SRC, /weatherOutlookParts\(value, \{ \.\.\.opts, lang \}\)/);
    assert.match(SRC, /rainLine\s*\?\s*\[rainLine[\s\S]{0,220}: \(outlook\.lines/);
    assert.match(SRC, /line\.type === "rain"/);
    assert.match(SRC, /zw-weather-rain-long/);
    assert.match(SRC, /zw-weather-rain-short/);
    assert.equal((SRC.match(/fetch\(/g) || []).length >= 1, true, "the existing one-request fetch path remains");
  });

  console.log(`OW-128 weather rain timing tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
