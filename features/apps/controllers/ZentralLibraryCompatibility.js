/*
 * ZENTRAL FILE GUIDE - features/apps/controllers/ZentralLibraryCompatibility.js
 *
 * Purpose: Coordinates native Zen Library and bookmarks/history/downloads opening with Apps panels and owns
 *   the compatibility guard around Library animation.
 * Interaction / execution: Installed by ZentralApps constructor; launcher utility actions call it. Uses
 *   public Apps close/open state and native Zen Library APIs without pretending those APIs are always
 *   available.
 * Ownership / failure: Apps.destroy() calls destroyLibraryPanelGuard to restore only owned
 *   hooks/observers/styles. Compatibility is a separate responsibility, but currently a required Apps
 *   factory.
 * Registration: apps/ZentralLibraryCompatibility
 * Loaded/created by: features/apps/ZentralApps.uc.js
 * Returned factory API: closeLibraryForPanel; closePanelsForLibrary; destroyLibraryPanelGuard;
 *   libraryPanelGuardEnabled; openBookmarksSidebar; openBrowserLibrary; openZenLibrary;
 *   removeLibraryPanelGuard; setupLibraryPanelGuard; syncLibraryPanelGuard
 * Live owner accessors/callbacks: dom; libraryGuardAPI; libraryGuardAnimation; libraryGuardObserver;
 *   libraryGuardOriginalAnimation; libraryGuardPrefObserver; libraryGuardStyle; libraryYieldingToPanel;
 *   state
 * Cross-file calls / ctx suppliers: features/apps/controllers/ZentralPanelLifecycle.js -> closePanel;
 *   features/apps/controllers/ZentralPanelPosition.js -> stopPositionTracking
 * Contract fields assigned here: access.libraryGuardAPI; access.libraryGuardAPI.animateProgress;
 *   access.libraryGuardAnimation; access.libraryGuardObserver; access.libraryGuardOriginalAnimation;
 *   access.libraryGuardPrefObserver; access.libraryGuardStyle; access.libraryGuardStyle.id;
 *   access.libraryGuardStyle.textContent; access.libraryYieldingToPanel; access.state.closeTimerId
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("apps/ZentralLibraryCompatibility", function ({ Services, shared, runtime, access }) {
const { Constants, Core, createSVGElement, SVG_STRINGS, WELL_KNOWN_SERVICES } = shared;
return {
libraryPanelGuardEnabled() {
          return (
            !this._destroyed &&
            !!Core.getPref(Constants.Apps.PREF_ENABLED, true) &&
            !Services.prefs.getBoolPref(
              "zen.workspace.zentral.video_preview.disable_experimental_bridge",
              true,
            )
          );
        },
closePanelsForLibrary() {
          if (!this.libraryPanelGuardEnabled()) return;
          access.libraryYieldingToPanel = false;
          this.closePanel();
          // Finish the existing close animation before Library takes the space.
          if (access.state.closeTimerId) {
            clearTimeout(access.state.closeTimerId);
            access.state.closeTimerId = null;
          }
          const root =
            access.dom.root || document.getElementById("zen-app-panel-root");
          root?.removeAttribute("open");
          root?.removeAttribute("closing");
          if (root) root.style.pointerEvents = "";
          this.stopPositionTracking();
        },
closeLibraryForPanel() {
          if (!this.libraryPanelGuardEnabled()) return;
          const library = document.querySelector("zen-library[open]");
          if (!library || access.libraryYieldingToPanel) return;
          access.libraryYieldingToPanel = true;
          try {
            access.libraryGuardAPI?.close();
          } catch (error) {
            access.libraryYieldingToPanel = false;
            console.warn("[ZentralApps] Could not close Zen Library:", error);
          }
        },
setupLibraryPanelGuard() {
          if (access.libraryGuardPrefObserver) return;
          access.libraryGuardPrefObserver = () => this.syncLibraryPanelGuard();
          Services.prefs.addObserver(
            "zen.workspace.zentral.video_preview.disable_experimental_bridge",
            access.libraryGuardPrefObserver,
          );
          this.syncLibraryPanelGuard();
        },
syncLibraryPanelGuard() {
          this.removeLibraryPanelGuard();
          if (!this.libraryPanelGuardEnabled()) return;
          try {
            // This module is window-scoped, as in Zen's native command handler.
            const { ZenLibrary } = ChromeUtils.importESModule(
              "moz-src:///zen/library/ZenLibrary.mjs",
              { global: "current" },
            );
            if (
              typeof ZenLibrary?.animateProgress !== "function" ||
              typeof ZenLibrary?.close !== "function"
            )
              return;
            access.libraryGuardAPI = ZenLibrary;
            const original = ZenLibrary.animateProgress;
            const apps = this;
            access.libraryGuardOriginalAnimation = original;
            access.libraryGuardAnimation = function (target, ...args) {
              if (target > 0) apps.closePanelsForLibrary();
              return original.call(this, target, ...args);
            };
            ZenLibrary.animateProgress = access.libraryGuardAnimation;
            access.libraryGuardStyle = document.createElement("style");
            access.libraryGuardStyle.id = "zentral-library-panel-guard";
            // Library keeps [open] throughout its spring closing animation.
            // Never paint or accept input on an overlapping panel during it.
            access.libraryGuardStyle.textContent =
              ":root:has(zen-library[open]) #zen-app-panel-root { visibility: hidden !important; pointer-events: none !important; }";
            document.documentElement.appendChild(access.libraryGuardStyle);
            access.libraryGuardObserver = new MutationObserver((records) => {
              if (!this.libraryPanelGuardEnabled()) return;
              for (const record of records) {
                if (
                  record.type === "attributes" &&
                  record.target.localName === "zen-library"
                ) {
                  if (!record.target.hasAttribute("open")) {
                    access.libraryYieldingToPanel = false;
                  } else if (!access.libraryYieldingToPanel) {
                    this.closePanelsForLibrary();
                  }
                } else if (
                  record.type === "attributes" &&
                  record.target.id === "zen-app-panel-root" &&
                  record.target.hasAttribute("open") &&
                  !record.target.hasAttribute("closing")
                ) {
                  this.closeLibraryForPanel();
                } else if (
                  record.type === "childList" &&
                  Array.from(record.addedNodes).some(
                    (node) =>
                      node.localName === "zen-library" &&
                      node.hasAttribute("open"),
                  )
                ) {
                  this.closePanelsForLibrary();
                }
              }
            });
            access.libraryGuardObserver.observe(document.documentElement, {
              subtree: true,
              childList: true,
              attributes: true,
              attributeFilter: ["open"],
            });
            // If enabled while both are visible, Library owns the space.
            if (document.querySelector("zen-library[open]"))
              this.closePanelsForLibrary();
          } catch (error) {
            this.removeLibraryPanelGuard();
            Core.log("ZentralApps", "Library panel guard unavailable:", error);
          }
        },
removeLibraryPanelGuard() {
          access.libraryGuardObserver?.disconnect();
          access.libraryGuardObserver = null;
          if (
            access.libraryGuardAPI?.animateProgress ===
            access.libraryGuardAnimation
          ) {
            access.libraryGuardAPI.animateProgress =
              access.libraryGuardOriginalAnimation;
          }
          access.libraryGuardAPI = null;
          access.libraryGuardAnimation = access.libraryGuardOriginalAnimation =
            null;
          access.libraryGuardStyle?.remove();
          access.libraryGuardStyle = null;
          access.libraryYieldingToPanel = false;
        },
destroyLibraryPanelGuard() {
          this.removeLibraryPanelGuard();
          if (access.libraryGuardPrefObserver) {
            Services.prefs.removeObserver(
              "zen.workspace.zentral.video_preview.disable_experimental_bridge",
              access.libraryGuardPrefObserver,
            );
            access.libraryGuardPrefObserver = null;
          }
        },
openZenLibrary() {
          try {
            const command = document.getElementById("cmd_zenToggleLibrary");
            if (
              Services.prefs.getBoolPref("zen.library.enabled", false) &&
              typeof command?.doCommand === "function" &&
              command.getAttribute("disabled") !== "true"
            ) {
              command.doCommand();
              return true;
            }
          } catch (error) {
            console.warn("[ZentralApps] Could not open Zen Library:", error);
            return false;
          }
          // Older Zen versions and users who disabled Zen Library keep Places.
          return this.openBrowserLibrary("AllBookmarks");
        },
async openBookmarksSidebar() {
          try {
            if (typeof window.SidebarController?.toggle !== "function")
              return false;
            await window.SidebarController.toggle("viewBookmarksSidebar");
            return true;
          } catch (error) {
            console.warn(
              "[ZentralApps] Could not open bookmarks sidebar:",
              error,
            );
            return false;
          }
        },
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
};
});
})();
