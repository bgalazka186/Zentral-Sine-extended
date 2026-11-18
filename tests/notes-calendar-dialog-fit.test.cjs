"use strict";
/* OW-48: the calendar dialog must not resize in a loop.
 * A fit changes the card's size, the ResizeObserver sees the change and asks for another fit; at some sheet sizes the
 * two fits disagree by a pixel or two, so the card jittered between two boxes. The rule is pure: a new measurement
 * within the tolerance keeps the box that is already on screen, an unchanged key skips the measurement entirely, and a
 * new dialog starts with no memory. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, __zentralNotesParts: {}, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(SRC, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}
const json = (v) => JSON.parse(JSON.stringify(v));
const box = (over) => ({ spill: true, left: 10, top: 20, width: 300, height: 400, scroll: false, ...over });

test("a measurement within two pixels keeps the box already on screen", () => {
  const applied = box({});
  assert.deepEqual(json(c.fitDialogStable(applied, box({ width: 301 }))), json(applied), "one pixel is noise, not a new size");
  assert.deepEqual(json(c.fitDialogStable(applied, box({ height: 398, left: 11, top: 19 }))), json(applied));
  assert.deepEqual(json(c.fitDialogStable(applied, box({ width: 320 }))), json(box({ width: 320 })), "a real change is applied");
  assert.deepEqual(json(c.fitDialogStable(applied, box({ spill: false, left: 0, top: 0, width: 0, height: 0 }))).spill, false,
    "switching out of the spilled layout always applies");
});

test("the tolerance is two pixels and is a named constant", () => {
  assert.equal(c.FIT_STABLE_TOLERANCE, 2);
  assert.equal(c.fitDialogStable(box({}), box({ width: 302 })).width, 300, "exactly the tolerance still holds");
  assert.equal(c.fitDialogStable(box({}), box({ width: 303 })).width, 303, "past it the new box wins");
  assert.equal(c.fitDialogStable(box({}), box({ width: 303 }), 5).width, 300, "a caller may widen it");
});

test("the first fit is always applied and an empty state has no opinion", () => {
  assert.equal(c.fitDialogStable(null, box({ width: 12 })).width, 12);
  assert.equal(c.fitDialogStable(null, null), null);
  assert.equal(c.fitDialogStable(box({}), null).width, 300, "a missing measurement does not blank the card");
});

test("a fit already applied keeps its scroll flag", () => {
  const applied = box({ scroll: true });
  assert.equal(c.fitDialogStable(applied, box({ scroll: false })).scroll, true, "a card that needed scrolling still does");
  assert.equal(c.fitDialogStable(applied, box({ width: 999, scroll: false })).scroll, false, "a new box carries its own answer");
});

test("an unchanged key means no measurement at all", () => {
  const args = { sheet: { left: 0, top: 0, width: 800, height: 600 }, viewport: { width: 1400, height: 900 }, size: { width: 480, height: 700 }, extra: "zn-dialog-card|600" };
  assert.equal(c.dialogFitKey(args), c.dialogFitKey({ ...args }));
  assert.notEqual(c.dialogFitKey(args), c.dialogFitKey({ ...args, size: { width: 481, height: 700 } }), "a real size change is a new key");
  assert.notEqual(c.dialogFitKey(args), c.dialogFitKey({ ...args, viewport: { width: 1200, height: 900 } }), "a window resize is a new key");
  assert.equal(c.dialogFitKey({ size: { width: 0.4, height: 0.4 } }), c.dialogFitKey({ size: { width: 0.2, height: 0.3 } }), "sub-pixel noise cannot churn the key");
});

test("a real oscillation settles after one step", () => {
  // The card is measured at A, fit writes B, the observer reports B, the next measurement says A again.
  const a = box({ width: 480, height: 700 });
  const b = box({ width: 478, height: 698 });
  const first = c.fitDialogStable(null, a);
  const second = c.fitDialogStable(first, b);
  const third = c.fitDialogStable(second, a);
  assert.deepEqual(json(second), json(first), "the second measurement never moves the card");
  assert.deepEqual(json(third), json(first), "and neither does the third: the loop is gone");
});

test("the live wiring remembers the applied box and guards the observer", () => {
  assert.match(SRC, /const fit = fitDialogStable\(appliedFitBox, measured, FIT_STABLE_TOLERANCE\);/, "fitCard() decides through the rule");
  assert.match(SRC, /if \(key === appliedFitKey && appliedFitBox\) \{/, "an unchanged key skips the fit");
  assert.match(SRC, /appliedFitKey = "";\n      appliedFitBox = null;\n        window\.cancelAnimationFrame\(rafFit\);|appliedFitKey = "";/, "a closed dialog forgets");
  const ro = SRC.slice(SRC.indexOf("cardRO = new RO(() => {"), SRC.indexOf("cardROOff = resources.observer"));
  assert.match(ro, /if \(fitting\) return;/, "the observer ignores the fit's own write");
  assert.match(ro, /FIT_STABLE_TOLERANCE/, "and a size the fit already applied");
});

console.log("\nPASS notes-calendar-dialog-fit (" + passed + " tests)");
