/*
 * ZENTRAL FILE GUIDE - features/apps/ZentralApps.uc.js
 *
 * Purpose: Owns the Apps class, private app/browser/DOM state, construction, enable transitions, observer
 *   setup and teardown; installs controller methods on the same owner instance.
 * Interaction / execution: Runtime activates apps. Constructor installs method factories with live
 *   private-state getter/setter accessors; Panels later wraps public Apps methods. Controllers call peer
 *   methods through this.
 * Ownership / failure: destroy() owns controller timers/observers/listeners and app browser removal. Method
 *   factories are required Apps internals, not standalone optional features. Do not spread accessor values
 *   into snapshots.
 * Registration: apps
 * Loaded/created by: core/ZentralCatalog.js
 * Direct local resource paths: features/apps/styles/ZentralAppsInjected.css; features/apps/controllers/ZentralAppModel.js;
 *   features/apps/controllers/ZentralAppNotifications.js; features/apps/controllers/ZentralAppsInteractions.js; features/apps/controllers/ZentralAppsLauncher.js;
 *   features/apps/controllers/ZentralLibraryCompatibility.js; features/apps/controllers/ZentralPanelLifecycle.js;
 *   features/apps/controllers/ZentralPanelPosition.js
 * Constructed factory IDs: apps/ZentralAppModel; apps/ZentralAppNotifications;
 *   apps/ZentralAppsInteractions; apps/ZentralAppsLauncher; apps/ZentralLibraryCompatibility;
 *   apps/ZentralPanelLifecycle; apps/ZentralPanelPosition
 * Cross-file calls / ctx suppliers: features/apps/controllers/ZentralAppModel.js -> loadApps, loadUtilityOrder;
 *   features/apps/controllers/ZentralAppNotifications.js -> stopBadgeSyncLoop; features/apps/controllers/ZentralAppsInteractions.js ->
 *   setupContextMenu; features/apps/controllers/ZentralAppsLauncher.js -> _debouncedSyncTheme, applyHideUtilitySectionPref,
 *   createContainers, renderGrid, repositionGrid, syncVerticalBarTheme, updateAutohideState,
 *   updateVerticalBarBounds; features/apps/controllers/ZentralLibraryCompatibility.js -> destroyLibraryPanelGuard,
 *   setupLibraryPanelGuard, syncLibraryPanelGuard; features/apps/controllers/ZentralPanelLifecycle.js -> closeApp,
 *   closePanel, scheduleAutomaticPreloads; features/apps/controllers/ZentralPanelPosition.js -> isPlacementVerticalBar,
 *   positionPanel, scheduleRepositionGrid, stopPositionTracking
 * Literal DOM event subscriptions: TabSelect; animationend; blur; command; keydown; keyup; mousedown;
 *   popupshowing; transitionend; unload; zen-workspace-changed; zen-workspace-switched;
 *   zen-workspaces-change
 *
 * Drag teardown dependency: ZentralPanelPosition.onStopDrag removes blur/mouse tracking and restores panel input.
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime;
  window.ZentralModuleLoader.load("features/apps/controllers/ZentralAppModel.js", { owner: "apps" });
  window.ZentralModuleLoader.load("features/apps/controllers/ZentralAppsLauncher.js", { owner: "apps" });
  window.ZentralModuleLoader.load("features/apps/controllers/ZentralPanelLifecycle.js", { owner: "apps" });
  window.ZentralModuleLoader.load("features/apps/controllers/ZentralPanelPosition.js", { owner: "apps" });
  window.ZentralModuleLoader.load("features/apps/controllers/ZentralAppNotifications.js", { owner: "apps" });
  window.ZentralModuleLoader.load("features/apps/controllers/ZentralAppsInteractions.js", { owner: "apps" });
  window.ZentralModuleLoader.load("features/apps/controllers/ZentralLibraryCompatibility.js", { owner: "apps" });
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
        #badgePollingObserver = null;
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
        #libraryGuardObserver = null;
        #libraryGuardPrefObserver = null;
        #libraryGuardAPI = null;
        #libraryGuardOriginalAnimation = null;
        #libraryGuardAnimation = null;
        #libraryGuardStyle = null;
        #libraryYieldingToPanel = false;

        /**
         * Module tear down for Sine hot unloading
         */
        destroy() {
          try {
            Core.log("ZentralApps", "Destroying Apps module...");

            this.destroyLibraryPanelGuard();

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
            this.onStopDrag();
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
            if (this.#badgePollingObserver) {
              Services.prefs.removeObserver("zen.workspace.apps.sidebar.badge_poll_interval_ms", this.#badgePollingObserver);
              this.#badgePollingObserver = null;
            }
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
          const owner = this;
          Object.assign(this, window.ZentralModuleLoader.create("apps/ZentralAppModel", { Services, shared, runtime, access: { get state() { return owner.#state; }, set state(value) { owner.#state = value; } } }));
          Object.assign(this, window.ZentralModuleLoader.create("apps/ZentralAppsLauncher", { Services, shared, runtime, access: { createSVG: (...args) => owner.#createSVG(...args), get dom() { return owner.#dom; }, set dom(value) { owner.#dom = value; }, get gridResizeObs() { return owner.#gridResizeObs; }, set gridResizeObs(value) { owner.#gridResizeObs = value; }, get pillHoverZoneResizeObs() { return owner.#pillHoverZoneResizeObs; }, set pillHoverZoneResizeObs(value) { owner.#pillHoverZoneResizeObs = value; }, get state() { return owner.#state; }, set state(value) { owner.#state = value; } } }));
          Object.assign(this, window.ZentralModuleLoader.create("apps/ZentralPanelLifecycle", { Services, shared, runtime, access: { get dom() { return owner.#dom; }, set dom(value) { owner.#dom = value; }, get state() { return owner.#state; }, set state(value) { owner.#state = value; }, createSVG: (...args) => owner.#createSVG(...args), getEasingBezier: (...args) => owner.#getEasingBezier(...args) } }));
          Object.assign(this, window.ZentralModuleLoader.create("apps/ZentralPanelPosition", { Services, shared, runtime, access: { createSVG: (...args) => owner.#createSVG(...args), get dom() { return owner.#dom; }, set dom(value) { owner.#dom = value; }, get state() { return owner.#state; }, set state(value) { owner.#state = value; } } }));
          Object.assign(this, window.ZentralModuleLoader.create("apps/ZentralAppNotifications", { Services, shared, runtime, access: { get badgePollingObserver() { return owner.#badgePollingObserver; }, set badgePollingObserver(value) { owner.#badgePollingObserver = value; }, get state() { return owner.#state; }, set state(value) { owner.#state = value; } } }));
          Object.assign(this, window.ZentralModuleLoader.create("apps/ZentralAppsInteractions", { Services, shared, runtime, access: { get state() { return owner.#state; }, set state(value) { owner.#state = value; }, get dom() { return owner.#dom; }, set dom(value) { owner.#dom = value; } } }));
          Object.assign(this, window.ZentralModuleLoader.create("apps/ZentralLibraryCompatibility", { Services, shared, runtime, access: { get dom() { return owner.#dom; }, set dom(value) { owner.#dom = value; }, get libraryGuardAPI() { return owner.#libraryGuardAPI; }, set libraryGuardAPI(value) { owner.#libraryGuardAPI = value; }, get libraryGuardAnimation() { return owner.#libraryGuardAnimation; }, set libraryGuardAnimation(value) { owner.#libraryGuardAnimation = value; }, get libraryGuardObserver() { return owner.#libraryGuardObserver; }, set libraryGuardObserver(value) { owner.#libraryGuardObserver = value; }, get libraryGuardOriginalAnimation() { return owner.#libraryGuardOriginalAnimation; }, set libraryGuardOriginalAnimation(value) { owner.#libraryGuardOriginalAnimation = value; }, get libraryGuardPrefObserver() { return owner.#libraryGuardPrefObserver; }, set libraryGuardPrefObserver(value) { owner.#libraryGuardPrefObserver = value; }, get libraryGuardStyle() { return owner.#libraryGuardStyle; }, set libraryGuardStyle(value) { owner.#libraryGuardStyle = value; }, get libraryYieldingToPanel() { return owner.#libraryYieldingToPanel; }, set libraryYieldingToPanel(value) { owner.#libraryYieldingToPanel = value; }, get state() { return owner.#state; }, set state(value) { owner.#state = value; } } }));

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








        syncEnabled() {
          this.syncLibraryPanelGuard();
          const on = !!Core.getPref(Constants.Apps.PREF_ENABLED, true);
          document.documentElement.setAttribute(
            "zentral-apps-enabled",
            String(on),
          );
          if (!on) {
            this.closePanel();
            for (const id of [...this.#state.appBrowsers.keys()])
              this.closeApp(id);
            this.stopPositionTracking();
            if (this._preloadTimer) clearTimeout(this._preloadTimer);
            this._preloadTimer = null;
            this.stopBadgeSyncLoop();
          } else {
            this.loadApps();
            this.renderGrid();
            this.repositionGrid();
            this.updateAutohideState();
            this.scheduleAutomaticPreloads();
          }
        }

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
          this.setupLibraryPanelGuard();

          // Expose legacy/debug global helper
          window.ZenApps = {
            addApp: this.addApp.bind(this),
            removeApp: this.removeApp.bind(this),
          };

          Core.emit("appsInitComplete", this);

          // Preload apps sequentially after browser startup
          this.scheduleAutomaticPreloads();
        }

        /**
         * Loads configured web app objects from user preferences.
         */


        /**
         * Serializes and saves the active apps list to user preferences.
         */


        /**
         * Loads the preferred display slot positions for the Apps Grid Utility Section buttons.
         */


        /**
         * Persists the preferred display slot positions for the Apps Grid Utility Section buttons.
         */


        /**
         * Sequentially preloads browser background instances for apps configured with preload enabled.
         * Uses staggered delays to prevent startup performance hits.
         */


        /**
         * Retrieves stored panel width or calculates fallback based on window proportion.
         * @returns {number} Panel width in pixels.
         */


        /**
         * Persists custom panel width for active app object.
         * @param {number} px - Panel width in pixels.
         */


        /* --------------------------------------------------------------------------
         * 3.3 Layout & Sidebar Position Detection
         * --------------------------------------------------------------------------
         */

        /**
         * Determines whether the sidebar is positioned on the right side of the browser window.
         * @returns {boolean} True if sidebar is on the right side.
         */


        /**
         * Determines whether the Apps grid is configured to be placed in the opposite Vertical Bar.
         * @returns {boolean} True if apps placement is set to 'vertical-bar'.
         */


        /**
         * Determines whether the opposite Vertical Bar is on the right side of the screen.
         * (Attached to the screen edge opposite to the native Zen sidebar).
         * @returns {boolean} True if the Vertical Bar is on the right.
         */


        /**
         * Determines whether the active floating app panel should attach to and slide from the right.
         * @returns {boolean} True if panel attaches to the right edge.
         */


        /**
         * Determines whether the Zen sidebar is currently collapsed.
         * @returns {boolean} True if sidebar is collapsed.
         */


        /**
         * Determines whether Zen Browser is using the "Collapsed Sidebar" layout mode (horizontal apps bar in top toolbar).
         * This includes:
         *   - sidebar-expanded pref false (traditional collapsed layout)
         *   - Compact Mode active (sidebar-expanded=true but physically collapsed/thin)
         *   - zen-sidebar-collapsed DOM attribute set
         * @returns {boolean} True if in Collapsed Sidebar layout mode.
         */


        /**
         * Checks physical sidebar state via DOM attributes and pixel width.
         * Handles both Collapsed Sidebar mode and Compact Mode (sidebar-expanded=true but visually thin/hidden).
         * @returns {boolean} True if the sidebar is physically not expanded.
         */


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
          const css = window.ZentralModuleLoader.readText("features/apps/styles/ZentralAppsInjected.css", "apps");
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


        /**
         * Creates and attaches persistent DOM elements for the app grid and panel overlays.
         */




        /** Close through the current public method so secondary views clean up too. */












        /** Uses the same command as Zen's native Library toolbar button. */


        /** Same in-window action as the native Ctrl+B shortcut. */


        /** Opens or focuses the browser's native Library collection. */


        /**
         * Updates documentElement and trigger state based on autohide preference.
         */


        /**
         * Updates documentElement and utilitySection state based on hide utility section preference.
         */


        /**
         * Sets whether the utility section is revealed (Autohide OFF mode).
         * @param {boolean} hovered - Whether utility section or apps grid is hovered.
         */


        /**
         * Schedules collapse of the utility section after cursor leaves.
         * @param {number} [delay=350] - Delay in milliseconds.
         */


        /**
         * Schedules delayed reveal when cursor moves to the edge in autohide mode.
         * Prevents accidental opening during rapid mouse passes.
         * @param {number} [delay=320] - Delay in milliseconds.
         */


        /**
         * Cancels any pending autohide reveal timer.
         */


        /**
         * Sets whether the autohide apps grid is currently revealed.
         * @param {boolean} hovered - Whether cursor is over trigger or grid.
         */
        // An open but hover-hidden panel must not pin the Apps Bar open.
        // Sidebar mode keeps its original active-app rule.






        /**
         * Schedules delayed collapse after cursor leaves apps grid.
         * @param {number} [delay=250] - Delay in milliseconds.
         */


        /**
         * Renders the draggable buttons (Settings, Autohide) inside the Apps Grid Utility Section.
         * Supports free slot positioning across all grid columns.
         */


        /**
         * Formats an app's title into a clean, friendly service/brand name
         * (e.g. "Discord", "WhatsApp", "Telegram", "Reddit") instead of raw URLs or domains ("discord.com").
         * @param {string} [title] - Raw title string or page label.
         * @param {string} [url] - Target app website URL.
         * @returns {string} Human-friendly service title.
         */


























        // Title/load events are authoritative even when the panel is closed.
        // This optional fallback covers browser builds which miss title events.












        // Apps Bar panels share the space between BOTH bars. Never measure the
        // pushed tabbox here: its margin depends on the panel width itself.


















































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
              if (
                m.attributeName === "zen-right-side" ||
                m.attributeName === "zen-sidebar-right"
              ) {
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
                m.attributeName === "zen-sidebar-expanded" ||
                m.attributeName === "zen-sidebar-hidden"
              ) {
                Core.log(
                  "ZentralApps",
                  "layout attribute changed → triggering repositionGrid",
                );
                this.scheduleRepositionGrid(80);
              }
              if (
                m.attributeName === "zen-compact-mode"
              ) {
                if (this.isPlacementVerticalBar()) {
                  this.syncVerticalBarTheme();
                  this.updateVerticalBarBounds();
                }
              }
            }
          });
          this.#sideObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: [
              "zen-right-side",
              "zen-sidebar-right",
              "zen-sidebar-collapsed",
              "zen-compact-mode",
              "zen-sidebar-expanded",
              "zen-sidebar-hidden",
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
            window.ZentralRuntime?.nativeSidebarElement?.() ||
            gBrowser?.tabContainer;
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
      let started = false,
        disposed = false,
        booting = true;
      const onEnabled = () => {
        if (disposed) return;
        const on = !!Core.getPref(Constants.Apps.PREF_ENABLED, true);
        document.documentElement.setAttribute(
          "zentral-apps-enabled",
          String(on),
        );
        try {
          if (on && !started) {
            instance.init();
            started = true;
          } else if (started) instance.syncEnabled();
          runtime.setAvailable("apps", on);
        } catch (error) {
          try {
            instance.destroy();
          } catch (_) {}
          started = false;
          runtime.failFeature("apps", error);
          if (booting) throw error;
        }
      };
      Services.prefs.addObserver(Constants.Apps.PREF_ENABLED, onEnabled);
      try {
        onEnabled();
      } catch (error) {
        Services.prefs.removeObserver(Constants.Apps.PREF_ENABLED, onEnabled);
        delete window.Zentral.Apps;
        throw error;
      } finally {
        booting = false;
      }
      return () => {
        disposed = true;
        Services.prefs.removeObserver(Constants.Apps.PREF_ENABLED, onEnabled);
        document.documentElement.removeAttribute("zentral-apps-enabled");
        instance.destroy();
        delete window.Zentral.Apps;
      };
    },
  });
})();
