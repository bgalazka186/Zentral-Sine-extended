"use strict";
/* OW-78: ONE palette. The stylesheet and the JS resolver must answer with the same colour.
 *
 * The defect this pins: after OW-76 the sheet had two ways to reach a surface. The JS resolver read Zen's own tokens
 * (`--zen-colors-base` / `--zen-colors-text` / `--zen-colors-border` / `--zen-primary-color`), applied contrast
 * guarantees and wrote `--zn-surface-resolved` / `--zn-text-resolved`. The stylesheet separately said
 * `--zn-surface: var(--bgalazka-look-toolbar-surface, … #1e1e24)` — the RSS card's private palette, another module's
 * look. So a rule reading `--zn-surface` could show one colour while a rule reading `--zn-surface-resolved` showed
 * another, and it only looked right because the resolved tokens happened to be set inline and win.
 *
 * Three things are asserted here, and each one is a way the drift can come back:
 *   1. The order of every chain: resolved first, Zen's tokens next, the RSS palette LAST (or the theme's own hex).
 *   2. The resolver's per-theme fallback colours are the SAME hexes the stylesheet uses, so "the fallback" and
 *      "no tokens at all" cannot be two different colours.
 *   3. End to end: with host tokens set, the resolver's answer for each theme is what the chain would produce, and with
 *      no tokens the resolver lands exactly on the stylesheet's documented fallback.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const ROOT = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.css"), "utf8");
const SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (err) { failed++; console.error("FAIL:", name, "\n ", err && err.stack ? err.stack : err); }
}

// The declarations of one rule, in source order: a comment header is skipped so a doc comment cannot fake a match.
const ruleBody = (selector) => {
  const at = CSS.indexOf(selector + " {");
  assert.ok(at >= 0, "rule not found: " + selector);
  const end = CSS.indexOf("\n}", at);
  return CSS.slice(at, end);
};
const declarations = (body) => [...body.matchAll(/(--zn-[a-z-]+)\s*:\s*([^;]+);/g)].map((m) => ({ name: m[1], value: m[2].trim() }));

/* ---------- 1. the order of every chain ---------- */

