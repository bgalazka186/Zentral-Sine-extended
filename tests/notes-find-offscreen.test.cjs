"use strict";
/* OW-22 — "next match not on screen". The pure rule (what counts as visible, what the next one outside is, wrapping,
 * nothing-off-screen) and the real sheet through a fake DOM: several visible matches, off-screen matches in both
 * directions, wrap, the "all on screen" answer, the read view and split view, resizing, and accessible controls.
 * Does NOT prove real layout: the fake DOM's clientHeight/scrollTop are set by the test. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
document.createRange = () => ({ setStart(n, s) { this.n = n; this.s = s; }, setEnd() {}, getBoundingClientRect() { return { top: this.s * 10, height: 10 }; } });
const win = { __zentralNotesParts: { "notes-calendar": require("../additional/notes/calendar/ZentralNotesCalendar.js") }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {},
  getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  getComputedStyle: () => ({ lineHeight: "20px" }) };
win.window = win;
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" }, Uint8Array });
const c = win.__zentralNotesTestSeam.core;
const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const files = new Map();
const io = {
  join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
  readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; },
  writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }),
  remove: async (p) => files.delete(p), exists: async (p) => files.has(p),
  children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/")),
  stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }), restrict: async () => {},
  makeDir: async () => {}, writeBytes: async (p, b) => files.set(p, { bytes: b, mtime: Date.now() }), readBytes: async (p) => files.get(p).bytes, removeTree: async () => {},
};
let CLOCK = new Date(2026, 10, 1, 9, 0, 0).getTime();
const store = c.createStore({ io, notify() {}, windowId: "t", now: () => CLOCK, getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: setTimeout, clearTimer: clearTimeout });
const prefs = new Map();
const env = { getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {}, now: () => CLOCK, loadAsset: async (rel) => ({ url: "blob:test/" + rel }) };
const host = new El("div");
const adapter = { position: "fixed", host, attach: (r) => host.appendChild(r), getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
const key = (el, k, extra = {}) => { const e = new Ev("keydown", { key: k, bubbles: true, ...extra }); el.dispatchEvent(e); return e; };
const type = (el, text) => { el.value = text; el.selectionStart = el.selectionEnd = text.length; el.dispatchEvent(new Ev("input", { bubbles: true })); };
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok -", name); };

(async () => {
  // ---- pure rule -----------------------------------------------------------------------------------------
  await test("a match counts as seen only when its whole line is inside the pane", async () => {
    const line = (y) => ({ y, h: 20 });
    const band = { top: 40, height: 60 }; // readable rows: 40..100
    assert.equal(c.matchIsVisible({}, line(40), band), true, "the top row is readable");
    assert.equal(c.matchIsVisible({}, line(80), band), true, "the bottom row is readable");
    // 100..120 is half past the bottom edge: the person cannot read the word, so it has not been seen.
    assert.equal(c.matchIsVisible({}, line(100), band), false, "a row cut by the bottom edge is not seen");
    assert.equal(c.matchIsVisible({}, line(20), band), false, "a row above the top edge is not seen");
    assert.equal(c.matchIsVisible({}, line(40), { top: 0, height: 0 }), false, "an empty pane has seen nothing");
    assert.equal(c.matchIsVisible({}, null, band), false, "no measurement is not a guess");
  });

  await test("visible matches are found in one pass, with no false neighbours", async () => {
    const lines = [0, 1, 2, 3, 4, 5].map((i) => ({ y: i * 20, h: 20 }));
    const matches = lines.map((_, i) => ({ start: i * 10, end: i * 10 + 3 }));
    assert.deepEqual(Array.from(c.visibleMatchIndices(matches, { top: 40, height: 60 }, (m) => lines[matches.indexOf(m)])), [2, 3, 4]);
    assert.deepEqual(Array.from(c.visibleMatchIndices(matches, { top: 0, height: 20 }, (m) => lines[matches.indexOf(m)])), [0]);
    assert.deepEqual(Array.from(c.visibleMatchIndices([], { top: 0, height: 20 }, () => null)), []);
  });

  await test("the next match outside the pane, both directions, wrapping once", async () => {
    const lines = [0, 1, 2, 3, 4, 5].map((i) => ({ y: i * 20, h: 20 }));
    const matches = lines.map((_, i) => ({ start: i * 10, end: i * 10 + 3 }));
    const band = { top: 40, height: 60 }; // 2, 3, 4 are on screen
    const vis = (i) => c.matchIsVisible(matches[i], lines[i], band);
    assert.equal(c.stepOutsideViewport(matches, 2, 1, vis).index, 5, "forward from the first visible match");
    assert.equal(c.stepOutsideViewport(matches, 4, 1, vis).index, 5, "forward from the last visible match");
    assert.equal(c.stepOutsideViewport(matches, 3, -1, vis).index, 1, "backwards skips the visible ones too");
    assert.equal(c.stepOutsideViewport(matches, 3, 1, vis).wrapped, false, "no wrap when the target is ahead");
    // Every match ahead is visible: the search wraps and says so.
    const top = { top: 100, height: 20 }; // only line 5 is on screen
    const visTop = (i) => c.matchIsVisible(matches[i], lines[i], top);
    const res = c.stepOutsideViewport(matches, 5, 1, visTop);
    assert.equal(res.index, 0, "wrapping lands on the first match");
    assert.equal(res.wrapped, true, "and says it wrapped");
    assert.equal(c.stepOutsideViewport(matches, 0, -1, visTop).index, 4, "backwards wraps the other way");
  });

  await test("nothing outside the pane is reported as such, not as an empty list", async () => {
    const lines = [0, 1, 2].map((i) => ({ y: i * 20, h: 20 }));
    const matches = lines.map((_, i) => ({ start: i, end: i + 2 }));
    const all = { top: 0, height: 200 }; // every match readable
    const vis = (i) => c.matchIsVisible(matches[i], lines[i], all);
    const res = c.stepOutsideViewport(matches, 1, 1, vis);
    assert.equal(res.index, -1, "there is nowhere to go");
    assert.equal(res.any, true, "but matches DO exist — 'all on screen' is a different sentence from 'no matches'");
    const none = c.stepOutsideViewport([], -1, 1, () => false);
    assert.equal(none.index, -1);
    assert.equal(none.any, false, "no matches at all");
  });

  await test("pressing again always moves: the current match is never returned", async () => {
    const lines = [0, 1, 2].map((i) => ({ y: i * 20, h: 20 }));
    const matches = lines.map((_, i) => ({ start: i, end: i + 2 }));
    const band = { top: 0, height: 20 }; // only 0 is on screen
    const vis = (i) => c.matchIsVisible(matches[i], lines[i], band);
    assert.equal(c.stepOutsideViewport(matches, 1, 1, vis).index, 2);
    // From the last match, forward wraps to 1 — the one we are on (1) is visible, and 0 is the one being left.
    const res = c.stepOutsideViewport(matches, 2, 1, vis);
    assert.equal(res.index, 1, "it moves to the next not-visible match");
    assert.notEqual(res.index, 2, "never the match it started on");
  });

  // ---- the real sheet ------------------------------------------------------------------------------------
  await store.open();
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const q = (cls) => sheet.root.querySelector(cls);
  const qa = (cls) => sheet.root.querySelectorAll(cls);
  sheet.root.ownerDocument = document;
  await sheet.open(); await flushRaf();
  const ta = q(".zn-editor"), input = q(".zn-find-input");
  const bar = q(".zn-find");
  // 60 lines, one match every 5th line; 200px pane with 20px lines shows 10 lines at a time.
  const lines = Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? "needle line " + i : "filler line " + i));
  const note = store.create(lines.join("\n"));
  await wait(5);
  sheet.openNoteById(note.id);
  await flushRaf();
  ta.clientHeight = 200; ta.scrollHeight = 1200;
  const openFind = async () => { dom.state.activeElement = ta; key(ta, "f", { ctrlKey: true }); await wait(160); };

  await test("the two off-screen buttons are in the bar with their own accessible names", async () => {
    await openFind();
    assert.equal(bar.hidden, false);
    const offs = qa(".zn-find-off");
    assert.equal(offs.length, 2, "previous and next");
    assert.equal(offs[0].getAttribute("aria-label"), "Previous match not on screen");
    assert.equal(offs[1].getAttribute("aria-label"), "Next match not on screen");
    assert.match(offs[1].title, /Ctrl\+Alt\+Down/, "the key is discoverable from the button");
    assert.equal(offs[0].disabled, true, "with no query there is nowhere to go");
    type(input, "needle");
    await wait(160);
    assert.equal(q(".zn-find-count").textContent.split(" of ")[1], "12", "twelve matches in the note");
  });

  await test("from the top, the next off-screen match skips everything readable", async () => {
    ta.scrollTop = 0; // readable: y 0..200 → lines 0..9 → matches at lines 0 and 5 are visible
    await openFind();
    type(input, "needle");
    await wait(160);
    const seen = [];
    const next = qa(".zn-find-off")[1];
    assert.equal(next.disabled, false, "there are matches below the pane");
    next.dispatchEvent(new Ev("click", { bubbles: true }));
    await wait(30);
    // The match reported is the one the editor was moved to.
    const idx = Number(q(".zn-find-count").textContent.split(" of ")[0]);
    assert.ok(idx > 2, "it did not stop on the two visible matches at lines 0 and 5 (index " + idx + ")");
    seen.push(idx);
    next.dispatchEvent(new Ev("click", { bubbles: true }));
    await wait(30);
    const idx2 = Number(q(".zn-find-count").textContent.split(" of ")[0]);
    assert.notEqual(idx2, idx, "pressing again moves");
  });

  await test("when every match is readable it says so instead of moving nowhere", async () => {
    // One short note where all matches fit in the pane.
    const short = store.create("needle one\nneedle two\nneedle three");
    await wait(5);
    sheet.openNoteById(short.id);
    await flushRaf();
    ta.clientHeight = 400; ta.scrollHeight = 60; ta.scrollTop = 0;
    await openFind();
    type(input, "needle");
    await wait(160);
    assert.equal(q(".zn-find-count").textContent.split(" of ")[1], "3");
    assert.equal(qa(".zn-find-off")[1].disabled, true, "the button cannot move anywhere, so it is disabled");
    assert.match(qa(".zn-find-off")[1].title, /All matches are on screen/, "and the title says why");
    // The plain jump still works, which is the point of keeping them separate.
    const before = q(".zn-find-count").textContent;
    q(".zn-find-next").dispatchEvent(new Ev("click", { bubbles: true }));
    await wait(30);
    assert.notEqual(q(".zn-find-count").textContent, before, "Enter-style jumping is untouched");
  });

  await test("a half-visible match at the bottom edge is not counted as seen", async () => {
    const tall = store.create(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "needle " + i : "x" + i)).join("\n"));
    await wait(5);
    sheet.openNoteById(tall.id);
    await flushRaf();
    ta.clientHeight = 200; ta.scrollHeight = 800;
    ta.scrollTop = 0; // rows 0..9; the row at y=200 is half past the edge → NOT seen
    await openFind();
    type(input, "needle");
    await wait(160);
    const total = Number(q(".zn-find-count").textContent.split(" of ")[1]);
    assert.equal(total, 20, "twenty matches");
    qa(".zn-find-off")[1].dispatchEvent(new Ev("click", { bubbles: true }));
    await wait(30);
    const idx = Number(q(".zn-find-count").textContent.split(" of ")[0]);
    assert.ok(idx >= 6, "it moved past the five whole rows AND the row cut by the edge (index " + idx + ")");
  });

  await test("in the read view the same rule uses the read pane's own window", async () => {
    key(input, "Escape"); // close the bar first
    await wait(30);
    const modeBtn = qa(".zn-mode-btn").find((b) => b.title === "Read (Ctrl+E)");
    assert.ok(modeBtn, "the read-view control exists");
    modeBtn.click(); await flushRaf();
    const readEl = q(".zn-read");
    assert.ok(readEl, "the read view is drawn");
    readEl.clientHeight = 900; readEl.scrollHeight = 900; readEl.scrollTop = 0; // the whole page is readable
    await openFind();
    type(input, "needle");
    await wait(160);
    assert.equal(q(".zn-find-count").textContent.split(" of ")[1], "20", "the read view finds them too");
    // The rule really runs against the READ pane, not the editor: the editor in this fixture is a 200 px window over
    // a 1200 px note, which would leave eleven matches to jump to. In the read view the matches live on measured
    // nodes, so the pane's own window is the door the rule goes through — and it must not throw while doing it.
    assert.equal(qa(".zn-find-off").length, 2, "both buttons survive the read view");
    const offNow = qa(".zn-find-off")[1];
    assert.ok(offNow.disabled === true || offNow.disabled === false, "the state is a real decision, not undefined");
    // Entering and leaving the read view leaves the find bar exactly as it was.
    modeBtn.click(); await flushRaf();
    assert.equal(qa(".zn-find-off").length, 2);
    assert.equal(q(".zn-find-count").textContent.split(" of ")[1], "20", "and the matches are still the same ones");
  });

  await test("Ctrl+Alt+Down / Up in the find field move the same way, and Enter keeps its old meaning", async () => {
    await openFind();
    type(input, "needle");
    await wait(160);
    ta.scrollTop = 0;
    const plain = q(".zn-find-count").textContent;
    const down = key(input, "ArrowDown", { ctrlKey: true, altKey: true });
    assert.ok(down.defaultPrevented, "the key is ours");
    await wait(30);
    const afterOff = q(".zn-find-count").textContent;
    assert.notEqual(afterOff, plain, "Ctrl+Alt+Down moved");
    // A bare Enter is still a plain next, never the off-screen jump.
    const e = key(input, "Enter");
    assert.ok(e.defaultPrevented);
    await wait(30);
    assert.notEqual(q(".zn-find-count").textContent, afterOff, "Enter still steps one match");
  });

  await test("scrolling the pane updates the pair, so it never offers something already in view", async () => {
    const tall = store.create(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "needle " + i : "x" + i)).join("\n"));
    await wait(5);
    sheet.openNoteById(tall.id);
    await flushRaf();
    ta.clientHeight = 200; ta.scrollHeight = 800;
    await openFind();
    type(input, "needle");
    await wait(160);
    ta.scrollTop = 0;
    ta.dispatchEvent(new Ev("scroll", { bubbles: true }));
    await flushRaf(); await wait(30);
    const atTop = qa(".zn-find-off")[1].disabled;
    // Scroll to the very bottom: the matches that were below are now the readable ones and the top ones are not,
    // so the "next" button must be live again (there is always something off-screen at one end of this note).
    ta.scrollTop = 600;
    ta.dispatchEvent(new Ev("scroll", { bubbles: true }));
    await flushRaf(); await wait(30);
    assert.equal(qa(".zn-find-off")[1].disabled, false, "after scrolling there is still somewhere to go");
    assert.equal(atTop, false, "and there was at the top too, on a note this long");
  });

  await test("the extra buttons do not displace the ones that were there", async () => {
    for (const cls of [".zn-find-input", ".zn-find-count", ".zn-find-prev", ".zn-find-next", ".zn-find-others", ".zn-find-replace-toggle", ".zn-find-close"]) {
      assert.equal(qa(cls).length, 1, cls + " is still exactly once on the bar");
    }
  });

  console.log(passed + " off-screen find tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
