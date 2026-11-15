#!/usr/bin/env node
/* Keep the main mod and every standalone module on ONE version (AGENTS.md "Version bumps").
 *
 * Usage: node tools/sync-version.cjs [--check] [--set X.Y.Z]
 *   (default) raise everything to the highest version found in theme.json or in any standalone.json under additional/
 *   --set     use this version instead (must not be lower than the highest one found)
 *   --check   change nothing; exit 1 and list every place that is not on the common version
 *
 * It edits only source files. Generated standalone files (theme.json, standalone.lock.json, *.standalone.uc.js of a
 * module) come from `node tools/build-standalone.cjs`, which must run after this tool:
 *   node tools/build-standalone.cjs --bump && node tools/sync-version.cjs && node tools/build-standalone.cjs
 * Frozen history (docs/LEGACY*, TODO_*) and the pristine upstream snapshot are never touched.
 */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");

const SEMVER = "\\d+\\.\\d+\\.\\d+";
const parse = (v) => String(v).split(".").map(Number);
const compare = (a, b) => {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};
const valid = (v) => new RegExp("^" + SEMVER + "$").test(String(v));

// Every place of the main mod that shows its version. `re` has one capture group: the version.
const MAIN_SPOTS = [
  { file: "theme.json", re: new RegExp('^(?:  )"version": "(' + SEMVER + ')"', "m") },
  { file: "UPSTREAM.json", re: new RegExp('"extended_version": "(' + SEMVER + ')"') },
  { file: "loader/Zentral.uc.js", re: new RegExp("^// @version (" + SEMVER + ")$", "m") },
  { file: "loader/ZentralRuntime.js", re: new RegExp("^// @version (" + SEMVER + ")$", "m") },
  { file: "loader/ZentralRuntime.js", re: new RegExp('const VERSION = "(' + SEMVER + ')";') },
  { file: "extension/settings/controllers/ZentralSettingsShell.js", re: new RegExp('<span class="zs-version-badge">v(' + SEMVER + ")</span>") },
  { file: "INSTALL.md", re: new RegExp("^# Installing Zentral Extended (" + SEMVER + ")", "m") },
  { file: ".github/README.md", re: new RegExp("badge/Extended-(" + SEMVER + ")-") },
  { file: ".github/README.md", re: new RegExp("^Extended (" + SEMVER + ") uses Zentral", "m") },
];
// Version citations in the local guides (README.md files next to the code).
const GUIDE_PATTERNS = [
  new RegExp("(Owner and local file guide for Extended )(" + SEMVER + ")", "g"),
  new RegExp("^(Extended )(" + SEMVER + ")(?=[;,] | integrates )", "gm"),
  new RegExp("^(Version: )(" + SEMVER + ")(?=\\.)", "gm"),
];
const SKIP_DIRS = new Set([".git", "node_modules", "upstream"]);

function walk(dir, keep, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, keep, out);
    else if (keep(entry.name)) out.push(full);
  }
  return out;
}

function syncVersion(root, { check = false, set = "" } = {}) {
  const rel = (file) => path.relative(root, file).split(path.sep).join("/");
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const manifests = walk(path.join(root, "additional"), (name) => name === "standalone.json").sort();
  const mainVersion = JSON.parse(read("theme.json")).version;
  const found = [mainVersion, ...manifests.map((file) => JSON.parse(fs.readFileSync(file, "utf8")).version)];
  for (const version of found) if (!valid(version)) throw new Error("Not a X.Y.Z version: " + version);
  let target = found.reduce((best, version) => (compare(version, best) > 0 ? version : best));
  if (set) {
    if (!valid(set)) throw new Error("--set needs a X.Y.Z version, got: " + set);
    if (compare(set, target) < 0) throw new Error("--set " + set + " is lower than the highest version in the repository (" + target + ")");
    target = set;
  }

  const stale = [], pending = new Map();
  const textOf = (file) => (pending.has(file) ? pending.get(file) : read(file));
  for (const spot of MAIN_SPOTS) {
    const text = textOf(spot.file), match = spot.re.exec(text);
    if (!match) throw new Error(spot.file + ": version marker not found (" + spot.re.source + ")");
    if (match[1] === target) continue;
    stale.push(spot.file + ": " + match[1]);
    const at = match.index + match[0].lastIndexOf(match[1]);
    pending.set(spot.file, text.slice(0, at) + target + text.slice(at + match[1].length));
  }
  for (const file of manifests) {
    const name = rel(file), text = textOf(name), manifest = JSON.parse(text);
    if (manifest.version === target) continue;
    stale.push(name + ": " + manifest.version);
    const re = new RegExp('("version":\\s*")' + manifest.version.replace(/\./g, "\\.") + '(")');
    if (!re.test(text)) throw new Error(name + ': "version" field not found');
    pending.set(name, text.replace(re, "$1" + target + "$2"));
  }
  const guides = walk(root, (name) => name === "README.md").map(rel).filter((name) => !/^docs\/LEGACY|^TODO_/.test(name));
  for (const name of guides) {
    let text = textOf(name), changed = false;
    for (const pattern of GUIDE_PATTERNS) {
      text = text.replace(pattern, (whole, lead, version) => {
        if (version === target) return whole;
        changed = true;
        stale.push(name + ": " + version);
        return lead + target;
      });
    }
    if (changed) pending.set(name, text);
  }
  if (!check) for (const [file, text] of pending) fs.writeFileSync(path.join(root, file), text);
  return { target, stale, changed: check ? [] : [...pending.keys()] };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const setAt = args.indexOf("--set");
  try {
    const result = syncVersion(path.resolve(__dirname, ".."), { check: args.includes("--check"), set: setAt >= 0 ? args[setAt + 1] || "" : "" });
    if (args.includes("--check")) {
      if (result.stale.length) {
        console.error("Version drift (expected " + result.target + "):\n  " + result.stale.join("\n  ") + "\nRun: node tools/sync-version.cjs && node tools/build-standalone.cjs");
        process.exitCode = 1;
      } else console.log("All versions are " + result.target);
    } else if (result.changed.length) {
      console.log("Version " + result.target + ": updated " + result.changed.length + " file(s). Now run: node tools/build-standalone.cjs");
    } else console.log("All versions are already " + result.target);
  } catch (error) {
    console.error(String(error.message || error));
    process.exitCode = 1;
  }
}
module.exports = { syncVersion, compare };
