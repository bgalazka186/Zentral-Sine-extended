"use strict";
process.env.TZ = "America/New_York";
const assert = require("node:assert/strict"), crypto = require("node:crypto"), fs = require("node:fs"), path = require("node:path");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const fixtures = require("./fixtures/notes-recurrence-hashes.json");
let seed = 314159;
const rnd = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
const cases = [];
for (let i = 0; i < 60; i++) {
  const at = new Date(2026, rnd(12), 1 + rnd(27), 8 + rnd(9), rnd(60)).getTime();
  const frequencies = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
  const rule = `RRULE:FREQ=${frequencies[rnd(4)]};INTERVAL=${1 + rnd(3)};COUNT=${3 + rnd(70)}`;
  const exceptions = [];
  for (let j = 0; j < 5; j++) {
    const original = new Date(at + j * 86400000).toISOString(), shifted = new Date(at + (j + 2) * 86400000).toISOString();
    exceptions.push({ scope: "this", recurrenceId: { dateTime: original }, ...(rnd(2) ? { cancelled: true } : { start: { dateTime: shifted } }) });
  }
  const item = C.makeItem({ id: `id-${i}`, summary: "Item " + i, start: { dateTime: new Date(at).toISOString() }, end: { dateTime: new Date(at + 3600000).toISOString() }, recurrence: [rule], x: { kind: "event", src: "manual", tz: i % 2 ? "America/New_York" : "", agendaWindow: { leadDays: 2 }, recurrenceExceptions: exceptions } }, at);
  const result = C.expandItem(item, at - 86400000, at + 365 * 86400000);
  const hash = crypto.createHash("sha256").update(JSON.stringify(result)).digest("hex"); cases.push(hash);
  if (result.length > 1) {
    result[0].x.agendaWindow.leadDays = 20; result[0].recurrence.push("mutated");
    assert.equal(item.x.agendaWindow.leadDays, 2, "occurrences must not mutate masters");
    assert.equal(result[1].x.agendaWindow.leadDays, 2, "occurrences must not mutate siblings");
    assert.equal(item.recurrence.length, 1);
  }
}
if (process.env.CREATE_RECURRENCE_FIXTURES) fs.writeFileSync(path.join(__dirname, "fixtures/notes-recurrence-hashes.json"), JSON.stringify(cases, null, 2) + "\n");
else assert.deepEqual(cases, fixtures, "expansion is byte-for-byte identical to the pre-optimization implementation");
{
  const rule = "RRULE:FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20261030";
  const a = C.parseRule(rule); a.byday.push(3); a.until = 0;
  assert.deepEqual(C.parseRule(rule).byday, [1, 5], "callers cannot mutate cached parsed rules");
  const prior = process.env.TZ;
  process.env.TZ = "UTC"; const utc = C.parseRule(rule).until;
  process.env.TZ = "America/New_York"; const ny = C.parseRule(rule).until;
  assert.notEqual(utc, ny, "UNTIL cache respects timezone changes");
  process.env.TZ = prior;
}
console.log("recurrence baseline fixtures and isolation passed");
