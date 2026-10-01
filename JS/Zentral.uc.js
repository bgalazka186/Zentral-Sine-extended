// ==UserScript==
// @name Zentral Core and Settings
// @include chrome://browser/content/browser.xhtml
// @version 2.1.1
// ==/UserScript==
(function () {
  "use strict";
  if (window.ZentralRuntime) return;
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const VERSION = "3.0.2-framework";
  const ROOT = "chrome://sine/content/zentral/";
  const PREF = "zen.workspace.zentral.modules.";
  const definitions = new Map(),
    parts = new Map(),
    records = new Map(),
    styles = new Map(),
    disposers = [],
    availability = new Map();
  let ready = false,
    stopped = false,
    manager = null;
  const hookListeners = new Map(),
    hookLast = new Map();
  const hooks = {
    on(event, id, callback, priority = 0) {
      let entries = hookListeners.get(event);
      if (!entries) hookListeners.set(event, (entries = new Map()));
      if (entries.has(id)) throw new Error("Duplicate hook: " + id);
      entries.set(id, { callback, priority });
      if (hookLast.has(event)) {
        try {
          callback(hookLast.get(event));
        } catch (error) {
          console.error("[Zentral hook]", id, error);
        }
      }
      return () => entries.delete(id);
    },
    emit(event, payload) {
      hookLast.set(event, payload);
      for (const [id, entry] of [...(hookListeners.get(event) || [])].sort(
        (a, b) => a[1].priority - b[1].priority,
      )) {
        try {
          entry.callback(payload);
        } catch (error) {
          console.error("[Zentral hook]", id, error);
        }
      }
    },
  };
  const getPref = (key, fallback) => {
    try {
      switch (Services.prefs.getPrefType(key)) {
        case 128:
          return Services.prefs.getBoolPref(key);
        case 64:
          return Services.prefs.getIntPref(key);
        case 32:
          return Services.prefs.getStringPref(key);
      }
    } catch (_) {}
    return fallback;
  };
  const setPref = (key, value) => {
    if (typeof value === "boolean") Services.prefs.setBoolPref(key, value);
    else if (typeof value === "number")
      Services.prefs.setIntPref(key, Math.round(value));
    else Services.prefs.setStringPref(key, String(value));
  };
  const arcSidebarPref = "zen.workspace.zentral.arc2.match_compact_sidebar";
  const arcSidebarColorPref = "arc-compact-sidebar-bg";
  const arcSidebarAttribute = "zentral-arc2-regular-sidebar";
  const arcSidebarColorProperty = "--zentral-arc2-sidebar-background";
  const syncArcSidebar = () => {
    const color = getPref(arcSidebarColorPref, "");
    const active =
      getPref(arcSidebarPref, false) === true &&
      typeof color === "string" &&
      color.trim() !== "";
    document.documentElement.toggleAttribute(arcSidebarAttribute, active);
    if (active)
      document.documentElement.style.setProperty(
        arcSidebarColorProperty,
        color,
      );
    else document.documentElement.style.removeProperty(arcSidebarColorProperty);
  };
  const arcSidebarObserver = { observe: syncArcSidebar };
  syncArcSidebar();
  Services.prefs.addObserver(arcSidebarPref, arcSidebarObserver);
  Services.prefs.addObserver(arcSidebarColorPref, arcSidebarObserver);
  disposers.push(() => {
    Services.prefs.removeObserver(arcSidebarPref, arcSidebarObserver);
    Services.prefs.removeObserver(arcSidebarColorPref, arcSidebarObserver);
    document.documentElement.removeAttribute(arcSidebarAttribute);
    document.documentElement.style.removeProperty(arcSidebarColorProperty);
  });
  const enabled = (id) =>
    id === "extension-settings"
      ? true
      : getPref(PREF + id + ".enabled", true) !== false;
  const emit = () =>
    window.dispatchEvent(new CustomEvent("zentral-runtime-change"));
  const fail = (r, error) => {
    r.state = "failed";
    r.error = String(error?.stack || error);
    console.error(`[Zentral/${r.id}]`, error);
    emit();
  };
  const runtime = (window.ZentralRuntime = {
    version: VERSION,
    hooks,
    services: { platform: Services },
    shared: null,
    panelContext: null,
    setAvailable(id, value) {
      availability.set(id, !!value);
      const row = records.get(id);
      if (!row) return;
      if (!value && row.state === "registered") {
        row.state = "dormant";
        row.reason = "Base preference is off; enabling it starts this feature";
      } else if (value && row.state === "dormant") {
        row.state = "active";
        row.reason = undefined;
        if (ready) activateReady();
      }
      emit();
    },
    failFeature(id, error) {
      const row = records.get(id);
      if (row) fail(row, error);
    },
    addSettings(id, entries) {
      for (const entry of entries) {
        if (
          !entry.property ||
          SETTINGS_SCHEMA.some((x) => x.property === entry.property)
        )
          continue;
        SETTINGS_SCHEMA.push({ ...entry, feature: id });
      }
    },
    register(def) {
      if (!def?.id || typeof def.init !== "function")
        throw new Error("Feature registration needs id and init");
      if (definitions.has(def.id) || parts.has(def.id))
        throw new Error("Duplicate feature: " + def.id);
      definitions.set(def.id, def);
      if (def.settings) this.addSettings(def.id, def.settings);
    },
    registerPart(id, factory) {
      if (parts.has(id) || definitions.has(id))
        throw new Error("Duplicate feature: " + id);
      parts.set(id, { factory, iterator: null });
    },
    prepareParts(ctx) {
      for (const m of MANIFEST.filter((m) => m.part && enabled(m.id))) {
        const p = parts.get(m.id);
        if (!p) {
          if (m.optional) continue;
          throw new Error("Missing panel source: " + m.id);
        }
        p.iterator = p.factory(ctx);
        p.iterator.next();
      }
    },
    runPart(id) {
      const r = records.get(id),
        optional = MANIFEST.find((m) => m.id === id)?.optional;
      if (!enabled(id)) {
        if (r) r.state = "disabled";
        return;
      }
      const p = parts.get(id);
      if (!p?.iterator) {
        if (optional) {
          if (r) {
            r.state = "blocked";
            r.reason = "Optional source unavailable";
          }
          return;
        }
        throw new Error("Panel phase was not prepared: " + id);
      }
      const cleanup = runtime.panelContext?.cleanupFns;
      const before = cleanup?.length ?? 0;
      try {
        p.iterator.next();
        if (r) r.state = "active";
      } catch (e) {
        if (r) fail(r, e);
        if (!optional) throw e;
        for (const dispose of cleanup?.splice(before).reverse() || []) {
          try {
            dispose();
          } catch (error) {
            console.warn("[Zentral] Optional part cleanup", id, error);
          }
        }
      }
    },
    snapshot() {
      return {
        version: VERSION,
        ready,
        features: [...records.values()].map((r) => ({
          ...r,
          nextEnabled: enabled(r.id),
        })),
        css: [...styles.values()].map((r) => ({
          ...r,
          nextEnabled: getPref(PREF + "css." + r.id + ".enabled", true),
        })),
      };
    },
    openSettings: () => openManager(),
    destroy() {
      if (stopped) return;
      stopped = true;
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          dispose();
        } catch (e) {
          console.warn("[Zentral] Cleanup", e);
        }
      }
      for (const part of parts.values()) {
        try {
          part.iterator?.return();
        } catch (_) {}
      }
      hookLast.clear();
      hookListeners.clear();
      manager?.remove();
      delete window.ZentralRuntime;
    },
  });
  const MANIFEST = [
    {
      id: "logger",
      name: "Diagnostic logger",
      file: "JS/ZentralLogger.uc.js",
      description: "Console capture and diagnostic export.",
    },
    {
      id: "apps",
      name: "Apps and base panel engine",
      file: "JS/ZentralApps.uc.js",
      description: "Whole base class; owns browser and panel creation.",
    },
    {
      id: "tab-groups",
      name: "Tab groups",
      file: "JS/ZentralTabGroups.uc.js",
      description: "Independent of Apps and the panel extension.",
    },
    {
      id: "geometry",
      name: "Panel geometry",
      file: "JS/ZentralPanelGeometry.uc.js",
      part: true,
      optional: false,
      builtin: false,
      description:
        "Panel feature: prepared once, activated in the coordinator\u2019s documented order.",
      contextDependencies: ["panels"],
    },
    {
      id: "corner-panels",
      name: "Corner panels and tile interaction",
      file: "JS/ZentralCornerPanels.uc.js",
      part: true,
      optional: false,
      builtin: false,
      description:
        "Panel feature: prepared once, activated in the coordinator\u2019s documented order.",
      contextDependencies: [
        "browser-integrations",
        "panel-styles",
        "panel-toolbar",
        "panels",
      ],
    },
    {
      id: "panel-toolbar",
      name: "Panel URL bar, search and navigation",
      file: "JS/ZentralPanelToolbar.uc.js",
      part: true,
      optional: false,
      builtin: false,
      description:
        "Panel feature: prepared once, activated in the coordinator\u2019s documented order.",
      contextDependencies: ["geometry", "panel-styles", "panels"],
    },
    {
      id: "extension-settings",
      name: "Original extension settings",
      file: null,
      part: true,
      optional: true,
      builtin: true,
      description:
        "Panel feature: prepared once, activated in the coordinator\u2019s documented order.",
      contextDependencies: [
        "browser-integrations",
        "corner-panels",
        "geometry",
        "panel-styles",
        "panel-toolbar",
        "panels",
      ],
    },
    {
      id: "browser-integrations",
      name: "Containers and add-on browser hosts",
      file: "JS/ZentralBrowserIntegrations.uc.js",
      part: true,
      optional: false,
      builtin: false,
      description:
        "Panel feature: prepared once, activated in the coordinator\u2019s documented order.",
      contextDependencies: ["corner-panels", "panel-styles", "panels"],
    },
    {
      id: "panel-styles",
      name: "Panel browser collection and Zen Internet styles",
      file: "JS/ZentralPanelStyles.uc.js",
      part: true,
      optional: false,
      builtin: false,
      description:
        "Panel feature: prepared once, activated in the coordinator\u2019s documented order.",
      contextDependencies: ["browser-integrations", "panels"],
    },
    {
      id: "secondary-views",
      name: "Triple View and Super Pin",
      file: "JS/ZentralSecondaryViews.uc.js",
      part: true,
      optional: true,
      builtin: false,
      description:
        "Panel feature: prepared once, activated in the coordinator\u2019s documented order.",
      contextDependencies: [
        "browser-integrations",
        "corner-panels",
        "panel-styles",
        "panel-toolbar",
        "panels",
      ],
    },
    {
      id: "rss",
      name: "RSS folder display",
      file: "JS/ZentralRssDisplay.uc.js",
      description:
        "Independent folder styling; normal live preference switches.",
    },
    {
      id: "startup",
      name: "Load selected tabs at startup",
      file: "JS/ZentralStartup.uc.js",
      description:
        "Independent tab startup controller; waits for session and workspace restoration. Owns its stylesheet.",
    },
    {
      id: "tab-unload",
      name: "Middle-click tab unloading",
      file: "JS/ZentralTabUnload.uc.js",
      description:
        "Standalone. Requires only gBrowser and its about:config preference.",
    },
    {
      id: "panels",
      name: "Panel extension coordinator",
      file: "JS/ZentralPanels.uc.js",
      requires: ["apps"],
      sources: [
        "geometry",
        "corner-panels",
        "panel-toolbar",
        "extension-settings",
        "browser-integrations",
        "panel-styles",
      ],
      description:
        "Owns ordered integration and shared panel state. A missing required part blocks this suite, but settings, tab groups, RSS and video remain available.",
    },
    {
      id: "video",
      name: "Sidebar video preview",
      file: "JS/ZentralVideoPreview.uc.js",
      description:
        "Independent preview. Its normal enabled preference still controls playback.",
    },
  ];
  const CSS_MANIFEST = [
    {
      id: "Base",
      file: "CSS/ZentralBase.css",
      owner: "apps, tab-groups",
    },
    {
      id: "Panels",
      file: "CSS/ZentralPanels.css",
      owner: "panels",
    },
    {
      id: "CornerPanels",
      file: "CSS/ZentralCornerPanels.css",
      owner: "corner-panels",
    },
    {
      id: "Controls",
      file: "CSS/ZentralControls.css",
      owner: "panels, settings",
    },
    {
      id: "PanelToolbar",
      file: "CSS/ZentralPanelToolbar.css",
      owner: "panel-toolbar",
    },
    {
      id: "PanelGeometry",
      file: "CSS/ZentralPanelGeometry.css",
      owner: "geometry",
    },
    {
      id: "Settings",
      file: "CSS/ZentralSettings.css",
      owner: "settings",
    },
    {
      id: "BrowserIntegrations",
      file: "CSS/ZentralBrowserIntegrations.css",
      owner: "browser-integrations",
    },
    {
      id: "VideoPreview",
      file: "CSS/ZentralVideoPreview.css",
      owner: "video",
    },
    {
      id: "Appearance",
      file: "CSS/ZentralAppearance.css",
      owner: "shared appearance",
    },
    {
      id: "RssDisplay",
      file: "CSS/ZentralRssDisplay.css",
      owner: "rss",
    },
    {
      id: "TabDensity",
      file: "CSS/ZentralTabDensity.css",
      owner: "shared appearance",
    },
    {
      id: "PanelBackground",
      file: "CSS/ZentralPanelBackground.css",
      owner: "panel-toolbar",
    },
  ];
  const SETTINGS_SCHEMA = [
    {
      property: "zen.workspace.zentral.startup.enabled",
      label: "Enable Load at Startup in essential and pinned tab right-click menus",
      type: "checkbox",
      defaultValue: false,
    },
    {
      type: "text",
      label: "**Original Zentral · Arc 2.0 Compatibility**",
      size: "18px",
    },
    {
      property: "zen.workspace.zentral.arc2.match_compact_sidebar",
      label:
        "Arc 2.0 tweak: apply compact mode sidebar theme to regular mode sidebar",
      type: "checkbox",
      defaultValue: false,
    },
    {
      type: "text",
      label: "**Original Zentral · Apps and Panels**",
      size: "18px",
    },
    {
      property: "zen.workspace.apps.sidebar.enabled",
      label: "Enable Apps Sidebar Grid & Floating Panels",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.apps.sidebar.apps_per_row",
      label: "Apps Displayed Per Row",
      type: "dropdown",
      defaultValue: "7",
      options: [
        { label: "3 Apps", value: "3" },
        { label: "4 Apps", value: "4" },
        { label: "5 Apps", value: "5" },
        { label: "6 Apps", value: "6" },
        { label: "7 Apps (Default)", value: "7" },
        { label: "8 Apps", value: "8" },
        { label: "9 Apps", value: "9" },
        { label: "10 Apps", value: "10" },
      ],
    },
    {
      property: "zen.workspace.apps.sidebar.max_rows",
      label: "Maximum Grid Rows",
      type: "dropdown",
      defaultValue: "3",
      options: [
        { label: "1 Row", value: "1" },
        { label: "2 Rows", value: "2" },
        { label: "3 Rows (Default)", value: "3" },
        { label: "4 Rows", value: "4" },
        { label: "5 Rows", value: "5" },
      ],
    },
    {
      property: "zen.workspace.apps.sidebar.max_apps",
      label: "Maximum Apps",
      type: "dropdown",
      defaultValue: 21,
      options: [
        { label: "7", value: 7 },
        { label: "14", value: 14 },
        { label: "21", value: 21 },
        { label: "28", value: 28 },
        { label: "35", value: 35 },
        { label: "42", value: 42 },
      ],
    },
    {
      property: "zen.workspace.apps.sidebar.hide_utility_section",
      label: "Hide Utility Section in App Box",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.apps.sidebar.autohide",
      label: "Autohide Apps Sidebar",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.apps.sidebar.placement",
      label: "Apps Placement",
      type: "dropdown",
      defaultValue: "sidebar",
      options: [
        { label: "sidebar", value: "sidebar" },
        { label: "vertical-bar", value: "vertical-bar" },
      ],
    },
    {
      property: "zen.workspace.apps.sidebar.width",
      label: "Panel Width (px)",
      type: "dropdown",
      defaultValue: 350,
      options: [
        { label: "280", value: 280 },
        { label: "320", value: 320 },
        { label: "350", value: 350 },
        { label: "400", value: 400 },
        { label: "480", value: 480 },
        { label: "560", value: 560 },
      ],
    },
    {
      property: "zen.workspace.apps.sidebar.animation_speed",
      label: "Panel Animation Duration (ms)",
      type: "dropdown",
      defaultValue: 450,
      options: [
        { label: "150", value: 150 },
        { label: "250", value: 250 },
        { label: "350", value: 350 },
        { label: "450", value: 450 },
        { label: "600", value: 600 },
        { label: "800", value: 800 },
      ],
    },
    {
      property: "zen.workspace.apps.sidebar.animation_type",
      label: "Panel Animation Easing Curve",
      type: "dropdown",
      defaultValue: "spring-gentle",
      options: [
        { label: "Smooth Slide", value: "slide" },
        { label: "Snappy Spring", value: "spring-snappy" },
        { label: "Gentle Spring", value: "spring-gentle" },
        { label: "Bouncy Spring", value: "spring-bouncy" },
        { label: "Elastic", value: "elastic" },
        { label: "Instant", value: "none" },
      ],
    },
    {
      property: "zen.workspace.apps.insta_peek.shortcut",
      label: "Insta-Peek Shortcut",
      type: "string",
      defaultValue: "Alt+Q",
    },
    { type: "text", label: "**Original Zentral · Tab Groups**", size: "18px" },
    {
      property: "zen.workspace.tabgroups.enabled",
      label: "Enable Enhanced Tab Groups & Color Picker",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.tabgroups.collapse_on_launch",
      label: "Collapse Tab Groups on Browser Startup",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.tabgroups.show_chevron",
      label: "Show Open/Close Indicator on Tab Group Pills",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.tabgroups.indicator_type",
      label: "Tab Group Indicator Style",
      type: "dropdown",
      defaultValue: "circle",
      options: [
        { label: "Circle Dot", value: "circle" },
        { label: "Chevron Arrow", value: "chevron" },
      ],
    },
    {
      property: "zen.workspace.tabgroups.thumbnails",
      label: "Show Tab Thumbnails on Hover",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.tabgroups.label_opacity",
      label: "Tab Group Label Opacity (%)",
      type: "dropdown",
      defaultValue: 85,
      options: [
        { label: "40", value: 40 },
        { label: "55", value: 55 },
        { label: "70", value: 70 },
        { label: "85", value: 85 },
        { label: "100", value: 100 },
      ],
    },
    { type: "text", label: "**Original Zentral · Diagnostics**", size: "18px" },
    {
      type: "text",
      label:
        "Diagnostics and issue reports here are for the base mod only. Please report extension problems to the extension maintainer, not the original creator.",
      size: "12px",
    },
    {
      property: "zen.workspace.zentral.debug",
      label: "Enable Diagnostic Logging in Console Buffer",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.zentral.debug.full",
      label: "Capture Full Diagnostic Log (All Modules)",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.zentral.debug.core",
      label: "Core Engine & Gecko Errors (Always On)",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.zentral.debug.tabs",
      label: "Tab Groups & Drag-and-Drop Tracing",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.zentral.debug.apps",
      label: "Apps Sidebar & Panels Tracing",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.zentral.debug.menus",
      label: "Context Menus & Popups Tracing",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.zentral.debug.layout",
      label: "Layout Inspector & CSS Computed Styles Snapshot",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.zentral.report_endpoint",
      label: "Base Mod Issue Report Endpoint (not for extension issues)",
      type: "string",
      defaultValue:
        "https://zentral-issue-reporter.michele-pierini.workers.dev/",
    },
    {
      property: "zentral.logger.path",
      label: "Base Mod Diagnostic Log Folder (absolute path)",
      type: "string",
      defaultValue: "",
    },
    {
      type: "text",
      label: "**Bgalazka Extension · Panel Layout**",
      size: "18px",
    },
    {
      property: "zen.workspace.bgalazka.opposite_docking",
      label: "Opposite-Side Docking",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.hover_reveal_panel",
      label: "Hide Opposite-Side Panel Until Hover (retains its open app)",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.hide_hover_reveal_btn",
      label: "Hide Hover-Reveal Button in the Pill Menu",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.edge_attached_panels",
      label: "Edge-Attached Panels",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.push_page",
      label: "Dual-View Mode",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.triple_push_page",
      label: "Push Page in Triple View",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.all_sides_resize",
      label: "All-Sides Panel Resize",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.panel_input_shield",
      label: "Prevent Panel Input Pass-Through",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.panel_horizontal_offset_px",
      label:
        "Panel Horizontal Offset (px; use extension settings for fine adjustment)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "-200", value: -200 },
        { label: "-100", value: -100 },
        { label: "-50", value: -50 },
        { label: "0", value: 0 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
        { label: "200", value: 200 },
      ],
    },
    {
      type: "text",
      label: "**Bgalazka Extension · Advanced Panel Position**",
      size: "18px",
    },
    {
      type: "text",
      label:
        "These saved offsets are also adjusted by dragging the panel. Presets are useful for resetting a misplaced panel.",
      size: "12px",
    },
    {
      property: "zen.workspace.bgalazka.panel_top_extra_px",
      label: "Panel Top Height Adjustment (px)",
      type: "dropdown",
      defaultValue: 4,
      options: [
        { label: "-100", value: -100 },
        { label: "-50", value: -50 },
        { label: "-20", value: -20 },
        { label: "0", value: 0 },
        { label: "4", value: 4 },
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.panel_bottom_extra_px",
      label: "Panel Bottom Height Adjustment (px)",
      type: "dropdown",
      defaultValue: 4,
      options: [
        { label: "-100", value: -100 },
        { label: "-50", value: -50 },
        { label: "-20", value: -20 },
        { label: "0", value: 0 },
        { label: "4", value: 4 },
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.panel_position_offset_px",
      label: "Whole Panel Vertical Offset (px)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "-200", value: -200 },
        { label: "-100", value: -100 },
        { label: "-50", value: -50 },
        { label: "0", value: 0 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
        { label: "200", value: 200 },
      ],
    },
    {
      type: "text",
      label: "**Bgalazka Extension · Appearance**",
      size: "18px",
    },
    {
      property: "zen.workspace.bgalazka.translucency",
      label: "Enable Whole-Panel Translucency in Single-Panel View",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.opacity_unpinned",
      label: "Whole-Panel Opacity: Unpinned (%)",
      type: "dropdown",
      defaultValue: 92,
      options: [
        { label: "10", value: 10 },
        { label: "25", value: 25 },
        { label: "45", value: 45 },
        { label: "60", value: 60 },
        { label: "75", value: 75 },
        { label: "85", value: 85 },
        { label: "90", value: 90 },
        { label: "92", value: 92 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.opacity_pinned_focus",
      label: "Whole-Panel Opacity: Pinned and Focused (%)",
      type: "dropdown",
      defaultValue: 85,
      options: [
        { label: "10", value: 10 },
        { label: "25", value: 25 },
        { label: "45", value: 45 },
        { label: "60", value: 60 },
        { label: "75", value: 75 },
        { label: "85", value: 85 },
        { label: "90", value: 90 },
        { label: "92", value: 92 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.opacity_pinned_blur",
      label: "Whole-Panel Opacity: Pinned and Unfocused (%)",
      type: "dropdown",
      defaultValue: 45,
      options: [
        { label: "10", value: 10 },
        { label: "25", value: 25 },
        { label: "45", value: 45 },
        { label: "60", value: 60 },
        { label: "75", value: 75 },
        { label: "85", value: 85 },
        { label: "90", value: 90 },
        { label: "92", value: 92 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.blur_intensity",
      label: "Panel Background Blur (px)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "0", value: 0 },
        { label: "5", value: 5 },
        { label: "10", value: 10 },
        { label: "15", value: 15 },
        { label: "20", value: 20 },
        { label: "30", value: 30 },
        { label: "40", value: 40 },
      ],
    },
    {
      type: "text",
      label:
        "The whole-panel opacity settings above apply to a single panel. In dual or triple view, the pinned/unpinned opacity filter is ignored so the Look surface opacity settings can make the tab background completely clear.",
      size: "12px",
    },
    { type: "text", label: "**Bgalazka Extension · Look**", size: "18px" },
    {
      type: "text",
      label:
        "These controls change appearance only. The original interface remains available under Interface Style. Changes made here also appear in about:config; use six-digit hex colors.",
      size: "12px",
    },
    {
      property: "zen.workspace.bgalazka.look.style",
      label: "Interface Style — Atelier or original Classic",
      type: "dropdown",
      defaultValue: "atelier",
      options: [
        { label: "Atelier — customizable interface", value: "atelier" },
        { label: "Classic — original interface", value: "classic" },
      ],
    },
    { type: "text", label: "**Palette**", size: "15px" },
    {
      type: "text",
      label:
        "Canvas is the outer panel; Surface is the main panel; Raised colors inset cards. Accent highlights active controls. Text and Muted control foreground contrast.",
      size: "12px",
    },
    {
      property: "zen.workspace.bgalazka.look.canvas",
      label: "Outer panel canvas (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#17191b",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.surface",
      label: "Panel surface (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#202224",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.raised",
      label: "Raised cards and boxes (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#2b2e31",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.accent",
      label: "Active accent (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#a5bec0",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.text",
      label: "Primary text (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#dce0e1",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.muted",
      label: "Secondary text (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#a4aaad",
      border: "value",
    },
    { type: "text", label: "**Surface Opacity**", size: "15px" },
    {
      type: "text",
      label:
        "100% means solid and 0% means fully clear. These are the actual about:config opacity values. The separate panel translucency controls below also affect the entire panel; dual and triple view ignore the pinned/unpinned panel opacity filter.",
      size: "12px",
    },
    {
      property: "zen.workspace.bgalazka.look.surface_opacity",
      label: "Main panel surface opacity (%)",
      type: "dropdown",
      defaultValue: 100,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
        { label: "33", value: 33 },
        { label: "34", value: 34 },
        { label: "35", value: 35 },
        { label: "36", value: 36 },
        { label: "37", value: 37 },
        { label: "38", value: 38 },
        { label: "39", value: 39 },
        { label: "40", value: 40 },
        { label: "41", value: 41 },
        { label: "42", value: 42 },
        { label: "43", value: 43 },
        { label: "44", value: 44 },
        { label: "45", value: 45 },
        { label: "46", value: 46 },
        { label: "47", value: 47 },
        { label: "48", value: 48 },
        { label: "49", value: 49 },
        { label: "50", value: 50 },
        { label: "51", value: 51 },
        { label: "52", value: 52 },
        { label: "53", value: 53 },
        { label: "54", value: 54 },
        { label: "55", value: 55 },
        { label: "56", value: 56 },
        { label: "57", value: 57 },
        { label: "58", value: 58 },
        { label: "59", value: 59 },
        { label: "60", value: 60 },
        { label: "61", value: 61 },
        { label: "62", value: 62 },
        { label: "63", value: 63 },
        { label: "64", value: 64 },
        { label: "65", value: 65 },
        { label: "66", value: 66 },
        { label: "67", value: 67 },
        { label: "68", value: 68 },
        { label: "69", value: 69 },
        { label: "70", value: 70 },
        { label: "71", value: 71 },
        { label: "72", value: 72 },
        { label: "73", value: 73 },
        { label: "74", value: 74 },
        { label: "75", value: 75 },
        { label: "76", value: 76 },
        { label: "77", value: 77 },
        { label: "78", value: 78 },
        { label: "79", value: 79 },
        { label: "80", value: 80 },
        { label: "81", value: 81 },
        { label: "82", value: 82 },
        { label: "83", value: 83 },
        { label: "84", value: 84 },
        { label: "85", value: 85 },
        { label: "86", value: 86 },
        { label: "87", value: 87 },
        { label: "88", value: 88 },
        { label: "89", value: 89 },
        { label: "90", value: 90 },
        { label: "91", value: 91 },
        { label: "92", value: 92 },
        { label: "93", value: 93 },
        { label: "94", value: 94 },
        { label: "95", value: 95 },
        { label: "96", value: 96 },
        { label: "97", value: 97 },
        { label: "98", value: 98 },
        { label: "99", value: 99 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.raised_opacity",
      label: "Raised card opacity (%)",
      type: "dropdown",
      defaultValue: 100,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
        { label: "33", value: 33 },
        { label: "34", value: 34 },
        { label: "35", value: 35 },
        { label: "36", value: 36 },
        { label: "37", value: 37 },
        { label: "38", value: 38 },
        { label: "39", value: 39 },
        { label: "40", value: 40 },
        { label: "41", value: 41 },
        { label: "42", value: 42 },
        { label: "43", value: 43 },
        { label: "44", value: 44 },
        { label: "45", value: 45 },
        { label: "46", value: 46 },
        { label: "47", value: 47 },
        { label: "48", value: 48 },
        { label: "49", value: 49 },
        { label: "50", value: 50 },
        { label: "51", value: 51 },
        { label: "52", value: 52 },
        { label: "53", value: 53 },
        { label: "54", value: 54 },
        { label: "55", value: 55 },
        { label: "56", value: 56 },
        { label: "57", value: 57 },
        { label: "58", value: 58 },
        { label: "59", value: 59 },
        { label: "60", value: 60 },
        { label: "61", value: 61 },
        { label: "62", value: 62 },
        { label: "63", value: 63 },
        { label: "64", value: 64 },
        { label: "65", value: 65 },
        { label: "66", value: 66 },
        { label: "67", value: 67 },
        { label: "68", value: 68 },
        { label: "69", value: 69 },
        { label: "70", value: 70 },
        { label: "71", value: 71 },
        { label: "72", value: 72 },
        { label: "73", value: 73 },
        { label: "74", value: 74 },
        { label: "75", value: 75 },
        { label: "76", value: 76 },
        { label: "77", value: 77 },
        { label: "78", value: 78 },
        { label: "79", value: 79 },
        { label: "80", value: 80 },
        { label: "81", value: 81 },
        { label: "82", value: 82 },
        { label: "83", value: 83 },
        { label: "84", value: 84 },
        { label: "85", value: 85 },
        { label: "86", value: 86 },
        { label: "87", value: 87 },
        { label: "88", value: 88 },
        { label: "89", value: 89 },
        { label: "90", value: 90 },
        { label: "91", value: 91 },
        { label: "92", value: 92 },
        { label: "93", value: 93 },
        { label: "94", value: 94 },
        { label: "95", value: 95 },
        { label: "96", value: 96 },
        { label: "97", value: 97 },
        { label: "98", value: 98 },
        { label: "99", value: 99 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.toolbar_opacity",
      label: "Navigation toolbar opacity (%)",
      type: "dropdown",
      defaultValue: 100,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
        { label: "33", value: 33 },
        { label: "34", value: 34 },
        { label: "35", value: 35 },
        { label: "36", value: 36 },
        { label: "37", value: 37 },
        { label: "38", value: 38 },
        { label: "39", value: 39 },
        { label: "40", value: 40 },
        { label: "41", value: 41 },
        { label: "42", value: 42 },
        { label: "43", value: 43 },
        { label: "44", value: 44 },
        { label: "45", value: 45 },
        { label: "46", value: 46 },
        { label: "47", value: 47 },
        { label: "48", value: 48 },
        { label: "49", value: 49 },
        { label: "50", value: 50 },
        { label: "51", value: 51 },
        { label: "52", value: 52 },
        { label: "53", value: 53 },
        { label: "54", value: 54 },
        { label: "55", value: 55 },
        { label: "56", value: 56 },
        { label: "57", value: 57 },
        { label: "58", value: 58 },
        { label: "59", value: 59 },
        { label: "60", value: 60 },
        { label: "61", value: 61 },
        { label: "62", value: 62 },
        { label: "63", value: 63 },
        { label: "64", value: 64 },
        { label: "65", value: 65 },
        { label: "66", value: 66 },
        { label: "67", value: 67 },
        { label: "68", value: 68 },
        { label: "69", value: 69 },
        { label: "70", value: 70 },
        { label: "71", value: 71 },
        { label: "72", value: 72 },
        { label: "73", value: 73 },
        { label: "74", value: 74 },
        { label: "75", value: 75 },
        { label: "76", value: 76 },
        { label: "77", value: 77 },
        { label: "78", value: 78 },
        { label: "79", value: 79 },
        { label: "80", value: 80 },
        { label: "81", value: 81 },
        { label: "82", value: 82 },
        { label: "83", value: 83 },
        { label: "84", value: 84 },
        { label: "85", value: 85 },
        { label: "86", value: 86 },
        { label: "87", value: 87 },
        { label: "88", value: 88 },
        { label: "89", value: 89 },
        { label: "90", value: 90 },
        { label: "91", value: 91 },
        { label: "92", value: 92 },
        { label: "93", value: 93 },
        { label: "94", value: 94 },
        { label: "95", value: 95 },
        { label: "96", value: 96 },
        { label: "97", value: 97 },
        { label: "98", value: 98 },
        { label: "99", value: 99 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.address_opacity",
      label: "Secondary address field opacity (%)",
      type: "dropdown",
      defaultValue: 100,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
        { label: "33", value: 33 },
        { label: "34", value: 34 },
        { label: "35", value: 35 },
        { label: "36", value: 36 },
        { label: "37", value: 37 },
        { label: "38", value: 38 },
        { label: "39", value: 39 },
        { label: "40", value: 40 },
        { label: "41", value: 41 },
        { label: "42", value: 42 },
        { label: "43", value: 43 },
        { label: "44", value: 44 },
        { label: "45", value: 45 },
        { label: "46", value: 46 },
        { label: "47", value: 47 },
        { label: "48", value: 48 },
        { label: "49", value: 49 },
        { label: "50", value: 50 },
        { label: "51", value: 51 },
        { label: "52", value: 52 },
        { label: "53", value: 53 },
        { label: "54", value: 54 },
        { label: "55", value: 55 },
        { label: "56", value: 56 },
        { label: "57", value: 57 },
        { label: "58", value: 58 },
        { label: "59", value: 59 },
        { label: "60", value: 60 },
        { label: "61", value: 61 },
        { label: "62", value: 62 },
        { label: "63", value: 63 },
        { label: "64", value: 64 },
        { label: "65", value: 65 },
        { label: "66", value: 66 },
        { label: "67", value: 67 },
        { label: "68", value: 68 },
        { label: "69", value: 69 },
        { label: "70", value: 70 },
        { label: "71", value: 71 },
        { label: "72", value: 72 },
        { label: "73", value: 73 },
        { label: "74", value: 74 },
        { label: "75", value: 75 },
        { label: "76", value: 76 },
        { label: "77", value: 77 },
        { label: "78", value: 78 },
        { label: "79", value: 79 },
        { label: "80", value: 80 },
        { label: "81", value: 81 },
        { label: "82", value: 82 },
        { label: "83", value: 83 },
        { label: "84", value: 84 },
        { label: "85", value: 85 },
        { label: "86", value: 86 },
        { label: "87", value: 87 },
        { label: "88", value: 88 },
        { label: "89", value: 89 },
        { label: "90", value: 90 },
        { label: "91", value: 91 },
        { label: "92", value: 92 },
        { label: "93", value: 93 },
        { label: "94", value: 94 },
        { label: "95", value: 95 },
        { label: "96", value: 96 },
        { label: "97", value: 97 },
        { label: "98", value: 98 },
        { label: "99", value: 99 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.button_opacity",
      label: "Panel button background opacity (%)",
      type: "dropdown",
      defaultValue: 100,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
        { label: "33", value: 33 },
        { label: "34", value: 34 },
        { label: "35", value: 35 },
        { label: "36", value: 36 },
        { label: "37", value: 37 },
        { label: "38", value: 38 },
        { label: "39", value: 39 },
        { label: "40", value: 40 },
        { label: "41", value: 41 },
        { label: "42", value: 42 },
        { label: "43", value: 43 },
        { label: "44", value: 44 },
        { label: "45", value: 45 },
        { label: "46", value: 46 },
        { label: "47", value: 47 },
        { label: "48", value: 48 },
        { label: "49", value: 49 },
        { label: "50", value: 50 },
        { label: "51", value: 51 },
        { label: "52", value: 52 },
        { label: "53", value: 53 },
        { label: "54", value: 54 },
        { label: "55", value: 55 },
        { label: "56", value: 56 },
        { label: "57", value: 57 },
        { label: "58", value: 58 },
        { label: "59", value: 59 },
        { label: "60", value: 60 },
        { label: "61", value: 61 },
        { label: "62", value: 62 },
        { label: "63", value: 63 },
        { label: "64", value: 64 },
        { label: "65", value: 65 },
        { label: "66", value: 66 },
        { label: "67", value: 67 },
        { label: "68", value: 68 },
        { label: "69", value: 69 },
        { label: "70", value: 70 },
        { label: "71", value: 71 },
        { label: "72", value: 72 },
        { label: "73", value: 73 },
        { label: "74", value: 74 },
        { label: "75", value: 75 },
        { label: "76", value: 76 },
        { label: "77", value: 77 },
        { label: "78", value: 78 },
        { label: "79", value: 79 },
        { label: "80", value: 80 },
        { label: "81", value: 81 },
        { label: "82", value: 82 },
        { label: "83", value: 83 },
        { label: "84", value: 84 },
        { label: "85", value: 85 },
        { label: "86", value: 86 },
        { label: "87", value: 87 },
        { label: "88", value: 88 },
        { label: "89", value: 89 },
        { label: "90", value: 90 },
        { label: "91", value: 91 },
        { label: "92", value: 92 },
        { label: "93", value: 93 },
        { label: "94", value: 94 },
        { label: "95", value: 95 },
        { label: "96", value: 96 },
        { label: "97", value: 97 },
        { label: "98", value: 98 },
        { label: "99", value: 99 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.tile_opacity",
      label: "App tile background opacity (%)",
      type: "dropdown",
      defaultValue: 100,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
        { label: "33", value: 33 },
        { label: "34", value: 34 },
        { label: "35", value: 35 },
        { label: "36", value: 36 },
        { label: "37", value: 37 },
        { label: "38", value: 38 },
        { label: "39", value: 39 },
        { label: "40", value: 40 },
        { label: "41", value: 41 },
        { label: "42", value: 42 },
        { label: "43", value: 43 },
        { label: "44", value: 44 },
        { label: "45", value: 45 },
        { label: "46", value: 46 },
        { label: "47", value: 47 },
        { label: "48", value: 48 },
        { label: "49", value: 49 },
        { label: "50", value: 50 },
        { label: "51", value: 51 },
        { label: "52", value: 52 },
        { label: "53", value: 53 },
        { label: "54", value: 54 },
        { label: "55", value: 55 },
        { label: "56", value: 56 },
        { label: "57", value: 57 },
        { label: "58", value: 58 },
        { label: "59", value: 59 },
        { label: "60", value: 60 },
        { label: "61", value: 61 },
        { label: "62", value: 62 },
        { label: "63", value: 63 },
        { label: "64", value: 64 },
        { label: "65", value: 65 },
        { label: "66", value: 66 },
        { label: "67", value: 67 },
        { label: "68", value: 68 },
        { label: "69", value: 69 },
        { label: "70", value: 70 },
        { label: "71", value: 71 },
        { label: "72", value: 72 },
        { label: "73", value: 73 },
        { label: "74", value: 74 },
        { label: "75", value: 75 },
        { label: "76", value: 76 },
        { label: "77", value: 77 },
        { label: "78", value: 78 },
        { label: "79", value: 79 },
        { label: "80", value: 80 },
        { label: "81", value: 81 },
        { label: "82", value: 82 },
        { label: "83", value: 83 },
        { label: "84", value: 84 },
        { label: "85", value: 85 },
        { label: "86", value: 86 },
        { label: "87", value: 87 },
        { label: "88", value: 88 },
        { label: "89", value: 89 },
        { label: "90", value: 90 },
        { label: "91", value: 91 },
        { label: "92", value: 92 },
        { label: "93", value: 93 },
        { label: "94", value: 94 },
        { label: "95", value: 95 },
        { label: "96", value: 96 },
        { label: "97", value: 97 },
        { label: "98", value: 98 },
        { label: "99", value: 99 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.video_opacity",
      label: "Video preview canvas opacity (%)",
      type: "dropdown",
      defaultValue: 100,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
        { label: "33", value: 33 },
        { label: "34", value: 34 },
        { label: "35", value: 35 },
        { label: "36", value: 36 },
        { label: "37", value: 37 },
        { label: "38", value: 38 },
        { label: "39", value: 39 },
        { label: "40", value: 40 },
        { label: "41", value: 41 },
        { label: "42", value: 42 },
        { label: "43", value: 43 },
        { label: "44", value: 44 },
        { label: "45", value: 45 },
        { label: "46", value: 46 },
        { label: "47", value: 47 },
        { label: "48", value: 48 },
        { label: "49", value: 49 },
        { label: "50", value: 50 },
        { label: "51", value: 51 },
        { label: "52", value: 52 },
        { label: "53", value: 53 },
        { label: "54", value: 54 },
        { label: "55", value: 55 },
        { label: "56", value: 56 },
        { label: "57", value: 57 },
        { label: "58", value: 58 },
        { label: "59", value: 59 },
        { label: "60", value: 60 },
        { label: "61", value: 61 },
        { label: "62", value: 62 },
        { label: "63", value: 63 },
        { label: "64", value: 64 },
        { label: "65", value: 65 },
        { label: "66", value: 66 },
        { label: "67", value: 67 },
        { label: "68", value: 68 },
        { label: "69", value: 69 },
        { label: "70", value: 70 },
        { label: "71", value: 71 },
        { label: "72", value: 72 },
        { label: "73", value: 73 },
        { label: "74", value: 74 },
        { label: "75", value: 75 },
        { label: "76", value: 76 },
        { label: "77", value: 77 },
        { label: "78", value: 78 },
        { label: "79", value: 79 },
        { label: "80", value: 80 },
        { label: "81", value: 81 },
        { label: "82", value: 82 },
        { label: "83", value: 83 },
        { label: "84", value: 84 },
        { label: "85", value: 85 },
        { label: "86", value: 86 },
        { label: "87", value: 87 },
        { label: "88", value: 88 },
        { label: "89", value: 89 },
        { label: "90", value: 90 },
        { label: "91", value: 91 },
        { label: "92", value: 92 },
        { label: "93", value: 93 },
        { label: "94", value: 94 },
        { label: "95", value: 95 },
        { label: "96", value: 96 },
        { label: "97", value: 97 },
        { label: "98", value: 98 },
        { label: "99", value: 99 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.video_control_opacity",
      label: "Video control strip opacity (%)",
      type: "dropdown",
      defaultValue: 100,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
        { label: "33", value: 33 },
        { label: "34", value: 34 },
        { label: "35", value: 35 },
        { label: "36", value: 36 },
        { label: "37", value: 37 },
        { label: "38", value: 38 },
        { label: "39", value: 39 },
        { label: "40", value: 40 },
        { label: "41", value: 41 },
        { label: "42", value: 42 },
        { label: "43", value: 43 },
        { label: "44", value: 44 },
        { label: "45", value: 45 },
        { label: "46", value: 46 },
        { label: "47", value: 47 },
        { label: "48", value: 48 },
        { label: "49", value: 49 },
        { label: "50", value: 50 },
        { label: "51", value: 51 },
        { label: "52", value: 52 },
        { label: "53", value: 53 },
        { label: "54", value: 54 },
        { label: "55", value: 55 },
        { label: "56", value: 56 },
        { label: "57", value: 57 },
        { label: "58", value: 58 },
        { label: "59", value: 59 },
        { label: "60", value: 60 },
        { label: "61", value: 61 },
        { label: "62", value: 62 },
        { label: "63", value: 63 },
        { label: "64", value: 64 },
        { label: "65", value: 65 },
        { label: "66", value: 66 },
        { label: "67", value: 67 },
        { label: "68", value: 68 },
        { label: "69", value: 69 },
        { label: "70", value: 70 },
        { label: "71", value: 71 },
        { label: "72", value: 72 },
        { label: "73", value: 73 },
        { label: "74", value: 74 },
        { label: "75", value: 75 },
        { label: "76", value: 76 },
        { label: "77", value: 77 },
        { label: "78", value: 78 },
        { label: "79", value: 79 },
        { label: "80", value: 80 },
        { label: "81", value: 81 },
        { label: "82", value: 82 },
        { label: "83", value: 83 },
        { label: "84", value: 84 },
        { label: "85", value: 85 },
        { label: "86", value: 86 },
        { label: "87", value: 87 },
        { label: "88", value: 88 },
        { label: "89", value: 89 },
        { label: "90", value: 90 },
        { label: "91", value: 91 },
        { label: "92", value: 92 },
        { label: "93", value: 93 },
        { label: "94", value: 94 },
        { label: "95", value: 95 },
        { label: "96", value: 96 },
        { label: "97", value: 97 },
        { label: "98", value: 98 },
        { label: "99", value: 99 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.popup_opacity",
      label: "Panel popup opacity (%)",
      type: "dropdown",
      defaultValue: 100,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
        { label: "33", value: 33 },
        { label: "34", value: 34 },
        { label: "35", value: 35 },
        { label: "36", value: 36 },
        { label: "37", value: 37 },
        { label: "38", value: 38 },
        { label: "39", value: 39 },
        { label: "40", value: 40 },
        { label: "41", value: 41 },
        { label: "42", value: 42 },
        { label: "43", value: 43 },
        { label: "44", value: 44 },
        { label: "45", value: 45 },
        { label: "46", value: 46 },
        { label: "47", value: 47 },
        { label: "48", value: 48 },
        { label: "49", value: 49 },
        { label: "50", value: 50 },
        { label: "51", value: 51 },
        { label: "52", value: 52 },
        { label: "53", value: 53 },
        { label: "54", value: 54 },
        { label: "55", value: 55 },
        { label: "56", value: 56 },
        { label: "57", value: 57 },
        { label: "58", value: 58 },
        { label: "59", value: 59 },
        { label: "60", value: 60 },
        { label: "61", value: 61 },
        { label: "62", value: 62 },
        { label: "63", value: 63 },
        { label: "64", value: 64 },
        { label: "65", value: 65 },
        { label: "66", value: 66 },
        { label: "67", value: 67 },
        { label: "68", value: 68 },
        { label: "69", value: 69 },
        { label: "70", value: 70 },
        { label: "71", value: 71 },
        { label: "72", value: 72 },
        { label: "73", value: 73 },
        { label: "74", value: 74 },
        { label: "75", value: 75 },
        { label: "76", value: 76 },
        { label: "77", value: 77 },
        { label: "78", value: 78 },
        { label: "79", value: 79 },
        { label: "80", value: 80 },
        { label: "81", value: 81 },
        { label: "82", value: 82 },
        { label: "83", value: 83 },
        { label: "84", value: 84 },
        { label: "85", value: 85 },
        { label: "86", value: 86 },
        { label: "87", value: 87 },
        { label: "88", value: 88 },
        { label: "89", value: 89 },
        { label: "90", value: 90 },
        { label: "91", value: 91 },
        { label: "92", value: 92 },
        { label: "93", value: 93 },
        { label: "94", value: 94 },
        { label: "95", value: 95 },
        { label: "96", value: 96 },
        { label: "97", value: 97 },
        { label: "98", value: 98 },
        { label: "99", value: 99 },
        { label: "100", value: 100 },
      ],
    },
    { type: "text", label: "**Shape and Spacing**", size: "15px" },
    {
      property: "zen.workspace.bgalazka.look.radius",
      label: "Panel and control corner radius (px; 0 = square)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.depth",
      label: "Surface shadow depth (%; 0 = flat)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
        { label: "33", value: 33 },
        { label: "34", value: 34 },
        { label: "35", value: 35 },
        { label: "36", value: 36 },
        { label: "37", value: 37 },
        { label: "38", value: 38 },
        { label: "39", value: 39 },
        { label: "40", value: 40 },
        { label: "41", value: 41 },
        { label: "42", value: 42 },
        { label: "43", value: 43 },
        { label: "44", value: 44 },
        { label: "45", value: 45 },
        { label: "46", value: 46 },
        { label: "47", value: 47 },
        { label: "48", value: 48 },
        { label: "49", value: 49 },
        { label: "50", value: 50 },
        { label: "51", value: 51 },
        { label: "52", value: 52 },
        { label: "53", value: 53 },
        { label: "54", value: 54 },
        { label: "55", value: 55 },
        { label: "56", value: 56 },
        { label: "57", value: 57 },
        { label: "58", value: 58 },
        { label: "59", value: 59 },
        { label: "60", value: 60 },
        { label: "61", value: 61 },
        { label: "62", value: 62 },
        { label: "63", value: 63 },
        { label: "64", value: 64 },
        { label: "65", value: 65 },
        { label: "66", value: 66 },
        { label: "67", value: 67 },
        { label: "68", value: 68 },
        { label: "69", value: 69 },
        { label: "70", value: 70 },
        { label: "71", value: 71 },
        { label: "72", value: 72 },
        { label: "73", value: 73 },
        { label: "74", value: 74 },
        { label: "75", value: 75 },
        { label: "76", value: 76 },
        { label: "77", value: 77 },
        { label: "78", value: 78 },
        { label: "79", value: 79 },
        { label: "80", value: 80 },
        { label: "81", value: 81 },
        { label: "82", value: 82 },
        { label: "83", value: 83 },
        { label: "84", value: 84 },
        { label: "85", value: 85 },
        { label: "86", value: 86 },
        { label: "87", value: 87 },
        { label: "88", value: 88 },
        { label: "89", value: 89 },
        { label: "90", value: 90 },
        { label: "91", value: 91 },
        { label: "92", value: 92 },
        { label: "93", value: 93 },
        { label: "94", value: 94 },
        { label: "95", value: 95 },
        { label: "96", value: 96 },
        { label: "97", value: 97 },
        { label: "98", value: 98 },
        { label: "99", value: 99 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.spacing",
      label: "Control spacing",
      type: "dropdown",
      defaultValue: "comfortable",
      options: [
        { label: "Compact", value: "compact" },
        { label: "Comfortable", value: "comfortable" },
        { label: "Airy", value: "airy" },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.panel_border",
      label: "Outer panel border width (px; 0 = none)",
      type: "dropdown",
      defaultValue: 1,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
      ],
    },
    { type: "text", label: "**Navigation Toolbar**", size: "15px" },
    { type: "text", label: "**Tab Bar Density**" },
    {
      type: "text",
      label:
        "Compact tabs and folders is off by default. The three spacing values take effect only when it is on. Icon, New Tab, address bar and Essentials controls work independently.",
    },
    {
      property: "zen.workspace.bgalazka.look.density_icons",
      label: "Compact sidebar controls",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.look.density_newtab",
      label: "Compact New Tab button",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.look.density_urlbar",
      label: "Compact address bar",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.look.density_essentials",
      label: "Custom Essentials height",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.look.essentials_height",
      label: "Essentials Height",
      type: "dropdown",
      defaultValue: 32,
      options: [
        { label: "20 px", value: 20 },
        { label: "21 px", value: 21 },
        { label: "22 px", value: 22 },
        { label: "23 px", value: 23 },
        { label: "24 px", value: 24 },
        { label: "25 px", value: 25 },
        { label: "26 px", value: 26 },
        { label: "27 px", value: 27 },
        { label: "28 px", value: 28 },
        { label: "29 px", value: 29 },
        { label: "30 px", value: 30 },
        { label: "31 px", value: 31 },
        { label: "32 px", value: 32 },
        { label: "33 px", value: 33 },
        { label: "34 px", value: 34 },
        { label: "35 px", value: 35 },
        { label: "36 px", value: 36 },
        { label: "37 px", value: 37 },
        { label: "38 px", value: 38 },
        { label: "39 px", value: 39 },
        { label: "40 px", value: 40 },
        { label: "41 px", value: 41 },
        { label: "42 px", value: 42 },
        { label: "43 px", value: 43 },
        { label: "44 px", value: 44 },
        { label: "45 px", value: 45 },
        { label: "46 px", value: 46 },
        { label: "47 px", value: 47 },
        { label: "48 px", value: 48 },
        { label: "49 px", value: 49 },
        { label: "50 px", value: 50 },
        { label: "51 px", value: 51 },
        { label: "52 px", value: 52 },
        { label: "53 px", value: 53 },
        { label: "54 px", value: 54 },
        { label: "55 px", value: 55 },
        { label: "56 px", value: 56 },
        { label: "57 px", value: 57 },
        { label: "58 px", value: 58 },
        { label: "59 px", value: 59 },
        { label: "60 px", value: 60 },
        { label: "61 px", value: 61 },
        { label: "62 px", value: 62 },
        { label: "63 px", value: 63 },
        { label: "64 px", value: 64 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.tabbar_section_gap",
      label: "Pinned to Normal Tabs Spacing",
      type: "dropdown",
      defaultValue: 2,
      options: [
        { label: "0 px", value: 0 },
        { label: "1 px", value: 1 },
        { label: "2 px", value: 2 },
        { label: "3 px", value: 3 },
        { label: "4 px", value: 4 },
        { label: "5 px", value: 5 },
        { label: "6 px", value: 6 },
        { label: "7 px", value: 7 },
        { label: "8 px", value: 8 },
        { label: "9 px", value: 9 },
        { label: "10 px", value: 10 },
        { label: "11 px", value: 11 },
        { label: "12 px", value: 12 },
        { label: "13 px", value: 13 },
        { label: "14 px", value: 14 },
        { label: "15 px", value: 15 },
        { label: "16 px", value: 16 },
        { label: "17 px", value: 17 },
        { label: "18 px", value: 18 },
        { label: "19 px", value: 19 },
        { label: "20 px", value: 20 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.folder_icon_size",
      label: "Folder icon size",
      type: "dropdown",
      defaultValue: 20,
      options: [
        { label: "12 px", value: 12 },
        { label: "13 px", value: 13 },
        { label: "14 px", value: 14 },
        { label: "15 px", value: 15 },
        { label: "16 px", value: 16 },
        { label: "17 px", value: 17 },
        { label: "18 px", value: 18 },
        { label: "19 px", value: 19 },
        { label: "20 px", value: 20 },
        { label: "21 px", value: 21 },
        { label: "22 px", value: 22 },
        { label: "23 px", value: 23 },
        { label: "24 px", value: 24 },
        { label: "25 px", value: 25 },
        { label: "26 px", value: 26 },
        { label: "27 px", value: 27 },
        { label: "28 px", value: 28 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.workspace_icon_size",
      label: "Workspace icon size",
      type: "dropdown",
      defaultValue: 16,
      options: [
        { label: "12 px", value: 12 },
        { label: "13 px", value: 13 },
        { label: "14 px", value: 14 },
        { label: "15 px", value: 15 },
        { label: "16 px", value: 16 },
        { label: "17 px", value: 17 },
        { label: "18 px", value: 18 },
        { label: "19 px", value: 19 },
        { label: "20 px", value: 20 },
        { label: "21 px", value: 21 },
        { label: "22 px", value: 22 },
        { label: "23 px", value: 23 },
        { label: "24 px", value: 24 },
        { label: "25 px", value: 25 },
        { label: "26 px", value: 26 },
        { label: "27 px", value: 27 },
        { label: "28 px", value: 28 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.workspace_height",
      label: "Workspace indicator height",
      type: "dropdown",
      defaultValue: 22,
      options: [
        { label: "18 px", value: 18 },
        { label: "19 px", value: 19 },
        { label: "20 px", value: 20 },
        { label: "21 px", value: 21 },
        { label: "22 px", value: 22 },
        { label: "23 px", value: 23 },
        { label: "24 px", value: 24 },
        { label: "25 px", value: 25 },
        { label: "26 px", value: 26 },
        { label: "27 px", value: 27 },
        { label: "28 px", value: 28 },
        { label: "29 px", value: 29 },
        { label: "30 px", value: 30 },
        { label: "31 px", value: 31 },
        { label: "32 px", value: 32 },
        { label: "33 px", value: 33 },
        { label: "34 px", value: 34 },
        { label: "35 px", value: 35 },
        { label: "36 px", value: 36 },
        { label: "37 px", value: 37 },
        { label: "38 px", value: 38 },
        { label: "39 px", value: 39 },
        { label: "40 px", value: 40 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.bottom_bar_height",
      label: "Bottom bar height",
      type: "dropdown",
      defaultValue: 24,
      options: [
        { label: "20 px", value: 20 },
        { label: "21 px", value: 21 },
        { label: "22 px", value: 22 },
        { label: "23 px", value: 23 },
        { label: "24 px", value: 24 },
        { label: "25 px", value: 25 },
        { label: "26 px", value: 26 },
        { label: "27 px", value: 27 },
        { label: "28 px", value: 28 },
        { label: "29 px", value: 29 },
        { label: "30 px", value: 30 },
        { label: "31 px", value: 31 },
        { label: "32 px", value: 32 },
        { label: "33 px", value: 33 },
        { label: "34 px", value: 34 },
        { label: "35 px", value: 35 },
        { label: "36 px", value: 36 },
        { label: "37 px", value: 37 },
        { label: "38 px", value: 38 },
        { label: "39 px", value: 39 },
        { label: "40 px", value: 40 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.urlbar_top_gap",
      label: "Space above address bar",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "0 px", value: 0 },
        { label: "1 px", value: 1 },
        { label: "2 px", value: 2 },
        { label: "3 px", value: 3 },
        { label: "4 px", value: 4 },
        { label: "5 px", value: 5 },
        { label: "6 px", value: 6 },
        { label: "7 px", value: 7 },
        { label: "8 px", value: 8 },
        { label: "9 px", value: 9 },
        { label: "10 px", value: 10 },
        { label: "11 px", value: 11 },
        { label: "12 px", value: 12 },
        { label: "13 px", value: 13 },
        { label: "14 px", value: 14 },
        { label: "15 px", value: 15 },
        { label: "16 px", value: 16 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.newtab_height",
      label: "New Tab button height",
      type: "dropdown",
      defaultValue: 20,
      options: [
        { label: "18 px", value: 18 },
        { label: "19 px", value: 19 },
        { label: "20 px", value: 20 },
        { label: "21 px", value: 21 },
        { label: "22 px", value: 22 },
        { label: "23 px", value: 23 },
        { label: "24 px", value: 24 },
        { label: "25 px", value: 25 },
        { label: "26 px", value: 26 },
        { label: "27 px", value: 27 },
        { label: "28 px", value: 28 },
        { label: "29 px", value: 29 },
        { label: "30 px", value: 30 },
        { label: "31 px", value: 31 },
        { label: "32 px", value: 32 },
        { label: "33 px", value: 33 },
        { label: "34 px", value: 34 },
        { label: "35 px", value: 35 },
        { label: "36 px", value: 36 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.compact_tabbar",
      label: "Compact Tabs and Folders",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.look.tabbar_row_height",
      label: "Tab and Folder Minimum Height",
      type: "dropdown",
      defaultValue: 20,
      options: [
        { label: "18 px", value: 18 },
        { label: "19 px", value: 19 },
        { label: "20 px", value: 20 },
        { label: "21 px", value: 21 },
        { label: "22 px", value: 22 },
        { label: "23 px", value: 23 },
        { label: "24 px", value: 24 },
        { label: "25 px", value: 25 },
        { label: "26 px", value: 26 },
        { label: "27 px", value: 27 },
        { label: "28 px", value: 28 },
        { label: "29 px", value: 29 },
        { label: "30 px", value: 30 },
        { label: "31 px", value: 31 },
        { label: "32 px", value: 32 },
        { label: "33 px", value: 33 },
        { label: "34 px", value: 34 },
        { label: "35 px", value: 35 },
        { label: "36 px", value: 36 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.tabbar_row_gap",
      label: "Space Between Tab and Folder Rows",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "0 px", value: 0 },
        { label: "1 px", value: 1 },
        { label: "2 px", value: 2 },
        { label: "3 px", value: 3 },
        { label: "4 px", value: 4 },
        { label: "5 px", value: 5 },
        { label: "6 px", value: 6 },
        { label: "7 px", value: 7 },
        { label: "8 px", value: 8 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.tabbar_icon_gap",
      label: "Favicon to Title Gap",
      type: "dropdown",
      defaultValue: 4,
      options: [
        { label: "0 px", value: 0 },
        { label: "1 px", value: 1 },
        { label: "2 px", value: 2 },
        { label: "3 px", value: 3 },
        { label: "4 px", value: 4 },
        { label: "5 px", value: 5 },
        { label: "6 px", value: 6 },
        { label: "7 px", value: 7 },
        { label: "8 px", value: 8 },
        { label: "9 px", value: 9 },
        { label: "10 px", value: 10 },
        { label: "11 px", value: 11 },
        { label: "12 px", value: 12 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.toolbar_surface",
      label: "Toolbar background (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#202224",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.toolbar_url",
      label: "URL field background (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#292c2e",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.toolbar_border",
      label: "Toolbar border width (px; 0 = none)",
      type: "dropdown",
      defaultValue: 1,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
      ],
    },
    { type: "text", label: "**Buttons and Tiles**", size: "15px" },
    {
      property: "zen.workspace.bgalazka.look.button_style",
      label: "Button style",
      type: "dropdown",
      defaultValue: "outline",
      options: [
        { label: "Plain icons", value: "plain" },
        { label: "Filled", value: "filled" },
        { label: "Outline", value: "outline" },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.button_surface",
      label: "Button background (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#34373a",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.button_text",
      label: "Button icons and labels (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#d4d8d9",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.button_border_color",
      label: "Button outline color (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#292929",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.button_border",
      label: "Button border width (px; 0 = no border)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.control_size",
      label: "Button size (px)",
      type: "dropdown",
      defaultValue: 22,
      options: [
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
        { label: "21", value: 21 },
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.tile_style",
      label: "App tile style",
      type: "dropdown",
      defaultValue: "bare",
      options: [
        { label: "Bare", value: "bare" },
        { label: "Soft surface", value: "soft" },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.row_style",
      label: "Selection row style",
      type: "dropdown",
      defaultValue: "lines",
      options: [
        { label: "Lines", value: "lines" },
        { label: "Cards", value: "cards" },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.row_padding",
      label: "Selection row padding (px)",
      type: "dropdown",
      defaultValue: 4,
      options: [
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
        { label: "17", value: 17 },
        { label: "18", value: 18 },
        { label: "19", value: 19 },
        { label: "20", value: 20 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.row_rule",
      label: "Selection row separator width (px)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
      ],
    },
    { type: "text", label: "**Sidebar Video Look**", size: "15px" },
    {
      type: "text",
      label:
        "Video colors and borders affect only Zentral’s sidebar video preview. Its preview size, discovery, and capture behavior are in Video Preview below.",
      size: "12px",
    },
    {
      property: "zen.workspace.bgalazka.look.video_canvas",
      label: "Video canvas background (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#0a0a0a",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.video_control",
      label: "Video controls background (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#000000",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.video_text",
      label: "Video primary text and icons (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#d8d8d8",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.video_muted",
      label: "Video secondary text (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#838383",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.video_selected",
      label: "Selected video source highlight (six-digit #RRGGBB)",
      type: "string",
      defaultValue: "#7d0000",
      border: "value",
    },
    {
      property: "zen.workspace.bgalazka.look.video_border",
      label: "Video control border width (px; 0 = none)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.video_padding",
      label: "Video control padding (px)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "0", value: 0 },
        { label: "1", value: 1 },
        { label: "2", value: 2 },
        { label: "3", value: 3 },
        { label: "4", value: 4 },
        { label: "5", value: 5 },
        { label: "6", value: 6 },
        { label: "7", value: 7 },
        { label: "8", value: 8 },
        { label: "9", value: 9 },
        { label: "10", value: 10 },
        { label: "11", value: 11 },
        { label: "12", value: 12 },
        { label: "13", value: 13 },
        { label: "14", value: 14 },
        { label: "15", value: 15 },
        { label: "16", value: 16 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.video_row_height",
      label: "Video source row height (px)",
      type: "dropdown",
      defaultValue: 22,
      options: [
        { label: "22", value: 22 },
        { label: "23", value: 23 },
        { label: "24", value: 24 },
        { label: "25", value: 25 },
        { label: "26", value: 26 },
        { label: "27", value: 27 },
        { label: "28", value: 28 },
        { label: "29", value: 29 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "32", value: 32 },
        { label: "33", value: 33 },
        { label: "34", value: 34 },
        { label: "35", value: 35 },
        { label: "36", value: 36 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.look.video_source_style",
      label: "Video source selection style",
      type: "dropdown",
      defaultValue: "line",
      options: [
        { label: "Underline", value: "line" },
        { label: "Filled highlight", value: "filled" },
      ],
    },
    {
      property: "zen.workspace.bgalazka.audio_indicator",
      label: "Panel Audio Indicator and Mute",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.smart_sleep",
      label: "Defer Panel Preloads",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.addon_tab_id_bridge",
      label: "Real Tab IDs for Web Panels",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.zen_internet_panel_css",
      label: "Use Zen Internet CSS in Web Panels (experimental)",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.show_addon_host_folder",
      label: "Show Web Panel Tab ID Folder in Sidebar (requires Real Tab IDs)",
      type: "checkbox",
      defaultValue: false,
    },
    { type: "text", label: "**Bgalazka Extension · Pill**", size: "18px" },
    {
      property: "zen.workspace.bgalazka.hide_pill",
      label: "Hide Floating Pill Menu",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.pill_position",
      label: "Pill Vertical Offset (%)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "-50", value: -50 },
        { label: "-25", value: -25 },
        { label: "0", value: 0 },
        { label: "25", value: 25 },
        { label: "50", value: 50 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.pill_peek_dot",
      label: "Show Mini Pill When Idle",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.pill_peek_dot_color",
      label: "Mini Pill Color",
      type: "string",
      defaultValue: "#5e0002",
    },
    {
      property: "zen.workspace.bgalazka.pill_peek_dot_opacity",
      label: "Mini Pill Opacity (%)",
      type: "dropdown",
      defaultValue: 31,
      options: [
        { label: "10", value: 10 },
        { label: "30", value: 30 },
        { label: "31", value: 31 },
        { label: "50", value: 50 },
        { label: "70", value: 70 },
        { label: "90", value: 90 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.pill_background_opacity",
      label: "Pill Background Opacity (%)",
      type: "dropdown",
      defaultValue: 48,
      options: [
        { label: "10", value: 10 },
        { label: "30", value: 30 },
        { label: "48", value: 48 },
        { label: "50", value: 50 },
        { label: "70", value: 70 },
        { label: "90", value: 90 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.bgalazka.hide_dual_view",
      label: "Hide Dual-View Button",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.hide_all_sides_resize_btn",
      label: "Hide All-Sides Resize Button",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.hide_pin",
      label: "Hide Pin Button",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.hide_expand",
      label: "Hide Expand Button",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.hide_grabber",
      label: "Hide Resize Grabber",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.hide_refresh",
      label: "Hide Pill Refresh Button",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.hide_close",
      label: "Hide Pill Close Button",
      type: "checkbox",
      defaultValue: false,
    },
    {
      type: "text",
      label: "**Bgalazka Extension · Navigation Toolbar**",
      size: "18px",
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_enabled",
      label: "Enable Panel Navigation Toolbar",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_autohide",
      label: "Show Toolbar Only on Hover",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_top",
      label: "Place Toolbar at Top",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_urlbar",
      label: "Show Panel URL Bar",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_zoom",
      label: "Show Panel Zoom Controls",
      type: "checkbox",
      defaultValue: true,
    },
    { type: "text", label: "**Bgalazka Extension · Search**", size: "18px" },
    {
      property: "zen.workspace.bgalazka.web_toolbar_search_engine",
      label: "Default Panel Search Engine",
      type: "dropdown",
      defaultValue: "ddg",
      options: [
        { label: "DuckDuckGo", value: "ddg" },
        { label: "Startpage", value: "startpage" },
        { label: "Brave Search", value: "brave" },
        { label: "Yahoo Search", value: "yahoo" },
        { label: "Ecosia", value: "ecosia" },
        { label: "Qwant", value: "qwant" },
        { label: "YouTube", value: "youtube" },
        { label: "Wikipedia", value: "wikipedia" },
        { label: "Reddit", value: "reddit" },
        { label: "GitHub", value: "github" },
        { label: "Browser Default", value: "browser" },
        { label: "Custom Engine 1", value: "custom" },
        { label: "Custom Engine 2", value: "custom-2" },
        { label: "Custom Engine 3", value: "custom-3" },
        { label: "Custom Engine 4", value: "custom-4" },
        { label: "Custom Engine 5", value: "custom-5" },
        { label: "Custom Engine 6", value: "custom-6" },
      ],
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_search_custom_url",
      label: "Custom GET Search Template 1 (%s)",
      type: "string",
      defaultValue: "",
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_custom_1",
      label: "Custom GET Search Template 2 (%s)",
      type: "string",
      defaultValue: "",
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_custom_2",
      label: "Custom GET Search Template 3 (%s)",
      type: "string",
      defaultValue: "",
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_custom_3",
      label: "Custom GET Search Template 4 (%s)",
      type: "string",
      defaultValue: "",
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_custom_4",
      label: "Custom GET Search Template 5 (%s)",
      type: "string",
      defaultValue: "",
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_custom_5",
      label: "Custom GET Search Template 6 (%s)",
      type: "string",
      defaultValue: "",
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch",
      label: "Search Engine Quick-Switch",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_target.ddg",
      label: "Quick-Switch Target: Ddg",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property:
        "zen.workspace.bgalazka.web_toolbar_quickswitch_target.startpage",
      label: "Quick-Switch Target: Startpage",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_target.brave",
      label: "Quick-Switch Target: Brave",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_target.yahoo",
      label: "Quick-Switch Target: Yahoo",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_target.ecosia",
      label: "Quick-Switch Target: Ecosia",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_target.qwant",
      label: "Quick-Switch Target: Qwant",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_target.youtube",
      label: "Quick-Switch Target: Youtube",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property:
        "zen.workspace.bgalazka.web_toolbar_quickswitch_target.wikipedia",
      label: "Quick-Switch Target: Wikipedia",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_target.reddit",
      label: "Quick-Switch Target: Reddit",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.web_toolbar_quickswitch_target.github",
      label: "Quick-Switch Target: Github",
      type: "checkbox",
      defaultValue: false,
    },
    {
      type: "text",
      label: "**Bgalazka Extension · Tab Launchers**",
      size: "18px",
    },
    { type: "text", label: "**Bgalazka Extension · RSS**", size: "18px" },
    {
      type: "text",
      label:
        "Native RSS live folders keep their own output folders. These switches only change their sidebar appearance.",
      size: "12px",
    },
    {
      property: "zen.workspace.bgalazka.rss.hide_empty",
      label: "Hide Empty RSS Live Folders",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.rss.compact_headers",
      label: "Compact RSS Live-Folder Headers",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.corner_tiles",
      label: "Panels on Essential Tabs",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.all_tab_panels",
      label: "Panel Launchers on All Tabs",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.hover_corner_tiles",
      label: "Hover-Only Corner Tiles",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.tab_isolation",
      label: "Dim Unloaded Tabs",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.hide_corner_badges",
      label: "Hide Corner Notification Badges",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.hide_unattached_app_controls",
      label: "Hide Unattached App Controls",
      type: "checkbox",
      defaultValue: false,
    },
    {
      type: "text",
      label: "**Bgalazka Extension · Keyboard Shortcuts**",
      size: "18px",
    },
    {
      property: "zen.workspace.bgalazka.keybinds_enabled",
      label: "Enable Extension Shortcuts",
      type: "checkbox",
      defaultValue: false,
    },
    {
      property: "zen.workspace.bgalazka.keybind.close_panel",
      label: "Shortcut: Close Panel",
      type: "string",
      defaultValue: "Escape",
    },
    {
      property: "zen.workspace.bgalazka.keybind.back",
      label: "Shortcut: Panel Back",
      type: "string",
      defaultValue: "Alt+ArrowLeft",
    },
    {
      property: "zen.workspace.bgalazka.keybind.forward",
      label: "Shortcut: Panel Forward",
      type: "string",
      defaultValue: "Alt+ArrowRight",
    },
    {
      property: "zen.workspace.bgalazka.keybind.reload",
      label: "Shortcut: Reload Panel",
      type: "string",
      defaultValue: "Ctrl+R",
    },
    {
      property: "zen.workspace.bgalazka.keybind.focus_url",
      label: "Shortcut: Focus Panel URL",
      type: "string",
      defaultValue: "Ctrl+L",
    },
    {
      property: "zen.workspace.bgalazka.keybind.toggle_pin",
      label: "Shortcut: Toggle Pin",
      type: "string",
      defaultValue: "Ctrl+Shift+P",
    },
    {
      property: "zen.workspace.bgalazka.keybind.toggle_expand",
      label: "Shortcut: Expand Panel",
      type: "string",
      defaultValue: "Ctrl+Shift+E",
    },
    {
      property: "zen.workspace.bgalazka.keybind.toggle_dual_view",
      label: "Shortcut: Toggle Dual-View",
      type: "string",
      defaultValue: "Ctrl+Shift+D",
    },
    {
      property: "zen.workspace.bgalazka.keybind.toggle_resize",
      label: "Shortcut: Toggle Resize",
      type: "string",
      defaultValue: "Ctrl+Shift+R",
    },
    {
      property: "zen.workspace.bgalazka.keybind.toggle_toolbar",
      label: "Shortcut: Toggle Toolbar",
      type: "string",
      defaultValue: "Ctrl+Shift+T",
    },
    {
      property: "zen.workspace.bgalazka.keybind.toggle_translucency",
      label: "Shortcut: Toggle Translucency",
      type: "string",
      defaultValue: "",
    },
    {
      property: "zen.workspace.bgalazka.keybind.toggle_opposite_docking",
      label: "Shortcut: Toggle Opposite Docking",
      type: "string",
      defaultValue: "",
    },
    {
      property: "zen.workspace.bgalazka.keybind.toggle_edge_attached",
      label: "Shortcut: Toggle Edge Attachment",
      type: "string",
      defaultValue: "",
    },
    {
      property: "zen.workspace.bgalazka.keybind.toggle_input_shield",
      label: "Shortcut: Toggle Input Shield",
      type: "string",
      defaultValue: "",
    },
    {
      property: "zen.workspace.bgalazka.keybind.zoom_in",
      label: "Shortcut: Panel Zoom In",
      type: "string",
      defaultValue: "Ctrl+Shift+Plus",
    },
    {
      property: "zen.workspace.bgalazka.keybind.zoom_out",
      label: "Shortcut: Panel Zoom Out",
      type: "string",
      defaultValue: "Ctrl+Minus",
    },
    {
      property: "zen.workspace.bgalazka.keybind.zoom_reset",
      label: "Shortcut: Panel Zoom Reset",
      type: "string",
      defaultValue: "Ctrl+0",
    },
    {
      property: "zen.workspace.bgalazka.keybind.open_settings",
      label: "Shortcut: Open Zentral Settings",
      type: "string",
      defaultValue: "Ctrl+Shift+Comma",
    },
    {
      type: "text",
      label: "**Bgalazka Extension · Video Preview**",
      size: "18px",
    },
    {
      type: "text",
      label:
        "Auto probes working methods; the other renderers remain available to try manually if browser support changes. Capture detail only affects video frames and page snapshots.",
      size: "12px",
    },
    {
      property: "zen.workspace.zentral.video_preview.enabled",
      label: "Sidebar Video Preview",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.zentral.video_preview.auto_show_video",
      label: "Automatically Preview Playing Videos",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.zentral.video_preview.require_audio",
      label: "Only Offer Videos With Audio Tracks (mute state does not matter)",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.zentral.video_preview.pause_when_compact_hidden",
      label: "Pause Preview Capture While Compact Sidebar Is Hidden",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.zentral.video_preview.hide_muted_duplicates",
      label: "Hide Duplicate Muted Videos",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.zentral.video_preview.fit_width",
      label: "Fill Available Sidebar Width",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.zentral.video_preview.width_percent",
      label: "Preview Width (%) when Fill Width is Off",
      type: "dropdown",
      defaultValue: 100,
      options: [
        { label: "35", value: 35 },
        { label: "50", value: 50 },
        { label: "65", value: 65 },
        { label: "75", value: 75 },
        { label: "85", value: 85 },
        { label: "100", value: 100 },
      ],
    },
    {
      property: "zen.workspace.zentral.video_preview.height_px",
      label: "Preview Height (px; 0 = auto)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "0", value: 0 },
        { label: "150", value: 150 },
        { label: "230", value: 230 },
        { label: "320", value: 320 },
        { label: "480", value: 480 },
        { label: "640", value: 640 },
        { label: "800", value: 800 },
      ],
    },
    {
      property: "zen.workspace.zentral.video_preview.radius_px",
      label: "Preview Corner Radius (px)",
      type: "dropdown",
      defaultValue: 0,
      options: [
        { label: "0", value: 0 },
        { label: "4", value: 4 },
        { label: "8", value: 8 },
        { label: "12", value: 12 },
        { label: "16", value: 16 },
        { label: "24", value: 24 },
      ],
    },
    {
      property: "zen.workspace.zentral.video_preview.capture_width_px",
      label: "Capture Detail: Video Frames and Page Snapshots (px)",
      type: "dropdown",
      defaultValue: 480,
      options: [
        { label: "320", value: 320 },
        { label: "480", value: 480 },
        { label: "640", value: 640 },
      ],
    },
    {
      property: "zen.workspace.zentral.video_preview.capture_rate_tenths",
      label: "Still-Frame Capture Rate (higher rates use more CPU)",
      type: "dropdown",
      defaultValue: 100,
      options: [
        { label: "0.1 frames/s", value: 1 },
        { label: "0.2 frames/s", value: 2 },
        { label: "0.5 frames/s", value: 5 },
        { label: "1 frames/s", value: 10 },
        { label: "2 frames/s", value: 20 },
        { label: "5 frames/s", value: 50 },
        { label: "10 frames/s — default", value: 100 },
        { label: "15 frames/s", value: 150 },
        { label: "24 frames/s", value: 240 },
        { label: "30 frames/s", value: 300 },
        { label: "60 frames/s", value: 600 },
      ],
    },
    {
      property: "zen.workspace.zentral.video_preview.framing",
      label: "Video Framing",
      type: "dropdown",
      defaultValue: "auto",
      options: [
        { label: "auto", value: "auto" },
        { label: "contain", value: "contain" },
        { label: "cover", value: "cover" },
      ],
    },
    {
      property: "zen.workspace.zentral.video_preview.renderer",
      label: "Renderer (Auto Tries Available Methods)",
      type: "dropdown",
      defaultValue: "auto",
      options: [
        { label: "auto", value: "auto" },
        { label: "frame-native", value: "frame-native" },
        { label: "native", value: "native" },
        { label: "frame-stream", value: "frame-stream" },
        { label: "stream", value: "stream" },
        { label: "canvas-stream", value: "canvas-stream" },
        { label: "canvas", value: "canvas" },
        { label: "snapshot", value: "snapshot" },
      ],
    },
    {
      property: "zen.workspace.zentral.video_preview.discovery",
      label: "Source Discovery (Auto Keeps Working Method)",
      type: "dropdown",
      defaultValue: "auto",
      options: [
        { label: "auto", value: "auto" },
        { label: "frame", value: "frame" },
        { label: "actor", value: "actor" },
        { label: "direct", value: "direct" },
      ],
    },
    {
      property:
        "zen.workspace.zentral.video_preview.disable_experimental_bridge",
      label: "Disable Experimental Actor Bridge (use compatible methods)",
      type: "checkbox",
      defaultValue: true,
    },
    {
      property: "zen.workspace.bgalazka.panel_black_opacity",
      label: "Black panel backing opacity (0–100)",
      type: "input",
      defaultValue: 0,
    },
    {
      property: "zen.workspace.bgalazka.panel_black_steps",
      label: "Black backing cycle levels (comma separated)",
      type: "input",
      defaultValue: "0,1,5,10,20,30,40,50,60,70,80,90,100",
    },
  ];
  const Constants = {
    /**
     * 1.1 Apps Module Preference Keys & Dimension Constraints
     */
    Apps: {
      PREF_APPS: "zen.workspace.apps.sidebar.apps",
      PREF_WIDTH: "zen.workspace.apps.sidebar.width",
      PREF_ANIMATION_SPEED: "zen.workspace.apps.sidebar.animation_speed",
      PREF_ANIMATION_TYPE: "zen.workspace.apps.sidebar.animation_type",
      PREF_ENABLED: "zen.workspace.apps.sidebar.enabled",
      PREF_MAX_APPS: "zen.workspace.apps.sidebar.max_apps",
      PREF_APPS_PER_ROW: "zen.workspace.apps.sidebar.apps_per_row",
      PREF_MAX_ROWS: "zen.workspace.apps.sidebar.max_rows",
      PREF_AUTOHIDE: "zen.workspace.apps.sidebar.autohide",
      PREF_INSTA_PEEK_SHORTCUT: "zen.workspace.apps.insta_peek.shortcut",
      PREF_PLACEMENT: "zen.workspace.apps.sidebar.placement",
      PREF_UTILITY_ORDER: "zen.workspace.apps.sidebar.utility_order",
      PREF_HIDE_UTILITY_SECTION:
        "zen.workspace.apps.sidebar.hide_utility_section",
      MIN_WIDTH_PX: 280,
      MAX_WIDTH_RATIO: 0.8,
      DEFAULT_SLIDE_MS: 450,
      DEFAULT_MAX_APPS: 21,
      DEFAULT_APPS_PER_ROW: 7,
      DEFAULT_MAX_ROWS: 3,
      /** Fixed number of slots hosted in the Utility section */
      UTILITY_SLOTS_COUNT: 4,
      /** Sidebar width (px) below which layout is treated as collapsed. */
      COLLAPSED_WIDTH_THRESHOLD: 140,
    },
    /**
     * 1.2 Tab Groups Preference Keys
     */
    TabGroups: {
      PREF_COLORS: "zen.workspace.tabgroups.colors",
      PREF_STATE: "zen.workspace.tabgroups.state",
      PREF_ENABLED: "zen.workspace.tabgroups.enabled",
      PREF_COLLAPSE_ON_LAUNCH: "zen.workspace.tabgroups.collapse_on_launch",
      PREF_THUMBNAILS: "zen.workspace.tabgroups.thumbnails",
      PREF_SHOW_CHEVRON: "zen.workspace.tabgroups.show_chevron",
      PREF_INDICATOR_TYPE: "zen.workspace.tabgroups.indicator_type",
      PREF_LABEL_OPACITY: "zen.workspace.tabgroups.label_opacity",
    },
    /**
     * 1.3 Diagnostics Preference Keys
     */
    Diagnostics: {
      PREF_LOGGER_ENABLED: "zen.workspace.zentral.debug",
      PREF_LOGGER_PATH: "zentral.logger.path",
      PREF_LOGGER_FULL: "zen.workspace.zentral.debug.full",
      PREF_LOGGER_CORE: "zen.workspace.zentral.debug.core",
      PREF_LOGGER_TABS: "zen.workspace.zentral.debug.tabs",
      PREF_LOGGER_APPS: "zen.workspace.zentral.debug.apps",
      PREF_LOGGER_MENUS: "zen.workspace.zentral.debug.menus",
      PREF_LOGGER_LAYOUT: "zen.workspace.zentral.debug.layout",
      PREF_REPORT_ENDPOINT: "zen.workspace.zentral.report_endpoint",
    },
    /** Debug logging preference — set true in about:config to enable verbose console output */
    DEBUG_PREF: "zen.workspace.zentral.debug",
  };

  /* ============================================================================
   * 1.5 MODULE-SCOPE CONSTANTS (shared SVG strings & lookup tables)
   * ============================================================================
   */

  /**
   * Frozen lookup table of well-known service hostnames → display names.
   * Allocated once at module load; never mutated.
   */
  const WELL_KNOWN_SERVICES = Object.freeze({
    "discord.com": "Discord",
    "web.whatsapp.com": "WhatsApp",
    "whatsapp.com": "WhatsApp",
    "web.telegram.org": "Telegram",
    "telegram.org": "Telegram",
    "t.me": "Telegram",
    "reddit.com": "Reddit",
    "youtube.com": "YouTube",
    "music.youtube.com": "YouTube Music",
    "mail.google.com": "Gmail",
    "gmail.com": "Gmail",
    "github.com": "GitHub",
    "twitter.com": "Twitter",
    "x.com": "X",
    "chatgpt.com": "ChatGPT",
    "chat.openai.com": "ChatGPT",
    "instagram.com": "Instagram",
    "facebook.com": "Facebook",
    "linkedin.com": "LinkedIn",
    "spotify.com": "Spotify",
    "open.spotify.com": "Spotify",
    "twitch.tv": "Twitch",
    "slack.com": "Slack",
    "notion.so": "Notion",
    "netflix.com": "Netflix",
    "google.com": "Google",
    "drive.google.com": "Google Drive",
    "calendar.google.com": "Google Calendar",
    "maps.google.com": "Google Maps",
    "translate.google.com": "Google Translate",
    "keep.google.com": "Google Keep",
    "pinterest.com": "Pinterest",
    "amazon.com": "Amazon",
    "wikipedia.org": "Wikipedia",
    "outlook.live.com": "Outlook",
    "outlook.com": "Outlook",
    "messenger.com": "Messenger",
    "tiktok.com": "TikTok",
    "soundcloud.com": "SoundCloud",
    "music.apple.com": "Apple Music",
    "bsky.app": "Bluesky",
    "mastodon.social": "Mastodon",
    "threads.net": "Threads",
    "medium.com": "Medium",
    "substack.com": "Substack",
    "trello.com": "Trello",
    "asana.com": "Asana",
    "figma.com": "Figma",
    "canva.com": "Canva",
    "dropbox.com": "Dropbox",
    "steamcommunity.com": "Steam",
    "store.steampowered.com": "Steam",
    "mail.proton.me": "ProtonMail",
    "proton.me": "Proton",
    "deezer.com": "Deezer",
    "crunchyroll.com": "Crunchyroll",
  });

  /**
   * Shared SVG string constants. Defined once at module scope to avoid
   * re-allocating identical string literals at every renderGrid() call.
   */
  const SVG_STRINGS = Object.freeze({
    SETTINGS: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    EYE_OPEN: `<svg class="zs-eye-open" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    EYE_CLOSED: `<svg class="zs-eye-closed" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    CLOSE_X: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`,
    EXPAND: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>`,
    COLLAPSE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4 6V2h2v4H4zm6 0V2h2v4h-2zm-6 4v4h2v-4H4zm6 0v4h2v-4h-2z"/></svg>`,
    PIN: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 11V15M3.5 11.5h9c0 0 0-2-1.5-3l-.5-4c0 0 .5-.5.5-1H5.5c0 .5.5 1 .5 1L5.5 8.5c-1.5 1-2 3-2 3z"/></svg>`,
    REFRESH: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M13.8 6.5A5.5 5.5 0 1 0 8 13.5a5.5 5.5 0 0 0 5.2-3.7M14 2v4.5H9.5"/></svg>`,
    GRABBER: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 14"><circle cx="3" cy="2.5" r="1.2"/><circle cx="7" cy="2.5" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11.5" r="1.2"/><circle cx="7" cy="11.5" r="1.2"/></svg>`,
    ADD: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  });

  /**
   * Creates an SVG element from a string using innerHTML (no DOMParser overhead).
   * Shared by all Zentral modules. Clones elements on repeated use.
   * @param {string} svgString - Raw SVG markup.
   * @returns {Element} The SVG DOM element.
   */
  const svgCache = new Map();
  function createSVGElement(svgString) {
    if (svgCache.has(svgString))
      return document.importNode(svgCache.get(svgString), true);
    const ns = "http://www.w3.org/2000/svg";
    const root = new DOMParser().parseFromString(
      svgString,
      "image/svg+xml",
    ).documentElement;
    if (root?.namespaceURI === ns && root.localName === "svg") {
      if (svgCache.size < 64) svgCache.set(svgString, root);
      return document.importNode(root, true);
    }
    console.warn("[Zentral] Invalid SVG icon");
    return document.createElementNS(ns, "svg");
  }

  /* ============================================================================
   * 2.0 ZENTRAL CORE ENGINE (ZentralCore)
   * ============================================================================
   */

  /**
   * Core orchestrator managing Events, Configurations, and Preference Fallbacks.
   */
  class ZentralCore {
    /**
     * Constructs the ZentralCore instance and initializes the event listener map and default preferences.
     */
    constructor() {
      /** @type {Map<string, Array<Function>>} Storage map for pub-sub event callbacks */
      this.listeners = new Map();

      /** @type {Object<string, any>} Default fallback preference values */
      this.defaultPrefs = {
        [Constants.Apps.PREF_APPS]: "[]",
        [Constants.Apps.PREF_WIDTH]: 350,
        [Constants.Apps.PREF_ANIMATION_SPEED]: 0,
        [Constants.Apps.PREF_ANIMATION_TYPE]: "none",
        [Constants.Apps.PREF_ENABLED]: true,
        [Constants.Apps.PREF_MAX_APPS]: -1,
        [Constants.Apps.PREF_APPS_PER_ROW]: 1,
        [Constants.Apps.PREF_MAX_ROWS]: 1,
        [Constants.Apps.PREF_AUTOHIDE]: false,
        [Constants.Apps.PREF_INSTA_PEEK_SHORTCUT]: "Alt+Q",
        [Constants.Apps.PREF_PLACEMENT]: "sidebar",
        [Constants.Apps.PREF_UTILITY_ORDER]:
          '["autohide",null,null,"settings"]',
        [Constants.Apps.PREF_HIDE_UTILITY_SECTION]: true,
        [Constants.TabGroups.PREF_COLORS]: "{}",
        [Constants.TabGroups.PREF_STATE]: "{}",
        [Constants.TabGroups.PREF_ENABLED]: false,
        [Constants.TabGroups.PREF_COLLAPSE_ON_LAUNCH]: false,
        [Constants.TabGroups.PREF_THUMBNAILS]: false,
        [Constants.TabGroups.PREF_SHOW_CHEVRON]: true,
        [Constants.TabGroups.PREF_INDICATOR_TYPE]: "circle",
        [Constants.TabGroups.PREF_LABEL_OPACITY]: 85,
        [Constants.Diagnostics.PREF_LOGGER_ENABLED]: false,
        [Constants.Diagnostics.PREF_LOGGER_PATH]: "",
        [Constants.Diagnostics.PREF_LOGGER_FULL]: true,
        [Constants.Diagnostics.PREF_LOGGER_CORE]: true,
        [Constants.Diagnostics.PREF_LOGGER_TABS]: false,
        [Constants.Diagnostics.PREF_LOGGER_APPS]: false,
        [Constants.Diagnostics.PREF_LOGGER_MENUS]: false,
        [Constants.Diagnostics.PREF_LOGGER_LAYOUT]: false,
        [Constants.Diagnostics.PREF_REPORT_ENDPOINT]:
          "https://zentral-issue-reporter.michele-pierini.workers.dev/",
      };
    }

    /**
     * Subscribes a callback function to a system or config event.
     * @param {string} event - The event identifier name.
     * @param {Function} callback - The handler function to invoke when event triggers.
     */
    on(event, callback) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push(callback);
    }

    /**
     * Emits an event to all subscribed callback functions.
     * @param {string} event - The event identifier name.
     * @param {any} data - The payload data passed to subscribers.
     */
    emit(event, data) {
      const callbacks = this.listeners.get(event);
      if (callbacks) {
        callbacks.forEach((cb) => {
          try {
            cb(data);
          } catch (e) {
            console.error(`[ZentralCore] Event error on ${event}:`, e);
          }
        });
      }
    }

    /**
     * Safely retrieves a Zentral preference value, returning configured default if user pref doesn't exist.
     * @param {string} key - Preference string identifier key.
     * @param {any} [fallback] - Optional override fallback value.
     * @returns {any} The stored or fallback preference value.
     */
    getPref(key, fallback) {
      const defaultVal =
        this.defaultPrefs[key] !== undefined
          ? this.defaultPrefs[key]
          : fallback;
      try {
        if (!Services.prefs.prefHasUserValue(key)) return defaultVal;
        const prefType = Services.prefs.getPrefType(key);
        if (prefType === Services.prefs.PREF_BOOL)
          return Services.prefs.getBoolPref(key);
        if (prefType === Services.prefs.PREF_INT)
          return Services.prefs.getIntPref(key);
        if (prefType === Services.prefs.PREF_STRING)
          return Services.prefs.getStringPref(key);
      } catch (e) {
        console.warn("[ZentralCore] Config failed to read pref", key, e);
      }
      return defaultVal;
    }

    /**
     * Sets a Zentral preference value and notifies subscribers via the config event channel.
     * @param {string} key - Preference string identifier key.
     * @param {any} value - The new value to assign.
     */
    setPref(key, value) {
      try {
        if (typeof value === "number") {
          if (Number.isInteger(value)) Services.prefs.setIntPref(key, value);
          else Services.prefs.setStringPref(key, value.toString());
        } else if (typeof value === "string")
          Services.prefs.setStringPref(key, value);
        else if (typeof value === "boolean")
          Services.prefs.setBoolPref(key, value);
        else return;
        this.emit(`config:${key}`, value);
      } catch (e) {
        console.warn("[ZentralCore] Config failed to save pref", key, e);
      }
    }

    getNativePref(key, fallback) {
      try {
        if (typeof fallback === "boolean")
          return Services.prefs.getBoolPref(key, fallback);
        if (typeof fallback === "number")
          return Number.isInteger(fallback)
            ? Services.prefs.getIntPref(key, fallback)
            : parseFloat(Services.prefs.getStringPref(key, String(fallback)));
        if (typeof fallback === "string")
          return Services.prefs.getStringPref(key, fallback);
      } catch (e) {
        return fallback;
      }
      return fallback;
    }

    /**
     * Standardized diagnostic logger routing to window.ZentralLogger or debug console.
     * @param {string} module - Component or module name tag (e.g. "ZentralApps").
     * @param {...any} args - Log arguments.
     */
    log(module, ...args) {
      if (window.ZentralLogger?.log) {
        window.ZentralLogger.log(module, ...args);
      } else if (this.getPref(Constants.DEBUG_PREF)) {
        console.log(`[${module}]`, ...args);
      }
    }

    /**
     * Standardized warning logger routing to window.ZentralLogger or native warn.
     * @param {string} module - Component or module name tag.
     * @param {...any} args - Warning arguments.
     */
    warn(module, ...args) {
      if (window.ZentralLogger?.warn) {
        window.ZentralLogger.warn(module, ...args);
      } else {
        console.warn(`[${module}]`, ...args);
      }
    }

    /**
     * Standardized error logger routing to window.ZentralLogger or native error.
     * @param {string} module - Component or module name tag.
     * @param {...any} args - Error arguments.
     */
    error(module, ...args) {
      if (window.ZentralLogger?.error) {
        window.ZentralLogger.error(module, ...args);
      } else {
        console.error(`[${module}]`, ...args);
      }
    }
  }

  // Instantiate Core immediately
  const Core = new ZentralCore();
  Core.log("ZentralCore", "Initialized.");
  /* ============================================================================
   * 3.0 APPS MODULE (ZentralApps)
   * ============================================================================
   */

  /**
   * Zentral Apps Module
   * Manages sidebar app grid, floating app panels, workspace isolation, and drag/drop reordering.
   */

  class ZentralSettings {
    /**
     * Constructs ZentralSettings instance.
     */
    constructor() {
      /** @type {Element|null} Reference to modal dialog overlay container */
      this.modal = null;
      this._stopShortcutRecordings = new Set();
    }

    /**
     * Module initialization hook.
     */
    init() {}

    /**
     * Module tear down for Sine hot unloading
     */
    destroy() {
      try {
        Core.log("ZentralSettings", "Destroying Settings module...");
        for (const stop of this._stopShortcutRecordings) stop();
        this._stopShortcutRecordings.clear();
        if (this.modal) {
          if (this.close) this.close();
          if (this.modal.parentNode) this.modal.remove();
          this.modal = null;
        }
        if (this._matrixMouseUpHandler) {
          window.removeEventListener("mouseup", this._matrixMouseUpHandler);
          this._matrixMouseUpHandler = null;
        }
        if (this._escapeKeyHandler) {
          window.removeEventListener("keydown", this._escapeKeyHandler);
          this._escapeKeyHandler = null;
        }
        const modalEl = document.getElementById("zentral-settings-modal");
        if (modalEl) modalEl.remove();
        const stylesEl = document.getElementById("zentral-settings-styles");
        if (stylesEl) stylesEl.remove();
        this._stylesInjected = false;
        delete window.ZentralSettingsInstance;
      } catch (e) {
        console.error("[Zentral] Settings destroy error:", e);
      }
    }

    /**
     * Dynamically positions the modal dialog to fit the content area, excluding the sidebar.
     */
    updatePosition() {
      if (!this.modal) return;
      try {
        const sidebar =
          document.getElementById("sidebar-box") ||
          document.getElementById("sidebar-container") ||
          document.getElementById("vertical-tabs") ||
          document
            .getElementById("tabbrowser-tabs")
            ?.closest(
              "#sidebar-box, #sidebar-container, #vertical-tabs, .zen-sidebar",
            ) ||
          document.getElementById("tabbrowser-tabs");

        const isSidebarCollapsed =
          document.documentElement.getAttribute("zen-sidebar-collapsed") ===
            "true" ||
          document.documentElement.getAttribute("zentral-sidebar-collapsed") ===
            "true";

        if (sidebar && !isSidebarCollapsed) {
          const sRect = sidebar.getBoundingClientRect();
          const isRight =
            document.documentElement.getAttribute("zen-sidebar-right") ===
              "true" ||
            document.documentElement.getAttribute("zen-right-side") ===
              "true" ||
            sRect.left > window.innerWidth / 2;

          if (sRect.width > 20 && sRect.width < window.innerWidth) {
            if (isRight) {
              this.modal.style.left = "0px";
              this.modal.style.top = "0px";
              this.modal.style.bottom = "0px";
              this.modal.style.right =
                window.innerWidth - Math.round(sRect.left) + "px";
              this.modal.style.width = Math.round(sRect.left) + "px";
            } else {
              this.modal.style.left = Math.round(sRect.right) + "px";
              this.modal.style.top = "0px";
              this.modal.style.bottom = "0px";
              this.modal.style.right = "0px";
              this.modal.style.width =
                window.innerWidth - Math.round(sRect.right) + "px";
            }
            this.modal.style.height = "100vh";
            return;
          }
        }
      } catch (_) {}

      this.modal.style.left = "0px";
      this.modal.style.top = "0px";
      this.modal.style.right = "0px";
      this.modal.style.bottom = "0px";
      this.modal.style.width = "100vw";
      this.modal.style.height = "100vh";
    }

    /**
     * Opens the settings modal dialog.
     */
    open() {
      if (!this.modal) {
        this.createModal();
      }
      this.modal.setAttribute("data-open", "true");
      this.modal.style.setProperty("display", "flex", "important");
      this.populate();
      this.updatePosition();

      if (!this._escapeKeyHandler) {
        this._escapeKeyHandler = (e) => {
          if (
            e.key === "Escape" &&
            this.modal &&
            this.modal.getAttribute("data-open") === "true"
          ) {
            this.close();
          }
        };
        window.addEventListener("keydown", this._escapeKeyHandler);
      }

      if (!this._resizeHandler) {
        this._resizeHandler = () => this.updatePosition();
        window.addEventListener("resize", this._resizeHandler, {
          passive: true,
        });
      }
    }

    /**
     * Closes the settings modal dialog.
     */
    close() {
      for (const stop of this._stopShortcutRecordings) stop();
      if (this.modal) {
        this.modal.setAttribute("data-open", "false");
        this.modal.style.setProperty("display", "none", "important");
      }
      if (this._escapeKeyHandler) {
        window.removeEventListener("keydown", this._escapeKeyHandler);
        this._escapeKeyHandler = null;
      }
      if (this._resizeHandler) {
        window.removeEventListener("resize", this._resizeHandler);
        this._resizeHandler = null;
      }
    }

    /**
     * Opens the native OS directory picker dialog to select an export folder.
     * @returns {Promise<string|null>} Selected directory path or null if cancelled.
     */
    async pickExportFolder() {
      return new Promise((resolve) => {
        try {
          const nsIFilePicker =
            Ci?.nsIFilePicker || Components.interfaces.nsIFilePicker;
          const fp = (
            Cc?.["@mozilla.org/filepicker;1"] ||
            Components.classes["@mozilla.org/filepicker;1"]
          ).createInstance(nsIFilePicker);

          const parentWin = window.browsingContext || window;
          fp.init(
            parentWin,
            "Select Diagnostic Log Export Directory",
            nsIFilePicker.modeGetFolder,
          );

          let resolved = false;
          const onDone = (result) => {
            if (resolved) return;
            resolved = true;
            if (result === nsIFilePicker.returnOK && fp.file) {
              resolve(fp.file.path);
            } else {
              resolve(null);
            }
          };

          if (typeof fp.open === "function") {
            try {
              const res = fp.open({
                done(val) {
                  onDone(val);
                },
              });
              if (res && typeof res.then === "function") {
                res.then((result) => onDone(result)).catch(() => onDone(null));
              }
            } catch (_) {
              try {
                const res2 = fp.open((val) => onDone(val));
                if (res2 && typeof res2.then === "function") {
                  res2
                    .then((result) => onDone(result))
                    .catch(() => onDone(null));
                }
              } catch (e2) {
                onDone(null);
              }
            }
          } else if (typeof fp.show === "function") {
            const res = fp.show();
            onDone(res);
          } else {
            onDone(null);
          }
        } catch (err) {
          console.error("[ZentralSettings] Error opening folder picker:", err);
          resolve(null);
        }
      });
    }

    /**
     * Updates the folder button label and description based on current export path.
     * @param {string} path - Directory path.
     */
    updatePathUI(path) {
      if (!this.modal) return;
      const label = this.modal.querySelector("#zs-btn-choose-path-label");
      const btn = this.modal.querySelector("#zs-btn-choose-path");
      const clearBtn = this.modal.querySelector("#zs-btn-clear-path");
      const desc = this.modal.querySelector("#zs-pref-logger-path-desc");
      if (!label || !btn) return;

      if (path && path.trim() !== "") {
        const cleanPath = path.trim();
        const parts = cleanPath.split(/[\\/]/).filter(Boolean);
        const folderName = parts.pop() || cleanPath;
        label.textContent = folderName;
        btn.title = cleanPath;
        if (clearBtn) clearBtn.style.display = "flex";
        if (desc) desc.textContent = `Saving to: ${cleanPath}`;
      } else {
        label.textContent = "Default Folder";
        btn.title =
          "Logs will be saved in profile chrome/logs directory. Click to change folder.";
        if (clearBtn) clearBtn.style.display = "none";
        if (desc)
          desc.textContent = "Directory where diagnostic logs are saved";
      }
    }

    /**
     * Reads preferences from ZentralCore and populates modal input fields and switches.
     */
    populate() {
      if (!this.modal) return;
      const get = (id) => this.modal.querySelector("#" + id);
      if (!get("zs-anim-speed")) return;

      const appsEnabled =
        Core.getPref(Constants.Apps.PREF_ENABLED, true) !== false;
      if (get("zs-ag-enabled")) {
        get("zs-ag-enabled").checked = appsEnabled;
        if (get("zs-ag-status")) {
          get("zs-ag-status").textContent = appsEnabled
            ? "Enabled"
            : "Disabled";
          get("zs-ag-status").setAttribute(
            "data-enabled",
            appsEnabled ? "true" : "false",
          );
        }
        if (get("zs-ag-content")) {
          get("zs-ag-content").setAttribute(
            "data-disabled",
            !appsEnabled ? "true" : "false",
          );
        }
      }

      const placement =
        Core.getPref(Constants.Apps.PREF_PLACEMENT, "sidebar") || "sidebar";
      if (get("zs-ag-placement")) get("zs-ag-placement").value = placement;
      if (get("zs-ag-col"))
        get("zs-ag-col").setAttribute("data-placement", placement);
      this.modal.querySelectorAll(".zs-placement-btn").forEach((btn) => {
        btn.setAttribute(
          "data-active",
          btn.dataset.placement === placement ? "true" : "false",
        );
      });

      // Show/hide Apps Box Matrix with smooth slide animation based on placement
      const matrixWrapper = get("zs-matrix-wrapper");
      if (matrixWrapper) {
        if (placement === "sidebar") {
          matrixWrapper.removeAttribute("data-hidden");
        } else {
          matrixWrapper.setAttribute("data-hidden", "true");
        }
      }

      const utilityRow = get("zs-utility-section-row");
      if (utilityRow) {
        if (placement === "sidebar") {
          utilityRow.removeAttribute("data-hidden");
        } else {
          utilityRow.setAttribute("data-hidden", "true");
        }
      }

      const cols = Core.getPref(Constants.Apps.PREF_APPS_PER_ROW, 7) || 7;
      const rows = Core.getPref(Constants.Apps.PREF_MAX_ROWS, 3) || 3;
      this.updateMatrixUI(cols, rows);

      const animType =
        Core.getPref(Constants.Apps.PREF_ANIMATION_TYPE, "slide") || "slide";
      const animSpeed =
        Core.getPref(Constants.Apps.PREF_ANIMATION_SPEED, 450) ?? 450;
      const maxApps = Core.getPref(Constants.Apps.PREF_MAX_APPS, 21) || 21;

      const animDropdown = this.modal.querySelector("#zs-anim-type-dropdown");
      if (animDropdown && animDropdown.syncValue) {
        animDropdown.syncValue(animType);
      } else if (get("zs-anim-type")) {
        get("zs-anim-type").value = animType;
      }

      get("zs-anim-speed").value = animSpeed;
      if (get("zs-anim-speed-slider"))
        get("zs-anim-speed-slider").value = animSpeed;
      if (get("zs-anim-speed-badge"))
        get("zs-anim-speed-badge").textContent = `${animSpeed} ms`;
      get("zs-max-apps").value = maxApps;
      if (get("zs-hide-utility-section")) {
        get("zs-hide-utility-section").checked =
          Core.getPref(Constants.Apps.PREF_HIDE_UTILITY_SECTION, false) ===
          true;
      }

      const instaPeekShortcut =
        Core.getPref(Constants.Apps.PREF_INSTA_PEEK_SHORTCUT, "Alt+Q") ||
        "Alt+Q";
      const instaPeekBtn = this.modal.querySelector("#zs-insta-peek-btn");
      if (instaPeekBtn && instaPeekBtn.syncValue) {
        instaPeekBtn.syncValue(instaPeekShortcut);
      } else if (get("zs-insta-peek-shortcut")) {
        get("zs-insta-peek-shortcut").value = instaPeekShortcut;
      }

      this.updatePreviewDemo(animType, animSpeed);

      const tgEnabled =
        Core.getPref(Constants.TabGroups.PREF_ENABLED, true) !== false;
      if (get("zs-tg-enabled")) {
        get("zs-tg-enabled").checked = tgEnabled;
        if (get("zs-tg-status")) {
          get("zs-tg-status").textContent = tgEnabled ? "Enabled" : "Disabled";
          get("zs-tg-status").setAttribute(
            "data-enabled",
            tgEnabled ? "true" : "false",
          );
        }
        if (get("zs-tg-content")) {
          get("zs-tg-content").setAttribute(
            "data-disabled",
            !tgEnabled ? "true" : "false",
          );
        }
      }

      get("zs-tg-collapse").checked =
        Core.getPref(Constants.TabGroups.PREF_COLLAPSE_ON_LAUNCH, false) ===
        true;
      get("zs-tg-thumbnails").checked =
        Core.getPref(Constants.TabGroups.PREF_THUMBNAILS, true) !== false;

      const showIndicator =
        Core.getPref(Constants.TabGroups.PREF_SHOW_CHEVRON, true) !== false;
      get("zs-tg-chevron").checked = showIndicator;
      const indicatorTypeRow = get("zs-tg-indicator-type-row");
      if (indicatorTypeRow) {
        if (showIndicator) {
          indicatorTypeRow.removeAttribute("data-hidden");
        } else {
          indicatorTypeRow.setAttribute("data-hidden", "true");
        }
      }

      const indicatorType =
        Core.getPref(Constants.TabGroups.PREF_INDICATOR_TYPE, "circle") ||
        "circle";
      const tgDropdown = this.modal.querySelector(
        "#zs-tg-indicator-type-dropdown",
      );
      if (tgDropdown && tgDropdown.syncValue) {
        tgDropdown.syncValue(indicatorType);
      } else if (get("zs-tg-indicator-type")) {
        get("zs-tg-indicator-type").value = indicatorType;
      }

      const opacity =
        Core.getPref(Constants.TabGroups.PREF_LABEL_OPACITY, 85) ?? 85;
      if (get("zs-tg-opacity")) {
        get("zs-tg-opacity").value = opacity;
        if (get("zs-tg-opacity-badge"))
          get("zs-tg-opacity-badge").textContent = opacity + "%";
      }

      if (get("zs-pref-logger-enabled")) {
        get("zs-pref-logger-enabled").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_ENABLED,
          false,
        );
      }
      if (get("zs-pref-logger-full")) {
        get("zs-pref-logger-full").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_FULL,
          true,
        );
      }
      if (get("zs-pref-logger-core")) {
        get("zs-pref-logger-core").checked = true; // Always on
      }
      if (get("zs-pref-logger-tabs")) {
        get("zs-pref-logger-tabs").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_TABS,
          false,
        );
      }
      if (get("zs-pref-logger-apps")) {
        get("zs-pref-logger-apps").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_APPS,
          false,
        );
      }
      if (get("zs-pref-logger-menus")) {
        get("zs-pref-logger-menus").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_MENUS,
          false,
        );
      }
      if (get("zs-pref-logger-layout")) {
        get("zs-pref-logger-layout").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_LAYOUT,
          false,
        );
      }
      if (get("zs-pref-logger-path")) {
        const savedPath = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_PATH,
          "",
        );
        get("zs-pref-logger-path").value = savedPath;
        this.updatePathUI(savedPath);
      }

      this.updateLoggerUIState();
    }

    /**
     * Synchronizes dynamic visibility and interactivity across Diagnostic Logging toggles.
     */
    updateLoggerUIState() {
      if (!this.modal) return;
      const get = (id) => this.modal.querySelector("#" + id);
      const masterToggle = get("zs-pref-logger-enabled");
      const fullToggle = get("zs-pref-logger-full");
      const optionsSection = get("zs-logger-options-section");
      const modulesContainer = get("zs-logger-modules-container");

      const isMasterOn = masterToggle ? masterToggle.checked : false;
      if (optionsSection) {
        if (isMasterOn) {
          optionsSection.classList.remove("zs-section-disabled");
        } else {
          optionsSection.classList.add("zs-section-disabled");
        }
      }

      const isFull = fullToggle ? fullToggle.checked : true;
      if (modulesContainer) {
        modulesContainer.setAttribute("data-hidden", isFull ? "true" : "false");
      }
    }

    /**
     * Updates the animation preview demo element with live easing curve and duration.
     * @param {string} type - Animation easing type
     * @param {number} speedMs - Animation duration in milliseconds
     */
    updatePreviewDemo(type, speedMs) {
      if (!this.modal) return;
      const previewBox = this.modal.querySelector("#zs-anim-preview-box");
      if (!previewBox) return;

      let curve = "cubic-bezier(0.25, 1, 0.5, 1)";
      if (type === "spring-snappy")
        curve = "cubic-bezier(0.175, 0.885, 0.32, 1.275)";
      else if (type === "spring-gentle")
        curve = "cubic-bezier(0.34, 1.3, 0.64, 1)";
      else if (type === "spring-bouncy")
        curve = "cubic-bezier(0.68, -0.55, 0.265, 1.55)";
      else if (type === "elastic")
        curve = "cubic-bezier(0.68, -0.6, 0.32, 1.6)";
      else if (type === "none") curve = "step-end";

      const duration =
        type === "none" || speedMs <= 0
          ? "0.01s"
          : `${(speedMs / 1000).toFixed(2)}s`;
      previewBox.style.setProperty("--zs-preview-anim-curve", curve);
      previewBox.style.setProperty("--zs-preview-anim-duration", duration);
    }

    /**
     * Updates the 10x6 matrix selection visual state and hidden inputs.
     * @param {number} cols - Columns count (1 to 10)
     * @param {number} rows - Rows count (1 to 6)
     */
    updateMatrixUI(cols, rows) {
      if (!this.modal) return;
      const clampedCols = Math.max(1, Math.min(10, parseInt(cols, 10) || 1));
      const clampedRows = Math.max(1, Math.min(6, parseInt(rows, 10) || 1));

      const cells = this.modal.querySelectorAll(".zs-matrix-cell");
      cells.forEach((cell) => {
        const c = parseInt(cell.dataset.col, 10);
        const r = parseInt(cell.dataset.row, 10);
        cell.setAttribute(
          "data-selected",
          c <= clampedCols && r <= clampedRows ? "true" : "false",
        );
      });

      const get = (id) => this.modal.querySelector("#" + id);
      if (get("zs-apps-row")) get("zs-apps-row").value = clampedCols;
      if (get("zs-max-rows")) get("zs-max-rows").value = clampedRows;
      if (get("zs-matrix-dims"))
        get("zs-matrix-dims").textContent =
          `${clampedCols} Columns × ${clampedRows} Rows`;
      if (get("zs-matrix-total-badge"))
        get("zs-matrix-total-badge").textContent =
          `${clampedCols * clampedRows} Visible Apps`;
    }

    /**
     * Reads form fields from modal UI, saves settings via ZentralCore, and triggers UI re-renders.
     */
    save() {
      if (!this.modal) return;
      const get = (id) => this.modal.querySelector("#" + id);
      Core.setPref(Constants.Apps.PREF_ENABLED, get("zs-ag-enabled").checked);
      if (get("zs-ag-placement")) {
        Core.setPref(
          Constants.Apps.PREF_PLACEMENT,
          get("zs-ag-placement").value,
        );
      }
      Core.setPref(
        Constants.Apps.PREF_ANIMATION_TYPE,
        get("zs-anim-type").value,
      );
      Core.setPref(
        Constants.Apps.PREF_ANIMATION_SPEED,
        parseInt(get("zs-anim-speed").value) || 0,
      );
      Core.setPref(
        Constants.Apps.PREF_MAX_APPS,
        parseInt(get("zs-max-apps").value) || 21,
      );
      if (get("zs-hide-utility-section")) {
        Core.setPref(
          Constants.Apps.PREF_HIDE_UTILITY_SECTION,
          get("zs-hide-utility-section").checked,
        );
      }
      Core.setPref(
        Constants.Apps.PREF_APPS_PER_ROW,
        parseInt(get("zs-apps-row").value) || 7,
      );
      Core.setPref(
        Constants.Apps.PREF_MAX_ROWS,
        parseInt(get("zs-max-rows").value) || 3,
      );
      if (get("zs-insta-peek-shortcut")) {
        Core.setPref(
          Constants.Apps.PREF_INSTA_PEEK_SHORTCUT,
          get("zs-insta-peek-shortcut").value || "Alt+Q",
        );
      }

      Core.setPref(
        Constants.TabGroups.PREF_ENABLED,
        get("zs-tg-enabled").checked,
      );
      Core.setPref(
        Constants.TabGroups.PREF_COLLAPSE_ON_LAUNCH,
        get("zs-tg-collapse").checked,
      );
      Core.setPref(
        Constants.TabGroups.PREF_THUMBNAILS,
        get("zs-tg-thumbnails").checked,
      );
      Core.setPref(
        Constants.TabGroups.PREF_SHOW_CHEVRON,
        get("zs-tg-chevron").checked,
      );
      if (get("zs-tg-indicator-type")) {
        Core.setPref(
          Constants.TabGroups.PREF_INDICATOR_TYPE,
          get("zs-tg-indicator-type").value,
        );
      }
      if (get("zs-tg-opacity")) {
        Core.setPref(
          Constants.TabGroups.PREF_LABEL_OPACITY,
          Number.isFinite(parseInt(get("zs-tg-opacity").value, 10))
            ? Math.max(
                0,
                Math.min(100, parseInt(get("zs-tg-opacity").value, 10)),
              )
            : 85,
        );
      }

      if (get("zs-pref-logger-enabled")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_ENABLED,
          get("zs-pref-logger-enabled").checked,
        );
      }
      if (get("zs-pref-logger-full")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_FULL,
          get("zs-pref-logger-full").checked,
        );
      }
      Core.setPref(Constants.Diagnostics.PREF_LOGGER_CORE, true);
      if (get("zs-pref-logger-tabs")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_TABS,
          get("zs-pref-logger-tabs").checked,
        );
      }
      if (get("zs-pref-logger-apps")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_APPS,
          get("zs-pref-logger-apps").checked,
        );
      }
      if (get("zs-pref-logger-menus")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_MENUS,
          get("zs-pref-logger-menus").checked,
        );
      }
      if (get("zs-pref-logger-layout")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_LAYOUT,
          get("zs-pref-logger-layout").checked,
        );
      }
      if (get("zs-pref-logger-path")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_PATH,
          get("zs-pref-logger-path").value.trim(),
        );
      }

      this.close();
      if (window.Zentral?.Apps) {
        window.Zentral.Apps.applyHideUtilitySectionPref();
        window.Zentral.Apps.repositionGrid();
        window.Zentral.Apps.updateAutohideState();
        window.Zentral.Apps.renderGrid();
      }
      if (window.Zentral?.TabGroups) {
        window.Zentral.TabGroups.applyChevronPref();
        window.Zentral.TabGroups.applyIndicatorTypePref();
        window.Zentral.TabGroups.applyLabelOpacityPref();
      }
    }

    injectStyles() {
      const existing = document.getElementById("zentral-settings-styles");
      if (existing) existing.remove();
      this._stylesInjected = true;
      const css = `
        #zentral-settings-modal {
          position: fixed;
          top: 0;
          bottom: 0;
          left: 0;
          right: 0;
          height: 100vh;
          background: rgba(0, 0, 0, 0.75);
          z-index: 2147483647;
          display: none;
          align-items: center;
          justify-content: center;
          font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        #zentral-settings-modal[data-open="true"] {
          display: flex !important;
          animation: zsFadeIn 0.18s ease-out;
        }

        #zentral-settings-modal[data-open="false"] {
          display: none !important;
        }

        @keyframes zsFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes zsModalPop {
          from {
            opacity: 0;
            transform: scale(0.97) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        @keyframes zsTabFadeIn {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .zs-dialog {
          background: #0d0d12 !important;
          color: #e4e4e7 !important;
          width: 1120px !important;
          max-width: 95vw !important;
          height: 780px !important;
          max-height: 94vh !important;
          border-radius: 14px !important;
          box-shadow: 0 25px 70px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
          border: 1px solid rgba(255, 255, 255, 0.09) !important;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: zsModalPop 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .zs-header {
          padding: 18px 32px 14px 32px;
          background: #13131a !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07) !important;
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: #ffffff;
          flex-shrink: 0;
        }

        .zs-title-group {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .zs-title {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: #ffffff;
        }

        .zs-version-badge {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 9999px;
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--zen-primary-color, #6366f1) 25%, transparent);
          color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 85%, #ffffff);
          font-weight: 500;
        }

        .zs-close-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          background: transparent;
          border: none;
          border-radius: 0;
          box-shadow: none;
          color: #71717a;
          cursor: pointer;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.15s ease;
          padding: 0;
        }

        .zs-close-btn * {
          pointer-events: none;
        }

        .zs-close-btn:hover {
          color: #ffffff;
          background: transparent;
          border: none;
          box-shadow: none;
        }

        .zs-close-btn:active {
          color: #d4d4d8;
          background: transparent;
          border: none;
          box-shadow: none;
          transform: scale(0.94);
        }

        .zs-header-actions {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .zs-kofi-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          background: transparent;
          border: none;
          padding: 0;
          margin: 0;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 0;
          border-radius: 6px;
          transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.18s ease;
          text-decoration: none;
        }

        .zs-kofi-btn:hover {
          transform: translateY(-1px) scale(1.03);
          filter: brightness(1.0) drop-shadow(0 3px 8px rgba(19, 195, 117, 0.45));
        }

        .zs-kofi-btn:active {
          transform: translateY(0) scale(0.97);
          filter: brightness(0.95);
        }

        .zs-kofi-btn svg {
          height: 36px;
          width: auto;
          display: block;
          pointer-events: none;
        }

        .zs-tab-bar {
          display: flex;
          padding: 0 32px;
          background: #13131a !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07) !important;
          gap: 24px;
          flex-shrink: 0;
        }

        .zs-tab-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          background: transparent;
          border: none;
          border-radius: 0;
          box-shadow: none;
          padding: 10px 4px;
          font-size: 13.5px;
          font-weight: 500;
          color: #71717a;
          cursor: pointer;
          position: relative;
          transition: color 0.15s ease;
          user-select: none;
        }

        .zs-tab-btn:hover {
          color: #d4d4d8;
          background: transparent;
          border: none;
          outline: none;
          box-shadow: none;
        }

        .zs-tab-btn[data-active="true"] {
          color: #ffffff;
          font-weight: 600;
          background: transparent;
          border: none;
          outline: none;
          box-shadow: none;
        }

        .zs-tab-btn[data-active="true"]::after {
          content: "";
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--zen-primary-color, #6366f1);
        }

        .zs-body {
          padding: 22px 32px;
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
          overflow: hidden;
          background: #0d0d12 !important;
        }

        .zs-tab-panel {
          display: none;
          flex-direction: column;
          width: 100%;
          flex: 1 1 auto;
          height: 100%;
          min-height: 0;
        }

        .zs-tab-panel[data-active="true"] {
          display: flex !important;
          animation: zsTabFadeIn 0.18s ease-out;
        }

        .zs-columns {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          align-items: stretch;
          width: 100%;
          height: 100%;
          flex: 1 1 auto;
          min-height: 0;
          overflow: hidden;
        }

        .zs-col {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          min-width: 0;
          box-sizing: border-box;
          overflow: hidden;
        }

        #zs-ag-col {
          padding-right: 24px;
          border-right: 1px solid rgba(255, 255, 255, 0.08);
        }

        #zs-tg-col {
          padding-left: 24px;
          overflow: visible;
        }

        .zs-section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          padding-bottom: 8px;
          margin-bottom: 4px;
          flex-shrink: 0;
          pointer-events: auto;
          position: sticky;
          top: 0;
          background: #0d0d12;
          z-index: 10;
        }

        .zs-section-title {
          font-size: 13px;
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #f4f4f5;
          margin: 0;
        }

        .zs-header-toggle {
          display: flex;
          align-items: center;
          gap: 10px;
          pointer-events: auto;
        }

        .zs-toggle-status {
          font-size: 12px;
          font-weight: 500;
          color: #a1a1aa;
          user-select: none;
        }

        .zs-section-content {
          display: flex;
          flex-direction: column;
          gap: 14px;
          flex: 1 1 auto;
          min-height: 0;
          padding-top: 8px;
          padding-right: 4px;
          overflow-y: auto;
          overflow-x: hidden;
          transition: opacity 0.2s ease, filter 0.2s ease;
        }

        .zs-section-content > * {
          flex-shrink: 0;
        }

        .zs-section-content::-webkit-scrollbar,
        .zs-col::-webkit-scrollbar {
          width: 5px;
        }

        .zs-section-content::-webkit-scrollbar-track,
        .zs-col::-webkit-scrollbar-track {
          background: transparent;
        }

        .zs-section-content::-webkit-scrollbar-thumb,
        .zs-col::-webkit-scrollbar-thumb {
          background: #3f3f46;
          border-radius: 9999px;
        }

        .zs-section-content::-webkit-scrollbar-thumb:hover,
        .zs-col::-webkit-scrollbar-thumb:hover {
          background: #52525b;
        }

        .zs-section-content[data-disabled="true"] {
          opacity: 0.35;
          pointer-events: none;
          filter: grayscale(0.65);
        }

        .zs-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          min-height: 30px;
        }

        .zs-label-container {
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
          min-width: 0;
        }

        .zs-label {
          font-size: 13.5px;
          font-weight: 500;
          color: #ffffff;
        }

        .zs-sublabel {
          font-size: 11.5px;
          color: #a1a1aa;
          margin-top: 2px;
          line-height: 1.35;
        }

        .zs-placement-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .zs-placement-cards {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .zs-placement-btn {
          -moz-appearance: none;
          appearance: none;
          position: relative;
          background: rgba(24, 24, 27, 0.4);
          border: 2px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 12px 10px 10px 10px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
          color: #a1a1aa;
          outline: none;
          user-select: none;
          box-sizing: border-box;
          box-shadow: none;
        }

        .zs-placement-btn * {
          pointer-events: none;
        }

        .zs-placement-btn:hover {
          border-color: rgba(255, 255, 255, 0.22);
          background: rgba(39, 39, 42, 0.4);
          color: #f4f4f5;
          box-shadow: none;
        }

        .zs-placement-btn[data-active="true"] {
          border-color: var(--zen-primary-color, #6366f1);
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 12%, rgba(24, 24, 27, 0.7));
          box-shadow: none;
          color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 85%, #ffffff);
        }

        .zs-placement-btn .zs-placement-svg-box {
          width: 128px;
          height: 64px;
          border-radius: 6px;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          padding: 5px;
          gap: 5px;
          box-sizing: border-box;
        }

        .zs-placement-sidebar-container {
          width: 24px;
          height: 100%;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 3px;
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 2px;
          box-sizing: border-box;
          flex-shrink: 0;
        }

        .zs-placement-appbox-indicator {
          width: 100%;
          height: 15px;
          border-radius: 2px;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-sizing: border-box;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .zs-placement-btn[data-active="true"] .zs-placement-appbox-indicator {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 40%, transparent);
          border-color: var(--zen-primary-color, #6366f1);
        }

        .zs-placement-sidebar-body {
          width: 100%;
          flex: 1 1 auto;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 2px;
        }

        .zs-placement-btn .zs-placement-bar-indicator {
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 3px;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .zs-placement-btn[data-active="true"] .zs-placement-bar-indicator {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 40%, transparent);
          border-color: var(--zen-primary-color, #6366f1);
        }

        .zs-placement-btn .zs-placement-content-preview {
          flex: 1 1 auto;
          height: 100%;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 3px;
        }

        .zs-placement-label {
          font-size: 13px;
          font-weight: 500;
          transition: color 0.15s ease, font-weight 0.15s ease;
        }

        .zs-placement-btn[data-active="true"] .zs-placement-label {
          color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 85%, #ffffff);
          font-weight: 700;
        }

        .zs-h-stepper {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 2px;
          height: 32px;
          box-sizing: border-box;
          flex-shrink: 0;
        }

        .zs-h-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          width: 28px;
          height: 28px;
          background: transparent;
          border: none;
          border-radius: 5px;
          color: #a1a1aa;
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.12s ease, color 0.12s ease;
          user-select: none;
          padding: 0;
        }

        .zs-h-btn:hover {
          background: #27272a;
          color: #ffffff;
        }

        .zs-h-btn:active {
          background: var(--zen-primary-color, #6366f1);
          color: #ffffff;
        }

        .zs-h-val {
          width: 32px;
          background: transparent;
          border: none;
          color: #ffffff;
          text-align: center;
          font-size: 13px;
          font-weight: 600;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          outline: none;
          -moz-appearance: textfield;
          appearance: textfield;
          padding: 0;
        }

        .zs-h-val::-webkit-outer-spin-button,
        .zs-h-val::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        .zs-stacked-slider {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
        }

        .zs-stacked-slider-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
        }

        .zs-mono-badge {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          background: #27272a;
          color: #d4d4d8;
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 500;
          letter-spacing: 0.02em;
        }

        .zs-range-slider {
          width: 100%;
          height: 5px;
          border-radius: 9999px;
          background: #27272a;
          outline: none;
          -webkit-appearance: none;
          appearance: none;
          cursor: pointer;
          transition: background-color 0.15s ease;
        }

        .zs-range-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 15px;
          height: 15px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
          cursor: pointer;
          transition: transform 0.12s ease;
        }

        .zs-range-slider::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }

        .zs-matrix-wrapper {
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: rgba(24, 24, 27, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 12px 14px 14px 14px;
          overflow: hidden;
          flex-shrink: 0;
          max-height: 420px;
          opacity: 1;
          transform: translateY(0);
          box-sizing: border-box;
          transition: max-height 0.32s cubic-bezier(0.16, 1, 0.3, 1),
                      opacity 0.22s ease,
                      padding 0.32s cubic-bezier(0.16, 1, 0.3, 1),
                      margin 0.32s cubic-bezier(0.16, 1, 0.3, 1),
                      border-width 0.32s ease,
                      transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .zs-matrix-wrapper[data-hidden="true"] {
          max-height: 0 !important;
          opacity: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          border-width: 0 !important;
          transform: translateY(-8px) !important;
          pointer-events: none !important;
        }

        .zs-matrix-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .zs-matrix-title {
          font-size: 13px;
          font-weight: 600;
          color: #ffffff;
        }

        .zs-matrix-readout {
          font-size: 12px;
          font-weight: 500;
          color: var(--zen-primary-color, #6366f1);
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .zs-matrix-badge {
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 85%, #ffffff);
          padding: 3px 8px;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 600;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }

        .zs-matrix-grid {
          display: grid;
          grid-template-columns: repeat(10, 1fr);
          grid-template-rows: repeat(6, 1fr);
          gap: 6px;
          width: 100%;
          max-width: 100%;
          user-select: none;
          touch-action: none;
          box-sizing: border-box;
          padding: 4px 0 2px 0;
        }

        .zs-matrix-cell {
          aspect-ratio: 1 / 1;
          width: 100%;
          height: auto;
          min-height: 0;
          max-height: none;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.12s ease, border-color 0.12s ease;
          box-shadow: none;
          box-sizing: border-box;
        }

        .zs-matrix-cell:hover,
        .zs-matrix-cell[data-hover="true"] {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 45%, rgba(255,255,255,0.12));
          border-color: var(--zen-primary-color, #6366f1);
          box-shadow: none;
        }

        .zs-matrix-cell[data-selected="true"] {
          background: var(--zen-primary-color, #6366f1);
          border-color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 75%, #ffffff);
          box-shadow: none;
        }

        .zs-matrix-cell[data-selected="true"]:hover,
        .zs-matrix-cell[data-selected="true"][data-hover="true"] {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 80%, #ffffff);
          border-color: #ffffff;
          box-shadow: none;
          filter: none;
          transform: none;
        }

        .zs-anim-preview-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: rgba(24, 24, 27, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 8px 12px;
        }

        .zs-anim-preview-box {
          position: relative;
          height: 56px;
          background: #131316;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          overflow: hidden;
          display: flex;
          align-items: center;
          cursor: pointer;
          user-select: none;
        }

        .zs-anim-preview-sidebar {
          width: 28px;
          height: 100%;
          background: rgba(255, 255, 255, 0.035);
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          flex-shrink: 0;
          z-index: 2;
        }

        .zs-anim-preview-dot {
          width: 12px;
          height: 12px;
          border-radius: 3.5px;
          background: rgba(255, 255, 255, 0.15);
        }

        .zs-anim-preview-panel {
          position: absolute;
          left: 29px;
          top: 5px;
          bottom: 5px;
          width: 0;
          max-width: 140px;
          opacity: 0;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid color-mix(in srgb, var(--zen-primary-color, #6366f1) 40%, rgba(255,255,255,0.1));
          border-radius: 6px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          padding: 5px 8px;
          gap: 3px;
          box-sizing: border-box;
          pointer-events: none;
          transform: translateX(-10px) scale(0.95);
          transition: width var(--zs-preview-anim-duration, 0.45s) var(--zs-preview-anim-curve, cubic-bezier(0.25, 1, 0.5, 1)),
                      opacity var(--zs-preview-anim-duration, 0.45s) var(--zs-preview-anim-curve, cubic-bezier(0.25, 1, 0.5, 1)),
                      transform var(--zs-preview-anim-duration, 0.45s) var(--zs-preview-anim-curve, cubic-bezier(0.25, 1, 0.5, 1));
        }

        .zs-anim-preview-box:hover .zs-anim-preview-panel,
        .zs-anim-preview-box[data-preview-active="true"] .zs-anim-preview-panel {
          width: 125px;
          opacity: 1;
          transform: translateX(0) scale(1);
        }

        .zs-anim-preview-pill {
          height: 5px;
          width: 44px;
          border-radius: 3px;
          background: var(--zen-primary-color, #6366f1);
        }

        .zs-anim-preview-line {
          height: 3.5px;
          border-radius: 2px;
          background: rgba(255, 255, 255, 0.2);
          margin-top: 1px;
        }

        .zs-anim-preview-hint {
          position: absolute;
          right: 12px;
          font-size: 11px;
          color: #71717a;
          pointer-events: none;
          transition: opacity 0.15s ease;
        }

        .zs-anim-preview-box:hover .zs-anim-preview-hint,
        .zs-anim-preview-box[data-preview-active="true"] .zs-anim-preview-hint {
          opacity: 0;
        }

        #zs-panel-diagnostics {
          overflow-y: auto !important;
          overflow-x: hidden !important;
          padding-right: 6px !important;
          scrollbar-width: thin !important;
          scrollbar-color: #3f3f46 transparent !important;
        }

        #zs-panel-diagnostics::-webkit-scrollbar {
          width: 5px;
        }

        #zs-panel-diagnostics::-webkit-scrollbar-track {
          background: transparent;
        }

        #zs-panel-diagnostics::-webkit-scrollbar-thumb {
          background: #3f3f46;
          border-radius: 9999px;
        }

        #zs-panel-diagnostics::-webkit-scrollbar-thumb:hover {
          background: #52525b;
        }

        .zs-custom-select {
          position: relative;
          user-select: none;
        }

        .zs-custom-select-trigger {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          width: 100%;
          height: 36px;
          min-height: 36px;
          max-height: 36px;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          color: #ffffff;
          padding: 0 12px;
          font-size: 13px;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease;
          box-sizing: border-box;
          box-shadow: none;
          white-space: nowrap;
        }

        .zs-custom-select-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1 1 auto;
          text-align: left;
          font-size: 12.5px;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }

        .zs-custom-select-trigger * {
          pointer-events: none;
        }

        .zs-custom-select-trigger:hover {
          background-color: #27272a;
          border-color: rgba(255, 255, 255, 0.22);
        }

        .zs-custom-select[data-open="true"] .zs-custom-select-trigger {
          border-color: var(--zen-primary-color, #6366f1);
        }

        .zs-shortcut-recorder {
          display: inline-flex;
          align-items: center;
          position: relative;
        }

        .zs-shortcut-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          height: 32px;
          min-height: 32px;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: #ffffff;
          padding: 0 14px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.03em;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
          box-sizing: border-box;
          user-select: none;
        }

        .zs-shortcut-btn:hover {
          background: #27272a;
          border-color: rgba(255, 255, 255, 0.22);
        }

        .zs-shortcut-btn[data-recording="true"] {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 22%, #18181b);
          border-color: var(--zen-primary-color, #6366f1);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--zen-primary-color, #6366f1) 35%, transparent);
          color: #ffffff;
        }

        .zs-shortcut-label {
          letter-spacing: 0.03em;
        }

        .zs-custom-select-arrow {
          width: 14px !important;
          height: 14px !important;
          min-width: 14px !important;
          min-height: 14px !important;
          max-width: 14px !important;
          max-height: 14px !important;
          color: rgba(255, 255, 255, 0.65);
          transition: transform 0.18s ease;
          flex-shrink: 0;
          display: block;
        }

        .zs-custom-select[data-open="true"] .zs-custom-select-arrow {
          transform: rotate(180deg);
        }

        .zs-custom-select-menu {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          min-width: 100%;
          width: max-content;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.65);
          padding: 4px;
          z-index: 1000;
          display: none;
          flex-direction: column;
          gap: 2px;
          animation: zsTabFadeIn 0.12s ease-out;
        }

        .zs-custom-select[data-open="true"] .zs-custom-select-menu {
          display: flex;
        }

        .zs-custom-select-option {
          padding: 6px 10px;
          font-size: 12.5px;
          font-weight: 500;
          color: #e4e4e7;
          border-radius: 6px;
          cursor: pointer;
          transition: background-color 0.1s ease, color 0.1s ease;
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .zs-custom-select-option:hover {
          background: #27272a;
          color: #ffffff;
        }

        .zs-custom-select-option[data-selected="true"] {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 18%, rgba(255, 255, 255, 0.05));
          color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 85%, #ffffff);
          font-weight: 600;
        }

        .zs-cat-icon {
          width: 14px !important;
          height: 14px !important;
          min-width: 14px !important;
          min-height: 14px !important;
          color: rgba(255, 255, 255, 0.7);
          flex-shrink: 0;
          display: block;
        }

        .zs-custom-select-option:hover .zs-cat-icon,
        .zs-custom-select-option[data-selected="true"] .zs-cat-icon {
          color: currentColor;
        }

        #zs-tg-content {
          overflow: visible;
        }

        #zs-tg-indicator-type-row {
          overflow: visible;
          min-height: 30px;
          max-height: 48px;
          opacity: 1;
          transform: translateY(0);
          transition: max-height 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      min-height 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      opacity 0.20s ease,
                      margin 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      padding 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        }

        #zs-tg-indicator-type-row[data-hidden="true"] {
          min-height: 0 !important;
          height: 0 !important;
          max-height: 0 !important;
          opacity: 0 !important;
          overflow: hidden !important;
          margin-top: -14px !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
          transform: translateY(-6px) !important;
          pointer-events: none !important;
          visibility: hidden !important;
        }

        #zs-utility-section-row {
          transition: max-height 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      min-height 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      opacity 0.20s ease,
                      margin 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      padding 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        }

        #zs-utility-section-row[data-hidden="true"] {
          min-height: 0 !important;
          height: 0 !important;
          max-height: 0 !important;
          opacity: 0 !important;
          overflow: hidden !important;
          margin-top: -14px !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
          transform: translateY(-6px) !important;
          pointer-events: none !important;
          visibility: hidden !important;
        }

        .zs-switch {
          position: relative;
          display: inline-block;
          width: 36px;
          height: 20px;
          flex-shrink: 0;
          pointer-events: auto;
        }

        .zs-switch input {
          opacity: 0;
          width: 0;
          height: 0;
          pointer-events: auto;
        }

        .zs-slider {
          position: absolute;
          cursor: pointer;
          inset: 0;
          background-color: #3f3f46;
          transition: background-color 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
          border-radius: 9999px;
        }

        .zs-slider:before {
          position: absolute;
          content: "";
          height: 16px;
          width: 16px;
          left: 2px;
          bottom: 2px;
          background-color: #ffffff;
          transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
          border-radius: 50%;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
        }

        .zs-switch input:checked + .zs-slider {
          background-color: var(--zen-primary-color, #6366f1);
        }

        .zs-switch input:checked + .zs-slider:before {
          transform: translateX(16px);
        }

        .zs-switch input:disabled + .zs-slider {
          opacity: 0.55 !important;
          cursor: not-allowed !important;
        }

        .zs-modules-subgroup {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.025);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 10px;
          margin-top: -4px;
          margin-bottom: 2px;
          transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        .zs-modules-subgroup[data-hidden="true"] {
          display: none !important;
        }

        .zs-section-disabled {
          opacity: 0.45 !important;
          pointer-events: none !important;
        }

        .zs-text-input {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          width: 100%;
          height: 36px;
          min-height: 36px;
          max-height: 36px;
          background: #141417;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          color: #f4f4f5;
          font-family: inherit;
          font-size: 13px;
          padding: 0 12px;
          box-sizing: border-box;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .zs-textarea-input {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          width: 100%;
          background: #141417;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          color: #f4f4f5;
          font-family: inherit;
          font-size: 13px;
          padding: 8px 12px;
          box-sizing: border-box;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
          resize: vertical;
          min-height: 76px;
        }

        .zs-text-input:focus,
        .zs-textarea-input:focus {
          background: #18181b;
          border-color: var(--zen-primary-color, #6366f1);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--zen-primary-color, #6366f1) 25%, transparent);
        }

        .zs-text-input::placeholder,
        .zs-textarea-input::placeholder {
          color: rgba(255, 255, 255, 0.35);
        }

        .zs-reset-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          align-self: flex-start;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #d4d4d8;
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
          margin-top: auto;
        }

        .zs-reset-btn:hover {
          background: #27272a;
          color: #ffffff;
          border-color: rgba(255, 255, 255, 0.2);
        }

        .zs-reset-btn:active {
          transform: scale(0.98);
        }

        .zs-footer {
          padding: 16px 32px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          background: #13131a;
          flex-shrink: 0;
        }

        .zs-btn-cancel {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          background: transparent;
          border: none;
          color: #a1a1aa;
          padding: 8px 18px;
          border-radius: 8px;
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .zs-btn-cancel:hover {
          background: #27272a;
          color: #ffffff;
        }

        .zs-btn-cancel:active {
          transform: scale(0.98);
        }

        .zs-btn-save {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          background: var(--zen-primary-color, #6366f1);
          border: none;
          color: #ffffff;
          padding: 8px 22px;
          border-radius: 8px;
          font-size: 13.5px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: none;
          transition: filter 0.15s ease, transform 0.15s ease;
        }

        .zs-btn-save:hover {
          filter: brightness(1.1);
          transform: translateY(-1px);
          box-shadow: none;
        }

        .zs-btn-save:active {
          transform: scale(0.98);
        }
      `;
      try {
        const style = document.createElement("style");
        style.id = "zentral-settings-styles";
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
      } catch (e) {
        console.error("[Zentral] Error injecting settings styles:", e);
      }
    }

    /**
     * Configures a custom dropdown select component with glitch-free option selection.
     * @param {string} dropdownId - Element ID of .zs-custom-select
     * @param {string} hiddenInputId - Element ID of associated hidden input
     * @param {Function} [onSelectCallback] - Optional callback when value changes
     */
    setupCustomSelect(dropdownId, hiddenInputId, onSelectCallback) {
      if (!this.modal) return;
      const dropdown = this.modal.querySelector("#" + dropdownId);
      const hiddenInput = this.modal.querySelector("#" + hiddenInputId);
      if (!dropdown || !hiddenInput) return;

      const trigger = dropdown.querySelector(".zs-custom-select-trigger");
      const label = dropdown.querySelector(".zs-custom-select-label");
      const options = dropdown.querySelectorAll(".zs-custom-select-option");

      const syncUI = (val) => {
        hiddenInput.value = val;
        options.forEach((opt) => {
          const isSelected = opt.dataset.value === val;
          opt.setAttribute("data-selected", isSelected ? "true" : "false");
          if (isSelected && label) {
            label.innerHTML = opt.innerHTML;
          }
        });
      };

      if (trigger) {
        trigger.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isOpen = dropdown.getAttribute("data-open") === "true";
          this.modal.querySelectorAll(".zs-custom-select").forEach((d) => {
            if (d !== dropdown) d.removeAttribute("data-open");
          });
          if (isOpen) {
            dropdown.removeAttribute("data-open");
          } else {
            dropdown.setAttribute("data-open", "true");
          }
        });
      }

      options.forEach((opt) => {
        opt.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const val = opt.dataset.value;
          syncUI(val);
          dropdown.removeAttribute("data-open");
          if (typeof onSelectCallback === "function") {
            onSelectCallback(val);
          }
        });
      });

      dropdown.syncValue = syncUI;
    }

    /**
     * Configures an interactive shortcut recorder button.
     * Click to record, press key combination, Escape to cancel, Backspace/Delete to clear to "None".
     * @param {string} buttonId - Button ID (e.g. "zs-insta-peek-btn")
     * @param {string} hiddenInputId - Hidden input ID (e.g. "zs-insta-peek-shortcut")
     * @param {Function} [onChangeCallback] - Optional callback
     */
    setupShortcutRecorder(buttonId, hiddenInputId, onChangeCallback) {
      if (!this.modal) return;
      const btn = this.modal.querySelector("#" + buttonId);
      const input = this.modal.querySelector("#" + hiddenInputId);
      if (!btn || !input) return;

      const label = btn.querySelector(".zs-shortcut-label") || btn;
      let isRecording = false;

      const stopRecording = () => {
        if (!isRecording) return;
        isRecording = false;
        window.removeEventListener("keydown", onKeyDown, true);
        btn.removeAttribute("data-recording");
        label.textContent = input.value;
      };
      this._stopShortcutRecordings.add(stopRecording);

      const syncUI = (val) => {
        stopRecording();
        const displayVal = !val || val === "None" ? "None" : val;
        input.value = displayVal;
        label.textContent = displayVal;
        btn.setAttribute("data-value", displayVal);
      };

      btn.syncValue = syncUI;

      const onKeyDown = (e) => {
        if (!isRecording) return;
        e.preventDefault();
        e.stopPropagation();

        if (e.key === "Escape") {
          syncUI(input.value);
          return;
        }

        if (e.key === "Backspace" || e.key === "Delete") {
          syncUI("None");
          if (typeof onChangeCallback === "function") onChangeCallback("None");
          return;
        }

        if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
          return;
        }

        const parts = [];
        if (e.ctrlKey) parts.push("Ctrl");
        if (e.altKey) parts.push("Alt");
        if (e.shiftKey) parts.push("Shift");
        if (e.metaKey) parts.push("Meta");

        let key = e.key;
        if (key === " " || key === "Spacebar") key = "Space";
        else if (key.length === 1) key = key.toUpperCase();
        else if (key.startsWith("Arrow")) key = key.replace("Arrow", "");

        parts.push(key);
        const combo = parts.join("+");

        syncUI(combo);
        if (typeof onChangeCallback === "function") onChangeCallback(combo);
      };

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isRecording) {
          syncUI(input.value);
          return;
        }
        isRecording = true;
        btn.setAttribute("data-recording", "true");
        label.textContent = "Press keys...";
        window.addEventListener("keydown", onKeyDown, true);
      });

      this.modal.addEventListener("mousedown", (e) => {
        if (isRecording && !e.target.closest("#" + buttonId)) {
          syncUI(input.value);
        }
      });
    }

    createModal() {
      this.injectStyles();
      this.modal = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      );
      this.modal.id = "zentral-settings-modal";
      this.modal.setAttribute("data-open", "true");

      const content = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      );
      content.className = "zs-dialog";

      // Generate 60 matrix cells (6 rows x 10 cols)
      let matrixCellsHtml = "";
      for (let r = 1; r <= 6; r++) {
        for (let c = 1; c <= 10; c++) {
          matrixCellsHtml += `<div class="zs-matrix-cell" data-row="${r}" data-col="${c}" title="Row ${r}, Col ${c}"></div>`;
        }
      }

      const htmlStr = `
        <div class="zs-header">
          <div class="zs-title-group">
            <h2 class="zs-title">Zentral Settings</h2>
            <span class="zs-version-badge">v1.0.2</span>
          </div>
          <div class="zs-header-actions">
            <button id="zs-kofi-btn" class="zs-kofi-btn" title="Support Zentral on Ko-fi (ko-fi.com/michele501st)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 198" width="980" height="198">
<path d="M52.23 0.07C343.95 0.07 635.67 0.07 927.39 0.07C929.8 1.58 938.6 2.68 942.29 4.17C951.73 8 960.32 14.31 966.75 22.31C971.83 28.62 974.95 35.6 977.74 43.09C978.6 45.42 978.15 50.6 979.93 52.22C979.93 83.32 979.93 114.42 979.93 145.52C978.54 147.33 977.11 156.96 975.83 160.15C972.6 168.2 967.42 175.92 960.93 181.79C954.74 187.39 947.47 192.05 939.58 194.68C937.55 195.36 928.58 196.8 927.76 197.78C636.05 197.78 344.33 197.78 52.61 197.78C50.21 196.27 41.39 195.16 37.71 193.68C28.27 189.87 19.68 183.52 13.25 175.53C8.16 169.21 5.09 162.25 2.27 154.76C1.39 152.42 1.86 147.26 0.07 145.63C0.07 114.53 0.07 83.43 0.07 52.33C1.33 50.79 2.96 40.7 4.16 37.7C7.41 29.62 12.59 21.97 19.07 16.06C25.22 10.45 32.54 5.78 40.42 3.17C42.49 2.48 51.35 1.09 52.23 0.07ZM99.63 52.07C90.1 52.45 79.02 52.59 71.38 59.1C61.37 67.62 59.71 78.89 60.06 91.49C60.49 107.14 63.55 121.88 74.39 133.71C86.54 146.97 108.29 149.22 124.84 144.73C134.47 142.11 142.92 135.63 148.75 127.62C150.64 125.03 151.57 121.59 153.54 119.16C154.81 117.59 157.65 117.45 159.41 116.61C163.09 114.85 166.74 112.44 169.47 109.35C181.3 95.98 181.64 71.54 166.3 60.3C151.26 49.28 118.05 51.33 99.63 52.07ZM882.94 71.26C875.78 73.51 880.78 84.17 887.6 80.7C893.59 77.65 889 69.37 882.94 71.26ZM873.26 71.78C868.21 70.38 860.38 71.55 858.07 76.96C856.65 80.29 857.39 83.67 856.75 87.11C855.12 87.11 853.5 87.11 851.88 87.11C851.88 89.5 851.88 91.9 851.88 94.3C853.58 94.5 855.28 94.71 856.99 94.91C856.99 104.57 856.99 114.22 856.99 123.87C859.87 123.87 862.75 123.87 865.63 123.87C865.89 114.12 866.14 104.37 866.4 94.62C868.95 94.62 871.49 94.62 874.04 94.62C874.04 92.24 874.04 89.85 874.04 87.46C871.36 87.2 868.68 86.93 866 86.67C864.63 78.77 867.41 79.83 873.26 78.62C873.26 76.34 873.26 74.06 873.26 71.78ZM246.71 86.72C248.13 69.44 218.73 66.79 213.28 81.54C208.58 94.23 220.41 98.49 229.43 101.77C233.25 103.16 238.45 104.73 238.92 109.58C239.61 116.6 230.88 119.05 225.49 116.53C222.17 114.97 221.14 111.98 220.56 108.67C217.61 108.67 214.67 108.67 211.72 108.67C209.82 113.11 214.48 118.91 217.89 121.32C225.61 126.78 240.4 126.57 245.87 117.79C247.12 115.78 247.94 113.56 248.11 111.19C248.86 100.83 240.95 97.21 232.6 94.14C229.41 92.97 222.94 91.94 222.06 87.85C220.63 81.16 227.61 77.43 233.31 80.18C236.11 81.54 236.68 84.2 237.86 86.72C240.81 86.72 243.76 86.72 246.71 86.72ZM739.73 72.9C736.84 72.9 733.95 72.9 731.06 72.9C731.06 89.9 731.06 106.89 731.06 123.88C733.95 123.88 736.84 123.88 739.73 123.88C740.83 118.34 738.37 110.35 740.08 105.27C740.68 103.49 743.25 101.68 744.55 100.37C746.74 101.6 748.03 104.92 749.3 107.05C752.68 112.72 756.21 118.34 759.8 123.88C763.16 123.88 766.53 123.88 769.9 123.88C763.7 113.75 757.49 103.62 751.29 93.5C757.35 86.79 763.41 80.09 769.48 73.39C768.01 72.6 766.31 72.86 764.66 72.86C763.02 72.86 760.77 72.46 759.2 72.99C757.53 73.56 755.97 76.47 754.73 77.72C751.17 81.29 744.15 91.1 740.38 93.09C740.16 86.36 739.94 79.63 739.73 72.9ZM464.26 77.47C463.73 80.68 463.19 83.9 462.65 87.11C460.73 87.11 458.81 87.11 456.88 87.11C456.88 89.62 456.88 92.12 456.88 94.63C458.81 94.63 460.73 94.63 462.65 94.63C465.49 105.76 456.92 123.85 475.52 123.92C477.55 123.93 479.73 124.18 481.67 123.54C481.67 121.3 481.67 119.06 481.67 116.82C479.08 115.96 475.64 117.21 473.28 115.64C471.64 114.54 471.87 112.1 471.85 110.39C471.81 106.46 470.82 97.95 472.31 94.63C475.46 94.63 478.62 94.63 481.78 94.63C481.78 92.21 481.78 89.79 481.78 87.36C478.46 87.13 475.15 86.89 471.83 86.66C471.83 83.6 471.83 80.53 471.83 77.47C469.31 77.47 466.79 77.47 464.26 77.47ZM109.58 83.59C111.65 81.98 113.2 79.83 115.83 79.03C124.26 76.46 132.45 82.84 132.81 91.49C133.21 100.89 125.39 108.4 118.28 113.26C115.86 114.92 112.72 117.77 109.59 117.7C106.6 117.63 103.33 114.83 100.96 113.18C93.21 107.8 84.12 98.38 87.22 87.88C89.31 80.82 97.25 76.32 104.32 79.23C106.5 80.13 107.94 81.99 109.58 83.59ZM306.34 119.96C309.64 121.15 311.73 123.92 315.48 124.66C327.15 126.94 336.01 116.81 336.18 105.96C336.43 89.97 318.78 78.71 306.63 91.78C306.16 90.24 305.69 88.7 305.22 87.16C302.7 87.16 300.19 87.16 297.67 87.16C297.67 104.72 297.67 122.28 297.67 139.83C300.56 139.83 303.45 139.83 306.34 139.83C306.34 133.21 306.34 126.59 306.34 119.96ZM352.47 119.36C363.54 132.59 381.86 121.09 382.01 105.96C382.14 93.78 371.42 82.74 358.74 87.09C356.05 88.01 354.53 90.15 352.45 91.89C351.92 90.31 351.39 88.73 350.86 87.15C348.29 87.15 345.72 87.15 343.15 87.15C343.15 104.72 343.15 122.28 343.15 139.85C346.02 139.85 348.88 139.85 351.75 139.85C351.99 133.02 352.23 126.19 352.47 119.36ZM404.44 86.24C380.34 88.64 383.22 127.39 408.37 124.77C432.12 122.29 428.84 83.81 404.44 86.24ZM453.48 86.26C447.7 86.06 444.47 89.58 440.54 93C440.18 91.05 439.83 89.1 439.48 87.15C436.93 87.15 434.38 87.15 431.83 87.15C431.83 99.39 431.83 111.63 431.83 123.87C434.62 123.87 437.41 123.87 440.2 123.87C441.79 117.04 437.46 101.35 444.44 97.2C447.32 95.48 450.46 95.95 453.63 95.51C454.58 93.38 454.67 88.26 453.48 86.26ZM536.65 92.12C534.39 90.85 533.07 88.51 530.55 87.3C524.11 84.23 518.61 87.52 513.73 91.27C513.37 89.89 513.01 88.52 512.65 87.14C510.08 87.14 507.5 87.14 504.93 87.14C504.93 99.39 504.93 111.63 504.93 123.88C507.82 123.88 510.71 123.88 513.59 123.88C515.51 115.77 508.78 93.52 522.57 93.81C533.83 94.05 528.92 116.57 530.04 123.88C532.71 123.88 535.38 123.88 538.06 123.88C540.18 115.77 533.32 93.44 547.51 93.81C552.53 93.94 554.07 98 554.5 102.34C555.18 109.22 553.2 117.22 554.94 123.88C557.62 123.88 560.29 123.88 562.96 123.88C563.91 117.71 564.16 99.37 561.78 93.91C558.88 87.26 549.99 84.31 543.41 87.16C540.68 88.34 538.9 90.27 536.65 92.12ZM605.72 107.57C606.68 104.79 606.21 101.02 605.27 98.29C600.14 83.3 577.05 81.82 571.22 97.27C567.51 107.11 570.84 119.94 581.37 123.74C589.35 126.61 604.09 123.23 604.82 112.86C602.07 112.86 599.32 112.86 596.57 112.86C595.22 114.13 594.27 115.75 592.55 116.65C585.76 120.22 579.67 114.79 578.56 108.38C580.56 107.09 584.16 107.77 586.51 107.77C592.68 107.77 599.67 108.66 605.72 107.57ZM644.52 86.24C620.22 89.23 623.59 127.49 648.44 124.76C672.47 122.12 668.61 83.28 644.52 86.24ZM706.41 123.87C707.75 117.7 707.48 98.81 704.81 93.2C700.13 83.34 686.42 84.84 680.61 92.48C680.24 90.7 679.87 88.93 679.5 87.15C676.97 87.15 674.45 87.15 671.92 87.15C671.92 99.39 671.92 111.63 671.92 123.87C674.75 123.87 677.57 123.87 680.4 123.87C682.93 115.57 675.21 93.81 689.86 93.79C702.32 93.77 697.04 115.83 698.1 123.87C700.87 123.87 703.64 123.87 706.41 123.87ZM788.47 86.24C764.15 88.39 766.48 126.79 791.6 124.79C815.39 122.9 812.75 84.08 788.47 86.24ZM262.79 87.13C260.12 87.13 257.46 87.13 254.79 87.13C253.55 93.05 253.65 112.64 256.21 117.96C260.83 127.52 275.01 126.56 280.49 118.55C280.89 120.32 281.29 122.09 281.69 123.86C284.19 123.86 286.68 123.86 289.18 123.86C289.18 111.62 289.18 99.38 289.18 87.15C286.38 87.15 283.58 87.15 280.78 87.15C279.01 95.44 285.31 118.16 270.84 117.37C258.03 116.67 265.18 95.13 262.79 87.13ZM889.17 87.15C886.28 87.15 883.38 87.15 880.48 87.15C880.48 99.39 880.48 111.63 880.48 123.87C883.38 123.87 886.28 123.87 889.17 123.87C889.17 111.63 889.17 99.39 889.17 87.15ZM596.97 101.96C590.94 101.96 584.9 101.96 578.87 101.96C578.94 90.92 598.15 90.83 596.97 101.96ZM646.45 93.89C659.12 93.85 659.14 117.11 646.43 117.17C633.49 117.22 633.55 93.93 646.45 93.89ZM313.93 94.21C327.68 90.5 332.64 112.99 319.98 116.75C305.7 120.99 300.71 97.77 313.93 94.21ZM359.76 94.19C373.47 90.26 378.43 113.34 365.58 116.82C351.29 120.69 346.59 97.97 359.76 94.19ZM403.63 94.22C416.45 89.88 420.57 113.57 409.02 116.83C395.6 120.62 392.1 98.12 403.63 94.22ZM787.26 94.21C800.28 90.24 804.07 113.69 792.63 116.82C779.16 120.51 775.49 97.8 787.26 94.21ZM846.05 98.85C836.04 98.85 826.03 98.85 816.02 98.85C816.02 101.23 816.02 103.61 816.02 105.99C826.03 105.99 836.04 105.99 846.05 105.99C846.05 103.61 846.05 101.23 846.05 98.85Z" fill="#13C375" fill-rule="evenodd" stroke="#13C375" stroke-width="0.25" stroke-linejoin="round"/>
<path d="M148.19 112.25C142.26 130.73 127.03 139.07 108.38 139.06C99.29 139.06 90.65 137.16 83.27 131.65C71.25 122.68 68.31 107.54 67.67 93.5C67.34 86.16 66.91 78.46 70.33 71.74C75.33 61.93 85.53 60.28 95.51 59.87C110.1 59.27 124.75 59.21 139.34 59.86C146.62 60.18 154.42 60.94 160.52 65.29C172.95 74.14 173.9 93.8 163.63 104.71C159.19 109.44 153.79 109.98 148.19 112.25ZM141.36 104.35C146.26 102.43 149.54 104.69 155.21 100.72C164.04 94.55 165.15 78.44 155.66 72.16C149.19 67.87 140.36 68.11 132.91 67.95C120.54 67.69 107.85 67.25 95.51 68.11C88.55 68.6 80.39 69.42 77.2 76.61C75.02 81.52 75.86 87.85 75.99 93.09C76.25 103.35 78.05 116.26 86.24 123.48C97.72 133.58 119.98 134.05 131.45 123.61C137.15 118.41 139.57 111.6 141.36 104.35ZM882.94 71.26C889 69.37 893.59 77.65 887.6 80.7C880.78 84.17 875.78 73.51 882.94 71.26ZM873.26 71.78C873.26 74.06 873.26 76.34 873.26 78.62C867.41 79.83 864.63 78.77 866 86.67C868.68 86.93 871.36 87.2 874.04 87.46C874.04 89.85 874.04 92.24 874.04 94.62C871.49 94.62 868.95 94.62 866.4 94.62C866.14 104.37 865.89 114.12 865.63 123.87C862.75 123.87 859.87 123.87 856.99 123.87C856.99 114.22 856.99 104.57 856.99 94.91C855.28 94.71 853.58 94.5 851.88 94.3C851.88 91.9 851.88 89.5 851.88 87.11C853.5 87.11 855.12 87.11 856.75 87.11C857.39 83.67 856.65 80.29 858.07 76.96C860.38 71.55 868.21 70.38 873.26 71.78ZM246.71 86.72C243.76 86.72 240.81 86.72 237.86 86.72C236.68 84.2 236.11 81.54 233.31 80.18C227.61 77.43 220.63 81.16 222.06 87.85C222.94 91.94 229.41 92.97 232.6 94.14C240.95 97.21 248.86 100.83 248.11 111.19C247.94 113.56 247.12 115.78 245.87 117.79C240.4 126.57 225.61 126.78 217.89 121.32C214.48 118.91 209.82 113.11 211.72 108.67C214.67 108.67 217.61 108.67 220.56 108.67C221.14 111.98 222.17 114.97 225.49 116.53C230.88 119.05 239.61 116.6 238.92 109.58C238.45 104.73 233.25 103.16 229.43 101.77C220.41 98.49 208.58 94.23 213.28 81.54C218.73 66.79 248.13 69.44 246.71 86.72ZM739.73 72.9C739.94 79.63 740.16 86.36 740.38 93.09C744.15 91.1 751.17 81.29 754.73 77.72C755.97 76.47 757.53 73.56 759.2 72.99C760.77 72.46 763.02 72.86 764.66 72.86C766.31 72.86 768.01 72.6 769.48 73.39C763.41 80.09 757.35 86.79 751.29 93.5C757.49 103.62 763.7 113.75 769.9 123.88C766.53 123.88 763.16 123.88 759.8 123.88C756.21 118.34 752.68 112.72 749.3 107.05C748.03 104.92 746.74 101.6 744.55 100.37C743.25 101.68 740.68 103.49 740.08 105.27C738.37 110.35 740.83 118.34 739.73 123.88C736.84 123.88 733.95 123.88 731.06 123.88C731.06 106.89 731.06 89.9 731.06 72.9C733.95 72.9 736.84 72.9 739.73 72.9ZM142.2 78.22C151.66 74.79 157.77 89.14 149.42 93.75C141.5 98.13 141.49 91.94 141.49 86.26C141.49 83.61 141.07 80.67 142.2 78.22ZM464.26 77.47C466.79 77.47 469.31 77.47 471.83 77.47C471.83 80.53 471.83 83.6 471.83 86.66C475.15 86.89 478.46 87.13 481.78 87.36C481.78 89.79 481.78 92.21 481.78 94.63C478.62 94.63 475.46 94.63 472.31 94.63C470.82 97.95 471.81 106.46 471.85 110.39C471.87 112.1 471.64 114.54 473.28 115.64C475.64 117.21 479.08 115.96 481.67 116.82C481.67 119.06 481.67 121.3 481.67 123.54C479.73 124.18 477.55 123.93 475.52 123.92C456.92 123.85 465.49 105.76 462.65 94.63C460.73 94.63 458.81 94.63 456.88 94.63C456.88 92.12 456.88 89.62 456.88 87.11C458.81 87.11 460.73 87.11 462.65 87.11C463.19 83.9 463.73 80.68 464.26 77.47ZM306.34 119.96C306.34 126.59 306.34 133.21 306.34 139.83C303.45 139.83 300.56 139.83 297.67 139.83C297.67 122.28 297.67 104.72 297.67 87.16C300.19 87.16 302.7 87.16 305.22 87.16C305.69 88.7 306.16 90.24 306.63 91.78C318.78 78.71 336.43 89.97 336.18 105.96C336.01 116.81 327.15 126.94 315.48 124.66C311.73 123.92 309.64 121.15 306.34 119.96ZM352.47 119.36C352.23 126.19 351.99 133.02 351.75 139.85C348.88 139.85 346.02 139.85 343.15 139.85C343.15 122.28 343.15 104.72 343.15 87.15C345.72 87.15 348.29 87.15 350.86 87.15C351.39 88.73 351.92 90.31 352.45 91.89C354.53 90.15 356.05 88.01 358.74 87.09C371.42 82.74 382.14 93.78 382.01 105.96C381.86 121.09 363.54 132.59 352.47 119.36ZM404.44 86.24C428.84 83.81 432.12 122.29 408.37 124.77C383.22 127.39 380.34 88.64 404.44 86.24ZM453.48 86.26C454.67 88.26 454.58 93.38 453.63 95.51C450.46 95.95 447.32 95.48 444.44 97.2C437.46 101.35 441.79 117.04 440.2 123.87C437.41 123.87 434.62 123.87 431.83 123.87C431.83 111.63 431.83 99.39 431.83 87.15C434.38 87.15 436.93 87.15 439.48 87.15C439.83 89.1 440.18 91.05 440.54 93C444.47 89.58 447.7 86.06 453.48 86.26ZM536.65 92.12C538.9 90.27 540.68 88.34 543.41 87.16C549.99 84.31 558.88 87.26 561.78 93.91C564.16 99.37 563.91 117.71 562.96 123.88C560.29 123.88 557.62 123.88 554.94 123.88C553.2 117.22 555.18 109.22 554.5 102.34C554.07 98 552.53 93.94 547.51 93.81C533.32 93.44 540.18 115.77 538.06 123.88C535.38 123.88 532.71 123.88 530.04 123.88C528.92 116.57 533.83 94.05 522.57 93.81C508.78 93.52 515.51 115.77 513.59 123.88C510.71 123.88 507.82 123.88 504.93 123.88C504.93 111.63 504.93 99.39 504.93 87.14C507.5 87.14 510.08 87.14 512.65 87.14C513.01 88.52 513.37 89.89 513.73 91.27C518.61 87.52 524.11 84.23 530.55 87.3C533.07 88.51 534.39 90.85 536.65 92.12ZM605.72 107.57C599.67 108.66 592.68 107.77 586.51 107.77C584.16 107.77 580.56 107.09 578.56 108.38C579.67 114.79 585.76 120.22 592.55 116.65C594.27 115.75 595.22 114.13 596.57 112.86C599.32 112.86 602.07 112.86 604.82 112.86C604.09 123.23 589.35 126.61 581.37 123.74C570.84 119.94 567.51 107.11 571.22 97.27C577.05 81.82 600.14 83.3 605.27 98.29C606.21 101.02 606.68 104.79 605.72 107.57ZM644.52 86.24C668.61 83.28 672.47 122.12 648.44 124.76C623.59 127.49 620.22 89.23 644.52 86.24ZM706.41 123.87C703.64 123.87 700.87 123.87 698.1 123.87C697.04 115.83 702.32 93.77 689.86 93.79C675.21 93.81 682.93 115.57 680.4 123.87C677.57 123.87 674.75 123.87 671.92 123.87C671.92 111.63 671.92 99.39 671.92 87.15C674.45 87.15 676.97 87.15 679.5 87.15C679.87 88.93 680.24 90.7 680.61 92.48C686.42 84.84 700.13 83.34 704.81 93.2C707.48 98.81 707.75 117.7 706.41 123.87ZM788.47 86.24C812.75 84.08 815.39 122.9 791.6 124.79C766.48 126.79 764.15 88.39 788.47 86.24ZM262.79 87.13C265.18 95.13 258.03 116.67 270.84 117.37C285.31 118.16 279.01 95.44 280.78 87.15C283.58 87.15 286.38 87.15 289.18 87.15C289.18 99.38 289.18 111.62 289.18 123.86C286.68 123.86 284.19 123.86 281.69 123.86C281.29 122.09 280.89 120.32 280.49 118.55C275.01 126.56 260.83 127.52 256.21 117.96C253.65 112.64 253.55 93.05 254.79 87.13C257.46 87.13 260.12 87.13 262.79 87.13ZM889.17 87.15C889.17 99.39 889.17 111.63 889.17 123.87C886.28 123.87 883.38 123.87 880.48 123.87C880.48 111.63 880.48 99.39 880.48 87.15C883.38 87.15 886.28 87.15 889.17 87.15ZM596.97 101.96C598.15 90.83 578.94 90.92 578.87 101.96C584.9 101.96 590.94 101.96 596.97 101.96ZM646.45 93.89C633.55 93.93 633.49 117.22 646.43 117.17C659.14 117.11 659.12 93.85 646.45 93.89ZM313.93 94.21C300.71 97.77 305.7 120.99 319.98 116.75C332.64 112.99 327.68 90.5 313.93 94.21ZM359.76 94.19C346.59 97.97 351.29 120.69 365.58 116.82C378.43 113.34 373.47 90.26 359.76 94.19ZM403.63 94.22C392.1 98.12 395.6 120.62 409.02 116.83C420.57 113.57 416.45 89.88 403.63 94.22ZM787.26 94.21C775.49 97.8 779.16 120.51 792.63 116.82C804.07 113.69 800.28 90.24 787.26 94.21ZM846.05 98.85C846.05 101.23 846.05 103.61 846.05 105.99C836.04 105.99 826.03 105.99 816.02 105.99C816.02 103.61 816.02 101.23 816.02 98.85C826.03 98.85 836.04 98.85 846.05 98.85Z" fill="#252220" fill-rule="evenodd" stroke="#252220" stroke-width="0.25" stroke-linejoin="round"/>
<path d="M99.63 52.07C118.05 51.33 151.26 49.28 166.3 60.3C181.64 71.54 181.3 95.98 169.47 109.35C166.74 112.44 163.09 114.85 159.41 116.61C157.65 117.45 154.81 117.59 153.54 119.16C151.57 121.59 150.64 125.03 148.75 127.62C142.92 135.63 134.47 142.11 124.84 144.73C108.29 149.22 86.54 146.97 74.39 133.71C63.55 121.88 60.49 107.14 60.06 91.49C59.71 78.89 61.37 67.62 71.38 59.1C79.02 52.59 90.1 52.45 99.63 52.07ZM148.19 112.25C153.79 109.98 159.19 109.44 163.63 104.71C173.9 93.8 172.95 74.14 160.52 65.29C154.42 60.94 146.62 60.18 139.34 59.86C124.75 59.21 110.1 59.27 95.51 59.87C85.53 60.28 75.33 61.93 70.33 71.74C66.91 78.46 67.34 86.16 67.67 93.5C68.31 107.54 71.25 122.68 83.27 131.65C90.65 137.16 99.29 139.06 108.38 139.06C127.03 139.07 142.26 130.73 148.19 112.25ZM141.36 104.35C139.57 111.6 137.15 118.41 131.45 123.61C119.98 134.05 97.72 133.58 86.24 123.48C78.05 116.26 76.25 103.35 75.99 93.09C75.86 87.85 75.02 81.52 77.2 76.61C80.39 69.42 88.55 68.6 95.51 68.11C107.85 67.25 120.54 67.69 132.91 67.95C140.36 68.11 149.19 67.87 155.66 72.16C165.15 78.44 164.04 94.55 155.21 100.72C149.54 104.69 146.26 102.43 141.36 104.35ZM142.2 78.22C141.07 80.67 141.49 83.61 141.49 86.26C141.49 91.94 141.5 98.13 149.42 93.75C157.77 89.14 151.66 74.79 142.2 78.22ZM109.58 83.59C107.94 81.99 106.5 80.13 104.32 79.23C97.25 76.32 89.31 80.82 87.22 87.88C84.12 98.38 93.21 107.8 100.96 113.18C103.33 114.83 106.6 117.63 109.59 117.7C112.72 117.77 115.86 114.92 118.28 113.26C125.39 108.4 133.21 100.89 132.81 91.49C132.45 82.84 124.26 76.46 115.83 79.03C113.2 79.83 111.65 81.98 109.58 83.59Z" fill="#fefefe" fill-rule="evenodd" stroke="#fefefe" stroke-width="0.25" stroke-linejoin="round"/>
</svg>
          </button>
            <button id="zs-close" class="zs-close-btn" title="Close Settings">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l12 12M13 1L1 13"/></svg>
            </button>
          </div>
        </div>

        <div class="zs-tab-bar">
          <button type="button" class="zs-tab-btn" data-tab="settings" data-active="true">Settings</button>
          <button type="button" class="zs-tab-btn" data-tab="diagnostics" data-active="false">Diagnostics</button>
        </div>

        <div class="zs-body">
          <!-- Tab Panel 1: Settings (2-Column Open Layout with Vertical Separator) -->
          <div class="zs-tab-panel" id="zs-panel-settings" data-tab="settings" data-active="true">
            <div class="zs-columns">
              <!-- Column 1: Apps -->
              <div class="zs-col" id="zs-ag-col" data-placement="sidebar">
                <div class="zs-section-header">
                  <h3 class="zs-section-title">Apps</h3>
                  <div class="zs-header-toggle">
                    <span id="zs-ag-status" class="zs-toggle-status" data-enabled="true">Enabled</span>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-ag-enabled" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>
                </div>

                <div class="zs-section-content" id="zs-ag-content">
                  <!-- Apps Placement -->
                  <div class="zs-placement-group">
                    <div class="zs-label-container">
                      <span class="zs-label">Apps Placement</span>
                      <span class="zs-sublabel">Choose where the Apps will be located across the interface</span>
                    </div>
                    <input type="hidden" id="zs-ag-placement" value="sidebar" />
                    <div class="zs-placement-cards">
                      <button type="button" class="zs-placement-btn" id="zs-placement-sidebar" data-placement="sidebar" data-active="true" title="Dock Apps Box inside Zen Sidebar">
                        <div class="zs-placement-svg-box">
                          <div class="zs-placement-sidebar-container">
                            <div class="zs-placement-appbox-indicator"></div>
                            <div class="zs-placement-sidebar-body"></div>
                          </div>
                          <div class="zs-placement-content-preview"></div>
                        </div>
                        <span class="zs-placement-label">Sidebar</span>
                      </button>

                      <button type="button" class="zs-placement-btn" id="zs-placement-strip" data-placement="vertical-bar" data-active="false" title="Dock Apps Bar as dedicated strip on opposite edge">
                        <div class="zs-placement-svg-box">
                          <div class="zs-placement-content-preview"></div>
                          <div class="zs-placement-bar-indicator" style="width: 10px; height: 100%;"></div>
                        </div>
                        <span class="zs-placement-label">Apps Bar</span>
                      </button>
                    </div>
                  </div>

                  <!-- 10x6 Selection Matrix (Apps Box) -->
                  <div class="zs-matrix-wrapper" id="zs-matrix-wrapper">
                    <div class="zs-matrix-header">
                      <div class="zs-label-container">
                        <span class="zs-matrix-title">Apps Box</span>
                        <span class="zs-sublabel">Choose how many rows of Apps to show and how many Apps per rows</span>
                      </div>
                      <div class="zs-matrix-readout">
                        <span id="zs-matrix-dims">7 Columns × 3 Rows</span>
                        <span id="zs-matrix-total-badge" class="zs-matrix-badge">21 Visible Apps</span>
                      </div>
                    </div>
                    <input type="hidden" id="zs-apps-row" value="7" />
                    <input type="hidden" id="zs-max-rows" value="3" />
                    <div class="zs-matrix-grid" id="zs-matrix-grid">
                      ${matrixCellsHtml}
                    </div>
                  </div>

                  <!-- Hide Utility Section Toggle -->
                  <div class="zs-row" id="zs-utility-section-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Hide Utility Section</span>
                      <span class="zs-sublabel">Permanently hide the utility bar from the App Box</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-hide-utility-section" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <!-- Apps Number Cap -->
                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Apps Number Cap</span>
                      <span class="zs-sublabel">Maximum number of apps you can pin</span>
                    </div>
                    <div class="zs-h-stepper">
                      <button type="button" class="zs-h-btn zs-h-dec" data-target="zs-max-apps" data-step="-1">−</button>
                      <input type="number" id="zs-max-apps" class="zs-h-val" min="1" max="100" step="1" />
                      <button type="button" class="zs-h-btn zs-h-inc" data-target="zs-max-apps" data-step="1">+</button>
                    </div>
                  </div>

                  <!-- Insta-Peek Shortcut -->
                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Insta-Peek</span>
                      <span class="zs-sublabel">Hold shortcut to temporarily hide open panel and peek underneath</span>
                    </div>
                    <div class="zs-shortcut-recorder" id="zs-insta-peek-recorder">
                      <button type="button" class="zs-shortcut-btn" id="zs-insta-peek-btn" title="Click to record shortcut, Backspace to clear, Escape to cancel">
                        <span class="zs-shortcut-label" id="zs-insta-peek-label">Alt+Q</span>
                      </button>
                      <input type="hidden" id="zs-insta-peek-shortcut" value="Alt+Q" />
                    </div>
                  </div>

                  <!-- Panel Animation (Glitch-Free Custom Dropdown) -->
                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Panel Animation</span>
                      <span class="zs-sublabel">Opening/closing apps panel easing</span>
                    </div>
                    <div class="zs-custom-select" id="zs-anim-type-dropdown" data-value="slide">
                      <button type="button" class="zs-custom-select-trigger" id="zs-anim-type-trigger">
                        <span class="zs-custom-select-label">Smooth Slide</span>
                        <svg class="zs-custom-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                      </button>
                      <div class="zs-custom-select-menu" id="zs-anim-type-menu">
                        <div class="zs-custom-select-option" data-value="slide">Smooth Slide</div>
                        <div class="zs-custom-select-option" data-value="spring-snappy">Snappy Spring</div>
                        <div class="zs-custom-select-option" data-value="spring-gentle">Gentle Spring</div>
                        <div class="zs-custom-select-option" data-value="spring-bouncy">Bouncy Spring</div>
                        <div class="zs-custom-select-option" data-value="elastic">Elastic</div>
                        <div class="zs-custom-select-option" data-value="none">Instant</div>
                      </div>
                      <input type="hidden" id="zs-anim-type" value="slide" />
                    </div>
                  </div>

                  <!-- Animation Speed -->
                  <div class="zs-stacked-slider">
                    <div class="zs-stacked-slider-header">
                      <div class="zs-label-container">
                        <span class="zs-label">Animation Speed</span>
                        <span class="zs-sublabel">Adjust panel animation duration</span>
                      </div>
                      <span id="zs-anim-speed-badge" class="zs-mono-badge">450 ms</span>
                    </div>
                    <input type="range" id="zs-anim-speed-slider" class="zs-range-slider" min="0" max="2000" step="25" />
                    <input type="hidden" id="zs-anim-speed" value="450" />
                  </div>

                  <!-- Animation Preview Demo -->
                  <div class="zs-anim-preview-group">
                    <div class="zs-label-container">
                      <span class="zs-label">Animation Preview</span>
                      <span class="zs-sublabel">Hover or click below to test opening/closing speed and easing curve</span>
                    </div>
                    <div class="zs-anim-preview-box" id="zs-anim-preview-box">
                      <div class="zs-anim-preview-sidebar">
                        <div class="zs-anim-preview-dot"></div>
                        <div class="zs-anim-preview-dot"></div>
                        <div class="zs-anim-preview-dot"></div>
                      </div>
                      <div class="zs-anim-preview-panel" id="zs-anim-preview-panel">
                        <div class="zs-anim-preview-pill"></div>
                        <div class="zs-anim-preview-line" style="width: 85%;"></div>
                        <div class="zs-anim-preview-line" style="width: 65%;"></div>
                        <div class="zs-anim-preview-line" style="width: 75%;"></div>
                      </div>
                      <span class="zs-anim-preview-hint">Hover or click to preview</span>
                    </div>
                  </div>

                  <button id="zs-ag-reset" class="zs-reset-btn">Reset Apps Defaults</button>
                </div>
              </div>

              <!-- Column 2: Tab Groups -->
              <div class="zs-col" id="zs-tg-col">
                <div class="zs-section-header">
                  <h3 class="zs-section-title">Tab Groups</h3>
                  <div class="zs-header-toggle">
                    <span id="zs-tg-status" class="zs-toggle-status" data-enabled="true">Enabled</span>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-tg-enabled" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>
                </div>

                <div class="zs-section-content" id="zs-tg-content">
                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Close Groups at Startup</span>
                      <span class="zs-sublabel">Automatically fold groups when launching</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-tg-collapse" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Group Thumbnails</span>
                      <span class="zs-sublabel">Interactive thumbnails on hover</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-tg-thumbnails" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Group Indicator</span>
                      <span class="zs-sublabel">Show open/close indicator next to name</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-tg-chevron" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <div class="zs-row" id="zs-tg-indicator-type-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Indicator Type</span>
                      <span class="zs-sublabel">Choose the style of the indicator</span>
                    </div>
                    <div class="zs-custom-select" id="zs-tg-indicator-type-dropdown" data-value="circle">
                      <button type="button" class="zs-custom-select-trigger" id="zs-tg-indicator-type-trigger">
                        <span class="zs-custom-select-label">Circle</span>
                        <svg class="zs-custom-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                      </button>
                      <div class="zs-custom-select-menu" id="zs-tg-indicator-type-menu">
                        <div class="zs-custom-select-option" data-value="circle">Circle</div>
                        <div class="zs-custom-select-option" data-value="chevron">Chevron</div>
                      </div>
                      <input type="hidden" id="zs-tg-indicator-type" value="circle" />
                    </div>
                  </div>

                  <div class="zs-stacked-slider">
                    <div class="zs-stacked-slider-header">
                      <div class="zs-label-container">
                        <span class="zs-label">Group Labels Opacity</span>
                        <span class="zs-sublabel">Adjust label pill transparency</span>
                      </div>
                      <span id="zs-tg-opacity-badge" class="zs-mono-badge">85%</span>
                    </div>
                    <input type="range" id="zs-tg-opacity" class="zs-range-slider" min="10" max="100" step="5" />
                  </div>

                  <button id="zs-tg-reset" class="zs-reset-btn">Reset Tab Groups Defaults</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Tab Panel 2: Diagnostics -->
          <div class="zs-tab-panel" id="zs-panel-diagnostics" data-tab="diagnostics" data-active="false">
            <div class="zs-section-header">
              <h3 class="zs-section-title">Diagnostic Logging</h3>
            </div>
            <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 14px;">
              <div class="zs-row">
                <div class="zs-label-container">
                  <span class="zs-label">Enable Diagnostic Logging</span>
                  <span class="zs-sublabel">Starts Zentral Logger in the background to capture internal layout events</span>
                </div>
                <label class="zs-switch">
                  <input type="checkbox" id="zs-pref-logger-enabled" />
                  <span class="zs-slider"></span>
                </label>
              </div>

              <!-- Options Sub-Section (Controlled by master toggle) -->
              <div id="zs-logger-options-section" style="display: flex; flex-direction: column; gap: 16px; transition: opacity 0.2s ease;">
                
                <!-- Full Log Toggle -->
                <div class="zs-row">
                  <div class="zs-label-container">
                    <span class="zs-label">Capture Full Diagnostic Log</span>
                    <span class="zs-sublabel">Records all diagnostic modules and events simultaneously</span>
                  </div>
                  <label class="zs-switch">
                    <input type="checkbox" id="zs-pref-logger-full" />
                    <span class="zs-slider"></span>
                  </label>
                </div>

                <!-- Modular Selections Container (Revealed when Full Log is unchecked) -->
                <div id="zs-logger-modules-container" class="zs-modules-subgroup" data-hidden="true">
                  <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(255,255,255,0.45); margin-bottom: 2px;">
                    Active Log Modules
                  </div>

                  <!-- 1. Core & Gecko Errors (Always On, Disabled) -->
                  <div class="zs-row" style="padding: 2px 0;">
                    <div class="zs-label-container">
                      <span class="zs-label" style="font-size: 13px;">Core Engine & Gecko Errors</span>
                      <span class="zs-sublabel" style="font-size: 11.5px;">Uncaught script exceptions and Gecko console errors (Always Active)</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-pref-logger-core" checked disabled />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <!-- 2. Tab Groups & Drag-and-Drop -->
                  <div class="zs-row" style="padding: 2px 0;">
                    <div class="zs-label-container">
                      <span class="zs-label" style="font-size: 13px;">Tab Groups & Drag-and-Drop</span>
                      <span class="zs-sublabel" style="font-size: 11.5px;">Tab groups lifecycle, split view actions, and drag interactions</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-pref-logger-tabs" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <!-- 3. Apps Sidebar & Panels -->
                  <div class="zs-row" style="padding: 2px 0;">
                    <div class="zs-label-container">
                      <span class="zs-label" style="font-size: 13px;">Apps Sidebar & Panels</span>
                      <span class="zs-sublabel" style="font-size: 11.5px;">Apps grid DOM modifications and panel open/pin events</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-pref-logger-apps" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <!-- 4. Context Menus & Popups -->
                  <div class="zs-row" style="padding: 2px 0;">
                    <div class="zs-label-container">
                      <span class="zs-label" style="font-size: 13px;">Context Menus & Popups</span>
                      <span class="zs-sublabel" style="font-size: 11.5px;">Right-click coordinates, popup showing/shown events, and menu item commands</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-pref-logger-menus" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <!-- 5. Layout Inspector Snapshot -->
                  <div class="zs-row" style="padding: 2px 0;">
                    <div class="zs-label-container">
                      <span class="zs-label" style="font-size: 13px;">Layout Inspector & CSS Snapshot</span>
                      <span class="zs-sublabel" style="font-size: 11.5px;">Computed styles, CSS variables, and element bounding boxes dump</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-pref-logger-layout" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>
                </div>

                <div class="zs-row">
                  <div class="zs-label-container">
                    <span class="zs-label">Export Log Path</span>
                    <span class="zs-sublabel" id="zs-pref-logger-path-desc">Directory where diagnostic logs are saved</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px; max-width: 55%;">
                    <input type="hidden" id="zs-pref-logger-path" />
                    <button type="button" id="zs-btn-choose-path" class="zs-reset-btn" style="margin: 0; padding: 6px 12px; font-size: 12px; background: #18181b; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: inherit; max-width: 240px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; cursor: pointer; display: flex; align-items: center; gap: 6px;" title="Click to choose export directory">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
                      <span id="zs-btn-choose-path-label">Default Folder</span>
                    </button>
                    <button type="button" id="zs-btn-clear-path" title="Reset to default folder (chrome/logs)" style="background: #18181b; border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.7); cursor: pointer; padding: 6px 10px; display: none; align-items: center; justify-content: center; font-size: 11px; border-radius: 6px;">✕</button>
                  </div>
                </div>

                <div class="zs-row">
                  <div class="zs-label-container">
                    <span class="zs-label">Capture Log</span>
                    <span class="zs-sublabel">Generate and save a diagnostic log file instantly. (Shortcut: <kbd style="background: #27272a; border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; padding: 1px 5px; font-size: 11px;">Alt</kbd>+<kbd style="background: #27272a; border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; padding: 1px 5px; font-size: 11px;">L</kbd>)</span>
                  </div>
                  <button id="zs-btn-capture-log" class="zs-btn-save" style="margin: 0; padding: 6px 18px; font-size: 12.5px;">Export</button>
                </div>
              </div>

              <!-- Report an Issue Section -->
              <div class="zs-section-header" style="margin-top: 20px;">
                <h3 class="zs-section-title">Report an Issue</h3>
              </div>
              <div id="zs-issue-report-card" class="zs-card" style="display: flex; flex-direction: column; gap: 14px; margin-top: 4px; padding: 16px; background: rgba(255, 255, 255, 0.025); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px;">
                
                <!-- Title & Category Row -->
                <div style="display: flex; gap: 12px; align-items: flex-start;">
                  <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
                    <label class="zs-label" for="zs-report-title" style="font-size: 12.5px;">Issue Title</label>
                    <input type="text" id="zs-report-title" class="zs-text-input" placeholder="Brief summary of the issue..." style="width: 100%;" />
                  </div>
                  <div style="width: 260px; min-width: 240px; display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;">
                    <label class="zs-label" style="font-size: 12.5px;">Category</label>
                    <div class="zs-custom-select" id="zs-report-category-dropdown" data-name="report-category" style="width: 100%;">
                      <button type="button" class="zs-custom-select-trigger" aria-haspopup="listbox" aria-expanded="false" style="width: 100%;">
                        <span class="zs-custom-select-label">
                          <svg class="zs-cat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>
                          <span>Bug / Malfunction</span>
                        </span>
                        <svg class="zs-custom-select-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; min-width: 14px; min-height: 14px; flex-shrink: 0;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                      </button>
                      <div class="zs-custom-select-menu" role="listbox">
                        <div class="zs-custom-select-option" role="option" data-value="bug" data-selected="true">
                          <svg class="zs-cat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>
                          <span>Bug / Malfunction</span>
                        </div>
                        <div class="zs-custom-select-option" role="option" data-value="layout">
                          <svg class="zs-cat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                          <span>Layout / Visual Alignment</span>
                        </div>
                        <div class="zs-custom-select-option" role="option" data-value="performance">
                          <svg class="zs-cat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                          <span>Performance / Lag</span>
                        </div>
                        <div class="zs-custom-select-option" role="option" data-value="enhancement">
                          <svg class="zs-cat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
                          <span>Feature Request / Feedback</span>
                        </div>
                      </div>
                    </div>
                    <input type="hidden" id="zs-report-category" value="bug" />
                  </div>
                </div>

                <!-- Description Field -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  <label class="zs-label" for="zs-report-description" style="font-size: 12.5px;">Description & Steps to Reproduce</label>
                  <textarea id="zs-report-description" class="zs-textarea-input" rows="4" placeholder="Describe what happened, expected behavior, and steps to reproduce..." style="width: 100%; resize: vertical; min-height: 80px;"></textarea>
                </div>

                <!-- Attach Log Toggle Row & Submit Action -->
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 4px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.06);">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-report-attach-log" checked />
                      <span class="zs-slider"></span>
                    </label>
                    <div style="display: flex; flex-direction: column;">
                      <span class="zs-label" style="font-size: 12.5px;">Attach Diagnostic Log</span>
                      <span class="zs-sublabel" style="font-size: 11px;">Includes active modules & layout snapshot</span>
                    </div>
                  </div>

                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span id="zs-report-status" style="font-size: 12px; font-weight: 500; display: none;"></span>
                    <button type="button" id="zs-btn-submit-report" class="zs-btn-save" style="margin: 0; padding: 7px 20px; font-size: 12.5px; display: flex; align-items: center; gap: 6px;">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                      <span>Submit Report</span>
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>

        <div class="zs-footer">
          <button id="zs-cancel" class="zs-btn-cancel">Cancel</button>
          <button id="zs-save" class="zs-btn-save">Save Changes</button>
        </div>
      `;

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlStr, "text/html");
      while (doc.body.firstChild) {
        content.appendChild(doc.body.firstChild);
      }

      this.modal.appendChild(content);
      const container =
        document.getElementById("browser") ||
        document.body ||
        document.documentElement;
      container.appendChild(this.modal);

      // Tab Switching Logic
      const tabBtns = this.modal.querySelectorAll(".zs-tab-btn");
      const tabPanels = this.modal.querySelectorAll(".zs-tab-panel");
      tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const targetTab = btn.dataset.tab;
          tabBtns.forEach((b) =>
            b.setAttribute("data-active", b === btn ? "true" : "false"),
          );
          tabPanels.forEach((p) =>
            p.setAttribute(
              "data-active",
              p.dataset.tab === targetTab ? "true" : "false",
            ),
          );
        });
      });

      this.modal
        .querySelector("#zs-kofi-btn")
        ?.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.close();
          const kofiUrl = "https://ko-fi.com/michele501st";
          if (window.gBrowser?.addTab) {
            const newTab = window.gBrowser.addTab(kofiUrl, {
              triggeringPrincipal:
                Services.scriptSecurityManager.getSystemPrincipal(),
              inBackground: false,
            });
            if (newTab) {
              window.gBrowser.selectedTab = newTab;
            }
          } else {
            window.open(kofiUrl, "_blank");
          }
        });

      this.modal
        .querySelector("#zs-close")
        .addEventListener("click", () => this.close());
      this.modal
        .querySelector("#zs-cancel")
        .addEventListener("click", () => this.close());
      this.modal
        .querySelector("#zs-save")
        .addEventListener("click", () => this.save());

      // Close open custom selects when clicking anywhere else
      this.modal.addEventListener("click", (e) => {
        if (!e.target.closest(".zs-custom-select")) {
          this.modal
            .querySelectorAll(".zs-custom-select")
            .forEach((d) => d.removeAttribute("data-open"));
        }
      });

      // Header Enable/Disable toggle sync (only disables section content, never lock out the toggle itself)
      const agToggle = this.modal.querySelector("#zs-ag-enabled");
      const agStatus = this.modal.querySelector("#zs-ag-status");
      const agContent = this.modal.querySelector("#zs-ag-content");
      if (agToggle) {
        agToggle.addEventListener("change", () => {
          const isEnabled = agToggle.checked;
          if (agStatus) {
            agStatus.textContent = isEnabled ? "Enabled" : "Disabled";
            agStatus.setAttribute("data-enabled", isEnabled ? "true" : "false");
          }
          if (agContent)
            agContent.setAttribute(
              "data-disabled",
              !isEnabled ? "true" : "false",
            );
        });
      }

      const tgToggle = this.modal.querySelector("#zs-tg-enabled");
      const tgStatus = this.modal.querySelector("#zs-tg-status");
      const tgContent = this.modal.querySelector("#zs-tg-content");
      if (tgToggle) {
        tgToggle.addEventListener("change", () => {
          const isEnabled = tgToggle.checked;
          if (tgStatus) {
            tgStatus.textContent = isEnabled ? "Enabled" : "Disabled";
            tgStatus.setAttribute("data-enabled", isEnabled ? "true" : "false");
          }
          if (tgContent)
            tgContent.setAttribute(
              "data-disabled",
              !isEnabled ? "true" : "false",
            );
        });
      }

      // Placement Visual Cards selection + Conditional matrix smooth slide visibility + Scrollable Apps Column
      const placementBtns = this.modal.querySelectorAll(".zs-placement-btn");
      const placementInput = this.modal.querySelector("#zs-ag-placement");
      const matrixWrapper = this.modal.querySelector("#zs-matrix-wrapper");
      const agCol = this.modal.querySelector("#zs-ag-col");

      placementBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const placement = btn.dataset.placement;
          if (placementInput) placementInput.value = placement;
          placementBtns.forEach((b) =>
            b.setAttribute("data-active", b === btn ? "true" : "false"),
          );
          if (agCol) agCol.setAttribute("data-placement", placement);
          if (matrixWrapper) {
            if (placement === "sidebar") {
              matrixWrapper.removeAttribute("data-hidden");
            } else {
              matrixWrapper.setAttribute("data-hidden", "true");
              if (agCol) agCol.scrollTop = 0;
            }
          }
          const utilityRow = this.modal.querySelector(
            "#zs-utility-section-row",
          );
          if (utilityRow) {
            if (placement === "sidebar") {
              utilityRow.removeAttribute("data-hidden");
            } else {
              utilityRow.setAttribute("data-hidden", "true");
            }
          }
        });
      });

      // Horizontal Stepper (+ / -)
      this.modal.querySelectorAll(".zs-h-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          const targetId = btn.dataset.target;
          const step = parseInt(btn.dataset.step, 10) || 1;
          const input = this.modal.querySelector("#" + targetId);
          if (input) {
            const min = input.min !== "" ? parseInt(input.min, 10) : 1;
            const max = input.max !== "" ? parseInt(input.max, 10) : 100;
            let current = parseInt(input.value, 10);
            if (isNaN(current)) current = 21;
            let nextVal = current + step;
            if (nextVal < min) nextVal = min;
            if (nextVal > max) nextVal = max;
            input.value = nextVal;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
      });

      // 10x6 Selection Matrix Mouse Handlers
      let isDraggingMatrix = false;
      const matrixGrid = this.modal.querySelector("#zs-matrix-grid");
      const matrixCells = this.modal.querySelectorAll(".zs-matrix-cell");

      matrixCells.forEach((cell) => {
        cell.addEventListener("mousedown", (e) => {
          e.preventDefault();
          isDraggingMatrix = true;
          const c = parseInt(cell.dataset.col, 10);
          const r = parseInt(cell.dataset.row, 10);
          this.updateMatrixUI(c, r);
        });

        cell.addEventListener("mouseenter", () => {
          const c = parseInt(cell.dataset.col, 10);
          const r = parseInt(cell.dataset.row, 10);
          if (isDraggingMatrix) {
            this.updateMatrixUI(c, r);
          } else {
            matrixCells.forEach((other) => {
              const oc = parseInt(other.dataset.col, 10);
              const or = parseInt(other.dataset.row, 10);
              other.setAttribute(
                "data-hover",
                oc <= c && or <= r ? "true" : "false",
              );
            });
          }
        });
      });

      if (matrixGrid) {
        matrixGrid.addEventListener("mouseleave", () => {
          matrixCells.forEach((c) => c.removeAttribute("data-hover"));
        });
      }

      this._matrixMouseUpHandler = () => {
        if (isDraggingMatrix) isDraggingMatrix = false;
      };
      window.addEventListener("mouseup", this._matrixMouseUpHandler);

      // Animation Type and Speed Sync + Preview Demo
      const animSpeedSlider = this.modal.querySelector("#zs-anim-speed-slider");
      const animSpeedInput = this.modal.querySelector("#zs-anim-speed");
      const animSpeedBadge = this.modal.querySelector("#zs-anim-speed-badge");
      const animPreviewBox = this.modal.querySelector("#zs-anim-preview-box");
      const animTypeDropdown = this.modal.querySelector(
        "#zs-anim-type-dropdown",
      );

      let previewPulseTimeout = null;
      if (animPreviewBox) {
        animPreviewBox.addEventListener("click", () => {
          animPreviewBox.setAttribute("data-preview-active", "true");
          if (previewPulseTimeout) clearTimeout(previewPulseTimeout);
          const speed =
            parseInt(animSpeedInput ? animSpeedInput.value : "450", 10) || 450;
          previewPulseTimeout = setTimeout(
            () => {
              if (animPreviewBox)
                animPreviewBox.removeAttribute("data-preview-active");
            },
            Math.max(speed + 500, 1000),
          );
        });
      }

      const onAnimChange = (typeVal) => {
        const hiddenInput = this.modal.querySelector("#zs-anim-type");
        const type = typeVal || (hiddenInput ? hiddenInput.value : "slide");
        let speed = parseInt(animSpeedInput ? animSpeedInput.value : "450", 10);
        if (isNaN(speed)) speed = 0;

        if (speed <= 0 && type !== "none") {
          if (animTypeDropdown && animTypeDropdown.syncValue)
            animTypeDropdown.syncValue("none");
        }
        if (animSpeedBadge) animSpeedBadge.textContent = `${speed} ms`;
        this.updatePreviewDemo(type, speed);
      };

      this.setupCustomSelect(
        "zs-anim-type-dropdown",
        "zs-anim-type",
        (selectedType) => {
          if (selectedType === "none") {
            if (animSpeedInput) animSpeedInput.value = 0;
            if (animSpeedSlider) animSpeedSlider.value = 0;
          } else {
            const currentSpeed = parseInt(
              animSpeedInput ? animSpeedInput.value : "0",
              10,
            );
            if (currentSpeed === 0) {
              if (animSpeedInput) animSpeedInput.value = 450;
              if (animSpeedSlider) animSpeedSlider.value = 450;
            }
          }
          onAnimChange(selectedType);
        },
      );

      this.setupShortcutRecorder("zs-insta-peek-btn", "zs-insta-peek-shortcut");
      this.setupCustomSelect(
        "zs-tg-indicator-type-dropdown",
        "zs-tg-indicator-type",
      );

      if (animSpeedSlider) {
        animSpeedSlider.addEventListener("input", (e) => {
          const val = parseInt(e.target.value, 10) || 0;
          if (animSpeedInput) animSpeedInput.value = val;
          const currentTypeInput = this.modal.querySelector("#zs-anim-type");
          const currentType = currentTypeInput
            ? currentTypeInput.value
            : "slide";
          if (val === 0 && animTypeDropdown && animTypeDropdown.syncValue) {
            animTypeDropdown.syncValue("none");
          } else if (
            val > 0 &&
            currentType === "none" &&
            animTypeDropdown &&
            animTypeDropdown.syncValue
          ) {
            animTypeDropdown.syncValue("slide");
          }
          onAnimChange();
        });
      }

      if (animSpeedInput) {
        animSpeedInput.addEventListener("input", (e) => {
          let val = parseInt(e.target.value, 10);
          if (isNaN(val)) val = 0;
          if (val < 0) val = 0;
          if (val > 2000) val = 2000;
          if (animSpeedSlider) animSpeedSlider.value = val;
          const currentTypeInput = this.modal.querySelector("#zs-anim-type");
          const currentType = currentTypeInput
            ? currentTypeInput.value
            : "slide";
          if (val === 0 && animTypeDropdown && animTypeDropdown.syncValue) {
            animTypeDropdown.syncValue("none");
          } else if (
            val > 0 &&
            currentType === "none" &&
            animTypeDropdown &&
            animTypeDropdown.syncValue
          ) {
            animTypeDropdown.syncValue("slide");
          }
          onAnimChange();
        });
      }

      // Group Indicator toggle -> smoothly slides/shows Indicator Type row
      const chevronToggle = this.modal.querySelector("#zs-tg-chevron");
      const indicatorTypeRow = this.modal.querySelector(
        "#zs-tg-indicator-type-row",
      );
      if (chevronToggle && indicatorTypeRow) {
        chevronToggle.addEventListener("change", () => {
          if (chevronToggle.checked) {
            indicatorTypeRow.removeAttribute("data-hidden");
          } else {
            indicatorTypeRow.setAttribute("data-hidden", "true");
          }
        });
      }

      // Tab Groups Opacity Slider Live Sync
      const opacitySlider = this.modal.querySelector("#zs-tg-opacity");
      const opacityBadge = this.modal.querySelector("#zs-tg-opacity-badge");
      if (opacitySlider) {
        opacitySlider.addEventListener("input", (e) => {
          const val = parseInt(e.target.value, 10) || 85;
          if (opacityBadge) opacityBadge.textContent = `${val}%`;
          document.documentElement.style.setProperty(
            "--zentral-tabgroup-label-opacity",
            (val / 100).toFixed(2),
          );
          document.documentElement.setAttribute(
            "zentral-label-opacity-below-85",
            val < 85 ? "true" : "false",
          );
        });
      }

      // Helper to auto-save all diagnostics options immediately on change
      const saveDiagnosticsPrefsImmediately = () => {
        if (loggerMasterToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_ENABLED,
            loggerMasterToggle.checked,
          );
          Core.setPref(Constants.Diagnostics.PREF_LOGGER_CORE, true);
        }
        if (loggerFullToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_FULL,
            loggerFullToggle.checked,
          );
        }
        if (tabsToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_TABS,
            tabsToggle.checked,
          );
        }
        if (appsToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_APPS,
            appsToggle.checked,
          );
        }
        if (menusToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_MENUS,
            menusToggle.checked,
          );
        }
        if (layoutToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_LAYOUT,
            layoutToggle.checked,
          );
        }
        if (pathInput) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_PATH,
            (pathInput.value || "").trim(),
          );
        }
      };

      // Diagnostic Logging Master Toggle
      const loggerMasterToggle = this.modal.querySelector(
        "#zs-pref-logger-enabled",
      );
      if (loggerMasterToggle) {
        loggerMasterToggle.addEventListener("change", () => {
          this.updateLoggerUIState();
          saveDiagnosticsPrefsImmediately();
        });
      }

      // Diagnostic Logging Full Log Toggle & Modular Sub-Selections
      const loggerFullToggle = this.modal.querySelector("#zs-pref-logger-full");
      const tabsToggle = this.modal.querySelector("#zs-pref-logger-tabs");
      const appsToggle = this.modal.querySelector("#zs-pref-logger-apps");
      const menusToggle = this.modal.querySelector("#zs-pref-logger-menus");
      const layoutToggle = this.modal.querySelector("#zs-pref-logger-layout");

      if (loggerFullToggle) {
        loggerFullToggle.addEventListener("change", () => {
          if (!loggerFullToggle.checked) {
            // When unchecking Full Log, reveal modules with optional ones unchecked by default
            if (tabsToggle) tabsToggle.checked = false;
            if (appsToggle) appsToggle.checked = false;
            if (menusToggle) menusToggle.checked = false;
            if (layoutToggle) layoutToggle.checked = false;
          }
          this.updateLoggerUIState();
          saveDiagnosticsPrefsImmediately();
        });
      }

      const optionalModuleToggles = [
        tabsToggle,
        appsToggle,
        menusToggle,
        layoutToggle,
      ].filter(Boolean);
      optionalModuleToggles.forEach((toggle) => {
        toggle.addEventListener("change", () => {
          const allChecked = optionalModuleToggles.every((t) => t.checked);
          if (allChecked && loggerFullToggle) {
            // If all optional modules get individually checked, switch back to Full Log mode
            loggerFullToggle.checked = true;
            this.updateLoggerUIState();
          }
          saveDiagnosticsPrefsImmediately();
        });
      });

      const choosePathBtn = this.modal.querySelector("#zs-btn-choose-path");
      const clearPathBtn = this.modal.querySelector("#zs-btn-clear-path");
      const pathInput = this.modal.querySelector("#zs-pref-logger-path");

      if (choosePathBtn) {
        choosePathBtn.addEventListener("click", async () => {
          const selectedFolder = await this.pickExportFolder();
          if (selectedFolder) {
            pathInput.value = selectedFolder;
            this.updatePathUI(selectedFolder);
            saveDiagnosticsPrefsImmediately();
          }
        });
      }

      if (clearPathBtn) {
        clearPathBtn.addEventListener("click", () => {
          pathInput.value = "";
          this.updatePathUI("");
          saveDiagnosticsPrefsImmediately();
        });
      }

      const captureBtn = this.modal.querySelector("#zs-btn-capture-log");
      if (captureBtn) {
        captureBtn.addEventListener("click", () => {
          saveDiagnosticsPrefsImmediately();
          const loggerToggle = this.modal.querySelector(
            "#zs-pref-logger-enabled",
          );
          const isEnabled = loggerToggle
            ? loggerToggle.checked
            : Core.getPref(Constants.Diagnostics.PREF_LOGGER_ENABLED, false);

          if (!isEnabled) {
            captureBtn.textContent = "⚠️ Logging Disabled";
            captureBtn.style.background = "#ef4444";
            captureBtn.style.color = "#ffffff";
            captureBtn.style.pointerEvents = "none";

            try {
              const promptService =
                Services.prompt ||
                Cc["@mozilla.org/embedcomp/prompt-service;1"]?.getService(
                  Ci.nsIPromptService,
                );
              if (promptService) {
                promptService.alert(
                  window,
                  "Zentral Diagnostics — Inactive",
                  "Diagnostic Logging is currently disabled.\n\nPlease toggle 'Enable Diagnostic Logging' ON above and save changes before exporting logs.",
                );
              }
            } catch (_) {}

            setTimeout(() => {
              if (this.modal && captureBtn) {
                captureBtn.textContent = "Export";
                captureBtn.style.background = "var(--zen-primary-color)";
                captureBtn.style.pointerEvents = "auto";
              }
            }, 2500);
            return;
          }

          if (pathInput && pathInput.value) {
            Core.setPref(
              Constants.Diagnostics.PREF_LOGGER_PATH,
              pathInput.value.trim(),
            );
          }
          window.dispatchEvent(new CustomEvent("ZentralCaptureLog"));

          const originalText = "Export";
          const originalBg = "var(--zen-primary-color)";
          captureBtn.textContent = "✓ Exported!";
          captureBtn.style.background = "#10b981";
          captureBtn.style.color = "#ffffff";
          captureBtn.style.pointerEvents = "none";

          setTimeout(() => {
            if (this.modal && captureBtn) {
              captureBtn.textContent = originalText;
              captureBtn.style.background = originalBg;
              captureBtn.style.pointerEvents = "auto";
            }
          }, 2200);
        });
      }

      // -----------------------------------------------------------------------
      // Issue Report Submission Engine
      // -----------------------------------------------------------------------
      this.setupCustomSelect(
        "zs-report-category-dropdown",
        "zs-report-category",
      );

      const submitReportBtn = this.modal.querySelector("#zs-btn-submit-report");
      const titleInput = this.modal.querySelector("#zs-report-title");
      const categoryInput = this.modal.querySelector("#zs-report-category");
      const descInput = this.modal.querySelector("#zs-report-description");
      const attachLogCheckbox = this.modal.querySelector(
        "#zs-report-attach-log",
      );
      const statusEl = this.modal.querySelector("#zs-report-status");

      if (submitReportBtn && titleInput && descInput) {
        submitReportBtn.addEventListener("click", async () => {
          saveDiagnosticsPrefsImmediately();
          const title = titleInput.value.trim();
          const desc = descInput.value.trim();
          const category = categoryInput ? categoryInput.value : "bug";
          const attachLogs = attachLogCheckbox
            ? attachLogCheckbox.checked
            : true;

          if (!title) {
            titleInput.focus();
            titleInput.style.borderColor = "#ef4444";
            setTimeout(() => {
              if (titleInput) titleInput.style.borderColor = "";
            }, 2000);
            return;
          }
          if (!desc) {
            descInput.focus();
            descInput.style.borderColor = "#ef4444";
            setTimeout(() => {
              if (descInput) descInput.style.borderColor = "";
            }, 2000);
            return;
          }

          // Visual loading state
          submitReportBtn.disabled = true;
          submitReportBtn.style.opacity = "0.7";
          submitReportBtn.style.pointerEvents = "none";
          const origBtnHTML = submitReportBtn.innerHTML;
          submitReportBtn.innerHTML = `<span>Submitting...</span>`;

          if (statusEl) {
            statusEl.style.display = "inline";
            statusEl.style.color = "rgba(255, 255, 255, 0.6)";
            statusEl.textContent = "Connecting to GitHub...";
          }

          // 1. Gather diagnostic logs & system metadata
          let logContent = "";
          if (attachLogs) {
            if (window.ZentralLogger?.generateLogString) {
              logContent = window.ZentralLogger.generateLogString();
            } else if (window.ZentralLogger?.entries) {
              logContent = window.ZentralLogger.entries.join("\n");
            }
          }

          // Safety guard: GitHub limits issue bodies to 65,536 characters.
          // Truncate logs if necessary, preserving the initial snapshot & most recent trace events.
          let sendLogContent = logContent;
          if (sendLogContent && sendLogContent.length > 50000) {
            const head = sendLogContent.slice(0, 12000);
            const tail = sendLogContent.slice(-36000);
            sendLogContent = `${head}\n\n... [Log truncated: Preserved initial system snapshot & most recent events to fit GitHub's 65,536-character limit] ...\n\n${tail}`;
          }

          const systemInfo = {
            zentralVersion: "v1.0.2",
            zenVersion: navigator.userAgent,
            platform: navigator.platform || "Desktop",
            windowSize: `${window.innerWidth}x${window.innerHeight}`,
            dpr: window.devicePixelRatio || 1,
            sidebarMode:
              document.documentElement.getAttribute("zen-sidebar-expanded") ===
              "true"
                ? "Expanded"
                : "Compact",
          };

          // 2. Attempt background submission to Cloudflare Worker endpoint if configured
          const endpointPref = Core.getPref(
            Constants.Diagnostics.PREF_REPORT_ENDPOINT,
          );
          let endpoint = null;
          try {
            const candidate = new URL(endpointPref);
            if (candidate.protocol === "https:") endpoint = candidate.href;
          } catch (_) {}
          let submitted = false;

          if (endpoint) {
            try {
              const resp = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title,
                  description: desc,
                  category,
                  systemInfo,
                  logs: sendLogContent,
                }),
              });

              const result = resp.status === 204 ? {} : await resp.json();
              if (resp.ok && result?.success) {
                submitted = true;
                if (statusEl) {
                  statusEl.style.display = "inline";
                  statusEl.style.color = "#10b981";
                  statusEl.replaceChildren();
                  const issueUrl = new URL(String(result.issueUrl || ""));
                  if (
                    issueUrl.protocol === "https:" &&
                    issueUrl.hostname === "github.com"
                  ) {
                    const link = document.createElement("a");
                    link.href = issueUrl.href;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.style.cssText =
                      "color: #10b981; text-decoration: underline";
                    link.textContent = `✓ Issue #${String(result.issueNumber).slice(0, 30)} created!`;
                    statusEl.appendChild(link);
                  } else {
                    statusEl.textContent =
                      "Issue created; open GitHub to view it.";
                  }
                }
                titleInput.value = "";
                descInput.value = "";
              } else {
                console.warn(
                  "[Zentral-Report] Worker returned error:",
                  resp.status,
                  result,
                );
              }
            } catch (postErr) {
              console.warn(
                "[Zentral-Report] Worker submission failed, falling back to Web:",
                postErr,
              );
            }
          }

          // 3. Fallback: If not submitted via worker, open pre-filled GitHub issue in new tab & copy logs to clipboard
          if (!submitted) {
            if (logContent) {
              try {
                const clipboardHelper = Cc[
                  "@mozilla.org/widget/clipboardhelper;1"
                ]?.getService(Ci.nsIClipboardHelper);
                if (clipboardHelper) {
                  clipboardHelper.copyString(sendLogContent);
                } else if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(sendLogContent);
                }
              } catch (_) {}
            }

            let ghBody = `### 📝 Description\n${desc}\n\n`;
            ghBody += `### 🖥️ Environment\n`;
            ghBody += `- **Zentral Version:** ${systemInfo.zentralVersion}\n`;
            ghBody += `- **Zen Build:** ${systemInfo.zenVersion}\n`;
            ghBody += `- **OS / Platform:** ${systemInfo.platform}\n`;
            ghBody += `- **Window / DPR:** ${systemInfo.windowSize} (DPR: ${systemInfo.dpr})\n\n`;
            if (logContent) {
              ghBody += `*(Diagnostic log copied to your clipboard — paste below if relevant)*\n\n`;
            }

            const ghUrl = `https://github.com/Michele501st/Zentral-Sine/issues/new?title=${encodeURIComponent(`[${category.toUpperCase()}] ${title}`)}&body=${encodeURIComponent(ghBody)}&labels=${encodeURIComponent(category)}`;

            if (window.gBrowser?.addTab) {
              window.gBrowser.addTab(ghUrl, {
                triggeringPrincipal:
                  Services.scriptSecurityManager.getSystemPrincipal(),
              });
            } else {
              window.open(ghUrl, "_blank");
            }

            if (statusEl) {
              statusEl.style.display = "inline";
              statusEl.style.color = "#60a5fa";
              statusEl.textContent = logContent
                ? "✓ Opened in GitHub (Log copied to clipboard!)"
                : "✓ Opened in GitHub!";
            }
          }

          submitReportBtn.disabled = false;
          submitReportBtn.style.opacity = "1";
          submitReportBtn.style.pointerEvents = "auto";
          submitReportBtn.innerHTML = origBtnHTML;
        });
      }

      this.modal.addEventListener("mousedown", (e) => {
        if (e.target === this.modal) this.close();
      });

      this.modal.querySelector("#zs-ag-reset").addEventListener("click", () => {
        const get = (id) => this.modal.querySelector("#" + id);
        get("zs-ag-enabled").checked = true;
        if (agStatus) {
          agStatus.textContent = "Enabled";
          agStatus.setAttribute("data-enabled", "true");
        }
        if (agContent) agContent.removeAttribute("data-disabled");

        if (placementInput) placementInput.value = "sidebar";
        placementBtns.forEach((b) =>
          b.setAttribute(
            "data-active",
            b.dataset.placement === "sidebar" ? "true" : "false",
          ),
        );
        if (agCol) agCol.setAttribute("data-placement", "sidebar");
        if (matrixWrapper) matrixWrapper.removeAttribute("data-hidden");
        if (get("zs-hide-utility-section"))
          get("zs-hide-utility-section").checked = false;
        const utilityRow = get("zs-utility-section-row");
        if (utilityRow) utilityRow.removeAttribute("data-hidden");

        this.updateMatrixUI(7, 3);
        const animDropdown = this.modal.querySelector("#zs-anim-type-dropdown");
        if (animDropdown && animDropdown.syncValue)
          animDropdown.syncValue("slide");
        else if (get("zs-anim-type")) get("zs-anim-type").value = "slide";

        get("zs-anim-speed").value = 450;
        if (get("zs-anim-speed-slider"))
          get("zs-anim-speed-slider").value = 450;
        if (get("zs-anim-speed-badge"))
          get("zs-anim-speed-badge").textContent = "450 ms";
        get("zs-max-apps").value = 21;
        const instaPeekBtn = this.modal.querySelector("#zs-insta-peek-btn");
        if (instaPeekBtn && instaPeekBtn.syncValue)
          instaPeekBtn.syncValue("Alt+Q");
        else if (get("zs-insta-peek-shortcut"))
          get("zs-insta-peek-shortcut").value = "Alt+Q";
        this.updatePreviewDemo("slide", 450);
      });

      this.modal.querySelector("#zs-tg-reset").addEventListener("click", () => {
        const get = (id) => this.modal.querySelector("#" + id);
        get("zs-tg-enabled").checked = true;
        if (tgStatus) {
          tgStatus.textContent = "Enabled";
          tgStatus.setAttribute("data-enabled", "true");
        }
        if (tgContent) tgContent.removeAttribute("data-disabled");

        get("zs-tg-collapse").checked = false;
        get("zs-tg-thumbnails").checked = true;
        get("zs-tg-chevron").checked = true;
        if (indicatorTypeRow) indicatorTypeRow.removeAttribute("data-hidden");

        const tgDropdown = this.modal.querySelector(
          "#zs-tg-indicator-type-dropdown",
        );
        if (tgDropdown && tgDropdown.syncValue) tgDropdown.syncValue("circle");
        else if (get("zs-tg-indicator-type"))
          get("zs-tg-indicator-type").value = "circle";

        get("zs-tg-opacity").value = 85;
        if (get("zs-tg-opacity-badge"))
          get("zs-tg-opacity-badge").textContent = "85%";
        document.documentElement.style.setProperty(
          "--zentral-tabgroup-label-opacity",
          "0.85",
        );
        document.documentElement.setAttribute(
          "zentral-label-opacity-below-85",
          "false",
        );
        document.documentElement.setAttribute(
          "zentral-indicator-type",
          "circle",
        );
      });

      this.populate();
    }
  }
  const Settings = new ZentralSettings();
  window.Zentral = { Core, Settings };
  window.ZentralSettingsInstance = Settings;
  runtime.shared = {
    Constants,
    Core,
    createSVGElement,
    SVG_STRINGS,
    WELL_KNOWN_SERVICES,
  };
  // Feature: extension-settings. Imports and exposed are listed in ARCHITECTURE.md.
  // Preparation publishes functions; activation preserves the baseline initialization order.
  ZentralRuntime.registerPart("extension-settings", function* (ctx) {
    Object.defineProperties(ctx, {
      injectSettingsUI: { configurable: true, get: () => injectSettingsUI },
    });
    yield;
    function createKeybindRow(labelText, sublabelText, prefKey, defaultVal) {
      const row = document.createElement("div");
      row.className = "zs-row zs-keybind-row";

      const labelContainer = document.createElement("div");
      labelContainer.className = "zs-label-container";
      const label = document.createElement("span");
      label.className = "zs-label";
      label.textContent = labelText;
      const sublabel = document.createElement("span");
      sublabel.className = "zs-sublabel";
      sublabel.textContent = sublabelText;
      labelContainer.append(label, sublabel);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "zs-keybind-input";
      input.readOnly = true;
      input.spellcheck = false;
      input.value = ctx.getPref(prefKey, defaultVal) || "";
      input.placeholder = "Unassigned";
      input.title = "Click, then press a shortcut. Backspace/Delete clears it.";

      input.addEventListener("focus", () => {
        input.dataset.recording = "true";
        input.select();
      });
      input.addEventListener("blur", () =>
        input.removeAttribute("data-recording"),
      );
      input.addEventListener("keydown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (e.key === "Backspace" || e.key === "Delete") {
          input.value = "";
          ctx.setPref(prefKey, "");
          return;
        }
        const value = ctx.keybindFromEvent(e);
        if (!value) return;
        input.value = value;
        ctx.setPref(prefKey, value);
        input.blur();
      });

      row.append(labelContainer, input);
      return { row, input };
    }

    function createToggleRow(
      labelText,
      sublabelText,
      prefKey,
      rootAttr,
      defaultVal = false,
      iconSvg = null,
      onChange = null,
    ) {
      const row = document.createElement("div");
      row.className = "zs-row";

      const leftBox = document.createElement("div");
      leftBox.className = "zs-setting-with-icon";

      if (iconSvg) {
        const iconWrapper = document.createElement("div");
        iconWrapper.className = "zs-icon-preview";
        iconWrapper.appendChild(ctx.parseSVG(iconSvg));
        leftBox.appendChild(iconWrapper);
      }

      const labelContainer = document.createElement("div");
      labelContainer.className = "zs-label-container";
      const label = document.createElement("span");
      label.className = "zs-label";
      label.textContent = labelText;
      labelContainer.appendChild(label);

      if (sublabelText) {
        const sublabel = document.createElement("span");
        sublabel.className = "zs-sublabel";
        sublabel.textContent = sublabelText;
        labelContainer.appendChild(sublabel);
      }
      leftBox.appendChild(labelContainer);

      const switchLabel = document.createElement("label");
      switchLabel.className = "zs-switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("data-pref", prefKey);
      input.checked = ctx.getPref(prefKey, defaultVal);

      input.addEventListener("change", () => {
        ctx.setPref(prefKey, input.checked);
        if (rootAttr) {
          document.documentElement.setAttribute(
            rootAttr,
            input.checked ? "true" : "false",
          );
        }
        if (
          prefKey ===
          (ctx.EXT_PREFS?.CORNER_TILES || ctx.BGALAZKA_EXT_PREFS.CORNER_TILES)
        ) {
          ctx.requestTileSync(50);
        }
        if (prefKey === ctx.BGALAZKA_EXT_PREFS.PUSH_PAGE) {
          ctx.syncPanelPushState();
        }
        if (typeof onChange === "function") {
          onChange(input.checked);
        }
      });

      const slider = document.createElement("span");
      slider.className = "zs-slider";
      switchLabel.appendChild(input);
      switchLabel.appendChild(slider);

      row.appendChild(leftBox);
      row.appendChild(switchLabel);
      return { row, input };
    }

    // Reusable dropdown-style setting row. rootAttr is OPTIONAL: pass a root
    // <html> attribute name to mirror the selected value onto documentElement
    // (for CSS to key off, same convention as createToggleRow's rootAttr), or
    // omit/null it for a setting that's only ever read from JS via getPref().
    function createSelectRow(
      labelText,
      sublabelText,
      prefKey,
      options,
      defaultVal,
      iconSvg,
      rootAttr = null,
      onChange = null,
    ) {
      const row = document.createElement("div");
      row.className = "zs-row";

      const leftBox = document.createElement("div");
      leftBox.className = "zs-setting-with-icon";

      if (iconSvg) {
        const iconWrapper = document.createElement("div");
        iconWrapper.className = "zs-icon-preview";
        iconWrapper.appendChild(ctx.parseSVG(iconSvg));
        leftBox.appendChild(iconWrapper);
      }

      const labelContainer = document.createElement("div");
      labelContainer.className = "zs-label-container";
      const label = document.createElement("span");
      label.className = "zs-label";
      label.textContent = labelText;
      labelContainer.appendChild(label);

      if (sublabelText) {
        const sublabel = document.createElement("span");
        sublabel.className = "zs-sublabel";
        sublabel.textContent = sublabelText;
        labelContainer.appendChild(sublabel);
      }
      leftBox.appendChild(labelContainer);

      const select = document.createElement("select");
      select.className = "zs-select-input";
      select.style.cssText = `
      background: #18181b !important;
      color: #ffffff !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      border-radius: 8px !important;
      padding: 4px 10px !important;
      font-size: 12px !important;
      font-weight: 500 !important;
      outline: none !important;
      cursor: pointer !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
    `;

      const currentVal = ctx.getPref(prefKey, defaultVal);
      options.forEach((opt) => {
        const optionEl = document.createElement("option");
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        if (opt.value === currentVal) optionEl.selected = true;
        select.appendChild(optionEl);
      });

      select.addEventListener("change", () => {
        ctx.setPref(prefKey, select.value);
        // BUG FIX: this used to unconditionally write "bgalazka-pill-position"
        // here regardless of which setting owned the row (a leftover from
        // when this function was only ever sketched out for that one use).
        // Since this function was never actually called anywhere, it was a
        // latent bug rather than an active one — now that it has real
        // callers (search engine picker, etc.), only mirror an attribute
        // when the caller actually asked for one.
        if (rootAttr) {
          document.documentElement.setAttribute(rootAttr, select.value);
        }
        if (typeof onChange === "function") onChange(select.value);
      });

      row.appendChild(leftBox);
      row.appendChild(select);
      return { row, select };
    }

    // Reusable free-text setting row (e.g. pasting a custom search engine
    // URL). Writes the pref on "change" (blur/Enter) rather than on every
    // keystroke, both to avoid hammering Services.prefs while typing and so
    // an in-progress edit isn't half-applied.
    function createTextRow(
      labelText,
      sublabelText,
      prefKey,
      placeholder,
      iconSvg = null,
      onChange = null,
    ) {
      const row = document.createElement("div");
      row.className = "zs-row";
      row.style.display = "flex";
      row.style.flexDirection = "column";
      row.style.alignItems = "stretch";
      row.style.textAlign = "left";
      row.style.padding = "8px 16px";
      row.style.gap = "8px";

      const labelContainer = document.createElement("div");
      labelContainer.className = "zs-label-container";
      labelContainer.style.width = "100%";
      labelContainer.style.textAlign = "left";
      labelContainer.style.alignItems = "flex-start";
      labelContainer.style.display = "flex";
      labelContainer.style.flexDirection = "column";

      const label = document.createElement("span");
      label.className = "zs-label";
      label.style.textAlign = "left";
      label.textContent = labelText;
      labelContainer.appendChild(label);

      if (sublabelText) {
        const sublabel = document.createElement("span");
        sublabel.className = "zs-sublabel";
        sublabel.style.textAlign = "left";
        sublabel.textContent = sublabelText;
        labelContainer.appendChild(sublabel);
      }

      if (iconSvg) {
        const iconWrapper = document.createElement("div");
        iconWrapper.className = "zs-icon-preview";
        iconWrapper.appendChild(ctx.parseSVG(iconSvg));
        labelContainer.prepend(iconWrapper);
      }

      const input = document.createElement("input");
      input.type = "text";
      input.className = "zs-text-input";
      input.spellcheck = false;
      input.setAttribute("autocomplete", "off");
      if (placeholder) input.placeholder = placeholder;
      input.style.width = "100%";
      input.value = ctx.getPref(prefKey, "");

      const commitTextValue = () => {
        const val = input.value.trim();
        if (
          ctx.SEARCH_CUSTOM_ENGINE_PREFS.includes(prefKey) &&
          val &&
          !ctx.isValidQuickSwitchTemplate(val)
        ) {
          const message =
            'Use an HTTP(S) URL with "%s" for the search term. The previous URL is still saved.';
          input.setCustomValidity(message);
          input.setAttribute("aria-invalid", "true");
          error.textContent = message;
          error.hidden = false;
          return false;
        }
        input.value = val;
        input.setCustomValidity("");
        input.removeAttribute("aria-invalid");
        error.hidden = true;
        if (ctx.getPref(prefKey, "") !== val) ctx.setPref(prefKey, val);
        if (typeof onChange === "function") onChange(val);
        return true;
      };
      const error = document.createElement("span");
      error.className = "zs-field-error";
      error.id = "zs-error-" + prefKey.replace(/[^a-z0-9_-]/gi, "-");
      error.setAttribute("role", "status");
      error.hidden = true;
      input.setAttribute("aria-label", labelText);
      input.setAttribute("aria-describedby", error.id);
      input.addEventListener("change", commitTextValue);
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (commitTextValue()) input.blur();
      });

      row.appendChild(labelContainer);
      row.appendChild(input);
      row.appendChild(error);
      return { row, input };
    }

    function createSliderRow(
      labelText,
      sublabelText,
      prefKey,
      min,
      max,
      defaultVal,
      suffix,
      toPreference = (value) => value,
      fromPreference = (value) => value,
    ) {
      const row = document.createElement("div");
      row.className = "zs-row";
      row.style.display = "flex";
      row.style.flexDirection = "column";
      row.style.alignItems = "stretch";
      row.style.textAlign = "left";
      row.style.padding = "8px 16px";
      row.style.gap = "8px";

      const labelContainer = document.createElement("div");
      labelContainer.className = "zs-label-container";
      labelContainer.style.width = "100%";
      labelContainer.style.textAlign = "left";
      labelContainer.style.alignItems = "flex-start";
      labelContainer.style.display = "flex";
      labelContainer.style.flexDirection = "column";

      const label = document.createElement("span");
      label.className = "zs-label";
      label.style.textAlign = "left";
      label.textContent = labelText;

      const sublabel = document.createElement("span");
      sublabel.className = "zs-sublabel";
      sublabel.style.textAlign = "left";
      sublabel.textContent = sublabelText;

      labelContainer.appendChild(label);
      labelContainer.appendChild(sublabel);

      const sliderContainer = document.createElement("div");
      sliderContainer.className = "zs-stacked-slider";
      sliderContainer.style.width = "100%";

      const header = document.createElement("div");
      header.className = "zs-stacked-slider-header";
      header.style.display = "flex";
      header.style.justifyContent = "flex-start";
      header.style.alignItems = "center";
      header.style.marginBottom = "4px";

      const badge = document.createElement("span");
      badge.className = "zs-mono-badge";

      const input = document.createElement("input");
      input.type = "range";
      input.className = "zs-range-slider";
      input.style.width = "100%";
      input.min = min;
      input.max = max;
      input.value = fromPreference(ctx.getPref(prefKey, defaultVal));
      badge.textContent = input.value + suffix;

      input.addEventListener("input", () => {
        badge.textContent = input.value + suffix;
        ctx.setPref(prefKey, toPreference(parseInt(input.value, 10)));
        if (typeof ctx.updateCSSVars === "function") {
          ctx.updateCSSVars();
        }
      });

      header.appendChild(badge);
      sliderContainer.appendChild(header);
      sliderContainer.appendChild(input);

      row.appendChild(labelContainer);
      row.appendChild(sliderContainer);

      return { row, input, badge };
    }

    function createColorRow(labelText, sublabelText, prefKey, defaultVal) {
      const row = document.createElement("div");
      row.className = "zs-row";

      const leftBox = document.createElement("div");
      leftBox.style.display = "flex";
      leftBox.style.flexDirection = "column";

      const labelContainer = document.createElement("div");
      labelContainer.className = "zs-label-container";
      const label = document.createElement("span");
      label.className = "zs-label";
      label.textContent = labelText;
      labelContainer.appendChild(label);

      if (sublabelText) {
        const sublabel = document.createElement("span");
        sublabel.className = "zs-sublabel";
        sublabel.textContent = sublabelText;
        labelContainer.appendChild(sublabel);
      }
      leftBox.appendChild(labelContainer);

      const input = document.createElement("input");
      input.type = "color";
      input.style.cssText = `
      width: 36px;
      height: 26px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
    `;
      input.value = ctx.getPref(prefKey, defaultVal);

      input.addEventListener("input", () => {
        ctx.setPref(prefKey, input.value);
        ctx.updateCSSVars();
      });

      row.appendChild(leftBox);
      row.appendChild(input);
      return { row, input };
    }

    // The base mod's `Constants` lives inside another IIFE and is not visible
    // here. Keep these exact visual keys local; discover the other base keys
    // from Zentral.Core.defaultPrefs when building a full backup.
    const LOOK_GROUP_PREFS = Object.freeze({
      SHOW_CHEVRON: "zen.workspace.tabgroups.show_chevron",
      INDICATOR_TYPE: "zen.workspace.tabgroups.indicator_type",
      LABEL_OPACITY: "zen.workspace.tabgroups.label_opacity",
    });

    // Appearance belongs to its own preference namespace, so a Look-only file
    // cannot accidentally change panel placement, shortcuts, or browsing data.
    const LOOK_PREFS = Object.freeze({
      STYLE: "zen.workspace.bgalazka.look.style",
      CANVAS: "zen.workspace.bgalazka.look.canvas",
      SURFACE: "zen.workspace.bgalazka.look.surface",
      RAISED: "zen.workspace.bgalazka.look.raised",
      ACCENT: "zen.workspace.bgalazka.look.accent",
      TEXT: "zen.workspace.bgalazka.look.text",
      MUTED: "zen.workspace.bgalazka.look.muted",
      SURFACE_OPACITY: "zen.workspace.bgalazka.look.surface_opacity",
      RAISED_OPACITY: "zen.workspace.bgalazka.look.raised_opacity",
      TOOLBAR_OPACITY: "zen.workspace.bgalazka.look.toolbar_opacity",
      ADDRESS_OPACITY: "zen.workspace.bgalazka.look.address_opacity",
      BUTTON_OPACITY: "zen.workspace.bgalazka.look.button_opacity",
      TILE_OPACITY: "zen.workspace.bgalazka.look.tile_opacity",
      VIDEO_OPACITY: "zen.workspace.bgalazka.look.video_opacity",
      VIDEO_CONTROL_OPACITY:
        "zen.workspace.bgalazka.look.video_control_opacity",
      POPUP_OPACITY: "zen.workspace.bgalazka.look.popup_opacity",
      RADIUS: "zen.workspace.bgalazka.look.radius",
      DEPTH: "zen.workspace.bgalazka.look.depth",
      SPACING: "zen.workspace.bgalazka.look.spacing",
      VIDEO_RADIUS: "zen.workspace.zentral.video_preview.radius_px",
      PANEL_BORDER: "zen.workspace.bgalazka.look.panel_border",
      TOOLBAR_SURFACE: "zen.workspace.bgalazka.look.toolbar_surface",
      TOOLBAR_URL: "zen.workspace.bgalazka.look.toolbar_url",
      TOOLBAR_BORDER: "zen.workspace.bgalazka.look.toolbar_border",
      BUTTON_STYLE: "zen.workspace.bgalazka.look.button_style",
      BUTTON_SURFACE: "zen.workspace.bgalazka.look.button_surface",
      BUTTON_TEXT: "zen.workspace.bgalazka.look.button_text",
      BUTTON_BORDER_COLOR: "zen.workspace.bgalazka.look.button_border_color",
      BUTTON_BORDER: "zen.workspace.bgalazka.look.button_border",
      CONTROL_SIZE: "zen.workspace.bgalazka.look.control_size",
      TILE_STYLE: "zen.workspace.bgalazka.look.tile_style",
      ROW_STYLE: "zen.workspace.bgalazka.look.row_style",
      ROW_PADDING: "zen.workspace.bgalazka.look.row_padding",
      ROW_RULE: "zen.workspace.bgalazka.look.row_rule",
      VIDEO_CANVAS: "zen.workspace.bgalazka.look.video_canvas",
      VIDEO_CONTROL: "zen.workspace.bgalazka.look.video_control",
      VIDEO_TEXT: "zen.workspace.bgalazka.look.video_text",
      VIDEO_MUTED: "zen.workspace.bgalazka.look.video_muted",
      VIDEO_SELECTED: "zen.workspace.bgalazka.look.video_selected",
      VIDEO_BORDER: "zen.workspace.bgalazka.look.video_border",
      VIDEO_PADDING: "zen.workspace.bgalazka.look.video_padding",
      VIDEO_ROW_HEIGHT: "zen.workspace.bgalazka.look.video_row_height",
      VIDEO_SOURCE_STYLE: "zen.workspace.bgalazka.look.video_source_style",
      TABBAR_COMPACT: ctx.EXT_PREFS.TABBAR_COMPACT,
      TABBAR_ROW_HEIGHT: ctx.EXT_PREFS.TABBAR_ROW_HEIGHT,
      TABBAR_ROW_GAP: ctx.EXT_PREFS.TABBAR_ROW_GAP,
      TABBAR_ICON_GAP: ctx.EXT_PREFS.TABBAR_ICON_GAP,
      DENSITY_ICONS: "zen.workspace.bgalazka.look.density_icons",
      DENSITY_NEWTAB: "zen.workspace.bgalazka.look.density_newtab",
      DENSITY_URLBAR: "zen.workspace.bgalazka.look.density_urlbar",
      DENSITY_ESSENTIALS: "zen.workspace.bgalazka.look.density_essentials",
      ESSENTIALS_HEIGHT: "zen.workspace.bgalazka.look.essentials_height",
      TABBAR_SECTION_GAP: "zen.workspace.bgalazka.look.tabbar_section_gap",
      FOLDER_ICON_SIZE: "zen.workspace.bgalazka.look.folder_icon_size",
      WORKSPACE_ICON_SIZE: "zen.workspace.bgalazka.look.workspace_icon_size",
      WORKSPACE_HEIGHT: "zen.workspace.bgalazka.look.workspace_height",
      BOTTOM_BAR_HEIGHT: "zen.workspace.bgalazka.look.bottom_bar_height",
      URLBAR_TOP_GAP: "zen.workspace.bgalazka.look.urlbar_top_gap",
      NEWTAB_HEIGHT: "zen.workspace.bgalazka.look.newtab_height",
    });
    const LOOK_DEFAULTS = Object.freeze({
      [LOOK_PREFS.STYLE]: "atelier",
      [LOOK_PREFS.CANVAS]: "#17191b",
      [LOOK_PREFS.SURFACE]: "#202224",
      [LOOK_PREFS.RAISED]: "#2b2e31",
      [LOOK_PREFS.ACCENT]: "#a5bec0",
      [LOOK_PREFS.TEXT]: "#dce0e1",
      [LOOK_PREFS.MUTED]: "#a4aaad",
      [LOOK_PREFS.SURFACE_OPACITY]: 100,
      [LOOK_PREFS.RAISED_OPACITY]: 100,
      [LOOK_PREFS.TOOLBAR_OPACITY]: 100,
      [LOOK_PREFS.ADDRESS_OPACITY]: 100,
      [LOOK_PREFS.BUTTON_OPACITY]: 100,
      [LOOK_PREFS.TILE_OPACITY]: 100,
      [LOOK_PREFS.VIDEO_OPACITY]: 100,
      [LOOK_PREFS.VIDEO_CONTROL_OPACITY]: 100,
      [LOOK_PREFS.POPUP_OPACITY]: 100,
      [LOOK_PREFS.RADIUS]: 0,
      [LOOK_PREFS.DEPTH]: 0,
      [LOOK_PREFS.SPACING]: "comfortable",
      [LOOK_PREFS.TABBAR_COMPACT]: false,
      [LOOK_PREFS.TABBAR_ROW_HEIGHT]: 20,
      [LOOK_PREFS.TABBAR_ROW_GAP]: 0,
      [LOOK_PREFS.TABBAR_ICON_GAP]: 4,
      [LOOK_PREFS.DENSITY_ICONS]: false,
      [LOOK_PREFS.DENSITY_NEWTAB]: false,
      [LOOK_PREFS.DENSITY_URLBAR]: false,
      [LOOK_PREFS.DENSITY_ESSENTIALS]: false,
      [LOOK_PREFS.ESSENTIALS_HEIGHT]: 32,
      [LOOK_PREFS.TABBAR_SECTION_GAP]: 2,
      [LOOK_PREFS.FOLDER_ICON_SIZE]: 20,
      [LOOK_PREFS.WORKSPACE_ICON_SIZE]: 16,
      [LOOK_PREFS.WORKSPACE_HEIGHT]: 22,
      [LOOK_PREFS.BOTTOM_BAR_HEIGHT]: 24,
      [LOOK_PREFS.URLBAR_TOP_GAP]: 0,
      [LOOK_PREFS.NEWTAB_HEIGHT]: 20,
      [LOOK_PREFS.VIDEO_RADIUS]: 0,
      [LOOK_PREFS.PANEL_BORDER]: 1,
      [LOOK_PREFS.TOOLBAR_SURFACE]: "#202224",
      [LOOK_PREFS.TOOLBAR_URL]: "#292c2e",
      [LOOK_PREFS.TOOLBAR_BORDER]: 1,
      [LOOK_PREFS.BUTTON_STYLE]: "outline",
      [LOOK_PREFS.BUTTON_SURFACE]: "#34373a",
      [LOOK_PREFS.BUTTON_TEXT]: "#d4d8d9",
      [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#292929",
      [LOOK_PREFS.BUTTON_BORDER]: 0,
      [LOOK_PREFS.CONTROL_SIZE]: 22,
      [LOOK_PREFS.TILE_STYLE]: "bare",
      [LOOK_PREFS.ROW_STYLE]: "lines",
      [LOOK_PREFS.ROW_PADDING]: 4,
      [LOOK_PREFS.ROW_RULE]: 0,
      [LOOK_PREFS.VIDEO_CANVAS]: "#0a0a0a",
      [LOOK_PREFS.VIDEO_CONTROL]: "#000000",
      [LOOK_PREFS.VIDEO_TEXT]: "#d8d8d8",
      [LOOK_PREFS.VIDEO_MUTED]: "#838383",
      [LOOK_PREFS.VIDEO_SELECTED]: "#7d0000",
      [LOOK_PREFS.VIDEO_BORDER]: 0,
      [LOOK_PREFS.VIDEO_PADDING]: 0,
      [LOOK_PREFS.VIDEO_ROW_HEIGHT]: 22,
      [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "line",
      [LOOK_GROUP_PREFS.SHOW_CHEVRON]: true,
      [LOOK_GROUP_PREFS.INDICATOR_TYPE]: "circle",
      [ctx.BGALAZKA_EXT_PREFS.TRANSLUCENCY]: true,
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_UNPINNED]: 92,
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS]: 85,
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR]: 45,
      [ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR]: "#5e0002",
      [ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY]: 31,
      [ctx.BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY]: 48,
      [LOOK_GROUP_PREFS.LABEL_OPACITY]: 85,
    });
    // Presets only write values that also have individual controls below.
    const LOOK_THEMES = Object.freeze([
      { name: "Ink", swatch: "#a5bec0", values: {} },
      {
        name: "Copper",
        swatch: "#d99a6a",
        values: {
          [LOOK_PREFS.CANVAS]: "#1d1917",
          [LOOK_PREFS.SURFACE]: "#29211d",
          [LOOK_PREFS.RAISED]: "#3b2d25",
          [LOOK_PREFS.ACCENT]: "#d99a6a",
          [LOOK_PREFS.TEXT]: "#f4e9dc",
          [LOOK_PREFS.MUTED]: "#c4a998",
          [LOOK_PREFS.TOOLBAR_SURFACE]: "#29211d",
          [LOOK_PREFS.TOOLBAR_URL]: "#372b25",
          [LOOK_PREFS.BUTTON_SURFACE]: "#483326",
          [LOOK_PREFS.BUTTON_TEXT]: "#f4e9dc",
          [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#a86e48",
          [LOOK_PREFS.BUTTON_STYLE]: "outline",
          [LOOK_PREFS.BUTTON_BORDER]: 1,
          [LOOK_PREFS.ROW_STYLE]: "cards",
          [LOOK_PREFS.ROW_RULE]: 1,
          [LOOK_PREFS.RADIUS]: 2,
          [LOOK_PREFS.VIDEO_CANVAS]: "#211c19",
          [LOOK_PREFS.VIDEO_CONTROL]: "#483326",
          [LOOK_PREFS.VIDEO_TEXT]: "#f4e9dc",
          [LOOK_PREFS.VIDEO_MUTED]: "#c4a998",
          [LOOK_PREFS.VIDEO_SELECTED]: "#d99a6a",
        },
      },
      {
        name: "Moss",
        swatch: "#9ab89a",
        values: {
          [LOOK_PREFS.CANVAS]: "#161c18",
          [LOOK_PREFS.SURFACE]: "#1f2921",
          [LOOK_PREFS.RAISED]: "#2b382d",
          [LOOK_PREFS.ACCENT]: "#9ab89a",
          [LOOK_PREFS.TEXT]: "#e1ebe1",
          [LOOK_PREFS.MUTED]: "#a1b2a3",
          [LOOK_PREFS.TOOLBAR_SURFACE]: "#1f2921",
          [LOOK_PREFS.TOOLBAR_URL]: "#29372c",
          [LOOK_PREFS.BUTTON_SURFACE]: "#344739",
          [LOOK_PREFS.BUTTON_TEXT]: "#e1ebe1",
          [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#648069",
          [LOOK_PREFS.BUTTON_STYLE]: "filled",
          [LOOK_PREFS.BUTTON_BORDER]: 0,
          [LOOK_PREFS.TILE_STYLE]: "soft",
          [LOOK_PREFS.VIDEO_CANVAS]: "#1b241d",
          [LOOK_PREFS.VIDEO_CONTROL]: "#344739",
          [LOOK_PREFS.VIDEO_TEXT]: "#e1ebe1",
          [LOOK_PREFS.VIDEO_MUTED]: "#a1b2a3",
          [LOOK_PREFS.VIDEO_SELECTED]: "#9ab89a",
          [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "filled",
        },
      },
      {
        name: "Cobalt",
        swatch: "#90baf2",
        values: {
          [LOOK_PREFS.CANVAS]: "#121b2a",
          [LOOK_PREFS.SURFACE]: "#1b2940",
          [LOOK_PREFS.RAISED]: "#293b59",
          [LOOK_PREFS.ACCENT]: "#90baf2",
          [LOOK_PREFS.TEXT]: "#e7effb",
          [LOOK_PREFS.MUTED]: "#a8bad1",
          [LOOK_PREFS.TOOLBAR_SURFACE]: "#1b2940",
          [LOOK_PREFS.TOOLBAR_URL]: "#253650",
          [LOOK_PREFS.BUTTON_SURFACE]: "#304a70",
          [LOOK_PREFS.BUTTON_TEXT]: "#e7effb",
          [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#729cd0",
          [LOOK_PREFS.BUTTON_STYLE]: "outline",
          [LOOK_PREFS.BUTTON_BORDER]: 1,
          [LOOK_PREFS.RADIUS]: 6,
          [LOOK_PREFS.ROW_STYLE]: "cards",
          [LOOK_PREFS.TILE_STYLE]: "soft",
          [LOOK_PREFS.VIDEO_CANVAS]: "#172236",
          [LOOK_PREFS.VIDEO_CONTROL]: "#304a70",
          [LOOK_PREFS.VIDEO_TEXT]: "#e7effb",
          [LOOK_PREFS.VIDEO_MUTED]: "#a8bad1",
          [LOOK_PREFS.VIDEO_SELECTED]: "#90baf2",
        },
      },
      {
        name: "Transparent",
        swatch: "#ffffff",
        values: {
          [LOOK_PREFS.CANVAS]: "#000000",
          [LOOK_PREFS.SURFACE]: "#000000",
          [LOOK_PREFS.RAISED]: "#000000",
          [LOOK_PREFS.ACCENT]: "#ffffff",
          [LOOK_PREFS.TEXT]: "#ffffff",
          [LOOK_PREFS.MUTED]: "#d0d0d0",
          [LOOK_PREFS.TOOLBAR_SURFACE]: "#000000",
          [LOOK_PREFS.TOOLBAR_URL]: "#000000",
          [LOOK_PREFS.BUTTON_SURFACE]: "#000000",
          [LOOK_PREFS.BUTTON_TEXT]: "#ffffff",
          [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#ffffff",
          [LOOK_PREFS.VIDEO_CANVAS]: "#000000",
          [LOOK_PREFS.VIDEO_CONTROL]: "#000000",
          [LOOK_PREFS.VIDEO_TEXT]: "#ffffff",
          [LOOK_PREFS.VIDEO_MUTED]: "#d0d0d0",
          [LOOK_PREFS.VIDEO_SELECTED]: "#ffffff",
          [LOOK_PREFS.SURFACE_OPACITY]: 20,
          [LOOK_PREFS.RAISED_OPACITY]: 25,
          [LOOK_PREFS.TOOLBAR_OPACITY]: 28,
          [LOOK_PREFS.ADDRESS_OPACITY]: 18,
          [LOOK_PREFS.BUTTON_OPACITY]: 22,
          [LOOK_PREFS.TILE_OPACITY]: 18,
          [LOOK_PREFS.VIDEO_OPACITY]: 25,
          [LOOK_PREFS.VIDEO_CONTROL_OPACITY]: 22,
          [LOOK_PREFS.POPUP_OPACITY]: 35,
          [LOOK_PREFS.RADIUS]: 0,
          [LOOK_PREFS.VIDEO_RADIUS]: 0,
          [LOOK_PREFS.DEPTH]: 0,
          [LOOK_PREFS.PANEL_BORDER]: 0,
          [LOOK_PREFS.TOOLBAR_BORDER]: 0,
          [LOOK_PREFS.BUTTON_BORDER]: 0,
          [LOOK_PREFS.VIDEO_BORDER]: 0,
          [LOOK_PREFS.ROW_RULE]: 0,
          [LOOK_PREFS.BUTTON_STYLE]: "filled",
          [LOOK_PREFS.TILE_STYLE]: "soft",
          [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "line",
          [ctx.BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY]: 55,
        },
      },
      {
        name: "Orchid",
        swatch: "#c9a4dc",
        values: {
          [LOOK_PREFS.CANVAS]: "#201923",
          [LOOK_PREFS.SURFACE]: "#2d2231",
          [LOOK_PREFS.RAISED]: "#423149",
          [LOOK_PREFS.ACCENT]: "#c9a4dc",
          [LOOK_PREFS.TEXT]: "#f1e9f3",
          [LOOK_PREFS.MUTED]: "#bfadbf",
          [LOOK_PREFS.TOOLBAR_SURFACE]: "#2d2231",
          [LOOK_PREFS.TOOLBAR_URL]: "#3b2c41",
          [LOOK_PREFS.BUTTON_SURFACE]: "#503a58",
          [LOOK_PREFS.BUTTON_TEXT]: "#f1e9f3",
          [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#9875a6",
          [LOOK_PREFS.BUTTON_STYLE]: "filled",
          [LOOK_PREFS.BUTTON_BORDER]: 1,
          [LOOK_PREFS.RADIUS]: 10,
          [LOOK_PREFS.ROW_STYLE]: "cards",
          [LOOK_PREFS.SPACING]: "airy",
          [LOOK_PREFS.VIDEO_CANVAS]: "#281e2b",
          [LOOK_PREFS.VIDEO_CONTROL]: "#503a58",
          [LOOK_PREFS.VIDEO_TEXT]: "#f1e9f3",
          [LOOK_PREFS.VIDEO_MUTED]: "#bfadbf",
          [LOOK_PREFS.VIDEO_SELECTED]: "#c9a4dc",
          [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "filled",
        },
      },
    ]);
    const LOOK_KEYS = new Set(Object.keys(LOOK_DEFAULTS));
    const LOOK_TRANSPARENCY_KEYS = new Set([
      LOOK_PREFS.SURFACE_OPACITY,
      LOOK_PREFS.RAISED_OPACITY,
      LOOK_PREFS.TOOLBAR_OPACITY,
      LOOK_PREFS.ADDRESS_OPACITY,
      LOOK_PREFS.BUTTON_OPACITY,
      LOOK_PREFS.TILE_OPACITY,
      LOOK_PREFS.VIDEO_OPACITY,
      LOOK_PREFS.VIDEO_CONTROL_OPACITY,
      LOOK_PREFS.POPUP_OPACITY,
    ]);
    // One schema drives import validation, live CSS variables and visible
    // controls. New Look values belong here and in the Look panel below.
    const LOOK_COLORS = [
      "CANVAS",
      "SURFACE",
      "RAISED",
      "ACCENT",
      "TEXT",
      "MUTED",
      "TOOLBAR_SURFACE",
      "TOOLBAR_URL",
      "BUTTON_SURFACE",
      "BUTTON_TEXT",
      "BUTTON_BORDER_COLOR",
      "VIDEO_CANVAS",
      "VIDEO_CONTROL",
      "VIDEO_TEXT",
      "VIDEO_MUTED",
      "VIDEO_SELECTED",
    ];
    const LOOK_ENUMS = Object.freeze({
      [LOOK_PREFS.STYLE]: ["atelier", "classic"],
      [LOOK_PREFS.SPACING]: ["compact", "comfortable", "airy"],
      [LOOK_PREFS.BUTTON_STYLE]: ["plain", "filled", "outline"],
      [LOOK_PREFS.TILE_STYLE]: ["bare", "soft"],
      [LOOK_PREFS.ROW_STYLE]: ["lines", "cards"],
      [LOOK_PREFS.VIDEO_SOURCE_STYLE]: ["line", "filled"],
      [LOOK_GROUP_PREFS.INDICATOR_TYPE]: ["circle", "chevron"],
    });
    const LOOK_BOUNDS = Object.freeze({
      ...Object.fromEntries(
        [
          LOOK_PREFS.SURFACE_OPACITY,
          LOOK_PREFS.RAISED_OPACITY,
          LOOK_PREFS.TOOLBAR_OPACITY,
          LOOK_PREFS.ADDRESS_OPACITY,
          LOOK_PREFS.BUTTON_OPACITY,
          LOOK_PREFS.TILE_OPACITY,
          LOOK_PREFS.VIDEO_OPACITY,
          LOOK_PREFS.VIDEO_CONTROL_OPACITY,
          LOOK_PREFS.POPUP_OPACITY,
        ].map((key) => [key, [0, 100]]),
      ),
      [LOOK_PREFS.RADIUS]: [0, 26],
      [LOOK_PREFS.DEPTH]: [0, 100],
      [LOOK_PREFS.VIDEO_RADIUS]: [0, 24],
      [LOOK_PREFS.PANEL_BORDER]: [0, 3],
      [LOOK_PREFS.TOOLBAR_BORDER]: [0, 3],
      [LOOK_PREFS.BUTTON_BORDER]: [0, 3],
      [LOOK_PREFS.CONTROL_SIZE]: [18, 32],
      [LOOK_PREFS.ROW_PADDING]: [4, 20],
      [LOOK_PREFS.ROW_RULE]: [0, 2],
      [LOOK_PREFS.VIDEO_BORDER]: [0, 3],
      [LOOK_PREFS.VIDEO_PADDING]: [0, 16],
      [LOOK_PREFS.VIDEO_ROW_HEIGHT]: [22, 36],
      [LOOK_PREFS.TABBAR_ROW_HEIGHT]: [18, 36],
      [LOOK_PREFS.TABBAR_ROW_GAP]: [0, 8],
      [LOOK_PREFS.TABBAR_ICON_GAP]: [0, 12],
      [LOOK_PREFS.ESSENTIALS_HEIGHT]: [20, 64],
      [LOOK_PREFS.TABBAR_SECTION_GAP]: [0, 20],
      [LOOK_PREFS.FOLDER_ICON_SIZE]: [12, 28],
      [LOOK_PREFS.WORKSPACE_ICON_SIZE]: [12, 28],
      [LOOK_PREFS.WORKSPACE_HEIGHT]: [18, 40],
      [LOOK_PREFS.BOTTOM_BAR_HEIGHT]: [20, 40],
      [LOOK_PREFS.URLBAR_TOP_GAP]: [0, 16],
      [LOOK_PREFS.NEWTAB_HEIGHT]: [18, 36],
      [LOOK_GROUP_PREFS.LABEL_OPACITY]: [0, 100],
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_UNPINNED]: [10, 100],
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS]: [10, 100],
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR]: [10, 100],
      [ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY]: [10, 100],
      [ctx.BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY]: [10, 100],
    });
    const applyLook = () => {
      const root = document.documentElement;
      for (const [key, attribute] of [
        ["DENSITY_ICONS", "bgalazka-density-icons"],
        ["DENSITY_NEWTAB", "bgalazka-density-newtab"],
        ["DENSITY_URLBAR", "bgalazka-density-urlbar"],
        ["DENSITY_ESSENTIALS", "bgalazka-density-essentials"],
      ]) {
        root.setAttribute(
          attribute,
          ctx.getPref(LOOK_PREFS[key], false) === true ? "true" : "false",
        );
      }
      for (const [key, attribute] of [
        ["STYLE", "bgalazka-look"],
        ["SPACING", "bgalazka-look-spacing"],
        ["BUTTON_STYLE", "bgalazka-look-buttons"],
        ["TILE_STYLE", "bgalazka-look-tiles"],
        ["ROW_STYLE", "bgalazka-look-rows"],
        ["VIDEO_SOURCE_STYLE", "bgalazka-look-video-selection"],
      ]) {
        const pref = LOOK_PREFS[key];
        const value = ctx.getPref(pref, LOOK_DEFAULTS[pref]);
        root.setAttribute(
          attribute,
          LOOK_ENUMS[pref].includes(value) ? value : LOOK_DEFAULTS[pref],
        );
      }
      for (const key of LOOK_COLORS) {
        const pref = LOOK_PREFS[key];
        const value = ctx.getPref(pref, LOOK_DEFAULTS[pref]);
        root.style.setProperty(
          "--bgalazka-look-" + key.toLowerCase().replaceAll("_", "-"),
          /^#[0-9a-fA-F]{6}$/.test(value) ? value : LOOK_DEFAULTS[pref],
        );
      }
      for (const key of [
        "RADIUS",
        "DEPTH",
        "VIDEO_RADIUS",
        "PANEL_BORDER",
        "TOOLBAR_BORDER",
        "BUTTON_BORDER",
        "CONTROL_SIZE",
        "ROW_PADDING",
        "ROW_RULE",
        "VIDEO_BORDER",
        "VIDEO_PADDING",
        "VIDEO_ROW_HEIGHT",
        "TABBAR_ROW_HEIGHT",
        "TABBAR_ROW_GAP",
        "TABBAR_ICON_GAP",
        "ESSENTIALS_HEIGHT",
        "TABBAR_SECTION_GAP",
        "FOLDER_ICON_SIZE",
        "WORKSPACE_ICON_SIZE",
        "WORKSPACE_HEIGHT",
        "BOTTOM_BAR_HEIGHT",
        "URLBAR_TOP_GAP",
        "NEWTAB_HEIGHT",
        "SURFACE_OPACITY",
        "RAISED_OPACITY",
        "TOOLBAR_OPACITY",
        "ADDRESS_OPACITY",
        "BUTTON_OPACITY",
        "TILE_OPACITY",
        "VIDEO_OPACITY",
        "VIDEO_CONTROL_OPACITY",
        "POPUP_OPACITY",
      ]) {
        const pref = LOOK_PREFS[key];
        const value = ctx.getPref(pref, LOOK_DEFAULTS[pref]);
        const [min, max] = LOOK_BOUNDS[pref];
        const clamped =
          typeof value === "number" && Number.isFinite(value)
            ? Math.max(min, Math.min(max, value))
            : LOOK_DEFAULTS[pref];
        root.style.setProperty(
          "--bgalazka-look-" + key.toLowerCase().replaceAll("_", "-"),
          key === "DEPTH" || key.endsWith("_OPACITY")
            ? clamped + "%"
            : clamped + "px",
        );
      }
    };
    // A visual preference error must not halt panel hooks or Settings loading.
    // Keep this optional startup path isolated from the rest of the extension.
    try {
      applyLook();
      Services.prefs.addObserver("zen.workspace.bgalazka.look.", applyLook);
      ctx.registerCleanup(() =>
        Services.prefs.removeObserver(
          "zen.workspace.bgalazka.look.",
          applyLook,
        ),
      );
      Services.prefs.addObserver(LOOK_PREFS.VIDEO_RADIUS, applyLook);
      ctx.registerCleanup(() =>
        Services.prefs.removeObserver(LOOK_PREFS.VIDEO_RADIUS, applyLook),
      );
    } catch (error) {
      console.error("[BgalazkaExtension] Look initialization failed:", error);
    }

    function syncAppearanceAfterImport() {
      applyLook();
      ctx.updateCSSVars();
      ctx.applyAttributes();
      window.Zentral?.TabGroups?.applyLabelOpacityPref?.();
      window.Zentral?.TabGroups?.applyChevronPref?.();
      window.Zentral?.TabGroups?.applyIndicatorTypePref?.();
      window.Zentral?.Settings?.populate?.();
      const videoRadius = document.getElementById("zs-video-preview-radius");
      if (videoRadius) {
        videoRadius.value = ctx.getPref(LOOK_PREFS.VIDEO_RADIUS, 0);
        videoRadius.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const panel = document.getElementById("zs-panel-bgalazka");
      panel?._toggles?.forEach(({ input, pref, def, onSync, isSelect }) => {
        const value = ctx.getPref(pref, def);
        if (isSelect) input.value = value;
        else input.checked = value;
        onSync?.(value);
      });
      document.getElementById("zs-panel-extension-look")?._syncLook?.();
    }

    // Export only owned preference keys; reject arbitrary keys and malformed
    // data before applying anything. Import merges selected keys into this profile.
    // Core owns the base default table. Reading it through the exposed
    // instance avoids reaching across IIFE scope and tracks future base keys.
    const baseBackupKeys = () =>
      new Set(Object.keys(window.Zentral?.Core?.defaultPrefs || {}));
    const reusableBaseDefaults = new Set([
      "zen.workspace.apps.sidebar.animation_speed",
      "zen.workspace.apps.sidebar.animation_type",
      "zen.workspace.apps.sidebar.apps_per_row",
      "zen.workspace.apps.sidebar.max_apps",
      "zen.workspace.apps.sidebar.max_rows",
      "zen.workspace.apps.sidebar.hide_utility_section",
      "zen.workspace.tabgroups.enabled",
      "zen.workspace.tabgroups.thumbnails",
    ]);
    const fullBackupKeys = () =>
      new Set([
        ...baseBackupKeys(),
        ...Object.keys(ctx.PROFILE_DEFAULTS),
        ...Services.prefs.getChildList("zen.workspace.bgalazka."),
        ...Services.prefs.getChildList("zen.workspace.zentral.video_preview."),
        ...LOOK_KEYS,
      ]);
    const ownedBackupKey = (key) =>
      LOOK_KEYS.has(key) ||
      baseBackupKeys().has(key) ||
      key.startsWith("zen.workspace.bgalazka.") ||
      key.startsWith("zen.workspace.zentral.video_preview.");
    async function chooseBackupFile(mode, title, defaultName) {
      const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
        Ci.nsIFilePicker,
      );
      picker.init(window.browsingContext || window, title, mode);
      picker.appendFilter("JSON files", "*.json");
      if (defaultName) picker.defaultString = defaultName;
      const result = await new Promise((resolve) => {
        let settled = false;
        const done = (value) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        };
        try {
          const maybe = picker.open({ done });
          if (maybe?.then) maybe.then(done, () => done(null));
        } catch (_) {
          try {
            const maybe = picker.open(done);
            if (maybe?.then) maybe.then(done, () => done(null));
          } catch (_) {
            done(null);
          }
        }
      });
      return result === Ci.nsIFilePicker.returnOK ||
        result === Ci.nsIFilePicker.returnReplace
        ? picker.file?.path
        : null;
    }
    async function exportBackup(scope) {
      const prefs = {};
      for (const key of scope === "look" ? LOOK_KEYS : fullBackupKeys()) {
        const baseline =
          LOOK_DEFAULTS[key] ??
          ctx.PROFILE_DEFAULTS[key] ??
          (reusableBaseDefaults.has(key)
            ? window.Zentral?.Core?.defaultPrefs?.[key]
            : undefined);
        if (
          scope === "full" &&
          !Services.prefs.prefHasUserValue(key) &&
          baseline === undefined
        )
          continue;
        const type = Services.prefs.getPrefType(key);
        const fallback = baseline;
        try {
          prefs[key] =
            !Services.prefs.prefHasUserValue(key) && fallback !== undefined
              ? fallback
              : type === Services.prefs.PREF_BOOL
                ? Services.prefs.getBoolPref(key)
                : type === Services.prefs.PREF_INT
                  ? Services.prefs.getIntPref(key)
                  : type === Services.prefs.PREF_STRING
                    ? Services.prefs.getStringPref(key)
                    : fallback;
        } catch (_) {
          if (fallback !== undefined) prefs[key] = fallback;
        }
      }
      const path = await chooseBackupFile(
        Ci.nsIFilePicker.modeSave,
        "Export Zentral " + scope + " settings",
        "zentral-" +
          scope +
          "-" +
          new Date().toISOString().slice(0, 10) +
          ".json",
      );
      if (!path) return false;
      await IOUtils.writeUTF8(
        path,
        JSON.stringify(
          { format: "zentral-settings", version: 1, scope, prefs },
          null,
          2,
        ),
      );
      return true;
    }
    async function importBackup(scope) {
      const path = await chooseBackupFile(
        Ci.nsIFilePicker.modeOpen,
        "Import Zentral " + scope + " settings",
      );
      if (!path) return false;
      if ((await IOUtils.stat(path)).size > 16 * 1024 * 1024)
        throw new Error("Settings file is too large");
      const data = JSON.parse(await IOUtils.readUTF8(path));
      if (
        data?.format !== "zentral-settings" ||
        data.version !== 1 ||
        !["look", "full"].includes(data.scope) ||
        !data.prefs ||
        Array.isArray(data.prefs) ||
        typeof data.prefs !== "object"
      )
        throw new Error("Not a supported Zentral settings file");
      if (scope === "full" && data.scope !== "full")
        throw new Error("Choose a full settings export here");
      const entries = Object.entries(data.prefs);
      if (entries.length > 1500 || !entries.length)
        throw new Error("Invalid settings count");
      const changes = entries.filter(
        ([key]) => scope === "full" || LOOK_KEYS.has(key),
      );
      if (scope === "look" && !changes.length)
        throw new Error("No Look options in this file");
      for (const [key, value] of entries) {
        if (
          !ownedBackupKey(key) ||
          (data.scope === "look" && !LOOK_KEYS.has(key)) ||
          !["string", "boolean", "number"].includes(typeof value) ||
          (typeof value === "number" && !Number.isSafeInteger(value)) ||
          (typeof value === "string" && value.length > 8 * 1024 * 1024)
        )
          throw new Error("Invalid preference in settings file: " + key);
        if (LOOK_KEYS.has(key)) {
          const expected = LOOK_DEFAULTS[key];
          if (
            typeof value !== typeof expected ||
            ([
              ...LOOK_COLORS.map((name) => LOOK_PREFS[name]),
              ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
            ].includes(key) &&
              !/^#[0-9a-fA-F]{6}$/.test(value)) ||
            (LOOK_ENUMS[key] && !LOOK_ENUMS[key].includes(value)) ||
            (LOOK_BOUNDS[key] &&
              (value < LOOK_BOUNDS[key][0] || value > LOOK_BOUNDS[key][1]))
          )
            throw new Error("Invalid Look value: " + key);
        }
      }
      // Store original types as well: a malformed or interrupted write can be
      // rolled back without discarding an existing preference.
      const previous = new Map(
        changes.map(([key]) => {
          const hadUserValue = Services.prefs.prefHasUserValue(key);
          const type = Services.prefs.getPrefType(key);
          const value = hadUserValue
            ? type === Services.prefs.PREF_BOOL
              ? Services.prefs.getBoolPref(key)
              : type === Services.prefs.PREF_INT
                ? Services.prefs.getIntPref(key)
                : type === Services.prefs.PREF_STRING
                  ? Services.prefs.getStringPref(key)
                  : undefined
            : undefined;
          return [key, { hadUserValue, value }];
        }),
      );
      try {
        for (const [key, value] of changes) {
          if (
            previous.get(key).hadUserValue &&
            typeof previous.get(key).value !== typeof value
          )
            Services.prefs.clearUserPref(key);
          if (typeof value === "boolean")
            Services.prefs.setBoolPref(key, value);
          else if (typeof value === "number")
            Services.prefs.setIntPref(key, value);
          else Services.prefs.setStringPref(key, value);
        }
      } catch (error) {
        for (const [key, { hadUserValue, value }] of previous) {
          try {
            if (Services.prefs.prefHasUserValue(key))
              Services.prefs.clearUserPref(key);
            if (hadUserValue) ctx.setPref(key, value);
          } catch (_) {}
        }
        throw error;
      }
      syncAppearanceAfterImport();
      return true;
    }
    function addLookBackupControls(container) {
      const heading = document.createElement("h4");
      heading.className = "zs-look-heading";
      heading.textContent = "Import & export";
      const note = document.createElement("p");
      note.className = "zs-look-note";
      note.textContent =
        "Look files contain appearance only. Full files contain Zentral settings and panel preferences; imported values merge with your current profile. Restart Zen for changes outside Look to take full effect.";
      const actions = document.createElement("div");
      actions.className = "zs-look-actions";
      for (const [label, action, scope] of [
        ["Export Look", exportBackup, "look"],
        ["Import Look", importBackup, "look"],
        ["Export all settings", exportBackup, "full"],
        ["Import all settings", importBackup, "full"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "zs-look-action";
        button.textContent = label;
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            if (await action(scope)) window.alert(label + " complete.");
          } catch (error) {
            console.error("[Zentral] Settings transfer failed:", error);
            window.alert(label + " failed: " + error.message);
          } finally {
            button.disabled = false;
          }
        });
        actions.append(button);
      }
      container.append(heading, note, actions);
    }

    /* RSS sidebar display only. Zen owns fetching, tab creation, dismissal and
     * session state. This never moves or closes its tabs or folders. An empty
     * live folder can still contain Zen's restoration placeholder; only tabs
     * explicitly marked as placeholders may be ignored. No tabstrip subtree observer: that
     * pattern can crash Gecko during pinning (architecture note 4). */
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
          "Dock floating panels, pill menus, and resize handles opposite to active sidebar",
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
          "Show Opposite-Side Panels on Hover",
          "Requires Opposite-Side Docking. Leave a panel to hide it, then hover the outer edge to reveal it",
          ctx.BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL,
          null,
          false,
          ctx.PREF_ICONS.HOVER_EYE,
          () => ctx.syncHoverPanelAvailability(),
        );
        content.appendChild(tHoverReveal.row);

        const tEdgeAttached = createToggleRow(
          "Edge-Attached Panels",
          "Dock every floating panel flush to its current screen edge and temporarily ignore saved panel margins/position offsets; does not pin or push the webpage",
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
          (enabled) =>
            cornerSubgroup.setAttribute(
              "data-hidden",
              enabled ? "false" : "true",
            ),
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
        cornerSubgroup.setAttribute(
          "data-hidden",
          ctx.getPref(ctx.BGALAZKA_EXT_PREFS.CORNER_TILES, false)
            ? "false"
            : "true",
        );
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
            onSync: (v) =>
              cornerSubgroup.setAttribute("data-hidden", v ? "false" : "true"),
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
        const recommendedExceptions = new Set([
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
        addLookSlider(
          "Video corners",
          "0 px keeps the sidebar video square",
          LOOK_PREFS.VIDEO_RADIUS,
          0,
          24,
          " px",
        );
        const videoLookInput = lookControls.at(-1).input;
        videoLookInput.addEventListener("input", () => {
          const original = document.getElementById("zs-video-preview-radius");
          if (!original) return;
          original.value = videoLookInput.value;
          original.dispatchEvent(new Event("input", { bubbles: true }));
        });
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
          if (wasActive) modal.querySelector(".zs-tab-btn")?.click();
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
      if (baseSettings) baseSettings.textContent = "Settings";
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
    }
  });

  function element(tag, text, style) {
    const el = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    if (text != null) el.textContent = text;
    if (style) el.style.cssText = style;
    return el;
  }
  function button(text, fn) {
    const b = element(
      "button",
      text,
      "padding:7px 10px;border:1px solid #64748b;border-radius:7px;background:#253047;color:#fff;cursor:pointer",
    );
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function setFeaturePref(key, value) {
    Core.setPref(key, value);
    const apps = window.Zentral?.Apps,
      tabs = window.Zentral?.TabGroups;
    try {
      if (key.startsWith("zen.workspace.apps.")) {
        apps?.applyHideUtilitySectionPref?.();
        apps?.repositionGrid?.();
        apps?.updateAutohideState?.();
        apps?.renderGrid?.();
      }
      if (key.startsWith("zen.workspace.tabgroups.")) {
        tabs?.applyChevronPref?.();
        tabs?.applyIndicatorTypePref?.();
        tabs?.applyLabelOpacityPref?.();
      }
    } catch (error) {
      console.warn("[Zentral] Preference applied; UI refresh failed", error);
    }
  }
  function statusText(r) {
    if (r.state === "blocked") return "BLOCKED — " + r.reason;
    if (r.state === "failed") return "FAILED — " + r.error.split("\n")[0];
    return r.state.toUpperCase();
  }
  function openManager() {
    if (manager?.isConnected) {
      manager.hidden = false;
      return;
    }
    manager = element(
      "div",
      null,
      "position:fixed;inset:30px;z-index:2147483647;display:flex;flex-direction:column;gap:12px;background:#111827;color:#e5e7eb;padding:20px;border:1px solid #64748b;border-radius:14px;font:13px system-ui;box-shadow:0 12px 60px #000a;color-scheme:dark",
    );
    manager.id = "zentral-control-center";
    manager.setAttribute("role", "dialog");
    manager.setAttribute("aria-label", "Zentral settings and developer tools");
    const header = element(
      "div",
      null,
      "display:flex;gap:10px;align-items:center",
    );
    header.append(
      element(
        "strong",
        "Zentral · Settings & Developer · " + VERSION,
        "flex:1;font-size:18px",
      ),
    );
    header.append(button("Close", () => manager.remove()));
    manager.append(header);
    const nav = element("div", null, "display:flex;gap:8px;flex-wrap:wrap"),
      body = element(
        "div",
        null,
        "min-height:0;flex:1;overflow:auto;padding:4px;overscroll-behavior:contain",
      );
    const report = () => JSON.stringify(runtime.snapshot(), null, 2);
    function developer() {
      body.replaceChildren();
      body.append(
        element(
          "p",
          "File switches apply on browser restart. Normal feature settings remain live. The core and this page are always available.",
          "line-height:1.5",
        ),
      );
      const actions = element(
        "div",
        null,
        "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px",
      );
      actions.append(
        button("Refresh status", developer),
        button("Enable all files for next restart", () => {
          for (const r of records.values())
            setPref(PREF + r.id + ".enabled", true);
          for (const s of styles.values())
            setPref(PREF + "css." + s.id + ".enabled", true);
          developer();
        }),
        button("Copy diagnostics", () => {
          Services.clipboard.copyString(report());
        }),
        button("Show diagnostics", () => {
          const t = element("textarea");
          t.value = report();
          t.style.cssText = "width:98%;height:220px";
          body.prepend(t);
        }),
      );
      body.append(actions);
      body.append(
        element(
          "p",
          "Core: ACTIVE · Settings: built in · Sine entrypoint: JS/Zentral.uc.js",
          "color:#86efac",
        ),
      );
      for (const r of records.values()) {
        const card = element(
          "div",
          null,
          "border:1px solid #475569;border-radius:8px;padding:12px;margin:8px 0;display:grid;gap:7px",
        );
        const label = element(
          "label",
          null,
          "display:flex;gap:8px;align-items:center;font-weight:bold",
        );
        const input = element("input");
        input.type = "checkbox";
        input.checked = enabled(r.id);
        input.disabled = !!r.builtin;
        input.addEventListener("change", () => {
          setPref(PREF + r.id + ".enabled", input.checked);
          developer();
        });
        label.append(input, element("span", r.name + " — " + statusText(r)));
        card.append(label);
        card.append(element("div", r.file || "Built into core"));
        if (r.state === "dormant")
          card.append(element("div", r.reason, "color:#fcd34d"));
        const requires = [...(r.requires || []), ...(r.sources || [])];
        card.append(
          element(
            "div",
            "Needs: " +
              (requires.length
                ? requires
                    .map(
                      (id) => `${id} [${records.get(id)?.state || "missing"}]`,
                    )
                    .join(", ")
                : "browser only"),
            "color:#cbd5e1",
          ),
        );
        if (r.contextDependencies?.length)
          card.append(
            element(
              "div",
              "Shared panel API: " + r.contextDependencies.join(", "),
            ),
          );
        const dependents = [...records.values()]
          .filter((x) =>
            [...(x.requires || []), ...(x.sources || [])].includes(r.id),
          )
          .map((x) => x.name);
        if (dependents.length)
          card.append(
            element(
              "div",
              "Used by: " + dependents.join(", "),
              "color:#fcd34d",
            ),
          );
        card.append(element("div", r.description || ""));
        if (enabled(r.id) !== r.enabledAtStart)
          card.append(
            element("div", "Change pending restart", "color:#fcd34d"),
          );
        if (r.error) {
          const details = element("details");
          details.append(
            element("summary", "Error details"),
            element("pre", r.error, "white-space:pre-wrap"),
          );
          card.append(details);
        }
        body.append(card);
      }
      body.append(element("h3", "CSS files"));
      for (const s of styles.values()) {
        const row = element(
          "label",
          null,
          "display:flex;gap:8px;padding:8px;border-bottom:1px solid #334155",
        );
        const input = element("input");
        input.type = "checkbox";
        input.checked = getPref(PREF + "css." + s.id + ".enabled", true);
        input.addEventListener("change", () =>
          setPref(PREF + "css." + s.id + ".enabled", input.checked),
        );
        row.append(
          input,
          element("span", s.file + " — " + s.state + " · used by " + s.owner),
        );
        body.append(row);
      }
    }
    function preferences() {
      body.replaceChildren();
      const search = element("input");
      search.placeholder = "Search settings or preference keys";
      search.style.cssText =
        "box-sizing:border-box;width:100%;padding:9px;margin-bottom:10px";
      body.append(search);
      const list = element("div");
      body.append(list);
      function render() {
        list.replaceChildren();
        const query = search.value.toLowerCase();
        for (const item of SETTINGS_SCHEMA) {
          if (!item.property) {
            if (!query && item.type === "text")
              list.append(
                element(
                  "p",
                  item.label.replace(/\*\*/g, ""),
                  "font-weight:bold;margin-top:18px",
                ),
              );
            continue;
          }
          if (item.property.startsWith(PREF)) continue;
          if (
            query &&
            !`${item.label} ${item.property}`.toLowerCase().includes(query)
          )
            continue;
          const row = element(
            "label",
            null,
            "display:grid;grid-template-columns:minmax(180px,1fr) minmax(130px,35%);gap:10px;padding:9px 0;border-bottom:1px solid #334155;align-items:center",
          );
          const left = element("div", item.label);
          left.append(
            element(
              "div",
              item.property,
              "font-size:11px;color:#94a3b8;overflow-wrap:anywhere",
            ),
          );
          let input;
          if (item.type === "dropdown") {
            input = element("select");
            for (const opt of item.options || []) {
              const o = element("option", opt.label);
              o.value = String(opt.value);
              input.append(o);
            }
            input.value = String(getPref(item.property, item.defaultValue));
          } else {
            input = element("input");
            input.type =
              item.type === "checkbox"
                ? "checkbox"
                : typeof item.defaultValue === "number"
                  ? "number"
                  : "text";
            if (input.type === "checkbox")
              input.checked = getPref(item.property, item.defaultValue);
            else input.value = getPref(item.property, item.defaultValue);
          }
          input.addEventListener("change", () => {
            let value = input.type === "checkbox" ? input.checked : input.value;
            if (typeof item.defaultValue === "number") value = Number(value);
            if (typeof value === "number" && !Number.isFinite(value)) return;
            setFeaturePref(item.property, value);
          });
          row.append(left, input);
          list.append(row);
        }
      }
      search.addEventListener("input", render);
      render();
    }
    function addons() {
      body.replaceChildren();
      body.append(
        element(
          "p",
          "Add local extension features here. Each entry declares an id, JS file, optional dependencies and CSS files. Changes apply on restart. See ARCHITECTURE.md for the registration API.",
        ),
      );
      const field = element("textarea");
      field.style.cssText = "width:98%;height:250px";
      field.value = getPref("zen.workspace.zentral.addons", "[]");
      const feedback = element("p");
      body.append(
        field,
        button("Save add-on list", () => {
          try {
            const list = JSON.parse(field.value);
            validateAddons(list);
            setPref("zen.workspace.zentral.addons", JSON.stringify(list));
            feedback.textContent = "Saved for next restart.";
          } catch (e) {
            feedback.textContent = e.message;
          }
        }),
        feedback,
      );
    }
    nav.append(
      button("Feature settings", preferences),
      button("Developer & files", developer),
      button("Extension add-ons", addons),
      button("Original settings", () => {
        manager.remove();
        try {
          Settings.open();
        } catch (e) {
          console.error("[Zentral] Original settings failed", e);
          openManager();
        }
      }),
    );
    manager.append(nav, body);
    document.documentElement.append(manager);
    developer();
  }
  // Attach a route to the independent manager even when an optional settings tab fails.
  const originalOpen = Settings.open.bind(Settings);
  Settings.open = function (...args) {
    const result = originalOpen(...args);
    const modal = document.getElementById("zentral-settings-modal");
    if (modal && !modal.querySelector("#zentral-dev-open")) {
      const b = button("Developer & all settings", openManager);
      b.id = "zentral-dev-open";
      b.style.margin = "8px";
      (modal.querySelector(".zs-tab-bar") || modal).prepend(b);
    }
    return result;
  };
  const onKey = (e) => {
    if (
      e.ctrlKey &&
      e.altKey &&
      !e.shiftKey &&
      !e.metaKey &&
      e.code === "Equal" &&
      !e.getModifierState?.("AltGraph")
    ) {
      e.preventDefault();
      e.stopPropagation();
      openManager();
    }
  };
  window.addEventListener("keydown", onKey, true);
  disposers.push(() => window.removeEventListener("keydown", onKey, true));
  const menu = document.getElementById("menu_ToolsPopup");
  if (menu) {
    const item = document.createXULElement("menuitem");
    item.id = "zentral-settings-menu";
    item.setAttribute("label", "Zentral Settings & Developer");
    item.addEventListener("command", openManager);
    menu.append(item);
    disposers.push(() => item.remove());
  }
  function validateAddons(list) {
    if (!Array.isArray(list)) throw new Error("Add-ons must be an array");
    const known = new Set(MANIFEST.map((m) => m.id));
    for (const x of list) {
      if (!x || !/^addon-[a-z0-9-]+$/.test(x.id) || known.has(x.id))
        throw new Error("Use a unique id starting with addon-");
      if (!/^JS\/[A-Za-z0-9_-]+(?:\.uc)?\.js$/.test(x.file))
        throw new Error("Add-on JS must be a local JS/filename.js");
      if (x.requires && !Array.isArray(x.requires))
        throw new Error("requires must be an array");
      if (
        x.css &&
        (!Array.isArray(x.css) ||
          x.css.some((p) => !/^CSS\/[A-Za-z0-9_-]+\.css$/.test(p)))
      )
        throw new Error("CSS must contain local CSS/filename.css paths");
      known.add(x.id);
    }
    return list;
  }
  async function loadCSS(spec) {
    const row = { ...spec, state: "loading" };
    styles.set(spec.id, row);
    if (!getPref(PREF + "css." + spec.id + ".enabled", true)) {
      row.state = "disabled";
      return;
    }
    try {
      row.uri = Services.io.newURI(ROOT + spec.file);
      window.windowUtils.loadSheet(row.uri, window.windowUtils.USER_SHEET);
      row.state = "loaded";
      disposers.push(() => {
        try {
          window.windowUtils.removeSheet(
            row.uri,
            window.windowUtils.USER_SHEET,
          );
        } catch (_) {}
      });
    } catch (e) {
      row.state = "failed";
      row.error = String(e);
      console.error("[Zentral] Stylesheet failed:", spec.file, e);
    }
  }
  // Resume features when an initially disabled base engine becomes available.
  function activateReady() {
    // Topological startup with no timed retries. Independent features still start
    // when another feature is disabled, missing, throws, or has a dependency cycle.
    let progress = true;
    while (progress) {
      progress = false;
      for (const m of MANIFEST) {
        const r = records.get(m.id);
        if (m.part || !["registered", "blocked"].includes(r.state)) continue;
        const deps = m.requires || [],
          sourceDeps = m.sources || [];
        if (deps.some((id) => records.get(id)?.state !== "active")) continue;
        if (
          sourceDeps.some(
            (id) =>
              !["registered", "active", "blocked"].includes(
                records.get(id)?.state,
              ),
          )
        )
          continue;
        try {
          const cleanup = definitions.get(m.id).init({
            shared: runtime.shared,
            services: runtime.services,
            runtime,
          });
          if (cleanup && typeof cleanup.then === "function")
            throw new Error(
              "init must be synchronous; use browser-ready events within a feature",
            );
          if (typeof cleanup === "function") disposers.push(cleanup);
          else if (cleanup) {
            runtime.services[m.id] = cleanup;
            if (typeof cleanup.destroy === "function")
              disposers.push(() => cleanup.destroy());
          }
          r.state = availability.get(m.id) === false ? "dormant" : "active";
          r.reason = undefined;
        } catch (e) {
          fail(r, e);
          if (m.id === "panels") {
            try {
              runtime.panelContext?.cleanupFns
                ?.splice(0)
                .reverse()
                .forEach((fn) => {
                  try {
                    fn();
                  } catch (_) {}
                });
            } catch (_) {}
            window.BgalazkaExtensionInitialized = false;
            for (const p of MANIFEST.filter((x) => x.part)) {
              const pr = records.get(p.id);
              if (pr.state === "active") pr.state = "stopped";
            }
          }
        }
        progress = true;
        emit();
      }
    }
    for (const r of records.values())
      if (r.state === "registered" || r.state === "blocked") {
        r.state = "blocked";
        r.reason = r.part
          ? "Panel coordinator did not start"
          : [...(r.requires || []), ...(r.sources || [])]
              .filter((id) => records.get(id)?.state !== "active")
              .join(", ") || "Dependency cycle";
      }
  }
  async function boot() {
    if (ready || stopped) return;
    ready = true;
    window.clearTimeout(readinessNotice);
    let addons = [];
    try {
      addons = validateAddons(
        JSON.parse(getPref("zen.workspace.zentral.addons", "[]")),
      );
    } catch (e) {
      console.error("[Zentral] Invalid add-on list", e);
    }
    for (const a of addons)
      MANIFEST.push({
        ...a,
        name: a.name || a.id,
        description: "Local extension add-on",
      });
    for (const m of MANIFEST)
      records.set(m.id, {
        ...m,
        state: enabled(m.id) ? "pending" : "disabled",
        enabledAtStart: enabled(m.id),
      });
    const cssSpecs = [
      ...CSS_MANIFEST,
      ...addons.flatMap((a) =>
        (a.css || []).map((file, i) => ({
          id: a.id + "-" + i,
          file,
          owner: a.id,
        })),
      ),
    ];
    // Apply document-scoped user sheets synchronously in cascade order.
    for (const spec of cssSpecs) await loadCSS(spec);
    if (stopped) return;
    // First load declarations only. No feature initializes during this pass.
    for (const m of MANIFEST) {
      const r = records.get(m.id);
      if (!r.enabledAtStart) continue;
      try {
        if (m.file)
          Services.scriptloader.loadSubScript(ROOT + m.file, window, "UTF-8");
        if (!definitions.has(m.id) && !parts.has(m.id))
          throw new Error("Source did not register " + m.id);
        r.state = "registered";
      } catch (e) {
        fail(r, e);
      }
    }
    activateReady();
    console.info("[Zentral] Framework startup complete", runtime.snapshot());
    emit();
  }
  function readyNow() {
    return (
      !!window.gBrowser &&
      (!window.gBrowserInit ||
        window.gBrowserInit.delayedStartupFinished === true)
    );
  }
  const readyObserver = {
    observe(subject, topic) {
      if (subject === window && topic === "browser-delayed-startup-finished") {
        Services.obs.removeObserver(readyObserver, topic);
        boot().catch((e) =>
          console.error("[Zentral] Boot failed; settings remain available", e),
        );
      }
    },
  };
  Services.obs.addObserver(readyObserver, "browser-delayed-startup-finished");
  disposers.push(() => {
    try {
      Services.obs.removeObserver(
        readyObserver,
        "browser-delayed-startup-finished",
      );
    } catch (_) {}
  });
  const readinessNotice = window.setTimeout(() => {
    if (!ready)
      console.warn(
        "[Zentral] Waiting for browser readiness. Ctrl+Alt+= opens settings.",
      );
  }, 15000);
  disposers.push(() => window.clearTimeout(readinessNotice));
  if (readyNow())
    readyObserver.observe(window, "browser-delayed-startup-finished");
  window.addEventListener("unload", () => runtime.destroy(), { once: true });
  if (typeof window.addUnloadListener === "function")
    window.addUnloadListener(() => runtime.destroy());
})();
