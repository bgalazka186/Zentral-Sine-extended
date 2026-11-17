"use strict";
/**
 * OW-40: Real Zen 1.24.1b+ sidebar DOM guardrails & regression test matrix.
 *
 * Prevents hidden-stub / DOM-mismatch oversights like the 3.3.237 bug where
 * Firefox's unused `box#vertical-tabs` (`display: none; 0x0`) shadowed Zen's
 * real `tabs#tabbrowser-tabs` inside `hbox#TabsToolbar-customization-target`.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRealZenSidebarHarness } = require("./helpers/real-zen-sidebar-dom.cjs");

const root = path.resolve(__dirname, "..");
const widgetSrc = fs.readFileSync(
  path.join(root, "additional/widgets/ZentralWidgets.uc.js"),
  "utf8",
);
const settingsShellSrc = fs.readFileSync(
  path.join(root, "extension/settings/controllers/ZentralSettingsShell.js"),
  "utf8",
);
const panelHoverSrc = fs.readFileSync(
  path.join(root, "extension/panels/interaction/ZentralPanelHover.js"),
  "utf8",
);

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

function walkJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "upstream" ||
        entry.name === "node_modules" ||
        entry.name === ".git"
      ) {
        continue;
      }
      walkJsFiles(full, out);
    } else if (
      (entry.name.endsWith(".js") || entry.name.endsWith(".uc.js")) &&
      !entry.name.endsWith(".standalone.uc.js")
    ) {
      out.push(full);
    }
  }
  return out;
}

function bootWidgets(harness) {
  let registered = null;
  const ZentralRuntime = {
    services: {},
    register(def) {
      registered = def;
    },
  };
  const ctx = vm.createContext({
    window: harness.win,
    document: harness.doc,
    Services: harness.Services,
    gBrowser: harness.win.gBrowser,
    gNavToolbox: harness.win.gNavToolbox,
    MutationObserver: harness.win.MutationObserver,
    ResizeObserver: harness.win.ResizeObserver,
    getComputedStyle: harness.win.getComputedStyle.bind(harness.win),
    setTimeout: harness.win.setTimeout.bind(harness.win),
    clearTimeout: harness.win.clearTimeout.bind(harness.win),
    requestAnimationFrame: harness.win.requestAnimationFrame.bind(harness.win),
    cancelAnimationFrame: harness.win.cancelAnimationFrame.bind(harness.win),
    ZentralRuntime,
    console,
    Date,
    Intl,
    Math,
    Map,
    Set,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Promise,
    Error,
    RegExp,
    JSON,
    Symbol,
    URL,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
  });
  harness.win.ZentralRuntime = ZentralRuntime;
  vm.runInContext(widgetSrc, ctx, { filename: "ZentralWidgets.uc.js" });
  assert.ok(registered && typeof registered.init === "function", "widgets should register");
  const cleanups = [];
  const dispose = registered.init({
    lifecycle: { addCleanup: (fn) => cleanups.push(fn) },
  });
  const api = harness.win.ZentralWidgets;
  assert.ok(api, "window.ZentralWidgets should be mounted");
  return {
    api,
    core: api.core,
    dispose() {
      if (typeof dispose === "function") dispose();
      for (const fn of cleanups.splice(0).reverse()) fn();
    },
  };
}

(async () => {
  await test("1. Static repo guardrail: no unguarded getElementById('vertical-tabs') || short-circuit", () => {
    const scanDirs = ["additional", "extension", "loader", "zentral"];
    const files = scanDirs.flatMap((d) => walkJsFiles(path.join(root, d)));
    assert.ok(files.length > 20, "expected to scan repo JS files");

    const violations = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      const rel = path.relative(root, file);
      // Flag any `getElementById("vertical-tabs") ||` or `getElementById('vertical-tabs') ||`
      // that blindly short-circuits onto Firefox's hidden #vertical-tabs stub without a visibility check.
      const unguardedOr =
        /getElementById\(\s*["']vertical-tabs["']\s*\)\s*\|\|/g;
      let m;
      while ((m = unguardedOr.exec(src)) !== null) {
        const line = src.slice(0, m.index).split("\n").length;
        violations.push(`${rel}:${line} unguarded getElementById("vertical-tabs") ||`);
      }

      // Flag `:hover` checks on `#vertical-tabs` that ignore `#tabbrowser-tabs` / `#navigator-toolbox`
      const hoverRe = /getElementById\(\s*["']vertical-tabs["']\s*\)\?\.matches\(\s*["']:hover["']\s*\)/g;
      while ((m = hoverRe.exec(src)) !== null) {
        const start = Math.max(0, m.index - 400);
        const end = Math.min(src.length, m.index + 400);
        const snippet = src.slice(start, end);
        if (!snippet.includes("tabbrowser-tabs") && !snippet.includes("navigator-toolbox")) {
          const line = src.slice(0, m.index).split("\n").length;
          violations.push(
            `${rel}:${line} #vertical-tabs :hover check without #tabbrowser-tabs/#navigator-toolbox`,
          );
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Found hidden-#vertical-tabs guardrail violations:\n${violations.join("\n")}`,
    );
  });

  await test("2. Real Zen 1.24.1b DOM: widgets ignore hidden #vertical-tabs & #sidebar-box stubs and stay visible", () => {
    const h = createRealZenSidebarHarness({
      prefs: { "zen.workspace.zentral.widgets.enabled": true },
      sidebarWidth: 166,
      sidebarHeight: 1310,
      activeOccupiedHeight: 279,
      videoVisible: true,
      videoHeight: 26,
    });

    // Confirm both hidden Firefox stubs exist right in the DOM
    assert.ok(h.doc.getElementById("vertical-tabs"), "hidden #vertical-tabs stub must exist");
    assert.ok(h.doc.getElementById("sidebar-box"), "hidden #sidebar-box stub must exist");
    assert.equal(
      h.win.getComputedStyle(h.doc.getElementById("vertical-tabs")).display,
      "none",
    );

    const { api, core, dispose } = bootWidgets(h);
    try {
      const resolved = core.resolveTabsHost(h.doc, h.win, h.elements.customTarget);
      assert.ok(resolved === h.elements.tabbrowserTabs, "resolveTabsHost must pick visible #tabbrowser-tabs");

      const area = api.getArea();
      assert.equal(area.visible, true, `widgets must be visible (got reason=${area.reason})`);
      assert.equal(area.reason, "visible");
      assert.equal(area.sidebarWidth, 166);
      assert.ok(area.rawFreeHeight >= 990 && area.rawFreeHeight <= 1020, `expected ~1005px free, got ${area.rawFreeHeight}`);
      assert.ok(api.getTray()?.parentNode === h.elements.customTarget, "tray must mount inside #TabsToolbar-customization-target");
      assert.equal(api.getTray().hidden, false);

      // Post-open flex shrink invariance: opening tray shrinks #tabbrowser-tabs and .zen-workspace-empty-space by 148px
      h.setTrayRenderedHeight(148);
      api.remeasure();
      const after = api.getArea();
      assert.equal(after.visible, true, "tray must stay visible after flex shrink (no flicker loop)");
      assert.equal(after.rawFreeHeight, area.rawFreeHeight, "rawFreeHeight must stay invariant after tray opens");
      assert.equal(after.maxTrayHeight, area.maxTrayHeight, "maxTrayHeight must stay invariant after tray opens");
    } finally {
      dispose();
    }
  });

  await test("3. Real Zen 1.24.1b DOM: off-screen inactive workspace ignored; switching active workspace updates live", () => {
    const h = createRealZenSidebarHarness({
      prefs: { "zen.workspace.zentral.widgets.enabled": true },
      sidebarWidth: 166,
      sidebarHeight: 1310,
      activeOccupiedHeight: 279,
      inactiveOccupiedHeight: 1260,
    });
    const { api, dispose } = bootWidgets(h);
    try {
      // Workspace 0 active (279px occupied), Workspace 1 off-screen & overflowing (1260px)
      assert.equal(api.getArea().visible, true, "active spacious workspace must show widgets despite crowded inactive ws1");

      // Switch to crowded overflowing workspace 1
      h.switchWorkspace(1);
      h.advanceMs(100);
      assert.equal(api.getArea().visible, false, "switching to crowded overflowing workspace must hide widgets");
      assert.equal(api.getTray().hidden, true);

      // Switch back to spacious workspace 0
      h.switchWorkspace(0);
      h.advanceMs(100);
      assert.equal(api.getArea().visible, true, "switching back to spacious workspace must restore widgets");
      assert.equal(api.getTray().hidden, false);
    } finally {
      dispose();
    }
  });

  await test("4. Real Zen 1.24.1b DOM: video preview anchor untouched, dynamic height avoided & reclaimed on enlarge", () => {
    const h = createRealZenSidebarHarness({
      prefs: { "zen.workspace.zentral.widgets.enabled": true },
      sidebarWidth: 166,
      sidebarHeight: 700,
      activeOccupiedHeight: 240,
      videoVisible: true,
      videoHeight: 26,
    });
    const { api, dispose } = bootWidgets(h);
    try {
      assert.ok(
        h.elements.videoPreview.previousSibling === h.elements.mediaControls,
        "#zentral-video-preview must remain immediately after #zen-media-controls-toolbar",
      );
      const baseArea = api.getArea();
      assert.equal(baseArea.visible, true);

      // Video expands to 125px (e.g. 16:9 preview playing)
      h.setVideoPreview({ visible: true, height: 125, enlarged: false });
      h.advanceMs(100);
      const withVideo = api.getArea();
      assert.equal(withVideo.visible, true);
      assert.ok(
        withVideo.rawFreeHeight < baseArea.rawFreeHeight,
        `expected free height to decrease when video opens (${withVideo.rawFreeHeight} vs ${baseArea.rawFreeHeight})`,
      );
      assert.ok(
        h.elements.videoPreview.previousSibling === h.elements.mediaControls,
        "video anchor must stay untouched after resize",
      );

      // Video enlarges out of sidebar -> widgets reclaim full height
      h.setVideoPreview({ visible: true, height: 125, enlarged: true });
      h.advanceMs(100);
      const enlarged = api.getArea();
      assert.ok(
        enlarged.rawFreeHeight > withVideo.rawFreeHeight,
        "enlarged video preview must return height to sidebar widgets",
      );
    } finally {
      dispose();
    }
  });

  await test("5. Real Zen 1.24.1b DOM: width thresholds (wide 490px, narrow 110px), overflow, and sidebar collapse", () => {
    const h = createRealZenSidebarHarness({
      prefs: { "zen.workspace.zentral.widgets.enabled": true },
      sidebarWidth: 490,
      sidebarHeight: 1310,
      activeOccupiedHeight: 279,
    });
    const { api, dispose } = bootWidgets(h);
    try {
      assert.equal(api.getArea().visible, true, "wide 490px sidebar must show widgets");
      assert.equal(api.getArea().sidebarWidth, 490);

      // Narrow below min_sidebar_width (default 140)
      h.setSidebarWidth(110);
      h.advanceMs(100);
      assert.equal(api.getArea().visible, false, "narrow 110px sidebar must hide widgets");
      assert.equal(api.getArea().reason, "narrow-sidebar");

      // Restore width -> visible again
      h.setSidebarWidth(166);
      h.advanceMs(100);
      assert.equal(api.getArea().visible, true);

      // Overflow active workspace -> hides cleanly
      h.setOverflow(0, true);
      h.advanceMs(100);
      assert.equal(api.getArea().visible, false, "overflowing active workspace must hide widgets");

      // Clear overflow -> visible again
      h.setOverflow(0, false);
      h.advanceMs(100);
      assert.equal(api.getArea().visible, true);

      // Collapse Zen sidebar -> hides & pauses timers
      h.setSidebarCollapsed(true);
      h.advanceMs(100);
      assert.equal(api.getArea().visible, false, "collapsed sidebar must hide widgets");
      assert.equal(api.isPaused(), true, "collapsed sidebar must pause widget refresh timers");

      // Expand sidebar -> resumes
      h.setSidebarCollapsed(false);
      h.advanceMs(100);
      assert.equal(api.getArea().visible, true);
      assert.equal(api.isPaused(), false);
    } finally {
      dispose();
    }
  });

  await test("6. Alternate Firefox/alt-Zen layout where #vertical-tabs IS visible still works", () => {
    const h = createRealZenSidebarHarness({
      prefs: { "zen.workspace.zentral.widgets.enabled": true },
      sidebarWidth: 180,
      sidebarHeight: 900,
      activeOccupiedHeight: 240,
      includeVideoPreview: false,
    });
    h.toggleAltFirefoxVerticalTabs(true);
    const { api, core, dispose } = bootWidgets(h);
    try {
      const resolved = core.resolveTabsHost(h.doc, h.win, h.elements.tabsToolbar);
      assert.ok(resolved, "resolveTabsHost must find visible tabs host in alt Firefox layout");
      assert.equal(api.getArea().visible, true, "widgets must remain visible in alt visible-#vertical-tabs layout");
    } finally {
      dispose();
    }
  });

  await test("7. ZentralSettingsShell.updatePosition fallback skips hidden #sidebar-box & #vertical-tabs stubs", () => {
    const h = createRealZenSidebarHarness({
      sidebarWidth: 166,
      sidebarHeight: 1310,
      windowWidth: 2000,
      windowHeight: 1380,
    });
    // Extract updatePosition body and verify live behavior without ZentralRuntime.sidebarSafeBounds
    const modal = h.doc.createElement("div");
    modal.id = "zentral-settings-modal";
    h.doc.documentElement.appendChild(modal);

    const startIdx = settingsShellSrc.indexOf("updatePosition() {");
    assert.ok(startIdx > 0, "expected updatePosition in ZentralSettingsShell.js");
    // Find matching closing brace for updatePosition method
    let depth = 0;
    let endIdx = -1;
    for (let i = settingsShellSrc.indexOf("{", startIdx); i < settingsShellSrc.length; i++) {
      const ch = settingsShellSrc[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    assert.ok(endIdx > startIdx, "could not slice updatePosition()");
    const methodSrc = settingsShellSrc.slice(startIdx, endIdx);
    const runner = vm.runInNewContext(`({ ${methodSrc} })`, {
      window: h.win,
      document: h.doc,
      Math,
      Number,
    });
    runner.modal = modal;
    runner.updatePosition();

    // Must position beside visible 166px Zen #navigator-toolbox, NOT ignore sidebar because #sidebar-box/#vertical-tabs are hidden
    assert.equal(modal.style.left, "166px", "settings modal must offset past Zen visible 166px sidebar");
    assert.equal(modal.style.width, "1834px", "settings modal width must fill remaining window width");
  });

  await test("8. ZentralPanelHover covers #tabbrowser-tabs & #navigator-toolbox alongside #vertical-tabs", () => {
    assert.ok(
      panelHoverSrc.includes('document.getElementById("tabbrowser-tabs")?.matches(":hover")') &&
        panelHoverSrc.includes('document.getElementById("navigator-toolbox")?.matches(":hover")'),
      "isSidebarHoverSurfaceHovered must check #tabbrowser-tabs and #navigator-toolbox",
    );
    assert.ok(
      panelHoverSrc.includes("#navigator-toolbox, #tabbrowser-tabs, #sidebar-box"),
      "relatedTarget.closest sidebar check must include #navigator-toolbox and #tabbrowser-tabs",
    );
  });

  console.log(`\n${passed} Zen sidebar DOM guardrail tests passed.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
