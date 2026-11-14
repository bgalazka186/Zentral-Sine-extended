"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("run-all fails on a failing child and reports TODO tests", () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "zentral-run-all-"));
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
