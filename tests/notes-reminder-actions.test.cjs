"use strict";
/* Reminder alert actions, Agenda checkbox <-> lifecycle sync and cross-window alert claim (roadmap B3.3.32-4).
 * Node + fake IO/clock only: proves the wiring, NOT how Zen's notification box or IOUtils behave. */
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
const BODY = "# Plan\n\n## Agenda\n%%calendar%%\n- [ ] 2026-11-13 18:00 Call mom\n- [ ] 2026-11-13 19:00 Call mom\n- [/] 2026-11-14 Half done\n- 2026-11-15 No box\n";
async function fresh(body = BODY) {
  const io = fakeIO(), st = mk(io); await st.open();
  const n = st.create(body); st.stabilizeItems(n.id);
  const byText = (t) => st.items.list({ noteId: n.id }).filter((i) => i.summary.includes(t));
  return { io, st, n, byText, body: () => st.get(n.id).body, state: (item) => { const id = cal.reminderIdentity(item); return st.items.history.stateFor(id.itemId, id.occurrenceId); } };
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const boxes = (body) => body.split("\n").filter((l) => /^- /.test(l)).map((l) => l.slice(0, 5));

(async () => {
  await test("pure: checkbox states and writer keep markers, extended states and fences intact", () => {
    const b = "## A\n%%calendar%%\n- [ ] 2026-11-13 18:00 Call %%zn-item-id:abcd1%%\n- [x] 2026-11-14 Pay %%zn-item-id:abcd2%%\n- [/] 2026-11-15 Wip %%zn-item-id:abcd3%%\n- 2026-11-16 Bare %%zn-item-id:abcd4%%\n```\n- [ ] 2026-11-17 Code %%zn-item-id:abcd5%%\n```\n";
    assert.deepEqual([...cal.listCheckboxStates(b)], [["abcd1", false], ["abcd2", true]]);
    const done = cal.setListCheckbox(b, "abcd1", true);
    assert.equal(done.changed, true);
    assert.ok(done.body.includes("- [x] 2026-11-13 18:00 Call %%zn-item-id:abcd1%%"));
    assert.equal(done.body.replace("[x] 2026-11-13", "[ ] 2026-11-13"), b, "only the box character changed");
    assert.equal(cal.setListCheckbox(done.body, "abcd1", true).changed, false, "idempotent");
    assert.equal(cal.setListCheckbox(done.body, "abcd1", false).body, b, "reopen restores the box");
    for (const id of ["abcd3", "abcd4", "abcd5", "nope"]) { const r = cal.setListCheckbox(b, id, true); assert.equal(r.changed, false, id); assert.equal(r.body, b, id); }
    assert.equal(cal.setListCheckbox(b, "abcd3", true).found, false, "extended states are not a done/pending box");
  });

  await test("alert actions: calendar reminder = Open, Done, Snooze 10, Snooze 60, Tomorrow, Dismiss and each reaches the store", async () => {
    const calls = [];
    const store = { applyReminderLifecycle: (i, a) => calls.push(["life", i.id, a]), snoozeCalendarReminder: (id, m) => calls.push(["snooze", id, m]), snoozeReminder() {}, setReminder() {} };
    const item = { id: "it1", summary: "Call", start: { dateTime: "2026-11-13T17:00:00.000Z" }, x: { noteId: "nn", heading: "Agenda" } };
    const actions = c.createReminderAlertActions({ store, note: { __calendarReminder: true, __calendarItem: item }, openNote: (...a) => calls.push(["open", ...a]) });
    assert.deepEqual(plain(actions.map((a) => a.id)), ["open", "done", "snooze-10", "snooze-60", "snooze-tomorrow", "dismiss"]);
    actions.forEach((a) => a.callback());
    assert.deepEqual(plain(calls), [["open", "nn", { heading: "Agenda", itemId: "it1" }], ["life", "it1", "done"], ["snooze", "it1", 10], ["snooze", "it1", 60], ["snooze", "it1", cal.reminderSnoozeTomorrowMinutes(Date.now())], ["life", "it1", "dismissed"]]);
  });

  await test("alert actions: recurring and all-day reminders offer no snooze; note-less item opens the panel; legacy keeps its three buttons", () => {
    const store = { applyReminderLifecycle() {}, snoozeCalendarReminder() {}, snoozeReminder: (id, m) => legacy.push(["s", id, m]), setReminder: (id, t) => legacy.push(["r", id, t]) };
    const legacy = [], shown = [];
    const mkActions = (item) => c.createReminderAlertActions({ store, note: { __calendarReminder: true, __calendarItem: item }, openNote() {}, showNotes: (x) => shown.push(x) });
    assert.deepEqual(plain(mkActions({ id: "a", start: { dateTime: "2026-11-13T17:00:00.000Z" }, recurrence: ["RRULE:FREQ=DAILY"], x: { noteId: "n" } }).map((a) => a.id)), ["open", "done", "dismiss"]);
    assert.deepEqual(plain(mkActions({ id: "b", start: { date: "2026-11-13" }, x: { noteId: "n" } }).map((a) => a.id)), ["open", "done", "dismiss"]);
    mkActions({ id: "c", start: { dateTime: "2026-11-13T17:00:00.000Z" }, x: {} })[0].callback();
    assert.deepEqual(plain(shown), [""]);
    const old = c.createReminderAlertActions({ store, note: { id: "note1" }, openNote: (id) => legacy.push(["o", id]) });
    assert.deepEqual(plain(old.map((a) => a.id)), ["open", "snooze-10", "snooze-60", "dismiss"]);
    old.forEach((a) => a.callback());
    assert.deepEqual(plain(legacy), [["o", "note1"], ["s", "note1", 10], ["s", "note1", 60], ["r", "note1", 0]]);
  });

  await test("alert actions: a throwing store never throws into the notification box", () => {
    const warned = [], boom = () => { throw new Error("disk"); };
    const actions = c.createReminderAlertActions({ store: { applyReminderLifecycle: boom, snoozeCalendarReminder: boom }, note: { __calendarReminder: true, __calendarItem: { id: "x", start: { dateTime: "2026-11-13T17:00:00.000Z" }, x: { noteId: "n" } } }, openNote: boom, warn: (e) => warned.push(e.message) });
    for (const a of actions) assert.equal(a.callback(), false);
    assert.equal(warned.length, actions.length);
  });

  await test("Done from the banner records history once and ticks only its own Agenda box (identical lines stay separate)", async () => {
    const t = await fresh(), [first, second] = t.byText("Call mom").sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime));
    assert.ok(t.st.applyReminderLifecycle(first, "done"));
    assert.deepEqual(boxes(t.body()), ["- [x]", "- [ ]", "- [/]", "- 202"]);
    assert.equal(t.state(first), "done"); assert.equal(t.state(second), "pending");
    assert.equal(t.st.applyReminderLifecycle(first, "done"), false, "second Done is a no-op");
    assert.equal(t.st.items.history.list({ itemId: cal.reminderIdentity(first).itemId }).filter((r) => r.action === "done").length, 1);
    assert.ok(/%%zn-item-id:[a-z0-9_-]+%%/.test(t.body().split("\n").find((l) => l.includes("18:00"))), "hidden id kept");
  });

  await test("Reopen restores [ ]; Dismiss leaves the box alone", async () => {
    const t = await fresh(), item = t.byText("Call mom")[0];
    t.st.applyReminderLifecycle(item, "done");
    assert.ok(t.st.applyReminderLifecycle(item, "reopened"));
    assert.equal(t.state(item), "pending");
    assert.ok(boxes(t.body()).slice(0, 2).every((b) => b === "- [ ]"));
    const before = t.body();
    assert.ok(t.st.applyReminderLifecycle(item, "dismissed"));
    assert.equal(t.body(), before, "dismiss is not completion");
    assert.equal(t.state(item), "dismissed");
  });

  await test("ticking / unticking the box in the note records one lifecycle change; no duplicate after the calendar wrote it", async () => {
    const t = await fresh(), item = t.byText("Call mom")[0];
    const lineId = t.body().split("\n").find((l) => l.includes(" 18:00") || l.includes("Call mom")).match(/zn-item-id:([a-z0-9_-]+)/)[1];
    const target = cal.noteLineItemId(t.n.id, lineId), it = t.st.items.get(target);
    t.st.update(t.n.id, cal.setListCheckbox(t.body(), lineId, true).body);
    assert.equal(t.state(it), "done");
    t.st.update(t.n.id, t.body() + "\nunrelated edit");
    t.st.update(t.n.id, cal.setListCheckbox(t.body(), lineId, true).body);
    assert.equal(t.st.items.history.list({ itemId: cal.reminderIdentity(it).itemId }).filter((r) => r.action === "done").length, 1);
    t.st.update(t.n.id, cal.setListCheckbox(t.body(), lineId, false).body);
    assert.equal(t.state(it), "pending");
    assert.deepEqual(t.st.items.history.list({ itemId: cal.reminderIdentity(it).itemId }).map((r) => r.action).reverse(), ["done", "reopened"]);
    assert.ok(item);
  });

  await test("opening or creating a note with ticked boxes never writes history; extended states and recurring lines are untouched", async () => {
    const t = await fresh("## A\n%%calendar%%\n- [x] 2026-11-10 Old %%zn-item-id:old11%%\n- [ ] 2026-11-13 18:00 Daily %%zn-item-id:dly11%%\n");
    assert.equal(t.st.items.history.list().length, 0);
    const rec = t.st.items.list({ noteId: t.n.id }).find((i) => i.summary.includes("Daily"));
    t.st.items.upsert({ ...rec, recurrence: ["RRULE:FREQ=DAILY"] });
    const seriesItem = t.st.items.get(rec.id);
    assert.equal(t.st.syncItemCheckbox(seriesItem, true), false, "a recurring line keeps its box");
    assert.equal(t.st.syncItemCheckbox({ id: "m", x: { src: "manual", noteId: t.n.id } }, true), false);
  });

  await test("banner Snooze moves a timed reminder, appends `snoozed`, stays pending; recurring and all-day are refused", async () => {
    const t = await fresh(), item = t.byText("Call mom")[0], at = Date.parse(item.start.dateTime);
    assert.ok(t.st.snoozeCalendarReminder(item.id, 10));
    const moved = t.st.items.get(item.id);
    assert.equal(Date.parse(moved.start.dateTime), clock + 10 * 60000);
    assert.ok(Date.parse(moved.start.dateTime) !== at);
    assert.equal(t.state(moved), "pending");
    assert.ok(t.st.items.history.list({ itemId: cal.reminderIdentity(moved).itemId }).some((r) => r.action === "snoozed"));
    const allDay = t.byText("No box")[0];
    assert.equal(t.st.snoozeCalendarReminder(allDay.id, 10), false);
    assert.equal(t.st.snoozeCalendarReminder("missing", 10), false);
    assert.equal(t.st.snoozeCalendarReminder(item.id, 0), false);
  });

  await test("scheduler end-to-end: fires once, Done stops it, Snooze fires again at the new time", async () => {
    const t = await fresh("## A\n%%calendar%%\n- 2026-11-13 09:30 Stand-up\n");
    const item = t.st.items.list({ noteId: t.n.id })[0];
    let timers = [], fired = [];
    const sched = c.createReminderScheduler({ store: t.st, now: () => clock, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer() {}, onDue: (l) => fired.push(...l.map((x) => x.summary + ":" + (x.__stage || "legacy"))) });
    const run = async () => { sched.reschedule(); await new Promise((r) => setTimeout(r, 15)); };
    await run(); assert.deepEqual(fired, [], "not due yet");
    clock = new Date(2026, 10, 13, 9, 31).getTime();
    await run(); assert.deepEqual(fired, ["Stand-up:pre", "Stand-up:due"]);
    await run(); assert.deepEqual(fired, ["Stand-up:pre", "Stand-up:due"], "no repeat for a claimed stage");
    assert.ok(t.st.snoozeCalendarReminder(item.id, 10));
    clock += 9 * 60000; await run(); assert.deepEqual(fired, ["Stand-up:pre", "Stand-up:due", "Stand-up:pre"], "new schedule gets a new adaptive pre-alert");
    clock += 2 * 60000; await run(); assert.deepEqual(fired, ["Stand-up:pre", "Stand-up:due", "Stand-up:pre", "Stand-up:due"], "due stage fires at the snoozed time");
    clock += 2 * 60000; await run(); assert.equal(fired.at(-1), "Stand-up:followup", "follow-up is a distinct delayed stage");
    t.st.applyReminderLifecycle(t.st.items.get(item.id), "done");
    clock += 3600000; await run(); assert.equal(fired.length, 5, "Done never alerts again");
    sched.destroy();
  });

  await test("two windows: the shared history lets exactly one window alert for a schedule", async () => {
    const io = fakeIO(), mkHist = () => cal.createReminderHistoryStore({ io, getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {} });
    const a = mkHist(), b = mkHist(); await a.open(); await b.open();
    const entry = { itemId: "i1", occurrenceId: "i1", noteId: "n1", summary: "Call", start: { dateTime: "2026-11-13T09:30:00.000Z" }, at: clock };
    assert.ok(await a.claimAlert(entry), "first window claims");
    assert.equal(await b.claimAlert(entry), null, "second window sees the claim and stays silent");
    const later = { ...entry, start: { dateTime: "2026-11-13T10:30:00.000Z" } };
    assert.ok(await b.claimAlert(later), "a new schedule (snooze) may alert again");
    const c2 = mkHist(); await c2.open();
    assert.equal(c2.list().filter((r) => r.action === "alerted").length, 2, "both claims persisted, none lost");
    await a.refresh();
    assert.equal(a.list().filter((r) => r.action === "alerted").length, 2, "window A merged B's record on its next refresh");
  });

  await test("refresh keeps lifecycle: a Done written by another window is honoured", async () => {
    const io = fakeIO(), mkHist = () => cal.createReminderHistoryStore({ io, getDir: () => "/n", now: () => clock, setTimer: () => 0, clearTimer() {} });
    const a = mkHist(), b = mkHist(); await a.open(); await b.open();
    b.append({ itemId: "i2", occurrenceId: "i2", noteId: "n", summary: "x", start: { dateTime: "2026-11-13T09:30:00.000Z" }, action: "done", at: clock }); await b.flush();
    assert.equal(a.stateFor("i2"), "pending");
    assert.equal(await a.refresh(), 1);
    assert.equal(a.stateFor("i2"), "done");
  });

  await test("pure: Agenda heading is added once, reused in any level/case, and nothing else changes", () => {
    assert.deepEqual(plain(cal.ensureAgendaHeading("")), { body: "## Agenda\n", heading: "Agenda", changed: true });
    const r = cal.ensureAgendaHeading("# 2026-11-13 Fri\n\nText");
    assert.equal(r.body, "# 2026-11-13 Fri\n\nText\n\n## Agenda\n");
    for (const b of ["# x\n### agenda\n", "# x\n## AGENDA ##\n"]) assert.deepEqual(plain(cal.ensureAgendaHeading(b)), { body: b, heading: "Agenda", changed: false });
    assert.equal(cal.ensureAgendaHeading(r.body).changed, false);
  });

  await test("note-less manual items are linked to their start day's date note (created once, reused, heading once)", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const at = (h) => ({ dateTime: new Date(2026, 10, 20, h, 0).toISOString() });
    const a = st.items.upsert(cal.makeItem({ id: "m1", summary: "Dentist", start: at(9), x: { kind: "reminder", src: "manual" } }, clock));
    const b = st.items.upsert(cal.makeItem({ id: "m2", summary: "Pharmacy", start: at(15), x: { kind: "reminder", src: "manual" } }, clock));
    const idA = st.linkItemToAgendaNote(a.id), idB = st.linkItemToAgendaNote(b.id);
    assert.ok(idA && idA === idB, "same day, same date note");
    assert.equal(st.list().filter((n) => !n.trashed).length, 1);
    const note = st.get(idA);
    assert.ok(note.body.startsWith("# 2026-11-20"), note.body);
    assert.equal((note.body.match(/^## Agenda$/gm) || []).length, 1);
    assert.equal(note.folder, "daily");
    for (const id of ["m1", "m2"]) { const it = st.items.get(id); assert.equal(it.x.noteId, idA); assert.equal(it.x.heading, "Agenda"); assert.equal(it.x.src, "manual"); }
    assert.equal(st.linkItemToAgendaNote("m1"), "", "already linked: untouched");
  });

  await test("linking reuses an existing date note, skips recurring/note-derived items, and keeps reminder identity and lifecycle", async () => {
    const io = fakeIO(), st = mk(io); await st.open();
    const existing = st.create("# 2026-11-21 Sat\n\nMy own text\n");
    const day = { dateTime: new Date(2026, 10, 21, 8, 0).toISOString() };
    const m = st.items.upsert(cal.makeItem({ id: "m3", summary: "Taxes", start: day, x: { kind: "reminder", src: "manual" } }, clock));
    const rec = st.items.upsert(cal.makeItem({ id: "m4", summary: "Daily", start: day, recurrence: ["RRULE:FREQ=DAILY"], x: { kind: "reminder", src: "manual" } }, clock));
    assert.equal(st.linkItemToAgendaNote(m.id), existing.id);
    assert.ok(st.get(existing.id).body.startsWith("# 2026-11-21 Sat\n\nMy own text"), "user text kept");
    assert.equal(st.linkItemToAgendaNote(rec.id), "", "recurring items stay unlinked");
    assert.equal(st.linkItemToAgendaNote("missing"), "");
    assert.equal(st.list().filter((n) => !n.trashed).length, 1, "no extra note created");
    const linked = st.items.get("m3");
    assert.ok(st.applyReminderLifecycle(linked, "done"));
    assert.equal(st.items.history.stateFor("m3"), "done", "identity is still the manual item id");
    assert.equal(st.get(existing.id).body.includes("[x]"), false, "no checkbox line is written for a manual item");
  });

  await test("pure: rewriteLineSchedule changes only the leading date/time", () => {
    const at = (a, b) => ({ start: { dateTime: new Date(...a).toISOString() }, ...(b ? { end: { dateTime: new Date(...b).toISOString() } } : {}), x: {} });
    const L = "- [x] 2026-11-13 18:00-19:30 Call mom %%zn-item-id:abcd1%%";
    assert.equal(cal.rewriteLineSchedule(L, at([2026, 10, 15, 9, 5], [2026, 10, 15, 10, 0])), "- [x] 2026-11-15 09:05-10:00 Call mom %%zn-item-id:abcd1%%");
    assert.equal(cal.rewriteLineSchedule("- 14.11.2026 Pay", { start: { date: "2026-11-20" }, x: {} }), "- 2026-11-20 Pay", "all-day, other date format");
    assert.equal(cal.rewriteLineSchedule("- 2026-11-13 Pay", at([2026, 10, 15, 9, 5])), "- 2026-11-15 09:05 Pay", "timed item gains its time");
    assert.equal(cal.rewriteLineSchedule("- 2026-11-13 09:00 Pay", { start: { date: "2026-11-15" }, x: {} }), "- 2026-11-15 Pay", "all-day item drops the time");
    assert.equal(cal.rewriteLineSchedule("- 18:00 Call", at([2026, 10, 15, 9, 5])), null, "heading-provided date: untouched");
    assert.equal(cal.rewriteLineSchedule("plain text", at([2026, 10, 15, 9, 5])), null);
  });

  await test("rescheduling a note-derived item rewrites its own line (identical lines stay separate), idempotently", async () => {
    const t = await fresh("## A\n%%calendar%%\n- [ ] 2026-11-13 18:00 Call\n- [ ] 2026-11-13 18:00 Call\n- 2026-11-14 Bare\n");
    const [a, b] = t.byText("Call");
    const moved = { ...a, start: { dateTime: new Date(2026, 10, 16, 7, 30).toISOString() }, x: { ...a.x, moved: true } };
    assert.ok(t.st.items.upsert(moved));
    assert.equal(t.st.syncItemScheduleToNote(t.st.items.get(a.id)), true);
    const lines = t.body().split("\n").filter((l) => l.includes("Call"));
    assert.equal(lines.filter((l) => l.includes("2026-11-16 07:30")).length, 1);
    assert.equal(lines.filter((l) => l.includes("2026-11-13 18:00")).length, 1, "the identical twin is untouched");
    assert.ok(lines.every((l) => /%%zn-item-id:[a-z0-9_-]+%%/.test(l)), "hidden ids kept");
    assert.equal(t.st.syncItemScheduleToNote(t.st.items.get(a.id)), false, "second call changes nothing");
    assert.equal(Date.parse(t.st.items.get(a.id).start.dateTime), new Date(2026, 10, 16, 7, 30).getTime(), "the item keeps the moved time after the text sync");
    assert.equal(t.st.syncItemScheduleToNote({ id: "m", x: { src: "manual", noteId: t.n.id } }), false);
    assert.ok(b);
  });

  console.log(passed + " passed" + (failed ? ", " + failed + " FAILED" : ""));
  if (failed) process.exit(1);
})();
