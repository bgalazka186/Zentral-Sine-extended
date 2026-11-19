"use strict";
/* OW-108: End-to-end weather data flow from ZentralWidgets scheduler/cache into ZentralNotes Calendar.
 * Tests real ZentralWidgets.uc.js + real ZentralNotesCalendar.js + real ZentralNotes.uc.js sheet together:
 *   1. Open-Meteo `timeformat=unixtime` daily timestamps resolve to local/forecast YYYY-MM-DD keys.
 *   2. Week view renders real weather glyphs (not raw icon keys like "rain") and temperatures.
 *   3. Month view respects `calendar_weather_month` (off by default, renders glyph when enabled).
 *   4. No place configured -> no requests, clean calendar.
 *   5. Stale cache refreshes through the shared scheduler (never stuck fresh) and repaints open Calendar.
 *   6. Request failure preserves prior cached weather instead of wiping it with null, and degrades cleanly when empty.
 *   7. Changing the visible date range (Next/Prev) updates displayed weather without issuing any fetch.
 */
{
  const RealDate = Date;
  const CLOCK_START = RealDate.UTC(2026, 10, 18, 12, 0, 0);
  const REAL_START = RealDate.now();
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(FixedDate.now());
    }
    static now() {
      return CLOCK_START + (RealDate.now() - REAL_START);
    }
  }
  globalThis.Date = FixedDate;
}

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const { createFakeSidebarHarness } = require("./helpers/fake-widgets-harness.cjs");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const notesSrc = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");

const flushRaf = async () => {
  for (let i = 0; i < 6; i++) {
    raf.splice(0).forEach((fn) => fn());
    await new Promise((r) => setImmediate(r));
  }
};
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

const PREF_WIDGETS = "zen.workspace.zentral.widgets.enabled";
const PREF_WEATHER = "zen.workspace.zentral.widgets.weather.enabled";
const PREF_PLACES = "zen.workspace.zentral.widgets.weather.places";
const PREF_REFRESH = "zen.workspace.zentral.widgets.weather.refresh_minutes";
const PREF_CAL_WEEK = "zen.workspace.zentral.notes.calendar_weather_week";
const PREF_CAL_MONTH = "zen.workspace.zentral.notes.calendar_weather_month";

