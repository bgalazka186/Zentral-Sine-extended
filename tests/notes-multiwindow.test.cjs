"use strict";
// UI4.7 partial: serialized cross-window claims and restored mirrored notes.
// Simultaneous writes and last-writer loss notification need the remaining
// calendar-store concurrency work described in the roadmap.
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const PREF = "zen.workspace.zentral.notes.agenda_folder";
const tabs = h => h.document.querySelectorAll("tab[bgalazka-notes-agenda-item]").filter(t => !t.getAttribute("bgalazka-notes-agenda-item").startsWith("seed:"));
async function host(files, id) {
  const h = createFakeZen({ files, id, prefs: { [PREF]: true } });
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

// Executable acceptance tests deliberately marked TODO until the store has safe
// cross-window coordination; they must not be mistaken for passing coverage.
const test = require("node:test");
function sharedIO() {
  const files = new Map();
  return {
    join: (...p) => p.join("/"),
    readUTF8: async p => { if (!files.has(p)) { const e = new Error("not found"); e.code = "ENOENT"; throw e; } return files.get(p); },
    writeUTF8: async (p, text) => { files.set(p, text); },
    exists: async p => files.has(p),
  };
}
test("stale windows preserve independent calendar edits", { todo: "UI4.7: calendar snapshots overwrite changes from other windows" }, async () => {
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
test("simultaneous windows claim a reminder stage only once", { todo: "UI4.7: claim read/write is not atomic across windows" }, async () => {
  const io = sharedIO(), now = 1700000000000;
  const options = { io, getDir: () => "/notes", now: () => now, setTimer: () => 1, clearTimer() {} };
  const a = C.createReminderHistoryStore(options), b = C.createReminderHistoryStore(options); await a.open(); await b.open();
  const entry = { itemId: "item", occurrenceId: "occ", stage: "due", start: { dateTime: new Date(now).toISOString() }, at: now };
  const claims = await Promise.all([a.claimAlert(entry), b.claimAlert(entry)]);
  assert.equal(claims.filter(Boolean).length, 1);
});
