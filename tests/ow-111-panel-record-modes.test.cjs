"use strict";
const MB = 1_000_000; // Firefox ProcInfo.memory is bytes; readings are written in MB.
/* OW-111 (owner audit F1): a tab that backs an Essential-panel record obeys its
 * `backgroundMode` in Level 2 and the RAM limiter; G8's Game Mode is the explicit consent that may sleep every mode.
 *
 * This file is also the "check the CURRENT behaviour" audit the owner asked for. It does not
 * trust the old patch's report: every record tab here is a real member of `gBrowser.tabs`
 * AND is pinned (or `zen-essential`), exactly as a real Zen shows WhatsApp/Messenger/arena.ai.
 * On the code before OW-111 these assertions fail in two different ways:
 *   - keep_pinned false: the panel loop's `canUnload` refuses the pinned record, so even
 *     `asleep-allowed` is a no-op;
 *   - keep_pinned true: the TAB loop unloads every record tab, `live` and `throttled` included.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const POLICY_SRC = fs.readFileSync(path.join(REPO, "loader/ZentralTabPolicy.js"), "utf8");
const BOOST_SRC = fs.readFileSync(path.join(REPO, "additional/boost/ZentralBoost.uc.js"), "utf8");
const SWITCH_SRC = fs.readFileSync(path.join(REPO, "loader/ZentralPerformanceSwitch.js"), "utf8");

const PINNED_PREF = "zen.workspace.zentral.boost.unload_pinned";

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ---------------- a fake tab, with the attributes a real record tab carries ---------------- */

function tab({ attrs = [], pinned = false, url = "https://example.com/", lastAccessed = 0,
  soundPlaying = false, sharing = null, pip = false, selected = false } = {}) {
  const attrSet = new Set(attrs);
  if (pinned) attrSet.add("pinned");
  const element = {
    closing: false,
    isConnected: true,
    hidden: false,
    linkedPanel: "panel-1",
    linkedBrowser: { currentURI: { spec: url }, isPictureInPicture: pip, audioPlaybackActive: false },
    lastAccessed,
    soundPlaying,
    selected,
    _sharingState: sharing,
    label: url,
    hasAttribute: (name) => attrSet.has(name),
    getAttribute: (name) => (name === "zen-dormant" ? null : attrSet.has(name) ? "" : null),
    matches: () => attrSet.has("bgalazka-addon-host") || attrSet.has("bgalazka-addon-host-fallback"),
    _attrs: attrSet,
  };
  element.pinned = pinned;
  return element;
}

// A record whose tab is pinned (default) or `zen-essential` — never the empty-attrs fixture
// that used to hide this whole class of bug.
function record(id, mode, spec = {}) {
  const { attrs = ["pinned"], ...tabSpec } = spec;
  return {
    app: { id, name: id, url: "https://example.com/" },
    tab: tab({ attrs: [...attrs], pinned: attrs.includes("pinned"), ...tabSpec }),
    backgroundMode: mode,
  };
}

/* ---------------- the real module, in a fake chrome window ---------------- */

