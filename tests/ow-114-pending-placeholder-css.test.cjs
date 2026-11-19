"use strict";
/* OW-114 (owner audit F4): do not guess what a parked Notes/Agenda placeholder looks like.
 *
 * OW-88 gives those inert sidebar rows `[pending]`. This suite demands a screenshot-free, reproducible
 * CSS audit of every pending rule in `additional` and `extension` stylesheets, a narrow override for
 * the four OUR compact-density rules that hide/collapse a pinned pending row, and an honest handoff
 * about third-party Arc/Zen unloaded-tab styles (which this repository cannot fix).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const { audit, format } = require("../tools/audit-pending-placeholder-css.cjs");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("the screenshot-free audit lists every pending rule in the two owned CSS trees", () => {
  const report = audit();
  assert.deepEqual(report.scopes, ["additional", "extension"]);
  // 4 compact-density rules + 5 Appearance rules that require a loaded panel launcher + the OW-114 override(s).
  assert.equal(report.matching.length, 4, "exactly four OUR rules can hide a parked placeholder");
  assert.ok(report.overrides.length >= 4, "each of those has a narrow Notes/Agenda override");
  assert.ok(report.rules.length >= 13, "every candidate is listed, including the non-matching ones");
  assert.equal(report.visual.length, 10, "OW-116's Notes-owned visual rules are listed separately");
  assert.ok(report.visual.every((r) => r.file === "additional/notes/ZentralNotes.css" && !r.matches),
    "visual rules do not masquerade as compact-density matches");
  assert.ok(report.placeholderLayout.length >= 42, "OW-120's narrow placeholder geometry rules are listed separately");
  assert.ok(report.placeholderLayout.every((r) => r.file === "additional/notes/ZentralNotes.css" && !r.matches),
    "OW-120 rules stay in Notes' CSS and are not compact-density matches");

  const density = report.matching;
  assert.ok(density.every((r) => r.file === "additional/tabs/ZentralTabDensity.css"));
  assert.deepEqual(density.map((r) => r.line), [357, 371, 388, 488],
    "the four compact-density rules, at their rule-start lines");
  assert.ok(density.every((r) => r.look.some((x) => x.startsWith("opacity:") || x.startsWith("height:"))),
    "they really change opacity/layout");
  assert.ok(density.every((r) => r.reason.includes("compact density")));

  // The Appearance rules only fire for a pending tab with a LOADED Essential-panel launcher, which a
  // Notes/Agenda placeholder never has. They are reported as non-matching, not silently omitted.
  const appearance = report.rules.filter((r) => r.file === "extension/appearance/ZentralAppearance.css");
  assert.equal(appearance.length, 5, "all five `[pending=\"true\"]` Appearance rules are listed");
  assert.ok(appearance.every((r) => r.matches === false));
  assert.ok(appearance.every((r) => r.reason.includes("Essential-panel")));
});

test("the narrow override restores the parked row/folder look and comes after the hiding rules", () => {
  const report = audit();
  const density = read("additional/tabs/ZentralTabDensity.css");
  const overrides = report.overrides;
  assert.ok(overrides.length >= 4);
  assert.ok(overrides.every((r) => r.file === "additional/tabs/ZentralTabDensity.css"));
  assert.ok(overrides.every((r) => r.line > 488), "the override wins by source order too");
  assert.ok(overrides.every((r) => r.selector.includes("zen-folder[bgalazka-notes-folder]")),
    "scoped to the Notes folder");
  assert.ok(overrides.some((r) => r.selector.includes("tab[bgalazka-notes-item][pending]")),
    "the Notes item marker");
  assert.ok(overrides.some((r) => r.selector.includes("tab[bgalazka-notes-agenda-item][pending]")),
    "the Agenda item marker");
  const all = overrides.flatMap((r) => r.declarations.map((d) => `${d.property}: ${d.value}`));
  for (const wanted of [
    "opacity: 1 !important", "filter: none !important", "pointer-events: auto !important",
    "height: auto !important", "max-height: none !important", "overflow: visible !important",
  ]) assert.ok(all.includes(wanted), wanted + " is restored");
  assert.ok(all.some((x) => x.startsWith("min-height: var(--bgalazka-look-tabbar-row-height")));
  assert.ok(all.some((x) => x.startsWith("margin-block: var(--bgalazka-look-tabbar-row-gap")));
  assert.ok(all.some((x) => x.startsWith("padding-block:")));
  assert.match(density, /bgalazka-notes-agenda-item\]\[pending\]/);
});

test("the generated report and the handoff carry the exact rule list and the OWNER GATE", () => {
  const report = audit();
  const doc = "docs/ow-114-pending-css-audit.md";
  assert.equal(read(doc), format(report), "the checked-in report is generated from the current CSS");
  for (const line of [357, 371, 388, 488]) {
    assert.match(read(doc), new RegExp("ZentralTabDensity\\.css:" + line + "\\b"));
  }
  const handoff = read("TODO_notes_roadmap.md");
  for (const needle of [
    "OW-114", "additional/tabs/ZentralTabDensity.css:357", "additional/tabs/ZentralTabDensity.css:488",
    "arc-grayscale-unloaded-tabs", "browser.tabs.fadeOutUnloadedTabs", "OWNER GATE",
  ]) assert.ok(handoff.includes(needle), "handoff mentions " + needle);
  assert.match(read(doc), /OWNER GATE/);
  assert.match(read(doc), /third-party|Arc\/Zen/);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-114-pending-placeholder-css (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
