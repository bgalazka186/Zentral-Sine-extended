/* Rebuilds layout.order so Sine's preference page reads top-down like the
 * Settings window: group heading -> "Category · Section" heading -> settings.
 * Section membership comes from each owner descriptor's `settings` metadata;
 * the existing relative order inside a section is kept (stable). Settings that
 * were missing from the order are appended to the end of their section.
 * Run:  node tools/organize-layout-order.cjs [--check]   then
 *       node tools/build-preferences.cjs */
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const layoutFile = path.join(root, "extension/settings/layout.json");
const layout = JSON.parse(fs.readFileSync(layoutFile, "utf8"));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const meta = new Map();
for (const folder of ["loader", "zentral", "extension", "additional"])
  for (const f of walk(path.join(root, folder)).filter((p) => p.endsWith(".json"))) {
    const data = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!data.owner || !Array.isArray(data.schema)) continue;
    for (const item of data.schema) meta.set(item.property, data.settings[item.property]);
  }
const oldIndex = new Map();
layout.order.filter((x) => typeof x === "string").forEach((k, i) => oldIndex.set(k, i));
const byKey = new Map();
for (const [prop, m] of meta) {
  const key = m.category + "\u0000" + m.section;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(prop);
}
for (const list of byKey.values())
  list.sort((a, b) => (oldIndex.get(a) ?? 1e9) - (oldIndex.get(b) ?? 1e9));
const out = [], used = new Set();
let lastGroup = null;
for (const cat of layout.categories) {
  for (const section of cat.sections) {
    const props = byKey.get(cat.id + "\u0000" + section.label);
    if (!props || !props.length) continue;
    if (cat.group !== lastGroup) {
      out.push({ type: "text", label: "**" + cat.group + "**", size: "22px" });
      lastGroup = cat.group;
    }
    out.push({ type: "text", label: "**" + cat.label + " · " + section.label + "**", size: "16px" });
    for (const p of props) { out.push(p); used.add(p); }
  }
}
for (const p of meta.keys()) if (!used.has(p)) throw Error("setting not placed: " + p);
if (process.argv.includes("--check")) { console.log(JSON.stringify(layout.order) === JSON.stringify(out) ? "up to date" : "layout.order is stale"); process.exit(0); }
layout.order = out;
fs.writeFileSync(layoutFile, JSON.stringify(layout, null, 2) + "\n");
console.log("order: " + out.filter((x) => typeof x === "string").length + " settings, " + out.filter((x) => typeof x === "object").length + " headings");
