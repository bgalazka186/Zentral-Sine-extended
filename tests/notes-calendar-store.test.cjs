"use strict";
/* Calendar items inside the note store (roadmap T2.3): the real createStore on a fake disk and a fake clock.
 * Node + fake IO only: it proves the wiring (sync, trash, restore, delete, reload, flush), NOT how Zen's IOUtils behaves. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const win = { __zentralNotesParts: { "notes-calendar": require("../additional/notes/calendar/ZentralNotesCalendar.js") }, document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800 };
win.window = win;
// Same sandbox as the other store tests; the calendar part is loaded through the same loader as in Zen when it can be.
const ctx = { window: win, document: dom.document, Event: dom.Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout };
vm.runInNewContext(source, ctx);
const c = win.__zentralNotesTestSeam.core;
const cal = require(path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js"));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("ok -", name); } catch (e) { failed++; console.error("FAIL " + name + "\n", e); } }

function fakeIO() {
  const files = new Map();
  return {
    files,
    join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf " + p); return files.get(p).text; },
    writeUTF8: async (p, text) => { files.set(p, { text, mtime: clock }); },
    remove: async (p) => { files.delete(p); },
    exists: async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p + "/")),
    children: async (d) => [...new Set([...files.keys()].filter((k) => k.startsWith(d + "/")).map((k) => d + "/" + k.slice(d.length + 1).split("/")[0]))],
    stat: async (p) => ({ size: (files.get(p)?.text || "").length, lastModified: files.get(p)?.mtime ?? 1 }),
    removeTree: async (d) => { for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k); },
    restrict: async () => {}, makeDir: async () => {},
  };
}
let clock = new Date(2026, 10, 11, 10, 0).getTime();
const mk = (io) => c.createStore({ io, notify() {}, windowId: "t", now: () => clock, getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: () => 0, clearTimer() {}, warn(e) { throw e; } });
const BODY = "# Plan\n\n## Shifts\n%%calendar: Work%%\n- 2026-11-12 06:00-14:00 Work\n- 2026-11-13 18:00 Call mom\n";

(async () => {
  await test("the calendar part is available to the store", () => {
    assert.ok(win.__zentralNotesTestSeam.core.CALENDAR_PART, "CALENDAR_PART exposed");
  });

  await test("create / update sync the note's marked lines; removing the marker removes them; calendar.json is not a note", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    assert.ok(st.items, "item store exposed");
    const n = st.create(BODY);
    assert.equal(st.items.list({ noteId: n.id }).length, 2);
    st.update(n.id, n.body + "- 2026-11-14 Dentist\n");
    assert.equal(st.items.list({ noteId: n.id }).length, 3, "a new line becomes an item on update");
    assert.equal(st.items.list({ noteId: n.id, kind: "reminder" }).length, 2, "one note stores multiple independent reminders");
    await st.flush();
    assert.ok(io.files.has("/n/calendar.json"), "flush writes the item file");
    assert.ok(io.files.has("/n/" + n.id + ".md"));
    const st2 = mk(io); await st2.open();
    assert.equal(st2.list().length, 1, "calendar.json is never loaded as a note");
    assert.equal(st2.items.list({ noteId: n.id }).length, 3, "items survive a reopen");
    assert.equal(st2.items.list({ noteId: n.id, kind: "reminder" }).length, 2, "multiple reminders survive a reopen");
    st2.update(n.id, "# Plan\n\nnothing marked");
    assert.equal(st2.items.list({ noteId: n.id }).length, 0);
  });

  await test("trash hides the items and keeps their extras; restore shows them again; plain notes cost nothing", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const plain = st.create("just text"); st.update(plain.id, "still just text");
    assert.equal(st.items.list().length, 0); await st.flush();
    assert.ok(!io.files.has("/n/calendar.json"), "no items, no file");
    const n = st.create(BODY);
    const call = st.items.list().find((i) => i.summary === "Call mom");
    st.items.upsert({ ...call, x: { ...call.x, calNote: "flowers" } });
    st.trash(n.id);
    assert.equal(st.items.list().length, 0, "trashed note: nothing on the calendar");
    st.update(n.id, st.get(n.id).body + "\nstray edit"); // a stray edit while trashed must not bring them back or strip line IDs
    assert.equal(st.items.list().length, 0);
    st.restore(n.id);
    assert.equal(st.items.list({ noteId: n.id }).length, 2);
    assert.equal(st.items.get(call.id).x.calNote, "flowers", "extras came back untouched");
  });

  await test("deleteForever and emptyTrash remove the items for good; an empty never-saved note leaves nothing", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const a = st.create(BODY), b = st.create(BODY.replace("Plan", "Other"));
    assert.equal(st.items.list().length, 4);
    st.trash(a.id); await st.deleteForever(a.id);
    assert.equal(st.items.list({ noteId: a.id }).length, 0);
    assert.equal(st.items.list({ noteId: b.id }).length, 2);
    st.trash(b.id); await st.emptyTrash();
    assert.equal(st.items.list().length, 0);
    await st.flush();
    const st2 = mk(io); await st2.open();
    assert.equal(st2.items.list().length, 0, "nothing comes back after a reopen");
    const blank = st2.create(""); st2.trash(blank.id); assert.equal(st2.items.list().length, 0);
  });

  await test("open: items of a note that no longer exists, or sits in Trash, stay stored but hidden", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const keep = st.create(BODY), gone = st.create(BODY.replace("Plan", "Gone")), bin = st.create(BODY.replace("Plan", "Bin"));
    st.trash(bin.id); await st.flush();
    io.files.delete("/n/" + gone.id + ".md"); // removed by another app while Zentral was closed
    const st2 = mk(io); await st2.open();
    assert.equal(st2.items.list().length, 2, "only the existing, non-trashed note shows items");
    assert.equal(st2.items.list({ noteId: keep.id }).length, 2);
    const raw = JSON.parse(io.files.get("/n/calendar.json").text);
    assert.equal(raw.items.length, 6, "the file itself was not purged (a failed read must never wipe items)");
  });

  await test("a file changed by another app is re-read and its items follow (remote reload)", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const n = st.create(BODY); await st.flush();
    io.files.set("/n/" + n.id + ".md", { text: st.get(n.id).body + "- 2026-11-15 Remote line\n", mtime: clock + 60000 });
    await st.refresh();
    await st.flush(); // persist auto-managed IDs before simulating a separate external file deletion
    assert.ok(st.items.list().some((i) => i.summary === "Remote line"));
    io.files.delete("/n/" + n.id + ".md"); await st.refresh();
    assert.equal(st.items.list().length, 0, "file gone: items hidden, not deleted");
    assert.ok(st.items.isHidden(n.id));
  });

  await test("stable hidden line IDs preserve duplicate reminder metadata across reorder, edit and deletion", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const body = "%%calendar: Work%%\n- 2026-11-18 09:00-10:00 Repeated\n- 2026-11-18 09:00-10:00 Repeated\n";
    const note = st.create(body);
    let copies = st.items.list({ noteId: note.id }).sort((a, b) => a.x.key.localeCompare(b.x.key));
    assert.equal(copies.length, 2);
    assert.notEqual(copies[0].x.key, copies[1].x.key, "each identical row has its own hidden identity token");
    st.items.upsert({ ...copies[0], start: { dateTime: new Date(new Date(copies[0].start.dateTime).getTime() + 2 * 3600000).toISOString() }, x: { ...copies[0].x, calNote: "belongs to copy one", moved: "1" } });
    st.items.upsert({ ...copies[1], x: { ...copies[1].x, calNote: "belongs to copy two", notify: { due: { enabled: false } } } });
    // Reorder the identical text rows; their inline identity comments move with the rows.
    const lines = st.get(note.id).body.split("\n");
    const rowIndexes = lines.map((line, i) => line.includes("zn-item-id:") ? i : -1).filter((i) => i >= 0);
    assert.equal(rowIndexes.length, 2);
    [lines[rowIndexes[0]], lines[rowIndexes[1]]] = [lines[rowIndexes[1]], lines[rowIndexes[0]]];
    st.update(note.id, lines.join("\n"));
    copies = st.items.list({ noteId: note.id });
    assert.equal(copies.length, 2);
    assert.equal(copies.find((it) => it.x.key === copies[0].x.key)?.x.calNote, copies[0].x.calNote);
    assert.deepEqual(copies.map((it) => it.x.calNote).sort(), ["belongs to copy one", "belongs to copy two"]);
    // Editing the visible title while keeping its marker keeps its exact item ID and extras.
    const first = copies.find((it) => it.x.calNote === "belongs to copy one");
    st.update(note.id, st.get(note.id).body.replace("Repeated %%zn-item-id:" + first.x.key, "Renamed %%zn-item-id:" + first.x.key));
    const renamed = st.items.get(first.id);
    assert.equal(renamed.summary, "Renamed");
    assert.equal(renamed.x.calNote, "belongs to copy one");
    // Deleting the other duplicate leaves this exact row and its metadata intact.
    const current = st.get(note.id).body.split("\n");
    const other = st.items.list({ noteId: note.id }).find((it) => it.id !== first.id);
    st.update(note.id, current.filter((line) => !line.includes("zn-item-id:" + other.x.key)).join("\n"));
    copies = st.items.list({ noteId: note.id });
    assert.deepEqual(copies.map((it) => it.id), [first.id]);
    assert.equal(copies[0].x.calNote, "belongs to copy one");
    assert.equal(copies[0].x.moved, "1");
  });

  await test("legacy calendar items migrate to hidden line IDs without losing unambiguous metadata", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const body = "%%calendar: Work%%\n- 2026-11-21 09:00 Dentist\n- 2026-11-22 10:00 Call\n";
    const note = st.create(body);
    const before = st.items.list({ noteId: note.id });
    st.items.upsert({ ...before[0], x: { ...before[0].x, calNote: "keep through upgrade" } });
    // Simulate a store written by the previous version: remove line tokens from the note but keep item metadata in calendar.json.
    const legacy = st.get(note.id).body.replace(/\s%%zn-item-id:[^%]+%%/g, "");
    st.update(note.id, legacy);
    const migratedBody = st.stabilizeItems(note.id);
    assert.match(migratedBody, /%%zn-item-id:/, "the editor commit inserts managed IDs");
    const after = st.items.list({ noteId: note.id });
    assert.equal(after.length, 2);
    assert.equal(after.find((it) => it.summary === "Dentist").x.calNote, "keep through upgrade");
    assert.equal(new Set(after.map((it) => it.x.key)).size, 2, "IDs remain unique");
  });

  await test("failed calendar writes preserve dirty state and a later flush retries the same data", async () => {
    const io = fakeIO(), items = cal.createItemStore({ io, getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {}, warn() {} });
    await items.open();
    const write = io.writeUTF8.bind(io); let failOnce = true;
    io.writeUTF8 = async (...args) => { if (failOnce) { failOnce = false; throw new Error("simulated disk full"); } return write(...args); };
    items.upsert({ id: "manual-retry", summary: "Retry me", start: { dateTime: new Date(clock + 3600000).toISOString() }, x: { kind: "reminder", src: "manual" } });
    await assert.rejects(items.flush(), /simulated disk full/);
    assert.equal(items.storageState().dirty, true, "failed snapshot remains dirty");
    assert.equal(io.files.has("/n/calendar.json"), false, "failed write did not create a false-success file");
    await items.flush();
    assert.equal(items.storageState().dirty, false, "successful retry clears dirty state");
    assert.equal(items.storageState().state, "ready");
    assert.equal(JSON.parse(io.files.get("/n/calendar.json").text).items[0].id, "manual-retry");
  });

  await test("corrupt calendar.json is backed up and protected until explicit recovery", async () => {
    const io = fakeIO(), damaged = "{ this is not valid JSON";
    io.files.set("/n/calendar.json", { text: damaged, mtime: clock });
    const items = cal.createItemStore({ io, getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {}, warn() {} });
    const status = await items.open();
    assert.equal(status.state, "corrupt");
    assert.ok(status.backupPath && io.files.get(status.backupPath)?.text === damaged, "raw damaged contents are copied before recovery");
    items.upsert({ id: "manual-after-recovery", summary: "Preserve me", start: { dateTime: new Date(clock + 7200000).toISOString() }, x: { kind: "reminder", src: "manual" } });
    await assert.rejects(items.flush(), /protected/);
    assert.equal(io.files.get("/n/calendar.json").text, damaged, "automatic saves never overwrite a damaged source file");
    assert.equal(items.replaceDamagedStore(), true, "replacement requires and accepts an explicit recovery action");
    await items.flush();
    assert.equal(JSON.parse(io.files.get("/n/calendar.json").text).items[0].id, "manual-after-recovery");
    assert.equal(items.storageState().state, "ready");
  });

  await test("unreadable calendar file is not treated as missing and cannot be silently replaced", async () => {
    const io = fakeIO(); io.files.set("/n/calendar.json", { text: JSON.stringify({ v: 2, items: [] }), mtime: clock });
    io.readUTF8 = async () => { throw new Error("permission denied"); };
    const items = cal.createItemStore({ io, getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {}, warn() {} });
    const status = await items.open();
    assert.equal(status.state, "unreadable");
    assert.equal(status.backupPath, "");
    assert.equal(items.replaceDamagedStore(), false, "unreadable data cannot be replaced without a verified backup");
    items.upsert({ id: "must-not-overwrite", summary: "Keep file", start: { dateTime: new Date(clock + 3600000).toISOString() }, x: { kind: "reminder" } });
    await assert.rejects(items.flush(), /protected/);
  });

  await test("folder-to-Trash hides reminder items but the destructive-action view can still count them", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const body = BODY + "- 2026-11-16 Birthday\n";
    const n = st.create(body), folder = st.addFolder("Work");
    st.setFolder(n.id, folder);
    assert.equal(st.items.list({ noteId: n.id, kind: "reminder" }).length, 2, "two independent reminders belong to the same note");
    assert.equal(st.items.list({ noteId: n.id, kind: "reminder", includeHidden: true }).length, 2);
    assert.equal(st.removeFolder(folder, "toTrash"), true);
    assert.equal(st.items.list({ noteId: n.id }).length, 0, "folder-to-Trash must hide all calendar items");
    assert.equal(st.items.list({ noteId: n.id, kind: "reminder" }).length, 0, "normal views never expose trashed reminders");
    assert.equal(st.items.list({ noteId: n.id, kind: "reminder", includeHidden: true }).length, 2, "delete confirmation can still count hidden reminders");
    st.restore(n.id);
    assert.equal(st.items.list({ noteId: n.id, kind: "reminder" }).length, 2, "restore makes both reminders visible again");
  });

  console.log(passed + " passed" + (failed ? ", " + failed + " FAILED" : ""));
  if (failed) process.exit(1);
})();
