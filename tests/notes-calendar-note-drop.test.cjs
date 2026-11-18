"use strict";
/* OW-02: drag a note from the All notes tree onto the calendar to open the reminder composer. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");

// ---- 1. Pure slot computation and drop-label formatting ---------------------------------------------------------------
{
  assert.equal(cal.NOTE_DRAG_MIME, "application/x-zentral-note-id");
  assert.equal(typeof cal.calendarNoteDropSlot, "function");
  assert.equal(typeof cal.calendarNoteDropLabel, "function");

  // Month, picker and all-day strip produce all-day reminders with an exclusive next-day endDate ready if switched to Event.
  for (const surface of ["month", "picker", "allday"]) {
    const slot = cal.calendarNoteDropSlot(surface, "2026-11-18", { zone: "Europe/Warsaw" });
    assert.deepEqual(slot, {
      surface,
      kind: "reminder",
      allDay: true,
      date: "2026-11-18",
      endDate: "2026-11-19",
      tz: "Europe/Warsaw",
      minute: null,
    }, surface + " resolves to an all-day reminder target");
    assert.equal(cal.calendarNoteDropLabel(slot, "YYYY-MM-DD"), "2026-11-18 · all day");
    assert.equal(cal.calendarNoteDropLabel(slot, "DD-MM-YYYY"), "18-11-2026 · all day");
  }

  // Timed slots snap to the configured snap step and respect visible hour bounds (OW-04).
  const fullGrid = { startMin: 0, endMin: 1440 };
  const limitedGrid = { startMin: 480, endMin: 1200 }; // 08:00–20:00
  const s15 = cal.calendarNoteDropSlot("time", "2026-11-18", { offsetPx: 14 * 60 + 22, hourPx: 60, grid: fullGrid, snapMin: 15 });
  assert.deepEqual(s15, {
    surface: "time",
    kind: "reminder",
    allDay: false,
    date: "2026-11-18",
    startTime: "14:15",
    endDate: "2026-11-18",
    endTime: "15:15",
    tz: "",
    minute: 14 * 60 + 15,
  });
  assert.equal(cal.calendarNoteDropLabel(s15, "YYYY-MM-DD"), "2026-11-18 · 14:15");

  const s30 = cal.calendarNoteDropSlot("time", "2026-11-18", { offsetPx: 2 * 60 + 20, hourPx: 60, grid: limitedGrid, snapMin: 30, zone: "Europe/Warsaw" });
  assert.equal(s30.startTime, "10:30", "offset inside 08:00–20:00 counts from 08:00 and snaps to 30 min");
  assert.equal(s30.endTime, "11:30");
  assert.equal(s30.tz, "Europe/Warsaw");
  assert.equal(s30.minute, 10 * 60 + 30);

  // Near 24:00 clamps to the last snapped slot of the dropped day (never invalid 24:00, and end crosses midnight cleanly).
  const late = cal.calendarNoteDropSlot("time", "2026-11-18", { offsetPx: 24 * 60 - 2, hourPx: 60, grid: fullGrid, snapMin: 15 });
  assert.equal(late.date, "2026-11-18");
  assert.equal(late.startTime, "23:45");
  assert.equal(late.endDate, "2026-11-19");
  assert.equal(late.endTime, "00:45");

  // Spring-forward gap advances to the first valid wall minute in the zone.
  const spring = cal.calendarNoteDropSlot("time", "2026-03-29", { offsetPx: 2 * 60 + 30, hourPx: 60, grid: fullGrid, snapMin: 15, zone: "Europe/Warsaw" });
  assert.equal(spring.date, "2026-03-29");
  assert.equal(spring.startTime, "03:00");
  assert.equal(spring.endTime, "04:00");
  assert.equal(spring.minute, 180);

  // Invalid inputs return null.
  assert.equal(cal.calendarNoteDropSlot("unknown", "2026-11-18"), null);
  assert.equal(cal.calendarNoteDropSlot("month", "not-a-date"), null);
  assert.equal(cal.calendarNoteDropSlot("time", "2026-11-18", { hourPx: 0 }), null);
  assert.equal(cal.calendarNoteDropSlot("time", "2026-11-18", { zone: "Mars/Olympus" }), null);
  assert.equal(cal.calendarNoteDropLabel(null), "");
}

// ---- 2. Real sheet fake-drag integration: tree payload, highlight, Escape, composer prefill, store invariants ----------
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const listeners = new Map();
const win = {
  __zentralNotesParts: { "notes-calendar": cal }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {},
  requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, queueMicrotask,
  innerWidth: 1200, innerHeight: 800,
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
const flush = async () => { for (let i = 0; i < 6; i++) { raf.splice(0).forEach((fn) => fn()); await new Promise((resolve) => setImmediate(resolve)); } };

function makeDataTransfer() {
  const data = new Map();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    get types() { return [...data.keys()]; },
    setData(type, value) { data.set(String(type), String(value)); },
    getData(type) { return data.get(String(type)) || ""; },
  };
}

const fixedNow = new Date(2026, 10, 16, 10, 0, 0).getTime(); // 2026-11-16 10:00 local
const files = new Map();
const io = {
  join: (...parts) => parts.join("/"), filename: (value) => value.split("/").pop(),
  readUTF8: async (value) => { if (!files.has(value)) throw new Error("not found"); return files.get(value).text; },
  writeUTF8: async (value, text) => files.set(value, { text, mtime: fixedNow }),
  remove: async (value) => files.delete(value), exists: async (value) => files.has(value),
  children: async (dir) => [...files.keys()].filter((value) => value.startsWith(dir + "/") && !value.slice(dir.length + 1).includes("/")),
  stat: async (value) => ({ lastModified: files.get(value)?.mtime || 0 }), restrict: async () => {},
};
const store = core.createStore({
  io, notify() {}, windowId: "note-drop-ui", now: () => fixedNow,
  getDir: async () => "/note-drop", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout,
});
const host = new El("div");
const adapter = { position: "fixed", host, attach: (root) => host.append(root), getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }), watch: () => () => {}, setActive() {}, rewatch() {} };
const prefs = new Map();
const env = {
  now: () => fixedNow,
  getPref: (key, fallback) => prefs.has(key) ? prefs.get(key) : fallback,
  setPref: (key, value) => prefs.set(key, value),
  openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {},
};
const q = (root, selector) => root.querySelector(selector);

(async () => {
  await store.open();
  const initialBody = "# Quarterly Roadmap\n\n%%zn-date-ignore:2099-01-01%%\nKeep markers untouched.";
  const note = store.create(initialBody);
  const trashedNote = store.create("# Trashed idea");
  store.trash(trashedNote.id);
  await store.flush();

  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root; root.ownerDocument = document;
  let paneRect = { left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 };
  q(root, ".zn-all-layout").getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  q(root, ".zn-all-panels").getBoundingClientRect = q(root, ".zn-all-layout").getBoundingClientRect;
  q(root, ".zn-calendar-pane").getBoundingClientRect = () => paneRect;

  await sheet.open(); await flush();
  root.all().find((el) => el.title === "All notes").click(); await flush();

  const treeRow = root.querySelectorAll(".zn-item").find((node) => node.getAttribute("data-id") === note.id);
  assert.ok(treeRow, "All notes tree renders the note row");
  assert.equal(treeRow.getAttribute("draggable"), "true");

  // 2a. Month cell drop: payload type, highlight with computed date, all-day reminder prefill, cancel leaves store unchanged.
  {
    const dt = makeDataTransfer();
    treeRow.dispatchEvent(new Ev("dragstart", { bubbles: true, dataTransfer: dt }));
    assert.equal(dt.getData(cal.NOTE_DRAG_MIME), note.id, "tree dragstart populates application/x-zentral-note-id");
    assert.equal(dt.getData("text/plain"), note.id, "folder-move text/plain payload remains intact");

    const monthCell = root.querySelectorAll(".zn-cal-month-cell").find((node) => node.getAttribute("data-day") === "2026-11-20");
    assert.ok(monthCell, "target Month cell exists");
    const over = new Ev("dragover", { bubbles: true, dataTransfer: dt });
    monthCell.dispatchEvent(over);
    assert.equal(over.defaultPrevented, true, "Month cell accepts note dragover");
    assert.equal(monthCell.classList.contains("is-note-drop"), true, "Month cell highlights while dragging");
    const preview = q(root, ".zn-cal-drag-preview.is-note-drop");
    assert.ok(preview, "drop highlight shows the computed target badge");
    assert.equal(preview.textContent, "20-11-2026 · all day");

    // Leaving to outside clears the highlight.
    monthCell.dispatchEvent(new Ev("dragleave", { bubbles: true, dataTransfer: dt, relatedTarget: null }));
    assert.equal(monthCell.classList.contains("is-note-drop"), false);
    assert.equal(q(root, ".zn-cal-drag-preview.is-note-drop"), null);

    // Re-enter and drop.
    monthCell.dispatchEvent(new Ev("dragover", { bubbles: true, dataTransfer: dt }));
    const drop = new Ev("drop", { bubbles: true, dataTransfer: dt });
    monthCell.dispatchEvent(drop);
    treeRow.dispatchEvent(new Ev("dragend", { bubbles: true, dataTransfer: dt }));
    await flush();

    assert.equal(drop.defaultPrevented, true);
    assert.equal(monthCell.classList.contains("is-note-drop"), false, "drop clears highlight");
    assert.equal(store.items.list().length, 0, "dropping opens the composer without writing to the store yet");
    assert.equal(store.get(note.id).body, initialBody, "note body is untouched before confirmation");

    const composer = q(root, ".zn-cal-compose-card");
    assert.ok(composer, "dropping on a Month cell opens the item composer");
    assert.equal(composer.querySelector('[aria-label="Title"]').value, "Quarterly Roadmap");
    assert.equal(composer.querySelector('[aria-label="Linked note"]').value, note.id);
    assert.equal(composer.querySelector('[aria-label="Start date"]').value, "2026-11-20");
    assert.equal(composer.querySelector('[aria-label="Item type"]').value, "reminder", "kind defaults to reminder");
    assert.equal(composer.querySelector('[aria-label="All-day"]').checked, true, "all-day is checked on Month cells");

    // Switching kind to event in the composer works cleanly with prefilled exclusive endDate.
    const kindSelect = composer.querySelector('[aria-label="Item type"]');
    kindSelect.value = "event"; kindSelect.dispatchEvent(new Ev("change"));
    assert.equal(composer.querySelector('[aria-label="End date (exclusive)"]').value, "2026-11-21");
    kindSelect.value = "reminder"; kindSelect.dispatchEvent(new Ev("change"));

    // Cancel leaves store and note body completely unchanged.
    composer.querySelectorAll("button").find((b) => b.textContent.trim() === "Cancel").click();
    await flush();
    assert.equal(q(root, ".zn-cal-compose-card"), null);
    assert.equal(store.items.list().length, 0, "cancelling composer leaves calendar store unchanged");
    assert.equal(store.get(note.id).body, initialBody, "cancelling composer leaves note body unchanged");
  }

  // 2b. Escape during drag cancels highlight, stays in All notes, and blocks a stray drop.
  {
    const dt = makeDataTransfer();
    treeRow.dispatchEvent(new Ev("dragstart", { bubbles: true, dataTransfer: dt }));
    const monthCell = root.querySelectorAll(".zn-cal-month-cell").find((node) => node.getAttribute("data-day") === "2026-11-21");
    monthCell.dispatchEvent(new Ev("dragover", { bubbles: true, dataTransfer: dt }));
    assert.equal(monthCell.classList.contains("is-note-drop"), true);

    const esc = new Ev("keydown", { key: "Escape", bubbles: true });
    root.dispatchEvent(esc);
    assert.equal(esc.defaultPrevented, true);
    assert.equal(monthCell.classList.contains("is-note-drop"), false, "Escape removes drop highlight");
    assert.equal(q(root, ".zn-cal-drag-preview.is-note-drop"), null);
    assert.equal(q(root, ".zn-all-layout").hidden, false, "Escape during note drag cancels the drag instead of leaving All notes");

    monthCell.dispatchEvent(new Ev("drop", { bubbles: true, dataTransfer: dt }));
    treeRow.dispatchEvent(new Ev("dragend", { bubbles: true, dataTransfer: dt }));
    await flush();
    assert.equal(q(root, ".zn-cal-compose-card"), null, "a canceled drag never opens the composer");
    assert.equal(store.items.list().length, 0);
  }

  const menuItem = (label) => root.querySelectorAll(".zn-menu-item").find((node) => node.textContent.trim().startsWith(label));
  const selectView = async (label) => {
    q(root, ".zn-calendar-view-select").click();
    await flush();
    menuItem(label).click();
    await flush();
  };

  // 2c. Picker mode (OW-09): accepts note drop on .zn-cal-picker-day, shows highlight, prefills all-day reminder.
  {
    paneRect = { left: 400, top: 0, right: 760, bottom: 700, width: 360, height: 700 };
    store.setMeta({ calendarCursor: "2026-11-16" });
    win.dispatchEvent(new Ev("resize"));
    await flush();
    const pickerDay = root.querySelectorAll(".zn-cal-picker-day").find((node) => node.getAttribute("data-day") === "2026-11-22");
    assert.ok(pickerDay, "narrow Month renders picker day buttons");

    const dt = makeDataTransfer();
    treeRow.dispatchEvent(new Ev("dragstart", { bubbles: true, dataTransfer: dt }));
    const over = new Ev("dragover", { bubbles: true, dataTransfer: dt });
    pickerDay.dispatchEvent(over);
    assert.equal(over.defaultPrevented, true, "picker day accepts note dragover");
    assert.equal(pickerDay.classList.contains("is-note-drop"), true);
    assert.equal(q(root, ".zn-cal-drag-preview.is-note-drop")?.textContent, "22-11-2026 · all day");

    pickerDay.dispatchEvent(new Ev("drop", { bubbles: true, dataTransfer: dt }));
    treeRow.dispatchEvent(new Ev("dragend", { bubbles: true, dataTransfer: dt }));
    await flush();

    const composer = q(root, ".zn-cal-compose-card");
    assert.ok(composer, "dropping on picker day opens composer");
    assert.equal(composer.querySelector('[aria-label="Start date"]').value, "2026-11-22");
    assert.equal(composer.querySelector('[aria-label="All-day"]').checked, true);
    assert.equal(composer.querySelector('[aria-label="Linked note"]').value, note.id);
    composer.querySelectorAll("button").find((b) => b.textContent.trim() === "Cancel").click();
    await flush();
    paneRect = { left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 };
    win.dispatchEvent(new Ev("resize"));
    await flush();
  }

  // 2d. Week view: time slot (snapped with calendarSnap & visible hours) AND all-day strip, plus confirming save & mirror rules.
  {
    store.setMeta({
      calendarCursor: "2026-11-16",
      calendarSnap: 30,
      calendarScale: { week: 60 },
      calendarHours: { on: true, startMin: 480, endMin: 1200 }, // 08:00–20:00 at 60px/h
    });
    await selectView("Week");

    const track = root.querySelectorAll(".zn-cal-time-track").find((node) => node.getAttribute("data-day") === "2026-11-18");
    assert.ok(track, "Week view renders Wednesday 2026-11-18 track");
    track.getBoundingClientRect = () => ({ left: 500, top: 100, right: 580, bottom: 820, width: 80, height: 720 });

    const dt = makeDataTransfer();
    treeRow.dispatchEvent(new Ev("dragstart", { bubbles: true, dataTransfer: dt }));
    // clientY = 100 (top) + 3 * 60 + 22 = 302 -> 08:00 + 3h22m = 11:22 -> snaps to 11:30 with 30-min snap!
    const over = new Ev("dragover", { bubbles: true, clientX: 520, clientY: 302, dataTransfer: dt });
    track.dispatchEvent(over);
    assert.equal(over.defaultPrevented, true, "Week time track accepts note dragover");
    assert.equal(track.classList.contains("is-note-drop"), true);
    const preview = q(track, ".zn-cal-drag-preview.is-note-drop");
    assert.ok(preview, "Week time track shows positioned drop highlight");
    assert.equal(preview.style.getPropertyValue("top"), "210px", "preview sits at 11:30 (3.5h * 60px from 08:00)");
    assert.equal(preview.textContent, "18-11-2026 · 11:30");

    track.dispatchEvent(new Ev("drop", { bubbles: true, clientX: 520, clientY: 302, dataTransfer: dt }));
    treeRow.dispatchEvent(new Ev("dragend", { bubbles: true, dataTransfer: dt }));
    await flush();

    const composer = q(root, ".zn-cal-compose-card");
    assert.ok(composer, "dropping on Week time slot opens composer");
    assert.equal(composer.querySelector('[aria-label="Title"]').value, "Quarterly Roadmap");
    assert.equal(composer.querySelector('[aria-label="Linked note"]').value, note.id);
    assert.equal(composer.querySelector('[aria-label="Item type"]').value, "reminder");
    assert.equal(composer.querySelector('[aria-label="All-day"]').checked, false, "timed slot drop is not all-day");
    assert.equal(composer.querySelector('[aria-label="Start date"]').value, "2026-11-18");
    assert.equal(composer.querySelector('[aria-label="Start time"]').value, "11:30");
    assert.equal(composer.querySelector('[aria-label="End time"]').value, "12:30", "switching to Event has a valid +1h end time ready");

    // Confirming creates the linked reminder without mutating the linked user note's body/markers.
    composer.querySelectorAll("button").find((b) => b.textContent.trim() === "Create reminder").click();
    await flush();
    const created = store.items.list({ noteId: note.id, kind: "reminder" });
    assert.equal(created.length, 1, "confirming composer saves the linked reminder");
    assert.equal(created[0].summary, "Quarterly Roadmap");
    assert.equal(cal.clockIn(Date.parse(created[0].start.dateTime)), "11:30");
    assert.equal(store.get(note.id).body, initialBody, "linked note body and hidden markers are never mutated");

    // Week all-day strip drop: opens all-day reminder; if user unlinks the note and confirms, Agenda mirror rule applies.
    const allDayCell = root.querySelectorAll(".zn-cal-time-allday-cell").find((node) => node.getAttribute("data-day") === "2026-11-19");
    assert.ok(allDayCell, "Week all-day strip cell exists");
    const dt2 = makeDataTransfer();
    treeRow.dispatchEvent(new Ev("dragstart", { bubbles: true, dataTransfer: dt2 }));
    const overAllDay = new Ev("dragover", { bubbles: true, dataTransfer: dt2 });
    allDayCell.dispatchEvent(overAllDay);
    assert.equal(overAllDay.defaultPrevented, true);
    assert.equal(allDayCell.classList.contains("is-note-drop"), true);
    assert.equal(q(allDayCell, ".zn-cal-drag-preview.is-note-drop")?.textContent, "19-11-2026 · all day");

    allDayCell.dispatchEvent(new Ev("drop", { bubbles: true, dataTransfer: dt2 }));
    treeRow.dispatchEvent(new Ev("dragend", { bubbles: true, dataTransfer: dt2 }));
    await flush();

    const allDayComposer = q(root, ".zn-cal-compose-card");
    assert.ok(allDayComposer);
    assert.equal(allDayComposer.querySelector('[aria-label="All-day"]').checked, true);
    assert.equal(allDayComposer.querySelector('[aria-label="Start date"]').value, "2026-11-19");
    const noteSelect = allDayComposer.querySelector('[aria-label="Linked note"]');
    noteSelect.value = ""; noteSelect.dispatchEvent(new Ev("change"));
    allDayComposer.querySelectorAll("button").find((b) => b.textContent.trim() === "Create reminder").click();
    await flush();
    const agendaNote = store.list().find((entry) => entry.body.includes("# 2026-11-19"));
    assert.ok(agendaNote && agendaNote.body.includes("Quarterly Roadmap"), "unlinked reminder mirrors to Agenda date note on confirm");

    // Day view time slot drop also computes snapped time and opens composer.
    store.setMeta({ calendarCursor: "2026-11-20", calendarSnap: 15, calendarScale: { week: 60, day: 60 } });
    await selectView("Day");
    const dayTrack = q(root, ".zn-cal-time-track");
    assert.ok(dayTrack && dayTrack.getAttribute("data-day") === "2026-11-20");
    dayTrack.getBoundingClientRect = () => ({ left: 500, top: 100, right: 900, bottom: 820, width: 400, height: 720 });
    const dtDay = makeDataTransfer();
    treeRow.dispatchEvent(new Ev("dragstart", { bubbles: true, dataTransfer: dtDay }));
    dayTrack.dispatchEvent(new Ev("dragover", { bubbles: true, clientX: 600, clientY: 100 + 6 * 60 + 44, dataTransfer: dtDay }));
    assert.equal(q(dayTrack, ".zn-cal-drag-preview.is-note-drop")?.textContent, "20-11-2026 · 14:45");
    dayTrack.dispatchEvent(new Ev("drop", { bubbles: true, clientX: 600, clientY: 100 + 6 * 60 + 44, dataTransfer: dtDay }));
    treeRow.dispatchEvent(new Ev("dragend", { bubbles: true, dataTransfer: dtDay }));
    await flush();
    const dayComposer = q(root, ".zn-cal-compose-card");
    assert.ok(dayComposer, "dropping on Day time slot opens composer");
    assert.equal(dayComposer.querySelector('[aria-label="Start date"]').value, "2026-11-20");
    assert.equal(dayComposer.querySelector('[aria-label="Start time"]').value, "14:45");
    dayComposer.querySelectorAll("button").find((b) => b.textContent.trim() === "Cancel").click();
    await flush();
  }

  // 2e. Foreign drags (without application/x-zentral-note-id) and trashed note IDs are ignored.
  {
    const track = root.querySelectorAll(".zn-cal-time-track")[0];
    const foreignDt = makeDataTransfer();
    foreignDt.setData("text/plain", "https://example.com");
    const foreignOver = new Ev("dragover", { bubbles: true, dataTransfer: foreignDt });
    track.dispatchEvent(foreignOver);
    assert.equal(foreignOver.defaultPrevented, false, "plain text/URL drags are not captured by calendar note drop");
    assert.equal(track.classList.contains("is-note-drop"), false);

    const trashedDt = makeDataTransfer();
    trashedDt.setData(cal.NOTE_DRAG_MIME, trashedNote.id);
    track.dispatchEvent(new Ev("drop", { bubbles: true, dataTransfer: trashedDt }));
    await flush();
    assert.equal(q(root, ".zn-cal-compose-card"), null, "trashed note payload cannot open the composer");
  }

  // ---- OW-80: several selected notes dragged onto one slot ask what the drop should make.
  {
    // This block runs after the OW-81 cases, which leave the calendar in another view: go back to the Month grid.
    root.querySelectorAll(".zn-calendar-view-select").forEach((el) => el.click());
    const monthEntry = root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "Month");
    if (monthEntry) { monthEntry.click(); await flush(); }
    // Two notes, both selected the way the card's tree selects them (Ctrl-click in this docked harness does the same).
    const itemsBefore = store.items.list().length;
    const second = store.create("# Second source note\n\nBody two");
    await flush();
    const rows = () => root.querySelectorAll(".zn-item");
    const firstRow = rows().find((r) => r.getAttribute("data-id") === note.id);
    const secondRow = rows().find((r) => r.getAttribute("data-id") === second.id);
    assert.ok(firstRow && secondRow, "both note rows are on screen");
    firstRow.dispatchEvent(new Ev("click", { bubbles: true, ctrlKey: true }));
    secondRow.dispatchEvent(new Ev("click", { bubbles: true, ctrlKey: true }));
    await flush();
    assert.equal(root.querySelectorAll(".zn-item.is-selected").length, 2, "two rows are selected");

    const day = [...new Set(root.querySelectorAll(".zn-cal-month-cell").map((n) => n.getAttribute("data-day")).filter(Boolean))].sort()[4];
    const dt = makeDataTransfer();
    // Dragging a selected row must carry the selection, not just the pressed row.
    secondRow.dispatchEvent(new Ev("dragstart", { bubbles: true, dataTransfer: dt }));
    const cell = root.querySelectorAll(".zn-cal-month-cell").find((n) => n.getAttribute("data-day") === day);
    cell.dispatchEvent(new Ev("dragover", { bubbles: true, dataTransfer: dt }));
    cell.dispatchEvent(new Ev("drop", { bubbles: true, dataTransfer: dt }));
    secondRow.dispatchEvent(new Ev("dragend", { bubbles: true, dataTransfer: dt }));
    await flush();

    const card = q(root, ".zn-dialog-card");
    assert.ok(card, "a multi-note drop asks before making anything");
    assert.match(card.textContent, /2 notes/, "the card says how many notes it is about");
    assert.match(card.textContent, /Second source note/, "and names them, so the person can see what they picked");
    const buttons = [...card.querySelectorAll("button")].map((b) => b.textContent.trim());
    assert.deepEqual(buttons, ["Cancel", "One item each (2)", "One item for all of them"], "the two shapes a drop onto one day can mean, plus Cancel");
    assert.equal(store.items.list().length, itemsBefore, "nothing is written before the answer");

    // One item for all of them: the composer opens for the first note, with the rest named in its description.
    card.querySelectorAll("button").find((b) => b.textContent.trim() === "One item for all of them").click();
    await flush();
    const composer = q(root, ".zn-cal-compose-card");
    assert.ok(composer, "the shared choice opens the composer");
    assert.match(composer.querySelector('[aria-label="Description"]').value, /Second source note/, "the item says which other note it stands for");
    composer.querySelectorAll("button").find((b) => b.textContent.trim() === "Cancel").click();
    await flush();

    // Cancel wrote nothing.
    assert.equal(store.items.list().length, itemsBefore);
    // Clearing the selection matters: the next block drags a single row, and a stale selection would turn that into a
    // multi-note drop and change what it is testing.
    const clear = q(root, ".zn-batch-clear");
    assert.ok(clear, "the batch bar offers Clear");
    clear.click();
    await flush();
    assert.equal(root.querySelectorAll(".zn-item.is-selected").length, 0, "the selection is empty again");
    store.items.remove(second.id);
    await flush();
  }

  // ---- OW-81: "add settings in quick setting so default it creates events/reminders".
  // The setting is a default for the drop, so it must beat the surface's own habit (an all-day cell is computed as an
  // all-day reminder) — otherwise the option would do nothing on the very surfaces it exists for.
  {
    // This block runs after several view changes: go back to the Month grid, then ask it which days it shows rather
    // than assuming them.
    root.querySelectorAll(".zn-calendar-view-select").forEach((el) => el.click());
    const monthBtn = root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "Month");
    if (monthBtn) { monthBtn.click(); await flush(); }
    const days = () => [...new Set(root.querySelectorAll(".zn-cal-month-cell").map((node) => node.getAttribute("data-day")).filter(Boolean))].sort();
    const shown = days();
    assert.ok(shown.length >= 3, "the Month grid is on screen for the drop-kind cases");
    const dropOn = async (day, value) => {
      store.setMeta({ calendarNoteDropKind: value });
      await flush();
      const dt = makeDataTransfer();
      treeRow.dispatchEvent(new Ev("dragstart", { bubbles: true, dataTransfer: dt }));
      const cell = root.querySelectorAll(".zn-cal-month-cell").find((node) => node.getAttribute("data-day") === day);
      cell.dispatchEvent(new Ev("dragover", { bubbles: true, dataTransfer: dt }));
      cell.dispatchEvent(new Ev("drop", { bubbles: true, dataTransfer: dt }));
      treeRow.dispatchEvent(new Ev("dragend", { bubbles: true, dataTransfer: dt }));
      await flush();
      const composer = q(root, ".zn-cal-compose-card");
      assert.ok(composer, "the drop still opens the composer");
      // Only what the person acts on: the kind, whether it is all-day, and (for an event) the exclusive end date the
      // all-day slot prepared. A reminder's end-date field exists but is hidden, so it is not pinned here.
      const got = {
        kind: composer.querySelector('[aria-label="Item type"]').value,
        allDay: composer.querySelector('[aria-label="All-day"]').checked,
      };
      if (got.kind === "event") got.endDate = composer.querySelector('[aria-label="End date (exclusive)"]').value;
      composer.querySelectorAll("button").find((b) => b.textContent.trim() === "Cancel").click();
      await flush();
      return got;
    };

    // Ask keeps today's behaviour exactly: the Month cell's computed all-day reminder.
    // Days the earlier blocks already proved are on screen in this month grid.
    const itemsBefore = store.items.list().length;
    const [d1, d2, d3] = shown;
    const nextDay = (ymd) => cal.ymd(new Date(cal.parseYmd(ymd).getTime() + 86400000));
    assert.deepEqual(await dropOn(d1, "ask"), { kind: "reminder", allDay: true }, "Ask leaves the slot's own prefill alone");

    // Reminder: a reminder, with no event end date carried over.
    // A reminder's end-date field is hidden rather than absent, so only what the person can act on is pinned here.
    assert.deepEqual(await dropOn(d2, "reminder"), { kind: "reminder", allDay: true }, "Reminder wins over the all-day cell's own prefill");

    // Event: an all-day event, keeping the exclusive end date the all-day slot prepared for exactly this case.
    assert.deepEqual(await dropOn(d3, "event"), { kind: "event", allDay: true, endDate: nextDay(d3) }, "Event wins over the slot");

    store.setMeta({ calendarNoteDropKind: "ask" });
    await flush();
    assert.equal(store.items.list().length, itemsBefore, "no drop wrote an item: the composer was cancelled each time");
  }

  sheet.destroy();
  await store.close();
  console.log("calendar note-drop tests passed");
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
