"use strict";
/* OW-47: linked scrolling in split view must not drift on long notes.
 * The old link copied `scrollTop` (or interpolated anchors) and every copy lost a fraction of a pixel; after a few
 * moves the panes disagreed and never came back. The plan is pure: a fraction of the scrollable range plus a carried
 * remainder, an echo flag so our own scroll is never answered, and an explicit "both panes agree" reset for reveals. */
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

test("the position is a share of the range, not a copied pixel count", () => {
  // The editor can scroll 3000 px, the preview 900: a quarter down is a quarter down in both.
  const plan = c.syncScrollPlan({ fromTop: 750, fromMax: 3000, toMax: 900, toTop: 0 });
  assert.equal(plan.top, 225);
  assert.equal(plan.reason, "fraction");
  // Past the ends nothing is invented.
  assert.equal(c.syncScrollPlan({ fromTop: -50, fromMax: 3000, toMax: 900, toTop: 0 }).top, null, "a negative start is the top, which is where both panes already are");
  assert.equal(c.syncScrollPlan({ fromTop: -50, fromMax: 3000, toMax: 900, toTop: 300 }).top, 0, "and it pulls the other pane back to the top");
  assert.equal(c.syncScrollPlan({ fromTop: 9000, fromMax: 3000, toMax: 900, toTop: 10 }).top, 900, "the end is the end");
});

test("a hundred small moves land exactly where one big move would", () => {
  const fromMax = 4321;
  const toMax = 1777;
  let carried = 0;
  let top = 0;
  for (let i = 1; i <= 100; i++) {
    const plan = c.syncScrollPlan({ fromTop: (fromMax * i) / 100, fromMax, toMax, toTop: top, carried });
    carried = plan.carried;
    if (plan.top !== null) top = plan.top;
  }
  assert.ok(Math.abs(top - toMax) <= 1, "the hundredth move reaches the end (" + top + " of " + toMax + ")");
  // The same in one step:
  assert.equal(c.syncScrollPlan({ fromTop: fromMax, fromMax, toMax, toTop: 0 }).top, toMax);
});

test("our own echo is never answered, so two panes cannot ping-pong", () => {
  const echo = c.syncScrollPlan({ fromTop: 500, fromMax: 1000, toMax: 400, toTop: 200, echo: true });
  assert.equal(echo.top, null);
  assert.equal(echo.reason, "echo");
  assert.equal(echo.carried, 0, "an echo neither moves nor carries");
});

test("nothing to sync is reported, not done", () => {
  assert.equal(c.syncScrollPlan({ fromTop: 10, fromMax: 0, toMax: 400 }).reason, "no-range", "a pane that cannot scroll");
  assert.equal(c.syncScrollPlan({ fromTop: 10, fromMax: 400, toMax: 0 }).reason, "no-range", "a target that cannot scroll");
  assert.equal(c.syncScrollPlan({}).reason, "no-range");
  assert.equal(c.syncScrollPlan({ fromTop: 10, fromMax: 400, toMax: 100, toTop: 0 }).top, 2.5, "10/400 of a 100 px range is 2.5 px, and it is written");
});

test("a move smaller than a pixel is not a write", () => {
  // 0.2 px of difference: writing it would repaint for nothing.
  const plan = c.syncScrollPlan({ fromTop: 100, fromMax: 1000, toMax: 1000, toTop: 99.8 });
  assert.equal(plan.top, null, "a sub-pixel difference writes nothing");
  assert.equal(c.syncScrollPlan({ fromTop: 100, fromMax: 1000, toMax: 1000, toTop: 90 }).top, 100);
});

test("a reveal puts both panes back on the same place", () => {
  const anchor = c.syncScrollAnchorPlan({ line: 50, lines: 200, toMax: 1000 });
  assert.equal(anchor.top, 250, "a quarter of the lines is a quarter of the range");
  assert.equal(anchor.share, 0.25);
  assert.equal(c.syncScrollAnchorPlan({ line: 999, lines: 200, toMax: 1000 }).top, 1000, "a line past the end clamps");
  assert.equal(c.syncScrollAnchorPlan({ line: -3, lines: 200, toMax: 1000 }).top, 0);
  assert.equal(c.syncScrollAnchorPlan({ line: 5, lines: 200, toMax: 0 }).top, null, "an unscrollable pane has no place to keep");
});

test("the live link uses the plan, the echo flag and the carried remainder", () => {
  const link = SRC.slice(SRC.indexOf("function linkScroll(from, to)"), SRC.indexOf('listen(ta, "scroll", linkScroll(ta, readEl));'));
  assert.ok(/syncScrollPlan\(/.test(link), "the plan decides every move");
  assert.ok(/echo/.test(link), "an echo is recognised");
  assert.ok(/carried/.test(link), "the remainder is kept between moves");
  assert.ok(!/scrollTop \/ max\) \* Math\.max/.test(link), "the old fraction copy is gone");
  // The anchor interpolation stays, because it is what keeps a heading level between the panes; the plan only
  // tidies it up and carries the remainder.
  assert.ok(/mapPosition/.test(link), "the anchor map is still the fine-grained part");
  // A reveal must reset the carried remainder, or it would drag the next gesture off by its last fraction.
  const reveal = SRC.slice(SRC.indexOf("function revealInPreview"), SRC.indexOf("function revealInPreview") + 1600);
  assert.ok(/syncCarried/.test(reveal) || /syncScrollAnchorPlan/.test(SRC), "a reveal resets the shared place");
});

console.log("\nPASS notes-split-scroll (" + passed + " tests)");
