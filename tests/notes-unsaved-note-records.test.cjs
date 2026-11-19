"use strict";
/* F0.13 (review item C1): calendar.json never holds a record that points at a note which is not in its file.
 * The calendar write first asks the notes to save, but that save can fail (file locked, folder full) while calendar.json
 * can still be written. Before: the record of a reminder that had just become a line of the date note was written anyway.
 * After a restart the note sync dropped it (the line was never saved), or it stayed hidden for good (the date note was
 * never created): a reminder the user had just created was gone without a word.
 * Now such a record is written in the form that does not need the note, until the note is saved:
 *   - a reminder that became a note line: as the reminder it was;
 *   - a record that is only linked to a note that has no file yet: without the link;
 *   - a line somebody typed: not at all (its text is all there is to it).
 * Part 1 drives the pure item store, part 2 the real store of a (fake) browser window, including the restart. */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const settle = async (turns = 8) => { for (let i = 0; i < turns; i++) await new Promise((r) => setImmediate(r)); };
const quiet = async (run) => { const warn = console.warn; console.warn = () => {}; try { return await run(); } finally { console.warn = warn; } };
const plain = (value) => JSON.parse(JSON.stringify(value));

// ---- part 1: the pure item store -------------------------------------------------------------------------------------
function memoryIO() {
  const files = new Map(), writes = [];
  return { files, writes, join: (...p) => p.join("/"),
    readUTF8: async (p) => { if (!files.has(p)) { const e = new Error("not found"); e.code = "ENOENT"; throw e; } return files.get(p); },
    writeUTF8: async (p, text) => { writes.push(p); files.set(p, text); }, exists: async (p) => files.has(p) };
}
const NOW = Date.parse("2026-11-16T08:00:00.000Z"), FILE = "/notes/" + C.ITEMS_FILE;
function pureStore(io, fileState) {
  const timers = [];
  const store = C.createItemStore({ io, getDir: () => "/notes", now: () => NOW,
    setTimer: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
    clearTimer: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    noteFileState: (id) => fileState.get(id) || "saved" });
  const live = () => timers.filter((t) => t.live).map((t) => t.ms);
  const fire = async (ms) => { const t = timers.find((x) => x.live && x.ms === ms); assert.ok(t, "a live timer of " + ms + " ms"); t.live = false; t.fn(); await settle(); };
  return { store, live, fire };
}
const inFile = (io) => JSON.parse(io.files.get(FILE)).items;
const reminder = (id, summary, extra = {}) => C.makeItem({ id, summary, description: "bring the papers", start: { dateTime: new Date(NOW + 26 * 3600000).toISOString() }, x: { kind: "reminder", src: "manual", ...extra } }, NOW);
// What the note store does when a reminder becomes a line of note `noteId` (mirrorItemToAgendaNote).
function mirror(store, id, noteId) {
  const item = store.get(id), line = C.agendaMirrorLine(item, { now: NOW });
  const mirrored = store.upsert(C.mirroredItem({ ...item, x: { ...item.x, noteId, heading: "Agenda" } }, noteId, line.lineId, "Agenda"));
  store.remove(id);
  return mirrored;
}

