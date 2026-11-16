"use strict";
/* Regression suite for cold-start #zen-app-panel-root detachment via native
 * gBrowser.discardBrowser / _endRemoveTab / getPanel 3-hop parentNode collision,
 * moveBefore cross-root fallback, ZenFolder empty-placeholder crash, and
 * cold-startup nativeReady barriers. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createDom = require("./helpers/fake-dom.cjs");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

/* Gecko-faithful DOM + gBrowser harness exercising real:
 * - Element.moveBefore throwing HierarchyRequestError across roots
 * - browser -> stack -> box.browserContainer -> vbox.browserSidebarContainer (3 hops)
 * - #zen-app-panel-root -> #zen-app-panel-clip -> #zen-app-panel-slider -> browser (3 hops!)
 * - gBrowser.getBrowserContainer / getPanel / discardBrowser / _endRemoveTab / removeTab
 * - capture-phase vs bubble-phase window event dispatch
 * - real ZentralPanelLifecycle.js + real ZentralBrowserIntegrations.uc.js */
function createAddonHostHarness() {
  const { El, Ev, document } = createDom();
  document.createXULElement = (tag) => document.createElement(tag);
  document.querySelector = (sel) => document.querySelectorAll(sel)[0] || null;

  if (!Object.getOwnPropertyDescriptor(El.prototype, "parentNode")) {
    Object.defineProperty(El.prototype, "parentNode", {
      configurable: true,
      get() { return this.parent; },
    });
  }
  if (!Object.getOwnPropertyDescriptor(El.prototype, "localName")) {
    Object.defineProperty(El.prototype, "localName", {
      configurable: true,
      get() { return this.tag; },
    });
  }
  if (!Object.getOwnPropertyDescriptor(El.prototype, "nextSibling")) {
    Object.defineProperty(El.prototype, "nextSibling", {
      configurable: true,
      get() {
        if (!this.parent) return null;
        const i = this.parent.children.indexOf(this);
        return i >= 0 ? this.parent.children[i + 1] || null : null;
      },
    });
  }
  El.prototype.getRootNode = function () {
    let cur = this;
    while (cur && cur.parent) cur = cur.parent;
    return cur === document.documentElement ? document : cur;
  };
  El.prototype.moveBefore = function (node, ref = null) {
    if (this.getRootNode() !== node.getRootNode()) {
      const err = new Error("Element.moveBefore: Different root node.");
      err.name = "HierarchyRequestError";
      throw err;
    }
    return this.insertBefore(node, ref);
  };

  // Window with capture + bubble event dispatch and controllable timers
  const winListeners = [];
  const timers = [];
  let nextTimerId = 1;
  const setTimer = (fn, ms = 0) => {
    const id = nextTimerId++;
    timers.push({ id, fn, ms, active: true });
    return id;
  };
  const clearTimer = (id) => {
    const t = timers.find((x) => x.id === id);
    if (t) t.active = false;
  };
  const flushTimers = () => {
    while (true) {
      const next = timers.find((t) => t.active);
      if (!next) break;
      next.active = false;
      next.fn();
    }
  };

  const dispatchWindowEvent = (ev, target) => {
    ev.target = target;
    let stopped = false;
    ev.stopImmediatePropagation = () => { stopped = true; };
    for (const l of [...winListeners]) {
      if (l.type === ev.type && l.capture) {
        l.fn(ev);
        if (stopped) return;
      }
    }
    for (const l of [...winListeners]) {
      if (l.type === ev.type && !l.capture) {
        l.fn(ev);
        if (stopped) return;
      }
    }
  };

  const prefs = new Map([
    ["zen.workspace.bgalazka.addon_tab_id_bridge", true],
    ["zen.workspace.bgalazka.show_addon_host_folder", false],
    ["zen.workspace.apps.sidebar.enabled", true],
  ]);
  const Services = {
    prefs: {
      getBoolPref: (k, d = false) => (prefs.has(k) ? !!prefs.get(k) : d),
      getStringPref: (k, d = "") => (prefs.has(k) ? String(prefs.get(k)) : d),
      setBoolPref: (k, v) => prefs.set(k, !!v),
      setStringPref: (k, v) => prefs.set(k, String(v)),
      addObserver() {},
      removeObserver() {},
    },
    scriptSecurityManager: {
      getSystemPrincipal: () => ({ isSystemPrincipal: true }),
      createContentPrincipal: (uri) => ({ uri }),
    },
    io: { newURI: (s) => ({ spec: s }) },
    obs: { addObserver() {}, removeObserver() {} },
  };

  class CustomEvent extends Ev {
    constructor(type, opts = {}) {
      super(type, opts);
      this.detail = opts.detail ?? null;
    }
  }

  const window = {
    document,
    innerWidth: 1400,
    innerHeight: 900,
    Services,
    Element: { prototype: El.prototype },
    CustomEvent,
    Event: Ev,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    requestAnimationFrame: (fn) => setTimer(fn, 0),
    cancelAnimationFrame: clearTimer,
    getComputedStyle: () => ({ display: "flex", visibility: "visible" }),
    addEventListener(type, fn, capture = false) {
      winListeners.push({ type, fn, capture: !!capture });
    },
    removeEventListener(type, fn, capture = false) {
      const i = winListeners.findIndex(
        (l) => l.type === type && l.fn === fn && l.capture === !!capture,
      );
      if (i >= 0) winListeners.splice(i, 1);
    },
  };
  window.window = window;

  // Build Zentral panel shell (exact 3-hop nesting: root > clip > slider > browser)
  const panelRoot = document.createElement("div");
  panelRoot.id = "zen-app-panel-root";
  const panelClip = document.createElement("div");
  panelClip.id = "zen-app-panel-clip";
  const panelSlider = document.createElement("div");
  panelSlider.id = "zen-app-panel-slider";
  panelClip.appendChild(panelSlider);
  panelRoot.appendChild(panelClip);
  document.documentElement.appendChild(panelRoot);

  // Build native tabbrowser DOM container
  const tabpanels = document.createElement("tabpanels");
  tabpanels.id = "tabbrowser-tabpanels";
  document.body.appendChild(tabpanels);

  let nextTabPanelId = 1;
  const tabs = [];
  const createNativeTab = (label = "New Tab", opts = {}) => {
    const tab = document.createXULElement("tab");
    tab.label = label;
    tab.pinned = !!opts.pinned;
    tab.closing = false;
    if (opts.empty) tab.setAttribute("zen-empty-tab", "true");
    const panelId = `tabpanel-${nextTabPanelId++}`;
    tab.linkedPanel = panelId;
    tab.setAttribute("linkedpanel", panelId);

    const sidebarContainer = document.createElement("vbox");
    sidebarContainer.id = panelId;
    sidebarContainer.className = "browserSidebarContainer";
    const browserContainer = document.createElement("box");
    browserContainer.className = "browserContainer";
    const stack = document.createElement("stack");
    stack.className = "browserStack";
    const browser = document.createXULElement("browser");
    browser.setAttribute("type", "content");
    browser.connectedMoveCallback = function () {};
    browser.webProgress = {
      listeners: new Set(),
      addProgressListener(l) { this.listeners.add(l); },
      removeProgressListener(l) { this.listeners.delete(l); },
    };
    browser.webNavigation = { reload() {} };
    browser.fixupAndLoadURIString = function (url) {
      this.currentURI = { spec: url };
    };
    browser.currentURI = { spec: "about:blank" };

    stack.appendChild(browser);
    browserContainer.appendChild(stack);
    sidebarContainer.appendChild(browserContainer);
    tabpanels.appendChild(sidebarContainer);

    tab.linkedBrowser = browser;
    document.body.appendChild(tab);
    tabs.push(tab);
    return tab;
  };

  const normalTab = createNativeTab("Normal Tab");
  let selectedTab = normalTab;

  const tabContainer = {
    get selectedItem() { return selectedTab; },
    set selectedItem(v) { selectedTab = v; },
    get selectedIndex() { return tabs.indexOf(selectedTab); },
    set selectedIndex(i) { selectedTab = tabs[i] || selectedTab; },
    getItemAtIndex(i) { return tabs[i] || null; },
  };

  const gBrowser = {
    tabs,
    tabContainer,
    _tabFilters: new WeakMap(),
    get selectedTab() { return selectedTab; },
    set selectedTab(v) { selectedTab = v; },
    get selectedBrowser() { return selectedTab?.linkedBrowser || null; },
    getBrowserContainer(aBrowser) {
      return (aBrowser || this.selectedBrowser).parentNode.parentNode;
    },
    getPanel(aBrowser) {
      return this.getBrowserContainer(aBrowser).parentNode;
    },
    addTab(url, opts = {}) {
      const t = createNativeTab(url || "about:blank", opts);
      this._tabFilters.set(t, { id: t.linkedPanel });
      return t;
    },
    pinTab(t) {
      t.pinned = true;
      t.setAttribute("pinned", "true");
    },
    discardBrowser(aTab, aForceDiscard) {
      const browser = aTab.linkedBrowser;
      // Mirrors Firefox Tabbrowser.sys.mjs: this.getPanel(browser).remove()
      const panel = this.getPanel(browser);
      if (panel) panel.remove();
      aTab.removeAttribute("linkedpanel");
      aTab.linkedPanel = null;
      aTab.setAttribute("discarded", "true");
      dispatchWindowEvent(new CustomEvent("TabBrowserDiscarded", { bubbles: true }), aTab);
      return true;
    },
    _endRemoveTab(aTab) {
      const browser = aTab.linkedBrowser;
      const panel = this.getPanel(browser);
      aTab.closing = true;
      aTab.remove();
      const idx = tabs.indexOf(aTab);
      if (idx >= 0) tabs.splice(idx, 1);
      if (browser) browser.remove();
      if (panel) panel.remove();
    },
    removeTab(aTab) {
      aTab.closing = true;
      dispatchWindowEvent(new CustomEvent("TabClose", { bubbles: true }), aTab);
      this._endRemoveTab(aTab);
    },
  };

  const createZenFolder = (initialTabs, opts = {}) => {
    const folder = document.createElement("zen-folder");
    folder.id = opts.id || "";
    folder.isZenFolder = true;
    folder.setAttribute("label", opts.label || "");
    folder.collapsed = !!opts.collapsed;
    const emptyTab = createNativeTab("New Tab", { pinned: true, empty: true });
    emptyTab.group = folder;
    folder._emptyTab = emptyTab;
    folder.appendChild(emptyTab);
    folder.tabs = [emptyTab];
    folder.addTabs = (list) => {
      for (const t of list) {
        t.group = folder;
        folder.appendChild(t);
        if (!folder.tabs.includes(t)) folder.tabs.push(t);
      }
    };
    folder.deleteCalls = 0;
    folder.delete = () => {
      folder.deleteCalls++;
      if (!folder._emptyTab || !folder._emptyTab.isConnected) {
        throw new TypeError('can\'t access property "linkedBrowser", aTab is null');
      }
      folder.remove();
      return Promise.resolve();
    };
    document.body.appendChild(folder);
    folder.addTabs(initialTabs || []);
    return folder;
  };

  window.gBrowser = gBrowser;
  window.gZenFolders = {
    createFolder: createZenFolder,
    relayoutCollapsedFolder() {},
  };
  window.gZenWorkspaces = {
    activeWorkspace: "ws-1",
    get allStoredTabs() { return [...tabs]; },
  };

  const factories = new Map();
  const parts = new Map();
  window.ZentralModuleLoader = {
    define(id, fn) { factories.set(id, fn); },
  };
  window.ZentralRuntime = {
    nativeReady: Promise.resolve(),
    registerPart(id, def) { parts.set(id, def); },
  };

  const warnings = [];
  const context = {
    window,
    document,
    Services,
    gBrowser,
    Ci: { nsIWebProgress: { NOTIFY_ALL: 0xff }, nsIWebNavigation: { LOAD_FLAGS_NONE: 0 } },
    ChromeUtils: { importESModule: () => ({}) },
    Element: window.Element,
    CustomEvent,
    Event: Ev,
    console: { ...console, warn: (...a) => warnings.push(a.join(" ")), error: (...a) => warnings.push(a.join(" ")) },
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    getComputedStyle: window.getComputedStyle,
    URL,
    Date,
    JSON,
    Math,
    Promise,
    RegExp,
    Number,
    Map,
    Set,
    WeakMap,
    Array,
    Object,
    String,
    Boolean,
    Error,
    TypeError,
  };
  context.globalThis = context;
  vm.createContext(context);

  vm.runInContext(read("zentral/apps/controllers/ZentralPanelLifecycle.js"), context, {
    filename: "zentral/apps/controllers/ZentralPanelLifecycle.js",
  });
  vm.runInContext(read("extension/panels/browsers/ZentralBrowserIntegrations.uc.js"), context, {
    filename: "extension/panels/browsers/ZentralBrowserIntegrations.uc.js",
  });

  const appBrowsers = new Map();
  const access = {
    dom: { root: panelRoot, panel: panelSlider, pinBtn: null, expandBtn: null },
    state: { appBrowsers, activeAppId: null, closeTimerId: null, isExpanded: false, isPinned: false, panelWidthPx: 420, preExpandWidth: null },
    createSVG: () => document.createElement("svg"),
    getEasingBezier: () => "ease",
  };
  const lifecycle = factories.get("apps/ZentralPanelLifecycle")({
    Services,
    shared: {
      Constants: { Apps: { PREF_ENABLED: "zen.workspace.apps.sidebar.enabled", MIN_WIDTH_PX: 260 } },
      Core: { log() {}, getPref: (k, d) => (k === "zen.workspace.apps.sidebar.enabled" ? true : d) },
      createSVGElement: () => document.createElement("svg"),
      SVG_STRINGS: { EXPAND: "", PIN: "" },
      WELL_KNOWN_SERVICES: {},
    },
    runtime: {},
    access,
  });
  const apps = Object.assign(lifecycle, {
    _destroyed: false,
    syncAllAppBadges() {},
    ensureBadgeSyncLoop() {},
    closeLibraryForPanel() {},
    setAutohideHovered() {},
    loadWidth: () => 420,
    updateWidthVar() {},
    positionPanel() {},
    updateVerticalBarBounds() {},
    startPositionTracking() {},
    isCollapsedLayoutMode: () => false,
    isPanelAttachedToRight: () => false,
    isPlacementVerticalBar: () => false,
    closePanel() { panelRoot.removeAttribute("open"); },
    closeApp(appId) {
      const b = appBrowsers.get(appId);
      if (b) {
        b.remove();
        appBrowsers.delete(appId);
      }
    },
  });
  window.Zentral = { Apps: apps };

  const cleanups = [];
  const ctx = {
    BGALAZKA_EXT_PREFS: {
      ADDON_TAB_ID_BRIDGE: "zen.workspace.bgalazka.addon_tab_id_bridge",
      SHOW_ADDON_HOST_FOLDER: "zen.workspace.bgalazka.show_addon_host_folder",
    },
    essentialPanels: new Map(),
    getPref(key, fallback) {
      if (typeof fallback === "boolean") return Services.prefs.getBoolPref(key, fallback);
      return Services.prefs.getStringPref(key, fallback);
    },
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    registerCleanup: (fn) => cleanups.push(fn),
    retryPanelTask() {},
    safeCall(fn) { return fn(); },
    getAllAppBrowsers: () => Array.from(document.querySelectorAll("#zen-app-panel-slider browser, #bgalazka-super-panel browser")),
    reconcileFeaturePreferences() {},
    recreateLoadedPanels() {},
    saveEssentialSettings() {},
  };

  const part = parts.get("browser-integrations");
  const gen = part(ctx);
  gen.next();
  gen.next();

  const origGetOrCreate = apps.getOrCreateAppBrowser.bind(apps);
  const openAdoptedApp = (app) =>
    ctx.callGetOrCreateWithAddonHostBrowser(origGetOrCreate, app, 0);

  return {
    window,
    document,
    gBrowser,
    apps,
    ctx,
    panelRoot,
    panelClip,
    panelSlider,
    normalTab,
    tabs,
    warnings,
    flushTimers,
    openAdoptedApp,
    cleanup() { cleanups.splice(0).reverse().forEach((fn) => fn()); },
  };
}

