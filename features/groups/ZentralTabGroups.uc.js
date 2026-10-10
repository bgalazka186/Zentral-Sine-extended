/*
 * ZENTRAL FILE GUIDE - features/groups/ZentralTabGroups.uc.js
 *
 * Purpose: Owns the Groups class, private state, session/workspace settlement, initialization/enable
 *   transitions, observer installation and cleanup.
 * Interaction / execution: Runtime activates tab-groups independently of Apps. Installs Store, Dom, Menus,
 *   Colors and NativeAdapter methods on one class instance with live private-state accessors.
 * Ownership / failure: destroy() owns save/settlement/menu timers, native hooks, observers and color-picker
 *   drag cleanup. Controllers are required Groups internals, not separately installable features.
 * Registration: tab-groups
 * Loaded/created by: core/ZentralCatalog.js
 * Direct local resource paths: features/groups/styles/ZentralGroupsInjected.css; features/groups/controllers/ZentralGroupsColors.js;
 *   features/groups/controllers/ZentralGroupsDom.js; features/groups/controllers/ZentralGroupsMenus.js;
 *   features/groups/controllers/ZentralGroupsNativeAdapter.js; features/groups/controllers/ZentralGroupsStore.js
 * Constructed factory IDs: groups/ZentralGroupsColors; groups/ZentralGroupsDom; groups/ZentralGroupsMenus;
 *   groups/ZentralGroupsNativeAdapter; groups/ZentralGroupsStore
 * Cross-file calls / ctx suppliers: features/groups/controllers/ZentralGroupsColors.js -> checkAndApplyFirstTimeGroupColor,
 *   clearStoredColorData, loadSavedColors; features/groups/controllers/ZentralGroupsDom.js -> applyChevronPref,
 *   applyIndicatorTypePref, applyLabelOpacityPref, processExistingGroups, processGroup, safeHideTooltip;
 *   features/groups/controllers/ZentralGroupsMenus.js -> addFolderContextMenuItems, enhanceTabContextMenu;
 *   features/groups/controllers/ZentralGroupsNativeAdapter.js -> hookAddTab, setupGroupNativeHooks, queryLiveTabNodes,
 *   removeBuiltinTabGroupMenu, setupObserver, setupPopupSuppression, setupTabOpenHandler;
 *   features/groups/controllers/ZentralGroupsStore.js -> getWorkspaceForElement, loadTabGroupState, reconstructSavedGroups,
 *   saveTabGroupState, scheduleStateSave
 * Literal DOM event subscriptions: TabGroupCreate; TabGroupCreateByUser; TabGroupUpdate; mouseenter;
 *   mouseleave; mouseover; tabgroupcreated; unload; zen-workspace-changed; zen-workspace-switched;
 *   zen-workspaces-change
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
  window.ZentralModuleLoader.load(
    "features/groups/controllers/ZentralGroupsStore.js",
    { owner: "tab-groups" },
  );
  window.ZentralModuleLoader.load(
    "features/groups/controllers/ZentralGroupsDom.js",
    { owner: "tab-groups" },
  );
  window.ZentralModuleLoader.load(
    "features/groups/controllers/ZentralGroupsMenus.js",
    { owner: "tab-groups" },
  );
  window.ZentralModuleLoader.load(
    "features/groups/controllers/ZentralGroupsColors.js",
    { owner: "tab-groups" },
  );
  window.ZentralModuleLoader.load(
    "features/groups/controllers/ZentralGroupsNativeAdapter.js",
    { owner: "tab-groups" },
  );
  window.ZentralModuleLoader.load(
    "features/groups/controllers/ZentralGroupsLifecycle.js",
    { owner: "tab-groups" },
  );
  ZentralRuntime.register({
    id: "tab-groups",
    init({ shared, runtime }) {
      const {
        Constants,
        Core,
        createSVGElement,
        SVG_STRINGS,
        WELL_KNOWN_SERVICES,
      } = shared;
      const lifecycle = window.ZentralModuleLoader.create("groups/ZentralGroupsLifecycle");
      const { setTimeout, clearTimeout, MutationObserver } = lifecycle;
      class ZentralTabGroups {
        get enabled() { return lifecycle.active; }

        /** Compatibility protections share the existing experimental master switch. */

        /** @private Tabstrip MutationObserver */
        #tabStripObserver = null;
        /** @private Native popup suppression listener */
        #popupShowingListener = null;
        /** @private Global group context menu event listener */
        #groupContextMenuHandler = null;
        /** @private Global blocker for group toggle on right click */
        #groupRightClickBlocker = null;
        /** @private Global listener for submenu popups */
        _tabContextSubmenuListener = null;
        /** @private Cleanup function for tab drag selection guard */
        #dragGuardCleanup = null;
        /** @private Flag indicating if tab drag selection guard is active */
        #tabDragGuardInitialized = false;
        /** @private Latch indicating session restore settlement in progress */
        #isRestoring = false;
        /** @private SessionStore observer callback */
        #sessionRestoreObserver = null;
        /** @private Settlement fallback timer */
        #restoreSettleTimer = null;
        /** @private Workspace switch listener for multi-space reconstruction */
        #workspaceSwitchListener = null;
        /** @private TabOpen event listener for smart grouping */
        #tabOpenListener = null;
        #groupColorEventListener = null;
        #folderMenuTimer = null;
        #folderMenuHandler = null;
        #colorPickerDragCleanup = null;
        /** @private Original gBrowser.addTab reference */
        #origAddTab = null;
        /** @private Latch indicating sub-group badge updating in progress */
        #isUpdatingBadges = false;
        /** @private RAF handle for debounced badge updates */
        #badgeUpdateRAF = null;

        /**
         * Safely retrieves Firefox SessionStore service for persistent tab metadata across restarts.
         * @private
         */
        #getSessionStore() {
          try {
            if (typeof SessionStore !== "undefined" && SessionStore)
              return SessionStore;
            if (window.SessionStore) return window.SessionStore;
            return ChromeUtils.importESModule(
              "resource:///modules/sessionstore/SessionStore.sys.mjs",
            ).SessionStore;
          } catch (_) {
            try {
              return ChromeUtils.import(
                "resource:///modules/sessionstore/SessionStore.jsm",
              ).SessionStore;
            } catch (_) {
              return null;
            }
          }
        }
        /** @private Root attribute MutationObserver */
        #rootAttrObs = null;
        /** @private Sidebar attr update listener for prefs */
        #updateSidebarAttr = null;

        /**
         * Determines the Zen workspace UUID for a DOM element (tab or tab-group).
         * Traverses direct attributes, parent/ancestor workspace sections, and child tabs.
         * @param {Element} el - Tab or tab-group element.
         * @returns {string} Workspace UUID string or active workspace fallback.
         */

        /**
         * Creates an SVG element from an XML string.
         * @private
         * @param {string} xmlString - SVG XML markup string.
         * @returns {Element} Parsed SVG DOM element.
         */
        /**
         * Creates an SVG element using the shared module helper (no DOMParser).
         * @private
         */
        #createSVG(xmlString) {
          return createSVGElement(xmlString);
        }

        /**
         * Module tear down for Sine hot unloading
         */
        destroy() {
          try {
            if (!lifecycle.active) return;
            Core.log("ZentralTabGroups", "Destroying TabGroups module...");
            // Save before stopping guarded methods; native groups remain intact.
            this.saveTabGroupState();
            this.renameGroupHalt(null, true);
            lifecycle.stop();

            this.#colorPickerDragCleanup?.();
            this.#colorPickerDragCleanup = null;
            // 1. Clear timers
            if (this.#restoreSettleTimer) {
              clearTimeout(this.#restoreSettleTimer);
              this.#restoreSettleTimer = null;
            }
            if (this.#state && this.#state.saveStateTimer) {
              clearTimeout(this.#state.saveStateTimer);
              this.#state.saveStateTimer = null;
            }
            if (window.zentralTooltipHideTimer) {
              clearTimeout(window.zentralTooltipHideTimer);
              window.zentralTooltipHideTimer = null;
            }
            if (
              this.#sessionRestoreObserver &&
              typeof Services !== "undefined" &&
              Services.obs
            ) {
              try {
                Services.obs.removeObserver(
                  this.#sessionRestoreObserver,
                  "sessionstore-windows-restored",
                );
              } catch (_) {}
              this.#sessionRestoreObserver = null;
            }
            if (this.#badgeUpdateRAF) {
              window.cancelAnimationFrame(this.#badgeUpdateRAF);
              this.#badgeUpdateRAF = null;
            }
            this.#isRestoring = false;

            // 2. Disconnect observers
            if (this.#tabStripObserver) {
              try {
                this.#tabStripObserver.disconnect();
              } catch (_) {}
              this.#tabStripObserver = null;
            }
            if (this.#rootAttrObs) {
              try {
                this.#rootAttrObs.disconnect();
              } catch (_) {}
              this.#rootAttrObs = null;
            }
            if (this.#updateSidebarAttr) {
              try {
                Services.prefs.removeObserver(
                  "zen.view.sidebar-expanded",
                  this.#updateSidebarAttr,
                );
              } catch (_) {}
              try {
                Services.prefs.removeObserver(
                  "zen.view.use-single-toolbar",
                  this.#updateSidebarAttr,
                );
              } catch (_) {}
              this.#updateSidebarAttr = null;
            }
            if (this.#popupShowingListener) {
              try {
                window.removeEventListener(
                  "popupshowing",
                  this.#popupShowingListener,
                  true,
                );
              } catch (_) {}
              this.#popupShowingListener = null;
            }
            if (this.#tabOpenListener) {
              try {
                if (window.gBrowser?.tabContainer) {
                  window.gBrowser.tabContainer.removeEventListener(
                    "TabOpen",
                    this.#tabOpenListener,
                  );
                }
              } catch (_) {}
              this.#tabOpenListener = null;
            }
            if (this.#origAddTab && window.gBrowser) {
              this.#origAddTab = null;
            }
            if (this.#groupContextMenuHandler) {
              try {
                window.removeEventListener(
                  "contextmenu",
                  this.#groupContextMenuHandler,
                  true,
                );
              } catch (_) {}
              this.#groupContextMenuHandler = null;
            }
            if (this.#groupRightClickBlocker) {
              try {
                window.removeEventListener(
                  "mousedown",
                  this.#groupRightClickBlocker,
                  true,
                );
              } catch (_) {}
              try {
                window.removeEventListener(
                  "mouseup",
                  this.#groupRightClickBlocker,
                  true,
                );
              } catch (_) {}
              try {
                window.removeEventListener(
                  "click",
                  this.#groupRightClickBlocker,
                  true,
                );
              } catch (_) {}
              this.#groupRightClickBlocker = null;
            }
            if (this._tabContextSubmenuListener) {
              window.removeEventListener(
                "popupshowing",
                this._tabContextSubmenuListener,
                true,
              );
              window.removeEventListener(
                "popupshown",
                this._tabContextSubmenuListener,
                true,
              );
              this._tabContextSubmenuListener = null;
            }
            const nativeTabMenu = document.getElementById("tabContextMenu");
            if (nativeTabMenu) delete nativeTabMenu._zentralEnhanced;
            document.removeEventListener(
              "TabGroupCreate",
              this.onTabGroupCreate,
              true,
            );
            document.removeEventListener(
              "tabgroupcreated",
              this.onTabGroupCreate,
              true,
            );
            if (this.#groupColorEventListener) {
              document.removeEventListener(
                "TabGroupCreateByUser",
                this.#groupColorEventListener,
                true,
              );
              document.removeEventListener(
                "TabGroupUpdate",
                this.#groupColorEventListener,
                true,
              );
              this.#groupColorEventListener = null;
            }
            if (this.#folderMenuTimer) {
              clearTimeout(this.#folderMenuTimer);
              this.#folderMenuTimer = null;
            }
            const folderMenu = document.getElementById("zenFolderActions");
            if (folderMenu && this.#folderMenuHandler) {
              folderMenu.removeEventListener(
                "command",
                this.#folderMenuHandler,
              );
              this.#folderMenuHandler = null;
            }
            document
              .getElementById("zentral-tabgroup-convert-folder-to-group")
              ?.remove();
            document
              .getElementById("zentral-tabgroup-folder-separator")
              ?.remove();
            if (this.#dragGuardCleanup) {
              try {
                this.#dragGuardCleanup();
              } catch (_) {}
              this.#dragGuardCleanup = null;
            }
            if (this.#workspaceSwitchListener) {
              try {
                window.removeEventListener(
                  "zen-workspace-switched",
                  this.#workspaceSwitchListener,
                );
              } catch (_) {}
              try {
                window.removeEventListener(
                  "zen-workspace-changed",
                  this.#workspaceSwitchListener,
                );
              } catch (_) {}
              try {
                window.removeEventListener(
                  "zen-workspaces-change",
                  this.#workspaceSwitchListener,
                );
              } catch (_) {}
              this.#workspaceSwitchListener = null;
            }

            // 3. Remove injected DOM elements
            const idsToRemove = [
              "zentral-tabgroups-styles",
              "zentral-tabgroup-tooltip",
              "zentral-tabgroup-tooltip-container",
              "zentral-tabgroup-context-menu",
              "advanced-tab-groups-context-menu",
              "zentral-color-picker-panel",
              "zentral-group-color-picker",
            ];
            idsToRemove.forEach((id) => {
              const el = document.getElementById(id);
              if (el) el.remove();
            });

            // Native group containers, tab membership and saved state are retained.
            this.#groupObservers = new WeakMap();

            // 6. Clean up root attributes
            document.documentElement.removeAttribute(
              "zentral-sidebar-collapsed",
            );
            document.documentElement.removeAttribute("zentral-show-chevron");
            document.documentElement.removeAttribute("zentral-indicator-type");
            document.documentElement.removeAttribute(
              "zentral-label-opacity-below-85",
            );
            document.documentElement.removeAttribute("zen-renaming-group");
            document.documentElement.style.removeProperty(
              "--zentral-tabgroup-label-opacity",
            );
            document
              .getElementById("tabbrowser-tabs")
              ?.removeAttribute("zentral-sidebar-collapsed");

            this.#processedGroups = new WeakSet();
            if (this.#state) {
              this.#state.sharedContextMenu = null;
              this.#state.colorPickerPanel = null;
              this.#state.contextMenuCurrentGroup = null;
            }
          } catch (err) {
            console.error("[ZentralTabGroups] Error during destroy:", err);
          }
        }

        /**
         * 4.1 Initialization & Internal Properties
         * @private
         */
        #state = {
          editingGroup: null,
          groupEdited: null,
          sharedContextMenu: null,
          contextMenuCurrentGroup: null,
          saveStateTimer: null,
          colorPickerPanel: null,
        };

        /** @private Tracks which groups have been processed this session (replaces fragile DOM attribute) */
        #processedGroups = new WeakSet();

        /** @private Tracks per-group style MutationObserver instances for cleanup on group removal */
        #groupObservers = new WeakMap();

        /**
         * Constructs ZentralTabGroups instance and binds context methods.
         */
        constructor() {
          const owner = this;
          Object.assign(
            this,
            window.ZentralModuleLoader.create("groups/ZentralGroupsStore", {
              Services,
              shared,
              runtime,
              lifecycle,
              access: {
                getSessionStore: (...args) => owner.#getSessionStore(...args),
                get isRestoring() {
                  return owner.#isRestoring;
                },
                set isRestoring(value) {
                  owner.#isRestoring = value;
                },
                get state() {
                  return owner.#state;
                },
                set state(value) {
                  owner.#state = value;
                },
              },
            }),
          );
          Object.assign(
            this,
            window.ZentralModuleLoader.create("groups/ZentralGroupsDom", {
              Services,
              shared,
              runtime,
              lifecycle,
              access: {
                get badgeUpdateRAF() {
                  return owner.#badgeUpdateRAF;
                },
                set badgeUpdateRAF(value) {
                  owner.#badgeUpdateRAF = value;
                },
                createSVG: (...args) => owner.#createSVG(...args),
                get groupObservers() {
                  return owner.#groupObservers;
                },
                set groupObservers(value) {
                  owner.#groupObservers = value;
                },
                get isUpdatingBadges() {
                  return owner.#isUpdatingBadges;
                },
                set isUpdatingBadges(value) {
                  owner.#isUpdatingBadges = value;
                },
                get processedGroups() {
                  return owner.#processedGroups;
                },
                set processedGroups(value) {
                  owner.#processedGroups = value;
                },
                get state() {
                  return owner.#state;
                },
                set state(value) {
                  owner.#state = value;
                },
              },
            }),
          );
          Object.assign(
            this,
            window.ZentralModuleLoader.create("groups/ZentralGroupsMenus", {
              Services,
              shared,
              runtime,
              lifecycle,
              access: {
                get folderMenuHandler() {
                  return owner.#folderMenuHandler;
                },
                set folderMenuHandler(value) {
                  owner.#folderMenuHandler = value;
                },
                get folderMenuTimer() {
                  return owner.#folderMenuTimer;
                },
                set folderMenuTimer(value) {
                  owner.#folderMenuTimer = value;
                },
                getSessionStore: (...args) => owner.#getSessionStore(...args),
                get state() {
                  return owner.#state;
                },
                set state(value) {
                  owner.#state = value;
                },
              },
            }),
          );
          Object.assign(
            this,
            window.ZentralModuleLoader.create("groups/ZentralGroupsColors", {
              Services,
              shared,
              runtime,
              lifecycle,
              access: {
                get isRestoring() {
                  return owner.#isRestoring;
                },
                set isRestoring(value) {
                  owner.#isRestoring = value;
                },
                get colorPickerDragCleanup() {
                  return owner.#colorPickerDragCleanup;
                },
                set colorPickerDragCleanup(value) {
                  owner.#colorPickerDragCleanup = value;
                },
                get state() {
                  return owner.#state;
                },
                set state(value) {
                  owner.#state = value;
                },
              },
            }),
          );
          Object.assign(
            this,
            window.ZentralModuleLoader.create(
              "groups/ZentralGroupsNativeAdapter",
              {
                Services,
                shared,
                runtime,
                lifecycle,
                access: {
                  get dragGuardCleanup() {
                    return owner.#dragGuardCleanup;
                  },
                  set dragGuardCleanup(value) {
                    owner.#dragGuardCleanup = value;
                  },
                  getSessionStore: (...args) => owner.#getSessionStore(...args),
                  get groupContextMenuHandler() {
                    return owner.#groupContextMenuHandler;
                  },
                  set groupContextMenuHandler(value) {
                    owner.#groupContextMenuHandler = value;
                  },
                  get groupObservers() {
                    return owner.#groupObservers;
                  },
                  set groupObservers(value) {
                    owner.#groupObservers = value;
                  },
                  get groupRightClickBlocker() {
                    return owner.#groupRightClickBlocker;
                  },
                  set groupRightClickBlocker(value) {
                    owner.#groupRightClickBlocker = value;
                  },
                  get isRestoring() {
                    return owner.#isRestoring;
                  },
                  set isRestoring(value) {
                    owner.#isRestoring = value;
                  },
                  get origAddTab() {
                    return owner.#origAddTab;
                  },
                  set origAddTab(value) {
                    owner.#origAddTab = value;
                  },
                  get popupShowingListener() {
                    return owner.#popupShowingListener;
                  },
                  set popupShowingListener(value) {
                    owner.#popupShowingListener = value;
                  },
                  get processedGroups() {
                    return owner.#processedGroups;
                  },
                  set processedGroups(value) {
                    owner.#processedGroups = value;
                  },
                  get state() {
                    return owner.#state;
                  },
                  set state(value) {
                    owner.#state = value;
                  },
                  get tabDragGuardInitialized() {
                    return owner.#tabDragGuardInitialized;
                  },
                  set tabDragGuardInitialized(value) {
                    owner.#tabDragGuardInitialized = value;
                  },
                  get tabOpenListener() {
                    return owner.#tabOpenListener;
                  },
                  set tabOpenListener(value) {
                    owner.#tabOpenListener = value;
                  },
                  get tabStripObserver() {
                    return owner.#tabStripObserver;
                  },
                  set tabStripObserver(value) {
                    owner.#tabStripObserver = value;
                  },
                },
              },
            ),
          );

          // External callers (settings/panels) cannot restart work while disabled.
          for (const [name, method] of Object.entries(this)) {
            if (typeof method !== "function") continue;
            this[name] = function (...args) {
              if (!lifecycle.active) return;
              return method.apply(this, args);
            };
          }

          // Method bindings
          this.onTabGroupCreate = this.onTabGroupCreate.bind(this);
          this.renameGroupKeydown = this.renameGroupKeydown.bind(this);
          this.renameGroupHalt = this.renameGroupHalt.bind(this);
        }

        /**
         * Sanitizes tab group state by removing empty zombie groups (0 tabs & no children)
         * and resolving untitled empty entries.
         * @param {Object} state - { groups, tabMapping }
         * @returns {Object} Sanitized state
         */

        /**
         * Reconstructs tab-group containers from tabs tagged with data-zentral-group-* attributes, SessionStore values, or saved state.
         */

        /* --------------------------------------------------------------------------
         * 4.2 Custom CSS & Visual Enhancements
         * --------------------------------------------------------------------------
         */

        /**
         * Updates the collapsed sidebar marquee label with clean text, clone, and overflow duration.
         * @param {Element} labelContainer - Group label container element.
         * @param {string} title - Group title text.
         */

        /**
         * Safely schedules or executes hiding of the tab group tooltip panel,
         * ensuring it does NOT close if the user is currently hovering over the popup or label.
         * @param {number} [delayMs=350] - Delay before hide check in milliseconds.
         */

        /**
         * Retrieves only the direct tabs belonging to a group, excluding tabs inside nested child groups.
         * @param {Element} group - Tab group DOM element.
         * @returns {Array<Element>} Array of direct tab elements.
         */

        /**
         * Initializes Tab Groups module observers, styles, color palettes, and tooltip containers.
         */
        init() {
          if (
            typeof PrivateBrowsingUtils !== "undefined" &&
            PrivateBrowsingUtils.isWindowPrivate(window)
          ) {
            Core.log(
              "ZentralTabGroups",
              "Tab Groups disabled in private window.",
            );
            return;
          }
          if (!Core.getPref(Constants.TabGroups.PREF_ENABLED)) {
            Core.log("ZentralTabGroups", "Tab Groups feature is disabled.");
            return;
          }
          lifecycle.begin();
          this.#isRestoring = true;
          this.clearStoredColorData();
          this.loadSavedColors();
          this.reconstructSavedGroups();
          this.injectStyles();
          this.setupObserver();
          this.setupPopupSuppression();
          this.addFolderContextMenuItems();
          this.removeBuiltinTabGroupMenu();
          this.enhanceTabContextMenu();
          this.setupGroupNativeHooks();
          this.processExistingGroups();
          this.setupTabOpenHandler();
          this.hookAddTab();
          lifecycle.listen(document,
            "TabGroupCreate",
            this.onTabGroupCreate,
            true,
          );
          lifecycle.listen(document,
            "tabgroupcreated",
            this.onTabGroupCreate,
            true,
          );
          this.#groupColorEventListener = (e) => {
            const group =
              e.target?.closest?.("tab-group:not([split-view-group])") ||
              (e.target?.tagName === "TAB-GROUP" ? e.target : null);
            if (group && !this.#isRestoring)
              this.checkAndApplyFirstTimeGroupColor(group);
          };
          lifecycle.listen(document,
            "TabGroupCreateByUser",
            this.#groupColorEventListener,
            true,
          );
          lifecycle.listen(document,
            "TabGroupUpdate",
            this.#groupColorEventListener,
            true,
          );

          // SessionStore Settlement Guard:
          // When the browser launches or caches are cleared, SessionStore injects tabs/groups asynchronously.
          // We block saves while #isRestoring is true, and re-nest/re-construct once SessionStore is finished.
          const settleRestore = () => {
            if (!this.#isRestoring) return;
            if (this.#restoreSettleTimer) {
              clearTimeout(this.#restoreSettleTimer);
              this.#restoreSettleTimer = null;
            }
            if (
              this.#sessionRestoreObserver &&
              typeof Services !== "undefined" &&
              Services.obs
            ) {
              try {
                Services.obs.removeObserver(
                  this.#sessionRestoreObserver,
                  "sessionstore-windows-restored",
                );
              } catch (_) {}
              this.#sessionRestoreObserver = null;
            }

            try {
              this.reconstructSavedGroups();
              this.loadTabGroupState();
              this.queryLiveTabNodes(
                "tab-group:not([split-view-group])",
              ).forEach((g) => this.processGroup(g));
            } catch (err) {
              console.error(
                "[ZentralTabGroups] Error settling session restore state:",
                err,
              );
            } finally {
              this.#isRestoring = false;
              this.scheduleStateSave();
            }
          };

          if (typeof Services !== "undefined" && Services.obs) {
            this.#sessionRestoreObserver = (subject, topic) => {
              if (topic === "sessionstore-windows-restored") {
                settleRestore();
              }
            };
            try {
              Services.obs.addObserver(
                this.#sessionRestoreObserver,
                "sessionstore-windows-restored",
                false,
              );
            } catch (_) {}
          }

          // Safety fallback timer in case sessionstore-windows-restored already fired or does not fire
          this.#restoreSettleTimer = setTimeout(settleRestore, 2500);

          // Workspace switch listener to ensure tab groups in newly focused Space are rendered & restored
          this.#workspaceSwitchListener = () => {
            try {
              this.reconstructSavedGroups();
              this.loadTabGroupState();
              this.queryLiveTabNodes(
                "tab-group:not([split-view-group])",
              ).forEach((g) => this.processGroup(g));
            } catch (_) {}
          };
          lifecycle.listen(window,
            "zen-workspace-switched",
            this.#workspaceSwitchListener,
          );
          lifecycle.listen(window,
            "zen-workspace-changed",
            this.#workspaceSwitchListener,
          );
          lifecycle.listen(window,
            "zen-workspaces-change",
            this.#workspaceSwitchListener,
          );

          // Collapsed Sidebar observer for Tab Groups
          const updateSidebarAttr = () => {
            try {
              const sidebarExpanded = Core.getNativePref(
                "zen.view.sidebar-expanded",
                true,
              );
              const singleToolbar = Core.getNativePref(
                "zen.view.use-single-toolbar",
                true,
              );
              const isCollapsed =
                !sidebarExpanded ||
                document.documentElement.getAttribute(
                  "zen-sidebar-collapsed",
                ) === "true" ||
                document
                  .getElementById("sidebar-box")
                  ?.getAttribute("collapsed") === "true";
              const tabContainer = document.getElementById("tabbrowser-tabs");
              if (tabContainer) {
                tabContainer.setAttribute(
                  "zentral-sidebar-collapsed",
                  isCollapsed ? "true" : "false",
                );
              }
              document.documentElement.setAttribute(
                "zentral-sidebar-collapsed",
                isCollapsed ? "true" : "false",
              );
            } catch (e) {}
          };
          updateSidebarAttr();
          this.#updateSidebarAttr = updateSidebarAttr;
          Services.prefs.addObserver(
            "zen.view.sidebar-expanded",
            updateSidebarAttr,
            false,
          );
          Services.prefs.addObserver(
            "zen.view.use-single-toolbar",
            updateSidebarAttr,
            false,
          );

          this.#rootAttrObs = new MutationObserver((mutations) => {
            for (const m of mutations) {
              if (
                m.attributeName === "zen-sidebar-collapsed" ||
                m.attributeName === "zen-right-side"
              ) {
                updateSidebarAttr();
              }
            }
          });
          this.#rootAttrObs.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["zen-sidebar-collapsed", "zen-right-side"],
          });

          // Tooltip injection (XUL panel with noautohide=true to avoid stealing click events)
          if (!document.getElementById("zentral-tabgroup-tooltip")) {
            const panel = document.createXULElement("panel");
            panel.id = "zentral-tabgroup-tooltip";
            panel.setAttribute("noautofocus", "true");
            panel.setAttribute("noautohide", "true");
            panel.setAttribute("type", "arrow");
            panel.setAttribute("role", "tooltip");

            const cancelHideTimer = () => {
              if (window.zentralTooltipHideTimer) {
                clearTimeout(window.zentralTooltipHideTimer);
                window.zentralTooltipHideTimer = null;
              }
            };

            lifecycle.listen(panel, "mouseenter", cancelHideTimer);
            lifecycle.listen(panel, "mouseleave", () =>
              this.safeHideTooltip(350),
            );
            lifecycle.listen(panel, "mouseover", cancelHideTimer);

            const container = document.createElement("div");
            container.id = "zentral-tabgroup-tooltip-container";
            container.style.display = "flex";
            container.style.flexDirection = "column";
            container.style.overflowY = "auto";
            lifecycle.listen(container, "mouseenter", cancelHideTimer);
            lifecycle.listen(container, "mouseleave", () =>
              this.safeHideTooltip(350),
            );
            lifecycle.listen(container, "mouseover", cancelHideTimer);
            panel.appendChild(container);

            const popupset =
              document.getElementById("mainPopupSet") ||
              document.documentElement;
            popupset.appendChild(panel);
          }

          this.applyChevronPref();
          this.applyIndicatorTypePref();
          this.applyLabelOpacityPref();
          Core.emit("tabGroupsInitComplete", this);
        }

        /**
         * Reads show_chevron preference and sets zentral-show-chevron attribute on root.
         */

        /**
         * Reads indicator_type preference ("circle"|"chevron") and sets zentral-indicator-type attribute on root.
         */

        /**
         * Reads label_opacity preference (0-100) and sets --zentral-tabgroup-label-opacity CSS variable and state attribute on root.
         */

        /**
         * Injects CSS styles for customized tab group pills, initial badges, and color pickers.
         */
        injectStyles() {
          const css = window.ZentralModuleLoader.readText(
            "features/groups/styles/ZentralGroupsInjected.css",
            "tab-groups",
          );
          try {
            const styleEl = document.createElement("style");
            styleEl.id = "zentral-tabgroups-styles";
            styleEl.textContent = css;
            (document.head || document.documentElement).appendChild(styleEl);
          } catch (e) {
            console.error("[Zentral] Error injecting tabgroups styles:", e);
          }
        }

        /* --------------------------------------------------------------------------
         * 4.1 Initialization & Observers
         * --------------------------------------------------------------------------
         */

        /**
         * Registers a TabOpen event listener on the tabstrip to ensure new tabs opened from within
         * a grouped tab (via link click or middle-click) are placed directly below the originating tab
         * inside the same group. Tabs opened from an App Panel are kept outside of any group.
         */

        /**
         * Hooks gBrowser.addTab to ensure any tab opened while an App Panel is active
         * is created outside of any group, bypassing Zen's default selectedTab inheritance.
         */

        /**
         * Registers a MutationObserver on the tab strip to track added, removed, or collapsed tab groups.
         */

        /* --------------------------------------------------------------------------
         * 4.5 Custom Tooltips & Context Menus
         * --------------------------------------------------------------------------
         */

        /**
         * Removes builtin native tab group context menus to prevent UI redundancy.
         * @param {Element|Document} [root=document] - Container scope to scan.
         */
        /**
         * Installs capture-phase listener on window to block native Firefox tab group editor panels.
         */

        /**
         * Removes builtin native tab group context menus and editor panels to prevent UI redundancy.
         * @param {Element|Document} [root=document] - Container scope to scan.
         */

        /**
         * Scans and processes all existing tab group DOM elements in the workspace.
         */

        /**
         * Handles keyboard events when editing tab group titles (Enter to confirm, Escape to cancel).
         * @param {KeyboardEvent} event - Keydown event object.
         */

        /**
         * Replaces tab group text label with an inline text input to begin group renaming.
         * @param {Element} group - Tab group DOM element.
         * @param {boolean} [selectAll=true] - Whether to select full text in input.
         */

        /**
         * Halts tab group title rename operation and restores original text label.
         * @param {FocusEvent} event - Blur event on text input.
         * @param {boolean} [force=false] - Force halt regardless of active state.
         */

        /**
         * Enhances a tab group DOM node with custom icons, close buttons, tooltips, and context menus.
         * @param {Element} group - Tab group DOM element.
         */

        /**
         * Constructs or returns the shared context menu popup for tab groups.
         * @returns {Element} XUL menupopup element.
         */

        /* --------------------------------------------------------------------------
         * 4.4 Color Picker & Theme Processing
         * --------------------------------------------------------------------------
         */

        /**
         * Constructs and initializes the interactive popup color picker panel with spectrum wheel and eyedropper.
         * @returns {Element} XUL panel element for color selection.
         */

        /**
         * Attaches custom context menu actions to native Zen folder menus.
         */

        /**
         * Enhances native tab context menu (#tabContextMenu) to ensure all existing
         * tab groups are populated and selectable when right-clicking tabs to add/move to group.
         */

        /**
         * Binds right-click context menu event listener and helper methods to a specific tab group.
         * @param {Element} group - Tab group DOM element.
         */

        /**
         * Checks if a tab group ID is already recorded in persistent storage (PREF_STATE or PREF_COLORS).
         * Used to ensure groups are only auto-colored with the average color when created for the first time ever.
         * @param {string} groupId - The tab group ID.
         * @returns {boolean} True if the group was previously saved/known.
         */

        /**
         * Asynchronously extracts the dominant/average RGB color from a tab's favicon image.
         * Uses HTMLImageElement in chrome privilege without CORS restrictions.
         * @param {Element} tab - Tab element.
         * @returns {Promise<Array<number>|null>} [r, g, b] color tuple or null.
         */

        /**
         * Resolves a fallback color for a tab from container identity colors or Zen primary color.
         * @param {Element} tab - Tab element.
         * @returns {Array<number>} [r, g, b] color tuple.
         */

        /**
         * Computes the average favicon color from all member tabs and applies it to the tab group.
         * @param {Element} group - Tab group element.
         * @param {boolean} [force=false] - Force apply even if already colored.
         */

        /**
         * Checks whether a tab group is being created for the first time ever, and if so,
         * applies the average group color automatically.
         * NEVER runs on browser restart or reconstructed groups.
         * @param {Element} group - Tab group DOM element.
         */

        /**
         * Schedules a debounced refresh of sub-groups indicator badges.
         */

        /**
         * Updates the sub-groups indicator badge on a tab group header.
         * Displays count of direct child sub-groups when collapsed.
         * @param {Element} group - The tab-group element.
         * @param {Array<Element>} [cachedAllGroups=null] - Optional pre-queried tab-group array to eliminate redundant DOM queries.
         */

        /**
         * Refreshes sub-group badges across all tab groups in the document.
         * Pre-queries and batches tab group elements for O(N) traversal efficiency.
         */

        /**
         * Prevents dormant tabs and split views from being selected and loaded while being dragged or reordered.
         * Defers mousedown tab selection until mouseup (for clicks) and isolates the drag payload during startTabDrag (for drags).
         */

        /* --------------------------------------------------------------------------
         * 4.3 Group Hierarchy & Storage Serialization
         * --------------------------------------------------------------------------
         */

        /**
         * Converts a tab group into a native Zen tab folder.
         * @param {Element} group - Tab group DOM element.
         */

        /**
         * Converts a native Zen tab folder into a Zentral tab group.
         * @param {Element} folder - Zen folder DOM element.
         */

        /**
         * Computes the average RGB color from an array of RGB color tuples.
         * @param {Array<Array<number>>} colors - Array of [r, g, b] tuples.
         * @returns {Array<number>} Average [r, g, b] color tuple.
         */

        /**
         * Determines contrasting text color ('black' or 'white') for a given background color string.
         * @param {string} colorStr - Hex or RGB color string.
         * @returns {string} 'black' or 'white'.
         */

        /**
         * Clears cached color picker reference objects from window global scope.
         */

        /**
         * Saves tab group custom colors map to user preferences.
         */

        /**
         * Loads and applies saved custom tab group colors from user preferences.
         */

        /**
         * Removes a stored color entry for a deleted tab group.
         * @param {string} groupId - Unique tab group ID string.
         */

        /**
         * Schedules debounced state save for tab groups to prevent excessive disk writes.
         */

        /**
         * Serializes tab group hierarchy, parent relationships, and collapsed states to user preferences.
         */

        /**
         * Restores saved tab group DOM hierarchy, nestings, and collapsed states from user preferences.
         */
      }
      const instance = new ZentralTabGroups();
      window.Zentral.TabGroups = instance;
      let started = false,
        disposed = false,
        booting = true;
      const onEnabled = () => {
        if (disposed) return;
        const on =
          !!Core.getPref(Constants.TabGroups.PREF_ENABLED) &&
          !(
            typeof PrivateBrowsingUtils !== "undefined" &&
            PrivateBrowsingUtils.isWindowPrivate(window)
          );
        try {
          if (on && !started) {
            instance.init();
            started = true;
          } else if (!on && started) {
            instance.destroy();
            started = false;
          }
          runtime.setAvailable("tab-groups", on);
        } catch (error) {
          try {
            instance.destroy();
          } catch (_) {}
          started = false;
          runtime.failFeature("tab-groups", error);
          if (booting) throw error;
        }
      };
      Services.prefs.addObserver(Constants.TabGroups.PREF_ENABLED, onEnabled);
      try {
        onEnabled();
      } catch (error) {
        Services.prefs.removeObserver(
          Constants.TabGroups.PREF_ENABLED,
          onEnabled,
        );
        delete window.Zentral.TabGroups;
        throw error;
      } finally {
        booting = false;
      }
      return () => {
        disposed = true;
        Services.prefs.removeObserver(
          Constants.TabGroups.PREF_ENABLED,
          onEnabled,
        );
        instance.destroy();
        delete window.Zentral.TabGroups;
      };
    },
  });
})();
