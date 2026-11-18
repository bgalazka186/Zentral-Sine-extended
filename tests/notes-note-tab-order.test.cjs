"use strict";

// T3.3: dragging a note tab in the Zen sidebar changes the notes tree — the pure model first (order per folder,
// drop target, plan), then the live wiring (the tab drag is the one Zen's tab bar already starts).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, __zentralNotesParts: {}, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(SRC, {
  window: win,
  globalThis: { Services: {} },
  ChromeUtils: {},
  URL,
  Date,
  JSON,
  Math,
  Promise,
  RegExp,
  Number,
  Map,
  Set,
  console,
});
const c = seam.core;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}

const json = (value) => JSON.parse(JSON.stringify(value));
const note = (id, folder, updated, order) => ({ id, folder, updated, body: `# ${id}`, ...(order ? { order } : {}) });
const rows = (list, order = "folders-first") => c.treeRows(c.buildTree(list, []), [], order);

test("pure: cleanNoteOrder keeps only a real hand-placed place", () => {
  assert.equal(c.cleanNoteOrder(1), 1);
  assert.equal(c.cleanNoteOrder("2.5"), 2.5);
  assert.equal(c.cleanNoteOrder(0), 0, "0 means not placed by hand");
  assert.equal(c.cleanNoteOrder(-1), 0);
  assert.equal(c.cleanNoteOrder("nan"), 0);
  assert.equal(c.cleanNoteOrder(1e12), 0, "absurd values are refused, not stored");
  assert.equal(c.cleanNoteOrder(0.123456789), 0.123457, "six decimals are enough for a gap");
});

test("pure: noteOrderBetween always finds a place between two rows", () => {
  assert.equal(c.noteOrderBetween(1, 2), 1.5);
  assert.equal(c.noteOrderBetween(1, undefined), 2, "below a placed note");
  assert.equal(c.noteOrderBetween(undefined, 4), 2, "above a placed note");
  assert.equal(c.noteOrderBetween(undefined, 1), 0.5, "above the first placed note");
  assert.equal(c.noteOrderBetween(undefined, 0.5), 0.5, "no room above: the first place is used instead");
  assert.equal(c.noteOrderBetween(undefined, undefined), 1, "an empty folder starts at one");
  // A drafter that asks for the same place a hundred times always has room (no renumbering, no equal values).
  let lo = 1, hi = 2;
  for (let i = 0; i < 20; i++) { const mid = c.noteOrderBetween(lo, hi); assert.ok(mid > lo && mid < hi, `gap stays open at ${i}`); hi = mid; }
});

test("pure: a hand-placed note keeps its place, the rest keep the last-change order", () => {
  const list = [note("a", "f", 100), note("b", "f", 300), note("c", "f", 200)];
  assert.deepEqual([...rows(list).filter((r) => r.type === "note").map((r) => r.note.id)], ["b", "c", "a"], "newest first by default");
  const placed = [note("a", "f", 100, 1), note("b", "f", 300, 2), note("c", "f", 200, 3)];
  assert.deepEqual([...rows(placed).filter((r) => r.type === "note").map((r) => r.note.id)], ["a", "b", "c"], "placed notes follow their numbers");
  const mixed = [note("a", "f", 100, 2), note("b", "f", 300, 1), note("c", "f", 200)];
  assert.deepEqual([...rows(mixed).filter((r) => r.type === "note").map((r) => r.note.id)], ["b", "a", "c"], "unplaced notes follow the placed ones");
});

test("pure: noteDropTarget answers a folder drop and a between-notes drop", () => {
  const list = [note("a", "work", 300), note("b", "work", 200), note("c", "", 100)];
  const tree = rows(list);
  const folderRow = tree.find((r) => r.type === "folder" && r.node.id === "work");
  const intoWork = c.noteDropTarget(tree, "c", folderRow.key, "before");
  assert.deepEqual(json(intoWork), { kind: "into", folder: "work", order: 1 }, "a note dropped on a folder joins it at the top");
  const between = c.noteDropTarget(tree, "c", "b", "before");
  assert.equal(between.kind, "order");
  assert.equal(between.folder, "work");
  assert.equal(between.order, 1, "above the first note of a folder nobody ordered yet");
  assert.equal(c.noteDropTarget(tree, "a", "a", "after"), null, "a note cannot be dropped on itself");
  assert.equal(c.noteDropTarget(tree, "a", folderRow.key, "before"), null, "a note already in that folder stays put");
  assert.equal(c.noteDropTarget(tree, "zzz", "b", "before"), null, "an unknown source does nothing");
  assert.equal(c.noteDropTarget(tree, "a", "zzz", "before"), null, "an unknown target does nothing");
  const toRoot = c.noteDropTarget(tree, "a", "root", "before");
  assert.equal(toRoot.kind, "folder", "a drop on the root leaves every folder");
  assert.equal(toRoot.folder, "");
  assert.equal(c.noteDropTarget(tree, "c", "root", "before"), null, "a note already at the top level stays there");
});

