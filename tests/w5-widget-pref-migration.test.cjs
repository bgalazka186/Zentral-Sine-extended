"use strict";
/* W5: migrate the retired Widgets-owned Boost toggle into Boost's own widget_enabled pref exactly once.
 * The old user value is read-only and stays in the profile; an explicit value in the new namespace always wins.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFakeStandaloneBoostHarness } = require("./helpers/fake-standalone-boost-harness.cjs");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const OLD_PREF = "zen.workspace.zentral.widgets.boost.enabled";
const NEW_PREF = "zen.workspace.zentral.boost.widget_enabled";
const BOOST_SOURCE = read("additional/boost/ZentralBoost.uc.js");
const BOOST_BUNDLE = read("additional/boost/ZentralBoost.standalone.uc.js");
const BOOST_MANIFEST = json("additional/boost/standalone.json");
const BOOST_SETTINGS = json("additional/boost/settings.json");
const BOOST_PREFS = json("additional/boost/preferences.json");
const WIDGETS_MANIFEST = json("additional/widgets/standalone.json");
const WIDGETS_SETTINGS = json("additional/widgets/settings.json");
const WIDGETS_PREFS = json("additional/widgets/preferences.json");
const ROOT_PREFS = json("preferences.json");
const LAYOUT = json("extension/settings/layout.json");

const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const rows = (file) => Array.isArray(file) ? file : [];
const row = (list, property) => rows(list).find((item) => item?.property === property);

async function boot(prefs = {}) {
  const unsetPrefs = owns(prefs, NEW_PREF) ? [] : [NEW_PREF];
  return createFakeStandaloneBoostHarness({
    instrumentApi: null,
    prefs,
    unsetPrefs,
  }).boot();
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("saved legacy false is copied to Boost's pref and the old user value is retained", async () => {
  const h = await boot({ [OLD_PREF]: false });
  try {
    assert.equal(h.prefs.get(NEW_PREF), false);
    assert.equal(h.prefs.get(OLD_PREF), false, "migration never deletes or rewrites the old preference");
    assert.equal(h.card(), null, "the migrated OFF choice hides the Boost-owned tile");
  } finally {
    h.destroy();
  }
});

test("an unset legacy pref leaves the new pref unset and uses the default-on setting", async () => {
  const h = await boot();
  try {
    assert.equal(h.prefs.has(OLD_PREF), false);
    assert.equal(h.prefs.has(NEW_PREF), false, "default true is not persisted as a synthetic user value");
    assert.ok(h.card(), "the default-on Boost widget remains visible");
  } finally {
    h.destroy();
  }
});

test("when both values exist the new Boost pref wins in either direction", async () => {
  for (const [legacy, current] of [[true, false], [false, true]]) {
    const h = await boot({ [OLD_PREF]: legacy, [NEW_PREF]: current });
    try {
      assert.equal(h.prefs.get(NEW_PREF), current, "current Boost choice is not overwritten");
      assert.equal(h.prefs.get(OLD_PREF), legacy, "the old choice remains untouched");
      assert.equal(Boolean(h.card()), current, "the tile follows the new pref");
    } finally {
      h.destroy();
    }
  }
});

test("the migration pref is Boost-owned, declared as a read-only external legacy source, and cataloged in Memory", () => {
  const setting = BOOST_SETTINGS.schema.find((item) => item.property === NEW_PREF);
  assert.ok(setting);
  assert.equal(setting.label, "Show the Boost widget");
  assert.equal(setting.defaultValue, true);
  assert.equal(BOOST_SETTINGS.settings[NEW_PREF].category, "boost");
  assert.equal(BOOST_SETTINGS.settings[NEW_PREF].section, "Memory");
  assert.ok(row(BOOST_PREFS, NEW_PREF), "standalone Boost preferences include the setting");
  assert.ok(row(ROOT_PREFS, NEW_PREF), "the full-pack preference catalog includes the setting");
  assert.ok(LAYOUT.order.includes(NEW_PREF), "the Memory section exposes the setting in layout order");
  assert.ok(BOOST_MANIFEST.externalPrefs.includes(OLD_PREF), "standalone Boost declares its one-time legacy read");
  assert.equal(WIDGETS_MANIFEST.externalPrefs.includes(OLD_PREF), false, "Widgets does not own or read the legacy toggle");
  assert.equal(WIDGETS_SETTINGS.schema.some((item) => item.property === OLD_PREF), false);
  assert.equal(row(WIDGETS_PREFS, OLD_PREF), undefined);
  assert.equal(row(ROOT_PREFS, OLD_PREF), undefined, "the old pref is not regenerated as a shipped setting");
  assert.match(BOOST_SOURCE, /LEGACY_WIDGET_ENABLED:\s*"zen\.workspace\.zentral\.widgets\.boost\.enabled"/);
  assert.match(BOOST_BUNDLE, /LEGACY_WIDGET_ENABLED:\s*"zen\.workspace\.zentral\.widgets\.boost\.enabled"/);
  assert.match(BOOST_SOURCE, /if \(prefHasUserValue\(PREF\.WIDGET_ENABLED\)\) return/);
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\nW5 widget pref migration (${passed}/${tests.length} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
