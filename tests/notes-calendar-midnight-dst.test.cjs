"use strict";
/* TM3.7: a day whose clocks go forward at midnight (Chile, Egypt, Lebanon, Cuba) is 23 hours long, and the old day
 * range arithmetic hid its first hour.
 *
 * `addDays` deliberately keeps the wall clock — a reminder at 09:00 stays at 09:00 when it is moved to tomorrow — which
 * is right for items and wrong for a range that ends at the next midnight: `addDays(dayStart(ms), 1)` on such a day is
 * 01:00 of the next day, so anything between 00:00 and 01:00 belonged to no day at all.
 *
 * The zone is forced by re-running this file under TZ=America/Santiago (the last test), the same way
 * `notes-calendar-hours.test.cjs` does it, so the ordinary run stays in the machine's own zone. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const SANTIAGO_RUN = process.env.TZ === "America/Santiago";
const text = (...args) => args.join(" ");
if (SANTIAGO_RUN) console.log(text("  (", process.env.TZ, ")"));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}
const DAY = 86400000;

test("nextDayStart is the next midnight, not the next 24 hours", () => {
  const arbitrary = new Date(2026, 4, 17, 13, 45).getTime();
  const next = C.nextDayStart(arbitrary);
  const d = new Date(next);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(C.localDateKey(next), C.localDateKey(new Date(2026, 4, 18, 0, 0).getTime()));
  // The same day read twice gives the same boundary.
  assert.equal(C.nextDayStart(arbitrary), next);
});

test("dayRange covers every millisecond of one civil day and nothing twice", () => {
  const ms = new Date(2026, 4, 17, 13, 45).getTime();
  const [from, to] = C.dayRange(ms);
  assert.equal(from, C.dayStart(ms));
  assert.equal(to, C.nextDayStart(from));
  assert.ok(to > from);
  assert.ok(from <= ms && ms < to, "the day contains the moment it was asked about");
  // Consecutive days tile without a gap or an overlap.
  assert.equal(C.nextDayStart(from), to);
  assert.equal(C.dayRange(to)[0], to, "the next day starts exactly where this one ends");
});

test("addDays keeps the wall clock: the reason a day range may not use it", () => {
  const nine = new Date(2026, 4, 17, 9, 0).getTime();
  const tomorrow = new Date(C.addDays(nine, 1));
  assert.equal(tomorrow.getHours(), 9, "items move by the clock (this must not change)");
  const midnight = C.dayStart(nine);
  // On an ordinary day the two agree, which is why the bug only showed one day a year.
  const viaAddDays = new Date(C.addDays(midnight, 1));
  assert.equal(viaAddDays.getHours(), new Date(C.nextDayStart(midnight)).getHours(), "ordinary days agree");
});

test("applyAgendaClosedDays and the pure helpers keep the calendar API exported", () => {
  assert.equal(typeof C.nextDayStart, "function");
  assert.equal(typeof C.dayRange, "function");
  assert.equal(typeof C.addDays, "function");
  assert.equal(typeof C.dayStart, "function");
});

if (!SANTIAGO_RUN) {
  console.log(`  (${passed} tests in the machine's own time zone)`);
  // One more run in the zone TM3.7 is about: Chile's clocks go forward at midnight on 2026-09-06.
  const out = spawnSync(process.execPath, [__filename], { env: { ...process.env, TZ: "America/Santiago" }, encoding: "utf8" });
  assert.ok(out.status === 0, "the Santiago run passes: " + (out.stderr || "").slice(-2000));
  assert.match(out.stdout, /\(\d+ tests in America\/Santiago\)/, "the Santiago cases ran");
  console.log(`  (${passed} + ${(out.stdout.match(/\((\d+) tests in America\/Santiago\)/) || [])[1] || "?"} tests with TZ=America/Santiago)`);
  console.log(`\nPASS notes-calendar-midnight-dst (${passed} tests)`);
  process.exit(0);
}

test("a midnight-DST day is 23 hours long and keeps its first hour", () => {
  // America/Santiago: 2026-09-06 00:00 -04:00 jumps straight to 01:00 -03:00.
  const day = C.parseYmd("2026-09-06").getTime();
  const [from, to] = C.dayRange(day);
  assert.equal((to - from) / 3600000, 23, "the day is 23 hours long");
  const next = new Date(to);
  assert.equal(next.getHours(), 0, "the day ends at the next midnight");
  assert.equal(C.localDateKey(to), "2026-09-07");
  // The bug this task is about.
  assert.equal(new Date(C.addDays(from, 1)).getHours(), 1, "addDays alone lands on 01:00 here");
});

test("an item in the first hour of that day belongs to the day", () => {
  const day = C.parseYmd("2026-09-06").getTime();
  const [from, to] = C.dayRange(day);
  const sevenAm = from + 8 * 3600000; // 08:00 later that day, still inside the range
  const item = C.makeItem({ id: "first-hour", summary: "First hour", start: { dateTime: new Date(from).toISOString() }, end: { dateTime: new Date(from + 30 * 60000).toISOString() }, x: { kind: "event", src: "manual" } });
  assert.equal(C.itemsInRange([item], from, to).length, 1);
  assert.equal(C.itemsInRange([item], from, C.addDays(from, 1)).length, 1, "the old 24-hour edge still holds it when it is the end");
  assert.ok(sevenAm < to, "08:00 is still inside the same civil day");
  assert.equal(C.dayHeat([item], day).count, 1, "Day heat counts it");
  // A range that stops at the old boundary loses the last hour, so the day heat must not be built that way.
  assert.equal(C.itemsInRange([item], from, to).length, 1);
});

test("the Agenda projection keeps the first hour of such a day", () => {
  const day = C.parseYmd("2026-09-06").getTime();
  const item = C.makeItem({ id: "early", summary: "Early", start: { dateTime: new Date(day).toISOString() }, end: { dateTime: new Date(day + 20 * 60000).toISOString() }, x: { kind: "event", src: "manual" } });
  const projection = C.agendaZenProjection([item], day + 3600000, 2, () => false, null, null, {});
  assert.equal(projection[0].date, "2026-09-06");
  assert.equal(projection[0].count, 1, "the item is in its own day, not lost");
  const buckets = C.agendaBuckets([item], day + 3600000, 2);
  assert.equal(buckets[0].count, 1);
  assert.equal(buckets[0].to, C.nextDayStart(buckets[0].from), "the bucket ends at midnight");
});

test("allDayOf finds an all-day item on that day", () => {
  const day = C.parseYmd("2026-09-06").getTime();
  const allDay = C.makeItem({ id: "allday", summary: "All day", start: { date: "2026-09-06" }, x: { kind: "event", src: "manual" } });
  assert.equal(C.allDayOf([allDay], day).length, 1);
});

test("workRange windows in a midnight-DST week do not skip a day", () => {
  const weekFrom = C.parseYmd("2026-09-06").getTime();
  const weekTo = C.nextDayStart(C.parseYmd("2026-09-13").getTime());
  const slots = C.freeSlots([], weekFrom, weekTo, 30, { work: { days: [1, 2, 3, 4, 5], startMin: 540, endMin: 1020 } });
  assert.ok(slots.length > 0, "the week still offers its working hours");
  const days = new Set(slots.map(([slotStart]) => C.localDateKey(slotStart)));
  assert.ok(days.has("2026-09-07") && days.has("2026-09-11"), "every working day of that week is offered");
  assert.equal(days.size, 5);
});

console.log(`\n(${passed + 4} tests in America/Santiago)`);
