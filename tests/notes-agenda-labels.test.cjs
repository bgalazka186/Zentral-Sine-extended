"use strict";
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const now = new Date(2026, 10, 13, 12).getTime(), base = cal.dayStart(now);
const options = { weekday: "short", day: "numeric", month: "short" };
assert.equal(typeof cal.agendaDayLabel, "function");
assert.equal(cal.agendaDayLabel(0, base, "en-GB"), "Today");
assert.equal(cal.agendaDayLabel(1, cal.addDays(base, 1), "en-GB"), "Tomorrow");
for (const locale of ["en-GB", "pl-PL", "en-US"]) for (const offset of [2, 3, 5, 30]) {
  const day = cal.addDays(base, offset);
  assert.equal(cal.agendaDayLabel(offset, day, locale), new Date(day).toLocaleDateString(locale, options));
}
const buckets = cal.agendaBuckets([], now, 6), projection = cal.agendaZenProjection([], now, 6);
for (let i = 0; i < 6; i++) {
  const key = cal.localDateKey(cal.addDays(base, i));
  assert.equal(buckets[i].key, key);
  assert.equal(projection[i].date, key);
  assert.equal(projection[i].key, "day:" + key);
  assert.equal(buckets[i].label, projection[i].label);
  if (i >= 2) assert.equal(buckets[i].label, new Date(cal.addDays(base, i)).toLocaleDateString(undefined, options));
}
const code = `const C=require(${JSON.stringify(require.resolve("../additional/notes/calendar/ZentralNotesCalendar.js"))}); const now=new Date(2026,2,28,12).getTime(); const p=C.agendaZenProjection([],now,4); process.stdout.write(JSON.stringify(p.map(x=>[x.date,x.key,x.label])));`;
const dst = JSON.parse(execFileSync(process.execPath, ["-e", code], { env: { ...process.env, TZ: "Europe/Warsaw" }, encoding: "utf8" }));
assert.deepEqual(dst.map(x => x[0]), ["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
assert.deepEqual(dst.map(x => x[1]), dst.map(x => "day:" + x[0]));
console.log("Agenda label tests passed");
