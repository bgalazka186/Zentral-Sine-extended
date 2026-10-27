"use strict";
/* Guards for resize/drag performance fixes. These read source structure because the code runs
 * only inside Zen: they fail if a per-event layout read or an unthrottled resize handler comes
 * back. They do not measure speed; measure in Zen with the Performance panel while dragging. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const read = (rel) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
const slice = (text, from, to) => {
  const a = text.indexOf(from), b = text.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `markers not found: ${from} .. ${to}`);
  return text.slice(a, b);
};
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

test("floating panel drag reads the geometry once per pointer event, before any write", () => {
  const move = slice(read("extension/panels/floating/ZentralPanelEnhancements.js"), "function moveGesture(event) {", "function endGesture(");
  const calls = (move.match(/\barea\(\)/g) || []).length;
  // one real call plus the explanatory comment
  assert.ok(calls <= 2, `area() appears ${calls} times in moveGesture`);
  const firstRead = move.indexOf("const areaNow = area();");
  assert.ok(firstRead > 0);
  assert.ok(firstRead < move.indexOf("shield.setAttribute"), "read happens before the first write");
  assert.ok(firstRead < move.indexOf("apply(g.host)"), "and before apply() writes styles");
});
test("horizontal panel resize computes its width limit once per drag, not per mouse event", () => {
  const src = read("zentral/apps/controllers/ZentralPanelPosition.js");
  const onDrag = slice(src, "onDrag(e) {", "onStopDrag() {");
  assert.match(onDrag, /this\._dragLimit == null/);
  assert.equal((onDrag.match(/getSidebarDockedMaxWidth\(\)/g) || []).length, 1, "measured at most once, inside the cache guard");
  assert.match(slice(src, "startResize(e) {", "prepareResize() {"), /this\._dragLimit = null/);
  assert.match(slice(src, "onStopDrag() {", "scheduleRepositionGrid("), /this\._dragLimit = null/);
});
test("vertical panel resize applies at most once per frame and flushes on release", () => {
  const src = read("extension/panels/geometry/ZentralPanelGeometry.uc.js");
  const drag = slice(src, "function onVerticalResizeDrag(e) {", "function stopVerticalResizeDrag()");
  assert.match(drag, /requestAnimationFrame/);
  assert.ok(!/\n\s+applyVerticalResizeExtras\(root\);\s*\n\s*\}\s*$/.test(drag), "no direct per-event apply");
  const stop = slice(src, "function stopVerticalResizeDrag()", "vResizeState = null;");
  assert.match(stop, /cancelAnimationFrame/);
  assert.match(stop, /applyVerticalResizeExtras\(last\)/, "final offsets are applied before saving");
});
test("hover reveal edge geometry on window resize is coalesced to one run per frame", () => {
  const src = read("extension/panels/interaction/ZentralPanelHover.js");
  assert.match(src, /window\.addEventListener\("resize", onRevealEdgeResize\)/);
  assert.match(src, /window\.removeEventListener\("resize", onRevealEdgeResize\)/);
  assert.ok(!/addEventListener\("resize", updateRevealEdgeGeometry\)/.test(src));
});
test("new resize observers in the notes module are frame-throttled", () => {
  const src = read("additional/notes/ZentralNotes.uc.js");
  assert.match(src, /const scheduleLayout = \(\) => \{\s*if \(!rafLayout\)/);
});
console.log(`\n${passed} resize performance guards passed`);
