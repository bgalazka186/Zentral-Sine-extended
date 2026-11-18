"use strict";
/* OW-91 (plan B4): the deep pass, its policy table, Restore, the panel background modes and the one shortcut.
 *
 * The policy table is the part that matters most, because every "never" in it is a way to lose somebody's page or
 * silence their music. It is proven first, as a table: one row per rule, one reason each. Then the module's own deep
 * pass is run against a fake browser, and Restore is proven to wake exactly what it put to sleep. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const POLICY_SRC = fs.readFileSync(path.join(REPO, "loader/ZentralTabPolicy.js"), "utf8");
const BOOST_SRC = fs.readFileSync(path.join(REPO, "additional/boost/ZentralBoost.uc.js"), "utf8");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ---------------- the policy table, on its own ---------------- */

function loadPolicy() {
  const win = {};
  win.window = win;
  vm.runInNewContext(POLICY_SRC, { window: win, globalThis: win, console });
  assert.ok(win.ZentralTabPolicy, "the policy publishes itself on the window");
  return win.ZentralTabPolicy;
}

// A tab element, as the policy sees one. `attrs` are the attributes Gecko and Zen put on a real tab.
function tab({
  attrs = [], linkedPanel = "panel1", closing = false, connected = true, hidden = false, pinned = false,
  url = "https://example.com/", lastAccessed = 0, soundPlaying = false, sharing = null, pip = false,
  dormantValue = null,
} = {}) {
  const attrSet = new Set(attrs);
  if (pinned) attrSet.add("pinned");
  const element = {
    closing,
    isConnected: connected,
    hidden,
    linkedPanel,
    lastAccessed,
    soundPlaying,
    _sharingState: sharing,
    linkedBrowser: { currentURI: { spec: url }, isPictureInPicture: pip },
    hasAttribute: (name) => attrSet.has(name),
    getAttribute: (name) => (name === "zen-dormant" ? dormantValue : attrSet.has(name) ? "" : null),
    matches: () => attrSet.has("bgalazka-addon-host") || attrSet.has("bgalazka-addon-host-fallback"),
    _attrs: attrSet,
  };
  // `pinned` is a property on a real tab, not only an attribute.
  element.pinned = pinned;
  return element;
}

test("the policy table: every never-rule has its own reason", () => {
  const p = loadPolicy();
  const cases = [
    [null, {}, "no-tab"],
    [tab({ closing: true }), {}, "closing"],
    [tab({ connected: false }), {}, "not-connected"],
    [tab({ linkedPanel: null }), {}, "no-panel"],
    [tab({ attrs: ["pending"] }), {}, "pending"],
    [tab({ attrs: ["discarded"] }), {}, "discarded"],
    [tab({ attrs: ["zen-dormant"], dormantValue: "true" }), {}, "dormant"],
    [tab(), { selectedTab: "SELF" }, "selected"],
    [tab({ attrs: ["bgalazka-addon-host"] }), {}, "addon-host"],
    [tab({ url: "about:blank#zn-note:abc" }), {}, "notes-placeholder"],
    [tab({ url: "about:blank", attrs: ["bgalazka-notes-item"] }), {}, "notes-placeholder"],
    [tab({ hidden: true }), {}, "hidden-panel"],
    [tab({ pip: true }), {}, "picture-in-picture"],
    [tab({ sharing: { screen: "window:1" } }), {}, "sharing"],
    [tab({ soundPlaying: true }), {}, "audible"],
    [tab({ pinned: true }), { keepPinned: false }, "pinned-kept"],
    [tab({ attrs: ["zen-essential"] }), {}, "essential-live"],
  ];
  for (const [element, extra, reason] of cases) {
    // `selected` needs the tab itself, which is the only place a self-reference makes sense.
    const ctx = extra.selectedTab === "SELF" ? { selectedTab: element } : extra;
    const verdict = p.isUnloadable(element, ctx);
    assert.equal(verdict.allowed, false, reason + " is never unloaded");
    assert.equal(verdict.reason, reason, "and says why");
  }
});

