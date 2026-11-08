#!/usr/bin/env node
/* Fix encoding issues in standalone.json files: Â· -> ·, â€” -> — */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const additionalDir = path.join(root, "additional");

function findStandaloneJson(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findStandaloneJson(full));
    } else if (entry.name === "standalone.json") {
      results.push(full);
    }
  }
  return results;
}

function fixEncoding(str) {
  return str
    .replace(/Â·/g, "·")
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–");
}

const files = findStandaloneJson(additionalDir);

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  const fixed = fixEncoding(raw);
  if (fixed !== raw) {
    fs.writeFileSync(file, fixed, "utf8");
    console.log(`Fixed: ${path.relative(root, file)}`);
  } else {
    console.log(`OK: ${path.relative(root, file)}`);
  }
}

console.log("\nDone.");
