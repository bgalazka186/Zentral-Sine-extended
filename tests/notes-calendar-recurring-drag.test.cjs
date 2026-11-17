"use strict";
/* T2.5: pointer drag of recurring calendar occurrences with explicit scope choice (this / following / series). */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createFakeDom = require("./helpers/fake-dom.cjs");

const notesPath = path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js");
const calPath = path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js");
const flavorsPath = path.resolve(__dirname, "../additional/notes/flavors/ZentralNotesFlavors.js");
const cal = require(calPath);

const ZONE = "Europe/Warsaw";
const at = (date, clock) => cal.zonedDateTimeToMs(date, clock, ZONE);
const when = (ms) => ({ dateTime: new Date(ms).toISOString() });

function q(root, sel) { return root.querySelector(sel); }

function createCalendarSheetHarness() {
  const dom = createFakeDom();
  const { Ev, El, document, raf } = dom;
  const flavorsMod = require(flavorsPath);
  const win = {
    document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    __zentralNotesParts: { "notes-calendar": cal, "notes-flavors": flavorsMod },
    requestAnimationFrame: (fn) => raf.push(fn),
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    innerWidth: 1200,
    innerHeight: 900,
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;
  vm.runInNewContext(fs.readFileSync(notesPath, "utf8"), {
    window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
    console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set,
    setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array,
    TextEncoder, TextDecoder, queueMicrotask,
  });
  const core = win.__zentralNotesTestSeam.core;
  const files = new Map();
  const io = {
    makeDir: async () => {},
    stat: async (p) => ({ size: (files.get(p)?.text || "").length, lastModified: files.get(p)?.mtime || 0 }),
    removeTree: async (d) => { for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k); },
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; },
    writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }),
    remove: async (p) => files.delete(p),
    exists: async (p) => files.has(p),
    children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/")),
    restrict: async () => {},
  };
  const store = core.createStore({
    io,
    getHistory: () => ({ on: true, keep: 5, minutes: 1, capKB: 512, warnMB: 100 }),
    notify() {},
    windowId: "recurring-drag",
    getDir: async () => "/n",
    getMaxSaveMs: () => 5000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });
  const host = new El("div");
  const adapter = {
    position: "fixed",
    host,
    attach: (r) => host.appendChild(r),
    getArea: () => ({ left: 0, top: 0, width: 900, height: 900, anchor: "top" }),
    watch: () => () => {},
    setActive() {},
    rewatch() {},
  };
  const env = {
    readOpts: () => ({}),
    openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, exportZip: () => 0, revealFolder() {},
    getPref: (_k, d) => d, setPref() {},
  };
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  sheet.root.ownerDocument = document;
  const flush = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
  const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
  const chooseView = async (label) => {
    const sel = sheet.root.querySelector(".zn-calendar-view-select");
    click(sel);
    await flush();
    const opt = sheet.root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === label);
    assert.ok(opt, "view option " + label + " exists");
    click(opt);
    await flush();
  };
  const pointer = (type, x, y, extra = {}) => new Ev(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y, ...extra });
  return { store, sheet, flush, root: sheet.root, chooseView, Ev, pointer };
}

