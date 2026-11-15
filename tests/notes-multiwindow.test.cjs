"use strict";
// UI4.7: serialized claims, calendar merges, note-conflict recovery, restored mirrors, blocked writes,
// writers that take no lock, and the fixed order of the note and calendar files.
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const PREF = "zen.workspace.zentral.notes.agenda_folder";
const tabs = h => h.document.querySelectorAll("tab[bgalazka-notes-agenda-item]").filter(t => !t.getAttribute("bgalazka-notes-agenda-item").startsWith("seed:"));
async function host(files, id, hiddenDOMWindow = null) {
  const h = createFakeZen({ files, id, prefs: { [PREF]: true }, hiddenDOMWindow });
  await h.seam.ensureStore(); h.fireTimer(6500); await Promise.resolve(); return h;
}
(async () => {
  const files = new Map(), a = await host(files, "a");
  const start = C.addDays(C.dayStart(Date.now()), 1) + 10 * 3600000;
  const item = a.seam.store.items.upsert(C.makeItem({ id: "trash-mirror", summary: "Restore mirror", start: { dateTime: new Date(start).toISOString() }, x: { kind: "reminder", src: "manual" } }));
  assert.ok(item); const noteId = a.seam.store.mirrorItemToAgendaNote(item.id); assert.ok(noteId);
  a.seam.agendaController.runNow(); assert.equal(tabs(a).length, 1);
  const text = a.seam.store.get(noteId).body, markerCount = (text.match(/%%zn-item-id:/g) || []).length;
  assert.equal(markerCount, 1); a.seam.store.trash(noteId); assert.ok(a.seam.store.get(noteId).trashed);
  a.seam.agendaController.runNow(); assert.equal(tabs(a).length, 0, "a trashed source note is hidden from Agenda");
  assert.equal(a.seam.store.items.list().filter(x => x.summary === "Restore mirror").length, 0);
  a.seam.store.restore(noteId); assert.ok(!a.seam.store.get(noteId).trashed); a.seam.agendaController.runNow();
  assert.equal(tabs(a).length, 1); assert.equal(a.seam.store.items.list().filter(x => x.summary === "Restore mirror").length, 1);
  assert.equal((a.seam.store.get(noteId).body.match(/%%zn-item-id:/g) || []).length, 1);
  await a.seam.store.flush();
  const b = await host(files, "b"); b.seam.agendaController.runNow();
  assert.equal(tabs(b).length, 1, "a second window sees the restored item");
  assert.equal(b.seam.store.items.list().filter(x => x.summary === "Restore mirror").length, 1);
  assert.equal((b.seam.store.get(noteId).body.match(/%%zn-item-id:/g) || []).length, 1);
  const identity = C.reminderIdentity(b.seam.store.items.list().find(x => x.summary === "Restore mirror"));
  const entry = { ...identity, start: { dateTime: new Date(start).toISOString() }, stage: "pre", at: Date.now() };
  assert.ok(await a.seam.store.items.history.claimAlert(entry));
  assert.equal(await b.seam.store.items.history.claimAlert(entry), null, "the second window does not claim an already persisted stage");
  await a.destroy();
  assert.ok(await b.seam.store.items.history.claimAlert({ ...entry, stage: "due" }), "remaining window can claim a later stage after the other closes");
  await b.destroy();
  const fallback = C.resolveAgendaWindow({ x: {} }, undefined, undefined, undefined);
  assert.equal(fallback.enabled, true); assert.equal(fallback.leadDays, 0); assert.equal(fallback.tailDays, 0);
  assert.equal(typeof C.resolveAlertPolicy({ x: {} }, undefined, undefined, undefined, "due").sound, "string");
  assert.equal(C.resolveItemColor("none", undefined), "");
  console.log("Multiwindow serialized claims and mirror/trash tests passed");
})().catch(e => { console.error(e); process.exitCode = 1; });

