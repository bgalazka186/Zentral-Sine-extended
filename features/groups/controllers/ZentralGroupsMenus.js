/*
 * ZENTRAL FILE GUIDE - features/groups/controllers/ZentralGroupsMenus.js
 *
 * Purpose: Creates group/folder/tab context actions and conversion between native folders and groups.
 * Interaction / execution: Installed by ZentralTabGroups; uses Dom for group processing, Store for
 *   persistence and Colors for color-picker actions. NativeAdapter controls conflicting built-in popup
 *   behavior.
 * Ownership / failure: Groups owns folder-menu timer/handler cleanup. Menu actions mutate native
 *   tabs/groups through the shared owner; keep ordinary native tab commands delegated.
 * Registration: groups/ZentralGroupsMenus
 * Loaded/created by: features/groups/ZentralTabGroups.uc.js
 * Returned factory API: addContextMenu; addFolderContextMenuItems; convertFolderToGroup;
 *   convertGroupToFolder; enhanceTabContextMenu; ensureSharedContextMenu; onTabGroupCreate
 * Live owner accessors/callbacks: folderMenuHandler; folderMenuTimer; getSessionStore; state
 * Cross-file calls / ctx suppliers: features/groups/controllers/ZentralGroupsColors.js -> applyAverageGroupColor,
 *   checkAndApplyFirstTimeGroupColor, ensureColorPickerPanel, removeSavedColor;
 *   features/groups/controllers/ZentralGroupsDom.js -> processGroup, renameGroupStart;
 *   features/groups/controllers/ZentralGroupsNativeAdapter.js -> isLibraryCopy, queryLiveTabNodes, removeBuiltinTabGroupMenu;
 *   features/groups/controllers/ZentralGroupsStore.js -> saveTabGroupState, scheduleStateSave
 * Contract fields assigned here: access.folderMenuHandler; access.folderMenuTimer;
 *   access.state.contextMenuCurrentGroup; access.state.lastContextMenuX; access.state.lastContextMenuY;
 *   access.state.sharedContextMenu
 * Literal DOM event subscriptions: command; contextmenu; popupshowing; popupshown
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "groups/ZentralGroupsMenus",
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
              lifecycle.listen(contextMenu, "popupshowing", (e) => {
                const trigger = contextMenu.triggerNode;
                const grp =
                  trigger?.closest?.("tab-group:not([split-view-group])") ||
                  access.state.contextMenuCurrentGroup;
                if (grp) access.state.contextMenuCurrentGroup = grp;
              });

              const openColorPicker = () => {
                const grp = access.state.contextMenuCurrentGroup;
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
                  const hexInput = picker.querySelector(
                    "#zentral-tg-input-hex",
                  );
                  if (hexInput) hexInput.value = hex;
                  const bigint = parseInt(hex.slice(1), 16);
                  const rgbInput = picker.querySelector(
                    "#zentral-tg-input-rgb",
                  );
                  if (rgbInput && !isNaN(bigint))
                    rgbInput.value = `${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}`;
                  const nativeColorInput = picker.querySelector(
                    "#zentral-tg-native-color",
                  );
                  if (nativeColorInput) nativeColorInput.value = hex;

                  if (typeof picker.openPopupAtScreen === "function") {
                    picker.openPopupAtScreen(
                      access.state.lastContextMenuX || 0,
                      access.state.lastContextMenuY || 0,
                      false,
                    );
                  } else if (typeof picker.openPopup === "function") {
                    picker.openPopup(grp, "after_start", 0, 0, false, false);
                  }
                }
              };

              lifecycle.listen(contextMenu.querySelector("#zentral-tg-item-set-color"), "command", (e) => {
                  e.stopPropagation();
                  openColorPicker();
                });

              lifecycle.listen(contextMenu.querySelector("#zentral-tg-item-auto-color"), "command", (e) => {
                  e.stopPropagation();
                  if (access.state.contextMenuCurrentGroup?._useFaviconColor) {
                    access.state.contextMenuCurrentGroup._useFaviconColor();
                  }
                });

              lifecycle.listen(contextMenu.querySelector("#zentral-tg-item-rename"), "command", (e) => {
                  e.stopPropagation();
                  if (access.state.contextMenuCurrentGroup) {
                    this.renameGroupStart(
                      access.state.contextMenuCurrentGroup,
                      true,
                    );
                  }
                });

              lifecycle.listen(contextMenu.querySelector("#zentral-tg-item-ungroup"), "command", (e) => {
                  e.stopPropagation();
                  const grp = access.state.contextMenuCurrentGroup;
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

              lifecycle.listen(contextMenu.querySelector("#zentral-tg-item-close"), "command", (e) => {
                  e.stopPropagation();
                  const grp = access.state.contextMenuCurrentGroup;
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
                          Cc[
                            "@mozilla.org/embedcomp/prompt-service;1"
                          ]?.getService(Ci.nsIPromptService));
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

          access.state.sharedContextMenu = contextMenu;
          return contextMenu;
        },
        addFolderContextMenuItems() {
          access.folderMenuTimer = setTimeout(() => {
            access.folderMenuTimer = null;
            const folderMenu = document.getElementById("zenFolderActions");
            if (
              !folderMenu ||
              folderMenu.querySelector(
                "#zentral-tabgroup-convert-folder-to-group",
              )
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

              access.folderMenuHandler = (event) => {
                if (
                  event.target.id !== "zentral-tabgroup-convert-folder-to-group"
                )
                  return;
                const folder = folderMenu.triggerNode?.closest("zen-folder");
                if (folder) this.convertFolderToGroup(folder);
              };
              lifecycle.listen(folderMenu, "command", access.folderMenuHandler);
            }
          }, 1500);
        },
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
            lifecycle.captureMenu(popup);

            // 1. Query active tab groups in DOM order (top to bottom on tabstrip)
            const activeGroups = Array.from(
              this.queryLiveTabNodes("tab-group:not([split-view-group])"),
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
              const cleanLabel = (
                item.getAttribute("label") ||
                item.label ||
                ""
              )
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
                  item.style.setProperty(
                    "--tab-group-color",
                    color,
                    "important",
                  );
                  item.style.setProperty(
                    "--tab-group-color-undefined",
                    color,
                    "important",
                  );
                  item.style.setProperty(
                    "--menu-icon-color",
                    color,
                    "important",
                  );
                  const img = item.querySelector(
                    "img, image, .menu-iconic-icon, html\\:img",
                  );
                  if (img) {
                    img.style.setProperty(
                      "background-color",
                      color,
                      "important",
                    );
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
            lifecycle.listen(window,
              "popupshowing",
              this._tabContextSubmenuListener,
              true,
            );
            lifecycle.listen(window,
              "popupshown",
              this._tabContextSubmenuListener,
              true,
            );
          }
        },
        onTabGroupCreate(event) {
          if (this.isLibraryCopy(event.target)) return;
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
              if (!access.state.groupEdited)
                this.renameGroupStart(group, false);
            }
            this.checkAndApplyFirstTimeGroupColor(group);
          } catch (e) {
            console.error(
              "[ZentralTabGroups] Error handling TabGroupCreate:",
              e,
            );
          }
        },
        addContextMenu(group) {
          const sharedMenu = this.ensureSharedContextMenu();
          const labelContainer = group.querySelector(
            ".tab-group-label-container",
          );
          if (labelContainer) {
            labelContainer.setAttribute(
              "context",
              "zentral-tabgroup-context-menu",
            );
            if (!labelContainer._zentralContextMenuBound) {
              labelContainer._zentralContextMenuBound = true;
              lifecycle.listen(labelContainer, "contextmenu", (event) => {
                if (event.target.closest("#tab-label-input")) return;
                event.preventDefault();
                event.stopPropagation();
                access.state.contextMenuCurrentGroup = group;
                access.state.lastContextMenuX = event.screenX;
                access.state.lastContextMenuY = event.screenY;
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
          lifecycle.override(group, "_useFaviconColor", () => {
            this.applyAverageGroupColor(group, true);
          });

          lifecycle.override(group, "ungroupTabs", () => {
            try {
              const ss = access.getSessionStore();
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
          });
        },
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
        },
        convertFolderToGroup(folder) {
          if (this.isLibraryCopy(folder)) return;
          const tabsToGroup = folder.allItemsRecursive.filter(
            (item) =>
              gBrowser.isTab(item) && !item.hasAttribute("zen-empty-tab"),
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
        },
      };
    },
  );
})();
