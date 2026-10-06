/*
 * ZENTRAL FILE GUIDE - features/settings/controllers/ZentralSettingsRows.js
 *
 * Purpose: Reusable DOM row constructors for keybinds, toggles, selects, text, sliders and colors.
 * Interaction / execution: FeatureSettings creates the factory with ctx preference/SVG/keybind utilities
 *   and backing-step validation. Returned builders bind input events and write preferences; caller places
 *   rows into categories.
 * Ownership / failure: No global feature ownership. Row listeners live with their DOM; Shell/feature UI
 *   cleanup removes the modal. Keep these generic builders independent of any particular feature category.
 * Registration: settings-rows
 * Loaded/created by: features/settings/controllers/ZentralFeatureSettings.js
 * Returned factory API: createColorRow; createKeybindRow; createSelectRow; createSliderRow; createTextRow;
 *   createToggleRow
 * Shared ctx symbols used: BGALAZKA_EXT_PREFS; EXT_PREFS; SEARCH_CUSTOM_ENGINE_PREFS; getPref;
 *   isValidQuickSwitchTemplate; keybindFromEvent; parseSVG; requestTileSync; setPref; syncPanelPushState;
 *   updateCSSVars
 * Cross-file calls / ctx suppliers: features/panels/corner-tiles/ZentralCornerPanels.uc.js -> ctx.requestTileSync;
 *   features/panels/navigation/ZentralPanelToolbar.uc.js -> ctx.SEARCH_CUSTOM_ENGINE_PREFS, ctx.isValidQuickSwitchTemplate;
 *   features/panels/ZentralPanels.uc.js -> ctx.BGALAZKA_EXT_PREFS, ctx.EXT_PREFS, ctx.getPref, ctx.keybindFromEvent,
 *   ctx.parseSVG, ctx.setPref, ctx.syncPanelPushState, ctx.updateCSSVars
 * Literal DOM event subscriptions: blur; change; focus; input; keydown
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("settings-rows", function ({ ctx, validPanelBackingSteps }) {
    function createKeybindRow(labelText, sublabelText, prefKey, defaultVal) {
      const row = document.createElement("div");
      row.className = "zs-row zs-keybind-row";
      row.dataset.settingKey = prefKey;

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
      row.dataset.settingKey = prefKey;

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
            (ctx.EXT_PREFS?.CORNER_TILES ||
              ctx.BGALAZKA_EXT_PREFS.CORNER_TILES) ||
          prefKey === ctx.BGALAZKA_EXT_PREFS.ALL_TAB_PANELS
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
      row.dataset.settingKey = prefKey;

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
        if (String(opt.value) === String(currentVal)) optionEl.selected = true;
        select.appendChild(optionEl);
      });

      select.addEventListener("change", () => {
        const option = options.find(option => String(option.value) === select.value);
        ctx.setPref(prefKey, option ? option.value : select.value);
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
      row.dataset.settingKey = prefKey;
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
        if (prefKey === ctx.BGALAZKA_EXT_PREFS.PANEL_BLACK_STEPS &&
            !validPanelBackingSteps(val)) {
          const message = "Enter whole percentages from 0 to 100, separated by commas. The previous values remain saved.";
          input.setCustomValidity(message);
          input.setAttribute("aria-invalid", "true");
          error.textContent = message; error.hidden = false;
          return false;
        }
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
      row.dataset.settingKey = prefKey;
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
      row.dataset.settingKey = prefKey;

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
return { createKeybindRow, createToggleRow, createSelectRow, createTextRow, createSliderRow, createColorRow };
});
})();
