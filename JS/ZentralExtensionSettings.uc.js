"use strict";
// Extension settings, live controls, Look editor and config transfer.
(function () {
  const sources = (window.ZentralFeatureSources ||= Object.create(null));
  sources.extensionSettings = function initExtensionSettings({
    EXT_PREFS, BGALAZKA_EXT_PREFS, EXT_KEYBIND_ACTIONS,
    EXT_KEYBIND_DEFAULTS, PREF_ICONS, PROFILE_DEFAULTS,
    getPref, setPref, parseSVG, registerCleanup, setInterval,
    clearInterval, restartBrowser, applyAttributes,
    applyHorizontalPanelOffset, applyVerticalResizeExtras,
    getAppliedHorizontalOffset, getHorizontalOffsetBounds,
    getHorizontalOffsetPreference, setCachedHorizontalOffset,
    keybindFromEvent, ensureNativeAudioButton, ensurePillAllSidesResizeButton,
    findAddonHostFolder, keepAddonHostFolderCollapsed,
    refreshPanelAudio, setAddonTabIdBridgeEnabled,
    setZenInternetPanelCssEnabled, syncHoverPanelAvailability,
    syncPanelFallbackPolling, syncPanelPushState,
    syncSecondaryFallbackPolling, updateAddonHostInspection,
    updateCSSVars, QUICK_SWITCH_BUILTIN_TARGETS,
    QUICK_SWITCH_CUSTOM_PREFS, QUICK_SWITCH_TARGET_PREF_PREFIX,
    SEARCH_CUSTOM_ENGINE_PREFS, isValidQuickSwitchTemplate,
    refreshBrowserSearchTemplate, startWebToolbarPolling,
    ensureWebToolbar, updateWebToolbarState,
    getActiveAppBrowser, requestTileSync,
    setForcePanelBlack, applyForcePanelBlackVisual,
    zenCssEnabled, getFirefoxContainerState,
    getPanelContainerMenuLabel, getPanelUserContextId,
    setPanelUserContextId, getContainerIconUrl,
    ensurePanelPrivacyMenuItems, getAllAppBrowsers,
  }) {
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
    input.value = getPref(prefKey, defaultVal) || "";
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
        setPref(prefKey, "");
        return;
      }
      const value = keybindFromEvent(e);
      if (!value) return;
      input.value = value;
      setPref(prefKey, value);
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
      iconWrapper.appendChild(parseSVG(iconSvg));
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
    input.checked = getPref(prefKey, defaultVal);

    input.addEventListener("change", () => {
      setPref(prefKey, input.checked);
      if (rootAttr) {
        document.documentElement.setAttribute(
          rootAttr,
          input.checked ? "true" : "false",
        );
      }
      if (
        prefKey === (EXT_PREFS?.CORNER_TILES || BGALAZKA_EXT_PREFS.CORNER_TILES)
      ) {
        requestTileSync(50);
      }
      if (prefKey === BGALAZKA_EXT_PREFS.PUSH_PAGE) {
        syncPanelPushState();
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
      iconWrapper.appendChild(parseSVG(iconSvg));
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

    const currentVal = getPref(prefKey, defaultVal);
    options.forEach((opt) => {
      const optionEl = document.createElement("option");
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      if (opt.value === currentVal) optionEl.selected = true;
      select.appendChild(optionEl);
    });

    select.addEventListener("change", () => {
      setPref(prefKey, select.value);
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
      iconWrapper.appendChild(parseSVG(iconSvg));
      labelContainer.prepend(iconWrapper);
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "zs-text-input";
    input.spellcheck = false;
    input.setAttribute("autocomplete", "off");
    if (placeholder) input.placeholder = placeholder;
    input.style.width = "100%";
    input.value = getPref(prefKey, "");

    const commitTextValue = () => {
      const val = input.value.trim();
      if (
        SEARCH_CUSTOM_ENGINE_PREFS.includes(prefKey) &&
        val &&
        !isValidQuickSwitchTemplate(val)
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
      if (getPref(prefKey, "") !== val) setPref(prefKey, val);
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
    input.value = fromPreference(getPref(prefKey, defaultVal));
    badge.textContent = input.value + suffix;

    input.addEventListener("input", () => {
      badge.textContent = input.value + suffix;
      setPref(prefKey, toPreference(parseInt(input.value, 10)));
      if (typeof updateCSSVars === "function") {
        updateCSSVars();
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
    input.value = getPref(prefKey, defaultVal);

    input.addEventListener("input", () => {
      setPref(prefKey, input.value);
      updateCSSVars();
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
    VIDEO_CONTROL_OPACITY: "zen.workspace.bgalazka.look.video_control_opacity",
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
    TABBAR_COMPACT: EXT_PREFS.TABBAR_COMPACT,
    TABBAR_ROW_HEIGHT: EXT_PREFS.TABBAR_ROW_HEIGHT,
    TABBAR_ROW_GAP: EXT_PREFS.TABBAR_ROW_GAP,
    TABBAR_ICON_GAP: EXT_PREFS.TABBAR_ICON_GAP,
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
    [BGALAZKA_EXT_PREFS.TRANSLUCENCY]: true,
    [BGALAZKA_EXT_PREFS.OPACITY_UNPINNED]: 92,
    [BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS]: 85,
    [BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR]: 45,
    [BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR]: "#5e0002",
    [BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY]: 31,
    [BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY]: 48,
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
        [BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY]: 55,
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
    [LOOK_GROUP_PREFS.LABEL_OPACITY]: [0, 100],
    [BGALAZKA_EXT_PREFS.OPACITY_UNPINNED]: [10, 100],
    [BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS]: [10, 100],
    [BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR]: [10, 100],
    [BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY]: [10, 100],
    [BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY]: [10, 100],
  });
  const applyLook = () => {
    const root = document.documentElement;
    for (const [key, attribute] of [
      ["STYLE", "bgalazka-look"],
      ["SPACING", "bgalazka-look-spacing"],
      ["BUTTON_STYLE", "bgalazka-look-buttons"],
      ["TILE_STYLE", "bgalazka-look-tiles"],
      ["ROW_STYLE", "bgalazka-look-rows"],
      ["VIDEO_SOURCE_STYLE", "bgalazka-look-video-selection"],
    ]) {
      const pref = LOOK_PREFS[key];
      const value = getPref(pref, LOOK_DEFAULTS[pref]);
      root.setAttribute(
        attribute,
        LOOK_ENUMS[pref].includes(value) ? value : LOOK_DEFAULTS[pref],
      );
    }
    for (const key of LOOK_COLORS) {
      const pref = LOOK_PREFS[key];
      const value = getPref(pref, LOOK_DEFAULTS[pref]);
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
      const value = getPref(pref, LOOK_DEFAULTS[pref]);
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
    registerCleanup(() =>
      Services.prefs.removeObserver("zen.workspace.bgalazka.look.", applyLook),
    );
    Services.prefs.addObserver(LOOK_PREFS.VIDEO_RADIUS, applyLook);
    registerCleanup(() =>
      Services.prefs.removeObserver(LOOK_PREFS.VIDEO_RADIUS, applyLook),
    );
  } catch (error) {
    console.error("[BgalazkaExtension] Look initialization failed:", error);
  }

  function syncAppearanceAfterImport() {
    applyLook();
    updateCSSVars();
    applyAttributes();
    window.Zentral?.TabGroups?.applyLabelOpacityPref?.();
    window.Zentral?.TabGroups?.applyChevronPref?.();
    window.Zentral?.TabGroups?.applyIndicatorTypePref?.();
    window.Zentral?.Settings?.populate?.();
    const videoRadius = document.getElementById("zs-video-preview-radius");
    if (videoRadius) {
      videoRadius.value = getPref(LOOK_PREFS.VIDEO_RADIUS, 0);
      videoRadius.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const panel = document.getElementById("zs-panel-bgalazka");
    panel?._toggles?.forEach(({ input, pref, def, onSync, isSelect }) => {
      const value = getPref(pref, def);
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
      ...Object.keys(PROFILE_DEFAULTS),
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
        PROFILE_DEFAULTS[key] ??
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
            BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
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
        if (typeof value === "boolean") Services.prefs.setBoolPref(key, value);
        else if (typeof value === "number")
          Services.prefs.setIntPref(key, value);
        else Services.prefs.setStringPref(key, value);
      }
    } catch (error) {
      for (const [key, { hadUserValue, value }] of previous) {
        try {
          if (Services.prefs.prefHasUserValue(key))
            Services.prefs.clearUserPref(key);
          if (hadUserValue) setPref(key, value);
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

  const rssSource = window.ZentralFeatureSources?.rss;
  let syncRssFolderDisplay = () => {};
  try {
    if (typeof rssSource === "function") {
      ({ syncRssFolderDisplay } = rssSource({
        EXT_PREFS, getPref, setInterval, clearInterval, registerCleanup,
      }));
      (window.ZentralFeatureStatus ||= Object.create(null)).rss = true;
    } else {
      console.warn("[BgalazkaExtension] RSS source missing; RSS controls unavailable");
    }
  } catch (error) {
    console.error("[BgalazkaExtension] RSS initialization failed:", error);
  }

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

      const restartSvg = parseSVG(
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
        restartBrowser();
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
        BGALAZKA_EXT_PREFS.TRANSLUCENCY,
        "bgalazka-translucency",
        false,
        PREF_ICONS.GLASS,
        (enabled) =>
          slidersGroup.setAttribute("data-hidden", enabled ? "false" : "true"),
      );
      content.appendChild(t1.row);

      const s1 = createSliderRow(
        "Unpinned Opacity",
        "Base solidness of standard floating panels",
        BGALAZKA_EXT_PREFS.OPACITY_UNPINNED,
        10,
        100,
        92,
        "%",
      );
      const s2 = createSliderRow(
        "Pinned Focus Opacity",
        "Solidness when hovering or interacting with pinned panels",
        BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS,
        10,
        100,
        85,
        "%",
      );
      const s3 = createSliderRow(
        "Pinned Idle Opacity",
        "Translucency limit when panel is pinned and unfocused",
        BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR,
        10,
        100,
        45,
        "%",
      );
      slidersGroup.append(s1.row, s2.row, s3.row);
      slidersGroup.setAttribute(
        "data-hidden",
        getPref(BGALAZKA_EXT_PREFS.TRANSLUCENCY, false) ? "false" : "true",
      );
      content.appendChild(slidersGroup);

      const tPanelInputShield = createToggleRow(
        "Prevent Panel Input Pass-Through",
        "Keep clicks inside an open panel and route mouse Back/Forward buttons to the focused panel instead of the webpage behind it",
        BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD,
        "bgalazka-panel-input-shield",
        false,
        PREF_ICONS.ISOLATION,
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
        BGALAZKA_EXT_PREFS.OPPOSITE_DOCKING,
        "bgalazka-opposite-docking",
        false,
        PREF_ICONS.DOCK,
        (enabled) => {
          syncHoverPanelAvailability();
        },
      );
      content.appendChild(t2.row);

      const tHoverReveal = createToggleRow(
        "Show Opposite-Side Panels on Hover",
        "Requires Opposite-Side Docking. Leave a panel to hide it, then hover the outer edge to reveal it",
        BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL,
        null,
        false,
        PREF_ICONS.HOVER_EYE,
        () => syncHoverPanelAvailability(),
      );
      content.appendChild(tHoverReveal.row);

      const tEdgeAttached = createToggleRow(
        "Edge-Attached Panels",
        "Dock every floating panel flush to its current screen edge and temporarily ignore saved panel margins/position offsets; does not pin or push the webpage",
        BGALAZKA_EXT_PREFS.EDGE_ATTACHED_PANELS,
        "bgalazka-edge-attached-panels",
        false,
        PREF_ICONS.DOCK,
        () => {
          const root = document.getElementById("zen-app-panel-root");
          applyVerticalResizeExtras(root);
          applyHorizontalPanelOffset(root);
        },
      );
      content.appendChild(tEdgeAttached.row);

      const tPush = createToggleRow(
        "Dual-View Mode",
        "Keep the panel open and contract the active webpage beside it; does not change your manual Pin state. Triple View has its own push choice on the pill button.",
        BGALAZKA_EXT_PREFS.PUSH_PAGE,
        "bgalazka-push-page",
        false,
        PREF_ICONS.PUSH,
      );
      content.appendChild(tPush.row);

      // Mirrors the pill button of the same name (note 16): both read/write
      // BGALAZKA_EXT_PREFS.ALL_SIDES_RESIZE, so this row's onChange keeps
      // the pill button's own data-active state in sync when toggled here.
      const tAllSidesResize = createToggleRow(
        "All-Sides Panel Resize",
        "Enable outer, inner, top, bottom, and corner resize handles; drag this pill button freely to move the whole panel in 2D",
        BGALAZKA_EXT_PREFS.ALL_SIDES_RESIZE,
        "bgalazka-all-sides-resize",
        false,
        PREF_ICONS.RESIZE_ALL,
        () => ensurePillAllSidesResizeButton(),
      );
      content.appendChild(tAllSidesResize.row);

      const panelHorizontalOffsetBounds = (() => {
        const root = document.getElementById("zen-app-panel-root");
        if (!root?.hasAttribute("open")) {
          const fallback = Math.max(1, window.innerWidth);
          return { min: -fallback, max: fallback };
        }
        applyHorizontalPanelOffset(root);
        return getHorizontalOffsetBounds(root);
      })();
      const panelHorizontalOffsetSlider = createSliderRow(
        "Panel Horizontal Offset",
        "Move the whole floating panel left/right without changing its width; limits are the actual window borders",
        BGALAZKA_EXT_PREFS.PANEL_HORIZONTAL_OFFSET,
        Math.floor(panelHorizontalOffsetBounds.min),
        Math.ceil(panelHorizontalOffsetBounds.max),
        getHorizontalOffsetPreference(
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
        BGALAZKA_EXT_PREFS.HIDE_PILL,
        "bgalazka-hide-pill",
        false,
        PREF_ICONS.PILL,
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
        BGALAZKA_EXT_PREFS.PILL_POSITION,
        -50,
        50,
        0,
        "%",
      );
      const tPeekDot = createToggleRow(
        "Show Mini Pill When Idle",
        "Keep a small colored version of the pill visible instead of fully autohiding",
        BGALAZKA_EXT_PREFS.PILL_PEEK_DOT,
        "bgalazka-pill-peek-dot",
        false,
        PREF_ICONS.PILL_POS,
      );
      const peekColorRow = createColorRow(
        "Mini Pill Color",
        "Background color used only for the shrunk idle pill (the expanded pill always uses black)",
        BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
        "#4da6ff",
      );
      const peekOpacitySlider = createSliderRow(
        "Mini Pill Opacity",
        "Controls only the shrunk idle mini pill; 100% is fully opaque",
        BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY,
        10,
        100,
        90,
        "%",
      );
      const pillBackgroundOpacitySlider = createSliderRow(
        "Pill Background Opacity",
        "Controls the expanded pill's black background independently from Mini Pill Opacity; icons remain fully opaque",
        BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY,
        10,
        100,
        90,
        "%",
      );
      const tDualView = createToggleRow(
        "Hide Dual-View Button",
        "Remove dual-view toggle from pill menu",
        BGALAZKA_EXT_PREFS.HIDE_DUAL_VIEW,
        "bgalazka-hide-dual-view",
        false,
        PREF_ICONS.PUSH,
      );
      const tHideHoverRevealBtn = createToggleRow(
        "Hide Show-on-Hover Pill Button",
        "Remove the eye button from the panel pill; use the setting above to enable hover reveal",
        BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
        "bgalazka-hide-hover-reveal-btn",
        false,
        PREF_ICONS.HOVER_EYE,
        () => syncHideHoverControls(),
      );
      const tHideHoverRevealBtnPillCategory = createToggleRow(
        "Hide Show-on-Hover Pill Button",
        "Remove the eye button from the panel pill",
        BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
        "bgalazka-hide-hover-reveal-btn",
        false,
        PREF_ICONS.HOVER_EYE,
        () => syncHideHoverControls(),
      );
      const syncHideHoverControls = () => {
        const hidden = getPref(BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN, false);
        tHideHoverRevealBtn.input.checked = hidden;
        tHideHoverRevealBtnPillCategory.input.checked = hidden;
        syncHoverPanelAvailability();
      };
      const tHideAllSidesResizeBtn = createToggleRow(
        "Hide All-Sides Resize Button",
        "Remove all-sides resize toggle from pill menu (the settings row above still works)",
        BGALAZKA_EXT_PREFS.HIDE_ALL_SIDES_RESIZE_BTN,
        "bgalazka-hide-all-sides-resize-btn",
        false,
        PREF_ICONS.RESIZE_ALL,
      );
      const tPin = createToggleRow(
        "Hide Pin Button",
        "Remove panel pinning toggle",
        BGALAZKA_EXT_PREFS.HIDE_PIN,
        "bgalazka-hide-pin",
        false,
        PREF_ICONS.PIN,
      );
      const t5 = createToggleRow(
        "Hide Expand / Restore Button",
        "Remove full-width panel expand toggle",
        BGALAZKA_EXT_PREFS.HIDE_EXPAND,
        "bgalazka-hide-expand",
        false,
        PREF_ICONS.EXPAND,
      );
      const tGrabber = createToggleRow(
        "Hide Resize Grabber Handle",
        "Remove the 6-dot drag-resize handle",
        BGALAZKA_EXT_PREFS.HIDE_GRABBER,
        "bgalazka-hide-grabber",
        false,
        PREF_ICONS.GRABBER,
      );
      const tRefresh = createToggleRow(
        "Hide Refresh Button",
        "Remove active web app reload button",
        BGALAZKA_EXT_PREFS.HIDE_REFRESH,
        "bgalazka-hide-refresh",
        false,
        PREF_ICONS.REFRESH,
      );
      const tClose = createToggleRow(
        "Hide Close Button",
        "Remove close 'X' button from pill menu",
        BGALAZKA_EXT_PREFS.HIDE_CLOSE,
        "bgalazka-hide-close",
        false,
        PREF_ICONS.CLOSE,
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
        getPref(BGALAZKA_EXT_PREFS.HIDE_PILL, false) ? "true" : "false",
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
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED,
        "bgalazka-webtoolbar",
        false,
        PREF_ICONS.TOOLBAR,
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
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_AUTOHIDE,
        "bgalazka-webtoolbar-autohide",
        false,
      );
      const tToolbarTop = createToggleRow(
        "Move Toolbar to Top of Panel",
        "Dock back/forward/reload/URL bar at the top of the web panel instead of the bottom",
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_TOP,
        "bgalazka-webtoolbar-top",
        false,
      );
      const tToolbarUrlbar = createToggleRow(
        "Show URL Bar",
        "Display and allow editing the current page's address",
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_URLBAR,
        "bgalazka-webtoolbar-urlbar",
        false,
      );
      const tToolbarZoom = createToggleRow(
        "Show Zoom Controls",
        "Add page zoom in/out/reset buttons to the toolbar",
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ZOOM,
        "bgalazka-webtoolbar-zoom",
        false,
      );

      // Custom engines are always visible in their dedicated category. This
      // makes creating a second engine discoverable instead of hiding the
      // fields behind the selected default and the quick-switch toggle.
      const customSearchSubgroup = document.createElement("div");
      customSearchSubgroup.className = "zs-search-engine-list zs-settings-card";
      const tSearchCustomUrl = createTextRow(
        "Custom Engine 1",
        'Must contain a literal "%s" placeholder for the search term, e.g. https://example.com/search?q=%s',
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_CUSTOM_URL,
        "https://example.com/search?q=%s",
        null,
        () => syncCustomSearchOptions(),
      );
      customSearchSubgroup.append(tSearchCustomUrl.row);

      const tSearchEngine = createSelectRow(
        "Default Search Engine",
        'Used when the URL bar text isn\'t a URL, e.g. typing "weather" instead of a full address',
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_ENGINE,
        [
          ...QUICK_SWITCH_BUILTIN_TARGETS.map(({ key, label }) => ({
            value: key,
            label,
          })),
          { value: "browser", label: "Browser Default" },
          { value: "custom", label: "Custom Engine 1" },
          ...QUICK_SWITCH_CUSTOM_PREFS.map((_, index) => ({
            value: `custom-${index + 2}`,
            label: `Custom Engine ${index + 2}`,
          })),
        ],
        "ddg",
        PREF_ICONS.SWAP,
        null, // no root attribute to mirror; only read via getPref() in buildSearchUrl()
        (value) => {
          // Re-fetch Firefox's own default engine right when the user
          // picks this mode, rather than only at startup, in case they
          // changed their system default engine since the browser opened.
          if (value === "browser") refreshBrowserSearchTemplate();
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

      const quickSwitchTargetRows = QUICK_SWITCH_BUILTIN_TARGETS.map(
        (target, index) =>
          createToggleRow(
            target.label,
            "Include in the Quick-Switch cycle",
            QUICK_SWITCH_TARGET_PREF_PREFIX + target.key,
            null,
            index < 2,
            null,
          ),
      );
      const quickSwitchCustomRows = QUICK_SWITCH_CUSTOM_PREFS.map(
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
        SEARCH_CUSTOM_ENGINE_PREFS.forEach((pref, index) => {
          const value = index === 0 ? "custom" : `custom-${index + 1}`;
          const option = Array.from(tSearchEngine.select.options).find(
            (o) => o.value === value,
          );
          if (!option) return;
          option.disabled = !isValidQuickSwitchTemplate(getPref(pref, ""));
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
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH,
        null,
        false,
        PREF_ICONS.SWAP,
        (enabled) =>
          quickSwitchTargetsSubgroup.setAttribute(
            "data-hidden",
            enabled ? "false" : "true",
          ),
      );
      quickSwitchTargetsSubgroup.setAttribute(
        "data-hidden",
        getPref(BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH, false)
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
        getPref(BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED, false)
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
        BGALAZKA_EXT_PREFS.ADDON_TAB_ID_BRIDGE,
        "bgalazka-addon-tab-id-bridge",
        false,
        PREF_ICONS.PIN,
        (enabled) => setAddonTabIdBridgeEnabled(enabled),
      );
      content.appendChild(tAddonTabIdBridge.row);
      const tZenInternetCss = createToggleRow(
        "Use Zen Internet CSS in Web Panels (experimental)",
        "Read Zen Internet's locally stored styles and its global, per-site, skip-list, and feature settings. Apply them only inside Zentral web panels. Zentral makes no network requests for styles and never selects tabs or changes Zen Internet's storage. Real Tab IDs are optional.",
        BGALAZKA_EXT_PREFS.ZEN_INTERNET_PANEL_CSS,
        "bgalazka-zen-internet-panel-css",
        false,
        PREF_ICONS.REFRESH,
        (enabled) => setZenInternetPanelCssEnabled(enabled),
      );
      content.appendChild(tZenInternetCss.row);
      const tShowTripleStyleRepair = createToggleRow(
        "Show Triple View Style Repair Button",
        "Show the manual repair control at the end of the primary panel URL bar while Triple View is populated. Leave this off when the automatic document-generation styling fix is working normally.",
        BGALAZKA_EXT_PREFS.SHOW_TRIPLE_STYLE_REPAIR,
        null,
        false,
        PREF_ICONS.REPAIR_STYLE,
        () => updateWebToolbarState(),
      );
      content.appendChild(tShowTripleStyleRepair.row);
      const tPeriodicFallbackPolling = createToggleRow(
        "Periodic Fallback Polling",
        "Enable low-frequency safety polling for panel activation/CSS health plus primary and secondary toolbar state. Normal loads, navigation, styling, audio and panel lifecycle remain event-driven with this off. Turn it on only if your Zen build still develops stale or gray panels/UI over time.",
        BGALAZKA_EXT_PREFS.PERIODIC_FALLBACK_POLLING,
        null,
        false,
        PREF_ICONS.REFRESH,
        () => {
          startWebToolbarPolling();
          syncPanelFallbackPolling();
          syncSecondaryFallbackPolling();
        },
      );
      content.appendChild(tPeriodicFallbackPolling.row);
      const tShowAddonHostFolder = createToggleRow(
        "Show Web Panel Tab ID Folder",
        "Reveal the Zentral Add-on Hosts folder and its tabs in the sidebar so you can check whether panel host tabs are cleaned up. Requires Real Tab IDs for Web Panels to create host tabs.",
        BGALAZKA_EXT_PREFS.SHOW_ADDON_HOST_FOLDER,
        "bgalazka-show-addon-host-folder",
        false,
        PREF_ICONS.PIN,
        () => {
          keepAddonHostFolderCollapsed(findAddonHostFolder());
          updateAddonHostInspection();
        },
      );
      content.appendChild(tShowAddonHostFolder.row);
      const addonHostInspection = document.createElement("div");
      addonHostInspection.id = "zs-addon-host-inspection";
      addonHostInspection.className = "zs-sublabel";
      addonHostInspection.style.cssText =
        "padding:4px 12px 12px;white-space:normal";
      content.appendChild(addonHostInspection);
      updateAddonHostInspection();

      const audioIndicator = createToggleRow(
        "Panel Audio Indicator and Quick Mute",
        "Show audio on panel launcher buttons and quick mute in the URL bar; silent panels have no audio control",
        BGALAZKA_EXT_PREFS.AUDIO_INDICATOR,
        null,
        false,
        PREF_ICONS.SOUND || PREF_ICONS.ISOLATION,
        () => {
          ensureNativeAudioButton();
          refreshPanelAudio();
        },
      );
      content.appendChild(audioIndicator.row);
      const smartSleep = createToggleRow(
        "Smart Sleep (defer preloads)",
        "Defer configured background panel preloads at startup; opened panels keep running",
        BGALAZKA_EXT_PREFS.SMART_SLEEP,
        null,
        false,
        PREF_ICONS.ISOLATION,
        () => requestTileSync(0),
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
        BGALAZKA_EXT_PREFS.MMB_UNLOAD_NORMAL_TABS,
        null,
        false,
        PREF_ICONS.TOOLBAR,
      );
      content.appendChild(tMmbUnloadNormalTabs.row);

      const tKeybindsEnabled = createToggleRow(
        "Enable Extension Keybinds",
        "Shortcuts only apply while the floating app panel is open and focused; click any binding below and press a new combination",
        BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED,
        null,
        false,
        PREF_ICONS.TOOLBAR,
        (enabled) => {
          keybindSubgroup.setAttribute(
            "data-hidden",
            enabled ? "false" : "true",
          );
          if (enabled) {
            setPref(BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, true);
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
          BGALAZKA_EXT_PREFS.KEYBIND_CLOSE_PANEL,
          EXT_KEYBIND_DEFAULTS.CLOSE_PANEL,
        ],
        [
          "Back",
          "Navigate the focused panel back",
          BGALAZKA_EXT_PREFS.KEYBIND_BACK,
          EXT_KEYBIND_DEFAULTS.BACK,
        ],
        [
          "Forward",
          "Navigate the focused panel forward",
          BGALAZKA_EXT_PREFS.KEYBIND_FORWARD,
          EXT_KEYBIND_DEFAULTS.FORWARD,
        ],
        [
          "Reload",
          "Reload the focused app page",
          BGALAZKA_EXT_PREFS.KEYBIND_RELOAD,
          EXT_KEYBIND_DEFAULTS.RELOAD,
        ],
        [
          "Focus Panel URL Bar",
          "Focus/select the extension URL bar when that toolbar and URL bar are enabled",
          BGALAZKA_EXT_PREFS.KEYBIND_FOCUS_URL,
          EXT_KEYBIND_DEFAULTS.FOCUS_URL,
        ],
        [
          "Toggle Pin",
          "Pin or unpin the focused panel",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_PIN,
          EXT_KEYBIND_DEFAULTS.TOGGLE_PIN,
        ],
        [
          "Expand / Restore",
          "Toggle full-width panel expansion",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_EXPAND,
          EXT_KEYBIND_DEFAULTS.TOGGLE_EXPAND,
        ],
        [
          "Toggle Dual-View",
          "Turn Dual-View page push on/off",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_DUAL_VIEW,
          EXT_KEYBIND_DEFAULTS.TOGGLE_DUAL_VIEW,
        ],
        [
          "Toggle All-Sides Resize",
          "Enable/disable extension resize handles",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_RESIZE,
          EXT_KEYBIND_DEFAULTS.TOGGLE_RESIZE,
        ],
        [
          "Toggle Navigation Toolbar",
          "Show/hide the extension web navigation toolbar",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_TOOLBAR,
          EXT_KEYBIND_DEFAULTS.TOGGLE_TOOLBAR,
        ],
        [
          "Toggle Panel Translucency",
          "Enable/disable extension panel translucency",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_TRANSLUCENCY,
          EXT_KEYBIND_DEFAULTS.TOGGLE_TRANSLUCENCY,
        ],
        [
          "Toggle Opposite-Side Docking",
          "Switch extension opposite-side docking on/off",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_OPPOSITE_DOCKING,
          EXT_KEYBIND_DEFAULTS.TOGGLE_OPPOSITE_DOCKING,
        ],
        [
          "Toggle Edge-Attached Panels",
          "Attach/detach the panel from its current window edge",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_EDGE_ATTACHED,
          EXT_KEYBIND_DEFAULTS.TOGGLE_EDGE_ATTACHED,
        ],
        [
          "Toggle Input Pass-Through Shield",
          "Enable/disable the extension panel input barrier",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_INPUT_SHIELD,
          EXT_KEYBIND_DEFAULTS.TOGGLE_INPUT_SHIELD,
        ],
        [
          "Zoom In",
          "Increase zoom of the focused app page",
          BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_IN,
          EXT_KEYBIND_DEFAULTS.ZOOM_IN,
        ],
        [
          "Zoom Out",
          "Decrease zoom of the focused app page",
          BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_OUT,
          EXT_KEYBIND_DEFAULTS.ZOOM_OUT,
        ],
        [
          "Reset Zoom",
          "Reset focused app page zoom to 100%",
          BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_RESET,
          EXT_KEYBIND_DEFAULTS.ZOOM_RESET,
        ],
        [
          "Open Zentral Settings",
          "Open Zentral Settings from the focused app panel",
          BGALAZKA_EXT_PREFS.KEYBIND_OPEN_SETTINGS,
          EXT_KEYBIND_DEFAULTS.OPEN_SETTINGS,
        ],
      ].map(([label, description, pref, def]) =>
        createKeybindRow(label, description, pref, def),
      );
      keybindRows.forEach(({ row }) => keybindSubgroup.appendChild(row));
      keybindSubgroup.setAttribute(
        "data-hidden",
        getPref(BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED, false) ? "false" : "true",
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
        BGALAZKA_EXT_PREFS.CORNER_TILES,
        "bgalazka-corner-tiles",
        false,
        PREF_ICONS.CORNER,
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
        BGALAZKA_EXT_PREFS.ALL_TAB_PANELS,
        "bgalazka-all-tab-panels",
        false,
        PREF_ICONS.CORNER,
        () => requestTileSync(0),
      );
      const tHoverCorner = createToggleRow(
        "Show Tab Panel Launchers on Hover",
        "Hide panel buttons until tab hover; normal tabs keep their favicon and gain a blue launcher outline on hover",
        BGALAZKA_EXT_PREFS.HOVER_CORNER_TILES,
        "bgalazka-hover-corner-tiles",
        false,
        PREF_ICONS.HOVER_EYE,
      );
      const t3 = createToggleRow(
        "Show Loaded Panel Dot on Tabs",
        "Show a dot on ordinary tabs with loaded panels. Essential panel buttons gray out when their panels unload",
        BGALAZKA_EXT_PREFS.TAB_ISOLATION,
        "bgalazka-tab-isolation",
        true,
        PREF_ICONS.ISOLATION,
      );
      const tBadges = createToggleRow(
        "Hide Corner Notification Badges",
        "Suppress unread indicators and counter badges on tab corner tiles",
        BGALAZKA_EXT_PREFS.HIDE_CORNER_BADGES,
        "bgalazka-hide-corner-badges",
        false,
        PREF_ICONS.BADGE,
      );
      cornerSubgroup.append(
        tAllTabs.row,
        tHoverCorner.row,
        t3.row,
        tBadges.row,
      );
      cornerSubgroup.setAttribute(
        "data-hidden",
        getPref(BGALAZKA_EXT_PREFS.CORNER_TILES, false) ? "false" : "true",
      );
      content.appendChild(cornerSubgroup);

      const tHideUnattached = createToggleRow(
        "Hide Unattached App Controls",
        "Hide standalone app buttons, Add App, and the three-dot utility controls; tab-attached panel launchers remain available",
        BGALAZKA_EXT_PREFS.HIDE_UNATTACHED_APP_CONTROLS,
        "bgalazka-hide-unattached-app-controls",
        false,
        PREF_ICONS.CORNER,
      );
      content.appendChild(tHideUnattached.row);

      panel._toggles.push(
        ...[s1, s2, s3].map(({ input, badge }, index) => ({
          input,
          pref: [
            BGALAZKA_EXT_PREFS.OPACITY_UNPINNED,
            BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS,
            BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR,
          ][index],
          def: [92, 85, 45][index],
          isSelect: true,
          onSync: (v) => {
            badge.textContent = v + "%";
          },
        })),
        {
          input: t1.input,
          pref: BGALAZKA_EXT_PREFS.TRANSLUCENCY,
          def: false,
          onSync: (v) =>
            slidersGroup.setAttribute("data-hidden", v ? "false" : "true"),
        },
        {
          input: tPanelInputShield.input,
          pref: BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD,
          def: false,
        },
        {
          input: t2.input,
          pref: BGALAZKA_EXT_PREFS.OPPOSITE_DOCKING,
          def: false,
          onSync: () => syncHoverPanelAvailability(),
        },
        {
          input: tHoverReveal.input,
          pref: BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL,
          def: false,
          onSync: () => syncHoverPanelAvailability(),
        },
        {
          input: tEdgeAttached.input,
          pref: BGALAZKA_EXT_PREFS.EDGE_ATTACHED_PANELS,
          def: false,
          onSync: () => {
            const root = document.getElementById("zen-app-panel-root");
            applyVerticalResizeExtras(root);
            applyHorizontalPanelOffset(root);
          },
        },
        { input: tPush.input, pref: BGALAZKA_EXT_PREFS.PUSH_PAGE, def: false },
        {
          input: tAllSidesResize.input,
          pref: BGALAZKA_EXT_PREFS.ALL_SIDES_RESIZE,
          def: false,
          onSync: () => ensurePillAllSidesResizeButton(),
        },
        {
          input: panelHorizontalOffsetSlider.input,
          pref: BGALAZKA_EXT_PREFS.PANEL_HORIZONTAL_OFFSET,
          def: getHorizontalOffsetPreference(
            document.getElementById("zen-app-panel-root"),
          ),
          isSelect: true,
          onSync: (v) => {
            const root = document.getElementById("zen-app-panel-root");
            setCachedHorizontalOffset(v);
            if (root) {
              applyHorizontalPanelOffset(root);
              const applied = Math.round(getAppliedHorizontalOffset(root));
              const { min, max } = getHorizontalOffsetBounds(root);
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
          pref: BGALAZKA_EXT_PREFS.HIDE_PILL,
          def: false,
          onSync: (v) =>
            pillSubgroup.setAttribute("data-hidden", v ? "true" : "false"),
        },
        {
          input: pillPosSlider.input,
          pref: BGALAZKA_EXT_PREFS.PILL_POSITION,
          def: 0,
          isSelect: true, // reused flag: means "sync via .value", true for <select> and <input type=range> alike
          onSync: (v) => {
            pillPosSlider.badge.textContent = v + "%";
            updateCSSVars();
          },
        },
        {
          input: tPeekDot.input,
          pref: BGALAZKA_EXT_PREFS.PILL_PEEK_DOT,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-pill-peek-dot",
              v ? "true" : "false",
            ),
        },
        {
          input: peekColorRow.input,
          pref: BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
          def: "#4da6ff",
          isSelect: true, // reused flag: sync via .value, same as color/range inputs
          onSync: () => updateCSSVars(),
        },
        {
          input: peekOpacitySlider.input,
          pref: BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY,
          def: 90,
          isSelect: true, // reused flag: sync via .value, same as slider/color inputs
          onSync: (v) => {
            peekOpacitySlider.badge.textContent = v + "%";
            updateCSSVars();
          },
        },
        {
          input: pillBackgroundOpacitySlider.input,
          pref: BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY,
          def: 90,
          isSelect: true,
          onSync: (v) => {
            pillBackgroundOpacitySlider.badge.textContent = v + "%";
            updateCSSVars();
          },
        },
        {
          input: tWebToolbar.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED,
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
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_AUTOHIDE,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-webtoolbar-autohide",
              v ? "true" : "false",
            ),
        },
        {
          input: tToolbarTop.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_TOP,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-webtoolbar-top",
              v ? "true" : "false",
            ),
        },
        {
          input: tToolbarUrlbar.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_URLBAR,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-webtoolbar-urlbar",
              v ? "true" : "false",
            ),
        },
        {
          input: tToolbarZoom.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ZOOM,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-webtoolbar-zoom",
              v ? "true" : "false",
            ),
        },
        {
          input: tSearchEngine.select,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_ENGINE,
          def: "ddg",
          isSelect: true,
          onSync: (v) => {
            syncCustomSearchOptions();
            if (v === "browser") refreshBrowserSearchTemplate();
          },
        },
        {
          input: tSearchCustomUrl.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_CUSTOM_URL,
          def: "",
          isSelect: true, // reused flag: means "sync via .value", true for text inputs too
        },
        {
          input: tQuickswitch.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH,
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
            QUICK_SWITCH_TARGET_PREF_PREFIX +
            QUICK_SWITCH_BUILTIN_TARGETS[index].key,
          def: index < 2,
        })),
        ...quickSwitchCustomRows.map(({ input }, index) => ({
          input,
          pref: QUICK_SWITCH_CUSTOM_PREFS[index],
          def: "",
          isSelect: true,
        })),
        {
          input: tDualView.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_DUAL_VIEW,
          def: false,
        },
        {
          input: tHideHoverRevealBtn.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
          def: false,
          onSync: () => syncHoverPanelAvailability(),
        },
        {
          input: tHideHoverRevealBtnPillCategory.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
          def: false,
        },
        {
          input: tHideAllSidesResizeBtn.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_ALL_SIDES_RESIZE_BTN,
          def: false,
        },
        { input: tPin.input, pref: BGALAZKA_EXT_PREFS.HIDE_PIN, def: false },
        { input: t5.input, pref: BGALAZKA_EXT_PREFS.HIDE_EXPAND, def: false },
        {
          input: tGrabber.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_GRABBER,
          def: false,
        },
        {
          input: tRefresh.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_REFRESH,
          def: false,
        },
        {
          input: tClose.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_CLOSE,
          def: false,
        },
        {
          input: audioIndicator.input,
          pref: BGALAZKA_EXT_PREFS.AUDIO_INDICATOR,
          def: false,
        },
        {
          input: smartSleep.input,
          pref: BGALAZKA_EXT_PREFS.SMART_SLEEP,
          def: false,
        },
        {
          input: tAddonTabIdBridge.input,
          pref: BGALAZKA_EXT_PREFS.ADDON_TAB_ID_BRIDGE,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-addon-tab-id-bridge",
              v ? "true" : "false",
            ),
        },
        {
          input: tZenInternetCss.input,
          pref: BGALAZKA_EXT_PREFS.ZEN_INTERNET_PANEL_CSS,
          def: false,
        },
        {
          input: tShowTripleStyleRepair.input,
          pref: BGALAZKA_EXT_PREFS.SHOW_TRIPLE_STYLE_REPAIR,
          def: false,
          onSync: () => updateWebToolbarState(),
        },
        {
          input: tPeriodicFallbackPolling.input,
          pref: BGALAZKA_EXT_PREFS.PERIODIC_FALLBACK_POLLING,
          def: false,
        },
        {
          input: tShowAddonHostFolder.input,
          pref: BGALAZKA_EXT_PREFS.SHOW_ADDON_HOST_FOLDER,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-show-addon-host-folder",
              v ? "true" : "false",
            ),
        },
        {
          input: tMmbUnloadNormalTabs.input,
          pref: BGALAZKA_EXT_PREFS.MMB_UNLOAD_NORMAL_TABS,
          def: false,
        },
        {
          input: tKeybindsEnabled.input,
          pref: BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED,
          def: false,
          onSync: (v) => {
            keybindSubgroup.setAttribute("data-hidden", v ? "false" : "true");
            if (v) {
              setPref(BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, true);
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
          pref: EXT_KEYBIND_ACTIONS[index].pref,
          def: EXT_KEYBIND_DEFAULTS[EXT_KEYBIND_ACTIONS[index].key],
          isSelect: true,
        })),
        {
          input: t4.input,
          pref: BGALAZKA_EXT_PREFS.CORNER_TILES,
          def: false,
          onSync: (v) =>
            cornerSubgroup.setAttribute("data-hidden", v ? "false" : "true"),
        },
        {
          input: tAllTabs.input,
          pref: BGALAZKA_EXT_PREFS.ALL_TAB_PANELS,
          def: false,
          onSync: () => requestTileSync(0),
        },
        {
          input: tHoverCorner.input,
          pref: BGALAZKA_EXT_PREFS.HOVER_CORNER_TILES,
          def: false,
        },
        {
          input: tHideUnattached.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_UNATTACHED_APP_CONTROLS,
          def: false,
        },
        { input: t3.input, pref: BGALAZKA_EXT_PREFS.TAB_ISOLATION, def: true },
        {
          input: tBadges.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_CORNER_BADGES,
          def: false,
        },
      );

      // Bulk actions change only boolean feature controls. Slider values,
      // search URLs, shortcut assignments, and saved panel geometry survive.
      // Clicking each control runs its existing live-update handler.
      const presetActions = document.createElement("div");
      presetActions.className = "zs-extension-presets";
      const recommendedExceptions = new Set([
        BGALAZKA_EXT_PREFS.EDGE_ATTACHED_PANELS,
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_TOP,
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_AUTOHIDE,
        BGALAZKA_EXT_PREFS.ADDON_TAB_ID_BRIDGE,
        BGALAZKA_EXT_PREFS.SHOW_ADDON_HOST_FOLDER,
        EXT_PREFS.TABBAR_COMPACT,
        EXT_PREFS.RSS_HIDE_EMPTY,
        EXT_PREFS.RSS_COMPACT_HEADERS,
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
      customEnginesHeader.className = "zs-section-header zs-subsection-header";
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
      const developerCategory = makeExtensionSettingsPanel(
        "zs-panel-extension-developer",
        "extension-developer",
      );
      const devHeader = document.createElement("div");
      devHeader.className = "zs-section-header";
      const devTitle = document.createElement("h3");
      devTitle.className = "zs-section-title";
      devTitle.textContent = "Developer & troubleshooting";
      devHeader.append(devTitle);
      const devNote = document.createElement("p");
      devNote.className = "zs-sublabel";
      devNote.textContent = "Checks what is running now and lets you exclude optional JS and CSS files on the next browser restart. Required bootstrap files stay locked so you can reopen this page. Normal feature switches still apply immediately.";
      const devChecklist = document.createElement("div");
      devChecklist.id = "zs-extension-load-checklist";
      devChecklist.className = "zs-sublabel";
      devChecklist.style.cssText = "display:grid;gap:8px;padding:10px 2px;white-space:normal";
      const fileControls = window.ZentralFeatureSources?.devFileControls?.();
      const devFileFeedback = document.createElement("p");
      devFileFeedback.className = "zs-sublabel";
      devFileFeedback.textContent = fileControls
        ? "File switches take effect after restarting Zen."
        : "File controls are unavailable: ZentralDevFileControls.uc.js did not load.";
      let refreshGeneration = 0;
      const refreshDevChecklist = async () => {
        const generation = ++refreshGeneration;
        let fileState = null;
        if (fileControls) {
          try {
            fileState = await fileControls.getState();
            if (generation !== refreshGeneration) return;
            devFileFeedback.textContent = `Editing Sine installation “${fileState.id}”. Changes take effect after restarting Zen.`;
          } catch (error) {
            devFileFeedback.textContent = `File controls unavailable: ${error.message}`;
          }
        }
        if (generation !== refreshGeneration) return;
        const base = Boolean(window.Zentral?.Apps);
        const extension = Boolean(window.BgalazkaExtensionInitialized);
        const isolationSource = typeof window.ZentralFeatureSources?.tileIsolation === "function";
        const isolationReady = Boolean(window.ZentralFeatureStatus?.tileIsolation);
        const rssSource = typeof window.ZentralFeatureSources?.rss === "function";
        const viewSource = typeof window.ZentralFeatureSources?.secondaryViews === "function";
        const rssReady = Boolean(window.ZentralFeatureStatus?.rss);
        const viewsReady = Boolean(window.ZentralFeatureStatus?.secondaryViews);
        const video = Boolean(window.ZentralVideoPreview);
        const status = window.ZentralFeatureStatus || {};
        const style = window.getComputedStyle?.(document.documentElement);
        const cssLoaded = (name) =>
          style?.getPropertyValue(`--zentral-css-${name}`).trim() === "1";
        const checks = [
          { file: "zentral_logger.uc.js", order: 1,
            status: window.ZentralLogger ? "loaded" : "optional",
            needs: "None", impact: "Base uses the console if this logger is absent." },
          { file: "ZentralApps.uc.js", order: 2,
            status: window.ZentralClassStatus?.apps ? "loaded" : "missing",
            needs: "Zentral.uc.js initializes the complete class",
            impact: "Apps grid and web panel engine." },
          { file: "ZentralTabGroups.uc.js", order: 3,
            status: window.ZentralClassStatus?.tabGroups ? "loaded" : "missing",
            needs: "Zentral.uc.js initializes the complete class",
            impact: "Tab groups and folders." },
          { file: "ZentralSettings.uc.js", order: 4,
            status: window.ZentralClassStatus?.settings ? "loaded" : "missing",
            needs: "Zentral.uc.js initializes the complete class",
            impact: "Base settings modal and extension settings host." },
          { file: "Zentral.uc.js", order: 10,
            status: base ? "loaded" : "missing", css: "ZentralBase.css", needs: "None",
            impact: "Core and bootstrap join the three base classes." },
          { file: "ZentralPanelGeometry.uc.js", order: 11,
            status: status.panelGeometry ? "loaded" : "missing",
            css: "ZentralPanelResize.css", needs: "Zentral Apps panel root",
            impact: "Panel resizing, positioning, and pill dragging." },
          { file: "ZentralTileIsolation.uc.js", order: 12,
            status: !isolationSource ? "missing" : isolationReady ? "loaded" : "inactive",
            css: "ZentralCornerPanels.css", needs: "BgalazkaExtension.uc.js; Zentral Apps grid",
            impact: "Corner tiles lose their tab-click isolation if missing." },
          { file: "ZentralRssDisplay.uc.js", order: 14,
            status: !rssSource ? "missing" : rssReady ? "loaded" : "inactive",
            css: "ZentralRssDisplay.css",
            needs: "BgalazkaExtension.uc.js initializes it",
            impact: "Only RSS sidebar display controls are unavailable if missing." },
          { file: "ZentralSecondaryViews.uc.js", order: 15,
            status: !viewSource ? "missing" : viewsReady ? "loaded" : "inactive",
            css: "ZentralControls.css",
            needs: "Zentral.uc.js → BgalazkaExtension.uc.js",
            impact: "Triple view and super pin are unavailable if missing." },
          { file: "ZentralCornerPanels.uc.js", order: 13,
            status: status.cornerPanels ? "loaded" : "missing",
            css: "ZentralCornerPanels.css", needs: "Zentral.uc.js; tile isolation for safe tab clicks",
            impact: "Essential and corner panel launchers need both parts." },
          { file: "ZentralWebToolbar.uc.js", order: 16,
            status: status.webToolbar ? "loaded" : "missing",
            css: "ZentralWebToolbar.css", needs: "Zentral.uc.js; extension prefs",
            impact: "URL bar, search switcher, navigation and toolbar presentation." },
          { file: "ZentralExtensionSettings.uc.js", order: 17,
            status: status.extensionSettings ? "loaded" : "missing",
            css: "ZentralSettings.css", needs: "Base Settings and extension feature APIs",
            impact: "Provides these extension settings categories and live controls." },
          { file: "ZentralDevFileControls.uc.js", order: 17.5,
            status: typeof window.ZentralFeatureSources?.devFileControls === "function" ? "loaded" : "missing",
            needs: "Sine metadata and CSS entrypoint; extension settings host",
            impact: "Keeps the Developer file switches available after a restart." },
          { file: "BgalazkaExtension.uc.js", order: 20,
            status: !extension ? "missing" : "loaded",
            css: "ZentralPanelLayout.css", needs: "Zentral.uc.js; the registered feature files",
            impact: "Other extension features still run if one optional feature source is missing." },
          { file: "ZentralBrowserIntegrations.uc.js", order: 18,
            status: status.browserIntegrations ? "loaded" : "missing",
            css: "ZentralIntegration.css", needs: "Zentral Apps browser creation",
            impact: "Containers, panel privacy, and add-on tab ID hosts share this boundary." },
          { file: "ZentralPanelStyleBridge.uc.js", order: 19,
            status: status.panelStyleBridge ? "loaded" : "missing",
            css: "ZentralLook.css", needs: "Zentral Apps panel browsers",
            impact: "Zen Internet panel styling uses this bridge; Look CSS is shared." },
          { file: "ZentralVideoPreview.uc.js", order: 30,
            status: video ? "loaded" : "missing", css: "ZentralVideoPreview.css",
            needs: "Independent; Zentral Settings only for its settings tab",
            impact: "Video preview runs when its own toggle is enabled." },
        ];
        devChecklist.replaceChildren();
        for (const check of checks) {
          const card = document.createElement("div");
          card.style.cssText = "padding:10px 12px;border:1px solid rgba(145,155,170,.3);border-radius:9px;background:rgba(120,130,150,.08)";
          const title = document.createElement("div");
          title.style.cssText = "display:flex;justify-content:space-between;gap:12px;font-weight:600";
          const name = document.createElement("span");
          name.textContent = `${check.order} · ${check.file}`;
          const badge = document.createElement("span");
          badge.textContent = check.status === "loaded" ? "● Loaded" :
            check.status === "partial" ? "◐ Partial" :
            check.status === "optional" ? "○ Optional" :
            check.status === "inactive" ? "◌ Inactive" : "✕ Missing";
          badge.style.color = check.status === "loaded" ? "#59c88a" :
            check.status === "missing" ? "#ee7777" : "#e5b85e";
          title.append(name, badge);
          const css = document.createElement("div");
          if (check.css) {
            const loaded = cssLoaded(check.css.replace(/^Zentral|\.css$/g, "").toLowerCase());
            css.textContent = `${loaded ? "●" : "✕"} CSS/${check.css}: ${loaded ? "applied" : "missing"}`;
            css.style.color = loaded ? "#59c88a" : "#ee7777";
          }
          const needs = document.createElement("div");
          needs.textContent = `↳ Needs: ${check.needs}`;
          const impact = document.createElement("div");
          impact.textContent = check.impact;
          impact.style.opacity = ".8";
          card.append(title);
          if (check.css) card.append(css);
          card.append(needs, impact);
          const locked = fileControls?.lockedScripts.has(check.file);
          const switchRow = document.createElement("label");
          switchRow.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:5px";
          const switchInput = document.createElement("input");
          switchInput.type = "checkbox";
          switchInput.checked = fileState?.scriptEnabled[check.file] ?? true;
          switchInput.disabled = !fileState || locked;
          const switchText = document.createElement("span");
          switchText.textContent = locked ? "Required for settings/startup" :
            `Load JS on restart${fileState && switchInput.checked !== (check.status === "loaded") ? " · pending restart" : ""}`;
          switchInput.addEventListener("change", async () => {
            switchInput.disabled = true;
            try {
              await fileControls.setScript(check.file, switchInput.checked);
              await refreshDevChecklist();
            } catch (error) {
              devFileFeedback.textContent = `Could not change JS/${check.file}: ${error.message}`;
              switchInput.checked = !switchInput.checked;
              switchInput.disabled = false;
            }
          });
          switchRow.append(switchInput, switchText);
          card.append(switchRow);
          devChecklist.append(card);
        }
        const shared = document.createElement("div");
        shared.style.cssText = "padding:10px 12px;border:1px solid rgba(145,155,170,.3);border-radius:9px";
        const heading = document.createElement("strong");
        heading.textContent = "CSS fragments · next restart";
        shared.append(heading);
        for (const file of fileControls?.cssFiles || []) {
          const loaded = cssLoaded(file.replace(/^Zentral|\.css$/g, "").toLowerCase());
          const line = document.createElement("label");
          line.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = fileState?.cssEnabled[file] ?? true;
          input.disabled = !fileState;
          const caption = document.createElement("span");
          caption.textContent = `${loaded ? "● Applied" : "✕ Missing"} · CSS/${file}${fileState && input.checked !== loaded ? " · pending restart" : ""}`;
          input.addEventListener("change", async () => {
            input.disabled = true;
            try {
              await fileControls.setCss(file, input.checked);
              await refreshDevChecklist();
            } catch (error) {
              devFileFeedback.textContent = `Could not change CSS/${file}: ${error.message}`;
              input.checked = !input.checked;
              input.disabled = false;
            }
          });
          line.append(input, caption);
          shared.append(line);
        }
        devChecklist.append(shared);
      };
      const refreshDevButton = document.createElement("button");
      refreshDevButton.type = "button";
      refreshDevButton.className = "zs-look-action";
      refreshDevButton.textContent = "Refresh load check";
      refreshDevButton.addEventListener("click", refreshDevChecklist);
      developerCategory.subPanel._refreshLoadCheck = refreshDevChecklist;
      developerCategory.subContent.append(
        devHeader, devNote, devFileFeedback, devChecklist, refreshDevButton,
        tPeriodicFallbackPolling.row,
        tShowTripleStyleRepair.row,
        tShowAddonHostFolder.row,
        addonHostInspection,
        restartBtn,
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
        EXT_PREFS.RSS_HIDE_EMPTY,
        null,
        false,
        null,
        syncRssFolderDisplay,
      );
      const rssCompact = createToggleRow(
        "Compact live-folder headers",
        "Reduce the height and spacing of live-folder rows, including folders that have articles.",
        EXT_PREFS.RSS_COMPACT_HEADERS,
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
          pref: EXT_PREFS.RSS_HIDE_EMPTY,
          def: false,
        },
        {
          input: rssCompact.input,
          pref: EXT_PREFS.RSS_COMPACT_HEADERS,
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
          getPref(LOOK_PREFS.STYLE, "atelier") === "classic"
        ) {
          setPref(LOOK_PREFS.STYLE, "atelier");
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
          key !== LOOK_PREFS.TABBAR_ICON_GAP
        )
          control.input.addEventListener("input", () => ensureCustomLook(key));
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
          const value = getPref(key, LOOK_DEFAULTS[key]);
          input.value = inverted ? 100 - value : value;
          if (badge) badge.textContent = input.value + suffix;
        }
      };
      lookCategory.subPanel._syncLook = syncLookControls;
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
              key === LOOK_PREFS.TABBAR_ICON_GAP
            )
              continue;
            if (
              key.startsWith("zen.workspace.bgalazka.look.") ||
              key === LOOK_PREFS.VIDEO_RADIUS
            )
              setPref(key, theme.values[key] ?? value);
            else if (Object.hasOwn(theme.values, key))
              setPref(key, theme.values[key]);
          }
          syncAppearanceAfterImport();
        });
        themeChoices.append(choice);
      }
      lookCategory.subContent.append(themeChoices);
      addLookHeading("Palette");
      addLookColor("Canvas", "Backdrop behind the controls", LOOK_PREFS.CANVAS);
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
        setPref(
          LOOK_GROUP_PREFS.LABEL_OPACITY,
          Number(groupOpacityInput.value),
        ),
      );
      const indicatorToggle = modal.querySelector("#zs-tg-chevron");
      indicatorToggle?.addEventListener("change", () => {
        setPref(LOOK_GROUP_PREFS.SHOW_CHEVRON, indicatorToggle.checked);
        window.Zentral?.TabGroups?.applyChevronPref?.();
      });
      groupIndicator
        ?.querySelectorAll(".zs-custom-select-option")
        .forEach((option) =>
          option.addEventListener("click", () => {
            setPref(LOOK_GROUP_PREFS.INDICATOR_TYPE, option.dataset.value);
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
          setPref(key, value);
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
        developerCategory.subPanel,
      );
      registerCleanup(() => {
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
          input.value = getPref(pref, def);
        } else {
          input.checked = getPref(pref, def);
        }
        if (typeof onSync === "function") {
          onSync(isSelect ? input.value : input.checked);
        }
      });
    }

    modal.querySelector("#zs-panel-extension-look")?._syncLook?.();
    modal.querySelector("#zs-panel-extension-developer")?._refreshLoadCheck?.();
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
      {
        buttonId: "zs-tab-btn-extension-developer",
        panelId: "zs-panel-extension-developer",
        dataTab: "extension-developer",
        label: "Developer",
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
      registerCleanup(() => {
        tabBar.removeEventListener("click", categoryGuard, true);
        delete tabBar.dataset.bgalazkaCategoryGuard;
      });
    }
  }

    return { createToggleRow, createSliderRow, injectSettingsUI };
  };
})();
