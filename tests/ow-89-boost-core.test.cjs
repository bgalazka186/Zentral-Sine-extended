"use strict";
/* OW-89 (plan B2): the Boost core. Three claims, each measurable in Node against the real module source:
 *   1. the RAM reading is the sum of the parent and every child a browser reports, and a build that cannot answer
 *      disables the reading with one warning instead of throwing;
 *   2. Level 1 asks the memory reporter manager once, runs GC/CC, and returns the measured numbers ~3 s later; nothing
 *      is closed, unloaded or reloaded;
 *   3. the post-startup trim runs once, never twice, never while media plays, and is cancelled by destroy.
 * The module is run as a real registration against a fake chrome window, so the assertions are about the code that
 * ships, not a copy of it. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(REPO, "additional/boost/ZentralBoost.uc.js"), "utf8");

let passed = 0;
const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

/* ---------------- a fake chrome window ---------------- */

function boot({ prefs = {}, procs = [{ memory: 100, children: [{ memory: 50 }, { memory: 25 }] }], readings = null, manager = "ok", media = [] } = {}) {
  const store = new Map(Object.entries(prefs));
  const timers = new Map();
  let timerId = 0;
  const listeners = new Map();
  const warnings = [];
  const calls = { minimize: 0, gc: 0, cc: 0, sampleReads: 0 };
  let procIndex = 0;
  // init probes the build once, so the FIRST entry answers that probe; the reading under test starts at `probe` below.
  let registration = null;
  const idleCallbacks = [];

  const Services = {
    prefs: {
      getBoolPref: (key, fallback) => (store.has(key) ? Boolean(store.get(key)) : fallback),
      setBoolPref: (key, value) => store.set(key, value),
    },
    obs: { addObserver() {}, removeObserver() {} },
  };

  const gBrowser = {
    tabs: media,
    getTabsWithoutMediaBlocked: () => [],
  };

  const win = {
    Services,
    gBrowser,
    Cc: {
      "@mozilla.org/memory-reporter-manager;1": {
        getService: () => ({
          minimizeMemoryUsage(cb) {
            calls.minimize += 1;
            if (manager === "throws") throw new Error("no manager");
            // A bare function is rejected by some builds; the module must hand an object with run().
            assert.equal(typeof cb, "object", "the module passes an object with run(), not a bare function");
            assert.equal(typeof cb.run, "function");
            cb.run();
          },
        }),
      },
    },
    Ci: { nsIMemoryReporterManager: Symbol("nsIMemoryReporterManager") },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestIdleCallback(cb, opts) {
      idleCallbacks.push({ cb, opts });
      return idleCallbacks.length;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    console: { warn: (...args) => warnings.push(args.map(String).join(" ")), log() {}, error() {} },
    ZentralRuntime: {
      register(def) {
        registration = def;
      },
    },
  };
  win.window = win;
  win.globalThis = win;

  let readingIndex = 0;
  const ChromeUtils = {
    requestProcInfo() {
      calls.sampleReads += 1;
      // The init probe is the FIRST reading (the module reuses it), so a test that wants to show "freed" lists both.
      if (Array.isArray(readings)) {
        const value = readings[Math.min(readingIndex, readings.length - 1)];
        readingIndex += 1;
        return value;
      }
      const entry = procs[Math.min(procIndex, procs.length - 1)];
      procIndex += 1;
      if (entry === null) throw new Error("not supported");
      return entry;
    },
    forceGC() {
      calls.gc += 1;
    },
    forceCC() {
      calls.cc += 1;
    },
  };

  const context = vm.createContext({ ...win, ChromeUtils, Cc: win.Cc, Ci: win.Ci, console: win.console, Promise, Set, Map, WeakMap, Array, Object, Number, Math, String, Symbol, Error, TypeError, Date, JSON, globalThis: win });
  vm.runInContext(SRC, context, { filename: "ZentralBoost.uc.js" });
  assert.ok(registration?.init, "the module registers a feature with an init");

  const destroy = registration.init();
  const api = win.ZentralBoost;
  assert.ok(api, "the module publishes window.ZentralBoost");

  return {
    win,
    api,
    calls,
    timers,
    warnings,
    store,
    idleCallbacks,
    listeners,
    destroy,
    // Run every timer that was pending WHEN THE CALL STARTED (oldest first), the way one event-loop turn sees it. A
    // timer armed by one of those callbacks belongs to a later turn and is deliberately left for the next call.
    fire(ms) {
      const due = [...timers].filter(([, timer]) => Math.abs(timer.ms - ms) <= 5);
      for (const [id] of due) timers.delete(id);
      for (const [, timer] of due) timer.fn();
      return due.length;
    },
    pendingDelays: () => [...timers.values()].map((t) => t.ms),
    runIdle() {
      const pending = idleCallbacks.splice(0);
      for (const { cb } of pending) cb({ didTimeout: false, timeRemaining: () => 10 });
      return pending.length;
    },
    input() {
      for (const fn of listeners.get("keydown") || []) fn({ type: "keydown" });
    },
  };
}

/* Start Level 1 and let its settle timer fire, the way the window would after ~3 s. */
async function level1(h) {
  const pending = h.api.runLevel1();
  await Promise.resolve();
  h.fire(3000);
  return pending;
}

/* ---------------- 1. the reading ---------------- */

test("the RAM reading sums the parent and every child, and samples only when asked", () => {
  const h = boot();
  // The startup check reads the build once and that answer is the first reading; every later call reads afresh.
  const base = h.calls.sampleReads;
  assert.equal(h.api.memoryMB(), 175, "100 + 50 + 25 MB");
  assert.equal(h.calls.sampleReads, base, "the first call reuses the startup answer");
  assert.equal(h.api.memoryMB(), 175);
  assert.equal(h.calls.sampleReads, base + 1, "no cached value pretends to be a fresh reading");
  h.destroy();
});

test("a build with no requestProcInfo logs one warning and keeps freeing memory working", async () => {
  const h = boot({ procs: [null] });
  assert.equal(h.api.memoryMB(), null, "the reading is unavailable, not a guess");
  h.api.memoryMB();
  const procWarnings = h.warnings.filter((w) => /requestProcInfo/.test(w));
  assert.equal(procWarnings.length, 1, "the person is told exactly once, not on every read");
  // The plan's rule: the meter disables itself, the rest of the module keeps working.
  const result = await level1(h);
  assert.equal(result.beforeMB, null);
  assert.equal(result.by, "minimize", "freeing memory does not depend on the meter");
  h.destroy();
});

test("a malformed report is refused rather than counted as zero", () => {
  const h = boot({ procs: [{ memory: NaN, children: [{ memory: "x" }] }] });
  assert.equal(h.api.memoryMB(), null, "nothing to add up is not 0 MB");
  h.destroy();
});

/* ---------------- 2. Level 1 ---------------- */

test("Level 1 asks the reporter manager once, runs GC and CC, and measures after the settle delay", async () => {
  const h = boot({ procs: [{ memory: 500 }], readings: [{ memory: 500 }, { memory: 300 }] });
  const pending = h.api.runLevel1();
  await Promise.resolve();
  assert.equal(h.calls.minimize, 1, "one minimize call");
  assert.equal(h.calls.gc, 1, "GC once");
  assert.equal(h.calls.cc, 1, "CC once");
  assert.equal(h.calls.sampleReads, 1, "the before reading (the startup probe's own answer is reused)");
  assert.ok(h.pendingDelays().includes(3000), "the after reading waits for Gecko to actually free");
  // A second click while the first run settles must not stack a second minimize.
  const second = await h.api.runLevel1();
  assert.equal(second, null, "an in-flight Level 1 refuses a second start");
  assert.equal(h.calls.minimize, 1);
  h.fire(3000);
  const result = await pending;
  assert.equal(result.beforeMB, 500);
  assert.equal(result.afterMB, 300);
  assert.equal(result.freedMB, 200);
  assert.equal(result.by, "minimize");
  h.destroy();
});

test("a missing or throwing reporter manager still frees what it can", async () => {
  const h = boot({ manager: "throws" });
  const result = await level1(h);
  assert.equal(h.calls.minimize, 1, "the manager was tried once");
  assert.equal(h.calls.gc, 1, "GC still ran");
  assert.equal(result.by, "gc-cc-only", "the result says which path answered");
  h.destroy();
});

test("nothing is closed, unloaded or reloaded by Level 1", () => {
  // OW-91 added the deep pass, which does unload tabs — so the claim is pinned where it belongs: inside `runLevel1`
  // itself, from its first line to the next section. An edit that teaches the light pass to close something fails here.
  const start = SRC.indexOf("function runLevel1()");
  const body = SRC.slice(start, SRC.indexOf("// Destroy while a Level 1 run is settling", start));
  assert.ok(body.length > 800, "runLevel1 was found");
  for (const forbidden of ["removeTab", "explicitUnloadTabs", "discardBrowser", "reloadTab"]) {
    assert.equal(body.includes(forbidden), false, `${forbidden} must not appear in runLevel1`);
  }
});

/* ---------------- 3. the sampler ---------------- */

test("sampling runs every 2 s while someone is looking, and stops when they are not", () => {
  const h = boot();
  const samples = [];
  h.api.onChange((value) => samples.push(value));
  // The startup probe's answer may be the very first sample (it is reused rather than read twice); after that every
  // tick is a fresh read, which is what the cadence claim is about.
  h.api.startSampling();
  const afterOpen = h.calls.sampleReads;
  assert.ok(h.pendingDelays().includes(2000), "opening the popup arms a 2 s cadence");
  h.fire(2000);
  assert.equal(h.calls.sampleReads, afterOpen + 1, "each tick is a real reading");
  // Two users (the popup and the limiter) share one sampler: closing one must not stop the other.
  h.api.startSampling();
  h.api.stopSampling();
  h.fire(2000);
  assert.equal(h.calls.sampleReads, afterOpen + 2, "the second user keeps it alive");
  h.api.stopSampling();
  const afterStop = h.calls.sampleReads;
  h.fire(2000);
  assert.equal(h.calls.sampleReads, afterStop, "nobody is looking, nothing is sampled");
  assert.equal(h.api.lastMB(), 175, "the last value is remembered for a widget (OW-90)");
  assert.ok(samples.length >= 3);
  h.destroy();
});

/* ---------------- 4. the startup trim ---------------- */

test("the trim runs once after 90 quiet seconds, and never twice", () => {
  const h = boot({ procs: [{ memory: 900 }, { memory: 400 }] });
  assert.ok(h.pendingDelays().includes(90000), "it waits for a quiet period");
  h.fire(90000);
  assert.equal(h.calls.minimize, 0, "it does not run before the browser is idle");
  assert.equal(h.runIdle(), 1, "the final run waits for idle");
  assert.equal(h.calls.minimize, 1);
  h.fire(3000); // the settle reading
  h.fire(90000);
  h.runIdle();
  assert.equal(h.calls.minimize, 1, "a second quiet period does not trim again");
  assert.equal(h.api.state().trimDone, true);
  h.destroy();
});

test("input restarts the quiet period; the trim does not fire on a busy browser", () => {
  const h = boot();
  h.input();
  assert.equal(h.pendingDelays().filter((ms) => ms === 90000).length, 1, "input re-arms the ONE quiet timer, not a second");
  assert.equal(h.calls.minimize, 0, "nothing was trimmed by typing");
  assert.ok(h.pendingDelays().includes(90000), "and a fresh quiet period is armed");
  h.fire(90000);
  h.runIdle();
  assert.equal(h.calls.minimize, 1);
  h.destroy();
});

test("a playing tab holds the trim back", () => {
  const playing = { soundPlaying: true };
  const h = boot({ media: [playing] });
  h.fire(90000);
  assert.equal(h.calls.minimize, 0, "nothing is trimmed while something plays");
  assert.ok(h.pendingDelays().includes(90000), "it waits for the media to stop");
  playing.soundPlaying = false;
  h.fire(90000);
  h.runIdle();
  assert.equal(h.calls.minimize, 1);
  h.destroy();
});

test("the kill switch stops the trim before it ever runs", () => {
  const h = boot({ prefs: { "zen.workspace.zentral.boost.startup_trim": false } });
  assert.equal(h.pendingDelays().includes(90000), false, "nothing is armed");
  h.fire(90000);
  h.runIdle();
  assert.equal(h.calls.minimize, 0);
  h.destroy();
});

test("the hard ceiling trims once even if the session never goes quiet", () => {
  const h = boot();
  for (let i = 0; i < 5; i++) h.input();
  assert.ok(h.pendingDelays().includes(6 * 60 * 1000), "the ceiling is armed");
  h.fire(6 * 60 * 1000);
  assert.equal(h.calls.minimize, 1, "one trim, once");
  h.fire(6 * 60 * 1000);
  h.fire(90000);
  assert.equal(h.calls.minimize, 1, "and never again");
  h.destroy();
});

/* ---------------- 5. teardown ---------------- */

test("destroy cancels every pending timer and forgets its listeners", () => {
  const h = boot();
  h.api.startSampling();
  assert.ok(h.timers.size > 0);
  h.destroy();
  assert.equal(h.timers.size, 0, "no timer outlives the feature");
  assert.equal(h.win.ZentralBoost, undefined, "the public API is gone");
  assert.equal([...(h.listeners.get("keydown") || [])].length, 0, "input listeners are removed");
  assert.equal(h.fire(3000), 0, "a settle timer cannot fire after destroy");
});

test("the module never uses an interval", () => {
  assert.equal(/setInterval/.test(SRC), false, "no setInterval (the plan's hard rule)");
});

/* ---------------- runner ---------------- */

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-89-boost-core: ${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
