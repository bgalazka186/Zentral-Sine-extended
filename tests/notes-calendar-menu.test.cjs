"use strict";
/* T2.18: pure per-item menu capabilities and calendar-row right-click/keyboard actions. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const menuLabels = (rows) => rows.filter((row) => row && !row.sep && !row.heading).map((row) => row.label);
const find = (rows, id) => rows.flatMap((row) => row.group ? [row, ...row.group] : [row]).find((row) => row.id === id);

(() => {
  const manualEvent = cal.makeItem({ id: "manual-event", summary: "Manual event", start: { dateTime: "2026-11-12T10:00:00Z" }, end: { dateTime: "2026-11-12T11:00:00Z" }, x: { kind: "event", src: "manual" } }, 0);
  const before = JSON.stringify(manualEvent);
  const eventMenu = cal.calendarItemMenuModel(manualEvent);
  assert.deepEqual(menuLabels(eventMenu), ["Show details", "Edit details…", "Change time…", "Convert to reminder", "Duplicate as independent item", "Delete item…"]);
  for (const id of ["edit", "change-time", "convert", "duplicate", "delete"]) assert.equal(find(eventMenu, id).enabled, true, id + " is available for a manual event");
  assert.equal(JSON.stringify(manualEvent), before, "building a menu never mutates the stored item");

  const linkedEvent = cal.makeItem({ id: "listed-event", summary: "Listed event", start: { date: "2026-11-12" }, end: { date: "2026-11-13" }, x: { kind: "event", src: "list", noteId: "note-1" } }, 0);
  const linkedMenu = cal.calendarItemMenuModel(linkedEvent);
  assert.equal(find(linkedMenu, "open").label, "Open source note");
  assert.equal(find(linkedMenu, "change-time").enabled, true, "a non-recurring calendar-list item can be moved without rewriting its Markdown line");
  assert.equal(find(linkedMenu, "convert").enabled, false, "source-defined item kind cannot be converted in the calendar copy");
  assert.match(find(linkedMenu, "convert").reason, /source text/);
  assert.equal(find(linkedMenu, "delete").enabled, false, "source-derived rows cannot be deleted by removing only their calendar record");
  assert.match(find(linkedMenu, "delete").reason, /source note/);

  const noteReminder = cal.makeItem({ id: "note-reminder", summary: "Front matter reminder", start: { dateTime: "2026-11-12T12:00:00Z" }, x: { kind: "reminder", src: "note", noteId: "note-2" } }, 0);
  const noteMenu = cal.calendarItemMenuModel(noteReminder, { historyWritable: true });
  assert.equal(find(noteMenu, "change-time").enabled, false, "legacy note reminders must be edited in their source note");
  assert.match(find(noteMenu, "change-time").reason, /source note/);
  assert.equal(find(noteMenu, "snooze-1d").enabled, true, "history-enabled non-recurring note reminder may be snoozed by its source-aware action");
  assert.equal(find(noteMenu, "delete").enabled, false);

  const recurring = cal.makeItem({ id: "recurring", summary: "Recurring", start: { dateTime: "2026-11-12T12:00:00Z" }, recurrence: ["RRULE:FREQ=DAILY;COUNT=3"], x: { kind: "reminder", src: "manual" } }, 0);
  const recurringMenu = cal.calendarItemMenuModel(recurring, { state: "done", historyWritable: true });
  assert.equal(find(recurringMenu, "change-time").enabled, false);
  assert.match(find(recurringMenu, "change-time").reason, /expanded recurrence occurrence/);
  const recurringOccurrence = cal.expandItem(recurring, Date.parse("2026-11-12T00:00:00"), Date.parse("2026-11-16T00:00:00")).find((item) => item.x?.recurrenceId);
  assert.equal(find(cal.calendarItemMenuModel(recurringOccurrence, { historyWritable: true }), "change-time").enabled, true, "expanded recurring occurrences offer an explicit scope choice");
  assert.equal(find(recurringMenu, "snooze-3d").enabled, false);
  assert.equal(find(recurringMenu, "mark-done").enabled, false, "already-done lifecycle actions are disabled");
  assert.equal(find(recurringMenu, "reopen").enabled, true);
  assert.equal(find(recurringMenu, "convert").enabled, true, "manual recurring series may be converted as a whole");

  const locked = cal.calendarItemMenuModel(noteReminder, { state: "dismissed", historyWritable: false });
  assert.equal(find(locked, "dismiss").enabled, false);
  assert.match(find(locked, "dismiss").reason, /history storage/);
  assert.equal(find(locked, "snooze-custom").enabled, false);
  assert.deepEqual(cal.calendarItemMenuModel(null), []);
  assert.deepEqual(cal.calendarItemMenuModel({ summary: "Missing stable id" }), []);
  console.log("calendar menu pure tests passed");
})();

// Integration test: the actual Notes sheet controller, menu engine and calendar store.
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
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" } });
const core = win.__zentralNotesTestSeam.core;
const flush = async () => { for (let i = 0; i < 6; i++) { raf.splice(0).forEach((fn) => fn()); await new Promise((resolve) => setImmediate(resolve)); } };
const files = new Map();
const io = {
  join: (...parts) => parts.join("/"), filename: (value) => value.split("/").pop(),
  readUTF8: async (value) => { if (!files.has(value)) throw new Error("not found"); return files.get(value).text; },
  writeUTF8: async (value, text) => files.set(value, { text, mtime: Date.now() }),
  remove: async (value) => files.delete(value), exists: async (value) => files.has(value),
  children: async (dir) => [...files.keys()].filter((value) => value.startsWith(dir + "/") && !value.slice(dir.length + 1).includes("/")),
  stat: async (value) => ({ lastModified: files.get(value)?.mtime || 0 }), restrict: async () => {},
};
const store = core.createStore({ io, notify() {}, windowId: "calendar-menu-ui", getDir: async () => "/calendar-menu", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
const host = new El("div");
const adapter = { position: "fixed", host, attach: (root) => host.append(root), getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }), watch: () => () => {}, setActive() {}, rewatch() {} };
const prefs = new Map();
const env = { getPref: (key, fallback) => prefs.has(key) ? prefs.get(key) : fallback, setPref: (key, value) => prefs.set(key, value), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
const q = (root, selector) => root.querySelector(selector);
const menuItem = (root, label) => root.querySelectorAll(".zn-menu-item").find((node) => node.textContent.trim().startsWith(label));
const openRowMenu = (root, itemId, key = "contextmenu") => {
  const current = store.items.get(itemId);
  const button = root.querySelectorAll(".zn-cal-item").find((node) => current && node.textContent.includes(current.summary));
  assert.ok(button, `calendar row exists for ${itemId}`);
  const event = new Ev(key, { bubbles: true, key: key === "keydown" ? "ContextMenu" : undefined, clientX: 72, clientY: 84 });
  button.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, "native context menu and its keyboard equivalent are prevented");
  assert.ok(q(root, ".zn-menu"), "shared menu opens on the calendar item");
  return button;
};

(async () => {
  await store.open();
  const note = store.create("# Source note\n\n## Work\nDetails");
  const day = cal.dayStart(Date.now()), dayKey = cal.ymd(new Date(day));
  const tomorrowKey = cal.ymd(new Date(cal.addDays(day, 1)));
  store.items.upsert({ id: "menu-manual-event", summary: "Standalone review", start: { dateTime: new Date(day + 15 * 3600000).toISOString() }, end: { dateTime: new Date(day + 16 * 3600000).toISOString() }, x: { kind: "event", src: "manual" } });
  store.items.upsert({ id: "menu-listed-event", summary: "Source-defined event", start: { date: dayKey }, end: { date: tomorrowKey }, x: { kind: "event", src: "note", noteId: note.id } });
  store.items.upsert({ id: "menu-recurring-reminder", summary: "Recurring reminder", start: { dateTime: new Date(day + 17 * 3600000).toISOString() }, recurrence: ["RRULE:FREQ=DAILY;COUNT=2"], x: { kind: "reminder", src: "manual" } });
  await store.flush();
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root; root.ownerDocument = document;
  q(root, ".zn-all-layout").getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  q(root, ".zn-all-panels").getBoundingClientRect = q(root, ".zn-all-layout").getBoundingClientRect;
  q(root, ".zn-calendar-pane").getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await sheet.open(); await flush();
  root.all().find((el) => el.title === "All notes").click(); await flush();

  // Month marks share the exact item menu model and keyboard contract, for events as well as reminders.
  const monthMark = root.querySelectorAll(".zn-cal-month-mark").find((node) => node.textContent.trim() === "Standalone review");
  assert.ok(monthMark, "month grid renders the standalone event mark");
  const monthContext = new Ev("contextmenu", { bubbles: true, clientX: 60, clientY: 70 });
  monthMark.dispatchEvent(monthContext);
  assert.equal(monthContext.defaultPrevented, true);
  assert.ok(menuItem(root, "Change time…"), "month item mark exposes the common item actions");
  const closeMonthMenu = new Ev("keydown", { key: "Escape", bubbles: true });
  monthMark.dispatchEvent(closeMonthMenu);
  assert.equal(q(root, ".zn-menu"), null, "Escape closes the month mark menu");
  const monthKeyboard = new Ev("keydown", { key: "F10", shiftKey: true, bubbles: true });
  monthMark.dispatchEvent(monthKeyboard);
  assert.equal(monthKeyboard.defaultPrevented, true);
  assert.ok(menuItem(root, "Convert to reminder"), "Shift+F10 opens the same month mark actions");
  root.querySelectorAll(".zn-menu-item").find((node) => node.textContent.trim() === "Show details").click();
  await flush();

  q(root, ".zn-calendar-view-select").click();
  menuItem(root, "Agenda").click(); await flush();

  openRowMenu(root, "menu-manual-event");
  for (const label of ["Show details", "Edit details…", "Change time…", "Convert to reminder", "Duplicate as independent item", "Delete item…"]) assert.ok(menuItem(root, label), `manual event menu includes ${label}`);
  menuItem(root, "Change time…").click(); await flush();
  const dateInput = q(root, '[aria-label="New date (YYYY-MM-DD)"]');
  assert.ok(dateInput, "change-time dialog exposes a validated date field");
  dateInput.value = tomorrowKey;
  root.querySelectorAll(".zn-dialog-card button").find((node) => node.textContent.trim() === "Save new time").click(); await flush();
  assert.equal(cal.localDateKey(cal.itemRange(store.items.get("menu-manual-event"))[0]), tomorrowKey, "rescheduling changes the stored local date");

  openRowMenu(root, "menu-manual-event");
  menuItem(root, "Convert to reminder").click(); await flush();
  assert.equal(store.items.get("menu-manual-event").x.kind, "reminder");
  assert.equal(store.items.get("menu-manual-event").end, undefined, "reminder conversion removes the event end");

  openRowMenu(root, "menu-manual-event");
  menuItem(root, "Duplicate as independent item").click(); await flush();
  const copy = store.items.list().find((item) => item.summary === "Standalone review (copy)");
  assert.ok(copy, "duplicate action stores a separate item");
  assert.equal(copy.x.src, "manual");
  assert.equal(copy.x.noteId, "", "duplicate is independent of the source note");

  openRowMenu(root, copy.id);
  menuItem(root, "Delete item…").click(); await flush();
  assert.ok(q(root, '.zn-dialog-card[aria-label="Delete calendar item?"]'), "delete is confirmed rather than immediate");
  root.querySelectorAll(".zn-dialog-card button").find((node) => node.textContent.trim() === "Cancel").click(); await flush();
  assert.ok(store.items.get(copy.id), "cancel leaves the item intact");
  const staleCopyButton = openRowMenu(root, copy.id);
  menuItem(root, "Delete item…").click(); await flush();
  root.querySelectorAll(".zn-dialog-card button").find((node) => node.textContent.trim() === "Delete item").click(); await flush();
  assert.equal(store.items.get(copy.id), null, "confirmed delete removes only the independent calendar item");
  staleCopyButton.dispatchEvent(new Ev("contextmenu", { bubbles: true, clientX: 90, clientY: 90 }));
  assert.equal(q(root, ".zn-menu"), null, "a detached row cannot open a stale menu after its item is removed");

  openRowMenu(root, "menu-listed-event");
  const convert = menuItem(root, "Convert to reminder"), remove = menuItem(root, "Delete item…");
  assert.ok(convert && convert.disabled, "source-defined type conversion is visible but disabled");
  assert.ok(remove && remove.disabled, "source-derived deletion is visible but disabled");
  assert.match(convert.textContent, /source text/);
  assert.match(remove.textContent, /source note/);

  // Shift+F10 opens the same action model. Recurring moves require an explicit occurrence scope.
  openRowMenu(root, "menu-recurring-reminder", "keydown");
  const moveRecurring = menuItem(root, "Change occurrence time…");
  assert.ok(moveRecurring && !moveRecurring.disabled);
  moveRecurring.click(); await flush();
  const recurrenceScope = q(root, '[aria-label="Apply time change to"]');
  assert.ok(recurrenceScope, "recurring reschedule asks which scope the user intends");
  assert.deepEqual(recurrenceScope.querySelectorAll("option").map((option) => option.getAttribute("value")), ["this", "following", "series"]);
  recurrenceScope.value = "this";
  const recurringDateInput = q(root, '[aria-label="New date (YYYY-MM-DD)"]');
  const targetOccurrenceDate = cal.ymd(new Date(cal.addDays(day, 2)));
  const originalMaster = store.items.get("menu-recurring-reminder");
  const originalFirst = cal.expandItem(originalMaster, day, cal.addDays(day, 4))[0];
  recurringDateInput.value = targetOccurrenceDate;
  root.querySelectorAll(".zn-dialog-card button").find((node) => node.textContent.trim() === "Save new time").click(); await flush();
  const movedMaster = store.items.get("menu-recurring-reminder");
  assert.equal(movedMaster.x.recurrenceExceptions.length, 1);
  assert.equal(movedMaster.x.recurrenceExceptions[0].scope, "this");
  const afterOccurrences = cal.expandItem(movedMaster, day, cal.addDays(day, 5));
  assert.equal(afterOccurrences.find((item) => item.x.recurrenceId === originalFirst.x.recurrenceId).start.dateTime
    ? cal.localDateKey(Date.parse(afterOccurrences.find((item) => item.x.recurrenceId === originalFirst.x.recurrenceId).start.dateTime))
    : afterOccurrences.find((item) => item.x.recurrenceId === originalFirst.x.recurrenceId).start.date, targetOccurrenceDate);
  assert.equal(afterOccurrences.find((item) => item.x.recurrenceId !== originalFirst.x.recurrenceId).x.recurrenceId, String(originalFirst.x.recurrenceId === "" ? 0 : Number(originalFirst.x.recurrenceId) + 86400000));
  // Reopen the row menu after rendering; snooze remains separate from recurrence move semantics.
  openRowMenu(root, "menu-recurring-reminder", "keydown");
  menuItem(root, "Snooze").click(); await flush();
  const snoozeRecurring = menuItem(root, "Snooze +1 day");
  assert.ok(snoozeRecurring?.disabled);
  assert.match(snoozeRecurring.textContent, /exception support/);
  const escape = new Ev("keydown", { key: "Escape", bubbles: true });
  snoozeRecurring.dispatchEvent(escape);
  assert.equal(q(root, ".zn-menu"), null, "Escape dismisses the nested context menu");

  // T2.3f: all four creation modes use the same full composer and its shared Clock/date controls.
  store.items.upsertCategory({ name: "Work", color: "#abcdef" });
  const openCreate = async (label) => {
    q(root, ".zn-calendar-tools").click(); await flush();
    const entry = menuItem(root, label);
    assert.ok(entry, `Calendar Tools offers ${label}`);
    entry.click(); await flush();
    const card = q(root, ".zn-cal-compose-card");
    assert.ok(card, `${label} opens the full calendar composer`);
    for (const name of ["Title", "Start date", "Linked note", "Calendar category", "Description", "Calendar note", "Time zone (IANA; blank = local)", "Repeat frequency"]) {
      assert.ok(card.querySelector(`[aria-label="${name}"]`), `composer includes ${name}`);
    }
    return card;
  };
  const createFrom = async (label, titleText, expectedKind, expectedAllDay, configure = null) => {
    const card = await openCreate(label);
    const titleInput = card.querySelector('[aria-label="Title"]');
    if (expectedKind === "event") assert.equal(titleInput.value, "Event", "a new event starts with an event-appropriate independent title");
    else assert.equal(titleInput.value, "Reminder", "a new reminder starts with a reminder-appropriate independent title");
    titleInput.value = titleText;
    const typeInput = card.querySelector('[aria-label="Item type"]');
    const allDayInput = card.querySelector('[aria-label="All-day"]');
    assert.equal(typeInput.value, expectedKind);
    assert.equal(allDayInput.checked, expectedAllDay);
    if (label === "Create all-day event…") {
      const endDate = card.querySelector('[aria-label="End date (exclusive)"]');
      assert.equal(endDate.value, tomorrowKey, "all-day event defaults to an exclusive next-day end");
    }
    if (configure) configure(card);
    if (label === "Create timed event…") {
      card.querySelectorAll("button").find((button) => button.textContent.trim() === "Clock…").click();
      const clocks = card.querySelectorAll(".zn-cal-clock-set");
      assert.equal(clocks.length, 2, "timed event uses one shared Clock with start and end sets");
      const startHour = clocks[0].querySelector(".zn-cal-clock-hour"), startMinute = clocks[0].querySelector(".zn-cal-clock-minute");
      const endHour = clocks[1].querySelector(".zn-cal-clock-hour"), endMinute = clocks[1].querySelector(".zn-cal-clock-minute");
      startHour.value = "11"; startHour.dispatchEvent(new Ev("change"));
      startMinute.value = "30"; startMinute.dispatchEvent(new Ev("change"));
      endHour.value = "12"; endHour.dispatchEvent(new Ev("change"));
      endMinute.value = "45"; endMinute.dispatchEvent(new Ev("change"));
      assert.equal(card.querySelector('[aria-label="Start time"]').value, "11:30");
      assert.equal(card.querySelector('[aria-label="End time"]').value, "12:45");
    }
    const saveLabel = expectedKind === "event" ? "Create event" : "Create reminder";
    card.querySelectorAll("button").find((button) => button.textContent.trim() === saveLabel).click();
    await flush();
    const item = store.items.list().find((entry) => entry.summary === titleText);
    assert.ok(item, `${titleText} is saved`);
    assert.equal(item.x.kind, expectedKind);
    if (expectedAllDay) {
      assert.deepEqual(item.start, { date: dayKey });
      if (expectedKind === "reminder") assert.equal(item.end, undefined, "all-day reminder has no end");
      else assert.deepEqual(item.end, { date: tomorrowKey }, "all-day event stores its exclusive end");
    } else {
      assert.ok(item.start.dateTime);
      if (expectedKind === "reminder") assert.equal(item.end, undefined, "timed reminder has no end");
      else {
        assert.ok(item.end.dateTime);
        assert.ok(Date.parse(item.end.dateTime) > Date.parse(item.start.dateTime));
      }
    }
    return item;
  };
  const fullDayReminder = await createFrom("Create all-day reminder…", "Full-day reminder", "reminder", true);
  const fullDayEvent = await createFrom("Create all-day event…", "Full-day event", "event", true);
  const timedReminder = await createFrom("Create timed reminder…", "Timed reminder", "reminder", false, (card) => {
    const category = card.querySelector('[aria-label="Calendar category"]'); category.value = "Work"; category.dispatchEvent(new Ev("change"));
    card.querySelector('[aria-label="Description"]').value = "A focused description";
    card.querySelector('[aria-label="Calendar note"]').value = "Calendar-only note";
    const zone = card.querySelector('[aria-label="Time zone (IANA; blank = local)"]'); zone.value = "Europe/Warsaw"; zone.dispatchEvent(new Ev("input"));
    const frequency = card.querySelector('[aria-label="Repeat frequency"]'); frequency.value = "WEEKLY"; frequency.dispatchEvent(new Ev("change"));
    card.querySelector('[aria-label="Repeat interval"]').value = "2";
    for (const weekday of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) card.querySelector(`[aria-label="${weekday}"]`).checked = false;
    card.querySelector('[aria-label="Mon"]').checked = true;
    card.querySelector('[aria-label="Fri"]').checked = true;
    const ending = card.querySelector('[aria-label="Repeat ending"]'); ending.value = "count"; ending.dispatchEvent(new Ev("change"));
    card.querySelector('[aria-label="Repeat occurrence count"]').value = "4";
    card.querySelector('[aria-label="Tier 1 · Gentle pre-alert"]').checked = true;
    card.querySelector('[aria-label="Tier 2 · At due time"]').checked = false;
    card.querySelector('[aria-label="Tier 3 · Follow-up banner"]').checked = true;
    card.querySelector('[aria-label="Pre-alert lead time"]').value = "7";
    card.querySelector('[aria-label="Follow-up delay"]').value = "15";
  });
  const timedEvent = await createFrom("Create timed event…", "Timed event", "event", false);
  assert.equal(fullDayReminder.x.noteId, "", "standalone creation does not accidentally link the open note");
  assert.equal(timedReminder.x.category, "Work");
  assert.equal(timedReminder.description, "A focused description");
  assert.equal(timedReminder.x.calNote, "Calendar-only note");
  assert.equal(timedReminder.x.tz, "Europe/Warsaw");
  assert.equal(timedReminder.recurrence.join("|"), "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=4");
  assert.equal(JSON.stringify(timedReminder.x.notify), JSON.stringify({ pre: { enabled: true, leadMinutes: 7 }, due: { enabled: false }, followup: { enabled: true, delayMinutes: 15 } }));

  // Existing item edit uses the same composer and preserves identity while changing independent fields.
  openRowMenu(root, timedEvent.id);
  menuItem(root, "Edit details…").click(); await flush();
  const editCard = q(root, ".zn-cal-compose-card");
  assert.ok(editCard);
  assert.equal(editCard.querySelector('[aria-label="Title"]').value, "Timed event");
  editCard.querySelector('[aria-label="Title"]').value = "Edited timed event";
  const saveEdit = editCard.querySelectorAll("button").find((button) => button.textContent.trim() === "Save calendar item");
  assert.ok(saveEdit, "edit composer exposes its save action");
  saveEdit.click(); await flush();
  assert.equal(store.items.get(timedEvent.id).summary, "Edited timed event");
  assert.equal(store.items.get(timedEvent.id).id, timedEvent.id, "editing keeps the calendar item identity stable");

  // T2.3g: linked note color overrides category color live; an uncoloured note falls back to its category.
  const colorDate = cal.ymd(new Date(cal.addDays(day, 5)));
  const linkedReminder = store.items.upsert({ id: "menu-linked-color", summary: "Linked color reminder", start: { date: colorDate }, x: { kind: "reminder", src: "manual", noteId: note.id, category: "Work" } });
  const linkedReminderTwo = store.items.upsert({ id: "menu-linked-color-two", summary: "Linked color reminder two", start: { date: cal.ymd(new Date(cal.addDays(cal.parseYmd(colorDate).getTime(), 1))) }, x: { kind: "reminder", src: "manual", noteId: note.id, category: "Work" } });
  assert.ok(linkedReminder && linkedReminderTwo);
  store.setMeta({ calendarCursor: colorDate });
  store.setColor(note.id, "none"); await flush();
  q(root, ".zn-calendar-view-select").click(); menuItem(root, "Month").click(); await flush();
  let colorMarks = root.querySelectorAll(".zn-cal-month-mark").filter((node) => node.textContent.includes("Linked color reminder"));
  assert.equal(colorMarks.length, 2, "multiple reminders on one note are both visible in their own day cells");
  assert.ok(colorMarks.every((node) => node.style.getPropertyValue("--zn-cal-item-color") === "#abcdef"), "category color is the fallback for every reminder without a note color");
  store.setColor(note.id, "#123456"); await flush();
  colorMarks = root.querySelectorAll(".zn-cal-month-mark").filter((node) => node.textContent.includes("Linked color reminder"));
  assert.ok(colorMarks.every((node) => node.style.getPropertyValue("--zn-cal-item-color") === "#123456"), "source note recoloring updates every linked reminder and overrides category color");

  // T2.3h: shortcut is a visible, configurable keyboard-focusable toolbar button and resolves exact matches.
  const quickReminder = q(root, ".zn-quick-reminder");
  assert.ok(quickReminder && !quickReminder.hidden, "Create reminder shortcut is visible when calendar storage exists");
  assert.equal(quickReminder.tag, "button", "the shortcut is a native keyboard-focusable button");
  const shortcutDate = "2026-11-21";
  store.items.upsert({ id: "shortcut-match-one", summary: "Existing reminder one", start: { date: shortcutDate }, x: { kind: "reminder", src: "manual", noteId: note.id } });
  await sheet.openNoteById(note.id); await flush();
  const editor = q(root, ".zn-editor");
  editor.value = "# Source note\n\n2026-11-21 Send the release checklist to the team";
  const selectedSentence = "2026-11-21 Send the release checklist to the team";
  const selectedStart = editor.value.indexOf(selectedSentence);
  editor.setSelectionRange(selectedStart, selectedStart + selectedSentence.length);
  quickReminder.click(); await flush();
  const exactEdit = q(root, ".zn-cal-compose-card");
  assert.ok(exactEdit, "a single matching reminder opens directly in edit mode");
  assert.equal(exactEdit.querySelector('[aria-label="Title"]').value, "Existing reminder one");
  exactEdit.querySelector('[aria-label="Title"]').value = "Edited exact match";
  exactEdit.querySelectorAll("button").find((button) => button.textContent.trim() === "Save calendar item").click(); await flush();
  assert.equal(store.items.get("shortcut-match-one").summary, "Edited exact match");

  store.items.upsert({ id: "shortcut-match-two", summary: "Existing reminder two", start: { date: shortcutDate }, x: { kind: "reminder", src: "manual", noteId: note.id } });
  editor.setSelectionRange(selectedStart, selectedStart + selectedSentence.length);
  quickReminder.click(); await flush();
  const chooser = q(root, ".zn-cal-reminder-choices");
  assert.ok(chooser, "multiple same-day reminders require an explicit exact-item choice");
  const chooseTwo = chooser.querySelectorAll("button").find((button) => button.textContent.includes("Existing reminder two"));
  assert.ok(chooseTwo);
  chooseTwo.click(); await flush();
  assert.equal(q(root, '.zn-cal-compose-card [aria-label="Title"]').value, "Existing reminder two", "the selected exact reminder opens, not the first item");
  q(root, ".zn-cal-compose-card").querySelectorAll("button").find((button) => button.textContent.trim() === "Cancel").click(); await flush();
  editor.setSelectionRange(selectedStart, selectedStart + selectedSentence.length);
  quickReminder.click(); await flush();
  const chooserAgain = q(root, ".zn-cal-reminder-choices");
  q(root, ".zn-dialog-card").querySelectorAll("button").find((button) => button.textContent.trim() === "Create another reminder on this date").click(); await flush();
  const explicitlyNew = q(root, ".zn-cal-compose-card");
  assert.equal(explicitlyNew.querySelector('[aria-label="Start date"]').value, shortcutDate);
  assert.equal(explicitlyNew.querySelector('[aria-label="Title"]').value, "Send the release checklist to the team");
  explicitlyNew.querySelectorAll("button").find((button) => button.textContent.trim() === "Create reminder").click(); await flush();
  assert.ok(store.items.list({ noteId: note.id, kind: "reminder" }).some((item) => item.summary === "Send the release checklist to the team" && item.start.dateTime), "creating another is an explicit action and keeps the captured sentence title");

  // A recognised date with no existing item seeds the complete composer without silently linking over another reminder.
  editor.value = "# Source note\n\n2026-11-22 Publish the project update";
  const newSentence = "2026-11-22 Publish the project update", newStart = editor.value.indexOf(newSentence);
  editor.setSelectionRange(newStart, newStart + newSentence.length);
  quickReminder.click(); await flush();
  const dateSeeded = q(root, ".zn-cal-compose-card");
  assert.equal(dateSeeded.querySelector('[aria-label="Start date"]').value, "2026-11-22");
  assert.equal(dateSeeded.querySelector('[aria-label="Title"]').value, "Publish the project update");
  dateSeeded.querySelectorAll("button").find((button) => button.textContent.trim() === "Cancel").click(); await flush();

  // With no date selected, the shortcut still opens the full composer and chooses a useful title.
  editor.value = "# Source note\n\nOrdinary note text";
  editor.setSelectionRange(editor.value.length, editor.value.length);
  quickReminder.click(); await flush();
  const noDateComposer = q(root, ".zn-cal-compose-card");
  assert.ok(noDateComposer);
  assert.equal(noDateComposer.querySelector('[aria-label="Title"]').value, "Ordinary note text", "no-date cursor context seeds a useful title instead of a blank or generic title");
  noDateComposer.querySelectorAll("button").find((button) => button.textContent.trim() === "Cancel").click(); await flush();

  // The shortcut can be assigned in Keyboard shortcuts and hidden through Toolbar buttons.
  prefs.set(core.PREF.SHORTCUTS, JSON.stringify({ calendarReminder: "Ctrl+Shift+R" }));
  editor.dispatchEvent(new Ev("keydown", { key: "R", ctrlKey: true, shiftKey: true, bubbles: true })); await flush();
  assert.ok(q(root, ".zn-cal-compose-card"), "configured Ctrl+Shift+R invokes Create reminder from the editor");
  q(root, ".zn-cal-compose-card").querySelectorAll("button").find((button) => button.textContent.trim() === "Cancel").click(); await flush();
  prefs.set(core.PREF.HIDDEN_TOOLS, "calendarReminder");
  await sheet.openNoteById(note.id); await flush();
  assert.equal(quickReminder.hidden, true, "toolbar visibility settings can hide the reminder shortcut");
  editor.dispatchEvent(new Ev("keydown", { key: "R", ctrlKey: true, shiftKey: true, bubbles: true })); await flush();
  assert.equal(q(root, ".zn-cal-compose-card"), null, "hiding the toolbar action also disables its configured keyboard shortcut");
  prefs.set(core.PREF.HIDDEN_TOOLS, "");
  await sheet.openNoteById(note.id); await flush();
  assert.equal(quickReminder.hidden, false, "clearing toolbar visibility settings restores the shortcut");

  sheet.destroy(); await store.close();
  console.log("calendar menu UI tests passed");
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
