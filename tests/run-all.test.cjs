"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("run-all fails on a failing child and reports TODO tests", () => {
  const fixtureDir = fs.mkdtempSync(path.join(__dirname, ".tmp-run-all-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "failing.test.cjs"), [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "test('deliberately failing fixture', () => assert.equal(1, 2, 'fixture expected assertion'));",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureDir, "todo.test.cjs"), [
      "const test = require('node:test');",
      "test('deliberately unfinished fixture', { todo: 'fixture TODO' }, () => {});",
      "",
    ].join("\n"));

    const runner = path.join(__dirname, "run-all.cjs");
    const summaryFile = path.join(fixtureDir, "step-summary.md");
    const result = spawnSync(process.execPath, [runner], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, ZENTRAL_TEST_DIR: fixtureDir, GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summaryFile },
      encoding: "utf8",
      timeout: 15000,
    });
    const output = (result.stdout || "") + "\n" + (result.stderr || "");
    assert.ifError(result.error);
    assert.equal(result.status, 1, output);
    assert.match(output, /1 failed/);
    assert.match(output, /1 TODO failing: todo\.test\.cjs: deliberately unfinished fixture/);
    assert.match(output, /Failed files: failing\.test\.cjs/);
    assert.match(output, /REGRESSION FAILURE DETAILS/);
    assert.match(output, /fixture expected assertion/);
    assert.match(output, /failing\.test\.cjs:\d+:\d+/);
    assert.match(output, /::error file=.+failing\.test\.cjs,line=\d+/);
    const summary = fs.readFileSync(summaryFile, "utf8");
    assert.match(summary, /Regression test failure details/);
    assert.match(summary, /fixture expected assertion/);
    assert.match(summary, /failing\.test\.cjs:\d+:\d+/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("run-all stops a test file that never finishes and reports it as a failure", () => {
  const fixtureDir = fs.mkdtempSync(path.join(__dirname, ".tmp-run-all-hang-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "hanging.test.cjs"), 'console.log("output before the endless part");\nfor (;;) {}\n');
    fs.writeFileSync(path.join(fixtureDir, "passing.test.cjs"), 'console.log("ok - fixture that ends");\n');
    const started = Date.now();
    // The limit is what this test spends in wall time: the child runner waits the whole timeout before it stops the
    // file. At 2000 ms the self-test itself finished a few milliseconds over two seconds, which is the per-test budget
    // a CI reporter applies, so it reported "did not finish within 2 s" as a FAILURE OF THIS TEST rather than as the
    // message it was checking for. 1000 ms is the runner's own floor (`Math.max(1000, ...)`), proves exactly the same
    // thing, and halves the wait — the self-test stops being the slowest file in this directory.
    const LIMIT_MS = 1000;
    const result = spawnSync(process.execPath, [path.join(__dirname, "run-all.cjs")], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, ZENTRAL_TEST_DIR: fixtureDir, ZENTRAL_TEST_TIMEOUT_MS: String(LIMIT_MS) },
      encoding: "utf8",
      timeout: 60000,
    });
    const output = (result.stdout || "") + "\n" + (result.stderr || "");
    assert.ifError(result.error);
    assert.equal(result.status, 1, output);
    assert.ok(Date.now() - started < 30000, "the run ended soon after the limit");
    assert.match(output, /Test files: 1\/2 passed; 1 failed/);
    assert.match(output, /Failed files: hanging\.test\.cjs/);
    assert.match(output, new RegExp("What failed: Error: hanging\\.test\\.cjs did not finish within " + LIMIT_MS / 1000 + " s and was stopped\\."));
    assert.match(output, /compare them with ===/, "the message names the usual cause");
    assert.match(output, /output before the endless part/, "what the file printed before it stalled is kept");
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("run-all --tz runs calendar and reminder fixtures in the four declared zones only", () => {
  const fixtureDir = fs.mkdtempSync(path.join(__dirname, ".tmp-run-all-tz-"));
  try {
    fs.writeFileSync(path.join(fixtureDir, "notes-calendar-zone.test.cjs"), 'console.log("zone:" + process.env.TZ);\n');
    fs.writeFileSync(path.join(fixtureDir, "plain.test.cjs"), 'console.log("plain fixture must not run");\n');
    fs.writeFileSync(path.join(fixtureDir, "notes-calendar-perf.test.cjs"), 'console.log("perf fixture must not run");\n');
    const runner = path.join(__dirname, "run-all.cjs");
    const result = spawnSync(process.execPath, [runner, "--tz"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, ZENTRAL_TEST_DIR: fixtureDir },
      encoding: "utf8",
      timeout: 30000,
    });
    const output = (result.stdout || "") + "\n" + (result.stderr || "");
    assert.ifError(result.error);
    assert.equal(result.status, 0, output);
    for (const zone of ["UTC", "Europe/Warsaw", "America/Los_Angeles", "Pacific/Auckland"]) {
      assert.match(output, new RegExp("zone:" + zone));
      assert.match(output, new RegExp("TZ=" + zone));
    }
    assert.doesNotMatch(output, /plain fixture must not run/);
    assert.doesNotMatch(output, /perf fixture must not run/);
    assert.match(output, /Timezone matrix files: 4\/4 passed/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});
