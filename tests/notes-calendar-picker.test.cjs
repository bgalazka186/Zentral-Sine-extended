"use strict";
/* OW-09: day-level calendar heat, occurrence counting and the month-picker cell model. */
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const day = C.parseYmd("2026-11-18").getTime();
const yesterday = C.addDays(day, -1);
const next = C.addDays(day, 1);
const at = (base, hour, minute = 0) => base + hour * 3600000 + minute * 60000;
const event = (id, start, end, category = "") => ({
  id, summary: id,
  start: { dateTime: new Date(start).toISOString() },
  end: { dateTime: new Date(end).toISOString() },
  x: { kind: "event", category },
});
const reminder = (id, start, category = "") => ({
  id, summary: id, start: { dateTime: new Date(start).toISOString() },
  x: { kind: "reminder", category },
});
const items = [
  event("previous-day", at(yesterday, 23), at(day, 1), "Personal"),
  event("ends-at-midnight", at(yesterday, 22), day, "Work"),
  event("work-one", at(day, 9), at(day, 10), "Work"),
  event("work-two", at(day, 10), at(day, 11), "Work"),
  event("personal-two", at(day, 11), at(day, 12), "Personal"),
  reminder("ping", at(day, 15, 30), "Personal"),
  event("next-day", at(next, 0), at(next, 1), "Work"),
  { ...event("cancelled", at(day, 12), at(day, 13), "Work"), status: "cancelled" },
];

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("dayHeat counts items touching the local day, including overnight events and reminders, but not cancelled items", () => {
  const heat = C.dayHeat(items, day);
  assert.deepEqual(heat, { day, count: 5, level: 3, dominantCategory: "Personal" });
  assert.equal(C.dayHeat(items, C.localDateKey(next)).count, 1, "an event ending at midnight does not leak into the next day");
});

test("dayHeat uses the 0 / 1 / 2-3 / 4+ intensity steps and a stable category tie-break", () => {
  assert.deepEqual(C.dayHeat([], day), { day, count: 0, level: 0, dominantCategory: "" });
  assert.equal(C.dayHeat([reminder("one", at(day, 8))], day).level, 1);
  assert.equal(C.dayHeat([reminder("a", at(day, 8)), reminder("b", at(day, 9)), reminder("c", at(day, 10))], day).level, 2);
  const tie = C.dayHeat([reminder("z", at(day, 8), "Zulu"), reminder("a", at(day, 9), "Alpha")], day);
  assert.equal(tie.dominantCategory, "Alpha");
});

test("pickerMonth carries heat and dominant category while retaining the date-picker flags", () => {
  const rows = C.pickerMonth(2026, 10, { weekStart: 1, now: at(day, 10), selected: day, items });
  const cell = rows.flat().find((entry) => entry.day === day);
  assert.deepEqual(cell, {
    day, date: 18, inMonth: true, today: true, selected: true,
    count: 5, level: 3, dominantCategory: "Personal",
  });
  assert.equal(rows.length, 6);
  assert.ok(rows.every((week) => week.length === 7));
});

test("cleanCalendarPicker normalizes the automatic and manual modes, thresholds and colour mode", () => {
  assert.deepEqual(C.cleanCalendarPicker(), { mode: "auto", minWidth: 470, minHeight: 360, colorMode: "count" });
  assert.deepEqual(C.cleanCalendarPicker({ mode: "picker", minWidth: 900, minHeight: 100, colorMode: "category" }),
    { mode: "picker", minWidth: 720, minHeight: 240, colorMode: "category" });
  assert.deepEqual(C.cleanCalendarPicker({ mode: "month", minWidth: "no", minHeight: 520, colorMode: "other" }),
    { mode: "month", minWidth: 470, minHeight: 520, colorMode: "count" });
});

console.log(passed + " calendar picker tests passed");
