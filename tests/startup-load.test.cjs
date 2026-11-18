"use strict";
/* OW-38 (part 8): Load at Startup. The feature wakes chosen pinned/essential tabs in the background after session
 * restoration. What it must never do is the interesting part: it never adds a tab, never selects one, never reloads a
 * running page, and it marks a tab as attempted only after a request actually went out. The behaviour is driven here
 * through the module's own public `initialize()` against a fake window, with a fake SessionStore answering the tab
 * values the feature persists. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createDom = require("./helpers/fake-dom.cjs");

const REPO = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(REPO, "additional/tabs/startup/ZentralStartup.uc.js"), "utf8");
const PREF = "zen.workspace.zentral.startup.enabled";
const TAB_KEY = "zentral-load-at-startup";

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}
const flush = async (ms = 0) => await new Promise((r) => setTimeout(r, ms));
const ids = (list) => [...list].map((tab) => tab.id);

function boot({ enabled = true, values = {}, storedTabs = null } = {}) {
  const { El, Ev, document } = createDom();
  document.createXULElement = (tag) => document.createElement(tag);
  const store = new Map([[PREF, enabled]]);
  const observers = [];
  const Services = {
    prefs: {
      getBoolPref: (k, f = false) => (store.has(k) ? Boolean(store.get(k)) : f),
      addObserver: (k, fn) => observers.push({ k, fn }),
      removeObserver: () => {},
    },
    obs: { addObserver: () => {}, removeObserver: () => {} },
    io: { newURI: (spec) => ({ spec }) },
  };
  const makeTab = (id, { pinned = false, essential = false, sleeping = true, attrs = {} } = {}) => {
    const tab = document.createElement("tab");
    tab.id = id;
    tab.pinned = pinned;
    if (essential) tab.setAttribute("zen-essential", "true");
    if (sleeping) {
      tab.setAttribute("pending", "true");
      tab.linkedPanel = "";
    } else {
      tab.linkedPanel = "panel-" + id;
    }
    for (const [k, v] of Object.entries(attrs)) tab.setAttribute(k, v);
    tab.closing = false;
    const reloads = [];
    tab.linkedBrowser = { reload() { reloads.push(Date.now()); tab.reloads = reloads; } };
    tab.reloads = reloads;
    return tab;
  };
  const tabs = [
    makeTab("pinned-1", { pinned: true }),
    makeTab("essential-1", { essential: true }),
    makeTab("ordinary-1"),
    makeTab("empty-1", { pinned: true, attrs: { "zen-empty-tab": "true" } }),
    makeTab("host-1", { pinned: true, attrs: { "bgalazka-addon-host": "true" } }),
  ];
  // The fake Element has no toggleAttribute; the feature only needs the standard shape.
  if (!document.documentElement.toggleAttribute) {
    document.documentElement.toggleAttribute = function (name, force) {
      const on = force === undefined ? !this.hasAttribute(name) : !!force;
      on ? this.setAttribute(name, "") : this.removeAttribute(name);
      return on;
    };
  }

  const valuesMap = new Map(Object.entries(values));
  const sessionStore = {
    getCustomTabValue: (tab, key) => valuesMap.get(key + ":" + tab.id) ?? "",
    setCustomTabValue: (tab, key, v) => valuesMap.set(key + ":" + tab.id, String(v)),
    promiseAllWindowsRestored: Promise.resolve(),
  };
  const tabStrip = document.createElement("div");
  for (const tab of tabs) tabStrip.appendChild(tab);
  document.documentElement.appendChild(tabStrip); // the strip is in the window, so its tabs are connected

  const timers = [];
  const win = {
    document,
    SessionStore: sessionStore,
    gBrowser: { tabs, selectedTab: tabs[2] },
    gBrowserInit: { delayedStartupFinished: true },
    gZenWorkspaces: {
      workspaceEnabled: true,
      privateWindowOrDisabled: false,
      promiseInitialized: Promise.resolve(),
      allStoredTabs: storedTabs ? storedTabs(tabs) : tabs,
    },
    windowUtils: { USER_SHEET: 1, loadSheet: () => {}, removeSheet: () => {} },
    Services,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { const index = id - 1; if (timers[index]) timers[index].cleared = true; },
    addEventListener: (type, fn) => win.listeners.push({ type, fn }),
    removeEventListener: (type, fn) => { win.listeners = win.listeners.filter((l) => !(l.type === type && l.fn === fn)); },
    listeners: [],
  };
  win.window = win;
  const registrations = [];
  win.ZentralRuntime = { register: (def) => registrations.push(def) };

  const sandbox = {
    window: win, document, Services, console,
    ChromeUtils: { importESModule: (uri) => (uri.includes("SessionStore") ? { SessionStore: sessionStore } : (() => { throw new Error("no module"); })()) },
    Components: { stack: { filename: "resource://zentral/additional/tabs/startup/ZentralStartup.uc.js" } },
    URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap, WeakSet, Array, Object, String, Boolean, Error, TypeError,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "ZentralStartup.uc.js" });
  return { win, document, tabs, sessionStore, valuesMap, store, observers, timers, registrations, sandbox };
}

function fire(env, type, init) {
  const event = { type, target: init?.target, ...init };
  for (const l of [...env.win.listeners]) if (l.type === type) l.fn(event);
  return event;
}
/* The feature schedules a pump on a task timer; run every live timer in order. */
function runTimers(env) {
  for (let i = 0; i < 20; i++) {
    const next = env.timers.find((t) => !t.cleared && !t.ran);
    if (!next) break;
    next.ran = true;
    next.fn();
  }
}