test("an ordinary background tab is unloadable, and an old placeholder rule does not leak", () => {
  const p = loadPolicy();
  const allowed = p.isUnloadable(tab(), {});
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, "allowed");
  // A tab whose live URL is an ordinary one is never a placeholder, even with a stale marker attribute: the URL is
  // authoritative, which is what makes a reused web tab eligible again.
  const reused = tab({ attrs: ["bgalazka-notes-item"], url: "https://example.com/real" });
  assert.equal(p.isUnloadable(reused, {}).allowed, true, "a live URL wins over a stale marker");
  // A pinned tab is unloadable when the person said so.
  assert.equal(p.isUnloadable(tab({ pinned: true }), { keepPinned: true }).allowed, true);
  // The video preview's source tab is protected even though it is an ordinary tab.
  const source = tab();
  assert.equal(p.isUnloadable(source, { videoSourceTab: source }).reason, "video-source");
});

test("the successor rule keeps the selection on something safe", () => {
  const p = loadPolicy();
  const current = tab();
  assert.equal(p.isSuccessorCandidate(current, current), false, "a tab cannot succeed itself");
  assert.equal(p.isSuccessorCandidate(tab({ hidden: true }), current), false, "a hidden panel host never holds selection");
  assert.equal(p.isSuccessorCandidate(tab({ attrs: ["bgalazka-addon-host"] }), current), false);
  assert.equal(p.isSuccessorCandidate(tab({ url: "about:blank#zn-agenda-x" }), current), false);
  assert.equal(p.isSuccessorCandidate(tab({ linkedPanel: null }), current), false);
  assert.equal(p.isSuccessorCandidate(tab(), current), true);
});

test("oldest first, and a tab with no timestamp sorts as the oldest", () => {
  const p = loadPolicy();
  const list = [
    { name: "new", lastAccessed: 300 },
    { name: "unknown", lastAccessed: undefined },
    { name: "old", lastAccessed: 100 },
    { name: "mid", lastAccessed: 200 },
  ].sort(p.byOldestFirst);
  assert.deepEqual(list.map((x) => x.name), ["unknown", "old", "mid", "new"]);
});

/* ---------------- the module's deep pass, against a fake browser ---------------- */

function bootBoost({ prefs = {}, tabs = [], panels = [], sessionUrls = {} } = {}) {
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    ...prefs,
  }));
  const timers = new Map();
  let timerId = 0;
  const listeners = new Map();
  const unloadCalls = [];
  const loaded = [];
  const saved = [];
  let registration = null;

  const makeTab = (spec) => {
    const t = tab(spec);
    t.label = spec.label || spec.url || "tab";
    return t;
  };
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
        getStringPref: (k, d) => (store.has(k) ? String(store.get(k)) : d),
        setBoolPref: (k, v) => store.set(k, v),
        addObserver() {},
        removeObserver() {},
      },
      appinfo: { OS: "Linux" },
      obs: { addObserver() {}, removeObserver() {} },
    },
    Cc: {
      "@mozilla.org/memory-reporter-manager;1": {
        getService: () => ({ minimizeMemoryUsage: (cb) => cb.run() }),
      },
    },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: {
      getTabState: (t) => JSON.stringify({ entries: [{ url: sessionUrls[t._id] || t.linkedBrowser?.currentURI?.spec || "" }], index: 1 }),
    },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback: () => 1,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    console: { warn() {}, log() {}, error() {} },
    ZentralRuntime: { register: (def) => { registration = def; } },
  };
  win.window = win;
  win.globalThis = win;
  // The panel layer, as the full pack publishes it.
  const essentialPanels = new Map();
  for (const record of panels) essentialPanels.set(record.app.id, record);
  win.Zentral = {
    Panels: {
      essentialPanels,
      loadEssentialInBackground: (record, automatic) => {
        loaded.push({ id: record.app.id, automatic });
        return true;
      },
      saveEssentialSettings: (record) => {
        saved.push({ id: record.app.id, backgroundMode: record.backgroundMode });
      },
    },
  };

  const context = vm.createContext({
    ...win,
    ChromeUtils: { requestProcInfo: () => ({ memory: 900 }), forceGC() {}, forceCC() {} },
    Cc: win.Cc, Ci: win.Ci, console: win.console, Promise, Set, Map, WeakMap, Array, Object, Number, Math, String,
    Symbol, Error, TypeError, Date, JSON, globalThis: win,
  });
  // The policy is embedded in the real standalone build; here it is loaded the same way, before the module.
  win.ZentralTabPolicy = loadPolicy();
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  assert.ok(registration?.init, "the module registers a feature");
  registration.init();
  const api = win.ZentralBoost;
  assert.ok(api, "the API is published");

  return {
    win, api, gBrowser, store, unloadCalls, loaded, saved,
    destroy: () => api.destroy(),
    // Run the settle timers Level 2 arms (its after reading). The unload loop is async, so the timer does not exist
    // yet when the call returns: a real macrotask lets the loop finish first, then the 3 s timer is fired — twice, the
    // way the module arms it (once after the sleep, once for the reading).
    async settle() {
      let fired = 0;
      for (let round = 0; round < 12; round++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const due = [...timers].filter(([, t]) => t.ms === 3000);
        for (const [id, t] of due) {
          timers.delete(id);
          t.fn();
          fired += 1;
        }
        await Promise.resolve();
      }
      return fired;
    },
    fireKey(event) {
      for (const fn of listeners.get("keydown") || []) fn({ type: "keydown", ...event });
    },
  };
}

