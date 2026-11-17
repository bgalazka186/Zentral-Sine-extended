"use strict";
/* T3.9a tests: Sidebar widgets module shell, free-area measurement,
 * video-player avoidance (no fixed ratio, zero interaction), room for tabs/folders/Essentials,
 * per-widget on/off, per-widget refresh intervals (no setInterval), pause-when-hidden,
 * last-value caching, and leak-free disposal. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const widgetSrc = fs.readFileSync(
  path.join(root, "additional/widgets/ZentralWidgets.uc.js"),
  "utf8",
);
const widgetCss = fs.readFileSync(
  path.join(root, "additional/widgets/ZentralWidgets.css"),
  "utf8",
);

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

// Lightweight fake DOM that supports rects, computed styles, children/siblings,
// attributes, querySelectorAll, MutationObserver, ResizeObserver, and fake timers.
function createFakeSidebarHarness(initialPrefs = {}) {
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

(async () => {
  await test("static: zero setInterval polling in ZentralWidgets and normal-flow CSS (no z-index overlay)", () => {
    assert.ok(!/\bsetInterval\b/.test(widgetSrc), "must never use setInterval");
    assert.ok(!/\bz-index\b/.test(widgetCss), "widget tray stays in normal flex flow without z-index");
    assert.match(widgetCss, /#zentral-sidebar-widgets\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    assert.match(widgetCss, /contain:\s*inline-size/);
    assert.match(widgetCss, /prefers-reduced-motion/);
  });

  await test("pure computeWidgetArea: owner dimensions (179x426 free, 179x301 with 16:9 player), arbitrary ratios, and auto-hide thresholds", () => {
    const h = createFakeSidebarHarness();
    const { computeWidgetArea } = h.core;

    // 1. Standard sidebar: 179px wide, 900px tall, 176px chrome, 298px tabs -> 426px free
    const normal = computeWidgetArea(
      {
        sidebarWidth: 179,
        sidebarHeight: 900,
        otherChromeHeight: 176,
        videoPlayerVisible: false,
        videoPlayerHeight: 0,
        tabsContentHeight: 298,
      },
      { enabled: true, activeWidgetCount: 2, maxHeightShare: 45, minFreeHeight: 140, tabsReservePx: 24 },
    );
    assert.equal(normal.visible, true);
    assert.equal(normal.paused, false);
    assert.equal(normal.reason, "visible");
    assert.equal(normal.rawFreeHeight, 426);
    assert.equal(normal.usableFreeHeight, 402);
    assert.equal(normal.maxTrayHeight, Math.floor(426 * 0.45));
    assert.equal(normal.videoPlayerVisible, false);
    assert.equal(normal.density, "regular");

    // 2. 16:9 sidebar video player showing (125px height) -> 301px free
    const with16by9 = computeWidgetArea(
      {
        sidebarWidth: 179,
        sidebarHeight: 900,
        otherChromeHeight: 176,
        videoPlayerVisible: true,
        videoPlayerHeight: 125,
        tabsContentHeight: 298,
      },
      { enabled: true, activeWidgetCount: 2, maxHeightShare: 45, minFreeHeight: 140, tabsReservePx: 24 },
    );
    assert.equal(with16by9.visible, true);
    assert.equal(with16by9.rawFreeHeight, 301);
    assert.equal(with16by9.maxTrayHeight, Math.floor(301 * 0.45));
    assert.equal(with16by9.videoPlayerVisible, true);
    assert.equal(with16by9.videoReservedHeight, 125);

    // 3. Portrait / custom-resized video player (no fixed aspect ratio assumed: e.g. 240px) -> 186px free
    const withTallPlayer = computeWidgetArea(
      {
        sidebarWidth: 179,
        sidebarHeight: 900,
        otherChromeHeight: 176,
        videoPlayerVisible: true,
        videoPlayerHeight: 240,
        tabsContentHeight: 298,
      },
      { enabled: true, activeWidgetCount: 2, maxHeightShare: 45, minFreeHeight: 140, tabsReservePx: 24 },
    );
    assert.equal(withTallPlayer.visible, true);
    assert.equal(withTallPlayer.rawFreeHeight, 186);
    assert.equal(withTallPlayer.videoReservedHeight, 240);

    // 4. Very tall video player or lots of tabs drops free height below minFreeHeight -> auto-hide + pause
    const tight = computeWidgetArea(
      {
        sidebarWidth: 179,
        sidebarHeight: 900,
        otherChromeHeight: 176,
        videoPlayerVisible: true,
        videoPlayerHeight: 300,
        tabsContentHeight: 298,
      },
      { enabled: true, activeWidgetCount: 2, maxHeightShare: 45, minFreeHeight: 140, tabsReservePx: 24 },
    );
    assert.equal(tight.rawFreeHeight, 126);
    assert.equal(tight.visible, false);
    assert.equal(tight.paused, true);
    assert.equal(tight.reason, "low-free-height");
    assert.equal(tight.maxTrayHeight, 0);

    // 5. Collapsed/narrow sidebar (< 120px) -> auto-hide + pause
    const narrow = computeWidgetArea(
      { sidebarWidth: 56, sidebarHeight: 900, otherChromeHeight: 176, tabsContentHeight: 200 },
      { enabled: true, activeWidgetCount: 1, minSidebarWidth: 120 },
    );
    assert.equal(narrow.visible, false);
    assert.equal(narrow.paused, true);
    assert.equal(narrow.reason, "narrow-sidebar");

    // 6. Narrow compact-density sidebar (165px) stays visible in compact density
    const compact = computeWidgetArea(
      { sidebarWidth: 165, sidebarHeight: 900, otherChromeHeight: 176, tabsContentHeight: 298 },
      { enabled: true, activeWidgetCount: 1, minSidebarWidth: 120 },
    );
    assert.equal(compact.visible, true);
    assert.equal(compact.density, "compact");

    // 7. Window hidden or sidebar hidden pauses when pauseWhenHidden=true
    const hiddenWin = computeWidgetArea(
      { sidebarWidth: 179, sidebarHeight: 900, otherChromeHeight: 176, tabsContentHeight: 298, windowHidden: true },
      { enabled: true, activeWidgetCount: 1, pauseWhenHidden: true },
    );
    assert.equal(hiddenWin.visible, false);
    assert.equal(hiddenWin.paused, true);
    assert.equal(hiddenWin.reason, "window-hidden");
  });

  await test("DOM mount & video-player avoidance: never breaks video.previousSibling or touches #zentral-video-preview", () => {
    const h = createFakeSidebarHarness({ "zen.workspace.zentral.widgets.enabled": true });
    const { api } = h.start();

    api.registerWidget({
      id: "sample",
      title: "Sample",
      create({ document }) {
        const el = document.createElement("div");
        return { element: el, render(v) { el.textContent = String(v ?? ""); } };
      },
    });

    const tray = h.document.getElementById("zentral-sidebar-widgets");
    assert.ok(tray, "tray mounted in sidebar");
    assert.equal(tray.parentNode, h.toolbox);
    // Tray mounts strictly BEFORE #zen-media-controls-toolbar so #zentral-video-preview stays adjacent to its anchor!
    assert.equal(tray.nextSibling, h.mediaToolbar);
    assert.equal(h.videoPreview.previousSibling, h.mediaToolbar, "video player's anchor adjacency is untouched");
    assert.equal(h.videoPreview.hidden, true, "video player state untouched");
    assert.equal(h.videoPreview.style._props.size, 0, "zero styles written to video player");

    // Verify exact live DOM measurement matches 179x426 -> 179x301 -> 179x426 (Big Preview enlarged)
    let area = api.getArea();
    assert.equal(area.visible, true);
    assert.equal(area.sidebarWidth, 179);
    assert.equal(area.rawFreeHeight, 426);
    assert.equal(area.videoPlayerVisible, false);
    assert.equal(tray.getAttribute("data-zw-video-avoiding"), "false");

    // Simulate 16:9 sidebar video player appearing (125px tall) + vertical-tabs flex shrinking
    h.videoPreview.hidden = false;
    h.videoPreview.setRect({ top: 731, width: 179, height: 125 });
    h.verticalTabs.setRect({ top: 132, width: 179, height: 599 });
    area = api.remeasure();
    assert.equal(area.visible, true);
    assert.equal(area.rawFreeHeight, 301);
    assert.equal(area.videoPlayerVisible, true);
    assert.equal(area.videoReservedHeight, 125);
    assert.equal(tray.getAttribute("data-zw-video-avoiding"), "true");
    assert.equal(tray.style.getPropertyValue("--zw-max-height"), Math.floor(301 * 0.45) + "px");

    // Re-measuring again after tray is shown MUST produce the exact same free height (zero feedback loop!)
    tray.setRect({ top: 596, width: 179, height: 135 });
    h.verticalTabs.setRect({ top: 132, width: 179, height: 464 });
    const area2 = api.remeasure();
    assert.equal(area2.rawFreeHeight, 301, "showing tray does not create a shrink feedback loop");
    assert.equal(area2.maxTrayHeight, area.maxTrayHeight);

    // Simulate Big Preview pop-out ([data-enlarged]) -> video no longer occupies sidebar height
    h.videoPreview.setAttribute("data-enlarged", "true");
    area = api.remeasure();
    assert.equal(area.videoPlayerVisible, false);
    assert.equal(area.rawFreeHeight, 426);

    // Fallback check when mediaToolbar & bottomButtons are absent and videoPreview sits right after vertical-tabs:
    h.mediaToolbar.remove();
    h.bottomButtons.remove();
    const target = h.core.chooseWidgetMountTarget(h.document, h.window, h.toolbox);
    assert.equal(target.parent, h.toolbox);
    assert.notEqual(target.before, h.videoPreview, "never wedges between #vertical-tabs and #zentral-video-preview");

    api.destroy();
  });

  await test("room for tabs, folders & Essentials: adding overflowing tabs auto-hides tray and pauses timers", () => {
    const h = createFakeSidebarHarness({
      "zen.workspace.zentral.widgets.enabled": true,
      "zen.workspace.zentral.widgets.clock.enabled": false,
      "zen.workspace.zentral.widgets.date.enabled": false,
    });
    const { api } = h.start();

    let fetches = 0;
    api.registerWidget({
      id: "ticker",
      title: "Ticker",
      refreshMs: 10000,
      create({ document }) {
        const el = document.createElement("div");
        return {
          element: el,
          fetch() { fetches++; return "v" + fetches; },
          render(val) { el.textContent = val || ""; },
        };
      },
    });

    assert.equal(api.getArea().visible, true);
    assert.equal(api.isPaused(), false);
    assert.equal(api.activeTimerCount(), 1);
    assert.equal(fetches, 1);

    // User opens many tabs so tabs overflow the vertical-tabs container
    h.verticalTabs.scrollHeight = 980;
    h.verticalTabs.clientHeight = 724;
    h.fireTab("TabOpen");
    h.flushRaf();

    const area = api.getArea();
    assert.equal(area.visible, false);
    assert.equal(area.reason, "low-free-height");
    assert.equal(api.getTray().hidden, true);
    assert.equal(api.isPaused(), true);
    assert.equal(api.activeTimerCount(), 0, "all refresh timers cleared while hidden");

    // Advance 60 seconds while hidden -> zero background fetches!
    h.advanceTime(60000);
    assert.equal(fetches, 1, "no polling while hidden due to tight space");

    // Close extra tabs -> space returns -> tray reappears and refreshes stale widget
    h.verticalTabs.scrollHeight = 298;
    h.fireTab("TabClose");
    h.flushRaf();
    assert.equal(api.getArea().visible, true);
    assert.equal(api.isPaused(), false);
    assert.equal(fetches, 2, "stale widget refreshes once space returns");

    api.destroy();
  });

  await test("pause when window or sidebar is hidden, cached last value, and error resilience", async () => {
    const h = createFakeSidebarHarness({
      "zen.workspace.zentral.widgets.enabled": true,
      "zen.workspace.zentral.widgets.clock.enabled": false,
      "zen.workspace.zentral.widgets.date.enabled": false,
    });
    const { api } = h.start();

    let failNext = false;
    let calls = 0;
    const renders = [];

    api.registerWidget({
      id: "feed",
      title: "Feed",
      refreshMs: 30000,
      create({ document }) {
        const el = document.createElement("div");
        return {
          element: el,
          async fetch() {
            calls++;
            if (failNext) throw new Error("offline");
            return { text: "headline-" + calls };
          },
          render(value, meta) {
            renders.push({ value, cached: meta.cached, error: Boolean(meta.error) });
            el.textContent = value ? value.text : "empty";
          },
        };
      },
    });

    await Promise.resolve();
    assert.equal(calls, 1);
    assert.deepEqual(api.getCachedValue("feed").value, { text: "headline-1" });
    assert.equal(api.activeTimerCount(), 1);

    // Hide window -> timers immediately paused
    h.document.hidden = true;
    h.fireDoc("visibilitychange");
    h.flushRaf();
    assert.equal(api.isPaused(), true);
    assert.equal(api.activeTimerCount(), 0);

    // Advance 10s (still within 30s cache window!) and unhide window:
    // cached value paints immediately, NO premature refetch, one-shot timer waits remaining 20s!
    h.advanceTime(10000);
    h.document.hidden = false;
    h.fireDoc("visibilitychange");
    h.flushRaf();
    assert.equal(api.isPaused(), false);
    assert.equal(calls, 1, "fresh cache avoids unnecessary refetch on quick resume");
    assert.equal(renders[renders.length - 1].cached, true);
    assert.equal(api.activeTimerCount(), 1);

    // Now advance 20s -> triggers next refresh, which fails -> preserves cached last value!
    failNext = true;
    h.advanceTime(20000);
    await Promise.resolve();
    assert.equal(calls, 2);
    assert.deepEqual(api.getCachedValue("feed").value, { text: "headline-1" }, "transient error preserves last good cached value");
    assert.equal(renders[renders.length - 1].error, true);
    assert.deepEqual(renders[renders.length - 1].value, { text: "headline-1" });

    // Zen compact mode hides sidebar -> pauses immediately
    h.docRoot.setAttribute("zen-compact-mode", "true");
    api.remeasure();
    assert.equal(api.getArea().reason, "sidebar-hidden");
    assert.equal(api.isPaused(), true);
    assert.equal(api.activeTimerCount(), 0);

    // Compact sidebar revealed -> resumes
    failNext = false;
    h.advanceTime(40000);
    h.docRoot.setAttribute("zen-compact-sidebar-visible", "true");
    api.remeasure();
    await Promise.resolve();
    assert.equal(api.getArea().visible, true);
    assert.equal(calls, 3);
    assert.deepEqual(api.getCachedValue("feed").value, { text: "headline-3" });

    api.destroy();
  });

  await test("per-widget on/off (dedicated pref & disabled_ids), ordering, and zero-leak destroy", () => {
    const h = createFakeSidebarHarness({
      "zen.workspace.zentral.widgets.enabled": true,
      "zen.workspace.zentral.widgets.clock.enabled": false,
      "zen.workspace.zentral.widgets.date.enabled": false,
      "zen.workspace.zentral.widgets.alpha.enabled": true,
    });
    const { api } = h.start();

    let alphaDisposed = 0;
    let betaRenders = [];

    api.registerWidget({
      id: "beta",
      title: "Beta",
      order: 20,
      refreshMs: 60000,
      create({ document }) {
        const el = document.createElement("div");
        return {
          element: el,
          fetch() { return "beta-val"; },
          render(v, meta) { betaRenders.push({ v, cached: meta.cached }); el.textContent = v || ""; },
        };
      },
    });

    api.registerWidget({
      id: "alpha",
      title: "Alpha",
      order: 10,
      pref: "zen.workspace.zentral.widgets.alpha.enabled",
      refreshMs: 15000,
      create({ document }) {
        const el = document.createElement("div");
        return {
          element: el,
          fetch() { return "alpha-val"; },
          render(v) { el.textContent = v || ""; },
          dispose() { alphaDisposed++; },
        };
      },
    });

    // Order is strictly sorted (alpha=10 before beta=20)
    const tray = api.getTray();
    assert.deepEqual(
      tray.children.map((c) => c.getAttribute("data-zw-widget")),
      ["alpha", "beta"],
    );

    // Turn off alpha via its dedicated pref -> unmounts and calls dispose()
    api.setWidgetEnabled("alpha", false);
    assert.equal(h.prefs.get("zen.workspace.zentral.widgets.alpha.enabled"), false);
    assert.equal(alphaDisposed, 1);
    assert.deepEqual(
      tray.children.map((c) => c.getAttribute("data-zw-widget")),
      ["beta"],
    );

    // Turn off beta via generic disabled_ids -> tray has 0 active widgets and hides automatically
    api.setWidgetEnabled("beta", false);
    assert.equal(h.prefs.get("zen.workspace.zentral.widgets.disabled_ids"), "beta");
    assert.equal(api.getArea().visible, false);
    assert.equal(api.getArea().reason, "no-widgets");
    assert.equal(tray.hidden, true);
    assert.equal(api.activeTimerCount(), 0);

    // Re-enable beta -> cached value paints immediately without flicker!
    const beforeLen = betaRenders.length;
    api.setWidgetEnabled("beta", true);
    assert.equal(api.getArea().visible, true);
    assert.equal(betaRenders[beforeLen].cached, true);
    assert.equal(betaRenders[beforeLen].v, "beta-val");

    // Full destroy leaves ZERO leaked timers, observers, listeners, or DOM nodes
    api.destroy();
    assert.equal(h.document.getElementById("zentral-sidebar-widgets"), null);
    assert.equal(h.window.ZentralRuntime.services.widgets, undefined);
    assert.deepEqual(h.counts(), {
      timers: 0,
      rafs: 0,
      prefObservers: 0,
      winListeners: 0,
      docListeners: 0,
      tabListeners: 0,
      liveMutationObservers: 0,
      liveResizeObservers: 0,
    });
  });

  console.log(`\nPASS widgets-shell (${passed} tests)`);
})();
