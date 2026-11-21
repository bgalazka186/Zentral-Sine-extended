"use strict";
/* Regression after the rejected 2026-11-18 four-bug patch (04be3bae): OW-116 visual
 * overrides must NOT live in the compact-tabs stylesheet and must NOT override compact
 * tabs' label layout (overflow / visibility / display / dimensions). They belong to
 * Notes' own stylesheet and only reset colour/opacity on our two pending placeholder
 * markers. The same patch also left a duplicate `const docRoot` SyntaxError in the
 * panels coordinator, so every runtime script is parsed here too. Static,
 * screenshot-free guards: the compact-tabs feature is otherwise unrelated to
 * Notes/Agenda placeholder rows, and live appearance remains an OWNER GATE. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { audit, format } = require("../tools/audit-pending-placeholder-css.cjs");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const DENSITY = "additional/tabs/ZentralTabDensity.css";
const NOTES_CSS = "additional/notes/ZentralNotes.css";
// Content snapshot of the compact-tabs feature immediately BEFORE the rejected
// 04be3bae patch. The three generated standalone version markers are normalized so
// repo-wide Sine update bumps do not look like compact-tabs code changes. Any other
// compact-tabs change must update this guard on purpose.
const COMPACT_SNAPSHOT = {
  "additional/tabs/ZentralTabDensity.css": "5b5fb92e063fe783e150427ff03e0e0cdf5e763a60be8a571be38327d2904092",
  "additional/tabs/compact-hover/ZentralCompactHover.uc.js": "18c4950fb8ba45d318c1b9d71fad79f580059942d86ae36128a3cc192dc4c089",
  "additional/tabs/compact-hover/ZentralCompactHover.standalone.uc.js": "c48c14d003ea693154b9dd0ad7e4b13aaeeb98fd945e6aa9987dea5555d83eda",
};

const sha256 = (rel) => {
  let source = read(rel);
  if (rel === "additional/tabs/compact-hover/ZentralCompactHover.standalone.uc.js") {
    source = source
      .replace(/^\/\/ @version \d+\.\d+\.\d+$/m, "// @version 3.4.1")
      .replace(/(Placeholders replaced by the build: )(\d+\.\d+\.\d+)/,
        (_match, prefix) => prefix + "3.4.1")
      .replace(/(const __ZENTRAL_STANDALONE_VERSION__ = ")(\d+\.\d+\.\d+)(";)/,
        (_match, prefix, _version, suffix) => prefix + "3.4.1" + suffix);
  }
  return crypto.createHash("sha256").update(source).digest("hex");
};
function runtimeScripts(dir = REPO, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ["node_modules", "tests", "tools"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) runtimeScripts(full, found);
    else if (/\.(?:uc\.)?js$/.test(entry.name)) found.push(path.relative(REPO, full).split(path.sep).join("/"));
  }
  return found.sort();
}

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("compact-tabs density CSS has no OW-116 placeholder-visual rules", () => {
  const density = read(DENSITY);
  assert.doesNotMatch(density, /OW-116/, "the compact-tabs stylesheet is untouched by OW-116");
  assert.doesNotMatch(density, /:is\(\[bgalazka-notes-item\], \[bgalazka-notes-agenda-item\]\)/, "no OW-116 :is() selector in compact tabs");
  assert.doesNotMatch(density, /tab:is\(\[bgalazka-notes-item\]/, "no OW-116 tab selector in compact tabs");
  assert.doesNotMatch(density, /\.tab-label-container\s*>\s*\.tab-label\s*\{[^}]*visibility:\s*visible/, "no forced label visibility in compact tabs");
  assert.doesNotMatch(density, /\.tab-label-container\s*\{[^}]*overflow:\s*visible/, "no forced label-container overflow in compact tabs");
  assert.match(density, /:is\(tab, \.tabbrowser-tab\):not\(\[pinned\]\):not\(\[zen-essential\]\)[\s\S]{0,300}\.tab-label-container\s*\{[^}]*overflow: hidden !important/, "compact tabs keep their label ellipsis");
  assert.match(density, /:is\(tab, \.tabbrowser-tab\):not\(\[pinned\]\):not\(\[zen-essential\]\)[\s\S]{0,300}\.tab-label\s*\{[^}]*overflow: hidden !important/, "compact tabs keep their label text ellipsis");
});

test("Notes owns the narrow visual rules and only resets opacity/filter", () => {
  const notesCss = read(NOTES_CSS);
  assert.match(notesCss, /OW-116/, "the visual rules live in the Notes stylesheet");
  assert.match(notesCss, /tab\[bgalazka-notes-item\]\[pending\]/, "Notes rows are covered");
  assert.match(notesCss, /tab\[bgalazka-notes-agenda-item\]\[pending\]/, "Agenda rows are covered");
  assert.match(notesCss, /filter: none !important/, "grayscale is cleared");
  assert.match(notesCss, /opacity: 1 !important/, "faded labels/favicons are restored");
  assert.doesNotMatch(notesCss, /OW-116[\s\S]*bgalazka-tabbar-compact/, "not tied to the compact-tabs switch");
  assert.doesNotMatch(notesCss, /OW-116[\s\S]*:is\(/, "no :is() selector in the Notes visual rules");
  const start = notesCss.indexOf("/* OW-116:");
  assert.ok(start >= 0, "the OW-116 block starts with a comment");
  const block = notesCss.slice(start);
  for (const forbidden of ["visibility:", "overflow:", "display:", "width:", "height:", "font-size:", "pointer-events:", "min-height:", "max-height:", "margin", "padding", "flex:", "align-items:", "box-sizing:"]) {
    assert.doesNotMatch(block, new RegExp("\\b" + forbidden.replace(/[-:]/g, "\\$&")), "no compact-layout property: " + forbidden);
  }
});

test("the compact-tabs files are byte-for-byte the pre-regression snapshot", () => {
  for (const [rel, expected] of Object.entries(COMPACT_SNAPSHOT)) {
    assert.equal(sha256(rel), expected, rel + " was changed by the rejected patch");
  }
});

test("every runtime script parses; the duplicate panels binding is gone", () => {
  const scripts = runtimeScripts();
  assert.ok(scripts.length >= 90, "the runtime source tree is covered");
  for (const rel of scripts) {
    // Wrap the source like a CommonJS/module body: several standalone parts legally
    // use a top-level `return`, while a duplicate `const` is still a syntax error.
    const source = "(function () {\n" + read(rel) + "\n})";
    assert.doesNotThrow(() => new vm.Script(source, { filename: rel }), rel + " has a JavaScript syntax error");
  }
  const panels = read("extension/panels/ZentralPanels.uc.js");
  assert.equal((panels.match(/const docRoot = document\.documentElement;/g) || []).length, 1,
    "syncPanelPushState declares docRoot exactly once");
  assert.match(panels, /if \(pushChanged\) docRoot\.setAttribute/, "the guarded write still uses the single binding");
});

test("the CSS audit separates compact overrides from Notes-owned visual rules", () => {
  const report = audit();
  assert.equal(report.matching.length, 4, "the four compact-density rules are still the only matches");
  assert.equal(report.overrides.length, 8, "the eight OW-114 compact overrides are unchanged");
  assert.ok(report.overrides.every((r) => r.file === DENSITY), "all compact overrides stay in the density stylesheet");
  assert.ok(report.visual.length >= 4, "Notes-owned OW-116 visual rules are listed separately");
  assert.ok(report.visual.every((r) => r.file === NOTES_CSS), "visual rules are not in the compact-tabs stylesheet");
  assert.ok(report.visual.every((r) => r.matches === false && r.kind === "visual"), "visual rules do not count as compact-density matches");
  assert.ok(report.placeholderLayout.length >= 42, "OW-120 placeholder geometry rules are listed separately");
  assert.ok(report.placeholderLayout.every((r) => r.file === NOTES_CSS && r.matches === false && r.kind === "placeholder-layout"),
    "OW-120 rules are Notes-owned and do not become compact-density matches");
  assert.equal(read("docs/ow-114-pending-css-audit.md"), format(report), "generated audit report is current");
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-119-compact-tabs-look-regression (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
