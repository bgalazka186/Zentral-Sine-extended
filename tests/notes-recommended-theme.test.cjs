"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const css = fs.readFileSync(path.join(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
function rule(selector) {
  const start = css.indexOf(selector + " {");
  assert.ok(start >= 0, "missing rule " + selector);
  return css.slice(start + selector.length + 2, css.indexOf("}", start));
}
function luminance(hex) {
  const c = hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => x - y); return (values[1] + .05) / (values[0] + .05); }
const recommended = rule(':root[zentral-notes-theme="recommended"] .zentral-notes-sheet');
assert.match(recommended, /color-scheme:\s*var\(--zl-input-scheme,\s*light dark\)/);
const accent = /--zn-accent:\s*light-dark\((#[a-f\d]{6}),\s*(#[a-f\d]{6})\)/i.exec(recommended);
assert.ok(accent, "recommended accent is independent of the host primary color in light and dark modes");
assert.match(recommended, /--zn-line:\s*var\(--zl-button-border-color/);
assert.ok(contrast(accent[1], "#ffffff") >= 4.5, "light accent remains readable on the light popup");
assert.ok(contrast(accent[2], "#1f1f24") >= 4.5, "dark accent remains readable on the dark popup");
const selection = rule(':root[zentral-notes-theme="recommended"]:not([zentral-notes-ov~="accent"]) .zentral-notes-sheet .zn-cal-month-cell.is-selected .zn-cal-month-date');
const text = /color:\s*light-dark\((#[a-f\d]{6}),\s*(#[a-f\d]{6})\)/i.exec(selection);
assert.ok(text, "selected date text adapts to the recommended default accent");
assert.ok(contrast(text[1], accent[1]) >= 4.5); assert.ok(contrast(text[2], accent[2]) >= 4.5);
const override = rule(':root[zentral-notes-ov~="accent"] .zentral-notes-sheet');
assert.match(override, /--zn-accent:\s*var\(--zentral-notes-ov-accent\)/);
assert.ok(css.indexOf(':root[zentral-notes-ov~="accent"] .zentral-notes-sheet') > css.indexOf(':root[zentral-notes-theme="recommended"] .zentral-notes-sheet'), "explicit accent override wins");
console.log("Recommended Notes theme accent tests passed");
