"use strict";
/* Structural guard for the main-mod docked-panel reserve branch.
 * The geometry module runs only in Zen; this catches accidentally dropping Notes' reserve
 * from the edge-attached (normal docked panel) branch. It does not replace a live Zen test. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "extension/panels/geometry/ZentralPanelGeometry.uc.js"), "utf8");
const start = source.indexOf("if (dualViewActive || edgeAttachedPanels) {");
const end = source.indexOf("const { top: resizeTop, bottom: resizeBottom }", start);
assert.ok(start >= 0 && end > start, "panel geometry branch markers must exist");
const branch = source.slice(start, end);
assert.match(branch, /let bottomMargin = notesReserve\(\) \+ "px";/,
  "normal edge-attached/docked panels reserve Notes space even outside dual view");
assert.match(branch, /bottomMargin = desiredBottom - nativeBottom \+ notesReserve\(\) \+ "px";/,
  "dual-view panels preserve their native bottom clearance and add Notes reserve");
console.log("ok - edge-attached docked panel applies the Notes reserve");
console.log("\n1 docked-reserve test passed");
