/*
 * ZENTRAL FILE GUIDE - features/appearance/ZentralAppearance.js
 *
 * Purpose: Look preference definitions/themes, color/bounds validation and root attribute/CSS-variable
 *   synchronization after edits/imports.
 * Interaction / execution: FeatureSettings creates it with ctx and Services; Backup uses exported
 *   validation/default data. ZentralAppearance.css consumes the attributes/variables applied here.
 * Ownership / failure: Owns look policy rather than browser hosts or modal layout. Registered preference
 *   side effects use the caller ctx cleanup contract.
 * Registration: appearance
 * Loaded/created by: features/settings/controllers/ZentralFeatureSettings.js
 * Returned factory API: LOOK_BOUNDS; LOOK_COLORS; LOOK_DEFAULTS; LOOK_ENUMS; LOOK_GROUP_PREFS; LOOK_KEYS;
 *   LOOK_PREFS; LOOK_THEMES; LOOK_TRANSPARENCY_KEYS; applyLook; syncAppearanceAfterImport;
 *   syncChangedSetting
 * Shared ctx symbols used: BGALAZKA_EXT_PREFS; EXT_PREFS; applyAttributes; getPref;
 *   reconcileFeaturePreferences; registerCleanup; updateCSSVars
 * Cross-file calls / ctx suppliers: features/panels/ZentralPanels.uc.js -> ctx.BGALAZKA_EXT_PREFS, ctx.EXT_PREFS,
 *   ctx.applyAttributes, ctx.getPref, ctx.registerCleanup, ctx.updateCSSVars
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("appearance", function ({ ctx, Services }) {
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
      ["zen.workspace.bgalazka.blur_intensity"]: 0,
      [ctx.BGALAZKA_EXT_PREFS.PANEL_BLACK_OPACITY]: 0,
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_UNPINNED]: 100,
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS]: 95,
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR]: 90,
      [ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR]: "#5e0002",
      [ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY]: 31,
      [ctx.BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY]: 48,
      [LOOK_GROUP_PREFS.LABEL_OPACITY]: 85,
    });
    // Presets only write values that also have individual controls below.
    const LOOK_THEMES = Object.freeze([
      { name: "Default", description: "The original neutral Atelier look.", swatch: "#a5bec0", values: {} },
      {
        name: "Graphite",
        description: "Cool charcoal, quiet silver-blue accents, crisp outlines.",
        swatch: "#a9bfd7",
        values: {
          [LOOK_PREFS.CANVAS]: "#15191e",
          [LOOK_PREFS.SURFACE]: "#20262d",
          [LOOK_PREFS.RAISED]: "#2b333e",
          [LOOK_PREFS.ACCENT]: "#a9bfd7",
          [LOOK_PREFS.TEXT]: "#e8edf3",
          [LOOK_PREFS.MUTED]: "#b3bfcd",
          [LOOK_PREFS.TOOLBAR_SURFACE]: "#20262d",
          [LOOK_PREFS.TOOLBAR_URL]: "#293440",
          [LOOK_PREFS.BUTTON_SURFACE]: "#354252",
          [LOOK_PREFS.BUTTON_TEXT]: "#e8edf3",
          [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#a9bfd7",
          [LOOK_PREFS.BUTTON_STYLE]: "outline",
          [LOOK_PREFS.BUTTON_BORDER]: 1,
          [LOOK_PREFS.TILE_STYLE]: "soft",
          [LOOK_PREFS.ROW_STYLE]: "cards",
          [LOOK_PREFS.RADIUS]: 2,
          [LOOK_PREFS.VIDEO_RADIUS]: 2,
          [LOOK_PREFS.PANEL_BORDER]: 1,
          [LOOK_PREFS.TOOLBAR_BORDER]: 1,
          [LOOK_PREFS.CONTROL_SIZE]: 24,
          [LOOK_PREFS.ROW_PADDING]: 6,
          [LOOK_PREFS.VIDEO_CANVAS]: "#15191e",
          [LOOK_PREFS.VIDEO_CONTROL]: "#354252",
          [LOOK_PREFS.VIDEO_TEXT]: "#e8edf3",
          [LOOK_PREFS.VIDEO_MUTED]: "#b3bfcd",
          [LOOK_PREFS.VIDEO_SELECTED]: "#a9bfd7",
          [LOOK_PREFS.VIDEO_BORDER]: 1,
          [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "line",
        },
      },
      {
        name: "Ember",
        description: "Warm espresso surfaces with copper and soft cream.",
        swatch: "#efa876",
        values: {
          [LOOK_PREFS.CANVAS]: "#201813",
          [LOOK_PREFS.SURFACE]: "#2c211a",
          [LOOK_PREFS.RAISED]: "#3b2c22",
          [LOOK_PREFS.ACCENT]: "#efa876",
          [LOOK_PREFS.TEXT]: "#fff0df",
          [LOOK_PREFS.MUTED]: "#d0b29a",
          [LOOK_PREFS.TOOLBAR_SURFACE]: "#2c211a",
          [LOOK_PREFS.TOOLBAR_URL]: "#37271e",
          [LOOK_PREFS.BUTTON_SURFACE]: "#493025",
          [LOOK_PREFS.BUTTON_TEXT]: "#fff0df",
          [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#efa876",
          [LOOK_PREFS.BUTTON_STYLE]: "outline",
          [LOOK_PREFS.BUTTON_BORDER]: 1,
          [LOOK_PREFS.TILE_STYLE]: "soft",
          [LOOK_PREFS.ROW_STYLE]: "cards",
          [LOOK_PREFS.RADIUS]: 4,
          [LOOK_PREFS.VIDEO_RADIUS]: 4,
          [LOOK_PREFS.PANEL_BORDER]: 1,
          [LOOK_PREFS.TOOLBAR_BORDER]: 1,
          [LOOK_PREFS.CONTROL_SIZE]: 24,
          [LOOK_PREFS.ROW_PADDING]: 6,
          [LOOK_PREFS.VIDEO_CANVAS]: "#201813",
          [LOOK_PREFS.VIDEO_CONTROL]: "#493025",
          [LOOK_PREFS.VIDEO_TEXT]: "#fff0df",
          [LOOK_PREFS.VIDEO_MUTED]: "#d0b29a",
          [LOOK_PREFS.VIDEO_SELECTED]: "#efa876",
          [LOOK_PREFS.VIDEO_BORDER]: 1,
          [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "line",
        },
      },
      {
        name: "Fern",
        description: "Deep forest greens and pale sage, with softer filled controls.",
        swatch: "#acd5ad",
        values: {
          [LOOK_PREFS.CANVAS]: "#111d17",
          [LOOK_PREFS.SURFACE]: "#1a2a21",
          [LOOK_PREFS.RAISED]: "#253a2d",
          [LOOK_PREFS.ACCENT]: "#acd5ad",
          [LOOK_PREFS.TEXT]: "#edf6eb",
          [LOOK_PREFS.MUTED]: "#b3c9b6",
          [LOOK_PREFS.TOOLBAR_SURFACE]: "#1a2a21",
          [LOOK_PREFS.TOOLBAR_URL]: "#23382b",
          [LOOK_PREFS.BUTTON_SURFACE]: "#304b39",
          [LOOK_PREFS.BUTTON_TEXT]: "#edf6eb",
          [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#acd5ad",
          [LOOK_PREFS.BUTTON_STYLE]: "filled",
          [LOOK_PREFS.BUTTON_BORDER]: 0,
          [LOOK_PREFS.TILE_STYLE]: "soft",
          [LOOK_PREFS.ROW_STYLE]: "cards",
          [LOOK_PREFS.RADIUS]: 6,
          [LOOK_PREFS.VIDEO_RADIUS]: 6,
          [LOOK_PREFS.PANEL_BORDER]: 1,
          [LOOK_PREFS.TOOLBAR_BORDER]: 1,
          [LOOK_PREFS.CONTROL_SIZE]: 24,
          [LOOK_PREFS.ROW_PADDING]: 6,
          [LOOK_PREFS.VIDEO_CANVAS]: "#111d17",
          [LOOK_PREFS.VIDEO_CONTROL]: "#304b39",
          [LOOK_PREFS.VIDEO_TEXT]: "#edf6eb",
          [LOOK_PREFS.VIDEO_MUTED]: "#b3c9b6",
          [LOOK_PREFS.VIDEO_SELECTED]: "#acd5ad",
          [LOOK_PREFS.VIDEO_BORDER]: 1,
          [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "filled",
        },
      },
      {
        name: "Tide",
        description: "Inky ocean blue with bright sea-glass accents.",
        swatch: "#7dd5de",
        values: {
          [LOOK_PREFS.CANVAS]: "#101c28",
          [LOOK_PREFS.SURFACE]: "#192a3c",
          [LOOK_PREFS.RAISED]: "#243c50",
          [LOOK_PREFS.ACCENT]: "#7dd5de",
          [LOOK_PREFS.TEXT]: "#e8f3f8",
          [LOOK_PREFS.MUTED]: "#adc6d5",
          [LOOK_PREFS.TOOLBAR_SURFACE]: "#192a3c",
          [LOOK_PREFS.TOOLBAR_URL]: "#213747",
          [LOOK_PREFS.BUTTON_SURFACE]: "#294957",
          [LOOK_PREFS.BUTTON_TEXT]: "#e8f3f8",
          [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#7dd5de",
          [LOOK_PREFS.BUTTON_STYLE]: "outline",
          [LOOK_PREFS.BUTTON_BORDER]: 1,
          [LOOK_PREFS.TILE_STYLE]: "soft",
          [LOOK_PREFS.ROW_STYLE]: "cards",
          [LOOK_PREFS.RADIUS]: 6,
          [LOOK_PREFS.VIDEO_RADIUS]: 6,
          [LOOK_PREFS.PANEL_BORDER]: 1,
          [LOOK_PREFS.TOOLBAR_BORDER]: 1,
          [LOOK_PREFS.CONTROL_SIZE]: 24,
          [LOOK_PREFS.ROW_PADDING]: 6,
          [LOOK_PREFS.VIDEO_CANVAS]: "#101c28",
          [LOOK_PREFS.VIDEO_CONTROL]: "#294957",
          [LOOK_PREFS.VIDEO_TEXT]: "#e8f3f8",
          [LOOK_PREFS.VIDEO_MUTED]: "#adc6d5",
          [LOOK_PREFS.VIDEO_SELECTED]: "#7dd5de",
          [LOOK_PREFS.VIDEO_BORDER]: 1,
          [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "line",
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
        name: "Amethyst",
        description: "Muted plum, lavender accents and gently rounded cards.",
        swatch: "#d7b4ed",
        values: {
          [LOOK_PREFS.CANVAS]: "#211a2a",
          [LOOK_PREFS.SURFACE]: "#2e233b",
          [LOOK_PREFS.RAISED]: "#40324f",
          [LOOK_PREFS.ACCENT]: "#d7b4ed",
          [LOOK_PREFS.TEXT]: "#f6edf9",
          [LOOK_PREFS.MUTED]: "#c8b5d1",
          [LOOK_PREFS.TOOLBAR_SURFACE]: "#2e233b",
          [LOOK_PREFS.TOOLBAR_URL]: "#3b2c4a",
          [LOOK_PREFS.BUTTON_SURFACE]: "#513c61",
          [LOOK_PREFS.BUTTON_TEXT]: "#f6edf9",
          [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#d7b4ed",
          [LOOK_PREFS.BUTTON_STYLE]: "filled",
          [LOOK_PREFS.BUTTON_BORDER]: 0,
          [LOOK_PREFS.TILE_STYLE]: "soft",
          [LOOK_PREFS.ROW_STYLE]: "cards",
          [LOOK_PREFS.RADIUS]: 8,
          [LOOK_PREFS.VIDEO_RADIUS]: 8,
          [LOOK_PREFS.PANEL_BORDER]: 1,
          [LOOK_PREFS.TOOLBAR_BORDER]: 1,
          [LOOK_PREFS.CONTROL_SIZE]: 24,
          [LOOK_PREFS.ROW_PADDING]: 6,
          [LOOK_PREFS.VIDEO_CANVAS]: "#211a2a",
          [LOOK_PREFS.VIDEO_CONTROL]: "#513c61",
          [LOOK_PREFS.VIDEO_TEXT]: "#f6edf9",
          [LOOK_PREFS.VIDEO_MUTED]: "#c8b5d1",
          [LOOK_PREFS.VIDEO_SELECTED]: "#d7b4ed",
          [LOOK_PREFS.VIDEO_BORDER]: 1,
          [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "filled",
        },
      },
      {
        name: "Paper",
        description: "Warm ivory, dark ink and restrained olive accents.",
        swatch: "#486454",
        values: {
          [LOOK_PREFS.CANVAS]: "#e9e5dc",
          [LOOK_PREFS.SURFACE]: "#f7f3eb",
          [LOOK_PREFS.RAISED]: "#ded8cc",
          [LOOK_PREFS.ACCENT]: "#486454",
          [LOOK_PREFS.TEXT]: "#252c27",
          [LOOK_PREFS.MUTED]: "#58655b",
          [LOOK_PREFS.TOOLBAR_SURFACE]: "#f7f3eb",
          [LOOK_PREFS.TOOLBAR_URL]: "#ebe5d9",
          [LOOK_PREFS.BUTTON_SURFACE]: "#ddd8cb",
          [LOOK_PREFS.BUTTON_TEXT]: "#252c27",
          [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#486454",
          [LOOK_PREFS.BUTTON_STYLE]: "outline",
          [LOOK_PREFS.BUTTON_BORDER]: 1,
          [LOOK_PREFS.TILE_STYLE]: "soft",
          [LOOK_PREFS.ROW_STYLE]: "cards",
          [LOOK_PREFS.RADIUS]: 4,
          [LOOK_PREFS.VIDEO_RADIUS]: 4,
          [LOOK_PREFS.PANEL_BORDER]: 1,
          [LOOK_PREFS.TOOLBAR_BORDER]: 1,
          [LOOK_PREFS.CONTROL_SIZE]: 24,
          [LOOK_PREFS.ROW_PADDING]: 6,
          [LOOK_PREFS.VIDEO_CANVAS]: "#e9e5dc",
          [LOOK_PREFS.VIDEO_CONTROL]: "#ddd8cb",
          [LOOK_PREFS.VIDEO_TEXT]: "#252c27",
          [LOOK_PREFS.VIDEO_MUTED]: "#58655b",
          [LOOK_PREFS.VIDEO_SELECTED]: "#486454",
          [LOOK_PREFS.VIDEO_BORDER]: 1,
          [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "line",
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
      ["zen.workspace.bgalazka.blur_intensity"]: [0, 40],
      [ctx.BGALAZKA_EXT_PREFS.PANEL_BLACK_OPACITY]: [0, 100],
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
        if (key === "FOLDER_ICON_SIZE")
          root.style.setProperty("--bgalazka-look-folder-icon-scale", String(clamped / 20));
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

    function syncChangedSetting(key) {
      ctx.reconcileFeaturePreferences?.(key);
      syncAppearanceAfterImport([key]);
    }
    function syncAppearanceAfterImport(keys = null) {
      const changed = (key) => !keys || keys.includes(key);
      const lookChanged = !keys || keys.some((key) => LOOK_KEYS.has(key));
      if (lookChanged) applyLook();
      if (
        !keys ||
        keys.some((key) => key.startsWith("zen.workspace.bgalazka."))
      ) {
        ctx.updateCSSVars();
        ctx.applyAttributes();
      }
      if (
        !keys ||
        keys.some((key) => key.startsWith("zen.workspace.tabgroups."))
      ) {
        window.Zentral?.TabGroups?.applyLabelOpacityPref?.();
        window.Zentral?.TabGroups?.applyChevronPref?.();
        window.Zentral?.TabGroups?.applyIndicatorTypePref?.();
      }
      if (
        !keys ||
        keys.some((key) =>
          Object.hasOwn(window.Zentral?.Core?.defaultPrefs || {}, key),
        )
      )
        window.Zentral?.Settings?.populate?.();
      if (changed(LOOK_PREFS.VIDEO_RADIUS)) {
        const videoRadius = document.getElementById("zs-video-preview-radius");
        if (videoRadius) {
          videoRadius.value = ctx.getPref(LOOK_PREFS.VIDEO_RADIUS, 0);
        }
      }
      const panel = document.getElementById("zs-panel-bgalazka");
      panel?._toggles?.forEach(({ input, pref, def, onSync, isSelect }) => {
        if (!changed(pref)) return;
        const value = ctx.getPref(pref, def);
        if (isSelect) input.value = value;
        else input.checked = value;
        onSync?.(value);
      });
      if (lookChanged)
        document.getElementById("zs-panel-extension-look")?._syncLook?.();
    }

    return {
      LOOK_GROUP_PREFS,
      LOOK_PREFS,
      LOOK_DEFAULTS,
      LOOK_THEMES,
      LOOK_KEYS,
      LOOK_TRANSPARENCY_KEYS,
      LOOK_COLORS,
      LOOK_ENUMS,
      LOOK_BOUNDS,
      applyLook,
      syncChangedSetting,
      syncAppearanceAfterImport,
    };
  });
})();
