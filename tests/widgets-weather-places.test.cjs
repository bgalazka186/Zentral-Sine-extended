"use strict";
/* OW-57: two or three weather places, cycled by a click.
 * One JSON preference holds the list; the old single place (name + latitude + longitude) is migrated as entry one, so
 * a saved place is never lost. The cache key includes the place, or the place just switched to would show the numbers
 * of the place before it. The card owns the click, because OW-54 left it free. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const CSS = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.css"), "utf8");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/settings.json"), "utf8"));
const LAYOUT = JSON.parse(fs.readFileSync(path.join(root, "extension/settings/layout.json"), "utf8"));
// The harness is shared with widgets-shell, so this cannot drift from how the host actually mounts a card.
const { createFakeSidebarHarness } = require("./helpers/fake-widgets-harness.cjs");
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
  console,
});
const c = seam.core;
// vm objects are cross-realm: bring them back as plain JSON before any deepEqual.
const plain = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

const home = { id: "home", name: "Home", latitude: 50.67, longitude: 17.92 };
const work = { id: "work", name: "Work", latitude: 52.23, longitude: 21.0 };
const cabin = { id: "cabin", name: "Cabin", latitude: 49.3, longitude: 19.95 };
const fourth = { id: "fourth", name: "Fourth", latitude: 48.2, longitude: 16.37 };

test("as many places as a person saves, in the order they were saved", () => {
  // OW-95: the cap went from three to the list's own sanity ceiling, so four places are four places now.
  const list = c.cleanWeatherPlaces([home, work, cabin, fourth]);
  assert.deepEqual(plain(list.map((p) => p.id)), ["home", "work", "cabin", "fourth"]);
  assert.ok(c.WEATHER_PLACES_MAX >= 24, "the ceiling is far above any real list");
  assert.deepEqual(plain(c.cleanWeatherPlaces([home, work]).map((p) => p.name)), plain(["Home", "Work"]));
});

test("the ceiling still exists, so a hand-edited pref cannot make an endless list", () => {
  const many = Array.from({ length: c.WEATHER_PLACES_MAX + 12 }, (_, i) => ({
    id: "p" + i, name: "P" + i, latitude: 40 + i / 100, longitude: 10 + i / 100,
  }));
  assert.equal(c.cleanWeatherPlaces(many).length, c.WEATHER_PLACES_MAX);
});

test("a place needs real numbers: junk positions are dropped, not half-kept", () => {
  const list = c.cleanWeatherPlaces([
    { id: "a", name: "A", latitude: "50.6", longitude: "17.9" },
    { id: "b", name: "No longitude", latitude: 50.6 },
    { id: "c", name: "Out of range", latitude: 91, longitude: 10 },
    { id: "d", name: "Null island", latitude: 0, longitude: 0 },
    { id: "e", name: "Text", latitude: "north", longitude: "east" },
    { id: "f", name: "F", latitude: -33.87, longitude: 151.21 },
  ]);
  // The named-but-numberless entries survive as "being looked up"; none of the bad numbers ever becomes a place.
  assert.deepEqual(plain(list.map((p) => p.id)), ["a", "b", "c", "d", "e", "f"],
    "each entry keeps its own slot; only its numbers decide whether it can be fetched");
  assert.deepEqual(plain(list.filter((p) => c.weatherPlaceReady(p)).map((p) => p.id)), ["a", "f"],
    "only the entries with real coordinates are fetched");
  assert.deepEqual(plain(c.cleanWeatherPlaces([{ id: "x" }, { id: "y", name: "  " }])), [], "nothing to show and nothing to look up is not a place");
  assert.equal(c.cleanWeatherPlaces("not json").length, 0);
  assert.equal(c.cleanWeatherPlaces("").length, 0);
  assert.equal(c.cleanWeatherPlaces(null).length, 0);
});

test("an entry without a name or an id still becomes a usable place", () => {
  const [one] = c.cleanWeatherPlaces([{ latitude: 50.67, longitude: 17.92 }]);
  assert.equal(one.id, "place-1", "an id is made, so the cache can tell places apart");
  assert.match(one.name, /50\.67/, "the coordinates stand in for a missing name");
  const [two] = c.cleanWeatherPlaces([{ latitude: 50.67, longitude: 17.92, name: "  Home   town " }]);
  assert.equal(two.name, "Home town", "whitespace is folded");
});

test("a typed name with no numbers is kept, and skipped until the lookup fills it", () => {
  const list = c.cleanWeatherPlaces([
    { id: "opole", name: "Opole" },
    { id: "work", name: "Work", latitude: 52.23, longitude: 21.0 },
  ]);
  assert.equal(list.length, 2, "the typed entry is not thrown away while it is being looked up");
  assert.equal(list[0].latitude, null);
  assert.equal(c.weatherPlaceReady(list[0]), false);
  assert.equal(c.currentWeatherPlace(list, "").id, "work", "the card shows a place it can actually fetch");
  assert.equal(c.nextWeatherPlace(list, "work").id, "work", "the unready entry is not a stop on the cycle");
  assert.equal(c.weatherCacheKeyFor("weather", c.currentWeatherPlace(list, "")), "weather:52.23,21");
});

test("ids stay unique when a list repeats one", () => {
  const list = c.cleanWeatherPlaces([
    { id: "home", name: "Home", latitude: 50.67, longitude: 17.92 },
    { id: "home", name: "Home again", latitude: 52.23, longitude: 21.0 },
  ]);
  assert.equal(new Set(list.map((p) => p.id)).size, 2, "two places never share a cache key");
});

/* ---------------- OW-95: the three views ---------------- */

