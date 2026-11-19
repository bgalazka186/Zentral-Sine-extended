"use strict";
/* OW-37: Ctrl+Tab filtering for Notes/Agenda pseudo-tabs (always hidden) and
 * Zentral webpanel add-on host tabs (configurable, default hidden) while
 * keeping real Firefox add-on host tabs & WebExtension tabIds 100% intact. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createDom = require("./helpers/fake-dom.cjs");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

/* Realistic Firefox/Zen ctrlTab mock with recentlyUsedTabs, tabList getter,
 * _tabList snapshot, start, open, setupGUI, updatePreviews, pick, and close. */
function attachMockCtrlTab(win, gBrowser) {
  let openCalls = 0;
  let startCalls = 0;
  let closeCalls = 0;
  let renderedTabs = [];
  const ctrlTab = {
    recentlyUsedTabs: [...(gBrowser.tabs || [])],
    _tabList: null,
    previews: [],
    get tabList() {
      if (this._tabList) return this._tabList;
      return this.recentlyUsedTabs.filter((t) => t && !t.hidden && !t.closing);
    },
    start() {
      startCalls++;
      this._tabList = this.tabList;
      return this._tabList;
    },
    setupGUI() {
      this._tabList = this.recentlyUsedTabs.filter((t) => t && !t.hidden && !t.closing);
      this.updatePreviews();
    },
    updatePreviews() {
      const list = this._tabList || this.tabList;
      renderedTabs = [...list];
      this.previews = list.map((t) => ({ _tab: t }));
    },
    open() {
      openCalls++;
      this._tabList = this.tabList;
      this.updatePreviews();
      return this.previews;
    },
    pick(preview) {
      if (preview?._tab) gBrowser.selectedTab = preview._tab;
      this.close();
    },
    close() {
      closeCalls++;
      this._tabList = null;
    },
  };
  win.ctrlTab = ctrlTab;
  return {
    ctrlTab,
    stats: () => ({ openCalls, startCalls, closeCalls, renderedTabs: [...renderedTabs] }),
    resetStats: () => { openCalls = 0; startCalls = 0; closeCalls = 0; renderedTabs = []; },
  };
}

function attachAdvanceSelectedTab(gBrowser) {
  let nativeCalls = 0;
  const tc = gBrowser.tabContainer || (gBrowser.tabContainer = {});
  tc.advanceSelectedTab = function (aDir, aWrap) {
    nativeCalls++;
    const list = Array.from(gBrowser.visibleTabs || gBrowser.tabs || []);
    const idx = list.indexOf(gBrowser.selectedTab);
    if (idx < 0 || !list.length) return;
    let next = idx + (aDir >= 0 ? 1 : -1);
    if (next < 0 || next >= list.length) {
      if (!aWrap) return;
      next = (next + list.length) % list.length;
    }
    if (list[next]) gBrowser.selectedTab = list[next];
  };
  return { getNativeCalls: () => nativeCalls, resetNativeCalls: () => { nativeCalls = 0; } };
}