function boot({ prefs = {}, tabs = [], panels = [], readings = [900] } = {}) {
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    ...prefs,
  }));
  const timers = new Map();
  let timerId = 0;
  let registration = null;
  let readingIndex = 0;
  const unloadCalls = [];
  const loaded = [];
  const events = [];
  const observers = new Map();

  const gBrowser = {
    tabs,
    selectedTab: null,
    explicitUnloadTabs: async (list) => {
      for (const t of list) {
        unloadCalls.push(t);
        t.linkedPanel = null;
        t._attrs.add("pending");
      }
      return true;
    },
  };

  const win = {
    gBrowser,
    Services: {
      prefs: {
        getBoolPref: (k, d) => (store.has(k) ? Boolean(store.get(k)) : d),
        getStringPref: (k, d) => (store.has(k) ? String(store.get(k)) : d),
        getIntPref: (k, d) => (store.has(k) ? Number(store.get(k)) : d),
        setBoolPref: (k, v) => {
          store.set(k, v);
          for (const fn of observers.get(k) || []) fn({}, "", k);
        },
        addObserver: (key, observer) => {
          if (!observers.has(key)) observers.set(key, new Set());
          observers.get(key).add(observer.observe ? observer.observe.bind(observer) : observer);
        },
        removeObserver: (key, observer) => observers.get(key)?.delete(observer),
      },
      appinfo: { OS: "Linux" },
      obs: { addObserver() {}, removeObserver() {} },
    },
    Cc: { "@mozilla.org/memory-reporter-manager;1": { getService: () => ({ minimizeMemoryUsage: (cb) => cb?.run?.() }) } },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: { getTabState: (t) => JSON.stringify({ entries: [{ url: t.linkedBrowser?.currentURI?.spec || "" }], index: 1 }) },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback: () => 1,
    addEventListener() {},
    removeEventListener() {},
    console: { warn() {}, log() {}, error() {} },
    ZentralRuntime: { register: (def) => { registration = def; } },
  };
  win.window = win;
  win.globalThis = win;
  const essentialPanels = new Map();
  for (const rec of panels) essentialPanels.set(rec.app.id, rec);
  win.Zentral = {
    Panels: {
      essentialPanels,
      loadEssentialInBackground: (rec, automatic) => { loaded.push({ id: rec.app.id, automatic }); return true; },
      saveEssentialSettings: () => true,
      syncAppPanelBrowserActivity() {},
    },
  };

  // The shared pause switch, exactly as the runtime publishes it (Game Mode reads it).
  const switchSandbox = { window: {}, console };
  vm.createContext(switchSandbox);
  vm.runInContext(SWITCH_SRC, switchSandbox, { filename: "ZentralPerformanceSwitch.js" });
  win.ZentralRuntime.performance = switchSandbox.window.ZentralPerformanceSwitch.create();

  const context = vm.createContext({
    ...win,
    ChromeUtils: {
      requestProcInfo: () => ({ memory: readings[Math.min(readingIndex++, readings.length - 1)] * MB }),
      forceGC() {}, forceCC() {},
    },
    Cc: win.Cc, Ci: win.Ci, console: win.console,
    Promise, Set, Map, WeakMap, WeakSet, Array, Object, Number, Math, String, Symbol, Error, TypeError, Date, JSON,
    globalThis: win,
  });
  win.ZentralTabPolicy = (() => {
    const w = {};
    w.window = w;
    vm.runInNewContext(POLICY_SRC, { window: w, globalThis: w, console });
    return w.ZentralTabPolicy;
  })();
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  assert.ok(registration?.init, "the module registers a feature");
  registration.init();
  const api = win.ZentralBoost;
  assert.ok(api, "the API is published");
  api.onLimiterEvent((event) => events.push(event));

  return {
    api, win, gBrowser, store, panels, unloadCalls, loaded, events, timers,
    destroy: () => api.destroy(),
    // Fire Level 2's 3 s settle timers until no run is pending.
    async settle() {
      for (let round = 0; round < 20; round++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const due = [...timers].filter(([, t]) => t.ms === 3000);
        for (const [id, t] of due) { timers.delete(id); t.fn(); }
        await Promise.resolve();
      }
    },
    async fire(ms) {
      const due = [...timers].filter(([, t]) => t.ms === ms);
      for (const [id, t] of due) { timers.delete(id); t.fn(); }
      for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      return due.length;
    },
  };
}

const urls = (h) => h.unloadCalls.map((t) => t.linkedBrowser?.currentURI?.spec).sort();
const wasUnloaded = (h, t) => h.unloadCalls.includes(t);

/* ---------------- F1 (a)-(f), Level 2 ---------------- */

test("F1 (a): a live pinned record is not unloaded when keep_pinned is false", async () => {
  const live = record("messenger", "live", { url: "https://messenger.example/" });
  const h = boot({ tabs: [live.tab], panels: [live] });
  const pending = h.api.runLevel2();
  await h.settle();
  await pending;
  assert.equal(wasUnloaded(h, live.tab), false, "the owner's live record stays loaded");
  h.destroy();
});

test("F1 (b): a live pinned record is STILL not unloaded when keep_pinned is TRUE", async () => {
  const live = record("messenger", "live", { url: "https://messenger.example/" });
  const h = boot({ tabs: [live.tab], panels: [live], prefs: { [PINNED_PREF]: true } });
  const pending = h.api.runLevel2();
  await h.settle();
  const result = await pending;
  assert.equal(wasUnloaded(h, live.tab), false, "the tab loop must never decide for a record");
  assert.equal(result.unloaded.panels, 0);
  h.destroy();
});

