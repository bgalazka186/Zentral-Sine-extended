"use strict";
/* Calendar core (roadmap T2.1): pure logic only. Nothing here proves how the calendar LOOKS inside Zen. */
const assert = require("node:assert/strict"), path = require("node:path");
const cal = require(path.join(__dirname, "..", "additional/notes/calendar/ZentralNotesCalendar.js"));
let passed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
const NOW = new Date(2026, 10, 11, 10, 0).getTime(); // Wed 2026-11-11 10:00 local
const day = (y, m, d) => new Date(y, m - 1, d).getTime();
const at = (y, m, d, h, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const ev = (summary, s, e, x = {}) => cal.makeItem({ summary, start: { dateTime: new Date(s).toISOString() }, end: { dateTime: new Date(e).toISOString() }, x: { kind: "event", ...x } }, NOW);

test("parseDateText: ISO, dotted, day-month rolls to next year, @words, offsets, weekdays", () => {
  assert.equal(cal.parseDateText("2026-11-20", NOW), day(2026, 11, 20));
  assert.equal(cal.parseDateText("20.11.2026", NOW), day(2026, 11, 20));
  assert.equal(cal.parseDateText("10-08", NOW), day(2027, 8, 10), "10 Aug already passed this year");
  assert.equal(cal.parseDateText("15.12.", NOW), day(2026, 12, 15));
  assert.equal(cal.parseDateText("@today", NOW), day(2026, 11, 11));
  assert.equal(cal.parseDateText("@+3d", NOW), day(2026, 11, 14));
  assert.equal(cal.parseDateText("@+1w", NOW), day(2026, 11, 18));
  assert.equal(cal.parseDateText("@+1m", NOW), day(2026, 12, 11));
  assert.equal(cal.parseDateText("@friday", NOW), day(2026, 11, 13));
  assert.equal(cal.parseDateText("@wed", NOW), day(2026, 11, 18), "same weekday means next week");
  assert.equal(cal.parseDateText("2026-02-30", NOW), null);
  assert.equal(cal.parseDateText("nonsense", NOW), null);
});

test("parseDateText: extended numeric and English, German, Polish month-name formats", () => {
  const cases = [
    ["11-11-2026", day(2026, 11, 11)],
    ["11/11/2026", day(2026, 11, 11)],
    ["2026/11/11", day(2026, 11, 11)],
    ["11.11.26", day(2026, 11, 11)],
    ["11.11.99", day(1999, 11, 11)],
    ["11 Nov 2026", day(2026, 11, 11)],
    ["Nov 11, 2026", day(2026, 11, 11)],
    ["11. November 2026", day(2026, 11, 11)],
    ["11 listopada 2026", day(2026, 11, 11)],
    ["11. März 2026", day(2026, 3, 11)],
    ["11 marca 2026", day(2026, 3, 11)],
    ["15/12", day(2026, 12, 15)],
    ["15 listopada", day(2026, 11, 15)],
  ];
  for (const [input, expected] of cases) assert.equal(cal.parseDateText(input, NOW), expected, input);
  assert.equal(cal.parseDateText("31/02/2026", NOW), null, "invalid dates are not rolled into another month");
  assert.equal(cal.parseDateText("31 listopada 2026", NOW), null, "month names are calendar-validated");
  assert.equal(cal.parseDateText("29.02.", NOW), day(2028, 2, 29), "yearless leap day finds the next valid year");
  const textual = cal.parseLine("- 25 listopada 2026 Dentist", NOW);
  assert.deepEqual([textual.day, textual.summary, textual.yearless], [day(2026, 11, 25), "Dentist", false]);
  const noYear = cal.parseLine("- 15 grudnia Call mom", NOW);
  assert.deepEqual([noYear.day, noYear.summary, noYear.yearless], [day(2026, 12, 15), "Call mom", true]);
  const annual = cal.extractNoteItems("%%calendar: Birthdays%%\n- 15 listopada Birthday", "annual-pl", NOW)[0];
  assert.deepEqual(annual.recurrence, ["RRULE:FREQ=YEARLY"], "a yearless month-name line repeats annually");
});

test("inlineDateTokens: visible date forms, relative tokens, time suffix and ambiguous clock protection", () => {
  const tokens = cal.inlineDateTokens("@today 2026-11-03 10-08 03.12. 03.12 03:12 25 listopada 2026 November 25, 2026 2026-11-04 14:37", NOW);
  assert.deepEqual(tokens.map((x) => [x.raw, x.ymd, x.time]), [
    ["@today", "2026-11-11", ""],
    ["2026-11-03", "2026-11-03", ""],
    ["10-08", "2027-08-10", ""],
    ["03.12.", "2026-12-03", ""],
    ["25 listopada 2026", "2026-11-25", ""],
    ["November 25, 2026", "2026-11-25", ""],
    ["2026-11-04 14:37", "2026-11-04", "14:37"],
  ]);
  assert.equal(cal.inlineDateTokens("03.12 and 25 listopada 2026", NOW).at(-1)?.raw, "25 listopada 2026", "an invalid month-like phrase must not consume the next valid date");
  assert.deepEqual(cal.ignoredDateTokens("text %%zn-date-ignore:10-08%% and %%zn-date-ignore:%402%2B3d%%"), ["10-08", "@2+3d"]);
  assert.equal(cal.stripDateIgnoreMarks("text%%zn-date-ignore:10-08%%"), "text");
});

test("parseTimeRange and parseLine", () => {
  assert.equal(cal.parseLine("- 03.12. Anna", NOW).day, day(2026, 12, 3), "trailing dot = day-month, not 03:12");
  assert.deepEqual([cal.parseLine("- 03.12 Anna", NOW)?.startMin, cal.parseLine("- 03:12 Anna", NOW, day(2026, 11, 12))?.startMin], [undefined, 192], "without the dot it stays a clock time");
  assert.deepEqual(cal.parseTimeRange("06:00-14:00"), { startMin: 360, endMin: 840 });
  assert.deepEqual(cal.parseTimeRange("6:00 \u2013 14:30"), { startMin: 360, endMin: 870 });
  assert.deepEqual(cal.parseTimeRange("14:30"), { startMin: 870, endMin: -1 });
  assert.equal(cal.parseTimeRange("25:00"), null);
  const a = cal.parseLine("- 10-08 Jan Kowalski \u2014 team lead", NOW);
  assert.equal(a.day, day(2027, 8, 10)); assert.equal(a.summary, "Jan Kowalski \u2014 team lead"); assert.equal(a.startMin, -1);
  const b = cal.parseLine("2026-11-20 14:00-15:30 Dentist", NOW);
  assert.deepEqual([b.startMin, b.endMin, b.summary], [840, 930, "Dentist"]);
  const c = cal.parseLine("- 06:00-14:00 Work", NOW, day(2026, 11, 12));
  assert.deepEqual([c.day, c.startMin, c.summary], [day(2026, 11, 12), 360, "Work"]);
  assert.equal(cal.parseLine("- 06:00-14:00 Work", NOW), null, "no date and no default day");
  assert.equal(cal.parseLine("2026-11-20", NOW), null, "no title");
});

test("items: Google shape, kinds, default end, reminder has no end, etag changes with content", () => {
  const e = cal.makeItem({ summary: "Work", start: { dateTime: "2026-11-12T05:00:00Z" }, end: { dateTime: "2026-11-12T13:00:00Z" } }, NOW);
  assert.equal(e.x.kind, "event");
  const r = cal.makeItem({ summary: "Call", start: { dateTime: "2026-11-12T05:00:00Z" } }, NOW);
  assert.equal(r.x.kind, "reminder"); assert.equal(r.end, undefined);
  const noEnd = cal.makeItem({ summary: "x", start: { dateTime: "2026-11-12T05:00:00Z" }, x: { kind: "event" } }, NOW);
  assert.equal(noEnd.end.dateTime, "2026-11-12T06:00:00.000Z", "an event with no end lasts one hour");
  const allDay = cal.makeItem({ summary: "Trip", start: { date: "2026-11-12" }, x: { kind: "event" } }, NOW);
  assert.equal(allDay.end.date, "2026-11-13", "all-day end is exclusive");
  assert.equal(cal.makeItem({ summary: "bad", start: { date: "nope" } }, NOW), null);
  assert.equal(cal.makeItem({ summary: "bad", start: { dateTime: "2026-11-12T05:00:00Z" }, end: { dateTime: "2026-11-12T04:00:00Z" }, x: { kind: "event" } }, NOW).end.dateTime, "2026-11-12T06:00:00.000Z", "end before start is repaired");
  const e2 = cal.cleanItem({ ...e, summary: "Other", etag: "" }, NOW);
  assert.notEqual(e.etag, e2.etag);
  assert.equal(cal.cleanItem({ ...e, status: "weird" }, NOW).status, "confirmed");
});

test("itemFromLine: date only = all-day reminder, time = reminder, time range = event", () => {
  const p = (t) => cal.itemFromLine(cal.parseLine(t, NOW), { noteId: "n1" }, NOW);
  const bday = p("10-08 Jan Kowalski"); assert.equal(bday.x.kind, "reminder"); assert.equal(bday.start.date, "2027-08-10"); assert.equal(bday.x.noteId, "n1");
  const t = p("2026-11-20 14:00 Call"); assert.equal(t.x.kind, "reminder"); assert.ok(t.start.dateTime);
  const w = p("2026-11-20 06:00-14:00 Work"); assert.equal(w.x.kind, "event"); assert.deepEqual(cal.itemRange(w).map((v) => v / 3600000 % 24 | 0).length, 2);
  assert.equal(cal.itemRange(w)[1] - cal.itemRange(w)[0], 8 * 3600000);
});

test("itemsInRange: events overlap, reminders only by start, cancelled hidden", () => {
  const work = ev("Work", at(2026, 11, 12, 6), at(2026, 11, 12, 14));
  const rem = cal.makeItem({ summary: "Call", start: { dateTime: new Date(at(2026, 11, 12, 15)).toISOString() } }, NOW);
  const gone = cal.makeItem({ summary: "Gone", status: "cancelled", start: { dateTime: new Date(at(2026, 11, 12, 8)).toISOString() }, x: { kind: "reminder" } }, NOW);
  const night = ev("Night", at(2026, 11, 11, 22), at(2026, 11, 12, 2));
  const list = cal.itemsInRange([rem, work, gone, night], day(2026, 11, 12), day(2026, 11, 13));
  assert.deepEqual(list.map((i) => i.summary), ["Night", "Work", "Call"]);
  assert.deepEqual(cal.itemsInRange([work], day(2026, 11, 12), at(2026, 11, 12, 6)).length, 0, "end/start touching is not overlap");
});

test("layoutDay: overlapping events get lanes, none is hidden, clusters are independent", () => {
  const items = [
    ev("A", at(2026, 11, 12, 6), at(2026, 11, 12, 14)),
    ev("B", at(2026, 11, 12, 8), at(2026, 11, 12, 10)),
    ev("C", at(2026, 11, 12, 9), at(2026, 11, 12, 11)),
    ev("D", at(2026, 11, 12, 15), at(2026, 11, 12, 16)),
  ];
  const l = cal.layoutDay(items, day(2026, 11, 12));
  const by = Object.fromEntries(l.map((r) => [r.item.summary, r]));
  assert.equal(l.length, 4);
  assert.deepEqual([by.A.lane, by.B.lane, by.C.lane], [0, 1, 2]);
  assert.ok([by.A, by.B, by.C].every((r) => r.lanes === 3));
  assert.deepEqual([by.D.lane, by.D.lanes], [0, 1], "a later event is alone in its cluster");
  assert.equal(by.A.startMin, 360); assert.equal(by.A.endMin, 840);
  const reuse = cal.layoutDay([ev("A", at(2026, 11, 12, 6), at(2026, 11, 12, 8)), ev("B", at(2026, 11, 12, 7), at(2026, 11, 12, 12)), ev("C", at(2026, 11, 12, 8), at(2026, 11, 12, 9))], day(2026, 11, 12));
  assert.equal(reuse.find((r) => r.item.summary === "C").lane, 0, "a free lane is reused");
  const clip = cal.layoutDay([ev("Night", at(2026, 11, 11, 22), at(2026, 11, 12, 2))], day(2026, 11, 12));
  assert.deepEqual([clip[0].startMin, clip[0].endMin], [0, 120], "clipped to the day");
});

test("busyRanges merges overlaps; reminders take no time", () => {
  const items = [ev("A", at(2026, 11, 12, 6), at(2026, 11, 12, 10)), ev("B", at(2026, 11, 12, 9), at(2026, 11, 12, 14)), ev("C", at(2026, 11, 12, 16), at(2026, 11, 12, 17)),
    cal.makeItem({ summary: "R", start: { dateTime: new Date(at(2026, 11, 12, 12)).toISOString() } }, NOW)];
  assert.deepEqual(cal.busyRanges(items, day(2026, 11, 12), day(2026, 11, 13)), [[at(2026, 11, 12, 6), at(2026, 11, 12, 14)], [at(2026, 11, 12, 16), at(2026, 11, 12, 17)]]);
});

test("monthGrid: 6 weeks, Monday or Sunday start, covers the month", () => {
  const g = cal.monthGrid(2026, 10, 1); // November 2026
  assert.equal(g.length, 6); assert.ok(g.every((w) => w.length === 7));
  assert.equal(new Date(g[0][0]).getDay(), 1);
  assert.equal(g[0][6], day(2026, 11, 1), "Nov 1 2026 is a Sunday: last cell of a Monday-first week");
  assert.equal(new Date(cal.monthGrid(2026, 10, 0)[0][0]).getDay(), 0);
  assert.ok(g.flat().includes(day(2026, 11, 30)));
});

test("daysForward and upcoming", () => {
  const trip = ev("Trip", at(2026, 11, 12, 20), at(2026, 11, 14, 8));
  const r = cal.makeItem({ summary: "R", start: { date: "2026-11-13" } }, NOW);
  const d = cal.daysForward([trip, r], day(2026, 11, 11), 4);
  assert.equal(d.length, 4);
  assert.deepEqual(d.map((x) => x.items.length), [0, 1, 2, 1]);
  assert.equal(cal.daysForward([], NOW, 9999).length, 366);
  const old = ev("Old", at(2026, 11, 10, 8), at(2026, 11, 10, 9));
  const running = ev("Running", at(2026, 11, 11, 9), at(2026, 11, 11, 12));
  assert.deepEqual(cal.upcoming([trip, old, r, running], NOW, 10).map((i) => i.summary), ["Running", "Trip", "R"]);
  assert.equal(cal.upcoming([trip, running], NOW, 1).length, 1);
});

test("moveItem and resizeItem: snapping, duration kept, minimum length, all-day by days, reminders keep no end", () => {
  const e = ev("Work", at(2026, 11, 12, 6), at(2026, 11, 12, 14));
  const m = cal.moveItem(e, 7 * 60000 + 3600000, 15);
  assert.equal(cal.itemRange(m)[0], at(2026, 11, 12, 7, 0), "7 min snaps down to 0");
  assert.equal(cal.itemRange(m)[1] - cal.itemRange(m)[0], 8 * 3600000);
  assert.equal(cal.itemRange(cal.moveItem(e, 9 * 60000, 15))[0], at(2026, 11, 12, 6, 15));
  const rs = cal.resizeItem(e, "end", -10 * 3600000, 15);
  assert.equal(cal.itemRange(rs)[1] - cal.itemRange(rs)[0], 15 * 60000, "never shorter than one step");
  assert.equal(cal.itemRange(cal.resizeItem(e, "start", -3600000, 30))[0], at(2026, 11, 12, 5));
  const ad = cal.makeItem({ summary: "Trip", start: { date: "2026-11-12" }, x: { kind: "event" } }, NOW);
  const mv = cal.moveItem(ad, 2 * 86400000);
  assert.deepEqual([mv.start.date, mv.end.date], ["2026-11-14", "2026-11-15"]);
  const rem = cal.makeItem({ summary: "R", start: { dateTime: "2026-11-12T05:00:00Z" } }, NOW);
  assert.equal(cal.moveItem(rem, 3600000).end, undefined);
  assert.equal(cal.resizeItem(rem, "end", 3600000), rem);
  assert.notEqual(m.etag, e.etag);
});

test("Google round trip keeps kind, note link and calendar note", () => {
  const e = cal.makeItem({ summary: "Work", description: "d", start: { dateTime: "2026-11-12T05:00:00Z" }, end: { dateTime: "2026-11-12T13:00:00Z" },
    recurrence: ["RRULE:FREQ=WEEKLY", "bogus"], reminders: { overrides: [{ method: "popup", minutes: 10 }, { method: "x", minutes: -1 }] },
    x: { kind: "event", noteId: "n1", heading: "Plan", category: "Work", calNote: "bring badge" } }, NOW);
  assert.deepEqual(e.recurrence, ["RRULE:FREQ=WEEKLY"]); assert.equal(e.reminders.overrides.length, 1);
  const g = cal.toGoogle(e);
  assert.equal(g.end.dateTime, e.end.dateTime); assert.equal(g.extendedProperties.private.zentral_noteId, "n1");
  const back = cal.fromGoogle(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(back.x, e.x); assert.equal(back.id, e.id); assert.equal(back.summary, "Work");
  const r = cal.makeItem({ summary: "R", start: { dateTime: "2026-11-12T05:00:00Z" } }, NOW);
  const gr = cal.toGoogle(r); assert.deepEqual(gr.end, gr.start);
  assert.equal(cal.fromGoogle(JSON.parse(JSON.stringify(gr))).x.kind, "reminder");
  assert.equal(cal.fromGoogle(null), null);
});

test("recurrence: daily, weekly BYDAY, monthly skip, COUNT, UNTIL, reminders", () => {
  const w = cal.makeItem({ summary: "Standup", start: { dateTime: new Date(at(2026, 11, 9, 9)).toISOString() }, end: { dateTime: new Date(at(2026, 11, 9, 9, 30)).toISOString() }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"], x: { kind: "event" } }, NOW);
  const occ = cal.expandRange([w], day(2026, 11, 9), day(2026, 11, 23));
  assert.deepEqual(occ.map((o) => cal.ymd(new Date(cal.itemRange(o)[0]))), ["2026-11-09", "2026-11-11", "2026-11-16", "2026-11-18"]);
  assert.equal(occ[0].id, w.id); assert.equal(occ[1].x.series, w.id); assert.ok(occ[1].id.startsWith(w.id + "@"));
  assert.equal(cal.itemRange(occ[1])[1] - cal.itemRange(occ[1])[0], 30 * 60000);
  const d = cal.makeItem({ summary: "Pill", start: { dateTime: new Date(at(2026, 11, 11, 8)).toISOString() }, recurrence: ["RRULE:FREQ=DAILY;COUNT=3"] }, NOW);
  assert.equal(cal.expandRange([d], day(2026, 11, 1), day(2026, 12, 31)).length, 3);
  const u = cal.makeItem({ summary: "U", start: { date: "2026-11-01" }, recurrence: ["RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261107"] }, NOW);
  assert.deepEqual(cal.expandRange([u], day(2026, 11, 1), day(2026, 12, 1)).map((o) => o.start.date), ["2026-11-01", "2026-11-03", "2026-11-05", "2026-11-07"]);
  const mo = cal.makeItem({ summary: "M", start: { date: "2026-01-31" }, recurrence: ["RRULE:FREQ=MONTHLY"] }, NOW);
  assert.deepEqual(cal.expandRange([mo], day(2026, 2, 1), day(2026, 5, 1)).map((o) => o.start.date), ["2026-03-31"], "months without a 31st are skipped");
  const y = cal.makeItem({ summary: "B", start: { date: "2020-08-10" }, recurrence: ["RRULE:FREQ=YEARLY"] }, NOW);
  assert.deepEqual(cal.expandRange([y], day(2026, 8, 1), day(2027, 9, 1)).map((o) => o.start.date), ["2026-08-10", "2027-08-10"]);
  assert.equal(cal.expandRange([cal.makeItem({ summary: "x", start: { date: "2026-11-01" }, recurrence: ["RRULE:FREQ=HOURLY"] }, NOW)], day(2026, 11, 1), day(2026, 12, 1)).length, 1, "unsupported rule = single item");
  assert.equal(cal.parseRule("nope"), null);
});

test("working hours, free slots and the all-day strip", () => {
  assert.deepEqual(cal.cleanWork({ startMin: 900, endMin: 600 }), { days: [1, 2, 3, 4, 5], startMin: 540, endMin: 1020 });
  assert.equal(cal.workRange(day(2026, 11, 14), null), null, "Saturday is off");
  assert.deepEqual(cal.workRange(day(2026, 11, 12), null), [at(2026, 11, 12, 9), at(2026, 11, 12, 17)]);
  const items = [ev("A", at(2026, 11, 12, 10), at(2026, 11, 12, 12)), ev("B", at(2026, 11, 12, 11), at(2026, 11, 12, 13)),
    cal.makeItem({ summary: "Holiday", start: { date: "2026-11-12" }, x: { kind: "event" } }, NOW)];
  const free = cal.freeSlots(items, day(2026, 11, 12), day(2026, 11, 13), 60, { work: {} });
  assert.deepEqual(free, [[at(2026, 11, 12, 9), at(2026, 11, 12, 10)], [at(2026, 11, 12, 13), at(2026, 11, 12, 17)]]);
  assert.equal(cal.freeSlots(items, day(2026, 11, 12), day(2026, 11, 13), 60, { work: {}, blockAllDay: true }).length, 0, "all-day event blocks when asked");
  assert.deepEqual(cal.freeSlots(items, day(2026, 11, 12), day(2026, 11, 13), 180, { work: {} }), [[at(2026, 11, 12, 13), at(2026, 11, 12, 17)]]);
  assert.equal(cal.allDayOf(items, day(2026, 11, 12)).length, 1);
  assert.equal(cal.layoutDay(items, day(2026, 11, 12)).length, 2, "the all-day item is not in the time grid");
});

test("time zones and week text", () => {
  assert.equal(cal.cleanZone("Europe/Warsaw"), "Europe/Warsaw"); assert.equal(cal.cleanZone("Mars/Base"), ""); assert.equal(cal.cleanZone(""), "");
  assert.equal(cal.clockIn(Date.UTC(2026, 10, 11, 12, 0), "Asia/Tokyo"), "21:00");
  const kept = cal.makeItem({ summary: "x", start: { date: "2026-11-12" }, x: { tz: "Asia/Tokyo" } }, NOW);
  assert.equal(kept.x.tz, "Asia/Tokyo"); assert.equal(cal.fromGoogle(cal.toGoogle(kept)).x.tz, "Asia/Tokyo");
  const text = cal.weekText([ev("Work", at(2026, 11, 12, 6), at(2026, 11, 12, 14), { category: "Job" }), cal.makeItem({ summary: "Bday", start: { date: "2026-11-13" } }, NOW)], day(2026, 11, 9));
  assert.ok(text.includes("## Thursday 2026-11-12\n- 06:00-14:00 Work [Job]"), text);
  assert.ok(text.includes("- all day (reminder) Bday")); assert.ok(text.includes("## Monday 2026-11-09\n- (nothing)"));
});

test("picker model: flags, counts, month stepping, keyboard", () => {
  const items = [ev("Trip", at(2026, 11, 12, 20), at(2026, 11, 14, 8)), cal.makeItem({ summary: "R", start: { date: "2026-11-12" } }, NOW)];
  const g = cal.pickerMonth(2026, 10, { weekStart: 1, now: NOW, selected: day(2026, 11, 20), items });
  const cells = g.flat(), cell = (d) => cells.find((c) => c.day === day(2026, 11, d));
  assert.equal(g.length, 6); assert.ok(cell(11).today); assert.ok(cell(20).selected); assert.equal(cell(12).count, 2); assert.equal(cell(13).count, 1); assert.equal(cell(14).count, 1); assert.equal(cell(15).count, 0);
  assert.ok(!cells[0].inMonth || cells[0].date === 1);
  assert.deepEqual(cal.stepMonth(2026, 11, 1), { year: 2027, month: 0 }); assert.deepEqual(cal.stepMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.equal(cal.pickerKey(day(2026, 11, 11), "ArrowDown"), day(2026, 11, 18));
  assert.equal(cal.pickerKey(day(2026, 1, 31), "PageDown"), day(2026, 2, 28), "month end is clamped");
  assert.equal(cal.pickerKey(day(2026, 11, 11), "Home", 1), day(2026, 11, 9));
  assert.equal(cal.pickerKey(day(2026, 11, 11), "End", 1), day(2026, 11, 15));
  assert.equal(cal.pickerKey(day(2026, 11, 11), "x"), day(2026, 11, 11));
});


const BODY = [
  "# Team", "",
  "## Birthdays", "%%calendar: Birthdays%%",
  "- 10-08 Jan Kowalski \u2014 team lead",
  "- 03.12. Anna",
  "- not a date line", "",
  "## Shifts", "%%calendar: Work%%",
  "- 2026-11-12 06:00-14:00 Work",
  "- 2026-11-12 06:00-14:00 Work",
  "- 2026-11-13 18:00 Call mom", "",
  "## Notes",
  "- 2026-11-20 not in a marked section",
  "```", "%%calendar: Code%%", "- 2026-11-21 in a fence", "```",
  "## 2026-11-25", "%%calendar: Day%%",
  "- 09:00-10:00 Standup",
  "- 14:00 Review",
  "# Done",
  "- 2026-11-30 after the section ends",
].join("\n");

test("extractNoteItems: marked sections only, categories, headings, yearly dates, duplicates, date headings, fences", () => {
  const list = cal.extractNoteItems(BODY, "note1", NOW);
  const by = (t) => list.filter((i) => i.summary === t);
  assert.equal(list.length, 7, "Jan, Anna, Work x2, Call mom, Standup, Review");
  assert.equal(list.filter((i) => i.x.kind === "reminder").length, 4, "one note can contain multiple independent reminders");
  const jan = by("Jan Kowalski \u2014 team lead")[0];
  assert.deepEqual([jan.x.category, jan.x.heading, jan.x.src, jan.x.noteId, jan.x.kind], ["Birthdays", "Birthdays", "list", "note1", "reminder"]);
  assert.deepEqual(jan.recurrence, ["RRULE:FREQ=YEARLY"]); assert.equal(jan.start.date, "2027-08-10");
  assert.equal(by("Anna")[0].start.date, "2026-12-03");
  const work = by("Work");
  assert.equal(work.length, 2); assert.notEqual(work[0].id, work[1].id, "identical lines stay two items");
  assert.equal(work[0].x.kind, "event"); assert.equal(cal.itemRange(work[0])[1] - cal.itemRange(work[0])[0], 8 * 3600000);
  assert.equal(by("Call mom")[0].x.kind, "reminder");
  assert.equal(by("Standup")[0].x.category, "Day"); assert.equal(cal.ymd(new Date(cal.itemRange(by("Standup")[0])[0])), "2026-11-25", "the heading is the date");
  assert.ok(!list.some((i) => /not in a marked|in a fence|after the section/.test(i.summary)));
  assert.deepEqual(cal.extractNoteItems(BODY, "note1", NOW).map((i) => i.id), list.map((i) => i.id), "ids are stable");
  assert.notEqual(cal.extractNoteItems(BODY, "note2", NOW)[0].id, list[0].id);
  assert.equal(cal.extractNoteItems("- 2026-11-20 x", "n", NOW).length, 0);
  const namedHeading = cal.extractNoteItems("## 25 listopada 2026\n%%calendar: Work%%\n- 09:00 Review", "named-heading", NOW);
  assert.equal(cal.ymd(new Date(cal.itemRange(namedHeading[0])[0])), "2026-11-25", "month-name headings supply the default day");
});

test("date ignore marks persist through calendar extraction without deleting an event summary", () => {
  const body = "%%calendar: Work%%\n- 2026-11-12 Dentist 10-08%%zn-date-ignore:10-08%%\n- 10-08 Birthday%%zn-date-ignore:10-08%%";
  const items = cal.extractNoteItems(body, "ignore", NOW);
  assert.equal(items.length, 1, "an ignored date in a summary does not remove the dated event, while an ignored leading date removes only that reminder");
  assert.deepEqual([items[0].summary, items[0].start.date], ["Dentist 10-08", "2026-11-12"]);
  const timed = cal.extractNoteItems("%%calendar: Work%%\n- 2026-11-12 09:00-10:00 Review%%zn-date-ignore:2026-11-12%2009%3A00%%", "ignore-time", NOW);
  assert.equal(timed.length, 0, "ignoring a date chip with a time suffix also removes that date-driven list item");
  assert.deepEqual(cal.ignoredDateTokens("10-08 %%zn-date-ignore:10-08%%"), ["10-08"]);
});

test("itemsFromNoteReminders shows the old reminder field as read-only items", () => {
  const r = cal.itemsFromNoteReminders([{ id: "a", body: "Call bank\nmore", remind: at(2026, 11, 12, 9) }, { id: "b", body: "x", remind: 0 }, { id: "c", body: "gone", remind: 5e12, trashed: 1 }]);
  assert.equal(r.length, 1); assert.deepEqual([r[0].id, r[0].summary, r[0].x.src, r[0].x.noteId, r[0].x.kind], ["remind:a", "Call bank", "note", "a", "reminder"]);
});

test("item store: file, sync keeps extras and dragged times, removes vanished lines, upsert/remove, reload", async () => {
  const files = new Map(), timers = [];
  const io = { join: (...p) => p.join("/"), readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p); }, writeUTF8: async (p, t) => { files.set(p, t); } };
  let clock = NOW;
  const mk = () => cal.createItemStore({ io, getDir: () => "/n", now: () => clock, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer() {} });
  const st = mk(); await st.open();
  const events = []; st.on((k, id) => events.push(k));
  assert.equal(st.syncNote("n1", "plain text"), false, "no marker, nothing to do");
  assert.equal(st.syncNote("n1", BODY), true);
  assert.equal(st.list({ noteId: "n1" }).length, 7); assert.deepEqual(st.categories(), ["Birthdays", "Day", "Work"]);
  assert.equal(st.syncNote("n1", BODY), false, "same text, no change");
  // extras and a dragged time survive an edit of another line
  const call = st.list().find((i) => i.summary === "Call mom");
  const edited = st.upsert({ ...call, x: { ...call.x, calNote: "bring flowers", moved: "1" }, start: { dateTime: new Date(at(2026, 11, 13, 19)).toISOString() } });
  assert.equal(edited.x.calNote, "bring flowers");
  assert.equal(st.syncNote("n1", BODY.replace("- 03.12. Anna", "- 04.12. Anna B")), true);
  const after = st.get(call.id);
  assert.equal(after.x.calNote, "bring flowers"); assert.equal(cal.itemRange(after)[0], at(2026, 11, 13, 19), "dragged time kept"); assert.equal(after.x.moved, "1");
  assert.ok(!st.list().some((i) => i.summary === "Anna") && st.list().some((i) => i.summary === "Anna B"), "an edited line is a new item");
  // manual item, persistence, reload
  const manual = st.upsert({ summary: "Dentist", start: { dateTime: new Date(at(2026, 12, 1, 8)).toISOString() }, end: { dateTime: new Date(at(2026, 12, 1, 9)).toISOString() }, x: { kind: "event", category: "Health", calNote: "x-ray" } });
  assert.equal(manual.x.src, "manual");
  timers.forEach((f) => f()); await st.flush();
  assert.ok(files.has("/n/calendar.json")); assert.ok(!/\.md$/.test(cal.ITEMS_FILE), "never looks like a note file");
  const st2 = mk(); await st2.open();
  assert.equal(st2.list().length, st.list().length); assert.equal(st2.get(manual.id).x.calNote, "x-ray");
  // removing the marker removes the listed items but not the manual ones
  assert.equal(st2.syncNote("n1", "# Team\n\nnothing"), true);
  assert.equal(st2.list({ noteId: "n1" }).length, 0); assert.equal(st2.get(manual.id).summary, "Dentist");
  assert.equal(st2.upsert({ summary: "bad", start: { date: "no" } }), null);
  st2.syncNote("n2", "## A\n%%calendar%%\n- 2026-12-02 X");
  assert.equal(st2.removeNote("n2"), 1); assert.equal(st2.remove(manual.id), true); assert.equal(st2.remove("nope"), false);
  assert.ok(events.includes("change") && events.includes("reset") === false);
  // a damaged file opens empty instead of throwing
  files.set("/n/calendar.json", "{broken"); const st3 = mk(); await st3.open(); assert.equal(st3.list().length, 0);
});

test("item store: a hidden note (Trash) keeps its items untouched and shows them again on restore", async () => {
  const files = new Map();
  const io = { join: (...p) => p.join("/"), readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p); }, writeUTF8: async (p, t) => { files.set(p, t); } };
  const st = cal.createItemStore({ io, getDir: () => "/n", now: () => NOW, setTimer: (fn) => fn, clearTimer() {} });
  await st.open();
  st.syncNote("n1", BODY);
  const call = st.list().find((i) => i.summary === "Call mom");
  st.upsert({ ...call, x: { ...call.x, calNote: "keep me" } });
  const manual = st.upsert({ summary: "Loose", start: { date: "2026-12-05" }, x: { kind: "reminder" } });
  const seen = []; st.on((k) => seen.push(k));
  assert.equal(st.hideNote("n1"), true); assert.equal(st.hideNote("n1"), false, "already hidden");
  assert.equal(st.list({ noteId: "n1" }).length, 0); assert.equal(st.get(call.id), null); assert.equal(st.has(call.id), false);
  assert.deepEqual(st.categories(), [], "hidden categories vanish too");
  assert.equal(st.get(manual.id).summary, "Loose", "items of no note stay visible");
  assert.equal(st.showNote("n1"), true);
  assert.equal(st.get(call.id).x.calNote, "keep me"); assert.equal(st.list({ noteId: "n1" }).length, 7);
  assert.ok(seen.includes("remove") && seen.includes("change"));
  st.hideNote("n1"); st.removeNote("n1"); assert.equal(st.isHidden("n1"), false, "removing a note forgets the hidden flag");
});


test("calendar split layout chooses a responsive orientation and falls back to tabs below useful pane sizes", () => {
  assert.deepEqual(cal.calendarLayoutFor("auto", 1200, 700), { mode: "auto", orientation: "lr", tabs: false, width: 1200, height: 700 });
  assert.deepEqual(cal.calendarLayoutFor("auto", 420, 720), { mode: "auto", orientation: "tb", tabs: false, width: 420, height: 720 });
  assert.equal(cal.calendarLayoutFor("lr", 430, 600).tabs, true, "forced side-by-side still falls back when too narrow");
  assert.equal(cal.calendarLayoutFor("tb", 420, 380).tabs, true, "forced stacked still falls back when too short");
  assert.equal(cal.calendarLayoutFor("tb", 900, 700).orientation, "tb");
  assert.equal(cal.cleanCalendarLayout("broken"), "auto");
  assert.equal(cal.cleanCalendarShare(0.95), 0.8);
  assert.equal(cal.cleanCalendarShare(0.01), 0.2);
  assert.equal(cal.cleanCalendarShare("bad", 0.42), 0.42);
});

(async () => { for (const [name, fn] of queue) { await fn(); passed++; console.log("ok -", name); } console.log(passed + " passed"); })().catch((e) => { console.error(e); process.exit(1); });
