"use strict";
/* Part A groundwork: pure projection + tab-safety policy. NOT wired to Zen; proves the decisions only.
 * Real Zen folder creation, Sync exclusion and drag/drop cancelling are NOT covered (see docs/NOTES-ZEN-FOLDER-BLOCKER.md). */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const win = { document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
win.window = win;
vm.runInNewContext(source, { window: win, document: dom.document, Event: dom.Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array, queueMicrotask });
const c = win.__zentralNotesTestSeam.core;
const J = (x) => JSON.parse(JSON.stringify(x));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const note = (id, body, folder = "", extra = {}) => ({ id, body, folder, updated: 1, created: 1, trashed: 0, pinned: false, ...extra });
const folders = [{ id: "work", label: "Work", order: 0, collapsed: false }];

test("projection mirrors the tree: nested folders, titles as labels, trashed notes left out, keys from ids", () => {
  const p = J(c.projectNotesFolder([note("n1", "Alpha\nx", "work"), note("n2", "Beta", ""), note("n3", "Gone", "", { trashed: 5 }), note("n4", "Deep", "work/sub")], folders));
  assert.deepEqual(p.map((e) => e.key).sort(), ["f:work", "f:work/sub", "n:n1", "n:n2", "n:n4"]);
  assert.equal(p.find((e) => e.key === "n:n1").parent, "f:work");
  assert.equal(p.find((e) => e.key === "f:work/sub").parent, "f:work");
  assert.equal(p.find((e) => e.key === "n:n1").label, "Alpha");
});
test("identity: rename keeps the key (relabel only); a folder move changes the parent only", () => {
  const before = J(c.projectNotesFolder([note("n1", "Alpha", "work")], folders));
  const renamed = J(c.projectNotesFolder([note("n1", "Alpha renamed", "work")], folders));
  let d = J(c.diffProjection(before, renamed));
  assert.deepEqual([d.add.length, d.remove.length, d.move.length, d.relabel.length], [0, 0, 0, 1]);
  const moved = J(c.projectNotesFolder([note("n1", "Alpha renamed", "")], folders));
  d = J(c.diffProjection(renamed, moved));
  assert.deepEqual([d.add.length, d.remove.length, d.relabel.length, d.move.map((m) => m.key)], [0, 0, 0, ["n:n1"]]);
});
test("idempotent rebuild: applying the plan then diffing again is empty; stale and duplicate entries are repaired", () => {
  const want = J(c.projectNotesFolder([note("n1", "A"), note("n2", "B")], []));
  const stale = [{ key: "n:n1", label: "old", parent: "" }, { key: "n:n1", label: "dup", parent: "" }, { key: "n:zzz", label: "ghost", parent: "" }];
  const d = J(c.diffProjection(stale, want));
  assert.deepEqual(d.add.map((e) => e.key), ["n:n2"]);
  assert.deepEqual(d.remove.sort(), ["n:n1#dup", "n:zzz"]);
  assert.equal(d.relabel[0].key, "n:n1");
  const d2 = J(c.diffProjection(want, want));
  assert.deepEqual(d2, { add: [], remove: [], relabel: [], move: [], restyle: [] });
});
test("cleanup only ever targets tabs that carry the Notes marker; ordinary tabs are never listed", () => {
  const tabs = [{ id: 1, attrs: {} }, { id: 2, attrs: { [c.NOTES_ATTR]: "n1" } }, { id: 3, attrs: { pinned: "true" }, url: "https://x.org" }, { id: 4, attrs: { [c.NOTES_ATTR]: "" } }];
  assert.deepEqual(J(c.planCleanup(tabs)), [2, 4]);
  assert.deepEqual(J(c.planCleanup([{ id: 9 }, null])), []);
});
test("drop policy: web tab -> captured as a URL note or rejected; Notes entry cannot escape; nothing is moved or closed", () => {
  const web = { attrs: {}, title: "Docs [x]", url: "https://example.org/a?b=1" };
  const d = J(c.dropDecision({ tab: web, intoNotes: true }));
  assert.equal(d.action, "capture-url");
  assert.ok(d.body.includes("[Docs x](https://example.org/a?b=1)") && d.body.startsWith("Docs x\n"));
  for (const url of ["about:config", "javascript:alert(1)", "file:///etc/passwd", ""]) assert.equal(c.dropDecision({ tab: { attrs: {}, url }, intoNotes: true }).action, "reject", url);
  assert.equal(c.dropDecision({ tab: web, intoNotes: false }).action, "ignore");
  const mine = { attrs: { [c.NOTES_ATTR]: "n1" } };
  assert.equal(c.dropDecision({ tab: mine, intoNotes: false }).action, "restore");
  assert.equal(c.dropDecision({ tab: mine, intoNotes: true }).action, "reposition");
  for (const t of [web, mine]) for (const into of [true, false]) assert.ok(!["move", "close", "convert"].includes(c.dropDecision({ tab: t, intoNotes: into }).action));
});
test("groundwork touches no browser state: no preference, Services or Sync identifiers in the new section", () => {
  const sec = source.slice(source.indexOf("Pure core: Notes -> ordinary Zen folder projection"), source.indexOf("The text an export writes for a note"));
  assert.ok(source.includes("Pure core: Notes -> ordinary Zen folder projection") && source.includes("The text an export writes for a note"));
  assert.ok(sec.length > 500);
  assert.ok(!/Services\.|gBrowser|IOUtils|services\.sync|setBoolPref|setPref|getPref/.test(sec.replace(/\/\/.*$/gm, "")));
});
console.log(`\n${passed} notes zen-folder groundwork tests passed`);
