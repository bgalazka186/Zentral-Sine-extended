"use strict";
/*
 * SB6.10 — Incremental Agenda projection.
 * Verifies exact bit-for-bit equality with full agendaZenProjection across
 * randomized edits, recurrence exceptions, visibility policies, history flips,
 * intra-day ended transitions, midnight rollovers, language/days changes,
 * createZenAgenda wiring, and production-shape performance budgets.
 */
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { scaleBudget } = require("./helpers/perf-budget.cjs");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");

const baseNow = new Date(2026, 10, 13, 9, 0).getTime();
const day0 = C.dayStart(baseNow);

function makeItem(id, summary, startMs, endMs = null, extra = {}) {
  const { description = "", recurrence = [], rev = 0, status = "confirmed", allDay = false, ...x } = extra;
  const start = allDay
    ? { date: C.localDateKey(startMs) }
    : { dateTime: new Date(startMs).toISOString() };
  const end = endMs != null
    ? (allDay ? { date: C.localDateKey(endMs) } : { dateTime: new Date(endMs).toISOString() })
    : undefined;
  return C.makeItem({
    id,
    summary,
    description,
    status,
    rev,
    start,
    ...(end ? { end } : {}),
    ...(recurrence.length ? { recurrence } : {}),
    x: { kind: end ? "event" : "reminder", src: "manual", ...x },
  }, baseNow);
}

// Deterministic PRNG (mulberry32) so randomized fuzz runs are 100% reproducible.
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok -", name);
  } catch (error) {
    console.error("FAIL " + name + "\n", error);
    process.exitCode = 1;
  }
}

test("1. Incremental projector re-projects only changed ids and affected days, reusing unaffected buckets", () => {
  assert.equal(typeof C.createIncrementalAgendaProjector, "function", "createIncrementalAgendaProjector must be exported");
  const projector = C.createIncrementalAgendaProjector();
  const items = [
    makeItem("d0-a", "Day 0 meeting", day0 + 10 * 3600000, day0 + 11 * 3600000),
    makeItem("d1-a", "Day 1 call", C.addDays(day0, 1) + 9 * 3600000),
    makeItem("d2-a", "Day 2 review", C.addDays(day0, 2) + 14 * 3600000, C.addDays(day0, 2) + 15 * 3600000),
    makeItem("d3-a", "Day 3 wrap", C.addDays(day0, 3) + 16 * 3600000),
  ];

  const run1 = projector.project(items, baseNow, { days: 4 });
  assert.equal(run1.stats.full, true);
  assert.deepEqual(run1.projection, C.agendaZenProjection(items, baseNow, 4));

  // No-op run: 0 changed ids, 0 affected days, every day bucket reused by reference
  const run2 = projector.project(items, baseNow, { days: 4 });
  assert.equal(run2.stats.full, false);
  assert.equal(run2.stats.changedIds.length, 0);
  assert.equal(run2.stats.affectedDays.length, 0);
  for (let i = 0; i < 4; i++) assert.ok(run2.projection[i] === run1.projection[i], `day ${i} reused`);

  // Edit only Day 2 item: ONLY d2-a re-projected, ONLY day offset 2 rebuilt; days 0, 1, 3 reused
  items[2] = makeItem("d2-a", "Day 2 review (edited)", C.addDays(day0, 2) + 14 * 3600000, C.addDays(day0, 2) + 15 * 3600000, { rev: 1 });
  const run3 = projector.project(items, baseNow, { days: 4 });
  assert.equal(run3.stats.full, false);
  assert.deepEqual(run3.stats.changedIds, ["d2-a"]);
  assert.deepEqual(run3.stats.affectedDays, [2]);
  assert.ok(run3.projection[0] === run2.projection[0], "day 0 unchanged");
  assert.ok(run3.projection[1] === run2.projection[1], "day 1 unchanged");
  assert.ok(run3.projection[2] !== run2.projection[2], "day 2 rebuilt");
  assert.ok(run3.projection[3] === run2.projection[3], "day 3 unchanged");
  assert.deepEqual(run3.projection, C.agendaZenProjection(items, baseNow, 4));

  // Move d1-a from Day 1 to Day 3: ONLY day offsets 1 and 3 affected; days 0 and 2 reused
  items[1] = makeItem("d1-a", "Day 1 call moved", C.addDays(day0, 3) + 11 * 3600000, null, { rev: 1 });
  const run4 = projector.project(items, baseNow, { days: 4 });
  assert.equal(run4.stats.full, false);
  assert.deepEqual(run4.stats.changedIds, ["d1-a"]);
  assert.deepEqual([...run4.stats.affectedDays].sort((a, b) => a - b), [1, 3]);
  assert.ok(run4.projection[0] === run3.projection[0], "day 0 untouched");
  assert.ok(run4.projection[2] === run3.projection[2], "day 2 untouched");
  assert.deepEqual(run4.projection, C.agendaZenProjection(items, baseNow, 4));

  // Remove d3-a: ONLY day 3 affected
  items.splice(3, 1);
  const run5 = projector.project(items, baseNow, { days: 4 });
  assert.deepEqual(run5.stats.removedIds, ["d3-a"]);
  assert.deepEqual(run5.stats.affectedDays, [3]);
  assert.ok(run5.projection[0] === run4.projection[0]);
  assert.ok(run5.projection[1] === run4.projection[1]);
  assert.ok(run5.projection[2] === run4.projection[2]);
  assert.deepEqual(run5.projection, C.agendaZenProjection(items, baseNow, 4));
});

