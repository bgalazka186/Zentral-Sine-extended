#!/usr/bin/env node
/* Schema-vs-code default drift check.
 * The schema `defaultValue` is what Sine and the settings window show, so a `getPref(key, fallback)`
 * style read must use the same value, or the UI claims one thing and the code does another.
 * Usage: node tools/check-default-drift.cjs [--json]
 * Exit code 1 when any mismatch is found. Shared by tests/defaults.test.cjs. */
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set([".git", "node_modules", "upstream", "patches", "docs", "tools", "tests", ".kilo"]);
const READERS = "getPref|getBoolPref|getIntPref|getStringPref|getBool|getInt|getString|readBool|readInt|readString|prefBool|prefInt|prefString";

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function loadSchema() {
  const defaults = new Map();
  for (const file of walk(root).filter((f) => f.endsWith("preferences.json"))) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(data)) continue;
    for (const item of data) {
      if (!item.property || !("defaultValue" in item)) continue;
      // Numeric settings are shown through a `<key>_text` string field (see add-numeric-metadata.py);
      // the code reads the real integer pref, so compare against the numeric value.
      if (/_text$/.test(item.property) && /^-?\d+$/.test(String(item.defaultValue)))
        defaults.set(item.property.replace(/_text$/, ""), Number(item.defaultValue));
      else defaults.set(item.property, item.defaultValue);
    }
  }
  return defaults;
}

function literal(text) {
  const t = text.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^(["'`])((?:\\.|(?!\1).)*)\1$/s.exec(t);
  return m ? m[2] : undefined;
}

function collectNames(files) {
  return collectNamesFrom(files);
}

function collectNamesFrom(files) {
  // NAME -> pref string, from `NAME: "zen.workspace.x"` and `const NAME = "zen.workspace.x"`,
  // gathered across all files because constants are defined in one module and read in another.
  // A `NAME:\n "pref"` split over two lines is handled by \s*.
  const names = new Map();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/\b([A-Z][A-Z0-9_]*)\s*[:=]\s*(["'`])((?:zen|apps|browser)\.[\w.\-]+)\2/g))
      if (!names.has(m[1])) names.set(m[1], m[3]);
  }
  return names;
}

function scan() {
  const schema = loadSchema();
  const mismatches = [];
  const files = walk(root).filter(
    (f) => /\.(js|mjs)$/.test(f) && !/\.standalone\.uc\.js$/.test(f),
  );
  const globalNames = collectNames(files);
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    // A bare constant (PREF) is resolved inside its own file only: many modules reuse the name.
    // A dotted reference (EXT_PREFS.PUSH_PAGE) may come from another module's context object.
    const local = collectNamesFrom([file]);

    // createSliderRow(label, sublabel, KEY, min, max, default, ...): the 6th argument is the default.
    const sliderRe = /createSliderRow\(\s*(?:"[^"]*"|`[^`]*`)\s*,\s*(?:"[^"]*"|`[^`]*`)\s*,\s*([\w$.]+)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*[,)]/g;
    for (const m of src.matchAll(sliderRe)) {
      const key = m[1].includes(".") ? local.get(m[1].split(".").pop()) || globalNames.get(m[1].split(".").pop()) : local.get(m[1]);
      if (!key || !schema.has(key) || typeof schema.get(key) !== "number") continue;
      if (Number(m[4]) === schema.get(key)) continue;
      mismatches.push({ key, schema: schema.get(key), code: Number(m[4]), file: path.relative(root, file), line: src.slice(0, m.index).split("\n").length, slider: true });
    }
    const callRe = new RegExp("\\b(?:" + READERS + ")\\(\\s*([^,()]+?)\\s*,\\s*([^,()]+?)\\s*\\)", "g");
    for (const m of src.matchAll(callRe)) {
      const keyExpr = m[1].trim();
      let key;
      const lit = /^(["'`])(.+)\1$/.exec(keyExpr);
      if (lit) key = lit[2];
      else if (keyExpr.includes(".")) key = local.get(keyExpr.split(".").pop()) || globalNames.get(keyExpr.split(".").pop());
      else key = local.get(keyExpr);
      if (!key || !schema.has(key)) continue;
      const fallback = literal(m[2]);
      if (fallback === undefined) continue;
      const want = schema.get(key);
      if (fallback === want) continue;
      const line = src.slice(0, m.index).split("\n").length;
      mismatches.push({ key, schema: want, code: fallback, file: path.relative(root, file), line });
    }
  }
  return mismatches;
}

if (require.main === module) {
  const found = scan();
  if (process.argv.includes("--json")) console.log(JSON.stringify(found, null, 2));
  else {
    for (const x of found)
      console.log(`${x.file}:${x.line}  ${x.key}  schema=${JSON.stringify(x.schema)} code=${JSON.stringify(x.code)}`);
    console.log(found.length ? `${found.length} default mismatch(es)` : "defaults agree");
  }
  process.exit(found.length ? 1 : 0);
}
module.exports = { scan };
