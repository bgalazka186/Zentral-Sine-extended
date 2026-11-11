"use strict";
/* T1.8: the floating table-of-contents button. Pure helpers plus the real sheet code on a fake DOM (shown / hidden by the
 * toc_pill pref and the heading count, opens the outline menu, jumps to a heading). Logic only: NOT layout, NOT real Gecko. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { Ev, El, document, raf } = dom;
const win = { document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
win.window = win;
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array, queueMicrotask });
const c = win.__zentralNotesTestSeam.core;
const J = (x) => JSON.parse(JSON.stringify(x));
const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }

(async () => {
  await test("tocPillShown: auto needs 3 headings, always needs 1, off never; unknown values fall back to auto", () => {
    assert.deepEqual([0, 1, 2, 3, 9].map((k) => c.tocPillShown("auto", k)), [false, false, false, true, true]);
    assert.deepEqual([0, 1, 5].map((k) => c.tocPillShown("always", k)), [false, true, true]);
    assert.equal(c.tocPillShown("off", 50), false);
    assert.equal(c.cleanTocPill("nope"), "auto");
    assert.equal(c.cleanTocPill("always"), "always");
  });
  await test("scrolledHeading: the last heading that reached the top; -1 above the first one", () => {
    const tops = [0, 300, 900, 1500];
    assert.equal(c.scrolledHeading(tops, 0), 0);
    assert.equal(c.scrolledHeading([100, 300], 0), -1, "first heading still below the edge");
    assert.equal(c.scrolledHeading(tops, 290), 1, "slack of 24px counts a heading about to arrive");
    assert.equal(c.scrolledHeading(tops, 899), 2);
    assert.equal(c.scrolledHeading(tops, 99999), 3);
    assert.equal(c.scrolledHeading([], 10), -1);
  });

  // ---- sheet ---------------------------------------------------------------------------------
  const files = new Map();
  const io = { join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(), readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; }, writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }), remove: async (p) => { files.delete(p); }, exists: async (p) => files.has(p), makeDir: async () => {}, list: async () => [...files.keys()], stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0, size: (files.get(p)?.text || "").length }) };
  const store = c.createStore({ io, notify() {}, windowId: "t", getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: setTimeout, clearTimer: clearTimeout });
  const prefs = new Map();
  const env = { openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {}, getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), setPref: (k, v) => prefs.set(k, v) };
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (r) => host.appendChild(r), getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  sheet.root.ownerDocument = document;
  const q = (cls) => sheet.root.querySelector(cls);
  const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
  const PREF = "zen.workspace.zentral.notes.toc_pill";
  await sheet.open(); await flushRaf();
  const note = store.create("Doc\n# One\nx\n# Two\ny");
  await flushRaf();
  const typeInto = async (ta, text) => { ta.value = text; ta.selectionStart = ta.selectionEnd = text.length; dom.state.activeElement = ta; ta.dispatchEvent(new Ev("input", { bubbles: true })); await flushRaf(); };

  await test("the pill is part of the sheet, hidden for a note with fewer than 3 headings (auto)", async () => {
    sheet.openNoteById(note.id); await flushRaf();
    const pill = q(".zn-tocpill");
    assert.ok(pill, "button exists");
    assert.equal(pill.getAttribute("aria-label"), "Table of contents");
    assert.equal(pill.hidden, true);
  });
  await test("it appears when the third heading is typed and goes away when one is removed", async () => {
    const ta = q(".zn-editor");
    await typeInto(ta, "Doc\n# One\nx\n# Two\ny\n## Three");
    assert.equal(q(".zn-tocpill").hidden, false);
    await typeInto(ta, "Doc\n# One\nx\n# Two");
    assert.equal(q(".zn-tocpill").hidden, true);
  });
  await test("pref always shows it from one heading; pref off hides it; the change applies to an open sheet", async () => {
    const ta = q(".zn-editor");
    await typeInto(ta, "Doc\n# One");
    assert.equal(q(".zn-tocpill").hidden, true);
    prefs.set(PREF, "always"); sheet.refreshRead(); await flushRaf();
    assert.equal(q(".zn-tocpill").hidden, false);
    prefs.set(PREF, "off"); sheet.refreshRead(); await flushRaf();
    assert.equal(q(".zn-tocpill").hidden, true);
    prefs.delete(PREF);
  });
  await test("clicking it opens the outline menu; picking a heading puts the caret there", async () => {
    const ta = q(".zn-editor");
    await typeInto(ta, "Doc\n# One\nx\n# Two\ny\n## Three");
    ta.selectionStart = ta.selectionEnd = 0;
    click(q(".zn-tocpill"));
    const menu = q(".zn-menu");
    assert.ok(menu, "menu is open");
    const items = menu.querySelectorAll("button").map((b) => b.textContent.trim());
    assert.ok(items.includes("One") && items.includes("Two") && items.includes("Three"), items.join("|"));
    click(menu.querySelectorAll("button").find((b) => b.textContent.trim() === "Two")); await flushRaf();
    assert.equal(ta.selectionStart, ta.value.indexOf("# Two"));
  });
  await test("it is not shown in the note list, and comes back with the note", async () => {
    click(q(".zn-title")); await flushRaf();
    assert.equal(q(".zn-list").hidden === true, false, "the list is open");
    assert.equal(q(".zn-tocpill").hidden, true);
    click(q(".zn-title")); await flushRaf();
    assert.equal(q(".zn-tocpill").hidden, false);
  });
  console.log(`\n${passed} table-of-contents button tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