test("2. Intra-day ended transitions (including tailDays fan-out), history flips, mirrored historyId, and window resets", () => {
  const projector = C.createIncrementalAgendaProjector();
  const tailEvent = makeItem("tail-ev", "Morning sync", day0 + 9 * 3600000, day0 + 10 * 3600000, {
    agendaWindow: { enabled: true, leadDays: 0, tailDays: 1 },
  });
  const mirrored = makeItem("line:abc", "Mirrored task", C.addDays(day0, 1) + 10 * 3600000, null, {
    historyId: "orig-rem-9",
  });
  const legacyNote = makeItem("note-reminder:n42", "Legacy note rem", C.addDays(day0, 2) + 8 * 3600000, null, {
    src: "note",
    noteId: "n42",
  });
  const items = [tailEvent, mirrored, legacyNote];
  const doneKeys = new Set();
  const isDone = (it) => {
    const id = C.reminderIdentity(it);
    return !!(id && doneKeys.has(id.itemId + "::" + id.occurrenceId));
  };

  let histVer = 1;
  const r0 = projector.project(items, day0 + 9.5 * 3600000, { days: 4, isDone, historyVersion: histVer });
  assert.deepEqual(r0.projection, C.agendaZenProjection(items, day0 + 9.5 * 3600000, 4, isDone));
  assert.equal(r0.projection[0].items[0].ended, false);
  assert.equal(r0.projection[1].items.find((x) => x.itemId === "tail-ev").ended, false);

  // Advance now past 10:00 on the same day: tail-ev flips ended=true on BOTH day 0 AND day 1 (tailDays=1)!
  const r1 = projector.project(items, day0 + 10.5 * 3600000, { days: 4, isDone, historyVersion: histVer });
  assert.equal(r1.stats.full, false);
  assert.deepEqual(r1.projection, C.agendaZenProjection(items, day0 + 10.5 * 3600000, 4, isDone));
  assert.equal(r1.projection[0].items[0].ended, true);
  assert.equal(r1.projection[1].items.find((x) => x.itemId === "tail-ev").ended, true);
  assert.ok(r1.projection[2] === r0.projection[2], "day 2 unaffected by ended transition");

  // Mark mirrored reminder done via its historyId ("orig-rem-9") -> dirtyIds resolves reverse map!
  doneKeys.add("orig-rem-9::orig-rem-9");
  histVer++;
  const r2 = projector.project(items, day0 + 10.5 * 3600000, {
    days: 4,
    isDone,
    historyVersion: histVer,
    dirtyIds: ["orig-rem-9"],
  });
  assert.equal(r2.stats.full, false);
  assert.deepEqual(r2.stats.affectedDays, [1]);
  assert.deepEqual(r2.projection, C.agendaZenProjection(items, day0 + 10.5 * 3600000, 4, isDone));
  assert.ok(r2.projection[0] === r1.projection[0]);
  assert.ok(r2.projection[2] === r1.projection[2]);

  // Language change triggers clean full rebuild
  const rPl = projector.project(items, day0 + 10.5 * 3600000, { days: 4, isDone, historyVersion: histVer, lang: "pl" });
  assert.equal(rPl.stats.full, true);
  assert.deepEqual(rPl.projection, C.agendaZenProjection(items, day0 + 10.5 * 3600000, 4, isDone, null, null, { lang: "pl" }));

  // Midnight rollover triggers clean full rebuild
  const nextDayNow = C.addDays(day0, 1) + 9 * 3600000;
  const rNextDay = projector.project(items, nextDayNow, { days: 4, isDone, historyVersion: histVer, lang: "pl" });
  assert.equal(rNextDay.stats.full, true);
  assert.deepEqual(rNextDay.projection, C.agendaZenProjection(items, nextDayNow, 4, isDone, null, null, { lang: "pl" }));
});

