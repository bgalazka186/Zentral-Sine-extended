/*
 * ZENTRAL FILE GUIDE - features/apps/controllers/ZentralAppsInteractions.js
 *
 * Purpose: Owns Apps context-menu commands, outside-click handling and Insta Peek shortcut matching,
 *   press/release and blur restoration.
 * Interaction / execution: Installed and bound by ZentralApps constructor. Uses Model to add apps and
 *   Lifecycle/Position to open, restore and position panels. Launcher supplies utility/Apps DOM.
 * Ownership / failure: Uses live state/dom and the owner as this. Apps owns global listener cleanup; menu
 *   nodes carry their own command listeners. Shortcut matching and menu actions are required Apps
 *   internals.
 * Registration: apps/ZentralAppsInteractions
 * Loaded/created by: features/apps/ZentralApps.uc.js
 * Returned factory API: endInstaPeek; handleInstaPeekBlur; handleInstaPeekKeyDown; handleInstaPeekKeyUp;
 *   handleOutsideClick; handleTabContextMenuCommand; isShortcutMatch; setupContextMenu
 * Live owner accessors/callbacks: dom; state
 * Cross-file calls / ctx suppliers: features/apps/controllers/ZentralAppModel.js -> addApp, getZenWorkspacesList, saveApps;
 *   features/apps/controllers/ZentralAppsLauncher.js -> renderGrid, updateAutohideState; features/apps/controllers/ZentralPanelLifecycle.js ->
 *   closeApp, closePanel, refreshApp, removeApp
 * Contract fields assigned here: access.state.isInstaPeeking
 * Literal DOM event subscriptions: command; popupshowing
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "apps/ZentralAppsInteractions",
    function ({ Services, shared, runtime, access }) {
      const {
        Constants,
        Core,
        createSVGElement,
        SVG_STRINGS,
        WELL_KNOWN_SERVICES,
      } = shared;
      return {
        // Responsibility: ZentralAppsMenus
        setupContextMenu() {
          let oldPopup = document.getElementById(
            "zen-apps-sidebar-tile-context",
          );
          if (oldPopup) oldPopup.remove();

          let popup = null;
          if (window.MozXULElement?.parseXULToFragment) {
            const frag = window.MozXULElement
              .parseXULToFragment(`<menupopup id="zen-apps-sidebar-tile-context">
          <menuitem id="zen-apps-sidebar-refresh-item" label="Refresh App"/>
          <menuitem id="zen-apps-sidebar-preload-item" type="checkbox" label="Load at Startup"/>
          <menuitem id="zen-apps-sidebar-close-app-item" label="Unload App"/>
          <menuseparator id="zen-apps-sidebar-sec1-sep"/>
          <menu id="zen-apps-sidebar-pin-to-menu" label="Pin App to">
            <menupopup id="zen-apps-sidebar-pin-to-popup"></menupopup>
          </menu>
          <menuseparator id="zen-apps-sidebar-sec2-sep"/>
          <menuitem id="zen-apps-sidebar-autohide-item" type="checkbox" label="Autohide Apps"/>
          <menuitem id="zen-apps-sidebar-settings-item" label="Zentral Settings"/>
          <menuseparator id="zen-apps-sidebar-sec3-sep"/>
          <menuitem id="zen-apps-sidebar-remove-item" label="Remove App"/>
        </menupopup>`);
            (
              document.getElementById("mainPopupSet") || document.body
            ).appendChild(frag);
            popup = document.getElementById("zen-apps-sidebar-tile-context");
          } else {
            popup = document.createXULElement("menupopup");
            popup.id = "zen-apps-sidebar-tile-context";
            const refreshItem = document.createXULElement("menuitem");
            refreshItem.id = "zen-apps-sidebar-refresh-item";
            refreshItem.setAttribute("label", "Refresh App");
            const preloadItem = document.createXULElement("menuitem");
            preloadItem.id = "zen-apps-sidebar-preload-item";
            preloadItem.setAttribute("label", "Load at Startup");
            preloadItem.setAttribute("type", "checkbox");
            const closeAppItem = document.createXULElement("menuitem");
            closeAppItem.id = "zen-apps-sidebar-close-app-item";
            closeAppItem.setAttribute("label", "Unload App");
            const sec1Sep = document.createXULElement("menuseparator");
            sec1Sep.id = "zen-apps-sidebar-sec1-sep";

            const pinToMenu = document.createXULElement("menu");
            pinToMenu.id = "zen-apps-sidebar-pin-to-menu";
            pinToMenu.setAttribute("label", "Pin App to");
            const pinToPopup = document.createXULElement("menupopup");
            pinToPopup.id = "zen-apps-sidebar-pin-to-popup";
            pinToMenu.appendChild(pinToPopup);
            const sec2Sep = document.createXULElement("menuseparator");
            sec2Sep.id = "zen-apps-sidebar-sec2-sep";

            const autohideItem = document.createXULElement("menuitem");
            autohideItem.id = "zen-apps-sidebar-autohide-item";
            autohideItem.setAttribute("label", "Autohide Apps");
            autohideItem.setAttribute("type", "checkbox");
            const settingsItem = document.createXULElement("menuitem");
            settingsItem.id = "zen-apps-sidebar-settings-item";
            settingsItem.setAttribute("label", "Zentral Settings");
            const sec3Sep = document.createXULElement("menuseparator");
            sec3Sep.id = "zen-apps-sidebar-sec3-sep";

            const removeMenuItem = document.createXULElement("menuitem");
            removeMenuItem.id = "zen-apps-sidebar-remove-item";
            removeMenuItem.setAttribute("label", "Remove App");

            popup.appendChild(refreshItem);
            popup.appendChild(preloadItem);
            popup.appendChild(closeAppItem);
            popup.appendChild(sec1Sep);
            popup.appendChild(pinToMenu);
            popup.appendChild(sec2Sep);
            popup.appendChild(autohideItem);
            popup.appendChild(settingsItem);
            popup.appendChild(sec3Sep);
            popup.appendChild(removeMenuItem);
            (
              document.getElementById("mainPopupSet") || document.body
            ).appendChild(popup);
          }

          if (!popup) return;

          popup.addEventListener("popupshowing", () => {
            const hasApp = !!popup.dataset.activeAppId;
            const refreshBtn = popup.querySelector(
              "#zen-apps-sidebar-refresh-item",
            );
            const preloadBtn = popup.querySelector(
              "#zen-apps-sidebar-preload-item",
            );
            const closeAppBtn = popup.querySelector(
              "#zen-apps-sidebar-close-app-item",
            );
            const sec1Sep = popup.querySelector("#zen-apps-sidebar-sec1-sep");
            const pinToMenu = popup.querySelector(
              "#zen-apps-sidebar-pin-to-menu",
            );
            const sec2Sep = popup.querySelector("#zen-apps-sidebar-sec2-sep");
            const autohideBtn = popup.querySelector(
              "#zen-apps-sidebar-autohide-item",
            );
            const settingsBtn = popup.querySelector(
              "#zen-apps-sidebar-settings-item",
            );
            const sec3Sep = popup.querySelector("#zen-apps-sidebar-sec3-sep");
            const removeBtn = popup.querySelector(
              "#zen-apps-sidebar-remove-item",
            );

            if (refreshBtn) refreshBtn.hidden = !hasApp;
            if (preloadBtn) preloadBtn.hidden = !hasApp;
            if (closeAppBtn) closeAppBtn.hidden = !hasApp;
            if (sec1Sep) sec1Sep.hidden = !hasApp;
            if (pinToMenu) pinToMenu.hidden = !hasApp;
            if (sec2Sep) sec2Sep.hidden = !hasApp;
            if (sec3Sep) sec3Sep.hidden = !hasApp;
            if (removeBtn) removeBtn.hidden = !hasApp;

            if (autohideBtn) {
              const isAutohide =
                Core.getPref(Constants.Apps.PREF_AUTOHIDE, false) === true;
              if (isAutohide) autohideBtn.setAttribute("checked", "true");
              else autohideBtn.removeAttribute("checked");
            }

            if (hasApp) {
              const appId = popup.dataset.activeAppId;
              const app = access.state.apps.find((a) => a.id === appId);
              const isLoaded = access.state.appBrowsers.has(appId);
              if (closeAppBtn) {
                if (!isLoaded) {
                  closeAppBtn.setAttribute("disabled", "true");
                  closeAppBtn.disabled = true;
                } else {
                  closeAppBtn.removeAttribute("disabled");
                  closeAppBtn.disabled = false;
                }
              }

              if (app) {
                if (preloadBtn) {
                  if (app.preload) preloadBtn.setAttribute("checked", "true");
                  else preloadBtn.removeAttribute("checked");
                }

                const pinPopup = popup.querySelector(
                  "#zen-apps-sidebar-pin-to-popup",
                );
                if (pinPopup) {
                  pinPopup.replaceChildren();
                  const currentWsId = window.gZenWorkspaces?.activeWorkspace;

                  const allSpacesItem = document.createXULElement
                    ? document.createXULElement("menuitem")
                    : document.createElement("menuitem");
                  allSpacesItem.setAttribute("label", "All Spaces");
                  allSpacesItem.setAttribute("type", "checkbox");
                  if (!app.workspaceId || app.workspaceId === "all") {
                    allSpacesItem.setAttribute("checked", "true");
                  }
                  allSpacesItem.addEventListener("command", () => {
                    app.workspaceId = "all";
                    this.saveApps();
                    this.renderGrid();
                  });
                  pinPopup.appendChild(allSpacesItem);

                  const thisSpaceItem = document.createXULElement
                    ? document.createXULElement("menuitem")
                    : document.createElement("menuitem");
                  thisSpaceItem.setAttribute("label", "this Space");
                  thisSpaceItem.setAttribute("type", "checkbox");
                  if (!currentWsId)
                    thisSpaceItem.setAttribute("disabled", "true");
                  if (app.workspaceId === currentWsId) {
                    thisSpaceItem.setAttribute("checked", "true");
                  }
                  thisSpaceItem.addEventListener("command", () => {
                    const activeWsId = window.gZenWorkspaces?.activeWorkspace;
                    if (!activeWsId) return;
                    app.workspaceId = activeWsId;
                    this.saveApps();
                    this.renderGrid();
                  });
                  pinPopup.appendChild(thisSpaceItem);

                  const allWorkspaces = this.getZenWorkspacesList();
                  for (const ws of allWorkspaces) {
                    if (ws.id === currentWsId) continue;
                    const wsItem = document.createXULElement
                      ? document.createXULElement("menuitem")
                      : document.createElement("menuitem");
                    wsItem.setAttribute("label", ws.name || ws.id);
                    wsItem.setAttribute("type", "checkbox");
                    if (app.workspaceId === ws.id) {
                      wsItem.setAttribute("checked", "true");
                    }
                    wsItem.addEventListener("command", () => {
                      app.workspaceId = ws.id;
                      this.saveApps();
                      this.renderGrid();
                    });
                    pinPopup.appendChild(wsItem);
                  }
                }
              }
            }
          });

          popup
            .querySelector("#zen-apps-sidebar-refresh-item")
            ?.addEventListener("command", () => {
              if (popup.dataset.activeAppId)
                this.refreshApp(popup.dataset.activeAppId);
            });

          popup
            .querySelector("#zen-apps-sidebar-close-app-item")
            ?.addEventListener("command", () => {
              if (
                popup.dataset.activeAppId &&
                access.state.appBrowsers.has(popup.dataset.activeAppId)
              ) {
                this.closeApp(popup.dataset.activeAppId);
              }
            });

          popup
            .querySelector("#zen-apps-sidebar-remove-item")
            ?.addEventListener("command", () => {
              if (popup.dataset.activeAppId)
                this.removeApp(popup.dataset.activeAppId);
            });

          popup
            .querySelector("#zen-apps-sidebar-preload-item")
            ?.addEventListener("command", (e) => {
              if (popup.dataset.activeAppId) {
                const app = access.state.apps.find(
                  (a) => a.id === popup.dataset.activeAppId,
                );
                if (app) {
                  app.preload = !app.preload;
                  this.saveApps();
                  if (app.preload) {
                    e.target.setAttribute("checked", "true");
                  } else {
                    e.target.removeAttribute("checked");
                  }
                }
              }
            });

          popup
            .querySelector("#zen-apps-sidebar-autohide-item")
            ?.addEventListener("command", (e) => {
              const cur =
                Core.getPref(Constants.Apps.PREF_AUTOHIDE, false) === true;
              const next = !cur;
              Core.setPref(Constants.Apps.PREF_AUTOHIDE, next);
              if (next) e.target.setAttribute("checked", "true");
              else e.target.removeAttribute("checked");
              this.updateAutohideState();
              this.renderGrid();
            });

          popup
            .querySelector("#zen-apps-sidebar-settings-item")
            ?.addEventListener("command", () => {
              if (window.Zentral?.Settings) window.Zentral.Settings.open();
              else if (window.ZentralSettingsInstance)
                window.ZentralSettingsInstance.open();
            });
        },
        handleTabContextMenuCommand() {
          const tab =
            typeof TabContextMenu !== "undefined" && TabContextMenu.contextTab
              ? TabContextMenu.contextTab
              : gBrowser.selectedTab;
          if (!tab) return;
          const url = tab.linkedBrowser?.currentURI?.spec || "about:blank";
          const title = tab.label || url;
          const icon =
            (typeof gBrowser.getIcon === "function"
              ? gBrowser.getIcon(tab)
              : null) ||
            tab.getAttribute("image") ||
            tab.image ||
            "";
          if (url !== "about:blank") this.addApp(url, title, icon);
        },

        // Responsibility: ZentralAppsShortcuts
        handleOutsideClick(e) {
          if (
            !access.state.activeAppId ||
            access.state.isPinned ||
            access.state.isInstaPeeking
          ) {
            return;
          }

          const path = e.composedPath ? e.composedPath() : [];
          if (
            path.some(
              (el) =>
                el.id === "zen-app-panel-root" ||
                el.id === "zen-apps-sidebar-grid" ||
                el.id === "zentral-apps-vertical-bar" ||
                (el.classList && el.classList.contains("zen-app-tile")),
            )
          )
            return;
          if (
            path.some(
              (el) =>
                el.id === "navigator-toolbox" ||
                el.id === "sidebar-box" ||
                el.id === "PersonalToolbar" ||
                el.id === "nav-bar",
            )
          )
            return;
          if (
            path.some(
              (el) =>
                (el.id && el.id.includes("sine")) ||
                (el.className &&
                  typeof el.className === "string" &&
                  el.className.includes("sine")),
            )
          )
            return;
          if (
            e.target.closest &&
            (e.target.closest("#zen-app-panel-root") ||
              e.target.closest("#zen-apps-sidebar-grid") ||
              e.target.closest("#zentral-apps-vertical-bar") ||
              e.target.closest(".zen-app-tile"))
          )
            return;
          if (
            e.target.closest &&
            (e.target.closest("#navigator-toolbox") ||
              e.target.closest("#sidebar-box") ||
              e.target.closest("#PersonalToolbar") ||
              e.target.closest("#nav-bar"))
          )
            return;
          if (
            e.target.closest &&
            (e.target.closest("[id*='sine']") ||
              e.target.closest("[class*='sine']"))
          )
            return;

          Core.log(
            "ZentralApps",
            "handleOutsideClick closing panel due to click target:",
            e.target?.tagName,
            e.target?.id,
            e.target?.className,
          );
          this.closePanel();
        },
        isShortcutMatch(e, shortcutStr) {
          if (!shortcutStr || shortcutStr === "None") return false;
          const parts = shortcutStr.split("+").map((p) => p.trim());
          if (parts.length === 0) return false;

          const primaryKey = parts[parts.length - 1].toUpperCase();
          const needsCtrl = parts.includes("Ctrl");
          const needsAlt = parts.includes("Alt");
          const needsShift = parts.includes("Shift");
          const needsMeta =
            parts.includes("Meta") ||
            parts.includes("Cmd") ||
            parts.includes("Win");

          if (e.ctrlKey !== needsCtrl) return false;
          if (e.altKey !== needsAlt) return false;
          if (e.shiftKey !== needsShift) return false;
          if (e.metaKey !== needsMeta) return false;

          const eventKey = (e.key || "").toUpperCase();
          const eventCode = (e.code || "").toUpperCase();

          if (primaryKey === "SPACE") {
            return (
              eventKey === " " ||
              eventKey === "SPACEBAR" ||
              eventCode === "SPACE"
            );
          }

          if (
            eventKey === primaryKey ||
            eventCode === "KEY" + primaryKey ||
            eventCode === primaryKey
          ) {
            return true;
          }

          return false;
        },
        handleInstaPeekKeyDown(e) {
          const shortcut = Core.getPref(
            Constants.Apps.PREF_INSTA_PEEK_SHORTCUT,
            "Alt+Q",
          );
          if (!shortcut || shortcut === "None") return;

          if (
            !access.state.activeAppId ||
            !access.dom.root?.hasAttribute("open")
          )
            return;

          if (this.isShortcutMatch(e, shortcut)) {
            e.preventDefault();
            e.stopPropagation();

            if (!access.state.isInstaPeeking) {
              access.state.isInstaPeeking = true;
              if (access.dom.root) {
                access.dom.root.setAttribute("data-insta-peek", "true");
                document.documentElement.setAttribute(
                  "zentral-insta-peek",
                  "true",
                );
              }
            }
          }
        },
        handleInstaPeekKeyUp(e) {
          if (!access.state.isInstaPeeking) return;

          const shortcut = Core.getPref(
            Constants.Apps.PREF_INSTA_PEEK_SHORTCUT,
            "Alt+Q",
          );
          if (!shortcut || shortcut === "None") {
            this.endInstaPeek();
            return;
          }

          const parts = shortcut.split("+").map((p) => p.trim());
          const primaryKey = parts[parts.length - 1].toUpperCase();
          const needsCtrl = parts.includes("Ctrl");
          const needsAlt = parts.includes("Alt");
          const needsShift = parts.includes("Shift");
          const needsMeta =
            parts.includes("Meta") ||
            parts.includes("Cmd") ||
            parts.includes("Win");

          const eventKey = (e.key || "").toUpperCase();
          const eventCode = (e.code || "").toUpperCase();

          const isPrimaryKeyReleased =
            (primaryKey === "SPACE" &&
              (eventKey === " " ||
                eventKey === "SPACEBAR" ||
                eventCode === "SPACE")) ||
            eventKey === primaryKey ||
            eventCode === "KEY" + primaryKey ||
            eventCode === primaryKey;

          const isModifierReleased =
            (needsCtrl && (e.key === "Control" || !e.ctrlKey)) ||
            (needsAlt && (e.key === "Alt" || !e.altKey)) ||
            (needsShift && (e.key === "Shift" || !e.shiftKey)) ||
            (needsMeta && (e.key === "Meta" || !e.metaKey));

          if (isPrimaryKeyReleased || isModifierReleased) {
            this.endInstaPeek();
          }
        },
        handleInstaPeekBlur() {
          if (access.state.isInstaPeeking) {
            this.endInstaPeek();
          }
        },
        endInstaPeek() {
          if (access.state.isInstaPeeking) {
            access.state.isInstaPeeking = false;
            if (access.dom.root) {
              access.dom.root.removeAttribute("data-insta-peek");
              document.documentElement.removeAttribute("zentral-insta-peek");
            }
          }
        },
      };
    },
  );
})();