// OW-111: a real Essential-panel record's tab is pinned (or zen-essential). The old fixture built BOTH branches of
// its `attrs` ternary as `[]`, so no test ever exercised the policy's pinned/Essential rule against a record tab.
// `recordTab: false` is available only for the legacy source-rule checks that need an ordinary tab.
const panelRecord = (id, mode, spec = {}) => {
  const { recordTab = true, ...tabSpec } = spec;
  return {
    app: { id, name: id, url: "https://example.com/" },
    tab: tab({ attrs: recordTab ? ["pinned"] : [], pinned: recordTab, url: "https://example.com/", ...tabSpec }),
    backgroundMode: mode,
  };
};

test("a deep pass unloads ordinary background tabs and leaves every protected one alone", async () => {
  const selected = tab({ url: "https://selected.example/" });
  const audible = tab({ url: "https://music.example/", soundPlaying: true });
  const pinned = tab({ url: "https://pinned.example/", pinned: true });
  const old = tab({ url: "https://old.example/", lastAccessed: 10 });
  const fresh = tab({ url: "https://fresh.example/", lastAccessed: 900 });
  const discarded = tab({ url: "https://done.example/", linkedPanel: null });
  const h = bootBoost({ tabs: [selected, audible, pinned, old, fresh, discarded] });
  h.gBrowser.selectedTab = selected;
  const pending = h.api.runLevel2();
  await h.settle();
  const result = await pending;
  assert.equal(result.by, "level2");
  assert.deepEqual(h.unloadCalls.map((t) => t.linkedBrowser?.currentURI?.spec), [
    "https://old.example/",
    "https://fresh.example/",
  ], "the selected, audible, pinned and already-asleep tabs are all left alone");
  assert.equal(result.unloaded.tabs, 2);
  assert.equal(result.freedMB, 0, "the fake browser frees nothing, and the number says so");
  h.destroy();
});

test("oldest first: the tab nobody touched in hours goes before the one from a minute ago", async () => {
  const a = tab({ url: "https://a/", lastAccessed: 5000 });
  const b = tab({ url: "https://b/", lastAccessed: 1 });
  const c = tab({ url: "https://c/", lastAccessed: 2500 });
  const h = bootBoost({ tabs: [a, b, c] });
  h.gBrowser.selectedTab = null;
  const pending = h.api.runLevel2();
  await h.settle();
  await pending;
  assert.deepEqual(h.unloadCalls.map((t) => t.linkedBrowser.currentURI.spec), ["https://b/", "https://c/", "https://a/"]);
  h.destroy();
});

test("pinned and Essential tabs join only when the person said so", async () => {
  const pinned = tab({ url: "https://pinned/", pinned: true });
  const essential = tab({ url: "https://essential/", attrs: ["zen-essential"] });
  const off = bootBoost({ tabs: [pinned, essential] });
  off.gBrowser.selectedTab = null;
  let pending = off.api.runLevel2();
  await off.settle();
  await pending;
  assert.equal(off.unloadCalls.length, 0, "off by default: a shortlist stays where it is");
  off.destroy();

  const on = bootBoost({
    tabs: [tab({ url: "https://pinned/", pinned: true }), tab({ url: "https://essential/", attrs: ["zen-essential"] })],
    prefs: { "zen.workspace.zentral.boost.keep_pinned": true },
  });
  on.gBrowser.selectedTab = null;
  pending = on.api.runLevel2();
  await on.settle();
  await pending;
  assert.equal(on.unloadCalls.length, 2, "asked for, delivered");
  on.destroy();
});