// TODO-marked acceptance cases remain unfulfilled despite a zero test exit code.
const test = require("node:test");
function sharedIO() {
  const files = new Map();
  return {
    files,
    join: (...p) => p.join("/"),
    readUTF8: async p => { if (!files.has(p)) { const e = new Error("not found"); e.code = "ENOENT"; throw e; } return files.get(p); },
    writeUTF8: async (p, text) => { files.set(p, text); },
    exists: async p => files.has(p),
  };
}
test("stale windows preserve independent calendar edits", async () => {
  const io = sharedIO(); let now = 1700000000000;
  const options = { io, getDir: () => "/notes", now: () => now, setTimer: () => 1, clearTimer() {} };
  const seed = C.createItemStore(options); await seed.open();
  for (const id of ["a", "b"]) seed.upsert(C.makeItem({ id, summary: id, start: { dateTime: new Date(now + 86400000).toISOString() }, x: { kind: "event", src: "manual" } }, now));
  await seed.flush();
  const a = C.createItemStore(options), b = C.createItemStore(options); await a.open(); await b.open();
  now += 1000; a.upsert({ ...a.get("a"), summary: "A edited" }); await a.flush();
  now += 1000; b.upsert({ ...b.get("b"), summary: "B edited" }); await b.flush();
  const result = C.createItemStore(options); await result.open();
  assert.equal(result.get("a").summary, "A edited");
  assert.equal(result.get("b").summary, "B edited");
});
test("simultaneous stores sharing a coordinator claim a reminder stage only once", async () => {
  const io = sharedIO(), now = 1700000000000;
  const options = { io, getDir: () => "/notes", now: () => now, setTimer: () => 1, clearTimer() {} };
  const a = C.createReminderHistoryStore(options), b = C.createReminderHistoryStore(options); await a.open(); await b.open();
  const entry = { itemId: "item", occurrenceId: "occ", stage: "due", start: { dateTime: new Date(now).toISOString() }, at: now };
  const claims = await Promise.all([a.claimAlert(entry), b.claimAlert(entry)]);
  assert.equal(claims.filter(Boolean).length, 1);
});
test("Done versus a stale edit preserves the displaced version and notifies both windows", async () => {
  const files = new Map(), sharedWindow = { Map };
  const a = await host(files, "done-a", sharedWindow);
  const start = C.localDateKey(C.addDays(C.dayStart(Date.now()), 2));
  const note = a.seam.store.create(`# Concurrent\n\n## Agenda\n%%calendar%%\n- [ ] ${start} 09:00 Original %%zn-item-id:conflict1%%\n`);
  a.seam.store.stabilizeItems(note.id); await a.seam.store.flush();
  const b = await host(files, "edit-b", sharedWindow), eventsA = [], eventsB = []; let reopened;
  try {
    a.seam.store.on(e => eventsA.push(e)); b.seam.store.on(e => eventsB.push(e));
    const item = a.seam.store.items.list({ noteId: note.id })[0]; assert.ok(item);
    b.seam.store.update(note.id, b.seam.store.get(note.id).body.replace("Original", "Edited in B"));
    assert.ok(a.seam.store.applyReminderLifecycle(item, "done")); await a.seam.store.flush();
    b.seam.store.onRemoteMessage(JSON.stringify({ origin: "done-a", id: note.id }));
    await Promise.resolve(); await b.seam.store.flush();

    const conflict = eventsB.find(e => e.type === "conflict");
    assert.ok(conflict?.backupPath, "the stale writer stores the displaced file in Notes recovery");
    const preserved = files.get(conflict.backupPath + "/" + note.id + ".md");
    assert.match(preserved || "", /\[x\].*Original/, "the recovery copy retains the Done version");

    a.seam.store.onRemoteMessage(JSON.stringify({ origin: "edit-b", id: note.id, conflictBackupPath: conflict.backupPath }));
    await new Promise(resolve => setImmediate(resolve));
    reopened = await host(files, "reopened", sharedWindow);
    assert.match(reopened.seam.store.get(note.id).body, /Edited in B/, "the last saved edit is retained");
    assert.ok(eventsA.some(e => e.type === "conflict"), "the other window receives a visible conflict event");
  } finally { if (reopened) await reopened.destroy(); await a.destroy(); await b.destroy(); }
});

