"use strict";
// F0.8 / AU-B1: readable recurrence golden cases. `fixtures/notes-recurrence-hashes.json` proves that nothing changed
// but shows no diff; this table names every expected occurrence, so a failure prints the exact date that moved.
//
// One line per occurrence: local weekday, date, wall clock and UTC offset in the item's zone = the UTC instant.
// Every case runs with the zone stored on the item (`x.tz`) under four different system zones, where the result must
// not depend on the computer, and once as the system zone itself (no `x.tz`, `TZ` set). Rules pinned here:
//   * repeated hour (fall-back): a later occurrence takes the EARLIER instant; a series that STARTS in the second
//     pass of the hour keeps its first occurrence at its own instant (AU-B1);
//   * skipped hour (spring-forward): an item zone moves to the first valid minute (03:00); the system zone moves
//     forward by the size of the gap (03:30). The two differ today; both are pinned so a change is a visible
//     decision and not an accident;
//   * 29 February and the 29th/30th/31st exist only where the month has that day; COUNT counts real occurrences;
//   * UNTIL ("Last occurrence date") is a civil day in the item's zone: the series ends with that day there, wherever
//     the computer is;
//   * a timed event keeps its elapsed length, so its wall-clock end shifts on a transition day;
//   * all-day items are civil dates and never drift with the zone.
const assert = require("node:assert/strict"), test = require("node:test");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

function stamp(ms, zone) {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" });
  const part = Object.fromEntries(format.formatToParts(new Date(ms)).filter((entry) => entry.type !== "literal").map((entry) => [entry.type, entry.value]));
  const offset = part.timeZoneName === "GMT" ? "+00:00" : part.timeZoneName.replace("GMT", "");
  return { day: `${part.weekday} ${part.year}-${part.month}-${part.day}`, clock: `${part.hour}:${part.minute} ${offset}` };
}
const utc = (ms) => new Date(ms).toISOString().replace(":00.000Z", "Z");
const line = (ms, zone) => { const local = stamp(ms, zone); return `${local.day} ${local.clock} = ${utc(ms)}`; };
function withSystemZone(zone, run) {
  const prior = process.env.TZ;
  process.env.TZ = zone;
  try { return run(); } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
}
const window = (c) => [Date.parse(c.from + "T00:00:00Z"), Date.parse(c.to + "T00:00:00Z")];

