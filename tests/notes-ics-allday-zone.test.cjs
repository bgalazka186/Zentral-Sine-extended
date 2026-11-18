"use strict";
/* T2.13a regression: an all-day date in a calendar file is a calendar DAY, not an instant.
 *
 * `icsStamp` built all-day values as `Date.UTC(y,m,d)` and then "corrected" them by the local offset *of that UTC
 * midnight*. That correction is a no-op in UTC and wrong in every other zone: in America/Los_Angeles it subtracted
 * eight hours, so `DTSTART;VALUE=DATE:20261101` became 2026-10-31; in Pacific/Auckland it added thirteen and became
 * 2026-11-02. The imported item then fell outside the day cell it belongs to and the imported-holiday mark was drawn
 * on nothing — which is how the regression suite caught it, only in those two zones.
 *
 * Local midnight of the written day is the instant whose local date key is that day, in every zone from UTC-11 to
 * UTC+14, including the 30- and 45-minute offsets. This file pins that, and pins the day-cell lookup end to end, so a
 * future change to the stamping cannot put the bug back in a form the UTC-only run would miss.
 */
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("ok - " + name); }
  catch (err) { failed++; console.error("FAIL:", name, "\n ", err && err.stack ? err.stack : err); }
}

const ics = (lines) => "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//EN\r\n" + lines.join("\r\n") + "\r\nEND:VCALENDAR\r\n";

const DATES = ["2026-01-01", "2026-03-08", "2026-11-01", "2026-12-31", "2027-02-28"];

(async () => {
  await test("an all-day DTSTART keeps the day the file wrote, in whatever zone this runs", async () => {
    for (const day of DATES) {
      const stamp = day.replace(/-/g, "");
      const parsed = C.parseIcs(ics(["BEGIN:VEVENT", "UID:d" + stamp, "DTSTART;VALUE=DATE:" + stamp, "SUMMARY:Day", "END:VEVENT"]));
      const item = C.icsToItem(parsed.events[0], { kind: "event", now: Date.UTC(2026, 0, 1) });
      assert.ok(item, "the event is readable");
      assert.equal(item.start.date, day, `DTSTART;VALUE=DATE:${stamp} is ${day}, not a neighbouring day (TZ=${process.env.TZ || "system"})`);
      // Every day boundary of that date must round-trip through the key the calendar uses for its cells.
      const midnight = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))).getTime();
      assert.equal(C.localDateKey(midnight), day, "local midnight of the day has that day's key");
      assert.equal(C.localDateKey(C.nextDayStart(midnight) - 1), day, "and so does the last millisecond of it");
    }
  });

  await test("the imported item lands in the day cell's own range, so the mark can be drawn", async () => {
    for (const day of DATES) {
      const stamp = day.replace(/-/g, "");
      const parsed = C.parseIcs(ics(["BEGIN:VEVENT", "UID:r" + stamp, "DTSTART;VALUE=DATE:" + stamp, "SUMMARY:Day", "END:VEVENT"]));
      const item = C.icsToItem(parsed.events[0], { kind: "event", now: Date.UTC(2026, 0, 1) });
      const dayStart = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))).getTime();
      const found = C.itemsInRange([item], dayStart, C.nextDayStart(dayStart));
      assert.equal(found.length, 1, `${day} is found by the cell that draws it`);
      // The previous and next cell must NOT claim it: the old bug put the item in the neighbour.
      assert.equal(C.itemsInRange([item], C.nextDayStart(dayStart), C.nextDayStart(C.nextDayStart(dayStart))).length, 0, "the next day does not claim it");
      const prev = new Date(dayStart); prev.setDate(prev.getDate() - 1);
      assert.equal(C.itemsInRange([item], prev.getTime(), dayStart).length, 0, "and neither does the day before");
    }
  });

  await test("an all-day event still exports as the same DATE value it was read from", async () => {
    for (const day of DATES) {
      const stamp = day.replace(/-/g, "");
      const item = {
        id: "x", summary: "Day", x: { kind: "event" },
        start: { date: day }, end: { date: C.shiftYmd(day, 1) },
        recurrence: [], exceptions: [],
      };
      const { text } = C.icsFromItems([item]);
      assert.ok(text.includes("DTSTART;VALUE=DATE:" + stamp), `${day} exports as ${stamp}`);
      const back = C.icsToItem(C.parseIcs(text).events[0], { kind: "event", now: Date.UTC(2026, 0, 1) });
      assert.equal(back.start.date, day, "and reads back as the same day — no drift on a round trip");
    }
  });

  await test("a timed event keeps its exact instant — the fix must not touch clocks", async () => {
    const parsed = C.parseIcs(ics(["BEGIN:VEVENT", "UID:t", "DTSTART:20261101T090000Z", "DTEND:20261101T100000Z", "SUMMARY:T", "END:VEVENT"]));
    const item = C.icsToItem(parsed.events[0], { kind: "event", now: Date.UTC(2026, 0, 1) });
    assert.equal(item.start.dateTime, "2026-11-01T09:00:00.000Z", "a UTC time is an instant, and stays one");
    assert.equal(item.end.dateTime, "2026-11-01T10:00:00.000Z");
  });

  console.log(`\n${passed} passed, ${failed} failed (TZ=${process.env.TZ || "system"})`);
  if (failed) process.exit(1);
})();