test("3. Randomized fuzz equality test: 120 random edits match full agendaZenProjection bit-for-bit", () => {
  const rng = makeRng(20261116);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const randInt = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

  const projector = C.createIncrementalAgendaProjector();
  const categories = {
    Work: { leadDays: 1, tailDays: 0 },
    Urgent: { leadDays: 2, tailDays: 1 },
    Hidden: { enabled: false },
    Home: {},
  };
  let globalDefaults = { enabled: true, leadDays: 0, tailDays: 0 };
  const getWindow = (item) => {
    const cat = item.x?.category ? categories[item.x.category] : null;
    return C.resolveAgendaWindow(item, cat, null, globalDefaults);
  };
  const doneSet = new Set();
  const isDone = (occ) => {
    const id = C.reminderIdentity(occ);
    return !!(id && doneSet.has(id.itemId + "::" + id.occurrenceId));
  };

  let nextId = 1;
  let now = baseNow;
  let days = 6;
  let lang = "en";
  let histVer = 1;

  const makeRandomItem = (id, rev = 0) => {
    const offset = randInt(-3, 9);
    const hour = randInt(0, 22);
    const startMs = C.addDays(day0, offset) + hour * 3600000 + randInt(0, 3) * 15 * 60000;
    const isAllDay = rng() < 0.2;
    const isEvent = rng() < 0.5;
    const spanDays = isAllDay ? randInt(1, 3) : 0;
    const endMs = isEvent
      ? (isAllDay ? C.addDays(C.dayStart(startMs), spanDays) : startMs + randInt(1, 6) * 3600000)
      : null;
    const isRec = rng() < 0.3;
    const recurrence = isRec ? [pick(["RRULE:FREQ=DAILY;COUNT=6", "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=4", "RRULE:FREQ=WEEKLY;COUNT=3"])] : [];
    const ex = [];
    if (isRec && rng() < 0.35) {
      const exDay = C.addDays(startMs, randInt(0, 3));
      const rid = isAllDay ? { date: C.localDateKey(exDay) } : { dateTime: new Date(exDay).toISOString() };
      if (rng() < 0.5) ex.push({ scope: "this", cancelled: true, recurrenceId: rid });
      else {
        const moved = C.addDays(exDay, randInt(-1, 2));
        ex.push({
          scope: "this",
          recurrenceId: rid,
          start: isAllDay ? { date: C.localDateKey(moved) } : { dateTime: new Date(moved + 3600000).toISOString() },
          ...(endMs != null ? { end: isAllDay ? { date: C.localDateKey(C.addDays(C.dayStart(moved), spanDays)) } : { dateTime: new Date(moved + 2 * 3600000).toISOString() } } : {}),
        });
      }
    }
    const cat = pick(["Work", "Urgent", "Hidden", "Home", ""]);
    const itemWin = rng() < 0.25 ? { enabled: rng() > 0.15, leadDays: randInt(0, 2), tailDays: randInt(0, 2) } : undefined;
    return makeItem(id, `Item ${id} r${rev}`, startMs, endMs, {
      rev,
      allDay: isAllDay,
      recurrence,
      status: rng() < 0.08 ? "cancelled" : "confirmed",
      description: rng() < 0.3 ? `Desc ${rev}` : "",
      category: cat,
      calNote: rng() < 0.25 ? `Note ${rev}` : "",
      sourceNoteTitle: rng() < 0.3 ? `Source ${id}` : "",
      sourceNoteTrashed: rng() < 0.1,
      ...(itemWin ? { agendaWindow: itemWin } : {}),
      ...(ex.length ? { recurrenceExceptions: ex } : {}),
    });
  };

  const items = Array.from({ length: 45 }, () => makeRandomItem(`it-${nextId++}`, 0));

  for (let step = 0; step < 120; step++) {
    const op = rng();
    let dirtyIds = null;
    if (op < 0.22 && items.length > 0) {
      // Edit 1-3 existing items
      const edits = randInt(1, 3);
      for (let e = 0; e < edits; e++) {
        const idx = randInt(0, items.length - 1);
        items[idx] = makeRandomItem(items[idx].id, (items[idx].rev || 0) + 1);
      }
    } else if (op < 0.35) {
      // Add 1-2 new items
      const adds = randInt(1, 2);
      for (let a = 0; a < adds; a++) items.push(makeRandomItem(`it-${nextId++}`, 0));
    } else if (op < 0.45 && items.length > 5) {
      // Delete 1-2 items
      const dels = randInt(1, 2);
      for (let d = 0; d < dels && items.length > 5; d++) items.splice(randInt(0, items.length - 1), 1);
    } else if (op < 0.58 && items.length > 0) {
      // Flip done/undone on a real projected occurrence
      const policiesNow = C.prepareAgendaWindows(items, getWindow);
      const fullNow = C.agendaZenProjection(items, now, days, () => false, getWindow, policiesNow, { lang });
      const flat = fullNow.flatMap((d) => d.items);
      if (flat.length > 0) {
        const picked = pick(flat);
        const k = picked.itemId + "::" + picked.occurrenceId;
        if (doneSet.has(k)) doneSet.delete(k);
        else doneSet.add(k);
        histVer++;
        dirtyIds = [picked.itemId];
      }
    } else if (op < 0.68) {
      // Mutate category visibility policy (tests policy-diff detection without item edits!)
      categories.Work = { leadDays: randInt(0, 3), tailDays: randInt(0, 2) };
      categories.Hidden = { enabled: rng() < 0.35, leadDays: randInt(0, 1) };
    } else if (op < 0.78) {
      // Advance clock within day (tests ended boundary transitions!)
      now += randInt(15, 180) * 60000;
    } else if (op < 0.86) {
      // Change global defaults
      globalDefaults = { enabled: true, leadDays: randInt(0, 2), tailDays: randInt(0, 1) };
    } else if (op < 0.92) {
      // Toggle language or days window
      if (rng() < 0.5) lang = lang === "en" ? "pl" : "en";
      else days = randInt(2, 10);
    } else {
      // Reorder items array (no logical change) or shallow-clone wrappers (like agendaItems() in ZentralNotes)
      for (let i = 0; i < items.length; i++) items[i] = { ...items[i], x: { ...items[i].x } };
    }

    const policies = C.prepareAgendaWindows(items, getWindow);
    const inc = projector.project(items, now, {
      days,
      isDone,
      getWindow,
      policies,
      lang,
      historyVersion: histVer,
      dirtyIds,
    }).projection;
    const full = C.agendaZenProjection(items, now, days, isDone, getWindow, policies, { lang });
    assert.deepEqual(inc, full, `Mismatch at random fuzz step ${step}`);
  }
});