const TIMED = [
  {
    name: "fall-back, Los Angeles: daily 01:30 through the repeated hour (2026-11-01)",
    zone: "America/Los_Angeles", start: "2026-10-30T08:30:00.000Z", rule: "RRULE:FREQ=DAILY;COUNT=5", from: "2026-10-29", to: "2026-11-10",
    expect: [
      "Fri 2026-10-30 01:30 -07:00 = 2026-10-30T08:30Z",
      "Sat 2026-10-31 01:30 -07:00 = 2026-10-31T08:30Z",
      "Sun 2026-11-01 01:30 -07:00 = 2026-11-01T08:30Z",
      "Mon 2026-11-02 01:30 -08:00 = 2026-11-02T09:30Z",
      "Tue 2026-11-03 01:30 -08:00 = 2026-11-03T09:30Z",
    ],
  },
  {
    name: "fall-back, Los Angeles: series that STARTS in the second 01:05 keeps its first occurrence (AU-B1)",
    zone: "America/Los_Angeles", start: "2026-11-01T09:05:00.000Z", rule: "RRULE:FREQ=DAILY;COUNT=4", from: "2026-10-29", to: "2026-11-10",
    expect: [
      "Sun 2026-11-01 01:05 -08:00 = 2026-11-01T09:05Z",
      "Mon 2026-11-02 01:05 -08:00 = 2026-11-02T09:05Z",
      "Tue 2026-11-03 01:05 -08:00 = 2026-11-03T09:05Z",
      "Wed 2026-11-04 01:05 -08:00 = 2026-11-04T09:05Z",
    ],
  },
  {
    name: "fall-back, Los Angeles: series that starts in the first 01:05",
    zone: "America/Los_Angeles", start: "2026-11-01T08:05:00.000Z", rule: "RRULE:FREQ=DAILY;COUNT=4", from: "2026-10-29", to: "2026-11-10",
    expect: [
      "Sun 2026-11-01 01:05 -07:00 = 2026-11-01T08:05Z",
      "Mon 2026-11-02 01:05 -08:00 = 2026-11-02T09:05Z",
      "Tue 2026-11-03 01:05 -08:00 = 2026-11-03T09:05Z",
      "Wed 2026-11-04 01:05 -08:00 = 2026-11-04T09:05Z",
    ],
  },
  {
    name: "fall-back, Los Angeles: weekly from the second 01:05",
    zone: "America/Los_Angeles", start: "2026-11-01T09:05:00.000Z", rule: "RRULE:FREQ=WEEKLY;COUNT=3", from: "2026-10-29", to: "2026-12-10",
    expect: [
      "Sun 2026-11-01 01:05 -08:00 = 2026-11-01T09:05Z",
      "Sun 2026-11-08 01:05 -08:00 = 2026-11-08T09:05Z",
      "Sun 2026-11-15 01:05 -08:00 = 2026-11-15T09:05Z",
    ],
  },
  {
    name: "fall-back, Los Angeles: yearly from the second 01:05",
    zone: "America/Los_Angeles", start: "2026-11-01T09:05:00.000Z", rule: "RRULE:FREQ=YEARLY;COUNT=3", from: "2026-10-29", to: "2029-12-10",
    expect: [
      "Sun 2026-11-01 01:05 -08:00 = 2026-11-01T09:05Z",
      "Mon 2027-11-01 01:05 -07:00 = 2027-11-01T08:05Z",
      "Wed 2028-11-01 01:05 -07:00 = 2028-11-01T08:05Z",
    ],
  },
  {
    name: "fall-back, Warsaw: daily 02:30 through the repeated hour (2026-10-25)",
    zone: "Europe/Warsaw", start: "2026-10-23T00:30:00.000Z", rule: "RRULE:FREQ=DAILY;COUNT=5", from: "2026-10-20", to: "2026-11-10",
    expect: [
      "Fri 2026-10-23 02:30 +02:00 = 2026-10-23T00:30Z",
      "Sat 2026-10-24 02:30 +02:00 = 2026-10-24T00:30Z",
      "Sun 2026-10-25 02:30 +02:00 = 2026-10-25T00:30Z",
      "Mon 2026-10-26 02:30 +01:00 = 2026-10-26T01:30Z",
      "Tue 2026-10-27 02:30 +01:00 = 2026-10-27T01:30Z",
    ],
  },
  {
    name: "fall-back, Warsaw: series that STARTS in the second 02:30 keeps its first occurrence (AU-B1)",
    zone: "Europe/Warsaw", start: "2026-10-25T01:30:00.000Z", rule: "RRULE:FREQ=DAILY;COUNT=3", from: "2026-10-20", to: "2026-11-10",
    expect: [
      "Sun 2026-10-25 02:30 +01:00 = 2026-10-25T01:30Z",
      "Mon 2026-10-26 02:30 +01:00 = 2026-10-26T01:30Z",
      "Tue 2026-10-27 02:30 +01:00 = 2026-10-27T01:30Z",
    ],
  },
  {
    name: "fall-back, Warsaw: monthly on the 25th from the second 02:30",
    zone: "Europe/Warsaw", start: "2026-10-25T01:30:00.000Z", rule: "RRULE:FREQ=MONTHLY;COUNT=3", from: "2026-10-20", to: "2027-02-10",
    expect: [
      "Sun 2026-10-25 02:30 +01:00 = 2026-10-25T01:30Z",
      "Wed 2026-11-25 02:30 +01:00 = 2026-11-25T01:30Z",
      "Fri 2026-12-25 02:30 +01:00 = 2026-12-25T01:30Z",
    ],
  },
  {
    name: "fall-back, Auckland: daily 02:30 through the repeated hour (2026-04-05)",
    zone: "Pacific/Auckland", start: "2026-04-02T13:30:00.000Z", rule: "RRULE:FREQ=DAILY;COUNT=5", from: "2026-04-01", to: "2026-04-20",
    expect: [
      "Fri 2026-04-03 02:30 +13:00 = 2026-04-02T13:30Z",
      "Sat 2026-04-04 02:30 +13:00 = 2026-04-03T13:30Z",
      "Sun 2026-04-05 02:30 +13:00 = 2026-04-04T13:30Z",
      "Mon 2026-04-06 02:30 +12:00 = 2026-04-05T14:30Z",
      "Tue 2026-04-07 02:30 +12:00 = 2026-04-06T14:30Z",
    ],
  },
  {
    name: "fall-back, Auckland: series that STARTS in the second 02:30 keeps its first occurrence (AU-B1)",
    zone: "Pacific/Auckland", start: "2026-04-04T14:30:00.000Z", rule: "RRULE:FREQ=DAILY;COUNT=3", from: "2026-04-01", to: "2026-04-20",
    expect: [
      "Sun 2026-04-05 02:30 +12:00 = 2026-04-04T14:30Z",
      "Mon 2026-04-06 02:30 +12:00 = 2026-04-05T14:30Z",
      "Tue 2026-04-07 02:30 +12:00 = 2026-04-06T14:30Z",
    ],
  },
  {
    name: "spring-forward, Los Angeles: daily 02:30 through the skipped hour (2026-03-08)",
    zone: "America/Los_Angeles", start: "2026-03-06T10:30:00.000Z", rule: "RRULE:FREQ=DAILY;COUNT=5", from: "2026-03-01", to: "2026-03-20",
    expect: [
      "Fri 2026-03-06 02:30 -08:00 = 2026-03-06T10:30Z",
      "Sat 2026-03-07 02:30 -08:00 = 2026-03-07T10:30Z",
      "Sun 2026-03-08 03:00 -07:00 = 2026-03-08T10:00Z",
      "Mon 2026-03-09 02:30 -07:00 = 2026-03-09T09:30Z",
      "Tue 2026-03-10 02:30 -07:00 = 2026-03-10T09:30Z",
    ],
    // The system zone goes through the JavaScript Date rule instead: the skipped time moves forward by the size of the gap.
    expectSystemZone: [
      "Fri 2026-03-06 02:30 -08:00 = 2026-03-06T10:30Z",
      "Sat 2026-03-07 02:30 -08:00 = 2026-03-07T10:30Z",
      "Sun 2026-03-08 03:30 -07:00 = 2026-03-08T10:30Z",
      "Mon 2026-03-09 02:30 -07:00 = 2026-03-09T09:30Z",
      "Tue 2026-03-10 02:30 -07:00 = 2026-03-10T09:30Z",
    ],
  },
  {
    name: "spring-forward, Warsaw: daily 02:30 through the skipped hour (2026-03-29)",
    zone: "Europe/Warsaw", start: "2026-03-27T01:30:00.000Z", rule: "RRULE:FREQ=DAILY;COUNT=5", from: "2026-03-20", to: "2026-04-20",
    expect: [
      "Fri 2026-03-27 02:30 +01:00 = 2026-03-27T01:30Z",
      "Sat 2026-03-28 02:30 +01:00 = 2026-03-28T01:30Z",
      "Sun 2026-03-29 03:00 +02:00 = 2026-03-29T01:00Z",
      "Mon 2026-03-30 02:30 +02:00 = 2026-03-30T00:30Z",
      "Tue 2026-03-31 02:30 +02:00 = 2026-03-31T00:30Z",
    ],
    // The system zone goes through the JavaScript Date rule instead: the skipped time moves forward by the size of the gap.
    expectSystemZone: [
      "Fri 2026-03-27 02:30 +01:00 = 2026-03-27T01:30Z",
      "Sat 2026-03-28 02:30 +01:00 = 2026-03-28T01:30Z",
      "Sun 2026-03-29 03:30 +02:00 = 2026-03-29T01:30Z",
      "Mon 2026-03-30 02:30 +02:00 = 2026-03-30T00:30Z",
      "Tue 2026-03-31 02:30 +02:00 = 2026-03-31T00:30Z",
    ],
  },
  {
    name: "spring-forward, Auckland: daily 02:30 through the skipped hour (2026-09-27)",
    zone: "Pacific/Auckland", start: "2026-09-24T14:30:00.000Z", rule: "RRULE:FREQ=DAILY;COUNT=5", from: "2026-09-20", to: "2026-10-20",
    expect: [
      "Fri 2026-09-25 02:30 +12:00 = 2026-09-24T14:30Z",
      "Sat 2026-09-26 02:30 +12:00 = 2026-09-25T14:30Z",
      "Sun 2026-09-27 03:00 +13:00 = 2026-09-26T14:00Z",
      "Mon 2026-09-28 02:30 +13:00 = 2026-09-27T13:30Z",
      "Tue 2026-09-29 02:30 +13:00 = 2026-09-28T13:30Z",
    ],
    // The system zone goes through the JavaScript Date rule instead: the skipped time moves forward by the size of the gap.
    expectSystemZone: [
      "Fri 2026-09-25 02:30 +12:00 = 2026-09-24T14:30Z",
      "Sat 2026-09-26 02:30 +12:00 = 2026-09-25T14:30Z",
      "Sun 2026-09-27 03:30 +13:00 = 2026-09-26T14:30Z",
      "Mon 2026-09-28 02:30 +13:00 = 2026-09-27T13:30Z",
      "Tue 2026-09-29 02:30 +13:00 = 2026-09-28T13:30Z",
    ],
  },
  {
    name: "spring-forward, Los Angeles: weekly Mon+Sun 09:00 keeps the wall clock",
    zone: "America/Los_Angeles", start: "2026-03-02T17:00:00.000Z", rule: "RRULE:FREQ=WEEKLY;BYDAY=MO,SU;COUNT=5", from: "2026-03-01", to: "2026-04-20",
    expect: [
      "Mon 2026-03-02 09:00 -08:00 = 2026-03-02T17:00Z",
      "Sun 2026-03-08 09:00 -07:00 = 2026-03-08T16:00Z",
      "Mon 2026-03-09 09:00 -07:00 = 2026-03-09T16:00Z",
      "Sun 2026-03-15 09:00 -07:00 = 2026-03-15T16:00Z",
      "Mon 2026-03-16 09:00 -07:00 = 2026-03-16T16:00Z",
    ],
  },
  {
    name: "spring-forward, Warsaw: weekly Sat 12:00 keeps the wall clock",
    zone: "Europe/Warsaw", start: "2026-03-21T11:00:00.000Z", rule: "RRULE:FREQ=WEEKLY;COUNT=3", from: "2026-03-01", to: "2026-04-20",
    expect: [
      "Sat 2026-03-21 12:00 +01:00 = 2026-03-21T11:00Z",
      "Sat 2026-03-28 12:00 +01:00 = 2026-03-28T11:00Z",
      "Sat 2026-04-04 12:00 +02:00 = 2026-04-04T10:00Z",
    ],
  },
  {
    name: "29 February, Auckland: yearly 09:00 exists only in leap years",
    zone: "Pacific/Auckland", start: "2024-02-28T20:00:00.000Z", rule: "RRULE:FREQ=YEARLY", from: "2024-01-01", to: "2033-01-01",
    expect: [
      "Thu 2024-02-29 09:00 +13:00 = 2024-02-28T20:00Z",
      "Tue 2028-02-29 09:00 +13:00 = 2028-02-28T20:00Z",
      "Sun 2032-02-29 09:00 +13:00 = 2032-02-28T20:00Z",
    ],
  },
  {
    name: "29 February, Los Angeles: yearly 09:00 exists only in leap years",
    zone: "America/Los_Angeles", start: "2024-02-29T17:00:00.000Z", rule: "RRULE:FREQ=YEARLY", from: "2024-01-01", to: "2033-01-01",
    expect: [
      "Thu 2024-02-29 09:00 -08:00 = 2024-02-29T17:00Z",
      "Tue 2028-02-29 09:00 -08:00 = 2028-02-29T17:00Z",
      "Sun 2032-02-29 09:00 -08:00 = 2032-02-29T17:00Z",
    ],
  },
  {
    name: "29 February, Warsaw: yearly COUNT counts real occurrences only",
    zone: "Europe/Warsaw", start: "2024-02-29T08:00:00.000Z", rule: "RRULE:FREQ=YEARLY;COUNT=2", from: "2024-01-01", to: "2040-01-01",
    expect: [
      "Thu 2024-02-29 09:00 +01:00 = 2024-02-29T08:00Z",
      "Tue 2028-02-29 09:00 +01:00 = 2028-02-29T08:00Z",
    ],
  },
  {
    name: "29th of the month, Warsaw: monthly 18:00 skips February 2025",
    zone: "Europe/Warsaw", start: "2024-12-29T17:00:00.000Z", rule: "RRULE:FREQ=MONTHLY;COUNT=5", from: "2024-12-01", to: "2026-01-01",
    expect: [
      "Sun 2024-12-29 18:00 +01:00 = 2024-12-29T17:00Z",
      "Wed 2025-01-29 18:00 +01:00 = 2025-01-29T17:00Z",
      "Sat 2025-03-29 18:00 +01:00 = 2025-03-29T17:00Z",
      "Tue 2025-04-29 18:00 +02:00 = 2025-04-29T16:00Z",
      "Thu 2025-05-29 18:00 +02:00 = 2025-05-29T16:00Z",
    ],
  },
  {
    name: "29th of the month, Los Angeles: monthly 18:00 keeps February in the leap year 2028",
    zone: "America/Los_Angeles", start: "2028-01-30T02:00:00.000Z", rule: "RRULE:FREQ=MONTHLY;COUNT=3", from: "2028-01-01", to: "2028-06-01",
    expect: [
      "Sat 2028-01-29 18:00 -08:00 = 2028-01-30T02:00Z",
      "Tue 2028-02-29 18:00 -08:00 = 2028-03-01T02:00Z",
      "Wed 2028-03-29 18:00 -07:00 = 2028-03-30T01:00Z",
    ],
  },
  {
    name: "31st, Warsaw: monthly 18:00 lands only in 31-day months",
    zone: "Europe/Warsaw", start: "2026-01-31T17:00:00.000Z", rule: "RRULE:FREQ=MONTHLY", from: "2026-01-01", to: "2027-02-01",
    expect: [
      "Sat 2026-01-31 18:00 +01:00 = 2026-01-31T17:00Z",
      "Tue 2026-03-31 18:00 +02:00 = 2026-03-31T16:00Z",
      "Sun 2026-05-31 18:00 +02:00 = 2026-05-31T16:00Z",
      "Fri 2026-07-31 18:00 +02:00 = 2026-07-31T16:00Z",
      "Mon 2026-08-31 18:00 +02:00 = 2026-08-31T16:00Z",
      "Sat 2026-10-31 18:00 +01:00 = 2026-10-31T17:00Z",
      "Thu 2026-12-31 18:00 +01:00 = 2026-12-31T17:00Z",
      "Sun 2027-01-31 18:00 +01:00 = 2027-01-31T17:00Z",
    ],
  },
  {
    name: "31st, Los Angeles: monthly 23:30 (next UTC day) lands only in 31-day months",
    zone: "America/Los_Angeles", start: "2026-02-01T07:30:00.000Z", rule: "RRULE:FREQ=MONTHLY;COUNT=4", from: "2026-01-01", to: "2027-02-01",
    expect: [
      "Sat 2026-01-31 23:30 -08:00 = 2026-02-01T07:30Z",
      "Tue 2026-03-31 23:30 -07:00 = 2026-04-01T06:30Z",
      "Sun 2026-05-31 23:30 -07:00 = 2026-06-01T06:30Z",
      "Fri 2026-07-31 23:30 -07:00 = 2026-08-01T06:30Z",
    ],
  },
  {
    name: "31st, Auckland: every 2 months 07:00 (previous UTC day), COUNT skips short months",
    zone: "Pacific/Auckland", start: "2026-01-30T18:00:00.000Z", rule: "RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=5", from: "2026-01-01", to: "2028-02-01",
    expect: [
      "Sat 2026-01-31 07:00 +13:00 = 2026-01-30T18:00Z",
      "Tue 2026-03-31 07:00 +13:00 = 2026-03-30T18:00Z",
      "Sun 2026-05-31 07:00 +12:00 = 2026-05-30T19:00Z",
      "Fri 2026-07-31 07:00 +12:00 = 2026-07-30T19:00Z",
      "Sun 2027-01-31 07:00 +13:00 = 2027-01-30T18:00Z",
    ],
  },
  {
    name: "31st, Warsaw: monthly UNTIL is exclusive of later months",
    zone: "Europe/Warsaw", start: "2026-01-31T17:00:00.000Z", rule: "RRULE:FREQ=MONTHLY;UNTIL=20260801", from: "2026-01-01", to: "2027-02-01",
    expect: [
      "Sat 2026-01-31 18:00 +01:00 = 2026-01-31T17:00Z",
      "Tue 2026-03-31 18:00 +02:00 = 2026-03-31T16:00Z",
      "Sun 2026-05-31 18:00 +02:00 = 2026-05-31T16:00Z",
      "Fri 2026-07-31 18:00 +02:00 = 2026-07-31T16:00Z",
    ],
  },
  {
    name: "UNTIL, Los Angeles: monthly 31st 23:30 with last date 31 July keeps 31 July (already 1 August in UTC)",
    zone: "America/Los_Angeles", start: "2026-02-01T07:30:00.000Z", rule: "RRULE:FREQ=MONTHLY;UNTIL=20260731", from: "2026-01-01", to: "2027-02-01",
    expect: [
      "Sat 2026-01-31 23:30 -08:00 = 2026-02-01T07:30Z",
      "Tue 2026-03-31 23:30 -07:00 = 2026-04-01T06:30Z",
      "Sun 2026-05-31 23:30 -07:00 = 2026-06-01T06:30Z",
      "Fri 2026-07-31 23:30 -07:00 = 2026-08-01T06:30Z",
    ],
  },
  {
    name: "UNTIL, Warsaw: daily 12:00 with last date 3 January keeps 3 January (already 4 January in Auckland)",
    zone: "Europe/Warsaw", start: "2026-01-01T11:00:00.000Z", rule: "RRULE:FREQ=DAILY;UNTIL=20260103", from: "2025-12-20", to: "2026-02-01",
    expect: [
      "Thu 2026-01-01 12:00 +01:00 = 2026-01-01T11:00Z",
      "Fri 2026-01-02 12:00 +01:00 = 2026-01-02T11:00Z",
      "Sat 2026-01-03 12:00 +01:00 = 2026-01-03T11:00Z",
    ],
  },
  {
    name: "UNTIL, Auckland: daily 00:30 with last date 3 January ends on 3 January",
    zone: "Pacific/Auckland", start: "2025-12-31T11:30:00.000Z", rule: "RRULE:FREQ=DAILY;UNTIL=20260103", from: "2025-12-20", to: "2026-02-01",
    expect: [
      "Thu 2026-01-01 00:30 +13:00 = 2025-12-31T11:30Z",
      "Fri 2026-01-02 00:30 +13:00 = 2026-01-01T11:30Z",
      "Sat 2026-01-03 00:30 +13:00 = 2026-01-02T11:30Z",
    ],
  },
  {
    name: "UNTIL, Auckland: weekly Monday 00:30 with last date Sunday 4 January has no 5 January (still 4 January in Los Angeles)",
    zone: "Pacific/Auckland", start: "2025-12-21T11:30:00.000Z", rule: "RRULE:FREQ=WEEKLY;UNTIL=20260104", from: "2025-12-01", to: "2026-02-01",
    expect: [
      "Mon 2025-12-22 00:30 +13:00 = 2025-12-21T11:30Z",
      "Mon 2025-12-29 00:30 +13:00 = 2025-12-28T11:30Z",
    ],
  },
];
const SYSTEM_ZONES = ["UTC", "Europe/Warsaw", "America/Los_Angeles", "Pacific/Auckland"];

