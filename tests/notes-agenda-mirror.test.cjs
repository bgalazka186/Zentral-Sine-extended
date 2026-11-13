"use strict";
/* Mirroring note-less items into Date Note Agenda lines, moving them with their day, and the startup backfill (roadmap B3.3.32-7).
 * Node + fake IO/clock only. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const calPath = path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js");
const cal = require(calPath);
const win = { __zentralNotesParts: { "notes-calendar": cal }, document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800 };
win.window = win;
const ctx = { window: win, document: dom.document, Event: dom.Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout };
vm.runInNewContext(source, ctx);
const c = win.__zentralNotesTestSeam.core;

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("ok -", name); } catch (e) { failed++; console.error("FAIL " + name + "\n", e); } }

let clock = new Date(2026, 10, 13, 9, 0).getTime();
function fakeIO() {
  const files = new Map();
  return {
    files, join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
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
const mk = (io) => c.createStore({ io, notify() {}, windowId: "t", now: () => clock, getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: () => 0, clearTimer() {}, warn(e) { throw e; } });
const plain = (v) => JSON.parse(JSON.stringify(v));
const at = (d, h, m = 0) => ({ dateTime: new Date(2026, 10, d, h, m).toISOString() });
const mkItem = (o) => cal.makeItem({ x: { kind: "reminder", src: "manual" }, ...o }, clock);
const lineFor = (body, text) => body.split("\n").find((l) => l.includes(text)) || "";

(async () => {
  await test("pure: agendaMirrorLine writes one faithful line and refuses what a list line cannot say", () => {
    const rem = cal.agendaMirrorLine(mkItem({ id: "a1", summary: "Dentist", start: at(20, 9, 5) }), { lineId: "abcd1" });
    assert.equal(rem.line, "- [ ] 2026-11-20 09:05 Dentist %%zn-item-id:abcd1%%");
    const ev = cal.agendaMirrorLine(mkItem({ id: "a2", summary: "Call", start: at(20, 9), end: at(20, 10, 30), x: { kind: "event", src: "manual" } }), { lineId: "abcd2", done: true });
    assert.equal(ev.line, "- [x] 2026-11-20 09:00-10:30 Call %%zn-item-id:abcd2%%");
    const night = cal.agendaMirrorLine(mkItem({ id: "a3", summary: "Shift", start: at(20, 22), end: at(21, 2), x: { kind: "event", src: "manual" } }), { lineId: "abcd3" });
    assert.ok(night && night.line.includes("22:00-02:00"));
    const day = cal.agendaMirrorLine(mkItem({ id: "a4", summary: "Pay rent", start: { date: "2026-11-20" } }), { lineId: "abcd4" });
    assert.equal(day.line, "- [ ] 2026-11-20 Pay rent %%zn-item-id:abcd4%%");
    const generated = cal.agendaMirrorLine(mkItem({ id: "a5", summary: "Auto", start: at(20, 8) }));
    assert.match(generated.line, /%%zn-item-id:zm[a-z0-9]{6,}%%$/);
    assert.equal(cal.agendaMirrorLine(mkItem({ id: "a5", summary: "Auto", start: at(20, 8) })).lineId, generated.lineId, "deterministic");
    assert.equal(cal.agendaMirrorLine(mkItem({ id: "b1", summary: "Trip", start: { date: "2026-11-20" }, end: { date: "2026-11-22" }, x: { kind: "event", src: "manual" } })), null, "all-day event");
    assert.equal(cal.agendaMirrorLine(mkItem({ id: "b2", summary: "Long", start: at(20, 9), end: at(21, 12), x: { kind: "event", src: "manual" } })), null, "24 h or more");
    assert.equal(cal.agendaMirrorLine(mkItem({ id: "b3", summary: "Daily", start: at(20, 9), recurrence: ["RRULE:FREQ=DAILY"] })), null, "recurring");
    assert.equal(cal.agendaMirrorLine(mkItem({ id: "b4", summary: "has %% mark", start: at(20, 9) })), null, "comment marks");
    assert.equal(cal.agendaMirrorLine(mkItem({ id: "b5", summary: "- dash", start: at(20, 9) })), null, "line parser would strip the dash");
    assert.equal(cal.agendaMirrorLine(null), null);
  });

  await test("pure: insertAgendaLine joins the matching section, creates scaffolding once, and touches nothing else", () => {
    const L1 = "- [ ] 2026-11-20 09:00 One %%zn-item-id:abcd1%%", L2 = "- [ ] 2026-11-20 10:00 Two %%zn-item-id:abcd2%%";
    const a = cal.insertAgendaLine("# 2026-11-20 Fri\n\nMy text\n", L1);
    assert.equal(a.body, "# 2026-11-20 Fri\n\nMy text\n\n## Agenda\n%%calendar%%\n" + L1 + "\n");
    const b = cal.insertAgendaLine(a.body, L2);
    assert.equal(b.body, "# 2026-11-20 Fri\n\nMy text\n\n## Agenda\n%%calendar%%\n" + L1 + "\n" + L2 + "\n", "same section, after the last list line");
    const c = cal.insertAgendaLine("# T\n\n## Agenda\nnotes\n\n## Later\ntext\n", L1);
    assert.equal(c.body, "# T\n\n## Agenda\nnotes\n%%calendar%%\n" + L1 + "\n\n## Later\ntext\n", "block ends at the next same-level heading");
    const d = cal.insertAgendaLine(b.body, L2.replace("abcd2", "abcd9"), "Work");
    assert.ok(d.body.includes("\n\n%%calendar: Work%%\n- [ ] 2026-11-20 10:00 Two %%zn-item-id:abcd9%%"), d.body);
    assert.equal(cal.extractNoteItems(d.body, "n", clock).map((i) => i.x.category).join(","), ",,Work");
    const fenced = "# T\n```\n## Agenda\n```\n";
    assert.equal(cal.insertAgendaLine(fenced, L1).body, fenced.replace(/\s+$/, "") + "\n\n## Agenda\n%%calendar%%\n" + L1 + "\n", "a fenced `## Agenda` is not a heading");
    const r = cal.removeAgendaLine(b.body, "abcd1");
    assert.equal(r.changed, true); assert.equal(r.line, L1);
    assert.equal(r.body, "# 2026-11-20 Fri\n\nMy text\n\n## Agenda\n%%calendar%%\n" + L2 + "\n");
    assert.equal(cal.removeAgendaLine(b.body, "nope").changed, false);
  });

  await test("pure: reminderIdentity keeps the original identity of a mirrored item (non-recurring only)", () => {
    const it = mkItem({ id: "lxyz-abcd1", summary: "S", start: at(20, 9), x: { kind: "reminder", src: "list", noteId: "N", historyId: "m1" } });
    assert.deepEqual(plain(cal.reminderIdentity(it)), { itemId: "m1", occurrenceId: "m1", noteId: "N", legacyNote: false });
    const rec = mkItem({ id: "lxyz-abcd2", summary: "S", start: at(20, 9), recurrence: ["RRULE:FREQ=DAILY"], x: { kind: "reminder", src: "list", noteId: "N", historyId: "m1" } });
    assert.equal(cal.reminderIdentity(rec).itemId, "lxyz-abcd2");
    assert.equal(cal.fromGoogle(cal.toGoogle(it)).x.historyId, "m1");
  });

  await test("store: mirroring writes the line, re-keys the item and keeps extras, category and history", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    st.items.upsert(mkItem({ id: "m1", summary: "Dentist", description: "Bring card", start: at(20, 9), x: { kind: "reminder", src: "manual", category: "Health", calNote: "ask about x-ray", tz: "Europe/Warsaw", notify: { pre: { leadMinutes: 5 }, due: { enabled: false } } } }));
    st.applyReminderLifecycle(st.items.get("m1"), "done");
    const noteId = st.mirrorItemToAgendaNote("m1");
    assert.ok(noteId);
    const body = st.get(noteId).body;
    assert.match(body, /^# 2026-11-20/);
    assert.match(body, /## Agenda\n\n?%%calendar: Health%%\n- \[x\] 2026-11-20 09:00 Dentist %%zn-item-id:zm[a-z0-9]+%%/);
    assert.equal(st.items.get("m1"), null, "the manual record is replaced, not duplicated");
    const all = st.items.list();
    assert.equal(all.length, 1);
    const it = all[0];
    assert.equal(it.x.src, "list"); assert.equal(it.x.noteId, noteId); assert.equal(it.x.heading, "Agenda"); assert.equal(it.x.historyId, "m1");
    assert.equal(it.x.category, "Health"); assert.equal(it.x.calNote, "ask about x-ray"); assert.equal(it.x.tz, "Europe/Warsaw");
    assert.equal(it.description, "Bring card"); assert.deepEqual(plain(it.x.notify), { pre: { leadMinutes: 5 }, due: { enabled: false } });
    const id = cal.reminderIdentity(it);
    assert.equal(st.items.history.stateFor(id.itemId, id.occurrenceId), "done", "earlier Done is still attached");
    assert.equal(st.mirrorItemToAgendaNote(it.id), "", "idempotent: already a list item");
    // The Agenda checkbox and the lifecycle keep working on the mirrored line.
    assert.ok(st.applyReminderLifecycle(it, "reopened"));
    assert.ok(st.get(noteId).body.includes("- [ ] 2026-11-20 09:00 Dentist"));
    assert.equal(st.items.history.list({ itemId: "m1" }).map((r) => r.action).join(","), "reopened,done");
  });

  await test("store: items a list line cannot express stay linked-only; recurring and ordinary-note items are untouched", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    st.items.upsert(mkItem({ id: "e1", summary: "Trip", start: { date: "2026-11-20" }, end: { date: "2026-11-22" }, x: { kind: "event", src: "manual" } }));
    st.items.upsert(mkItem({ id: "r1", summary: "Daily", start: at(20, 9), recurrence: ["RRULE:FREQ=DAILY"] }));
    const own = st.create("# Mine\n\ntext\n");
    st.items.upsert(mkItem({ id: "o1", summary: "Linked by hand", start: at(20, 9), x: { kind: "reminder", src: "manual", noteId: own.id, heading: "Mine" } }));
    assert.equal(st.mirrorItemToAgendaNote("e1"), "");
    assert.equal(st.items.get("e1").x.src, "manual"); assert.ok(st.items.get("e1").x.noteId, "linked to its date note");
    assert.equal(st.mirrorItemToAgendaNote("r1"), "");
    assert.equal(st.mirrorItemToAgendaNote("o1"), "");
    assert.equal(st.get(own.id).body, "# Mine\n\ntext\n");
    assert.equal(st.items.get("o1").x.src, "manual");
  });

  await test("store: moving the day moves the line (same hidden id) and keeps identity, extras and history", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    st.items.upsert(mkItem({ id: "m1", summary: "Dentist", start: at(20, 9), x: { kind: "reminder", src: "manual", calNote: "kept" } }));
    st.items.upsert(mkItem({ id: "m2", summary: "Pharmacy", start: at(20, 15), x: { kind: "reminder", src: "manual" } }));
    const day20 = st.mirrorItemToAgendaNote("m1"); st.mirrorItemToAgendaNote("m2");
    const item = st.items.list().find((i) => i.summary === "Dentist");
    const lineId = /zn-item-id:([a-z0-9_-]+)/.exec(lineFor(st.get(day20).body, "Dentist"))[1];
    const moved = st.items.upsert({ ...item, start: at(23, 11), historyAction: "rescheduled" });
    assert.ok(moved);
    assert.equal(st.syncItemScheduleToNote(moved), true);
    const notes = st.list().filter((n) => !n.trashed);
    const day23 = notes.find((n) => n.body.startsWith("# 2026-11-23"));
    assert.ok(day23, "destination Date Note created");
    assert.match(lineFor(day23.body, "Dentist"), new RegExp("^- \\[ \\] 2026-11-23 11:00 Dentist %%zn-item-id:" + lineId + "%%$"));
    assert.equal(lineFor(st.get(day20).body, "Dentist"), "", "left the old note");
    assert.ok(lineFor(st.get(day20).body, "Pharmacy"), "its neighbour stayed");
    const all = st.items.list().filter((i) => i.summary === "Dentist");
    assert.equal(all.length, 1, "exactly one record");
    assert.equal(all[0].x.noteId, day23.id); assert.equal(all[0].x.calNote, "kept"); assert.equal(all[0].x.historyId, "m1");
    assert.equal(all[0].id, cal.noteLineItemId(day23.id, lineId));
    assert.equal(st.items.history.list({ itemId: "m1" }).filter((r) => r.action === "rescheduled").length, 1, "one reschedule record, under the original identity");
    // Same-day time change rewrites in place and does not move anything.
    const later = st.items.upsert({ ...all[0], start: at(23, 12) });
    assert.equal(st.syncItemScheduleToNote(later), true);
    assert.match(lineFor(st.get(day23.id).body, "Dentist"), /2026-11-23 12:00 Dentist/);
    assert.equal(st.list().filter((n) => !n.trashed).length, 2);
  });

  await test("store: backfill mirrors old note-less and Agenda-linked items once, and a reload keeps one record each", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    st.items.upsert(mkItem({ id: "p1", summary: "Old one", start: at(14, 9) }));
    st.items.upsert(mkItem({ id: "p2", summary: "Old two", start: at(14, 10) }));
    st.items.upsert(mkItem({ id: "p3", summary: "Linked only", start: at(15, 10) }));
    st.linkItemToAgendaNote("p3");
    st.items.upsert(mkItem({ id: "p4", summary: "Series", start: at(15, 10), recurrence: ["RRULE:WEEKLY"] }));
    const first = st.backfillAgendaLinks();
    assert.equal(first.mirrored, 3);
    const snapshot = JSON.stringify(st.list().map((n) => [n.id, n.body]).sort());
    assert.equal(st.backfillAgendaLinks().mirrored, 0, "second pass: nothing to do");
    assert.equal(JSON.stringify(st.list().map((n) => [n.id, n.body]).sort()), snapshot, "second pass writes no text");
    assert.equal(st.items.get("p4").x.src, "manual");
    await st.flush();
    const again = mk(io); await again.open();
    const titles = again.items.list().map((i) => i.summary).sort();
    assert.deepEqual(titles, ["Linked only", "Old one", "Old two", "Series"]);
    assert.equal(again.items.list().filter((i) => i.x.src === "list").length, 3);
    for (const i of again.items.list().filter((i) => i.x.src === "list")) assert.ok(i.x.historyId, "identity survives the reload");
  });

  await test("store: a line already written by another window is reused, never written twice", async () => {
    const io = fakeIO(), a = mk(io); await a.open();
    a.items.upsert(mkItem({ id: "w1", summary: "Shared", start: at(20, 9) }));
    await a.flush();
    const b = mk(io); await b.open();
    assert.ok(b.items.get("w1"));
    const noteId = a.mirrorItemToAgendaNote("w1"); await a.flush();
    const stale = b.items.get("w1");
    assert.ok(stale, "window B still has the manual record");
    // Window B reloads the note text from disk, as a remote change would, then mirrors the same item.
    await b.reloadFromDisk?.(noteId);
    const text = a.get(noteId).body;
    assert.equal((text.match(/%%zn-item-id:/g) || []).length, 1);
    const again = b.mirrorItemToAgendaNote("w1");
    if (again) assert.equal((b.get(again).body.match(/%%zn-item-id:/g) || []).length <= 1, true, b.get(again).body);
  });

  await test("store: the date folder is labelled Agenda and an old generated Daily label is migrated, a custom one kept", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    st.items.upsert(mkItem({ id: "f1", summary: "X", start: at(20, 9) }));
    st.mirrorItemToAgendaNote("f1");
    assert.equal(st.meta.folders.length, 1); assert.equal(st.meta.folders[0].id, "daily"); assert.equal(st.meta.folders[0].label, "Agenda");
    st.renameFolder("daily", "Daily"); await st.flush();
    const again = mk(io); await again.open();
    assert.equal(again.meta.folders[0].label, "Agenda", "old label migrated");
    again.renameFolder("daily", "My days"); await again.flush();
    const third = mk(io); await third.open();
    assert.equal(third.meta.folders[0].label, "My days");
  });

  console.log(passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
