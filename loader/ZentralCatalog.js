/*
 * ZENTRAL FILE GUIDE - loader/ZentralCatalog.js
 *
 * Purpose: Data catalog of feature entrypoints, required/optional panel parts, context dependencies and
 *   ordered stylesheet ownership.
 * Interaction / execution: Runtime consumes MANIFEST for source loading/activation and CSS_MANIFEST for
 *   user-origin styles; DeveloperSettings displays the same records. It does not initialize features.
 * Ownership / failure: A missing required part blocks the extended panel suite; optional parts do not. Base
 *   CSS origins and rule order are preserved; the two menu/indicator merges cross only disjoint targets.
 *   Native sidebar sizing is available independently of Apps. See VALIDATION.json for migration checks.
 * Registration: catalog
 * Loaded/created by: loader/ZentralRuntime.js
 * Direct local resource paths: loader/ZentralNativeInteraction.css;
 * extension/appearance/ZentralAppearance.css; zentral/apps/ZentralApps.uc.js;
 * zentral/apps/styles/ZentralAppMenus.css; zentral/apps/styles/ZentralAppTiles.css;
 * zentral/apps/styles/ZentralAutohideIndicators.css; zentral/apps/styles/ZentralLauncherAutohide.css;
 * zentral/apps/styles/ZentralUtilityControls.css; zentral/apps/styles/ZentralUtilityPlacement.css;
 * zentral/apps/styles/ZentralVerticalBarLayout.css;
 * zentral/apps/styles/ZentralVerticalBarPresentation.css; additional/diagnostics/ZentralLogger.uc.js;
 * zentral/groups/ZentralTabGroups.uc.js; zentral/groups/styles/ZentralGroupMenus.css;
 * zentral/groups/styles/ZentralGroupPresentation.css; zentral/groups/styles/ZentralGroupStructure.css;
 * extension/panels/ZentralPanels.css; extension/panels/ZentralPanels.uc.js;
 * extension/panels/browsers/ZentralBrowserIntegrations.css;
 * extension/panels/browsers/ZentralBrowserIntegrations.uc.js; extension/panels/corner-
 * tiles/ZentralCornerPanels.css; extension/panels/corner-tiles/ZentralCornerPanels.uc.js;
 * extension/panels/geometry/ZentralPanelGeometry.css; extension/panels/geometry/ZentralPanelGeometry.uc.js;
 * extension/panels/navigation/ZentralPanelToolbar.uc.js;
 * extension/panels/navigation/styles/ZentralPanelBackground.css;
 * extension/panels/navigation/styles/ZentralPanelToolbar.css; extension/panels/secondary-
 * views/ZentralSecondaryViews.uc.js; extension/panels/styling/ZentralPanelStyles.uc.js;
 * additional/notes/ZentralNotes.css; additional/notes/ZentralNotes.uc.js;
 * additional/rss/ZentralRssDisplay.css; additional/rss/ZentralRssDisplay.uc.js;
 * extension/settings/styles/ZentralControls.css; extension/settings/styles/ZentralSettings.css;
 * extension/settings/styles/ZentralSettingsFoundation.css; additional/tabs/ZentralTabDensity.css;
 * additional/tabs/startup/ZentralStartup.uc.js; additional/tabs/unloading/ZentralTabUnload.uc.js;
 * additional/video/ZentralVideoPreview.css; additional/video/ZentralVideoPreview.uc.js
 * Returned factory API: CSS_MANIFEST; MANIFEST
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("catalog", function () {
    // STARTUP CONTRACT FOR FUTURE FEATURES / AI:
    // One unique id and one registration-only source per feature. `requires`
    // names ACTIVE services, not file order. `sources` names prepared panel
    // parts; optional:true means absence/failure must not break the coordinator.
    // `contextDependencies` documents the panel context; it is NOT an activation
    // graph (those references can be circular). Do not sort by this field.
    // Put behavior and preference checks in the feature's init/lifecycle scope,
    // never here. Add owned CSS/settings metadata with the same id. Removing an
    // optional feature also removes its catalog/CSS/settings entries and callers;
    // removing a required service must update its dependents explicitly.
    // See loader/README.md before changing registration or startup ordering.
    const MANIFEST = [
      {
        id: "library-resize",
        name: "Experimental Library panel behavior",
        file: "additional/library/ZentralLibraryResize.uc.js",
        description:
          "Opt-in Library overlay or webpage resizing below top controls, without translating browser UI.",
      },
      {
        id: "compact-hover",
        name: "Experimental compact sidebar hover",
        file: "additional/tabs/compact-hover/ZentralCompactHover.uc.js",
        description: "Opt-in native compact sidebar hover continuity.",
      },
      {
        id: "logger",
        name: "Diagnostic logger",
        file: "additional/diagnostics/ZentralLogger.uc.js",
        description: "Console capture and diagnostic export.",
      },
      {
        id: "apps",
        name: "Apps and base panel engine",
        file: "zentral/apps/ZentralApps.uc.js",
        description: "Whole base class; owns browser and panel creation.",
      },
      {
        id: "base-bridge",
        name: "Zentral base compatibility bridge",
        file: "zentral/compatibility/ZentralBaseBridge.js",
        requires: ["apps"],
        description: "Versioned base identity and storage boundary.",
      },
      {
        id: "panel-enhancements",
        name: "Persistent floating panels and controls",
        file: "extension/panels/floating/ZentralPanelEnhancements.js",
        requires: ["panels", "base-bridge"],
        description: "Per-app placement, docking and optional controls.",
      },
      {
        id: "theme-service",
        name: "Adaptive chrome contrast",
        file: "additional/theme/ZentralThemeService.js",
        description: "Independent browser/content/system/manual theme policy.",
      },
      {
        id: "tab-groups",
        name: "Tab groups",
        file: "zentral/groups/ZentralTabGroups.uc.js",
        description: "Independent of Apps and the panel extension.",
      },
      {
        id: "geometry",
        name: "Panel geometry",
        file: "extension/panels/geometry/ZentralPanelGeometry.uc.js",
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
        file: "extension/panels/corner-tiles/ZentralCornerPanels.uc.js",
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
        file: "extension/panels/navigation/ZentralPanelToolbar.uc.js",
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
        file: "extension/panels/browsers/ZentralBrowserIntegrations.uc.js",
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
        file: "extension/panels/styling/ZentralPanelStyles.uc.js",
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
        file: "extension/panels/secondary-views/ZentralSecondaryViews.uc.js",
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
        id: "notes",
        name: "Quick notes",
        file: "additional/notes/ZentralNotes.uc.js",
        description:
          "Independent notes sheet stored as Markdown files; normal live preference switches.",
      },
      {
        id: "rss",
        name: "RSS folder display",
        file: "additional/rss/ZentralRssDisplay.uc.js",
        description:
          "Independent folder styling; normal live preference switches.",
      },
      {
        id: "startup",
        name: "Load selected tabs at startup",
        file: "additional/tabs/startup/ZentralStartup.uc.js",
        description:
          "Independent tab startup controller; waits for session and workspace restoration. Owns its stylesheet.",
      },
      {
        id: "tab-drag",
        name: "Background tab dragging",
        file: "additional/tabs/dragging/ZentralTabDrag.uc.js",
        description:
          "Independent native tab sorting without activation or waking sleeping tabs.",
      },
      {
        id: "tab-unload",
        name: "Middle-click tab unloading",
        file: "additional/tabs/unloading/ZentralTabUnload.uc.js",
        description:
          "Standalone. Requires only gBrowser and its about:config preference.",
      },
      {
        id: "panels",
        name: "Panel extension coordinator",
        file: "extension/panels/ZentralPanels.uc.js",
        requires: ["apps", "base-bridge"],
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
        file: "additional/video/ZentralVideoPreview.uc.js",
        description:
          "Independent preview. Its normal enabled preference still controls playback.",
      },
    ];
    const CSS_MANIFEST = [
      {
        id: "HybridPanels",
        file: "extension/panels/floating/ZentralFloatingPanels.css",
        owners: ["panel-enhancements"],
      },
      {
        id: "AdaptiveTheme",
        file: "additional/theme/ZentralAdaptiveTheme.css",
        owners: ["theme-service"],
      },
      {
        id: "GroupStructure",
        file: "zentral/groups/styles/ZentralGroupStructure.css",
        owners: ["tab-groups"],
        legacyControl: "Base",
      },
      {
        id: "NativeInteraction",
        file: "loader/ZentralNativeInteraction.css",
        owners: [],
        legacyControl: "Base",
      },
      {
        id: "GroupPresentation",
        file: "zentral/groups/styles/ZentralGroupPresentation.css",
        owners: ["tab-groups"],
        legacyControl: "Base",
      },
      {
        id: "AppTiles",
        file: "zentral/apps/styles/ZentralAppTiles.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "GroupMenus",
        file: "zentral/groups/styles/ZentralGroupMenus.css",
        owners: ["tab-groups"],
        legacyControl: "Base",
      },
      {
        id: "AppMenus",
        file: "zentral/apps/styles/ZentralAppMenus.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "SettingsFoundation",
        file: "extension/settings/styles/ZentralSettingsFoundation.css",
        owners: ["settings"],
        legacyControl: "Base",
      },
      {
        id: "VerticalBarLayout",
        file: "zentral/apps/styles/ZentralVerticalBarLayout.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "AutohideIndicators",
        file: "zentral/apps/styles/ZentralAutohideIndicators.css",
        owners: ["apps", "settings"],
        legacyControl: "Base",
      },
      {
        id: "VerticalBarPresentation",
        file: "zentral/apps/styles/ZentralVerticalBarPresentation.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "LauncherAutohide",
        file: "zentral/apps/styles/ZentralLauncherAutohide.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "UtilityControls",
        file: "zentral/apps/styles/ZentralUtilityControls.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "UtilityPlacement",
        file: "zentral/apps/styles/ZentralUtilityPlacement.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "Panels",
        file: "extension/panels/ZentralPanels.css",
        owners: ["panels"],
      },
      {
        id: "CornerPanels",
        file: "extension/panels/corner-tiles/ZentralCornerPanels.css",
        owners: ["corner-panels"],
      },
      {
        id: "Controls",
        file: "extension/settings/styles/ZentralControls.css",
        owners: ["panels", "settings"],
      },
      {
        id: "PanelToolbar",
        file: "extension/panels/navigation/styles/ZentralPanelToolbar.css",
        owners: ["panel-toolbar"],
      },
      {
        id: "PanelGeometry",
        file: "extension/panels/geometry/ZentralPanelGeometry.css",
        owners: ["geometry"],
      },
      {
        id: "Settings",
        file: "extension/settings/styles/ZentralSettings.css",
        owners: ["settings"],
      },
      {
        id: "BrowserIntegrations",
        file: "extension/panels/browsers/ZentralBrowserIntegrations.css",
        owners: ["browser-integrations"],
      },
      {
        id: "VideoPreview",
        file: "additional/video/ZentralVideoPreview.css",
        owners: ["video"],
      },
      {
        id: "Appearance",
        file: "extension/appearance/ZentralAppearance.css",
        owners: [],
      },
      {
        id: "Notes",
        file: "additional/notes/ZentralNotes.css",
        owners: ["notes"],
      },
      {
        id: "RssDisplay",
        file: "additional/rss/ZentralRssDisplay.css",
        owners: ["rss"],
      },
      {
        id: "TabDensity",
        file: "additional/tabs/ZentralTabDensity.css",
        owners: [],
      },
      {
        id: "PanelBackground",
        file: "extension/panels/navigation/styles/ZentralPanelBackground.css",
        owners: ["panel-toolbar"],
      },
    ];

    return { MANIFEST, CSS_MANIFEST };
  });
})();