test("pure: noteTabDropPlan turns a Zen tab drop into one store change", () => {
  const list = [note("a", "work", 300), note("b", "work", 200), note("c", "", 100)];
  const tree = rows(list);
  const folderRow = tree.find((r) => r.type === "folder" && r.node.id === "work");
  assert.deepEqual(json(c.noteTabDropPlan(tree, "n:c", folderRow.key)), { kind: "move", noteId: "c", folder: "work", order: 1 });
  assert.deepEqual(json(c.noteTabDropPlan(tree, "n:c", "b", "after")), { kind: "move", noteId: "c", folder: "work", order: 1 }, "a drop on a note of another folder moves it there");
  assert.deepEqual(json(c.noteTabDropPlan(tree, "n:b", "a", "before")), { kind: "order", noteId: "b", order: 1 }, "inside one folder only the place changes (above the first note of a never-ordered folder)");
  assert.equal(c.noteTabDropPlan(tree, "n:a", "a"), null);
  assert.equal(c.noteTabDropPlan(tree, "n:c", "root"), null, "already at the top level");
  assert.deepEqual(json(c.noteTabDropPlan(tree, "n:a", "root")), { kind: "move", noteId: "a", folder: "", order: 1 }, "a drop on the root leaves every folder");
});

test("live: the store keeps the dragged place across a save and a reload", async () => {
  // A tiny in-memory file system, the same shape the store expects.
  const files = new Map();
  const io = {
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    // meta.json and calendar.json sit in the same folder as the notes; the store must not read them as notes.
    isNote: true,
    exists: async (p) => files.has(p),
    readUTF8: async (p) => { if (!files.has(p)) throw Error("missing"); return files.get(p); },
    writeUTF8: async (p, t) => { files.set(p, t); },
    remove: async (p) => { files.delete(p); },
    children: async (p) => [...files.keys()].filter((k) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")),
    stat: async () => ({ lastModified: 0 }),
    restrict: async () => {},
  };
  const make = () => c.createStore({ io, notify() {}, windowId: "t3-3", getDir: async () => "/n", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout, now: () => Date.UTC(2026, 10, 17, 12, 0, 0) });
  const store = make();
  await store.open();
  const a = store.create("# Alpha\n", "work").id;
  const b = store.create("# Beta\n", "work").id;
  assert.equal(store.setNoteOrder(b, 1), true, "Beta dragged to the top");
  assert.equal(store.get(b).order, 1);
  assert.equal(store.setNoteOrder(b, 1), false, "the same place is not a change");
  await store.flush();
  await store.close();

  const again = make();
  await again.open();
  assert.equal(again.get(b).order, 1, "the place survives a reload");
  const order = again.treeRows ? null : null; // treeRows is pure and exported separately
  const list = [again.get(a), again.get(b)];
  const tree = c.treeRows(c.buildTree(list, again.meta.folders || []), [], "folders-first");
  assert.deepEqual([...tree.filter((r) => r.type === "note").map((r) => r.note.id)], [b, a], "the saved tree shows the dragged order");
  assert.equal(again.get(b).foreign, "", "the place is a property we own, not a foreign YAML line");
  assert.equal(again.setNoteOrder(b, 0), true, "handing the note back to the last-change order");
  assert.equal(again.get(b).order, undefined);
  await again.flush();
  await again.close();
});

test("live: the sidebar still refuses to let our tabs be dragged out by Zen", () => {
  // The gesture is Zen's own tab drag; we read it instead of replacing it, and the existing guard keeps a Notes tab
  // from being taken out of the managed tree by the browser.
  assert.ok(SRC.includes("const onZenDrag = (ev) =>"), "the drag guard is still there");
  assert.ok(SRC.includes("ev.preventDefault();") && SRC.includes("dropEffect = \"none\""), "a managed drop is still cancelled");
  // The reorder model has its own test above ("noteTabDropPlan turns a Zen tab drop into one store change"); the
  // line that used to sit here ended in `|| true` and could never fail, so it proved nothing while looking like it did.
});

console.log(`\nPASS notes-note-tab-order (${passed} tests)`);
