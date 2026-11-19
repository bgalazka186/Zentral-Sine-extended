"use strict";
/* OW-120 (owner Browser Console diagnostic, 2026-11-18/19): the first visual fix
 * only covered `zen-folder[bgalazka-notes-folder]`. The owner's JSON showed Agenda
 * rows under `bgalazka-notes-agenda-folder` / `-day`, a 12 px centred Notes header,
 * a 26 px note row with a 0 px label container, and Agenda `opacity: 0.69` /
 * `filter: grayscale(1)`. This suite pins the narrow, diagnostic-driven fix and
 * proves it does not become a generic Zen sidebar / compact-tabs override. Static
 * and screenshot-free; live appearance is an OWNER GATE.
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { audit, format, parseRules, stripComments } = require("../tools/audit-pending-placeholder-css.cjs");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const NOTES_CSS = "additional/notes/ZentralNotes.css";
const DENSITY_CSS = "additional/tabs/ZentralTabDensity.css";
const OW116_SHA = "03648d9ba1c9411ba78698df1c615641612fa5116f81ed2d9c85c08e45276519";
const OLD_NOTES_LOCK_HASH = "f2642eb13c46ff899d3491b34bac493356fe5930165dae7ee2da8eed99b3c36b";

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const css = read(NOTES_CSS);
const ow120Start = css.indexOf("/* OW-120:");
const ow116Start = css.indexOf("/* OW-116:");
const ow120Block = ow120Start >= 0 && ow116Start > ow120Start
  ? css.slice(ow120Start, ow116Start)
  : "";
const ow116Block = ow116Start >= 0 ? css.slice(ow116Start) : "";

test("RED guard: the OW-120 block exists before the unchanged OW-116 colour rules", () => {
  assert.ok(ow120Start >= 0, "a dedicated OW-120 diagnostic block is present");
  assert.ok(ow116Start > ow120Start, "OW-120 is inserted before OW-116 so the OW-119 slice guard still sees only colour rules");
  assert.ok(ow120Block.length > 4000, "the OW-120 block carries the full narrow fix, not a stub");
  const sha = crypto.createHash("sha256").update(ow116Block).digest("hex");
  assert.equal(sha, OW116_SHA, "the ten OW-116 selector rows remain byte-for-byte unchanged");
  assert.doesNotMatch(read(DENSITY_CSS), /OW-120/, "compact-tabs CSS is untouched by OW-120");
});

test("OW-120 selectors are narrow, high-specificity and pseudo-tab-only", () => {
  const pending = /\[pending[^\]]*\]/;
  const mark = /bgalazka-notes-(?:item|agenda-item|folder|agenda-folder|agenda-day)/;
  const rules = parseRules(stripComments(ow120Block), NOTES_CSS)
    .filter((r) => pending.test(r.selector) && mark.test(r.selector));
  assert.ok(rules.length >= 42, "the audit sees at least 42 narrow OW-120 selector rows");
  for (const rule of rules) {
    assert.match(rule.selector, /^:root\[lang\]\[dir\] #tabbrowser-tabs /, "every rule uses the high-specificity chrome prefix");
    assert.match(rule.selector, pending, "every rule is tied to a pending placeholder or a folder that has one");
    assert.match(rule.selector, mark, "every rule carries an owned Notes/Agenda marker");
  }
  const declarationsOnly = stripComments(ow120Block);
  for (const forbidden of [":is(", "bgalazka-tabbar-compact", "zen-sidebar-expanded", "zen-compact-mode",
    "visibility: hidden", "display: none"]) {
    const escaped = forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    assert.doesNotMatch(declarationsOnly, new RegExp(escaped), "OW-120 never uses a generic/hiding escape hatch: " + forbidden);
  }
  assert.doesNotMatch(declarationsOnly, /(?:^|[;{\s])(?:width|height|font-size)\s*:\s*0(?:px)?\s*(?:!|;|})/m,
    "OW-120 never zeroes a width, height or font size; min-width: 0 is allowed to let a flex child shrink");
  assert.doesNotMatch(declarationsOnly, /:root\s+tab\[pending\][^{]*\{[^}]*filter:\s*none/, "no blanket pending-tab override");
  assert.match(read("additional/tabs/ZentralTabDensity.css"), /:has\(/, "compact CSS already uses :has(); OW-120 introduces no new selector family");
});

test("OW-120 covers both Agenda folder markers and the Notes folder header", () => {
  for (const needle of [
    "zen-folder[bgalazka-notes-folder]",
    "zen-folder[bgalazka-notes-agenda-folder]",
    "zen-folder[bgalazka-notes-agenda-day]",
    "tab[bgalazka-notes-item][pending]",
    "tab[bgalazka-notes-agenda-item][pending]",
    "tab-group-label-container",
    "tab-icon-image",
    "tab-label-container",
    "tab-label",
  ]) assert.ok(ow120Block.includes(needle), "OW-120 covers " + needle);
  for (const declaration of [
    "filter: none !important", "opacity: 1 !important", "width: 100% !important",
    "margin-inline: 0 !important", "flex: 0 0 auto !important", "align-self: stretch !important",
    "justify-content: flex-start !important", "align-items: stretch !important",
    "width: auto !important", "flex: 1 1 auto !important", "contain: none !important",
    "overflow: hidden !important", "text-overflow: ellipsis !important", "white-space: nowrap !important",
    "text-align: start !important", "visibility: visible !important",
  ]) assert.ok(ow120Block.includes(declaration), "OW-120 restores " + declaration);
});

test("the CSS audit reports OW-120 separately from compact matches and OW-116 visual rules", () => {
  const report = audit();
  assert.equal(report.matching.length, 4, "the four compact-density matches are unchanged");
  assert.equal(report.overrides.length, 8, "the eight OW-114 overrides are unchanged");
  assert.equal(report.visual.length, 10, "the ten OW-116 visual selector rows are unchanged");
  assert.equal(report.placeholderLayout.length, 42, "OW-120 has 42 separate placeholder-layout rules");
  assert.ok(report.placeholderLayout.every((r) => r.file === NOTES_CSS && r.matches === false && r.kind === "placeholder-layout"),
    "OW-120 rules never count as compact-density matches or overrides");
  assert.equal(read("docs/ow-114-pending-css-audit.md"), format(report), "generated CSS audit is current");
  assert.match(read("docs/ow-114-pending-css-audit.md"), /OW-120 placeholder-layout rules: 42/);
});

test("owner diagnosis, handoff and acceptance marks are recorded", () => {
  const diagnosis = read("docs/ow-120-owner-diagnosis.md");
  for (const needle of [
    "5,461,918 bytes", "collapsed-broken", "expanded", "12 px", "26 x 22 px",
    "0 x 22 px", "opacity: 0.69", "grayscale(1)", "arc-grayscale-unloaded-tabs",
    "OWNER GATE", "3.4.0", "temporary", "deleted",
  ]) assert.ok(diagnosis.includes(needle), "diagnosis records " + needle);
  assert.doesNotMatch(diagnosis, /now carries an optional one-command follow-up/);
  assert.doesNotMatch(diagnosis, /Command 3/);
  const bugfix = read("docs/bugfix-2026-11-18.md");
  assert.match(bugfix, /OW-120/);
  assert.match(bugfix, /owner-accepted as fixed/);
  assert.match(read("docs/perf-results.md"), /\| `OW-120` \|/);
  assert.match(read("docs/perf-results.md"), /owner-accepted as fixed/);
  assert.match(read("docs/LEGACY_done_rows.md"), /\|   150 \| `OW-120`/);
  assert.match(read("docs/LEGACY_done_rows.md"), /owner-accepted/);
  assert.match(read(".gitignore"), /!docs\/ow-120-owner-diagnosis\.md/, "the per-task diagnosis is tracked despite the docs/* ignore rule");
  const handoff = read("TODO_notes_roadmap.md");
  assert.match(handoff, /OW-120/);
  assert.match(handoff, /owner-accepted as fixed/);
  assert.match(handoff, /OWNER GATE/);
});

test("the owner's temporary diagnostic file is not re-added after the delete commit", () => {
  assert.equal(fs.existsSync(path.join(REPO, "owner-sidebar-console-diagnostics.md")), false,
    "owner deleted the temporary console diagnostic; OW-120 respects that deletion");
  assert.doesNotMatch(read("docs/bugfix-2026-11-18.md"), /Command 3/);
  assert.doesNotMatch(read("TODO_notes_roadmap.md"), /Command 3/);
  assert.match(read("docs/bugfix-2026-11-18.md"), /13755e4/);
});

test("generated Notes standalone reflects the OW-120 CSS; version stays 3.4.0", () => {
  const theme = JSON.parse(read("additional/notes/theme.json"));
  assert.equal(theme.version, "3.4.0");
  assert.equal(theme.style.chrome, "ZentralNotes.css", "Sine loads the Notes CSS that now contains OW-120");
  assert.equal(Object.keys(theme.scripts)[0], "ZentralNotes.standalone.uc.js");
  const lock = JSON.parse(read("additional/notes/standalone.lock.json"));
  assert.equal(lock.version, "3.4.0");
  assert.notEqual(lock.hash, OLD_NOTES_LOCK_HASH, "--keep-version refreshed the CSS content hash without changing the version");
  assert.match(read("additional/notes/ZentralNotes.standalone.uc.js"), /@version 3\.4\.0/);
  assert.match(read("loader/Zentral.uc.js"), /3\.4\.0/);
  assert.match(read("docs/bugfix-2026-11-18.md"), /no `--bump` or `sync-version`/);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-120-agenda-folder-scope (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
