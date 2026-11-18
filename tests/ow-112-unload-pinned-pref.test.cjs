"use strict";
/* OW-112 (owner audit F2): `zen.workspace.zentral.boost.keep_pinned = true` actually means
 * "a deep pass MAY UNLOAD pinned/Essential tabs", the exact opposite of its name. This suite checks
 * the CURRENT behaviour first: the new, honestly named pref, the one-time migration of an old
 * `true`, the old pref as a read-only fallback, the unchanged default, and that the retired name
 * is no longer a user-facing setting.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const json = (p) => JSON.parse(read(p));
const OLD = "zen.workspace.zentral.boost.keep_pinned";
const NEW = "zen.workspace.zentral.boost.unload_pinned";
const POLICY_SRC = read("loader/ZentralTabPolicy.js");
const BOOST_SRC = read("additional/boost/ZentralBoost.uc.js");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/* ---------------- the declared setting ---------------- */

test("the new pref exists in every catalog, with the same label and the same false default", () => {
  const settings = json("additional/boost/settings.json");
  const schema = settings.schema.find((x) => x.property === NEW);
  assert.ok(schema, NEW + " is declared in the owner schema");
  assert.equal(schema.type, "checkbox");
  assert.equal(schema.defaultValue, false, "the default does not change");
  assert.match(schema.label, /Unloading may include pinned and Essential tabs/);
  assert.equal(settings.settings[NEW]?.category, "boost");
  assert.equal(settings.settings[NEW]?.section, "Memory");
  assert.equal(settings.settings[NEW]?.owner, "boost");

  assert.ok(json("extension/settings/layout.json").order.includes(NEW), "it is in the Settings layout");
  assert.ok(json("preferences.json").some((x) => x.property === NEW && x.defaultValue === false),
    "Sine ships it with the same default");
  assert.ok(json("additional/boost/preferences.json").some((x) => x.property === NEW && x.defaultValue === false),
    "the standalone package ships it too");

  const manifest = json("additional/boost/standalone.json");
  assert.ok(manifest.externalPrefs?.includes(OLD),
    "the retired name is declared as a read-only external pref, not a second checkbox");
});

test("the retired name is no longer a user-facing setting, and the source only reads it as a legacy fallback", () => {
  for (const file of ["additional/boost/settings.json", "additional/boost/preferences.json",
    "preferences.json", "extension/settings/layout.json"]) {
    const content = read(file);
    assert.equal(content.includes(OLD), false, file + " no longer declares " + OLD);
  }
  assert.match(BOOST_SRC, /LEGACY_KEEP_PINNED/, "the source names the legacy pref, not a live PREF");
  assert.match(BOOST_SRC, /UNLOAD_PINNED:\s*"zen\.workspace\.zentral\.boost\.unload_pinned"/,
    "the live pref is the new one");
  // Only the migration/fallback helpers may name the old key.
  const legacyUse = BOOST_SRC.split("\n").filter((line) => line.includes(OLD));
  assert.equal(legacyUse.length, 1, "the old pref name appears once, in the PREF table");
  assert.match(read("additional/boost/README.md"), /unload_pinned/);
  assert.match(read("docs/PLAN_CODING_AGENT.md"), /unload_pinned/);
});

/* ---------------- the module, with a fake pref service ---------------- */

function tab({ pinned = false, url = "https://example.com/" } = {}) {
  const attrs = new Set(pinned ? ["pinned"] : []);
  return {
    closing: false, isConnected: true, hidden: false, linkedPanel: "p1",
    linkedBrowser: { currentURI: { spec: url }, isPictureInPicture: false },
    lastAccessed: 1, soundPlaying: false, label: url,
    hasAttribute: (name) => attrs.has(name),
    getAttribute: (name) => (name === "zen-dormant" ? null : attrs.has(name) ? "" : null),
    matches: () => false,
    pinned,
  };
}

