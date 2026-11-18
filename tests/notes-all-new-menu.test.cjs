"use strict";
// OW-07: '+' button in All notes creates notes, folders, reminders, events (and date notes when Agenda is off),
// defaults reminder/event composer to the selected calendar day, and remembers the last choice for one-click create.
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

async function makeSheet({ agendaEnabled = false, cursor = "2026-11-24" } = {}) {
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
  vm.runInNewContext(source, {
    window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
    console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" },
  });
  const core = win.__zentralNotesTestSeam.core;
  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      raf.splice(0).forEach((fn) => fn());
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  const fixedNow = new Date(2026, 10, 16, 10, 0, 0).getTime(); // 2026-11-16 10:00 local
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
    windowId: "ow07-ui",
    now: () => fixedNow,
    getDir: async () => "/ow07",
    getMaxSaveMs: () => 1000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });
  await store.open();
  store.setMeta({
    calendarView: "month",
    calendarCursor: cursor,
    calendarLayout: "lr",
  });
  await store.flush();
  const host = new El("div");
  const adapter = {
    position: "fixed",
    host,
    attach: (root) => host.append(root),
    getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }),
    watch: () => () => {},
    setActive() {},
    rewatch() {},
  };
  const prefs = new Map([["zen.workspace.zentral.notes.agenda_folder", agendaEnabled]]);
  const env = {
    now: () => fixedNow,
    getPref: (key, fallback) => prefs.has(key) ? prefs.get(key) : fallback,
    setPref: (key, value) => prefs.set(key, value),
    openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {},
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

  return {
    Ev,
    win,
    prefs,
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

(async () => {
  await test("pure helpers normalize '+' choices and build Agenda-aware menu models", () => {
    assert.deepEqual([...C.ALL_NOTES_NEW_CHOICES], ["note", "folder", "reminder", "event", "date"]);
    assert.equal(C.cleanAllNotesNewChoice(undefined), "note");
    assert.equal(C.cleanAllNotesNewChoice("bogus"), "note");
    assert.equal(C.cleanAllNotesNewChoice("event"), "event");
    assert.equal(C.cleanAllNotesNewChoice("date", { agendaEnabled: false }), "date");
    assert.equal(C.cleanAllNotesNewChoice("date", { agendaEnabled: true }), "note");
    assert.equal(C.cleanAllNotesNewChoice("reminder", { calendarAvailable: false }), "note");
    assert.equal(C.cleanAllNotesNewChoice("event", { calendarAvailable: false }), "note");

    const offEntries = C.allNotesNewMenuModel({ choice: "reminder", agendaEnabled: false, calendarAvailable: true });
    assert.deepEqual(
      offEntries.map((entry) => entry.label),
      ["New note", "New folder", "New reminder", "New event", "Date note"],
    );
    assert.equal(offEntries.find((entry) => entry.id === "reminder").active, true);
    assert.equal(offEntries.find((entry) => entry.id === "note").active, false);

    const onEntries = C.allNotesNewMenuModel({ choice: "date", agendaEnabled: true, calendarAvailable: true });
    assert.deepEqual(
      onEntries.map((entry) => entry.label),
      ["New note", "New folder", "New reminder", "New event"],
    );
    assert.equal(onEntries.find((entry) => entry.id === "note").active, true);

    assert.equal(C.allNotesNewButtonLabel("note"), "New note (Ctrl+N)");
    assert.equal(C.allNotesNewButtonLabel("folder"), "New folder");
    assert.equal(C.allNotesNewButtonLabel("reminder"), "New reminder");
    assert.equal(C.allNotesNewButtonLabel("event"), "New event");
    assert.equal(C.allNotesNewButtonLabel("date", { agendaEnabled: false }), "Date note");
    assert.equal(C.allNotesNewButtonLabel("date", { agendaEnabled: true }), "New note (Ctrl+N)");
  });

  await test("All notes '+' menu exposes entries (hiding Date note when Agenda is on) and defaults composer to selected calendar day", async () => {
    const h = await makeSheet({ agendaEnabled: false, cursor: "2026-11-24" });
    try {
      const btnNew = h.q(".zn-new");
      const btnMenu = h.q(".zn-new-menu");
      assert.equal(Boolean(btnNew), true);
      assert.equal(Boolean(btnMenu), true);
      assert.equal(btnNew.getAttribute("aria-label"), "New note (Ctrl+N)");

      btnMenu.click();
      await h.flush();
      const labelsOff = h.qa(".zn-menu .zn-menu-item").map((b) => b.textContent.trim());
      // OW-75: the calendar's four creation modes now live under this menu, in one group, as the owner asked
      // ("create xyz from calendar ... into Notes + drop-down"). The primary list is unchanged.
      assert.deepEqual(labelsOff, ["New note", "New folder", "New reminder", "New event", "Date note", "Create"]);
      const createGroup = h.qa(".zn-menu .zn-menu-group").find((b) => b.textContent.trim() === "Create");
      assert.ok(createGroup, "the calendar creation modes are one group in the + menu");
      createGroup.click();
      await h.flush();
      assert.deepEqual(
        h.qa(".zn-menu .zn-menu-item").map((b) => b.textContent.trim()),
        ["Back", "Create timed event…", "Create all-day event…", "Create timed reminder…", "Create all-day reminder…"],
        "all four creation modes are there, none lost",
      );
      h.q(".zn-menu .zn-menu-back").click();
      await h.flush();

      // Pick "New reminder": opens composer defaulted to selected calendar day (2026-11-24) and remembers choice.
      h.qa(".zn-menu .zn-menu-item").find((b) => b.textContent.trim() === "New reminder").click();
      await h.flush();

      let composer = h.q(".zn-cal-compose-card");
      assert.equal(Boolean(composer), true, "picking New reminder opens the calendar composer");
      assert.equal(composer.querySelector('[aria-label="Start date"]').value, "2026-11-24");
      assert.equal(composer.querySelector('[aria-label="Item type"]').value, "reminder");
      assert.equal(h.store.meta.allNewChoice, "reminder");
      assert.equal(btnNew.getAttribute("aria-label"), "New reminder");

      // Cancel composer, select a different calendar day (2026-11-27), and verify one-click '+' uses remembered reminder + new day.
      h.qa(".zn-cal-compose-card button").find((b) => b.textContent.trim() === "Cancel").click();
      await h.flush();
      assert.equal(h.q(".zn-cal-compose-card"), null);

      const day27 = h.qa(".zn-cal-month-cell").find((cell) => cell.getAttribute("data-day") === "2026-11-27");
      assert.equal(Boolean(day27), true);
      day27.click();
      await h.flush();
      assert.equal(h.store.meta.calendarCursor, "2026-11-27");

      btnNew.click();
      await h.flush();
      composer = h.q(".zn-cal-compose-card");
      assert.equal(Boolean(composer), true, "one-click '+' opens remembered New reminder composer");
      assert.equal(composer.querySelector('[aria-label="Start date"]').value, "2026-11-27");
      assert.equal(composer.querySelector('[aria-label="Item type"]').value, "reminder");
      h.qa(".zn-cal-compose-card button").find((b) => b.textContent.trim() === "Cancel").click();
      await h.flush();

      // Pick "New event": opens composer defaulted to Event on 2026-11-27 and updates remembered default.
      btnMenu.click();
      await h.flush();
      h.qa(".zn-menu .zn-menu-item").find((b) => b.textContent.trim() === "New event").click();
      await h.flush();
      composer = h.q(".zn-cal-compose-card");
      assert.equal(Boolean(composer), true);
      assert.equal(composer.querySelector('[aria-label="Start date"]').value, "2026-11-27");
      assert.equal(composer.querySelector('[aria-label="Item type"]').value, "event");
      assert.equal(h.store.meta.allNewChoice, "event");
      assert.equal(btnNew.getAttribute("aria-label"), "New event");
      h.qa(".zn-cal-compose-card button").find((b) => b.textContent.trim() === "Cancel").click();
      await h.flush();

      // Pick "New folder": opens folder name dialog and updates remembered default.
      btnMenu.click();
      await h.flush();
      h.qa(".zn-menu .zn-menu-item").find((b) => b.textContent.trim() === "New folder").click();
      await h.flush();
      const folderDlg = h.q(".zn-dialog");
      assert.equal(Boolean(folderDlg), true);
      assert.equal(folderDlg.querySelector(".zn-dialog-card").getAttribute("aria-label"), "New folder");
      assert.equal(h.store.meta.allNewChoice, "folder");
      assert.equal(btnNew.getAttribute("aria-label"), "New folder");
      h.qa(".zn-dialog button").find((b) => b.textContent.trim() === "Cancel").click();
      await h.flush();

      // Pick "Date note" while Agenda is off: opens/creates date note for selected day 2026-11-27, remembers "date".
      btnMenu.click();
      await h.flush();
      h.qa(".zn-menu .zn-menu-item").find((b) => b.textContent.trim() === "Date note").click();
      await h.flush();
      assert.equal(h.store.meta.allNewChoice, "date");
      assert.equal(h.root.dataset.view, "editor");
      assert.equal(h.q(".zn-editor").value.includes("27-11-2026") || h.q(".zn-editor").value.includes("2026-11-27"), true);

      // Return to All notes, turn Agenda on: menu hides Date note and one-click '+' falls back to New note.
      h.root.all().find((el) => el.title === "All notes").click();
      await h.flush();
      h.prefs.set("zen.workspace.zentral.notes.agenda_folder", true);
      btnMenu.click();
      await h.flush();
      const labelsOn = h.qa(".zn-menu .zn-menu-item").map((b) => b.textContent.trim());
      assert.deepEqual(labelsOn, ["New note", "New folder", "New reminder", "New event", "Create"], "Date note is hidden; the calendar group stays");
      // Close menu and trigger one-click '+' -> creates a blank note instead of Date note.
      btnMenu.click();
      await h.flush();
      const countBefore = h.store.list().length;
      btnNew.click();
      await h.flush();
      assert.equal(h.store.list().length, countBefore + 1);
      assert.equal(h.root.dataset.view, "editor");
    } finally {
      h.cleanup();
    }
  });

  if (failed) {
    console.error(`${failed} failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`notes-all-new-menu: ${passed} passed`);
})();
