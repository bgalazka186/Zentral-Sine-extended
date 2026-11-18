"use strict";
/* OW-93 (plan B6): the `throttled` background mode, which until now was a stored value with no behaviour behind it.
 *
 * The behaviour is three lines inside `syncAppPanelBrowserActivity` and one guard in the preload path, so the proof is
 * built around those exact lines: the function is lifted out of the shipped source and run against fake browsers. That
 * keeps the test honest about the code that ships instead of re-describing it.
 *
 * The plan's own words: a `live` record must keep EXACTLY today's behaviour (that is the default), a `throttled` record
 * is inactive while hidden and active while shown, and switching modes applies immediately. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");
const INTEGRATIONS = fs.readFileSync(path.join(REPO, "extension/panels/browsers/ZentralBrowserIntegrations.uc.js"), "utf8");
const CORNER = fs.readFileSync(path.join(REPO, "extension/panels/corner-tiles/ZentralCornerPanels.uc.js"), "utf8");
const BOOST = fs.readFileSync(path.join(REPO, "additional/boost/ZentralBoost.uc.js"), "utf8");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// The two functions under test, lifted from the shipped file by their own names.
function extract(name, source = INTEGRATIONS) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists in the shipped source`);
  // Walk braces from the first `{` after the signature.
  let depth = 0;
  let began = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") { depth += 1; began = true; }
    else if (source[i] === "}") {
      depth -= 1;
      if (began && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced braces for " + name);
}

// A fake browser inside a fake panel shell: `panelBrowserVisible` is proven separately, so here it is a stub whose
// answer the test controls (that is the one thing the activity rule is a function of, besides the record).
function browser({ visible = false, mode = "live", preload = false, id = "app" } = {}) {
  return {
    isConnected: true,
    docShellIsActive: false,
    renderLayers: true,
    isRemoteBrowser: true,
    _bgalazkaAppId: id,
    _visible: visible,
    style: { display: "" },
    hasAttribute: () => false,
    closest: () => null,
    getClientRects: () => [{ width: 10 }],
    getComputedStyle: null,
  };
}

function runSync({ browsers, essentialPanels, visibleOf }) {
  const fnBody = extract("syncAppPanelBrowserActivity");
  const ctx = { essentialPanels, getAllAppBrowsers: () => browsers };
  const document = {
    getElementById: (id) => ({ id, contains: () => true, hasAttribute: () => false, getAttribute: () => null }),
    documentElement: { hasAttribute: () => false, getAttribute: () => null },
  };
  const addonHostByAppId = new Map();
  const window = {
    getComputedStyle: (el) => ({ display: el._visible ? "block" : "none", visibility: "visible" }),
    Zentral: undefined,
  };
  // The shipped body calls `panelBrowserVisible` directly; the stub is supplied under that exact name, so what runs is
  // the real function with one injected input.
  const fn = new Function(
    "ctx", "document", "window", "addonHostByAppId", "console", "panelBrowserVisible",
    `${fnBody}\nreturn syncAppPanelBrowserActivity;`,
  );
  const sync = fn(ctx, document, window, addonHostByAppId, console, (b) => visibleOf(b));
  sync(browsers);
  return browsers;
}

test("a `live` record keeps exactly today's behaviour", () => {
  const visible = browser({ visible: true, mode: "live", id: "a" });
  const hidden = browser({ visible: false, mode: "live", id: "b" });
  const hiddenPreload = browser({ visible: false, mode: "live", preload: true, id: "c" });
  const records = new Map([
    ["a", { app: { id: "a", preload: false }, tab: { isConnected: true }, backgroundMode: "live" }],
    ["b", { app: { id: "b", preload: false }, tab: { isConnected: true }, backgroundMode: "live" }],
    ["c", { app: { id: "c", preload: true }, tab: { isConnected: true }, backgroundMode: "live" }],
  ]);
  runSync({
    browsers: [visible, hidden, hiddenPreload],
    essentialPanels: records,
    visibleOf: (b) => b._visible,
  });
  assert.equal(visible.docShellIsActive, true, "a visible panel is active, as always");
  assert.equal(hidden.docShellIsActive, false, "a hidden ordinary panel is inactive, as always");
  assert.equal(hiddenPreload.docShellIsActive, true, "a hidden PRELOAD stays active for its notifications, as always");
  assert.equal(visible.renderLayers, true);
  assert.equal(hiddenPreload.renderLayers, false, "a notification document does not composite, as always");
});

test("a `throttled` record is inactive while hidden and active while shown", () => {
  const hidden = browser({ visible: false, mode: "throttled", id: "t" });
  const shown = browser({ visible: true, mode: "throttled", id: "s" });
  const records = new Map([
    ["t", { app: { id: "t", preload: false }, tab: { isConnected: true }, backgroundMode: "throttled" }],
    ["s", { app: { id: "s", preload: false }, tab: { isConnected: true }, backgroundMode: "throttled" }],
  ]);
  runSync({ browsers: [hidden, shown], essentialPanels: records, visibleOf: (b) => b._visible });
  assert.equal(hidden.docShellIsActive, false, "hidden and throttled: Gecko may throttle its timers");
  assert.equal(hidden.renderLayers, false, "and it does not paint");
  assert.equal(shown.docShellIsActive, true, "shown is shown: active again");
  assert.equal(shown.renderLayers, true);
});

test("a hidden throttled PRELOAD is throttled too — that is the point of the mode", () => {
  const hiddenPreload = browser({ visible: false, mode: "throttled", preload: true, id: "p" });
  const records = new Map([
    ["p", { app: { id: "p", preload: true }, tab: { isConnected: true }, backgroundMode: "throttled" }],
  ]);
  runSync({ browsers: [hiddenPreload], essentialPanels: records, visibleOf: (b) => b._visible });
  assert.equal(hiddenPreload.docShellIsActive, false,
    "a person who marks a notification app throttled accepts that its page stops running while hidden");
});

test("`asleep-allowed` is about unloading, not activity, so it behaves like `live` here", () => {
  const hiddenPreload = browser({ visible: false, mode: "asleep-allowed", preload: true, id: "z" });
  const records = new Map([
    ["z", { app: { id: "z", preload: true }, tab: { isConnected: true }, backgroundMode: "asleep-allowed" }],
  ]);
  runSync({ browsers: [hiddenPreload], essentialPanels: records, visibleOf: (b) => b._visible });
  assert.equal(hiddenPreload.docShellIsActive, true, "still active until a deep pass puts it to sleep");
});

test("a record with no mode at all is a record from before this setting, so it is live", () => {
  const hiddenPreload = browser({ visible: false, preload: true, id: "old" });
  const records = new Map([["old", { app: { id: "old", preload: true }, tab: { isConnected: true } }]]);
  runSync({ browsers: [hiddenPreload], essentialPanels: records, visibleOf: (b) => b._visible });
  assert.equal(hiddenPreload.docShellIsActive, true, "nothing changes for an existing panel");
});

test("the preload path does not undo a throttled record", () => {
  const preload = CORNER.slice(CORNER.indexOf("function loadEssentialInBackground"), CORNER.indexOf("function loadEssentialInBackground") + 4000);
  assert.match(preload, /if \(record\.backgroundMode !== "throttled"\) \{/, "the activation is guarded by the mode");
  assert.match(preload, /browser\.docShellIsActive = true;/, "and still happens for every other record");
  // The mode is read off the record, which is what the tile menu and Boost both write.
  assert.match(BOOST, /setBackgroundMode/);
  assert.match(INTEGRATIONS, /record\.backgroundMode = mode;/);
});

test("switching the mode applies immediately, not on the next panel open", () => {
  const menuStart = INTEGRATIONS.indexOf("const BG_MODES = [");
  const menu = INTEGRATIONS.slice(menuStart, INTEGRATIONS.indexOf("ctx.retryPanelTask(\"background-mode-menu\"") + 200);
  assert.match(menu, /ctx\.syncAppPanelBrowserActivity\?\.\(\)/, "the menu re-runs the activity pass on a switch");
  assert.match(menu, /ctx\.saveEssentialSettings\(record\)/, "and saves the choice with the record");
  // The three modes the plan names, offered as a radio group.
  for (const mode of ["live", "throttled", "asleep-allowed"]) {
    assert.ok(menu.includes(`["${mode}",`), mode + " is offered on the menu");
  }
});

test("the stored mode is read back from the session, so a restart keeps it", () => {
  assert.match(CORNER, /backgroundMode: \["live", "throttled", "asleep-allowed"\]\.includes\(record\.backgroundMode\)/, "saved");
  assert.match(CORNER, /backgroundMode: \["live", "throttled", "asleep-allowed"\]\.includes\(settings\.backgroundMode\)/, "restored");
});

async function main() {
  for (const [name, fn] of tests) {
    if (fn.constructor.name === "AsyncFunction") await fn();
    else fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\now-93-panel-throttle (${passed} passed)`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
