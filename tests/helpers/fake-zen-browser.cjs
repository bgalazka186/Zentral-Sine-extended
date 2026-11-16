"use strict";
// A deliberately small Zen host for exercising the real Notes sidebar adapter.
// The DOM shape is shared with fake-dom's Zen dump; all tabs/folders remain
// observable and structural operations are logged, including native API calls.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const Calendar = require("../../additional/notes/calendar/ZentralNotesCalendar.js");
const source = fs.readFileSync(path.join(__dirname, "../../additional/notes/ZentralNotes.uc.js"), "utf8");
const runtimeSource = fs.readFileSync(path.join(__dirname, "../../loader/ZentralRuntime.js"), "utf8");

function loadRuntimeHoverCard(ctx) {
  const marker = "function createSidebarHoverCard(";
  const start = runtimeSource.indexOf(marker);
  if (start < 0) return null;
  let i = runtimeSource.indexOf("{", runtimeSource.indexOf(")", start)), depth = 0;
  for (; i < runtimeSource.length; i++) {
    const c = runtimeSource[i], n = runtimeSource[i + 1];
    if (c === "/" && n === "/") i = runtimeSource.indexOf("\n", i);
    else if (c === "/" && n === "*") i = runtimeSource.indexOf("*/", i) + 1;
    else if (c === '"' || c === "'" || c === "`") { for (i++; runtimeSource[i] !== c; i++) if (runtimeSource[i] === "\\") i++; }
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) break;
  }
  if (depth !== 0) return null;
  return vm.runInNewContext("(" + runtimeSource.slice(start, i + 1) + ")", ctx);
}

