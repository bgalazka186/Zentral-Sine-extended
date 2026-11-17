"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const calendar = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const win = { __zentralNotesParts: { "notes-calendar": calendar }, document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800 };
win.window = win;
const ctx = { window: win, document: dom.document, Event: dom.Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout };
vm.runInNewContext(source, ctx);
const core = win.__zentralNotesTestSeam.core;

function fakeIO() {
  const files = new Map();
  return {
    files,
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf " + p); return files.get(p).text; },
    writeUTF8: async (p, text) => { files.set(p, { text }); },
    remove: async (p) => { files.delete(p); },
    exists: async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p + "/")),
    children: async (d) => [...new Set([...files.keys()].filter((k) => k.startsWith(d + "/")).map((k) => d + "/" + k.slice(d.length + 1).split("/")[0]))],
    stat: async (p) => ({ size: (files.get(p)?.text || "").length, lastModified: 1 }),
    removeTree: async (d) => { for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k); },
    restrict: async () => {},
    makeDir: async () => {},
  };
}

async function main() {
  const note = { id: "date-note", body: "# 2026-11-16 Monday\n\nText", folder: "daily", updated: 1, trashed: 0 };
  const folders = [{ id: "daily", label: "Agenda" }];
  const legacy = core.resolveWikiTarget([note], folders, core.parseWikiTarget("Daily/2026-11-16 Monday"));
  const current = core.resolveWikiTarget([note], folders, core.parseWikiTarget("Agenda/2026-11-16 Monday"));
  assert.equal(legacy?.id, note.id, "legacy Daily path still resolves after relabelling");
  assert.equal(current?.id, note.id, "the current Agenda path still resolves");
  assert.equal(core.resolveWikiTarget([{ ...note, id: "other", folder: "agenda" }], [{ id: "agenda", label: "Agenda" }], core.parseWikiTarget("Daily/2026-11-16")), null, "a user Agenda folder is not a Daily alias");

  const nested = { ...note, id: "nested-date-note", folder: "daily/work" };
  const nestedFolders = [{ id: "daily", label: "My days" }, { id: "daily/work", label: "Work" }];
  assert.equal(core.resolveWikiTarget([nested], nestedFolders, core.parseWikiTarget("Daily/Work/2026-11-16 Monday"))?.id, nested.id);
  assert.equal(core.folderPathMatchesNote(nested, nestedFolders, ["Daily", "Work"]), true);
  assert.equal(core.folderPathMatchesNote({ ...nested, folder: "work" }, nestedFolders, ["Daily", "Work"]), false);

  const key = calendar.localDateKey(calendar.addDays(calendar.dayStart(Date.now()), -1));
  assert.equal(calendar.isBlankDateNote({ body: "# " + key + " Monday\n\n%%calendar%%\n", touched: false }, key), true);
  assert.equal(calendar.isBlankDateNote({ body: "# " + key + " Monday\n\nKeep this entry", touched: false }, key), false);
  assert.equal(calendar.isBlankDateNote({ body: "# " + key + " Monday\n\nText", touched: true }, key), false);

  const clock = Date.now();
  const store = core.createStore({ io: fakeIO(), notify() {}, windowId: "daily-lifecycle-test", now: () => clock, getDir: async () => "/notes", getMaxSaveMs: () => 5000, setTimer: () => 0, clearTimer() {}, warn(error) { throw error; } });
  await store.open();
  const oldKey = calendar.localDateKey(calendar.addDays(calendar.dayStart(clock), -1));
  const saved = store.create("# " + oldKey + " Monday\n\nThis daily note must remain", "daily");
  const removed = store.purgeBlankDateNotes();
  assert.equal(removed.includes(saved.id), false, "nonblank past date notes are never automatically trashed");
  assert.equal(store.get(saved.id)?.trashed, 0);
  await store.flush();
  console.log("PASS notes-daily-lifecycle (7 assertions)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
