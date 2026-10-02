(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime;
  ZentralRuntime.register({
    id: "apps",
    init({ shared, runtime }) {
      const {
        Constants,
        Core,
        createSVGElement,
        SVG_STRINGS,
        WELL_KNOWN_SERVICES,
      } = shared;
      class ZentralApps {
        /** @private Side attribute MutationObserver */
        #sideObserver = null;
        /** @private Toolbox & theme mutation observer */
        #toolboxThemeObserver = null;
        /** @private Pref observer callback */
        #layoutObserver = null;
        /** @private ResizeObserver on sidebar */
        #resizeObs = null;
        /** @private ResizeObserver on the Apps grid */
        #gridResizeObs = null;
        /** @private Keeps the pill hover target as tall as the pill. */
        #pillHoverZoneResizeObs = null;
        /** @private TabSelect event listener */
        #tabSelectListener = null;
        /** @private Workspace switch event listener */
        #workspaceSwitchListener = null;
        /** @private Toolbar background observer */
        #toolbarBgObserver = null;
        #toolbarBgListeners = [];
        #tabContextMenu = null;
        #tabContextPopupHandler = null;

        /**
         * Module tear down for Sine hot unloading
         */
        destroy() {
          try {
            Core.log("ZentralApps", "Destroying Apps module...");

            // 1. Clear timers and animation frames
            if (this.#state.repositionTimer) {
              clearTimeout(this.#state.repositionTimer);
              this.#state.repositionTimer = null;
            }
            if (this.#state.closeTimerId) {
              clearTimeout(this.#state.closeTimerId);
              this.#state.closeTimerId = null;
            }
            if (this.#state.positionRafId) {
              cancelAnimationFrame(this.#state.positionRafId);
              this.#state.positionRafId = null;
            }
            if (this.#state.autohideRevealTimer) {
              clearTimeout(this.#state.autohideRevealTimer);
              this.#state.autohideRevealTimer = null;
            }
            if (this.#state.autohideCollapseTimer) {
              clearTimeout(this.#state.autohideCollapseTimer);
              this.#state.autohideCollapseTimer = null;
            }
            if (this.#state.utilityCollapseTimer) {
              clearTimeout(this.#state.utilityCollapseTimer);
              this.#state.utilityCollapseTimer = null;
            }
            if (this._preloadTimer) {
              clearTimeout(this._preloadTimer);
              this._preloadTimer = null;
            }
            if (this._openPanelRAF) {
              cancelAnimationFrame(this._openPanelRAF);
              this._openPanelRAF = null;
            }
            if (this._renderGridRAF) {
              cancelAnimationFrame(this._renderGridRAF);
              this._renderGridRAF = null;
            }
            this._destroyed = true;
            this.stopPositionTracking();

            // 2. Disconnect observers
            this.#pillHoverZoneResizeObs?.disconnect();
            this.#pillHoverZoneResizeObs = null;
            if (this.#sideObserver) {
              try {
                this.#sideObserver.disconnect();
              } catch (_) {}
              this.#sideObserver = null;
            }
            if (this.#toolboxThemeObserver) {
              try {
                this.#toolboxThemeObserver.disconnect();
              } catch (_) {}
              this.#toolboxThemeObserver = null;
            }
            if (this.#resizeObs) {
              try {
                this.#resizeObs.disconnect();
              } catch (_) {}
              this.#resizeObs = null;
            }
            if (this.#gridResizeObs) {
              try {
                this.#gridResizeObs.disconnect();
              } catch (_) {}
              this.#gridResizeObs = null;
            }
            if (this.#layoutObserver) {
              try {
                Services.prefs.removeObserver(
                  "zen.view.use-single-toolbar",
                  this.#layoutObserver,
                );
              } catch (_) {}
              try {
                Services.prefs.removeObserver(
                  "zen.view.sidebar-expanded",
                  this.#layoutObserver,
                );
              } catch (_) {}
              this.#layoutObserver = null;
            }

            // 3. Remove window / document event listeners
            window.removeEventListener("mousedown", this.handleOutsideClick);
            window.removeEventListener(
              "keydown",
              this.handleInstaPeekKeyDown,
              true,
            );
            window.removeEventListener(
              "keyup",
              this.handleInstaPeekKeyUp,
              true,
            );
            window.removeEventListener("blur", this.handleInstaPeekBlur);
            if (this.#tabSelectListener) {
              window.removeEventListener("TabSelect", this.#tabSelectListener);
              this.#tabSelectListener = null;
            }
            if (this.#workspaceSwitchListener) {
              window.removeEventListener(
                "zen-workspace-switched",
                this.#workspaceSwitchListener,
              );
              window.removeEventListener(
                "zen-workspace-changed",
                this.#workspaceSwitchListener,
              );
              window.removeEventListener(
                "zen-workspaces-change",
                this.#workspaceSwitchListener,
              );
              this.#workspaceSwitchListener = null;
            }
            if (this.#toolbarBgObserver) {
              try {
                this.#toolbarBgObserver.disconnect();
              } catch (_) {}
              this.#toolbarBgObserver = null;
            }
            for (const [el, type, listener] of this.#toolbarBgListeners)
              el.removeEventListener(type, listener);
            this.#toolbarBgListeners = [];
            if (this.#tabContextMenu && this.#tabContextPopupHandler)
              this.#tabContextMenu.removeEventListener(
                "popupshowing",
                this.#tabContextPopupHandler,
              );
            this.#tabContextMenu = null;
            this.#tabContextPopupHandler = null;
            document.removeEventListener("mousemove", this.onDrag);
            document.removeEventListener("mouseup", this.onStopDrag);
            if (this._autohideMouseMoveHandler) {
              window.removeEventListener(
                "mousemove",
                this._autohideMouseMoveHandler,
              );
              this._autohideMouseMoveHandler = null;
            }
            if (this._refreshGridRectListener) {
              window.removeEventListener(
                "resize",
                this._refreshGridRectListener,
              );
              this._refreshGridRectListener = null;
            }
            if (this._autohideBlurListener) {
              window.removeEventListener("blur", this._autohideBlurListener);
              this._autohideBlurListener = null;
            }

            // 4. Remove injected DOM elements
            const idsToRemove = [
              "zen-apps-sidebar-grid",
              "zen-apps-sidebar-styles",
              "zentral-apps-utility-section",
              "zen-app-panel-root",
              "zen-apps-autohide-trigger",
              "zen-apps-sidebar-tile-context",
              "zentral-apps-vertical-bar",
              "zentral-apps-vertical-bar-footer",
              "zentral-apps-vertical-bar-trigger",
              "context_zenAppsSidebarAdd_sep",
              "context_zenAppsSidebarAdd",
            ];
            idsToRemove.forEach((id) => {
              const el = document.getElementById(id);
              if (el) el.remove();
            });

            // 5. Clean up floating panels and browser frames
            document
              .querySelectorAll(
                ".zs-app-panel, .zen-app-floating-panel, #zen-app-panel-root, #zentral-apps-vertical-bar, #zentral-apps-vertical-bar-trigger, #zentral-apps-vertical-bar-footer, #zentral-apps-utility-section",
              )
              .forEach((p) => p.remove());
            if (this.#state && this.#state.appBrowsers) {
              this.#state.appBrowsers.forEach((b) => {
                if (b && b.remove) b.remove();
              });
              this.#state.appBrowsers.clear();
            }
            // CRIT-01: Remove event-driven badge sync handlers
            if (this._badgeSyncHandler) {
              window.removeEventListener("TabSelect", this._badgeSyncHandler);
              window.removeEventListener(
                "TabAttrModified",
                this._badgeSyncHandler,
              );
              this._badgeSyncHandler = null;
            }
            this._badgeSyncInitialized = false;
            this.stopBadgeSyncLoop();
            // HIGH-04: Cancel any pending debounced theme sync timer
            if (this._syncThemeTimer) {
              clearTimeout(this._syncThemeTimer);
              this._syncThemeTimer = null;
            }

            // 6. Reset DOM references and state
            this.#dom = {
              grid: null,
              scrollBox: null,
              autohideDots: null,
              utilitySection: null,
              utilityDots: null,
              utilityDotsVertical: null,
              utilityContent: null,
              utilityRow: null,
              utilityDivider: null,
              utilitySettingsBtn: null,
              utilityAutohideBtn: null,
              verticalBar: null,
              verticalBarTrigger: null,
              vbFooter: null,
              vbAutohideBtn: null,
              vbSettingsBtn: null,
              root: null,
              clip: null,
              panel: null,
              pill: null,
              pinBtn: null,
              expandBtn: null,
              refreshBtn: null,
            };
            this._stylesInjected = false;
            document.documentElement.removeAttribute("zentral-app-panel-open");
            document.documentElement.removeAttribute(
              "zentral-apps-has-visible-apps",
            );
            delete window.ZenApps;
          } catch (e) {
            console.error("[Zentral] Apps destroy error:", e);
          }
        }

        /**
         * 3.1 State Initialization & Internal Properties
         * @private
         */
        #state = {
          apps: [],
          utilitySlots: ["autohide", null, null, "settings"],
          activeAppId: null,
          isPinned: false,
          isExpanded: false,
          preExpandWidth: null,
          panelWidthPx: 0,
          appBrowsers: new Map(),
          positionRafId: null,
          closeTimerId: null,
          cachedScrollbarWidth: null,
          repositionTimer: null,
          utilityCollapseTimer: null,
          autohideCollapseTimer: null,
          autohideRevealTimer: null,
          isInstaPeeking: false,
        };

        /**
         * DOM element references cached for high-performance access
         * @private
         */
        #dom = {
          grid: null,
          scrollBox: null,
          autohideDots: null,
          utilitySection: null,
          utilityDots: null,
          utilityDotsVertical: null,
          utilityContent: null,
          utilityRow: null,
          utilityDivider: null,
          utilitySettingsBtn: null,
          utilityAutohideBtn: null,
          verticalBar: null,
          verticalBarTrigger: null,
          vbFooter: null,
          vbAutohideBtn: null,
          vbSettingsBtn: null,
          root: null,
          clip: null,
          panel: null,
          pill: null,
          pinBtn: null,
          expandBtn: null,
          refreshBtn: null,
        };

        /**
         * Constructs the ZentralApps instance and binds event handlers.
         */
        constructor() {
          // Binding methods to maintain 'this' context across event callbacks
          this.handleTabContextMenuCommand =
            this.handleTabContextMenuCommand.bind(this);
          this.handleOutsideClick = this.handleOutsideClick.bind(this);
          this.handleInstaPeekKeyDown = this.handleInstaPeekKeyDown.bind(this);
          this.handleInstaPeekKeyUp = this.handleInstaPeekKeyUp.bind(this);
          this.handleInstaPeekBlur = this.handleInstaPeekBlur.bind(this);
          this.toggleExpand = this.toggleExpand.bind(this);
          this.startResize = this.startResize.bind(this);
          this.onDrag = this.onDrag.bind(this);
          this.onStopDrag = this.onStopDrag.bind(this);
          this.repositionGrid = this.repositionGrid.bind(this);
        }

        /**
         * Calculates the CSS cubic-bezier easing string for panel slide animations.
         * @private
         * @param {string} animType - Selected animation preset name (e.g. 'spring-gentle', 'elastic').
         * @returns {string} The cubic-bezier function string.
         */
        #getEasingBezier(animType) {
          switch (animType) {
            case "spring-gentle":
              return "cubic-bezier(0.175, 0.885, 0.32, 1.275)";
            case "spring-bouncy":
              return "cubic-bezier(0.68, -0.55, 0.265, 1.55)";
            case "spring-snappy":
              return "cubic-bezier(0.34, 1.56, 0.64, 1)";
            case "elastic":
              return "cubic-bezier(0.5, 2.5, 0.4, 0.8)";
            default:
              return "cubic-bezier(0.22, 1, 0.36, 1)";
          }
        }

        /**
         * Initializes the Apps Module UI, preferences, event observers, and preloading timers.
         */
        init() {
          if (!Core.getPref(Constants.Apps.PREF_ENABLED)) {
            Core.log("ZentralApps", "Apps Grid feature is disabled.");
            return;
          }
          this._destroyed = false;
          this.injectStyles();
          this.createContainers();
          this.applyHideUtilitySectionPref();
          this.loadApps();
          this.loadUtilityOrder();
          this.renderGrid();
          this.setupContextMenu();
          this.setupObservers();

          // Expose legacy/debug global helper
          window.ZenApps = {
            addApp: this.addApp.bind(this),
            removeApp: this.removeApp.bind(this),
          };

          Core.emit("appsInitComplete", this);

          // Preload apps sequentially after browser startup
          this._preloadTimer = setTimeout(() => {
            this._preloadTimer = null;
            if (!this._destroyed) this.preloadAppsSequence();
          }, 2000);
        }

        /**
         * Loads configured web app objects from user preferences.
         */
        loadApps() {
          this.#state.apps = [];
          try {
            const str = Core.getPref(Constants.Apps.PREF_APPS);
            const parsed = JSON.parse(str);
            if (Array.isArray(parsed)) {
              const seen = new Set();
              this.#state.apps = parsed
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
        }

        /**
         * Serializes and saves the active apps list to user preferences.
         */
        saveApps() {
          try {
            const clean = this.#state.apps.map(
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
        }

        /**
         * Loads the preferred display slot positions for the Apps Grid Utility Section buttons.
         */
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
              this.#state.utilitySlots = slots;
              return;
            }
          } catch (e) {
            console.warn("[ZentralApps] Failed to load utility order pref:", e);
          }
          const defaultSlots = new Array(slotCount).fill(null);
          defaultSlots[0] = "autohide";
          defaultSlots[3] = "settings";
          this.#state.utilitySlots = defaultSlots;
        }

        /**
         * Persists the preferred display slot positions for the Apps Grid Utility Section buttons.
         */
        saveUtilityOrder() {
          try {
            Core.setPref(
              Constants.Apps.PREF_UTILITY_ORDER,
              JSON.stringify(this.#state.utilitySlots),
            );
          } catch (e) {
            console.warn("[ZentralApps] Failed to save utility order pref:", e);
          }
        }

        /**
         * Sequentially preloads browser background instances for apps configured with preload enabled.
         * Uses staggered delays to prevent startup performance hits.
         */
        async preloadAppsSequence() {
          const preloadedApps = Core.getPref(
            "zen.workspace.bgalazka.smart_sleep",
            false,
          )
            ? []
            : this.#state.apps.filter((a) => a.preload === true);
          for (const app of preloadedApps) {
            if (
              this._destroyed ||
              Core.getPref("zen.workspace.bgalazka.smart_sleep", false)
            )
              break;
            if (!this.#state.apps.includes(app) || !app.preload) continue;
            const { browser, isNew } = this.getOrCreateAppBrowser(app);
            if (isNew) {
              // Preloading must never make an unselected browser look active.
              browser.style.display = "none";
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
            this.#state.appBrowsers &&
            this.#state.appBrowsers.size > 0
          ) {
            this.ensureBadgeSyncLoop();
          }
        }

        /**
         * Retrieves stored panel width or calculates fallback based on window proportion.
         * @returns {number} Panel width in pixels.
         */
        loadWidth() {
          let width = Core.getPref(Constants.Apps.PREF_WIDTH);
          return Math.max(
            Constants.Apps.MIN_WIDTH_PX,
            width || window.innerWidth * 0.333,
          );
        }

        /**
         * Persists custom panel width for active app object.
         * @param {number} px - Panel width in pixels.
         */
        saveWidth(px) {
          if (this.#state.activeAppId) {
            const app = this.#state.apps.find(
              (a) => a.id === this.#state.activeAppId,
            );
            if (app) app.width = px;
            this.saveApps();
          }
        }

        /* --------------------------------------------------------------------------
         * 3.3 Layout & Sidebar Position Detection
         * --------------------------------------------------------------------------
         */

        /**
         * Determines whether the sidebar is positioned on the right side of the browser window.
         * @returns {boolean} True if sidebar is on the right side.
         */
        isSidebarRight() {
          // 1. Direct Zen root attributes
          if (
            document.documentElement.getAttribute("zen-right-side") === "true"
          )
            return true;
          if (
            document.documentElement.getAttribute("zen-sidebar-right") ===
            "true"
          )
            return true;
          if (
            document.documentElement.getAttribute("zen-right-side") === "false"
          )
            return false;
          if (
            document.documentElement.getAttribute("zen-sidebar-right") ===
            "false"
          )
            return false;

          // 2. Physical DOM measurement of the sidebar container
          const sidebarBox =
            document.getElementById("sidebar-box") ||
            document.getElementById("sidebar-container") ||
            document.getElementById("vertical-tabs");
          if (sidebarBox && sidebarBox.isConnected) {
            const rect = sidebarBox.getBoundingClientRect();
            if (rect.width > 0) {
              return rect.left + rect.width / 2 > window.innerWidth / 2;
            }
          }

          // 3. Fallback preferences
          if (Core.getNativePref("zen.tabs.vertical.right-side", false))
            return true;
          if (Core.getNativePref("zen.view.sidebar-right", false)) return true;
          if (Core.getNativePref("zen.view.sidebar-on-right", false))
            return true;

          return false;
        }

        /**
         * Determines whether the Apps grid is configured to be placed in the opposite Vertical Bar.
         * @returns {boolean} True if apps placement is set to 'vertical-bar'.
         */
        isPlacementVerticalBar() {
          return (
            Core.getPref(Constants.Apps.PREF_PLACEMENT, "sidebar") ===
            "vertical-bar"
          );
        }

        /**
         * Determines whether the opposite Vertical Bar is on the right side of the screen.
         * (Attached to the screen edge opposite to the native Zen sidebar).
         * @returns {boolean} True if the Vertical Bar is on the right.
         */
        isVerticalBarOnRight() {
          return !this.isSidebarRight();
        }

        /**
         * Determines whether the active floating app panel should attach to and slide from the right.
         * @returns {boolean} True if panel attaches to the right edge.
         */
        isPanelAttachedToRight() {
          if (this.isPlacementVerticalBar()) {
            return this.isVerticalBarOnRight();
          }
          return this.isSidebarRight();
        }

        /**
         * Determines whether the Zen sidebar is currently collapsed.
         * @returns {boolean} True if sidebar is collapsed.
         */
        isCollapsedSidebar() {
          // Fully delegate to the single authoritative collapse-detection method.
          // Previously this method duplicated zen-sidebar-collapsed + sidebar-expanded pref reads
          // that isPhysicallySidebarCollapsed() already handles — removed duplication (Q-05).
          return this.isPhysicallySidebarCollapsed();
        }

        /**
         * Determines whether Zen Browser is using the "Collapsed Sidebar" layout mode (horizontal apps bar in top toolbar).
         * This includes:
         *   - sidebar-expanded pref false (traditional collapsed layout)
         *   - Compact Mode active (sidebar-expanded=true but physically collapsed/thin)
         *   - zen-sidebar-collapsed DOM attribute set
         * @returns {boolean} True if in Collapsed Sidebar layout mode.
         */
        isCollapsedLayoutMode() {
          if (this.#dom.grid?.classList.contains("zen-apps-horizontal"))
            return true;
          if (this.isPhysicallySidebarCollapsed()) return true;
          const useSingleToolbar = Core.getNativePref(
            "zen.view.use-single-toolbar",
            true,
          );
          const sidebarExpanded = Core.getNativePref(
            "zen.view.sidebar-expanded",
            true,
          );
          return !useSingleToolbar && !sidebarExpanded;
        }

        /**
         * Checks physical sidebar state via DOM attributes and pixel width.
         * Handles both Collapsed Sidebar mode and Compact Mode (sidebar-expanded=true but visually thin/hidden).
         * @returns {boolean} True if the sidebar is physically not expanded.
         */
        isPhysicallySidebarCollapsed() {
          // DOM attribute set by Zen in Collapsed Sidebar mode
          const collapsedAttr = document.documentElement.getAttribute(
            "zen-sidebar-collapsed",
          );
          if (collapsedAttr === "true") return true;

          // Compact mode: sidebar is visually collapsed but pref says expanded.
          // Detect by measuring physical width of the tab/sidebar container.
          const sidebarBox =
            document.getElementById("tabbrowser-tabbox") ||
            document.getElementById("sidebar-box") ||
            document.getElementById("sidebar-container") ||
            gBrowser?.tabContainer;
          if (sidebarBox) {
            const rect = sidebarBox.getBoundingClientRect();
            // Sidebar is considered collapsed if its width is narrower than COLLAPSED_WIDTH_THRESHOLD
            const T = Constants.Apps.COLLAPSED_WIDTH_THRESHOLD;
            if (rect.width > 0 && rect.width < T) return true;
            if (rect.width === 0) return true;
          }

          // Also check via single-toolbar indicator
          const useSingleToolbar = Core.getNativePref(
            "zen.view.use-single-toolbar",
            true,
          );
          if (useSingleToolbar) return false; // Single toolbar = expanded layout

          const sidebarExpanded = Core.getNativePref(
            "zen.view.sidebar-expanded",
            true,
          );
          if (!sidebarExpanded) return true;

          return false;
        }

        /* --------------------------------------------------------------------------
         * 3.2 CSS Style Injection (Constructable Stylesheets)
         * --------------------------------------------------------------------------
         */

        /**
         * Injects CSS styling for grid, tiles, badges, floating panel slider, and pills.
         */
        injectStyles() {
          if (
            document.getElementById("zen-apps-sidebar-styles") ||
            this._stylesInjected
          )
            return;
          this._stylesInjected = true;
          const css = `
        /* Morphing Autohide Apps Grid */
        #zen-apps-sidebar-grid .zen-apps-autohide-dots {
          display: none;
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) scale(1);
          align-items: center;
          justify-content: center;
          gap: 4px;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.20s ease, transform 0.24s cubic-bezier(0.25, 1, 0.5, 1);
          z-index: 5;
        }
        #zen-apps-sidebar-grid .zen-apps-autohide-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background-color: currentColor;
          opacity: 0.65;
          transition: transform 0.2s ease, opacity 0.2s ease;
        }
        #zen-apps-sidebar-grid:hover .zen-apps-autohide-dot {
          opacity: 1;
        }

        /* When Autohide is active in expanded vertical sidebar */
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal) {
          min-height: 22px;
          max-height: 22px;
          padding: 0 10px !important;
          cursor: pointer;
          overflow: hidden !important;
          border-radius: var(--toolbarbutton-border-radius, 6px);
          position: relative !important;
          background-color: transparent;
          will-change: max-height, padding, background-color;
          transition: max-height 0.24s cubic-bezier(0.25, 1, 0.5, 1),
                      padding 0.24s cubic-bezier(0.25, 1, 0.5, 1),
                      background-color 0.18s ease !important;
        }

        /* Scrollbox grid layout in Vertical Sidebar */
        :root:not([zentral-apps-placement="vertical-bar"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal) .zen-apps-scroll-box {
          display: grid !important;
          grid-template-columns: repeat(var(--zentral-grid-cols, 7), minmax(0, 1fr)) !important;
          justify-items: center !important;
          align-items: center !important;
          gap: 6px !important;
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
          max-height: calc(var(--zentral-max-rows, 3) * 42px - 2px) !important;
          overflow-y: auto !important;
          scrollbar-width: none !important;
          margin: 0 !important;
          padding: 4px 2px !important;
        }
        #zen-apps-sidebar-grid:not(.zen-apps-horizontal) .zen-apps-scroll-box::-webkit-scrollbar {
          display: none !important;
        }

        /* Collapsed Strip State: Show 3 dots, hide all inner tiles and utility with Vertical Bar transition */
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):not([data-revealed="true"]):not(:hover):not([zentral-app-panel-open="true"]) {
          background: transparent;
        }
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):not([data-revealed="true"]):not(:hover):not([zentral-app-panel-open="true"]) .zen-apps-autohide-dots {
          display: flex !important;
          opacity: 0.75;
          transform: translate(-50%, -50%);
          transition: opacity 0.20s ease, transform 0.24s cubic-bezier(0.25, 1, 0.5, 1);
        }
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):not([data-revealed="true"]):not(:hover):not([zentral-app-panel-open="true"]):hover .zen-apps-autohide-dots {
          opacity: 1;
        }
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):not([data-revealed="true"]):not(:hover):not([zentral-app-panel-open="true"]) #zentral-apps-utility-section,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):not([data-revealed="true"]):not(:hover):not([zentral-app-panel-open="true"]) .zen-app-tile,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):not([data-revealed="true"]):not(:hover):not([zentral-app-panel-open="true"]) .zen-app-add-btn {
          opacity: 0 !important;
          pointer-events: none !important;
          visibility: hidden !important;
          transition: opacity 0.20s ease, visibility 0.24s ease !important;
        }
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):not([data-revealed="true"]):not(:hover):not([zentral-app-panel-open="true"]) #zentral-apps-utility-section {
          max-height: 0 !important;
          overflow: hidden !important;
        }

        /* Expanded Grid State: Hide 3 dots, reveal the solid single-piece grid with exact dimensions */
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal)[data-revealed="true"],
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):hover,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"])[zentral-app-panel-open="true"] #zen-apps-sidebar-grid:not(.zen-apps-horizontal) {
          max-height: calc(var(--zentral-apps-grid-expanded-height, 180px) + 8px) !important;
          padding: 6px 10px !important;
          margin: 0 !important;
          overflow: visible !important;
        }
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal)[data-revealed="true"] .zen-apps-autohide-dots,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):hover .zen-apps-autohide-dots,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"])[zentral-app-panel-open="true"] #zen-apps-sidebar-grid:not(.zen-apps-horizontal) .zen-apps-autohide-dots {
          opacity: 0 !important;
          transform: translate(-50%, -50%) scale(0.8) !important;
          pointer-events: none !important;
          transition: opacity 0.18s ease, transform 0.24s cubic-bezier(0.25, 1, 0.5, 1) !important;
        }
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]):not([zentral-apps-hide-utility="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal)[data-revealed="true"] #zentral-apps-utility-section,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]):not([zentral-apps-hide-utility="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):hover #zentral-apps-utility-section,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]):not([zentral-apps-hide-utility="true"])[zentral-app-panel-open="true"] #zen-apps-sidebar-grid:not(.zen-apps-horizontal) #zentral-apps-utility-section {
          display: flex !important;
          opacity: 1 !important;
          max-height: 40px !important;
          pointer-events: auto !important;
          visibility: visible !important;
          overflow: visible !important;
          transition: opacity 0.20s ease, visibility 0.24s ease !important;
        }
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal)[data-revealed="true"] .zen-app-tile,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):hover .zen-app-tile,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"])[zentral-app-panel-open="true"] #zen-apps-sidebar-grid:not(.zen-apps-horizontal) .zen-app-tile,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal)[data-revealed="true"] .zen-app-add-btn,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):hover .zen-app-add-btn,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"])[zentral-app-panel-open="true"] #zen-apps-sidebar-grid:not(.zen-apps-horizontal) .zen-app-add-btn {
          display: flex !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          visibility: visible !important;
          transition: opacity 0.20s ease, visibility 0.24s ease !important;
        }

        /* Scoped to expanded / revealed state only in autohide */
        :root[zentral-apps-autohide="true"]:not([zentral-apps-hide-utility="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal)[data-revealed="true"] .zentral-apps-utility-content,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-hide-utility="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):hover .zentral-apps-utility-content,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-hide-utility="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal)[zentral-app-panel-open="true"] .zentral-apps-utility-content {
          max-height: 38px !important;
          opacity: 1 !important;
          transform: none !important;
          pointer-events: auto !important;
          visibility: visible !important;
          overflow: visible !important;
          margin-bottom: 2px !important;
        }
        :root[zentral-apps-autohide="true"]:not([zentral-apps-hide-utility="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal)[data-revealed="true"] .zentral-apps-utility-divider,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-hide-utility="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):hover .zentral-apps-utility-divider,
        :root[zentral-apps-autohide="true"]:not([zentral-apps-hide-utility="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal)[zentral-app-panel-open="true"] .zentral-apps-utility-divider {
          display: block !important;
          opacity: 0.5 !important;
          transform: none !important;
        }
        :root[zentral-apps-autohide="true"] #zen-apps-sidebar-grid:not(.zen-apps-horizontal) .zentral-apps-utility-dots {
          display: none !important;
        }

        /* ==========================================================================
         * Zentral Apps Utility Section
         * ========================================================================== */
        #zentral-apps-utility-section {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          width: 100% !important;
          box-sizing: border-box !important;
          position: relative !important;
          margin: 0 0 2px 0 !important;
          padding: 0 !important;
          z-index: 12 !important;
          user-select: none !important;
          grid-column: 1 / -1 !important;
        }

        /* 3 Horizontal Dots Trigger Strip (Vertical Sidebar mode) */
        .zentral-apps-utility-dots {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3.5px;
          width: 100%;
          height: 8px;
          min-height: 8px;
          cursor: pointer;
          opacity: 0.65;
          transition: opacity 0.18s ease;
          padding: 0;
          margin: 0;
          box-sizing: border-box;
          order: 0;
        }

        .zentral-apps-utility-dots:hover {
          opacity: 1;
        }

        .zentral-apps-utility-dot {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background-color: currentColor;
          opacity: 0.75;
        }

        /* Vertical 3 dots trigger (for Horizontal Toolbar mode) */
        .zentral-apps-utility-dots-vertical {
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3.5px;
          width: 10px;
          height: 28px;
          cursor: pointer;
          opacity: 0.65;
          transition: opacity 0.2s ease;
          padding: 0 2px;
          box-sizing: border-box;
          flex-shrink: 0;
          order: 0;
        }

        .zentral-apps-utility-dots-vertical:hover {
          opacity: 1;
        }

        .zentral-apps-utility-dots-vertical:hover .zentral-apps-utility-dot {
          opacity: 1;
          transform: scale(1.2);
        }

        /* Utility Content Row & Single-Piece Slide Transition */
        .zentral-apps-utility-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          max-height: 0;
          opacity: 0;
          overflow: hidden;
          pointer-events: none;
          transform: translateY(-8px);
          order: 1;
          will-change: max-height, opacity, transform;
          transition: max-height 0.24s cubic-bezier(0.25, 1, 0.5, 1),
                      opacity 0.20s ease,
                      transform 0.24s cubic-bezier(0.25, 1, 0.5, 1),
                      visibility 0.24s ease;
        }

        .zentral-apps-utility-row {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          justify-items: center;
          align-items: center;
          width: 100%;
          padding: 0;
          margin: 0;
          box-sizing: border-box;
        }

        /* Utility Slot (Grid Column Cell) */
        .zentral-utility-slot {
          width: 100%;
          height: 28px;
          min-height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          box-sizing: border-box;
          border-radius: var(--toolbarbutton-border-radius, 6px);
          transition: background-color 0.15s ease;
        }

        .zentral-utility-slot.zentral-utility-slot-dragover {
          background-color: color-mix(in srgb, var(--zen-primary-color, currentColor) 20%, transparent);
          outline: 1px dashed var(--zen-primary-color, currentColor);
          outline-offset: -1px;
        }

        /* 28px Buttons */
        .zentral-utility-btn {
          width: 28px !important;
          height: 28px !important;
          min-width: 28px !important;
          min-height: 28px !important;
          max-width: 28px !important;
          max-height: 28px !important;
          padding: 0 !important;
          border-radius: var(--toolbarbutton-border-radius, 6px) !important;
          background-color: transparent !important;
          border: none !important;
          box-shadow: none !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          cursor: pointer !important;
          color: inherit !important;
          opacity: 0.85 !important;
          flex-shrink: 0 !important;
          transition: background-color 0.15s ease, opacity 0.15s ease, transform 0.15s ease !important;
        }

        .zentral-utility-btn:hover {
          background-color: var(--toolbarbutton-hover-background, color-mix(in srgb, currentColor 14%, transparent)) !important;
          opacity: 1 !important;
        }

        .zentral-utility-btn:active {
          transform: scale(0.94) !important;
        }

        .zentral-utility-btn svg {
          width: 16px !important;
          height: 16px !important;
          pointer-events: none !important;
        }

        /* Morphing Divider Line (Lighter color) */
        .zentral-apps-utility-divider {
          width: calc(100% - 16px);
          height: 1px;
          background-color: color-mix(in srgb, currentColor 12%, transparent);
          margin: 2px auto 3px auto;
          pointer-events: none;
          order: 2;
        }

        /* When Hidden in Autohide OFF: Divider takes 0 space */
        :root:not([zentral-apps-autohide="true"]) #zentral-apps-utility-section:not([data-utility-revealed="true"]) .zentral-apps-utility-divider {
          display: none !important;
          height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        /* When Revealed (Autohide OFF): Dots disappear, Content slides down as a single piece */
        #zentral-apps-utility-section[data-utility-revealed="true"] .zentral-apps-utility-dots {
          display: none !important;
        }

        #zentral-apps-utility-section[data-utility-revealed="true"] .zentral-apps-utility-content {
          max-height: 38px !important;
          opacity: 1 !important;
          transform: translateY(0) !important;
          pointer-events: auto !important;
          visibility: visible !important;
          overflow: visible !important;
          margin-bottom: 2px !important;
        }

        #zentral-apps-utility-section[data-utility-revealed="true"] .zentral-apps-utility-divider {
          display: block !important;
          opacity: 0.5 !important;
        }

        /* While grid is collapsed in autohide, utility section is hidden with the grid */
        :root[zentral-apps-autohide="true"]:not([zentral-apps-placement="vertical-bar"]):not([zentral-sidebar-collapsed="true"]):not([zen-sidebar-collapsed="true"]) #zen-apps-sidebar-grid:not(.zen-apps-horizontal):not([data-revealed="true"]):not(:hover):not([zentral-app-panel-open="true"]) #zentral-apps-utility-section {
          opacity: 0 !important;
          pointer-events: none !important;
          max-height: 0 !important;
          overflow: hidden !important;
        }

        /* Eye open/closed visibility for utility autohide button */
        :root[zentral-apps-autohide="true"] #zentral-utility-autohide-btn .zs-eye-open {
          display: none !important;
        }
        :root[zentral-apps-autohide="true"] #zentral-utility-autohide-btn .zs-eye-closed {
          display: block !important;
        }
        :root:not([zentral-apps-autohide="true"]) #zentral-utility-autohide-btn .zs-eye-open {
          display: block !important;
        }
        :root:not([zentral-apps-autohide="true"]) #zentral-utility-autohide-btn .zs-eye-closed {
          display: none !important;
        }

        /* Horizontal Toolbar Mode Styling */
        .zen-apps-horizontal #zentral-apps-utility-section {
          flex-direction: row !important;
          align-items: center !important;
          width: auto !important;
          height: 100% !important;
          margin: 0 0 0 2px !important;
          grid-column: auto !important;
          flex-shrink: 0 !important;
        }

        .zen-apps-horizontal #zentral-apps-utility-section .zentral-apps-utility-dots {
          display: none !important;
        }

        .zen-apps-horizontal #zentral-apps-utility-section .zentral-apps-utility-dots-vertical {
          display: flex !important;
          order: 0 !important;
        }

        .zen-apps-horizontal #zentral-apps-utility-section .zentral-apps-utility-divider {
          width: 1px !important;
          height: 16px !important;
          margin: 0 4px 0 2px !important;
          background-color: color-mix(in srgb, currentColor 12%, transparent) !important;
          opacity: 0 !important;
          transform: scaleY(0) !important;
          transform-origin: center !important;
          order: 1 !important;
        }

        .zen-apps-horizontal #zentral-apps-utility-section .zentral-apps-utility-content {
          order: 2 !important;
          flex-direction: row !important;
          max-height: 100% !important;
          max-width: 0 !important;
          width: auto !important;
          transform: translateX(-4px) !important;
          transition: max-width 0.24s cubic-bezier(0.25, 1, 0.5, 1),
                      opacity 0.2s ease,
                      transform 0.22s cubic-bezier(0.25, 1, 0.5, 1) !important;
        }

        .zen-apps-horizontal #zentral-apps-utility-section .zentral-apps-utility-row {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          padding: 0 !important;
          width: auto !important;
          gap: 4px !important;
        }

        .zen-apps-horizontal #zentral-apps-utility-section .zentral-utility-slot {
          width: auto !important;
          height: auto !important;
          min-height: 0 !important;
        }

        .zen-apps-horizontal #zentral-apps-utility-section[data-utility-revealed="true"] .zentral-apps-utility-dots-vertical {
          display: none !important;
        }

        .zen-apps-horizontal #zentral-apps-utility-section[data-utility-revealed="true"] .zentral-apps-utility-divider {
          opacity: 0.5 !important;
          transform: scaleY(1) !important;
        }

        .zen-apps-horizontal #zentral-apps-utility-section[data-utility-revealed="true"] .zentral-apps-utility-content {
          max-width: 36px !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          transform: translateX(0) !important;
        }

        .zen-apps-horizontal #zentral-utility-autohide-btn {
          display: none !important;
        }

        /* Hide Utility Section in Vertical Bar placement mode (VB uses its footer) */
        :root[zentral-apps-placement="vertical-bar"] #zentral-apps-utility-section {
          display: none !important;
        }

        /* Permanently hide Utility Section when preference is enabled */
        :root[zentral-apps-hide-utility="true"] #zentral-apps-utility-section,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid #zentral-apps-utility-section,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid:hover #zentral-apps-utility-section,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid[data-revealed="true"] #zentral-apps-utility-section,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid[zentral-app-panel-open="true"] #zentral-apps-utility-section,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid .zentral-apps-utility-content,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid:hover .zentral-apps-utility-content,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid[data-revealed="true"] .zentral-apps-utility-content,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid[zentral-app-panel-open="true"] .zentral-apps-utility-content,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid .zentral-utility-btn,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid .zentral-apps-utility-dots,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid .zentral-apps-utility-dots-vertical,
        :root[zentral-apps-hide-utility="true"] #zen-apps-sidebar-grid .zentral-apps-utility-divider,
        #zentral-apps-utility-section[data-permanently-hidden="true"],
        #zen-apps-sidebar-grid #zentral-apps-utility-section[data-permanently-hidden="true"],
        #zen-apps-sidebar-grid:hover #zentral-apps-utility-section[data-permanently-hidden="true"] {
          display: none !important;
          max-height: 0 !important;
          height: 0 !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
          overflow: hidden !important;
        }

        #zen-apps-sidebar-grid { display: flex; flex-direction: column; align-items: center; padding: 4px 10px 0px 10px; margin: 0; width: 100%; box-sizing: border-box; position: relative; z-index: 10; overflow: visible; }
        #zen-apps-sidebar-grid::-webkit-scrollbar { display: none; }
        .zen-apps-scroll-box { display: grid; grid-template-columns: repeat(var(--zentral-grid-cols, 7), minmax(0, 1fr)); justify-items: center; align-items: center; gap: 6px; width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; max-height: calc(var(--zentral-max-rows, 3) * 42px - 2px); overflow-y: auto; scrollbar-width: none; margin: 0; padding: 0; }
        .zen-apps-scroll-box::-webkit-scrollbar { display: none; }
        #zen-apps-sidebar-grid.zen-apps-horizontal { display: flex; flex-direction: row; padding: 0 2px; gap: 2px; width: auto; align-items: center; -moz-window-dragging: no; position: relative; flex-shrink: 1 !important; min-width: 0 !important; margin-left: auto !important; }
        #zen-apps-sidebar-grid.zen-apps-horizontal .zen-apps-scroll-box { display: flex; flex-direction: row; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: none; width: max-content; max-width: calc(10 * 38px + 9 * 4px) !important; scroll-behavior: smooth; -moz-window-dragging: no; flex-shrink: 1 !important; }
        #zen-apps-sidebar-grid.zen-apps-horizontal .zen-apps-scroll-box::-webkit-scrollbar { display: none; }
        #zen-apps-sidebar-grid.zen-apps-horizontal .zen-app-tile { width: 38px !important; min-width: 38px !important; max-width: 38px !important; height: 28px !important; padding: 0 !important; aspect-ratio: auto; border-radius: var(--toolbarbutton-border-radius, 6px); flex-shrink: 0 !important; }
        .zen-app-tile { position: relative; appearance: none; border: none; width: 100%; height: auto; aspect-ratio: 1 / 1; max-width: 36px; max-height: 36px; border-radius: var(--toolbarbutton-border-radius, 8px); background-color: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color 0.15s ease, opacity 0.15s ease, transform 0.1s ease; padding: 0; margin: 0; overflow: visible; -moz-window-dragging: no-drag; pointer-events: auto !important; }
        .zen-app-tile:hover { background-color: var(--toolbarbutton-hover-background, color-mix(in srgb, currentColor 10%, transparent)) !important; }
        .zen-app-tile:active { transform: scale(0.95); }
        .zen-app-tile[data-active="true"] { background-color: color-mix(in srgb, var(--zen-primary-color, #707ac2) 36%, rgba(255, 255, 255, 0.18)) !important; border: 1.5px solid color-mix(in srgb, var(--zen-primary-color, #707ac2) 75%, rgba(255, 255, 255, 0.4)) !important; box-shadow: 0 0 10px color-mix(in srgb, var(--zen-primary-color, #707ac2) 40%, transparent), 0 1px 3px rgba(0, 0, 0, 0.2) !important; }
        .zen-app-tile[data-active="true"] img, .zen-app-tile[data-active="true"] svg { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5)) drop-shadow(0 0 4px color-mix(in srgb, var(--zen-primary-color, #707ac2) 60%, transparent)) !important; }
        .zen-app-tile img, .zen-app-tile svg { width: 18px; height: 18px; object-fit: contain; pointer-events: none; border-radius: 4px; image-rendering: -webkit-optimize-contrast; transition: filter 0.2s ease, opacity 0.2s ease; }
        /* Unloaded App Styling - Desaturated appearance retaining subtle brand tint */
        .zen-app-tile[data-loaded="false"] img, .zen-app-tile[data-loaded="false"] svg,
        .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) img,
        .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) svg {
          filter: saturate(35%) opacity(0.72) !important;
          transition: filter 0.2s ease, opacity 0.2s ease !important;
        }
        .zen-app-tile[data-loaded="false"]:hover img, .zen-app-tile[data-loaded="false"]:hover svg,
        .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover img,
        .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover svg {
          filter: saturate(75%) opacity(0.95) !important;
        }
        /* Loaded App Styling - A tiny bit more saturated than normal */
        .zen-app-tile[data-loaded="true"] img, .zen-app-tile[data-loaded="true"] svg {
          filter: saturate(118%) !important;
          opacity: 1 !important;
          transition: filter 0.2s ease, opacity 0.2s ease !important;
        }
        .zen-app-tile[data-loaded="true"]:hover img, .zen-app-tile[data-loaded="true"]:hover svg {
          filter: saturate(128%) !important;
          opacity: 1 !important;
        }
        #zentral-apps-vertical-bar .zen-app-tile[data-loaded="true"] img,
        #zentral-apps-vertical-bar .zen-app-tile[data-loaded="true"] svg {
          filter: saturate(118%) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)) !important;
          opacity: 1 !important;
          transition: transform 0.15s ease, filter 0.2s ease, opacity 0.2s ease !important;
        }
        #zentral-apps-vertical-bar .zen-app-tile[data-loaded="true"]:hover img,
        #zentral-apps-vertical-bar .zen-app-tile[data-loaded="true"]:hover svg {
          filter: saturate(128%) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5)) !important;
        }
        #zentral-apps-vertical-bar .zen-app-tile[data-loaded="false"] img,
        #zentral-apps-vertical-bar .zen-app-tile[data-loaded="false"] svg,
        #zentral-apps-vertical-bar .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) img,
        #zentral-apps-vertical-bar .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) svg {
          filter: saturate(35%) opacity(0.72) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)) !important;
          transition: transform 0.15s ease, filter 0.2s ease, opacity 0.2s ease !important;
        }
        #zentral-apps-vertical-bar .zen-app-tile[data-loaded="false"]:hover img,
        #zentral-apps-vertical-bar .zen-app-tile[data-loaded="false"]:hover svg,
        #zentral-apps-vertical-bar .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover img,
        #zentral-apps-vertical-bar .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover svg {
          filter: saturate(75%) opacity(0.95) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5)) !important;
        }
        #zentral-apps-vertical-bar .zen-app-add-btn svg {
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)) !important;
          transition: transform 0.15s ease, filter 0.15s ease !important;
        }
        #zentral-apps-vertical-bar .zen-app-add-btn:hover svg {
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5)) !important;
        }
        .zen-app-add-btn { background-color: transparent; border: 1px dashed color-mix(in srgb, currentColor 30%, transparent); opacity: 0.7; flex-shrink: 0 !important; }
        .zen-app-add-btn:hover { opacity: 1; border-style: solid; }
        .zen-app-add-btn svg { width: 16px; height: 16px; pointer-events: none; }
        .zen-app-badge { position: absolute; top: 2px; right: 2px; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px; background-color: #ff3b30; color: #ffffff; font-size: 9px; font-weight: 700; line-height: 14px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.3); pointer-events: none; z-index: 10; box-sizing: border-box; }
        .zen-app-badge[data-dot="true"] { min-width: 8px; width: 8px; height: 8px; padding: 0; border-radius: 50%; top: 3px; right: 3px; font-size: 0; }

        #zen-app-panel-root { position: fixed; display: none; pointer-events: none; overflow: visible; z-index: 2147483600 !important; }
        #zen-app-panel-root[open] { display: block; }
        #zen-app-panel-root[data-insta-peek="true"] { opacity: 0 !important; pointer-events: none !important; visibility: hidden !important; transition: none !important; }
        #zen-app-panel-root:not([open]) #zen-app-panel-slider, #zen-app-panel-root[closing] #zen-app-panel-slider { box-shadow: none !important; }
        #zen-app-panel-clip { position: absolute; inset: 0; overflow: hidden; border-radius: var(--zen-border-radius, 8px); pointer-events: none; }
        #zen-app-panel-slider { position: absolute; inset: 0; display: flex; flex-direction: column; border-radius: inherit; overflow: hidden; background: var(--tabpanels-background-color, #1e1e24); border: 1px solid color-mix(in srgb, var(--zen-primary-color, currentColor) 25%, rgba(255, 255, 255, 0.14)); box-sizing: border-box; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55), 0 2px 10px rgba(0, 0, 0, 0.30); pointer-events: auto; will-change: transform; }
        #zen-app-panel-pill { position: absolute; top: 50%; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 4px; border-radius: 14px; background: var(--zen-colors-tertiary, var(--zen-colors-secondary, var(--zen-primary-color, light-dark(#f4b4b4, #362929)))); color: var(--zen-colors-tertiary-text, light-dark(#18181b, #f4f4f5)); border: 1px solid color-mix(in srgb, currentColor 12%, transparent); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35); z-index: 20; opacity: 0; transition: opacity 0.2s ease 0.3s; pointer-events: none; }
        #zen-app-panel-root:not([open]) #zen-app-panel-pill, #zen-app-panel-root[closing] #zen-app-panel-pill { display: none !important; opacity: 0 !important; pointer-events: none !important; }
        :root[zen-right-side="true"] #zen-app-panel-pill { left: 0; transform: translate(-50%, -50%); }
        :root:not([zen-right-side="true"]) #zen-app-panel-pill { right: 0; transform: translate(50%, -50%); }
        #zen-app-panel-root[data-panel-side="right"] #zen-app-panel-pill { left: 0 !important; right: auto !important; transform: translate(-50%, -50%) !important; }
        #zen-app-panel-root[data-panel-side="left"] #zen-app-panel-pill { right: 0 !important; left: auto !important; transform: translate(50%, -50%) !important; }

        .zen-app-hover-zone { position: absolute; top: 0; bottom: 0; width: 44px; z-index: 10; pointer-events: none; background: transparent; }
        #zen-app-panel-root[open] .zen-app-hover-zone { pointer-events: auto; }
        :root[zen-right-side="true"] .zen-app-hover-zone { left: -22px; right: auto; }
        :root:not([zen-right-side="true"]) .zen-app-hover-zone { right: -22px; left: auto; }
        #zen-app-panel-root[data-panel-side="right"] .zen-app-hover-zone { left: -22px !important; right: auto !important; }
        #zen-app-panel-root[data-panel-side="left"] .zen-app-hover-zone { right: -22px !important; left: auto !important; }

        .zen-app-hover-zone:hover ~ #zen-app-panel-pill, #zen-app-panel-pill:hover, .zen-app-resize-strip:hover ~ #zen-app-panel-pill { opacity: 1; pointer-events: auto; transition-delay: 0s; }
        .zen-app-btn { appearance: none; background: transparent; border: none; border-radius: 8px; color: inherit; padding: 4px; width: 26px; height: 26px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background-color 0.15s ease; }
        .zen-app-btn:hover { background-color: color-mix(in srgb, currentColor 15%, transparent); }
        .zen-app-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; display: block; }
        .zen-app-btn[data-pinned="true"] { background-color: color-mix(in srgb, currentColor 20%, transparent); }
        .zen-app-btn[data-pinned="true"] svg { fill: currentColor; stroke: currentColor; stroke-width: 0.5; }
        .zen-app-refresh-btn svg { transition: transform 0.45s cubic-bezier(0.25, 1, 0.5, 1) !important; }
        .zen-app-refresh-btn:active svg { transform: scale(0.9) !important; }
        .zen-app-refresh-btn.zen-app-refresh-spinning svg { transform: rotate(360deg) !important; }
        .zen-app-close-btn { color: #ff4d4d !important; }
        .zen-app-close-btn:hover { background-color: rgba(255, 77, 77, 0.22) !important; color: #ff6666 !important; }
        .zen-app-close-btn svg { stroke: #ff4d4d !important; stroke-width: 2 !important; }
        .zen-app-close-btn:hover svg { stroke: #ff6666 !important; }
        .zen-app-grabber { cursor: ew-resize; padding: 4px 2px; width: 26px; height: 24px; display: flex; align-items: center; justify-content: center; color: inherit; border-radius: 8px; user-select: none; transition: background-color 0.15s ease; }
        .zen-app-grabber:hover { background-color: color-mix(in srgb, currentColor 15%, transparent); }
        .zen-app-grabber svg { width: 10px; height: 14px; fill: currentColor; stroke: none; display: block; }
        .zen-app-resize-strip { position: absolute; top: 0; bottom: 0; width: 10px; cursor: ew-resize; z-index: 15; background: transparent; pointer-events: none; }
        #zen-app-panel-root[open] .zen-app-resize-strip { pointer-events: auto; }
        :root[zen-right-side="true"] .zen-app-resize-strip { left: -5px; right: auto; }
        :root:not([zen-right-side="true"]) .zen-app-resize-strip { right: -5px; left: auto; }
        #zen-app-panel-root[data-panel-side="right"] .zen-app-resize-strip { left: -5px !important; right: auto !important; }
        #zen-app-panel-root[data-panel-side="left"] .zen-app-resize-strip { right: -5px !important; left: auto !important; }

        /* ==========================================================================
         * Zentral Apps Vertical Bar
         * ========================================================================== */
        #zentral-apps-vertical-bar {
          display: none !important;
        }

        /* Base style */
        :root[zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar {
          min-height: 0 !important;
          max-height: 100% !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          box-sizing: border-box !important;
          color: var(--zen-colors-text, var(--arrowpanel-color, inherit)) !important;
          padding: 8px 0 !important;
          gap: 6px !important;
          overflow: hidden !important;
          user-select: none !important;
          border: none !important;
        }

        :root:not([zentral-apps-placement="vertical-bar"]) .zentral-browser-tool,
        :root[bgalazka-appsbar-library="false"] #zentral-apps-vb-library-btn,
        :root:not([bgalazka-appsbar-history="true"]) #zentral-apps-vb-history-btn,
        :root:not([bgalazka-appsbar-downloads="true"]) #zentral-apps-vb-downloads-btn,
        :root:not([bgalazka-appsbar-bookmarks="true"]) #zentral-apps-vb-bookmarks-btn {
          display: none !important;
        }

        /* Mode A: Autohide DISABLED (Pinned / Docked into Frame) */
        :root[zentral-apps-placement="vertical-bar"]:not([zentral-apps-autohide="true"]) #zentral-apps-vertical-bar {
          position: relative !important;
          width: 36px !important;
          min-width: 36px !important;
          max-width: 36px !important;
          height: calc(100% - var(--zen-element-separation, 6px) * 2) !important;
          max-height: calc(100% - var(--zen-element-separation, 6px) * 2) !important;
          min-height: 0 !important;
          flex: 0 0 36px !important;
          flex-shrink: 0 !important;
          z-index: 10 !important;
          background: transparent !important;
          background-color: transparent !important;
          box-shadow: none !important;
          backdrop-filter: none !important;
          border: none !important;
          border-radius: var(--zen-border-radius, 8px) !important;
          transform: none !important;
          opacity: 1 !important;
          visibility: visible !important;
          box-sizing: border-box !important;
          overflow: visible !important;
          padding: 6px 3px !important;
          margin-top: var(--zen-element-separation, 6px) !important;
          margin-bottom: var(--zen-element-separation, 6px) !important;
          transition: width 0.22s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.18s ease !important;
        }

        /* Outer margin matching Zen's element separation for exact visual symmetry */
        :root[zentral-apps-placement="vertical-bar"]:not([zentral-apps-autohide="true"])[zen-right-side="true"] #zentral-apps-vertical-bar,
        :root[zentral-apps-placement="vertical-bar"]:not([zentral-apps-autohide="true"])[zen-sidebar-right="true"] #zentral-apps-vertical-bar {
          margin-left: var(--zen-element-separation, 6px) !important;
          margin-right: 0 !important;
        }

        :root[zentral-apps-placement="vertical-bar"]:not([zentral-apps-autohide="true"]):not([zen-right-side="true"]):not([zen-sidebar-right="true"]) #zentral-apps-vertical-bar {
          margin-right: var(--zen-element-separation, 6px) !important;
          margin-left: 0 !important;
        }

        :root[zentral-apps-placement="vertical-bar"]:not([zentral-apps-autohide="true"]) #zentral-apps-vertical-bar #zen-apps-sidebar-grid {
          padding: 0 !important;
        }

        /* Mode B: Autohide ENABLED (Compact Floating Panel) */
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar {
          position: fixed !important;
          width: 48px !important;
          min-width: 48px !important;
          max-width: 48px !important;
          z-index: 2147483500 !important;
          background-color: color-mix(in srgb, var(--zen-primary-color, rgb(112, 122, 194)) 14%, var(--zen-colors-base, rgb(19, 19, 19))) !important;
          border-radius: var(--zen-border-radius, 8px) !important;
          box-shadow: var(--zen-big-shadow, rgba(0, 0, 0, 0.24) 0px 3px 8px 0px) !important;
          border: 1px solid color-mix(in srgb, var(--zen-primary-color, rgb(112, 122, 194)) 25%, transparent) !important;
          transition: transform 0.25s cubic-bezier(0.075, 0.82, 0.165, 1), opacity 0.15s ease, visibility 0.25s ease, top 0.18s cubic-bezier(0.25, 1, 0.5, 1), background-color 0.25s ease, border-color 0.25s ease !important;
          will-change: transform, opacity;
          overflow: visible !important;
          padding: 8px 5px !important;
          box-sizing: border-box !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar #zen-apps-sidebar-grid {
          padding: 0 !important;
        }

        /* Zen Theme Wallpaper / Gradient Layer */
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar::before {
          content: "" !important;
          position: absolute !important;
          inset: 0 !important;
          z-index: -2 !important;
          border-radius: inherit !important;
          background-image: var(--zen-theme-gradient-override, radial-gradient(circle at top, color-mix(in srgb, var(--zen-primary-color, transparent) 30%, transparent) 0%, transparent 85%)) !important;
          background-size: 100% 100% !important;
          background-repeat: no-repeat !important;
          background-position: center top !important;
          pointer-events: none !important;
          transition: background-image 0.25s ease !important;
        }

        /* Zen Film Grain Texture Layer */
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar::after {
          content: "" !important;
          position: absolute !important;
          inset: 0 !important;
          z-index: -1 !important;
          border-radius: inherit !important;
          background-image: url("chrome://browser/content/zen-images/grain-bg.png") !important;
          background-repeat: repeat !important;
          opacity: 0.7 !important;
          pointer-events: none !important;
        }

        /* Autohide Mode B: Position on Left (Sidebar on Right) */
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"][zen-right-side="true"] #zentral-apps-vertical-bar,
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"][zen-sidebar-right="true"] #zentral-apps-vertical-bar {
          left: 8px !important;
          right: auto !important;
        }

        /* Autohide Mode B: Position on Right (Sidebar on Left) */
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"]:not([zen-right-side="true"]):not([zen-sidebar-right="true"]) #zentral-apps-vertical-bar {
          right: 8px !important;
          left: auto !important;
        }

        /* Autohide Mode B: Idle/Collapsed State on Left */
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"][zen-right-side="true"] #zentral-apps-vertical-bar:not([data-revealed="true"]):not([zentral-app-panel-open="true"]),
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"][zen-sidebar-right="true"] #zentral-apps-vertical-bar:not([data-revealed="true"]):not([zentral-app-panel-open="true"]) {
          transform: translateX(calc(-100% - 16px)) !important;
          opacity: 0 !important;
          pointer-events: none !important;
          visibility: hidden !important;
        }

        /* Autohide Mode B: Idle/Collapsed State on Right */
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"]:not([zen-right-side="true"]):not([zen-sidebar-right="true"]) #zentral-apps-vertical-bar:not([data-revealed="true"]):not([zentral-app-panel-open="true"]) {
          transform: translateX(calc(100% + 16px)) !important;
          opacity: 0 !important;
          pointer-events: none !important;
          visibility: hidden !important;
        }

        /* Autohide Mode B: Revealed State on Hover / Active Panel */
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar[data-revealed="true"],
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar[zentral-app-panel-open="true"] {
          transform: translateX(0) !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          visibility: visible !important;
        }

        #zen-app-panel-root { position: fixed; display: none; pointer-events: none; overflow: visible; z-index: 2147483600 !important; }
        #zen-app-panel-root[open] { display: block; }

        #zentral-apps-vertical-bar #zen-apps-sidebar-grid {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: flex-start !important;
          width: 100% !important;
          height: 0 !important;
          flex: 1 1 0px !important;
          padding: 0 !important;
          max-height: 100% !important;
          min-height: 0 !important;
          gap: 6px !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
          scrollbar-width: none !important;
          background: transparent !important;
          box-sizing: border-box !important;
        }

        #zentral-apps-vertical-bar #zen-apps-sidebar-grid::-webkit-scrollbar {
          display: none !important;
        }

        #zentral-apps-vertical-bar #zen-apps-sidebar-grid .zen-apps-scroll-box {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          gap: 6px !important;
          width: 100% !important;
          height: auto !important;
          min-height: min-content !important;
          max-height: none !important;
          flex-shrink: 0 !important;
          opacity: 1 !important;
          transform: none !important;
          pointer-events: auto !important;
          visibility: visible !important;
          box-sizing: border-box !important;
          padding: 0 !important;
          margin: 0 !important;
        }

        #zentral-apps-vertical-bar-footer {
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          width: 100% !important;
          flex: 0 0 auto !important;
          flex-shrink: 0 !important;
          gap: 6px !important;
          padding: 4px 0 0 0 !important;
          box-sizing: border-box !important;
          margin-top: auto !important;
          z-index: 10 !important;
        }

        #zentral-apps-vertical-bar .zen-app-tile,
        #zentral-apps-vertical-bar .zen-app-add-btn,
        #zentral-apps-vertical-bar .zen-app-vb-footer-btn {
          width: 36px !important;
          height: 36px !important;
          min-width: 36px !important;
          min-height: 36px !important;
          max-width: 36px !important;
          max-height: 36px !important;
          box-sizing: border-box !important;
          margin: 0 auto !important;
          flex-shrink: 0 !important;
          overflow: visible !important;
        }

        #zentral-apps-vertical-bar .zen-app-vb-footer-btn svg {
          width: 18px !important;
          height: 18px !important;
          pointer-events: none !important;
        }

        :root[zentral-apps-autohide="true"] #zentral-apps-vb-autohide-btn .zs-eye-open {
          display: none !important;
        }
        :root[zentral-apps-autohide="true"] #zentral-apps-vb-autohide-btn .zs-eye-closed {
          display: block !important;
        }
        :root:not([zentral-apps-autohide="true"]) #zentral-apps-vb-autohide-btn .zs-eye-open {
          display: block !important;
        }
        :root:not([zentral-apps-autohide="true"]) #zentral-apps-vb-autohide-btn .zs-eye-closed {
          display: none !important;
        }

        /* Autohide Mode B: Tile Button Enhancements (Scoped ONLY to autohide mode) */
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile {
          width: 36px !important;
          height: 36px !important;
          min-width: 36px !important;
          min-height: 36px !important;
          max-width: 36px !important;
          max-height: 36px !important;
          border-radius: var(--zen-border-radius, 8px) !important;
          background-color: color-mix(in srgb, currentColor 8%, transparent) !important;
          border: none !important;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
          flex-shrink: 0 !important;
          opacity: 1 !important;
          transform: none !important;
          pointer-events: auto !important;
          visibility: visible !important;
          color: inherit !important;
          transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile img,
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile svg {
          width: 18px !important;
          height: 18px !important;
          object-fit: contain !important;
          transition: transform 0.15s ease, filter 0.2s ease, opacity 0.2s ease !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile[data-loaded="true"] img,
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile[data-loaded="true"] svg {
          filter: saturate(118%) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)) !important;
          opacity: 1 !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile[data-loaded="true"]:hover img,
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile[data-loaded="true"]:hover svg {
          filter: saturate(128%) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5)) !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile[data-loaded="false"] img,
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile[data-loaded="false"] svg,
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) img,
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) svg {
          filter: saturate(35%) opacity(0.72) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)) !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile[data-loaded="false"]:hover img,
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile[data-loaded="false"]:hover svg,
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover img,
        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover svg {
          filter: saturate(75%) opacity(0.95) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5)) !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile:hover {
          background-color: var(--toolbarbutton-hover-background, color-mix(in srgb, currentColor 14%, transparent)) !important;
          border: none !important;
          transform: translateY(-1px) scale(1.04) !important;
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2) !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-add-btn svg {
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)) !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-add-btn:hover svg {
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5)) !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile:active {
          transform: scale(0.96) !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile[data-active="true"] {
          background-color: color-mix(in srgb, var(--zen-primary-color, #707ac2) 32%, var(--zen-colors-base, #131313)) !important;
          border: none !important;
          box-shadow: 0 0 0 1px var(--zen-primary-color, #707ac2), 0 2px 8px rgba(0, 0, 0, 0.25) !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-add-btn {
          width: 36px !important;
          height: 36px !important;
          min-width: 36px !important;
          min-height: 36px !important;
          max-width: 36px !important;
          max-height: 36px !important;
          border-radius: var(--zen-border-radius, 8px) !important;
          background-color: color-mix(in srgb, currentColor 8%, transparent) !important;
          border: 1.5px dashed color-mix(in srgb, currentColor 25%, transparent) !important;
          opacity: 0.85 !important;
          transform: none !important;
          pointer-events: auto !important;
          visibility: visible !important;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
          flex-shrink: 0 !important;
          color: inherit !important;
          transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-add-btn:hover {
          opacity: 1 !important;
          border-style: solid !important;
          border-color: var(--zen-primary-color, currentColor) !important;
          background-color: var(--toolbarbutton-hover-background, color-mix(in srgb, currentColor 15%, transparent)) !important;
          transform: translateY(-1px) scale(1.04) !important;
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2) !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-add-btn:active {
          transform: scale(0.96) !important;
        }

        /* Default / Non-autohide Vertical Bar (Clean standard tile styling) */
        :root:not([zentral-apps-autohide="true"])[zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile {
          width: 30px !important;
          height: 30px !important;
          min-width: 30px !important;
          min-height: 30px !important;
          max-width: 30px !important;
          max-height: 30px !important;
          border-radius: var(--zen-border-radius, 6px) !important;
          background-color: transparent !important;
          border: none !important;
          box-shadow: none !important;
          flex-shrink: 0 !important;
          opacity: 1 !important;
          transform: none !important;
          pointer-events: auto !important;
          visibility: visible !important;
          color: inherit !important;
          margin: 0 auto !important;
        }

        :root:not([zentral-apps-autohide="true"])[zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile img,
        :root:not([zentral-apps-autohide="true"])[zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile svg {
          width: 16px !important;
          height: 16px !important;
          object-fit: contain !important;
        }

        :root:not([zentral-apps-autohide="true"])[zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile:hover {
          background-color: var(--toolbarbutton-hover-background, color-mix(in srgb, currentColor 10%, transparent)) !important;
        }

        :root:not([zentral-apps-autohide="true"])[zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-tile[data-active="true"] {
          background-color: var(--toolbarbutton-active-background, color-mix(in srgb, currentColor 15%, transparent)) !important;
        }

        :root:not([zentral-apps-autohide="true"])[zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-add-btn {
          width: 30px !important;
          height: 30px !important;
          min-width: 30px !important;
          min-height: 30px !important;
          max-width: 30px !important;
          max-height: 30px !important;
          border-radius: var(--zen-border-radius, 6px) !important;
          background-color: transparent !important;
          border: 1px dashed color-mix(in srgb, currentColor 30%, transparent) !important;
          opacity: 0.7 !important;
          transform: none !important;
          pointer-events: auto !important;
          visibility: visible !important;
          color: inherit !important;
          margin: 0 auto !important;
          flex-shrink: 0 !important;
          transition: background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease !important;
        }

        :root:not([zentral-apps-autohide="true"])[zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-add-btn:hover {
          opacity: 1 !important;
          border-style: solid !important;
          background-color: var(--toolbarbutton-hover-background, color-mix(in srgb, currentColor 10%, transparent)) !important;
          box-shadow: none !important;
        }

        :root:not([zentral-apps-autohide="true"])[zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-vb-footer-btn {
          width: 30px !important;
          height: 30px !important;
          min-width: 30px !important;
          min-height: 30px !important;
          max-width: 30px !important;
          max-height: 30px !important;
          margin: 0 auto !important;
        }

        :root:not([zentral-apps-autohide="true"])[zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar .zen-app-vb-footer-btn svg {
          width: 15px !important;
          height: 15px !important;
        }

        #zentral-apps-vertical-bar .zen-apps-autohide-dots {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }

        #zentral-apps-vertical-bar-trigger {
          display: none !important;
        }

        :root[zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar-trigger {
          display: block !important;
          position: fixed !important;
          top: 0 !important;
          bottom: 0 !important;
          width: 1px !important;
          z-index: 2147483550 !important;
          pointer-events: auto !important;
          background: transparent !important;
        }

        :root[zentral-apps-placement="vertical-bar"][zen-right-side="true"] #zentral-apps-vertical-bar-trigger,
        :root[zentral-apps-placement="vertical-bar"][zen-sidebar-right="true"] #zentral-apps-vertical-bar-trigger {
          left: 0 !important;
          right: auto !important;
        }

        :root[zentral-apps-placement="vertical-bar"]:not([zen-right-side="true"]):not([zen-sidebar-right="true"]) #zentral-apps-vertical-bar-trigger {
          right: 0 !important;
          left: auto !important;
        }

        /* Autohide Vertical Bar Inner Hover Extension (1/2 width = 24px) */
        .zen-app-vb-hover-zone {
          position: absolute !important;
          top: 0 !important;
          bottom: 0 !important;
          width: 24px !important;
          z-index: 15 !important;
          pointer-events: none;
          background: transparent !important;
        }

        :root[zentral-apps-autohide="true"][zentral-apps-placement="vertical-bar"] #zentral-apps-vertical-bar[data-revealed="true"] .zen-app-vb-hover-zone {
          pointer-events: auto !important;
        }

        :root[zentral-apps-placement="vertical-bar"][zen-right-side="true"] .zen-app-vb-hover-zone,
        :root[zentral-apps-placement="vertical-bar"][zen-sidebar-right="true"] .zen-app-vb-hover-zone {
          right: -24px !important;
          left: auto !important;
        }

        :root[zentral-apps-placement="vertical-bar"]:not([zen-right-side="true"]):not([zen-sidebar-right="true"]) .zen-app-vb-hover-zone {
          left: -24px !important;
          right: auto !important;
        }

        /* ===========================================================================
         * Zentral - Compact Sidebar Mode: Apps & Utility Button Styling & Animations
         * =========================================================================== */
        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile,
        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-add-btn,
        :root[zen-compact-mode="true"] #zentral-apps-utility-section .zentral-utility-btn,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-add-btn,
        :root[zen-sidebar-collapsed="true"] #zentral-apps-utility-section .zentral-utility-btn,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-add-btn,
        :root[zentral-sidebar-collapsed="true"] #zentral-apps-utility-section .zentral-utility-btn {
          border-radius: var(--toolbarbutton-border-radius, 8px) !important;
          background-color: color-mix(in srgb, currentColor 8%, transparent) !important;
          border: none !important;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
          transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease !important;
        }

        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"] img,
        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"] svg,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"] img,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"] svg,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"] img,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"] svg {
          filter: saturate(118%) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)) !important;
          opacity: 1 !important;
          transition: transform 0.15s ease, filter 0.15s ease, opacity 0.15s ease !important;
        }

        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"]:hover img,
        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"]:hover svg,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"]:hover img,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"]:hover svg,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"]:hover img,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile[data-loaded="true"]:hover svg {
          filter: saturate(128%) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5)) !important;
        }

        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) img,
        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) svg,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) img,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) svg,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) img,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn) svg {
          filter: saturate(35%) opacity(0.72) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)) !important;
          transition: transform 0.15s ease, filter 0.15s ease, opacity 0.15s ease !important;
        }

        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover img,
        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover svg,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover img,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover svg,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover img,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:not([data-loaded="true"]):not(.zen-app-add-btn):not(.zen-app-vb-footer-btn):hover svg {
          filter: saturate(75%) opacity(0.95) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5)) !important;
        }

        :root[zen-compact-mode="true"] #zentral-apps-utility-section .zentral-utility-btn svg,
        :root[zen-sidebar-collapsed="true"] #zentral-apps-utility-section .zentral-utility-btn svg,
        :root[zentral-sidebar-collapsed="true"] #zentral-apps-utility-section .zentral-utility-btn svg {
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)) !important;
          transition: transform 0.15s ease, filter 0.15s ease !important;
        }

        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile:hover,
        :root[zen-compact-mode="true"] #zentral-apps-utility-section .zentral-utility-btn:hover,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:hover,
        :root[zen-sidebar-collapsed="true"] #zentral-apps-utility-section .zentral-utility-btn:hover,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:hover,
        :root[zentral-sidebar-collapsed="true"] #zentral-apps-utility-section .zentral-utility-btn:hover {
          background-color: var(--toolbarbutton-hover-background, color-mix(in srgb, currentColor 14%, transparent)) !important;
          transform: translateY(-1px) scale(1.04) !important;
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2) !important;
        }

        :root[zen-compact-mode="true"] #zentral-apps-utility-section .zentral-utility-btn:hover svg,
        :root[zen-sidebar-collapsed="true"] #zentral-apps-utility-section .zentral-utility-btn:hover svg,
        :root[zentral-sidebar-collapsed="true"] #zentral-apps-utility-section .zentral-utility-btn:hover svg,
        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-add-btn:hover svg,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-add-btn:hover svg,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-add-btn:hover svg {
          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5)) !important;
        }

        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile:active,
        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-add-btn:active,
        :root[zen-compact-mode="true"] #zentral-apps-utility-section .zentral-utility-btn:active,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:active,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-add-btn:active,
        :root[zen-sidebar-collapsed="true"] #zentral-apps-utility-section .zentral-utility-btn:active,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile:active,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-add-btn:active,
        :root[zentral-sidebar-collapsed="true"] #zentral-apps-utility-section .zentral-utility-btn:active {
          transform: scale(0.96) !important;
        }

        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-tile[data-active="true"],
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile[data-active="true"],
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-tile[data-active="true"] {
          background-color: color-mix(in srgb, var(--zen-primary-color, #707ac2) 32%, var(--zen-colors-base, #131313)) !important;
          box-shadow: 0 0 0 1px var(--zen-primary-color, #707ac2), 0 2px 8px rgba(0, 0, 0, 0.25) !important;
        }

        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-add-btn,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-add-btn,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-add-btn {
          border: 1.5px dashed color-mix(in srgb, currentColor 25%, transparent) !important;
          opacity: 0.85 !important;
        }

        :root[zen-compact-mode="true"] #zen-apps-sidebar-grid .zen-app-add-btn:hover,
        :root[zen-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-add-btn:hover,
        :root[zentral-sidebar-collapsed="true"] #zen-apps-sidebar-grid .zen-app-add-btn:hover {
          opacity: 1 !important;
          border-style: solid !important;
          border-color: var(--zen-primary-color, currentColor) !important;
          background-color: var(--toolbarbutton-hover-background, color-mix(in srgb, currentColor 15%, transparent)) !important;
          transform: translateY(-1px) scale(1.04) !important;
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2) !important;
        }
      `;
          try {
            const style = document.createElement("style");
            style.id = "zen-apps-sidebar-styles";
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
          } catch (e) {
            console.error("[Zentral] Error injecting sidebar styles:", e);
          }
        }

        /* --------------------------------------------------------------------------
         * 3.4 Grid & Tile Rendering
         * --------------------------------------------------------------------------
         */

        /**
         * Creates an SVG element from a raw markup string using the shared module helper
         * (innerHTML-based, no DOMParser). Kept as a class method for API compatibility.
         * @private
         * @param {string} svgString - Valid SVG markup string.
         * @returns {Element} SVG element.
         */
        #createSVG(svgString) {
          return createSVGElement(svgString);
        }

        /**
         * Updates CSS gradient scroll masks on horizontal apps scroll boxes.
         */
        updateScrollMask() {
          const scrollBox = this.#dom.scrollBox;
          if (!scrollBox) return;

          if (!this.#dom.grid?.classList.contains("zen-apps-horizontal")) {
            scrollBox.style.maskImage = "none";
            scrollBox.style.webkitMaskImage = "none";
            return;
          }

          const isOverflowing =
            scrollBox.scrollWidth > scrollBox.clientWidth + 2;

          const sl = scrollBox.scrollLeft;
          const maxScroll = scrollBox.scrollWidth - scrollBox.clientWidth;

          const hasLeft = isOverflowing && sl > 2;
          const hasRight = isOverflowing && maxScroll - sl > 2;
          const dist = "28px";

          let mask = "none";
          if (hasLeft && hasRight) {
            mask = `linear-gradient(to right, transparent 0px, black ${dist}, black calc(100% - ${dist}), transparent 100%)`;
          } else if (hasLeft) {
            mask = `linear-gradient(to right, transparent 0px, black ${dist}, black 100%)`;
          } else if (hasRight) {
            mask = `linear-gradient(to right, black 0px, black calc(100% - ${dist}), transparent 100%)`;
          }

          scrollBox.style.maskImage = mask;
          scrollBox.style.webkitMaskImage = mask;
        }

        /**
         * Creates and attaches persistent DOM elements for the app grid and panel overlays.
         */
        createContainers() {
          if (!this.#dom.grid) {
            this.#dom.grid = document.createElement("div");
            this.#dom.grid.id = "zen-apps-sidebar-grid";

            const utilitySection = document.createElement("div");
            utilitySection.id = "zentral-apps-utility-section";
            utilitySection.className = "zentral-apps-utility-section";

            const uDots = document.createElement("div");
            uDots.className = "zentral-apps-utility-dots";
            uDots.title = "Utility Tools";
            uDots.innerHTML = `
          <span class="zentral-apps-utility-dot"></span>
          <span class="zentral-apps-utility-dot"></span>
          <span class="zentral-apps-utility-dot"></span>
        `;

            const uDotsVert = document.createElement("div");
            uDotsVert.className = "zentral-apps-utility-dots-vertical";
            uDotsVert.title = "Utility Tools";
            uDotsVert.innerHTML = `
          <span class="zentral-apps-utility-dot"></span>
          <span class="zentral-apps-utility-dot"></span>
          <span class="zentral-apps-utility-dot"></span>
        `;

            const uContent = document.createElement("div");
            uContent.className = "zentral-apps-utility-content";

            const uRow = document.createElement("div");
            uRow.className = "zentral-apps-utility-row";
            uContent.appendChild(uRow);

            const uDivider = document.createElement("div");
            uDivider.className = "zentral-apps-utility-divider";

            utilitySection.appendChild(uDots);
            utilitySection.appendChild(uDotsVert);
            utilitySection.appendChild(uContent);
            utilitySection.appendChild(uDivider);

            this.#dom.grid.appendChild(utilitySection);

            this.#dom.utilitySection = utilitySection;
            this.#dom.utilityDots = uDots;
            this.#dom.utilityDotsVertical = uDotsVert;
            this.#dom.utilityContent = uContent;
            this.#dom.utilityRow = uRow;
            this.#dom.utilityDivider = uDivider;

            const dots = document.createElement("div");
            dots.className = "zen-apps-autohide-dots";
            dots.innerHTML = `
          <span class="zen-apps-autohide-dot"></span>
          <span class="zen-apps-autohide-dot"></span>
          <span class="zen-apps-autohide-dot"></span>
        `;
            this.#dom.grid.appendChild(dots);
            this.#dom.autohideDots = dots;

            const scrollBox = document.createElement("div");
            scrollBox.className = "zen-apps-scroll-box";

            this.#dom.grid.appendChild(scrollBox);
            this.#dom.scrollBox = scrollBox;

            utilitySection.addEventListener("mouseenter", () => {
              if (!this.isPlacementVerticalBar()) {
                this.setUtilityHovered(true);
              }
            });
            utilitySection.addEventListener("mouseleave", (e) => {
              if (!this.isPlacementVerticalBar()) {
                if (
                  this.#dom.grid &&
                  !this.#dom.grid.contains(e.relatedTarget)
                ) {
                  this.scheduleUtilityCollapse(260);
                }
              }
            });

            let cachedGridRect = null;
            const refreshGridRect = () => {
              if (this.#dom.grid) {
                const r = this.#dom.grid.getBoundingClientRect();
                if (r.width > 0 || r.height > 0) {
                  cachedGridRect = r;
                }
              }
            };

            this._refreshGridRectListener = refreshGridRect;
            window.addEventListener("resize", this._refreshGridRectListener, {
              passive: true,
            });
            if (typeof ResizeObserver !== "undefined" && this.#dom.grid) {
              try {
                this.#gridResizeObs = new ResizeObserver(refreshGridRect);
                this.#gridResizeObs.observe(this.#dom.grid);
              } catch (_) {}
            }

            this.#dom.grid.addEventListener("mouseenter", () => {
              if (!this.isPlacementVerticalBar()) {
                this.setAutohideHovered(true);
                refreshGridRect();
                if (this.#state.utilityCollapseTimer) {
                  clearTimeout(this.#state.utilityCollapseTimer);
                  this.#state.utilityCollapseTimer = null;
                }
                if (this.#state.autohideCollapseTimer) {
                  clearTimeout(this.#state.autohideCollapseTimer);
                  this.#state.autohideCollapseTimer = null;
                }
              }
            });
            this.#dom.grid.addEventListener("mouseleave", () => {
              if (!this.isPlacementVerticalBar()) {
                this.scheduleAutohideCollapse(260);
                this.scheduleUtilityCollapse(260);
              }
            });

            // Unified Autohide Mousemove Listener: Throttled to max once per 16ms (one animation frame)
            // to avoid firing hit-tests and pref queries on every single mouse pixel movement at 60fps+.
            let _gridMoveThrottleLast = 0;
            this._autohideMouseMoveHandler = (e) => {
              const now = performance.now();
              if (now - _gridMoveThrottleLast < 16) return;
              _gridMoveThrottleLast = now;

              if (this.isPlacementVerticalBar()) {
                if (Core.getPref(Constants.Apps.PREF_AUTOHIDE, false) !== true)
                  return;
                if (this.isAppPanelKeepingAppsRevealed()) return;

                const isRight = this.isVerticalBarOnRight();
                const triggerDist = 1; // Screen edge proximity (within 1px of bezel)
                const cancelDist = 14; // Cancel reveal only if cursor departs beyond 14px from edge
                const barWidth = 48 + 8 + 20; // 8px outer margin + 48px bar + 20px inner buffer = 76px

                const isNearEdge = isRight
                  ? e.clientX >= window.innerWidth - triggerDist
                  : e.clientX <= triggerDist;
                const isDeparting = isRight
                  ? e.clientX < window.innerWidth - cancelDist
                  : e.clientX > cancelDist;
                const isInsideBar = isRight
                  ? e.clientX >= window.innerWidth - barWidth
                  : e.clientX <= barWidth;

                const isCurrentlyRevealed =
                  this.#dom.verticalBar?.hasAttribute("data-revealed");

                if (!isCurrentlyRevealed) {
                  // When hidden: schedule reveal when touching the edge
                  if (isNearEdge) {
                    this.scheduleAutohideReveal(320);
                  } else if (isDeparting) {
                    this.cancelAutohideReveal();
                  }
                } else {
                  // When already revealed: keep open while cursor is inside the bar or near edge
                  if (isInsideBar || isNearEdge) {
                    if (this.#state.autohideCollapseTimer) {
                      clearTimeout(this.#state.autohideCollapseTimer);
                      this.#state.autohideCollapseTimer = null;
                    }
                  } else {
                    this.scheduleAutohideCollapse(250);
                  }
                }
                return;
              }

              // Sidebar Grid Autohide:
              const grid = this.#dom.grid;
              if (!grid) return;
              if (grid.classList.contains("zen-apps-horizontal")) return;
              if (this.#state.activeAppId) return; // Keep revealed while an app panel is open

              if (!cachedGridRect) refreshGridRect();
              const rect = cachedGridRect;
              if (!rect || (rect.width === 0 && rect.height === 0)) return;

              const isInsideGrid =
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom;

              // Forgiving 18px upward margin over URL bar bottom edge
              const isNearTopEdge =
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top - 18 &&
                e.clientY < rect.top;

              if (isInsideGrid) {
                if (this.#state.utilityCollapseTimer) {
                  clearTimeout(this.#state.utilityCollapseTimer);
                  this.#state.utilityCollapseTimer = null;
                }
                if (this.#state.autohideCollapseTimer) {
                  clearTimeout(this.#state.autohideCollapseTimer);
                  this.#state.autohideCollapseTimer = null;
                }
              } else if (isNearTopEdge) {
                // Hovering near top edge: refresh collapse timer
                this.scheduleAutohideCollapse(260);
                this.scheduleUtilityCollapse(260);
              } else {
                // Cursor is outside grid and outside top buffer (e.g. webpage, top bar, lower sidebar)
                const isRevealed =
                  grid.hasAttribute("data-revealed") ||
                  this.#dom.utilitySection?.hasAttribute(
                    "data-utility-revealed",
                  );
                if (isRevealed) {
                  this.scheduleAutohideCollapse(260);
                  this.scheduleUtilityCollapse(260);
                }
              }
            };
            window.addEventListener(
              "mousemove",
              this._autohideMouseMoveHandler,
              {
                passive: true,
              },
            );

            this._autohideBlurListener = () => {
              if (this.isPlacementVerticalBar() || this.#state.activeAppId)
                return;
              this.setAutohideHovered(false);
              this.setUtilityHovered(false);
            };
            window.addEventListener("blur", this._autohideBlurListener);

            scrollBox.addEventListener(
              "wheel",
              (e) => {
                if (!this.#dom.grid.classList.contains("zen-apps-horizontal"))
                  return;
                if (e.deltaY !== 0 || e.deltaX !== 0) {
                  e.preventDefault();
                  const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                  scrollBox.scrollLeft += delta * 8;
                  this.updateScrollMask();
                }
              },
              { passive: false },
            );

            scrollBox.addEventListener("scroll", () => {
              this.updateScrollMask();
            });

            this.#dom.grid.addEventListener("contextmenu", (e) => {
              if (
                e.target.closest(".zen-app-tile[data-app-id]") ||
                e.target.closest(".zentral-utility-btn")
              )
                return;
              e.preventDefault();
              e.stopPropagation();
              const popup = document.getElementById(
                "zen-apps-sidebar-tile-context",
              );
              if (popup) {
                delete popup.dataset.activeAppId;
                popup.openPopupAtScreen(e.screenX, e.screenY, true);
              }
            });
          }

          if (!this.#dom.verticalBar) {
            let vb = document.getElementById("zentral-apps-vertical-bar");
            if (!vb) {
              vb = document.createElement("div");
              vb.id = "zentral-apps-vertical-bar";
            }

            vb.addEventListener("mouseenter", () => {
              if (this.isPlacementVerticalBar()) {
                if (this.#state.autohideCollapseTimer) {
                  clearTimeout(this.#state.autohideCollapseTimer);
                  this.#state.autohideCollapseTimer = null;
                }
              }
            });
            vb.addEventListener("mouseleave", (e) => {
              if (this.isPlacementVerticalBar()) {
                if (
                  !vb.contains(e.relatedTarget) &&
                  e.relatedTarget !== trigger
                ) {
                  const isRight = this.isVerticalBarOnRight();
                  const barWidth = 48 + 8 + 20;
                  const isInsideBar = isRight
                    ? e.clientX >= window.innerWidth - barWidth
                    : e.clientX <= barWidth;
                  if (!isInsideBar) {
                    this.scheduleAutohideCollapse(250);
                  }
                }
              }
            });
            vb.addEventListener(
              "wheel",
              (e) => {
                if (this.isPlacementVerticalBar()) {
                  const scroller = this.#dom.scrollBox || this.#dom.grid;
                  if (scroller && e.deltaY) {
                    e.preventDefault();
                    e.stopPropagation();
                    scroller.scrollTop += e.deltaY;
                  }
                }
              },
              { passive: false },
            );
            this.#dom.verticalBar = vb;

            let bgEl = vb.querySelector("#zentral-apps-vertical-bar-bg");
            if (!bgEl) {
              bgEl = document.createElement("div");
              bgEl.id = "zentral-apps-vertical-bar-bg";
              bgEl.className =
                "zen-toolbar-background zen-browser-generic-background";
              const grain = document.createElement("div");
              grain.className = "zen-browser-grain";
              bgEl.appendChild(grain);
              vb.insertBefore(bgEl, vb.firstChild);
            }

            let hoverZone = vb.querySelector(".zen-app-vb-hover-zone");
            if (!hoverZone) {
              hoverZone = document.createElement("div");
              hoverZone.className = "zen-app-vb-hover-zone";
              vb.appendChild(hoverZone);
            }

            let footer = document.getElementById(
              "zentral-apps-vertical-bar-footer",
            );
            if (!footer) {
              footer = document.createElement("div");
              footer.id = "zentral-apps-vertical-bar-footer";
            }

            // The native Library contains all three browser collections.
            // Keep one compact shortcut by default; direct shortcuts are opt-in.
            for (const [key, label, section, icon] of [
              [
                `library`,
                `Library (History, Downloads, Bookmarks)`,
                `AllBookmarks`,
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3v11M6 3v11M10 3v11M13 3l2 10"/><path d="M1 3h10M1 13h10"/></svg>`,
              ],
              [
                `history`,
                `History`,
                `History`,
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/></svg>`,
              ],
              [
                `downloads`,
                `Downloads`,
                `Downloads`,
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8M4 6l4 4 4-4M2 11v3h12v-3"/></svg>`,
              ],
              [
                `bookmarks`,
                `Bookmarks`,
                `AllBookmarks`,
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h8v12l-4-3-4 3z"/></svg>`,
              ],
            ]) {
              const id = "zentral-apps-vb-" + key + "-btn";
              if (footer.querySelector("#" + id)) continue;
              const button = document.createElement("button");
              button.id = id;
              button.type = "button";
              button.className =
                "zen-app-tile zen-app-vb-footer-btn zentral-browser-tool";
              button.title = label;
              button.setAttribute("aria-label", label);
              button.appendChild(this.#createSVG(icon));
              button.addEventListener("mousedown", (event) => {
                if (event.button === 0) event.stopPropagation();
              });
              button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.openBrowserLibrary(section);
              });
              footer.appendChild(button);
            }

            let autohideBtn = footer.querySelector(
              "#zentral-apps-vb-autohide-btn",
            );
            if (!autohideBtn) {
              autohideBtn = document.createElement("button");
              autohideBtn.id = "zentral-apps-vb-autohide-btn";
              autohideBtn.className = "zen-app-tile zen-app-vb-footer-btn";
              autohideBtn.title =
                Core.getPref(Constants.Apps.PREF_AUTOHIDE, false) === true
                  ? "Disable Autohide"
                  : "Enable Autohide";
              autohideBtn.appendChild(this.#createSVG(SVG_STRINGS.EYE_OPEN));
              autohideBtn.appendChild(this.#createSVG(SVG_STRINGS.EYE_CLOSED));
              autohideBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const cur =
                  Core.getPref(Constants.Apps.PREF_AUTOHIDE, false) === true;
                const next = !cur;
                Core.setPref(Constants.Apps.PREF_AUTOHIDE, next);
                this.updateAutohideState();
              });
              autohideBtn.addEventListener("mousedown", (e) => {
                if (e.button === 0) e.stopPropagation();
              });
              footer.appendChild(autohideBtn);
            }

            let settingsBtn = footer.querySelector(
              "#zentral-apps-vb-settings-btn",
            );
            if (!settingsBtn) {
              settingsBtn = document.createElement("button");
              settingsBtn.id = "zentral-apps-vb-settings-btn";
              settingsBtn.className = "zen-app-tile zen-app-vb-footer-btn";
              settingsBtn.title = "Zentral Settings";
              settingsBtn.appendChild(this.#createSVG(SVG_STRINGS.SETTINGS));
              settingsBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (window.Zentral?.Settings) window.Zentral.Settings.open();
                else if (window.ZentralSettingsInstance)
                  window.ZentralSettingsInstance.open();
              });
              settingsBtn.addEventListener("mousedown", (e) => {
                if (e.button === 0) e.stopPropagation();
              });
              footer.appendChild(settingsBtn);
            }

            if (footer.parentNode !== vb) {
              vb.appendChild(footer);
            }

            this.#dom.vbFooter = footer;
            this.#dom.vbAutohideBtn = autohideBtn;
            this.#dom.vbSettingsBtn = settingsBtn;

            let trigger = document.getElementById(
              "zentral-apps-vertical-bar-trigger",
            );
            if (!trigger) {
              trigger = document.createElement("div");
              trigger.id = "zentral-apps-vertical-bar-trigger";
              (document.body || document.documentElement).appendChild(trigger);
            }
            trigger.addEventListener("mouseenter", () => {
              if (this.isPlacementVerticalBar()) {
                this.scheduleAutohideReveal(320);
              }
            });
            trigger.addEventListener("mouseleave", (e) => {
              if (this.isPlacementVerticalBar()) {
                if (e.relatedTarget !== vb && !vb.contains(e.relatedTarget)) {
                  const isRight = this.isVerticalBarOnRight();
                  const cancelDist = 24;
                  const isStillNearEdge = isRight
                    ? e.clientX >= window.innerWidth - cancelDist
                    : e.clientX <= cancelDist;
                  if (!isStillNearEdge) {
                    this.cancelAutohideReveal();
                    this.scheduleAutohideCollapse(250);
                  }
                }
              }
            });
            this.#dom.verticalBarTrigger = trigger;
          }

          if (!this.#dom.root) {
            const root = document.createElement("div");
            root.id = "zen-app-panel-root";
            const clip = document.createElement("div");
            clip.id = "zen-app-panel-clip";
            const panel = document.createElement("div");
            panel.id = "zen-app-panel-slider";
            clip.appendChild(panel);

            const hoverZone = document.createElement("div");
            hoverZone.className = "zen-app-hover-zone";
            const pill = document.createElement("div");
            pill.id = "zen-app-panel-pill";

            const pinBtn = document.createElement("button");
            pinBtn.className = "zen-app-btn";
            pinBtn.title = "Pin panel";
            pinBtn.appendChild(this.#createSVG(SVG_STRINGS.PIN));
            pinBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              this.togglePin();
            });

            const expandBtn = document.createElement("button");
            expandBtn.className = "zen-app-btn";
            expandBtn.title = "Expand panel";
            expandBtn.appendChild(this.#createSVG(SVG_STRINGS.EXPAND));
            expandBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              this.toggleExpand();
            });

            const grabberBtn = document.createElement("div");
            grabberBtn.className = "zen-app-grabber";
            grabberBtn.title = "Drag to resize";
            grabberBtn.appendChild(this.#createSVG(SVG_STRINGS.GRABBER));
            // The extension owns this grabber drag, using its direct edge resize path.

            const refreshBtn = document.createElement("button");
            refreshBtn.className = "zen-app-btn zen-app-refresh-btn";
            refreshBtn.title = "Refresh app";
            refreshBtn.appendChild(this.#createSVG(SVG_STRINGS.REFRESH));
            refreshBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (this.#state.activeAppId) {
                refreshBtn.classList.add("zen-app-refresh-spinning");
                setTimeout(
                  () => refreshBtn.classList.remove("zen-app-refresh-spinning"),
                  450,
                );
                this.refreshApp(this.#state.activeAppId);
              }
            });

            const closeBtn = document.createElement("button");
            closeBtn.className = "zen-app-btn zen-app-close-btn";
            closeBtn.title = "Close panel";
            closeBtn.appendChild(this.#createSVG(SVG_STRINGS.CLOSE_X));
            closeBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              this.closePanel();
            });

            pill.append(pinBtn, expandBtn, grabberBtn, refreshBtn, closeBtn);

            const strip = document.createElement("div");
            strip.className = "zen-app-resize-strip";
            strip.addEventListener("mousedown", this.startResize);

            root.append(clip, hoverZone, pill, strip);
            document.documentElement.appendChild(root);
            // Update only when the pill's buttons/layout change. Its position is
            // handled by CSS, so moving the panel never measures layout in a loop.
            let hoverHeight = -1;
            const syncHoverHeight = (entries) => {
              const box = entries?.[0]?.borderBoxSize;
              const blockSize = Array.isArray(box)
                ? box[0]?.blockSize
                : box?.blockSize;
              const height = Math.ceil(blockSize ?? pill.offsetHeight);
              if (height === hoverHeight) return;
              hoverHeight = height;
              hoverZone.style.setProperty(
                "--zentral-pill-hover-height",
                height + "px",
              );
            };
            syncHoverHeight();
            this.#pillHoverZoneResizeObs = new ResizeObserver(syncHoverHeight);
            this.#pillHoverZoneResizeObs.observe(pill);

            this.#dom.root = root;
            this.#dom.clip = clip;
            this.#dom.panel = panel;
            this.#dom.pill = pill;
            this.#dom.pinBtn = pinBtn;
            this.#dom.expandBtn = expandBtn;
            this.#dom.refreshBtn = refreshBtn;
          }
        }

        /** Opens or focuses the browser's native Library collection. */
        openBrowserLibrary(section = "AllBookmarks") {
          if (!["AllBookmarks", "History", "Downloads"].includes(section))
            return false;
          try {
            if (
              typeof window.PlacesCommandHook?.showPlacesOrganizer ===
              "function"
            ) {
              window.PlacesCommandHook.showPlacesOrganizer(section);
            } else {
              const organizer =
                Services.wm.getMostRecentWindow("Places:Organizer");
              if (organizer && !organizer.closed) {
                organizer.PlacesOrganizer.selectLeftPaneContainerByHierarchy(
                  section,
                );
                organizer.focus();
              } else {
                window.openDialog(
                  "chrome://browser/content/places/places.xhtml",
                  "",
                  "chrome,toolbar=yes,dialog=no,resizable",
                  section,
                );
              }
            }
            return true;
          } catch (error) {
            console.warn(
              "[ZentralApps] Could not open browser Library:",
              error,
            );
            return false;
          }
        }

        /**
         * Updates documentElement and trigger state based on autohide preference.
         */
        updateAutohideState() {
          const isAutohide =
            Core.getPref(Constants.Apps.PREF_AUTOHIDE, false) === true;
          const isCollapsed = this.isPhysicallySidebarCollapsed();
          const isVerticalBar = this.isPlacementVerticalBar();
          const activeAutohide = isAutohide && (isVerticalBar || !isCollapsed);

          document.documentElement.setAttribute(
            "zentral-apps-autohide",
            activeAutohide ? "true" : "false",
          );
          document.documentElement.setAttribute(
            "zentral-apps-placement",
            isVerticalBar ? "vertical-bar" : "sidebar",
          );
          if (!activeAutohide) {
            if (this.#dom.grid) this.#dom.grid.removeAttribute("data-revealed");
            if (this.#dom.verticalBar)
              this.#dom.verticalBar.removeAttribute("data-revealed");
          }
          if (isVerticalBar) {
            this.updateVerticalBarBounds();
          }
          if (this.#dom.vbAutohideBtn) {
            this.#dom.vbAutohideBtn.title = isAutohide
              ? "Disable Autohide"
              : "Enable Autohide";
          }
          if (this.#dom.utilityAutohideBtn) {
            this.#dom.utilityAutohideBtn.title = isAutohide
              ? "Disable Autohide"
              : "Enable Autohide";
          }
          this.applyHideUtilitySectionPref();

          if (!this._badgeSyncInitialized) {
            this._badgeSyncInitialized = true;
            this._badgeSyncHandler = () => this.syncAllAppBadges();
            window.addEventListener("TabSelect", this._badgeSyncHandler, {
              passive: true,
            });
            window.addEventListener("TabAttrModified", this._badgeSyncHandler, {
              passive: true,
            });
          }
          if (this.#state.appBrowsers && this.#state.appBrowsers.size > 0) {
            this.ensureBadgeSyncLoop();
          }
        }

        /**
         * Updates documentElement and utilitySection state based on hide utility section preference.
         */
        applyHideUtilitySectionPref() {
          const hide =
            Core.getPref(Constants.Apps.PREF_HIDE_UTILITY_SECTION, false) ===
            true;
          document.documentElement.setAttribute(
            "zentral-apps-hide-utility",
            hide ? "true" : "false",
          );
          if (this.#dom.utilitySection) {
            this.#dom.utilitySection.setAttribute(
              "data-permanently-hidden",
              hide ? "true" : "false",
            );
            if (hide) {
              this.#dom.utilitySection.style.setProperty(
                "display",
                "none",
                "important",
              );
              if (this.#dom.utilityRow) this.#dom.utilityRow.replaceChildren();
            } else {
              this.#dom.utilitySection.style.removeProperty("display");
              this.renderUtilitySection();
            }
          }
        }

        /**
         * Sets whether the utility section is revealed (Autohide OFF mode).
         * @param {boolean} hovered - Whether utility section or apps grid is hovered.
         */
        setUtilityHovered(hovered) {
          if (this.#state.utilityCollapseTimer) {
            clearTimeout(this.#state.utilityCollapseTimer);
            this.#state.utilityCollapseTimer = null;
          }
          if (
            Core.getPref(Constants.Apps.PREF_HIDE_UTILITY_SECTION, false) ===
            true
          )
            return;
          const util = this.#dom.utilitySection;
          if (!util) return;

          if (hovered) {
            util.setAttribute("data-utility-revealed", "true");
          } else {
            util.removeAttribute("data-utility-revealed");
          }
        }

        /**
         * Schedules collapse of the utility section after cursor leaves.
         * @param {number} [delay=350] - Delay in milliseconds.
         */
        scheduleUtilityCollapse(delay = 350) {
          if (this.#state.utilityCollapseTimer)
            clearTimeout(this.#state.utilityCollapseTimer);
          this.#state.utilityCollapseTimer = setTimeout(() => {
            this.#state.utilityCollapseTimer = null;
            this.setUtilityHovered(false);
          }, delay);
        }

        /**
         * Schedules delayed reveal when cursor moves to the edge in autohide mode.
         * Prevents accidental opening during rapid mouse passes.
         * @param {number} [delay=320] - Delay in milliseconds.
         */
        scheduleAutohideReveal(delay = 320) {
          if (this.#state.autohideCollapseTimer) {
            clearTimeout(this.#state.autohideCollapseTimer);
            this.#state.autohideCollapseTimer = null;
          }
          if (this.#state.autohideRevealTimer) return;
          this.#state.autohideRevealTimer = setTimeout(() => {
            this.#state.autohideRevealTimer = null;
            this.setAutohideHovered(true);
          }, delay);
        }

        /**
         * Cancels any pending autohide reveal timer.
         */
        cancelAutohideReveal() {
          if (this.#state.autohideRevealTimer) {
            clearTimeout(this.#state.autohideRevealTimer);
            this.#state.autohideRevealTimer = null;
          }
        }

        /**
         * Sets whether the autohide apps grid is currently revealed.
         * @param {boolean} hovered - Whether cursor is over trigger or grid.
         */
        // An open but hover-hidden panel must not pin the Apps Bar open.
        // Sidebar mode keeps its original active-app rule.
        isAppPanelKeepingAppsRevealed() {
          return (
            !!this.#state.activeAppId &&
            !(
              this.isPlacementVerticalBar() &&
              document.documentElement.hasAttribute(
                "bgalazka-hover-panel-hidden",
              )
            )
          );
        }

        syncPanelAutohideVisibility() {
          if (
            !this.isPlacementVerticalBar() ||
            document.documentElement.getAttribute("zentral-apps-autohide") !==
              "true"
          )
            return;
          this.setAutohideHovered(
            this.isAppPanelKeepingAppsRevealed() ||
              !!this.#dom.verticalBar?.matches(":hover"),
          );
        }

        setAutohideHovered(hovered) {
          this.cancelAutohideReveal();
          if (this.#state.autohideCollapseTimer) {
            clearTimeout(this.#state.autohideCollapseTimer);
            this.#state.autohideCollapseTimer = null;
          }
          if (this.#dom.grid) {
            if (hovered) {
              this.#dom.grid.setAttribute("data-revealed", "true");
            } else if (!this.isAppPanelKeepingAppsRevealed()) {
              this.#dom.grid.removeAttribute("data-revealed");
            }
          }
          if (this.#dom.verticalBar) {
            if (hovered) {
              this.updateVerticalBarBounds();
              this.#dom.verticalBar.setAttribute("data-revealed", "true");
            } else if (!this.isAppPanelKeepingAppsRevealed()) {
              this.#dom.verticalBar.removeAttribute("data-revealed");
            }
          }
        }

        /**
         * Schedules delayed collapse after cursor leaves apps grid.
         * @param {number} [delay=250] - Delay in milliseconds.
         */
        scheduleAutohideCollapse(delay = 250) {
          // Mousemove may request collapse every frame. For a hover-hidden
          // two-bar panel, keep the first deadline instead of postponing it
          // until the pointer stops moving. Sidebar timing stays unchanged.
          if (
            this.isPlacementVerticalBar() &&
            !this.isAppPanelKeepingAppsRevealed() &&
            this.#state.autohideCollapseTimer
          )
            return;
          this.cancelAutohideReveal();
          if (this.#state.autohideCollapseTimer)
            clearTimeout(this.#state.autohideCollapseTimer);
          this.#state.autohideCollapseTimer = setTimeout(() => {
            this.#state.autohideCollapseTimer = null;
            if (!this.isAppPanelKeepingAppsRevealed()) {
              this.setAutohideHovered(false);
            }
          }, delay);
        }

        /**
         * Renders the draggable buttons (Settings, Autohide) inside the Apps Grid Utility Section.
         * Supports free slot positioning across all grid columns.
         */
        renderUtilitySection() {
          if (!this.#dom.utilitySection || !this.#dom.utilityRow) return;
          const row = this.#dom.utilityRow;
          row.replaceChildren();

          const hideUtility =
            Core.getPref(Constants.Apps.PREF_HIDE_UTILITY_SECTION, false) ===
            true;
          if (hideUtility) {
            this.#dom.utilitySection.style.setProperty(
              "display",
              "none",
              "important",
            );
            this.#dom.utilitySection.setAttribute(
              "data-permanently-hidden",
              "true",
            );
            return;
          }
          this.#dom.utilitySection.style.removeProperty("display");
          this.#dom.utilitySection.removeAttribute("data-permanently-hidden");

          const isAutohide =
            Core.getPref(Constants.Apps.PREF_AUTOHIDE, false) === true;
          const isHorizontal = this.#dom.grid?.classList.contains(
            "zen-apps-horizontal",
          );
          const slotCount = Constants.Apps.UTILITY_SLOTS_COUNT;
          row.style.setProperty("--zentral-grid-cols", slotCount);

          if (isHorizontal) {
            const btn = document.createElement("button");
            btn.id = "zentral-utility-settings-btn";
            btn.className = "zen-app-tile zentral-utility-btn";
            btn.dataset.utilityKey = "settings";
            btn.title = "Zentral Settings";
            btn.appendChild(this.#createSVG(SVG_STRINGS.SETTINGS));
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (window.Zentral?.Settings) window.Zentral.Settings.open();
              else if (window.ZentralSettingsInstance)
                window.ZentralSettingsInstance.open();
            });
            btn.addEventListener("mousedown", (e) => {
              if (e.button === 0) e.stopPropagation();
            });
            this.#dom.utilitySettingsBtn = btn;
            row.appendChild(btn);
            return;
          }

          if (
            !Array.isArray(this.#state.utilitySlots) ||
            this.#state.utilitySlots.length !== slotCount
          ) {
            const slots = new Array(slotCount).fill(null);
            if (Array.isArray(this.#state.utilitySlots)) {
              this.#state.utilitySlots.forEach((k, idx) => {
                if (idx < slotCount && k) slots[idx] = k;
              });
            }
            this.#state.utilitySlots = slots;
          }

          const required = ["settings", "autohide"];
          required.forEach((reqKey) => {
            if (!this.#state.utilitySlots.includes(reqKey)) {
              const emptyIdx = this.#state.utilitySlots.indexOf(null);
              if (emptyIdx > -1) {
                this.#state.utilitySlots[emptyIdx] = reqKey;
              } else {
                this.#state.utilitySlots[0] = reqKey;
              }
            }
          });

          let draggedKey = null;

          for (let slotIdx = 0; slotIdx < slotCount; slotIdx++) {
            const slotEl = document.createElement("div");
            slotEl.className = "zentral-utility-slot";
            slotEl.dataset.slotIndex = slotIdx;

            const btnKey = this.#state.utilitySlots[slotIdx];
            if (btnKey) {
              let btn = null;
              if (btnKey === "settings") {
                btn = document.createElement("button");
                btn.id = "zentral-utility-settings-btn";
                btn.className = "zen-app-tile zentral-utility-btn";
                btn.dataset.utilityKey = "settings";
                btn.title = "Zentral Settings";
                btn.draggable = true;
                btn.appendChild(this.#createSVG(SVG_STRINGS.SETTINGS));
                btn.addEventListener("click", (e) => {
                  e.stopPropagation();
                  if (window.Zentral?.Settings) window.Zentral.Settings.open();
                  else if (window.ZentralSettingsInstance)
                    window.ZentralSettingsInstance.open();
                });
                btn.addEventListener("mousedown", (e) => {
                  if (e.button === 0) e.stopPropagation();
                });
                this.#dom.utilitySettingsBtn = btn;
              } else if (btnKey === "autohide") {
                btn = document.createElement("button");
                btn.id = "zentral-utility-autohide-btn";
                btn.className = "zen-app-tile zentral-utility-btn";
                btn.dataset.utilityKey = "autohide";
                btn.title = isAutohide ? "Disable Autohide" : "Enable Autohide";
                btn.draggable = true;
                btn.appendChild(this.#createSVG(SVG_STRINGS.EYE_OPEN));
                btn.appendChild(this.#createSVG(SVG_STRINGS.EYE_CLOSED));
                btn.addEventListener("click", (e) => {
                  e.stopPropagation();
                  const cur =
                    Core.getPref(Constants.Apps.PREF_AUTOHIDE, false) === true;
                  const next = !cur;
                  Core.setPref(Constants.Apps.PREF_AUTOHIDE, next);
                  this.updateAutohideState();
                });
                btn.addEventListener("mousedown", (e) => {
                  if (e.button === 0) e.stopPropagation();
                });
                this.#dom.utilityAutohideBtn = btn;
              }

              if (btn) {
                btn.addEventListener("dragstart", (e) => {
                  e.stopPropagation();
                  draggedKey = btnKey;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", "utility:" + btnKey);
                  btn.style.opacity = "0.4";
                });
                btn.addEventListener("dragend", (e) => {
                  e.stopPropagation();
                  draggedKey = null;
                  btn.style.opacity = "1";
                  this.renderUtilitySection();
                });
                slotEl.appendChild(btn);
              }
            }

            slotEl.addEventListener("dragover", (e) => {
              if (draggedKey) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                slotEl.classList.add("zentral-utility-slot-dragover");
              }
            });
            slotEl.addEventListener("dragleave", (e) => {
              e.stopPropagation();
              slotEl.classList.remove("zentral-utility-slot-dragover");
            });
            slotEl.addEventListener("drop", (e) => {
              e.preventDefault();
              e.stopPropagation();
              slotEl.classList.remove("zentral-utility-slot-dragover");
              const data = e.dataTransfer.getData("text/plain");
              if (data && data.startsWith("utility:")) {
                const sourceKey = data.replace("utility:", "");
                const fromIdx = this.#state.utilitySlots.indexOf(sourceKey);
                const toIdx = slotIdx;
                if (fromIdx > -1 && fromIdx !== toIdx) {
                  const targetKey = this.#state.utilitySlots[toIdx];
                  this.#state.utilitySlots[toIdx] = sourceKey;
                  this.#state.utilitySlots[fromIdx] = targetKey || null;
                  this.saveUtilityOrder();
                  this.renderUtilitySection();
                }
              }
            });

            row.appendChild(slotEl);
          }
        }

        /**
         * Formats an app's title into a clean, friendly service/brand name
         * (e.g. "Discord", "WhatsApp", "Telegram", "Reddit") instead of raw URLs or domains ("discord.com").
         * @param {string} [title] - Raw title string or page label.
         * @param {string} [url] - Target app website URL.
         * @returns {string} Human-friendly service title.
         */
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
        }

        renderGrid() {
          if (!this.#dom.grid) return;
          const oldAddBtn =
            document.querySelector(
              "#zentral-apps-vertical-bar .zen-app-add-btn",
            ) || this.#dom.grid.querySelector(".zen-app-add-btn");
          if (oldAddBtn) oldAddBtn.remove();
          const targetContainer = this.#dom.scrollBox || this.#dom.grid;
          targetContainer.replaceChildren(); // Faster than innerHTML = '' — avoids serialization

          const isVerticalBar = this.isPlacementVerticalBar();
          if (isVerticalBar) {
            this.#dom.grid.style.direction = "ltr";
          } else {
            const sidebarRight = this.isSidebarRight();
            const isCollapsed = this.isCollapsedSidebar();
            const shouldFlip = !sidebarRight && !isCollapsed;
            this.#dom.grid.style.direction = shouldFlip ? "rtl" : "ltr";
          }
          const cols = Math.max(
            1,
            Math.min(
              12,
              parseInt(Core.getPref(Constants.Apps.PREF_APPS_PER_ROW, 7), 10) ||
                7,
            ),
          );
          const maxRows = Math.max(
            1,
            Math.min(
              10,
              parseInt(Core.getPref(Constants.Apps.PREF_MAX_ROWS, 3), 10) || 3,
            ),
          );
          this.#dom.grid.style.setProperty("--zentral-grid-cols", cols);
          this.#dom.grid.style.setProperty("--zentral-max-rows", maxRows);

          const maxApps = Math.max(
            0,
            Math.min(
              200,
              parseInt(Core.getPref(Constants.Apps.PREF_MAX_APPS, 21), 10) || 0,
            ),
          );
          const activeWorkspaceId = window.gZenWorkspaces?.activeWorkspace;
          const visibleApps = this.#state.apps.filter((app) => {
            if (!app.workspaceId || app.workspaceId === "all") return true;
            if (activeWorkspaceId && app.workspaceId === activeWorkspaceId)
              return true;
            return false;
          });
          const activeApps = visibleApps.slice(0, maxApps);
          document.documentElement.toggleAttribute(
            "zentral-apps-has-visible-apps",
            activeApps.length > 0,
          );

          const hideUtility =
            Core.getPref(Constants.Apps.PREF_HIDE_UTILITY_SECTION, false) ===
            true;
          const canAdd =
            Core.getPref(Constants.Apps.PREF_ENABLED) &&
            this.#state.apps.length < maxApps;
          const appCount = activeApps.length + (canAdd ? 1 : 0);
          const actualRows = Math.min(Math.ceil(appCount / cols), maxRows);
          const expandedGridHeight =
            (hideUtility ? 0 : 44) + actualRows * 42 + 4;
          this.#dom.grid.style.setProperty(
            "--zentral-apps-grid-expanded-height",
            `${expandedGridHeight}px`,
          );
          let draggedAppId = null;
          const fragment = document.createDocumentFragment();

          this.updateAutohideState();
          this.renderUtilitySection();

          activeApps.forEach((app) => {
            const isLoaded = this.#state.appBrowsers.has(app.id);
            const btn = document.createElement("button");
            btn.id = "zen-app-btn-" + app.id;
            btn.className = "zen-app-tile";
            btn.dataset.appId = app.id;
            btn.dataset.active =
              this.#state.activeAppId === app.id ? "true" : "false";
            btn.dataset.loaded = isLoaded ? "true" : "false";
            btn.title = this.formatAppDisplayName(app.title, app.url);

            const img = document.createElement("img");
            img.src = app.icon || `page-icon:${app.url}`;
            btn.appendChild(img);

            if (app.hasNotification) {
              const badge = document.createElement("div");
              badge.className = "zen-app-badge";
              if (app.notificationCount) {
                badge.textContent =
                  app.notificationCount > 99 ? "99+" : app.notificationCount;
              } else {
                badge.setAttribute("data-dot", "true");
              }
              btn.appendChild(badge);
            }

            let wasDragged = false;
            let startX = 0;
            let startY = 0;

            const togglePanel = () => {
              if (this.#state.activeAppId === app.id) {
                this.closePanel();
              } else {
                this.openPanel(app);
              }
            };

            btn.addEventListener("mousedown", (e) => {
              if (e.button === 1) {
                // Middle-click: intercept and prevent autoscroll
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              if (e.button !== 0) return;
              wasDragged = false;
              startX = e.clientX;
              startY = e.clientY;
            });

            btn.addEventListener("mousemove", (e) => {
              if (e.buttons === 1) {
                const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
                if (dist > 6) {
                  wasDragged = true;
                }
              }
            });

            btn.addEventListener("click", (e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              if (wasDragged) {
                wasDragged = false;
                return;
              }
              togglePanel();
            });

            // Middle-click shortcut to unload a loaded app
            btn.addEventListener("auxclick", (e) => {
              if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                if (this.#state.appBrowsers.has(app.id)) {
                  this.closeApp(app.id);
                }
              }
            });

            // Context menu and drag/drop logic
            btn.addEventListener("contextmenu", (e) => {
              e.preventDefault();
              const popup = document.getElementById(
                "zen-apps-sidebar-tile-context",
              );
              if (popup) {
                popup.dataset.activeAppId = app.id;
                popup.openPopupAtScreen(e.screenX, e.screenY, true);
              }
            });

            btn.draggable = true;
            btn.addEventListener("dragstart", (e) => {
              wasDragged = true;
              draggedAppId = app.id;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", app.id);
              btn.style.opacity = "0.4";
            });
            btn.addEventListener("dragend", () => {
              draggedAppId = null;
              btn.style.opacity = "1";
              setTimeout(() => {
                wasDragged = false;
              }, 60);
              this.renderGrid();
            });
            btn.addEventListener("dragover", (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (draggedAppId && draggedAppId !== app.id) {
                btn.style.transform = "scale(1.15)";
                btn.style.zIndex = "5";
              }
            });
            btn.addEventListener("dragleave", () => {
              btn.style.transform = "";
              btn.style.zIndex = "";
            });
            btn.addEventListener("drop", (e) => {
              e.preventDefault();
              if (draggedAppId && draggedAppId !== app.id) {
                const fromIdx = this.#state.apps.findIndex(
                  (a) => a.id === draggedAppId,
                );
                const toIdx = this.#state.apps.findIndex(
                  (a) => a.id === app.id,
                );
                if (fromIdx > -1 && toIdx > -1) {
                  const [movedApp] = this.#state.apps.splice(fromIdx, 1);
                  const destination = this.#state.apps.findIndex(
                    (a) => a.id === app.id,
                  );
                  this.#state.apps.splice(destination, 0, movedApp);
                  this.saveApps();
                  this.renderGrid();
                }
              }
            });

            fragment.appendChild(btn);
          });

          targetContainer.appendChild(fragment);

          if (canAdd) {
            const addBtn = document.createElement("button");
            addBtn.className = "zen-app-tile zen-app-add-btn";
            addBtn.title = "Add App";
            addBtn.appendChild(this.#createSVG(SVG_STRINGS.ADD));
            addBtn.addEventListener("click", (e) => {
              const tab = gBrowser.selectedTab;
              if (!tab) return;
              const url = tab.linkedBrowser?.currentURI?.spec || "about:blank";
              let title = "";
              try {
                title = tab.linkedBrowser?.contentDocument?.title || "";
              } catch (_) {}
              if (!title) {
                try {
                  const host = tab.linkedBrowser?.currentURI?.host || "";
                  title = host.replace(/^www\./, "") || tab.label || url;
                } catch (_) {
                  title = tab.label || url;
                }
              }
              const cleanTitle = this.formatAppDisplayName(title, url);
              const icon =
                (typeof gBrowser.getIcon === "function"
                  ? gBrowser.getIcon(tab)
                  : null) ||
                tab.getAttribute("image") ||
                tab.image ||
                "";
              if (url !== "about:blank") this.addApp(url, cleanTitle, icon);
            });

            addBtn.addEventListener("mousedown", (e) => {
              if (e.button === 0) e.stopPropagation();
            });

            targetContainer.appendChild(addBtn);
            if (isVerticalBar) {
              this.updateVerticalBarAddBtnPlacement();
            }
          }

          if (
            this.#dom.utilitySection &&
            this.#dom.utilitySection.parentNode === this.#dom.grid
          ) {
            if (this.#dom.grid.classList.contains("zen-apps-horizontal")) {
              this.#dom.grid.appendChild(this.#dom.utilitySection);
            } else {
              if (this.#dom.grid.firstChild !== this.#dom.utilitySection) {
                this.#dom.grid.insertBefore(
                  this.#dom.utilitySection,
                  this.#dom.grid.firstChild,
                );
              }
            }
          }

          if (this.#dom.scrollBox) {
            if (
              this.#dom.grid.classList.contains("zen-apps-horizontal") &&
              activeApps.length >= 8
            ) {
              this.#dom.scrollBox.style.setProperty(
                "min-width",
                "calc(8 * 38px + 7 * 4px)",
                "important",
              );
            } else {
              this.#dom.scrollBox.style.removeProperty("min-width");
            }
          }

          if (this._renderGridRAF) cancelAnimationFrame(this._renderGridRAF);
          this._renderGridRAF = requestAnimationFrame(() => {
            this._renderGridRAF = null;
            if (this._destroyed || !this.#dom.grid?.isConnected) return;
            this.updateScrollMask();
            if (isVerticalBar) {
              this.updateVerticalBarAddBtnPlacement();
            }
            if (
              this.#dom.scrollBox &&
              this.#dom.scrollBox.scrollWidth > this.#dom.scrollBox.clientWidth
            ) {
              this.#dom.scrollBox.scrollLeft =
                this.#dom.scrollBox.scrollWidth -
                this.#dom.scrollBox.clientWidth;
              this.updateScrollMask();
            }
          });
        }

        addApp(url, title, icon) {
          const limit = Math.max(
            0,
            Math.min(
              200,
              parseInt(Core.getPref(Constants.Apps.PREF_MAX_APPS, 21), 10) || 0,
            ),
          );
          if (this.#state.apps.length >= limit || typeof url !== "string")
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
          this.#state.apps.push(newApp);
          this.saveApps();
          this.renderGrid();
        }

        removeApp(id) {
          const idx = this.#state.apps.findIndex((app) => app.id === id);
          if (idx === -1) return;
          this.#state.apps.splice(idx, 1);
          this.saveApps();

          if (this.#state.activeAppId === id) this.closePanel();

          const b = this.#state.appBrowsers.get(id);
          if (b && b.isConnected) b.parentNode.removeChild(b);
          this.#state.appBrowsers.delete(id);
          if (!this.#state.appBrowsers || this.#state.appBrowsers.size === 0) {
            this.stopBadgeSyncLoop();
          }

          this.renderGrid();
        }

        isPanelOpen() {
          // activeAppId selects the app; root[open] stays until the close animation
          // ends. The documentElement attribute follows activeAppId for CSS.
          return !!(
            this.#state.activeAppId !== null ||
            this.#dom.root?.hasAttribute("open") ||
            document.getElementById("zen-app-panel-root")?.hasAttribute("open")
          );
        }

        openPanel(app) {
          Core.log(
            "ZentralApps",
            "openPanel called for app:",
            app.id,
            "URL:",
            app.url,
          );
          if (this.#state.closeTimerId) {
            clearTimeout(this.#state.closeTimerId);
            this.#state.closeTimerId = null;
          }
          if (this.#dom.root) {
            this.#dom.root.style.pointerEvents = "";
          }
          this.#state.activeAppId = app.id;
          // Pin synchronously, before the open animation or outside-click
          // listener can run. Startup and every launcher use this same path.
          this.#state.isPinned =
            Core.getPref("zen.workspace.bgalazka.hover_reveal_panel", false) ===
            true;
          this.#state.isExpanded = false;
          document.documentElement.setAttribute(
            "zentral-app-panel-open",
            "true",
          );
          this.setAutohideHovered(true);
          this.#state.preExpandWidth = null;
          if (this.#dom.pinBtn) {
            this.#dom.pinBtn.setAttribute(
              "data-pinned",
              this.#state.isPinned ? "true" : "false",
            );
            this.#dom.pinBtn.title = this.#state.isPinned
              ? "Unpin panel"
              : "Pin panel";
          }
          if (this.#dom.expandBtn) {
            this.#dom.expandBtn.title = "Expand panel";
            this.#dom.expandBtn.replaceChildren(
              this.#createSVG(SVG_STRINGS.EXPAND),
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

          const { browser, isNew } = this.getOrCreateAppBrowser(app);

          for (const [id, b] of this.#state.appBrowsers.entries()) {
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

          const isTopSlide =
            this.isCollapsedLayoutMode() && !this.isPlacementVerticalBar();
          const isFromRight = this.isPanelAttachedToRight();
          const slideFrom = isTopSlide
            ? "translateY(-100%)"
            : isFromRight
              ? "translateX(100%)"
              : "translateX(-100%)";
          this.#dom.panel.style.transition = "none";
          this.#dom.panel.style.transform = slideFrom;
          if (this.#dom.root) {
            this.#dom.root.removeAttribute("closing");
            this.#dom.root.setAttribute("open", "true");
          }
          this.#dom.panel.getBoundingClientRect(); // Reflow

          if (this._openPanelRAF) cancelAnimationFrame(this._openPanelRAF);
          this._openPanelRAF = requestAnimationFrame(() => {
            this._openPanelRAF = null;
            if (this._destroyed || !this.#dom.panel) return;
            const slideMs = Core.getPref(Constants.Apps.PREF_ANIMATION_SPEED);
            const animType = Core.getPref(Constants.Apps.PREF_ANIMATION_TYPE);
            const bezier = this.#getEasingBezier(animType);

            if (animType === "none") {
              this.#dom.panel.style.transition = "none";
            } else {
              this.#dom.panel.style.transition = `transform ${slideMs}ms ${bezier}`;
            }
            this.#dom.panel.style.transform = isTopSlide
              ? "translateY(0)"
              : "translateX(0)";
          });
        }

        closePanel() {
          Core.log("ZentralApps", "closePanel called");
          if (this.#dom.root?.hasAttribute("closing")) return;
          if (!this.#state.activeAppId && !this.#dom.root?.hasAttribute("open"))
            return;

          if (this._openPanelRAF) {
            cancelAnimationFrame(this._openPanelRAF);
            this._openPanelRAF = null;
          }

          if (this.#state.closeTimerId) {
            clearTimeout(this.#state.closeTimerId);
            this.#state.closeTimerId = null;
          }

          if (this.#dom.root) {
            this.#dom.root.setAttribute("closing", "true");
            this.#dom.root.style.pointerEvents = "none";
          }

          this.endInstaPeek();

          if (this.#state.isExpanded) {
            this.#state.isExpanded = false;
            if (this.#state.preExpandWidth) {
              this.#state.panelWidthPx = this.#state.preExpandWidth;
            }
          }
          this.#state.activeAppId = null;
          this.#state.isPinned = false;
          document.documentElement.removeAttribute("zentral-app-panel-open");
          if (this.#dom.grid && !this.#dom.grid.matches(":hover")) {
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
          const bezier = this.#getEasingBezier(animType);

          if (animType === "none" || slideMs <= 0) {
            this.#dom.panel.style.transition = "none";
            this.#dom.panel.style.transform = slideTo;
            if (this.#dom.root) {
              this.#dom.root.removeAttribute("open");
              this.#dom.root.removeAttribute("closing");
              this.#dom.root.style.pointerEvents = "";
            }
            this.stopPositionTracking();
            return;
          }

          this.#dom.panel.style.transition = `transform ${slideMs}ms ${bezier}`;
          this.#dom.panel.style.transform = slideTo;

          this.#state.closeTimerId = setTimeout(() => {
            this.#state.closeTimerId = null;
            if (this.#dom.root) {
              this.#dom.root.removeAttribute("open");
              this.#dom.root.removeAttribute("closing");
              this.#dom.root.style.pointerEvents = "";
            }
            this.stopPositionTracking();
          }, slideMs + 20);
        }

        refreshApp(appId) {
          if (!appId) return;
          const app = this.#state.apps.find((a) => a.id === appId);
          if (!app) return;

          const isPanelOpen =
            this.#dom.root?.hasAttribute("open") &&
            this.#state.activeAppId === appId;
          const existingBrowser = this.#state.appBrowsers.get(appId);

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
        }

        closeApp(appId) {
          if (!appId) return;
          if (this.#state.activeAppId === appId) {
            this.closePanel();
          }
          const browser = this.#state.appBrowsers.get(appId);
          if (browser) {
            try {
              if (browser.webNavigation) {
                browser.webNavigation.stop(Ci.nsIWebNavigation.STOP_ALL);
              }
            } catch (_) {}
            browser.remove();
            this.#state.appBrowsers.delete(appId);
          }
          if (!this.#state.appBrowsers || this.#state.appBrowsers.size === 0) {
            this.stopBadgeSyncLoop();
          }
          const tiles = Array.from(
            document.querySelectorAll(".zen-app-tile[data-app-id]"),
          ).filter((tile) => tile.dataset.appId === appId);
          tiles.forEach((tile) => {
            tile.dataset.loaded = "false";
            tile.querySelector(".zen-app-badge")?.remove();
          });
          const app = this.#state.apps.find((a) => a.id === appId);
          if (app) {
            app.notificationCount = 0;
            app.hasNotification = false;
          }
        }

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
        }

        extractBadgeFromTitle(title) {
          if (!title || typeof title !== "string")
            return { hasNotification: false, notifCount: null };
          const trimmed = title.trim();

          const numMatch =
            trimmed.match(/^\((\d{1,3})\+?\)\s/) ||
            trimmed.match(/^\[(\d{1,3})\+?\]\s/) ||
            trimmed.match(/\b(\d+)\s+unread\b/i) ||
            trimmed.match(
              /\b(?:messages?|notif(?:ication)?s?)\s*[:(]?\s*(\d+)/i,
            ) ||
            trimmed.match(/(?:^|\s)[\u2022\u25cf\u25cb]\s*(\d+)/);

          if (numMatch && numMatch[1]) {
            const count = parseInt(numMatch[1], 10);
            if (!isNaN(count) && count > 0) {
              return { hasNotification: true, notifCount: count };
            }
          }

          const dotPattern =
            /^[\u2022\u25cf\u25cb\u25a0\u25aa\u2219\u2b24]\s|\s[\u2022\u25cf\u25cb\u25a0\u25aa\u2219\u2b24]$/;
          if (dotPattern.test(trimmed)) {
            return { hasNotification: true, notifCount: null };
          }

          return { hasNotification: false, notifCount: null };
        }

        updateAppBadge(appId, hasNotification, notifCount) {
          const btn = document.getElementById("zen-app-btn-" + appId);
          if (!btn) return;
          let badge = btn.querySelector(".zen-app-badge");
          if (hasNotification) {
            if (!badge) {
              badge = document.createElement("div");
              badge.className = "zen-app-badge";
              btn.appendChild(badge);
            }
            if (notifCount) {
              const text = notifCount > 99 ? "99+" : String(notifCount);
              if (badge.textContent !== text) badge.textContent = text;
              if (badge.hasAttribute("data-dot"))
                badge.removeAttribute("data-dot");
            } else {
              if (badge.textContent !== "") badge.textContent = "";
              if (badge.getAttribute("data-dot") !== "true")
                badge.setAttribute("data-dot", "true");
            }
          } else {
            if (badge) badge.remove();
          }
        }

        syncAllAppBadges() {
          if (!this.#state.appBrowsers || this.#state.appBrowsers.size === 0)
            return;
          const appsById = new Map();
          for (const app of this.#state.apps)
            if (!appsById.has(app.id)) appsById.set(app.id, app);
          for (const [appId, browser] of this.#state.appBrowsers.entries()) {
            if (!browser || !browser.isConnected) continue;
            const app = appsById.get(appId);
            if (!app) continue;

            let title = "";
            try {
              title =
                browser.browsingContext?.currentWindowGlobal?.documentTitle ||
                browser.contentTitle ||
                browser.getAttribute("label") ||
                "";
            } catch (_) {
              title =
                browser.contentTitle || browser.getAttribute("label") || "";
            }

            const { hasNotification, notifCount } =
              this.extractBadgeFromTitle(title);
            if (
              app.hasNotification !== hasNotification ||
              app.notificationCount !== notifCount
            ) {
              app.hasNotification = hasNotification;
              app.notificationCount = notifCount;
              this.updateAppBadge(appId, hasNotification, notifCount);
            }
          }
        }

        /**
         * Starts a lightweight polling timer for active background app browsers.
         * Only runs when at least one app browser is loaded (size > 0),
         * ensuring zero idle CPU usage when no apps are open.
         */
        ensureBadgeSyncLoop() {
          if (this._badgeSyncLoopTimer) return;
          this._badgeSyncLoopTimer = setInterval(() => {
            if (
              !this.#state.appBrowsers ||
              this.#state.appBrowsers.size === 0
            ) {
              this.stopBadgeSyncLoop();
              return;
            }
            this.syncAllAppBadges();
          }, 1500);
        }

        /**
         * Stops the background app badge polling timer.
         */
        stopBadgeSyncLoop() {
          if (this._badgeSyncLoopTimer) {
            clearInterval(this._badgeSyncLoopTimer);
            this._badgeSyncLoopTimer = null;
          }
        }

        getOrCreateAppBrowser(app) {
          let b = this.#state.appBrowsers.get(app.id);
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

          const checkAndUpdateBadge = () => {
            let title = "";
            try {
              title =
                b.browsingContext?.currentWindowGlobal?.documentTitle ||
                b.contentTitle ||
                b.getAttribute("label") ||
                "";
            } catch (_) {
              title = b.contentTitle || b.getAttribute("label") || "";
            }
            const { hasNotification, notifCount } =
              this.extractBadgeFromTitle(title);
            if (
              app.hasNotification !== hasNotification ||
              app.notificationCount !== notifCount
            ) {
              app.hasNotification = hasNotification;
              app.notificationCount = notifCount;
              this.updateAppBadge(app.id, hasNotification, notifCount);
            }
          };

          b.addEventListener("pagetitlechanged", checkAndUpdateBadge);
          b.addEventListener("DOMTitleChanged", checkAndUpdateBadge);
          b.addEventListener("load", checkAndUpdateBadge);
          b.addEventListener("pageshow", checkAndUpdateBadge);

          this.#dom.panel.appendChild(b);
          this.#state.appBrowsers.set(app.id, b);
          const matchingTiles = Array.from(
            document.querySelectorAll(".zen-app-tile[data-app-id]"),
          ).filter((tile) => tile.dataset.appId === app.id);
          matchingTiles.forEach((t) => (t.dataset.loaded = "true"));
          this.ensureBadgeSyncLoop();
          return { browser: b, isNew: true };
        }

        startPositionTracking() {
          if (this._isTrackingPosition) return;
          this._isTrackingPosition = true;

          this.positionPanel();

          const reposition = () => {
            if (
              this.#state.activeAppId &&
              this.#dom.root?.hasAttribute("open")
            ) {
              this.positionPanel();
            }
            if (this.isPlacementVerticalBar()) {
              this.updateVerticalBarBounds();
            }
          };

          let rafId = null;
          let lastActivityTime = 0;

          const rafLoop = () => {
            if (!this._isTrackingPosition) return;
            reposition();
            if (
              this._activePositionTransitions?.size ||
              Date.now() - lastActivityTime < 200
            ) {
              rafId = requestAnimationFrame(rafLoop);
            } else {
              rafId = null;
            }
          };

          const triggerBurst = () => {
            if (
              !this.isPlacementVerticalBar() &&
              !this.#dom.root?.hasAttribute("open")
            )
              return;
            lastActivityTime = Date.now();
            if (!rafId) {
              rafId = requestAnimationFrame(rafLoop);
            }
          };

          this._mouseMoveHandler = (e) => {
            const now = Date.now();
            if (now - (this._lastThrottle || 0) > 16) {
              triggerBurst();
              this._lastThrottle = now;
            }
          };
          window.addEventListener("mousemove", this._mouseMoveHandler, {
            passive: true,
          });

          // Track transitions only on positioning anchors or their ancestors.
          // Animated tab icons and other descendants cannot move the panel.
          const transitionTargets = new Set();
          const observeAnchor = (el) => {
            if (!el) return;
            this._sidebarResizeObserver.observe(el);
            for (
              let node = el;
              node && node !== document;
              node = node.parentElement
            ) {
              transitionTargets.add(node);
            }
          };
          this._sidebarResizeObserver = new ResizeObserver(() => {
            reposition();
          });
          const idsToObserve = [
            "sidebar-box",
            "sidebar-container",
            "vertical-tabs",
            "navigator-toolbox",
            "zen-appcontent-navbar-wrapper",
            "nav-bar",
            "TabsToolbar",
            "titlebar",
            "zen-window-controls",
            "titlebar-buttonbox-container",
            "zen-appcontent-wrapper",
            "tabbrowser-tabbox",
            "zentral-apps-vertical-bar",
            "tabbrowser-tabpanels",
            "appcontent",
          ];
          idsToObserve.forEach((id) => {
            const el =
              document.getElementById(id) || document.querySelector("." + id);
            observeAnchor(el);
          });
          observeAnchor(gBrowser?.tabContainer);

          // Follow a relevant transition for its full duration and settle on
          // transitionend or transitioncancel, even if it lasts over 200 ms.
          const activeTransitions = new Map();
          this._globalTransitionHandler = (event) => {
            const target = event.target;
            if (!transitionTargets.has(target)) return;
            const property = event.propertyName;
            // Color and hover effects on an anchor cannot change its geometry.
            if (
              !/^(?:-moz-)?(?:transform|translate|scale|width|height|min-width|min-height|max-width|max-height|inset(?:-.+)?|top|right|bottom|left|margin(?:-.+)?|padding(?:-.+)?|flex-basis|grid-template-(?:columns|rows))$/.test(
                property,
              ) &&
              !(
                property === "opacity" &&
                target.id === "zen-appcontent-navbar-wrapper"
              )
            )
              return;
            if (event.type === "transitionstart") {
              let properties = activeTransitions.get(target);
              if (!properties) {
                properties = new Set();
                activeTransitions.set(target, properties);
              }
              properties.add(property);
            } else {
              const properties = activeTransitions.get(target);
              properties?.delete(property);
              if (properties && !properties.size)
                activeTransitions.delete(target);
            }
            triggerBurst();
          };
          this._activePositionTransitions = activeTransitions;
          for (const type of [
            "transitionstart",
            "transitionend",
            "transitioncancel",
          ]) {
            window.addEventListener(type, this._globalTransitionHandler, {
              passive: true,
            });
          }

          this._docAttrObserver = new MutationObserver((mutations) => {
            reposition();
            triggerBurst();
          });
          this._docAttrObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: [
              "zen-sidebar-expanded",
              "zen-compact-mode",
              "zen-sidebar-hidden",
              "zen-right-side",
              "style",
              "zen-compact-navbar-visible",
            ],
          });

          this._windowResizeListener = reposition;
          window.addEventListener("resize", this._windowResizeListener, {
            passive: true,
          });
        }

        stopPositionTracking() {
          this._isTrackingPosition = false;

          if (this._sidebarResizeObserver) {
            this._sidebarResizeObserver.disconnect();
            this._sidebarResizeObserver = null;
          }
          if (this._docAttrObserver) {
            this._docAttrObserver.disconnect();
            this._docAttrObserver = null;
          }
          if (this._globalTransitionHandler) {
            window.removeEventListener(
              "transitionstart",
              this._globalTransitionHandler,
            );
            window.removeEventListener(
              "transitioncancel",
              this._globalTransitionHandler,
            );
            window.removeEventListener(
              "transitionend",
              this._globalTransitionHandler,
            );
            this._globalTransitionHandler = null;
          }
          this._activePositionTransitions?.clear();
          this._activePositionTransitions = null;
          if (this._mouseMoveHandler) {
            window.removeEventListener("mousemove", this._mouseMoveHandler);
            this._mouseMoveHandler = null;
          }
          if (this._windowResizeListener) {
            window.removeEventListener("resize", this._windowResizeListener);
            this._windowResizeListener = null;
          }
        }

        // Apps Bar panels share the space between BOTH bars. Never measure the
        // pushed tabbox here: its margin depends on the panel width itself.
        getAppsBarPanelBounds() {
          const gap = 12;
          const onRight = this.isVerticalBarOnRight();
          const bar = this.#dom.verticalBar;
          const style = bar ? window.getComputedStyle(bar) : null;
          const autohide =
            document.documentElement.getAttribute("zentral-apps-autohide") ===
            "true";
          // Autohide translates the bar offscreen. Use its untransformed width
          // and CSS inset so revealing it never moves an already-open panel.
          let barInset = 0;
          if (autohide) {
            const inset = parseFloat(onRight ? style?.right : style?.left);
            barInset =
              (bar?.offsetWidth || 44) +
              (Number.isFinite(inset) ? Math.max(0, inset) : 8);
          } else if (bar) {
            const rect = bar.getBoundingClientRect();
            barInset = onRight ? window.innerWidth - rect.left : rect.right;
          }
          if (!Number.isFinite(barInset) || barInset <= 0) barInset = 44;
          const sidebar =
            document.getElementById("sidebar-box") ||
            document.getElementById("sidebar-container") ||
            document.getElementById("vertical-tabs") ||
            gBrowser?.tabContainer;
          const rect = sidebar?.getBoundingClientRect();
          let left = gap;
          let right = window.innerWidth - gap;
          if (onRight) {
            right -= barInset;
            if (rect?.width > 0) left = Math.max(left, rect.right + gap);
          } else {
            left += barInset;
            if (rect?.width > 0) right = Math.min(right, rect.left - gap);
          }
          return { left, right, barInset, autohide };
        }

        getAppsBarPanelMaxWidth() {
          const { left, right } = this.getAppsBarPanelBounds();
          // Keep the outward-growing pill reachable beside the native sidebar.
          return Math.max(1, Math.floor(right - left - 44));
        }

        updateWidthVar(px) {
          if (this.isPlacementVerticalBar())
            px = Math.max(1, Math.min(px, this.getAppsBarPanelMaxWidth()));
          if (this.#state.activeAppId && !this.#state.isExpanded) {
            const app = this.#state.apps.find(
              (a) => a.id === this.#state.activeAppId,
            );
            if (app) app.width = px;
          }
          this.#state.panelWidthPx = px;
          if (this.#dom.root)
            this.#dom.root.style.width = Math.round(px) + "px";
        }

        positionPanel() {
          const root = this.#dom.root;
          if (!root || !gBrowser?.tabContainer) return;
          const tcRect = gBrowser.tabContainer.getBoundingClientRect();
          const gap = 12;

          let sidebarRect = tcRect;
          const sidebarEl =
            document.getElementById("sidebar-box") ||
            document.getElementById("sidebar-container") ||
            document.getElementById("vertical-tabs");
          if (sidebarEl) {
            const sRect = sidebarEl.getBoundingClientRect();
            if (sRect.width > 0 && sRect.height > 0) {
              sidebarRect = sRect;
            }
          }

          const isCollapsed =
            this.isCollapsedSidebar() ||
            (sidebarRect.width > 0 &&
              sidebarRect.width <= Constants.Apps.COLLAPSED_WIDTH_THRESHOLD);
          const sideGap = isCollapsed ? 7 : gap;

          let top = 0;
          let targetLeft = gap;
          let targetRight = gap;

          const panelWidth = this.#state.panelWidthPx || 420;
          let panelLeft = 0;
          let panelRight = window.innerWidth;

          if (this.isPlacementVerticalBar()) {
            const isVbRight = this.isVerticalBarOnRight();
            const bounds = this.getAppsBarPanelBounds();
            // These properties are consumed only by Apps Bar CSS overrides.
            root.style.setProperty(
              "--zentral-appsbar-panel-inset",
              bounds.barInset + gap + "px",
            );
            root.style.setProperty(
              "--zentral-appsbar-edge-inset",
              bounds.barInset + "px",
            );
            document.documentElement.style.setProperty(
              "--zentral-appsbar-push-extra",
              (bounds.autohide ? bounds.barInset : 0) + "px",
            );
            if (panelWidth > this.getAppsBarPanelMaxWidth())
              this.updateWidthVar(this.getAppsBarPanelMaxWidth());

            if (isVbRight) {
              targetRight = window.innerWidth - bounds.right;
              panelRight = window.innerWidth - targetRight;
              panelLeft = panelRight - panelWidth;
            } else {
              targetLeft = bounds.left;
              panelLeft = targetLeft;
              panelRight = panelLeft + panelWidth;
            }
          } else {
            if (
              document.documentElement.getAttribute(
                "bgalazka-edge-attached-panels",
              ) === "true" &&
              document.documentElement.getAttribute(
                "bgalazka-opposite-docking",
              ) !== "true"
            ) {
              const inset = this.isPanelAttachedToRight()
                ? window.innerWidth - sidebarRect.left
                : sidebarRect.right;
              root.style.setProperty(
                "--zentral-sidebar-edge-inset",
                Math.max(0, inset) + "px",
              );
            }
            if (this.isPanelAttachedToRight()) {
              targetRight = Math.max(
                gap,
                Math.round(window.innerWidth - sidebarRect.left) + sideGap,
              );
              panelRight = window.innerWidth - targetRight;
              panelLeft = panelRight - panelWidth;
            } else {
              targetLeft = Math.max(
                gap,
                Math.round(sidebarRect.right) + sideGap,
              );
              panelLeft = targetLeft;
              panelRight = panelLeft + panelWidth;
            }
          }

          try {
            let maxBottom = 0;
            const contentBox =
              document.getElementById("tabbrowser-tabbox") ||
              document.getElementById("tabbrowser-tabpanels") ||
              gBrowser?.selectedBrowser ||
              document.getElementById("appcontent");
            if (contentBox) {
              const cRect = contentBox.getBoundingClientRect();
              if (cRect.top > 0 && cRect.top < 200) {
                maxBottom = Math.max(maxBottom, cRect.top);
              }
            }

            const floatingNavbar = document.getElementById(
              "zen-appcontent-navbar-wrapper",
            );
            if (floatingNavbar) {
              const cs = window.getComputedStyle(floatingNavbar);
              if (
                cs.display !== "none" &&
                cs.visibility !== "hidden" &&
                parseFloat(cs.opacity || "1") > 0.1
              ) {
                const navRect = floatingNavbar.getBoundingClientRect();
                if (
                  navRect.height > 0 &&
                  navRect.bottom > 0 &&
                  navRect.bottom < 200
                ) {
                  maxBottom = Math.max(maxBottom, navRect.bottom);
                }
              }
            }

            top = Math.max(gap, Math.round(maxBottom));
          } catch (e) {}

          root.style.top = top + "px";
          root.style.bottom = gap + "px";

          if (this.isPanelAttachedToRight()) {
            root.style.left = "auto";
            root.style.right = targetRight + "px";
            root.style.transform = "translateX(0)";
            root.setAttribute("data-panel-side", "right");
          } else {
            root.style.right = "auto";
            root.style.left = targetLeft + "px";
            root.style.transform = "translateX(0)";
            root.setAttribute("data-panel-side", "left");
          }
        }

        updateVerticalBarBounds() {
          const vb = this.#dom.verticalBar;
          if (!vb || !this.isPlacementVerticalBar()) return;

          const gap = 12;
          let top = gap;

          try {
            let maxBottom = 0;
            const contentBox =
              document.getElementById("tabbrowser-tabbox") ||
              document.getElementById("tabbrowser-tabpanels") ||
              gBrowser?.selectedBrowser ||
              document.getElementById("appcontent");
            if (contentBox) {
              const cRect = contentBox.getBoundingClientRect();
              if (cRect.top > 0 && cRect.top < 200) {
                maxBottom = Math.max(maxBottom, cRect.top);
              }
            }

            const floatingNavbar = document.getElementById(
              "zen-appcontent-navbar-wrapper",
            );
            if (floatingNavbar) {
              const cs = window.getComputedStyle(floatingNavbar);
              if (
                cs.display !== "none" &&
                cs.visibility !== "hidden" &&
                parseFloat(cs.opacity || "1") > 0.1
              ) {
                const navRect = floatingNavbar.getBoundingClientRect();
                if (
                  navRect.height > 0 &&
                  navRect.bottom > 0 &&
                  navRect.bottom < 200
                ) {
                  maxBottom = Math.max(maxBottom, navRect.bottom);
                }
              }
            }

            top = Math.max(gap, Math.round(maxBottom));
          } catch (e) {}

          const isAutohide =
            Core.getPref(Constants.Apps.PREF_AUTOHIDE, false) === true;
          if (isAutohide) {
            vb.style.top = top + "px";
            vb.style.bottom = gap + "px";
            vb.style.marginTop = "";
            vb.style.height = "";
            vb.style.maxHeight = "";
          } else {
            vb.style.top = "";
            vb.style.bottom = "";
            vb.style.marginTop = "";
            vb.style.height = "";
            vb.style.maxHeight = "";
          }
          if (this.#dom.verticalBarTrigger) {
            this.#dom.verticalBarTrigger.style.top = top + "px";
            this.#dom.verticalBarTrigger.style.bottom = gap + "px";
          }

          this.syncVerticalBarTheme();
          this.updateVerticalBarAddBtnPlacement();
        }

        updateVerticalBarAddBtnPlacement() {
          if (!this.isPlacementVerticalBar() || !this.#dom.verticalBar) return;
          const vb = this.#dom.verticalBar;
          const grid = this.#dom.grid;
          const scrollBox = this.#dom.scrollBox;
          const footer = document.getElementById(
            "zentral-apps-vertical-bar-footer",
          );
          const addBtn = document.querySelector(
            "#zentral-apps-vertical-bar .zen-app-add-btn",
          );
          if (!addBtn || !footer || !grid) return;

          const vbHeight = vb.clientHeight;
          const effectiveVbHeight =
            vbHeight > 0 ? vbHeight : window.innerHeight - 60;

          const activeAppsCount = scrollBox
            ? scrollBox.querySelectorAll(
                ".zen-app-tile:not(.zen-app-add-btn):not(.zen-app-vb-footer-btn)",
              ).length
            : 0;
          const footerBaseHeight = 82;
          const itemHeight = 42;
          const requiredHeight =
            (activeAppsCount + 1) * itemHeight + footerBaseHeight + 16;

          const autohideBtn = footer.querySelector(
            "#zentral-apps-vb-autohide-btn",
          );

          if (requiredHeight > effectiveVbHeight) {
            if (addBtn.parentElement !== footer) {
              if (autohideBtn) {
                footer.insertBefore(addBtn, autohideBtn);
              } else {
                footer.prepend(addBtn);
              }
            }
          } else {
            const targetContainer = scrollBox || grid;
            if (addBtn.parentElement !== targetContainer) {
              targetContainer.appendChild(addBtn);
            }
          }
        }

        _debouncedSyncTheme(delay = 32) {
          if (this._syncThemeTimer) clearTimeout(this._syncThemeTimer);
          this._syncThemeTimer = setTimeout(() => {
            this._syncThemeTimer = null;
            this.syncVerticalBarTheme();
          }, delay);
        }

        syncVerticalBarTheme() {
          const vb = this.#dom.verticalBar;
          if (!vb) return;

          const isAutohide =
            Core.getPref(Constants.Apps.PREF_AUTOHIDE, false) === true;
          let bgEl = vb.querySelector("#zentral-apps-vertical-bar-bg");
          if (!bgEl && isAutohide) {
            bgEl = document.createElement("div");
            bgEl.id = "zentral-apps-vertical-bar-bg";
            bgEl.className =
              "zen-toolbar-background zen-browser-generic-background";
            const grain = document.createElement("div");
            grain.className = "zen-browser-grain";
            bgEl.appendChild(grain);
            vb.insertBefore(bgEl, vb.firstChild);
          }

          if (!isAutohide) {
            if (bgEl) bgEl.style.display = "none";
            vb.style.removeProperty("--zen-theme-gradient-override");
            return;
          }
          if (bgEl) bgEl.style.display = "flex";

          const isRight = this.isVerticalBarOnRight();
          bgEl.style.setProperty(
            "--zentral-vb-side",
            isRight ? "right" : "left",
          );

          const zenTb = document.getElementById("zen-toolbar-background");
          const zenBb = document.getElementById("zen-browser-background");

          let tbGrad = "";
          let grainOpacity = "";
          let bgOpacity = "";

          if (zenTb) {
            tbGrad =
              zenTb.style.getPropertyValue(
                "--zen-main-browser-background-toolbar",
              ) || "";
            const tbOldGrad =
              zenTb.style.getPropertyValue(
                "--zen-main-browser-background-toolbar-old",
              ) || "";
            grainOpacity =
              zenTb.style.getPropertyValue("--zen-grainy-background-opacity") ||
              "";
            bgOpacity =
              zenTb.style.getPropertyValue("--zen-background-opacity") || "";

            if (
              tbGrad &&
              tbGrad !== "none" &&
              !tbGrad.startsWith("light-dark")
            ) {
              bgEl.style.setProperty(
                "--zen-main-browser-background-toolbar",
                tbGrad,
              );
            }
            if (
              tbOldGrad &&
              tbOldGrad !== "none" &&
              !tbOldGrad.startsWith("light-dark")
            ) {
              bgEl.style.setProperty(
                "--zen-main-browser-background-toolbar-old",
                tbOldGrad,
              );
            }
            if (grainOpacity)
              bgEl.style.setProperty(
                "--zen-grainy-background-opacity",
                grainOpacity,
              );
            if (bgOpacity)
              bgEl.style.setProperty("--zen-background-opacity", bgOpacity);

            const showGrain = zenTb.getAttribute("zen-show-grainy-background");
            if (showGrain) {
              bgEl.setAttribute("zen-show-grainy-background", showGrain);
            }
          }

          if (
            (!tbGrad || tbGrad === "none" || tbGrad.startsWith("light-dark")) &&
            zenBb
          ) {
            const bbGrad =
              zenBb.style.getPropertyValue("--zen-main-browser-background") ||
              "";
            const bbOldGrad =
              zenBb.style.getPropertyValue(
                "--zen-main-browser-background-old",
              ) || "";
            grainOpacity =
              grainOpacity ||
              zenBb.style.getPropertyValue("--zen-grainy-background-opacity") ||
              "";
            bgOpacity =
              bgOpacity ||
              zenBb.style.getPropertyValue("--zen-background-opacity") ||
              "";

            if (
              bbGrad &&
              bbGrad !== "none" &&
              !bbGrad.startsWith("light-dark")
            ) {
              tbGrad = bbGrad;
              bgEl.style.setProperty(
                "--zen-main-browser-background-toolbar",
                bbGrad,
              );
            }
            if (
              bbOldGrad &&
              bbOldGrad !== "none" &&
              !bbOldGrad.startsWith("light-dark")
            ) {
              bgEl.style.setProperty(
                "--zen-main-browser-background-toolbar-old",
                bbOldGrad,
              );
            }
            if (grainOpacity)
              bgEl.style.setProperty(
                "--zen-grainy-background-opacity",
                grainOpacity,
              );
            if (bgOpacity)
              bgEl.style.setProperty("--zen-background-opacity", bgOpacity);

            const showGrain = zenBb.getAttribute("zen-show-grainy-background");
            if (showGrain) {
              bgEl.setAttribute("zen-show-grainy-background", showGrain);
            }
          }

          if (!tbGrad || tbGrad === "none" || tbGrad.startsWith("light-dark")) {
            if (
              window.gZenThemePicker &&
              typeof window.gZenThemePicker.getGradient === "function"
            ) {
              try {
                const ws = window.gZenWorkspaces?.getActiveWorkspace?.();
                const theme = ws?.theme;
                if (theme?.gradientColors?.length) {
                  const grad =
                    window.gZenThemePicker.getGradient(
                      theme.gradientColors,
                      true,
                    ) ||
                    window.gZenThemePicker.getGradient(
                      theme.gradientColors,
                      false,
                    );
                  if (grad) {
                    tbGrad = grad;
                    bgEl.style.setProperty(
                      "--zen-main-browser-background-toolbar",
                      grad,
                    );
                  }
                  if (theme.texture !== undefined) {
                    bgEl.style.setProperty(
                      "--zen-grainy-background-opacity",
                      theme.texture,
                    );
                    bgEl.setAttribute(
                      "zen-show-grainy-background",
                      theme.texture > 0 ? "true" : "false",
                    );
                  }
                }
              } catch (_) {}
            }
          }

          vb.style.removeProperty("--zen-theme-gradient-override");
        }

        togglePin() {
          this.#state.isPinned = !this.#state.isPinned;
          Core.log(
            "ZentralApps",
            "togglePin - isPinned:",
            this.#state.isPinned,
          );
          if (this.#dom.pinBtn) {
            this.#dom.pinBtn.setAttribute(
              "data-pinned",
              this.#state.isPinned ? "true" : "false",
            );
            this.#dom.pinBtn.title = this.#state.isPinned
              ? "Unpin panel"
              : "Pin panel";
          }
        }

        toggleExpand() {
          Core.log(
            "ZentralApps",
            "toggleExpand - current isExpanded:",
            this.#state.isExpanded,
          );
          if (!this.#state.isExpanded) {
            this.#state.preExpandWidth =
              this.#state.panelWidthPx || this.loadWidth();

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

            this.#state.isExpanded = true;
            this.updateWidthVar(fullWidth);

            if (this.#dom.expandBtn) {
              this.#dom.expandBtn.title = "Restore panel";
              this.#dom.expandBtn.replaceChildren(
                this.#createSVG(SVG_STRINGS.COLLAPSE),
              );
            }
          } else {
            const restoreW = this.#state.preExpandWidth || this.loadWidth();
            this.#state.isExpanded = false;
            this.updateWidthVar(restoreW);

            if (this.#dom.expandBtn) {
              this.#dom.expandBtn.title = "Expand panel";
              this.#dom.expandBtn.replaceChildren(
                this.#createSVG(SVG_STRINGS.EXPAND),
              );
            }
          }
        }

        startResize(e) {
          if (e.button !== 0) return;
          e.preventDefault();
          this._startX = e.clientX;
          const app = this.#state.apps.find(
            (a) => a.id === this.#state.activeAppId,
          );
          this._startW =
            this.#dom.root?.getBoundingClientRect().width ||
            app?.width ||
            this.loadWidth();
          if (this.#dom.panel) this.#dom.panel.style.pointerEvents = "none";
          document.addEventListener("mousemove", this.onDrag);
          document.addEventListener("mouseup", this.onStopDrag);
        }

        prepareResize() {
          if (!this.#state.isExpanded) return;
          this.#state.isExpanded = false;
          if (this.#dom.expandBtn) {
            this.#dom.expandBtn.title = "Expand panel";
            this.#dom.expandBtn.replaceChildren(
              this.#createSVG(SVG_STRINGS.EXPAND),
            );
          }
        }

        onDrag(e) {
          this.prepareResize();
          const diff = e.clientX - this._startX;
          let newW = this.isPanelAttachedToRight()
            ? this._startW - diff
            : this._startW + diff;
          newW = Math.max(
            Constants.Apps.MIN_WIDTH_PX,
            Math.min(newW, window.innerWidth * Constants.Apps.MAX_WIDTH_RATIO),
          );
          this.updateWidthVar(newW);
        }

        onStopDrag() {
          document.removeEventListener("mousemove", this.onDrag);
          document.removeEventListener("mouseup", this.onStopDrag);
          if (this.#dom.panel) this.#dom.panel.style.pointerEvents = "";
          this.saveWidth(this.#state.panelWidthPx);
        }

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
              const app = this.#state.apps.find((a) => a.id === appId);
              const isLoaded = this.#state.appBrowsers.has(appId);
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
                this.#state.appBrowsers.has(popup.dataset.activeAppId)
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
                const app = this.#state.apps.find(
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
        }

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
        }

        handleOutsideClick(e) {
          if (
            !this.#state.activeAppId ||
            this.#state.isPinned ||
            this.#state.isInstaPeeking
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
        }

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
        }

        handleInstaPeekKeyDown(e) {
          const shortcut = Core.getPref(
            Constants.Apps.PREF_INSTA_PEEK_SHORTCUT,
            "Alt+Q",
          );
          if (!shortcut || shortcut === "None") return;

          if (!this.#state.activeAppId || !this.#dom.root?.hasAttribute("open"))
            return;

          if (this.isShortcutMatch(e, shortcut)) {
            e.preventDefault();
            e.stopPropagation();

            if (!this.#state.isInstaPeeking) {
              this.#state.isInstaPeeking = true;
              if (this.#dom.root) {
                this.#dom.root.setAttribute("data-insta-peek", "true");
              }
            }
          }
        }

        handleInstaPeekKeyUp(e) {
          if (!this.#state.isInstaPeeking) return;

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
        }

        handleInstaPeekBlur() {
          if (this.#state.isInstaPeeking) {
            this.endInstaPeek();
          }
        }

        endInstaPeek() {
          if (this.#state.isInstaPeeking) {
            this.#state.isInstaPeeking = false;
            if (this.#dom.root) {
              this.#dom.root.removeAttribute("data-insta-peek");
            }
          }
        }

        scheduleRepositionGrid(delay = 120) {
          if (this.#state.repositionTimer)
            clearTimeout(this.#state.repositionTimer);
          this.#state.repositionTimer = setTimeout(() => {
            this.#state.repositionTimer = null;
            this.repositionGrid();
          }, delay);
        }

        repositionGrid() {
          const grid = this.#dom.grid;
          if (!grid) return;
          try {
            const placement = Core.getPref(
              Constants.Apps.PREF_PLACEMENT,
              "sidebar",
            );
            const isVerticalBar = placement === "vertical-bar";
            const shouldUseToolbar = this.isPhysicallySidebarCollapsed();

            document.documentElement.setAttribute(
              "zentral-apps-placement",
              placement,
            );

            if (isVerticalBar) {
              grid.classList.remove("zen-apps-horizontal");
              grid.style.order = "initial";

              const vb = this.#dom.verticalBar;
              if (vb) {
                if (grid.parentNode !== vb) {
                  if (
                    this.#dom.vbFooter &&
                    this.#dom.vbFooter.parentNode === vb
                  ) {
                    vb.insertBefore(grid, this.#dom.vbFooter);
                  } else {
                    vb.appendChild(grid);
                  }
                }
                if (
                  this.#dom.vbFooter &&
                  this.#dom.vbFooter.parentNode !== vb
                ) {
                  vb.appendChild(this.#dom.vbFooter);
                }

                const browserEl =
                  document.getElementById("browser") ||
                  document.body ||
                  document.documentElement;
                const isRightSidebar = this.isSidebarRight();

                if (isRightSidebar) {
                  if (
                    vb.parentNode !== browserEl ||
                    browserEl.firstChild !== vb
                  ) {
                    browserEl.insertBefore(vb, browserEl.firstChild);
                  }
                } else {
                  if (vb.parentNode !== browserEl || vb.nextSibling !== null) {
                    browserEl.appendChild(vb);
                  }
                }
                vb.style.display = "flex";
                this.updateVerticalBarBounds();
              }
              Core.log(
                "ZentralApps",
                "repositionGrid: Vertical Bar mode placed on opposite edge.",
              );
            } else {
              if (this.#dom.verticalBar) {
                this.#dom.verticalBar.style.display = "none";
                this.#dom.verticalBar.removeAttribute("data-revealed");
              }
              if (this.#dom.verticalBarTrigger) {
                this.#dom.verticalBarTrigger.style.display = "none";
              }

              if (shouldUseToolbar) {
                const bookmarksContainer =
                  document.getElementById("personal-bookmarks") ||
                  document.getElementById("PlacesToolbarItems");
                const topToolbar =
                  document.getElementById("nav-bar-customization-target") ||
                  document.getElementById("nav-bar");

                grid.classList.add("zen-apps-horizontal");
                grid.style.order = "initial";
                if (
                  this.#dom.utilitySection &&
                  this.#dom.utilitySection.parentNode === grid
                ) {
                  grid.appendChild(this.#dom.utilitySection);
                }
                Core.log(
                  "ZentralApps",
                  "repositionGrid: Collapsed/Compact mode → grid placed in toolbar.",
                );

                if (bookmarksContainer && bookmarksContainer.parentNode) {
                  const targetParent = bookmarksContainer.parentNode;
                  if (
                    grid.parentNode !== targetParent ||
                    grid.previousSibling !== bookmarksContainer
                  ) {
                    targetParent.insertBefore(
                      grid,
                      bookmarksContainer.nextSibling,
                    );
                  }
                } else if (topToolbar) {
                  const targetBtn =
                    document.getElementById("unified-extensions-button") ||
                    document.getElementById("PanelUI-button");
                  if (targetBtn && targetBtn.parentNode) {
                    if (grid.nextSibling !== targetBtn)
                      targetBtn.parentNode.insertBefore(grid, targetBtn);
                  } else if (grid.parentNode !== topToolbar) {
                    topToolbar.appendChild(grid);
                  }
                }
              } else {
                grid.classList.remove("zen-apps-horizontal");
                if (
                  this.#dom.utilitySection &&
                  this.#dom.utilitySection.parentNode === grid
                ) {
                  if (grid.firstChild !== this.#dom.utilitySection) {
                    grid.insertBefore(
                      this.#dom.utilitySection,
                      grid.firstChild,
                    );
                  }
                }
                const sidebarContainer = gBrowser?.tabContainer?.parentNode;
                if (sidebarContainer) {
                  if (
                    grid.parentNode !== sidebarContainer ||
                    grid.nextSibling !== gBrowser.tabContainer
                  ) {
                    sidebarContainer.insertBefore(grid, gBrowser.tabContainer);
                  }
                  grid.style.order = "-1";
                }
                Core.log(
                  "ZentralApps",
                  "repositionGrid: Expanded sidebar mode → grid placed in sidebar.",
                );
              }
            }
            this.updateScrollMask();
          } catch (e) {
            console.warn("[ZentralApps] Failed to reposition grid", e);
          }
        }

        setupObservers() {
          const menu = document.getElementById("tabContextMenu");
          if (menu && !document.getElementById("context_zenAppsSidebarAdd")) {
            let menuItem;
            if (window.MozXULElement?.parseXULToFragment) {
              const frag = window.MozXULElement.parseXULToFragment(
                `<menuseparator id="context_zenAppsSidebarAdd_sep"/><menuitem id="context_zenAppsSidebarAdd" label="Add to Apps Section"/>`,
              );
              menu.appendChild(frag);
              menuItem = document.getElementById("context_zenAppsSidebarAdd");
            } else {
              const sep = document.createXULElement("menuseparator");
              sep.id = "context_zenAppsSidebarAdd_sep";
              menuItem = document.createXULElement("menuitem");
              menuItem.id = "context_zenAppsSidebarAdd";
              menuItem.setAttribute("label", "Add to Apps Section");
              menu.appendChild(sep);
              menu.appendChild(menuItem);
            }
            if (menuItem) {
              this.#tabContextMenu = menu;
              this.#tabContextPopupHandler = () => {
                menuItem.disabled =
                  this.#state.apps.length >=
                  Core.getPref(Constants.Apps.PREF_MAX_APPS);
              };
              menu.addEventListener(
                "popupshowing",
                this.#tabContextPopupHandler,
              );
              menuItem.addEventListener(
                "command",
                this.handleTabContextMenuCommand,
              );
            }
          }

          window.addEventListener("mousedown", this.handleOutsideClick);
          window.addEventListener("keydown", this.handleInstaPeekKeyDown, true);
          window.addEventListener("keyup", this.handleInstaPeekKeyUp, true);
          window.addEventListener("blur", this.handleInstaPeekBlur);

          this.#tabSelectListener = () => {
            const currentWs = window.gZenWorkspaces?.activeWorkspace;
            if (this.#state.lastWorkspaceId !== currentWs) {
              this.#state.lastWorkspaceId = currentWs;
              this.renderGrid();
            }
          };
          window.addEventListener("TabSelect", this.#tabSelectListener);

          this.#workspaceSwitchListener = () => {
            const currentWs = window.gZenWorkspaces?.activeWorkspace;
            this.#state.lastWorkspaceId = currentWs;
            this.renderGrid();
            if (this.#dom.verticalBar) {
              this.#dom.verticalBar.style.removeProperty(
                "--zen-theme-gradient-override",
              );
            }
            this._debouncedSyncTheme(600);
          };
          window.addEventListener(
            "zen-workspace-switched",
            this.#workspaceSwitchListener,
          );
          window.addEventListener(
            "zen-workspace-changed",
            this.#workspaceSwitchListener,
          );
          window.addEventListener(
            "zen-workspaces-change",
            this.#workspaceSwitchListener,
          );

          this.#sideObserver = new window.MutationObserver((mutations) => {
            for (const m of mutations) {
              if (m.attributeName === "zen-right-side") {
                this.repositionGrid();
                this.renderGrid();
                if (
                  this.#state.activeAppId &&
                  this.#dom.root?.hasAttribute("open")
                )
                  this.positionPanel();
              }
              if (
                m.attributeName === "zen-sidebar-collapsed" ||
                m.attributeName === "zen-compact-mode" ||
                m.attributeName === "zen-sidebar-expanded"
              ) {
                Core.log(
                  "ZentralApps",
                  "layout attribute changed → triggering repositionGrid",
                );
                this.scheduleRepositionGrid(80);
              }
              if (
                m.attributeName === "style" ||
                m.attributeName === "zen-compact-mode"
              ) {
                this.syncVerticalBarTheme();
                this.updateVerticalBarBounds();
              }
            }
          });
          this.#sideObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: [
              "zen-right-side",
              "zen-sidebar-collapsed",
              "zen-compact-mode",
              "zen-sidebar-expanded",
              "zen-sidebar-hidden",
              "style",
            ],
          });

          const toolboxEl = document.getElementById("navigator-toolbox");
          if (toolboxEl) {
            this.#toolboxThemeObserver = new window.MutationObserver(() => {
              this.syncVerticalBarTheme();
            });
            this.#toolboxThemeObserver.observe(toolboxEl, {
              attributes: true,
              attributeFilter: ["style", "class"],
            });
          }

          const zenToolbarBg =
            document.getElementById("zen-toolbar-background") ||
            document.querySelector(".zen-toolbar-background");
          const zenBrowserBg = document.getElementById(
            "zen-browser-background",
          );
          const bgElements = [zenToolbarBg, zenBrowserBg].filter(Boolean);
          if (bgElements.length > 0) {
            this.#toolbarBgObserver = new window.MutationObserver(() => {
              this._debouncedSyncTheme(80);
            });
            bgElements.forEach((el) => {
              this.#toolbarBgObserver.observe(el, {
                attributes: true,
                attributeFilter: ["style", "class"],
                childList: true,
              });
              const onThemeAnimation = () => this._debouncedSyncTheme();
              el.addEventListener("transitionend", onThemeAnimation, {
                passive: true,
              });
              el.addEventListener("animationend", onThemeAnimation, {
                passive: true,
              });
              this.#toolbarBgListeners.push(
                [el, "transitionend", onThemeAnimation],
                [el, "animationend", onThemeAnimation],
              );
            });
          }

          this.#layoutObserver = (subject, topic, data) => {
            if (
              data === "zen.view.use-single-toolbar" ||
              data === "zen.view.sidebar-expanded"
            ) {
              this.scheduleRepositionGrid(150);
            }
          };
          Services.prefs.addObserver(
            "zen.view.use-single-toolbar",
            this.#layoutObserver,
            false,
          );
          Services.prefs.addObserver(
            "zen.view.sidebar-expanded",
            this.#layoutObserver,
            false,
          );

          const sidebarBox =
            document.getElementById("tabbrowser-tabbox") ||
            document.getElementById("sidebar-box") ||
            document.getElementById("sidebar-container");
          if (sidebarBox && typeof ResizeObserver !== "undefined") {
            let lastWidth = sidebarBox.getBoundingClientRect().width;
            this.#resizeObs = new ResizeObserver((entries) => {
              const newWidth =
                entries[0]?.contentRect?.width ??
                sidebarBox.getBoundingClientRect().width;
              const crossedThreshold =
                (lastWidth >= Constants.Apps.COLLAPSED_WIDTH_THRESHOLD &&
                  newWidth < Constants.Apps.COLLAPSED_WIDTH_THRESHOLD) ||
                (lastWidth < Constants.Apps.COLLAPSED_WIDTH_THRESHOLD &&
                  newWidth >= Constants.Apps.COLLAPSED_WIDTH_THRESHOLD);
              lastWidth = newWidth;
              if (crossedThreshold) {
                Core.log(
                  "ZentralApps",
                  "Sidebar width crossed threshold (",
                  newWidth,
                  "px) → repositionGrid",
                );
                this.scheduleRepositionGrid(80);
              }
            });
            this.#resizeObs.observe(sidebarBox);
          }

          window.addEventListener(
            "unload",
            () => {
              try {
                Services.prefs.removeObserver(
                  "zen.view.sidebar-expanded",
                  this.#layoutObserver,
                );
              } catch (_) {}
              this.stopPositionTracking();
            },
            { once: true },
          );

          this.scheduleRepositionGrid(200);
        }
      }
      const instance = new ZentralApps();
      window.Zentral.Apps = instance;
      const availableAtStart = !!Core.getPref(Constants.Apps.PREF_ENABLED);
      let started = false,
        disposed = false,
        watching = false;
      const onEnabled = () => {
        if (disposed || started || !!!Core.getPref(Constants.Apps.PREF_ENABLED))
          return;
        try {
          instance.init();
          started = true;
          runtime.setAvailable("apps", true);
        } catch (error) {
          try {
            instance.destroy();
          } catch (_) {}
          runtime.failFeature("apps", error);
        }
        if (watching) {
          Services.prefs.removeObserver(Constants.Apps.PREF_ENABLED, onEnabled);
          watching = false;
        }
      };
      try {
        if (availableAtStart) {
          instance.init();
          started = true;
        } else {
          runtime.setAvailable("apps", false);
          Services.prefs.addObserver(Constants.Apps.PREF_ENABLED, onEnabled);
          watching = true;
        }
      } catch (error) {
        try {
          instance.destroy();
        } catch (_) {}
        delete window.Zentral.Apps;
        throw error;
      }
      return () => {
        disposed = true;
        if (watching) {
          Services.prefs.removeObserver(Constants.Apps.PREF_ENABLED, onEnabled);
          watching = false;
        }
        instance.destroy();
        delete window.Zentral.Apps;
      };
    },
  });
})();
