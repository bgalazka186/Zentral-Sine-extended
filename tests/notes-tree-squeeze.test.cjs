"use strict";
/* OW-32: All notes pane squeeze priority — never hide interactable areas, keep titles next, collapse contents first. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "additional/notes/ZentralNotes.uc.js"), "utf8");
const css = fs.readFileSync(path.join(rootDir, "additional/notes/ZentralNotes.css"), "utf8");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;

const win = {
  __zentralNotesParts: { "notes-calendar": cal },
  document,
  ZentralRuntime: { register() {} },
  __zentralNotesTestSeam: {},
  requestAnimationFrame: (fn) => raf.push(fn),
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
};
win.window = win;
vm.runInNewContext(source, {
  window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
  console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask,
  navigator: { platform: "Linux" },
});
const core = win.__zentralNotesTestSeam.core;
const flushRaf = async () => {
  for (let i = 0; i < 5; i++) {
    raf.splice(0).forEach((fn) => fn());
    await new Promise((r) => setImmediate(r));
  }
};

(async () => {
  // 1. Pure threshold helper: monotonic priority (snippet -> time -> badges; never title or interactables)
  assert.equal(typeof cal.treePaneSqueezeState, "function", "exports treePaneSqueezeState");
  assert.deepEqual(cal.treePaneSqueezeState(0), { tier: "full", hideSnippet: false, hideTime: false, hideBadges: false, compactIndent: false });
  assert.deepEqual(cal.treePaneSqueezeState(400), { tier: "full", hideSnippet: false, hideTime: false, hideBadges: false, compactIndent: false });
  assert.deepEqual(cal.treePaneSqueezeState(320), { tier: "full", hideSnippet: false, hideTime: false, hideBadges: false, compactIndent: false });
  assert.deepEqual(cal.treePaneSqueezeState(319), { tier: "compact", hideSnippet: true, hideTime: false, hideBadges: false, compactIndent: false }, "contents/snippet collapse first");
  assert.deepEqual(cal.treePaneSqueezeState(245), { tier: "compact", hideSnippet: true, hideTime: false, hideBadges: false, compactIndent: false });
  assert.deepEqual(cal.treePaneSqueezeState(244), { tier: "narrow", hideSnippet: true, hideTime: true, hideBadges: false, compactIndent: true }, "timestamps collapse second");
  assert.deepEqual(cal.treePaneSqueezeState(170), { tier: "narrow", hideSnippet: true, hideTime: true, hideBadges: false, compactIndent: true });
  assert.deepEqual(cal.treePaneSqueezeState(169), { tier: "tight", hideSnippet: true, hideTime: true, hideBadges: true, compactIndent: true }, "non-interactive badges collapse third");
  assert.deepEqual(cal.treePaneSqueezeState(110), { tier: "tight", hideSnippet: true, hideTime: true, hideBadges: true, compactIndent: true });

  // 2. CSS flex & progressive-hide contract
  assert.ok(!/\.zn-item-main\s+\.zn-item-title\s*\{[^}]*max-width:\s*70%/.test(css), "title is no longer capped at 70% while contents remain visible");
  assert.match(css, /\.zn-item-main\s+\.zn-item-title\s*\{[^}]*max-width:\s*100%/, "title may use up to 100% of main row before truncating");
  assert.match(css, /\.zn-item-main\s+\.zn-item-snippet\s*\{[^}]*flex:\s*1\s+999\s+0/, "snippet collapses first with basis 0 and highest shrink priority");
  assert.match(css, /\.zn-item-actions[\s\S]*?flex:\s*0\s+0\s+auto/, "interactable row actions never shrink");
  assert.match(css, /\.zn-frow\s+\.zn-chev[\s\S]*?flex:\s*0\s+0\s+auto/, "interactable folder chevrons never shrink");
  assert.match(css, /\.zn-tree-pane\s*\{[^}]*container-type:\s*inline-size/, "tree pane establishes inline container query context");
  assert.ok(!/\[data-tree-squeeze[^\]]*\][^{]*\.(zn-item-title|zn-item-actions|zn-chev|zn-new|zn-newfolder)[^{]*\{[^}]*display:\s*none/.test(css),
    "squeeze rules never hide titles or interactable controls");
  assert.ok(!/@container\s+zn-tree[\s\S]*?\.(zn-item-title|zn-item-actions|zn-chev)[^{]*\{[^}]*display:\s*none/.test(css),
    "container queries never hide titles or interactable controls");

  // 3. Live sheet integration: LR split widths, splitter drag, TB switch, and Calendar collapse
  const files = new Map();
  const io = {
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf " + p); return files.get(p).text; },
    writeUTF8: async (p, text) => files.set(p, { text, mtime: Date.now() }),
    remove: async (p) => files.delete(p),
    exists: async (p) => files.has(p),
    children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/")),
    stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }),
    restrict: async () => {},
  };
  const store = core.createStore({ io, notify() {}, windowId: "tree-squeeze", getDir: async () => "/sq", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  await store.open();
  store.create("# Very Important Long Note Title\nSecondary body preview text that should collapse first", { folder: "Projects", label: "Work" });
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (root) => host.append(root), getArea: () => ({ left: 0, top: 0, width: 1100, height: 650 }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const prefs = new Map();
  const env = { getPref: (k, d) => prefs.has(k) ? prefs.get(k) : d, setPref: (k, v) => prefs.set(k, v), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const root = sheet.root;
  root.ownerDocument = document;
  const layout = root.querySelector(".zn-all-layout");
  const panels = root.querySelector(".zn-all-panels");
  const tree = root.querySelector(".zn-tree-pane");
  const splitter = root.querySelector(".zn-calendar-splitter");
  const setRect = (width, height) => {
    layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height });
    panels.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height });
  };

  setRect(1100, 650);
  await sheet.open(); await flushRaf();
  root.all().find((el) => el.title === "All notes").click(); await flushRaf();
  // 1100 * 0.36 - 7 = 389px -> full
  assert.equal(tree.dataset.treeSqueeze, "full", "wide LR split keeps full note rows");

  // Narrow window so tree pane is 800 * 0.36 - 7 = 281px -> compact (hides snippet first)
  setRect(800, 650);
  root.querySelector(".zn-calendar-layout-btn").click();
  root.querySelectorAll(".zn-menu-item").find((b) => b.textContent.includes("Left / right")).click();
  await flushRaf();
  assert.equal(tree.dataset.treeSqueeze, "compact", "moderate LR split collapses snippet contents first");

  // Narrower window so tree pane is 620 * 0.36 - 7 = 216px -> narrow (hides snippet + time)
  setRect(620, 650);
  root.querySelector(".zn-calendar-layout-btn").click();
  root.querySelectorAll(".zn-menu-item").find((b) => b.textContent.includes("Left / right")).click();
  await flushRaf();
  assert.equal(tree.dataset.treeSqueeze, "narrow", "narrow LR split collapses timestamps next while keeping titles");

  // Drag splitter down to 20% of 620px (117px) -> tight (hides non-interactive badges; titles + controls stay visible)
  splitter.dispatchEvent(new Ev("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 223, clientY: 200 }));
  splitter.dispatchEvent(new Ev("pointermove", { bubbles: true, pointerId: 1, clientX: 100, clientY: 200 }));
  assert.equal(tree.dataset.treeSqueeze, "tight", "live splitter drag transitions straight to tight without hiding controls/titles");
  splitter.dispatchEvent(new Ev("pointerup", { bubbles: true, pointerId: 1, clientX: 100, clientY: 200 }));
  await flushRaf();
  assert.equal(tree.dataset.treeSqueeze, "tight");

  // Verify title and interactable areas remain present and unhidden at tight width
  const titleEl = tree.querySelector(".zn-item-title");
  const newBtn = tree.querySelector(".zn-new");
  const folderBtn = tree.querySelector(".zn-newfolder");
  assert.ok(titleEl && titleEl.hidden !== true, "note/folder title remains visible in tight squeeze");
  assert.ok(newBtn && newBtn.hidden !== true, "New note button remains visible in tight squeeze");
  assert.ok(folderBtn && folderBtn.hidden !== true, "New folder button remains visible in tight squeeze");

  // Collapsing calendar pane restores full 620px width -> full
  root.querySelector(".zn-calendar-pane-toggle").click();
  await flushRaf();
  assert.equal(tree.dataset.treeSqueeze, "full", "collapsing calendar pane restores full tree density");

  sheet.destroy();
  await store.close();
  console.log("OW-32 tree pane squeeze priority tests passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
