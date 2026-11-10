"use strict";
/* (armed tools) reuse of the writing UI harness: every implemented writing action must be reachable from visible UI (a toolbar button or a labelled menu
 * entry), carry a label/tooltip, and run the SAME action as its shortcut. The WRITING_UI table below is the
 * inventory: adding an action to SHORTCUT_ACTIONS without an entry here fails the first test. Fake DOM: proves
 * wiring, labels, keyboard handling and hide/customise behaviour; NOT real layout, wrapping or Gecko focus. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
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

const eq = assert.deepEqual;
(async () => {
  await test("pure: armPending is true only where a click would drop an empty pair", () => {
    assert.equal(c.armPending("abc", 1, 1, "**"), true);
    assert.equal(c.armPending("abc", 0, 3, "**"), false, "a selection is wrapped at once");
    assert.equal(c.armPending("a****b", 3, 3, "**"), false, "between existing markers the click removes them");
    assert.equal(c.armPending("a<u></u>b", 4, 4, "<u>", "</u>"), false);
    assert.equal(c.armPending("", 0, 0, "<kbd>", "</kbd>"), true);
  });
  await test("pure: armedTypeEdit wraps the first typed phrase, keeps edge spaces outside, waits on spaces", () => {
    eq(J(c.armedTypeEdit("ab", 1, 2, [["**", "**"]])), { start: 1, end: 2, text: "**b**", selStart: 4, selEnd: 4 });
    const one = c.armedTypeEdit("hi x", 3, 4, [["**", "**"]]);
    assert.equal(one.text, "**x**"); assert.equal(one.start, 3); assert.equal(one.selStart, 3 + 2 + 1, "caret sits before the closing marker");
    const sp = c.armedTypeEdit("hi  ", 3, 4, [["**", "**"]]);
    assert.equal(!!sp.wait, true, "only a space typed: stay armed");
    const lead = c.armedTypeEdit("hi  x", 3, 5, [["**", "**"]]);
    assert.equal(lead.start, 4); assert.equal(lead.text, "**x**", "the leading space stays outside");
    const two = c.armedTypeEdit("x", 0, 1, [["**", "**"], ["*", "*"]]);
    assert.equal(two.text, "***x***", "two armed tools nest");
    const paste = c.armedTypeEdit("foo bar ", 0, 8, [["==", "=="]]);
    assert.equal(paste.text, "==foo bar== ", "pasted text: trailing space stays outside"); assert.equal(paste.selStart, 12);
    assert.equal(!!c.armedTypeEdit("a\nb", 1, 3, [["**", "**"]]).cancel, true, "a line break ends the phrase");
    assert.equal(c.armedTypeEdit("ab", 2, 2, [["**", "**"]]), null, "nothing typed");
    assert.equal(c.armedTypeEdit("ab", 1, 2, []), null);
  });
  await test("pure: every armable tool exists as a shortcut action and is a wrapping tool", () => {
    const ids = new Set(c.SHORTCUT_ACTIONS.map((a) => a.id));
    for (const id of c.ARM_TOOLS) assert.ok(ids.has(id), id);
    for (const id of ["heading", "bullet", "check", "quote", "link", "table", "codeBlock"]) assert.ok(!c.ARM_TOOLS.includes(id), id + " acts on the line or opens a dialog: never armed");
  });

  const files = new Map();
  const io = { join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(), readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; }, writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }), exists: async (p) => files.has(p), remove: async (p) => files.delete(p), list: async () => [...files.keys()], mkdir: async () => {}, mtime: async (p) => files.get(p)?.mtime || 0 };
  const store = c.createStore({ io, notify() {}, windowId: "t", getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: setTimeout, clearTimer: clearTimeout });
  const prefs = new Map();
  const env = { openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {}, getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), setPref: (k, v) => prefs.set(k, v) };
  const host = new El("div");
  const adapter = { position: "fixed", host, geoKey: "g", attach: (r) => host.appendChild(r), getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  sheet.root.ownerDocument = document;
  const q = (cls) => sheet.root.querySelector(cls);
  const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
  const key = (el, k, extra = {}) => { const e = new Ev("keydown", { key: k, bubbles: true, ...extra }); el.dispatchEvent(e); return e; };
  const labelOf = (e) => e.getAttribute("aria-label") || e.title || "";
  const buttons = () => sheet.root.all().filter((e) => e.tag === "button");
  const find = (label) => buttons().find((b) => labelOf(b).startsWith(label) || (b.title || "").startsWith(label));
  const menuBtns = () => (q(".zn-menu") ? q(".zn-menu").querySelectorAll("button") : []);
  await sheet.open(); await flushRaf();
  const ta = q(".zn-editor");
  const prep = (text, a = 0, b = text.length) => { ta.value = text; ta.selectionStart = a; ta.selectionEnd = b; dom.state.activeElement = ta; };
  // what the browser does when a character is typed at the caret
  const type = (ch) => { const a = ta.selectionStart; ta.value = ta.value.slice(0, a) + ch + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = a + ch.length; ta.dispatchEvent(new Ev("input", { bubbles: true, inputType: "insertText", data: ch })); };

  await test("click Bold with nothing selected arms it: no empty ****, the button lights up", () => {
    prep("hello ", 6, 6);
    click(find("Bold"));
    assert.equal(ta.value, "hello ", "nothing inserted yet");
    assert.ok(find("Bold")._classes.has("is-armed") && find("Bold").getAttribute("aria-pressed") === "true");
    type("w"); assert.equal(ta.value, "hello **w**");
    assert.equal(ta.selectionStart, 9, "caret before the closing marker");
    assert.ok(!find("Bold")._classes.has("is-armed"), "one phrase only: disarmed after the first character");
    type("o"); type("w"); assert.equal(ta.value, "hello **wow**");
  });
  await test("second click on an armed button switches it off; Escape does too and does not close Notes", () => {
    prep("a ", 2, 2); click(find("Italic")); assert.ok(find("Italic")._classes.has("is-armed"));
    click(find("Italic")); assert.ok(!find("Italic")._classes.has("is-armed")); type("x"); assert.equal(ta.value, "a x");
    prep("a ", 2, 2); click(find("Strikethrough")); const e = key(ta, "Escape");
    assert.equal(e.defaultPrevented, true); assert.ok(!find("Strikethrough")._classes.has("is-armed"));
    assert.equal(sheet.root.dataset.view || "editor", "editor", "still in the editor");
    type("y"); assert.equal(ta.value, "a y");
  });
  await test("armed, then a selection is made: it is wrapped when the mouse is released", () => {
    prep("pick this word", 0, 0); click(find("Highlight selection"));
    ta.selectionStart = 5; ta.selectionEnd = 9;
    ta.dispatchEvent(new Ev("mouseup", { bubbles: true }));
    assert.equal(ta.value, "pick ==this== word");
    assert.ok(!find("Highlight selection")._classes.has("is-armed"));
  });
  await test("two tools armed nest; the caret moving away disarms; a line break ends the phrase", () => {
    prep("t ", 2, 2); click(find("Bold")); click(find("Italic"));
    type("z"); assert.equal(ta.value, "t ***z***");
    prep("one two", 3, 3); click(find("Bold")); ta.selectionStart = ta.selectionEnd = 1; ta.dispatchEvent(new Ev("keyup", { bubbles: true, key: "ArrowLeft" }));
    assert.ok(!find("Bold")._classes.has("is-armed"), "caret moved");
    prep("n ", 2, 2); click(find("Bold")); type("\n"); assert.equal(ta.value, "n \n", "no markers around a line break"); assert.ok(!find("Bold")._classes.has("is-armed"));
  });
  await test("typing a space first keeps the tool armed; the phrase starts at the first real character", () => {
    prep("a", 1, 1); click(find("Inline code")); type(" "); assert.equal(ta.value, "a "); assert.ok(find("Inline code")._classes.has("is-armed"));
    type("f"); assert.equal(ta.value, "a `f`");
  });
  await test("with a selection, a button still acts at once (as before); caret inside **|** still removes the pair", () => {
    prep("word", 0, 4); click(find("Bold")); assert.equal(ta.value, "**word**");
    prep("a****b", 3, 3); click(find("Bold")); assert.equal(ta.value, "ab");
  });
  await test("Insert menu tools and shortcuts arm too (underline from the menu, Ctrl+B)", async () => {
    prep("see ", 4, 4); click(find("More: pictures"));
    click(menuBtns().find((b) => b.textContent.startsWith("More text styles"))); await new Promise((r) => setImmediate(r));
    click(menuBtns().find((b) => b.textContent.startsWith("Underline")));
    assert.equal(ta.value, "see ", "armed, not inserted"); type("u"); assert.equal(ta.value, "see <u>u</u>");
    prep("k ", 2, 2); key(ta, "b", { ctrlKey: true, code: "KeyB" }); assert.ok(find("Bold")._classes.has("is-armed")); type("k"); assert.equal(ta.value, "k **k**");
  });
  await test("switching the setting off restores the old behaviour (empty pair, caret inside)", () => {
    prefs.set(c.PREF.TOOL_ARM, false);
    prep("x ", 2, 2); click(find("Bold")); assert.equal(ta.value, "x ****"); assert.equal(ta.selectionStart, 4);
    prefs.delete(c.PREF.TOOL_ARM);
  });
  await test("armed state does not leak: leaving the field or another note disarms", () => {
    prep("q ", 2, 2); click(find("Bold")); ta.dispatchEvent(new Ev("blur", { bubbles: true }));
    assert.ok(!find("Bold")._classes.has("is-armed"));
    assert.match(css, /\.zn-btn\.is-armed/);
  });
  console.log(`\n${passed} armed-tool tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
