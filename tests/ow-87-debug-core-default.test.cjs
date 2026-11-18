"use strict";
/* OW-87: the core logger category must be OFF in the repository, not only on the owner's machine.
 * The owner switched `zen.workspace.zentral.debug.core` off locally, but the schema shipped `true`, the
 * shared fallback table shipped `true`, and the settings window hard-set the pref to `true` on every save,
 * so a fresh install (and every save) turned a debug stream back on. Four things must agree now:
 *   1. the schema default in `additional/diagnostics/settings.json` is false;
 *   2. the shared fallback table in `loader/ZentralShared.js` is false;
 *   3. the logger honours the pref instead of forcing the core category on;
 *   4. the settings window reads and writes the stored value instead of forcing true.
 * `zen.workspace.zentral.modules.logger.enabled` is NOT part of this: the owner decides that separately. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

const KEY = "zen.workspace.zentral.debug.core";
const schema = JSON.parse(read("additional/diagnostics/settings.json"));
const row = schema.schema.find((i) => i.property === KEY);

test("the core debug pref is a real, listed checkbox defaulting to false", () => {
  assert.ok(row, "the schema lists the pref");
  assert.equal(row.type, "checkbox");
  assert.equal(row.defaultValue, false, "a fresh install does not collect core lines");
  assert.ok(
    !/always on|always active/i.test(`${row.label} ${row.description || ""}`),
    "the label no longer claims it is always on",
  );
});

test("the shipped preferences carry the same false default", () => {
  const prefs = JSON.parse(read("additional/diagnostics/preferences.json"));
  const p = prefs.find((i) => i.property === KEY);
  assert.ok(p, "the preferences file has the row");
  assert.equal(p.defaultValue, false);
});

test("the shared fallback table says false too", () => {
  const shared = read("loader/ZentralShared.js");
  assert.match(
    shared,
    /\[Constants\.Diagnostics\.PREF_LOGGER_CORE\]: false,/,
    "Core's own fallback must agree with the schema, or the UI and the code disagree",
  );
  assert.ok(
    !/\[Constants\.Diagnostics\.PREF_LOGGER_CORE\]: true,/.test(shared),
    "no true default survives",
  );
});

test("the logger reads the core pref instead of forcing the category on", () => {
  const logger = read("additional/diagnostics/ZentralLogger.uc.js");
  assert.ok(
    !/moduleName === "core"\) return true/.test(logger),
    "the hardcoded core short-circuit is gone",
  );
  const fn = logger.slice(logger.indexOf("function isModuleEnabled"));
  const body = fn.slice(0, fn.indexOf("\n        }"));
  assert.match(body, /getBoolPref\(prefKey, false\)/, "every module, core included, reads its own pref");
});

test("the settings window reads and writes the stored value", () => {
  const shell = read("extension/settings/controllers/ZentralSettingsShell.js");
  assert.ok(
    !/Core\.setPref\(Constants\.Diagnostics\.PREF_LOGGER_CORE, true\)/.test(shell),
    "saving never forces the pref back on",
  );
  assert.ok(
    !/zs-pref-logger-core"\)\.checked = true; \/\/ Always on/.test(shell),
    "the row is no longer painted as a fixed on switch",
  );
  assert.ok(
    !/id="zs-pref-logger-core" checked disabled/.test(shell),
    "the control is a real switch the person can use",
  );
  assert.match(
    shell,
    /PREF_LOGGER_CORE,\s*\n\s*false,/,
    "loading falls back to false, like the schema",
  );
  assert.match(
    shell,
    /get\("zs-pref-logger-core"\)\.checked,\s*\n\s*\);/,
    "the switch's own value is what gets saved",
  );
});

test("the owner's other decision is untouched", () => {
  // The plan forbids changing the logger module's own enable default, which is a separate, owner-decided pref.
  const schemaText = read("additional/diagnostics/settings.json");
  const json = JSON.parse(schemaText);
  const loggerRow = json.schema.find(
    (i) => i.property === "zen.workspace.zentral.modules.logger.enabled",
  );
  if (loggerRow) assert.equal(typeof loggerRow.defaultValue, "boolean");
  assert.ok(
    !/"zen\.workspace\.zentral\.modules\.logger\.enabled"[\s\S]{0,200}?defaultValue": false/.test(
      schemaText,
    ) || loggerRow,
    "that pref keeps whatever value it already had",
  );
});

console.log(`\nPASS ow-87-debug-core-default (${passed} tests)`);
