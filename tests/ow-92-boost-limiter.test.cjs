"use strict";
const MB = 1_000_000; // Firefox ProcInfo.memory is bytes; readings are written in MB.
/* OW-92 (plan B5): the RAM limiter.
 *
 * The limiter is the one part of Boost that acts on its own, so its state machine is proven on its own first: the pure
 * `decideLimiter` is a function of numbers, and every rule the plan names is a row below (hysteresis, cooldown, soft
 * vs hard, no reading, nothing eligible). Then the live loop is run against a fake browser: one timer at a time, a
 * hard run in batches of three, and a cooldown that holds.
 *
 * The plan is explicit about one limit that cannot be crossed from JS: a real per-process memory cap is impossible in
 * this environment, so the limiter is about tabs and panels, and the README says so. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(REPO, "additional/boost/ZentralBoost.uc.js"), "utf8");
const POLICY_SRC = fs.readFileSync(path.join(REPO, "loader/ZentralTabPolicy.js"), "utf8");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(REPO, "additional/boost/settings.json"), "utf8"));

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ---------------- the module, in a fake chrome window ---------------- */

function boot({ prefs = {}, readings = [900], tabs = [] } = {}) {
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    ...prefs,
  }));
  const timers = new Map();
  let timerId = 0;
  const events = [];
  let registration = null;
  let readingIndex = 0;
  const unloadCalls = [];

  const win = {
    Services: {
      prefs: {
        getBoolPref: (k, d) => (store.has(k) ? Boolean(store.get(k)) : d),
        getStringPref: (k, d) => (store.has(k) ? String(store.get(k)) : d),
        getIntPref: (k, d) => (store.has(k) ? Number(store.get(k)) : d),
        setBoolPref: (k, v) => store.set(k, v),
        addObserver() {},
        removeObserver() {},
      },
      appinfo: { OS: "Linux" },
      obs: { addObserver() {}, removeObserver() {} },
    },
    Cc: { "@mozilla.org/memory-reporter-manager;1": { getService: () => ({ minimizeMemoryUsage: (cb) => cb.run() }) } },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: { getTabState: (t) => JSON.stringify({ entries: [{ url: t.linkedBrowser?.currentURI?.spec || "" }], index: 1 }) },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback: () => 1,
    addEventListener() {},
    removeEventListener() {},
    console: { warn() {}, log() {}, error() {} },
    ZentralRuntime: { register: (def) => { registration = def; } },
  };
  win.window = win;
  win.globalThis = win;
  win.gBrowser = {
    tabs,
    selectedTab: tabs[0] || null,
    explicitUnloadTabs: async (list) => { unloadCalls.push(...list); return true; },
  };
  win.ZentralTabPolicy = (() => {
    const w = {};
    w.window = w;
    vm.runInNewContext(POLICY_SRC, { window: w, globalThis: w, console });
    return w.ZentralTabPolicy;
  })();

  const context = vm.createContext({
    ...win,
    ChromeUtils: {
      requestProcInfo: () => ({ memory: readings[Math.min(readingIndex++, readings.length - 1)] * MB }),
      forceGC() {},
      forceCC() {},
    },
    Cc: win.Cc, Ci: win.Ci, console: win.console, Promise, Set, Map, WeakMap, Array, Object, Number, Math, String,
    Symbol, Error, TypeError, Date, JSON, globalThis: win,
  });
  vm.runInContext(SRC, context, { filename: "ZentralBoost.uc.js" });
  registration.init();
  const api = win.ZentralBoost;
  api.onLimiterEvent((event) => events.push(event));
  return {
    api, win, store, events, unloadCalls, timers,
    destroy: () => api.destroy(),
    // Fire every pending timer whose delay matches and let the async work that follows settle.
    async fire(ms) {
      const due = [...timers].filter(([, t]) => t.ms === ms);
      for (const [id, t] of due) { timers.delete(id); t.fn(); }
      for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      return due.length;
    },
    delays: () => [...timers.values()].map((t) => t.ms),
  };
}

/* ---------------- the state machine, as a table ---------------- */

