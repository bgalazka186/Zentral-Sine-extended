"use strict";
// OW-10: compact calendar + analog/digital Clock visible together in 'Create calendar item',
// pure angle<->time conversion and snapping, accessible role="slider" + wheel/keyboard, and reuse in event start/end & custom snooze.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failed++;
    console.error("FAIL:", name, "\n ", err && err.stack ? err.stack : err);
  }
}

async function makeSheet({ snap = 15, locale } = {}) {
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
  const nav = { platform: "Linux", ...(locale ? { language: locale } : {}) };
  vm.runInNewContext(source, {
    window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
    console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: nav,
  });
  const core = win.__zentralNotesTestSeam.core;
  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      raf.splice(0).forEach((fn) => fn());
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  const fixedNow = new Date(2026, 10, 16, 10, 0, 0).getTime();
  const files = new Map();
  const io = {
    join: (...parts) => parts.join("/"),
    filename: (value) => value.split("/").pop(),
    readUTF8: async (value) => { if (!files.has(value)) throw new Error("not found"); return files.get(value).text; },
    writeUTF8: async (value, text) => files.set(value, { text, mtime: fixedNow }),
    remove: async (value) => files.delete(value),
    exists: async (value) => files.has(value),
    children: async (dir) => [...files.keys()].filter((value) => value.startsWith(dir + "/") && !value.slice(dir.length + 1).includes("/")),
    stat: async (value) => ({ lastModified: files.get(value)?.mtime || 0 }),
    restrict: async () => {},
  };
  const store = core.createStore({
    io,
    notify() {},
    windowId: "ow10-ui",
    now: () => fixedNow,
    getDir: async () => "/ow10",
    getMaxSaveMs: () => 1000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });
  await store.open();
  store.setMeta({
    calendarView: "month",
    calendarCursor: "2026-11-18",
    calendarLayout: "lr",
    calendarSnap: snap,
  });
  await store.flush();
  const host = new El("div");
  const adapter = {
    position: "fixed",
    host,
    attach: (root) => host.append(root),
    getArea: () => ({ left: 0, top: 0, width: 1100, height: 740 }),
    watch: () => () => {},
    setActive() {},
    rewatch() {},
  };
  const prefs = new Map();
  const env = {
    now: () => fixedNow,
    ...(locale ? { locale: () => locale } : {}),
    getPref: (key, fallback) => prefs.has(key) ? prefs.get(key) : fallback,
    setPref: (key, value) => prefs.set(key, value),
    openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {},
  };
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root;
  root.ownerDocument = document;
  root.querySelector(".zn-all-layout").getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 720, width: 1100, height: 720 });
  root.querySelector(".zn-all-panels").getBoundingClientRect = root.querySelector(".zn-all-layout").getBoundingClientRect;
  root.querySelector(".zn-calendar-pane").getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 720, width: 700, height: 720 });

  await sheet.open();
  await flush();
  root.all().find((el) => el.title === "All notes").click();
  await flush();

  return {
    Ev,
    document,
    store,
    sheet,
    root,
    flush,
    q: (sel) => root.querySelector(sel),
    qa: (sel) => [...root.querySelectorAll(sel)],
    cleanup() {
      try { sheet.destroy(); } catch (_) {}
    },
  };
}

function pointerOnDial(Ev, dial, angleDeg, radiusRatio = 0.82) {
  const rect = { left: 100, top: 100, width: 140, height: 140, right: 240, bottom: 240 };
  dial.getBoundingClientRect = () => rect;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const r = (rect.width / 2) * radiusRatio;
  const rad = (angleDeg * Math.PI) / 180;
  const clientX = cx + r * Math.sin(rad);
  const clientY = cy - r * Math.cos(rad);
  dial.dispatchEvent(new Ev("pointerdown", { bubbles: true, clientX, clientY, button: 0, pointerId: 1 }));
  dial.dispatchEvent(new Ev("pointerup", { bubbles: true, clientX, clientY, button: 0, pointerId: 1 }));
}

