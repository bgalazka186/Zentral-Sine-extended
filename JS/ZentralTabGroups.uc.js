(function(){
"use strict";
const Services=globalThis.Services||ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
const ZentralRuntime=window.ZentralRuntime;
ZentralRuntime.register({id:"tab-groups",init({shared,runtime}){
const {Constants,Core,createSVGElement,SVG_STRINGS,WELL_KNOWN_SERVICES}=shared;
class ZentralTabGroups {
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
    getWorkspaceForElement(el) {
      if (!el) return "";
      try {
        // 1. Direct workspace ID attribute
        let ws =
          el.getAttribute?.("zen-workspace-id") ||
          el.getAttribute?.("data-zentral-group-ws");
        if (ws && ws !== "undefined" && ws !== "null") return ws;

        // 2. Ancestor <zen-workspace> container (Zen native element)
        const zenWs = el.closest?.("zen-workspace");
        if (zenWs?.id) return zenWs.id;

        // 3. Ancestor tabs section within a workspace element
        const section = el.closest?.(
          ".zen-workspace-tabs-section, .zen-workspace-normal-tabs-section",
        );
        if (section) {
          const wsBox = section.closest?.("[id]");
          if (
            wsBox?.id &&
            window.gZenWorkspaces?.getWorkspaceFromId?.(wsBox.id)
          ) {
            return wsBox.id;
          }
        }

        // 4. If this is a tab-group, check member tabs inside it
        if (el.tagName?.toLowerCase() === "tab-group") {
          const childTabs = el.querySelectorAll?.(
            "tab, tabbrowser-tab, .tabbrowser-tab",
          );
          if (childTabs) {
            for (const t of childTabs) {
              const tWs = this.getWorkspaceForElement(t);
              if (tWs) return tWs;
            }
          }
        }
      } catch (_) {}
      return window.gZenWorkspaces?.activeWorkspace || "";
    }

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
        Core.log("ZentralTabGroups", "Destroying TabGroups module...");

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
          try {
            window.gBrowser.addTab = this.#origAddTab;
            delete window.gBrowser._zentralAddTabHooked;
          } catch (_) {}
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
          folderMenu.removeEventListener("command", this.#folderMenuHandler);
          this.#folderMenuHandler = null;
        }
        document
          .getElementById("zentral-tabgroup-convert-folder-to-group")
          ?.remove();
        document.getElementById("zentral-tabgroup-folder-separator")?.remove();
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
          "context_zenFolderUngroup_sep",
          "context_zenFolderUngroup",
        ];
        idsToRemove.forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.remove();
        });

        // 4. Secure state persistence across restarts: prune deleted groups and capture live hierarchy
        try {
          this.saveTabGroupState();
        } catch (_) {}
        const allGroups = Array.from(
          document.querySelectorAll("tab-group:not([split-view-group])"),
        );

        // 5. Flatten groups cleanly into regular top-level tabs across their respective workspaces
        const rootTabContainer =
          (typeof gZenWorkspaces !== "undefined" &&
            gZenWorkspaces.activeWorkspaceStrip) ||
          gBrowser?.tabContainer?.arrowscrollbox ||
          gBrowser?.tabContainer ||
          document.getElementById("tabbrowser-tabs");

        const sortedGroups = allGroups.slice().sort((a, b) => {
          let depthA = 0,
            currA = a;
          while ((currA = currA.parentElement?.closest("tab-group"))) depthA++;
          let depthB = 0,
            currB = b;
          while ((currB = currB.parentElement?.closest("tab-group"))) depthB++;
          return depthB - depthA;
        });

        sortedGroups.forEach((group) => {
          try {
            const obs = this.#groupObservers.get(group);
            if (obs) {
              obs.disconnect();
              this.#groupObservers.delete(group);
            }

            if (group.shadowRoot) {
              group.shadowRoot
                .querySelectorAll(".zentral-shadow-style")
                .forEach((s) => s.remove());
            }

            const wsId = this.getWorkspaceForElement(group);
            const wsNormalSection =
              wsId &&
              window.gZenWorkspaces
                ?.workspaceElement(wsId)
                ?.querySelector(".zen-workspace-normal-tabs-section");
            const parentContainer =
              group.parentNode && group.parentNode.isConnected
                ? group.parentNode
                : wsNormalSection || rootTabContainer;

            const tabs = Array.from(
              group.querySelectorAll("tab, tabbrowser-tab, .tabbrowser-tab"),
            ).filter((t) => t.closest("tab-group") === group);

            // Move tabs directly before the group container in its workspace
            tabs.forEach((tab) => {
              if (group.parentNode && group.parentNode === parentContainer) {
                try {
                  parentContainer.insertBefore(tab, group);
                } catch (_) {
                  try {
                    parentContainer.appendChild(tab);
                  } catch (_) {}
                }
              } else if (parentContainer) {
                try {
                  parentContainer.appendChild(tab);
                } catch (_) {}
              }

              // Clear native grouping pointers so tabs display as regular flat tabs without indentations
              try {
                if (typeof gBrowser?.addTabToGroup === "function")
                  gBrowser.addTabToGroup(tab, null);
              } catch (_) {}
              try {
                tab.group = null;
              } catch (_) {}
              try {
                tab.removeAttribute("group");
                tab.removeAttribute("zen-group");
              } catch (_) {}
              // Retain data-zentral-group-id, data-zentral-group-ws, and SessionStore for seamless restore on re-enable
            });

            // Cleanly remove the tab-group element so there are no empty gaps in the strip
            try {
              group.remove();
            } catch (_) {}
          } catch (e) {
            console.error(
              "[ZentralTabGroups] Error flattening group on destroy:",
              e,
            );
          }
        });

        // 6. Clean up root attributes
        document.documentElement.removeAttribute("zentral-sidebar-collapsed");
        document.documentElement.removeAttribute("zentral-show-chevron");
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
    sanitizeState(state) {
      if (!state || typeof state !== "object")
        return { groups: {}, tabMapping: {} };
      const groups = { ...(state.groups || {}) };
      const tabMapping = { ...(state.tabMapping || {}) };

      // Find all groups that are parents of other groups
      const parentIds = new Set();
      for (const g of Object.values(groups)) {
        if (g && g.parentId) parentIds.add(g.parentId);
      }

      // Identify zombie groups: 0 tabs and not a parent of any group
      for (const [id, g] of Object.entries(groups)) {
        const tabs = tabMapping[id] || [];
        const isParent = parentIds.has(id);
        const hasNoTabs = !tabs || tabs.length === 0;
        const cleanLabel = (g?.label || "")
          .replace(/[\u200B-\u200D\uFEFF]/g, "")
          .trim();

        if (hasNoTabs && !isParent) {
          delete groups[id];
          delete tabMapping[id];
        } else if (!cleanLabel && hasNoTabs) {
          delete groups[id];
          delete tabMapping[id];
        }
      }

      return { groups, tabMapping };
    }

    /**
     * Reconstructs tab-group containers from tabs tagged with data-zentral-group-* attributes, SessionStore values, or saved state.
     */
    reconstructSavedGroups() {
      try {
        const ss = this.#getSessionStore();

        // 0. Scrub any empty ghost groups lingering in the DOM (0 tabs and 0 child groups)
        document
          .querySelectorAll(
            "tab-group:not([split-view-group]):not([zen-split-view]):not([is-zen-split])",
          )
          .forEach((g) => {
            const directTabs = g.querySelectorAll(
              "tab, tabbrowser-tab, .tabbrowser-tab",
            );
            const childGroups = g.querySelectorAll("tab-group");
            if (
              directTabs.length === 0 &&
              childGroups.length === 0 &&
              !this.#state.creatingGroup
            ) {
              try {
                g.remove();
              } catch (_) {}
            }
          });

        let savedState = null;
        try {
          const stateStr = Core.getPref(Constants.TabGroups.PREF_STATE);
          if (stateStr && stateStr !== "{}") {
            savedState = this.sanitizeState(JSON.parse(stateStr));
          }
        } catch (_) {}

        const savedGroupsMap =
          savedState && savedState.groups
            ? savedState.groups
            : savedState || {};
        const savedTabMapping =
          savedState && savedState.tabMapping ? savedState.tabMapping : {};

        const getAllTabs = () => {
          const tabSet = new Set();
          if (window.gZenWorkspaces?.allStoredTabs) {
            try {
              for (const t of window.gZenWorkspaces.allStoredTabs) {
                if (t) tabSet.add(t);
              }
            } catch (_) {}
          }
          try {
            document
              .querySelectorAll("tab, tabbrowser-tab, .tabbrowser-tab")
              .forEach((t) => tabSet.add(t));
          } catch (_) {}
          try {
            if (gBrowser?.tabs) {
              for (const t of gBrowser.tabs) {
                if (t) tabSet.add(t);
              }
            }
          } catch (_) {}
          return Array.from(tabSet);
        };

        const allTabs = getAllTabs();
        const groupsToReconstruct = new Map();

        // 1. Match tabs to groups using DOM attributes, SessionStore, or unique zenTabId fallback
        allTabs.forEach((tab) => {
          if (
            tab.hasAttribute?.("is-zen-split") ||
            tab.hasAttribute?.("zen-split-view") ||
            tab.closest?.(
              "tab-group[split-view-group], tab-group[zen-split-view], tab-group[is-zen-split]",
            )
          ) {
            return;
          }

          let groupId = tab.getAttribute("data-zentral-group-id");
          if (!groupId && ss && typeof ss.getCustomTabValue === "function") {
            groupId = ss.getCustomTabValue(tab, "zentral-group-id");
          }

          // Fallback: match by unique zenTabId only (never loose URL matching)
          if (!groupId && savedTabMapping) {
            const zenTabId = tab.getAttribute("zen-tab-id") || tab.id;
            if (zenTabId) {
              for (const [gId, tabList] of Object.entries(savedTabMapping)) {
                if (
                  Array.isArray(tabList) &&
                  tabList.some((item) => item.zenTabId === zenTabId)
                ) {
                  groupId = gId;
                  break;
                }
              }
            }
          }

          if (groupId) {
            if (!groupsToReconstruct.has(groupId)) {
              const savedMeta = savedGroupsMap[groupId] || {};
              const label =
                tab.getAttribute("data-zentral-group-label") ||
                ss?.getCustomTabValue?.(tab, "zentral-group-label") ||
                savedMeta.label ||
                "Group";
              const color =
                tab.getAttribute("data-zentral-group-color") ||
                ss?.getCustomTabValue?.(tab, "zentral-group-color") ||
                savedMeta.color ||
                "";
              const parentId =
                tab.getAttribute("data-zentral-parent-id") ||
                ss?.getCustomTabValue?.(tab, "zentral-parent-id") ||
                savedMeta.parentId ||
                null;
              const collapsed =
                tab.getAttribute("data-zentral-group-collapsed") === "true" ||
                ss?.getCustomTabValue?.(tab, "zentral-group-collapsed") ===
                  "true" ||
                savedMeta.collapsed === true;
              const wsId =
                tab.getAttribute("data-zentral-group-ws") ||
                ss?.getCustomTabValue?.(tab, "zentral-group-ws") ||
                savedMeta.workspaceId ||
                "";
              const index = savedMeta.index ?? 0;

              groupsToReconstruct.set(groupId, {
                id: groupId,
                label,
                color,
                parentId,
                collapsed,
                workspaceId: wsId,
                index,
                nextTabZenId: savedMeta.nextTabZenId || null,
                nextGroupId: savedMeta.nextGroupId || null,
                prevTabZenId: savedMeta.prevTabZenId || null,
                prevGroupId: savedMeta.prevGroupId || null,
                tabs: [],
              });
            }
            groupsToReconstruct.get(groupId).tabs.push(tab);
          }
        });

        // 2. Add missing legitimate parent groups for any matched child groups
        if (savedGroupsMap) {
          let addedParent = true;
          while (addedParent) {
            addedParent = false;
            const currentGroups = Array.from(groupsToReconstruct.values());
            for (const g of currentGroups) {
              if (
                g.parentId &&
                !groupsToReconstruct.has(g.parentId) &&
                savedGroupsMap[g.parentId]
              ) {
                const meta = savedGroupsMap[g.parentId];
                groupsToReconstruct.set(g.parentId, {
                  id: meta.id,
                  label: meta.label || "Group",
                  color: meta.color || "",
                  parentId: meta.parentId || null,
                  collapsed: meta.collapsed === true,
                  workspaceId: meta.workspaceId || "",
                  index: meta.index ?? 0,
                  nextTabZenId: meta.nextTabZenId || null,
                  nextGroupId: meta.nextGroupId || null,
                  prevTabZenId: meta.prevTabZenId || null,
                  prevGroupId: meta.prevGroupId || null,
                  tabs: [],
                });
                addedParent = true;
              }
            }
          }
        }

        // Ensure all groups in groupsToReconstruct have their matching tabs populated
        for (const [gId, info] of groupsToReconstruct.entries()) {
          if (info.tabs.length === 0) {
            const memberTabs = allTabs.filter((t) => {
              const tabGId =
                t.getAttribute("data-zentral-group-id") ||
                ss?.getCustomTabValue?.(t, "zentral-group-id");
              if (tabGId === gId) return true;
              if (savedTabMapping && Array.isArray(savedTabMapping[gId])) {
                const zenTabId = t.getAttribute("zen-tab-id") || t.id;
                return (
                  zenTabId &&
                  savedTabMapping[gId].some(
                    (item) => item.zenTabId === zenTabId,
                  )
                );
              }
              return false;
            });
            info.tabs.push(...memberTabs);
          }
        }

        if (groupsToReconstruct.size === 0) return;

        Core.log(
          "ZentralTabGroups",
          `Reconstructing ${groupsToReconstruct.size} groups...`,
        );

        const rootTabContainer =
          (typeof gZenWorkspaces !== "undefined" &&
            gZenWorkspaces.activeWorkspaceStrip) ||
          gBrowser?.tabContainer?.arrowscrollbox ||
          gBrowser?.tabContainer ||
          document.getElementById("tabbrowser-tabs");

        // 2. Sort groups in topological order (parents first, then nested child groups by depth)
        const getGroupDepth = (id, visited = new Set()) => {
          if (visited.has(id)) return 0;
          visited.add(id);
          const pId = groupsToReconstruct.get(id)?.parentId;
          if (!pId || !groupsToReconstruct.has(pId)) return 0;
          return 1 + getGroupDepth(pId, visited);
        };

        const sortedGroupIds = Array.from(groupsToReconstruct.keys()).sort(
          (a, b) => {
            const depthA = getGroupDepth(a);
            const depthB = getGroupDepth(b);
            if (depthA !== depthB) return depthA - depthB;
            const idxA = groupsToReconstruct.get(a).index ?? 0;
            const idxB = groupsToReconstruct.get(b).index ?? 0;
            return idxA - idxB;
          },
        );

        // Helper to instantiate a fully-structured tab-group DOM element
        const createGroupElement = (info) => {
          // Guard: Never create an empty group element if it has 0 tabs and no child groups
          const hasChildren = Array.from(groupsToReconstruct.values()).some(
            (g) => g.parentId === info.id,
          );
          if (info.tabs.length === 0 && !hasChildren) {
            return null;
          }

          let group = document.getElementById(info.id);
          if (group) {
            // If this group already exists in the DOM as a native Zen split view, skip it entirely.
            if (
              group.hasAttribute("split-view-group") ||
              group.hasAttribute("zen-split-view") ||
              group.hasAttribute("is-zen-split")
            ) {
              return null;
            }
          } else {
            group = document.createXULElement
              ? document.createXULElement("tab-group")
              : document.createElement("tab-group");
            group.id = info.id;
          }
          group.setAttribute("label", info.label || "Group");
          group.label = info.label || "Group";
          if (info.workspaceId)
            group.setAttribute("zen-workspace-id", info.workspaceId);

          // Guarantee full internal structure exists
          let labelContainer = group.querySelector(
            ".tab-group-label-container",
          );
          if (!labelContainer) {
            labelContainer = document.createElement("div");
            labelContainer.className = "tab-group-label-container";
            group.insertBefore(labelContainer, group.firstChild);
          }
          let innerLabel = labelContainer.querySelector(".tab-group-label");
          if (!innerLabel) {
            innerLabel = document.createElement("label");
            innerLabel.className = "tab-group-label";
            labelContainer.appendChild(innerLabel);
          }
          innerLabel.textContent = info.label || "Group";

          let groupTabContainer = group.querySelector(".tab-group-container");
          if (!groupTabContainer) {
            groupTabContainer = document.createElement("div");
            groupTabContainer.className = "tab-group-container";
            group.appendChild(groupTabContainer);
          }

          return group;
        };

        // 3. Create and place each group in DOM, preserving parent-child nesting
        sortedGroupIds.forEach((gId) => {
          try {
            const info = groupsToReconstruct.get(gId);
            const group = createGroupElement(info);
            if (!group) return; // Skipped — native split view group

            // Determine correct insertion parent: nested inside parentGroup or at rootTabContainer
            let parentEl = null;
            if (info.parentId && groupsToReconstruct.has(info.parentId)) {
              const parentGroup = document.getElementById(info.parentId);
              if (parentGroup && !group.contains(parentGroup)) {
                parentEl =
                  parentGroup.querySelector(".tab-group-container") ||
                  parentGroup;
              }
            }

            if (!parentEl) {
              // 1. If group has an explicit workspaceId, find that workspace's normal tabs container
              const wsId = info.workspaceId;
              if (wsId && window.gZenWorkspaces) {
                const wsEl = window.gZenWorkspaces.workspaceElement(wsId);
                const normalSection =
                  wsEl?.querySelector(".zen-workspace-normal-tabs-section") ||
                  wsEl;
                if (normalSection) {
                  parentEl = normalSection;
                }
              }
            }

            if (!parentEl) {
              if (info.tabs.length > 0 && info.tabs[0].parentNode) {
                const candidateParent = info.tabs[0].parentNode;
                // Guard: if the candidate parent is inside the group itself (e.g. .tab-group-container),
                // using it as parentEl would cause HierarchyRequestError on insertBefore.
                if (
                  candidateParent &&
                  candidateParent !== group &&
                  !group.contains(candidateParent)
                ) {
                  parentEl = candidateParent;
                } else {
                  parentEl = rootTabContainer;
                }
              } else {
                parentEl = rootTabContainer;
              }
            }

            // Only move the group if it's completely disconnected or in the wrong parent.
            // This preserves native session restore absolute positioning for root groups.
            const currentParent = group.parentNode;
            const isInCorrectParent =
              currentParent === parentEl ||
              currentParent === parentEl.parentNode;

            if (!group.isConnected || !isInCorrectParent) {
              let targetNode = null;

              if (info.nextTabZenId) {
                targetNode =
                  Array.from(parentEl.children).find((el) => {
                    const isTab =
                      el.tagName?.toLowerCase() === "tab" ||
                      el.classList?.contains("tabbrowser-tab");
                    return (
                      isTab &&
                      (el.getAttribute("zen-tab-id") === info.nextTabZenId ||
                        el.id === info.nextTabZenId)
                    );
                  }) || null;
              }
              if (!targetNode && info.nextGroupId) {
                targetNode =
                  Array.from(parentEl.children).find(
                    (el) =>
                      el.tagName?.toLowerCase() === "tab-group" &&
                      el.id === info.nextGroupId,
                  ) || null;
              }
              if (!targetNode && info.prevTabZenId) {
                const prevEl = Array.from(parentEl.children).find((el) => {
                  const isTab =
                    el.tagName?.toLowerCase() === "tab" ||
                    el.classList?.contains("tabbrowser-tab");
                  return (
                    isTab &&
                    (el.getAttribute("zen-tab-id") === info.prevTabZenId ||
                      el.id === info.prevTabZenId)
                  );
                });
                if (prevEl) targetNode = prevEl.nextElementSibling;
              }
              if (!targetNode && info.prevGroupId) {
                const prevEl = Array.from(parentEl.children).find(
                  (el) =>
                    el.tagName?.toLowerCase() === "tab-group" &&
                    el.id === info.prevGroupId,
                );
                if (prevEl) targetNode = prevEl.nextElementSibling;
              }
              if (
                !targetNode &&
                typeof info.index === "number" &&
                info.index >= 0 &&
                info.index < parentEl.children.length
              ) {
                targetNode = parentEl.children[info.index];
              }

              if (targetNode && targetNode !== group) {
                parentEl.insertBefore(group, targetNode);
              } else {
                parentEl.appendChild(group);
              }
            }

            // Move member tabs into this group container
            const targetTabContainer =
              group.querySelector(".tab-group-container") || group;
            info.tabs.forEach((tab) => {
              if (tab.parentNode !== targetTabContainer) {
                try {
                  targetTabContainer.appendChild(tab);
                } catch (_) {}
              }
              try {
                tab.group = group;
              } catch (_) {}
              try {
                tab.setAttribute("group", group.id);
              } catch (_) {}
              try {
                tab.setAttribute("zen-group", group.id);
              } catch (_) {}
              try {
                if (typeof gBrowser?.addTabToGroup === "function")
                  gBrowser.addTabToGroup(tab, group);
              } catch (_) {}

              // Preserve tracking attributes on tabs for resilience
              tab.setAttribute("data-zentral-group-id", group.id);
              if (info.label)
                tab.setAttribute("data-zentral-group-label", info.label);
              if (info.color)
                tab.setAttribute("data-zentral-group-color", info.color);
              if (info.workspaceId) {
                tab.setAttribute("data-zentral-group-ws", info.workspaceId);
                tab.setAttribute("zen-workspace-id", info.workspaceId);
              }
            });

            // Restore colors
            let savedColorsMap = {};
            try {
              const rawColors = Core.getPref(Constants.TabGroups.PREF_COLORS);
              if (rawColors && rawColors !== "{}")
                savedColorsMap = JSON.parse(rawColors) || {};
            } catch (_) {}
            const savedColor =
              info.color || savedColorsMap[gId] || savedGroupsMap[gId]?.color;
            if (savedColor) {
              group.style.setProperty("--tab-group-color", savedColor);
              group.style.setProperty("--tab-group-color-invert", savedColor);
              group.style.setProperty("--zentral-custom-color", savedColor);
              group.style.setProperty(
                "--zentral-tabgroup-contrast-color",
                this.getContrastColor(savedColor),
              );
            }

            // Restore collapsed state
            if (info.collapsed) {
              group.setAttribute("collapsed", "true");
              group.collapsed = true;
            } else {
              group.removeAttribute("collapsed");
              group.collapsed = false;
            }

            this.processGroup(group);
          } catch (err) {
            console.error(
              `[ZentralTabGroups] Error reconstructing group ${gId}:`,
              err,
            );
          }
        });
        this.scheduleBadgeUpdate();
      } catch (e) {
        console.error("[ZentralTabGroups] Error in reconstructSavedGroups:", e);
      }
    }

    /* --------------------------------------------------------------------------
     * 4.2 Custom CSS & Visual Enhancements
     * --------------------------------------------------------------------------
     */

    /**
     * Updates the collapsed sidebar marquee label with clean text, clone, and overflow duration.
     * @param {Element} labelContainer - Group label container element.
     * @param {string} title - Group title text.
     */
    updateCollapsedLabel(labelContainer, title) {
      if (!labelContainer) return;
      let initialsEl = labelContainer.querySelector(".zentral-group-initials");
      if (!initialsEl) {
        initialsEl = document.createElement("div");
        initialsEl.className = "zentral-group-initials";
        const wrapper = labelContainer.querySelector(
          ".zentral-tab-title-wrapper",
        );
        if (wrapper) wrapper.appendChild(initialsEl);
        else labelContainer.appendChild(initialsEl);
      }

      const cleanTitle = (title || "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim();
      initialsEl.setAttribute("data-title", cleanTitle);

      const charCount = cleanTitle.length;
      const isOverflowing = charCount > 3;
      if (isOverflowing) {
        initialsEl.setAttribute("data-overflows", "true");
        // Calculate adaptive scroll duration (~30px/s)
        const durationSec = Math.max(
          2.5,
          Math.min(8.0, (charCount * 8 + 24) / 30),
        ).toFixed(1);
        initialsEl.style.setProperty(
          "--zentral-marquee-duration",
          `${durationSec}s`,
        );
      } else {
        initialsEl.removeAttribute("data-overflows");
        initialsEl.style.removeProperty("--zentral-marquee-duration");
      }

      initialsEl.replaceChildren();

      const track = document.createElement("span");
      track.className = "zentral-marquee-track";

      const item1 = document.createElement("span");
      item1.className = "zentral-marquee-item";
      const text1 = document.createElement("span");
      text1.className = "zentral-marquee-text";
      text1.textContent = cleanTitle;
      const spacer1 = document.createElement("span");
      spacer1.className = "zentral-marquee-spacer";
      spacer1.textContent = " • ";
      item1.appendChild(text1);
      item1.appendChild(spacer1);
      track.appendChild(item1);

      if (isOverflowing) {
        const item2 = document.createElement("span");
        item2.className = "zentral-marquee-item";
        item2.setAttribute("aria-hidden", "true");
        const text2 = document.createElement("span");
        text2.className = "zentral-marquee-text";
        text2.textContent = cleanTitle;
        const spacer2 = document.createElement("span");
        spacer2.className = "zentral-marquee-spacer";
        spacer2.textContent = " • ";
        item2.appendChild(text2);
        item2.appendChild(spacer2);
        track.appendChild(item2);
      }

      initialsEl.appendChild(track);
    }

    /**
     * Safely schedules or executes hiding of the tab group tooltip panel,
     * ensuring it does NOT close if the user is currently hovering over the popup or label.
     * @param {number} [delayMs=350] - Delay before hide check in milliseconds.
     */
    safeHideTooltip(delayMs = 350) {
      if (window.zentralTooltipHideTimer) {
        clearTimeout(window.zentralTooltipHideTimer);
        window.zentralTooltipHideTimer = null;
      }
      window.zentralTooltipHideTimer = setTimeout(() => {
        const panel = document.getElementById("zentral-tabgroup-tooltip");
        const container = document.getElementById(
          "zentral-tabgroup-tooltip-container",
        );
        if (!panel || typeof panel.hidePopup !== "function") return;

        // Check if mouse is currently hovering over panel, container, or active label
        const isHovered =
          (panel.matches && panel.matches(":hover")) ||
          (container && container.matches && container.matches(":hover")) ||
          !!document.querySelector('[zentral-hover="true"]:hover');

        if (isHovered) {
          // User is hovering the popup or label ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â keep it open!
          return;
        }

        panel.hidePopup();
      }, delayMs);
    }

    /**
     * Retrieves only the direct tabs belonging to a group, excluding tabs inside nested child groups.
     * @param {Element} group - Tab group DOM element.
     * @returns {Array<Element>} Array of direct tab elements.
     */
    getDirectTabs(group) {
      if (!group) return [];

      const domTabs = Array.from(
        group.querySelectorAll(
          "tab, tabbrowser-tab, .tabbrowser-tab, [is='tabbrowser-tab']",
        ),
      );
      const nativeTabs = group.tabs ? Array.from(group.tabs) : [];
      const combined = Array.from(new Set([...domTabs, ...nativeTabs]));

      let directTabs = combined.filter((t) => {
        if (!t) return false;

        // Exclude if physically located inside a nested child tab-group
        const closest = t.closest ? t.closest("tab-group") : null;
        if (closest && closest !== group) return false;

        // Exclude if tab references a different group
        if (t.group && t.group !== group) return false;
        const tGId =
          t.getAttribute?.("group") ||
          t.getAttribute?.("zen-group") ||
          t.getAttribute?.("data-zentral-group-id");
        if (tGId && group.id && tGId !== group.id) return false;

        return true;
      });

      if (directTabs.length === 0 && window.gBrowser?.tabs) {
        directTabs = Array.from(gBrowser.tabs).filter((t) => {
          if (!t) return false;
          const closest = t.closest ? t.closest("tab-group") : null;
          if (closest && closest !== group) return false;
          if (t.group && t.group !== group) return false;
          const tGId =
            t.getAttribute?.("group") ||
            t.getAttribute?.("zen-group") ||
            t.getAttribute?.("data-zentral-group-id");
          if (tGId && group.id && tGId !== group.id) return false;
          return (
            t.group === group ||
            (group.id && tGId === group.id) ||
            closest === group
          );
        });
      }

      return directTabs;
    }

    /**
     * Initializes Tab Groups module observers, styles, color palettes, and tooltip containers.
     */
    init() {
      if (
        typeof PrivateBrowsingUtils !== "undefined" &&
        PrivateBrowsingUtils.isWindowPrivate(window)
      ) {
        Core.log("ZentralTabGroups", "Tab Groups disabled in private window.");
        return;
      }
      if (!Core.getPref(Constants.TabGroups.PREF_ENABLED)) {
        Core.log("ZentralTabGroups", "Tab Groups feature is disabled.");
        return;
      }
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
      this.initTabDragSelectionGuard();
      this.processExistingGroups();
      this.setupTabOpenHandler();
      this.hookAddTab();
      document.addEventListener("TabGroupCreate", this.onTabGroupCreate, true);
      document.addEventListener("tabgroupcreated", this.onTabGroupCreate, true);
      this.#groupColorEventListener = (e) => {
        const group =
          e.target?.closest?.("tab-group:not([split-view-group])") ||
          (e.target?.tagName === "TAB-GROUP" ? e.target : null);
        if (group && !this.#isRestoring)
          this.checkAndApplyFirstTimeGroupColor(group);
      };
      document.addEventListener(
        "TabGroupCreateByUser",
        this.#groupColorEventListener,
        true,
      );
      document.addEventListener(
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
          document
            .querySelectorAll("tab-group:not([split-view-group])")
            .forEach((g) => this.processGroup(g));
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
          document
            .querySelectorAll("tab-group:not([split-view-group])")
            .forEach((g) => this.processGroup(g));
        } catch (_) {}
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
            document.documentElement.getAttribute("zen-sidebar-collapsed") ===
              "true" ||
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

      // Clean up pref observer on window close to prevent ghost observers (H-03)
      window.addEventListener(
        "unload",
        () => {
          try {
            Services.prefs.removeObserver(
              "zen.view.sidebar-expanded",
              updateSidebarAttr,
            );
            Services.prefs.removeObserver(
              "zen.view.use-single-toolbar",
              updateSidebarAttr,
            );
            this.#rootAttrObs?.disconnect();
          } catch (_) {}
        },
        { once: true },
      );

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

        panel.addEventListener("mouseenter", cancelHideTimer);
        panel.addEventListener("mouseleave", () => this.safeHideTooltip(350));
        panel.addEventListener("mouseover", cancelHideTimer);

        const container = document.createElement("div");
        container.id = "zentral-tabgroup-tooltip-container";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.overflowY = "auto";
        container.addEventListener("mouseenter", cancelHideTimer);
        container.addEventListener("mouseleave", () =>
          this.safeHideTooltip(350),
        );
        container.addEventListener("mouseover", cancelHideTimer);
        panel.appendChild(container);

        const popupset =
          document.getElementById("mainPopupSet") || document.documentElement;
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
    applyChevronPref() {
      const showChevron = Core.getPref(Constants.TabGroups.PREF_SHOW_CHEVRON);
      document.documentElement.setAttribute(
        "zentral-show-chevron",
        showChevron !== false ? "true" : "false",
      );
    }

    /**
     * Reads indicator_type preference ("circle"|"chevron") and sets zentral-indicator-type attribute on root.
     */
    applyIndicatorTypePref() {
      const indicatorType = Core.getPref(
        Constants.TabGroups.PREF_INDICATOR_TYPE,
        "circle",
      );
      document.documentElement.setAttribute(
        "zentral-indicator-type",
        indicatorType === "chevron" ? "chevron" : "circle",
      );
    }

    /**
     * Reads label_opacity preference (0-100) and sets --zentral-tabgroup-label-opacity CSS variable and state attribute on root.
     */
    applyLabelOpacityPref() {
      const opacityPct = Core.getPref(Constants.TabGroups.PREF_LABEL_OPACITY);
      const val =
        typeof opacityPct === "number"
          ? Math.max(0, Math.min(100, opacityPct))
          : 85;
      document.documentElement.style.setProperty(
        "--zentral-tabgroup-label-opacity",
        (val / 100).toFixed(2),
      );
      document.documentElement.setAttribute(
        "zentral-label-opacity-below-85",
        val < 85 ? "true" : "false",
      );
    }

    /**
     * Injects CSS styles for customized tab group pills, initial badges, and color pickers.
     */
    injectStyles() {
      const css = `

        /* Suppress Native Firefox/Zen Tab Group Editor Popups */
        #tab-group-editor,
        #tabgroup-editor-panel,
        #tabGroupEditor,
        tabgroup-editor-panel,
        .tab-group-editor,
        #tabGroupContextMenu,
        tabgroup-meu,
        panel[id*="tab-group-editor"],
        panel[id*="tabgroup-editor"] {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
          height: 0 !important;
          width: 0 !important;
        }

        /* Zentral Tooltip Styling (Matched to native Zen tab previews) */
        #zentral-tabgroup-tooltip {
          --panel-background: transparent !important;
          --panel-border-color: transparent !important;
          background: transparent !important;
          border: none !important;
        }
        #zentral-tabgroup-tooltip::part(content) {
          border: none !important;
          background: transparent !important;
          padding: 0 !important;
          box-shadow: none !important;
        }
        #zentral-tabgroup-tooltip-container {
          background: var(--zen-colors-tertiary, var(--arrowpanel-background, var(--tabpanels-background-color, #1e1e22))) !important;
          color: var(--zen-colors-text, var(--arrowpanel-color, var(--in-content-page-color, #fbfbfe))) !important;
          border: 1px solid var(--zen-colors-border, var(--arrowpanel-border-color, color-mix(in srgb, currentColor 12%, rgba(255, 255, 255, 0.08)))) !important;
          border-radius: 12px !important;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 0 0 1px color-mix(in srgb, currentColor 8%, transparent) !important;
          padding: 6px !important;
          gap: 2px !important;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          font-size: 13px !important;
          line-height: 1.4 !important;
          max-height: 320px !important;
        }
        .zentral-tooltip-row {
          position: relative !important;
          padding: 6px 10px !important;
          border-radius: 8px !important;
          cursor: pointer !important;
          border: 1px solid transparent !important;
          box-sizing: border-box !important;
          transition: background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease !important;
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
          max-width: 320px !important;
        }
        #tab-label-input {
          background: rgba(0, 0, 0, 0.3) !important;
          border: 1px solid color-mix(in srgb, currentColor 40%, transparent) !important;
          border-radius: 6px !important;
          color: var(--zentral-tabgroup-contrast-color, #ffffff) !important;
          font-size: 13.5px !important;
          font-weight: 600 !important;
          font-family: inherit !important;
          text-align: center !important;
          padding: 2px 6px !important;
          margin: 0 !important;
          outline: none !important;
          width: 100% !important;
          max-width: 180px !important;
          box-sizing: border-box !important;
          order: 2 !important;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.3) !important;
        }
        .zentral-tooltip-row:hover {
          background-color: color-mix(in srgb, currentColor 10%, transparent) !important;
        }
        .zentral-tooltip-row[data-active="true"] {
          background-color: color-mix(in srgb, var(--zen-primary-color, #707ac2) 24%, rgba(255, 255, 255, 0.12)) !important;
          border: 1px solid color-mix(in srgb, var(--zen-primary-color, #707ac2) 45%, transparent) !important;
          opacity: 1 !important;
        }
        .zentral-tooltip-row[data-active="true"] .zentral-tooltip-title {
          color: var(--zen-primary-color, currentColor) !important;
          font-weight: 600 !important;
        }
        .zentral-tooltip-row[data-unloaded="true"]:not([data-active="true"]) {
          opacity: 0.55 !important;
        }
        .zentral-tooltip-row[data-unloaded="true"]:not([data-active="true"]):hover {
          opacity: 0.88 !important;
        }
        .zentral-tooltip-close-btn {
          appearance: none !important;
          background: transparent !important;
          border: none !important;
          border-radius: 6px !important;
          color: inherit !important;
          padding: 3px !important;
          width: 22px !important;
          height: 22px !important;
          cursor: pointer !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          opacity: 0 !important;
          pointer-events: none !important;
          transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease !important;
          flex-shrink: 0 !important;
          margin-left: auto !important;
        }
        .zentral-tooltip-row:hover .zentral-tooltip-close-btn {
          opacity: 0.65 !important;
          pointer-events: auto !important;
        }
        .zentral-tooltip-close-btn:hover {
          opacity: 1 !important;
          background-color: rgba(255, 77, 77, 0.22) !important;
          color: #ff5555 !important;
        }
        .zentral-tooltip-close-btn svg {
          width: 12px !important;
          height: 12px !important;
          fill: none !important;
          stroke: currentColor !important;
          stroke-width: 2 !important;
          stroke-linecap: round !important;
          stroke-linejoin: round !important;
          display: block !important;
        }
        .zentral-tooltip-text-col {
          display: flex !important;
          flex-direction: column !important;
          min-width: 0 !important;
          flex: 1 !important;
        }
        .zentral-tooltip-title {
          font-size: 12.5px !important;
          font-weight: 500 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          color: inherit !important;
        }
        .zentral-tooltip-domain {
          font-size: 10.5px !important;
          opacity: 0.65 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          margin-top: 1px !important;
          color: inherit !important;
        }

        /* Zentral Color Picker Panel Styling */
        #zentral-group-color-picker,
        #zentral-group-color-picker::part(content),
        #zentral-group-color-picker::part(arrow),
        panel#zentral-group-color-picker,
        #zentral-group-color-picker .panel-arrowcontent,
        #zentral-group-color-picker .panel-subview-body {
          --panel-background: transparent !important;
          --panel-border-color: transparent !important;
          --panel-box-shadow: none !important;
          --panel-padding: 0 !important;
          --arrowpanel-background: transparent !important;
          --arrowpanel-border-color: transparent !important;
          --arrowpanel-border-radius: 0px !important;
          --arrowpanel-borderRadius: 0px !important;
          --arrowpanel-box-shadow: none !important;
          --arrowpanel-padding: 0 !important;
          --arrowpanel-margin: 0 !important;
          border: none !important;
          background: transparent !important;
          background-color: transparent !important;
          box-shadow: none !important;
          outline: none !important;
          padding: 0 !important;
          margin: 0 !important;
        }

        .zentral-tg-cp-box {
          padding: 12px 14px 14px 14px !important;
          gap: 10px !important;
          background: #1e1e24 !important;
          color: var(--in-content-page-color, #fbfbfe) !important;
          border: 1px solid color-mix(in srgb, currentColor 14%, rgba(255, 255, 255, 0.12)) !important;
          border-radius: 18px !important;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.75) !important;
          width: 184px !important;
          box-sizing: border-box !important;
          margin: 0 !important;
          overflow: visible !important;
        }

        .zentral-color-swatch {
          width: 24px !important;
          height: 24px !important;
          border-radius: 50% !important;
          cursor: pointer !important;
          border: 1px solid color-mix(in srgb, currentColor 15%, transparent) !important;
          box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15) !important;
          transition: transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.15s ease !important;
        }

        .zentral-color-swatch:hover {
          transform: scale(1.15) !important;
          box-shadow: 0 4px 10px rgba(0,0,0,0.35) !important;
          z-index: 2 !important;
        }

        .zentral-tg-btn {
          flex: 1 !important;
          padding: 6px 8px !important;
          border: 1px solid color-mix(in srgb, currentColor 14%, transparent) !important;
          background: color-mix(in srgb, currentColor 8%, transparent) !important;
          color: inherit !important;
          cursor: pointer !important;
          border-radius: 8px !important;
          font-size: 11px !important;
          font-weight: 500 !important;
          transition: all 0.15s ease !important;
          outline: none !important;
        }

        .zentral-tg-btn:hover {
          background: color-mix(in srgb, currentColor 14%, transparent) !important;
          border-color: color-mix(in srgb, currentColor 22%, transparent) !important;
        }

        .zentral-tg-btn:active {
          transform: scale(0.97) !important;
        }

        .zentral-tg-input {
          font-size: 11px !important;
          font-weight: 500 !important;
          padding: 5px 6px !important;
          border-radius: 8px !important;
          background: color-mix(in srgb, currentColor 8%, transparent) !important;
          color: inherit !important;
          border: 1px solid color-mix(in srgb, currentColor 14%, transparent) !important;
          text-align: center !important;
          outline: none !important;
          transition: all 0.15s ease !important;
        }

        .zentral-tg-input:focus {
          border-color: var(--zen-primary-color, #70a0ff) !important;
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--zen-primary-color, #70a0ff) 25%, transparent) !important;
        }

        .zentral-tg-drag-handle {
          width: 100% !important;
          height: 18px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          cursor: grab !important;
          margin-top: -2px !important;
          margin-bottom: 2px !important;
          user-select: none !important;
          -moz-user-select: none !important;
        }

        .zentral-tg-drag-handle:active {
          cursor: grabbing !important;
        }

        .zentral-tg-drag-pill {
          width: 32px !important;
          height: 4px !important;
          border-radius: 2px !important;
          background: color-mix(in srgb, currentColor 22%, transparent) !important;
          transition: background 0.15s ease, width 0.15s ease !important;
          pointer-events: none !important;
        }

        .zentral-tg-drag-handle:hover .zentral-tg-drag-pill {
          background: color-mix(in srgb, currentColor 45%, transparent) !important;
          width: 40px !important;
        }
      `;
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
    setupTabOpenHandler() {
      if (this.#tabOpenListener) return;
      this.#tabOpenListener = (e) => {
        const tab = e.target;
        if (!tab || tab.tagName?.toLowerCase() !== "tab") return;

        // 1. App Panel Isolation: If link was opened while an App panel is open, keep outside any group
        const isAppPanelOpen =
          (typeof window.Zentral?.Apps?.isPanelOpen === "function" &&
            window.Zentral.Apps.isPanelOpen()) ||
          document.documentElement.getAttribute("zentral-app-panel-open") ===
            "true" ||
          document.getElementById("zen-app-panel-root")?.hasAttribute("open") ||
          !!document.activeElement?.closest?.(
            "#zen-app-panel-root, #zen-app-panel-slider, .zen-app-panel-wrapper",
          ) ||
          tab._zentralForceUngroup === true;
        if (isAppPanelOpen) {
          const forceUngroup = () => {
            try {
              if (typeof window.gBrowser?.moveTabToEnd === "function") {
                window.gBrowser.moveTabToEnd(tab);
              }
            } catch (_) {}
            tab.removeAttribute("group");
            tab.removeAttribute("zen-group");
            [
              "data-zentral-group-id",
              "data-zentral-group-label",
              "data-zentral-group-color",
              "data-zentral-group-collapsed",
              "data-zentral-group-ws",
            ].forEach((attr) => tab.removeAttribute(attr));

            const ss = this.#getSessionStore();
            if (ss) {
              try {
                ss.deleteCustomTabValue?.(tab, "zentral-group-id");
                ss.deleteCustomTabValue?.(tab, "zentral-group-label");
                ss.deleteCustomTabValue?.(tab, "zentral-group-color");
                ss.deleteCustomTabValue?.(tab, "zentral-group-collapsed");
                ss.deleteCustomTabValue?.(tab, "zentral-group-ws");
              } catch (_) {}
            }
            try {
              window.gBrowser?.tabContainer?._invalidateCachedTabs?.();
            } catch (_) {}
            this.scheduleStateSave();
          };

          forceUngroup();
          window.setTimeout(forceUngroup, 0);
          window.setTimeout(forceUngroup, 50);
          window.setTimeout(forceUngroup, 150);
          return;
        }

        // 2. Resolve origin tab: check ownerTab first (standard Firefox link-click property), fallback to selectedTab
        const originTab = tab.ownerTab || window.gBrowser?.selectedTab;
        if (!originTab || originTab === tab) return;

        // 3. Check if originTab is inside a tab group
        const originGroup =
          originTab.closest?.(
            "tab-group:not([split-view-group]):not([zen-split-view]):not([is-zen-split])",
          ) ||
          (originTab.group &&
          !originTab.group.hasAttribute?.("split-view-group") &&
          !originTab.group.hasAttribute?.("zen-split-view") &&
          !originTab.group.hasAttribute?.("is-zen-split")
            ? originTab.group
            : null);
        if (!originGroup) return;

        // 4. Place new tab inside the same container directly below the original tab
        const targetContainer = originTab.parentNode;
        if (!targetContainer) return;

        try {
          if (
            tab.parentNode !== targetContainer ||
            tab.previousElementSibling !== originTab
          ) {
            targetContainer.insertBefore(tab, originTab.nextSibling);
          }
        } catch (_) {
          try {
            targetContainer.appendChild(tab);
          } catch (_) {}
        }

        // 5. Associate tab with group
        // NOTE: tab.group is a getter-only property on MozTabbrowserTab. We do NOT assign to tab.group.
        // Being inside targetContainer (.tab-group-container), tab.group automatically returns originGroup.
        try {
          tab.setAttribute("group", originGroup.id);
        } catch (_) {}
        if (originGroup.tabs && typeof originGroup.tabs.add === "function") {
          try {
            originGroup.tabs.add(tab);
          } catch (_) {}
        }
        try {
          if (typeof window.gBrowser?.addTabToGroup === "function") {
            window.gBrowser.addTabToGroup(tab, originGroup);
          }
        } catch (_) {}

        const label =
          originGroup.label || originGroup.getAttribute?.("label") || "Group";
        const color =
          originGroup.style.getPropertyValue("--tab-group-color") ||
          originGroup.style.getPropertyValue("--zentral-custom-color") ||
          "";
        tab.setAttribute("data-zentral-group-id", originGroup.id);
        tab.setAttribute("data-zentral-group-label", label);
        if (color) tab.setAttribute("data-zentral-group-color", color);
        tab.setAttribute(
          "data-zentral-group-collapsed",
          originGroup.hasAttribute("collapsed") ? "true" : "false",
        );

        // 6. Context-Aware Expansion:
        // If the new tab is selected/focused in foreground, ensure the group expands so it's visible.
        // If opened in background, maintain the group's current collapsed state.
        if (tab.selected && originGroup.hasAttribute("collapsed")) {
          originGroup.removeAttribute("collapsed");
          originGroup.collapsed = false;
        }

        try {
          window.gBrowser?.tabContainer?._invalidateCachedTabs?.();
        } catch (_) {}

        this.scheduleStateSave();
      };

      if (window.gBrowser?.tabContainer) {
        window.gBrowser.tabContainer.addEventListener(
          "TabOpen",
          this.#tabOpenListener,
        );
      }
    }

    /**
     * Hooks gBrowser.addTab to ensure any tab opened while an App Panel is active
     * is created outside of any group, bypassing Zen's default selectedTab inheritance.
     */
    hookAddTab() {
      if (!window.gBrowser || window.gBrowser._zentralAddTabHooked) return;
      window.gBrowser._zentralAddTabHooked = true;
      this.#origAddTab = window.gBrowser.addTab;
      const self = this;

      window.gBrowser.addTab = function (aURI, aParams = {}) {
        const isAppOpen =
          (typeof window.Zentral?.Apps?.isPanelOpen === "function" &&
            window.Zentral.Apps.isPanelOpen()) ||
          document.documentElement.getAttribute("zentral-app-panel-open") ===
            "true" ||
          document.getElementById("zen-app-panel-root")?.hasAttribute("open") ||
          !!document.activeElement?.closest?.(
            "#zen-app-panel-root, #zen-app-panel-slider, .zen-app-panel-wrapper",
          );

        if (isAppOpen && aParams && typeof aParams === "object") {
          aParams.tabGroup = null;
          aParams.relatedToCurrent = false;
          aParams.insertRelatedAfterCurrent = false;
        }

        const tab = self.#origAddTab.call(this, aURI, aParams);

        if (isAppOpen && tab) {
          tab._zentralForceUngroup = true;
          const forceUngroup = () => {
            try {
              if (typeof window.gBrowser?.moveTabToEnd === "function") {
                window.gBrowser.moveTabToEnd(tab);
              }
            } catch (_) {}
            tab.removeAttribute("group");
            tab.removeAttribute("zen-group");
            [
              "data-zentral-group-id",
              "data-zentral-group-label",
              "data-zentral-group-color",
              "data-zentral-group-collapsed",
              "data-zentral-group-ws",
            ].forEach((a) => tab.removeAttribute(a));
            try {
              window.gBrowser?.tabContainer?._invalidateCachedTabs?.();
            } catch (_) {}
          };
          forceUngroup();
          window.setTimeout(forceUngroup, 0);
          window.setTimeout(forceUngroup, 50);
          window.setTimeout(forceUngroup, 150);
        }

        return tab;
      };
    }

    /**
     * Registers a MutationObserver on the tab strip to track added, removed, or collapsed tab groups.
     */
    setupObserver() {
      const observer = new MutationObserver((mutations) => {
        let needsSave = false;
        let groupsStructureChanged = false;
        for (const mutation of mutations) {
          if (mutation.type === "attributes") {
            const attr = mutation.attributeName;
            if (
              attr === "split-view-group" ||
              attr === "zen-split-view" ||
              attr === "is-zen-split"
            ) {
              const g = mutation.target;
              if (g && g.tagName?.toUpperCase() === "TAB-GROUP") {
                const lc = g.querySelector(
                  ":scope > .tab-group-label-container",
                );
                if (lc) lc.remove();
                groupsStructureChanged = true;
              }
            }
            if (attr === "collapsed") {
              const g = mutation.target;
              const isSplit =
                g.hasAttribute?.("split-view-group") ||
                g.hasAttribute?.("zen-split-view") ||
                g.hasAttribute?.("is-zen-split");
              if (g.tagName?.toUpperCase() === "TAB-GROUP" && !isSplit)
                needsSave = true;
            }
            if (attr === "label") {
              const g = mutation.target;
              if (g && g.tagName?.toUpperCase() === "TAB-GROUP") {
                const lc = g.querySelector(
                  ":scope > .tab-group-label-container",
                );
                if (lc)
                  this.updateCollapsedLabel(
                    lc,
                    g.label || g.getAttribute("label"),
                  );
              }
            }
            continue;
          }

          if (mutation.type === "childList") {
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== Node.ELEMENT_NODE) continue;

              const tag = node.tagName?.toUpperCase();

              if (
                node.id === "tab-group-editor" ||
                tag === "TABGROUP-MEU" ||
                node.querySelector?.("#tab-group-editor, tabgroup-meu")
              ) {
                this.removeBuiltinTabGroupMenu(node);
              }

              if (tag === "TAB-GROUP") {
                groupsStructureChanged = true;
                window.requestAnimationFrame(() => {
                  if (node.isConnected) {
                    const isSplit =
                      node.hasAttribute?.("split-view-group") ||
                      node.hasAttribute?.("zen-split-view") ||
                      node.hasAttribute?.("is-zen-split") ||
                      node.hasAttribute?.("splitview") ||
                      node.classList?.contains?.("zen-split-view");
                    if (!isSplit) {
                      this.processGroup(node);
                      this.checkAndApplyFirstTimeGroupColor(node);
                      this.scheduleStateSave();
                      this.scheduleBadgeUpdate();
                    } else {
                      const lc = node.querySelector(
                        ":scope > .tab-group-label-container",
                      );
                      if (lc) lc.remove();
                    }
                  }
                });
              }

              const childGroups = node.querySelectorAll?.("tab-group") || [];
              if (childGroups.length > 0) {
                groupsStructureChanged = true;
                childGroups.forEach((group) => {
                  window.requestAnimationFrame(() => {
                    if (group.isConnected) {
                      const gSplit =
                        group.hasAttribute?.("split-view-group") ||
                        group.hasAttribute?.("zen-split-view") ||
                        group.hasAttribute?.("is-zen-split") ||
                        group.hasAttribute?.("splitview") ||
                        group.classList?.contains?.("zen-split-view");
                      if (!gSplit) {
                        this.processGroup(group);
                        this.checkAndApplyFirstTimeGroupColor(group);
                        this.scheduleStateSave();
                        this.scheduleBadgeUpdate();
                      } else {
                        const lc = group.querySelector(
                          ":scope > .tab-group-label-container",
                        );
                        if (lc) lc.remove();
                      }
                    }
                  });
                });
              }

              if (tag === "TAB" || tag === "TABBROWSER-TAB") {
                const parentGroup = node.closest
                  ? node.closest("tab-group:not([split-view-group])")
                  : null;
                if (parentGroup && !this.#isRestoring) {
                  this.checkAndApplyFirstTimeGroupColor(parentGroup);
                }
              }
            }

            for (const node of mutation.removedNodes) {
              if (
                node.nodeType === Node.ELEMENT_NODE &&
                node.tagName?.toUpperCase() === "TAB-GROUP"
              ) {
                needsSave = true;
                groupsStructureChanged = true;
                const obs = this.#groupObservers.get(node);
                if (obs) {
                  obs.disconnect();
                  this.#groupObservers.delete(node);
                }
                this.#processedGroups.delete(node);
                if (node.id) {
                  try {
                    this.removeSavedColor(node.id);
                  } catch (_) {}
                  try {
                    const stateStr = Core.getPref(
                      Constants.TabGroups.PREF_STATE,
                    );
                    if (stateStr && stateStr !== "{}") {
                      const parsed = JSON.parse(stateStr);
                      const groups =
                        parsed && parsed.groups ? parsed.groups : parsed || {};
                      const tabMapping =
                        parsed && parsed.tabMapping ? parsed.tabMapping : {};
                      delete groups[node.id];
                      delete tabMapping[node.id];
                      Core.setPref(
                        Constants.TabGroups.PREF_STATE,
                        JSON.stringify({ groups, tabMapping }),
                      );
                    }
                  } catch (_) {}
                }
              }
            }
          }
        }

        if (needsSave) this.scheduleStateSave();
        if (groupsStructureChanged) this.scheduleBadgeUpdate();
      });
      const tabContainer =
        document.getElementById("tabbrowser-tabs") || document.body;
      observer.observe(tabContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "collapsed",
          "split-view-group",
          "zen-split-view",
          "is-zen-split",
          "label",
        ],
      });
      this.#tabStripObserver = observer;

      if (!this.#groupRightClickBlocker) {
        this.#groupRightClickBlocker = (event) => {
          if (event.button !== 2) return;
          const target = event.target;
          if (target.closest("#tab-label-input")) return;
          const group = target.closest("tab-group:not([split-view-group])");
          if (!group) return;
          const isHeader =
            target.closest(".tab-group-label-container") ||
            target.closest(".zentral-tab-title-wrapper") ||
            target.classList.contains("tab-group-label") ||
            target.classList.contains("zentral-group-initials") ||
            target.classList.contains("tab-group-icon") ||
            target.tagName?.toLowerCase() === "tab-group";
          if (
            target.closest("tab, tabbrowser-tab, .tabbrowser-tab") &&
            !isHeader
          )
            return;

          if (isHeader) {
            event.stopPropagation();
          }
        };
        window.addEventListener(
          "mousedown",
          this.#groupRightClickBlocker,
          true,
        );
        window.addEventListener("mouseup", this.#groupRightClickBlocker, true);
        window.addEventListener("click", this.#groupRightClickBlocker, true);
      }

      // Global capture-phase contextmenu listener to guarantee right-click triggers custom menu on any group header
      if (!this.#groupContextMenuHandler) {
        this.#groupContextMenuHandler = (event) => {
          const target = event.target;
          if (target.closest("#tab-label-input")) return;
          // Check if right click was on a tab-group header / pill
          const group = target.closest("tab-group:not([split-view-group])");
          if (!group) return;

          const isHeader =
            target.closest(".tab-group-label-container") ||
            target.closest(".zentral-tab-title-wrapper") ||
            target.classList.contains("tab-group-label") ||
            target.classList.contains("zentral-group-initials") ||
            target.classList.contains("tab-group-icon") ||
            target.tagName?.toLowerCase() === "tab-group";

          // If clicked directly on a tab inside the group, let native tab context menu handle it
          if (
            target.closest("tab, tabbrowser-tab, .tabbrowser-tab") &&
            !isHeader
          )
            return;

          if (isHeader) {
            event.preventDefault();
            event.stopPropagation();
            const menu = this.ensureSharedContextMenu();
            if (menu) {
              this.#state.contextMenuCurrentGroup = group;
              this.#state.lastContextMenuX = event.screenX;
              this.#state.lastContextMenuY = event.screenY;
              try {
                menu.openPopupAtScreen(event.screenX, event.screenY, true);
              } catch (_) {
                try {
                  menu.openPopup(
                    target,
                    "after_start",
                    0,
                    0,
                    true,
                    false,
                    event,
                  );
                } catch (_) {}
              }
            }
          }
        };
        window.addEventListener(
          "contextmenu",
          this.#groupContextMenuHandler,
          true,
        );
      }
    }

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
    setupPopupSuppression() {
      if (this.#popupShowingListener) return;
      this.#popupShowingListener = (e) => {
        const target = e.target;
        const id = target?.id || "";
        const tag = target?.tagName?.toLowerCase() || "";
        if (
          id.includes("tab-group-editor") ||
          id.includes("tabgroup-editor") ||
          id === "tabGroupEditor" ||
          id === "tabGroupContextMenu" ||
          tag === "tabgroup-editor-panel" ||
          target?.classList?.contains("tab-group-editor")
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof target.hidePopup === "function") {
            try {
              target.hidePopup();
            } catch (_) {}
          }
          try {
            target.remove();
          } catch (_) {}
        }
      };
      window.addEventListener("popupshowing", this.#popupShowingListener, true);
      this.removeBuiltinTabGroupMenu();
    }

    /**
     * Removes builtin native tab group context menus and editor panels to prevent UI redundancy.
     * @param {Element|Document} [root=document] - Container scope to scan.
     */
    removeBuiltinTabGroupMenu(root = document) {
      try {
        const selectors = [
          "#tab-group-editor",
          "#tabgroup-editor-panel",
          "#tabGroupEditor",
          "tabgroup-editor-panel",
          ".tab-group-editor",
          "#tabGroupContextMenu",
          "tabgroup-meu",
          'panel[id*="tab-group-editor"]',
          'panel[id*="tabgroup-editor"]',
        ];
        selectors.forEach((sel) => {
          try {
            const list = root.querySelectorAll
              ? root.querySelectorAll(sel)
              : [];
            list.forEach((el) => {
              if (typeof el.hidePopup === "function") el.hidePopup();
              try {
                el.remove();
              } catch (_) {}
            });
            const el = document.getElementById(sel.replace("#", ""));
            if (el) {
              if (typeof el.hidePopup === "function") el.hidePopup();
              try {
                el.remove();
              } catch (_) {}
            }
          } catch (_) {}
        });
      } catch (e) {
        console.error("[ZentralTabGroups] Error removing built-in menu:", e);
      }
    }

    /**
     * Scans and processes all existing tab group DOM elements in the workspace.
     */
    processExistingGroups() {
      const groups = document.querySelectorAll(
        "tab-group:not([split-view-group])",
      );
      groups.forEach((group) => this.processGroup(group));
      this.loadTabGroupState();
    }

    /**
     * Handles keyboard events when editing tab group titles (Enter to confirm, Escape to cancel).
     * @param {KeyboardEvent} event - Keydown event object.
     */
    renameGroupKeydown(event) {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        const label = this.#state.groupEdited;
        const input = document.getElementById("tab-label-input");
        if (!input || !label) return;

        const newName = input.value.trim();
        const group = label.closest("tab-group");

        document.documentElement.removeAttribute("zen-renaming-group");
        input.remove();
        label.classList.remove("tab-group-label-editing");
        label.style.display = "";

        if (group && newName) {
          group.label = newName;
          try {
            group.setAttribute("label", newName);
          } catch (_) {}
          label.textContent = newName;
          const labelContainer = group.querySelector(
            ".tab-group-label-container",
          );
          if (labelContainer) {
            this.updateCollapsedLabel(labelContainer, newName);
          }
          this.scheduleStateSave();
        }
        this.#state.groupEdited = null;
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.renameGroupHalt(event, true);
      }
    }

    /**
     * Replaces tab group text label with an inline text input to begin group renaming.
     * @param {Element} group - Tab group DOM element.
     * @param {boolean} [selectAll=true] - Whether to select full text in input.
     */
    renameGroupStart(group, selectAll = true) {
      if (!group || this.#state.groupEdited) return;
      const labelElement = group.querySelector(".tab-group-label");
      if (!labelElement) return;

      this.#state.groupEdited = labelElement;
      this.#state.isStartingRename = true;
      setTimeout(() => {
        this.#state.isStartingRename = false;
      }, 350);

      document.documentElement.setAttribute("zen-renaming-group", "true");
      labelElement.classList.add("tab-group-label-editing");
      labelElement.style.display = "none";

      const input = document.createElement("input");
      input.id = "tab-label-input";
      input.className = "tab-group-label-input";
      input.type = "text";
      input.value = group.label || labelElement.textContent || "";
      input.setAttribute("autocomplete", "off");

      labelElement.after(input);
      setTimeout(() => {
        try {
          input.focus();
          if (selectAll) input.select();
          else {
            const len = input.value.length;
            input.setSelectionRange(len, len);
          }
        } catch (_) {}
      }, 50);

      input.addEventListener("keydown", (e) => this.renameGroupKeydown(e));
      input.addEventListener("blur", (e) => this.renameGroupHalt(e));
    }

    /**
     * Halts tab group title rename operation and restores original text label.
     * @param {FocusEvent} event - Blur event on text input.
     * @param {boolean} [force=false] - Force halt regardless of active state.
     */
    renameGroupHalt(event, force = false) {
      if (this.#state.isStartingRename && !force) return;
      if (!this.#state.groupEdited) return;

      const input = document.getElementById("tab-label-input");
      if (input && document.activeElement === input && !force) return;

      document.documentElement.removeAttribute("zen-renaming-group");
      if (input) input.remove();
      if (this.#state.groupEdited) {
        this.#state.groupEdited.classList.remove("tab-group-label-editing");
        this.#state.groupEdited.style.display = "";
        this.#state.groupEdited = null;
      }
    }

    /**
     * Enhances a tab group DOM node with custom icons, close buttons, tooltips, and context menus.
     * @param {Element} group - Tab group DOM element.
     */
    processGroup(group) {
      // Use a WeakSet instead of a DOM attribute to avoid persisting across restarts
      // and to prevent guard bypasses when native code resets group attributes.
      if (
        !group ||
        this.#processedGroups.has(group) ||
        group.classList?.contains("zen-folder") ||
        group.hasAttribute?.("zen-folder") ||
        group.hasAttribute?.("split-view-group") ||
        group.hasAttribute?.("zen-split-view") ||
        group.hasAttribute?.("is-zen-split") ||
        group.hasAttribute?.("splitview") ||
        group.classList?.contains("zen-split-view")
      ) {
        return;
      }
      group.classList.add("zentral-standard");
      group.setAttribute("zentral-group", "true");
      group.style.setProperty("border-radius", "6px", "important");

      // Ensure full internal structure exists
      let labelContainer = group.querySelector(".tab-group-label-container");
      if (!labelContainer) {
        labelContainer = document.createElement("div");
        labelContainer.className = "tab-group-label-container";
        group.insertBefore(labelContainer, group.firstChild);
      }
      let innerLabel = labelContainer.querySelector(".tab-group-label");
      if (!innerLabel) {
        innerLabel = document.createElement("label");
        innerLabel.className = "tab-group-label";
        labelContainer.appendChild(innerLabel);
      }
      const groupTitle =
        group.label ||
        group.getAttribute("label") ||
        innerLabel.textContent ||
        "Group";
      innerLabel.textContent = groupTitle;

      let groupTabContainer = group.querySelector(".tab-group-container");
      if (!groupTabContainer) {
        groupTabContainer = document.createElement("div");
        groupTabContainer.className = "tab-group-container";
        group.appendChild(groupTabContainer);
      }

      // Bind click collapse toggle to ensure all groups (top-level and nested) collapse/expand on click
      if (!labelContainer._zentralToggleBound) {
        labelContainer._zentralToggleBound = true;
        labelContainer.addEventListener("click", (e) => {
          if (
            e.target.closest(".tab-close-button") ||
            e.target.closest("#tab-label-input") ||
            e.target.closest(".zentral-tg-drag-handle")
          )
            return;
          e.preventDefault();
          e.stopPropagation();

          if (typeof group.toggleCollapse === "function") {
            group.toggleCollapse();
          } else {
            const isColl =
              group.hasAttribute("collapsed") &&
              group.getAttribute("collapsed") === "true";
            if (isColl) {
              group.removeAttribute("collapsed");
              group.collapsed = false;
            } else {
              group.setAttribute("collapsed", "true");
              group.collapsed = true;
            }
          }
          this.scheduleStateSave();
        });
      }

      if (
        group.shadowRoot &&
        !group.shadowRoot.querySelector(".zentral-shadow-style")
      ) {
        const style = document.createElement("style");
        style.className = "zentral-shadow-style";
        style.textContent = `
          * { border-radius: 6px !important; outline: none !important; }
          .group-marker, .group-marker *, .tab-group-icon > image, .tab-group-icon > img, .tab-group-icon > svg:not(.zentral-chevron) {
            display: none !important; visibility: hidden !important; width: 0 !important; height: 0 !important; opacity: 0 !important; list-style-image: none !important; background: none !important;
          }
          .tab-group-icon, .tab-group-icon * { border: none !important; outline: none !important; box-shadow: none !important; background: transparent !important; }
          .tab-group-icon::before { display: none !important; content: none !important; }
          :host([collapsed]) .tab-group-icon,
          :host([collapsed]) .tab-group-icon * { border: none !important; outline: none !important; box-shadow: none !important; background: transparent !important; }
          :host([collapsed]) .tab-group-icon::before { display: none !important; content: none !important; }
          :host([collapsed]) .tab-group-container::after,
          :host([collapsed]) .tab-group-container::before { display: none !important; content: none !important; }
        `;
        group.shadowRoot.appendChild(style);
      }
      // Clear and hide any native children (like image.group-marker) inside .tab-group-icon
      const iconEl = group.querySelector(".tab-group-icon");
      if (iconEl) {
        Array.from(iconEl.children).forEach((child) => {
          if (!child.classList.contains("zentral-chevron")) {
            child.style.setProperty("display", "none", "important");
            child.style.setProperty("visibility", "hidden", "important");
            child.style.setProperty("width", "0", "important");
            child.style.setProperty("height", "0", "important");
            child.style.setProperty("min-width", "0", "important");
            child.style.setProperty("min-height", "0", "important");
            child.style.setProperty("opacity", "0", "important");
            child.style.setProperty("list-style-image", "none", "important");
            child.style.setProperty("background", "none", "important");
            child.setAttribute("hidden", "true");
          }
        });
        iconEl.style.setProperty("border", "none", "important");
        iconEl.style.setProperty("outline", "none", "important");
        iconEl.style.setProperty("box-shadow", "none", "important");
        iconEl.style.setProperty("background", "transparent", "important");
        iconEl.style.setProperty("background-image", "none", "important");
      }
      if (labelContainer) {
        // Track hover state so we don't collapse during a hover
        let _isHovered = false;

        /**
         * Enforces our inline layout styles on the labelContainer.
         * Called initially and re-called by the style MutationObserver
         * whenever Zen's own JS rewrites the element's style attribute.
         */
        const enforceRestingStyles = () => {
          labelContainer.style.setProperty("border-radius", "8px", "important");
          labelContainer.style.setProperty("aspect-ratio", "auto", "important");
          labelContainer.style.setProperty(
            "align-self",
            "stretch",
            "important",
          );
          labelContainer.style.setProperty("width", "100%", "important");
          labelContainer.style.setProperty("min-width", "100%", "important");
          labelContainer.style.setProperty("max-width", "100%", "important");
          labelContainer.style.setProperty(
            "height",
            "var(--tab-min-height, 36px)",
            "important",
          );
          labelContainer.style.setProperty(
            "min-height",
            "var(--tab-min-height, 36px)",
            "important",
          );
          labelContainer.style.setProperty(
            "max-height",
            "var(--tab-min-height, 36px)",
            "important",
          );
          labelContainer.style.setProperty(
            "box-sizing",
            "border-box",
            "important",
          );
          labelContainer.style.setProperty("display", "flex", "important");
          labelContainer.style.setProperty(
            "flex-direction",
            "row",
            "important",
          );
          labelContainer.style.setProperty(
            "align-items",
            "center",
            "important",
          );
          labelContainer.style.setProperty("padding", "0", "important");
          // Sync chevron icon visibility with the pref to prevent CSS vs inline-style conflict (H-05)
          const iconEl = labelContainer.querySelector(".tab-group-icon");
          if (iconEl) {
            const showChevron =
              Core.getPref(Constants.TabGroups.PREF_SHOW_CHEVRON) !== false;
            iconEl.style.setProperty(
              "display",
              showChevron ? "inline-flex" : "none",
              "important",
            );
          }
        };

        // Apply immediately
        enforceRestingStyles();

        const innerLabel = labelContainer.querySelector(".tab-group-label");
        if (innerLabel) {
          innerLabel.style.setProperty("border-radius", "12px", "important");
          innerLabel.style.setProperty("width", "auto", "important");
          innerLabel.style.setProperty("flex", "0 1 auto", "important");
          innerLabel.style.setProperty("overflow", "hidden", "important");
          innerLabel.style.setProperty(
            "text-overflow",
            "ellipsis",
            "important",
          );
        }

        // Guard against MutationObserver re-entrancy
        let _styleGuard = false;
        const styleWatcher = new MutationObserver(() => {
          if (_styleGuard || _isHovered) return;
          _styleGuard = true;
          enforceRestingStyles();
          _styleGuard = false;
        });
        styleWatcher.observe(labelContainer, {
          attributes: true,
          attributeFilter: ["style"],
        });
        // Track for cleanup when this group is removed from the DOM (M-02)
        this.#groupObservers.set(group, styleWatcher);

        // Labels are always full-width ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no hover expand/collapse needed.

        let hoverTimer = null;
        labelContainer.addEventListener("mouseenter", () => {
          if (!Core.getPref(Constants.TabGroups.PREF_THUMBNAILS)) return;
          labelContainer.setAttribute("zentral-hover", "true");
          hoverTimer = setTimeout(() => {
            const panel = document.getElementById("zentral-tabgroup-tooltip");
            const container = document.getElementById(
              "zentral-tabgroup-tooltip-container",
            );
            if (panel && container && group) {
              let tabs = this.getDirectTabs(group);
              container.replaceChildren();
              if (tabs.length === 0) {
                const div = document.createElement("div");
                div.textContent = "No tabs";
                div.style.color = "var(--text-color, inherit)";
                container.appendChild(div);
              } else {
                tabs.forEach((tab) => {
                  const row = document.createElement("div");
                  row.className = "zentral-tooltip-row";

                  // Active Tab State
                  const isActive =
                    tab.selected ||
                    (window.gBrowser && window.gBrowser.selectedTab === tab);
                  if (isActive) {
                    row.setAttribute("data-active", "true");
                  }

                  // Loaded vs. Unloaded (dormant/pending/discarded) State
                  const isUnloaded =
                    tab.hasAttribute("pending") ||
                    tab.getAttribute("pending") === "true" ||
                    tab.discarded;
                  if (isUnloaded) {
                    row.setAttribute("data-unloaded", "true");
                  }

                  row.addEventListener("click", (e) => {
                    if (e.target.closest(".zentral-tooltip-close-btn")) return;
                    e.preventDefault();
                    if (window.gBrowser && tab)
                      window.gBrowser.selectedTab = tab;
                    if (panel.hidePopup) panel.hidePopup();
                  });

                  const icon = document.createElement("img");
                  const imgSrc =
                    tab.getAttribute("image") ||
                    tab.image ||
                    "chrome://global/skin/icons/defaultFavicon.svg";
                  icon.src = imgSrc;
                  icon.style.width = "16px";
                  icon.style.height = "16px";
                  icon.style.borderRadius = "3px";
                  icon.style.flexShrink = "0";

                  let cleanTitle = tab.label || "New Tab";
                  let prev;
                  do {
                    prev = cleanTitle;
                    cleanTitle = cleanTitle.replace(
                      /^\s*[\(\[]\d+[\)\]]\s*/g,
                      "",
                    );
                    cleanTitle = cleanTitle.replace(
                      /^[\p{Extended_Pictographic}\s\u200d\u2600-\u27BF]+/gu,
                      "",
                    );
                  } while (cleanTitle !== prev);
                  cleanTitle = cleanTitle.trim() || tab.label || "New Tab";

                  let domain = "";
                  try {
                    const uri = tab.linkedBrowser?.currentURI;
                    if (uri && uri.host) {
                      domain = uri.host.replace(/^www\./, "");
                    }
                  } catch (_) {}

                  const textCol = document.createElement("div");
                  textCol.className = "zentral-tooltip-text-col";

                  const titleEl = document.createElement("div");
                  titleEl.className = "zentral-tooltip-title";
                  titleEl.textContent = cleanTitle;
                  textCol.appendChild(titleEl);

                  if (domain) {
                    const domainEl = document.createElement("div");
                    domainEl.className = "zentral-tooltip-domain";
                    domainEl.textContent = domain;
                    textCol.appendChild(domainEl);
                  }

                  // In-Thumbnail Tab Close ("X") Button
                  const closeBtn = document.createElement("button");
                  closeBtn.className = "zentral-tooltip-close-btn";
                  closeBtn.title = "Close tab";
                  closeBtn.type = "button";
                  closeBtn.appendChild(
                    this.#createSVG(
                      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`,
                    ),
                  );
                  closeBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (window.gBrowser && tab) {
                      try {
                        window.gBrowser.removeTab(tab);
                      } catch (err) {
                        console.warn(
                          "[ZentralTabGroups] Failed to close tab:",
                          err,
                        );
                      }
                    }
                    // Smoothly animate removal of row
                    row.style.height = row.offsetHeight + "px";
                    row.style.overflow = "hidden";
                    row.style.boxSizing = "border-box";
                    row.style.transition =
                      "height 0.18s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.15s ease, padding 0.18s ease, margin 0.18s ease";
                    requestAnimationFrame(() => {
                      row.style.height = "0";
                      row.style.opacity = "0";
                      row.style.paddingTop = "0";
                      row.style.paddingBottom = "0";
                      row.style.marginTop = "0";
                      row.style.marginBottom = "0";
                    });
                    setTimeout(() => {
                      row.remove();
                      if (
                        container.querySelectorAll(".zentral-tooltip-row")
                          .length === 0
                      ) {
                        const div = document.createElement("div");
                        div.textContent = "No tabs";
                        div.style.color = "var(--text-color, inherit)";
                        container.appendChild(div);
                      }
                    }, 190);
                  });

                  row.appendChild(icon);
                  row.appendChild(textCol);
                  row.appendChild(closeBtn);
                  container.appendChild(row);
                });
              }
              if (panel.openPopup)
                panel.openPopup(
                  labelContainer,
                  "end_before",
                  -4,
                  0,
                  false,
                  false,
                );
            }
          }, 350);
        });
        labelContainer.addEventListener("mouseleave", () => {
          labelContainer.removeAttribute("zentral-hover");
          if (hoverTimer) clearTimeout(hoverTimer);
          this.safeHideTooltip(350);
        });
        labelContainer.addEventListener("mousedown", () => {
          if (hoverTimer) clearTimeout(hoverTimer);
          const panel = document.getElementById("zentral-tabgroup-tooltip");
          if (panel && panel.hidePopup) panel.hidePopup();
        });
        labelContainer.addEventListener("dblclick", (e) => {
          if (
            e.target.closest(".tab-close-button") ||
            e.target.closest(".tab-group-icon")
          )
            return;
          e.preventDefault();
          e.stopPropagation();
          this.renameGroupStart(group, true);
        });

        const labelValue =
          group.label || (innerLabel ? innerLabel.textContent : "");
        this.updateCollapsedLabel(labelContainer, labelValue);
      }
      if (!labelContainer) return;
      // Safe DOM injection
      if (
        !labelContainer.querySelector(".tab-close-button") &&
        window.MozXULElement?.parseXULToFragment
      ) {
        const frag = window.MozXULElement.parseXULToFragment(`
          <div class="tab-group-icon-container"><div class="tab-group-icon"><image class="group-marker" role="button" keyNav="false" tooltiptext="Toggle Group"/></div></div>
          <image class="tab-close-button close-icon" role="button" keyNav="false" tooltiptext="Close Group"/>
        `);
        const iconContainer =
          frag.querySelector(".tab-group-icon-container") || frag.children[0];
        const closeButton =
          frag.querySelector(".tab-close-button") || frag.children[1];

        labelContainer.insertBefore(iconContainer, labelContainer.firstChild);
        labelContainer.appendChild(closeButton);

        closeButton.addEventListener("click", (event) => {
          event.stopPropagation();
          event.preventDefault();
          try {
            this.removeSavedColor(group.id);
            if (typeof gBrowser?.removeTabGroup === "function") {
              try {
                gBrowser.removeTabGroup(group);
              } catch (_) {}
            }
          } catch (error) {
            console.error(
              "[ZentralTabGroups] Error removing tab group:",
              error,
            );
          }
          try {
            group.remove();
          } catch (_) {}
          this.scheduleStateSave();
        });
      }

      // Wrap title elements in .zentral-tab-title-wrapper for physical Folder Tab contour
      let wrapper = labelContainer.querySelector(".zentral-tab-title-wrapper");
      if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "zentral-tab-title-wrapper";
        const closeBtn = labelContainer.querySelector(".tab-close-button");
        labelContainer.insertBefore(
          wrapper,
          closeBtn || labelContainer.firstChild,
        );
      }

      const iconContainer = labelContainer.querySelector(
        ".tab-group-icon-container",
      );
      const currentInnerLabel =
        labelContainer.querySelector(".tab-group-label");
      const initialsEl = labelContainer.querySelector(
        ".zentral-group-initials",
      );

      if (iconContainer && iconContainer.parentNode !== wrapper)
        wrapper.appendChild(iconContainer);
      if (currentInnerLabel && currentInnerLabel.parentNode !== wrapper)
        wrapper.appendChild(currentInnerLabel);
      if (initialsEl && initialsEl.parentNode !== wrapper)
        wrapper.appendChild(initialsEl);

      let subGroupsBadge = wrapper.querySelector(".zentral-subgroups-badge");
      if (!subGroupsBadge) {
        subGroupsBadge = document.createElement("span");
        subGroupsBadge.className = "zentral-subgroups-badge";
        wrapper.appendChild(subGroupsBadge);
      }

      group.classList.remove("tab-group-editor-mode-create");
      this.#processedGroups.add(group);
      group.setAttribute("data-close-button-added", "true"); // Kept for external compatibility

      this.addContextMenu(group);

      if (
        !group.label ||
        group.label === "" ||
        ("defaultGroupName" in group && group.label === group.defaultGroupName)
      ) {
        this.renameGroupStart(group, false);
      }

      this.checkAndApplyFirstTimeGroupColor(group);
      this.updateGroupSubGroupsBadge(group);
      const parentGroup = group.parentElement?.closest("tab-group");
      if (parentGroup) this.updateGroupSubGroupsBadge(parentGroup);
    }

    /**
     * Constructs or returns the shared context menu popup for tab groups.
     * @returns {Element} XUL menupopup element.
     */
    ensureSharedContextMenu() {
      const popupSet =
        document.getElementById("mainPopupSet") ||
        document.documentElement ||
        document.body;
      let contextMenu = document.getElementById(
        "zentral-tabgroup-context-menu",
      );

      if (!contextMenu || !contextMenu.isConnected) {
        if (contextMenu) contextMenu.remove();

        if (window.MozXULElement?.parseXULToFragment) {
          const frag = window.MozXULElement.parseXULToFragment(`
            <menupopup id="zentral-tabgroup-context-menu">
              <menu id="zentral-tg-menu-color" label="Change Group Color">
                <menupopup id="zentral-tg-menu-color-popup">
                  <menuitem id="zentral-tg-item-set-color" label="Set Custom Color"/>
                  <menuitem id="zentral-tg-item-auto-color" label="Average Group's Color"/>
                </menupopup>
              </menu>
              <menuitem id="zentral-tg-item-rename" label="Rename Group"/>
              <menuseparator/>
              <menuitem id="zentral-tg-item-ungroup" label="Ungroup Tabs"/>
              <menuitem id="zentral-tg-item-close" label="Close Group"/>
            </menupopup>
          `);
          popupSet.appendChild(frag);
          contextMenu = document.getElementById(
            "zentral-tabgroup-context-menu",
          );
        } else {
          contextMenu = document.createXULElement("menupopup");
          contextMenu.id = "zentral-tabgroup-context-menu";

          const colorMenu = document.createXULElement("menu");
          colorMenu.id = "zentral-tg-menu-color";
          colorMenu.setAttribute("label", "Change Group Color");
          const colorPopup = document.createXULElement("menupopup");
          colorPopup.id = "zentral-tg-menu-color-popup";

          const setColorItem = document.createXULElement("menuitem");
          setColorItem.id = "zentral-tg-item-set-color";
          setColorItem.setAttribute("label", "Set Custom Color");

          const autoColorItem = document.createXULElement("menuitem");
          autoColorItem.id = "zentral-tg-item-auto-color";
          autoColorItem.setAttribute("label", "Average Group's Color");

          colorPopup.appendChild(setColorItem);
          colorPopup.appendChild(autoColorItem);
          colorMenu.appendChild(colorPopup);
          contextMenu.appendChild(colorMenu);

          const renameItem = document.createXULElement("menuitem");
          renameItem.id = "zentral-tg-item-rename";
          renameItem.setAttribute("label", "Rename Group");
          contextMenu.appendChild(renameItem);

          const sep = document.createXULElement("menuseparator");
          contextMenu.appendChild(sep);

          const ungroupItem = document.createXULElement("menuitem");
          ungroupItem.id = "zentral-tg-item-ungroup";
          ungroupItem.setAttribute("label", "Ungroup Tabs");
          contextMenu.appendChild(ungroupItem);

          const closeItem = document.createXULElement("menuitem");
          closeItem.id = "zentral-tg-item-close";
          closeItem.setAttribute("label", "Close Group");
          contextMenu.appendChild(closeItem);

          popupSet.appendChild(contextMenu);
        }

        if (contextMenu) {
          contextMenu.addEventListener("popupshowing", (e) => {
            const trigger = contextMenu.triggerNode;
            const grp =
              trigger?.closest?.("tab-group:not([split-view-group])") ||
              this.#state.contextMenuCurrentGroup;
            if (grp) this.#state.contextMenuCurrentGroup = grp;
          });

          const openColorPicker = () => {
            const grp = this.#state.contextMenuCurrentGroup;
            if (!grp) return;
            const picker = this.ensureColorPickerPanel();
            if (picker) {
              picker._currentGroup = grp;
              const currentColor =
                grp.style.getPropertyValue("--tab-group-color").trim() ||
                "#2b2b2b";
              const hex =
                currentColor.startsWith("#") && currentColor.length >= 7
                  ? currentColor.substring(0, 7)
                  : "#2b2b2b";
              const hexInput = picker.querySelector("#zentral-tg-input-hex");
              if (hexInput) hexInput.value = hex;
              const bigint = parseInt(hex.slice(1), 16);
              const rgbInput = picker.querySelector("#zentral-tg-input-rgb");
              if (rgbInput && !isNaN(bigint))
                rgbInput.value = `${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}`;
              const nativeColorInput = picker.querySelector(
                "#zentral-tg-native-color",
              );
              if (nativeColorInput) nativeColorInput.value = hex;

              if (typeof picker.openPopupAtScreen === "function") {
                picker.openPopupAtScreen(
                  this.#state.lastContextMenuX || 0,
                  this.#state.lastContextMenuY || 0,
                  false,
                );
              } else if (typeof picker.openPopup === "function") {
                picker.openPopup(grp, "after_start", 0, 0, false, false);
              }
            }
          };

          contextMenu
            .querySelector("#zentral-tg-item-set-color")
            ?.addEventListener("command", (e) => {
              e.stopPropagation();
              openColorPicker();
            });

          contextMenu
            .querySelector("#zentral-tg-item-auto-color")
            ?.addEventListener("command", (e) => {
              e.stopPropagation();
              if (this.#state.contextMenuCurrentGroup?._useFaviconColor) {
                this.#state.contextMenuCurrentGroup._useFaviconColor();
              }
            });

          contextMenu
            .querySelector("#zentral-tg-item-rename")
            ?.addEventListener("command", (e) => {
              e.stopPropagation();
              if (this.#state.contextMenuCurrentGroup) {
                this.renameGroupStart(
                  this.#state.contextMenuCurrentGroup,
                  true,
                );
              }
            });

          contextMenu
            .querySelector("#zentral-tg-item-ungroup")
            ?.addEventListener("command", (e) => {
              e.stopPropagation();
              const grp = this.#state.contextMenuCurrentGroup;
              if (grp) {
                if (typeof grp.ungroupTabs === "function") {
                  try {
                    grp.ungroupTabs();
                  } catch (_) {}
                }
                try {
                  grp.remove();
                } catch (_) {}
                this.scheduleStateSave();
              }
            });

          contextMenu
            .querySelector("#zentral-tg-item-close")
            ?.addEventListener("command", (e) => {
              e.stopPropagation();
              const grp = this.#state.contextMenuCurrentGroup;
              if (grp) {
                const labelElement = grp.querySelector(".tab-group-label");
                const groupName =
                  (grp.label || labelElement?.textContent || "").trim() ||
                  "this group";

                let confirmed = false;
                try {
                  const promptService =
                    Services.prompt ||
                    (typeof Cc !== "undefined" &&
                      Cc["@mozilla.org/embedcomp/prompt-service;1"]?.getService(
                        Ci.nsIPromptService,
                      ));
                  if (
                    promptService &&
                    typeof promptService.confirm === "function"
                  ) {
                    confirmed = promptService.confirm(
                      window,
                      "Close Tab Group",
                      `Are you sure you want to close "${groupName}" and all of its tabs?`,
                    );
                  } else if (typeof window.confirm === "function") {
                    confirmed = window.confirm(
                      `Are you sure you want to close "${groupName}" and all of its tabs?`,
                    );
                  } else {
                    confirmed = true;
                  }
                } catch (_) {
                  confirmed = true;
                }

                if (!confirmed) return;

                try {
                  this.removeSavedColor(grp.id);
                  if (typeof gBrowser?.removeTabGroup === "function") {
                    try {
                      gBrowser.removeTabGroup(grp);
                    } catch (_) {}
                  }
                } catch (_) {}
                try {
                  grp.remove();
                } catch (_) {}
                this.scheduleStateSave();
              }
            });
        }
      }

      this.#state.sharedContextMenu = contextMenu;
      return contextMenu;
    }
    /* --------------------------------------------------------------------------
     * 4.4 Color Picker & Theme Processing
     * --------------------------------------------------------------------------
     */

    /**
     * Constructs and initializes the interactive popup color picker panel with spectrum wheel and eyedropper.
     * @returns {Element} XUL panel element for color selection.
     */
    ensureColorPickerPanel() {
      if (
        this.#state.colorPickerPanel &&
        this.#state.colorPickerPanel.isConnected
      ) {
        return this.#state.colorPickerPanel;
      }

      const popupSet =
        document.getElementById("mainPopupSet") ||
        document.documentElement ||
        document.body;
      let existing = document.getElementById("zentral-group-color-picker");
      if (existing && existing.isConnected) {
        this.#state.colorPickerPanel = existing;
        return existing;
      }

      if (!window.MozXULElement?.parseXULToFragment) return null;

      const palette = [
        "#ff4b4b",
        "#ff8f3d",
        "#f2c94c",
        "#2196f3",
        "#9b51e0",
        "#eb5757",
        "#f2994a",
        "#6fcf97",
        "#2d9cdb",
        "#bb6bd9",
        "#e53935",
        "#fb8c00",
        "#43a047",
        "#1e88e5",
        "#8e24aa",
        "#d32f2f",
        "#f57c00",
        "#388e3c",
        "#1976d2",
        "#7b1fa2",
        "#c62828",
        "#ef6c00",
        "#2e7d32",
        "#1565c0",
        "#6a1b9a",
      ];

      const htmlPalette = palette
        .map(
          (c) =>
            `<div class="zentral-color-swatch" data-color="${c}" style="background-color: ${c};"></div>`,
        )
        .join("");

      const frag = window.MozXULElement.parseXULToFragment(`
        <panel id="zentral-group-color-picker" type="arrow" rolluponmousewheel="true" noautofocus="true" consumeoutsideclicks="false">
          <vbox class="zentral-tg-cp-box">
            <html:div id="zentral-tg-drag-handle" class="zentral-tg-drag-handle" title="Drag to move">
              <html:div class="zentral-tg-drag-pill"></html:div>
            </html:div>
            <html:div id="zentral-tg-palette-container" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; width: 156px; height: 144px;">
              ${htmlPalette}
            </html:div>
            <html:div id="zentral-tg-wheel-container" style="display: none; flex-direction: column; gap: 6px; align-items: center; width: 156px; height: 144px;">
              <html:canvas id="zentral-tg-satval-canvas" width="156" height="124" style="border-radius: 8px; cursor: crosshair; border: 1px solid color-mix(in srgb, currentColor 12%, transparent);"></html:canvas>
              <html:canvas id="zentral-tg-hue-canvas" width="156" height="14" style="border-radius: 8px; cursor: pointer; border: 1px solid color-mix(in srgb, currentColor 12%, transparent);"></html:canvas>
            </html:div>
            <hbox style="align-items: center; justify-content: space-between; gap: 4px; width: 156px;">
              <html:button id="zentral-tg-btn-auto" class="zentral-tg-btn" title="Average Group's Color">Auto</html:button>
              <html:button id="zentral-tg-btn-wheel" class="zentral-tg-btn">Wheel</html:button>
              <html:button id="zentral-tg-btn-pick" class="zentral-tg-btn">Pick</html:button>
            </hbox>
            <hbox style="align-items: center; justify-content: space-between; gap: 6px; width: 156px;">
              <html:input id="zentral-tg-input-hex" type="text" placeholder="#HEX" class="zentral-tg-input" style="width: 70px;"/>
              <html:input id="zentral-tg-input-rgb" type="text" placeholder="R, G, B" class="zentral-tg-input" style="width: 80px;"/>
            </hbox>
          </vbox>
        </panel>
      `);

      popupSet.appendChild(frag);
      const panel = document.getElementById("zentral-group-color-picker");

      const applyColor = (color) => {
        if (panel._currentGroup) {
          panel._currentGroup.style.setProperty("--tab-group-color", color);
          panel._currentGroup.style.setProperty(
            "--tab-group-color-invert",
            color,
          );
          panel._currentGroup.style.setProperty(
            "--zentral-custom-color",
            color,
          );
          panel._currentGroup.style.setProperty(
            "--zentral-tabgroup-contrast-color",
            this.getContrastColor(color),
          );
          this.saveTabGroupColors();
          this.scheduleStateSave();
        }
      };

      // Palette swatches
      panel.querySelectorAll(".zentral-color-swatch").forEach((swatch) => {
        swatch.addEventListener("click", () =>
          applyColor(swatch.dataset.color),
        );
      });

      // Wheel/Palette toggle
      const paletteContainer = panel.querySelector(
        "#zentral-tg-palette-container",
      );
      const wheelContainer = panel.querySelector("#zentral-tg-wheel-container");
      const btnWheel = panel.querySelector("#zentral-tg-btn-wheel");
      btnWheel.addEventListener("click", () => {
        if (wheelContainer.style.display === "none") {
          wheelContainer.style.display = "flex";
          paletteContainer.style.display = "none";
          btnWheel.textContent = "Palette";
          drawSatVal();
          drawHue();
        } else {
          wheelContainer.style.display = "none";
          paletteContainer.style.display = "grid";
          btnWheel.textContent = "Wheel";
        }
      });

      // Canvas Color Wheel Logic
      let currentHue = 0;
      const satValCanvas = panel.querySelector("#zentral-tg-satval-canvas");
      const hueCanvas = panel.querySelector("#zentral-tg-hue-canvas");

      const drawHue = () => {
        const ctx = hueCanvas.getContext("2d");
        const grad = ctx.createLinearGradient(0, 0, hueCanvas.width, 0);
        for (let i = 0; i <= 360; i += 60)
          grad.addColorStop(i / 360, `hsl(${i}, 100%, 50%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, hueCanvas.width, hueCanvas.height);
      };

      const drawSatVal = () => {
        const ctx = satValCanvas.getContext("2d");
        ctx.fillStyle = `hsl(${currentHue}, 100%, 50%)`;
        ctx.fillRect(0, 0, satValCanvas.width, satValCanvas.height);

        const whiteGrad = ctx.createLinearGradient(0, 0, satValCanvas.width, 0);
        whiteGrad.addColorStop(0, "rgba(255, 255, 255, 1)");
        whiteGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = whiteGrad;
        ctx.fillRect(0, 0, satValCanvas.width, satValCanvas.height);

        const blackGrad = ctx.createLinearGradient(
          0,
          0,
          0,
          satValCanvas.height,
        );
        blackGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
        blackGrad.addColorStop(1, "rgba(0, 0, 0, 1)");
        ctx.fillStyle = blackGrad;
        ctx.fillRect(0, 0, satValCanvas.width, satValCanvas.height);
      };

      hueCanvas.addEventListener("click", (e) => {
        const rect = hueCanvas.getBoundingClientRect();
        currentHue = Math.min(
          360,
          Math.max(0, ((e.clientX - rect.left) / rect.width) * 360),
        );
        drawSatVal();
      });

      satValCanvas.addEventListener("click", (e) => {
        const rect = satValCanvas.getBoundingClientRect();
        const x = Math.min(
          satValCanvas.width - 1,
          Math.max(0, e.clientX - rect.left),
        );
        const y = Math.min(
          satValCanvas.height - 1,
          Math.max(0, e.clientY - rect.top),
        );
        const ctx = satValCanvas.getContext("2d");
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        const hex =
          "#" +
          [pixel[0], pixel[1], pixel[2]]
            .map((x) => x.toString(16).padStart(2, "0"))
            .join("");
        applyColor(hex);
        panel.querySelector("#zentral-tg-input-hex").value = hex;
        panel.querySelector("#zentral-tg-input-rgb").value =
          `${pixel[0]}, ${pixel[1]}, ${pixel[2]}`;
      });

      // Eyedropper API
      const btnPick = panel.querySelector("#zentral-tg-btn-pick");
      if (window.EyeDropper) {
        btnPick.addEventListener("click", async () => {
          try {
            const eyeDropper = new EyeDropper();
            const result = await eyeDropper.open();
            if (result && result.sRGBHex) applyColor(result.sRGBHex);
          } catch (_) {}
        });
      } else {
        btnPick.style.display = "none";
      }

      // Auto Average Favicon Color
      panel
        .querySelector("#zentral-tg-btn-auto")
        .addEventListener("click", () => {
          if (panel._currentGroup && panel._currentGroup._useFaviconColor) {
            panel._currentGroup._useFaviconColor();
          }
        });

      // Draggable Color Picker Logic
      const handle = panel.querySelector("#zentral-tg-drag-handle");
      let isDragging = false;
      let startX, startY;

      handle.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        startX = e.screenX;
        startY = e.screenY;
        handle.classList.add("dragging");
        e.preventDefault();
      });

      const onColorPickerMove = (e) => {
        if (!isDragging) return;
        const deltaX = e.screenX - startX;
        const deltaY = e.screenY - startY;
        startX = e.screenX;
        startY = e.screenY;

        const currentX =
          parseInt(panel.getAttribute("left")) || panel.screenX || 0;
        const currentY =
          parseInt(panel.getAttribute("top")) || panel.screenY || 0;
        panel.moveTo(currentX + deltaX, currentY + deltaY);
      };

      const onColorPickerUp = (e) => {
        if (isDragging && e.button === 0) {
          isDragging = false;
          handle.classList.remove("dragging");
        }
      };
      this.#colorPickerDragCleanup?.();
      window.addEventListener("mousemove", onColorPickerMove);
      window.addEventListener("mouseup", onColorPickerUp);
      this.#colorPickerDragCleanup = () => {
        window.removeEventListener("mousemove", onColorPickerMove);
        window.removeEventListener("mouseup", onColorPickerUp);
      };

      panel
        .querySelector("#zentral-tg-input-hex")
        .addEventListener("input", (e) => {
          const val = e.target.value;
          if (/^#[0-9A-Fa-f]{6}$/.test(val)) applyColor(val);
        });
      panel
        .querySelector("#zentral-tg-input-rgb")
        .addEventListener("change", (e) => {
          const parts = e.target.value
            .split(",")
            .map((s) => parseInt(s.trim()));
          if (
            parts.length === 3 &&
            parts.every((n) => !isNaN(n) && n >= 0 && n <= 255)
          ) {
            applyColor(
              "#" + parts.map((n) => n.toString(16).padStart(2, "0")).join(""),
            );
          }
        });

      this.#state.colorPickerPanel = panel;
      return panel;
    }
    /**
     * Attaches custom context menu actions to native Zen folder menus.
     */
    addFolderContextMenuItems() {
      this.#folderMenuTimer = setTimeout(() => {
        this.#folderMenuTimer = null;
        const folderMenu = document.getElementById("zenFolderActions");
        if (
          !folderMenu ||
          folderMenu.querySelector("#zentral-tabgroup-convert-folder-to-group")
        )
          return;

        if (window.MozXULElement?.parseXULToFragment) {
          const frag = window.MozXULElement.parseXULToFragment(
            `<menuseparator id="zentral-tabgroup-folder-separator"/><menuitem id="zentral-tabgroup-convert-folder-to-group" label="Convert Folder to Group"/>`,
          );
          const convertToSpaceItem = folderMenu.querySelector(
            "#context_zenFolderToSpace",
          );
          if (convertToSpaceItem) {
            convertToSpaceItem.after(frag);
          } else {
            folderMenu.appendChild(frag);
          }

          this.#folderMenuHandler = (event) => {
            if (event.target.id !== "zentral-tabgroup-convert-folder-to-group")
              return;
            const folder = folderMenu.triggerNode?.closest("zen-folder");
            if (folder) this.convertFolderToGroup(folder);
          };
          folderMenu.addEventListener("command", this.#folderMenuHandler);
        }
      }, 1500);
    }

    /**
     * Enhances native tab context menu (#tabContextMenu) to ensure all existing
     * tab groups are populated and selectable when right-clicking tabs to add/move to group.
     */
    enhanceTabContextMenu() {
      const tabContextMenu = document.getElementById("tabContextMenu");
      if (!tabContextMenu || tabContextMenu._zentralEnhanced) return;
      tabContextMenu._zentralEnhanced = true;

      // Ensure groups order matches tabstrip top-to-bottom and group colors match
      // Note: We do NOT remove separators or Closed Groups via DOM .remove() because Zen's native
      // popup builder relies on them as anchor nodes to clear & rebuild items on subsequent openings.
      // They are cleanly hidden via chrome.css instead.
      const handleGroupSubmenu = (popup) => {
        if (!popup) return;

        // 1. Query active tab groups in DOM order (top to bottom on tabstrip)
        const activeGroups = Array.from(
          document.querySelectorAll("tab-group:not([split-view-group])"),
        );

        // 2. Find all group items in the submenu
        const menuItems = Array.from(
          popup.querySelectorAll(
            ".tab-group-icon, menuitem[class*='tab-group']",
          ),
        );
        if (menuItems.length === 0) return;

        // 3. Sort menu items to match tabstrip order (top to bottom)
        menuItems.sort((a, b) => {
          const labelA = (a.getAttribute("label") || a.label || "")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .trim();
          const labelB = (b.getAttribute("label") || b.label || "")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .trim();
          const idxA = activeGroups.findIndex(
            (g) =>
              (g.label || g.getAttribute("label") || "")
                .replace(/[\u200B-\u200D\uFEFF]/g, "")
                .trim() === labelA,
          );
          const idxB = activeGroups.findIndex(
            (g) =>
              (g.label || g.getAttribute("label") || "")
                .replace(/[\u200B-\u200D\uFEFF]/g, "")
                .trim() === labelB,
          );
          return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
        });

        // 4. Re-insert sorted items sequentially after upper separator
        const upperSep = popup.querySelector(
          "#open-tab-groups-separator-upper",
        );
        let refNode =
          upperSep ||
          popup.querySelector("#context_moveTabToGroupNewGroup")
            ?.nextElementSibling;

        menuItems.forEach((item) => {
          if (refNode && refNode.nextSibling) {
            refNode.parentNode.insertBefore(item, refNode.nextSibling);
            refNode = item;
          } else {
            popup.appendChild(item);
            refNode = item;
          }

          // 5. Apply matching group color to the item and its icon squircle
          const cleanLabel = (item.getAttribute("label") || item.label || "")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .trim();
          const groupEl = activeGroups.find(
            (g) =>
              (g.label || g.getAttribute("label") || "")
                .replace(/[\u200B-\u200D\uFEFF]/g, "")
                .trim() === cleanLabel,
          );
          if (groupEl) {
            const color =
              groupEl.style.getPropertyValue("--zentral-custom-color") ||
              groupEl.style.getPropertyValue("--tab-group-color") ||
              groupEl.getAttribute("data-tab-group-color") ||
              "";
            if (color) {
              item.style.setProperty("--tab-group-color", color, "important");
              item.style.setProperty(
                "--tab-group-color-undefined",
                color,
                "important",
              );
              item.style.setProperty("--menu-icon-color", color, "important");
              const img = item.querySelector(
                "img, image, .menu-iconic-icon, html\\:img",
              );
              if (img) {
                img.style.setProperty("background-color", color, "important");
                img.style.setProperty("fill", color, "important");
                img.style.setProperty("color", color, "important");
              }
            }
          }
        });
      };

      if (!this._tabContextSubmenuListener) {
        this._tabContextSubmenuListener = (e) => {
          const popup = e.target;
          if (
            popup &&
            (popup.id === "context_moveTabToGroupPopupMenu" ||
              popup.id?.includes("TabToGroup") ||
              popup.parentNode?.id === "context_moveTabToGroup")
          ) {
            handleGroupSubmenu(popup);
            setTimeout(() => handleGroupSubmenu(popup), 0);
          }
        };
        window.addEventListener(
          "popupshowing",
          this._tabContextSubmenuListener,
          true,
        );
        window.addEventListener(
          "popupshown",
          this._tabContextSubmenuListener,
          true,
        );
      }
    }

    onTabGroupCreate(event) {
      try {
        const target = event.target;
        const group = target?.closest
          ? target.closest("tab-group") ||
            (target.tagName === "tab-group" ? target : null)
          : null;
        if (!group || group.hasAttribute("split-view-group")) return;

        this.removeBuiltinTabGroupMenu();
        if (!group.hasAttribute("data-close-button-added"))
          this.processGroup(group);

        if (
          !group.label ||
          group.label === "" ||
          ("defaultGroupName" in group &&
            group.label === group.defaultGroupName)
        ) {
          if (!this.#state.groupEdited) this.renameGroupStart(group, false);
        }
        this.checkAndApplyFirstTimeGroupColor(group);
      } catch (e) {
        console.error("[ZentralTabGroups] Error handling TabGroupCreate:", e);
      }
    }

    /**
     * Binds right-click context menu event listener and helper methods to a specific tab group.
     * @param {Element} group - Tab group DOM element.
     */
    addContextMenu(group) {
      const sharedMenu = this.ensureSharedContextMenu();
      const labelContainer = group.querySelector(".tab-group-label-container");
      if (labelContainer) {
        labelContainer.setAttribute("context", "zentral-tabgroup-context-menu");
        if (!labelContainer._zentralContextMenuBound) {
          labelContainer._zentralContextMenuBound = true;
          labelContainer.addEventListener("contextmenu", (event) => {
            if (event.target.closest("#tab-label-input")) return;
            event.preventDefault();
            event.stopPropagation();
            this.#state.contextMenuCurrentGroup = group;
            this.#state.lastContextMenuX = event.screenX;
            this.#state.lastContextMenuY = event.screenY;
            if (sharedMenu) {
              if (typeof sharedMenu.openPopupAtScreen === "function") {
                sharedMenu.openPopupAtScreen(
                  event.screenX,
                  event.screenY,
                  true,
                );
              } else if (typeof sharedMenu.openPopup === "function") {
                sharedMenu.openPopup(
                  labelContainer,
                  "after_start",
                  0,
                  0,
                  true,
                  false,
                  event,
                );
              }
            }
          });
        }
      }
      group.setAttribute("context", "zentral-tabgroup-context-menu");

      // Bind group specific actions for external callers
      group._useFaviconColor = () => {
        this.applyAverageGroupColor(group, true);
      };

      group.ungroupTabs = () => {
        try {
          const ss = this.#getSessionStore();
          this.removeSavedColor(group.id);

          const parentContainer =
            group.parentNode || document.getElementById("tabbrowser-tabs");

          // 1. Gather all tab DOM elements physically contained within this group
          let tabs = Array.from(
            group.querySelectorAll("tab, tabbrowser-tab, .tabbrowser-tab"),
          );

          if (tabs.length === 0 && group.tabs) {
            tabs = Array.from(group.tabs);
          }
          if (tabs.length === 0 && window.gBrowser?.tabs) {
            tabs = Array.from(gBrowser.tabs).filter(
              (t) =>
                t.group === group ||
                t.getAttribute("group") === group.id ||
                t.getAttribute("zen-group") === group.id ||
                t.closest("tab-group") === group,
            );
          }

          // 2. Physically re-parent every tab element outside of the group element before removing the group
          if (parentContainer) {
            tabs.forEach((tab) => {
              try {
                parentContainer.insertBefore(tab, group);
              } catch (e) {
                try {
                  parentContainer.appendChild(tab);
                } catch (err) {}
              }

              // Disassociate tab from group in JS APIs and attributes
              try {
                if (typeof gBrowser?.addTabToGroup === "function") {
                  gBrowser.addTabToGroup(tab, null);
                }
              } catch (e) {}
              try {
                if (tab.group !== undefined) {
                  tab.group = null;
                }
              } catch (e) {}
              try {
                tab.removeAttribute("group");
                tab.removeAttribute("zen-group");
              } catch (e) {}

              // Clean all Zentral custom data attributes and SessionStore metadata
              [
                "data-zentral-group-id",
                "data-zentral-group-label",
                "data-zentral-group-color",
                "data-zentral-group-collapsed",
                "data-zentral-group-ws",
                "data-zentral-parent-id",
              ].forEach((attr) => tab.removeAttribute(attr));
              if (ss) {
                [
                  "zentral-group-id",
                  "zentral-group-label",
                  "zentral-group-color",
                  "zentral-parent-id",
                  "zentral-group-collapsed",
                  "zentral-group-ws",
                ].forEach((key) => {
                  try {
                    if (typeof ss.deleteCustomTabValue === "function")
                      ss.deleteCustomTabValue(tab, key);
                    else if (typeof ss.setCustomTabValue === "function")
                      ss.setCustomTabValue(tab, key, "");
                  } catch (_) {}
                });
              }
            });
          }

          // 3. Remove the group via the native API so Zen's internal registry stays consistent.
          try {
            if (typeof gBrowser?.removeTabGroup === "function") {
              gBrowser.removeTabGroup(group);
            } else {
              group.remove();
            }
          } catch (e) {
            try {
              group.remove();
            } catch (_) {}
          }

          // 4. Immediately synchronize and persist clean state so deleted group never resurrects
          this.saveTabGroupState();
        } catch (e) {
          console.error("[ZentralTabGroups] Error ungrouping tabs:", e);
        }
      };
    }

    /**
     * Checks if a tab group ID is already recorded in persistent storage (PREF_STATE or PREF_COLORS).
     * Used to ensure groups are only auto-colored with the average color when created for the first time ever.
     * @param {string} groupId - The tab group ID.
     * @returns {boolean} True if the group was previously saved/known.
     */
    isGroupKnownInSavedState(groupId) {
      if (!groupId) return false;
      try {
        const stateStr = Core.getPref(Constants.TabGroups.PREF_STATE);
        if (stateStr && stateStr !== "{}") {
          const parsed = JSON.parse(stateStr);
          const groups = parsed && parsed.groups ? parsed.groups : parsed || {};
          if (groups && groups[groupId]) return true;
        }
      } catch (_) {}
      try {
        const rawColors = Core.getPref(Constants.TabGroups.PREF_COLORS);
        if (rawColors && rawColors !== "{}") {
          const colors = JSON.parse(rawColors) || {};
          if (colors && colors[groupId]) return true;
        }
      } catch (_) {}
      return false;
    }

    /**
     * Asynchronously extracts the dominant/average RGB color from a tab's favicon image.
     * Uses HTMLImageElement in chrome privilege without CORS restrictions.
     * @param {Element} tab - Tab element.
     * @returns {Promise<Array<number>|null>} [r, g, b] color tuple or null.
     */
    extractTabFaviconColor(tab) {
      return new Promise((resolve) => {
        if (!tab) return resolve(null);

        let src = tab.getAttribute("image") || tab.image;
        if (!src) {
          const iconEl = tab.querySelector(
            ".tab-icon-image, img.tab-icon-image, image.tab-icon-image",
          );
          src =
            iconEl?.getAttribute("src") ||
            iconEl?.src ||
            iconEl?.getAttribute("image");
        }

        if (
          !src ||
          typeof src !== "string" ||
          src.includes("defaultFavicon.svg") ||
          src.includes("globe.svg")
        ) {
          return resolve(null);
        }

        const img = new Image();
        let done = false;

        const finish = (result) => {
          if (!done) {
            done = true;
            resolve(result);
          }
        };

        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            const w = img.naturalWidth || img.width || 16;
            const h = img.naturalHeight || img.height || 16;
            canvas.width = Math.min(32, Math.max(1, w));
            canvas.height = Math.min(32, Math.max(1, h));
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const data = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            let r = 0,
              g = 0,
              b = 0,
              count = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i + 3] > 128) {
                const brightness = data[i] + data[i + 1] + data[i + 2];
                if (brightness > 40 && brightness < 720) {
                  r += data[i];
                  g += data[i + 1];
                  b += data[i + 2];
                  count++;
                }
              }
            }
            if (count > 0) {
              finish([
                Math.round(r / count),
                Math.round(g / count),
                Math.round(b / count),
              ]);
            } else {
              let r2 = 0,
                g2 = 0,
                b2 = 0,
                count2 = 0;
              for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] > 64) {
                  r2 += data[i];
                  g2 += data[i + 1];
                  b2 += data[i + 2];
                  count2++;
                }
              }
              if (count2 > 0) {
                finish([
                  Math.round(r2 / count2),
                  Math.round(g2 / count2),
                  Math.round(b2 / count2),
                ]);
              } else {
                finish(null);
              }
            }
          } catch (_) {
            finish(null);
          }
        };

        img.onerror = () => finish(null);
        img.src = src;

        if (img.complete && (img.naturalWidth > 0 || img.width > 0)) {
          img.onload();
        }

        setTimeout(() => finish(null), 1000);
      });
    }

    /**
     * Resolves a fallback color for a tab from container identity colors or Zen primary color.
     * @param {Element} tab - Tab element.
     * @returns {Array<number>} [r, g, b] color tuple.
     */
    getTabFallbackColor(tab) {
      if (tab) {
        const identityColors = {
          blue: [55, 142, 240],
          turquoise: [0, 195, 218],
          green: [81, 205, 75],
          yellow: [255, 203, 47],
          orange: [255, 148, 43],
          red: [255, 80, 80],
          pink: [255, 107, 182],
          purple: [175, 95, 255],
        };
        for (const [name, rgb] of Object.entries(identityColors)) {
          if (tab.classList?.contains(`identity-color-${name}`)) {
            return rgb;
          }
        }
      }
      try {
        const primary = window
          .getComputedStyle(document.documentElement)
          .getPropertyValue("--zen-primary-color");
        if (primary) {
          const match = primary.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (match)
            return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
        }
      } catch (_) {}
      return [112, 122, 194];
    }

    /**
     * Computes the average favicon color from all member tabs and applies it to the tab group.
     * @param {Element} group - Tab group element.
     * @param {boolean} [force=false] - Force apply even if already colored.
     */
    async applyAverageGroupColor(group, force = false) {
      if (!group || !group.isConnected) return;

      if (!force) {
        const customColor = group.style.getPropertyValue(
          "--zentral-custom-color",
        );
        const tgColor = group.style.getPropertyValue("--tab-group-color");
        const hasExplicitColor =
          (customColor &&
            customColor.trim() &&
            customColor !== "transparent") ||
          (tgColor &&
            tgColor.trim() &&
            !tgColor.startsWith("var(--tab-group-") &&
            tgColor !== "transparent");
        if (hasExplicitColor) return;
      }

      group._zentralColoringInProgress = true;

      try {
        let tabs = this.getDirectTabs(group);
        if (tabs.length === 0) {
          const contextTabs =
            window.TabContextMenu?.contextTabs ||
            (window.TabContextMenu?.contextTab
              ? [window.TabContextMenu.contextTab]
              : []);
          if (contextTabs.length > 0) {
            tabs = contextTabs;
          } else if (window.gBrowser?.selectedTabs?.length > 0) {
            tabs = Array.from(window.gBrowser.selectedTabs);
          } else if (window.gBrowser?.selectedTab) {
            tabs = [window.gBrowser.selectedTab];
          }
        }

        const retryDelays = [60, 150, 300, 500];
        let attempt = 0;
        while (tabs.length === 0 && attempt < retryDelays.length) {
          await new Promise((r) => setTimeout(r, retryDelays[attempt++]));
          if (!group.isConnected) return;
          tabs = this.getDirectTabs(group);
        }

        if (tabs.length === 0) return;

        const colors = [];
        for (const tab of tabs) {
          const col = await this.extractTabFaviconColor(tab);
          if (col) colors.push(col);
        }

        let finalColor = null;
        if (colors.length > 0) {
          finalColor = this.calculateAverageColor(colors);
        } else {
          finalColor = this.getTabFallbackColor(tabs[0]);
        }

        if (finalColor && group.isConnected) {
          const colorString = `rgb(${finalColor[0]}, ${finalColor[1]}, ${finalColor[2]})`;
          group.style.setProperty("--tab-group-color", colorString);
          group.style.setProperty("--tab-group-color-invert", colorString);
          group.style.setProperty("--zentral-custom-color", colorString);
          group.style.setProperty(
            "--zentral-tabgroup-contrast-color",
            this.getContrastColor(colorString),
          );
          this.saveTabGroupColors();
          this.scheduleStateSave();
          group._zentralInitialColorChecked = true;
        }

        // If colors were not ready yet (favicon was still downloading), schedule a retry upgrade after 750ms
        if (colors.length === 0) {
          setTimeout(async () => {
            if (!group.isConnected) return;
            const retryTabs = this.getDirectTabs(group);
            if (retryTabs.length === 0) return;
            const retryColors = [];
            for (const tab of retryTabs) {
              const col = await this.extractTabFaviconColor(tab);
              if (col) retryColors.push(col);
            }
            if (retryColors.length > 0) {
              const fColor = this.calculateAverageColor(retryColors);
              const cStr = `rgb(${fColor[0]}, ${fColor[1]}, ${fColor[2]})`;
              group.style.setProperty("--tab-group-color", cStr);
              group.style.setProperty("--tab-group-color-invert", cStr);
              group.style.setProperty("--zentral-custom-color", cStr);
              group.style.setProperty(
                "--zentral-tabgroup-contrast-color",
                this.getContrastColor(cStr),
              );
              this.saveTabGroupColors();
              this.scheduleStateSave();
            }
          }, 750);
        }
      } finally {
        group._zentralColoringInProgress = false;
      }
    }

    /**
     * Checks whether a tab group is being created for the first time ever, and if so,
     * applies the average group color automatically.
     * NEVER runs on browser restart or reconstructed groups.
     * @param {Element} group - Tab group DOM element.
     */
    checkAndApplyFirstTimeGroupColor(group) {
      // 1. Never run while the browser is starting up / restoring sessions
      if (this.#isRestoring) return;

      // 2. Ignore invalid, disconnected, or split view groups
      if (!group || !group.isConnected || !group.id) return;
      if (
        group.hasAttribute("split-view-group") ||
        group.hasAttribute("zen-split-view") ||
        group.hasAttribute("is-zen-split") ||
        group.classList?.contains("zen-split-view")
      )
        return;

      // 3. Prevent duplicate evaluation on the same group instance if already checked or in progress
      if (group._zentralInitialColorChecked || group._zentralColoringInProgress)
        return;

      // 4. If group already has an explicit custom color assigned, don't overwrite it
      const customColor = group.style.getPropertyValue(
        "--zentral-custom-color",
      );
      const tgColor = group.style.getPropertyValue("--tab-group-color");
      const hasExplicitColor =
        (customColor && customColor.trim() && customColor !== "transparent") ||
        (tgColor &&
          tgColor.trim() &&
          !tgColor.startsWith("var(--tab-group-") &&
          tgColor !== "transparent");
      if (hasExplicitColor) return;

      // 5. If group was previously saved/known in persistent storage, NEVER default to auto color on reconstruction
      if (this.isGroupKnownInSavedState(group.id)) return;

      // This is a brand new group created for the FIRST TIME EVER:
      this.applyAverageGroupColor(group, false);
    }

    /**
     * Schedules a debounced refresh of sub-groups indicator badges.
     */
    scheduleBadgeUpdate() {
      if (this.#badgeUpdateRAF) return;
      this.#badgeUpdateRAF = window.requestAnimationFrame(() => {
        this.#badgeUpdateRAF = null;
        this.updateAllSubGroupsBadges();
      });
    }

    /**
     * Updates the sub-groups indicator badge on a tab group header.
     * Displays count of direct child sub-groups when collapsed.
     * @param {Element} group - The tab-group element.
     * @param {Array<Element>} [cachedAllGroups=null] - Optional pre-queried tab-group array to eliminate redundant DOM queries.
     */
    updateGroupSubGroupsBadge(group, cachedAllGroups = null) {
      if (!group || !group.isConnected || group.nodeType !== Node.ELEMENT_NODE)
        return;
      if (
        group.hasAttribute("split-view-group") ||
        group.hasAttribute("zen-split-view") ||
        group.hasAttribute("is-zen-split") ||
        group.classList?.contains("zen-split-view")
      )
        return;

      const badge = group.querySelector(
        ":scope > .tab-group-label-container .zentral-subgroups-badge",
      );
      if (!badge) return;

      const allGroups =
        cachedAllGroups ||
        Array.from(
          document.querySelectorAll(
            "tab-group:not([split-view-group]):not([zen-split-view]):not([is-zen-split])",
          ),
        ).filter((g) => !g.classList?.contains("zen-split-view"));
      const childCount = allGroups.filter(
        (other) =>
          other !== group &&
          other.isConnected &&
          other.parentElement?.closest("tab-group") === group,
      ).length;

      const currentHas = group.getAttribute("data-has-subgroups");
      const targetHas = childCount > 0 ? childCount.toString() : null;
      if (currentHas !== targetHas) {
        if (targetHas) {
          group.setAttribute("data-has-subgroups", targetHas);
        } else {
          group.removeAttribute("data-has-subgroups");
        }
      }

      const targetText =
        childCount > 0
          ? childCount === 1
            ? "1 Sub-Group"
            : `${childCount} Sub-Groups`
          : "";
      if (badge.textContent !== targetText) {
        badge.textContent = targetText;
      }
    }

    /**
     * Refreshes sub-group badges across all tab groups in the document.
     * Pre-queries and batches tab group elements for O(N) traversal efficiency.
     */
    updateAllSubGroupsBadges() {
      if (this.#isUpdatingBadges) return;
      this.#isUpdatingBadges = true;
      try {
        const allGroups = Array.from(
          document.querySelectorAll(
            "tab-group:not([split-view-group]):not([zen-split-view]):not([is-zen-split])",
          ),
        ).filter((g) => !g.classList?.contains("zen-split-view"));
        allGroups.forEach((g) => {
          this.updateGroupSubGroupsBadge(g, allGroups);
        });
      } catch (err) {
        Core.error("ZentralTabGroups", "Error updating badges:", err);
      } finally {
        this.#isUpdatingBadges = false;
      }
    }

    /**
     * Prevents dormant tabs and split views from being selected and loaded while being dragged or reordered.
     * Defers mousedown tab selection until mouseup (for clicks) and isolates the drag payload during startTabDrag (for drags).
     */
    initTabDragSelectionGuard() {
      const tabContainer =
        gBrowser?.tabContainer || document.getElementById("tabbrowser-tabs");
      if (!tabContainer || this.#tabDragGuardInitialized) return;
      this.#tabDragGuardInitialized = true;

      let isGuardingTab = false;
      let dragCandidateTab = null;
      let startX = 0;
      let startY = 0;

      // Helper: resolve tab or split view primary tab
      const resolveTab = (target) => {
        if (!target || typeof target.closest !== "function") return null;
        const tab = target.closest("tab, tabbrowser-tab, .tabbrowser-tab");
        if (tab) return tab;
        const splitGroup = target.closest(
          "tab-group[split-view-group], tab-group[zen-split-view], tab-group[is-zen-split]",
        );
        if (splitGroup) {
          return (
            splitGroup.tabs?.[0] ||
            splitGroup.querySelector("tab, tabbrowser-tab, .tabbrowser-tab")
          );
        }
        return null;
      };

      // 1. Intercept mousedown on tabContainer to prevent Firefox tab.on_mousedown
      //    from immediately selecting the tab before we know if it's a click or a drag.
      const onMouseDown = (e) => {
        if (e.button !== 0) return;
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        if (
          e.target?.closest?.(
            ".tab-close-button, .tab-icon-sound, .tab-audio-button, .tab-pin-icon, .tab-reset-button",
          )
        )
          return;

        const tab = resolveTab(e.target);
        if (!tab) return;

        const currentActive = window.gBrowser?.selectedTab;
        if (tab !== currentActive && !tab.multiselected) {
          dragCandidateTab = tab;
          isGuardingTab = true;
          startX = e.clientX;
          startY = e.clientY;

          // Temporarily lock gBrowser.selectedTab and tabContainer.selectedItem
          // so tab.on_mousedown does NOT switch the active tab on mousedown.
          if (window.gBrowser) {
            Object.defineProperty(window.gBrowser, "selectedTab", {
              get: () => currentActive,
              set: () => {},
              configurable: true,
            });
          }

          if (tabContainer) {
            Object.defineProperty(tabContainer, "selectedItem", {
              get: () => currentActive,
              set: () => {},
              configurable: true,
            });
          }
        }
      };

      // 2. On mouseup: if distance < 6px (click), activate the candidate tab.
      const onMouseUp = (e) => {
        if (isGuardingTab) {
          // Release temporary locks immediately
          if (window.gBrowser) delete window.gBrowser.selectedTab;
          if (tabContainer) delete tabContainer.selectedItem;
          isGuardingTab = false;

          if (dragCandidateTab && dragCandidateTab.isConnected) {
            const moveDist = Math.hypot(e.clientX - startX, e.clientY - startY);
            if (
              moveDist < 6 &&
              dragCandidateTab !== window.gBrowser?.selectedTab
            ) {
              const targetTab = dragCandidateTab;
              dragCandidateTab = null;
              try {
                window.gBrowser.selectedTab = targetTab;
              } catch (_) {}
            }
          }
        }
        dragCandidateTab = null;
      };

      const clearGuard = () => {
        if (isGuardingTab) {
          if (window.gBrowser) delete window.gBrowser.selectedTab;
          if (tabContainer) delete tabContainer.selectedItem;
          isGuardingTab = false;
        }
        dragCandidateTab = null;
      };

      // 3. Prevent native HTML Drag & Drop from intercepting split-view splitter resizing
      const onSplitterDragStart = (e) => {
        if (
          e.target?.closest?.(
            ".zen-split-view-splitter, #zen-splitview-overlay, .zen-view-splitter-header-container:not(:has(toolbarbutton.zen-tab-rearrange-button))",
          )
        ) {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      const onSplitterMouseDown = (e) => {
        if (e.button === 0 && e.target?.closest?.(".zen-split-view-splitter")) {
          e.preventDefault();
        }
      };

      tabContainer.addEventListener("mousedown", onMouseDown, {
        capture: true,
      });
      window.addEventListener("mouseup", onMouseUp, { capture: true });
      window.addEventListener("dragend", clearGuard, { capture: true });
      window.addEventListener("drop", clearGuard, { capture: true });
      window.addEventListener("dragstart", onSplitterDragStart, {
        capture: true,
      });
      window.addEventListener("mousedown", onSplitterMouseDown, {
        capture: true,
      });

      // 4. Hook _getDragTarget across ZenDragAndDrop and TabDragAndDrop so split views drag as native tabs
      const dndTargets = [
        window.ZenDragAndDrop?.prototype,
        tabContainer.tabDragAndDrop,
        window.TabDragAndDrop?.prototype,
      ].filter((t) => t && typeof t._getDragTarget === "function");

      const origDragTargetMap = new Map();

      dndTargets.forEach((target) => {
        if (!origDragTargetMap.has(target)) {
          const orig = target._getDragTarget;
          origDragTargetMap.set(target, orig);
          target._getDragTarget = function (event, options) {
            const res = orig.call(this, event, options);
            if (res) {
              const splitGroup =
                res.closest?.(
                  "tab-group[split-view-group], tab-group[zen-split-view], tab-group[is-zen-split]",
                ) || res.group;
              if (
                splitGroup &&
                (splitGroup.hasAttribute?.("split-view-group") ||
                  splitGroup.hasAttribute?.("zen-split-view"))
              ) {
                const primaryTab =
                  splitGroup.tabs?.[0] ||
                  splitGroup.querySelector?.(
                    "tab, tabbrowser-tab, .tabbrowser-tab",
                  );
                if (primaryTab) {
                  return primaryTab;
                }
              }
            }
            return res;
          };
        }
      });

      // 5. Hook startTabDrag across ZenDragAndDrop and TabDragAndDrop
      const targets = [
        window.ZenDragAndDrop?.prototype,
        tabContainer.tabDragAndDrop,
        window.TabDragAndDrop?.prototype,
      ].filter((t) => t && typeof t.startTabDrag === "function");

      const origStartMap = new Map();

      targets.forEach((target) => {
        if (!origStartMap.has(target)) {
          const orig = target.startTabDrag;
          origStartMap.set(target, orig);
          target.startTabDrag = function (event, tab, options = {}) {
            // Release mousedown lock so startTabDrag can run cleanly
            if (isGuardingTab) {
              if (window.gBrowser) delete window.gBrowser.selectedTab;
              if (tabContainer) delete tabContainer.selectedItem;
              isGuardingTab = false;
            }

            const currentActiveTab = window.gBrowser?.selectedTab;
            // A tab or split view is dormant if it is not the currently active tab
            const isDormant =
              tab && tab !== currentActiveTab && !tab.multiselected;

            if (isDormant && window.gBrowser) {
              // Temporarily isolate selectedElements so Firefox only bundles the dragged tab/split view
              Object.defineProperty(window.gBrowser, "selectedElements", {
                get: () => [tab],
                configurable: true,
              });

              // Temporarily suppress selectedTab and selectedItem setters during startTabDrag
              Object.defineProperty(window.gBrowser, "selectedTab", {
                get: () => currentActiveTab,
                set: () => {},
                configurable: true,
              });

              if (tabContainer) {
                Object.defineProperty(tabContainer, "selectedItem", {
                  get: () => currentActiveTab,
                  set: () => {},
                  configurable: true,
                });
              }

              try {
                return orig.call(this, event, tab, options);
              } catch (e) {
                if (Core.getPref(Constants.DEBUG_PREF))
                  console.warn("[Zentral] startTabDrag snapshot notice:", e);
                return true;
              } finally {
                // Restore native prototype getters and setters immediately
                delete window.gBrowser.selectedElements;
                delete window.gBrowser.selectedTab;
                if (tabContainer) {
                  delete tabContainer.selectedItem;
                }
              }
            }

            try {
              return orig.call(this, event, tab, options);
            } catch (e) {
              if (Core.getPref(Constants.DEBUG_PREF))
                console.warn("[Zentral] startTabDrag fallback:", e);
              return true;
            }
          };
        }
      });

      // 6. Implement Same-Window Tab Group & Split View Reordering in gBrowser.adoptTabGroup
      let origAdoptTabGroup = null;
      if (
        window.gBrowser &&
        typeof window.gBrowser.adoptTabGroup === "function"
      ) {
        origAdoptTabGroup = window.gBrowser.adoptTabGroup;
        window.gBrowser.adoptTabGroup = function (group, options = {}) {
          if (group && group.ownerDocument === document) {
            let target = options.insertBefore;
            if (
              !target &&
              options.elementIndex !== undefined &&
              tabContainer?.ariaFocusableItems
            ) {
              target =
                tabContainer.ariaFocusableItems.at(options.elementIndex) ||
                null;
            }
            if (
              target &&
              target !== group &&
              target !== group.labelContainerElement &&
              !group.contains(target)
            ) {
              target.before(group);
            } else if (!target && tabContainer?.arrowScrollbox) {
              tabContainer.arrowScrollbox.appendChild(group);
            }
            return group;
          }
          return origAdoptTabGroup.call(this, group, options);
        };
      }

      // 7. Intercept gZenViewSplitter.splitTabs to maintain dormant tab state during split creation
      let origSplitTabs = null;
      if (
        window.gZenViewSplitter &&
        typeof window.gZenViewSplitter.splitTabs === "function"
      ) {
        origSplitTabs = window.gZenViewSplitter.splitTabs;
        window.gZenViewSplitter.splitTabs = function (
          tabs,
          gridType,
          initialIndex = 0,
          options = {},
        ) {
          const currentActiveTab = window.gBrowser?.selectedTab;
          const hasActiveTab =
            Array.isArray(tabs) &&
            currentActiveTab &&
            tabs.includes(currentActiveTab);
          let targetIndex = initialIndex;
          if (!hasActiveTab && targetIndex >= 0) {
            targetIndex = -1;
          }
          return origSplitTabs.call(this, tabs, gridType, targetIndex, options);
        };
      }

      // 8. Filter split-view groups from gBrowser.getAllTabGroups so they never appear as "Unnamed group" in "Add Tab to Group" context menus
      let origGetAllTabGroups = null;
      if (
        window.gBrowser &&
        typeof window.gBrowser.getAllTabGroups === "function"
      ) {
        origGetAllTabGroups = window.gBrowser.getAllTabGroups;
        window.gBrowser.getAllTabGroups = function (options) {
          const groups = origGetAllTabGroups.call(this, options);
          return groups.filter(
            (g) =>
              g &&
              !g.hasAttribute?.("split-view-group") &&
              !g.hasAttribute?.("zen-split-view") &&
              !g.hasAttribute?.("is-zen-split"),
          );
        };
      }

      this.#dragGuardCleanup = () => {
        tabContainer.removeEventListener("mousedown", onMouseDown, {
          capture: true,
        });
        window.removeEventListener("mouseup", onMouseUp, { capture: true });
        window.removeEventListener("dragend", clearGuard, { capture: true });
        window.removeEventListener("drop", clearGuard, { capture: true });
        window.removeEventListener("dragstart", onSplitterDragStart, {
          capture: true,
        });
        window.removeEventListener("mousedown", onSplitterMouseDown, {
          capture: true,
        });
        clearGuard();
        origDragTargetMap.forEach((orig, target) => {
          target._getDragTarget = orig;
        });
        origDragTargetMap.clear();
        origStartMap.forEach((orig, target) => {
          target.startTabDrag = orig;
        });
        origStartMap.clear();
        if (origAdoptTabGroup && window.gBrowser) {
          window.gBrowser.adoptTabGroup = origAdoptTabGroup;
        }
        if (origSplitTabs && window.gZenViewSplitter) {
          window.gZenViewSplitter.splitTabs = origSplitTabs;
        }
        if (origGetAllTabGroups && window.gBrowser) {
          window.gBrowser.getAllTabGroups = origGetAllTabGroups;
        }
        this.#tabDragGuardInitialized = false;
      };
    }

    /* --------------------------------------------------------------------------
     * 4.3 Group Hierarchy & Storage Serialization
     * --------------------------------------------------------------------------
     */

    /**
     * Converts a tab group into a native Zen tab folder.
     * @param {Element} group - Tab group DOM element.
     */
    convertGroupToFolder(group) {
      if (!window.gZenFolders) return;
      const tabs = Array.from(group.tabs);
      if (tabs.length === 0) return;

      const newFolder = window.gZenFolders.createFolder(tabs, {
        label: group.label || "New Folder",
        renameFolder: false,
        workspaceId:
          group.getAttribute("zen-workspace-id") ||
          window.gZenWorkspaces?.activeWorkspace,
      });

      if (newFolder) {
        try {
          gBrowser.removeTabGroup(group);
          this.removeSavedColor(group.id);
        } catch (e) {}
      }
    }

    /**
     * Converts a native Zen tab folder into a Zentral tab group.
     * @param {Element} folder - Zen folder DOM element.
     */
    convertFolderToGroup(folder) {
      const tabsToGroup = folder.allItemsRecursive.filter(
        (item) => gBrowser.isTab(item) && !item.hasAttribute("zen-empty-tab"),
      );
      if (tabsToGroup.length === 0) {
        if (folder?.isConnected && typeof folder.delete === "function")
          folder.delete();
        return;
      }

      tabsToGroup.forEach((tab) => {
        if (tab.pinned) gBrowser.unpinTab(tab);
      });
      setTimeout(() => {
        const newGroup = document.createXULElement("tab-group");
        newGroup.id = `${Date.now()}-${Math.round(Math.random() * 100)}`;
        newGroup.label = folder.label || "New Group";

        const container =
          gZenWorkspaces.activeWorkspaceStrip ||
          gBrowser.tabContainer.querySelector("tabs");
        container.prepend(newGroup);
        newGroup.addTabs(tabsToGroup);

        if (folder?.isConnected && typeof folder.delete === "function")
          folder.delete();
        this.processGroup(newGroup);
      }, 200);
    }

    /**
     * Computes the average RGB color from an array of RGB color tuples.
     * @param {Array<Array<number>>} colors - Array of [r, g, b] tuples.
     * @returns {Array<number>} Average [r, g, b] color tuple.
     */
    calculateAverageColor(colors) {
      if (colors.length === 0) return [0, 0, 0];
      const total = colors.reduce(
        (acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]],
        [0, 0, 0],
      );
      return [
        Math.round(total[0] / colors.length),
        Math.round(total[1] / colors.length),
        Math.round(total[2] / colors.length),
      ];
    }

    /**
     * Determines contrasting text color ('black' or 'white') for a given background color string.
     * @param {string} colorStr - Hex or RGB color string.
     * @returns {string} 'black' or 'white'.
     */
    getContrastColor(colorStr) {
      if (!colorStr) return "#ffffff";
      let r, g, b;
      const str = colorStr.trim();
      if (str.startsWith("rgb")) {
        const match = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          r = parseInt(match[1]);
          g = parseInt(match[2]);
          b = parseInt(match[3]);
        }
      } else if (str.startsWith("#")) {
        const hex = str.replace("#", "");
        if (hex.length === 3) {
          r = parseInt(hex[0] + hex[0], 16);
          g = parseInt(hex[1] + hex[1], 16);
          b = parseInt(hex[2] + hex[2], 16);
        } else if (hex.length >= 6) {
          r = parseInt(hex.substr(0, 2), 16);
          g = parseInt(hex.substr(2, 2), 16);
          b = parseInt(hex.substr(4, 2), 16);
        }
      }
      if (r !== undefined && g !== undefined && b !== undefined) {
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.55 ? "#111111" : "#ffffff";
      }
      return "#ffffff";
    }

    /**
     * Clears cached color picker reference objects from window global scope.
     */
    clearStoredColorData() {
      if (window.gZenThemePicker) {
        delete window.gZenThemePicker._currentTabGroup;
        delete window.gZenThemePicker._tabGroupForColorPicker;
      }
    }

    /**
     * Saves tab group custom colors map to user preferences.
     */
    async saveTabGroupColors() {
      let colors = {};
      try {
        const raw = Core.getPref(Constants.TabGroups.PREF_COLORS);
        if (raw && raw !== "{}") colors = JSON.parse(raw) || {};
      } catch (_) {}
      document
        .querySelectorAll("tab-group:not([split-view-group])")
        .forEach((group) => {
          if (group.id) {
            const customColor = group.style.getPropertyValue(
              "--zentral-custom-color",
            );
            const tgColor = group.style.getPropertyValue("--tab-group-color");
            const color =
              customColor && customColor.trim() && customColor !== "transparent"
                ? customColor
                : tgColor &&
                    !tgColor.startsWith("var(--tab-group-") &&
                    tgColor !== "transparent"
                  ? tgColor
                  : null;
            if (color) colors[group.id] = color;
          }
        });
      Core.setPref(Constants.TabGroups.PREF_COLORS, JSON.stringify(colors));
      this.scheduleStateSave();
    }

    /**
     * Loads and applies saved custom tab group colors from user preferences.
     */
    async loadSavedColors() {
      try {
        const colors = JSON.parse(
          Core.getPref(Constants.TabGroups.PREF_COLORS),
        );
        if (Object.keys(colors).length > 0) {
          setTimeout(() => {
            Object.entries(colors).forEach(([id, color]) => {
              const group = document.getElementById(id);
              if (group && !group.hasAttribute("split-view-group")) {
                group.style.setProperty("--tab-group-color", color);
                group.style.setProperty("--tab-group-color-invert", color);
                group.style.setProperty("--zentral-custom-color", color);
                group.style.setProperty(
                  "--zentral-tabgroup-contrast-color",
                  this.getContrastColor(color),
                );
              }
            });
          }, 500);
        }
      } catch (e) {}
    }

    /**
     * Removes a stored color entry for a deleted tab group.
     * @param {string} groupId - Unique tab group ID string.
     */
    async removeSavedColor(groupId) {
      try {
        const colors = JSON.parse(
          Core.getPref(Constants.TabGroups.PREF_COLORS),
        );
        if (colors[groupId]) {
          delete colors[groupId];
          Core.setPref(Constants.TabGroups.PREF_COLORS, JSON.stringify(colors));
          this.scheduleStateSave();
        }
      } catch (e) {}
    }

    /**
     * Schedules debounced state save for tab groups to prevent excessive disk writes.
     */
    scheduleStateSave() {
      if (this.#isRestoring) return;
      if (this.#state.saveStateTimer) clearTimeout(this.#state.saveStateTimer);
      this.#state.saveStateTimer = setTimeout(
        () => this.saveTabGroupState(),
        1000,
      );
    }

    /**
     * Serializes tab group hierarchy, parent relationships, and collapsed states to user preferences.
     */
    saveTabGroupState() {
      try {
        const ss = this.#getSessionStore();
        const currentWs = window.gZenWorkspaces?.activeWorkspace;

        // Clean any tabs that are no longer part of any tab group (guarding other workspaces)
        const allBrowserTabs = Array.from(
          gBrowser?.tabs ||
            document.querySelectorAll("tab, tabbrowser-tab, .tabbrowser-tab"),
        );
        allBrowserTabs.forEach((tab) => {
          // Guard: Never strip attributes or SessionStore from tabs belonging to other workspaces
          const tabWs = this.getWorkspaceForElement(tab);
          if (currentWs && tabWs && tabWs !== currentWs) return;
          if (tab.hidden && currentWs && tabWs && tabWs !== currentWs) return;

          const isSplit =
            tab.hasAttribute?.("is-zen-split") ||
            tab.hasAttribute?.("zen-split-view") ||
            tab.closest?.(
              "tab-group[split-view-group], tab-group[zen-split-view], tab-group[is-zen-split]",
            );
          const tabGroup = !isSplit
            ? tab.closest(
                "tab-group:not([split-view-group]):not([zen-split-view]):not([is-zen-split])",
              ) ||
              (tab.group &&
              !tab.group.hasAttribute?.("split-view-group") &&
              !tab.group.hasAttribute?.("zen-split-view") &&
              !tab.group.hasAttribute?.("is-zen-split")
                ? tab.group
                : null)
            : null;
          if (!tabGroup) {
            [
              "data-zentral-group-id",
              "data-zentral-group-label",
              "data-zentral-group-color",
              "data-zentral-group-collapsed",
              "data-zentral-group-ws",
              "data-zentral-parent-id",
            ].forEach((attr) => tab.removeAttribute(attr));
            if (ss) {
              [
                "zentral-group-id",
                "zentral-group-label",
                "zentral-group-color",
                "zentral-parent-id",
                "zentral-group-collapsed",
                "zentral-group-ws",
              ].forEach((key) => {
                try {
                  if (typeof ss.deleteCustomTabValue === "function")
                    ss.deleteCustomTabValue(tab, key);
                  else if (typeof ss.setCustomTabValue === "function")
                    ss.setCustomTabValue(tab, key, "");
                } catch (_) {}
              });
            }
          }
        });

        // Load existing state to preserve groups and tab mappings from other workspaces
        let existingGroups = {};
        let existingTabMapping = {};
        try {
          const stateStr = Core.getPref(Constants.TabGroups.PREF_STATE);
          if (stateStr && stateStr !== "{}") {
            const parsed = JSON.parse(stateStr);
            existingGroups =
              parsed && parsed.groups ? parsed.groups : parsed || {};
            existingTabMapping =
              parsed && parsed.tabMapping ? parsed.tabMapping : {};
          }
        } catch (_) {}

        const mergedGroups = { ...existingGroups };
        const mergedTabMapping = { ...existingTabMapping };

        // Identify live groups currently present in the DOM
        const liveGroups = Array.from(
          document.querySelectorAll(
            "tab-group:not([split-view-group]):not([zen-split-view]):not([is-zen-split])",
          ),
        );
        const liveGroupIds = new Set(
          liveGroups.map((g) => g.id).filter(Boolean),
        );

        // 1. Prune groups from existingGroups that belonged to currentWs (or had no workspace) but are no longer in the DOM
        for (const gId of Object.keys(existingGroups)) {
          const meta = existingGroups[gId];
          if (!meta) continue;
          const ws = meta.workspaceId;
          const isCurrentWs = !ws || !currentWs || ws === currentWs;
          if (isCurrentWs && !liveGroupIds.has(gId)) {
            delete mergedGroups[gId];
            delete mergedTabMapping[gId];
          }
        }

        liveGroups.forEach((group) => {
          if (!group.id) return;
          if (
            group.hasAttribute("split-view-group") ||
            group.hasAttribute("zen-split-view") ||
            group.hasAttribute("is-zen-split")
          )
            return;

          const parent =
            group.parentElement?.closest("tab-group, zen-folder") ?? null;
          const posContainer = parent
            ? parent.querySelector(".tab-group-container") || parent
            : group.parentElement;
          const allSiblings = posContainer
            ? Array.from(posContainer.children)
            : [];
          const childIndex = allSiblings.indexOf(group);

          // Detect neighboring siblings for robust interleaved positioning between tabs or other groups
          let nextTabZenId = null;
          let nextGroupId = null;
          let prevTabZenId = null;
          let prevGroupId = null;

          const nextSib = group.nextElementSibling;
          if (nextSib) {
            const isTab =
              nextSib.tagName?.toLowerCase() === "tab" ||
              nextSib.classList?.contains("tabbrowser-tab");
            if (isTab)
              nextTabZenId = nextSib.getAttribute("zen-tab-id") || nextSib.id;
            else if (nextSib.tagName?.toLowerCase() === "tab-group")
              nextGroupId = nextSib.id;
          }

          const prevSib = group.previousElementSibling;
          if (prevSib) {
            const isTab =
              prevSib.tagName?.toLowerCase() === "tab" ||
              prevSib.classList?.contains("tabbrowser-tab");
            if (isTab)
              prevTabZenId = prevSib.getAttribute("zen-tab-id") || prevSib.id;
            else if (prevSib.tagName?.toLowerCase() === "tab-group")
              prevGroupId = prevSib.id;
          }

          let directTabs = Array.from(
            group.querySelectorAll("tab, tabbrowser-tab, .tabbrowser-tab"),
          ).filter((t) => t.closest("tab-group") === group);
          if (directTabs.length === 0 && group.tabs) {
            directTabs = Array.from(group.tabs);
          }

          // Check if this group contains nested child groups
          const hasChildGroup = liveGroups.some(
            (other) => other.parentElement?.closest("tab-group") === group,
          );

          // If a live group has 0 direct tabs and no child groups, it is an empty zombie: remove from DOM and skip saving
          if (
            directTabs.length === 0 &&
            !hasChildGroup &&
            !this.#state.creatingGroup
          ) {
            delete mergedGroups[group.id];
            delete mergedTabMapping[group.id];
            try {
              group.remove();
            } catch (_) {}
            return;
          }

          const label = group.label || group.getAttribute("label") || "Group";
          const color =
            group.style.getPropertyValue("--tab-group-color") ||
            group.style.getPropertyValue("--zentral-custom-color") ||
            existingGroups[group.id]?.color ||
            "";
          const wsId = this.getWorkspaceForElement(group);
          if (wsId) group.setAttribute("zen-workspace-id", wsId);
          const isCollapsed =
            group.hasAttribute("collapsed") || group.collapsed === true;

          mergedGroups[group.id] = {
            id: group.id,
            label,
            color,
            collapsed: isCollapsed,
            parentId: parent?.id ?? null,
            workspaceId: wsId,
            index: childIndex >= 0 ? childIndex : 0,
            nextTabZenId,
            nextGroupId,
            prevTabZenId,
            prevGroupId,
          };

          mergedTabMapping[group.id] = directTabs.map((t) => ({
            zenTabId: t.getAttribute("zen-tab-id") || t.id,
            url: t.linkedBrowser?.currentURI?.spec || "",
          }));

          // Synchronize DOM attributes and SessionStore with live state
          directTabs.forEach((tab) => {
            tab.setAttribute("data-zentral-group-id", group.id);
            tab.setAttribute("data-zentral-group-label", label);
            if (color) tab.setAttribute("data-zentral-group-color", color);
            else tab.removeAttribute("data-zentral-group-color");

            tab.setAttribute(
              "data-zentral-group-collapsed",
              group.hasAttribute("collapsed") ? "true" : "false",
            );

            if (wsId) {
              tab.setAttribute("data-zentral-group-ws", wsId);
              tab.setAttribute("zen-workspace-id", wsId);
            } else {
              tab.removeAttribute("data-zentral-group-ws");
            }

            if (parent?.id)
              tab.setAttribute("data-zentral-parent-id", parent.id);
            else tab.removeAttribute("data-zentral-parent-id");

            if (ss && typeof ss.setCustomTabValue === "function") {
              try {
                ss.setCustomTabValue(tab, "zentral-group-id", group.id);
                ss.setCustomTabValue(tab, "zentral-group-label", label);

                if (color)
                  ss.setCustomTabValue(tab, "zentral-group-color", color);
                else if (typeof ss.deleteCustomTabValue === "function")
                  ss.deleteCustomTabValue(tab, "zentral-group-color");

                if (parent?.id)
                  ss.setCustomTabValue(tab, "zentral-parent-id", parent.id);
                else if (typeof ss.deleteCustomTabValue === "function")
                  ss.deleteCustomTabValue(tab, "zentral-parent-id");

                ss.setCustomTabValue(
                  tab,
                  "zentral-group-collapsed",
                  group.hasAttribute("collapsed") ? "true" : "false",
                );

                if (wsId) ss.setCustomTabValue(tab, "zentral-group-ws", wsId);
                else if (typeof ss.deleteCustomTabValue === "function")
                  ss.deleteCustomTabValue(tab, "zentral-group-ws");
              } catch (_) {}
            }
          });
        });

        // Run final sanitization pass to strip 0-tab orphans across all workspaces
        const sanitized = this.sanitizeState({
          groups: mergedGroups,
          tabMapping: mergedTabMapping,
        });

        Core.setPref(Constants.TabGroups.PREF_STATE, JSON.stringify(sanitized));
      } catch (e) {
        console.warn("[ZentralTabGroups] Error saving state", e);
      }
    }

    /**
     * Restores saved tab group DOM hierarchy, nestings, and collapsed states from user preferences.
     */
    loadTabGroupState() {
      try {
        const stateStr = Core.getPref(Constants.TabGroups.PREF_STATE);
        const forceCollapse = Core.getPref(
          Constants.TabGroups.PREF_COLLAPSE_ON_LAUNCH,
        );
        if (!stateStr || stateStr === "{}") return;
        const parsed = JSON.parse(stateStr);
        const state = parsed.groups || parsed;

        // Sort ascending by saved index
        const groupsToProcess = Array.from(
          document.querySelectorAll("tab-group:not([split-view-group])"),
        ).sort((a, b) => {
          const aIdx = state[a.id]?.index ?? Infinity;
          const bIdx = state[b.id]?.index ?? Infinity;
          return aIdx - bIdx;
        });

        // Pass 1: Reconstruct the DOM nesting for groups that have a saved parentId.
        groupsToProcess
          .filter((g) => state[g.id]?.parentId)
          .forEach((group) => {
            const groupState = state[group.id];
            const parent = document.getElementById(groupState.parentId);
            if (!parent || group.contains(parent)) return; // Guard: avoid circular nesting

            const targetParentContainer =
              parent.querySelector(".tab-group-container") || parent;

            // Check if group is already correctly placed inside targetParentContainer
            if (group.parentElement === targetParentContainer) {
              const nextSib = group.nextElementSibling;
              const prevSib = group.previousElementSibling;
              const matchesNext =
                groupState.nextTabZenId &&
                (nextSib?.getAttribute?.("zen-tab-id") ===
                  groupState.nextTabZenId ||
                  nextSib?.id === groupState.nextTabZenId);
              const matchesPrev =
                groupState.prevTabZenId &&
                (prevSib?.getAttribute?.("zen-tab-id") ===
                  groupState.prevTabZenId ||
                  prevSib?.id === groupState.prevTabZenId);
              if (matchesNext || matchesPrev) return; // Already positioned perfectly between the saved tabs!
            }

            let refSibling = null;
            if (groupState.nextTabZenId) {
              refSibling =
                Array.from(targetParentContainer.children).find((el) => {
                  const isTab =
                    el.tagName?.toLowerCase() === "tab" ||
                    el.classList?.contains("tabbrowser-tab");
                  return (
                    isTab &&
                    (el.getAttribute("zen-tab-id") ===
                      groupState.nextTabZenId ||
                      el.id === groupState.nextTabZenId)
                  );
                }) || null;
            }
            if (!refSibling && groupState.nextGroupId) {
              refSibling =
                Array.from(targetParentContainer.children).find(
                  (el) =>
                    el.tagName?.toLowerCase() === "tab-group" &&
                    el.id === groupState.nextGroupId,
                ) || null;
            }
            if (!refSibling && groupState.prevTabZenId) {
              const prevEl = Array.from(targetParentContainer.children).find(
                (el) => {
                  const isTab =
                    el.tagName?.toLowerCase() === "tab" ||
                    el.classList?.contains("tabbrowser-tab");
                  return (
                    isTab &&
                    (el.getAttribute("zen-tab-id") ===
                      groupState.prevTabZenId ||
                      el.id === groupState.prevTabZenId)
                  );
                },
              );
              if (prevEl) refSibling = prevEl.nextElementSibling;
            }
            if (!refSibling && groupState.prevGroupId) {
              const prevEl = Array.from(targetParentContainer.children).find(
                (el) =>
                  el.tagName?.toLowerCase() === "tab-group" &&
                  el.id === groupState.prevGroupId,
              );
              if (prevEl) refSibling = prevEl.nextElementSibling;
            }
            if (
              !refSibling &&
              typeof groupState.index === "number" &&
              groupState.index >= 0 &&
              groupState.index < targetParentContainer.children.length
            ) {
              refSibling = targetParentContainer.children[groupState.index];
            }

            if (refSibling && refSibling !== group) {
              targetParentContainer.insertBefore(group, refSibling);
            } else if (group.parentElement !== targetParentContainer) {
              targetParentContainer.appendChild(group);
            }
          });

        // Pass 2: Restore collapsed states.
        groupsToProcess.forEach((group) => {
          if (!group.id) return;
          const isCollapsed =
            forceCollapse || state[group.id]?.collapsed === true;
          if (isCollapsed) {
            group.setAttribute("collapsed", "true");
            group.collapsed = true;
          } else {
            group.removeAttribute("collapsed");
            group.collapsed = false;
          }
        });
        this.scheduleBadgeUpdate();
      } catch (e) {
        console.warn("[ZentralTabGroups] Failed to load state", e);
      }
    }
  }
const instance=new ZentralTabGroups();
window.Zentral.TabGroups=instance;
const availableAtStart=!!Core.getPref(Constants.TabGroups.PREF_ENABLED) && !(typeof PrivateBrowsingUtils !== "undefined" && PrivateBrowsingUtils.isWindowPrivate(window));
let started=false,disposed=false,watching=false;
const onEnabled=()=>{
  if(disposed||started||!(!!Core.getPref(Constants.TabGroups.PREF_ENABLED) && !(typeof PrivateBrowsingUtils !== "undefined" && PrivateBrowsingUtils.isWindowPrivate(window))))return;
  try{instance.init();started=true;runtime.setAvailable("tab-groups",true);}
  catch(error){try{instance.destroy();}catch(_){}runtime.failFeature("tab-groups",error);}
  if(watching){Services.prefs.removeObserver(Constants.TabGroups.PREF_ENABLED,onEnabled);watching=false;}
};
try{
  if(availableAtStart){instance.init();started=true;}
  else{runtime.setAvailable("tab-groups",false);Services.prefs.addObserver(Constants.TabGroups.PREF_ENABLED,onEnabled);watching=true;}
}catch(error){try{instance.destroy();}catch(_){}delete window.Zentral.TabGroups;throw error;}
return ()=>{disposed=true;if(watching){Services.prefs.removeObserver(Constants.TabGroups.PREF_ENABLED,onEnabled);watching=false;}instance.destroy();delete window.Zentral.TabGroups;};
}});

})();
