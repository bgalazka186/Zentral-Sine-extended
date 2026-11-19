"use strict";
/* OW-23: time zones as something a person can choose. Fixed offsets ("UTC+3") beside IANA zones, the list the picker
 * offers, its search, and the conversion of a wall time to an instant without the minute-by-minute search.
 * Pure part first, then the picker in the real sheet (fake DOM). Runs in the time-zone matrix (file name). */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const MIN = 60000, HOUR = 3600000;
const WINTER = Date.parse("2026-01-15T12:00:00Z"), SUMMER = Date.parse("2026-07-15T12:00:00Z");
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; }
  catch (error) { console.error("not ok - " + name); throw error; }
};

// The conversion as it was before OW-23 (a formatter per call, every minute of 32 hours looked at): the reference.
function referenceZonedMs(dateKey, timeText, zone) {
  const day = C.parseYmd(dateKey), clock = /^(\d{1,2}):(\d{2})$/.exec(timeText);
  const hour = Number(clock[1]), minute = Number(clock[2]);
  const targetWall = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
  const targetEnd = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let exact = null, next = null, nextWall = Infinity;
  for (let at = targetWall - 16 * HOUR; at <= targetWall + 16 * HOUR; at += MIN) {
    const parts = Object.create(null);
    for (const part of formatter.formatToParts(new Date(at))) if (part.type !== "literal") parts[part.type] = Number(part.value);
    const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    if (wall === targetWall) { exact = at; break; }
    if (wall > targetWall && wall < targetEnd && (wall < nextWall || (wall === nextWall && (next === null || at < next)))) { nextWall = wall; next = at; }
  }
  return exact === null ? next : exact;
}

// OW-75: the calendar's Tools menu is grouped by job (Create / Calendar settings / Show and find / This week as text).
// This opens `trigger`, walks into the group that holds `label` and returns the row, so a test names the row it wants
// and not the menu's shape.
const openCalendarRow = (root, trigger, label, match = (text, want) => text === want || text.startsWith(want) || want.test?.(text)) => {
  root.querySelector(trigger).click();
  const items = () => [...root.querySelectorAll(".zn-menu-item")];
  const hit = (want) => items().find((el) => (typeof want === "string" ? el.textContent.trim() === want || el.textContent.trim().startsWith(want) : want.test(el.textContent.trim())));
  let row = hit(label);
  const groups = items().filter((el) => el.classList.contains("zn-menu-group"));
  if (!row) {
    for (const group of groups) {
      group.click();
      row = hit(label);
      if (row) break;
      const back = root.querySelector(".zn-menu-back");
      if (back) back.click();
    }
  }
  return row;
};

