"use strict";
/* Source guards from the P3 cheap scan (timers, gestures). Fake-DOM/regex only: real Zen is still needed
 * for pointer capture and hit-testing. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const notes = fs.readFileSync(path.resolve(__dirname, "..", "additional/notes/ZentralNotes.uc.js"), "utf8");

// The "Empty trash" confirm window is tracked and cleared with the sheet (no timer touching a removed node).
assert.match(notes, /let emptyTimer = 0;/, "emptyTimer is declared");
assert.match(notes, /cleanups\.push\(\(\) => window\.clearTimeout\(emptyTimer\)\);/, "emptyTimer is cleared on destroy");
assert.match(notes, /emptyTimer = window\.setTimeout\(/, "the confirm timer is stored");
assert.ok(!/^\s*window\.setTimeout\(\(\) => \{\s*\n\s*delete chipEmpty/m.test(notes), "no untracked confirm timer remains");
console.log("ok - Empty-trash confirm timer is owned by the sheet");

// Gestures are dropped when the sheet closes or is suspended (no stale pointer state or pending frame).
assert.match(notes, /function cancelGesture\(\) \{\s*gesture = null;\s*if \(rafDrag\) window\.cancelAnimationFrame\(rafDrag\);/, "cancelGesture clears the frame");
assert.match(notes, /if \(gesture\) cancelGesture\(\);\s*root\.dataset\.suspended = "true";/, "suspended layout cancels a gesture");
console.log("ok - stale gestures are cancelled on close / suspend");
console.log("\n2 P3 scan guards passed");
