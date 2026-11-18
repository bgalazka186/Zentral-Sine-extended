"use strict";
/* T2.13: the calendar written out as an `.ics`, and the round trip that makes it worth anything.
 *
 * The promise is narrow and testable: `import → export → import` is the same calendar. So the fixture here is the
 * import fixture — the same shape a Google export has, folds and escapes included — and the test asserts the strong
 * form of the promise: exporting what was imported and importing that back gives items that are identical on every
 * field that carries meaning (start, end, summary, description, location, recurrence, the reminder, the calendar name).
 *
 * Two things are deliberately *not* identical, and both are correct: the item's local etag (it is derived from what the
 * item holds, and the two imports are different objects), and its `rev`/`created`. Identity — the UID — is what has to
 * survive, because the UID is what makes a second import an update rather than a duplicate.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("  ok  " + name); };

const FIXTURE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Team calendar",
  "X-WR-TIMEZONE:Europe/Warsaw",
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
  "BEGIN:VALARM",
  "TRIGGER:-PT30M",
  "ACTION:DISPLAY",
  "DESCRIPTION:Reminder",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261119",
  "DTEND;VALUE=DATE:20261120",
  "DTSTAMP:20261101T120000Z",
  "UID:anniversary@google.com",
  "SUMMARY:Anniversary",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20261201T090000Z",
  "DTEND:20261201T093000Z",
  "DTSTAMP:20261101T120000Z",
  "UID:standup@google.com",
  "SUMMARY:Stand-up",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20261202T090000Z",
  "DTEND:20261202T093000Z",
  "DTSTAMP:20261101T120000Z",
  "UID:gone@google.com",
  "SUMMARY:Cancelled thing",
  "STATUS:CANCELLED",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n") + "\r\n";

// What carries meaning for a person: two items are "the same event" when these agree.
const MEANING = (it) => ({
  uid: it.x.icsUid || it.x.key || it.id,
  kind: it.x.kind,
  summary: it.summary,
  description: it.description,
  allDay: !!it.start.date,
  start: it.start.date || it.start.dateTime,
  end: it.end?.date || it.end?.dateTime || "",
  tz: it.x.tz || "",
  rrule: it.recurrence?.[0] || "",
  exdate: it.x.recurrenceExceptions ? JSON.stringify(it.x.recurrenceExceptions) : "",
  minutes: it.reminders?.overrides?.[0]?.minutes ?? null,
  calendar: it.x.icsCalendar || "",
});

const imported = () => C.planIcsImport(C.parseIcs(FIXTURE), [], { kind: "event", now: 1764000000000 }).add;

test("the fixture imports to three live events (the cancelled one stays out)", () => {
  const items = imported();
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.x.icsUid).sort(), ["anniversary@google.com", "lunch-1@google.com", "standup@google.com"]);
});

test("export is well-formed for every calendar app: VCALENDAR, CRLF, folded at 75 octets", () => {
  const out = C.icsFromItems(imported(), { now: 1764000000000, name: "Zentral Notes" });
  assert.equal(out.skipped.length, 0);
  assert.equal(out.count, 3);
  assert.match(out.text, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(out.text, /END:VCALENDAR\r\n$/);
  // A bare LF would be a malformed file: every line break in the output is part of a CRLF.
  assert.ok(!/(^|[^\r])\n/.test(out.text), "no bare LF anywhere in the file");
  // Nothing may be wider than 75 octets (UTF-8 octets, not characters) once unfolded.
  for (const line of out.text.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 76, "line too long: " + line);
  assert.equal((out.text.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.equal((out.text.match(/END:VEVENT/g) || []).length, 3);
});

test("each event keeps its own identity, so a re-import is an update and not a copy", () => {
  const out = C.icsFromItems(imported(), { now: 1764000000000 });
  for (const uid of ["lunch-1@google.com", "anniversary@google.com", "standup@google.com"]) {
    assert.ok(out.text.includes("UID:" + uid), "the file's own UID survives: " + uid);
  }
});

test("ROUND TRIP: import → export → import is the same calendar", () => {
  const first = imported();
  const file = C.icsFromItems(first, { now: 1764000000000, name: "Team calendar" }).text;
  const second = C.planIcsImport(C.parseIcs(file), [], { kind: "event", now: 1764000000000 }).add;
  assert.equal(second.length, first.length, "nothing gained, nothing lost");
  const before = first.map(MEANING).sort((a, b) => a.uid.localeCompare(b.uid));
  const after = second.map(MEANING).sort((a, b) => a.uid.localeCompare(b.uid));
  assert.deepEqual(after, before);
  // The times are the same instant, not merely the same looking clock: the TZID event is still 11:00Z.
  const lunch = second.find((i) => i.x.icsUid === "lunch-1@google.com");
  assert.equal(lunch.start.dateTime, "2026-11-20T11:00:00.000Z");
  assert.equal(lunch.x.tz, "Europe/Warsaw");
});

test("a second import of the exported file updates in place, never duplicates", () => {
  const first = imported();
  const file = C.icsFromItems(first, { now: 1764000000000 }).text;
  // Feed the exported file back against the very items it came from: every one is an update, none is an add.
  const plan = C.planIcsImport(C.parseIcs(file), first, { kind: "event", now: 1764000000000 });
  assert.equal(plan.add.length, 0, "no duplicates");
  assert.equal(plan.update.length, first.length, "every event is recognised as the one it already is");
});

test("what has no UID gets a stable derived one — the same item exported twice has the same UID", () => {
  const item = C.cleanItem({ id: "n1", summary: "Standalone", start: { dateTime: "2026-12-05T08:00:00.000Z" }, x: { kind: "event" } }, 0);
  const a = C.icsFromItems([item], { now: 1764000000000 }).text;
  const b = C.icsFromItems([item], { now: 1764999999999 }).text;
  const uidOf = (t) => t.match(/UID:([^\r]+)/)[1];
  assert.equal(uidOf(a), "n1@zentral-notes");
  assert.equal(uidOf(b), uidOf(a), "the derived UID does not depend on the clock");
});

test("a cancelled import never goes back out, and the card says nothing to export", () => {
  const cancelled = C.cleanItem({ id: "c1", summary: "Gone", start: { date: "2026-11-21" }, x: { kind: "event", src: "ics", icsUid: "c1@google.com", icsCancelled: true } }, 0);
  const out = C.icsFromItems([cancelled], { now: 1764000000000 });
  assert.equal(out.count, 0);
});

test("folding counts UTF-8 octets and never splits a 4-octet character", () => {
  // An emoji is four octets and two UTF-16 units: a fold that counts characters, or one that cuts inside the pair,
  // produces a file that other calendars read as a broken character. Sixty of them need a fold every 18 characters.
  const item = C.cleanItem({ id: "e1", summary: "\u{1F389}".repeat(60), start: { date: "2026-12-09" }, x: { kind: "event" } }, 0);
  const text = C.icsFromItems([item], { now: 1764000000000 }).text;
  for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line, "utf8") <= 76, "line too wide: " + line);
  const back = C.parseIcs(text).events[0].summary;
  assert.equal([...back].length, 60, "all sixty arrive");
  assert.ok([...back].every((ch) => ch === "\u{1F389}"), "each one is whole — no replaced or broken character");
});

// ---------- syncState: the bookkeeping a two-way sync reads ----------

test("syncStateOf: new → clean → changed → deleted", () => {
  const fresh = C.cleanItem({ id: "s1", summary: "A", start: { dateTime: "2026-12-06T10:00:00.000Z" }, x: { kind: "event" } }, 0);
  assert.equal(C.syncStateOf(fresh), "new");
  const synced = C.markSynced(fresh);
  assert.equal(C.syncStateOf(synced), "clean");
  assert.equal(synced.x.syncedEtag, synced.etag, "the etag written is the item's own");
  // A real edit goes through cleanItem and gets a fresh etag, which is now different from the synced one.
  const edited = C.cleanItem({ ...JSON.parse(JSON.stringify(synced)), summary: "B", etag: "" }, 0);
  assert.notEqual(edited.etag, synced.etag);
  assert.equal(C.syncStateOf(edited), "changed");
  assert.equal(C.syncStateOf(C.markSyncedDeleted(edited)), "deleted");
});

test("syncPlan groups a whole calendar, and counts what a pass has to do", () => {
  const mk = (id) => C.cleanItem({ id, summary: id, start: { date: "2026-12-0" + id.slice(1) }, x: { kind: "event" } }, 0);
  const a = C.markSynced(mk("n1")), b = C.markSynced(mk("n2")), c = mk("n3");
  // In a real pass a deleted item is a tombstone record, not a live one beside it.
  const tombstone = C.markSyncedDeleted(b);
  const plan = C.syncPlan([a, tombstone, c]);
  assert.equal(plan.new.length, 1, "c was never synced");
  assert.equal(plan.clean.length, 1, "a agrees with the other side");
  assert.equal(plan.deleted.length, 1, "the deletion mark wins over the etag it also carries");
  assert.equal(plan.pending, 2, "a pass has to push one new event and one deletion");
});

test("an item that never synced serialises exactly as before — no sync keys, no etag churn", () => {
  const plain = C.cleanItem({ id: "p1", summary: "P", start: { date: "2026-12-08" }, x: { kind: "event" } }, 0);
  assert.ok(!("syncedEtag" in plain.x));
  assert.ok(!("syncedDeleted" in plain.x));
  // And the round trip through JSON keeps it that way.
  assert.deepEqual(C.cleanItem(JSON.parse(JSON.stringify(plain)), 0).x, plain.x);
});

// ---------- the card and the seam ----------

test("the export is reachable from Calendar → Tools and saves through the env", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  assert.match(src, /id: "calendar-export-ics"[^\n]*askCalendarIcsExport/);
  assert.match(src, /function askCalendarIcsExport\(\)[\s\S]{0,2500}env\.saveIcs/);
  assert.ok(src.includes("pickIcs, saveIcs"), "the saver is in the env beside the picker");
  assert.match(src, /async function saveIcs\(text, baseName\)[\s\S]{0,400}IOUtils\.writeUTF8/);
  // Nothing is written until Export is pressed.
  const card = src.slice(src.indexOf("function askCalendarIcsExport()"), src.indexOf("function askCalendarIcsExport()") + 2600);
  assert.ok(!card.includes("IOUtils.write"), "the card itself never writes");
  assert.match(card, /go\.addEventListener\("click"[\s\S]{0,600}env\.saveIcs/);
  // Both directions are named in both languages, so neither can ship as a key the person sees.
  for (const file of ["en.js", "pl.js"]) {
    const i18n = fs.readFileSync(path.resolve(__dirname, "../additional/notes/i18n/" + file), "utf8");
    for (const key of ["cal.ics.exportTitle", "cal.ics.exportBtn", "cal.ics.exportDone", "cal.toolsMenu.exportIcs"]) {
      assert.ok(i18n.includes('"' + key + '"'), file + " has " + key);
    }
  }
});

console.log(`\n${passed} passed`);
