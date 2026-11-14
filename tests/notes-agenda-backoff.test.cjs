"use strict";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
let clock = new Date(2026, 10, 13, 9).getTime(), nextId = 0, ops = 0;
const timers = new Map(), warnings = [];
const item = C.makeItem({ id: "loop", summary: "loop", start: { dateTime: new Date(clock + 3600000).toISOString() }, x: { kind: "reminder" } }, clock);
const controller = C.createZenAgenda({
  api: { ensureRoot: () => true, list: () => [], add: () => { ops++; return false; }, reorder() {} }, getItems: () => [item], now: () => clock,
  setTimer: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id; }, clearTimer: (id) => timers.delete(id), warn: (error) => warnings.push(String(error)),
});
controller.runNow(); controller.runNow(); controller.runNow(); const stoppedAt = ops;
assert.ok(warnings.some((text) => /back.?off/i.test(text)), "warn about repeated reconciliation");
assert.ok([...timers.values()].some((t) => t.ms === 5000), "retry is deferred for five seconds");
controller.runNow(); controller.schedule(1); assert.equal(ops, stoppedAt, "attempts while backed off do no work");
clock += 5000; controller.runNow(); assert.ok(ops > stoppedAt, "retry resumes after five seconds");
controller.invalidate(); const old = ops; controller.runNow(); assert.ok(ops > old, "a source change clears the guard immediately");
controller.destroy(); assert.equal(timers.size, 0); console.log("Agenda loop back-off passed");
