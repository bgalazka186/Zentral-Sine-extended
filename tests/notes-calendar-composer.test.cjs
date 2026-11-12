"use strict";
/* T2.3f: pure calendar composer normalization and edge cases. */
const assert = require("node:assert/strict");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const now = Date.parse("2026-11-12T12:00:00Z");
const base = { summary: "  Independent title  ", kind: "reminder", allDay: true, startDate: "2026-11-13", noteId: "source-1" };

{
  assert.equal(cal.titleFromDateText("Pay the invoice on 2026-11-05", "2026-11-05"), "Pay the invoice");
  assert.equal(cal.titleFromDateText("2026-11-22 Publish the project update", "2026-11-22"), "Publish the project update");
  assert.equal(cal.titleFromDateText("Follow up at 2026-11-22 15:20", "2026-11-22 15:20"), "Follow up");
  assert.equal(cal.titleFromDateText("Please follow up on the estimate", ""), "Please follow up on the estimate");
  assert.equal(cal.resolveItemColor("#123456", "#abcdef"), "#123456", "linked-note colour wins over category colour");
  assert.equal(cal.resolveItemColor("blue", "#abcdef"), "blue", "named note palette colours remain authoritative");
  assert.equal(cal.resolveItemColor("none", "#abcdef"), "#abcdef", "category colour is the fallback for uncoloured linked notes");
  assert.equal(cal.resolveItemColor("", "#abcdef"), "#abcdef", "unlinked/manual items use category colour");
  assert.equal(cal.resolveItemColor("none", ""), "", "no explicit colours remains uncoloured");
}

{
  const item = cal.composeCalendarItem(base, now);
  assert.ok(item);
  assert.equal(item.summary, "Independent title", "title is not replaced by the linked note title");
  assert.deepEqual(item.start, { date: "2026-11-13" });
  assert.equal(Object.hasOwn(item, "end"), false, "all-day reminders have no end or fake midnight time");
  assert.equal(item.x.noteId, "source-1");
  assert.equal(item.x.kind, "reminder");
}

{
  const event = cal.composeCalendarItem({ ...base, kind: "event", startDate: "2026-11-13", endDate: "2026-11-15" }, now);
  assert.deepEqual(event.start, { date: "2026-11-13" });
  assert.deepEqual(event.end, { date: "2026-11-15" }, "all-day event end is exclusive");
  assert.equal(cal.composeCalendarItem({ ...base, kind: "event", endDate: "2026-11-13" }, now), null, "zero-length all-day event is rejected");
  assert.equal(cal.composeCalendarItem({ ...base, kind: "event", endDate: "2026-11-12" }, now), null, "backwards all-day event is rejected");
}

{
  const timedReminder = cal.composeCalendarItem({ ...base, allDay: false, startTime: "09:15", tz: "Europe/Warsaw" }, now);
  assert.equal(timedReminder.start.dateTime, "2026-11-13T08:15:00.000Z");
  assert.equal(Object.hasOwn(timedReminder, "end"), false);
  const timedEvent = cal.composeCalendarItem({ ...base, kind: "event", allDay: false, startTime: "09:15", endDate: "2026-11-13", endTime: "10:45", tz: "Europe/Warsaw" }, now);
  assert.equal(timedEvent.end.dateTime, "2026-11-13T09:45:00.000Z");
  assert.equal(cal.composeCalendarItem({ ...base, allDay: false, startTime: "25:00" }, now), null);
  assert.equal(cal.composeCalendarItem({ ...base, kind: "event", allDay: false, startTime: "10:00", endTime: "09:00" }, now), null);
}

{
  assert.equal(cal.composeCalendarItem({ ...base, summary: "   " }, now), null, "blank title is rejected");
  assert.equal(cal.composeCalendarItem({ ...base, startDate: "2026-02-30" }, now), null, "invalid date is rejected");
  assert.equal(cal.composeCalendarItem({ ...base, tz: "Mars/Olympus" }, now), null, "invalid IANA zone is rejected");
  assert.equal(cal.composeCalendarItem({ ...base, allDay: false }, now), null, "timed reminders require a valid time");
}

{
  const item = cal.composeCalendarItem({
    ...base, kind: "reminder", allDay: false, startTime: "14:00", category: "Work",
    description: "Description", calNote: "Calendar-only detail", heading: "Milestones",
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4"],
    notify: { pre: { enabled: false, leadMinutes: 7 }, due: { enabled: true }, followup: { enabled: false, delayMinutes: 9 } },
  }, now);
  assert.equal(item.x.category, "Work");
  assert.equal(item.description, "Description");
  assert.equal(item.x.calNote, "Calendar-only detail");
  assert.equal(item.x.heading, "Milestones");
  assert.deepEqual(item.recurrence, ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4"]);
  assert.deepEqual(item.x.notify, { pre: { enabled: false, leadMinutes: 7 }, due: { enabled: true }, followup: { enabled: false, delayMinutes: 9 } });
  assert.equal(cal.composeCalendarItem({ ...base, recurrence: "not-an-array" }, now).recurrence.length, 0, "malformed recurrence input cannot leak into the item");
}

{
  const old = cal.composeCalendarItem({ ...base, id: "edit-me", allDay: false, startTime: "09:00", description: "Before", calNote: "Old", noteId: "source-1" }, now);
  const edited = cal.composeCalendarItem({ item: old, ...base, id: old.id, allDay: false, startTime: "10:00", description: "After", calNote: "New" }, now + 1000);
  assert.equal(edited.id, "edit-me", "editing keeps stable identity");
  assert.equal(edited.summary, "Independent title");
  assert.equal(edited.description, "After");
  assert.equal(edited.x.calNote, "New");
  assert.equal(edited.x.moved, "1", "moving an item preserves its manually chosen schedule through note resync");
  assert.equal(old.start.dateTime, "2026-11-13T09:00:00.000Z", "compose never mutates the previous item");
}

console.log("calendar composer pure tests passed");
