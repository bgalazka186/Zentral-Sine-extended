"use strict";
// T4.5: the main mod and every standalone module carry ONE version (AGENTS.md "Version bumps").
// The repository itself is only read; the tool is exercised on a temporary copy.
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const test = require("node:test");
const { syncVersion, compare } = require("../tools/sync-version.cjs");
const ROOT = path.resolve(__dirname, "..");

test("the repository is on one version everywhere", () => {
  const result = syncVersion(ROOT, { check: true });
  assert.deepEqual(result.stale, [], "run: node tools/sync-version.cjs && node tools/build-standalone.cjs");
  assert.deepEqual(result.changed, [], "check mode never writes");
  const manifests = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else if (entry.name === "standalone.json") manifests.push(full);
    }
  })(path.join(ROOT, "additional"));
  assert.ok(manifests.length >= 10, "every standalone module is found");
  for (const file of manifests) {
    const dir = path.dirname(file), manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(manifest.version, result.target, path.relative(ROOT, file));
    // Generated files follow the manifest (the build writes them; nobody edits them by hand).
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "theme.json"), "utf8")).version, result.target, path.relative(ROOT, dir) + "/theme.json");
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "standalone.lock.json"), "utf8")).version, result.target, path.relative(ROOT, dir) + "/standalone.lock.json");
    assert.ok(fs.readFileSync(path.join(dir, manifest.output), "utf8").includes("// @version " + result.target + "\n"), path.relative(ROOT, dir) + "/" + manifest.output);
  }
});

function fixture(versions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zentral-version-"));
  const main = versions.main || "1.2.3";
  const put = (name, text) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), text); };
  put("theme.json", JSON.stringify({ id: "x", version: main, nested: { version: "9.9.9" } }, null, 2) + "\n");
  put("UPSTREAM.json", JSON.stringify({ extended_version: main, upstream_version: "1.1.0" }, null, 2) + "\n");
  put("loader/Zentral.uc.js", "// ==UserScript==\n// @version " + main + "\n// ==/UserScript==\n");
  put("loader/ZentralRuntime.js", "// @version " + main + "\n  const VERSION = \"" + main + "\";\n");
  put("extension/settings/controllers/ZentralSettingsShell.js", "<span class=\"zs-version-badge\">v" + main + "</span>\n");
  put("INSTALL.md", "# Installing Zentral Extended " + main + " — complete package\n");
  put(".github/README.md", "badge/Extended-" + main + "-6366f1\n\nExtended " + main + " uses Zentral 1.1.0 as its core reference.\n");
  put("additional/one/standalone.json", JSON.stringify({ id: "one", version: versions.one || main, minVersion: "1.2.3" }, null, 2) + "\n");
  put("additional/deep/two/standalone.json", JSON.stringify({ id: "two", version: versions.two || main }, null, 2) + "\n");
  put("additional/one/README.md", "# one\n\nOwner and local file guide for Extended 1.0.0. Original Zentral reference: 1.1.0.\n");
  put("zentral/README.md", "# zentral\n\nExtended 1.0.9 integrates original Zentral 1.1.0 behavior.\n");
  put("zentral/upstream/1.1.0/README.md", "Owner and local file guide for Extended 0.0.1.\n");
  put("docs/LEGACY_done_rows.md", "Extended 1.0.0 integrates nothing. Owner and local file guide for Extended 1.0.0.\n");
  put("TODO_notes_roadmap.md", "State: **1.0.0.**\n");
  return { dir, read: (name) => fs.readFileSync(path.join(dir, name), "utf8") };
}

test("the tool raises every place to the highest version and leaves history alone", () => {
  const f = fixture({ main: "1.2.3", one: "1.2.10", two: "1.2.4" });
  try {
    const drift = syncVersion(f.dir, { check: true });
    assert.equal(drift.target, "1.2.10", "versions compare numerically, not as text");
    assert.ok(drift.stale.length >= 10);
    assert.match(f.read("theme.json"), /"version": "1\.2\.3"/, "check mode writes nothing");
    const result = syncVersion(f.dir);
    assert.equal(result.target, "1.2.10");
    assert.equal(JSON.parse(f.read("theme.json")).version, "1.2.10");
    assert.equal(JSON.parse(f.read("theme.json")).nested.version, "9.9.9", "only the top-level version field changes");
    assert.equal(JSON.parse(f.read("UPSTREAM.json")).extended_version, "1.2.10");
    assert.equal(JSON.parse(f.read("UPSTREAM.json")).upstream_version, "1.1.0", "the upstream reference is not ours to change");
    assert.equal(f.read("loader/Zentral.uc.js").match(/@version (.*)/)[1], "1.2.10");
    assert.match(f.read("loader/ZentralRuntime.js"), /\/\/ @version 1\.2\.10\n  const VERSION = "1\.2\.10";/);
    assert.match(f.read("extension/settings/controllers/ZentralSettingsShell.js"), />v1\.2\.10</);
    assert.match(f.read("INSTALL.md"), /Extended 1\.2\.10 — complete package/);
    assert.match(f.read(".github/README.md"), /badge\/Extended-1\.2\.10-6366f1\n\nExtended 1\.2\.10 uses Zentral 1\.1\.0/);
    assert.equal(JSON.parse(f.read("additional/one/standalone.json")).version, "1.2.10");
    assert.equal(JSON.parse(f.read("additional/one/standalone.json")).minVersion, "1.2.3", "an unrelated field with the old value is untouched");
    assert.equal(JSON.parse(f.read("additional/deep/two/standalone.json")).version, "1.2.10");
    assert.match(f.read("additional/one/README.md"), /guide for Extended 1\.2\.10\. Original Zentral reference: 1\.1\.0\./);
    assert.match(f.read("zentral/README.md"), /Extended 1\.2\.10 integrates original Zentral 1\.1\.0/);
    assert.match(f.read("zentral/upstream/1.1.0/README.md"), /Extended 0\.0\.1/, "the pristine upstream snapshot is never edited");
    assert.match(f.read("docs/LEGACY_done_rows.md"), /Extended 1\.0\.0 integrates/, "frozen history is never edited");
    assert.match(f.read("TODO_notes_roadmap.md"), /1\.0\.0/);
    assert.deepEqual(syncVersion(f.dir, { check: true }).stale, []);
    assert.deepEqual(syncVersion(f.dir).changed, [], "a second run changes nothing");
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("--set raises to a chosen version and refuses to go backwards", () => {
  const f = fixture({ main: "1.2.3", one: "1.2.5" });
  try {
    assert.throws(() => syncVersion(f.dir, { set: "1.2.4" }), /lower than the highest version/);
    assert.throws(() => syncVersion(f.dir, { set: "1.3" }), /X\.Y\.Z/);
    assert.equal(JSON.parse(f.read("theme.json")).version, "1.2.3", "a refused request writes nothing");
    assert.equal(syncVersion(f.dir, { set: "1.3.0" }).target, "1.3.0");
    assert.equal(JSON.parse(f.read("additional/one/standalone.json")).version, "1.3.0");
    assert.equal(compare("1.2.10", "1.2.9"), 1); assert.equal(compare("1.2.3", "1.2.3"), 0); assert.equal(compare("1.9.9", "2.0.0"), -1);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("a missing version marker is an error, not a silent skip", () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.dir, "INSTALL.md"), "# Installing\n");
    assert.throws(() => syncVersion(f.dir, { check: true }), /INSTALL\.md: version marker not found/);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});
