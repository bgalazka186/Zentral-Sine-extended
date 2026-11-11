"use strict";
/* T2.4b: month, upcoming-days and Agenda views, filters, category colours, all-day strip and source-note navigation. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
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
const env = { getPref: (k, d) => prefs.has(k) ? prefs.get(k) : d, setPref: (k, v) => prefs.set(k, v), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
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
  const reminder = store.items.upsert({ id: "view-reminder", summary: "Call Alice", start: { dateTime: new Date(reminderAt).toISOString() }, x: { kind: "reminder", noteId: note.id, heading: "Tasks", category: "Projects", calNote: "Bring the project notes" } });
  const eventStart = day + 15 * 3600000, eventEnd = day + 16 * 3600000;
  store.items.upsert({ id: "view-event", summary: "Project review", start: { dateTime: new Date(eventStart).toISOString() }, end: { dateTime: new Date(eventEnd).toISOString() }, x: { kind: "event", noteId: note.id, heading: "Tasks", category: "Projects" } });
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

  // A source-backed item opens its note at the stored heading target.
  calendarPane.getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });
  await chooseMenu(root, ".zn-calendar-view-select", "Agenda");
  const callRow = root.querySelectorAll(".zn-cal-item").find((el) => el.textContent.includes("Call Alice"));
  assert.ok(callRow, "source reminder is in the agenda");
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
  console.log("14 calendar views UI assertions passed");
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
