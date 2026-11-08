"use strict";
/* Reads the feature tables of docs/MARKDOWN_FLAVORS.md and (re)writes the data block inside
 * additional/notes/flavors/ZentralNotesFlavors.js. The doc is the source of truth.
 *   node tools/build-flavors-data.cjs          write
 *   node tools/build-flavors-data.cjs --check  exit 1 when the block is out of date */
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const DOC = path.join(root, "docs/MARKDOWN_FLAVORS.md");
const TARGET = path.join(root, "additional/notes/flavors/ZentralNotesFlavors.js");
const BEGIN = "/*__FEATURES_BEGIN__*/", END = "/*__FEATURES_END__*/";
const SUP = { "✅": "y", "◐": "p", "🏷": "t", "🔌": "x", "❌": "n" };
const NOW = { HAVE: "H", PART: "P", BUG: "B", NO: "N" };
function rows(doc) {
  const out = [];
  for (const line of doc.split("\n")) {
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    if (cells.length < 9 || !/^[A-Z]\d{2}$/.test(cells[1])) continue;
    const [, id, name, , gh, ob, rd, now, mixed] = cells;
    const n = /(HAVE|PART|BUG|NO)/.exec(now);
    if (!(gh in SUP) || !(ob in SUP) || !(rd in SUP) || !n) throw new Error("bad row " + id + ": " + line.slice(0, 120));
    out.push({ id, name: name.replace(/\\\|/g, "|"), gh: SUP[gh], ob: SUP[ob], rd: SUP[rd], now: NOW[n[1]], mixed });
  }
  return out;
}
function block(list) {
  const body = list.map((r) => `  ${JSON.stringify(r.id)}: [${[r.gh, r.ob, r.rd, r.now, r.mixed].map((x) => JSON.stringify(x)).join(", ")}],`).join("\n");
  return `${BEGIN}\n  // id: [github, obsidian, reddit, notes today, mixed]. github/obsidian/reddit: y yes, p partly, t only as an HTML tag,\n  // x plugin or theme, n no. mixed: ON, ON+guard, PICK, OFF. GENERATED from docs/MARKDOWN_FLAVORS.md; do not edit.\n  const FEATURES = {\n${body}\n  };\n  ${END}`;
}
module.exports = { rows, block };
if (require.main === module) {
  const list = rows(fs.readFileSync(DOC, "utf8"));
  const src = fs.readFileSync(TARGET, "utf8");
  const a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < 0) throw new Error("markers missing in " + TARGET);
  const next = src.slice(0, a) + block(list) + src.slice(b + END.length);
  if (process.argv.includes("--check")) {
    if (next !== src) { console.error("flavor data is out of date: run node tools/build-flavors-data.cjs"); process.exit(1); }
    console.log("flavor data in step (" + list.length + " features)");
  } else {
    fs.writeFileSync(TARGET, next);
    console.log("wrote " + list.length + " features");
  }
}
