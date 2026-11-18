"use strict";
/* OW-25: Regulator for how many days Week view shows (1-14 or Auto), range start (weekStart / today / selected),
 * Prev/Next by shown count (or 1 day with Shift), Day view 1-day isolation, Auto width refit, free-slot range & week export. */
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
  const winListeners = [];
  const win = {
    document: dom.document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    __zentralNotesParts: { "notes-calendar": cal },
    innerWidth: 1280,
    innerHeight: 900,
    requestAnimationFrame: (fn) => dom.raf.push(fn),
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
    IOUtils: {},
  };
  const src = fs.readFileSync(path.join(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  vm.runInNewContext(src, ctx, { filename: "ZentralNotes.uc.js" });
  return { seam: win.__zentralNotesTestSeam, dom, win, winListeners };
}

// OW-75: the calendar's Tools menu is grouped by job; this opens the group that holds `label` and returns the row.
const openCalendarRow = (root, trigger, label) => {
  root.querySelector(trigger).click();
  const items = () => [...root.querySelectorAll(".zn-menu-item")];
  const hit = (want) => items().find((el) => (typeof want === "string" ? el.textContent.trim() === want || el.textContent.trim().startsWith(want) : want.test(el.textContent.trim())));
  if (!hit(label)) {
    for (const group of items().filter((el) => el.classList.contains("zn-menu-group"))) {
      group.click();
      if (hit(label)) break;
      root.querySelector(".zn-menu-back")?.click();
    }
  }
  return hit(label);
};

(async () => {
  await test("pure visibleDays(start, count), cleanWeekSpan, fitWeekDayCount and resolveWeekVisibleDays across DST and month/year borders", () => {
    assert.equal(cal.WEEK_DAYS_LIMITS.min, 1);
    assert.equal(cal.WEEK_DAYS_LIMITS.max, 14);
    assert.deepEqual([...cal.WEEK_RANGE_STARTS], ["weekStart", "today", "selected"]);
    assert.deepEqual(cal.cleanWeekSpan(), { days: 7, anchor: "weekStart" });
    assert.deepEqual(cal.cleanWeekSpan({ days: "auto", anchor: "today" }), { days: "auto", anchor: "today" });
    assert.deepEqual(cal.cleanWeekSpan({ days: 0, anchor: "selected" }), { days: 1, anchor: "selected" });
    assert.deepEqual(cal.cleanWeekSpan({ days: 99, anchor: "invalid" }), { days: 14, anchor: "weekStart" });
    assert.deepEqual(cal.cleanWeekSpan(5), { days: 5, anchor: "weekStart" });
    assert.deepEqual(cal.cleanWeekSpan("auto"), { days: "auto", anchor: "weekStart" });

    // Month border, leap-year February border, and year border.
    assert.deepEqual(cal.visibleDays(day(2026, 1, 29), 5).map(cal.localDateKey), [
      "2026-01-29", "2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02",
    ]);
    assert.deepEqual(cal.visibleDays(day(2028, 2, 27), 4).map(cal.localDateKey), [
      "2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01",
    ]);
    assert.deepEqual(cal.visibleDays(day(2026, 12, 28), 7).map(cal.localDateKey), [
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
    assert.equal(cal.visibleDays(day(2026, 11, 16), 0).length, 1);
    assert.equal(cal.visibleDays(day(2026, 11, 16), 25).length, 14);

    // DST weeks (EU March/October, US March/November, NZ April/September): consecutive civil days without gaps or duplicates.
    for (const [y, m, d] of [[2026, 3, 6], [2026, 3, 27], [2026, 4, 3], [2026, 9, 25], [2026, 10, 23], [2026, 10, 30]]) {
      const span = cal.visibleDays(day(y, m, d), 10);
      assert.equal(span.length, 10);
      const keys = span.map(cal.localDateKey);
      assert.equal(new Set(keys).size, 10, `10 distinct civil dates starting ${keys[0]}`);
      for (let i = 0; i < keys.length; i++) {
        assert.equal(keys[i], cal.localDateKey(new Date(y, m - 1, d + i).getTime()));
      }
    }

    // Auto width fitting: fallback 7 when unmeasured, clamps 1..14, scales across narrow / medium / wide widths.
    assert.equal(cal.fitWeekDayCount(0), 7);
    assert.equal(cal.fitWeekDayCount(110), 1);
    const narrowAuto = cal.fitWeekDayCount(300);
    const mediumAuto = cal.fitWeekDayCount(650);
    const wideAuto = cal.fitWeekDayCount(1080);
    assert.equal(narrowAuto, 3);
    assert.equal(mediumAuto, 7);
    assert.equal(wideAuto, 12);
    assert.equal(cal.fitWeekDayCount(2400), 14);

    // Range anchors: weekStart (Mon vs Sun), today, selected.
    const wed18 = day(2026, 11, 18);
    const sun15 = day(2026, 11, 15);
    assert.deepEqual(
      cal.resolveWeekVisibleDays({ cursor: wed18, today: sun15, weekStart: 1, span: { days: 5, anchor: "weekStart" } }).map(cal.localDateKey),
      ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"],
    );
    assert.deepEqual(
      cal.resolveWeekVisibleDays({ cursor: wed18, today: sun15, weekStart: 0, span: { days: 5, anchor: "weekStart" } }).map(cal.localDateKey),
      ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"],
    );
    assert.deepEqual(
      cal.resolveWeekVisibleDays({ cursor: wed18, today: sun15, weekStart: 1, span: { days: 3, anchor: "today" } }).map(cal.localDateKey),
      ["2026-11-15", "2026-11-16", "2026-11-17"],
    );
    assert.deepEqual(
      cal.resolveWeekVisibleDays({ cursor: wed18, today: sun15, weekStart: 1, span: { days: 3, anchor: "selected" } }).map(cal.localDateKey),
      ["2026-11-18", "2026-11-19", "2026-11-20"],
    );
  });

  await test("UI: Week view at 1, 3, 5, 7, 10 days, Auto at three widths, anchors, Prev/Next + Shift, Day isolation, drag, free-slots and week export", async () => {
    const { seam, dom, winListeners } = loadSeam();
    let copied = "";
    const now = new Date(2026, 10, 18, 10, 0, 0, 0).getTime(); // Wednesday 18 Nov 2026
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
      windowId: "w-week-days",
      now: () => now,
      getDir: async () => "/p/notes",
      getMaxSaveMs: () => 5000,
      setTimer: () => 0,
      clearTimer() {},
      warn(e) { throw e; },
    });
    await store.open();
    store.items.upsert({
      id: "ev-wed",
      summary: "Design sync",
      start: { dateTime: new Date(2026, 10, 18, 11, 0, 0, 0).toISOString() },
      end: { dateTime: new Date(2026, 10, 18, 12, 0, 0, 0).toISOString() },
      x: { kind: "event", src: "manual" },
    });
    store.items.upsert({
      id: "rem-mon",
      summary: "Kickoff reminder",
      start: { date: "2026-11-16" },
      x: { kind: "reminder", src: "manual" },
    });
    store.setMeta({
      calendarView: "week",
      calendarCursor: "2026-11-18",
      calendarDaysForward: 14,
    });
    await store.flush();

    const hostEl = dom.document.createElement("div");
    dom.document.body.append(hostEl);
    let paneWidth = 650;
    const sheet = seam.core.createSheet({
      store,
      adapter: {
        position: "float",
        host: hostEl,
        attach: (el) => hostEl.append(el),
        getArea: () => ({ width: 1100, height: 760 }),
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
      for (let i = 0; i < 6; i++) {
        dom.raf.splice(0).forEach((fn) => fn());
        await new Promise((r) => setImmediate(r));
      }
    };
    const root = sheet.root;
    root.ownerDocument = dom.document;
    const layout = root.querySelector(".zn-all-layout");
    const panels = root.querySelector(".zn-all-panels");
    const calendarPane = root.querySelector(".zn-calendar-pane");
    const calendarContent = root.querySelector(".zn-calendar-view");
    layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
    panels.getBoundingClientRect = layout.getBoundingClientRect;
    calendarPane.getBoundingClientRect = () => ({ left: 400, top: 0, right: 400 + paneWidth, bottom: 700, width: paneWidth, height: 700 });
    calendarContent.getBoundingClientRect = () => ({ left: 400, top: 60, right: 400 + paneWidth, bottom: 700, width: paneWidth, height: 640 });

    await sheet.open();
    await flush();
    root.all().find((el) => el.title === "All notes").click();
    await flush();

    const shownTrackDays = () => root.querySelectorAll(".zn-cal-time-track").map((el) => el.getAttribute("data-day"));
    const shownAllDayDays = () => root.querySelectorAll(".zn-cal-time-allday-cell").map((el) => el.getAttribute("data-day"));

    // 1. Default Week view shows 7 days starting on weekStart (Mon 2026-11-16 .. Sun 2026-11-22), andregulator chip is visible.
    const daysChip = root.querySelector(".zn-calendar-days-select");
    assert.ok(daysChip && !daysChip.hidden, "Days regulator chip is visible in Week view");
    assert.equal(daysChip.textContent, "7 days");
    assert.equal(shownTrackDays().length, 7);

    // 2. Test regulator slider at 1, 3, 5, 7, and 10 days: headers, all-day strip, tracks and shading match count.
    for (const count of [1, 3, 5, 7, 10]) {
      daysChip.click();
      await flush();
      const menu = root.querySelector(".zn-menu");
      assert.ok(menu?.querySelector(".zn-menu-slider"), "Week days menu renders a live 1-14 slider");
      const rangeInput = menu.querySelector("input");
      rangeInput.value = String(count);
      rangeInput.dispatchEvent(new dom.Ev("input", { bubbles: true }));
      daysChip.click();
      await flush();

      assert.equal(store.meta.calendarWeekSpan.days, count);
      assert.equal(daysChip.textContent, count === 1 ? "1 day" : `${count} days`);
      assert.equal(shownTrackDays().length, count, `Week view renders ${count} time tracks`);
      assert.equal(shownAllDayDays().length, count, `Week view renders ${count} all-day cells`);
      assert.equal(root.querySelectorAll(".zn-cal-time-day-head").length, count, `Week view renders ${count} day headers`);
      assert.ok(root.querySelectorAll(".zn-cal-off-hours").length >= count, "off-hours shading covers shown tracks");
    }

    // 3. Auto at three widths (300 px -> 3 days, 650 px -> 7 days, 1080 px -> 12 days) and live resize refit.
    daysChip.click();
    await flush();
    root.querySelector(".zn-menu .zn-menu-slider-fit").click();
    daysChip.click();
    await flush();
    assert.equal(store.meta.calendarWeekSpan.days, "auto");

    const triggerResize = async () => {
      for (const l of [...winListeners]) if (l.type === "resize") l.fn(new dom.Ev("resize"));
      await flush();
    };
    const widthsExpected = [[300, 3], [650, 7], [1080, 12]];
    for (const [w, expectedCols] of widthsExpected) {
      paneWidth = w;
      await triggerResize();
      assert.equal(shownTrackDays().length, expectedCols, `Auto at ${w}px refits on resize to ${expectedCols} columns`);
      assert.match(daysChip.textContent, new RegExp(`Auto\\s*·\\s*${expectedCols}\\s*day`), `chip displays Auto · ${expectedCols} days`);
    }
    const keptTrack = root.querySelector(".zn-cal-time-track");
    paneWidth = 1090; // still 12 columns -> must not redraw
    await triggerResize();
    assert.ok(root.querySelector(".zn-cal-time-track") === keptTrack, "resize within same Auto column count leaves DOM untouched");

    // 4. Range start modes: Selected day vs Today vs Week start, plus Prev/Next by shown count and Shift+Prev/Next by 1 day.
    paneWidth = 650;
    // Set to 3 days + Selected day (cursor is 2026-11-20).
    store.setMeta({ calendarCursor: "2026-11-20" });
    daysChip.click();
    await flush();
    const sliderInput = root.querySelector(".zn-menu input");
    sliderInput.value = "3";
    sliderInput.dispatchEvent(new dom.Ev("input", { bubbles: true }));
    root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "Selected day").click();
    await flush();
    assert.deepEqual(shownTrackDays(), ["2026-11-20", "2026-11-21", "2026-11-22"], "Selected day anchor starts at cursor");

    // Next moves by shown count (3 days -> 2026-11-23..25); Shift+Next moves by 1 day (-> 2026-11-24..26); Shift+Prev back 1 day.
    const prevBtn = root.querySelector('[aria-label="Previous period"]');
    const nextBtn = root.querySelector('[aria-label="Next period"]');
    nextBtn.dispatchEvent(new dom.Ev("click", { bubbles: true, shiftKey: false }));
    await flush();
    assert.deepEqual(shownTrackDays(), ["2026-11-23", "2026-11-24", "2026-11-25"], "Next advances by shown count (3 days)");
    nextBtn.dispatchEvent(new dom.Ev("click", { bubbles: true, shiftKey: true }));
    await flush();
    assert.deepEqual(shownTrackDays(), ["2026-11-24", "2026-11-25", "2026-11-26"], "Shift+Next advances by 1 day");
    prevBtn.dispatchEvent(new dom.Ev("click", { bubbles: true, shiftKey: true }));
    await flush();
    assert.deepEqual(shownTrackDays(), ["2026-11-23", "2026-11-24", "2026-11-25"], "Shift+Prev steps back by 1 day");

    // Today anchor starts at today (2026-11-18) even while cursor was 2026-11-23.
    daysChip.click();
    await flush();
    root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "Today").click();
    await flush();
    assert.deepEqual(shownTrackDays(), ["2026-11-18", "2026-11-19", "2026-11-20"], "Today anchor starts on local today");
    assert.ok(root.querySelectorAll(".zn-cal-busy-range").length >= 1, "busy-range shading rendered on Wednesday's event");

    // 5. Free-slot finder & Week export use the 3 shown days (2026-11-18..2026-11-20), NOT 7 days!
    openCalendarRow(root, ".zn-calendar-tools", /When am I free/i).click();
    await flush();
    const freeCard = root.querySelector('[aria-label="When am I free?"]');
    assert.ok(freeCard, "When am I free? dialog opened");
    const freeInputs = freeCard.querySelectorAll('input[type="text"], input:not([type])');
    assert.equal(freeInputs[0].value, "2026-11-18", "free-slot From date defaults to first shown day");
    assert.equal(freeInputs[1].value, "2026-11-20", "free-slot Through date defaults to last shown day");
    freeCard.querySelectorAll("button").find((b) => b.textContent.trim() === "Close").click();
    await flush();

    openCalendarRow(root, ".zn-calendar-tools", /Copy this week as Markdown/i).click();
    await flush();
    const mdHeadings = copied.split("\n").filter((line) => line.startsWith("## "));
    assert.deepEqual(mdHeadings, [
      "## Wednesday 2026-11-18",
      "## Thursday 2026-11-19",
      "## Friday 2026-11-20",
    ], "week export emits only the 3 shown days");

    // 6. Drag geometry across non-7-day grid: moving an all-day reminder onto day 3 ("2026-11-20") updates its date.
    store.items.upsert({
      id: "drag-rem",
      summary: "Move me",
      start: { date: "2026-11-18" },
      x: { kind: "reminder", src: "manual" },
    });
    await flush();
    const allDayRow = root.querySelector(".zn-cal-time-allday-row");
    allDayRow.getBoundingClientRect = () => ({ left: 400, top: 90, right: 1050, bottom: 130, width: 650, height: 40 });
    const cells = root.querySelectorAll(".zn-cal-time-allday-cell");
    cells.forEach((cell, idx) => {
      cell.getBoundingClientRect = () => ({ left: 442 + idx * 200, top: 90, right: 442 + (idx + 1) * 200, bottom: 130, width: 200, height: 40 });
    });
    const remBtn = [...allDayRow.querySelectorAll(".zn-cal-item")].find((b) => b.textContent.includes("Move me"));
    assert.ok(remBtn, "movable all-day reminder rendered in 3-day strip");
    remBtn.setPointerCapture = () => {};
    remBtn.dispatchEvent(new dom.Ev("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 460, clientY: 105 }));
    root.dispatchEvent(new dom.Ev("pointermove", { bubbles: true, button: 0, pointerId: 1, clientX: 880, clientY: 105 }));
    root.dispatchEvent(new dom.Ev("pointerup", { bubbles: true, button: 0, pointerId: 1, clientX: 880, clientY: 105 }));
    await flush();
    assert.equal(store.items.get("drag-rem")?.start?.date, "2026-11-20", "dragging onto column 3 of a 3-day Week view moves item to 2026-11-20");

    // 7. Day view stays 1-day and Next days keeps its own persisted 14-day setting!
    root.querySelector(".zn-calendar-view-select").click();
    root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "Day").click();
    await flush();
    assert.equal(shownTrackDays().length, 1, "Day view stays the 1-day case");
    assert.equal(daysChip.hidden, true, "Days regulator hidden in Day view");

    root.querySelector(".zn-calendar-view-select").click();
    root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "Next days").click();
    await flush();
    assert.equal(daysChip.hidden, false, "Days selector visible in Next days view");
    assert.equal(daysChip.textContent, "14 days", "Next days keeps its separate persisted calendarDaysForward");

    root.querySelector(".zn-calendar-view-select").click();
    root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "Week").click();
    await flush();
    assert.equal(shownTrackDays().length, 3, "Week view restores its persisted 3-day regulator setting");
    assert.equal(daysChip.textContent, "3 days");

    sheet.destroy();
  });

  console.log(`\n${passed} Week-view days regulator tests passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
