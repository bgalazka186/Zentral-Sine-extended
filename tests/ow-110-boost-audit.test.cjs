"use strict";
/* OW-110: Boost bug pass & Game Mode RAM regression tests.
 *
 * Covers the owner-reported regression (turning Game Mode on caused every Zentral app in `essentialPanels` to be
 * created and loaded via `getOrCreateAppBrowser`) plus the full Boost audit defects:
 *   1. Game Mode must NEVER call `getOrCreateAppBrowser` or instantiate/load unloaded Zentral apps;
 *   2. Turning Game Mode on must NOT immediately re-activate preload `live` panel browsers via `syncPanelActivity()`,
 *      and `syncAppPanelBrowserActivity` must respect active Game Mode;
 *   3. `strongerSaverSleep()` must actually run when Stronger Saver + Game Mode are enabled together (previously
 *      blocked because `runLevel2({ allowPanels: false })` had just set `level2Busy = true`);
 *   4. Teardown (`destroy()`) while Game Mode is active resets `game_mode` pref to `false` so restarts do not boot
 *      back into Game Mode, and the pref observer stays synced with `gameMode.on`;
 *   5. Pending `runLevel1()` / `runLevel2()` settle timers resolve cleanly on `destroy()` instead of hanging forever,
 *      `runLevel2()` preserves `lastSampleMB` when `afterMB` is null, and `window` `unload` / trim listeners clean up;
 *   6. `limiterRunHard()` stops if disabled or destroyed mid-run;
 *   7. Async `ChromeUtils.requestProcInfo()` returning a Promise does not permanently disable the RAM meter;
 *   8. Boost widget card wires `startSampling`/`stopSampling` on popup open/close, cleans up document listeners on
 *      card `dispose()`, and subscribes lazily if `ZentralBoost` initializes after `ZentralWidgets`.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeSidebarHarness } = require("./helpers/fake-widgets-harness.cjs");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
const SWITCH_SRC = read("loader/ZentralPerformanceSwitch.js");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const INTEGRATIONS_SRC = read("extension/panels/browsers/ZentralBrowserIntegrations.uc.js");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function makeBrowser({ connected = true, active = true, layers = true, remote = true, appId = null, url = "https://example.com/" } = {}) {
  return {
    isConnected: connected,
    docShellIsActive: active,
    renderLayers: layers,
    isRemoteBrowser: remote,
    _bgalazkaAppId: appId,
    currentURI: { spec: url },
    isPictureInPicture: false,
  };
}

function makeTab({ browser, label = "tab", sound = false, selected = false, pinned = false, connected = true, linkedPanel = "p1" } = {}) {
  const attrs = new Set();
  if (pinned) attrs.add("pinned");
  return {
    label,
    isConnected: connected,
    closing: false,
    linkedPanel,
    linkedBrowser: browser,
    soundPlaying: sound,
    selected,
    pinned,
    lastAccessed: 100,
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => (attrs.has(name) ? "" : null),
    matches: () => false,
  };
}

function bootBoost({ prefs = {}, tabs = [], essentialRecords = [], loadedPanelBrowsers = [], procInfo } = {}) {
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    ...prefs,
  }));
  const timers = new Map();
  let timerId = 0;
  const listeners = new Map();
  const observers = new Map();
  const idleCancelled = [];
  let idleSeq = 0;
  const getOrCreateCalls = [];
  const unloadCalls = [];
  let syncCalls = 0;
  let registration = null;

  const essentialPanels = new Map();
  for (const r of essentialRecords) essentialPanels.set(r.app.id, r);

  const gBrowser = {
    tabs,
    selectedTab: tabs[0] || null,
    explicitUnloadTabs: async (list) => {
      unloadCalls.push(...list);
      for (const t of list) {
        t._unloaded = true;
        t.linkedPanel = null;
      }
      return true;
    },
  };

  const win = {
    gBrowser,
    Services: {
      prefs: {
        getBoolPref: (k, d) => (store.has(k) ? Boolean(store.get(k)) : d),
        getIntPref: (k, d) => (store.has(k) ? Number(store.get(k)) : d),
        getStringPref: (k, d) => (store.has(k) ? String(store.get(k)) : d),
        setBoolPref: (k, v) => {
          store.set(k, v);
          for (const fn of [...(observers.get(k) || [])]) fn({}, "", k);
        },
        addObserver: (key, observer) => {
          if (!observers.has(key)) observers.set(key, new Set());
          observers.get(key).add(observer.observe ? observer.observe.bind(observer) : observer);
        },
        removeObserver: (key, observer) => {
          const set = observers.get(key);
          if (!set) return;
          set.delete(observer);
          // Also remove bound observers by scanning if needed in tests
        },
      },
      appinfo: { OS: "Linux" },
      obs: { addObserver() {}, removeObserver() {} },
    },
    Cc: {
      "@mozilla.org/memory-reporter-manager;1": {
        getService: () => ({ minimizeMemoryUsage: (cb) => cb?.run?.() }),
      },
    },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: { getTabState: (t) => JSON.stringify({ entries: [{ url: t.linkedBrowser?.currentURI?.spec || "https://example.com/" }], index: 1 }) },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback: () => ++idleSeq,
    cancelIdleCallback: (id) => idleCancelled.push(id),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    console: { warn() {}, log() {}, error() {} },
  };
  win.window = win;
  win.globalThis = win;

  const switchSandbox = { window: {}, console };
  vm.createContext(switchSandbox);
  vm.runInContext(SWITCH_SRC, switchSandbox, { filename: "ZentralPerformanceSwitch.js" });
  const performance = switchSandbox.window.ZentralPerformanceSwitch.create();
  win.ZentralRuntime = { register: (def) => { registration = def; }, performance };
  win.Zentral = {
    Panels: {
      essentialPanels,
      getAllAppBrowsers: () => loadedPanelBrowsers,
      syncAppPanelBrowserActivity() {
        syncCalls += 1;
        // Simulate real ZentralBrowserIntegrations keeping preload `live` notifications active unless Game Mode blocks it:
        for (const b of loadedPanelBrowsers) {
          const rec = essentialPanels.get(b._bgalazkaAppId);
          const gameOn = Boolean(win.ZentralBoost?.gameModeState?.().on);
          const notifications = Boolean(rec?.app?.preload && rec?.tab?.isConnected);
          const throttled = rec?.backgroundMode === "throttled";
          const active = gameOn ? Boolean(rec?.tab?.soundPlaying) : (throttled ? false : notifications);
          b.docShellIsActive = active;
        }
      },
    },
    Apps: {
      getOrCreateAppBrowser(app) {
        getOrCreateCalls.push(app.id);
        const created = makeBrowser({ appId: app.id, active: true, layers: true });
        loadedPanelBrowsers.push(created);
        return { browser: created, isNew: true };
      },
    },
  };
  win.ZentralTabPolicy = (() => {
    const p = {};
    p.window = p;
    vm.runInNewContext(POLICY_SRC, { window: p, globalThis: p, console });
    return p.ZentralTabPolicy;
  })();

  const context = vm.createContext({
    ...win,
    ChromeUtils: {
      requestProcInfo: procInfo || (() => ({ memory: 900 })),
      forceGC() {},
      forceCC() {},
    },
    Cc: win.Cc, Ci: win.Ci, console: win.console,
    Promise, Set, Map, WeakMap, WeakSet, Array, Object, Number, Math, String, Symbol, Error, TypeError, Date, JSON,
    globalThis: win,
  });
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  registration.init();

  return {
    api: win.ZentralBoost,
    win,
    store,
    timers,
    listeners,
    idleCancelled,
    getOrCreateCalls,
    unloadCalls,
    get syncCalls() { return syncCalls; },
    async flushTimers(ms) {
      const due = [...timers].filter(([, t]) => ms == null || t.ms === ms);
      for (const [id, t] of due) {
        timers.delete(id);
        t.fn();
      }
      for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    },
  };
}

test("Game Mode never calls getOrCreateAppBrowser or loads unloaded Zentral apps", () => {
  const unloadedApp1 = { app: { id: "slack", name: "Slack", preload: false }, tab: makeTab({ browser: null, linkedPanel: null }), backgroundMode: "live" };
  const unloadedApp2 = { app: { id: "discord", name: "Discord", preload: true }, tab: makeTab({ browser: null, linkedPanel: null }), backgroundMode: "live" };
  const loadedBrowser = makeBrowser({ appId: "whatsapp", active: true, layers: true });
  const loadedApp = { app: { id: "whatsapp", name: "WhatsApp", preload: true }, tab: makeTab({ browser: loadedBrowser }), backgroundMode: "live" };
  const idleTab = makeTab({ browser: makeBrowser({ active: true }), label: "bg" });
  const selectedTab = makeTab({ browser: makeBrowser({ active: true }), selected: true, label: "fg" });

  const h = bootBoost({
    tabs: [selectedTab, idleTab],
    essentialRecords: [unloadedApp1, unloadedApp2, loadedApp],
    loadedPanelBrowsers: [loadedBrowser],
  });

  const targets = h.api.gameModeTargets();
  assert.equal(h.getOrCreateCalls.length, 0, "gameModeTargets must never instantiate unloaded apps");
  assert.equal(targets.filter((t) => t.kind === "panel").length, 1, "only the already-loaded panel browser is targeted");

  const state = h.api.setGameMode(true);
  assert.equal(state.on, true);
  assert.equal(h.getOrCreateCalls.length, 0, "turning Game Mode on must never load unloaded apps");
  assert.equal(loadedBrowser.docShellIsActive, false, "already-loaded background preload panel goes inactive in Game Mode");
  assert.equal(loadedBrowser.renderLayers, false, "and stops compositing");
  h.api.destroy();
});

test("syncAppPanelBrowserActivity in ZentralBrowserIntegrations respects active Game Mode", () => {
  const start = INTEGRATIONS_SRC.indexOf("function syncAppPanelBrowserActivity(");
  let depth = 0;
  let began = false;
  let end = start;
  for (let i = start; i < INTEGRATIONS_SRC.length; i++) {
    if (INTEGRATIONS_SRC[i] === "{") { depth += 1; began = true; }
    else if (INTEGRATIONS_SRC[i] === "}") {
      depth -= 1;
      if (began && depth === 0) { end = i + 1; break; }
    }
  }
  const fnBody = INTEGRATIONS_SRC.slice(start, end);
  const preloadBrowser = {
    isConnected: true, isRemoteBrowser: true, docShellIsActive: true, renderLayers: true,
    _bgalazkaAppId: "wa", style: { display: "none" },
    hasAttribute: () => false, closest: () => null, getClientRects: () => [],
  };
  const ctx = {
    essentialPanels: new Map([["wa", { app: { id: "wa", preload: true }, tab: { isConnected: true, soundPlaying: false }, backgroundMode: "live" }]]),
    getAllAppBrowsers: () => [preloadBrowser],
  };
  const document = {
    getElementById: () => ({ contains: () => true, hasAttribute: () => false, getAttribute: () => null }),
    documentElement: { hasAttribute: () => false, getAttribute: () => null },
  };
  const window = { ZentralBoost: { gameModeState: () => ({ on: true }) }, Zentral: undefined };
  const fn = new Function(
    "ctx", "document", "window", "addonHostByAppId", "console", "panelBrowserVisible",
    `${fnBody}\nreturn syncAppPanelBrowserActivity;`,
  );
  const sync = fn(ctx, document, window, new Map(), console, () => false);
  sync([preloadBrowser]);
  assert.equal(preloadBrowser.docShellIsActive, false, "hidden preload panel must remain inactive while Game Mode is on");
});

test("Stronger saver actually sleeps live panel records when Game Mode turns on", async () => {
  const liveBrowser = makeBrowser({ appId: "wa", active: true });
  const liveRecord = {
    app: { id: "wa", name: "WhatsApp", preload: true },
    tab: makeTab({ browser: liveBrowser, linkedPanel: "p-wa" }),
    backgroundMode: "live",
  };
  const bgTab = makeTab({ browser: makeBrowser({ active: true }), label: "bg" });
  const fgTab = makeTab({ browser: makeBrowser({ active: true }), selected: true, label: "fg" });

  const h = bootBoost({
    prefs: { "zen.workspace.zentral.boost.stronger_saver": true },
    tabs: [fgTab, bgTab],
    essentialRecords: [liveRecord],
    loadedPanelBrowsers: [liveBrowser],
  });

  h.api.setGameMode(true);
  // Drain level2 (tabs) timers, then let chained strongerSaverSleep run and drain its timers:
  for (let i = 0; i < 6; i++) await h.flushTimers(3000);

  assert.ok(h.unloadCalls.includes(bgTab), "background tab was unloaded");
  assert.ok(h.unloadCalls.includes(liveRecord.tab), "live panel was ALSO slept by Stronger Saver");
  assert.ok(h.api.undoSize() >= 2, "undo record includes both tab and stronger-saver panel");
  h.api.destroy();
});

test("destroy() during Game Mode resets the game_mode pref so restarts start unpaused", () => {
  const h = bootBoost();
  h.api.setGameMode(true);
  assert.equal(h.store.get("zen.workspace.zentral.boost.game_mode"), true);
  h.api.destroy();
  assert.equal(h.store.get("zen.workspace.zentral.boost.game_mode"), false, "pref is cleared on teardown so next start is off");
  assert.equal(h.listeners.get("unload")?.size || 0, 0, "unload listener is removed on destroy");
});

test("destroy() resolves pending runLevel1() and runLevel2() settle promises instead of hanging", async () => {
  const bgTab = makeTab({ browser: makeBrowser({ active: true }), label: "bg" });
  const h = bootBoost({ tabs: [makeTab({ browser: makeBrowser({ active: true }), selected: true }), bgTab] });
  const p1 = h.api.runLevel1();
  h.api.destroy();
  const r1 = await Promise.race([p1, new Promise((_, rej) => setTimeout(() => rej(new Error("runLevel1 hung")), 200))]);
  assert.equal(r1, null);

  const h2 = bootBoost({ tabs: [makeTab({ browser: makeBrowser({ active: true }), selected: true }), makeTab({ browser: makeBrowser({ active: true }), label: "bg2" })] });
  const p2 = h2.api.runLevel2();
  await new Promise((r) => setTimeout(r, 0));
  h2.api.destroy();
  const r2 = await Promise.race([p2, new Promise((_, rej) => setTimeout(() => rej(new Error("runLevel2 hung")), 200))]);
  assert.equal(r2, null);
});

test("async ChromeUtils.requestProcInfo() Promise populates readings instead of disabling the meter", async () => {
  const h = bootBoost({
    procInfo: () => Promise.resolve({ memory: 640, children: [{ memory: 160 }] }),
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.api.state().memorySupport, true, "Promise-based requestProcInfo is supported");
  assert.equal(h.api.lastMB(), 800, "resolved parent + child MB is recorded");
  h.api.destroy();
});

test("Boost widget card toggles sampling with the popup and cleans up listeners on dispose()", async () => {
  const h = createFakeSidebarHarness({
    "zen.workspace.zentral.widgets.enabled": true,
    "zen.workspace.zentral.widgets.clock.enabled": false,
    "zen.workspace.zentral.widgets.date.enabled": false,
    "zen.workspace.zentral.widgets.weather.enabled": false,
    "zen.workspace.zentral.widgets.boost.enabled": true,
  });
  let sampling = 0;
  let unsubs = 0;
  const listeners = new Set();
  const boost = {
    lastMB: () => 500,
    runLevel1: async () => ({ beforeMB: 500, afterMB: 450, freedMB: 50, by: "minimize" }),
    onChange: (fn) => {
      listeners.add(fn);
      return () => { listeners.delete(fn); unsubs += 1; };
    },
    startSampling: () => { sampling += 1; },
    stopSampling: () => { sampling = Math.max(0, sampling - 1); },
  };
  h.window.ZentralBoost = boost;
  const { api } = h.start();
  await new Promise((r) => setTimeout(r, 40));

  const card = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "boost");
  const body = card.querySelector(".zw-boost");
  const arrow = body.querySelector(".zw-boost-menu-btn");
  const beforeCardListeners = h.counts().docListeners;
  for (const [t, fn] of arrow._listeners) if (t === "click") fn({ preventDefault() {}, stopPropagation() {} });
  assert.equal(sampling, 1, "opening Boost popup starts 2s sampling");

  // Disable just the boost card (calls card dispose() without destroying whole shell)
  h.Services.prefs.setBoolPref("zen.workspace.zentral.widgets.boost.enabled", false);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sampling, 0, "disposing the card stops sampling if popup was open");
  assert.equal(unsubs, 1, "disposing the card unsubscribes onChange");
  assert.equal(h.counts().docListeners, beforeCardListeners - 2, "card pointerdown + keydown listeners are removed on dispose");
  api.destroy();
});

test("Boost widget card lazily attaches if ZentralBoost registers after ZentralWidgets", async () => {
  const h = createFakeSidebarHarness({
    "zen.workspace.zentral.widgets.enabled": true,
    "zen.workspace.zentral.widgets.clock.enabled": false,
    "zen.workspace.zentral.widgets.date.enabled": false,
    "zen.workspace.zentral.widgets.weather.enabled": false,
    "zen.workspace.zentral.widgets.boost.enabled": true,
  });
  const { api } = h.start();
  await new Promise((r) => setTimeout(r, 30));
  const card = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "boost");
  const valueEl = card.querySelector(".zw-boost-value");
  assert.equal(valueEl.textContent, "\u2014");

  const listeners = new Set();
  h.window.ZentralBoost = {
    lastMB: () => 777,
    runLevel1: async () => null,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const arrow = card.querySelector(".zw-boost-menu-btn");
  arrow.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(valueEl.textContent, "777 MB", "card picks up late-initialized ZentralBoost");
  api.destroy();
});

test("runLevel2 preserves lastSampleMB when afterMB is null and startup trim detaches input listeners", async () => {
  let calls = 0;
  const h = bootBoost({
    prefs: { "zen.workspace.zentral.boost.startup_trim": true },
    tabs: [makeTab({ browser: makeBrowser({ active: true }), selected: true }), makeTab({ browser: makeBrowser({ active: true }), label: "bg" })],
    procInfo: () => {
      calls += 1;
      // 1=probe (reused by trim runLevel1 before), 2=trim runLevel1 after, 3=runLevel2 before, 4=runLevel2 after -> null
      return calls <= 3 ? { memory: 600 } : null;
    },
  });
  assert.equal(h.listeners.get("keydown")?.size || 0, 2, "startup trim + shortcut keydown listeners attached initially");
  assert.equal(h.listeners.get("wheel")?.size || 0, 1, "startup trim wheel listener attached initially");
  await h.flushTimers(6 * 60 * 1000);
  assert.equal(h.api.state().trimDone, true);
  assert.equal(h.listeners.get("wheel")?.size || 0, 0, "input listeners detached once startup trim completes");
  assert.equal(h.listeners.get("keydown")?.size || 0, 1, "only the shortcut keydown listener remains");
  await h.flushTimers(3000); // settle startup trim's runLevel1

  const p = h.api.runLevel2();
  await new Promise((r) => setTimeout(r, 0));
  await h.flushTimers(3000);
  await h.flushTimers(3000);
  const res = await p;
  assert.equal(res.beforeMB, 600);
  assert.equal(res.afterMB, null);
  assert.equal(h.api.lastMB(), 600, "lastSampleMB is not wiped out by a null afterMB");
  h.api.destroy();
});

test("limiterRunHard stops immediately if limiter is disabled mid-run", async () => {
  const tabs = Array.from({ length: 6 }, (_, i) => makeTab({ browser: makeBrowser({ active: true }), label: `t${i}` }));
  const h = bootBoost({
    prefs: {
      "zen.workspace.zentral.boost.limit_enabled": true,
      "zen.workspace.zentral.boost.limit_mb": 500,
      "zen.workspace.zentral.boost.limit_mode": "hard",
      "zen.workspace.zentral.boost.limit_target_pct": 80,
    },
    tabs,
    procInfo: () => ({ memory: 900 }),
  });
  h.win.gBrowser.selectedTab = null;
  const events = [];
  h.api.onLimiterEvent((e) => events.push(e));
  await h.flushTimers(60000);
  // Disable limiter before runLevel2 settle finishes
  h.store.set("zen.workspace.zentral.boost.limit_enabled", false);
  await h.flushTimers(3000);
  await h.flushTimers(3000);
  assert.equal(events.length, 0, "no hard-done/nothing-eligible event fires after limiter is disabled");
  h.api.destroy();
});

async function main() {
  for (const [name, fn] of tests) {
    if (fn.constructor.name === "AsyncFunction") await fn();
    else fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-110-boost-audit (${passed} passed)`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
