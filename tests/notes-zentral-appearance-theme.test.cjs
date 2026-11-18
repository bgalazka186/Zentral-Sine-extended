"use strict";
/* OW-76 — the calendar and notes must wear Zentral's appearance theme.

   The owner: "re-see the themes of the calendar/notes and how they interact with zentral themes ... they should copy
   the style of zentral appearance themes by default, extra customization only if the user opts in".

   Three separate things were wrong and this file pins all three:

   1. The `zentral` theme read `--bgalazka-look-*`, which is the RSS card's own variable set (another module's look),
      so "follows the Zen look" only looked that way by coincidence. It now reads Zen's palette:
      `--zen-colors-base`, `--zen-colors-text`, `--zen-colors-border` / `--zen-colors-tertiary`, `--zen-primary-color`.
   2. Nothing re-resolved the sheet when Zentral's theme changed — it only listened for its own
      `zentral-notes-theme-changed`. It now also follows `zentral-appearance-theme-changed`, `look-and-feel-changed`
      and the root attributes the theme service sets.
   3. Opt-in: the default stays `zentral`; every other look is reached only by choosing it.

   Measured in headless Chromium (the tools/audit-notes-calendar-fit.cjs harness): with --zen-colors-base #f7f4ef,
   --zen-colors-text #20202a and --zen-primary-color #b5179e the sheet resolved surface #f7f4ef, text #20202a, accent
   #b5179e, scheme "light"; changing those tokens and setting zentral-effective-theme="dark" repainted it to
   #101018 / #e8e8f2 / #39d98a with scheme "dark" — without a reload. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "additional/notes/ZentralNotes.uc.js"), "utf8");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const settings = require("../additional/notes/settings.json");

// ---- 1. the tokens ---------------------------------------------------------------------------------------------
{
  const at = source.indexOf('theme === "zentral"');
  assert.ok(at > 0, "the zentral branch exists");
  const branch = source.slice(at, source.indexOf("}", source.indexOf("hostAccent", at)) + 1);
  for (const token of ["--zen-colors-base", "--zen-colors-text", "--zen-colors-border", "--zen-primary-color"]) {
    assert.ok(branch.includes(token), `the zentral theme reads ${token}`);
  }
  // The RSS card's variables may survive as a fallback, but they must come AFTER Zen's own tokens.
  const baseZen = branch.indexOf("--zen-colors-base");
  const baseRss = branch.indexOf("--bgalazka-look-toolbar-surface");
  if (baseRss >= 0) assert.ok(baseZen >= 0 && baseZen < baseRss, "--zen-colors-base is tried before the RSS card's surface");
  const textZen = branch.indexOf("--zen-colors-text");
  const textRss = branch.indexOf("--bgalazka-look-text");
  if (textRss >= 0) assert.ok(textZen < textRss, "--zen-colors-text is tried before the RSS card's text");
  // A missing Zen palette must not leave the sheet colourless: the resolver falls back to the Zentral surfaces.
  const fallback = cal.resolveThemeSurface("zentral", { scheme: "dark" });
  assert.equal(fallback.surface, "#1e1e24", "with no host tokens the Zentral dark surface is used");
  assert.equal(fallback.text, "#e9e9f0");
}

// ---- 2. it must be live ----------------------------------------------------------------------------------------
{
  assert.ok(source.includes('listen(window, "zentral-appearance-theme-changed", refreshSheetThemeColors)'), "a Zentral appearance change repaints the sheet");
  assert.ok(source.includes('listen(window, "look-and-feel-changed", refreshSheetThemeColors)'), "a browser look-and-feel change repaints the sheet");
  assert.ok(source.includes('listen(window, "zentral-notes-theme-changed", refreshSheetThemeColors)'), "the sheet's own theme change still repaints it");
  const observerAt = source.indexOf("const themeObserver = new MutationObserver");
  assert.ok(observerAt > 0, "a theme change that only touches the root attributes is noticed too");
  const block = source.slice(observerAt, source.indexOf("} catch", observerAt));
  for (const attr of ["zentral-effective-theme", "lwtheme", "lwtheme-brighttext"]) {
    assert.ok(block.includes(attr), `the observer watches ${attr}`);
  }
  assert.ok(block.includes("cleanups.push(() => themeObserver.disconnect())"), "the observer is released with the sheet");
  assert.ok(
    source.includes('id: "sheet.themeObserver"') && /const ACTIVE_RESOURCE_INVENTORY[\s\S]*?sheet\.themeObserver/.test(source),
    "the observer is in the resource inventory so the leak audit counts it",
  );
}

// ---- 3. the resolver keeps its guarantees ----------------------------------------------------------------------
{
  // A host surface is adopted as-is (that is what "copy the style of Zentral themes" means)...
  const light = cal.resolveThemeSurface("zentral", { scheme: "light", hostSurface: "#f7f4ef", hostText: "#20202a", hostAccent: "#b5179e" });
  assert.equal(light.surface, "#f7f4ef");
  assert.equal(light.scheme, "light");
  // ...but the text has to stay readable on whatever surface the theme brings: a low-contrast host text is lifted.
  const hostile = cal.resolveThemeSurface("zentral", { scheme: "dark", hostSurface: "#1a1a1a", hostText: "#222222" });
  assert.ok(cal.contrastRatio(hostile.text, hostile.surface) >= 7, "the body text is lifted to a readable contrast");
  const mutedOk = cal.contrastRatio(hostile.muted, hostile.surface) >= 4.5;
  assert.ok(mutedOk, "muted text stays readable too");
  const accentOk = cal.contrastRatio(hostile.accent, hostile.surface) >= 4.55;
  assert.ok(accentOk, "the accent stays readable on the host surface");

  // An achromatic, clashing primary colour falls back to the theme's chromatic accent instead of turning the UI grey.
  const grey = cal.resolveThemeSurface("zentral", { scheme: "dark", hostSurface: "#141418", hostAccent: "#1b1b1b" });
  assert.notEqual(grey.accent, "#1b1b1b", "a near-black primary colour does not become the accent");
}

// ---- 4. opt-in only --------------------------------------------------------------------------------------------
{
  const row = settings.schema.find((entry) => entry.property === "zen.workspace.zentral.notes.theme");
  assert.ok(row, "the Notes theme setting exists");
  assert.equal(row.defaultValue, "zentral", "the default is to follow Zentral's appearance theme");
  assert.deepEqual(row.options.map((o) => o.value), ["zentral", "recommended", "light", "dark", "paper"], "the other looks stay available, by choice");
  assert.match(row.options[0].label, /appearance theme/i, "the default option says what it follows");
  // Nothing selects another theme on its own: the sheet reads the pref and falls back to zentral.
  assert.ok(source.includes('prefStr(PREF.THEME, "zentral")'), "the sheet's fallback is zentral, not a custom look");
  assert.ok(!/setPref\(\s*PREF\.THEME\s*,\s*"(light|dark|paper|recommended)"/.test(source), "no code switches the theme behind the person's back");
}

// ---- 5. every look still resolves to something usable ----------------------------------------------------------
for (const theme of ["zentral", "recommended", "light", "dark", "paper"]) {
  for (const scheme of ["light", "dark"]) {
    const r = cal.resolveThemeSurface(theme, { scheme });
    for (const key of ["surface", "text", "muted", "line", "accent", "accentOutline", "accentOnFill"]) {
      assert.match(r[key], /^#[0-9a-f]{6}$/i, `${theme}/${scheme}: ${key} is a colour`);
    }
    assert.ok(cal.contrastRatio(r.text, r.surface) >= 7, `${theme}/${scheme}: text is readable on its surface`);
    assert.ok(cal.contrastRatio(r.muted, r.surface) >= 4.5, `${theme}/${scheme}: muted text is readable`);
  }
}

console.log("OW-76 calendar / notes follow the Zentral appearance theme");
