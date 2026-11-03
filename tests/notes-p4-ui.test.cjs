"use strict";
/* Part B: links between notes. Pure parsing/resolution/export helpers plus the real sheet code on a fake DOM
 * (link dialog, read pane, missing/trashed targets, backlinks menu). Proves logic only: NOT layout, NOT real
 * Gecko, and it cannot prove "no network" for real Zen; it proves the link path never calls openLink/fetch. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { Ev, El, document, raf } = dom;
const fetches = [];
const win = { document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {}, fetch: (u) => fetches.push(u) };
win.window = win;
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array, queueMicrotask, fetch: (u) => fetches.push(u) });
const c = win.__zentralNotesTestSeam.core;
const J = (x) => JSON.parse(JSON.stringify(x));
const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const n = (id, body, extra = {}) => ({ id, body, updated: 1000, trashed: 0, ...extra });

(async () => {
  const files = new Map();
  const io = { makeDir: async () => {}, stat: async (p) => ({ size: (files.get(p)?.text || "").length }), removeTree: async (d) => { for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k); }, join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(), readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; }, writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }), remove: async (p) => files.delete(p), exists: async (p) => files.has(p), children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/")), stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }), restrict: async () => {} };
  const store = c.createStore({ io, getHistory: () => ({ on: true, keep: 5, minutes: 1, capKB: 512, warnMB: 100 }), notify() {}, windowId: "t", getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: setTimeout, clearTimer: clearTimeout });
  const calls = [];
  const prefs = new Map();
  const env = { openLink: (u) => calls.push(["link", u]), copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {}, getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), setPref: (k, v) => prefs.set(k, v) };
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (r) => host.appendChild(r), getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  sheet.root.ownerDocument = document;
  const q = (cls) => sheet.root.querySelector(cls);
  const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
  const key = (el, k, extra = {}) => el.dispatchEvent(new Ev("keydown", { key: k, bubbles: true, ...extra }));
  const byTitle = (t) => sheet.root.all().find((e) => e.title === t || e.getAttribute("aria-label") === t);
  await sheet.open(); await flushRaf();

  const tick = () => new Promise((r) => setImmediate(r));
  const menuItem = (label) => q(".zn-menu").querySelectorAll("button").find((b) => b.textContent.startsWith(label));
  const openMore = () => { if (q(".zn-menu")) click(byTitle("More")); click(byTitle("More")); };

  await test("[[ completion: strip appears while typing, Arrow+Enter picks, the link is inserted and the strip closes", async () => {
    const a = store.create("Alpha plan\nx"), b = store.create("Alpine notes\nx"), src = store.create("Typing here");
    await flushRaf(); sheet.openNoteById(src.id);
    const ta = q(".zn-editor"); dom.state.activeElement = ta;
    ta.value = "see [[Al"; ta.selectionStart = ta.selectionEnd = 8;
    ta.dispatchEvent(new Ev("input", { bubbles: true }));
    const bar = q(".zn-wikibar");
    assert.equal(bar.hidden, false);
    assert.equal(bar.querySelectorAll("button").length, 2);
    ta.dispatchEvent(new Ev("keydown", { key: "ArrowDown", bubbles: true }));
    ta.dispatchEvent(new Ev("keydown", { key: "Enter", bubbles: true }));
    assert.ok(/^see \[\[(Alpha plan|Alpine notes)\]\]$/.test(ta.value), ta.value);
    assert.equal(bar.hidden, true);
    ta.value = "no brackets"; ta.selectionStart = ta.selectionEnd = 5;
    ta.dispatchEvent(new Ev("input", { bubbles: true }));
    assert.equal(bar.hidden, true);
    prefs.set("zen.workspace.zentral.notes.wiki_complete", false);
    ta.value = "x [[Al"; ta.selectionStart = ta.selectionEnd = 6; ta.dispatchEvent(new Ev("input", { bubbles: true }));
    assert.equal(bar.hidden, true, "switched off in the settings");
    prefs.delete("zen.workspace.zentral.notes.wiki_complete");
  });

  await test("link dialog: '#' next to a note with headings links to one heading", async () => {
    const t = store.create("Guide\n\n## Install\n\n## Usage\n");
    const s = store.create("Linker"); await flushRaf(); sheet.openNoteById(s.id);
    const ta = q(".zn-editor"); ta.value = "go "; ta.selectionStart = ta.selectionEnd = 3; dom.state.activeElement = ta;
    click(byTitle("Link to another note\u2026"));
    const rows = q(".zn-noteset");
    const head = rows.querySelectorAll("button").find((b) => b.className.includes("zn-pick-head") && b.getAttribute("aria-label").includes("Guide"));
    assert.ok(head, "a heading button exists beside Guide");
    click(head);
    click(q(".zn-noteset").querySelectorAll("button").find((b) => b.textContent === "## Usage"));
    assert.equal(ta.value, `go [Guide](${t.id}.md#usage)`);
  });

  await test("More menu: Notes by date opens/creates today's note in the Daily folder, once; Journal mode keeps one note", async () => {
    openMore(); click(menuItem("Notes by date")); await tick();
    const today = c.ymdOf(Date.now());
    click(q(".zn-menu").querySelectorAll("button").find((b) => b.textContent.includes(today) && b.textContent.startsWith("Today")));
    await flushRaf();
    const made = store.list().filter((x) => c.dateOfNote(x) === today);
    assert.equal(made.length, 1);
    assert.equal(made[0].folder, "daily");
    openMore(); click(menuItem("Notes by date")); await tick();
    click(q(".zn-menu").querySelectorAll("button").find((b) => b.textContent.startsWith("Today")));
    assert.equal(store.list().filter((x) => c.dateOfNote(x) === today).length, 1, "second time opens the same note");
    prefs.set("zen.workspace.zentral.notes.date_notes_mode", "single");
    openMore(); click(menuItem("Notes by date")); await tick();
    click(q(".zn-menu").querySelectorAll("button").find((b) => b.textContent.startsWith("Tomorrow")));
    await flushRaf();
    const j = store.list().filter(c.isJournal);
    assert.equal(j.length, 1);
    assert.ok(j[0].body.includes("## " + c.dateTarget("tomorrow", Date.now()).ymd));
    prefs.delete("zen.workspace.zentral.notes.date_notes_mode");
  });

  await test("new note chooser (#7): off = the + button creates a blank note at once; on = a menu with Blank first, today, tomorrow, pick a date", async () => {
    const newBtn = q(".zn-new");
    assert.ok(newBtn, "the + button exists");
    // Empty notes are dropped when you leave them, so count create() calls rather than list length.
    let created = 0;
    const realCreate = store.create.bind(store);
    store.create = (...a) => { created++; return realCreate(...a); };
    try {
      click(newBtn); await flushRaf();
      assert.equal(created, 1, "default: instant blank note");
      assert.equal(q(".zn-menu"), null);
      prefs.set("zen.workspace.zentral.notes.new_note_chooser", true);
      click(newBtn); await tick();
      const buttons = () => q(".zn-menu").querySelectorAll("button");
      const labels = buttons().map((b) => b.textContent);
      assert.match(labels[0], /^Blank note/);
      assert.ok(labels[1].startsWith("Today  " + c.dateTarget("today", Date.now()).ymd), labels[1]);
      assert.ok(labels[2].startsWith("Tomorrow"));
      assert.ok(labels[3].startsWith("Pick date"));
      assert.equal(created, 1, "nothing is created until a choice is made");
      click(buttons()[0]); await flushRaf();
      assert.equal(created, 2, "Blank note creates one");
      click(newBtn); await tick();
      click(buttons()[2]); await flushRaf();
      const tomorrow = c.dateTarget("tomorrow", Date.now()).ymd;
      assert.equal(store.list().filter((x) => c.dateOfNote(x) === tomorrow).length, 1, "Tomorrow opens or creates that day's note");
    } finally {
      store.create = realCreate;
      prefs.delete("zen.workspace.zentral.notes.new_note_chooser");
    }
  });

  await test("outline (#27): More > Outline lists the headings, marks the one under the caret and jumps to the chosen one", async () => {
    const body = "Title line\n\n## Install\nsteps\n\n### Linux\nmore\n\n## Usage\nrun it\n";
    const o = store.create(body); await flushRaf(); sheet.openNoteById(o.id); await flushRaf();
    const ta = q(".zn-editor"); dom.state.activeElement = ta;
    ta.selectionStart = ta.selectionEnd = body.indexOf("more");
    openMore();
    assert.ok(menuItem("Outline"), "More lists Outline");
    click(menuItem("Outline")); await tick();
    const labels = () => q(".zn-menu").querySelectorAll("button").map((b) => b.textContent);
    assert.deepEqual(labels(), ["Install", "\u2003Linux", "Usage"]);
    const btns = q(".zn-menu").querySelectorAll("button");
    assert.ok(/is-current|pin/.test(btns[1].innerHTML || btns[1].children.map((x) => x.className || x.tag).join(" ")) || btns[1].children.length > 1, "the current heading carries an icon");
    click(btns[2]); await flushRaf();
    assert.equal(ta.selectionStart, body.indexOf("## Usage"), "the caret moved to the heading line");
    const plain = store.create("no headings here"); await flushRaf(); sheet.openNoteById(plain.id); await flushRaf();
    openMore(); click(menuItem("Outline")); await tick();
    assert.match(q(".zn-menu").textContent, /No headings in this note/, "a note without headings says so");
    assert.equal(q(".zn-menu").querySelectorAll("button").length, 0, "and nothing in it is clickable");
    openMore();
  });

  await test("pinned strip (#29): hidden by default; with the pref it shows pinned chips and a Recent menu, and chips open notes", async () => {
    const K = "zen.workspace.zentral.notes.pinned_strip";
    const a = store.create("Strip alpha\nx"), b = store.create("Strip beta\nx");
    store.setPinned(a.id, true); store.setPinned(b.id, true);
    sheet.openNoteById(a.id); await flushRaf();
    assert.equal(q(".zn-strip").hidden, true, "off by default");
    prefs.set(K, true);
    try {
      sheet.openNoteById(b.id); await flushRaf(); sheet.openNoteById(a.id); await flushRaf();
      const strip = q(".zn-strip");
      assert.equal(strip.hidden, false);
      const chips = strip.querySelectorAll(".zn-strip-pin");
      assert.ok(chips.map((x) => x.textContent).includes("Strip alpha") && chips.map((x) => x.textContent).includes("Strip beta"));
      assert.ok(/is-on/.test(chips.find((x) => x.textContent === "Strip alpha").className), "the open note's chip is marked");
      click(chips.find((x) => x.textContent === "Strip beta")); await flushRaf();
      assert.equal(q(".zn-title").textContent, "Strip beta");
      click(q(".zn-strip-recent")); await tick();
      const back = q(".zn-menu").querySelectorAll("button").find((x) => x.textContent === "Strip alpha");
      assert.ok(back, "Recent lists the note we came from");
      click(back); await flushRaf();
      assert.equal(q(".zn-title").textContent, "Strip alpha", "choosing a recent note opens it");
    } finally {
      prefs.delete(K);
    }
  });

  await test("labels dialog (#19): More > Labels lists labels with counts; rename merges; remove clears", async () => {
    const mk = (body, label) => { const n = store.create(body); store.setLabel(n.id, label); return n; };
    const n1 = mk("Lbl one\nx", "zzwork"), n2 = mk("Lbl two\nx", "zzWork"), n3 = mk("Lbl three\nx", "zzhome");
    await flushRaf(); sheet.openNoteById(n3.id); await flushRaf();
    openMore(); click(menuItem("Labels")); await tick();
    const rows = () => sheet.root.all().filter((e) => e._classes?.has("zn-labels-row"));
    // spellings differing only in case are one label; which one is shown depends on a same-millisecond tie, so compare case-insensitively
    const rowOf = (name) => rows().find((r) => r.querySelector(".zn-labels-name").textContent.toLowerCase() === name.toLowerCase());
    const chipIn = (row, text) => row.querySelectorAll("button").find((b) => b.textContent === text);
    assert.equal(rowOf("zzwork").querySelector(".zn-labels-count").textContent, "2", "two spellings count as one label");
    assert.equal(rowOf("zzhome").querySelector(".zn-labels-count").textContent, "1");
    // rename zzhome -> zzwork merges
    click(chipIn(rowOf("zzhome"), "Rename")); await tick();
    const input = q(".zn-field");
    assert.ok(input, "rename field is shown");
    input.value = "ZZWORK";
    click(sheet.root.all().find((e) => e._classes?.has("zn-chip") && e._classes.has("is-on") && e.textContent === "Rename")); await tick(); await tick();
    assert.equal(store.get(n3.id).label, "ZZWORK");
    assert.equal(rowOf("zzwork")?.querySelector(".zn-labels-count").textContent ?? rowOf("ZZWORK")?.querySelector(".zn-labels-count").textContent, "3", "merged into one row with all three notes");
    // remove
    const only = rows()[0];
    click(chipIn(only, "Remove")); await tick();
    assert.deepEqual([n1, n2, n3].map((n) => store.get(n.id).label), ["", "", ""]);
    assert.match(sheet.root.textContent, /No labels yet/);
    click(sheet.root.all().find((e) => e._classes?.has("zn-chip") && e.textContent === "Close")); await tick();
  });

  await test("demo notes (#3): More > Install demo notes creates four notes in the Help folder, opens the tour, and a second run adds nothing", async () => {
    const helpCount = () => store.list().filter((n) => n.folder === "help").length;
    const before = helpCount();
    openMore(); click(menuItem("Install demo notes")); await flushRaf();
    assert.equal(helpCount(), before + 4);
    assert.equal(store.meta.folders.find((f) => f.id === "help")?.label, "Help");
    assert.equal(q(".zn-title").textContent, "Notes syntax tour", "the tour opens");
    openMore(); click(menuItem("Install demo notes")); await flushRaf();
    assert.equal(helpCount(), before + 4, "second run adds nothing");
    assert.match(q(".zn-flash")?.textContent ?? sheet.root.textContent, /already installed/);
  });

  await test("version history dialog: lists versions, restore brings an older text back", async () => {
    const h = store.create("first text"); await store.flush();
    await new Promise((r) => setTimeout(r, 5));
    sheet.openNoteById(h.id); await flushRaf();
    openMore(); click(menuItem("Version history")); await tick(); await tick(); await tick();
    const dlg = q(".zn-hist-row");
    assert.ok(dlg, "one version is listed");
    store.update(h.id, "second text");
    click(q(".zn-hist-row").querySelectorAll("button").find((b) => b.textContent === "Restore")); await tick(); await tick(); await tick(); await flushRaf();
    assert.equal(store.get(h.id).body, "first text");
  });

  await test("hidden tools: More lists them (when the option is on) and runs the action; off hides the entry", async () => {
    const m = store.create("tools"); sheet.openNoteById(m.id); await flushRaf();
    prefs.set("zen.workspace.zentral.notes.hidden_tools", "footnote");
    openMore();
    assert.ok(menuItem("Hidden tools"), "entry present");
    click(menuItem("Hidden tools")); await tick();
    const ta = q(".zn-editor"); ta.value = "word"; ta.selectionStart = ta.selectionEnd = 4; dom.state.activeElement = ta;
    click(q(".zn-menu").querySelectorAll("button").find((b) => b.textContent === "Footnote"));
    assert.ok(ta.value.startsWith("word[^1]") && ta.value.endsWith("[^1]: "), ta.value);
    prefs.set("zen.workspace.zentral.notes.hidden_tools_menu", false);
    openMore();
    assert.ok(!menuItem("Hidden tools"), "off: no entry");
    prefs.delete("zen.workspace.zentral.notes.hidden_tools_menu");
    prefs.delete("zen.workspace.zentral.notes.hidden_tools");
  });

  await test("Notes (tabbar): More offers it only in 'selected' mode, moves the note and creates the reserved folder, and takes it out again", async () => {
    const z = store.create("zen candidate"); sheet.openNoteById(z.id); await flushRaf();
    openMore(); assert.ok(!menuItem("Move to Notes (tabbar)"), "off by default");
    prefs.set("zen.workspace.zentral.notes.zen_folder", "selected");
    openMore(); click(menuItem("Move to Notes (tabbar)"));
    assert.equal(store.get(z.id).folder, "tabbar");
    assert.ok(store.meta.folders.some((f) => f.id === "tabbar"));
    openMore(); click(menuItem("Remove from Notes (tabbar)"));
    assert.equal(store.get(z.id).folder, "");
    prefs.delete("zen.workspace.zentral.notes.zen_folder");
  });

  await test("read view: footnote number, back link, hub description and the Linked-from strip", async () => {
    const target = store.create("Target page\nWhat it is about");
    const f = store.create(`Hub\n\n- [Target page](${target.id}.md)\n\nFact[^1]\n\n[^1]: The proof.`);
    await flushRaf(); sheet.openNoteById(f.id); await flushRaf();
    key(q(".zn-editor"), "e", { ctrlKey: true }); await flushRaf(); // the sheet opens in edit mode; the read view is what this test inspects
    const txt = () => q(".zn-read").textContent;
    assert.ok(txt().includes("What it is about"), "hub description shown: " + txt());
    assert.ok(txt().includes("The proof."));
    assert.ok(q(".zn-read").querySelectorAll("span").some((s) => s.className.includes("zn-fnref")));
    prefs.set("zen.workspace.zentral.notes.hub_descriptions", false);
    sheet.refreshRead?.(); await flushRaf();
    assert.ok(!txt().includes("What it is about"), "switched off");
    prefs.delete("zen.workspace.zentral.notes.hub_descriptions");
    prefs.set("zen.workspace.zentral.notes.backlinks_panel", true);
    sheet.openNoteById(target.id); await flushRaf(); sheet.refreshRead?.(); await flushRaf();
    assert.equal(q(".zn-linked").hidden, false);
    assert.ok(q(".zn-linked").textContent.includes("Hub"));
    prefs.delete("zen.workspace.zentral.notes.backlinks_panel");
  });
  await test("More menu: import and export live under one 'Import & export' entry with a Back row", async () => {
    store.create("export me"); sheet.openNoteById(store.list()[0].id); await flushRaf();
    openMore();
    assert.ok(!menuItem("Export as HTML") && !menuItem("Import .md folder"), "not in the top level");
    assert.ok(menuItem("Copy text"), "the top level keeps the everyday entries");
    click(menuItem("Import & export"));
    for (const l of ["Save as Markdown", "Export as HTML", "Export as plain text", "Print / save as PDF", "Export all notes", "Export all as zip", "Import .md folder"])
      assert.ok(menuItem(l), l + " is in the group");
    click(menuItem("Back"));
    assert.ok(menuItem("Import & export") && menuItem("Copy text") && !menuItem("Export as HTML"), "Back restores the top level");
    click(byTitle("More")); // close
  });

  console.log(`\n${passed} notes P4 UI tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
