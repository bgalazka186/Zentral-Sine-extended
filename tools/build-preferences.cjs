/* Generate Sine's declarative preferences from the same owner schemas as UI.
 * No runtime dependency. Atomic output avoids half-written installation metadata. */
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) =>
      d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)],
    );
}
const schema = new Map();
for (const folder of ["loader", "zentral", "extension", "additional"])
  for (const file of walk(path.join(root, folder)).filter((p) =>
    p.endsWith(".json"),
  )) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data.owner || !Array.isArray(data.schema)) continue;
    for (const item of data.schema) {
      if (schema.has(item.property))
        throw Error("Duplicate schema property " + item.property);
      schema.set(item.property, item);
    }
  }
const layout = JSON.parse(
  fs.readFileSync(path.join(root, "extension/settings/layout.json"), "utf8"),
);
const output = [],
  seen = new Set();
for (const entry of layout.order) {
  if (typeof entry === "object") {
    output.push(entry);
    continue;
  }
  if (schema.has(entry) && !seen.has(entry)) {
    output.push(schema.get(entry));
    seen.add(entry);
  }
}
for (const [key, item] of schema) if (!seen.has(key)) output.push(item);
const file = path.join(root, "preferences.json"),
  temp = file + ".building";
fs.writeFileSync(temp, JSON.stringify(output, null, 2) + "\n");
fs.renameSync(temp, file);
console.log(
  "Generated " + output.filter((x) => x.property).length + " Sine preferences",
);
