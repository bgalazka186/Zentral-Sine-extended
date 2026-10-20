/* Native browser preferences: read on Settings open, write only on explicit
 * edit/reset. No default registration, migration, polling or preset ownership.
 * Runtime constructs this optional module and orders its settings hook at 25.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "native-browser-settings",
    function ({ Services, runtime, disposers }) {
      const definitions = [
        [
          "Borders",
          "Content gaps / border spacing",
          "zen.theme.content-element-separation",
          "number",
          0,
        ],
        [
          "Borders",
          "Content corner radius",
          "zen.theme.border-radius",
          "number",
          0,
        ],
        [
          "Fullscreen",
          "Enter fullscreen: fade to black / from black (ms)",
          "full-screen-api.transition-duration.enter",
          "pair",
        ],
        [
          "Fullscreen",
          "Leave fullscreen: fade to black / from black (ms)",
          "full-screen-api.transition-duration.leave",
          "pair",
        ],
        [
          "Fullscreen",
          "Fullscreen notification duration (ms)",
          "full-screen-api.warning.timeout",
          "number",
          0,
        ],
        [
          "Fullscreen",
          "Fullscreen notification delay (ms; -1 disables)",
          "full-screen-api.warning.delay",
          "number",
          -1,
        ],
        [
          "Compact sidebar",
          "Enable compact mode at startup",
          "zen.view.compact.enable-at-startup",
          "checkbox",
        ],
        [
          "Compact sidebar",
          "Keep sidebar open after leaving (ms)",
          "zen.view.compact.sidebar-keep-hover.duration",
          "number",
          0,
        ],
        [
          "Compact sidebar",
          "Outside-window horizontal edge offset",
          "zen.view.compact.outside-window-edge-offset.horizontal",
          "number",
          0,
        ],
        [
          "Layout",
          "Sidebar on the right",
          "zen.tabs.vertical.right-side",
          "checkbox",
        ],
        [
          "Layout",
          "New-tab button at the top",
          "zen.view.show-newtab-button-top",
          "checkbox",
        ],
        [
          "Layout",
          "Force window controls to the left",
          "zen.view.experimental-force-window-controls-left",
          "checkbox",
        ],
        [
          "Layout",
          "Show loading indicator",
          "zen.view.enable-loading-indicator",
          "checkbox",
        ],
        [
          "Address bar",
          "Address-bar behavior (native preference value)",
          "zen.urlbar.behavior",
          "text",
        ],
        [
          "Address bar",
          "Hide search-engine shortcut buttons",
          "zen.urlbar.hide-one-offs",
          "checkbox",
        ],
        [
          "Tabs & workspaces",
          "Skip Essentials with Ctrl+Tab",
          "zen.tabs.ctrl-tab.ignore-essential-tabs",
          "checkbox",
        ],
        [
          "Tabs & workspaces",
          "Skip pending / unloaded tabs with Ctrl+Tab",
          "zen.tabs.ctrl-tab.ignore-pending-tabs",
          "checkbox",
        ],
        [
          "Tabs & workspaces",
          "Separate Essentials between workspaces",
          "zen.workspaces.separate-essentials",
          "checkbox",
        ],
        [
          "Tabs & workspaces",
          "Show workspace indicator",
          "zen.workspaces.show-workspace-indicator",
          "checkbox",
        ],
      ];
      const keys = new Set(definitions.map((d) => d[2]));
      runtime.nativeBrowserSettingsKeys = keys;
      runtime.externalSettingsCategories ||= new Set();
      runtime.externalSettingsCategories.add("native-browser");
      const panels = new WeakMap();
      let disposed = false;
      const element = (tag, text) => {
        const node = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          tag,
        );
        if (text !== undefined) node.textContent = text;
        return node;
      };
      function build() {
        if (disposed) return;
        const modal = document.getElementById("zentral-settings-modal");
        if (!modal) return;
        let controls = panels.get(modal);
        if (!controls) {
          controls = [];
          const category = runtime.ensureSettingsCategory(
            modal,
            "native-browser",
          );
          const warning = element("aside");
          warning.setAttribute("role", "note");
          warning.style.cssText =
            "padding:16px;margin:8px 0 20px;border:2px solid #d49b20;border-inline-start-width:7px;border-radius:9px;background:var(--zl-settings-card,var(--zl-button-surface,#29231b));color:var(--zl-settings-text,var(--zl-button-text,inherit));font-size:14px;line-height:1.6";
          warning.appendChild(
            element(
              "strong",
              "⚠ Browser-wide settings — changes remain after uninstall",
            ),
          );
          const note = element(
            "p",
            "These controls directly change browser preferences. Zentral’s Defaults, Recommended settings, and import/export do not include them. Uninstalling Zentral leaves these values unchanged. Each Reset button clears only that browser preference’s user override. Fullscreen fades apply to webpage/video fullscreen, not necessarily F11. Some browser changes may require a restart.",
          );
          note.className = "zs-category-description";
          warning.appendChild(note);
          category.content.appendChild(warning);
          for (const [section, label, key, type, minimum = 0] of definitions) {
            const row = element("div");
            row.className = "zs-row";
            row.dataset.nativePreference = key;
            const info = element("div");
            info.className = "zs-label-container";
            const title = element("span", label),
              description = element("small", key);
            title.className = "zs-label";
            description.className = "zs-sublabel";
            info.append(title, description);
            const fields = element("div");
            fields.style.cssText =
              "display:flex;align-items:center;gap:6px;flex-wrap:wrap";
            const inputs = Array.from(
              { length: type === "pair" ? 2 : 1 },
              (_, i) => {
                const input = element("input");
                input.type = type === "pair" ? "number" : type;
                if (input.type !== "checkbox")
                  input.className = "zs-text-input";
                input.setAttribute(
                  "aria-label",
                  label +
                    (type === "pair"
                      ? i
                        ? ": fade from black"
                        : ": fade to black"
                      : ""),
                );
                if (input.type === "number") {
                  input.min = String(minimum);
                  input.step = "1";
                }
                if (input.type !== "checkbox")
                  input.style.width = type === "pair" ? "80px" : "150px";
                fields.appendChild(input);
                return input;
              },
            );
            const reset = element("button", "Reset to browser default");
            reset.type = "button";
            reset.className = "zs-look-action";
            const status = element("small");
            status.setAttribute("role", "status");
            fields.append(reset, status);
            row.append(info, fields);
            const refresh = () => {
              const prefType = Services.prefs.getPrefType(key);
              const expected =
                type === "checkbox"
                  ? Services.prefs.PREF_BOOL
                  : type === "number"
                    ? Services.prefs.PREF_INT
                    : Services.prefs.PREF_STRING;
              const available = prefType === expected;
              for (const input of inputs) input.disabled = !available;
              reset.disabled = !Services.prefs.prefHasUserValue(key);
              status.textContent = !available
                ? "Unavailable in this browser version"
                : Services.prefs.prefHasUserValue(key)
                  ? "Custom value"
                  : "Browser default";
              if (!available) return;
              if (type === "checkbox")
                inputs[0].checked = Services.prefs.getBoolPref(key);
              else if (type === "number")
                inputs[0].value = String(Services.prefs.getIntPref(key));
              else {
                const value = Services.prefs.getStringPref(key);
                if (type === "pair") {
                  const pair = value.trim().split(/\s+/);
                  inputs.forEach((input, i) => {
                    input.value = pair[i] || "0";
                  });
                } else inputs[0].value = value;
              }
            };
            const edit = () => {
              try {
                if (type === "checkbox")
                  Services.prefs.setBoolPref(key, inputs[0].checked);
                else if (type === "number" || type === "pair") {
                  const values = inputs.map((input) =>
                    input.value.trim() === "" ? NaN : Number(input.value),
                  );
                  if (
                    values.some(
                      (value) =>
                        !Number.isSafeInteger(value) ||
                        value < minimum ||
                        value > 2147483647,
                    )
                  )
                    throw new Error(
                      "Enter a valid whole number" +
                        (minimum >= 0 ? " of zero or more" : ""),
                    );
                  if (type === "pair")
                    Services.prefs.setStringPref(key, values.join(" "));
                  else Services.prefs.setIntPref(key, values[0]);
                } else Services.prefs.setStringPref(key, inputs[0].value);
                refresh();
              } catch (error) {
                status.textContent = String(error.message || error);
              }
            };
            inputs.forEach((input) => input.addEventListener("change", edit));
            reset.addEventListener("click", () => {
              try {
                Services.prefs.clearUserPref(key);
                refresh();
              } catch (error) {
                status.textContent = String(error.message || error);
              }
            });
            runtime
              .ensureSettingsSection(modal, "native-browser", section)
              .appendChild(row);
            controls.push(refresh);
          }
          panels.set(modal, controls);
        }
        controls.forEach((refresh) => refresh());
      }
      const unregister = runtime.registerSettingsHook(
        "native-browser-settings",
        25,
        build,
      );
      disposers.push(() => {
        disposed = true;
        unregister();
        runtime.externalSettingsCategories.delete("native-browser");
      });
      return { keys, build };
    },
  );
})();
