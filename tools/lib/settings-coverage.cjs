"use strict";
/* G11: the main settings window must be able to render every preference that
 * Sine installs, in the full pack AND in each standalone package.
 *
 * `tools/check-settings-consistency.cjs` used to check only schema -> settings
 * metadata. That cannot catch a whole owner descriptor missing from
 * `ZentralSettingsCatalog.js` (the OW-61 bug class, and Boost's 11 invisible
 * settings). This module adds the two missing directions:
 *   1. every owner schema file is loaded by the settings catalog;
 *   2. every generated Sine preference (root and per-standalone) resolves to an
 *      owned/borrowed schema row with a declared category and section.
 *
 * Numeric settings ship as `<key>_text` string fields in Sine, so twin keys are
 * mapped back to their canonical schema property with textKey() from
 * tools/lib/sine-prefs.cjs. No runtime/browser dependency: data only.
 */
const fs = require("node:fs"),
  path = require("node:path");
const { textKey } = require("./sine-prefs.cjs");

const OWNER_FOLDERS = ["loader", "zentral", "extension", "additional"];
const CATALOG = "extension/settings/controllers/ZentralSettingsCatalog.js";

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) =>
      d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)],
    );
}
function rel(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function ownerSchemas(root) {
  const found = [];
  for (const folder of OWNER_FOLDERS) {
    const dir = path.join(root, folder);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir).filter((p) => p.endsWith(".json"))) {
      let data;
      try {
        data = readJson(file);
      } catch (_) {
        continue;
      }
      if (!data.owner || !Array.isArray(data.schema)) continue;
      found.push({ file: rel(root, file), owner: data.owner, data });
    }
  }
  return found;
}
function catalogDescriptors(root) {
  const text = fs.readFileSync(path.join(root, CATALOG), "utf8");
  return [...text.matchAll(/file:\s*"([^"]+)"/g)].map((m) => m[1]);
}
function twinKeys(items) {
  const keys = new Map();
  for (const item of items) {
    keys.set(item.property, item.property);
    if (item.numeric) keys.set(textKey(item.property), item.property);
  }
  return keys;
}

function checkCoverage(root) {
  const errors = [];
  const owners = ownerSchemas(root);
  const descriptors = catalogDescriptors(root);
  const descriptorSet = new Set(descriptors);
  const ownerFiles = new Set(owners.map((o) => o.file));
  for (const owner of owners)
    if (!descriptorSet.has(owner.file))
      errors.push(
        `settings catalog does not load ${owner.file} (owner ${owner.owner}); its settings are invisible in the main settings window`,
      );
  for (const file of descriptors)
    if (!ownerFiles.has(file))
      errors.push(`settings catalog loads unknown descriptor ${file}`);

  // Root preferences.json: every Sine field must resolve to a schema row that is
  // placed in a declared category/section of layout.json.
  const layout = readJson(path.join(root, "extension/settings/layout.json"));
  const sections = new Set(
    layout.categories.flatMap((c) =>
      c.sections.map((s) => `${c.id}\u0000${s.label}`),
    ),
  );
  const canonical = new Map();
  const rootKeys = twinKeys(
    owners.flatMap((o) => o.data.schema).filter((i) => i && i.property),
  );
  for (const [key, real] of rootKeys) canonical.set(key, real);
  const rootPrefs = readJson(path.join(root, "preferences.json"));
  for (const pref of rootPrefs) {
    if (!pref || typeof pref !== "object" || !pref.property) continue;
    const key = canonical.get(pref.property);
    if (!key) {
      errors.push(`preferences.json has ${pref.property} with no owner schema row`);
      continue;
    }
    const owner = owners.find((o) =>
      o.data.schema.some((i) => i.property === key),
    );
    const meta = owner?.data.settings?.[key];
    if (!meta || !sections.has(`${meta.category}\u0000${meta.section}`))
      errors.push(
        `preferences.json field ${pref.property} has no declared category/section in the main settings window`,
      );
  }

  // Standalone packages: their generated preferences.json is the whole settings
  // surface a standalone user has. Every field must resolve to a row the package
  // owns or explicitly borrows, and every owned row must be shipped (unless the
  // manifest excludes it with a reason).
  const additional = path.join(root, "additional");
  const manifests = fs.existsSync(additional)
    ? walk(additional).filter((f) => f.endsWith(`${path.sep}standalone.json`))
    : [];
  for (const manifestFile of manifests) {
    const dir = path.dirname(manifestFile);
    const manifest = readJson(manifestFile);
    const id = manifest.id || rel(root, manifestFile);
    const prefsFile = path.join(dir, "preferences.json");
    if (!fs.existsSync(prefsFile)) continue;
    const own = manifest.settings
      ? readJson(path.join(dir, manifest.settings)).schema || []
      : [];
    let borrowed = [];
    for (const group of manifest.borrowedSettings || []) {
      const source = path.join(root, group.from);
      const rows = fs.existsSync(source) ? readJson(source).schema || [] : [];
      borrowed = borrowed.concat(
        group.properties.map((property) => rows.find((r) => r.property === property)).filter(Boolean),
      );
    }
    const excluded = new Set(
      (manifest.excludePrefs && manifest.excludePrefs.properties) || [],
    );
    const keys = twinKeys([...own, ...borrowed]);
    const generated = readJson(prefsFile);
    const shipped = new Set(
      generated
        .filter((p) => p && typeof p === "object" && p.property)
        .map((p) => p.property),
    );
    for (const pref of generated) {
      if (!pref || typeof pref !== "object" || !pref.property) continue;
      if (!keys.has(pref.property))
        errors.push(
          `${id}: standalone preferences.json field ${pref.property} has no owned/borrowed schema row`,
        );
    }
    for (const item of own) {
      if (excluded.has(item.property)) continue;
      const key = item.numeric ? textKey(item.property) : item.property;
      if (!shipped.has(key))
        errors.push(`${id}: owned setting ${item.property} is missing from its standalone preferences.json`);
    }
  }
  return errors;
}

module.exports = { checkCoverage, ownerSchemas, catalogDescriptors, twinKeys, CATALOG };
