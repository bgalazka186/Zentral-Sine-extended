"use strict";
/* T2.14 integration: the display preference changes labels only; old formatted date notes and Journal headings remain findable. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const schema = JSON.parse(fs.readFileSync(path.join(root, "additional/notes/settings.json"), "utf8"));
const prefLayout = JSON.parse(fs.readFileSync(path.join(root, "extension/settings/layout.json"), "utf8"));
const standalone = JSON.parse(fs.readFileSync(path.join(root, "additional/notes/standalone.json"), "utf8"));
const calendar = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const seam = {};
const win = {
  __zentralNotesTestSeam: seam,
  __zentralNotesParts: { "notes-calendar": calendar },
  ZentralRuntime: { register() {} },
  addEventListener() {},
  removeEventListener() {},
};
win.window = win;
const services = { obs: { addObserver() {}, removeObserver() {} } };
vm.runInNewContext(source, {
  window: win,
  globalThis: { Services: services },
  ChromeUtils: {},
  URL,
  Date,
  JSON,
  Math,
  Promise,
  RegExp,
  Number,
  Map,
  Set,
  console,
});
const core = seam.core;
const PREF = "zen.workspace.zentral.notes.date_display_format";
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

test("date display preference is a real user-facing dropdown with the documented default", () => {
  const pref = schema.schema.find((item) => item.property === PREF);
  assert.ok(pref, "schema owns the date display preference");
  assert.equal(pref.type, "dropdown");
  assert.equal(pref.defaultValue, "DD-MM-YYYY");
  assert.deepEqual(pref.options.map((option) => option.value), ["DD-MM-YYYY", "YYYY-MM-DD", "MM/DD/YYYY", "DD.MM.YYYY", "DD/MM/YYYY", "long"]);
  assert.ok(prefLayout.order.includes(PREF), "full-pack settings layout includes it");
  assert.ok(standalone.preferenceOrder.includes(PREF), "standalone settings include it");
  assert.match(source, /DATE_DISPLAY:\s*["']zen\.workspace\.zentral\.notes\.date_display_format["']/);
  assert.match(source, /function\s+dateDisplayFormat\s*\(\)[\s\S]*?PREF\.DATE_DISPLAY/);
});
test("dateOfNote recognizes existing title styles and always returns the unchanged ISO key", () => {
  const rows = [
    { id: "iso", body: "# 2026-11-14 Saturday\n", updated: 1 },
    { id: "dash", body: "# 14-11-2026 Saturday\n", updated: 2 },
    { id: "slash-us", body: "# 11/14/2026\n", updated: 3 },
    { id: "dot", body: "# 14.11.2026\n", updated: 4 },
    { id: "slash-eu", body: "# 14/11/2026\n", updated: 5 },
    { id: "bad", body: "# 31/02/2026\n", updated: 6 },
    { id: "trash", body: "# 14-11-2026\n", updated: 7, trashed: true },
  ];
  for (const row of rows.slice(0, 5)) assert.equal(core.dateOfNote(row, "DD-MM-YYYY"), "2026-11-14", row.id);
  assert.equal(core.dateOfNote(rows[5], "DD/MM/YYYY"), "");
  assert.equal(core.dateOfNote(rows[6], "DD-MM-YYYY"), "");
  assert.equal(core.findDateNote(rows, "2026-11-14", "DD-MM-YYYY").id, "slash-eu");
  const listed = core.listDateNotes(rows, { dateFormat: "MM/DD/YYYY" });
  assert.deepEqual(Array.from(listed, (entry) => entry.note.id), ["slash-eu", "dot", "slash-us", "dash", "iso"]);
});
test("Journal lookup recognizes alternate heading formats and does not duplicate an existing day", () => {
  const body = "# Journal\n\n## 14.11.2026 Saturday\n\nExisting entry\n\n## 15/11/2026\n\nNext day\n";
  assert.deepEqual(Array.from(core.journalDays(body, "DD.MM.YYYY")), ["2026-11-14", "2026-11-15"]);
  const existing = core.journalSection(body, "2026-11-14", new Date(2026, 10, 14, 12).getTime(), "YYYY-MM-DD");
  assert.equal(existing.created, false);
  assert.match(existing.body, /Existing entry/);
  assert.equal((existing.body.match(/^## /gm) || []).length, 2);
  const added = core.journalSection(body, "2026-11-16", new Date(2026, 10, 16, 12).getTime(), "DD-MM-YYYY");
  assert.equal(added.created, true);
  assert.match(added.body, /^## 2026-11-16 Monday$/m, "new Daily headings remain ISO until T2.9");
});
test("changing the display format changes only labels, never calendar keys or note identity", () => {
  const key = "2026-11-14";
  const id = "note-fixed-id";
  const labels = ["DD-MM-YYYY", "YYYY-MM-DD", "MM/DD/YYYY", "DD.MM.YYYY", "DD/MM/YYYY"].map((format) => calendar.formatDateKey(key, format));
  assert.deepEqual(labels, ["14-11-2026", "2026-11-14", "11/14/2026", "14.11.2026", "14/11/2026"]);
  assert.equal(calendar.localDateKey(new Date(2026, 10, 14, 0, 5).getTime()), key);
  assert.equal(id, "note-fixed-id");
  assert.match(source, /displayDateKey\(ymd\)/, "date chips format the date at render time");
  assert.match(source, /displayDateKey\(CALENDAR_PART\.localDateKey\(itemDay\)\)/, "hover cards format calendar dates at render time");
  assert.match(source, /journalSection\(j\.body, ymd, ms, dateDisplayFormat\(\)\)/, "Journal lookup uses the current slash-date preference");
  assert.match(source, /findDateNote\(store\.list\(\), ymd, dateDisplayFormat\(\)\)/, "separate date-note lookup uses the current slash-date preference");
  assert.match(source, /resetRead\(\);\s*renderRead\(\)/, "read view is rebuilt after display preference changes");
});
console.log(`${passed} date display integration tests passed`);
