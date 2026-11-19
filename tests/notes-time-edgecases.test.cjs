"use strict";
process.env.TZ = "America/New_York";
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const event = (id, start, end, extra = {}) => C.makeItem({ id, summary: id, start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() }, x: { kind: "event", ...extra } }, start - 86400000);
const reminder = (id, start, recurrence = []) => C.makeItem({ id, summary: "Same reminder", start: { dateTime: new Date(start).toISOString() }, recurrence, x: { kind: "reminder", src: "manual" } }, start - 86400000);
const project = (item, at) => C.agendaZenProjection([item], at, 1)[0];
(async () => {
  // A nonexistent 02:00 in New York resolves forward to the first real minute (03:00).
  const gap = C.zonedDateTimeToMs("2026-03-08", "02:00", "America/New_York");
  assert.equal(gap, Date.parse("2026-03-08T07:00:00Z"));
  assert.equal(C.composeCalendarItem({ kind: "event", summary: "Missing hour", startDate: "2026-03-08", endDate: "2026-03-08", startTime: "02:00", endTime: "03:00", tz: "America/New_York" }, gap), null, "the nonexistent 02:00–03:00 interval cannot silently become a zero-duration event");
  const spring = event("spring", gap, gap + 30 * 60000);
  let bucket = project(spring, gap - 1); assert.equal(bucket.date, "2026-03-08");
  assert.equal(bucket.items[0].label, "03:00–03:30  spring"); assert.equal(bucket.items[0].ended, false);
  assert.equal(project(spring, gap + 30 * 60000).items[0].ended, true);
  const fallDay = C.parseYmd("2026-11-01").getTime(); assert.equal(C.addDays(fallDay, 1) - fallDay, 25 * 3600000);
  const first130 = Date.parse("2026-11-01T05:30:00Z"), second130 = Date.parse("2026-11-01T06:30:00Z");
  const fall = event("fall", first130, second130);
  bucket = project(fall, first130); assert.equal(bucket.date, "2026-11-01");
  assert.equal(bucket.items[0].label, "01:30–01:30  fall"); assert.equal(bucket.items[0].ended, false);
  assert.equal(project(fall, second130).items[0].ended, true);
  // Item zone is independent of the viewer's local date and clock.
  const warsawStart = C.zonedDateTimeToMs("2026-04-03", "00:30", "Europe/Warsaw");
  const zoned = event("warsaw", warsawStart, warsawStart + 3600000, { tz: "Europe/Warsaw" });
  bucket = project(zoned, warsawStart); assert.equal(bucket.date, "2026-04-02");
  assert.equal(bucket.items[0].label, "18:30–19:30  warsaw"); assert.equal(bucket.items[0].ended, false);
  assert.equal(project(zoned, warsawStart + 3600000).items[0].ended, true);

  const at = new Date(2026, 3, 3, 10).getTime(), a = reminder("first", at), b = reminder("second", at);
  const both = C.agendaZenProjection([a, b], at, 1)[0].items;
  assert.equal(both.length, 2); assert.notEqual(both[0].key, both[1].key);
  assert.equal(C.agendaZenProjection([b], at, 1)[0].items[0].key, both.find((x) => x.itemId === "second").key, "deleting a twin leaves the other's identity stable");
  const series = reminder("daily", at, ["RRULE:FREQ=DAILY;COUNT=3"]), occurrences = C.expandItem(series, C.dayStart(at), C.addDays(C.dayStart(at), 3));
  const io = { join: (...parts) => parts.join("/"), exists: async () => false, readUTF8: async () => { throw Error("missing"); }, writeUTF8: async () => {} };
  const history = C.createReminderHistoryStore({ io, getDir: () => "/n", now: () => at, setTimer: () => 1, clearTimer() {} }); await history.open();
  for (const [index, action] of [[0, "done"], [1, "dismissed"]]) { const id = C.reminderIdentity(occurrences[index]); history.append({ ...id, action, at }); }
  const projected = C.agendaZenProjection([series], at, 3, (item) => { const id = C.reminderIdentity(item); return ["done", "dismissed"].includes(history.stateFor(id.itemId, id.occurrenceId)); });
  assert.deepEqual(projected.map((day) => day.count), [0, 0, 1], "lifecycle applies only to its recurring occurrence");

  for (const fmt of C.DATE_FORMATS) {
    assert.equal(C.parseDateKeyText("03-04-2026", fmt), "2026-04-03", fmt + " accepts day-first hyphen dates");
    assert.equal(C.parseDateKeyText("03/04/2026", fmt), fmt === "DD/MM/YYYY" ? "2026-04-03" : "2026-03-04", fmt + " follows selected slash format or existing fallback order");
    assert.equal(C.localDateKey(C.parseDateText("03-04-2026", at)), "2026-04-03", "note text is deliberately day-first regardless of display preference");
  }

  const now = new Date(2026, 0, 1, 12).getTime(), items = Array.from({ length: 5000 }, (_, i) => reminder("perf-" + i, now + (i % 20) * 60000, ["RRULE:FREQ=DAILY"]));
  const t = performance.now(), policies = C.prepareAgendaWindows(items, () => ({ enabled: true, leadDays: 0, tailDays: 0 }));
  const days = C.agendaZenProjection(items, now, 31, () => false, null, policies); C.nextAgendaVisibilityBoundary(items, now, 31, null, policies);
  const elapsed = performance.now() - t; assert.equal(days.length, 31); assert.equal(days[0].count, 5000); assert.equal(days[30].count, 5000);
  assert.ok(elapsed < 20000, `31-day 5000-series Agenda budget: ${elapsed.toFixed(1)}ms`); console.log(`31-day 5000-series Agenda: ${elapsed.toFixed(1)}ms (budget 20000ms)`);

  const initial = new Date(2026, 0, 20, 9).getTime(), target = new Date(2026, 2, 15, 9).getTime();
  const master = reminder("long-move", initial, ["RRULE:FREQ=WEEKLY;COUNT=12"]);
  const original = C.expandItem(master, C.parseYmd("2026-01-01").getTime(), C.parseYmd("2026-02-01").getTime())[0];
  const moved = C.moveOccurrence(master, original, { dateTime: new Date(target).toISOString() }, "this", initial - 1); assert.ok(moved);
  const jan = C.expandItem(moved, C.parseYmd("2026-01-01").getTime(), C.parseYmd("2026-02-01").getTime());
  const feb = C.expandItem(moved, C.parseYmd("2026-02-01").getTime(), C.parseYmd("2026-03-01").getTime());
  const mar = C.expandItem(moved, C.parseYmd("2026-03-01").getTime(), C.parseYmd("2026-04-01").getTime());
  assert.ok(!jan.some((x) => x.id === original.id) && !feb.some((x) => x.id === original.id));
  assert.equal(C.itemRange(mar.find((x) => x.id === original.id))[0], target, "moved occurrence is found weeks away under its original identity");
  console.log("time edge cases passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
