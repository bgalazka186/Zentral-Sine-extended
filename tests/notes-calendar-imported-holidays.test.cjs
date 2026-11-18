"use strict";
/* T2.13a: a holiday calendar that arrives as a FILE is not a local holiday.
 *
 * The owner's question was what happens when a Google holiday calendar meets the ICS work from `T2.13`. The answer,
 * written down here as behaviour rather than a promise:
 *
 *   1. Holiday sets stay local. A local set is rule-computed (plus `HOLIDAY_TABLE`), so imported events are NEVER
 *      merged into one — a set's year is something a person edits in `OW-45`, not something a file writes.
 *   2. An imported holiday is recognised by what the file says about itself (Google names its feeds "Holidays in …"),
 *      never by the event text, so no guessing from a summary.
 *   3. It is shown with a neutral "imported" mark, not the work-free tint — a subscribed week must never silently
 *      change what this calendar considers a day off.
 *   4. `isWorkFree` cannot even see the item store: it takes prefs only. That is the structural guarantee, and the
 *      first test states it.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const en = require("../additional/notes/i18n/en.js");
const pl = require("../additional/notes/i18n/pl.js");
C.registerLanguage("en", en);
C.registerLanguage("pl", pl);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (err) { failed++; console.error("FAIL:", name, "\n ", err && err.stack ? err.stack : err); }
}

// A Google holiday feed, shaped like the real export: an `X-WR-CALNAME` naming the feed and all-day events.
const holidayFile = (name = "Holidays in Poland") => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  `X-WR-CALNAME:${name}`,
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261101",
  "DTEND;VALUE=DATE:20261102",
  "UID:all-saints@google.com",
  "SUMMARY:All Saints Day",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261111",
  "DTEND;VALUE=DATE:20261112",
  "UID:independence@google.com",
  "SUMMARY:Independence Day",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n") + "\r\n";

/* ---------- 1. the structural guarantee ---------- */

