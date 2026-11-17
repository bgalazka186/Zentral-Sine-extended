"use strict";
/* T3.9c tests: the Weather sidebar widget.
 * The pure part decides everything: the WMO vocabulary, a place that is complete, the one request URL, the reduced
 * value the cache holds, the unit labels, cache freshness and the next refresh. The live part may only be as dumb
 * as a painter, and it must not poll: no timer of its own, no request while paused or without a place. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const seam = {};
const win = { __zentralWidgetsTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(SRC, { window: win, globalThis: { Services: {} }, URL, Date, JSON, Math, Promise, RegExp, Number, String, Array, Object, Map, Set, console });
const c = seam.core;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

test("every WMO code Open-Meteo can send has one word and one icon", () => {
  const codes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  for (const code of codes) {
    const info = c.weatherCodeInfo(code);
    assert.equal(info.code, code, "code " + code + " is known");
    assert.ok(info.label && info.label !== "Unknown", "code " + code + " has a word");
    assert.ok(c.WMO_CODES[code][1], "code " + code + " has an icon");
  }
  assert.equal(c.weatherCodeInfo(7).label, "Unknown", "a code nobody knows is not guessed");
  assert.equal(c.weatherCodeInfo(7).icon, "unknown");
  assert.equal(c.weatherCodeInfo("3").label, "Overcast", "a string code is read as a number");
  assert.equal(c.weatherCodeInfo(undefined).code, -1);
});

test("a place needs both numbers, in range", () => {
  assert.equal(c.cleanWeatherPlace("", ""), null);
  assert.equal(c.cleanWeatherPlace("52.23", ""), null, "half a place makes no request");
  assert.equal(c.cleanWeatherPlace("91", "20"), null);
  assert.equal(c.cleanWeatherPlace("20", "181"), null);
  assert.equal(c.cleanWeatherPlace("0", "0"), null, "the null island is never a place somebody chose");
  assert.deepEqual(JSON.parse(JSON.stringify(c.cleanWeatherPlace("52.22977", "21.01178"))), { latitude: 52.2298, longitude: 21.0118 });
  assert.deepEqual(JSON.parse(JSON.stringify(c.cleanWeatherPlace(-33.8688, 151.2))), { latitude: -33.8688, longitude: 151.2 });
});

test("the one request carries the place, the units and nothing else", () => {
  const url = c.weatherRequestUrl({ latitude: "52.23", longitude: "21.01" }, "metric");
  assert.ok(url.startsWith(c.WEATHER_ENDPOINT + "?"), "one host, one endpoint");
  assert.match(url, /latitude=52\.23/);
  assert.match(url, /longitude=21\.01/);
  assert.match(url, /temperature_unit=celsius/);
  assert.match(url, /wind_speed_unit=kmh/);
  assert.match(url, /forecast_days=1/);
  assert.match(url, /timezone=auto/);
  const imperial = c.weatherRequestUrl({ latitude: "40.71", longitude: "-74.0" }, "imperial");
  assert.match(imperial, /temperature_unit=fahrenheit/);
  assert.match(imperial, /wind_speed_unit=mph/);
  assert.equal(c.weatherRequestUrl({ latitude: "", longitude: "" }, "metric"), "", "no place, no request");
  assert.equal(c.weatherRequestUrl(null, "metric"), "");
});

test("auto units follow the country, never the browser's language", () => {
  assert.equal(c.resolveWeatherUnits("auto", "PL"), "metric");
  assert.equal(c.resolveWeatherUnits("auto", "US"), "imperial");
  assert.equal(c.resolveWeatherUnits("auto", ""), "metric");
  assert.equal(c.resolveWeatherUnits("metric", "US"), "metric", "a person's choice wins over the country");
  assert.equal(c.resolveWeatherUnits("imperial", "PL"), "imperial");
  assert.equal(c.resolveWeatherUnits("kelvin", "PL"), "metric", "an unknown unit is not a unit");
  assert.deepEqual(JSON.parse(JSON.stringify(c.weatherUnitLabels("auto", "US"))), { temperature: "\u00b0F", wind: "mph" });
  assert.deepEqual(JSON.parse(JSON.stringify(c.weatherUnitLabels("auto", "PL"))), { temperature: "\u00b0C", wind: "km/h" });
});

test("the cached value is small, complete and drawn by parts", () => {
  const payload = {
    timezone: "Europe/Warsaw",
    current: { time: 1763392800, temperature_2m: 6.44, relative_humidity_2m: 81, weather_code: 61, wind_speed_10m: 12.6 },
    daily: { temperature_2m_max: [8.2], temperature_2m_min: [2.05] },
  };
  const value = c.readWeatherPayload(payload, "metric");
  assert.equal(value.temperature, 6.4);
  assert.equal(value.humidity, 81);
  assert.equal(value.wind, 12.6);
  assert.equal(value.label, "Light rain");
  assert.equal(value.icon, "rain");
  assert.equal(value.high, 8, "the daily range is a whole degree");
  assert.equal(value.low, 2);
  assert.equal(value.observedAt, 1763392800000, "the observation time is milliseconds of the local day key");
  const parts = c.formatWeatherParts(value, "metric");
  assert.equal(parts.temperature, "6\u00b0C");
  assert.equal(parts.range, "8\u00b0 / 2\u00b0");
  assert.equal(parts.details, "13 km/h \u00b7 81%");
  assert.equal(parts.text, "6\u00b0C, Light rain, 8\u00b0 / 2\u00b0, 13 km/h, 81%");
  assert.equal(c.readWeatherPayload(null, "metric"), null);
  assert.equal(c.readWeatherPayload({ current: {} }, "metric").temperature, null, "a missing number is drawn as a dash, not zero");
  assert.equal(c.formatWeatherParts(c.readWeatherPayload({ current: {} }, "metric"), "metric").temperature, "\u2014");
});

test("the cache is good for the refresh interval only", () => {
  const t0 = Date.UTC(2026, 10, 17, 12, 0, 0);
  const cached = { value: { temperature: 5 }, updatedAt: t0 };
  assert.equal(c.isWeatherCacheFresh(t0 + 29 * 60000, cached, 30), true);
  assert.equal(c.isWeatherCacheFresh(t0 + 31 * 60000, cached, 30), false);
  assert.equal(c.isWeatherCacheFresh(t0, null, 30), false);
  assert.equal(c.isWeatherCacheFresh(t0 + 16 * 60000, cached, 15), false, "a shorter interval makes the same value stale sooner");
  assert.equal(c.isWeatherCacheFresh(t0 + 14 * 60000, cached, 15), true);
  assert.equal(c.cleanRefreshMinutes(0), 15, "never faster than a quarter of an hour");
  assert.equal(c.cleanRefreshMinutes(9999), 180);
  assert.equal(c.cleanRefreshMinutes("45"), 45);
  assert.equal(c.cleanRefreshMinutes(undefined), 30);
  // The scheduler treats the value it just wrote as "now", so the wait is the whole interval from that write.
  const written = t0 + 10 * 60000;
  assert.equal(c.nextWeatherDelayMs(written, 30, written), 30 * 60000, "a fresh write waits the whole interval");
  assert.equal(c.nextWeatherDelayMs(written + 5 * 60000, 30, written), 25 * 60000, "an older write only waits for its rest");
  assert.equal(c.nextWeatherDelayMs(t0, 30, 0), 60000, "after an error the next try waits a minute, not a second");
  assert.equal(c.nextWeatherDelayMs(t0, 30, t0 - 10 * 3600000), 60000, "a value from a previous run is refreshed at once, not at once per second");
});

test("a place name is geocoded once, by the dialog, and never guessed", () => {
  const hit = c.readGeocodePayload({ results: [{ name: "Warsaw", admin1: "Masovia", country: "Poland", country_code: "PL", latitude: 52.22977, longitude: 21.01178 }] });
  assert.equal(hit.name, "Warsaw, Masovia, Poland");
  assert.equal(hit.countryCode, "PL");
  assert.equal(hit.latitude, 52.2298);
  assert.equal(c.readGeocodePayload({ results: [] }), null);
  assert.equal(c.readGeocodePayload(null), null);
  assert.equal(c.geocodeUrl("  "), "", "an empty query asks nobody");
  assert.match(c.geocodeUrl("Warsaw"), /name=Warsaw/);
  assert.match(c.geocodeUrl("Zürich"), /name=Z%C3%BCrich/);
  assert.ok(!c.geocodeUrl("x".repeat(200)).includes("x".repeat(81)), "a runaway query is cut");
});

test("the widget only paints and never polls by itself", () => {
  const widget = SRC.slice(SRC.indexOf('id: "weather"'), SRC.indexOf("const onVisibilityOrResize"));
  assert.ok(widget.length > 200, "the weather widget exists");
  assert.ok(!/setInterval/.test(widget), "no interval of its own: the shared scheduler owns the timer");
  assert.ok(!/XMLHttpRequest/.test(widget), "one way to the network, fetch()");
  assert.match(widget, /fetch\(/, "the widget fetches through the scheduler");
  assert.ok(/refreshPref: WIDGET_PREFS\.WEATHER_REFRESH_MINUTES/.test(SRC), "the refresh interval is a setting");
  assert.ok(/minRefreshMs: WEATHER_REFRESH_MIN \* 60000/.test(SRC), "and it has a floor");
  assert.match(widget, /if \(!opts\.place_\) return null;/, "no place, no request");
  assert.ok(/isWeatherCacheFresh/.test(widget), "the cached value is used while it is fresh");
  assert.ok(/formatWeatherParts/.test(widget), "the card is painted from the shared parts");
});
test("the widget is off until a place is chosen, and asks nobody when off", () => {
  assert.ok(/WEATHER_ENABLED: false/.test(SRC), "weather ships off");
  assert.ok(/WEATHER_PLACE: ""/.test(SRC));
  const cfg = SRC.slice(SRC.indexOf("function readWeatherOpts"), SRC.indexOf("registerWidget({", SRC.indexOf("function readWeatherOpts")));
  assert.ok(cfg.length > 100, "the widget reads its own settings");
  assert.ok(!/fetch\(/.test(cfg), "reading the settings never touches the network");
});

console.log("\nPASS widgets-weather (" + passed + " tests)");