test("F1 (c): an asleep-allowed pinned record IS unloaded with keep_pinned false, exactly once", async () => {
  const asleep = record("arena", "asleep-allowed", { url: "https://arena.example/" });
  const h = boot({ tabs: [asleep.tab], panels: [asleep] });
  const pending = h.api.runLevel2();
  await h.settle();
  const result = await pending;
  assert.equal(wasUnloaded(h, asleep.tab), true, "the mode is the person's explicit consent");
  assert.equal(h.unloadCalls.filter((t) => t === asleep.tab).length, 1, "owned by the panel loop only");
  // R1: these fixtures carry no panel browser, so the page lived in its record TAB: counted once, as a tab.
  assert.equal(result.unloaded.panels, 0, "no panel holder existed, so it is not an app");
  assert.equal(result.unloaded.tabs, 1, "counted once, by the panel loop's holder classification");
  h.destroy();
});

test("F1 (d): a throttled record is not unloaded, even with keep_pinned true", async () => {
  const throttled = record("arena", "throttled", { url: "https://arena.example/" });
  const h = boot({ tabs: [throttled.tab], panels: [throttled], prefs: { [PINNED_PREF]: true } });
  const pending = h.api.runLevel2();
  await h.settle();
  await pending;
  assert.equal(wasUnloaded(h, throttled.tab), false);
  h.destroy();
});

test("F1 (e): Stronger saver sleeps every record, whatever its mode", async () => {
  const live = record("whatsapp", "live", { url: "https://whatsapp.example/" });
  const throttled = record("messenger", "throttled", { url: "https://messenger.example/" });
  const asleep = record("arena", "asleep-allowed", { url: "https://arena.example/" });
  const h = boot({ tabs: [live.tab, throttled.tab, asleep.tab], panels: [live, throttled, asleep] });
  const pending = h.api.runLevel2({ allowTabs: false, allowModes: ["live", "throttled", "asleep-allowed"] });
  await h.settle();
  const result = await pending;
  // R1: no panel browser exists in this fixture, so all three pages lived in their record TABs.
  assert.equal(result.unloaded.tabs, 3, "the switch IS the consent for all three");
  assert.equal(result.unloaded.panels, 0, "none of them had a panel holder");
  assert.deepEqual(urls(h), ["https://arena.example/", "https://messenger.example/", "https://whatsapp.example/"]);
  h.destroy();
});

test("F1 (f): an audible or selected record is never unloaded in any mode", async () => {
  const audible = record("music", "asleep-allowed", { url: "https://music.example/", soundPlaying: true });
  const selected = record("selected", "live", { url: "https://selected.example/" });
  const h = boot({ tabs: [audible.tab, selected.tab], panels: [audible, selected],
    prefs: { [PINNED_PREF]: true } });
  h.gBrowser.selectedTab = selected.tab;
  const pending = h.api.runLevel2({ allowModes: ["live", "throttled", "asleep-allowed"] });
  await h.settle();
  await pending;
  assert.equal(wasUnloaded(h, audible.tab), false, "audible beats any mode");
  assert.equal(wasUnloaded(h, selected.tab), false, "selected beats any mode");
  h.destroy();
});

test("F1: the same rules hold for zen-essential record tabs (not only pinned ones)", async () => {
  const live = record("messenger", "live", { attrs: ["zen-essential"], url: "https://messenger.example/" });
  const asleep = record("arena", "asleep-allowed", { attrs: ["zen-essential"], url: "https://arena.example/" });
  const h = boot({ tabs: [live.tab, asleep.tab], panels: [live, asleep] });
  const pending = h.api.runLevel2();
  await h.settle();
  const result = await pending;
  assert.equal(wasUnloaded(h, live.tab), false, "essential-live is still refused for a live record");
  assert.equal(wasUnloaded(h, asleep.tab), true, "but the mode waives it for an asleep-allowed record");
  // R1: no panel browser in this fixture, so the freed holder is the tab.
  assert.equal(result.unloaded.tabs, 1);
  assert.equal(result.unloaded.panels, 0, "no panel holder existed");
  h.destroy();
});

/* ---------------- the limiter and Game Mode take the same path ---------------- */

