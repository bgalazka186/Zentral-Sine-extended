"use strict";
/* T2.4a: All notes responsive tree/calendar split, remembered ratios, collapse and narrow-layout tabs.
 * Fake DOM verifies state and interaction, not native Gecko flex sizing or live resize behavior. */
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
const store = c.createStore({ io, notify() {}, windowId: "cal-layout", getDir: async () => "/layout", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
const host = new El("div");
const adapter = { position: "fixed", host, attach: (root) => host.append(root), getArea: () => ({ left: 0, top: 0, width: 900, height: 650 }), watch: () => () => {}, setActive() {}, rewatch() {} };
const prefs = new Map();
const env = { getPref: (k, d) => prefs.has(k) ? prefs.get(k) : d, setPref: (k, v) => prefs.set(k, v), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
const key = (el, name, extra = {}) => { const e = new Ev("keydown", { key: name, bubbles: true, ...extra }); el.dispatchEvent(e); return e; };
const q = (root, selector) => root.querySelector(selector);
const menuPick = (root, text) => root.querySelectorAll(".zn-menu-item").find((b) => b.textContent.includes(text));

(async () => {
  await store.open();
  store.create("# Layout test\nSome note");
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root;
  root.ownerDocument = document;
  const layout = q(root, ".zn-all-layout"), panels = q(root, ".zn-all-panels");
  const tree = q(root, ".zn-tree-pane"), calendar = q(root, ".zn-calendar-pane"), splitter = q(root, ".zn-calendar-splitter");
  const setRect = (width, height) => { layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height }); panels.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height }); };
  setRect(1200, 700);
  await sheet.open(); await flushRaf();
  const openAll = root.all().find((el) => el.title === "All notes");
  openAll.click(); await flushRaf();

  assert.equal(layout.hidden, false);
  assert.equal(root.dataset.allNotesActive, "true");
  assert.equal(panels.dataset.orientation, "lr", "wide window auto-selects left/right");
  assert.equal(panels.dataset.layout, "split");
  assert.equal(tree.hidden, false); assert.equal(calendar.hidden, false); assert.equal(splitter.hidden, false);

  q(root, ".zn-calendar-layout-btn").click();
  menuPick(root, "Top / bottom").click(); await flushRaf();
  assert.equal(store.meta.calendarLayout, "tb");
  assert.equal(panels.dataset.orientation, "tb", "forced orientation overrides auto aspect choice");
  assert.equal(splitter.getAttribute("aria-orientation"), "horizontal");

  setRect(430, 600);
  q(root, ".zn-calendar-layout-btn").click();
  menuPick(root, "Left / right").click(); await flushRaf();
  assert.equal(panels.dataset.orientation, "lr");
  assert.equal(panels.dataset.layout, "tabs", "small width falls back to tabs even when LR is explicitly requested");
  assert.equal(tree.hidden, false); assert.equal(calendar.hidden, true);
  q(root, ".zn-calendar-tab").click(); await flushRaf();
  assert.equal(store.meta.calendarTab, "tree");
  root.querySelectorAll(".zn-calendar-tab")[1].click(); await flushRaf();
  assert.equal(store.meta.calendarTab, "calendar");
  assert.equal(tree.hidden, true); assert.equal(calendar.hidden, false);

  setRect(1200, 700);
  q(root, ".zn-calendar-layout-btn").click();
  menuPick(root, "Auto").click(); await flushRaf();
  assert.equal(panels.dataset.layout, "split");
  assert.equal(panels.dataset.orientation, "lr");
  const oldLR = store.meta.calendarSplitLR;
  key(splitter, "ArrowRight");
  assert.ok(store.meta.calendarSplitLR > oldLR, "keyboard splitter increases tree share");
  splitter.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0, pointerId: 7, clientX: 430, clientY: 200 }));
  splitter.dispatchEvent(new Ev("pointermove", { bubbles: true, pointerId: 7, clientX: 600, clientY: 200 }));
  splitter.dispatchEvent(new Ev("pointerup", { bubbles: true, pointerId: 7, clientX: 600, clientY: 200 }));
  assert.equal(store.meta.calendarSplitLR, 0.5, "pointer dragging updates and commits the horizontal share");
  const oldTB = store.meta.calendarSplitTB;
  q(root, ".zn-calendar-layout-btn").click(); menuPick(root, "Top / bottom").click(); await flushRaf();
  key(splitter, "ArrowDown");
  assert.ok(store.meta.calendarSplitTB > oldTB, "vertical layout has its own remembered share");
  assert.equal(store.meta.calendarSplitLR, 0.5, "vertical adjustment does not overwrite the horizontal share");

  q(root, ".zn-calendar-tree-toggle").click(); await flushRaf();
  assert.equal(store.meta.calendarTreeCollapsed, true); assert.equal(tree.hidden, true); assert.equal(calendar.hidden, false);
  q(root, ".zn-calendar-tree-toggle").click(); await flushRaf();
  assert.equal(store.meta.calendarTreeCollapsed, false); assert.equal(tree.hidden, false);
  q(root, ".zn-calendar-pane-toggle").click(); await flushRaf();
  assert.equal(store.meta.calendarPaneCollapsed, true); assert.equal(calendar.hidden, true); assert.equal(tree.hidden, false);
  q(root, ".zn-calendar-pane-toggle").click(); await flushRaf();
  assert.equal(store.meta.calendarPaneCollapsed, false); assert.equal(calendar.hidden, false);

  // Recent and Trash remain the single-pane note list; the calendar workspace only belongs to All notes.
  q(root, ".zn-chip").click(); await flushRaf();
  assert.equal(root.dataset.allNotesActive, "true");
  assert.equal(q(root, ".zn-all-toolbar").hidden, false);
  q(root, ".zn-chips").children.find((el) => el.textContent === "Recent").click(); await flushRaf();
  assert.equal(root.dataset.allNotesActive, "false"); assert.equal(calendar.hidden, true);
  q(root, ".zn-chips").children.find((el) => el.textContent.startsWith("Trash")).click(); await flushRaf();
  assert.equal(root.dataset.allNotesActive, "false"); assert.equal(calendar.hidden, true);
  q(root, ".zn-chips").children.find((el) => el.textContent === "Notes").click(); await flushRaf();
  assert.equal(root.dataset.allNotesActive, "true");
  await store.flush();
  const restored = c.createStore({ io, notify() {}, windowId: "cal-layout-reopen", getDir: async () => "/layout", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  await restored.open();
  assert.equal(restored.meta.calendarLayout, "tb", "layout mode persists across reopen");
  assert.equal(restored.meta.calendarSplitLR, store.meta.calendarSplitLR, "horizontal split share persists");
  assert.equal(restored.meta.calendarSplitTB, store.meta.calendarSplitTB, "vertical split share persists independently");
  sheet.destroy(); await restored.close(); await store.close();
  console.log("10 calendar layout UI assertions passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
