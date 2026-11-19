"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const doc = fs.readFileSync(path.join(ROOT, "docs/zen-125t-compat-audit.md"), "utf8");
const todo = fs.readFileSync(path.join(ROOT, "TODO_notes_roadmap.md"), "utf8");
const shell = fs.readFileSync(path.join(ROOT, "extension/settings/controllers/ZentralSettingsShell.js"), "utf8");
const developer = fs.readFileSync(path.join(ROOT, "extension/settings/controllers/ZentralDeveloperSettings.js"), "utf8");
const notes = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

try {
  test("1. audit records the two Twilight 1.25t changes and the missing tag", () => {
    assert.match(doc, /Twilight 1\.25t readiness audit/);
    assert.match(doc, /Little Zen/);
    assert.match(doc, /keyboard shortcut from any app/);
    assert.match(doc, /Zen now has its own settings window/);
    assert.match(doc, /no `1\.25t` tag or release/);
  });

  test("2. Zentral already owns its settings shell and does not open Firefox preferences", () => {
    assert.match(doc, /Zentral already owns an in-chrome settings UI/);
    assert.match(doc, /does not open `about:preferences`/);
    assert.ok(shell.includes("ZentralSettingsShell") || shell.includes("settings"), "settings shell source exists");
    assert.match(developer, /Feature settings/);
    assert.doesNotMatch(shell, /about:preferences/);
    assert.doesNotMatch(developer, /about:preferences/);
  });

  test("3. window assumptions are identified without guessing a guard", () => {
    assert.match(doc, /getEnumerator\("navigator:browser"\)/);
    assert.match(doc, /Services\.focus\.activeWindow/);
    assert.ok(notes.includes('getEnumerator("navigator:browser")'));
    assert.ok(notes.includes('getMostRecentWindow?.("navigator:browser")'));
    assert.match(doc, /implementing such a guard would be a guess/);
  });

  test("4. audit asks only for targeted live facts and records the TODO row", () => {
    assert.match(todo, /`OW-126`[^\n]*Twilight `1\.25t` readiness/);
    assert.match(doc, /only targeted facts \(not a full dump\)/);
    assert.match(doc, /windowtype/);
    assert.match(doc, /#navigator-toolbox/);
    assert.match(doc, /#tabbrowser-tabs/);
    assert.match(doc, /OWNER GATE/);
  });

  console.log(`Twilight 1.25t readiness audit tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