(async () => {
  const fetchCalls = [];
  let failNext = false;
  let tempSeed = 11;

  // Unix timestamps for 2026-11-18, 2026-11-19, 2026-11-20 (UTC noon avoids TZ boundary shifts in any runner).
  const day0 = Math.floor(Date.UTC(2026, 10, 18, 12, 0, 0) / 1000);
  const day1 = day0 + 86400;
  const day2 = day0 + 2 * 86400;

  const h = createFakeSidebarHarness(
    {
      [PREF_WIDGETS]: true,
      [PREF_WEATHER]: true,
      [PREF_PLACES]: JSON.stringify([{ id: "opole", name: "Opole", latitude: 50.67, longitude: 17.92 }]),
      [PREF_REFRESH]: 30,
      "zen.workspace.zentral.widgets.clock.enabled": false,
      "zen.workspace.zentral.widgets.date.enabled": false,
      "zen.workspace.zentral.widgets.boost.enabled": false,
    },
    {
      fetch(url) {
        fetchCalls.push(String(url));
        if (failNext) {
          failNext = false;
          return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
        }
        const high0 = tempSeed;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            timezone: "UTC",
            current: { time: day0, temperature_2m: high0 - 1, relative_humidity_2m: 70, weather_code: 0, wind_speed_10m: 9 },
            daily: {
              time: [day0, day1, day2],
              weather_code: [0, 61, 71],
              temperature_2m_max: [high0, 8, 1],
              temperature_2m_min: [3, 2, -3],
              precipitation_probability_max: [5, 80, 60],
              precipitation_hours: [0, 4, 2],
              snowfall_sum: [0, 0, 1],
            },
          }),
        });
      },
    },
  );

  // Wire window event dispatch between ZentralWidgets and ZentralNotes on a shared window object.
  const listeners = new Map();
  const win = {
    __zentralNotesParts: { "notes-calendar": cal },
    __zentralNotesTestSeam: {},
    document,
    ZentralRuntime: { register() {} },
    requestAnimationFrame: (fn) => raf.push(fn),
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    innerWidth: 1200,
    innerHeight: 800,
    CustomEvent: function CustomEvent(type, init = {}) {
      return { type, detail: init.detail };
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      for (const fn of [...(listeners.get(event?.type) || [])]) fn(event);
      return true;
    },
  };
  win.window = win;

  // Boot widgets first, forwarding window events into `win`.
  const origWin = h.window;
  origWin.CustomEvent = win.CustomEvent;
  origWin.dispatchEvent = (ev) => win.dispatchEvent(ev);
  const { api: widgetsApi } = h.start();
  win.ZentralWidgets = widgetsApi;

  // Pure test for weatherDateKey with unixtime vs ISO.
  assert.equal(h.core.weatherDateKey(String(day0), "UTC"), "2026-11-18");
  assert.equal(h.core.weatherDateKey("2026-11-19", "UTC"), "2026-11-19");
  assert.equal(h.core.weatherDateKey("bad", "UTC"), "");

  await wait(50);
  assert.equal(fetchCalls.length, 1, "initial weather fetch ran once");
  const wDays = widgetsApi.weatherDays();
  assert.equal(wDays.length, 3);
  assert.deepEqual(
    Array.from(wDays, (d) => d.key),
    ["2026-11-18", "2026-11-19", "2026-11-20"],
    "unixtime daily dates map to YYYY-MM-DD keys",
  );
  assert.equal(wDays[0].glyph, "\u2600");
  assert.equal(wDays[1].glyph, "\u2614");

  // Boot Notes sheet sharing the same `win`.
  vm.runInNewContext(notesSrc, {
    window: win,
    document,
    Event: Ev,
    globalThis: { Services: {} },
    ChromeUtils: {},
    console,
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
    setTimeout,
    clearTimeout,
    queueMicrotask,
    navigator: { platform: "Linux" },
  });

  const c = win.__zentralNotesTestSeam.core;
  const files = new Map();
  const io = {
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => {
      if (!files.has(p)) throw new Error("nf " + p);
      return files.get(p).text;
    },
    writeUTF8: async (p, text) => files.set(p, { text, mtime: Date.now() }),
    remove: async (p) => files.delete(p),
    exists: async (p) => files.has(p),
    children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/")),
    stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }),
    restrict: async () => {},
  };
  const store = c.createStore({
    io,
    notify() {},
    windowId: "ow-108",
    now: () => Date.now(),
    getDir: async () => "/ow108",
    getMaxSaveMs: () => 1000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });
  await store.open();

  const host = new El("div");
  const prefs = new Map([
    [PREF_CAL_WEEK, true],
    [PREF_CAL_MONTH, false],
  ]);
  const env = {
    getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d),
    setPref: (k, v) => prefs.set(k, v),
    openLink() {},
    copyText() {},
    exportNote() {},
    exportAll() {},
    revealFolder() {},
  };
  const adapter = {
    position: "fixed",
    host,
    attach: (root) => host.append(root),
    getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }),
    watch: () => () => {},
    setActive() {},
    rewatch() {},
  };

  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root;
  root.ownerDocument = document;
  const layout = root.querySelector(".zn-all-layout");
  const panels = root.querySelector(".zn-all-panels");
  const calendarPane = root.querySelector(".zn-calendar-pane");
  layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  panels.getBoundingClientRect = layout.getBoundingClientRect;
  calendarPane.getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await sheet.open();
  await flushRaf();
  root.all().find((el) => el.title === "All notes")?.click();
  await flushRaf();
  store.setMeta({ calendarView: "week", calendarCursor: "2026-11-18" });
  sheet.refreshCalendar();
  await flushRaf();

  // 1) Week view shows glyphs and temperatures, never raw icon names.
  const weekWeatherText = () =>
    [...host.querySelectorAll(".zn-cal-weather")].map((el) => ({
      icon: el.querySelector(".zn-cal-weather-icon")?.textContent,
      temp: el.querySelector(".zn-cal-weather-temp")?.textContent,
    }));
  const initialWeek = weekWeatherText();
  assert.equal(initialWeek.length, 3, "three forecast days rendered in Week view");
  assert.deepEqual(initialWeek[0], { icon: "\u2600", temp: "11\u00b0C" });
  assert.deepEqual(initialWeek[1], { icon: "\u2614", temp: "8\u00b0C" });
  assert.deepEqual(initialWeek[2], { icon: "\u2744", temp: "1\u00b0C" });

  // 2) Changing visible date range (Next week -> no forecast days, Prev week -> restored) issues zero fetches.
  const fetchesBeforeNav = fetchCalls.length;
  const navButtons = [...root.querySelectorAll(".zn-calendar-nav")];
  const prevBtn = navButtons.find((b) => b.textContent.trim() === "\u2039");
  const nextBtn = navButtons.find((b) => b.textContent.trim() === "\u203a");
  assert.ok(prevBtn && nextBtn, "calendar Prev/Next buttons exist");
  nextBtn.click();
  await flushRaf();
  assert.equal(weekWeatherText().length, 0, "out-of-range future week shows no stale weather");
  assert.equal(fetchCalls.length, fetchesBeforeNav, "navigating calendar range never fetches");
  prevBtn.click();
  await flushRaf();
  assert.equal(weekWeatherText().length, 3, "navigating back restores cached weather");
  assert.equal(fetchCalls.length, fetchesBeforeNav, "navigating back never fetches");

  // 3) Stale cache refreshes through scheduler (not stuck fresh!) and repaints open Week calendar.
  tempSeed = 17;
  // Advance scheduler's clock past 30 minutes and fire the scheduled refresh timer.
  h.advanceTime(31 * 60 * 1000);
  await wait(50);
  await flushRaf();
  assert.equal(fetchCalls.length, fetchesBeforeNav + 1, "stale cache triggered exactly one scheduler refresh");
  assert.equal(weekWeatherText()[0].temp, "17\u00b0C", "open Week calendar repainted with new forecast temperature");

  // 4) Request failure preserves cached weather instead of wiping it with null.
  failNext = true;
  h.advanceTime(31 * 60 * 1000);
  await wait(50);
  await flushRaf();
  assert.equal(fetchCalls.length, fetchesBeforeNav + 2, "failed refresh attempted once");
  assert.equal(weekWeatherText().length, 3, "prior cached forecast stays visible on request failure");
  assert.equal(weekWeatherText()[0].temp, "17\u00b0C", "cached value is preserved");

  // 5) Month view gating: off by default, renders glyphs when calendar_weather_month is true.
  await store.setMeta({ calendarView: "month", calendarCursor: "2026-11-18" });
  sheet.refreshCalendar();
  await flushRaf();
  assert.equal(host.querySelectorAll(".zn-cal-month-weather").length, 0, "month weather is off by default");

  prefs.set(PREF_CAL_MONTH, true);
  sheet.refreshCalendar();
  await flushRaf();
  const monthIcons = [...host.querySelectorAll(".zn-cal-month-weather")].map((el) => el.textContent);
  assert.equal(monthIcons.length, 3, "month weather shows glyphs for forecast days when enabled");
  assert.deepEqual(monthIcons, ["\u2600", "\u2614", "\u2744"]);

  // Live weather cache update also repaints Month view when enabled.
  tempSeed = 22;
  h.advanceTime(31 * 60 * 1000);
  await wait(50);
  await flushRaf();
  const updatedMonthTitles = [...host.querySelectorAll(".zn-cal-month-weather")].map((el) => el.title);
  assert.match(updatedMonthTitles[0], /22\u00b0C/, "Month view repainted on zentral-weather-updated");

  // 6) Week pref off hides Week weather.
  await store.setMeta({ calendarView: "week", calendarCursor: "2026-11-18" });
  prefs.set(PREF_CAL_WEEK, false);
  sheet.refreshCalendar();
  await flushRaf();
  assert.equal(weekWeatherText().length, 0, "Week weather hides when calendar_weather_week is false");
  prefs.set(PREF_CAL_WEEK, true);
  sheet.refreshCalendar();
  await flushRaf();
  assert.equal(weekWeatherText().length, 3, "Week weather returns when re-enabled");

  // 7) Clearing all places removes weather without crashing or making requests.
  const fetchesBeforeClear = fetchCalls.length;
  h.Services.prefs.setStringPref(PREF_PLACES, "[]");
  await wait(50);
  await flushRaf();
  assert.equal(fetchCalls.length, fetchesBeforeClear, "no place configured -> no network fetch");
  assert.equal(weekWeatherText().length, 0, "no place configured -> no weather rendered");

  // 8) Clean degradation when cache is empty and initial fetch fails.
  const hErr = createFakeSidebarHarness(
    {
      [PREF_WIDGETS]: true,
      [PREF_WEATHER]: true,
      [PREF_PLACES]: JSON.stringify([{ id: "opole", name: "Opole", latitude: 50.67, longitude: 17.92 }]),
      "zen.workspace.zentral.widgets.clock.enabled": false,
      "zen.workspace.zentral.widgets.date.enabled": false,
      "zen.workspace.zentral.widgets.boost.enabled": false,
    },
    {
      fetch: () => Promise.reject(new Error("offline")),
    },
  );
  const { api: errApi } = hErr.start();
  await wait(40);
  assert.deepEqual(Array.from(errApi.weatherDays()), [], "failed initial fetch leaves weatherDays empty without throwing");
  errApi.destroy();

  sheet.destroy();
  widgetsApi.destroy();
  console.log("PASS OW-108 calendar weather (unixtime keys, glyphs, stale refresh, failure retention, Month/Week gating, range change, no-place)");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
