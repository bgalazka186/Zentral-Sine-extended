"use strict";
/* OW-33: Small-window All notes chrome compactness & non-calendar toolbar overflow safety. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "additional/notes/ZentralNotes.uc.js"), "utf8");
const css = fs.readFileSync(path.join(rootDir, "additional/notes/ZentralNotes.css"), "utf8");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;

const win = {
  __zentralNotesParts: { "notes-calendar": cal },
  document,
  ZentralRuntime: { register() {} },
  __zentralNotesTestSeam: {},
  requestAnimationFrame: (fn) => raf.push(fn),
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  innerWidth: 1000,
  innerHeight: 700,
  addEventListener() {},
  removeEventListener() {},
};
win.window = win;
vm.runInNewContext(source, {
  window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
  console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask,
  navigator: { platform: "Linux" },
});
const core = win.__zentralNotesTestSeam.core;
const flushRaf = async () => {
  for (let i = 0; i < 5; i++) {
    raf.splice(0).forEach((fn) => fn());
    await new Promise((r) => setImmediate(r));
  }
};

(async () => {
  // 1. Pure small-window chrome density helper
  assert.equal(typeof cal.allNotesChromeDensity, "function", "exports allNotesChromeDensity");
  assert.deepEqual(cal.allNotesChromeDensity(900, 650), { density: "normal", compact: false, narrow: false, tight: false, short: false });
  assert.deepEqual(cal.allNotesChromeDensity(420, 450), { density: "normal", compact: false, narrow: false, tight: false, short: false });
  assert.deepEqual(cal.allNotesChromeDensity(419, 600), { density: "compact", compact: true, narrow: true, tight: false, short: false });
  assert.deepEqual(cal.allNotesChromeDensity(310, 600), { density: "compact", compact: true, narrow: true, tight: false, short: false });
  assert.deepEqual(cal.allNotesChromeDensity(309, 600), { density: "tight", compact: true, narrow: true, tight: true, short: false });
  assert.deepEqual(cal.allNotesChromeDensity(260, 340), { density: "tight", compact: true, narrow: true, tight: true, short: true });
  assert.deepEqual(cal.allNotesChromeDensity(800, 400), { density: "compact", compact: true, narrow: false, tight: false, short: true });
  assert.deepEqual(cal.allNotesChromeDensity(0, 0), { density: "normal", compact: false, narrow: false, tight: false, short: false });

  // 2. CSS overflow safety & wrapping contract for all non-calendar All-notes chrome bars
  assert.match(css, /\.zentral-notes-sheet\[data-view="list"\]\s+\.zn-head\s*\{[^}]*flex-wrap:\s*wrap/, "list-view sheet header wraps safely instead of clipping buttons");
  // OW-73 was reverted (OW-85): it made the All-notes toolbar and the filter chips one unbending line, but the owner
  // meant a different row. Those two Notes rows are back to wrapping, which is their own safety mechanism, and the row
  // that really had to fit is the sheet bar under the title.
  assert.match(css, /\.zentral-notes-sheet\s+\.zn-all-toolbar\s*\{[^}]*flex-wrap:\s*wrap/, "the tabs strip wraps rather than clipping");
  assert.match(css, /\.zentral-notes-sheet\s+\.zn-chips\s*\{[^}]*flex-wrap:\s*wrap/, "filter chips wrap rather than clipping Trash/Tags");
  assert.match(css, /\.zentral-notes-sheet\s+\.zn-list-head\s*\{[^}]*flex-wrap:\s*wrap/, "search & create row wraps safely");
  // OW-85: the row the owner pointed at ("just under All notes title element and above Search Notes element") holds the
  // title and the three layout buttons. It never clips: it wraps, and it scrolls if it still cannot fit.
  assert.match(css, /\.zentral-notes-sheet\s+\.zn-head\s*\{[^}]*flex-wrap:\s*wrap/, "the sheet bar wraps instead of cutting a button at the window edge");
  assert.match(css, /\.zentral-notes-sheet\s+\.zn-head\s*\{[^}]*overflow-x:\s*auto/, "the sheet bar scrolls rather than clipping");
  assert.match(css, /\.zentral-notes-sheet\s+\.zn-head\s*>\s*\.zn-btn\s*\{[^}]*flex:\s*0\s+0\s+auto/, "sheet bar buttons never shrink to slivers");
  // OW-85: the three layout buttons belong in that bar, and the strip above the tree no longer carries a second row of
  // them. This is the owner's correction: "the correct element is just under All notes title element and above Search
  // Notes element".
  {
    const src = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
    assert.match(src, /head\.insertBefore\(btnCalendarLayout, btnCalendarTree\)/, "the layout button is moved into the sheet bar");
    assert.match(src, /head\.insertBefore\(btnCalendarTree, btnCalendarPane\)/, "the tree toggle is moved into the sheet bar");
    assert.match(src, /head\.insertBefore\(btnCalendarPane, btnCategory\)/, "the calendar toggle is moved into the sheet bar");
    assert.match(src, /const allToolbar = h\("div", \{ class: "zn-all-toolbar" \}, h\("span", \{ class: "zn-grow" \}\), tabTree, tabCalendar\)/, "the strip above the tree keeps only the tabs switcher");
  }
  assert.match(css, /\.zentral-notes-sheet\s+\.zn-batch-bar\s*\{[^}]*flex-wrap:\s*wrap/, "batch toolbar wraps safely");
  // OW-74: the calendar head now carries the prev / today / next controls, so it must not wrap — a wrapped head would
  // move them out from between the name and the period. The name is the item that gives ground instead.
  assert.match(css, /\.zentral-notes-sheet\s+\.zn-calendar-pane-head\s*\{[^}]*flex-wrap:\s*nowrap/, "calendar pane head is one line so the controls stay between the name and the period (OW-74)");
  assert.match(css, /\.zentral-notes-sheet\s+\.zn-calendar-pane-head\s*>\s*strong\s*\{[^}]*text-overflow:\s*ellipsis/, "the calendar name ellipsises before the controls do (OW-74)");
  assert.match(css, /\.zentral-notes-sheet\s+\.zn-calendar-head-nav\s*\{[^}]*flex:\s*0\s+0\s+auto/, "the header controls never shrink away (OW-74)");

  // 3. Live sheet integration across normal, narrow, tight, and short windows
  const files = new Map();
  const io = {
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf " + p); return files.get(p).text; },
    writeUTF8: async (p, text) => files.set(p, { text, mtime: Date.now() }),
    remove: async (p) => files.delete(p),
    exists: async (p) => files.has(p),
    children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/")),
    stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }),
    restrict: async () => {},
  };
  const store = core.createStore({ io, notify() {}, windowId: "small-chrome", getDir: async () => "/sc", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  await store.open();
  store.create("# First note\nBody text");
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (r) => host.append(r), getArea: () => ({ left: 0, top: 0, width: 900, height: 650 }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const prefs = new Map();
  const env = { getPref: (k, d) => prefs.has(k) ? prefs.get(k) : d, setPref: (k, v) => prefs.set(k, v), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root;
  root.ownerDocument = document;
  const layout = root.querySelector(".zn-all-layout");
  const panels = root.querySelector(".zn-all-panels");
  const setRect = (width, height) => {
    layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height });
    panels.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height });
  };

  setRect(900, 650);
  await sheet.open(); await flushRaf();
  const btnPin = root.all().find((el) => (el.title || "").includes("Pin note"));
  const btnColor = root.querySelector('[aria-label="Note color"]');
  assert.ok(btnPin && btnPin.hidden !== true, "Pin note button visible in editor view");
  assert.ok(btnColor && btnColor.hidden !== true, "Note color button visible in editor view");

  // Switch to All notes
  root.all().find((el) => el.title === "All notes").click(); await flushRaf();
  assert.equal(btnPin.hidden, true, "editor-only Pin button hidden in All notes view to save header room");
  assert.equal(btnColor.hidden, true, "editor-only Note color button hidden in All notes view to save header room");
  assert.equal(root.dataset.allChrome, "normal");
  assert.equal(root.dataset.shortWindow, "false");

  // Narrow small window (360 x 560)
  setRect(360, 560);
  root.querySelector(".zn-calendar-layout-btn").click();
  root.querySelectorAll(".zn-menu-item").find((b) => b.textContent.includes("Auto")).click();
  await flushRaf();
  assert.equal(root.dataset.allChrome, "compact", "360px width engages compact All-notes chrome");
  assert.equal(root.dataset.shortWindow, "false");

  // Tight & short window (260 x 340)
  setRect(260, 340);
  root.querySelector(".zn-calendar-layout-btn").click();
  root.querySelectorAll(".zn-menu-item").find((b) => b.textContent.includes("Auto")).click();
  await flushRaf();
  assert.equal(root.dataset.allChrome, "tight", "260px width engages tight All-notes chrome");
  assert.equal(root.dataset.shortWindow, "true", "340px height flags shortWindow");

  // Every non-calendar All-notes control remains mounted and visible (not hidden) at 260x340
  const search = root.querySelector(".zn-search");
  const btnFolder = root.querySelector(".zn-newfolder");
  const btnNew = root.querySelector(".zn-new");
  const btnNewMenu = root.querySelector(".zn-new-menu");
  const btnLayout = root.querySelector(".zn-calendar-layout-btn");
  const tabs = root.querySelectorAll(".zn-calendar-tab");
  const chips = root.querySelectorAll(".zn-chips .zn-chip").filter((c) => !c.classList.contains("zn-chip-danger"));
  assert.ok(search && search.hidden !== true, "search input accessible at 260x340");
  assert.ok(btnFolder && btnFolder.hidden !== true, "New folder button accessible at 260x340");
  assert.ok(btnNew && btnNew.hidden !== true, "New note button accessible at 260x340");
  assert.ok(btnNewMenu && btnNewMenu.hidden !== true, "New menu caret accessible at 260x340");
  assert.ok(btnLayout && btnLayout.hidden !== true, "Layout button accessible at 260x340");
  assert.equal(tabs.length, 2, "both Notes and Calendar tabs present");
  assert.ok(tabs.every((b) => b.hidden !== true), "both pane tabs accessible in narrow tabs fallback");
  assert.equal(chips.length, 4, "all four filter chips (Notes, Recent, Trash, Tags) present");
  assert.ok(chips.every((c) => c.hidden !== true), "all filter chips stay visible and clickable at 260x340");

  // Verify chips remain interactive in tight window (switch to Recent and back to Notes)
  const recentChip = chips.find((c) => c.textContent === "Recent");
  recentChip.click(); await flushRaf();
  assert.ok(recentChip.classList.contains("is-on"), "Recent chip responds to clicks in tight window");
  chips.find((c) => c.textContent === "Notes").click(); await flushRaf();

  // Wide but short window (720 x 380)
  setRect(720, 380);
  root.querySelector(".zn-calendar-layout-btn").click();
  root.querySelectorAll(".zn-menu-item").find((b) => b.textContent.includes("Auto")).click();
  await flushRaf();
  assert.equal(root.dataset.allChrome, "compact", "short window height compacts chrome even when wide");
  assert.equal(root.dataset.shortWindow, "true");

  // Return to editor view -> restores note-header buttons and clears allChrome attribute
  root.querySelector(".zn-title").click(); await flushRaf();
  assert.equal(root.dataset.view, "editor");
  assert.equal(root.dataset.allChrome, undefined, "allChrome attribute cleared outside list view");
  assert.equal(btnPin.hidden, false, "Pin note button restored in editor view");
  assert.equal(btnColor.hidden, false, "Note color button restored in editor view");

  sheet.destroy();
  await store.close();
  console.log("OW-33 small-window All notes chrome tests passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
