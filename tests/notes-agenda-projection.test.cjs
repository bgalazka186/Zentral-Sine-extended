"use strict";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { scaleBudget } = require("./helpers/perf-budget.cjs");
const now = new Date(2026, 10, 13, 9, 0).getTime();
const today = C.localDateKey(now), tomorrow = C.localDateKey(C.addDays(C.dayStart(now), 1));
const make = (id, summary, start, end, x = {}) => { const { description = "", ...meta } = x; return C.makeItem({ id, summary, description, start, ...(end ? { end } : {}), x: { kind: end ? "event" : "reminder", src: "manual", ...meta } }, now); };
function test(name, fn) { try { fn(); console.log("ok -", name); } catch (error) { console.error("FAIL " + name + "\n", error); process.exitCode = 1; } }

test("Agenda projection creates local Today..T+3 buckets and independent event/reminder tabs", () => {
  const event = make("event-1", "Planning", { dateTime: new Date(new Date(2026, 10, 13, 10).getTime()).toISOString() }, { dateTime: new Date(new Date(2026, 10, 13, 11).getTime()).toISOString() }, { noteId: "note-1", heading: "Agenda", description: "Quarterly review" });
  event.x.sourceNoteTitle = "Planning note"; // runtime enrichment from the linked note store
  const reminder = make("reminder-1", "Call Alice", { dateTime: new Date(new Date(2026, 10, 13, 9, 30).getTime()).toISOString() }, null, { noteId: "note-1", calNote: "Bring the draft", category: "Work", tz: "Europe/Warsaw" });
  const second = make("reminder-2", "Call Alice", { dateTime: new Date(new Date(2026, 10, 13, 9, 30).getTime()).toISOString() }, null, { noteId: "note-1" });
  const allDay = make("all-day", "Focus day", { date: today }, { date: tomorrow }, { kind: "event" });
  const ended = make("ended", "Earlier meeting", { dateTime: new Date(new Date(2026, 10, 13, 7).getTime()).toISOString() }, { dateTime: new Date(new Date(2026, 10, 13, 8).getTime()).toISOString() });
  const overnight = make("overnight", "Overnight shift", { dateTime: new Date(new Date(2026, 10, 13, 23).getTime()).toISOString() }, { dateTime: new Date(new Date(2026, 10, 14, 1).getTime()).toISOString() });
  const recurring = C.makeItem({ id: "daily", summary: "Daily check", start: { dateTime: new Date(new Date(2026, 10, 13, 8, 30).getTime()).toISOString() }, recurrence: ["RRULE:FREQ=DAILY;COUNT=2"], x: { kind: "reminder", src: "manual" } }, now);
  const rows = [event, reminder, second, allDay, ended, overnight, recurring];
  const before = JSON.stringify(rows);
  const plan = C.agendaZenProjection(rows, now, 4);
  assert.deepEqual(plan.map((day) => day.date), [today, tomorrow, C.localDateKey(C.addDays(C.dayStart(now), 2)), C.localDateKey(C.addDays(C.dayStart(now), 3))]);
  assert.equal(plan[0].label, "Today");
  assert.equal(plan[1].label, "Tomorrow");
  assert.ok(plan[0].items.some((item) => item.label === "10:00–11:00  Planning"));
  assert.ok(plan[0].items.some((item) => item.label === "09:30  Call Alice"));
  assert.ok(plan[0].items.some((item) => item.label === "All day · Focus day"));
  assert.equal(plan[0].items.filter((item) => item.summary === "Call Alice").length, 2, "identical reminders remain separate tabs");
  assert.equal(new Set(plan[0].items.map((item) => item.key)).size, plan[0].items.length, "occurrence keys are stable and unique");
  assert.ok(plan[0].items.find((item) => item.itemId === "ended").ended, "ended events are marked for fade/hide styling");
  assert.match(plan[0].items.find((item) => item.itemId === "event-1").details, /Quarterly review/);
  assert.match(plan[0].items.find((item) => item.itemId === "event-1").details, /Source note: Planning note/);
  assert.match(plan[0].items.find((item) => item.itemId === "event-1").details, /Heading: Agenda/);
  assert.match(plan[0].items.find((item) => item.itemId === "reminder-1").details, /Bring the draft/);
  assert.equal(plan[1].items.some((item) => item.itemId === "daily"), true, "recurrence expansion creates tomorrow's occurrence");
  assert.ok(plan[0].items.some((item) => item.itemId === "overnight"));
  assert.ok(plan[1].items.some((item) => item.itemId === "overnight"), "a multi-day event appears in every local day it overlaps");
  assert.equal(JSON.stringify(rows), before, "projection never mutates stored calendar items");
});