function makeSimpleTab(id, url = "https://example.com/", extra = {}) {
  const attrs = new Map(Object.entries(extra.attrs || {}));
  return {
    id,
    localName: "tab",
    isConnected: true,
    hidden: !!extra.hidden,
    closing: !!extra.closing,
    discarded: !!extra.discarded,
    linkedBrowser: { currentURI: { spec: url } },
    hasAttribute: (k) => attrs.has(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
  };
}

/* Minimal browser-integrations harness with real ZentralBrowserIntegrations.uc.js
 * + mock ctrlTab + advanceSelectedTab + WebExtension tabId tracking check. */
function createIntegrationsHarness(initialPrefs = {}) {
  const { El, Ev, document } = createDom();
  document.createXULElement = (tag) => document.createElement(tag);
  document.querySelector = (sel) => document.querySelectorAll(sel)[0] || null;
  if (!Object.getOwnPropertyDescriptor(El.prototype, "parentNode")) {
    Object.defineProperty(El.prototype, "parentNode", { configurable: true, get() { return this.parent; } });
  }
  if (!Object.getOwnPropertyDescriptor(El.prototype, "isConnected")) {
    Object.defineProperty(El.prototype, "isConnected", {
      configurable: true,
      get() {
        let cur = this;
        while (cur) {
          if (cur === document.documentElement) return true;
          cur = cur.parent;
        }
        return false;
      },
    });
  }
  if (!Object.getOwnPropertyDescriptor(El.prototype, "localName")) {
    Object.defineProperty(El.prototype, "localName", { configurable: true, get() { return this.tag; } });
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

  const prefs = new Map([
    ["zen.workspace.bgalazka.addon_tab_id_bridge", true],
    ["zen.workspace.bgalazka.show_addon_host_folder", false],
    ["zen.workspace.bgalazka.hide_addon_hosts_ctrl_tab", true],
    ...Object.entries(initialPrefs),
  ]);
  const Services = {
    prefs: {
      getBoolPref: (k, d = false) => (prefs.has(k) ? Boolean(prefs.get(k)) : d),
      getStringPref: (k, d = "") => (prefs.has(k) ? String(prefs.get(k)) : d),
      setBoolPref: (k, v) => prefs.set(k, Boolean(v)),
      addObserver() {},
      removeObserver() {},
    },
    scriptSecurityManager: { getSystemPrincipal: () => ({ isSystemPrincipal: true }) },
  };

  const tabpanelDeck = document.createElement("tabpanels");
  tabpanelDeck.id = "tabbrowser-tabpanels";
  document.body.append(tabpanelDeck);
  const pinnedContainer = document.createElement("vbox");
  pinnedContainer.id = "pinned-tabs-container";
  document.body.append(pinnedContainer);
  const tabsBox = document.createElement("tabs");
  tabsBox.id = "tabbrowser-tabs";
  document.body.append(tabsBox);

  const panelRoot = document.createElement("div");
  panelRoot.id = "zen-app-panel-root";
  const panelClip = document.createElement("div");
  panelClip.id = "zen-app-panel-clip";
  const panelSlider = document.createElement("div");
  panelSlider.id = "zen-app-panel-slider";
  panelClip.append(panelSlider);
  panelRoot.append(panelClip);
  document.body.append(panelRoot);

  const tabs = [];
  let selectedTab = null;
  let nextPanelId = 1;
  let nextWebExtTabId = 100;
  const tabIds = new WeakMap();

  const createNativeTab = (url = "https://example.com/") => {
    const tab = document.createElement("tab");
    const panelId = `panel-${nextPanelId++}`;
    tab.linkedPanel = panelId;
    const panel = document.createElement("vbox");
    panel.id = panelId;
    panel.classList.add("browserSidebarContainer");
    const container = document.createElement("box");
    container.classList.add("browserContainer");
    const stack = document.createElement("stack");
    stack.classList.add("browserStack");
    const browser = document.createElement("browser");
    browser.currentURI = { spec: url };
    browser.loadURI = () => {};
    browser.addProgressListener = () => {};
    browser.removeProgressListener = () => {};
    stack.append(browser);
    container.append(stack);
    panel.append(container);
    tabpanelDeck.append(panel);
    tab.linkedBrowser = browser;
    tabIds.set(tab, nextWebExtTabId++);
    tabsBox.append(tab);
    tabs.push(tab);
    if (window.ctrlTab) window.ctrlTab.recentlyUsedTabs.push(tab);
    return tab;
  };

  const tabContainer = tabsBox;
  Object.defineProperty(tabContainer, "selectedItem", {
    configurable: true,
    get: () => selectedTab,
    set: (v) => { selectedTab = v; },
  });
  Object.defineProperty(tabContainer, "selectedIndex", {
    configurable: true,
    get: () => tabs.indexOf(selectedTab),
    set: (i) => { selectedTab = tabs[i] || selectedTab; },
  });
  tabContainer.getItemAtIndex = (i) => tabs[i] || null;

  const gBrowser = {
    tabs,
    get visibleTabs() { return tabs.filter((t) => !t.hidden && !t.closing); },
    tabContainer,
    get selectedTab() { return selectedTab; },
    set selectedTab(v) { selectedTab = v; },
    get selectedBrowser() { return selectedTab?.linkedBrowser || null; },
    addTab: (url) => createNativeTab(url),
    pinTab(t) { t.pinned = true; t.setAttribute("pinned", "true"); },
    getBrowserContainer: (b) => b?.parentNode?.parentNode || null,
    getPanel: (b) => b?.parentNode?.parentNode?.parentNode || null,
    discardBrowser() { return true; },
    _endRemoveTab(t) {
      const i = tabs.indexOf(t);
      if (i >= 0) tabs.splice(i, 1);
      t.remove();
    },
    removeTab(t) { this._endRemoveTab(t); },
  };
  const advStats = attachAdvanceSelectedTab(gBrowser);

  const timers = [];
  const openedPanels = [];
  const window = {
    document,
    Services,
    gBrowser,
    Event: Ev,
    CustomEvent: Ev,
    gZenWorkspaces: { activeWorkspace: "ws-1", selectEmptyTab() {} },
    gZenFolders: {
      createFolder(seedTabs, opts = {}) {
        const folder = document.createElement("zen-folder");
        folder.isZenFolder = true;
        if (opts.id) folder.id = opts.id;
        folder.addTabs = (list) => list.forEach((t) => { folder.append(t); t.group = folder; });
        folder.addTabs(seedTabs || []);
        pinnedContainer.append(folder);
        return folder;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    requestAnimationFrame: (fn) => { timers.push(fn); return timers.length; },
    getComputedStyle: () => ({ display: "flex" }),
  };
  window.window = window;

  const ctrlMock = attachMockCtrlTab(window, gBrowser);

  // Create two initial real user tabs
  const tabA = createNativeTab("https://site-a.example/");
  const tabB = createNativeTab("https://site-b.example/");
  selectedTab = tabA;

  const appBrowsers = new Map();
  const apps = {
    getAppBrowser: (id) => appBrowsers.get(id) || null,
    getOrCreateAppBrowser(app) {
      let b = appBrowsers.get(app.id);
      if (b) return { browser: b, isNew: false };
      b = document.createXULElement("browser");
      panelSlider.append(b);
      appBrowsers.set(app.id, b);
      return { browser: b, isNew: true };
    },
    openPanel(app) { openedPanels.push(app?.id || ""); },
    closeApp(id) { appBrowsers.delete(id); },
  };
  window.Zentral = { Apps: apps };

  const parts = new Map();
  const ZentralRuntime = { registerPart: (name, fn) => parts.set(name, fn) };
  window.ZentralRuntime = ZentralRuntime;

  const sandbox = vm.createContext({
    window,
    document,
    gBrowser,
    Services,
    ZentralRuntime,
    console,
    Event: Ev,
    CustomEvent: Ev,
    Map, Set, WeakMap, WeakSet, Symbol, Object, Array, Promise, Error, Number, String, Boolean, Math, JSON,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
  });
  vm.runInContext(read("extension/panels/browsers/ZentralBrowserIntegrations.uc.js"), sandbox, {
    filename: "ZentralBrowserIntegrations.uc.js",
  });

  const cleanups = [];
  const ctx = {
    BGALAZKA_EXT_PREFS: {
      ADDON_TAB_ID_BRIDGE: "zen.workspace.bgalazka.addon_tab_id_bridge",
      SHOW_ADDON_HOST_FOLDER: "zen.workspace.bgalazka.show_addon_host_folder",
      HIDE_ADDON_HOSTS_CTRL_TAB: "zen.workspace.bgalazka.hide_addon_hosts_ctrl_tab",
    },
    essentialPanels: new Map(),
    getPref: (k, d) => (typeof d === "boolean" ? Services.prefs.getBoolPref(k, d) : Services.prefs.getStringPref(k, d)),
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    registerCleanup: (fn) => cleanups.push(fn),
    retryPanelTask() {},
    safeCall: (fn) => fn(),
    getAllAppBrowsers: () => [...appBrowsers.values()],
    reconcileFeaturePreferences() {},
    recreateLoadedPanels() {},
    saveEssentialSettings() {},
  };

  const gen = parts.get("browser-integrations")(ctx);
  gen.next();
  gen.next();

  const openAdoptedApp = (app) =>
    ctx.callGetOrCreateWithAddonHostBrowser(apps.getOrCreateAppBrowser.bind(apps), app, 0);

  return {
    window,
    document,
    gBrowser,
    Services,
    prefs,
    ctx,
    tabA,
    tabB,
    tabs,
    tabIds,
    ctrlMock,
    advStats,
    openedPanels,
    flushTimers: () => { while (timers.length) timers.shift()(); },
    openAdoptedApp,
    cleanup: () => cleanups.splice(0).reverse().forEach((fn) => fn()),
  };
}

async function run() {
  await test("1. Shared registry: MRU filtering, 1-tab guard, _tabList sanitization, pick guard, advanceSelectedTab & clean teardown", async () => {
    const h = createFakeZen();
    const { registerCtrlTabFilter, CTRL_TAB_FILTER_KEY } = h.window.__zentralNotesTestSeam.core;

    const t1 = makeSimpleTab("t1", "https://one.example/");
    const tNote = makeSimpleTab("note", "about:blank#zn-note:abc", { attrs: { "bgalazka-notes-item": "n:abc" } });
    const tHost = makeSimpleTab("host", "about:blank", { attrs: { "bgalazka-addon-host": "true" } });
    const t2 = makeSimpleTab("t2", "https://two.example/");
    const tEss = makeSimpleTab("ess", "https://ess.example/", { attrs: { "zen-essential": "true" } });

    const tabs = [t1, tNote, tHost, t2, tEss];
    const mockPrefMap = new Map();
    const gBrowser = {
      tabs,
      get visibleTabs() { return tabs; },
      selectedTab: t1,
      tabContainer: {},
    };
    const advStats = attachAdvanceSelectedTab(gBrowser);
    const win = {
      gBrowser,
      Services: { prefs: { getBoolPref: (k, d) => (mockPrefMap.has(k) ? mockPrefMap.get(k) : d) } },
    };
    const ctrlMock = attachMockCtrlTab(win, gBrowser);

    const origTabListGetter = Object.getOwnPropertyDescriptor(win.ctrlTab, "tabList").get;
    const origAdvance = gBrowser.tabContainer.advanceSelectedTab;

    let hideHost = true;
    const fNotes = registerCtrlTabFilter(win, "notes", (t) => t.hasAttribute("bgalazka-notes-item"));
    const fHosts = registerCtrlTabFilter(win, "hosts", (t) => hideHost && t.hasAttribute("bgalazka-addon-host"));

    assert.equal(win[CTRL_TAB_FILTER_KEY].filters.size, 2, "single shared controller holds both filters");
    assert.deepEqual(win.ctrlTab.tabList.map((t) => t.id), ["t1", "t2", "ess"], "tabList filters both Notes & host");

    // setupGUI builds _tabList directly from recentlyUsedTabs; updatePreviews still filters _tabList
    win.ctrlTab.setupGUI();
    assert.deepEqual(ctrlMock.stats().renderedTabs.map((t) => t.id), ["t1", "t2", "ess"], "setupGUI/updatePreviews never render hidden tabs");

    // pick refuses hidden tab & calls close()
    gBrowser.selectedTab = t1;
    win.ctrlTab.pick({ _tab: tNote });
    assert.equal(gBrowser.selectedTab, t1, "pick refuses hidden note tab");
    assert.ok(ctrlMock.stats().closeCalls >= 1, "pick closes menu on refused hidden tab");

    // advanceSelectedTab skips contiguous [tNote, tHost] cleanly forward & backward
    gBrowser.selectedTab = t1;
    gBrowser.tabContainer.advanceSelectedTab(1, true);
    assert.equal(gBrowser.selectedTab, t2, "forward skips Note & Host directly to t2");
    gBrowser.tabContainer.advanceSelectedTab(-1, true);
    assert.equal(gBrowser.selectedTab, t1, "backward skips Host & Note directly back to t1");

    // Adjacent normal tab delegates straight to native advanceSelectedTab
    advStats.resetNativeCalls();
    gBrowser.selectedTab = t2;
    gBrowser.tabContainer.advanceSelectedTab(1, true);
    assert.equal(gBrowser.selectedTab, tEss, "normal adjacent tab goes to tEss");
    assert.equal(advStats.getNativeCalls(), 1, "delegated cleanly to native advanceSelectedTab");

    // Respects zen.tabs.ctrl-tab.ignore-essential-tabs when stepping past hidden tabs
    mockPrefMap.set("zen.tabs.ctrl-tab.ignore-essential-tabs", true);
    gBrowser.selectedTab = t2;
    gBrowser.tabContainer.advanceSelectedTab(1, true);
    // Immediate next is tEss (not hidden by us -> native handles it); test skipping hidden + essential together:
    tabs.splice(0, tabs.length, t1, tNote, tEss, t2);
    gBrowser.selectedTab = t1;
    gBrowser.tabContainer.advanceSelectedTab(1, true);
    assert.equal(gBrowser.selectedTab, t2, "skips hidden note AND ignored essential to land on t2");

    // Only 1 real tab + hidden tabs -> ctrlTab.open() and start() bail out cleanly
    tabs.splice(0, tabs.length, t1, tNote, tHost);
    win.ctrlTab.recentlyUsedTabs.splice(0, win.ctrlTab.recentlyUsedTabs.length, t1, tNote, tHost);
    win.ctrlTab.close();
    ctrlMock.resetStats();
    win.ctrlTab.open();
    assert.equal(ctrlMock.stats().openCalls, 0, "open() does not fire when only hidden tabs accompany 1 real tab");
    win.ctrlTab.start();
    assert.equal(ctrlMock.stats().startCalls, 0, "start() does not fire when only hidden tabs accompany 1 real tab");

    // Toggle hideHost = false -> host immediately reappears, open() succeeds
    hideHost = false;
    assert.deepEqual(win.ctrlTab.tabList.map((t) => t.id), ["t1", "host"], "toggling host filter off restores host tab immediately");
    win.ctrlTab.open();
    assert.equal(ctrlMock.stats().openCalls, 1, "open() works once 2 eligible tabs exist");

    // Reference-counted disposal: removing first filter keeps wrapper active; removing last restores originals
    fNotes.dispose();
    assert.equal(win[CTRL_TAB_FILTER_KEY].filters.size, 1, "one filter remains active");
    fHosts.dispose();
    assert.equal(win[CTRL_TAB_FILTER_KEY], undefined, "registry removed when last filter disposes");
    assert.equal(Object.getOwnPropertyDescriptor(win.ctrlTab, "tabList").get, origTabListGetter, "ctrlTab.tabList getter restored");
    assert.equal(gBrowser.tabContainer.advanceSelectedTab, origAdvance, "advanceSelectedTab restored");

    h.destroy();
  });

  await test("2. Real ZentralNotes: hides Notes, Agenda events/reminders/more & seeds from Ctrl+Tab, prunes MRU, allows reused normal tabs", async () => {
    const h = createFakeZen({
      prefs: {
        "zen.workspace.zentral.notes.zen_folder": "all",
        "zen.workspace.zentral.notes.agenda_folder": true,
      },
    });
    await h.seam.ensureStore();
    const ctrlMock = attachMockCtrlTab(h.window, h.window.gBrowser);
    attachAdvanceSelectedTab(h.window.gBrowser);

    // Wire TabOpen -> ctrlTab.recentlyUsedTabs just like real Firefox browser-ctrlTab.js
    h.window.addEventListener("TabOpen", (ev) => {
      if (ev?.target && !ctrlMock.ctrlTab.recentlyUsedTabs.includes(ev.target)) {
        ctrlMock.ctrlTab.recentlyUsedTabs.push(ev.target);
      }
    });

    // Ensure registry binds to the newly attached ctrlTab + advanceSelectedTab
    const regKey = h.window.__zentralNotesTestSeam.core.CTRL_TAB_FILTER_KEY;
    assert.ok(h.window[regKey], "ZentralNotes registered its Ctrl+Tab filter on startup");
    h.window[regKey].ensureInstalled();

    const realA = h.window.gBrowser.addTab("https://real-a.example/");
    realA.setAttribute("label", "Real A");
    const realB = h.window.gBrowser.addTab("https://real-b.example/");
    realB.setAttribute("label", "Real B");
    h.window.gBrowser.selectedTab = realA;

    // Seed a note + a calendar event + a reminder so both Zen NOTES and Zen Agenda create pseudo-tabs
    const note = h.seam.store.create("Project Plan\n\nDetails here");
    const dayStart = C.dayStart(Date.now());
    const evStart = dayStart + 10 * 3600000;
    const evEnd = dayStart + 11 * 3600000;
    const remAt = dayStart + 12 * 3600000;
    h.seam.store.items.upsert(C.makeItem({
      id: "ev-ctrl-tab",
      summary: "Team Sync",
      start: { dateTime: new Date(evStart).toISOString() },
      end: { dateTime: new Date(evEnd).toISOString() },
      x: { kind: "event", src: "manual" },
    }, Date.now()));
    h.seam.store.items.upsert(C.makeItem({
      id: "rem-ctrl-tab",
      summary: "Send Invoice",
      start: { dateTime: new Date(remAt).toISOString() },
      x: { kind: "reminder", src: "manual" },
    }, Date.now()));

    h.fireTimer(6500);
    await h.seam.agendaController.runNow();
    if (h.seam.zenApi?.syncNow) await h.seam.zenApi.syncNow();
    else h.fireTimer(6500);
    await Promise.resolve();

    h.window.gBrowser.selectedTab = realA;
    const allTabs = h.window.gBrowser.tabs;
    const pseudoTabs = allTabs.filter((t) =>
      t.hasAttribute("bgalazka-notes-item") || t.hasAttribute("bgalazka-notes-agenda-item")
    );
    assert.ok(pseudoTabs.length >= 2, `expected Notes & Agenda pseudo-tabs in gBrowser.tabs, got ${pseudoTabs.length}`);

    // Even if Firefox pushed all tabs into recentlyUsedTabs, ctrlTab.tabList must show ONLY real tabs
    for (const p of pseudoTabs) {
      if (!ctrlMock.ctrlTab.recentlyUsedTabs.includes(p)) ctrlMock.ctrlTab.recentlyUsedTabs.push(p);
    }
    const visibleInCtrlTab = h.window.ctrlTab.tabList;
    assert.ok(visibleInCtrlTab.includes(realA), "Real A is visible in ctrlTab.tabList");
    assert.ok(visibleInCtrlTab.includes(realB), "Real B is visible in ctrlTab.tabList");
    for (const p of pseudoTabs) {
      assert.equal(visibleInCtrlTab.includes(p), false, `pseudo-tab ${p.getAttribute("label") || p.getAttribute("bgalazka-notes-item") || p.getAttribute("bgalazka-notes-agenda-item")} must NOT appear in ctrlTab.tabList`);
    }

    // ctrlTab.open() renders previews strictly for real tabs
    const previews = h.window.ctrlTab.open();
    assert.ok(previews.every((p) => !pseudoTabs.includes(p._tab)), "no Notes/Agenda preview card rendered");
    h.window.ctrlTab.close();

    // Sequential Ctrl+Tab (advanceSelectedTab) skips every Notes/Agenda pseudo-tab
    h.window.gBrowser.selectedTab = realA;
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      h.window.gBrowser.tabContainer.advanceSelectedTab(1, true);
      const cur = h.window.gBrowser.selectedTab;
      assert.equal(pseudoTabs.includes(cur), false, "advanceSelectedTab never lands on a Notes/Agenda pseudo-tab");
      seen.add(cur);
    }
    assert.ok(seen.has(realB) && seen.has(realA), "advanceSelectedTab cycles cleanly across real tabs");

    // Reused-tab safety: if a tab that had stale markers now loads a real URL, it IS shown again
    const reused = h.window.gBrowser.addTab("https://reused-real-site.example/");
    reused.setAttribute("label", "Reused Real Site");
    reused.setAttribute("bgalazka-notes-item", "n:" + note.id);
    reused.setAttribute("bgalazka-ephemeral-tab", "true");
    assert.ok(h.window.ctrlTab.tabList.includes(reused), "reused tab pointing to a real website is NOT falsely hidden");

    // Clean destroy removes filter
    h.destroy();
    assert.equal(h.window[regKey], undefined, "Notes destroy unregisters and tears down ctrlTab filter");
  });

  await test("3. Real ZentralBrowserIntegrations: hides webpanel host tabs by default, toggles live, and NEVER breaks fake addon host IDs", async () => {
    const h = createIntegrationsHarness();
    const discord = { id: "app-discord", name: "Discord", url: "https://discord.com/app" };
    const slack = { id: "app-slack", name: "Slack", url: "https://app.slack.com/" };

    const resDiscord = h.openAdoptedApp(discord);
    const resSlack = h.openAdoptedApp(slack);
    const bDiscord = resDiscord?.browser;
    const bSlack = resSlack?.browser;
    assert.ok(bDiscord && bSlack, "both adopted app browsers created");

    const hostDiscord = h.ctx.addonHostByAppId.get("app-discord")?.tab;
    const hostSlack = h.ctx.addonHostByAppId.get("app-slack")?.tab;
    assert.ok(hostDiscord && hostSlack, "both real addon host tabs exist");

    // PRIORITY INVARIANT: real Firefox host tabs & WebExtension tabIds are 100% untouched!
    assert.ok(h.gBrowser.tabs.includes(hostDiscord), "Discord host tab remains in gBrowser.tabs");
    assert.ok(h.gBrowser.tabs.includes(hostSlack), "Slack host tab remains in gBrowser.tabs");
    assert.equal(hostDiscord.linkedBrowser, bDiscord, "Discord host linkedBrowser stays attached");
    assert.equal(hostSlack.linkedBrowser, bSlack, "Slack host linkedBrowser stays attached");
    assert.equal(hostDiscord.getAttribute("bgalazka-addon-host"), "true", "Discord host marker preserved");
    assert.equal(hostDiscord._bgalazkaAddonAppId, "app-discord", "Discord appId binding preserved");
    assert.equal(h.ctx.addonHostByTab.get(hostDiscord).appId, "app-discord", "addonHostByTab mapping preserved");
    assert.ok(Number.isInteger(h.tabIds.get(hostDiscord)) && Number.isInteger(h.tabIds.get(hostSlack)), "distinct real tabIds preserved");
    assert.equal(!!hostDiscord.hidden, false, "host tab is NOT hidden via tab.hidden");

    // Default pref (hide_addon_hosts_ctrl_tab = true): hidden from Ctrl+Tab
    assert.deepEqual(
      h.window.ctrlTab.tabList,
      [h.tabA, h.tabB],
      "ctrlTab.tabList excludes webpanel host tabs when hide_addon_hosts_ctrl_tab is true",
    );
    const previewsHidden = h.window.ctrlTab.open();
    assert.deepEqual(previewsHidden.map((p) => p._tab), [h.tabA, h.tabB], "previews exclude host tabs");
    h.window.ctrlTab.close();

    // Sequential Ctrl+Tab skips host tabs and NEVER pops open a webpanel
    h.gBrowser.selectedTab = h.tabB;
    h.openedPanels.length = 0;
    h.gBrowser.tabContainer.advanceSelectedTab(1, true);
    h.flushTimers();
    assert.equal(h.gBrowser.selectedTab, h.tabA, "advanceSelectedTab wraps over host tabs back to tabA");
    assert.deepEqual(h.openedPanels, [], "skipping host tabs does NOT pop open webpanels");

    // Live toggle OFF (hide_addon_hosts_ctrl_tab = false): host tabs IMMEDIATELY appear in Ctrl+Tab
    h.Services.prefs.setBoolPref("zen.workspace.bgalazka.hide_addon_hosts_ctrl_tab", false);
    assert.deepEqual(
      h.window.ctrlTab.tabList,
      [h.tabA, h.tabB, hostDiscord, hostSlack],
      "turning pref OFF immediately shows webpanel host tabs in ctrlTab.tabList",
    );

    // Picking a host tab while pref is OFF safely opens its webpanel without leaving host tab selected
    h.openedPanels.length = 0;
    h.window.ctrlTab.pick({ _tab: hostDiscord });
    h.flushTimers();
    assert.notEqual(h.gBrowser.selectedTab, hostDiscord, "selection guard keeps safe normal tab selected");
    assert.deepEqual(h.openedPanels, ["app-discord"], "picking host tab opens Discord webpanel");

    // Live toggle back ON -> immediately hidden again, and real host tabs still intact
    h.Services.prefs.setBoolPref("zen.workspace.bgalazka.hide_addon_hosts_ctrl_tab", true);
    assert.deepEqual(h.window.ctrlTab.tabList, [h.tabA, h.tabB], "turning pref back ON hides host tabs immediately");
    assert.ok(h.gBrowser.tabs.includes(hostDiscord) && h.gBrowser.tabs.includes(hostSlack), "real host tabs remain intact after toggling");

    // Coexistence with Notes filter on the same window
    const regKey = Symbol.for("zentral/ctrl-tab-filter/v1");
    const state = h.window[regKey];
    assert.ok(state && state.filters.has("zentral-addon-hosts"), "shared registry has zentral-addon-hosts filter");
    const fakeNote = makeSimpleTab("note-coexist", "about:blank#zn-note:co1", { attrs: { "bgalazka-notes-item": "n:co1" } });
    h.window.ctrlTab.recentlyUsedTabs.push(fakeNote);
    state.filters.set("zentral-notes-pseudo-tabs", (t) => t.hasAttribute("bgalazka-notes-item"));

    // With webpanel hide OFF, Notes stays hidden while webpanel hosts appear
    h.Services.prefs.setBoolPref("zen.workspace.bgalazka.hide_addon_hosts_ctrl_tab", false);
    assert.deepEqual(
      h.window.ctrlTab.tabList,
      [h.tabA, h.tabB, hostDiscord, hostSlack],
      "Notes stays hidden while webpanel host tabs appear when host pref is false",
    );

    // Disposing Integrations keeps Notes filter alive; disposing Notes tears down registry cleanly
    h.cleanup();
    assert.ok(h.window[regKey] && h.window[regKey].filters.has("zentral-notes-pseudo-tabs"), "Notes filter survives Integrations cleanup");
    assert.equal(h.window[regKey].filters.has("zentral-addon-hosts"), false, "Integrations filter removed on cleanup");
    state.filters.delete("zentral-notes-pseudo-tabs");
    state.teardownIfEmpty();
    assert.equal(h.window[regKey], undefined, "registry torn down once last filter removed");
  });

  await test("4. Settings catalog, layout, recommended defaults & FeatureSettings UI wiring", async () => {
    const prefKey = "zen.workspace.bgalazka.hide_addon_hosts_ctrl_tab";
    const schemaJson = JSON.parse(read("extension/panels/browsers/settings.json"));
    const schemaEntry = schemaJson.schema.find((s) => s.property === prefKey);
    assert.ok(schemaEntry, "settings.json declares hide_addon_hosts_ctrl_tab");
    assert.equal(schemaEntry.type, "checkbox");
    assert.equal(schemaEntry.defaultValue, true);
    assert.equal(schemaJson.settings[prefKey]?.owner, "browser-integrations");
    assert.equal(schemaJson.settings[prefKey]?.category, "compatibility");

    const layoutJson = JSON.parse(read("extension/settings/layout.json"));
    assert.ok(layoutJson.order.includes(prefKey), "layout.json includes hide_addon_hosts_ctrl_tab");

    const recJson = JSON.parse(read("extension/settings/recommended.json"));
    assert.equal(recJson.prefs[prefKey], true, "recommended.json defaults hide_addon_hosts_ctrl_tab to true");

    const panelsSrc = read("extension/panels/ZentralPanels.uc.js");
    assert.ok(panelsSrc.includes(prefKey), "ZentralPanels.uc.js defines HIDE_ADDON_HOSTS_CTRL_TAB pref constant");

    const featureUiSrc = read("extension/settings/controllers/ZentralFeatureSettings.js");
    assert.ok(featureUiSrc.includes("HIDE_ADDON_HOSTS_CTRL_TAB"), "ZentralFeatureSettings.js renders toggle for HIDE_ADDON_HOSTS_CTRL_TAB");
  });

  console.log(`\nPASS ctrl-tab-filter (${passed} tests)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
