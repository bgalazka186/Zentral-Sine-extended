/*
 * ZENTRAL FILE GUIDE - extension/appearance/ZentralAppearance.js
 *
 * Purpose: Look preference definitions/themes, color/bounds validation and root attribute/CSS-variable
 *   synchronization after edits/imports.
 * Interaction / execution: FeatureSettings creates it with ctx and Services; Backup uses exported
 *   validation/default data. ZentralAppearance.css consumes the attributes/variables applied here.
 * Ownership / failure: Owns look policy rather than browser hosts or modal layout. Registered preference
 *   side effects use the caller ctx cleanup contract.
 * Registration: appearance
 * Loaded/created by: extension/settings/controllers/ZentralFeatureSettings.js
 * Returned factory API: LOOK_BOUNDS; LOOK_COLORS; LOOK_DEFAULTS; LOOK_ENUMS; LOOK_GROUP_PREFS; LOOK_KEYS;
 *   LOOK_OPTIONAL_COLORS; LOOK_PREFS; LOOK_THEMES; LOOK_TRANSPARENCY_KEYS; applyLook;
 *   syncAppearanceAfterImport; syncChangedSetting
 * Shared ctx symbols used: BGALAZKA_EXT_PREFS; EXT_PREFS; applyAttributes; getPref;
 *   reconcileFeaturePreferences; registerCleanup; updateCSSVars
 * Cross-file calls / ctx suppliers: extension/panels/ZentralPanels.uc.js -> ctx.BGALAZKA_EXT_PREFS, ctx.EXT_PREFS,
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
      VIDEO_CONTROLS_WRAP: "zen.workspace.bgalazka.look.video_controls_wrap",
      VIDEO_CONTROLS_GAP: "zen.workspace.bgalazka.look.video_controls_gap",
      CONTROL_STRENGTH: "zen.workspace.bgalazka.look.control_strength",
      SOLID_CONTROLS: "zen.workspace.bgalazka.look.solid_controls",
      STYLE: "zen.workspace.bgalazka.look.style",
      PALETTE_MODE: "zen.workspace.bgalazka.look.palette_mode",
      TEXT_MODE: "zen.workspace.bgalazka.look.text_mode",
      PRIMARY_OPACITY: "zen.workspace.bgalazka.look.primary_opacity",
      PRIMARY: "zen.workspace.bgalazka.look.primary",
      SECONDARY: "zen.workspace.bgalazka.look.secondary",
      SETTINGS_CANVAS: "zen.workspace.bgalazka.look.settings_canvas",
      SETTINGS_HEADER: "zen.workspace.bgalazka.look.settings_header",
      SETTINGS_NAV: "zen.workspace.bgalazka.look.settings_nav",
      SETTINGS_CARD: "zen.workspace.bgalazka.look.settings_card",
      SETTINGS_TEXT: "zen.workspace.bgalazka.look.settings_text",
      SETTINGS_MUTED: "zen.workspace.bgalazka.look.settings_muted",
      INPUT_SURFACE: "zen.workspace.bgalazka.look.input_surface",
      INPUT_TEXT: "zen.workspace.bgalazka.look.input_text",
      BUTTON_HOVER: "zen.workspace.bgalazka.look.button_hover",
      BUTTON_HOVER_TEXT: "zen.workspace.bgalazka.look.button_hover_text",
      SELECTED_SURFACE: "zen.workspace.bgalazka.look.selected_surface",
      SELECTED_TEXT: "zen.workspace.bgalazka.look.selected_text",
      POPUP_SURFACE: "zen.workspace.bgalazka.look.popup_surface",
      POPUP_TEXT: "zen.workspace.bgalazka.look.popup_text",
      SUCCESS: "zen.workspace.bgalazka.look.success",
      WARNING: "zen.workspace.bgalazka.look.warning",
      DANGER: "zen.workspace.bgalazka.look.danger",
      WEB_SURFACE: "zen.workspace.bgalazka.look.web_surface",
      WEB_OPACITY: "zen.workspace.bgalazka.look.web_opacity",
      BACKDROP: "zen.workspace.bgalazka.look.backdrop",
      BACKDROP_OPACITY: "zen.workspace.bgalazka.look.backdrop_opacity",
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
      VIDEO_OVERLAY_OPACITY:
        "zen.workspace.bgalazka.look.video_overlay_opacity",
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
      RSS_CARD_WIDTH: "zen.workspace.bgalazka.look.rss_card_width",
      RSS_CARD_MAX_HEIGHT: "zen.workspace.bgalazka.look.rss_card_max_height",
      RSS_CARD_FONT_SIZE: "zen.workspace.bgalazka.look.rss_card_font_size",
      RSS_CARD_LINE_HEIGHT: "zen.workspace.bgalazka.look.rss_card_line_height",
      RSS_CARD_PADDING: "zen.workspace.bgalazka.look.rss_card_padding",
      RSS_CARD_RADIUS: "zen.workspace.bgalazka.look.rss_card_radius",
      RSS_CARD_BORDER: "zen.workspace.bgalazka.look.rss_card_border",
      RSS_CARD_OPACITY: "zen.workspace.bgalazka.look.rss_card_opacity",
      RSS_CARD_BUTTON_RADIUS:
        "zen.workspace.bgalazka.look.rss_card_button_radius",
      RSS_CARD_GAP: "zen.workspace.bgalazka.look.rss_card_gap",
      RSS_CARD_SHADOW: "zen.workspace.bgalazka.look.rss_card_shadow",
      RSS_CARD_FONT: "zen.workspace.bgalazka.look.rss_card_font",
      RSS_CARD_BACKGROUND: "zen.workspace.bgalazka.look.rss_card_background",
      RSS_CARD_TEXT: "zen.workspace.bgalazka.look.rss_card_text",
      RSS_CARD_URL: "zen.workspace.bgalazka.look.rss_card_url",
      RSS_CARD_BORDER_COLOR: "zen.workspace.bgalazka.look.rss_card_border_color",
      RSS_CARD_BUTTON_BACKGROUND:
        "zen.workspace.bgalazka.look.rss_card_button_background",
      RSS_CARD_BUTTON_TEXT: "zen.workspace.bgalazka.look.rss_card_button_text",
    });
    const LOOK_DEFAULTS = Object.freeze({
      [LOOK_PREFS.VIDEO_CONTROLS_WRAP]: false,
      [LOOK_PREFS.VIDEO_CONTROLS_GAP]: 1,
      [LOOK_PREFS.SOLID_CONTROLS]: true,
      [LOOK_PREFS.CONTROL_STRENGTH]: 100,
      [LOOK_PREFS.STYLE]: "atelier",
      [LOOK_PREFS.PALETTE_MODE]: "simple",
      [LOOK_PREFS.TEXT_MODE]: "auto",
      [LOOK_PREFS.PRIMARY_OPACITY]: 100,
      [LOOK_PREFS.PRIMARY]: "#17191b",
      [LOOK_PREFS.SECONDARY]: "#a5bec0",
      [LOOK_PREFS.SETTINGS_CANVAS]: "#17191b",
      [LOOK_PREFS.SETTINGS_HEADER]: "#202224",
      [LOOK_PREFS.SETTINGS_NAV]: "#202224",
      [LOOK_PREFS.SETTINGS_CARD]: "#202224",
      [LOOK_PREFS.SETTINGS_TEXT]: "#dce0e1",
      [LOOK_PREFS.SETTINGS_MUTED]: "#a4aaad",
      [LOOK_PREFS.INPUT_SURFACE]: "#292c2e",
      [LOOK_PREFS.INPUT_TEXT]: "#dce0e1",
      [LOOK_PREFS.BUTTON_HOVER]: "#2b2e31",
      [LOOK_PREFS.BUTTON_HOVER_TEXT]: "#dce0e1",
      [LOOK_PREFS.SELECTED_SURFACE]: "#48616a",
      [LOOK_PREFS.SELECTED_TEXT]: "#ffffff",
      [LOOK_PREFS.POPUP_SURFACE]: "#202224",
      [LOOK_PREFS.POPUP_TEXT]: "#dce0e1",
      [LOOK_PREFS.SUCCESS]: "#86efac",
      [LOOK_PREFS.WARNING]: "#fcd34d",
      [LOOK_PREFS.DANGER]: "#ff6b6b",
      [LOOK_PREFS.WEB_SURFACE]: "#202224",
      [LOOK_PREFS.WEB_OPACITY]: 100,
      [LOOK_PREFS.BACKDROP]: "#000000",
      [LOOK_PREFS.BACKDROP_OPACITY]: 75,
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
      [LOOK_PREFS.VIDEO_OVERLAY_OPACITY]: 40,
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
      [LOOK_PREFS.RSS_CARD_WIDTH]: 340,
      [LOOK_PREFS.RSS_CARD_MAX_HEIGHT]: 60,
      [LOOK_PREFS.RSS_CARD_FONT_SIZE]: 13,
      [LOOK_PREFS.RSS_CARD_LINE_HEIGHT]: 145,
      [LOOK_PREFS.RSS_CARD_PADDING]: 12,
      [LOOK_PREFS.RSS_CARD_RADIUS]: 10,
      [LOOK_PREFS.RSS_CARD_BORDER]: 1,
      [LOOK_PREFS.RSS_CARD_OPACITY]: 100,
      [LOOK_PREFS.RSS_CARD_BUTTON_RADIUS]: 6,
      [LOOK_PREFS.RSS_CARD_GAP]: 6,
      [LOOK_PREFS.RSS_CARD_SHADOW]: "soft",
      [LOOK_PREFS.RSS_CARD_FONT]: "system",
      [LOOK_PREFS.RSS_CARD_BACKGROUND]: "",
      [LOOK_PREFS.RSS_CARD_TEXT]: "",
      [LOOK_PREFS.RSS_CARD_URL]: "",
      [LOOK_PREFS.RSS_CARD_BORDER_COLOR]: "",
      [LOOK_PREFS.RSS_CARD_BUTTON_BACKGROUND]: "",
      [LOOK_PREFS.RSS_CARD_BUTTON_TEXT]: "",
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
    const LOOK_THEMES = Object.freeze(
      [
        {
          name: "Default",
          description: "Quiet graphite, flat controls and minimal decoration.",
          swatch: "#a5bec0",
          values: {},
        },
        {
          name: "Tide",
          description: "Rounded cards, soft depth and sea-glass highlights.",
          swatch: "#7dd5de",
          values: {
            [LOOK_PREFS.RADIUS]: 14,
            [LOOK_PREFS.DEPTH]: 22,
            [LOOK_PREFS.BUTTON_STYLE]: "filled",
            [LOOK_PREFS.TILE_STYLE]: "soft",
            [LOOK_PREFS.ROW_STYLE]: "cards",
            [LOOK_PREFS.VIDEO_RADIUS]: 12,
            [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "filled",
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
            [LOOK_PREFS.VIDEO_CANVAS]: "#101c28",
            [LOOK_PREFS.VIDEO_CONTROL]: "#294957",
            [LOOK_PREFS.VIDEO_TEXT]: "#e8f3f8",
            [LOOK_PREFS.VIDEO_MUTED]: "#adc6d5",
            [LOOK_PREFS.VIDEO_SELECTED]: "#7dd5de",
          },
        },
        {
          name: "Transparent",
          description: "A light frame with 90–95% transparent panel surfaces.",
          swatch: "#ffffff",
          values: {
            [LOOK_PREFS.CONTROL_STRENGTH]: 5,
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
            [LOOK_PREFS.SURFACE_OPACITY]: 5,
            [LOOK_PREFS.RAISED_OPACITY]: 5,
            [LOOK_PREFS.TOOLBAR_OPACITY]: 5,
            [LOOK_PREFS.ADDRESS_OPACITY]: 5,
            [LOOK_PREFS.BUTTON_OPACITY]: 5,
            [LOOK_PREFS.TILE_OPACITY]: 5,
            [LOOK_PREFS.VIDEO_OPACITY]: 5,
            [LOOK_PREFS.VIDEO_CONTROL_OPACITY]: 5,
            [LOOK_PREFS.POPUP_OPACITY]: 10,
          },
        },
        {
          name: "Paper",
          description: "Warm ivory, dark ink and restrained olive accents.",
          swatch: "#486454",
          values: {
            [LOOK_PREFS.CONTROL_STRENGTH]: 100,
            [LOOK_PREFS.SURFACE_OPACITY]: 100,
            [LOOK_PREFS.TOOLBAR_OPACITY]: 100,
            [LOOK_PREFS.ADDRESS_OPACITY]: 100,
            [LOOK_PREFS.VIDEO_OPACITY]: 100,
            [LOOK_PREFS.VIDEO_CONTROL_OPACITY]: 100,
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
            [LOOK_PREFS.VIDEO_CANVAS]: "#e9e5dc",
            [LOOK_PREFS.VIDEO_CONTROL]: "#ddd8cb",
            [LOOK_PREFS.VIDEO_TEXT]: "#252c27",
            [LOOK_PREFS.VIDEO_MUTED]: "#58655b",
            [LOOK_PREFS.VIDEO_SELECTED]: "#486454",
          },
        },
        {
          name: "Blueprint",
          description:
            "Crisp outlines, squared corners and precise blue accents.",
          swatch: "#8cb9f5",
          values: {
            [LOOK_PREFS.CANVAS]: "#111c2c",
            [LOOK_PREFS.SURFACE]: "#19283b",
            [LOOK_PREFS.RAISED]: "#24364d",
            [LOOK_PREFS.ACCENT]: "#8cb9f5",
            [LOOK_PREFS.TEXT]: "#e4edf9",
            [LOOK_PREFS.MUTED]: "#adbed5",
            [LOOK_PREFS.TOOLBAR_SURFACE]: "#19283b",
            [LOOK_PREFS.TOOLBAR_URL]: "#24364d",
            [LOOK_PREFS.BUTTON_SURFACE]: "#19283b",
            [LOOK_PREFS.BUTTON_TEXT]: "#e4edf9",
            [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#8cb9f5",
            [LOOK_PREFS.RADIUS]: 2,
            [LOOK_PREFS.PANEL_BORDER]: 1,
            [LOOK_PREFS.TOOLBAR_BORDER]: 1,
            [LOOK_PREFS.BUTTON_BORDER]: 1,
            [LOOK_PREFS.BUTTON_STYLE]: "outline",
            [LOOK_PREFS.TILE_STYLE]: "soft",
            [LOOK_PREFS.ROW_STYLE]: "lines",
            [LOOK_PREFS.ROW_RULE]: 1,
            [LOOK_PREFS.VIDEO_RADIUS]: 2,
            [LOOK_PREFS.VIDEO_BORDER]: 1,
            [LOOK_PREFS.VIDEO_CANVAS]: "#111c2c",
            [LOOK_PREFS.VIDEO_CONTROL]: "#19283b",
            [LOOK_PREFS.VIDEO_TEXT]: "#e4edf9",
            [LOOK_PREFS.VIDEO_MUTED]: "#adbed5",
            [LOOK_PREFS.VIDEO_SELECTED]: "#8cb9f5",
          },
        },
      ]
        .map(completeTheme)
        .sort(
          (a, b) =>
            ["Default", "Paper", "Transparent", "Tide", "Blueprint"].indexOf(
              a.name,
            ) -
            ["Default", "Paper", "Transparent", "Tide", "Blueprint"].indexOf(
              b.name,
            ),
        ),
    );
    // Decorative styles belong to a theme; density, dimensions and behavior do not.
    const themeStyleKeys = new Set(
      [
        "RADIUS",
        "DEPTH",
        "PANEL_BORDER",
        "TOOLBAR_BORDER",
        "BUTTON_BORDER",
        "BUTTON_STYLE",
        "TILE_STYLE",
        "ROW_STYLE",
        "ROW_RULE",
        "VIDEO_RADIUS",
        "VIDEO_BORDER",
        "VIDEO_SOURCE_STYLE",
      ].map((name) => LOOK_PREFS[name]),
    );
    function completeTheme(theme) {
      if (theme.name === "Default")
        return Object.freeze({ ...theme, values: LOOK_DEFAULTS });
      const value = (key) => {
        const fallback = LOOK_DEFAULTS[LOOK_PREFS[key]];
        const candidate = theme.values[LOOK_PREFS[key]] ?? fallback;
        if (typeof fallback === "string" && fallback.startsWith("#"))
          return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate : fallback;
        return typeof fallback === "number" && !Number.isFinite(candidate)
          ? fallback
          : candidate;
      };
      const canvas = value("CANVAS"),
        surface = value("SURFACE"),
        raised = value("RAISED");
      const light = luminance(canvas) > 0.45;
      return Object.freeze({
        ...theme,
        values: Object.freeze({
          ...theme.values,
          [LOOK_PREFS.BACKDROP]: mix(canvas, "#000000", 0.85),
          [LOOK_PREFS.BACKDROP_OPACITY]: 75,
          [LOOK_PREFS.WEB_SURFACE]: light ? "#000000" : surface,
          [LOOK_PREFS.WEB_OPACITY]: light ? 70 : value("SURFACE_OPACITY"),
          [LOOK_PREFS.PALETTE_MODE]: "simple",
          [LOOK_PREFS.TEXT_MODE]: "auto",
          [LOOK_PREFS.PRIMARY]: canvas,
          [LOOK_PREFS.SECONDARY]: value("ACCENT"),
          [LOOK_PREFS.PRIMARY_OPACITY]: value("SURFACE_OPACITY"),
          [LOOK_PREFS.SETTINGS_CANVAS]: canvas,
          [LOOK_PREFS.SETTINGS_HEADER]: surface,
          [LOOK_PREFS.SETTINGS_NAV]: surface,
          [LOOK_PREFS.SETTINGS_CARD]: surface,
          [LOOK_PREFS.SETTINGS_TEXT]: value("TEXT"),
          [LOOK_PREFS.SETTINGS_MUTED]: value("MUTED"),
          [LOOK_PREFS.INPUT_SURFACE]: raised,
          [LOOK_PREFS.INPUT_TEXT]: value("TEXT"),
          [LOOK_PREFS.BUTTON_HOVER]: raised,
          [LOOK_PREFS.BUTTON_HOVER_TEXT]: value("TEXT"),
          [LOOK_PREFS.SELECTED_SURFACE]: value("ACCENT"),
          [LOOK_PREFS.SELECTED_TEXT]: contrastText(value("ACCENT")),
          [LOOK_PREFS.POPUP_SURFACE]: surface,
          [LOOK_PREFS.POPUP_TEXT]: value("TEXT"),
          [LOOK_PREFS.SUCCESS]: light ? "#17633b" : "#86efac",
          [LOOK_PREFS.WARNING]: light ? "#755100" : "#fcd34d",
          [LOOK_PREFS.DANGER]: light ? "#a32232" : "#ff6b6b",
        }),
      });
    }
    const LOOK_KEYS = new Set(Object.keys(LOOK_DEFAULTS));
    const LOOK_TRANSPARENCY_KEYS = new Set([
      LOOK_PREFS.PRIMARY_OPACITY,
      LOOK_PREFS.BACKDROP_OPACITY,
      LOOK_PREFS.WEB_OPACITY,
      LOOK_PREFS.SURFACE_OPACITY,
      LOOK_PREFS.RAISED_OPACITY,
      LOOK_PREFS.TOOLBAR_OPACITY,
      LOOK_PREFS.ADDRESS_OPACITY,
      LOOK_PREFS.BUTTON_OPACITY,
      LOOK_PREFS.TILE_OPACITY,
      LOOK_PREFS.VIDEO_OPACITY,
      LOOK_PREFS.VIDEO_OVERLAY_OPACITY,
      LOOK_PREFS.VIDEO_CONTROL_OPACITY,
      LOOK_PREFS.POPUP_OPACITY,
    ]);
    // One schema drives import validation, live CSS variables and visible
    // controls. New Look values belong here and in the Look panel below.
    const LOOK_COLORS = [
      "BACKDROP",
      "WEB_SURFACE",
      "PRIMARY",
      "SECONDARY",
      "SETTINGS_CANVAS",
      "SETTINGS_HEADER",
      "SETTINGS_NAV",
      "SETTINGS_CARD",
      "SETTINGS_TEXT",
      "SETTINGS_MUTED",
      "INPUT_SURFACE",
      "INPUT_TEXT",
      "BUTTON_HOVER",
      "BUTTON_HOVER_TEXT",
      "SELECTED_SURFACE",
      "SELECTED_TEXT",
      "POPUP_SURFACE",
      "POPUP_TEXT",
      "SUCCESS",
      "WARNING",
      "DANGER",

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
      [LOOK_PREFS.PALETTE_MODE]: ["simple", "detailed"],
      [LOOK_PREFS.TEXT_MODE]: ["auto", "manual"],
      [LOOK_PREFS.SPACING]: ["compact", "comfortable", "airy"],
      [LOOK_PREFS.BUTTON_STYLE]: ["plain", "filled", "outline"],
      [LOOK_PREFS.TILE_STYLE]: ["bare", "soft"],
      [LOOK_PREFS.ROW_STYLE]: ["lines", "cards"],
      [LOOK_PREFS.VIDEO_SOURCE_STYLE]: ["line", "filled"],
      [LOOK_PREFS.RSS_CARD_SHADOW]: ["none", "soft", "strong"],
      [LOOK_PREFS.RSS_CARD_FONT]: ["system", "serif", "mono"],
      [LOOK_GROUP_PREFS.INDICATOR_TYPE]: ["circle", "chevron"],
    });
    // Optional colors accept an empty value: the card then follows the theme
    // token instead of a hard-coded color. Import validation must allow it.
    const RSS_CARD_COLOR_NAMES = Object.freeze([
      "BACKGROUND",
      "TEXT",
      "URL",
      "BORDER_COLOR",
      "BUTTON_BACKGROUND",
      "BUTTON_TEXT",
    ]);
    const LOOK_OPTIONAL_COLORS = new Set(
      RSS_CARD_COLOR_NAMES.map((name) => LOOK_PREFS["RSS_CARD_" + name]),
    );
    // The reader card is painted from root custom properties only. The
    // stylesheet keeps the theme fallback, so an unset preference removes the
    // property and the active Look palette wins again.
    const RSS_CARD_UNITS = Object.freeze({
      WIDTH: "px",
      MAX_HEIGHT: "%",
      FONT_SIZE: "px",
      LINE_HEIGHT: "ratio",
      PADDING: "px",
      RADIUS: "px",
      BORDER: "px",
      OPACITY: "%",
      BUTTON_RADIUS: "px",
      GAP: "px",
    });
    const RSS_CARD_SHADOWS = Object.freeze({
      none: "none",
      soft: "0 6px 24px #0008",
      strong: "0 12px 36px #000c",
    });
    const RSS_CARD_FONTS = Object.freeze({
      system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      serif: "Georgia, 'Times New Roman', serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    });
    const LOOK_BOUNDS = Object.freeze({
      [LOOK_PREFS.VIDEO_CONTROLS_GAP]: [0, 8],
      ...Object.fromEntries(
        [
          LOOK_PREFS.PRIMARY_OPACITY,
          LOOK_PREFS.BACKDROP_OPACITY,
          LOOK_PREFS.WEB_OPACITY,
          LOOK_PREFS.SURFACE_OPACITY,
          LOOK_PREFS.RAISED_OPACITY,
          LOOK_PREFS.TOOLBAR_OPACITY,
          LOOK_PREFS.ADDRESS_OPACITY,
          LOOK_PREFS.BUTTON_OPACITY,
          LOOK_PREFS.TILE_OPACITY,
          LOOK_PREFS.VIDEO_OPACITY,
          LOOK_PREFS.VIDEO_OVERLAY_OPACITY,
          LOOK_PREFS.VIDEO_CONTROL_OPACITY,
          LOOK_PREFS.POPUP_OPACITY,
        ].map((key) => [key, [0, 100]]),
      ),
      [LOOK_PREFS.CONTROL_STRENGTH]: [0, 100],
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
      [LOOK_PREFS.RSS_CARD_WIDTH]: [240, 560],
      [LOOK_PREFS.RSS_CARD_MAX_HEIGHT]: [20, 90],
      [LOOK_PREFS.RSS_CARD_FONT_SIZE]: [10, 20],
      [LOOK_PREFS.RSS_CARD_LINE_HEIGHT]: [110, 200],
      [LOOK_PREFS.RSS_CARD_PADDING]: [6, 24],
      [LOOK_PREFS.RSS_CARD_RADIUS]: [0, 24],
      [LOOK_PREFS.RSS_CARD_BORDER]: [0, 3],
      [LOOK_PREFS.RSS_CARD_OPACITY]: [10, 100],
      [LOOK_PREFS.RSS_CARD_BUTTON_RADIUS]: [0, 16],
      [LOOK_PREFS.RSS_CARD_GAP]: [0, 32],
      [LOOK_GROUP_PREFS.LABEL_OPACITY]: [0, 100],
      [ctx.BGALAZKA_EXT_PREFS.PANEL_BLACK_OPACITY]: [0, 100],
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_UNPINNED]: [10, 100],
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS]: [10, 100],
      [ctx.BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR]: [10, 100],
      [ctx.BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY]: [10, 100],
      [ctx.BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY]: [10, 100],
    });
    function rgb(hex) {
      return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    }
    function mix(a, b, fraction) {
      const x = rgb(a),
        y = rgb(b);
      return (
        "#" +
        x
          .map((v, i) =>
            Math.round(v + (y[i] - v) * fraction)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")
      );
    }
    function luminance(hex) {
      return rgb(hex).reduce((sum, v, i) => {
        v /= 255;
        return (
          sum +
          [0.2126, 0.7152, 0.0722][i] *
            (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
        );
      }, 0);
    }
    function contrast(a, b) {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    }
    function contrastText(background) {
      return contrast("#000000", background) >= contrast("#ffffff", background)
        ? "#000000"
        : "#ffffff";
    }
    function readableColor(preferred, background, minimum = 4.5) {
      if (contrast(preferred, background) >= minimum) return preferred;
      const target = contrastText(background);
      // Small bounded search only on a settings update; no DOM reads or timers.
      for (let i = 1; i <= 20; i++) {
        const candidate = mix(preferred, target, i / 20);
        if (contrast(candidate, background) >= minimum) return candidate;
      }
      return target;
    }
    function resolvePalette(
      get = (key) => ctx.getPref(key, LOOK_DEFAULTS[key]),
    ) {
      const colors = Object.fromEntries(
        LOOK_COLORS.map((key) => {
          const value = get(LOOK_PREFS[key]);
          return [
            key,
            /^#[0-9a-fA-F]{6}$/.test(value)
              ? value
              : LOOK_DEFAULTS[LOOK_PREFS[key]],
          ];
        }),
      );
      const simple = get(LOOK_PREFS.PALETTE_MODE) === "simple";
      const automatic = simple || get(LOOK_PREFS.TEXT_MODE) !== "manual";
      if (simple) {
        const primary = colors.PRIMARY;
        // Surfaces stay in the same hue; buttons are always a little darker.
        const light = luminance(primary) > 0.45;
        // Light palettes need pale paper/field surfaces, rather than gray fields.
        const card = mix(primary, "#ffffff", light ? 0.4 : 0.045);
        const raised = mix(primary, "#ffffff", light ? 0.6 : 0.09);
        Object.assign(colors, {
          BACKDROP: mix(primary, "#000000", 0.85),
          CANVAS: primary,
          SURFACE: card,
          RAISED: raised,
          ACCENT: colors.SECONDARY,
          TOOLBAR_SURFACE: light ? card : primary,
          TOOLBAR_URL: raised,
          BUTTON_SURFACE: mix(primary, "#000000", 0.12),
          BUTTON_HOVER: raised,
          BUTTON_BORDER_COLOR: mix(raised, colors.SECONDARY, 0.35),
          VIDEO_CANVAS: primary,
          VIDEO_CONTROL: card,
          VIDEO_SELECTED: colors.SECONDARY,
          SETTINGS_CANVAS: primary,
          SETTINGS_HEADER: card,
          SETTINGS_NAV: card,
          SETTINGS_CARD: card,
          INPUT_SURFACE: raised,
          SELECTED_SURFACE: colors.SECONDARY,
          POPUP_SURFACE: card,
        });
        colors.SUCCESS = light ? "#17633b" : "#86efac";
        colors.WARNING = light ? "#755100" : "#fcd34d";
        colors.DANGER = light ? "#a32232" : "#ff6b6b";
      }
      const textFor = (background, manual) =>
        automatic ? contrastText(background) : manual;
      colors.TEXT = textFor(colors.SURFACE, colors.TEXT);
      colors.MUTED = automatic
        ? readableColor(mix(colors.TEXT, colors.SURFACE, 0.3), colors.SURFACE)
        : colors.MUTED;
      colors.BUTTON_TEXT = textFor(colors.BUTTON_SURFACE, colors.BUTTON_TEXT);
      colors.BUTTON_HOVER_TEXT = textFor(
        colors.BUTTON_HOVER,
        colors.BUTTON_HOVER_TEXT,
      );
      colors.VIDEO_TEXT = textFor(colors.VIDEO_CANVAS, colors.VIDEO_TEXT);
      colors.VIDEO_MUTED = automatic
        ? readableColor(
            mix(colors.VIDEO_TEXT, colors.VIDEO_CANVAS, 0.3),
            colors.VIDEO_CANVAS,
          )
        : colors.VIDEO_MUTED;
      colors.SETTINGS_TEXT = textFor(
        colors.SETTINGS_CANVAS,
        colors.SETTINGS_TEXT,
      );
      colors.SETTINGS_MUTED = automatic
        ? readableColor(
            mix(colors.SETTINGS_TEXT, colors.SETTINGS_CANVAS, 0.3),
            colors.SETTINGS_CANVAS,
          )
        : colors.SETTINGS_MUTED;
      colors.INPUT_TEXT = textFor(colors.INPUT_SURFACE, colors.INPUT_TEXT);
      colors.SELECTED_TEXT = textFor(
        colors.SELECTED_SURFACE,
        colors.SELECTED_TEXT,
      );
      colors.POPUP_TEXT = textFor(colors.POPUP_SURFACE, colors.POPUP_TEXT);
      return { colors, simple, automatic, contrastText, textFor };
    }
    // Preserve customized legacy palettes. Migration only seeds new, unset
    // preferences once; it never rewrites an existing user value.
    const hasUserLook = (key) =>
      Services.prefs.prefHasUserValue?.(LOOK_PREFS[key]) === true;
    const legacyPalette = [
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
      "VIDEO_CANVAS",
      "VIDEO_CONTROL",
      "VIDEO_TEXT",
      "VIDEO_MUTED",
    ];
    const customizedLegacyPalette = legacyPalette.some(hasUserLook);
    if (ctx.setPref && customizedLegacyPalette) {
      const current = completeTheme({
        values: Object.fromEntries(
          Object.entries(LOOK_PREFS).map(([, key]) => [
            key,
            ctx.getPref(key, LOOK_DEFAULTS[key]),
          ]),
        ),
      }).values;
      const added = [
        "BACKDROP",
        "BACKDROP_OPACITY",
        "PRIMARY",
        "SECONDARY",
        "PRIMARY_OPACITY",
        "WEB_SURFACE",
        "WEB_OPACITY",
        "SETTINGS_CANVAS",
        "SETTINGS_HEADER",
        "SETTINGS_NAV",
        "SETTINGS_CARD",
        "SETTINGS_TEXT",
        "SETTINGS_MUTED",
        "INPUT_SURFACE",
        "INPUT_TEXT",
        "BUTTON_HOVER",
        "BUTTON_HOVER_TEXT",
        "SELECTED_SURFACE",
        "SELECTED_TEXT",
        "POPUP_SURFACE",
        "POPUP_TEXT",
        "SUCCESS",
        "WARNING",
        "DANGER",
      ];
      for (const key of added)
        if (!Services.prefs.prefHasUserValue(LOOK_PREFS[key]))
          ctx.setPref(LOOK_PREFS[key], current[LOOK_PREFS[key]]);
    }
    const themeColorKeys = new Set([
      LOOK_PREFS.VIDEO_CONTROLS_WRAP,
      LOOK_PREFS.VIDEO_CONTROLS_GAP,
      ...LOOK_COLORS.map((key) => LOOK_PREFS[key]),
      ...[...LOOK_TRANSPARENCY_KEYS].filter(
        (key) => key !== LOOK_PREFS.WEB_OPACITY,
      ),
      LOOK_PREFS.STYLE,
      LOOK_PREFS.TEXT_MODE,
      LOOK_PREFS.SOLID_CONTROLS,
      LOOK_PREFS.CONTROL_STRENGTH,
      LOOK_PREFS.WEB_OPACITY,
    ]);
    // Saved transparent variation: appearance only, never exported density or behavior.
    const LOOK_THEME_VARIANTS = Object.freeze({
      Transparent: Object.freeze([
        Object.freeze({
          name: "Crimson Glass",
          description:
            "Near-black navy, crimson accents and barely-there glass.",
          swatch: "#d50025",
          values: Object.freeze({
            "zen.workspace.bgalazka.look.solid_controls": true,
            "zen.workspace.bgalazka.look.control_strength": 5,
            "zen.workspace.bgalazka.look.style": "atelier",
            "zen.workspace.bgalazka.look.palette_mode": "simple",
            "zen.workspace.bgalazka.look.text_mode": "auto",
            "zen.workspace.bgalazka.look.primary_opacity": 0,
            "zen.workspace.bgalazka.look.primary": "#000511",
            "zen.workspace.bgalazka.look.secondary": "#d50025",
            "zen.workspace.bgalazka.look.settings_canvas": "#000000",
            "zen.workspace.bgalazka.look.settings_header": "#000000",
            "zen.workspace.bgalazka.look.settings_nav": "#000000",
            "zen.workspace.bgalazka.look.settings_card": "#000000",
            "zen.workspace.bgalazka.look.settings_text": "#ffffff",
            "zen.workspace.bgalazka.look.settings_muted": "#d0d0d0",
            "zen.workspace.bgalazka.look.input_surface": "#000000",
            "zen.workspace.bgalazka.look.input_text": "#ffffff",
            "zen.workspace.bgalazka.look.button_hover": "#000000",
            "zen.workspace.bgalazka.look.button_hover_text": "#ffffff",
            "zen.workspace.bgalazka.look.selected_surface": "#ffffff",
            "zen.workspace.bgalazka.look.selected_text": "#000000",
            "zen.workspace.bgalazka.look.popup_surface": "#000000",
            "zen.workspace.bgalazka.look.popup_text": "#ffffff",
            "zen.workspace.bgalazka.look.success": "#86efac",
            "zen.workspace.bgalazka.look.warning": "#fcd34d",
            "zen.workspace.bgalazka.look.danger": "#ff6b6b",
            "zen.workspace.bgalazka.look.web_surface": "#000000",
            "zen.workspace.bgalazka.look.web_opacity": 5,
            "zen.workspace.bgalazka.look.backdrop": "#000000",
            "zen.workspace.bgalazka.look.backdrop_opacity": 75,
            "zen.workspace.bgalazka.look.canvas": "#000000",
            "zen.workspace.bgalazka.look.surface": "#000000",
            "zen.workspace.bgalazka.look.raised": "#000000",
            "zen.workspace.bgalazka.look.accent": "#ffffff",
            "zen.workspace.bgalazka.look.text": "#ffffff",
            "zen.workspace.bgalazka.look.muted": "#d0d0d0",
            "zen.workspace.bgalazka.look.surface_opacity": 5,
            "zen.workspace.bgalazka.look.raised_opacity": 5,
            "zen.workspace.bgalazka.look.toolbar_opacity": 5,
            "zen.workspace.bgalazka.look.address_opacity": 5,
            "zen.workspace.bgalazka.look.button_opacity": 5,
            "zen.workspace.bgalazka.look.tile_opacity": 5,
            "zen.workspace.bgalazka.look.video_opacity": 5,
            "zen.workspace.bgalazka.look.video_control_opacity": 5,
            "zen.workspace.bgalazka.look.popup_opacity": 10,
            "zen.workspace.bgalazka.look.radius": 0,
            "zen.workspace.bgalazka.look.depth": 0,
            "zen.workspace.zentral.video_preview.radius_px": 0,
            "zen.workspace.bgalazka.look.panel_border": 1,
            "zen.workspace.bgalazka.look.toolbar_surface": "#000000",
            "zen.workspace.bgalazka.look.toolbar_url": "#000000",
            "zen.workspace.bgalazka.look.toolbar_border": 1,
            "zen.workspace.bgalazka.look.button_style": "outline",
            "zen.workspace.bgalazka.look.button_surface": "#000000",
            "zen.workspace.bgalazka.look.button_text": "#ffffff",
            "zen.workspace.bgalazka.look.button_border_color": "#ffffff",
            "zen.workspace.bgalazka.look.button_border": 0,
            "zen.workspace.bgalazka.look.tile_style": "bare",
            "zen.workspace.bgalazka.look.row_style": "lines",
            "zen.workspace.bgalazka.look.row_rule": 0,
            "zen.workspace.bgalazka.look.video_canvas": "#000000",
            "zen.workspace.bgalazka.look.video_control": "#000000",
            "zen.workspace.bgalazka.look.video_text": "#ffffff",
            "zen.workspace.bgalazka.look.video_muted": "#d0d0d0",
            "zen.workspace.bgalazka.look.video_selected": "#ffffff",
            "zen.workspace.bgalazka.look.video_border": 0,
            "zen.workspace.bgalazka.look.video_source_style": "line",
          }),
          extraAppearance: Object.freeze({
            "zen.workspace.bgalazka.translucency": true,
            "zen.workspace.bgalazka.panel_black_opacity": 20,
            "zen.workspace.bgalazka.opacity_unpinned": 100,
            "zen.workspace.bgalazka.opacity_pinned_focus": 95,
            "zen.workspace.bgalazka.opacity_pinned_blur": 90,
            "zen.workspace.bgalazka.pill_peek_dot_color": "#5e0002",
            "zen.workspace.bgalazka.pill_peek_dot_opacity": 31,
            "zen.workspace.bgalazka.pill_background_opacity": 55,
          }),
        }),
      ]),
    });
    const themeExtraAppearanceKeys = Object.freeze([
      "zen.workspace.bgalazka.translucency",
      "zen.workspace.bgalazka.panel_black_opacity",
      "zen.workspace.bgalazka.opacity_unpinned",
      "zen.workspace.bgalazka.opacity_pinned_focus",
      "zen.workspace.bgalazka.opacity_pinned_blur",
      "zen.workspace.bgalazka.pill_peek_dot_color",
      "zen.workspace.bgalazka.pill_peek_dot_opacity",
      "zen.workspace.bgalazka.pill_background_opacity",
    ]);
    function applyThemeColors(theme = null) {
      const changedKeys = [];
      const write = (key, value) => {
        if (ctx.getPref(key, LOOK_DEFAULTS[key]) !== value) {
          ctx.setPref(key, value);
          changedKeys.push(key);
        }
      };
      for (const key of themeColorKeys) {
        // Reset colors does not alter backing or the user's strength choice.
        if (
          !theme &&
          [
            LOOK_PREFS.WEB_SURFACE,
            LOOK_PREFS.WEB_OPACITY,
            LOOK_PREFS.CONTROL_STRENGTH,
          ].includes(key)
        )
          continue;
        const value = theme?.values[key] ?? LOOK_DEFAULTS[key];
        write(key, value);
      }
      if (theme) {
        for (const key of themeStyleKeys) {
          const value = theme.values[key] ?? LOOK_DEFAULTS[key];
          write(key, value);
        }
        for (const key of themeExtraAppearanceKeys)
          if (
            theme.extraAppearance &&
            Object.hasOwn(theme.extraAppearance, key)
          )
            write(key, theme.extraAppearance[key]);
        // A preset is a fresh linked starting point. Detailed is an explicit next step.
        write(LOOK_PREFS.PALETTE_MODE, "simple");
      }
      syncAppearanceAfterImport(changedKeys);
    }
    if (ctx.setPref) {
      // Simple is the fresh-profile default; Detailed preserves old saved colors.
      if (!hasUserLook("PALETTE_MODE"))
        ctx.setPref(
          LOOK_PREFS.PALETTE_MODE,
          customizedLegacyPalette ? "detailed" : "simple",
        );
      if (
        customizedLegacyPalette &&
        !hasUserLook("TEXT_MODE") &&
        ["TEXT", "MUTED", "BUTTON_TEXT", "VIDEO_TEXT", "VIDEO_MUTED"].some(
          hasUserLook,
        )
      )
        ctx.setPref(LOOK_PREFS.TEXT_MODE, "manual");
      if (
        customizedLegacyPalette &&
        !hasUserLook("SOLID_CONTROLS") &&
        [
          "BUTTON_OPACITY",
          "ADDRESS_OPACITY",
          "POPUP_OPACITY",
          "VIDEO_CONTROL_OPACITY",
        ].some(
          (key) => hasUserLook(key) && ctx.getPref(LOOK_PREFS[key], 100) < 100,
        )
      )
        ctx.setPref(LOOK_PREFS.SOLID_CONTROLS, false);
    }
    // An explicit Simple -> Detailed transition materializes the rendered
    // palette once. Imports/startup do not run this conversion.
    function setPaletteMode(mode) {
      if (!LOOK_ENUMS[LOOK_PREFS.PALETTE_MODE].includes(mode)) return;
      const changedKeys = [];
      if (
        mode === "detailed" &&
        ctx.getPref(LOOK_PREFS.PALETTE_MODE, "simple") === "simple"
      ) {
        const palette = resolvePalette();
        const write = (key, value) => {
          if (ctx.getPref(key, LOOK_DEFAULTS[key]) !== value) {
            ctx.setPref(key, value);
            changedKeys.push(key);
          }
        };
        for (const [name, value] of Object.entries(palette.colors))
          write(LOOK_PREFS[name], value);
        const raw = Number(ctx.getPref(LOOK_PREFS.PRIMARY_OPACITY, 100));
        const opacity = Number.isFinite(raw)
          ? Math.max(0, Math.min(100, raw))
          : 100;
        for (const name of [
          "SURFACE",
          "RAISED",
          "TOOLBAR",
          "ADDRESS",
          "BUTTON",
          "TILE",
          "VIDEO",
          "VIDEO_CONTROL",
          "POPUP",
        ])
          write(LOOK_PREFS[name + "_OPACITY"], opacity);
        write(LOOK_PREFS.BACKDROP_OPACITY, Math.round(opacity * 0.75));
        write(LOOK_PREFS.TEXT_MODE, "auto");
      }
      if (ctx.getPref(LOOK_PREFS.PALETTE_MODE, "simple") !== mode) {
        ctx.setPref(LOOK_PREFS.PALETTE_MODE, mode);
        changedKeys.push(LOOK_PREFS.PALETTE_MODE);
      }
      syncAppearanceAfterImport(changedKeys);
    }
    // Measure the native artwork's untransformed box instead of assuming its
    // baseline size. Updates are event-driven and coalesced into one frame.
    const artworkSelector =
      "zen-folder > .tab-group-label-container .tab-group-folder-icon, " +
      ":is(#zen-current-workspace-indicator, .zen-current-workspace-indicator) " +
      ":is(.zen-current-workspace-indicator-icon, image, img, svg)";
    const artworkNodes = new Set();
    let artworkFrame = null,
      artworkDisposed = false,
      artworkNeedsDiscovery = true;
    const artworkResize =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => queueArtworkScale())
        : null;
    function queueArtworkScale(discover = false) {
      artworkNeedsDiscovery ||= discover;
      if (artworkDisposed || artworkFrame !== null) return;
      artworkFrame = window.requestAnimationFrame(syncArtworkScale);
    }
    function syncArtworkScale() {
      artworkFrame = null;
      const enabled = ctx.getPref(LOOK_PREFS.DENSITY_ICONS, false) === true;
      for (const node of artworkNodes) {
        if (!enabled || !node.isConnected) {
          artworkResize?.unobserve(node);
          node.style.removeProperty("--bgalazka-artwork-scale");
          artworkNodes.delete(node);
        }
      }
      if (!enabled || artworkDisposed) return;
      const candidates = artworkNeedsDiscovery
        ? document.querySelectorAll(artworkSelector)
        : [...artworkNodes];
      artworkNeedsDiscovery = false;
      const writes = [];
      const sizes = new Map();
      for (const key of [
        LOOK_PREFS.FOLDER_ICON_SIZE,
        LOOK_PREFS.WORKSPACE_ICON_SIZE,
      ]) {
        const [min, max] = LOOK_BOUNDS[key];
        const requested = Number(ctx.getPref(key, LOOK_DEFAULTS[key]));
        sizes.set(
          key,
          Number.isFinite(requested)
            ? Math.max(min, Math.min(max, requested))
            : LOOK_DEFAULTS[key],
        );
      }
      for (const node of candidates) {
        const folder = node.classList.contains("tab-group-folder-icon");
        // Workspace wrappers can contain an image or SVG. Scale only one layer.
        if (!folder && node.querySelector("image, img, svg")) {
          artworkResize?.unobserve(node);
          node.style.removeProperty("--bgalazka-artwork-scale");
          artworkNodes.delete(node);
          continue;
        }
        if (!artworkNodes.has(node)) {
          artworkNodes.add(node);
          artworkResize?.observe(node);
        }
        const nativeWidth =
          parseFloat(window.getComputedStyle(node).width) || node.clientWidth;
        if (!(nativeWidth > 0)) continue; // ResizeObserver retries when it becomes visible.
        const key = folder
          ? LOOK_PREFS.FOLDER_ICON_SIZE
          : LOOK_PREFS.WORKSPACE_ICON_SIZE;
        const scale = String(sizes.get(key) / nativeWidth);
        if (node.style.getPropertyValue("--bgalazka-artwork-scale") !== scale)
          writes.push([node, scale]);
      }
      // Finish measurements before changing styles to avoid repeated layout flushes.
      for (const [node, scale] of writes)
        node.style.setProperty("--bgalazka-artwork-scale", scale);
    }
    const artworkObserver = new MutationObserver((records) => {
      if (!ctx.getPref(LOOK_PREFS.DENSITY_ICONS, false)) return;
      if (
        records.some(
          (record) =>
            record.type === "attributes" ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node.matches?.(artworkSelector) ||
                node.querySelector?.(artworkSelector),
            ),
        )
      )
        queueArtworkScale(true);
    });
    const artworkLayoutObserver = new MutationObserver(() =>
      queueArtworkScale(),
    );
    let artworkWatching = false;
    function syncArtworkObservation() {
      const enabled = ctx.getPref(LOOK_PREFS.DENSITY_ICONS, false) === true;
      if (enabled && !artworkWatching) {
        // Keep child discovery rooted above native sidebar replacements, while
        // attribute observation stays on the root itself.
        artworkObserver.observe(document.documentElement, {
          subtree: true,
          childList: true,
        });
        artworkLayoutObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: [
            "zen-compact-mode",
            "zen-sidebar-collapsed",
            "zen-sidebar-expanded",
            "zen-right-side",
            "zen-sidebar-right",
          ],
        });
        artworkWatching = true;
      } else if (!enabled && artworkWatching) {
        artworkObserver.disconnect();
        artworkLayoutObserver.disconnect();
        artworkWatching = false;
      }
      if (enabled || artworkNodes.size) queueArtworkScale(true);
    }
    ctx.registerCleanup(() => {
      artworkDisposed = true;
      if (artworkFrame !== null) window.cancelAnimationFrame(artworkFrame);
      artworkFrame = null;
      artworkObserver.disconnect();
      artworkLayoutObserver.disconnect();
      artworkResize?.disconnect();
      for (const node of artworkNodes)
        node.style.removeProperty("--bgalazka-artwork-scale");
      artworkNodes.clear();
    });
    let lookFrame = null,
      lookDisposed = false;
    const scheduleLook = () => {
      if (lookDisposed || lookFrame !== null) return;
      lookFrame = window.requestAnimationFrame(() => {
        lookFrame = null;
        applyLook();
      });
    };
    ctx.registerCleanup(() => {
      lookDisposed = true;
      if (lookFrame !== null) window.cancelAnimationFrame(lookFrame);
      lookFrame = null;
    });
    const applyLook = () => {
      {
        const style = document.documentElement.style;
        const wrap = ctx.getPref(
          LOOK_PREFS.VIDEO_CONTROLS_WRAP, false
        ) === true;
        const rawGap = Number(ctx.getPref(
          LOOK_PREFS.VIDEO_CONTROLS_GAP, 1
        ));
        const gap = Number.isFinite(rawGap)
          ? Math.max(0, Math.min(8, rawGap))
          : 1;

        style.setProperty(
          "--zentral-sidebar-video-wrap",
          wrap ? "wrap" : "nowrap"
        );
        style.setProperty(
          "--zentral-sidebar-video-gap",
          gap + "px"
        );
      }
      if (lookDisposed) return;
      if (lookFrame !== null) window.cancelAnimationFrame(lookFrame);
      lookFrame = null;
      const root = document.documentElement;
      for (const [key, attribute] of [
        ["TABBAR_COMPACT", "bgalazka-tabbar-compact"],
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
      const solidControls =
        ctx.getPref(LOOK_PREFS.SOLID_CONTROLS, true) !== false;
      const rawStrength = Number(ctx.getPref(LOOK_PREFS.CONTROL_STRENGTH, 100));
      const strength = solidControls
        ? (Number.isFinite(rawStrength)
            ? Math.max(0, Math.min(100, rawStrength))
            : 100) / 100
        : 0;
      root.setAttribute(
        "bgalazka-solid-controls",
        String(solidControls && strength > 0),
      );
      const palette = resolvePalette();
      const previousMode = root.getAttribute("bgalazka-palette-mode");
      root.setAttribute(
        "bgalazka-palette-mode",
        palette.simple ? "simple" : "detailed",
      );
      if (previousMode !== root.getAttribute("bgalazka-palette-mode"))
        window.ZentralRuntime?.syncAppearanceNavigation?.();
      root.setAttribute(
        "bgalazka-text-mode",
        palette.automatic ? "auto" : "manual",
      );
      for (const [key, value] of Object.entries(palette.colors)) {
        root.style.setProperty(
          "--bgalazka-look-" + key.toLowerCase().replaceAll("_", "-"),
          value,
        );
      }
      // Each distinct surface gets its own contrast pair, including hover states.
      const pairs = {
        "settings-header": "SETTINGS_HEADER",
        "settings-nav": "SETTINGS_NAV",
        "settings-card": "SETTINGS_CARD",
        toolbar: "TOOLBAR_SURFACE",
        "toolbar-action": "BUTTON_SURFACE",
        "toolbar-url": "TOOLBAR_URL",
        "video-control": "VIDEO_CONTROL",
        canvas: "CANVAS",
        surface: "SURFACE",
        raised: "RAISED",
      };
      const opacityFor = (key) => {
        const value = Number(
          ctx.getPref(
            palette.simple ? LOOK_PREFS.PRIMARY_OPACITY : LOOK_PREFS[key],
            LOOK_DEFAULTS[LOOK_PREFS[key]],
          ),
        );
        return Number.isFinite(value)
          ? Math.max(0, Math.min(100, value)) / 100
          : 1;
      };
      const reinforcedOpacity = (key) =>
        opacityFor(key) + (1 - opacityFor(key)) * strength;
      const toolbarOpacity = reinforcedOpacity("TOOLBAR_OPACITY");
      const videoCanvasOpacity = reinforcedOpacity("VIDEO_OPACITY");
      const addressOpacity = reinforcedOpacity("ADDRESS_OPACITY");
      const videoOpacity = reinforcedOpacity("VIDEO_CONTROL_OPACITY");
      const filledButtons =
        ctx.getPref(LOOK_PREFS.BUTTON_STYLE, "outline") === "filled";
      const actionOpacity = filledButtons
        ? reinforcedOpacity("BUTTON_OPACITY")
        : 0;
      root.style.setProperty(
        "--zl-readable-toolbar-opacity",
        toolbarOpacity * 100 + "%",
      );
      root.style.setProperty(
        "--zl-readable-video-canvas-opacity",
        videoCanvasOpacity * 100 + "%",
      );
      root.style.setProperty(
        "--zl-readable-action-opacity",
        actionOpacity * 100 + "%",
      );
      root.style.setProperty(
        "--zl-readable-address-opacity",
        addressOpacity * 100 + "%",
      );
      root.style.setProperty(
        "--zl-readable-video-opacity",
        (filledButtons ? videoOpacity : 0) * 100 + "%",
      );
      root.style.setProperty(
        "--zl-readable-popup-opacity",
        reinforcedOpacity("POPUP_OPACITY") * 100 + "%",
      );
      const webSurface =
        Number(ctx.getPref("zen.workspace.bgalazka.panel_black_opacity", 0)) > 0
          ? "#000000"
          : palette.colors.WEB_SURFACE;
      const toolbarBackground = mix(
        webSurface,
        palette.colors.TOOLBAR_SURFACE,
        toolbarOpacity,
      );
      const urlBackground = mix(
        toolbarBackground,
        palette.colors.TOOLBAR_URL,
        addressOpacity,
      );
      root.style.setProperty(
        "--zl-toolbar-focus",
        readableColor(palette.colors.ACCENT, urlBackground, 3),
      );
      root.style.setProperty(
        "--zl-url-border",
        palette.colors.BUTTON_BORDER_COLOR,
      );
      const videoControlBackground = mix(
        palette.colors.VIDEO_CANVAS,
        palette.colors.VIDEO_CONTROL,
        opacityFor("VIDEO_CONTROL_OPACITY"),
      );
      // Pair glyphs with the surface actually painted by the active button style.
      // Video pixels are deliberately never sampled during resize or playback.
      const overlayRaw = Number(
        ctx.getPref(LOOK_PREFS.VIDEO_OVERLAY_OPACITY, 40),
      );
      const overlayOpacity = Number.isFinite(overlayRaw)
        ? Math.max(0, Math.min(100, overlayRaw)) / 100
        : 0.4;
      const buttonColor =
        strength > 0
          ? palette.colors.BUTTON_SURFACE
          : palette.colors.VIDEO_CONTROL;
      const buttonOpacity = filledButtons ? videoOpacity : 0;
      const overlayBackground = mix(
        palette.colors.VIDEO_CANVAS,
        palette.colors.VIDEO_CONTROL,
        overlayOpacity,
      );
      root.style.setProperty(
        "--zl-video-button-fill",
        `color-mix(in srgb, ${buttonColor} ${buttonOpacity * 100}%, transparent)`,
      );
      root.style.setProperty(
        "--zl-video-button-text",
        palette.textFor(
          mix(palette.colors.VIDEO_CANVAS, buttonColor, buttonOpacity),
          palette.colors.VIDEO_TEXT,
        ),
      );
      root.style.setProperty(
        "--zl-video-overlay-text",
        palette.textFor(
          mix(overlayBackground, buttonColor, buttonOpacity),
          palette.colors.VIDEO_TEXT,
        ),
      );
      root.style.setProperty(
        "--zl-video-progress",
        readableColor(
          palette.colors.VIDEO_SELECTED,
          palette.colors.VIDEO_CANVAS,
          3,
        ),
      );
      root.style.setProperty(
        "--zl-video-scheme",
        contrastText(palette.colors.VIDEO_CANVAS) === "#000000"
          ? "light"
          : "dark",
      );
      root.style.setProperty(
        "--zl-video-icon-outline",
        contrastText(palette.colors.VIDEO_CONTROL) === "#000000"
          ? "#fff"
          : "#000",
      );
      for (const [name, key] of Object.entries(pairs)) {
        let background = palette.colors[key];
        let manual = name.startsWith("settings-")
          ? palette.colors.SETTINGS_TEXT
          : palette.colors.TEXT;
        if (name === "toolbar") background = toolbarBackground;
        if (name === "toolbar-url") {
          background = mix(
            toolbarBackground,
            palette.colors.TOOLBAR_URL,
            addressOpacity,
          );
          manual = palette.colors.BUTTON_TEXT;
        }
        if (name === "toolbar-action") {
          background = mix(
            toolbarBackground,
            palette.colors.BUTTON_SURFACE,
            actionOpacity,
          );
          manual = palette.colors.BUTTON_TEXT;
        }
        if (name === "video-control") {
          background =
            strength > 0 && filledButtons
              ? mix(
                  palette.colors.VIDEO_CANVAS,
                  palette.colors.BUTTON_SURFACE,
                  videoOpacity,
                )
              : videoControlBackground;
          manual = palette.colors.VIDEO_TEXT;
        }
        const text = palette.textFor(background, manual);
        root.style.setProperty("--zl-" + name + "-text", text);
        root.style.setProperty(
          "--zl-" + name + "-muted",
          palette.automatic
            ? readableColor(mix(text, background, 0.3), background)
            : palette.colors.MUTED,
        );
      }
      for (const role of ["SUCCESS", "WARNING", "DANGER"]) {
        const name = role.toLowerCase();
        const settingColor = palette.automatic
          ? readableColor(palette.colors[role], palette.colors.SETTINGS_CANVAS)
          : palette.colors[role];
        const popupColor = palette.automatic
          ? readableColor(palette.colors[role], palette.colors.POPUP_SURFACE)
          : palette.colors[role];
        root.style.setProperty("--zl-" + name, settingColor);
        root.style.setProperty("--zl-" + name + "-popup", popupColor);
        root.style.setProperty(
          "--zl-" + name + "-text",
          contrastText(settingColor),
        );
        root.style.setProperty(
          "--zl-" + name + "-popup-text",
          contrastText(popupColor),
        );
      }
      root.style.setProperty(
        "--zl-video-selected-text",
        palette.textFor(
          mix(palette.colors.VIDEO_CANVAS, palette.colors.VIDEO_SELECTED, 0.2),
          palette.colors.VIDEO_TEXT,
        ),
      );
      const rowKey =
        ctx.getPref(LOOK_PREFS.ROW_STYLE, "lines") === "cards"
          ? "SETTINGS_CARD"
          : "SETTINGS_CANVAS";
      const rowBackground = palette.colors[rowKey];
      const rowText = palette.textFor(
        rowBackground,
        palette.colors.SETTINGS_TEXT,
      );
      root.style.setProperty("--zl-settings-row", rowBackground);
      root.style.setProperty("--zl-settings-row-text", rowText);
      root.style.setProperty(
        "--zl-settings-row-muted",
        palette.automatic
          ? readableColor(mix(rowText, rowBackground, 0.3), rowBackground)
          : palette.colors.SETTINGS_MUTED,
      );
      root.style.setProperty(
        "--zl-input-scheme",
        contrastText(palette.colors.INPUT_SURFACE) === "#000000"
          ? "light"
          : "dark",
      );
      root.style.setProperty(
        "--zl-focus",
        readableColor(palette.colors.ACCENT, palette.colors.SETTINGS_CANVAS, 3),
      );
      root.style.setProperty(
        "--zl-nav-accent",
        readableColor(palette.colors.ACCENT, palette.colors.SETTINGS_NAV),
      );
      for (const key of [
        "PRIMARY_OPACITY",
        "BACKDROP_OPACITY",
        "WEB_OPACITY",
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
        "VIDEO_OVERLAY_OPACITY",
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
        if (key === "CONTROL_SIZE")
          root.style.setProperty(
            "--bgalazka-look-control-icon-size",
            Math.max(12, clamped - 6) + "px",
          );
      }
      // Reader card: numbers, optional colors and enum choices become root
      // custom properties. Nothing is written for an empty color, so the
      // stylesheet falls back to the current theme token.
      for (const [name, unit] of Object.entries(RSS_CARD_UNITS)) {
        const pref = LOOK_PREFS["RSS_CARD_" + name];
        const [min, max] = LOOK_BOUNDS[pref];
        const raw = Number(ctx.getPref(pref, LOOK_DEFAULTS[pref]));
        const value = Number.isFinite(raw)
          ? Math.max(min, Math.min(max, Math.round(raw)))
          : LOOK_DEFAULTS[pref];
        root.style.setProperty(
          "--bgalazka-look-rss-card-" +
            name.toLowerCase().replaceAll("_", "-"),
          unit === "ratio" ? String(value / 100) : value + unit,
        );
      }
      for (const name of RSS_CARD_COLOR_NAMES) {
        const pref = LOOK_PREFS["RSS_CARD_" + name];
        const value = String(ctx.getPref(pref, "") || "").trim();
        const property =
          "--bgalazka-look-rss-card-" + name.toLowerCase().replaceAll("_", "-");
        if (/^#[0-9a-fA-F]{6}$/.test(value))
          root.style.setProperty(property, value);
        else root.style.removeProperty(property);
      }
      for (const [name, table] of [
        ["SHADOW", RSS_CARD_SHADOWS],
        ["FONT", RSS_CARD_FONTS],
      ]) {
        const pref = LOOK_PREFS["RSS_CARD_" + name];
        const value = ctx.getPref(pref, LOOK_DEFAULTS[pref]);
        root.style.setProperty(
          "--bgalazka-look-rss-card-" + name.toLowerCase(),
          table[value] || table[LOOK_DEFAULTS[pref]],
        );
      }
      if (palette.simple) {
        const value = Number(ctx.getPref(LOOK_PREFS.PRIMARY_OPACITY, 100));
        const opacity = Number.isFinite(value)
          ? Math.max(0, Math.min(100, value))
          : 100;
        root.style.setProperty(
          "--bgalazka-look-backdrop-opacity",
          Math.round(opacity * 0.75) + "%",
        );
        for (const key of [
          "surface",
          "raised",
          "toolbar",
          "address",
          "button",
          "tile",
          "video",
          "video-control",
          "popup",
        ])
          root.style.setProperty(
            "--bgalazka-look-" + key + "-opacity",
            opacity + "%",
          );
      }
      if (root.getAttribute("bgalazka-look") !== "atelier") {
        for (const name of Object.keys(pairs)) {
          root.style.removeProperty("--zl-" + name + "-text");
          root.style.removeProperty("--zl-" + name + "-muted");
        }
        for (const name of [
          "success",
          "warning",
          "danger",
          "focus",
          "nav-accent",
          "input-scheme",
          "danger-popup",
          "success-popup",
          "warning-popup",
          "danger-text",
          "success-text",
          "settings-row",
          "settings-row-text",
          "settings-row-muted",
          "video-selected-text",
          "toolbar-focus",
          "url-border",
          "warning-text",
          "success-popup-text",
          "warning-popup-text",
          "danger-popup-text",
        ])
          root.style.removeProperty("--zl-" + name);
      }
      syncArtworkObservation();
    };
    // A visual preference error must not halt panel hooks or Settings loading.
    // Keep this optional startup path isolated from the rest of the extension.
    try {
      applyLook();
      Services.prefs.addObserver("zen.workspace.bgalazka.look.", scheduleLook);
      ctx.registerCleanup(() =>
        Services.prefs.removeObserver(
          "zen.workspace.bgalazka.look.",
          scheduleLook,
        ),
      );
      Services.prefs.addObserver(
        "zen.workspace.bgalazka.panel_black_opacity",
        scheduleLook,
      );
      ctx.registerCleanup(() =>
        Services.prefs.removeObserver(
          "zen.workspace.bgalazka.panel_black_opacity",
          scheduleLook,
        ),
      );
      Services.prefs.addObserver(LOOK_PREFS.VIDEO_RADIUS, scheduleLook);
      ctx.registerCleanup(() =>
        Services.prefs.removeObserver(LOOK_PREFS.VIDEO_RADIUS, scheduleLook),
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
        keys.some(
          (key) =>
            key.startsWith("zen.workspace.bgalazka.") && !LOOK_KEYS.has(key),
        )
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
      // The Look panel also mirrors the reader-card switch, so its rows are
      // refreshed after every import, not only after a Look value changed.
      document.getElementById("zs-panel-extension-look")?._syncLook?.();
    }

    return {
      applyThemeColors,
      themeColorKeys,
      themeStyleKeys,
      setPaletteMode,
      resolvePalette,
      contrast,
      contrastText,
      LOOK_GROUP_PREFS,
      LOOK_PREFS,
      LOOK_DEFAULTS,
      LOOK_THEMES,
      LOOK_THEME_VARIANTS,
      LOOK_KEYS,
      LOOK_TRANSPARENCY_KEYS,
      LOOK_COLORS,
      LOOK_OPTIONAL_COLORS,
      LOOK_ENUMS,
      LOOK_BOUNDS,
      applyLook,
      scheduleLook,
      syncChangedSetting,
      syncAppearanceAfterImport,
    };
  });
})();
