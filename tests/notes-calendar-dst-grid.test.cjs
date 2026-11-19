"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createFakeDom = require("./helpers/fake-dom.cjs");

const notesPath = path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js");
const calPath = path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js");
const flavorsPath = path.resolve(__dirname, "../additional/notes/flavors/ZentralNotesFlavors.js");

const C = require(calPath);
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

function createCalendarSheetHarness() {
  const dom = createFakeDom();
  const { Ev, El, document, raf } = dom;
  const flavorsMod = require(flavorsPath);
  const win = {
    document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    __zentralNotesParts: { "notes-calendar": C, "notes-flavors": flavorsMod },
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
    windowId: "dst-grid",
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
  const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
  const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
  const chooseView = async (label) => {
    const sel = sheet.root.querySelector(".zn-calendar-view-select");
    click(sel);
    await flushRaf();
    const opt = sheet.root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === label);
    assert.ok(opt, "view option " + label + " exists");
    click(opt);
    await flushRaf();
  };
  return { store, sheet, flushRaf, root: sheet.root, chooseView };
}

(async () => {
  await test("pure dayTimelineHours produces exact 23h spring, 24h normal, and 25h fall timelines across IANA zones", async () => {
    assert.equal(typeof C.dayTimelineHours, "function");
    assert.equal(typeof C.buildGridTimeline, "function");
    assert.equal(typeof C.timelineMinuteOfMs, "function");
    assert.equal(typeof C.timelineClockLabel, "function");
    assert.equal(typeof C.timelineMsAt, "function");

    // Normal day
    const norm = C.dayTimelineHours("2026-11-18", "Europe/Warsaw");
    assert.equal(norm.hours.length, 24);
    assert.equal(norm.totalMinutes, 1440);
    assert.equal(norm.kind, "normal");
    assert.deepEqual(norm.skippedHours, []);
    assert.deepEqual(norm.repeatedHours, []);

    // Spring-forward 23h day (Europe/Warsaw: 02:00 skipped)
    const springPl = C.dayTimelineHours("2026-03-29", "Europe/Warsaw");
    assert.equal(springPl.hours.length, 23);
    assert.equal(springPl.totalMinutes, 1380);
    assert.equal(springPl.kind, "spring");
    assert.deepEqual(springPl.skippedHours, [2]);
    assert.deepEqual(springPl.hours.slice(0, 4).map((h) => h.clock), ["00:00", "01:00", "03:00", "04:00"]);
    assert.equal(springPl.hours[2].transition, "spring-after");
    assert.deepEqual(springPl.hours[2].skippedBefore, [2]);

    // Spring-forward 23h day (America/New_York: 02:00 skipped)
    const springNy = C.dayTimelineHours("2026-03-08", "America/New_York");
    assert.equal(springNy.hours.length, 23);
    assert.equal(springNy.totalMinutes, 1380);
    assert.deepEqual(springNy.skippedHours, [2]);

    // Fall-back 25h day (Europe/Warsaw: 02:00 repeated with +02:00 then +01:00)
    const fallPl = C.dayTimelineHours("2026-10-25", "Europe/Warsaw");
    assert.equal(fallPl.hours.length, 25);
    assert.equal(fallPl.totalMinutes, 1500);
    assert.equal(fallPl.kind, "fall");
    assert.deepEqual(fallPl.repeatedHours, [2]);
    assert.equal(fallPl.hours[2].clock, "02:00");
    assert.equal(fallPl.hours[2].repeated, 1);
    assert.equal(fallPl.hours[2].offsetText, "UTC+02:00");
    assert.equal(fallPl.hours[3].clock, "02:00");
    assert.equal(fallPl.hours[3].repeated, 2);
    assert.equal(fallPl.hours[3].offsetText, "UTC+01:00");

    // Fall-back 25h day (America/New_York: 01:00 repeated with UTC-04:00 then UTC-05:00)
    const fallNy = C.dayTimelineHours("2026-11-01", "America/New_York");
    assert.equal(fallNy.hours.length, 25);
    assert.equal(fallNy.totalMinutes, 1500);
    assert.deepEqual(fallNy.repeatedHours, [1]);
    assert.equal(fallNy.hours[1].repeated, 1);
    assert.equal(fallNy.hours[1].offsetText, "UTC-04:00");
    assert.equal(fallNy.hours[2].repeated, 2);
    assert.equal(fallNy.hours[2].offsetText, "UTC-05:00");
  });

  await test("pure buildGridTimeline and coordinate transforms preserve true durations across DST in Day and Week views", async () => {
    // Fall-back Day (Europe/Warsaw 2026-10-25)
    const fallDay = C.parseYmd("2026-10-25").getTime();
    const fallTl = C.buildGridTimeline([fallDay], "Europe/Warsaw");
    assert.equal(fallTl.slots.length, 25);
    assert.equal(fallTl.totalMinutes, 1500);

    // 02:30 CEST (00:30Z) -> 02:15 CET (01:15Z) is 45 real minutes (gridMin 150 -> 195)
    const s1 = C.timelineMinuteOfMs(Date.parse("2026-10-25T00:30:00Z"), "2026-10-25", fallTl, "Europe/Warsaw");
    const e1 = C.timelineMinuteOfMs(Date.parse("2026-10-25T01:15:00Z"), "2026-10-25", fallTl, "Europe/Warsaw");
    assert.equal(s1, 150);
    assert.equal(e1, 195);
    assert.equal(e1 - s1, 45, "repeated-hour crossing spans 45 real minutes, never negative");

    // Distinct passes of 02:15 map to distinct grid coordinates 60 minutes apart
    const pass1 = C.timelineMinuteOfMs(Date.parse("2026-10-25T00:15:00Z"), "2026-10-25", fallTl, "Europe/Warsaw");
    const pass2 = C.timelineMinuteOfMs(Date.parse("2026-10-25T01:15:00Z"), "2026-10-25", fallTl, "Europe/Warsaw");
    assert.deepEqual([pass1, pass2], [135, 195]);

    // Reverse transform (timelineMsAt) distinguishes 1st pass vs 2nd pass
    assert.equal(C.timelineMsAt("2026-10-25", 150, fallTl, "Europe/Warsaw"), Date.parse("2026-10-25T00:30:00Z"));
    assert.equal(C.timelineMsAt("2026-10-25", 210, fallTl, "Europe/Warsaw"), Date.parse("2026-10-25T01:30:00Z"));

    // Clock labels never overflow to 24:xx / 25:00
    assert.equal(C.timelineClockLabel(fallTl, 120), "02:00");
    assert.equal(C.timelineClockLabel(fallTl, 180), "02:00");
    assert.equal(C.timelineClockLabel(fallTl, 240), "03:00");
    assert.equal(C.timelineClockLabel(fallTl, 1500), "24:00");

    // Spring-forward Day (Europe/Warsaw 2026-03-29): 01:30 CET -> 03:30 CEST is 60 real minutes
    const springDay = C.parseYmd("2026-03-29").getTime();
    const springTl = C.buildGridTimeline([springDay], "Europe/Warsaw");
    assert.equal(springTl.slots.length, 23);
    assert.equal(springTl.totalMinutes, 1380);
    const spStart = C.timelineMinuteOfMs(Date.parse("2026-03-29T00:30:00Z"), "2026-03-29", springTl, "Europe/Warsaw");
    const spEnd = C.timelineMinuteOfMs(Date.parse("2026-03-29T01:30:00Z"), "2026-03-29", springTl, "Europe/Warsaw");
    assert.deepEqual([spStart, spEnd], [90, 150]);

    // Multi-day Fall-back Week: Mon 09:00 and Sun 09:00 align on identical gridMin (600), Mon has spacer at 180..240
    const fallWeek = C.weekDays(fallDay, 1);
    const fallWeekTl = C.buildGridTimeline(fallWeek, "Europe/Warsaw");
    assert.equal(fallWeekTl.slots.length, 25);
    assert.equal(fallWeekTl.dayGaps.get("2026-10-25").length, 0);
    assert.equal(fallWeekTl.dayGaps.get("2026-10-19").length, 1);
    assert.equal(fallWeekTl.dayGaps.get("2026-10-19")[0].kind, "spacer");
    const mon9 = C.timelineMinuteOfMs(C.zonedDateTimeToMs("2026-10-19", "09:00", "Europe/Warsaw"), "2026-10-19", fallWeekTl, "Europe/Warsaw");
    const sun9 = C.timelineMinuteOfMs(C.zonedDateTimeToMs("2026-10-25", "09:00", "Europe/Warsaw"), "2026-10-25", fallWeekTl, "Europe/Warsaw");
    assert.equal(mon9, sun9);
    assert.equal(mon9, 600);

    // Multi-day Spring-forward Week: 24 slots, Sun has skipped gap at 02:00, Mon & Sun 09:00 align at 540
    const springWeek = C.weekDays(springDay, 1);
    const springWeekTl = C.buildGridTimeline(springWeek, "Europe/Warsaw");
    assert.equal(springWeekTl.slots.length, 24);
    assert.equal(springWeekTl.dayGaps.get("2026-03-23").length, 0);
    assert.equal(springWeekTl.dayGaps.get("2026-03-29").length, 1);
    assert.equal(springWeekTl.dayGaps.get("2026-03-29")[0].kind, "skipped");
    assert.equal(springWeekTl.dayGaps.get("2026-03-29")[0].clock, "02:00");
    const sMon9 = C.timelineMinuteOfMs(C.zonedDateTimeToMs("2026-03-23", "09:00", "Europe/Warsaw"), "2026-03-23", springWeekTl, "Europe/Warsaw");
    const sSun9 = C.timelineMinuteOfMs(C.zonedDateTimeToMs("2026-03-29", "09:00", "Europe/Warsaw"), "2026-03-29", springWeekTl, "Europe/Warsaw");
    assert.equal(sMon9, sSun9);
    assert.equal(sMon9, 540);
  });

  await test("UI time grid renders 25h fall-back Day/Week and 23h spring-forward Day/Week accurately without collapsing DST-crossing events", async () => {
    const { store, sheet, flushRaf, root, chooseView } = createCalendarSheetHarness();
    await sheet.open();
    await flushRaf();
    store.setMeta({
      calendarDisplayZone: "Europe/Warsaw",
      calendarView: "day",
      calendarCursor: "2026-10-25",
      calendarHours: { on: false, startMin: 480, endMin: 1200 },
      calendarScale: { month: "auto", week: 54, day: 54, upcoming: "auto", agenda: "auto" },
    });

    // Exact roadmap regression event: starts 02:30 CEST (00:30Z), ends 02:15 CET (01:15Z) -> 45 real minutes!
    store.items.upsert({
      id: "dst-cross",
      summary: "Fall-back crossing",
      start: { dateTime: "2026-10-25T00:30:00.000Z" },
      end: { dateTime: "2026-10-25T01:15:00.000Z" },
      x: { kind: "event", tz: "Europe/Warsaw" },
    });
    // Two separate events at 02:15 CEST vs 02:15 CET -> distinct hours, 100% width each when alone
    store.items.upsert({
      id: "dst-pass1",
      summary: "First 02:05",
      start: { dateTime: "2026-10-25T00:05:00.000Z" },
      end: { dateTime: "2026-10-25T00:25:00.000Z" },
      x: { kind: "event", tz: "Europe/Warsaw" },
    });
    store.items.upsert({
      id: "dst-pass2",
      summary: "Second 02:20",
      start: { dateTime: "2026-10-25T01:20:00.000Z" },
      end: { dateTime: "2026-10-25T01:50:00.000Z" },
      x: { kind: "event", tz: "Europe/Warsaw" },
    });
    // Monday and Sunday 09:00 alignment events for Week view check
    store.items.upsert({
      id: "fall-mon-9",
      summary: "Mon 09:00",
      start: { dateTime: "2026-10-19T07:00:00.000Z" },
      end: { dateTime: "2026-10-19T08:00:00.000Z" },
      x: { kind: "event", tz: "Europe/Warsaw" },
    });
    store.items.upsert({
      id: "fall-sun-9",
      summary: "Sun 09:00",
      start: { dateTime: "2026-10-25T08:00:00.000Z" },
      end: { dateTime: "2026-10-25T09:00:00.000Z" },
      x: { kind: "event", tz: "Europe/Warsaw" },
    });

    sheet.openCalendarDay("2026-10-25");
    await flushRaf();

    // 1. Fall-back Day view: 25 hour labels, both 02:00 passes labeled, crossing event is 40.5px tall (45 min)
    const fallLabels = root.querySelectorAll(".zn-cal-hour-label");
    assert.equal(fallLabels.length, 25, "25-hour fall-back day renders 25 hour labels");
    assert.equal(fallLabels[2].getAttribute("data-dst"), "fall-1");
    assert.equal(fallLabels[3].getAttribute("data-dst"), "fall-2");
    assert.ok(fallLabels[2].textContent.includes("02:00") && fallLabels[2].textContent.includes("+2"));
    assert.ok(fallLabels[3].textContent.includes("02:00") && fallLabels[3].textContent.includes("+1"));
    assert.equal(root.querySelector(".zn-cal-time-scroll").getAttribute("aria-label"), "25-hour timeline");

    const crossBtn = root.querySelectorAll(".zn-cal-time-event").find((b) => b.textContent.includes("Fall-back crossing"));
    assert.ok(crossBtn, "crossing event rendered");
    assert.equal(parseFloat(crossBtn.style.top), 135, "02:30 CEST starts at 150 min = 135px");
    assert.equal(parseFloat(crossBtn.style.height), 40.5, "02:30 CEST -> 02:15 CET renders 45 real minutes (40.5px), NOT collapsed 20px");

    const pass1Btn = root.querySelectorAll(".zn-cal-time-event").find((b) => b.textContent.includes("First 02:05"));
    const pass2Btn = root.querySelectorAll(".zn-cal-time-event").find((b) => b.textContent.includes("Second 02:20"));
    assert.ok(parseFloat(pass2Btn.style.top) - parseFloat(pass1Btn.style.top) > 54, "first and second pass events live in separate hour rows");
    assert.equal(root.querySelectorAll(".zn-cal-dst-band").length, 2, "both repeated hour bands highlighted");

    // 2. Fall-back Week view: 25 labels, Sun has crossing event 40.5px tall, Mon-Sat have spacer gaps, Mon/Sun 09:00 aligned
    await chooseView("Week");
    assert.equal(root.querySelectorAll(".zn-cal-hour-label").length, 25, "fall-back week has 25 hour rows");
    assert.equal(root.querySelectorAll(".zn-cal-dst-gap.is-spacer").length, 6, "6 non-DST days show spacer for the extra hour");
    const mon9Btn = root.querySelectorAll(".zn-cal-time-event").find((b) => b.textContent.includes("Mon 09:00"));
    const sun9Btn = root.querySelectorAll(".zn-cal-time-event").find((b) => b.textContent.includes("Sun 09:00"));
    assert.ok(mon9Btn && sun9Btn);
    assert.equal(mon9Btn.style.top, sun9Btn.style.top, "Mon 09:00 and Sun 09:00 align horizontally in fall-back week");

    // 3. Spring-forward Day view (2026-03-29): 23 hour labels (no 02:00!), spring divider, 01:30->03:30 is 54px (60 real min)
    store.items.upsert({
      id: "spring-span",
      summary: "Spring bridge",
      start: { dateTime: "2026-03-29T00:30:00.000Z" },
      end: { dateTime: "2026-03-29T01:30:00.000Z" },
      x: { kind: "event", tz: "Europe/Warsaw" },
    });
    sheet.openCalendarDay("2026-03-29");
    await flushRaf();
    const springLabels = root.querySelectorAll(".zn-cal-hour-label");
    assert.equal(springLabels.length, 23, "23-hour spring-forward day renders 23 hour labels");
    assert.equal(springLabels.some((el) => el.textContent.startsWith("02:00")), false, "skipped 02:00 hour is omitted in Day view");
    assert.equal(springLabels[2].getAttribute("data-dst"), "spring");
    assert.equal(root.querySelector(".zn-cal-time-scroll").getAttribute("aria-label"), "23-hour timeline");
    assert.equal(root.querySelectorAll(".zn-cal-dst-divider.is-spring").length, 1, "spring-forward divider shown between 01:00 and 03:00");
    const springBtn = root.querySelectorAll(".zn-cal-time-event").find((b) => b.textContent.includes("Spring bridge"));
    assert.ok(springBtn);
    assert.equal(parseFloat(springBtn.style.top), 81, "01:30 CET starts at 90 min = 81px");
    assert.equal(parseFloat(springBtn.style.height), 54, "01:30 CET -> 03:30 CEST renders 60 real minutes (54px), NOT 108px");

    // 4. Spring-forward Week view: 24 labels, ONLY Sunday has skipped 02:00 band
    store.items.upsert({
      id: "spring-mon-9",
      summary: "Spring Mon 09:00",
      start: { dateTime: "2026-03-23T08:00:00.000Z" },
      end: { dateTime: "2026-03-23T09:00:00.000Z" },
      x: { kind: "event", tz: "Europe/Warsaw" },
    });
    store.items.upsert({
      id: "spring-sun-9",
      summary: "Spring Sun 09:00",
      start: { dateTime: "2026-03-29T07:00:00.000Z" },
      end: { dateTime: "2026-03-29T08:00:00.000Z" },
      x: { kind: "event", tz: "Europe/Warsaw" },
    });
    await chooseView("Week");
    assert.equal(root.querySelectorAll(".zn-cal-hour-label").length, 24, "spring week has 24 shared rows");
    const skippedGaps = root.querySelectorAll(".zn-cal-dst-gap.is-skipped");
    assert.equal(skippedGaps.length, 1, "only the spring-forward day column marks 02:00 as skipped");
    assert.equal(skippedGaps[0].getAttribute("data-dst-clock"), "02:00");
    const sMonBtn = root.querySelectorAll(".zn-cal-time-event").find((b) => b.textContent.includes("Spring Mon 09:00"));
    const sSunBtn = root.querySelectorAll(".zn-cal-time-event").find((b) => b.textContent.includes("Spring Sun 09:00"));
    assert.equal(sMonBtn.style.top, sSunBtn.style.top, "Mon 09:00 and Sun 09:00 align horizontally in spring-forward week");

    // 5. Limited hours (08:00-20:00) on Fall-back Day still extends cleanly to show 02:30 CEST -> 02:15 CET
    store.setMeta({ calendarHours: { on: true, startMin: 480, endMin: 1200 }, calendarView: "day", calendarCursor: "2026-10-25" });
    sheet.openCalendarDay("2026-10-25");
    await flushRaf();
    const limitedCross = root.querySelectorAll(".zn-cal-time-event").find((b) => b.textContent.includes("Fall-back crossing"));
    assert.ok(limitedCross);
    assert.equal(parseFloat(limitedCross.style.height), 40.5, "limited-hours fall-back day preserves 45-min crossing height");

    sheet.destroy();
    await store.close();
  });

  console.log(`\nALL ${passed} CALENDAR DST TIME-GRID (T2.4c4) TESTS PASSED`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
