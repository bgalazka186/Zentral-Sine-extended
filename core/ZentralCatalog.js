/*
 * ZENTRAL FILE GUIDE - core/ZentralCatalog.js
 *
 * Purpose: Data catalog of feature entrypoints, required/optional panel parts, context dependencies and
 *   ordered stylesheet ownership.
 * Interaction / execution: Runtime consumes MANIFEST for source loading/activation and CSS_MANIFEST for
 *   user-origin styles; DeveloperSettings displays the same records. It does not initialize features.
 * Ownership / failure: A missing required part blocks the extended panel suite; optional parts do not. Base
 *   CSS origins and rule order are preserved; the two menu/indicator merges cross only disjoint targets.
 *   Native sidebar sizing is available independently of Apps. See VALIDATION.json for migration checks.
 * Registration: catalog
 * Loaded/created by: core/ZentralRuntime.js
 * Direct local resource paths: core/ZentralNativeInteraction.css;
 * features/appearance/ZentralAppearance.css; features/apps/ZentralApps.uc.js;
 * features/apps/styles/ZentralAppMenus.css; features/apps/styles/ZentralAppTiles.css;
 * features/apps/styles/ZentralAutohideIndicators.css; features/apps/styles/ZentralLauncherAutohide.css;
 * features/apps/styles/ZentralUtilityControls.css; features/apps/styles/ZentralUtilityPlacement.css;
 * features/apps/styles/ZentralVerticalBarLayout.css;
 * features/apps/styles/ZentralVerticalBarPresentation.css; features/diagnostics/ZentralLogger.uc.js;
 * features/groups/ZentralTabGroups.uc.js; features/groups/styles/ZentralGroupMenus.css;
 * features/groups/styles/ZentralGroupPresentation.css; features/groups/styles/ZentralGroupStructure.css;
 * features/panels/ZentralPanels.css; features/panels/ZentralPanels.uc.js;
 * features/panels/browsers/ZentralBrowserIntegrations.css;
 * features/panels/browsers/ZentralBrowserIntegrations.uc.js; features/panels/corner-
 * tiles/ZentralCornerPanels.css; features/panels/corner-tiles/ZentralCornerPanels.uc.js;
 * features/panels/geometry/ZentralPanelGeometry.css; features/panels/geometry/ZentralPanelGeometry.uc.js;
 * features/panels/navigation/ZentralPanelToolbar.uc.js;
 * features/panels/navigation/styles/ZentralPanelBackground.css;
 * features/panels/navigation/styles/ZentralPanelToolbar.css; features/panels/secondary-
 * views/ZentralSecondaryViews.uc.js; features/panels/styling/ZentralPanelStyles.uc.js;
 * features/rss/ZentralRssDisplay.css; features/rss/ZentralRssDisplay.uc.js;
 * features/settings/styles/ZentralControls.css; features/settings/styles/ZentralSettings.css;
 * features/settings/styles/ZentralSettingsFoundation.css; features/tabs/ZentralTabDensity.css;
 * features/tabs/startup/ZentralStartup.uc.js; features/tabs/unloading/ZentralTabUnload.uc.js;
 * features/video/ZentralVideoPreview.css; features/video/ZentralVideoPreview.uc.js
 * Returned factory API: CSS_MANIFEST; MANIFEST
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("catalog", function () {
    const MANIFEST = [
      {
        id: "compact-hover",
        name: "Experimental compact sidebar hover",
        file: "features/tabs/compact-hover/ZentralCompactHover.uc.js",
        description: "Opt-in native compact sidebar hover continuity.",
      },
      {
        id: "logger",
        name: "Diagnostic logger",
        file: "features/diagnostics/ZentralLogger.uc.js",
        description: "Console capture and diagnostic export.",
      },
      {
        id: "apps",
        name: "Apps and base panel engine",
        file: "features/apps/ZentralApps.uc.js",
        description: "Whole base class; owns browser and panel creation.",
      },
      {
        id: "tab-groups",
        name: "Tab groups",
        file: "features/groups/ZentralTabGroups.uc.js",
        description: "Independent of Apps and the panel extension.",
      },
      {
        id: "geometry",
        name: "Panel geometry",
        file: "features/panels/geometry/ZentralPanelGeometry.uc.js",
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
        file: "features/panels/corner-tiles/ZentralCornerPanels.uc.js",
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
        file: "features/panels/navigation/ZentralPanelToolbar.uc.js",
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
        file: "features/panels/browsers/ZentralBrowserIntegrations.uc.js",
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
        file: "features/panels/styling/ZentralPanelStyles.uc.js",
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
        file: "features/panels/secondary-views/ZentralSecondaryViews.uc.js",
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
        file: "features/rss/ZentralRssDisplay.uc.js",
        description:
          "Independent folder styling; normal live preference switches.",
      },
      {
        id: "startup",
        name: "Load selected tabs at startup",
        file: "features/tabs/startup/ZentralStartup.uc.js",
        description:
          "Independent tab startup controller; waits for session and workspace restoration. Owns its stylesheet.",
      },
      {
        id: "tab-drag",
        name: "Background tab dragging",
        file: "features/tabs/dragging/ZentralTabDrag.uc.js",
        description:
          "Independent native tab sorting without activation or waking sleeping tabs.",
      },
      {
        id: "tab-unload",
        name: "Middle-click tab unloading",
        file: "features/tabs/unloading/ZentralTabUnload.uc.js",
        description:
          "Standalone. Requires only gBrowser and its about:config preference.",
      },
      {
        id: "panels",
        name: "Panel extension coordinator",
        file: "features/panels/ZentralPanels.uc.js",
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
        file: "features/video/ZentralVideoPreview.uc.js",
        description:
          "Independent preview. Its normal enabled preference still controls playback.",
      },
    ];
    const CSS_MANIFEST = [
      {
        id: "GroupStructure",
        file: "features/groups/styles/ZentralGroupStructure.css",
        owners: ["tab-groups"],
        legacyControl: "Base",
      },
      {
        id: "NativeInteraction",
        file: "core/ZentralNativeInteraction.css",
        owners: [],
        legacyControl: "Base",
      },
      {
        id: "GroupPresentation",
        file: "features/groups/styles/ZentralGroupPresentation.css",
        owners: ["tab-groups"],
        legacyControl: "Base",
      },
      {
        id: "AppTiles",
        file: "features/apps/styles/ZentralAppTiles.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "GroupMenus",
        file: "features/groups/styles/ZentralGroupMenus.css",
        owners: ["tab-groups"],
        legacyControl: "Base",
      },
      {
        id: "AppMenus",
        file: "features/apps/styles/ZentralAppMenus.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "SettingsFoundation",
        file: "features/settings/styles/ZentralSettingsFoundation.css",
        owners: ["settings"],
        legacyControl: "Base",
      },
      {
        id: "VerticalBarLayout",
        file: "features/apps/styles/ZentralVerticalBarLayout.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "AutohideIndicators",
        file: "features/apps/styles/ZentralAutohideIndicators.css",
        owners: ["apps", "settings"],
        legacyControl: "Base",
      },
      {
        id: "VerticalBarPresentation",
        file: "features/apps/styles/ZentralVerticalBarPresentation.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "LauncherAutohide",
        file: "features/apps/styles/ZentralLauncherAutohide.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "UtilityControls",
        file: "features/apps/styles/ZentralUtilityControls.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "UtilityPlacement",
        file: "features/apps/styles/ZentralUtilityPlacement.css",
        owners: ["apps"],
        legacyControl: "Base",
      },
      {
        id: "Panels",
        file: "features/panels/ZentralPanels.css",
        owners: ["panels"],
      },
      {
        id: "CornerPanels",
        file: "features/panels/corner-tiles/ZentralCornerPanels.css",
        owners: ["corner-panels"],
      },
      {
        id: "Controls",
        file: "features/settings/styles/ZentralControls.css",
        owners: ["panels", "settings"],
      },
      {
        id: "PanelToolbar",
        file: "features/panels/navigation/styles/ZentralPanelToolbar.css",
        owners: ["panel-toolbar"],
      },
      {
        id: "PanelGeometry",
        file: "features/panels/geometry/ZentralPanelGeometry.css",
        owners: ["geometry"],
      },
      {
        id: "Settings",
        file: "features/settings/styles/ZentralSettings.css",
        owners: ["settings"],
      },
      {
        id: "BrowserIntegrations",
        file: "features/panels/browsers/ZentralBrowserIntegrations.css",
        owners: ["browser-integrations"],
      },
      {
        id: "VideoPreview",
        file: "features/video/ZentralVideoPreview.css",
        owners: ["video"],
      },
      {
        id: "Appearance",
        file: "features/appearance/ZentralAppearance.css",
        owners: [],
      },
      {
        id: "RssDisplay",
        file: "features/rss/ZentralRssDisplay.css",
        owners: ["rss"],
      },
      {
        id: "TabDensity",
        file: "features/tabs/ZentralTabDensity.css",
        owners: [],
      },
      {
        id: "PanelBackground",
        file: "features/panels/navigation/styles/ZentralPanelBackground.css",
        owners: ["panel-toolbar"],
      },
    ];

    return { MANIFEST, CSS_MANIFEST };
  });
})();
