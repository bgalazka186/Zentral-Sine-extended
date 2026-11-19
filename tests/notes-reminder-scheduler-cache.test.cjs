"use strict";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const clockStart = Date.parse("2026-11-13T12:00:00Z");
let now = clockStart, timerId = 0, itemListener, noteListener, notes = [], noteLists = 0;
const timers = new Map(), expanded = [], originalExpand = C.expandRange;
const tick = async (ms) => {
  const end = now + ms;
  for (;;) {
    const found = [...timers].filter(([, entry]) => entry.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!found) break;
    timers.delete(found[0]); now = found[1].at; found[1].fn(); await Promise.resolve();
  }
  now = end; await Promise.resolve();
};
const make = (id, offset) => C.makeItem({ id, summary: id, start: { dateTime: new Date(clockStart + offset).toISOString() }, recurrence: ["RRULE:FREQ=DAILY"], x: { kind: "reminder", src: "manual" } }, clockStart);
const items = [make("a", 86400000), make("b", 86460000)];
const store = {
  items: { list: () => items, category: () => null, on(fn) { itemListener = fn; return () => { itemListener = null; }; } },
  list: () => { noteLists++; return notes; }, get: (id) => notes.find((n) => n.id === id), on(fn) { noteListener = fn; return () => { noteListener = null; }; }, async claimReminder() { return false; },
};
(async () => {
  const h = createFakeZen(), perf = h.window.__zentralNotesPerf; h.setPref("zen.workspace.zentral.notes.debug_perf", true);
  C.expandRange = (values, ...args) => { expanded.push(values.map((x) => x.id)); return originalExpand(values, ...args); };
  const scheduler = h.window.__zentralNotesTestSeam.core.createReminderScheduler({ store, now: () => now, setTimer: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: now + ms, ms }); return id; }, clearTimer: (id) => timers.delete(id), onDue() {} });
  try {
    scheduler.start(); await Promise.resolve(); const firstPasses = perf.rows().find((r) => r.name === "reminders.pass").n;
    assert.ok(expanded.length > 0); expanded.length = 0; const initialNotes = noteLists;
    scheduler.reschedule(); await Promise.resolve(); assert.deepEqual(expanded, [], "unchanged passes reuse occurrence expansion");
    assert.equal(noteLists, initialNotes, "unchanged passes reuse cached pending notes");
    for (let i = 0; i < 50; i++) { items[0] = make("a", 86400000 + i * 1000); itemListener("change", "a"); await tick(20); }
    assert.equal(expanded.length, 0, "item changes are trailing-debounced"); await tick(301);
    assert.ok(expanded.length && expanded.every((ids) => ids.length === 1 && ids[0] === "a"), "only the edited series is re-expanded");
    const passCount = perf.rows().find((r) => r.name === "reminders.pass").n;
    assert.ok(passCount - firstPasses <= 2, "50 changes cause at most two subsequent passes including the explicit check");
    expanded.length = 0; itemListener("presentation", "a"); await tick(301); assert.deepEqual(expanded, [], "irrelevant events do not run the scheduler");
    itemListener("category", "work"); await tick(301); assert.ok(expanded.length >= 2, "category changes invalidate the cached window");
    expanded.length = 0; now += 86400000; scheduler.reschedule(); await Promise.resolve(); assert.ok(expanded.length >= 2, "local day rollover rebuilds the window");
    notes = [{ id: "note", remind: now + 3600000, reminded: 0, trashed: 0 }]; noteListener({ type: "change", id: "note", reminder: true }); await Promise.resolve();
    assert.ok(noteLists > initialNotes, "note reminder changes invalidate the note cache");
  } finally { scheduler.destroy(); C.expandRange = originalExpand; await h.destroy(); }
  console.log("scheduler occurrence cache passed");
})().catch((error) => { C.expandRange = originalExpand; console.error(error); process.exitCode = 1; });
