"use strict";
/* R5 — the three Restore owner gates stay in the single handoff, and the plan tracker agrees.
 *
 * The follow-up plan (section R5) asks for exactly three live checks; they need a real Zen/Sine session, so this
 * repository test only proves that they are recorded verbatim enough for the owner to reproduce them, that the
 * console door is named, and that no document claims them as measured.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const HANDOFF = read("TODO_notes_roadmap.md");
const PLAN = read("docs/PLAN_CODING_AGENT_FOLLOWUP_RESTORE.md");
const PERF = read("docs/perf-results.md");
const README = read("additional/boost/README.md");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("the handoff carries one Restore owner-gate block with the three live checks", () => {
  assert.match(HANDOFF, /\*\*Restore follow-up owner gates \(R5, none measured here\):\*\*/);
  // (A) the console read of the snapshot counts
  assert.match(HANDOFF, /Services\.wm\.getMostRecentWindow\("navigator:browser"\)\.ZentralBoost\.gameModeState\(\)/);
  assert.match(HANDOFF, /send the `snapshot` counts \(`panels`\/`tabs`\)/);
  // (B) the mixed session: arena.ai as a TAB, WhatsApp in its PANEL
  assert.match(HANDOFF, /arena\.ai loaded as a pinned TAB and WhatsApp loaded in its PANEL/);
  assert.match(HANDOFF, /arena\.ai must return as a TAB \(its tile shows no loaded panel\)/);
  assert.match(HANDOFF, /WhatsApp must return in its panel/);
  assert.match(HANDOFF, /the original tab must be selected again and no other panel may appear/);
  // (C) the 5-second cancel path
  assert.match(HANDOFF, /press Restore within 5 seconds: no panel may appear for any tab-only page/);
});

test("the gates are recorded as owner work, never as measured", () => {
  assert.match(HANDOFF, /These need a live Zen\/Sine session; no live runtime, toast or visual result is claimed\./);
  assert.match(HANDOFF, /gate A\/B\/C above \(live `snapshot` counts, a mixed tab\+panel Restore, and a Restore within 5 s\) are not measured/);
  assert.doesNotMatch(HANDOFF, /Restore follow-up[^\n]*measured here: (?!none)/);
});

test("the plan tracker marks R1..R5 with their evidence and keeps R5 unmeasured", () => {
  assert.match(PLAN, /## 6\. Status tracker \(updated by the coding agent\)/);
  for (const row of ["`R1`", "`R2`", "`R3`", "`R4`", "`R5`"]) {
    assert.match(PLAN, new RegExp("\\| " + row.replace(/[`]/g, "`") + " — "), `${row} has a tracker row`);
  }
  assert.match(PLAN, /\| `R5` — owner gates \| \*\*DONE \(recorded, not measured\)\*\*/);
  assert.match(PLAN, /No live Zen\/Sine runtime, toast, visual or RAM result is\s+claimed/);
  assert.doesNotMatch(PLAN, /\| `R[1-4]` [^\n]*measured live/);
});

test("the perf report has one line per Restore task, all 'not measured'", () => {
  for (const row of ["`R1`", "`R2`", "`R3`", "`R4`"]) {
    assert.match(PERF, new RegExp("\\| " + row + " \\|"), `${row} has a perf row`);
  }
  const rRows = PERF.split("\n").filter((line) => /^\| `R[1-4]` \|/.test(line));
  assert.equal(rRows.length, 4, "exactly one row per task");
  for (const row of rRows) {
    assert.match(row, /not measured/, "no figure is invented");
    assert.match(row, /tests\//, "each row names its suite");
  }
});

test("the README and the code keep the behaviour the gates will check", () => {
  assert.match(README, /\| Before the sleep \| After Restore \|/);
  assert.match(README, /no\*\* panel is created/);
  const BOOST = read("additional/boost/ZentralBoost.uc.js");
  assert.match(BOOST, /const panelWas = Boolean\(browser\);/);
  assert.match(BOOST, /const tabWas = Boolean\(record\?\.tab\) && !tabAlreadyAsleep\(record\.tab\);/);
  assert.match(BOOST, /function recordPanelSleepHolders\(record, appId, slept, mode, extra = \{\}\)/);
  assert.match(BOOST, /sessionEntries: \(\) => \(\{/);
  assert.doesNotMatch(BOOST, /setInterval\(/);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed += 1;
    console.log("ok -", name);
  }
  console.log(`\n${passed}/${tests.length} R5 owner-gate tests passed`);
})().catch((error) => {
  console.error("FAIL:", error?.message || error);
  console.error(error?.stack || "");
  process.exit(1);
});
