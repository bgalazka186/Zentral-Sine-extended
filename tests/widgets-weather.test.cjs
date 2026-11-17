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
const SETTINGS = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/settings.json"), "utf8"));
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
  assert.match(url, /forecast_days=7/, "a week, so tomorrow and the next wet day can be named");
  assert.match(url, /precipitation_probability_max/, "the wet-day rule needs a probability");
  assert.match(url, /precipitation_hours/);
  assert.match(url, /snowfall_sum/, "snow is not rain; it needs its own number");
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

/* OW-50: the card only knew today. It now asks for a week and names tomorrow and the next wet day. The wet-day rule
 * is deliberately conservative: a wet-looking code with no hours and no chance is not "rain", and a dry code with a
 * high probability is not either. */
const day = (over) => ({ code: 1, icon: "sun", label: "Mainly clear", high: 9, low: 2, precipitationProbability: 5, precipitationHours: 0, snowfall: 0, date: "2026-11-17", ...over });
const rain = (over) => day({ code: 61, icon: "rain", label: "Light rain", precipitationHours: 4, precipitationProbability: 80, ...over });

test("a day counts as wet only when its code and its numbers agree", () => {
  assert.equal(c.isWetDay(rain()), true);
  assert.equal(c.isWetDay(day({ code: 71, icon: "snow", snowfall: 2, precipitationHours: 0, precipitationProbability: 0 })), true, "snow is wet");
  assert.equal(c.isWetDay(day({ code: 61, icon: "rain", precipitationHours: 0, precipitationProbability: 0 })), false, "a rain code with nothing behind it is noise");
  assert.equal(c.isWetDay(day({ code: 1, icon: "sun", precipitationProbability: 90, precipitationHours: 0 })), false, "a dry code is not rain however likely");
  assert.equal(c.isWetDay(day({ code: 61, precipitationHours: 0, precipitationProbability: 45 })), true, "a real chance alone counts");
  assert.equal(c.isWetDay(null), false);
});

test("the next wet day is the first one after today, and a dry week says so", () => {
  const week = [day(), day(), day(), rain({ date: "2026-11-20" }), rain({ date: "2026-11-21" })];
  const wet = c.nextWetDay(week, 1);
  assert.equal(wet.daysAhead, 3);
  assert.equal(wet.date, "2026-11-20");
  assert.equal(wet.label, "Light rain");
  assert.equal(c.nextWetDay([day(), day(), day()], 1), null, "no wet day in the window");
  assert.equal(c.nextWetDay([rain()], 1), null, "today is not 'next'");
  assert.equal(c.nextWetDay(null, 1), null);
  assert.equal(c.nextWetDay([day(), rain()], 1).daysAhead, 1, "tomorrow is a valid answer");
});

test("the outlook line names tomorrow and the next rain, and never repeats itself", () => {
  const wide = c.weatherOutlookParts([day({ high: 8, low: 1 }), day({ high: 11, low: 3 }), rain()], { units: "metric" });
  assert.equal(wide.tomorrow, "Tomorrow 11\u00b0C / 3\u00b0C");
  assert.equal(wide.wet, "Rain in 2 days");
  assert.equal(wide.faces.length, 2, "both halves are available for a narrow card");
  // Rain tomorrow is said once, on the rain line.
  const tomorrowWet = c.weatherOutlookParts([day(), rain({ high: 7, low: 1 })], { units: "metric" });
  assert.equal(tomorrowWet.wet, "Rain tomorrow");
  assert.ok(!tomorrowWet.tomorrow.includes("Rain"), "the word appears on one line only");
  // A dry week still answers the question.
  const dry = c.weatherOutlookParts([day(), day(), day()], { units: "metric" });
  assert.equal(dry.wet, "No rain this week");
  // No week at all is simply no second line, never a crash.
  const empty = c.weatherOutlookParts(null);
  assert.equal(empty.text, "");
  assert.deepEqual(JSON.parse(JSON.stringify(empty.faces)), []);
  assert.equal(empty.wetDay, null);
});

