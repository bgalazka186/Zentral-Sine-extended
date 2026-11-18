"use strict";
/* OW-64: one language selector for every widget.
 * The owner: "build language selector for all widgets, it should sync with notes language untill user decides that it
 * should not". Notes already has a language; each widget used to have none (English, always, with the browser's locale
 * only for the clock's numbers).
 * The rule this file pins down:
 *   - `auto` resolves to the Notes language AT THE MOMENT a string is needed, so changing Notes changes the widgets
 *     that never chose;
 *   - an explicit `en`/`pl` is that person's choice and ignores what Notes does afterwards;
 *   - a half-finished translation can never draw an empty button: a missing key falls back to English, then to the key.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/settings.json"), "utf8"));
const LAYOUT = JSON.parse(fs.readFileSync(path.join(root, "extension/settings/layout.json"), "utf8"));
const STANDALONE = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/standalone.json"), "utf8"));

const seam = {};
const win = { __zentralWidgetsTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(SRC, {
  window: win, globalThis: { Services: {} }, URL, Date, JSON, Math, Promise, RegExp,
  Number, String, Array, Object, Map, Set, console,
});
const c = seam.core;
const LANG_PREF = "zen.workspace.zentral.widgets.language";
const NOTES_LANG_PREF = "zen.workspace.zentral.notes.language";

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

test("the pref exists and reaches the dialog, the layout and the standalone package", () => {
  const entry = (SETTINGS.schema || []).find((row) => row.property === LANG_PREF);
  assert.ok(entry, "the pref is in the widgets schema");
  assert.equal(entry.type, "dropdown", "it is a selector, not a free-text field");
  assert.equal(entry.defaultValue, "auto", "and it starts by following Notes");
  assert.deepEqual(entry.options.map((o) => o.value), ["auto", "en", "pl"], "the three states are exactly these");
  assert.ok(SETTINGS.settings[LANG_PREF], "and it has a settings entry, or the dialog drops it (the OW-61 lesson)");
  // `extension/settings/layout.json` keeps the order under `categories`; the flat order is what the dialog walks.
  const order = JSON.stringify(LAYOUT);
  assert.ok(order.includes(LANG_PREF), "the dialog's layout places it somewhere");
  assert.ok((STANDALONE.preferenceOrder || []).includes(LANG_PREF), "and the standalone package ships it");
});

test("`auto` follows the Notes language, and an explicit choice does not", () => {
  assert.equal(c.resolveWidgetLanguage("auto", "en"), "en");
  assert.equal(c.resolveWidgetLanguage("auto", "pl"), "pl");
  assert.equal(c.resolveWidgetLanguage("auto", "pl-PL"), "pl", "a region still counts as that language");
  assert.equal(c.resolveWidgetLanguage("auto", ""), "en", "nothing set means English");
  // The owner's "until the user decides that it should not".
  assert.equal(c.resolveWidgetLanguage("en", "pl"), "en", "a chosen language ignores Notes");
  assert.equal(c.resolveWidgetLanguage("pl", "en"), "pl");
  assert.equal(c.resolveWidgetLanguage("auto", "en"), "en", "and going back to auto follows Notes again");
});

test("a damaged setting falls back to following Notes, never to a broken language", () => {
  // Intent: a value nobody can understand must not become a language. "Not understood" means FOLLOW NOTES, because
  // that is the state a person never had to choose and never has to fix.
  assert.equal(c.cleanWidgetLanguage("klingon"), "auto", "an unknown language follows Notes");
  assert.equal(c.cleanWidgetLanguage(""), "auto", "an empty value follows Notes");
  assert.equal(c.cleanWidgetLanguage(null), "auto", "a missing value follows Notes");
  assert.equal(c.cleanWidgetLanguage(" PL "), "pl", "but a real value with a stray space keeps the choice");
  assert.equal(c.resolveWidgetLanguage("klingon", "pl"), "pl", "junk still follows Notes");
});

test("both languages have every string, and nothing is drawn as an empty button", () => {
  const en = Object.keys(c.WIDGET_STRINGS.en);
  assert.ok(en.length >= 30, "the table is the widgets' whole vocabulary (" + en.length + " keys)");
  for (const key of en) {
    assert.ok(c.WIDGET_STRINGS.pl[key], "Polish is missing: " + key);
    assert.notEqual(c.WIDGET_STRINGS.pl[key], "", "Polish is empty: " + key);
    assert.notEqual(c.WIDGET_STRINGS.en[key], "", "English is empty: " + key);
  }
  assert.deepEqual(Object.keys(c.WIDGET_STRINGS.pl).sort(), en.sort(), "and there is no Polish key English lacks");
  // A key nobody wrote is still a word, not a blank.
  assert.equal(c.widgetText("pl", "no.such.key"), "no.such.key");
  assert.equal(c.widgetText("pl", "timer.start"), c.WIDGET_STRINGS.pl["timer.start"]);
  assert.equal(c.widgetText("xx", "timer.start"), c.WIDGET_STRINGS.en["timer.start"], "an unknown language reads English");
});

test("a string with a value in it keeps the value in both languages", () => {
  assert.equal(c.widgetText("en", "timer.presetTitle", { value: "5:00" }), "Start a countdown of 5:00");
  assert.equal(c.widgetText("pl", "timer.presetTitle", { value: "5:00" }), "Uruchom odliczanie 5:00");
  assert.match(c.widgetText("pl", "timer.aria", { value: "0:42", kind: ", stoper" }), /^Minutnik 0:42, stoper\./);
  assert.equal(c.widgetText("en", "timer.presetTitle"), c.WIDGET_STRINGS.en["timer.presetTitle"], "a missing value leaves the placeholder");
});

test("the weather descriptions follow the language too", () => {
  assert.equal(c.weatherCodeInfo(0).label, "Clear sky", "a caller that names no language keeps the old words");
  assert.equal(c.weatherCodeInfo(0, "en").label, "Clear sky");
  assert.equal(c.weatherCodeInfo(0, "pl").label, "Bezchmurnie");
  assert.equal(c.weatherCodeInfo(95, "pl").label, "Burza");
  assert.equal(c.weatherCodeInfo(9999, "pl").label, "Nieznana", "a code nobody knows is honest in both languages");
  for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) {
    assert.ok(c.weatherCodeInfo(code, "pl").label, "Polish has every code (" + code + ")");
    assert.notEqual(c.weatherCodeInfo(code, "pl").label, c.weatherCodeInfo(code, "en").label, "and it really is a translation (" + code + ")");
  }
});

test("the widgets read the language when they draw, not when they start", () => {
  // `widgetLang`/`tw` are the panel's own doors: they ask the prefs at call time, which is what makes a change in
  // Notes show up without a restart. Asserted on the source, because they close over the live prefs.
  const body = SRC.slice(SRC.indexOf("const widgetLang = () =>"), SRC.indexOf("const registry = new Map()"));
  assert.match(body, /getString\(WIDGET_PREFS\.LANGUAGE/, "the widget language pref is read for every draw");
  assert.match(body, /getString\(NOTES_LANGUAGE_PREF, "en"\)/, "and the Notes pref with it, which is what `auto` means");
  assert.match(SRC, /const NOTES_LANGUAGE_PREF = "zen\.workspace\.zentral\.notes\.language"/, "the pref it follows is Notes' own");
  // The strings that used to be literals are drawn through it.
  for (const [literal, key] of [["Set", "timer.set"], ["Save", "timer.save"], ["Note", "timer.note"]]) {
    assert.ok(!new RegExp('(setBtn|clockNoteBtn|clockNoteChip)\\.textContent = "' + literal + '"').test(SRC), literal + " is not a literal any more");
    assert.ok(SRC.includes('tw("' + key + '")'), literal + " goes through tw() with " + key);
  }
  for (const key of ["clock.title", "date.title", "weather.title", "status.title", "tray.label"]) {
    assert.ok(SRC.includes('tw("' + key + '")'), "the card title and the tray label use " + key);
  }
});

test("the status card's own words are translated through its options, so the pure part stays pure", () => {
  const pl = { language: "pl" };
  const parts = c.composeStatusParts({ showBattery: true, showMemory: true, ...pl }, null, null, { battery: false, memory: false });
  const memory = parts.find((p) => p.kind === "memory");
  assert.equal(memory.title, c.WIDGET_STRINGS.pl["status.memoryUnavailable"], "the memory note is Polish");
  const batteryOnly = c.composeStatusParts({ showBattery: true, showMemory: false, ...pl }, null, null, { battery: false, memory: false });
  const battery = batteryOnly.find((p) => p.kind === "battery");
  // OW-70: a desktop's missing battery is quiet in BODY text, and the explanation lives in the title — translated like
  // every other word, in both languages.
  assert.equal(battery.text, "", "no complaint in the body");
  assert.equal(battery.title, c.WIDGET_STRINGS.pl["status.noBatteryTitle"], "but the reason is Polish too");
  assert.equal(c.composeStatusParts({ showBattery: true, showMemory: false }, null, null, { battery: false, memory: false })[0].title,
    c.WIDGET_STRINGS.en["status.noBatteryTitle"], "and English for a caller that says nothing");
  // English is unchanged for a caller that says nothing (every test written before this one).
  const plainParts = c.composeStatusParts({ showBattery: true, showMemory: true }, null, null, { battery: false, memory: false });
  assert.equal(plainParts.find((p) => p.kind === "memory").title, "Memory usage is not available in this build");
});

console.log("\nPASS widgets-language (" + passed + " tests)");
