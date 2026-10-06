/*
 * ZENTRAL FILE GUIDE - features/apps/controllers/ZentralPanelLifecycle.js
 *
 * Purpose: Owns base app browser creation/reuse, preload sequencing, unload/remove/refresh, panel
 *   open/close and pin/expand presentation and view restoration.
 * Interaction / execution: Installed by ZentralApps constructor. Calls Notifications for event-driven
 *   badges and Position for geometry; Launcher supplies DOM. ZentralPanels wraps these methods for extended
 *   hosts, input, audio and secondary views.
 * Ownership / failure: Closing retains loaded browsers and notification listeners; unloading removes an app
 *   browser. Preserve the closing/input shutdown and notifications policy. Native host-tab ownership
 *   belongs to ZentralBrowserIntegrations.
 * Registration: apps/ZentralPanelLifecycle
 * Loaded/created by: features/apps/ZentralApps.uc.js
 * Returned factory API: capturePanelViewState; closeApp; closePanel; getOrCreateAppBrowser;
 *   isAppPreloadEnabled; isPanelOpen; openPanel; preloadAppsSequence; refreshApp; removeApp;
 *   restorePanelViewState; scheduleAutomaticPreloads; toggleExpand; togglePin
 * Live owner accessors/callbacks: createSVG; dom; getEasingBezier; state
 * Cross-file calls / ctx suppliers: features/apps/controllers/ZentralAppModel.js -> saveApps;
 *   features/apps/controllers/ZentralAppNotifications.js -> ensureBadgeSyncLoop, stopBadgeSyncLoop, syncAllAppBadges;
 *   features/apps/controllers/ZentralAppsInteractions.js -> endInstaPeek; features/apps/controllers/ZentralAppsLauncher.js -> renderGrid,
 *   setAutohideHovered, updateVerticalBarBounds; features/apps/controllers/ZentralLibraryCompatibility.js ->
 *   closeLibraryForPanel; features/apps/controllers/ZentralPanelPosition.js -> getAppsBarPanelMaxWidth,
 *   isCollapsedLayoutMode, isPanelAttachedToRight, isPlacementVerticalBar, loadWidth, positionPanel,
 *   startPositionTracking, stopPositionTracking, updateWidthVar
 * Contract fields assigned here: access.dom.expandBtn.title; access.dom.panel.style.transform;
 *   access.dom.panel.style.transition; access.dom.pinBtn.title; access.dom.root.style.pointerEvents;
 *   access.state.activeAppId; access.state.closeTimerId; access.state.isExpanded; access.state.isPinned;
 *   access.state.panelWidthPx; access.state.preExpandWidth
 * Literal DOM event subscriptions: DOMTitleChanged; load; pageshow; pagetitlechanged
 *
 * Closing dependency: ZentralPanelPosition.onStopDrag restores width-drag input before closePanel proceeds.
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "apps/ZentralPanelLifecycle",
    function ({ Services, shared, runtime, access }) {
      const {
        Constants,
        Core,
        createSVGElement,
        SVG_STRINGS,
        WELL_KNOWN_SERVICES,
      } = shared;
      return {
        // Responsibility: ZentralPanelHost
        getOrCreateAppBrowser(app) {
          let b = access.state.appBrowsers.get(app.id);
          if (b && b.isConnected) return { browser: b, isNew: false };

          b = document.createXULElement("browser");
          b.setAttribute("type", "content");
          b.setAttribute("remote", "true");
          b.setAttribute("maychangeremoteness", "true");
          b.setAttribute("nodefaultsrc", "true");
          b.setAttribute("messagemanagergroup", "browsers");
          b.setAttribute("usercontextid", "0");
          b.setAttribute("context", "contentAreaContextMenu");
          b.setAttribute("flex", "1");
          b.style.cssText =
            "width: 100%; height: 100%; flex: 1; border: none; overflow: hidden;";

          const checkAndUpdateBadge = () => this.syncAllAppBadges(app.id);

          b.addEventListener("pagetitlechanged", checkAndUpdateBadge);
          b.addEventListener("DOMTitleChanged", checkAndUpdateBadge);
          b.addEventListener("load", checkAndUpdateBadge);
          b.addEventListener("pageshow", checkAndUpdateBadge);

          if (typeof b._zentralMoveTo === "function")
            b._zentralMoveTo(access.dom.panel);
          else access.dom.panel.appendChild(b);
          access.state.appBrowsers.set(app.id, b);
          const matchingTiles = Array.from(
            document.querySelectorAll(".zen-app-tile[data-app-id]"),
          ).filter((tile) => tile.dataset.appId === app.id);
          matchingTiles.forEach((t) => (t.dataset.loaded = "true"));
          this.ensureBadgeSyncLoop();
          return { browser: b, isNew: true };
        },
        async preloadAppsSequence() {
          if (!Core.getPref(Constants.Apps.PREF_ENABLED, true)) return;
          const preloadedApps = access.state.apps.filter(
            (a) => a.preload === true,
          );
          for (const app of preloadedApps) {
            if (
              this._destroyed ||
              !Core.getPref(Constants.Apps.PREF_ENABLED, true)
            )
              break;
            if (!access.state.apps.includes(app) || !app.preload) continue;
            const { browser, isNew } = this.getOrCreateAppBrowser(app);
            if (isNew) {
              // Preloading must never make an unselected browser look active.
              browser.style.display = "none";
              try {
                browser.docShellIsActive = true;
                if (browser.isRemoteBrowser) browser.renderLayers = false;
              } catch (_) {}
              try {
                const uri = Services.io.newURI(app.url);
                if (typeof browser.fixupAndLoadURIString === "function") {
                  browser.fixupAndLoadURIString(app.url, {
                    triggeringPrincipal:
                      Services.scriptSecurityManager.createContentPrincipal(
                        uri,
                        {},
                      ),
                  });
                } else {
                  browser.loadURI(uri, {
                    triggeringPrincipal:
                      Services.scriptSecurityManager.createContentPrincipal(
                        uri,
                        {},
                      ),
                  });
                }
              } catch (e) {
                console.error("[ZentralApps] Preload failed:", e);
              }
            }
            // Stagger preloads by 1.5 seconds to minimize main thread blocking
            await new Promise((r) => setTimeout(r, 1500));
          }
          if (
            !this._destroyed &&
            access.state.appBrowsers &&
            access.state.appBrowsers.size > 0
          ) {
            this.ensureBadgeSyncLoop();
          }
        },
        scheduleAutomaticPreloads() {
          if (this._preloadTimer) clearTimeout(this._preloadTimer);
          this._preloadTimer = setTimeout(
            () => {
              this._preloadTimer = null;
              if (!this._destroyed) this.preloadAppsSequence();
            },
            Core.getPref("zen.workspace.bgalazka.smart_sleep", true)
              ? 5000
              : 2000,
          );
        },
        isAppPreloadEnabled(id) {
          return (
            !!Core.getPref(Constants.Apps.PREF_ENABLED, true) &&
            access.state.apps.some(
              (app) => app.id === id && app.preload === true,
            )
          );
        },
        closeApp(appId) {
          if (!appId) return;
          if (access.state.activeAppId === appId) {
            this.closePanel();
          }
          const browser = access.state.appBrowsers.get(appId);
          if (browser) {
            try {
              if (browser.webNavigation) {
                browser.webNavigation.stop(Ci.nsIWebNavigation.STOP_ALL);
              }
            } catch (_) {}
            browser.remove();
            access.state.appBrowsers.delete(appId);
          }
          if (
            !access.state.appBrowsers ||
            access.state.appBrowsers.size === 0
          ) {
            this.stopBadgeSyncLoop();
          }
          const tiles = Array.from(
            document.querySelectorAll(".zen-app-tile[data-app-id]"),
          ).filter((tile) => tile.dataset.appId === appId);
          tiles.forEach((tile) => {
            tile.dataset.loaded = "false";
            tile.querySelector(".zen-app-badge")?.remove();
          });
          const app = access.state.apps.find((a) => a.id === appId);
          if (app) {
            app.notificationCount = 0;
            app.hasNotification = false;
          }
        },
        removeApp(id) {
          const idx = access.state.apps.findIndex((app) => app.id === id);
          if (idx === -1) return;
          access.state.apps.splice(idx, 1);
          this.saveApps();

          if (access.state.activeAppId === id) this.closePanel();

          const b = access.state.appBrowsers.get(id);
          if (b && b.isConnected) b.parentNode.removeChild(b);
          access.state.appBrowsers.delete(id);
          if (
            !access.state.appBrowsers ||
            access.state.appBrowsers.size === 0
          ) {
            this.stopBadgeSyncLoop();
          }

          this.renderGrid();
        },
        refreshApp(appId) {
          if (!appId) return;
          const app = access.state.apps.find((a) => a.id === appId);
          if (!app) return;

          const isPanelOpen =
            access.dom.root?.hasAttribute("open") &&
            access.state.activeAppId === appId;
          const existingBrowser = access.state.appBrowsers.get(appId);

          if (existingBrowser && existingBrowser.isConnected) {
            try {
              if (typeof existingBrowser.reload === "function") {
                existingBrowser.reload();
              } else if (
                existingBrowser.webNavigation &&
                typeof existingBrowser.webNavigation.reload === "function"
              ) {
                existingBrowser.webNavigation.reload(
                  Ci.nsIWebNavigation.LOAD_FLAGS_NONE,
                );
              } else if (
                typeof existingBrowser.fixupAndLoadURIString === "function"
              ) {
                const uri = Services.io.newURI(app.url);
                existingBrowser.fixupAndLoadURIString(app.url, {
                  triggeringPrincipal:
                    Services.scriptSecurityManager.createContentPrincipal(
                      uri,
                      {},
                    ),
                });
              } else if (existingBrowser.loadURI) {
                const uri = Services.io.newURI(app.url);
                existingBrowser.loadURI(uri, {
                  triggeringPrincipal:
                    Services.scriptSecurityManager.createContentPrincipal(
                      uri,
                      {},
                    ),
                });
              }
            } catch (e) {
              console.error("[ZentralApps] Failed to reload app:", appId, e);
            }

            if (!isPanelOpen) {
              existingBrowser.style.display = "none";
            }
          } else {
            const { browser, isNew } = this.getOrCreateAppBrowser(app);
            if (!isPanelOpen) {
              browser.style.display = "none";
            }
            if (isNew) {
              try {
                const uri = Services.io.newURI(app.url);
                if (typeof browser.fixupAndLoadURIString === "function") {
                  browser.fixupAndLoadURIString(app.url, {
                    triggeringPrincipal:
                      Services.scriptSecurityManager.createContentPrincipal(
                        uri,
                        {},
                      ),
                  });
                } else {
                  browser.loadURI(uri, {
                    triggeringPrincipal:
                      Services.scriptSecurityManager.createContentPrincipal(
                        uri,
                        {},
                      ),
                  });
                }
              } catch (e) {
                console.error(
                  "[ZentralApps] Failed to load app in background:",
                  appId,
                  e,
                );
              }
            }
          }
        },

        // Responsibility: ZentralPanelPresentation
        openPanel(app) {
          if (!Core.getPref(Constants.Apps.PREF_ENABLED, true)) return;
          this.closeLibraryForPanel();
          Core.log(
            "ZentralApps",
            "openPanel called for app:",
            app.id,
            "URL:",
            app.url,
          );
          if (access.state.closeTimerId) {
            clearTimeout(access.state.closeTimerId);
            access.state.closeTimerId = null;
          }
          if (access.dom.root) {
            access.dom.root.style.pointerEvents = "";
          }
          access.state.activeAppId = app.id;
          // Pin synchronously, before the open animation or outside-click
          // listener can run. Startup and every launcher use this same path.
          access.state.isPinned =
            Core.getPref("zen.workspace.bgalazka.hover_reveal_panel", false) ===
            true;
          access.state.isExpanded = false;
          document.documentElement.setAttribute(
            "zentral-app-panel-open",
            "true",
          );
          this.setAutohideHovered(true);
          access.state.preExpandWidth = null;
          if (access.dom.pinBtn) {
            access.dom.pinBtn.setAttribute(
              "data-pinned",
              access.state.isPinned ? "true" : "false",
            );
            access.dom.pinBtn.title = access.state.isPinned
              ? "Unpin panel"
              : "Pin panel";
          }
          if (access.dom.expandBtn) {
            access.dom.expandBtn.title = "Expand panel";
            access.dom.expandBtn.replaceChildren(
              access.createSVG(SVG_STRINGS.EXPAND),
            );
          }

          const tiles = document.querySelectorAll(".zen-app-tile[data-app-id]");
          tiles.forEach(
            (tile) =>
              (tile.dataset.active =
                tile.dataset.appId === app.id ? "true" : "false"),
          );

          const targetWidth =
            Number.isFinite(app.width) && app.width > 0
              ? app.width
              : this.loadWidth();
          this.updateWidthVar(
            Math.max(
              Constants.Apps.MIN_WIDTH_PX,
              Math.min(window.innerWidth * 0.8, targetWidth),
            ),
          );
          this.positionPanel();
          this.updateVerticalBarBounds();
          this.startPositionTracking();

          // Establish the visible host and animation origin before attaching
          // or navigating a browser. A cold start previously constructed it
          // under a display:none root and only opened the host after loadURI.
          const isTopSlide =
            this.isCollapsedLayoutMode() && !this.isPlacementVerticalBar();
          const isFromRight = this.isPanelAttachedToRight();
          const slideFrom = isTopSlide
            ? "translateY(-100%)"
            : isFromRight
              ? "translateX(100%)"
              : "translateX(-100%)";
          access.dom.panel.style.transition = "none";
          access.dom.panel.style.transform = slideFrom;
          if (access.dom.root) {
            access.dom.root.removeAttribute("closing");
            access.dom.root.setAttribute("open", "true");
          }

          const { browser, isNew } = this.getOrCreateAppBrowser(app);

          for (const [id, b] of access.state.appBrowsers.entries()) {
            if (b && b.isConnected)
              b.style.display = id === app.id ? "" : "none";
          }

          if (isNew) {
            try {
              const uri = Services.io.newURI(app.url);
              if (typeof browser.fixupAndLoadURIString === "function") {
                browser.fixupAndLoadURIString(app.url, {
                  triggeringPrincipal:
                    Services.scriptSecurityManager.createContentPrincipal(
                      uri,
                      {},
                    ),
                });
              } else {
                browser.loadURI(uri, {
                  triggeringPrincipal:
                    Services.scriptSecurityManager.createContentPrincipal(
                      uri,
                      {},
                    ),
                });
              }
            } catch (e) {
              console.error("[ZentralApps] Failed to load URL:", e);
            }
          }

          access.dom.panel.getBoundingClientRect(); // Reflow

          if (this._openPanelRAF) cancelAnimationFrame(this._openPanelRAF);
          this._openPanelRAF = requestAnimationFrame(() => {
            this._openPanelRAF = null;
            if (this._destroyed || !access.dom.panel) return;
            const slideMs = Core.getPref(Constants.Apps.PREF_ANIMATION_SPEED);
            const animType = Core.getPref(Constants.Apps.PREF_ANIMATION_TYPE);
            const bezier = access.getEasingBezier(animType);

            if (animType === "none") {
              access.dom.panel.style.transition = "none";
            } else {
              access.dom.panel.style.transition = `transform ${slideMs}ms ${bezier}`;
            }
            access.dom.panel.style.transform = isTopSlide
              ? "translateY(0)"
              : "translateX(0)";
          });
        },
        closePanel() {
          this.onStopDrag();
          Core.log("ZentralApps", "closePanel called");
          if (access.dom.root?.hasAttribute("closing")) return;
          if (
            !access.state.activeAppId &&
            !access.dom.root?.hasAttribute("open")
          )
            return;

          if (this._openPanelRAF) {
            cancelAnimationFrame(this._openPanelRAF);
            this._openPanelRAF = null;
          }

          if (access.state.closeTimerId) {
            clearTimeout(access.state.closeTimerId);
            access.state.closeTimerId = null;
          }

          if (access.dom.root) {
            access.dom.root.setAttribute("closing", "true");
            access.dom.root.style.pointerEvents = "none";
            if (access.dom.root.contains(document.activeElement))
              gBrowser.selectedBrowser?.focus();
          }
          this.stopPositionTracking();

          this.endInstaPeek();

          if (access.state.isExpanded) {
            access.state.isExpanded = false;
            if (access.state.preExpandWidth) {
              access.state.panelWidthPx = access.state.preExpandWidth;
            }
          }
          access.state.activeAppId = null;
          access.state.isPinned = false;
          document.documentElement.removeAttribute("zentral-app-panel-open");
          if (access.dom.grid && !access.dom.grid.matches(":hover")) {
            this.setAutohideHovered(false);
          }

          const tiles = document.querySelectorAll(".zen-app-tile[data-app-id]");
          tiles.forEach((tile) => (tile.dataset.active = "false"));

          const isTopSlide =
            this.isCollapsedLayoutMode() && !this.isPlacementVerticalBar();
          const isToRight = this.isPanelAttachedToRight();
          const slideTo = isTopSlide
            ? "translateY(-100%)"
            : isToRight
              ? "translateX(100%)"
              : "translateX(-100%)";

          const slideMs = Core.getPref(Constants.Apps.PREF_ANIMATION_SPEED);
          const animType = Core.getPref(Constants.Apps.PREF_ANIMATION_TYPE);
          const bezier = access.getEasingBezier(animType);

          if (animType === "none" || slideMs <= 0) {
            access.dom.panel.style.transition = "none";
            access.dom.panel.style.transform = slideTo;
            if (access.dom.root) {
              access.dom.root.removeAttribute("open");
              access.dom.root.removeAttribute("closing");
              access.dom.root.style.pointerEvents = "";
            }
            this.stopPositionTracking();
            return;
          }

          access.dom.panel.style.transition = `transform ${slideMs}ms ${bezier}`;
          access.dom.panel.style.transform = slideTo;

          access.state.closeTimerId = setTimeout(() => {
            access.state.closeTimerId = null;
            if (access.dom.root) {
              access.dom.root.removeAttribute("open");
              access.dom.root.removeAttribute("closing");
              access.dom.root.style.pointerEvents = "";
            }
            this.stopPositionTracking();
          }, slideMs + 20);
        },
        isPanelOpen() {
          // activeAppId selects the app; root[open] stays until the close animation
          // ends. The documentElement attribute follows activeAppId for CSS.
          return !!(
            access.state.activeAppId !== null ||
            access.dom.root?.hasAttribute("open") ||
            document.getElementById("zen-app-panel-root")?.hasAttribute("open")
          );
        },
        capturePanelViewState() {
          return {
            open:
              !!access.dom.root?.hasAttribute("open") &&
              !access.dom.root?.hasAttribute("closing"),
            pinned: access.state.isPinned,
            expanded: access.state.isExpanded,
            width: access.state.panelWidthPx,
            preExpandWidth: access.state.preExpandWidth,
          };
        },
        restorePanelViewState(view) {
          if (!view?.open) return;
          access.state.isExpanded = !!view.expanded;
          access.state.preExpandWidth = view.preExpandWidth;
          if (Number.isFinite(view.width) && view.width > 0)
            this.updateWidthVar(view.width);
          if (access.state.isPinned !== !!view.pinned) this.togglePin();
          if (access.dom.expandBtn) {
            access.dom.expandBtn.title = view.expanded
              ? "Restore panel"
              : "Expand panel";
            access.dom.expandBtn.replaceChildren(
              access.createSVG(
                view.expanded ? SVG_STRINGS.COLLAPSE : SVG_STRINGS.EXPAND,
              ),
            );
          }
          this.positionPanel();
        },
        togglePin() {
          access.state.isPinned = !access.state.isPinned;
          Core.log(
            "ZentralApps",
            "togglePin - isPinned:",
            access.state.isPinned,
          );
          if (access.dom.pinBtn) {
            access.dom.pinBtn.setAttribute(
              "data-pinned",
              access.state.isPinned ? "true" : "false",
            );
            access.dom.pinBtn.title = access.state.isPinned
              ? "Unpin panel"
              : "Pin panel";
          }
        },
        toggleExpand() {
          Core.log(
            "ZentralApps",
            "toggleExpand - current isExpanded:",
            access.state.isExpanded,
          );
          if (!access.state.isExpanded) {
            access.state.preExpandWidth =
              access.state.panelWidthPx || this.loadWidth();

            const gap = 12;
            let fullWidth = window.innerWidth - gap * 2;
            if (this.isPlacementVerticalBar()) {
              fullWidth = this.getAppsBarPanelMaxWidth();
            } else if (gBrowser?.tabContainer) {
              const tcRect = gBrowser.tabContainer.getBoundingClientRect();
              if (this.isPanelAttachedToRight()) {
                const targetRight = Math.max(
                  gap,
                  Math.round(window.innerWidth - tcRect.left) + gap,
                );
                fullWidth = window.innerWidth - targetRight - gap;
              } else {
                const targetLeft = Math.max(
                  gap,
                  Math.round(tcRect.right) + gap,
                );
                fullWidth = window.innerWidth - targetLeft - gap;
              }
            }
            if (!this.isPlacementVerticalBar())
              fullWidth = Math.max(Constants.Apps.MIN_WIDTH_PX, fullWidth);

            access.state.isExpanded = true;
            this.updateWidthVar(fullWidth);

            if (access.dom.expandBtn) {
              access.dom.expandBtn.title = "Restore panel";
              access.dom.expandBtn.replaceChildren(
                access.createSVG(SVG_STRINGS.COLLAPSE),
              );
            }
          } else {
            const restoreW = access.state.preExpandWidth || this.loadWidth();
            access.state.isExpanded = false;
            this.updateWidthVar(restoreW);

            if (access.dom.expandBtn) {
              access.dom.expandBtn.title = "Expand panel";
              access.dom.expandBtn.replaceChildren(
                access.createSVG(SVG_STRINGS.EXPAND),
              );
            }
          }
        },
      };
    },
  );
})();
