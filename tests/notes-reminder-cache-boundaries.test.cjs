"use strict";
process.env.TZ = "America/New_York";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const DAY = 86400000;
const now = new Date(2026, 2, 7, 23, 30).getTime(); // window straddles a DST change
const make = (id, at, repeat = false) => C.makeItem({ id, summary: id, start: { dateTime: new Date(at).toISOString() }, recurrence: repeat ? ["RRULE:FREQ=DAILY"] : [], x: { kind: "reminder", src: "manual" } }, now);
const items = [make("daily", now + 3600000, true), make("edge-inside", now + 90 * DAY - 1), make("edge-outside", now + 90 * DAY), make("near", now + 10 * 60000)];
(async () => {
  const host = createFakeZen(), seen = [];
  const history = { stateFor: () => "pending", list: (id) => { seen.push(id.itemId + "|" + id.occurrenceId); return []; } };
  const store = { list: () => [], on: () => () => {}, items: { list: () => items, category: () => null, history, on: () => () => {} } };
  const scheduler = host.window.__zentralNotesTestSeam.core.createReminderScheduler({ store, now: () => now, setTimer: () => 1, clearTimer() {}, onDue() {} });
  try {
    scheduler.start(); await Promise.resolve();
    const expected = C.expandRange(items, now - 2 * DAY, now + 90 * DAY).map((entry) => { const id = C.reminderIdentity(entry); return id.itemId + "|" + id.occurrenceId; });
    assert.deepEqual(seen, expected, "cached expansion matches exact rolling bounds and ordering over DST");
    seen.length = 0; scheduler.reschedule(); await Promise.resolve(); assert.deepEqual(seen, expected);
  } finally { scheduler.destroy(); await host.destroy(); }
  console.log("scheduler cache DST and exact bounds passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
