"use strict";
/* OW-21 — find and replace in notes. Pure core (plan/one/all/summary) and the real sheet through a fake DOM:
 * replacing one, replacing all, matching options, no matches, a stale range, the 500-match cap, read-only and
 * Trash notes, other notes staying untouched, one undo step, and the keyboard/aria wiring. Does NOT prove layout,
 * real scrolling, native textarea undo, or clipboard access. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
document.createRange = () => ({ setStart(n, s) { this.n = n; this.s = s; }, setEnd() {}, getBoundingClientRect() { return { top: this.s * 10, height: 10 }; } });
const win = { __zentralNotesParts: { "notes-calendar": require("../additional/notes/calendar/ZentralNotesCalendar.js") }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {},
  getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };
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
  // ---- pure core: the matching rules replace inherits from find --------------------------------------------
  await test("replacePlan folds case and accents, is literal and never overlaps", async () => {
    const plan = c.replacePlan("The cat sat. The Cat ran. concat. król", "CAT");
    assert.deepEqual(Array.from(plan.matches, (m) => [m.start, m.end]), [[4, 7], [17, 20], [29, 32]]);
    assert.equal(plan.total, 3);
    assert.deepEqual(Array.from(c.replacePlan("Król i krol", "krol").matches, (m) => [m.start, m.end]), [[0, 4], [7, 11]], "accents fold");
    assert.equal(c.replacePlan("a.c abc", "a.c").matches.length, 1, "a dot is a dot, not any character");
    assert.equal(c.replacePlan("aaaa", "aa").matches.length, 2, "matches never overlap");
    assert.equal(c.replacePlan("anything", "").total, 0, "an empty query matches nothing");
  });

  await test("replacePlan honours a window and reports what is left", async () => {
    const text = "x x x x x x";
    const plan = c.replacePlan(text, "x", { from: 0, to: text.length, limit: 4 });
    assert.equal(plan.matches.length, 4, "the window stops at the cap");
    assert.equal(plan.total, 4, "total is what this plan carries, not a guess about the rest");
    assert.equal(plan.more, true, "and it says there is more — no silent half-job");
    assert.equal(plan.next, 7, "next is where the next pass resumes");
    const narrow = c.replacePlan(text, "x", { from: 4, to: text.length });
    assert.deepEqual(Array.from(narrow.matches, (m) => [m.start, m.end]), [[4, 5], [6, 7], [8, 9], [10, 11]], "a window is in note coordinates");
    assert.equal(narrow.next, 11);
    assert.equal(c.replacePlan(text, "x").more, false, "a plan that fits says so");
  });

  await test("replaceAll rebuilds from pieces so a replacement is never re-scanned", async () => {
    assert.equal(c.replaceAll("a a a", "a", "aa").text, "aa aa aa", "'a' -> 'aa' must terminate");
    assert.equal(c.replaceAll("The cat sat", "cat", "dog").text, "The dog sat");
    assert.equal(c.replaceAll("The cat sat", "cat", "dog").replaced, 1);
    assert.equal(c.replaceAll("one two", "zzz", "y").ok, false, "no match is not a silent success");
    const big = "a".repeat(1200);
    const capped = c.replaceAll(big, "a", "b");
    assert.equal(capped.replaced, 500, "the cap holds");
    assert.equal(capped.truncated, true, "and is reported, never silent");
    assert.equal(capped.text.slice(500), "a".repeat(700), "text beyond the cap is untouched");
  });

  await test("replaceOne refuses a range that no longer holds the query", async () => {
    const text = "The cat sat";
    assert.equal(c.replaceOne(text, { start: 4, end: 7 }, "dog", "cat").text, "The dog sat");
    const stale = c.replaceOne(text, { start: 4, end: 8 }, "dog", "cat");
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "stale", "a moved match is refused, never written to the wrong place");
    assert.equal(c.replaceOne(text, { start: 99, end: 102 }, "dog", "cat").ok, false);
  });

  await test("a replacement is literal text, and $ signs are not patterns", async () => {
    assert.equal(c.replaceAll("cost: price", "price", "$1 & $&").text, "cost: $1 & $&");
    assert.equal(c.cleanReplaceText("a\nb"), "a b", "a line break becomes a space, as in the find field");
    assert.equal(c.cleanReplaceText("x".repeat(400)).length, c.FIND_MAX_QUERY, "the replacement is capped like the query");
  });

  await test("summaries speak both languages", async () => {
    assert.equal(c.replaceSummary({ total: 0 }, { lang: "en" }), "No matches");
    assert.equal(c.replaceSummary({ total: 1 }, { lang: "en" }), "1 match");
    assert.equal(c.replaceSummary({ total: 3 }, { lang: "en" }), "3 matches");
    assert.equal(c.replaceSummary({ total: 1 }, { lang: "pl" }), "1 trafienie");
    assert.equal(c.replaceSummary({ total: 5 }, { lang: "pl" }), "5 trafień");
  });

  // ---- the real sheet -------------------------------------------------------------------------------------
  await store.open();
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const q = (cls) => sheet.root.querySelector(cls);
  const qa = (cls) => sheet.root.querySelectorAll(cls);
  sheet.root.ownerDocument = document;
  await sheet.open(); await flushRaf();
  const ta = q(".zn-editor"), bar = q(".zn-find"), input = q(".zn-find-input");
  ta.clientHeight = 200; ta.scrollHeight = 800;
  const note = store.create("The cat sat.\nThe Cat ran.");
  const other = store.create("Other note: the cat sleeps.");
  const gone = store.create("trashed cat");
  store.trash(gone.id);
  await wait(5);
  sheet.openNoteById(note.id);
  await flushRaf();

  const openFind = async () => { dom.state.activeElement = ta; key(ta, "f", { ctrlKey: true }); await wait(160); };

  await test("the replace row is folded away until asked for, with aria state", async () => {
    await openFind();
    assert.equal(bar.hidden, false);
    const row = q(".zn-find-replace-row");
    const toggle = q(".zn-find-replace-toggle");
    assert.ok(row && toggle, "the row and its toggle exist");
    assert.equal(row.hidden, true, "hidden by default");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    toggle.dispatchEvent(new Ev("click", { bubbles: true }));
    assert.equal(row.hidden, false);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(dom.state.activeElement, q(".zn-find-replace-input"), "the replacement field takes focus");
    type(input, "cat");
    await wait(160);
    assert.equal(q(".zn-find-replace-note").textContent, "2 matches");
    type(q(".zn-find-replace-input"), "dog");
  });

  await test("replacing one changes this note only, and finds the next match", async () => {
    const btn = q(".zn-find-replace-one");
    assert.equal(btn.disabled, false);
    btn.dispatchEvent(new Ev("click", { bubbles: true }));
    await wait(60);
    assert.match(ta.value, /^The dog sat\.\nThe Cat ran\.$/, "the first match became the replacement");
    assert.equal(store.get(other.id).body, "Other note: the cat sleeps.", "another note is untouched");
    assert.equal(store.get(gone.id).body, "trashed cat", "the Trash is untouched");
    assert.equal(q(".zn-find-replace-note").textContent, "1 match", "the count follows the text");
  });

  await test("replacing all is one write, one undo step, and leaves other notes alone", async () => {
    type(q(".zn-find-replace-input"), "dog");
    type(input, "cat");
    await wait(160);
    const before = store.get(note.id).body;
    q(".zn-find-replace-all").dispatchEvent(new Ev("click", { bubbles: true }));
    await wait(60);
    assert.equal(ta.value, "The dog sat.\nThe dog ran.", "the remaining match is replaced, case folded");
    assert.equal(store.get(note.id).body, "The dog sat.\nThe dog ran.");
    assert.notEqual(store.get(note.id).body, before);
    assert.equal(store.get(other.id).body, "Other note: the cat sleeps.");
    assert.equal(store.get(gone.id).body, "trashed cat");
    assert.equal(q(".zn-find-replace-note").textContent, "No matches", "the row says it plainly");
    assert.equal(q(".zn-find-replace-all").disabled, true, "and the button cannot be pressed for nothing");
  });

  await test("a match in the read view is refused, in words, not silently", async () => {
    key(ta, "f", { ctrlKey: true }); // fold the bar, then Ctrl+E into the read view
    await wait(20);
    key(ta, "e", { ctrlKey: true });
    await flushRaf();
    await openFind();
    type(input, "dog");
    await wait(160);
    const noteEl = q(".zn-find-replace-note");
    assert.ok(/switch to Edit|Widok do czytania/.test(noteEl.textContent), "the reason is shown: " + noteEl.textContent);
    assert.equal(q(".zn-find-replace-one").disabled, true);
    assert.equal(q(".zn-find-replace-all").disabled, true);
    assert.equal(store.get(note.id).body, "The dog sat.\nThe dog ran.", "nothing was written");
  });

  await test("Enter replaces one, Alt+Enter replaces all, and the query stays literal", async () => {
    key(ta, "e", { ctrlKey: true }); // back to the editor
    await flushRaf();
    type(ta, "x1 x2 x3");
    await flushRaf();
    await openFind();
    type(input, "x");
    await wait(160);
    const row = q(".zn-find-replace-row");
    const toggle = q(".zn-find-replace-toggle");
    if (row.hidden) toggle.dispatchEvent(new Ev("click", { bubbles: true }));
    type(q(".zn-find-replace-input"), "y");
    const ri = q(".zn-find-replace-input");
    const e1 = key(ri, "Enter");
    assert.ok(e1.defaultPrevented, "Enter is ours inside the row");
    await wait(60);
    assert.equal(ta.value, "y1 x2 x3", "one replace on Enter");
    key(ri, "Enter", { altKey: true });
    await wait(60);
    assert.equal(ta.value, "y1 y2 y3", "Alt+Enter replaces the rest");
  });

  console.log(passed + " find and replace tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