test("4. createZenAgenda uses incremental projection and markHistoryDirty accurately", () => {
  const items = [
    makeItem("a", "Morning standup", day0 + 9 * 3600000, day0 + 9.5 * 3600000),
    makeItem("b", "Pay invoice", C.addDays(day0, 1) + 12 * 3600000),
  ];
  const doneIds = new Set();
  const nodes = new Map();
  const api = {
    ensureRoot: () => true,
    list: () => [...nodes.values()],
    add: (entry) => { nodes.set(entry.key, { ...entry }); return true; },
    update: (entry) => { nodes.set(entry.key, { ...entry }); },
    remove: (key) => { nodes.delete(key); },
    removeAll: () => { nodes.clear(); },
    reorder: () => {},
  };
  const controller = C.createZenAgenda({
    api,
    getItems: () => items,
    getDays: () => 4,
    getEnabled: () => true,
    now: () => baseNow,
    isDone: (it) => doneIds.has(it.id),
    setTimer: () => 1,
    clearTimer: () => {},
  });

  const p1 = controller.runNow();
  assert.equal(p1.length, 2);
  assert.equal(controller.lastProjectionStats?.full, true);

  // Edit only item "b" -> incremental run, only day 1 affected
  items[1] = makeItem("b", "Pay invoice ASAP", C.addDays(day0, 1) + 12 * 3600000, null, { rev: 1 });
  const p2 = controller.runNow();
  assert.equal(controller.lastProjectionStats?.full, false);
  assert.deepEqual(controller.lastProjectionStats?.affectedDays, [1]);
  assert.equal(p2[1].items[0].summary, "Pay invoice ASAP");

  // Mark item "b" done via markHistoryDirty(["b"]) -> incremental run removes day 1!
  doneIds.add("b");
  controller.markHistoryDirty(["b"]);
  const p3 = controller.runNow();
  assert.equal(controller.lastProjectionStats?.full, false);
  assert.deepEqual(controller.lastProjectionStats?.affectedDays, [1]);
  assert.equal(p3.length, 1);
  assert.equal(p3[0].items[0].itemId, "a");

  controller.destroy();
});

