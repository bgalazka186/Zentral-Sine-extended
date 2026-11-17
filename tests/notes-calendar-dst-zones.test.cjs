"use strict";

// OW-23 DST & summer-time <-> standard-time transition tests.
// Named with "zones" so `node tests/run-all.cjs --tz` runs every case under UTC, Europe/Warsaw,
// America/Los_Angeles, and Pacific/Auckland.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const HOUR_MS = 3600000;
const MIN_MS = 60000;

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log("ok - " + name);
}

(async () => {
  await test("DST offset, abbreviation, and civil day-bound switches across Northern, Southern, 30-min, midnight, and fixed zones", () => {
    const winterEU = Date.parse("2026-01-15T12:00:00.000Z");
    const summerEU = Date.parse("2026-07-15T12:00:00.000Z");

    // Europe/Warsaw: CET (UTC+01:00) in winter <-> CEST (UTC+02:00) in summer
    assert.equal(C.zoneOffsetAt("Europe/Warsaw", winterEU), 60);
    assert.equal(C.zoneOffsetAt("Europe/Warsaw", summerEU), 120);
    assert.equal(C.zoneOffsetText(C.zoneOffsetAt("Europe/Warsaw", winterEU)), "UTC+01:00");
    assert.equal(C.zoneOffsetText(C.zoneOffsetAt("Europe/Warsaw", summerEU)), "UTC+02:00");
    assert.equal(C.zoneChoice("Europe/Warsaw", winterEU).abbr, "CET");
    assert.equal(C.zoneChoice("Europe/Warsaw", summerEU).abbr, "CEST");

    // America/New_York: EST (UTC-05:00) <-> EDT (UTC-04:00); US-vs-EU 3-week mismatch window in March 2026
    const mismatchWindow = Date.parse("2026-03-16T12:00:00.000Z");
    assert.equal(C.zoneOffsetAt("America/New_York", winterEU), -300);
    assert.equal(C.zoneOffsetAt("America/New_York", mismatchWindow), -240, "US already in EDT on 2026-03-16");
    assert.equal(C.zoneOffsetAt("Europe/Warsaw", mismatchWindow), 60, "Europe still in CET on 2026-03-16");
    assert.equal(C.zoneOffsetAt("Europe/Warsaw", mismatchWindow) - C.zoneOffsetAt("America/New_York", mismatchWindow), 300, "5h difference during US/EU DST mismatch window");
    assert.equal(C.zoneChoice("America/New_York", winterEU).abbr, "EST");
    assert.equal(C.zoneChoice("America/New_York", summerEU).abbr, "EDT");

    // Southern Hemisphere: Pacific/Auckland NZDT (UTC+13:00 in Jan) <-> NZST (UTC+12:00 in Jul)
    assert.equal(C.zoneOffsetAt("Pacific/Auckland", winterEU), 780);
    assert.equal(C.zoneOffsetAt("Pacific/Auckland", summerEU), 720);
    const nzFallBack = C.zonedDayBounds("2026-04-05", "Pacific/Auckland");
    const nzSpringForward = C.zonedDayBounds("2026-09-27", "Pacific/Auckland");
    assert.equal((nzFallBack[1] - nzFallBack[0]) / HOUR_MS, 25, "Auckland fall-back day has 25h");
    assert.equal((nzSpringForward[1] - nzSpringForward[0]) / HOUR_MS, 23, "Auckland spring-forward day has 23h");

    // 30-minute DST shift: Australia/Lord_Howe (+11:00 <-> +10:30)
    assert.equal(C.zoneOffsetAt("Australia/Lord_Howe", winterEU), 660);
    assert.equal(C.zoneOffsetAt("Australia/Lord_Howe", summerEU), 630);
    const lhFallBack = C.zonedDayBounds("2026-04-05", "Australia/Lord_Howe");
    const lhSpringForward = C.zonedDayBounds("2026-10-04", "Australia/Lord_Howe");
    assert.equal((lhFallBack[1] - lhFallBack[0]) / MIN_MS, 24 * 60 + 30, "Lord Howe fall-back day is 24h30m");
    assert.equal((lhSpringForward[1] - lhSpringForward[0]) / MIN_MS, 23 * 60 + 30, "Lord Howe spring-forward day is 23h30m");

    // Europe/Warsaw spring-forward (23h) and fall-back (25h) civil bounds
    const warsawSpring = C.zonedDayBounds("2026-03-29", "Europe/Warsaw");
    const warsawFall = C.zonedDayBounds("2026-10-25", "Europe/Warsaw");
    assert.equal((warsawSpring[1] - warsawSpring[0]) / HOUR_MS, 23);
    assert.equal((warsawFall[1] - warsawFall[0]) / HOUR_MS, 25);

    // Midnight DST zone: America/Havana springs forward at 00:00 -> 01:00 on 2026-03-08
    const havanaSpring = C.zonedDayBounds("2026-03-08", "America/Havana");
    assert.equal((havanaSpring[1] - havanaSpring[0]) / HOUR_MS, 23);
    assert.equal(C.clockIn(havanaSpring[0], "America/Havana"), "01:00", "00:00 skipped -> day starts at 01:00 CDT");

    // Fixed offset never observes DST
    assert.equal(C.zoneOffsetAt("UTC+02:00", winterEU), 120);
    assert.equal(C.zoneOffsetAt("UTC+02:00", summerEU), 120);
    const fixedSpring = C.zonedDayBounds("2026-03-29", "UTC+02:00");
    assert.equal((fixedSpring[1] - fixedSpring[0]) / HOUR_MS, 24);
  });

  await test("zonedDateTimeToMs, expandItem, and moveOccurrence preserve wall clock across spring-forward and fall-back", () => {
    // Skipped hour (02:30 on 2026-03-29 in Europe/Warsaw) resolves to 03:00 CEST (01:00Z)
    const skipped = C.zonedDateTimeToMs("2026-03-29", "02:30", "Europe/Warsaw");
    assert.equal(new Date(skipped).toISOString(), "2026-03-29T01:00:00.000Z");
    assert.equal(C.clockIn(skipped, "Europe/Warsaw"), "03:00");

    // Repeated hour (02:30 on 2026-10-25 in Europe/Warsaw) picks earlier 1st pass (02:30 CEST = 00:30Z)
    const repeated = C.zonedDateTimeToMs("2026-10-25", "02:30", "Europe/Warsaw");
    assert.equal(new Date(repeated).toISOString(), "2026-10-25T00:30:00.000Z");
    assert.equal(C.clockIn(repeated, "Europe/Warsaw"), "02:30");

    // Daily recurring event across Europe/Warsaw spring-forward keeps 09:30 wall clock and 60-min duration
    const springSeries = C.makeItem({
      id: "dst-spring-series",
      summary: "Standup",
      start: { dateTime: "2026-03-28T08:30:00.000Z" },
      end: { dateTime: "2026-03-28T09:30:00.000Z" },
      recurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
      x: { kind: "event", tz: "Europe/Warsaw" },
    });
    const springOccs = C.expandItem(springSeries, Date.parse("2026-03-28T00:00:00Z"), Date.parse("2026-03-31T00:00:00Z"));
    assert.deepEqual(
      springOccs.map((it) => [C.zonedDateKey(Date.parse(it.start.dateTime), "Europe/Warsaw"), C.clockIn(Date.parse(it.start.dateTime), "Europe/Warsaw"), C.clockIn(Date.parse(it.end.dateTime), "Europe/Warsaw")]),
      [
        ["2026-03-28", "09:30", "10:30"],
        ["2026-03-29", "09:30", "10:30"],
        ["2026-03-30", "09:30", "10:30"],
      ],
    );
    assert.equal(springOccs[0].start.dateTime, "2026-03-28T08:30:00.000Z", "before DST: 09:30 CET = 08:30Z");
    assert.equal(springOccs[1].start.dateTime, "2026-03-29T07:30:00.000Z", "after DST: 09:30 CEST = 07:30Z");

    // Daily recurring event across Europe/Warsaw fall-back keeps 09:30 wall clock
    const fallSeries = C.makeItem({
      id: "dst-fall-series",
      summary: "Review",
      start: { dateTime: "2026-10-24T07:30:00.000Z" },
      end: { dateTime: "2026-10-24T08:30:00.000Z" },
      recurrence: ["RRULE:FREQ=DAILY;COUNT=3"],
      x: { kind: "event", tz: "Europe/Warsaw" },
    });
    const fallOccs = C.expandItem(fallSeries, Date.parse("2026-10-24T00:00:00Z"), Date.parse("2026-10-27T00:00:00Z"));
    assert.equal(fallOccs[0].start.dateTime, "2026-10-24T07:30:00.000Z", "before fall-back: 09:30 CEST = 07:30Z");
    assert.equal(fallOccs[1].start.dateTime, "2026-10-25T08:30:00.000Z", "on fall-back day: 09:30 CET = 08:30Z");
    assert.equal(fallOccs[2].start.dateTime, "2026-10-26T08:30:00.000Z");

    // Moving a single occurrence across DST preserves exact target wall clock and keeps sibling occurrences intact
    const movedMaster = C.moveOccurrence(
      springSeries,
      springOccs[1],
      { dateTime: new Date(C.zonedDateTimeToMs("2026-03-29", "11:00", "Europe/Warsaw")).toISOString() },
      "this",
      Date.parse("2026-03-28T12:00:00Z"),
    );
    const afterMove = C.expandItem(movedMaster, Date.parse("2026-03-28T00:00:00Z"), Date.parse("2026-03-31T00:00:00Z"));
    assert.deepEqual(
      afterMove.map((it) => C.clockIn(Date.parse(it.start.dateTime), "Europe/Warsaw")),
      ["09:30", "11:00", "09:30"],
    );
  });

  await test("snoozedItemStart and reminderSnoozeTomorrowMinutes preserve item.x.tz wall clock across spring-forward and fall-back", () => {
    // 1. Europe/Warsaw spring-forward: 2026-03-28 09:30 CET (08:30Z) + 1 day -> 2026-03-29 09:30 CEST (07:30Z, 23h later)
    const beforeSpring = {
      id: "rem-spring",
      summary: "Morning meds",
      start: { dateTime: "2026-03-28T08:30:00.000Z" },
      x: { kind: "reminder", tz: "Europe/Warsaw" },
    };
    const snoozedSpring = C.snoozedItemStart(beforeSpring, 1);
    assert.equal(snoozedSpring.dateTime, "2026-03-29T07:30:00.000Z", "snooze +1d across Warsaw spring-forward preserves 09:30 Warsaw wall clock");
    assert.equal(C.clockIn(Date.parse(snoozedSpring.dateTime), "Europe/Warsaw"), "09:30");

    // 2. Europe/Warsaw fall-back: 2026-10-24 09:30 CEST (07:30Z) + 1 day -> 2026-10-25 09:30 CET (08:30Z, 25h later)
    const beforeFall = {
      id: "rem-fall",
      summary: "Backup check",
      start: { dateTime: "2026-10-24T07:30:00.000Z" },
      x: { kind: "reminder", tz: "Europe/Warsaw" },
    };
    const snoozedFall = C.snoozedItemStart(beforeFall, 1);
    assert.equal(snoozedFall.dateTime, "2026-10-25T08:30:00.000Z", "snooze +1d across Warsaw fall-back preserves 09:30 Warsaw wall clock");
    assert.equal(C.clockIn(Date.parse(snoozedFall.dateTime), "Europe/Warsaw"), "09:30");

    // 3. Snooze +1d into a skipped spring-forward hour (2026-03-28 02:30 CET -> 2026-03-29 03:00 CEST)
    const intoGap = {
      id: "rem-gap",
      summary: "Nightly check",
      start: { dateTime: "2026-03-28T01:30:00.000Z" },
      x: { kind: "reminder", tz: "Europe/Warsaw" },
    };
    const snoozedGap = C.snoozedItemStart(intoGap, 1);
    assert.equal(snoozedGap.dateTime, "2026-03-29T01:00:00.000Z");
    assert.equal(C.clockIn(Date.parse(snoozedGap.dateTime), "Europe/Warsaw"), "03:00");

    // 4. Fixed offset stays exact 24h across DST dates
    const fixedRem = {
      id: "rem-fixed",
      summary: "Fixed offset",
      start: { dateTime: "2026-03-28T07:30:00.000Z" },
      x: { kind: "reminder", tz: "UTC+02:00" },
    };
    assert.equal(C.snoozedItemStart(fixedRem, 1).dateTime, "2026-03-29T07:30:00.000Z");

    // 5. Alert banner 'Tomorrow' snooze minutes in item zone across spring-forward (23h = 1380m) and fall-back (25h = 1500m)
    assert.equal(
      C.reminderSnoozeTomorrowMinutes(Date.parse("2026-03-28T08:30:00.000Z"), "Europe/Warsaw"),
      23 * 60,
      "Tomorrow snooze across Warsaw spring-forward is 1380 minutes (23h)",
    );
    assert.equal(
      C.reminderSnoozeTomorrowMinutes(Date.parse("2026-10-24T07:30:00.000Z"), "Europe/Warsaw"),
      25 * 60,
      "Tomorrow snooze across Warsaw fall-back is 1500 minutes (25h)",
    );
  });

  await test("layoutGridSpans separates repeated fall-back events into side-by-side lanes and avoids false spring-forward collisions", () => {
    assert.equal(typeof C.layoutGridSpans, "function", "layoutGridSpans exported on calendar core");

    // Spring-forward: reminder at 01:50 (110) with 34-min minBox (ends visually at 144) does NOT collide with 03:05 (185)
    const springLanes = C.layoutGridSpans(
      [
        { item: { id: "rem-0150" }, reminder: true, start: Date.parse("2026-03-29T00:50:00.000Z"), startMin: 110, endMin: 110 },
        { item: { id: "ev-0305" }, reminder: false, start: Date.parse("2026-03-29T01:05:00.000Z"), startMin: 185, endMin: 240 },
      ],
      { minBoxMin: 34, overlapMin: 6, gridEndMin: 1440 },
    );
    assert.equal(springLanes.length, 2);
    assert.equal(springLanes[0].lanes, 1, "01:50 reminder stays full width");
    assert.equal(springLanes[1].lanes, 1, "03:05 event stays full width");

    // Fall-back: 02:15–02:45 CEST (1st pass) and 02:15–02:45 CET (2nd pass) share clock minutes [135, 165] -> 2 side-by-side lanes
    const fallLanes = C.layoutGridSpans(
      [
        { item: { id: "ev-cest" }, reminder: false, start: Date.parse("2026-10-25T00:15:00.000Z"), startMin: 135, endMin: 165 },
        { item: { id: "ev-cet" }, reminder: false, start: Date.parse("2026-10-25T01:15:00.000Z"), startMin: 135, endMin: 165 },
      ],
      { minBoxMin: 20, overlapMin: 4, gridEndMin: 1440 },
    );
    assert.equal(fallLanes.length, 2);
    assert.equal(fallLanes[0].item.id, "ev-cest");
    assert.equal(fallLanes[0].lane, 0);
    assert.equal(fallLanes[0].lanes, 2);
    assert.equal(fallLanes[1].item.id, "ev-cet");
    assert.equal(fallLanes[1].lane, 1);
    assert.equal(fallLanes[1].lanes, 2);
  });

  // ---------------------------------------------------------------- UI integration in the real sheet
  const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  const dom = require("./helpers/fake-dom.cjs")();
  const { El, Ev, document, raf } = dom;
  const listeners = new Map();
  const win = {
    __zentralNotesParts: { "notes-calendar": C },
    document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    requestAnimationFrame: (fn) => raf.push(fn),
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    queueMicrotask,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((x) => x !== fn)); },
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); },
  };
  win.window = win;
  vm.runInNewContext(source, {
    window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console,
    URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, Intl,
    setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux", language: "en-GB" },
  });
  const core = win.__zentralNotesTestSeam.core;
  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      raf.splice(0).forEach((fn) => fn());
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  const files = new Map();
  const io = {
    join: (...parts) => parts.join("/"),
    filename: (value) => value.split("/").pop(),
    readUTF8: async (value) => { if (!files.has(value)) throw new Error("not found"); return files.get(value).text; },
    writeUTF8: async (value, text) => files.set(value, { text, mtime: Date.now() }),
    remove: async (value) => files.delete(value),
    exists: async (value) => files.has(value),
    children: async (dir) => [...files.keys()].filter((value) => value.startsWith(dir + "/") && !value.slice(dir.length + 1).includes("/")),
    stat: async (value) => ({ lastModified: files.get(value)?.mtime || 0 }),
    restrict: async () => {},
  };
  const store = core.createStore({
    io, notify() {}, windowId: "dst-zones-ui", getDir: async () => "/dst-zones", getMaxSaveMs: () => 1000,
    setTimer: setTimeout, clearTimer: clearTimeout,
  });
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (root) => host.append(root), getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const prefs = new Map();
  const env = { getPref: (key, fallback) => prefs.has(key) ? prefs.get(key) : fallback, setPref: (key, value) => prefs.set(key, value), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
  await store.open();
  store.create("# DST Notes\n\nBody");
  await store.flush();
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root;
  root.ownerDocument = document;
  root.querySelector(".zn-all-layout").getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  root.querySelector(".zn-all-panels").getBoundingClientRect = root.querySelector(".zn-all-layout").getBoundingClientRect;
  root.querySelector(".zn-calendar-pane").getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await sheet.open();
  await flush();
  root.all().find((node) => node.title === "All notes").click();
  await flush();

  const openTools = async (label) => {
    root.querySelector(".zn-calendar-tools").click();
    await flush();
    const entry = root.querySelectorAll(".zn-menu-item").find((node) => node.textContent.trim().startsWith(label));
    assert.ok(entry, "Calendar Tools offers " + label);
    entry.click();
    await flush();
  };

  await test("Day view in Europe/Warsaw renders 23h spring-forward and 25h fall-back with real elapsed hour rows (T2.4c4)", async () => {
    // 1. Spring-forward Sunday 2026-03-29 in Europe/Warsaw (23 real hours; fixed 36px/h so 20px minBox = 34m)
    store.setMeta({
      calendarDisplayZone: "Europe/Warsaw",
      calendarView: "day",
      calendarCursor: "2026-03-29",
      calendarScale: { month: "auto", week: 36, day: 36 },
      calendarHours: { on: false, startMin: 480, endMin: 1200 },
    });
    assert.ok(store.items.upsert({
      id: "spring-rem-0150",
      summary: "Pre-gap check",
      start: { dateTime: "2026-03-29T00:50:00.000Z" }, // 01:50 CET (110 elapsed min)
      x: { kind: "reminder", src: "manual", tz: "Europe/Warsaw" },
    }));
    assert.ok(store.items.upsert({
      id: "spring-ev-0305",
      summary: "Post-gap deploy",
      start: { dateTime: "2026-03-29T01:05:00.000Z" }, // 03:05 CEST (125 elapsed min — 15 real min after 01:50)
      end: { dateTime: "2026-03-29T02:00:00.000Z" },   // 04:00 CEST
      x: { kind: "event", src: "manual", tz: "Europe/Warsaw" },
    }));
    await flush();

    assert.equal(root.querySelectorAll(".zn-cal-hour-label").length, 23, "spring-forward day shows 23 real hour labels");
    const springButtons = root.querySelectorAll(".zn-cal-time-track .zn-cal-item");
    const preGapBtn = springButtons.find((n) => n.textContent.includes("Pre-gap check"));
    const postGapBtn = springButtons.find((n) => n.textContent.includes("Post-gap deploy"));
    assert.ok(preGapBtn && postGapBtn, "both spring-forward items render in Day view");
    // 01:50 CET and 03:05 CEST are 15 real minutes apart (9px at 36px/h < 20px minBox), so they share side-by-side lanes without covering each other.
    assert.equal(preGapBtn.style.width, "50%", "01:50 CET reminder (20px box) shares side-by-side lane with 03:05 CEST event 15 real minutes later");
    assert.equal(postGapBtn.style.width, "50%", "03:05 CEST event sits beside the 01:50 CET reminder box");
    assert.equal(parseFloat(postGapBtn.style.top) - parseFloat(preGapBtn.style.top), 9, "01:50 CET -> 03:05 CEST is 15 real minutes (9px at 36px/h)");
    assert.match(preGapBtn.getAttribute("aria-label"), /01:50 reminder, lane 1 of 2/);
    assert.match(postGapBtn.getAttribute("aria-label"), /03:05 to 04:00, lane 2 of 2/);

    // 2. Fall-back Sunday 2026-10-25 in Europe/Warsaw (25 real hours): 02:15 CEST and 02:15 CET live in distinct hour rows
    store.setMeta({ calendarCursor: "2026-10-25" });
    assert.ok(store.items.upsert({
      id: "fall-ev-cest",
      summary: "First 02:15 (CEST)",
      start: { dateTime: "2026-10-25T00:15:00.000Z" },
      end: { dateTime: "2026-10-25T00:45:00.000Z" },
      x: { kind: "event", src: "manual", tz: "Europe/Warsaw" },
    }));
    assert.ok(store.items.upsert({
      id: "fall-ev-cet",
      summary: "Second 02:15 (CET)",
      start: { dateTime: "2026-10-25T01:15:00.000Z" },
      end: { dateTime: "2026-10-25T01:45:00.000Z" },
      x: { kind: "event", src: "manual", tz: "Europe/Warsaw" },
    }));
    await flush();

    assert.equal(root.querySelectorAll(".zn-cal-hour-label").length, 25, "fall-back day shows 25 real hour labels");
    const fallButtons = root.querySelectorAll(".zn-cal-time-track .zn-cal-item");
    const firstPassBtn = fallButtons.find((n) => n.textContent.includes("First 02:15 (CEST)"));
    const secondPassBtn = fallButtons.find((n) => n.textContent.includes("Second 02:15 (CET)"));
    assert.ok(firstPassBtn && secondPassBtn, "both repeated-hour fall-back events render");
    assert.equal(parseFloat(secondPassBtn.style.top) - parseFloat(firstPassBtn.style.top), 36, "2nd-pass CET event sits one full hour row (36px) below 1st-pass CEST event");
    assert.equal(firstPassBtn.style.width, "100%", "1st-pass CEST event gets full width in its own hour row");
    assert.equal(secondPassBtn.style.width, "100%", "2nd-pass CET event gets full width in its own hour row");
    assert.equal(firstPassBtn.style.left, "0%");
    assert.equal(secondPassBtn.style.left, "0%");
  });

  await test("When am I free? formats free slots and prefills composer in calendarDisplayZone across DST", async () => {
    store.setMeta({
      calendarDisplayZone: "Europe/Warsaw",
      calendarView: "day",
      calendarCursor: "2026-03-29",
      calendarWork: { days: [0, 1, 2, 3, 4, 5, 6], startMin: 9 * 60, endMin: 12 * 60 },
    });
    assert.ok(store.items.upsert({
      id: "spring-busy-0900",
      summary: "Morning block",
      start: { dateTime: "2026-03-29T07:00:00.000Z" }, // 09:00 CEST
      end: { dateTime: "2026-03-29T08:00:00.000Z" },   // 10:00 CEST
      x: { kind: "event", src: "manual", tz: "Europe/Warsaw" },
    }));
    await flush();

    await openTools("When am I free?");
    const freeCard = root.querySelector('.zn-dialog-card[aria-label="When am I free?"]');
    assert.ok(freeCard, "When am I free? dialog opens");
    freeCard.querySelector('[aria-label="From date"]').value = "2026-03-29";
    freeCard.querySelector('[aria-label="Through date"]').value = "2026-03-29";
    freeCard.querySelectorAll("button").find((b) => b.textContent.trim() === "Find free times").click();
    await flush();
    const slotBtns = freeCard.querySelectorAll(".zn-cal-free-slot");
    assert.equal(slotBtns.length, 1);
    assert.match(slotBtns[0].textContent, /10:00–12:00 · 120 min/, "free slot is formatted in Europe/Warsaw CEST wall clock");

    slotBtns[0].click();
    await flush();
    const composeCard = root.querySelector(".zn-cal-compose-card");
    assert.ok(composeCard, "clicking a free slot opens Create calendar item");
    assert.equal(composeCard.querySelector('[aria-label="Start date"]').value, "2026-03-29");
    assert.equal(composeCard.querySelector('[aria-label="Start time"]').value, "10:00");
    assert.equal(composeCard.querySelector('[aria-label="End time"]').value, "12:00");
    assert.equal(composeCard.querySelector('.zn-zone-input[aria-label="Time zone"]').value, "Europe/Warsaw");
    composeCard.querySelectorAll("button").find((b) => b.textContent.trim() === "Cancel").click();
    await flush();
  });

  await test("Custom reminder snooze and Snooze until next Monday use item.x.tz date across midnight/DST boundaries", async () => {
    // Sunday 2026-11-01 20:30 PST (fall-back Sunday evening in Los Angeles = Monday 2026-11-02T04:30:00.000Z in UTC/Warsaw)
    store.setMeta({
      calendarDisplayZone: "America/Los_Angeles",
      calendarView: "day",
      calendarCursor: "2026-11-01",
    });
    assert.ok(store.items.upsert({
      id: "la-sunday-evening",
      summary: "West Coast wrap-up",
      start: { dateTime: "2026-11-02T04:30:00.000Z" },
      x: { kind: "reminder", src: "manual", tz: "America/Los_Angeles" },
    }));
    await flush();

    const remBtn = root.querySelectorAll(".zn-cal-time-track .zn-cal-item").find((n) => n.textContent.includes("West Coast wrap-up"));
    assert.ok(remBtn, "Los Angeles Sunday evening reminder renders on 2026-11-01");

    // Open context menu -> Snooze -> Custom date and time…
    remBtn.dispatchEvent(new Ev("contextmenu", { bubbles: true, clientX: 500, clientY: 300 }));
    await flush();
    const snoozeGroup = root.querySelectorAll(".zn-menu-item").find((n) => n.textContent.trim().startsWith("Snooze"));
    assert.ok(snoozeGroup, "context menu has Snooze group");
    snoozeGroup.click();
    await flush();
    const customSnoozeItem = root.querySelectorAll(".zn-menu-item").find((n) => n.textContent.trim() === "Custom date and time…");
    assert.ok(customSnoozeItem, "Snooze group offers Custom date and time…");
    customSnoozeItem.click();
    await flush();

    const snoozeCard = root.querySelector('.zn-dialog-card[aria-label="Custom reminder snooze"]');
    assert.ok(snoozeCard, "Custom reminder snooze dialog opens");
    assert.equal(snoozeCard.querySelector('[aria-label="New date"]').value, "2026-11-01", "New date uses item.x.tz date (2026-11-01), not UTC/Warsaw 2026-11-02");
    assert.equal(snoozeCard.querySelector('[aria-label="New time"]').value, "20:30", "New time uses item.x.tz clock (20:30)");
    snoozeCard.querySelectorAll("button").find((b) => b.textContent.trim() === "Cancel").click();
    await flush();

    // Reopen context menu -> Snooze -> Snooze until next Monday -> should advance +1 civil day in LA to Monday 2026-11-02 20:30 PST (2026-11-03T04:30:00.000Z)
    const remBtn2 = root.querySelectorAll(".zn-cal-time-track .zn-cal-item").find((n) => n.textContent.includes("West Coast wrap-up"));
    remBtn2.dispatchEvent(new Ev("contextmenu", { bubbles: true, clientX: 500, clientY: 300 }));
    await flush();
    root.querySelectorAll(".zn-menu-item").find((n) => n.textContent.trim().startsWith("Snooze")).click();
    await flush();
    root.querySelectorAll(".zn-menu-item").find((n) => n.textContent.trim() === "Snooze until next Monday").click();
    await flush();

    const updated = store.items.get("la-sunday-evening");
    assert.equal(updated.start.dateTime, "2026-11-03T04:30:00.000Z", "Snooze until next Monday advances from LA Sunday 2026-11-01 to LA Monday 2026-11-02 20:30 PST");
  });

  console.log("notes-calendar-dst-zones: " + passed + " passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
