"use strict";
/* OW-24: times and dates typed fast into a field ("16", "830", "8,30", "9am"; "14", "14,11", "1411", "tomorrow").
 * The tables of what is read and what is refused come first, then the fields of the real sheet (fake DOM): what the
 * line under a field says while it is typed in, what leaving the field writes, and what a refused text does to Save.
 * Runs in the time-zone matrix (file name). The clock is fixed at a local time, so "today" is the same day in every
 * zone: Monday 2026-11-16, 10:00. It goes on with the real clock, so timers and time stamps still move. */
{
  const RealDate = Date, CLOCK_START = new RealDate(2026, 10, 16, 10, 0, 0).getTime(), REAL_START = RealDate.now();
  class FixedDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(FixedDate.now()); }
    static now() { return CLOCK_START + (RealDate.now() - REAL_START); }
  }
  globalThis.Date = FixedDate;
}
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const NOW = new Date(2026, 10, 16, 10, 0, 0).getTime();
const local = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; }
  catch (error) { console.error("not ok - " + name); throw error; }
};

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
  // ---------------------------------------------------------------- 1. times
  await test("a typed time: the table of what is read", () => {
    const table = [
      // the hour alone
      ["16", "16:00"], ["8", "08:00"], ["0", "00:00"], ["00", "00:00"], ["23", "23:00"], ["16h", "16:00"], ["16 h", "16:00"], ["8H", "08:00"],
      // hour and minutes without a separator: the last two digits are the minutes
      ["830", "08:30"], ["0830", "08:30"], ["1630", "16:30"], ["000", "00:00"], ["0000", "00:00"], ["2359", "23:59"], ["905", "09:05"],
      // with a separator
      ["8:30", "08:30"], ["08:30", "08:30"], ["8.30", "08:30"], ["8,30", "08:30"], ["8;30", "08:30"], ["8 30", "08:30"], ["8h30", "08:30"], ["8 h 30", "08:30"],
      ["23:59", "23:59"], ["9:5", "09:05"], ["8,3", "08:03"], ["8 : 30", "08:30"], ["  8:30  ", "08:30"], ["8  30", "08:30"],
      // the twelve-hour clock
      ["9am", "09:00"], ["9 am", "09:00"], ["9AM", "09:00"], ["9a", "09:00"], ["9p", "21:00"], ["9pm", "21:00"], ["9:15pm", "21:15"], ["9.15 p.m.", "21:15"],
      ["915pm", "21:15"], ["12am", "00:00"], ["12:30am", "00:30"], ["12pm", "12:00"], ["12:30 pm", "12:30"], ["1pm", "13:00"], ["11:59pm", "23:59"], ["7 p. m.", "19:00"],
    ];
    for (const [text, clock] of table) {
      const minutes = C.parseClock(text);
      assert.equal(C.clockOfMinutes(minutes), clock, JSON.stringify(text));
    }
  });

  await test("a typed time: the table of what is refused", () => {
    const refused = ["", " ", "25", "24", "24:00", "2400", "860", "9:60", "8:75", "1260", "12345", "8.30.15", "8:", ":30", "8::30", "8:3:0", "-8", "+8",
      "abc", "am", "noon", "13pm", "0am", "0pm", "00am", "16pm", "9ampm", "9hpm", "9h am", "9 h pm", "1 2 3", "8-16", "8 to 16", "8:30x", "x8:30", "8:30:00",
      null, undefined, NaN, {}, [], "٨:٣٠"];
    for (const text of refused) assert.equal(C.parseClock(text), -1, JSON.stringify(text));
    assert.equal(C.parseClock(830), 510, "a number is read like its digits");
    // minutes after midnight as the text every field shows
    assert.equal(C.clockOfMinutes(0), "00:00"); assert.equal(C.clockOfMinutes(1439), "23:59");
    for (const not of [-1, 1440, 8.5, NaN, "510", null, undefined]) assert.equal(C.clockOfMinutes(not), "", String(not));
  });

  await test("two times at once, and the text of a note is read as before", () => {
    const range = (text) => { const found = C.parseTimeRange(text); return found ? C.clockOfMinutes(found.startMin) + (found.endMin >= 0 ? "-" + C.clockOfMinutes(found.endMin) : "") : null; };
    for (const [text, expected] of [
      ["8-16", "08:00-16:00"], ["8:30 - 16", "08:30-16:00"], ["830\u20131630", "08:30-16:30"], ["8.30\u201416.15", "08:30-16:15"], ["9am-5pm", "09:00-17:00"], ["9-5pm", "09:00-17:00"],
      ["8 to 16", "08:00-16:00"], ["8 - 9 30", "08:00-09:30"], ["22-6", "22:00-06:00"], ["06:00-14:00", "06:00-14:00"], ["6:00 \u2013 14:30", "06:00-14:30"],
      ["14:30", "14:30"], ["830", "08:30"], ["16", "16:00"],
    ]) assert.equal(range(text), expected, text);
    for (const text of ["", "25:00", "8-", "-16", "8-25", "8-16-20", "nope", "8 until 16", "to 16", null]) assert.equal(range(text), null, String(text));
    // A list line in a note: only the strict forms are a time there. A number that begins a line is no hour.
    const day = local(2026, 11, 12);
    const line = (text) => { const found = C.parseLine(text, NOW, day); return found ? [found.startMin, found.endMin, found.summary] : null; };
    assert.deepEqual(line("- 06:00-14:00 Work"), [360, 840, "Work"]);
    assert.deepEqual(line("- 14.30 Dentist"), [870, -1, "Dentist"]);
    assert.deepEqual(line("- 3 apples"), [-1, -1, "3 apples"]);
    assert.deepEqual(line("- 830 Work"), [-1, -1, "830 Work"]);
    assert.deepEqual(line("- 16 people came"), [-1, -1, "16 people came"]);
    assert.deepEqual(line("- 9am Call"), [-1, -1, "9am Call"]);
    assert.deepEqual(line("- 16h of work"), [-1, -1, "16h of work"]);
    assert.deepEqual(line("- 8 to 16 Work"), [-1, -1, "8 to 16 Work"]);
    // "8-16" at the start of a line was never a time: it is tried as a date (day 8, month 16), which there is none.
    assert.deepEqual(line("- 8-16 Work"), [-1, -1, "8-16 Work"]);
    assert.equal(C.parseLine("- 10-08 Jan Kowalski", NOW).day, local(2027, 8, 10), "day and month in a note stay day first");
  });

  // ---------------------------------------------------------------- 2. dates
  const entry = (text, opts = {}) => C.parseDateEntry(text, { now: NOW, base: "2026-12-05", format: "DD-MM-YYYY", ...opts });

  await test("a typed date: a day alone is that day of the month the field shows", () => {
    assert.equal(entry("14"), "2026-12-14"); assert.equal(entry("1"), "2026-12-01"); assert.equal(entry("31"), "2026-12-31"); assert.equal(entry("14."), "2026-12-14");
    assert.equal(entry("05"), "2026-12-05"); assert.equal(entry(" 7 "), "2026-12-07");
    assert.equal(entry("14", { base: "2027-02-10" }), "2027-02-14");
    assert.equal(entry("30", { base: "2027-02-10" }), "", "February has no 30th: no date, not the 2nd of March");
    assert.equal(entry("29", { base: "2028-02-10" }), "2028-02-29"); assert.equal(entry("29", { base: "2027-02-10" }), "");
    assert.equal(entry("0"), ""); assert.equal(entry("32"), ""); assert.equal(entry("99"), "");
    // A day that has passed in the shown month is still that day: the month is in front of the person.
    assert.equal(entry("3", { base: "2026-11-16" }), "2026-11-03");
    // Without a shown month, or with one that is no date: this month.
    assert.equal(entry("14", { base: "" }), "2026-11-14"); assert.equal(entry("14", { base: "nonsense" }), "2026-11-14"); assert.equal(C.parseDateEntry("14", { now: NOW }), "2026-11-14");
  });

  await test("a typed date: day and month are the next such day, this year or a later one", () => {
    // Today is 2026-11-16. The format of the settings is day first here.
    for (const text of ["1411", "14.11", "14,11", "14-11", "14/11", "14 11", "14.11.", "14. 11", "14.11 "]) assert.equal(entry(text), "2027-11-14", text + ": the 14th has passed this year");
    for (const text of ["1611", "16.11", "16,11"]) assert.equal(entry(text), "2026-11-16", text + ": today is not past");
    for (const text of ["1711", "17.11", "17-11", "17/11"]) assert.equal(entry(text), "2026-11-17", text);
    assert.equal(entry("0304"), "2027-04-03"); assert.equal(entry("3.4"), "2027-04-03"); assert.equal(entry("03.04"), "2027-04-03"); assert.equal(entry("24.12"), "2026-12-24");
    assert.equal(entry("0101"), "2027-01-01"); assert.equal(entry("3112"), "2026-12-31");
    assert.equal(entry("29.2"), "2028-02-29", "the next 29 February"); assert.equal(entry("2902"), "2028-02-29");
    for (const text of ["3102", "31.2", "30.02", "0.5", "5.0", "32.1", "13.13", "0000"]) assert.equal(entry(text), "", text);
    // Where the first order gives no date at all the other one is taken: 11.14 can only be 14 November.
    assert.equal(entry("11.14"), "2027-11-14"); assert.equal(entry("1114"), "2027-11-14"); assert.equal(entry("1231"), "2026-12-31"); assert.equal(entry("1.13"), "2027-01-13");
    // The month of the field plays no part once a month is typed.
    assert.equal(entry("14.11", { base: "2031-03-03" }), "2027-11-14");
  });

  await test("a typed date: the date format of the settings decides which number is the month", () => {
    assert.equal(C.dateEntryOrder("DD-MM-YYYY"), "dm"); assert.equal(C.dateEntryOrder("DD.MM.YYYY"), "dm"); assert.equal(C.dateEntryOrder("DD/MM/YYYY"), "dm");
    assert.equal(C.dateEntryOrder("MM/DD/YYYY"), "md"); assert.equal(C.dateEntryOrder("YYYY-MM-DD"), "md", "the year first has the month before the day");
    assert.equal(C.dateEntryOrder("long", "en-US"), "md"); assert.equal(C.dateEntryOrder("long", "pl-PL"), "dm"); assert.equal(C.dateEntryOrder("long", "de-DE"), "dm");
    assert.equal(C.dateEntryOrder("nonsense"), "dm", "an unknown format is the default one"); assert.equal(C.dateEntryOrder(undefined), "dm");
    for (const format of ["DD-MM-YYYY", "DD.MM.YYYY", "DD/MM/YYYY"]) {
      assert.equal(entry("3.4", { format }), "2027-04-03", format); assert.equal(entry("0304", { format }), "2027-04-03", format);
      assert.equal(entry("3.4.2030", { format }), "2030-04-03", format); assert.equal(entry("3/4/30", { format }), "2030-04-03", format);
    }
    for (const format of ["MM/DD/YYYY", "YYYY-MM-DD"]) {
      assert.equal(entry("3.4", { format }), "2027-03-04", format); assert.equal(entry("0304", { format }), "2027-03-04", format);
      assert.equal(entry("3.4.2030", { format }), "2030-03-04", format); assert.equal(entry("3/4/30", { format }), "2030-03-04", format);
      assert.equal(entry("11.17", { format }), "2026-11-17", format); assert.equal(entry("1117", { format }), "2026-11-17", format);
      assert.equal(entry("14.11", { format }), "2027-11-14", format + ": no 14th month, so the day is first");
      assert.equal(entry("14.11.2030", { format }), "2030-11-14", format);
      assert.equal(entry("14", { format }), "2026-12-14", format + ": a day alone is a day");
    }
    assert.equal(entry("3.4", { format: "long", locale: "en-US" }), "2027-03-04"); assert.equal(entry("3.4", { format: "long", locale: "pl-PL" }), "2027-04-03");
  });

  await test("a typed date: with its year, and the words", () => {
    for (const text of ["2026-11-14", "2026/11/14", "2026.11.14", "2026 11 14", "2026-11-14 ", "14.11.2026", "14-11-2026", "14/11/2026", "14,11,2026", "14 11 2026", "14.11.2026.", "14.11.26", "14-11-26"]) assert.equal(entry(text), "2026-11-14", text);
    assert.equal(entry("1.2.49"), "2049-02-01"); assert.equal(entry("1.2.50"), "1950-02-01", "two digits of a year as everywhere in Notes");
    assert.equal(entry("2026-02-30"), ""); assert.equal(entry("2026-13-01"), ""); assert.equal(entry("31.11.2026"), ""); assert.equal(entry("2026-1-5"), "2026-01-05");
    // With the year a past date is that date.
    assert.equal(entry("1.1.2020"), "2020-01-01");
    assert.equal(entry("today"), "2026-11-16"); assert.equal(entry("Tomorrow"), "2026-11-17"); assert.equal(entry("yesterday"), "2026-11-15");
    assert.equal(entry("+3d"), "2026-11-19"); assert.equal(entry("-2d"), "2026-11-14"); assert.equal(entry("+1w"), "2026-11-23"); assert.equal(entry("+1m"), "2026-12-16");
    assert.equal(entry("fri"), "2026-11-20"); assert.equal(entry("monday"), "2026-11-23", "the weekday of today is next week's");
    assert.equal(entry("14 nov"), "2027-11-14"); assert.equal(entry("nov 20"), "2026-11-20"); assert.equal(entry("20 listopada"), "2026-11-20"); assert.equal(entry("nov 14 2030"), "2030-11-14");
    assert.equal(entry("@tomorrow"), "2026-11-17");
    for (const text of ["", " ", "x", "soon", "14.11.2026 x", "x 14.11.2026", "1 2 3 4", "14..11", "14.11.20261", "20261114", "141126", "411", "2026", "1.2.3.4", "14:11", "-14", "+14", null, undefined, {}]) assert.equal(entry(text), "", String(text));
  });

  await test("titles of notes are not read this way; the composer's data are", () => {
    // parseDateKeyText reads the titles of date notes and Journal headings: a note called "14" or "1411" is no date note.
    for (const title of ["14", "1411", "14.11", "14,11", "tomorrow"]) assert.equal(C.parseDateKeyText(title, "DD-MM-YYYY"), "", title);
    assert.equal(C.parseDateKeyText("14-11-2026", "DD-MM-YYYY"), "2026-11-14");
    // composeCalendarItem takes a time in any typed form and builds the item of the full form.
    const make = (startTime, endTime) => C.composeCalendarItem({ kind: "event", summary: "Shift", startDate: "2026-11-20", startTime, endDate: "2026-11-20", endTime }, NOW);
    const full = make("08:30", "16:00");
    assert.equal(full.start.dateTime, new Date(2026, 10, 20, 8, 30).toISOString());
    for (const [a, b] of [["830", "16"], ["8.30", "4pm"], ["8,30", "1600"], ["8 30", "16h"]]) {
      const typed = make(a, b);
      assert.deepEqual([typed.start.dateTime, typed.end.dateTime], [full.start.dateTime, full.end.dateTime], a + " / " + b);
    }
    assert.equal(make("25", "16"), null); assert.equal(make("8", "860"), null); assert.equal(make("16", "8"), null, "an end before the start is still refused");
    // In a zone of its own too (the conversion wants the full form).
    assert.equal(C.composeCalendarItem({ kind: "reminder", summary: "Call", startDate: "2026-11-20", startTime: "9am", tz: "UTC+03:00" }, NOW).start.dateTime, "2026-11-20T06:00:00.000Z");
  });

  // ---------------------------------------------------------------- 3. the fields of the real sheet
  const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  const dom = require("./helpers/fake-dom.cjs")();
  const { El, Ev, document, raf } = dom;
  const listeners = new Map();
  const win = {
    __zentralNotesParts: { "notes-calendar": C }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {},
    requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, queueMicrotask,
    innerWidth: 1200, innerHeight: 800,
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((x) => x !== fn)); },
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); },
  };
  win.window = win;
  vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, Intl, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux", language: "en-GB" } });
  const core = win.__zentralNotesTestSeam.core;
  const flush = async () => { for (let i = 0; i < 6; i++) { raf.splice(0).forEach((fn) => fn()); await new Promise((resolve) => setImmediate(resolve)); } };
  const files = new Map();
  const io = {
    join: (...parts) => parts.join("/"), filename: (value) => value.split("/").pop(),
    readUTF8: async (value) => { if (!files.has(value)) throw new Error("not found"); return files.get(value).text; },
    writeUTF8: async (value, text) => files.set(value, { text, mtime: Date.now() }),
    remove: async (value) => files.delete(value), exists: async (value) => files.has(value),
    children: async (dir) => [...files.keys()].filter((value) => value.startsWith(dir + "/") && !value.slice(dir.length + 1).includes("/")),
    stat: async (value) => ({ lastModified: files.get(value)?.mtime || 0 }), restrict: async () => {},
  };
  const store = core.createStore({ io, notify() {}, windowId: "typing-ui", getDir: async () => "/typing", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (root) => host.append(root), getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const prefs = new Map();
  const env = { getPref: (key, fallback) => prefs.has(key) ? prefs.get(key) : fallback, setPref: (key, value) => prefs.set(key, value), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
  await store.open();
  const plain = store.create("# A note\n\nText");
  await store.flush();
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root; root.ownerDocument = document;
  root.querySelector(".zn-all-layout").getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  root.querySelector(".zn-all-panels").getBoundingClientRect = root.querySelector(".zn-all-layout").getBoundingClientRect;
  root.querySelector(".zn-calendar-pane").getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await sheet.open(); await flush();
  root.all().find((node) => node.title === "All notes").click(); await flush(); // the calendar is beside the list of notes
  const menuItem = (label) => root.querySelectorAll(".zn-menu-item").find((node) => node.textContent.trim().startsWith(label));
  const openTools = async (label) => {
    const item = openCalendarRow(root, ".zn-calendar-tools", label);
    assert.ok(item, "Calendar Tools offers " + label);
    item.click(); await flush();
  };
  // What a person does: types (the field says so with "input"), leaves the field ("change", then "blur"), presses a key.
  const type = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new Ev("input", { bubbles: true })); };
  const leave = (input) => { input.dispatchEvent(new Ev("change", { bubbles: true })); input.dispatchEvent(new Ev("blur")); };
  const key = (node, name) => { const event = new Ev("keydown", { key: name, bubbles: true }); node.dispatchEvent(event); return event; };
  const button = (scope, text) => scope.querySelectorAll("button").find((node) => node.textContent.trim() === text);
  const labelled = (scope, label) => scope.querySelector('[aria-label="' + label + '"]');
  const hintOf = (input) => { const id = input.getAttribute("aria-describedby"); const node = id ? root.all().find((entry) => entry.id === id) : null; assert.ok(node, "the field has its line"); return node; };
  // The composer opens on the day the calendar stands on; every case but the first starts from today.
  const composer = async (label, day = "") => {
    await openTools(label);
    const card = root.querySelector(".zn-cal-compose-card");
    assert.ok(card, "the composer opens");
    if (day) { const date = labelled(card, "Start date"); type(date, day); leave(date); assert.equal(date.value, day); }
    return card;
  };
  const TODAY = "2026-11-16";
  const itemNamed = (summary) => store.items.list().find((item) => item.summary === summary);

  await test("the composer: 830 and 14,11 are read while they are typed, written in full when the field is left, and saved", async () => {
    const card = await composer("Create timed reminder…");
    labelled(card, "Title").value = "Dentist";
    const time = labelled(card, "Start time"), date = labelled(card, "Start date"), preview = card.querySelector(".zn-cal-compose-preview");
    assert.equal(time.value, "09:00"); assert.equal(date.value, "2026-11-16");
    assert.equal(hintOf(time).textContent, "", "a time in its full form needs no second copy");
    assert.match(hintOf(date).textContent, /16-11-2026$/, "a date has its weekday and the date format of the settings from the start");
    type(time, "830");
    assert.equal(time.value, "830", "the text is not changed under the fingers");
    assert.equal(hintOf(time).textContent, "08:30", "the line under the field says how it is read");
    assert.match(preview.textContent, /08:30/, "and so does the summary of the item");
    leave(time);
    assert.equal(time.value, "08:30", "leaving the field writes the full form");
    assert.equal(hintOf(time).textContent, "");
    type(date, "14,11");
    assert.match(hintOf(date).textContent, /14-11-2027$/, "the 14th of November has passed this year");
    assert.match(preview.textContent, /2027-11-14/);
    leave(date);
    assert.equal(date.value, "2027-11-14");
    assert.match(hintOf(date).textContent, /14-11-2027$/);
    button(card, "Create reminder").click(); await flush();
    assert.ok(!root.querySelector(".zn-cal-compose-card"), "the composer closed");
    assert.equal(itemNamed("Dentist").start.dateTime, new Date(2027, 10, 14, 8, 30).toISOString());
  });

  await test("a day alone is a day of the month the field shows; Enter writes it and does not save", async () => {
    const card = await composer("Create timed reminder…");
    labelled(card, "Title").value = "Not yet";
    const date = labelled(card, "Start date");
    assert.equal(date.value, "2027-11-14", "the composer opens on the day the calendar stands on: the item made last");
    type(date, "20");
    assert.match(hintOf(date).textContent, /20-11-2027$/, "the 20th of the month the field shows");
    type(date, "2026-11-16"); leave(date);
    type(date, "20");
    assert.match(hintOf(date).textContent, /20-11-2026$/);
    const enter = key(date, "Enter");
    assert.equal(enter.defaultPrevented, true);
    assert.equal(date.value, "2026-11-20");
    assert.ok(root.querySelector(".zn-cal-compose-card"), "Enter in a date field does not save");
    assert.equal(itemNamed("Not yet"), undefined);
    type(date, "5"); key(date, "Enter");
    assert.equal(date.value, "2026-11-05", "a day that has passed in that month is still that day");
    type(date, "31");
    assert.match(hintOf(date).textContent, /^Not a date yet/, "November has 30 days");
    assert.equal(hintOf(date).dataset.bad, undefined, "while it is typed nothing is marked");
    key(date, "Enter");
    assert.equal(date.value, "2026-11-05", "a text that is no date puts the date before back");
    assert.equal(date.dataset.bad, "true");
    assert.equal(hintOf(date).dataset.bad, "true");
    assert.match(hintOf(date).textContent, /^\u201c31\u201d is not a date\. The field keeps .*05-11-2026\.$/);
    type(date, "1.12");
    assert.equal(date.dataset.bad, undefined, "typing again takes the mark away");
    leave(date);
    assert.equal(date.value, "2026-12-01");
    type(date, "20"); leave(date);
    assert.equal(date.value, "2026-12-20", "the month of the field is the one a day alone is in");
    button(card, "Cancel").click(); await flush();
  });

  await test("a text that is no time puts the time before back, marks the field and holds the next Save once", async () => {
    const card = await composer("Create timed reminder…", TODAY);
    labelled(card, "Title").value = "Held";
    const time = labelled(card, "Start time"), status = card.querySelector(".zn-cal-compose-status");
    type(time, "25"); leave(time);
    assert.equal(time.value, "09:00");
    assert.equal(time.dataset.bad, "true");
    assert.equal(hintOf(time).textContent, "\u201c25\u201d is not a time. The field keeps 09:00.");
    button(card, "Create reminder").click(); await flush();
    assert.ok(root.querySelector(".zn-cal-compose-card"), "the Save that follows a refusal is held");
    assert.equal(itemNamed("Held"), undefined, "nothing was saved with the time the person believed to have replaced");
    assert.equal(status.textContent, "Start time: \u201c25\u201d is not a time. The field keeps 09:00.");
    assert.equal(dom.state.activeElement, time, "the field has the focus");
    button(card, "Create reminder").click(); await flush();
    assert.equal(itemNamed("Held").start.dateTime, new Date(2026, 10, 16, 9, 0).toISOString(), "the second Save takes the time that was kept");
    // A Save that leaves no field (the text is in the field, nothing else happened): the same.
    const second = await composer("Create timed reminder…", TODAY);
    labelled(second, "Title").value = "Typed and saved";
    const typed = labelled(second, "Start time");
    typed.value = "860";
    button(second, "Create reminder").click(); await flush();
    assert.ok(root.querySelector(".zn-cal-compose-card"));
    assert.equal(typed.value, "09:00"); assert.equal(typed.dataset.bad, "true");
    assert.match(second.querySelector(".zn-cal-compose-status").textContent, /^Start time: \u201c860\u201d is not a time/);
    assert.equal(itemNamed("Typed and saved"), undefined);
    typed.value = "1630";
    button(second, "Create reminder").click(); await flush();
    assert.equal(itemNamed("Typed and saved").start.dateTime, new Date(2026, 10, 16, 16, 30).toISOString(), "a time typed fast is saved without leaving the field");
    // An emptied field is no time either.
    const third = await composer("Create timed reminder…");
    labelled(third, "Title").value = "Emptied";
    const emptied = labelled(third, "Start time");
    type(emptied, ""); leave(emptied);
    assert.equal(emptied.value, "09:00");
    assert.equal(hintOf(emptied).textContent, "An empty field is not a time. The field keeps 09:00.");
    button(third, "Cancel").click(); await flush();
  });

  await test("two refused fields hold one Save, which names the first; typing replaces the old value", async () => {
    const card = await composer("Create timed event…", TODAY);
    labelled(card, "Title").value = "Two wrong";
    const start = labelled(card, "Start time"), end = labelled(card, "End time"), status = card.querySelector(".zn-cal-compose-status");
    type(start, "77"); leave(start);
    type(end, "88"); leave(end);
    assert.equal(start.dataset.bad, "true"); assert.equal(end.dataset.bad, "true");
    button(card, "Create event").click(); await flush();
    assert.ok(root.querySelector(".zn-cal-compose-card"));
    assert.match(status.textContent, /^Start time: \u201c77\u201d is not a time/);
    assert.equal(dom.state.activeElement, start);
    assert.equal(itemNamed("Two wrong"), undefined);
    button(card, "Create event").click(); await flush();
    assert.ok(itemNamed("Two wrong"), "one held Save is enough for both fields: the second one saves the times that were kept");
    assert.deepEqual([itemNamed("Two wrong").start.dateTime, itemNamed("Two wrong").end.dateTime], [new Date(2026, 10, 16, 9, 0).toISOString(), new Date(2026, 10, 16, 10, 0).toISOString()]);
    // The text of a field is selected when the field gets the focus, by the keyboard and by a click alike, so
    // "830" replaces "09:00" instead of becoming "09:00830". The click after that places the caret as usual.
    const again = await composer("Create timed reminder…", TODAY);
    const time = labelled(again, "Start time");
    let selected = 0;
    time.select = () => { selected++; };
    time.focus();
    assert.equal(selected, 1, "the focus selects the text");
    const first = new Ev("mouseup", { bubbles: true }); time.dispatchEvent(first);
    assert.equal(first.defaultPrevented, true, "the click that brought the focus does not put the caret into the old text");
    assert.equal(selected, 2);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(selected, 3, "and once more when the click is over (an engine may move the selection then)");
    const next = new Ev("mouseup", { bubbles: true }); time.dispatchEvent(next);
    assert.equal(next.defaultPrevented, false, "the next click is an ordinary one");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(selected, 3);
    // A field that has the focus already (the dialog opened with it, Tab reached it) has its whole text selected:
    // the first click into it is not let through, so the selection stays; the one after it is an ordinary click.
    labelled(again, "Title").focus(); time.focus();
    time.setSelectionRange(0, time.value.length);
    const before = selected;
    const press = new Ev("mousedown", { bubbles: true }); time.dispatchEvent(press);
    assert.equal(press.defaultPrevented, true, "a click into the selected text of a fresh field keeps the selection");
    const release = new Ev("mouseup", { bubbles: true }); time.dispatchEvent(release);
    assert.equal(release.defaultPrevented, true);
    // A key that comes before the click is over is the person typing: the text is not selected under it.
    type(time, "8");
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(selected, before + 2, "selected at the focus the helper gives and at the release, not again after the key");
    const pressAgain = new Ev("mousedown", { bubbles: true }); time.dispatchEvent(pressAgain);
    assert.equal(pressAgain.defaultPrevented, false, "the second click places the caret");
    time.setSelectionRange(0, 0);
    // The press that brings the focus is never held back (the field does not have the focus yet).
    labelled(again, "Title").focus();
    const bringing = new Ev("mousedown", { bubbles: true }); time.dispatchEvent(bringing);
    assert.equal(bringing.defaultPrevented, false);
    // A part of the text selected with that first click is left alone.
    labelled(again, "Title").focus(); time.focus();
    time.setSelectionRange(0, 2);
    const drag = new Ev("mouseup", { bubbles: true }); time.dispatchEvent(drag);
    assert.equal(drag.defaultPrevented, false);
    time.setSelectionRange(0, 0);
    // After a key the person is editing: a click then places the caret.
    labelled(again, "Title").focus(); time.focus();
    key(time, "ArrowLeft");
    const afterKey = new Ev("mouseup", { bubbles: true }); time.dispatchEvent(afterKey);
    assert.equal(afterKey.defaultPrevented, false);
    labelled(again, "Title").focus(); time.focus();
    type(time, "8");
    const afterTyping = new Ev("mouseup", { bubbles: true }); time.dispatchEvent(afterTyping);
    assert.equal(afterTyping.defaultPrevented, false);
    button(again, "Cancel").click(); await flush();
  });

  await test("the start time of an event takes both times at once", async () => {
    const card = await composer("Create timed event…", TODAY);
    labelled(card, "Title").value = "Shift";
    const start = labelled(card, "Start time"), end = labelled(card, "End time");
    type(start, "8-16");
    assert.equal(hintOf(start).textContent, "08:00 \u2013 16:00");
    leave(start);
    assert.equal(start.value, "08:00"); assert.equal(end.value, "16:00");
    assert.match(card.querySelector(".zn-cal-compose-preview").textContent, /08:00.*16:00/);
    type(end, "4.30pm"); leave(end);
    assert.equal(end.value, "16:30");
    button(card, "Create event").click(); await flush();
    const made = itemNamed("Shift");
    assert.deepEqual([made.start.dateTime, made.end.dateTime], [new Date(2026, 10, 16, 8, 0).toISOString(), new Date(2026, 10, 16, 16, 30).toISOString()]);
    // A reminder has one time: two are no time there, and the end time of an event takes one.
    const reminder = await composer("Create timed reminder…");
    const only = labelled(reminder, "Start time");
    type(only, "8-16");
    assert.match(hintOf(only).textContent, /^Not a time yet/);
    leave(only);
    assert.equal(only.value, "09:00"); assert.equal(only.dataset.bad, "true");
    button(reminder, "Cancel").click(); await flush();
  });

  await test("the date format of the settings decides which of two numbers is the month", async () => {
    prefs.set(core.PREF.DATE_DISPLAY, "MM/DD/YYYY");
    const card = await composer("Create timed reminder…", TODAY);
    const date = labelled(card, "Start date");
    assert.match(hintOf(date).textContent, /11\/16\/2026$/, "the line shows the date in the format of the settings");
    type(date, "3,4");
    assert.match(hintOf(date).textContent, /03\/04\/2027$/);
    leave(date);
    assert.equal(date.value, "2027-03-04");
    type(date, "14,11"); leave(date);
    assert.equal(date.value, "2027-11-14", "there is no 14th month");
    button(card, "Cancel").click(); await flush();
    prefs.delete(core.PREF.DATE_DISPLAY);
    const again = await composer("Create timed reminder…");
    const dayFirst = labelled(again, "Start date");
    type(dayFirst, "3,4"); leave(dayFirst);
    assert.equal(dayFirst.value, "2027-04-03");
    button(again, "Cancel").click(); await flush();
  });

  await test("the Clock opens at the time that was typed and writes into the same field", async () => {
    const card = await composer("Create timed reminder…");
    const time = labelled(card, "Start time");
    type(time, "915pm");
    button(card, "Clock…").click(); await flush();
    const hour = card.querySelector(".zn-cal-clock-hour"), minute = card.querySelector(".zn-cal-clock-minute");
    assert.deepEqual([hour.value, minute.value], ["21", "15"]);
    hour.value = "07"; hour.dispatchEvent(new Ev("change", { bubbles: true }));
    assert.equal(time.value, "07:15");
    assert.equal(hintOf(time).textContent, "");
    type(time, "x"); leave(time);
    assert.equal(time.value, "07:15", "the time the Clock wrote is the one a refused text is replaced by");
    button(card, "Cancel").click(); await flush();
  });

  // The calendar goes back to this month; the items of the cases below are in it.
  const monthMark = (summary) => root.querySelectorAll(".zn-cal-month-mark").find((node) => node.textContent.trim() === summary);
  const itemMenu = async (summary, ...labels) => {
    const mark = monthMark(summary);
    assert.ok(mark, "the month shows " + summary);
    mark.dispatchEvent(new Ev("contextmenu", { bubbles: true, clientX: 60, clientY: 70 }));
    for (const label of labels) {
      const item = menuItem(label);
      assert.ok(item, "the menu of the item offers " + label + "; it has: " + root.querySelectorAll(".zn-menu-item").map((node) => node.textContent.trim()).join(" | "));
      item.click(); await flush();
    }
  };

  await test("change time: the new time can be typed, the Clock follows, and a refused text saves nothing", async () => {
    store.setMeta({ calendarCursor: TODAY, calendarView: "month" });
    assert.ok(store.items.upsert({ id: "typing-move", summary: "Review", start: { dateTime: new Date(2026, 10, 18, 10, 0).toISOString() }, end: { dateTime: new Date(2026, 10, 18, 11, 0).toISOString() }, x: { kind: "event", src: "manual" } }));
    sheet.refresh?.(); await flush();
    await itemMenu("Review", "Change time…");
    const card = root.querySelector('.zn-dialog-card[aria-label="Change calendar item time"]');
    assert.ok(card, "the dialog opens");
    const date = labelled(card, "New date"), time = labelled(card, "New time");
    assert.ok(time, "the time can be typed");
    assert.equal(date.value, "2026-11-18"); assert.equal(time.value, "10:00");
    const hour = card.querySelector(".zn-cal-clock-hour"), minute = card.querySelector(".zn-cal-clock-minute");
    assert.deepEqual([hour.value, minute.value], ["10", "00"]);
    type(time, "1630");
    assert.equal(hintOf(time).textContent, "16:30");
    leave(time);
    assert.equal(time.value, "16:30");
    assert.deepEqual([hour.value, minute.value], ["16", "30"], "the Clock shows the typed time");
    minute.value = "45"; minute.dispatchEvent(new Ev("change", { bubbles: true }));
    assert.equal(time.value, "16:45", "and the field shows what the Clock chose");
    type(date, "19");
    assert.match(hintOf(date).textContent, /19-11-2026$/);
    button(card, "Save new time").click(); await flush();
    const moved = store.items.get("typing-move");
    assert.deepEqual([moved.start.dateTime, moved.end.dateTime], [new Date(2026, 10, 19, 16, 45).toISOString(), new Date(2026, 10, 19, 17, 45).toISOString()], "the date typed as a day alone and the typed time, the length kept");
    await itemMenu("Review", "Change time…");
    const again = root.querySelector('.zn-dialog-card[aria-label="Change calendar item time"]');
    const bad = labelled(again, "New time");
    bad.value = "99";
    button(again, "Save new time").click(); await flush();
    assert.ok(root.querySelector('.zn-dialog-card[aria-label="Change calendar item time"]'), "the dialog stays");
    assert.equal(bad.value, "16:45"); assert.equal(bad.dataset.bad, "true");
    assert.equal(store.items.get("typing-move").start.dateTime, moved.start.dateTime, "nothing was saved");
    button(again, "Cancel").click(); await flush();
  });

  await test("custom snooze: date and time are typed the same way", async () => {
    assert.ok(store.items.upsert({ id: "typing-snooze", summary: "Pay rent", start: { dateTime: new Date(2026, 10, 17, 9, 0).toISOString() }, x: { kind: "reminder", src: "manual" } }));
    await flush();
    await itemMenu("Pay rent", "Snooze", "Custom date and time…");
    const card = root.querySelector('.zn-dialog-card[aria-label="Custom reminder snooze"]');
    assert.ok(card, "the dialog opens");
    const date = labelled(card, "New date"), time = labelled(card, "New time");
    assert.equal(date.value, "2026-11-17"); assert.equal(time.value, "09:00");
    type(date, "21"); leave(date);
    type(time, "7pm");
    assert.equal(hintOf(time).textContent, "19:00");
    button(card, "Snooze reminder").click(); await flush();
    assert.equal(store.items.get("typing-snooze").start.dateTime, new Date(2026, 10, 21, 19, 0).toISOString());
  });

  await test("the last day of a series: a day alone is in the month of the start, in the composer and in the details", async () => {
    const card = await composer("Create timed reminder…", "2027-02-10");
    labelled(card, "Title").value = "Water the plants";
    const frequency = labelled(card, "Repeat frequency"), ending = labelled(card, "Repeat ending"), until = labelled(card, "Last occurrence date");
    frequency.value = "DAILY"; frequency.dispatchEvent(new Ev("change", { bubbles: true }));
    ending.value = "until"; ending.dispatchEvent(new Ev("change", { bubbles: true }));
    assert.equal(until.value, "");
    assert.equal(hintOf(until).textContent, "", "an empty field that never held a date says nothing");
    leave(until);
    assert.equal(until.dataset.bad, undefined, "and is not marked for being left empty");
    type(until, "20");
    assert.match(hintOf(until).textContent, /20-02-2027$/, "the month of the start date, not this month");
    type(until, "30");
    assert.match(hintOf(until).textContent, /^Not a date yet/);
    button(card, "Create reminder").click(); await flush();
    assert.ok(root.querySelector(".zn-cal-compose-card"), "February has no 30th: the composer stays open");
    assert.match(card.querySelector(".zn-cal-compose-status").textContent, /^Last occurrence date: \u201c30\u201d is not a date\.$/);
    assert.equal(until.value, "");
    until.value = "14";
    button(card, "Create reminder").click(); await flush();
    const made = itemNamed("Water the plants");
    assert.ok(made, "the series was created");
    assert.match(made.recurrence.join(";"), /UNTIL=20270214/);
    // The details of the same item: its last day is shown and can be typed anew.
    store.setMeta({ calendarCursor: "2027-02-10", calendarView: "month" }); await flush();
    const mark = monthMark("Water the plants");
    assert.ok(mark, "the month shows the series");
    mark.click(); await flush();
    const details = root.querySelector('.zn-dialog-card[aria-label="Calendar item details"]');
    assert.ok(details, "the details open");
    const last = labelled(details, "Last occurrence date");
    assert.equal(last.value, "2027-02-14");
    assert.match(hintOf(last).textContent, /14-02-2027$/);
    type(last, "1.3");
    assert.match(hintOf(last).textContent, /01-03-2027$/);
    button(details, "Save calendar details").click(); await flush();
    assert.match(store.items.get(made.id).recurrence.join(";"), /UNTIL=20270301/);
    mark.click(); await flush();
    const reopened = root.querySelector('.zn-dialog-card[aria-label="Calendar item details"]');
    const refused = labelled(reopened, "Last occurrence date");
    refused.value = "soon";
    button(reopened, "Save calendar details").click(); await flush();
    assert.ok(root.querySelector('.zn-dialog-card[aria-label="Calendar item details"]'), "a text that is no date keeps the details open");
    assert.equal(refused.value, "2027-03-01"); assert.equal(refused.dataset.bad, "true");
    assert.match(store.items.get(made.id).recurrence.join(";"), /UNTIL=20270301/);
    button(reopened, "Cancel").click(); await flush();
  });

  await test("When am I free?: the two dates are typed fast, Enter looks again", async () => {
    store.setMeta({ calendarCursor: TODAY, calendarView: "month" }); await flush();
    await openTools("When am I free?…");
    const card = root.querySelector('.zn-dialog-card[aria-label="When am I free?"]');
    assert.ok(card, "the dialog opens");
    const from = labelled(card, "From date"), through = labelled(card, "Through date"), results = card.querySelector(".zn-cal-free-results");
    assert.equal(from.value, "2026-11-16"); assert.equal(through.value, "2026-11-22");
    type(from, "23"); key(from, "Enter");
    assert.equal(from.value, "2026-11-23");
    assert.equal(dom.state.activeElement, through, "a range that ends before it begins: the other field is asked for");
    assert.equal(results.textContent, "Choose a valid range of up to 90 days.");
    type(through, "24"); key(through, "Enter");
    assert.equal(through.value, "2026-11-24");
    assert.match(results.textContent, /free slots? found/);
    assert.ok(results.querySelectorAll(".zn-cal-free-slot").length > 0);
    type(through, "tomorow");
    button(card, "Find free times").click(); await flush();
    assert.equal(through.value, "2026-11-24"); assert.equal(through.dataset.bad, "true");
    assert.match(results.textContent, /^Through date: \u201ctomorow\u201d is not a date/);
    button(card, "Close").click(); await flush();
  });

  await test("the reminder of a note: the line under the fields reads them as Save will; Enter saves what was read", async () => {
    sheet.openNoteById(plain.id); await flush();
    const more = root.querySelectorAll(".zn-btn").find((node) => node.title === "More");
    more.click(); await flush();
    root.querySelectorAll(".zn-menu-item").find((node) => node.textContent === "Remind me\u2026").click(); await flush();
    const card = root.querySelector('.zn-dialog-card[aria-label="Remind me about this note"]');
    assert.ok(card, "the dialog opens");
    const [date, time] = card.querySelectorAll(".zn-field"), preview = card.querySelector(".zn-remind-preview");
    assert.equal(date.value, "2026-11-16", "in one hour is today");
    type(date, "17");
    type(time, "830");
    assert.match(preview.textContent, /^Will ring at 2026-11-17 08:30 \(in /);
    assert.equal(preview.dataset.bad, "false");
    type(time, "8:9x");
    assert.equal(preview.textContent, "Enter a date (14, 14.11 or 2026-11-02) and a time (16, 830 or 9am)");
    key(time, "Enter");
    assert.ok(root.querySelector('.zn-dialog-card[aria-label="Remind me about this note"]'), "Enter on a text that is no time sets nothing");
    assert.equal(store.get(plain.id).remind || 0, 0);
    assert.equal(time.dataset.bad, "true");
    type(time, "8.30"); key(time, "Enter");
    assert.ok(!root.querySelector('.zn-dialog-card[aria-label="Remind me about this note"]'), "Enter on a time reads it and sets the reminder");
    assert.equal(store.get(plain.id).remind, local(2026, 11, 17, 8, 30));
  });

  await test("a note for a date: 14,11 and Enter open the note of that day", async () => {
    const more = root.querySelectorAll(".zn-btn").find((node) => node.title === "More");
    more.click(); await flush();
    menuItem("Links & dates").click(); await flush();
    menuItem("Notes by date\u2026").click(); await flush();
    menuItem("Other date\u2026").click(); await flush();
    const card = root.querySelector('.zn-dialog-card[aria-label="Note for a date"]');
    assert.ok(card, "the dialog opens");
    const date = card.querySelector(".zn-field");
    assert.equal(date.value, "2026-11-16");
    type(date, "31.11"); key(date, "Enter");
    assert.ok(root.querySelector('.zn-dialog-card[aria-label="Note for a date"]'), "there is no 31 November: nothing opens");
    assert.equal(date.value, "2026-11-16"); assert.equal(date.dataset.bad, "true");
    type(date, "14,11");
    assert.match(hintOf(date).textContent, /14-11-2027$/);
    key(date, "Enter"); await flush();
    assert.ok(!root.querySelector('.zn-dialog-card[aria-label="Note for a date"]'));
    assert.ok(store.list().some((entry) => core.dateOfNote(entry) === "2027-11-14"), "the note of 14 November 2027 exists");
  });

  console.log(passed + " typing tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