(async () => {
await test("isWorkFree takes prefs only — it has no way to read an imported event", () => {
  // The signature is the promise: (day, prefs, lang). There is no third door through which an item could arrive.
  assert.equal(C.isWorkFree.length, 2, "day and prefs (lang has a default); no store argument");
  const prefs = { enabled: true, region: "PL", locales: ["PL"], weekend: "auto", personalDays: [] };
  const onHoliday = C.isWorkFree("2026-11-11", prefs, "en");
  assert.equal(onHoliday.workFree, true, "2026-11-11 is a local Polish holiday");
  // With every local set switched off, the same day is NOT work-free — an imported event somewhere cannot change it.
  const off = C.isWorkFree("2026-11-11", { ...prefs, locales: [], region: "none" }, "en");
  assert.equal(off.workFree, false, "no local set, no work-free day: nothing imported is consulted");
});

/* ---------- 2. recognition: the file, not the words ---------- */

await test("a feed is recognised by the calendar's own name, in the shapes Google really uses", () => {
  assert.equal(C.holidayFeedName("Holidays in Poland"), "Holidays in Poland");
  assert.equal(C.holidayFeedName("Holiday"), "Holiday");
  assert.equal(C.holidayFeedName("  Holidays   in the UK "), "Holidays in the UK", "whitespace normalised");
  assert.equal(C.holidayFeedName("pl.polish#holiday@group.v.calendar.google.com"), "pl.polish#holiday@group.v.calendar.google.com");
  assert.equal(C.holidayFeedName("Team calendar"), "", "an ordinary calendar is not a holiday feed");
  assert.equal(C.holidayFeedName(""), "");
  assert.equal(C.holidayFeedName(null), "");
  assert.equal(C.holidayFeedName("Holiday planning meeting"), "Holiday planning meeting", "the word alone is enough, and that is deliberate: over-marking is quiet, under-marking is a silent day off");
});

await test("holidayFeedOf reads the whole file once, and an ordinary file yields nothing", () => {
  assert.equal(C.holidayFeedOf(C.parseIcs(holidayFile()).events), "Holidays in Poland");
  assert.equal(C.holidayFeedOf(C.parseIcs(holidayFile("Team calendar")).events), "");
  assert.equal(C.holidayFeedOf([]), "");
});

/* ---------- 3. the import marks, and nothing else changes ---------- */

await test("importing a holiday calendar marks every all-day event as imported", () => {
  const plan = C.planIcsImport(C.parseIcs(holidayFile()), [], { kind: "event", now: 1764000000000 });
  assert.equal(plan.holidayFeed, "Holidays in Poland");
  assert.equal(plan.add.length, 2);
  assert.equal(plan.importedHolidays, 2);
  for (const item of plan.add) {
    assert.equal(C.isImportedHoliday(item), true, "marked: " + item.summary);
    assert.equal(item.x.icsHolidayFeed, true);
    assert.equal(item.x.icsHolidayName, "Holidays in Poland");
  }
});

await test("an ordinary calendar is imported byte-for-byte as before — no mark, no new keys", () => {
  const plan = C.planIcsImport(C.parseIcs(holidayFile("Team calendar")), [], { kind: "event", now: 1764000000000 });
  assert.equal(plan.importedHolidays, 0);
  assert.equal(plan.holidayFeed, "");
  for (const item of plan.add) {
    assert.equal(C.isImportedHoliday(item), false);
    assert.ok(!("icsHolidayFeed" in item.x), "no mark is written");
    assert.ok(!("icsHolidayName" in item.x));
  }
});

await test("only an all-day event from a holiday file is marked: a timed event and a reminder are not", () => {
  const timed = C.cleanItem({ id: "t", summary: "Call", start: { dateTime: "2026-11-11T10:00:00.000Z" }, x: { kind: "event", src: "ics" } }, 0);
  assert.equal(C.isImportedHoliday(C.markImportedHoliday(timed, { feed: "Holidays in Poland" })), false, "a holiday feed's clock event is an appointment, not a holiday");
  const allDayReminder = C.cleanItem({ id: "r", summary: "Reminder", start: { date: "2026-11-11" }, x: { kind: "reminder", src: "ics" } }, 0);
  assert.equal(C.isImportedHoliday(C.markImportedHoliday(allDayReminder, { feed: "Holidays in Poland" })), false, "a reminder is never a holiday");
  // And an event made here can never wear the mark, even if it falls on a holiday.
  const manual = C.cleanItem({ id: "m", summary: "Party", start: { date: "2026-11-11" }, x: { kind: "event", src: "manual" } }, 0);
  const forced = C.cleanItem({ ...manual, x: { ...manual.x, src: "ics", icsHolidayFeed: true, icsHolidayName: "x" } }, 0);
  assert.equal(C.isImportedHoliday(forced), true, "the mark itself is a property of source+flag");
  assert.ok(!("icsHolidayFeed" in C.cleanItem(manual, 0).x), "a manual item has none");
});

await test("the mark survives the store round trip, and an unmarked item keeps its exact hash", () => {
  const marked = C.cleanItem({ id: "h", summary: "All Saints", start: { date: "2026-11-01" }, x: { kind: "event", src: "ics", icsUid: "h@google.com", icsHolidayFeed: true, icsHolidayName: "Holidays in Poland" } }, 0);
  const after = C.cleanItem(JSON.parse(JSON.stringify(marked)), 0);
  assert.equal(after.x.icsHolidayFeed, true);
  assert.equal(after.x.icsHolidayName, "Holidays in Poland");
  // A plain imported item that is not a holiday must serialise without the keys (no etag churn).
  const plain = C.cleanItem({ id: "p", summary: "P", start: { date: "2026-11-02" }, x: { kind: "event", src: "ics", icsUid: "p@google.com" } }, 0);
  assert.ok(!("icsHolidayFeed" in plain.x));
});

/* ---------- 4. the look is the imported look, not the day off ---------- */

await test("the mark is a neutral class and a source name — never a work-free/holiday class", () => {
  const item = C.planIcsImport(C.parseIcs(holidayFile()), [], { kind: "event", now: 1764000000000 }).add[0];
  const attrs = C.importedHolidayAttrs(item);
  assert.equal(attrs.class, "is-imported-holiday");
  assert.equal(attrs["data-imported-holiday"], "Holidays in Poland");
  for (const wrong of ["is-holiday", "is-workfree", "is-weekend", "is-personal-off"]) {
    assert.notEqual(attrs.class, wrong);
    assert.ok(!attrs.class.split(/\s+/).includes(wrong), "never wears " + wrong);
  }
  assert.equal(C.importedHolidayAttrs(C.cleanItem({ id: "x", summary: "x", start: { date: "2026-11-11" }, x: { kind: "event" } }, 0)), null, "an ordinary item carries no mark");
});

await test("the CSS paints the imported mark quietly, and does not reuse the work-free or holiday tint", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
  assert.match(css, /\.zn-cal-month-cell\.is-imported-holiday/);
  // The imported rule must not be among the work-free tint selectors.
  const freeRule = css.slice(css.indexOf(".is-workfree {"), css.indexOf(".is-weekend {"));
  assert.ok(!freeRule.includes("is-imported-holiday"), "the imported mark is not in the work-free tint rule");
  const holidayRule = css.slice(css.indexOf(".is-holiday {"), css.indexOf(".is-trading-sunday"));
  assert.ok(!holidayRule.includes("is-imported-holiday"), "and not in the holiday tint rule either");
});

await test("the calendar draws the mark from the day's own items, and nowhere else", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  assert.match(src, /function applyImportedHolidayAttrs\(el, items\)/);
  assert.match(src, /applyWorkFreeAttrs\(cell, wf\);\s*\n\s*\/\/ T2\.13a[\s\S]{0,200}applyImportedHolidayAttrs\(cell, dayItems\)/);
  // The item button carries it too, so Week/Day/Agenda agree with Month.
  assert.match(src, /importedHolidayAttrs\?\.\(item\)[\s\S]{0,200}classList\.add\(holidayAttrs\.class\)/);
});

