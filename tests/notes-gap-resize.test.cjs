"use strict";
/* Structural guard for pointer ownership when Notes is placed between Triple View panels.
 * A live Zen drag test is still required for native hit-testing and pointer capture. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const notes = read("additional/notes/ZentralNotes.uc.js");
const css = read("extension/panels/browsers/ZentralBrowserIntegrations.css");
const sourceCss = read("additional/notes/ZentralNotes.css");
assert.match(notes, /if \(between\) rootEl\.setAttribute\("bgalazka-notes-gap", "true"\);\s*else rootEl\.removeAttribute\("bgalazka-notes-gap"\);/,
  "Notes marks the gap only while its slot is active and clears it when it becomes a dock slot");
assert.match(notes, /r\.removeAttribute\("bgalazka-notes-gap"\);/,
  "releasing the slot clears the marker");
assert.match(css, /:root\[bgalazka-notes-gap="true"\] \.bgalazka-triple-drag-handle\s*\{\s*pointer-events:\s*none\s*!important;/,
  "the overlapping fixed Triple divider hit target yields to Notes while Notes owns the gap");
assert.match(sourceCss, /\.zentral-notes-sheet\[data-slot="gap"\] \.zn-rz\[data-h="s"\]/,
  "the Notes gap bottom grip remains an enabled resize target");
assert.match(notes, /kind\.includes\("s"\) && slot === "gap" \? "s"/,
  "bottom-edge gestures in the between-bars gap resize the Notes slot");
console.log("ok - Notes gap owns the bottom resize hit target while open");
console.log("\n1 Triple View gap-resize guard passed");