(async () => {
  // ---------------------------------------------------------------- 1. fixed offsets as zones
  await test("a typed offset is read in every usual spelling", () => {
    const table = [
      ["UTC+3", 180], ["utc+3", 180], ["UTC+03", 180], ["UTC+03:00", 180], ["UTC+0300", 180], ["utc +3", 180], ["+3", 180], ["+03:00", 180], ["+0300", 180],
      ["GMT-5:30", -330], ["gmt-5:30", -330], ["-5:30", -330], ["-0530", -330], ["-530", -330], ["UTC-5.30", -330], ["UTC-5h30", -330],
      ["UTC\u22123", -180], ["UTC\u20133", -180], ["UTC+5:45", 345], ["+12:45", 765], ["UTC+14", 840], ["UTC-12", -720], ["UTC+0", 0], ["UTC-0", 0], ["gmt+0", 0], ["+00:00", 0],
    ];
    for (const [text, minutes] of table) assert.equal(C.parseZoneOffset(text), minutes, text);
    for (const text of ["", "UTC", "gmt", "3", "5:30", "UTC+15", "UTC-13", "UTC+14:30", "UTC-12:30", "UTC+3:20", "UTC+3:60", "+1:5", "UTC+", "++3", "UTC+3 hours", "berlin", "Europe/Warsaw", null, undefined, 3]) {
      assert.equal(C.parseZoneOffset(text), null, String(text));
    }
    assert.ok(Object.is(C.parseZoneOffset("UTC-0"), 0), "never minus zero");
  });

  await test("a fixed offset is stored as UTC+03:00, an IANA name as it was written", () => {
    assert.equal(C.cleanZone("utc+3"), "UTC+03:00");
    assert.equal(C.cleanZone(" GMT-5:30 "), "UTC-05:30");
    assert.equal(C.cleanZone("+0545"), "UTC+05:45");
    assert.equal(C.cleanZone("UTC+0"), "UTC", "no offset is the zone UTC");
    assert.equal(C.cleanZone("UTC-12"), "UTC-12:00");
    assert.equal(C.cleanZone("UTC+14"), "UTC+14:00");
    assert.equal(C.cleanZone("UTC+03:00"), "UTC+03:00", "the stored form is stable");
    assert.equal(C.cleanZone(C.cleanZone("gmt+9:30")), "UTC+09:30");
    assert.equal(C.cleanZone("Europe/Warsaw"), "Europe/Warsaw");
    assert.equal(C.cleanZone("UTC"), "UTC");
    assert.equal(C.cleanZone("Etc/GMT-3"), "Etc/GMT-3", "stored IANA ids keep working, also the Etc ones");
    for (const bad of ["", "   ", "Mars/Olympus", "UTC+15", "UTC+3:20", "berlin", null, undefined]) assert.equal(C.cleanZone(bad), "", String(bad));
    assert.equal(C.cleanZone("Mars/Olympus"), "", "asked twice: the answer is remembered, not changed");
    assert.equal(C.fixedZoneId(180), "UTC+03:00");
    assert.equal(C.fixedZoneId(-330), "UTC-05:30");
    assert.equal(C.fixedZoneId(0), "UTC");
    assert.equal(C.fixedZoneId(900), "");
    assert.equal(C.fixedZoneId(1.5), "");
    assert.equal(C.zoneFixedOffset("UTC+03:00"), 180);
    assert.equal(C.zoneFixedOffset("UTC-05:30"), -330);
    for (const other of ["UTC", "", "Europe/Warsaw", "utc+03:00", "UTC+3", null]) assert.equal(C.zoneFixedOffset(other), null, String(other));
  });

  await test("a fixed offset has a clock, a date and days of exactly 24 hours", () => {
    const at = Date.parse("2026-03-29T00:30:00Z"); // the night the clocks go forward in Europe
    assert.deepEqual({ ...C.zoneParts(at, "UTC+03:00") }, { year: 2026, month: 3, day: 29, hour: 3, minute: 30, second: 0 });
    assert.equal(C.clockIn(at, "UTC+03:00"), "03:30");
    assert.equal(C.clockIn(at, "UTC-05:30"), "19:00");
    assert.equal(C.clockIn(at, "UTC+05:45"), "06:15");
    assert.equal(C.zonedDateKey(at, "UTC-05:30"), "2026-03-28");
    assert.equal(C.zonedDateKey(at, "UTC+03:00"), "2026-03-29");
    // The two ends of the world are 26 hours apart: one instant, two dates that are two days apart.
    const noon = Date.parse("2026-06-10T11:00:00Z");
    assert.equal(C.zonedDateKey(noon, "UTC+14:00"), "2026-06-11");
    assert.equal(C.zonedDateKey(noon, "UTC-12:00"), "2026-06-09");
    for (const key of ["2026-03-29", "2026-10-25", "2026-03-08", "2026-11-01", "2026-04-05", "2026-09-27", "2026-06-15"]) {
      for (const zone of ["UTC+03:00", "UTC-05:30", "UTC+12:45", "UTC-12:00", "UTC+14:00"]) {
        const bounds = C.zonedDayBounds(key, zone);
        assert.ok(bounds, zone + " " + key);
        assert.equal(bounds[1] - bounds[0], 24 * HOUR, "no daylight-saving time: " + zone + " " + key);
        assert.equal(C.zonedDateKey(bounds[0], zone), key);
        assert.equal(C.clockIn(bounds[0], zone), "00:00");
        assert.equal(C.zonedMinuteOfDay(bounds[0] + 150 * MIN, key, zone), 150);
        assert.equal(C.zonedMinuteOfDay(bounds[0] - 1, key, zone), 0);
        assert.equal(C.zonedMinuteOfDay(bounds[1] + 1, key, zone), 1440);
      }
    }
    assert.equal(C.zonedDateTimeToMs("2026-03-29", "02:30", "UTC+03:00"), Date.parse("2026-03-28T23:30:00Z"), "02:30 exists every day in a fixed offset");
    assert.equal(C.zonedDateTimeToMs("2026-11-16", "09:15", "utc+3"), Date.parse("2026-11-16T06:15:00Z"), "any spelling cleanZone accepts");
    assert.equal(C.zonedDateTimeToMs("2026-11-16", "09:15", "UTC-05:30"), Date.parse("2026-11-16T14:45:00Z"));
    assert.equal(C.zonedDateTimeToMs("2026-11-16", "25:00", "UTC+03:00"), null);
    assert.equal(C.zonedDateTimeToMs("2026-11-16", "09:15", "UTC+15"), null);
    assert.equal(C.zoneOffsetAt("UTC+03:00", WINTER), 180);
    assert.equal(C.zoneOffsetAt("UTC+03:00", SUMMER), 180);
    assert.equal(C.zoneOffsetAt("Europe/Warsaw", WINTER), 60);
    assert.equal(C.zoneOffsetAt("Europe/Warsaw", SUMMER), 120);
    assert.equal(C.zoneOffsetAt("Asia/Kathmandu", WINTER), 345);
    assert.equal(C.zoneOffsetAt("", WINTER), -new Date(WINTER).getTimezoneOffset());
    assert.ok(Number.isNaN(C.zoneOffsetAt("Mars/Olympus", WINTER)));
    assert.equal(C.zoneOffsetText(60), "UTC+01:00");
    assert.equal(C.zoneOffsetText(-330), "UTC-05:30");
    assert.equal(C.zoneOffsetText(0), "UTC+00:00");
  });

  await test("items, repeats, free time and the week text work in a fixed offset", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    const item = C.composeCalendarItem({ summary: "Call", kind: "event", allDay: false, startDate: "2026-03-27", startTime: "09:00", endDate: "2026-03-27", endTime: "10:00", tz: "utc+3", recurrence: ["RRULE:FREQ=DAILY;COUNT=5"] }, now);
    assert.ok(item, "the composer accepts a typed offset");
    assert.equal(item.x.tz, "UTC+03:00");
    assert.equal(item.start.dateTime, "2026-03-27T06:00:00.000Z");
    assert.equal(C.cleanItem(JSON.parse(JSON.stringify(item)), now).x.tz, "UTC+03:00", "the stored form survives a reload");
    assert.equal(C.fromGoogle(C.toGoogle(item)).x.tz, "UTC+03:00");
    // Five days over the European clock change (29 March): always 06:00 UTC, the offset has no summer time.
    const starts = C.expandItem(item, Date.parse("2026-03-26T00:00:00Z"), Date.parse("2026-04-03T00:00:00Z")).map((entry) => entry.start.dateTime);
    assert.deepEqual(starts, ["2026-03-27T06:00:00.000Z", "2026-03-28T06:00:00.000Z", "2026-03-29T06:00:00.000Z", "2026-03-30T06:00:00.000Z", "2026-03-31T06:00:00.000Z"]);
    // The same series in Warsaw keeps 09:00 on the wall, so its instant moves by an hour.
    const warsaw = C.composeCalendarItem({ summary: "Call", kind: "event", allDay: false, startDate: "2026-03-27", startTime: "09:00", endDate: "2026-03-27", endTime: "10:00", tz: "Europe/Warsaw", recurrence: ["RRULE:FREQ=DAILY;COUNT=5"] }, now);
    assert.deepEqual(C.expandItem(warsaw, Date.parse("2026-03-26T00:00:00Z"), Date.parse("2026-04-03T00:00:00Z")).map((entry) => entry.start.dateTime),
      ["2026-03-27T08:00:00.000Z", "2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z", "2026-03-30T07:00:00.000Z", "2026-03-31T07:00:00.000Z"]);
    // Free time of one day shown in UTC+03:00: the day is that zone's day, the busy hour is cut out of it.
    const day = C.parseYmd("2026-03-29").getTime(), bounds = C.zonedDayBounds("2026-03-29", "UTC+03:00");
    const busy = C.makeItem({ id: "busy", summary: "Busy", start: { dateTime: new Date(bounds[0] + 10 * HOUR).toISOString() }, end: { dateTime: new Date(bounds[0] + 11 * HOUR).toISOString() }, x: { kind: "event", src: "manual" } }, now);
    assert.deepEqual(C.freeSlots([busy], day, C.addDays(day, 1), 60, { zone: "UTC+03:00" }), [[bounds[0], bounds[0] + 10 * HOUR], [bounds[0] + 11 * HOUR, bounds[1]]]);
    const work = C.freeSlots([busy], day, C.addDays(day, 1), 30, { zone: "UTC+03:00", work: { days: [0, 1, 2, 3, 4, 5, 6], startMin: 540, endMin: 720 } });
    assert.deepEqual(work, [[bounds[0] + 9 * HOUR, bounds[0] + 10 * HOUR], [bounds[0] + 11 * HOUR, bounds[0] + 12 * HOUR]], "working hours are hours of the fixed offset");
    assert.match(C.weekText([{ ...busy, x: { ...busy.x, tz: "UTC+03:00" } }], C.dayStart(bounds[0]), {}), /10:00-11:00 Busy/, "the week text shows the item's own clock");
    // The Week / Day grid is the clock of the display zone: 20:30-21:00 UTC is 23:30-24:00 at +3 and 02:15-02:45 of the next day at +5:45.
    const late = C.makeItem({ id: "late", summary: "Late", start: { dateTime: "2026-03-29T20:30:00.000Z" }, end: { dateTime: "2026-03-29T21:00:00.000Z" }, x: { kind: "event", src: "manual" } }, now);
    const minutes = (key, zone) => C.layoutDay([late], C.parseYmd(key).getTime(), zone).map((entry) => [entry.startMin, entry.endMin]);
    assert.deepEqual(minutes("2026-03-29", "UTC+03:00"), [[1410, 1440]]);
    assert.deepEqual(minutes("2026-03-30", "UTC+05:45"), [[135, 165]]);
    assert.deepEqual(minutes("2026-03-29", "UTC+05:45"), [], "at +5:45 it is not on the 29th at all");
    assert.deepEqual(minutes("2026-03-29", "UTC-12:00"), [[510, 540]]);
    const hours = C.visibleHourRange({ on: true, startMin: 480, endMin: 1200 }, [{ day: C.parseYmd("2026-03-29").getTime(), items: [late] }], "UTC+03:00");
    assert.deepEqual([hours.startMin, hours.endMin, hours.extendedBottom], [480, 1440, true], "the visible hours stretch to the item's hour in the fixed offset");
  });

  // ---------------------------------------------------------------- 2. wall time to instant, without the search
  await test("a wall time in an IANA zone: normal days, the repeated hour, the skipped hour", () => {
    const ms = (key, time, zone) => C.zonedDateTimeToMs(key, time, zone);
    assert.equal(ms("2026-11-16", "09:15", "Europe/Warsaw"), Date.parse("2026-11-16T08:15:00Z"));
    assert.equal(ms("2026-07-16", "09:15", "Europe/Warsaw"), Date.parse("2026-07-16T07:15:00Z"));
    assert.equal(ms("2026-07-16", "09:15", "America/Los_Angeles"), Date.parse("2026-07-16T16:15:00Z"));
    assert.equal(ms("2026-01-16", "09:15", "Pacific/Auckland"), Date.parse("2026-01-15T20:15:00Z"));
    assert.equal(ms("2026-01-16", "09:15", "Asia/Kathmandu"), Date.parse("2026-01-16T03:30:00Z"));
    assert.equal(ms("2026-01-16", "09:15", "America/St_Johns"), Date.parse("2026-01-16T12:45:00Z"));
    assert.equal(ms("2026-01-16", "00:00", "Pacific/Kiritimati"), Date.parse("2026-01-15T10:00:00Z"), "UTC+14");
    assert.equal(ms("2026-01-16", "23:59", "Pacific/Pago_Pago"), Date.parse("2026-01-17T10:59:00Z"), "UTC-11");
    // Clocks back (25 October 2026, 03:00 -> 02:00 in Warsaw): 02:30 happens twice, the first one is taken.
    assert.equal(ms("2026-10-25", "02:30", "Europe/Warsaw"), Date.parse("2026-10-25T00:30:00Z"));
    assert.equal(ms("2026-10-25", "01:59", "Europe/Warsaw"), Date.parse("2026-10-24T23:59:00Z"));
    assert.equal(ms("2026-10-25", "03:00", "Europe/Warsaw"), Date.parse("2026-10-25T02:00:00Z"));
    // Clocks forward (29 March 2026, 02:00 -> 03:00): 02:30 does not exist, the first minute after it is 03:00.
    assert.equal(ms("2026-03-29", "02:30", "Europe/Warsaw"), Date.parse("2026-03-29T01:00:00Z"));
    assert.equal(ms("2026-03-29", "02:00", "Europe/Warsaw"), Date.parse("2026-03-29T01:00:00Z"));
    assert.equal(ms("2026-03-29", "01:59", "Europe/Warsaw"), Date.parse("2026-03-29T00:59:00Z"));
    assert.equal(ms("2026-03-29", "03:00", "Europe/Warsaw"), Date.parse("2026-03-29T01:00:00Z"));
    // Half an hour of summer time (Lord Howe Island): 02:00 -> 02:30 on 4 October 2026.
    assert.equal(ms("2026-10-04", "02:15", "Australia/Lord_Howe"), Date.parse("2026-10-03T15:30:00Z"));
    assert.equal(ms("2026-10-04", "02:30", "Australia/Lord_Howe"), Date.parse("2026-10-03T15:30:00Z"));
    // A whole day that never was: Samoa went from 29 to 31 December 2011.
    assert.equal(ms("2011-12-30", "12:00", "Pacific/Apia"), null);
    assert.equal(ms("2011-12-31", "00:00", "Pacific/Apia"), Date.parse("2011-12-30T10:00:00Z"));
    assert.equal(ms("2026-11-16", "09:15", "Mars/Olympus"), null);
    assert.equal(ms("2026-02-30", "09:15", "Europe/Warsaw"), null);
    assert.equal(ms("2026-11-16", "24:00", "Europe/Warsaw"), null);
  });

  await test("the result is the one the minute-by-minute search gave, around every kind of clock change", () => {
    // Zone, and the days around which its clock changes (or changed in a way that is not an hour forward or back).
    const cases = [
      ["Europe/Warsaw", ["2026-03-29", "2026-10-25"]], ["America/Los_Angeles", ["2026-03-08", "2026-11-01"]], ["Pacific/Auckland", ["2026-04-05", "2026-09-27"]],
      ["Australia/Lord_Howe", ["2026-04-05", "2026-10-04"]], ["America/Santiago", ["2026-04-05", "2026-09-06"]], ["America/St_Johns", ["2026-03-08", "2026-11-01"]],
      ["Pacific/Chatham", ["2026-04-05", "2026-09-27"]], ["Africa/Casablanca", ["2026-02-15", "2026-03-22"]], ["Africa/Cairo", ["2026-04-24", "2026-10-30"]],
      ["Pacific/Apia", ["2011-12-29", "2011-12-30", "2011-12-31"]], ["Asia/Kathmandu", ["2026-06-15"]], ["America/Havana", ["2026-03-08", "2026-11-01"]],
    ];
    const times = ["00:00", "00:30", "00:59", "01:00", "01:30", "02:00", "02:15", "02:30", "02:45", "03:00", "03:30", "12:00", "23:00", "23:30", "23:59"];
    let checked = 0;
    for (const [zone, days] of cases) {
      for (const key of days) {
        for (const time of times) {
          assert.equal(C.zonedDateTimeToMs(key, time, zone), referenceZonedMs(key, time, zone), zone + " " + key + " " + time);
          checked++;
        }
      }
    }
    assert.ok(checked >= 360);
  });

  await test("a daily item with its own zone in a month grid costs milliseconds, not a quarter of a second", () => {
    const { performance } = require("node:perf_hooks");
    const { scaleBudget } = require("./helpers/perf-budget.cjs");
    const now = Date.parse("2026-11-13T12:00:00Z"), from = C.dayStart(Date.parse("2026-10-26T12:00:00Z")), to = C.addDays(from, 42);
    // The production call shape: the Month view expands every item for its 42 days at each draw.
    const items = ["Europe/Warsaw", "America/Los_Angeles", "Pacific/Auckland", "Asia/Kolkata", "UTC+03:00"].flatMap((tz, n) => Array.from({ length: 4 }, (_, i) => C.makeItem({
      id: "zoned-" + n + "-" + i, summary: "Daily " + tz, start: { dateTime: new Date(Date.parse("2026-10-01T08:00:00Z") + i * HOUR).toISOString() }, end: { dateTime: new Date(Date.parse("2026-10-01T09:00:00Z") + i * HOUR).toISOString() },
      recurrence: ["RRULE:FREQ=DAILY"], x: { kind: "event", src: "manual", tz },
    }, now)));
    C.expandRange(items, from, to); // the first call builds the formatters
    const started = performance.now();
    const out = C.expandRange(items, from, to);
    const elapsed = performance.now() - started, ceiling = scaleBudget(120);
    assert.ok(out.length >= items.length * 40 && out.length <= items.length * 43, "about one occurrence per item and day: " + out.length);
    console.log(`month grid, 20 daily items with their own zone: ${elapsed.toFixed(1)} ms (ceiling ${ceiling.toFixed(0)} ms; before OW-23 about 3 400 ms)`);
    assert.ok(elapsed < ceiling, `20 zoned daily items took ${elapsed.toFixed(1)} ms for one month grid`);
  });

  // ---------------------------------------------------------------- 3. what the picker offers
  const winter = C.zoneChoices(WINTER), summer = C.zoneChoices(SUMMER);
  const byId = (list, id) => list.find((choice) => choice.id === id);

  await test("the list: every zone of the engine with city, country, offset now and abbreviation; then the fixed offsets", () => {
    assert.ok(winter.length > 300, "the engine's zones are listed");
    const warsaw = byId(winter, "Europe/Warsaw");
    assert.ok(warsaw, "Europe/Warsaw is listed");
    assert.equal(warsaw.kind, "zone"); assert.equal(warsaw.city, "Warsaw"); assert.equal(warsaw.area, "Europe");
    assert.equal(warsaw.countryCode, "PL"); assert.equal(warsaw.country, "Poland"); assert.equal(warsaw.label, "Warsaw, Poland");
    assert.equal(warsaw.offsetMin, 60); assert.equal(warsaw.offset, "UTC+01:00"); assert.equal(warsaw.abbr, "CET");
    assert.match(warsaw.detail, /^UTC\+01:00 · CET/);
    const warsawSummer = byId(summer, "Europe/Warsaw");
    assert.equal(warsawSummer.offset, "UTC+02:00", "the offset follows daylight-saving time");
    assert.equal(warsawSummer.abbr, "CEST");
    assert.equal(byId(winter, "America/New_York").abbr, "EST"); assert.equal(byId(summer, "America/New_York").abbr, "EDT");
    assert.equal(byId(winter, "America/New_York").country, "United States");
    assert.equal(byId(summer, "America/New_York").offset, "UTC-04:00");
    assert.equal(byId(winter, "Asia/Tokyo").abbr, "JST");
    assert.equal(byId(winter, "Europe/London").abbr, "GMT"); assert.equal(byId(summer, "Europe/London").abbr, "BST");
    assert.equal(byId(summer, "Europe/Dublin").abbr, "IST");
    assert.equal(byId(winter, "Pacific/Auckland").offset, "UTC+13:00", "southern summer in January");
    assert.equal(byId(summer, "Pacific/Auckland").offset, "UTC+12:00");
    const losAngeles = byId(winter, "America/Los_Angeles");
    assert.equal(losAngeles.city, "Los Angeles", "underscores are spaces");
    const indiana = winter.find((choice) => choice.id.startsWith("America/Indiana/"));
    assert.ok(indiana && indiana.sub === "Indiana" && indiana.country === "United States", "a zone three names deep keeps its middle name for the search");
    // India: the engine lists one spelling of the city; the newer one is shown, both are found.
    const india = byId(winter, "Asia/Kolkata") || byId(winter, "Asia/Calcutta");
    assert.ok(india, "India's zone is listed under one of its two ids");
    assert.equal(india.city, "Kolkata"); assert.equal(india.country, "India"); assert.equal(india.offset, "UTC+05:30"); assert.equal(india.abbr, "IST");
    assert.match(india.search, /\bkolkata\b/); assert.match(india.search, /\bcalcutta\b/);
    // Zones first, sorted by city; no id twice; nothing without an area among them.
    const zones = winter.filter((choice) => choice.kind === "zone"), fixed = winter.filter((choice) => choice.kind === "offset");
    assert.equal(winter.indexOf(fixed[0]), zones.length, "the fixed offsets follow the zones");
    assert.deepEqual(zones.map((choice) => choice.cityKey), zones.map((choice) => choice.cityKey).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    assert.equal(new Set(winter.map((choice) => choice.id)).size, winter.length);
    assert.ok(zones.every((choice) => choice.id.includes("/") && !choice.id.startsWith("Etc/")));
    assert.ok(zones.every((choice) => choice.countryCode.length === 2), "every listed zone has a country: " + zones.filter((choice) => choice.countryCode.length !== 2).map((choice) => choice.id).join(", "));
    assert.ok(zones.every((choice) => C.cleanZone(choice.id) === choice.id));
    // Fixed offsets: UTC-12:00 to UTC+14:00, whole hours and the real half and three-quarter hours.
    assert.deepEqual(fixed.map((choice) => choice.offsetMin), [...C.FIXED_ZONE_CHOICES]);
    assert.equal(fixed[0].id, "UTC-12:00"); assert.equal(fixed[fixed.length - 1].id, "UTC+14:00");
    for (let hours = -12; hours <= 14; hours++) assert.ok(fixed.some((choice) => choice.offsetMin === hours * 60), "whole hour " + hours);
    for (const id of ["UTC-09:30", "UTC-03:30", "UTC+03:30", "UTC+04:30", "UTC+05:30", "UTC+05:45", "UTC+06:30", "UTC+08:45", "UTC+09:30", "UTC+10:30", "UTC+12:45"]) assert.ok(byId(fixed, id), id);
    assert.ok(!byId(fixed, "UTC+00:30") && !byId(fixed, "UTC+07:30"), "no half hours nobody uses");
    assert.equal(byId(fixed, "UTC").label, "UTC"); assert.equal(byId(fixed, "UTC").offset, "UTC+00:00");
    assert.ok(fixed.every((choice) => C.cleanZone(choice.id) === choice.id), "every fixed id is its own stored form");
    assert.deepEqual(byId(fixed, "UTC+03:00").offsetMin, byId(summer, "UTC+03:00").offsetMin, "a fixed offset is the same all year");
    // Entries cannot be changed, and the returned list is the caller's own.
    assert.ok(Object.isFrozen(warsaw));
    const again = C.zoneChoices(WINTER);
    again.length = 0;
    assert.ok(C.zoneChoices(WINTER).length > 300, "emptying a returned list does not empty the next one");
    assert.deepEqual(C.zoneChoices(NaN), []);
    // A given list of ids instead of the engine's; unknown names are left out.
    const some = C.zoneChoices(WINTER, { zones: ["Europe/Warsaw", "Mars/Olympus", "Europe/Warsaw", "UTC", "Asia/Tokyo"] });
    assert.deepEqual(some.filter((choice) => choice.kind === "zone").map((choice) => choice.id), ["Asia/Tokyo", "Europe/Warsaw"]);
    // A second language for country names is searchable, the label stays English.
    const polish = C.zoneChoices(WINTER, { zones: ["Europe/Berlin"], locale: "pl" })[0];
    assert.equal(polish.label, "Berlin, Germany"); assert.match(polish.search, /\bniemcy\b/);
    // One entry for a zone that is not in the list.
    assert.equal(C.zoneChoice("UTC+08:15", WINTER).label, "UTC+08:15");
    assert.equal(C.zoneChoice("utc+3", WINTER).id, "UTC+03:00");
    assert.equal(C.zoneChoice("Europe/Warsaw", SUMMER).detail, warsawSummer.detail);
    assert.equal(C.zoneChoice("Mars/Olympus", WINTER), null);
    assert.equal(C.zoneChoice("Europe/Warsaw", NaN), null);
  });

  await test("search: city, country, abbreviation, offset; every word must be found", () => {
    const ids = (query, limit) => C.searchZones(winter, query, limit).map((choice) => choice.id);
    assert.deepEqual(ids("berlin"), ["Europe/Berlin"]);
    assert.deepEqual(ids("BERLIN "), ["Europe/Berlin"]);
    assert.deepEqual(ids("poland"), ["Europe/Warsaw"]);
    assert.equal(ids("new york")[0], "America/New_York");
    assert.equal(ids("york")[0], "America/New_York", "a later word of the city");
    assert.deepEqual(ids("america los"), ["America/Los_Angeles"]);
    assert.equal(ids("sao paulo")[0], "America/Sao_Paulo");
    assert.equal(ids("s\u00e3o paulo")[0], "America/Sao_Paulo", "accents do not matter");
    // An abbreviation: every zone that is on it now.
    const cet = ids("cet", 100);
    assert.ok(cet.length > 20 && cet.includes("Europe/Berlin") && cet.includes("Europe/Warsaw") && cet.includes("Europe/Paris"));
    assert.ok(C.searchZones(winter, "cet", 100).slice(0, 20).every((choice) => choice.abbr === "CET"), "zones on CET now come first");
    assert.ok(!cet.includes("Europe/London") && !cet.includes("Europe/Helsinki"));
    assert.ok(C.searchZones(summer, "cest", 100).some((choice) => choice.id === "Europe/Berlin" && choice.abbr === "CEST"));
    assert.ok(ids("cest", 100).includes("Europe/Berlin"), "in winter the summer abbreviation still finds the zone");
    assert.ok(ids("est", 100).includes("America/New_York"));
    assert.equal(ids("utc")[0], "UTC");
    // An offset: the fixed offset first, then the zones that are at it now.
    for (const typed of ["+3", "utc+3", "UTC+03:00", "gmt+3", "+0300"]) {
      const found = C.searchZones(winter, typed, 100);
      assert.equal(found[0].id, "UTC+03:00", typed);
      assert.ok(found.length > 5 && found.slice(1).every((choice) => choice.kind === "zone" && choice.offsetMin === 180), typed);
      assert.ok(found.some((choice) => choice.id === "Europe/Moscow"), typed);
    }
    assert.deepEqual(ids("gmt-5:30"), ["UTC-05:30"], "an offset no zone is at is still offered");
    assert.deepEqual(ids("utc+3:15"), ["UTC+03:15"], "also one the list does not hold");
    assert.ok(ids("+1", 100).includes("Europe/Warsaw"));
    assert.ok(!C.searchZones(summer, "+1", 100).some((choice) => choice.id === "Europe/Warsaw"), "in summer Warsaw is at +2");
    assert.ok(C.searchZones(summer, "+2", 100).some((choice) => choice.id === "Europe/Warsaw"));
    const nepal = ids("+5:45");
    assert.equal(nepal[0], "UTC+05:45"); assert.equal(nepal.length, 2, "Nepal is the one zone at +5:45");
    // Nothing typed, nothing found, limits.
    assert.deepEqual(ids(""), []); assert.deepEqual(ids("   "), []);
    assert.deepEqual(ids("zzzz"), []); assert.deepEqual(ids("berlin zzzz"), []);
    assert.equal(ids("a", 7).length, 7);
    assert.equal(ids("america", 40).length, 40);
    assert.equal(ids("america").length, 40, "forty at most unless asked otherwise");
    assert.deepEqual(C.searchZones(null, "berlin"), []);
    assert.deepEqual(C.searchZones([null, {}, { id: 5 }], "berlin"), []);
    // The other spelling of a renamed city.
    assert.equal(C.searchZones(winter, "kolkata")[0].city, "Kolkata");
    assert.equal(C.searchZones(winter, "calcutta")[0].city, "Kolkata");
    assert.equal(C.searchZones(winter, "kyiv")[0].countryCode, "UA");
    assert.equal(C.searchZones(winter, "kiev")[0].countryCode, "UA");
    assert.equal(C.zoneSearchText("  S\u00e3o_Paulo / \u0141\u00f3d\u017a (UTC\u22123) "), "sao paulo lodz utc-3");
  });

  await test("what a typed text stands for when nothing was picked from the list", () => {
    const zone = (text) => C.resolveZoneText(winter, text);
    assert.equal(zone(""), ""); assert.equal(zone("   "), "", "nothing typed is the computer's zone");
    assert.equal(zone("Europe/Warsaw"), "Europe/Warsaw");
    assert.equal(zone("europe/warsaw"), "Europe/Warsaw", "the id in the list's spelling");
    assert.equal(zone("utc+3"), "UTC+03:00"); assert.equal(zone("GMT-5:30"), "UTC-05:30"); assert.equal(zone("+0545"), "UTC+05:45");
    assert.equal(zone("utc"), "UTC"); assert.equal(zone("UTC"), "UTC");
    assert.equal(zone("berlin"), "Europe/Berlin"); assert.equal(zone("Warsaw"), "Europe/Warsaw"); assert.equal(zone("new york"), "America/New_York");
    assert.equal(zone("tokyo"), "Asia/Tokyo"); assert.equal(zone("poland"), "Europe/Warsaw", "a country with one zone");
    // "india" also begins Indiana and the Indian Ocean; the country of that name has one zone.
    assert.ok(C.searchZones(winter, "india", 100).length > 5);
    assert.equal(C.zoneChoice(zone("india"), WINTER).city, "Kolkata");
    assert.equal(zone("japan"), "Asia/Tokyo");
    for (const several of ["germany", "indiana", "mexico"]) assert.equal(zone(several), null, several + " has more than one zone");
    assert.equal(zone("Etc/GMT-3"), "Etc/GMT-3", "an id the list does not offer stays valid");
    // An id typed in another letter case is stored in the case of the tz database, whichever spelling the engine lists.
    assert.equal(zone("asia/kolkata"), "Asia/Kolkata"); assert.equal(zone("EUROPE/KYIV"), "Europe/Kyiv");
    assert.equal(zone("etc/gmt-3"), "Etc/GMT-3"); assert.equal(zone("america/argentina/buenos_aires"), "America/Argentina/Buenos_Aires");
    assert.equal(C.cleanZone(zone("Asia/Kolkata")), zone("Asia/Kolkata"), "either spelling of an id is kept as a valid zone");
    for (const unclear of ["cet", "est", "united states", "a", "america", "zzzz", "Mars/Olympus", "UTC+15", "25:00"]) assert.equal(zone(unclear), null, unclear);
    assert.equal(C.resolveZoneText([], "Europe/Warsaw"), "Europe/Warsaw", "without a list an id is still an id");
    assert.equal(C.resolveZoneText(null, "berlin"), null);
  });

  await test("the groups shown before anything is typed, and the zones chosen lately", () => {
    assert.deepEqual(C.cleanRecentZones(["Europe/Warsaw", "utc+3", "Mars/Olympus", "Europe/Warsaw", "", null, "Asia/Tokyo"]), ["Europe/Warsaw", "UTC+03:00", "Asia/Tokyo"]);
    assert.deepEqual(C.cleanRecentZones(["Europe/Warsaw", "Asia/Tokyo"], "Asia/Tokyo"), ["Asia/Tokyo", "Europe/Warsaw"], "the newest first, once");
    assert.deepEqual(C.cleanRecentZones(["a", "b"], "nope"), []);
    assert.deepEqual(C.cleanRecentZones("Europe/Warsaw"), []);
    assert.equal(C.cleanRecentZones(["UTC+01:00", "UTC+02:00", "UTC+03:00", "UTC+04:00", "UTC+05:00", "UTC+06:00", "UTC+07:00"], "UTC+08:00").length, 6, "at most six");
    assert.equal(C.cleanRecentZones(["UTC+01:00", "UTC+02:00", "UTC+03:00", "UTC+04:00", "UTC+05:00", "UTC+06:00", "UTC+07:00"], "UTC+08:00")[0], "UTC+08:00");
    const stored = ["Asia/Tokyo"]; C.cleanRecentZones(stored, "Europe/Warsaw");
    assert.deepEqual(stored, ["Asia/Tokyo"], "the stored list is not changed in place");
    const groups = C.zoneGroups(winter, { system: "Europe/Warsaw", recent: ["UTC+03:00", "Asia/Tokyo", "Europe/Warsaw", "bad"], now: WINTER });
    assert.deepEqual(groups.slice(0, 3).map((group) => group.id), ["system", "recent", "offsets"]);
    assert.deepEqual(groups[0].items.map((choice) => choice.id), ["Europe/Warsaw"]);
    assert.deepEqual(groups[1].items.map((choice) => choice.id), ["UTC+03:00", "Asia/Tokyo"], "the computer's zone is not repeated under the recent ones");
    assert.equal(groups[2].items.length, C.FIXED_ZONE_CHOICES.length);
    const areas = groups.slice(3);
    assert.deepEqual(areas.map((group) => group.title), areas.map((group) => group.title).sort());
    for (const title of ["Africa", "America", "Asia", "Australia", "Europe", "Pacific"]) assert.ok(areas.some((group) => group.title === title), title);
    assert.equal(areas.reduce((sum, group) => sum + group.items.length, 0), winter.filter((choice) => choice.kind === "zone").length, "every zone is in exactly one area");
    assert.ok(areas.find((group) => group.title === "Europe").items.some((choice) => choice.id === "Europe/Warsaw"));
    // Without a known computer zone or recent zones those groups are left out; a recent zone that is not listed gets an entry.
    assert.deepEqual(C.zoneGroups(winter, {}).slice(0, 1).map((group) => group.id), ["offsets"]);
    const odd = C.zoneGroups(winter, { recent: ["UTC+08:15"], now: WINTER });
    assert.equal(odd[0].id, "recent"); assert.equal(odd[0].items[0].label, "UTC+08:15");
    assert.deepEqual(C.zoneGroups(null), []);
  });

  // ---------------------------------------------------------------- 4. the picker in the real sheet
  const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  const dom = require("./helpers/fake-dom.cjs")();
  const { El, Ev, document, raf } = dom;
  const listeners = new Map();
  const win = {
    __zentralNotesParts: { "notes-calendar": C }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {},
    requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, queueMicrotask,
    innerWidth: 1200, innerHeight: 800,
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((x) => x !== fn)); },
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); },
  };
  win.window = win;
  vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, Intl, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux", language: "pl-PL" } });
  const core = win.__zentralNotesTestSeam.core;
  const flush = async () => { for (let i = 0; i < 6; i++) { raf.splice(0).forEach((fn) => fn()); await new Promise((resolve) => setImmediate(resolve)); } };
  const files = new Map();
  const io = {
    join: (...parts) => parts.join("/"), filename: (value) => value.split("/").pop(),
    readUTF8: async (value) => { if (!files.has(value)) throw new Error("not found"); return files.get(value).text; },
    writeUTF8: async (value, text) => files.set(value, { text, mtime: Date.now() }),
    remove: async (value) => files.delete(value), exists: async (value) => files.has(value),
    children: async (dir) => [...files.keys()].filter((value) => value.startsWith(dir + "/") && !value.slice(dir.length + 1).includes("/")),
    stat: async (value) => ({ lastModified: files.get(value)?.mtime || 0 }), restrict: async () => {},
  };
  const store = core.createStore({ io, notify() {}, windowId: "zone-picker-ui", getDir: async () => "/zone-picker", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (root) => host.append(root), getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const prefs = new Map();
  const env = { getPref: (key, fallback) => prefs.has(key) ? prefs.get(key) : fallback, setPref: (key, value) => prefs.set(key, value), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
  await store.open();
  store.create("# A note\n\nText");
  await store.flush();
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root; root.ownerDocument = document;
  root.querySelector(".zn-all-layout").getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  root.querySelector(".zn-all-panels").getBoundingClientRect = root.querySelector(".zn-all-layout").getBoundingClientRect;
  root.querySelector(".zn-calendar-pane").getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await sheet.open(); await flush();
  root.all().find((node) => node.title === "All notes").click(); await flush(); // the calendar is beside the list of notes
  const menuItem = (label) => root.querySelectorAll(".zn-menu-item").find((node) => node.textContent.trim().startsWith(label));
  const openTools = async (label) => {
    const entry = openCalendarRow(root, ".zn-calendar-tools", label);
    assert.ok(entry, "Calendar Tools offers " + label);
    entry.click(); await flush();
  };
  const type = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new Ev("input", { bubbles: true })); };
  const key = (node, name) => { const event = new Ev("keydown", { key: name, bubbles: true }); node.dispatchEvent(event); return event; };
  const options = (scope) => scope.querySelectorAll(".zn-zone-option").filter((node) => !node.hidden);
  const button = (scope, text) => scope.querySelectorAll("button").find((node) => node.textContent.trim() === text);

  await test("the display zone: typing utc+3 offers the fixed offset first, Enter takes it, Apply stores UTC+03:00", async () => {
    await openTools("Display time zone: Local");
    const card = root.querySelector('.zn-dialog-card[aria-label="Calendar display time zone"]');
    assert.ok(card, "the display-zone dialog opens");
    const input = card.querySelector(".zn-zone-input"), list = card.querySelector(".zn-zone-list");
    assert.ok(input && list, "it holds the shared picker");
    assert.equal(input.getAttribute("role"), "combobox");
    assert.equal(list.getAttribute("role"), "listbox");
    // A card that outgrew the sheet is held at a height of its own (fitCard). It has to be measured again when the
    // list opens and closes, or it keeps the height it had with the list (seen in Chromium at a 20px text size).
    card.style.height = "999px";
    type(input, "utc+3"); await flush();
    assert.equal(list.hidden, false, "typing opens the list");
    assert.equal(card.style.height, "", "the card is fitted again when the list opens");
    assert.equal(input.getAttribute("aria-expanded"), "true");
    const found = options(card);
    assert.ok(found.length > 3, "the offset and the zones at it");
    assert.equal(found[0].dataset.zone, "UTC+03:00");
    assert.match(found[0].textContent, /UTC\+03:00/);
    assert.ok(found.slice(1).every((node) => /UTC\+03:00/.test(node.textContent)), "the others are zones at +3 now");
    assert.equal(found[0].getAttribute("aria-selected"), "true", "the best match is the active option");
    assert.equal(input.getAttribute("aria-activedescendant"), found[0].id);
    card.style.height = "999px";
    const enter = key(input, "Enter"); await flush();
    assert.equal(enter.defaultPrevented, true);
    assert.equal(input.value, "UTC+03:00", "the field shows the stored form");
    assert.equal(list.hidden, true, "choosing closes the list");
    assert.equal(card.style.height, "", "the card is fitted again when the list closes");
    assert.equal(store.meta.calendarDisplayZone, "", "nothing is stored before Apply");
    assert.match(card.querySelector(".zn-zone-hint").textContent, /Fixed offset/);
    button(card, "Apply time zone").click(); await flush();
    assert.equal(store.meta.calendarDisplayZone, "UTC+03:00");
    assert.deepEqual([...store.meta.calendarRecentZones], ["UTC+03:00"], "the zone is remembered as chosen lately");
    assert.ok(root.querySelector('.zn-dialog-card[aria-label="Calendar display time zone"]') === null, "the dialog closed");
  });

  await test("the display zone: arrows move through the matches, a click picks one, Escape closes the list only", async () => {
    await openTools("Display time zone: UTC+03:00");
    const card = root.querySelector('.zn-dialog-card[aria-label="Calendar display time zone"]');
    const input = card.querySelector(".zn-zone-input"), list = card.querySelector(".zn-zone-list");
    assert.equal(input.value, "UTC+03:00", "the dialog opens with the current zone");
    const hint = card.querySelector(".zn-zone-hint");
    type(input, "zzzz"); await flush();
    assert.equal(hint.textContent, "No time zone matches this text.");
    assert.equal(options(card).length, 0);
    type(input, "cet"); await flush();
    const found = options(card);
    assert.ok(found.length > 10);
    assert.equal(hint.textContent, "Several time zones match: choose one from the list.");
    key(input, "ArrowDown"); key(input, "ArrowDown");
    assert.equal(found[2].getAttribute("aria-selected"), "true");
    assert.equal(found[0].getAttribute("aria-selected"), "false");
    key(input, "ArrowUp");
    assert.equal(found[1].getAttribute("aria-selected"), "true");
    assert.equal(input.getAttribute("aria-activedescendant"), found[1].id);
    const escape = key(input, "Escape");
    assert.equal(escape.defaultPrevented, true, "Escape is used up by the list");
    assert.equal(list.hidden, true);
    assert.equal(hint.textContent, "Several time zones match this text. Press the down arrow to choose one.", "with the list closed the line says how to get it back");
    button(card, "Browse…").click(); await flush();
    assert.equal(hint.textContent, "Choose a time zone from the list.", "the full list does not depend on the typed text");
    button(card, "Browse…").click(); await flush();
    assert.equal(list.hidden, true, "Browse… pressed again closes the list");
    assert.ok(root.querySelector('.zn-dialog-card[aria-label="Calendar display time zone"]'), "the dialog stays");
    // "cet" is not one zone: Apply refuses and says so, nothing is stored.
    button(card, "Apply time zone").click(); await flush();
    assert.equal(store.meta.calendarDisplayZone, "UTC+03:00");
    assert.equal(input.dataset.bad, "true");
    assert.match(card.textContent, /Choose a time zone from the list/);
    type(input, "poland"); await flush();
    assert.equal(input.dataset.bad, undefined, "typing clears the mark");
    const warsaw = options(card).find((node) => node.dataset.zone === "Europe/Warsaw");
    assert.ok(warsaw, "poland finds Warsaw");
    assert.match(warsaw.textContent, /Warsaw, Poland/);
    warsaw.click(); await flush();
    assert.equal(input.value, "Europe/Warsaw");
    assert.match(card.querySelector(".zn-zone-hint").textContent, /Warsaw, Poland/);
    button(card, "Apply time zone").click(); await flush();
    assert.equal(store.meta.calendarDisplayZone, "Europe/Warsaw");
    assert.deepEqual([...store.meta.calendarRecentZones], ["Europe/Warsaw", "UTC+03:00"]);
  });

  await test("the display zone: the list without typing has the recent zones and the fixed offsets on top; a city typed in full is enough", async () => {
    await openTools("Display time zone: Europe/Warsaw");
    const card = root.querySelector('.zn-dialog-card[aria-label="Calendar display time zone"]');
    const input = card.querySelector(".zn-zone-input"), list = card.querySelector(".zn-zone-list");
    button(card, "Browse…").click(); await flush();
    assert.equal(list.hidden, false);
    const titles = card.querySelectorAll(".zn-zone-group").map((node) => node.textContent.trim());
    assert.ok(titles.includes("Chosen lately") && titles.includes("Europe") && titles.some((title) => title.startsWith("Fixed offset")), titles.join(" | "));
    assert.ok(titles.indexOf("Chosen lately") < titles.findIndex((title) => title.startsWith("Fixed offset")));
    assert.ok(titles.findIndex((title) => title.startsWith("Fixed offset")) < titles.indexOf("Africa"));
    const all = options(card);
    assert.ok(all.length > 300, "every zone can be browsed");
    assert.ok(all.some((node) => node.dataset.zone === "UTC-12:00") && all.some((node) => node.dataset.zone === "UTC+14:00"));
    button(card, "Browse…").click(); await flush();
    assert.equal(list.hidden, true, "the button closes the list again");
    type(input, "tokyo"); await flush();
    button(card, "Apply time zone").click(); await flush();
    assert.equal(store.meta.calendarDisplayZone, "Asia/Tokyo", "a text with one clear answer needs no click");
    await openTools("Display time zone: Asia/Tokyo");
    button(root.querySelector('.zn-dialog-card[aria-label="Calendar display time zone"]'), "Use system local time").click(); await flush();
    assert.equal(store.meta.calendarDisplayZone, "");
    assert.deepEqual([...store.meta.calendarRecentZones], ["Asia/Tokyo", "Europe/Warsaw", "UTC+03:00"], "going back to local time forgets nothing");
  });

  await test("the composer: the item's zone is chosen with the same picker and stored with the item", async () => {
    await openTools("Create timed reminder…");
    const card = root.querySelector(".zn-cal-compose-card");
    assert.ok(card, "the composer opens");
    const input = card.querySelector('.zn-zone-input[aria-label="Time zone"]');
    assert.ok(input, "the composer has the zone picker");
    card.querySelector('[aria-label="Title"]').value = "Call the office";
    card.querySelector('[aria-label="Start date"]').value = "2026-11-20";
    card.querySelector('[aria-label="Start time"]').value = "09:00";
    type(input, "gmt-5:30"); await flush();
    const first = options(card)[0];
    assert.equal(first.dataset.zone, "UTC-05:30");
    first.click(); await flush();
    assert.equal(input.value, "UTC-05:30");
    button(card, "Create reminder").click(); await flush();
    const made = store.items.list().find((item) => item.summary === "Call the office");
    assert.ok(made, "the reminder was created");
    assert.equal(made.x.tz, "UTC-05:30");
    assert.equal(made.start.dateTime, "2026-11-20T14:30:00.000Z", "09:00 at UTC-05:30");
    assert.equal(store.meta.calendarRecentZones[0], "UTC-05:30");
    // Typed and not picked: an unclear text keeps the composer open and names the field.
    await openTools("Create timed reminder…");
    const second = root.querySelector(".zn-cal-compose-card"), zone = second.querySelector('.zn-zone-input[aria-label="Time zone"]');
    second.querySelector('[aria-label="Title"]').value = "Unclear zone";
    second.querySelector('[aria-label="Start date"]').value = "2026-11-21";
    type(zone, "est"); await flush();
    button(second, "Create reminder").click(); await flush();
    assert.ok(root.querySelector(".zn-cal-compose-card"), "the composer stays open");
    assert.equal(zone.dataset.bad, "true");
    assert.equal(store.items.list().some((item) => item.summary === "Unclear zone"), false);
    type(zone, "berlin"); await flush();
    button(second, "Create reminder").click(); await flush();
    assert.equal(store.items.list().find((item) => item.summary === "Unclear zone").x.tz, "Europe/Berlin");
  });

  await test("an item's details: the stored zone is shown, a new one is chosen by typing", async () => {
    // An item without a note: a click on its mark in the month opens its details.
    assert.ok(store.items.upsert({ id: "zone-details", summary: "Standalone call", start: { dateTime: "2026-11-10T12:00:00.000Z" }, x: { kind: "reminder", src: "manual", tz: "UTC-05:30" } }), "the store took the item");
    await flush();
    const mark = root.querySelectorAll(".zn-cal-month-mark").find((node) => node.textContent.trim() === "Standalone call");
    assert.ok(mark, "the month shows the item");
    mark.click(); await flush();
    const card = root.querySelector('.zn-dialog-card[aria-label="Calendar item details"]');
    assert.ok(card, "the details dialog opens");
    assert.match(card.textContent, /2026-11-10/, "the date of the item in its own fixed offset (06:30 on the 10th)");
    const input = card.querySelector('.zn-zone-input[aria-label="Time zone"]');
    assert.equal(input.value, "UTC-05:30");
    assert.match(card.querySelector(".zn-zone-hint").textContent, /UTC-05:30 · Fixed offset/);
    type(input, "utc+5:45"); await flush();
    key(input, "Enter");
    assert.equal(input.value, "UTC+05:45");
    button(card, "Save calendar details").click(); await flush();
    assert.equal(store.items.get("zone-details").x.tz, "UTC+05:45");
    assert.equal(store.items.get("zone-details").start.dateTime, "2026-11-10T12:00:00.000Z", "the instant is not moved by naming another zone");
    assert.equal(store.meta.calendarRecentZones[0], "UTC+05:45");
  });

  await test("the zones chosen lately are kept in the settings file and read back clean", async () => {
    await store.flush();
    // ST7.3: `calendarRecentZones` is view state and lives in ui.json, so that is the file that holds it now. The
    // assertion keeps its meaning (what was chosen lately is on disk and reads back clean) and names the right file.
    const uiEntry = [...files.entries()].find(([name]) => /ui\.json$/.test(name));
    assert.ok(uiEntry, "the view file was written");
    const saved = JSON.parse(uiEntry[1].text).ui;
    assert.deepEqual(saved.calendarRecentZones, [...store.meta.calendarRecentZones]);
    assert.ok(saved.calendarRecentZones.length >= 4 && saved.calendarRecentZones.length <= 6);
  });

  console.log(passed + " time-zone tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
