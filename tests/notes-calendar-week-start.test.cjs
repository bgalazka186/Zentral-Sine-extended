"use strict";
/* AU-B5: Week start day setting (Monday / Sunday, default Monday) + optional week numbers column
 * across Month, narrow Month picker, Week, shared mini date picker, and week export. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const makeDom = require("./helpers/fake-dom.cjs");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

const day = (y, m, d) => new Date(y, m - 1, d).getTime();

function loadSeam() {
  const dom = makeDom();
  dom.El.prototype.ownerDocument = dom.document;
  const disk = new Map();
  const winListeners = [];
  const win = {
    document: dom.document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    __zentralNotesParts: { "notes-calendar": cal },
    innerWidth: 1280,
    innerHeight: 900,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    addEventListener: (type, fn, capture) => winListeners.push({ type, fn, capture }),
    removeEventListener: (type, fn) => {
      const idx = winListeners.findIndex((entry) => entry.type === type && entry.fn === fn);
      if (idx >= 0) winListeners.splice(idx, 1);
    },
    getComputedStyle: () => ({ fontSize: "13px", getPropertyValue: () => "" }),
  };
  win.window = win;
  const ctx = {
    window: win,
    document: dom.document,
    Event: dom.Ev,
    console,
    URL,
    Date,
    Math,
    JSON,
    Promise,
    RegExp,
    Number,
    Map,
    Set,
    Array,
    Object,
    String,
    Boolean,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    navigator: { platform: "Linux", clipboard: { writeText() {} } },
    Services: {
      prefs: { getBoolPref: (_k, d) => d, getStringPref: (_k, d) => d, getIntPref: (_k, d) => d, addObserver() {}, removeObserver() {} },
      obs: { addObserver() {}, removeObserver() {}, notifyObservers() {} },
    },
    CustomizableUI: { createWidget() {}, destroyWidget() {} },
    ChromeUtils: { importESModule: () => ({ AppConstants: {} }) },
    PathUtils: { profileDir: "/p", join: (...p) => p.join("/"), filename: (p) => p.split("/").pop() },
    IOUtils: {
      makeDirectory: async () => {},
      getChildren: async () => [],
      exists: async (p) => disk.has(p),
      readUTF8: async (p) => {
        if (!disk.has(p)) throw new Error("ENOENT " + p);
        return disk.get(p);
      },
      writeUTF8: async (p, text) => {
        disk.set(p, text);
      },
      remove: async (p) => {
        disk.delete(p);
      },
      stat: async (p) => ({ size: (disk.get(p) || "").length }),
    },
  };
  const src = fs.readFileSync(path.join(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  vm.runInNewContext(src, ctx, { filename: "ZentralNotes.uc.js" });
  return { seam: win.__zentralNotesTestSeam, dom, win, disk };
}

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
  await test("pure week-start cleaners, weekday labels, monthGrid/weekDays/pickerKey for Monday and Sunday, and weekNumber", () => {
    assert.deepEqual([...cal.WEEK_START_DAYS], [1, 0]);
    assert.equal(cal.cleanWeekStart(), 1, "defaults to Monday (1)");
    assert.equal(cal.cleanWeekStart(null), 1);
    assert.equal(cal.cleanWeekStart("invalid"), 1);
    assert.equal(cal.cleanWeekStart(1), 1);
    assert.equal(cal.cleanWeekStart("mon"), 1);
    assert.equal(cal.cleanWeekStart("Monday"), 1);
    assert.equal(cal.cleanWeekStart(0), 0);
    assert.equal(cal.cleanWeekStart("0"), 0);
    assert.equal(cal.cleanWeekStart("sun"), 0);
    assert.equal(cal.cleanWeekStart("Sunday"), 0);

    assert.equal(cal.cleanWeekNumbers(), false);
    assert.equal(cal.cleanWeekNumbers("true"), false);
    assert.equal(cal.cleanWeekNumbers(true), true);

    assert.deepEqual(cal.weekdayLabels(1, "short"), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    assert.deepEqual(cal.weekdayLabels(0, "short"), ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    assert.deepEqual(cal.weekdayLabels(0, "long")[0], "Sunday");
    assert.deepEqual(cal.weekdayLabels(1, "long")[0], "Monday");

    // November 1, 2026 is a Sunday: Monday-start grid leads with Mon Oct 26; Sunday-start grid starts right on Sun Nov 1.
    const monGrid = cal.monthGrid(2026, 10, 1);
    const sunGrid = cal.monthGrid(2026, 10, 0);
    assert.equal(cal.localDateKey(monGrid[0][0]), "2026-10-26");
    assert.equal(cal.localDateKey(monGrid[0][6]), "2026-11-01");
    assert.equal(cal.localDateKey(sunGrid[0][0]), "2026-11-01");
    assert.equal(cal.localDateKey(sunGrid[0][6]), "2026-11-07");

    // Sunday 2026-11-15 belongs to the end of Mon..Sun week 2026-11-09..15, OR the start of Sun..Sat week 2026-11-15..21.
    const sun15 = day(2026, 11, 15);
    assert.deepEqual(cal.weekDays(sun15, 1).map(cal.localDateKey), [
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15",
    ]);
    assert.deepEqual(cal.weekDays(sun15, 0).map(cal.localDateKey), [
      "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21",
    ]);
    assert.equal(cal.localDateKey(cal.pickerKey(sun15, "Home", 1)), "2026-11-09");
    assert.equal(cal.localDateKey(cal.pickerKey(sun15, "End", 1)), "2026-11-15");
    assert.equal(cal.localDateKey(cal.pickerKey(sun15, "Home", 0)), "2026-11-15");
    assert.equal(cal.localDateKey(cal.pickerKey(sun15, "End", 0)), "2026-11-21");

    // Week numbers: ISO 8601 for Monday-first, Sunday-first week-of-year for Sunday-first, constant across every row.
    assert.equal(cal.weekNumber(day(2025, 12, 29), 1), 1, "Mon 2025-12-29 is ISO Week 1 of 2026");
    assert.equal(cal.weekNumber(day(2026, 1, 4), 1), 1, "Sun 2026-01-04 is ISO Week 1 of 2026");
    assert.equal(cal.weekNumber(day(2026, 11, 16), 1), 47, "Mon 2026-11-16 is ISO Week 47");
    assert.equal(cal.weekNumber(day(2026, 12, 28), 1), 53, "Mon 2026-12-28 is ISO Week 53 of 2026");
    assert.equal(cal.weekNumber(day(2027, 1, 3), 1), 53, "Sun 2027-01-03 is still ISO Week 53 of 2026");

    assert.equal(cal.weekNumber(day(2025, 12, 28), 0), 1, "Sun 2025-12-28 starts Week 1 of 2026 (contains Jan 1)");
    assert.equal(cal.weekNumber(day(2026, 1, 3), 0), 1, "Sat 2026-01-03 ends Week 1 of 2026");
    assert.equal(cal.weekNumber(day(2022, 12, 31), 0), 53, "Sat 2022-12-31 is Week 53 of 2022");
    assert.equal(cal.weekNumber(day(2023, 1, 1), 0), 1, "Sun 2023-01-01 starts Week 1 of 2023");

    for (const ws of [1, 0]) {
      for (const m of [0, 2, 9, 10, 11]) {
        for (const row of cal.monthGrid(2026, m, ws)) {
          const nums = new Set(row.map((d) => cal.weekNumber(d, ws)));
          assert.equal(nums.size, 1, `all 7 days in a row share one week number (month=${m}, weekStart=${ws})`);
        }
      }
    }

    const plainMd = cal.weekText([], day(2026, 11, 15));
    assert.ok(plainMd.startsWith("## Sunday 2026-11-15"), "weekText without weekNumbers keeps exact legacy heading");
    const numberedMd = cal.weekText([], day(2026, 11, 15), { weekNumbers: true, weekStart: 0 });
    assert.ok(numberedMd.startsWith("# Week 47\n\n## Sunday 2026-11-15"), "weekText with weekNumbers prepends # Week N");
  });

  await test("UI: Month, narrow picker, Week, composer mini picker and week export follow Week start & optional week numbers", async () => {
    const { seam, dom } = loadSeam();
    let copied = "";
    const now = new Date(2026, 10, 15, 10, 0, 0, 0).getTime(); // Sunday 15 Nov 2026
    const disk = new Map();
    const store = seam.core.createStore({
      io: {
        makeDirectory: async () => {},
        children: async () => [],
        exists: async (p) => disk.has(p),
        readUTF8: async (p) => {
          if (!disk.has(p)) throw new Error("ENOENT " + p);
          return disk.get(p);
        },
        writeUTF8: async (p, text) => { disk.set(p, text); },
        remove: async (p) => { disk.delete(p); },
        stat: async (p) => ({ size: (disk.get(p) || "").length }),
        join: (...p) => p.join("/"),
        filename: (p) => p.split("/").pop(),
      },
      notify() {},
      windowId: "w-week-start",
      now: () => now,
      getDir: async () => "/p/notes",
      getMaxSaveMs: () => 5000,
      setTimer: () => 0,
      clearTimer() {},
      warn(e) { throw e; },
    });
    await store.open();
    store.setMeta({
      calendarTab: "calendar",
      calendarView: "month",
      calendarCursor: "2026-11-15",
      calendarPicker: { mode: "month", minWidth: 470, minHeight: 360, colorMode: "count" },
    });
    await store.flush();

    const hostEl = dom.document.createElement("div");
    dom.document.body.append(hostEl);
    const sheet = seam.core.createSheet({
      store,
      adapter: {
        position: "float",
        host: hostEl,
        attach: (el) => hostEl.append(el),
        getArea: () => ({ width: 960, height: 760 }),
        watch: () => () => {},
        setActive() {},
        rewatch() {},
      },
      env: {
        now: () => now,
        getPref: (_k, d) => d,
        setPref() {},
        openLink() {},
        copyText: (text) => { copied = text; },
        exportNote() {},
        exportAll() {},
        revealFolder() {},
        setBadge() {},
        refreshAgenda() {},
      },
      ensureStore: async () => store,
    });
    const flush = async () => {
      for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    };
    const root = sheet.root;
    root.ownerDocument = dom.document;
    const layout = root.querySelector(".zn-all-layout");
    const panels = root.querySelector(".zn-all-panels");
    const calendarPane = root.querySelector(".zn-calendar-pane");
    layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
    panels.getBoundingClientRect = layout.getBoundingClientRect;
    calendarPane.getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
    await sheet.open();
    await flush();
    root.all().find((el) => el.title === "All notes").click();
    await flush();

    // Default: Monday-first, no week numbers column.
    const defaultDows = root.querySelector(".zn-cal-month-dows").children.map((el) => el.textContent);
    assert.deepEqual(defaultDows, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    assert.equal(root.querySelectorAll(".zn-cal-week-num").length, 0, "week numbers off by default");
    assert.equal(root.querySelector(".zn-cal-month-cell").getAttribute("data-day"), "2026-10-26");

    // Open Tools -> Week start & numbers… dialog and switch to Sunday + Show week numbers.
    const toolsBtn = root.querySelector(".zn-calendar-tools");
    assert.ok(toolsBtn, "Calendar Tools button exists");
    const menuItem = openCalendarRow(root, ".zn-calendar-tools", /Week start & numbers/i);
    assert.ok(menuItem, "Tools menu lists 'Week start & numbers…'");
    menuItem.click();
    await flush();

    const dialog = root.querySelector('[aria-label="Week start and week numbers"]');
    assert.ok(dialog, "Week start and week numbers dialog opened");
    const startSelect = dialog.querySelector('[aria-label="First day of week"]');
    const weekNumsCheck = dialog.querySelector('[aria-label="Show week numbers"]');
    assert.ok(startSelect && weekNumsCheck, "dialog renders First day of week select and Show week numbers checkbox");
    assert.equal(startSelect.value, "1");
    assert.equal(weekNumsCheck.checked, false);

    startSelect.value = "0";
    startSelect.dispatchEvent(new dom.Ev("change", { bubbles: true }));
    weekNumsCheck.checked = true;
    weekNumsCheck.dispatchEvent(new dom.Ev("change", { bubbles: true }));
    const applyBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "Apply");
    assert.ok(applyBtn, "Apply button exists");
    applyBtn.click();
    await flush();

    assert.equal(store.meta.calendarWeekStart, 0, "persisted Sunday week start in store.meta");
    assert.equal(store.meta.calendarWeekNumbers, true, "persisted week numbers toggle in store.meta");

    // 1. Full Month view: W# + Sun..Sat header, 6 week numbers, first cell is Sunday 2026-11-01.
    const sunMonthDows = root.querySelector(".zn-cal-month-dows").children.map((el) => el.textContent);
    assert.deepEqual(sunMonthDows, ["W#", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    const monthWeekNums = root.querySelector(".zn-cal-month-grid").children.filter((el) => el.classList.contains("zn-cal-week-num"));
    assert.equal(monthWeekNums.length, 6, "Full Month renders 6 week-number row headers");
    assert.equal(monthWeekNums[0].textContent, String(cal.weekNumber(day(2026, 11, 1), 0)), "first week row shows Sunday-first week number of Nov 1, 2026");
    assert.equal(root.querySelector(".zn-cal-month-cell").getAttribute("data-day"), "2026-11-01");

    // 2. Narrow Month heatmap picker: W# + Sun..Sat header, 6 week numbers, Home/End follow Sunday..Saturday.
    store.setMeta({ calendarPicker: { mode: "picker", minWidth: 470, minHeight: 360, colorMode: "count" } });
    await flush();
    root.querySelector(".zn-calendar-view-select").click();
    root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "Month").click();
    await flush();
    const pickerDows = root.querySelector(".zn-cal-month-dows").children.map((el) => el.textContent);
    assert.deepEqual(pickerDows, ["W#", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    assert.equal(root.querySelector(".zn-cal-picker-grid").children.filter((el) => el.classList.contains("zn-cal-week-num")).length, 6);
    const sun15Btn = [...root.querySelectorAll(".zn-cal-picker-day")].find((b) => b.getAttribute("data-day") === "2026-11-15");
    assert.ok(sun15Btn, "Sunday 2026-11-15 button exists in picker");
    sun15Btn.dispatchEvent(new dom.Ev("keydown", { key: "End", bubbles: true }));
    const cursorAfterEnd = [...root.querySelectorAll(".zn-cal-picker-day")].find((b) => b.classList.contains("is-cursor"));
    assert.equal(cursorAfterEnd?.getAttribute("data-day"), "2026-11-21", "End in Sunday-first picker jumps to Saturday 2026-11-21");

    // 3. Week view: cursor 2026-11-15 (Sunday) shows Sun 15 .. Sat 21, and corner badge shows W47.
    store.setMeta({ calendarCursor: "2026-11-15" });
    root.querySelector(".zn-calendar-view-select").click();
    root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "Week").click();
    await flush();
    const allDayCells = root.querySelectorAll(".zn-cal-time-allday-cell").map((el) => el.getAttribute("data-day"));
    assert.deepEqual(allDayCells, [
      "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21",
    ]);
    const corner = root.querySelector(".zn-cal-time-corner");
    assert.equal(corner?.textContent, "W47", "Week view corner displays W47 when week numbers are enabled");

    // 4. Week export: Copy this week as Markdown exports Sunday..Saturday with # Week 47.
    const copyWeekItem = openCalendarRow(root, ".zn-calendar-tools", /Copy this week as Markdown/i);
    assert.ok(copyWeekItem, "Copy this week as Markdown item exists");
    copyWeekItem.click();
    await flush();
    assert.ok(copied.startsWith("# Week 47\n\n## Sunday 2026-11-15"), `copied week markdown starts on Sunday with Week 47 (got ${JSON.stringify(copied.slice(0, 50))})`);
    assert.ok(copied.includes("## Saturday 2026-11-21"), "copied week markdown ends on Saturday 2026-11-21");

    // 5. Shared mini date picker in composer: also uses Sunday start + week numbers column.
    const createEventItem = openCalendarRow(root, ".zn-calendar-tools", /Create timed event/i);
    createEventItem.click();
    await flush();
    const miniPicker = root.querySelector(".zn-cal.is-compact");
    assert.ok(miniPicker, "compact composer schedule-board mini picker rendered");
    const miniDows = miniPicker.querySelectorAll(".zn-cal-dow").map((el) => el.textContent);
    assert.deepEqual(miniDows, ["W#", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    assert.equal(miniPicker.querySelectorAll(".zn-cal-week-num").length, 6, "mini date picker renders 6 week numbers");

    const css = fs.readFileSync(path.join(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
    assert.match(css, /\.zn-cal-month-grid\.has-week-numbers/, "CSS defines 8-column layout for Month/picker week numbers");
    assert.match(css, /\.zn-cal-grid\.has-week-numbers/, "CSS defines 8-column layout for mini date picker week numbers");

    sheet.destroy();
  });

  console.log(`\n${passed} week-start & week-numbers tests passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