const WEEK = [
  { icon: "sun", label: "Clear", high: 21, low: 11 },
  { icon: "rain", label: "Rain", high: 18, low: 9 },
  { icon: "cloud", label: "Cloudy", high: 16, low: 8 },
  { icon: "snow", label: "Snow", high: 2, low: -3 },
];
const VALUE = { icon: "sun", label: "Clear", high: 21, low: 11, temperature: 20, week: WEEK };

test("the views are a fixed cycle, and junk is today", () => {
  assert.deepEqual(plain(c.WEATHER_VIEWS), ["today", "tomorrow", "week"]);
  assert.equal(c.cleanWeatherView("tomorrow"), "tomorrow");
  assert.equal(c.cleanWeatherView("nope"), "today", "an unknown view is the main face, never a blank card");
  assert.equal(c.cleanWeatherView(undefined), "today");
  assert.equal(c.nextWeatherView("today"), "tomorrow");
  assert.equal(c.nextWeatherView("tomorrow"), "week");
  assert.equal(c.nextWeatherView("week"), "today", "and it wraps");
  assert.equal(c.nextWeatherView("junk"), "tomorrow", "junk starts from today, so the click goes to tomorrow");
});

test("today is the reading the card is named for", () => {
  const parts = c.weatherViewParts(VALUE, "today", { units: "metric" });
  assert.equal(parts.view, "today");
  assert.equal(parts.icon, "sun");
  assert.equal(parts.temperature, "20\u00b0C");
  assert.equal(parts.range, "21\u00b0C / 11\u00b0C");
  assert.equal(parts.empty, undefined);
});

test("tomorrow reads the second day, and says so when the reading stops at today", () => {
  const parts = c.weatherViewParts(VALUE, "tomorrow", { units: "metric" });
  assert.equal(parts.icon, "rain");
  assert.equal(parts.temperature, "18\u00b0C");
  assert.equal(parts.range, "18\u00b0C / 9\u00b0C");
  assert.match(parts.text, /Tomorrow/);
  // A one-day payload (an old cache, a damaged response) must not invent a forecast.
  const thin = c.weatherViewParts({ ...VALUE, week: [WEEK[0]] }, "tomorrow", { units: "metric" });
  assert.equal(thin.empty, true);
  assert.ok(thin.text, "and it explains itself instead of showing nothing");
});