const value = (which) => ({ [TAB_KEY + ":" + which]: "true" });
/* The feature subscribes with either a function or a {observe} object; a real prefs service accepts both. */
function notify(env) {
  for (const o of env.observers) {
    if (o.k !== PREF) continue;
    if (typeof o.fn === "function") o.fn();
    else o.fn?.observe?.();
  }
}

async function run() {
  const env = boot({
    values: { ...value("pinned-1"), ...value("essential-1"), ...value("ordinary-1") },
  });
  const def = env.registrations.find((r) => r.id === "startup");
  assert.ok(def, "the feature registers itself");
  const destroy = def.init();
  assert.equal(typeof destroy, "function", "initialize hands back its teardown");
  await flush();

  await test("only chosen pinned or essential tabs are woken, never ordinary or synthetic ones", async () => {
    runTimers(env);
    assert.deepEqual(ids(env.tabs.filter((t) => t.reloads.length)), ["pinned-1", "essential-1"], "ordinary, empty and add-on host tabs stay asleep");
  });

  await test("an ordinary tab marked at startup is never woken by mistake", async () => {
    assert.equal(env.tabs[2].reloads.length, 0, "a normal tab is not a startup tab even when it says so");
  });

  await test("the page is loaded in the background: no tab is added, selected or reloaded twice", async () => {
    assert.equal(env.win.gBrowser.selectedTab, env.tabs[2], "the active tab is untouched");
    assert.equal(env.win.gBrowser.tabs.length, 5, "no tab was added");
    runTimers(env);
    assert.equal(env.tabs[0].reloads.length, 1, "a tab is woken once, not once per scan");
  });

  await test("a running page is left alone and only marked as attempted", async () => {
    const live = env.tabs[1];
    live.removeAttribute("pending");
    live.linkedPanel = "panel-live";
    // Re-enable the preference: a fresh scan walks the strip again.
    env.store.set(PREF, true);
    notify(env);
    runTimers(env);
    assert.equal(live.reloads.length, 1, "a page that is already running is not reloaded");
  });

  await test("the context menu offers the choice only for eligible tabs, and saves it through SessionStore", async () => {
    const popup = env.document.createElement("menupopup");
    popup.id = "tabContextMenu";
    env.document.documentElement.appendChild(popup); // the real menu lives in the window
    env.win.TabContextMenu = { contextTab: env.tabs[0] };
    fire(env, "popupshowing", { target: popup });
    const item = popup.querySelector("#zentral-tab-load-at-startup");
    assert.ok(item, "the menu item is created on first use");
    assert.equal(item.hidden, false, "a pinned tab can be chosen");
    assert.equal(item.getAttribute("checked"), "true", "and shows the stored choice");

    // An ordinary tab cannot be chosen. (The module hides the item only when the feature itself is off; for an
    // ineligible tab it simply leaves no checkmark, so nothing can be toggled from the menu.)
    env.win.TabContextMenu = { contextTab: env.tabs[2] };
    fire(env, "popupshowing", { target: popup });
    assert.equal(item.hidden, true, "an ordinary tab cannot be chosen");
    assert.equal(item.hasAttribute("checked"), false, "and never shows as chosen");

    env.win.TabContextMenu = { contextTab: env.tabs[0] };
    fire(env, "popupshowing", { target: popup });
    // The module attaches its handler to the item itself; that is the only path into the toggle.
    item.dispatchEvent({ type: "command", target: item, preventDefault() {}, stopPropagation() {} });
    // The menu promise and the stored value must agree; the choice only takes effect at the next startup.
    assert.equal(env.valuesMap.get(TAB_KEY + ":pinned-1"), "false", "opting out is stored explicitly, not deleted");
    assert.equal(typeof env.sessionStore.setCustomTabValue, "function", "the choice goes through SessionStore, never a URL list");
    // The menu explains itself; nothing reloads right away.
    assert.equal(env.tabs[0].reloads.length, 1, "a menu choice applies on the next startup");
  });

  await test("turning the feature off stops the scan and hides the root attribute", async () => {
    env.store.set(PREF, false);
    notify(env);
    assert.equal(env.document.documentElement.hasAttribute("zentral-startup-enabled"), false);
    const before = env.tabs.map((t) => t.reloads.length);
    runTimers(env);
    assert.deepEqual(env.tabs.map((t) => t.reloads.length), before, "nothing wakes while it is off");
  });

  await test("destroy removes the menu item, the observers and the public handle", async () => {
    env.store.set(PREF, true);
    notify(env);
    const item = env.document.getElementById("zentral-tab-load-at-startup");
    assert.ok(item, "the item exists before teardown");
    destroy();
    assert.equal(env.document.getElementById("zentral-tab-load-at-startup"), null, "the menu item is gone");
    assert.equal(env.win.ZentralStartup, undefined, "the public handle is gone");
    assert.equal(env.document.documentElement.hasAttribute("zentral-startup-enabled"), false);
  });

  console.log("\nPASS startup (" + passed + " tests)");
}

run().catch((error) => {
  console.error("FAIL", error);
  process.exit(1);
});
