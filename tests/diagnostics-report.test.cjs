"use strict";
/* "Copy diagnostics" (Settings > Logs & Diagnostics): an always-on support report. The runtime keeps a ring of short
 * notes and asks every registered reporter for its live state; page addresses are cut back to their site so a pasted
 * report never carries a path, query or id. The runtime is not bootable here, so the helper block and the report
 * method are cut out of the real source and run in a vm. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

const src = read("loader/ZentralRuntime.js");
const pre = src.slice(src.indexOf("  // ---- support report"), src.indexOf("  const runtime = (window.ZentralRuntime = {"));
const method = src.slice(src.indexOf("    diagnosticsReport() {"), src.indexOf("    copyDiagnostics() {"));
assert.ok(pre.length > 500 && method.length > 500, "the helper block and the report method were found");

function make({ records = [], warnings = [] } = {}) {
  const warns = [];
  const ctx = vm.createContext({
    console: { warn: (...a) => warns.push(a.map(String).join(" ")), log() {}, error() {} },
    URL, Date, JSON, Map, String, Error,
    VERSION: "9.9.9",
    Services: { appinfo: { name: "Zen", version: "1.2", OS: "WINNT" } },
    startupStage: "ready", activationReady: true,
    records: new Map(records.map((r) => [r.id, r])), enabled: () => true,
  });
  vm.runInContext(`const runtime = { nativeReadinessWarnings: ${JSON.stringify(warnings)} };
    ${pre}
    globalThis.api = { noteDiagnostic, registerDiagnosticReporter, ${method} };`, ctx);
  return { api: ctx.api, warns };
}

test("the report names the version, stage, every file and its error", () => {
  const { api } = make({ records: [{ id: "panels", state: "ready" }, { id: "widgets", state: "failed", error: new Error("boom") }] });
  const text = api.diagnosticsReport();
  assert.match(text, /Zentral 9\.9\.9 diagnostics/);
  assert.match(text, /Browser: Zen 1\.2 \(WINNT\)/);
  assert.match(text, /Start-up stage: ready \(ready\)/);
  assert.match(text, /^panels: ready$/m);
  assert.match(text, /^widgets: failed · boom$/m);
});

test("notes are kept newest last, capped at 100, and addresses lose their path and query", () => {
  const { api } = make();
  for (let i = 0; i < 130; i++) api.noteDiagnostic("T", "note " + i);
  api.noteDiagnostic("Triple View", "lower panel blank https://mail.example.com/u/0/inbox?token=SECRET#frag", { url: "https://chat.example.org/c/abc-123?x=1" });
  const text = api.diagnosticsReport();
  assert.equal((text.match(/\[T\] note /g) || []).length, 99, "the ring keeps the newest 100 notes (99 + the last one)");
  assert.doesNotMatch(text, /note 0\b|note 29\b/, "the oldest are gone");
  assert.match(text, /https:\/\/mail\.example\.com\/…/);
  assert.match(text, /https:\/\/chat\.example\.org\/…/);
  assert.doesNotMatch(text, /SECRET|inbox|abc-123|token/, "no path, query or id survives");
});

test("reporters print their live state; a broken one is reported, not thrown", () => {
  const { api, warns } = make();
  const off = api.registerDiagnosticReporter("Panels", () => '{"mode":"triple","url":"file:///C:/Users/me/a.html"}');
  api.registerDiagnosticReporter("Broken", () => { throw new Error("nope"); });
  let text = api.diagnosticsReport();
  assert.match(text, /== Panels ==\n\{"mode":"triple","url":"file:\/\/\(path hidden\)"\}/);
  assert.match(text, /== Broken ==\n\(reporter failed: nope\)/);
  assert.ok(warns.some((w) => /Diagnostics reporter failed/.test(w)), "and the console hears of it");
  off();
  text = api.diagnosticsReport();
  assert.doesNotMatch(text, /== Panels ==/, "a feature that unloads takes its reporter with it");
  assert.equal(api.registerDiagnosticReporter("", () => 1)(), undefined, "junk registrations are ignored");
});

test("the runtime publishes it, and Settings and the Triple View use it", () => {
  assert.match(src, /noteDiagnostic,\n\s+registerDiagnosticReporter,/, "published on window.ZentralRuntime");
  assert.match(src, /copyDiagnostics\(\) \{[\s\S]*?copyString\(text\)/, "copyDiagnostics puts the report on the clipboard");
  const shell = read("extension/settings/controllers/ZentralSettingsShell.js");
  assert.match(shell, /id="zs-btn-copy-diagnostics"/, "a Copy button in Logs & Diagnostics");
  assert.match(shell, /ZentralRuntime\?\.copyDiagnostics\?\.\(\)/, "wired to the runtime, not to the logger (it works with logging off)");
  const panels = read("extension/panels/secondary-views/ZentralSecondaryViews.uc.js");
  assert.match(panels, /registerDiagnosticReporter\?\.\(\s*"Panels · Triple View"/, "the Triple View reports its live state");
  assert.match(panels, /noteDiagnostic\?\.\("Triple View"/, "and its recoveries");
});

console.log(`\n${passed} passed`);
