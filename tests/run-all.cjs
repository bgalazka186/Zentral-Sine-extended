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
const TIME_ZONES = Object.freeze(["UTC", "Europe/Warsaw", "America/Los_Angeles", "Pacific/Auckland"]);
const TIMEZONE_TEST_FILE = /^notes-(?:agenda|calendar|reminder|recurrence|missed-digest|p2|cycle-[fg])(?:[-.]|$)/i;
const { calibration } = require("./helpers/perf-budget.cjs");

const isPerfFile = file => PERF_FILE.test(path.basename(file)) || SERIAL_PERF_TESTS.has(path.basename(file));
const isTimezoneFile = file => TIMEZONE_TEST_FILE.test(path.basename(file)) && !isPerfFile(file);
const resultName = result => (path.relative(ROOT, result.file) || path.basename(result.file)) + (result.timeZone ? " [TZ=" + result.timeZone + "]" : "");

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

function runFile(file, perf = false, envOverrides = {}) {
  return new Promise(resolve => {
    const started = process.hrtime.bigint();
    const env = { ...process.env, ...envOverrides };
    if (perf) env.ZENTRAL_PERF_BUDGET_SCALE = String(calibration.scale);
    const child = spawn(process.execPath, [file], {
      cwd: ROOT,
      env,
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

async function runParallel(files, limit, envOverrides = {}) {
  const results = new Array(files.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, files.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= files.length) return;
      results[index] = await runFile(files[index], false, envOverrides);
    }
  });
  await Promise.all(workers);
  return results;
}

function failureDetails(result) {
  const output = result.stdout + "\n" + result.stderr;
  const lines = output.split(/\r?\n/);
  const errorIndex = lines.findIndex(line =>
    /(?:AssertionError(?: \[[^\]]+\])?|TypeError|ReferenceError|SyntaxError|RangeError|Error):/.test(line) &&
    !/^\s*\[ZentralNotes\]/.test(line));
  const tapIndex = lines.findIndex(line => /^\s*not ok \d+\s+-/.test(line));
  const failIndex = lines.findIndex(line => /^\s*FAIL(?:\s|:)/.test(line));
  const messageIndex = errorIndex >= 0 ? errorIndex : tapIndex >= 0 ? tapIndex : failIndex;
  let message = messageIndex >= 0 ? lines[messageIndex].trim() : "";

  // Node's TAP reporter puts assertion messages in a YAML "error:" field
  // below the "not ok" row rather than on the first line.
  if (tapIndex >= 0) {
    const tapEnd = lines.findIndex((line, index) => index > tapIndex && /^\s*\.\.\.\s*$/.test(line));
    const block = lines.slice(tapIndex + 1, tapEnd < 0 ? tapIndex + 35 : tapEnd);
    const detailIndex = block.findIndex(line => /^\s*error:\s*/.test(line));
    if (detailIndex >= 0) {
      const header = block[detailIndex];
      let detail = header.replace(/^\s*error:\s*/, "").trim();
      if (!detail || detail === "|-" || detail === "|") {
        const indent = (header.match(/^\s*/) || [""])[0].length;
        const body = [];
        for (const line of block.slice(detailIndex + 1)) {
          if (!line.trim()) { if (body.length) body.push(""); continue; }
          const lineIndent = (line.match(/^\s*/) || [""])[0].length;
          if (lineIndent <= indent) break;
          body.push(line.trim());
        }
        detail = body.find(Boolean) || "";
      }
      if (detail) message += " — " + detail.replace(/^['"]|['"]$/g, "");
    }
  } else if (message && /:$/.test(message)) {
    const continuation = lines.slice(messageIndex + 1).find(line => line.trim() && !/^\s*at\s/.test(line));
    if (continuation) message += " " + continuation.trim();
  }
  if (!message) message = result.error ? result.error.message : result.signal ? "Process terminated by " + result.signal : "Test process exited with code " + result.code;

  let location = null;
  for (let i = Math.max(0, messageIndex); i < lines.length; i++) {
    const match = lines[i].match(/(?:^|\/)((?:tests|additional|tools)\/[^():\s]+):(\d+):(\d+)/);
    if (match) { location = { file: match[1], line: Number(match[2]), column: Number(match[3]) }; break; }
  }
  if (!location) {
    for (const line of lines) {
      const match = line.match(/(?:^|\/)((?:tests|additional|tools)\/[^():\s]+):(\d+):(\d+)/);
      if (match) { location = { file: match[1], line: Number(match[2]), column: Number(match[3]) }; break; }
    }
  }
  return { message: message.slice(0, 500), location };
}

function commandEscape(value) {
  return String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function printFailureSummary(failed, passed, total, totalMs) {
  process.stderr.write("\n========== REGRESSION FAILURE DETAILS ==========\n");
  for (const result of failed) {
    const name = resultName(result);
    const detail = failureDetails(result);
    const location = detail.location;
    process.stderr.write("FAIL: " + name + "\n");
    process.stderr.write("  What failed: " + detail.message + "\n");
    if (location) process.stderr.write("  Source: " + location.file + ":" + location.line + ":" + location.column + "\n");
    process.stderr.write("  Process: exit " + result.code + (result.signal ? " / " + result.signal : "") + "\n");
    const props = location ? " file=" + commandEscape(location.file) + ",line=" + location.line + ",col=" + location.column : "";
    process.stdout.write("::error" + props + " title=" + commandEscape(name + " failed") + "::" + commandEscape(detail.message) + "\n");
  }
  process.stderr.write("================================================\n");

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const rows = failed.map(result => {
      const detail = failureDetails(result), name = resultName(result);
      const source = detail.location ? detail.location.file + ":" + detail.location.line + ":" + detail.location.column : "See full log";
      return "| **" + name + "** | " + detail.message.replace(/\|/g, "\\|") + " | " + source + " | " + result.code + " |";
    });
    const markdown = [
      "## Regression test failure details",
      "",
      "**" + failed.length + " failed** · " + passed + "/" + total + " test files passed · " + (totalMs / 1000).toFixed(1) + " s combined runtime",
      "",
      "| Test file | Failure | Source location | Exit |",
      "| --- | --- | --- | ---: |",
      ...rows,
      "",
      "The full assertion and stack trace remain in the **Run regression suite** job log, grouped by test file.",
      "",
    ].join("\n");
    try { fs.appendFileSync(summaryPath, markdown); }
    catch (error) { process.stderr.write("Could not write GitHub step summary: " + error.message + "\n"); }
  }
}

function printResult(result) {
  const name = resultName(result);
  const github = process.env.GITHUB_ACTIONS === "true";
  if (github) process.stdout.write("::group::" + name + ": " + (result.code === 0 ? "PASS" : "FAIL") + " (" + result.durationMs.toFixed(0) + " ms)\n");
  else process.stdout.write("\n=== " + name + ": " + (result.code === 0 ? "PASS" : "FAIL") + " (" + result.durationMs.toFixed(0) + " ms) ===\n");
  if (result.stdout) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : result.stdout + "\n");
  if (result.stderr) process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : result.stderr + "\n");
  if (result.error) process.stderr.write("Could not start " + name + ": " + result.error.message + "\n");
  if (result.signal) process.stderr.write(name + " terminated by " + result.signal + "\n");
  if (github) process.stdout.write("::endgroup::\n");
}

async function runTimezoneMatrix(files) {
  const selected = files.filter(isTimezoneFile);
  if (!selected.length) {
    process.stderr.write("No calendar, Agenda, reminder or recurrence tests found for the timezone matrix.\n");
    process.exitCode = 1;
    return;
  }
  const results = [];
  process.stdout.write("Timezone matrix: " + TIME_ZONES.join(", ") + "\n");
  process.stdout.write("Selected " + selected.length + " non-performance test files.\n");
  for (const timeZone of TIME_ZONES) {
    process.stdout.write("\n===== TZ=" + timeZone + " =====\n");
    const zoneResults = await runParallel(selected, WORKERS, { TZ: timeZone });
    for (const result of zoneResults) {
      const labelled = { ...result, timeZone };
      printResult(labelled);
      results.push(labelled);
    }
    const failed = zoneResults.filter(result => result.code !== 0);
    process.stdout.write("TZ=" + timeZone + ": " + (zoneResults.length - failed.length) + "/" + zoneResults.length + " passed; " + failed.length + " failed\n");
  }
  const failed = results.filter(result => result.code !== 0);
  const todos = results.flatMap(result => result.todos.map(item => ({ ...item, timeZone: result.timeZone })));
  const passed = results.length - failed.length;
  const totalMs = results.reduce((sum, result) => sum + result.durationMs, 0);
  process.stdout.write("\nTimezone matrix files: " + passed + "/" + results.length + " passed; " + failed.length + " failed across " + TIME_ZONES.length + " zones (" + (totalMs / 1000).toFixed(1) + " s combined runtime)\n");
  process.stdout.write(todos.length + " TODO failing: " + (todos.length ? todos.map(item => item.file + " [TZ=" + item.timeZone + "]: " + item.name).join("; ") : "none") + "\n");
  if (failed.length) {
    process.stderr.write("Failed timezone files: " + failed.map(resultName).join(", ") + "\n");
    printFailureSummary(failed, passed, results.length, totalMs);
    process.exitCode = 1;
  }
}

async function main() {
  const files = discover();
  if (!files.length) {
    process.stderr.write("No tests found in " + TEST_DIR + " (expected *.test.cjs)\n");
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--tz")) {
    await runTimezoneMatrix(files);
    return;
  }

  const isPerf = isPerfFile;
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
    printFailureSummary(failed, passed, results.length, totalMs);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error("Test runner failed:", error);
  process.exitCode = 1;
});
