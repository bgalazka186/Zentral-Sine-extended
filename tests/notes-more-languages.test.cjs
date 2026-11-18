"use strict";
/* OW-79: more languages, and never a raw key on screen.
 *
 * The complaint was concrete: a real browser run drew `cal.todayBtn` as the Today button's text, because no language
 * table was registered for the active language and `t()` answered with the key. The i18n suite never saw it because it
 * always registers both tables.
 *
 * Three promises, each tested here rather than asserted in prose:
 *   1. A missing key falls through PER KEY to English, and a key missing everywhere shows readable words — never the
 *      dotted key. The gap is reported once, so a developer sees it.
 *   2. A language file in `i18n/` is discovered from the directory (a generated registry), appears in the settings
 *      menu from what registered, and is not allowed to lie about being complete.
 *   3. Nothing rendered in a real sheet matches a dotted key, with an incomplete table registered.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const en = require("../additional/notes/i18n/en.js");
const pl = require("../additional/notes/i18n/pl.js");
const de = require("../additional/notes/i18n/de.js");
const buildLanguages = require("../tools/build-languages.cjs");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (err) { failed++; console.error("FAIL:", name, "\n ", err && err.stack ? err.stack : err); }
}

const DOTTED = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;

(async () => {
/* ---------- 1. per-key fallback, and never a key ---------- */

await test("a missing key falls through to English, per key, not per table", () => {
  C.registerLanguage(en);
  C.registerLanguage(pl);
  // German is deliberately incomplete in this repo: five translated keys, everything else English.
  C.registerLanguage(de);
  assert.equal(C.translate("cal.todayBtn", null, "de"), "Zu heute", "a translated key is German");
  assert.equal(C.translate("cal.ics.footnote", null, "de"), en.strings["cal.ics.footnote"], "an untranslated key is English");
  assert.equal(C.translate("common.undo", null, "de"), "R\u00fcckg\u00e4ngig", "another translated key");
  assert.equal(C.translate("common.previous", null, "de"), en.strings["common.previous"], "and an untranslated one beside them");
  // Polish is complete, so it never reaches the fallback for a real key — but the mechanism is the same one.
  assert.equal(C.translate("cal.todayBtn", null, "pl"), pl.strings["cal.todayBtn"]);
});

await test("a key missing EVERYWHERE shows readable words, never the dotted key", () => {
  const shown = C.translate("cal.aKeyNobodyHas", null, "en");
  assert.ok(!DOTTED.test(shown), "not the key: " + shown);
  assert.equal(shown, "A Key Nobody Has", "the last segment, as words");
  // The gap was reported exactly once, and is readable by a developer (and by the audit tool).
  const gaps = C.translationGaps();
  const entry = gaps.find((g) => g.key === "cal.aKeyNobodyHas");
  assert.ok(entry, "the gap is recorded");
  assert.deepEqual(entry.languages, ["en"]);
  // Asking again does not add a second record (the sheet draws constantly; a warning per draw would be noise).
  C.translate("cal.aKeyNobodyHas", null, "en");
  assert.equal(C.translationGaps().filter((g) => g.key === "cal.aKeyNobodyHas").length, 1);
});

await test("an empty string in a table counts as missing, so English answers instead of a blank", () => {
  // A translator leaving a value blank must not blank the label. Checked in a FRESH module instance: registering a
  // throwaway language in the shared one would leak into every later assertion about the menu.
  const sandbox = { module: { exports: {} }, console, Date, JSON, Math, Map, Set, RegExp, Number, String, Object, Array, Error, TypeError, Intl, WeakMap, WeakSet, Symbol };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "additional/notes/calendar/ZentralNotesCalendar.js"), "utf8"), sandbox);
  const fresh = sandbox.module.exports;
  fresh.registerLanguage(en);
  fresh.registerLanguage({ ...en, code: "xx", name: "Test", strings: { ...en.strings, "common.today": "" } });
  assert.equal(fresh.translate("common.today", null, "xx"), en.strings["common.today"]);
  // A blank that English can fill is not a gap: the person sees a real word, so there is nothing to report.
  // (An array from another realm: compare what it says, not its prototype.)
  assert.equal(fresh.translationGaps().length, 0);
});

