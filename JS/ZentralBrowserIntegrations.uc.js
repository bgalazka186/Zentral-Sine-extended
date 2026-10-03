(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime;
  // Feature: browser-integrations. Imports and exposed are listed in ARCHITECTURE.md.
  // Preparation publishes functions; activation preserves the baseline initialization order.
  ZentralRuntime.registerPart("browser-integrations", function* (ctx) {
    Object.defineProperties(ctx, {
      ADDON_HOST_FOLDER_LABEL: {
        configurable: true,
        get: () => ADDON_HOST_FOLDER_LABEL,
      },
      MOBILE_UA_STRING: { configurable: true, get: () => MOBILE_UA_STRING },
      addonHostByAppId: { configurable: true, get: () => addonHostByAppId },
      addonHostByTab: { configurable: true, get: () => addonHostByTab },
      addonHostFolder: {
        configurable: true,
        get: () => addonHostFolder,
        set: (value) => {
          addonHostFolder = value;
        },
      },
      applyPanelContainerLoadContext: {
        configurable: true,
        get: () => applyPanelContainerLoadContext,
      },
      callGetOrCreateWithAddonHostBrowser: {
        configurable: true,
        get: () => callGetOrCreateWithAddonHostBrowser,
      },
      ensureMobileUaMenuItem: {
        configurable: true,
        get: () => ensureMobileUaMenuItem,
      },
      ensurePanelPrivacyMenuItems: {
        configurable: true,
        get: () => ensurePanelPrivacyMenuItems,
      },
      findAddonHostFolder: {
        configurable: true,
        get: () => findAddonHostFolder,
      },
      getMobileUaAppIds: { configurable: true, get: () => getMobileUaAppIds },
      getPanelContainerAssignments: {
        configurable: true,
        get: () => getPanelContainerAssignments,
      },
      getPanelUserContextId: {
        configurable: true,
        get: () => getPanelUserContextId,
      },
      isAddonTabIdBridgeEnabled: {
        configurable: true,
        get: () => isAddonTabIdBridgeEnabled,
      },
      isMobileUaApp: { configurable: true, get: () => isMobileUaApp },
      keepAddonHostFolderCollapsed: {
        configurable: true,
        get: () => keepAddonHostFolderCollapsed,
      },
      removeAddonHostRecord: {
        configurable: true,
        get: () => removeAddonHostRecord,
      },
      removeEmptyAddonHostFolder: {
        configurable: true,
        get: () => removeEmptyAddonHostFolder,
      },
      saveMobileUaAppIds: { configurable: true, get: () => saveMobileUaAppIds },
      savePanelContainerAssignments: {
        configurable: true,
        get: () => savePanelContainerAssignments,
      },
      setAddonTabIdBridgeEnabled: {
        configurable: true,
        get: () => setAddonTabIdBridgeEnabled,
      },
      syncAddonHostBrowserActivity: {
        configurable: true,
        get: () => syncAddonHostBrowserActivity,
      },
      syncAppPanelBrowserActivity: {
        configurable: true,
        get: () => syncAppPanelBrowserActivity,
      },
      unloadPanelBrowsersForAddonBridge: {
        configurable: true,
        get: () => unloadPanelBrowsersForAddonBridge,
      },
      updateAddonHostInspection: {
        configurable: true,
        get: () => updateAddonHostInspection,
      },
    });
    yield;
    const PANEL_CONTAINERS_PREF =
      "zen.workspace.bgalazka.panel_container_assignments";
    const BASE_ZENTRAL_APPS_PREF = "zen.workspace.apps.sidebar.apps";
    const FIREFOX_CONTAINERS_ENABLED_PREF = "privacy.userContext.enabled";

    let ContextualIdentityService = null;
    let contextualIdentityImportAttempted = false;
    let panelContainerIdentityCache = [];
    let panelContainerIdentityRefreshPromise = null;

    // Zen currently ships Gecko's ContextualIdentityService, but userChrome
    // scripts can run early enough that a direct eager import/clone path is not
    // always dependable. Resolve it lazily and keep profile-file enumeration as
    // an independent fallback. This also avoids making the menu depend on
    // getUserContextLabel(), which can throw when a stale l10n id is present.
    function resolveContextualIdentityService() {
      if (ContextualIdentityService) return ContextualIdentityService;
      if (contextualIdentityImportAttempted) return null;
      contextualIdentityImportAttempted = true;

      try {
        const mod = ChromeUtils.importESModule(
          "resource://gre/modules/ContextualIdentityService.sys.mjs",
        );
        ContextualIdentityService = mod?.ContextualIdentityService || null;
      } catch (_) {}

      // A lazy ES-module getter uses the same Gecko module but is a useful
      // second path in Zen/userChrome environments where the eager import above
      // was attempted before the module was ready.
      if (!ContextualIdentityService) {
        try {
          const lazy = {};
          ChromeUtils.defineESModuleGetters(lazy, {
            ContextualIdentityService:
              "resource://gre/modules/ContextualIdentityService.sys.mjs",
          });
          ContextualIdentityService = lazy.ContextualIdentityService || null;
        } catch (_) {}
      }

      if (!ContextualIdentityService)
        console.info(
          "[BgalazkaExtension] ContextualIdentityService unavailable; using profile container identities.",
        );

      return ContextualIdentityService;
    }

    // Try once at extension startup, but all callers resolve lazily again.
    resolveContextualIdentityService();

    function normalizeUserContextId(value) {
      const id = Number(value);
      return Number.isInteger(id) && id > 0 ? id : 0;
    }

    function normalizeContainerIdentity(identity) {
      const userContextId = normalizeUserContextId(identity?.userContextId);
      if (!userContextId) return null;
      return {
        userContextId,
        public: identity?.public !== false,
        name: typeof identity?.name === "string" ? identity.name.trim() : "",
        l10nId:
          typeof identity?.l10nId === "string"
            ? identity.l10nId
            : typeof identity?.l10nID === "string"
              ? identity.l10nID
              : "",
        icon: typeof identity?.icon === "string" ? identity.icon : "",
        color: typeof identity?.color === "string" ? identity.color : "",
      };
    }

    function mergeContainerIdentities(...lists) {
      const byId = new Map();
      for (const list of lists) {
        for (const raw of list || []) {
          const identity = normalizeContainerIdentity(raw);
          if (!identity || identity.public === false) continue;
          const old = byId.get(identity.userContextId);
          // Prefer whichever source has more useful human-readable metadata.
          if (
            !old ||
            (!old.name && identity.name) ||
            (!old.l10nId && identity.l10nId)
          ) {
            byId.set(identity.userContextId, { ...old, ...identity });
          }
        }
      }
      return Array.from(byId.values()).sort(
        (a, b) => a.userContextId - b.userContextId,
      );
    }

    function getPanelContainerAssignments() {
      try {
        const raw = Services.prefs.getStringPref(PANEL_CONTAINERS_PREF, "{}");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return {};
        }
        const clean = {};
        for (const [appId, rawId] of Object.entries(parsed)) {
          const userContextId = normalizeUserContextId(rawId);
          if (appId && userContextId > 0) clean[appId] = userContextId;
        }
        return clean;
      } catch (_) {
        return {};
      }
    }

    function savePanelContainerAssignments(assignments) {
      try {
        Services.prefs.setStringPref(
          PANEL_CONTAINERS_PREF,
          JSON.stringify(assignments || {}),
        );
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] Failed to save panel container assignments:",
          e,
        );
      }
    }

    function getPanelUserContextId(appId) {
      if (!appId) return 0;
      const essential = ctx.essentialPanels.get(appId);
      if (essential) return essential.userContextId;
      return normalizeUserContextId(getPanelContainerAssignments()[appId]);
    }

    function setPanelUserContextId(appId, userContextId) {
      if (!appId) return;
      const essential = ctx.essentialPanels.get(appId);
      if (essential) {
        essential.userContextId = normalizeUserContextId(userContextId);
        ctx.saveEssentialSettings(essential);
        ctx.setTimeout(() => ctx.recreateLoadedPanels?.([appId]), 0);
        return;
      }
      const assignments = getPanelContainerAssignments();
      const normalized = normalizeUserContextId(userContextId);
      if (normalized > 0) assignments[appId] = normalized;
      else delete assignments[appId];
      savePanelContainerAssignments(assignments);
    }

    function getStoredZentralApp(appId) {
      if (!appId) return null;
      if (ctx.essentialPanels.has(appId))
        return ctx.essentialPanels.get(appId).app;
      try {
        const raw = Services.prefs.getStringPref(BASE_ZENTRAL_APPS_PREF, "[]");
        const apps = JSON.parse(raw);
        if (!Array.isArray(apps)) return null;
        return apps.find((app) => app?.id === appId) || null;
      } catch (_) {
        return null;
      }
    }

    function areFirefoxContainersEnabled() {
      try {
        return Services.prefs.getBoolPref(
          FIREFOX_CONTAINERS_ENABLED_PREF,
          false,
        );
      } catch (_) {
        return false;
      }
    }

    function readContainerIdentitiesFromService() {
      const service = resolveContextualIdentityService();
      if (!service) return [];

      // First use the supported service API. In current Firefox/Zen this calls
      // ensureDataReady() internally and returns all public identities.
      try {
        const identities = service.getPublicIdentities?.();
        const normalized = mergeContainerIdentities(identities);
        if (normalized.length) return normalized;
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] ContextualIdentityService public enumeration failed; using Zen-safe fallback:",
          e,
        );
      }

      // Zen-safe fallback: force the service's synchronous profile load, then
      // read the already-parsed identity records. This avoids Cu.cloneInto()
      // and localization paths entirely while still using Gecko's own data.
      try {
        service.ensureDataReady?.();
        if (Array.isArray(service._identities)) {
          return mergeContainerIdentities(
            service._identities.filter((identity) => identity?.public === true),
          );
        }
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] ContextualIdentityService internal enumeration failed:",
          e,
        );
      }

      return [];
    }

    async function readContainerIdentitiesFromProfile() {
      try {
        if (typeof IOUtils === "undefined") return [];
        const file = Services.dirsvc.get("ProfD", Ci.nsIFile).clone();
        file.append("containers.json");
        if (!file.exists()) return [];

        const bytes = await IOUtils.read(file.path);
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (!Array.isArray(data?.identities)) return [];
        return mergeContainerIdentities(
          data.identities.filter((identity) => identity?.public === true),
        );
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] Failed to read Zen/Firefox containers.json:",
          e,
        );
        return [];
      }
    }

    function getObservedZenContainerIds() {
      // Last-resort discovery for a partially broken containers.json/service:
      // Zen stores the effective context directly on tabs. Include IDs already
      // in use so a working Zen container never disappears from the menu just
      // because ContextualIdentityService's metadata layer is unhealthy.
      const ids = new Set();
      try {
        for (const tab of window.gBrowser?.tabs || []) {
          const id = normalizeUserContextId(
            tab?.getAttribute?.("usercontextid"),
          );
          if (id) ids.add(id);
        }
      } catch (_) {}
      return Array.from(ids, (userContextId) => ({
        userContextId,
        public: true,
        name: "",
        l10nId: "",
        icon: "",
        color: "",
      }));
    }

    function getFirefoxContainerState() {
      const serviceIdentities = readContainerIdentitiesFromService();
      panelContainerIdentityCache = mergeContainerIdentities(
        panelContainerIdentityCache,
        serviceIdentities,
        getObservedZenContainerIds(),
      );
      return {
        enabled: areFirefoxContainersEnabled(),
        // Profile-file fallback means an import failure is not fatal in Zen.
        available:
          !!resolveContextualIdentityService() ||
          typeof IOUtils !== "undefined",
        identities: panelContainerIdentityCache,
      };
    }

    async function refreshFirefoxContainerState() {
      if (!panelContainerIdentityRefreshPromise) {
        panelContainerIdentityRefreshPromise = (async () => {
          const serviceIdentities = readContainerIdentitiesFromService();
          const profileIdentities = await readContainerIdentitiesFromProfile();
          panelContainerIdentityCache = mergeContainerIdentities(
            panelContainerIdentityCache,
            serviceIdentities,
            profileIdentities,
            getObservedZenContainerIds(),
          );
          return panelContainerIdentityCache;
        })().finally(() => {
          panelContainerIdentityRefreshPromise = null;
        });
      }

      await panelContainerIdentityRefreshPromise;
      return getFirefoxContainerState();
    }

    // Warm the cache as soon as the extension starts so Zen users normally see
    // their containers immediately on the very first context-menu open.
    refreshFirefoxContainerState().catch((e) =>
      console.warn(
        "[BgalazkaExtension] Initial Firefox/Zen container discovery failed:",
        e,
      ),
    );

    const BUILTIN_CONTAINER_LABELS = Object.freeze({
      "user-context-personal": "Personal",
      "user-context-personal2": "Personal",
      "userContextPersonal.label": "Personal",
      "user-context-work": "Work",
      "user-context-work2": "Work",
      "userContextWork.label": "Work",
      "user-context-banking": "Banking",
      "user-context-banking2": "Banking",
      "userContextBanking.label": "Banking",
      "user-context-shopping": "Shopping",
      "user-context-shopping2": "Shopping",
      "userContextShopping.label": "Shopping",
    });

    function getFirefoxContainerLabel(identity) {
      const userContextId = normalizeUserContextId(identity?.userContextId);
      if (!userContextId) return "Default";

      if (typeof identity?.name === "string" && identity.name.trim()) {
        return identity.name.trim();
      }

      const l10nId =
        typeof identity?.l10nId === "string"
          ? identity.l10nId
          : typeof identity?.l10nID === "string"
            ? identity.l10nID
            : "";
      if (BUILTIN_CONTAINER_LABELS[l10nId]) {
        return BUILTIN_CONTAINER_LABELS[l10nId];
      }

      // Use Gecko localization only as a best-effort enhancement. Zen builds
      // affected by stale contextual-identity Fluent IDs can throw here, so a
      // label failure must never hide an otherwise valid container.
      try {
        const service = resolveContextualIdentityService();
        const localized = service?.getUserContextLabel?.(userContextId);
        if (typeof localized === "string" && localized.trim()) {
          return localized.trim();
        }
      } catch (_) {}

      return `Container ${userContextId}`;
    }

    function getFirefoxContainerById(userContextId, identities = null) {
      const id = normalizeUserContextId(userContextId);
      if (!id) return null;
      const list = identities || getFirefoxContainerState().identities;
      return (
        list.find(
          (identity) => normalizeUserContextId(identity?.userContextId) === id,
        ) || null
      );
    }

    function getPanelContainerMenuLabel(appId, identities = null) {
      const id = getPanelUserContextId(appId);
      if (!id) return "Container: Default";
      const identity = getFirefoxContainerById(id, identities);
      return identity
        ? `Container: ${getFirefoxContainerLabel(identity)}`
        : `Container: Unavailable (#${id})`;
    }

    function getContainerIconUrl(identity) {
      const icon =
        typeof identity?.icon === "string" ? identity.icon.trim() : "";
      return icon ? `resource://usercontext-content/${icon}.svg` : "";
    }

    async function clearPanelCacheAndCookies(appId) {
      const app = getStoredZentralApp(appId);
      if (!app?.url) {
        throw new Error("Unable to resolve this panel's configured URL.");
      }

      const uri = Services.io.newURI(app.url);
      const schemelessSite = Services.eTLD.getSchemelessSite(uri);
      if (!schemelessSite) {
        throw new Error("This panel URL does not have clearable site data.");
      }

      const userContextId = getPanelUserContextId(appId);
      const flags =
        Ci.nsIClearDataService.CLEAR_COOKIES |
        Ci.nsIClearDataService.CLEAR_ALL_CACHES;

      // Stop the live page before clearing so it cannot race the operation and
      // immediately recreate cookies/cache entries while the callback is pending.
      try {
        window.Zentral?.Apps?.closeApp?.(appId);
      } catch (_) {}

      await new Promise((resolve, reject) => {
        Services.clearData.deleteDataFromSite(
          schemelessSite,
          { userContextId },
          true,
          flags,
          {
            onDataDeleted(failedFlags) {
              if (failedFlags) {
                reject(
                  new Error(
                    `Firefox failed to clear data flags 0x${Number(
                      failedFlags,
                    ).toString(16)}.`,
                  ),
                );
              } else {
                resolve();
              }
            },
          },
        );
      });
    }

    async function rebuildPanelContainerSubmenu(
      popup,
      containerMenu,
      containerPopup,
    ) {
      const appId = popup.dataset.activeAppId || "";
      if (!appId) return;

      const selectedId = getPanelUserContextId(appId);

      const renderState = (state) => {
        // The user may have opened the context menu for another app while the
        // async containers.json fallback was running. Never paint stale data.
        if ((popup.dataset.activeAppId || "") !== appId) return;

        containerMenu.setAttribute(
          "label",
          getPanelContainerMenuLabel(appId, state.identities),
        );
        containerPopup.replaceChildren();

        const appendChoice = (label, userContextId, identity = null) => {
          const item = document.createXULElement("menuitem");
          item.classList.add("bgalazka-container-choice");
          item.setAttribute("label", label);
          item.setAttribute("type", "checkbox");
          item.dataset.userContextId = String(userContextId);
          if (selectedId === userContextId)
            item.setAttribute("checked", "true");

          const iconUrl = getContainerIconUrl(identity);
          if (iconUrl) {
            item.classList.add("menuitem-iconic");
            item.setAttribute("image", iconUrl);
          }
          if (identity?.color) {
            item.dataset.identityColor = String(identity.color);
          }

          // If Firefox/Zen has globally disabled contextual identities, leave
          // Default usable but don't pretend a non-default container can work.
          if (userContextId > 0 && !state.enabled) {
            item.setAttribute("disabled", "true");
            item.disabled = true;
          }

          item.addEventListener("command", () => {
            if (item.disabled) return;
            const nextId = normalizeUserContextId(userContextId);
            if (getPanelUserContextId(appId) === nextId) return;
            setPanelUserContextId(appId, nextId);
            containerMenu.setAttribute(
              "label",
              nextId
                ? `Container: ${getFirefoxContainerLabel(identity)}`
                : "Container: Default",
            );

            // Container identity is part of the remote browser's OriginAttributes
            // and cannot be safely hot-swapped. Recreate on next open/preload.
            try {
              // The identity preference observer schedules recreation after this popup closes.
            } catch (_) {}
          });
          containerPopup.appendChild(item);
        };

        appendChoice("Default (no container)", 0, null);

        if (state.identities.length) {
          containerPopup.appendChild(
            document.createXULElement("menuseparator"),
          );
          for (const identity of state.identities) {
            appendChoice(
              getFirefoxContainerLabel(identity),
              normalizeUserContextId(identity.userContextId),
              identity,
            );
          }
        }

        if (!state.enabled) {
          containerPopup.appendChild(
            document.createXULElement("menuseparator"),
          );
          const status = document.createXULElement("menuitem");
          status.classList.add("bgalazka-container-status");
          status.setAttribute(
            "label",
            "Container Tabs are disabled in browser settings",
          );
          status.setAttribute("disabled", "true");
          containerPopup.appendChild(status);
        } else if (!state.identities.length) {
          const status = document.createXULElement("menuitem");
          status.classList.add("bgalazka-container-status");
          status.setAttribute(
            "label",
            state.available
              ? "No Firefox/Zen containers found"
              : "Container service is unavailable",
          );
          status.setAttribute("disabled", "true");
          containerPopup.appendChild(status);
        }

        // Preserve an assignment even if its container was deleted. Showing it
        // explicitly prevents an accidental silent privacy downgrade to Default.
        if (
          selectedId > 0 &&
          !getFirefoxContainerById(selectedId, state.identities)
        ) {
          const stale = document.createXULElement("menuitem");
          stale.classList.add("bgalazka-container-status");
          stale.setAttribute("label", `Unavailable container (#${selectedId})`);
          stale.setAttribute("type", "checkbox");
          stale.setAttribute("checked", "true");
          stale.setAttribute("disabled", "true");
          containerPopup.appendChild(stale);
        }
      };

      // Paint immediately from Gecko's service/cache. If that path is empty,
      // show a transient loading row instead of incorrectly claiming that Zen
      // has no containers while containers.json is still being read.
      const initialState = getFirefoxContainerState();
      if (initialState.identities.length || !initialState.available) {
        renderState(initialState);
      } else {
        containerMenu.setAttribute(
          "label",
          getPanelContainerMenuLabel(appId, initialState.identities),
        );
        containerPopup.replaceChildren();
        const loading = document.createXULElement("menuitem");
        loading.classList.add("bgalazka-container-status");
        loading.setAttribute("label", "Loading Firefox/Zen containers…");
        loading.setAttribute("disabled", "true");
        containerPopup.appendChild(loading);
      }

      // Merge in Zen's profile containers.json asynchronously. This fixes Zen
      // builds where the service's public clone/localization path is broken.
      try {
        const refreshed = await refreshFirefoxContainerState();
        renderState(refreshed);
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] Failed to refresh Firefox/Zen containers:",
          e,
        );
      }
    }

    function ensurePanelPrivacyMenuItems() {
      const popup = document.getElementById("zen-apps-sidebar-tile-context");
      if (!popup) return false;
      const preloadItem = popup.querySelector("#zen-apps-sidebar-preload-item");
      if (!preloadItem) return false;

      let containerMenu = popup.querySelector(
        "#zen-apps-sidebar-container-menu",
      );
      let containerPopup = popup.querySelector(
        "#zen-apps-sidebar-container-popup",
      );
      let clearItem = popup.querySelector(
        "#zen-apps-sidebar-clear-panel-data-item",
      );

      if (!containerMenu) {
        containerMenu = document.createXULElement("menu");
        containerMenu.id = "zen-apps-sidebar-container-menu";
        containerMenu.setAttribute("label", "Container: Default");
        containerMenu.setAttribute(
          "tooltiptext",
          "Choose the Firefox Container used by this app panel",
        );

        containerPopup = document.createXULElement("menupopup");
        containerPopup.id = "zen-apps-sidebar-container-popup";
        containerMenu.appendChild(containerPopup);
        preloadItem.insertAdjacentElement("afterend", containerMenu);
      }

      if (!clearItem) {
        clearItem = document.createXULElement("menuitem");
        clearItem.id = "zen-apps-sidebar-clear-panel-data-item";
        clearItem.setAttribute("label", "Clear Panel Cache & Cookies");
        clearItem.setAttribute(
          "tooltiptext",
          "Clear cookies and caches for this app's site in its selected Firefox Container",
        );
        containerMenu.insertAdjacentElement("afterend", clearItem);
      }

      if (!popup._bgalazkaPanelPrivacyMenuHooked) {
        popup._bgalazkaPanelPrivacyMenuHooked = true;

        const onPopupShowing = (event) => {
          // popupshowing bubbles from the Container submenu too. Rebuilding the
          // submenu while it is itself opening can make XUL close/reopen it, so
          // only handle the top-level app context popup here.
          if (event.target !== popup) return;
          const appId = popup.dataset.activeAppId || "";
          const menu = popup.querySelector("#zen-apps-sidebar-container-menu");
          const sub = popup.querySelector("#zen-apps-sidebar-container-popup");
          const clear = popup.querySelector(
            "#zen-apps-sidebar-clear-panel-data-item",
          );
          if (!menu || !sub || !clear) return;

          menu.hidden = !appId;
          clear.hidden = !appId;
          clear.removeAttribute("disabled");
          clear.disabled = false;
          clear.setAttribute("label", "Clear Panel Cache & Cookies");
          if (!appId) return;

          rebuildPanelContainerSubmenu(popup, menu, sub);
          if (!getStoredZentralApp(appId)?.url) {
            clear.setAttribute("disabled", "true");
            clear.disabled = true;
          }
        };

        const onClearCommand = async (event) => {
          const target = event.target;
          if (target?.id !== "zen-apps-sidebar-clear-panel-data-item") return;
          const appId = popup.dataset.activeAppId || "";
          if (!appId || target.disabled) return;

          target.disabled = true;
          target.setAttribute("disabled", "true");
          target.setAttribute("label", "Clearing Cache & Cookies…");
          try {
            await clearPanelCacheAndCookies(appId);
            target.setAttribute("label", "Cache & Cookies Cleared");
          } catch (e) {
            console.error(
              "[BgalazkaExtension] Failed to clear panel cache/cookies:",
              appId,
              e,
            );
            target.setAttribute("label", "Clear Failed — See Browser Console");
          } finally {
            target.disabled = false;
            target.removeAttribute("disabled");
          }
        };

        popup.addEventListener("popupshowing", onPopupShowing);
        popup.addEventListener("command", onClearCommand);
        ctx.registerCleanup(() => {
          try {
            popup.removeEventListener("popupshowing", onPopupShowing);
            popup.removeEventListener("command", onClearCommand);
            delete popup._bgalazkaPanelPrivacyMenuHooked;
            popup.querySelector("#zen-apps-sidebar-container-menu")?.remove();
            popup
              .querySelector("#zen-apps-sidebar-clear-panel-data-item")
              ?.remove();
          } catch (_) {}
        });
      }

      return true;
    }

    if (
      !ctx.safeCall(ensurePanelPrivacyMenuItems, "ensurePanelPrivacyMenuItems")
    ) {
      let panelPrivacyMenuAttempts = 0;
      const panelPrivacyMenuTimer = ctx.setInterval(() => {
        panelPrivacyMenuAttempts++;
        if (
          ctx.safeCall(
            ensurePanelPrivacyMenuItems,
            "ensurePanelPrivacyMenuItems",
          ) ||
          panelPrivacyMenuAttempts > 40
        ) {
          ctx.clearInterval(panelPrivacyMenuTimer);
        }
      }, 150);
      ctx.registerCleanup(() => ctx.clearInterval(panelPrivacyMenuTimer));
    }

    /* ==========================================================================
     * FIREFOX ADD-ON TAB-ID BRIDGE (architecture note 27)
     * --------------------------------------------------------------------------
     * A standalone chrome <browser> is not a gBrowser tab. Firefox WebExtension
     * tab tracking therefore cannot give it the normal tab identity expected by
     * add-ons that use sender.tab.id / browser.tabs.*.
     *
     * The important part is that we do NOT create a dummy tab beside the panel.
     * We create the real tab first, then lend its actual linkedBrowser to the
     * base Zentral getOrCreateAppBrowser() factory. Because the interception is
     * synchronous and scoped to one exact createXULElement("browser") call, the
     * base implementation's PRIVATE appBrowsers Map ends up containing the real
     * tab browser naturally. No Zentral core/private-field edit is required.
     * ========================================================================== */
    const ADDON_HOST_FOLDER_ID = "bgalazka-zentral-addon-hosts";
    const ADDON_HOST_FOLDER_LABEL = "Zentral Add-on Hosts";
    const addonHostByAppId = new Map();
    const addonHostByTab = new WeakMap();
    let addonHostFolder = null;
    let lastNonAddonHostTab = window.gBrowser?.selectedTab || null;
    let addonBridgeResetting = false;
    let addonHostSelectionGuardsInstalled = false;
    let redirectingAddonHostSelection = false;
    let removeAddonHostSelectionGuards = null;

    function isAddonTabIdBridgeEnabled() {
      return ctx.getPref(ctx.BGALAZKA_EXT_PREFS.ADDON_TAB_ID_BRIDGE, false);
    }

    function isAddonHostFolderVisible() {
      return ctx.getPref(ctx.BGALAZKA_EXT_PREFS.SHOW_ADDON_HOST_FOLDER, false);
    }

    function updateAddonHostInspection() {
      const status = document.getElementById("zs-addon-host-inspection");
      if (!status) return;
      status.hidden = !isAddonHostFolderVisible();
      if (status.hidden) return;
      if (!isAddonTabIdBridgeEnabled()) {
        status.textContent =
          "Real Tab IDs is off. Enable it and open a web panel to create a host tab.";
        return;
      }
      const folder = findAddonHostFolder();
      const hosts = [...addonHostByAppId.values()].filter(
        (record) => record.tab?.isConnected,
      );
      const fallback = document.querySelectorAll(
        'tab[bgalazka-addon-host-fallback="true"]',
      ).length;
      const names = hosts
        .map((record) => getAddonHostAppLabel(record.app))
        .join(", ");
      const folderVisible =
        folder &&
        getComputedStyle(folder).display !== "none" &&
        folder.getBoundingClientRect().height > 0;
      status.textContent =
        !hosts.length && !folder && !fallback
          ? "No host tabs yet. Open a web panel to create one."
          : `${folder ? (folderVisible ? "Folder visible" : "Folder exists but is hidden by the sidebar layout") : fallback ? "Pinned tab fallback (no Zen folder)" : "Folder missing"} · ${hosts.length} active host tab${hosts.length === 1 ? "" : "s"}${names ? `: ${names}` : ""}`;
    }

    function getAddonHostAppLabel(app) {
      return String(
        app?.name || app?.title || app?.label || app?.url || app?.id || "App",
      ).slice(0, 80);
    }

    function findAddonHostFolder() {
      if (
        addonHostFolder?.isConnected &&
        (addonHostFolder.isZenFolder ||
          addonHostFolder.localName === "zen-folder")
      ) {
        return addonHostFolder;
      }
      const existing =
        document.getElementById(ADDON_HOST_FOLDER_ID) ||
        document.querySelector('zen-folder[bgalazka-addon-host-folder="true"]');
      if (
        existing &&
        (existing.isZenFolder || existing.localName === "zen-folder")
      ) {
        addonHostFolder = existing;
        existing.setAttribute("bgalazka-addon-host-folder", "true");
        return existing;
      }
      addonHostFolder = null;
      return null;
    }

    function keepAddonHostFolderCollapsed(folder) {
      if (!folder) return;
      folder.setAttribute("bgalazka-addon-host-folder", "true");
      // Zen applies the initial collapsed state on a zero-delay timer. Reveal
      // the folder's tab list when inspection is enabled, including at startup.
      ctx.setTimeout(() => {
        try {
          if (!folder.isConnected) return;
          folder.collapsed = !isAddonHostFolderVisible();
          if (folder.collapsed) {
            folder.removeAttribute("has-active");
            window.gZenFolders?.relayoutCollapsedFolder?.(folder);
          }
        } catch (_) {}
      }, 0);
    }

    function putAddonHostTabInFolder(tab) {
      if (!tab || !window.gBrowser) return null;
      let folder = findAddonHostFolder();

      try {
        if (folder) {
          if (!tab.pinned) gBrowser.pinTab(tab);
          if (tab.group !== folder) folder.addTabs([tab]);
          tab.removeAttribute("bgalazka-addon-host-fallback");
          keepAddonHostFolderCollapsed(folder);
          return folder;
        }

        if (window.gZenFolders?.createFolder) {
          const workspaceId =
            tab.getAttribute?.("zen-workspace-id") ||
            window.gZenWorkspaces?.activeWorkspace ||
            undefined;
          folder = window.gZenFolders.createFolder([tab], {
            id: ADDON_HOST_FOLDER_ID,
            label: ADDON_HOST_FOLDER_LABEL,
            renameFolder: false,
            collapsed: true,
            workspaceId,
          });
          addonHostFolder = folder;
          tab.removeAttribute("bgalazka-addon-host-fallback");
          keepAddonHostFolderCollapsed(folder);
          return folder;
        }
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] Could not place add-on host tab in Zen folder; falling back to a pinned tab:",
          e,
        );
      }

      // Compatibility fallback for Zen builds where the internal folder API is
      // unavailable/changed. A normal pinned tab still provides the real tabId;
      // CSS compacts the marked tab as much as possible.
      try {
        if (!tab.pinned) gBrowser.pinTab(tab);
        tab.setAttribute("bgalazka-addon-host-fallback", "true");
      } catch (_) {}
      return null;
    }

    function createAddonHostRecord(app, userContextId) {
      if (!window.gBrowser?.addTab || !installAddonHostSelectionGuards())
        return null;
      const appId = app?.id;
      if (!appId) return null;

      const existing = addonHostByAppId.get(appId);
      if (existing?.tab?.isConnected && existing?.browser) return existing;

      const id = normalizeUserContextId(userContextId);
      const options = {
        skipAnimation: true,
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      };
      if (id) options.userContextId = id;

      let tab = null;
      try {
        tab = gBrowser.addTab("about:blank", options);
        if (!tab?.linkedBrowser)
          throw new Error("gBrowser.addTab returned no linkedBrowser");

        tab.setAttribute("bgalazka-addon-host", "true");
        tab.setAttribute("data-bgalazka-app-id", String(appId));
        tab.setAttribute(
          "label",
          `Zentral Host · ${getAddonHostAppLabel(app)}`,
        );
        tab._bgalazkaAddonAppId = appId;

        const browser = tab.linkedBrowser;
        browser._bgalazkaAddonHostBrowser = true;
        browser._bgalazkaAddonHostTab = tab;
        browser._bgalazkaAppId = appId;

        // Remember where Firefox originally mounted this linkedBrowser. Zentral
        // will reparent the SAME element into its floating panel. Before a host
        // tab is removed we put it back so gBrowser.removeTab() sees the normal
        // tabbrowser DOM shape and can tear it down safely.
        const originalParent = browser.parentNode;
        const originalNextSibling = browser.nextSibling;
        const record = {
          appId,
          app,
          tab,
          browser,
          originalParent,
          originalNextSibling,
          adoptedByZentral: false,
        };
        addonHostByAppId.set(appId, record);
        addonHostByTab.set(tab, record);

        putAddonHostTabInFolder(tab);
        // Folder creation can select its internal placeholder. Do not lend a
        // browser to Zentral until native selection has a safe owner.
        if (!ensureSafeSelectedTabForAddonHosts(tab)) {
          removeAddonHostRecord(appId);
          return null;
        }
        return record;
      } catch (e) {
        console.error(
          "[BgalazkaExtension] Failed to create add-on host tab:",
          e,
        );
        try {
          if (tab?.isConnected) {
            gBrowser.removeTab(tab, {
              animate: false,
              skipPermitUnload: true,
              skipSessionStore: true,
            });
          }
        } catch (_) {}
        return null;
      }
    }

    function restoreAddonHostBrowserToTab(record) {
      const browser = record?.browser;
      const parent = record?.originalParent;
      if (!browser || !parent?.isConnected || browser.parentNode === parent)
        return;
      try {
        const before =
          record.originalNextSibling?.parentNode === parent
            ? record.originalNextSibling
            : null;
        parent.insertBefore(browser, before);
      } catch (e) {
        try {
          parent.appendChild(browser);
        } catch (_) {}
      }
    }

    function removeAddonHostRecord(appId, { removeTab = true } = {}) {
      const record = addonHostByAppId.get(appId);
      if (!record) return null;

      // Remove our lookup FIRST. Our own removeTab() emits TabClose; doing this
      // first distinguishes that expected event from a user manually closing a
      // host tab, which is handled by addonHostTabCloseHandler below.
      addonHostByAppId.delete(appId);
      if (record.browser) {
        // Return the linkedBrowser to normal tab-switcher ownership before
        // restoring/removing its backing tab.
        record.browser.zenModeActive = false;
        record.browser._bgalazkaAddonHostBrowser = false;
        record.browser._bgalazkaAddonHostTab = null;
      }

      if (removeTab && record.tab?.isConnected) {
        restoreAddonHostBrowserToTab(record);
        try {
          gBrowser.removeTab(record.tab, {
            animate: false,
            skipPermitUnload: true,
            skipSessionStore: true,
          });
        } catch (e) {
          // Gecko can throw while removing the browser's progress listener
          // *after* it has already detached the tab. Report only live failures.
          if (record.tab?.isConnected)
            console.warn(
              "[BgalazkaExtension] Failed to remove add-on host tab:",
              e,
            );
        }
      }
      return record;
    }

    function removeEmptyAddonHostFolder() {
      const folder = findAddonHostFolder();
      if (!folder || addonHostByAppId.size) return;
      addonHostFolder = null;
      try {
        // Zen's folder owns an internal about:blank placeholder. delete() is the
        // correct API because it cleans that placeholder and folder state too.
        const maybePromise = folder.delete?.();
        maybePromise?.catch?.(() => {});
      } catch (_) {}
    }

    function unloadPanelBrowsersForAddonBridge() {
      const apps = window.Zentral?.Apps;
      if (!apps || addonBridgeResetting) return;
      addonBridgeResetting = true;
      try {
        // Toggling cannot safely retrofit an already-created standalone
        // <browser> into a real tab. Unload each loaded app so its next open goes
        // through the real-tab factory from the beginning.
        const ids = new Set();
        for (const browser of ctx.getAllAppBrowsers()) {
          if (browser?._bgalazkaAppId) ids.add(browser._bgalazkaAppId);
        }
        for (const appId of addonHostByAppId.keys()) ids.add(appId);

        if (ctx.recreateLoadedPanels) {
          ctx.recreateLoadedPanels([...ids]);
          return;
        }
        try {
          apps.closePanel?.();
        } catch (_) {}
        for (const appId of ids) {
          try {
            apps.closeApp?.(appId);
          } catch (e) {
            console.warn(
              "[BgalazkaExtension] Failed to unload panel while changing add-on bridge mode:",
              appId,
              e,
            );
          }
        }
      } finally {
        addonBridgeResetting = false;
        if (!isAddonTabIdBridgeEnabled()) removeEmptyAddonHostFolder();
      }
    }

    function syncAddonHostBrowserActivity() {
      for (const record of addonHostByAppId.values()) {
        if (!record?.adoptedByZentral || !record.browser?.isConnected) continue;
        try {
          // Zen's tab switcher can deactivate a real tab-backed browser when
          // another tab is selected. Split view uses zenModeActive to prevent
          // that; an adopted panel browser needs the same protection.
          record.browser.zenModeActive = true;
          if (record.browser.docShellIsActive !== true)
            record.browser.docShellIsActive = true;
        } catch (_) {}
      }
    }

    // ROOT FIX for "panel loads, plays for a second, then goes gray while
    // audio keeps playing" -- see ARCHITECTURE NOTE 28 above initBgalazkaExtension()
    // for the full symptom/diagnosis/fix history before changing anything here.
    //
    // Short version: core's getOrCreateAppBrowser() (and the
    // preload-sequence path) create standalone <browser remote="true">
    // elements that never sit in gBrowser's tab strip. Nothing in Gecko
    // activates those docShells on its own, and nothing in core ever sets
    // docShellIsActive either (see BUG-NOTES above the addon-host fix,
    // which only patches one narrow adopted-browser case). Gecko paints the
    // very first frame regardless, then treats the docShell as inactive and
    // stops compositing it - the tab's content process (and its audio) is
    // untouched, so playback continues while the panel goes visually gray.
    // This is independent of smart_sleep / any other toggle: it happens to
    // every panel browser, preloaded or not, the moment it's first shown.
    //
    // Fix: mirror docShellIsActive to the same display:none/'' visibility
    // flag core already uses to track which panel browser is on-screen
    // (getAllAppBrowsers() covers the normal grid, the Essentials/addon-host
    // bridge, and Triple/Super-View secondary browsers in one pass). This
    // also restores the resource-saving half of "smart sleep": browsers that
    // get hidden are explicitly deactivated instead of being left however
    // Gecko happens to leave them.
    function syncAppPanelBrowserActivity(browsers = ctx.getAllAppBrowsers()) {
      if (!browsers || typeof browsers[Symbol.iterator] !== "function")
        browsers = ctx.getAllAppBrowsers();
      for (const browser of browsers) {
        if (!browser?.isConnected) continue;
        try {
          // On close, the slider is hidden even though a child browser can
          // retain display:"". Do not keep a hidden panel's docshell active.
          const panelOpen =
            document.documentElement.getAttribute("zentral-app-panel-open") ===
            "true";
          // An Essential explicitly set to Load at Startup must stay active
          // while its panel is hidden so notification pages can keep updating.
          // Other hidden app browsers retain the existing idle behavior.
          const essential = ctx.essentialPanels.get(browser._bgalazkaAppId);
          const backgroundPreload =
            (essential?.app.preload && essential.tab.isConnected) ||
            window.Zentral?.Apps?.isAppPreloadEnabled?.(browser._bgalazkaAppId);
          const hostRecord = addonHostByAppId.get(browser._bgalazkaAppId);
          const adoptedHost =
            hostRecord?.adoptedByZentral && hostRecord.browser === browser;
          // A real-tab-backed browser must stay active while it is adopted.
          // syncAddonHostBrowserActivity() keeps it active on close, so setting
          // it false here immediately afterward caused an activation fight.
          const shouldBeActive =
            !!adoptedHost ||
            !!backgroundPreload ||
            (panelOpen && browser.style.display !== "none");
          // Gecko may reset this flag during navigation/process swaps. Only
          // write on a real state change: repeatedly assigning true while a
          // remote browser is loading can keep its tab in a busy/gray cycle.
          if (browser.docShellIsActive !== shouldBeActive)
            browser.docShellIsActive = shouldBeActive;
        } catch (_) {}
      }
    }

    function setAddonTabIdBridgeEnabled(enabled) {
      document.documentElement.setAttribute(
        "bgalazka-addon-tab-id-bridge",
        enabled ? "true" : "false",
      );
      ctx.reconcileFeaturePreferences?.();
    }

    function callGetOrCreateWithAddonHostBrowser(
      origGetOrCreateBrowser,
      app,
      userContextId,
    ) {
      if (!isAddonTabIdBridgeEnabled()) {
        return callGetOrCreateWithPanelUserContext(
          origGetOrCreateBrowser,
          app,
          userContextId,
        );
      }

      // If this app already has a bridge record, the base private Map should
      // return that same connected browser without creating anything new.
      const existing = addonHostByAppId.get(app?.id);
      if (existing?.browser?.isConnected && existing.adoptedByZentral) {
        return callGetOrCreateWithPanelUserContext(
          origGetOrCreateBrowser,
          app,
          userContextId,
        );
      }

      const record = createAddonHostRecord(app, userContextId);
      if (!record) {
        // Fail open: Zentral still works even if Zen's tab/folder internals have
        // changed. Only add-on tab-ID compatibility is lost for this instance.
        return callGetOrCreateWithPanelUserContext(
          origGetOrCreateBrowser,
          app,
          userContextId,
        );
      }

      const nativeCreateXULElement = document.createXULElement;
      let intercepted = false;
      try {
        document.createXULElement = function (name, options) {
          if (!intercepted && String(name).toLowerCase() === "browser") {
            intercepted = true;
            return record.browser;
          }
          return nativeCreateXULElement.call(this, name, options);
        };
        if (document.createXULElement === nativeCreateXULElement) {
          throw new Error(
            "document.createXULElement could not be temporarily wrapped",
          );
        }

        const result = callGetOrCreateWithPanelUserContext(
          origGetOrCreateBrowser,
          app,
          userContextId,
        );

        if (
          !intercepted ||
          !result?.isNew ||
          result.browser !== record.browser
        ) {
          // A pre-existing standalone panel browser beat us to the base Map.
          // Remove the unused host and keep the working base result rather than
          // trying to mutate private state after the fact.
          removeAddonHostRecord(record.appId);
          removeEmptyAddonHostFolder();
          return result;
        }

        record.adoptedByZentral = true;
        // Keep the host's tab identity without letting Zen deactivate its
        // reparented browser when the ordinary selected tab changes.
        result.browser.zenModeActive = true;
        result.browser.setAttribute("bgalazka-addon-host-browser", "true");
        return result;
      } catch (e) {
        removeAddonHostRecord(record.appId);
        removeEmptyAddonHostFolder();
        console.error(
          "[BgalazkaExtension] Real-tab browser adoption failed; using normal Zentral browser:",
          e,
        );
        return callGetOrCreateWithPanelUserContext(
          origGetOrCreateBrowser,
          app,
          userContextId,
        );
      } finally {
        try {
          document.createXULElement = nativeCreateXULElement;
        } catch (_) {}
      }
    }

    // The host's linkedBrowser belongs to a real tab, but that tab is never a
    // valid destination for the selected browser. Keep this test centralized so
    // unload, close, discard, and TabSelect recovery all enforce the same rule.
    function isAddonHostTab(tab) {
      return !!(
        tab &&
        (tab.hasAttribute?.("bgalazka-addon-host") ||
          tab.hasAttribute?.("bgalazka-addon-host-fallback") ||
          tab.closest?.(
            "#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']",
          ))
      );
    }

    function isUsableNormalTab(tab) {
      return !!(
        tab?.isConnected &&
        !tab.closing &&
        !tab.hidden &&
        !isAddonHostTab(tab)
      );
    }

    function isOrdinaryTab(tab) {
      // Zen's pinned tabs, Essentials, and empty-tab placeholder are all real
      // tabs, but none counts as an ordinary successor when the last one closes.
      // A discarded ordinary tab still counts: selecting it restores its page.
      return !!(
        isUsableNormalTab(tab) &&
        !tab.pinned &&
        !tab.hasAttribute("zen-essential") &&
        !tab.hasAttribute("zen-empty-tab")
      );
    }

    function findVisibleOrdinaryTab(except) {
      return [...(gBrowser.visibleTabs || gBrowser.tabs)].find(
        (tab) => tab !== except && isOrdinaryTab(tab),
      );
    }

    function createNormalTabForAddonHost(exceptTab = null) {
      try {
        // Use Zen's own empty-tab selection so URL-bar-only new tabs keep their
        // native invisible placeholder. Its tab is a safe selected browser even
        // while the panel's real host tabs remain open in the background.
        if (typeof window.gZenWorkspaces?.selectEmptyTab === "function") {
          try {
            window.gZenWorkspaces.selectEmptyTab("about:blank");
            const tab = gBrowser.selectedTab;
            if (tab !== exceptTab && isUsableNormalTab(tab)) {
              lastNonAddonHostTab = tab;
              return tab;
            }
          } catch (error) {
            console.warn(
              "[BgalazkaExtension] Zen empty-tab selection failed:",
              error,
            );
          }
        }
        // Older Zen builds may lack selectEmptyTab. Keep a real blank tab in
        // that case rather than allow the adopted panel browser to be selected.
        const tab = gBrowser.addTab("about:blank", {
          inBackground: true,
          skipAnimation: true,
          triggeringPrincipal:
            Services.scriptSecurityManager.getSystemPrincipal(),
        });
        if (tab) {
          lastNonAddonHostTab = tab;
          gBrowser.selectedTab = tab;
        }
        return tab;
      } catch (error) {
        console.warn(
          "[BgalazkaExtension] Could not select an empty tab after the last ordinary tab closed:",
          error,
        );
        return null;
      }
    }

    // Central invariant for the real-tab bridge: a Zentral panel host may exist
    // in gBrowser for WebExtension tabId compatibility, but it must never remain
    // the selected tab. Prefer an already-safe tab, then the last safe tab, then
    // another ordinary tab, and finally Zen's own invisible empty tab.
    function ensureSafeSelectedTabForAddonHosts(exceptTab = null) {
      if (
        addonHostByAppId.size === 0 &&
        !isAddonHostTab(gBrowser.selectedTab)
      ) {
        return gBrowser.selectedTab;
      }

      const selected = gBrowser.selectedTab;
      if (
        selected !== exceptTab &&
        isUsableNormalTab(selected) &&
        !isAddonHostTab(selected)
      ) {
        lastNonAddonHostTab = selected;
        return selected;
      }

      let candidate = null;
      if (
        lastNonAddonHostTab !== exceptTab &&
        isUsableNormalTab(lastNonAddonHostTab) &&
        !isAddonHostTab(lastNonAddonHostTab)
      ) {
        candidate = lastNonAddonHostTab;
      } else {
        candidate = findVisibleOrdinaryTab(exceptTab);
      }

      if (candidate) {
        try {
          gBrowser.selectedTab = candidate;
          if (
            gBrowser.selectedTab === candidate &&
            candidate !== exceptTab &&
            !isAddonHostTab(candidate)
          ) {
            lastNonAddonHostTab = candidate;
            return candidate;
          }
        } catch (_) {}
      }

      const emptyTab = createNormalTabForAddonHost(exceptTab);
      if (
        emptyTab?.isConnected &&
        gBrowser.selectedTab === emptyTab &&
        emptyTab !== exceptTab &&
        !isAddonHostTab(emptyTab)
      ) {
        return emptyTab;
      }
      return null;
    }

    // TabSelect is a notification, not a cancellable selection request. By
    // then Gecko has changed the selected browser and Zen's native call stack
    // still holds the host tab, even if a listener switches away again. Stop
    // hosts at the setters BEFORE tab attributes, panels or switchers change.
    // Keep hosts in gBrowser.tabs: WebExtensions still need their real IDs.
    function installAddonHostSelectionGuards() {
      if (addonHostSelectionGuardsInstalled) return true;
      const undo = [];
      const guardSetter = (object, name, tabForValue) => {
        const own = Object.getOwnPropertyDescriptor(object, name);
        let owner = object;
        let descriptor;
        while (
          owner &&
          !(descriptor = Object.getOwnPropertyDescriptor(owner, name))
        ) {
          owner = Object.getPrototypeOf(owner);
        }
        if (
          !descriptor?.set ||
          !descriptor.get ||
          own?.configurable === false
        ) {
          throw new Error(`Cannot guard native ${name} selection`);
        }
        const guardedSet = function (value) {
          const tab = tabForValue.call(this, value);
          if (!isAddonHostTab(tab)) return descriptor.set.call(this, value);
          // This also applies during bridge teardown, while marked tabs still
          // exist. Preference changes must not expose an adopted browser.
          if (redirectingAddonHostSelection) return;
          redirectingAddonHostSelection = true;
          try {
            ensureSafeSelectedTabForAddonHosts(tab);
            showAddonHostPanel(tab);
          } finally {
            redirectingAddonHostSelection = false;
          }
        };
        Object.defineProperty(object, name, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: descriptor.get,
          set: guardedSet,
        });
        undo.push(() => {
          // Do not overwrite another customization installed after ours.
          if (Object.getOwnPropertyDescriptor(object, name)?.set !== guardedSet)
            return;
          if (own) Object.defineProperty(object, name, own);
          else delete object[name];
        });
      };
      try {
        guardSetter(gBrowser, "selectedTab", (value) => value);
        guardSetter(gBrowser.tabContainer, "selectedItem", (value) => value);
        guardSetter(gBrowser.tabContainer, "selectedIndex", function (value) {
          return this.getItemAtIndex(value);
        });
      } catch (error) {
        undo.reverse().forEach((restore) => restore());
        console.warn(
          "[BgalazkaExtension] Real Tab IDs disabled for this panel: selection guard unavailable",
          error,
        );
        return false;
      }
      addonHostSelectionGuardsInstalled = true;
      removeAddonHostSelectionGuards = () => {
        undo.reverse().forEach((restore) => restore());
        addonHostSelectionGuardsInstalled = false;
        removeAddonHostSelectionGuards = null;
      };
      return true;
    }

    function showAddonHostPanel(tab) {
      const record = addonHostByTab.get(tab);
      if (!record) return;
      keepAddonHostFolderCollapsed(record.tab?.group);
      ctx.setTimeout(() => {
        if (
          addonHostByAppId.get(record.appId) === record &&
          record.tab.isConnected
        ) {
          window.Zentral?.Apps?.openPanel?.(record.app);
        }
      }, 0);
    }

    // Zen retains a previous tab independently of gBrowser's current selection
    // and later uses its browser directly for split previews. Drop stale host
    // references before the native drag listener runs (including folder tabs).
    const addonHostSplitDragHandler = () => {
      const splitter = window.gZenViewSplitter;
      if (splitter && isAddonHostTab(splitter._lastOpenedTab)) {
        const selected = gBrowser.selectedTab;
        splitter._lastOpenedTab = isUsableNormalTab(selected) ? selected : null;
      }
    };
    window.addEventListener("dragover", addonHostSplitDragHandler, true);
    ctx.registerCleanup(() => {
      window.removeEventListener("dragover", addonHostSplitDragHandler, true);
    });

    // Selection can settle over more than one turn during close/discard. Repair
    // immediately, in a microtask, on the next task, and once on the next frame.
    // Every pass is conditional, so normal user selection is left untouched.
    function repairAddonHostSelectionAfterTransition(exceptTab = null) {
      if (!isAddonTabIdBridgeEnabled() || addonHostByAppId.size === 0) return;

      const repair = () => {
        if (!isAddonTabIdBridgeEnabled() || addonHostByAppId.size === 0) return;
        const selected = gBrowser.selectedTab;
        if (
          selected === exceptTab ||
          isAddonHostTab(selected) ||
          !isUsableNormalTab(selected)
        ) {
          ensureSafeSelectedTabForAddonHosts(exceptTab);
        }
      };

      repair();
      Promise.resolve().then(repair);
      window.setTimeout(repair, 0);
      window.requestAnimationFrame?.(repair);
    }

    // A click/keyboard selection of a host returns to a normal tab and opens
    // the corresponding panel. The saved tab can have closed in the meantime.
    // No MutationObserver is used -- see the tab crash guard above.
    const addonHostTabSelectHandler = (event) => {
      const tab = event.target;
      const record = addonHostByTab.get(tab);

      // Fallback for native/version-specific code bypassing the guarded
      // setters. Do not publish a stale host TabSelect to Zen's split history.
      if (isAddonHostTab(tab)) {
        event.stopImmediatePropagation();
        ensureSafeSelectedTabForAddonHosts(tab);
        showAddonHostPanel(tab);
        return;
      }

      if (!record) {
        if (isUsableNormalTab(tab)) lastNonAddonHostTab = tab;
        return;
      }
    };

    const addonHostTabCloseHandler = (event) => {
      const tab = event.target;
      const record = addonHostByTab.get(tab);
      if (!record) {
        const wasActiveNonHostTab =
          gBrowser.selectedTab === tab || lastNonAddonHostTab === tab;
        if (lastNonAddonHostTab === tab) lastNonAddonHostTab = null;
        if (
          isAddonTabIdBridgeEnabled() &&
          addonHostByAppId.size &&
          wasActiveNonHostTab &&
          !tab.hasAttribute("bgalazka-addon-host") &&
          !tab.hasAttribute("bgalazka-addon-host-fallback") &&
          !tab.closest(
            "#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']",
          ) &&
          !tab.hasAttribute("zen-empty-tab") &&
          !findVisibleOrdinaryTab(tab)
        ) {
          // TabClose fires while the closing tab is still in the tab strip.
          // The closing tab can be ordinary, pinned, or Essential. Supply Zen's
          // empty-tab successor now, before native close logic can pick a host.
          createNormalTabForAddonHost();
        }
        return;
      }
      if (addonHostByAppId.get(record.appId) !== record) return;

      // This path means the user/Zen closed the backing tab directly. Let the
      // tab close finish first, then ask Zentral to unload the matching private
      // Map entry/browser. Our own programmatic teardown removes the Map record
      // before removeTab(), so it never enters this branch.
      restoreAddonHostBrowserToTab(record);
      addonHostByAppId.delete(record.appId);
      record.browser.zenModeActive = false;
      ctx.setTimeout(() => {
        try {
          window.Zentral?.Apps?.closeApp?.(record.appId);
        } catch (_) {}
        removeEmptyAddonHostFolder();
      }, 0);
    };

    const addonHostTabDiscardedHandler = (event) => {
      const tab = event.target;
      if (!isAddonTabIdBridgeEnabled() || !addonHostByAppId.size) return;

      // A discard can trigger more than one native selection adjustment. Treat
      // every discard as a chance to reassert the bridge invariant; the repair
      // helper is a no-op while a normal/Essential/empty tab is safely selected.
      if (lastNonAddonHostTab === tab) lastNonAddonHostTab = null;
      repairAddonHostSelectionAfterTransition(tab);
    };

    // Capture TabSelect so a real panel-host tab is redirected before normal
    // bubbling listeners can treat its reparented browser as the active page.
    window.addEventListener("TabSelect", addonHostTabSelectHandler, true);
    window.addEventListener("TabClose", addonHostTabCloseHandler);
    window.addEventListener(
      "TabBrowserDiscarded",
      addonHostTabDiscardedHandler,
    );
    ctx.registerCleanup(() => {
      window.removeEventListener("TabSelect", addonHostTabSelectHandler, true);
      window.removeEventListener("TabClose", addonHostTabCloseHandler);
      window.removeEventListener(
        "TabBrowserDiscarded",
        addonHostTabDiscardedHandler,
      );
      const apps = window.Zentral?.Apps;
      const ids = [...addonHostByAppId.keys()];
      for (const appId of ids) {
        try {
          apps?.closeApp?.(appId);
        } catch (_) {
          removeAddonHostRecord(appId);
        }
      }
      removeEmptyAddonHostFolder();
      removeAddonHostSelectionGuards?.();
    });

    function callGetOrCreateWithPanelUserContext(
      origGetOrCreateBrowser,
      app,
      userContextId,
    ) {
      const id = normalizeUserContextId(userContextId);
      if (!id) return origGetOrCreateBrowser(app);

      // The base function writes usercontextid="0" before appendChild(). Patch
      // Element.prototype only for the synchronous duration of that one call and
      // only for the exact unattached content <browser> shape Zentral creates.
      // This gets the desired id onto the element before connectedCallback/frame
      // loader creation without editing a single line of the base implementation.
      const proto = window.Element?.prototype;
      const nativeSetAttribute = proto?.setAttribute;
      let patched = false;

      if (proto && typeof nativeSetAttribute === "function") {
        try {
          proto.setAttribute = function (name, value) {
            let nextValue = value;
            if (
              String(name).toLowerCase() === "usercontextid" &&
              this?.localName === "browser" &&
              (this._bgalazkaAddonHostBrowser ||
                (!this.isConnected &&
                  this.getAttribute?.("type") === "content" &&
                  this.getAttribute?.("messagemanagergroup") === "browsers"))
            ) {
              nextValue = String(id);
            }
            return nativeSetAttribute.call(this, name, nextValue);
          };
          patched = proto.setAttribute !== nativeSetAttribute;
        } catch (e) {
          console.warn(
            "[BgalazkaExtension] Could not pre-apply panel userContextId:",
            e,
          );
        }
      }

      try {
        return origGetOrCreateBrowser(app);
      } finally {
        if (patched) {
          try {
            proto.setAttribute = nativeSetAttribute;
          } catch (_) {}
        }
      }
    }

    function applyPanelContainerLoadContext(browser, userContextId) {
      const id = normalizeUserContextId(userContextId);
      if (!browser || !id) return;

      browser._bgalazkaUserContextId = id;
      try {
        // Normally already correct from callGetOrCreateWithPanelUserContext().
        // Keep this as a defensive postcondition for browser builds where the
        // temporary prototype interception is unavailable.
        if (
          normalizeUserContextId(browser.getAttribute("usercontextid")) !== id
        ) {
          browser.setAttribute("usercontextid", String(id));
        }
      } catch (_) {}

      if (browser._bgalazkaContainerLoadHooked) return;
      browser._bgalazkaContainerLoadHooked = true;

      const applyLoadOptions = (target, options) => {
        const next = { ...(options || {}), userContextId: id };
        try {
          const principal = next.triggeringPrincipal;
          if (principal?.isContentPrincipal) {
            const attrs = {
              ...(principal.originAttributes || {}),
              userContextId: id,
            };
            next.triggeringPrincipal =
              Services.scriptSecurityManager.principalWithOA(principal, attrs);
          } else if (!principal) {
            const uri =
              typeof target === "string" ? Services.io.newURI(target) : target;
            if (uri) {
              next.triggeringPrincipal =
                Services.scriptSecurityManager.createContentPrincipal(uri, {
                  userContextId: id,
                });
            }
          }
        } catch (e) {
          console.warn(
            "[BgalazkaExtension] Failed to apply container OriginAttributes to load:",
            e,
          );
        }
        return next;
      };

      const nativeFixupAndLoad = browser.fixupAndLoadURIString?.bind(browser);
      if (nativeFixupAndLoad) {
        try {
          browser.fixupAndLoadURIString = function (url, options = {}) {
            return nativeFixupAndLoad(url, applyLoadOptions(url, options));
          };
        } catch (e) {
          console.warn(
            "[BgalazkaExtension] Could not wrap fixupAndLoadURIString for container loads:",
            e,
          );
        }
      }

      const nativeLoadURI = browser.loadURI?.bind(browser);
      if (nativeLoadURI) {
        try {
          browser.loadURI = function (uri, options = {}) {
            return nativeLoadURI(uri, applyLoadOptions(uri, options));
          };
        } catch (e) {
          console.warn(
            "[BgalazkaExtension] Could not wrap loadURI for container loads:",
            e,
          );
        }
      }
    }

    /* ==========================================================================
     * MOBILE USER AGENT TOGGLE (per-app checkbox, mirrors native "Load at Startup")
     * -----------------------------------------------------------------------
     * Feature: a per-app "Mobile User Agent" checkbox living in the same tile
     * right-click menu as the native "Load at Startup" item, remembered per-app
     * across restarts exactly the same way.
     *
     * WHY THIS IS HOOKED RATHER THAN EDITED IN PLACE (see notes 1 & 5 above):
     * - setupContextMenu() and getOrCreateAppBrowser() belong to the
     *   ZentralApps class defined in the base mod's own IIFE, ABOVE the
     *   Bgalazka marker. We never edit that source directly; we reach the
     *   singleton instance (window.Zentral.Apps, see note 5) and either wrap
     *   its methods or attach DOM nodes to elements it already built.
     * - We deliberately do NOT add a "mobileUA" field to the base mod's own
     *   app objects / saveApps() whitelist, since that means editing
     *   ZentralApps.saveApps() itself. Instead the per-app flag lives in its
     *   own dedicated pref (a JSON array of app ids), entirely inside this
     *   extension, so the native save/load code never needs to change.
     * - Gecko does not re-apply a <browser>'s "useragent"/"customuseragent"
     *   attribute to an already-connected/loaded docShell. So flipping the
     *   checkbox unloads that app's browser via the singleton's own
     *   closeApp() (same public method "Unload App" already uses) instead of
     *   trying to hot-swap the UA live — it reloads with the correct UA next
     *   time the app is opened or preloaded.
     * ========================================================================== */
    const MOBILE_UA_PREF = "zen.workspace.bgalazka.mobile_ua_apps";
    const readIdentityAssignments = () => {
      let containers = {},
        mobile = [];
      try {
        containers = JSON.parse(ctx.getPref(PANEL_CONTAINERS_PREF, "{}")) || {};
      } catch (_) {}
      try {
        mobile = JSON.parse(ctx.getPref(MOBILE_UA_PREF, "[]")) || [];
      } catch (_) {}
      if (!Array.isArray(mobile)) mobile = [];
      return { containers, mobile: new Set(mobile) };
    };
    let lastIdentityAssignments = readIdentityAssignments(),
      identityTimer = null;
    const identityObserver = {
      observe: () => {
        if (identityTimer != null) return;
        identityTimer = ctx.setTimeout(() => {
          identityTimer = null;
          const next = readIdentityAssignments(),
            previous = lastIdentityAssignments;
          lastIdentityAssignments = next;
          const ids = new Set([
            ...Object.keys(previous.containers),
            ...Object.keys(next.containers),
            ...previous.mobile,
            ...next.mobile,
          ]);
          const changed = [...ids].filter(
            (id) =>
              (previous.containers[id] || 0) !== (next.containers[id] || 0) ||
              previous.mobile.has(id) !== next.mobile.has(id),
          );
          if (changed.length) ctx.recreateLoadedPanels?.(changed);
        }, 0);
      },
    };
    for (const pref of [PANEL_CONTAINERS_PREF, MOBILE_UA_PREF])
      Services.prefs.addObserver(pref, identityObserver);
    ctx.registerCleanup(() => {
      for (const pref of [PANEL_CONTAINERS_PREF, MOBILE_UA_PREF])
        Services.prefs.removeObserver(pref, identityObserver);
      if (identityTimer != null) ctx.clearTimeout(identityTimer);
    });
    const MOBILE_UA_STRING =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";

    function getMobileUaAppIds() {
      try {
        const raw = Services.prefs.getStringPref(MOBILE_UA_PREF, "[]");
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
      } catch (_) {
        return new Set();
      }
    }

    function saveMobileUaAppIds(set) {
      try {
        Services.prefs.setStringPref(
          MOBILE_UA_PREF,
          JSON.stringify(Array.from(set)),
        );
      } catch (e) {
        console.warn("[BgalazkaExtension] Failed to save mobile UA list:", e);
      }
    }

    function isMobileUaApp(appId) {
      if (ctx.essentialPanels.has(appId))
        return !!ctx.essentialPanels.get(appId).mobileUa;
      return !!appId && getMobileUaAppIds().has(appId);
    }

    function toggleMobileUaApp(appId) {
      const essential = ctx.essentialPanels.get(appId);
      if (essential) {
        essential.mobileUa = !essential.mobileUa;
        ctx.saveEssentialSettings(essential);
        ctx.setTimeout(() => ctx.recreateLoadedPanels?.([appId]), 0);
        return essential.mobileUa;
      }
      const set = getMobileUaAppIds();
      const next = !set.has(appId);
      if (next) set.add(appId);
      else set.delete(appId);
      saveMobileUaAppIds(set);
      return next;
    }

    // Injects one extra <menuitem> into the native tile context menu, right
    // after "Load at Startup" — instead of editing ZentralApps.setupContextMenu().
    function ensureMobileUaMenuItem() {
      const popup = document.getElementById("zen-apps-sidebar-tile-context");
      if (!popup) return false;
      const preloadItem = popup.querySelector("#zen-apps-sidebar-preload-item");
      if (!preloadItem) return false;

      let item = popup.querySelector("#zen-apps-sidebar-mobile-ua-item");
      if (!item) {
        item = document.createXULElement("menuitem");
        item.id = "zen-apps-sidebar-mobile-ua-item";
        item.setAttribute("label", "Mobile User Agent");
        item.setAttribute("type", "checkbox");
        // Keep the privacy controls directly after the native preload row:
        // Load at Startup -> Container -> Clear Cache & Cookies -> Mobile UA.
        const insertionAnchor =
          popup.querySelector("#zen-apps-sidebar-clear-panel-data-item") ||
          popup.querySelector("#zen-apps-sidebar-container-menu") ||
          preloadItem;
        insertionAnchor.insertAdjacentElement("afterend", item);

        // Same hide/show + checked-state contract as the native items: driven
        // entirely by popup.dataset.activeAppId, which ZentralApps already
        // sets before showing the menu.
        popup.addEventListener("popupshowing", () => {
          const appId = popup.dataset.activeAppId || "";
          item.hidden = !appId;
          if (!appId) return;
          if (isMobileUaApp(appId)) item.setAttribute("checked", "true");
          else item.removeAttribute("checked");
        });

        item.addEventListener("command", () => {
          const appId = popup.dataset.activeAppId;
          if (!appId) return;
          const enabled = toggleMobileUaApp(appId);
          if (enabled) item.setAttribute("checked", "true");
          else item.removeAttribute("checked");

          // Force a clean reload with the new UA (see note above).
          const apps = window.Zentral?.Apps;
          // Let the XUL command/popup finish before destroying its live remote
          // browser. The next open creates a fresh context with the new UA.
          // The identity preference observer schedules recreation after this popup closes.
        });
      }
      return true;
    }

    if (!ctx.safeCall(ensureMobileUaMenuItem, "ensureMobileUaMenuItem")) {
      let mobileUaAttempts = 0;
      const mobileUaMenuTimer = ctx.setInterval(() => {
        mobileUaAttempts++;
        if (
          ctx.safeCall(ensureMobileUaMenuItem, "ensureMobileUaMenuItem") ||
          mobileUaAttempts > 40
        ) {
          ctx.clearInterval(mobileUaMenuTimer);
        }
      }, 150);
      ctx.registerCleanup(() => ctx.clearInterval(mobileUaMenuTimer));
    }
  });
})();