test("Agenda projection filters completed occurrences independently", () => {
  const item = C.makeItem({ id: "series", summary: "Repeat", start: { dateTime: new Date(new Date(2026, 10, 13, 10).getTime()).toISOString() }, recurrence: ["RRULE:FREQ=DAILY;COUNT=2"], x: { kind: "reminder", src: "manual" } }, now);
  const expanded = C.expandRange([item], C.dayStart(now), C.addDays(C.dayStart(now), 2));
  const doneId = expanded[0].x.recurrenceId;
  const plan = C.agendaZenProjection([item], now, 2, (occurrence) => String(occurrence.x.recurrenceId) === String(doneId));
  assert.equal(plan[0].count, 0);
  assert.equal(plan[1].count, 1);
});

test("Agenda projection handles 5,000 items within the 50 ms CI budget", () => {
  const items = Array.from({ length: 5000 }, (_, i) => make("bulk-" + i, "Item " + i, { dateTime: new Date(new Date(2026, 10, 13, 9, 0).getTime() + i * 1000).toISOString() }, null));
  const start = process.hrtime.bigint();
  const result = C.agendaZenProjection(items, now, 4);
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(result[0].count, 5000);
  const ceiling = scaleBudget(50);
  assert.ok(elapsed < ceiling, `5,000 item projection took ${elapsed.toFixed(2)} ms (ceiling ${ceiling.toFixed(1)} ms)`);
  console.log("ok - 5,000 item projection took " + elapsed.toFixed(2) + " ms");
});

test("Zen Agenda controller diffs virtual day/item entries and coalesces store-change updates", () => {
  const items = [make("first", "First", { dateTime: new Date(new Date(2026, 10, 13, 10).getTime()).toISOString() }, null)];
  const nodes = new Map(), calls = [], timers = new Map();
  let timerId = 0, enabled = true, position = "above";
  const api = {
    ensureRoot: (where) => { calls.push(["root", where]); return true; },
    list: () => [...nodes.values()],
    add: (entry) => { nodes.set(entry.key, { ...entry }); calls.push(["add", entry.key]); return true; },
    update: (entry) => { nodes.set(entry.key, { ...entry }); calls.push(["update", entry.key]); },
    remove: (key) => { nodes.delete(key); calls.push(["remove", key]); },
    removeAll: () => { nodes.clear(); calls.push(["removeAll"]); },
    reorder: (parent, keys) => calls.push(["reorder", parent, ...keys]),
  };
  const controller = C.createZenAgenda({ api, getItems: () => items, getDays: () => 4, getEnabled: () => enabled, getPosition: () => position, now: () => now,
    setTimer: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimer: (id) => timers.delete(id) });
  const first = controller.runNow();
  assert.equal(first[0].count, 1);
  assert.equal(nodes.get("day:" + today).count, 1);
  assert.ok([...nodes.values()].some((entry) => entry.kind === "item" && entry.label === "10:00  First"));
  const oldCalls = calls.length;
  items.push(make("second", "Second", { dateTime: new Date(new Date(2026, 10, 13, 11).getTime()).toISOString() }, null));
  position = "below";
  controller.schedule(); controller.schedule();
  assert.equal(timers.size, 1, "multiple store changes share one update timer");
  const scheduled = [...timers.values()][0]; timers.clear(); scheduled.fn();
  assert.ok(calls.slice(oldCalls).some((entry) => entry[0] === "root" && entry[1] === "below"));
  assert.equal(nodes.get("day:" + today).count, 2, "the day count updates from a fresh projection");
  assert.ok([...nodes.values()].some((entry) => entry.kind === "item" && entry.label === "11:00  Second"));
  enabled = true; items.splice(0); controller.runNow(); assert.equal(nodes.size, 0, "an empty day window removes the virtual Agenda folder");
  items.push(make("third", "Third", { dateTime: new Date(new Date(2026, 10, 13, 12).getTime()).toISOString() }, null));
  enabled = false; controller.runNow(); assert.equal(nodes.size, 0, "disabled Agenda removes its virtual folder entries");
  controller.destroy();
});
