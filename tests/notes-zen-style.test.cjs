"use strict";
/* Folder identity (T3.2 / Cycle H #6b), folder colour + emoji (T3.4 / S6 W2), note favicons (T3.5 / S6 W1) and the sidebar safety rules.
 * Fake DOM with a generic copy of the Zen sidebar structure (tests/helpers/fake-dom.cjs zenSidebar()). Proves the logic and the DOM
 * wiring; NOT how a real Zen build renders the result. */
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
const disk = new Map();
const mkio = () => ({
  join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
  readUTF8: async (p) => { if (!disk.has(p)) throw new Error("nf " + p); return disk.get(p).text; },
  writeUTF8: async (p, text) => { disk.set(p, { text, mtime: 1 }); },
  remove: async (p) => { disk.delete(p); }, exists: async (p) => disk.has(p),
  children: async (d) => [...new Set([...disk.keys()].filter((k) => k.startsWith(d + "/")).map((k) => d + "/" + k.slice(d.length + 1).split("/")[0]))],
  stat: async (p) => { const e = disk.get(p); if (!e) throw new Error("nf"); return { size: e.text.length, lastModified: 1 }; },
  makeDir: async () => {}, writeBytes: async () => {}, readBytes: async () => new Uint8Array(), removeTree: async () => {}, restrict: async () => {},
});
const mkstore = () => c.createStore({ io: mkio(), notify() {}, windowId: "t", now: () => Date.UTC(2026, 10, 2, 8, 0, 0), getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: () => 0, clearTimer() {} });
const reopen = async (store) => { await store.flush(); const s2 = mkstore(); await s2.open(); return s2; };
const seq = (n) => { let i = 0; return () => ((i++ * 7 + n) % 36) / 36; };

