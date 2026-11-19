"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const doc = fs.readFileSync(path.join(ROOT, "docs/zen-1243b-compat-audit.md"), "utf8");
const todo = fs.readFileSync(path.join(ROOT, "TODO_notes_roadmap.md"), "utf8");
const notes = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
const widgets = fs.readFileSync(path.join(ROOT, "additional/widgets/ZentralWidgets.uc.js"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

try {
  test("1. audit pins the 1.24.3b release tag, date and owner-listed changes", () => {
    assert.match(doc, /1\.24\.3b/);
    assert.match(doc, /300f9292ddbaaebf24626b4a7451e5426a11d3d8/);
    assert.match(doc, /2026-11-18/);
    assert.match(doc, /Firefox `160\.0\.1`/);
    for (const ghsa of ["GHSA-384m-hxgx-xpph", "GHSA-gv58-qvc9-mhv2", "GHSA-gq43-4g7g-3fc9", "GHSA-p9x3-fx2f-hf87"]) {
      assert.ok(doc.includes(ghsa), ghsa);
    }
    assert.match(doc, /Spaces Sync built-in containers/);
    assert.match(doc, /copy URL of all selected tabs/i);
    assert.match(doc, /Zoom button hidden in single-toolbar layout/i);
  });

  test("2. OW-122 is recorded as the only required mod change for this release", () => {
    assert.match(doc, /already fixed by\s+`OW-122`/);
    assert.match(doc, /No further 1\.24\.3b-specific mod change is required beyond `OW-122`/);
    assert.match(todo, /`OW-125`[^\n]*Zen `1\.24\.3b` compatibility audit/);
  });

  test("3. source still parses and carries the live Spaces Sync shields", () => {
    execFileSync(process.execPath, ["--check", path.join(ROOT, "additional/notes/ZentralNotes.uc.js")]);
    execFileSync(process.execPath, ["--check", path.join(ROOT, "additional/widgets/ZentralWidgets.uc.js")]);
    for (const needle of [
      "resource:///modules/zen/ZenWindowSync.sys.mjs",
      "resource:///modules/zen/ZenSpacesSyncModel.sys.mjs",
      "resource:///modules/zen/ZenSpacesSyncApplier.sys.mjs",
      "spaces|zen[-_]?pins",
    ]) assert.ok(notes.includes(needle), needle);
  });

  test("4. no Firefox preferences-page opener is assumed", () => {
    const runtimeDirs = ["additional", "extension", "loader", "zentral"];
    const forbidden = /about:preferences|preferences\.xhtml|chrome:\/\/browser\/content\/preferences/;
    for (const dir of runtimeDirs) {
      const walk = (p) => {
        for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          const full = path.join(p, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(?:uc\.)?js$/.test(entry.name) && !entry.name.includes(".standalone.")) {
            assert.doesNotMatch(fs.readFileSync(full, "utf8"), forbidden, full);
          }
        }
      };
      walk(path.join(ROOT, dir));
    }
  });

  test("5. live behavior remains an OWNER GATE, not a measured claim", () => {
    assert.match(doc, /OWNER GATE/);
    assert.match(doc, /does not claim live visual, performance, memory, multi-tab copy, compact-tab or\s+startup behavior/);
    assert.match(widgets, /Rain tomorrow/, "the weather rain-timing bug is still open as OW-128");
  });

  console.log(`Zen 1.24.3b compatibility audit tests passed (${passed})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
