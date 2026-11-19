"use strict";
/* OW-62: an imported `.ics` reminder whose note is missing must still be deletable.
 * The owner, twice: "i still can not delete reminder that was created by ics import". OW-58 made a free-standing
 * item deletable in principle, but the two doors the delete goes through both asked `items.get(id)`, and `get`
 * deliberately hides an item whose linked note is not visible. So an imported item that named a note that was never
 * written (or was deleted afterwards) looked like "no such item" — the one item the person was pointing at.
 * The safeguard: read the item from the raw list, and where a note really is needed, MAKE it at the id the item
 * already names instead of refusing.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const win = { __zentralNotesParts: { "notes-calendar": cal }, __zentralNotesTestSeam: {}, ZentralRuntime: { register() {} }, addEventListener() {}, removeEventListener() {} };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask });
const c = win.__zentralNotesTestSeam.core;
const plain = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }

const files = new Map();
const io = {
  join: (...p) => p.join("/"),
  filename: (p) => p.split("/").pop(),
  readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf " + p); return files.get(p).text; },
  writeUTF8: async (p, text) => files.set(p, { text, mtime: Date.now() }),
  remove: async (p) => files.delete(p),
  exists: async (p) => files.has(p),
  children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/")),
  stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }),
  restrict: async () => {},
};
const makeStore = (dir) => c.createStore({ io, notify() {}, windowId: "ow62", getDir: async () => dir, getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
// An imported reminder: `src: "ics"`, no note text of its own, and a noteId that names a note that is NOT in the store.
const importedItem = (id, noteId) => ({
  id, summary: "Imported " + id, start: { date: "2026-11-17" },
  x: { kind: "reminder", src: "ics", noteId },
});

(async () => {
  await test("the item the owner points at is free-standing, so it is deletable in principle", async () => {
    const item = importedItem("ics-1", "n9-missing");
    assert.equal(cal.itemOwnsNoteText(item), false, "an imported item owns no note text");
    assert.equal(cal.itemIsFreeStanding(item), true, "so it is free-standing");
    assert.equal(cal.isMirroredAgendaItem(item), false, "and not a mirrored Agenda line");
  });

  await test("an imported item whose note is missing is deleted, not refused", async () => {
    const store = makeStore("/ow62-a");
    await store.open();
    assert.equal(store.get("n9-missing"), null, "no note exists for this id yet");
    assert.ok(store.items.upsert(importedItem("ics-1", "n9-missing")));
    assert.equal(store.get("n9-missing"), null, "and adding the item did not make one");
    // The note it names really is not here.
    assert.equal(store.get("n9-missing"), null, "there is no such note");
    assert.equal(store.items.get("ics-1"), null, "and `get` hides the item because of that (the old trap)");
    const removed = store.deleteCalendarItem("ics-1");
    assert.equal(removed, true, "the delete goes through");
    assert.equal(store.items.get("ics-1"), null, "and the item is gone");
    assert.equal([...(store.items.list({ includeHidden: true }) || [])].some((it) => it.id === "ics-1"), false, "really gone");
    await store.close();
  });

  await test("a hidden item is still found by the delete path, not mistaken for a missing one", async () => {
    const store = makeStore("/ow62-b");
    await store.open();
    assert.ok(store.items.upsert(importedItem("ics-2", "n8-missing")));
    // This is the exact read the delete uses now: raw list first, `get` only as a fallback.
    const viaList = (store.items.list({ includeHidden: true }) || []).find((it) => it.id === "ics-2");
    assert.ok(viaList, "the raw list has the item that `get` hides");
    assert.equal((viaList.x && viaList.x.src), "ics");
    await store.close();
  });

  await test("a mirrored Agenda line whose note is missing makes the note at the id it names", async () => {
    const store = makeStore("/ow62-c");
    await store.open();
    // A real mirrored line, made the way the product makes one: the item is mirrored into a note, then that note is
    // taken away, which is exactly the import-shaped hole this report is about.
    store.items.upsert({ id: "del1", summary: "Water the plants", start: { dateTime: "2026-11-17T09:00:00.000Z" }, end: { dateTime: "2026-11-17T09:15:00.000Z" }, x: { kind: "reminder", src: "manual" } });
    const noteId = store.mirrorItemToAgendaNote("del1");
    const item = store.items.list().find((x) => x.summary === "Water the plants");
    assert.ok(item, "the item is there");
    assert.equal(cal.isMirroredAgendaItem(item), true, "and it is a mirrored line");
    // The note is made at the id the item already names — the safeguard the owner asked for.
    const fresh = store.createBlankNoteFor("n7-missing");
    assert.ok(fresh, "a blank note is created");
    assert.equal(fresh.id, "n7-missing", "at the id, so the link stays true");
    assert.equal(fresh.body, "", "and it is blank");
    assert.equal(store.createBlankNoteFor("n7-missing"), null, "asking twice makes nothing twice");
    assert.equal(store.createBlankNoteFor(noteId), null, "and a note that exists is never replaced");
    await store.close();
  });

  await test("a note id that is not a note id is refused instead of making a stray note", async () => {
    const store = makeStore("/ow62-d");
    await store.open();
    for (const bad of ["", "../x", "a/b", "meta.json"]) assert.equal(store.createBlankNoteFor(bad), null, "refused: " + bad);
    await store.close();
  });

  await test("the delete and the pre-check both read the raw list (the source rule)", async () => {
    const deleteBody = source.slice(source.indexOf("deleteCalendarItem(id) {"), source.indexOf("unlinkCalendarItem(id) {"));
    assert.match(deleteBody, /includeHidden: true/, "the delete looks past the note filter");
    assert.match(deleteBody, /createBlankNoteFor/, "and makes the note it needs");
    const pre = source.slice(source.indexOf("function currentCalendarItem(item) {"), source.indexOf("function currentCalendarOccurrence(item) {"));
    assert.match(pre, /includeHidden: true/, "the pre-check the menu uses does too");
    // The menu itself must never offer "delete it in its note" for an item whose note does not exist.
    const model = cal.calendarItemMenuModel(importedItem("ics-9", "gone"), { state: "pending", lang: "en" });
    const del = model.filter((row) => row && /^delete/.test(row.id || ""));
    assert.ok(del.length >= 1, "the menu has a delete row");
    assert.ok(del.every((row) => row.enabled), "and it is enabled for an imported item");
    assert.ok(!del.some((row) => /note/i.test(row.label || "")), "and it does not send the person to a note: " + JSON.stringify(del.map((r) => r.label)));
  });

  console.log("\nPASS notes-calendar-ics-delete-note (" + passed + " tests)");
})().catch((error) => { console.error("\nFAIL notes-calendar-ics-delete-note"); console.error(error); process.exit(1); });
