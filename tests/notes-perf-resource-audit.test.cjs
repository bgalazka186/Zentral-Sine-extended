"use strict";

// T4.2: Performance audit & active timer/listener/observer registry verification,
// including rapid date-note switching baseline check and zero leaks on panel close/destroy.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createFakeDom = require("./helpers/fake-dom.cjs");

const ROOT = path.resolve(__dirname, "..");
const FLAVORS_MOD = require(path.join(ROOT, "additional", "notes", "flavors", "ZentralNotesFlavors.js"));
const CAL_MOD = require(path.join(ROOT, "additional", "notes", "calendar", "ZentralNotesCalendar.js"));
const NOTES_SRC = fs.readFileSync(path.join(ROOT, "additional", "notes", "ZentralNotes.uc.js"), "utf8");
const CAL_SRC = fs.readFileSync(path.join(ROOT, "additional", "notes", "calendar", "ZentralNotesCalendar.js"), "utf8");

function loadInstrumentedNotes() {
  const dom = createFakeDom();
  const { Ev, El, document, raf } = dom;

  const winListeners = new Map();
  const docListeners = new Map();
  const activeTimers = new Set();
  const activeRafs = new Set();
  const activeObservers = new Set();
  let nextTimerId = 1, nextRafId = 1;

  const trackAdd = (map, type, fn, opts) => {
    const cap = typeof opts === "boolean" ? opts : !!opts?.capture;
    const k = `${type}|${cap}`;
    let set = map.get(k);
    if (!set) { set = new Set(); map.set(k, set); }
    set.add(fn);
  };
  const trackRem = (map, type, fn, opts) => {
    const cap = typeof opts === "boolean" ? opts : !!opts?.capture;
    const k = `${type}|${cap}`;
    const set = map.get(k);
    if (set) { set.delete(fn); if (!set.size) map.delete(k); }
  };
  const countMap = (map) => { let n = 0; for (const s of map.values()) n += s.size; return n; };

  const origDocAdd = document.addEventListener?.bind(document);
  const origDocRem = document.removeEventListener?.bind(document);
  document.addEventListener = (type, fn, opts) => { trackAdd(docListeners, type, fn, opts); origDocAdd?.(type, fn, opts); };
  document.removeEventListener = (type, fn, opts) => { trackRem(docListeners, type, fn, opts); origDocRem?.(type, fn, opts); };

  class TrackedResizeObserver {
    constructor(cb) { this.cb = cb; this.connected = false; }
    observe() { this.connected = true; activeObservers.add(this); }
    unobserve() {}
    disconnect() { this.connected = false; activeObservers.delete(this); }
  }
  class TrackedMutationObserver {
    constructor(cb) { this.cb = cb; this.connected = false; }
    observe() { this.connected = true; activeObservers.add(this); }
    disconnect() { this.connected = false; activeObservers.delete(this); }
    takeRecords() { return []; }
  }

  const fakeSetTimeout = (fn, ms) => {
    const id = nextTimerId++;
    activeTimers.add(id);
    const real = setTimeout(() => { activeTimers.delete(id); fn(); }, Math.min(Math.max(0, Number(ms) || 0), 50));
    fakeSetTimeout._real.set(id, real);
    return id;
  };
  fakeSetTimeout._real = new Map();
  const fakeClearTimeout = (id) => {
    activeTimers.delete(id);
    const real = fakeSetTimeout._real.get(id);
    if (real) { clearTimeout(real); fakeSetTimeout._real.delete(id); }
  };

  const fakeRaf = (fn) => {
    const id = nextRafId++;
    activeRafs.add(id);
    raf.push(() => { if (!activeRafs.has(id)) return; activeRafs.delete(id); fn(); });
    return id;
  };
  const fakeCancelRaf = (id) => { activeRafs.delete(id); };

  const win = {
    document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    __zentralNotesParts: { "notes-calendar": CAL_MOD, "notes-flavors": FLAVORS_MOD },
    requestAnimationFrame: fakeRaf,
    cancelAnimationFrame: fakeCancelRaf,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    ResizeObserver: TrackedResizeObserver,
    MutationObserver: TrackedMutationObserver,
    innerWidth: 1200,
    innerHeight: 900,
    addEventListener(type, fn, opts) { trackAdd(winListeners, type, fn, opts); },
    removeEventListener(type, fn, opts) { trackRem(winListeners, type, fn, opts); },
  };
  win.window = win;

  vm.runInNewContext(NOTES_SRC, {
    window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
    ResizeObserver: TrackedResizeObserver, MutationObserver: TrackedMutationObserver,
    console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set,
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    navigator: { platform: "Linux" }, Uint8Array, TextEncoder, TextDecoder, queueMicrotask,
  });

  const metrics = () => ({
    winListeners: countMap(winListeners),
    docListeners: countMap(docListeners),
    timers: activeTimers.size,
    rafs: activeRafs.size,
    observers: activeObservers.size,
  });

  return {
    core: win.__zentralNotesTestSeam.core,
    dom, win, document, Ev, El, raf, metrics,
    cleanupRealTimers() { for (const r of fakeSetTimeout._real.values()) clearTimeout(r); fakeSetTimeout._real.clear(); },
  };
}