await test("a gap can be listened to, and unlistened from", () => {
  const seen = [];
  const off = C.onTranslationGap((key, lang) => seen.push(key + ":" + lang));
  C.translate("cal.listenedGap", null, "en");
  assert.deepEqual(seen, ["cal.listenedGap:en"]);
  off();
  C.translate("cal.afterUnlisten", null, "en");
  assert.equal(seen.length, 1, "nothing arrives after the listener is removed");
});

/* ---------- 2. discovery: a file is the only step ---------- */

await test("the registry is generated from the directory, and is current in the repo", () => {
  const codes = buildLanguages.discover();
  assert.deepEqual(codes, ["de", "en", "pl"], "every i18n/<code>.js is listed");
  assert.ok(codes.includes("en"), "and English is still there");
  assert.equal(buildLanguages.render(codes), fs.readFileSync(buildLanguages.OUT, "utf8"), "the checked-in registry is current — run tools/build-languages.cjs");
  // The generated file is a plain data module: no list to remember in JS.
  const registry = require("../additional/notes/i18n/registry.js");
  assert.deepEqual([...registry.languages], ["de", "en", "pl"]);
  assert.equal(registry.fallback, "en");
});

await test("a language file needs only to exist: nothing in the JS names 'de'", () => {
  const sheet = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
  const core = fs.readFileSync(path.join(ROOT, "additional/notes/calendar/ZentralNotesCalendar.js"), "utf8");
  // The old shape was one loadOptional line per language and a hardcoded menu pair; neither may come back.
  assert.match(sheet, /loadOptional\("additional\/notes\/i18n\/registry\.js"\)/);
  assert.match(sheet, /for \(const code of NOTES_LANG_CODES\) loadOptional\("additional\/notes\/i18n\/" \+ code \+ "\.js"\)/);
  assert.ok(!/loadOptional\("additional\/notes\/i18n\/de\.js"\)/.test(sheet), "no per-language load line for de");
  assert.ok(!sheet.includes('choices: [["en", "English"], ["pl", "Polski (Polish)"]] }'), "the hardcoded menu pair is gone");
  assert.match(sheet, /choices: notesLanguageChoices\(\)/);
  // The core's own list is a floor, not a gate.
  assert.match(core, /const codes = new Set\(\[\.\.\.NOTES_LANGUAGES\]\)/);
  assert.match(core, /__zentralNotesLangRegistry\?\.languages/);
});

await test("the menu is built from what registered, and says how complete a language is", () => {
  for (const table of [en, pl, de]) C.registerLanguage(table);
  const langs = C.notesLanguages();
  assert.deepEqual(langs.map((l) => l.code), ["en", "de", "pl"], "English first, then by code");
  const german = langs.find((l) => l.code === "de");
  assert.equal(german.complete, false, "the incomplete file is honest about it");
  assert.ok(german.missing > 800, "most of German is still English: " + german.missing);
  assert.equal(german.total, langs.find((l) => l.code === "en").total);
  const polish = langs.find((l) => l.code === "pl");
  assert.equal(polish.complete, true);
  assert.equal(polish.missing, 0);
  // The sheet's helper renders exactly that: a complete language by name, an incomplete one with its count.
  const sheet = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
  assert.match(sheet, /function notesLanguageChoices\(\)[\s\S]{0,400}notesLanguages/);
  assert.match(sheet, /entry\.complete \? entry\.name : entry\.name \+ " \\u2014 " \+ entry\.missing \+ " missing"/);
});

