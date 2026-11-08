/* Catalog consistency check: mirrors ZentralSettingsCatalog.js validation. */
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) =>
      d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)],
    );
}
const layout = JSON.parse(
  fs.readFileSync(path.join(root, "extension/settings/layout.json"), "utf8"),
);
const definitions = new Map(layout.categories.map((c) => [c.id, c]));
const seen = new Set();
let errors = 0;
const fail = (msg) => {
  console.log("ERROR: " + msg);
  errors++;
};
for (const folder of ["loader", "zentral", "extension", "additional"]) {
  for (const file of walk(path.join(root, folder)).filter((p) =>
    p.endsWith(".json"),
  )) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data.owner || !Array.isArray(data.schema)) continue;
    for (const item of data.schema) {
      const meta = data.settings?.[item.property];
      if (!meta) {
        fail(file + ": no settings entry for " + item.property);
        continue;
      }
      if (meta.owner !== data.owner)
        fail(file + ": owner mismatch for " + item.property);
      const category = definitions.get(meta.category);
      if (!category) {
        fail(file + ": unknown category " + meta.category);
        continue;
      }
      if (!category.sections.some((s) => s.label === meta.section))
        fail(
          file +
            ": unknown section '" +
            meta.section +
            "' in category " +
            meta.category +
            " for " +
            item.property,
        );
      if (seen.has(item.property))
        fail("duplicate property " + item.property);
      seen.add(item.property);
    }
  }
}
const order = new Set(
  layout.order.filter((x) => typeof x === "string"),
);
for (const key of order) {
  if (!seen.has(key)) fail("layout order references unknown setting " + key);
}
for (const key of seen) {
  if (!order.has(key)) console.log("note: setting not in layout order: " + key);
}
const release = JSON.parse(
  fs.readFileSync(
    path.join(root, "extension/settings/release-settings.json"),
    "utf8",
  ),
);
for (const key of release.keys)
  if (!seen.has(key)) fail("release-settings references unknown key " + key);
const recommended = JSON.parse(
  fs.readFileSync(
    path.join(root, "extension/settings/recommended.json"),
    "utf8",
  ),
);
for (const key of Object.keys(recommended.prefs || {}))
  if (!seen.has(key))
    console.log("note: recommended key is not in any schema: " + key);
console.log(errors ? errors + " errors" : "catalog checks passed");