(async () => {
await test("the sheet's defaults read the resolved value first, Zen's tokens next, the RSS palette last", () => {
  const body = ruleBody(".zentral-notes-sheet");
  const surface = declarations(body).find((d) => d.name === "--zn-surface").value;
  const text = declarations(body).find((d) => d.name === "--zn-text").value;
  // First fallback is the resolver's own token: whatever JS decided is what the sheet draws.
  assert.match(surface, /^var\(--zn-surface-resolved,/);
  assert.match(text, /^var\(--zn-text-resolved,/);
  // Then Zen's palette…
  assert.match(surface, /--zen-colors-base/);
  assert.match(text, /--zen-colors-text/);
  // …and the RSS card's variables are LAST, never first (the whole point of OW-78).
  const surfaceRss = surface.indexOf("--bgalazka-look");
  const surfaceZen = surface.indexOf("--zen-colors-base");
  assert.ok(surfaceZen > 0 && surfaceRss > surfaceZen, "the RSS palette comes after Zen's, not before it");
  assert.ok(!/^var\(--bgalazka-look/.test(surface), "no RSS token opens the chain");
  assert.ok(!/^var\(--bgalazka-look/.test(text), "and not the text either");
  // The accent chain was already correct and is kept.
  assert.match(declarations(body).find((d) => d.name === "--zn-accent").value, /^var\(--zn-accent-safe,/);
});

await test("every theme rule also puts the resolved token first", () => {
  for (const theme of ["recommended", "light", "dark", "paper"]) {
    const body = ruleBody(`:root[zentral-notes-theme="${theme}"] .zentral-notes-sheet`);
    const decls = declarations(body);
    for (const name of ["--zn-surface", "--zn-text"]) {
      const value = decls.find((d) => d.name === name)?.value;
      assert.ok(value, theme + " sets " + name);
      assert.match(value, /^var\(--zn-[a-z-]+-resolved,/, theme + " " + name + " must start from the resolved token: " + value);
    }
  }
});

await test("no rule anywhere reads an RSS or popup token before a resolved one", () => {
  // A second, plain check over the whole file: any --zn-surface/--zn-text declaration whose first rung is a foreign
  // palette is a regression, wherever it was written.
  const bad = [];
  for (const m of CSS.matchAll(/(--zn-(?:surface|text))\s*:\s*(var\([^;]+\)|#[0-9a-fA-F]{3,8})\s*;/g)) {
    const value = m[2].trim();
    if (!value.startsWith("var(")) continue; // a plain hex is the theme's own colour, the documented fallback
    // Allowed first rungs: another --zn-* token (which includes both resolved tokens).
    if (/^var\(--zn-/.test(value)) continue;
    // THE ONE EXCEPTION, by design: an explicit person-chosen override. A colour the owner picked is the last word and
    // must not be mediated by the resolver.
    if (/^var\(--zentral-notes-ov-/.test(value)) continue;
    bad.push(m[0]);
  }
  assert.deepEqual(bad, [], "these read a foreign palette first: " + bad.join(" | "));
  // The exception is exactly as wide as it claims: only the bg and text overrides open a chain.
  assert.equal([...CSS.matchAll(/--zn-(?:surface|text)\s*:\s*var\(--zentral-notes-ov-/g)].length, 2);
});

/* ---------- 2. the two paths name the same colours ---------- */

await test("the resolver's fallback for each theme is the same hex the stylesheet uses", () => {
  // The stylesheet's per-theme hexes (the second rung of the chain) and the resolver's NOTE_THEME_SURFACES must agree;
  // otherwise "no tokens" gives one colour and "tokens that cannot be read" gives another.
  const cases = [
    ["light", "#fbfbfd", "#1d1d22"],
    ["dark", "#17171c", "#e9e9f0"],
    ["paper", "#f4ecd8", "#3b3226"],
  ];
  for (const [theme, surface, text] of cases) {
    const body = ruleBody(`:root[zentral-notes-theme="${theme}"] .zentral-notes-sheet`);
    const decls = declarations(body);
    assert.equal(decls.find((d) => d.name === "--zn-surface").value, `var(--zn-surface-resolved, ${surface})`, theme + " surface hex");
    assert.equal(decls.find((d) => d.name === "--zn-text").value, `var(--zn-text-resolved, ${text})`, theme + " text hex");
    // With no host tokens at all, the resolver must land on exactly those hexes.
    const resolved = C.resolveThemeSurface(theme, {});
    assert.equal(resolved.surface.toLowerCase(), surface, theme + " resolver surface");
    assert.equal(resolved.text.toLowerCase(), text, theme + " resolver text");
  }
});

await test("zentral's dark fallback is the one hex both sides have always used", () => {
  // The old chain's hardcoded #1e1e24 was not a random default: it is NOTE_THEME_SURFACES.zentral.dark.surface, which
  // is what the resolver returns when nothing else can be read. Keeping them equal is what makes the last rung honest.
  const body = ruleBody(".zentral-notes-sheet");
  const surface = declarations(body).find((d) => d.name === "--zn-surface").value;
  assert.match(surface, /#1e1e24/);
  const resolved = C.resolveThemeSurface("zentral", {});
  assert.equal(resolved.surface.toLowerCase(), "#1e1e24");
});

/* ---------- 3. end to end: one answer, whichever side is asked ---------- */

await test("with Zen tokens set, the resolved token IS the host colour for every scheme", () => {
  for (const [base, expectLight] of [["#101018", false], ["#f7f4ef", true]]) {
    const resolved = C.resolveThemeSurface("zentral", { hostSurface: base, hostText: expectLight ? "#20202a" : "#e8e8f2" });
    assert.equal(resolved.isLight, expectLight, base + " scheme");
    // The stylesheet's first rung is --zn-surface-resolved, so the sheet's computed --zn-surface is exactly this.
    assert.equal(resolved.surface.toLowerCase(), base.toLowerCase(), "the host colour is what both paths show");
  }
});

await test("a colour the resolver cannot parse falls through to the documented fallback, not to a third value", () => {
  const resolved = C.resolveThemeSurface("zentral", { hostSurface: "not-a-colour", hostText: "" });
  // Whatever it lands on, it must be a real hex the stylesheet also names — no invented in-between colour.
  const body = ruleBody(".zentral-notes-sheet");
  const surface = declarations(body).find((d) => d.name === "--zn-surface").value;
  assert.match(resolved.surface, /^#[0-9a-f]{6}$/i);
  assert.ok(surface.toLowerCase().includes(resolved.surface.toLowerCase()), "the fallback is one of the chain's own rungs: " + resolved.surface);
});

await test("the override path keeps agreeing: a chosen bg is what both sides show", () => {
  const resolved = C.resolveThemeSurface("dark", { overrides: { bg: "#2a1b2e", text: "#f0e6f5" } });
  assert.equal(resolved.surface.toLowerCase(), "#2a1b2e");
  // The appearance menu writes --zentral-notes-ov-bg and the stylesheet's ov rule reads it into --zn-surface; the
  // resolver reading the same override is what keeps the two apart from drifting.
  assert.match(CSS, /zentral-notes-ov~="bg"\] \.zentral-notes-sheet \{ --zn-surface: var\(--zentral-notes-ov-bg\)/);
  assert.match(SRC, /bg: ovColor\(PREF\.LOOK_BG, "--zentral-notes-ov-bg"\)/);
});

/* ---------- 3b. the live sheet: what is actually written on the element ---------- */

await test("live sheet: the resolved tokens written inline are the ones the chain would show", async () => {
  // The static checks can be satisfied while the sheet still writes something else, so this drives a real sheet and
  // reads the two inline custom properties the resolver sets beside the CSS chain that consumes them.
  const { makeHarness } = require("./helpers/holiday-harness.cjs");
  const h = makeHarness({ sheetW: 960, sheetH: 640, paneW: 640, paneH: 540 });
  await h.store.open();
  await h.sheet.open();
  await h.flush();
  const read = (name) => String(h.sheet.root.style.getPropertyValue(name) || "").trim().toLowerCase();
  const surface = read("--zn-surface-resolved");
  const text = read("--zn-text-resolved");
  assert.match(surface, /^#[0-9a-f]{6}$/, "the sheet writes a real surface: " + surface);
  assert.match(text, /^#[0-9a-f]{6}$/, "and a real text colour: " + text);
  // What it wrote is what the resolver answers for the theme it says it is on.
  const theme = h.sheet.root.dataset.theme || "zentral";
  const spec = C.resolveThemeSurface(theme, {});
  assert.equal(surface, spec.surface.toLowerCase(), "surface agrees with the resolver for " + theme);
  assert.equal(text, spec.text.toLowerCase(), "text agrees with the resolver for " + theme);
  // And the stylesheet's first rung for that theme is the same name the sheet just wrote.
  assert.match(CSS, /--zn-surface: var\(--zn-surface-resolved,/);
});

/* ---------- 4. the header comment carries the rule ---------- */

await test("the CSS header documents the chain, so the next person does not re-add an RSS token first", () => {
  const body = ruleBody(".zentral-notes-sheet");
  assert.match(body, /OW-78/, "the rule beside the tokens names the row");
  assert.match(body, /LAST fallback/i, "and says which rung the RSS palette is");
  assert.match(body, /resolveThemeSurface/, "and points at the resolver it must agree with");
});

if (failed) { console.error(`${failed} failed, ${passed} passed`); process.exit(1); }
console.log(`notes-one-palette: ${passed} passed`);
})();