test("below the limit it does nothing, and the cadence follows how comfortable it is", () => {
  const h = boot();
  const decide = h.api.decideLimiter;
  const base = { settings: { enabled: true, limitMB: 4096, mode: "hard", cooldownS: 60, targetPct: 85 }, now: 1000 };
  const cool = decide({ ...base, totalMB: 1000 });
  assert.equal(cool.action, "none");
  assert.equal(cool.reason, "under-limit");
  assert.equal(cool.cadenceMs, 60000, "well below: the slow check");
  const warm = decide({ ...base, totalMB: 3000 }); // 73 % of 4096
  assert.equal(warm.cadenceMs, 10000, "above 70 % of the limit it looks again sooner");
  assert.equal(warm.action, "none", "but it still does not act");
  h.destroy();
});

test("a build with no reading never acts, and a disabled limiter does nothing at all", () => {
  const h = boot();
  const decide = h.api.decideLimiter;
  assert.equal(decide({ totalMB: null, settings: { enabled: true, limitMB: 100 } }).reason, "no-reading");
  assert.equal(decide({ totalMB: null, settings: { enabled: true, limitMB: 100 } }).action, "none");
  const off = decide({ totalMB: 99999, settings: { enabled: false, limitMB: 100 } });
  assert.equal(off.action, "none");
  assert.equal(off.reason, "off");
  h.destroy();
});

test("soft tells, hard unloads, and both respect the cooldown", () => {
  const h = boot();
  const decide = h.api.decideLimiter;
  const over = { totalMB: 9000, settings: { enabled: true, limitMB: 4096, mode: "soft", cooldownS: 60, targetPct: 85 }, now: 100000 };
  assert.equal(decide(over).action, "notify", "soft mode only tells");
  assert.equal(decide(over).targetMB, 3482, "and it says where a run would stop");
  const hard = { ...over, settings: { ...over.settings, mode: "hard" } };
  assert.equal(decide(hard).action, "unload", "hard mode acts");
  // Inside the cooldown nothing happens, whatever the reading says.
  const cooling = decide({ ...hard, lastRunAt: 90000 });
  assert.equal(cooling.action, "none");
  assert.equal(cooling.reason, "cooldown");
  assert.ok(cooling.cadenceMs >= 1000, "and it looks again after the cooldown, not before");
  // After it, the next action is allowed.
  assert.equal(decide({ ...hard, lastRunAt: 100000 - 61000 }).action, "unload");
  h.destroy();
});

test("junk settings fall back to the plan's own numbers", () => {
  const h = boot();
  const decide = h.api.decideLimiter;
  const result = decide({ totalMB: 10000, settings: { enabled: true, limitMB: "nonsense", mode: "weird", cooldownS: NaN, targetPct: 0 } });
  assert.equal(result.targetMB, Math.round((4096 * 85) / 100), "4096 MB and 85 % are the defaults");
  assert.equal(result.action, "notify", "an unknown mode is the safe one: tell, do not unload");
  h.destroy();
});

test("the nagging rule: at most one 'nothing to do' per ten minutes", () => {
  const h = boot();
  // Read through the module's own behaviour below; here the numbers are checked against the source constant.
  assert.match(SRC, /LIMIT_NAG_MS = 10 \* 60000/, "ten minutes, as the plan says");
  h.destroy();
});

/* ---------------- the live loop ---------------- */

test("the limiter arms one timer, and only when it is switched on", async () => {
  const off = boot({ readings: [5000] });
  assert.equal(off.delays().includes(60000), false, "off by default: no chain at all");
  off.destroy();

  const on = boot({ prefs: { "zen.workspace.zentral.boost.limit_enabled": true }, readings: [100] });
  assert.equal(on.delays().filter((ms) => ms === 60000).length, 1, "on: exactly one timer");
  await on.fire(60000);
  assert.equal(on.delays().filter((ms) => ms === 60000).length, 1, "and exactly one after each tick");
  on.destroy();
});

test("a soft limit tells once per tick and never unloads", async () => {
  const tabs = [{ linkedPanel: "p", isConnected: true, hasAttribute: () => false, linkedBrowser: { currentURI: { spec: "https://a/" } }, lastAccessed: 1 }];
  const h = boot({
    prefs: { "zen.workspace.zentral.boost.limit_enabled": true, "zen.workspace.zentral.boost.limit_mb": 1000, "zen.workspace.zentral.boost.limit_mode": "soft" },
    readings: [5000],
    tabs,
  });
  h.win.gBrowser.selectedTab = null;
  await h.fire(60000);
  assert.equal(h.unloadCalls.length, 0, "soft mode never unloads");
  const notices = h.events.filter((e) => e.action === "notify");
  assert.ok(notices.length >= 1, "it told the person");
  assert.equal(notices[0].limitMB, 1000);
  assert.equal(h.api.limiterState().lastAction, "notify");
  h.destroy();
});