(async () => {
  await test("pure clock modes, locale 12h/24h detection, angle<->time math, snapping, and stepping", () => {
    assert.deepEqual([...C.CLOCK_MODES], ["both", "analog", "digital"]);
    assert.equal(C.cleanClockMode(undefined), "both");
    assert.equal(C.cleanClockMode("analog"), "analog");
    assert.equal(C.cleanClockMode("digital"), "digital");
    assert.equal(C.cleanClockMode("weird"), "both");

    assert.equal(C.clockUses12Hour("en-US"), true);
    assert.equal(C.clockUses12Hour("pl-PL"), false);

    // Pointer vector -> clockwise angle from 12 o'clock + radius.
    assert.equal(Math.round(C.clockPointerAngle(0, -50).angleDeg), 0);
    assert.equal(Math.round(C.clockPointerAngle(50, 0).angleDeg), 90);
    assert.equal(Math.round(C.clockPointerAngle(0, 50).angleDeg), 180);
    assert.equal(Math.round(C.clockPointerAngle(-50, 0).angleDeg), 270);
    assert.equal(Math.round(C.clockPointerAngle(30, -40).radius), 50);

    // 24-hour outer (0..11) and inner (12..23) rings round-trip cleanly.
    for (let h = 0; h < 24; h++) {
      const info = C.clockAngleOfHour(h, { hour12: false });
      assert.equal(C.clockHourFromAngle(info.angleDeg, { hour12: false, inner: info.inner }), h, `24h round-trip for ${h}`);
    }
    assert.equal(C.clockHourFromAngle(14, { hour12: false, inner: false }), 0);
    assert.equal(C.clockHourFromAngle(16, { hour12: false, inner: false }), 1);
    assert.equal(C.clockHourFromAngle(350, { hour12: false, inner: true }), 12);

    // 12-hour AM/PM round-trip across all 24 hours.
    for (let h = 0; h < 24; h++) {
      const period = h >= 12 ? "PM" : "AM";
      const info = C.clockAngleOfHour(h, { hour12: true });
      assert.equal(info.inner, false);
      assert.equal(C.clockHourFromAngle(info.angleDeg, { hour12: true, period }), h, `12h round-trip for ${h}`);
    }

    // Minute angle <-> snapped minute: analog clock defaults to fixed 5-minute resolution (delinked from calendarSnap).
    assert.equal(C.ANALOG_CLOCK_SNAP, 5);
    assert.equal(C.clockAngleOfMinute(0), 0);
    assert.equal(C.clockAngleOfMinute(15), 90);
    assert.equal(C.clockAngleOfMinute(45), 270);
    assert.equal(C.clockMinuteFromAngle(22), 5, "default analog snap is 5 minutes");
    assert.equal(C.clockMinuteFromAngle(134), 20, "22.3 min snaps to 20 by default");
    assert.equal(C.clockMinuteFromAngle(88, 15), 15);
    assert.equal(C.clockMinuteFromAngle(96, 5), 15);
    assert.equal(C.clockMinuteFromAngle(103, 5), 15);
    assert.equal(C.clockMinuteFromAngle(106, 5), 20);
    assert.equal(C.clockMinuteFromAngle(356), 0);
    assert.equal(C.clockMinuteFromAngle(222, 1), 37);

    // Hand stepping (keyboard / wheel): defaults to 5-minute steps.
    assert.equal(C.stepClockHand(14 * 60 + 10, "minute", 1), "14:15", "default minute step is 5 minutes");
    assert.equal(C.stepClockHand(14 * 60 + 0, "minute", -1), "14:55", "default backward minute step wraps to :55");
    assert.equal(C.stepClockHand(23 * 60 + 20, "hour", 1), "00:20");
    assert.equal(C.stepClockHand(0 * 60 + 20, "hour", -1), "23:20");
    assert.equal(C.stepClockHand(14 * 60 + 45, "minute", 1, { snap: 15 }), "14:00");
    assert.equal(C.stepClockHand(14 * 60 + 0, "minute", -1, { snap: 15 }), "14:45");
    assert.equal(C.stepClockHand(14 * 60 + 37, "minute", 1, { snap: 15 }), "14:45");
    assert.equal(C.stepClockHand(14 * 60 + 37, "minute", -1, { snap: 15 }), "14:30");
    assert.equal(C.stepClockHand(14 * 60 + 10, "minute", 1, { snap: 5 }), "14:15");
  });

  await test("composer shows compact calendar + clock together, analog clock always uses 5-min resolution even when calendarSnap is 30, and Week/Day Snap keeps 30 min", async () => {
    const h = await makeSheet({ snap: 30, locale: "pl-PL" });
    try {
      // Switch to Week view briefly to confirm Snap button still shows and regulates Week/Day 30-min snap.
      const viewBtn = h.q(".zn-calendar-view-select");
      viewBtn.click();
      await h.flush();
      h.qa(".zn-menu .zn-menu-item").find((b) => b.textContent.trim() === "Week").click();
      await h.flush();
      assert.equal(h.q(".zn-calendar-snap-select").textContent.trim(), "Snap 30 min", "Week view Snap setting keeps 30 min");
      const slot = C.calendarNoteDropSlot("time", "2026-11-18", { offsetPx: 54 * 10.35, hourPx: 54, snapMin: h.store.meta.calendarSnap });
      assert.equal(slot.startTime, "10:30", "Week/Day snap still snaps timeline gestures to 30 min");

      // Open timed event composer via All notes '+' menu -> New event.
      h.q(".zn-new-menu").click();
      await h.flush();
      h.qa(".zn-menu .zn-menu-item").find((b) => b.textContent.trim() === "New event").click();
      await h.flush();

      const card = h.q(".zn-cal-compose-card");
      assert.equal(Boolean(card), true);
      const board = card.querySelector(".zn-cal-compose-schedule-board");
      assert.equal(Boolean(board), true, "schedule board sits in the composer");
      const calPicker = board.querySelector(".zn-cal.is-compact");
      const clock = board.querySelector(".zn-cal-clock");
      assert.equal(Boolean(calPicker), true, "compact month picker is visible immediately");
      assert.equal(Boolean(clock), true, "clock is visible alongside the compact month picker");
      assert.equal(clock.hidden, false);

      // Compact calendar picks Start date directly, then Pick end… switches target to End date.
      const day25 = [...calPicker.querySelectorAll(".zn-cal-day")].find((b) => b.getAttribute("data-day") === String(new Date(2026, 10, 25).getTime()));
      day25.click();
      await h.flush();
      assert.equal(card.querySelector('[aria-label="Start date"]').value, "2026-11-25");

      [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === "Pick end…").click();
      const day26 = [...calPicker.querySelectorAll(".zn-cal-day")].find((b) => b.getAttribute("data-day") === String(new Date(2026, 10, 26).getTime()));
      day26.click();
      await h.flush();
      assert.equal(card.querySelector('[aria-label="End date (exclusive)"]').value, "2026-11-26");

      // Analog clock: even with store.meta.calendarSnap === 30, dial resolves at 5-minute resolution!
      // Click inner ring at 90 deg (15:xx) -> sets hour to 15 and advances active hand to "minute",
      // then click at 148 deg (~24.7 min -> snaps to 25 at 5-min resolution, NOT 30!).
      const dial = clock.querySelector(".zn-cal-clock-dial");
      assert.equal(Boolean(dial), true);
      assert.equal(clock.dataset.hand, "hour");
      pointerOnDial(h.Ev, dial, 90, 0.45); // inner 24h ring -> 15
      assert.equal(clock.dataset.hand, "minute", "picking hour automatically switches to the minute hand");
      pointerOnDial(h.Ev, dial, 148, 0.85); // ~24.7 min -> snaps to 25 (5-min analog resolution, NOT 30!)
      assert.equal(card.querySelector('[aria-label="Start time"]').value, "15:25");

      // Accessible role="slider" keyboard + wheel support also step by 5 minutes regardless of calendarSnap=30.
      const sliders = [...clock.querySelectorAll('[role="slider"]')];
      assert.equal(sliders.length, 2, "hour and minute analog sliders are exposed");
      const [hourSlider, minSlider] = sliders;
      assert.equal(hourSlider.getAttribute("aria-valuenow"), "15");
      assert.equal(minSlider.getAttribute("aria-valuenow"), "25");

      minSlider.dispatchEvent(new h.Ev("keydown", { key: "ArrowUp", bubbles: true }));
      assert.equal(card.querySelector('[aria-label="Start time"]').value, "15:30", "ArrowUp steps by 5 minutes even when calendarSnap is 30");
      minSlider.dispatchEvent(new h.Ev("keydown", { key: "End", bubbles: true }));
      assert.equal(card.querySelector('[aria-label="Start time"]').value, "15:55", "End jumps to :55 (last 5-minute tick), not :30");
      minSlider.dispatchEvent(new h.Ev("keydown", { key: "ArrowDown", bubbles: true }));
      assert.equal(card.querySelector('[aria-label="Start time"]').value, "15:50");
      hourSlider.dispatchEvent(new h.Ev("keydown", { key: "ArrowDown", bubbles: true }));
      assert.equal(card.querySelector('[aria-label="Start time"]').value, "14:50");
      dial.dispatchEvent(new h.Ev("wheel", { deltaY: -100, bubbles: true, cancelable: true })); // active hand is hour after hourSlider keydown
      assert.equal(card.querySelector('[aria-label="Start time"]').value, "15:50");

      // Event End reuse: switch analog clock target to End and pick 17:10 via hour then minute (again 5-min resolution, not 30!).
      const endTargetBtn = [...clock.querySelectorAll(".zn-cal-clock-target")].find((b) => b.dataset.target === "end");
      assert.equal(Boolean(endTargetBtn), true);
      endTargetBtn.click();
      assert.equal(clock.dataset.hand, "hour");
      pointerOnDial(h.Ev, dial, 150, 0.45); // inner 24h ring at 150 deg (5 * 30) -> 17
      pointerOnDial(h.Ev, dial, 62, 0.85);  // ~10.3 min -> snaps to 10 (NOT 0!)
      assert.equal(card.querySelector('[aria-label="End time"]').value, "17:10");
      assert.equal(card.querySelector('[aria-label="Start time"]').value, "15:50", "Start time stays untouched while editing End time");

      // Mode toggle: Analog / Digital / Both persists in store.meta.calendarClockMode.
      const analogModeBtn = [...clock.querySelectorAll(".zn-cal-clock-mode")].find((b) => b.dataset.mode === "analog");
      const digitalModeBtn = [...clock.querySelectorAll(".zn-cal-clock-mode")].find((b) => b.textContent.trim() === "Digital");
      const bothModeBtn = [...clock.querySelectorAll(".zn-cal-clock-mode")].find((b) => b.dataset.mode === "both");
      analogModeBtn.click();
      assert.equal(h.store.meta.calendarClockMode, "analog");
      assert.equal(clock.querySelector(".zn-cal-clock-digital").hidden, true);
      assert.equal(clock.querySelector(".zn-cal-clock-analog").hidden, false);
      digitalModeBtn.click();
      assert.equal(h.store.meta.calendarClockMode, "digital");
      assert.equal(clock.querySelector(".zn-cal-clock-analog").hidden, true);
      assert.equal(clock.querySelector(".zn-cal-clock-digital").hidden, false);
      bothModeBtn.click();
      assert.equal(h.store.meta.calendarClockMode, "both");
    } finally {
      h.cleanup();
    }
  });

  await test("12-hour locale AM/PM toggle and 5-minute snap work in Custom reminder snooze (T2.12b1)", async () => {
    const h = await makeSheet({ snap: 5, locale: "en-US" });
    try {
      h.store.items.upsert({
        id: "ow10-rem",
        summary: "Call dentist",
        start: { dateTime: new Date(2026, 10, 18, 9, 0, 0).toISOString() },
        x: { kind: "reminder", src: "manual" },
      });
      h.sheet.refresh?.();
      await h.flush();

      const mark = h.qa(".zn-cal-month-mark").find((node) => node.textContent.trim() === "Call dentist");
      assert.equal(Boolean(mark), true);
      mark.dispatchEvent(new h.Ev("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }));
      h.qa(".zn-menu-item").find((n) => n.textContent.trim() === "Snooze").click();
      await h.flush();
      h.qa(".zn-menu-item").find((n) => n.textContent.trim() === "Custom date and time…").click();
      await h.flush();

      const dlg = h.q('.zn-dialog-card[aria-label="Custom reminder snooze"]');
      assert.equal(Boolean(dlg), true);
      const clock = dlg.querySelector(".zn-cal-clock");
      assert.equal(Boolean(clock), true, "Custom snooze reuses the upgraded Clock");
      const pmBtn = [...clock.querySelectorAll(".zn-cal-clock-period")].find((b) => b.dataset.period === "PM");
      assert.equal(Boolean(pmBtn), true, "en-US locale renders AM/PM controls");
      pmBtn.click(); // 09:00 AM -> 21:00 (9:00 PM)

      const dial = clock.querySelector(".zn-cal-clock-dial");
      pointerOnDial(h.Ev, dial, 60, 0.82);  // 2 PM -> 14
      pointerOnDial(h.Ev, dial, 134, 0.82); // 22.3 min -> snaps to 20 with snap=5
      assert.equal(dlg.querySelector('[aria-label="New time"]').value, "14:20");

      [...dlg.querySelectorAll("button")].find((b) => b.textContent.trim() === "Snooze reminder").click();
      await h.flush();
      const updated = h.store.items.get("ow10-rem");
      const d = new Date(Date.parse(updated.start.dateTime));
      assert.equal(d.getHours(), 14);
      assert.equal(d.getMinutes(), 20);
    } finally {
      h.cleanup();
    }
  });

  await test("dragging analog hands continuously updates time and typed range '8-16' syncs both Start and End clock values", async () => {
    const h = await makeSheet({ snap: 10, locale: "pl-PL" });
    try {
      h.q(".zn-new-menu").click();
      await h.flush();
      h.qa(".zn-menu .zn-menu-item").find((b) => b.textContent.trim() === "New event").click();
      await h.flush();

      const card = h.q(".zn-cal-compose-card");
      const clock = card.querySelector(".zn-cal-clock");
      const dial = clock.querySelector(".zn-cal-clock-dial");
      const rect = { left: 50, top: 50, width: 140, height: 140, right: 190, bottom: 190 };
      dial.getBoundingClientRect = () => rect;
      const pt = (deg, ratio = 0.85) => {
        const rad = (deg * Math.PI) / 180;
        const r = (rect.width / 2) * ratio;
        return { clientX: 120 + r * Math.sin(rad), clientY: 120 - r * Math.cos(rad) };
      };

      // Drag hour hand from 90 deg (03:00) -> 180 deg (06:00) -> release (advances to minute hand).
      dial.dispatchEvent(new h.Ev("pointerdown", { bubbles: true, ...pt(90, 0.85), button: 0, pointerId: 2 }));
      assert.equal(card.querySelector('[aria-label="Start time"]').value.slice(0, 2), "03");
      dial.dispatchEvent(new h.Ev("pointermove", { bubbles: true, ...pt(180, 0.85), pointerId: 2 }));
      assert.equal(card.querySelector('[aria-label="Start time"]').value.slice(0, 2), "06");
      dial.dispatchEvent(new h.Ev("pointerup", { bubbles: true, ...pt(180, 0.85), button: 0, pointerId: 2 }));
      assert.equal(clock.dataset.hand, "minute");

      // Drag minute hand across 148 deg (~24.7 min -> 25 min, fixed 5-min analog snap even with calendarSnap=10) -> 242 deg (40 min).
      dial.dispatchEvent(new h.Ev("pointerdown", { bubbles: true, ...pt(148, 0.85), button: 0, pointerId: 2 }));
      assert.equal(card.querySelector('[aria-label="Start time"]').value, "06:25");
      dial.dispatchEvent(new h.Ev("pointermove", { bubbles: true, ...pt(242, 0.85), pointerId: 2 }));
      assert.equal(card.querySelector('[aria-label="Start time"]').value, "06:40");
      dial.dispatchEvent(new h.Ev("pointerup", { bubbles: true, ...pt(242, 0.85), button: 0, pointerId: 2 }));

      // Typing '8-16' in Start time updates both Start and End sets in the shared Clock.
      const startInput = card.querySelector('[aria-label="Start time"]');
      startInput.value = "8-16";
      startInput.dispatchEvent(new h.Ev("input", { bubbles: true }));
      startInput.dispatchEvent(new h.Ev("blur", { bubbles: true }));
      const sets = [...clock.querySelectorAll(".zn-cal-clock-set")];
      assert.equal(sets[0].querySelector(".zn-cal-clock-hour").value, "08");
      assert.equal(sets[1].querySelector(".zn-cal-clock-hour").value, "16");
    } finally {
      h.cleanup();
    }
  });

  if (failed) {
    console.error(`${failed} failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`notes-calendar-clock: ${passed} passed`);
})();
