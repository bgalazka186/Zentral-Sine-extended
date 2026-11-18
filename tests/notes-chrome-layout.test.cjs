"use strict";
/* OW-101: the note's top bar sank to the bottom of its own space and was half hidden by the tool strip.
 *
 * The sheet is a column flexbox (`.zentral-notes-sheet { display: flex; flex-direction: column }`). Every chrome row in
 * it — the head, the formatting tools, the strip, the find bar, the wiki bar, the footer — declared no `flex` at all,
 * so each defaulted to `flex: 0 1 auto`: freely SHRINKABLE. Nothing else in the column was. When the editor's content
 * pushed back, those rows lost height; `align-items: center` then centred a 26px button inside a 12px box, the row's
 * own content sank out of the middle, and the bar underneath painted over the overflow.
 *
 * The rule that keeps it fixed is "a chrome row is exactly as tall as its content": `flex: 0 0 auto`. Only the body
 * grows. This file pins that, and pins it for every chrome row rather than just the head — the same bug can come back
 * through any one of them.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

const CSS = fs.readFileSync(path.join(__dirname, "..", "additional", "notes", "ZentralNotes.css"), "utf8");
const JS = fs.readFileSync(path.join(__dirname, "..", "additional", "notes", "ZentralNotes.uc.js"), "utf8");

/** The declaration block for a selector list containing `token`, as a string. */
const rules = (token) => {
  const out = [];
  let i = 0;
  while ((i = CSS.indexOf(token, i)) !== -1) {
    const open = CSS.indexOf("{", i);
    const close = CSS.indexOf("}", open);
    if (open === -1 || close === -1) break;
    out.push({ selector: CSS.slice(CSS.lastIndexOf("}", i) + 1, open), body: CSS.slice(open + 1, close) });
    i = close;
  }
  return out;
};

test("the sheet is a column flexbox, which is what makes shrinking possible", () => {
  const sheet = rules(".zentral-notes-sheet {").find((r) => /display: flex/.test(r.body) && /flex-direction: column/.test(r.body));
  assert.ok(sheet, "the sheet stacks its rows in a column");
});

test("every chrome row is fixed at its content height, never shrinkable", () => {
  const rows = ["zn-head", "zn-tools", "zn-strip", "zn-findbar", "zn-wikibar", "zn-foot"];
  for (const row of rows) {
    const found = rules(`.zentral-notes-sheet .${row}`).find((r) => /flex: 0 0 auto/.test(r.body));
    assert.ok(found, `.${row} must declare flex: 0 0 auto, or it is the row that starves when the body pushes back`);
  }
});

test("the head's content is centred in the row, not left to sink", () => {
  const head = rules(".zentral-notes-sheet .zn-head").find((r) => /align-items: center/.test(r.body));
  assert.ok(head, "the head centres its buttons horizontally within the row");
  const centred = rules(".zentral-notes-sheet .zn-head").some((r) => /align-content: center/.test(r.body));
  assert.ok(centred, "and a wrapped second line is centred as a block too, instead of collecting at the bottom");
});

test("only the body grows, so the rows keep the space they need", () => {
  const body = rules(".zentral-notes-sheet .zn-body").find((r) => /flex: 1 1 auto/.test(r.body));
  assert.ok(body, "the body is the one element that takes the remaining height");
});

test("the tool strip is below the head, not over it", () => {
  // DOM order decides paint order for non-positioned flex items: a row that comes later can only cover an earlier one
  // if that one overflowed. The order itself is correct — this pins it against a future reshuffle.
  const at = JS.indexOf("root.append(head, tools");
  assert.ok(at > 0, "the card appends head, then tools, then the strip");
  const order = JS.slice(at, at + 80);
  assert.match(order, /root\.append\(head, tools, strip, findBar, wikiBar, body/, "head before tools before strip before body");
});

test("no chrome row is positioned, which would let it cover a neighbour", () => {
  for (const row of ["zn-head", "zn-tools", "zn-strip"]) {
    const positioned = rules(".zentral-notes-sheet ." + row).some((r) => /position:\s*(absolute|fixed)/.test(r.body));
    assert.ok(!positioned, `.${row} stays in the flow`);
  }
});

console.log(`\n${passed} note chrome layout tests passed`);
