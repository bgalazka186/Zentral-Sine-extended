"use strict";
/* OW-73 and OW-74 — the owner's two calendar-space reports of 2026-11-18.

   OW-73: "Recent and splitview/foldertree/hidecalendar have enough space to fit in 1 line but they do take 2."
   Measured in headless Chromium against the real sheet (tools/audit-notes-calendar-fit.cjs harness), the old rules
   wrapped the chips row onto two lines at 20 px text in a calendar pane ~294-323 px wide, and the toolbar kept
   `flex-wrap: wrap` so a single wider button could do the same. Both rows are now one line by contract, with a
   readable floor per chip and a horizontal scroll instead of a second row.

   OW-74: the calendar's basic controls must stay reachable when the control strip is hidden, sitting "right of the
   calendar name and left of the long month name", and they outrank the name. The three buttons are MOVED into the
   header — one node each, so the strip and the header can never disagree — and a month/week toggle joins them. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "additional/notes/ZentralNotes.uc.js"), "utf8");
const css = fs.readFileSync(path.join(rootDir, "additional/notes/ZentralNotes.css"), "utf8");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const en = require("../additional/notes/i18n/en.js");
const pl = require("../additional/notes/i18n/pl.js");
cal.registerLanguage("en", en);
cal.registerLanguage("pl", pl);

const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const rows = (block) => ((block || "").match(/\{[^}]*\}/g) || []).join("\n");

// Every body written for `selector`, joined. A property may live in a later override (the sheet keeps its base rules
// together and its OW-33 small-window overrides further down), so asserting over the union asks the real question:
// does anything for this selector contradict the contract?
function rule(selector, mustInclude = "") {
  let at = -1, out = [];
  while ((at = css.indexOf(selector + (selector.endsWith(",") ? "" : " ") + (selector.endsWith(",") ? "" : "{"), at + 1)) >= 0) {
    const body = css.slice(at, css.indexOf("}", at) + 1);
    out.push(body);
  }
  assert.ok(out.length > 0, `CSS rule exists: ${selector}`);
  const chosen = mustInclude ? out.filter((b) => b.includes(mustInclude)) : out;
  assert.ok(chosen.length > 0, `a rule for ${selector} sets ${mustInclude}`);
  return chosen.join("\n");
}

// ---- OW-73 reverted, OW-85: the row that had to fit is the sheet bar, not the Notes rows ----------------------
{
  // OW-85 (the owner, 2026-11-18): "you targeted wrong thing ... you targeted Notes only buttons, now they getting cut
  // by window edge. first revert this changes." The All-notes toolbar and the chips row are back to wrapping; the bar
  // that must hold one row without clipping anything is the sheet bar under the title.
  assert.match(rule(".zentral-notes-sheet .zn-all-toolbar", "flex-wrap"), /flex-wrap:\s*wrap/, "the tabs strip wraps rather than clipping");
  assert.match(rule(".zentral-notes-sheet .zn-chips", "flex-wrap"), /flex-wrap:\s*wrap/, "the filter chips wrap rather than clipping");

  const head = rule(".zentral-notes-sheet .zn-head");
  assert.match(head, /overflow-x:\s*auto/, "the sheet bar scrolls rather than clipping a button at the window edge");
  const headBtn = rule(".zentral-notes-sheet .zn-head > .zn-btn");
  assert.match(headBtn, /flex:\s*0\s+0\s+auto/, "a sheet bar button is never squeezed to a sliver");
  assert.doesNotMatch(rule(".zentral-notes-sheet .zn-head"), /overflow:\s*hidden/, "the sheet bar never hides a button");
}

// ---- OW-74: the controls live in the header and outrank the name ----------------------------------------------
{
  const head = rule(".zentral-notes-sheet .zn-calendar-pane-head", "flex-wrap");
  assert.match(head, /flex-wrap:\s*nowrap/, "the calendar head is one line so the controls stay where the owner put them");

  const name = rule(".zentral-notes-sheet .zn-calendar-pane-head > strong");
  assert.match(name, /flex:\s*0\s+1\s+auto/, "the calendar name is the item that gives ground");
  assert.match(name, /text-overflow:\s*ellipsis/, "the calendar name ellipsises rather than pushing the controls out");
  assert.match(name, /min-width:\s*0/, "the name is allowed to shrink to nothing");

  const nav = rule(".zentral-notes-sheet .zn-calendar-head-nav");
  assert.match(nav, /flex:\s*0\s+0\s+auto/, "the header controls never shrink away");
  assert.match(nav, /display:\s*flex/, "the header controls sit in a row");
  assert.match(rule(".zentral-notes-sheet .zn-calendar-head-nav > .zn-chip"), /flex:\s*0\s+0\s+auto/, "each header control keeps its width");
}

// ---- the DOM: moved, not copied -------------------------------------------------------------------------------
assert.match(source, /const calendarHeadNav = h\("div", \{ class: "zn-calendar-head-nav"/, "the header has a nav slot");
assert.match(source, /calendarHeadNav\.append\(calendarPrev, calendarToday, calendarNext, btnCalendarViewToggle\)/, "prev / today / next / month-week are moved into the header");
assert.match(source, /const calendarHeader = h\("div", \{ class: "zn-calendar-pane-head" \}, calendarHeadingEl, calendarHeadNav, calendarHeadRight\)/, "the nav sits between the calendar name and the period name");
// The strip must NOT also build the three buttons: the same node cannot live in two places.
const strip = source.slice(source.indexOf("const calendarControls = h("), source.indexOf("\n", source.indexOf("const calendarControls = h(")));
for (const name of ["calendarPrev", "calendarToday", "calendarNext"]) {
  assert.ok(!strip.includes(name), `${name} is not built into the control strip as well (one node, one listener)`);
}
assert.ok(!/for \(const \w+ of \[calendarPrev, calendarToday, calendarNext\]\)/.test(source), "no clone/copy loop re-adds the nav");

// ---- the live sheet ---------------------------------------------------------------------------------------------
const prefs = new Map();
const Services = {
  prefs: {
    getStringPref: (k, d) => (prefs.has(k) ? String(prefs.get(k)) : d),
    getBoolPref: (k, d) => (prefs.has(k) ? Boolean(prefs.get(k)) : d),
    getIntPref: (k, d) => (prefs.has(k) ? Number(prefs.get(k)) : d),
  },
};
const win = {
  __zentralNotesParts: { "notes-calendar": cal },
  __zentralNotesLangTables: { en, pl },
  document,
  ZentralRuntime: { register() {} },
  __zentralNotesTestSeam: {},
  requestAnimationFrame: (fn) => raf.push(fn),
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
};
win.window = win;
vm.runInNewContext(source, {
  window: win, document, Event: Ev, globalThis: { Services }, ChromeUtils: {}, console, URL, Date, JSON, Math,
  Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" },
});
const c = win.__zentralNotesTestSeam.core;
const flushRaf = async () => { for (let i = 0; i < 6; i++) { raf.splice(0).forEach((fn) => fn()); await new Promise((r) => setImmediate(r)); } };

const files = new Map();
const io = {
  join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
  readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf " + p); return files.get(p).text; },
  writeUTF8: async (p, text) => files.set(p, { text, mtime: Date.now() }),
  remove: async (p) => files.delete(p), exists: async (p) => files.has(p),
  children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/")),
  stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }), restrict: async () => {},
};

(async () => {
  const storeNow = new Date(); storeNow.setHours(9, 0, 0, 0);
  const store = c.createStore({
    io, notify() {}, windowId: "header-nav", now: () => storeNow.getTime(),
    getDir: async () => "/header-nav", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout,
  });
  await store.open();
  store.create("# A note\n\nText");
  const host = new El("div");
  const adapter = {
    position: "fixed", host, attach: (root) => host.append(root),
    getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }),
    watch: () => () => {}, setActive() {}, rewatch() {},
  };
  const sheetPrefs = new Map();
  const env = {
    getPref: (k, d) => (sheetPrefs.has(k) ? sheetPrefs.get(k) : d), setPref: (k, v) => sheetPrefs.set(k, v),
    openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {},
  };
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root;
  root.ownerDocument = document;
  const layout = root.querySelector(".zn-all-layout");
  layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  root.querySelector(".zn-all-panels").getBoundingClientRect = layout.getBoundingClientRect;
  root.querySelector(".zn-calendar-pane").getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await sheet.open();
  await flushRaf();
  // Open All notes with the calendar pane shown.
  root.querySelectorAll("button").find((b) => (b.title || "").includes("All notes"))?.click();
  await flushRaf();

  const head = root.querySelector(".zn-calendar-pane-head");
  assert.ok(head, "the calendar pane has a head");
  const nav = head.querySelector(".zn-calendar-head-nav");
  assert.ok(nav, "the head carries the nav slot");

  // Order: name, then the controls, then the period name.
  const kids = [...head.children];
  assert.equal(kids.indexOf(nav), 1, "the nav is the second child: right of the calendar name");
  assert.ok(kids.indexOf(head.querySelector(".zn-calendar-pane-head-right")) > kids.indexOf(nav), "the period name comes after the controls");

  const prev = nav.querySelector(".zn-calendar-nav");
  const next = nav.querySelectorAll(".zn-calendar-nav")[1];
  const today = nav.querySelector(".zn-calendar-today");
  const toggle = nav.querySelector(".zn-calendar-view-toggle");
  assert.ok(prev && next && today && toggle, "prev, today, next and the month/week toggle are all in the header");

  // There is exactly one of each: the strip does not keep a second copy.
  assert.equal(root.querySelectorAll(".zn-calendar-nav").length, 2, "two arrows in the whole sheet (prev and next), not four");
  assert.equal(root.querySelectorAll(".zn-calendar-today").length, 1, "one Today button in the whole sheet");
  assert.equal(root.querySelectorAll(".zn-calendar-view-toggle").length, 1, "one month/week toggle");
  assert.equal(root.querySelectorAll(".zn-calendar-controls .zn-calendar-nav").length, 0, "the hidden strip holds no duplicate arrows");

  // The strip hides; the controls stay and still work.
  const stripToggle = root.querySelector(".zn-calendar-controls-toggle");
  assert.ok(stripToggle, "the strip toggle exists");
  const before = store.meta.calendarCursor;
  stripToggle.click();
  await flushRaf();
  assert.equal(root.querySelector(".zn-calendar-controls").hidden, true, "the control strip is hidden");
  assert.equal(nav.children.length, 4, "hiding the strip does not remove the header controls");
  assert.ok(nav.getBoundingClientRect().width > 0, "the header controls are still on screen");

  prev.click();
  await flushRaf();
  const afterPrev = store.meta.calendarCursor;
  assert.notEqual(afterPrev, before, "the header's previous button moves the calendar a period back");
  today.click();
  await flushRaf();
  assert.notEqual(store.meta.calendarCursor, afterPrev, "the header's Today button comes back");
  const afterToday = store.meta.calendarCursor;
  assert.equal(afterToday, cal.ymd(new Date()), "Today lands on today's month");
  next.click();
  await flushRaf();
  assert.notEqual(store.meta.calendarCursor, afterToday, "the header's next button moves the calendar a period forward");

  // The month/week toggle writes the same state as the view menu and they agree.
  const viewSelect = root.querySelector(".zn-calendar-view-select");
  assert.equal(toggle.textContent.trim(), en.strings["cal.view.week"], "in Month the toggle offers Week");
  toggle.click();
  await flushRaf();
  assert.equal(store.meta.calendarView, "week", "the toggle switched to Week");
  assert.equal(viewSelect.textContent.trim(), en.strings["cal.view.week"], "the view menu follows the toggle");
  assert.equal(toggle.textContent.trim(), en.strings["cal.view.month"], "the toggle now offers Month");
  assert.equal(toggle.getAttribute("aria-pressed"), "true", "the toggle reads as pressed while Week is shown");
  toggle.click();
  await flushRaf();
  assert.equal(store.meta.calendarView, "month", "the toggle switched back to Month");
  assert.equal(viewSelect.textContent.trim(), en.strings["cal.view.month"], "the view menu still agrees");

  // Both languages have the new strings, and they are translated rather than missing.
  for (const [name, table] of [["en", en], ["pl", pl]]) {
    for (const key of ["cal.view.toggleAria", "cal.view.toggleTitle", "cal.headNav.aria"]) {
      assert.equal(typeof table.strings[key], "string", `${name} has ${key}`);
      assert.ok(table.strings[key].length > 0, `${name} ${key} is not empty`);
    }
  }
  assert.notEqual(en.strings["cal.view.toggleAria"], pl.strings["cal.view.toggleAria"], "the new strings are actually translated");

  // ---- OW-83: the owner asked for small < o > chevrons and got pills ------------------------------------------
  {
    // Measured in a real headless Chromium before the fix: the two chevrons were 22x20 with a 999px radius and a 1px
    // border, the same visual weight as "Go to today" beside them. The owner's words: "WAY too big, i asked
    // specifically for small < o > chevrons".
    const nav = rule(".zentral-notes-sheet .zn-calendar-head-nav .zn-calendar-nav");
    assert.match(nav, /border:\s*0/, "a chevron has no pill border");
    assert.match(nav, /border-radius:\s*4px/, "a chevron is a small square, not a pill");
    assert.match(nav, /width:\s*20px/, "a chevron is 20px wide");
    assert.match(nav, /height:\s*20px/, "a chevron is 20px tall");
    assert.match(nav, /padding:\s*0/, "a chevron has no side padding");
    assert.doesNotMatch(nav, /border-radius:\s*999px/, "nothing puts the pill back");
    // The glyph itself is drawn at 1em, not the chip's 0.92em: a small button must not make a smaller glyph smaller.
    assert.match(nav, /font-size:\s*1em/, "the chevron glyph keeps its size while the button shrinks");
  }

  await store.close();
  console.log("OW-73 / OW-74 / OW-83 calendar header and one-line toolbar tests passed");
})().catch((err) => { console.error(err); process.exit(1); });
