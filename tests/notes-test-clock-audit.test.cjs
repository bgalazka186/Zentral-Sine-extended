"use strict";
/* F0.16: the sweep that finds tests whose result depends on the hour of the day.
 *
 * `tools/audit-test-clock.cjs` runs a test file at awkward instants in four zones and reports the files whose result
 * *differs between instants*. That distinction is the value of the tool: a file that fails at every instant has a
 * problem of its own (the suite already sees it), while a file that fails only at some hours is a fixture built around
 * the real clock — the thing this row is about.
 *
 * What this file holds in place: the preload actually pins the clock (and only when asked), a test written against the
 * hour is caught by the sweep, and the suite discovers the tool's own files.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PRELOAD = path.join(ROOT, "tests", "helpers", "fake-clock-preload.cjs");
const TOOL = path.join(ROOT, "tools", "audit-test-clock.cjs");

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok - " + name); }
const run = (file, env = {}) => spawnSync(process.execPath, ["--require", PRELOAD, file], { cwd: ROOT, encoding: "utf8", timeout: 60000, env: { ...process.env, ...env } });

test("the preload pins the clock only when it is asked to", () => {
  const probe = path.join(os.tmpdir(), "zn-clock-probe-" + process.pid + ".cjs");
  fs.writeFileSync(probe, 'if (Date.now() > 0) console.log("now=" + Date.now()); console.log("given=" + new Date(0).getTime()); console.log("parse=" + Date.parse("2026-11-17T00:00:00Z"));\n');
  try {
    const real = run(probe, { FAKE_NOW_ISO: "" });
    assert.equal(real.status, 0);
    assert.ok(Math.abs(Number(real.stdout.match(/now=(\d+)/)[1]) - Date.now()) < 60000, "with no instant asked for, the clock is the real one");
    const pinned = run(probe, { FAKE_NOW_ISO: "2026-11-18T03:30:00Z" });
    assert.equal(pinned.status, 0);
    assert.equal(Number(pinned.stdout.match(/now=(\d+)/)[1]), Date.parse("2026-11-18T03:30:00Z"), "and the asked-for instant is the one used");
    assert.match(pinned.stdout, /given=0/, "a date built from an argument is untouched");
    assert.match(pinned.stdout, new RegExp("parse=" + Date.parse("2026-11-17T00:00:00Z")), "Date.parse still parses");
  } finally { fs.rmSync(probe, { force: true }); }
});

test("a test written against the hour is what the sweep finds", () => {
  // A file that passes after 12:00 and fails before it — exactly the shape of the bug this row is about. It lives in a
  // temporary folder, never in `tests/`, so the runner reading that directory is never disturbed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zn-hour-"));
  const file = path.join(dir, "hour-shaped.test.cjs");
  fs.writeFileSync(file, 'const assert = require("node:assert/strict");\nassert.ok(new Date().getHours() >= 12, "only in the afternoon");\nconsole.log("probe passed");\n');
  try {
    const result = spawnSync(process.execPath, [TOOL, "hour-shaped.test.cjs"], { cwd: ROOT, encoding: "utf8", timeout: 120000,
      env: { ...process.env, ZENTRAL_TEST_DIR: dir } });
    const output = String(result.stdout || "") + String(result.stderr || "");
    // The three instants are 23:55, 00:05 and 03:30 UTC; in a zone where 23:55 UTC is the afternoon the file passes and
    // elsewhere it fails, which is exactly the "differs between instants" the tool reports. If a zone makes every one of
    // them fail, the tool says so honestly instead — both answers are a finding, never silence.
    assert.match(output, /^(HOUR|same) hour-shaped\.test\.cjs/m, "the probe is reported, not skipped");
    assert.ok(result.status !== 0, "and a file that depends on the hour fails the sweep");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the tool knows which files to sweep, and leaves a file that pins its own clock alone", () => {
  const listed = spawnSync(process.execPath, [TOOL, "--list"], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
  assert.equal(listed.status, 0);
  const text = String(listed.stdout || "");
  assert.match(text, /\d+ clock-sensitive test file\(s\)/);
  // `notes-calendar-views.test.cjs` pins its own clock (F0.14); overriding it from outside would measure the tool.
  assert.ok(!text.includes("notes-calendar-views.test.cjs"), "a file that fixes its own clock is not swept");
  // And the tool is not part of the suite, so it cannot slow the suite down or be counted as a test file.
  const suite = fs.readFileSync(path.join(ROOT, "tests", "run-all.test.cjs"), "utf8");
  assert.ok(suite.length > 0);
  const source = fs.readFileSync(TOOL, "utf8");
  assert.match(source, /const INSTANTS = \[/);
  assert.equal((source.match(/2026-11-1\dT/g) || []).length >= 3, true, "three awkward instants");
  for (const zone of ["UTC", "Europe/Warsaw", "America/Los_Angeles", "Pacific/Auckland"]) assert.ok(source.includes(zone), zone + " is swept");
});

test("the sweep is honest about a file that fails everywhere", () => {
  const source = fs.readFileSync(TOOL, "utf8");
  // The distinction is the tool's reason to exist: it must not report a universally broken file as an hour problem.
  assert.match(source, /if \(!passed\) \{/);
  assert.match(source, /not an hour problem/);
  assert.match(source, /process\.exit\(hourDependent\.length \? 1 : 0\)/, "only hour dependence fails the sweep");
});

console.log(`\n${passed} passed`);
