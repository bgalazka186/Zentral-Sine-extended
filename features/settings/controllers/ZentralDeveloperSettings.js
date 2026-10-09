/*
 * ZENTRAL FILE GUIDE - features/settings/controllers/ZentralDeveloperSettings.js
 *
 * Purpose: Optional source manager overlay, module/CSS toggles, local add-on registration and
 *   diagnostic/settings inventory views.
 * Interaction / execution: Runtime passes feature/style records, manifests, preference controls, schema
 *   metadata and open settings callbacks. Uses the same legacy CSS control keys as stylesheet registration.
 * Ownership / failure: Runtime disposer closes the manager and removes its overlay/listeners. Source
 *   toggles apply on restart; a failed optional manager leaves bootstrap diagnostics available.
 * Registration: developer-settings
 * Loaded/created by: core/ZentralRuntime.js
 * Returned factory API: openManager
 * Literal DOM event subscriptions: change; click; command; input; keydown
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "developer-settings",
    function ({
      Services,
      Core,
      Settings,
      runtime,
      records,
      styles,
      MANIFEST,
      CSS_MANIFEST,
      SETTINGS_SCHEMA,
      SETTINGS_ORGANIZATION,
      getPref,
      setPref,
      enabled,
      unsafeCoreDisabled,
      protectedModules,
      protectedCSS,
      PREF,
      ROOT,
      VERSION,
      disposers,
      settingsMetadata,
      settingsItemAvailable,
      selectSettingsCategory,
      organizeNativeSettings,
      validateAddons,
      unsafeCorePref,
    }) {
      let manager = null;
      disposers.push(() => {
        manager?.remove();
        manager = null;
      });
      function element(tag, text, style) {
        const el = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          tag,
        );
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
        runtime.panelContext?.syncSettingsAfterImport?.(key);
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
          console.warn(
            "[Zentral] Preference applied; UI refresh failed",
            error,
          );
        }
      }
      function statusText(r) {
        if (r.state === "blocked") return "BLOCKED — " + r.reason;
        if (r.state === "failed") return "FAILED — " + r.error.split("\n")[0];
        return r.state.toUpperCase();
      }
      function openManager(initialCategory = "", initialQuery = "") {
        if (typeof initialCategory !== "string") initialCategory = "";
        if (manager?.isConnected) {
          manager.remove();
          manager = null;
        }
        manager = element(
          "div",
          null,
          "position:fixed;inset:30px;z-index:2147483647;display:flex;flex-direction:column;gap:12px;background:#111827;color:#e5e7eb;padding:20px;border:1px solid #64748b;border-radius:14px;font:13px system-ui;box-shadow:0 12px 60px #000a;color-scheme:dark",
        );
        manager.id = "zentral-control-center";
        manager.setAttribute("role", "dialog");
        manager.setAttribute(
          "aria-label",
          "Zentral settings and developer tools",
        );
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
                setPref(
                  PREF + "css." + (s.legacyControl || s.id) + ".enabled",
                  true,
                );
              developer();
            }),
            button("Copy diagnostics", () => {
              Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                .getService(Components.interfaces.nsIClipboardHelper)
                .copyString(report());
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
              "Core: ACTIVE · Settings: built in · Sine entrypoint: core/Zentral.uc.js",
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
            input.disabled =
              !!r.builtin ||
              (protectedModules.has(r.id) && !unsafeCoreDisabled());
            input.addEventListener("change", () => {
              setPref(PREF + r.id + ".enabled", input.checked);
              developer();
            });
            label.append(
              input,
              element("span", r.name + " — " + statusText(r)),
            );
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
                          (id) =>
                            `${id} [${records.get(id)?.state || "missing"}]`,
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
          const unsafeRow = element(
            "label",
            null,
            "display:flex;gap:8px;padding:10px;color:#fcd34d",
          );
          const unsafeInput = element("input");
          unsafeInput.type = "checkbox";
          unsafeInput.checked = unsafeCoreDisabled();
          unsafeInput.addEventListener("change", () => {
            setPref(unsafeCorePref, unsafeInput.checked);
            developer();
          });
          unsafeRow.append(
            unsafeInput,
            element(
              "span",
              "I am being stupid and want to disable core elements of the mod (restart required)",
            ),
          );
          body.prepend(unsafeRow);
          body.append(element("h3", "Source files"));
          for (const source of window.ZentralModuleLoader?.sources() || []) {
            const details = element("details");
            details.append(
              element(
                "summary",
                source.file +
                  " — " +
                  source.state.toUpperCase() +
                  " (" +
                  source.phase +
                  ")",
              ),
            );
            details.append(
              element(
                "pre",
                source.error || "Owner: " + source.owner,
                "white-space:pre-wrap;overflow-wrap:anywhere",
              ),
            );
            body.append(details);
          }
          body.append(element("h3", "CSS files"));
          for (const s of styles.values()) {
            const control = s.legacyControl || s.id;
            const row = element(
              "label",
              null,
              "display:flex;gap:8px;padding:8px;border-bottom:1px solid #334155",
            );
            const input = element("input");
            input.type = "checkbox";
            input.checked =
              protectedCSS.has(control) && !unsafeCoreDisabled()
                ? true
                : getPref(PREF + "css." + control + ".enabled", true);
            input.disabled = protectedCSS.has(control) && !unsafeCoreDisabled();
            input.addEventListener("change", () => {
              setPref(PREF + "css." + control + ".enabled", input.checked);
              developer();
            });
            row.append(
              input,
              element(
                "span",
                s.file +
                  " — " +
                  s.state +
                  " · used by " +
                  (s.owners?.join(", ") || s.owner || "shared") +
                  (s.legacyControl ? " · shared switch: " + control : ""),
              ),
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
          const category = element("select");
          category.setAttribute("aria-label", "Settings category");
          category.style.cssText = "width:100%;padding:8px;margin-bottom:10px";
          category.append(element("option", "All categories"));
          category.firstElementChild.value = "";
          for (const group of SETTINGS_ORGANIZATION.categories) {
            if (
              !SETTINGS_SCHEMA.some(
                (item) =>
                  item.property &&
                  settingsMetadata(item).category === group.id &&
                  settingsItemAvailable(item),
              )
            )
              continue;
            const option = element("option", group.group + " · " + group.label);
            option.value = group.id;
            category.append(option);
          }
          category.value = initialCategory;
          search.value = initialQuery;
          const list = element("div");
          body.append(category, list);
          function render() {
            list.replaceChildren();
            const query = search.value.toLowerCase();
            if (category.value === "addons")
              list.append(button("Edit local add-on registrations", addons));
            let lastSection = "";
            const sorted = [...SETTINGS_SCHEMA]
              .filter((item) => item.property && settingsItemAvailable(item))
              .sort((a, b) => {
                const ids = SETTINGS_ORGANIZATION.categories.map(
                  (category) => category.id,
                );
                return (
                  ids.indexOf(settingsMetadata(a).category) -
                  ids.indexOf(settingsMetadata(b).category)
                );
              });
            for (const item of sorted) {
              const meta = settingsMetadata(item);
              if (category.value && meta.category !== category.value) continue;
              // File switches use the protected module manager, not raw editors.
              if (
                meta.category === "modules" ||
                item.property === "zen.workspace.zentral.addons"
              )
                continue;
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

              if (
                query &&
                !`${item.label} ${item.property}`.toLowerCase().includes(query)
              )
                continue;
              const heading =
                SETTINGS_ORGANIZATION.categories.find(
                  (category) => category.id === meta.category,
                )?.label +
                " · " +
                meta.section;
              if (lastSection !== heading) {
                list.append(element("h3", heading));
                lastSection = heading;
              }
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
              const context = runtime.panelContext;
              const fallback =
                context?.PROFILE_DEFAULTS?.[item.property] ??
                Core.defaultPrefs[item.property] ??
                item.defaultValue;
              const current =
                Core.defaultPrefs[item.property] !== undefined
                  ? Core.getPref(item.property, fallback)
                  : context &&
                      item.property.startsWith("zen.workspace.bgalazka.")
                    ? context.getPref(item.property, fallback)
                    : getPref(item.property, fallback);
              let input;
              if (item.type === "dropdown") {
                input = element("select");
                for (const opt of item.options || []) {
                  const o = element("option", opt.label);
                  o.value = String(opt.value);
                  input.append(o);
                }
                if (
                  ![...input.options].some(
                    (option) => option.value === String(current),
                  )
                ) {
                  const option = element(
                    "option",
                    String(current) + " (current)",
                  );
                  option.value = String(current);
                  input.append(option);
                }
                input.value = String(current);
              } else {
                input = element("input");
                input.type =
                  item.type === "checkbox"
                    ? "checkbox"
                    : typeof item.defaultValue === "number"
                      ? "number"
                      : "text";
                if (input.type === "checkbox") input.checked = current;
                else input.value = current;
              }
              input.addEventListener("change", () => {
                let value =
                  input.type === "checkbox" ? input.checked : input.value;
                if (typeof item.defaultValue === "number")
                  value = Number(value);
                if (
                  typeof value === "number" &&
                  (!Number.isInteger(value) ||
                    value < -2147483648 ||
                    value > 2147483647)
                )
                  return;
                setFeaturePref(item.property, value);
              });
              row.append(left, input);
              list.append(row);
            }
          }
          search.addEventListener("input", render);
          category.addEventListener("change", () => {
            if (category.value === "modules") developer();
            else render();
          });
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
        if (initialCategory === "modules") developer();
        else if (initialCategory || initialQuery) preferences();
        else developer();
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
        if (modal) organizeNativeSettings(modal);
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
      return { openManager };
    },
  );
})();