const timedItem = (c, itemZone, rule = c.rule) => C.makeItem({ id: "golden", summary: "Golden", start: { dateTime: c.start }, recurrence: [rule], x: { kind: "reminder", src: "manual", ...(itemZone ? { tz: itemZone } : {}) } });
function checkTimed(c, itemZone, expected, where) {
  const item = timedItem(c, itemZone);
  const occurrences = C.expandItem(item, ...window(c));
  assert.deepEqual(occurrences.map((occurrence) => line(Date.parse(occurrence.start.dateTime), c.zone)), expected, where);
  assert.equal(new Set(occurrences.map((occurrence) => occurrence.id)).size, occurrences.length, "occurrence ids are unique");
  for (const occurrence of occurrences) assert.ok(C.validOccurrenceIdentity(item, occurrence), where + ": a listed occurrence is a valid recurrence candidate: " + occurrence.start.dateTime);
  assert.equal(occurrences[0].id, "golden", "the first occurrence is the series start itself");
}
// The occurrence the same rule would produce next if it had no COUNT/UNTIL: it must be rejected by the ended rule.
function occurrenceAfterEnd(c, itemZone, listed) {
  if (!/;(?:COUNT|UNTIL)=/.test(c.rule)) return NaN;
  const open = timedItem(c, itemZone, c.rule.replace(/;(?:COUNT|UNTIL)=[^;]+/, ""));
  const last = Date.parse(listed[listed.length - 1].split(" = ")[1].replace("Z", ":00.000Z"));
  // Search just past the last listed occurrence, widening only as far as the frequency needs (29 February: years).
  for (const days of [3, 40, 400, 3300]) {
    const next = C.expandItem(open, last + 1, last + days * 86400000).map((occurrence) => Date.parse(occurrence.start.dateTime)).find((ms) => ms > last);
    if (Number.isFinite(next)) return next;
  }
  return NaN;
}
for (const c of TIMED) {
  test(`${c.name} [zone stored on the item, four system zones]`, () => {
    const beyond = withSystemZone("UTC", () => occurrenceAfterEnd(c, c.zone, c.expect));
    for (const system of SYSTEM_ZONES) withSystemZone(system, () => {
      checkTimed(c, c.zone, c.expect, "computer in " + system);
      if (Number.isFinite(beyond)) assert.equal(C.isRecurrenceCandidate(timedItem(c, c.zone), beyond), false, "computer in " + system + ": nothing after the end: " + utc(beyond));
    });
  });
  test(`${c.name} [system zone]`, () => withSystemZone(c.zone, () => {
    const expected = c.expectSystemZone || c.expect;
    checkTimed(c, "", expected, "computer in " + c.zone);
    const beyond = occurrenceAfterEnd(c, "", expected);
    if (Number.isFinite(beyond)) assert.equal(C.isRecurrenceCandidate(timedItem(c, ""), beyond), false, "nothing after the end: " + utc(beyond));
  }));
}

