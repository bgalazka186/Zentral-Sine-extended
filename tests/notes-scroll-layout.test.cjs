"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.css"), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s").exec(css);
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

const scrollports = rule(".zentral-notes-sheet .zn-editor,\n.zentral-notes-sheet .zn-read");
assert.match(scrollports, /(?:^|;)\s*overflow:\s*auto\s*(?:;|$)/, "editor and read preview must accept wheel/trackpad scrolling");
assert.match(scrollports, /overscroll-behavior:\s*contain/, "scrolling a note must not chain into the browser behind it");
assert.match(scrollports, /scrollbar-width:\s*thin/, "scrollbars should remain compact in the note sheet");

const geometry = rule(".zentral-notes-sheet .zn-editor,\n.zentral-notes-sheet .zn-read,\n.zentral-notes-sheet .zn-all-layout");
assert.match(geometry, /overflow:\s*hidden/, "the shared geometry rule still clips the outer layout before the scrollport override");
assert.match(rule(".zentral-notes-sheet .zn-all-layout"), /overflow:\s*hidden/, "All Notes keeps clipping its frame; its list/calendar panes own scrolling");
assert.match(
  rule(":root[zentral-notes-wrap=\"off\"] .zentral-notes-sheet .zn-editor"),
  /overflow-x:\s*auto/,
  "disabling line wrapping still permits horizontal scrolling",
);
assert.match(
  rule(".zentral-notes-sheet[data-mode=\"split\"][data-view=\"editor\"] .zn-editor,\n.zentral-notes-sheet[data-mode=\"split\"][data-view=\"editor\"] .zn-read"),
  /flex:\s*1 1 0/,
  "both split panes retain independent constrained flex sizing",
);

const tableScroll = rule(".zentral-notes-sheet .zn-read .zn-table-wrap");
assert.match(tableScroll, /display:\s*block/, "the table scrollport establishes its own block");
assert.match(tableScroll, /(?:^|;)\s*width:\s*100%/, "the scrollport is constrained to its parent pane");
assert.match(tableScroll, /max-width:\s*100%/, "nested tables cannot widen their container");
assert.match(tableScroll, /min-width:\s*0/, "nested flex items can shrink");
assert.match(tableScroll, /box-sizing:\s*border-box/, "padding or borders cannot widen the scrollport");
assert.match(tableScroll, /overflow-x:\s*auto\s*!important/, "wide tables have a horizontal native scrollbar even in a restrictive host");
assert.match(tableScroll, /scrollbar-width:\s*auto\s*!important/, "host scrollbar hiding and thin bars do not suppress the table scrollbar");
assert.match(tableScroll, /overscroll-behavior-x:\s*contain/, "horizontal scrolling does not scroll the note or browser");
console.log("Notes scrolling layout regression tests passed");
