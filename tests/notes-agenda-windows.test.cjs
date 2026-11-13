"use strict";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const now = new Date(2026, 10, 13, 9, 0).getTime();
const day = (offset = 0, hour = 12) => C.addDays(C.dayStart(now), offset) + hour * 60 * 60 * 1000;
const make = (id, summary, start, end, x = {}) => C.makeItem({ id, summary, start: start.date ? start : { dateTime: new Date(start).toISOString() }, ...(end ? { end: end.date ? end : { dateTime: new Date(end).toISOString() } } : {}), x: { kind: end ? "event" : "reminder", src: "manual", ...x } }, now);
function test(name, fn) { try { fn(); console.log("ok -", name); } catch (error) { console.error("FAIL " + name + "\n", error); process.exitCode = 1; } }

test("Agenda window cleaner rejects junk, preserves sparse inheritance and caps offsets", () => {
  assert.deepEqual(C.cleanAgendaWindow(null), {});
  assert.deepEqual(C.cleanAgendaWindow({ enabled: false, leadDays: -4, tailDays: 99, ignored: 1 }), { enabled: false, leadDays: 0, tailDays: 31 });
  assert.deepEqual(C.cleanAgendaWindow({ enabled: "false", leadDays: "2.4", tailDays: null }), { leadDays: 2 });
  assert.deepEqual(C.cleanNoteAgendaOverrides({ a: { enabled: false }, "": { leadDays: 3 }, b: [], c: { tailDays: 32 } }), { a: { enabled: false }, c: { tailDays: 31 } });
});

test("Agenda window policy resolves item > note > category > global per field", () => {
  const item = { x: { agendaWindow: { leadDays: 1 } } };
  assert.deepEqual(C.resolveAgendaWindow(item, { enabled: false, leadDays: 2, tailDays: 4 }, { enabled: true, tailDays: 3 }, { enabled: false, leadDays: 5, tailDays: 6 }), {
    enabled: true, leadDays: 1, tailDays: 3,
  });
  assert.deepEqual(C.resolveAgendaWindow({ x: { agendaWindow: { enabled: false } } }, null, null, { leadDays: 2 }), {
    enabled: false, leadDays: 2, tailDays: 0,
  });
  assert.deepEqual(C.resolveAgendaWindow({ x: {} }), { enabled: true, leadDays: 0, tailDays: 0 });
});

test("Agenda policy survives item cleaning, composer edits, category cleaning, and Google sync", () => {
  const item = make("policy-item", "Policy item", day(1, 10), null, { agendaWindow: { enabled: false, leadDays: "3", tailDays: 80 } });
  assert.deepEqual(item.x.agendaWindow, { enabled: false, leadDays: 3, tailDays: 31 });
  const composed = C.composeCalendarItem({ item, kind: "reminder", summary: "Edited", startDate: "2026-11-14", startTime: "10:00" }, now);
  assert.deepEqual(composed.x.agendaWindow, item.x.agendaWindow, "composer edits preserve an existing sparse override");
  const replacement = C.composeCalendarItem({ item, kind: "reminder", summary: "Edited", startDate: "2026-11-14", startTime: "10:00", agendaWindow: { enabled: true, leadDays: 2 } }, now);
  assert.deepEqual(replacement.x.agendaWindow, { enabled: true, leadDays: 2 }, "composer can explicitly replace the override");
  const category = C.cleanCategory({ name: "Work", agenda: { enabled: false, tailDays: 2 }, notify: {} });
  assert.deepEqual(category.agenda, { enabled: false, tailDays: 2 });
  const restored = C.fromGoogle(C.toGoogle(item));
  assert.deepEqual(restored.x.agendaWindow, item.x.agendaWindow, "Google extended properties retain Agenda policy");
});

test("global, category, note, and per-item settings resolve into the Agenda projection", () => {
  const item = make("inheritance", "Inherited", day(2, 10), null, { noteId: "n1", category: "Work", agendaWindow: { leadDays: 2 } });
  const hidden = make("category-hidden", "Category hidden", day(0, 10), null, { category: "Work" });
  const project = C.agendaZenProjection([item, hidden], now, 3, () => false, (entry) => {
    const category = entry.x.category === "Work" ? { enabled: false, leadDays: 2, tailDays: 2 } : {};
    const note = entry.x.noteId === "n1" ? { enabled: true, tailDays: 1 } : {};
    return C.resolveAgendaWindow(entry, category, note, { enabled: true, leadDays: 3, tailDays: 3 });
  });
  assert.ok(project[0].items.some((entry) => entry.itemId === "inheritance"), "item lead override wins and note tail applies");
  assert.ok(project[1].items.some((entry) => entry.itemId === "inheritance"));
  assert.equal(project[0].items.some((entry) => entry.itemId === "category-hidden"), false, "category opt-out is inherited without an item override");
});