test("UNTIL keeps the civil date a person typed, in every system zone and on 23- and 25-hour days", () => {
  const days = ["2026-03-08", "2026-03-29", "2026-09-27", "2026-10-25", "2026-11-01", "2026-04-05", "2028-02-29", "2026-12-31", "2027-01-01"];
  for (const system of SYSTEM_ZONES) withSystemZone(system, () => {
    for (const day of days) {
      const rule = C.parseRule("RRULE:FREQ=WEEKLY;UNTIL=" + day.replace(/-/g, ""));
      assert.equal(rule.untilKey, day, system + " " + day);
      assert.equal(C.localDateKey(rule.until - 1), day, "the system-zone boundary is the end of that same day");
    }
    assert.equal(C.parseRule("RRULE:FREQ=DAILY;UNTIL=20260731T065959Z").untilKey, "2026-07-31", "a date-time value keeps its date part");
  });
  assert.equal(C.parseRule("RRULE:FREQ=DAILY;COUNT=3").untilKey, "", "no UNTIL, no date");
  assert.equal(C.parseRule("RRULE:FREQ=DAILY").until, 0);
});

test("the expected table is internally consistent: every local time and offset equals its UTC instant", () => {
  let checked = 0;
  for (const c of TIMED) for (const text of [...c.expect, ...(c.expectSystemZone || [])]) {
    const m = /^(\w{3}) (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) ([+-])(\d{2}):(\d{2}) = (\S+)Z$/.exec(text);
    assert.ok(m, "readable line format: " + text);
    const offset = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
    const instant = Date.UTC(Number(m[2]), Number(m[3]) - 1, Number(m[4]), Number(m[5]), Number(m[6])) - offset * 60000;
    assert.equal(new Date(instant).toISOString(), m[10] + ":00.000Z", text);
    assert.equal(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(Number(m[2]), Number(m[3]) - 1, Number(m[4]))).getUTCDay()], m[1], "weekday of " + text);
    checked++;
  }
  assert.ok(checked > 90);
});

