"use strict";
/* OW-103: "switching zentral web panel forces user out of all notes/calendar view."
 *
 * Switching the panel tears the sheet down and builds it again. `finishOpen` finished every open by opening a note,
 * and `openNote` sets view = "editor" on the way — so a person working in All notes or the calendar came back in the
 * editor, on whatever note happened to be last, every time they switched panels. The view and the list filter are view
 * state now: they are written when they change and restored when the sheet opens.
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
    io, notify() {}, windowId: "ow103-ui", now: () => fixedNow, getDir: async () => "/ow103",
    getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout,
  });
  await store.open();
  store.setMeta({ calendarView: "month", calendarCursor: "2026-11-18", calendarLayout: "lr" });
  await store.flush();
  const host = new El("div");
  const adapter = {
    // Match the real Notes/Calendar pseudo-tab host: opening it defaults to All notes.
    kind: "primary",
    position: "fixed", host, attach: (root) => host.append(root),
    getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }),
    watch: () => () => {}, setActive() {}, rewatch() {},
  };
  const make = () => core.createSheet({
    store, adapter,
    env: { now: () => fixedNow, getPref: (_k, d) => d, setPref() {}, openLink() {} },
    ensureStore: () => store.open(),
  });
  const prepare = async (sheet) => {
    const root = sheet.root;
    root.ownerDocument = document;
    root.querySelector(".zn-all-layout").getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
    root.querySelector(".zn-all-panels").getBoundingClientRect = root.querySelector(".zn-all-layout").getBoundingClientRect;
    root.querySelector(".zn-calendar-pane").getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
    await sheet.open();
    await flush();
    return root;
  };
  return { store, flush, make, prepare };
}

const viewOf = (root) => root.dataset.view;

(async () => {
  await test("OW-106: a fresh sheet defaults to All notes even when the saved view was the editor", async () => {
    const h = await makeSheet();
    const note = h.store.create("# Saved note\\nBody");
    h.store.setMeta({ sheetView: "editor" });
    await h.store.flush();
    const sheet = h.make();
    try {
      const root = await h.prepare(sheet);
      assert.equal(viewOf(root), "list", "the default landing page is All notes, not the last note's editor");
      assert.equal(root.dataset.allNotesActive, "true", "the calendar/list surface is active");
      assert.equal(sheet.openNote(note.id), true, "intentional navigation to a particular note remains available");
      await h.flush();
      assert.equal(viewOf(root), "editor", "an explicit request still opens the selected note");
    } finally { try { sheet.destroy(); } catch (_) {} }
  });

  await test("the view the person leaves is written to the view state, and it is a view key", async () => {
    const h = await makeSheet();
    const sheet = h.make();
    try {
      const root = await h.prepare(sheet);
      assert.equal(viewOf(root), "list", "a fresh pseudo-tab host opens in All notes");
      assert.equal(h.store.meta.sheetView, "list", "and the default landing page is recorded");
      assert.ok(C.UI_STATE_KEYS.includes("sheetView") && C.UI_STATE_KEYS.includes("sheetFilter"),
        "the calendar part owns the key, so it round-trips through the view file rather than meta.json");
    } finally { try { sheet.destroy(); } catch (_) {} }
  });

  await test("reopening the sheet — what a panel switch does — comes back to All notes", async () => {
    const h = await makeSheet();
    const first = h.make();
    let second = null;
    try {
      const root = await h.prepare(first);
      assert.equal(viewOf(root), "list", "the first open is already All notes");

      // The panel switch: this sheet goes away and a new one is built, as the host does it.
      try { first.destroy(); } catch (_) {}
      second = h.make();
      const root2 = await h.prepare(second);
      assert.equal(viewOf(root2), "list", "the reopened sheet still shows All notes");
      assert.equal(root2.dataset.allNotesActive, "true", "and the calendar is live beside it");
    } finally {
      try { second && second.destroy(); } catch (_) {}
    }
  });

  await test("a sheet left in the editor still defaults to All notes after it is reopened", async () => {
    const h = await makeSheet();
    const first = h.make();
    let second = null;
    try {
      const root = await h.prepare(first);
      assert.equal(viewOf(root), "list");
      const noteId = h.store.latestId();
      assert.ok(noteId);
      assert.equal(first.openNote(noteId), true, "the person can explicitly enter the note editor");
      await h.flush();
      assert.equal(viewOf(root), "editor");
      try { first.destroy(); } catch (_) {}
      second = h.make();
      const root2 = await h.prepare(second);
      assert.equal(viewOf(root2), "list", "the last-opened note is not restored as the default landing page");
      assert.equal(root2.dataset.allNotesActive, "true");
    } finally { try { second && second.destroy(); } catch (_) {} }
  });

  await test("the list filter comes back too, and a bad one falls back to All notes", async () => {
    const h = await makeSheet();
    const first = h.make();
    let second = null;
    try {
      const root = await h.prepare(first);
      assert.equal(viewOf(root), "list");
      // Trash is a filter of the same list; switching to it must not be forgotten either.
      h.store.setMeta({ sheetFilter: "trash", sheetView: "list" });
      try { first.destroy(); } catch (_) {}
      second = h.make();
      const root2 = await h.prepare(second);
      assert.equal(viewOf(root2), "list", "still the list");
      h.store.setMeta({ sheetFilter: "nonsense" });
      try { second.destroy(); } catch (_) {}
      second = h.make();
      const root3 = await h.prepare(second);
      assert.equal(viewOf(root3), "list", "a filter the sheet does not know still restores the list rather than nothing");
    } finally { try { second && second.destroy(); } catch (_) {} }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
