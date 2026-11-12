"use strict";
/* T2.4b: month, upcoming-days and Agenda views, filters, category colours, all-day strip and source-note navigation. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
assert.match(css, /--zn-panel:\s*var\(--zn-surface\)/, "calendar panel backgrounds always resolve to an opaque sheet surface");
assert.match(css, /\.zn-cal-time-columns\s*\{[^}]*grid-column:\s*2\s*\/\s*-1/s, "the nested day grid spans all tracks after the time gutter");
assert.match(css, /\.zn-cal-now-line/);
assert.match(css, /\.zn-cal-time-event\s*\{[^}]*var\(--zn-surface\)/s, "timed event text uses an opaque surface mix");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
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
  root.all().find((el) => el.title === "All notes").click(); await flushRaf();

  assert.equal(q(root, ".zn-calendar-view-select").dataset.value, "month");
  assert.equal(content.dataset.view, "month");
  assert.equal(root.querySelectorAll(".zn-cal-month-cell").length, 42, "month view renders six Monday-first weeks");
  assert.ok(root.querySelectorAll(".zn-cal-month-mark").some((el) => el.textContent.includes("Call Alice")), "month grid includes reminder marker/item");
  assert.ok(root.querySelectorAll(".zn-cal-all-day-strip").length > 0, "all-day items are separated into an all-day strip");
  const projectMark = root.querySelectorAll(".zn-cal-month-mark").find((el) => el.textContent.includes("Call Alice"));
  assert.equal(projectMark.style.getPropertyValue("--zn-cal-item-color"), "#4a90e2", "category colour is carried into month markers");

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
  const overlapButtons = root.querySelectorAll(".zn-cal-time-event").filter((el) => /Project review|Design review/.test(el.textContent));
  assert.equal(overlapButtons.length, 2, "both overlapping events render");
  assert.ok(overlapButtons.every((el) => el.style.width === "50%"), "overlapping events get side-by-side 50% lanes");

  await chooseMenu(root, ".zn-calendar-view-select", "Day");
  assert.equal(content.dataset.view, "day");
  assert.equal(root.querySelectorAll(".zn-cal-time-column").length, 1, "day view renders one full-width day column");
  assert.ok(root.querySelectorAll(".zn-cal-time-event").some((el) => el.textContent.includes("Project review")), "day view retains timed events");
  assert.equal(root.querySelectorAll(".zn-cal-now-line").length, 1, "day view draws its current-time indicator");
  const gridTrack = q(root, ".zn-cal-time-track");
  gridTrack.dispatchEvent(new Ev("contextmenu", { bubbles: true }));
  assert.ok(root.querySelectorAll(".zn-menu-item").some((el) => el.textContent.includes("Open Day view")), "hour tracks expose a right-click day menu");
  root.querySelectorAll(".zn-menu-item").find((el) => el.textContent.trim() === "New reminder…")?.click();
  await flushRaf();
  assert.ok(q(root, ".zn-cal-compose-card"), "day context menu can create a reminder for the selected date");
  q(root, ".zn-dialog-actions .zn-chip")?.click();
  await flushRaf();

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

  // Reopen a new sheet with the same store to verify view, filters and N-day setting are durable.
  await store.flush();
  const restored = c.createStore({ io, notify() {}, windowId: "cal-views-reopen", getDir: async () => "/views", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  await restored.open();
  assert.equal(restored.meta.calendarView, "agenda");
  assert.equal(restored.meta.calendarDaysForward, 14);
  assert.equal(restored.meta.calendarFilterKind, "all");
  sheet.destroy(); await restored.close(); await store.close();
  console.log("calendar views UI tests passed");
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