// There is currently no category rename/delete store operation. Simulate an
// externally removed/replaced definition on disk, not a UI operation.
test("used category falls back safely after its stored definition is removed or renamed", async () => {
  const io = sharedIO(), now = 1700000000000;
  const options = { io, getDir: () => "/notes", now: () => now, setTimer: () => 1, clearTimer() {} };
  const original = C.createItemStore(options); await original.open();
  original.upsertCategory({ name: "Projects", color: "#123456", agenda: { enabled: false, leadDays: 4 }, notify: { due: { sound: "silent" } } });
  original.upsert(C.makeItem({ id: "project", summary: "Project", start: { dateTime: new Date(now + 86400000).toISOString() }, x: { category: "Projects", kind: "event", src: "manual" } }, now));
  await original.flush();
  const disk = JSON.parse(io.files.get("/notes/" + C.ITEMS_FILE));
  for (const categories of [[], [{ ...disk.categories[0], name: "Renamed" }]]) {
    io.files.set("/notes/" + C.ITEMS_FILE, JSON.stringify({ ...disk, categories }));
    const reopened = C.createItemStore(options); await reopened.open();
    const item = reopened.get("project"), category = reopened.category(item.x.category);
    assert.ok(category, "a used orphan name still resolves to safe defaults");
    assert.equal(category.color, "#7d8da8");
    assert.equal(C.resolveAgendaWindow(item, category.agenda).enabled, true);
    const alert = C.resolveAlertPolicy(item, category.notify, null, null, "due", now);
    assert.equal(typeof alert.sound, "string"); assert.equal(typeof alert.play, "boolean");
    assert.equal(C.resolveItemColor("none", category.color), "#7d8da8");
  }
});

