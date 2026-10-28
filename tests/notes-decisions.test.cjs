"use strict";
/* Pins the owner's Notes decisions so a later change has to be deliberate:
 *  - no encryption at rest (losing a key would lose the notes); notes stay plain, readable data
 *  - default sheet size is "peek"
 *  - the floating card is an ordinary layer, not a top-layer popover, so Big Preview stays above it */
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
test("floating card is not a popover (Big Preview stays above it)", () => {
  assert.ok(!/showPopover|setAttribute\("popover"/.test(js), "notes card must not enter the top layer");
});
console.log(`\n${passed} notes decision tests passed`);
