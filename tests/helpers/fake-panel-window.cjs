"use strict";
// Several browser windows of one application for the Notes start-up tests: every window runs the REAL
// additional/notes/ZentralNotes.uc.js (its own copy, like loadSubScript gives each window) against its own fake DOM,
// while the things an application shares are shared here too: the notes folder, the observer service, the preferences,
// CustomizableUI, the window list and (optionally) the global of the system modules or the hidden window.
// One virtual clock drives the timers of every window, so a test decides the order of events. Storage calls can be
// held back (a slow disk) or made to fail (a file another program is replacing).
// This does NOT prove real layout, real timing or Gecko behaviour.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const SOURCE = fs.readFileSync(path.join(__dirname, "../../additional/notes/ZentralNotes.uc.js"), "utf8");
const CALENDAR_SOURCE = fs.readFileSync(path.join(__dirname, "../../additional/notes/calendar/ZentralNotesCalendar.js"), "utf8");
const LANGUAGE_SOURCES = ["en", "pl"].map((code) => fs.readFileSync(path.join(__dirname, "../../additional/notes/i18n/" + code + ".js"), "utf8"));
const DIR = "/profile/zentral-notes";

function createPanelWorld({ sharedGlobal = null, hiddenWindow = null, freezeCui = true } = {}) {
  const disk = new Map(), prefs = new Map(), observers = new Set(), windows = [], writes = [], warnings = [];
  // ---- one clock for every window ----
  let now = 0, seq = 0;
  const timers = new Map();
  const setTimer = (fn, ms = 0) => { const id = ++seq; timers.set(id, { id, at: now + Math.max(0, Number(ms) || 0), fn }); return id; };
  const clearTimer = (id) => { timers.delete(id); };
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const flush = async () => { for (let i = 0; i < 4; i++) { for (const w of windows) w.raf.splice(0).forEach((f) => f()); await settle(); } };
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers.values()].filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      timers.delete(next.id); now = Math.max(now, next.at);
      next.fn();
      await flush();
    }
    now = end; await flush();
  }
  // ---- the shared disk: held back or failing on request ----
  const gates = new Set(), failures = [];
  // hold(match) keeps every matching call waiting until the returned function is called. match(op, path, windowId)
  const hold = (match = () => true) => { let release; const gate = { match, promise: new Promise((r) => (release = r)) }; gates.add(gate); return () => { gates.delete(gate); release(); }; };
  // failNext(match, times) makes the next matching calls reject, like a file that is locked for a moment.
  const failNext = (match, times = 1, message = "NS_ERROR_FILE_IS_LOCKED") => { const f = { match, times, message }; failures.push(f); return f; };
  async function gate(op, p, id) {
    for (const g of [...gates]) if (g.match(op, p, id)) await g.promise;
    const f = failures.find((x) => x.times > 0 && x.match(op, p, id));
    if (f) { f.times--; throw new Error(f.message + ": " + p); }
  }
  const direct = (d) => [...new Set([...disk.keys()].filter((k) => k.startsWith(d + "/")).map((k) => d + "/" + k.slice(d.length + 1).split("/")[0]))];
  const ioOps = [];
  const ioFor = (id, isDead = () => false) => {
    const run = (op, p, fn, extra = {}) => {
      const work = Promise.resolve().then(fn);
      ioOps.push({ op, path: p, window: id, at: now, ...extra });
      // A closed Firefox window runs no further promise step, while the I/O thread still completes
      // every IOUtils call already issued during `unload`.
      if (isDead()) { work.catch(() => {}); return new Promise(() => {}); }
      return work;
    };
    return {
      makeDirectory: (p) => run("makeDirectory", p, async () => { await gate("makeDirectory", p, id); }),
      setPermissions: (p) => run("setPermissions", p, async () => {}),
      readUTF8: (p) => run("read", p, async () => { await gate("read", p, id); if (!disk.has(p)) { const e = new Error("NotFoundError: " + p); e.name = "NotFoundError"; throw e; } return disk.get(p); }),
      writeUTF8: (p, text, opts = {}) => run("write", p, async () => {
        await gate("write", p, id);
        if (opts.mode === "create" && disk.has(p)) throw new Error("exists: " + p);
        if (opts.backupFile && disk.has(p)) disk.set(opts.backupFile, disk.get(p));
        disk.set(p, text); writes.push({ path: p, window: id, at: now });
      }),
      copy: (from, to) => run("copy", from, async () => {
        await gate("copy", from, id);
        if (!disk.has(from)) { const e = new Error("NotFoundError: " + from); e.name = "NotFoundError"; throw e; }
        disk.set(to, disk.get(from)); writes.push({ path: to, from, copy: true, window: id, at: now });
      }, { to }),
      write: (p, bytes) => run("writeBytes", p, async () => { disk.set(p, bytes); }),
      read: (p) => run("readBytes", p, async () => disk.get(p)),
      remove: (p, o = {}) => run("remove", p, async () => { await gate("remove", p, id); for (const k of [...disk.keys()]) if (k === p || (o.recursive && k.startsWith(p + "/"))) disk.delete(k); }),
      exists: (p) => run("exists", p, async () => { await gate("exists", p, id); return disk.has(p) || [...disk.keys()].some((k) => k.startsWith(p + "/")); }),
      getChildren: (d) => run("children", d, async () => { await gate("children", d, id); return direct(d); }),
      stat: (p) => run("stat", p, async () => ({ lastModified: 1, type: disk.has(p) ? "regular" : "directory", size: String(disk.get(p) ?? "").length })),
      move: (a, b) => run("move", a, async () => { for (const k of [...disk.keys()]) if (k === a || k.startsWith(a + "/")) { disk.set(b + k.slice(a.length), disk.get(k)); disk.delete(k); } }, { to: b }),
    };
  };
  // ---- CustomizableUI: one module object for the application, frozen like the real one ----
  const widgets = new Map(), cuiLog = [];
  const cui = {
    getWidget: (id) => ({ id, provider: widgets.has(id) ? "api" : null }),
    createWidget(def) { if (widgets.has(def.id)) throw new Error("widget exists: " + def.id); widgets.set(def.id, def); cuiLog.push("create"); },
    destroyWidget(id) { if (widgets.delete(id)) cuiLog.push("destroy"); },
    ensureWidgetPlacedInWindow(id, w) { cuiLog.push("place:" + (windows.find((x) => x.win === w)?.id || "?")); },
  };
  if (freezeCui) Object.freeze(cui);

  // `globals` replaces names the Notes script sees as globals (e.g. observers that are really told about changes,
  // tests/helpers/fake-triple-view.cjs); everything else keeps the stand-ins below.
  function openWindow({ id = "w" + (windows.length + 1), components = !!sharedGlobal, hidden = hiddenWindow, calendar = true, globals = {} } = {}) {
    const dom = require("./fake-dom.cjs")(), { El, Ev, document, raf } = dom;
    const prefObservers = [], listeners = [], mutationObservers = [], own = new Set();
    let registered = null, unloaded = false;
    const Services = {
      prefs: {
        getBoolPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), getStringPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), getIntPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d),
        addObserver: (_b, o) => prefObservers.push(o), removeObserver: (_b, o) => { const i = prefObservers.indexOf(o); if (i >= 0) prefObservers.splice(i, 1); },
      },
      obs: {
        addObserver(observer, topic) { const e = { observer, topic, id }; own.add(e); observers.add(e); },
        removeObserver(observer, topic) { for (const e of [...own]) if (e.observer === observer && e.topic === topic) { own.delete(e); observers.delete(e); } },
        notifyObservers(subject, topic, data) { for (const e of [...observers]) if (e.topic === topic) e.observer.observe(subject, topic, data); },
      },
      wm: { getEnumerator: () => windows.filter((w) => !w.closed).map((w) => w.win) },
      // Firefox keeps a hidden window on macOS only; everywhere else the getter throws.
      appShell: { get hiddenDOMWindow() { if (!hidden) throw new Error("NS_ERROR_FAILURE"); return hidden; } },
    };
    class FakeMO {
      constructor(cb) { this.cb = cb; this.targets = []; mutationObservers.push(this); }
      observe(target, options) { this.targets.push({ target, options }); }
      disconnect() { const i = mutationObservers.indexOf(this); if (i >= 0) mutationObservers.splice(i, 1); this.targets = []; }
    }
    class FakeRO { observe() {} disconnect() {} }
    El.prototype.showPopover = function () { this._pop = true; };
    El.prototype.hidePopover = function () { this._pop = false; };
    Object.defineProperty(El.prototype, "offsetParent", { get() { return this.parent; }, configurable: true });
    const win = {
      document, innerWidth: 1200, innerHeight: 800, __zentralNotesTestSeam: {},
      ZentralRuntime: { register: (def) => (registered = def), nativeSidebarSide: () => "left" },
      requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout: setTimer, clearTimeout: clearTimer,
      addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
      removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
    };
    win.window = win;
    const log = (...a) => warnings.push({ window: id, text: a.map((x) => (x instanceof Error ? x.message : String(x))).join(" ") });
    const context = {
      window: win, document, Event: Ev, console: { ...console, warn: log, error: log }, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set,
      setTimeout: setTimer, clearTimeout: clearTimer, MutationObserver: FakeMO, ResizeObserver: FakeRO, navigator: { platform: "Linux" },
      globalThis: { Services, CustomizableUI: cui }, ChromeUtils: { importESModule: () => ({ AppConstants: {} }) },
      PathUtils: { profileDir: "/profile", join: (...p) => p.join("/"), filename: (p) => p.split("/").pop() }, IOUtils: ioFor(id, () => unloaded),
      // What privileged scripts see: Components.utils.getGlobalForObject(module) is the one global all system modules share.
      ...(components ? { Components: { utils: { getGlobalForObject: () => sharedGlobal } } } : {}),
      ...globals,
    };
    vm.createContext(context);
    if (calendar) {
      // A real window loads its own copy of the calendar part (its own module-level state), never a shared one.
      context.module = { exports: {} };
      for (const source of LANGUAGE_SOURCES) vm.runInContext(source, context);
      vm.runInContext(CALENDAR_SOURCE, context);
      win.__zentralNotesParts = { "notes-calendar": context.module.exports };
      delete context.module;
    }
    vm.runInContext(SOURCE, context);
    const html = document.documentElement;
    const w = {
      id, win, dom, El, Ev, document, html, raf, listeners, prefObservers, mutationObservers, closed: false,
      get registered() { return registered; },
      get seam() { return win.__zentralNotesTestSeam.sidebar; },
      core: win.__zentralNotesTestSeam.core,
      start() { w.stop = registered.init(); return w.stop; },
      async close() { if (w.closed) return; w.closed = true; await w.stop?.(); },
      // Simulates closing a real Firefox window: `unload` listeners run synchronously, every IOUtils call
      // already issued during `unload` completes on the I/O thread, and NO promise continuation runs in this window.
      unload() {
        if (w.closed) return;
        unloaded = true;
        w.closed = true;
        for (const l of listeners.filter((x) => x.type === "unload")) l.fn();
      },
      // Tell the observers that watch `target` what changed (the fake DOM does not do it by itself).
      mutate(target, records = [{ type: "childList", addedNodes: [], removedNodes: [] }]) { for (const mo of mutationObservers.slice()) if (mo.targets.some((x) => x.target === target)) mo.cb(records); },
      observes: (target) => mutationObservers.some((mo) => mo.targets.some((x) => x.target === target)),
      sheets: () => html.all().filter((e) => e._classes.has("zentral-notes-sheet")),
      openSheets: () => html.all().filter((e) => e._classes.has("zentral-notes-sheet") && !e.hidden),
      isNotesButton: (e) => !!e && e._classes.has("zentral-notes-btn"),
      // The panel suite: its root is a child of <html>; the slider holds the URL bar and the pages.
      buildPanel({ open = true, announce = false } = {}) {
        const root = new El("div"); root.id = "zen-app-panel-root"; if (open) root.setAttribute("open", "");
        const slider = new El("div"); slider.id = "zen-app-panel-slider";
        const toolbar = new El("div"); toolbar.id = "zen-app-panel-toolbar"; toolbar.append(new El("button"), new El("input"));
        const page = new El("browser");
        slider.append(toolbar, page); root.append(slider); html.append(root);
        if (announce) w.mutate(html, [{ type: "childList", addedNodes: [root], removedNodes: [] }]);
        return { root, slider, toolbar, page };
      },
      openPanel(panel) { panel.root.setAttribute("open", ""); w.mutate(panel.root, [{ type: "attributes", attributeName: "open", addedNodes: [], removedNodes: [] }]); },
      // Triple View: a second page, the divider and the bar of the second panel are added to the slider in one step.
      buildTriple(panel, { announce = true } = {}) {
        const lower = new El("browser"), divider = new El("div"); divider.className = "bgalazka-triple-divider";
        const box = new El("div"), bar = new El("div"); bar.className = "bgalazka-super-bar"; bar.append(new El("button")); box.append(bar);
        panel.page.setAttribute("data-bgalazka-triple-slot", "top"); lower.setAttribute("data-bgalazka-triple-slot", "bottom");
        panel.slider.append(lower, divider, box);
        html.setAttribute("bgalazka-triple-view", "true");
        if (announce) w.mutate(panel.slider, [{ type: "childList", addedNodes: [lower, divider, box], removedNodes: [] }]);
        return { lower, divider, box, bar };
      },
      // The panel's own autohide slides the panel away (its bars stay in the document).
      hidePanel(hidden = true) {
        html.setAttribute("bgalazka-hover-panel-enabled", "true");
        if (hidden) html.setAttribute("bgalazka-hover-panel-hidden", "true"); else html.removeAttribute("bgalazka-hover-panel-hidden");
        w.mutate(html, [{ type: "attributes", attributeName: "bgalazka-hover-panel-hidden", addedNodes: [], removedNodes: [] }]);
      },
    };
    windows.push(w);
    return w;
  }
  const meta = () => (disk.has(DIR + "/meta.json") ? JSON.parse(disk.get(DIR + "/meta.json")) : null);
  const noteFiles = () => [...disk.keys()].filter((k) => k.startsWith(DIR + "/") && k.endsWith(".md") && !k.slice(DIR.length + 1).includes("/"));
  // The topics a window listens to through Services.obs (one entry per registration).
  const observerTopics = (id) => [...observers].filter((e) => e.id === id).map((e) => e.topic);
  return { DIR, disk, prefs, windows, writes, ioOps, warnings, widgets, cui, cuiLog, timers, openWindow, advance, flush, settle, hold, failNext, meta, noteFiles, observerTopics, get now() { return now; } };
}
// A note file as Notes writes it.
const noteText = (title, { folder = "", body = "", updated = "2026-11-01T10:00:00.000Z" } = {}) =>
  `---\ncreated: 2026-11-01T10:00:00.000Z\nupdated: ${updated}\n${folder ? "folder: " + folder + "\n" : ""}---\n# ${title}\n${body || "text of " + title}\n`;
module.exports = { createPanelWorld, noteText, DIR };
