"use strict";
// Budget the real sheet's Day redraw with a focused calendar item.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const { scaleBudget } = require("./helpers/perf-budget.cjs");
const { El, Ev, document, raf } = require("./helpers/fake-dom.cjs")();
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const win = { __zentralNotesParts: { "notes-calendar": C }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} }; win.window = win;
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" } });
const c = win.__zentralNotesTestSeam.core, files = new Map();
const io = { join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(), readUTF8: async p => { if (!files.has(p)) throw Error("not found"); return files.get(p); }, writeUTF8: async (p,t) => files.set(p,t), remove: async p => files.delete(p), exists: async p => files.has(p), children: async p => [...files.keys()].filter(k => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")), stat: async () => ({ lastModified: Date.now() }), restrict: async () => {} };
const flush = async () => { for (let i = 0; i < 5; i++) { raf.splice(0).forEach(fn => fn()); await new Promise(r => setImmediate(r)); } };
(async () => {
  for (const count of [50, 150]) {
    files.clear();
    const store = c.createStore({ io, notify() {}, windowId: "calendar-perf", getDir: async () => "/perf", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
    await store.open(); store.create("Calendar performance"); const day = C.dayStart(Date.now());
    for (let i = 0; i < count; i++) store.items.upsert({ id: "perf-" + i, summary: "Item " + i, start: { dateTime: new Date(day + (8 * 60 + i * 4) * 60000).toISOString() }, x: { kind: "reminder", src: "manual" } });
    store.setMeta({ calendarView: "day", calendarCursor: C.localDateKey(day) }); await store.flush();
    const host = new El("div"), adapter = { position: "fixed", host, attach: root => host.append(root), getArea: () => ({ left: 0, top: 0, width: 1100, height: 720 }), watch: () => () => {}, setActive() {}, rewatch() {} };
    const sheet = c.createSheet({ store, adapter, env: { getPref: (_k,d) => d, setPref() {}, openLink() {} }, ensureStore: () => store.open() }); sheet.root.ownerDocument = document;
    await sheet.open(); await flush(); sheet.root.all().find(el => el.title === "All notes").click(); await flush();
    const items = sheet.root.querySelectorAll(".zn-cal-item"); assert.equal(items.length, count); items[Math.floor(count / 2)].focus();
    const start = performance.now(); sheet.refreshCalendar(); const elapsed = performance.now() - start;
    const ceiling = scaleBudget(count === 50 ? 4000 : 10000);
    assert.ok(elapsed < ceiling, `Day calendar ${count} render took ${elapsed.toFixed(1)}ms (ceiling ${ceiling.toFixed(0)}ms)`);
    console.log(`Day calendar redraw ${count}: ${elapsed.toFixed(1)}ms`);
    sheet.destroy(); await store.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
