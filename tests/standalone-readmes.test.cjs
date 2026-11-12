"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const repo = "https://github.com/bgalazka186/Zentral-Sine-extended";
const manifests = fs.readdirSync(path.join(root, "additional"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(root, "additional", entry.name, "standalone.json"))
  .filter((file) => fs.existsSync(file));

assert.ok(manifests.length > 0, "at least one standalone package must be documented");
for (const manifestFile of manifests) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const dir = path.dirname(manifestFile);
  const readmeFile = path.join(dir, "README.md");
  assert.ok(fs.existsSync(readmeFile), `${manifest.id}: standalone README exists`);
  const readme = fs.readFileSync(readmeFile, "utf8");
  const folder = path.basename(dir);
  assert.ok(readme.includes(`${repo}/tree/main/additional/${folder}`), `${manifest.id}: README links to the exact Sine folder URL`);
  assert.ok(/sine\.allow-unsafe-js/.test(readme), `${manifest.id}: README names the unofficial-JS permission`);
  assert.ok(/restart Zen/i.test(readme), `${manifest.id}: README explains the first-install restart`);
  assert.ok(/full pack|Zentral Extended/i.test(readme), `${manifest.id}: README explains full-pack ownership`);
  console.log(`ok - ${manifest.id}: standalone installation is documented`);
}
console.log(`\n${manifests.length} standalone README tests passed`);
