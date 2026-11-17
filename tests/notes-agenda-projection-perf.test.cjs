"use strict";
/* F0.15: the time budget of the Agenda projection, on its own.
 *
 * This file's name ends in `-perf`, so `run-all.cjs` runs it alone instead of beside three other test files. It used to
 * live in `tests/notes-agenda-projection.test.cjs`, where it measured the other workers' work as much as its own and
 * failed about once in five full runs (75.6 ms against a 55.7 ms ceiling). The shape it projects is the one the
 * behaviour test uses, so the two files still describe the same input.
 */
const assert = require("node:assert/strict");
const { scaleBudget } = require("./helpers/perf-budget.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const now = new Date(2026, 10, 13, 9, 0).getTime();
const make = (id, summary, start) => C.makeItem({ id, summary, start, x: { kind: "reminder", src: "manual" } }, now);

const ITEMS = 5000;
const items = Array.from({ length: ITEMS }, (_, i) => make("bulk-" + i, "Item " + i, { dateTime: new Date(new Date(2026, 10, 13, 9, 0).getTime() + i * 1000).toISOString() }));

// Warm the shapes and the language table once, so the number below is the projection and not the first-call setup.
C.agendaZenProjection(items.slice(0, 200), now, 4);

let passed = 0;
(function () {
  const start = process.hrtime.bigint();
  const result = C.agendaZenProjection(items, now, 4);
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(result[0].count, ITEMS, "the projection is the same one the behaviour test checks");
  const ceiling = scaleBudget(50);
  assert.ok(elapsed < ceiling, `${ITEMS} item projection took ${elapsed.toFixed(2)} ms (ceiling ${ceiling.toFixed(1)} ms)`);
  console.log("ok - " + ITEMS + " item projection took " + elapsed.toFixed(2) + " ms (ceiling " + ceiling.toFixed(1) + " ms)");
  passed++;
})();

// The clock boundary work is part of the shape too: a projection run twice must not slow down (no cache growth).
(function () {
  const ceiling = scaleBudget(50);
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const start = process.hrtime.bigint();
    C.agendaZenProjection(items, now, 4);
    runs.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  const worst = Math.max(...runs);
  assert.ok(worst < ceiling, "a repeated projection stays inside the budget: " + runs.map((n) => n.toFixed(2)).join(", ") + " ms");
  console.log("ok - three repeated projections: " + runs.map((n) => n.toFixed(2)).join(", ") + " ms");
  passed++;
})();

console.log(`\n${passed} agenda projection perf guards passed`);
