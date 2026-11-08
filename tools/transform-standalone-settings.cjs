#!/usr/bin/env node
/* Transform standalone settings.json:
 * - Convert dropdown -> string (free text, any value)
 * - Change input -> string
 * - Add validation for px (whole number) and % (decimal) fields
 * - Fix encoding issues (Â -> ·, â€” -> —)
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const additionalDir = path.join(root, "additional");

function findSettingsJson(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSettingsJson(full));
    } else if (entry.name === "settings.json") {
      results.push(full);
    }
  }
  return results;
}

function fixEncoding(str) {
  return str
    .replace(/Â·/g, "·")
    .replace(/â€”/g, "—")
    .replace(/Â/g, "")
    .replace(/â€/g, "");
}

function isPxField(label) {
  return /\(px\)/i.test(label);
}

function isPctField(label) {
  return /(%)/i.test(label) && !/px/i.test(label);
}

function isMsField(label) {
  return /\(ms\)/i.test(label);
}

const settingsFiles = findSettingsJson(additionalDir);

console.log(`Found ${settingsFiles.length} settings.json files under additional/`);

for (const file of settingsFiles) {
  const raw = fs.readFileSync(file, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`SKIP ${file}: JSON parse error: ${e.message}`);
    continue;
  }

  if (!data.schema || !Array.isArray(data.schema)) continue;

  let changed = false;

  for (const item of data.schema) {
    // Fix encoding in label
    if (item.label && /[Ââ€]/.test(item.label)) {
      item.label = fixEncoding(item.label);
      changed = true;
    }

    // Convert dropdown -> string
    if (item.type === "dropdown") {
      item.type = "string";
      delete item.options;
      changed = true;
      console.log(`  ${path.relative(root, file)}: dropdown->string: ${item.property}`);
    }

    // Convert input -> string
    if (item.type === "input") {
      item.type = "string";
      changed = true;
      console.log(`  ${path.relative(root, file)}: input->string: ${item.property}`);
    }

    // Add validation for px fields
    if (item.type === "string" && item.label && isPxField(item.label) && !item.validation) {
      item.validation = { mode: "integer", min: 0 };
      changed = true;
      console.log(`  ${path.relative(root, file)}: px validation: ${item.property}`);
    }

    // Add validation for % fields
    if (item.type === "string" && item.label && isPctField(item.label) && !item.validation) {
      item.validation = { mode: "number", min: 0, max: 100 };
      changed = true;
      console.log(`  ${path.relative(root, file)}: pct validation: ${item.property}`);
    }
  }

  if (changed) {
    // Fix encoding in the raw string level too (for any missed spots)
    const output = JSON.stringify(data, null, 2) + "\n";
    const fixedOutput = fixEncoding(output);
    fs.writeFileSync(file, fixedOutput, "utf8");
    console.log(`  Wrote: ${path.relative(root, file)}`);
  } else {
    console.log(`  No changes: ${path.relative(root, file)}`);
  }
}

console.log("\nDone.");
