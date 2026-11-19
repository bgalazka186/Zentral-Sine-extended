"use strict";
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { scaleBudget } = require("./helpers/perf-budget.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
(async () => {
  for (const n of [500, 2000]) {
    let now = new Date(2026, 10, 1, 12).getTime(); const files = new Map();
    const io = { join: (...p) => p.join("/"), exists: async p => files.has(p), readUTF8: async p => { if (!files.has(p)) throw Error("missing"); return files.get(p); }, writeUTF8: async (p, v) => files.set(p, v) };
    const items = C.createItemStore({ io, getDir: () => "/n", now: () => now, setTimer: () => 1, clearTimer() {} }); await items.open();
    for (let i = 0; i < n; i++) items.upsert({ id: "item-" + i, summary: "Reminder " + i, start: { dateTime: new Date(now + 600000).toISOString() }, recurrence: ["RRULE:FREQ=DAILY"], x: { kind: "reminder", src: "manual" } });
    now = C.addDays(now, 7);
    const host = createFakeZen(), digests = [];
    const scheduler = host.window.__zentralNotesTestSeam.core.createReminderScheduler({ store: { items, list: () => [], get: () => null, on: () => () => {} }, now: () => now, setTimer: () => 1, clearTimer() {}, onDue() {}, onDigest: batch => digests.push(batch) });
    const t = performance.now(); await scheduler.start(); const elapsed = performance.now() - t;
    const ceiling = scaleBudget(n === 500 ? 12000 : 45000);
    assert.equal(digests.length, 1); assert.ok(digests[0].length >= n * 6); assert.ok(elapsed < ceiling, `digest ${n} took ${elapsed.toFixed(0)}ms (ceiling ${ceiling.toFixed(0)}ms)`);
    console.log(`digest7_${n}: ${elapsed.toFixed(1)} ms, ${digests[0].length} occurrences`);
    scheduler.destroy(); await host.destroy();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
