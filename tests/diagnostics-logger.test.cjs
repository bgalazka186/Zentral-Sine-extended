"use strict";
/* OW-38 (part 9): the Diagnostics Logger. Three rules matter to a person reading an exported log:
 *   1. nothing at all is collected while logging is off;
 *   2. a repeated line is compressed instead of flooding the buffer, and the buffer is bounded;
 *   3. a shared log never carries an account name, an address bar query, an e-mail or a token.
 * The suite runs the real module through `Runtime.register`'s `init()` against a fake window and drives those rules
 * through the module's own seam (`window.__zentralLoggerTestSeam`). */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createDom = require("./helpers/fake-dom.cjs");

const REPO = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(REPO, "additional/diagnostics/ZentralLogger.uc.js"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

function boot(prefs = {}) {
  const { El, Ev, document } = createDom();
  document.readyState = "complete";
  const store = new Map(Object.entries(prefs));
  const observers = [];
  const Services = {
    prefs: {
      getBoolPref: (k, f = false) => (store.has(k) ? Boolean(store.get(k)) : f),
      getIntPref: (k, f = 0) => (store.has(k) ? Number(store.get(k)) : f),
      getStringPref: (k, f = "") => (store.has(k) ? String(store.get(k)) : f),
      addObserver: (k, fn) => observers.push({ k, fn }),
      removeObserver: () => {},
      prefHasUserValue: (k) => store.has(k),
    },
    obs: { addObserver: () => {}, removeObserver: () => {} },
    prompt: { alert: () => {} },
  };
  const native = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, info: () => {} };
  const lines = [];
  const win = {
    document,
    Services,
    // The module binds its own console at load and keeps it as `_zentralNativeConsole`.
    console: { log: (...a) => lines.push(["log", ...a]), warn: (...a) => lines.push(["warn", ...a]), error: (...a) => lines.push(["error", ...a]), debug: () => {}, info: () => {} },
    __zentralLoggerTestSeam: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    dispatchEvent: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  };
  win.window = win;
  win._zentralNativeConsole = native;
  const registrations = [];
  win.ZentralRuntime = { register: (def) => registrations.push(def) };

  const sandbox = {
    window: win, document, Services, console: win.console,
    Components: { classes: {}, interfaces: {}, utils: { import: () => ({}) }, stack: { filename: "resource://zentral/additional/diagnostics/ZentralLogger.uc.js" } },
    ChromeUtils: { importESModule: () => ({ Services }) },
    Cc: {}, Ci: {},
    CustomEvent: class { constructor(type) { this.type = type; } },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Element: El, HTMLElement: El,
    URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap, Array, Object, String, Boolean, Error, TypeError,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
    getComputedStyle: () => ({}),
    alert: () => {},
    location: { href: "chrome://browser/content/browser.xhtml" },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: "ZentralLogger.uc.js" });
  const def = registrations.find((r) => r.id === "diagnostics" || r.id === "logger") || registrations[0];
  return { win, document, store, observers, registrations, sandbox, def, lines };
}

function start(env) {
  env.def.init();
  return env.win.__zentralLoggerTestSeam;
}

const OFF = boot();
test("the module registers a lifecycle owner and nothing else", () => {
  assert.equal(OFF.registrations.length, 1, "one registration");
  assert.ok(OFF.registrations[0].init, "with an init the runtime can call");
});

const quiet = start(boot());
test("with logging off, nothing at all is collected", () => {
  quiet.record("info", "TabSelect", "a tab was selected");
  assert.deepEqual(json(quiet.entries()), [], "the ring buffer stays empty");
  assert.equal(quiet.isModuleEnabled("core"), false, "and no module claims to be on");
});

const live = start(boot({ "zen.workspace.zentral.debug": true }));
test("with logging on, a line is recorded with its level, tag and message", () => {
  live.record("warn", "TabSelect", "a tab was selected");
  const entries = live.entries();
  // The module logs its own start at init, so find the line under test rather than assuming it is first.
  const line = entries.find((e) => e.includes("a tab was selected"));
  assert.ok(line, "the line is in the buffer");
  assert.match(line, /^\[\d\d:\d\d:\d\d\.\d{3}\] \[WARN\] \[TabSelect\] a tab was selected$/);
  // The redundant leading tag is stripped so a line reads once, not twice.
  live.record("info", "TabSelect", "[TabSelect] a second tab");
  assert.match(live.entries().at(-1), /\] a second tab$/);
});

test("a repeated line is compressed, and a different one is not", () => {
  const before = live.entries().length;
  live.record("info", "TabSelect", "a second tab");
  live.record("info", "TabSelect", "a second tab");
  assert.equal(live.entries().length, before, "no new line is pushed for a repeat");
  assert.match(live.entries().at(-1), /\(repeated 3x\)$/, "the repeat count is on the line itself");
  live.record("error", "TabSelect", "a second tab");
  assert.equal(live.entries().length, before + 1, "the same message at another level is a new event");
});

