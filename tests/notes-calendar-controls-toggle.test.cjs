"use strict";
/* OW-34: Quick-hide toggle for Calendar filter/controls bar with active-filter indicator, persistence, and EN/PL i18n. */
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
  innerWidth: 1000,
  innerHeight: 700,
  addEventListener() {},
  removeEventListener() {},
};
win.window = win;
vm.runInNewContext(source, {
  window: win, document, Event: Ev, Services, globalThis: { Services }, ChromeUtils: {},
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
  // 1. Pure active-filter counter
  assert.equal(typeof cal.calendarActiveFilterCount, "function", "exports calendarActiveFilterCount");
  assert.equal(cal.calendarActiveFilterCount("all", ""), 0);
  assert.equal(cal.calendarActiveFilterCount("all", "   "), 0);
  assert.equal(cal.calendarActiveFilterCount("event", ""), 1);
  assert.equal(cal.calendarActiveFilterCount("reminder", ""), 1);
  assert.equal(cal.calendarActiveFilterCount("all", "Work"), 1);
  assert.equal(cal.calendarActiveFilterCount("event", "Work"), 2);
  assert.equal(cal.calendarActiveFilterCount("invalid", null), 0);

  // 2. CSS hidden guards
  assert.match(css, /\.zn-calendar-controls\[hidden\]\s*\{[^}]*display:\s*none\s*!important/, "collapsed controls bar is fully hidden");
  assert.match(css, /\.zn-calendar-controls-dot\[hidden\]\s*\{[^}]*display:\s*none\s*!important/, "active-filter dot respects hidden attribute");

  // 3. Live sheet toggle, active-filter dot, persistence, and EN/PL i18n
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
  const env = { getPref: (k, d) => prefs.has(k) ? prefs.get(k) : d, setPref: (k, v) => prefs.set(k, v), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
  const store = core.createStore({ io, notify() {}, windowId: "cal-ctrl", getDir: async () => "/cc", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  await store.open();
  store.create("# Calendar test\nHello");

  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (r) => host.append(r), getArea: () => ({ left: 0, top: 0, width: 900, height: 600 }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root;
  root.ownerDocument = document;
  const layout = root.querySelector(".zn-all-layout");
  const panels = root.querySelector(".zn-all-panels");
  layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600 });
  panels.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600 });

  await sheet.open(); await flushRaf();
  root.querySelector(".zn-title").click(); await flushRaf();

  const toggle = root.querySelector(".zn-calendar-controls-toggle");
  const dot = root.querySelector(".zn-calendar-controls-dot");
  const controls = root.querySelector(".zn-calendar-controls");
  const calPane = root.querySelector(".zn-calendar-pane");
  assert.ok(toggle, "controls toggle button exists in calendar header");
  assert.ok(dot, "active-filter indicator dot exists");
  assert.equal(controls.hidden, false, "controls bar starts expanded");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(toggle.title, "Hide calendar controls");
  assert.equal(dot.hidden, true, "dot hidden when expanded");

  // Collapse with default filters -> controls hidden, dot still hidden
  toggle.click(); await flushRaf();
  assert.equal(store.meta.calendarFiltersCollapsed, true);
  assert.equal(controls.hidden, true, "controls bar hides on toggle click");
  assert.equal(calPane.dataset.controlsCollapsed, "true");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(toggle.title, "Show calendar controls");
  assert.equal(dot.hidden, true, "dot stays hidden when no non-default filter is active");

  // Expand, apply Kind=event + Category=Work, then collapse -> dot lights up with active count 2
  toggle.click(); await flushRaf();
  assert.equal(controls.hidden, false);
  root.querySelector(".zn-calendar-kind-filter").click();
  root.querySelectorAll(".zn-menu-item").find((b) => b.textContent.includes("Events")).click();
  await flushRaf();
  root.querySelector(".zn-calendar-category-filter").click();
  root.querySelectorAll(".zn-menu-item").find((b) => b.textContent.includes("Work")).click();
  await flushRaf();
  assert.equal(dot.hidden, true, "dot stays hidden while controls bar is visible");

  toggle.click(); await flushRaf();
  assert.equal(controls.hidden, true);
  assert.equal(dot.hidden, false, "dot appears while collapsed with active filters");
  assert.equal(toggle.dataset.activeFilters, "2");
  assert.ok(toggle.classList.contains("has-active-filters"), "button marks active-filter class when collapsed");
  assert.equal(toggle.title, "Show calendar controls (2 active)");
  assert.equal(toggle.getAttribute("aria-label"), "Show calendar controls (2 active)");

  // Switch UI language to Polish -> tooltip & aria-label localize immediately
  prefs.set(core.PREF.NOTES_LANGUAGE, "pl");
  sheet.applyState(); await flushRaf();
  assert.equal(toggle.title, "Poka\u017c pasek sterowania kalendarza (aktywne: 2)");
  assert.equal(toggle.getAttribute("aria-label"), "Poka\u017c pasek sterowania kalendarza (aktywne: 2)");
  toggle.click(); await flushRaf();
  assert.equal(toggle.title, "Ukryj pasek sterowania kalendarza");
  toggle.click(); await flushRaf();
  prefs.set(core.PREF.NOTES_LANGUAGE, "en");
  sheet.applyState(); await flushRaf();

  // Persistence across store reopen
  await store.flush();
  const restored = core.createStore({ io, notify() {}, windowId: "cal-ctrl-reopen", getDir: async () => "/cc", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  await restored.open();
  assert.equal(restored.meta.calendarFiltersCollapsed, true, "calendarFiltersCollapsed persists in meta.json");

  // Reopen a fresh sheet from persisted meta -> starts collapsed with active dot
  const host2 = new El("div");
  const adapter2 = { position: "fixed", host: host2, attach: (r) => host2.append(r), getArea: () => ({ left: 0, top: 0, width: 900, height: 600 }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const sheet2 = core.createSheet({ store: restored, adapter: adapter2, env, ensureStore: () => restored.open() });
  sheet2.root.ownerDocument = document;
  sheet2.root.querySelector(".zn-all-layout").getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600 });
  sheet2.root.querySelector(".zn-all-panels").getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600 });
  await sheet2.open(); await flushRaf();
  sheet2.root.querySelector(".zn-title").click(); await flushRaf();
  assert.equal(sheet2.root.querySelector(".zn-calendar-controls").hidden, true, "reopened sheet restores collapsed calendar controls");
  assert.equal(sheet2.root.querySelector(".zn-calendar-controls-dot").hidden, false, "reopened sheet restores active-filter dot");

  sheet2.destroy();
  sheet.destroy();
  await restored.close();
  await store.close();
  console.log("OW-34 calendar controls quick-hide toggle tests passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
