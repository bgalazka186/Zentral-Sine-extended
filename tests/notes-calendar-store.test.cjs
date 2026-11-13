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
const calendarSource = fs.readFileSync(path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js"), "utf8");

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

  await test("T2.5e recurrence exceptions persist through calendar.json reload", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const start = new Date(2026, 10, 12, 9, 0).getTime();
    const master = cal.makeItem({ id: "persisted-recurring-series", summary: "Persisted series",
      start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(start + 30 * 60000).toISOString() },
      recurrence: ["RRULE:FREQ=DAILY;COUNT=5"], x: { kind: "event", src: "manual" } }, clock);
    assert.ok(st.items.upsert(master));
    const selected = cal.expandItem(master, start, start + 5 * 86400000).find((item) => Number(item.x.recurrenceId) === start + 2 * 86400000);
    assert.ok(selected);
    clock += 1000;
    const changed = cal.moveOccurrence(master, selected, { dateTime: new Date(start + 2 * 86400000 + 2 * 3600000).toISOString() }, "following", clock);
    assert.ok(changed);
    assert.ok(st.items.upsert(changed));
    await st.items.flush();
    const saved = JSON.parse(io.files.get("/n/calendar.json").text).items.find((item) => item.id === master.id);
    assert.equal(saved.x.recurrenceExceptions.length, 1);
    assert.equal(saved.x.recurrenceExceptions[0].scope, "following");
    const reopened = mk(io); await reopened.open();
    const reloaded = reopened.items.get(master.id);
    assert.deepEqual(reloaded.x.recurrenceExceptions, changed.x.recurrenceExceptions);
    const expanded = cal.expandItem(reloaded, start, start + 5 * 86400000);
    assert.equal(new Date(cal.itemRange(expanded[2])[0]).getHours(), 11);
    assert.equal(new Date(cal.itemRange(expanded[4])[0]).getHours(), 11);
    assert.equal(new Date(cal.itemRange(expanded[1])[0]).getHours(), 9);
  });

  await test("T2.5e source-note recurrence exceptions survive a Markdown title edit", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const note = st.create("%%calendar: Birthdays%%\n- 15 listopada Birthday");
    const master = st.items.list({ noteId: note.id })[0];
    assert.deepEqual(master.recurrence, ["RRULE:FREQ=YEARLY"]);
    const from = new Date(2027, 10, 1).getTime(), to = new Date(2027, 11, 1).getTime();
    const occurrence = cal.expandItem(master, from, to)[0];
    assert.ok(occurrence);
    const moved = cal.moveOccurrence(master, occurrence, { date: "2027-11-16" }, "this", clock);
    assert.ok(moved);
    assert.equal(moved.x.moved, "1", "note-derived recurring items keep the moved marker");
    assert.ok(st.items.upsert(moved));
    const body = st.get(note.id).body.replace("- 15 listopada Birthday", "- 15 listopada Birthday updated");
    st.update(note.id, body);
    const saved = st.items.get(master.id);
    assert.equal(saved.summary, "Birthday updated");
    assert.equal(saved.x.recurrenceExceptions.length, 1);
    assert.equal(saved.x.moved, "1");
    assert.equal(cal.expandItem(saved, from, to)[0].start.date, "2027-11-16");
  });

  await test("T2.5e recurring reminder moves append occurrence-scoped reschedule history", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const start = new Date(2026, 10, 12, 9, 0).getTime();
    const master = cal.makeItem({ id: "history-recurring-reminder", summary: "Recurring reminder",
      start: { dateTime: new Date(start).toISOString() }, recurrence: ["RRULE:FREQ=DAILY;COUNT=4"],
      x: { kind: "reminder", src: "manual" } }, clock);
    assert.ok(st.items.upsert(master));
    const occurrence = cal.expandItem(master, start, start + 4 * 86400000)[2];
    clock += 1000;
    const target = { dateTime: new Date(cal.itemRange(occurrence)[0] + 3600000).toISOString() };
    const moved = cal.moveOccurrence(master, occurrence, target, "this", clock);
    assert.ok(moved);
    assert.ok(st.items.upsert({ ...moved, historyAction: "rescheduled", occurrenceId: occurrence.id, historyStart: target }));
    const records = st.items.history.list({ itemId: master.id, occurrenceId: occurrence.id });
    assert.equal(records.length, 1);
    assert.equal(records[0].action, "rescheduled");
    assert.deepEqual(records[0].start, target);
    await st.items.flush();
    const reopened = mk(io); await reopened.open();
    assert.equal(reopened.items.history.list({ itemId: master.id, occurrenceId: occurrence.id })[0].action, "rescheduled");
    assert.equal(reopened.items.history.stateFor(master.id, occurrence.id), "pending", "schedule history does not change lifecycle state");
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

  await test("B3.3.50-7 attachment references protect generated date notes independently of the calendar predicate", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const withAsset = st.create("# 2026-11-09 Monday\n\n![photo](assets/note_a/picture.png)", "daily");
    const empty = st.create("# 2026-11-10 Tuesday\n\n", "daily");
    const original = cal.isBlankDateNote;
    cal.isBlankDateNote = () => true; // Isolate the store's own defensive guard.
    try {
      assert.deepEqual(Array.from(st.purgeBlankDateNotes()), [empty.id]);
      assert.equal(st.get(withAsset.id).trashed, 0);
    } finally { cal.isBlankDateNote = original; }
  });

  await test("T2.16 startup sweep trashes only untouched generated Daily notes and retains the note for restore", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const candidate = st.create("# 2026-11-10 Tuesday\n\n", "daily");
    const unrelated = st.create("# 2026-11-15 Sunday\n\n", "Work");
    const edited = st.create("# 2026-11-09 Monday\n\n", "daily");
    st.update(edited.id, edited.body + "x");
    const trashed = st.purgeBlankDateNotes();
    assert.deepEqual(Array.from(trashed), [candidate.id]);
    assert.ok(st.get(candidate.id)?.trashed, "candidate moved into Trash instead of being deleted");
    assert.ok(st.get(candidate.id), "the note remains restorable");
    assert.equal(st.get(unrelated.id).trashed, 0, "date-shaped notes outside Daily are not treated as generated notes");
    assert.equal(st.get(edited.id).trashed, 0, "a note with one typed character is preserved");
    st.restore(candidate.id);
    assert.equal(st.get(candidate.id).trashed, 0);
  });

  await test("T2.16 never trashes today/future Daily notes and protects dates occupied by note-less calendar items", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const today = st.create("# 2026-11-11 Wednesday\n\n", "daily");
    const future = st.create("# 2026-11-12 Thursday\n\n", "daily");
    const occupied = st.create("# 2026-11-10 Tuesday\n\n", "daily");
    st.items.upsert({ id: "date-only-event", summary: "Busy day", start: { date: "2026-11-10" }, end: { date: "2026-11-11" }, x: { kind: "event", src: "manual" } });
    assert.deepEqual(Array.from(st.purgeBlankDateNotes()), []);
    assert.equal(st.get(today.id).trashed, 0, "today's newly generated Daily note stays alive");
    assert.equal(st.get(future.id).trashed, 0, "a future Daily note is never auto-trashed");
    assert.equal(st.get(occupied.id).trashed, 0, "a note-less all-day event protects its date note");
  });

  await test("T2.16 edit history is sticky across edit-then-undo and survives reload", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const note = st.create("# 2026-11-17 Tuesday\n\n", "daily");
    const generated = note.body;
    st.update(note.id, generated + "temporary");
    st.update(note.id, generated);
    assert.equal(st.get(note.id).touched, true, "returning to the generated text must not erase the edit history");
    await st.flush();
    assert.match(io.files.get("/n/" + note.id + ".md").text, /\ntouched: true\n/);
    const reopened = mk(io); await reopened.open();
    assert.equal(reopened.get(note.id).touched, true);
    assert.deepEqual(Array.from(reopened.purgeBlankDateNotes()), []);
    assert.equal(reopened.get(note.id).trashed, 0);
  });

  await test("T2.16 protects date notes referenced by stored calendar items, including hidden items", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const note = st.create("# 2026-11-18 Wednesday\n\n", "daily");
    const item = cal.makeItem({ id: "manual-note-reference", summary: "Keep this daily note", start: { dateTime: new Date(clock + 3600000).toISOString() }, x: { kind: "reminder", src: "manual", noteId: note.id } }, clock);
    st.items.upsert(item);
    assert.deepEqual(Array.from(st.purgeBlankDateNotes()), []);
    st.trash(note.id);
    st.restore(note.id);
    assert.deepEqual(Array.from(st.purgeBlankDateNotes()), [], "even a hidden stored item is a reference");
    assert.equal(st.get(note.id).trashed, 0);
  });

  await test("T2.16 protects tagged and linked date notes, including slash-form wiki titles", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const tagged = st.create("# 2026-11-06 Friday\n\n", "daily");
    tagged.foreign = "tags: [keep]";
    const markdownTarget = st.create("# 2026-11-07 Saturday\n\n", "daily");
    st.create("A canonical backlink: " + c.buildNoteLink(markdownTarget.id, "Daily entry"));
    const slashTarget = st.create("# 08/11/2026\n\n", "daily");
    st.create("A date title with slashes: [[08/11/2026|open day]]");
    assert.deepEqual(Array.from(st.purgeBlankDateNotes()), []);
    assert.equal(tagged.trashed, 0, "foreign YAML tags protect the note even when its body is only the generated heading");
    assert.equal(markdownTarget.trashed, 0, "canonical Markdown backlinks protect the target");
    assert.equal(slashTarget.trashed, 0, "slash-form wiki links are recognized even though slash can denote a folder");
  });

  await test("T2.16 active-sheet ownership protects the current note until the last owner leaves", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const note = st.create("# 2026-11-08 Sunday\n\n", "daily");
    const first = {}, second = {};
    st.setActiveNote(first, note.id);
    st.setActiveNote(second, note.id);
    assert.deepEqual(Array.from(st.purgeBlankDateNotes()), []);
    st.setActiveNote(first, "");
    assert.deepEqual(Array.from(st.purgeBlankDateNotes()), [], "another open sheet still owns the note");
    st.setActiveNote(second, "");
    assert.deepEqual(Array.from(st.purgeBlankDateNotes()), [note.id]);
    assert.ok(st.get(note.id).trashed);
  });

  await test("T2.16 onlyIds limits a leave-note purge and Notes sheets wire switch, close and startup sweeps", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const first = st.create("# 2026-11-07 Saturday\n\n", "daily");
    const second = st.create("# 2026-11-06 Friday\n\n", "daily");
    assert.deepEqual(Array.from(st.purgeBlankDateNotes({ onlyIds: [first.id] })), [first.id]);
    assert.equal(st.get(second.id).trashed, 0);
    const code = source;
    assert.match(code, /function\s+trackOpenNote\s*\([\s\S]*?store\.setActiveNote/);
    assert.match(code, /function\s+showNote\s*\(id\)\s*\{[\s\S]*?trackOpenNote\(id\)/);
    assert.match(code, /store\.purgeBlankDateNotes\?\.\(\);\s*\/\/ sweep stale generated date notes/);
    assert.match(code, /const leavingId = registeredOpenNote \|\| currentId;[\s\S]*?trackOpenNote\(""\);[\s\S]*?purgeBlankDateNotes/);
  });

  await test("T2.17 revision arbitration rejects a stale calendar-editor snapshot after a note-text edit", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const note = st.create("# Plan\n\n%%calendar: Work%%\n- 2026-11-24 09:00 Call mom\n");
    const before = st.items.list({ noteId: note.id })[0];
    const staleEditor = JSON.parse(JSON.stringify(before));
    const updatedBody = st.get(note.id).body.replace("Call mom", "Call sister");
    st.update(note.id, updatedBody);
    const afterText = st.items.get(before.id);
    assert.equal(afterText.summary, "Call sister", "the Markdown writer updates the visible item text");
    assert.equal(afterText.rev, before.rev + 1, "the Markdown writer advances the item revision");
    const rejected = st.items.upsert({ ...staleEditor, summary: "Stale calendar title", x: { ...staleEditor.x, calNote: "stale modal value" } });
    assert.equal(rejected, null, "older editor snapshots are rejected instead of silently overwriting the newer note edit");
    assert.equal(st.items.get(before.id).summary, "Call sister");
    assert.equal(st.items.get(before.id).x.calNote, "");
  });

  await test("T2.17 newer calendar details survive a later note-text edit and revisions persist", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const note = st.create("# Plan\n\n%%calendar: Work%%\n- 2026-11-25 09:00 Call mom\n");
    const initial = st.items.list({ noteId: note.id })[0];
    const edited = st.items.upsert({ ...initial, x: { ...initial.x, calNote: "Bring the documents", moved: "1" } });
    assert.ok(edited && edited.rev > initial.rev, "a current editor save advances the revision");
    const body = st.get(note.id).body.replace("Call mom", "Call dad");
    st.update(note.id, body);
    const latest = st.items.get(initial.id);
    assert.equal(latest.summary, "Call dad", "the later note-text edit wins its source-owned title field");
    assert.equal(latest.x.calNote, "Bring the documents", "calendar-only metadata is retained during Markdown resync");
    assert.equal(latest.x.moved, "1", "explicitly moved-item metadata is preserved");
    assert.ok(latest.rev > edited.rev, "the later Markdown writer advances the revision again");
    await st.flush();
    const reopened = mk(io); await reopened.open();
    assert.equal(reopened.items.get(initial.id).rev, latest.rev, "the revision is persisted to calendar.json");
    assert.equal(reopened.items.get(initial.id).x.calNote, "Bring the documents");
  });

  await test("T2.17 a fresh calendar editor can save after refreshing the version", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const note = st.create("# Plan\n\n%%calendar: Work%%\n- 2026-11-26 10:00 Review\n");
    const before = st.items.list({ noteId: note.id })[0];
    st.update(note.id, st.get(note.id).body.replace("Review", "Review draft"));
    const fresh = st.items.get(before.id);
    const saved = st.items.upsert({ ...fresh, x: { ...fresh.x, calNote: "Use version 2" } });
    assert.ok(saved, "the current version remains editable");
    assert.equal(saved.x.calNote, "Use version 2");
    assert.equal(saved.rev, fresh.rev + 1);
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

  await test("T2.7a history store is versioned, append-only, independently persisted and reloadable", async () => {
    const io = fakeIO();
    const history = cal.createReminderHistoryStore({ io, getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {}, warn() {} });
    assert.equal((await history.open()).state, "missing");
    const first = history.append({ itemId: "series-1", occurrenceId: "series-1@100", noteId: "note-a", summary: "Call mom", start: { dateTime: new Date(100).toISOString() }, action: "done" });
    assert.ok(first && first.id);
    assert.equal(history.stateFor("series-1", "series-1@100"), "done");
    assert.equal(history.stateFor("series-1", "series-1@200"), "pending", "recurrence occurrences have independent lifecycle state");
    await history.flush();
    const raw = JSON.parse(io.files.get("/n/reminder-history.json").text);
    assert.equal(raw.v, 1);
    assert.equal(raw.records.length, 1);
    const reopened = cal.createReminderHistoryStore({ io, getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {}, warn() {} });
    assert.equal((await reopened.open()).state, "ready");
    assert.equal(reopened.list()[0].action, "done");
    assert.equal(reopened.stateFor("series-1", "series-1@100"), "done");
  });

  await test("T2.7a lifecycle transitions are independent of snooze/reschedule and Google status", async () => {
    const io = fakeIO(), history = cal.createReminderHistoryStore({ io, getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {}, warn() {} });
    await history.open();
    const snapshot = { itemId: "r1", occurrenceId: "r1", noteId: "n1", summary: "Submit report", start: { dateTime: new Date(clock).toISOString() } };
    history.append({ ...snapshot, action: "done", at: clock + 1 });
    assert.equal(history.stateFor("r1"), "done");
    history.append({ ...snapshot, action: "snoozed", at: clock + 2 });
    history.append({ ...snapshot, action: "rescheduled", at: clock + 3 });
    assert.equal(history.stateFor("r1"), "done", "schedule-only history never changes completion state");
    history.append({ ...snapshot, action: "reopened", at: clock + 4 });
    assert.equal(history.stateFor("r1"), "pending");
    history.append({ ...snapshot, action: "dismissed", at: clock + 5 });
    assert.equal(history.stateFor("r1"), "dismissed");
    const listed = history.list({ itemId: "r1", occurrenceId: "r1", noteId: "n1" });
    assert.deepEqual(listed.map((entry) => entry.action), ["dismissed", "reopened", "rescheduled", "snoozed", "done"]);
    assert.deepEqual(history.list({ itemId: "r1", limit: 2, offset: 0 }).map((entry) => entry.action), ["dismissed", "reopened"]);
    assert.deepEqual(history.list({ itemId: "r1", limit: 2, offset: 2 }).map((entry) => entry.action), ["rescheduled", "snoozed"]);
    assert.deepEqual(history.list({ itemId: "r1", limit: 2, offset: 4 }).map((entry) => entry.action), ["done"]);
    const copy = listed[0]; copy.summary = "mutated";
    assert.equal(history.list()[0].summary, "Submit report", "callers cannot mutate stored records");
    const item = cal.makeItem({ id: "r1", summary: "Submit report", start: { dateTime: new Date(clock).toISOString() }, status: "tentative", x: { kind: "reminder" } }, clock);
    assert.equal(item.status, "tentative", "Google status remains independent of lifecycle state");
  });

  await test("T2.7a corrupt history is backed up and protected from accidental overwrite", async () => {
    const io = fakeIO(); io.files.set("/n/reminder-history.json", { text: '{"v":99,"records":[]}', mtime: clock });
    const history = cal.createReminderHistoryStore({ io, getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {}, warn() {} });
    const state = await history.open();
    assert.equal(state.state, "corrupt");
    assert.ok(state.backupPath && io.files.has(state.backupPath));
    assert.equal(history.append({ itemId: "r1", action: "done", at: clock + 1 }), null, "protected history refuses unpersistable lifecycle actions");
    await history.flush();
    assert.equal(io.files.get("/n/reminder-history.json").text, '{"v":99,"records":[]}', "the damaged original is not overwritten");
  });

  await test("T2.7a protected history refuses a note-reminder lifecycle transition without changing its schedule", async () => {
    const io = fakeIO(); io.files.set("/n/reminder-history.json", { text: '{"v":1,"records":[broken]}', mtime: clock });
    const st = mk(io); await st.open();
    const note = st.create("# Protected reminder");
    assert.equal(st.setReminder(note.id, clock + 3600000), true, "a first pending reminder needs no transition record");
    const before = st.get(note.id).remind;
    assert.equal(st.setReminder(note.id, 0), false, "dismiss cannot proceed when history is unreadable");
    assert.equal(st.get(note.id).remind, before, "the reminder remains scheduled rather than silently losing its dismissal history");
  });

  await test("T2.7a reminder item rescheduling appends history without changing calendar status", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const note = st.create("%%calendar: Personal%%\n- 2026-11-28 09:00 Submit report\n");
    const item = st.items.list({ noteId: note.id })[0];
    st.items.upsert({ ...item, status: "tentative", start: { dateTime: new Date(clock + 3600000).toISOString() } });
    assert.equal(st.items.get(item.id).status, "tentative");
    assert.equal(st.items.history.list({ itemId: item.id }).at(-1)?.action, "rescheduled");
    assert.equal(st.items.history.stateFor(item.id), "pending");
    await st.flush();
    assert.ok(io.files.has("/n/reminder-history.json"));
    const again = mk(io); await again.open();
    assert.equal(again.items.history.list({ itemId: item.id }).length, 1);
  });

  await test("T2.7a legacy note reminders record reschedule, snooze, dismiss and reopen transitions", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const note = st.create("# Appointment\n\nFollow up");
    const itemId = "note-reminder:" + note.id;
    assert.equal(st.setReminder(note.id, clock + 3600000), true);
    assert.equal(st.items.history.list({ itemId }).length, 0, "creating a pending reminder does not fabricate a lifecycle transition");
    assert.equal(st.setReminder(note.id, clock + 7200000), true);
    assert.equal(st.items.history.list({ itemId })[0]?.action, "rescheduled");
    assert.equal(st.snoozeReminder(note.id, 15), true);
    assert.equal(st.items.history.list({ itemId })[0]?.action, "snoozed");
    assert.equal(st.items.history.stateFor(itemId), "pending", "snoozing does not complete the reminder");
    assert.equal(st.setReminder(note.id, 0), true);
    assert.equal(st.items.history.stateFor(itemId), "dismissed");
    assert.equal(st.setReminder(note.id, clock + 10800000), true);
    assert.equal(st.items.history.stateFor(itemId), "pending");
    assert.deepEqual(st.items.history.list({ itemId }).map((entry) => entry.action), ["reopened", "dismissed", "snoozed", "rescheduled"]);
    await st.flush();
    const again = mk(io); await again.open();
    assert.equal(again.items.history.list({ itemId }).length, 4, "legacy reminder lifecycle survives reload");
  });

  await test("T2.7a a legacy note reminder recreated after Done reopens instead of inheriting completion", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const note = st.create("# Repeated task");
    const itemId = "note-reminder:" + note.id;
    st.setReminder(note.id, clock + 3600000);
    st.setReminder(note.id, 0, "done");
    assert.equal(st.items.history.stateFor(itemId), "done");
    st.setReminder(note.id, clock + 7200000);
    assert.equal(st.items.history.stateFor(itemId), "pending");
    assert.deepEqual(st.items.history.list({ itemId }).map((entry) => entry.action), ["reopened", "done"]);
  });

  await test("T2.7a equal-timestamp transitions preserve append order after reload", async () => {
    const io = fakeIO(), history = cal.createReminderHistoryStore({ io, getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {}, warn() {} });
    await history.open();
    const base = { itemId: "same-time", occurrenceId: "same-time", at: clock };
    history.append({ ...base, action: "done" });
    history.append({ ...base, action: "reopened" });
    assert.equal(history.stateFor("same-time"), "pending");
    await history.flush();
    const again = cal.createReminderHistoryStore({ io, getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {}, warn() {} });
    await again.open();
    assert.equal(again.stateFor("same-time"), "pending");
    assert.deepEqual(again.list().map((entry) => entry.action), ["reopened", "done"]);
  });

  await test("T2.19 snoozing a stored reminder records a scheduling action without rewriting its source note", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const body = "%%calendar: Personal%%\n- 2026-11-28 09:00 Follow up with supplier\n";
    const note = st.create(body);
    const sourceBefore = st.get(note.id).body;
    const item = st.items.list({ noteId: note.id })[0];
    const moved = st.items.upsert({ ...item, start: { dateTime: "2026-11-29T08:00:00.000Z" }, historyAction: "snoozed" });
    assert.ok(moved);
    assert.equal(st.get(note.id).body, sourceBefore, "snooze changes the calendar schedule, not Markdown source text");
    assert.equal(st.items.history.list({ itemId: item.id })[0]?.action, "snoozed");
    assert.equal(st.items.history.stateFor(item.id), "pending", "snooze never implies completion");
    await st.flush();
    const again = mk(io); await again.open();
    assert.equal(again.items.history.list({ itemId: item.id })[0]?.action, "snoozed");
  });

  await test("T2.7a reminder right-click actions and history are connected to the shared menu engine", () => {
    assert.match(source, /function\s+showCalendarItemMenu\s*\([\s\S]*?showMenu\(safeAnchor\s*\|\|\s*\(event\s*&&\s*Number\.isFinite\(event\.clientX\)[\s\S]*?pointAnchor\(event\)/);
    assert.match(source, /"mark-done":\s*\(\)\s*=>\s*recordReminderLifecycle\(item,\s*["']done["']\)/);
    assert.match(source, /dismiss:\s*\(\)\s*=>\s*recordReminderLifecycle\(item,\s*["']dismissed["']\)/);
    assert.match(source, /reopen:\s*\(\)\s*=>\s*recordReminderLifecycle\(item,\s*["']reopened["']\)/);
    assert.match(calendarSource, /action\("mark-done",\s*"Mark as done"/);
    assert.match(calendarSource, /action\("dismiss",\s*"Dismiss"/);
    assert.match(calendarSource, /action\("reopen",\s*"Reopen"/);
    assert.match(source, /function\s+openReminderHistory\s*\([\s\S]*?history\?\.list\(\{\s*limit:\s*pageSize,\s*offset\s*\}\)/);
    assert.ok(source.includes('Load older entries'));
    assert.ok(source.includes('Showing ${offset} of ${total} entries'));
    assert.match(source, /label:\s*["']Reminder history…["']/);
  });

  await test("T2.7a recurring note-derived occurrences receive independent history identities", () => {
    const ordinary = cal.reminderIdentity({ id: "legacy", x: { src: "note", noteId: "n1" } });
    assert.deepEqual(ordinary, { itemId: "note-reminder:n1", occurrenceId: "note-reminder:n1", noteId: "n1", legacyNote: true });
    const recurringMaster = cal.reminderIdentity({ id: "series-1", recurrence: ["RRULE:FREQ=DAILY"], x: { src: "note", noteId: "n1" } });
    assert.deepEqual(recurringMaster, { itemId: "series-1", occurrenceId: "series-1", noteId: "n1", legacyNote: false });
    const expanded = cal.reminderIdentity({ id: "series-1@1794502800000", x: { src: "note", noteId: "n1", series: "series-1" } });
    assert.deepEqual(expanded, { itemId: "series-1", occurrenceId: "series-1@1794502800000", noteId: "n1", legacyNote: false });
    assert.equal(cal.reminderIdentity({ x: {} }), null);
    const history = cal.createReminderHistoryStore({ io: fakeIO(), getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {}, warn() {} });
    history.append({ ...expanded, action: "done", at: clock + 1 });
    assert.equal(history.stateFor("series-1", "series-1@1794502800000"), "done");
    assert.equal(history.stateFor("series-1", "series-1@1794502800001"), "pending");
  });

  await test("T2.7a history validation rejects invalid action and incomplete identity", () => {
    const history = cal.createReminderHistoryStore({ io: fakeIO(), getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {}, warn() {} });
    assert.equal(history.append({ itemId: "x", action: "unknown", at: clock }), null);
    assert.equal(history.append({ itemId: "", action: "done", at: clock }), null);
    assert.equal(history.append({ itemId: "x", action: "done", at: 0 }), null);
    assert.equal(history.list().length, 0);
  });

  console.log(passed + " passed" + (failed ? ", " + failed + " FAILED" : ""));
  if (failed) process.exit(1);
})();