test("5. Production-shape performance budget: single edit in 2,000 daily recurring items across 31 days", () => {
  const n = 2000;
  const days = 31;
  const recStart = C.addDays(day0, 1) + 12 * 3600000;
  const items = Array.from({ length: n }, (_, i) => C.makeItem({
    id: `reminder-${i}`,
    summary: `Reminder ${i}`,
    start: { dateTime: new Date(recStart + (i % 20) * 60000).toISOString() },
    recurrence: ["RRULE:FREQ=DAILY"],
    x: { kind: "reminder", src: "manual", category: i % 2 ? "Work" : "Home" },
  }, baseNow));
  // Add a single-day item on day 2 to edit
  items.push(makeItem("single-edit", "Quick errand", C.addDays(day0, 2) + 15 * 3600000));

  const category = (name) => name === "Work" ? { agenda: { leadDays: 1 } } : { agenda: {} };
  const getWindow = (item) => C.resolveAgendaWindow(item, category(item.x.category).agenda, null, { enabled: true });

  const projector = C.createIncrementalAgendaProjector();
  const policies0 = C.prepareAgendaWindows(items, getWindow);
  const fullWarm = projector.project(items, baseNow, { days, getWindow, policies: policies0, historyVersion: 1 });
  assert.equal(fullWarm.stats.full, true);

  // Measure 10 single-day edits (only 1 day affected out of 31)
  const t0 = performance.now();
  let lastRes = null;
  for (let r = 0; r < 10; r++) {
    items[n] = makeItem("single-edit", `Quick errand #${r}`, C.addDays(day0, 2) + (15 + (r % 3)) * 3600000, null, { rev: r + 1 });
    const policies = C.prepareAgendaWindows(items, getWindow);
    lastRes = projector.project(items, baseNow, { days, getWindow, policies, historyVersion: 1 });
  }
  const singleDayAvgMs = (performance.now() - t0) / 10;
  assert.equal(lastRes.stats.full, false);
  assert.deepEqual(lastRes.stats.affectedDays, [2]);
  assert.deepEqual(
    lastRes.projection,
    C.agendaZenProjection(items, baseNow, days, () => false, getWindow, C.prepareAgendaWindows(items, getWindow)),
  );

  // Measure 5 recurring-item edits (all 31 days affected, still 1 of 2001 items re-expanded!)
  const t1 = performance.now();
  let lastRec = null;
  for (let r = 0; r < 5; r++) {
    items[r] = C.makeItem({ ...items[r], summary: `Edited recurring ${r}`, rev: r + 1 }, baseNow + r);
    const policies = C.prepareAgendaWindows(items, getWindow);
    lastRec = projector.project(items, baseNow, { days, getWindow, policies, historyVersion: 1 });
  }
  const recurringAvgMs = (performance.now() - t1) / 5;
  assert.equal(lastRec.stats.full, false);
  assert.deepEqual(
    lastRec.projection,
    C.agendaZenProjection(items, baseNow, days, () => false, getWindow, C.prepareAgendaWindows(items, getWindow)),
  );

  const singleCeiling = scaleBudget(50);
  const recurringCeiling = scaleBudget(200);
  console.log(
    `  incremental 2000x31: single-day edit ${singleDayAvgMs.toFixed(2)} ms/run (ceiling ${singleCeiling.toFixed(1)} ms), ` +
    `recurring edit ${recurringAvgMs.toFixed(2)} ms/run (ceiling ${recurringCeiling.toFixed(1)} ms)`,
  );
  assert.ok(singleDayAvgMs < singleCeiling, `single-day incremental edit too slow: ${singleDayAvgMs.toFixed(2)} ms`);
  assert.ok(recurringAvgMs < recurringCeiling, `recurring incremental edit too slow: ${recurringAvgMs.toFixed(2)} ms`);
});