// A timed event keeps its elapsed length. Line: local start -> local end (both with offset).
const EVENTS = [
  {
    name: "spring-forward, Los Angeles: weekly 2-hour event 01:30-03:30 ends at 04:30 on the short day",
    zone: "America/Los_Angeles", start: "2026-03-01T09:30:00.000Z", end: "2026-03-01T11:30:00.000Z", rule: "RRULE:FREQ=WEEKLY;COUNT=3", from: "2026-02-25", to: "2026-04-01",
    expect: [
      "Sun 2026-03-01 01:30 -08:00 -> Sun 2026-03-01 03:30 -08:00",
      "Sun 2026-03-08 01:30 -08:00 -> Sun 2026-03-08 04:30 -07:00",
      "Sun 2026-03-15 01:30 -07:00 -> Sun 2026-03-15 03:30 -07:00",
    ],
  },
  {
    name: "fall-back, Warsaw: weekly 2-hour event 01:30-03:30 ends at 02:30 on the long day",
    zone: "Europe/Warsaw", start: "2026-10-17T23:30:00.000Z", end: "2026-10-18T01:30:00.000Z", rule: "RRULE:FREQ=WEEKLY;COUNT=3", from: "2026-10-10", to: "2026-11-10",
    expect: [
      "Sun 2026-10-18 01:30 +02:00 -> Sun 2026-10-18 03:30 +02:00",
      "Sun 2026-10-25 01:30 +02:00 -> Sun 2026-10-25 02:30 +01:00",
      "Sun 2026-11-01 01:30 +01:00 -> Sun 2026-11-01 03:30 +01:00",
    ],
  },
  {
    name: "month end, Auckland: monthly overnight event on the 31st 23:00-01:00 crosses into the next month",
    zone: "Pacific/Auckland", start: "2026-01-31T10:00:00.000Z", end: "2026-01-31T12:00:00.000Z", rule: "RRULE:FREQ=MONTHLY;COUNT=3", from: "2026-01-01", to: "2026-08-01",
    expect: [
      "Sat 2026-01-31 23:00 +13:00 -> Sun 2026-02-01 01:00 +13:00",
      "Tue 2026-03-31 23:00 +13:00 -> Wed 2026-04-01 01:00 +13:00",
      "Sun 2026-05-31 23:00 +12:00 -> Mon 2026-06-01 01:00 +12:00",
    ],
  },
];
function checkEvent(c, itemZone, where) {
  const item = C.makeItem({ id: "golden", summary: "Golden", start: { dateTime: c.start }, end: { dateTime: c.end }, recurrence: [c.rule], x: { kind: "event", src: "manual", ...(itemZone ? { tz: itemZone } : {}) } });
  const occurrences = C.expandItem(item, ...window(c));
  const length = Date.parse(c.end) - Date.parse(c.start);
  assert.deepEqual(occurrences.map((occurrence) => {
    const from = stamp(Date.parse(occurrence.start.dateTime), c.zone), to = stamp(Date.parse(occurrence.end.dateTime), c.zone);
    return `${from.day} ${from.clock} -> ${to.day} ${to.clock}`;
  }), c.expect, where);
  for (const occurrence of occurrences) assert.equal(Date.parse(occurrence.end.dateTime) - Date.parse(occurrence.start.dateTime), length, "elapsed length is constant");
}
for (const c of EVENTS) {
  test(`${c.name} [zone stored on the item, four system zones]`, () => {
    for (const system of SYSTEM_ZONES) withSystemZone(system, () => checkEvent(c, c.zone, "computer in " + system));
  });
  test(`${c.name} [system zone]`, () => withSystemZone(c.zone, () => checkEvent(c, "", "computer in " + c.zone)));
}

