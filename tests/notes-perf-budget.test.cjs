"use strict";
// Baselines deliberately have CI headroom; PF2.x owns tightening the affected ceilings.
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const BUDGET_MS = Object.freeze({
  projection4_500: 600, projection31_500: 2500, projection4_2000: 1200, projection31_2000: 9000,
  expand31_500: 1600, expand90_500: 5000, expand31_2000: 7000, expand90_2000: 18000,
  scheduler500: 6500, scheduler2000: 25000, schedulerCached500: 4000, schedulerCached2000: 15000, history45000: 500,
});
const now = Date.parse("2026-11-13T12:00:00Z"), start = C.addDays(C.dayStart(now), 1) + 12 * 3600000;
const measure = (name, fn) => {
  const at = performance.now(), result = fn(), elapsed = performance.now() - at;
  console.log(`${name}: ${elapsed.toFixed(1)} ms (ceiling ${BUDGET_MS[name]} ms)`);
  assert.ok(elapsed < BUDGET_MS[name], `${name} exceeded baseline ceiling: ${elapsed.toFixed(1)} ms`);
  return result;
};
const makeItems = (n) => Array.from({ length: n }, (_, i) => C.makeItem({
  id: `reminder-${i}`, summary: `Reminder ${i}`, start: { dateTime: new Date(start + (i % 20) * 60000).toISOString() }, recurrence: ["RRULE:FREQ=DAILY"],
  x: { kind: "reminder", src: "manual", category: i % 2 ? "Work" : "Home", ...(i % 10 === 0 ? { recurrenceExceptions: [{ scope: "this", cancelled: true, recurrenceId: { dateTime: new Date(start + (i % 20) * 60000 + 2 * 86400000).toISOString() } }] } : {}) },
}, now));
(async () => {
  const history = C.createReminderHistoryStore({ io: { join: (...x) => x.join("/"), readUTF8: async () => { throw new Error("not found"); }, exists: async () => false, writeUTF8: async () => {} }, getDir: () => "/notes", now: () => now, setTimer: () => 1, clearTimer() {} });
  await history.open();
  for (let i = 0; i < 5000; i++) assert.ok(history.append({ id: `record-${i}`, itemId: `historic-${i}`, occurrenceId: `occ-${i}`, action: "alerted", stage: "due", at: now - i }));
  assert.equal(history.storageState().count, 5000);
  measure("history45000", () => { for (let i = 0; i < 45000; i++) history.list({ itemId: `reminder-${i % 500}`, occurrenceId: `occ-${i}` }); });
  const host = createFakeZen(), schedulerFactory = host.window.__zentralNotesTestSeam.core.createReminderScheduler;
  for (const n of [500, 2000]) {
    const items = makeItems(n); assert.equal(items.filter((item) => item.x.recurrenceExceptions.length).length, n / 10);
    const isDone = (item) => { const id = C.reminderIdentity(item); const state = id && history.stateFor(id.itemId, id.occurrenceId); return state === "done" || state === "dismissed"; };
    const category = (name) => name === "Work" ? { agenda: { leadDays: 1 }, notify: { due: { enabled: true } } } : { agenda: {}, notify: { due: { enabled: true } } };
    const getWindow = (item) => C.resolveAgendaWindow(item, category(item.x.category).agenda, null, { enabled: true });
    for (const days of [4, 31]) {
      const projection = measure(`projection${days}_${n}`, () => C.agendaZenProjection(items, now, days, isDone, getWindow));
      assert.equal(projection.length, days); assert.ok(projection.some((day) => day.items.length));
    }
    for (const days of [31, 90]) {
      const expanded = measure(`expand${days}_${n}`, () => C.expandRange(items, C.dayStart(now), C.addDays(C.dayStart(now), days)));
      assert.ok(expanded.length > n * (days - 3));
    }
    let historyCalls = 0, fired = 0;
    const countedHistory = { stateFor: (...args) => history.stateFor(...args), list: (...args) => { historyCalls++; return history.list(...args); } };
    const fakeStore = { items: { list: () => items, history: countedHistory, category, on: () => () => {} }, list: () => [], on: () => () => {} };
    const scheduler = schedulerFactory({ store: fakeStore, now: () => now, setTimer: () => 1, clearTimer() {}, onDue(list) { fired += list.length; } });
    measure(`scheduler${n}`, () => scheduler.start()); assert.ok(scheduler.pending());
    assert.ok(historyCalls > n * 80, `production scheduler must inspect the 90-day occurrence window: ${historyCalls}`);
    measure(`schedulerCached${n}`, () => scheduler.reschedule());
    assert.ok(historyCalls > n * 160, "cached pass still checks every occurrence's current history");
    assert.equal(fired, 0); scheduler.destroy();
  }
  await host.destroy();
})().catch((error) => { console.error(error); process.exitCode = 1; });