function createMemoryStore(core) {
  const files = new Map();
  const dirs = new Set(["/n", "/n/assets", "/n/backup"]);
  const join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
  const parentOf = (p) => { const i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : "/"; };
  const io = {
    join,
    filename: (p) => p.split("/").pop(),
    exists: async (p) => dirs.has(p) || files.has(p),
    makeDir: async (p) => { let cur = ""; for (const s of p.split("/").filter(Boolean)) { cur += "/" + s; dirs.add(cur); } },
    children: async () => [],
    stat: async (p) => {
      if (dirs.has(p)) return { type: "directory", size: 0, lastModified: Date.now() };
      if (files.has(p)) return { type: "regular", size: files.get(p).length, lastModified: Date.now() };
      throw new Error("ENOENT: " + p);
    },
    read: async (p) => files.get(p),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); },
    write: async (p, text) => { dirs.add(parentOf(p)); files.set(p, String(text)); },
    writeUTF8: async (p, text) => { dirs.add(parentOf(p)); files.set(p, String(text)); },
    remove: async (p) => { files.delete(p); },
    copy: async (a, b) => { if (files.has(a)) { dirs.add(parentOf(b)); files.set(b, files.get(a)); } },
    restrict: async () => {},
  };
  return core.createStore({
    io,
    getDir: async () => "/n",
    getMaxSaveMs: () => 5000,
    getHistory: () => ({ on: true, keep: 5, minutes: 1, capKB: 512, warnMB: 100 }),
    notify() {},
    windowId: "audit-test",
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    warn: () => {},
  });
}