test("F1: the limiter never unloads a live record, even with keep_pinned true", async () => {
  const live = record("whatsapp", "live", { url: "https://whatsapp.example/" });
  const old = tab({ url: "https://old.example/", lastAccessed: 1 });
  const h = boot({
    tabs: [live.tab, old], panels: [live], readings: [5000, 4800, 4800, 4800],
    prefs: {
      [PINNED_PREF]: true,
      "zen.workspace.zentral.boost.limit_enabled": true,
      "zen.workspace.zentral.boost.limit_mb": 100,
      "zen.workspace.zentral.boost.limit_mode": "hard",
      "zen.workspace.zentral.boost.limit_cooldown_s": 0,
      "zen.workspace.zentral.boost.limit_target_pct": 85,
    },
  });
  await h.fire(60000);
  await h.settle();
  assert.equal(h.api.limiterState().lastAction, "unload", "the limiter really ran a hard pass");
  assert.equal(wasUnloaded(h, live.tab), false, "the limiter's deep pass obeys the mode");
  assert.equal(wasUnloaded(h, old), true, "an ordinary old tab is still fair game");
  h.destroy();
});

test("F1/G8: Game Mode's plan-driven pass sleeps a live record, while Level 2 still obeys its mode", async () => {
  const live = record("messenger", "live", { url: "https://messenger.example/" });
  const old = tab({ url: "https://old.example/", lastAccessed: 1 });
  const h = boot({
    tabs: [live.tab, old], panels: [live],
    prefs: { [PINNED_PREF]: true, "zen.workspace.zentral.boost.game_park_selected": false },
  });
  h.api.setGameMode(true);
  await h.settle();
  assert.equal(wasUnloaded(h, live.tab), true, "Game Mode is the consent and sleeps the live record through G1's door");
  assert.equal(wasUnloaded(h, old), true, "the planned ordinary tab sleeps too");
<<<<<<< HEAD
  assert.equal(h.api.gameModeState().unloaded.panels, 1, "the G8 report counts one slept panel");
=======
  // R1: the fixture has no panel browser, so Game Mode freed the record tab (not an app) plus the old tab.
  assert.equal(h.api.gameModeState().unloaded.panels, 0, "no panel holder existed");
  assert.equal(h.api.gameModeState().unloaded.tabs, 2, "the record tab and the planned ordinary tab");
>>>>>>> 3e6d7d32ec15c70a605d41b01dd18c88b7eb08db
  h.api.setGameMode(false);
  h.destroy();
});

/* ---------------- no collateral change ---------------- */

test("F1: an ordinary pinned tab still follows the pref, and TabUnload's policy answers are unchanged", async () => {
  const plain = tab({ url: "https://plain.example/", pinned: true });
  const off = boot({ tabs: [plain] });
  let pending = off.api.runLevel2();
  await off.settle();
  await pending;
  assert.equal(wasUnloaded(off, plain), false, "off by default, exactly as before");
  off.destroy();

  const plain2 = tab({ url: "https://plain.example/", pinned: true });
  const on = boot({ tabs: [plain2], prefs: { [PINNED_PREF]: true } });
  pending = on.api.runLevel2();
  await on.settle();
  await pending;
  assert.equal(wasUnloaded(on, plain2), true, "the person's pref still opens an ordinary pinned tab");
  on.destroy();

  const p = (() => {
    const w = {}; w.window = w;
    vm.runInNewContext(POLICY_SRC, { window: w, globalThis: w, console });
    return w.ZentralTabPolicy;
  })();
  assert.equal(p.isUnloadable(tab({ pinned: true }), {}).reason, "pinned-kept");
  assert.equal(p.isUnloadable(tab({ pinned: true }), { keepPinned: true }).allowed, true);
});

test("F1: the policy names the panel-record ownership reason for a record without consent", () => {
  const p = (() => {
    const w = {}; w.window = w;
    vm.runInNewContext(POLICY_SRC, { window: w, globalThis: w, console });
    return w.ZentralTabPolicy;
  })();
  const pinned = tab({ pinned: true });
  assert.equal(p.isUnloadable(pinned, { isPanelRecord: true }).reason, "panel-record",
    "a record tab without the mode's consent is refused with its own named reason");
  assert.equal(p.isUnloadable(pinned, { isPanelRecord: true }).allowed, false);
  assert.equal(p.isUnloadable(pinned, { isPanelRecord: true, panelConsent: true }).allowed, true,
    "consent waives only the pinned/Essential rule");
  // Other never-rules still win over consent.
  assert.equal(p.isUnloadable(tab({ pinned: true, soundPlaying: true }), { isPanelRecord: true, panelConsent: true }).reason, "audible");
  assert.equal(p.isUnloadable(tab({ attrs: ["pending"], pinned: true }), { isPanelRecord: true, panelConsent: true }).reason, "pending");
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-111-panel-record-modes (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
