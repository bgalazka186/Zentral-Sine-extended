"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
require("../additional/notes/i18n/en.js");
require("../additional/notes/i18n/pl.js");

const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;

El.prototype.showPopover = function () { this._pop = true; };
El.prototype.hidePopover = function () { this._pop = false; };
const originalMatches = El.prototype.matches;
El.prototype.matches = function (sel) {
  return sel === ":popover-open" ? !!this._pop : originalMatches.call(this, sel);
};

// Track window listeners so we can assert zero leaks after Big Picture closes / sheet tears down.
const winListeners = new Map();
function addWinListener(type, fn, opts) {
  const cap = typeof opts === "boolean" ? opts : !!opts?.capture;
  const key = type + ":" + (cap ? "1" : "0");
  if (!winListeners.has(key)) winListeners.set(key, new Set());
  winListeners.get(key).add(fn);
}
function removeWinListener(type, fn, opts) {
  const cap = typeof opts === "boolean" ? opts : !!opts?.capture;
  const key = type + ":" + (cap ? "1" : "0");
  winListeners.get(key)?.delete(fn);
}
function dispatchWin(ev, { capture = true } = {}) {
  const key = ev.type + ":" + (capture ? "1" : "0");
  for (const fn of [...(winListeners.get(key) || [])]) fn(ev);
}
function countWinListeners(type) {
  return (winListeners.get(type + ":1")?.size || 0) + (winListeners.get(type + ":0")?.size || 0);
}

const win = {
  __zentralNotesParts: { "notes-calendar": C },
  __zentralNotesTestSeam: {},
  ZentralRuntime: { register() {} },
  document,
  innerWidth: 1400,
  innerHeight: 900,
  requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; },
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  addEventListener: addWinListener,
  removeEventListener: removeWinListener,
};
win.window = win;

vm.runInNewContext(
  fs.readFileSync(require.resolve("../additional/notes/ZentralNotes.uc.js"), "utf8"),
  {
    window: win,
    document,
    Event: Ev,
    globalThis: { Services: {} },
    ChromeUtils: {},
    console,
    URL,
    Date,
    JSON,
    Math,
    Promise,
    RegExp,
    Number,
    Map,
    Set,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    navigator: { platform: "Linux" },
  },
);

const flush = async () => {
  for (let i = 0; i < 6; i++) {
    raf.splice(0).forEach((fn) => fn());
    await new Promise((r) => setImmediate(r));
  }
};

