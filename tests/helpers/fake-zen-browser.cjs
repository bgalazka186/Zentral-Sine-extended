"use strict";
// A deliberately small Zen host for exercising the real Notes sidebar adapter.
// The DOM shape is shared with fake-dom's Zen dump; all tabs/folders remain
// observable and structural operations are logged, including native API calls.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const Calendar = require("../../additional/notes/calendar/ZentralNotesCalendar.js");
const source = fs.readFileSync(path.join(__dirname, "../../additional/notes/ZentralNotes.uc.js"), "utf8");

function createFakeZen({ prefs = {}, files = new Map(), id = "one", deleteEmptyFolders = false } = {}) {
  const dom = require("./fake-dom.cjs")(), { El, Ev, document } = dom;
  document.querySelector = (selector) => document.querySelectorAll(selector)[0] || null;
  document.createXULElement = (tag) => document.createElement(tag);
  const operations = [], events = [], listeners = new Map(), timers = new Map();
  let timerId = 0, tabId = 0, definition, clockOffset = 0;
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [Date.now() + clockOffset])); }
    static now() { return Date.now() + clockOffset; }
  }
  const record = (node, parent) => {
    if (!node || !["tab", "zen-folder"].includes(node.localName)) return;
    operations.push({ type: node.parentElement ? "move" : "add", node, from: node.parentElement, parent });
  };
  const append = El.prototype.append, insertBefore = El.prototype.insertBefore, remove = El.prototype.remove;
  El.prototype.append = function (...nodes) { for (const node of nodes) record(node, this); return append.apply(this, nodes); };
  El.prototype.insertBefore = function (node, before) { record(node, this); return insertBefore.call(this, node, before); };
  El.prototype.remove = function () { if (["tab", "zen-folder"].includes(this.localName) && this.parentElement) operations.push({ type: "remove", node: this, from: this.parentElement }); return remove.call(this); };
  const sidebar = dom.zenSidebar();
  const workspaces = new Map([[sidebar.ws.id, { element: sidebar.ws, pinnedTabsContainer: sidebar.pinned }]]), workspaceListeners = new Set();
  function addWorkspace(id) {
    const element = document.createElement("zen-workspace"), pinnedTabsContainer = document.createElement("vbox");
    element.id = id; pinnedTabsContainer.className = "zen-workspace-tabs-section zen-workspace-pinned-tabs-section";
    pinnedTabsContainer.setAttribute("zen-workspace-id", id); element.append(pinnedTabsContainer); document.body.append(element);
    workspaces.set(id, { element, pinnedTabsContainer }); return workspaces.get(id);
  }
  const emit = (type, target, extra = {}) => {
    const event = new Ev(type, { target, bubbles: true, ...extra });
    event.stopImmediatePropagation = () => { event.stopped = true; event.immediateStopped = true; };
    events.push(event);
    for (const listener of [...(listeners.get(type) || [])]) { listener(event); if (event.immediateStopped) break; }
    return event;
  };
  const win = {
    document, __zentralNotesParts: { "notes-calendar": Calendar }, __zentralNotesTestSeam: {},
    ZentralRuntime: { register(value) { definition = value; } },
    gZenWorkspaces: {
      activeWorkspace: sidebar.ws.id,
      workspaceElement(id) { return workspaces.get(id) || null; },
      addChangeListeners(fn) { workspaceListeners.add(fn); },
      removeChangeListeners(fn) { workspaceListeners.delete(fn); },
    }, innerWidth: 1200, innerHeight: 800,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, requestAnimationFrame(fn) { return this.setTimeout(fn, 16); }, cancelAnimationFrame(id) { this.clearTimeout(id); },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }, dispatchEvent(event) { return emit(event.type, event.target || win, event); },
  };
  win.window = win;
  win.gBrowser = {
    get tabs() { return document.querySelectorAll("tab"); }, selectedTab: null,
    addTab(url) { const tab = sidebar.tab(url); tab.id = `fake-${id}-${++tabId}`; tab.linkedBrowser = { currentURI: { spec: url } }; const ws = win.gZenWorkspaces.activeWorkspace; tab.setAttribute("zen-workspace-id", ws); (workspaces.get(ws)?.pinnedTabsContainer || sidebar.pinned).append(tab); return tab; },
    pinTab(tab) { tab.pinned = true; tab.setAttribute("pinned", "true"); emit("TabPinned", tab); },
    removeTab(tab) {
      const folder = tab.closest("zen-folder");
      emit("TabClose", tab); tab.remove();
      if (deleteEmptyFolders && folder && !folder.querySelector("tab")) folder.delete();
    },
    moveTabToExistingGroup(tab, folder) { folder.addTabs([tab]); emit("TabMove", tab); },
    moveTabBefore(tab, before) { before.parentElement?.insertBefore(tab, before); emit("TabMove", tab); },
  };
  win.gZenFolders = { createFolder(tabs, opts) {
    const seed = tabs[0], parent = seed.parentElement || sidebar.pinned;
    const folder = sidebar.folder(opts.label, { id: opts.id, parent });
    if (opts.workspaceId) folder.setAttribute("zen-workspace-id", opts.workspaceId);
    folder.childrenContainer = folder.querySelector(":scope > .tab-group-container");
    folder.addTabs = (nodes) => { for (const node of nodes) { folder.childrenContainer.append(node); if (node.localName === "tab") emit("TabMove", node); } };
    folder.addFolder = (node) => folder.childrenContainer.append(node);
    folder.addTabs(tabs);
    return folder;
  } };
  const values = new Map(Object.entries(prefs)), prefObservers = new Map();
  const setPref = (key, value) => { values.set(key, value); for (const [prefix, observers] of prefObservers) if (key.startsWith(prefix)) for (const observer of observers) observer.observe(null, "nsPref:changed", key); };
  const prefApi = {
    getBoolPref: (key, def) => values.has(key) ? !!values.get(key) : def,
    getIntPref: (key, def) => values.has(key) ? Number(values.get(key)) : def,
    getStringPref: (key, def) => values.has(key) ? String(values.get(key)) : def,
    setBoolPref: setPref, setIntPref: setPref, setStringPref: setPref,
    addObserver(prefix, observer) { if (!prefObservers.has(prefix)) prefObservers.set(prefix, new Set()); prefObservers.get(prefix).add(observer); },
    removeObserver(prefix, observer) { prefObservers.get(prefix)?.delete(observer); },
  };
  const observers = new Map();
  const obs = {
    addObserver(observer, topic) { if (!observers.has(topic)) observers.set(topic, new Set()); observers.get(topic).add(observer); },
    removeObserver(observer, topic) { observers.get(topic)?.delete(observer); },
    notifyObservers(subject, topic, data) { for (const observer of [...(observers.get(topic) || [])]) observer.observe(subject, topic, data); },
  };
  const Services = { prefs: prefApi, obs, sound: { beep() {} }, scriptSecurityManager: { getSystemPrincipal: () => ({}) }, wm: { getEnumerator: () => [] } };
  const IOUtils = {
    makeDirectory: async () => {}, setPermissions: async () => {}, exists: async (p) => files.has(p),
    readUTF8: async (p) => { if (!files.has(p)) { const e = new Error("not found"); e.code = "ENOENT"; throw e; } return files.get(p); },
    writeUTF8: async (p, data) => { files.set(p, data); }, getChildren: async (p) => [...files.keys()].filter((entry) => entry.startsWith(p + "/")),
    stat: async () => ({ lastModified: Date.now() }), remove: async (p) => files.delete(p),
  };
  const PathUtils = { profileDir: "/profile", tempDir: "/tmp", join: (...parts) => parts.join("/"), filename: (p) => p.split("/").pop() };
  const mutationObservers = new Set();
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { mutationObservers.add(this); }
    disconnect() { mutationObservers.delete(this); }
  }
  class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
  vm.runInNewContext(source, { window: win, document, globalThis: { Services }, ChromeUtils: { importESModule: () => ({}) }, PathUtils, IOUtils, MutationObserver, ResizeObserver, Event: Ev,
    navigator: { platform: "Linux" }, console, URL, Date: FakeDate, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap, setTimeout, clearTimeout, queueMicrotask });
  if (!definition?.init) throw new Error("Notes registration missing");
  const destroy = definition.init();
  return { ...dom, window: win, sidebar, operations, events, timers, values, files, observers, obs, emit, destroy,
    addWorkspace, workspaceListenerCount: () => workspaceListeners.size,
    async switchWorkspace(id) { if (!workspaces.has(id)) throw new Error("missing workspace"); win.gZenWorkspaces.activeWorkspace = id; for (const listener of [...workspaceListeners]) await listener({ workspace: { uuid: id }, onInit: false }); },
    advanceClock(ms) { clockOffset += Number(ms) || 0; },
    triggerMutations() { for (const observer of [...mutationObservers]) observer.callback([]); },
    setPref, resetOperations() { operations.length = 0; },
    fireTimer(ms) {
      // This harness can fire the boot timer out of chronological order. The
      // shared timer may then be overdue (0ms) instead of its 250ms debounce.
      const found = [...timers].find(([, timer]) => Math.abs(timer.ms - ms) <= 10) || (ms === 250 ? [...timers].find(([, timer]) => timer.ms === 0) : null);
      if (!found) return false;
      timers.delete(found[0]); clockOffset += Math.max(0, Number(ms) || 0) + 10; found[1].fn(); return true;
    },
    get seam() { return win.__zentralNotesTestSeam.sidebar; } };
}
module.exports = { createFakeZen };
