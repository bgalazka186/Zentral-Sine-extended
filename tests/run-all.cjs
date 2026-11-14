#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TEST_DIR = path.resolve(process.env.ZENTRAL_TEST_DIR || __dirname);
const WORKERS = 4;
const PERF_FILE = /(?:^|[-.])perf(?:[-.]|$)/i;
const SERIAL_PERF_TESTS = new Set(["notes-agenda-projection.test.cjs"]);
const { calibration } = require("./helpers/perf-budget.cjs");

function discover() {
  return fs.readdirSync(TEST_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".test.cjs"))
    .map(entry => path.join(TEST_DIR, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function todoNames(output, file) {
  const found = [];
  const re = /^\s*(?:ok|not ok)\s+\d+\s+-\s+(.+?)\s+#\s*TODO(?:\s+(.*))?\s*$/gm;
  for (let match; (match = re.exec(output)); ) {
    found.push({ file: path.basename(file), name: match[1].trim(), reason: (match[2] || "").trim() });
  }
  return found;
}

function runFile(file, perf = false) {
  return new Promise(resolve => {
    const started = process.hrtime.bigint();
    const child = spawn(process.execPath, [file], {
      cwd: ROOT,
      env: perf ? { ...process.env, ZENTRAL_PERF_BUDGET_SCALE: String(calibration.scale) } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", spawnError = null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => { spawnError = error; });
    child.on("close", (code, signal) => {
      const output = stdout + (stderr ? "\n" + stderr : "");
      resolve({
        file,
        code: spawnError ? 1 : (code ?? 1),
        signal,
        error: spawnError,
        stdout,
        stderr,
        todos: todoNames(output, file),
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      });
    });
  });
}

async function runParallel(files, limit) {
  const results = new Array(files.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, files.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= files.length) return;
      results[index] = await runFile(files[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function printResult(result) {
  const name = path.relative(ROOT, result.file) || path.basename(result.file);
  process.stdout.write("\n=== " + name + ": " + (result.code === 0 ? "PASS" : "FAIL") + " (" + result.durationMs.toFixed(0) + " ms) ===\n");
  if (result.stdout) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : result.stdout + "\n");
  if (result.stderr) process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : result.stderr + "\n");
  if (result.error) process.stderr.write("Could not start " + name + ": " + result.error.message + "\n");
  if (result.signal) process.stderr.write(name + " terminated by " + result.signal + "\n");
}

async function main() {
  const files = discover();
  if (!files.length) {
    process.stderr.write("No tests found in " + TEST_DIR + " (expected *.test.cjs)\n");
    process.exitCode = 1;
    return;
  }

  const isPerf = file => PERF_FILE.test(path.basename(file)) || SERIAL_PERF_TESTS.has(path.basename(file));
  const perf = files.filter(isPerf);
  const regular = files.filter(file => !isPerf(file));
  const results = [];
  process.stdout.write("Performance calibration: " + calibration.elapsedMs.toFixed(2) + " ms / " + calibration.referenceMs.toFixed(2) + " ms; budget scale x" + calibration.scale.toFixed(2) + "\\n");

  // Keep performance measurements out of the concurrent batch. Ordinary tests
  // use four workers to shorten feedback without starting the whole suite at once.
  const parallelResults = await runParallel(regular, WORKERS);
  for (const result of parallelResults) { printResult(result); results.push(result); }
  for (const file of perf) {
    let result = await runFile(file, true);
    if (result.code !== 0) {
      process.stderr.write("Retrying isolated performance test once: " + path.basename(file) + "\\n");
      const retry = await runFile(file, true);
      if (retry.code === 0) {
        printResult(retry);
        result = { ...retry, retried: true };
        process.stdout.write("Recovered on isolated retry: " + path.basename(file) + "\\n");
      } else {
        printResult(result);
        printResult(retry);
      }
    } else printResult(result);
    results.push(result);
  }

  const failed = results.filter(result => result.code !== 0);
  const todos = results.flatMap(result => result.todos);
  const passed = results.length - failed.length;
  const totalMs = results.reduce((sum, result) => sum + result.durationMs, 0);
  const todoLabel = todos.length
    ? todos.map(item => item.file + ": " + item.name + (item.reason ? " (" + item.reason + ")" : "")).join("; ")
    : "none";

  process.stdout.write("\nTest files: " + passed + "/" + results.length + " passed; " + failed.length + " failed (" + (totalMs / 1000).toFixed(1) + " s combined runtime)\n");
  process.stdout.write(todos.length + " TODO failing: " + todoLabel + "\n");
  if (failed.length) {
    process.stderr.write("Failed files: " + failed.map(result => path.basename(result.file)).join(", ") + "\n");
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error("Test runner failed:", error);
  process.exitCode = 1;
});
