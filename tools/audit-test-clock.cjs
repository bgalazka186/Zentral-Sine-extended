#!/usr/bin/env node
"use strict";
/* F0.16: find tests whose result depends on the hour of the day.
 *
 * A test that builds its fixture from `Date.now()` passes in the afternoon and fails at 23:55, or at 00:05 in another
 * zone. This tool runs a test file at three awkward instants in each of the four zones the suite already uses, with the
 * global clock pinned by `tests/helpers/fake-clock-preload.cjs`, and reports a file whose result *differs between the
 * instants*. That comparison is the whole point: a file that fails at every instant has a problem of its own (and the
 * suite already sees it); a file that fails only at some hours is what this is looking for.
 *
 *   node tools/audit-test-clock.cjs              # every file that reads the real clock
 *   node tools/audit-test-clock.cjs a.test.cjs   # just those
 *   node tools/audit-test-clock.cjs --list       # what it would run
 *
 * Exit code 1 if any file's result depends on the hour. Not part of the test suite: it takes minutes, and it is a
 * sweep, not a gate (the suite's own regression list is the gate).
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
// A caller may point the sweep at another folder of test-shaped files (the suite's own test does, so it never writes
// into `tests/` while the runner is reading it).
const TEST_DIR = process.env.ZENTRAL_TEST_DIR ? path.resolve(process.env.ZENTRAL_TEST_DIR) : path.join(ROOT, "tests");
// The preload belongs to this repository, never to the folder being swept.
const PRELOAD = path.join(ROOT, "tests", "helpers", "fake-clock-preload.cjs");
const ZONES = ["UTC", "Europe/Warsaw", "America/Los_Angeles", "Pacific/Auckland"];
// 23:55 and 00:05 catch a fixture that reasons about "tomorrow"; 03:30 catches a DST-shift morning in a European zone.
const INSTANTS = ["2026-11-17T23:55:00Z", "2026-11-18T00:05:00Z", "2026-11-18T03:30:00Z"];
const TIMEOUT_MS = Math.max(30000, Number(process.env.ZENTRAL_TEST_TIMEOUT_MS) || 240000);

// A file is a candidate when it reads the real clock at all. Reading it is not a fault by itself: the sweep is what
// decides, by running it at hours it was never written for. A file that already pins its own clock (CLOCK_START,
// FixedDate, a fake `Date`) is skipped — overriding it from outside would be measuring this tool, not the test.
const CLOCK = /Date\.now\(\)|new Date\(\s*\)/;
const PINNED = /CLOCK_START|FixedDate|FakeDate|setSystemTime/;
function clockSensitive() {
  return fs.readdirSync(TEST_DIR)
    .filter((name) => name.endsWith(".test.cjs"))
    .filter((name) => { const text = fs.readFileSync(path.join(TEST_DIR, name), "utf8"); return CLOCK.test(text) && !PINNED.test(text); })
    .sort();
}

const args = process.argv.slice(2);
if (args.includes("--list")) {
  const files = clockSensitive();
  console.log(files.length + " clock-sensitive test file(s):");
  for (const file of files) console.log("  " + file);
  process.exit(0);
}
const only = args.filter((a) => a.endsWith(".cjs")).map((a) => path.basename(a));
const files = only.length ? only : clockSensitive();

const runOnce = (file, zone, instant) => {
  const result = spawnSync(process.execPath, ["--require", PRELOAD, path.join(TEST_DIR, file)], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env: { ...process.env, TZ: zone, FAKE_NOW_ISO: instant, ZENTRAL_TEST_TIMEOUT_MS: String(TIMEOUT_MS) },
  });
  const output = String(result.stderr || "") + String(result.stdout || "");
  const line = output.split("\n").find((l) => /AssertionError|FAIL |Error:/.test(l)) || "";
  return { ok: result.status === 0, why: line.trim().slice(0, 200) };
};

let checked = 0;
const hourDependent = [], alwaysFailing = [];
for (const file of files) {
  if (!fs.existsSync(path.join(TEST_DIR, file))) { hourDependent.push({ file, why: "missing" }); continue; }
  let passed = 0, failed = 0, example = null;
  for (const zone of ZONES) {
    for (const instant of INSTANTS) {
      checked++;
      const { ok, why } = runOnce(file, zone, instant);
      if (ok) { passed++; continue; }
      failed++;
      if (!example) example = { file, zone, instant, why };
    }
  }
  if (!failed) { process.stdout.write("ok   " + file + "\n"); continue; }
  if (!passed) {
    // Fails everywhere: the file has a problem of its own, and the suite already sees it at the real clock.
    alwaysFailing.push({ file, why: example.why, runs: failed });
    process.stdout.write("same " + file + " (fails at every instant: not an hour problem)\n");
    continue;
  }
  hourDependent.push(example);
  process.stdout.write("HOUR " + file + " (" + failed + " of " + (passed + failed) + ")\n");
}

if (hourDependent.length) {
  console.error("\n" + hourDependent.length + " file(s) whose result depends on the hour:");
  for (const f of hourDependent) console.error("  " + f.file + "\n    " + (f.zone ? f.zone + " " + f.instant + " — " : "") + (f.why || ""));
}
if (alwaysFailing.length) {
  console.error("\n" + alwaysFailing.length + " file(s) fail at every instant (a real failure, not an hour problem):");
  for (const f of alwaysFailing) console.error("  " + f.file + " — " + f.why);
}
console.log("\n" + (files.length - hourDependent.length) + "/" + files.length + " files give the same result at every instant ("
  + checked + " runs, " + ZONES.length + " zones x " + INSTANTS.length + " instants).");
process.exit(hourDependent.length ? 1 : 0);
