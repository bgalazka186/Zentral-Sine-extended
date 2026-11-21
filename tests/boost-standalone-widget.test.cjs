"use strict";
/* W2: one Boost-owned card source runs under the standalone shim and the full
 * loader adapter. The Widgets tray is deliberately absent from this contract. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const { createFakeStandaloneBoostHarness } = require("./helpers/fake-standalone-boost-harness.cjs");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const BUNDLE = read("additional/boost/ZentralBoost.standalone.uc.js");
const WIDGET_SRC = read("additional/boost/ZentralBoostWidget.js");
const MOUNT_SRC = read("loader/ZentralSidebarMount.js");
const CSS = read("additional/boost/ZentralBoostWidget.css");
const MANIFEST = json("additional/boost/standalone.json");
const SETTINGS = json("additional/boost/settings.json");
const ROOT_PREFS = json("preferences.json");
const BOOST_PREFS = json("additional/boost/preferences.json");
const THEME = json("additional/boost/theme.json");
const CATALOG = read("loader/ZentralCatalog.js");
const WIDGET_PREF = "zen.workspace.zentral.boost.widget_enabled";
const row = (rows, property) => rows.find((item) => item && item.property === property);
const ACTION_IDS = ["free-light", "free-deep", "game-mode", "restore"];

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function instrumentApi(api, calls) {
  let gameOn = false;
  api.lastMB = () => 512;
  api.memoryMB = () => 512;
  const origStart = api.startSampling;
  const origStop = api.stopSampling;
  const origOnChange = api.onChange;
  api.startSampling = (...args) => { calls.startSampling += 1; return origStart.apply(api, args); };
  api.stopSampling = (...args) => { calls.stopSampling += 1; return origStop.apply(api, args); };
  api.onChange = (...args) => {
    calls.subscribe += 1;
    const off = origOnChange.apply(api, args);
    return () => { calls.unsubscribe += 1; return off(); };
  };
  const origLimiter = api.onLimiterEvent;
  api.onLimiterEvent = (fn) => {
    calls.limiterSubscribe += 1;
    calls.limiterListeners.add(fn);
    const off = origLimiter.call(api, fn);
    return () => {
      calls.limiterUnsubscribe += 1;
      calls.limiterListeners.delete(fn);
      off();
    };
  };
  api.previewGameMode = () => {
    calls.previewGameMode += 1;
    return { counts: { tabs: 2, panels: 1 } };
  };
  api.sessionState = () => ({ panels: 1, tabs: 2, restorableTabs: 2, active: true });
  api.gameModeState = () => ({ on: gameOn });
  api.runLevel1 = () => { calls.runLevel1 += 1; return Promise.resolve({ freedMB: 10 }); };
  api.runLevel2 = () => { calls.runLevel2 += 1; return Promise.resolve({ freedMB: 20, unloaded: { tabs: 1, panels: 0 } }); };
  api.setGameMode = (on) => { calls.setGameMode += 1; gameOn = Boolean(on); return { on: gameOn }; };
  api.restoreSession = () => { calls.restoreSession += 1; return { panels: 1, tabs: 2 }; };
}
const boot = (options = {}) => createFakeStandaloneBoostHarness({
  instrumentApi: options.instrumentApi || instrumentApi,
  ...options,
}).boot();

function ids(h) {
  return h.actions().map((el) => el.getAttribute("data-zbw-action"));
}

function mountFullPackWidget(h, { initiallyEnabled = true, standalone = false } = {}) {
  vm.runInContext(MOUNT_SRC, h.context, { filename: "ZentralSidebarMount.js" });
  vm.runInContext(WIDGET_SRC, h.context, { filename: "ZentralBoostWidget.js" });
  const calls = { starts: 0, stops: 0, subscriptions: 0, unsubscriptions: 0 };
  const listeners = new Set();
  const api = {
    lastMB: () => 512,
    memoryMB: () => 512,
    startSampling() { calls.starts += 1; },
    stopSampling() { calls.stops += 1; },
    onChange(fn) {
      calls.subscriptions += 1;
      listeners.add(fn);
      return () => { calls.unsubscriptions += 1; listeners.delete(fn); };
    },
    widgetLanguage: () => "en",
    widgetText: (_lang, key) => key,
    widgetMenu: () => ACTION_IDS.map((id) => ({ id, shortLabel: id, label: id, available: true })),
    gameModeState: () => ({ on: false }),
    sessionState: () => ({ panels: 0, tabs: 0 }),
  };
  const hostUnloads = new Set();
  const enabledListeners = new Set();
  let hoverCalls = 0;
  const runtime = {
    standalone,
    nativeSidebarRect: () => ({ left: 10, right: 230 }),
    registerHostUnload(fn) { hostUnloads.add(fn); return () => hostUnloads.delete(fn); },
    createSidebarHoverCard(options) {
      hoverCalls += 1;
      const node = h.doc.createElement("div");
      node.id = options.id;
      node.className = options.className;
      h.doc.body.appendChild(node);
      options.onCreate?.(node);
      return {
        show() { node.hidden = false; options.onShow?.(); },
        destroy() { options.onHide?.(); node.remove(); },
        position() {},
      };
    },
  };
  const lifecycle = {
    active: true,
    setTimeout: (fn, ms) => h.win.setTimeout(fn, ms),
    clearTimeout: (id) => h.win.clearTimeout(id),
    listen(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      return () => target.removeEventListener(type, fn, options);
    },
    own(fn) {
      let active = true;
      return () => { if (active) { active = false; fn(); } };
    },
  };
  let isEnabled = initiallyEnabled;
  const chooseBottomMount = h.win.__zentralSidebarMount.chooseBottomMount;
  let mountSelections = 0;
  const stop = h.win.__zentralBoostWidgetModule.mount({
    window: h.win,
    document: h.doc,
    runtime,
    lifecycle,
    api,
    isEnabled: () => isEnabled,
    adapter: {
      chooseBottomMount(...args) { mountSelections += 1; return chooseBottomMount(...args); },
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
  return {
    api, calls, listeners, hostUnloads, enabledListeners, runtime, lifecycle, hoverCalls: () => hoverCalls,
    mountSelections: () => mountSelections, stop,
    setEnabled(value) {
      isEnabled = Boolean(value);
      for (const callback of [...enabledListeners]) callback();
    },
  };
}

test("shared mount helper covers every anchor and preserves video adjacency", () => {
  const fixture = () => {
    const h = createFakeStandaloneBoostHarness({ instrumentApi: null });
    vm.runInContext(MOUNT_SRC, h.context, { filename: "ZentralSidebarMount.js" });
    return h;
  };
  const appendAnchor = (h, host, id) => {
    const anchor = h.doc.createElement("toolbar");
    anchor.id = id;
    host.appendChild(anchor);
    return anchor;
  };

  {
    const h = fixture();
    const host = h.doc.createElement("vbox");
    const media = appendAnchor(h, host, "zen-media-controls-toolbar");
    h.doc.documentElement.appendChild(host);
    const target = h.win.__zentralSidebarMount.chooseBottomMount(h.doc, h.win);
    assert.equal(target.parent, host);
    assert.equal(target.before, media);
    assert.equal(target.anchorId, "zen-media-controls-toolbar");
  }
  {
    const h = fixture();
    const host = h.doc.createElement("vbox");
    const bottom = appendAnchor(h, host, "zen-sidebar-bottom-buttons");
    h.doc.documentElement.appendChild(host);
    const target = h.win.__zentralSidebarMount.chooseBottomMount(h.doc, h.win);
    assert.equal(target.parent, host);
    assert.equal(target.before, bottom);
  }
  {
    const h = fixture();
    const host = h.doc.createElement("vbox");
    const tabs = appendAnchor(h, host, "tabbrowser-tabs");
    const video = appendAnchor(h, host, "zentral-video-preview");
    const chrome = h.doc.createElement("toolbar");
    host.appendChild(chrome);
    h.doc.documentElement.appendChild(host);
    const target = h.win.__zentralSidebarMount.chooseBottomMount(h.doc, h.win);
    assert.equal(target.parent, host);
    assert.equal(target.before, chrome, "tabs branch skips over the adjacent video player");
    assert.equal(video.previousSibling, tabs);
  }
  {
    const h = fixture();
    const host = h.doc.createElement("vbox");
    const anchor = appendAnchor(h, host, "tabbrowser-tabs");
    const video = appendAnchor(h, host, "zentral-video-preview");
    const after = h.doc.createElement("toolbar");
    host.appendChild(after);
    h.doc.documentElement.appendChild(host);
    const getById = h.doc.getElementById;
    h.doc.getElementById = (id) => id === "zentral-video-preview" ? video : null;
    const target = h.win.__zentralSidebarMount.chooseBottomMount(h.doc, h.win);
    assert.equal(target.before, after, "video-only branch with a known anchor inserts after the player");
    assert.equal(video.previousSibling, anchor);
    h.doc.getElementById = getById;
  }
  {
    const h = fixture();
    const host = h.doc.createElement("vbox");
    const video = appendAnchor(h, host, "zentral-video-preview");
    h.doc.documentElement.appendChild(host);
    h.doc.getElementById = (id) => id === "zentral-video-preview" ? video : null;
    const target = h.win.__zentralSidebarMount.chooseBottomMount(h.doc, h.win);
    assert.equal(target.before, video, "an unanchored video is not entered");
  }
  {
    const h = fixture();
    const toolbox = h.doc.createElement("vbox");
    toolbox.id = "navigator-toolbox";
    h.doc.documentElement.appendChild(toolbox);
    const target = h.win.__zentralSidebarMount.chooseBottomMount(h.doc, h.win);
    assert.equal(target.parent, toolbox);
    assert.equal(target.before, null);
  }
  {
    const h = fixture();
    const fallback = h.doc.createElement("vbox");
    h.doc.documentElement.appendChild(fallback);
    const target = h.win.__zentralSidebarMount.chooseBottomMount(h.doc, h.win, fallback);
    assert.equal(target.parent, fallback);
    assert.equal(target.before, null);
  }
  {
    const h = fixture();
    assert.equal(h.win.__zentralSidebarMount.chooseBottomMount(h.doc, h.win), null);
  }
});

test("standalone keeps the existing hover fallback when the shared safe selector has no target", async () => {
  const h = createFakeStandaloneBoostHarness({ instrumentApi: null });
  const mounted = mountFullPackWidget(h, { standalone: true });
  await h.flush(0);
  assert.ok(h.card());
  assert.equal(h.card().getAttribute("data-zbw-mount"), "fallback");
  assert.ok(h.anchor());
  assert.equal(mounted.hoverCalls(), 1);
  mounted.stop();
  assert.equal(h.card(), null);
  assert.equal(h.anchor(), null);
  assert.equal(h.mutationObservers.size, 0);
});

test("both loaders point at one Boost-owned source and the compact 170 px action row", () => {
  assert.deepEqual(MANIFEST.include, ["ZentralBoostWidget.js"]);
  assert.equal(MANIFEST.extras, undefined);
  assert.equal(MANIFEST.loader, "__zentralBoostLoader");
  assert.ok(MANIFEST.sharedSources.includes("loader/ZentralSidebarMount.js"));
  assert.ok(json("additional/widgets/standalone.json").sharedSources.includes("loader/ZentralSidebarMount.js"));
  assert.equal(THEME.style.chrome, "ZentralBoostWidget.css");
  assert.deepEqual(MANIFEST.borrowedSettings?.find((entry) => entry.from === "additional/widgets/settings.json")?.properties, [
    "zen.workspace.zentral.widgets.appearance.background",
    "zen.workspace.zentral.widgets.appearance.text",
  ]);
  assert.match(CATALOG, /extraSources:\s*\["loader\/ZentralSidebarMount\.js",\s*"additional\/boost\/ZentralBoostWidget\.js"\]/);
  assert.match(CATALOG, /id:\s*"widgets"[\s\S]{0,130}extraSources:\s*\["loader\/ZentralSidebarMount\.js"\]/);
  assert.match(CATALOG, /id:\s*"BoostWidget"[\s\S]{0,140}file:\s*"additional\/boost\/ZentralBoostWidget\.css"[\s\S]{0,80}owners:\s*\["boost"\]/);
  assert.match(CSS, /container-type:\s*inline-size/);
  assert.match(CSS, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(CSS, /@container\s+zbw\s*\(min-width:\s*150px\)/);
  assert.match(CSS, /@container\s+zbw\s*\(min-width:\s*280px\)/);
  assert.doesNotMatch(CSS, /max-height:\s*26px|overflow:\s*hidden\s*!important/);
  assert.match(CSS, /\.zbw-action/);
  assert.doesNotMatch(CSS, /zbsw-|zentral-boost-standalone-card/);
  assert.match(WIDGET_SRC, /function mountBoostWidget/);
  assert.match(MOUNT_SRC, /function chooseBottomMount/);
  assert.match(MOUNT_SRC, /zentral-video-preview/);
  assert.match(CSS, /:root\[zen-sidebar-hidden="true"\] #zentral-boost-widget\.zbw-flow/);
  assert.match(CSS, /zen-compact-mode="true"\]:not\(\[zen-compact-sidebar-visible="true"\]\)/);
  assert.doesNotMatch(WIDGET_SRC, /window\.ZentralWidgets|registerWidget\s*\(|takeOver\s*\(|listWidgets\s*\(/);
  assert.doesNotMatch(WIDGET_SRC, /setInterval\s*\(/);
  assert.ok(row(SETTINGS.schema, WIDGET_PREF));
  assert.ok(row(ROOT_PREFS, WIDGET_PREF));
  assert.ok(row(BOOST_PREFS, WIDGET_PREF));
  assert.match(BUNDLE, /additional\/boost\/ZentralBoostWidget\.js/);
});

test("the generated package is current and the Boost setting remains in the catalog", () => {
  const build = spawnSync(process.execPath, ["tools/build-standalone.cjs", "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  assert.match(build.stdout, /Standalone packages are up to date/);
  const coverage = spawnSync(process.execPath, ["tools/check-settings-consistency.cjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(coverage.status, 0, coverage.stdout + coverage.stderr);
  assert.match(coverage.stdout, /catalog checks passed/);
});

test("standalone Boost mounts one visible card with RAM and all four actions", async () => {
  const h = await boot();
  const card = h.doc.getElementById("zentral-boost-widget");
  assert.ok(h.win.__zentralBoostWidget, "Boost owns one destroyable instance marker");
  assert.ok(card, "the card is mounted");
  assert.equal(card.hidden, false);
  assert.equal(card.getAttribute("data-zbw-mount"), "flow", "standalone uses a safe in-flow target when one exists");
  assert.equal(h.anchor(), null);
  assert.equal(h.doc.querySelectorAll("#zentral-boost-widget").length, 1);
  assert.deepEqual(ids(h), ACTION_IDS);
  assert.equal(card.querySelector(".zbw-value").textContent, "512 MB");
  assert.equal(h.calls.startSampling, 1);
  h.destroy();
});

test("Boost copies Widgets card colors initially, follows override changes, and clears them on reset", async () => {
  const bgPref = "zen.workspace.zentral.widgets.appearance.background";
  const textPref = "zen.workspace.zentral.widgets.appearance.text";
  const h = createFakeStandaloneBoostHarness({ instrumentApi: null, prefs: { [bgPref]: "", [textPref]: "" } });
  const tray = h.doc.createElement("vbox");
  tray.id = "zentral-sidebar-widgets";
  tray.style.setProperty("--zw-card-bg", "#222b38");
  tray.style.setProperty("--zw-card-text", "#edf2fa");
  h.doc.documentElement.appendChild(tray);
  await h.boot();

  const card = h.card();
  assert.ok(card, "the Boost tile mounts beside the Widgets tray");
  assert.equal(card.style.getPropertyValue("--zbw-card-bg"), "#222b38");
  assert.equal(card.style.getPropertyValue("--zbw-card-text"), "#edf2fa");
  assert.equal(h.prefObservers.filter(([pref]) => pref === bgPref || pref === textPref).length, 2,
    "both existing Widgets appearance preferences are watched");

  tray.style.setProperty("--zw-card-bg", "#172d25");
  tray.style.setProperty("--zw-card-text", "#e4f5e8");
  h.prefs.set(bgPref, "#172d25");
  h.prefs.set(textPref, "#e4f5e8");
  h.notifyPrefChange(bgPref);
  h.notifyPrefChange(textPref);
  await h.flush(0);
  assert.equal(card.style.getPropertyValue("--zbw-card-bg"), "#172d25", "the background follows a live override");
  assert.equal(card.style.getPropertyValue("--zbw-card-text"), "#e4f5e8", "the text follows a live override");

  tray.style.removeProperty("--zw-card-bg");
  tray.style.removeProperty("--zw-card-text");
  h.prefs.set(bgPref, "");
  h.prefs.set(textPref, "");
  h.notifyPrefChange(bgPref);
  h.notifyPrefChange(textPref);
  await h.flush(0);
  assert.equal(card.style.getPropertyValue("--zbw-card-bg"), "", "reset returns the card to the theme surface");
  assert.equal(card.style.getPropertyValue("--zbw-card-text"), "", "reset returns the text to the theme color");

  h.destroy();
  assert.equal(h.prefObservers.filter(([pref]) => pref === bgPref || pref === textPref).length, 0,
    "appearance observers are removed with the card");
  assert.equal(h.timers.size, 0);
});

test("a Widgets-shaped global is ignored; it cannot register, take over or suppress the Boost tile", async () => {
  const widgets = new Proxy({}, { get() { throw new Error("Boost must not read the Widgets API"); } });
  const h = await boot({ widgets });
  assert.ok(h.doc.getElementById("zentral-boost-widget"));
  assert.deepEqual(ids(h), ACTION_IDS);
  h.destroy();
});

test("the four actions call the Boost API and Game Mode previews before switching", async () => {
  const h = await boot();
  const game = h.action("game-mode");
  h.fire(game, "mouseenter");
  assert.match(game.getAttribute("data-zbw-preview"), /Will free about 2 tabs and 1 apps/);
  assert.match(game.getAttribute("title"), /Will free about 2 tabs and 1 apps/);
  assert.equal(h.doc.getElementById("zentral-boost-widget").querySelector(".zbw-hint"), null,
    "the preview is a tooltip and never adds a second row to the tile");
  for (const id of ACTION_IDS) {
    h.fire(h.action(id), "click");
    await h.flush(0);
  }
  assert.equal(h.calls.runLevel1, 1);
  assert.equal(h.calls.runLevel2, 1);
  assert.equal(h.calls.setGameMode, 1);
  assert.equal(h.calls.restoreSession, 1);
  assert.ok(h.calls.previewGameMode >= 2);
  h.destroy();
});

test("destroy removes the card, fallback anchor, timers, listeners and subscriptions", async () => {
  const h = await boot();
  const card = h.doc.getElementById("zentral-boost-widget");
  assert.ok(card);
  h.fire(h.action("free-light"), "click");
  await h.flush(0);
  const beforeDoc = h.listenerCount("doc");
  const beforeWin = h.listenerCount("win");
  h.destroy();
  assert.equal(h.doc.getElementById("zentral-boost-widget"), null);
  assert.equal(h.doc.getElementById("zentral-boost-widget-anchor"), null);
  assert.equal(h.win.__zentralBoostWidget, undefined);
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.startSampling, h.calls.stopSampling);
  assert.equal(h.calls.subscribe, h.calls.unsubscribe);
  assert.ok(h.listenerCount("doc") < beforeDoc || h.listenerCount("win") < beforeWin);
});

test("the tile forwards existing limiter notices and releases that subscription with its scope", async () => {
  const h = await boot();
  assert.equal(h.calls.limiterSubscribe, 1);
  h.emitLimiterEvent({ action: "notify", totalMB: 5120, limitMB: 4096 });
  assert.equal(h.card().querySelector(".zbw-toast-line").textContent,
    "5120 MB in use, above your 4096 MB limit. Open Boost to free memory.");
  h.emitLimiterEvent({ action: "hard-done", totalMB: 4000, unloaded: { tabs: 2, panels: 0 } });
  assert.equal(h.card().querySelector(".zbw-toast-line").textContent, "Freed memory down to 4000 MB");
  h.emitLimiterEvent({ action: "nothing-eligible" });
  assert.equal(h.card().querySelector(".zbw-toast-line").textContent,
    "Memory is high, but nothing else may be unloaded");
  h.destroy();
  assert.equal(h.calls.limiterSubscribe, h.calls.limiterUnsubscribe);
  assert.equal(h.calls.limiterListeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test("English and Polish actions use the Boost-owned dictionary", async () => {
  const en = await boot({ language: "en" });
  assert.equal(en.doc.getElementById("zentral-boost-widget").getAttribute("aria-label"), "512 MB \u00b7 Memory Boost");
  assert.equal(en.doc.getElementById("zentral-boost-widget").querySelector(".zbw-label").textContent, "Memory Boost");
  assert.deepEqual(en.actions().map((el) => el.textContent), ["Light", "Deep", "Game", "Restore"]);
  en.destroy();
  const pl = await boot({ language: "pl-PL" });
  assert.match(pl.doc.getElementById("zentral-boost-widget").getAttribute("aria-label"), /Pamięć Boost/);
  assert.equal(pl.doc.getElementById("zentral-boost-widget").querySelector(".zbw-label").textContent, "Pamięć Boost");
  assert.deepEqual(pl.actions().map((el) => el.textContent), ["Lekko", "Głęboko", "Gra", "Przywróć"]);
  pl.destroy();
});

test("OW-121 keeps the readable action grid, short Restore badge, tooltips and stateful Game Mode", async () => {
  const h = await boot();
  const tile = h.doc.getElementById("zentral-boost-widget");
  const row = tile.querySelector(".zbw-row");
  assert.equal(row.querySelectorAll("[data-zbw-action]").length, 4);
  assert.ok(tile.querySelector(".zbw-header"));
  assert.equal(tile.querySelector(".zbw-label").textContent, "Memory Boost", "the visible label keeps card.title translation semantics");
  assert.match(CSS, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(CSS, /max-height:\s*26px|overflow:\s*hidden\s*!important/);
  assert.match(CSS, /\.zbw-action[\s\S]{0,500}height:\s*24px\s*!important/);
  assert.match(h.action("free-light").getAttribute("title"), /Light: GC\/CC \+ memory minimize\. No tabs touched\./);
  assert.match(h.action("free-deep").getAttribute("title"), /Restore available\./);
  assert.match(h.action("game-mode").getAttribute("title"), /pauses repeating features/);
  assert.match(h.action("restore").getAttribute("title"), /Restore \(1 apps, 2 tabs\)/);
  assert.match(h.action("restore").getAttribute("title"), /panels as panels, tabs as tabs/);
  assert.equal(h.action("restore").getAttribute("aria-label"), "Restore (1 apps, 2 tabs)");
  assert.equal(h.action("restore").textContent, "Restore", "the button label stays short");
  assert.equal(h.action("restore").querySelector(".zbw-action-count").textContent, "3");
  h.fire(h.action("game-mode"), "click");
  await h.flush(0);
  assert.equal(h.action("game-mode").getAttribute("aria-checked"), "true");
  assert.equal(h.action("game-mode").textContent, "Game", "the short translated label stays compact");
  assert.equal(h.action("game-mode").getAttribute("data-zbw-game-mode-on"), "true",
    "the visible CSS marker does not consume label width");

  const api = h.api();
  const items = api.widgetMenu({
    language: "en", running: false, canDeep: true, canGameMode: true, canRestore: true,
    gameMode: { on: false }, snapshot: { panels: 1, tabs: 2 },
    skipped: { "pinned-kept": 2, audible: 1 }, loadedTabs: { pinned: 2, unpinned: 1 },
  });
  assert.equal(items.length, 5, "skip reasons are tooltip data, not another visible action");
  assert.equal(items[4].id, "deep-skipped");
  assert.match(items[4].label, /pinned-kept: 2 · audible: 1/);
  assert.equal(api.widgetResultText({
    by: "level2", freedMB: 10, unloaded: { tabs: 1, panels: 0 },
    skippedCounts: { "pinned-kept": 2, audible: 1 },
  }, "en"), "Put 1 tab(s) and 0 panel(s) to sleep, freed 10 MB · skipped 3 protected tab(s)");
  assert.equal(api.widgetResultText({
    by: "level2", freedMB: 10, unloaded: { tabs: 1, panels: 0 }, skippedCounts: { audible: 2 },
  }, "pl"), "Uśpiono 1 kart i 0 paneli, zwolniono 10 MB · pominięto 2 chronionych kart");
  h.destroy();
});

test("the full-pack adapter mounts in flow without splitting the video-player anchor pair", async () => {
  const h = createFakeStandaloneBoostHarness({ instrumentApi: null });
  vm.runInContext(MOUNT_SRC, h.context, { filename: "ZentralSidebarMount.js" });
  vm.runInContext(WIDGET_SRC, h.context, { filename: "ZentralBoostWidget.js" });
  const host = h.doc.createElement("vbox");
  const tabs = h.doc.createElement("tabs");
  tabs.id = "tabbrowser-tabs";
  const video = h.doc.createElement("vbox");
  video.id = "zentral-video-preview";
  host.appendChild(tabs);
  host.appendChild(video);
  h.doc.documentElement.appendChild(host);
  const listeners = new Set();
  const api = {
    lastMB: () => 640,
    memoryMB: () => 640,
    startSampling() {}, stopSampling() {},
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    widgetLanguage: (lang) => String(lang).toLowerCase().startsWith("pl") ? "pl" : "en",
    widgetText(lang, key, params) {
      const en = { "card.title": "Memory Boost", "card.unknown": "RAM unknown", "card.ram": `${params?.mb || 0} MB`, "card.light": "Light", "card.deep": "Deep", "card.game": "Game", "card.restore": "Restore", "card.restoreLabel": "Restore", "card.nothingRestore": "Nothing to restore", "card.lightHint": "Light", "card.deepHint": "Deep", "card.gameHint": "Game", "card.gameHintOn": "Game on", "card.restoreHint": "Restore", "card.busy": "Working", "card.result": "Freed ${params?.mb || 0} MB", "card.restoreDone": "Restored", "feedback.gameStarting": "Game starting", "feedback.keptMore": "more", "feedback.keptNone": "none", "feedback.gameOn": "Game on", "feedback.gameOff": "Game off", "feedback.restoreAction": "Restore" };
      return en[key] || key;
    },
    widgetMenu() { return ACTION_IDS.map((id, i) => ({ id, shortLabel: ["Light", "Deep", "Game", "Restore"][i], label: ["Light", "Deep", "Game", "Restore"][i], available: true })); },
    widgetResultText: () => "Freed 10 MB",
    widgetPreviewText: () => "Will free about 2 tabs and 1 apps",
    widgetRestoreLabel: () => "Restore",
    widgetFeedbackText: () => "Game on",
    widgetOffText: () => "Game off",
    previewGameMode: () => ({ counts: { tabs: 2, panels: 1 } }),
    gameModeState: () => ({ on: false }),
    sessionState: () => ({ panels: 1, tabs: 2, restorableTabs: 2 }),
    runLevel1: async () => ({ freedMB: 10 }),
    runLevel2: async () => ({ freedMB: 20 }),
    setGameMode: () => ({ on: true }),
    restoreSession: () => ({ panels: 1, tabs: 2 }),
  };
  h.win.ZentralBoost = api;
  const hostUnloads = new Set();
  let hoverCalls = 0;
  const runtime = {
    standalone: false,
    nativeSidebarRect: () => ({ left: 10, right: 230 }),
    registerHostUnload(fn) { hostUnloads.add(fn); return () => hostUnloads.delete(fn); },
    createSidebarHoverCard(options) {
      hoverCalls += 1;
      const node = h.doc.createElement("div");
      node.id = options.id;
      node.className = options.className;
      h.doc.body.appendChild(node);
      options.onCreate?.(node);
      return {
        show() { node.hidden = false; options.onShow?.(); },
        destroy() { options.onHide?.(); node.remove(); },
        position() {},
      };
    },
  };
  const lifecycle = {
    active: true,
    setTimeout: (fn, ms) => h.win.setTimeout(fn, ms),
    clearTimeout: (id) => h.win.clearTimeout(id),
    listen(target, type, fn, options) { target.addEventListener(type, fn, options); return () => target.removeEventListener(type, fn, options); },
    own(fn) { let active = true; return () => { if (active) { active = false; fn(); } }; },
  };
  const stop = h.win.__zentralBoostWidgetModule.mount({
    window: h.win,
    document: h.doc,
    runtime,
    lifecycle,
    api,
    isEnabled: () => true,
    adapter: {
      chooseBottomMount: h.win.__zentralSidebarMount.chooseBottomMount,
      getSidebarRect: runtime.nativeSidebarRect,
      createSidebarHoverCard: runtime.createSidebarHoverCard,
      registerHostUnload: runtime.registerHostUnload,
      setTimeout: lifecycle.setTimeout,
      clearTimeout: lifecycle.clearTimeout,
      listen: lifecycle.listen,
      own: lifecycle.own,
    },
  });
  await h.flush(0);
  const card = h.doc.getElementById("zentral-boost-widget");
  assert.ok(card);
  assert.equal(card.parentNode, host);
  assert.equal(card.getAttribute("data-zbw-mount"), "flow");
  assert.equal(card.previousSibling, video);
  assert.equal(video.previousSibling, tabs, "the video player stays adjacent to its tabs anchor");
  assert.equal(h.anchor(), null, "full-pack mounting never creates the standalone hover anchor");
  assert.equal(hoverCalls, 0, "full-pack mounting never creates an overlay");
  assert.deepEqual(card.querySelectorAll("[data-zbw-action]").map((el) => el.getAttribute("data-zbw-action")), ACTION_IDS);
  assert.equal(listeners.size, 1);
  stop();
  assert.equal(h.doc.getElementById("zentral-boost-widget"), null);
  assert.equal(h.win.__zentralBoostWidget, undefined);
  assert.equal(hostUnloads.size, 0);
  assert.equal(h.mutationObservers.size, 0);
});

test("safe mount falls back only without an anchor, then re-seats after the tray and before bottom chrome", async () => {
  const h = createFakeStandaloneBoostHarness({ instrumentApi: null });
  const mounted = mountFullPackWidget(h);
  await h.flush(0);
  const fallback = h.card();
  assert.ok(fallback, "the legacy hover card remains available if no safe target exists");
  assert.equal(fallback.getAttribute("data-zbw-mount"), "fallback");
  assert.ok(h.anchor());
  assert.equal(mounted.hoverCalls(), 1);
  assert.equal(h.mutationObservers.size, 1, "the no-target watcher is coalesced on the document mount host");

  const host = h.doc.createElement("vbox");
  const tabs = h.doc.createElement("tabs");
  tabs.id = "tabbrowser-tabs";
  const video = h.doc.createElement("vbox");
  video.id = "zentral-video-preview";
  const tray = h.doc.createElement("div");
  tray.id = "zentral-sidebar-widgets";
  host.appendChild(tabs);
  host.appendChild(video);
  host.appendChild(tray);
  h.doc.documentElement.appendChild(host);
  h.emitMutations([{ type: "childList", target: h.doc.documentElement, addedNodes: [host], removedNodes: [] }]);
  await h.flush(0);
  let card = h.card();
  assert.ok(card);
  assert.notEqual(card, fallback, "the in-flow card replaces the fallback");
  assert.equal(card.parentNode, host);
  assert.equal(card.getAttribute("data-zbw-mount"), "flow");
  assert.equal(tray.nextSibling, card);
  assert.equal(video.previousSibling, tabs);
  assert.equal(card.previousSibling, tray);
  assert.equal(h.anchor(), null);
  assert.equal(mounted.hoverCalls(), 1);
  const observer = [...h.mutationObservers][0];
  assert.equal(observer.targets.size, 1);
  assert.equal([...observer.targets.keys()][0], host);
  assert.deepEqual([...observer.targets.values()][0], { childList: true },
    "one direct-child observer watches only the mount host");

  const media = h.doc.createElement("toolbar");
  media.id = "zen-media-controls-toolbar";
  host.insertBefore(media, card);
  h.emitMutations([{ type: "childList", target: host, addedNodes: [media], removedNodes: [] }]);
  await h.flush(0);
  assert.equal(tray.nextSibling, card);
  assert.equal(card.nextSibling, media, "Boost sits after the tray and directly before bottom chrome");
  assert.equal(video.previousSibling, tabs, "re-seating never breaks video adjacency");
  const selectionsAfterSeat = mounted.mountSelections();
  h.emitMutations([{ type: "childList", target: host, addedNodes: [card], removedNodes: [] }]);
  await h.flush(0);
  assert.equal(mounted.mountSelections(), selectionsAfterSeat, "the observer ignores its own tile insertion");

  card.remove();
  h.emitMutations([{ type: "childList", target: host, addedNodes: [], removedNodes: [card] }]);
  await h.flush(0);
  assert.equal(h.card(), card, "an externally detached tile is re-seated rather than duplicated");
  assert.equal(card.nextSibling, media);

  media.remove();
  h.emitMutations([{ type: "childList", target: host, addedNodes: [], removedNodes: [media] }]);
  await h.flush(0);
  assert.equal(tray.nextSibling, card, "the tabs anchor remains a safe fallback when bottom chrome disappears");
  host.removeChild(tabs);
  host.removeChild(video);
  host.removeChild(tray);
  h.emitMutations([{ type: "childList", target: host, addedNodes: [], removedNodes: [tabs, video, tray] }]);
  await h.flush(0);
  const restoredFallback = h.card();
  assert.ok(restoredFallback);
  assert.equal(restoredFallback.getAttribute("data-zbw-mount"), "fallback");
  assert.ok(h.anchor());

  mounted.stop();
  assert.equal(h.card(), null);
  assert.equal(h.anchor(), null);
  assert.equal(h.mutationObservers.size, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(mounted.calls.starts, mounted.calls.stops);
  assert.equal(mounted.calls.subscriptions, mounted.calls.unsubscriptions);
});

test("Zen hidden states are CSS-only; window and widget visibility release flow sampling", async () => {
  const h = createFakeStandaloneBoostHarness({ instrumentApi: null });
  const host = h.doc.createElement("vbox");
  const tabs = h.doc.createElement("tabs");
  tabs.id = "tabbrowser-tabs";
  host.appendChild(tabs);
  h.doc.documentElement.appendChild(host);
  const mounted = mountFullPackWidget(h);
  await h.flush(0);
  let card = h.card();
  assert.ok(card);
  assert.equal(card.hidden, false);
  assert.equal(mounted.calls.starts, 1);
  assert.match(CSS, /:root\[zen-sidebar-hidden="true"\][\s\S]*#zentral-boost-widget\.zbw-fallback/);
  assert.match(CSS, /:root\[zen-compact-mode="true"\][\s\S]*#zentral-boost-widget-anchor/);

  const root = h.doc.documentElement;
  root.setAttribute("zen-sidebar-hidden", "true");
  assert.equal(card.hidden, false, "the CSS attribute selector hides it without a JS observer");
  root.removeAttribute("zen-sidebar-hidden");
  root.setAttribute("zen-compact-mode", "true");
  assert.equal(card.hidden, false, "compact-hidden CSS remains independent of mount state");
  root.setAttribute("zen-compact-sidebar-visible", "true");
  assert.equal(card.hidden, false, "Zen's visible compact sidebar restores the same node");

  h.doc.hidden = true;
  for (const fn of [...(h.listeners.doc.get("visibilitychange") || [])]) fn({ type: "visibilitychange" });
  await h.flush(0);
  assert.equal(card.hidden, true);
  h.doc.hidden = false;
  for (const fn of [...(h.listeners.doc.get("visibilitychange") || [])]) fn({ type: "visibilitychange" });
  await h.flush(0);
  assert.equal(card.hidden, false);

  mounted.setEnabled(false);
  await h.flush(0);
  assert.equal(h.card(), null, "turning the widget off removes it from flow");
  assert.equal(card.parentNode, null);
  mounted.setEnabled(true);
  await h.flush(0);
  card = h.card();
  assert.ok(card);
  assert.equal(card.parentNode, host, "turning the widget back on restores a safe flow mount");

  mounted.stop();
  assert.equal(h.mutationObservers.size, 0);
  assert.equal(mounted.calls.starts, mounted.calls.stops);
  assert.equal(mounted.calls.subscriptions, mounted.calls.unsubscriptions);
});

test("the standalone full-pack guard still leaves ownership to the full runtime", async () => {
  const h = await boot({ runtimePresent: true, instrumentApi: null });
  assert.equal(h.doc.getElementById("zentral-boost-widget"), null);
  assert.equal(h.win.__zentralBoostWidget, undefined);
  h.destroy();
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed++;
    console.log("ok -", name);
  }
  console.log(`\n${passed}/${tests.length} shared Boost widget tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
