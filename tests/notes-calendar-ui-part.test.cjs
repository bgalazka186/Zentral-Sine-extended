"use strict";
/* T4.3a: calendar UI decisions live in their own module, outside ZentralNotes.uc.js.
 *
 * The sheet keeps the same test seam names; the module answers pure/measurable questions from arguments.
 * This suite is RED on the pre-T4.3a tree (the part and its manifest entry do not exist) and GREEN after.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const UI_PATH = "additional/notes/calendar/ZentralNotesCalendarUI.js";
const MAIN = read("additional/notes/ZentralNotes.uc.js");
const MANIFEST = JSON.parse(read("additional/notes/standalone.json"));
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const UI = require("../additional/notes/calendar/ZentralNotesCalendarUI.js");
const dom = require("./helpers/fake-dom.cjs")();

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

test("the calendar UI part exports one pure API through both module doors", () => {
  assert.ok(fs.existsSync(path.join(ROOT, UI_PATH)), UI_PATH + " exists");
  assert.equal(typeof UI, "object");
  for (const name of [
    "menuPosition", "weekSpanConfig", "shownWeekDays", "weekAutoWidth", "dayLabel", "itemColor", "itemTime",
    "sourceTitle", "monthRowPx", "timelineRoom", "fontPx", "paneWidth", "paneHeight", "sizedView", "dragPoint",
    "interacting", "monthNarrow", "displayZone", "todayLabel", "todayKey", "todayDay", "holidayPrefs", "workFreeInfo",
  ]) assert.equal(typeof UI[name], "function", name + " is exported");
  assert.equal(UI.menuPosition({
    anchor: { left: 2, right: 3, top: 2, bottom: 3 }, viewport: { width: 1000, height: 700 }, size: { width: 250, height: 1200 },
  }).left, 6);
  assert.equal(UI.sourceTitle({ body: "before\n# The title\nafter" }), "The title");
  assert.equal(UI.monthRowPx({ clientHeight: 75 }), 10);
  assert.equal(UI.sizedView("month", false), true);
  assert.equal(UI.sizedView("month", true), false);
  assert.equal(UI.interacting({ menu: { calendar: true } }), true);
  assert.equal(UI.interacting({}), false);
  assert.equal(UI.dayLabel(C, Date.now(), { weekday: false }), C.localDateKey(Date.now()));
});

test("the standalone manifest embeds the UI part right after the calendar core", () => {
  const include = MANIFEST.include;
  const core = include.indexOf("calendar/ZentralNotesCalendar.js");
  const ui = include.indexOf("calendar/ZentralNotesCalendarUI.js");
  assert.ok(core >= 0 && ui > core, "the core loads first, then the UI part");
  assert.equal(MANIFEST.version, "3.4.0", "no version bump");
});

test("the monolith loads the part and delegates each extracted decision to it", () => {
  assert.ok(MAIN.includes(`loadPart("${UI_PATH}", "notes-calendar-ui")`), "the part is loaded by name");
  assert.ok(MAIN.includes("const CALENDAR_UI = CALENDAR_UI_PART || CALENDAR_UI_FALLBACK"), "with a compatibility shim");
  assert.ok(MAIN.includes("CALENDAR_PART, CALENDAR_UI_PART, CALENDAR_UI"), "the test seam publishes the parts");
  for (const old of ["calendarMenuPosition", "calendarWeekAutoWidth", "calendarWeekSpanConfig", "calendarShownWeekDays",
    "calendarDisplayZone", "calendarDayLabel", "calendarItemColor", "calendarItemTime", "calendarSourceTitle",
    "calendarMonthRowPx", "calendarTimelineRoom", "calendarFontPx", "calendarPaneWidth", "calendarDragPoint"]) {
    assert.equal(new RegExp("\\bfunction\\s+" + old + "\\s*\\(").test(MAIN), false, old + " is no longer an inline function");
  }
  for (const name of ["menuPosition", "weekAutoWidth", "weekSpanConfig", "shownWeekDays", "displayZone", "dayLabel",
    "itemColor", "itemTime", "sourceTitle", "monthRowPx", "timelineRoom", "fontPx", "paneWidth", "paneHeight",
    "sizedView", "dragPoint", "interacting", "monthNarrow", "holidayPrefs", "workFreeInfo"]) {
    assert.ok(MAIN.includes("CALENDAR_UI." + name), name + " is called through the part");
  }
});

function boot(withPart) {
  const seam = {};
  const parts = { "notes-calendar": C };
  if (withPart) parts["notes-calendar-ui"] = UI;
  const win = {
    __zentralNotesParts: parts, __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} },
    document: dom.document, innerWidth: 1000, innerHeight: 700,
    requestAnimationFrame: (fn) => { dom.raf.push(fn); return dom.raf.length; }, cancelAnimationFrame() {},
    setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {},
  };
  win.window = win;
  vm.runInNewContext(MAIN, {
    window: win, document: dom.document, globalThis: { Services: {} }, ChromeUtils: {}, console,
    URL, Date, JSON, Math, Promise, RegExp, Number, String, Array, Object, Map, Set,
    setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" },
  });
  return seam.core;
}

test("the test seam is unchanged and the core uses the part when it is present", () => {
  const core = boot(true);
  assert.equal(core.CALENDAR_PART, C, "the old calendar core is still exposed");
  assert.equal(core.CALENDAR_UI_PART, UI, "and the new part is published");
  assert.equal(core.CALENDAR_UI, UI, "the live decision object is the part");
  assert.equal(typeof core.calendarMenuPosition, "function", "the old geometry name still works");
  const pos = core.calendarMenuPosition({
    anchor: { left: 997, right: 998, top: 697, bottom: 698 }, viewport: { width: 1000, height: 700 }, size: { width: 250, height: 1200 },
  });
  assert.deepEqual(pos, UI.menuPosition({
    anchor: { left: 997, right: 998, top: 697, bottom: 698 }, viewport: { width: 1000, height: 700 }, size: { width: 250, height: 1200 },
  }), "the seam delegates to the module");
});

test("a host without the part keeps the old answers instead of throwing", () => {
  const core = boot(false);
  assert.equal(core.CALENDAR_UI_PART, null);
  assert.ok(core.CALENDAR_UI && core.CALENDAR_UI !== UI, "the compatibility shim is used");
  assert.equal(typeof core.calendarMenuPosition, "function");
  const pos = core.calendarMenuPosition({
    anchor: { left: 2, right: 3, top: 2, bottom: 3 }, viewport: { width: 1000, height: 700 }, size: { width: 250, height: 1200 },
  });
  assert.ok(pos.left >= 6 && pos.top >= 6, "the compatibility geometry still answers");
});

console.log(`\nnotes-calendar-ui-part (${passed} passed)`);