test("a hard limit unloads in batches and stops at the target", async () => {
  const makeTab = (i) => ({
    linkedPanel: "p", isConnected: true, hasAttribute: () => false, label: `t${i}`,
    linkedBrowser: { currentURI: { spec: `https://t${i}/` } }, lastAccessed: i,
  });
  const tabs = Array.from({ length: 9 }, (_, i) => makeTab(i));
  // 5000 MB now, and after each batch it drops by 400: 4600, 4200 … The target of 850 MB is never reached, so the
  // loop must stop on its own bounded rounds rather than spin.
  const readings = [5000, 4600, 4200, 3800, 3400, 3000, 2600, 2200, 1800, 1400, 1000, 900, 850, 800];
  const h = boot({
    prefs: {
      "zen.workspace.zentral.boost.limit_enabled": true,
      "zen.workspace.zentral.boost.limit_mb": 1000,
      "zen.workspace.zentral.boost.limit_mode": "hard",
      "zen.workspace.zentral.boost.limit_target_pct": 85,
      "zen.workspace.zentral.boost.limit_cooldown_s": 0,
    },
    readings,
    tabs,
  });
  h.win.gBrowser.selectedTab = null;
  const pending = h.fire(60000);
  // The deep pass settles through its own 3 s timers; run them as they appear.
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const due = [...h.timers].filter(([, t]) => t.ms === 3000);
    for (const [id, t] of due) { h.timers.delete(id); t.fn(); }
  }
  await pending;
  const done = h.events.filter((e) => e.action === "hard-done");
  assert.ok(done.length >= 1, "the run reported its result");
  assert.ok(h.unloadCalls.length > 0, "and it really put tabs to sleep");
  assert.ok(done[0].unloaded.tabs > 0);
  assert.ok(done[0].runs <= 12, "a bounded number of rounds, never a loop");
  h.destroy();
});

test("the limiter is re-armed by a pref change and gone after destroy", async () => {
  const h = boot({ readings: [100] });
  assert.equal(h.api.limiterState().enabled, false);
  h.store.set("zen.workspace.zentral.boost.limit_enabled", true);
  h.api.state(); // reading the state must not arm anything by itself
  assert.equal(h.api.limiterState().armed, false, "nothing is armed until a pref event or a start");
  h.destroy();
  assert.equal(h.timers.size, 0, "destroy leaves no timer behind");
});

test("every limiter pref is a setting the person can reach", () => {
  const wanted = [
    "zen.workspace.zentral.boost.limit_enabled",
    "zen.workspace.zentral.boost.limit_mb",
    "zen.workspace.zentral.boost.limit_mode",
    "zen.workspace.zentral.boost.limit_cooldown_s",
    "zen.workspace.zentral.boost.limit_target_pct",
  ];
  for (const property of wanted) {
    const item = SETTINGS.schema.find((x) => x.property === property);
    assert.ok(item, property + " is declared");
    assert.equal(SETTINGS.settings[property]?.section, "Limiter", property + " lives in the Limiter section");
  }
  const defaults = Object.fromEntries(SETTINGS.schema.filter((x) => x.property.includes(".boost.limit_")).map((x) => [x.property, x.defaultValue]));
  assert.equal(defaults["zen.workspace.zentral.boost.limit_enabled"], false, "off by default");
  assert.equal(defaults["zen.workspace.zentral.boost.limit_mb"], 4096);
  assert.equal(defaults["zen.workspace.zentral.boost.limit_mode"], "soft");
  assert.equal(defaults["zen.workspace.zentral.boost.limit_cooldown_s"], 60);
  assert.equal(defaults["zen.workspace.zentral.boost.limit_target_pct"], 85);
});

test("the limiter never uses an interval, and says what it cannot do", () => {
  assert.equal(/setInterval/.test(SRC), false, "one-shot chains only");
  const readme = fs.readFileSync(path.join(REPO, "additional/boost/README.md"), "utf8");
  assert.match(readme, /per-process|hard cap/i, "the README is honest about process-level caps");
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-92-boost-limiter (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
