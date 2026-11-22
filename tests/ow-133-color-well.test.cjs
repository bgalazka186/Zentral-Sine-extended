"use strict";
/* OW-133: the in-app colour well, and the surfaces that were reported broken.
 *
 * The report: a colour was picked in the composer and nothing changed. The cause was the control itself — a native
 * `input[type=color]` hands its value back through a platform dialog anchored to that input, so hiding the sheet or
 * replacing the card underneath it could lose the value (and leave the platform grab behind, which soft-locks the
 * window). The well takes the platform dialog out of the picture: a swatch opens HSL sliders, a `#rrggbb` field and
 * the saved quick colours in place, and every change goes straight to `onChange`.
 *
 * What this file holds to:
 *   - the well never contains a native colour input, and every class it builds is styled;
 *   - typing, sliders and quick colours all reach `onChange` exactly once, with a cleaned `#rrggbb`;
 *   - junk never reaches `onChange` (but is marked on the field);
 *   - a caller can drive the well from its own state (`sync`) without an echo;
 *   - the surfaces that used the platform dialog (composer, folder editor, picker) use the well and keep their own
 *     source of truth.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { constBlock, functionBlock } = require("./helpers/source-blocks.cjs");
const makeFakeDom = require("./helpers/fake-dom.cjs");

const { El, Ev, document } = makeFakeDom();

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.css"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ---- the well, extracted from the module with the colour maths it relies on ----
const PARTS = [
  constBlock(SRC, "HEX_COLOR_RE"),
  constBlock(SRC, "QUICK_COLORS_MAX"),
  constBlock(SRC, "cleanHex"),
  constBlock(SRC, "parseQuickColors"),
  constBlock(SRC, "addQuickColor"),
  // The quick-colour bookkeeping the well shares with the picker above it.
  constBlock(SRC, "quickColors"),
  constBlock(SRC, "saveQuickColor"),
  constBlock(SRC, "removeQuickColor"),
  functionBlock(SRC, "hexToHsl"),
  functionBlock(SRC, "hslToHex"),
  functionBlock(SRC, "colorWell"),
].map((part) => part.text);

const buildColorWell = new Function(
  "h",
  "document",
  "deps",
  `const { setSheetColorData, getPref, setPref, PREF, cleanNoteColor } = deps;\n${PARTS.join("\n")}\nreturn { colorWell, hexToHsl, hslToHex, cleanHex };`,
);

function h(tag, attrs = {}, ...kids) {
  const el = new El(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else el.setAttribute(key, String(value));
  }
  el.append(...kids.filter((kid) => kid !== null && kid !== undefined && kid !== false && kid !== ""));
  return el;
}

const PREF_KEY = "zn.customColors";

function harness({ value = "#6aa7ff", quick = true, prefs = "" } = {}) {
  const store = new Map([[PREF_KEY, prefs]]);
  const calls = [];
  const mod = buildColorWell(h, document, {
    PREF: { CUSTOM_COLORS: PREF_KEY },
    getPref: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
    setPref: (key, next) => store.set(key, next),
    setSheetColorData: (el, colour) => {
      el.setAttribute("data-color", colour);
      el.style.setProperty("--zn-cc", colour);
    },
    cleanNoteColor: (v) => v,
  });
  const well = mod.colorWell(value, (hex) => calls.push(hex), quick ? { label: "Test colour" } : { label: "Test colour", quick: false });
  const body = well.element.querySelector(".zn-color-well-body");
  const swatch = well.element.querySelector(".zn-color-well");
  const ranges = well.element.querySelectorAll(".zn-color-range");
  const hexField = well.element.querySelector(".zn-hex-field");
  const quickRow = well.element.querySelector(".zn-quick");
  const fire = (el, type) => el.dispatchEvent(new Ev(type, { bubbles: true }));
  const type = (text) => {
    hexField.value = text;
    fire(hexField, "input");
  };
  const clickSwatch = () => fire(swatch, "click");
  return { mod, well, element: well.element, body, swatch, ranges, hexField, quickRow, calls, store, fire, type, clickSwatch };
}

const colourOf = (el) => el.getAttribute("data-color");

test("every class the well builds is styled (an unstyled control is an invisible control)", () => {
  const classes = new Set();
  for (const [, cls] of functionBlock(SRC, "colorWell").text.matchAll(/class:\s*"([^"]+)"/g)) for (const name of cls.split(/\s+/)) if (name.startsWith("zn-color-well")) classes.add(name);
  assert.ok(classes.size >= 4, `expected the well's own classes, found ${[...classes].join(", ")}`);
  for (const name of classes) assert.ok(CSS.includes(`.${name}`), `${name} has no rule in ZentralNotes.css`);
  assert.match(CSS, /\.zn-color-well-body\[hidden\]\s*\{\s*display:\s*none/, "a closed well must actually hide its body (the sheet sets display:grid on it)");
});

test("the well never creates a native colour dialog", () => {
  const inputs = harness().element.querySelectorAll("input");
  assert.ok(inputs.length >= 4, "sliders and the hex field are inputs");
  assert.deepEqual(inputs.filter((el) => el.getAttribute("type") === "color"), [], "no input[type=color] inside the well");
  assert.deepEqual([...functionBlock(SRC, "colorWell").text.matchAll(/type:\s*"color"/g)], [], "the well's own source never names the platform control");
});

test("a new well starts from its value: swatch, sliders and hex field agree", () => {
  const { well, swatch, ranges, hexField, mod } = harness({ value: "#FF0000" });
  assert.equal(well.value(), "#ff0000", "the value is cleaned and lower-cased");
  assert.equal(colourOf(swatch), "#ff0000");
  assert.equal(hexField.value, "#ff0000");
  assert.deepEqual(ranges.map((el) => Number(el.value)), [0, 100, 50], "red is hue 0, fully saturated, half light");
  assert.deepEqual(mod.hexToHsl("#ff0000"), { h: 0, s: 100, l: 50 });
});

test("a junk initial value falls back to a valid colour instead of propagating", () => {
  for (const junk of ["", "red", "#12", null, 42]) {
    const { well, swatch } = harness({ value: junk });
    assert.match(well.value(), /^#[0-9a-f]{6}$/, `junk ${JSON.stringify(junk)} -> ${well.value()}`);
    assert.equal(colourOf(swatch), well.value());
  }
});

test("the hex field is the fastest road: a typed value reaches onChange once, cleaned", () => {
  const { type, calls, hexField } = harness({ value: "#000000" });
  type("#00FF00");
  assert.deepEqual(calls, ["#00ff00"]);
  assert.equal(hexField.dataset.bad, undefined, "a valid value clears the invalid mark");
});

test("a value typed without the # is accepted; junk is marked and never reaches onChange", () => {
  const { type, calls, hexField, well } = harness({ value: "#000000" });
  type("0000ff");
  assert.deepEqual(calls, ["#0000ff"], "the field is forgiving about the #, never about the digits");
  type("#12345");
  type("chartreuse");
  assert.deepEqual(calls, ["#0000ff"], "nothing invalid is emitted");
  assert.equal(hexField.dataset.bad, "true", "the field says why");
  assert.equal(well.value(), "#0000ff", "the last good colour stays");
});

test("the sliders are the same road: hue/saturation/lightness round-trip to one emission", () => {
  const { ranges, calls, well, mod } = harness({ value: "#000000" });
  const [hue, sat, lit] = ranges;
  hue.value = "120";
  sat.value = "100";
  lit.value = "50";
  for (const range of ranges) range.dispatchEvent(new Ev("input", { bubbles: true }));
  assert.deepEqual(calls, ["#00ff00", "#00ff00", "#00ff00"], "each gesture emits the colour of the three sliders");
  assert.equal(well.value(), "#00ff00");
  assert.deepEqual(mod.hexToHsl("#00ff00"), { h: 120, s: 100, l: 50 });
});

test("hex -> HSL -> hex survives the round trip for the colours the sheet actually uses", () => {
  const { mod } = harness();
  for (const hex of ["#6aa7ff", "#ff6b6b", "#123456", "#ffffff", "#000000", "#7a7a7a", "#00c2a8", "#f2c94c"]) {
    const hsl = mod.hexToHsl(hex);
    const back = mod.hslToHex(hsl.h, hsl.s, hsl.l);
    const channels = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
    const [r1, g1, b1] = channels(hex);
    const [r2, g2, b2] = channels(back);
    assert.ok(Math.abs(r1 - r2) <= 2 && Math.abs(g1 - g2) <= 2 && Math.abs(b1 - b2) <= 2, `${hex} -> ${JSON.stringify(hsl)} -> ${back}`);
  }
});

test("quick colours: one click picks, right-click removes, both repaint the row", () => {
  const { quickRow, calls, store, fire } = harness({ value: "#000000", prefs: "#aabbcc,#001122" });
  const swatches = quickRow.querySelectorAll(".zn-swatch");
  assert.equal(swatches.length, 2);
  fire(swatches[0], "click");
  assert.deepEqual(calls, ["#aabbcc"]);
  fire(swatches[1], "contextmenu");
  const left = quickRow.querySelectorAll(".zn-swatch").map((el) => el.getAttribute("title"));
  assert.deepEqual(left, ["#aabbcc (right-click removes it)"]);
  assert.equal(store.get(PREF_KEY), "#aabbcc", "the removal is saved, not just painted");
});

test("a well without quick colours has no quick row at all", () => {
  const { quickRow, element } = harness({ quick: false });
  assert.equal(quickRow, null);
  assert.deepEqual(element.querySelectorAll(".zn-quick"), []);
});

test("the swatch opens and closes the body, and says so to assistive tech", () => {
  const { body, swatch, clickSwatch, element, well } = harness();
  assert.equal(body.hidden, true, "closed by default");
  assert.equal(swatch.getAttribute("aria-expanded"), "false");
  clickSwatch();
  assert.equal(body.hidden, false);
  assert.equal(swatch.getAttribute("aria-expanded"), "true");
  assert.equal(element.dataset.open, "true", "the host claims a full line while it is open (CSS)");
  clickSwatch();
  assert.equal(body.hidden, true);
  assert.equal(swatch.getAttribute("aria-expanded"), "false");
  assert.equal(element.dataset.open, undefined);
  well.open();
  assert.equal(body.hidden, false);
  well.close();
  assert.equal(body.hidden, true);
});

test("sync() drives the well from the caller's state without echoing back", () => {
  const { well, calls, swatch, hexField, ranges } = harness({ value: "#000000" });
  well.sync("#3366cc");
  assert.equal(well.value(), "#3366cc");
  assert.equal(colourOf(swatch), "#3366cc");
  assert.equal(hexField.value, "#3366cc");
  assert.equal(Number(ranges[0].value), 220, "the sliders follow too");
  assert.deepEqual(calls, [], "a repaint is not a change");
  well.sync("not a colour");
  assert.equal(well.value(), "#3366cc", "sync ignores junk");
});

test("a caller may build the well before it has a value and paint it later", () => {
  const { well, calls } = harness({ value: "junk" });
  well.sync("#abcdef");
  assert.equal(well.value(), "#abcdef");
  assert.deepEqual(calls, []);
});

test("the composer's colour row is the well, and the item colour stays the source of truth", () => {
  const composer = functionBlock(SRC, "askCalendarComposer").text;
  assert.match(composer, /colorWell\(/, "the composer uses the in-app well");
  assert.match(composer, /const colorWellCtl = colorWell\(/, "one well instance for the row");
  assert.match(composer, /customColor = C\.cleanItemColor\(hex\)/, "the picked colour is the item's colour");
  assert.match(composer, /colorWellCtl\.sync\(/, "the inherit button repaints the well from the resolved colour");
  assert.match(composer, /syncComposeInheritance\(\)/, "and the inherit state still follows the colour");
  assert.doesNotMatch(composer, /type:\s*"color"/, "no platform dialog in the composer");
});

test("the shared picker and the folder editor use the well too, with no leftover native input", () => {
  const picker = functionBlock(SRC, "colorPicker").text;
  assert.match(picker, /colorWell\(/);
  assert.doesNotMatch(picker, /type:\s*"color"/);
  const style = functionBlock(SRC, "askFolderStyle").text;
  assert.match(style, /colorWell\(/, "the folder editor's outline and part colours are wells");
  assert.doesNotMatch(style, /type:\s*"color"/);
});

test("every colour the sheet hands to the well is a validated #rrggbb (no palette names leak into a well)", () => {
  // The wells are fed by `colorHex(color)`, the palette-name to hex bridge; `cleanItemColor`/`cleanHex` own the rest.
  const style = functionBlock(SRC, "askFolderStyle").text;
  for (const [, expression] of style.matchAll(/colorWell\(\s*([^,]+),/g)) {
    assert.ok(/colorHex\(|cleanHex\(|#/.test(expression), `a well is fed something unchecked: ${expression.trim()}`);
  }
});

console.log(`\n${passed} checks passed`);
