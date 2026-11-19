"use strict";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const now = Date.parse("2026-11-13T12:00:00Z");
let seed = 7491;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
const randomPolicy = () => ({ ...(rnd(3) ? {} : { enabled: !!rnd(2) }), ...(rnd(3) ? {} : { leadDays: rnd(5) }), ...(rnd(3) ? {} : { tailDays: rnd(5) }) });
for (let round = 0; round < 30; round++) {
  const global = randomPolicy(), categories = [randomPolicy(), randomPolicy()], notes = [randomPolicy(), randomPolicy()];
  const items = Array.from({ length: 18 }, (_, i) => C.makeItem({ id: `item-${i}`, summary: `Item ${i}`, start: { dateTime: new Date(now + (rnd(18) - 5) * 86400000).toISOString() }, ...(rnd(3) ? {} : { recurrence: ["RRULE:FREQ=DAILY;COUNT=25"] }), x: { kind: "reminder", src: "manual", category: `cat-${rnd(2)}`, noteId: `note-${rnd(2)}`, agendaWindow: randomPolicy() } }, now));
  const getWindow = (item) => C.resolveAgendaWindow(item, categories[Number(item.x.category.slice(-1))], notes[Number(item.x.noteId.slice(-1))], global);
  const expected = C.agendaZenProjection(items, now, 8, () => false, getWindow);
  const expectedBoundary = C.nextAgendaVisibilityBoundary(items, now, 8, getWindow);
  let calls = 0; const map = C.prepareAgendaWindows(items, (item) => { calls++; return getWindow(item); });
  assert.equal(calls, items.length, "each master policy resolved once");
  assert.deepEqual(C.agendaZenProjection(items, now, 8, () => false, getWindow, map), expected);
  assert.equal(C.nextAgendaVisibilityBoundary(items, now, 8, getWindow, map), expectedBoundary);
  assert.equal(calls, items.length, "projection and boundary reuse prepared policies");
}
console.log("prepared Agenda policies match baseline random fixtures");
{
  let calls = 0, enabled = true;
  const master = C.makeItem({ id: "recurring", summary: "Recurring", start: { dateTime: new Date(now).toISOString() }, recurrence: ["RRULE:FREQ=DAILY;COUNT=10"], x: { kind: "reminder", src: "manual" } }, now);
  const api = { ensureRoot: () => true, list: () => [], add: () => true, reorder() {}, removeAll() {} };
  const controller = C.createZenAgenda({ api, getItems: () => [master], now: () => now, getDays: () => 4, getWindowIsMasterPolicy: true, getWindow() { calls++; return { enabled }; }, setTimer: () => 1, clearTimer() {} });
  try {
    assert.equal(controller.runNow().length, 4); assert.equal(calls, 1, "controller uses the same resolved master policy for projection and boundary");
    enabled = false; assert.equal(controller.runNow().length, 0); assert.equal(calls, 2, "later policy changes cannot use stale prior-run data");
  } finally { controller.destroy(); }
}
