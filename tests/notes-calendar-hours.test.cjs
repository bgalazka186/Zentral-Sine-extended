"use strict";
/* OW-04: Week and Day show a chosen part of the day (for example 08:00-20:00) instead of all 24 hours, and widen by
 * whole hours for as long as a day in view has an event or a reminder outside it.
 *
 * Part 1: the pure rules in the calendar module (which hours, pointer <-> minute, free time inside the hours).
 * Part 2: the real sheet in the fake DOM (what is drawn where, dragging in a grid that does not begin at midnight,
 *         the current time outside the hours, the toolbar button and the dialog, an update of one day).
 * The fake DOM has no layout: positions are the inline styles the sheet writes, and a pointer position is turned into
 * a time against the rectangle the test gives the track. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

// The days the clocks change can only be tested on a computer whose own zone changes its clocks. The tests marked
// "warsaw" are skipped in the normal run; the last test starts this file once more with TZ=Europe/Warsaw, and that
// second run does only those.
const WARSAW_RUN = process.env.ZN_HOURS_WARSAW_RUN === "1";
let passed = 0;
async function test(name, fn, where = "") {
  if ((where === "warsaw") !== WARSAW_RUN) return;
  await fn(); passed++; console.log((WARSAW_RUN ? "  ok - " : "ok - ") + name);
}
const MIN = 60000, HOUR = 3600000;
const ZONE = "Europe/Warsaw";
const at = (dateKey, clock, zone = ZONE) => C.zonedDateTimeToMs(dateKey, clock, zone);
const dayOf = (dateKey) => C.parseYmd(dateKey).getTime(); // the local midnight the grid uses for that date
let seq = 0;
const event = (start, end, extra = {}) => C.makeItem({ id: "e" + ++seq, summary: extra.summary || "Event " + seq, start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() }, status: extra.status, x: { kind: "event", src: "manual" } }, 0);
const reminder = (start, extra = {}) => C.makeItem({ id: "r" + ++seq, summary: extra.summary || "Reminder " + seq, start: { dateTime: new Date(start).toISOString() }, x: { kind: "reminder", src: "manual" } }, 0);
const allDay = (dateKey, nextKey) => C.makeItem({ id: "a" + ++seq, summary: "All day " + seq, start: { date: dateKey }, end: { date: nextKey }, x: { kind: "event", src: "manual" } }, 0);
const ON = { on: true, startMin: 480, endMin: 1200 }; // 08:00-20:00
const span = (r) => [r.startMin, r.endMin, r.extendedTop, r.extendedBottom];

// OW-75: the calendar's Tools menu is grouped by job (Create / Calendar settings / Show and find / This week as text).
// This opens `trigger`, walks into the group that holds `label` and returns the row, so a test names the row it wants
// and not the menu's shape.
const openCalendarRow = (root, trigger, label, match = (text, want) => text === want || text.startsWith(want) || want.test?.(text)) => {
  root.querySelector(trigger).click();
  const items = () => [...root.querySelectorAll(".zn-menu-item")];
  const hit = (want) => items().find((el) => (typeof want === "string" ? el.textContent.trim() === want || el.textContent.trim().startsWith(want) : want.test(el.textContent.trim())));
  let row = hit(label);
  const groups = items().filter((el) => el.classList.contains("zn-menu-group"));
  if (!row) {
    for (const group of groups) {
      group.click();
      row = hit(label);
      if (row) break;
      const back = root.querySelector(".zn-menu-back");
      if (back) back.click();
    }
  }
  return row;
};

(async () => {
  // =====================================================================================================================
  // 1. The setting
  // =====================================================================================================================
  await test("the setting: off by default, whole hours, 08:00-20:00 when what is stored makes no sense", () => {
    assert.deepEqual(C.cleanCalendarHours(undefined), { on: false, startMin: 480, endMin: 1200 });
    assert.deepEqual(C.cleanCalendarHours(null), { on: false, startMin: 480, endMin: 1200 });
    assert.deepEqual(C.cleanCalendarHours("08-20"), { on: false, startMin: 480, endMin: 1200 });
    assert.deepEqual(C.cleanCalendarHours({ on: true, startMin: 420, endMin: 1320 }), { on: true, startMin: 420, endMin: 1320 });
    assert.deepEqual(C.cleanCalendarHours({ on: true, startMin: 0, endMin: 1440 }), { on: true, startMin: 0, endMin: 1440 }, "the whole day is a valid choice");
    assert.deepEqual(C.cleanCalendarHours({ on: "yes", startMin: 420, endMin: 1320 }), { on: false, startMin: 420, endMin: 1320 }, "only true switches it on");
    assert.deepEqual(C.cleanCalendarHours({ on: true, startMin: 425, endMin: 1290 }), { on: true, startMin: 420, endMin: 1320 }, "minutes are brought to the nearest whole hour");
    for (const bad of [{ startMin: 600, endMin: 600 }, { startMin: 700, endMin: 600 }, { startMin: -60, endMin: 600 }, { startMin: 60, endMin: 1500 }, { startMin: null, endMin: 600 }, { startMin: "", endMin: 600 }, { startMin: "x", endMin: 600 }, { endMin: 600 }])
      assert.deepEqual(C.cleanCalendarHours({ on: true, ...bad }), { on: true, startMin: 480, endMin: 1200 }, "falls back for " + JSON.stringify(bad));
    assert.equal(Object.isFrozen(C.DEFAULT_CALENDAR_HOURS), true);
    const stored = { on: true, startMin: 420, endMin: 1320 };
    C.cleanCalendarHours(stored).startMin = 0;
    assert.equal(stored.startMin, 420, "the stored object is never changed");
  });

  // =====================================================================================================================
  // 2. Which hours the grid shows
  // =====================================================================================================================
  const D1 = "2026-11-16", D2 = "2026-11-17"; // no clock change in any of the zones the suite runs in
  const local = (dateKey, h, m = 0) => { const d = C.parseYmd(dateKey); d.setHours(h, m, 0, 0); return d.getTime(); };
  const view = (items, days = [D1]) => days.map((key) => ({ day: dayOf(key), items }));

  await test("off: the whole day, whatever is in view", () => {
    const r = C.visibleHourRange({ on: false, startMin: 480, endMin: 1200 }, view([event(local(D1, 3), local(D1, 4))]));
    assert.deepEqual(r, { startMin: 0, endMin: 1440, extendedTop: false, extendedBottom: false, top: null, bottom: null });
    assert.deepEqual(span(C.visibleHourRange(null, view([]))), [0, 1440, false, false], "nothing stored: the whole day");
  });

  await test("on: exactly the chosen hours while everything in view lies inside them", () => {
    assert.deepEqual(span(C.visibleHourRange(ON, view([]))), [480, 1200, false, false], "an empty week");
    assert.deepEqual(span(C.visibleHourRange(ON, [])), [480, 1200, false, false], "no days at all");
    const inside = [event(local(D1, 8), local(D1, 9)), event(local(D1, 19), local(D1, 20)), reminder(local(D1, 12, 30))];
    const r = C.visibleHourRange(ON, view(inside));
    assert.deepEqual(r, { startMin: 480, endMin: 1200, extendedTop: false, extendedBottom: false, top: null, bottom: null }, "items that touch both ends do not widen it");
  });

  await test("an item outside widens the grid by whole hours, on its side only, and is named as the reason", () => {
    const early = event(local(D1, 6, 10), local(D1, 7), { summary: "Early call" });
    let r = C.visibleHourRange(ON, view([early, event(local(D1, 10), local(D1, 11))]));
    assert.deepEqual(span(r), [360, 1200, true, false], "06:10 opens the grid at 06:00; the end is untouched");
    assert.ok(r.top.item === early && r.bottom === null, "the early item is the reason");
    assert.deepEqual([r.top.startMin, r.top.endMin, r.top.day], [370, 420, dayOf(D1)]);

    const late = event(local(D1, 21, 15), local(D1, 22, 30), { summary: "Late call" });
    r = C.visibleHourRange(ON, view([late]));
    assert.deepEqual(span(r), [480, 1380, false, true], "22:30 closes the grid at 23:00; the start is untouched");
    assert.ok(r.bottom.item === late && r.top === null);

    r = C.visibleHourRange(ON, view([early, late]));
    assert.deepEqual(span(r), [360, 1380, true, true]);
    assert.deepEqual(span(C.visibleHourRange(ON, view([event(local(D1, 20), local(D1, 21))]))), [480, 1260, false, true], "an item that ends on the hour adds no empty hour after it");
    assert.deepEqual(span(C.visibleHourRange(ON, view([event(local(D1, 7), local(D1, 8))]))), [420, 1200, true, false], "nor before it");
    assert.deepEqual(span(C.visibleHourRange(ON, view([event(local(D1, 7, 30), local(D1, 20, 30))]))), [420, 1260, true, true], "one long item can widen both ends");
  });

  await test("every day in view counts, and only those days", () => {
    const tuesdayEarly = event(local(D2, 5), local(D2, 6)), mondayLate = event(local(D1, 21), local(D1, 22));
    const items = [tuesdayEarly, mondayLate];
    assert.deepEqual(span(C.visibleHourRange(ON, view(items, [D1, D2]))), [300, 1320, true, true], "a week takes the earliest start and the latest end of all its days");
    let r = C.visibleHourRange(ON, view(items, [D1]));
    assert.deepEqual(span(r), [480, 1320, false, true], "the day view of Monday is not opened for Tuesday's early item");
    r = C.visibleHourRange(ON, view(items, [D2]));
    assert.deepEqual(span(r), [300, 1200, true, false]);
    assert.ok(r.top.item === tuesdayEarly && r.top.day === dayOf(D2));
    assert.deepEqual(span(C.visibleHourRange(ON, view(items, ["2026-11-18"]))), [480, 1200, false, false], "a day without them is not widened");
  });

  await test("all-day and cancelled items never widen the grid; a timed reminder does", () => {
    const quiet = [allDay(D1, D2), event(local(D1, 2), local(D1, 3), { status: "cancelled" })];
    assert.deepEqual(span(C.visibleHourRange(ON, view(quiet))), [480, 1200, false, false]);
    const wake = reminder(local(D1, 6, 45), { summary: "Wake up" });
    const r = C.visibleHourRange(ON, view([...quiet, wake]));
    assert.deepEqual(span(r), [360, 1200, true, false]);
    assert.ok(r.top.item === wake, "the reason is the reminder itself, not a copy of it");
    assert.deepEqual(span(C.visibleHourRange(ON, view([reminder(local(D1, 0))]))), [0, 1200, true, false], "a reminder at midnight is not lost");
  });

  await test("an item that crosses midnight counts on each day with the part that lies in it", () => {
    const night = event(local(D1, 22), local(D2, 2), { summary: "Night shift" });
    assert.deepEqual(span(C.visibleHourRange(ON, view([night], [D1]))), [480, 1440, false, true], "first day: until midnight");
    assert.deepEqual(span(C.visibleHourRange(ON, view([night], [D2]))), [0, 1200, true, false], "second day: from midnight");
    assert.deepEqual(span(C.visibleHourRange(ON, view([night], [D1, D2]))), [0, 1440, true, true], "a week with both days shows the whole day");
  });

  await test("the hours follow the times of the items, not the size of their boxes", () => {
    const shown = (...items) => span(C.visibleHourRange(ON, view(items)));
    // The grid draws a reminder and a five-minute event 20 px high (23 minutes at 54 px an hour). That is the grid's
    // business (it keeps the box inside); it adds no hour.
    assert.deepEqual(shown(reminder(local(D1, 19, 50))), [480, 1200, false, false], "a reminder at 19:50 lies inside 08:00-20:00");
    assert.deepEqual(shown(reminder(local(D1, 19, 59))), [480, 1200, false, false]);
    assert.deepEqual(shown(event(local(D1, 19, 50), local(D1, 19, 55))), [480, 1200, false, false], "a five-minute event before the end too");
    assert.deepEqual(shown(event(local(D1, 19, 30), local(D1, 20))), [480, 1200, false, false], "an event that ends at 20:00 sharp ends with the grid");
    assert.deepEqual(shown(reminder(local(D1, 20))), [480, 1260, false, true], "a reminder at 20:00 sharp lies after it: the hour from 20:00 is added");
    assert.deepEqual(shown(event(local(D1, 19, 30), local(D1, 20, 1))), [480, 1260, false, true], "and so does one minute of an event");
    assert.deepEqual(shown(reminder(local(D1, 8))), [480, 1200, false, false], "a reminder at 08:00 sharp is the first minute of the grid");
    assert.deepEqual(shown(reminder(local(D1, 7, 59))), [420, 1200, true, false]);
    assert.deepEqual(shown(event(local(D1, 7), local(D1, 8))), [420, 1200, true, false], "an event that ends at 08:00 lies before it");
    assert.deepEqual(shown(reminder(local(D1, 23, 59))), [480, 1440, false, true], "never past midnight");
    assert.deepEqual(span(C.visibleHourRange(ON, view([reminder(local(D1, 19, 50))]), "", { minMin: 600 })), [480, 1200, false, false], "there is no option that pads an item");
  });

  await test("a range that is being dragged out counts like an item", () => {
    const r = C.visibleHourRange(ON, view([]), "", { draft: { day: dayOf(D1), startMin: 315, endMin: 345 } });
    assert.deepEqual(span(r), [300, 1200, true, false]);
    assert.deepEqual([r.top.item, r.top.startMin, r.top.day], [null, 315, dayOf(D1)], "it has no item behind it");
    assert.deepEqual(span(C.visibleHourRange(ON, view([]), "", { draft: { startMin: 600, endMin: 660 } })), [480, 1200, false, false]);
    assert.deepEqual(span(C.visibleHourRange(ON, view([]), "", { draft: { startMin: NaN, endMin: 660 } })), [480, 1200, false, false], "a draft without a position is ignored");
  });

  await test("the grid may hand over what it has already laid out: the result is the same", () => {
    const items = [event(local(D1, 6, 10), local(D1, 7)), event(local(D1, 10), local(D1, 11)), event(local(D2, 21, 15), local(D2, 22, 30)), event(local(D1, 23), local(D2, 1))];
    const fromItems = C.visibleHourRange(ON, view(items, [D1, D2]));
    const laidOut = [D1, D2].map((key) => ({ day: dayOf(key), entries: C.layoutDay(items, dayOf(key), "") }));
    const fromEntries = C.visibleHourRange(ON, laidOut);
    assert.deepEqual(span(fromEntries), span(fromItems));
    assert.deepEqual(span(fromEntries), [0, 1440, true, true]);
    assert.ok(fromEntries.top.item === fromItems.top.item && fromEntries.bottom.item === fromItems.bottom.item);
    assert.deepEqual(span(C.visibleHourRange(ON, [{ day: dayOf(D1), entries: [{ startMin: 400, endMin: 430, item: null }, { startMin: NaN, endMin: 5 }, null] }, null, 7])), [360, 1200, true, false], "entries without a position and days that are not objects are skipped");
  });

  // =====================================================================================================================
  // 3. Days on which the clocks change (in the display zone: the grid is a wall clock)
  // =====================================================================================================================
  await test("the day the clocks go forward (Europe/Warsaw, 29 March 2026): hours are wall-clock hours", () => {
    const day = "2026-03-29", days = [{ day: dayOf(day), items: null }];
    // 06:30 on the wall is only 5.5 hours after midnight on this day.
    days[0].items = [event(at(day, "06:30"), at(day, "07:30"))];
    assert.deepEqual(span(C.visibleHourRange(ON, days, ZONE)), [360, 1200, true, false], "06:30 opens the grid at 06:00, not at 05:00");
    // 21:10-21:50 on the wall is 20:10-20:50 counted from midnight.
    days[0].items = [event(at(day, "21:10"), at(day, "21:50"))];
    assert.deepEqual(span(C.visibleHourRange(ON, days, ZONE)), [480, 1320, false, true], "21:50 closes it at 22:00, not at 21:00");
    // An event across the missing hour: 01:30 to 03:30 on the wall is one real hour.
    days[0].items = [event(at(day, "01:30"), at(day, "03:30"))];
    const r = C.visibleHourRange(ON, days, ZONE);
    assert.deepEqual([r.startMin, r.top.startMin, r.top.endMin], [60, 90, 210]);
    assert.equal(at(day, "03:30") - at(day, "01:30"), HOUR, "(the day has 23 hours)");
  });

  await test("the day the clocks go back (Europe/Warsaw, 25 October 2026): hours are wall-clock hours", () => {
    const day = "2026-10-25", days = [{ day: dayOf(day), items: null }];
    // 07:30 on the wall is 8.5 hours after midnight on this day.
    days[0].items = [event(at(day, "07:30"), at(day, "07:55"))];
    assert.deepEqual(span(C.visibleHourRange(ON, days, ZONE)), [420, 1200, true, false], "07:30 opens the grid at 07:00 and is not taken for 08:30");
    days[0].items = [event(at(day, "19:00"), at(day, "20:00"))];
    assert.deepEqual(span(C.visibleHourRange(ON, days, ZONE)), [480, 1200, false, false], "an event until 20:00 on the wall does not widen a grid that ends at 20:00");
    // The second 02:30 of the night (01:30 UTC) is drawn at 02:30.
    const second = Date.parse("2026-10-25T01:30:00.000Z");
    days[0].items = [reminder(second)];
    const r = C.visibleHourRange(ON, days, ZONE);
    assert.deepEqual([r.startMin, r.top.startMin], [120, 150]);
    assert.equal(at("2026-10-26", "00:00") - at(day, "00:00"), 25 * HOUR, "(the day has 25 hours)");
  });

  await test("no display zone, and the computer's own clocks change that day: the grid is the wall clock all the same", () => {
    assert.equal(new Date(2026, 5, 1).getTimezoneOffset(), -120, "this run is in Europe/Warsaw");
    const spring = "2026-03-29", autumn = "2026-10-25";
    const laid = (item, key) => C.layoutDay([item], dayOf(key)).map((e) => [e.startMin, e.endMin]);
    const shown = (item, key) => span(C.visibleHourRange(ON, [{ day: dayOf(key), items: [item] }]));
    // 29 March has 23 hours: 02:00-03:00 does not exist, so 08:00 comes seven hours after midnight. It is still the
    // eighth hour of the grid.
    const breakfast = event(local(spring, 8), local(spring, 9));
    assert.deepEqual(laid(breakfast, spring), [[480, 540]], "an event at 08:00 lies at 08:00");
    assert.deepEqual(shown(breakfast, spring), [480, 1200, false, false], "and does not open the hour from 07:00");
    assert.deepEqual(shown(event(local(spring, 7, 30), local(spring, 8, 30)), spring), [420, 1200, true, false], "one at 07:30 does");
    assert.deepEqual(shown(event(local(spring, 19), local(spring, 20)), spring), [480, 1200, false, false]);
    assert.deepEqual(laid(event(local(spring, 1), local(spring, 1, 30)), spring), [[60, 90]], "before the change nothing is different");
    assert.equal(C.zonedMinuteOfDay(local(spring, 10, 30), spring), 630, "10:30 is minute 630 of that day (the current-time line, the busy bands, the working hours)");
    assert.deepEqual(laid(event(local(spring, 1, 30), local(spring, 3, 30)), spring), [[90, 210]], "01:30 to 03:30 is one hour long and is drawn from 01:30 to 03:30");
    // 25 October has 25 hours: 02:00-03:00 comes twice, so 19:00 comes twenty hours after midnight.
    const dinner = event(local(autumn, 19), local(autumn, 20));
    assert.deepEqual(laid(dinner, autumn), [[1140, 1200]], "an event at 19:00 lies at 19:00");
    assert.deepEqual(shown(dinner, autumn), [480, 1200, false, false], "and one that ends at 20:00 does not open the hour from 20:00");
    const late = event(local(autumn, 23), local(autumn, 23, 30));
    assert.deepEqual(laid(late, autumn), [[1380, 1410]], "23:00 lies in the last hour of the grid, not below its end");
    assert.deepEqual(shown(late, autumn), [480, 1440, false, true]);
    assert.equal(C.zonedMinuteOfDay(local(autumn, 23, 59), autumn), 1439);
    assert.deepEqual([C.zonedMinuteOfDay(Date.parse("2026-10-25T00:30:00Z"), autumn), C.zonedMinuteOfDay(Date.parse("2026-10-25T01:30:00Z"), autumn)], [150, 150], "the two 02:30 of that night are the same place in the grid");
    // The ends of the day, and a day without a change.
    for (const key of [spring, autumn, "2026-11-18"]) {
      assert.equal(C.zonedMinuteOfDay(dayOf(key), key), 0);
      assert.equal(C.zonedMinuteOfDay(dayOf(key) - HOUR, key), 0, "before the day: its first minute");
      assert.equal(C.zonedMinuteOfDay(C.addDays(dayOf(key), 1), key), 1440);
      assert.equal(C.zonedMinuteOfDay(C.addDays(dayOf(key), 1) + HOUR, key), 1440, "after the day: its last");
      assert.deepEqual(laid(event(dayOf(key) - HOUR, C.addDays(dayOf(key), 1) + HOUR), key), [[0, 1440]], "an event across the whole day fills the grid");
    }
    assert.deepEqual(laid(event(local("2026-11-18", 8), local("2026-11-18", 9, 15)), "2026-11-18"), [[480, 555]]);
    assert.equal(C.zonedMinuteOfDay(local("2026-11-18", 8) + 30000, "2026-11-18"), 480.5, "seconds count as before");
    assert.ok(Number.isNaN(C.zonedMinuteOfDay(NaN, spring)) && Number.isNaN(C.zonedMinuteOfDay(local(spring, 8), "not a date")));
    // Working hours, and with them "When am I free?", are clock times too: 09:00 is 09:00, not nine hours after midnight.
    const sunday = { days: [0], startMin: 540, endMin: 1020 };
    for (const key of [spring, autumn]) {
      assert.deepEqual(C.workRange(dayOf(key), sunday), [local(key, 9), local(key, 17)], "working hours 09:00-17:00 on " + key);
      assert.deepEqual(C.workRange(dayOf(key), { days: [0], startMin: 0, endMin: 1440 }), [dayOf(key), C.addDays(dayOf(key), 1)], "the whole day is the whole day, however long it is");
      const free = (opts) => C.freeSlots([], dayOf(key), C.addDays(dayOf(key), 1), 30, opts);
      assert.deepEqual(free({ hours: ON }), [[local(key, 8), local(key, 20)]], "free time inside 08:00-20:00 on " + key);
      assert.deepEqual(free({ work: sunday }), [[local(key, 9), local(key, 17)]]);
      assert.deepEqual(free({ work: sunday, hours: { startMin: 600, endMin: 1200 } }), [[local(key, 10), local(key, 17)]]);
    }
    assert.deepEqual(C.workRange(dayOf("2026-11-18"), { days: [3], startMin: 510, endMin: 1035 }), [local("2026-11-18", 8, 30), local("2026-11-18", 17, 15)], "an ordinary day, as before");
    assert.equal(C.workRange(dayOf(spring), { days: [1, 2, 3, 4, 5], startMin: 540, endMin: 1020 }), null, "a day off stays one");
  }, "warsaw");

  await test("the display zone decides the day and the hour of an item, not the computer's zone", () => {
    // 23:30 in Warsaw on the 16th is 07:30 on the 17th in Tokyo and 17:30 on the 16th in New York.
    const item = event(at(D1, "23:30"), at(D1, "23:45"));
    const on = (key, zone) => span(C.visibleHourRange(ON, [{ day: dayOf(key), items: [item] }], zone));
    assert.deepEqual(on(D1, ZONE), [480, 1440, false, true]);
    assert.deepEqual(on(D2, "Asia/Tokyo"), [420, 1200, true, false]);
    assert.deepEqual(on(D1, "Asia/Tokyo"), [480, 1200, false, false], "in Tokyo it is not on the 16th at all");
    assert.deepEqual(on(D1, "America/New_York"), [480, 1200, false, false], "17:30 in New York: inside the hours");
  });

  // =====================================================================================================================
  // 4. Pointer position <-> time
  // =====================================================================================================================
  await test("a position in the grid is a time counted from the first hour shown, and back", () => {
    const grid = { startMin: 480, endMin: 1200 };
    assert.equal(C.gridOffsetOf(480, 54, grid), 0, "the first hour is at the top");
    assert.equal(C.gridOffsetOf(570, 54, grid), 81, "09:30 is one and a half hours down");
    assert.equal(C.gridOffsetOf(1200, 54, grid), 648, "the last hour ends at the bottom");
    assert.equal(C.gridMinuteAt(0, 54, grid), 480);
    assert.equal(C.gridMinuteAt(81, 54, grid), 570);
    assert.equal(C.gridMinuteAt(-30, 54, grid), 480, "above the grid is its first minute");
    assert.equal(C.gridMinuteAt(5000, 54, grid), 1200, "below it its last");
    for (const px of [36, 44, 54]) for (const minute of [480, 495, 777, 1199, 1200])
      assert.ok(Math.abs(C.gridMinuteAt(C.gridOffsetOf(minute, px, grid), px, grid) - minute) < 1e-9, `round trip ${minute} at ${px} px`);
    assert.equal(C.gridMinuteAt(432, 54), 480, "no range given: the whole day, as before");
    assert.equal(C.gridOffsetOf(480, 54), 432);
    assert.equal(C.gridMinuteAt(99999, 54), 1440);
    assert.equal(C.gridMinuteAt(100, 0, grid), 480, "a grid without a height never yields NaN");
    assert.equal(C.gridMinuteAt(NaN, 54, grid), 480);
  });

  // =====================================================================================================================
  // 5. Free time inside the hours
  // =====================================================================================================================
  await test("\"When am I free?\" can be held to the hours the grid shows", () => {
    const from = dayOf(D1), to = dayOf(D2), hours = { startMin: 480, endMin: 1200 };
    const slots = (items, opts) => C.freeSlots(items, from, to, 60, opts).map(([s, e]) => [(s - from) / MIN, (e - from) / MIN]);
    assert.deepEqual(slots([], {}), [[0, 1440]], "no limit: the whole day, as before");
    assert.deepEqual(slots([], { hours }), [[480, 1200]], "inside the hours only");
    const lunch = event(local(D1, 12), local(D1, 13));
    assert.deepEqual(slots([lunch], { hours }), [[480, 720], [780, 1200]]);
    const work = { days: [0, 1, 2, 3, 4, 5, 6], startMin: 540, endMin: 1020 };
    assert.deepEqual(slots([lunch], { work }), [[540, 720], [780, 1020]], "working hours alone, as before");
    assert.deepEqual(slots([lunch], { work, hours }), [[540, 720], [780, 1020]], "both: what lies in both");
    assert.deepEqual(slots([lunch], { work, hours: { startMin: 600, endMin: 960 } }), [[600, 720], [780, 960]]);
    assert.deepEqual(slots([], { work: { days: [], startMin: 540, endMin: 1020 }, hours }), [], "a day off stays a day off");
    assert.deepEqual(slots([], { hours: { startMin: 900, endMin: 600 } }), [[480, 1200]], "hours that make no sense fall back to 08:00-20:00");
    const two = C.freeSlots([], from, dayOf("2026-11-18"), 60, { hours }).map(([s, e]) => [new Date(s).getHours(), new Date(e).getHours()]);
    assert.deepEqual(two, [[8, 20], [8, 20]], "one window a day");
  });

  // =====================================================================================================================
  // 6. The sheet
  // =====================================================================================================================
  // Wednesday 18 November 2026, 10:30 on the computer's clock; the week in view is Monday 16 to Sunday 22. No display
  // zone is set (the usual case), so the grid is the computer's local day.
  const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  const dom = require("./helpers/fake-dom.cjs")();
  const { El, Ev, document, raf } = dom;
  const win = { __zentralNotesParts: { "notes-calendar": C }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
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
  const MON = "2026-11-16", TUE = "2026-11-17", WED = "2026-11-18", THU = "2026-11-19";
  let clock = local(WED, 10, 30); // what the sheet takes for "now"; the tests set it back and forth
  let stamp = clock;              // the store's clock: it only moves forward, so a later write is always the newer one
  const makeStore = (dir, id) => core.createStore({ io, notify() {}, windowId: id, now: () => stamp, getDir: async () => dir, getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  const store = makeStore("/hours", "hours-a");
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (el) => host.append(el), getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const prefs = new Map();
  const env = { now: () => clock, getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), setPref: (k, v) => prefs.set(k, v), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
  await store.open();
  store.create("# A note\n\nText");
  // Create an item, or replace the one with this id (a second later, so that it is the newer record).
  const put = (id, summary, start, end) => {
    stamp += 1000;
    const saved = store.items.upsert({ id, summary, start: { dateTime: new Date(start).toISOString() }, ...(end ? { end: { dateTime: new Date(end).toISOString() } } : {}), x: { kind: end ? "event" : "reminder", src: "manual" } });
    assert.ok(saved && new Date(saved.start.dateTime).getTime() === start, "the store took " + id);
    return saved;
  };
  const drop = (id) => { stamp += 1000; store.items.remove(id); };
  put("standup", "Standup", local(MON, 10), local(MON, 11));
  put("lunch", "Lunch", local(WED, 12), local(WED, 13));
  put("ping", "Ping Alice", local(WED, 15, 30));
  await store.flush();
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root; root.ownerDocument = document;
  const q = (el, selector) => el.querySelector(selector);
  const layout = q(root, ".zn-all-layout"), panels = q(root, ".zn-all-panels"), calendarPane = q(root, ".zn-calendar-pane");
  layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  panels.getBoundingClientRect = layout.getBoundingClientRect;
  calendarPane.getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await sheet.open(); await flushRaf();
  root.all().find((el) => el.title === "All notes").click(); await flushRaf();

  const PX = 54; // nothing can be measured in the fake DOM, so a fitted hour is 54 px high (OW-03)
  const menuItems = () => root.querySelectorAll(".zn-menu-item");
  const pick = async (trigger, label) => {
    // OW-75: rows of the calendar's Tools menu live in named groups now; the helper walks in for us.
    const entry = trigger === ".zn-calendar-tools"
      ? openCalendarRow(root, trigger, label)
      : (q(root, trigger).click(), menuItems().find((el) => (typeof label === "string" ? el.textContent.trim() === label : label.test(el.textContent.trim()))));
    assert.ok(entry, "the menu offers " + label + "; it has: " + menuItems().map((el) => el.textContent.trim()).join(" | "));
    entry.click();
    await flushRaf();
  };
  const showView = (name) => pick(".zn-calendar-view-select", name);
  // The Size button: the slider in its menu set to `px`, or "Fit to the pane" for "auto".
  const setSize = async (px) => {
    const chip = q(root, ".zn-calendar-size-select");
    chip.click();
    const menu = q(root, ".zn-menu");
    if (px === "auto") menu.querySelector(".zn-menu-slider-fit").click();
    else { const input = menu.querySelector("input"); input.value = String(px); input.dispatchEvent(new Ev("input", { bubbles: true })); }
    chip.click(); // a second press closes the menu
    await flushRaf();
  };
  const toggle = () => q(root, ".zn-calendar-hours-toggle");
  const press = async () => { toggle().click(); await flushRaf(); };
  const labels = () => root.querySelectorAll(".zn-cal-hour-label").map((el) => el.textContent);
  const extendedLabels = () => root.querySelectorAll(".zn-cal-hour-label").filter((el) => el.classList.contains("is-extended")).map((el) => el.textContent);
  const tracks = () => root.querySelectorAll(".zn-cal-time-track");
  const trackOf = (key) => tracks().find((track) => track.getAttribute("data-day") === key);
  const styleOf = (el) => Object.fromEntries(String(el.getAttribute("style") || "").split(";").filter(Boolean).map((part) => part.split(":").map((x) => x.trim())));
  const inTrack = (track, cls) => track.querySelectorAll("." + cls);
  const button = (text) => root.querySelectorAll(".zn-cal-item").find((el) => el.textContent.includes(text));
  const topOf = (text) => parseFloat(button(text).style.top);
  const hint = () => q(root, ".zn-cal-hours-hint");
  const hours = () => store.meta.calendarHours;
  const pointer = (type, x, y, id = 7) => new Ev(type, { bubbles: true, button: 0, pointerId: id, clientX: x, clientY: y });
  // The fake DOM lays nothing out: every track gets the rectangle it would have, columns 100 px wide from x = 0, the
  // timeline from y = 0 with nothing scrolled.
  const arm = () => {
    const all = tracks(), height = parseFloat(all[0].style.height);
    all.forEach((track, i) => { track.getBoundingClientRect = () => ({ left: i * 100, right: (i + 1) * 100, top: 0, bottom: height, width: 100, height }); track.setPointerCapture = () => {}; });
    q(root, ".zn-cal-time-scroll").getBoundingClientRect = () => ({ left: 0, right: all.length * 100, top: 0, bottom: height, width: all.length * 100, height });
    for (const el of root.querySelectorAll(".zn-cal-item")) el.setPointerCapture = () => {};
    for (const el of root.querySelectorAll(".zn-cal-resize-handle")) el.setPointerCapture = () => {};
    return height;
  };
  const dialogButton = (text) => root.querySelectorAll(".zn-dialog-card button").find((el) => el.textContent.trim() === text);
  const startOf = (id) => new Date(store.items.get(id).start.dateTime).getTime();
  const endOf = (id) => new Date(store.items.get(id).end.dateTime).getTime();
  const range = (from, to) => Array.from({ length: to - from }, (_, i) => String(from + i).padStart(2, "0") + ":00");

  await test("the sheet without a display zone on the days the clocks change: items, the current time and a drop are on the wall clock", async () => {
    const SPRING = "2026-03-29", AUTUMN = "2026-10-25"; // both Sundays
    put("breakfast", "Breakfast", local(SPRING, 8), local(SPRING, 9));
    put("matinee", "Matinee", local(SPRING, 14), local(SPRING, 16));
    put("dinner", "Dinner", local(AUTUMN, 19), local(AUTUMN, 20));
    await flushRaf();
    clock = local(SPRING, 10, 30);
    store.setMeta({ calendarCursor: SPRING, calendarHours: { on: true, startMin: 480, endMin: 1200 }, calendarWork: { days: [0, 1, 2, 3, 4, 5, 6], startMin: 540, endMin: 1020 } });
    await showView("Day");
    assert.deepEqual(labels(), range(8, 20), "Breakfast at 08:00 does not open the hour from 07:00");
    assert.equal(hint(), null);
    assert.equal(topOf("Breakfast"), 0, "08:00 is the top of a grid that begins at 08:00");
    assert.equal(topOf("Matinee"), 6 * PX);
    const springTrack = () => trackOf(SPRING);
    assert.deepEqual(inTrack(springTrack(), "zn-cal-now-line").map(styleOf), [{ top: 2.5 * PX + "px" }], "the current time, 10:30, is drawn at 10:30");
    assert.deepEqual(inTrack(springTrack(), "zn-cal-busy-range").map(styleOf), [{ top: "0px", height: PX + "px" }, { top: 6 * PX + "px", height: 2 * PX + "px" }], "the busy bands lie on their events");
    assert.deepEqual(inTrack(springTrack(), "zn-cal-off-hours").map(styleOf), [{ top: "0", height: PX + "px" }, { top: 9 * PX + "px", bottom: "0" }], "working hours 09:00-17:00 are shaded from 09:00 and from 17:00");
    // Matinee (14:00-16:00), grabbed at 14:30 and dropped with the pointer at 11:30, begins at 11:00 and is drawn there.
    arm();
    button("Matinee").dispatchEvent(pointer("pointerdown", 50, 6.5 * PX));
    root.dispatchEvent(pointer("pointermove", 50, 3.5 * PX));
    assert.equal(q(root, ".zn-cal-drag-preview").textContent, SPRING + " 11:00");
    root.dispatchEvent(pointer("pointerup", 50, 3.5 * PX));
    await flushRaf();
    assert.deepEqual([startOf("matinee"), endOf("matinee")], [local(SPRING, 11), local(SPRING, 13)]);
    assert.equal(topOf("Matinee"), 3 * PX, "it is drawn where it was dropped");
    // Its end, stretched from 13:00 to 14:30, is 14:30; its box is three and a half hours high.
    arm();
    const matineeEnd = root.querySelectorAll(".zn-cal-resize-handle").find((el) => el.getAttribute("data-item-id") === "matinee" && el.getAttribute("data-edge") === "end");
    matineeEnd.dispatchEvent(pointer("pointerdown", 50, 5 * PX));
    root.dispatchEvent(pointer("pointermove", 50, 6.5 * PX));
    root.dispatchEvent(pointer("pointerup", 50, 6.5 * PX));
    await flushRaf();
    assert.deepEqual([startOf("matinee"), endOf("matinee")], [local(SPRING, 11), local(SPRING, 14, 30)]);
    assert.deepEqual([topOf("Matinee"), parseFloat(button("Matinee").style.height)], [3 * PX, 3.5 * PX]);
    // A range dragged out from 15:00 to 16:00 is 15:00 to 16:00.
    arm();
    springTrack().dispatchEvent(pointer("pointerdown", 50, 7 * PX));
    root.dispatchEvent(pointer("pointermove", 50, 8 * PX));
    root.dispatchEvent(pointer("pointerup", 50, 8 * PX));
    await flushRaf();
    const card = q(root, ".zn-cal-compose-card");
    assert.deepEqual([q(card, '[aria-label="Start time"]').value, q(card, '[aria-label="End time"]').value], ["15:00", "16:00"]);
    dialogButton("Cancel").click(); await flushRaf();

    clock = local(AUTUMN, 21, 15);
    store.setMeta({ calendarCursor: AUTUMN });
    await showView("Day");
    assert.deepEqual(labels(), range(8, 20), "Dinner, which ends at 20:00, does not open the hour from 20:00");
    assert.equal(topOf("Dinner"), 11 * PX, "19:00 is drawn at 19:00");
    assert.equal(inTrack(trackOf(AUTUMN), "zn-cal-now-line").length, 0);
    assert.ok(inTrack(trackOf(AUTUMN), "zn-cal-now-edge")[0].classList.contains("is-after"), "21:15 lies after the hours shown");
    put("lateshow", "Late show", local(AUTUMN, 23), local(AUTUMN, 23, 30));
    await flushRaf();
    assert.deepEqual(labels(), range(8, 24), "an event at 23:00 opens the hours until midnight");
    assert.equal(topOf("Late show"), 15 * PX, "and is drawn in the last one, not below the grid");
    assert.equal(hint().textContent, "Extended: until 23:30 Late show");
    assert.deepEqual(inTrack(trackOf(AUTUMN), "zn-cal-now-line").map(styleOf), [{ top: 13.25 * PX + "px" }], "21:15 is among the hours now: a line at 21:15");
    await press(); // T2.4c4: all 25 real hours on the autumn DST fall-back day (02:00 occurs twice)
    assert.equal(labels().length, 25);
    assert.equal(topOf("Late show"), 24 * PX);
    assert.equal(topOf("Dinner"), 20 * PX);
    assert.deepEqual(root.querySelectorAll(".zn-cal-now-line").map(styleOf), [{ top: 22.25 * PX + "px" }]);
  }, "warsaw");

  await test("off (the default): Week and Day are the whole day, as before; the toolbar button is there for them only", async () => {
    assert.deepEqual(JSON.parse(JSON.stringify(hours())), { on: false, startMin: 480, endMin: 1200 });
    assert.equal(toggle().hidden, true, "Month has no hours: no button");
    await showView("Week");
    assert.equal(toggle().hidden, false);
    assert.deepEqual([toggle().textContent, toggle().getAttribute("aria-pressed"), toggle().classList.contains("is-on")], ["08–20", "false", false]);
    assert.deepEqual(labels(), range(0, 24));
    assert.equal(tracks().length, 7);
    assert.ok(tracks().every((track) => track.style.height === 24 * PX + "px"));
    assert.equal(inTrack(trackOf(WED), "zn-cal-time-hour-line").length, 24);
    assert.equal(topOf("Lunch"), 12 * PX);
    assert.equal(q(root, ".zn-cal-time-view").dataset.hours, "all");
    assert.equal(q(root, ".zn-cal-time-scroll").getAttribute("aria-label"), "24-hour timeline");
    assert.equal(hint(), null);
    assert.equal(extendedLabels().length, 0);
    assert.equal(root.querySelectorAll(".zn-cal-hours-extra").length, 0);
    await showView("Day");
    assert.equal(toggle().hidden, false);
    assert.deepEqual(labels(), range(0, 24));
    await showView("Agenda");
    assert.equal(toggle().hidden, true);
  });

  await test("one press on the toolbar button: only 08:00-20:00, everything placed from 08:00; a second press: all 24 again", async () => {
    await showView("Week");
    await press();
    assert.deepEqual(JSON.parse(JSON.stringify(hours())), { on: true, startMin: 480, endMin: 1200 });
    assert.deepEqual([toggle().getAttribute("aria-pressed"), toggle().classList.contains("is-on")], ["true", true]);
    assert.deepEqual(labels(), range(8, 20), "twelve hours, 08:00 first");
    assert.ok(tracks().every((track) => track.style.height === 12 * PX + "px"), "every day column is twelve hours high");
    assert.equal(inTrack(trackOf(WED), "zn-cal-time-hour-line").length, 12);
    assert.equal(q(root, ".zn-cal-time-view").style.getPropertyValue("--zn-cal-hours"), "12", "the style sheet is told how many hours there are");
    assert.equal(q(root, ".zn-cal-time-view").dataset.hours, "limited");
    assert.equal(q(root, ".zn-cal-time-scroll").getAttribute("aria-label"), "Timeline 08:00 to 20:00");
    assert.equal(topOf("Lunch"), 4 * PX, "12:00 is four hours below 08:00");
    assert.equal(topOf("Standup"), 2 * PX);
    assert.equal(topOf("Ping Alice"), 7.5 * PX, "a reminder likewise");
    assert.equal(parseFloat(button("Lunch").style.height), PX, "an hour is still an hour high");
    assert.equal(hint(), null, "nothing in view lies outside: no hint");
    assert.equal(root.querySelectorAll(".zn-cal-hours-extra").length, 0);
    // Working hours (09:00-17:00) shade what is outside them, inside the grid.
    const shade = inTrack(trackOf(WED), "zn-cal-off-hours").map(styleOf);
    assert.deepEqual(shade, [{ top: "0", height: PX + "px" }, { top: 9 * PX + "px", bottom: "0" }], "08:00-09:00 and 17:00-20:00 are shaded");
    const busy = inTrack(trackOf(WED), "zn-cal-busy-range").map(styleOf);
    assert.deepEqual(busy, [{ top: 4 * PX + "px", height: PX + "px" }], "the busy band of Lunch lies on Lunch");
    await showView("Day");
    assert.deepEqual(labels(), range(8, 20), "Day view too");
    await press();
    assert.equal(hours().on, false);
    assert.deepEqual(labels(), range(0, 24));
    assert.equal(topOf("Lunch"), 12 * PX);
    assert.deepEqual([hours().startMin, hours().endMin], [480, 1200], "switching off keeps the chosen hours for the next time");
  });

  await test("a day in view with an item outside widens the grid by whole hours, marks them and says why", async () => {
    await showView("Week");
    await press();
    put("early", "Early call", local(TUE, 6, 10), local(TUE, 7));
    await flushRaf();
    assert.deepEqual(labels(), range(6, 20), "the week now begins at 06:00");
    assert.deepEqual(extendedLabels(), ["06:00", "07:00"], "the two added hours are marked in the gutter");
    assert.ok(tracks().every((track) => track.style.height === 14 * PX + "px"));
    for (const track of tracks()) {
      const extra = inTrack(track, "zn-cal-hours-extra");
      assert.equal(extra.length, 1, "every day column marks the added part");
      assert.ok(extra[0].classList.contains("is-top"));
      assert.deepEqual(styleOf(extra[0]), { top: "0", height: 2 * PX + "px" }, "from the top down to 08:00");
    }
    assert.equal(topOf("Early call"), (10 / 60) * PX, "06:10 is ten minutes below the top");
    assert.equal(topOf("Lunch"), 6 * PX, "and everything else is placed from 06:00");
    assert.equal(hint().textContent, "Extended: 06:10 Early call");
    assert.equal(hint().getAttribute("role"), "status");
    assert.match(hint().title, /08:00–20:00/);

    put("late", "Late reminder", local(THU, 21, 50));
    await flushRaf();
    assert.deepEqual(labels(), range(6, 22), "a reminder at 21:50 opens the hours until 22:00, no further");
    assert.deepEqual(extendedLabels(), ["06:00", "07:00", "20:00", "21:00"]);
    assert.ok(topOf("Late reminder") > 15 * PX && topOf("Late reminder") + 20 <= 16 * PX, "its box, 20 px high, ends with the grid instead of hanging out of it");
    const below = inTrack(trackOf(WED), "zn-cal-hours-extra").filter((el) => el.classList.contains("is-bottom"));
    assert.deepEqual(below.map(styleOf), [{ top: 14 * PX + "px", bottom: "0" }], "from 20:00 to the bottom");
    assert.equal(hint().textContent, "Extended: 06:10 Early call · 21:50 Late reminder");

    await showView("Day"); // Wednesday: nothing outside the hours on that day
    assert.deepEqual(labels(), range(8, 20), "the day view of a day without them is not widened");
    assert.equal(hint(), null);
    assert.equal(root.querySelectorAll(".zn-cal-hours-extra").length, 0);
    store.setMeta({ calendarCursor: TUE });
    await showView("Day");
    assert.deepEqual(labels(), range(6, 20), "Tuesday's own day view is");
    assert.equal(hint().textContent, "Extended: 06:10 Early call");
    put("evening", "Evening course", local(TUE, 18), local(TUE, 21, 30));
    await flushRaf();
    assert.equal(hint().textContent, "Extended: 06:10 Early call · until 21:30 Evening course", "an event is named with the time it ends");
    put("allday", "Whole Tuesday", local(TUE, 5), local(TUE, 23)); // one item beyond both ends
    await flushRaf();
    assert.equal(hint().textContent, "Extended: 05:00–23:00 Whole Tuesday");
    drop("allday"); drop("evening"); drop("late");
    store.setMeta({ calendarCursor: "" });
    await showView("Week");
    assert.deepEqual(labels(), range(6, 20));
  });

  await test("a reminder or a short event just before the end is drawn inside the grid and adds no hour", async () => {
    await showView("Day"); // Wednesday, 08:00-20:00
    const box = (text) => { const el = button(text); return { top: parseFloat(el.style.top), bottom: parseFloat(el.style.top) + parseFloat(el.style.height), left: el.style.left, width: el.style.width }; };
    put("wrapup", "Wrap-up", local(WED, 19), local(WED, 19, 45));
    put("lastcall", "Last call", local(WED, 19, 50));
    put("quick", "Quick word", local(WED, 19, 52), local(WED, 19, 57));
    await flushRaf();
    assert.deepEqual(labels(), range(8, 20), "19:50 and 19:52-19:57 lie inside 08:00-20:00: no hour is added");
    assert.equal(hint(), null);
    const height = 12 * PX, call = box("Last call"), word = box("Quick word"), wrap = box("Wrap-up");
    assert.ok(call.bottom <= height && call.bottom > height - 2, "the reminder's box ends with the grid (it would end at 20:13); bottom " + call.bottom);
    assert.ok(word.bottom <= height && word.bottom > height - 2, "the short event's box too; bottom " + word.bottom);
    assert.equal(wrap.bottom, 11.75 * PX, "an event that is long enough is where it is");
    // Moved up, the two boxes begin before Wrap-up ends: all three get a lane of their own and none covers another.
    assert.deepEqual([wrap.width, call.width, word.width].map((w) => Math.round(parseFloat(w))), [33, 33, 33]);
    assert.equal(new Set([wrap.left, call.left, word.left]).size, 3, "three lanes");
    assert.match(button("Last call").getAttribute("aria-label"), /^Last call, 19:50 reminder/, "what it says is the time it has");
    // Nothing reaches below the grid, the 8 px resize grips neither: what does gives the timeline a few px to scroll.
    const grips = root.querySelectorAll(".zn-cal-resize-handle").map((el) => ({ id: el.getAttribute("data-item-id"), edge: el.getAttribute("data-edge"), top: parseFloat(el.style.top) }));
    assert.ok(grips.some((grip) => grip.id === "quick" && grip.edge === "end"), "the short event has its grips");
    for (const grip of grips.filter((g) => g.edge === "end")) assert.ok(grip.top + 8 <= height, `the end grip of ${grip.id} ends inside the grid (top ${grip.top})`);
    assert.equal(grips.find((grip) => grip.id === "wrapup" && grip.edge === "end").top, wrap.bottom - 4, "elsewhere a grip sits astride the edge it moves");
    // A drag is a distance: Quick word, taken where it is drawn and moved up by two hours, begins at 17:52 -> 17:45 by the 15-minute snap.
    arm();
    button("Quick word").dispatchEvent(pointer("pointerdown", 50, word.top + 5));
    root.dispatchEvent(pointer("pointermove", 50, word.top + 5 - 2 * PX));
    root.dispatchEvent(pointer("pointerup", 50, word.top + 5 - 2 * PX));
    await flushRaf();
    assert.deepEqual([startOf("quick"), endOf("quick")], [local(WED, 17, 45), local(WED, 17, 50)]);
    // The whole day: a reminder at 23:50 ends with the day (before, its box hung out below midnight).
    put("midnight", "Almost midnight", local(WED, 23, 50));
    await flushRaf();
    assert.deepEqual(labels(), range(8, 24));
    assert.ok(box("Almost midnight").bottom <= 16 * PX, "inside a grid that ends at 24:00");
    await press(); // all 24 hours
    assert.ok(box("Almost midnight").bottom <= 24 * PX && box("Almost midnight").bottom > 24 * PX - 2, "and inside the whole day");
    assert.equal(box("Last call").top, 19 * PX + (50 / 60) * PX, "where there is room, a reminder is at its time");
    await press();
    drop("wrapup"); drop("lastcall"); drop("quick"); drop("midnight");
    // Anywhere in the grid: two events of five minutes, five minutes apart. Each box is 20 px high, so the second
    // would begin inside the first; they stand side by side instead, like two reminders do.
    put("hello", "Hello", local(WED, 9), local(WED, 9, 5));
    put("again", "Again", local(WED, 9, 10), local(WED, 9, 15));
    put("remind", "Remind", local(WED, 10));
    put("remind2", "Remind once more", local(WED, 10, 10));
    await flushRaf();
    assert.deepEqual(labels(), range(8, 20));
    const hello = box("Hello"), again = box("Again");
    assert.deepEqual([hello.top, Math.round(again.top)], [PX, PX + 9], "each at its own time (09:00 and 09:10)");
    assert.ok(hello.bottom > again.top, "their boxes share 11 px of height");
    assert.ok(hello.left !== again.left && Math.round(parseFloat(hello.width)) === 50 && Math.round(parseFloat(again.width)) === 50, `so each has half the width; left ${hello.left} / ${again.left}, width ${hello.width} / ${again.width}`);
    assert.ok(box("Remind").left !== box("Remind once more").left, "two reminders ten minutes apart: side by side, as before");
    drop("hello"); drop("again"); drop("remind"); drop("remind2");
    // One after another with nothing between them: a box may reach 4 px over the next one, not more. At 36 px an hour
    // half an hour is 18 px, so three half-hour events keep one lane and the whole width (in 3.3.173 they stood side
    // by side); three quarter-hour events, 9 px apart, cannot.
    await setSize(36);
    put("half1", "Half one", local(WED, 9), local(WED, 9, 30));
    put("half2", "Half two", local(WED, 9, 30), local(WED, 10));
    put("half3", "Half three", local(WED, 10), local(WED, 10, 30));
    put("quarter1", "Quarter one", local(WED, 14), local(WED, 14, 15));
    put("quarter2", "Quarter two", local(WED, 14, 15), local(WED, 14, 30));
    await flushRaf();
    const halves = ["Half one", "Half two", "Half three"].map(box);
    assert.deepEqual(halves.map((b) => [b.top, b.bottom - b.top, b.left, b.width]), [[36, 20, "0%", "100%"], [54, 20, "0%", "100%"], [72, 20, "0%", "100%"]], "half-hour events in a row: one lane, each 2 px over the next");
    assert.ok(box("Quarter one").left !== box("Quarter two").left && box("Quarter one").width === "50%", "quarter-hour events in a row: side by side");
    await setSize("auto");
    const wide = ["Half one", "Half two", "Half three"].map(box);
    assert.deepEqual(wide.map((b) => [b.top, b.bottom - b.top, b.width]), [[54, 27, "100%"], [81, 27, "100%"], [108, 27, "100%"]], "at 54 px an hour they are simply as long as they are");
    drop("half1"); drop("half2"); drop("half3"); drop("quarter1"); drop("quarter2");
    await flushRaf();
    await showView("Week");
  });

  await test("the style sheet: the grid is as high as the hours it shows; the hatching takes no presses; a hidden button is not shown", async () => {
    // The fake DOM lays nothing out, so these are the declarations that win for the real elements.
    const { parseCss, cascade } = require("./helpers/css-cascade.cjs");
    const sheetCss = parseCss(fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8"));
    const style = (el) => cascade(sheetCss, el);
    await showView("Week"); // 06:00-20:00, widened above for Early call
    assert.equal(root.querySelectorAll(".zn-cal-hours-extra").length, 7);
    // Without this the row keeps the height of 24 hours and a grid of 14 has ten hours of nothing below it.
    assert.equal(style(q(root, ".zn-cal-time-grid-row")).get("min-height"), "calc(var(--zn-cal-hours, 24) * var(--zn-cal-hour-height, 54px))");
    assert.equal(q(root, ".zn-cal-time-view").style.getPropertyValue("--zn-cal-hours"), "14");
    const extra = style(q(root, ".zn-cal-hours-extra"));
    assert.deepEqual([extra.get("position"), extra.get("pointer-events"), extra.get("left"), extra.get("right")], ["absolute", "none", "0", "0"], "the hatching spans the column and lets presses through to the grid");
    assert.ok(Number(extra.get("z-index")) < 2, "and lies under the items");
    const line = style(hint());
    assert.deepEqual([line.get("white-space"), line.get("overflow-x"), line.get("text-overflow"), line.get("flex-shrink")], ["nowrap", "hidden", "ellipsis", "0"], "the hint is one line that is cut off, never a second line that pushes the grid down");
    const addedLabel = root.querySelectorAll(".zn-cal-hour-label").find((el) => el.classList.contains("is-extended"));
    assert.equal(addedLabel.textContent, "06:00");
    assert.equal(style(addedLabel).get("color"), "var(--zn-accent)", "an added hour is told apart in the gutter");
    assert.notEqual(style(toggle()).get("display"), "none");
    await showView("Month");
    assert.equal(toggle().hidden, true);
    assert.equal(style(toggle()).get("display"), "none", "hidden is hidden, although a chip is a flex box");
    await showView("Day");
    const redraw = async () => { q(root, ".zn-calendar-today").click(); await flushRaf(); };
    clock = local(WED, 6, 12); await redraw(); // Wednesday has nothing outside 08:00-20:00: the current time is before the grid
    const edge = q(root, ".zn-cal-now-edge");
    assert.ok(edge, "the mark of a current time outside the hours");
    assert.deepEqual([style(edge).get("position"), style(edge).get("top")], ["absolute", "0"], "before the hours: on the top edge");
    clock = local(WED, 21, 40); await redraw();
    assert.deepEqual([style(q(root, ".zn-cal-now-edge")).get("position"), style(q(root, ".zn-cal-now-edge")).get("bottom")], ["absolute", "0"], "after them: on the bottom edge");
    clock = local(WED, 10, 30); await redraw();
    await showView("Week");
  });

  await test("an update of one day keeps the timeline while the hours hold, and draws the grid again when they change", async () => {
    await showView("Week");
    assert.deepEqual(labels(), range(6, 20));
    const timeline = q(root, ".zn-cal-time-scroll"), mondayTrack = trackOf(MON);
    put("review", "Review", local(THU, 14), local(THU, 15));
    await flushRaf();
    assert.ok(q(root, ".zn-cal-time-scroll") === timeline && trackOf(MON) === mondayTrack, "an item inside the hours: only Thursday's column is replaced");
    assert.equal(topOf("Review"), 8 * PX);

    // The reason for the extension moves within the same hour: same hours, another text.
    put("early", "Early call", local(TUE, 6, 40), local(TUE, 7));
    await flushRaf();
    assert.ok(q(root, ".zn-cal-time-scroll") === timeline && trackOf(MON) === mondayTrack, "still the same timeline");
    assert.equal(hint().textContent, "Extended: 06:40 Early call", "the hint follows");
    assert.equal(topOf("Early call"), (40 / 60) * PX);

    // An item before 06:00 arrives: the grid has to begin earlier, so every column moves.
    put("dawn", "Dawn run", local(THU, 4, 30), local(THU, 5));
    await flushRaf();
    assert.deepEqual(labels(), range(4, 20));
    assert.ok(trackOf(MON) !== mondayTrack, "the whole grid was drawn again");
    assert.ok(tracks().every((track) => track.style.height === 16 * PX + "px"));
    assert.equal(topOf("Standup"), 6 * PX, "Monday's item is placed from 04:00 although Monday did not change");
    assert.equal(topOf("Dawn run"), 0.5 * PX);
    assert.equal(hint().textContent, "Extended: 04:30 Dawn run");

    // It goes away again: the grid shrinks back to what the rest needs.
    drop("dawn");
    await flushRaf();
    assert.deepEqual(labels(), range(6, 20));
    assert.equal(topOf("Standup"), 4 * PX);
    drop("early"); drop("review");
    await flushRaf();
    assert.deepEqual(labels(), range(8, 20), "nothing outside any more: the chosen hours");
    assert.equal(hint(), null);
  });

  await test("dragging in a grid that begins at 08:00: a position is a time counted from 08:00", async () => {
    await showView("Day"); // Wednesday, 08:00-20:00, Lunch 12:00-13:00
    assert.deepEqual(labels(), range(8, 20));
    assert.equal(arm(), 12 * PX);
    // Drag out a new event on the empty grid: one hour below the top to three hours below the top.
    trackOf(WED).dispatchEvent(pointer("pointerdown", 50, PX));
    root.dispatchEvent(pointer("pointermove", 50, 3 * PX));
    const preview = q(root, ".zn-cal-drag-preview");
    assert.ok(preview, "a preview follows the pointer");
    assert.equal(preview.style.top, 3 * PX + "px", "it lies where the pointer is");
    assert.equal(preview.textContent, WED + " 11:00", "and names the time under the pointer");
    root.dispatchEvent(pointer("pointerup", 50, 3 * PX));
    await flushRaf();
    let card = q(root, ".zn-cal-compose-card");
    assert.ok(card, "releasing opens the composer");
    assert.deepEqual([q(card, '[aria-label="Start time"]').value, q(card, '[aria-label="End time"]').value], ["09:00", "11:00"], "09:00 to 11:00, not 01:00 to 03:00");
    dialogButton("Cancel").click(); await flushRaf();

    // Move Lunch: grabbed half an hour into it, dropped with the pointer at 15:30, it begins at 15:00.
    arm();
    button("Lunch").dispatchEvent(pointer("pointerdown", 50, 4.5 * PX));
    root.dispatchEvent(pointer("pointermove", 50, 7.5 * PX));
    assert.equal(q(root, ".zn-cal-drag-preview").textContent, WED + " 15:00");
    root.dispatchEvent(pointer("pointerup", 50, 7.5 * PX));
    await flushRaf();
    assert.deepEqual([startOf("lunch"), endOf("lunch")], [local(WED, 15), local(WED, 16)]);
    assert.equal(topOf("Lunch"), 7 * PX, "drawn where it was dropped");

    // Stretch its end from 16:00 to 17:30.
    arm();
    const endHandle = root.querySelectorAll(".zn-cal-resize-handle").find((el) => el.getAttribute("data-item-id") === "lunch" && el.getAttribute("data-edge") === "end");
    endHandle.dispatchEvent(pointer("pointerdown", 50, 8 * PX));
    root.dispatchEvent(pointer("pointermove", 50, 9.5 * PX));
    root.dispatchEvent(pointer("pointerup", 50, 9.5 * PX));
    await flushRaf();
    assert.deepEqual([startOf("lunch"), endOf("lunch")], [local(WED, 15), local(WED, 17, 30)]);
    assert.equal(parseFloat(button("Lunch").style.height), 2.5 * PX);
  });

  await test("an item dropped outside the hours stays where it was dropped: the grid widens for it after the drop", async () => {
    // Lunch is 15:00-17:30. Grabbed near its end (17:15) and dropped with the pointer at 08:15, it begins at 06:00.
    arm();
    button("Lunch").dispatchEvent(pointer("pointerdown", 50, 9.25 * PX));
    root.dispatchEvent(pointer("pointermove", 50, 0.25 * PX));
    assert.deepEqual(labels(), range(8, 20), "nothing moves while the pointer is down");
    root.dispatchEvent(pointer("pointerup", 50, 0.25 * PX));
    await flushRaf();
    assert.deepEqual([startOf("lunch"), endOf("lunch")], [local(WED, 6), local(WED, 8, 30)]);
    assert.deepEqual(labels(), range(6, 20), "the grid now begins at 06:00");
    assert.equal(topOf("Lunch"), 0);
    assert.equal(hint().textContent, "Extended: 06:00 Lunch");
    // In the widened grid a position is counted from 06:00: one hour down is 07:00.
    assert.equal(arm(), 14 * PX);
    trackOf(WED).dispatchEvent(pointer("pointerdown", 50, 10 * PX));
    root.dispatchEvent(pointer("pointermove", 50, 11 * PX));
    root.dispatchEvent(pointer("pointerup", 50, 11 * PX));
    await flushRaf();
    const card = q(root, ".zn-cal-compose-card");
    assert.deepEqual([q(card, '[aria-label="Start time"]').value, q(card, '[aria-label="End time"]').value], ["16:00", "17:00"]);
    dialogButton("Cancel").click(); await flushRaf();
    // Undo puts Lunch back and the grid shrinks with it.
    q(root, ".zn-calendar-undo-move").click(); await flushRaf();
    assert.deepEqual([startOf("lunch"), endOf("lunch")], [local(WED, 15), local(WED, 17, 30)]);
    assert.deepEqual(labels(), range(8, 20));
    assert.equal(hint(), null);
  });

  await test("the grid does not shrink under a drag or an open dialog: it waits until that is over", async () => {
    put("early", "Early call", local(WED, 6, 10), local(WED, 7));
    await flushRaf();
    assert.deepEqual(labels(), range(6, 20));
    // A drag is in progress when the early item disappears (another window deleted it).
    arm();
    const timeline = q(root, ".zn-cal-time-scroll");
    button("Lunch").dispatchEvent(pointer("pointerdown", 50, 9.5 * PX));
    root.dispatchEvent(pointer("pointermove", 50, 10 * PX));
    drop("early");
    await flushRaf();
    assert.deepEqual(labels(), range(6, 20), "the grid under the pointer is untouched");
    assert.ok(q(root, ".zn-cal-time-scroll") === timeline);
    root.dispatchEvent(new Ev("keydown", { key: "Escape", bubbles: true })); // give the drag up
    root.dispatchEvent(pointer("pointerup", 50, 10 * PX));
    await flushRaf();
    assert.deepEqual(labels(), range(8, 20), "once the drag is over the grid goes back to the chosen hours");
    assert.deepEqual([startOf("lunch"), endOf("lunch")], [local(WED, 15), local(WED, 17, 30)], "(the abandoned drag moved nothing)");

    // The same with the composer open on a range that was dragged out.
    put("early", "Early call", local(WED, 6, 10), local(WED, 7));
    await flushRaf();
    assert.deepEqual(labels(), range(6, 20));
    arm();
    trackOf(WED).dispatchEvent(pointer("pointerdown", 50, 4 * PX));
    root.dispatchEvent(pointer("pointermove", 50, 5 * PX));
    root.dispatchEvent(pointer("pointerup", 50, 5 * PX));
    await flushRaf();
    assert.ok(q(root, ".zn-cal-compose-card"), "the composer is open");
    drop("early");
    await flushRaf();
    assert.deepEqual(labels(), range(6, 20), "the grid behind the composer is untouched");
    dialogButton("Cancel").click(); await flushRaf();
    assert.deepEqual(labels(), range(8, 20), "and catches up when the composer closes");
  });

  await test("the current time: a line inside the hours, a mark on the edge when it lies outside; it never widens the grid", async () => {
    const redraw = async () => { q(root, ".zn-calendar-today").click(); await flushRaf(); };
    const nowLine = () => inTrack(trackOf(WED), "zn-cal-now-line"), nowEdge = () => inTrack(trackOf(WED), "zn-cal-now-edge");
    await redraw(); // 10:30
    assert.deepEqual(nowLine().map(styleOf), [{ top: 2.5 * PX + "px" }], "10:30 is two and a half hours below 08:00");
    assert.equal(nowEdge().length, 0);

    clock = local(WED, 6, 12); await redraw();
    assert.deepEqual(labels(), range(8, 20), "06:12 does not open the grid");
    assert.equal(nowLine().length, 0, "no line: it would be drawn at a time that is not in the grid");
    assert.equal(nowEdge().length, 1);
    assert.ok(nowEdge()[0].classList.contains("is-before") && !nowEdge()[0].classList.contains("is-after"));
    assert.equal(nowEdge()[0].getAttribute("aria-label"), "Current time 06:12, before the hours shown");
    assert.equal(hint(), null);

    clock = local(WED, 21, 40); await redraw();
    assert.equal(nowLine().length, 0);
    assert.ok(nowEdge()[0].classList.contains("is-after"));
    assert.equal(nowEdge()[0].getAttribute("aria-label"), "Current time 21:40, after the hours shown");

    clock = local(WED, 20, 0); await redraw();
    assert.deepEqual(nowLine().map(styleOf), [{ top: 12 * PX + "px" }], "20:00 sharp is the bottom line of the grid");

    await showView("Week");
    clock = local(WED, 6, 12); await redraw();
    assert.equal(root.querySelectorAll(".zn-cal-now-edge").length, 1, "in Week only today's column carries the mark");
    assert.equal(nowEdge().length, 1);

    await press(); // all 24 hours
    assert.deepEqual(root.querySelectorAll(".zn-cal-now-line").map(styleOf), [{ top: 6.2 * PX + "px" }], "with all hours shown it is a line again");
    assert.equal(root.querySelectorAll(".zn-cal-now-edge").length, 0);
    await press();
    clock = local(WED, 10, 30); await redraw();
  });

  await test("the same time stays at the top of the timeline when the grid begins at another hour", async () => {
    await showView("Week");
    assert.deepEqual(labels(), range(8, 20));
    q(root, ".zn-cal-time-scroll").scrollTop = 2 * PX; // 10:00 at the top
    await press(); // all 24 hours
    assert.equal(q(root, ".zn-cal-time-scroll").scrollTop, 10 * PX, "10:00 is still at the top");
    await press(); // 08:00-20:00
    assert.equal(q(root, ".zn-cal-time-scroll").scrollTop, 2 * PX);
    put("early", "Early call", local(TUE, 6, 10), local(TUE, 7));
    await flushRaf();
    assert.deepEqual(labels(), range(6, 20));
    assert.equal(q(root, ".zn-cal-time-scroll").scrollTop, 4 * PX, "widened by two hours above: 10:00 is still at the top");
    q(root, ".zn-cal-time-scroll").scrollTop = 0; // 06:00 at the top
    drop("early");
    await flushRaf();
    assert.equal(q(root, ".zn-cal-time-scroll").scrollTop, 0, "the hours above are gone: the top of the grid");
    // A timeline held to some hours that is at its very top stays there when hours are added above, so the item they
    // were added for is in sight (the same time at the top would hide it and its hours above the edge).
    put("early", "Early call", local(TUE, 6, 10), local(TUE, 7));
    await flushRaf();
    assert.deepEqual(labels(), range(6, 20));
    assert.equal(q(root, ".zn-cal-time-scroll").scrollTop, 0, "06:00 is at the top now");
    // Not so for the button: all 24 hours keep the time that was at the top (06:00), they do not jump to midnight.
    await press();
    assert.equal(q(root, ".zn-cal-time-scroll").scrollTop, 6 * PX);
    await press();
    assert.equal(q(root, ".zn-cal-time-scroll").scrollTop, 0);
    drop("early");
    await flushRaf();
  });

  await test("Tools > Visible hours: other hours, the working hours as a starting point, input that makes no sense", async () => {
    const open = async () => { await pick(".zn-calendar-tools", /^Visible hours: /); return q(root, ".zn-dialog-card"); };
    const hoursRow = openCalendarRow(root, ".zn-calendar-tools", "Visible hours: 08:00–20:00…");
    assert.ok(hoursRow, "the menu names the hours in use; it has: " + menuItems().map((el) => el.textContent.trim()).join(" | "));
    root.dispatchEvent(new Ev("keydown", { key: "Escape", bubbles: true }));
    let card = await open();
    const limit = () => q(card, '[aria-label="Show only these hours in Week and Day"]');
    const from = () => q(card, '[aria-label="First hour shown (0 to 23)"]'), to = () => q(card, '[aria-label="Hour the grid ends at (1 to 24)"]');
    assert.deepEqual([limit().checked, from().value, to().value], [true, "8", "20"], "it opens with what is in use");
    q(root, ".zn-cal-time-scroll").scrollTop = 0; // 08:00 at the top
    from().value = "7"; to().value = "22";
    dialogButton("Apply").click(); await flushRaf();
    assert.equal(q(root, ".zn-dialog-card"), null, "applied and closed");
    assert.equal(q(root, ".zn-cal-time-scroll").scrollTop, 0, "a timeline at its top shows the earlier first hour that was asked for");
    assert.deepEqual(JSON.parse(JSON.stringify(hours())), { on: true, startMin: 420, endMin: 1320 });
    assert.deepEqual(labels(), range(7, 22));
    assert.equal(toggle().textContent, "07–22", "the toolbar button names the new hours");
    assert.equal(toggle().getAttribute("aria-label"), "Show only 07:00–22:00");

    card = await open();
    for (const [a, b, bad] of [["9", "9", "to"], ["12", "8", "to"], ["", "20", "from"], ["24", "25", "from"], ["8", "25", "to"], ["8.5", "20", "from"], ["-1", "20", "from"], ["8", "x", "to"]]) {
      from().value = a; to().value = b;
      dialogButton("Apply").click(); await flushRaf();
      assert.ok(q(root, ".zn-dialog-card") === card, `"${a}" to "${b}" is refused and the dialog stays`);
      assert.deepEqual([from().dataset.bad === "true", to().dataset.bad === "true"], [bad === "from", bad === "to"], `"${a}" to "${b}": the ${bad} field is marked`);
      assert.deepEqual(JSON.parse(JSON.stringify(hours())), { on: true, startMin: 420, endMin: 1320 }, "nothing is stored");
    }
    const preset = card.querySelectorAll("button").find((el) => /^Use working hours/.test(el.textContent.trim()));
    assert.equal(preset.textContent.trim(), "Use working hours (09:00–17:00)");
    limit().checked = false;
    preset.click();
    assert.deepEqual([limit().checked, from().value, to().value], [true, "9", "17"], "the working hours fill the fields and switch the limit on");
    dialogButton("Cancel").click(); await flushRaf();
    assert.deepEqual(JSON.parse(JSON.stringify(hours())), { on: true, startMin: 420, endMin: 1320 }, "Cancel stores nothing");

    card = await open();
    from().value = "0"; to().value = "24"; limit().checked = false;
    from().dispatchEvent(new Ev("keydown", { key: "Enter", bubbles: true })); await flushRaf();
    assert.equal(q(root, ".zn-dialog-card"), null, "Enter in a field applies");
    assert.deepEqual(JSON.parse(JSON.stringify(hours())), { on: false, startMin: 0, endMin: 1440 });
    assert.deepEqual(labels(), range(0, 24));
    assert.ok(openCalendarRow(root, ".zn-calendar-tools", "Visible hours: all 24…"), "with the limit off the menu says all 24");
    root.dispatchEvent(new Ev("keydown", { key: "Escape", bubbles: true }));
    card = await open();
    from().value = "8"; to().value = "20"; limit().checked = true;
    dialogButton("Apply").click(); await flushRaf();
    assert.deepEqual(labels(), range(8, 20));
  });

  await test("\"When am I free?\" looks inside the hours shown while the grid is held to them", async () => {
    const open = async () => { await pick(".zn-calendar-tools", "When am I free?…"); return q(root, ".zn-dialog-card"); };
    const slots = () => root.querySelectorAll(".zn-cal-free-slot").map((el) => el.textContent.split(" · ")[1]);
    let card = await open();
    const hoursOnly = () => q(card, '[aria-label="Only within the visible hours"]'), workOnly = () => q(card, '[aria-label="Only working hours"]');
    assert.ok(hoursOnly(), "the dialog offers the hours shown");
    assert.equal(hoursOnly().checked, true);
    assert.ok(card.querySelectorAll("label").some((el) => el.textContent.includes("Only within the visible hours (08:00–20:00)")));
    q(card, '[aria-label="From date"]').value = MON; q(card, '[aria-label="Through date"]').value = MON;
    workOnly().checked = false;
    dialogButton("Find free times").click();
    assert.deepEqual(slots(), ["08:00–10:00", "11:00–20:00"], "Monday has Standup 10:00-11:00: free before and after it, inside 08:00-20:00");
    hoursOnly().checked = false;
    dialogButton("Find free times").click();
    assert.equal(slots()[0].slice(0, 5), "00:00", "without it the search starts at midnight, as before");
    workOnly().checked = true; hoursOnly().checked = true;
    dialogButton("Find free times").click();
    assert.deepEqual(slots(), ["09:00–10:00", "11:00–17:00"], "with working hours as well: what lies in both");
    dialogButton("Close").click(); await flushRaf();
    await press(); // all 24 hours
    card = await open();
    assert.equal(hoursOnly(), null, "with all hours shown there is nothing to offer");
    dialogButton("Close").click(); await flushRaf();
    await press();
  });

  await test("an all-day reminder is in the all-day row whatever the display zone is, also on the first day shown", async () => {
    // Pago Pago is behind every zone a computer of this test runs in: its day begins hours after the computer's
    // midnight, which is where an all-day reminder begins. Until 3.3.174 the first day shown lost its all-day
    // reminders that way (in Day view: the day), while all-day events stayed.
    stamp += 1000;
    for (const [id, summary, date, kind] of [["allday-mon", "Pay the rent", MON, "reminder"], ["allday-wed", "Renew the pass", WED, "reminder"], ["allday-wed-event", "Conference", WED, "event"]]) {
      assert.ok(store.items.upsert({ id, summary, start: { date }, x: { kind, src: "manual" } }), "the store took " + id);
    }
    await flushRaf();
    const allDayOf = (key) => root.querySelectorAll(".zn-cal-time-allday-cell").find((cell) => cell.getAttribute("data-day") === key).querySelectorAll(".zn-cal-item").map((el) => el.textContent.replace(/^All day/, "").trim()).sort();
    for (const zone of ["", "Pacific/Pago_Pago", "Pacific/Kiritimati"]) {
      store.setMeta({ calendarDisplayZone: zone, calendarCursor: WED });
      await showView("Week");
      assert.deepEqual(allDayOf(MON), ["Pay the rent"], `Week, display zone "${zone}": the reminder of Monday, the first day shown`);
      assert.deepEqual(allDayOf(WED), ["Conference", "Renew the pass"], `Week, display zone "${zone}": Wednesday`);
      assert.deepEqual(allDayOf(TUE), [], "and nothing where nothing is");
      // A change of that reminder is an update of its day alone, which has to find the day: the new title shows.
      const timeline = q(root, ".zn-cal-time-scroll");
      for (const title of ["Pay the rent today", "Pay the rent"]) {
        stamp += 1000;
        store.items.upsert({ ...store.items.get("allday-mon"), summary: title });
        await flushRaf();
        assert.deepEqual(allDayOf(MON), [title], `Week, display zone "${zone}": the reminder of Monday was renamed`);
      }
      assert.ok(q(root, ".zn-cal-time-scroll") === timeline, "by an update of Monday, not by drawing the week again");
      await showView("Day");
      assert.deepEqual(allDayOf(WED), ["Conference", "Renew the pass"], `Day, display zone "${zone}": the reminder and the event of the day`);
    }
    store.setMeta({ calendarDisplayZone: "" });
    drop("allday-mon"); drop("allday-wed"); drop("allday-wed-event");
    await showView("Week");
    assert.equal(root.querySelectorAll(".zn-cal-time-allday-cell .zn-cal-item").length, 0);
  });

  await test("the hours are remembered with the other calendar settings; a stored value that makes no sense is replaced", async () => {
    store.setMeta({ calendarHours: { on: true, startMin: 420, endMin: 1260 } });
    await store.flush();
    const again = makeStore("/hours", "hours-b");
    await again.open();
    assert.deepEqual(JSON.parse(JSON.stringify(again.meta.calendarHours)), { on: true, startMin: 420, endMin: 1260 });
    files.set("/broken/meta.json", { text: JSON.stringify({ calendarHours: { on: true, startMin: 1000, endMin: 200 } }), mtime: Date.now() });
    const broken = makeStore("/broken", "hours-c");
    await broken.open();
    assert.deepEqual(JSON.parse(JSON.stringify(broken.meta.calendarHours)), { on: true, startMin: 480, endMin: 1200 });
    files.set("/old/meta.json", { text: JSON.stringify({ calendarView: "week" }), mtime: Date.now() });
    const old = makeStore("/old", "hours-d");
    await old.open();
    assert.deepEqual(JSON.parse(JSON.stringify(old.meta.calendarHours)), { on: false, startMin: 480, endMin: 1200 }, "a settings file from before this version: all hours");
  });

  if (WARSAW_RUN) return console.log(`  (${passed} tests in the run with TZ=Europe/Warsaw)`);
  await test("the days the clocks change, on a computer in Europe/Warsaw (this file once more, with that zone)", () => {
    const out = require("node:child_process").execFileSync(process.execPath, [__filename], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, TZ: "Europe/Warsaw", ZN_HOURS_WARSAW_RUN: "1" } });
    process.stdout.write(out);
    assert.match(out, /\(2 tests in the run with TZ=Europe\/Warsaw\)/, "both of them ran");
  });

  console.log(`\n${passed} visible-hours tests passed`);
})().catch((error) => { console.error(error); process.exit(1); });