test("a week of days survives the payload reduction, and the raw payload never does", () => {
  const payload = {
    current: { temperature_2m: 6.4, relative_humidity_2m: 81, weather_code: 3, wind_speed_10m: 12.1, time: 1_700_000_000 },
    daily: {
      time: [1_700_000_000, 1_700_086_400, 1_700_172_800],
      weather_code: [3, 61, 1],
      temperature_2m_max: [9.1, 7.4, 8.9],
      temperature_2m_min: [2.2, 1.1, 0.4],
      precipitation_probability_max: [10, 85, 5],
      precipitation_hours: [0, 5.5, 0],
      snowfall_sum: [0, 0, 0],
    },
    countryCode: "PL",
  };
  const value = c.readWeatherPayload(payload, "metric");
  assert.equal(value.week.length, 3, "one small entry per day");
  assert.equal(value.week[1].code, 61);
  assert.equal(value.week[1].high, 7);
  assert.equal(value.week[1].precipitationProbability, 85);
  assert.equal(value.week[1].precipitationHours, 5.5);
  assert.equal(value.week[2].low, 0);
  assert.equal(value.week[0].snowfall, 0);
  assert.equal(c.nextWetDay(value.week, 1).daysAhead, 1, "the reduced week still answers the question");
  // A payload without the new fields degrades to a usable single day, never a crash.
  const bare = c.readWeatherPayload({ current: payload.current, daily: { weather_code: [3], temperature_2m_max: [9], temperature_2m_min: [2] } }, "metric");
  assert.equal(bare.week.length, 1);
  assert.equal(bare.week[0].precipitationProbability, null);
  assert.equal(c.nextWetDay(bare.week, 1), null);
});

test("OW-54: every half of the outlook is drawn, and a narrow card wraps instead of hiding one", () => {
  const card = SRC.slice(SRC.indexOf('id: "weather"'), SRC.indexOf('id: "weather"') + 9000);
  assert.match(card, /zw-weather-outlook/, "the second line has its own element");
  assert.match(card, /weatherOutlookParts\(/, "and is filled from the pure rule");
  // One row per half, always both.
  assert.match(card, /zw-weather-outlook-line/, "each half gets its own row");
  assert.ok(!/outlookFace\b/.test(card), "there is no swapped face any more: nothing is hidden behind a click");
  assert.ok(!/Click to see the other day/.test(card), "and no click is offered for it");
  // The attribute is only ever *removed* now: an older render may have set it, and clearing it is the whole point.
  assert.ok(!/setAttribute\("data-zw-outlook-face"/.test(card), "the swap attribute is never set any more");
  assert.match(card, /removeAttribute\("data-zw-outlook-face"\)/, "and is cleared if an older render left it");
  // The pure rule hands the renderer its lines, and keeps the old pair for anyone still asking for it.
  const parts = c.weatherOutlookParts([day({ high: 8, low: 1 }), day({ high: 11, low: 3 }), rain()], { units: "metric" });
  assert.deepEqual(JSON.parse(JSON.stringify(parts.lines)), [parts.tomorrow, parts.wet]);
  assert.equal(parts.lines.length, 2, "both halves are lines of their own");
});

test("OW-54: the outlook is styled to wrap, never to be cut", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../additional/widgets/ZentralWidgets.css"), "utf8");
  const rule = css.slice(css.indexOf(".zw-weather-outlook {"), css.indexOf(".zw-weather-outlook {") + 420);
  assert.match(rule, /white-space:\s*normal/, "the line may wrap");
  assert.match(rule, /text-overflow:\s*clip/, "and is never shortened with an ellipsis");
  assert.ok(!/white-space:\s*nowrap/.test(rule), "nowrap is what cut the answer");
  assert.ok(!/ellipsis/.test(rule), "so is the ellipsis");
  assert.match(css, /\.zw-weather-outlook \.zw-weather-outlook-line \{[^}]*display:\s*block/, "each half is a block of its own");
  // The click-to-swap styling went with the swap.
  assert.ok(!/zw-weather-outlook\[data-zw-outlook-face\]/.test(css), "no dotted underline for a click that no longer exists");
});

/* OW-51: typing a name used to look like a failure, because the name is only a label and the numbers did the work.
 * The settings now say so, and the two coordinates are described as what they are: the real input. */
test("the place setting says a typed name is a label, and the coordinates are the real input", () => {
  const schema = SETTINGS.schema;
  const row = (suffix) => schema.find((item) => String(item.property).endsWith(suffix));
  const place = row("weather.place");
  const lat = row("weather.latitude");
  const lon = row("weather.longitude");
  assert.ok(/only a label/i.test(place.label + " " + (place.description || "")), "the label says what a name is for");
  assert.ok(/latitude and longitude/i.test(place.description || ""), "and points at what is actually used");
  for (const item of [lat, lon]) {
    assert.match(item.label, /filled by the name lookup/i, "the coordinates explain where their value comes from");
    assert.match(item.label, /edit to override/i, "and that they can be typed by hand");
  }
});

console.log("\nPASS widgets-weather (" + passed + " tests)");
