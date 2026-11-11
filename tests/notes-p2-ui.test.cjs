"use strict";
/* Priority 2 through the real sheet code and a fake DOM: Ctrl+F find bar (next/previous/off-screen/other notes/read pane),
 * picture paste + picture options, and the reminder dialog. Does NOT prove layout, real scrolling, clipboard access,
 * sound or the Zen notification box. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
document.createRange = () => ({ setStart(n, s) { this.n = n; this.s = s; }, setEnd() {}, getBoundingClientRect() { return { top: this.s * 10, height: 10 }; } });
const selections = [];
const win = { __zentralNotesParts: { "notes-calendar": require("../additional/notes/calendar/ZentralNotesCalendar.js") }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {},
  getSelection: () => ({ removeAllRanges() { selections.length = 0; }, addRange(r) { selections.push(r); } }) };
win.window = win;
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array });
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
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }

(async () => {
  await store.open();
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  const q = (cls) => sheet.root.querySelector(cls);
  const qa = (cls) => sheet.root.querySelectorAll(cls);
  const menuItem = (label) => qa(".zn-menu-item").find((b) => b.textContent === label);
  const chipNamed = (label) => qa(".zn-chip").find((b) => b.textContent === label);
  sheet.root.ownerDocument = document;
  await sheet.open(); await flushRaf();
  const ta = q(".zn-editor"), bar = q(".zn-find"), input = q(".zn-find-input");
  ta.clientHeight = 200; ta.scrollHeight = 5000;
  const lines = Array.from({ length: 100 }, (_, i) => (i === 3 || i === 50 || i === 90 ? "Needle on line " + i : "filler " + i));
  const other1 = store.create("Other one\nhas a needle too"), other2 = store.create("Second other: NEEDLE"), other3 = store.create("unrelated"), gone = store.create("trashed needle");
  store.trash(gone.id); store.setLabel(other3.id, "Nothing");
  await wait(5);

  await test("Ctrl+F opens the find bar; it is hidden until then", async () => {
    dom.state.activeElement = ta;
    type(ta, lines.join("\n"));
    ta.setSelectionRange(0, 0);
    assert.equal(bar.hidden, true);
    const ev = key(ta, "f", { ctrlKey: true });
    assert.ok(ev.defaultPrevented, "Ctrl+F is ours, not the browser's");
    assert.equal(bar.hidden, false);
    assert.equal(dom.state.activeElement, input);
  });

  await test("matches are counted, other notes exclude the current and trashed ones", async () => {
    type(input, "needle");
    await wait(160);
    assert.equal(q(".zn-find-count").textContent, "1 of 3");
    assert.equal(q(".zn-find-others").textContent, "found in 2 other notes");
    assert.equal(ta.value.slice(ta.selectionStart, ta.selectionEnd), "Needle");
    assert.equal(ta.selectionStart, ta.value.indexOf("Needle"));
  });

  await test("next / previous wrap, select the match and scroll an off-screen one into view", async () => {
    ta.scrollTop = 0;
    key(input, "Enter");
    assert.equal(q(".zn-find-count").textContent, "2 of 3");
    assert.equal(ta.selectionStart, ta.value.indexOf("Needle on line 50"));
    assert.ok(ta.scrollTop > 0, "line 50 is far below the 200px view, the editor scrolled");
    key(input, "Enter"); key(input, "Enter");
    assert.equal(q(".zn-find-count").textContent, "1 of 3", "wraps to the first");
    assert.equal(ta.selectionStart, ta.value.indexOf("Needle on line 3"));
    key(input, "Enter", { shiftKey: true });
    assert.equal(q(".zn-find-count").textContent, "3 of 3", "Shift+Enter goes back and wraps");
    assert.equal(ta.selectionStart, ta.value.indexOf("Needle on line 90"));
    q(".zn-find-prev").click();
    assert.equal(q(".zn-find-count").textContent, "2 of 3");
    q(".zn-find-next").click();
    assert.equal(q(".zn-find-count").textContent, "3 of 3");
  });

  await test("the other-notes list opens a note and carries the search along", async () => {
    q(".zn-find-others").click();
    const labels = qa(".zn-menu-item").map((b) => b.textContent);
    assert.equal(labels.length, 2);
    assert.ok(labels.includes("Other one") && labels.includes("Second other: NEEDLE"));
    menuItem("Other one").click();
    await flushRaf();
    assert.equal(ta.value, other1.body);
    assert.equal(bar.hidden, false);
    assert.equal(input.value, "needle");
    assert.equal(q(".zn-find-count").textContent, "1 of 1");
    assert.equal(q(".zn-find-others").textContent, "found in 2 other notes", "the long note is now one of the others");
  });

  await test("read view searches the drawn text and selects the match there", async () => {
    key(ta, "e", { ctrlKey: true });
    await flushRaf();
    const read = q(".zn-read");
    read.clientHeight = 100; read.scrollTop = 0;
    assert.equal(read.hidden, false);
    assert.equal(q(".zn-find-count").textContent, "1 of 1");
    assert.ok(selections.length >= 1, "the match is selected in the read pane");
    key(read, "Escape");
    assert.equal(bar.hidden, true, "Esc closes the find bar first");
    assert.equal(sheet.isOpen(), true, "and does not close Notes");
    key(read, "e", { ctrlKey: true });
  });

  await test("empty and unmatched queries show no matches without errors", async () => {
    dom.state.activeElement = ta;
    key(ta, "f", { ctrlKey: true });
    type(input, "zzzz-not-here"); await wait(160);
    assert.equal(q(".zn-find-count").textContent, "No matches");
    assert.equal(q(".zn-find-others").textContent, "not found in other notes");
    key(input, "Enter");
    type(input, ""); await wait(160);
    assert.equal(q(".zn-find-count").textContent, "");
    key(input, "Escape");
    assert.equal(bar.hidden, true);
  });

  await test("pasting a picture saves it in the note's asset folder and inserts a relative link", async () => {
    const n = store.create("pictures here"); await flushRaf();
    sheet.openNoteById(n.id);
    dom.state.activeElement = ta;
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const paste = new Ev("paste", { clipboardData: { getData: () => "", items: [{ kind: "file", type: "image/png", getAsFile: () => ({ size: PNG.length, type: "image/png", arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) }) }] } });
    ta.dispatchEvent(paste);
    assert.ok(paste.defaultPrevented);
    await wait(30); await flushRaf();
    const m = /!\[image\]\((assets\/[^)]+)\)/.exec(ta.value);
    assert.ok(m, ta.value);
    assert.match(m[1], new RegExp("^assets/" + n.id + "/img-\\d{8}-\\d{6}-[0-9a-z]{3}\\.png$"));
    assert.ok(files.has("/n/" + m[1]));
    assert.equal(store.get(n.id).body, ta.value, "stored in the note");
  });

  await test("a clipboard that also has text is pasted as text, unsupported pictures are refused kindly", async () => {
    const before = ta.value;
    const textPaste = new Ev("paste", { clipboardData: { getData: () => "some words", items: [{ kind: "file", type: "image/png", getAsFile: () => ({}) }] } });
    ta.dispatchEvent(textPaste);
    assert.equal(textPaste.defaultPrevented, false);
    const bad = new Ev("paste", { clipboardData: { getData: () => "", items: [{ kind: "file", type: "image/png", getAsFile: () => ({ size: 12, type: "image/png", arrayBuffer: async () => Uint8Array.from(Buffer.from("MZ not an image")).buffer }) }] } });
    ta.dispatchEvent(bad);
    await wait(30); await flushRaf();
    assert.equal(ta.value, before);
    assert.match(q(".zn-status").textContent, /Only PNG, JPEG, GIF and WebP/);
  });

  await test("read view shows the picture from the local store; picture options set width and alignment", async () => {
    key(ta, "e", { ctrlKey: true }); await flushRaf(); await wait(10);
    const pic = q(".zn-read").all().find((e) => e.tag === "img");
    assert.ok(pic && /^blob:test\/assets\//.test(pic.getAttribute("src")), "loaded through env.loadAsset, never a network address");
    key(q(".zn-read"), "e", { ctrlKey: true }); await flushRaf();
    const at = ta.value.indexOf("](assets") + 3;
    ta.setSelectionRange(at, at);
    qa(".zn-btn").find((b) => /^More: pictures/.test(b.title)).click();
    assert.ok(menuItem("Picture options\u2026 (size, alignment)"), "reachable from the More menu");
    menuItem("Picture options\u2026 (size, alignment)").click();
    chipNamed("Centre").click();
    chipNamed("Medium").click();
    chipNamed("Apply").click();
    assert.match(ta.value, /\(assets\/[^)#]+#w=400&a=center\)/);
  });

  await test("reminder dialog: presets, validation, persistence, chip, clear", async () => {
    const n = store.create("call the bank"); await flushRaf();
    sheet.openNoteById(n.id);
    const more = qa(".zn-btn").find((b) => b.title === "More");
    more.click();
    menuItem("Remind me\u2026").click();
    const inputs = qa(".zn-field");
    const [d, t] = inputs.slice(-2);
    d.value = "2026-11-02"; t.value = "09:07";
    chipNamed("Set reminder").click();
    assert.equal(store.get(n.id).remind, new Date(2026, 10, 2, 9, 7).getTime(), "kept to the minute");
    assert.equal(q(".zn-remind").hidden, false);
    assert.match(q(".zn-remind").title, /Reminder: 2026-11-02 09:07/);
    // a time in the past is refused
    more.click(); qa(".zn-menu-item").find((b) => /^Reminder:/.test(b.textContent)).click();
    const [d2, t2] = qa(".zn-field").slice(-2);
    assert.match(q(".zn-remind-preview").textContent, /^Will ring at 2026-11-02 09:07 \(in /, "live preview under the inputs");
    d2.value = "2026-10-31"; t2.value = "09:00";
    chipNamed("Set reminder").click();
    assert.equal(t2.dataset.bad === "true" || d2.dataset.bad === "true", true);
    assert.equal(store.get(n.id).remind, new Date(2026, 10, 2, 9, 7).getTime(), "unchanged");
    chipNamed("Clear reminder").click();
    assert.equal(store.get(n.id).remind, 0);
    assert.equal(q(".zn-remind").hidden, true);
  });

  await test("reminder dialog: Pick day opens a mini calendar that fills the date, arrows move, Today works, second click closes it", async () => {
    const n = store.create("pick a day"); await flushRaf();
    sheet.openNoteById(n.id);
    qa(".zn-btn").find((b) => b.title === "More").click();
    menuItem("Remind me\u2026").click();
    assert.ok(!q(".zn-cal"), "closed at first");
    chipNamed("Pick day\u2026").click();
    assert.ok(q(".zn-cal"), "opened");
    assert.equal(qa(".zn-cal-day").length, 42);
    const day = qa(".zn-cal-day").find((b) => b.getAttribute("data-day") === String(new Date(2026, 10, 20).getTime()));
    day.click();
    const [d] = qa(".zn-field").slice(-2);
    assert.equal(d.value, "2026-11-20");
    assert.ok(qa(".zn-cal-day").find((b) => b.getAttribute("data-day") === String(new Date(2026, 10, 20).getTime())).classList.contains("is-picked"));
    const grid = q(".zn-cal-grid");
    key(grid, "ArrowRight"); key(grid, "Enter");
    assert.equal(d.value, "2026-11-21");
    chipNamed("Today").click();
    assert.equal(d.value, "2026-11-01");
    chipNamed("Pick day\u2026").click();
    assert.ok(!q(".zn-cal"), "closed again");
    chipNamed("Cancel").click();
  });

  await test("find highlight (#8): selection mode paints nothing extra; backdrop mode marks every match and the current one, follows scroll, clears on close", async () => {
    const note = store.create(lines.join("\n"));
    sheet.openNoteById(note.id); await flushRaf();
    dom.state.activeElement = ta;
    ta.setSelectionRange(0, 0);
    key(ta, "f", { ctrlKey: true });
    type(input, "needle"); await wait(160);
    const hl = q(".zn-findlayer");
    assert.equal(q(".zn-find-count").textContent, "1 of 3");
    assert.equal(hl.hidden, true, "default pref 'selection': no backdrop");
    prefs.set("zen.workspace.zentral.notes.find_highlight", "backdrop");
    try {
      type(input, "needl"); await wait(160); type(input, "needle"); await wait(160);
      assert.equal(hl.hidden, false);
      assert.equal(sheet.root.dataset.hl, "on");
      let marks = hl.querySelectorAll("mark");
      assert.equal(marks.length, 3, "all three matches are marked");
      assert.deepEqual(marks.map((m) => m.className), ["zn-findlayer-cur", "", ""]);
      assert.equal(hl.textContent, note.body + "\n", "the layer holds the same text as the editor plus a trailing newline");
      key(input, "Enter");
      marks = hl.querySelectorAll("mark");
      assert.deepEqual(marks.map((m) => m.className), ["", "zn-findlayer-cur", ""], "the current mark follows Enter");
      ta.scrollTop = 40; ta.dispatchEvent(new Ev("scroll", { bubbles: true }));
      assert.match(q(".zn-findlayer-inner").style.transform, /translate\(0px, -40px\)/, "the layer scrolls with the editor");
      type(input, "zzz"); await wait(160);
      assert.equal(hl.hidden, true, "no matches: nothing painted");
      type(input, "needle"); await wait(160);
      assert.equal(hl.hidden, false);
      q(".zn-find-close").click();
      assert.equal(hl.hidden, true, "closing find removes the highlights");
      assert.equal(sheet.root.dataset.hl, undefined);
    } finally {
      prefs.delete("zen.workspace.zentral.notes.find_highlight");
    }
  });

  await test("trash view (#30): banner says when notes are deleted and follows the pref", async () => {
    const t = store.create("Banner victim\nx"); store.trash(t.id); await flushRaf();
    q(".zn-title").click(); await flushRaf();
    qa(".zn-chip").find((b) => b.textContent.startsWith("Trash")).click(); await flushRaf();
    assert.match(q(".zn-trash-note").textContent, /^Notes are deleted 30 days after they were trashed, when Notes starts\. The next one expires in 30 days\.$/);
    prefs.set("zen.workspace.zentral.notes.trash_auto_empty_days", 0);
    try {
      chipNamed("Notes").click(); qa(".zn-chip").find((b) => b.textContent.startsWith("Trash")).click(); await flushRaf();
      assert.match(q(".zn-trash-note").textContent, /^Auto-empty is off/);
    } finally {
      prefs.delete("zen.workspace.zentral.notes.trash_auto_empty_days");
    }
  });

  await test("spell-check (#31): the editor follows the prefs when the footer updates", async () => {
    const n = store.create("Spelling note"); sheet.openNoteById(n.id); await flushRaf();
    dom.state.activeElement = ta;
    const K = "zen.workspace.zentral.notes.";
    try {
      type(ta, "short text"); await flushRaf();
      assert.equal(ta.spellcheck, true, "default on");
      prefs.set(K + "spellcheck", false);
      type(ta, "short text again"); await flushRaf();
      assert.equal(ta.spellcheck, false, "switched off in the settings");
      prefs.set(K + "spellcheck", true); prefs.set(K + "spellcheck_max_chars", 20);
      type(ta, "this note is now longer than twenty characters"); await flushRaf();
      assert.equal(ta.spellcheck, false, "over the limit");
      type(ta, "tiny"); await flushRaf();
      assert.equal(ta.spellcheck, true, "back under the limit");
    } finally {
      prefs.delete(K + "spellcheck"); prefs.delete(K + "spellcheck_max_chars");
    }
  });

  console.log(passed + " notes P2 UI tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
