"use strict";
/* The fake sidebar the widget tests run against: a small DOM with rects, computed styles, timers, rAF, pref
 * observers and the widget host itself. Shared so a live test can drive the real scheduler (the weather card's
 * per-place cache key, for one) without a second copy of the shell drifting from the first. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const widgetSrc = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const widgetCss = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.css"), "utf8");

function createFakeSidebarHarness(initialPrefs = {}, { fetch: fetchImpl = null } = {}) {
  const prefs = new Map(Object.entries(initialPrefs));
  const prefObservers = [];
  let nowMs = 1_700_000_000_000;
  let nextTimerId = 1;
  const timers = new Map(); // id -> { fn, at, ms }
  const rafs = new Map();
  let nextRafId = 1;
  const winListeners = [];
  const docListeners = [];
  const tabListeners = [];
  const mutationObservers = [];
  const resizeObservers = [];

  class FakeElement {
    constructor(tag, id = "") {
      this.tagName = String(tag || "div").toUpperCase();
      this.localName = String(tag || "div").toLowerCase();
      this.nodeType = 1;
      this.id = id;
      this.className = "";
      this.textContent = "";
      this.hidden = false;
      this.parentNode = null;
      this.children = [];
      this.attrs = new Map();
      this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      this._computed = {};
      this.scrollTop = 0;
      this.scrollHeight = 0;
      this.clientHeight = 0;
      this._listeners = [];
      this.style = {
        _props: new Map(),
        setProperty(k, v) { this._props.set(k, String(v)); },
        removeProperty(k) { this._props.delete(k); },
        getPropertyValue(k) { return this._props.get(k) || ""; },
      };
    }
    get parentElement() { return this.parentNode; }
    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === docRoot) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    get previousSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i > 0 ? this.parentNode.children[i - 1] : null;
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return i >= 0 && i + 1 < this.parentNode.children.length
        ? this.parentNode.children[i + 1]
        : null;
    }
    setRect(r) {
      const top = r.top ?? 0;
      const left = r.left ?? 0;
      const width = r.width ?? (r.right != null ? r.right - left : 0);
      const height = r.height ?? (r.bottom != null ? r.bottom - top : 0);
      this._rect = { left, top, right: left + width, bottom: top + height, width, height };
      if (!this.clientHeight) this.clientHeight = height;
      return this;
    }
    getBoundingClientRect() {
      return { ...this._rect };
    }
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
      if (k === "id") this.id = String(v);
      if (k === "class") this.className = String(v);
      if (k === "hidden") this.hidden = true;
    }
    getAttribute(k) {
      if (k === "id") return this.id || null;
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    }
    hasAttribute(k) {
      return k === "hidden" ? this.hidden || this.attrs.has("hidden") : this.attrs.has(k);
    }
    removeAttribute(k) {
      this.attrs.delete(k);
      if (k === "hidden") this.hidden = false;
    }
    appendChild(child) {
      if (child.parentNode) child.remove();
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    insertBefore(child, ref) {
      if (!ref) return this.appendChild(child);
      if (child.parentNode) child.remove();
      const idx = this.children.indexOf(ref);
      if (idx < 0) return this.appendChild(child);
      child.parentNode = this;
      this.children.splice(idx, 0, child);
      return child;
    }
    remove() {
      if (!this.parentNode) return;
      const idx = this.parentNode.children.indexOf(this);
      if (idx >= 0) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    addEventListener(type, fn) { this._listeners.push([type, fn]); }
    removeEventListener(type, fn) {
      const i = this._listeners.findIndex((x) => x[0] === type && x[1] === fn);
      if (i >= 0) this._listeners.splice(i, 1);
    }
    matches(sel) {
      return sel.split(",").some((part) => {
        const s = part.trim();
        if (!s) return false;
        if (s.includes(">")) {
          const [parentSel, childSel] = s.split(">").map((x) => x.trim());
          if (!this.parentNode || !this.parentNode.matches(parentSel)) return false;
          return childSel === "*" || this.matches(childSel);
        }
        if (s.startsWith("#")) return this.id === s.slice(1);
        if (s.startsWith(".")) return this.className.split(/\s+/).includes(s.slice(1));
        return this.localName === s.toLowerCase();
      });
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        for (const ch of node.children) {
          if (ch.matches(sel)) out.push(ch);
          walk(ch);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
  }

  const docRoot = new FakeElement("window", "main-window");
  const toolbox = new FakeElement("toolbox", "navigator-toolbox");
  toolbox.setRect({ left: 0, top: 0, width: 179, height: 900 });

  const topButtons = new FakeElement("hbox", "zen-sidebar-top-buttons").setRect({ top: 0, width: 179, height: 44 });
  const essentials = new FakeElement("hbox", "zen-essentials-container").setRect({ top: 44, width: 179, height: 88 });
  const verticalTabs = new FakeElement("vbox", "vertical-tabs").setRect({ top: 132, width: 179, height: 724 });
  const pinnedSec = new FakeElement("vbox", "");
  pinnedSec.className = "zen-workspace-pinned-tabs-section";
  const normalSec = new FakeElement("vbox", "");
  normalSec.className = "zen-workspace-normal-tabs-section";
  // Populate 6 tabs/folders totaling 298px (top 132 -> bottom 430), leaving 426px free!
  const folderEl = new FakeElement("zen-folder", "").setRect({ top: 132, width: 179, height: 42 });
  pinnedSec.appendChild(folderEl);
  let y = 174;
  for (let i = 0; i < 6; i++) {
    const tab = new FakeElement("tab", "");
    tab.className = "tabbrowser-tab";
    tab.setRect({ top: y, width: 179, height: 36 });
    normalSec.appendChild(tab);
    y += 36;
  }
  const newTabBtn = new FakeElement("toolbarbutton", "tabs-newtab-button").setRect({ top: y, width: 179, height: 40 });
  normalSec.appendChild(newTabBtn); // bottom = 174 + 216 + 40 = 430 -> 430 - 132 = 298px!
  verticalTabs.appendChild(pinnedSec);
  verticalTabs.appendChild(normalSec);

  const mediaToolbar = new FakeElement("toolbar", "zen-media-controls-toolbar").setRect({ top: 856, width: 179, height: 0 });
  mediaToolbar.hidden = true;
  const videoPreview = new FakeElement("div", "zentral-video-preview").setRect({ top: 856, width: 179, height: 0 });
  videoPreview.hidden = true;
  const bottomButtons = new FakeElement("hbox", "zen-sidebar-bottom-buttons").setRect({ top: 856, width: 179, height: 44 });

  toolbox.appendChild(topButtons);
  toolbox.appendChild(essentials);
  toolbox.appendChild(verticalTabs);
  toolbox.appendChild(mediaToolbar);
  toolbox.appendChild(videoPreview);
  toolbox.appendChild(bottomButtons);
  docRoot.appendChild(toolbox);

  const findById = (node, id) => {
    if (node.id === id) return node;
    for (const ch of node.children) {
      const hit = findById(ch, id);
      if (hit) return hit;
    }
    return null;
  };

  const document = {
    documentElement: docRoot,
    hidden: false,
    getElementById: (id) => findById(docRoot, id),
    createElement: (tag) => new FakeElement(tag),
    addEventListener: (t, fn) => docListeners.push([t, fn]),
    removeEventListener: (t, fn) => {
      const i = docListeners.findIndex((x) => x[0] === t && x[1] === fn);
      if (i >= 0) docListeners.splice(i, 1);
    },
  };

  const Services = {
    prefs: {
      getPrefType: (k) =>
        prefs.has(k)
          ? typeof prefs.get(k) === "boolean"
            ? 128
            : typeof prefs.get(k) === "number"
              ? 64
              : 32
          : 0,
      getBoolPref: (k, d) => (prefs.has(k) ? Boolean(prefs.get(k)) : d),
      getIntPref: (k, d) => (prefs.has(k) ? Number(prefs.get(k)) : d),
      getStringPref: (k, d) => (prefs.has(k) ? String(prefs.get(k)) : d),
      setBoolPref: (k, v) => {
        prefs.set(k, Boolean(v));
        for (const [pk, o] of [...prefObservers]) if (pk === k) o.observe(null, "nsPref:changed", k);
      },
      setIntPref: (k, v) => {
        prefs.set(k, Math.round(Number(v)));
        for (const [pk, o] of [...prefObservers]) if (pk === k) o.observe(null, "nsPref:changed", k);
      },
      setStringPref: (k, v) => {
        prefs.set(k, String(v));
        for (const [pk, o] of [...prefObservers]) if (pk === k) o.observe(null, "nsPref:changed", k);
      },
      addObserver: (k, o) => prefObservers.push([k, o]),
      removeObserver: (k, o) => {
        const i = prefObservers.findIndex((x) => x[0] === k && x[1] === o);
        if (i >= 0) prefObservers.splice(i, 1);
      },
    },
    obs: { addObserver() {}, removeObserver() {} },
  };

  const tabContainer = {
    addEventListener: (t, fn) => tabListeners.push([t, fn]),
    removeEventListener: (t, fn) => {
      const i = tabListeners.findIndex((x) => x[0] === t && x[1] === fn);
      if (i >= 0) tabListeners.splice(i, 1);
    },
  };

  const window = {
    innerWidth: 1440,
    innerHeight: 900,
    windowState: 1,
    STATE_MINIMIZED: 2,
    document,
    gBrowser: { tabContainer },
    gBrowserInit: { delayedStartupFinished: true },
    __zentralWidgetsTestSeam: {},
    ZentralRuntime: {
      services: {},
      nativeSidebarElement: () => toolbox,
      register({ id, init }) {
        this._registered = { id, init };
      },
    },
    getComputedStyle: (el) => ({
      display: el.hidden ? "none" : el._computed.display || "flex",
      visibility: el._computed.visibility || "visible",
      position: el._computed.position || "static",
      marginTop: el._computed.marginTop || "0px",
      marginBottom: el._computed.marginBottom || "0px",
      paddingLeft: el._computed.paddingLeft || "0px",
      paddingRight: el._computed.paddingRight || "0px",
      paddingTop: el._computed.paddingTop || "0px",
      paddingBottom: el._computed.paddingBottom || "0px",
    }),
    setTimeout: (fn, ms = 0) => {
      const id = nextTimerId++;
      timers.set(id, { fn, at: nowMs + Math.max(0, ms), ms });
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); },
    requestAnimationFrame: (fn) => {
      const id = nextRafId++;
      rafs.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => { rafs.delete(id); },
    addEventListener: (t, fn) => winListeners.push([t, fn]),
    removeEventListener: (t, fn) => {
      const i = winListeners.findIndex((x) => x[0] === t && x[1] === fn);
      if (i >= 0) winListeners.splice(i, 1);
    },
  };

  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.targets = [];
      this.disconnected = false;
      mutationObservers.push(this);
    }
    observe(target, opts) { this.targets.push({ target, opts }); }
    disconnect() {
      this.disconnected = true;
      this.targets.length = 0;
    }
  }

  class FakeResizeObserver {
    constructor(cb) {
      this.cb = cb;
      this.targets = new Set();
      this.disconnected = false;
      resizeObservers.push(this);
    }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() {
      this.disconnected = true;
      this.targets.clear();
    }
  }

  const RealDate = Date;
  const FakeDate = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [nowMs])); }
    static now() { return nowMs; }
  };

  const ctx = vm.createContext({
    window,
    document,
    Services,
    Date: FakeDate,
    console: { log() {}, warn() {}, error() {} },
    MutationObserver: FakeMutationObserver,
    ResizeObserver: FakeResizeObserver,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    Promise,
  });
  // A widget that asks the network gets it only when the test hands one over; everything else sees no fetch, which
  // is what "never poll on a card that has nothing to fetch" is tested against.
  if (fetchImpl) ctx.fetch = fetchImpl;
  ctx.globalThis = ctx;

  vm.runInContext(widgetSrc, ctx);

  function start() {
    assert.equal(window.ZentralRuntime._registered?.id, "widgets");
    const disposer = window.ZentralRuntime._registered.init({
      runtime: window.ZentralRuntime,
    });
    return { api: window.ZentralRuntime.services.widgets, disposer };
  }

  function flushRaf() {
    const fns = [...rafs.values()];
    rafs.clear();
    for (const fn of fns) fn();
  }

  function advanceTime(ms) {
    nowMs += ms;
    const due = [...timers.entries()]
      .filter(([, t]) => t.at <= nowMs)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [id, t] of due) {
      if (!timers.has(id)) continue;
      timers.delete(id);
      t.fn();
    }
  }

  function fireDoc(type) {
    for (const [t, fn] of [...docListeners]) if (t === type) fn({ type });
  }
  function fireWin(type) {
    for (const [t, fn] of [...winListeners]) if (t === type) fn({ type });
  }
  function fireTab(type) {
    for (const [t, fn] of [...tabListeners]) if (t === type) fn({ type });
  }

  return {
    FakeElement,
    window,
    document,
    docRoot,
    Services,
    prefs,
    toolbox,
    topButtons,
    essentials,
    verticalTabs,
    pinnedSec,
    normalSec,
    mediaToolbar,
    videoPreview,
    bottomButtons,
    core: window.__zentralWidgetsTestSeam.core,
    start,
    flushRaf,
    advanceTime,
    fireDoc,
    fireWin,
    fireTab,
    getNow: () => nowMs,
    setNow: (v) => { nowMs = v; },
    counts: () => ({
      timers: timers.size,
      rafs: rafs.size,
      prefObservers: prefObservers.length,
      winListeners: winListeners.filter((x) => x[0] !== "unload").length,
      docListeners: docListeners.length,
      tabListeners: tabListeners.length,
      liveMutationObservers: mutationObservers.filter((o) => !o.disconnected).length,
      liveResizeObservers: resizeObservers.filter((o) => !o.disconnected).length,
    }),
  };
}

module.exports = { createFakeSidebarHarness, widgetSrc, widgetCss };
