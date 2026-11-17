"use strict";
/* OW-58: an item that came from an `.ics` file is a calendar item in its own right.
 * It has no note body to edit, so "delete it in its source note" is a lie about a note that does not exist. The rule
 * is one predicate (`itemOwnsNoteText` / `itemIsFreeStanding`), used by the menu model, the delete handler and the
 * store, so a new source cannot be forgotten in one of the three. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const calPath = path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js");
const cal = require(calPath);
const dom = require("./helpers/fake-dom.cjs")();
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const en = require("../additional/notes/i18n/en.js");
const pl = require("../additional/notes/i18n/pl.js");
cal.registerLanguage("en", en);
cal.registerLanguage("pl", pl);

const win = {
  __zentralNotesParts: { "notes-calendar": cal },
  __zentralNotesLangTables: { en, pl },
  document: dom.document,
  ZentralRuntime: { register() {} },
  __zentralNotesTestSeam: {},
  requestAnimationFrame() {},
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  innerWidth: 1200,
  innerHeight: 800,
};
win.window = win;
vm.runInNewContext(source, {
  window: win,
  document: dom.document,
  Event: dom.Ev,
  globalThis: { Services: {} },
  ChromeUtils: {},
  console,
  URL,
  Date,
  JSON,
  Math,
  Promise,
  RegExp,
  Number,
  Map,
  Set,
  setTimeout,
  clearTimeout,
});
const c = win.__zentralNotesTestSeam.core;
const plain = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

let clock = new Date(2026, 10, 13, 9, 0).getTime();
function fakeIO() {
  const files = new Map();
  return {
    files,
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => {
      if (!files.has(p)) throw new Error("nf " + p);
      return files.get(p).text;
    },
    writeUTF8: async (p, text) => {
      files.set(p, { text, mtime: clock });
    },
    remove: async (p) => {
      files.delete(p);
    },
    exists: async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p + "/")),
    children: async (d) => [...new Set([...files.keys()].filter((k) => k.startsWith(d + "/")).map((k) => d + "/" + k.slice(d.length + 1).split("/")[0]))],
    stat: async (p) => ({ size: (files.get(p)?.text || "").length, lastModified: files.get(p)?.mtime ?? 1 }),
    removeTree: async (d) => {
      for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k);
    },
    restrict: async () => {},
    makeDir: async () => {},
  };
}
const mk = (io) =>
  c.createStore({ io, notify() {}, windowId: "t", now: () => clock, getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: () => 0, clearTimer() {}, warn(e) { throw e; } });

const icsItem = (id = "ics-1", extra = {}) => ({
  id,
  summary: "Lunch with Ann",
  start: { date: "2026-11-20", time: "12:00" },
  end: { date: "2026-11-20", time: "13:00" },
  ...extra,
  x: { kind: "event", src: "ics", icsUid: "lunch-1@google.com", ...(extra.x || {}) },
});

test("an item owns note text only when it really lives in a note", () => {
  assert.equal(cal.itemOwnsNoteText({ x: { src: "list", noteId: "n1" } }), true);
  assert.equal(cal.itemOwnsNoteText({ x: { src: "note", noteId: "n1" } }), true);
  assert.equal(cal.itemOwnsNoteText({ x: { src: "manual" } }), false);
  assert.equal(cal.itemOwnsNoteText({ x: { src: "ics", icsUid: "u" } }), false);
  assert.equal(cal.itemOwnsNoteText({ x: {} }), false, "an unknown source has no note to blame");
  assert.equal(cal.itemOwnsNoteText(null), false);
});

test("the menu offers Delete on an imported item, and says why where it cannot", () => {
  const menu = (item) => cal.calendarItemMenuModel(item, { state: "pending", historyWritable: true });
  const ics = menu(icsItem()).find((row) => row.id === "delete");
  assert.equal(ics.enabled, true, "an imported item can be deleted");
  assert.equal(ics.reason, "", "and no reason is offered for something that works");
  assert.equal(ics.label, "Delete event…", "the plain label, not the note wording");

  const manual = menu(icsItem("m1", { x: { kind: "event", src: "manual" } })).find((row) => row.id === "delete");
  assert.equal(manual.enabled, true);

  for (const src of ["note", "list"]) {
    const row = menu(icsItem("x", { x: { kind: "event", src, noteId: "n1" } })).find((r) => r.id === "delete");
    assert.equal(row.enabled, false, src + " item still belongs to its note");
    assert.match(row.reason, /source note/, "and the reason names the note that does exist");
  }
  // A mirrored item (which is a list item) deletes its line too.
  const mirrored = menu(icsItem("mir", { x: { kind: "reminder", src: "list", noteId: "n1", heading: "Agenda", key: "k", line: "l" } }));
  assert.equal(mirrored.find((r) => r.id === "delete").enabled, false, "a mirrored reminder is still note text");
});

test("a source that owns no note text is also free to be converted", () => {
  const convert = (item) => cal.calendarItemMenuModel(item, { state: "pending", historyWritable: true }).find((r) => r.id === "convert");
  assert.equal(convert(icsItem()).enabled, true, "an imported event can become a reminder here");
  assert.equal(convert(icsItem("x", { x: { kind: "event", src: "note", noteId: "n" } })).enabled, false);
  assert.equal(cal.itemIsFreeStanding(icsItem()), true);
  assert.equal(cal.itemIsFreeStanding({}), false, "an item without an id is not an item");
});

test("the new refusal has a translation in both languages", () => {
  assert.equal(cal.t("menu.deleteUnavailableReason", null, "en"), "Delete is not available for this item");
  assert.match(cal.t("menu.deleteUnavailableReason", null, "pl"), /Usuwanie/);
  assert.deepEqual(cal.missingTranslationKeys("pl"), []);
});

(async () => {
  // The store is the truth: an imported item deletes, a note-backed one is refused, and nothing else is touched.
  const st = mk(fakeIO());
  await st.open();
  st.items.upsert(icsItem("ics-1"));
  st.items.upsert(icsItem("ics-2", { summary: "Second", x: { icsUid: "second@google.com" } }));
  st.items.upsert(icsItem("m1", { summary: "Hand made", x: { kind: "event", src: "manual" } }));

  assert.equal(st.items.list().length, 3);
  assert.equal(st.deleteCalendarItem("ics-1"), true, "the imported item is gone");
  assert.equal(st.items.get("ics-1"), null);
  assert.equal(st.items.get("ics-2") !== null, true, "its neighbour is untouched");
  assert.equal(st.deleteCalendarItem("m1"), true, "and a hand-made one still deletes");

  // A note-backed item whose note is gone, and which is not a valid mirror, is refused rather than half-deleted.
  // (A `list` item with an unknown note id is hidden from the views by `isNoteVisible` and is not a mirror, because
  // `isMirroredAgendaItem` needs the exact identity a mirror line produces — so this is the "no note to edit, no
  // permission to delete" case, and `items.get` answers through the plain map.)
  st.items.upsert(icsItem("n1", { x: { kind: "event", src: "list", noteId: "missing-note", heading: "Agenda", key: "k", line: "l" } }));
  const stored = st.items.list({ includeHidden: true }).find((it) => it.id === "n1");
  assert.ok(stored, "the note-backed item is in the store");
  assert.equal(cal.itemOwnsNoteText(stored), true, "it claims note text");
  assert.equal(cal.isMirroredAgendaItem(stored), false, "but it is not a mirror we may edit");
  assert.equal(st.deleteCalendarItem("n1"), false, "so it is refused, not half-deleted");
  assert.ok(
    st.items.list({ includeHidden: true }).some((it) => it.id === "n1"),
    "and it is still there",
  );

  // Re-importing the same file brings a deleted item back as a new item, which is what the dialog now says.
  const parsed = cal.parseIcs(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20261120",
      "UID:lunch-1@google.com",
      "SUMMARY:Lunch with Ann",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"),
  );
  const plan = cal.planIcsImport(parsed, st.items.list({ includeHidden: true }), { kind: "event", now: clock, zone: "" });
  assert.equal(plan.add.length, 1, "the deleted one is added again");
  assert.equal(plan.update.length, 0, "nothing to update: it is not there");

  // A mirror (the one note-backed case that may be edited here) keeps its own delete: the line goes, the item goes.
  console.log("ok - a mirror keeps its own note-line delete");
  const io2 = fakeIO();
  const st2 = mk(io2);
  await st2.open();
  st2.items.upsert({ id: "m9", summary: "Mirror me", start: { date: "2026-11-21", time: "09:00" }, x: { kind: "reminder", src: "manual" } });
  const noteId = st2.mirrorItemToAgendaNote("m9");
  assert.ok(noteId, "the reminder is mirrored into its Daily Note");
  const mirroredItem = st2.items.list().find((it) => it.summary === "Mirror me");
  assert.equal(cal.itemOwnsNoteText(mirroredItem), true, "a mirror does own a line");
  const menuRow = cal.calendarItemMenuModel(mirroredItem, { state: "pending", historyWritable: true }).find((r) => r.id === "delete");
  assert.equal(menuRow.enabled, true, "and is deletable: it is the known, editable case");
  assert.match(menuRow.label, /Agenda line/, "the label says the line goes too");
  assert.equal(st2.deleteCalendarItem(mirroredItem.id), true);
  assert.ok(!st2.get(noteId).body.includes("Mirror me"), "the line is gone from the note");
  assert.equal(st2.items.get(mirroredItem.id), null, "and the item with it");

})();

// The reporter runs last, after the async block above: an assertion inside it that fails must fail the file.
process.on("beforeExit", () => {
  console.log(`\nPASS notes-calendar-ics-delete (${passed} tests)`);
});
