"use strict";
/* T2.4b: month, upcoming-days and Agenda views, filters, category colours, all-day strip and source-note navigation. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
assert.match(css, /--zn-panel:\s*var\(--zn-surface\)/, "calendar panel backgrounds always resolve to an opaque sheet surface");
assert.match(css, /\.zn-cal-time-columns\s*\{[^}]*grid-column:\s*2\s*\/\s*-1/s, "the nested day grid spans all tracks after the time gutter");
assert.match(css, /\.zn-cal-now-line/);
assert.match(css, /\.zn-cal-time-event\s*\{[^}]*var\(--zn-surface\)/s, "timed event text uses an opaque surface mix");
// All three day-column grids use the same native scrollbar reservation, even
// when one row does not currently overflow. Overlay scrollbars reserve zero.
for (const selector of ["zn-cal-time-head", "zn-cal-time-allday-row", "zn-cal-time-scroll"]) {
  const match = css.match(new RegExp("^\\.zentral-notes-sheet \\." + selector + " \\{([^}]*)\\}", "m"));
  assert.ok(match, `dedicated rule for ${selector}`);
  assert.match(match[1], /scrollbar-gutter:\s*stable/, `${selector} reserves a matching gutter`);
  assert.match(match[1], /scrollbar-width:\s*thin/, `${selector} uses the same native scrollbar width`);
  assert.match(match[1], selector === "zn-cal-time-head" ? /overflow:\s*hidden/ : /overflow:\s*auto/, `${selector} preserves its intended scrolling behavior`);
}
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
assert.equal(cal.cleanCalendarDensity("invalid"), "comfortable");
assert.deepEqual(["comfortable", "compact", "extra-compact"].map(cal.calendarDensityHourHeight), [54, 44, 36]);
assert.match(css, /data-density="compact"/);
assert.match(css, /data-density="extra-compact"/);
assert.match(css, /height:\s*var\(--zn-cal-hour-height/);
const win = { __zentralNotesParts: { "notes-calendar": cal }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
win.window = win;
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" } });
const c = win.__zentralNotesTestSeam.core;
const flushRaf = async () => { for (let i = 0; i < 5; i++) { raf.splice(0).forEach((fn) => fn()); await new Promise((r) => setImmediate(r)); } };
const files = new Map();
const io = {
  join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
  readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf " + p); return files.get(p).text; },
  writeUTF8: async (p, text) => files.set(p, { text, mtime: Date.now() }),
  remove: async (p) => files.delete(p), exists: async (p) => files.has(p),
  children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/")),
  stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }), restrict: async () => {},
};
const store = c.createStore({ io, notify() {}, windowId: "cal-views", getDir: async () => "/views", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
const host = new El("div");
const adapter = { position: "fixed", host, attach: (root) => host.append(root), getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }), watch: () => () => {}, setActive() {}, rewatch() {} };
const prefs = new Map();
const weekExports = [], weekPrints = [], copiedText = [];
const env = { getPref: (k, d) => prefs.has(k) ? prefs.get(k) : d, setPref: (k, v) => prefs.set(k, v), openLink() {}, copyText(text) { copiedText.push(text); }, exportNote() {}, exportAll() {}, exportCalendarWeek: async (text, week) => { weekExports.push({ text, week }); return true; }, printCalendarWeek: async (text, week) => { weekPrints.push({ text, week }); return true; }, revealFolder() {} };
const q = (root, selector) => root.querySelector(selector);
const chooseMenu = async (root, triggerSelector, label) => {
  q(root, triggerSelector).click();
  const entry = root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === label);
  assert.ok(entry, `menu option exists: ${label}`);
  entry.click();
  await flushRaf();
};

(async () => {
  await store.open();
  const note = store.create("# Calendar source\n\n## Tasks\nSource note content");
  const now = Date.now(), day = cal.dayStart(now), ymd = cal.ymd(new Date(day));
  const tomorrow = cal.addDays(day, 1), tomorrowYmd = cal.ymd(new Date(tomorrow));
  store.items.upsertCategory({ name: "Projects", color: "#4a90e2" });
  store.items.upsertCategory({ name: "Personal", color: "#d36aa6" });
  const reminderAt = day + 13 * 3600000 + 15 * 60000;
  const reminder = store.items.upsert({ id: "view-reminder", summary: "Call Alice", start: { dateTime: new Date(reminderAt).toISOString() }, description: "Call Alice about the release plan", x: { kind: "reminder", noteId: note.id, heading: "Tasks", category: "Projects", tz: "Europe/Warsaw", calNote: "Bring the project notes\nReview the open questions" } });
  const eventStart = day + 15 * 3600000, eventEnd = day + 16 * 3600000;
  store.items.upsert({ id: "view-event", summary: "Project review", start: { dateTime: new Date(eventStart).toISOString() }, end: { dateTime: new Date(eventEnd).toISOString() }, x: { kind: "event", noteId: note.id, heading: "Tasks", category: "Projects" } });
  store.items.upsert({ id: "view-event-overlap", summary: "Design review", start: { dateTime: new Date(day + 15.5 * 3600000).toISOString() }, end: { dateTime: new Date(day + 16.5 * 3600000).toISOString() }, x: { kind: "event", noteId: note.id, heading: "Tasks", category: "Projects" } });
  store.items.upsert({ id: "view-reminder-overlap", summary: "Second call", start: { dateTime: new Date(reminderAt + 60000).toISOString() }, x: { kind: "reminder", noteId: note.id, heading: "Tasks", category: "Projects" } });
  store.items.upsert({ id: "view-event-reminder-overlap", summary: "Reminder-time event", start: { dateTime: new Date(reminderAt + 15 * 60000).toISOString() }, end: { dateTime: new Date(reminderAt + 45 * 60000).toISOString() }, x: { kind: "event", noteId: note.id, heading: "Tasks", category: "Projects" } });
  store.items.upsert({ id: "view-allday", summary: "Focus day", start: { date: ymd }, end: { date: tomorrowYmd }, x: { kind: "event", noteId: note.id, heading: "Tasks", category: "Personal" } });
  store.items.upsert({ id: "view-recurring", summary: "Daily check-in", start: { date: tomorrowYmd }, recurrence: ["RRULE:FREQ=DAILY;COUNT=3"], x: { kind: "reminder", noteId: note.id, heading: "Tasks", category: "Personal" } });

  await store.flush();
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root; root.ownerDocument = document;
  const layout = q(root, ".zn-all-layout"), panels = q(root, ".zn-all-panels"), calendarPane = q(root, ".zn-calendar-pane"), content = q(root, ".zn-calendar-view");
  layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
  panels.getBoundingClientRect = layout.getBoundingClientRect;
  calendarPane.getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await sheet.open(); await flushRaf();
  assert.equal(typeof sheet.newAgendaDayItem, "function");
  for (const kind of ["reminder", "event"]) {
    assert.equal(sheet.newAgendaDayItem(tomorrowYmd, kind), true);
    const card = q(root, ".zn-cal-compose-card"); assert.ok(card, `${kind} opens the composer`);
    assert.equal(q(card, ".zn-cal-compose-kind").value, kind);
    assert.ok(card.querySelectorAll("input").some((input) => input.value === tomorrowYmd), "the selected Agenda day is prefilled");
    assert.equal(card.querySelector('[aria-label="Linked note"]').value, "", "sidebar day actions do not link an unrelated active note");
    card.querySelectorAll("button").find((button) => button.textContent.trim() === "Cancel").click();
  }
  assert.equal(sheet.newAgendaDayItem("2026-02-30", "event"), false);
  assert.equal(sheet.newAgendaDayItem(tomorrowYmd, "wrong"), false);
  root.all().find((el) => el.title === "All notes").click(); await flushRaf();

  let monthCell = root.querySelectorAll(".zn-cal-month-cell").find((cell) => cell.getAttribute("data-day") === tomorrowYmd);
  assert.ok(monthCell, "tomorrow is in the month grid");
  monthCell.dispatchEvent(new Ev("click", { bubbles: true }));
  assert.equal(store.meta.calendarView, "day", "clicking the day cell, not only its number, opens Day view");
  assert.equal(store.meta.calendarCursor, tomorrowYmd);
  await chooseMenu(root, ".zn-calendar-view-select", "Month");
  monthCell = root.querySelectorAll(".zn-cal-month-cell").find((cell) => cell.getAttribute("data-day") === ymd);
  assert.equal(monthCell.getAttribute("tabindex"), "0", "a day cell supports keyboard navigation");
  const countBeforeCancel = store.list().length, itemsBeforeCancel = store.items.list().length;
  const contextKey = new Ev("keydown", { key: "F10", shiftKey: true, bubbles: true });
  monthCell.dispatchEvent(contextKey);
  assert.equal(contextKey.defaultPrevented, true);
  assert.ok(root.querySelectorAll(".zn-menu-item").some((item) => item.textContent.includes("New event")), "keyboard day context menu exposes creation actions");
  monthCell.dispatchEvent(new Ev("keydown", { key: "Escape", bubbles: true }));
  assert.equal(store.list().length, countBeforeCancel); assert.equal(store.items.list().length, itemsBeforeCancel, "cancelled day menus do not create notes or items");
  monthCell.dispatchEvent(new Ev("keydown", { key: "Enter", bubbles: true }));
  assert.equal(store.meta.calendarView, "day"); assert.equal(store.meta.calendarCursor, ymd);
  await chooseMenu(root, ".zn-calendar-view-select", "Month");

  assert.equal(content.dataset.density, "comfortable");
  assert.equal(q(root, ".zn-calendar-snap-select").hidden, true, "snap is offered only for time-grid views");
  await chooseMenu(root, ".zn-calendar-density-select", "Compact");
  assert.equal(store.meta.calendarDensity, "compact");
  assert.equal(content.dataset.density, "compact");
  await chooseMenu(root, ".zn-calendar-view-select", "Week");
  assert.equal(q(root, ".zn-cal-time-track").style.height, `${24 * 44}px`);
  assert.equal(content.style.getPropertyValue("--zn-cal-hour-height"), "44px");
  await chooseMenu(root, ".zn-calendar-density-select", "Extra compact");
  assert.equal(q(root, ".zn-cal-time-track").style.height, `${24 * 36}px`);
  await chooseMenu(root, ".zn-calendar-view-select", "Day");
  assert.equal(q(root, ".zn-cal-time-track").style.height, `${24 * 36}px`);
  await chooseMenu(root, ".zn-calendar-view-select", "Next days");
  assert.equal(content.dataset.density, "extra-compact");
  await chooseMenu(root, ".zn-calendar-view-select", "Agenda");
  assert.equal(content.dataset.density, "extra-compact");
  await chooseMenu(root, ".zn-calendar-density-select", "Comfortable");
  await chooseMenu(root, ".zn-calendar-view-select", "Month");
  assert.equal(q(root, ".zn-calendar-view-select").dataset.value, "month");
  assert.equal(content.dataset.view, "month");
  assert.equal(root.querySelectorAll(".zn-cal-month-cell").length, 42, "month view renders six Monday-first weeks");
  assert.ok(root.querySelectorAll(".zn-cal-month-mark").some((el) => el.textContent.includes("Call Alice")), "month grid includes reminder marker/item");
  assert.ok(root.querySelectorAll(".zn-cal-all-day-strip").length > 0, "all-day items are separated into an all-day strip");
  const projectMark = root.querySelectorAll(".zn-cal-month-mark").find((el) => el.textContent.includes("Call Alice"));
  assert.equal(projectMark.style.getPropertyValue("--zn-cal-item-color"), "#4a90e2", "category colour is carried into month markers");
  projectMark.dispatchEvent(new Ev("click", { bubbles: true })); await flushRaf();
  assert.equal(store.meta.calendarView, "month", "clicking a linked item does not bubble into the day-cell action");
  assert.ok(root.querySelectorAll(".zn-editor").some((editor) => editor.value.includes("# Calendar source")), "the linked source note opens");
  root.all().find((el) => el.title === "All notes").click(); await flushRaf();

  await chooseMenu(root, ".zn-calendar-category-filter", "Projects");
  assert.ok(root.querySelectorAll(".zn-cal-month-mark").every((el) => !el.textContent.includes("Focus day")), "category filter excludes other categories");
  await chooseMenu(root, ".zn-calendar-kind-filter", "Reminders");
  assert.ok(root.querySelectorAll(".zn-cal-month-mark").every((el) => !el.textContent.includes("Project review")), "type filter excludes events");

  await chooseMenu(root, ".zn-calendar-category-filter", "All categories");
  await chooseMenu(root, ".zn-calendar-kind-filter", "All items");
  const view = q(root, ".zn-calendar-view-select");
  await chooseMenu(root, ".zn-calendar-view-select", "Next days");
  assert.equal(content.dataset.view, "upcoming");
  assert.equal(root.querySelectorAll(".zn-cal-day-group").length, 7, "upcoming view groups the default seven days");
  const upcomingDay = q(root, ".zn-cal-day-group");
  assert.equal(upcomingDay.getAttribute("tabindex"), "0");
  const upcomingKey = new Ev("keydown", { key: "ContextMenu", bubbles: true });
  upcomingDay.dispatchEvent(upcomingKey); assert.equal(upcomingKey.defaultPrevented, true);
  assert.ok(root.querySelectorAll(".zn-menu-item").some((item) => item.textContent.includes("New all-day reminder")));
  upcomingDay.dispatchEvent(new Ev("keydown", { key: "Escape", bubbles: true }));
  await chooseMenu(root, ".zn-calendar-days-select", "14 days");
  assert.equal(store.meta.calendarDaysForward, 14, "N-days setting persists");
  assert.equal(root.querySelectorAll(".zn-cal-day-group").length, 14, "upcoming view expands exactly the selected number of days");
  assert.ok(root.querySelectorAll(".zn-cal-item").some((el) => el.textContent.includes("Daily check-in")), "recurring reminder occurrences appear in forward view");

  // T2.4c3/T2.3f: finder uses recurring-aware freeSlots; selecting a result opens the full event composer.
  await chooseMenu(root, ".zn-calendar-tools", "When am I free?…");
  assert.ok(q(root, '.zn-dialog-card[aria-label="When am I free?"]'), "free-slot finder opens an accessible dialog");
  const freeFind = root.querySelectorAll(".zn-dialog-card button").find((el) => el.textContent.trim() === "Find free times");
  assert.ok(freeFind, "free-slot dialog offers Find free times");
  const durationInput = q(root, '[aria-label="Minimum free time in minutes"]');
  durationInput.value = "1440";
  freeFind.click();
  assert.match(q(root, ".zn-cal-free-results").textContent, /No matching free time/, "empty/busy ranges have an accessible empty state");
  durationInput.value = "60";
  freeFind.click();
  const firstSlot = q(root, ".zn-cal-free-slot");
  assert.ok(firstSlot, "finder shows at least one available slot in the selected week");
  firstSlot.click();
  const composer = q(root, ".zn-cal-compose-card");
  assert.ok(composer, "choosing a slot opens the full event composer");
  const eventTitle = q(composer, '[aria-label="Title"]');
  const slotStartDate = q(composer, '[aria-label="Start date"]');
  const slotStartTime = q(composer, '[aria-label="Start time"]');
  const slotEndDate = q(composer, '[aria-label="End date (exclusive)"]');
  const slotEndTime = q(composer, '[aria-label="End time"]');
  assert.ok(slotStartDate.value && slotStartTime.value && slotEndDate.value && slotEndTime.value, "the selected slot pre-fills both dates and shared-clock times");
  eventTitle.value = "Focus block";
  composer.querySelectorAll("button").find((el) => el.textContent.trim() === "Create event").click();
  const createdFromSlot = store.items.list().find((item) => item.summary === "Focus block" && item.x.kind === "event");
  assert.ok(createdFromSlot, "chosen free slot creates a standalone timed event");
  assert.ok(Date.parse(createdFromSlot.end.dateTime) > Date.parse(createdFromSlot.start.dateTime), "the created event preserves a valid positive duration");
  q(root, ".zn-calendar-today").click(); await flushRaf();
  await chooseMenu(root, ".zn-calendar-view-select", "Month");

  // Week export actions use the same Monday-first week and the existing print/export host services.
  await chooseMenu(root, ".zn-calendar-tools", "Copy this week as Markdown");
  assert.ok(copiedText.at(-1)?.includes("## Monday"), "copy action produces the seven-day Markdown week");
  assert.ok(copiedText.at(-1)?.includes("Focus block"), "week export includes an event created from a free slot");
  await chooseMenu(root, ".zn-calendar-tools", "Save this week as Markdown…");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(weekExports.length, 1, "save action delegates to the Notes file-picker service");
  assert.ok(weekExports[0].text.includes("Focus block"), "saved week text contains the visible event");
  await chooseMenu(root, ".zn-calendar-tools", "Print this week…");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(weekPrints.length, 1, "print action delegates to the HTML print-tab service");
  assert.ok(weekPrints[0].text.includes("Project review"), "printed week includes calendar items");

  await chooseMenu(root, ".zn-calendar-view-select", "Agenda");
  assert.equal(content.dataset.view, "agenda");
  assert.ok(root.querySelectorAll(".zn-cal-agenda-row").some((el) => el.textContent.includes("Call Alice")), "agenda includes filtered chronological items");
  const beforeRefresh = root.querySelectorAll(".zn-cal-agenda-row").length;
  store.items.upsert({ id: "view-live-refresh", summary: "Added while open", start: { dateTime: new Date(day + 17 * 3600000).toISOString() }, x: { kind: "reminder", noteId: note.id, category: "Projects" } });
  assert.ok(root.querySelectorAll(".zn-cal-agenda-row").length > beforeRefresh, "calendar refreshes when the item store changes while open");

  // The month grid falls back to a grouped list when the actual calendar pane is too narrow.
  calendarPane.getBoundingClientRect = () => ({ left: 0, top: 0, right: 390, bottom: 700, width: 390, height: 700 });
  await chooseMenu(root, ".zn-calendar-view-select", "Month");
  assert.equal(content.dataset.compact, "true", "narrow calendar uses compact list fallback");
  assert.ok(q(root, ".zn-cal-compact-list"), "compact month list is rendered instead of a squeezed 7-column grid");
  await chooseMenu(root, ".zn-calendar-density-select", "Extra compact");
  assert.ok(q(root, ".zn-cal-compact-list"), "density selection preserves the narrow-pane fallback");
  assert.equal(content.dataset.density, "extra-compact");
  await chooseMenu(root, ".zn-calendar-density-select", "Comfortable");

  // The calendar display zone is selected by the user and controls work/busy/Now wall-clock geometry.
  await chooseMenu(root, ".zn-calendar-tools", "Display time zone: Local");
  const zoneCard = q(root, '.zn-dialog-card[aria-label="Calendar display time zone"]');
  assert.ok(zoneCard, "display-zone editor opens from Calendar Tools");
  const zoneInput = q(zoneCard, '[aria-label="IANA display time zone"]');
  const applyZone = zoneCard.querySelectorAll("button").find((el) => el.textContent.trim() === "Apply time zone");
  zoneInput.value = "Mars/Olympus";
  applyZone.click();
  assert.equal(store.meta.calendarDisplayZone, "", "invalid IANA identifiers are refused without replacing the current zone");
  assert.match(zoneCard.textContent, /Enter a valid IANA time zone/);
  zoneInput.value = "Europe/Warsaw";
  applyZone.click();
  await flushRaf();
  assert.equal(store.meta.calendarDisplayZone, "Europe/Warsaw", "selected IANA display zone is stored in calendar meta");
  const zone = "Europe/Warsaw", zoneKey = cal.zonedDateKey(Date.now(), zone), zoneDay = cal.parseYmd(zoneKey).getTime();
  store.setMeta({ calendarCursor: zoneKey, calendarWork: { days: [new Date(zoneDay).getDay()], startMin: 600, endMin: 900 } });
  const civilParts = (key) => key.split("-").map(Number);
  const [zy, zm, zd] = civilParts(zoneKey), [iy, im, id] = civilParts(ymd);
  const displayDayShift = Math.round((Date.UTC(zy, zm - 1, zd) - Date.UTC(iy, im - 1, id)) / 86400000);
  if (displayDayShift) for (const item of store.items.list()) {
    const moved = { ...item };
    if (item.start?.dateTime) moved.start = { ...item.start, dateTime: new Date(Date.parse(item.start.dateTime) + displayDayShift * 86400000).toISOString() };
    else if (item.start?.date) moved.start = { ...item.start, date: cal.ymd(new Date(cal.addDays(cal.parseYmd(item.start.date).getTime(), displayDayShift))) };
    if (item.end?.dateTime) moved.end = { ...item.end, dateTime: new Date(Date.parse(item.end.dateTime) + displayDayShift * 86400000).toISOString() };
    else if (item.end?.date) moved.end = { ...item.end, date: cal.ymd(new Date(cal.addDays(cal.parseYmd(item.end.date).getTime(), displayDayShift))) };
    store.items.upsert(moved);
  }
  const busyStart = cal.zonedDateTimeToMs(zoneKey, "11:30", zone), busyEnd = cal.zonedDateTimeToMs(zoneKey, "12:30", zone);
  store.items.upsert({ id: "display-zone-busy", summary: "Display-zone busy", start: { dateTime: new Date(busyStart).toISOString() }, end: { dateTime: new Date(busyEnd).toISOString() }, x: { kind: "event" } });

  // Week/day time grid: all-day strip, work-hours shading, busy periods, reminders and overlapping lanes.
  calendarPane.getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await chooseMenu(root, ".zn-calendar-view-select", "Week");
  assert.equal(content.dataset.view, "week");
  assert.equal(root.querySelectorAll(".zn-cal-time-column").length, 7, "week view renders seven day columns");
  assert.ok(root.querySelectorAll(".zn-cal-time-allday-cell .zn-cal-item").some((el) => el.textContent.includes("Focus day")), "week view includes all-day events in the all-day strip");
  assert.ok(root.querySelectorAll(".zn-cal-time-reminder").some((el) => el.textContent.includes("Call Alice")), "week view positions timed reminders as separate markers");
  const sharedLanes = root.querySelectorAll(".zn-cal-time-reminder, .zn-cal-time-event").filter((el) => /Call Alice|Second call|Reminder-time event/.test(el.textContent));
  assert.equal(sharedLanes.length, 3, "same-time reminders and events all use the shared overlap layout");
  assert.equal(new Set(sharedLanes.map((el) => el.style.left)).size, 3, "each colliding reminder/event gets a distinct horizontal lane");
  assert.ok(sharedLanes.every((el) => el.style.width === "33.333333333333336%" || el.style.width === "33.33333333333333%"), "three colliding items receive one third of the track each");
  assert.ok(root.querySelectorAll(".zn-cal-off-hours").length > 0, "week view shades outside working hours");
  assert.ok(root.querySelectorAll(".zn-cal-busy-range").length > 0, "week view shades occupied time");
  const zoneTrack = root.querySelectorAll(".zn-cal-time-track").find((track) => track.getAttribute("data-day") === zoneKey);
  assert.ok(zoneTrack, "the displayed-zone current date is present in the time grid; expected " + zoneKey + " got " + root.querySelectorAll(".zn-cal-time-track").map((track) => track.getAttribute("data-day")).join(",") + " cursor=" + store.meta.calendarCursor);
  assert.match(zoneTrack.querySelector(".zn-cal-off-hours")?.getAttribute("style") || "", /height:540px/, "10:00 work-hour start is positioned in Europe/Warsaw wall time");
  const zoneBusy = zoneTrack.querySelectorAll(".zn-cal-busy-range").find((span) => Math.abs(parseFloat(/top:([^;]+)/.exec(span.getAttribute("style") || "")?.[1]) - 11.5 * 54) < 1);
  assert.ok(zoneBusy, "busy-range shading starts at 11:30 in the selected display zone");
  await chooseMenu(root, ".zn-calendar-density-select", "Extra compact");
  const compactTrack = root.querySelectorAll(".zn-cal-time-track").find((track) => track.getAttribute("data-day") === zoneKey);
  assert.equal(compactTrack.style.height, `${24 * 36}px`);
  const compactBusy = compactTrack.querySelectorAll(".zn-cal-busy-range").find((span) => Math.abs(parseFloat(/top:([^;]+)/.exec(span.getAttribute("style") || "")?.[1]) - 11.5 * 36) < 1);
  assert.ok(compactBusy, "busy shading stays aligned with the resized hour scale");
  const compactEvent = compactTrack.querySelectorAll(".zn-cal-time-event").find((el) => el.textContent.includes("Display-zone busy"));
  assert.equal(parseFloat(compactEvent.style.top), 11.5 * 36, "event and hour positions share the density scale");
  await chooseMenu(root, ".zn-calendar-density-select", "Comfortable");
  const overlapButtons = root.querySelectorAll(".zn-cal-time-event").filter((el) => /Project review|Design review/.test(el.textContent));
  assert.equal(overlapButtons.length, 2, "both overlapping events render");
  assert.ok(overlapButtons.every((el) => el.style.width === "50%"), "overlapping events get side-by-side 50% lanes");

  await chooseMenu(root, ".zn-calendar-view-select", "Day");
  assert.equal(content.dataset.view, "day");
  assert.equal(root.querySelectorAll(".zn-cal-time-column").length, 1, "day view renders one full-width day column");
  assert.ok(root.querySelectorAll(".zn-cal-time-event").some((el) => el.textContent.includes("Project review")), "day view retains timed events");
  assert.equal(root.querySelectorAll(".zn-cal-now-line").length, 1, "day view draws its current-time indicator");
  const expectedNowTop = cal.zonedMinuteOfDay(Date.now(), zoneKey, zone) / 60 * 54;
  assert.ok(Math.abs(parseFloat(/top:([^;]+)/.exec(q(root, ".zn-cal-now-line").getAttribute("style") || "")?.[1]) - expectedNowTop) < 1, "Now line uses the selected IANA display zone");
  const gridTrack = q(root, ".zn-cal-time-track");
  assert.equal(gridTrack.getAttribute("tabindex"), "0", "the day track is keyboard reachable");
  const gridKey = new Ev("keydown", { key: "ContextMenu", bubbles: true });
  gridTrack.dispatchEvent(gridKey); assert.equal(gridKey.defaultPrevented, true);
  const allDayEvent = root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "New all-day event…");
  assert.ok(allDayEvent, "keyboard day menu offers all-day creation");
  allDayEvent.click(); await flushRaf();
  assert.equal(q(root, '.zn-cal-compose-card [aria-label="All-day"]').checked, true);
  assert.equal(q(root, ".zn-cal-compose-kind").value, "event");
  root.querySelectorAll(".zn-dialog-card button").find((node) => node.textContent.trim() === "Cancel").click(); await flushRaf();
  gridTrack.dispatchEvent(new Ev("contextmenu", { bubbles: true }));
  assert.ok(root.querySelectorAll(".zn-menu-item").some((el) => el.textContent.includes("Open Day view")), "hour tracks expose a right-click day menu");
  root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "New reminder…")?.click();
  await flushRaf();
  assert.ok(q(root, ".zn-cal-compose-card"), "day context menu can create a reminder for the selected date");
  q(root, ".zn-dialog-actions .zn-chip")?.click();
  await flushRaf();

  // Explicit date-note action does not silently redirect to Agenda when the sidebar is enabled.
  prefs.set(c.PREF.AGENDA_ENABLED, true);
  gridTrack.dispatchEvent(new Ev("contextmenu", { bubbles: true }));
  const dateNote = root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "Open or create date note");
  assert.ok(dateNote); dateNote.click(); await flushRaf();
  assert.ok(store.list().some((entry) => entry.folder === "daily" && entry.body.includes(zoneKey)), "explicit date-note action creates/opens the requested day");
  prefs.delete(c.PREF.AGENDA_ENABLED);
  root.all().find((el) => el.title === "All notes").click(); await flushRaf();

  // Non-recurring timed events can be dragged in the displayed zone, with one guarded undo.
  const dragStart = cal.zonedDateTimeToMs(zoneKey, "11:30", zone);
  store.items.upsert({ id: "drag-ui-event", summary: "Drag me", start: { dateTime: new Date(dragStart).toISOString() }, end: { dateTime: new Date(dragStart + 3600000).toISOString() }, x: { kind: "event", src: "manual" } });
  const setupDrag = () => {
    const track = q(root, ".zn-cal-time-track"), scroll = q(root, ".zn-cal-time-scroll");
    track.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 1296, width: 400, height: 1296 });
    scroll.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 1296, width: 400, height: 1296 });
    const button = root.querySelectorAll(".zn-cal-time-event").find((el) => el.textContent.includes("Drag me"));
    assert.ok(button?.classList.contains("is-movable"));
    button.setPointerCapture = () => {};
    return button;
  };
  const pointer = (type, x, y, id = 7) => new Ev(type, { bubbles: true, button: 0, pointerId: id, clientX: x, clientY: y });
  assert.equal(store.meta.calendarSnap, 15);
  await chooseMenu(root, ".zn-calendar-snap-select", "30 minutes");
  assert.equal(store.meta.calendarSnap, 30);
  let dragButton = setupDrag(), originalDragStart = store.items.get("drag-ui-event").start.dateTime;
  dragButton.dispatchEvent(pointer("pointerdown", 200, 621));
  root.dispatchEvent(pointer("pointermove", 200, 675));
  assert.ok(q(root, ".zn-cal-drag-preview"), "moving beyond the threshold previews the snapped destination");
  root.dispatchEvent(new Ev("keydown", { key: "Escape", bubbles: true }));
  root.dispatchEvent(pointer("pointerup", 200, 675));
  assert.equal(store.items.get("drag-ui-event").start.dateTime, originalDragStart, "Escape cancels the gesture");
  const cancelledClick = new Ev("click", { bubbles: true });
  dragButton.dispatchEvent(cancelledClick);
  assert.equal(cancelledClick.defaultPrevented, true, "cancelled drags do not accidentally open the item");
  dragButton = setupDrag();
  dragButton.dispatchEvent(pointer("pointerdown", 200, 621));
  root.dispatchEvent(pointer("pointermove", 200, 675));
  root.dispatchEvent(pointer("pointercancel", 200, 675));
  assert.equal(store.items.get("drag-ui-event").start.dateTime, originalDragStart, "pointercancel never saves");
  dragButton = setupDrag();
  dragButton.dispatchEvent(pointer("pointerdown", 200, 621));
  root.dispatchEvent(pointer("pointermove", 200, 675));
  dragButton.dispatchEvent(new Ev("lostpointercapture", { pointerId: 7 }));
  root.dispatchEvent(pointer("pointerup", 200, 675));
  assert.equal(store.items.get("drag-ui-event").start.dateTime, originalDragStart, "losing pointer capture cancels without saving");
  dragButton = setupDrag();
  dragButton.dispatchEvent(pointer("pointerdown", 200, 621));
  root.dispatchEvent(pointer("pointermove", 200, 675));
  root.dispatchEvent(pointer("pointerup", 500, 675));
  assert.equal(store.items.get("drag-ui-event").start.dateTime, originalDragStart, "a drop outside the timeline is cancelled");
  dragButton = setupDrag();
  dragButton.dispatchEvent(pointer("pointerdown", 200, 621));
  root.dispatchEvent(pointer("pointermove", 200, 642));
  root.dispatchEvent(pointer("pointerup", 200, 642));
  assert.equal(store.items.get("drag-ui-event").start.dateTime, new Date(dragStart + 1800000).toISOString(), "drop uses the selected 30-minute snap");
  assert.equal(q(root, ".zn-calendar-undo-move").hidden, false);
  q(root, ".zn-calendar-undo-move").click();
  assert.equal(store.items.get("drag-ui-event").start.dateTime, originalDragStart, "undo restores the original schedule");
  assert.equal(q(root, ".zn-calendar-undo-move").hidden, true);
  dragButton = setupDrag();
  dragButton.dispatchEvent(pointer("pointerdown", 200, 621));
  root.dispatchEvent(pointer("pointermove", 200, 675));
  root.dispatchEvent(pointer("pointerup", 200, 675));
  const movedDrag = store.items.get("drag-ui-event");
  store.items.upsert({ ...movedDrag, summary: "Changed elsewhere" });
  q(root, ".zn-calendar-undo-move").click();
  assert.equal(store.items.get("drag-ui-event").summary, "Changed elsewhere", "undo rejects a changed revision");
  assert.equal(store.items.get("drag-ui-event").start.dateTime, movedDrag.start.dateTime);
  store.items.remove("drag-ui-event");

  const crossStart = cal.zonedDateTimeToMs(zoneKey, "11:30", zone);
  store.items.upsert({ id: "drag-cross-day", summary: "Cross day drag", start: { dateTime: new Date(crossStart).toISOString() }, end: { dateTime: new Date(crossStart + 3600000).toISOString() }, x: { kind: "event", src: "manual" } });
  await chooseMenu(root, ".zn-calendar-view-select", "Week");
  const weekTracks = root.querySelectorAll(".zn-cal-time-track");
  const sourceTrackIndex = weekTracks.findIndex((track) => track.getAttribute("data-day") === zoneKey);
  const targetTrackIndex = sourceTrackIndex === 6 ? 5 : sourceTrackIndex + 1;
  assert.ok(sourceTrackIndex >= 0);
  for (let index = 0; index < weekTracks.length; index++) weekTracks[index].getBoundingClientRect = () => ({ left: index * 100, right: index * 100 + 100, top: 0, bottom: 1296, width: 100, height: 1296 });
  q(root, ".zn-cal-time-scroll").getBoundingClientRect = () => ({ left: 0, right: 700, top: 0, bottom: 1296, width: 700, height: 1296 });
  const crossButton = root.querySelectorAll(".zn-cal-time-event").find((el) => el.textContent.includes("Cross day drag"));
  assert.ok(crossButton); crossButton.setPointerCapture = () => {};
  const targetKey = weekTracks[targetTrackIndex].getAttribute("data-day");
  crossButton.dispatchEvent(pointer("pointerdown", sourceTrackIndex * 100 + 50, 621));
  root.dispatchEvent(pointer("pointermove", targetTrackIndex * 100 + 50, 621));
  root.dispatchEvent(pointer("pointerup", targetTrackIndex * 100 + 50, 621));
  assert.equal(store.items.get("drag-cross-day").start.dateTime, new Date(cal.zonedDateTimeToMs(targetKey, "11:30", zone)).toISOString(), "a cross-day drop uses the destination civil date and display zone");
  q(root, ".zn-calendar-undo-move").click();
  assert.equal(store.items.get("drag-cross-day").start.dateTime, new Date(crossStart).toISOString());
  store.items.remove("drag-cross-day");
  await chooseMenu(root, ".zn-calendar-view-select", "Day");

  const linkedNote = store.create(`# Linked drag\n\n%%calendar: Work%%\n- ${zoneKey} 10:00-11:00 Listed drag event`);
  const linkedItem = store.items.list().find((item) => item.x.noteId === linkedNote.id && item.summary.includes("Listed drag event"));
  assert.ok(linkedItem && linkedItem.x.src === "list" && !cal.isReminder(linkedItem));
  const linkedOldStart = linkedItem.start.dateTime;
  const dragTrack = q(root, ".zn-cal-time-track"), dragScroll = q(root, ".zn-cal-time-scroll");
  dragTrack.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 1296, width: 400, height: 1296 });
  dragScroll.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 1296, width: 400, height: 1296 });
  const linkedButton = root.querySelectorAll(".zn-cal-time-event").find((el) => el.textContent.includes("Listed drag event"));
  assert.ok(linkedButton); linkedButton.setPointerCapture = () => {};
  const linkedY = cal.zonedMinuteOfDay(Date.parse(linkedOldStart), zoneKey, zone) * 54 / 60;
  linkedButton.dispatchEvent(pointer("pointerdown", 200, linkedY));
  root.dispatchEvent(pointer("pointermove", 200, linkedY + 54));
  root.dispatchEvent(pointer("pointerup", 200, linkedY + 54));
  const linkedMoved = store.items.get(linkedItem.id);
  assert.equal(Date.parse(linkedMoved.start.dateTime), Date.parse(linkedOldStart) + 3600000);
  assert.equal(linkedMoved.x.moved, "1", "moving a parsed line retains the moved marker");
  assert.match(store.get(linkedNote.id).body, /11:00-12:00/, "source list line follows the move");
  q(root, ".zn-calendar-undo-move").click();
  assert.equal(store.items.get(linkedItem.id).start.dateTime, linkedOldStart, "undo restores a source-derived item");
  assert.match(store.get(linkedNote.id).body, /10:00-11:00/, "undo restores the source list schedule");
  store.items.syncNote(linkedNote.id, store.get(linkedNote.id).body, { sourceEdit: true, updatedAt: Date.now() });
  assert.equal(store.items.get(linkedItem.id).start.dateTime, linkedOldStart, "source resync retains the restored time");
  store.items.remove(linkedItem.id);

  // A source-backed item opens its note at the stored heading target.
  await chooseMenu(root, ".zn-calendar-view-select", "Agenda");
  const callRow = root.querySelectorAll(".zn-cal-item").find((el) => el.textContent.includes("Call Alice"));
  assert.ok(callRow, "source reminder is in the agenda");
  callRow.dispatchEvent(new Ev("pointerenter", { bubbles: false }));
  const hover = q(root, ".zn-cal-hover-card");
  assert.ok(hover, "hovering a reminder opens its detail card");
  assert.ok(hover.textContent.includes("Calendar source"), "hover card shows the linked note title");
  assert.ok(hover.textContent.includes("Tasks"), "hover card shows the heading target");
  assert.ok(hover.textContent.includes("Bring the project notes") && hover.textContent.includes("Review the open questions"), "hover card shows the full calendar note");
  assert.ok(hover.textContent.includes("Europe/Warsaw"), "hover card shows the reminder time zone");
  assert.ok(hover.textContent.includes("Call Alice about the release plan"), "hover card shows the item description");
  assert.equal(callRow.getAttribute("aria-describedby"), hover.getAttribute("id"), "the hover card is linked for assistive technology");
  callRow.dispatchEvent(new Ev("pointerleave", { bubbles: false }));
  assert.equal(q(root, ".zn-cal-hover-card"), null, "leaving the reminder closes its detail card");
  callRow.click(); await flushRaf();
  assert.equal(store.meta.lastNoteId, note.id, "clicking a calendar item opens its source note");
  assert.equal(sheet.openCalendarDay(ymd), true, "Day-Plan action can open a selected day through the sheet API");
  await flushRaf();
  assert.equal(store.meta.calendarView, "day");
  assert.equal(store.meta.calendarCursor, ymd);
  assert.equal(sheet.openCalendarDay("not-a-day"), false, "invalid Day-Plan dates are refused");
  await chooseMenu(root, ".zn-calendar-view-select", "Agenda");

  // Reopen a new sheet with the same store to verify view, filters and N-day setting are durable.
  await chooseMenu(root, ".zn-calendar-density-select", "Extra compact");
  await store.flush();
  const restored = c.createStore({ io, notify() {}, windowId: "cal-views-reopen", getDir: async () => "/views", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  await restored.open();
  assert.equal(restored.meta.calendarView, "agenda");
  assert.equal(restored.meta.calendarDensity, "extra-compact", "density survives store reopening");
  assert.equal(restored.meta.calendarSnap, 30, "calendar snap survives store reopening");
  assert.equal(restored.meta.calendarDaysForward, 14);
  assert.equal(restored.meta.calendarFilterKind, "all");
  assert.equal(restored.meta.calendarDisplayZone, "Europe/Warsaw", "selected display zone persists after reopening the store");
  sheet.destroy(); await restored.close(); await store.close();
  files.set("/bad-density/meta.json", { text: JSON.stringify({ calendarDensity: "gigantic" }), mtime: Date.now() });
  const invalid = c.createStore({ io, notify() {}, windowId: "invalid-density", getDir: async () => "/bad-density", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  await invalid.open();
  assert.equal(invalid.meta.calendarDensity, "comfortable", "invalid stored density falls back safely");
  assert.equal(invalid.meta.calendarSnap, 15, "missing stored snap defaults to fifteen minutes");
  await invalid.close();
  console.log("calendar views UI tests passed");
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