test("the week is one row per day, in order, with a readable label", () => {
  const parts = c.weatherViewParts(VALUE, "week", { units: "metric" });
  assert.equal(parts.lines.length, 4, "every day the reading has");
  assert.deepEqual(plain(parts.lines.map((l) => l.icon)), ["sun", "rain", "cloud", "snow"]);
  assert.equal(parts.lines[0].day, "Today", "the first row is named for what it is");
  assert.equal(parts.lines[1].day, "Tomorrow");
  assert.equal(parts.lines[2].day, "Cloudy", "then the day's own weather word, so seven rows can be told apart");
  assert.equal(parts.lines[2].label, "Cloudy", "and the weather word is still there for the tooltip");
  assert.equal(parts.lines[2].high, "16\u00b0C");
  assert.equal(parts.lines[2].low, "8\u00b0C");
  assert.equal(parts.empty, false);
  const empty = c.weatherViewParts({ week: [] }, "week", { units: "metric" });
  assert.equal(empty.empty, true, "no week, no rows — not an empty list that looks like a bug");
});

test("every view labels the numbers with the units those numbers are actually in", () => {
  // Open-Meteo converts server-side, so only the reading knows whether 21 means °C or °F. A view that trusted the
  // current preference would relabel a cached reading — the one bug this rule exists to make impossible.
  const imperial = { ...VALUE, units: "imperial", countryCode: "US" };
  assert.equal(c.weatherViewParts(imperial, "week", { units: "metric" }).lines[0].high, "21\u00b0F",
    "the reading wins, even when the pref says metric");
  assert.equal(c.weatherViewParts(imperial, "tomorrow", { units: "metric" }).temperature, "18\u00b0F");
  const metric = { ...VALUE, units: "metric", countryCode: "PL" };
  assert.equal(c.weatherViewParts(metric, "week", { units: "imperial" }).lines[0].high, "21\u00b0C",
    "and a metric reading stays metric when the pref flips");
});

test("a reading with no numbers never prints NaN or undefined", () => {
  const bare = c.weatherViewParts({ week: [{ icon: "sun", label: "Clear" }] }, "week", { units: "metric" });
  assert.equal(bare.lines.length, 1);
  assert.equal(bare.lines[0].high, "", "a missing high is an empty part, never the word undefined");
  assert.equal(bare.lines[0].low, "");
  assert.ok(!/undefined|NaN/.test(bare.text));
});

test("a click cycles and wraps; one place is a no-op", () => {
  const three = [home, work, cabin];
  assert.equal(c.nextWeatherPlace(three, "home").id, "work");
  assert.equal(c.nextWeatherPlace(three, "work").id, "cabin");
  assert.equal(c.nextWeatherPlace(three, "cabin").id, "home", "it wraps");
  assert.equal(c.nextWeatherPlace(three, "gone").id, "home", "an unknown id starts at the first place");
  assert.equal(c.nextWeatherPlace(three, "").id, "home");
  assert.equal(c.nextWeatherPlace([home], "home").id, "home", "one place has nowhere to go");
  assert.equal(c.nextWeatherPlace([], "home"), null, "no places is null, never a crash");
  assert.equal(c.currentWeatherPlace([], "home"), null);
  assert.equal(c.currentWeatherPlace(three, "work").id, "work", "the showing place is the chosen one");
  assert.equal(c.currentWeatherPlace(three, "gone").id, "home", "a stale choice falls back to the first");
});

test("the old single place is migrated as entry one", () => {
  const list = c.weatherPlacesFromLegacy("Opole", "50.67", "17.92");
  assert.equal(list.length, 1);
  assert.deepEqual(plain({ name: list[0].name, latitude: list[0].latitude, longitude: list[0].longitude }), { name: "Opole", latitude: 50.67, longitude: 17.92 });
  assert.equal(list[0].id, "place-1", "and it gets the first id");
  assert.equal(c.weatherPlacesFromLegacy("Opole", "", "").length, 0, "a name without numbers is not a place yet");
  assert.equal(c.weatherPlacesFromLegacy("", "50.67", "17.92").length, 1, "numbers without a name are");
});

test("stored JSON round-trips through the cleaner", () => {
  const saved = c.serializeWeatherPlaces([home, work, cabin]);
  assert.equal(typeof saved, "string");
  const back = c.cleanWeatherPlaces(saved);
  assert.deepEqual(back, c.cleanWeatherPlaces([home, work, cabin]));
  assert.deepEqual(c.cleanWeatherPlaces({ places: [home] }).length, 1, "an object with a places list is accepted too");
});