function createFakeZen({ prefs = {}, files = new Map(), id = "one", deleteEmptyFolders = false, calendar = Calendar, hiddenDOMWindow = null, sharedObs = null, workspaceName = "Default" } = {}) {
  const dom = require("./fake-dom.cjs")(), { El, Ev, document } = dom;
  document.querySelector = (selector) => document.querySelectorAll(selector)[0] || null;
  document.createXULElement = (tag) => document.createElement(tag);
  const operations = [], events = [], listeners = new Map(), timers = new Map();
  let timerId = 0, tabId = 0, definition, clockOffset = 0;
  // The clock of the fake window is virtual: it starts at the real time and moves only when a test fires a timer or
  // calls advanceClock. With the real clock running underneath, a delay computed as "due - now" depended on how busy
  // the machine was: a debounce re-armed 30 ms later asked for 220 ms instead of 250, fireTimer(250) no longer found
  // it, and a test failed only when the whole suite ran in parallel.
  const clockBase = Date.now();
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clockBase + clockOffset])); }
    static now() { return clockBase + clockOffset; }
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
  const workspaces = new Map([[sidebar.ws.id, { uuid: sidebar.ws.id, name: workspaceName, icon: "", element: sidebar.ws, pinnedTabsContainer: sidebar.pinned }]]), workspaceListeners = new Set();
  function addWorkspace(id, opts = {}) {
    const element = document.createElement("zen-workspace"), pinnedTabsContainer = document.createElement("vbox");
    element.id = id; pinnedTabsContainer.className = "zen-workspace-tabs-section zen-workspace-pinned-tabs-section";
    pinnedTabsContainer.setAttribute("zen-workspace-id", id); element.append(pinnedTabsContainer); document.body.append(element);
    workspaces.set(id, { uuid: id, name: opts.name || id, icon: opts.icon || "", element, pinnedTabsContainer }); return workspaces.get(id);
  }
  function renameWorkspace(id, name) {
    const entry = workspaces.get(id);
    if (!entry) throw new Error("missing workspace");
    entry.name = String(name || "");
    return entry;
  }
  function removeWorkspace(id) {
    const entry = workspaces.get(id);
    if (!entry) return false;
    entry.element?.remove?.();
    workspaces.delete(id);
    return true;
  }
  const emit = (type, target, extra = {}) => {
    const event = new Ev(type, { target, bubbles: true, ...extra });
    event.stopImmediatePropagation = () => { event.stopped = true; event.immediateStopped = true; };
    events.push(event);
    for (const listener of [...(listeners.get(type) || [])]) { listener(event); if (event.immediateStopped) break; }
    return event;
  };
  const win = {
    document, __zentralNotesParts: { "notes-calendar": calendar }, __zentralNotesTestSeam: {},
    ZentralRuntime: { register(value) { definition = value; } },
    gZenWorkspaces: {
      activeWorkspace: sidebar.ws.id,
      workspaceElement(id) { return workspaces.get(id) || null; },
      getWorkspaces() { return [...workspaces.values()].map(({ uuid, name, icon }) => ({ uuid, name, icon })); },
      getActiveWorkspace() { const w = workspaces.get(this.activeWorkspace); return w ? { uuid: w.uuid, name: w.name, icon: w.icon } : null; },
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
    addTab(url, options = {}) { const tab = sidebar.tab(url); tab.id = `fake-${id}-${++tabId}`; tab.linkedBrowser = { currentURI: { spec: url } }; const ws = win.gZenWorkspaces.activeWorkspace; tab.setAttribute("zen-workspace-id", ws); (workspaces.get(ws)?.pinnedTabsContainer || sidebar.pinned).append(tab); if (!options.deferTabOpen) emit("TabOpen", tab); return tab; },
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
  const obs = sharedObs || {
    addObserver(observer, topic) { if (!observers.has(topic)) observers.set(topic, new Set()); observers.get(topic).add(observer); },
    removeObserver(observer, topic) { observers.get(topic)?.delete(observer); },
    notifyObservers(subject, topic, data) { for (const observer of [...(observers.get(topic) || [])]) observer.observe(subject, topic, data); },
  };
  const Services = { prefs: prefApi, obs, sound: { beep() {} }, scriptSecurityManager: { getSystemPrincipal: () => ({}) }, wm: { getEnumerator: () => [] }, ...(hiddenDOMWindow ? { appShell: { hiddenDOMWindow } } : {}) };
  const isDirPath = (p) => [...files.keys()].some((k) => k.startsWith(p + "/"));
  const IOUtils = {
    makeDirectory: async () => {}, setPermissions: async () => {}, exists: async (p) => files.has(p) || isDirPath(p),
    readUTF8: async (p) => { if (!files.has(p)) { const e = new Error("not found"); e.code = "ENOENT"; throw e; } return String(files.get(p)); },
    writeUTF8: async (p, data) => { files.set(p, String(data)); },
    read: async (p) => { if (!files.has(p)) { const e = new Error("not found"); e.code = "ENOENT"; throw e; } const v = files.get(p); return v instanceof Uint8Array ? new Uint8Array(v) : Buffer.from(String(v)); },
    write: async (p, bytes) => { files.set(p, bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes)); },
    copy: async (from, to) => { if (!files.has(from)) { const e = new Error("not found"); e.code = "ENOENT"; throw e; } const v = files.get(from); files.set(to, v instanceof Uint8Array ? new Uint8Array(v) : String(v)); },
    getChildren: async (p) => [...new Set([...files.keys()].filter((entry) => entry.startsWith(p + "/")).map((entry) => p + "/" + entry.slice(p.length + 1).split("/")[0]))],
    stat: async (p) => {
      if (files.has(p)) { const v = files.get(p); return { type: "regular", size: v instanceof Uint8Array ? v.byteLength : Buffer.byteLength(String(v)), lastModified: FakeDate.now() }; }
      if (isDirPath(p)) return { type: "directory", size: 0, lastModified: FakeDate.now() };
      const e = new Error("not found"); e.code = "ENOENT"; throw e;
    },
    remove: async (p, opts) => {
      if (opts?.recursive) {
        files.delete(p);
        for (const k of [...files.keys()]) if (k.startsWith(p + "/")) files.delete(k);
        return true;
      }
      return files.delete(p);
    },
  };
  const PathUtils = { profileDir: "/profile", tempDir: "/tmp", join: (...parts) => parts.join("/"), filename: (p) => p.split("/").pop() };
  const mutationObservers = new Set();
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.target = null; this.options = null; }
    observe(target, options) { this.target = target; this.options = options || null; mutationObservers.add(this); }
    disconnect() { this.target = null; this.options = null; mutationObservers.delete(this); }
  }
  class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
  const vmGlobals = { window: win, document, globalThis: { Services }, ChromeUtils: { importESModule: () => ({}) }, PathUtils, IOUtils, MutationObserver, ResizeObserver, Event: Ev, Uint8Array,
    navigator: { platform: "Linux" }, console, URL, Date: FakeDate, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap, setTimeout, clearTimeout, queueMicrotask };
  const ctx = vm.createContext(vmGlobals);
  const sharedHoverCard = loadRuntimeHoverCard(ctx);
  if (sharedHoverCard) win.ZentralRuntime.createSidebarHoverCard = sharedHoverCard;
  vm.runInContext(source, ctx);
  if (!definition?.init) throw new Error("Notes registration missing");
  const destroy = definition.init();
  return { ...dom, window: win, sidebar, operations, events, timers, values, files, observers, obs, emit, destroy,
    addWorkspace, renameWorkspace, removeWorkspace, workspaceListenerCount: () => workspaceListeners.size,
    activeObservers: () => [...mutationObservers].map((o) => ({ target: o.target, options: o.options })),
    listenerCount: (type) => listeners.get(type)?.size || 0, // window listeners of one event type (idle-cost checks)
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
