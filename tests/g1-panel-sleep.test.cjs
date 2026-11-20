"use strict";
/* G1 — real panel sleep and wake. RED on the pre-G1 tree: Boost used to call
 * gBrowser.explicitUnloadTabs([record.tab]) only, so a pending tab could still
 * hold WhatsApp/Messenger/arena.ai fully loaded in the panel's own <browser>.
 * This suite boots the real ZentralBoost.uc.js in a fake window with the panel
 * layer, the Apps singleton and the shared tab policy, then proves the one
 * sleep door frees BOTH holders and Restore wakes through the existing path.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const MB = 1_000_000;

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");
const BUNDLE_SRC = read("additional/boost/ZentralBoost.standalone.uc.js");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function loadPolicy() {
  const w = {};
  w.window = w;
  vm.runInNewContext(POLICY_SRC, { window: w, globalThis: w, console });
  return w.ZentralTabPolicy;
}

function tab(spec = {}) {
  const attrs = new Set(spec.attrs || []);
  if (spec.pinned) attrs.add("pinned");
  const element = {
    closing: false,
    isConnected: spec.connected !== false,
    hidden: false,
    linkedPanel: attrs.has("pending") || attrs.has("discarded") ? null : "panel1",
    linkedBrowser: {
      currentURI: { spec: spec.url || "https://example.com/" },
      isPictureInPicture: false,
      audioPlaybackActive: false,
    },
    lastAccessed: spec.lastAccessed || 0,
    soundPlaying: Boolean(spec.soundPlaying),
    _sharingState: null,
    label: spec.label || spec.url || "tab",
    pinned: Boolean(spec.pinned),
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => (attrs.has(name) ? "" : null),
    matches: () => false,
    _attrs: attrs,
  };
  return element;
}
const recordFor = (id, spec = {}) => ({
  app: { id, name: id, url: "https://example.com/" },
  tab: tab(spec.tab || { pinned: true }),
  backgroundMode: spec.mode || "asleep-allowed",
});
const browserFor = (id) => ({
  _bgalazkaAppId: id,
  isConnected: true,
  isRemoteBrowser: true,
  docShellIsActive: true,
  renderLayers: true,
  currentURI: { spec: "https://example.com/" },
});

function bootBoost({ tabs = [], records = [], browsers = [], prefs = {} } = {}) {
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    ...prefs,
  }));
  const timers = new Map();
  let timerId = 0;
  let registration = null;
  const unloadCalls = [];
  const closeCalls = [];
  const wakeCalls = [];
  const appBrowsers = new Map();
  for (const b of browsers) appBrowsers.set(b._bgalazkaAppId, b);
  const essentialPanels = new Map();
  for (const r of records) essentialPanels.set(r.app.id, r);
  const gBrowser = {
    tabs,
    selectedTab: null,
    explicitUnloadTabs: async (list) => {
      unloadCalls.push(...list);
      for (const t of list) {
        t._unloaded = true;
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
        setBoolPref: (k, v) => store.set(k, v),
        prefHasUserValue: (k) => store.has(k),
        addObserver() {}, removeObserver() {},
      },
      appinfo: { OS: "Linux" }, obs: { addObserver() {}, removeObserver() {} },
    },
    Cc: { "@mozilla.org/memory-reporter-manager;1": { getService: () => ({ minimizeMemoryUsage: (cb) => cb?.run?.() }) } },
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    SessionStore: { getTabState: (t) => JSON.stringify({ entries: [{ url: t.linkedBrowser?.currentURI?.spec || "" }], index: 1 }) },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestIdleCallback: () => 1,
    addEventListener() {}, removeEventListener() {},
    console: { warn() {}, log() {}, error() {} },
    ZentralRuntime: { register: (def) => { registration = def; } },
  };
  win.window = win;
  win.globalThis = win;
  win.Zentral = {
    Apps: {
      appBrowsers,
      getAppBrowser: (id) => appBrowsers.get(id) || null,
      closeApp(id) {
        closeCalls.push(id);
        appBrowsers.delete(id);
        for (const r of essentialPanels.values())
          if (r.app.id === id && r.tile) r.tile.dataset.loaded = "false";
      },
      getOrCreateAppBrowser(app) {
        const fresh = browserFor(app.id);
        appBrowsers.set(app.id, fresh);
        return { browser: fresh, isNew: true };
      },
    },
    Panels: {
      essentialPanels,
      getAllAppBrowsers: () => [...appBrowsers.values()],
      loadEssentialInBackground: (record, automatic) => {
        wakeCalls.push({ id: record.app.id, automatic });
        return true;
      },
      saveEssentialSettings() {},
    },
  };
  const context = vm.createContext({
    ...win,
    ChromeUtils: { requestProcInfo: () => ({ memory: 900 * MB }), forceGC() {}, forceCC() {} },
    Cc: win.Cc, Ci: win.Ci, console: win.console,
    Promise, Set, Map, WeakMap, WeakSet, Array, Object, Number, Math, String, Symbol, Error,
    TypeError, Date, JSON, globalThis: win,
  });
  win.ZentralTabPolicy = loadPolicy();
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  assert.ok(registration?.init, "Boost registers a feature");
  registration.init();
  const api = win.ZentralBoost;
  return {
    win, api, gBrowser, appBrowsers, closeCalls, unloadCalls, wakeCalls,
    ctx: {
      keepPinned: false,
      videoSourceTab: null,
      selectedTab: null,
      sessionUrlFor: () => "",
      isHostTab: () => false,
    },
    destroy: () => api.destroy(),
    async settle() {
      for (let round = 0; round < 12; round++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (const [id, t] of [...timers].filter(([, x]) => x.ms === 3000)) {
          timers.delete(id);
          t.fn();
        }
        await Promise.resolve();
      }
    },
  };
}

test("the module exposes one sleepPanelRecord door", () => {
  const h = bootBoost();
  assert.equal(typeof h.api.sleepPanelRecord, "function");
  assert.match(BOOST_SRC, /async function sleepPanelRecord\(record, ctx/);
  assert.match(BUNDLE_SRC, /async function sleepPanelRecord\(record, ctx/, "the standalone bundle carries it");
  assert.match(BOOST_SRC, /apps\.closeApp\(appId\)/);
  h.destroy();
});

test("a live app browser + a pending tab: closeApp once, the tab is not unloaded again", async () => {
  const r = recordFor("whatsapp", { tab: { attrs: ["pending", "pinned"], pinned: true } });
  r.tile = { dataset: { loaded: "true" } };
  const h = bootBoost({ records: [r], browsers: [browserFor("whatsapp")] });
  const out = await h.api.sleepPanelRecord(r, h.ctx);
  assert.equal(out.slept, true);
  assert.equal(out.how, "panel", "only the panel holder was live");
  assert.deepEqual(h.closeCalls, ["whatsapp"]);
  assert.equal(h.unloadCalls.length, 0, "a pending tab is never unloaded twice");
  assert.equal(h.appBrowsers.size, 0, "closeApp removed the browser from state.appBrowsers");
  assert.equal(r.tile.dataset.loaded, "false");
  h.destroy();
});

test("a loaded tab with no app browser: the tab path does all the work", async () => {
  const r = recordFor("direct-tab", { tab: { pinned: true, url: "https://direct.example/" } });
  const h = bootBoost({ records: [r] });
  const out = await h.api.sleepPanelRecord(r, h.ctx);
  assert.equal(out.slept, true);
  assert.equal(out.how, "tab");
  assert.deepEqual(h.closeCalls, [], "no panel browser, no closeApp");
  assert.equal(h.unloadCalls.length, 1);
  assert.equal(h.unloadCalls[0], r.tab);
  h.destroy();
});

test("both holders loaded: panel browser first, then the tab", async () => {
  const r = recordFor("messenger", { tab: { pinned: true, url: "https://messenger.example/" } });
  const h = bootBoost({ records: [r], browsers: [browserFor("messenger")] });
  const out = await h.api.sleepPanelRecord(r, h.ctx);
  assert.equal(out.slept, true);
  assert.equal(out.how, "both");
  assert.deepEqual(h.closeCalls, ["messenger"]);
  assert.equal(h.unloadCalls.length, 1);
  assert.equal(h.appBrowsers.size, 0);
  h.destroy();
});

test("an audible record is never touched: neither closeApp nor unload", async () => {
  const r = recordFor("music", { tab: { soundPlaying: true, pinned: true } });
  const h = bootBoost({ records: [r], browsers: [browserFor("music")] });
  const out = await h.api.sleepPanelRecord(r, h.ctx);
  assert.equal(out.slept, false);
  assert.equal(out.how, "none");
  assert.equal(out.reason, "audible");
  assert.deepEqual(h.closeCalls, []);
  assert.equal(h.unloadCalls.length, 0);
  h.destroy();
});

test("the selected tab and the video preview source keep their panel browser", async () => {
  const selected = recordFor("selected", { tab: { pinned: true } });
  const h1 = bootBoost({ records: [selected], browsers: [browserFor("selected")] });
  h1.gBrowser.selectedTab = selected.tab;
  const out1 = await h1.api.sleepPanelRecord(selected, h1.ctx);
  assert.equal(out1.reason, "selected");
  assert.deepEqual(h1.closeCalls, []);
  h1.destroy();

  const source = recordFor("source", { tab: { pinned: true } });
  const h2 = bootBoost({ records: [source], browsers: [browserFor("source")] });
  const out2 = await h2.api.sleepPanelRecord(source, { ...h2.ctx, videoSourceTab: source.tab });
  assert.equal(out2.reason, "video-source");
  assert.deepEqual(h2.closeCalls, []);
  h2.destroy();
});

test("a record with no live holder reports already-asleep, never a fake count", async () => {
  const r = recordFor("gone", { tab: { attrs: ["pending", "pinned"], pinned: true } });
  const h = bootBoost({ records: [r] });
  const out = await h.api.sleepPanelRecord(r, h.ctx);
  assert.equal(out.slept, false);
  assert.equal(out.how, "none");
  assert.equal(out.reason, "already-asleep");
  h.destroy();
});

test("the deep pass (and Stronger saver's all-modes profile) use the one helper", async () => {
  const asleep = recordFor("asleep-app", { mode: "asleep-allowed", tab: { pinned: true } });
  const live = recordFor("live-app", { mode: "live", tab: { pinned: true } });
  const h = bootBoost({
    tabs: [asleep.tab, live.tab],
    records: [asleep, live],
    browsers: [browserFor("asleep-app"), browserFor("live-app")],
  });
  let pending = h.api.runLevel2();
  await h.settle();
  const plain = await pending;
  assert.equal(plain.unloaded.panels, 1, "a plain deep pass sleeps only the consenting record");
  assert.deepEqual(h.closeCalls, ["asleep-app"]);
  assert.equal(h.unloadCalls.length, 1);

  h.closeCalls.length = 0;
  h.unloadCalls.length = 0;
  pending = h.api.runLevel2({ allowTabs: false, allowModes: ["live", "throttled", "asleep-allowed"] });
  await h.settle();
  const stronger = await pending;
  assert.equal(stronger.unloaded.panels, 1, "Stronger saver opens the live record through the same door");
  assert.deepEqual(h.closeCalls, ["live-app"], "the live app browser was still there; the slept one was not");
  assert.equal(h.unloadCalls.length, 1);
  assert.equal(h.unloadCalls[0], live.tab, "only the live record's loaded tab is unloaded");
  assert.equal(asleep.tab.hasAttribute("pending"), true, "the first record's pending tab is never unloaded again");
  h.destroy();
});

test("Restore wakes with loadEssentialInBackground(record, false) exactly once", async () => {
  const r = recordFor("arena", { mode: "asleep-allowed", tab: { pinned: true } });
  const h = bootBoost({
    tabs: [r.tab], records: [r], browsers: [browserFor("arena")],
  });
  const pending = h.api.runLevel2();
  await h.settle();
  await pending;
  // R1: this record lived in BOTH holders, so it is remembered twice - as a panel and as a tab.
  assert.equal(h.api.undoSize(), 2, "the panel holder and the tab holder are both remembered");
  const restored = h.api.restore();
  assert.equal(restored.panels, 1);
  assert.equal(h.wakeCalls.length, 1);
  assert.equal(h.wakeCalls[0].id, "arena");
  assert.equal(h.wakeCalls[0].automatic, false, "explicit wake, not a preload");
  assert.equal(h.api.undoSize(), 0);
  h.destroy();
});

test("no new setInterval and the panel layer's wake function is unchanged", () => {
  assert.doesNotMatch(BOOST_SRC, /setInterval\(/, "Boost keeps its one-shot timers only");
  const corner = read("extension/panels/corner-tiles/ZentralCornerPanels.uc.js");
  assert.match(corner, /function loadEssentialInBackground\(record, automatic = false\)/);
  // G5 routes the same explicit wake through one restore engine; the panel layer's signature is unchanged.
  assert.match(BOOST_SRC, /ctx\.loadEssentialInBackground\(record, false\)/);
  assert.match(BOOST_SRC, /restoreSession\(\{ profile: "panels", immediate: true \}\)/);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\ng1-panel-sleep (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
