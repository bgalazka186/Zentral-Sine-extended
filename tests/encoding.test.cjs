"use strict";
/* Text hygiene for every tracked source, data and doc file: valid UTF-8, no byte-order mark,
 * LF line endings, no double-encoded characters ("mojibake") and no replacement characters.
 * Generated Sine preferences must keep real characters, not escapes. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
// tools/ and .kilo/ describe mojibake literally (the fixer needs the broken sequences as data).
const SKIP = new Set([".git", ".kilo", "node_modules", "upstream", "patches", "docs", "tools"]);
const EXT = /\.(js|mjs|cjs|json|css|md|yml|txt)$/i;
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (EXT.test(e.name)) files.push(p);
  }
})(root);
// Typical double-encoding signatures: UTF-8 bytes read as Windows-1252/Latin-1 and re-encoded.
const MOJIBAKE = /\u00c3[\u0080-\u00bf\u0192\u201a\u2018-\u201e\u2020-\u2022\u2030\u2039\u0152\u2122\u0161\u203a\u0153\u017e\u0178]|\u00e2\u20ac|\u00c2[\u0080-\u00bf]|\ufffd/;
const problems = [];
for (const file of files) {
  const rel = path.relative(root, file);
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) problems.push(rel + ": byte-order mark");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (_) {
    problems.push(rel + ": not valid UTF-8");
    continue;
  }
  if (text.includes("\r")) problems.push(rel + ": CR / CRLF line endings");
  const m = MOJIBAKE.exec(text);
  if (m) problems.push(rel + ": double-encoded text near " + JSON.stringify(text.slice(Math.max(0, m.index - 12), m.index + 12)));
}
assert.deepEqual(problems, [], "\n" + problems.join("\n"));
for (const rel of ["preferences.json", ...fs.readdirSync(path.join(root, "additional"), { recursive: true }).filter((f) => f.endsWith("preferences.json")).map((f) => "additional/" + f)]) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  assert.ok(!/\\u[0-9a-fA-F]{4}/.test(text), rel + " must contain real characters, not \\u escapes");
}
console.log("ok - " + files.length + " text files are clean UTF-8 with LF endings and no mojibake");
