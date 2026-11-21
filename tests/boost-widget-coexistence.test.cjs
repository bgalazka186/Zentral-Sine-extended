"use strict";
/* W6: Boost and Widgets stay independent while sharing the same sidebar column. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeSidebarHarness } = require("./helpers/fake-widgets-harness.cjs");
const { createFakeStandaloneBoostHarness } = require("./helpers/fake-standalone-boost-harness.cjs");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const WIDGETS_SOURCE = read("additional/widgets/ZentralWidgets.uc.js");
const WIDGETS_BUNDLE = read("additional/widgets/ZentralWidgets.standalone.uc.js");
const BOOST_SOURCE = read("additional/boost/ZentralBoostWidget.js");
const BOOST_BUNDLE = read("additional/boost/ZentralBoost.standalone.uc.js");
const BOOST_CSS = read("additional/boost/ZentralBoostWidget.css");
const MOUNT_SOURCE = read("loader/ZentralSidebarMount.js");
const ACTION_IDS = ["free-light", "free-deep", "game-mode", "restore"];
const WIDGETS_ENABLED = "zen.workspace.zentral.widgets.enabled";
const WIDGETS_DISABLED_IDS = "zen.workspace.zentral.widgets.disabled_ids";
const BOOST_WIDGET_ENABLED = "zen.workspace.zentral.boost.widget_enabled";

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function captureLogs(h) {
  const entries = [];
  const logger = {
    log() {},
    warn(...args) { entries.push({ level: "warn", args }); },
    error(...args) { entries.push({ level: "error", args }); },
  };
  if (h.win) h.win.console = logger;
  if (h.window) h.window.console = logger;
  if (h.context) h.context.console = logger;
  return entries;
}

function assertNoLogs(entries, context) {
  assert.deepEqual(entries, [], context + " should not log a warning or error");
}

function installStandaloneSidebar(h, { includeVideo = true, includeMedia = true } = {}) {
  const root = h.doc.documentElement;
  const tabs = root.children.find((child) => child.localName === "tabs");
  assert.ok(tabs, "the fake Boost browser starts with a tab anchor");
  tabs.remove();
  tabs.id = "tabbrowser-tabs";
  tabs.setRect({ left: 0, top: 0, width: 179, height: 600 });

  const toolbox = h.doc.createElement("toolbox");
  toolbox.id = "navigator-toolbox";
  toolbox.setRect({ left: 0, top: 0, width: 179, height: 900 });
  root.appendChild(toolbox);
  toolbox.appendChild(tabs);

  let video = null;
  if (includeVideo) {
    video = h.doc.createElement("div");
    video.id = "zentral-video-preview";
    video.setRect({ left: 0, top: 600, width: 179, height: 0 });
    toolbox.appendChild(video);
  }

  let media = null;
  if (includeMedia) {
    media = h.doc.createElement("toolbar");
    media.id = "zen-media-controls-toolbar";
    media.setRect({ left: 0, top: 600, width: 179, height: 0 });
    toolbox.appendChild(media);
  }

  const bottom = h.doc.createElement("hbox");
  bottom.id = "zen-sidebar-bottom-buttons";
  bottom.setRect({ left: 0, top: 856, width: 179, height: 44 });
  toolbox.appendChild(bottom);
  return { toolbox, tabs, video, media, bottom };
}

function standaloneFixture(prefs = {}) {
  const h = createFakeStandaloneBoostHarness({ instrumentApi: null, prefs });
  const sidebar = installStandaloneSidebar(h);
  const logs = captureLogs(h);
  return { h, sidebar, logs };
}

async function loadStandaloneWidgets(h) {
  vm.runInContext(WIDGETS_BUNDLE, h.context, { filename: "ZentralWidgets.standalone.uc.js" });
  await h.flush(0, 100);
}

function disposeStandaloneWidgets(h) {
  try { h.win.__zentralStandalone?.widgets?.dispose?.(); } catch (_) {}
}

function countById(root, id) {
  let count = root?.id === id ? 1 : 0;
  for (const child of root?.children || []) count += countById(child, id);
  return count;
}

function assertStandaloneOrder(h, sidebar) {
  const tray = h.doc.getElementById("zentral-sidebar-widgets");
  const card = h.doc.getElementById("zentral-boost-widget");
  assert.ok(tray, "Widgets standalone mounted its generic tray");
  assert.ok(card, "Boost mounted its own card");
  assert.equal(countById(h.doc.documentElement, "zentral-boost-widget"), 1, "there is exactly one Boost tile");
  assert.equal(tray.parentNode, sidebar.toolbox);
  assert.equal(card.parentNode, sidebar.toolbox);
  assert.equal(tray.nextSibling, card, "Boost is directly after the generic tray");
  assert.equal(card.nextSibling, sidebar.media, "Boost remains above the bottom/media chrome");
  assert.equal(card.hidden, false, "the Boost tile stays visible");
  if (sidebar.video) assert.equal(sidebar.video.previousSibling, sidebar.tabs, "the video and its anchor stay adjacent");
}

function makeBoostApi() {
  const text = {
    "card.title": "Memory Boost",
    "card.unknown": "RAM unknown",
    "card.light": "Light",
    "card.deep": "Deep",
    "card.game": "Game",
    "card.restore": "Restore",
    "card.lightHint": "Light",
    "card.deepHint": "Deep",
    "card.gameHint": "Game",
    "card.gameHintOn": "Game on",
    "card.restoreHint": "Restore",
    "card.busy": "Working",
    "card.result": "Freed memory",
    "card.restoreDone": "Restored",
    "feedback.gameStarting": "Game Mode starting",
    "feedback.keptMore": "more kept",
    "feedback.keptNone": "none kept",
    "feedback.gameOn": "Game Mode on",
    "feedback.gameOff": "Game Mode off",
    "feedback.restoreAction": "Restore",
  };
  return {
    lastMB: () => 640,
    memoryMB: () => 640,
    startSampling() {},
    stopSampling() {},
    onChange() { return () => {}; },
    widgetLanguage: (language) => String(language || "en").toLowerCase().startsWith("pl") ? "pl" : "en",
    widgetText(_language, key, params) {
      if (key === "card.ram") return `${params?.mb || 0} MB`;
      return text[key] || key;
    },
    widgetMenu: () => ACTION_IDS.map((id, index) => ({
      id,
      level: ["light", "deep", "game", "restore"][index],
      shortLabel: ["Light", "Deep", "Game", "Restore"][index],
      label: ["Light", "Deep", "Game", "Restore"][index],
      available: true,
    })),
    gameModeState: () => ({ on: false }),
    sessionState: () => ({ panels: 0, tabs: 0, restorableTabs: 0 }),
    runLevel1: async () => ({ freedMB: 10 }),
    runLevel2: async () => ({ freedMB: 20 }),
    setGameMode: () => ({ on: true }),
    restoreSession: () => ({ panels: 0, tabs: 0 }),
  };
}

function createFullPackHarness({ mountBoost = true } = {}) {
  const h = createFakeSidebarHarness({
    [WIDGETS_ENABLED]: true,
    [WIDGETS_DISABLED_IDS]: "clock,weather",
    [BOOST_WIDGET_ENABLED]: true,
  });
  const widgetsOwner = h.start();
  h.flushRaf();
  const logs = [];
  const logger = {
    log() {},
    warn(...args) { logs.push({ level: "warn", args }); },
    error(...args) { logs.push({ level: "error", args }); },
  };
  h.window.console = logger;

  const observers = new Set();
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Map();
    }
    observe(target, options) {
      this.targets.set(target, { ...options });
      observers.add(this);
    }
    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
  }
  h.window.MutationObserver = FakeMutationObserver;

  const context = vm.createContext({
    window: h.window,
    document: h.document,
    globalThis: h.window,
    console: logger,
    URL,
    Promise,
    Set,
    Map,
    WeakMap,
    WeakSet,
    Array,
    Object,
    Number,
    Math,
    String,
    Boolean,
    Symbol,
    Error,
    TypeError,
    Date,
    JSON,
    RegExp,
  });
  vm.runInContext(MOUNT_SOURCE, context, { filename: "ZentralSidebarMount.js" });
  vm.runInContext(BOOST_SOURCE, context, { filename: "ZentralBoostWidget.js" });

  const hostUnloads = new Set();
  const enabledListeners = new Set();
  const runtime = h.window.ZentralRuntime;
  runtime.nativeSidebarRect = () => ({ left: 0, right: 179 });
  runtime.registerHostUnload = (fn) => {
    hostUnloads.add(fn);
    return () => hostUnloads.delete(fn);
  };
  const lifecycle = {
    active: true,
    setTimeout: (fn, ms) => h.window.setTimeout(fn, ms),
    clearTimeout: (id) => h.window.clearTimeout(id),
    listen(target, type, fn, options) {
      target.addEventListener?.(type, fn, options);
      return () => target.removeEventListener?.(type, fn, options);
    },
    own(fn) {
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        fn();
      };
    },
  };
  let enabled = true;
  let stopBoost = null;

  function drain() {
    for (let round = 0; round < 8; round++) {
      h.advanceTime(0);
      h.flushRaf();
    }
  }

  function mountBoost() {
    if (stopBoost) return stopBoost;
    stopBoost = h.window.__zentralBoostWidgetModule.mount({
      window: h.window,
      document: h.document,
      runtime,
      lifecycle,
      api: makeBoostApi(),
      isEnabled: () => enabled,
      adapter: {
        chooseBottomMount: h.window.__zentralSidebarMount.chooseBottomMount,
        registerHostUnload: runtime.registerHostUnload,
        setTimeout: lifecycle.setTimeout,
        clearTimeout: lifecycle.clearTimeout,
        listen: lifecycle.listen,
        own: lifecycle.own,
        observeEnabledChange(callback) {
          enabledListeners.add(callback);
          return () => enabledListeners.delete(callback);
        },
      },
    });
    drain();
    return stopBoost;
  }

  function destroy() {
    try { stopBoost?.(); } catch (_) {}
    try { widgetsOwner.disposer?.(); } catch (_) {}
    drain();
  }

  const fixture = {
    h,
    logs,
    observers,
    hostUnloads,
    widgetsOwner,
    runtime,
    mountBoost,
    drain,
    destroy,
    tray: () => h.document.getElementById("zentral-sidebar-widgets"),
    card: () => h.document.getElementById("zentral-boost-widget"),
    setBoostEnabled(value) {
      enabled = Boolean(value);
      for (const callback of [...enabledListeners]) callback();
      drain();
    },
  };
  if (mountBoost) fixture.mountBoost();
  return fixture;
}

function stripComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function boostFiles() {
  const root = path.join(ROOT, "additional", "boost");
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:js|uc\.js)$/.test(entry.name)) files.push(file);
    }
  };
  walk(root);
  return files;
}

function ownedCssSelectors(css) {
  const source = String(css).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...source.matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1].trim())
    .flatMap((group) => group.split(",").map((selector) => selector.trim()))
    .filter(Boolean);
}

test("1. Full pack: enabled Widgets tray and Boost own one card in deterministic sidebar order", () => {
  const f = createFullPackHarness();
  try {
    const tray = f.tray();
    const card = f.card();
    assert.ok(tray && !tray.hidden, "the generic Widgets tray is enabled");
    assert.equal(f.h.prefs.get(WIDGETS_ENABLED), true);
    assert.equal(f.h.prefs.get(BOOST_WIDGET_ENABLED), true);
    assert.ok(card && !card.hidden, "the Boost-owned tile is mounted and visible");
    assert.equal(countById(f.h.docRoot, "zentral-boost-widget"), 1);
    assert.equal(tray.parentNode, f.h.toolbox);
    assert.equal(tray.nextSibling, card);
    assert.equal(card.nextSibling, f.h.mediaToolbar, "Boost sits directly above the media/bottom chrome");
    assertNoLogs(f.logs, "full-pack Boost/Widgets coexistence");
  } finally {
    f.destroy();
  }
});

test("2. Boost standalone: in-flow card, no errors, and no Widgets dependency", async () => {
  const { h, sidebar, logs } = standaloneFixture();
  try {
    await h.boot();
    const card = h.card();
    assert.ok(card);
    assert.equal(card.parentNode, sidebar.toolbox);
    assert.equal(card.getAttribute("data-zbw-mount"), "flow");
    assert.equal(card.hidden, false);
    assert.equal(h.win.ZentralWidgets, undefined);
    assert.equal(h.doc.getElementById("zentral-sidebar-widgets"), null);
    assert.doesNotMatch(stripComments(BOOST_SOURCE), /\bZentralWidgets\b/);
    assertNoLogs(logs, "Boost standalone");
  } finally {
    h.destroy();
  }
});

test("3. Widgets standalone only: no Boost element or strings and no errors", async () => {
  const { h, logs } = standaloneFixture({
    [WIDGETS_ENABLED]: true,
    [WIDGETS_DISABLED_IDS]: "clock,date,weather",
  });
  try {
    await loadStandaloneWidgets(h);
    assert.ok(h.win.ZentralWidgets, "the standalone Widgets package activated");
    assert.ok(h.doc.getElementById("zentral-sidebar-widgets"));
    assert.equal(h.card(), null);
    assert.equal(h.win.ZentralBoost, undefined);
    assert.equal(h.win.__zentralBoostWidget, undefined);
    assert.doesNotMatch(stripComments(WIDGETS_SOURCE), /\bboost\b|ZentralBoost|__zentralBoost/i);
    assert.doesNotMatch(WIDGETS_BUNDLE, /\bboost\b|ZentralBoost|__zentralBoost/i);
    const visibleText = h.doc.documentElement.descendants().map((node) => node.textContent || "").join(" ");
    assert.doesNotMatch(visibleText, /boost/i);
    assertNoLogs(logs, "Widgets standalone");
  } finally {
    disposeStandaloneWidgets(h);
    h.destroy();
  }
});

for (const order of ["boost-first", "widgets-first"]) {
  test(`4/5. Both standalone, ${order}: final sidebar order matches the full pack`, async () => {
    const { h, sidebar, logs } = standaloneFixture({
      [WIDGETS_ENABLED]: true,
      [WIDGETS_DISABLED_IDS]: "clock,date,weather",
    });
    try {
      if (order === "boost-first") await h.boot();
      await loadStandaloneWidgets(h);
      if (order === "widgets-first") await h.boot();
      else {
        // The fake DOM does not synthesize MutationObserver records on insertBefore;
        // deliver the real childList record so Boost can perform its safe re-seat.
        const tray = h.doc.getElementById("zentral-sidebar-widgets");
        h.emitMutations([{ type: "childList", target: sidebar.toolbox, addedNodes: [tray], removedNodes: [] }]);
      }
      await h.flush(0, 100);
      assertStandaloneOrder(h, sidebar);
      assertNoLogs(logs, `standalone ${order} load order`);
    } finally {
      disposeStandaloneWidgets(h);
      h.destroy();
    }
  });
}

test("6. Disabling or hiding the Widgets tray does not hide Boost", () => {
  const f = createFullPackHarness();
  try {
    const tray = f.tray();
    const card = f.card();
    assert.ok(tray && card);
    f.h.Services.prefs.setBoolPref(WIDGETS_ENABLED, false);
    f.drain();
    assert.equal(tray.hidden, true, "the Widgets module hides its tray when disabled");
    assert.equal(f.card(), card, "the Boost tile is not remounted or removed");
    assert.equal(card.hidden, false, "Boost remains visible without the tray");
    assert.equal(card.parentNode, f.h.toolbox);
  } finally {
    f.destroy();
  }
});

test("7. widget_enabled=false leaves no tile, flow observer, timer, or unscoped CSS effect", async () => {
  const { h, logs } = standaloneFixture({ [BOOST_WIDGET_ENABLED]: false });
  try {
    await h.boot();
    assert.equal(h.card(), null);
    assert.equal(h.anchor(), null);
    assert.equal(h.mutationObservers.size, 0, "disabled Boost does not retain a flow observer");
    assert.equal(h.timers.size, 0, "disabled Boost leaves no pending widget timer");
    const selectors = ownedCssSelectors(BOOST_CSS);
    assert.ok(selectors.length > 0);
    for (const selector of selectors) {
      assert.match(selector, /#zentral-boost-widget|#zentral-boost-widget-anchor|\.zbw-/,
        `Boost CSS selector is scoped to its own card: ${selector}`);
    }
    assertNoLogs(logs, "disabled Boost widget");
  } finally {
    h.destroy();
  }

  const f = createFullPackHarness();
  try {
    assert.ok(f.card());
    assert.equal(f.observers.size, 1, "enabled flow tracking owns one host observer");
    f.setBoostEnabled(false);
    assert.equal(f.card(), null, "turning the visibility pref off removes the tile");
    assert.equal(f.observers.size, 0, "turning the visibility pref off disconnects flow tracking");
  } finally {
    f.destroy();
  }
});

test("8. Sidebar hidden/compact states are CSS-only and reveal the same mounted card", async () => {
  const { h } = standaloneFixture();
  try {
    await h.boot();
    const card = h.card();
    assert.ok(card);
    const root = h.doc.documentElement;
    root.setAttribute("zen-sidebar-hidden", "true");
    assert.equal(h.card(), card, "hidden sidebar keeps the tile mounted");
    assert.equal(card.hidden, false, "the root attribute is handled by CSS, not a remount/poll");
    root.removeAttribute("zen-sidebar-hidden");
    root.setAttribute("zen-compact-mode", "true");
    assert.equal(h.card(), card, "compact-hidden sidebar keeps the tile mounted");
    assert.equal(card.hidden, false);
    root.removeAttribute("zen-compact-mode");
    assert.equal(h.card(), card, "revealing the sidebar restores the same DOM tile");
    assert.match(BOOST_CSS, /:root\[zen-sidebar-hidden="true"\][\s\S]*?#zentral-boost-widget\.zbw-flow/);
    assert.match(BOOST_CSS, /:root\[zen-compact-mode="true"\]:not\(\[zen-compact-sidebar-visible="true"\]\)[\s\S]*?#zentral-boost-widget\.zbw-flow/);
    assert.match(BOOST_CSS, /#zentral-boost-widget\.zbw-flow[\s\S]*?contain:\s*layout/);
  } finally {
    h.destroy();
  }
});

test("9. Video player and anchor stay adjacent; Boost seats after the pair", async () => {
  const { h, sidebar } = standaloneFixture();
  try {
    await h.boot();
    const card = h.card();
    assert.ok(card);
    assert.equal(sidebar.video.previousSibling, sidebar.tabs);
    assert.equal(card.previousSibling, sidebar.video, "the card is after the intact anchor/player pair");
    assert.equal(sidebar.video.nextSibling, card);
  } finally {
    h.destroy();
  }
});

test("9b. A tray directly before the tabs-host video stays adjacent while Boost seats after the player", async () => {
  const { h, sidebar } = standaloneFixture({
    [WIDGETS_ENABLED]: true,
    [WIDGETS_DISABLED_IDS]: "clock,date,weather",
  });
  try {
    await h.boot();
    await loadStandaloneWidgets(h);
    const tray = h.doc.getElementById("zentral-sidebar-widgets");
    assert.ok(tray, "the generic Widgets tray mounted");

    // Model the narrow mount-host arrangement: the tray directly precedes the video player,
    // both in the tabs host's sidebar column. Re-seating Boost must preserve this pair.
    sidebar.toolbox.insertBefore(tray, sidebar.video);
    assert.ok(sidebar.tabs.parentNode === sidebar.video.parentNode, "the video is in the tabs host column");
    assert.equal(tray.nextSibling?.id, sidebar.video.id, "the tray/player adjacency is the precondition");
    h.emitMutations([{ type: "childList", target: sidebar.toolbox, addedNodes: [tray], removedNodes: [] }]);
    await h.flush(0, 100);

    const card = h.card();
    assert.ok(card, "Boost's tile remains mounted");
    assert.equal(tray.nextSibling?.id, sidebar.video.id, "re-seating must preserve the tray/player adjacency");
    assert.notEqual(sidebar.video.previousSibling?.id, card.id, "the tile must not become the video's previous sibling");
    assert.equal(card.previousSibling?.id, sidebar.video.id, "Boost stays immediately after the video player");
  } finally {
    disposeStandaloneWidgets(h);
    h.destroy();
  }
});

test("10. Reloading Boost twice keeps one tile; destroy removes tile, observer, and timers", async () => {
  const { h } = standaloneFixture();
  try {
    await h.boot();
    h.runBundle();
    await h.flush(0, 100);
    assert.equal(countById(h.doc.documentElement, "zentral-boost-widget"), 1);
    assert.equal(h.mutationObservers.size, 1);
    const marker = h.win.__zentralBoostWidget;
    assert.ok(marker && typeof marker.destroy === "function");
    marker.destroy();
    assert.equal(h.card(), null);
    assert.equal(h.anchor(), null);
    assert.equal(h.mutationObservers.size, 0);
    assert.equal(h.timers.size, 0);
  } finally {
    h.destroy();
  }
});

test("11. A 30 px in-flow Boost tile increases Widgets otherChromeHeight by at least 30 px", () => {
  const f = createFullPackHarness({ mountBoost: false });
  try {
    const tray = f.tray();
    assert.ok(tray);
    const before = f.h.core.measureSidebarMetrics(f.h.document, f.h.window, tray, f.h.toolbox);
    f.mountBoost();
    const card = f.card();
    assert.ok(card);
    card.setRect({ left: 0, top: 800, width: 179, height: 30 });
    const after = f.h.core.measureSidebarMetrics(f.h.document, f.h.window, tray, f.h.toolbox);
    assert.ok(after.otherChromeHeight - before.otherChromeHeight >= 30,
      `expected the tray to account for the Boost tile height; before=${before.otherChromeHeight}, after=${after.otherChromeHeight}`);
    assert.equal(tray.nextSibling, card);
  } finally {
    f.destroy();
  }
});

test("12/13. Modules remain uncoupled and neither introduces setInterval", () => {
  const widgetsCode = stripComments(WIDGETS_SOURCE);
  assert.doesNotMatch(widgetsCode, /\bZentralBoost\b|__zentralBoost|\bboost\b/i,
    "the Widgets source contains no Boost token or runtime handoff");
  for (const file of boostFiles()) {
    const code = stripComments(fs.readFileSync(file, "utf8"));
    assert.doesNotMatch(code, /\bZentralWidgets\b/, `${path.relative(ROOT, file)} must not call or probe Widgets`);
  }
  assert.doesNotMatch(widgetsCode, /\bsetInterval\s*\(/);
  assert.doesNotMatch(stripComments(BOOST_SOURCE), /\bsetInterval\s*\(/);
  assert.doesNotMatch(stripComments(BOOST_BUNDLE), /\bsetInterval\s*\(/);
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  }
  console.log(`\n${passed}/${tests.length} Boost widget coexistence tests passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
