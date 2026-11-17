"use strict";

// T3.8: a second note beside the one being edited. The pure part decides which note may stand there, how the
// stored setting is cleaned, which way the two panes face and which shares the divider may snap to; the source
// checks keep the wiring honest (one render function, one store call per change, no blocking of the main pane).

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

test("pure: a stored companion is cleaned, never trusted", () => {
  assert.deepEqual(json(c.cleanSplitCompanion(undefined)), { id: "", share: 50, side: "auto" });
  assert.deepEqual(json(c.cleanSplitCompanion("nope")), { id: "", share: 50, side: "auto" });
  assert.deepEqual(json(c.cleanSplitCompanion({ id: " a1 ", share: 33, side: "stack" })), { id: "a1", share: 33, side: "stack" });
  assert.equal(c.cleanSplitCompanion({ id: "a1", share: 12 }).share, 50, "a share outside the allowed steps falls back to half");
  assert.equal(c.cleanSplitCompanion({ id: "a1", share: Number.NaN }).share, 50);
  assert.equal(c.cleanSplitCompanion({ id: "a1", side: "diagonal" }).side, "auto");
  assert.equal(c.cleanSplitCompanion({ id: 42 }).id, "", "only a string id can point at a note");
  assert.equal(c.cleanSplitCompanion({ id: "x".repeat(200) }).id, "", "an absurd id is refused");
});

test("pure: the allowed shares are the five the divider snaps to", () => {
  assert.deepEqual(json(c.SPLIT_COMPANION_SHARES), [25, 33, 50, 67, 75]);
  assert.equal(c.nearestSplitShare(26), 25);
  assert.equal(c.nearestSplitShare(41), 33, "33 is nearer than 50 for 41");
  assert.equal(c.nearestSplitShare(52), 50);
  assert.equal(c.nearestSplitShare(-40), 25, "the pane never gets thinner than a quarter");
  assert.equal(c.nearestSplitShare(400), 75, "and never wider than three quarters");
  assert.equal(c.nearestSplitShare("nonsense"), 50);
});

test("pure: the panes lie side by side on a wide sheet and stacked on a tall one", () => {
  assert.equal(c.splitCompanionAxis({ side: "auto" }, 900, 600), "side");
  assert.equal(c.splitCompanionAxis({ side: "auto" }, 500, 800), "stack");
  assert.equal(c.splitCompanionAxis({ side: "auto" }, 700, 700), "side", "a square sheet reads better side by side");
  assert.equal(c.splitCompanionAxis({ side: "side" }, 100, 900), "side", "a pinned choice wins over the shape");
  assert.equal(c.splitCompanionAxis({ side: "stack" }, 900, 100), "stack");
  assert.equal(c.splitCompanionAxis({ side: "bogus" }, 900, 100), "side", "an unknown value is not a choice");
});

test("pure: only a real, living, different note may stand in the pane", () => {
  const notes = [{ id: "a", trashed: false }, { id: "b", trashed: true }, { id: "c", trashed: false }];
  assert.equal(c.splitCompanionReady({ id: "c" }, notes, "a"), true);
  assert.equal(c.splitCompanionReady({ id: "a" }, notes, "a"), false, "the note being edited cannot also be the reference");
  assert.equal(c.splitCompanionReady({ id: "b" }, notes, "a"), false, "a trashed note is not a reference");
  assert.equal(c.splitCompanionReady({ id: "gone" }, notes, "a"), false);
  assert.equal(c.splitCompanionReady({ id: "" }, notes, "a"), false);
  assert.equal(c.splitCompanionReady({ id: "c" }, null, "a"), false);
});

test("wiring: the pane is rendered from one place, only while a note is being edited", () => {
  assert.ok(/const companionEl = h\("section", \{ class: "zn-companion"/.test(SRC));
  assert.ok(/function renderCompanion\(force = false\)/.test(SRC), "one render function");
  assert.ok(/const other = view === "editor" \? companionNote\(\) : null;/.test(SRC), "only the editor view shows a reference");
  assert.ok(/companionEl\.hidden = !other;/.test(SRC), "the pane is hidden, never half-built");
  assert.ok(/renderBlocks\(target, blocks, readEnv, \(\) => \{\}\);/.test(SRC), "the reference pane is read-only");
});

test("wiring: the actions stay in the store, not in the DOM", () => {
  const companionRegion = SRC.slice(SRC.indexOf("function renderCompanion("), SRC.indexOf("function schedulePreview()"));
  assert.ok(/store\.setMeta\(\{ splitCompanion: next \}\);/.test(companionRegion), "changing the pane is one meta write");
  assert.ok(!/innerHTML/.test(companionRegion), "the pane never builds markup from text");
  const divider = SRC.slice(SRC.indexOf('listen(companionDivider, "pointerdown"'), SRC.indexOf('listen(companionDivider, "keydown"'));
  assert.ok(/setPointerCapture/.test(divider), "the drag keeps the pointer while it leaves the divider");
  assert.ok(!/pointermove[\s\S]*store\.setMeta/.test(divider), "dragging does not write the store on every move");
  assert.ok(/setCompanionShare\(shown\)/.test(divider), "the settled share is written once, on release");
  assert.ok(/ArrowLeft/.test(SRC) && /"Home"/.test(SRC) && /"End"/.test(SRC), "the divider is reachable from the keyboard");
});

test("wiring: both halves share the space equally", () => {
  const css = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.css"), "utf8");
  assert.ok(/\.zn-companion \{[^}]*flex: 0 0 calc\(var\(--zn-companion-share, 50\) \* 1%\);/s.test(css), "the pane width is the share of the box");
  assert.ok(/data-companion-axis="stack"[^{]*\{[^}]*border-top: 1px solid/.test(css), "stacked panes get a top rule, not a left one");
  assert.ok(/--zn-companion-share: 50;/.test(css), "half is the default share");
});

console.log("\nPASS notes-split-companion (" + passed + " tests)");