test("the cache key changes with the place, so the old numbers cannot linger", () => {
  assert.equal(c.weatherCacheKeyFor("weather", home), "weather:50.67,17.92");
  assert.notEqual(c.weatherCacheKeyFor("weather", home), c.weatherCacheKeyFor("weather", work));
  assert.equal(c.weatherCacheKeyFor("weather", null), "weather", "no place keeps the plain id");
  assert.equal(c.weatherCacheKeyFor("weather", { latitude: 0, longitude: 0 }), "weather", "null island is no place");
});

test("the scheduler asks the widget for its key before every lookup", () => {
  assert.ok(/if \(typeof def\.cacheKey === "function"\)/.test(SRC), "a function key is supported");
  assert.ok(/return def\.cacheKey \|\| def\.id;/.test(SRC), "a plain key still is");
  // Both the widget definition and the card instance answer with the same per-place key.
  assert.equal((SRC.match(/weatherCacheKeyFor\("weather", opts\.place_\)/g) || []).length, 2);
});

test("the card, not the outlook, owns the click", () => {
  assert.ok(/outlookEl\.addEventListener\("click", \(e\) => e\.stopPropagation\(\)\)/.test(SRC), "the outlook only stops the bubble");
  assert.ok(/wrap\.addEventListener\("click", \(event\) => \{/.test(SRC), "the card takes the click");
  // OW-95: the click is the VIEW axis now; the place has its own gestures (Ctrl/middle click) and a hold resets both.
  assert.ok(/const cycleView = \(\) => setView\(nextWeatherView\(weatherView\.view\)\);/.test(SRC), "a click walks the three views");
  assert.ok(/else cycleView\(\);/.test(SRC), "and the plain click is the view, not the place");
  assert.ok(/if \(event\?\.ctrlKey \|\| event\?\.metaKey\) cyclePlace\(\);/.test(SRC), "the place keeps a modified click");
  assert.ok(/const revertToMain = \(\) => \{/.test(SRC), "a hold returns to the main face");
  assert.ok(/revertToMain\(\);/.test(SRC), "and it is wired");
  assert.ok(/const HOLD_MS = \d+;/.test(SRC), "the hold has a real duration, not a click variant");
  assert.ok(/const cyclePlace = \(\) => \{/.test(SRC));
  assert.ok(/readWeatherPlaces\(\)\.filter\(weatherPlaceReady\)/.test(SRC), "only places that can be fetched are cycled");
  assert.ok(/if \(places\.length < 2\) return false;/.test(SRC), "one place is a label, not a button");
  assert.ok(/requestRefresh\(\{ force: true \}\)/.test(SRC), "a new place is fetched at once, not at the next interval");
  assert.ok(/wrap\.addEventListener\("keydown"/.test(SRC), "and the same click works from the keyboard");
  assert.ok(/wrap\.setAttribute\("data-zw-places", String\(readyPlaces\.length\)\)/.test(SRC), "the count exposed to CSS is the ready ones");
});

test("the place names a control in the stylesheet", () => {
  const rule = CSS.slice(CSS.indexOf(".zw-weather[data-zw-places]"), CSS.indexOf(".zw-weather[data-zw-places]") + 500);
  assert.match(rule, /cursor: pointer/, "the card says it can be clicked");
  assert.match(rule, /:not\(\[data-zw-places="1"\]\)/, "but only a card with somewhere to go promises a place change");
  assert.ok(CSS.includes(":focus-visible"), "and the keyboard can see where it is");
  assert.ok(CSS.includes("underline dotted"), "the place name is the control, so it says so on hover");
});

test("the JSON preference is owner-facing and reachable in Sine's own page", () => {
  const item = SETTINGS.schema.find((x) => x.property === "zen.workspace.zentral.widgets.weather.places");
  assert.ok(item, "the places pref is in the schema");
  assert.equal(item.type, "input");
  assert.ok(LAYOUT.order.includes("zen.workspace.zentral.widgets.weather.places"), "and in the Sine preference page");
  assert.ok(!/setStringPref\(WIDGET_PREFS\.WEATHER_PLACES, ""\)/.test(SRC), "the list is never blanked by an empty write");
});

(async () => {
  const twoPlaces = JSON.stringify([
    { id: "home", name: "Home", latitude: 50.67, longitude: 17.92 },
    { id: "work", name: "Work", latitude: 52.23, longitude: 21.0 },
  ]);
  // Count the network: a place switch must fetch the new place, not repaint the old place's cached numbers.
  const urls = [];
  const h = createFakeSidebarHarness(
    {
      "zen.workspace.zentral.widgets.enabled": true,
      "zen.workspace.zentral.widgets.clock.enabled": false,
      "zen.workspace.zentral.widgets.date.enabled": false,
      "zen.workspace.zentral.widgets.weather.enabled": true,
      "zen.workspace.zentral.widgets.weather.places": twoPlaces,
      "zen.workspace.zentral.widgets.weather.refresh_minutes": 30,
    },
    {
      fetch(url) {
        urls.push(String(url));
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              current: { temperature_2m: 20, weather_code: 0 },
              daily: {
                time: ["2026-11-17"],
                weather_code: [0],
                temperature_2m_max: [21],
                temperature_2m_min: [11],
              },
            }),
        });
      },
    },
  );
  const { api } = h.start();
  // The first refresh is asynchronous: let it land before reading the card.
  await new Promise((r) => setTimeout(r, 40));

  const card = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "weather");
  assert.ok(card, "the weather card mounted");
  const body = card.querySelector(".zw-weather");
  assert.ok(body, "and it drew its body");
  assert.equal(body.getAttribute("data-zw-places"), "2", "the card knows it has two places");
  assert.equal(body.getAttribute("role"), "button", "and that it is a control");
  const placeLine = () => card.querySelector(".zw-weather-place").textContent;
  assert.match(placeLine(), /Home/, "the first place is showing");

  // OW-95: the card has two gestures, and this proves both against the live card rather than the source.
  const click = (extra = {}) => {
    const listeners = body._listeners.filter(([type]) => type === "click");
    assert.equal(listeners.length, 1, "exactly one click handler on the card");
    listeners[0][1]({ preventDefault() {}, stopPropagation() {}, ...extra });
  };
  const callsBefore = urls.length;
  // A plain click walks the views and must NOT fetch: three views are one reading.
  assert.equal(body.getAttribute("data-zw-weather-view"), "today");
  click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(body.getAttribute("data-zw-weather-view"), "tomorrow", "a click shows tomorrow");
  assert.equal(urls.length, callsBefore, "and it did not ask the network for a second reading");
  click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(body.getAttribute("data-zw-weather-view"), "week", "then the week");
  click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(body.getAttribute("data-zw-weather-view"), "today", "and it wraps back to today");
  assert.match(placeLine(), /Home/, "the place never moved: the click is the view axis alone");

  // The place axis is the modified click.
  const beforePlace = urls.length;
  click({ ctrlKey: true });
  await new Promise((r) => setTimeout(r, 40));
  assert.match(placeLine(), /Work/, "a Ctrl+click shows the next place");
  assert.equal(urls.length, beforePlace + 1, "and it fetched the new place instead of trusting the old cache");
  assert.match(urls[urls.length - 1], /latitude=52\.23/, "the request is for the place now on the card");
  assert.equal(body.getAttribute("data-zw-weather-view"), "today", "and the view stayed where it was");

  // A hold resets both: back to Today and back to the first place.
  click({ ctrlKey: true });
  await new Promise((r) => setTimeout(r, 30));
  assert.match(placeLine(), /Home/, "the modified click wraps too");
  const down = body._listeners.filter(([type]) => type === "pointerdown");
  assert.ok(down.length >= 1, "the card arms a hold on pointerdown");
  const viewBeforeHold = body.getAttribute("data-zw-weather-view");
  click(); // move off today, so the reset has something to undo
  await new Promise((r) => setTimeout(r, 10));
  assert.notEqual(body.getAttribute("data-zw-weather-view"), viewBeforeHold);
  down[0][1]({ button: 0 });
  // The harness owns time: a real `setTimeout` never fires in it, so the hold is advanced the way the suite always
  // advances a widget timer.
  h.advanceTime(700);
  assert.equal(body.getAttribute("data-zw-weather-view"), "today", "a hold returns to Today");
  assert.match(placeLine(), /Home/, "and to the first place");

  api.destroy();
  console.log(`PASS widgets-weather-places (${passed} tests, 1 live)`);
})();
