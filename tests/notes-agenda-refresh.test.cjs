"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");

assert.equal(typeof cal.agendaItemEventAffectsProjection, "function");
for (const kind of ["change", "remove", "category", "reset", "recovery"]) {
  assert.equal(cal.agendaItemEventAffectsProjection(kind), true, kind);
  assert.equal(cal.agendaItemEventAffectsProjection({ type: kind }), true, kind);
}
for (const kind of ["", "unknown", null, undefined, {}, { type: "other" }])
  assert.equal(cal.agendaItemEventAffectsProjection(kind), false);

const source = fs.readFileSync(require.resolve("../additional/notes/ZentralNotes.uc.js"), "utf8");
const start = source.indexOf("      const agendaItemUnsub =");
const end = source.indexOf("      const agendaNoteUnsub =", start);
assert.ok(start >= 0 && end > start);
let enabled = true, scheduled = 0, clock = 10;
const store = cal.createItemStore({ io: {}, getDir: () => "/n", now: () => clock, setTimer: () => 1, clearTimer() {} });
const sandbox = { store: { items: store }, CALENDAR_PART: cal, agendaEnabled: () => enabled, agendaController: { schedule: () => scheduled++ } };
vm.runInNewContext(source.slice(start, end) + "\nthis.unsubscribe = agendaItemUnsub;", sandbox);
const item = cal.makeItem({ id: "test", summary: "test", start: { date: "2026-11-13" }, x: { kind: "reminder", src: "manual" } }, 10);
const saved = store.upsert(item);
assert.equal(scheduled, 1, "creation schedules refresh using real string event");
clock = 11;
store.upsert({ ...saved, summary: "edited", updated: new Date(clock).toISOString() });
assert.equal(scheduled, 2, "editing schedules refresh");
store.remove(item.id);
assert.equal(scheduled, 3, "deletion schedules refresh");
enabled = false;
clock = 12;
store.upsert({ ...item, updated: new Date(clock).toISOString() });
assert.equal(scheduled, 3, "disabled Agenda does not schedule");
enabled = true;
sandbox.unsubscribe();
store.remove(item.id);
assert.equal(scheduled, 3, "unsubscribe detaches callback");
console.log("Agenda item event refresh tests passed");
