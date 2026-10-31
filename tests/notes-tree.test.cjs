"use strict";
/* D2 folder/tree regression tests for Zentral Notes.
 * Covers the pure folder model, store persistence, the rendered All Notes tree and drag/drop.
 * UI assertions use the shared fake DOM; actual Zen/Gecko layout and filesystem permissions still need live testing. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const win = {
  document,
  ZentralRuntime: { register() {} },
  __zentralNotesTestSeam: {},
  requestAnimationFrame: (fn) => raf.push(fn),
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
};
win.window = win;
vm.runInNewContext(source, {
  window: win,
  document,
  Event: Ev,
  globalThis: { Services: {} },
  ChromeUtils: {},
  console,
  URL,
  Date,
  JSON,
  Math,
  Promise,
  RegExp,
  Number,
  Map,
  Set,
  setTimeout,
  clearTimeout,
  navigator: { platform: "Linux" },
});
const c = win.__zentralNotesTestSeam.core;
const flushRaf = async () => {
  for (let i = 0; i < 5; i++) {
    raf.splice(0).forEach((fn) => fn());
    await new Promise((resolve) => setImmediate(resolve));
  }
};
const files = new Map();
const io = {
  join: (...parts) => parts.join("/"),
  filename: (p) => p.split("/").pop(),
  async readUTF8(p) {
    if (!files.has(p)) throw new Error("NotFound " + p);
    return files.get(p).text;
  },
  async writeUTF8(p, text, opts = {}) {
    if (opts.backupFile && files.has(p)) files.set(opts.backupFile, { text: files.get(p).text, mtime: Date.now() });
    files.set(p, { text, mtime: Date.now() });
  },
  async remove(p) { files.delete(p); },
  async exists(p) { return files.has(p); },
  async children(dir) { return [...files.keys()].filter((p) => p.startsWith(dir + "/") && !p.slice(dir.length + 1).includes("/")); },
  async stat(p) { if (!files.has(p)) throw new Error("NotFound"); return { lastModified: files.get(p).mtime }; },
  async restrict() {},
};
async function makeStore(id = "tree-test") {
  const store = c.createStore({
    io,
    notify() {},
    windowId: id,
    getDir: async () => "/notes",
    getMaxSaveMs: () => 1000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });
  await store.open();
  return store;
}
function makeAdapter() {
  const host = new El("div");
  return {
    position: "fixed",
    host,
    attach: (root) => host.appendChild(root),
    getArea: () => ({ left: 0, top: 0, width: 420, height: 620, anchor: "top" }),
    watch: () => () => {},
    rewatch() {},
    setActive() {},
  };
}
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

(async () => {
  await test("folder ids are validated, depth-limited and normalized into readable collision-free slugs", () => {
    assert.equal(c.cleanFolder("work/projects"), "work/projects");
    for (const bad of ["../work", "Work", "a/b/c/d/e", "a b", "a\\b"]) assert.equal(c.cleanFolder(bad), "", bad);
    assert.equal(c.cleanFolder("work//ideas"), "work/ideas", "empty path segments are normalized away");
    assert.equal(c.slugFolder("Łódź Ideas", "work", ["work/lodz-ideas"]), "work/lodz-ideas-2");
    assert.equal(c.slugFolder("!!!", "", []), "folder");
  });

  await test("explicit folder order stays ahead of paths inferred only from note metadata", () => {
    const tree = c.buildTree(
      [{ id: "n1", body: "", folder: "ghost", updated: 1 }],
      [
        { id: "home", label: "Home", order: 0 },
        { id: "work", label: "Work", order: 1 },
      ],
    );
    assert.deepEqual(Array.from(tree.children, (x) => x.id), ["home", "work", "ghost"]);
    assert.equal(tree.children[2].label, "ghost");
  });

  await test("folder helpers handle add, rename, collapse, delete and reparent without losing note paths", () => {
    const notes = [];
    const add = c.addFolderMeta([], notes, "", "Home");
    assert.equal(add.id, "home");
    const sub = c.addFolderMeta(add.folders, notes, "home", "Projects");
    assert.equal(sub.id, "home/projects");
    notes.push(
      { id: "a", folder: "home/projects", updated: 2 },
      { id: "b", folder: "home/projects/design", updated: 1 },
      { id: "c", folder: "", updated: 3 },
    );
    const deep = c.addFolderMeta(sub.folders, notes, "home/projects/design", "Design");
    assert.equal(deep.id, "home/projects/design/design");
    assert.equal(c.addFolderMeta(deep.folders, notes, deep.id, "Too deep"), null);
    const renamed = c.patchFolderMeta(sub.folders, "home", { label: "Home base", collapsed: true });
    assert.equal(renamed.find((f) => f.id === "home").label, "Home base");
    assert.equal(renamed.find((f) => f.id === "home").collapsed, true);
    assert.equal(c.patchFolderMeta(renamed, "home", { label: "  " }), null);
    const moved = c.reparentFolder(renamed, notes, "home/projects", "");
    assert.equal(moved.id, "projects");
    assert.deepEqual(Array.from(moved.changes, (x) => [x.id, x.folder]), [["a", "projects"], ["b", "projects/design"]]);
    assert.equal(c.reparentFolder(renamed, notes, "home", "home/projects"), null, "cannot move a folder into its own child");
    const deleted = c.deleteFolder(renamed, notes, "home/projects", "toTrash");
    assert.deepEqual(Array.from(deleted.changes, (x) => [x.id, x.folder, x.trash]), [["a", "", true], ["b", "", true]]);
  });

  await test("tree rows keep pinned notes independent and collapsed folders hide descendants", () => {
    const tree = c.buildTree(
      [
        { id: "p", folder: "work", pinned: true, updated: 3 },
        { id: "n", folder: "work", pinned: false, updated: 2 },
        { id: "child", folder: "work/design", updated: 1 },
      ],
      [{ id: "work", label: "Work", order: 0, collapsed: true }, { id: "work/design", label: "Design", order: 0 }],
    );
    const rows = c.treeRows(tree, [{ id: "p", pinned: true }]);
    assert.equal(rows[0].type, "pinned");
    assert.equal(rows[1].note.id, "p");
    assert.deepEqual(Array.from(rows.filter((x) => x.type === "folder"), (x) => x.node.id), ["work"]);
    assert.ok(!rows.some((x) => x.type === "note" && x.note.id === "child"));
  });

  await test("store folder API persists folders and note assignments, then restores them after reopening", async () => {
    const store = await makeStore("store-a");
    const home = store.addFolder("Home");
    const projects = store.addFolder("Projects", home);
    const note = store.create("# Plan\nbody");
    assert.equal(home, "home");
    assert.equal(projects, "home/projects");
    assert.equal(store.setFolder(note.id, projects), true);
    assert.equal(store.get(note.id).folder, projects);
    assert.equal(store.renameFolder(home, "Home base"), true);
    assert.equal(store.setFolderCollapsed(home, true), true);
    await store.flush();

    const restored = await makeStore("store-b");
    assert.equal(restored.get(note.id).folder, "home/projects");
    assert.equal(restored.meta.folders.find((f) => f.id === "home").label, "Home base");
    assert.equal(restored.meta.folders.find((f) => f.id === "home").collapsed, true);
    const moved = restored.moveFolder("home/projects", "");
    assert.equal(moved, "projects");
    assert.equal(restored.get(note.id).folder, "projects");
    assert.equal(restored.removeFolder("projects", "toTrash"), true);
    assert.equal(restored.get(note.id).folder, "");
    assert.ok(restored.get(note.id).trashed > 0);
    await restored.flush();
    await store.close();
    await restored.close();
  });

  await test("All Notes renders a tree; dragging a note to a folder updates the store and collapse hides it", async () => {
    const store = await makeStore("tree-ui");
    const home = store.addFolder("Home");
    const note = store.create("# Drag me\nA note to move");
    await store.flush();
    const sheet = c.createSheet({
      store,
      adapter: makeAdapter(),
      env: { getPref: (_k, d) => d, setPref() {}, openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} },
      ensureStore: () => store.open(),
    });
    await sheet.open();
    await flushRaf();
    const allNotes = sheet.root.all().find((el) => el.title === "All notes");
    assert.ok(allNotes, "All Notes navigation is present");
    allNotes.click();
    await flushRaf();
    const list = sheet.root.querySelector(".zn-items");
    assert.equal(list.getAttribute("role"), "tree");
    const folderRow = () => list.children.find((el) => el.getAttribute("data-fid") === home);
    const noteRow = () => list.children.find((el) => el.getAttribute("data-id") === note.id);
    assert.ok(folderRow(), "folder row rendered");
    assert.ok(noteRow(), "note row rendered at top level");

    let transferred = "";
    noteRow().dispatchEvent(new Ev("dragstart", { bubbles: true, dataTransfer: { setData: (_type, value) => (transferred = value) } }));
    assert.equal(transferred, note.id);
    folderRow().dispatchEvent(new Ev("drop", { bubbles: true, dataTransfer: { getData: () => transferred } }));
    await flushRaf();
    assert.equal(store.get(note.id).folder, home);
    assert.ok(noteRow(), "moved note remains visible within the flat tree row list");
    assert.ok(list.children.indexOf(noteRow()) > list.children.indexOf(folderRow()), "note row follows its folder row");
    assert.equal(noteRow().getAttribute("aria-level"), "2", "note is indented one level into the folder");

    folderRow().click();
    await flushRaf();
    assert.equal(store.meta.folders.find((f) => f.id === home).collapsed, true);
    assert.ok(!list.children.some((el) => el.getAttribute("data-id") === note.id), "collapsed folder hides its note row");
    sheet.destroy();
    await store.close();
  });

  await test("All Notes tree styling keeps folder rows compact", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
    assert.match(css, /\.zn-items\[role="tree"\] \.zn-item\s*\{\s*min-height:\s*22px/);
    assert.match(css, /\.zn-items\[role="tree"\] \.zn-frow\s*\{\s*min-height:\s*22px/);
  });

  console.log(`\n${passed} notes tree tests passed`);
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
