"use strict";
/* Pins the owner's Notes decisions so a later change has to be deliberate:
 *  - no encryption at rest (losing a key would lose the notes); notes stay plain, readable data
 *  - default sheet size is "peek"
 *  - the standalone card is a top-layer popover ONLY while Notes is focused (roadmap cycle C #3, replaces the old
 *    "never a popover" decision): above Big Preview until Big Preview is pressed, then back to a normal layer */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const prefs = fs.readFileSync(path.join(root, "additional/notes/preferences.json"), "utf8");
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

test("no encryption: no crypto.subtle use and no encryption setting", () => {
  assert.ok(!/crypto\.subtle|SubtleCrypto|encryptNote|passphrase/i.test(js), "notes code must not encrypt");
  assert.ok(!/encrypt/i.test(prefs), "no encryption preference is offered");
});
test("default sheet size is peek", () => {
  assert.match(js, /DEFAULT_META = \{[^}]*size: "peek"/);
});
test("standalone card is a popover only while focused, and never a popover inside a panel", () => {
  assert.match(js, /function raise\(\) \{\s*if \(adapter\.position !== "fixed"/, "only the fixed (standalone) host can enter the top layer");
  assert.match(js, /function drop\(\) \{[\s\S]*?removeAttribute\("popover"\)/, "dropping removes the attribute so the card stays visible");
  assert.match(js, /onOutsidePress = [\s\S]*?drop\(\);/, "any press outside the card leaves the top layer");
  assert.equal((js.match(/showPopover\(\)/g) || []).length, 1, "one place enters the top layer");
});
test("C2.1: docked card remembers its own geometry; heading levels differ; toolbar icon uses a rule with context properties", () => {
  assert.match(js, /GEO_KEYS = Object\.freeze\(\["panel", "float", "dock"\]\)/, "dock has a geometry slot");
  assert.match(js, /return docked\(\) \? "dock" : "float"/, "docked card is movable and resizable too");
  assert.match(js, /sheet\.applyState\?\.\(\);\s*sheet\.layout\(\)/, "flipping the dock option refreshes the geometry flags");
  const css = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.css"), "utf8");
  const sizes = [1, 2, 3, 4, 5, 6].map((n) => (css.match(new RegExp("h" + n + "\\.zn-h \\{ font-size: ([0-9.]+)em")) || [])[1]);
  assert.ok(sizes.every(Boolean), "every level has a size: " + sizes);
  assert.equal(new Set(sizes).size, 6, "six different sizes: " + sizes);
  assert.match(js, /-moz-context-properties:fill,stroke/, "icon rule opts in to context-stroke");
  assert.match(js, /ensureWidgetPlacedInWindow/, "widget is placed in open windows without customize mode");
});
console.log(`\n${passed} notes decision tests passed`);