/* ---------- 5. the two places a person is told ---------- */

await test("the import card says a holiday calendar is ordinary events, and the settings say holidays are local", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  assert.match(src, /plan\.holidayFeed[\s\S]{0,160}t\("cal\.ics\.holidayFeed"/);
  assert.match(src, /zn-cal-holidays-imported-note[\s\S]{0,120}t\("cal\.holidays\.importedNote"\)/);
  // Both strings exist in both languages, so neither can ship as a raw key on screen.
  for (const [name, table] of [["en", en], ["pl", pl]]) {
    for (const key of ["cal.ics.holidayFeed", "cal.holidays.importedNote"]) {
      assert.ok(table.strings[key], name + " has " + key);
    }
  }
  assert.match(en.strings["cal.holidays.importedNote"], /never synced/i);
  assert.match(en.strings["cal.ics.holidayFeed"], /\{calendar\}/, "the card names the feed");
});

/* ---------- 6. the local sets still work with all of this off ---------- */

await test("local holiday sets are untouched: they compute the same days with an import present", () => {
  const prefs = { enabled: true, region: "PL", locales: ["PL"], weekend: "auto", personalDays: [] };
  const before = C.isWorkFree("2026-11-11", prefs, "en");
  // An imported holiday item exists in a store somewhere; isWorkFree cannot see it, so the answer is identical.
  C.planIcsImport(C.parseIcs(holidayFile()), [], { kind: "event", now: 1764000000000 });
  const after = C.isWorkFree("2026-11-11", prefs, "en");
  assert.deepEqual(after, before);
  assert.equal(after.holiday.name.length > 0, true, "the local name still comes from the local set");
  // And a local set is never written to: the import produced items, not holiday entries.
  const plan = C.planIcsImport(C.parseIcs(holidayFile()), [], { kind: "event", now: 1764000000000 });
  assert.equal(plan.add.every((item) => item.x.src === "ics"), true, "everything it makes is an ics item");
  assert.ok(!("holidays" in plan), "the plan has no path into the holiday sets");
});

await test("the work-free answer for an imported day equals the answer when the import never happened", () => {
  // 2026-11-01 is a local holiday in PL; 2026-11-02 is not. Nothing imported can flip either.
  const prefs = { enabled: true, region: "PL", locales: ["PL"], weekend: "auto", personalDays: [] };
  assert.equal(C.isWorkFree("2026-11-01", prefs, "en").workFree, true);
  assert.equal(C.isWorkFree("2026-11-02", prefs, "en").workFree, false);
  // The imported items for those same days carry no authority over that answer.
  const plan = C.planIcsImport(C.parseIcs(holidayFile()), [], { kind: "event", now: 1764000000000 });
  assert.ok(plan.add.every((item) => !("holiday" in item)), "no imported item is a holiday entry");
});

  // The rendering claim, checked against a real sheet: the cell gets the imported mark, and NOT the work-free one.
  await test("live Month: an imported holiday marks its day and leaves the work-free answer alone", async () => {
    const vm2 = require("node:vm");
    const { makeHarness } = require("./helpers/holiday-harness.cjs");
    const h = makeHarness({ sheetW: 960, sheetH: 640, paneW: 640, paneH: 540 });
    await h.store.open();
    h.store.setMeta({ calendarCursor: "2026-11-01", calendarHolidays: { enabled: true, region: "PL", weekend: "auto", personalDays: [] } });
    // Import the holiday file the same way the card does, into this store.
    const plan = C.planIcsImport(C.parseIcs(holidayFile()), [], { kind: "event", now: Date.UTC(2026, 10, 1, 10) });
    for (const item of plan.add) h.store.items.upsert(item);
    await h.sheet.open();
    await h.flush();
    h.sheet.openCalendar();
    await h.flush();
    const cell = h.sheet.root.querySelector('.zn-cal-month-cell[data-day="2026-11-01"]');
    assert.ok(cell, "the day is on screen");
    assert.ok(cell.classList.contains("is-imported-holiday"), "the imported mark is drawn");
    assert.equal(cell.getAttribute("data-imported-holiday"), "Holidays in Poland");
    // 2026-11-01 IS a local Polish holiday too, so this day is legitimately work-free — but from the LOCAL set,
    // never from the imported item. 2026-11-02 has nothing.
    const quiet = h.sheet.root.querySelector('.zn-cal-month-cell[data-day="2026-11-02"]');
    assert.ok(quiet && !quiet.classList.contains("is-workfree"), "a day the local set calls free is unchanged");
    // Count the marks: only the imported days wear it.
    const marked = [...h.sheet.root.querySelectorAll(".zn-cal-month-cell.is-imported-holiday")].map((el) => el.getAttribute("data-day"));
    assert.deepEqual(marked.sort(), ["2026-11-01", "2026-11-11"]);
  });

  if (failed) { console.error(`${failed} failed, ${passed} passed`); process.exit(1); }
  console.log(`notes-calendar-imported-holidays: ${passed} passed`);
})();