// All-day items are civil dates: the same keys in every system zone.
const ALL_DAY = [
  { name: "29 February: yearly all-day exists only in leap years", start: "2024-02-29", rule: "RRULE:FREQ=YEARLY", from: "2024-01-01", to: "2033-01-01", expect: ["2024-02-29", "2028-02-29", "2032-02-29"] },
  { name: "29th: monthly all-day skips February 2025", start: "2025-01-29", rule: "RRULE:FREQ=MONTHLY;COUNT=4", from: "2025-01-01", to: "2026-01-02", expect: ["2025-01-29", "2025-03-29", "2025-04-29", "2025-05-29"] },
  { name: "30th: monthly all-day skips February only", start: "2026-01-30", rule: "RRULE:FREQ=MONTHLY;COUNT=4", from: "2026-01-01", to: "2026-12-31", expect: ["2026-01-30", "2026-03-30", "2026-04-30", "2026-05-30"] },
  { name: "31st: monthly all-day lands only in 31-day months", start: "2026-01-31", rule: "RRULE:FREQ=MONTHLY", from: "2026-01-01", to: "2027-01-02", expect: ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2026-08-31", "2026-10-31", "2026-12-31"] },
  { name: "31st: every 3 months all-day", start: "2026-01-31", rule: "RRULE:FREQ=MONTHLY;INTERVAL=3;COUNT=4", from: "2026-01-01", to: "2028-12-31", expect: ["2026-01-31", "2026-07-31", "2026-10-31", "2027-01-31"] },
  { name: "weekly all-day Sunday through both autumn transitions keeps its dates", start: "2026-10-18", rule: "RRULE:FREQ=WEEKLY;COUNT=4", from: "2026-10-01", to: "2026-12-01", expect: ["2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08"] },
  { name: "daily all-day through both spring transitions has no missing or doubled day", start: "2026-03-07", rule: "RRULE:FREQ=DAILY;COUNT=4", from: "2026-03-01", to: "2026-04-01", expect: ["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"] },
  { name: "daily all-day through the Warsaw spring transition", start: "2026-03-28", rule: "RRULE:FREQ=DAILY;COUNT=3", from: "2026-03-01", to: "2026-04-10", expect: ["2026-03-28", "2026-03-29", "2026-03-30"] },
  { name: "daily all-day through the Auckland transitions", start: "2026-04-04", rule: "RRULE:FREQ=DAILY;COUNT=3", from: "2026-03-20", to: "2026-04-20", expect: ["2026-04-04", "2026-04-05", "2026-04-06"] },
  { name: "UNTIL: daily all-day ends on its last date, a 23-hour day in Warsaw", start: "2026-03-27", rule: "RRULE:FREQ=DAILY;UNTIL=20260329", from: "2026-03-01", to: "2026-04-10", expect: ["2026-03-27", "2026-03-28", "2026-03-29"] },
  { name: "UNTIL: weekly all-day ends on its last date, a 25-hour day in Los Angeles", start: "2026-10-18", rule: "RRULE:FREQ=WEEKLY;UNTIL=20261101", from: "2026-10-01", to: "2026-12-01", expect: ["2026-10-18", "2026-10-25", "2026-11-01"] },
  { name: "year end: daily all-day crosses 31 December", start: "2026-12-30", rule: "RRULE:FREQ=DAILY;COUNT=4", from: "2026-12-01", to: "2027-01-20", expect: ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"] },
];
for (const c of ALL_DAY) {
  for (const zone of SYSTEM_ZONES) {
    test(`${c.name} [system zone ${zone}]`, () => withSystemZone(zone, () => {
      const item = C.makeItem({ id: "golden", summary: "Golden", start: { date: c.start }, recurrence: [c.rule], x: { kind: "reminder", src: "manual" } });
      // The search window is given in UTC and is wider than the series by more than a day on both sides.
      const occurrences = C.expandItem(item, ...window(c));
      assert.deepEqual(occurrences.map((occurrence) => occurrence.start.date), c.expect);
      for (const occurrence of occurrences) assert.ok(C.validOccurrenceIdentity(item, occurrence), occurrence.start.date);
    }));
  }
}