test("panels sleep only when their own mode allows it, and Restore wakes exactly those", async () => {
  const live = panelRecord("live-app", "live");
  const throttled = panelRecord("throttled-app", "throttled");
  const asleep = panelRecord("asleep-app", "asleep-allowed");
  const h = bootBoost({ tabs: [], panels: [live, throttled, asleep] });
  h.gBrowser.selectedTab = null;
  const pending = h.api.runLevel2();
  await h.settle();
  const result = await pending;
  assert.equal(result.unloaded.panels, 1, "only the record marked asleep-allowed");
  assert.equal(h.unloadCalls.length, 1);
  assert.equal(h.api.undoSize(), 1, "the record is remembered for Restore");
  const restored = h.api.restore();
  assert.equal(restored.panels, 1, "Restore woke it");
  assert.equal(h.loaded.length, 1, "woken on demand, not as a preload");
  assert.equal(h.loaded[0]?.id, "asleep-app");
  assert.equal(h.loaded[0]?.automatic, false);
  assert.equal(h.api.undoSize(), 0, "and the record is cleared");
  h.destroy();
});

test("OW-111: record tabs obey their mode, not keep_pinned, and are never counted twice", async () => {
  // These record tabs are real gBrowser.tabs, pinned, exactly as Zen shows WhatsApp/Messenger/arena.ai.
  // Before OW-111: keep_pinned true let the TAB loop sleep all three; keep_pinned false stopped even the
  // asleep-allowed one. Both are wrong. The dedicated suite (`ow-111-panel-record-modes.test.cjs`) covers the
  // limiter and Game Mode; this is the Level 2 seam in the module's own deep-pass suite.
  const live = panelRecord("live-app", "live", { url: "https://live.example/" });
  const throttled = panelRecord("throttled-app", "throttled", { url: "https://throttled.example/" });
  const asleep = panelRecord("asleep-app", "asleep-allowed", { url: "https://asleep.example/" });
  const h = bootBoost({
    tabs: [live.tab, throttled.tab, asleep.tab],
    panels: [live, throttled, asleep],
    prefs: { "zen.workspace.zentral.boost.keep_pinned": true },
  });
  h.gBrowser.selectedTab = null;
  const pending = h.api.runLevel2();
  await h.settle();
  const result = await pending;
  assert.deepEqual(h.unloadCalls.map((t) => t.linkedBrowser?.currentURI?.spec), ["https://asleep.example/"],
    "only the consenting record: keep_pinned true must not wake a live record into the tab loop");
  assert.equal(result.unloaded.tabs, 0, "a record tab is never an ordinary tab too");
  assert.equal(result.unloaded.panels, 1);
  h.destroy();
});

test("a build without the policy refuses the deep pass instead of guessing", async () => {
  const h = bootBoost({ tabs: [tab({ url: "https://a/" })] });
  h.gBrowser.selectedTab = null;
  delete h.win.ZentralTabPolicy;
  const result = await h.api.runLevel2();
  assert.equal(result, null, "no policy, no deep pass");
  assert.equal(h.unloadCalls.length, 0, "and nothing was touched");
  assert.equal(h.api.state().policy, false, "the state says why");
  h.destroy();
});

