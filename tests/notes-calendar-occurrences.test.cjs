"use strict";
/* T2.5e: stable recurring occurrence identities and explicit move scopes. */
process.env.TZ = "Europe/Warsaw";
const assert = require("node:assert/strict");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const at = (day, hour = 9, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
let passed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
const when = (ms) => ({ dateTime: new Date(ms).toISOString() });
const dayWhen = (ms) => ({ date: cal.ymd(new Date(ms)) });
const from = at(1), to = at(15);
const daily = cal.makeItem({
  id: "series-daily", summary: "Stand-up", start: when(at(2)), end: when(at(2, 9, 30)),
  recurrence: ["RRULE:FREQ=DAILY;COUNT=12"], x: { kind: "event", src: "manual" },
}, at(1));
const occurrences = () => cal.expandItem(daily, from, to);

function occurrence(day) { return occurrences().find((item) => new Date(cal.itemRange(item)[0]).getDate() === day); }
function occurrenceFrom(master, day) { return cal.expandItem(master, from, to).find((item) => Number(item.x.recurrenceId) === at(day)); }

test("expanded occurrence identity is tied to the original recurrence start, not its moved start", () => {
  const rows = occurrences();
  assert.equal(rows.length, 12);
  const fourth = rows.find((item) => Number(item.x.recurrenceId) === at(5));
  assert.ok(fourth);
  assert.equal(fourth.id, "series-daily@" + at(5));
  assert.equal(fourth.x.series, daily.id);
  const moved = cal.moveOccurrence(daily, fourth, when(at(5, 11)), "this", at(1));
  assert.ok(moved);
  const after = cal.expandItem(moved, from, to).find((item) => item.x.recurrenceId === fourth.x.recurrenceId);
  assert.equal(after.id, fourth.id);
  assert.equal(cal.itemRange(after)[0], at(5, 11));
  assert.equal(cal.reminderIdentity({ ...after, x: { ...after.x, kind: "reminder" } }).occurrenceId, fourth.id);
});

test("this occurrence stores a private override without changing its neighbours or the master", () => {
  const selected = occurrence(5), original = cal.itemRange(selected)[0];
  const moved = cal.moveOccurrence(daily, selected, when(at(5, 13, 15)), "this", at(1));
  assert.notEqual(moved, daily);
  assert.equal(cal.itemRange(daily)[0], at(2), "source master is not mutated");
  assert.equal(moved.x.recurrenceExceptions.length, 1);
  const expanded = cal.expandItem(moved, from, to);
  assert.equal(cal.itemRange(expanded.find((item) => item.x.recurrenceId === selected.x.recurrenceId))[0], at(5, 13, 15));
  assert.equal(cal.itemRange(expanded.find((item) => item.x.recurrenceId === String(at(4))))[0], at(4));
  assert.equal(cal.itemRange(expanded.find((item) => item.x.recurrenceId === String(at(6))))[0], at(6));
  assert.equal(original, at(5));
});

test("this and following uses one absolute offset from the selected recurrence identity", () => {
  const selected = occurrence(5);
  const moved = cal.moveOccurrence(daily, selected, when(at(5, 10)), "following", at(1));
  const expanded = cal.expandItem(moved, from, to);
  const get = (day) => expanded.find((item) => new Date(cal.itemRange(item)[0]).getDate() === day);
  assert.equal(cal.itemRange(get(4))[0], at(4));
  assert.equal(cal.itemRange(get(5))[0], at(5, 10));
  assert.equal(cal.itemRange(get(6))[0], at(6, 10));
  assert.equal(cal.itemRange(get(12))[0], at(12, 10));
});

test("entire-series move shifts all occurrences by the selected occurrence's requested delta", () => {
  const selected = occurrence(5);
  const moved = cal.moveOccurrence(daily, selected, when(at(5, 12, 30)), "series", at(1));
  const expanded = cal.expandItem(moved, from, to);
  assert.equal(cal.itemRange(expanded[0])[0], at(2, 12, 30));
  assert.equal(cal.itemRange(expanded[4])[0], at(6, 12, 30));
  assert.equal(moved.x.recurrenceExceptions[0].scope, "series");
});

test("a single-occurrence move preserves unrelated exceptions and an existing following shift", () => {
  const selected = occurrence(5);
  const base = cal.moveOccurrence(daily, selected, when(at(5, 10)), "following", at(1));
  const after = cal.expandItem(base, from, to);
  const sixth = after.find((item) => Number(item.x.recurrenceId) === at(6));
  const withOverride = cal.moveOccurrence(base, sixth, when(at(6, 12)), "this", at(1));
  const moved = cal.moveOccurrence(withOverride, occurrenceFrom(withOverride, 5), when(at(5, 11)), "this", at(1));
  const expanded = cal.expandItem(moved, from, to);
  const get = (day) => expanded.find((item) => Number(item.x.recurrenceId) === at(day));
  assert.equal(cal.itemRange(get(5))[0], at(5, 11));
  assert.equal(cal.itemRange(get(6))[0], at(6, 12), "unrelated one-off override is preserved");
  assert.equal(cal.itemRange(get(7))[0], at(7, 10), "following-series offset remains intact");
});

test("cancel one occurrence and restore it without changing the RRULE count", () => {
  const selected = occurrence(5);
  const cancelled = cal.cancelOccurrence(daily, selected, at(1));
  assert.equal(cal.expandItem(cancelled, from, to).length, 11);
  assert.equal(cal.expandItem(cancelled, from, to).some((item) => item.x.recurrenceId === selected.x.recurrenceId), false);
  const restored = cal.clearOccurrenceException(cancelled, selected, at(1));
  assert.equal(cal.expandItem(restored, from, to).length, 12);
  assert.equal(cal.expandItem(restored, from, to).some((item) => item.x.recurrenceId === selected.x.recurrenceId), true);
});

test("weekly BYDAY occurrences accept only generated dates and apply a following offset", () => {
  const start = at(4), master = cal.makeItem({ id: "series-weekly", summary: "Weekly", start: when(start), end: when(start + 45 * 60000),
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=7"], x: { kind: "event" } }, at(1));
  const rows = cal.expandItem(master, at(1), at(22));
  assert.equal(rows.length, 7);
  const selected = rows.find((item) => new Date(cal.itemRange(item)[0]).getDate() === 13);
  assert.ok(selected);
  const moved = cal.moveOccurrence(master, selected, when(at(13, 10)), "following", at(1));
  assert.ok(moved);
  const after = cal.expandItem(moved, at(1), at(22));
  assert.equal(new Date(cal.itemRange(after[3])[0]).getHours(), 9);
  assert.equal(new Date(cal.itemRange(after[4])[0]).getHours(), 10);
  assert.equal(new Date(cal.itemRange(after[6])[0]).getHours(), 10);
  const forgedAt = at(12);
  const forged = { ...selected, id: master.id + "@" + forgedAt, x: { ...selected.x, recurrenceId: String(forgedAt) } };
  assert.equal(cal.moveOccurrence(master, forged, when(at(12, 10)), "this", at(1)), null, "a weekday outside BYDAY is rejected");
});

test("monthly COUNT candidates remain movable when invalid calendar dates are skipped", () => {
  const master = cal.makeItem({ id: "series-monthly", summary: "Monthly", start: when(new Date(2026, 0, 31, 9).getTime()),
    end: when(new Date(2026, 0, 31, 9, 30).getTime()), recurrence: ["RRULE:FREQ=MONTHLY;COUNT=3"], x: { kind: "event" } }, at(1));
  const rows = cal.expandItem(master, new Date(2026, 0, 1).getTime(), new Date(2026, 7, 1).getTime());
  assert.deepEqual(rows.map((item) => item.start.dateTime.slice(0, 10)), ["2026-01-31", "2026-03-31", "2026-05-31"]);
  const moved = cal.moveOccurrence(master, rows[1], when(new Date(2026, 3, 2, 9).getTime()), "this", at(1));
  assert.ok(moved);
  const expanded = cal.expandItem(moved, new Date(2026, 0, 1).getTime(), new Date(2026, 7, 1).getTime());
  assert.equal(expanded.find((item) => item.x.recurrenceId === rows[1].x.recurrenceId).start.dateTime.slice(0, 10), "2026-04-02");
});

test("all-day occurrence movement is date-based across daylight-saving boundaries", () => {
  const master = cal.makeItem({ id: "series-all-day", summary: "All day", start: { date: "2026-03-27" }, end: { date: "2026-03-28" },
    recurrence: ["RRULE:FREQ=DAILY;COUNT=5"], x: { kind: "event" } }, at(1));
  const selected = cal.expandItem(master, cal.parseYmd("2026-03-25").getTime(), cal.parseYmd("2026-04-05").getTime()).find((item) => item.start.date === "2026-03-29");
  assert.ok(selected);
  const moved = cal.moveOccurrence(master, selected, { date: "2026-03-31" }, "following", at(1));
  const expanded = cal.expandItem(moved, cal.parseYmd("2026-03-25").getTime(), cal.parseYmd("2026-04-08").getTime());
  assert.equal(expanded.find((item) => item.x.recurrenceId === selected.x.recurrenceId).start.date, "2026-03-31");
  assert.equal(expanded.find((item) => item.start.date === "2026-04-01").end.date, "2026-04-02");
});

test("all-day multi-day occurrences retain calendar-day span across the spring DST gap", () => {
  const master = cal.makeItem({ id: "series-multiday-dst", summary: "Multi-day",
    start: { date: "2026-03-27" }, end: { date: "2026-03-29" },
    recurrence: ["RRULE:FREQ=DAILY;COUNT=4"], x: { kind: "event" } }, at(1));
  const start = cal.parseYmd("2026-03-25").getTime(), end = cal.parseYmd("2026-04-05").getTime();
  const second = cal.expandItem(master, start, end).find((item) => item.start.date === "2026-03-28");
  assert.ok(second);
  assert.equal(second.end.date, "2026-03-30");
  const moved = cal.moveOccurrence(master, second, { date: "2026-03-31" }, "this", at(1));
  const shifted = cal.expandItem(moved, start, end).find((item) => item.x.recurrenceId === second.x.recurrenceId);
  assert.equal(shifted.start.date, "2026-03-31");
  assert.equal(shifted.end.date, "2026-04-02", "the original two-day all-day span is preserved");
});

test("EXDATE dates suppress matching RRULE occurrences and survive Google-shaped serialization", () => {
  const compact = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const excluded = cal.makeItem({ ...daily, recurrence: [...daily.recurrence, "EXDATE:" + compact(at(4)) + "," + compact(at(8))] }, at(1));
  const expanded = cal.expandItem([excluded][0], from, to);
  assert.equal(expanded.some((item) => item.start.date === "2026-11-04"), false);
  assert.equal(expanded.length, 10);
  const back = cal.fromGoogle(JSON.parse(JSON.stringify(cal.toGoogle(excluded))));
  assert.deepEqual(back.recurrence, excluded.recurrence);
});

test("exception overrides round-trip, are bounded, de-duplicated, and malformed records are ignored", () => {
  const moved = cal.moveOccurrence(daily, occurrence(5), when(at(5, 10)), "this", at(1));
  const roundTrip = cal.fromGoogle(JSON.parse(JSON.stringify(cal.toGoogle(moved))));
  assert.deepEqual(roundTrip.x.recurrenceExceptions, moved.x.recurrenceExceptions);
  const damaged = cal.makeItem({ ...moved, x: { ...moved.x, recurrenceExceptions: [
    ...moved.x.recurrenceExceptions,
    { recurrenceId: { date: "2026-02-30" }, scope: "this", start: when(at(8)) },
    { recurrenceId: when(at(6)), scope: "following", shiftMs: "NaN" },
  ] } }, at(1));
  assert.equal(damaged.x.recurrenceExceptions.length, 1);
  const duplicate = cal.makeItem({ ...moved, x: { ...moved.x, recurrenceExceptions: [
    ...moved.x.recurrenceExceptions,
    { ...moved.x.recurrenceExceptions[0], start: when(at(5, 14)), end: when(at(5, 14, 30)) },
  ] } }, at(1));
  assert.equal(duplicate.x.recurrenceExceptions.length, 1);
  assert.equal(cal.expandItem(duplicate, from, to).find((item) => item.x.recurrenceId === String(at(5))).start.dateTime, when(at(5, 14)).dateTime);
});

test("following scope replaces later move overrides but preserves earlier exceptions", () => {
  const first = cal.moveOccurrence(daily, occurrence(3), when(at(3, 10)), "this", at(1));
  const second = cal.moveOccurrence(first, occurrenceFrom(first, 8), when(at(8, 11)), "this", at(1));
  const moved = cal.moveOccurrence(second, occurrenceFrom(second, 6), when(at(6, 12)), "following", at(1));
  const expanded = cal.expandItem(moved, from, to);
  const get = (day) => expanded.find((item) => Number(item.x.recurrenceId) === at(day));
  assert.equal(cal.itemRange(get(3))[0], at(3, 10), "an earlier exception is retained");
  assert.equal(cal.itemRange(get(6))[0], at(6, 12));
  assert.equal(cal.itemRange(get(8))[0], at(8, 14), "later one-off override keeps its relative offset after the following move");
  assert.equal(cal.itemRange(get(10))[0], at(10, 12));
});

test("following and series moves preserve later split scopes and cancelled dates", () => {
  const split = cal.moveOccurrence(daily, occurrence(8), when(at(8, 11)), "following", at(1));
  const movedFollowing = cal.moveOccurrence(split, occurrenceFrom(split, 5), when(at(5, 10)), "following", at(1));
  const followingRows = cal.expandItem(movedFollowing, from, to);
  const day8 = followingRows.find((item) => Number(item.x.recurrenceId) === at(8));
  assert.equal(cal.itemRange(day8)[0], at(8, 12), "a later split keeps its relative offset after an earlier following move");
  const movedSeries = cal.moveOccurrence(split, occurrenceFrom(split, 5), when(at(5, 12)), "series", at(1));
  const seriesRows = cal.expandItem(movedSeries, from, to);
  assert.equal(cal.itemRange(seriesRows.find((item) => Number(item.x.recurrenceId) === at(2)))[0], at(2, 12));
  assert.equal(cal.itemRange(seriesRows.find((item) => Number(item.x.recurrenceId) === at(8)))[0], at(8, 14), "the later split remains offset after a whole-series move");

  const cancelled = cal.cancelOccurrence(daily, occurrence(8), at(1));
  const withShift = cal.moveOccurrence(cancelled, occurrenceFrom(cancelled, 5), when(at(5, 10)), "following", at(1));
  assert.equal(cal.expandItem(withShift, from, to).some((item) => Number(item.x.recurrenceId) === at(8)), false, "following moves do not resurrect cancelled occurrences");
});

test("series scope shifts pre-existing one-off overrides by the same visible delta", () => {
  const oneOff = cal.moveOccurrence(daily, occurrence(4), when(at(4, 11)), "this", at(1));
  const selected = occurrenceFrom(oneOff, 6);
  const moved = cal.moveOccurrence(oneOff, selected, when(at(6, 13)), "series", at(1));
  const expanded = cal.expandItem(moved, from, to);
  const get = (day) => expanded.find((item) => Number(item.x.recurrenceId) === at(day));
  assert.equal(cal.itemRange(get(2))[0], at(2, 13));
  assert.equal(cal.itemRange(get(4))[0], at(4, 15), "prior one-off override keeps its relative offset");
  assert.equal(cal.itemRange(get(8))[0], at(8, 13));
});

test("moveOccurrence rejects mismatched series, invalid targets and unconfirmed scopes", () => {
  const selected = occurrence(5);
  assert.equal(cal.moveOccurrence(daily, selected, when(at(5, 10)), "all", at(1)), null);
  assert.equal(cal.moveOccurrence(daily, { ...selected, x: { ...selected.x, series: "another" } }, when(at(5, 10)), "this", at(1)), null);
  assert.equal(cal.moveOccurrence(daily, selected, { date: "2026-02-30" }, "this", at(1)), null);
  assert.equal(cal.moveOccurrence(daily, selected, { date: "2026-11-05" }, "this", at(1)), null, "timed series cannot become all-day");
  assert.equal(cal.moveOccurrence(daily, selected, when(at(5, 10)), "", at(1)), null);
  const forgedAt = at(5) + 12345;
  const forged = { ...selected, id: daily.id + "@" + forgedAt, x: { ...selected.x, recurrenceId: String(forgedAt) } };
  assert.equal(cal.moveOccurrence(daily, forged, when(at(5, 10)), "this", at(1)), null, "an ID-shaped but non-RRULE timestamp is rejected");
  assert.equal(cal.cancelOccurrence(daily, forged, at(1)), null);
  const beyondCountAt = at(20);
  const beyondCount = { ...selected, id: daily.id + "@" + beyondCountAt, x: { ...selected.x, recurrenceId: String(beyondCountAt) } };
  assert.equal(cal.moveOccurrence(daily, beyondCount, when(at(20, 10)), "this", at(1)), null, "a candidate beyond RRULE COUNT is rejected");
});

for (const [name, fn] of queue) {
  try { fn(); passed++; }
  catch (error) { console.error("FAIL", name, error); process.exitCode = 1; }
}
if (!process.exitCode) console.log(`calendar recurring occurrence tests passed (${passed})`);
