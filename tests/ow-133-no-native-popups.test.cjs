"use strict";
/* OW-133, the general rule: no Notes surface hands a value to a platform popup control that it does not survive.
 *
 * A colour/date/time/file picker is drawn by the platform, anchored to the input that opened it, and owned by
 * nobody in the page. Two things follow, and both were live bugs:
 *   1. Hiding or removing that input (an autohide panel sliding away underneath it, a card being replaced while the
 *      dialog is open) leaves the platform grab behind: the whole window stops taking clicks until it restarts.
 *   2. The picked value may never come back to the page at all — the composer's `input[type=color]` was reported
 *      exactly like this: a colour was picked and nothing changed.
 * So colour is decided in an in-app well (OW-133 `colorWell`, no platform dialog), and any control that can still
 * raise a platform popup must live in a file that also carries the native-popup hold, which keeps the surface in
 * place until the popup reports back.
 *
 * The checks are source scans on purpose: they cover every file, not just the one that was edited, so the next
 * module that adds a `<input type="date">` to a Notes surface fails here instead of in someone's window.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const NOTES = path.join(ROOT, "additional/notes");
const GENERATED_STANDALONE = path.join(NOTES, "ZentralNotes.standalone.uc.js");
const SEAM_GUARD = path.join(ROOT, "extension/panels/interaction/ZentralPanelHover.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|cjs|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const lineOf = (src, index) => src.slice(0, index).split("\n").length;

// Every place a control is created with a platform-popup `type`. Covers both roads the code uses: a property in an
// element descriptor (`{ type: "date" }`) and markup / attribute strings (`type="date"`, `setAttribute("type", …)`).
const PICKER_TYPES = ["color", "date", "time", "datetime-local", "month", "week", "file"];
function platformControls(src, types) {
  const found = [];
  for (const type of types) {
    const escaped = type.replace(/-/g, "\\-");
    const patterns = [
      new RegExp(`\\btype\\s*:\\s*["'\`]${escaped}["'\`]`, "g"),
      // `input[type="color"]` is a selector string (the hold matches on it), not a control being created.
      new RegExp(`(?<!\\[)\\btype\\s*=\\s*(?:"${escaped}"|'${escaped}'|${escaped}(?=[\\s>"'\`]))`, "g"),
      new RegExp(`setAttribute\\(\\s*["'\`]type["'\`]\\s*,\\s*["'\`]${escaped}["'\`]`, "g"),
    ];
    for (const pattern of patterns) {
      let hit;
      while ((hit = pattern.exec(src))) found.push({ type, index: hit.index, line: lineOf(src, hit.index), text: hit[0] });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

// The hold: one bounded block, marker-delimited so it can be extracted (tests/ow-133-native-popup-hold.test.cjs).
const HOLD_BEGIN = "// <<OW-133 NATIVE POPUP HOLD>>";
const HOLD_END = "// <<OW-133 NATIVE POPUP HOLD END>>";
const definesHold = (src) => src.includes(HOLD_BEGIN) && src.includes(HOLD_END) && /function\s+createNativePopupHold\s*\(/.test(src);

const notesSources = walk(NOTES).filter((file) => file !== GENERATED_STANDALONE);
const notesText = new Map(notesSources.map((file) => [file, fs.readFileSync(file, "utf8")]));

test("the source scan actually sees the Notes module (a scan that reads nothing proves nothing)", () => {
  assert.ok(notesSources.length >= 10, `expected the Notes sources, found ${notesSources.length}`);
  assert.ok([...notesText.values()].some((src) => src.includes("function createSheet(")), "the sheet module is in the scan");
});

test("no Notes surface creates a native colour dialog: colour is decided in the in-app well", () => {
  const offenders = [];
  for (const [file, src] of notesText) for (const hit of platformControls(src, ["color"])) offenders.push(`${rel(file)}:${hit.line}  ${hit.text}`);
  assert.deepEqual(offenders, [], `a native input[type=color] is a platform dialog anchored to an input that the sheet can hide underneath it; use colorWell() instead:\n  ${offenders.join("\n  ")}`);
});

test("the generated standalone bundle carries the same rule (a stale bundle cannot ship the old picker)", () => {
  const src = fs.readFileSync(GENERATED_STANDALONE, "utf8");
  const offenders = platformControls(src, ["color"]).map((hit) => `${rel(GENERATED_STANDALONE)}:${hit.line}  ${hit.text}`);
  assert.deepEqual(offenders, [], `the standalone bundle is generated from the module and is out of date: run node tools/build-standalone.cjs\n  ${offenders.join("\n  ")}`);
});

test("every file that keeps a platform picker also carries the native-popup hold", () => {
  const unchecked = [...PICKER_TYPES.filter((type) => type !== "color"), "list"];
  const offenders = [];
  for (const [file, src] of notesText) {
    const hits = unchecked.includes("list")
      ? [...platformControls(src, PICKER_TYPES.filter((t) => t !== "color")), ...[...src.matchAll(/\[list\]/g)].map((m) => ({ line: lineOf(src, m.index), text: m[0] }))]
      : [];
    if (!hits.length) continue;
    if (!definesHold(src)) offenders.push(`${rel(file)}: ${hits.length} platform-popup control(s) (${[...new Set(hits.map((h) => h.text))].join(", ")}) without the OW-133 hold`);
  }
  assert.deepEqual(offenders, [], `a date/time/file picker or a datalist input can hold the platform grab while the sheet or panel is hidden; the file that creates it must carry the native-popup hold:\n  ${offenders.join("\n  ")}`);
});

test("the panel's hover guard reads the exact attribute the hold publishes", () => {
  const owner = [...notesText].find(([, src]) => src.includes("const NATIVE_POPUP_ATTR ="))?.[1] || "";
  const declared = /const NATIVE_POPUP_ATTR = (["'`])([\w-]+)\1/.exec(owner);
  assert.ok(declared, "the hold publishes its state through NATIVE_POPUP_ATTR");
  const attribute = declared[2];
  const guard = fs.readFileSync(SEAM_GUARD, "utf8");
  assert.ok(guard.includes(attribute), `${rel(SEAM_GUARD)} must consult "${attribute}": it is what stops the panel from hiding underneath an open platform popup`);
  assert.match(guard, /hoverMenuVisible|panelHidden|autohide/i, "the guard file is the panel's hover/autohide decision");
});

test("the hold is defined once, next to the sheet it protects, and is exported for tests", () => {
  const defining = [...notesText].filter(([, src]) => src.includes(HOLD_BEGIN)).map(([file]) => rel(file));
  assert.deepEqual(defining, ["additional/notes/ZentralNotes.uc.js"], "one hold implementation, in the module that owns the sheet");
  const seam = [...notesText].find(([, src]) => src.includes("window.__zentralNotesTestSeam.core"))?.[1] || "";
  for (const name of ["createNativePopupHold", "nativePopupControl", "NATIVE_POPUP_CONTROL", "NATIVE_POPUP_ATTR", "NATIVE_POPUP_HOLD_MS"]) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(seam.split("window.__zentralNotesTestSeam.core")[1] || ""), `the test seam exposes ${name}`);
  }
});

console.log(`\n${passed} checks passed`);
