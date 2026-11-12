"use strict";
/* Date display formats, local date keys, agenda buckets, blank date-note rule, LWW (roadmap T2.14-T2.17). */
const assert = require("node:assert/strict");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

test("formatDateKey renders every format and never changes the key", () => {
  assert.equal(cal.formatDateKey("2026-11-14", "DD-MM-YYYY"), "14-11-2026");
  assert.equal(cal.formatDateKey("2026-11-14", "YYYY-MM-DD"), "2026-11-14");
  assert.equal(cal.formatDateKey("2026-11-14", "MM/DD/YYYY"), "11/14/2026");
  assert.equal(cal.formatDateKey("2026-11-14", "DD.MM.YYYY"), "14.11.2026");
  assert.equal(cal.formatDateKey("2026-11-14", "DD/MM/YYYY"), "14/11/2026");
  assert.match(cal.formatDateKey("2026-11-14", "long", "en-US"), /November 14, 2026/);
  assert.equal(cal.formatDateKey("2026-11-14", "nonsense"), "14-11-2026");
  assert.equal(cal.formatDateKey("2026-11-14"), "14-11-2026");
});
test("formatDateKey rejects invalid keys and calendar dates", () => {
  for (const bad of ["", null, undefined, "14-11-2026", "2026-13-01", "2026-02-30", "2026-1-1", "abc"]) assert.equal(cal.formatDateKey(bad, "YYYY-MM-DD"), "");
  assert.equal(cal.formatDateKey("2028-02-29", "DD-MM-YYYY"), "29-02-2028");
  assert.equal(cal.formatDateKey("2027-02-29", "DD-MM-YYYY"), "");
});
test("dateNoteTitle separates display title from the key", () => {
  assert.equal(cal.dateNoteTitle("2026-11-14", "DD-MM-YYYY"), "Reminders for 14-11-2026");
  assert.equal(cal.dateNoteTitle("2026-11-14", "MM/DD/YYYY", "Day "), "Day 11/14/2026");
  assert.equal(cal.dateNoteTitle("bad", "DD-MM-YYYY"), "");
});
test("cleanDateFormat falls back to the default", () => {
  assert.equal(cal.cleanDateFormat("YYYY-MM-DD"), "YYYY-MM-DD");
  assert.equal(cal.cleanDateFormat("x"), "DD-MM-YYYY");
  assert.equal(cal.cleanDateFormat(undefined), cal.DEFAULT_DATE_FORMAT);
});
test("localDateKey uses local fields, not UTC, near midnight", () => {
  assert.equal(cal.localDateKey(new Date(2026, 10, 14, 0, 5).getTime()), "2026-11-14");
  assert.equal(cal.localDateKey(new Date(2026, 10, 14, 23, 55).getTime()), "2026-11-14");
  assert.equal(cal.localDateKey(NaN), "");
  assert.equal(cal.localDateKey(undefined), "");
});
test("snoozeDays keeps wall-clock time across month ends and DST", () => {
  const t = new Date(2026, 9, 31, 9, 30).getTime();
  const r = new Date(cal.snoozeDays(t, 1));
  assert.deepEqual([r.getMonth(), r.getDate(), r.getHours(), r.getMinutes()], [10, 1, 9, 30]);
  const w = new Date(cal.snoozeDays(new Date(2026, 2, 28, 8, 0).getTime(), 3));
  assert.deepEqual([w.getDate(), w.getHours()], [31, 8]);
  assert.equal(cal.snoozeDays(t, 0), t);
  assert.equal(cal.snoozeDays(t, "x"), t);
});
const now = new Date(2026, 10, 12, 10, 0).getTime();
const mk = (summary, y, m, d, h, extra = {}) => cal.makeItem({ summary, start: { dateTime: new Date(y, m, d, h).toISOString() }, x: { kind: "reminder", src: "manual", ...extra } }, now);
test("agendaBuckets counts T..T+3 and skips done and cancelled items", () => {
  const items = [mk("a", 2026, 10, 12, 15), mk("b", 2026, 10, 12, 16), mk("c", 2026, 10, 13, 9), mk("d", 2026, 10, 15, 9), mk("e", 2026, 10, 16, 9)];
  const cancelled = mk("x", 2026, 10, 12, 18); cancelled.status = "cancelled"; items.push(cancelled);
  const b = cal.agendaBuckets(items, now, 4, (it) => it.summary === "b");
  assert.deepEqual(b.map((x) => x.label), ["Today", "Tomorrow", "Day 2", "Day 3"]);
  assert.deepEqual(b.map((x) => x.key), ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  assert.deepEqual(b.map((x) => x.count), [1, 1, 0, 1]);
  assert.equal(b[0].items[0].summary, "a");
});
test("agendaBuckets clamps the day count and handles an empty list", () => {
  assert.equal(cal.agendaBuckets([], now, 0).length, 4);
  assert.equal(cal.agendaBuckets([], now, 2).length, 2);
  assert.equal(cal.agendaBuckets([], now, 999).length, 31);
  assert.equal(cal.agendaBuckets([], now, 6)[5].label, "Day 5");
});
test("agendaBuckets expands recurring items into each day", () => {
  const it = cal.makeItem({ summary: "daily", start: { dateTime: new Date(2026, 10, 1, 8).toISOString() }, recurrence: ["RRULE:FREQ=DAILY"], x: { kind: "reminder", src: "manual" } }, now);
  assert.deepEqual(cal.agendaBuckets([it], now).map((x) => x.count), [1, 1, 1, 1]);
});
test("isBlankDateNote purges only untouched generated notes", () => {
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday\n\n" }, "2026-11-14"), true);
  assert.equal(cal.isBlankDateNote({ body: "" }, "2026-11-14"), true);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday\r\n" }, "2026-11-14"), true);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday\n\ntext" }, "2026-11-14"), false);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday" }, "2026-11-15"), false);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday", tags: ["x"] }, "2026-11-14"), false);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday", files: ["a.png"] }, "2026-11-14"), false);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday", touched: true }, "2026-11-14"), false);
  assert.equal(cal.isBlankDateNote(null, "2026-11-14"), false);
  assert.equal(cal.isBlankDateNote({ body: "# 2026-11-14 Saturday" }), true);
  assert.equal(cal.isBlankDateNote({ body: "# Shopping" }), false);
});
test("lwwPick prefers newer updated, then higher rev, then remote", () => {
  const a = { id: 1, updated: 10, rev: 1 }, b = { id: 2, updated: 20, rev: 0 };
  assert.equal(cal.lwwPick(a, b), b);
  assert.equal(cal.lwwPick(b, a), b);
  assert.equal(cal.lwwPick({ updated: 5, rev: 2 }, { updated: 5, rev: 1 }).rev, 2);
  const l = { updated: 5, rev: 1 }, r = { updated: 5, rev: 1 };
  assert.equal(cal.lwwPick(l, r), r);
  assert.equal(cal.lwwPick(null, r), r);
  assert.equal(cal.lwwPick(l, null), l);
  assert.equal(cal.lwwPick(null, null), null);
});
console.log(passed + " passed");
