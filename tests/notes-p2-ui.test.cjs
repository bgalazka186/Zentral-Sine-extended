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

  await test("reminder dialog: shared date picker fills the date, arrows move, Today works, and the shared Clock chooses exact minutes", async () => {
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
    const [d, t] = qa(".zn-field").slice(-2);
    assert.equal(d.value, "2026-11-20");
    assert.ok(qa(".zn-cal-day").find((b) => b.getAttribute("data-day") === String(new Date(2026, 10, 20).getTime())).classList.contains("is-picked"));
    const grid = q(".zn-cal-grid");
    key(grid, "ArrowRight"); key(grid, "Enter");
    assert.equal(d.value, "2026-11-21");
    chipNamed("Today").click();
    assert.equal(d.value, "2026-11-01");
    chipNamed("Pick day\u2026").click();
    assert.ok(!q(".zn-cal"), "closed again");
    chipNamed("Pick day\u2026").click();
    const pickerGrid = q(".zn-cal-grid");
    key(pickerGrid, "Escape");
    assert.ok(!q(".zn-cal"), "Escape closes the picker");
    assert.equal(dom.state.activeElement, chipNamed("Pick day\u2026"), "closing returns focus to the opening control");
    chipNamed("Clock\u2026").click();
    assert.ok(q(".zn-cal-clock"), "Clock opens its keyboard-accessible hour/minute controls");
    const hour = q(".zn-cal-clock-hour"), minute = q(".zn-cal-clock-minute");
    hour.value = "14"; hour.dispatchEvent(new Ev("change", { bubbles: true }));
    minute.value = "37"; minute.dispatchEvent(new Ev("change", { bubbles: true }));
    assert.equal(t.value, "14:37", "hour and minute are written back exactly");
    assert.match(q(".zn-remind-preview").textContent, /14:37/, "the live reminder preview follows the clock");
    chipNamed("Clock\u2026").click();
    assert.ok(!q(".zn-cal-clock"), "second click closes the Clock chooser");
    chipNamed("Cancel").click();
  });

  await test("Notes by date reuses the same date picker as reminders", async () => {
    qa(".zn-btn").find((b) => b.title === "More").click();
    menuItem("Links & dates").click();
    menuItem("Notes by date\u2026").click();
    await new Promise((r) => setImmediate(r));
    menuItem("Other date\u2026").click();
    await new Promise((r) => setImmediate(r));
    assert.ok(q(".zn-dialog-card"), "the date note dialog is open");
    chipNamed("Pick day\u2026").click();
    assert.ok(q(".zn-cal"), "the shared calendar is offered here too");
    const chosen = new Date(2026, 10, 19).getTime();
    qa(".zn-cal-day").find((b) => b.getAttribute("data-day") === String(chosen)).click();
    assert.equal(qa(".zn-field").slice(-1)[0].value, "2026-11-19");
    chipNamed("Open").click();
    await flushRaf();
    assert.ok(store.list().some((x) => c.dateOfNote(x) === "2026-11-19"), "the selected date opens or creates its date note");
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

  await test("T2.3e: moving a note with several calendar and legacy reminders warns, Cancel preserves it, confirm hides the reminders", async () => {
    const n = store.create("# Reminder-heavy note\n\n## Appointments\n%%calendar: Work%%\n- 2026-11-02 First call\n- 2026-11-03 Second call\n");
    store.setReminder(n.id, new Date(2026, 10, 4, 9, 0).getTime());
    sheet.openNoteById(n.id); await flushRaf();
    qa(".zn-btn").find((b) => b.title === "More").click();
    menuItem("Move to trash").click();
    assert.match(q(".zn-dialog-card").textContent, /3 reminders/);
    assert.match(q(".zn-dialog-card").textContent, /hidden while the note is in Trash/);
    assert.equal(store.get(n.id).trashed, 0, "the note has not moved before confirmation");
    chipNamed("Cancel").click();
    assert.equal(store.get(n.id).trashed, 0, "Cancel keeps the note and all reminders");
    qa(".zn-btn").find((b) => b.title === "More").click();
    menuItem("Move to trash").click();
    chipNamed("Move to Trash").click();
    assert.ok(store.get(n.id).trashed, "the confirmed note enters Trash");
    assert.equal(store.items.list({ noteId: n.id }).length, 0, "its calendar items are hidden");
    assert.equal(store.items.list({ noteId: n.id, includeHidden: true }).length, 2, "both stored items remain for restore/permanent-delete handling");
  });

  await test("T2.3e: notes without reminders keep the existing no-prompt Trash flow", async () => {
    const n = store.create("Plain note, no reminders");
    sheet.openNoteById(n.id); await flushRaf();
    qa(".zn-btn").find((b) => b.title === "More").click();
    menuItem("Move to trash").click();
    assert.ok(store.get(n.id).trashed, "no warning is needed for a note without reminders");
    assert.equal(q(".zn-dialog-card"), null, "no confirmation dialog was opened");
  });

  await test("T2.3e: permanent-delete and Empty Trash warnings include reminders hidden inside Trash", async () => {
    const n = store.create("# Stored reminders\n\n%%calendar: Work%%\n- 2026-11-05 Alpha\n- 2026-11-06 Beta\n");
    store.trash(n.id); await flushRaf();
    q(".zn-title").click(); await flushRaf();
    qa(".zn-chip").find((b) => b.textContent.startsWith("Trash")).click(); await flushRaf();
    const row = qa(".zn-item").find((el) => el.getAttribute("data-id") === n.id);
    assert.ok(row, "the reminder-bearing note is in the Trash list");
    row.dispatchEvent(new Ev("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    menuItem("Delete forever").click();
    assert.match(q(".zn-dialog-card").textContent, /2 reminders/);
    assert.match(q(".zn-dialog-card").textContent, /Permanently deleting it/);
    chipNamed("Cancel").click();
    assert.ok(store.get(n.id), "cancel keeps the trashed note");

    const empty = qa(".zn-chip").find((b) => b.textContent === "Empty trash");
    empty.dispatchEvent(new Ev("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    menuItem("Empty trash now").click();
    const message = q(".zn-dialog-card").textContent;
    assert.match(message, /will permanently delete \d+ notes/);
    assert.match(message, /2 notes contain 5 reminders/);
    chipNamed("Cancel").click();
    assert.ok(store.get(n.id), "cancel keeps the entire Trash contents");
    sheet.openNoteById(other1.id); await flushRaf(); // leave the following trash-view test in its expected editor state
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

  await test("T2.2b: plain-text dates become accessible chips, while math, code and links stay literal", async () => {
    const n = store.create("# Dates\nToday @today, ISO 2026-11-03, 10-08, 03.12., 03.12 and 25 listopada 2026.\n\nMath $10-08$;\n\n$$\n10-08\n$$\n\ncode `10-08`; link [10-08](https://example.test/10-08); HTML <a href='https://example.test/10-08'>10-08</a>.");
    sheet.openNoteById(n.id); await flushRaf();
    if (q(".zn-read").hidden) key(ta, "e", { ctrlKey: true });
    await flushRaf();
    const chips = qa(".zn-date-chip");
    assert.deepEqual(chips.map((b) => b.dataset.raw), ["@today", "2026-11-03", "10-08", "03.12.", "25 listopada 2026"]);
    assert.equal(q(".zn-read").textContent.includes("03.12 and"), true, "ambiguous 03.12 remains clock-like/plain text");
    assert.equal(qa(".zn-link .zn-date-chip").length, 0, "Markdown and HTML link labels are never rewritten into date chips");
    const iso = chips.find((b) => b.dataset.raw === "2026-11-03");
    assert.equal(iso.textContent, "03-11-2026", "date-chip labels use the display preference while their dataset key stays ISO");
    assert.equal(iso.dataset.ymd, "2026-11-03");
    iso.click();
    assert.ok(menuItem("Open note for 2026-11-03"), "left-click opens the date action menu");
    menuItem("Open note for 2026-11-03").click();
    await flushRaf();
    assert.ok(store.list().some((x) => c.dateOfNote(x) === "2026-11-03"), "opening a date creates or opens its date note");
  });

  await test("T2.12c: date menu can create an independent reminder with a chosen date and optional time", async () => {
    const n = store.create("Pay the invoice on 2026-11-05");
    sheet.openNoteById(n.id); await flushRaf();
    if (q(".zn-read").hidden) key(ta, "e", { ctrlKey: true });
    await flushRaf();
    const chip = qa(".zn-date-chip").find((b) => b.dataset.raw === "2026-11-05");
    assert.ok(chip, "ISO date is interactive");
    chip.dispatchEvent(new Ev("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    menuItem("Mark as reminder\u2026").click();
    await Promise.resolve();
    const composer = q(".zn-cal-compose-card");
    assert.ok(composer, "date conversion opens the full event/reminder composer");
    const dateField = composer.querySelector('[aria-label="Start date"]');
    assert.equal(dateField.value, "2026-11-05");
    assert.equal(composer.querySelector('[aria-label="Title"]').value, "Pay the invoice", "the title is derived from the captured sentence, not the note title");
    const allDay = composer.querySelector('[aria-label="All-day"]');
    assert.equal(allDay.checked, true, "date-only conversion starts as an all-day reminder");
    allDay.checked = false; allDay.dispatchEvent(new Ev("change"));
    composer.querySelectorAll("button").find((button) => button.textContent.trim() === "Clock…").click();
    const clock = composer.querySelector(".zn-cal-clock-set");
    const hour = clock.querySelector(".zn-cal-clock-hour"), minute = clock.querySelector(".zn-cal-clock-minute");
    hour.value = "15"; hour.dispatchEvent(new Ev("change"));
    minute.value = "20"; minute.dispatchEvent(new Ev("change"));
    composer.querySelectorAll("button").find((button) => button.textContent.trim() === "Create reminder").click();
    const created = store.items.list({ noteId: n.id });
    assert.equal(created.length, 1, "creates a separate stored item, not the legacy note.remind field");
    assert.equal(created[0].x.kind, "reminder");
    assert.equal(created[0].x.src, "manual");
    assert.equal(new Date(Date.parse(created[0].start.dateTime)).getHours(), 15);
    assert.equal(new Date(Date.parse(created[0].start.dateTime)).getMinutes(), 20);
  });

  await test("T2.12c: Not a date persists an ignore mark and keeps an event when the ignored date is only in its summary", async () => {
    const n = store.create("# Plan\n\n%%calendar: Work%%\n- 2026-11-12 Dentist 10-08\n- 10-08 Birthday\n");
    sheet.openNoteById(n.id); await flushRaf();
    if (q(".zn-read").hidden) key(ta, "e", { ctrlKey: true });
    await flushRaf();
    const embedded = qa(".zn-date-chip").find((b) => b.dataset.raw === "10-08");
    embedded.dispatchEvent(new Ev("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    menuItem("Not a date").click();
    assert.ok(store.get(n.id).body.includes("%%zn-date-ignore:10-08%%"), "the ignore mark is stored in the note text even when a stable line ID is also present");
    assert.equal(store.items.list({ noteId: n.id }).length, 2, "an ignored date inside a summary does not remove the event");
    assert.equal(qa(".zn-date-chip").some((b) => b.dataset.raw === "10-08" && b.dataset.line === "3"), false, "the ignored occurrence is no longer a chip");
    const leading = qa(".zn-date-chip").find((b) => b.dataset.raw === "10-08");
    assert.ok(leading, "the second, independent leading date remains interactive");
    leading.dispatchEvent(new Ev("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
    menuItem("Not a date").click();
    assert.equal(store.items.list({ noteId: n.id }).length, 1, "ignoring a date prefix removes only that date-driven item");
    assert.equal(store.items.list({ noteId: n.id })[0].summary, "Dentist 10-08");
  });

  await test("T2.12c: Add link to Tomorrow creates a dated backlink under the Tomorrow heading", async () => {
    const n = store.create("# Source\n\nWe should prepare on 2026-11-06.");
    sheet.openNoteById(n.id); await flushRaf();
    if (q(".zn-read").hidden) key(ta, "e", { ctrlKey: true });
    await flushRaf();
    qa(".zn-date-chip").find((b) => b.dataset.raw === "2026-11-06").click();
    menuItem("Add link to Tomorrow").click();
    assert.match(store.get(n.id).body, /## Tomorrow\n- 2026-11-06 \[\[Source#Source\]\]/);
  });

  await test("T2.3b: category button creates a category, marks the current calendar section and shows its colour", async () => {
    const n = store.create("# Project plan\n\n- 2026-11-20 Ship the first milestone\n");
    sheet.openNoteById(n.id); await flushRaf();
    if (!q(".zn-read").hidden) key(ta, "e", { ctrlKey: true });
    await flushRaf();
    const categoryButton = q(".zn-category-btn");
    assert.ok(categoryButton && !categoryButton.hidden, "category control is available in the editor");
    const caret = ta.value.indexOf("Ship the first milestone");
    ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Ev("keyup", { bubbles: true, key: "ArrowRight" }));
    await flushRaf();
    categoryButton.click();
    assert.ok(menuItem("Create category…"), "menu offers category creation");
    menuItem("Create category…").click();
    await Promise.resolve();
    const nameField = qa(".zn-field").find((input) => input.getAttribute("aria-label") === "Category name");
    assert.ok(nameField, "new category name field appears");
    type(nameField, "Projects");
    chipNamed("Save category").click();
    await flushRaf();
    assert.match(store.get(n.id).body, /%%calendar: Projects%%/, "category marker is inserted at the current section");
    assert.equal(store.items.category("Projects").name, "Projects", "category metadata is saved");
    assert.equal(categoryButton.textContent.includes("Projects"), true, "header shows the active category");
  });

  await test("T2.3c: calendar details edit one same-day item without merging its sibling reminder", async () => {
    const n = store.create("# Plan\n\n%%calendar: Projects%%\n- 2026-11-20 06:00-08:00 Morning shift\n- 2026-11-20 09:00 Follow-up reminder\n");
    sheet.openNoteById(n.id); await flushRaf();
    if (q(".zn-read").hidden) key(ta, "e", { ctrlKey: true });
    await flushRaf();
    const items = store.items.list({ noteId: n.id });
    assert.equal(items.length, 2, "both same-day items exist independently");
    const morning = items.find((item) => item.summary === "Morning shift");
    assert.ok(morning);
    const dateChip = qa(".zn-date-chip").find((b) => b.dataset.ymd === "2026-11-20");
    assert.ok(dateChip, "the source date is interactive");
    dateChip.click();
    menuItem("Edit calendar item for this date…").click();
    const option = qa(".zn-menu-item").find((b) => b.textContent.includes("Morning shift"));
    assert.ok(option, "the menu lists the individual calendar item");
    option.click();
    await new Promise((r) => setImmediate(r));
    const calendarNote = qa(".zn-calendar-note-field")[0];
    const heading = qa(".zn-field").find((input) => input.getAttribute("aria-label") === "Heading jump target");
    const zone = qa(".zn-field").find((input) => input.getAttribute("aria-label") === "Time zone (IANA; blank = local)");
    assert.ok(calendarNote && heading && zone, "calendar note, heading and time-zone controls are present");
    type(calendarNote, "Bring the access badge and check the handover notes.");
    type(heading, "Morning shifts");
    type(zone, "Europe/Warsaw");
    const frequency = qa("select").find((select) => select.getAttribute("aria-label") === "Repeat frequency");
    const interval = qa(".zn-field").find((input) => input.getAttribute("aria-label") === "Repeat interval");
    const ending = qa("select").find((select) => select.getAttribute("aria-label") === "Repeat ending");
    const count = qa(".zn-field").find((input) => input.getAttribute("aria-label") === "Repeat occurrence count");
    assert.ok(frequency && interval && ending && count, "recurrence controls are present in the same item editor");
    frequency.value = "WEEKLY"; frequency.dispatchEvent(new Ev("change", { bubbles: true }));
    type(interval, "2");
    const tuesday = qa("input").find((input) => input.getAttribute("aria-label") === "Tue");
    const thursday = qa("input").find((input) => input.getAttribute("aria-label") === "Thu");
    const friday = qa("input").find((input) => input.getAttribute("aria-label") === "Fri");
    assert.ok(tuesday && thursday && friday);
    tuesday.checked = true; thursday.checked = true; friday.checked = false;
    ending.value = "count"; ending.dispatchEvent(new Ev("change", { bubbles: true }));
    type(count, "6");
    chipNamed("Save calendar details").click();
    await flushRaf();
    const saved = store.items.get(morning.id);
    assert.equal(saved.x.calNote, "Bring the access badge and check the handover notes.");
    assert.equal(saved.x.heading, "Morning shifts");
    assert.equal(saved.x.tz, "Europe/Warsaw");
    assert.deepEqual(saved.recurrence, ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=6"]);

    // Reopen the same item's editor: recurrence state is loaded, and UNTIL can replace COUNT.
    dateChip.click(); menuItem("Edit calendar item for this date…").click();
    qa(".zn-menu-item").find((b) => b.textContent.includes("Morning shift")).click();
    await new Promise((r) => setImmediate(r));
    const reopenedFrequency = qa("select").find((select) => select.getAttribute("aria-label") === "Repeat frequency");
    const reopenedInterval = qa(".zn-field").find((input) => input.getAttribute("aria-label") === "Repeat interval");
    const reopenedEnding = qa("select").find((select) => select.getAttribute("aria-label") === "Repeat ending");
    const until = qa(".zn-field").find((input) => input.getAttribute("aria-label") === "Last occurrence date");
    assert.equal(reopenedFrequency.value, "WEEKLY");
    assert.equal(reopenedInterval.value, "2");
    reopenedEnding.value = "until"; reopenedEnding.dispatchEvent(new Ev("change", { bubbles: true }));
    type(until, "2026-12-31");
    chipNamed("Save calendar details").click();
    await flushRaf();
    assert.deepEqual(store.items.get(morning.id).recurrence, ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261231"]);
    assert.equal(store.items.get(items[1].id).summary, items[1].summary, "the sibling item is untouched");
    assert.equal(store.items.list({ noteId: n.id }).length, 2, "editing details does not merge or drop reminders");
    const invalid = store.items.upsert({ ...store.items.get(morning.id), x: { ...store.items.get(morning.id).x, tz: "Not/A_Real_Zone" } });
    assert.equal(invalid.x.tz, "", "invalid IANA zones are normalized away by the item model");
  });

  console.log(passed + " notes P2 UI tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
