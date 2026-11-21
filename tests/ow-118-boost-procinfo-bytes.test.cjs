"use strict";
/* Owner bug 4 (2026-11-18): Boost reported `3202756,6 GB`. Firefox ProcInfo.memory is BYTES,
 * while the widget takes MEGABYTES. The old meter summed bytes and published them as MB; a 3.2 GB
 * browser therefore became 3.2 million "MB" and the card switched to "3.2 million GB". This suite
 * runs the real Boost source with realistic byte fixtures and the real widget formatter. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeStandaloneBoostHarness } = require("./helpers/fake-standalone-boost-harness.cjs");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const MB = 1_000_000;

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function boot({ procs = [{ memory: 100 * MB, children: [{ memory: 50 * MB }, { memory: 25 * MB }] }] } = {}) {
  const timers = new Map();
  const listeners = new Map();
  const warnings = [];
  const prefs = new Map();
  let timerId = 0;
  let procIndex = 0;
  let registration = null;
  const Services = {
    prefs: {
      getBoolPref: (key, fallback) => (prefs.has(key) ? Boolean(prefs.get(key)) : fallback),
      getIntPref: (key, fallback) => (prefs.has(key) ? Number(prefs.get(key)) : fallback),
      getStringPref: (key, fallback) => (prefs.has(key) ? String(prefs.get(key)) : fallback),
      setBoolPref: (key, value) => prefs.set(key, !!value),
      setIntPref: (key, value) => prefs.set(key, Number(value)),
      setStringPref: (key, value) => prefs.set(key, String(value)),
      prefHasUserValue: (key) => prefs.has(key),
      getPrefType: () => 0,
      addObserver() {}, removeObserver() {},
    },
    obs: { addObserver() {}, removeObserver() {}, notifyObservers() {} },
  };
  const gBrowser = { tabs: [], getTabsWithoutMediaBlocked: () => [] };
  const Cc = {
    "@mozilla.org/memory-reporter-manager;1": {
      getService: () => ({ minimizeMemoryUsage(cb) { if (cb && typeof cb.run === "function") cb.run(); } }),
    },
  };
  const Ci = { nsIMemoryReporterManager: Symbol("nsIMemoryReporterManager") };
  const win = {
    Services, gBrowser, Cc, Ci,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback(cb) { cb({ didTimeout: false, timeRemaining: () => 10 }); return 1; },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    console: { warn: (...args) => warnings.push(args.map(String).join(" ")), log() {}, error() {} },
    ZentralRuntime: { register(def) { registration = def; } },
  };
  win.window = win;
  win.globalThis = { ...win, Services, SessionStore: {}, ChromeUtils: null };
  const ChromeUtils = {
    requestProcInfo() {
      const entry = procs[Math.min(procIndex, procs.length - 1)];
      procIndex += 1;
      return entry;
    },
    forceGC() {}, forceCC() {},
    importESModule: () => ({ Services }),
  };
  win.globalThis.ChromeUtils = ChromeUtils;
  const context = vm.createContext({
    ...win, ChromeUtils, Cc, Ci, console: win.console, Promise, Set, Map, WeakMap, WeakSet,
    Array, Object, Number, Math, String, Boolean, Symbol, Error, TypeError, Date, JSON, RegExp, URL, Intl,
    navigator: { platform: "Linux" }, globalThis: win.globalThis,
  });
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  assert.ok(registration?.init, "Boost registers a feature with init");
  const destroy = registration.init();
  const api = win.ZentralBoost;
  assert.ok(api, "Boost publishes its API");
  return { win, api, warnings, destroy };
}

test("a realistic byte reading is converted once to MB and the Boost-owned card formats a few GB", async () => {
  const h = await createFakeStandaloneBoostHarness({
    instrumentApi: null,
    procInfo: { memory: 3_000_000_000, children: [{ memory: 202_756_600 }] },
  }).boot();
  try {
    const mb = h.api().memoryMB();
    assert.equal(mb, 3203, "3,202,756,600 bytes is 3203 MB");
    const value = h.card()?.querySelector(".zbw-value");
    assert.ok(value, "the Boost-owned widget displays the converted reading");
    assert.equal(value.textContent, "3.2 GB");
    assert.equal(value.getAttribute("data-zbw-level"), "ok");
    assert.equal(h.card().getAttribute("data-zbw-value"), "3203");
    assert.equal(value.textContent.includes("3202756"), false, "the old 3202756,6 GB reading is gone");
  } finally {
    h.destroy();
  }
});

test("parent and child byte values are summed before conversion, and a malformed report is still null", () => {
  const h = boot();
  assert.equal(h.api.memoryMB(), 175, "100 + 50 + 25 MB");
  assert.equal(h.api.memoryMB(), 175, "a fresh reading is stable");
  h.destroy();
  const bad = boot({ procs: [{ memory: NaN, children: [{ memory: "x" }] }, null] });
  assert.equal(bad.api.memoryMB(), null, "nothing to add up is not 0 MB");
  bad.destroy();
});

test("an async ProcInfo promise also publishes converted MB", async () => {
  const h = boot({ procs: [Promise.resolve({ memory: 750 * MB, children: [{ memory: 250 * MB }] })] });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.api.lastMB(), 1000, "the resolved parent + child byte total is recorded as 1000 MB");
  h.destroy();
});

test("source, generated standalone and docs agree that ProcInfo.memory is bytes", () => {
  const src = read("additional/boost/ZentralBoost.uc.js");
  const standalone = read("additional/boost/ZentralBoost.standalone.uc.js");
  const readme = read("additional/boost/README.md");
  const plan = read("docs/PLAN_CODING_AGENT.md");
  assert.match(src, /PROC_MEMORY_BYTES_PER_MB = 1_000_000/);
  assert.match(src, /total \/ PROC_MEMORY_BYTES_PER_MB/, "the conversion happens in memoryMBFrom");
  assert.match(standalone, /PROC_MEMORY_BYTES_PER_MB = 1_000_000/, "the generated standalone has the rebuilt source");
  assert.match(readme, /bytes/i);
  assert.match(plan, /bytes/i);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-118-boost-procinfo-bytes (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
