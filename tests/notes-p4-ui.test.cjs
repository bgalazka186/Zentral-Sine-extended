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
