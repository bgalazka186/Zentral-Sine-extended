/*
 * ZENTRAL FILE GUIDE - features/groups/controllers/ZentralGroupsNativeAdapter.js
 *
 * Purpose: Integrates native tab opening/addTab, tab drag guards, tabstrip observation and popup
 *   suppression; filters Zen Library copies through a local compatibility switch.
 * Interaction / execution: Installed by ZentralTabGroups. Native events call Store/Dom/Menu peer methods;
 *   checks public Apps panel state to prevent inappropriate grouping. Library filtering is local to this
 *   native integration.
 * Ownership / failure: Groups.destroy() restores addTab and removes only owned native
 *   observers/listeners/guards. Ordinary tabs and independently installed Apps remain optional
 *   collaborators.
 * Registration: groups/ZentralGroupsNativeAdapter
 * Loaded/created by: features/groups/ZentralTabGroups.uc.js
 * Returned factory API: hookAddTab; initTabDragSelectionGuard; isLibraryCopy; libraryCompatibilityEnabled;
 *   queryLiveTabNodes; removeBuiltinTabGroupMenu; setupObserver; setupPopupSuppression; setupTabOpenHandler
 * Live owner accessors/callbacks: dragGuardCleanup; getSessionStore; groupContextMenuHandler;
 *   groupObservers; groupRightClickBlocker; isRestoring; origAddTab; popupShowingListener; processedGroups;
 *   state; tabDragGuardInitialized; tabOpenListener; tabStripObserver
 * Cross-file calls / ctx suppliers: features/groups/controllers/ZentralGroupsColors.js -> checkAndApplyFirstTimeGroupColor,
 *   removeSavedColor; features/groups/controllers/ZentralGroupsDom.js -> processGroup, scheduleBadgeUpdate,
 *   updateCollapsedLabel; features/groups/controllers/ZentralGroupsMenus.js -> ensureSharedContextMenu;
 *   features/groups/controllers/ZentralGroupsStore.js -> scheduleStateSave
 * Contract fields assigned here: access.dragGuardCleanup; access.groupContextMenuHandler;
 *   access.groupRightClickBlocker; access.origAddTab; access.popupShowingListener;
 *   access.state.contextMenuCurrentGroup; access.state.lastContextMenuX; access.state.lastContextMenuY;
 *   access.tabDragGuardInitialized; access.tabOpenListener; access.tabStripObserver
 * Literal DOM event subscriptions: TabOpen; click; contextmenu; dragend; dragstart; drop; mousedown;
 *   mouseup; popupshowing
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("groups/ZentralGroupsNativeAdapter", function ({ Services, shared, runtime, access }) {
const { Constants, Core, createSVGElement, SVG_STRINGS, WELL_KNOWN_SERVICES } = shared;
return {
// Responsibility: ZentralGroupsNativeAdapter
setupTabOpenHandler() {
          if (access.tabOpenListener) return;
          access.tabOpenListener = (e) => {
            const tab = e.target;
            if (!tab || tab.tagName?.toLowerCase() !== "tab") return;

            // 1. App Panel Isolation: If link was opened while an App panel is open, keep outside any group
            const isAppPanelOpen =
              (typeof window.Zentral?.Apps?.isPanelOpen === "function" &&
                window.Zentral.Apps.isPanelOpen()) ||
              document.documentElement.getAttribute(
                "zentral-app-panel-open",
              ) === "true" ||
              document
                .getElementById("zen-app-panel-root")
                ?.hasAttribute("open") ||
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

                const ss = access.getSessionStore();
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
            if (
              originGroup.tabs &&
              typeof originGroup.tabs.add === "function"
            ) {
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
              originGroup.label ||
              originGroup.getAttribute?.("label") ||
              "Group";
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
              access.tabOpenListener,
            );
          }
        },
hookAddTab() {
          if (!window.gBrowser || window.gBrowser._zentralAddTabHooked) return;
          window.gBrowser._zentralAddTabHooked = true;
          access.origAddTab = window.gBrowser.addTab;
          const self = this;

          window.gBrowser.addTab = function (aURI, aParams = {}) {
            const isAppOpen =
              (typeof window.Zentral?.Apps?.isPanelOpen === "function" &&
                window.Zentral.Apps.isPanelOpen()) ||
              document.documentElement.getAttribute(
                "zentral-app-panel-open",
              ) === "true" ||
              document
                .getElementById("zen-app-panel-root")
                ?.hasAttribute("open") ||
              !!document.activeElement?.closest?.(
                "#zen-app-panel-root, #zen-app-panel-slider, .zen-app-panel-wrapper",
              );

            if (isAppOpen && aParams && typeof aParams === "object") {
              aParams.tabGroup = null;
              aParams.relatedToCurrent = false;
              aParams.insertRelatedAfterCurrent = false;
            }

            const tab = access.origAddTab.call(this, aURI, aParams);

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
        },
setupObserver() {
          const observer = new MutationObserver((mutations) => {
            let needsSave = false;
            let groupsStructureChanged = false;
            for (const mutation of mutations) {
              if (this.isLibraryCopy(mutation.target)) continue;
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
                  if (this.isLibraryCopy(node)) continue;
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

                  const childGroups =
                    node.querySelectorAll?.("tab-group") || [];
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
                    if (parentGroup && !access.isRestoring) {
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
                    const obs = access.groupObservers.get(node);
                    if (obs) {
                      obs.disconnect();
                      access.groupObservers.delete(node);
                    }
                    access.processedGroups.delete(node);
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
                            parsed && parsed.groups
                              ? parsed.groups
                              : parsed || {};
                          const tabMapping =
                            parsed && parsed.tabMapping
                              ? parsed.tabMapping
                              : {};
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
          access.tabStripObserver = observer;

          if (!access.groupRightClickBlocker) {
            access.groupRightClickBlocker = (event) => {
              if (this.isLibraryCopy(event.target)) return;
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
              access.groupRightClickBlocker,
              true,
            );
            window.addEventListener(
              "mouseup",
              access.groupRightClickBlocker,
              true,
            );
            window.addEventListener(
              "click",
              access.groupRightClickBlocker,
              true,
            );
          }

          // Global capture-phase contextmenu listener to guarantee right-click triggers custom menu on any group header
          if (!access.groupContextMenuHandler) {
            access.groupContextMenuHandler = (event) => {
              if (this.isLibraryCopy(event.target)) return;
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
                  access.state.contextMenuCurrentGroup = group;
                  access.state.lastContextMenuX = event.screenX;
                  access.state.lastContextMenuY = event.screenY;
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
              access.groupContextMenuHandler,
              true,
            );
          }
        },
setupPopupSuppression() {
          if (access.popupShowingListener) return;
          access.popupShowingListener = (e) => {
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
          window.addEventListener(
            "popupshowing",
            access.popupShowingListener,
            true,
          );
          this.removeBuiltinTabGroupMenu();
        },
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
            console.error(
              "[ZentralTabGroups] Error removing built-in menu:",
              e,
            );
          }
        },
initTabDragSelectionGuard() {
          const tabContainer =
            gBrowser?.tabContainer ||
            document.getElementById("tabbrowser-tabs");
          if (!tabContainer || access.tabDragGuardInitialized) return;
          access.tabDragGuardInitialized = true;

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
                const moveDist = Math.hypot(
                  e.clientX - startX,
                  e.clientY - startY,
                );
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
            if (
              e.button === 0 &&
              e.target?.closest?.(".zen-split-view-splitter")
            ) {
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
                      console.warn(
                        "[Zentral] startTabDrag snapshot notice:",
                        e,
                      );
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
              return origSplitTabs.call(
                this,
                tabs,
                gridType,
                targetIndex,
                options,
              );
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

          access.dragGuardCleanup = () => {
            tabContainer.removeEventListener("mousedown", onMouseDown, {
              capture: true,
            });
            window.removeEventListener("mouseup", onMouseUp, { capture: true });
            window.removeEventListener("dragend", clearGuard, {
              capture: true,
            });
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
            access.tabDragGuardInitialized = false;
          };
        },

// Responsibility: ZentralGroupsLibraryCompatibility
libraryCompatibilityEnabled() {
          try {
            return !Services.prefs.getBoolPref(
              "zen.workspace.zentral.video_preview.disable_experimental_bridge",
              true,
            );
          } catch (_) {
            return false;
          }
        },
isLibraryCopy(node) {
          return (
            this.libraryCompatibilityEnabled() &&
            !!node?.closest?.("zen-library, zen-library-spaces-section")
          );
        },
queryLiveTabNodes(selector) {
          return Array.from(document.querySelectorAll(selector)).filter(
            (node) => !this.isLibraryCopy(node),
          );
        }
};
});
})();
