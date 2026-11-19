"use strict";
/* OW-104: "in all notes/calendar view 3 dots on most top bar is still linked to last open note, it can be confusing."
 *
 * The three-dot menu is the note's menu: delete, duplicate, move to folder. In the editor the header names the note, so
 * the menu's subject is on screen. In All notes / the calendar the header names the view instead, and the menu went on
 * acting on whichever note had been open last — with nothing anywhere saying which one that was. The menu now opens by
 * naming that note and offering it, so the subject is never left to be guessed.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("ok - " + name); }
  catch (err) { failed++; console.error("FAIL:", name, "\n ", err && err.stack ? err.stack : err); }
}

async function makeSheet() {
  const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  const dom = require("./helpers/fake-dom.cjs")();
  const { El, Ev, document, raf } = dom;
  const win = {
    __zentralNotesParts: { "notes-calendar": C },
    document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {},
    requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {},
    setTimeout, clearTimeout, queueMicrotask, innerWidth: 1200, innerHeight: 800,
    addEventListener() {}, removeEventListener() {},
  };
  win.window = win;
  vm.runInNewContext(source, {
    window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
    console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask,
    navigator: { platform: "Linux" },
  });
  const core = win.__zentralNotesTestSeam.core;
  const flush = async () => {
    for (let i = 0; i < 6; i++) { raf.splice(0).forEach((fn) => fn()); await new Promise((r) => setImmediate(r)); }
  };
  const fixedNow = new Date(2026, 10, 16, 10, 0, 0).getTime();
  const files = new Map();
  const io = {
    join: (...p) => p.join("/"), filename: (v) => v.split("/").pop(),
    readUTF8: async (v) => { if (!files.has(v)) throw new Error("not found"); return files.get(v).text; },
    writeUTF8: async (v, text) => files.set(v, { text, mtime: fixedNow }),
    remove: async (v) => files.delete(v), exists: async (v) => files.has(v),
    children: async (dir) => [...files.keys()].filter((v) => v.startsWith(dir + "/") && !v.slice(dir.length + 1).includes("/")),
    stat: async (v) => ({ lastModified: files.get(v)?.mtime || 0 }), restrict: async () => {},
  };
  const store = core.createStore({
    io, notify() {}, windowId: "ow104-ui", now: () => fixedNow, getDir: async () => "/ow104",
    getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout,
  });
  await store.open();
  const keep = store.create("# The note that was open\n\nbody\n");
  store.create("# A second note\n");
  store.setMeta({ calendarView: "month", calendarCursor: "2026-11-18", calendarLayout: "lr", lastNoteId: keep.id });
  await store.flush();
  const host = new El("div");
  const adapter = {
    position: "fixed", host, attach: (root) => host.append(root),
    getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }),
    watch: () => () => {}, setActive() {}, rewatch() {},
  };
  const sheet = core.createSheet({
    store, adapter,
    env: { now: () => fixedNow, getPref: (_k, d) => d, setPref() {}, openLink() {} },
    ensureStore: () => store.open(),
  });
  const root = sheet.root;
  root.ownerDocument = document;
  root.querySelector(".zn-all-layout").getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  root.querySelector(".zn-all-panels").getBoundingClientRect = root.querySelector(".zn-all-layout").getBoundingClientRect;
  root.querySelector(".zn-calendar-pane").getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await sheet.open();
  await flush();
  return {
    store, sheet, flush, root, keep,
    q: (sel) => root.querySelector(sel),
    qa: (sel) => [...root.querySelectorAll(sel)],
    menu: () => [...root.querySelectorAll(".zn-menu .zn-menu-item")].map((b) => b.textContent.trim()),
    cleanup() { try { sheet.destroy(); } catch (_) {} },
  };
}

const openMore = async (h) => {
  h.root.querySelector(".zn-btn-more, [aria-label=\"More\"]")?.click?.();
  await h.flush();
};

(async () => {
  await test("in All notes the three-dot menu names the note its actions belong to", async () => {
    const h = await makeSheet();
    try {
      h.root.all().find((el) => el.title === "All notes").click();
      await h.flush();
      assert.equal(h.root.dataset.view, "list", "precondition: All notes is on screen");
      const more = h.root.querySelector('[aria-label="More"]') || h.root.querySelector(".zn-btn-more");
      assert.ok(more, "the three-dot button is there");
      more.click();
      await h.flush();
      const labels = h.menu();
      assert.ok(labels.length > 0, "the menu opened");
      const header = labels.find((l) => /Actions for/.test(l));
      assert.equal(header, "Actions for \u201cThe note that was open\u201d",
        "the first thing the menu says is which note its actions act on, in the person's own title");
      assert.ok(labels.some((l) => l === "Open that note"), "and that note can be opened from here, so nothing is a guess");
    } finally { h.cleanup(); }
  });

  await test("in the editor the menu is unchanged — the header already names the note", async () => {
    const h = await makeSheet();
    try {
      assert.equal(h.root.dataset.view, "editor", "precondition: a note is open");
      h.root.querySelector('[aria-label="More"]').click();
      await h.flush();
      const labels = h.menu();
      assert.ok(labels.length > 0, "the menu opened");
      assert.ok(!labels.some((l) => /Actions for/.test(l)),
        "no redundant header is added where the top bar already says which note is open");
      assert.ok(!labels.includes("Open that note"), "and no 'open that note' row for the note already on screen");
    } finally { h.cleanup(); }
  });

  await test("opening that note from the menu lands in the editor on that note", async () => {
    const h = await makeSheet();
    try {
      h.root.all().find((el) => el.title === "All notes").click();
      await h.flush();
      h.root.querySelector('[aria-label="More"]').click();
      await h.flush();
      const row = h.qa(".zn-menu .zn-menu-item").find((b) => b.textContent.trim() === "Open that note");
      row.click();
      await h.flush();
      assert.equal(h.root.dataset.view, "editor", "the note opens in the editor, as picking a note does anywhere else");
    } finally { h.cleanup(); }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
