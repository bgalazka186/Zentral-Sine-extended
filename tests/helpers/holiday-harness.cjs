"use strict";
/* T2.10/T2.13a: one copy of the real-sheet harness the holiday tests share.
 *
 * The holiday work is checked against a real sheet, a real store and the real calendar module (only the DOM is fake),
 * so the harness lives in one place: a test imports it instead of copying 130 lines and slowly drifting from the others.
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createFakeDom = require("./fake-dom.cjs");

const ROOT = path.join(__dirname, "..", "..");
const SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
const cal = require("../../additional/notes/calendar/ZentralNotesCalendar.js");
const en = require("../../additional/notes/i18n/en.js");
const pl = require("../../additional/notes/i18n/pl.js");
cal.registerLanguage("en", en);
cal.registerLanguage("pl", pl);

function makeHarness({ files = new Map(), lang = "en", sheetW = 920, sheetH = 640, paneW = 620, paneH = 540 } = {}) {
  const dom = createFakeDom();
  const { document, Ev: Event, raf } = dom;
  document.documentElement.clientWidth = 1280;
  document.documentElement.clientHeight = 820;

  let curLang = lang;
  const prefStore = new Map();
  const Services = {
    obs: { addObserver() {}, removeObserver() {} },
    prefs: {
      getStringPref: (k, d) => (k === "zen.workspace.zentral.notes.language" ? curLang : (prefStore.has(k) ? String(prefStore.get(k)) : d)),
      getBoolPref: (k, d) => (prefStore.has(k) ? Boolean(prefStore.get(k)) : d),
      getIntPref: (k, d) => (prefStore.has(k) ? Number(prefStore.get(k)) : d),
    },
  };
  const win = {
    __zentralNotesParts: { "notes-calendar": cal },
    __zentralNotesLangTables: { en, pl },
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    document,
    navigator: { platform: "Linux" },
    Intl,
    innerWidth: 1280,
    innerHeight: 820,
    requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; },
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => "", fontSize: "13px" }),
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;

  vm.runInNewContext(SRC, {
    window: win,
    document,
    Event,
    Services,
    globalThis: { Services },
    ChromeUtils: {},
    navigator: { platform: "Linux" },
    Intl,
    URL,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Promise,
    Map,
    Set,
    WeakMap,
    RegExp,
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    TypeError,
    Uint8Array,
    TextEncoder,
    TextDecoder,
  });

  const core = win.__zentralNotesTestSeam.core;
  const io = {
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    exists: async (p) => files.has(p),
    readUTF8: async (p) => { if (!files.has(p)) throw Error("missing"); return files.get(p); },
    writeUTF8: async (p, text) => { files.set(p, text); },
    remove: async (p) => { files.delete(p); },
    children: async (p) => [...files.keys()].filter((k) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")),
    stat: async () => ({ lastModified: 0 }),
    restrict: async () => {},
  };
  const store = core.createStore({
    io,
    notify() {},
    windowId: "holidays-test",
    getDir: async () => "/n",
    getMaxSaveMs: () => 1000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });
  const host = document.createElement("div");
  document.body.append(host);
  const adapter = {
    position: "fixed",
    attach(el) { host.append(el); },
    getArea() { return { left: 40, top: 40, width: sheetW, height: sheetH, right: 40 + sheetW, bottom: 40 + sheetH }; },
    rect() { return { left: 40, top: 40, width: sheetW, height: sheetH, right: 40 + sheetW, bottom: 40 + sheetH }; },
    watch() { return () => {}; },
    setActive() {},
    releaseSlot() {},
    isSuspended() { return false; },
  };
  const env = {
    getPref: (k, d) => (prefStore.has(k) ? prefStore.get(k) : d),
    setPref: (k, v) => { prefStore.set(k, v); },
    now: () => Date.UTC(2026, 4, 1, 10, 0, 0), // 2026-05-01
    openUrl() {},
    revealFolder() {},
  };
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => Promise.resolve() });
  sheet.root.ownerDocument = document;
  Object.defineProperty(sheet.root, "offsetParent", { get: () => host });
  sheet.root.getBoundingClientRect = () => ({ left: 40, top: 40, width: sheetW, height: sheetH, right: 40 + sheetW, bottom: 40 + sheetH });
  const allLayout = sheet.root.querySelector(".zn-all-layout");
  allLayout.getBoundingClientRect = () => ({ left: 40, top: 80, width: sheetW, height: sheetH - 40, right: 40 + sheetW, bottom: 40 + sheetH });
  const calPane = sheet.root.querySelector(".zn-calendar-pane");
  calPane.getBoundingClientRect = () => ({ left: 40, top: 80, width: paneW, height: paneH, right: 40 + paneW, bottom: 80 + paneH });
  calPane.clientWidth = paneW;
  calPane.clientHeight = paneH;

  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      raf.splice(0).forEach((fn) => fn());
      await new Promise((r) => setImmediate(r));
    }
  };
  return { win, document, Event, core, store, sheet, files, flush, setLang(l) { curLang = l; } };
}

module.exports = { makeHarness, cal, SRC, ROOT };