(async () => {
  try {
    const host = createFakeZen({
      prefs: {
        "zen.workspace.zentral.notes.agenda_folder": true,
        "zen.workspace.zentral.notes.agenda_days": 4,
      },
    });
    const sidebar = host.seam;
    await sidebar.ensureStore();
    host.fireTimer(6500);
    await Promise.resolve();
    const t0 = Date.now();
    const d0 = C.dayStart(t0);
    const it0 = C.makeItem({ id: "host-d0", summary: "Host Day 0", start: { dateTime: new Date(d0 + 10 * 3600000).toISOString() }, x: { kind: "reminder", src: "manual" } }, t0);
    const it2 = C.makeItem({ id: "host-d2", summary: "Host Day 2", start: { dateTime: new Date(C.addDays(d0, 2) + 11 * 3600000).toISOString() }, x: { kind: "reminder", src: "manual" } }, t0);
    sidebar.store.items.upsert(it0);
    sidebar.store.items.upsert(it2);
    sidebar.agendaController.runNow();
    assert.equal(sidebar.agendaController.projection.length, 2);

    // Edit only host-d2: live host Agenda controller re-projects incrementally (only day 2!)
    const updated = sidebar.store.items.upsert({ ...sidebar.store.items.get("host-d2"), summary: "Host Day 2 Updated" });
    assert.ok(updated);
    sidebar.agendaController.runNow();
    assert.equal(sidebar.agendaController.lastProjectionStats?.full, false);
    assert.deepEqual(sidebar.agendaController.lastProjectionStats?.affectedDays, [2]);
    assert.ok(sidebar.agendaController.projection.some((d) => d.items.some((x) => x.summary === "Host Day 2 Updated")));

    // Mark host-d2 Done via reminder history -> live history listener marks only host-d2 dirty
    sidebar.store.items.history.append({ itemId: "host-d2", occurrenceId: "host-d2", action: "done", at: t0 + 1000 });
    sidebar.agendaController.runNow();
    assert.equal(sidebar.agendaController.lastProjectionStats?.full, false);
    assert.deepEqual(sidebar.agendaController.lastProjectionStats?.affectedDays, [2]);
    assert.equal(sidebar.agendaController.projection.length, 1);
    assert.equal(sidebar.agendaController.projection[0].items[0].itemId, "host-d0");

    await host.destroy();
    passed++;
    console.log("ok - 6. Live fake-Zen host Agenda controller runs incrementally on item edit and history done");
    console.log(`PASS notes-agenda-incremental (${passed} tests)`);
  } catch (error) {
    console.error("FAIL 6. Live fake-Zen host Agenda controller\n", error);
    process.exitCode = 1;
  }
})();