test("the background mode of a record is read, defaulted and written through the panel layer", async () => {
  const live = panelRecord("plain", "");
  const h = bootBoost({ panels: [live] });
  assert.equal(h.api.backgroundModeOf(live), "live", "an existing record without a mode is live");
  assert.equal(h.api.backgroundModeOf(panelRecord("t", "throttled")), "throttled");
  assert.equal(h.api.backgroundModeOf(panelRecord("junk", "nonsense")), "live", "junk is not a mode");
  const changed = h.api.setBackgroundMode("plain", "asleep-allowed");
  // Objects built inside the module's own realm do not share this realm's prototypes, so the fields are compared, not
  // the object (a `deepEqual` on a cross-realm object is a false failure waiting to happen).
  assert.equal(changed?.appId, "plain");
  assert.equal(changed?.mode, "asleep-allowed");
  assert.equal(h.saved.length, 1, "saved through the panel module's own writer");
  assert.equal(h.saved[0]?.id, "plain");
  assert.equal(h.saved[0]?.backgroundMode, "asleep-allowed");
  assert.equal(h.api.setBackgroundMode("plain", "nonsense"), null, "an unknown mode is refused, not stored");
  assert.equal(h.api.setBackgroundMode("nope", "live"), null, "an unknown record is refused too");
  h.destroy();
});

test("the undo record is capped and never grows without bound", async () => {
  const tabs = Array.from({ length: 60 }, (_, i) => tab({ url: `https://t${i}/`, lastAccessed: i }));
  const h = bootBoost({ tabs });
  h.gBrowser.selectedTab = null;
  const pending = h.api.runLevel2();
  await h.settle();
  const result = await pending;
  assert.equal(result.unloaded.tabs, 60);
  assert.equal(h.api.undoSize(), 50, "fifty is the cap the plan names");
  assert.equal(result.undoSize, 50);
  h.destroy();
});

/* ---------------- the shortcut ---------------- */

test("a shortcut needs two keys, and an empty one installs nothing", () => {
  const h = bootBoost({ prefs: { "zen.workspace.zentral.boost.shortcut": "" } });
  assert.equal(h.api.state().shortcut, "", "empty means none");
  h.destroy();

  const single = bootBoost({ prefs: { "zen.workspace.zentral.boost.shortcut": "B" } });
  assert.equal(single.api.state().shortcut, "", "a single key can never swallow ordinary typing");
  single.destroy();

  const good = bootBoost({ prefs: { "zen.workspace.zentral.boost.shortcut": "Accel+Shift+B" } });
  assert.equal(good.api.state().shortcut, "set", "a real combination is accepted");
  good.destroy();
});

test("the shortcut runs the light pass and nothing else", async () => {
  const h = bootBoost({
    prefs: { "zen.workspace.zentral.boost.shortcut": "Accel+Shift+B" },
    tabs: [tab({ url: "https://a/" })],
  });
  let prevented = 0;
  h.fireKey({ ctrlKey: true, shiftKey: true, key: "B", code: "KeyB", preventDefault: () => { prevented += 1; }, stopPropagation() {} });
  assert.equal(prevented, 1, "the browser's own binding is not allowed to fire as well");
  await h.settle();
  assert.equal(h.unloadCalls.length, 0, "a keystroke never unloads a tab");
  // A key that is not the combination does nothing at all.
  const before = prevented;
  h.fireKey({ key: "B", code: "KeyB", preventDefault: () => { prevented += 1; }, stopPropagation() {} });
  assert.equal(prevented, before, "no modifier, no match");
  h.destroy();
});

/* ---------------- the module's rules stay true ---------------- */

test("the deep pass keeps the plan's rules in the source", () => {
  const level2 = BOOST_SRC.slice(BOOST_SRC.indexOf("async function runLevel2"), BOOST_SRC.indexOf("function restore()"));
  assert.ok(level2.length > 1500, "runLevel2 exists");
  assert.equal(/setInterval/.test(BOOST_SRC), false, "still no interval anywhere");
  assert.match(level2, /byOldestFirst/, "tabs are taken oldest first");
  assert.match(level2, /asleep-allowed/, "panels only when their mode allows it");
  assert.match(level2, /explicitUnloadTabs/, "sleep uses the documented API");
  assert.match(level2, /discardBrowser/, "with the documented fallback");
  assert.equal(/closeApp|removeTab/.test(level2), false, "a deep pass never closes anything");
  // Every "never" in the plan is a reason string in the policy, so a future edit has to name what it is dropping.
  for (const reason of ["selected", "audible", "sharing", "picture-in-picture", "video-source", "pending"]) {
    assert.ok(POLICY_SRC.includes(`"${reason}"`) || POLICY_SRC.includes(`${reason}:`), reason + " is a named rule");
  }
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-91-boost-deep (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