test("Notes UI wires global/category/note/item Agenda visibility and independent persistence", () => {
  const fs = require("node:fs");
  const ui = fs.readFileSync(require("node:path").join(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  for (const pattern of [
    /calendarAgendaDefaults/,
    /calendarNoteAgendaOverrides/,
    /buildAgendaWindowEditor\(old\?\.agenda/,
    /agendaWindow: agendaWindowEditor\.read\(\)/,
    /getWindow: \(item\) =>[\s\S]*?resolveAgendaWindow\(item, category\?\.agenda, notePolicy, store\.meta\.calendarAgendaDefaults\)/,
    /agendaController\?\.schedule\?\.\(\)/,
  ]) assert.match(ui, pattern);
});

test("timed events and reminders use whole local-day windows with exclusive ends", () => {
  const event = make("event", "Planning", day(1, 10), day(1, 11));
  const reminder = make("reminder", "Call", day(1, 14), null);
  const eventRange = C.agendaVisibilityRange(event, { leadDays: 2, tailDays: 1 });
  assert.equal(C.localDateKey(eventRange.from), C.localDateKey(day(-1)));
  assert.equal(C.localDateKey(eventRange.to - 1), C.localDateKey(day(2)));
  const reminderRange = C.agendaVisibilityRange(reminder, { leadDays: 1, tailDays: 2 });
  assert.equal(C.localDateKey(reminderRange.from), C.localDateKey(day(0)));
  assert.equal(C.localDateKey(reminderRange.to - 1), C.localDateKey(day(3)));
  assert.deepEqual(C.agendaVisibilityRange(reminder, { enabled: false }), null);
});

test("all-day event end is exclusive and offsets remain civil-day based", () => {
  const start = C.parseYmd("2026-11-13");
  const end = C.parseYmd("2026-11-15");
  const event = make("all-day", "Conference", { date: "2026-11-13" }, { date: "2026-11-15" }, { kind: "event" });
  const range = C.agendaVisibilityRange(event, { leadDays: 1, tailDays: 1 });
  assert.equal(C.localDateKey(range.from), "2026-11-12");
  assert.equal(C.localDateKey(range.to - 1), "2026-11-15");
  assert.equal(C.localDateKey(end.getTime()), "2026-11-15");
  assert.ok(start.getTime() < end.getTime());
});

test("next Agenda visibility boundary advances the projection only when its date window can change", () => {
  const today = C.dayStart(now);
  const dueToday = make("due-today", "Today", day(0, 10), null);
  assert.equal(C.nextAgendaVisibilityBoundary([dueToday], now, 4), C.addDays(today, 1));
  const future = make("future", "Future", day(10, 10), null);
  assert.equal(C.nextAgendaVisibilityBoundary([future], now, 4, () => ({ leadDays: 2 })), C.addDays(today, 5), "a far-future item wakes only when its window reaches the Agenda horizon");
  const expired = make("expired", "Expired", day(-3, 10), null);
  assert.equal(C.nextAgendaVisibilityBoundary([expired], now, 4), null, "an expired one-off item does not keep a daily timer alive");
  const recurring = C.makeItem({ id: "daily-window", summary: "Daily", start: { dateTime: new Date(day(-1, 10)).toISOString() }, recurrence: ["RRULE:FREQ=DAILY;COUNT=3"], x: { kind: "reminder", src: "manual" } }, now);
  assert.equal(C.nextAgendaVisibilityBoundary([recurring], now, 4), C.addDays(today, 1), "recurring series are reevaluated at the next local day boundary");
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Warsaw";
  try {
    const spring = new Date(2026, 2, 29, 0, 0).getTime();
    const springItem = make("spring", "Spring", spring, null);
    assert.equal(C.nextAgendaVisibilityBoundary([springItem], spring, 4), new Date(2026, 2, 30, 0, 0).getTime());
    assert.equal(C.nextAgendaVisibilityBoundary([springItem], spring, 4) - spring, 23 * 60 * 60 * 1000, "spring-forward local day ends after 23 elapsed hours");
    const autumn = new Date(2026, 9, 25, 0, 0).getTime();
    const autumnItem = make("autumn", "Autumn", autumn, null);
    assert.equal(C.nextAgendaVisibilityBoundary([autumnItem], autumn, 4), new Date(2026, 9, 26, 0, 0).getTime());
    assert.equal(C.nextAgendaVisibilityBoundary([autumnItem], autumn, 4) - autumn, 25 * 60 * 60 * 1000, "fall-back local day ends after 25 elapsed hours");
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test("Zen Agenda controller refreshes at the next visibility/day boundary and releases expired timers", () => {
  let stamp = now, nextId = 0;
  const items = [make("expires-today", "Expires today", day(0, 10), null)];
  const nodes = new Map(), timers = new Map();
  const api = {
    ensureRoot: () => true,
    list: () => [...nodes.values()],
    add: (entry) => { nodes.set(entry.key, { ...entry }); return true; },
    update: (entry) => nodes.set(entry.key, { ...entry }),
    remove: (key) => nodes.delete(key),
    removeAll: () => nodes.clear(),
    reorder: () => {},
  };
  const controller = C.createZenAgenda({ api, getItems: () => items, getDays: () => 4, now: () => stamp,
    setTimer: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => timers.delete(id) });
  controller.runNow();
  assert.ok([...nodes.values()].some((entry) => entry.kind === "item" && entry.itemId === "expires-today"));
  assert.equal(timers.size, 1, "the projection owns one boundary timer, not a repeating polling loop");
  const [id, timer] = [...timers.entries()][0];
  const midnight = C.addDays(C.dayStart(stamp), 1);
  assert.equal(timer.ms, midnight - stamp);
  stamp = midnight;
  timers.delete(id);
  timer.fn();
  assert.equal(nodes.size, 0, "the expired item and its empty Agenda folder disappear after the local-day rollover");
  assert.equal(timers.size, 0, "expired one-off entries leave no timer behind");
  controller.destroy();
});

test("Agenda projection includes lead/tail days, filters opt-outs and keeps duplicate tabs", () => {
  const dueTomorrow = make("lead", "Tomorrow call", day(1, 10), null);
  const tailYesterday = make("tail", "Yesterday follow-up", day(-1, 10), day(-1, 11), { kind: "event" });
  const hidden = make("hidden", "Private", day(0, 10), null, { agendaWindow: { enabled: false } });
  const first = make("duplicate-1", "Same", day(0, 12), null);
  const second = make("duplicate-2", "Same", day(0, 12), null);
  const plan = C.agendaZenProjection([dueTomorrow, tailYesterday, hidden, first, second], now, 3, () => false, (item) => {
    if (item.id === "lead") return { leadDays: 1 };
    if (item.id === "tail") return { tailDays: 1 };
    return {};
  });
  assert.ok(plan[0].items.some((x) => x.itemId === "lead"), "a reminder is visible one day before its due date");
  assert.ok(plan[0].items.some((x) => x.itemId === "tail"), "an event is visible one day after its day");
  assert.equal(plan[0].items.some((x) => x.itemId === "hidden"), false);
  assert.equal(plan[0].items.filter((x) => x.summary === "Same").length, 2);
  assert.equal(new Set(plan[0].items.map((x) => x.key)).size, plan[0].items.length);
});

test("visibility windows remain on local dates across a DST spring-forward transition", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Warsaw";
  try {
    const start = new Date(2026, 2, 29, 10, 0).getTime();
    const item = make("dst", "DST event", start, start + 60 * 60 * 1000);
    const range = C.agendaVisibilityRange(item, { leadDays: 1, tailDays: 1 });
    assert.equal(C.localDateKey(range.from), "2026-03-28");
    assert.equal(C.localDateKey(range.to - 1), "2026-03-30");
    const from = new Date(range.from), to = new Date(C.addDays(range.from, 1));
    assert.equal(to.getTime() - from.getTime(), 24 * 60 * 60 * 1000);
    const dstStart = C.parseYmd("2026-03-29").getTime();
    assert.equal(C.addDays(dstStart, 1) - dstStart, 23 * 60 * 60 * 1000, "local day arithmetic crosses the DST gap in 23 hours");
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

console.log("Agenda visibility-window tests complete");
