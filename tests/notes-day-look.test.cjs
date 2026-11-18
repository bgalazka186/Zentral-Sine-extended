"use strict";
/* OW-55: what free days, weekends and holidays look like.
 * The owner picks a tint colour and how visible it is; the defaults must be byte-for-byte the three literals the
 * stylesheet shipped with, so a sheet that never opened the setting is unchanged. Only the resting tint is the
 * owner's: selection and hover keep their own tokens. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.css"), "utf8");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(ROOT, "additional/notes/settings.json"), "utf8"));
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, "extension/settings/layout.json"), "utf8"));
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

const KINDS = ["weekend", "holiday", "free"];
// The three tints exactly as they were written by hand before this row.
const SHIPPED = {
  weekend: "#6ca8ff 10%",
  holiday: "#f0b85b 13%",
  free: "#78a9c8 4%",
};

test("the defaults are exactly the tints the stylesheet shipped with", () => {
  const look = cal.cleanDayLook(null);
  assert.deepEqual(Object.keys(look).sort(), KINDS.slice().sort());
  for (const kind of KINDS) {
    assert.equal(`${look[kind].color} ${look[kind].strength}%`, SHIPPED[kind], kind + " default is unchanged");
  }
});

test("junk in one field falls back for that field only", () => {
  const look = cal.cleanDayLook({
    weekend: { color: "#ABCDEF", strength: 400 },
    holiday: { color: "not-a-colour", strength: "7" },
    free: null,
  });
  assert.deepEqual(look.weekend, { color: "#abcdef", strength: 100 }, "a strength above 100 is clamped, case folded");
  assert.deepEqual(look.holiday, { color: "#f0b85b", strength: 7 }, "a bad hex keeps the default, a numeric string works");
  assert.deepEqual(look.free, { color: "#78a9c8", strength: 4 }, "a missing kind is the default");
  assert.deepEqual(cal.cleanDayLook("nonsense"), cal.cleanDayLook(null), "junk in the whole value is the default");
  assert.deepEqual(cal.cleanDayLook({ free: { strength: -5 } }).free, { color: "#78a9c8", strength: 0 }, "negative clamps to 0");
});

test("the tint is only emitted when it differs from the shipped one", () => {
  assert.equal(cal.dayLookTint(null, "weekend"), "", "the default sets no variable");
  assert.equal(cal.dayLookTint({ weekend: { color: "#6ca8ff", strength: 10 } }, "weekend"), "", "an explicit default is still the default");
  assert.equal(
    cal.dayLookTint({ weekend: { color: "#ff0000", strength: 22 } }, "weekend"),
    "color-mix(in srgb, #ff0000 22%, transparent)",
    "a chosen tint becomes one CSS value",
  );
  assert.equal(
    cal.dayLookTint({ free: { color: "#78a9c8", strength: 0 } }, "free"),
    "color-mix(in srgb, #78a9c8 0%, transparent)",
    "strength 0 is a real choice (invisible), not the default",
  );
});

test("the stylesheet reads one variable per kind and keeps the old literal as its fallback", () => {
  for (const kind of KINDS) {
    const [hex, pct] = SHIPPED[kind].split(" ");
    const wanted = `var(--zentral-notes-ov-${kind}-tint, color-mix(in srgb, ${hex} ${pct}, transparent))`;
    assert.ok(CSS.includes(wanted), kind + " reads its variable with the shipped tint as the fallback");
  }
  // Selection and hover must not have been folded into the owner's tint.
  const selected = CSS.slice(CSS.indexOf(".zn-cal-month-cell.is-selected"));
  assert.ok(!/zentral-notes-ov-(weekend|holiday|free)-tint/.test(selected), "selection keeps its own tokens");
});

test("each of the six view places follows the one variable", () => {
  // Six places per kind is the point of OW-39/OW-44: month cell, time header, all-day cell, column, day group, row.
  // The stylesheet writes them as one selector group with one declaration, so the variable appears once per kind
  // and the six selectors are what must all sit in that group.
  const places = [
    "zn-cal-month-cell",
    "zn-cal-time-day-head",
    "zn-cal-time-allday-cell",
    "zn-cal-time-column",
    "zn-cal-day-group",
    "zn-cal-agenda-row",
  ];
  for (const kind of KINDS) {
    const at = CSS.indexOf(`background: var(--zentral-notes-ov-${kind}-tint`);
    assert.ok(at > 0, kind + " rule exists");
    const selectorGroup = CSS.slice(CSS.lastIndexOf("}", at) + 1, at);
    const classes = kind === "free" ? ["is-workfree"] : ["is-" + kind];
    for (const place of places) assert.ok(selectorGroup.includes("." + place + "." + classes[0]), place + " is in the " + kind + " rule");
    assert.equal((selectorGroup.match(/\.zn-cal-/g) || []).length, 6, "and nothing else is in that group");
  }
});

test("the six preferences exist, are owner-facing, and are reachable in Sine's own page", () => {
  const schema = new Map(SETTINGS.schema.map((item) => [item.property, item]));
  const props = [];
  for (const kind of KINDS) {
    for (const [suffix, control] of [["tint", "color"], ["strength", "slider"]]) {
      const property = `zen.workspace.zentral.notes.look_${kind}_${suffix}`;
      props.push(property);
      const item = schema.get(property);
      assert.ok(item, property + " is in the schema");
      assert.equal(item.control, control, property + " uses the " + control + " control in the sheet");
      assert.equal(SETTINGS.settings[property].section, "Days off", property + " sits under Days off");
    }
  }
  const flat = LAYOUT.order.filter((entry) => typeof entry === "string");
  for (const property of props) assert.ok(flat.includes(property), property + " is in the Sine preference page");
  const heading = LAYOUT.order.find((entry) => typeof entry === "object" && entry.label === "**Notes appearance \u00b7 Days off**");
  assert.ok(heading, "the Sine page has a Days off heading");
});

test("the settings card draws the six rows under one heading, and Reset puts them back", () => {
  assert.ok(SRC.includes('{ kind: "heading", i18nKey: "settings.heading.dayLook", label: "Days off" }'));
  for (const kind of KINDS) {
    for (const suffix of ["tint", "strength"]) {
      const prop = kind.toUpperCase() + "_" + suffix.toUpperCase();
      assert.ok(
        new RegExp(`PREF\\.LOOK_${kind.toUpperCase()}_${suffix.toUpperCase()}`).test(SRC),
        `LOOK_${prop} is used`,
      );
    }
  }
  // LOOK_PREFS is derived from the prefix, so the Reset button covers the new rows without another list.
  assert.ok(/const LOOK_PREFS = Object\.freeze\(Object\.keys\(PREF\)\.filter\(\(k\) => k\.startsWith\("LOOK_"\)\)/.test(SRC));
  assert.ok(/const LOOK_NUM_PREFS = new Set\(\[[^\]]*PREF\.LOOK_WEEKEND_STRENGTH/.test(SRC), "the three strengths read as numbers");
  assert.ok(/const LOOK_VARS = Object\.freeze\(\[[^\]]*"weekend-tint"/.test(SRC), "the three variables are cleaned up on disposal");
});

test("a tint that equals the shipped one emits no variable and no flag", () => {
  // Round-trip through the same table lookOverrides uses, without booting the sheet.
  const look = cal.cleanDayLook(null);
  for (const kind of KINDS) {
    assert.equal(cal.dayLookTint(look, kind), "", kind + " leaves the stylesheet alone");
  }
  assert.ok(!/zentral-notes-ov-weekend-tint":/.test(SRC), "the variable name is built, never hard-coded to a value");
});

test("without the calendar part the tint loop is skipped, not a crash", () => {
  // Every other calendar call in the sheet is `CALENDAR_PART?.`-guarded; a build where the calendar file did not
  // load has no day cells at all, so looking over the prefs must still work.
  assert.ok(/for \(const \[kind, tintPref, strengthPref\] of \(CALENDAR_PART\?\.DEFAULT_DAY_LOOK \? \[/.test(SRC));
  assert.ok(/\] : \[\]\)\) \{/.test(SRC), "the fallback is an empty list, not a null dereference");
});

console.log(`PASS notes-day-look (${passed} tests)`);
