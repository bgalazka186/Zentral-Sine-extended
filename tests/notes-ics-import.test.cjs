"use strict";
/* OW-53: bringing a Google Calendar (or any other calendar's) `.ics` file into the calendar.
 *
 * Google's own export is the fixture that matters, so the sample below is shaped like one: CRLF lines folded at 75
 * octets (a fold is a line starting with a space, and it is the first thing a hand-written reader gets wrong), a
 * `TZID` start, a UTC start, an all-day event, a weekly `RRULE` with an `EXDATE`, a cancelled event, and text with the
 * escapes a real export uses (`\,`, `\n`, `\;`).
 *
 * Nothing here touches the network: a file is the interface. The import must also be safe to run twice, which is what
 * the `UID` is for.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const FIXTURE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Team calendar",
  "X-WR-TIMEZONE:Europe/Warsaw",
  // A 75-octet fold: the summary continues on the next line, which starts with a space.
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Warsaw:20261120T120000",
  "DTEND;TZID=Europe/Warsaw:20261120T130000",
  "RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=5",
  "EXDATE;TZID=Europe/Warsaw:20261127T120000",
  "DTSTAMP:20261101T120000Z",
  "UID:lunch-1@google.com",
  "SUMMARY:Lunch\\, with Ann \\n and Bob",
  "DESCRIPTION:Booked by the team\\; bring notes",
  "LOCATION:Cafe \\\"At the corner\\\"",
  "STATUS:CONFIRMED",
  "END:VEVENT",
  // A UTC start and a plain timed end.
  "BEGIN:VEVENT",
  "DTSTART:20261201T090000Z",
  "DTEND:20261201T100000Z",
  "UID:utc-1@google.com",
  "SUMMARY:Standup",
  "END:VEVENT",
  // An all-day event: VALUE=DATE, and its end is the day after the last day (exclusive).
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261224",
  "DTEND;VALUE=DATE:20261225",
  "UID:allday-1@google.com",
  "SUMMARY:Christmas Eve",
  "END:VEVENT",
  // Cancelled: it is in the file but the person does not want it.
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Warsaw:20261125T150000",
  "UID:cancelled-1@google.com",
  "SUMMARY:Cancelled meeting",
  "STATUS:CANCELLED",
  "END:VEVENT",
  // Without a start there is nothing to place on a calendar.
  "BEGIN:VEVENT",
  "UID:broken-1@google.com",
  "SUMMARY:Nowhere",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }

test("the file unfolds, and every event comes out with what the calendar needs", () => {
  const parsed = C.parseIcs(FIXTURE);
  assert.equal(parsed.events.length, 5, "all five events are read, including the one that cannot be placed");
  assert.equal(parsed.events[0].calendar, "Team calendar", "the calendar's own name is kept");
  const lunch = parsed.events[0];
  assert.equal(lunch.uid, "lunch-1@google.com");
  assert.equal(lunch.summary, "Lunch, with Ann \n and Bob", "escaped comma and newline come back as text");
  assert.equal(lunch.description, "Booked by the team; bring notes");
  assert.equal(lunch.location, 'Cafe "At the corner"');
  // 12:00 in Warsaw on 20 November 2026 is 11:00 UTC (CET, +1).
  assert.equal(new Date(lunch.startMs).toISOString(), "2026-11-20T11:00:00.000Z", "a TZID clock is read in that zone");
  assert.equal(new Date(lunch.endMs).toISOString(), "2026-11-20T12:00:00.000Z");
  assert.equal(lunch.allDay, false);
  assert.deepEqual(lunch.recurrence, ["RRULE:FREQ=WEEKLY;COUNT=5;BYDAY=FR"], "the rule keeps the calendar's own words");
  assert.deepEqual(lunch.exceptions, ["2026-11-27T11:00:00.000Z"], "the EXDATE is the instant the series skips");
  const utc = parsed.events[1];
  assert.equal(new Date(utc.startMs).toISOString(), "2026-12-01T09:00:00.000Z", "a Z time is already an instant");
  const allDay = parsed.events[2];
  assert.equal(allDay.allDay, true);
  assert.equal(new Date(allDay.startMs).getUTCDate(), 24);
  assert.equal(parsed.events[3].cancelled, true);
  assert.ok(parsed.warnings.some((w) => w.startsWith("no-start:")), "an event without a start says so");
  assert.equal(parsed.events[4].unreadable, true, "and it is still in the list, so the import can name it");
});

test("an event becomes one calendar item: an all-day date, a timed instant, and a stable UID", () => {
  const parsed = C.parseIcs(FIXTURE);
  const now = Date.parse("2026-11-17T10:00:00Z");
  const timed = C.icsToItem(parsed.events[0], { kind: "event", now, zone: "Europe/Warsaw" });
  assert.equal(timed.summary, "Lunch, with Ann \n and Bob");
  assert.equal(timed.start.dateTime, "2026-11-20T11:00:00.000Z");
  assert.equal(timed.end.dateTime, "2026-11-20T12:00:00.000Z");
  assert.equal(timed.x.kind, "event");
  assert.equal(timed.x.src, "ics");
  assert.equal(timed.x.icsUid, "lunch-1@google.com", "the UID is what makes a second import an update");
  assert.equal(timed.x.tz, "Europe/Warsaw");
  assert.deepEqual(timed.recurrence, ["RRULE:FREQ=WEEKLY;COUNT=5;BYDAY=FR"]);
  assert.equal(timed.x.recurrenceExceptions.length, 1);
  assert.equal(timed.x.recurrenceExceptions[0].cancelled, true);

  const allDay = C.icsToItem(parsed.events[2], { kind: "event", now, zone: "Europe/Warsaw" });
  assert.equal(allDay.start.date, "2026-12-24", "an all-day event is a date, not an instant");
  assert.equal(allDay.end.date, "2026-12-25");
  assert.equal(allDay.x.kind, "event");

  const reminder = C.icsToItem(parsed.events[1], { kind: "reminder", now });
  assert.equal(reminder.x.kind, "reminder", "the person chooses whether the file's events remind them");
  assert.equal(reminder.summary, "Standup");
});

test("an import plan separates new from updated, and skips what it cannot use", () => {
  const parsed = C.parseIcs(FIXTURE);
  const now = Date.parse("2026-11-17T10:00:00Z");
  const first = C.planIcsImport(parsed, [], { kind: "event", now, zone: "Europe/Warsaw" });
  assert.equal(first.add.length, 3, "three usable events on a first import");
  assert.equal(first.update.length, 0);
  assert.equal(first.skipped.length, 2, "the cancelled one and the one without a start");
  assert.deepEqual(first.skipped.map((s) => s.reason).sort(), ["cancelled", "unreadable"]);
  assert.equal(first.from, Date.parse("2026-11-20T11:00:00Z"), "the range runs from the earliest event");
  assert.ok(first.to >= Date.parse("2026-12-24T00:00:00Z"), "and to the latest");

  // A second import of the same file on top of the first: everything matches on its UID, nothing is duplicated.
  const second = C.planIcsImport(parsed, first.add, { kind: "event", now, zone: "Europe/Warsaw" });
  assert.equal(second.add.length, 0, "nothing is added twice");
  assert.equal(second.update.length, 3, "the same three are updates of what is already there");
  for (const entry of second.update) assert.equal(entry.item.x.icsUid, entry.existing.x.icsUid);

  // An item moved in the file is an update, not a second copy.
  const moved = FIXTURE.replace("DTSTART;TZID=Europe/Warsaw:20261120T120000", "DTSTART;TZID=Europe/Warsaw:20261120T140000");
  const third = C.planIcsImport(C.parseIcs(moved), first.add, { kind: "event", now, zone: "Europe/Warsaw" });
  assert.equal(third.add.length, 0);
  assert.equal(third.update.length, 3);
  assert.equal(third.update.find((u) => u.item.x.icsUid === "lunch-1@google.com").item.start.dateTime, "2026-11-20T13:00:00.000Z");
});

test("what the reader does not understand is reported, never guessed", () => {
  const odd = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:odd-1",
    "DTSTART:20261201T090000Z",
    "RRULE:FREQ=HOURLY;COUNT=3",
    "SUMMARY:Hourly",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:odd-2",
    "DTSTART:not-a-date",
    "SUMMARY:Bad",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n");
  const parsed = C.parseIcs(odd);
  assert.ok(parsed.warnings.includes("unsupported-frequency:FREQ=HOURLY;COUNT=3"), "an hourly rule is said out loud");
  assert.equal(parsed.events[0].recurrence.length, 0, "and is not turned into some other rule");
  assert.ok(parsed.warnings.includes("no-start:odd-2"));
  // Junk never throws.
  assert.deepEqual(C.parseIcs("").events, []);
  assert.deepEqual(C.parseIcs(null).events, []);
  assert.equal(C.icsProperty("no colon here"), null);
  assert.deepEqual(C.planIcsImport(null, null).add, []);
});

test("a fold is undone wherever it appears, and a quoted parameter may hold a colon", () => {
  const folded = ["BEGIN:VEVENT", "UID:f1", "DTSTART:20261201T090000Z", "SUMMARY:A long summary that was folded after seventy-", " five octets", "DESCRIPTION:Line one\\nLine two", "END:VEVENT"].join("\r\n");
  const parsed = C.parseIcs(folded);
  assert.equal(parsed.events[0].summary, "A long summary that was folded after seventy-five octets");
  assert.equal(parsed.events[0].description, "Line one\nLine two");
  const quoted = C.icsProperty('DTSTART;TZID="America/New_York":20261201T090000');
  assert.equal(quoted.params.TZID, "America/New_York");
  assert.equal(quoted.value, "20261201T090000");
  const withColon = C.icsProperty('ATTENDEE;CN="Doe, Jane":mailto:jane@example.com');
  assert.equal(withColon.value, "mailto:jane@example.com", "the first colon outside quotes splits the line");
});

test("a zone the browser does not know falls back to the person's own clock, not to UTC", () => {
  const parsed = C.parseIcs(["BEGIN:VEVENT", "UID:z1", "DTSTART;TZID=Mars/Olympus:20261201T090000", "SUMMARY:Somewhere", "END:VEVENT"].join("\r\n"));
  const item = C.icsToItem(parsed.events[0], { kind: "event", now: Date.now() });
  assert.ok(item, "it still becomes an item");
  const local = new Date(2026, 11, 1, 9, 0, 0).getTime();
  assert.equal(Date.parse(item.start.dateTime), local, "the wall clock is kept as written");
  // A zone the browser cannot resolve is not recorded as one: `tz` is only kept when it is a real zone, and the wall
  // clock above is what the person sees either way.
  assert.equal(item.x.tz, "");
});

test("the source file itself has no other job: no writes, no network, no clock of its own", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js"), "utf8");
  const block = source.slice(source.indexOf("// ---------- OW-53:"), source.indexOf("// ---------- items inside a note (roadmap T2.3) ----------"));
  assert.ok(block.length > 2000, "the reader is there");
  for (const banned of ["fetch(", "XMLHttpRequest", "IOUtils", "PathUtils", "setTimeout"]) assert.ok(!block.includes(banned), "no " + banned + " in the reader");
  assert.match(block, /function parseIcs\(text\)/);
  assert.match(block, /function planIcsImport\(parsed, existing/);
});

// ---- the real sheet, end to end --------------------------------------------------------------------------------
// The file comes from `env.pickIcs`, which is how every other picker in the module is reached. The fake host does not
// inject an env, so this end-to-end run is driven through the same two steps the card takes: the file is read, then the
// plan is written. The card's own wiring is asserted in the source check below, and its pure halves are covered above.
(async () => {
  const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
  const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
  const h = createFakeZen({ prefs: { "zen.workspace.zentral.notes.zen_folder": "all" } });
  try {
    await h.seam.ensureStore();
    h.fireTimer(6500);
    await settle();
    const items = h.seam.store.items;
    const now = Date.now();
    const plan = C.planIcsImport(C.parseIcs(FIXTURE), items.list({}), { kind: "event", now });
    assert.equal(plan.add.length, 3);
    for (const item of plan.add) assert.ok(items.upsert(item), "the store accepts every planned item");
    await settle();
    assert.equal(items.list({}).length, 3, "three items are in the real store");
    assert.ok(items.list({}).every((item) => item.x.src === "ics" && item.x.icsUid), "marked and identified");
    // The second run finds them by UID and writes nothing new.
    const second = C.planIcsImport(C.parseIcs(FIXTURE), items.list({}), { kind: "event", now });
    assert.equal(second.add.length, 0);
    assert.equal(second.update.length, 3);
    const beforeCount = items.list({}).length;
    for (const entry of second.update) {
      const next = { ...entry.item, id: entry.existing.id, created: entry.existing.created, rev: entry.existing.rev };
      items.upsert(next);
    }
    await settle();
    assert.equal(items.list({}).length, beforeCount, "an update never duplicates");
  } finally {
    await h.destroy();
  }
  console.log("ok - the real store takes the plan, and a second import updates instead of duplicating");
  passed++;

  // ---- the plan is what gets written, in one pass ------------------------------------------------
  const now = Date.parse("2026-11-17T10:00:00Z");
  const plan = C.planIcsImport(C.parseIcs(FIXTURE), [], { kind: "reminder", now, zone: "Europe/Warsaw" });
  assert.ok(plan.add.every((item) => item.x.kind === "reminder"), "the person's choice decides what the file becomes");
  for (const item of plan.add) {
    assert.ok(C.cleanItem(item, now), "every planned item survives the store's own validation");
    assert.equal(item.x.src, "ics");
    assert.ok(item.x.icsUid, "and keeps the identity a second import needs");
  }
  test("the card is wired into the calendar's own tools, and writes only on Import", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  // Reachable from Calendar → Tools, with its own row.
  assert.match(src, /id: "calendar-import-ics"[^\n]*askCalendarIcsImport/);
  // It reads the file through the env (like every other picker), and asks the pure layer for the plan.
  assert.match(src, /function pickIcsFile\(\)[\s\S]{0,400}env\.pickIcs/);
  assert.ok(src.includes("exportCalendarWeek, printCalendarWeek, exportReminderHistory, pickIcs, saveIcs"), "the picker and the saver are in the env");
  assert.match(src, /function askCalendarIcsImport\(\)[\s\S]{0,3000}planIcsImport/);
  // Every write sits behind the Import button: the card draws first, and only `go` calls the writer.
  const card = src.slice(src.indexOf("function askCalendarIcsImport()"), src.indexOf("async function importIcsPlan("));
  assert.ok(!card.includes("items.upsert"), "the card itself never writes");
  assert.match(card, /go\.addEventListener\("click"[\s\S]{0,200}importIcsPlan/);
  // The sheet has a door for it, and the seam exposes that door.
  assert.match(src, /openIcsImport: \(\) => \{[\s\S]{0,200}askCalendarIcsImport\(\)/);
  assert.match(src, /openIcsImport: \(\) => showNotes\(""\)/);
  // A second import keeps what the person changed here.
  const writer = src.slice(src.indexOf("async function importIcsPlan("), src.indexOf("async function importIcsPlan(") + 1600);
  for (const keep of ["color", "noteId", "category"]) assert.ok(writer.includes(keep), "an update keeps the " + keep);
});

console.log(`\n${passed} passed`);
})().catch((error) => { console.error(error); process.exit(1); });
