"use strict";
/* G11: every setting Sine installs must be reachable from the Zentral main
 * settings window. The RED case is the pre-G11 tree, where
 * extension/settings/controllers/ZentralSettingsCatalog.js listed 24 owner
 * descriptors but not additional/boost/settings.json: all of Boost's root
 * preferences existed as Sine fields and layout rows, yet no control was ever
 * rendered for them (the OW-61 bug class).
 */
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  checkCoverage,
  catalogDescriptors,
  ownerSchemas,
  twinKeys,
  CATALOG,
} = require("../tools/lib/settings-coverage.cjs");
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

/* A small copy of the data the checker reads. Nothing is generated or mutated
 * in the real checkout; every RED/GREEN variant is built in a temp dir. */
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zentral-settings-coverage-"));
  const put = (rel, text) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const copy = (rel) => put(rel, read(rel));
  const owners = ownerSchemas(ROOT);
  for (const owner of owners) copy(owner.file);
  for (const rel of [
    CATALOG,
    "preferences.json",
    "extension/settings/layout.json",
    "extension/settings/release-settings.json",
    "extension/settings/recommended.json",
    "tools/check-settings-consistency.cjs",
    "tools/lib/settings-coverage.cjs",
    "tools/lib/sine-prefs.cjs",
  ]) copy(rel);
  function walk(dirName) {
    return fs.readdirSync(dirName, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dirName, entry.name);
      return entry.isDirectory() ? walk(file) : [file];
    });
  }
  for (const file of walk(path.join(ROOT, "additional"))) {
    if (!file.endsWith(path.sep + "standalone.json")) continue;
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    copy(rel);
    const base = path.dirname(rel);
    for (const name of ["settings.json", "preferences.json"]) {
      const candidate = `${base}/${name}`;
      if (fs.existsSync(path.join(ROOT, candidate))) copy(candidate);
    }
  }
  return { dir, put, copy };
}
const checker = (dir) =>
  cp.spawnSync(process.execPath, [path.join(dir, "tools/check-settings-consistency.cjs")], {
    cwd: dir,
    encoding: "utf8",
  });

test("every owner schema is loaded by the settings catalog (Boost included)", () => {
  const descriptors = catalogDescriptors(ROOT);
  for (const owner of ownerSchemas(ROOT))
    assert.ok(
      descriptors.includes(owner.file),
      `${owner.file} (${owner.owner}) must be in descriptorFiles`,
    );
  assert.ok(descriptors.includes("additional/boost/settings.json"));
  assert.deepEqual(checkCoverage(ROOT), []);
  const green = checker(ROOT);
  assert.equal(green.status, 0, green.stderr);
  assert.match(green.stdout, /catalog checks passed/);
});

test("the consistency checker fails on the old tree with the Boost descriptor removed", () => {
  const f = fixture();
  const catalogFile = path.join(f.dir, CATALOG);
  const source = fs.readFileSync(catalogFile, "utf8");
  const withoutBoost = source.replace(
    /      \{\n        \/\/ G11:[\s\S]*?owner: "boost",\n        file: "additional\/boost\/settings\.json",\n      \},\n/,
    "",
  );
  assert.notEqual(withoutBoost, source, "fixture removed the boost descriptor");
  fs.writeFileSync(catalogFile, withoutBoost);
  const errors = checkCoverage(f.dir);
  assert.ok(
    errors.some((e) => e.includes("additional/boost/settings.json") && e.includes("catalog")),
    "a missing owner descriptor must be reported: " + errors.join(" | "),
  );
  const red = checker(f.dir);
  assert.notEqual(red.status, 0, "the checker must exit non-zero on a coverage error");
  assert.match(red.stdout, /coverage: settings catalog does not load additional\/boost\/settings\.json/);
  assert.match(red.stdout, /errors/);
  // GREEN again when the descriptor is restored, so the test is not just pinning a broken fixture.
  fs.writeFileSync(catalogFile, source);
  assert.deepEqual(checkCoverage(f.dir), []);
  const green = checker(f.dir);
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.match(green.stdout, /catalog checks passed/);
});

test("every root preferences.json field resolves to a placed schema row, including numeric _text twins", () => {
  const prefs = json("preferences.json");
  const layout = json("extension/settings/layout.json");
  const declared = new Set(
    layout.categories.flatMap((c) => c.sections.map((s) => `${c.id}\u0000${s.label}`)),
  );
  const owners = ownerSchemas(ROOT);
  const allRows = owners.flatMap((o) => o.data.schema);
  const keys = twinKeys(allRows);
  const byFile = new Map(
    owners.flatMap((o) => o.data.schema.map((i) => [i.property, o])),
  );
  const numericTwins = prefs.filter((p) => p.property && p.property.endsWith("_text"));
  assert.ok(numericTwins.length > 100, "the pack really uses free numeric entry");
  for (const pref of prefs) {
    if (!pref || !pref.property) continue;
    assert.ok(keys.has(pref.property), `${pref.property} has an owner schema row`);
    const canonical = keys.get(pref.property);
    const owner = byFile.get(canonical);
    const meta = owner.data.settings[canonical];
    assert.ok(meta, `${canonical} has settings placement`);
    assert.ok(declared.has(`${meta.category}\u0000${meta.section}`), `${canonical} is in a declared section`);
    assert.ok(layout.order.includes(canonical), `${canonical} is in layout.order`);
  }
});

test("every Boost setting is generated, placed and visible in the main settings window", () => {
  const boost = json("additional/boost/settings.json");
  const layout = json("extension/settings/layout.json");
  const rootPrefs = json("preferences.json").map((p) => p.property);
  const category = layout.categories.find((c) => c.id === "boost");
  assert.ok(category, "layout declares the boost category");
  for (const section of ["Memory", "Limiter", "Game Mode"]) {
    assert.ok(category.sections.some((s) => s.label === section), `layout declares ${section}`);
    assert.ok(boost.categories[0].sections.some((s) => s.label === section), `boost declares ${section}`);
  }
  assert.ok(boost.schema.length >= 11, "Boost's original 11 settings are still there");
  assert.equal(boost.schema.length, Object.keys(boost.settings).length, "every row is placed");
  for (const item of boost.schema) {
    assert.deepEqual(boost.settings[item.property]?.owner, "boost");
    assert.equal(boost.settings[item.property]?.category, "boost");
    assert.ok(layout.order.includes(item.property), `${item.property} is ordered`);
    const key = item.numeric ? `${item.property}_text` : item.property;
    assert.ok(rootPrefs.includes(key), `${key} is generated in preferences.json`);
  }
});

test("the checker catches an orphan Sine preference and a missing standalone setting", () => {
  const f = fixture();
  const rootPrefs = JSON.parse(read("preferences.json"));
  rootPrefs.push({ property: "zen.workspace.zentral.boost.orphan", label: "Orphan", type: "checkbox", defaultValue: false });
  f.put("preferences.json", JSON.stringify(rootPrefs, null, 2) + "\n");
  assert.ok(
    checkCoverage(f.dir).some((e) => e.includes("zen.workspace.zentral.boost.orphan")),
    "an orphan preference must be reported",
  );
  f.copy("preferences.json");

  const boostPrefsFile = "additional/boost/preferences.json";
  const boostPrefs = JSON.parse(read(boostPrefsFile));
  f.put(boostPrefsFile, JSON.stringify(boostPrefs.slice(1), null, 2) + "\n");
  assert.ok(
    checkCoverage(f.dir).some((e) => e.includes("standalone preferences.json") && e.includes("boost")),
    "a shipped setting missing from a standalone package must be reported",
  );
});