let passed = 0;
async function run(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  const h = loadInstrumentedNotes();
  const { core, document, Ev, El, raf, metrics } = h;

  try {
    await run("static: zero setInterval/BroadcastChannel/WebSocket and central registry + audit doc exist", () => {
      assert.doesNotMatch(NOTES_SRC, /\bsetInterval\s*\(/, "ZentralNotes.uc.js uses zero setInterval polling");
      assert.doesNotMatch(CAL_SRC, /\bsetInterval\s*\(/, "ZentralNotesCalendar.js uses zero setInterval polling");
      assert.doesNotMatch(NOTES_SRC, /\b(?:BroadcastChannel|WebSocket)\b/, "ZentralNotes.uc.js uses zero BroadcastChannel/WebSocket");
      assert.doesNotMatch(CAL_SRC, /\b(?:BroadcastChannel|WebSocket)\b/, "ZentralNotesCalendar.js uses zero BroadcastChannel/WebSocket");
      assert.equal(typeof core.createResourceRegistry, "function", "createResourceRegistry exported on core");
      assert.ok(Array.isArray(core.ACTIVE_RESOURCE_INVENTORY) && core.ACTIVE_RESOURCE_INVENTORY.length >= 10, "ACTIVE_RESOURCE_INVENTORY documents active timers/listeners/observers");
      const docPath = path.join(ROOT, "docs", "NOTES_PERFORMANCE_AUDIT.md");
      assert.ok(fs.existsSync(docPath), "docs/NOTES_PERFORMANCE_AUDIT.md exists");
      const doc = fs.readFileSync(docPath, "utf8");
      assert.match(doc, /Active Timer, Listener & Observer Registry/i);
      assert.match(doc, /setInterval.*none|zero/i);
    });

    await run("pure: createResourceRegistry tracks listeners/timers/RAFs/observers and releases everything on disposeAll", () => {
      const reg = core.createResourceRegistry();
      let removed = 0, clearedTimer = 0, clearedRaf = 0, disconnected = 0;
      const target = {
        addEventListener() {},
        removeEventListener() { removed++; },
      };
      const off = reg.listen("test:click", target, "click", () => {});
      const tId = reg.setTimeout("test:timer", () => {}, 1000, { set: () => 42, clear: () => { clearedTimer++; } });
      const rId = reg.requestAnimationFrame("test:raf", () => {}, { request: () => 7, cancel: () => { clearedRaf++; } });
      const offObs = reg.observer("test:mo", "MutationObserver", () => { disconnected++; });

      const snap = reg.snapshot();
      assert.equal(snap.listeners, 1);
      assert.equal(snap.timers, 1);
      assert.equal(snap.rafs, 1);
      assert.equal(snap.observers, 1);
      assert.equal(snap.total, 4);

      off();
      reg.clearTimeout(tId);
      reg.cancelAnimationFrame(rId);
      offObs();
      assert.equal(removed, 1);
      assert.equal(clearedTimer, 1);
      assert.equal(clearedRaf, 1);
      assert.equal(disconnected, 1);
      assert.equal(reg.snapshot().total, 0);

      // disposeAll clears remaining resources
      reg.listen("d:l", target, "keydown", () => {});
      reg.setTimeout("d:t", () => {}, 500, { set: () => 99, clear: () => { clearedTimer++; } });
      reg.observer("d:o", "ResizeObserver", () => { disconnected++; });
      reg.disposeAll();
      assert.equal(reg.snapshot().total, 0);
      assert.equal(removed, 2);
      assert.equal(clearedTimer, 2);
      assert.equal(disconnected, 2);
    });

    await run("rapid date-note switching returns listener, timer & observer counts strictly to baseline; close & destroy leave zero leaks", async () => {
      const store = createMemoryStore(core);
      await store.open();
      store.ensureDateFolder();
      const dateNotes = [];
      for (let d = 1; d <= 25; d++) {
        const ymd = `2026-11-${String(d).padStart(2, "0")}`;
        const body = [
          `# ${ymd}`,
          "",
          "## Agenda",
          `- [ ] 09:00 Standup for ${ymd}`,
          `- [x] 14:00 Review ${ymd}`,
          "",
          "> [!note] Daily summary",
          `> Check [[2026-11-${String((d % 25) + 1).padStart(2, "0")}]] and #daily/log`,
        ].join("\n");
        dateNotes.push(store.create(body, "daily"));
      }
      await store.flush();

      const host = new El("div");
      const adapter = {
        position: "fixed", host, attach: (r) => host.appendChild(r),
        getArea: () => ({ left: 0, top: 0, width: 900, height: 900, anchor: "top" }),
        watch: () => () => {}, setActive() {}, rewatch() {},
      };
      const env = {
        readOpts: () => ({}),
        openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, exportZip: async () => 0,
        revealFolder() {}, getPref: (_k, d) => d, setPref() {}, now: () => Date.now(),
      };
      const sheet = core.createSheet({ store, adapter, env, ensureStore: async () => true });
      sheet.root.ownerDocument = document;
      assert.equal(typeof sheet.resourceSnapshot, "function", "sheet.resourceSnapshot() exposed");

      const flush = async () => {
        for (let i = 0; i < 4; i++) {
          raf.splice(0).forEach((f) => f());
          await new Promise((r) => setImmediate(r));
        }
      };

      await sheet.open();
      await flush();

      // Switch to Read mode first, settle baseline
      const modeBtn = sheet.root.querySelectorAll("button").find((b) => /Read|Edit|Split/i.test(b.title || ""));
      if (modeBtn) { modeBtn.dispatchEvent(new Ev("click", { bubbles: true })); await flush(); }
      sheet.openNote?.(dateNotes[0].id);
      await flush();

      const baseline = metrics();
      const baselineSheet = sheet.resourceSnapshot();

      // Rapidly switch across all 25 date notes (including rapid switches without awaiting between them!)
      for (let i = 0; i < dateNotes.length; i++) {
        sheet.openNote(dateNotes[i].id);
        if (i % 5 === 0) await flush();
      }
      await flush();
      // Wait briefly for any debounced preview timers to settle
      await new Promise((r) => setTimeout(r, 80));
      await flush();

      const afterRapid = metrics();
      const afterRapidSheet = sheet.resourceSnapshot();
      assert.equal(afterRapid.winListeners, baseline.winListeners, "window listener count returned to baseline after 25 rapid date-note switches");
      assert.equal(afterRapid.docListeners, baseline.docListeners, "document listener count returned to baseline after 25 rapid date-note switches");
      assert.equal(afterRapid.observers, baseline.observers, "DOM observer count returned to baseline after 25 rapid date-note switches");
      assert.equal(afterRapidSheet.listeners, baselineSheet.listeners, "sheet tracked listener count returned to baseline");
      assert.equal(afterRapidSheet.observers, baselineSheet.observers, "sheet tracked observer count returned to baseline");

      // Repeated open/close cycles must not accumulate listeners, timers, or observers
      sheet.close();
      await flush();
      const closedOnce = metrics();
      assert.equal(closedOnce.timers, 0, "zero pending timers after sheet.close()");
      assert.equal(closedOnce.rafs, 0, "zero pending RAFs after sheet.close()");
      for (let c = 0; c < 5; c++) {
        await sheet.open();
        await flush();
        sheet.openNote(dateNotes[c].id);
        sheet.close();
        await flush();
      }
      const closedAfter5 = metrics();
      assert.equal(closedAfter5.winListeners, closedOnce.winListeners, "window listeners flat across 5 open/close cycles");
      assert.equal(closedAfter5.docListeners, closedOnce.docListeners, "document listeners flat across 5 open/close cycles");
      assert.equal(closedAfter5.observers, closedOnce.observers, "observers flat across 5 open/close cycles");
      assert.equal(closedAfter5.timers, 0, "zero pending timers after repeated close");
      assert.equal(closedAfter5.rafs, 0, "zero pending RAFs after repeated close");

      // Full destroy must release EVERYTHING to zero
      sheet.destroy();
      await flush();
      const destroyedMetrics = metrics();
      const destroyedSheet = sheet.resourceSnapshot();
      assert.equal(destroyedMetrics.winListeners, 0, "zero window listeners after sheet.destroy()");
      assert.equal(destroyedMetrics.docListeners, 0, "zero document listeners after sheet.destroy()");
      assert.equal(destroyedMetrics.timers, 0, "zero active timers after sheet.destroy()");
      assert.equal(destroyedMetrics.rafs, 0, "zero active RAFs after sheet.destroy()");
      assert.equal(destroyedMetrics.observers, 0, "zero active DOM observers after sheet.destroy()");
      assert.equal(destroyedSheet.total, 0, "sheet resource registry completely empty after destroy()");
    });

    await run("profiling: Markdown parser (Showcase + 400-line doc) and 500-item reminder scheduler stay within budget", async () => {
      const built = core.buildShowcaseNote();
      const showcase = typeof built === "string" ? built : String(built?.body || "");
      assert.ok(showcase.length > 500, "showcase note text loaded");
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) {
        const blocks = core.parseBlocks(showcase, false, {});
        assert.ok(blocks.length > 20);
      }
      const parseMs = (performance.now() - t0) / 20;
      assert.ok(parseMs < 250, `parseBlocks(Showcase) avg ${parseMs.toFixed(2)}ms exceeded 250ms budget`);

      const bigDoc = Array.from({ length: 100 }, (_, i) => `## Section ${i}\n- [ ] Task ${i} with **bold**, ==highlight==, [[Note ${i}|Alias]], and #tag/${i}\n`).join("\n");
      const t1 = performance.now();
      const bigBlocks = core.parseBlocks(bigDoc, false, {});
      const bigMs = performance.now() - t1;
      assert.ok(bigBlocks.length >= 100);
      assert.ok(bigMs < 500, `parseBlocks(400-line doc) took ${bigMs.toFixed(2)}ms exceeded 500ms budget`);

      // Calendar range expansion + reminder scheduler profiling (500 reminders) + zero timer leak on destroy
      const baseNow = Date.parse("2026-11-16T09:00:00.000Z");
      const items = Array.from({ length: 500 }, (_, i) => CAL_MOD.cleanItem({
        id: "rem-" + i,
        summary: "Reminder " + i,
        start: { dateTime: new Date(baseNow + (i + 1) * 600000).toISOString() },
        x: { kind: "reminder" },
      }, baseNow));
      const t2 = performance.now();
      const expanded = CAL_MOD.expandRange(items, baseNow - 86400000, baseNow + 30 * 86400000);
      const schedTimers = new Set();
      let schedNextId = 1, storeSubs = 0;
      const schedStore = {
        list: () => [],
        on: () => { storeSubs++; return () => { storeSubs--; }; },
        items: {
          list: () => items,
          on: () => { storeSubs++; return () => { storeSubs--; }; },
        },
      };
      const sched = core.createReminderScheduler({
        store: schedStore,
        onDue: () => {},
        now: () => baseNow,
        setTimer: (fn) => { const id = schedNextId++; schedTimers.add(id); return id; },
        clearTimer: (id) => { schedTimers.delete(id); },
      });
      await sched.start();
      const schedMs = performance.now() - t2;
      assert.equal(expanded.length, 500, "expandRange processed all 500 items");
      assert.ok(schedMs < 500, `expandRange + reminderScheduler.start(500 items) took ${schedMs.toFixed(2)}ms exceeded 500ms budget`);
      sched.destroy();
      assert.equal(sched.pending(), false, "reminderScheduler.destroy() leaves pending() false");
      assert.equal(schedTimers.size, 0, "reminderScheduler.destroy() cleared all scheduled timers");
      assert.equal(storeSubs, 0, "reminderScheduler.destroy() removed all store subscriptions");
    });

    console.log(`notes-perf-resource-audit: ${passed} passed`);
  } finally {
    h.cleanupRealTimers();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