function boot({ prefs = {}, userSet = [], noPrefHasUserValue = false, failWrites = false } = {}) {
  const store = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    ...prefs,
  }));
  const user = new Set([...userSet, ...store.keys()]);
  const writes = [];
  const timers = new Map();
  let timerId = 0;
  let registration = null;
  const unloadCalls = [];

  const win = {
    gBrowser: {
      tabs: [],
      selectedTab: null,
      explicitUnloadTabs: async (list) => { unloadCalls.push(...list); for (const t of list) t.linkedPanel = null; return true; },
    },
    Services: {
      prefs: {
        getBoolPref: (k, d) => (store.has(k) ? Boolean(store.get(k)) : d),
        getStringPref: (k, d) => (store.has(k) ? String(store.get(k)) : d),
        getIntPref: (k, d) => (store.has(k) ? Number(store.get(k)) : d),
        setBoolPref: (k, v) => {
          if (failWrites) throw new Error("read-only prefs");
          writes.push({ key: k, value: Boolean(v) });
          store.set(k, Boolean(v));
          user.add(k);
        },
        prefHasUserValue: noPrefHasUserValue ? undefined : (k) => user.has(k),
        getPrefType: (k) => (store.has(k) ? 128 : 0),
        addObserver() {}, removeObserver() {},
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
    addEventListener() {}, removeEventListener() {},
    console: { warn() {}, log() {}, error() {} },
    ZentralRuntime: { register: (def) => { registration = def; } },
  };
  win.window = win;
  win.globalThis = win;
  win.Zentral = { Panels: { essentialPanels: new Map() } };
  const context = vm.createContext({
    ...win,
    ChromeUtils: { requestProcInfo: () => ({ memory: 900 }), forceGC() {}, forceCC() {} },
    Cc: win.Cc, Ci: win.Ci, console: win.console,
    Promise, Set, Map, WeakMap, WeakSet, Array, Object, Number, Math, String, Symbol, Error, TypeError, Date, JSON,
    globalThis: win,
  });
  win.ZentralTabPolicy = (() => {
    const w = {}; w.window = w;
    vm.runInNewContext(POLICY_SRC, { window: w, globalThis: w, console });
    return w.ZentralTabPolicy;
  })();
  vm.runInContext(BOOST_SRC, context, { filename: "ZentralBoost.uc.js" });
  registration.init();
  const api = win.ZentralBoost;
  return {
    api, win, store, writes, unloadCalls, timers,
    destroy: () => api.destroy(),
    async deep(...tabs) {
      win.gBrowser.tabs = tabs;
      win.gBrowser.selectedTab = null;
      const pending = api.runLevel2();
      for (let round = 0; round < 16; round++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const due = [...timers].filter(([, t]) => t.ms === 3000);
        for (const [id, t] of due) { timers.delete(id); t.fn(); }
        await Promise.resolve();
      }
      return pending;
    },
  };
}

test("the default is unchanged: with neither pref set, an ordinary pinned tab stays loaded", async () => {
  const h = boot();
  const pinned = tab({ pinned: true });
  await h.deep(pinned);
  assert.equal(h.unloadCalls.includes(pinned), false);
  assert.equal(h.writes.length, 0, "no migration write when the old pref was never true");
  h.destroy();
});

test("the new pref is the live switch: true unloads an ordinary pinned tab", async () => {
  const h = boot({ prefs: { [NEW]: true } });
  const pinned = tab({ pinned: true });
  await h.deep(pinned);
  assert.equal(h.unloadCalls.includes(pinned), true, "the pref name now says what it does");
  h.destroy();
});

test("a retired `keep_pinned = true` is migrated ONCE to the new pref", async () => {
  const h = boot({ prefs: { [OLD]: true }, userSet: [OLD] });
  assert.equal(h.store.get(NEW), true, "the owner's old choice survives the rename");
  assert.deepEqual(h.writes.filter((w) => w.key === NEW), [{ key: NEW, value: true }],
    "exactly one migration write");
  assert.equal(h.store.get(OLD), true, "the old pref stays as a read-only fallback");
  const pinned = tab({ pinned: true });
  await h.deep(pinned);
  assert.equal(h.unloadCalls.includes(pinned), true);
  h.destroy();
});

test("an explicit new choice wins over the retired pref, in either direction", async () => {
  const off = boot({ prefs: { [OLD]: true, [NEW]: false }, userSet: [OLD, NEW] });
  let pinned = tab({ pinned: true });
  await off.deep(pinned);
  assert.equal(off.unloadCalls.includes(pinned), false, "an explicit off is respected");
  assert.equal(off.writes.filter((w) => w.key === NEW).length, 0, "no migration over an explicit choice");
  off.destroy();

  const on = boot({ prefs: { [OLD]: false, [NEW]: true }, userSet: [OLD, NEW] });
  pinned = tab({ pinned: true });
  await on.deep(pinned);
  assert.equal(on.unloadCalls.includes(pinned), true);
  on.destroy();
});

test("the old pref is still a fallback for one release, even when the migration write fails", async () => {
  // A read-only profile (or a build without prefHasUserValue) must not lose the owner's choice.
  const h = boot({ prefs: { [OLD]: true }, userSet: [OLD], failWrites: true });
  const pinned = tab({ pinned: true });
  await h.deep(pinned);
  assert.equal(h.unloadCalls.includes(pinned), true, "old `true` still means may-unload");
  h.destroy();

  const noHelper = boot({ prefs: { [OLD]: true }, userSet: [OLD], noPrefHasUserValue: true });
  const other = tab({ pinned: true });
  await noHelper.deep(other);
  assert.equal(noHelper.unloadCalls.includes(other), true);
  noHelper.destroy();
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-112-unload-pinned-pref (${passed} passed)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