function makeMemoryIo() {
  const files = new Map();
  const io = {
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    exists: async (p) => files.has(p),
    readUTF8: async (p) => { if (!files.has(p)) throw Error("missing"); return files.get(p); },
    writeUTF8: async (p, text) => { files.set(p, text); },
    remove: async (p) => { files.delete(p); },
    children: async (p) => [...files.keys()].filter((k) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")),
    stat: async () => ({ lastModified: 0 }),
    restrict: async () => {},
  };
  return { files, io };
}

function makeSheetHarness({ io, position = "absolute", sheetW = 860, sheetH = 560, paneW = 0, paneH = 0 } = {}) {
  const store = win.__zentralNotesTestSeam.core.createStore({
    io,
    notify() {},
    windowId: "big-picture-test",
    getDir: async () => "/n",
    getMaxSaveMs: () => 1000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });
  const host = new El("div");
  document.body.append(host);
  let suspended = false;
  const adapter = {
    position,
    host,
    attach: (root) => host.append(root),
    getArea: () => ({ left: 0, top: 0, width: sheetW, height: sheetH }),
    watch: () => () => {},
    setActive() {},
    rewatch() {},
    suspended: () => suspended,
  };
  const env = {
    getPref: (_k, fallback) => fallback,
    setPref() {},
    openLink() {},
    copyText() {},
    exportNote() {},
    exportAll() {},
    revealFolder() {},
  };
  const sheet = win.__zentralNotesTestSeam.core.createSheet({
    store,
    adapter,
    env,
    ensureStore: () => store.open(),
  });
  sheet.root.ownerDocument = document;
  Object.defineProperty(sheet.root, "offsetParent", { get: () => host });
  sheet.root.getBoundingClientRect = () => ({ left: 40, top: 40, width: sheetW, height: sheetH, right: 40 + sheetW, bottom: 40 + sheetH });
  const allLayout = sheet.root.querySelector(".zn-all-layout");
  allLayout.getBoundingClientRect = () => ({ left: 40, top: 80, width: sheetW, height: sheetH - 40, right: 40 + sheetW, bottom: 40 + sheetH });
  const calPane = sheet.root.querySelector(".zn-calendar-pane");
  if (paneW || paneH) {
    calPane.getBoundingClientRect = () => {
      if (calPane.dataset.bigPicture === "true") return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
      return { left: 40, top: 80, width: paneW, height: paneH, right: 40 + paneW, bottom: 80 + paneH };
    };
  }
  return {
    store,
    host,
    adapter,
    sheet,
    setSuspended(v) { suspended = !!v; },
  };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

(async () => {
  await test("pure: Big Picture size presets (70/80/90/95%) and viewport geometry box", () => {
    assert.deepEqual([...C.CALENDAR_BIG_PICTURE_SIZES], [70, 80, 90, 95]);
    assert.equal(C.DEFAULT_CALENDAR_BIG_PICTURE_SIZE, 90);
    for (const pct of [70, 80, 90, 95]) {
      assert.equal(C.cleanCalendarBigPictureSize(pct), pct);
      assert.equal(C.cleanCalendarBigPictureSize(String(pct)), pct);
    }
    assert.equal(C.cleanCalendarBigPictureSize(60), 90);
    assert.equal(C.cleanCalendarBigPictureSize(100), 90);
    assert.equal(C.cleanCalendarBigPictureSize("bogus"), 90);
    assert.equal(C.cleanCalendarBigPictureSize(null), 90);

    const b70 = C.calendarBigPictureBox({ width: 1400, height: 900 }, 70);
    assert.deepEqual(b70, { pct: 70, width: 980, height: 630, left: 210, top: 135 });
    const b80 = C.calendarBigPictureBox({ width: 1400, height: 900 }, 80);
    assert.deepEqual(b80, { pct: 80, width: 1120, height: 720, left: 140, top: 90 });
    const b90 = C.calendarBigPictureBox({ width: 1400, height: 900 }, 90);
    assert.deepEqual(b90, { pct: 90, width: 1260, height: 810, left: 70, top: 45 });
    const b95 = C.calendarBigPictureBox({ width: 1400, height: 900 }, 95);
    assert.deepEqual(b95, { pct: 95, width: 1330, height: 855, left: 35, top: 23 });

    // Clamps cleanly on small viewports without overflowing viewport - 16px margin.
    const tiny = C.calendarBigPictureBox({ width: 400, height: 300 }, 95);
    assert.ok(tiny.width <= 384 && tiny.height <= 284);
    assert.ok(tiny.left >= 0 && tiny.top >= 0);

    // Zero viewport still preserves cleaned percentage cleanly.
    const zero = C.calendarBigPictureBox({ width: 0, height: 0 }, 80);
    assert.deepEqual(zero, { pct: 80, width: 0, height: 0, left: 0, top: 0 });
  });

  await test("moves live calendarPane DOM node to top-layer viewport card, refits narrow picker to Month grid, and persists 70/80/90/95% sizes across reload", async () => {
    const { io } = makeMemoryIo();
    // Narrow panel pane (300x320) -> Month view starts in compact picker mode; Big Picture expands it to full Month grid!
    const h = makeSheetHarness({ io, sheetW: 600, sheetH: 480, paneW: 300, paneH: 320 });
    await h.store.open();
    h.store.create("# Alpha");
    await h.sheet.open();
    await flush();
    assert.ok(h.sheet.openCalendar());
    await flush();

    const allPanels = h.sheet.root.querySelector(".zn-all-panels");
    const livePane = h.sheet.root.querySelector(".zn-calendar-pane");
    const content = livePane.querySelector(".zn-calendar-pane-content");
    const btnBp = livePane.querySelector(".zn-calendar-bigpicture-btn");
    assert.ok(btnBp, "Big Picture trigger button exists in calendar header");
    assert.equal(livePane.parentElement, allPanels);
    assert.equal(content.dataset.view, "month");
    assert.equal(content.dataset.picker, "true", "starts as compact picker in narrow panel");

    btnBp.focus();
    btnBp.click();
    await flush();

    assert.equal(h.sheet.isCalendarBigPictureOpen(), true);
    const backdrop = h.sheet.root.querySelector(".zn-cal-bigpicture-backdrop");
    const card = h.sheet.root.querySelector(".zn-cal-bigpicture-card");
    const stage = h.sheet.root.querySelector(".zn-cal-bigpicture-stage");
    const placeholder = allPanels.querySelector(".zn-cal-bigpicture-placeholder");
    assert.ok(backdrop && card && stage && placeholder);
    assert.ok(backdrop.matches(":popover-open"), "Big Picture backdrop enters top layer");
    assert.equal(livePane.parentElement, stage, "exact live calendarPane moved into Big Picture stage (no clone)");
    assert.equal(
      [...h.sheet.root.querySelectorAll(".zn-calendar-pane")].filter((el) => !el.classList.contains("zn-cal-bigpicture-placeholder")).length,
      1,
    );
    assert.equal(content.dataset.picker, "false", "Month refits from narrow picker to full Month grid inside Big Picture");
    assert.equal(card.dataset.size, "90");
    assert.equal(card.style.width, "1260px");
    assert.equal(card.style.height, "810px");

    // Test all four size presets: 70, 80, 95, 90 -> end on 80 and verify persistence across reload.
    for (const [pct, expW, expH] of [[70, "980px", "630px"], [95, "1330px", "855px"], [80, "1120px", "720px"]]) {
      const btn = card.querySelector(`.zn-cal-bigpicture-size[data-bp-size="${pct}"]`);
      assert.ok(btn, `size button ${pct}% exists`);
      btn.click();
      await flush();
      assert.equal(card.dataset.size, String(pct));
      assert.equal(card.style.width, expW);
      assert.equal(card.style.height, expH);
      assert.equal(btn.getAttribute("aria-pressed"), "true");
      assert.equal(h.store.meta.calendarBigPictureSize, pct);
    }

    // Window resize dynamically recalculates Big Picture geometry.
    win.innerWidth = 1000;
    win.innerHeight = 700;
    dispatchWin(new Ev("resize"), { capture: false });
    await flush();
    assert.equal(card.style.width, "800px");
    assert.equal(card.style.height, "560px");
    win.innerWidth = 1400;
    win.innerHeight = 900;

    // Close via Close button and flush store.
    card.querySelector(".zn-cal-bigpicture-close").click();
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), false);
    assert.equal(livePane.parentElement, allPanels, "live calendarPane restored to allPanels");
    assert.equal(allPanels.children[2], livePane, "exact sibling slot restored in allPanels");
    assert.equal(allPanels.querySelector(".zn-cal-bigpicture-placeholder"), null);
    assert.equal(content.dataset.picker, "true", "Month refits back to narrow picker in panel host");
    assert.equal(document.activeElement, btnBp, "focus returns to opener trigger button");

    await h.store.flush();
    h.sheet.destroy();
    await h.store.close();

    // Reload from same storage and verify 80% persisted!
    const h2 = makeSheetHarness({ io, sheetW: 860, sheetH: 560 });
    await h2.store.open();
    assert.equal(h2.store.meta.calendarBigPictureSize, 80, "persisted 80% size survives store reload");
    await h2.sheet.open();
    await flush();
    h2.sheet.openCalendar();
    await flush();
    h2.sheet.openCalendarBigPicture();
    await flush();
    assert.equal(h2.sheet.root.querySelector(".zn-cal-bigpicture-card").dataset.size, "80");
    h2.sheet.destroy();
    await h2.store.close();
  });

  await test("restores host, view, scroll (list & time-grid), and focus on Close, Escape (layered), and outside click", async () => {
    const { io } = makeMemoryIo();
    const h = makeSheetHarness({ io, sheetW: 900, sheetH: 600 });
    await h.store.open();
    h.store.create("# Plan");
    const dayMs = C.parseYmd("2026-11-16").getTime();
    h.store.items.upsert({
      id: "bp-standup",
      summary: "Morning standup",
      start: { dateTime: new Date(dayMs + 9 * 3600000).toISOString() },
      end: { dateTime: new Date(dayMs + 10 * 3600000).toISOString() },
      x: { kind: "event", src: "manual" },
    });
    await h.store.flush();
    await h.sheet.open();
    await flush();
    // Use fixed Week hour scale (80px) so .zn-cal-time-scroll scrolls predictably.
    h.store.setMeta({
      calendarView: "week",
      calendarCursor: "2026-11-16",
      calendarScale: { ...C.cleanCalendarScale(null), week: 80 },
    });
    h.sheet.openCalendar();
    await flush();

    const allPanels = h.sheet.root.querySelector(".zn-all-panels");
    const livePane = h.sheet.root.querySelector(".zn-calendar-pane");
    const content = livePane.querySelector(".zn-calendar-pane-content");
    const btnBp = livePane.querySelector(".zn-calendar-bigpicture-btn");
    assert.equal(content.dataset.view, "week");

    // Open Big Picture, scroll both content & time-scroll, focus a live item, then press Escape.
    btnBp.focus();
    btnBp.click();
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), true);
    const timeScroll = content.querySelector(".zn-cal-time-scroll");
    assert.ok(timeScroll, "Week view has .zn-cal-time-scroll");
    timeScroll.scrollTop = 345;
    content.scrollTop = 42;
    const itemBtn = content.querySelector("[data-item-key]");
    assert.ok(itemBtn, "rendered calendar item exists");
    itemBtn.focus();
    const focusedKey = itemBtn.getAttribute("data-item-key");

    // Open a calendar menu inside Big Picture (View dropdown) -> 1st Escape closes menu ONLY, 2nd closes Big Picture ONLY!
    livePane.querySelector(".zn-calendar-view-select").click();
    await flush();
    const openMenu = h.sheet.root.querySelector(".zn-menu");
    assert.ok(openMenu && openMenu.matches(":popover-open"), "calendar menu enters top layer above Big Picture");

    const esc1 = new Ev("keydown", { key: "Escape", bubbles: true });
    dispatchWin(esc1, { capture: true });
    h.sheet.root.dispatchEvent(esc1);
    await flush();
    assert.equal(h.sheet.root.querySelector(".zn-menu"), null, "1st Escape closes menu");
    assert.equal(h.sheet.isCalendarBigPictureOpen(), true, "Big Picture stays open after 1st Escape");

    // Restore item focus & scroll before 2nd Escape
    itemBtn.focus();
    timeScroll.scrollTop = 345;
    content.scrollTop = 42;

    const esc2 = new Ev("keydown", { key: "Escape", bubbles: true });
    dispatchWin(esc2, { capture: true });
    h.sheet.root.dispatchEvent(esc2);
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), false, "2nd Escape closes Big Picture");
    assert.equal(h.sheet.isOpen(), true, "underlying Notes sheet stays open");
    assert.equal(livePane.parentElement, allPanels);
    assert.equal(content.dataset.view, "week", "view preserved after Big Picture close");
    assert.equal(h.store.meta.calendarCursor, "2026-11-16", "cursor preserved after Big Picture close");
    assert.equal(content.querySelector(".zn-cal-time-scroll").scrollTop, 345, "time-grid scrollTop restored");
    assert.equal(content.scrollTop, 42, "pane content scrollTop restored");
    assert.equal(document.activeElement?.getAttribute?.("data-item-key"), focusedKey, "focused calendar item restored");

    // Backdrop click closes ONLY Big Picture; clicking inside card does NOT close it.
    btnBp.focus();
    btnBp.click();
    await flush();
    const backdrop = h.sheet.root.querySelector(".zn-cal-bigpicture-backdrop");
    const card = h.sheet.root.querySelector(".zn-cal-bigpicture-card");
    const insideClick = new Ev("pointerdown", { bubbles: true });
    card.dispatchEvent(insideClick);
    dispatchWin(Object.assign(new Ev("pointerdown", { bubbles: true }), { target: card }), { capture: true });
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), true, "clicking inside Big Picture card keeps it open");

    const backdropClick = new Ev("pointerdown", { bubbles: true });
    backdrop.dispatchEvent(backdropClick);
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), false, "clicking backdrop closes Big Picture");
    assert.equal(h.sheet.isOpen(), true, "backdrop click does not close underlying sheet");
    assert.equal(document.activeElement, btnBp);

    // Outside mousedown on document.body closes ONLY Big Picture (even on unpinned sheet!).
    h.store.setMeta({ pinned: false });
    btnBp.click();
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), true);
    const outsideDown = Object.assign(new Ev("mousedown", { bubbles: true }), { target: document.body });
    dispatchWin(outsideDown, { capture: true });
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), false, "outside press closes Big Picture");
    assert.equal(h.sheet.isOpen(), true, "first outside press does not close underlying sheet");

    h.sheet.destroy();
    await h.store.close();
  });

  await test("teardown & transition cleanup: suspend, openNote, filter change, close, destroy, and zero leaked listeners", async () => {
    const { io } = makeMemoryIo();
    const h = makeSheetHarness({ io, position: "fixed", sheetW: 860, sheetH: 560 });
    await h.store.open();
    const note = h.store.create("# Source Note");
    await h.store.flush();
    await h.sheet.open();
    await flush();
    h.sheet.openCalendar();
    await flush();

    const allPanels = h.sheet.root.querySelector(".zn-all-panels");
    const livePane = h.sheet.root.querySelector(".zn-calendar-pane");
    const baseKeydown = countWinListeners("keydown");
    const basePointer = countWinListeners("pointerdown");
    const baseResize = countWinListeners("resize");
    const baseRes = h.sheet.resourceSnapshot().listeners;

    // 1. Floating sheet + Big Picture: calendar dialog (openCalendarCard) STILL enters top layer and anchors to Big Picture card!
    h.sheet.openCalendarBigPicture({ size: 70 });
    await flush();
    assert.ok(countWinListeners("keydown") > baseKeydown);
    assert.ok(countWinListeners("pointerdown") > basePointer);
    assert.ok(countWinListeners("resize") > baseResize);

    assert.ok(h.sheet.newAgendaDayItem("2026-11-16", "event"));
    await flush();
    const dlg = h.sheet.root.querySelector(".zn-dialog");
    assert.ok(dlg && dlg.matches(":popover-open"), "calendar dialog promotes to top layer above Big Picture even on floating sheet");
    // 1st Escape closes dialog ONLY; Big Picture remains open.
    const escDlg = new Ev("keydown", { key: "Escape", bubbles: true });
    dispatchWin(escDlg, { capture: true });
    await flush();
    assert.equal(h.sheet.root.querySelector(".zn-dialog"), null);
    assert.equal(h.sheet.isCalendarBigPictureOpen(), true);

    // 2. Tools menu shows "Exit Big Picture" while open and toggles it off cleanly.
    livePane.querySelector(".zn-calendar-tools").click();
    await flush();
    const toolsMenu = h.sheet.root.querySelector(".zn-menu");
    assert.ok(toolsMenu && toolsMenu.matches(":popover-open"));
    const exitItem = [...toolsMenu.querySelectorAll(".zn-menu-item")].find((b) => b.textContent.includes("Exit Big Picture"));
    assert.ok(exitItem, "Tools menu offers Exit Big Picture");
    exitItem.click();
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), false);
    assert.equal(countWinListeners("keydown"), baseKeydown, "no leaked keydown listeners after close");
    assert.equal(countWinListeners("pointerdown"), basePointer, "no leaked pointerdown listeners after close");
    assert.equal(countWinListeners("resize"), baseResize, "no leaked resize listeners after close");
    assert.equal(h.sheet.resourceSnapshot().listeners, baseRes, "resource registry returns cleanly to baseline");

    // 3. Panel suspended closes Big Picture and releases top layer.
    h.sheet.openCalendarBigPicture();
    await flush();
    const suspendedBackdrop = h.sheet.root.querySelector(".zn-cal-bigpicture-backdrop");
    assert.equal(suspendedBackdrop._pop, true);
    h.setSuspended(true);
    h.sheet.layout();
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), false);
    assert.equal(suspendedBackdrop._pop, false, "suspended host releases Big Picture top layer");
    assert.equal(livePane.parentElement, allPanels);
    h.setSuspended(false);
    h.sheet.layout();
    await flush();

    // 4. Switching list filter away from All (Trash) closes Big Picture cleanly.
    h.sheet.openCalendarBigPicture();
    await flush();
    const trashChip = [...h.sheet.root.querySelectorAll(".zn-chips .zn-chip")].find((b) => b.textContent.trim() === "Trash");
    assert.ok(trashChip);
    trashChip.click();
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), false, "switching to Trash closes Big Picture");
    assert.equal(livePane.parentElement, allPanels);

    // 5. Opening a note closes Big Picture cleanly.
    h.sheet.openCalendar();
    await flush();
    h.sheet.openCalendarBigPicture();
    await flush();
    assert.equal(h.sheet.openNote(note.id), true);
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), false, "opening a note closes Big Picture");
    assert.equal(livePane.parentElement, allPanels);

    // 6. Non-popover fallback works cleanly without throwing.
    const origShow = El.prototype.showPopover;
    El.prototype.showPopover = function () { throw Error("unsupported"); };
    h.sheet.openCalendar();
    await flush();
    h.sheet.openCalendarBigPicture();
    await flush();
    const fbBackdrop = h.sheet.root.querySelector(".zn-cal-bigpicture-backdrop");
    assert.ok(fbBackdrop && !fbBackdrop.hasAttribute("popover"));
    El.prototype.showPopover = origShow;

    // 7. sheet.close() and sheet.destroy() tear down Big Picture and restore pane + zero listener leaks.
    h.sheet.close();
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), false);
    assert.equal(livePane.parentElement, allPanels);
    assert.equal(countWinListeners("keydown"), baseKeydown);
    assert.equal(countWinListeners("pointerdown"), basePointer);
    assert.equal(countWinListeners("resize"), baseResize);

    await h.sheet.open();
    await flush();
    h.sheet.openCalendarBigPicture();
    await flush();
    const destBackdrop = h.sheet.root.querySelector(".zn-cal-bigpicture-backdrop");
    assert.equal(destBackdrop._pop, true);
    h.sheet.destroy();
    await flush();
    assert.equal(h.sheet.isCalendarBigPictureOpen(), false);
    assert.equal(destBackdrop._pop, false, "destroy hides Big Picture popover");
    assert.equal(livePane.parentElement, allPanels);
    assert.equal(countWinListeners("keydown"), 0, "destroy leaves zero keydown listeners");
    assert.equal(countWinListeners("pointerdown"), 0, "destroy leaves zero pointerdown listeners");
    assert.equal(countWinListeners("resize"), 0, "destroy leaves zero resize listeners");

    // 8. EN and PL i18n parity for Big Picture keys.
    for (const key of [
      "cal.bigPicture.open",
      "cal.bigPicture.close",
      "cal.bigPicture.title",
      "cal.bigPicture.dialogAria",
      "cal.bigPicture.sizeGroupAria",
      "cal.bigPicture.sizeOption",
      "cal.bigPicture.placeholder",
      "cal.bigPicture.returnHere",
      "cal.toolsMenu.bigPictureOpen",
      "cal.toolsMenu.bigPictureClose",
    ]) {
      const enVal = C.t(key, { pct: 80 }, "en");
      const plVal = C.t(key, { pct: 80 }, "pl");
      assert.notEqual(enVal, key, `EN missing ${key}`);
      assert.notEqual(plVal, key, `PL missing ${key}`);
      assert.notEqual(enVal, plVal, `PL should localize ${key}`);
    }

    await h.store.close();
  });

  await test("OW-35: regular Calendar and Big Picture remember independent filters and controls visibility across reload", async () => {
    // Pure helpers
    assert.deepEqual(C.calendarFilterKeysFor(false), { kindKey: "calendarFilterKind", categoryKey: "calendarFilterCategory", collapsedKey: "calendarFiltersCollapsed" });
    assert.deepEqual(C.calendarFilterKeysFor(true), { kindKey: "calendarBigPictureFilterKind", categoryKey: "calendarBigPictureFilterCategory", collapsedKey: "calendarBigPictureFiltersCollapsed" });
    assert.deepEqual(C.readCalendarFilters({ calendarFilterKind: "event", calendarFilterCategory: "Work", calendarFiltersCollapsed: true, calendarBigPictureFilterKind: "reminder", calendarBigPictureFilterCategory: "Personal", calendarBigPictureFiltersCollapsed: false }, false),
      { kind: "event", category: "Work", collapsed: true });
    assert.deepEqual(C.readCalendarFilters({ calendarFilterKind: "event", calendarFilterCategory: "Work", calendarFiltersCollapsed: true, calendarBigPictureFilterKind: "reminder", calendarBigPictureFilterCategory: "Personal", calendarBigPictureFiltersCollapsed: false }, true),
      { kind: "reminder", category: "Personal", collapsed: false });

    const { io } = makeMemoryIo();
    const h = makeSheetHarness({ io, sheetW: 960, sheetH: 620 });
    await h.store.open();
    h.store.create("# Filters test");
    h.store.items.upsertCategory({ name: "Work", color: "#4a90e2" });
    h.store.items.upsertCategory({ name: "Personal", color: "#d36aa6" });
    const tomorrow = C.localDateKey(C.addDays(C.dayStart(Date.now()), 1));
    const startMs = C.parseYmd(tomorrow).getTime() + 10 * 3600000;
    h.store.items.upsert({ id: "ev-work", summary: "Work Standup", start: { dateTime: new Date(startMs).toISOString() }, end: { dateTime: new Date(startMs + 3600000).toISOString() }, x: { kind: "event", category: "Work", src: "manual" } });
    h.store.items.upsert({ id: "rem-personal", summary: "Buy Groceries", start: { dateTime: new Date(startMs + 7200000).toISOString() }, x: { kind: "reminder", category: "Personal", src: "manual" } });
    h.store.items.upsert({ id: "ev-personal", summary: "Gym Session", start: { dateTime: new Date(startMs + 10800000).toISOString() }, end: { dateTime: new Date(startMs + 14400000).toISOString() }, x: { kind: "event", category: "Personal", src: "manual" } });

    await h.sheet.open();
    await flush();
    h.sheet.openCalendar();
    await flush();

    const viewBtn = h.sheet.root.querySelector(".zn-calendar-view-select");
    const kindBtn = h.sheet.root.querySelector(".zn-calendar-kind-filter");
    const catBtn = h.sheet.root.querySelector(".zn-calendar-category-filter");
    const ctrlToggle = h.sheet.root.querySelector(".zn-calendar-controls-toggle");
    const controls = h.sheet.root.querySelector(".zn-calendar-controls");
    const visibleTitles = () => [...h.sheet.root.querySelectorAll(".zn-cal-item-title")].map((el) => el.textContent.trim());
    const pickMenu = (label) => {
      const btn = [...h.sheet.root.querySelectorAll(".zn-menu-item")].find((b) => b.textContent.includes(label));
      assert.ok(btn, `menu item "${label}" exists`);
      btn.click();
    };

    viewBtn.click(); pickMenu("Agenda"); await flush();

    // Regular Calendar starts showing all 3 items
    assert.deepEqual(visibleTitles().sort(), ["Buy Groceries", "Gym Session", "Work Standup"]);

    // Filter regular Calendar to Events + Work, and collapse its controls bar
    kindBtn.click(); pickMenu("Events"); await flush();
    catBtn.click(); pickMenu("Work"); await flush();
    ctrlToggle.click(); await flush();
    assert.equal(h.store.meta.calendarFilterKind, "event");
    assert.equal(h.store.meta.calendarFilterCategory, "Work");
    assert.equal(h.store.meta.calendarFiltersCollapsed, true);
    assert.equal(controls.hidden, true);
    assert.deepEqual(visibleTitles(), ["Work Standup"], "regular Calendar shows only Work events");

    // Open Big Picture -> starts with its own default unlinked filters (all items, controls expanded!)
    h.sheet.openCalendarBigPicture();
    await flush();
    assert.equal(kindBtn.dataset.value, "all", "Big Picture does not inherit regular Calendar kind filter");
    assert.equal(catBtn.dataset.value, "", "Big Picture does not inherit regular Calendar category filter");
    assert.equal(controls.hidden, false, "Big Picture has independent controls visibility");
    assert.deepEqual(visibleTitles().sort(), ["Buy Groceries", "Gym Session", "Work Standup"], "Big Picture shows all items initially");

    // Set Big Picture filters to Reminders + Personal
    kindBtn.click(); pickMenu("Reminders"); await flush();
    catBtn.click(); pickMenu("Personal"); await flush();
    assert.equal(h.store.meta.calendarBigPictureFilterKind, "reminder");
    assert.equal(h.store.meta.calendarBigPictureFilterCategory, "Personal");
    assert.equal(h.store.meta.calendarFilterKind, "event", "regular Calendar kind filter stays untouched");
    assert.equal(h.store.meta.calendarFilterCategory, "Work", "regular Calendar category filter stays untouched");
    assert.deepEqual(visibleTitles(), ["Buy Groceries"], "Big Picture shows only Personal reminders");

    // Close Big Picture -> regular Calendar immediately restores Events + Work + collapsed controls!
    h.sheet.closeCalendarBigPicture();
    await flush();
    assert.equal(kindBtn.dataset.value, "event");
    assert.equal(catBtn.dataset.value, "Work");
    assert.equal(controls.hidden, true);
    assert.deepEqual(visibleTitles(), ["Work Standup"], "closing Big Picture restores regular Calendar filtered items");

    // Reopen Big Picture -> immediately restores Reminders + Personal!
    h.sheet.openCalendarBigPicture();
    await flush();
    assert.equal(kindBtn.dataset.value, "reminder");
    assert.equal(catBtn.dataset.value, "Personal");
    assert.equal(controls.hidden, false);
    assert.deepEqual(visibleTitles(), ["Buy Groceries"], "reopening Big Picture remembers its own filters");

    // Persist to disk and reopen fresh store + sheet -> both filter sets survive reload!
    h.sheet.closeCalendarBigPicture();
    await flush();
    await h.store.flush();
    h.sheet.destroy();
    await h.store.close();

    const h2 = makeSheetHarness({ io, sheetW: 960, sheetH: 620 });
    await h2.store.open();
    assert.equal(h2.store.meta.calendarFilterKind, "event");
    assert.equal(h2.store.meta.calendarFilterCategory, "Work");
    assert.equal(h2.store.meta.calendarFiltersCollapsed, true);
    assert.equal(h2.store.meta.calendarBigPictureFilterKind, "reminder");
    assert.equal(h2.store.meta.calendarBigPictureFilterCategory, "Personal");
    assert.equal(h2.store.meta.calendarBigPictureFiltersCollapsed, false);

    await h2.sheet.open();
    h2.sheet.openCalendar();
    await flush();
    assert.equal(h2.sheet.root.querySelector(".zn-calendar-kind-filter").dataset.value, "event");
    assert.equal(h2.sheet.root.querySelector(".zn-calendar-category-filter").dataset.value, "Work");
    h2.sheet.openCalendarBigPicture();
    await flush();
    assert.equal(h2.sheet.root.querySelector(".zn-calendar-kind-filter").dataset.value, "reminder");
    assert.equal(h2.sheet.root.querySelector(".zn-calendar-category-filter").dataset.value, "Personal");
    h2.sheet.destroy();
    await h2.store.close();
  });

  console.log(`\nPASS notes-calendar-bigpicture (${passed} tests)`);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