(async () => {
  await test("pure: unmirroredItem gives back the reminder a mirrored line stands for, and nothing for other records", async () => {
    const manual = reminder("m1", "Call the bank", { category: "Work", tz: "Europe/Warsaw" });
    const line = C.agendaMirrorLine(manual, { now: NOW });
    const mirrored = C.cleanItem(C.mirroredItem({ ...manual, x: { ...manual.x, noteId: "n-day", heading: "Agenda" } }, "n-day", line.lineId, "Agenda"), NOW);
    assert.ok(C.isMirroredAgendaItem(mirrored));
    const back = C.unmirroredItem(mirrored);
    assert.equal(back.id, "m1");
    assert.deepEqual([back.x.src, back.x.noteId, back.x.heading, back.x.key, back.x.historyId], ["manual", "", "", "", ""]);
    assert.deepEqual([back.summary, back.description, back.start, back.x.category, back.x.tz, back.x.kind], [manual.summary, manual.description, manual.start, "Work", "Europe/Warsaw", "reminder"]);
    assert.equal(C.reminderIdentity(back).itemId, C.reminderIdentity(mirrored).itemId, "the same reminder for alerts and history");
    assert.deepEqual(C.agendaMirrorLine(back, { now: NOW }), line, "mirroring it again writes the very same line");
    const typed = C.extractNoteItems("## Agenda\n%%calendar%%\n- [ ] 2026-11-17 09:00 Typed %%zn-item-id:abcd12%%\n", "n-day", NOW)[0];
    assert.equal(C.unmirroredItem(typed), null, "a typed line is not a mirrored reminder");
    assert.equal(C.unmirroredItem(manual), null);
    assert.equal(C.unmirroredItem(null), null);
  });

  await test("pure: a reminder that became a note line is written as the reminder until the note is in its file", async () => {
    const io = memoryIO(), fileState = new Map([["n-day", "absent"]]), { store, live, fire } = pureStore(io, fileState);
    await store.open();
    store.upsert(reminder("m1", "Call the bank"));
    const mirrored = mirror(store, "m1", "n-day"); // the composer does both in one step: the reminder itself is never written
    await store.flush();
    let saved = inFile(io);
    assert.deepEqual(saved.map((it) => [it.id, it.x.src, it.x.noteId]), [["m1", "manual", ""]], "the file has the reminder, not a record of a note that does not exist");
    assert.equal(saved[0].description, "bring the papers");
    assert.deepEqual(plain(store.list().map((it) => it.id)), [mirrored.id], "this window keeps showing the line record, once");
    assert.equal(store.storageState().dirty, true, "and remembers that something is still to be written");
    assert.deepEqual(live(), [], "without a timer: a note that cannot be saved is not polled from here");
    // The note is still not there: being told that some other note was saved changes nothing in the file.
    const writesBefore = io.writes.length;
    store.noteTextSaved(); await settle();
    assert.deepEqual(inFile(io).map((it) => it.id), ["m1"]);
    assert.equal(io.writes.length, writesBefore + 1, "one attempt per saved note");
    assert.deepEqual(live(), [], "and no loop");
    // The note is saved: the line record replaces the reminder in the file, at once.
    fileState.set("n-day", "saved");
    store.noteTextSaved(); await settle();
    saved = inFile(io);
    assert.deepEqual(saved.map((it) => [it.id, it.x.src, it.x.noteId]), [[mirrored.id, "list", "n-day"]], "one record, now the line record");
    assert.equal(saved[0].description, "bring the papers");
    assert.equal(store.storageState().dirty, false);
    const writesAfter = io.writes.length;
    store.noteTextSaved(); await settle();
    assert.equal(io.writes.length, writesAfter, "nothing waits any more: no further write");
  });

  await test("pure: a reminder that was already in the file stays there while its line waits for the note, and follows edits", async () => {
    const io = memoryIO(), fileState = new Map(), { store } = pureStore(io, fileState);
    await store.open();
    store.upsert(reminder("m1", "Call the bank")); store.upsert(reminder("m2", "Unrelated"));
    await store.flush();
    const before = inFile(io).find((it) => it.id === "m1");
    fileState.set("n-day", "stale"); // the date note exists, its new line could not be saved
    const mirrored = mirror(store, "m1", "n-day");
    store.upsert({ ...store.get("m2"), summary: "Unrelated, edited" });
    await store.flush();
    const saved = inFile(io);
    assert.deepEqual(saved.find((it) => it.id === "m1"), before, "the reminder is exactly as it was");
    assert.equal(saved.some((it) => it.id === mirrored.id), false);
    assert.equal(saved.find((it) => it.id === "m2").summary, "Unrelated, edited", "other calendar changes are saved as usual");
    // Another window that reads the file now sees one reminder.
    const other = pureStore(io, new Map()).store; await other.open();
    assert.deepEqual(plain(other.list().map((it) => it.summary)).sort(), ["Call the bank", "Unrelated, edited"]);
    // The reminder is moved while its line still waits: the file gets the new time, on the reminder.
    const later = new Date(NOW + 60 * 3600000).toISOString();
    store.upsert({ ...store.get(mirrored.id), start: { dateTime: later }, updated: new Date(NOW + 5000).toISOString() });
    await store.flush();
    const moved = inFile(io).find((it) => it.id === "m1");
    assert.deepEqual([moved.start.dateTime, moved.x.src, moved.x.noteId], [later, "manual", ""]);
    assert.equal(inFile(io).some((it) => it.id === mirrored.id), false);
    fileState.set("n-day", "saved");
    await store.flush();
    assert.deepEqual(inFile(io).map((it) => it.id).sort(), [mirrored.id, "m2"].sort(), "afterwards the line record takes its place");
    assert.equal(inFile(io).find((it) => it.id === mirrored.id).start.dateTime, later);
  });

  await test("pure: a typed line waits for its note; a record that already points at its note never waits", async () => {
    const io = memoryIO(), fileState = new Map(), { store } = pureStore(io, fileState);
    await store.open();
    const body = "## Agenda\n%%calendar%%\n- [ ] 2026-11-17 09:00 Existing line %%zn-item-id:aaaa11%%\n";
    store.syncNote("n1", body, { sourceEdit: true, updatedAt: NOW });
    await store.flush();
    const existing = inFile(io)[0];
    assert.equal(existing.summary, "Existing line");
    // The note gets a second line and cannot be saved; the first line's reminder is moved in the calendar.
    fileState.set("n1", "stale");
    store.syncNote("n1", body + "- [ ] 2026-11-17 11:00 Typed and unsaved %%zn-item-id:bbbb22%%\n", { sourceEdit: true, updatedAt: NOW + 1000 });
    const moved = new Date(NOW + 50 * 3600000).toISOString();
    store.upsert({ ...store.get(existing.id), start: { dateTime: moved } });
    await store.flush();
    let saved = inFile(io);
    assert.deepEqual(saved.map((it) => it.summary), ["Existing line"], "the typed line has no record in the file yet");
    assert.equal(saved[0].start.dateTime, moved, "the moved time is saved although the note is not");
    assert.equal(store.list().length, 2, "both are shown in this window");
    fileState.set("n1", "saved");
    await store.flush();
    assert.deepEqual(inFile(io).map((it) => it.summary).sort(), ["Existing line", "Typed and unsaved"]);
  });

  await test("pure: a reminder line moved to a day whose note cannot be saved is kept as the reminder, with the new time", async () => {
    const io = memoryIO(), fileState = new Map(), { store } = pureStore(io, fileState);
    await store.open();
    store.upsert(reminder("m1", "Call the bank"));
    const first = mirror(store, "m1", "n-monday");
    await store.flush();
    assert.deepEqual(inFile(io).map((it) => it.id), [first.id]);
    // Rescheduled to another day: the line leaves Monday's note (saved) and joins Friday's note (cannot be saved).
    const moved = new Date(NOW + 100 * 3600000).toISOString();
    const second = store.upsert(C.mirroredItem({ ...store.get(first.id), start: { dateTime: moved } }, "n-friday", first.x.key, "Agenda"));
    store.remove(first.id);
    fileState.set("n-friday", "absent");
    await store.flush();
    let saved = inFile(io);
    assert.deepEqual(saved.map((it) => [it.id, it.x.src, it.x.noteId]), [["m1", "manual", ""]], "neither note file has the line: the file keeps the reminder itself");
    assert.equal(saved[0].start.dateTime, moved, "at its new time");
    // Had Monday's note not been saved either, its file would still have the line: then the old record simply stays.
    const io2 = memoryIO(), state2 = new Map(), other = pureStore(io2, state2).store;
    await other.open(); other.upsert(reminder("m1", "Call the bank")); const one = mirror(other, "m1", "n-monday"); await other.flush();
    other.upsert(C.mirroredItem({ ...other.get(one.id), start: { dateTime: moved } }, "n-friday", one.x.key, "Agenda")); other.remove(one.id);
    state2.set("n-friday", "absent"); state2.set("n-monday", "stale");
    await other.flush();
    assert.deepEqual(inFile(io2).map((it) => [it.id, it.x.noteId]), [[one.id, "n-monday"]]);
    // Friday's note is saved: one record, the line record of Friday.
    fileState.set("n-friday", "saved");
    await store.flush();
    saved = inFile(io);
    assert.deepEqual(saved.map((it) => [it.id, it.x.noteId]), [[second.id, "n-friday"]]);
  });

  await test("pure: a link to a note without a file is not written; a link to a note whose file is only older is", async () => {
    const io = memoryIO(), fileState = new Map([["n-new", "absent"], ["n-old", "stale"]]), { store } = pureStore(io, fileState);
    await store.open();
    store.upsert(reminder("a1", "Linked to a note that does not exist yet", { noteId: "n-new", heading: "Agenda" }));
    store.upsert(reminder("a2", "Linked to an existing note", { noteId: "n-old", heading: "Agenda" }));
    await store.flush();
    const saved = new Map(inFile(io).map((it) => [it.id, it]));
    assert.deepEqual([saved.get("a1").x.noteId, saved.get("a1").x.heading], ["", ""], "after a restart this reminder is visible, not hidden behind a missing note");
    assert.equal(saved.get("a1").summary, "Linked to a note that does not exist yet");
    assert.equal(saved.get("a2").x.noteId, "n-old");
    assert.equal(store.get("a1").x.noteId, "n-new", "in this window the link is kept");
    // A reminder already in the file is edited and linked in one step: the edit is written, the link waits.
    fileState.set("n-other", "absent");
    store.upsert({ ...store.get("a2"), summary: "Renamed and linked elsewhere", x: { ...store.get("a2").x, noteId: "n-other" } });
    await store.flush();
    const relinked = inFile(io).find((it) => it.id === "a2");
    assert.deepEqual([relinked.summary, relinked.x.noteId], ["Renamed and linked elsewhere", "n-old"]);
    fileState.set("n-new", "saved"); fileState.set("n-other", "saved");
    await store.flush();
    assert.equal(inFile(io).find((it) => it.id === "a1").x.noteId, "n-new");
    assert.equal(inFile(io).find((it) => it.id === "a2").x.noteId, "n-other");
    // A store that is not told about note files behaves as before.
    const io2 = memoryIO(), bare = C.createItemStore({ io: io2, getDir: () => "/notes", now: () => NOW, setTimer: () => 1, clearTimer() {} });
    await bare.open(); bare.upsert(reminder("b1", "Plain", { noteId: "whatever", heading: "Agenda" })); await bare.flush();
    assert.equal(inFile(io2)[0].x.noteId, "whatever");
    assert.equal(typeof bare.noteTextSaved, "function"); bare.noteTextSaved();
  });

  // ---- part 2: the real store in a window, with the restart ----------------------------------------------------------
  const PREF = "zen.workspace.zentral.notes.agenda_folder", CAL = "/profile/zentral-notes/" + C.ITEMS_FILE;
  class FlakyFiles extends Map {
    constructor() { super(); this.fail = null; }
    set(key, value) { if (this.fail && this.fail(String(key))) throw new Error("injected write failure"); return super.set(key, value); }
  }
  async function host(files, id, shared) {
    const h = createFakeZen({ files, id, prefs: { [PREF]: true }, hiddenDOMWindow: shared });
    await h.seam.ensureStore(); h.fireTimer(6500); await Promise.resolve(); return h;
  }
  const noteFile = (files, id) => [...files.keys()].find((p) => p.endsWith("/" + id + ".md") && !p.includes("/backup/") && !p.includes("/history/"));
  const notesOnly = (p) => /\.md(\.tmp)?$/.test(p); // note files cannot be written; calendar.json can
  const calendar = (files) => JSON.parse(files.get(CAL) || "{\"items\":[]}").items;
  const tomorrow = (hour) => C.addDays(C.dayStart(Date.now()), 1) + hour * 3600000;
  // What the composer does when a reminder is created: store it, then write its line into the date note at once.
  const compose = (h, id, summary, hour = 10) => {
    const item = h.seam.store.items.upsert(C.makeItem({ id, summary, description: "details kept only in the calendar", start: { dateTime: new Date(tomorrow(hour)).toISOString() }, x: { kind: "reminder", src: "manual" } }));
    return { item, noteId: h.seam.store.mirrorItemToAgendaNote(item.id) };
  };
  const named = (list, summary) => plain(list.filter((it) => it.summary === summary));
  async function crashAndRestart(files, a, shared, id) {
    files.fail = () => true; await a.destroy().catch(() => {}); files.fail = null; // the process dies: nothing else is written
    const b = await host(files, id, shared);
    b.seam.agendaController.runNow();
    return b;
  }

  await test("a new reminder whose date note cannot be created survives a restart, with its details and one line", () => quiet(async () => {
    const files = new FlakyFiles(), shared = { Map };
    const a = await host(files, "absent-a", shared);
    files.fail = notesOnly;
    const { noteId } = compose(a, "c1", "Composer reminder");
    assert.ok(noteId, "in this window the reminder is a line of the date note");
    await a.seam.store.flush().catch(() => {});
    assert.equal(a.seam.store.state.save, "error", "the note could not be saved and says so");
    assert.equal(noteFile(files, noteId), undefined, "the date note has no file");
    const saved = named(calendar(files), "Composer reminder");
    assert.equal(saved.length, 1, "the calendar file has the reminder");
    assert.deepEqual([saved[0].id, saved[0].x.src, saved[0].x.noteId], ["c1", "manual", ""], "as a reminder of its own, not as a record of the missing note");
    assert.equal(named(a.seam.store.items.list(), "Composer reminder").length, 1, "this window shows it once");
    const b = await crashAndRestart(files, a, shared, "absent-b");
    try {
      const found = named(b.seam.store.items.list(), "Composer reminder");
      assert.equal(found.length, 1, "after the restart the reminder is there (before: stored but hidden for good)");
      assert.equal(found[0].description, "details kept only in the calendar");
      assert.equal(new Date(found[0].start.dateTime).getTime(), tomorrow(10));
      assert.equal(found[0].x.src, "list", "and it is a line of the date note again");
      assert.equal((b.seam.store.get(found[0].x.noteId).body.match(/Composer reminder/g) || []).length, 1);
      await b.seam.store.flush();
      assert.deepEqual(named(calendar(files), "Composer reminder").map((it) => it.x.src), ["list"], "one record in the file, now with its line saved");
      assert.match(files.get(noteFile(files, found[0].x.noteId)), /Composer reminder/);
    } finally { await b.destroy(); }
  }));

  await test("a new reminder whose line cannot be added to an existing date note survives a restart (before: dropped)", () => quiet(async () => {
    const files = new FlakyFiles(), shared = { Map };
    const a = await host(files, "stale-a", shared);
    const first = compose(a, "c0", "Older one", 12);
    await a.seam.store.flush();
    assert.match(files.get(noteFile(files, first.noteId)), /Older one/);
    files.fail = notesOnly;
    const { noteId } = compose(a, "c1", "Composer reminder");
    assert.equal(noteId, first.noteId, "the same date note");
    await a.seam.store.flush().catch(() => {});
    assert.doesNotMatch(files.get(noteFile(files, noteId)), /Composer reminder/, "the line is not in the file");
    assert.deepEqual(named(calendar(files), "Composer reminder").map((it) => [it.id, it.x.src]), [["c1", "manual"]]);
    assert.deepEqual(named(calendar(files), "Older one").map((it) => it.x.src), ["list"], "the earlier line record is untouched");
    const b = await crashAndRestart(files, a, shared, "stale-b");
    try {
      assert.deepEqual(plain(b.seam.store.items.list().map((it) => it.summary)).sort(), ["Composer reminder", "Older one"]);
      const body = b.seam.store.get(noteId).body;
      assert.equal((body.match(/Composer reminder/g) || []).length, 1);
      assert.equal((body.match(/Older one/g) || []).length, 1);
    } finally { await b.destroy(); }
  }));

  await test("when the note can be saved again the calendar file follows by itself: one record, the line record", () => quiet(async () => {
    const files = new FlakyFiles(), shared = { Map };
    const a = await host(files, "retry-a", shared);
    try {
      files.fail = notesOnly;
      const { noteId } = compose(a, "c1", "Composer reminder");
      await a.seam.store.flush().catch(() => {});
      assert.deepEqual(named(calendar(files), "Composer reminder").map((it) => it.x.src), ["manual"]);
      assert.equal([...a.timers.values()].some((t) => t.ms === 600), false, "the calendar does not poll while the note cannot be saved");
      files.fail = null; // the folder is writable again
      assert.ok(a.fireTimer(10000), "the note store tries again after ten seconds");
      assert.ok(a.fireTimer(800)); await settle();
      assert.match(files.get(noteFile(files, noteId)) || "", /Composer reminder/, "the note is saved");
      // ...and the calendar file is written straight after it, without any further change by the user.
      const saved = named(calendar(files), "Composer reminder");
      assert.deepEqual(saved.map((it) => [it.x.src, it.x.noteId]), [["list", noteId]], "the line record replaced the reminder: one record");
      assert.equal(saved[0].description, "details kept only in the calendar");
      assert.equal(a.seam.store.items.storageState().dirty, false);
      assert.equal(a.seam.store.state.save, "saved");
    } finally { await a.destroy(); }
  }));

  await test("a reminder moved to another day whose date note cannot be created survives a restart at its new time", () => quiet(async () => {
    const files = new FlakyFiles(), shared = { Map };
    const a = await host(files, "move-a", shared);
    const first = compose(a, "c1", "Composer reminder");
    await a.seam.store.flush();
    const before = named(a.seam.store.items.list(), "Composer reminder")[0];
    assert.equal(before.x.noteId, first.noteId);
    // Dragged two days later: its line leaves tomorrow's date note and joins a date note that does not exist yet.
    const later = tomorrow(10) + 2 * 86400000;
    const moved = a.seam.store.items.upsert({ ...before, start: { dateTime: new Date(later).toISOString() } });
    files.fail = (p) => notesOnly(p) && !p.includes("/" + first.noteId + ".md"); // only the old note can be written
    assert.equal(a.seam.store.syncItemScheduleToNote(moved), true);
    const now = named(a.seam.store.items.list(), "Composer reminder");
    assert.equal(now.length, 1); assert.notEqual(now[0].x.noteId, first.noteId, "in this window the line is in the new day's note");
    await a.seam.store.flush().catch(() => {});
    assert.doesNotMatch(files.get(noteFile(files, first.noteId)), /Composer reminder/, "the old note was saved without the line");
    assert.equal(noteFile(files, now[0].x.noteId), undefined, "the new note has no file");
    const saved = named(calendar(files), "Composer reminder");
    assert.deepEqual(saved.map((it) => [it.id, it.x.src, it.x.noteId]), [["c1", "manual", ""]], "no note file has the line, so the calendar file keeps the reminder itself");
    assert.equal(new Date(saved[0].start.dateTime).getTime(), later);
    const b = await crashAndRestart(files, a, shared, "move-b");
    try {
      const found = named(b.seam.store.items.list(), "Composer reminder");
      assert.equal(found.length, 1, "one reminder after the restart (before: none)");
      assert.equal(new Date(found[0].start.dateTime).getTime(), later, "at the time it was moved to");
      assert.equal(found[0].description, "details kept only in the calendar");
      assert.equal(found[0].x.src, "list");
      assert.equal((b.seam.store.get(found[0].x.noteId).body.match(/Composer reminder/g) || []).length, 1, "written as a line of the new day's note");
    } finally { await b.destroy(); }
  }));

  await test("a typed Agenda line that could not be saved leaves no record in the calendar file", () => quiet(async () => {
    const files = new FlakyFiles(), shared = { Map };
    const a = await host(files, "typed-a", shared);
    const day = C.localDateKey(tomorrow(9));
    const note = a.seam.store.create("# Plain\n\n## Agenda\n%%calendar%%\n- [ ] " + day + " 09:00 Existing line\n");
    await a.seam.store.flush();
    files.fail = notesOnly;
    a.seam.store.update(note.id, a.seam.store.get(note.id).body + "- [ ] " + day + " 11:00 Typed and unsaved\n");
    await a.seam.store.flush().catch(() => {});
    assert.deepEqual(calendar(files).map((it) => it.summary), ["Existing line"], "no record for text that is not in the file");
    assert.equal(a.seam.store.items.list().length, 2, "the window itself shows both");
    const b = await crashAndRestart(files, a, shared, "typed-b");
    try {
      assert.deepEqual(plain(b.seam.store.items.list().map((it) => it.summary)), ["Existing line"], "the restart shows what the note file says");
      assert.deepEqual(calendar(files).map((it) => it.summary), ["Existing line"]);
    } finally { await b.destroy(); }
  }));

  console.log(`\n${passed} unsaved-note record tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
