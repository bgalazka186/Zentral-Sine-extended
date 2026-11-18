"use strict";

// T2.11b1: the Notes discoverability audit. The document must agree with the code it describes, and the in-app help
// note must be reachable, stable and re-creatable.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
const DOC = fs.readFileSync(path.join(ROOT, "docs/NOTES_DISCOVERABILITY.md"), "utf8");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok - " + name);
  } catch (error) {
    error.message = name + ": " + error.message;
    throw error;
  }
}

// The seven Settings tabs the code really declares (a tab is `id: "<name>", label: "<text>", items: [`).
const TAB_NAMES = { writing: "Writing", markdown: "Markdown", window: "Window", appearance: "Appearance", capture: "Capture", links: "Links & history", zen: "Zen sidebar" };

test("the audit lists exactly the Settings tabs the code has", () => {
  const found = Object.keys(TAB_NAMES).filter((id) => SRC.includes(`id: "${id}", label: `) || SRC.includes(`id: "${id}", label:`));
  assert.deepEqual(found.sort(), Object.keys(TAB_NAMES).sort(), "every tab of the document exists in the code");
  assert.ok(!SRC.includes('id: "reminders", label:'), "there is no Reminders tab to document");
  for (const [id, label] of Object.entries(TAB_NAMES)) assert.ok(DOC.includes("**" + label + "**"), `the document names the ${id} tab`);
  assert.ok(!DOC.includes("**Reminders**"), "the document does not claim a Reminders tab exists");
  assert.match(DOC, /seven tabs/);
  assert.match(DOC, /Reminders \(missed-digest look-back/);
  assert.match(DOC, /version history, the Trash lifetime/);
});

test("the audit names the real Tools entries, not invented ones", () => {
  const needed = ["Holidays & days off", "Reminder history", "Week start", "Display time zone", "Big picture", "Free slots"];
  for (const label of needed) {
    assert.ok(SRC.toLowerCase().includes(label.toLowerCase()), `the code still has "${label}"`);
    assert.ok(DOC.toLowerCase().includes(label.toLowerCase()), `the document mentions "${label}"`);
  }
  // Calendar tools entries live in the calendar toolbar menu, not in All settings: the document says so.
  assert.match(DOC, /Calendar settings live in `Tools`/);
});

test("the in-app help note is wired into the More menu and follows the shipped text", () => {
  assert.ok(SRC.includes("DISCOVERABILITY_NOTE_ID"), "the help note has a stable id");
  assert.ok(SRC.includes('label: "Where is a function? (discoverability list)"'), "the More menu carries the entry");
  assert.ok(SRC.includes("function openDiscoverabilityNote("), "the action exists");
  assert.ok(SRC.includes("store.update(existing.id, body, null)"), "a stale help note follows the shipped text");
  assert.ok(SRC.includes("if (existing && existing.body !== body && !existing.trashed)"), "a trashed help note is left trashed");
  assert.ok(SRC.includes("const DISCOVERABILITY_LINES = ["), "the help note text is one list");
});

test("the two Markdown-mode labels say which one is the default", () => {
  assert.ok(SRC.includes('label: "Markdown mode for every note (a single note sets its own in its More menu)"'), "the default is labelled as such");
  assert.ok(SRC.includes('label: "Markdown mode"'), "the per-note group keeps its short name");
});

test("the document keeps the input for T2.11b2 and the re-audit rule", () => {
  assert.match(DOC, /T2\.11b2/);
  assert.match(DOC, /Re-run this audit after any new control/);
  assert.match(DOC, /## 7\. Discoverability findings/);
});

console.log(`\nPASS notes-discoverability (${passed} tests)`);
