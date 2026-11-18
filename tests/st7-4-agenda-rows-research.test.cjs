"use strict";
/* ST7.4: the prototype report is the deliverable. This suite pins its existence, visibility to Git,
 * explicit verification limits and the source contracts the static investigation rests on.
 * RED on the pre-ST7.4 tree.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const reportPath = "docs/st7-4-agenda-rows-research.md";
const report = read(reportPath);
const ignore = read(".gitignore");
const main = read("additional/notes/ZentralNotes.uc.js");
const runtime = read("loader/ZentralRuntime.js");

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

test("the prototype report exists and is not ignored by Git", () => {
  assert.ok(fs.existsSync(path.join(ROOT, reportPath)));
  assert.ok(ignore.includes("!docs/st7-4-agenda-rows-research.md"), "the report is whitelisted");
  const ignored = cp.spawnSync("git", ["check-ignore", "-q", reportPath], { cwd: ROOT }).status === 0;
  assert.equal(ignored, false, "git check-ignore does not hide the report");
});

test("the report records the question, prototype, blockers and verification limits", () => {
  for (const heading of ["# ST7.4", "## 1. Question and acceptance", "## 3. Current architecture",
    "## 4. Feasibility by capability", "## 5. Flag-gated prototype design", "## 6. Abandon decision",
    "## 7. Owner / live-Zen gate", "## 8. Result"])
    assert.ok(report.includes(heading), heading + " is present");
  assert.ok(report.includes("zen.workspace.zentral.notes.agenda_dom_rows"), "the proposed flag is named");
  assert.ok(report.includes("no live Zen/Sine runtime"), "the sandbox limit is explicit");
  assert.ok(report.includes("no runtime prototype is shipped"), "the abandon decision is explicit");
  assert.ok(report.includes("Prototype report"), "the done condition is named");
});

test("the report's static claims match the current source contracts", () => {
  assert.ok(main.includes("function agendaNewTab(key)"));
  assert.ok(main.includes("window.gZenFolders.createFolder([seed]"));
  assert.ok(main.includes("application/x-moz-tabbrowser-tab"));
  assert.ok(main.includes('const ZEN_TAB_EVENTS = ["TabClose", "TabUnpinned", "TabPinned", "TabMove", "TabBrowserDiscarded", "SSTabRestored"]'));
  assert.ok(main.includes("const agendaTabFromNode = (node) =>"));
  assert.ok(runtime.includes("function createSidebarHoverCard(options)"));
  assert.ok(runtime.includes("const matchTarget = typeof options.matchTarget === \"function\""));
  assert.ok(report.includes("tests/helpers/fake-zen-browser.cjs"));
  assert.ok(report.includes("39 `notes-agenda*`, `notes-sidebar*`, `zen-sidebar*` suites"));
});

console.log(`\nst7-4-agenda-rows-research (${passed} passed)`);
