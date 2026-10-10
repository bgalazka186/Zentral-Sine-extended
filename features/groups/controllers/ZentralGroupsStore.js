/*
 * ZENTRAL FILE GUIDE - features/groups/controllers/ZentralGroupsStore.js
 *
 * Purpose: Validates, saves, loads and reconstructs group state using SessionStore and workspace
 *   identities.
 * Interaction / execution: Installed by ZentralTabGroups constructor; Dom and Menus request saves,
 *   NativeAdapter supplies live native groups/tabs. Uses owner getSessionStore callback and live
 *   state/restoring accessors.
 * Ownership / failure: Groups owns deferred saves and restore settlement. Stored identifiers must remain
 *   compatible across restarts; persistence is separate from menus and native interaction hooks.
 * Registration: groups/ZentralGroupsStore
 * Loaded/created by: features/groups/ZentralTabGroups.uc.js
 * Returned factory API: getWorkspaceForElement; loadTabGroupState; reconstructSavedGroups; sanitizeState;
 *   saveTabGroupState; scheduleStateSave
 * Live owner accessors/callbacks: getSessionStore; isRestoring; state
 * Cross-file calls / ctx suppliers: features/groups/controllers/ZentralGroupsColors.js -> getContrastColor;
 *   features/groups/controllers/ZentralGroupsDom.js -> processGroup, scheduleBadgeUpdate;
 *   features/groups/controllers/ZentralGroupsNativeAdapter.js -> isLibraryCopy, queryLiveTabNodes
 * Contract fields assigned here: access.state.saveStateTimer
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "groups/ZentralGroupsStore",
    function ({ Services, shared, runtime, access, lifecycle }) {
      const { setTimeout, clearTimeout, requestAnimationFrame, MutationObserver } = lifecycle;
      const {
        Constants,
        Core,
        createSVGElement,
        SVG_STRINGS,
        WELL_KNOWN_SERVICES,
      } = shared;
      return {
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
        },
        reconstructSavedGroups() {
          try {
            const ss = access.getSessionStore();

            // 0. Scrub any empty ghost groups lingering in the DOM (0 tabs and 0 child groups)
            this.queryLiveTabNodes(
              "tab-group:not([split-view-group]):not([zen-split-view]):not([is-zen-split])",
            ).forEach((g) => {
              const directTabs = g.querySelectorAll(
                "tab, tabbrowser-tab, .tabbrowser-tab",
              );
              const childGroups = g.querySelectorAll("tab-group");
              if (
                directTabs.length === 0 &&
                childGroups.length === 0 &&
                !access.state.creatingGroup
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
                this.queryLiveTabNodes(
                  "tab, tabbrowser-tab, .tabbrowser-tab",
                ).forEach((t) => tabSet.add(t));
              } catch (_) {}
              try {
                if (gBrowser?.tabs) {
                  for (const t of gBrowser.tabs) {
                    if (t) tabSet.add(t);
                  }
                }
              } catch (_) {}
              return Array.from(tabSet).filter(
                (tab) => !this.isLibraryCopy(tab),
              );
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
              if (
                !groupId &&
                ss &&
                typeof ss.getCustomTabValue === "function"
              ) {
                groupId = ss.getCustomTabValue(tab, "zentral-group-id");
              }

              // Fallback: match by unique zenTabId only (never loose URL matching)
              if (!groupId && savedTabMapping) {
                const zenTabId = tab.getAttribute("zen-tab-id") || tab.id;
                if (zenTabId) {
                  for (const [gId, tabList] of Object.entries(
                    savedTabMapping,
                  )) {
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
                    tab.getAttribute("data-zentral-group-collapsed") ===
                      "true" ||
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

              let groupTabContainer = group.querySelector(
                ".tab-group-container",
              );
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
                      wsEl?.querySelector(
                        ".zen-workspace-normal-tabs-section",
                      ) || wsEl;
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
                          (el.getAttribute("zen-tab-id") ===
                            info.nextTabZenId ||
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
                  const rawColors = Core.getPref(
                    Constants.TabGroups.PREF_COLORS,
                  );
                  if (rawColors && rawColors !== "{}")
                    savedColorsMap = JSON.parse(rawColors) || {};
                } catch (_) {}
                const savedColor =
                  info.color ||
                  savedColorsMap[gId] ||
                  savedGroupsMap[gId]?.color;
                if (savedColor) {
                  group.style.setProperty("--tab-group-color", savedColor);
                  group.style.setProperty(
                    "--tab-group-color-invert",
                    savedColor,
                  );
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
            console.error(
              "[ZentralTabGroups] Error in reconstructSavedGroups:",
              e,
            );
          }
        },
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
        },
        scheduleStateSave() {
          if (access.isRestoring) return;
          if (access.state.saveStateTimer)
            clearTimeout(access.state.saveStateTimer);
          access.state.saveStateTimer = setTimeout(
            () => this.saveTabGroupState(),
            1000,
          );
        },
        saveTabGroupState() {
          try {
            const ss = access.getSessionStore();
            const currentWs = window.gZenWorkspaces?.activeWorkspace;

            // Clean any tabs that are no longer part of any tab group (guarding other workspaces)
            const allBrowserTabs = Array.from(
              gBrowser?.tabs ||
                this.queryLiveTabNodes("tab, tabbrowser-tab, .tabbrowser-tab"),
            );
            allBrowserTabs.forEach((tab) => {
              if (this.isLibraryCopy(tab)) return;
              // Guard: Never strip attributes or SessionStore from tabs belonging to other workspaces
              const tabWs = this.getWorkspaceForElement(tab);
              if (currentWs && tabWs && tabWs !== currentWs) return;
              if (tab.hidden && currentWs && tabWs && tabWs !== currentWs)
                return;

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
              this.queryLiveTabNodes(
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
                  nextTabZenId =
                    nextSib.getAttribute("zen-tab-id") || nextSib.id;
                else if (nextSib.tagName?.toLowerCase() === "tab-group")
                  nextGroupId = nextSib.id;
              }

              const prevSib = group.previousElementSibling;
              if (prevSib) {
                const isTab =
                  prevSib.tagName?.toLowerCase() === "tab" ||
                  prevSib.classList?.contains("tabbrowser-tab");
                if (isTab)
                  prevTabZenId =
                    prevSib.getAttribute("zen-tab-id") || prevSib.id;
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
                !access.state.creatingGroup
              ) {
                delete mergedGroups[group.id];
                delete mergedTabMapping[group.id];
                try {
                  group.remove();
                } catch (_) {}
                return;
              }

              const label =
                group.label || group.getAttribute("label") || "Group";
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

                    if (wsId)
                      ss.setCustomTabValue(tab, "zentral-group-ws", wsId);
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

            Core.setPref(
              Constants.TabGroups.PREF_STATE,
              JSON.stringify(sanitized),
            );
          } catch (e) {
            console.warn("[ZentralTabGroups] Error saving state", e);
          }
        },
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
              this.queryLiveTabNodes("tab-group:not([split-view-group])"),
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
                  const prevEl = Array.from(
                    targetParentContainer.children,
                  ).find((el) => {
                    const isTab =
                      el.tagName?.toLowerCase() === "tab" ||
                      el.classList?.contains("tabbrowser-tab");
                    return (
                      isTab &&
                      (el.getAttribute("zen-tab-id") ===
                        groupState.prevTabZenId ||
                        el.id === groupState.prevTabZenId)
                    );
                  });
                  if (prevEl) refSibling = prevEl.nextElementSibling;
                }
                if (!refSibling && groupState.prevGroupId) {
                  const prevEl = Array.from(
                    targetParentContainer.children,
                  ).find(
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
        },
      };
    },
  );
})();