(async () => {
  // ------------------------------------------------------------------ folder uid (T3.2)
  await test("uid: every new folder gets one; it is random, valid and unique", () => {
    const a = c.addFolderMeta([], [], "", "Work", seq(1)), b = c.addFolderMeta(a.folders, [], "", "Home", seq(1));
    assert.match(a.uid, c.FOLDER_UID_RE); assert.notEqual(a.uid, b.uid, "a clash with a taken uid is avoided");
    assert.ok(!a.uid.includes("work"), "never derived from the name");
  });
  await test("uid: cleanFolders keeps valid uids, drops bad or duplicate ones, and leaves old folders without the field", () => {
    const l = c.cleanFolders([{ id: "a", uid: "fabcdefgh12" }, { id: "b", uid: "fabcdefgh12" }, { id: "c", uid: "DROP TABLE" }, { id: "d" }]);
    assert.equal(l[0].uid, "fabcdefgh12"); assert.ok(!("uid" in l[1]) && !("uid" in l[2]) && !("uid" in l[3]));
  });
  await test("uid: ensureFolderUids backfills listed, note-only and parent folders; second run changes nothing", () => {
    const notes = [{ id: "n1", folder: "a/b/c", body: "x" }];
    const r = c.ensureFolderUids([{ id: "x", label: "X", order: 0, collapsed: false }], notes, seq(3));
    assert.equal(r.changed, true);
    eq(J(r.folders.map((f) => f.id).sort()), ["a", "a/b", "a/b/c", "x"]);
    assert.equal(new Set(r.folders.map((f) => f.uid)).size, 4, "all different");
    for (const f of r.folders) assert.match(f.uid, c.FOLDER_UID_RE);
    const again = c.ensureFolderUids(r.folders, notes, seq(9));
    assert.equal(again.changed, false); eq(J(again.folders), J(r.folders));
  });
  await test("uid: survives rename, move, reload and a note changing folder; a deleted folder's uid is gone", async () => {
    disk.clear();
    let store = mkstore(); await store.open();
    store.addFolder("Work"); store.addFolder("Deep", "work"); store.addFolder("Other");
    const uw = store.folderUid("work"), ud = store.folderUid("work/deep"), uo = store.folderUid("other");
    assert.ok(uw && ud && uo && new Set([uw, ud, uo]).size === 3);
    store.renameFolder("work", "Projects"); assert.equal(store.folderUid("work"), uw, "rename keeps the uid");
    store.moveFolder("work", "other"); // the path id changes (other/work), the identity must not
    assert.equal(store.folderUid("other/work"), uw, "move keeps the uid"); assert.equal(store.folderUid("other/work/deep"), ud, "so do its subfolders");
    assert.equal(store.folderUid("work"), "", "the old path names nothing now");
    store = await reopen(store);
    assert.equal(store.folderUid("other/work"), uw, "reload keeps it"); assert.equal(store.folderUid("other"), uo);
    store.removeFolder("other/work/deep", "toRoot"); assert.equal(store.folderUid("other/work/deep"), "");
  });
  await test("uid: a store from before this feature (no uids; a folder only a note names) gets uids on open, and keeps them", async () => {
    disk.clear();
    disk.set("/n/meta.json", { text: JSON.stringify({ folders: [{ id: "old", label: "Old", order: 0, collapsed: false }] }), mtime: 1 });
    disk.set("/n/20260101-0000-aaaa.md", { text: "---\nid: 20260101-0000-aaaa\nfolder: ghost/inner\n---\nHello", mtime: 1 });
    let store = mkstore(); await store.open();
    const ids = ["old", "ghost", "ghost/inner"].map((i) => store.folderUid(i));
    assert.ok(ids.every(Boolean) && new Set(ids).size === 3, "listed, note-only and parent folder all have a uid");
    store = await reopen(store);
    eq(["old", "ghost", "ghost/inner"].map((i) => store.folderUid(i)), ids);
  });

  // ------------------------------------------------------------------ colour + icon (T3.4)
  await test("icon: exactly one emoji is accepted (also flags, keycaps, joined and skin-tone sequences); text and markup are refused", () => {
    for (const ok of ["📓", "🗂️", "👨‍👩‍👧", "🇵🇱", "1️⃣", "👍🏽", "❤️"]) assert.equal(c.cleanFolderIcon(ok), ok, ok);
    for (const bad of ["", "a", "ab", "<b>", "📓📓", "📓 x", "javascript:1", "x".repeat(30), 5, null]) assert.equal(c.cleanFolderIcon(bad), "", String(bad));
    assert.equal(c.cleanFolderColor("teal"), "teal"); assert.equal(c.cleanFolderColor("none"), ""); assert.equal(c.cleanFolderColor("#ff0000"), "");
  });
  await test("style: setFolderStyle stores colour and icon on the folder, the tree shows them, bad values are refused, uid unchanged", async () => {
    disk.clear();
    let store = mkstore(); await store.open();
    store.addFolder("Work"); const uid = store.folderUid("work");
    assert.equal(store.setFolderStyle("work", { color: "red", icon: "📓" }), true);
    let node = store.tree().children.find((n) => n.id === "work");
    assert.equal(node.color, "red"); assert.equal(node.icon, "📓"); assert.equal(node.uid, uid);
    assert.equal(store.setFolderStyle("work", { icon: "<img>" }), false, "refused"); assert.equal(store.setFolderStyle("work", { color: "#fff" }), false);
    node = store.tree().children.find((n) => n.id === "work"); assert.equal(node.icon, "📓", "a refused change leaves the old value");
    store = await reopen(store); node = store.tree().children.find((n) => n.id === "work");
    assert.equal(node.color, "red"); assert.equal(node.icon, "📓"); assert.equal(node.uid, uid, "persisted");
    store.moveFolder("work", ""); store.addFolder("Dest"); store.moveFolder("work", "dest");
    node = store.tree().children.find((n) => n.id === "dest").children.find((n) => n.id === "dest/work");
    assert.equal(node.color, "red", "colour and icon travel with a moved folder"); assert.equal(node.icon, "📓");
    store.setFolderStyle("dest/work", { color: "", icon: "" }); node = store.tree().children.find((n) => n.id === "dest").children[0];
    assert.equal(node.color, ""); assert.equal(node.icon, "", "empty string clears");
  });

  // ------------------------------------------------------------------ Zen projection keyed by uid (T3.2 -> T3.4 check)
  await test("projection: a folder's Zen key is its uid, so a rename is only a relabel and a move only a move (never remove + add)", async () => {
    disk.clear();
    const store = mkstore(); await store.open();
    store.addFolder("Work"); store.addFolder("Dest"); store.create("T", "work");
    const wantOf = () => c.projectZen(store.list(), store.meta.folders, "all", "folders-first");
    const before = wantOf(); const fw = before.find((e) => e.id === "work");
    assert.equal(fw.key, "f:" + store.folderUid("work"));
    const asBrowser = (w) => J(w).map((e) => ({ key: e.key, label: e.label, parent: e.parent, color: e.color, icon: e.icon }));
    store.renameFolder("work", "Projects");
    let d = c.diffProjection(asBrowser(before), wantOf());
    eq(J(d.add), []); eq(J(d.remove), []); eq(J(d.relabel).map((r) => r.key), [fw.key]);
    const mid = wantOf(); store.moveFolder("work", "dest");
    d = c.diffProjection(asBrowser(mid), wantOf());
    eq(J(d.add), [], "nothing new to create"); eq(J(d.remove), [], "nothing to close"); assert.ok(J(d.move).some((m) => m.key === fw.key), "the folder itself moves");
    const after = wantOf(); store.setFolderStyle("dest/work", { color: "blue", icon: "🧪" });
    d = c.diffProjection(asBrowser(after), wantOf());
    eq(J(d.restyle).find((r) => r.key === fw.key), { key: fw.key, kind: "folder", color: "blue", icon: "🧪" });
    eq(J(d.restyle).filter((r) => r.kind === "note").map((r) => r.color), ["blue"], "the note inside takes the new folder colour for its favicon");
    eq(J(d.add), []); eq(J(d.relabel), []);
  });
  await test("projection: without a uid (old data) the key stays the path; note colour 'none' is no colour", () => {
    const w = c.projectZen([{ id: "n1", folder: "a", body: "T", color: "none", updated: 1 }, { id: "n2", folder: "a", body: "U", color: "green", updated: 2 }], [{ id: "a", label: "A", order: 0, collapsed: false }], "all");
    assert.ok(w.some((e) => e.key === "f:a")); assert.equal(w.find((e) => e.key === "n:n1").color, ""); assert.equal(w.find((e) => e.key === "n:n2").color, "green");
  });
  await test("favicon colour: a note with no colour takes its folder's colour (nearest folder wins); its own colour wins over both", () => {
    const folders = [{ id: "a", label: "A", order: 0, collapsed: false, color: "red" }, { id: "a/b", label: "B", order: 0, collapsed: false }, { id: "a/c", label: "C", order: 1, collapsed: false, color: "blue" }];
    const notes = [{ id: "n1", folder: "a", body: "x", color: "none", updated: 1 }, { id: "n2", folder: "a/b", body: "y", updated: 2 }, { id: "n3", folder: "a/c", body: "z", updated: 3 }, { id: "n4", folder: "a", body: "w", color: "green", updated: 4 }, { id: "n5", folder: "", body: "v", updated: 5 }];
    const w = c.projectZen(notes, folders, "all"); const col = (id) => w.find((e) => e.key === "n:" + id).color;
    eq([col("n1"), col("n2"), col("n3"), col("n4"), col("n5")], ["red", "red", "blue", "green", ""]);
  });
  await test("projection: restyle is empty when the browser already shows the same colour/icon; an entry that reports none counts as none", () => {
    const want = [{ key: "n:1", kind: "note", label: "x", parent: "", color: "" }, { key: "f:q", kind: "folder", label: "F", parent: "", color: "red", icon: "📓" }];
    eq(J(c.diffProjection([{ key: "n:1", label: "x", parent: "" }, { key: "f:q", label: "F", parent: "", color: "red", icon: "📓" }], want).restyle), []);
    eq(J(c.diffProjection([{ key: "n:1", label: "x", parent: "", color: "?" }, { key: "f:q", label: "F", parent: "", color: "red", icon: "?" }], want).restyle).map((r) => r.key), ["n:1", "f:q"], '"?" means the browser lost it: put it back');
  });

  // ------------------------------------------------------------------ tint + favicon (pure)
  await test("tint: no colour = Zen's own workspace values; a colour sets all seven properties; unknown names fall back", () => {
    eq(J(c.folderTint("")), J(c.ZEN_TINT_DEFAULT)); eq(J(c.folderTint("nope")), J(c.ZEN_TINT_DEFAULT));
    const t = c.folderTint("teal"); eq(Object.keys(t).sort(), Object.keys(c.ZEN_TINT_DEFAULT).sort());
    assert.equal(t["--tab-group-color"], c.TINT_HEX.teal);
    for (const name of c.FOLDER_COLORS) assert.ok(c.TINT_HEX[name], name + " has a hex value");
  });
  await test("favicon: a data: svg in the note's colour (gray without one), nothing outside the palette can get in", () => {
    const u = c.noteFaviconUri("red"); assert.ok(u.startsWith("data:image/svg+xml,"));
    const svg = decodeURIComponent(u.slice("data:image/svg+xml,".length)); assert.ok(svg.includes(c.TINT_HEX.red) && svg.startsWith("<svg"));
    assert.ok(decodeURIComponent(c.noteFaviconUri("").slice(19)).includes(c.TINT_HEX.gray));
    const evil = decodeURIComponent(c.noteFaviconUri('"/><script>x</script>').slice(19)); assert.ok(!evil.includes("script") && evil.includes(c.TINT_HEX.gray));
    assert.notEqual(c.noteFaviconUri("red"), c.noteFaviconUri("blue"));
  });

  // ------------------------------------------------------------------ the fake DOM itself matches the shape of the real one
  const sb = () => dom.zenSidebar();
  await test("fake DOM: selectors the Notes code uses work on the generic Zen sidebar copy", () => {
    const z = sb(); const root = z.folder("NOTES", { id: "notes-root", attrs: { "bgalazka-notes-folder": "true" } }); const sub = z.folder("Sub", { parent: root.querySelector(".tab-group-container") });
    const t1 = root.addTab(z.tab("One", { "bgalazka-notes-item": "n:1" })); const t2 = sub.addTab(z.tab("Mine"));
    assert.equal(document.querySelectorAll('zen-folder[bgalazka-notes-folder="true"]').length, 1);
    assert.equal(document.querySelectorAll("zen-folder").length, 2);
    assert.equal(document.querySelectorAll("tab:not([bgalazka-notes-item])").length, 1); assert.equal(document.querySelectorAll("tab[bgalazka-notes-item]")[0], t1);
    assert.ok(root.querySelector(".tab-group-folder-icon g.icon image")); assert.equal(root.querySelectorAll("tab, zen-folder").length, 3);
    assert.equal(t2.closest("zen-folder"), sub); assert.equal(t2.closest('zen-folder[bgalazka-notes-folder="true"]'), root);
    assert.ok(z.pinned.querySelector("zen-folder")); assert.equal(root.style.getPropertyValue("--tab-group-color"), "var(--tab-group-zen-workspace-color)");
    assert.equal(t1.localName, "tab"); assert.equal(t1.nodeType, 1);
    z.ws.remove();
  });

  // ------------------------------------------------------------------ DOM side of favicons and folder style
  await test("favicon on a note tab: image attr + img src set, gBrowser.setIcon used, healed after the browser replaces it, cleared when switched off", () => {
    const z = sb(); const tab = z.tab("Note", { "bgalazka-notes-item": "n:1" }); z.folder("NOTES").addTab(tab);
    const calls = []; const gBrowser = { setIcon: (t, u) => calls.push(u) };
    c.setNotesTabIcon(tab, "green", { gBrowser, on: true });
    const uri = c.noteFaviconUri("green");
    assert.equal(tab.getAttribute("image"), uri); assert.equal(tab.querySelector(".tab-icon-image").getAttribute("src"), uri); eq(calls, [uri]);
    assert.equal(tab.getAttribute("bgalazka-notes-color"), "green"); assert.equal(c.notesTabColor(tab, true), "green");
    tab.setAttribute("image", "data:image/x-icon;base64,AAAA"); // Zen / a discard put its own icon back
    assert.equal(c.notesTabColor(tab, true), "?", "reported as lost so the next run restores it");
    c.setNotesTabIcon(tab, "green", { gBrowser, on: true }); assert.equal(c.notesTabColor(tab, true), "green");
    c.setNotesTabIcon(tab, "", { gBrowser, on: true }); assert.equal(tab.getAttribute("image"), c.noteFaviconUri(""), "no colour = the gray default icon");
    c.setNotesTabIcon(tab, "green", { gBrowser, on: false });
    assert.equal(tab.hasAttribute("image"), false, "pref off: our icon is removed again"); assert.equal(c.notesTabColor(tab, false), "green");
    tab.setAttribute("image", "data:image/png;base64,AAAA"); c.setNotesTabIcon(tab, "red", { gBrowser, on: false });
    assert.equal(tab.getAttribute("image"), "data:image/png;base64,AAAA", "a real favicon that is not ours is never touched");
    z.ws.remove();
  });
  await test("folder style in the sidebar: tint properties + emoji drawn into Zen's own icon, restored on clear, lost icon reported", () => {
    const z = sb(); const f = z.folder("Sub");
    const img = f.querySelector(".tab-group-folder-icon g.icon image");
    c.applyNotesFolderStyle(f, "purple", "📓", { doc: document });
    assert.equal(f.style.getPropertyValue("--tab-group-color"), c.TINT_HEX.purple); assert.equal(f.getAttribute("bgalazka-notes-color"), "purple");
    const text = f.querySelector(".tab-group-folder-icon g.icon text"); assert.ok(text && text.textContent === "📓"); assert.equal(img.style.display, "none", "Zen's own image is hidden, not removed");
    assert.equal(c.notesFolderIcon(f), "📓");
    c.applyNotesFolderStyle(f, "purple", "📓", { doc: document }); assert.equal(f.querySelectorAll(".tab-group-folder-icon text").length, 1, "idempotent: one emoji");
    c.applyNotesFolderStyle(f, "purple", "🧪", { doc: document }); assert.equal(f.querySelector("g.icon text").textContent, "🧪");
    text.remove(); // Zen redrew the icon
    assert.equal(c.notesFolderIcon(f), "?");
    c.applyNotesFolderStyle(f, "", "", { doc: document });
    eq(Object.fromEntries(Object.keys(c.ZEN_TINT_DEFAULT).map((k) => [k, f.style.getPropertyValue(k)])), J(c.ZEN_TINT_DEFAULT), "Zen's own values are back");
    assert.equal(f.hasAttribute("bgalazka-notes-color"), false); assert.equal(f.hasAttribute("bgalazka-notes-icon"), false);
    assert.equal(f.querySelector("g.icon text"), null); assert.notEqual(img.style.display, "none"); assert.equal(c.notesFolderIcon(f), "");
    z.ws.remove();
  });

  // ------------------------------------------------------------------ never lose what the person put in a folder
  await test("dedupe: of several NOTES roots the first is adopted, one holding only our tabs is deleted, one with the person's tab is released and keeps it", () => {
    const z = sb(); const mark = { "bgalazka-notes-folder": "true" };
    const first = z.folder("NOTES", { id: "r1", attrs: mark }); first.addTab(z.tab("n", { "bgalazka-notes-item": "n:1" }));
    const dupOurs = z.folder("NOTES", { id: "r2", attrs: mark }); dupOurs.addTab(z.tab("n", { "bgalazka-notes-item": "n:2" }));
    const dupMine = z.folder("NOTES", { id: "r3", attrs: mark }); const mine = dupMine.addTab(z.tab("my tab")); dupMine.addTab(z.tab("n", { "bgalazka-notes-item": "n:3" }));
    const removed = []; c.dedupeNotesRoots(document, { removeTab: (t) => { removed.push(t); t.remove(); } });
    assert.ok(first.isConnected, "adopted"); assert.equal(dupOurs.isConnected, false, "only ours: deleted");
    assert.ok(dupMine.isConnected && mine.isConnected, "the person's tab and its folder survive");
    assert.equal(dupMine.hasAttribute("bgalazka-notes-folder"), false, "released: no longer ours");
    assert.ok(!removed.includes(mine));
    assert.equal(document.querySelectorAll('zen-folder[bgalazka-notes-folder="true"]').length, 1);
    c.dedupeNotesRoots(document, { removeTab: (t) => t.remove() }); assert.equal(document.querySelectorAll('zen-folder[bgalazka-notes-folder="true"]').length, 1, "idempotent");
    z.ws.remove();
  });
  await test("planRootDedupe: pure decision; nothing to do with one or no root", () => {
    eq(J(c.planRootDedupe([])), { adopt: -1, remove: [], release: [] }); eq(J(c.planRootDedupe([{ ours: 1, foreign: 0 }])), { adopt: 0, remove: [], release: [] });
    eq(J(c.planRootDedupe([{ ours: 1, foreign: 5 }, { ours: 2, foreign: 0 }, { ours: 0, foreign: 1 }, { ours: 0, foreign: 0 }])), { adopt: 0, remove: [1, 3], release: [2] });
  });
  await test("switching the feature off: a folder with the person's own tab is released, never deleted; one with only ours is deleted", () => {
    const z = sb(); const mark = { "bgalazka-notes-folder": "true" };
    const mixed = z.folder("NOTES", { id: "m", attrs: mark }); const mine = mixed.addTab(z.tab("keep me")); mixed.addTab(z.tab("n", { "bgalazka-notes-item": "n:1" }));
    c.retireNotesFolder(mixed, (t) => t.remove()); assert.ok(mixed.isConnected && mine.isConnected); assert.equal(mixed.hasAttribute("bgalazka-notes-folder"), false);
    assert.equal(mixed.querySelectorAll("tab[bgalazka-notes-item]").length, 0, "our own tab is gone");
    const only = z.folder("NOTES", { id: "o", attrs: mark }); only.addTab(z.tab("n", { "bgalazka-notes-item": "n:2" }));
    c.retireNotesFolder(only, (t) => t.remove()); assert.equal(only.isConnected, false);
    z.ws.remove();
  });

  // ------------------------------------------------------------------ Notes UI: the folder dialog
  await test("Notes UI: 'Color and icon…' saves colour and emoji; a non-emoji is refused and the dialog stays", async () => {
    disk.clear();
    const store = mkstore(); await store.open(); store.addFolder("Work"); store.create("In folder", "work"); await store.flush();
    const prefs = new Map();
    const env = { openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {}, getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), setPref: (k, v) => prefs.set(k, v) };
    const host = new El("div");
    const adapter = { position: "fixed", host, geoKey: "g", attach: (r) => host.appendChild(r), getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
    const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
    sheet.root.ownerDocument = document; await sheet.open();
    const flush = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
    await flush();
    const q = (sel) => sheet.root.querySelector(sel); const all = () => sheet.root.all();
    const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
    all().find((e) => e.title === "All notes").click(); await flush(); // the tree is shown on the "All notes" list
    const more = all().find((e) => e.tag === "button" && (e.getAttribute("aria-label") === "Folder menu" || e.title === "Folder menu")); assert.ok(more, "folder row with its menu button");
    click(more); await flush();
    const entry = all().find((e) => e.tag === "button" && e.textContent.startsWith("Color and icon")); assert.ok(entry, "menu entry exists");
    click(entry); await flush();
    const input = all().find((e) => e.tag === "input" && e.maxLength === 24 || (e.tag === "input" && e.attrs.get("placeholder")?.startsWith("e.g.") && e.maxLength === 24));
    assert.ok(input, "emoji field");
    const chipBtn = (label) => all().find((e) => e.tag === "button" && e.textContent === label);
    click(chipBtn("Teal") || all().find((e) => e.tag === "button" && e.dataset.color === "teal"));
    input.value = "not an emoji"; click(chipBtn("Save")); await flush();
    assert.equal(input.dataset.bad, "true"); assert.equal(store.tree().children.find((n) => n.id === "work").icon, "", "refused, nothing stored");
    input.value = "📓"; click(chipBtn("Save")); await flush();
    const node = store.tree().children.find((n) => n.id === "work"); assert.equal(node.color, "teal"); assert.equal(node.icon, "📓");
    const row = all().find((e) => e.getAttribute("data-fid") === "work"); assert.equal(row.dataset.color, "teal"); assert.ok(row.textContent.includes("📓"));
  });
  // ------------------------------------------------------------------ live-test fixes (3.2.2)
  await test("folder icon: the three --zen-folder-* variables Zen's icon reads are set on the folder, per colour, and removed again", () => {
    const z = sb(); const f = z.folder("Sub");
    const zenDefault = f.cssVar("--zen-folder-front-bgcolor"); assert.ok(zenDefault.includes("--zen-primary-color"), "Zen's own rule applies before any override");
    c.applyNotesFolderStyle(f, "purple", "", { doc: document });
    for (const k of c.ZEN_FOLDER_VARS) assert.ok(f.style.getPropertyValue(k).includes(c.TINT_HEX.purple), k + " uses the palette colour");
    assert.ok(f.style.getPropertyValue("--zen-folder-front-bgcolor").includes("white 70%"), "Zen's own formula, palette colour in place of the primary colour");
    c.applyNotesFolderStyle(f, "", "", { doc: document });
    for (const k of c.ZEN_FOLDER_VARS) assert.equal(f.style.getPropertyValue(k), "", k + " removed");
    assert.equal(f.cssVar("--zen-folder-front-bgcolor"), zenDefault, "back to Zen's own colours");
    eq(J(c.folderZenVars("")), {}); eq(J(c.folderZenVars("nope")), {});
    // the real icon shapes read these variables through inline styles, so a value on the folder is what reaches them
    for (const sel of [".back", ".front", ".dots"]) assert.ok(f.querySelector(".tab-group-folder-icon " + sel).getAttribute("style").includes("var(--zen-folder-"), sel);
    z.ws.remove();
  });
  await test("restart: a restored sub-folder (static id, no attributes) is adopted, not duplicated; keys round-trip through the id", () => {
    for (const key of ["f:work", "f:work/deep-1", "f:a/b/c"]) assert.equal(c.notesKeyFromId(c.notesSubId(key)), key);
    assert.equal(c.notesKeyFromId("some-other-folder"), ""); assert.equal(c.notesKeyFromId(c.NOTES_ZEN_ROOT_ID), ""); assert.equal(c.notesKeyFromId(c.NOTES_ZEN_ROOT_ID + "-sub_"), "");
    const z = sb();
    const root = z.folder("NOTES", { id: c.NOTES_ZEN_ROOT_ID, attrs: { "bgalazka-notes-folder": "true" } });
    // what Zen restores: id and label, none of our attributes
    const work = z.folder("Work", { id: c.notesSubId("f:work"), parent: root.querySelector(".tab-group-container") });
    root.addFolder(work);
    const deep = z.folder("Deep", { id: c.notesSubId("f:work/deep") }); work.addFolder(deep);
    const mine = z.folder("My own folder", { id: "person-made" }); root.addFolder(mine);
    assert.equal(c.adoptNotesSubfolders(root), 2);
    assert.equal(work.getAttribute("bgalazka-notes-subfolder"), "f:work"); assert.equal(work.getAttribute("bgalazka-notes-parent"), ""); assert.equal(work.getAttribute("bgalazka-notes-label"), "Work");
    assert.equal(deep.getAttribute("bgalazka-notes-subfolder"), "f:work/deep"); assert.equal(deep.getAttribute("bgalazka-notes-parent"), "f:work");
    assert.equal(mine.hasAttribute("bgalazka-notes-subfolder"), false, "a folder the person made inside NOTES is never claimed");
    assert.equal(c.adoptNotesSubfolders(root), 0, "idempotent");
    z.ws.remove();
  });
  await test("contrast: an armed tool and a #tag never use the accent (Zen's primary colour, can be near-black) as text or ring colour", () => {
    const block = (sel) => { const i = css.indexOf(sel + " {"); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf("}", i)); };
    for (const sel of [".zentral-notes-sheet .zn-btn.is-armed", ".zentral-notes-sheet .zn-read .zn-tag"]) {
      const b = block(sel);
      assert.ok(!/(^|[^-])color:\s*var\(--zn-accent/.test(b), sel + " text colour is not the bare accent");
      assert.ok(!/box-shadow:[^;]*var\(--zn-accent\)/.test(b), sel + " ring is not the bare accent");
      assert.ok(/--zn-text/.test(b), sel + " is built from the text colour");
    }
  });
  console.log(`\n${passed} folder identity / style tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
