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
      "test('deliberately failing fixture', () => { throw new Error('expected failure'); });",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureDir, "todo.test.cjs"), [
      "const test = require('node:test');",
      "test('deliberately unfinished fixture', { todo: 'fixture TODO' }, () => {});",
      "",
    ].join("\n"));

    const runner = path.join(__dirname, "run-all.cjs");
    const result = spawnSync(process.execPath, [runner], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, ZENTRAL_TEST_DIR: fixtureDir },
      encoding: "utf8",
      timeout: 15000,
    });
    const output = (result.stdout || "") + "\n" + (result.stderr || "");
    assert.ifError(result.error);
    assert.equal(result.status, 1, output);
    assert.match(output, /1 failed/);
    assert.match(output, /1 TODO failing: todo\.test\.cjs: deliberately unfinished fixture/);
    assert.match(output, /Failed files: failing\.test\.cjs/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});
