"use strict";
/* OW-03: the size of the calendar. Week and Day fit the hours they show into the timeline ("Fit to the pane", the
 * default: no scrollbar), Month fits its six weeks into the pane, and a slider under the Size button sets a fixed
 * height instead. It replaces the three steps Comfortable / Compact / Extra compact (the two lists keep them).
 *
 * Part 1: the pure rules in the calendar module (the stored setting and what the three old steps become, the fitted
 *         hour, the smallest box, where a timeline that scrolls opens, how many items a Month cell holds).
 * Part 2: the real sheet in the fake DOM. The fake DOM has no layout: the test gives the elements the sheet measures
 *         (the timeline, the Month grid, a date, an item) the heights they would have, and reads what is drawn from the
 *         inline styles and from the declarations that win in the style sheet. That no scrollbar appears in a real
 *         layout is measured in a headless Chromium by tools/audit-notes-calendar-fit.cjs (it needs a browser, so it
 *         is not part of the suite): text sizes 8-28 px, sheets 330-1000 px high, both layouts of the panes. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok - " + name); }
const AUTO = { month: "auto", week: "auto", day: "auto", upcoming: "auto", agenda: "auto" };

(async () => {
  // =====================================================================================================================
  // 1. The setting
  // =====================================================================================================================
  await test("the setting: every view fits by default; a number is whole px inside the limits of its view", () => {
    assert.deepEqual(C.CALENDAR_SCALE_VIEWS, ["month", "week", "day", "upcoming", "agenda"]);
    assert.deepEqual(C.cleanCalendarScale(undefined), AUTO);
    assert.deepEqual(C.cleanCalendarScale(null), AUTO);
    assert.deepEqual(C.cleanCalendarScale("big"), AUTO);
    assert.deepEqual(C.cleanCalendarScale([40, 40]), AUTO, "a list is not a setting");
    assert.deepEqual(C.cleanCalendarScale({}), AUTO);
    assert.deepEqual(C.cleanCalendarScale({ week: 40 }), { ...AUTO, week: 40 }, "a view that is not named fits");
    assert.deepEqual(C.cleanCalendarScale({ month: 70, week: 40, day: 64, upcoming: 44, agenda: 36 }), { month: 70, week: 40, day: 64, upcoming: 44, agenda: 36 });
    assert.deepEqual(C.cleanCalendarScale({ week: "40", day: 40.6, month: " 61 " }), { ...AUTO, week: 40, day: 41, month: 61 }, "text from a slider and fractions become whole px");
    assert.deepEqual(C.cleanCalendarScale({ week: 3, day: 5000, month: 10 }), { ...AUTO, week: 16, day: 120, month: 44 }, "too small and too large are brought to the limit");
    assert.deepEqual(C.cleanCalendarScale({ month: 999 }), { ...AUTO, month: 160 });
    for (const bad of [NaN, Infinity, -Infinity, "", "  ", "x", null, undefined, true, false, {}, [], () => 40])
      assert.deepEqual(C.cleanCalendarScale({ week: bad, month: bad }), AUTO, "fits for " + String(typeof bad === "function" ? "a function" : JSON.stringify(bad)));
    assert.deepEqual(C.cleanCalendarScale({ week: 0, day: -20 }), { ...AUTO, week: 16, day: 16 }, "zero and negative numbers are numbers: the smallest size");
    assert.deepEqual(C.cleanCalendarScale({ year: 40, week: 40 }), { ...AUTO, week: 40 }, "a view that does not exist is dropped");
    assert.equal(Object.isFrozen(C.CALENDAR_SCALE_VIEWS), true);
    assert.equal(Object.isFrozen(C.CALENDAR_SCALE_LIMITS), true);
    assert.equal(Object.isFrozen(C.CALENDAR_SCALE_LIMITS.week), true);
    assert.deepEqual([C.CALENDAR_SCALE_LIMITS.week.min, C.CALENDAR_SCALE_LIMITS.week.max, C.CALENDAR_SCALE_LIMITS.day.min, C.CALENDAR_SCALE_LIMITS.day.max], [16, 120, 16, 120]);
    assert.deepEqual([C.CALENDAR_SCALE_LIMITS.month.min, C.CALENDAR_SCALE_LIMITS.month.max], [44, 160]);
    const stored = { week: 40 };
    const cleaned = C.cleanCalendarScale(stored);
    cleaned.week = 99;
    assert.deepEqual(stored, { week: 40 }, "the stored object is never changed");
    assert.equal(C.cleanCalendarScaleValue("week", 40), 40);
    assert.equal(C.cleanCalendarScaleValue("week", "auto"), "auto");
    assert.equal(C.cleanCalendarScaleValue("nonsense", 40), "auto", "an unknown view has no size");
  });

  await test("the setting: a list has three sizes only (fit = Comfortable, 44 = Compact, 36 = Extra compact)", () => {
    for (const view of ["upcoming", "agenda"]) {
      assert.equal(C.cleanCalendarScaleValue(view, "auto"), "auto");
      assert.equal(C.cleanCalendarScaleValue(view, 54), "auto", "the comfortable size is the default, stored as such");
      assert.equal(C.cleanCalendarScaleValue(view, 200), "auto");
      assert.equal(C.cleanCalendarScaleValue(view, 49), "auto");
      assert.equal(C.cleanCalendarScaleValue(view, 48), 44);
      assert.equal(C.cleanCalendarScaleValue(view, 44), 44);
      assert.equal(C.cleanCalendarScaleValue(view, 40), 44);
      assert.equal(C.cleanCalendarScaleValue(view, 39), 36);
      assert.equal(C.cleanCalendarScaleValue(view, 36), 36);
      assert.equal(C.cleanCalendarScaleValue(view, 1), 36);
    }
  });

  await test("the three old steps: Comfortable becomes Fit, Compact and Extra compact keep their sizes in every view", () => {
    // `calendarDensity` was one setting for all views. It is read only while no `calendarScale` is stored.
    assert.deepEqual(C.cleanCalendarScale(undefined, "comfortable"), AUTO, "the default nobody chose becomes the new default");
    assert.deepEqual(C.cleanCalendarScale(undefined, "compact"), { month: 52, week: 44, day: 44, upcoming: 44, agenda: 44 });
    assert.deepEqual(C.cleanCalendarScale(undefined, "extra-compact"), { month: 44, week: 36, day: 36, upcoming: 36, agenda: 36 });
    assert.deepEqual(C.cleanCalendarScale(null, "extra-compact"), { month: 44, week: 36, day: 36, upcoming: 36, agenda: 36 });
    assert.deepEqual(C.cleanCalendarScale(undefined, "gigantic"), AUTO);
    assert.deepEqual(C.cleanCalendarScale(undefined, undefined), AUTO);
    assert.deepEqual(C.cleanCalendarScale({ week: 60 }, "extra-compact"), { ...AUTO, week: 60 }, "a stored size wins: the old step is not read again");
    assert.deepEqual(C.cleanCalendarScale({}, "extra-compact"), AUTO, "also when every view fits");
    assert.equal(C.cleanCalendarDensity("compact"), "compact", "the old step stays readable");
    assert.equal(C.cleanCalendarDensity("gigantic"), "comfortable");
  });

  await test("the look that goes with a size: the spacing of Comfortable, Compact or Extra compact", () => {
    // The style sheet has three sets of paddings and text sizes. A size picks one of them.
    for (const view of ["week", "day"]) {
      assert.equal(C.calendarScaleDensity(view, "auto"), "comfortable");
      assert.equal(C.calendarScaleDensity(view, 120), "comfortable");
      assert.equal(C.calendarScaleDensity(view, 54), "comfortable");
      assert.equal(C.calendarScaleDensity(view, 53), "compact");
      assert.equal(C.calendarScaleDensity(view, 44), "compact");
      assert.equal(C.calendarScaleDensity(view, 43), "extra-compact");
      assert.equal(C.calendarScaleDensity(view, 36), "extra-compact");
      assert.equal(C.calendarScaleDensity(view, 16), "extra-compact");
    }
    for (const view of ["upcoming", "agenda"]) {
      assert.equal(C.calendarScaleDensity(view, "auto"), "comfortable");
      assert.equal(C.calendarScaleDensity(view, 44), "compact");
      assert.equal(C.calendarScaleDensity(view, 36), "extra-compact");
      assert.equal(C.calendarScaleDensity(view, 53), "comfortable", "a list knows the three steps only: 53 is the comfortable one");
    }
    assert.equal(C.calendarScaleDensity("year", 20), "comfortable", "an unknown view");
    // A fitted Week is drawn as Comfortable however dense it is: the header would change its height with the look,
    // and the hour is fitted to what the header leaves.
    assert.equal(C.calendarScaleDensity("week", "auto", 20), "comfortable");
    // Month: the look follows the height of a week, chosen or fitted.
    assert.equal(C.calendarScaleDensity("month", 160), "comfortable");
    assert.equal(C.calendarScaleDensity("month", 58), "comfortable");
    assert.equal(C.calendarScaleDensity("month", 57), "compact");
    assert.equal(C.calendarScaleDensity("month", 52), "compact");
    assert.equal(C.calendarScaleDensity("month", 51), "extra-compact");
    assert.equal(C.calendarScaleDensity("month", 44), "extra-compact");
    assert.equal(C.calendarScaleDensity("month", "auto"), "comfortable", "nothing measured yet");
    assert.equal(C.calendarScaleDensity("month", "auto", 90.5), "comfortable");
    assert.equal(C.calendarScaleDensity("month", "auto", 57.9), "compact");
    assert.equal(C.calendarScaleDensity("month", "auto", 51.9), "extra-compact");
    assert.equal(C.calendarScaleDensity("month", "auto", NaN), "comfortable");
    assert.equal(C.calendarScaleDensity("month", "auto", 0), "comfortable", "a pane that is not laid out has no height");
    // What the three names stand for where they are offered (the two lists, and Month drawn as a list in a narrow pane).
    assert.deepEqual(["comfortable", "compact", "extra-compact"].map((name) => C.calendarScaleStep("upcoming", name)), ["auto", 44, 36]);
    assert.deepEqual(["comfortable", "compact", "extra-compact"].map((name) => C.calendarScaleStep("agenda", name)), ["auto", 44, 36]);
    assert.deepEqual(["comfortable", "compact", "extra-compact"].map((name) => C.calendarScaleStep("month", name)), ["auto", 52, 44]);
    assert.deepEqual(["comfortable", "compact", "extra-compact"].map((name) => C.calendarScaleStep("week", name)), ["auto", 44, 36]);
    for (const view of C.CALENDAR_SCALE_VIEWS) for (const name of ["comfortable", "compact", "extra-compact"])
      assert.equal(C.calendarScaleDensity(view, C.calendarScaleStep(view, name)), name, view + " " + name + " looks like its name");
    assert.equal(C.calendarScaleStep("week", "gigantic"), "auto");
  });

  // =====================================================================================================================
  // 2. The fitted hour
  // =====================================================================================================================
  await test("the fitted hour: the hours fill the timeline, in quarter px, and never reach past it", () => {
    assert.equal(C.fitHourHeight(648, 12), 54);
    assert.equal(C.fitHourHeight(650, 12), 54, "54.17 goes down to 54");
    assert.equal(C.fitHourHeight(498, 24), 20.75);
    assert.equal(C.fitHourHeight(499, 24), 20.75);
    assert.equal(C.fitHourHeight(504, 24), 21);
    assert.equal(C.fitHourHeight(495, 12), 41.25);
    assert.equal(C.fitHourHeight(700, 13), 53.75);
    for (let hours = 1; hours <= 24; hours++) for (let room = hours * 18; room <= 1400; room += 7) {
      const px = C.fitHourHeight(room, hours);
      if (px >= 240) continue; // the largest hour: see below
      assert.ok(px * hours <= room, `${hours} hours of ${px} px fit into ${room} px`);
      assert.ok(room - px * hours < hours * 0.25 + 1e-9, `${hours} hours in ${room} px leave less than a quarter px an hour`);
      assert.equal((px * 4) % 1, 0, "quarter px");
    }
  });

  await test("the fitted hour: not under a height that can be read (then the timeline scrolls), not over 240 px", () => {
    assert.equal(C.fitHourHeight(300, 24), 18, "12.5 px an hour cannot be read: 18, and the timeline scrolls");
    assert.equal(C.fitHourHeight(431, 24), 18);
    assert.equal(C.fitHourHeight(432, 24), 18);
    assert.equal(C.fitHourHeight(438, 24), 18.25);
    assert.equal(C.fitHourHeight(7, 12), 18, "a timeline of a few px");
    assert.equal(C.fitHourHeight(300, 24, { minPx: 28 }), 28, "a larger text size has a larger smallest hour");
    assert.equal(C.fitHourHeight(700, 24, { minPx: 28 }), 29);
    assert.equal(C.fitHourHeight(300, 24, { minPx: NaN }), 18);
    assert.equal(C.fitHourHeight(300, 24, { minPx: -5 }), 18);
    assert.equal(C.fitHourHeight(2000, 2), 240);
    assert.equal(C.fitHourHeight(480, 2), 240);
    assert.equal(C.fitHourHeight(478, 2), 239);
    // The smallest hour follows the text size of the calendar: about one and a half lines of that text.
    assert.equal(C.fitMinHourPx(13), 18);
    assert.equal(C.fitMinHourPx(14), 20);
    assert.equal(C.fitMinHourPx(20), 28);
    assert.equal(C.fitMinHourPx(40), 56);
    assert.equal(C.fitMinHourPx(8), 16, "never under the smallest size the slider offers");
    for (const bad of [NaN, 0, -3, undefined, null, "", "13px"]) assert.equal(C.fitMinHourPx(bad), 18, "the usual text size for " + String(bad));
  });

  await test("the fitted hour: where nothing can be measured an hour is 54 px", () => {
    // A pane that is hidden, or a test without a layout: the comfortable hour of before.
    for (const room of [0, -10, NaN, undefined, null, "", "tall", Infinity]) assert.equal(C.fitHourHeight(room, 12), 54, "room " + String(room));
    for (const hours of [0, -1, NaN, undefined, null]) assert.equal(C.fitHourHeight(600, hours), 54, "hours " + String(hours));
  });

  // =====================================================================================================================
  // 3. The smallest box of an item
  // =====================================================================================================================
  await test("the smallest box: 20 px down to 36 px an hour, then smaller with the hour, never under 11 px", () => {
    for (const hour of [240, 120, 54, 44, 36]) assert.equal(C.calendarMinBoxPx(hour), 20, hour + " px an hour");
    assert.equal(C.calendarMinBoxPx(27), 15);
    assert.equal(C.calendarMinBoxPx(18), 11);
    assert.equal(C.calendarMinBoxPx(16), 11);
    assert.ok(Math.abs(C.calendarMinBoxPx(21) - 11.67) < 0.01);
    for (const bad of [0, -4, NaN, undefined, null, "x"]) assert.equal(C.calendarMinBoxPx(bad), 20);
    // What it is for. Half-hour events one after another must not be pushed side by side by their boxes: the box of
    // the first may reach over the second by a fifth of its height at most (4 px of 20), at every hour height the
    // fit can produce (18 px an hour and more).
    for (let hour = 18; hour <= 240; hour += 0.25) {
      const box = C.calendarMinBoxPx(hour), halfHour = hour / 2;
      assert.ok(Math.max(box, halfHour) - halfHour <= box / 5 + 1e-9, `at ${hour} px an hour a half-hour event (${halfHour} px, box ${box} px) leaves room for the next one`);
    }
    // And a box is never taller than an hour, so events of one hour in a row never stand side by side.
    for (let hour = 16; hour <= 240; hour += 0.25) assert.ok(C.calendarMinBoxPx(hour) <= hour, `at ${hour} px an hour`);
  });

  // =====================================================================================================================
  // 4. Where a timeline that scrolls opens
  // =====================================================================================================================
  await test("a timeline that scrolls opens an hour before the current time, or at the first thing of the day", () => {
    const DAY = { startMin: 0, endMin: 1440 };
    // Today is in view: the hour before now, from a whole hour.
    assert.equal(C.gridOpenMinute(DAY, { nowMin: 16 * 60 + 42, workStartMin: 540, firstMin: 420 }), 15 * 60);
    assert.equal(C.gridOpenMinute(DAY, { nowMin: 16 * 60, workStartMin: 540 }), 15 * 60);
    assert.equal(C.gridOpenMinute(DAY, { nowMin: 20 }), 0, "just after midnight: the top");
    assert.equal(C.gridOpenMinute(DAY, { nowMin: 59 }), 0);
    assert.equal(C.gridOpenMinute(DAY, { nowMin: 60 }), 0);
    assert.equal(C.gridOpenMinute(DAY, { nowMin: 23 * 60 + 59 }), 22 * 60);
    // Today is not in view: where the working day begins, or earlier when something lies before it.
    assert.equal(C.gridOpenMinute(DAY, { workStartMin: 540, firstMin: 10 * 60 + 15 }), 540);
    assert.equal(C.gridOpenMinute(DAY, { workStartMin: 540, firstMin: 7 * 60 + 30 }), 7 * 60, "an item at 07:30: from 07:00");
    assert.equal(C.gridOpenMinute(DAY, { workStartMin: 540 }), 540);
    assert.equal(C.gridOpenMinute(DAY, { workStartMin: 8 * 60 + 30 }), 8 * 60, "working hours from 08:30: from 08:00");
    assert.equal(C.gridOpenMinute(DAY, { firstMin: 13 * 60 + 5 }), 13 * 60);
    assert.equal(C.gridOpenMinute(DAY, {}), 0);
    assert.equal(C.gridOpenMinute(DAY), 0);
    assert.equal(C.gridOpenMinute(DAY, { nowMin: NaN, workStartMin: NaN, firstMin: NaN }), 0);
    // A grid held to some hours: never before its first hour, and a time outside it does not count.
    const HELD = { startMin: 480, endMin: 1200 };
    assert.equal(C.gridOpenMinute(HELD, { nowMin: 8 * 60 + 10, workStartMin: 540 }), 480, "the hour before 08:10 is not in the grid: its top");
    assert.equal(C.gridOpenMinute(HELD, { nowMin: 5 * 60, workStartMin: 540, firstMin: 11 * 60 }), 540, "05:00 is not in the grid: as on a day without a current time");
    assert.equal(C.gridOpenMinute(HELD, { nowMin: 22 * 60, workStartMin: 540 }), 540);
    assert.equal(C.gridOpenMinute(HELD, { workStartMin: 6 * 60 }), 480, "working hours that begin before the grid");
    assert.equal(C.gridOpenMinute(HELD, { nowMin: 20 * 60 }), 19 * 60, "the last minute of the grid is in it");
    assert.equal(C.gridOpenMinute(null, { nowMin: 16 * 60 + 42 }), 15 * 60, "no range: the whole day");
  });

  // =====================================================================================================================
  // 5. How many items a Month cell holds
  // =====================================================================================================================
  await test("a Month cell: as many lines as the height of the week holds", () => {
    // 2 px of border, the padding above and below, the date, then lines of one item each with a gap between them.
    const usual = { pad: 3, datePx: 15, markPx: 12.5, gap: 2 };
    assert.equal(C.monthCellLines(58, usual), 2);
    assert.equal(C.monthCellLines(64, usual), 2);
    assert.equal(C.monthCellLines(66, usual), 2, "three lines need 66.5 px");
    assert.equal(C.monthCellLines(67, usual), 3);
    assert.equal(C.monthCellLines(80, usual), 3);
    assert.equal(C.monthCellLines(100, usual), 5);
    assert.equal(C.monthCellLines(160, usual), 9);
    assert.equal(C.monthCellLines(44, { pad: 2, datePx: 14.5, markPx: 12, gap: 2 }), 1);
    assert.equal(C.monthCellLines(30, usual), 1, "there is always one line");
    assert.equal(C.monthCellLines(58, { datePx: 15, markPx: 12.5 }), 2, "the usual padding and gap when they are not given");
    for (const unmeasured of [undefined, null, {}, { datePx: 15 }, { markPx: 12 }, { datePx: 0, markPx: 12 }, { datePx: 15, markPx: NaN }])
      assert.equal(C.monthCellLines(58, unmeasured), null, "nothing measured: " + JSON.stringify(unmeasured));
    for (const row of [0, -5, NaN, undefined, null]) assert.equal(C.monthCellLines(row, usual), null, "no height: " + String(row));
  });

  await test("a Month cell: all items when they fit, else one line less and the number of the others", () => {
    assert.deepEqual(C.monthCellPlan(0, 3, false), { marks: 0, more: 0, label: false });
    assert.deepEqual(C.monthCellPlan(1, 3, false), { marks: 1, more: 0, label: false });
    assert.deepEqual(C.monthCellPlan(3, 3, false), { marks: 3, more: 0, label: false }, "three items in three lines: no \"+1 more\" in place of the third");
    assert.deepEqual(C.monthCellPlan(4, 3, false), { marks: 2, more: 2, label: false });
    assert.deepEqual(C.monthCellPlan(9, 3, false), { marks: 2, more: 7, label: false });
    assert.deepEqual(C.monthCellPlan(2, 1, false), { marks: 0, more: 2, label: false }, "one line and two items: the line says how many");
    assert.deepEqual(C.monthCellPlan(1, 1, false), { marks: 1, more: 0, label: false });
    // "All day" is a line of its own. It is shown where a line is left over; an item is never given up for it.
    assert.deepEqual(C.monthCellPlan(1, 3, true), { marks: 1, more: 0, label: true });
    assert.deepEqual(C.monthCellPlan(2, 3, true), { marks: 2, more: 0, label: true });
    assert.deepEqual(C.monthCellPlan(3, 3, true), { marks: 3, more: 0, label: false });
    assert.deepEqual(C.monthCellPlan(5, 3, true), { marks: 2, more: 3, label: false });
    assert.deepEqual(C.monthCellPlan(0, 3, true), { marks: 0, more: 0, label: true });
    // Nothing measured (a hidden pane, a test without a layout): two items and the number of the others, as before.
    assert.deepEqual(C.monthCellPlan(1, null, false), { marks: 1, more: 0, label: false });
    assert.deepEqual(C.monthCellPlan(2, null, true), { marks: 2, more: 0, label: true });
    assert.deepEqual(C.monthCellPlan(5, null, true), { marks: 2, more: 3, label: true });
    for (const bad of [undefined, NaN, 0, -1]) assert.deepEqual(C.monthCellPlan(5, bad, false), { marks: 2, more: 3, label: false }, "lines " + String(bad));
    assert.deepEqual(C.monthCellPlan(-3, 3, false), { marks: 0, more: 0, label: false });
    assert.deepEqual(C.monthCellPlan(NaN, 3, false), { marks: 0, more: 0, label: false });
    for (let lines = 1; lines <= 9; lines++) for (let count = 0; count <= 20; count++) for (const allDay of [false, true]) {
      const plan = C.monthCellPlan(count, lines, allDay);
      assert.equal(plan.marks + plan.more, count, "every item is shown or counted");
      assert.ok(plan.marks + (plan.more ? 1 : 0) + (plan.label ? 1 : 0) <= lines, `${count} items in ${lines} lines use no more than ${lines}`);
    }
  });

  // =====================================================================================================================
  // 2. The sheet
  // =====================================================================================================================
  // Wednesday 18 November 2026, 10:30 on the computer's clock; the week in view is Monday 16 to Sunday 22.
  const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  const dom = require("./helpers/fake-dom.cjs")();
  const { El, Ev, document, raf } = dom;
  // What a layout engine would report for the elements the sheet measures. `timeline`: the height of the timeline of
  // Week and Day; `grid`: that of the Month grid; `font`: the text size of the calendar; `date`, `mark`, `pad`: the
  // height of a date and of an item in a Month cell and the padding of the cell; `lines`: what an event needs for
  // its time above its title. 0 = not laid out, which is all the fake DOM says by itself.
  const box = { timeline: 0, grid: 0, font: 13, date: 18, mark: 13, pad: 3, lines: 22 };
  const has = (el, name) => el._classes.has(name);
  const measured = (name, read) => Object.defineProperty(El.prototype, name, { configurable: true, get() { return read(this) || undefined; } });
  measured("clientHeight", (el) => (has(el, "zn-cal-time-scroll") ? box.timeline : has(el, "zn-cal-month-grid") ? box.grid : 0));
  // What is in the timeline: the 2 px above the first hour and the hours.
  measured("scrollHeight", (el) => { const track = has(el, "zn-cal-time-scroll") ? el.querySelector(".zn-cal-time-track") : null; return track ? parseFloat(track.style.height) + 2 : 0; });
  measured("offsetHeight", (el) => (has(el, "zn-cal-month-date") ? box.date : has(el, "zn-cal-month-mark") ? box.mark : has(el, "zn-cal-time-event") ? box.lines : 0));
  measured("offsetTop", (el) => (has(el, "zn-cal-month-date") ? box.pad : 0));
  const observers = [], windowListeners = [];
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(el) { this.targets.add(el); } unobserve(el) { this.targets.delete(el); } disconnect() { this.targets.clear(); }
  }
  const win = { __zentralNotesParts: { "notes-calendar": C }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800,
    addEventListener(type, fn) { windowListeners.push({ type, fn }); },
    removeEventListener(type, fn) { const at = windowListeners.findIndex((l) => l.type === type && l.fn === fn); if (at >= 0) windowListeners.splice(at, 1); },
    ResizeObserver,
    getComputedStyle: () => new Proxy({}, { get: (_, key) => (key === "fontSize" ? box.font + "px" : key === "getPropertyValue" ? () => "" : "") }) };
  win.window = win;
  vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" } });
  const core = win.__zentralNotesTestSeam.core;
  const flushRaf = async () => { for (let i = 0; i < 5; i++) { raf.splice(0).forEach((fn) => fn()); await new Promise((r) => setImmediate(r)); } };
  const files = new Map();
  const io = {
    join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf " + p); return files.get(p).text; },
    writeUTF8: async (p, text) => files.set(p, { text, mtime: Date.now() }),
    remove: async (p) => files.delete(p), exists: async (p) => files.has(p),
    children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/")),
    stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }), restrict: async () => {},
  };
  const local = (dateKey, h, m = 0) => { const d = C.parseYmd(dateKey); d.setHours(h, m, 0, 0); return d.getTime(); };
  const MON = "2026-11-16", WED = "2026-11-18", THU = "2026-11-19", FRI = "2026-11-20";
  const clock = local(WED, 10, 30);
  let stamp = clock; // the store's clock: it only moves forward, so a later write is always the newer one
  const makeStore = (dir, id) => core.createStore({ io, notify() {}, windowId: id, now: () => stamp, getDir: async () => dir, getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  // The store lives in another realm (vm): its objects are compared as plain data.
  const plain = (value) => JSON.parse(JSON.stringify(value));

  await test("a stored Compact or Extra compact becomes the sizes it stood for, once; Comfortable becomes Fit", async () => {
    const opened = async (dir, raw) => { if (raw) files.set(dir + "/meta.json", { text: JSON.stringify(raw), mtime: 1 }); const s = makeStore(dir, "scale-" + dir.slice(1)); await s.open(); return s; };
    assert.deepEqual(plain((await opened("/fresh", null)).meta.calendarScale), AUTO, "a new profile fits");
    assert.deepEqual(plain((await opened("/was-comfortable", { calendarDensity: "comfortable" })).meta.calendarScale), AUTO);
    assert.deepEqual(plain((await opened("/was-nonsense", { calendarDensity: "gigantic" })).meta.calendarScale), AUTO);
    const compact = await opened("/was-compact", { calendarDensity: "compact", calendarView: "week" });
    assert.deepEqual(plain(compact.meta.calendarScale), { month: 52, week: 44, day: 44, upcoming: 44, agenda: 44 });
    assert.equal("calendarDensity" in compact.meta, false, "the old setting is not carried along");
    const extra = await opened("/was-extra", { calendarDensity: "extra-compact" });
    assert.deepEqual(plain(extra.meta.calendarScale), { month: 44, week: 36, day: 36, upcoming: 36, agenda: 36 });
    // Once: from the first save on the sizes are stored, and a size chosen later is not overwritten by the old step.
    extra.setMeta({ calendarScale: { ...plain(extra.meta.calendarScale), week: "auto", month: 90 } });
    await extra.flush(); await extra.close();
    // ST7.3: the sizes are view state, so they are stored in ui.json now, not in meta.json.
    const text = files.get("/was-extra/ui.json").text;
    assert.match(text, /"calendarScale"/);
    const again = makeStore("/was-extra", "scale-was-extra"); await again.open();
    assert.deepEqual(plain(again.meta.calendarScale), { month: 90, week: "auto", day: 36, upcoming: 36, agenda: 36 });
    // A file that has both (written by this version, read again): the sizes count.
    const both = await opened("/has-both", { calendarDensity: "extra-compact", calendarScale: { week: 70 } });
    assert.deepEqual(plain(both.meta.calendarScale), { ...AUTO, week: 70 });
    // Nonsense in a stored size is replaced view by view.
    const broken = await opened("/broken", { calendarScale: { week: "huge", day: 9999, month: -4, upcoming: 40, agenda: null } });
    assert.deepEqual(plain(broken.meta.calendarScale), { month: 44, week: "auto", day: 120, upcoming: 44, agenda: "auto" });
    for (const s of [compact, again, both, broken]) await s.close();
  });

  const store = makeStore("/scale", "scale-a");
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (el) => host.append(el), getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const prefs = new Map();
  const env = { now: () => clock, getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), setPref: (k, v) => prefs.set(k, v), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
  await store.open();
  store.create("# A note\n\nText");
  const put = (id, summary, start, end) => { stamp += 1000; return store.items.upsert({ id, summary, start: { dateTime: new Date(start).toISOString() }, ...(end ? { end: { dateTime: new Date(end).toISOString() } } : {}), x: { kind: end ? "event" : "reminder", src: "manual" } }); };
  const putAllDay = (id, summary, key) => { stamp += 1000; return store.items.upsert({ id, summary, start: { date: key }, end: { date: C.ymd(new Date(C.addDays(C.parseYmd(key).getTime(), 1))) }, x: { kind: "event", src: "manual" } }); };
  const drop = (id) => { stamp += 1000; store.items.remove(id); };
  put("standup", "Standup", local(MON, 10), local(MON, 11));
  put("lunch", "Lunch", local(WED, 12), local(WED, 13));
  put("ping", "Ping Alice", local(WED, 15, 30));
  await store.flush();
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root; root.ownerDocument = document;
  const q = (selector) => root.querySelector(selector);
  const qa = (selector) => root.querySelectorAll(selector);
  const layoutBox = q(".zn-all-layout"), calendarPane = q(".zn-calendar-pane");
  layoutBox.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  q(".zn-all-panels").getBoundingClientRect = layoutBox.getBoundingClientRect;
  let paneWidth = 700, paneHeight = 700;
  calendarPane.getBoundingClientRect = () => ({ left: 400, top: 0, right: 400 + paneWidth, bottom: paneHeight, width: paneWidth, height: paneHeight });
  await sheet.open(); await flushRaf();
  root.all().find((el) => el.title === "All notes").click(); await flushRaf();

  const content = q(".zn-calendar-view"), chip = q(".zn-calendar-size-select");
  const pick = async (trigger, label) => {
    q(trigger).click();
    const entry = qa(".zn-menu-item").find((el) => el.textContent.trim() === label);
    assert.ok(entry, "the menu offers " + label + "; it has: " + qa(".zn-menu-item").map((el) => el.textContent.trim()).join(" | "));
    entry.click();
    await flushRaf();
  };
  const showView = (name) => pick(".zn-calendar-view-select", name);
  // The pane got another size: what the window and the size observers of the sheet report.
  const resized = async () => {
    for (const l of [...windowListeners]) if (l.type === "resize") l.fn(new Ev("resize"));
    for (const o of observers) if (o.targets.size) o.callback([...o.targets].map((target) => ({ target })));
    await flushRaf();
  };
  const timeline = () => q(".zn-cal-time-scroll");
  const track = () => q(".zn-cal-time-track");
  const trackPx = () => parseFloat(track().style.height);
  const hourVar = () => content.style.getPropertyValue("--zn-cal-hour-height");
  const fitted = (px, hours = 24) => Math.floor((px - 3) / hours * 4) / 4;
  const eventBox = (text) => { const el = qa(".zn-cal-item").find((b) => (b.classList.contains("zn-cal-time-event") || b.classList.contains("zn-cal-time-reminder")) && b.textContent.includes(text)); assert.ok(el, "a box for " + text); return el; };
  // The Size menu of Week, Day and the Month grid.
  const openSize = () => { chip.click(); const menu = q(".zn-menu"); assert.ok(menu?.querySelector(".zn-menu-slider"), "the Size menu has a slider"); return { menu, input: menu.querySelector("input"), value: menu.querySelector(".zn-quick-value"), fit: menu.querySelector(".zn-menu-slider-fit") }; };
  const slide = async (input, px) => { input.value = String(px); input.dispatchEvent(new Ev("input", { bubbles: true })); await flushRaf(); };
  const closeSize = async () => { chip.click(); assert.equal(q(".zn-menu"), null, "a second press closes the menu"); await flushRaf(); };
  const cellOf = (key) => qa(".zn-cal-month-cell").find((cell) => cell.getAttribute("data-day") === key);
  const cellLines = (key) => { const cell = cellOf(key); return [...(cell.querySelector(".zn-cal-month-allday") ? ["All day"] : []), ...cell.querySelector(".zn-cal-month-items").children.map((el) => el.textContent)]; };

  await test("the three-step selector is gone; one Size button is in its place and says what is set", async () => {
    assert.equal(q(".zn-calendar-density-select"), null);
    assert.equal(chip.textContent, "Size: Fit");
    assert.equal(chip.getAttribute("aria-haspopup"), "menu");
    assert.deepEqual(plain(store.meta.calendarScale), AUTO);
    assert.equal(content.dataset.fit, "true");
  });

  await test("Fit (the default): the hours fill the timeline at every height, and there is nothing to scroll", async () => {
    for (const view of ["Week", "Day"]) {
      box.timeline = 503;
      await showView(view);
      for (const height of [435, 436, 503, 640, 801, 1203, 2400, 9000]) {
        box.timeline = height;
        await resized();
        const hour = Math.min(240, fitted(height));
        assert.equal(trackPx(), 24 * hour, `${view} at ${height} px: an hour is ${hour} px`);
        assert.equal(hourVar(), hour + "px", "the style sheet draws the hour lines at the same height");
        assert.ok(timeline().scrollHeight <= timeline().clientHeight, `${view} at ${height} px: the hours (${timeline().scrollHeight} px with the 2 px above them) are inside the timeline`);
        assert.equal(timeline().dataset.fitted, "true");
        assert.equal(timeline().scrollTop, 0);
        if (height < 2400) assert.ok(height - timeline().scrollHeight < 7, "and no more than 6 px stay empty below them");
        assert.equal(qa(".zn-cal-hour-label").length, 24);
        assert.equal(chip.textContent, "Size: Fit");
        assert.equal(content.dataset.density, "comfortable", "the header keeps its look whatever the hour is");
        assert.equal(content.dataset.fit, "true");
      }
    }
    // Fewer hours shown (08:00-20:00): each gets more.
    box.timeline = 503;
    await showView("Week");
    q(".zn-calendar-hours-toggle").click(); await flushRaf();
    assert.equal(qa(".zn-cal-hour-label").length, 12);
    for (const height of [221, 435, 503, 801]) {
      box.timeline = height;
      await resized();
      assert.equal(trackPx(), 12 * fitted(height, 12), `twelve hours at ${height} px`);
      assert.ok(timeline().scrollHeight <= timeline().clientHeight);
      assert.equal(timeline().dataset.fitted, "true");
    }
    // An item outside them widens the grid by whole hours: the hours that are drawn share the timeline.
    put("early", "Early call", local(THU, 6, 15), local(THU, 7));
    await flushRaf();
    assert.equal(qa(".zn-cal-hour-label").length, 14, "06:00-20:00");
    assert.equal(trackPx(), 14 * fitted(801, 14));
    assert.ok(timeline().scrollHeight <= timeline().clientHeight);
    drop("early"); await flushRaf();
    assert.equal(trackPx(), 12 * fitted(801, 12));
    q(".zn-calendar-hours-toggle").click(); await flushRaf();
    assert.equal(trackPx(), 24 * fitted(801));
  });

  await test("a pane too low for hours that can be read: the smallest such hour, a scrollbar, opened an hour before the current time", async () => {
    await showView("Month");
    box.timeline = 300;
    await showView("Week");
    assert.equal(trackPx(), 24 * 18, "18 px an hour at the usual text size, not 12.25");
    assert.equal(timeline().dataset.fitted, "false", "so the timeline scrolls");
    assert.equal(timeline().scrollTop, 9 * 18, "it is 10:30: the timeline opens at 09:00, not at midnight");
    assert.equal(chip.textContent, "Size: Fit", "the setting is still Fit");
    // Exactly at the border: 24 hours of 18 px and the 2 px above them need 434 px; the timeline is measured in
    // whole px and may be half a px lower than it says, so one px more is asked for.
    box.timeline = 434; await resized();
    assert.deepEqual([trackPx(), timeline().dataset.fitted], [432, "false"]);
    box.timeline = 435; await resized();
    assert.deepEqual([trackPx(), timeline().dataset.fitted, timeline().scrollTop], [432, "true", 0], "the same hour, and now it fits: nothing is cut off and nothing scrolls");
    box.timeline = 434; await resized();
    assert.deepEqual([trackPx(), timeline().dataset.fitted], [432, "false"], "and back: the last hours are not cut off without a scrollbar");
    // A larger text needs a higher hour (1.4 of the text size).
    box.font = 20; box.timeline = 600; await resized();
    assert.equal(trackPx(), 24 * 28);
    assert.equal(timeline().dataset.fitted, "false");
    box.timeline = 24 * 28 + 3; await resized();
    assert.deepEqual([trackPx(), timeline().dataset.fitted], [24 * 28, "true"]);
    box.font = 8; box.timeline = 24 * 16 + 3; await resized();
    assert.deepEqual([trackPx(), timeline().dataset.fitted], [24 * 16, "true"], "never under 16 px, however small the text");
    box.timeline = 300; await resized();
    assert.equal(trackPx(), 24 * 16);
    box.font = 13;
    // A week without today opens where the working day begins, or at the first item when that is earlier.
    await showView("Month");
    store.setMeta({ calendarCursor: "2026-11-25" });
    await showView("Week");
    assert.equal(timeline().scrollTop, C.DEFAULT_WORK.startMin / 60 * 18, "09:00, where the working day begins");
    put("dawn", "Dawn run", local("2026-11-24", 6, 40), local("2026-11-24", 7, 30));
    await flushRaf();
    await showView("Month"); await showView("Week");
    assert.equal(timeline().scrollTop, 6 * 18, "06:00: the hour of the first item");
    drop("dawn");
    // Not measured at all (a pane that is hidden): the comfortable hour of before, as a size that scrolls.
    await showView("Month");
    box.timeline = 0;
    store.setMeta({ calendarCursor: WED });
    await showView("Week");
    assert.equal(trackPx(), 24 * 54);
    assert.equal(timeline().dataset.fitted, "false");
    box.timeline = 801; await resized();
    assert.equal(trackPx(), 24 * fitted(801), "and fitted as soon as the pane is there");
  });

  await test("a change of the pane draws Week again only when the hour comes out differently", async () => {
    box.timeline = 503;
    await showView("Day"); await showView("Week");
    const drawn = track();
    assert.equal(trackPx(), 24 * 20.75);
    await resized();
    assert.equal(track(), drawn, "a report without a change: nothing is drawn again");
    for (const height of [501, 504, 506]) { // 20.75 px an hour all the same
      box.timeline = height; await resized();
      assert.equal(track(), drawn, `${height} px gives the same hour: the grid is left alone`);
    }
    box.timeline = 507; await resized(); // 21 px
    assert.notEqual(track(), drawn, "another hour: drawn again");
    assert.equal(trackPx(), 24 * 21);
    // The text size changed: the boxes of the items are measured against it, so the grid is drawn again.
    const before = track();
    box.font = 14; await resized();
    assert.notEqual(track(), before);
    box.font = 13; await resized();
  });

  await test("an update of one day that changes the room above the timeline fits the hours again", async () => {
    box.timeline = 503;
    await showView("Day"); await showView("Week");
    assert.equal(trackPx(), 24 * 20.75);
    const friday = () => qa(".zn-cal-time-track").find((t) => t.getAttribute("data-day") === FRI);
    const other = qa(".zn-cal-time-track").find((t) => t.getAttribute("data-day") === MON);
    // A timed item: only that day is drawn again, at the hour the grid has.
    put("review", "Review", local(FRI, 9), local(FRI, 10));
    await flushRaf();
    assert.equal(qa(".zn-cal-time-track").find((t) => t.getAttribute("data-day") === MON), other, "Monday is the same element");
    assert.equal(parseFloat(eventBox("Review").style.top), 9 * 20.75);
    assert.equal(parseFloat(friday().style.height), 24 * 20.75);
    // All-day items make the row above the timeline higher: the timeline is lower by as much (here 48 px). The
    // sheet measures right after it replaced the day, so the new height is there when the item arrives.
    box.timeline = 455;
    putAllDay("fair", "Trade fair", FRI);
    await flushRaf();
    assert.equal(trackPx(), 24 * fitted(455), "18.75 px an hour: the hours fit what is left");
    assert.equal(parseFloat(eventBox("Review").style.top), 9 * 18.75);
    assert.ok(timeline().scrollHeight <= timeline().clientHeight);
    assert.equal(timeline().dataset.fitted, "true");
    assert.ok(q(".zn-cal-time-allday-cell .zn-cal-item"), "and the all-day item is in its row");
    box.timeline = 503;
    drop("fair");
    await flushRaf();
    assert.equal(trackPx(), 24 * 20.75, "and back");
    drop("review"); await flushRaf();
  });

  await test("the Size menu: a slider sets the height of an hour, for Week and Day apart; Fit to the pane takes it back", async () => {
    box.timeline = 503;
    await showView("Day"); await showView("Week");
    let { menu, input, value, fit } = openSize();
    assert.equal(menu.querySelector(".zn-menu-head").textContent, "Height of an hour");
    assert.deepEqual([input.getAttribute("type"), input.getAttribute("min"), input.getAttribute("max"), input.getAttribute("step"), input.getAttribute("aria-label")], ["range", "16", "120", "1", "Height of an hour in px"]);
    assert.equal(input.value, "21", "while the hours are fitted the slider stands at what is drawn (20.75 px)");
    assert.equal(value.textContent, "Fit · 21 px");
    assert.equal(fit.textContent, "Fit to the pane");
    assert.equal(fit.getAttribute("aria-pressed"), "true");
    assert.equal(dom.document.activeElement, input, "the keyboard is on the slider: the arrow keys change the size");
    // Every step of the slider is drawn at once, and the menu stays where it is.
    for (const px of [22, 40, 64]) {
      await slide(input, px);
      assert.equal(q(".zn-menu"), menu, "the menu stays open while the calendar is drawn again");
      assert.equal(q(".zn-menu input"), input);
      assert.equal(trackPx(), 24 * px);
      assert.equal(hourVar(), px + "px");
      assert.equal(value.textContent, px + " px");
      assert.equal(fit.getAttribute("aria-pressed"), "false");
      assert.equal(chip.textContent, `Size: ${px} px`);
      assert.equal(store.meta.calendarScale.week, px);
      assert.equal(timeline().dataset.fitted, "false", "a size that is set scrolls when it has to; nothing is hidden");
      assert.equal(content.dataset.fit, "false");
    }
    assert.equal(content.dataset.density, "comfortable", "54 px and more: the comfortable look");
    await slide(input, 50);
    assert.equal(content.dataset.density, "compact", "44 to 53 px: the compact one");
    await slide(input, 30);
    assert.equal(content.dataset.density, "extra-compact");
    // The keys Arrow up and down, Home and End belong to the slider, not to the menu.
    const key = new Ev("keydown", { bubbles: true, key: "ArrowDown" });
    input.dispatchEvent(key);
    assert.equal(key.defaultPrevented, false, "the menu leaves the arrow keys to the slider");
    assert.equal(dom.document.activeElement, input);
    // Values outside the limits (a slider cannot give them; a changed page could) are brought to the limit.
    await slide(input, 500);
    assert.equal(store.meta.calendarScale.week, 120);
    await slide(input, 1);
    assert.equal(store.meta.calendarScale.week, 16);
    assert.equal(trackPx(), 24 * 16);
    await slide(input, 40);
    await closeSize();
    assert.equal(trackPx(), 24 * 40);
    // A pane that changes does not touch a size that is set.
    const drawn = track();
    box.timeline = 900; await resized();
    assert.equal(track(), drawn);
    assert.equal(trackPx(), 24 * 40);
    box.timeline = 503; await resized();
    // Day has its own size.
    await showView("Day");
    assert.equal(chip.textContent, "Size: Fit");
    assert.equal(trackPx(), 24 * 20.75);
    ({ menu, input, value, fit } = openSize());
    await slide(input, 72);
    await closeSize();
    assert.deepEqual(plain(store.meta.calendarScale), { ...AUTO, week: 40, day: 72 });
    await showView("Week");
    assert.equal(trackPx(), 24 * 40, "Week kept its own");
    assert.equal(chip.textContent, "Size: 40 px");
    assert.match(chip.title, /40 px/);
    // Remembered: the next start of the browser reads the same sizes.
    await store.flush();
    const again = makeStore("/scale", "scale-a"); await again.open();
    assert.deepEqual(plain(again.meta.calendarScale), { ...AUTO, week: 40, day: 72 });
    await again.close();
    // Fit to the pane.
    ({ menu, input, value, fit } = openSize());
    assert.equal(input.value, "40");
    assert.equal(value.textContent, "40 px");
    fit.click(); await flushRaf();
    assert.equal(q(".zn-menu"), menu, "the menu stays: the slider can be moved again at once");
    assert.equal(store.meta.calendarScale.week, "auto");
    assert.equal(trackPx(), 24 * 20.75);
    assert.equal(timeline().dataset.fitted, "true");
    assert.equal(value.textContent, "Fit · 21 px");
    assert.equal(input.value, "21");
    assert.equal(fit.getAttribute("aria-pressed"), "true");
    assert.equal(chip.textContent, "Size: Fit");
    await closeSize();
    await showView("Day");
    ({ fit } = openSize()); fit.click(); await flushRaf(); await closeSize();
    assert.deepEqual(plain(store.meta.calendarScale), AUTO);
    await showView("Week");
  });

  await test("a size that is set keeps the time at the top when it changes; a timeline that begins to scroll opens an hour before now", async () => {
    box.timeline = 503;
    await showView("Day"); await showView("Week");
    assert.equal(timeline().scrollTop, 0);
    const { input } = openSize();
    await slide(input, 40);
    assert.equal(timeline().scrollTop, 9 * 40, "the hours were fitted and had no position: the timeline opens at 09:00 (it is 10:30)");
    timeline().scrollTop = 13 * 40 + 10; // somebody scrolled to 13:15
    await slide(input, 80);
    assert.equal(timeline().scrollTop, 13 * 80 + 20, "13:15 stays at the top, not the same number of px");
    await slide(input, 20);
    assert.equal(timeline().scrollTop, 13 * 20 + 5);
    q(".zn-menu .zn-menu-slider-fit").click(); await flushRaf();
    assert.equal(timeline().scrollTop, 0, "fitted: nothing to scroll");
    await closeSize();
  });

  await test("short items in a dense grid: half-hour events in a row keep one lane; a box too low for two lines shows the title alone", async () => {
    box.timeline = 435; // 18 px an hour
    await showView("Day"); await showView("Week");
    put("half1", "Half one", local(FRI, 9), local(FRI, 9, 30));
    put("half2", "Half two", local(FRI, 9, 30), local(FRI, 10));
    put("half3", "Half three", local(FRI, 10), local(FRI, 10, 30));
    put("two", "Two hours", local(FRI, 13), local(FRI, 15));
    put("one", "One hour", local(FRI, 16), local(FRI, 17));
    put("nudge", "Nudge", local(FRI, 18));
    await flushRaf();
    const shape = (text) => { const el = eventBox(text); return [parseFloat(el.style.top), parseFloat(el.style.height), el.style.left, el.style.width, el.classList.contains("is-short")]; };
    // The smallest box is 11 px there (not the 20 px of a roomy grid, which would be 67 minutes): the three are 9 px
    // apart, each reaches 2 px over the next, and they keep the whole width.
    assert.deepEqual(["Half one", "Half two", "Half three"].map(shape), [[162, 11, "0%", "100%", true], [171, 11, "0%", "100%", true], [180, 11, "0%", "100%", true]]);
    assert.deepEqual(shape("Two hours"), [13 * 18, 36, "0%", "100%", false], "36 px hold the time and the title");
    assert.deepEqual(shape("One hour"), [16 * 18, 18, "0%", "100%", true], "18 px do not (22 px are needed, 2 of them padding): the title alone");
    assert.deepEqual(shape("Nudge"), [18 * 18, 11, "0%", "100%", false], "a reminder is one line anyway");
    // A larger text needs more for the two lines (and a higher hour: 20 px at 14 px of text).
    box.lines = 44; box.font = 14; await resized();
    assert.equal(parseFloat(eventBox("Two hours").style.height), 40);
    assert.equal(eventBox("Two hours").classList.contains("is-short"), true, "40 px are too low for two lines that need 44");
    box.lines = 22; box.font = 13; await resized();
    assert.equal(eventBox("Two hours").classList.contains("is-short"), false);
    // A roomy grid: boxes of 20 px at least, as before.
    box.timeline = 24 * 54 + 3; await resized();
    assert.deepEqual(shape("Half one").slice(0, 2), [9 * 54, 27]);
    assert.equal(parseFloat(eventBox("Nudge").style.height), 20);
    assert.equal(eventBox("Half one").classList.contains("is-short"), false, "27 px hold both lines");
    for (const id of ["half1", "half2", "half3", "two", "one", "nudge"]) drop(id);
    await flushRaf();
  });

  await test("the two lists have nothing to fit: three spacings, each list its own", async () => {
    await showView("Next days");
    assert.equal(chip.textContent, "Comfortable");
    assert.equal(content.dataset.fit, "false");
    chip.click();
    assert.equal(q(".zn-menu .zn-menu-slider"), null, "no slider for a list");
    assert.deepEqual(qa(".zn-menu-item").map((el) => el.textContent.trim()), ["Comfortable", "Compact", "Extra compact"]);
    chip.click();
    await pick(".zn-calendar-size-select", "Extra compact");
    assert.deepEqual([chip.textContent, content.dataset.density, store.meta.calendarScale.upcoming], ["Extra compact", "extra-compact", 36]);
    await showView("Agenda");
    assert.deepEqual([chip.textContent, content.dataset.density], ["Comfortable", "comfortable"], "Agenda has its own");
    await pick(".zn-calendar-size-select", "Compact");
    assert.deepEqual([chip.textContent, content.dataset.density, store.meta.calendarScale.agenda], ["Compact", "compact", 44]);
    await showView("Next days");
    assert.equal(content.dataset.density, "extra-compact");
    await pick(".zn-calendar-size-select", "Comfortable");
    await showView("Agenda");
    await pick(".zn-calendar-size-select", "Comfortable");
    assert.deepEqual(plain(store.meta.calendarScale), AUTO);
    // A change of the pane leaves a list alone.
    const list = content.children[0];
    box.timeline = 777; await resized();
    assert.equal(content.children[0], list);
  });

  await test("Month: the six weeks share the pane; a cell shows as many items as its height holds", async () => {
    for (let i = 0; i < 5; i++) put("many" + i, "Many " + i, local("2026-11-25", 9 + i), local("2026-11-25", 10 + i));
    put("pair1", "Pair one", local("2026-11-26", 9), local("2026-11-26", 10));
    put("pair2", "Pair two", local("2026-11-26", 11), local("2026-11-26", 12));
    putAllDay("fair", "Trade fair", "2026-11-27");
    put("after", "After the fair", local("2026-11-27", 18), local("2026-11-27", 19));
    await flushRaf();
    // A week is (the grid - five gaps of 3 px) / 6; a cell has 2 px of border, 3 px of padding above and below and
    // a date of 18 px, and a line is 13 px and 2 px of gap. 363 px: weeks of 58 px, 2 lines.
    box.grid = 363;
    await showView("Month");
    const wrap = q(".zn-cal-month-wrap");
    assert.equal(content.dataset.fit, "true", "the style sheet lets the weeks fill the pane");
    assert.equal(content.style.getPropertyValue("--zn-cal-month-row"), "", "no height is set for them");
    assert.equal(chip.textContent, "Size: Fit");
    assert.equal(wrap.dataset.density, "comfortable", "weeks of 58 px: the comfortable look");
    assert.deepEqual(cellLines("2026-11-25"), ["Many 0", "+4 more"]);
    assert.deepEqual(cellLines("2026-11-26"), ["Pair one", "Pair two"], "two items in two lines: both, no \"+0 more\"");
    assert.deepEqual(cellLines("2026-11-27"), ["Trade fair", "After the fair"], "the line \"All day\" is given up before an item is");
    assert.deepEqual(cellLines(WED), ["Lunch", "Ping Alice"]);
    assert.deepEqual(cellLines(MON), ["Standup"]);
    // The pane grows: the cells are fitted where they are. Nothing is built again but the lines that change.
    const cell = cellOf("2026-11-25"), standup = cellOf(MON).querySelector(".zn-cal-month-mark");
    box.grid = 555; await resized(); // weeks of 90 px: 4 lines
    assert.equal(cellOf("2026-11-25"), cell, "the same cell");
    assert.equal(cellOf(MON).querySelector(".zn-cal-month-mark"), standup, "a cell whose lines stay is not touched");
    assert.deepEqual(cellLines("2026-11-25"), ["Many 0", "Many 1", "Many 2", "+2 more"]);
    assert.deepEqual(cellLines("2026-11-27"), ["All day", "Trade fair", "After the fair"], "with room to spare the all-day item is announced");
    box.grid = 645; await resized(); // weeks of 105 px: 5 lines
    assert.deepEqual(cellLines("2026-11-25"), ["Many 0", "Many 1", "Many 2", "Many 3", "Many 4"], "all five fit");
    // The pane shrinks: fewer lines, and a tighter look.
    box.grid = 327; await resized(); // weeks of 52 px
    assert.equal(wrap.dataset.density, "compact");
    assert.equal(content.dataset.density, "comfortable", "only the cells take the look of their height, not the list of the selected day");
    box.grid = 279; await resized(); // weeks of 44 px, the lowest the style sheet lets them get: one line
    assert.equal(wrap.dataset.density, "extra-compact");
    assert.deepEqual(cellLines("2026-11-25"), ["5 items"], "one line: how many there are");
    assert.deepEqual(cellLines("2026-11-26"), ["2 items"]);
    assert.deepEqual(cellLines(MON), ["Standup"], "one item has its line");
    assert.deepEqual(cellLines("2026-11-27"), ["2 items"]);
    // A larger text: the same height holds fewer lines, and the roomier looks need higher weeks.
    box.grid = 555; box.font = 26; box.date = 36; box.mark = 26; await resized();
    assert.equal(wrap.dataset.density, "extra-compact", "90 px at twice the text size are what 45 px are at the usual one");
    assert.deepEqual(cellLines("2026-11-25"), ["5 items"], "(90 - 2 - 6 - 36) / 28: one line");
    box.font = 13; box.date = 18; box.mark = 13; await resized();
    assert.deepEqual(cellLines("2026-11-25"), ["Many 0", "Many 1", "Many 2", "+2 more"]);
    // Nothing measured (the pane is hidden): two items and the others counted, as it always was.
    box.grid = 0;
    await showView("Week"); await showView("Month");
    assert.deepEqual(cellLines("2026-11-25"), ["Many 0", "Many 1", "+3 more"]);
    assert.deepEqual(cellLines("2026-11-27"), ["All day", "Trade fair", "After the fair"]);
    assert.equal(q(".zn-cal-month-wrap").dataset.density, "comfortable");
    box.grid = 555; await resized();
    assert.deepEqual(cellLines("2026-11-25"), ["Many 0", "Many 1", "Many 2", "+2 more"], "and measured as soon as the pane is there");
  });

  await test("Month: the slider sets the height of a week; the pane then scrolls as it always did", async () => {
    box.grid = 363;
    await showView("Week"); await showView("Month");
    let { menu, input, value, fit } = openSize();
    assert.equal(menu.querySelector(".zn-menu-head").textContent, "Height of a week");
    assert.deepEqual([input.getAttribute("min"), input.getAttribute("max"), input.getAttribute("aria-label")], ["44", "160", "Height of a week in px"]);
    assert.equal(input.value, "58", "the slider stands at the height the weeks have");
    assert.equal(value.textContent, "Fit · 58 px");
    await slide(input, 100);
    assert.equal(q(".zn-menu"), menu);
    assert.equal(store.meta.calendarScale.month, 100);
    assert.equal(content.dataset.fit, "false");
    assert.equal(content.style.getPropertyValue("--zn-cal-month-row"), "100px", "the style sheet makes the weeks 100 px high");
    assert.equal(chip.textContent, "Size: 100 px");
    assert.deepEqual(cellLines("2026-11-25"), ["Many 0", "Many 1", "Many 2", "+2 more"], "(100 - 26) / 15: four lines, whatever the pane measures");
    assert.equal(q(".zn-cal-month-wrap").dataset.density, "comfortable");
    assert.equal(content.dataset.density, "comfortable");
    await slide(input, 52);
    assert.deepEqual([q(".zn-cal-month-wrap").dataset.density, content.dataset.density], ["compact", "compact"]);
    assert.deepEqual(cellLines("2026-11-25"), ["5 items"], "(52 - 26) / 15: one line");
    await slide(input, 44);
    assert.deepEqual([q(".zn-cal-month-wrap").dataset.density, content.dataset.density], ["extra-compact", "extra-compact"]);
    await slide(input, 70);
    await closeSize();
    // The pane changes: a height that is set stays.
    box.grid = 900; await resized();
    assert.equal(content.style.getPropertyValue("--zn-cal-month-row"), "70px");
    assert.deepEqual(cellLines("2026-11-25"), ["Many 0", "+4 more"], "(70 - 26) / 15: two lines");
    // Week and Day are not touched by the size of Month, and the height does not stay behind in another view.
    await showView("Week");
    assert.equal(content.style.getPropertyValue("--zn-cal-month-row"), "");
    assert.equal(chip.textContent, "Size: Fit");
    await showView("Month");
    ({ menu, input, value, fit } = openSize());
    assert.equal(value.textContent, "70 px");
    fit.click(); await flushRaf();
    assert.equal(store.meta.calendarScale.month, "auto");
    assert.equal(content.dataset.fit, "true");
    assert.equal(content.style.getPropertyValue("--zn-cal-month-row"), "");
    await closeSize();
    for (const id of ["many0", "many1", "many2", "many3", "many4", "pair1", "pair2", "fair", "after"]) drop(id);
    await flushRaf();
  });

  const pickerCell = (key) => qa(".zn-cal-picker-day").find((button) => button.getAttribute("data-day") === key);
  await test("Month date picker: responsive widths, date-only heat cells, select-only clicks and arrow navigation", async () => {
    paneHeight = 700;
    paneWidth = 420;
    await resized();
    assert.ok(q(".zn-cal-picker-grid"), "under the default width threshold Month becomes a date picker");
    assert.equal(qa(".zn-cal-picker-day").length, 42, "six weeks of dates");
    assert.equal(q(".zn-cal-compact-list"), null, "the old item-list fallback is gone");
    const wed = C.parseYmd(WED).getTime(), expected = C.dayHeat(store.items.list(), wed);
    const hot = pickerCell(WED);
    assert.ok(hot, "the selected month has its Wednesday cell");
    assert.equal(hot.textContent, "18", "a cell shows only its date number");
    assert.ok(hot.classList.contains("is-heat-" + expected.level), "the count chooses one of four heat intensities");
    assert.match(hot.getAttribute("aria-label"), new RegExp(String(expected.count) + " items?"), "the accessible name includes the count");
    assert.equal(hot.querySelector(".zn-cal-month-items"), null, "there are no item marks inside the cell");
    assert.equal(hot.querySelector(".zn-cal-month-mark"), null, "there are no item controls inside the cell");
    assert.match(hot.getAttribute("title"), /Colour legend/);

    pickerCell(THU).click();
    assert.equal(store.meta.calendarCursor, THU, "click selects a local date key");
    assert.equal(store.meta.calendarView, "month", "OW-06: a Month click selects, it does not open Day view");
    assert.ok(pickerCell(THU).classList.contains("is-selected"));
    assert.ok(q(".zn-cal-picker-selection .zn-cal-day-group"), "the selected day's items are listed below the grid");
    const thu = pickerCell(THU);
    thu.focus();
    thu.dispatchEvent(new Ev("keydown", { key: "ArrowRight", bubbles: true }));
    assert.ok(pickerCell(FRI)?.classList.contains("is-cursor"), "ArrowRight moves the roving focus by one local day");
    assert.equal(pickerCell(FRI).getAttribute("tabindex"), "0");
    assert.ok(document.activeElement === pickerCell(FRI), "the next date receives keyboard focus");

    paneWidth = 520;
    await resized();
    assert.equal(q(".zn-cal-picker-grid"), null, "above the width threshold the full Month grid returns");
    assert.ok(q(".zn-cal-month-items"), "full Month retains its event marks");
    paneWidth = 700;
    await resized();
    assert.equal(q(".zn-cal-picker-grid"), null, "a wide pane keeps the full Month grid");

    // The threshold and colour choices are user settings, and the manual mode overrides geometry.
    chip.click();
    const settingsGroup = qa(".zn-menu-item").find((entry) => entry.textContent.trim() === "Date picker settings");
    assert.ok(settingsGroup, "Month size menu exposes date-picker settings");
    settingsGroup.click();
    const widthSlider = qa(".zn-menu-slider input").find((entry) => entry.getAttribute("aria-label") === "Date picker width threshold");
    assert.ok(widthSlider, "width threshold is configurable");
    widthSlider.value = "600";
    widthSlider.dispatchEvent(new Ev("input", { bubbles: true }));
    await flushRaf();
    assert.equal(C.cleanCalendarPicker(store.meta.calendarPicker).minWidth, 600);
    paneWidth = 550;
    await resized();
    assert.ok(q(".zn-cal-picker-grid"), "the changed width threshold takes effect");
    paneWidth = 700;
    await resized();
    assert.equal(q(".zn-cal-picker-grid"), null, "a wide, tall pane stays in full-month mode");
    const heightSlider = qa(".zn-menu-slider input").find((entry) => entry.getAttribute("aria-label") === "Date picker height threshold");
    assert.ok(heightSlider, "height threshold is configurable too");
    heightSlider.value = "500";
    heightSlider.dispatchEvent(new Ev("input", { bubbles: true }));
    await flushRaf();
    assert.equal(C.cleanCalendarPicker(store.meta.calendarPicker).minHeight, 500);
    paneHeight = 480;
    await resized();
    assert.ok(q(".zn-cal-picker-grid"), "the changed height threshold takes effect independently of width");
    paneHeight = 700;
    await resized();
    assert.equal(q(".zn-cal-picker-grid"), null);
    paneWidth = 550;
    await resized();
    assert.ok(q(".zn-cal-picker-grid"), "the picker is visible for the category-tint check");
    chip.click();
    chip.click();
    const options = qa(".zn-menu-item").find((entry) => entry.textContent.trim() === "Date picker settings");
    assert.ok(options);
    options.click();
    const tintOption = qa(".zn-menu-item").find((entry) => entry.textContent.trim() === "Count + dominant category tint");
    assert.ok(tintOption);
    tintOption.click();
    assert.equal(C.cleanCalendarPicker(store.meta.calendarPicker).colorMode, "category");
    store.items.upsertCategory({ name: "Picker tint", color: "#abcdef" });
    store.items.upsert({
      id: "picker-tint", summary: "Tinted reminder",
      start: { dateTime: new Date(C.parseYmd(WED).getTime() + 8 * 3600000).toISOString() },
      x: { kind: "reminder", category: "Picker tint" },
    });
    await flushRaf();
    assert.equal(pickerCell(WED).style.getPropertyValue("--zn-cal-picker-tint"), "#abcdef", "category mode tints the count intensity with the dominant category colour");
    paneWidth = 700;
    await resized();
    assert.equal(q(".zn-cal-picker-grid"), null, "the automatic picker turns off when the pane is wide enough");
    chip.click();
    const manualGroup = qa(".zn-menu-item").find((entry) => entry.textContent.trim() === "Date picker settings");
    assert.ok(manualGroup);
    manualGroup.click();
    const forcePicker = qa(".zn-menu-item").find((entry) => entry.textContent.trim() === "Always use date picker");
    assert.ok(forcePicker);
    forcePicker.click();
    await flushRaf();
    assert.ok(q(".zn-cal-picker-grid"), "manual date-picker mode works above both thresholds");
    chip.click();
    const modeGroup = qa(".zn-menu-item").find((entry) => entry.textContent.trim() === "Date picker settings");
    assert.ok(modeGroup);
    modeGroup.click();
    const forceFull = qa(".zn-menu-item").find((entry) => entry.textContent.trim() === "Always use full month");
    assert.ok(forceFull);
    forceFull.click();
    await flushRaf();
    assert.equal(q(".zn-cal-picker-grid"), null, "manual full-month mode overrides picker geometry");
    assert.ok(q(".zn-cal-month-grid"));

    // Automatic height threshold also selects the picker; with no room below it, selecting a day opens Day view.
    const autoGroupTrigger = chip;
    autoGroupTrigger.click();
    const autoGroup = qa(".zn-menu-item").find((entry) => entry.textContent.trim() === "Date picker settings");
    assert.ok(autoGroup);
    autoGroup.click();
    const automatic = qa(".zn-menu-item").find((entry) => entry.textContent.trim() === "Automatic");
    assert.ok(automatic);
    automatic.click();
    paneWidth = 700;
    paneHeight = 260;
    await resized();
    assert.ok(q(".zn-cal-picker-grid"), "a short pane also activates picker mode");
    const pickDay = pickerCell(FRI);
    assert.ok(pickDay);
    pickDay.click();
    assert.equal(store.meta.calendarCursor, FRI);
    assert.equal(store.meta.calendarView, "day", "the picker opens Day view when the pane cannot fit the selected-day list");
    paneWidth = 700; paneHeight = 700;
    await resized();
    await showView("Month");
    assert.deepEqual(plain(C.cleanCalendarPicker(store.meta.calendarPicker)), {
      mode: "auto", minWidth: 600, minHeight: 500, colorMode: "category",
    }, "picker preferences persist independently of calendar cell spacing");
  });

  await test("the style sheet: a fitted timeline has no scrollbar; fitted weeks fill the pane and start at its top; a short event shows its title", async () => {
    // The fake DOM lays nothing out, so these are the declarations that win for the real elements.
    const { parseCss, cascade } = require("./helpers/css-cascade.cjs");
    const css = parseCss(fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8"));
    const style = (el) => cascade(css, el);
    box.timeline = 503; box.grid = 363;
    await showView("Week");
    assert.equal(timeline().dataset.fitted, "true");
    assert.equal(style(timeline()).get("overflow-y"), "hidden", "fitted: no scrollbar, also not for the frame in which the pane is already lower");
    assert.deepEqual([style(timeline()).get("flex-grow"), style(timeline()).get("min-height")], ["1", "3.5em"],
      "the timeline takes what is left over the hours, and is never lower than two and a half of the smallest hours (it was 0 px in a pane too low)");
    let { input } = openSize();
    await slide(input, 40);
    assert.equal(style(timeline()).get("overflow-y"), "auto", "a size that is set scrolls");
    const row = style(q(".zn-menu-slider-row")), fitButton = style(q(".zn-menu-slider-fit"));
    assert.equal(row.get("display"), "flex");
    assert.equal(style(q(".zn-menu-slider")).get("display"), "flex");
    assert.equal(style(q(".zn-menu-slider-row .zn-quick-value")).get("width"), "6.2em", "the value has a fixed width: the menu does not change its width while the slider moves");
    assert.equal(fitButton.get("align-self"), "flex-start");
    q(".zn-menu .zn-menu-slider-fit").click(); await flushRaf(); await closeSize();
    // A short event.
    box.timeline = 435; await resized();
    const lunch = eventBox("Lunch");
    assert.equal(lunch.classList.contains("is-short"), true);
    assert.equal(style(lunch.querySelector(".zn-cal-item-time")).get("display"), "none", "the time is left out");
    assert.notEqual(style(lunch.querySelector(".zn-cal-item-title")).get("display"), "none");
    assert.deepEqual([style(lunch).get("justify-content"), style(lunch).get("padding-top"), style(lunch).get("padding-bottom")], ["center", "0", "0"], "and the title is in the middle of the box");
    box.timeline = 1203; await resized();
    assert.notEqual(style(eventBox("Lunch").querySelector(".zn-cal-item-time")).get("display"), "none", "a box that holds both shows both");
    // Month, fitted.
    await showView("Month");
    const pane = style(content), grid = style(q(".zn-cal-month-grid")), wrap = style(q(".zn-cal-month-wrap")), selection = style(q(".zn-cal-month-selection")), cell = style(q(".zn-cal-month-cell"));
    assert.deepEqual([pane.get("display"), pane.get("flex-direction"), pane.get("justify-content"), pane.get("align-items")], ["flex", "column", "flex-start", "stretch"],
      "a column from the top, as wide as the pane (centred, what is too high could not be scrolled to its top)");
    assert.deepEqual([wrap.get("flex-grow"), wrap.get("flex-basis")], ["1", "0"], "the weeks take what the list of the selected day leaves");
    assert.equal(grid.get("grid-template-rows"), "repeat(6, minmax(0, 1fr))", "six equal weeks that do not grow with what is in them");
    assert.match(grid.get("min-height"), /^max\(279px, /, "never under 44 px a week; then the pane scrolls");
    assert.equal(cell.get("min-height"), "0");
    assert.equal(cell.get("overflow-x"), "hidden");
    assert.deepEqual([selection.get("flex-shrink"), selection.get("overflow-y")], ["1", "auto"], "the list of the selected day gives way and scrolls by itself");
    // Month with a height that is set: the pane is a plain block again and scrolls.
    ({ input } = openSize());
    await slide(input, 80);
    const fixed = style(content);
    assert.equal(fixed.get("display"), "block");
    assert.equal(fixed.get("overflow-y"), "auto");
    assert.equal(style(q(".zn-cal-month-grid")).get("grid-template-rows"), "repeat(6, var(--zn-cal-month-row, 58px))");
    assert.equal(style(q(".zn-cal-month-grid")).get("min-height"), "", "no lowest height: the weeks are as high as the slider says");
    // The looks of the cells follow the grid, with the same gap and the same row of day names in each (the fit
    // measures the weeks; a look that changed their height would change the look again).
    for (const [px, name] of [[52, "compact"], [44, "extra-compact"]]) {
      await slide(input, px);
      assert.equal(q(".zn-cal-month-wrap").dataset.density, name);
      assert.equal(style(q(".zn-cal-month-grid")).get("row-gap"), "3px", name + ": the gap between the weeks is 3 px in every look");
      assert.equal(style(q(".zn-cal-month-cell")).get("padding"), "2px");
    }
    q(".zn-menu .zn-menu-slider-fit").click(); await flushRaf(); await closeSize();
    assert.deepEqual(plain(store.meta.calendarScale), AUTO);
  });

  await sheet.close?.();

  console.log(`calendar scale tests passed (${passed})`);
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