(async () => {
  let passed = 0;
  const run = async (name, fn) => {
    await fn();
    passed++;
    console.log("ok - " + name);
  };

  // ---- Part 1: pure model (ZentralNotesCalendar.js) ----
  await run("pure: calendarOccurrenceTargetStart resolves timed, DST and all-day placements", () => {
    assert.equal(typeof cal.calendarOccurrenceTargetStart, "function");
    assert.equal(typeof cal.calendarMoveRecurringOccurrence, "function");
    const master = cal.makeItem({
      id: "pure-daily",
      summary: "Stand-up",
      start: when(at("2026-03-27", "09:00")),
      end: when(at("2026-03-27", "09:30")),
      recurrence: ["RRULE:FREQ=DAILY;COUNT=6"],
      x: { kind: "event", src: "manual", tz: ZONE },
    }, 1000);
    const expanded = cal.expandItem(master, at("2026-03-26", "00:00"), at("2026-04-03", "00:00"));
    const sat = expanded.find((o) => cal.zonedDateKey(cal.itemRange(o)[0], ZONE) === "2026-03-28");
    assert.ok(sat);

    const normalTarget = cal.calendarOccurrenceTargetStart(sat, { date: "2026-03-28", minute: 675 }, { zone: ZONE });
    assert.deepEqual(normalTarget, when(at("2026-03-28", "11:15")));

    // Spring-forward gap 2026-03-29 02:30 advances to 03:00 CEST.
    const springTarget = cal.calendarOccurrenceTargetStart(sat, { date: "2026-03-29", minute: 150 }, { zone: ZONE });
    assert.deepEqual(springTarget, when(at("2026-03-29", "03:00")));

    // Fall-back ambiguous 2026-10-25 02:30 picks earlier instant (CEST).
    const fallTarget = cal.calendarOccurrenceTargetStart(sat, { date: "2026-10-25", minute: 150 }, { zone: ZONE });
    assert.equal(fallTarget.dateTime, "2026-10-25T00:30:00.000Z");

    // All-day civil shift across spring-forward DST.
    const allDayMaster = cal.makeItem({
      id: "pure-allday",
      summary: "Daily check",
      start: { date: "2026-03-27" },
      recurrence: ["RRULE:FREQ=DAILY;COUNT=4"],
      x: { kind: "reminder", src: "manual" },
    }, 1000);
    const allDayRows = cal.expandItem(allDayMaster, cal.parseYmd("2026-03-26").getTime(), cal.parseYmd("2026-04-02").getTime());
    const day28 = allDayRows.find((o) => o.start.date === "2026-03-28");
    assert.deepEqual(
      cal.calendarOccurrenceTargetStart(day28, { date: "2026-03-30" }, { originKey: "2026-03-28", allDay: true }),
      { date: "2026-03-30" },
    );

    // Invalid inputs rejected.
    assert.equal(cal.calendarOccurrenceTargetStart(master, { date: "2026-03-28", minute: 600 }, { zone: ZONE }), null, "master without series/recurrenceId rejected");
    assert.equal(cal.calendarOccurrenceTargetStart(sat, { date: "2026-02-30", minute: 600 }, { zone: ZONE }), null);
    assert.equal(cal.calendarOccurrenceTargetStart(sat, { date: "2026-03-28", minute: 1440 }, { zone: ZONE }), null);
    assert.equal(cal.calendarOccurrenceTargetStart(sat, { date: "2026-03-28" }, { originKey: "2026-03-28", allDay: true }), null, "allDay mismatch rejected");
    assert.equal(cal.calendarOccurrenceTargetStart(day28, { date: "2026-03-29", minute: 600 }, { zone: ZONE }), null, "timed mismatch on all-day rejected");
  });

  await run("pure: calendarMoveRecurringOccurrence supports this / following / series and rejects unsafe inputs", () => {
    const master = cal.makeItem({
      id: "pure-series",
      summary: "Sync",
      start: when(at("2026-11-02", "09:00")),
      end: when(at("2026-11-02", "09:45")),
      recurrence: ["RRULE:FREQ=DAILY;COUNT=6"],
      x: { kind: "event", src: "manual", tz: ZONE },
    }, 1000);
    const from = at("2026-11-01", "00:00"), to = at("2026-11-12", "00:00");
    const rows = cal.expandItem(master, from, to);
    const day4 = rows.find((o) => cal.zonedDateKey(cal.itemRange(o)[0], ZONE) === "2026-11-04");
    assert.ok(day4);

    // Non-recurring helpers still refuse recurring items so callers cannot bypass scope choice.
    assert.equal(cal.calendarMoveTimedItem(day4, { date: "2026-11-04", minute: 660 }, ZONE, 2000), null);
    assert.equal(cal.calendarMoveTimedItem(master, { date: "2026-11-04", minute: 660 }, ZONE, 2000), null);

    // 1. "this" moves only Nov 4, preserves 45m duration and master immutability.
    const movedThis = cal.calendarMoveRecurringOccurrence(master, day4, { date: "2026-11-04", minute: 660 }, "this", { zone: ZONE, now: 2000 });
    assert.ok(movedThis);
    assert.equal(master.x.recurrenceExceptions.length, 0, "master is never mutated");
    const afterThis = cal.expandItem(movedThis, from, to);
    const byRecId = (list, date) => list.find((o) => Number(o.x.recurrenceId) === at(date, "09:00"));
    assert.equal(cal.clockIn(cal.itemRange(byRecId(afterThis, "2026-11-03"))[0], ZONE), "09:00");
    assert.equal(cal.clockIn(cal.itemRange(byRecId(afterThis, "2026-11-04"))[0], ZONE), "11:00");
    assert.equal(cal.itemRange(byRecId(afterThis, "2026-11-04"))[1] - cal.itemRange(byRecId(afterThis, "2026-11-04"))[0], 45 * 60000);
    assert.equal(cal.clockIn(cal.itemRange(byRecId(afterThis, "2026-11-05"))[0], ZONE), "09:00");

    // 2. "following" moves Nov 4, 5, 6, 7 and keeps Nov 2, 3 untouched.
    const movedFollowing = cal.calendarMoveRecurringOccurrence(master, day4, { date: "2026-11-04", minute: 630 }, "following", { zone: ZONE, now: 2000 });
    assert.ok(movedFollowing);
    const afterFollowing = cal.expandItem(movedFollowing, from, to);
    assert.equal(cal.clockIn(cal.itemRange(byRecId(afterFollowing, "2026-11-03"))[0], ZONE), "09:00");
    assert.equal(cal.clockIn(cal.itemRange(byRecId(afterFollowing, "2026-11-04"))[0], ZONE), "10:30");
    assert.equal(cal.clockIn(cal.itemRange(byRecId(afterFollowing, "2026-11-07"))[0], ZONE), "10:30");

    // 3. "series" shifts all occurrences.
    const movedSeries = cal.calendarMoveRecurringOccurrence(master, day4, { date: "2026-11-05", minute: 720 }, "series", { zone: ZONE, now: 2000 });
    assert.ok(movedSeries);
    const afterSeries = cal.expandItem(movedSeries, from, to);
    assert.equal(cal.zonedDateKey(cal.itemRange(byRecId(afterSeries, "2026-11-02"))[0], ZONE), "2026-11-03");
    assert.equal(cal.clockIn(cal.itemRange(byRecId(afterSeries, "2026-11-02"))[0], ZONE), "12:00");

    // 4. Recurring timed reminder has no end created.
    const remMaster = cal.makeItem({
      id: "pure-rem",
      summary: "Pills",
      start: when(at("2026-11-02", "08:00")),
      recurrence: ["RRULE:FREQ=DAILY;COUNT=4"],
      x: { kind: "reminder", src: "manual", tz: ZONE },
    }, 1000);
    const remOcc = cal.expandItem(remMaster, from, to)[1];
    const movedRem = cal.calendarMoveRecurringOccurrence(remMaster, remOcc, { date: "2026-11-03", minute: 570 }, "this", { zone: ZONE, now: 2000 });
    assert.ok(movedRem);
    assert.equal(movedRem.end, undefined);
    const expandedRem = cal.expandItem(movedRem, from, to).find((o) => o.x.recurrenceId === remOcc.x.recurrenceId);
    assert.equal(expandedRem.end, undefined);
    assert.equal(cal.clockIn(cal.itemRange(expandedRem)[0], ZONE), "09:30");

    // 5. All-day recurring reminder.
    const adMaster = cal.makeItem({
      id: "pure-ad",
      summary: "Water plants",
      start: { date: "2026-11-02" },
      recurrence: ["RRULE:FREQ=DAILY;COUNT=4"],
      x: { kind: "reminder", src: "manual" },
    }, 1000);
    const adOcc = cal.expandItem(adMaster, cal.parseYmd("2026-11-01").getTime(), cal.parseYmd("2026-11-10").getTime())[1];
    const adMoved = cal.calendarMoveRecurringOccurrence(adMaster, adOcc, { date: "2026-11-05" }, "following", { originKey: "2026-11-03", allDay: true, now: 2000 });
    assert.ok(adMoved);
    const adAfter = cal.expandItem(adMoved, cal.parseYmd("2026-11-01").getTime(), cal.parseYmd("2026-11-12").getTime());
    assert.deepEqual(adAfter.map((o) => o.start.date), ["2026-11-02", "2026-11-05", "2026-11-06", "2026-11-07"]);

    // 6. Rejections.
    assert.equal(cal.calendarMoveRecurringOccurrence(master, day4, { date: "2026-11-04", minute: 660 }, "all", { zone: ZONE }), null);
    assert.equal(cal.calendarMoveRecurringOccurrence(master, day4, { date: "2026-11-04", minute: 660 }, "", { zone: ZONE }), null);
    assert.equal(cal.calendarMoveRecurringOccurrence({ ...master, x: { ...master.x, src: "note" } }, day4, { date: "2026-11-04", minute: 660 }, "this", { zone: ZONE }), null);
    assert.equal(cal.calendarMoveRecurringOccurrence(remMaster, day4, { date: "2026-11-04", minute: 660 }, "this", { zone: ZONE }), null, "mismatched master rejected");
  });

  // ---- Part 2: UI pointer drag + scope chooser + undo + history + concurrency ----
  const { store, sheet, flush, root, chooseView, Ev, pointer } = createCalendarSheetHarness();
  await sheet.open();
  await flush();

  // Switch into All notes + Calendar view in Week mode around Mon 2026-11-02 .. Sun 2026-11-08.
  store.setMeta({
    calendarDisplayZone: ZONE,
    calendarCursor: "2026-11-02",
    calendarWeekStart: 1,
    calendarWeekDays: 7,
    calendarSnap: 15,
    calendarScale: { month: "auto", week: 54, day: 54 },
    calendarHours: { on: false, startMin: 480, endMin: 1200 },
  });
  const allNotesBtn = root.all().find((el) => el.title === "All notes");
  assert.ok(allNotesBtn);
  allNotesBtn.click();
  await flush();
  await chooseView("Week");

  const PX = 54;
  function wireWeekRects() {
    const scroll = q(root, ".zn-cal-time-scroll");
    const tracks = root.querySelectorAll(".zn-cal-time-track");
    scroll.getBoundingClientRect = () => ({ left: 0, right: tracks.length * 100, top: 0, bottom: 24 * PX, width: tracks.length * 100, height: 24 * PX });
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].getBoundingClientRect = () => ({ left: i * 100, right: (i + 1) * 100, top: 0, bottom: 24 * PX, width: 100, height: 24 * PX });
    }
    const row = q(root, ".zn-cal-time-allday-row");
    const cells = root.querySelectorAll(".zn-cal-time-allday-cell");
    if (row) row.getBoundingClientRect = () => ({ left: 0, right: cells.length * 100, top: 0, bottom: 80, width: cells.length * 100, height: 80 });
    for (let i = 0; i < cells.length; i++) {
      cells[i].getBoundingClientRect = () => ({ left: i * 100, right: (i + 1) * 100, top: 0, bottom: 80, width: 100, height: 80 });
    }
    return { scroll, tracks, row, cells };
  }
  function findTimedButtonOn(dayKey, text) {
    const tracks = root.querySelectorAll(".zn-cal-time-track");
    const index = tracks.findIndex((t) => t.getAttribute("data-day") === dayKey);
    assert.ok(index >= 0, `track ${dayKey} exists`);
    const btn = tracks[index].querySelectorAll(".zn-cal-item").find((el) => el.textContent.includes(text));
    assert.ok(btn, `item "${text}" rendered on ${dayKey}`);
    btn.setPointerCapture = () => {};
    return { btn, index, track: tracks[index] };
  }
  function dragTimed(btn, fromIdx, fromHour, toIdx, toHour, { cancel = false } = {}) {
    const x0 = fromIdx * 100 + 50, y0 = fromHour * PX;
    const x1 = toIdx * 100 + 50, y1 = toHour * PX;
    btn.dispatchEvent(pointer("pointerdown", x0, y0));
    root.dispatchEvent(pointer("pointermove", x1, y1));
    const previewText = q(root, ".zn-cal-drag-preview")?.textContent || "";
    root.dispatchEvent(pointer(cancel ? "pointercancel" : "pointerup", x1, y1));
    return previewText;
  }
  function scopeDialog() {
    return q(root, '.zn-dialog-card[aria-label="Move recurring occurrence"]');
  }
  function chooseScopeAndClick(scope, buttonLabel = "Move") {
    const dlg = scopeDialog();
    assert.ok(dlg, "scope dialog is open");
    const sel = dlg.querySelector(".zn-cal-recurrence-scope select");
    assert.ok(sel, "scope select is present");
    if (scope) {
      sel.value = scope;
      sel.dispatchEvent(new Ev("change", { bubbles: true }));
    }
    const btn = dlg.querySelectorAll("button").find((el) => el.textContent.trim() === buttonLabel);
    assert.ok(btn, `button "${buttonLabel}" exists in scope dialog`);
    btn.click();
  }

  await run("UI: dragging recurring timed event opens scope chooser (cancel / this / following / series) with guarded Undo", async () => {
    store.items.upsert({
      id: "ui-series-ev",
      summary: "Daily Standup",
      start: when(at("2026-11-02", "09:00")),
      end: when(at("2026-11-02", "09:30")),
      recurrence: ["RRULE:FREQ=DAILY;COUNT=6"],
      x: { kind: "event", src: "manual", tz: ZONE },
    });
    await flush();
    const from = at("2026-11-01", "00:00"), to = at("2026-11-12", "00:00");
    const occTime = (recDate) => {
      const m = store.items.get("ui-series-ev");
      const occ = cal.expandItem(m, from, to).find((o) => Number(o.x.recurrenceId) === at(recDate, "09:00"));
      assert.ok(occ, `occurrence for ${recDate} exists`);
      const ms = cal.itemRange(occ)[0];
      return cal.zonedDateKey(ms, ZONE) + " " + cal.clockIn(ms, ZONE);
    };

    // Preview on Wed 2026-11-04 (NOT Mon 2026-11-02 master start!) moved +2h to 11:00.
    wireWeekRects();
    let hit = findTimedButtonOn("2026-11-04", "Daily Standup");
    assert.ok(hit.btn.classList.contains("is-movable"), "recurring timed occurrence is movable");
    const preview = dragTimed(hit.btn, hit.index, 9.25, hit.index, 11.25);
    assert.equal(preview, "2026-11-04 11:00", "drag preview uses the dragged occurrence's date, not master's first day");
    assert.ok(scopeDialog(), "dropping recurring occurrence opens the scope chooser");
    assert.equal(occTime("2026-11-04"), "2026-11-04 09:00", "store is untouched before scope confirmation");

    // Cancel leaves master untouched.
    chooseScopeAndClick(null, "Cancel");
    assert.equal(scopeDialog(), null);
    assert.equal(store.items.get("ui-series-ev").x.recurrenceExceptions.length, 0);

    // No-op drop back onto same slot does NOT open scope dialog.
    wireWeekRects();
    hit = findTimedButtonOn("2026-11-04", "Daily Standup");
    dragTimed(hit.btn, hit.index, 9.25, hit.index, 9.35);
    assert.equal(scopeDialog(), null, "zero-delta drop does not prompt for scope");

    // pointercancel removes preview and does not open scope dialog.
    wireWeekRects();
    hit = findTimedButtonOn("2026-11-04", "Daily Standup");
    dragTimed(hit.btn, hit.index, 9.25, hit.index, 12.25, { cancel: true });
    assert.equal(q(root, ".zn-cal-drag-preview"), null);
    assert.equal(scopeDialog(), null);

    // Scope: "this" (Wed 09:00 -> Thu 11:00) + Undo.
    wireWeekRects();
    hit = findTimedButtonOn("2026-11-04", "Daily Standup");
    dragTimed(hit.btn, hit.index, 9.25, hit.index + 1, 11.25);
    chooseScopeAndClick("this", "Move");
    assert.equal(scopeDialog(), null);
    assert.equal(occTime("2026-11-03"), "2026-11-03 09:00");
    assert.equal(occTime("2026-11-04"), "2026-11-05 11:00", "this scope moved Wed occurrence to Thu 11:00");
    assert.equal(occTime("2026-11-05"), "2026-11-05 09:00", "neighbour occurrence stays at 09:00");
    assert.equal(q(root, ".zn-calendar-undo-move").hidden, false, "undo chip becomes visible");
    q(root, ".zn-calendar-undo-move").click();
    assert.equal(occTime("2026-11-04"), "2026-11-04 09:00", "undo restores this-scope move");
    assert.equal(store.items.get("ui-series-ev").x.recurrenceExceptions.length, 0);

    // Scope: "following" (Wed 09:00 -> Wed 10:30) + Undo.
    wireWeekRects();
    hit = findTimedButtonOn("2026-11-04", "Daily Standup");
    dragTimed(hit.btn, hit.index, 9.25, hit.index, 10.75);
    chooseScopeAndClick("following", "Move");
    assert.equal(occTime("2026-11-02"), "2026-11-02 09:00");
    assert.equal(occTime("2026-11-03"), "2026-11-03 09:00");
    assert.equal(occTime("2026-11-04"), "2026-11-04 10:30");
    assert.equal(occTime("2026-11-05"), "2026-11-05 10:30");
    assert.equal(occTime("2026-11-07"), "2026-11-07 10:30");
    q(root, ".zn-calendar-undo-move").click();
    assert.equal(occTime("2026-11-04"), "2026-11-04 09:00", "undo restores following-scope move");
    assert.equal(occTime("2026-11-07"), "2026-11-07 09:00");

    // Scope: "series" (Wed 09:00 -> Wed 12:00) + Undo.
    wireWeekRects();
    hit = findTimedButtonOn("2026-11-04", "Daily Standup");
    dragTimed(hit.btn, hit.index, 9.25, hit.index, 12.25);
    chooseScopeAndClick("series", "Move");
    assert.equal(occTime("2026-11-02"), "2026-11-02 12:00");
    assert.equal(occTime("2026-11-04"), "2026-11-04 12:00");
    assert.equal(occTime("2026-11-07"), "2026-11-07 12:00");
    q(root, ".zn-calendar-undo-move").click();
    assert.equal(occTime("2026-11-02"), "2026-11-02 09:00", "undo restores entire-series move");

    // Concurrency: master modified while scope dialog is open refuses overwrite.
    wireWeekRects();
    hit = findTimedButtonOn("2026-11-04", "Daily Standup");
    dragTimed(hit.btn, hit.index, 9.25, hit.index, 13.25);
    assert.ok(scopeDialog());
    const staleMaster = store.items.get("ui-series-ev");
    store.items.upsert({ ...staleMaster, summary: "Daily Standup (renamed)" });
    chooseScopeAndClick("this", "Move");
    assert.equal(scopeDialog(), null);
    assert.equal(store.items.get("ui-series-ev").x.recurrenceExceptions.length, 0, "stale scope dialog never overwrites newer master revision");
  });

  await run("UI: dragging recurring timed reminder records occurrence-scoped history, supports Undo, and respects write-blocked history", async () => {
    store.items.upsert({
      id: "ui-series-rem",
      summary: "Take stretch break",
      start: when(at("2026-11-02", "14:00")),
      recurrence: ["RRULE:FREQ=DAILY;COUNT=4"],
      x: { kind: "reminder", src: "manual", tz: ZONE },
    });
    await flush();
    const recId = at("2026-11-03", "14:00");
    const expectedOccId = "ui-series-rem@" + recId;

    wireWeekRects();
    const hit = findTimedButtonOn("2026-11-03", "Take stretch break");
    assert.ok(hit.btn.classList.contains("is-movable"));
    dragTimed(hit.btn, hit.index, 14.1, hit.index, 15.6);
    chooseScopeAndClick("this", "Move");

    const hist = store.items.history.list({ itemId: "ui-series-rem", occurrenceId: expectedOccId });
    assert.equal(hist[0]?.action, "rescheduled", "occurrence-scoped rescheduled history recorded");
    assert.equal(hist[0]?.start?.dateTime, new Date(at("2026-11-03", "15:30")).toISOString());

    q(root, ".zn-calendar-undo-move").click();
    const histAfterUndo = store.items.history.list({ itemId: "ui-series-rem", occurrenceId: expectedOccId });
    assert.equal(histAfterUndo.filter((r) => r.action === "rescheduled").length, 2, "undo records a second occurrence-scoped transition");
    assert.equal(store.items.get("ui-series-rem").x.recurrenceExceptions.length, 0);

    // Write-blocked history disables recurring reminder drag just like non-recurring reminders.
    const realState = store.items.history.storageState;
    store.items.history.storageState = () => ({ ...realState(), writeBlocked: true });
    await chooseView("Day");
    await chooseView("Week");
    const blocked = findTimedButtonOn("2026-11-03", "Take stretch break");
    assert.equal(blocked.btn.classList.contains("is-movable"), false, "write-blocked history disables recurring reminder drag");
    store.items.history.storageState = realState;
    await chooseView("Day");
    await chooseView("Week");
  });

  await run("UI: dragging recurring all-day reminder in all-day row uses scope chooser and civil date shift", async () => {
    store.items.upsert({
      id: "ui-series-allday",
      summary: "Daily journal",
      start: { date: "2026-11-02" },
      recurrence: ["RRULE:FREQ=DAILY;COUNT=4"],
      x: { kind: "reminder", src: "manual" },
    });
    await flush();
    const { cells } = wireWeekRects();
    const srcIdx = cells.findIndex((cell) => cell.getAttribute("data-day") === "2026-11-03");
    const dstIdx = cells.findIndex((cell) => cell.getAttribute("data-day") === "2026-11-05");
    assert.ok(srcIdx >= 0 && dstIdx >= 0);
    const btn = cells[srcIdx].querySelectorAll(".zn-cal-item").find((el) => el.textContent.includes("Daily journal"));
    assert.ok(btn && btn.classList.contains("is-movable"), "recurring all-day reminder is movable via scope chooser");
    btn.setPointerCapture = () => {};

    btn.dispatchEvent(pointer("pointerdown", srcIdx * 100 + 50, 30));
    root.dispatchEvent(pointer("pointermove", dstIdx * 100 + 50, 30));
    assert.equal(q(root, ".zn-cal-drag-preview")?.textContent, "2026-11-05 · all day");
    root.dispatchEvent(pointer("pointerup", dstIdx * 100 + 50, 30));

    assert.ok(scopeDialog(), "all-day recurring drag opens scope chooser instead of bypassing scopes");
    chooseScopeAndClick("following", "Move");

    const expanded = cal.expandItem(store.items.get("ui-series-allday"), cal.parseYmd("2026-11-01").getTime(), cal.parseYmd("2026-11-12").getTime());
    assert.deepEqual(expanded.map((o) => o.start.date), ["2026-11-02", "2026-11-05", "2026-11-06", "2026-11-07"]);

    q(root, ".zn-calendar-undo-move").click();
    const restored = cal.expandItem(store.items.get("ui-series-allday"), cal.parseYmd("2026-11-01").getTime(), cal.parseYmd("2026-11-12").getTime());
    assert.deepEqual(restored.map((o) => o.start.date), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
  });

  await run("UI: scope dialog supports keyboard Enter/Escape and DST spring-forward week drag", async () => {
    store.items.upsert({
      id: "ui-series-dst",
      summary: "DST Sync",
      start: when(at("2026-03-27", "09:00")),
      end: when(at("2026-03-27", "09:30")),
      recurrence: ["RRULE:FREQ=DAILY;COUNT=5"],
      x: { kind: "event", src: "manual", tz: ZONE },
    });
    store.setMeta({ calendarCursor: "2026-03-29" });
    await chooseView("Day");
    await chooseView("Week");

    wireWeekRects();
    let hit = findTimedButtonOn("2026-03-29", "DST Sync");
    // On 2026-03-29 in Week view, 02:00 is a skipped gap row so 09:00 is still at row 9 (09:00 aligned with Mon..Sat).
    dragTimed(hit.btn, hit.index, 9.25, hit.index, 11.25);
    let dlg = scopeDialog();
    assert.ok(dlg, "scope dialog opens on DST spring-forward week");
    // Escape cancels cleanly without mutating.
    root.dispatchEvent(new Ev("keydown", { key: "Escape", bubbles: true }));
    assert.equal(scopeDialog(), null, "Escape dismisses scope dialog");
    assert.equal(store.items.get("ui-series-dst").x.recurrenceExceptions.length, 0);

    // Drag again and confirm via Enter on the scope select.
    wireWeekRects();
    hit = findTimedButtonOn("2026-03-29", "DST Sync");
    dragTimed(hit.btn, hit.index, 9.25, hit.index, 11.25);
    dlg = scopeDialog();
    assert.ok(dlg);
    const sel = dlg.querySelector(".zn-cal-recurrence-scope select");
    sel.value = "this";
    sel.dispatchEvent(new Ev("keydown", { key: "Enter", bubbles: true }));
    assert.equal(scopeDialog(), null, "Enter on scope select applies move");
    const expanded = cal.expandItem(store.items.get("ui-series-dst"), at("2026-03-26", "00:00"), at("2026-04-02", "00:00"));
    const sun = expanded.find((o) => Number(o.x.recurrenceId) === at("2026-03-29", "09:00"));
    assert.equal(cal.clockIn(cal.itemRange(sun)[0], ZONE), "11:00", "spring-forward Sunday occurrence moved to 11:00 CEST");
  });

  sheet.destroy();
  console.log(`notes-calendar-recurring-drag: ${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