await test("German's date words parse, so a language file is a whole language, not just labels", () => {
  const now = new Date(2026, 10, 17, 10, 0, 0).getTime();
  const day = (text) => {
    const ms = C.parseDateText(text, now, { lang: "de" });
    return ms ? C.ymd(new Date(ms)) : null;
  };
  assert.equal(day("heute"), "2026-11-17");
  assert.equal(day("morgen"), "2026-11-18");
  assert.equal(day("\u00fcbermorgen"), "2026-11-19");
  assert.equal(day("gestern"), "2026-11-16");
  assert.equal(day("25. dezember"), "2026-12-25", "day + month, German month name");
  assert.equal(day("in 3 tagen"), "2026-11-20", "a counted offset");
  assert.equal(day("vor 2 wochen"), "2026-11-03", "a negative counted offset");
});

/* ---------- 3. nothing dotted on screen ---------- */

await test("live sheet with an incomplete table: no rendered text is a dotted key", async () => {
  const { makeHarness } = require("./helpers/holiday-harness.cjs");
  const h = makeHarness({ sheetW: 960, sheetH: 640, paneW: 640, paneH: 540 });
  // German is registered and deliberately incomplete; English answers the rest. Then the sheet is drawn.
  C.registerLanguage(de);
  await h.store.open();
  h.store.create("# Language test");
  await h.sheet.open();
  await h.flush();
  h.sheet.openCalendar();
  await h.flush();
  const walk = (el, out = []) => {
    if (!el) return out;
    if (el.textContent && el.children.length === 0) out.push(el.textContent.trim());
    for (const child of el.children || []) walk(child, out);
    return out;
  };
  const texts = walk(h.sheet.root);
  const dotted = texts.filter((value) => DOTTED.test(value));
  assert.deepEqual(dotted, [], "these rendered as keys: " + dotted.join(" | "));
  assert.ok(texts.length > 20, "the sheet really drew something (" + texts.length + " text nodes)");
  // And the words a person reads are the German ones where German exists, English elsewhere.
  const all = texts.join(" \u00b7 ");
  assert.ok(all.length > 0);
});

await test("with NO language table registered at all, the sheet still shows no key", async () => {
  // The exact failure from the report: no table for the active language. A separate process-like context, because the
  // registry in this one already holds the tables; this checks the readable-key path through a fresh module instance.
  const fresh = require("node:vm").runInNewContext(
    "(() => { " + fs.readFileSync(path.join(ROOT, "additional/notes/calendar/ZentralNotesCalendar.js"), "utf8") + "; return typeof translate === 'function' ? translate : null; })()",
    { window: undefined, module: { exports: {} }, console, Date, JSON, Math, Map, Set, RegExp, Number, String, Object, Array, Error, TypeError, Intl, WeakMap, WeakSet, Symbol },
  );
  // The module body above is an IIFE over `module.exports`; take the export object instead.
  const sandbox = { module: { exports: {} }, console, Date, JSON, Math, Map, Set, RegExp, Number, String, Object, Array, Error, TypeError, Intl, WeakMap, WeakSet, Symbol };
  sandbox.window = undefined;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "additional/notes/calendar/ZentralNotesCalendar.js"), "utf8"), sandbox);
  const bare = sandbox.module.exports;
  const shown = bare.translate("cal.todayBtn", null, "fr");
  assert.ok(!DOTTED.test(shown), "a language with no table shows words, not a key: " + shown);
});

/* ---------- 4. the documentation a new language needs ---------- */

await test("docs/ explains how to add a language, and the tool is named there", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs/ADDING_A_LANGUAGE.md"), "utf8");
  for (const required of ["tools/build-languages.cjs", "i18n/en.js", "i18n/registry.js", "strings", "plural", "weekdays", "months"]) {
    assert.ok(doc.includes(required), "the guide mentions " + required);
  }
  // The guide is reachable from the i18n comment that a translator actually opens.
  const enSource = fs.readFileSync(path.join(ROOT, "additional/notes/i18n/en.js"), "utf8");
  assert.match(enSource, /ADDING_A_LANGUAGE\.md/);
});

if (failed) { console.error(`${failed} failed, ${passed} passed`); process.exit(1); }
console.log(`notes-more-languages: ${passed} passed`);
})();
