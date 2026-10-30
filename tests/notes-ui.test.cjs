"use strict";
/* Drives the real sheet code of additional/notes/ZentralNotes.uc.js through a small fake DOM.
 * Proves the sheet logic (typing, formatting, list continuation, read mode checkboxes, search,
 * pin/trash, two sheets in sync, saving on close). It does NOT prove layout, CSS or real Gecko. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");

const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const win = {
  document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {},
  requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {},
  setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {},
};
win.window = win;
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" } });
const c = win.__zentralNotesTestSeam.core;
const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };


// ---- fixtures ------------------------------------------------------------------------
const files = new Map();
const io = {
  join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
  readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; },
  writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }),
  remove: async (p) => files.delete(p), exists: async (p) => files.has(p),
  children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/")),
  stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }), restrict: async () => {},
};
const store = c.createStore({ io, notify() {}, windowId: "t", getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: setTimeout, clearTimer: clearTimeout });
const envCalls = [];
const env = { openLink: (u) => envCalls.push(["link", u]), copyText: (t) => envCalls.push(["copy", t]), exportNote: (n) => envCalls.push(["export", n.id]), exportAll() {}, revealFolder() {} };
function makeAdapter() {
  const host = new El("div");
  return { position: "fixed", host, attach: (r) => host.appendChild(r), getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
}
const ensureStore = () => store.open();
const key = (el, k, extra = {}) => { const e = new Ev("keydown", { key: k, bubbles: true, ...extra }); el.dispatchEvent(e); return e; };
const type = (ta, text) => { ta.value = text; ta.selectionStart = ta.selectionEnd = text.length; ta.dispatchEvent(new Ev("input", { bubbles: true })); };

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }

(async () => {
  const sheetA = c.createSheet({ store, adapter: makeAdapter(), env, ensureStore });
  const sheetB = c.createSheet({ store, adapter: makeAdapter(), env, ensureStore });
  const q = (sheet, cls) => sheet.root.querySelector(cls);

  await test("open creates an empty draft; typing sets the title and saves nothing until text exists", async () => {
    await sheetA.open(); await flushRaf();
    assert.equal(sheetA.root.hidden, false);
    assert.equal(store.list().length, 1, "one empty draft in memory");
    assert.equal(files.size, 0);
    assert.equal(q(sheetA, ".zn-title").textContent, "Untitled note");
    type(q(sheetA, ".zn-editor"), "Shopping\n- [ ] milk");
    await flushRaf();
    assert.equal(q(sheetA, ".zn-title").textContent, "Shopping");
    assert.equal(store.state.save, "dirty");
    assert.match(q(sheetA, ".zn-count").textContent, /2 words/);
  });

  await test("Enter continues a checklist, Enter on an empty item leaves the list", async () => {
    const ta = q(sheetA, ".zn-editor");
    dom.state.activeElement = ta;
    const e1 = key(ta, "Enter");
    assert.ok(e1.defaultPrevented);
    assert.equal(ta.value, "Shopping\n- [ ] milk\n- [ ] ");
    key(ta, "Enter");
    assert.equal(ta.value, "Shopping\n- [ ] milk\n");
  });

  await test("Ctrl+B / Ctrl+Shift+H wrap the selection and toggle off again", async () => {
    const ta = q(sheetA, ".zn-editor");
    type(ta, "plan the trip");
    ta.setSelectionRange(9, 13);
    key(ta, "b", { ctrlKey: true });
    assert.equal(ta.value, "plan the **trip**");
    ta.setSelectionRange(11, 15);
    key(ta, "h", { ctrlKey: true, shiftKey: true });
    assert.equal(ta.value, "plan the **==trip==**");
    ta.setSelectionRange(0, ta.value.length);
    type(ta, "plan the trip");
    ta.setSelectionRange(9, 13);
    key(ta, "h", { ctrlKey: true, shiftKey: true });
    assert.equal(ta.value, "plan the ==trip==");
    ta.setSelectionRange(11, 15);
    key(ta, "h", { ctrlKey: true, shiftKey: true });
    assert.equal(ta.value, "plan the trip");
  });

  await test("read mode renders highlights safely; checkboxes edit the source", async () => {
    const ta = q(sheetA, ".zn-editor");
    type(ta, "# Todo\n- [ ] one\n- [x] two\nsee ==this== and [x](javascript:alert(1)) <b>raw</b>");
    key(ta, "e", { ctrlKey: true });
    await flushRaf();
    const read = q(sheetA, ".zn-read");
    assert.equal(read.hidden, false);
    assert.equal(q(sheetA, ".zn-editor").hidden, true);
    const marks = read.all().filter((e) => e.tag === "mark");
    assert.equal(marks.length, 1);
    assert.equal(marks[0].textContent, "this");
    assert.equal(read.all().filter((e) => e.tag === "a").length, 0, "no anchors, no href attributes");
    assert.ok(read.textContent.includes("<b>raw</b>"), "html stays literal text");
    assert.ok(read.textContent.includes("[x](javascript:alert(1))"));
    const boxes = read.all().filter((e) => e.tag === "button" && e._classes.has("zn-check"));
    assert.equal(boxes.length, 2);
    boxes[0].click();
    assert.ok(store.get(store.latestId()).body.includes("- [x] one"));
    key(read, "e", { ctrlKey: true });
    assert.equal(q(sheetA, ".zn-editor").value.split("\n")[1], "- [x] one");
  });

  await test("a second sheet shows the same note and follows edits live", async () => {
    await sheetB.open(); await flushRaf();
    const taA = q(sheetA, ".zn-editor"),
      taB = q(sheetB, ".zn-editor");
    assert.equal(taB.value, taA.value);
    dom.state.activeElement = taA;
    type(taA, "written in A");
    await flushRaf();
    assert.equal(taB.value, "written in A");
    dom.state.activeElement = taB;
    type(taB, "now typing in B");
    await flushRaf();
    assert.equal(taA.value, "now typing in B");
    assert.equal(q(sheetA, ".zn-title").textContent, "now typing in B");
  });

  await test("new note, list view, search, pin and trash", async () => {
    const ta = q(sheetA, ".zn-editor");
    dom.state.activeElement = ta;
    key(ta, "n", { ctrlKey: true });
    type(ta, "Second note about cats");
    await store.flush();
    assert.equal(files.size > 0, true);
    key(ta, "k", { ctrlKey: true });
    await flushRaf();
    assert.equal(sheetA.root.dataset.view, "list");
    let items = q(sheetA, ".zn-items").all().filter((e) => e._classes.has("zn-item"));
    assert.equal(items.length, 2);
    const search = q(sheetA, ".zn-search");
    search.value = "cats"; search.dispatchEvent(new Ev("input", { bubbles: true })); await flushRaf();
    items = q(sheetA, ".zn-items").all().filter((e) => e._classes.has("zn-item"));
    assert.equal(items.length, 1);
    search.value = "nothing-matches"; search.dispatchEvent(new Ev("input", { bubbles: true })); await flushRaf();
    assert.match(q(sheetA, ".zn-items").textContent, /No notes match/);
    search.value = ""; search.dispatchEvent(new Ev("input", { bubbles: true })); await flushRaf();
    const row = q(sheetA, ".zn-items").all().find((e) => e._classes.has("zn-item") && e.textContent.includes("cats"));
    const pin = row.all().find((e) => e.tag === "button" && e.title === "Pin");
    pin.click(); await flushRaf();
    assert.equal(store.list()[0].body, "Second note about cats", "pinned note sorts first");
    const row2 = q(sheetA, ".zn-items").all().find((e) => e._classes.has("zn-item") && e.textContent.includes("cats"));
    row2.all().find((e) => e.tag === "button" && e.title === "Move to trash").click(); await flushRaf();
    assert.equal(store.list().length, 1);
    assert.equal(store.list({ trashed: true }).length, 1);
    key(search, "Escape");
    assert.equal(sheetA.root.dataset.view, "editor", "Escape leaves the list, it does not close the sheet");
    assert.equal(sheetA.root.hidden, false);
  });

  await test("Escape closes, flushes to disk and keeps keys away from the page", async () => {
    const ta = q(sheetA, ".zn-editor");
    dom.state.activeElement = ta;
    type(ta, "final text");
    const e = key(ta, "Escape");
    assert.ok(e.defaultPrevented && e.stopped);
    assert.equal(sheetA.root.hidden, true);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok([...files.values()].some((f) => f.text.endsWith("final text")), "saved on close");
    const other = key(q(sheetB, ".zn-editor"), "a");
    assert.ok(other.stopped, "typing never reaches panel shortcuts");
  });

  await test("split view: preview follows typing after a pause and redraws only the changed block", async () => {
    await sheetA.open(); await flushRaf();
    const ta = q(sheetA, ".zn-editor"), read = q(sheetA, ".zn-read");
    if (sheetA.root.dataset.mode === "read") key(read, "e", { ctrlKey: true });
    type(ta, "# Title\n\nfirst paragraph\n\nsecond paragraph");
    const split = sheetA.root.all().find((e) => e.getAttribute("aria-label") === "Split view: editor and preview");
    split.click(); await flushRaf();
    assert.equal(sheetA.root.dataset.mode, "split");
    assert.equal(ta.hidden, false, "editor stays visible");
    assert.equal(read.hidden, false, "preview is visible beside it");
    const paras = () => read.all().filter((e) => e.tag === "p");
    assert.deepEqual(paras().map((e) => e.textContent), ["first paragraph", "second paragraph"]);
    const [p1, p2] = paras();
    type(ta, "# Title\n\nfirst paragraph\n\nsecond paragraph, edited");
    assert.equal(paras()[1].textContent, "second paragraph", "not redrawn on every keystroke (debounced)");
    await new Promise((r) => setTimeout(r, 400)); await flushRaf();
    assert.equal(paras()[0], p1, "the unchanged block keeps its DOM node");
    assert.notEqual(paras()[1], p2);
    assert.equal(paras()[1].textContent, "second paragraph, edited");
    // typing in the editor and then closing the sheet must leave no timer armed
    type(ta, "# Title\n\nlast words");
    sheetA.close();
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(paras().some((e) => e.textContent === "last words"), false, "no render after close");
    await sheetA.open(); await flushRaf();
  });

  await test("read view: tables, images (click to load) and nested quotes", async () => {
    const ta = q(sheetA, ".zn-editor"), read = q(sheetA, ".zn-read");
    type(ta, "| a | b |\n|---|--:|\n| 1 | 2 |\n\n![cat](https://example.org/c.png) [home](https://example.org)\n\n> one\n> > two\n\n---");
    await new Promise((r) => setTimeout(r, 400)); await flushRaf();
    assert.equal(read.all().filter((e) => e.tag === "th").length, 2);
    assert.equal(read.all().filter((e) => e.tag === "td").length, 2);
    assert.equal(read.all().filter((e) => e.tag === "blockquote").length, 2, "nested quote");
    assert.equal(read.all().filter((e) => e.tag === "hr").length, 1);
    assert.equal(read.all().filter((e) => e.tag === "img").length, 0, "no image is requested until the person clicks");
    read.all().find((e) => e._classes.has("zn-img")).click();
    const img = read.all().find((e) => e.tag === "img");
    assert.equal(img.getAttribute("src"), "https://example.org/c.png");
    assert.equal(read.all().filter((e) => e._classes.has("zn-link")).length, 1);
  });

  await test("the horizontal rule button inserts a rule set off by blank lines", async () => {
    const ta = q(sheetA, ".zn-editor");
    type(ta, "above"); ta.setSelectionRange(5, 5);
    sheetA.root.all().find((e) => e.getAttribute("aria-label") === "Horizontal rule").click();
    assert.equal(ta.value, "above\n\n---\n\n");
  });

  await test("quote and nesting buttons edit the selected lines", async () => {
    await sheetA.open(); await flushRaf();
    const ta = q(sheetA, ".zn-editor");
    const btn = (label) => sheetA.root.all().find((e) => e.getAttribute("aria-label") === label);
    if (sheetA.root.dataset.mode === "read") key(q(sheetA, ".zn-read"), "e", { ctrlKey: true });
    type(ta, "one\ntwo"); ta.setSelectionRange(0, 7);
    btn("Quote (nest deeper with the indent button)").click();
    assert.equal(ta.value, "> one\n> two");
    ta.setSelectionRange(0, ta.value.length);
    btn("Nest in: list or quote one level deeper").click();
    assert.equal(ta.value, "> > one\n> > two");
    ta.setSelectionRange(0, ta.value.length);
    btn("Nest out: list or quote one level up").click();
    assert.equal(ta.value, "> one\n> two");
    type(ta, "- a\n- b"); ta.setSelectionRange(4, 7);
    btn("Nest in: list or quote one level deeper").click();
    assert.equal(ta.value, "- a\n  - b");
  });

  await test("linked scrolling: chain button toggles it, split panes follow each other once", async () => {
    await sheetA.open(); await flushRaf();
    const ta = q(sheetA, ".zn-editor"), read = q(sheetA, ".zn-read");
    const sync = sheetA.root.all().find((e) => e.getAttribute("aria-label") === "Linked scrolling");
    const split = sheetA.root.all().find((e) => e.getAttribute("aria-label") === "Split view: editor and preview");
    if (sheetA.root.dataset.mode !== "split") split.click();
    await flushRaf();
    assert.equal(sync.hidden, false, "chain button shows in split view");
    for (const el of [ta, read]) Object.assign(el, { scrollHeight: 1000, clientHeight: 200 });
    ta.scrollTop = 400; ta.dispatchEvent(new Ev("scroll"));
    assert.equal(read.scrollTop, 400, "preview follows the editor");
    await flushRaf();
    sync.click();
    assert.equal(sync.classList.contains("is-on"), false);
    assert.equal(store.meta.syncScroll, false);
    ta.scrollTop = 100; ta.dispatchEvent(new Ev("scroll"));
    assert.equal(read.scrollTop, 400, "unlinked: the preview stays");
    sync.click();
    assert.equal(store.meta.syncScroll, true);
    split.click(); await flushRaf();
    assert.equal(sync.hidden, true, "chain button hides outside split view");
  });

  await test("shortcut parsing", async () => {
    const s = c.parseShortcut("Alt+Shift+N");
    assert.ok(c.matchesShortcut({ altKey: true, shiftKey: true, ctrlKey: false, metaKey: false, key: "N", code: "KeyN" }, s));
    assert.ok(!c.matchesShortcut({ altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, key: "n", code: "KeyN" }, s));
    assert.equal(c.parseShortcut("N"), null, "a bare key is refused");
    assert.equal(c.parseShortcut("Shift+N"), null, "shift alone is refused");
    assert.ok(c.parseShortcut("Ctrl+Alt+K"));
  });

  // ---- cycle B2: new toolbar actions, dialogs, shortcuts, quick settings ----------------------
  const prefs = new Map();
  env.getPref = (k, d) => (prefs.has(k) ? prefs.get(k) : d);
  env.setPref = (k, v) => prefs.set(k, v);
  const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
  const byLabel = (sheet, label) => sheet.root.all().find((e) => e.getAttribute("aria-label") === label || e.title === label || (e.title || "").startsWith(label + " ("));
  const dialogOf = (sheet) => q(sheet, ".zn-dialog");
  const chipNamed = (sheet, text) => sheet.root.all().find((e) => e._classes.has("zn-chip") && e.textContent === text);
  const prep = (sheet, text, a = 0, b = text.length) => {
    if (sheet.root.dataset.mode === "read") key(q(sheet, ".zn-read"), "e", { ctrlKey: true });
    const ta = q(sheet, ".zn-editor");
    ta.value = text; ta.selectionStart = a; ta.selectionEnd = b; dom.state.activeElement = ta;
    return ta;
  };

  await test("B2 shortcuts: inline code, numbered list, code block, image via the shortcut engine", async () => {
    const ta = prep(sheetA, "word", 0, 4);
    key(ta, "c", { ctrlKey: true, shiftKey: true, code: "KeyC" });
    assert.equal(ta.value, "`word`");
    const t2 = prep(sheetA, "a\nb", 0, 3);
    key(t2, "&", { ctrlKey: true, shiftKey: true, code: "Digit7" });
    assert.equal(t2.value, "1. a\n2. b");
    const t3 = prep(sheetA, "x = 1", 0, 5);
    key(t3, "m", { ctrlKey: true, shiftKey: true, code: "KeyM" });
    click(chipNamed(sheetA, "Insert")); // the language dialog opens first; plain text is the default
    assert.equal(t3.value, "```\nx = 1\n```");
    const t4 = prep(sheetA, "pic", 0, 3);
    key(t4, "g", { ctrlKey: true, shiftKey: true, code: "KeyG" });
    assert.ok(dialogOf(sheetA), "the image dialog opens");
    click(chipNamed(sheetA, "Cancel"));
    assert.equal(t4.value, "pic");
  });

  await test("C2.2 image dialog: address, description, optional link; bad addresses are refused", async () => {
    const ta = prep(sheetA, "a cat", 0, 5);
    key(ta, "g", { ctrlKey: true, shiftKey: true, code: "KeyG" });
    const [srcIn, altIn, linkIn] = sheetA.root.all().filter((e) => e._classes.has("zn-field"));
    assert.equal(altIn.value, "a cat", "the selection becomes the description");
    srcIn.value = "file:///C:/cat.png";
    click(chipNamed(sheetA, "Insert image"));
    assert.ok(dialogOf(sheetA) && srcIn.dataset.bad === "true", "only web addresses are accepted");
    srcIn.value = "https://example.org/cat 1.png";
    linkIn.value = "javascript:alert(1)";
    click(chipNamed(sheetA, "Insert image"));
    assert.ok(dialogOf(sheetA), "a bad link address is refused too");
    linkIn.value = "https://example.org/page";
    click(chipNamed(sheetA, "Insert image"));
    assert.equal(dialogOf(sheetA), null);
    assert.equal(ta.value, "[![a cat](https://example.org/cat%201.png)](https://example.org/page)");
    const [para] = c.parseBlocks(ta.value);
    assert.equal(para.c[0].t, "a");
    assert.equal(para.c[0].c[0].t, "img");
  });

  await test("C2.2 image and link dialogs take a web address from the clipboard when none is given", async () => {
    const savedNav = win.navigator;
    win.navigator = { clipboard: { readText: async () => "https://example.org/clip.png" } };
    try {
      prep(sheetA, "", 0, 0);
      click(byLabel(sheetA, "Image"));
      await new Promise((r) => setTimeout(r, 0));
      const [srcIn] = sheetA.root.all().filter((e) => e._classes.has("zn-field"));
      assert.equal(srcIn.value, "https://example.org/clip.png");
      click(chipNamed(sheetA, "Cancel"));
      prep(sheetA, "", 0, 0);
      click(byLabel(sheetA, "Link\u2026"));
      await new Promise((r) => setTimeout(r, 0));
      const [, addrIn] = sheetA.root.all().filter((e) => e._classes.has("zn-field"));
      assert.equal(addrIn.value, "https://example.org/clip.png");
      click(chipNamed(sheetA, "Cancel"));
    } finally {
      win.navigator = savedNav;
    }
  });

  await test("C2.2 code block dialog: the chosen language becomes the fence; a fenced selection is unwrapped", async () => {
    const ta = prep(sheetA, "let x = 1", 0, 9);
    click(byLabel(sheetA, "Code block"));
    assert.ok(!sheetA.root.all().some((e) => e.tag === "select"), "no native select: its popup closes the sheet");
    click(chipNamed(sheetA, "JavaScript / TypeScript"));
    click(chipNamed(sheetA, "Insert"));
    assert.equal(ta.value, "```js\nlet x = 1\n```");
    const t2 = prep(sheetA, ta.value, 0, ta.value.length);
    click(byLabel(sheetA, "Code block"));
    assert.equal(dialogOf(sheetA), null, "no dialog when unwrapping");
    assert.equal(t2.value, "let x = 1");
  });

  await test("C2.2 callout shortcuts and menu entries", async () => {
    const ta = prep(sheetA, "careful", 0, 7);
    key(ta, "@", { ctrlKey: true, shiftKey: true, code: "Digit2" });
    assert.equal(ta.value, "> [!NOTE]\n> careful");
    const t2 = prep(sheetA, "careful", 0, 7);
    key(t2, "#", { ctrlKey: true, shiftKey: true, code: "Digit3" });
    assert.equal(t2.value, "> [!WARNING]\n> careful");
    const [q] = c.parseBlocks(t2.value);
    assert.equal(q.callout.kind, "warning");
  });

  await test("C2.2 hidden toolbar actions: no button, no shortcut; Show all brings them back", async () => {
    prefs.set(c.PREF.HIDDEN_TOOLS, "strike,codeBlock");
    sheetA.applyState?.();
    const sheetBtn = (name) => sheetA.root.all().find((e) => e.title === name || (e.title || "").startsWith(name + " ("));
    assert.equal(sheetBtn("Strikethrough").hidden, true);
    assert.ok(!sheetBtn("Bold (Ctrl+B)")?.hidden);
    const ta = prep(sheetA, "x", 0, 1);
    key(ta, "x", { ctrlKey: true, shiftKey: true, code: "KeyX" });
    assert.equal(ta.value, "x", "a hidden action has no shortcut");
    click(byLabel(sheetA, "Quick settings"));
    click(chipNamed(sheetA, "All settings\u2026"));
    click(chipNamed(sheetA, "Toolbar buttons\u2026"));
    click(chipNamed(sheetA, "Show all"));
    assert.equal(prefs.get(c.PREF.HIDDEN_TOOLS), "");
    assert.ok(!sheetBtn("Strikethrough").hidden);
    click(chipNamed(sheetA, "Done"));
    const again = prep(sheetA, "x", 0, 1);
    key(again, "x", { ctrlKey: true, shiftKey: true, code: "KeyX" });
    assert.equal(again.value, "~~x~~");
    prefs.delete(c.PREF.HIDDEN_TOOLS);
  });

  await test("B2 toolbar buttons exist, show their shortcut and act", async () => {
    for (const name of ["Inline code", "Code block", "Link\u2026", "Image", "Numbered list", "Table\u2026", "Quick settings"]) assert.ok(byLabel(sheetA, name), name);
    assert.match(byLabel(sheetA, "Inline code").title, /Ctrl\+Shift\+C/);
    const ta = prep(sheetA, "word", 0, 4);
    click(byLabel(sheetA, "Inline code"));
    assert.equal(ta.value, "`word`");
  });

  await test("B2 link dialog: text + address make a link; a bad address is refused", async () => {
    const ta = prep(sheetA, "see docs here", 4, 8);
    key(ta, "k", { ctrlKey: true, shiftKey: true, code: "KeyK" });
    const [textIn, addrIn] = sheetA.root.all().filter((e) => e._classes.has("zn-field"));
    assert.equal(textIn.value, "docs", "the selection becomes the label");
    addrIn.value = "javascript:alert(1)";
    click(chipNamed(sheetA, "Create link"));
    assert.ok(dialogOf(sheetA), "refused: the dialog stays");
    assert.equal(ta.value, "see docs here");
    addrIn.value = "https://example.org/a b";
    click(chipNamed(sheetA, "Create link"));
    assert.equal(dialogOf(sheetA), null);
    assert.equal(ta.value, "see [docs](https://example.org/a%20b) here");
  });

  await test("B2 pasting an address offers the link dialog; 'as text' and the off setting paste plainly", async () => {
    let ta = prep(sheetA, "see docs", 4, 8);
    const url = "https://example.org/page#:~:text=hello%20world";
    const paste = () => { const e = new Ev("paste", { clipboardData: { getData: () => url } }); ta.dispatchEvent(e); return e; };
    assert.ok(paste().defaultPrevented);
    click(chipNamed(sheetA, "Create link"));
    assert.equal(ta.value, "see [docs](" + url + ")");
    ta = prep(sheetA, "see ", 4, 4);
    assert.ok(paste().defaultPrevented, "no selection: still asks");
    assert.equal(sheetA.root.all().filter((e) => e._classes.has("zn-field"))[0].value, "hello world", "the highlighted words label the link");
    click(chipNamed(sheetA, "Paste as text"));
    assert.equal(ta.value, "see " + url);
    prefs.set(c.PREF.PASTE_LINK, "selection");
    ta = prep(sheetA, "see ", 4, 4);
    assert.ok(!paste().defaultPrevented, "only-over-selection: nothing selected pastes as usual");
    prefs.set(c.PREF.PASTE_LINK, "off");
    ta = prep(sheetA, "see docs", 4, 8);
    assert.ok(!paste().defaultPrevented);
    assert.ok(!new Ev("paste", { clipboardData: { getData: () => "plain words" } }).defaultPrevented);
    prefs.delete(c.PREF.PASTE_LINK);
  });

  await test("B2 table creator inserts the picked size", async () => {
    const ta = prep(sheetA, "", 0, 0);
    key(ta, "y", { ctrlKey: true, shiftKey: true, code: "KeyY" });
    const cell = sheetA.root.all().find((e) => e._classes.has("zn-gcell") && e.getAttribute("aria-label") === "3 columns, 2 rows");
    click(cell);
    // alignment per column: column 2 centre, column 3 right
    const rowOf = (n) => sheetA.root.all().filter((e) => e._classes.has("zn-quick-row") && e.textContent.startsWith("Column " + n))[0];
    const inRow = (n, name) => rowOf(n).all().find((e) => e._classes.has("zn-chip") && e.textContent === name);
    click(inRow(2, "Centre"));
    click(inRow(3, "Right"));
    click(chipNamed(sheetA, "Insert"));
    assert.equal(dialogOf(sheetA), null);
    const [t] = c.parseBlocks(ta.value);
    assert.equal(t.type, "table");
    assert.equal(t.head.length, 3);
    assert.equal(t.rows.length, 1);
    assert.equal(JSON.stringify(t.align), JSON.stringify(["", "center", "right"]));
  });

  await test("B2 quick settings change real preferences; shortcuts can be reassigned and conflicts are refused", async () => {
    click(byLabel(sheetA, "Quick settings"));
    assert.ok(dialogOf(sheetA));
    const row = (label) => sheetA.root.all().find((e) => e._classes.has("zn-quick-row") && e.children[0].textContent === label);
    click(row("Select and copy text in read view").children[1]);
    assert.equal(prefs.get(c.PREF.READ_COPY), true);
    assert.ok(!row("Text over === or --- is a heading"), "set-once options are not in the quick menu");
    click(row("Text size").children[3]);
    assert.equal(prefs.get(c.PREF.FONT_SIZE), 14);
    click(chipNamed(sheetA, "All settings\u2026"));
    const srow = (label) => sheetA.root.all().find((e) => e._classes.has("zn-set-row") && e.children[0].textContent === label);
    click(srow("Text over === or --- is a heading").children[1]);
    assert.equal(prefs.get(c.PREF.SETEXT), true);
    click(chipNamed(sheetA, "Keyboard shortcuts\u2026"));
    const krow = (label) => sheetA.root.all().find((e) => e._classes.has("zn-quick-row") && e.children[0].textContent === label);
    const btn = krow("Strikethrough").children[1];
    click(btn);
    const press = (k, extra) => key(sheetA.root.all().find((e) => e._classes.has("zn-keybtn") && e.textContent === "Press keys\u2026"), k, extra);
    press("b", { ctrlKey: true, code: "KeyB" });
    assert.match(q(sheetA, ".zn-key-note").textContent, /already used by Bold/);
    press("j", { ctrlKey: true, shiftKey: true, code: "KeyJ" });
    assert.equal(JSON.parse(prefs.get(c.PREF.SHORTCUTS)).strike, "Ctrl+Shift+J");
    click(chipNamed(sheetA, "Reset all"));
    assert.equal(prefs.get(c.PREF.SHORTCUTS), "");
    click(chipNamed(sheetA, "Back"));
    click(chipNamed(sheetA, "Done"));
    assert.equal(dialogOf(sheetA), null);
  });

  await test("R1 Settings view: tabs, a real slider and the colour picker write the look prefs; Theme puts them back", async () => {
    click(byLabel(sheetA, "Quick settings"));
    click(chipNamed(sheetA, "All settings\u2026"));
    click(chipNamed(sheetA, "Appearance"));
    const srow = (label) => sheetA.root.all().find((e) => e._classes.has("zn-set-row") && e.children[0].textContent === label);
    const radius = srow("Corner radius");
    const range = radius.children[1];
    range.value = "23";
    range.dispatchEvent(new Ev("input", { bubbles: true }));
    assert.equal(prefs.get(c.PREF.LOOK_RADIUS), 23, "any value, not a preset");
    click(radius.children[3]);
    assert.equal(prefs.get(c.PREF.LOOK_RADIUS), -1, "Theme clears it");
    const bgRow = srow("Background");
    click(bgRow.children[1]);
    const panel = bgRow.parent.children.find((e) => e._classes.has("zn-cpanel"));
    assert.equal(panel.hidden, false);
    const hex = panel.children.find((e) => e._classes.has("zn-hex"));
    hex.value = "#336699";
    hex.dispatchEvent(new Ev("input", { bubbles: true }));
    assert.equal(prefs.get(c.PREF.LOOK_BG), "#336699");
    click(chipNamed(sheetA, "Reset appearance"));
    assert.equal(prefs.get(c.PREF.LOOK_BG), "");
    click(chipNamed(sheetA, "Done"));
    assert.equal(dialogOf(sheetA), null);
  });

  sheetA.destroy(); sheetB.destroy();
  console.log(`\n${passed} notes UI tests passed`);
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
