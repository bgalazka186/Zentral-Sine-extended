/*
 * ZENTRAL FILE GUIDE - features/settings/controllers/ZentralFeatureSettings.js
 *
 * Purpose: Builds extended feature controls and look controls, associates them with category metadata and
 *   synchronizes preference changes/imports.
 * Interaction / execution: Optional feature-settings factory registers extension-settings as a generator
 *   part. ZentralPanels resumes it; uses SettingsRows builders, Appearance rules and optional Backup
 *   controls; Runtime organizes/routes categories.
 * Ownership / failure: Preparation publishes injectSettingsUI/syncSettingsAfterImport; UI injection
 *   requires the Shell modal. Missing settings is optional for panels. Do not split individual controls
 *   into files until their feature-state contract is explicit.
 * Registration: feature-settings; extension-settings
 * Loaded/created by: core/ZentralRuntime.js
 * Direct local resource paths: features/appearance/ZentralAppearance.js; features/settings/controllers/ZentralBackup.js;
 *   features/settings/controllers/ZentralSettingsRows.js
 * Constructed factory IDs: appearance; settings-backup; settings-rows
 * Published lazy ctx API: injectSettingsUI; syncSettingsAfterImport
 * Shared ctx symbols used: BGALAZKA_EXT_PREFS; EXT_KEYBIND_ACTIONS; EXT_KEYBIND_DEFAULTS; EXT_PREFS;
 *   PREF_ICONS; QUICK_SWITCH_BUILTIN_TARGETS; QUICK_SWITCH_CUSTOM_PREFS; QUICK_SWITCH_TARGET_PREF_PREFIX;
 *   SEARCH_CUSTOM_ENGINE_PREFS; applyHorizontalPanelOffset; applyVerticalResizeExtras;
 *   cachedHorizontalOffset; ensureNativeAudioButton; ensurePillAllSidesResizeButton; findAddonHostFolder;
 *   getAppliedHorizontalOffset; getHorizontalOffsetBounds; getHorizontalOffsetPreference; getPref;
 *   isValidQuickSwitchTemplate; keepAddonHostFolderCollapsed; parseSVG; refreshBrowserSearchTemplate;
 *   refreshPanelAudio; registerCleanup; requestTileSync; restartBrowser; setAddonTabIdBridgeEnabled;
 *   setPref; setZenInternetPanelCssEnabled; startWebToolbarPolling; syncHoverPanelAvailability;
 *   syncPanelFallbackPolling; syncSecondaryFallbackPolling; updateAddonHostInspection; updateCSSVars;
 *   updateWebToolbarState
 * Cross-file calls / ctx suppliers: features/panels/browsers/ZentralBrowserIntegrations.uc.js -> ctx.findAddonHostFolder,
 *   ctx.keepAddonHostFolderCollapsed, ctx.setAddonTabIdBridgeEnabled, ctx.updateAddonHostInspection;
 *   features/panels/corner-tiles/ZentralCornerPanels.uc.js -> ctx.requestTileSync; features/panels/geometry/ZentralPanelGeometry.uc.js ->
 *   ctx.applyHorizontalPanelOffset, ctx.applyVerticalResizeExtras, ctx.cachedHorizontalOffset,
 *   ctx.getAppliedHorizontalOffset, ctx.getHorizontalOffsetBounds, ctx.getHorizontalOffsetPreference;
 *   features/panels/styling/ZentralPanelStyles.uc.js -> ctx.setZenInternetPanelCssEnabled; features/panels/navigation/ZentralPanelToolbar.uc.js ->
 *   ctx.QUICK_SWITCH_BUILTIN_TARGETS, ctx.QUICK_SWITCH_CUSTOM_PREFS, ctx.QUICK_SWITCH_TARGET_PREF_PREFIX,
 *   ctx.SEARCH_CUSTOM_ENGINE_PREFS, ctx.isValidQuickSwitchTemplate, ctx.refreshBrowserSearchTemplate,
 *   ctx.startWebToolbarPolling, ctx.syncSecondaryFallbackPolling, ctx.updateWebToolbarState;
 *   features/panels/ZentralPanels.uc.js -> ctx.BGALAZKA_EXT_PREFS, ctx.EXT_KEYBIND_ACTIONS, ctx.EXT_KEYBIND_DEFAULTS,
 *   ctx.EXT_PREFS, ctx.PREF_ICONS, ctx.ensureNativeAudioButton, ctx.ensurePillAllSidesResizeButton,
 *   ctx.getPref, ctx.parseSVG, ctx.refreshPanelAudio, ctx.registerCleanup, ctx.restartBrowser, ctx.setPref,
 *   ctx.syncHoverPanelAvailability, ctx.syncPanelFallbackPolling, ctx.updateCSSVars
 * Contract fields assigned here: ctx.cachedHorizontalOffset
 * Literal DOM event subscriptions: change; click; input
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("feature-settings", function ({ Services, ZentralRuntime, Core, Settings, Constants, organizeNativeSettings, validPanelBackingSteps, SETTINGS_SCHEMA, SETTINGS_ORGANIZATION, selectSettingsCategory, arcSidebarPref, arcLibraryPref }) {
  // Feature: extension-settings. Imports and exports are listed in ARCHITECTURE.md.
  // Preparation publishes functions; activation preserves the baseline initialization order.
  ZentralRuntime.registerPart("extension-settings", function* (ctx) {
    Object.defineProperties(ctx, {
      injectSettingsUI: { configurable: true, get: () => injectSettingsUI },
      syncSettingsAfterImport: {
        configurable: true,
        get: () => syncChangedSetting,
      },
    });
    yield;
    window.ZentralModuleLoader.load("features/settings/controllers/ZentralSettingsRows.js", { owner: "settings" });
    const { createKeybindRow, createToggleRow, createSelectRow, createTextRow, createSliderRow, createColorRow } = window.ZentralModuleLoader.create("settings-rows", { ctx, validPanelBackingSteps });
    window.ZentralModuleLoader.load("features/appearance/ZentralAppearance.js", { owner: "appearance" });
    const { LOOK_GROUP_PREFS, LOOK_PREFS, LOOK_DEFAULTS, LOOK_THEMES, LOOK_KEYS, LOOK_TRANSPARENCY_KEYS, LOOK_COLORS, LOOK_ENUMS, LOOK_BOUNDS, applyLook, syncChangedSetting, syncAppearanceAfterImport } = window.ZentralModuleLoader.create("appearance", { ctx, Services });
    const backupAvailable = window.ZentralModuleLoader.load("features/settings/controllers/ZentralBackup.js", { optional: true, owner: "settings-backup" });
    const { addLookBackupControls } = backupAvailable
      ? window.ZentralModuleLoader.create("settings-backup", { ctx, Services, SETTINGS_SCHEMA, LOOK_PREFS, LOOK_DEFAULTS, LOOK_KEYS, LOOK_COLORS, LOOK_ENUMS, LOOK_BOUNDS, LOOK_GROUP_PREFS, syncAppearanceAfterImport }, { optional: true }) || { addLookBackupControls() {} }
      : { addLookBackupControls() {} };
    const syncRssFolderDisplay = () =>
      window.ZentralRuntime.services.rss?.refresh();

    function injectSettingsUI() {
      const modal = document.getElementById("zentral-settings-modal");
      if (!modal) return;
      const tabBar = modal.querySelector(".zs-tab-bar");
      const body = modal.querySelector(".zs-body");
      if (!tabBar || !body) return;

      let tabBtn = modal.querySelector("#zs-tab-btn-bgalazka");
      let panel = modal.querySelector("#zs-panel-bgalazka");

      if (!panel) {
        panel = document.createElement("div");
        panel.id = "zs-panel-bgalazka";
        panel.className = "zs-tab-panel";
        panel.setAttribute("data-panel", "bgalazka");

        const header = document.createElement("div");
        header.className = "zs-section-header";

        const titleGroup = document.createElement("div");
        titleGroup.className = "zs-title-group";

        const title = document.createElement("h3");
        title.className = "zs-section-title";
        title.textContent = "Panel & Apps";

        const badge = document.createElement("span");
        badge.className = "zs-version-badge";
        badge.textContent = "Bgalazka extension";

        titleGroup.appendChild(title);
        titleGroup.appendChild(badge);

        const restartBtn = document.createElement("button");
        restartBtn.className = "zs-restart-btn";
        restartBtn.id = "zs-bg-restart-btn";
        restartBtn.type = "button";
        restartBtn.title =
          "Restart Zen Browser immediately to reload scripts and reset cache";

        const restartSvg = ctx.parseSVG(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;"><path d="M13.8 6.5A5.5 5.5 0 1 0 8 13.5a5.5 5.5 0 0 0 5.2-3.7M14 2v4.5H9.5"/></svg>`,
        );
        const restartText = document.createElement("span");
        restartText.textContent = "Restart Browser";
        restartText.style.pointerEvents = "none";

        restartBtn.appendChild(restartSvg);
        restartBtn.appendChild(restartText);
        restartBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ctx.restartBrowser();
        });

        header.appendChild(titleGroup);
        header.appendChild(restartBtn);
        panel.appendChild(header);

        const content = document.createElement("div");
        content.className = "zs-section-content";
        content.style.paddingTop = "14px";
        panel._toggles = [];
        const blackOpacity = createSliderRow(
          "Black backing opacity", "0% removes the black backing; 100% makes it solid. Changes apply immediately.",
          ctx.BGALAZKA_EXT_PREFS.PANEL_BLACK_OPACITY, 0, 100, 0, "%",
        );
        const blackSteps = createTextRow(
          "Pill backing cycle levels", "Comma-separated whole percentages from 0 to 100. The pill button cycles through these values in ascending order.",
          ctx.BGALAZKA_EXT_PREFS.PANEL_BLACK_STEPS, "0,1,5,10,20,30,40,50,60,70,80,90,100",
        );
        blackSteps.input.value = ctx.getPref(ctx.BGALAZKA_EXT_PREFS.PANEL_BLACK_STEPS,
          "0,1,5,10,20,30,40,50,60,70,80,90,100");
        content.append(blackOpacity.row, blackSteps.row);
        panel._syncBacking = () => {
          blackOpacity.input.value = ctx.getPref(ctx.BGALAZKA_EXT_PREFS.PANEL_BLACK_OPACITY, 0);
          blackOpacity.badge.textContent = blackOpacity.input.value + "%";
          blackSteps.input.value = ctx.getPref(ctx.BGALAZKA_EXT_PREFS.PANEL_BLACK_STEPS,
            "0,1,5,10,20,30,40,50,60,70,80,90,100");
        };

        // ====================================================================
        // 1. Panel Appearance & Translucency
        // ====================================================================
        const aestheticHeader = document.createElement("div");
        aestheticHeader.className = "zs-section-header";
        aestheticHeader.style.marginTop = "8px";
        const aesTitle = document.createElement("h3");
        aesTitle.className = "zs-section-title";
        aesTitle.textContent = "Panel Appearance & Translucency";
        aestheticHeader.appendChild(aesTitle);
        // The appearance heading moves to the Look category below.

        const slidersGroup = document.createElement("div");
        slidersGroup.className = "zs-conditional-group";
        slidersGroup.id = "zs-translucency-sliders-group";

        const t1 = createToggleRow(
          "Pinned Panel Translucency",
          "Frosted glass effect when pinned; automatically becomes solid when Dual-View pushes page",
          ctx.BGALAZKA_EXT_PREFS.TRANSLUCENCY,
          "bgalazka-translucency",
          false,
          ctx.PREF_ICONS.GLASS,
          (enabled) =>
            slidersGroup.setAttribute(
              "data-hidden",
              enabled ? "false" : "true",
            ),
        );
        content.appendChild(t1.row);

        const s1 = createSliderRow(
          "Unpinned Opacity",
          "Base solidness of standard floating panels",
          ctx.BGALAZKA_EXT_PREFS.OPACITY_UNPINNED,
          10,
          100,
          92,
          "%",
        );
        const s2 = createSliderRow(
          "Pinned Focus Opacity",
          "Solidness when hovering or interacting with pinned panels",
          ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS,
          10,
          100,
          85,
          "%",
        );
        const s3 = createSliderRow(
          "Pinned Idle Opacity",
          "Translucency limit when panel is pinned and unfocused",
          ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR,
          10,
          100,
          45,
          "%",
        );
        slidersGroup.append(s1.row, s2.row, s3.row);
        slidersGroup.setAttribute(
          "data-hidden",
          ctx.getPref(ctx.BGALAZKA_EXT_PREFS.TRANSLUCENCY, false)
            ? "false"
            : "true",
        );
        content.appendChild(slidersGroup);

        const tPanelInputShield = createToggleRow(
          "Prevent Panel Input Pass-Through",
          "Keep clicks inside an open panel and route mouse Back/Forward buttons to the focused panel instead of the webpage behind it",
          ctx.BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD,
          "bgalazka-panel-input-shield",
          false,
          ctx.PREF_ICONS.ISOLATION,
        );
        content.appendChild(tPanelInputShield.row);

        // ====================================================================
        // 2. Workspace Layout & Dual-View
        // ====================================================================
        const dockHeader = document.createElement("div");
        dockHeader.className = "zs-section-header";
        dockHeader.style.marginTop = "20px";
        const dockTitle = document.createElement("h3");
        dockTitle.className = "zs-section-title";
        dockTitle.textContent = "Workspace Layout & Dual-View";
        dockHeader.appendChild(dockTitle);
        content.appendChild(dockHeader);

        const t2 = createToggleRow(
          "Opposite-Side Docking & Controls",
          "Reverse the default panel side for the selected Sidebar or Apps Bar launcher mode",
          ctx.BGALAZKA_EXT_PREFS.OPPOSITE_DOCKING,
          "bgalazka-opposite-docking",
          false,
          ctx.PREF_ICONS.DOCK,
          (enabled) => {
            ctx.syncHoverPanelAvailability();
          },
        );
        content.appendChild(t2.row);

        const tHoverReveal = createToggleRow(
          "Autohide Panels",
          "Available in every docking and bar layout. Leave a panel to hide it, then hover its docked edge to reveal it",
          ctx.BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL,
          null,
          false,
          ctx.PREF_ICONS.HOVER_EYE,
          () => ctx.syncHoverPanelAvailability(),
        );
        content.appendChild(tHoverReveal.row);
        const hoverRevealDelaySlider = createSliderRow(
          "Hidden Panel Reveal Delay",
          "Time the cursor must stay at the ledge before a hidden panel appears. 0 ms opens immediately; default is 160 ms.",
          ctx.BGALAZKA_EXT_PREFS.HOVER_REVEAL_DELAY,
          0,
          2000,
          160,
          " ms",
        );
        hoverRevealDelaySlider.input.step = 10;
        content.appendChild(hoverRevealDelaySlider.row);
        const hoverRevealWidthSlider = createSliderRow(
          "Hidden Panel Hover Area Width",
          "Width of the ledge that reveals a hidden panel. The current size, 6 px, is the default.",
          ctx.BGALAZKA_EXT_PREFS.HOVER_REVEAL_WIDTH,
          1,
          64,
          6,
          " px",
        );
        content.appendChild(hoverRevealWidthSlider.row);

        const tEdgeAttached = createToggleRow(
          "Edge-Attached Panels",
          "Dock panels flush to the adjacent bar or opposite screen edge and temporarily ignore saved position offsets; does not pin or push the webpage",
          ctx.BGALAZKA_EXT_PREFS.EDGE_ATTACHED_PANELS,
          "bgalazka-edge-attached-panels",
          false,
          ctx.PREF_ICONS.DOCK,
          () => {
            const root = document.getElementById("zen-app-panel-root");
            ctx.applyVerticalResizeExtras(root);
            ctx.applyHorizontalPanelOffset(root);
          },
        );
        content.appendChild(tEdgeAttached.row);
        for (const [key, label] of [
          ["secondary_toolbar_swap", "Show secondary panel swap control"],
          ["secondary_toolbar_close", "Show secondary close/unlink control"],
        ]) {
          const pref = "zen.workspace.bgalazka." + key;
          const control = createToggleRow(
            label,
            "Applies to Triple and Super views; changes live",
            pref,
            "bgalazka-" + key.replaceAll("_", "-"),
            true,
            ctx.PREF_ICONS.DOCK,
          );
          content.appendChild(control.row);
        }

        const liveNote = document.createElement("p");
        liveNote.className = "zs-sublabel";
        liveNote.textContent =
          "Feature switches apply live from this window, Sine, or about:config. " +
          "Edge attachment and page push lock move and height gestures; saved free-position values return later. " +
          "Container, mobile UA and Real Tab IDs changes recreate loaded panels and restore their views. " +
          "Module/CSS loading and local add-ons apply after restart; core files stay protected unless unsafe disabling is enabled in Developer settings.";
        content.appendChild(liveNote);

        const tPush = createToggleRow(
          "Dual-View Mode",
          "Keep the panel open and contract the active webpage beside it; does not change your manual Pin state. Triple View has its own push choice on the pill button.",
          ctx.BGALAZKA_EXT_PREFS.PUSH_PAGE,
          "bgalazka-push-page",
          false,
          ctx.PREF_ICONS.PUSH,
        );
        content.appendChild(tPush.row);

        // Mirrors the pill button of the same name (note 16): both read/write
        // BGALAZKA_EXT_PREFS.ALL_SIDES_RESIZE, so this row's onChange keeps
        // the pill button's own data-active state in sync when toggled here.
        const tAllSidesResize = createToggleRow(
          "All-Sides Panel Resize",
          "Enable outer, inner, top, bottom, and corner resize handles; drag this pill button freely to move the whole panel in 2D",
          ctx.BGALAZKA_EXT_PREFS.ALL_SIDES_RESIZE,
          "bgalazka-all-sides-resize",
          false,
          ctx.PREF_ICONS.RESIZE_ALL,
          () => ctx.ensurePillAllSidesResizeButton(),
        );
        content.appendChild(tAllSidesResize.row);

        const panelHorizontalOffsetBounds = (() => {
          const root = document.getElementById("zen-app-panel-root");
          if (!root?.hasAttribute("open")) {
            const fallback = Math.max(1, window.innerWidth);
            return { min: -fallback, max: fallback };
          }
          ctx.applyHorizontalPanelOffset(root);
          return ctx.getHorizontalOffsetBounds(root);
        })();
        const panelHorizontalOffsetSlider = createSliderRow(
          "Panel Horizontal Offset",
          "Move the whole floating panel left/right without changing its width; limits are the actual window borders",
          ctx.BGALAZKA_EXT_PREFS.PANEL_HORIZONTAL_OFFSET,
          Math.floor(panelHorizontalOffsetBounds.min),
          Math.ceil(panelHorizontalOffsetBounds.max),
          ctx.getHorizontalOffsetPreference(
            document.getElementById("zen-app-panel-root"),
          ),
          "px",
        );
        content.appendChild(panelHorizontalOffsetSlider.row);

        // ====================================================================
        // 3. Floating Panel Pill Controls
        // ====================================================================
        const pillHeader = document.createElement("div");
        pillHeader.className = "zs-section-header";
        pillHeader.style.marginTop = "20px";
        const pillTitle = document.createElement("h3");
        pillTitle.className = "zs-section-title";
        pillTitle.textContent = "Floating Panel Pill Controls";
        pillHeader.appendChild(pillTitle);
        content.appendChild(pillHeader);

        const pillSubgroup = document.createElement("div");
        pillSubgroup.className = "zs-conditional-group";

        const tMasterPill = createToggleRow(
          "Hide Floating Pill Menu",
          "Completely hide the side action capsule on the app panel",
          ctx.BGALAZKA_EXT_PREFS.HIDE_PILL,
          "bgalazka-hide-pill",
          false,
          ctx.PREF_ICONS.PILL,
          (hidden) =>
            pillSubgroup.setAttribute("data-hidden", hidden ? "true" : "false"),
        );
        content.appendChild(tMasterPill.row);

        // NOTE: this used to be a "top"/"center"/"bottom" dropdown backed by a
        // string pref. It never actually persisted (see the string-branch fix
        // in getPref/setPref above) and only offered 3 fixed spots. Replaced
        // with a continuous -50%..+50% offset from center (0% = centered),
        // matching createSliderRow's existing number-pref handling, which
        // already worked correctly. The CSS side (chrome.css) clamps the
        // computed position so the pill can never be pushed fully off-screen
        // even at the extreme -50%/+50% ends — see "Pill Menu Vertical Offset"
        // in chrome.css for the failsafe.
        const pillPosSlider = createSliderRow(
          "Pill Menu Vertical Offset",
          "-50% anchors near the top, +50% near the bottom, 0% is centered",
          ctx.BGALAZKA_EXT_PREFS.PILL_POSITION,
          -50,
          50,
          0,
          "%",
        );
        const tPeekDot = createToggleRow(
          "Show Mini Pill When Idle",
          "Keep a small colored version of the pill visible instead of fully autohiding",
          ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT,
          "bgalazka-pill-peek-dot",
          false,
          ctx.PREF_ICONS.PILL_POS,
        );
        const peekColorRow = createColorRow(
          "Mini Pill Color",
          "Background color used only for the shrunk idle pill (the expanded pill always uses black)",
          ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
          "#4da6ff",
        );
        const peekOpacitySlider = createSliderRow(
          "Mini Pill Opacity",
          "Controls only the shrunk idle mini pill; 100% is fully opaque",
          ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY,
          10,
          100,
          90,
          "%",
        );
        const pillBackgroundOpacitySlider = createSliderRow(
          "Pill Background Opacity",
          "Controls the expanded pill's black background independently from Mini Pill Opacity; icons remain fully opaque",
          ctx.BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY,
          10,
          100,
          90,
          "%",
        );
        const tDualView = createToggleRow(
          "Hide Dual-View Button",
          "Remove dual-view toggle from pill menu",
          ctx.BGALAZKA_EXT_PREFS.HIDE_DUAL_VIEW,
          "bgalazka-hide-dual-view",
          false,
          ctx.PREF_ICONS.PUSH,
        );
        const tHideHoverRevealBtn = createToggleRow(
          "Hide Show-on-Hover Pill Button",
          "Remove the eye button from the panel pill; use the setting above to enable hover reveal",
          ctx.BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
          "bgalazka-hide-hover-reveal-btn",
          false,
          ctx.PREF_ICONS.HOVER_EYE,
          () => syncHideHoverControls(),
        );
        const tHideHoverRevealBtnPillCategory = createToggleRow(
          "Hide Show-on-Hover Pill Button",
          "Remove the eye button from the panel pill",
          ctx.BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
          "bgalazka-hide-hover-reveal-btn",
          false,
          ctx.PREF_ICONS.HOVER_EYE,
          () => syncHideHoverControls(),
        );
        const syncHideHoverControls = () => {
          const hidden = ctx.getPref(
            ctx.BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
            false,
          );
          tHideHoverRevealBtn.input.checked = hidden;
          tHideHoverRevealBtnPillCategory.input.checked = hidden;
          ctx.syncHoverPanelAvailability();
        };
        const tHideAllSidesResizeBtn = createToggleRow(
          "Hide All-Sides Resize Button",
          "Remove all-sides resize toggle from pill menu (the settings row above still works)",
          ctx.BGALAZKA_EXT_PREFS.HIDE_ALL_SIDES_RESIZE_BTN,
          "bgalazka-hide-all-sides-resize-btn",
          false,
          ctx.PREF_ICONS.RESIZE_ALL,
        );
        const tPin = createToggleRow(
          "Hide Pin Button",
          "Remove panel pinning toggle",
          ctx.BGALAZKA_EXT_PREFS.HIDE_PIN,
          "bgalazka-hide-pin",
          false,
          ctx.PREF_ICONS.PIN,
        );
        const t5 = createToggleRow(
          "Hide Expand / Restore Button",
          "Remove full-width panel expand toggle",
          ctx.BGALAZKA_EXT_PREFS.HIDE_EXPAND,
          "bgalazka-hide-expand",
          false,
          ctx.PREF_ICONS.EXPAND,
        );
        const tGrabber = createToggleRow(
          "Hide Resize Grabber Handle",
          "Remove the 6-dot drag-resize handle",
          ctx.BGALAZKA_EXT_PREFS.HIDE_GRABBER,
          "bgalazka-hide-grabber",
          false,
          ctx.PREF_ICONS.GRABBER,
        );
        const tRefresh = createToggleRow(
          "Hide Refresh Button",
          "Remove active web app reload button",
          ctx.BGALAZKA_EXT_PREFS.HIDE_REFRESH,
          "bgalazka-hide-refresh",
          false,
          ctx.PREF_ICONS.REFRESH,
        );
        const tClose = createToggleRow(
          "Hide Close Button",
          "Remove close 'X' button from pill menu",
          ctx.BGALAZKA_EXT_PREFS.HIDE_CLOSE,
          "bgalazka-hide-close",
          false,
          ctx.PREF_ICONS.CLOSE,
        );

        pillSubgroup.append(
          pillPosSlider.row,
          tPeekDot.row,
          peekColorRow.row,
          peekOpacitySlider.row,
          pillBackgroundOpacitySlider.row,
        );
        pillSubgroup.setAttribute(
          "data-hidden",
          ctx.getPref(ctx.BGALAZKA_EXT_PREFS.HIDE_PILL, false)
            ? "true"
            : "false",
        );
        content.appendChild(pillSubgroup);

        // ====================================================================
        // 3b. Extension — Hide Pill Controls
        // ====================================================================
        const appsBarToolsHeader = document.createElement("div");
        appsBarToolsHeader.id = "zs-appsbar-tools-heading";
        appsBarToolsHeader.className = "zs-section-header";
        const appsBarToolsTitle = document.createElement("h3");
        appsBarToolsTitle.className = "zs-section-title";
        appsBarToolsTitle.textContent = "Apps Bar — Browser Tools";
        appsBarToolsHeader.appendChild(appsBarToolsTitle);
        content.appendChild(appsBarToolsHeader);
        const appsBarToolToggles = [
          [
            "LIBRARY",
            "Show Library Button",
            "Open Zen Library (or the classic Library when unavailable)",
            true,
          ],
          [
            "HISTORY",
            "Show History Button",
            "Add a direct History shortcut to the second bar",
            false,
          ],
          [
            "DOWNLOADS",
            "Show Downloads Button",
            "Add a direct Downloads shortcut to the second bar",
            false,
          ],
          [
            "BOOKMARKS",
            "Show Bookmarks Button",
            "Open bookmarks in the current window’s sidebar",
            false,
          ],
        ].map(([key, label, description, def]) => {
          const pref = ctx.BGALAZKA_EXT_PREFS["APPSBAR_" + key];
          const control = createToggleRow(
            label,
            description,
            pref,
            "bgalazka-appsbar-" + key.toLowerCase(),
            def,
            ctx.PREF_ICONS[key],
          );
          content.appendChild(control.row);
          return { row: control.row, input: control.input, pref, def };
        });
        // Keep browser tools easy to find before the longer panel options.
        content.prepend(
          appsBarToolsHeader,
          ...appsBarToolToggles.map(({ row }) => row),
        );

        const hidePillHeader = document.createElement("div");
        hidePillHeader.className = "zs-section-header";
        hidePillHeader.style.marginTop = "20px";
        const hidePillTitle = document.createElement("h3");
        hidePillTitle.className = "zs-section-title";
        hidePillTitle.textContent = "Extension — Hide Pill Controls";
        hidePillHeader.appendChild(hidePillTitle);
        content.appendChild(hidePillHeader);

        const hidePillGroup = document.createElement("div");
        hidePillGroup.className =
          "zs-conditional-group zs-hide-pill-controls-group";
        hidePillGroup.append(
          tDualView.row,
          tHideHoverRevealBtnPillCategory.row,
          tHideAllSidesResizeBtn.row,
          tPin.row,
          t5.row,
          tGrabber.row,
          tRefresh.row,
          tClose.row,
        );
        content.appendChild(hidePillGroup);
        tHoverReveal.row.after(tHideHoverRevealBtn.row);

        // ====================================================================
        // 4. Web Panel Navigation Toolbar
        // ====================================================================
        const toolbarHeader = document.createElement("div");
        toolbarHeader.className = "zs-section-header";
        toolbarHeader.style.marginTop = "20px";
        const toolbarTitle = document.createElement("h3");
        toolbarTitle.className = "zs-section-title";
        toolbarTitle.textContent = "Web Panel Navigation Toolbar";
        toolbarHeader.appendChild(toolbarTitle);
        content.appendChild(toolbarHeader);

        const webToolbarSubgroup = document.createElement("div");
        webToolbarSubgroup.className = "zs-conditional-group";

        const tWebToolbar = createToggleRow(
          "Enable Navigation Toolbar",
          "Back / forward / reload + URL bar docked at the bottom of the web panel",
          ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED,
          "bgalazka-webtoolbar",
          false,
          ctx.PREF_ICONS.TOOLBAR,
          (enabled) =>
            webToolbarSubgroup.setAttribute(
              "data-hidden",
              enabled ? "false" : "true",
            ),
        );
        content.appendChild(tWebToolbar.row);

        const tToolbarAutohide = createToggleRow(
          "Only Show Toolbar on Hover",
          "Keep the web panel full-height; reveal the toolbar only when hovering its edge",
          ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_AUTOHIDE,
          "bgalazka-webtoolbar-autohide",
          false,
        );
        const tToolbarTop = createToggleRow(
          "Move Toolbar to Top of Panel",
          "Dock back/forward/reload/URL bar at the top of the web panel instead of the bottom",
          ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_TOP,
          "bgalazka-webtoolbar-top",
          false,
        );
        const tTripleInwardToolbars = createToggleRow(
          "Triple View: URL Bars Face the Divider",
          "Place the top panel's toolbar at its bottom and the bottom panel's toolbar at its top; overrides toolbar placement only in Triple View",
          ctx.BGALAZKA_EXT_PREFS.TRIPLE_INWARD_TOOLBARS,
          "bgalazka-triple-inward-toolbars",
          true,
        );
        const tToolbarUrlbar = createToggleRow(
          "Show URL Bar",
          "Display and allow editing the current page's address",
          ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_URLBAR,
          "bgalazka-webtoolbar-urlbar",
          false,
        );
        const tToolbarZoom = createToggleRow(
          "Show Zoom Controls",
          "Add page zoom in/out/reset buttons to the toolbar",
          ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ZOOM,
          "bgalazka-webtoolbar-zoom",
          false,
        );

        // Custom engines are always visible in their dedicated category. This
        // makes creating a second engine discoverable instead of hiding the
        // fields behind the selected default and the quick-switch toggle.
        const customSearchSubgroup = document.createElement("div");
        customSearchSubgroup.className =
          "zs-search-engine-list zs-settings-card";
        const tSearchCustomUrl = createTextRow(
          "Custom Engine 1",
          'Must contain a literal "%s" placeholder for the search term, e.g. https://example.com/search?q=%s',
          ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_CUSTOM_URL,
          "https://example.com/search?q=%s",
          null,
          () => syncCustomSearchOptions(),
        );
        customSearchSubgroup.append(tSearchCustomUrl.row);

        const tSearchEngine = createSelectRow(
          "Default Search Engine",
          'Used when the URL bar text isn\'t a URL, e.g. typing "weather" instead of a full address',
          ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_ENGINE,
          [
            ...ctx.QUICK_SWITCH_BUILTIN_TARGETS.map(({ key, label }) => ({
              value: key,
              label,
            })),
            { value: "browser", label: "Browser Default" },
            { value: "custom", label: "Custom Engine 1" },
            ...ctx.QUICK_SWITCH_CUSTOM_PREFS.map((_, index) => ({
              value: `custom-${index + 2}`,
              label: `Custom Engine ${index + 2}`,
            })),
          ],
          "ddg",
          ctx.PREF_ICONS.SWAP,
          null, // no root attribute to mirror; only read via getPref() in buildSearchUrl()
          (value) => {
            // Re-fetch Firefox's own default engine right when the user
            // picks this mode, rather than only at startup, in case they
            // changed their system default engine since the browser opened.
            if (value === "browser") ctx.refreshBrowserSearchTemplate();
          },
        );

        const quickSwitchTargetsSubgroup = document.createElement("div");
        quickSwitchTargetsSubgroup.className = "zs-conditional-group";

        const quickSwitchTargetsHeader = document.createElement("div");
        quickSwitchTargetsHeader.className = "zs-section-header";
        const quickSwitchTargetsTitle = document.createElement("h3");
        quickSwitchTargetsTitle.className = "zs-section-title";
        quickSwitchTargetsTitle.textContent = "Quick-Switch Destinations";
        quickSwitchTargetsHeader.appendChild(quickSwitchTargetsTitle);

        const quickSwitchTargetRows = ctx.QUICK_SWITCH_BUILTIN_TARGETS.map(
          (target, index) =>
            createToggleRow(
              target.label,
              "Include in the Quick-Switch cycle",
              ctx.QUICK_SWITCH_TARGET_PREF_PREFIX + target.key,
              null,
              index < 2,
              null,
            ),
        );
        const quickSwitchCustomRows = ctx.QUICK_SWITCH_CUSTOM_PREFS.map(
          (pref, index) =>
            createTextRow(
              `Custom Engine ${index + 2}`,
              'Optional HTTP(S) GET template containing "%s", e.g. https://example.com/search?q=%s',
              pref,
              "https://example.com/search?q=%s",
              null,
              () => syncCustomSearchOptions(),
            ),
        );
        const syncCustomSearchOptions = () => {
          ctx.SEARCH_CUSTOM_ENGINE_PREFS.forEach((pref, index) => {
            const value = index === 0 ? "custom" : `custom-${index + 1}`;
            const option = Array.from(tSearchEngine.select.options).find(
              (o) => o.value === value,
            );
            if (!option) return;
            option.disabled = !ctx.isValidQuickSwitchTemplate(
              ctx.getPref(pref, ""),
            );
            option.textContent =
              `Custom Engine ${index + 1}` +
              (option.disabled ? " (add a valid URL)" : "");
          });
        };
        syncCustomSearchOptions();
        quickSwitchTargetsSubgroup.append(
          quickSwitchTargetsHeader,
          ...quickSwitchTargetRows.map(({ row }) => row),
        );
        customSearchSubgroup.append(
          ...quickSwitchCustomRows.map(({ row }) => row),
        );

        const tQuickswitch = createToggleRow(
          "Search Engine Quick-Switch Button",
          "Shows on HTTP(S) pages with a detectable GET search term and cycles through the selected destinations",
          ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH,
          null,
          false,
          ctx.PREF_ICONS.SWAP,
          (enabled) =>
            quickSwitchTargetsSubgroup.setAttribute(
              "data-hidden",
              enabled ? "false" : "true",
            ),
        );
        quickSwitchTargetsSubgroup.setAttribute(
          "data-hidden",
          ctx.getPref(ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH, false)
            ? "false"
            : "true",
        );

        webToolbarSubgroup.append(
          tToolbarAutohide.row,
          tToolbarTop.row,
          tTripleInwardToolbars.row,
          tToolbarUrlbar.row,
          tToolbarZoom.row,
        );
        webToolbarSubgroup.setAttribute(
          "data-hidden",
          ctx.getPref(ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED, false)
            ? "false"
            : "true",
        );
        content.appendChild(webToolbarSubgroup);

        // ====================================================================
        // 5. Firefox Add-on Compatibility
        // ====================================================================
        const addonCompatHeader = document.createElement("div");
        addonCompatHeader.className = "zs-section-header";
        addonCompatHeader.style.marginTop = "20px";
        const addonCompatTitle = document.createElement("h3");
        addonCompatTitle.className = "zs-section-title";
        addonCompatTitle.textContent = "Firefox Add-on Compatibility";
        addonCompatHeader.appendChild(addonCompatTitle);
        content.appendChild(addonCompatHeader);

        const tAddonTabIdBridge = createToggleRow(
          "Real Tab IDs for Web Panels",
          "Back each loaded Zentral app with a real pinned Firefox tab so WebExtensions/add-ons receive a genuine tabId. Host tabs are kept inside a collapsed, ultra-compact ‘Zentral Add-on Hosts’ Zen folder. Toggling this unloads currently loaded web panels so they can be recreated safely.",
          ctx.BGALAZKA_EXT_PREFS.ADDON_TAB_ID_BRIDGE,
          "bgalazka-addon-tab-id-bridge",
          false,
          ctx.PREF_ICONS.PIN,
          (enabled) => ctx.setAddonTabIdBridgeEnabled(enabled),
        );
        content.appendChild(tAddonTabIdBridge.row);
        const tZenInternetCss = createToggleRow(
          "Use Zen Internet CSS in Web Panels (experimental)",
          "Read Zen Internet's locally stored styles and its global, per-site, skip-list, and feature settings. Apply them only inside Zentral web panels. Zentral makes no network requests for styles and never selects tabs or changes Zen Internet's storage. Real Tab IDs are optional.",
          ctx.BGALAZKA_EXT_PREFS.ZEN_INTERNET_PANEL_CSS,
          "bgalazka-zen-internet-panel-css",
          false,
          ctx.PREF_ICONS.REFRESH,
          (enabled) => ctx.setZenInternetPanelCssEnabled(enabled),
        );
        content.appendChild(tZenInternetCss.row);
        const tShowTripleStyleRepair = createToggleRow(
          "Show Triple View Style Repair Button",
          "Show the manual repair control at the end of the primary panel URL bar while Triple View is populated. Leave this off when the automatic document-generation styling fix is working normally.",
          ctx.BGALAZKA_EXT_PREFS.SHOW_TRIPLE_STYLE_REPAIR,
          null,
          false,
          ctx.PREF_ICONS.REPAIR_STYLE,
          () => ctx.updateWebToolbarState(),
        );
        content.appendChild(tShowTripleStyleRepair.row);
        const tPeriodicFallbackPolling = createToggleRow(
          "Periodic Fallback Polling",
          "Enable low-frequency safety polling for panel activation/CSS health plus primary and secondary toolbar state. Normal loads, navigation, styling, audio and panel lifecycle remain event-driven with this off. Turn it on only if your Zen build still develops stale or gray panels/UI over time.",
          ctx.BGALAZKA_EXT_PREFS.PERIODIC_FALLBACK_POLLING,
          null,
          false,
          ctx.PREF_ICONS.REFRESH,
          () => {
            ctx.startWebToolbarPolling();
            ctx.syncPanelFallbackPolling();
            ctx.syncSecondaryFallbackPolling();
          },
        );
        content.appendChild(tPeriodicFallbackPolling.row);
        const recoveryControls = [];
        {
          const pref = "zen.workspace.bgalazka.panel_retry_limit";
          const control = createSelectRow("Panel recovery retry limit",
            "Maximum additional attempts per operation. Off keeps the initial attempt and normal load/navigation events. All panel recovery shares one bounded timer.", pref, [{"label": "Off", "value": 0}, {"label": "1", "value": 1}, {"label": "2", "value": 2}, {"label": "3", "value": 3}, {"label": "4", "value": 4}, {"label": "6", "value": 6}], 2, ctx.PREF_ICONS.REFRESH);
          content.appendChild(control.row);
          recoveryControls.push({ input: control.select, pref, def: 2, isSelect: true });
        }
        {
          const pref = "zen.workspace.bgalazka.panel_retry_delay_ms";
          const control = createSelectRow("Panel recovery retry delay",
            "Minimum time between recovery attempts. Applied only when an operation has not completed.", pref, [{"label": "100 ms", "value": 100}, {"label": "250 ms", "value": 250}, {"label": "500 ms", "value": 500}, {"label": "1 second", "value": 1000}, {"label": "2 seconds", "value": 2000}, {"label": "5 seconds", "value": 5000}], 500, ctx.PREF_ICONS.REFRESH);
          content.appendChild(control.row);
          recoveryControls.push({ input: control.select, pref, def: 500, isSelect: true });
        }
        {
          const pref = "zen.workspace.bgalazka.panel_fallback_interval_ms";
          const control = createSelectRow("Panel troubleshooting refresh interval",
            "How often the optional troubleshooting pass checks visible panels. Closed and autohidden panels are excluded.", pref, [{"label": "1 second", "value": 1000}, {"label": "5 seconds", "value": 5000}, {"label": "10 seconds", "value": 10000}, {"label": "30 seconds", "value": 30000}, {"label": "1 minute", "value": 60000}, {"label": "5 minutes", "value": 300000}], 10000, ctx.PREF_ICONS.REFRESH);
          content.appendChild(control.row);
          recoveryControls.push({ input: control.select, pref, def: 10000, isSelect: true });
        }
        {
          const pref = "zen.workspace.apps.sidebar.badge_poll_interval_ms";
          const control = createSelectRow("Notification badge fallback refresh",
            "Title and load events update badges immediately, including while closed. Enable this fallback only for missed events; slow intervals reduce background work.", pref, [{"label": "Off (use notification events)", "value": 0}, {"label": "1.5 seconds", "value": 1500}, {"label": "5 seconds", "value": 5000}, {"label": "15 seconds", "value": 15000}, {"label": "1 minute", "value": 60000}, {"label": "5 minutes", "value": 300000}, {"label": "15 minutes", "value": 900000}, {"label": "1 hour", "value": 3600000}], 0, ctx.PREF_ICONS.REFRESH);
          content.appendChild(control.row);
          recoveryControls.push({ input: control.select, pref, def: 0, isSelect: true });
        }

        const tShowAddonHostFolder = createToggleRow(
          "Show Web Panel Tab ID Folder",
          "Reveal the Zentral Add-on Hosts folder and its tabs in the sidebar so you can check whether panel host tabs are cleaned up. Requires Real Tab IDs for Web Panels to create host tabs.",
          ctx.BGALAZKA_EXT_PREFS.SHOW_ADDON_HOST_FOLDER,
          "bgalazka-show-addon-host-folder",
          false,
          ctx.PREF_ICONS.PIN,
          () => {
            ctx.keepAddonHostFolderCollapsed(ctx.findAddonHostFolder());
            ctx.updateAddonHostInspection();
          },
        );
        content.appendChild(tShowAddonHostFolder.row);
        const addonHostInspection = document.createElement("div");
        addonHostInspection.id = "zs-addon-host-inspection";
        addonHostInspection.className = "zs-sublabel";
        addonHostInspection.style.cssText =
          "padding:4px 12px 12px;white-space:normal";
        content.appendChild(addonHostInspection);
        ctx.updateAddonHostInspection();

        const audioIndicator = createToggleRow(
          "Panel Audio Indicator and Quick Mute",
          "Show audio on panel launcher buttons and quick mute in the URL bar; silent panels have no audio control",
          ctx.BGALAZKA_EXT_PREFS.AUDIO_INDICATOR,
          null,
          false,
          ctx.PREF_ICONS.SOUND || ctx.PREF_ICONS.ISOLATION,
          () => {
            ctx.ensureNativeAudioButton();
            ctx.refreshPanelAudio();
          },
        );
        content.appendChild(audioIndicator.row);
        const tabStartup = createToggleRow(
          "Load Selected Tabs at Startup",
          "Adds Load at Startup to essential and pinned tab right-click menus. Choose each tab individually; only existing sleeping tabs are woken.",
          "zen.workspace.zentral.startup.enabled",
          null,
          false,
          ctx.PREF_ICONS.PIN,
          () => {},
        );
        content.appendChild(tabStartup.row);
        const smartSleep = createToggleRow(
          "Smart Sleep (defer preloads)",
          "Defer configured background panel preloads at startup; opened panels keep running",
          ctx.BGALAZKA_EXT_PREFS.SMART_SLEEP,
          null,
          false,
          ctx.PREF_ICONS.ISOLATION,
          () => ctx.requestTileSync(0),
        );
        content.appendChild(smartSleep.row);
        // ====================================================================
        // 6. Extension Keybinds
        // ====================================================================
        const keybindHeader = document.createElement("div");
        keybindHeader.className = "zs-section-header";
        keybindHeader.style.marginTop = "20px";
        const keybindTitle = document.createElement("h3");
        keybindTitle.className = "zs-section-title";
        keybindTitle.textContent = "Extension Keybinds";
        keybindHeader.appendChild(keybindTitle);
        content.appendChild(keybindHeader);

        const keybindSubgroup = document.createElement("div");
        keybindSubgroup.className = "zs-conditional-group zs-keybinds-group";

        const tMmbUnloadNormalTabs = createToggleRow(
          "Middle-Click Unloads Normal Tabs",
          "Middle-click a loaded normal tab to unload it instead of closing it; middle-click an already unloaded normal tab to close it",
          ctx.BGALAZKA_EXT_PREFS.MMB_UNLOAD_NORMAL_TABS,
          null,
          false,
          ctx.PREF_ICONS.TOOLBAR,
        );
        content.appendChild(tMmbUnloadNormalTabs.row);

        const tKeybindsEnabled = createToggleRow(
          "Enable Extension Keybinds",
          "Shortcuts only apply while the floating app panel is open and focused; click any binding below and press a new combination",
          ctx.BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED,
          null,
          false,
          ctx.PREF_ICONS.TOOLBAR,
          (enabled) => {
            keybindSubgroup.setAttribute(
              "data-hidden",
              enabled ? "false" : "true",
            );
            if (enabled) {
              ctx.setPref(ctx.BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, true);
              document.documentElement.setAttribute(
                "bgalazka-panel-input-shield",
                "true",
              );
              tPanelInputShield.input.checked = true;
            }
          },
        );
        content.appendChild(tKeybindsEnabled.row);

        const keybindRows = [
          [
            "Close Panel",
            "Close the focused app panel",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_CLOSE_PANEL,
            ctx.EXT_KEYBIND_DEFAULTS.CLOSE_PANEL,
          ],
          [
            "Back",
            "Navigate the focused panel back",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_BACK,
            ctx.EXT_KEYBIND_DEFAULTS.BACK,
          ],
          [
            "Forward",
            "Navigate the focused panel forward",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_FORWARD,
            ctx.EXT_KEYBIND_DEFAULTS.FORWARD,
          ],
          [
            "Reload",
            "Reload the focused app page",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_RELOAD,
            ctx.EXT_KEYBIND_DEFAULTS.RELOAD,
          ],
          [
            "Focus Panel URL Bar",
            "Focus/select the extension URL bar when that toolbar and URL bar are enabled",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_FOCUS_URL,
            ctx.EXT_KEYBIND_DEFAULTS.FOCUS_URL,
          ],
          [
            "Toggle Pin",
            "Pin or unpin the focused panel",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_PIN,
            ctx.EXT_KEYBIND_DEFAULTS.TOGGLE_PIN,
          ],
          [
            "Expand / Restore",
            "Toggle full-width panel expansion",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_EXPAND,
            ctx.EXT_KEYBIND_DEFAULTS.TOGGLE_EXPAND,
          ],
          [
            "Toggle Dual-View",
            "Turn Dual-View page push on/off",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_DUAL_VIEW,
            ctx.EXT_KEYBIND_DEFAULTS.TOGGLE_DUAL_VIEW,
          ],
          [
            "Toggle All-Sides Resize",
            "Enable/disable extension resize handles",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_RESIZE,
            ctx.EXT_KEYBIND_DEFAULTS.TOGGLE_RESIZE,
          ],
          [
            "Toggle Navigation Toolbar",
            "Show/hide the extension web navigation toolbar",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_TOOLBAR,
            ctx.EXT_KEYBIND_DEFAULTS.TOGGLE_TOOLBAR,
          ],
          [
            "Toggle Panel Translucency",
            "Enable/disable extension panel translucency",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_TRANSLUCENCY,
            ctx.EXT_KEYBIND_DEFAULTS.TOGGLE_TRANSLUCENCY,
          ],
          [
            "Toggle Opposite-Side Docking",
            "Switch extension opposite-side docking on/off",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_OPPOSITE_DOCKING,
            ctx.EXT_KEYBIND_DEFAULTS.TOGGLE_OPPOSITE_DOCKING,
          ],
          [
            "Toggle Edge-Attached Panels",
            "Attach/detach the panel from its current window edge",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_EDGE_ATTACHED,
            ctx.EXT_KEYBIND_DEFAULTS.TOGGLE_EDGE_ATTACHED,
          ],
          [
            "Toggle Input Pass-Through Shield",
            "Enable/disable the extension panel input barrier",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_INPUT_SHIELD,
            ctx.EXT_KEYBIND_DEFAULTS.TOGGLE_INPUT_SHIELD,
          ],
          [
            "Zoom In",
            "Increase zoom of the focused app page",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_IN,
            ctx.EXT_KEYBIND_DEFAULTS.ZOOM_IN,
          ],
          [
            "Zoom Out",
            "Decrease zoom of the focused app page",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_OUT,
            ctx.EXT_KEYBIND_DEFAULTS.ZOOM_OUT,
          ],
          [
            "Reset Zoom",
            "Reset focused app page zoom to 100%",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_RESET,
            ctx.EXT_KEYBIND_DEFAULTS.ZOOM_RESET,
          ],
          [
            "Open Zentral Settings",
            "Open Zentral Settings from the focused app panel",
            ctx.BGALAZKA_EXT_PREFS.KEYBIND_OPEN_SETTINGS,
            ctx.EXT_KEYBIND_DEFAULTS.OPEN_SETTINGS,
          ],
        ].map(([label, description, pref, def]) =>
          createKeybindRow(label, description, pref, def),
        );
        keybindRows.forEach(({ row }) => keybindSubgroup.appendChild(row));
        keybindSubgroup.setAttribute(
          "data-hidden",
          ctx.getPref(ctx.BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED, false)
            ? "false"
            : "true",
        );
        content.appendChild(keybindSubgroup);

        // ====================================================================
        // 7. Tab Corner App Tiles
        // ====================================================================
        const cornerHeader = document.createElement("div");
        cornerHeader.className = "zs-section-header";
        cornerHeader.style.marginTop = "20px";
        const cornerTitle = document.createElement("h3");
        cornerTitle.className = "zs-section-title";
        cornerTitle.textContent = "Tab Corner App Tiles";
        cornerHeader.appendChild(cornerTitle);
        content.appendChild(cornerHeader);

        const cornerSubgroup = document.createElement("div");
        cornerSubgroup.className = "zs-conditional-group";

        const t4 = createToggleRow(
          "Panels on Essentials",
          "Give each tab marked Essential its own independent panel launcher",
          ctx.BGALAZKA_EXT_PREFS.CORNER_TILES,
          "bgalazka-corner-tiles",
          false,
          ctx.PREF_ICONS.CORNER,
          (enabled) => cornerSubgroup.setAttribute("data-hidden", "false"),
        );
        content.appendChild(t4.row);

        const tAllTabs = createToggleRow(
          "Panel Launchers on All Tabs",
          "Also show panel launchers over the favicon of non-essential tabs; their panel copies stay independent",
          ctx.BGALAZKA_EXT_PREFS.ALL_TAB_PANELS,
          "bgalazka-all-tab-panels",
          false,
          ctx.PREF_ICONS.CORNER,
          () => ctx.requestTileSync(0),
        );
        const tHoverCorner = createToggleRow(
          "Show Tab Panel Launchers on Hover",
          "Hide panel buttons until tab hover; normal tabs keep their favicon and gain a blue launcher outline on hover",
          ctx.BGALAZKA_EXT_PREFS.HOVER_CORNER_TILES,
          "bgalazka-hover-corner-tiles",
          false,
          ctx.PREF_ICONS.HOVER_EYE,
        );
        const t3 = createToggleRow(
          "Show Loaded Panel Dot on Tabs",
          "Show a dot on ordinary tabs with loaded panels. Essential panel buttons gray out when their panels unload",
          ctx.BGALAZKA_EXT_PREFS.TAB_ISOLATION,
          "bgalazka-tab-isolation",
          true,
          ctx.PREF_ICONS.ISOLATION,
        );
        const tBadges = createToggleRow(
          "Hide Corner Notification Badges",
          "Suppress unread indicators and counter badges on tab corner tiles",
          ctx.BGALAZKA_EXT_PREFS.HIDE_CORNER_BADGES,
          "bgalazka-hide-corner-badges",
          false,
          ctx.PREF_ICONS.BADGE,
        );
        cornerSubgroup.append(
          tAllTabs.row,
          tHoverCorner.row,
          t3.row,
          tBadges.row,
        );
        cornerSubgroup.setAttribute("data-hidden", "false");
        content.appendChild(cornerSubgroup);

        const tHideUnattached = createToggleRow(
          "Hide Unattached App Controls",
          "Hide the standalone app area when this workspace has no apps; show it when an app is available, including one released from a tab",
          ctx.BGALAZKA_EXT_PREFS.HIDE_UNATTACHED_APP_CONTROLS,
          "bgalazka-hide-unattached-app-controls",
          false,
          ctx.PREF_ICONS.CORNER,
        );
        content.appendChild(tHideUnattached.row);

        panel._toggles.push(
          ...appsBarToolToggles,
          ...[s1, s2, s3].map(({ input, badge }, index) => ({
            input,
            pref: [
              ctx.BGALAZKA_EXT_PREFS.OPACITY_UNPINNED,
              ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS,
              ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR,
            ][index],
            def: [92, 85, 45][index],
            isSelect: true,
            onSync: (v) => {
              badge.textContent = v + "%";
            },
          })),
          {
            input: t1.input,
            pref: ctx.BGALAZKA_EXT_PREFS.TRANSLUCENCY,
            def: false,
            onSync: (v) =>
              slidersGroup.setAttribute("data-hidden", v ? "false" : "true"),
          },
          {
            input: tPanelInputShield.input,
            pref: ctx.BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD,
            def: false,
          },
          {
            input: t2.input,
            pref: ctx.BGALAZKA_EXT_PREFS.OPPOSITE_DOCKING,
            def: false,
            onSync: () => ctx.syncHoverPanelAvailability(),
          },
          {
            input: tHoverReveal.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL,
            def: false,
            onSync: () => ctx.syncHoverPanelAvailability(),
          },
          {
            input: hoverRevealDelaySlider.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HOVER_REVEAL_DELAY,
            def: 160,
            isSelect: true,
            onSync: (value) => {
              hoverRevealDelaySlider.badge.textContent = value + " ms";
            },
          },
          {
            input: hoverRevealWidthSlider.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HOVER_REVEAL_WIDTH,
            def: 6,
            isSelect: true,
            onSync: (value) => {
              hoverRevealWidthSlider.badge.textContent = value + " px";
            },
          },
          {
            input: tEdgeAttached.input,
            pref: ctx.BGALAZKA_EXT_PREFS.EDGE_ATTACHED_PANELS,
            def: false,
            onSync: () => {
              const root = document.getElementById("zen-app-panel-root");
              ctx.applyVerticalResizeExtras(root);
              ctx.applyHorizontalPanelOffset(root);
            },
          },
          {
            input: tPush.input,
            pref: ctx.BGALAZKA_EXT_PREFS.PUSH_PAGE,
            def: false,
          },
          {
            input: tAllSidesResize.input,
            pref: ctx.BGALAZKA_EXT_PREFS.ALL_SIDES_RESIZE,
            def: false,
            onSync: () => ctx.ensurePillAllSidesResizeButton(),
          },
          {
            input: panelHorizontalOffsetSlider.input,
            pref: ctx.BGALAZKA_EXT_PREFS.PANEL_HORIZONTAL_OFFSET,
            def: ctx.getHorizontalOffsetPreference(
              document.getElementById("zen-app-panel-root"),
            ),
            isSelect: true,
            onSync: (v) => {
              const root = document.getElementById("zen-app-panel-root");
              ctx.cachedHorizontalOffset = v;
              if (root) {
                ctx.applyHorizontalPanelOffset(root);
                const applied = Math.round(
                  ctx.getAppliedHorizontalOffset(root),
                );
                const { min, max } = ctx.getHorizontalOffsetBounds(root);
                panelHorizontalOffsetSlider.input.min = Math.floor(min);
                panelHorizontalOffsetSlider.input.max = Math.ceil(max);
                panelHorizontalOffsetSlider.input.value = applied;
                panelHorizontalOffsetSlider.badge.textContent = applied + "px";
              } else {
                panelHorizontalOffsetSlider.badge.textContent = v + "px";
              }
            },
          },
          {
            input: tMasterPill.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_PILL,
            def: false,
            onSync: (v) =>
              pillSubgroup.setAttribute("data-hidden", v ? "true" : "false"),
          },
          {
            input: pillPosSlider.input,
            pref: ctx.BGALAZKA_EXT_PREFS.PILL_POSITION,
            def: 0,
            isSelect: true, // reused flag: means "sync via .value", true for <select> and <input type=range> alike
            onSync: (v) => {
              pillPosSlider.badge.textContent = v + "%";
              ctx.updateCSSVars();
            },
          },
          {
            input: tPeekDot.input,
            pref: ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT,
            def: false,
            onSync: (v) =>
              document.documentElement.setAttribute(
                "bgalazka-pill-peek-dot",
                v ? "true" : "false",
              ),
          },
          {
            input: peekColorRow.input,
            pref: ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
            def: "#4da6ff",
            isSelect: true, // reused flag: sync via .value, same as color/range inputs
            onSync: () => ctx.updateCSSVars(),
          },
          {
            input: peekOpacitySlider.input,
            pref: ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY,
            def: 90,
            isSelect: true, // reused flag: sync via .value, same as slider/color inputs
            onSync: (v) => {
              peekOpacitySlider.badge.textContent = v + "%";
              ctx.updateCSSVars();
            },
          },
          {
            input: pillBackgroundOpacitySlider.input,
            pref: ctx.BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY,
            def: 90,
            isSelect: true,
            onSync: (v) => {
              pillBackgroundOpacitySlider.badge.textContent = v + "%";
              ctx.updateCSSVars();
            },
          },
          {
            input: tWebToolbar.input,
            pref: ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED,
            def: false,
            onSync: (v) => {
              document.documentElement.setAttribute(
                "bgalazka-webtoolbar",
                v ? "true" : "false",
              );
              webToolbarSubgroup.setAttribute(
                "data-hidden",
                v ? "false" : "true",
              );
            },
          },
          {
            input: tToolbarAutohide.input,
            pref: ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_AUTOHIDE,
            def: false,
            onSync: (v) =>
              document.documentElement.setAttribute(
                "bgalazka-webtoolbar-autohide",
                v ? "true" : "false",
              ),
          },
          {
            input: tTripleInwardToolbars.input,
            pref: ctx.BGALAZKA_EXT_PREFS.TRIPLE_INWARD_TOOLBARS,
            def: true,
            onSync: (v) =>
              document.documentElement.setAttribute(
                "bgalazka-triple-inward-toolbars",
                String(v),
              ),
          },
          {
            input: tToolbarTop.input,
            pref: ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_TOP,
            def: false,
            onSync: (v) =>
              document.documentElement.setAttribute(
                "bgalazka-webtoolbar-top",
                v ? "true" : "false",
              ),
          },
          {
            input: tToolbarUrlbar.input,
            pref: ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_URLBAR,
            def: false,
            onSync: (v) =>
              document.documentElement.setAttribute(
                "bgalazka-webtoolbar-urlbar",
                v ? "true" : "false",
              ),
          },
          {
            input: tToolbarZoom.input,
            pref: ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ZOOM,
            def: false,
            onSync: (v) =>
              document.documentElement.setAttribute(
                "bgalazka-webtoolbar-zoom",
                v ? "true" : "false",
              ),
          },
          {
            input: tSearchEngine.select,
            pref: ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_ENGINE,
            def: "ddg",
            isSelect: true,
            onSync: (v) => {
              syncCustomSearchOptions();
              if (v === "browser") ctx.refreshBrowserSearchTemplate();
            },
          },
          {
            input: tSearchCustomUrl.input,
            pref: ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_CUSTOM_URL,
            def: "",
            isSelect: true, // reused flag: means "sync via .value", true for text inputs too
          },
          {
            input: tQuickswitch.input,
            pref: ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH,
            def: false,
            onSync: (v) =>
              quickSwitchTargetsSubgroup.setAttribute(
                "data-hidden",
                v ? "false" : "true",
              ),
          },
          ...quickSwitchTargetRows.map(({ input }, index) => ({
            input,
            pref:
              ctx.QUICK_SWITCH_TARGET_PREF_PREFIX +
              ctx.QUICK_SWITCH_BUILTIN_TARGETS[index].key,
            def: index < 2,
          })),
          ...quickSwitchCustomRows.map(({ input }, index) => ({
            input,
            pref: ctx.QUICK_SWITCH_CUSTOM_PREFS[index],
            def: "",
            isSelect: true,
          })),
          {
            input: tDualView.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_DUAL_VIEW,
            def: false,
          },
          {
            input: tHideHoverRevealBtn.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
            def: false,
            onSync: () => ctx.syncHoverPanelAvailability(),
          },
          {
            input: tHideHoverRevealBtnPillCategory.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
            def: false,
          },
          {
            input: tHideAllSidesResizeBtn.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_ALL_SIDES_RESIZE_BTN,
            def: false,
          },
          {
            input: tPin.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_PIN,
            def: false,
          },
          {
            input: t5.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_EXPAND,
            def: false,
          },
          {
            input: tGrabber.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_GRABBER,
            def: false,
          },
          {
            input: tRefresh.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_REFRESH,
            def: false,
          },
          {
            input: tClose.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_CLOSE,
            def: false,
          },
          {
            input: audioIndicator.input,
            pref: ctx.BGALAZKA_EXT_PREFS.AUDIO_INDICATOR,
            def: false,
          },
          {
            input: smartSleep.input,
            pref: ctx.BGALAZKA_EXT_PREFS.SMART_SLEEP,
            def: false,
          },
          {
            input: tAddonTabIdBridge.input,
            pref: ctx.BGALAZKA_EXT_PREFS.ADDON_TAB_ID_BRIDGE,
            def: false,
            onSync: (v) =>
              document.documentElement.setAttribute(
                "bgalazka-addon-tab-id-bridge",
                v ? "true" : "false",
              ),
          },
          {
            input: tZenInternetCss.input,
            pref: ctx.BGALAZKA_EXT_PREFS.ZEN_INTERNET_PANEL_CSS,
            def: false,
          },
          {
            input: tShowTripleStyleRepair.input,
            pref: ctx.BGALAZKA_EXT_PREFS.SHOW_TRIPLE_STYLE_REPAIR,
            def: false,
            onSync: () => ctx.updateWebToolbarState(),
          },
          {
            input: tPeriodicFallbackPolling.input,
            pref: ctx.BGALAZKA_EXT_PREFS.PERIODIC_FALLBACK_POLLING,
            def: false,
          },
          {
            input: tShowAddonHostFolder.input,
            pref: ctx.BGALAZKA_EXT_PREFS.SHOW_ADDON_HOST_FOLDER,
            def: false,
            onSync: (v) =>
              document.documentElement.setAttribute(
                "bgalazka-show-addon-host-folder",
                v ? "true" : "false",
              ),
          },
          {
            input: tMmbUnloadNormalTabs.input,
            pref: ctx.BGALAZKA_EXT_PREFS.MMB_UNLOAD_NORMAL_TABS,
            def: false,
          },
          {
            input: tKeybindsEnabled.input,
            pref: ctx.BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED,
            def: false,
            onSync: (v) => {
              keybindSubgroup.setAttribute("data-hidden", v ? "false" : "true");
              if (v) {
                ctx.setPref(ctx.BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, true);
                document.documentElement.setAttribute(
                  "bgalazka-panel-input-shield",
                  "true",
                );
                tPanelInputShield.input.checked = true;
              }
            },
          },
          ...keybindRows.map(({ input }, index) => ({
            input,
            pref: ctx.EXT_KEYBIND_ACTIONS[index].pref,
            def: ctx.EXT_KEYBIND_DEFAULTS[ctx.EXT_KEYBIND_ACTIONS[index].key],
            isSelect: true,
          })),
          {
            input: t4.input,
            pref: ctx.BGALAZKA_EXT_PREFS.CORNER_TILES,
            def: false,
            onSync: (v) => cornerSubgroup.setAttribute("data-hidden", "false"),
          },
          {
            input: tAllTabs.input,
            pref: ctx.BGALAZKA_EXT_PREFS.ALL_TAB_PANELS,
            def: false,
            onSync: () => ctx.requestTileSync(0),
          },
          {
            input: tHoverCorner.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HOVER_CORNER_TILES,
            def: false,
          },
          {
            input: tHideUnattached.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_UNATTACHED_APP_CONTROLS,
            def: false,
          },
          {
            input: t3.input,
            pref: ctx.BGALAZKA_EXT_PREFS.TAB_ISOLATION,
            def: true,
          },
          {
            input: tBadges.input,
            pref: ctx.BGALAZKA_EXT_PREFS.HIDE_CORNER_BADGES,
            def: false,
          },
        );

        // Bulk actions change only boolean feature controls. Slider values,
        // search URLs, shortcut assignments, and saved panel geometry survive.
        // Clicking each control runs its existing live-update handler.
        const presetActions = document.createElement("div");
        presetActions.className = "zs-extension-presets";
        panel._toggles.push(...recoveryControls);
        const recommendedExceptions = new Set([
          ctx.BGALAZKA_EXT_PREFS.PERIODIC_FALLBACK_POLLING,
          ctx.BGALAZKA_EXT_PREFS.SHOW_TRIPLE_STYLE_REPAIR,
          ctx.BGALAZKA_EXT_PREFS.EDGE_ATTACHED_PANELS,
          ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_TOP,
          ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_AUTOHIDE,
          ctx.BGALAZKA_EXT_PREFS.ADDON_TAB_ID_BRIDGE,
          ctx.BGALAZKA_EXT_PREFS.SHOW_ADDON_HOST_FOLDER,
          ctx.EXT_PREFS.TABBAR_COMPACT,
          LOOK_PREFS.DENSITY_ICONS,
          LOOK_PREFS.DENSITY_NEWTAB,
          LOOK_PREFS.DENSITY_URLBAR,
          LOOK_PREFS.DENSITY_ESSENTIALS,
          ctx.EXT_PREFS.RSS_HIDE_EMPTY,
          ctx.EXT_PREFS.RSS_COMPACT_HEADERS,
        ]);
        const applyPreset = (recommended) => {
          const message = recommended
            ? "Apply recommended extension switches? This will replace your current on/off choices. Custom values and shortcuts will be kept."
            : "Turn off every extension switch? This will replace your current on/off choices. Custom values and shortcuts will be kept.";
          if (!window.confirm(message)) return;
          for (const { input, pref, isSelect } of panel._toggles) {
            if (isSelect || input.type !== "checkbox") continue;
            const experimental = /experimental/i.test(
              input.closest(".zs-row")?.textContent || "",
            );
            const wanted =
              recommended &&
              !pref.startsWith("zen.workspace.bgalazka.hide_") &&
              !recommendedExceptions.has(pref) &&
              !experimental;
            if (input.checked !== wanted) input.click();
          }
          // The video category is built by a separate extension module and
          // keeps its own pref namespace, so include its visible switches too.
          for (const input of modal.querySelectorAll(
            '#zs-panel-video-cloning input[type="checkbox"]',
          )) {
            const isHideOption = /hide/i.test(
              input.closest(".zs-row")?.textContent || "",
            );
            const wanted = recommended && !isHideOption;
            if (input.checked !== wanted) input.click();
          }
        };
        for (const [label, recommended] of [
          ["Recommended settings", true],
          ["Turn everything off", false],
        ]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "zs-extension-preset-btn";
          button.textContent = label;
          button.addEventListener("click", () => applyPreset(recommended));
          presetActions.appendChild(button);
        }
        content.prepend(presetActions);

        // ------------------------------------------------------------------
        // SETTINGS CATEGORY SPLIT
        // ------------------------------------------------------------------
        // These are real sibling Settings categories/tabs, not headings inside
        // Extension Core. We build them from the same controls so persistence
        // and live synchronization remain centralized in panel._toggles.
        const makeExtensionSettingsPanel = (id, dataPanel) => {
          const subPanel = document.createElement("div");
          subPanel.id = id;
          subPanel.className = "zs-tab-panel zs-extension-subpanel";
          subPanel.setAttribute("data-panel", dataPanel);
          const subContent = document.createElement("div");
          subContent.className = "zs-section-content";
          subContent.style.paddingTop = "14px";
          subPanel.appendChild(subContent);
          return { subPanel, subContent };
        };

        const tabsCategory = makeExtensionSettingsPanel(
          "zs-panel-extension-tabs",
          "extension-tabs",
        );
        cornerHeader.style.marginTop = "8px";
        tabsCategory.subContent.append(
          cornerHeader,
          t4.row,
          cornerSubgroup,
          tHideUnattached.row,
        );

        const hideCategory = makeExtensionSettingsPanel(
          "zs-panel-extension-hide-pill",
          "extension-hide-pill",
        );
        hidePillHeader.style.marginTop = "8px";
        hideCategory.subContent.append(hidePillHeader, hidePillGroup);

        const keybindCategory = makeExtensionSettingsPanel(
          "zs-panel-extension-keybinds",
          "extension-keybinds",
        );
        keybindHeader.style.marginTop = "8px";
        keybindCategory.subContent.append(
          keybindHeader,
          tMmbUnloadNormalTabs.row,
          tKeybindsEnabled.row,
          keybindSubgroup,
        );

        const toolbarCategory = makeExtensionSettingsPanel(
          "zs-panel-extension-toolbar",
          "extension-toolbar",
        );
        toolbarHeader.style.marginTop = "8px";
        toolbarCategory.subContent.append(
          toolbarHeader,
          tWebToolbar.row,
          webToolbarSubgroup,
        );

        const searchCategory = makeExtensionSettingsPanel(
          "zs-panel-extension-search",
          "extension-search",
        );
        const searchHeader = document.createElement("div");
        searchHeader.className = "zs-section-header";
        const searchTitle = document.createElement("h3");
        searchTitle.className = "zs-section-title";
        searchTitle.textContent = "Search Engines";
        searchHeader.appendChild(searchTitle);

        const customEnginesHeader = document.createElement("div");
        customEnginesHeader.className =
          "zs-section-header zs-subsection-header";
        const customEnginesTitle = document.createElement("h3");
        customEnginesTitle.className = "zs-section-title";
        customEnginesTitle.textContent = "Custom Engines";
        customEnginesHeader.appendChild(customEnginesTitle);

        searchCategory.subContent.append(
          searchHeader,
          tSearchEngine.row,
          customEnginesHeader,
          customSearchSubgroup,
          tQuickswitch.row,
          quickSwitchTargetsSubgroup,
        );

        const rssCategory = makeExtensionSettingsPanel(
          "zs-panel-extension-rss",
          "extension-rss",
        );
        const rssHeader = document.createElement("div");
        rssHeader.className = "zs-section-header";
        const rssTitle = document.createElement("h3");
        rssTitle.className = "zs-section-title";
        rssTitle.textContent = "RSS live folders";
        rssHeader.appendChild(rssTitle);
        const rssNote = document.createElement("p");
        rssNote.className = "zs-sublabel";
        rssNote.textContent =
          "Keep your native feeds and their individual output folders. These switches only change how live folders appear in the sidebar.";
        const rssHideEmpty = createToggleRow(
          "Hide empty live folders",
          "Free sidebar space when a live folder has no articles. Folders return when Zen adds items; other live-folder providers are included.",
          ctx.EXT_PREFS.RSS_HIDE_EMPTY,
          null,
          false,
          null,
          syncRssFolderDisplay,
        );
        const rssCompact = createToggleRow(
          "Compact live-folder headers",
          "Reduce the height and spacing of live-folder rows, including folders that have articles.",
          ctx.EXT_PREFS.RSS_COMPACT_HEADERS,
          null,
          false,
          null,
          syncRssFolderDisplay,
        );
        rssCategory.subContent.append(
          rssHeader,
          rssNote,
          rssHideEmpty.row,
          rssCompact.row,
        );
        panel._toggles.push(
          {
            input: rssHideEmpty.input,
            pref: ctx.EXT_PREFS.RSS_HIDE_EMPTY,
            def: false,
          },
          {
            input: rssCompact.input,
            pref: ctx.EXT_PREFS.RSS_COMPACT_HEADERS,
            def: false,
          },
        );

        // Keep every pill-related control together: appearance first, then the
        // visibility list. Moving existing nodes preserves all listeners.
        hidePillTitle.textContent = "Pill Controls";
        hideCategory.subContent.prepend(
          pillHeader,
          tMasterPill.row,
          pillSubgroup,
        );

        // Move the existing appearance controls, retaining their original event
        // handlers. The group-opacity control is owned by the base settings UI.
        const lookCategory = makeExtensionSettingsPanel(
          "zs-panel-extension-look",
          "extension-look",
        );
        lookCategory.subContent.classList.add("zs-look-content");
        const lookIntro = document.createElement("div");
        lookIntro.className = "zs-look-intro";
        lookIntro.innerHTML = `<span class="zs-look-eyebrow">LOOK</span>
        <h3>Appearance</h3>
        <p>Every visual choice below saves as you change it. Classic restores the previous style.</p>`;
        lookCategory.subContent.append(lookIntro);
        const addLookHeading = (label) => {
          const heading = document.createElement("h4");
          heading.className = "zs-look-heading";
          heading.textContent = label;
          lookCategory.subContent.appendChild(heading);
        };
        const lookControls = [];
        const ensureCustomLook = (key) => {
          if (
            key !== LOOK_PREFS.STYLE &&
            ctx.getPref(LOOK_PREFS.STYLE, "atelier") === "classic"
          ) {
            ctx.setPref(LOOK_PREFS.STYLE, "atelier");
            lookCategory.subPanel._syncLook?.();
          }
          applyLook();
        };
        const addLookSelect = (label, description, key, options) => {
          const control = createSelectRow(
            label,
            description,
            key,
            options,
            LOOK_DEFAULTS[key],
            null,
            null,
            () => ensureCustomLook(key),
          );
          control.select.removeAttribute("style");
          lookCategory.subContent.append(control.row);
          lookControls.push({ input: control.select, key });
        };
        const addLookColor = (label, description, key) => {
          const control = createColorRow(
            label,
            description,
            key,
            LOOK_DEFAULTS[key],
          );
          control.input.addEventListener("input", () => ensureCustomLook(key));
          lookCategory.subContent.append(control.row);
          lookControls.push({ input: control.input, key });
        };
        const addLookSlider = (label, description, key, min, max, suffix) => {
          const inverted = LOOK_TRANSPARENCY_KEYS.has(key);
          const invert = (value) => 100 - value;
          const control = createSliderRow(
            label,
            description,
            key,
            min,
            max,
            LOOK_DEFAULTS[key],
            suffix,
            inverted ? invert : undefined,
            inverted ? invert : undefined,
          );
          // Density controls apply in Classic as well; changing them must not
          // switch the user's other Look choices to Custom.
          if (
            key !== LOOK_PREFS.TABBAR_ROW_HEIGHT &&
            key !== LOOK_PREFS.TABBAR_ROW_GAP &&
            key !== LOOK_PREFS.TABBAR_ICON_GAP &&
            key !== LOOK_PREFS.ESSENTIALS_HEIGHT &&
            key !== LOOK_PREFS.TABBAR_SECTION_GAP &&
            key !== LOOK_PREFS.FOLDER_ICON_SIZE &&
            key !== LOOK_PREFS.WORKSPACE_ICON_SIZE &&
            key !== LOOK_PREFS.WORKSPACE_HEIGHT &&
            key !== LOOK_PREFS.BOTTOM_BAR_HEIGHT &&
            key !== LOOK_PREFS.URLBAR_TOP_GAP &&
            key !== LOOK_PREFS.NEWTAB_HEIGHT
          )
            control.input.addEventListener("input", () =>
              ensureCustomLook(key),
            );
          lookCategory.subContent.append(control.row);
          lookControls.push({
            input: control.input,
            badge: control.badge,
            suffix,
            key,
            inverted,
          });
        };
        const syncLookControls = () => {
          for (const { input, badge, suffix, key, inverted } of lookControls) {
            const value = ctx.getPref(key, LOOK_DEFAULTS[key]);
            input.value = inverted ? 100 - value : value;
            if (badge) badge.textContent = input.value + suffix;
          }
        };
        lookCategory.subPanel._syncLook = syncLookControls;
        addLookHeading("Arc 2.0");
        const arcSidebarToggle = createToggleRow(
          "Arc 2.0 tweak: apply compact mode sidebar theme to regular mode sidebar",
          "Follow Arc 2.0's compact sidebar color and opacity. Applies immediately; the main browser background keeps its current opacity.",
          arcSidebarPref,
          null,
          false,
        );
        lookCategory.subContent.append(arcSidebarToggle.row);
        const arcLibraryToggle = createToggleRow(
          "Arc 2.0 tweak: apply compact sidebar theme to Zen Library",
          "Use Arc 2.0's compact sidebar background color and opacity for the new Zen Library. Applies immediately, including while Library is open.",
          arcLibraryPref,
          null,
          false,
        );
        lookCategory.subContent.append(arcLibraryToggle.row);
        panel._toggles.push({
          input: arcLibraryToggle.input,
          pref: arcLibraryPref,
          def: false,
        });
        panel._toggles.push({
          input: arcSidebarToggle.input,
          pref: arcSidebarPref,
          def: false,
        });
        addLookHeading("Style");
        addLookSelect(
          "Interface style",
          "Switch to the original styling any time",
          LOOK_PREFS.STYLE,
          [
            { value: "atelier", label: "Custom" },
            { value: "classic", label: "Classic" },
          ],
        );
        const themeChoices = document.createElement("div");
        themeChoices.className = "zs-look-themes";
        for (const theme of LOOK_THEMES) {
          const choice = document.createElement("button");
          choice.type = "button";
          choice.className = "zs-look-theme";
          choice.style.setProperty("--zs-theme-swatch", theme.swatch);
          choice.textContent = theme.name;
          choice.title =
            "Apply " + theme.name + "; every value stays editable below";
          choice.addEventListener("click", () => {
            for (const [key, value] of Object.entries(LOOK_DEFAULTS)) {
              // Theme swatches change colors and shapes, not the user's chosen
              // sidebar density. Reset Look defaults still turns it off.
              if (
                key === LOOK_PREFS.TABBAR_COMPACT ||
                key === LOOK_PREFS.TABBAR_ROW_HEIGHT ||
                key === LOOK_PREFS.TABBAR_ROW_GAP ||
                key === LOOK_PREFS.TABBAR_ICON_GAP ||
                key === LOOK_PREFS.DENSITY_ICONS ||
                key === LOOK_PREFS.DENSITY_NEWTAB ||
                key === LOOK_PREFS.DENSITY_URLBAR ||
                key === LOOK_PREFS.DENSITY_ESSENTIALS ||
                key === LOOK_PREFS.ESSENTIALS_HEIGHT ||
                key === LOOK_PREFS.TABBAR_SECTION_GAP ||
                key === LOOK_PREFS.FOLDER_ICON_SIZE ||
                key === LOOK_PREFS.WORKSPACE_ICON_SIZE ||
                key === LOOK_PREFS.WORKSPACE_HEIGHT ||
                key === LOOK_PREFS.BOTTOM_BAR_HEIGHT ||
                key === LOOK_PREFS.URLBAR_TOP_GAP ||
                key === LOOK_PREFS.NEWTAB_HEIGHT
              )
                continue;
              if (
                key.startsWith("zen.workspace.bgalazka.look.") ||
                key === LOOK_PREFS.VIDEO_RADIUS
              )
                ctx.setPref(key, theme.values[key] ?? value);
              else if (Object.hasOwn(theme.values, key))
                ctx.setPref(key, theme.values[key]);
            }
            syncAppearanceAfterImport();
          });
          themeChoices.append(choice);
        }
        lookCategory.subContent.append(themeChoices);
        addLookHeading("Palette");
        addLookColor(
          "Canvas",
          "Backdrop behind the controls",
          LOOK_PREFS.CANVAS,
        );
        addLookColor(
          "Surface",
          "Main cards and floating panels",
          LOOK_PREFS.SURFACE,
        );
        addLookColor(
          "Raised surface",
          "Controls, hover states and nested cards",
          LOOK_PREFS.RAISED,
        );
        addLookColor(
          "Accent",
          "Active indicators and highlights",
          LOOK_PREFS.ACCENT,
        );
        addLookColor("Text", "Main labels", LOOK_PREFS.TEXT);
        addLookColor(
          "Secondary text",
          "Descriptions and captions",
          LOOK_PREFS.MUTED,
        );
        addLookHeading("Transparency");
        const transparencyHelp = document.createElement("p");
        transparencyHelp.className = "zs-look-note";
        transparencyHelp.textContent =
          "0% is solid; 100% clears panel backgrounds. Dual and Triple View keep content fully visible.";
        lookCategory.subContent.append(transparencyHelp);
        addLookSlider(
          "Panel background",
          "Both panel frames; whole-panel opacity still applies on top",
          LOOK_PREFS.SURFACE_OPACITY,
          0,
          100,
          "%",
        );
        addLookSlider(
          "Raised surfaces",
          "Hovered toolbar buttons",
          LOOK_PREFS.RAISED_OPACITY,
          0,
          100,
          "%",
        );
        addLookSlider(
          "Panel toolbars",
          "Top and secondary toolbar backgrounds",
          LOOK_PREFS.TOOLBAR_OPACITY,
          0,
          100,
          "%",
        );
        addLookSlider(
          "Address fields",
          "Both panel address field backgrounds",
          LOOK_PREFS.ADDRESS_OPACITY,
          0,
          100,
          "%",
        );
        addLookSlider(
          "Button fills",
          "Filled navigation and zoom buttons",
          LOOK_PREFS.BUTTON_OPACITY,
          0,
          100,
          "%",
        );
        addLookSlider(
          "App tiles",
          "Soft tile and hovered tile backgrounds",
          LOOK_PREFS.TILE_OPACITY,
          0,
          100,
          "%",
        );
        addLookSlider(
          "Video backdrop",
          "Video preview frame, without fading the picture",
          LOOK_PREFS.VIDEO_OPACITY,
          0,
          100,
          "%",
        );
        addLookSlider(
          "Video controls",
          "Filled video buttons and selected source highlight",
          LOOK_PREFS.VIDEO_CONTROL_OPACITY,
          0,
          100,
          "%",
        );
        addLookSlider(
          "Group popup",
          "Tab group control popup background",
          LOOK_PREFS.POPUP_OPACITY,
          0,
          100,
          "%",
        );
        addLookHeading("Tab bar");
        const compactTabbar = createToggleRow(
          "Compact tabs and folders",
          "Tighter tab and folder rows with room for favicons and readable titles. Text size stays controlled by your other mod.",
          LOOK_PREFS.TABBAR_COMPACT,
          "bgalazka-tabbar-compact",
          false,
        );
        lookCategory.subContent.append(compactTabbar.row);
        panel._toggles.push({
          input: compactTabbar.input,
          pref: LOOK_PREFS.TABBAR_COMPACT,
          def: false,
        });
        addLookSlider(
          "Tab and folder height",
          "Minimum row height; titles grow if your font needs more room",
          LOOK_PREFS.TABBAR_ROW_HEIGHT,
          18,
          36,
          " px",
        );
        addLookSlider(
          "Space between rows",
          "0 px puts adjacent favicons as close as the row height allows",
          LOOK_PREFS.TABBAR_ROW_GAP,
          0,
          8,
          " px",
        );
        addLookSlider(
          "Icon to title gap",
          "Space after each favicon, without changing icon or text size",
          LOOK_PREFS.TABBAR_ICON_GAP,
          0,
          12,
          " px",
        );
        for (const [label, description, key, attribute] of [
          [
            "Compact sidebar controls",
            "Use 16 px toolbar and Essentials icons. Folder and workspace sizes have separate sliders below.",
            LOOK_PREFS.DENSITY_ICONS,
            "bgalazka-density-icons",
          ],
          [
            "Compact New Tab button",
            "Use the New Tab height slider below with tighter padding.",
            LOOK_PREFS.DENSITY_NEWTAB,
            "bgalazka-density-newtab",
          ],
          [
            "Compact address bar",
            "Fit the idle address bar to its text with minimal padding. The expanded address field keeps its normal layout.",
            LOOK_PREFS.DENSITY_URLBAR,
            "bgalazka-density-urlbar",
          ],
          [
            "Custom Essentials height",
            "Enable the Essentials tile height slider below.",
            LOOK_PREFS.DENSITY_ESSENTIALS,
            "bgalazka-density-essentials",
          ],
        ]) {
          const control = createToggleRow(
            label,
            description,
            key,
            attribute,
            false,
          );
          lookCategory.subContent.append(control.row);
          panel._toggles.push({ input: control.input, pref: key, def: false });
        }
        addLookSlider(
          "Essentials height",
          "Tile height in pixels when Custom Essentials height is on",
          LOOK_PREFS.ESSENTIALS_HEIGHT,
          20,
          64,
          " px",
        );
        addLookSlider(
          "Pinned to normal tabs spacing",
          "Extra space on each side of the divider when Compact tabs and folders is on; Clear stays clickable",
          LOOK_PREFS.TABBAR_SECTION_GAP,
          0,
          20,
          " px",
        );
        addLookSlider(
          "Folder icon size",
          "Folder and live-folder icons when Compact sidebar controls is on",
          LOOK_PREFS.FOLDER_ICON_SIZE,
          12,
          28,
          " px",
        );
        addLookSlider(
          "Workspace icon size",
          "Workspace indicator icon when Compact sidebar controls is on",
          LOOK_PREFS.WORKSPACE_ICON_SIZE,
          12,
          28,
          " px",
        );
        addLookSlider(
          "Workspace indicator height",
          "Minimum height of the workspace name row when Compact sidebar controls is on",
          LOOK_PREFS.WORKSPACE_HEIGHT,
          18,
          40,
          " px",
        );
        addLookSlider(
          "Bottom bar height",
          "Bottom toolbar height when Compact sidebar controls is on",
          LOOK_PREFS.BOTTOM_BAR_HEIGHT,
          20,
          40,
          " px",
        );
        addLookSlider(
          "Space above address bar",
          "Spacing below the top buttons when Compact address bar is on",
          LOOK_PREFS.URLBAR_TOP_GAP,
          0,
          16,
          " px",
        );
        addLookSlider(
          "New Tab button height",
          "Row height when Compact New Tab button is on",
          LOOK_PREFS.NEWTAB_HEIGHT,
          18,
          36,
          " px",
        );
        addLookHeading("Shape & depth");
        addLookSlider(
          "Corner radius",
          "0 px keeps windows and controls square",
          LOOK_PREFS.RADIUS,
          0,
          26,
          " px",
        );
        addLookSlider(
          "Panel border",
          "0 px removes the floating window outline",
          LOOK_PREFS.PANEL_BORDER,
          0,
          3,
          " px",
        );
        addLookSlider(
          "Shadow depth",
          "0 removes the floating window shadow",
          LOOK_PREFS.DEPTH,
          0,
          100,
          "%",
        );
        addLookSelect(
          "Spacing",
          "Space between settings and controls",
          LOOK_PREFS.SPACING,
          [
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Comfortable" },
            { value: "airy", label: "Airy" },
          ],
        );
        addLookHeading("Buttons & settings");
        addLookSelect(
          "Button style",
          "Applies to toolbars, video and settings actions",
          LOOK_PREFS.BUTTON_STYLE,
          [
            { value: "plain", label: "Flat" },
            { value: "filled", label: "Filled" },
            { value: "outline", label: "Outline" },
          ],
        );
        addLookColor(
          "Button fill",
          "Fill for the Filled style",
          LOOK_PREFS.BUTTON_SURFACE,
        );
        addLookColor("Button text", "Icons and labels", LOOK_PREFS.BUTTON_TEXT);
        addLookColor(
          "Button outline",
          "Outline style and focus edge",
          LOOK_PREFS.BUTTON_BORDER_COLOR,
        );
        addLookSlider(
          "Button border width",
          "0 px removes outlines, including Filled buttons",
          LOOK_PREFS.BUTTON_BORDER,
          0,
          3,
          " px",
        );
        addLookSlider(
          "Control size",
          "Toolbar and video action buttons",
          LOOK_PREFS.CONTROL_SIZE,
          18,
          32,
          " px",
        );
        addLookSelect(
          "App tiles",
          "Bare or softly filled launchers",
          LOOK_PREFS.TILE_STYLE,
          [
            { value: "bare", label: "Bare" },
            { value: "soft", label: "Soft fill" },
          ],
        );
        addLookSelect(
          "Setting rows",
          "Simple lines or individual cards",
          LOOK_PREFS.ROW_STYLE,
          [
            { value: "lines", label: "Lines" },
            { value: "cards", label: "Cards" },
          ],
        );
        addLookSlider(
          "Row padding",
          "Vertical space inside a setting",
          LOOK_PREFS.ROW_PADDING,
          4,
          20,
          " px",
        );
        addLookSlider(
          "Row divider",
          "0 removes row lines and card outlines",
          LOOK_PREFS.ROW_RULE,
          0,
          2,
          " px",
        );
        addLookHeading("Panel toolbar");
        addLookColor(
          "Toolbar surface",
          "Behind navigation and zoom controls",
          LOOK_PREFS.TOOLBAR_SURFACE,
        );
        addLookColor(
          "Address field",
          "Background of the second address bar",
          LOOK_PREFS.TOOLBAR_URL,
        );
        addLookSlider(
          "Toolbar divider",
          "0 removes the line above the bar",
          LOOK_PREFS.TOOLBAR_BORDER,
          0,
          3,
          " px",
        );
        addLookHeading("Sidebar video");
        addLookColor(
          "Video surface",
          "Backdrop around the picture",
          LOOK_PREFS.VIDEO_CANVAS,
        );
        addLookColor(
          "Video control fill",
          "Fill used by the Filled button style",
          LOOK_PREFS.VIDEO_CONTROL,
        );
        addLookColor(
          "Video text",
          "Source and action labels",
          LOOK_PREFS.VIDEO_TEXT,
        );
        addLookColor(
          "Video muted text",
          "Caption and source details",
          LOOK_PREFS.VIDEO_MUTED,
        );
        addLookColor(
          "Selected source",
          "Small selection marker or filled highlight",
          LOOK_PREFS.VIDEO_SELECTED,
        );
        addLookSlider(
          "Video border",
          "0 removes the card and picture outline",
          LOOK_PREFS.VIDEO_BORDER,
          0,
          3,
          " px",
        );
        addLookSlider(
          "Video padding",
          "Space around the media and controls",
          LOOK_PREFS.VIDEO_PADDING,
          0,
          16,
          " px",
        );
        addLookSlider(
          "Source row height",
          "Height of each source in the list",
          LOOK_PREFS.VIDEO_ROW_HEIGHT,
          22,
          36,
          " px",
        );
        addLookSelect(
          "Source selection",
          "Line or filled highlight, without a box border",
          LOOK_PREFS.VIDEO_SOURCE_STYLE,
          [
            { value: "line", label: "Line" },
            { value: "filled", label: "Filled" },
          ],
        );
        addLookHeading("Existing appearance");
        lookCategory.subContent.append(aestheticHeader, t1.row, slidersGroup);
        const pillLookGroup = document.createElement("div");
        pillLookGroup.className = "zs-look-group";
        pillLookGroup.append(
          peekColorRow.row,
          peekOpacitySlider.row,
          pillBackgroundOpacitySlider.row,
        );
        lookCategory.subContent.append(pillLookGroup);
        const groupOpacity = modal
          .querySelector("#zs-tg-opacity")
          ?.closest(".zs-stacked-slider");
        if (groupOpacity) lookCategory.subContent.append(groupOpacity);
        const groupIndicator = modal.querySelector("#zs-tg-indicator-type-row");
        const groupToggle = modal
          .querySelector("#zs-tg-chevron")
          ?.closest(".zs-row");
        if (groupToggle) lookCategory.subContent.append(groupToggle);
        if (groupIndicator) lookCategory.subContent.append(groupIndicator);
        // Base settings normally persist these on Save. In Look they save as
        // soon as they change, just like the other live appearance controls.
        const groupOpacityInput = modal.querySelector("#zs-tg-opacity");
        groupOpacityInput?.addEventListener("input", () =>
          ctx.setPref(
            LOOK_GROUP_PREFS.LABEL_OPACITY,
            Number(groupOpacityInput.value),
          ),
        );
        const indicatorToggle = modal.querySelector("#zs-tg-chevron");
        indicatorToggle?.addEventListener("change", () => {
          ctx.setPref(LOOK_GROUP_PREFS.SHOW_CHEVRON, indicatorToggle.checked);
          window.Zentral?.TabGroups?.applyChevronPref?.();
        });
        groupIndicator
          ?.querySelectorAll(".zs-custom-select-option")
          .forEach((option) =>
            option.addEventListener("click", () => {
              ctx.setPref(
                LOOK_GROUP_PREFS.INDICATOR_TYPE,
                option.dataset.value,
              );
              window.Zentral?.TabGroups?.applyIndicatorTypePref?.();
            }),
          );
        const resetLook = document.createElement("button");
        resetLook.type = "button";
        resetLook.className = "zs-look-action";
        resetLook.textContent = "Reset Look defaults";
        resetLook.addEventListener("click", () => {
          if (!window.confirm("Reset all Look options to their defaults?"))
            return;
          for (const [key, value] of Object.entries(LOOK_DEFAULTS))
            ctx.setPref(key, value);
          syncAppearanceAfterImport();
        });
        lookCategory.subContent.append(resetLook);
        addLookBackupControls(lookCategory.subContent);

        panel.appendChild(content);
        body.append(
          panel,
          lookCategory.subPanel,
          tabsCategory.subPanel,
          hideCategory.subPanel,
          toolbarCategory.subPanel,
          searchCategory.subPanel,
          rssCategory.subPanel,
          keybindCategory.subPanel,
        );
        ctx.registerCleanup(() => {
          const wasActive = Boolean(
            modal.querySelector(
              '#zs-panel-bgalazka[data-active="true"], .zs-extension-subpanel[data-active="true"]',
            ),
          );
          modal
            .querySelectorAll(
              '#zs-panel-bgalazka, .zs-extension-subpanel, #zs-tab-btn-bgalazka, [id^="zs-tab-btn-extension-"]',
            )
            .forEach((node) => node.remove());
          for (const node of modal.querySelectorAll('[data-setting-key]')) {
            const meta = SETTINGS_ORGANIZATION.settings[node.dataset.settingKey];
            if (meta && !["apps", "tab-groups"].includes(meta.owner)) node.remove();
          }
          for (const category of SETTINGS_ORGANIZATION.categories) {
            if (["apps", "tab-groups", "video", "logger", "core"].includes(category.owner)) continue;
            modal.querySelector('#zs-panel-organized-' + category.id)?.remove();
            modal.querySelector('#zs-tab-btn-organized-' + category.id)?.remove();
          }
          if (wasActive) selectSettingsCategory(modal, "apps");
        });
      } else if (Array.isArray(panel._toggles)) {
        panel._toggles.forEach(({ input, pref, def, onSync, isSelect }) => {
          if (isSelect) {
            input.value = ctx.getPref(pref, def);
          } else {
            input.checked = ctx.getPref(pref, def);
          }
          if (typeof onSync === "function") {
            onSync(isSelect ? input.value : input.checked);
          }
        });
      }

      panel._syncBacking?.();
      modal.querySelector("#zs-panel-extension-look")?._syncLook?.();
      applyLook();
      const extensionCategories = [
        {
          buttonId: "zs-tab-btn-bgalazka",
          panelId: "zs-panel-bgalazka",
          dataTab: "bgalazka",
          label: "Panels",
        },
        {
          buttonId: "zs-tab-btn-extension-look",
          panelId: "zs-panel-extension-look",
          dataTab: "extension-look",
          label: "Look",
        },
        {
          buttonId: "zs-tab-btn-extension-tabs",
          panelId: "zs-panel-extension-tabs",
          dataTab: "extension-tabs",
          label: "Tabs",
        },
        {
          buttonId: "zs-tab-btn-extension-hide-pill",
          panelId: "zs-panel-extension-hide-pill",
          dataTab: "extension-hide-pill",
          label: "Pill",
        },
        {
          buttonId: "zs-tab-btn-extension-toolbar",
          panelId: "zs-panel-extension-toolbar",
          dataTab: "extension-toolbar",
          label: "Toolbar",
        },
        {
          buttonId: "zs-tab-btn-extension-search",
          panelId: "zs-panel-extension-search",
          dataTab: "extension-search",
          label: "Search",
        },
        {
          buttonId: "zs-tab-btn-extension-rss",
          panelId: "zs-panel-extension-rss",
          dataTab: "extension-rss",
          label: "RSS",
        },
        {
          buttonId: "zs-tab-btn-extension-keybinds",
          panelId: "zs-panel-extension-keybinds",
          dataTab: "extension-keybinds",
          label: "Shortcuts",
        },
      ];

      // Label the base categories without changing the original code.
      const baseSettings = modal.querySelector(
        '.zs-tab-btn[data-tab="settings"]',
      );
      const baseDiagnostics = modal.querySelector(
        '.zs-tab-btn[data-tab="diagnostics"]',
      );
      if (baseSettings) baseSettings.textContent = "Apps & Launchers";
      if (baseDiagnostics) baseDiagnostics.textContent = "Diagnostics";
      const diagnosticPanel = modal.querySelector("#zs-panel-diagnostics");
      if (
        diagnosticPanel &&
        !diagnosticPanel.querySelector("#zs-base-diagnostic-note")
      ) {
        const note = document.createElement("p");
        note.id = "zs-base-diagnostic-note";
        note.className = "zs-ownership-note";
        note.textContent =
          "Diagnostics and issue reports here are for the original Zentral base mod only. For problems caused by Bgalazka's extension, please do not contact the original creator.";
        diagnosticPanel.prepend(note);
      }
      const donation = modal.querySelector("#zs-kofi-btn");
      if (donation) {
        const message =
          "Donation for the original Zentral base mod only; it does not support Bgalazka's extension.";
        donation.title = message;
        donation.setAttribute("aria-label", message);
        if (!modal.querySelector("#zs-base-donation-note")) {
          const note = document.createElement("span");
          note.id = "zs-base-donation-note";
          note.className = "zs-donation-note";
          note.textContent = "Base mod donation only · original creator";
          donation.insertAdjacentElement("afterend", note);
        }
      }

      const extensionButtonIds = new Set(
        extensionCategories.map(({ buttonId }) => buttonId),
      );

      extensionCategories.forEach(({ buttonId, panelId, dataTab, label }) => {
        const targetPanel = modal.querySelector(`#${panelId}`);
        if (!targetPanel) return;
        let button = modal.querySelector(`#${buttonId}`);
        if (!button) {
          button = document.createElement("button");
          button.id = buttonId;
          button.className = "zs-tab-btn";
          button.setAttribute("data-tab", dataTab);
          tabBar.appendChild(button);
        }
        button.textContent = label;
        if (!button.dataset.bgalazkaBound) {
          button.dataset.bgalazkaBound = "true";
          button.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            modal
              .querySelectorAll(".zs-tab-bar .zs-tab-btn")
              .forEach((b) => b.removeAttribute("data-active"));
            modal
              .querySelectorAll(".zs-body .zs-tab-panel")
              .forEach((p) => p.removeAttribute("data-active"));
            button.setAttribute("data-active", "true");
            targetPanel.setAttribute("data-active", "true");
          });
        }
      });

      // One heading per category group frees space for actual setting names.
      // Keep the headings outside .zs-tab-btn so native click handling ignores
      // them, and put the extension heading before its first real tab.
      const firstExtension = modal.querySelector("#zs-tab-btn-bgalazka");
      for (const [id, label, before] of [
        ["zs-base-category-label", "Base", baseSettings],
        ["zs-extension-category-label", "Extension", firstExtension],
      ]) {
        if (!before || modal.querySelector("#" + id)) continue;
        const heading = document.createElement("span");
        heading.id = id;
        heading.className = "zs-category-heading";
        heading.textContent = label;
        tabBar.insertBefore(heading, before);
      }

      // Native Zentral tab buttons do not know about extension-injected panels,
      // so explicitly deactivate extension categories when a native
      // category is chosen. One capture listener is enough for the whole bar.
      if (!tabBar.dataset.bgalazkaCategoryGuard) {
        tabBar.dataset.bgalazkaCategoryGuard = "true";
        const categoryGuard = (e) => {
          const clicked = e.target.closest(".zs-tab-btn");
          if (!clicked || extensionButtonIds.has(clicked.id)) return;
          extensionCategories.forEach(({ buttonId, panelId }) => {
            modal.querySelector(`#${buttonId}`)?.removeAttribute("data-active");
            modal.querySelector(`#${panelId}`)?.removeAttribute("data-active");
          });
        };
        tabBar.addEventListener("click", categoryGuard, true);
        ctx.registerCleanup(() => {
          tabBar.removeEventListener("click", categoryGuard, true);
          delete tabBar.dataset.bgalazkaCategoryGuard;
        });
      }
      organizeNativeSettings(modal);
    }
  });


});
})();