(async () => {
  await test("getBrowserContainer and getPanel never resolve to #zen-app-panel-clip or #zen-app-panel-root", async () => {
    const h = createAddonHostHarness();
    const app = { id: "bgalazka-essential-top", title: "Messenger", url: "https://www.messenger.com/" };
    const { browser } = h.openAdoptedApp(app);

    // Exact 3-hop collision geometry inside Zentral panel
    assert.equal(browser.parentNode, h.panelSlider);
    assert.equal(browser.parentNode.parentNode, h.panelClip);
    assert.equal(browser.parentNode.parentNode.parentNode, h.panelRoot);

    const container = h.gBrowser.getBrowserContainer(browser);
    const panel = h.gBrowser.getPanel(browser);
    assert.notEqual(container, h.panelClip, "getBrowserContainer must not return #zen-app-panel-clip");
    assert.notEqual(panel, h.panelRoot, "getPanel must not return #zen-app-panel-root");
    assert.equal(panel.className, "browserSidebarContainer", "getPanel returns the host tab's real tabpanel");
    h.cleanup();
  });

  await test("unforced gBrowser.discardBrowser is refused on active host tabs; forced discard preserves #zen-app-panel-root", async () => {
    const h = createAddonHostHarness();
    const app = { id: "bgalazka-essential-top", title: "Messenger", url: "https://www.messenger.com/" };
    const { browser } = h.openAdoptedApp(app);
    const record = h.ctx.addonHostByAppId.get(app.id);
    const hostTab = record.tab;

    // Unforced discard (tab unloader / folder sync) must be blocked cleanly.
    const unforced = h.gBrowser.discardBrowser(hostTab, false);
    assert.equal(unforced, false, "unforced discard on live host tab must return false");
    assert.equal(h.panelRoot.isConnected, true, "#zen-app-panel-root stays connected");
    assert.equal(browser.parentNode, h.panelSlider, "adopted browser stays inside #zen-app-panel-slider");
    assert.equal(h.ctx.addonHostByAppId.has(app.id), true, "host record remains active");

    // Forced discard must restore browser to its own tab stack BEFORE native getPanel(browser).remove().
    h.gBrowser.discardBrowser(hostTab, true);
    assert.equal(h.panelRoot.isConnected, true, "forced discard must never detach #zen-app-panel-root");
    assert.equal(h.document.getElementById("zen-app-panel-root"), h.panelRoot);
    assert.equal(h.ctx.addonHostByAppId.has(app.id), false, "host record cleaned up after forced discard");
    h.flushTimers();
    h.cleanup();
  });

  await test("external gBrowser.removeTab, direct _endRemoveTab, and dead originalParent all leave #zen-app-panel-root connected", async () => {
    const h = createAddonHostHarness();

    // Case A: normal external gBrowser.removeTab (fires capture TabClose)
    const appA = { id: "app-a", title: "A", url: "https://a.example/" };
    h.openAdoptedApp(appA);
    const recA = h.ctx.addonHostByAppId.get("app-a");
    h.gBrowser.removeTab(recA.tab);
    assert.equal(h.panelRoot.isConnected, true, "external removeTab preserves #zen-app-panel-root");

    // Case B: direct _endRemoveTab bypassing TabClose
    const appB = { id: "app-b", title: "B", url: "https://b.example/" };
    h.openAdoptedApp(appB);
    const recB = h.ctx.addonHostByAppId.get("app-b");
    h.gBrowser._endRemoveTab(recB.tab);
    assert.equal(h.panelRoot.isConnected, true, "direct _endRemoveTab preserves #zen-app-panel-root");

    // Case C: originalParent already detached before TabClose (restore throws -> evacuate fallback!)
    const appC = { id: "app-c", title: "C", url: "https://c.example/" };
    h.openAdoptedApp(appC);
    const recC = h.ctx.addonHostByAppId.get("app-c");
    recC.originalParent.parentNode.parentNode.remove(); // detach tabpanel beforehand
    h.gBrowser.removeTab(recC.tab);
    assert.equal(h.panelRoot.isConnected, true, "disconnected originalParent fallback still preserves #zen-app-panel-root");
    assert.equal(h.panelSlider.querySelectorAll("browser").length, 0, "dead host browser evacuated from slider");

    h.flushTimers();
    h.cleanup();
  });

  await test("moveBefore across different roots falls back to insertBefore, and ZentralPanelLifecycle self-heals a detached root", async () => {
    const h = createAddonHostHarness();

    // Simulate external detachment of #zen-app-panel-root before openPanel/getOrCreateAppBrowser
    h.panelRoot.remove();
    assert.equal(h.panelRoot.isConnected, false);

    // Calling getOrCreateAppBrowser via real lifecycle self-heals and reattaches #zen-app-panel-root
    const app = { id: "app-heal", title: "Heal", url: "https://heal.example/" };
    const { browser } = h.openAdoptedApp(app);
    assert.equal(h.panelRoot.isConnected, true, "getOrCreateAppBrowser reattached #zen-app-panel-root");
    assert.equal(browser.parentNode, h.panelSlider);

    // Explicitly test cross-root moveAddonHostBrowser fallback without throwing HierarchyRequestError
    const detachedParent = h.document.createElement("div");
    assert.doesNotThrow(() => browser._zentralMoveTo(detachedParent), "cross-root move falls back to insertBefore");
    assert.equal(browser.parentNode, detachedParent);

    // Also verify openPanel self-heals a detached root when not destroyed
    h.panelRoot.remove();
    assert.equal(h.panelRoot.isConnected, false);
    h.apps.openPanel(app);
    assert.equal(h.panelRoot.isConnected, true, "openPanel reattached #zen-app-panel-root");

    // Destroyed instance must NOT reattach #zen-app-panel-root
    h.panelRoot.remove();
    h.apps._destroyed = true;
    h.apps.openPanel(app);
    assert.equal(h.panelRoot.isConnected, false, "destroyed ZentralApps must not reattach root");

    h.cleanup();
  });

  await test("nativeReady runtime barrier actually waits for gZenPinnedTabManager, gZenSessionStore, gZenWindowSync, and delayedStartupPromise", async () => {
    for (const [rel, isShim] of [
      ["loader/ZentralRuntime.js", false],
      ["loader/standalone/ZentralStandaloneShim.js", true],
    ]) {
      let resolvePinned, resolveSession, resolveSync, resolveDelayed;
      const pinnedReady = new Promise((r) => { resolvePinned = r; });
      const sessionReady = new Promise((r) => { resolveSession = r; });
      const syncReady = new Promise((r) => { resolveSync = r; });
      const delayedReady = new Promise((r) => { resolveDelayed = r; });

      let readyFired = false;
      const Services = {
        prefs: {
          getBoolPref: (_k, d) => d,
          getStringPref: (_k, d) => d,
          getIntPref: (_k, d) => d,
          addObserver() {},
          removeObserver() {},
        },
        obs: { addObserver() {}, removeObserver() {} },
        io: { newURI: (s) => ({ spec: s }) },
      };
      const win = {
        document: {
          readyState: "complete",
          documentElement: {
            setAttribute() {},
            removeAttribute() {},
            toggleAttribute() {},
            getAttribute: () => null,
            hasAttribute: () => false,
            style: { setProperty() {}, removeProperty() {} },
          },
          head: { appendChild() {} },
          getElementById: () => null,
          querySelector: () => null,
          querySelectorAll: () => [],
          addEventListener() {},
          removeEventListener() {},
        },
        SessionStore: { promiseInitialized: Promise.resolve(), promiseAllWindowsRestored: Promise.resolve() },
        delayedStartupPromise: delayedReady,
        gZenWorkspaces: { promiseInitialized: Promise.resolve() },
        gZenStartup: { promiseInitialized: Promise.resolve() },
        gZenPinnedTabManager: { promiseInitialized: pinnedReady },
        gZenSessionStore: { promiseInitialized: sessionReady },
        gZenWindowSync: { promiseInitialized: syncReady },
        gBrowser: {},
        ZentralCatalog: { MANIFEST: [], CSS_MANIFEST: [] },
        ZentralModuleLoader: {
          rootURI: "file:///zentral/",
          load() { return false; },
          loadPart() { return false; },
          readText() { return "[]"; },
          create() { return { MANIFEST: [], CSS_MANIFEST: [], settingsSupport: false }; },
        },
        dispatchEvent() {},
        addEventListener() {},
        removeEventListener() {},
        setTimeout,
        clearTimeout,
      };
      win.window = win;
      class StubObserver { observe() {} disconnect() {} }
      class StubCustomEvent { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } }
      const ctx = {
        window: win,
        document: win.document,
        Services,
        Components: { classes: {}, interfaces: {}, utils: { getGlobalForObject: () => ({}) } },
        ChromeUtils: { importESModule: () => ({ Services }) },
        ResizeObserver: StubObserver,
        MutationObserver: StubObserver,
        CustomEvent: StubCustomEvent,
        console: { ...console, info() {}, warn() {}, error() {} },
        Promise,
        Set,
        Map,
        WeakMap,
        Array,
        Object,
        JSON,
        String,
        Number,
        Boolean,
        Error,
        URL,
        Date,
        Math,
        setTimeout,
        clearTimeout,
      };
      ctx.globalThis = ctx;
      const raw = read(rel);
      const wrapped = isShim
        ? `const nativeSidebarElement=()=>null,nativeSidebarRect=()=>null,nativeSidebarSide=()=>"left",createSidebarHoverCard=()=>({}),createFeatureScope=()=>({});\n${raw}`
        : raw;
      vm.runInNewContext(wrapped, ctx, { filename: rel });
      const rt = isShim ? win.__zentralStandaloneRuntime : win.ZentralRuntime;
      if (!isShim && typeof rt?.boot === "function") rt.boot();

      rt.whenNativeReady(() => { readyFired = true; });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(readyFired, false, `${rel}: must NOT resolve nativeReady while Zen pinned/session/sync promises are pending`);

      resolveDelayed();
      resolvePinned();
      resolveSession();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(readyFired, false, `${rel}: still waits for gZenWindowSync.promiseInitialized`);

      resolveSync();
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(readyFired, true, `${rel}: resolves nativeReady once all Zen startup barriers settle`);
    }
  });

  await test("removeEmptyAddonHostFolder handles missing emptyTab without calling buggy ZenFolder.delete()", async () => {
    const h = createAddonHostHarness();
    const app = { id: "app-folder", title: "Folder", url: "https://folder.example/" };
    h.openAdoptedApp(app);
    const folder = h.ctx.findAddonHostFolder();
    assert.ok(folder, "addon host folder created");

    // Simulate ZenFolder whose internal empty placeholder was already stripped (aTab is null crash)
    h.ctx.removeAddonHostRecord(app.id);
    folder._emptyTab.remove();
    folder._emptyTab = null;
    folder.tabs = [];

    assert.doesNotThrow(() => h.ctx.removeEmptyAddonHostFolder());
    assert.equal(folder.deleteCalls, 0, "skips folder.delete() when empty placeholder is absent");
    assert.equal(folder.isConnected, false, "empty folder shell cleanly removed");
    h.cleanup();
  });

  await test("cleanup restores native gBrowser methods and leaves third-party overrides intact", async () => {
    const h = createAddonHostHarness();
    const app = { id: "app-clean", title: "Clean", url: "https://clean.example/" };
    h.openAdoptedApp(app);
    const wrappedGetPanel = h.gBrowser.getPanel;

    // Install a later third-party override on discardBrowser
    const thirdPartyDiscard = () => "third-party";
    h.gBrowser.discardBrowser = thirdPartyDiscard;

    h.cleanup();
    assert.notEqual(h.gBrowser.getPanel, wrappedGetPanel, "getPanel restored on cleanup");
    assert.equal(h.gBrowser.discardBrowser, thirdPartyDiscard, "later third-party override not clobbered");
  });

  await test("ZentralRuntime and ZentralStandaloneShim nativeReady wait for Zen pinned-tab/session/sync promises", async () => {
    for (const rel of ["loader/ZentralRuntime.js", "loader/standalone/ZentralStandaloneShim.js"]) {
      const src = read(rel);
      for (const token of [
        "promiseInitialized",
        "promiseAllWindowsRestored",
        "delayedStartupPromise",
        "gZenWorkspaces?.promiseInitialized",
        "gZenStartup?.promiseInitialized",
        "gZenPinnedTabManager?.promiseInitialized",
        "gZenSessionStore?.promiseInitialized",
        "gZenWindowSync?.promiseInitialized",
      ]) {
        assert.ok(src.includes(token), `${rel} must await ${token}`);
      }
    }
    const panelsSrc = read("extension/panels/ZentralPanels.uc.js");
    assert.ok(
      panelsSrc.includes('if (tab.hasAttribute("zen-empty-tab")) continue;'),
      "pruneRestoredAddonHosts must never remove zen-empty-tab placeholder",
    );
    assert.ok(
      panelsSrc.includes('window.addEventListener("SSTabRestored", onRestoredHostTab)'),
      "ZentralPanels prunes late session-restored stale host tabs",
    );
  });

  await test("ZentralNotes pseudoEventInside ignores non-Node targets (e.g. window) in composedPath", async () => {
    const src = read("additional/notes/ZentralNotes.uc.js");
    assert.ok(
      src.includes('typeof node?.nodeType === "number" && root.contains?.(node)'),
      "pseudoEventInside guards root.contains() against non-Node composedPath entries",
    );
  });

  console.log(`\nALL ${passed} ADD-ON HOST ROOT-PROTECTION TESTS PASSED`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
