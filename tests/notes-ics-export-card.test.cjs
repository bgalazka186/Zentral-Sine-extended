"use strict";
/* T2.13: the export card, driven for real instead of read as source.
 *
 * The `.ics` writer is pinned by `notes-ics-export.test.cjs`; this file drives the card the person actually touches:
 * Calendar → Tools → Export calendar (.ics)… must put a card on screen, say how much is going out, and write NOTHING
 * until Export is pressed. It then presses Export and reads the file the card asked the host to save.
 *
 * The host is the same fake-DOM harness the other All-notes tests use, so the card is built by the real sheet code with
 * the real calendar module — no re-implementation of the card in the test.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (err) { failed++; console.error("FAIL:", name, "\n ", err && err.stack ? err.stack : err); }
}

async function makeSheet() {
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
    setTimeout, clearTimeout, queueMicrotask,
    innerWidth: 1200, innerHeight: 800,
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((x) => x !== fn)); },
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); },
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
    join: (...p) => p.join("/"),
    filename: (v) => v.split("/").pop(),
    readUTF8: async (v) => { if (!files.has(v)) throw new Error("not found"); return files.get(v).text; },
    writeUTF8: async (v, text) => files.set(v, { text, mtime: fixedNow }),
    remove: async (v) => files.delete(v),
    exists: async (v) => files.has(v),
    children: async (dir) => [...files.keys()].filter((v) => v.startsWith(dir + "/") && !v.slice(dir.length + 1).includes("/")),
    stat: async (v) => ({ lastModified: files.get(v)?.mtime || 0 }),
    restrict: async () => {},
  };
  const store = core.createStore({ io, notify() {}, windowId: "t213", now: () => fixedNow, getDir: async () => "/t213", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  await store.open();
  store.setMeta({ calendarView: "month", calendarCursor: "2026-11-24", calendarLayout: "lr" });
  await store.flush();

  // Two events and one all-day item, so the card has a real count to name.
  store.items.upsert(C.cleanItem({ id: "ev1", summary: "Stand-up", start: { dateTime: "2026-11-24T09:00:00.000Z" }, end: { dateTime: "2026-11-24T09:15:00.000Z" }, x: { kind: "event" } }, fixedNow));
  store.items.upsert(C.cleanItem({ id: "ev2", summary: "Review", start: { dateTime: "2026-11-25T13:00:00.000Z" }, end: { dateTime: "2026-11-25T14:00:00.000Z" }, x: { kind: "event" } }, fixedNow));
  store.items.upsert(C.cleanItem({ id: "ad1", summary: "Anniversary", start: { date: "2026-11-26" }, x: { kind: "event" } }, fixedNow));
  // A cancelled import must never be offered back.
  store.items.upsert(C.cleanItem({ id: "cx1", summary: "Cancelled thing", start: { date: "2026-11-27" }, x: { kind: "event", src: "ics", icsUid: "cx1@google.com", icsCancelled: true } }, fixedNow));
  await store.flush();

  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (root) => host.append(root), getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const prefs = new Map();
  const saved = [];
  const env = {
    now: () => fixedNow,
    getPref: (k, f) => (prefs.has(k) ? prefs.get(k) : f),
    setPref: (k, v) => prefs.set(k, v),
    openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {},
    // The host's save picker, answering the way the real one does: with the text that was written.
    saveIcs: async (text, base) => { saved.push({ text, base }); return true; },
    pickIcs: async () => null,
  };
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root;
  root.ownerDocument = document;
  root.querySelector(".zn-all-layout").getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  root.querySelector(".zn-all-panels").getBoundingClientRect = root.querySelector(".zn-all-layout").getBoundingClientRect;
  root.querySelector(".zn-calendar-pane").getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await sheet.open();
  await flush();
  root.all().find((el) => el.title === "All notes").click();
  await flush();
  const openCalendarRow = (trigger, want) => {
    root.querySelector(trigger).click();
    const hit = () => [...root.querySelectorAll(".zn-menu-item")].find((el) => (want.test ? want.test(el.textContent.trim()) : el.textContent.trim().startsWith(want)));
    let row = hit();
    if (!row) for (const group of [...root.querySelectorAll(".zn-menu-item")].filter((el) => el.classList.contains("zn-menu-group"))) {
      group.click();
      row = hit();
      if (row) break;
      root.querySelector(".zn-menu-back")?.click();
    }
    return row;
  };
  return {
    root, store, saved, flush, openCalendarRow,
    q: (s) => root.querySelector(s), qa: (s) => [...root.querySelectorAll(s)],
    cleanup() { try { sheet.destroy(); } catch (_) {} },
  };
}

(async () => {
  await test("Calendar → Tools offers the export, and it opens a card without writing", async () => {
    const h = await makeSheet();
    try {
      // Open the calendar's tools menu and find the export row.
      const row = h.openCalendarRow(".zn-calendar-tools", /Export calendar/);
      assert.ok(row, "the export row is in Calendar → Tools");
      row.click();
      await h.flush();
      const card = h.q(".zn-dialog-card");
      assert.ok(card, "a card is on screen");
      assert.match(card.textContent, /Export this calendar/);
      // Both scopes are offered with real counts (3 live items; the cancelled one is not counted).
      assert.match(card.textContent, /Everything \(3\)/);
      assert.match(card.textContent, /This year \(3\)/);
      assert.equal(h.saved.length, 0, "opening the card writes nothing — only Export does");
    } finally { h.cleanup(); }
  });

  await test("pressing Export writes one real .ics through the host, and it reads back as the calendar", async () => {
    const h = await makeSheet();
    try {
      const row = h.openCalendarRow(".zn-calendar-tools", /Export calendar/);
      assert.ok(row, "the export row is reachable");
      row.click();
      await h.flush();
      const card = h.q(".zn-dialog-card");
      const go = [...card.querySelectorAll(".zn-chip")].find((b) => b.textContent.trim() === "Export");
      assert.ok(go, "the card has an Export button");
      go.click();
      await h.flush();
      assert.equal(h.saved.length, 1, "exactly one file was saved");
      const file = h.saved[0];
      assert.match(file.base, /^zentral-notes-\d{4}-\d{2}-\d{2}$/, "the file is named by the day: " + file.base);
      // The file it produced really is the calendar: import it back and every live event is there.
      const back = C.planIcsImport(C.parseIcs(file.text), [], { kind: "event", now: 1764000000000 }).add;
      assert.equal(back.length, 3, "the three live items came back, the cancelled one did not");
      assert.deepEqual(back.map((i) => i.summary).sort(), ["Anniversary", "Review", "Stand-up"]);
      // The cancelled import is absent from the file itself, not merely uncounted.
      assert.ok(!file.text.includes("Cancelled thing"));
      assert.equal(h.q(".zn-dialog-card"), null, "the card closes after saving");
    } finally { h.cleanup(); }
  });

  if (failed) { console.error(`${failed} failed, ${passed} passed`); process.exit(1); }
  console.log(`notes-ics-export-card: ${passed} passed`);
})();
