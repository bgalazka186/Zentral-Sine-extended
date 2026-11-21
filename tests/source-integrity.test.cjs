"use strict";
/* Source integrity — the checkout itself must be shippable.
 *
 * Why this file exists: on 2026-11-20 the branch tip was a merge commit whose conflicted files were committed
 * WITH their markers still inside. Nothing in the suite looked at the source text as text, so the tree stayed
 * "green" while `additional/boost/ZentralBoost.uc.js` started with a literal `<<<<<<< HEAD` line. In the browser
 * `Services.scriptloader.loadSubScript()` cannot parse that, the loader records the row as `failed`, and the owner
 * sees `Memory Boost — FAILED` with only the loader frame in the details. Every other feature kept working, which
 * is exactly why nobody noticed: the damage is per file, not per tree.
 *
 * The three checks below are the cheap invariants that would have caught it before the push:
 *   1. no tracked text file contains a merge-conflict marker;
 *   2. every shipped script parses with the JS engine, as a script (fragments that legally use a top-level
 *      `return` are parsed as a function body instead);
 *   3. every file the loader catalog names really exists in the tree.
 *
 * They are deliberately about the checkout, not about behaviour: a syntax error anywhere in a shipped source is a
 * load failure at runtime and no behaviour test can run inside a module that never parsed.
 */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// ZENTRAL_SOURCE_ROOT lets a caller (or a RED proof) point the same checks at a detached checkout.
const ROOT = path.resolve(process.env.ZENTRAL_SOURCE_ROOT || path.join(__dirname, ".."));
const tracked = () =>
  execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const isText = (rel) => !fs.readFileSync(path.join(ROOT, rel)).includes(0);

// Only `<<<<<<<`, `>>>>>>>` and `|||||||` are markers. A bare `=======` is not: setext headings and rule lines
// in the docs use it legitimately, and the two markers around it are what make a conflict a conflict.
const MARKER = /^(?:<{7}|>{7}|\|{7})(?:\s|$)/;
// Shipped scripts. `.mjs` is excluded: ESM syntax cannot be parsed by `vm.Script` without a flag, and the two
// module files here are checked by the browser and by their own tests instead.
const SCRIPT = /\.(?:uc\.js|js)$/;
const FRAGMENT_DIRS = ["additional/", "extension/", "loader/", "zentral/"];

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("no tracked file contains a merge-conflict marker", () => {
  const marked = [];
  for (const rel of tracked()) {
    if (!isText(rel)) continue;
    const lines = read(rel).split("\n");
    for (let i = 0; i < lines.length; i++)
      if (MARKER.test(lines[i])) marked.push(`${rel}:${i + 1}: ${lines[i].slice(0, 40)}`);
  }
  assert.equal(marked.length, 0, "conflict markers are committed in:\n" + marked.join("\n"));
});

test("every shipped script parses", () => {
  const failures = [];
  let checked = 0;
  for (const rel of tracked()) {
    if (!SCRIPT.test(rel)) continue;
    if (!FRAGMENT_DIRS.some((dir) => rel.startsWith(dir))) continue;
    const src = read(rel);
    if (src.includes("\0")) continue;
    checked++;
    try {
      new vm.Script(src, { filename: rel });
    } catch (first) {
      // A few of these files are fragments injected with `return` at their top level; that is legal where they
      // are used and is not the syntax error this test is looking for.
      if (!/Illegal return statement/.test(first.message)) failures.push(`${rel}: ${first.message}`);
      else
        try {
          new vm.Script(`(function () {\n${src}\n})`, { filename: rel });
        } catch (second) {
          failures.push(`${rel}: ${second.message}`);
        }
    }
  }
  assert.ok(checked > 90, `expected the shipped script set, checked only ${checked}`);
  assert.equal(failures.length, 0, "sources that cannot parse:\n" + failures.join("\n"));
});

test("every file the loader catalog names exists in the tree", () => {
  const catalog = read("loader/ZentralCatalog.js");
  const refs = [...catalog.matchAll(/\b(?:file|css|source|path):\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const match of catalog.matchAll(/\bextraSources:\s*\[([^\]]*)\]/gs))
    refs.push(...[...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const paths = [...new Set(refs)].filter((p) => !/^[a-z]+:/i.test(p) && /\.[a-z0-9]+$/i.test(p));
  const missing = paths.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  assert.ok(paths.length > 40, `expected the catalog file list, found only ${paths.length}`);
  assert.equal(missing.length, 0, "catalog entries with no file:\n" + missing.join("\n"));
  // The one that actually broke: the runtime asks the catalog for a feature source and loads it by this path.
  assert.ok(paths.includes("additional/boost/ZentralBoost.uc.js"), "the Boost source stays in the catalog");
  assert.ok(paths.includes("additional/boost/ZentralBoostWidget.js"), "the Boost-owned widget source stays in the catalog");
  assert.ok(paths.includes("loader/ZentralSidebarMount.js"), "the shared safe mount selector stays in the catalog");
});

for (const [name, fn] of tests) {
  fn();
  passed++;
  console.log("ok -", name);
}
console.log(`\n${passed}/${tests.length} source-integrity tests passed`);