const begin = (env) => start(env);
test("a module switch silences only its own module", () => {
  const env = boot({ "zen.workspace.zentral.debug": true, "zen.workspace.zentral.debug.full": false });
  const seam = begin(env);
  const count = () => seam.entries().length;
  const start = count();
  seam.record("info", "Layout:Root", "root measured", "layout");
  assert.equal(count(), start, "layout is off when only full log is false and the module is off");
  seam.record("info", "TabSelect", "tab measured");
  assert.equal(count(), start, "tabs is off too");
  env.store.set("zen.workspace.zentral.debug.tabs", true);
  seam.record("info", "TabSelect", "tab measured");
  assert.equal(count(), start + 1, "turning the module on lets its lines through");
  // OW-87: the core category is its own switch now, off by default, and it is honoured like any other.
  seam.record("info", "Zentral", "core line", "core");
  assert.equal(count(), start + 1, "core is off while its own pref is off, even with logging on");
  env.store.set("zen.workspace.zentral.debug.core", true);
  seam.record("info", "Zentral", "core line", "core");
  assert.equal(count(), start + 2, "turning core on lets its lines through");
});

test("tags are classified into the module an export is filtered by", () => {
  const c = quiet.classifyModuleFromTag;
  assert.equal(c("TabSelect"), "tabs");
  assert.equal(c("TabDrag"), "tabs");
  assert.equal(c("SplitView"), "tabs");
  assert.equal(c("MenuPopup"), "menus");
  assert.equal(c("AppsGrid"), "apps");
  assert.equal(c("PanelTile"), "apps");
  assert.equal(c("Layout:Root"), "layout");
  assert.equal(c("css-inspector"), "layout");
  assert.equal(c(""), "core");
  assert.equal(c("something-else"), "core");
  assert.equal(c("TABSELECT"), "tabs", "classification is case-insensitive");
});

test("the ring buffer is bounded and drops the oldest line first", () => {
  const env = boot({ "zen.workspace.zentral.debug": true });
  const seam = begin(env);
  assert.equal(seam.MAX_ENTRIES, 8000, "the bound is part of the contract");
  // Fill past the bound without spending 8000 distinct messages' worth of time.
  for (let i = 0; i < seam.MAX_ENTRIES + 5; i++) seam.record("info", "Zentral", "line " + i, "core");
  assert.equal(seam.entries().length, seam.MAX_ENTRIES, "the buffer never grows past its bound");
  assert.match(seam.entries()[0], /line 5$/, "the five oldest lines are the ones that went");
  seam.clear();
  assert.equal(seam.entries().length, 0, "clear empties it");
});

test("a shared export carries no account name, query, address or token", () => {
  const env = boot({ "zen.workspace.zentral.debug": true });
  const seam = begin(env);
  const dirty = [
    "opened file:///home/alice/secret/profile.ini",
    "https://example.com/search?q=private+thoughts&token=abc#frag",
    "mail alice@example.com about it",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6",
    "config token=deadbeef secret: hunter2 password = s3cret",
    "C:\\Users\\alice\\AppData\\Roaming\\Mozilla\\profile",
    "userinfo https://alice:hunter2@example.com/path",
  ];
  const out = seam.redactSensitive(dirty.join("\n"));
  assert.ok(!out.includes("alice"), "no account name survives");
  assert.ok(!out.includes("private"), "no address-bar query survives");
  assert.ok(!out.includes("@example.com"), "no e-mail survives");
  assert.ok(!out.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6"), "no bearer token survives");
  assert.ok(!out.includes("deadbeef") && !out.includes("hunter2") && !out.includes("s3cret"), "no named secret survives");
  assert.match(out, /\/home\/<user>\/secret/, "the shape of the path is kept, so the line is still useful");
  assert.match(out, /https:\/\/example\.com\/search\?\[redacted\]/, "the origin and path survive");
  assert.match(out, /mail \[email\] about it/, "the address is replaced, the sentence stays readable");
  // "Authorization: Bearer …" matches the named-secret rule first, so both halves are redacted; the token itself is
  // what matters and it is gone (asserted above).
  assert.match(out, /^Authorization: \[redacted\] \[redacted\]$/m, "the header keeps its shape but no value");
  assert.ok(!out.includes("Bearer eyJ"));

  // The user-info rule drops a whole credential pair, and the named-secret rule keeps the name so the line is useful.
  assert.match(out, /userinfo https:\/\/example\.com\/path/, "an embedded password is removed with its user name");
  assert.match(out, /token=\[redacted\] secret: \[redacted\] password = \[redacted\]/);
});

test("the export is a whole document, and raw is the only way past redaction", () => {
  // The export includes a layout snapshot when the layout module is on; that needs a real document tree, which this
  // test is not about, so the layout module stays off and the trace is what is proven.
  const env = boot({
    "zen.workspace.zentral.debug": true,
    "zen.workspace.zentral.debug.full": false,
    "zen.workspace.zentral.debug.core": true,
  });
  const seam = begin(env);
  seam.record("info", "Zentral", "opened /home/bob/notes.txt", "core");
  const share = seam.generateLogString();
  assert.match(share, /ZENTRAL-LOGGER DIAGNOSTIC EXPORT/, "the export names itself");
  const count = seam.entries().length;
  assert.ok(count > 0, "the trace has the recorded line");
  assert.ok(share.includes(`EVENT TRACE LOG (${count} entries)`), "and says how many events it carries");
  assert.match(share, /Active Diagnostic Modules: Core: YES/, "the module summary is in the header");
  assert.ok(!share.includes("bob"), "a shared export is redacted by default");
  // raw is what the local file export may pass; a shared log never does.
  const raw = seam.generateLogString({ raw: true });
  assert.match(raw, /\/home\/bob\/notes\.txt/, "raw keeps the original text");
  assert.ok(!/raw === true/.test(SRC.split("Report an Issue")[0] || ""), "no early share path hands raw over");
});

console.log("\nPASS diagnostics-logger (" + passed + " tests)");

function json(v) {
  return JSON.parse(JSON.stringify(v));
}
