"use strict";
/* T3.9a tests: Sidebar widgets module shell, free-area measurement,
 * video-player avoidance (no fixed ratio, zero interaction), room for tabs/folders/Essentials,
 * per-widget on/off, per-widget refresh intervals (no setInterval), pause-when-hidden,
 * last-value caching, and leak-free disposal. */
const assert = require("node:assert/strict");
// The fake sidebar and the two source files come from one shared helper, so a live widget test can drive the real
// scheduler without a second copy of the shell drifting from this one.
const { createFakeSidebarHarness, widgetSrc, widgetCss } = require("./helpers/fake-widgets-harness.cjs");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

(async () => {
  await test("static: zero setInterval polling in ZentralWidgets and normal-flow CSS (no z-index overlay)", () => {
    assert.ok(!/\bsetInterval\b/.test(widgetSrc), "must never use setInterval");
    assert.ok(!/\bz-index\b/.test(widgetCss), "widget tray stays in normal flex flow without z-index");
    assert.match(widgetCss, /#zentral-sidebar-widgets\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    assert.match(widgetCss, /contain:\s*inline-size/);
    assert.match(widgetCss, /prefers-reduced-motion/);
  });

  await test("pure computeWidgetArea: owner dimensions (179x426 free, 179x301 with 16:9 player), arbitrary ratios, and auto-hide thresholds", () => {
    const h = createFakeSidebarHarness();
    const { computeWidgetArea } = h.core;

    // 1. Standard sidebar: 179px wide, 900px tall, 176px chrome, 298px tabs -> 426px free
    const normal = computeWidgetArea(
      {
        sidebarWidth: 179,
        sidebarHeight: 900,
        otherChromeHeight: 176,
        videoPlayerVisible: false,
        videoPlayerHeight: 0,
        tabsContentHeight: 298,
      },
      { enabled: true, activeWidgetCount: 2, maxHeightShare: 45, minFreeHeight: 140, tabsReservePx: 24 },
    );
    assert.equal(normal.visible, true);
    assert.equal(normal.paused, false);
    assert.equal(normal.reason, "visible");
    assert.equal(normal.rawFreeHeight, 426);
    assert.equal(normal.usableFreeHeight, 402);
    assert.equal(normal.maxTrayHeight, Math.floor(426 * 0.45));
    assert.equal(normal.videoPlayerVisible, false);
    assert.equal(normal.density, "regular");

    // 2. 16:9 sidebar video player showing (125px height) -> 301px free
    const with16by9 = computeWidgetArea(
      {
        sidebarWidth: 179,
        sidebarHeight: 900,
        otherChromeHeight: 176,
        videoPlayerVisible: true,
        videoPlayerHeight: 125,
        tabsContentHeight: 298,
      },
      { enabled: true, activeWidgetCount: 2, maxHeightShare: 45, minFreeHeight: 140, tabsReservePx: 24 },
    );
    assert.equal(with16by9.visible, true);
    assert.equal(with16by9.rawFreeHeight, 301);
    assert.equal(with16by9.maxTrayHeight, Math.floor(301 * 0.45));
    assert.equal(with16by9.videoPlayerVisible, true);
    assert.equal(with16by9.videoReservedHeight, 125);

    // 3. Portrait / custom-resized video player (no fixed aspect ratio assumed: e.g. 240px) -> 186px free
    const withTallPlayer = computeWidgetArea(
      {
        sidebarWidth: 179,
        sidebarHeight: 900,
        otherChromeHeight: 176,
        videoPlayerVisible: true,
        videoPlayerHeight: 240,
        tabsContentHeight: 298,
      },
      { enabled: true, activeWidgetCount: 2, maxHeightShare: 45, minFreeHeight: 140, tabsReservePx: 24 },
    );
    assert.equal(withTallPlayer.visible, true);
    assert.equal(withTallPlayer.rawFreeHeight, 186);
    assert.equal(withTallPlayer.videoReservedHeight, 240);

    // 4. Very tall video player or lots of tabs drops free height below minFreeHeight -> auto-hide + pause
    const tight = computeWidgetArea(
      {
        sidebarWidth: 179,
        sidebarHeight: 900,
        otherChromeHeight: 176,
        videoPlayerVisible: true,
        videoPlayerHeight: 300,
        tabsContentHeight: 298,
      },
      { enabled: true, activeWidgetCount: 2, maxHeightShare: 45, minFreeHeight: 140, tabsReservePx: 24 },
    );
    assert.equal(tight.rawFreeHeight, 126);
    assert.equal(tight.visible, false);
    assert.equal(tight.paused, true);
    assert.equal(tight.reason, "low-free-height");
    assert.equal(tight.maxTrayHeight, 0);

    // 5. Collapsed/narrow sidebar (< 120px) -> auto-hide + pause
    const narrow = computeWidgetArea(
      { sidebarWidth: 56, sidebarHeight: 900, otherChromeHeight: 176, tabsContentHeight: 200 },
      { enabled: true, activeWidgetCount: 1, minSidebarWidth: 120 },
    );
    assert.equal(narrow.visible, false);
    assert.equal(narrow.paused, true);
    assert.equal(narrow.reason, "narrow-sidebar");

    // 6. Narrow compact-density sidebar (165px) stays visible in compact density
    const compact = computeWidgetArea(
      { sidebarWidth: 165, sidebarHeight: 900, otherChromeHeight: 176, tabsContentHeight: 298 },
      { enabled: true, activeWidgetCount: 1, minSidebarWidth: 120 },
    );
    assert.equal(compact.visible, true);
    assert.equal(compact.density, "compact");

    // 7. Window hidden or sidebar hidden pauses when pauseWhenHidden=true
    const hiddenWin = computeWidgetArea(
      { sidebarWidth: 179, sidebarHeight: 900, otherChromeHeight: 176, tabsContentHeight: 298, windowHidden: true },
      { enabled: true, activeWidgetCount: 1, pauseWhenHidden: true },
    );
    assert.equal(hiddenWin.visible, false);
    assert.equal(hiddenWin.paused, true);
    assert.equal(hiddenWin.reason, "window-hidden");
  });

  await test("DOM mount & video-player avoidance: never breaks video.previousSibling or touches #zentral-video-preview", () => {
    const h = createFakeSidebarHarness({ "zen.workspace.zentral.widgets.enabled": true });
    const { api } = h.start();

    api.registerWidget({
      id: "sample",
      title: "Sample",
      create({ document }) {
        const el = document.createElement("div");
        return { element: el, render(v) { el.textContent = String(v ?? ""); } };
      },
    });

    const tray = h.document.getElementById("zentral-sidebar-widgets");
    assert.ok(tray, "tray mounted in sidebar");
    assert.equal(tray.parentNode, h.toolbox);
    // Tray mounts strictly BEFORE #zen-media-controls-toolbar so #zentral-video-preview stays adjacent to its anchor!
    assert.equal(tray.nextSibling, h.mediaToolbar);
    assert.equal(h.videoPreview.previousSibling, h.mediaToolbar, "video player's anchor adjacency is untouched");
    assert.equal(h.videoPreview.hidden, true, "video player state untouched");
    assert.equal(h.videoPreview.style._props.size, 0, "zero styles written to video player");

    // Verify exact live DOM measurement matches 179x426 -> 179x301 -> 179x426 (Big Preview enlarged)
    let area = api.getArea();
    assert.equal(area.visible, true);
    assert.equal(area.sidebarWidth, 179);
    assert.equal(area.rawFreeHeight, 426);
    assert.equal(area.videoPlayerVisible, false);
    assert.equal(tray.getAttribute("data-zw-video-avoiding"), "false");

    // Simulate 16:9 sidebar video player appearing (125px tall) + vertical-tabs flex shrinking
    h.videoPreview.hidden = false;
    h.videoPreview.setRect({ top: 731, width: 179, height: 125 });
    h.verticalTabs.setRect({ top: 132, width: 179, height: 599 });
    area = api.remeasure();
    assert.equal(area.visible, true);
    assert.equal(area.rawFreeHeight, 301);
    assert.equal(area.videoPlayerVisible, true);
    assert.equal(area.videoReservedHeight, 125);
    assert.equal(tray.getAttribute("data-zw-video-avoiding"), "true");
    assert.equal(tray.style.getPropertyValue("--zw-max-height"), Math.floor(301 * 0.45) + "px");

    // Re-measuring again after tray is shown MUST produce the exact same free height (zero feedback loop!)
    tray.setRect({ top: 596, width: 179, height: 135 });
    h.verticalTabs.setRect({ top: 132, width: 179, height: 464 });
    const area2 = api.remeasure();
    assert.equal(area2.rawFreeHeight, 301, "showing tray does not create a shrink feedback loop");
    assert.equal(area2.maxTrayHeight, area.maxTrayHeight);

    // Simulate Big Preview pop-out ([data-enlarged]) -> video no longer occupies sidebar height
    h.videoPreview.setAttribute("data-enlarged", "true");
    area = api.remeasure();
    assert.equal(area.videoPlayerVisible, false);
    assert.equal(area.rawFreeHeight, 426);

    // Fallback check when mediaToolbar & bottomButtons are absent and videoPreview sits right after vertical-tabs:
    h.mediaToolbar.remove();
    h.bottomButtons.remove();
    const target = h.core.chooseWidgetMountTarget(h.document, h.window, h.toolbox);
    assert.equal(target.parent, h.toolbox);
    assert.notEqual(target.before, h.videoPreview, "never wedges between #vertical-tabs and #zentral-video-preview");

    api.destroy();
  });

  await test("room for tabs, folders & Essentials: adding overflowing tabs auto-hides tray and pauses timers", () => {
    const h = createFakeSidebarHarness({
      "zen.workspace.zentral.widgets.enabled": true,
      "zen.workspace.zentral.widgets.clock.enabled": false,
      "zen.workspace.zentral.widgets.date.enabled": false,
    });
    const { api } = h.start();

    let fetches = 0;
    api.registerWidget({
      id: "ticker",
      title: "Ticker",
      refreshMs: 10000,
      create({ document }) {
        const el = document.createElement("div");
        return {
          element: el,
          fetch() { fetches++; return "v" + fetches; },
          render(val) { el.textContent = val || ""; },
        };
      },
    });

    assert.equal(api.getArea().visible, true);
    assert.equal(api.isPaused(), false);
    assert.equal(api.activeTimerCount(), 1);
    assert.equal(fetches, 1);

    // User opens many tabs so tabs overflow the vertical-tabs container
    h.verticalTabs.scrollHeight = 980;
    h.verticalTabs.clientHeight = 724;
    h.fireTab("TabOpen");
    h.flushRaf();

    const area = api.getArea();
    assert.equal(area.visible, false);
    assert.equal(area.reason, "low-free-height");
    assert.equal(api.getTray().hidden, true);
    assert.equal(api.isPaused(), true);
    assert.equal(api.activeTimerCount(), 0, "all refresh timers cleared while hidden");

    // Advance 60 seconds while hidden -> zero background fetches!
    h.advanceTime(60000);
    assert.equal(fetches, 1, "no polling while hidden due to tight space");

    // Close extra tabs -> space returns -> tray reappears and refreshes stale widget
    h.verticalTabs.scrollHeight = 298;
    h.fireTab("TabClose");
    h.flushRaf();
    assert.equal(api.getArea().visible, true);
    assert.equal(api.isPaused(), false);
    assert.equal(fetches, 2, "stale widget refreshes once space returns");

    api.destroy();
  });

  await test("pause when window or sidebar is hidden, cached last value, and error resilience", async () => {
    const h = createFakeSidebarHarness({
      "zen.workspace.zentral.widgets.enabled": true,
      "zen.workspace.zentral.widgets.clock.enabled": false,
      "zen.workspace.zentral.widgets.date.enabled": false,
    });
    const { api } = h.start();

    let failNext = false;
    let calls = 0;
    const renders = [];

    api.registerWidget({
      id: "feed",
      title: "Feed",
      refreshMs: 30000,
      create({ document }) {
        const el = document.createElement("div");
        return {
          element: el,
          async fetch() {
            calls++;
            if (failNext) throw new Error("offline");
            return { text: "headline-" + calls };
          },
          render(value, meta) {
            renders.push({ value, cached: meta.cached, error: Boolean(meta.error) });
            el.textContent = value ? value.text : "empty";
          },
        };
      },
    });

    await Promise.resolve();
    assert.equal(calls, 1);
    assert.deepEqual(api.getCachedValue("feed").value, { text: "headline-1" });
    assert.equal(api.activeTimerCount(), 1);

    // Hide window -> timers immediately paused
    h.document.hidden = true;
    h.fireDoc("visibilitychange");
    h.flushRaf();
    assert.equal(api.isPaused(), true);
    assert.equal(api.activeTimerCount(), 0);

    // Advance 10s (still within 30s cache window!) and unhide window:
    // cached value paints immediately, NO premature refetch, one-shot timer waits remaining 20s!
    h.advanceTime(10000);
    h.document.hidden = false;
    h.fireDoc("visibilitychange");
    h.flushRaf();
    assert.equal(api.isPaused(), false);
    assert.equal(calls, 1, "fresh cache avoids unnecessary refetch on quick resume");
    assert.equal(renders[renders.length - 1].cached, true);
    assert.equal(api.activeTimerCount(), 1);

    // Now advance 20s -> triggers next refresh, which fails -> preserves cached last value!
    failNext = true;
    h.advanceTime(20000);
    await Promise.resolve();
    assert.equal(calls, 2);
    assert.deepEqual(api.getCachedValue("feed").value, { text: "headline-1" }, "transient error preserves last good cached value");
    assert.equal(renders[renders.length - 1].error, true);
    assert.deepEqual(renders[renders.length - 1].value, { text: "headline-1" });

    // Zen compact mode hides sidebar -> pauses immediately
    h.docRoot.setAttribute("zen-compact-mode", "true");
    api.remeasure();
    assert.equal(api.getArea().reason, "sidebar-hidden");
    assert.equal(api.isPaused(), true);
    assert.equal(api.activeTimerCount(), 0);

    // Compact sidebar revealed -> resumes
    failNext = false;
    h.advanceTime(40000);
    h.docRoot.setAttribute("zen-compact-sidebar-visible", "true");
    api.remeasure();
    await Promise.resolve();
    assert.equal(api.getArea().visible, true);
    assert.equal(calls, 3);
    assert.deepEqual(api.getCachedValue("feed").value, { text: "headline-3" });

    api.destroy();
  });

  await test("per-widget on/off (dedicated pref & disabled_ids), ordering, and zero-leak destroy", () => {
    // Every built-in card is switched off here so the "no widgets left" state below is about this test's own cards;
    // the built-in cards are exercised by their own files.
    const h = createFakeSidebarHarness({
      "zen.workspace.zentral.widgets.enabled": true,
      "zen.workspace.zentral.widgets.clock.enabled": false,
      "zen.workspace.zentral.widgets.date.enabled": false,
      "zen.workspace.zentral.widgets.weather.enabled": false,
      "zen.workspace.zentral.widgets.boost.enabled": false,
      "zen.workspace.zentral.widgets.alpha.enabled": true,
    });
    const { api } = h.start();

    let alphaDisposed = 0;
    let betaRenders = [];

    api.registerWidget({
      id: "beta",
      title: "Beta",
      order: 20,
      refreshMs: 60000,
      create({ document }) {
        const el = document.createElement("div");
        return {
          element: el,
          fetch() { return "beta-val"; },
          render(v, meta) { betaRenders.push({ v, cached: meta.cached }); el.textContent = v || ""; },
        };
      },
    });

    api.registerWidget({
      id: "alpha",
      title: "Alpha",
      order: 10,
      pref: "zen.workspace.zentral.widgets.alpha.enabled",
      refreshMs: 15000,
      create({ document }) {
        const el = document.createElement("div");
        return {
          element: el,
          fetch() { return "alpha-val"; },
          render(v) { el.textContent = v || ""; },
          dispose() { alphaDisposed++; },
        };
      },
    });

    // Order is strictly sorted (alpha=10 before beta=20)
    const tray = api.getTray();
    assert.deepEqual(
      tray.children.map((c) => c.getAttribute("data-zw-widget")),
      ["alpha", "beta"],
    );

    // Turn off alpha via its dedicated pref -> unmounts and calls dispose()
    api.setWidgetEnabled("alpha", false);
    assert.equal(h.prefs.get("zen.workspace.zentral.widgets.alpha.enabled"), false);
    assert.equal(alphaDisposed, 1);
    assert.deepEqual(
      tray.children.map((c) => c.getAttribute("data-zw-widget")),
      ["beta"],
    );

    // Turn off beta via generic disabled_ids -> tray has 0 active widgets and hides automatically
    api.setWidgetEnabled("beta", false);
    assert.equal(h.prefs.get("zen.workspace.zentral.widgets.disabled_ids"), "beta");
    assert.equal(api.getArea().visible, false);
    assert.equal(api.getArea().reason, "no-widgets");
    assert.equal(tray.hidden, true);
    assert.equal(api.activeTimerCount(), 0);

    // Re-enable beta -> cached value paints immediately without flicker!
    const beforeLen = betaRenders.length;
    api.setWidgetEnabled("beta", true);
    assert.equal(api.getArea().visible, true);
    assert.equal(betaRenders[beforeLen].cached, true);
    assert.equal(betaRenders[beforeLen].v, "beta-val");

    // Full destroy leaves ZERO leaked timers, observers, listeners, or DOM nodes
    api.destroy();
    assert.equal(h.document.getElementById("zentral-sidebar-widgets"), null);
    assert.equal(h.window.ZentralRuntime.services.widgets, undefined);
    assert.deepEqual(h.counts(), {
      timers: 0,
      rafs: 0,
      prefObservers: 0,
      winListeners: 0,
      docListeners: 0,
      tabListeners: 0,
      liveMutationObservers: 0,
      liveResizeObservers: 0,
    });
  });

  await test("real Zen 1.24.1b sidebar DOM: skips hidden Firefox #vertical-tabs, measures #tabbrowser-tabs & .zen-workspace-empty-space without flicker", () => {
    const h = createFakeSidebarHarness({ "zen.workspace.zentral.widgets.enabled": true });
    const { document, window, core } = h;
    const setRect = (el, { left = 2389, top = 78, width = 166, height = 0 } = {}) => {
      el._rect = { left, top, width, height, right: left + width, bottom: top + height };
      el.getBoundingClientRect = () => el._rect;
    };
    const setStyle = (el, st) => {
      el._computedStyle = { display: "flex", visibility: "visible", position: "static", paddingTop: "0px", paddingBottom: "0px", paddingLeft: "0px", paddingRight: "0px", marginTop: "0px", marginBottom: "0px", ...st };
    };
    const origGetCS = window.getComputedStyle;
    window.getComputedStyle = (el) => el?._computedStyle || origGetCS(el);

    // Clear default harness children so we build the EXACT Zen 1.24.1b hierarchy
    for (const c of [...document.documentElement.children]) c.remove();

    // 1. Firefox's hidden legacy #vertical-tabs stub (display: none, 0x0)
    const sidebarMain = document.createElement("sidebar-main");
    const legacyVerticalTabs = document.createElement("box");
    legacyVerticalTabs.id = "vertical-tabs";
    setRect(legacyVerticalTabs, { left: 0, top: 0, width: 0, height: 0 });
    setStyle(legacyVerticalTabs, { display: "none" });
    sidebarMain.appendChild(legacyVerticalTabs);
    document.documentElement.appendChild(sidebarMain);

    // 2. Real Zen sidebar: hbox#TabsToolbar-customization-target (166x1310)
    const target = document.createElement("hbox");
    target.id = "TabsToolbar-customization-target";
    setRect(target, { left: 2389, top: 78, width: 166, height: 1310 });
    setStyle(target, { display: "flex", flexDirection: "column" });
    document.documentElement.appendChild(target);

    const tabbrowserTabs = document.createElement("tabs");
    tabbrowserTabs.id = "tabbrowser-tabs";
    setRect(tabbrowserTabs, { left: 2389, top: 78, width: 166, height: 1283 });
    setStyle(tabbrowserTabs, { display: "flex", flexDirection: "column" });

    const tabsWrapper = document.createElement("div");
    tabsWrapper.id = "zen-tabs-wrapper";
    tabsWrapper.clientHeight = 1282;
    tabsWrapper.scrollHeight = 1282;
    setRect(tabsWrapper, { left: 2384, top: 78, width: 176, height: 1282 });
    setStyle(tabsWrapper, { display: "block" });

    const arrowBox = document.createElement("arrowscrollbox");
    arrowBox.id = "tabbrowser-arrowscrollbox";
    arrowBox.clientHeight = 1282;
    arrowBox.scrollHeight = 1282;
    setRect(arrowBox, { left: 2384, top: 78, width: 176, height: 1282 });
    setStyle(arrowBox, { display: "flex" });

    // Active Zen workspace with 279px of tabs + 1004px of vbox.zen-workspace-empty-space
    const activeWs = document.createElement("zen-workspace");
    activeWs.setAttribute("active", "true");
    setRect(activeWs, { left: 2389, top: 78, width: 166, height: 1282 });
    setStyle(activeWs, { display: "flex", flexDirection: "column" });

    const normalSec = document.createElement("vbox");
    normalSec.className = "zen-workspace-normal-tabs-section";
    const tab1 = document.createElement("tab");
    setRect(tab1, { left: 2389, top: 78, width: 166, height: 36 });
    setStyle(tab1, { display: "flex" });
    const emptySpace = document.createElement("vbox");
    emptySpace.className = "zen-workspace-empty-space";
    setRect(emptySpace, { left: 2384, top: 357, width: 176, height: 1004 });
    setStyle(emptySpace, { display: "flex" });
    normalSec.appendChild(tab1);
    normalSec.appendChild(emptySpace);
    activeWs.appendChild(normalSec);

    // Inactive workspace slid off-screen horizontally with overflowing tall tab (must be ignored!)
    const inactiveWs = document.createElement("zen-workspace");
    setRect(inactiveWs, { left: 2600, top: 78, width: 166, height: 1282 });
    setStyle(inactiveWs, { display: "flex" });
    const offTab = document.createElement("tab");
    setRect(offTab, { left: 2600, top: 1250, width: 166, height: 40 });
    setStyle(offTab, { display: "flex" });
    inactiveWs.appendChild(offTab);

    arrowBox.appendChild(activeWs);
    arrowBox.appendChild(inactiveWs);
    tabsWrapper.appendChild(arrowBox);
    tabbrowserTabs.appendChild(tabsWrapper);

    // Hidden #zen-media-controls-toolbar + 26px #zentral-video-preview + toolbarspring
    const media = document.createElement("toolbar");
    media.id = "zen-media-controls-toolbar";
    media.hidden = true;
    setRect(media, { left: 0, top: 0, width: 0, height: 0 });
    setStyle(media, { display: "none" });

    const video = document.createElement("div");
    video.id = "zentral-video-preview";
    setRect(video, { left: 2389, top: 1361, width: 166, height: 26 });
    setStyle(video, { display: "flex" });

    const spring = document.createElement("toolbarspring");
    setRect(spring, { left: 2389, top: 1387, width: 166, height: 1 });
    setStyle(spring, { display: "flex" });

    target.appendChild(tabbrowserTabs);
    target.appendChild(media);
    target.appendChild(video);
    target.appendChild(spring);

    // 1. resolveTabsHost MUST pick visible #tabbrowser-tabs and ignore hidden #vertical-tabs
    assert.equal(core.resolveTabsHost(document, window, target), tabbrowserTabs);

    // 2. Start widgets shell -> mounts before #zen-media-controls-toolbar, becomes VISIBLE!
    const { api } = h.start();
    const tray = api.getTray();
    assert.equal(tray.parentNode, target, "mounted inside hbox#TabsToolbar-customization-target");
    assert.equal(video.previousSibling, media, "#zentral-video-preview anchor untouched");

    const area1 = api.getArea();
    assert.equal(area1.visible, true, "widgets tray MUST be visible with 1004px of Zen empty space");
    assert.equal(area1.reason, "visible");
    assert.equal(area1.sidebarWidth, 166);
    assert.equal(area1.sidebarHeight, 1310);
    assert.equal(area1.otherChromeHeight, 0, "#tabbrowser-tabs and toolbarspring not counted as chrome");
    assert.equal(area1.videoReservedHeight, 26);
    assert.equal(area1.tabsContentHeight, 279, "occupied tabs height = 1283 - 1004 = 279px");
    assert.equal(area1.rawFreeHeight, 1005, "free height = 1310 - 0 - 26 - 279 = 1005px");
    assert.equal(area1.maxTrayHeight, Math.floor(1005 * 0.45));
    assert.equal(area1.density, "compact");
    assert.equal(tray.hidden, false);

    // 3. Simulate flex layout AFTER tray opens at 130px:
    //    #tabbrowser-tabs shrinks 1283 -> 1153, .zen-workspace-empty-space shrinks 1004 -> 874.
    //    Remeasuring MUST yield the EXACT SAME tabsContentHeight (279) and rawFreeHeight (1005) — ZERO flicker!
    setRect(tabbrowserTabs, { left: 2389, top: 78, width: 166, height: 1153 });
    setRect(tabsWrapper, { left: 2384, top: 78, width: 176, height: 1152 });
    tabsWrapper.clientHeight = 1152;
    tabsWrapper.scrollHeight = 1152;
    setRect(emptySpace, { left: 2384, top: 357, width: 176, height: 874 });
    api.remeasure();
    const area2 = api.getArea();
    assert.equal(area2.visible, true);
    assert.equal(area2.tabsContentHeight, 279, "invariant occupied tabs height after tray opens");
    assert.equal(area2.rawFreeHeight, 1005, "invariant free height -> zero shrink/hide flicker");

    // 4. Simulate many tabs filling & overflowing #zen-tabs-wrapper (emptySpace collapses to 0, scrollHeight > clientHeight)
    setRect(emptySpace, { left: 2384, top: 1360, width: 176, height: 0 });
    tabsWrapper.scrollHeight = 1650;
    api.remeasure();
    const areaOverflow = api.getArea();
    assert.equal(areaOverflow.visible, false, "auto-hides when Zen tabs overflow");
    assert.equal(areaOverflow.reason, "low-free-height");
    assert.equal(tray.hidden, true);

    api.destroy();
  });

  console.log(`\nPASS widgets-shell (${passed} tests)`);
})();
