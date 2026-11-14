"use strict";
/* B3.3.50-1: Agenda seed tabs and empty day folders. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const now = new Date(2026, 10, 13, 9, 0).getTime();
const today = C.localDateKey(now);
const tomorrow = C.localDateKey(C.addDays(C.dayStart(now), 1));
const day2 = C.localDateKey(C.addDays(C.dayStart(now), 2));
const day3 = C.localDateKey(C.addDays(C.dayStart(now), 3));
const make = (id, summary, start, end, x = {}) => C.makeItem({ id, summary, start: start.date ? start : { dateTime: new Date(start).toISOString() }, ...(end ? { end: end.date ? end : { dateTime: new Date(end).toISOString() } } : {}), x: { kind: end ? "event" : "reminder", src: "manual", ...x } }, now);
function test(name, fn) { try { fn(); console.log("ok -", name); } catch (error) { console.error("FAIL " + name + "\n", error); process.exitCode = 1; } }

test("agendaVisibleDays keeps only non-empty days and never mutates the projection", () => {
  assert.equal(typeof C.agendaVisibleDays, "function", "agendaVisibleDays must be exported from the calendar module");
  const projection = [
    { key: "day:" + today, date: today, label: "Today", count: 1, items: [{ key: "item:a:1" }] },
    { key: "day:" + tomorrow, date: tomorrow, label: "Tomorrow", count: 0, items: [] },
    { key: "day:" + day2, date: day2, label: "Day 2", count: 2, items: [{ key: "item:b:1" }, { key: "item:c:1" }] },
    { key: "day:" + day3, date: day3, label: "Day 3", count: 0, items: [] },
  ];
  const before = JSON.stringify(projection);
  const visible = C.agendaVisibleDays(projection);
  assert.deepEqual(visible.map((d) => d.date), [today, day2]);
  assert.deepEqual(visible.map((d) => d.count), [1, 2]);
  assert.equal(JSON.stringify(projection), before, "filter must not mutate the input projection");
  assert.deepEqual(C.agendaVisibleDays([]), []);
  assert.deepEqual(C.agendaVisibleDays(null), []);
  assert.deepEqual(C.agendaVisibleDays(undefined), []);
});

test("Zen Agenda controller never creates empty day folders", () => {
  const items = [make("only-today", "Today only", new Date(2026, 10, 13, 10).getTime(), null)];
  const nodes = new Map(), calls = [];
  const api = {
    ensureRoot: () => { calls.push(["root"]); return true; },
    list: () => [...nodes.values()],
    add: (entry) => { nodes.set(entry.key, { ...entry }); calls.push(["add", entry.key]); return true; },
    update: (entry) => { nodes.set(entry.key, { ...entry }); calls.push(["update", entry.key]); },
    remove: (key) => { nodes.delete(key); calls.push(["remove", key]); },
    removeAll: () => { nodes.clear(); calls.push(["removeAll"]); },
    reorder: (parent, keys) => calls.push(["reorder", parent, ...keys]),
  };
  const controller = C.createZenAgenda({ api, getItems: () => items, getDays: () => 4, getEnabled: () => true, getPosition: () => "above", now: () => now, setTimer: () => 1, clearTimer: () => {} });
  const result = controller.runNow();
  const dayKeys = [...nodes.values()].filter((e) => e.kind === "day").map((e) => e.key);
  assert.deepEqual(dayKeys, ["day:" + today], "only the non-empty Today folder is created; Tomorrow/Day 2/Day 3 must be omitted");
  assert.ok(!calls.some((c) => c[0] === "add" && c[1] === "day:" + tomorrow), "empty Tomorrow folder must never be added");
  assert.ok(!calls.some((c) => c[0] === "add" && c[1] === "day:" + day2), "empty Day 2 folder must never be added");
  assert.ok(!calls.some((c) => c[0] === "add" && c[1] === "day:" + day3), "empty Day 3 folder must never be added");
  assert.deepEqual(result.map((d) => d.date), [today], "runNow returns only visible days");
  controller.destroy();
});

test("Zen Agenda controller removes a day folder that becomes empty", () => {
  let items = [make("today-item", "Today", new Date(2026, 10, 13, 10).getTime(), null), make("tomorrow-item", "Tomorrow", new Date(2026, 10, 14, 10).getTime(), null)];
  const nodes = new Map(), calls = [];
  const api = {
    ensureRoot: () => true,
    list: () => [...nodes.values()],
    add: (entry) => { nodes.set(entry.key, { ...entry }); calls.push(["add", entry.key]); return true; },
    update: (entry) => { nodes.set(entry.key, { ...entry }); calls.push(["update", entry.key]); },
    remove: (key) => { nodes.delete(key); calls.push(["remove", key]); },
    removeAll: () => { nodes.clear(); calls.push(["removeAll"]); },
    reorder: () => {},
  };
  const controller = C.createZenAgenda({ api, getItems: () => items, getDays: () => 4, getEnabled: () => true, getPosition: () => "above", now: () => now, setTimer: () => 1, clearTimer: () => {} });
  controller.runNow();
  assert.ok(nodes.has("day:" + tomorrow), "Tomorrow folder exists while it has an item");
  items = [make("today-item", "Today", new Date(2026, 10, 13, 10).getTime(), null)];
  controller.runNow();
  assert.ok(!nodes.has("day:" + tomorrow), "emptied Tomorrow folder is removed on the next run");
  assert.ok(calls.some((c) => c[0] === "remove" && c[1] === "day:" + tomorrow), "controller must call api.remove for the emptied day");
  controller.destroy();
});

test("ZentralNotes UI removes Agenda seed tabs instead of hiding them", () => {
  const ui = fs.readFileSync(path.join(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  // The agenda seed helpers must settle (remove) the seed, mirroring zenSettleSeed.
  assert.match(ui, /function agendaSettleSeed\s*\(/, "agendaSettleSeed helper must exist");
  assert.match(ui, /agendaSettleSeed\s*\(\s*seed\s*,\s*root\s*,\s*"root"\s*\)/, "agendaEnsureRoot must settle its seed:root tab");
  assert.match(ui, /agendaSettleSeed\s*\(\s*seed\s*,\s*folder\s*,\s*"day"\s*\)/, "agendaMakeDay must settle its seed:<date> tab");
  // The old hide-only pattern must be gone from the agenda section.
  const agendaSection = ui.slice(ui.indexOf("function agendaEnsureRoot"), ui.indexOf("function agendaTabFor"));
  assert.ok(agendaSection.length > 500, "agenda section must be found");
  assert.ok(!/seed\.hidden\s*=\s*true/.test(agendaSection), "agenda seeds must not be hidden with seed.hidden = true");
  assert.ok(!/seed\.setAttribute\(\s*["']aria-hidden["']/.test(agendaSection), "agenda seeds must not be aria-hidden instead of removed");
  // Leftover seeds from older versions must be swept in list(), not silently skipped.
  assert.match(ui, /key\.startsWith\(\s*["']seed:["']\s*\)[\s\S]*?if \(!validFallback\) \{\s*zenRemoveTab\(tab\)/, "agendaApi.list must remove seed tabs instead of only skipping them");
});

// Exercise the actual UI functions with a small Zen folder host: some builds
// keep empty folders, others synchronously delete one when its final tab closes.
test("root and day seeds are removed, or safely recreated and preserved on auto-delete", () => {
  const ui = fs.readFileSync(path.join(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
  const code = ui.slice(ui.indexOf("      // Some Zen versions delete a folder"), ui.indexOf("      function agendaRetireFolder")) +
    ui.slice(ui.indexOf("      function agendaMakeDay"), ui.indexOf("      function agendaTabFor")) +
    ui.slice(ui.indexOf("      const agendaApi ="), ui.indexOf("        add(entry)")).replace(/,\s*$/, "\n};");
  for (const autoDelete of [false, true]) {
    let root = null, day = null;
    const tabs = [], removed = [];
    const makeNode = () => ({ attrs: {}, isConnected: true, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || ""; }, hasAttribute(k) { return k in this.attrs; } });
    const agendaNewTab = (key) => { const tab = makeNode(); tab.setAttribute("agenda", key); tab.closest = () => tab.folder; tabs.push(tab); return tab; };
    const zenRemoveTab = (tab) => {
      removed.push(tab); tab.removed = true;
      if (autoDelete && tab.folder) {
        tab.folder.isConnected = false;
        if (tab.folder === root) root = null;
        if (tab.folder === day) day = null;
      }
    };
    const window = { gBrowser: {}, gZenFolders: { createFolder([tab], options) {
      const folder = makeNode(); folder.nodeType = 1; folder.id = options.id;
      if (options.id === "agenda-root") root = folder; else day = folder;
      tab.folder = folder;
      return folder;
    } } };
    const context = { window, document: { getElementById: () => null, querySelectorAll: () => tabs.filter(t => !t.removed) }, AGENDA_ROOT_ID: "agenda-root", AGENDA_ATTR: "agenda", agendaRootEl: () => root, agendaDayEl: () => day, agendaNewTab, zenRemoveTab, agendaMutationCount: 0, agendaPosition: () => "above", agendaPlaceRoot() {}, zenPlace: () => true, zenNest: () => true, zenParentOf: () => root, agendaRetireFolder() {}, warn() {} };
    vm.createContext(context);
    vm.runInContext(code + "\nthis.ensureRoot = agendaEnsureRoot; this.makeDay = agendaMakeDay; this.list = () => agendaApi.list();", context);
    assert.equal(context.ensureRoot("above"), true);
    assert.equal(context.makeDay({ key: "day:" + today, date: today, label: "Today" }), true);
    root.querySelectorAll = (selector) => selector === "zen-folder" ? [day] : tabs.filter(t => !t.removed && (t.folder === root || t.folder === day));
    root.contains = tab => tab.folder === root || tab.folder === day;
    context.list();
    const live = tabs.filter(t => !t.removed);
    if (autoDelete) {
      assert.equal(removed.length, 2, "first removal detects both collapsing folders");
      assert.equal(live.length, 2, "fallback seeds survive the list sweep");
      assert.deepEqual(live.map(t => t.getAttribute("label")), ["Agenda", "Agenda items"]);
      assert.ok(root.isConnected && day.isConnected);
    } else {
      assert.equal(removed.length, 2);
      assert.equal(live.length, 0, "empty folders do not retain seeds");
    }
  }
});

console.log("Agenda seed/empty-day tests complete");
