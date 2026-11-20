"use strict";
/* G9 — Game Mode documentation and settings strings. RED on the pre-G9 tree: the README had no complete
 * what-it-does / what-it-does-not-do guide, the settings descriptions still said Game Mode used Level 2 and
 * Stronger saver was a Game Mode switch, and there was no unsaved-page-state warning in the settings window.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const README = read("additional/boost/README.md");
const SCHEMA = json("additional/boost/settings.json");
const LAYOUT = json("extension/settings/layout.json");
const ROOT_PREFS = json("preferences.json");
const BOOST_PREFS = json("additional/boost/preferences.json");
const PLAN = read("docs/PLAN_CODING_AGENT_FOLLOWUP_GAME_MODE.md");
const PERF = read("docs/perf-results.md");
const HANDOFF = read("TODO_notes_roadmap.md");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const row = (rows, property) => rows.find((item) => item && item.property === property);

test("the Boost README explains both sides of Game Mode, the exemptions, Restore and what is lost", () => {
  const guide = README.slice(README.indexOf("## Game Mode guide, exemptions and kill switches (G9)"));
  assert.match(guide, /\*\*What it does\.\*\*/);
  assert.match(guide, /\*\*What it does not do\.\*\*/);
  assert.match(guide, /never closes a tab that refuses `beforeunload`/);
  assert.match(guide, /\*\*Exemptions\.\*\*/);
  assert.match(guide, /picture-in-picture/);
  assert.match(guide, /game_keep_hosts/);
  assert.match(guide, /\*\*Preferences and kill switches\.\*\*/);
  assert.match(guide, /game_restore_on_exit=never/);
  assert.match(guide, /\*\*Restore and what is lost\.\*\*/);
  assert.match(guide, /unsaved page state/);
  assert.match(guide, /short\s+reload/);
  assert.match(guide, /standalone Boost card promised by the owner is G10/);
});

test("Settings descriptions match G8: one plan-driven pass, no Game Mode dependency on Stronger saver", () => {
  const game = row(SCHEMA.schema, "zen.workspace.zentral.boost.game_mode");
  const stronger = row(SCHEMA.schema, "zen.workspace.zentral.boost.stronger_saver");
  const restore = row(SCHEMA.schema, "zen.workspace.zentral.boost.game_restore_tabs");
  assert.match(game.description, /ONE plan-driven unload pass/);
  assert.match(game.description, /late clean about 30 s later/);
  assert.match(game.description, /Unloaded tabs lose unsaved page state/);
  assert.match(stronger.description, /OUTSIDE Game Mode/);
  assert.match(stronger.description, /manual Level 2/);
  assert.doesNotMatch(stronger.description, /Game Mode also puts to sleep/);
  assert.match(restore.description, /short reload/);
});

test("generated root and standalone preferences carry the corrected strings", () => {
  for (const rows of [ROOT_PREFS, BOOST_PREFS]) {
    const game = row(rows, "zen.workspace.zentral.boost.game_mode");
    const stronger = row(rows, "zen.workspace.zentral.boost.stronger_saver");
    assert.ok(game, "game_mode is a placed settings row");
    assert.match(game.description, /ONE plan-driven unload pass/);
    assert.match(game.description, /unsaved page state/);
    assert.match(stronger.description, /OUTSIDE Game Mode/);
  }
  assert.ok(ROOT_PREFS.filter((item) => item && item.property).length >= 607,
    "G9 shipped 607 settings; later tasks may add placed settings");
});

test("the Zentral main settings window has the unsaved-state warning and every Game Mode row", () => {
  const boost = LAYOUT.categories.find((category) => category && category.id === "boost");
  assert.ok(boost, "the Boost category is declared");
  assert.match(boost.description, /Game Mode unloads tabs; unsaved page state is lost and a short reload is needed when you return\./);
  for (const key of [
    "zen.workspace.zentral.boost.game_mode",
    "zen.workspace.zentral.boost.stronger_saver",
    "zen.workspace.zentral.boost.game_keep_hosts",
    "zen.workspace.zentral.boost.game_park_selected",
    "zen.workspace.zentral.boost.game_restore_tabs",
    "zen.workspace.zentral.boost.game_restore_recent_n",
    "zen.workspace.zentral.boost.game_restore_stagger_ms",
    "zen.workspace.zentral.boost.game_restore_on_exit",
  ]) assert.ok(LAYOUT.order.includes(key), key + " is reachable in the settings layout");
});

test("the active plan and perf report keep one G9 row and record G10 before G7", () => {
  assert.match(PLAN, /\*\*DONE \(G9\):\*\*/);
  assert.match(PLAN, /\| `G9` \| \*\*DONE\*\* \(docs \+ strings\) \|/);
  assert.match(PLAN, /\| `G10` \| \*\*DONE\*\*/);
  assert.match(PLAN, /\| `G7` \| (?:OPEN|\*\*DONE\*\*)/);
  assert.match(PERF, /\| `G9` \|/);
  assert.match(PERF, /tests\/g9-game-mode-docs\.test\.cjs` \(6 passed\)/);
});

test("the single handoff records G9 DONE, the RED/chain evidence and the next task", () => {
  const handoff = HANDOFF.slice(HANDOFF.indexOf("## NEXT SESSION HANDOFF"));
  assert.match(handoff, /`G9` \(docs \+ settings strings\)/);
  assert.match(handoff, /`G10`/);
  assert.match(handoff, /`G7`/);
  assert.match(handoff, /`g9-game-mode-docs` \(6\)/);
  assert.match(handoff, /G6, G8, G9.*strict RED proof/);
  assert.match(handoff, /\d+\/\d+ passed; 0 failed/);
  assert.match(handoff, /`G10` must be done before `G7`/);
});

for (const [name, fn] of tests) {
  fn();
  passed++;
  console.log("ok -", name);
}
console.log(`\n${passed}/${tests.length} G9 tests passed`);
