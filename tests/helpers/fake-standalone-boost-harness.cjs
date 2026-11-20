"use strict";
/* G10/G7: a fake privileged window that executes the GENERATED standalone Boost
 * bundle. It is deliberately small: enough DOM, prefs, timers and Gecko services
 * for the shim, Boost, the sidebar-hover helper and the standalone card. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");
const BUNDLE = fs.readFileSync(path.join(ROOT, "additional/boost/ZentralBoost.standalone.uc.js"), "utf8");

class FakeElement {
  constructor(tag, id = "") {
    this.tagName = String(tag || "div").toUpperCase();
    this.localName = String(tag || "div").toLowerCase();
    this.nodeType = 1;
    this.id = id;
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.type = "";
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.style = {};
    this._listeners = [];
    this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    this.offsetWidth = 0;
    this.offsetHeight = 0;
  }
  get parentElement() { return this.parentNode; }
  get isConnected() {
    let cur = this;
    while (cur) {
      if (cur === this._doc?.documentElement) return true;
      cur = cur.parentNode;
    }
    return false;
  }
  setRect(rect) {
    const left = Number(rect.left) || 0, top = Number(rect.top) || 0;
    const width = Number(rect.width) || Math.max(0, (Number(rect.right) || 0) - left);
    const height = Number(rect.height) || Math.max(0, (Number(rect.bottom) || 0) - top);
    this._rect = { left, top, right: left + width, bottom: top + height, width, height };
    return this;
  }
  getBoundingClientRect() { return { ...this._rect }; }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
    if (name === "hidden") this.hidden = true;
    if (name === "disabled") this.disabled = true;
  }
  getAttribute(name) {
    if (name === "id") return this.id || null;
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  hasAttribute(name) { return name === "hidden" ? this.hidden || this.attrs.has(name) : this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); if (name === "hidden") this.hidden = false; if (name === "disabled") this.disabled = false; }
  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) child.remove();
    child.parentNode = this;
    child._doc = this._doc;
    this.children.push(child);
    return child;
  }
  append(...children) { for (const child of children) this.appendChild(child); }
  removeChild(child) {
    const at = this.children.indexOf(child);
    if (at >= 0) this.children.splice(at, 1);
    if (child) { child.parentNode = null; }
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(node) {
    if (!node || node === this) return Boolean(node) || false;
    return this.children.some((child) => child.contains(node));
  }
  addEventListener(type, fn) { this._listeners.push([type, fn]); }
  removeEventListener(type, fn) {
    for (let i = this._listeners.length - 1; i >= 0; i--) {
      const [t, f] = this._listeners[i];
      if (t === type && (!fn || f === fn)) this._listeners.splice(i, 1);
    }
  }
  dispatch(type, extra = {}) {
    const event = {
      type, target: this, currentTarget: this, button: 0,
      preventDefault() {}, stopPropagation() {},
      ...extra,
    };
    for (const [t, fn] of [...this._listeners]) if (t === type) fn(event);
    return event;
  }
  matches(selector) {
    if (!selector) return false;
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return String(this.className).split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith("[")) {
      const m = /^\[([^=\]]+)(?:="?([^"\]]*)"?)?\]$/.exec(selector);
      return Boolean(m) && (m[2] == null ? this.hasAttribute(m[1]) : this.getAttribute(m[1]) === m[2]);
    }
    return this.localName === selector.toLowerCase();
  }
  descendants() {
    const out = [];
    const walk = (node) => { for (const child of node.children || []) { out.push(child); walk(child); } };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.descendants().find((node) => node.matches(selector)) || null; }
  querySelectorAll(selector) { return this.descendants().filter((node) => node.matches(selector)); }
}

function createFakeDocument() {
  const doc = new FakeElement("#document");
  const root = new FakeElement("html");
  const body = new FakeElement("body");
  root._doc = doc;
  body._doc = doc;
  doc.documentElement = root;
  doc.body = body;
  root.appendChild(body);
  doc.activeElement = null;
  doc.createElement = (tag) => {
    const el = new FakeElement(tag);
    el._doc = doc;
    return el;
  };
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  doc.getElementById = (id) => (root.id === id ? root : root.querySelector("#" + id));
  doc.querySelector = (selector) => root.querySelector(selector);
  doc.querySelectorAll = (selector) => root.querySelectorAll(selector);
  doc.elementFromPoint = () => null;
  return doc;
}

function normalizeHarnessSnapshot(snapshot) {
  const s = snapshot && typeof snapshot === "object" ? snapshot : {};
  const tabs = Number(s.tabs ?? s.restorableTabs) || 0;
  return { panels: Number(s.panels) || 0, tabs, restorableTabs: Number(s.restorableTabs ?? s.tabs) || 0, active: s.active !== false };
}
function instrumentStandaloneBoostApi(api, calls, options = {}) {
  let gameOn = Boolean(options.gameModeOn);
  let snapshot = normalizeHarnessSnapshot(options.gameModeSnapshot || { panels: 1, tabs: 2, restorableTabs: 2 });
  const wrap = (name, call) => {
    const original = api[name];
    if (typeof original !== "function") return;
    api[name] = (...args) => { calls[call] = (calls[call] || 0) + 1; return original.apply(api, args); };
  };
  wrap("startSampling", "startSampling");
  wrap("stopSampling", "stopSampling");
  const originalOnChange = api.onChange;
  api.onChange = (...args) => {
    calls.subscribe = (calls.subscribe || 0) + 1;
    const off = originalOnChange.apply(api, args);
    return () => { calls.unsubscribe = (calls.unsubscribe || 0) + 1; return off(); };
  };
  const originalOnGameModeEvent = api.onGameModeEvent;
  api.onGameModeEvent = (fn) => {
    calls.gameModeSubscribe = (calls.gameModeSubscribe || 0) + 1;
    const off = typeof originalOnGameModeEvent === "function"
      ? originalOnGameModeEvent.call(api, fn)
      : () => calls.gameModeListeners.delete(fn);
    calls.gameModeListeners.add(fn);
    return () => {
      calls.gameModeUnsubscribe = (calls.gameModeUnsubscribe || 0) + 1;
      calls.gameModeListeners.delete(fn);
      return off();
    };
  };
  api.lastMB = () => 512;
  api.memoryMB = () => 512;
  api.previewGameMode = () => {
    calls.previewGameMode = (calls.previewGameMode || 0) + 1;
    return { counts: { tabs: 2, panels: 1 } };
  };
  api.sessionState = () => ({ ...snapshot });
  api.gameModeState = () => ({ on: gameOn, snapshot: { ...snapshot } });
  api.runLevel1 = () => { calls.runLevel1 = (calls.runLevel1 || 0) + 1; return Promise.resolve({ freedMB: 10 }); };
  api.runLevel2 = () => { calls.runLevel2 = (calls.runLevel2 || 0) + 1; return Promise.resolve({ freedMB: 20, unloaded: { tabs: 1, panels: 0 } }); };
  api.setGameMode = (on) => {
    calls.setGameMode = (calls.setGameMode || 0) + 1;
    gameOn = Boolean(on);
    if (options.autoGameModeEvents && calls.emitGameModeEvent) {
      calls.emitGameModeEvent(gameOn
        ? { action: "on", state: api.gameModeState() }
        : { action: "off", state: api.gameModeState() });
    }
    return { on: gameOn };
  };
  api.restoreSession = () => {
    calls.restoreSession = (calls.restoreSession || 0) + 1;
    snapshot = normalizeHarnessSnapshot({});
    if (options.autoGameModeEvents && calls.emitGameModeEvent)
      calls.emitGameModeEvent({ action: "restored", state: api.gameModeState() });
    return { panels: 1, tabs: 2 };
  };
  api.restore = api.restoreSession;
}

function createFakeStandaloneBoostHarness(options = {}) {
  const prefs = new Map(Object.entries({
    "zen.workspace.zentral.boost.enabled": true,
    "zen.workspace.zentral.boost.widget_enabled": true,
    "zen.workspace.zentral.boost.startup_trim": false,
    "zen.workspace.zentral.boost.limit_enabled": false,
    "zen.workspace.zentral.boost.game_mode": false,
    "zen.workspace.zentral.boost.shortcut": "",
    ...(options.prefs || {}),
  }));
  const prefObservers = [];
  const timers = new Map();
  let timerId = 0;
  const listeners = { win: new Map(), doc: new Map() };
  const calls = {
    startSampling: 0, stopSampling: 0, subscribe: 0, unsubscribe: 0,
    gameModeSubscribe: 0, gameModeUnsubscribe: 0, gameModeListeners: new Set(),
    runLevel1: 0, runLevel2: 0, setGameMode: 0, restoreSession: 0,
    previewGameMode: 0, gameModeEvents: 0,
  };
  const emitGameModeEvent = (event) => {
    calls.gameModeEvents += 1;
    for (const fn of [...calls.gameModeListeners]) {
      try { fn({ kind: "game-mode", ...event }); } catch (error) { console.error("fake game-mode event failed", error); throw error; }
    }
  };
  calls.emitGameModeEvent = emitGameModeEvent;
  const doc = createFakeDocument();
  const win = {
    innerWidth: 1200,
    innerHeight: 800,
    navigator: { language: options.language || "en" },
    document: doc,
    console: { warn() {}, error() {}, log() {} },
    setTimeout(fn, ms = 0) {
      const id = ++timerId;
      timers.set(id, { fn, ms: Number(ms) || 0 });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { throw new Error("setInterval is forbidden in the standalone Boost card"); },
    requestAnimationFrame(fn) { return this.setTimeout(() => fn(Date.now()), 0); },
    cancelAnimationFrame(id) { this.clearTimeout(id); },
    requestIdleCallback() { return 1; },
    cancelIdleCallback() {},
    addEventListener(type, fn) {
      if (!listeners.win.has(type)) listeners.win.set(type, new Set());
      listeners.win.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.win.get(type);
      if (set) set.delete(fn);
    },
    addUnloadListener(fn) { this.addEventListener("unload", fn); },
    getComputedStyle() { return { display: "block", visibility: "visible", opacity: "1" }; },
    gBrowserInit: { delayedStartupFinished: true },
  };
  win.window = win;
  doc.addEventListener = (type, fn) => {
    if (!listeners.doc.has(type)) listeners.doc.set(type, new Set());
    listeners.doc.get(type).add(fn);
  };
  doc.removeEventListener = (type, fn) => {
    const set = listeners.doc.get(type);
    if (set) set.delete(fn);
  };
  const tabContainer = doc.createElement("tabs");
  tabContainer._doc = doc;
  tabContainer.setRect({ left: 0, top: 0, width: 220, height: 800 });
  doc.documentElement.appendChild(tabContainer);
  win.gBrowser = {
    tabs: options.tabs || [],
    selectedTab: (options.tabs || [])[0] || null,
    tabContainer,
    explicitUnloadTabs: async () => true,
    addTab() { return null; },
    removeTab() {},
  };
  const Services = {
    prefs: {
      getPrefType(key) {
        if (!prefs.has(key)) return 0;
        const value = prefs.get(key);
        return typeof value === "boolean" ? 128 : typeof value === "number" ? 64 : 32;
      },
      getBoolPref(key, fallback) { return prefs.has(key) ? Boolean(prefs.get(key)) : fallback; },
      getIntPref(key, fallback) { return prefs.has(key) ? Number(prefs.get(key)) : fallback; },
      getStringPref(key, fallback) { return prefs.has(key) ? String(prefs.get(key)) : fallback; },
      setBoolPref(key, value) { prefs.set(key, Boolean(value)); },
      setIntPref(key, value) { prefs.set(key, Number(value)); },
      setStringPref(key, value) { prefs.set(key, String(value)); },
      prefHasUserValue(key) { return prefs.has(key); },
      addObserver(prefix, observer) { prefObservers.push([prefix, observer]); },
      removeObserver(prefix, observer) {
        for (let i = prefObservers.length - 1; i >= 0; i--)
          if (prefObservers[i][0] === prefix && prefObservers[i][1] === observer) prefObservers.splice(i, 1);
      },
    },
    obs: { addObserver() {}, removeObserver() {} },
    appinfo: { OS: "Linux" },
    scriptSecurityManager: { getSystemPrincipal: () => ({ system: true }) },
    io: { newURI: (spec) => ({ spec }) },
  };
  const ChromeUtils = {
    requestProcInfo: () => ({ memory: 512_000_000, children: [] }),
    forceGC() {}, forceCC() {},
    importESModule: () => ({ Services }),
  };
  const Cc = {
    "@mozilla.org/memory-reporter-manager;1": {
      getService: () => ({ minimizeMemoryUsage(cb) { cb?.run?.(); } }),
    },
  };
  const context = vm.createContext({
    ...win,
    document: doc,
    Services,
    ChromeUtils,
    Cc,
    Ci: { nsIMemoryReporterManager: Symbol("mgr") },
    Components: { stack: { filename: "chrome://zentral-boost/content/ZentralBoost.standalone.uc.js" } },
    console: win.console,
    URL, Promise, Set, Map, WeakMap, WeakSet, Array, Object, Number, Math, String,
    Symbol, Error, TypeError, Date, JSON, RegExp, globalThis: win,
  });
  // Bridge properties assigned later by the bundle back to the same object the caller sees.
  for (const key of ["ZentralBoost", "__zentralStandalone", "__zentralStandaloneRuntime", "__zentralBoostLoader", "__zentralBoostStandaloneWidget"]) {
    Object.defineProperty(win, key, {
      configurable: true, enumerable: true,
      get() { return context[key]; },
      set(value) { context[key] = value; },
    });
  }
  if (options.runtimePresent) {
    context.ZentralRuntime = { register() {}, performance: { isPaused: () => false, subscribe: () => () => {} } };
    win.ZentralRuntime = context.ZentralRuntime;
  }
  if (options.widgets) {
    context.ZentralWidgets = options.widgets;
    win.ZentralWidgets = options.widgets;
  }
  let boostApi = null;
  if (options.instrumentApi) {
    Object.defineProperty(context, "ZentralBoost", {
      configurable: true, enumerable: true,
      get() { return boostApi; },
      set(api) {
        boostApi = api;
        options.instrumentApi(api, calls);
      },
    });
  }

  const harness = {
    win, doc, context, timers, calls, prefs, prefObservers, listeners, emitGameModeEvent,
    api: () => win.ZentralBoost || null,
    card: () => doc.getElementById("zentral-boost-standalone-card"),
    anchor: () => doc.getElementById("zentral-boost-standalone-anchor"),
    actions: () => harness.card()?.querySelectorAll("[data-zw-boost-action]") || [],
    action(id) { return harness.actions().find((el) => el.getAttribute("data-zw-boost-action") === id) || null; },
    fire(el, type, extra = {}) { return el?.dispatch?.(type, extra); },
    listenerCount(target = "doc") {
      const map = listeners[target];
      return [...map.values()].reduce((sum, set) => sum + set.size, 0);
    },
    async flush(ms = 0, rounds = 40) {
      for (let round = 0; round < rounds; round++) {
        const due = [...timers].filter(([, timer]) => ms == null || timer.ms === ms);
        for (const [id, timer] of due) {
          timers.delete(id);
          try { timer.fn(); } catch (error) { console.error("fake timer failed", error); throw error; }
        }
        await new Promise((resolve) => setImmediate(resolve));
        if (ms === 0 && ![...timers.values()].some((timer) => timer.ms === 0)) break;
      }
    },
    runBundle() { vm.runInContext(BUNDLE, context, { filename: "ZentralBoost.standalone.uc.js" }); },
    async boot() {
      harness.runBundle();
      await harness.flush(0);
      return harness;
    },
    destroy() {
      try { win.__zentralStandalone?.boost?.dispose?.(); } catch (_) {}
      try { win.ZentralBoost?.destroy?.(); } catch (_) {}
    },
  };
  return harness;
}

module.exports = { createFakeStandaloneBoostHarness, instrumentStandaloneBoostApi, FakeElement };
