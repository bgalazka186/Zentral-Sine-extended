/*
 * ZENTRAL FILE GUIDE - features/apps/controllers/ZentralAppModel.js
 *
 * Purpose: Reads/validates/saves app definitions and utility ordering; adds apps and resolves workspace
 *   metadata and display labels.
 * Interaction / execution: Installed by ZentralApps constructor. Launcher renders state.apps; Lifecycle
 *   loads those apps; Interactions adds apps from native tab context commands.
 * Ownership / failure: Uses live access.state. Persistence belongs here; browser ownership and rendering
 *   belong to other Apps controllers.
 * Registration: apps/ZentralAppModel
 * Loaded/created by: features/apps/ZentralApps.uc.js
 * Returned factory API: addApp; formatAppDisplayName; getZenWorkspacesList; loadApps; loadUtilityOrder;
 *   saveApps; saveUtilityOrder
 * Live owner accessors/callbacks: state
 * Cross-file calls / ctx suppliers: features/apps/controllers/ZentralAppsLauncher.js -> renderGrid
 * Contract fields assigned here: access.state.apps; access.state.utilitySlots
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "apps/ZentralAppModel",
    function ({ Services, shared, runtime, access }) {
      const {
        Constants,
        Core,
        createSVGElement,
        SVG_STRINGS,
        WELL_KNOWN_SERVICES,
      } = shared;
      return {
        loadApps() {
          access.state.apps = [];
          try {
            const str = Core.getPref(Constants.Apps.PREF_APPS);
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) {
              const seen = new Set();
              access.state.apps = parsed
                .filter((a) => {
                  if (
                    !a ||
                    typeof a.id !== "string" ||
                    !/^[a-zA-Z0-9_-]{1,100}$/.test(a.id) ||
                    seen.has(a.id) ||
                    typeof a.url !== "string"
                  )
                    return false;
                  try {
                    if (
                      !/^(https?|moz-extension|about):$/.test(
                        new URL(a.url).protocol,
                      )
                    )
                      return false;
                  } catch (_) {
                    return false;
                  }
                  seen.add(a.id);
                  return true;
                })
                .map((a) => ({
                  ...a,
                  title:
                    typeof a.title === "string" ? a.title.slice(0, 200) : "App",
                  icon: typeof a.icon === "string" ? a.icon : "",
                  width:
                    Number.isFinite(a.width) && a.width > 0
                      ? Math.max(
                          Constants.Apps.MIN_WIDTH_PX,
                          Math.min(10000, a.width),
                        )
                      : undefined,
                  preload: a.preload === true,
                  workspaceId:
                    typeof a.workspaceId === "string" &&
                    a.workspaceId !== "current" &&
                    a.workspaceId
                      ? a.workspaceId
                      : "all",
                }));
            }
          } catch (e) {
            console.warn("[ZentralApps] Failed to load apps pref:", e);
          }
        },
        saveApps() {
          try {
            const clean = access.state.apps.map(
              ({ id, url, title, icon, width, preload, workspaceId }) => ({
                id,
                url,
                title,
                icon,
                width,
                preload: !!preload,
                workspaceId,
              }),
            );
            Core.setPref(Constants.Apps.PREF_APPS, JSON.stringify(clean));
          } catch (e) {
            console.warn("[ZentralApps] Failed to save apps pref:", e);
          }
        },
        loadUtilityOrder() {
          // LOW-02: UTILITY_SLOTS_COUNT is always 4 (defined constant); || 4 fallback was dead code.
          const slotCount = Constants.Apps.UTILITY_SLOTS_COUNT;
          try {
            const raw = Core.getPref(Constants.Apps.PREF_UTILITY_ORDER);
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (Array.isArray(parsed) && parsed.length > 0) {
              const slots = new Array(slotCount).fill(null);
              const used = new Set();
              parsed.forEach((k, idx) => {
                if (
                  idx < slotCount &&
                  ["settings", "autohide"].includes(k) &&
                  !used.has(k)
                ) {
                  slots[idx] = k;
                  used.add(k);
                }
              });
              const required = ["settings", "autohide"];
              required.forEach((reqKey) => {
                if (!slots.includes(reqKey)) {
                  const emptyIdx = slots.indexOf(null);
                  if (emptyIdx > -1) slots[emptyIdx] = reqKey;
                  else slots[0] = reqKey;
                }
              });
              access.state.utilitySlots = slots;
              return;
            }
          } catch (e) {
            console.warn("[ZentralApps] Failed to load utility order pref:", e);
          }
          const defaultSlots = new Array(slotCount).fill(null);
          defaultSlots[0] = "autohide";
          defaultSlots[3] = "settings";
          access.state.utilitySlots = defaultSlots;
        },
        saveUtilityOrder() {
          try {
            Core.setPref(
              Constants.Apps.PREF_UTILITY_ORDER,
              JSON.stringify(access.state.utilitySlots),
            );
          } catch (e) {
            console.warn("[ZentralApps] Failed to save utility order pref:", e);
          }
        },
        addApp(url, title, icon) {
          const limit = Math.max(
            0,
            Math.min(
              200,
              parseInt(Core.getPref(Constants.Apps.PREF_MAX_APPS, 21), 10) || 0,
            ),
          );
          if (access.state.apps.length >= limit || typeof url !== "string")
            return;
          try {
            if (
              !/^(https?|moz-extension|about):$/.test(new URL(url).protocol) ||
              url === "about:blank"
            )
              return;
          } catch (_) {
            return;
          }
          const id =
            "app_" +
            Date.now() +
            "_" +
            Services.uuid.generateUUID().toString().replace(/[{}-]/g, "");
          const crispIcon = url.startsWith("http")
            ? `page-icon:${url}`
            : icon || `page-icon:${url}`;
          const cleanTitle = this.formatAppDisplayName(title, url);
          const newApp = {
            id,
            url,
            title: cleanTitle,
            icon: crispIcon,
            workspaceId: "all",
          };
          access.state.apps.push(newApp);
          this.saveApps();
          this.renderGrid();
        },
        getZenWorkspacesList() {
          const list = [];
          const seen = new Set();
          try {
            const raw =
              typeof window.gZenWorkspaces?.getWorkspaces === "function"
                ? window.gZenWorkspaces.getWorkspaces()
                : window.gZenWorkspaces?.workspaces;
            if (Array.isArray(raw)) {
              for (const w of raw) {
                if (w && w.id && !seen.has(w.id)) {
                  seen.add(w.id);
                  list.push({ id: w.id, name: w.name || w.label || w.id });
                }
              }
            }
          } catch (_) {}

          if (list.length === 0) {
            try {
              const els = document.querySelectorAll(
                "zen-workspace, .zen-workspace-strip-item, [zen-workspace-id]",
              );
              for (const el of els) {
                const id = el.getAttribute("zen-workspace-id") || el.id;
                if (id && !seen.has(id)) {
                  seen.add(id);
                  const name =
                    el.getAttribute("name") ||
                    el.getAttribute("label") ||
                    el.getAttribute("tooltiptext") ||
                    id;
                  list.push({ id, name });
                }
              }
            } catch (_) {}
          }
          return list;
        },
        formatAppDisplayName(title, url = "") {
          let host = "";
          if (url) {
            try {
              host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
            } catch (_) {}
          }

          if (host) {
            if (WELL_KNOWN_SERVICES[host]) return WELL_KNOWN_SERVICES[host];
            for (const [knownHost, knownName] of Object.entries(
              WELL_KNOWN_SERVICES,
            )) {
              if (host === knownHost || host.endsWith("." + knownHost)) {
                return knownName;
              }
            }
          }

          let raw = (title || "").trim();
          const rawLower = raw.toLowerCase().replace(/^www\./, "");
          if (WELL_KNOWN_SERVICES[rawLower])
            return WELL_KNOWN_SERVICES[rawLower];
          for (const [knownHost, knownName] of Object.entries(
            WELL_KNOWN_SERVICES,
          )) {
            if (rawLower === knownHost || rawLower.endsWith("." + knownHost)) {
              return knownName;
            }
          }

          const isContaminated =
            !raw ||
            /^Group\s+Tab\s+\d+$/i.test(raw) ||
            /^Demo\s+Tab\s+\d+$/i.test(raw) ||
            /^New\s+Tab$/i.test(raw) ||
            /^about:blank$/i.test(raw) ||
            raw.startsWith("http://") ||
            raw.startsWith("https://");

          if (!isContaminated) {
            raw = raw.replace(/^[\(\[]\s*\d+\+?\s*[\)\]]\s*/, "");
            if (/web\b/i.test(raw)) raw = raw.replace(/\s+web\b/i, "");
            const parts = raw.split(/\s+[-|•—–:]\s+/);
            if (parts.length > 1) {
              const first = parts[0].trim();
              const last = parts[parts.length - 1].trim();
              if (first && first.length <= 20) raw = first;
              else if (last && last.length <= 20) raw = last;
            }
            if (raw && raw.length <= 30 && !raw.includes(".")) {
              return raw;
            }
          }

          if (host) {
            const cleanHost = host.replace(
              /^(app|web|mobile|m|my|auth|login)\./,
              "",
            );
            const domainBase = cleanHost.replace(
              /\.(com|org|net|io|app|dev|tv|co|uk|it|de|fr|me|so|ai|gg|cc|xyz|info|biz|eu)(\.[a-z]{2})?$/,
              "",
            );
            if (domainBase) {
              return domainBase.charAt(0).toUpperCase() + domainBase.slice(1);
            }
          }

          return raw || host || "App";
        },
      };
    },
  );
})();