// A profile whose writes can fail per path (full disk, lost permission, a crash between two files) and
// that records the order in which files reach the disk.
class FlakyFiles extends Map {
  constructor() { super(); this.fail = null; this.log = []; }
  set(key, value) {
    if (this.fail && this.fail(String(key))) throw new Error("injected write failure");
    this.log.push(String(key)); return super.set(key, value);
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const noteFile = (files, id) => [...files.keys()].find(p => p.endsWith("/" + id + ".md") && !p.includes("/backup/") && !p.includes("/history/"));
const quiet = async run => { const warn = console.warn; console.warn = () => {}; try { return await run(); } finally { console.warn = warn; } };

test("a write blocked by a failed recovery copy keeps later edits and saves them once the copy can be stored", () => quiet(async () => {
  const files = new FlakyFiles(), sharedWindow = { Map };
  const a = await host(files, "block-a", sharedWindow);
  const start = C.localDateKey(C.addDays(C.dayStart(Date.now()), 2));
  const note = a.seam.store.create(`# Blocked\n\n## Agenda\n%%calendar%%\n- [ ] ${start} 09:00 Original\n`);
  a.seam.store.stabilizeItems(note.id); await a.seam.store.flush();
  const b = await host(files, "block-b", sharedWindow), eventsB = [], path = noteFile(files, note.id); let reopened;
  try {
    b.seam.store.on(e => eventsB.push(e));
    const edit = (from, to) => b.seam.store.update(note.id, b.seam.store.get(note.id).body.replace(from, to));
    const conflicts = winner => eventsB.filter(e => e.type === "conflict" && e.winner === winner);
    edit("Original", "First edit");
    const item = a.seam.store.items.list({ noteId: note.id })[0]; assert.ok(item);
    assert.ok(a.seam.store.applyReminderLifecycle(item, "done")); await a.seam.store.flush();
    const doneText = files.get(path);
    assert.match(doneText, /\[x\].*Original/, "window A saved the Done version");

    files.fail = p => p.includes("/backup/");
    await b.seam.store.flush();
    assert.equal(files.get(path), doneText, "the stale write is blocked while the displaced version cannot be preserved");
    assert.equal(b.seam.store.state.save, "error", "the blocked save is reported, not hidden");
    assert.equal(conflicts("unresolved").length, 1);
    assert.equal(conflicts("unresolved")[0].reason, "backup-failed");

    // The person keeps typing; a notification from the other window must not replace the pending text.
    edit("First edit", "Second edit");
    b.seam.store.onRemoteMessage(JSON.stringify({ origin: "block-a", id: note.id })); await settle();
    assert.match(b.seam.store.get(note.id).body, /Second edit/, "pending local text survives a remote notification");
    await b.seam.store.flush();
    assert.equal(files.get(path), doneText, "every retry stays blocked until a recovery copy exists");
    assert.equal(conflicts("local").length, 0);
    assert.equal([...files.keys()].filter(p => p.includes("/backup/")).length, 0, "no partial recovery entry is left behind");

    files.fail = null;
    edit("Second edit", "Third edit");
    await b.seam.store.flush();
    assert.equal(conflicts("local").length, 1, "the save completes once the recovery copy can be written");
    assert.equal(files.get(conflicts("local")[0].backupPath + "/" + note.id + ".md"), doneText, "the recovery copy holds the displaced Done version exactly");
    assert.match(files.get(path), /Third edit/, "the newest local text is saved, not an earlier blocked attempt");
    assert.doesNotMatch(files.get(path), /First edit|Second edit/);
    assert.equal(b.seam.store.state.save, "saved");
    assert.equal(b.seam.store.state.error, "");

    edit("Third edit", "Fourth edit");
    await b.seam.store.flush();
    assert.equal(conflicts("local").length, 1, "a later ordinary save reports no further conflict");
    assert.equal([...files.keys()].filter(p => p.includes("/backup/")).length, 1, "and writes no second recovery copy");
    reopened = await host(files, "block-reopened", sharedWindow);
    assert.match(reopened.seam.store.get(note.id).body, /Fourth edit/);
  } finally { files.fail = null; if (reopened) await reopened.destroy(); await a.destroy(); await b.destroy(); }
}));

test("a writer that takes no lock and sends no notification is detected and its text is kept in recovery", async () => {
  const files = new FlakyFiles(), sharedWindow = { Map };
  const a = await host(files, "external-a", sharedWindow), events = [];
  try {
    const note = a.seam.store.create("# External\n\nShared paragraph\n"); await a.seam.store.flush();
    const path = noteFile(files, note.id);
    a.seam.store.on(e => events.push(e));
    // A sync tool or another editor rewrites the file while this window holds unsaved typing.
    const external = files.get(path).replace("Shared paragraph", "Edited by another application");
    files.set(path, external);
    a.seam.store.update(note.id, a.seam.store.get(note.id).body.replace("Shared paragraph", "Typed in Notes"));
    await a.seam.store.flush();
    const conflict = events.find(e => e.type === "conflict");
    assert.equal(conflict?.winner, "local");
    assert.equal(files.get(conflict.backupPath + "/" + note.id + ".md"), external, "the other application's version is recoverable");
    assert.match(files.get(path), /Typed in Notes/);
    // An unchanged file is not a conflict: the next save writes no recovery copy.
    a.seam.store.update(note.id, a.seam.store.get(note.id).body.replace("Typed in Notes", "Typed again"));
    await a.seam.store.flush();
    assert.equal(events.filter(e => e.type === "conflict").length, 1);
  } finally { await a.destroy(); }
});

test("note text reaches the disk before the calendar record that refers to it", async () => {
  const files = new FlakyFiles(), sharedWindow = { Map };
  const a = await host(files, "order-a", sharedWindow);
  try {
    await a.seam.store.flush(); files.log.length = 0;
    const at = day => new Date(C.addDays(C.dayStart(Date.now()), day) + 10 * 3600000).toISOString();
    const order = () => {
      const calendar = files.log.lastIndexOf("/profile/zentral-notes/" + C.ITEMS_FILE);
      const note = files.log.findIndex(p => /\/zentral-notes\/[^/]+\.md$/.test(p));
      return { calendar, note };
    };
    // 1. The calendar's own debounce fires before the note autosave: it must save the note first.
    const first = a.seam.store.items.upsert(C.makeItem({ id: "order-1", summary: "Ordered by timer", start: { dateTime: at(1) }, x: { kind: "reminder", src: "manual" } }));
    assert.ok(a.seam.store.mirrorItemToAgendaNote(first.id));
    for (const [id, timer] of [...a.timers]) if (timer.ms === 600) { a.timers.delete(id); timer.fn(); }
    for (let i = 0; i < 6; i++) await settle();
    let seen = order();
    assert.ok(seen.note >= 0 && seen.calendar >= 0, "both files were written by the calendar timer alone");
    assert.ok(seen.note < seen.calendar, "the note line is on disk before calendar.json mentions it");
    // 2. An explicit flush keeps the same order.
    files.log.length = 0;
    const second = a.seam.store.items.upsert(C.makeItem({ id: "order-2", summary: "Ordered by flush", start: { dateTime: at(2) }, x: { kind: "reminder", src: "manual" } }));
    assert.ok(a.seam.store.mirrorItemToAgendaNote(second.id));
    await a.seam.store.flush();
    seen = order();
    assert.ok(seen.note >= 0 && seen.note < seen.calendar, "flush writes the note before the calendar");
    const saved = JSON.parse(files.get("/profile/zentral-notes/" + C.ITEMS_FILE)).items;
    for (const record of saved.filter(it => it.x.src === "list")) {
      const text = files.get(noteFile(files, record.x.noteId)) || "";
      assert.ok(text.includes(record.summary), "every saved list record has its line on disk: " + record.summary);
    }
  } finally { await a.destroy(); }
});

test("a crash between the note and the calendar write leaves one reminder, one line and its details", () => quiet(async () => {
  const files = new FlakyFiles(), sharedWindow = { Map };
  const a = await host(files, "crash-a", sharedWindow);
  const start = C.addDays(C.dayStart(Date.now()), 1) + 10 * 3600000;
  const manual = a.seam.store.items.upsert(C.makeItem({ id: "crash-1", summary: "Survives a crash", description: "Bring the documents", start: { dateTime: new Date(start).toISOString() }, x: { kind: "reminder", src: "manual" } }));
  await a.seam.store.flush(); // the composer saved the item; the mirror line is written a moment later
  const noteId = a.seam.store.mirrorItemToAgendaNote(manual.id); assert.ok(noteId);
  files.fail = p => p.endsWith("/" + C.ITEMS_FILE); // the note write lands, the calendar write does not
  await a.seam.store.flush().catch(() => {});
  assert.match(files.get(noteFile(files, noteId)) || "", /Survives a crash/, "the note half of the pair is on disk");
  assert.ok(JSON.parse(files.get("/profile/zentral-notes/" + C.ITEMS_FILE)).items.some(it => it.id === "crash-1" && it.x.src === "manual"), "the calendar half still holds the item as it was before the mirror");
  files.fail = () => true; // the process dies: nothing else is written
  await a.destroy().catch(() => {});
  files.fail = null;
  const b = await host(files, "crash-b", sharedWindow);
  try {
    b.seam.store.backfillAgendaLinks(); b.seam.agendaController.runNow();
    const found = b.seam.store.items.list().filter(it => it.summary === "Survives a crash");
    assert.equal(found.length, 1, "the manual record and its mirror line are one item again, not two");
    assert.equal(found[0].x.src, "list");
    assert.equal(found[0].description, "Bring the documents", "details stored only in the calendar survive");
    assert.equal(new Date(found[0].start.dateTime).getTime(), start);
    assert.equal((b.seam.store.get(noteId).body.match(/Survives a crash/g) || []).length, 1, "the line is not written twice");
    assert.equal(tabs(b).length, 1);
    await b.seam.store.flush();
    const c = await host(files, "crash-c", sharedWindow);
    try {
      assert.equal(c.seam.store.items.list().filter(it => it.summary === "Survives a crash").length, 1, "the repaired pair is stable across another start");
      assert.equal((c.seam.store.get(noteId).body.match(/Survives a crash/g) || []).length, 1);
    } finally { await c.destroy(); }
  } finally { await b.destroy(); }
}));

test("the calendar write hook runs first and a failing hook never blocks the calendar", async () => {
  const io = sharedIO(), now = 1700000000000, calls = [];
  const write = io.writeUTF8; io.writeUTF8 = async (p, text) => { calls.push("write"); return write(p, text); };
  let fail = false;
  const store = C.createItemStore({ io, getDir: () => "/notes", now: () => now, setTimer: () => 1, clearTimer() {},
    beforeWrite: async () => { await null; calls.push("hook"); if (fail) throw new Error("note flush failed"); } });
  await store.open();
  store.upsert(C.makeItem({ id: "hook-1", summary: "Hook", start: { dateTime: new Date(now + 86400000).toISOString() }, x: { kind: "event", src: "manual" } }, now));
  await store.flush();
  assert.deepEqual(calls, ["hook", "write"]);
  fail = true; calls.length = 0;
  store.upsert({ ...store.get("hook-1"), summary: "Hook edited" });
  await store.flush();
  assert.deepEqual(calls, ["hook", "write"], "the calendar is still saved when the hook rejects");
  assert.equal(JSON.parse(io.files.get("/notes/" + C.ITEMS_FILE)).items[0].summary, "Hook edited");
  calls.length = 0; await store.flush();
  assert.deepEqual(calls, [], "a clean store neither runs the hook nor writes");
});
