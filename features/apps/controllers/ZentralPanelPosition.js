/*
 * ZENTRAL FILE GUIDE - features/apps/controllers/ZentralPanelPosition.js
 *
 * Purpose: Computes sidebar/docking bounds and panel width, positions the panel, tracks visible geometry
 *   and handles width drag/resize.
 * Interaction / execution: Installed by ZentralApps constructor; Launcher and Lifecycle call these methods.
 *   Runtime publishes safe sidebar bounds consumed by positioning. PanelGeometry adds extended
 *   horizontal/vertical behavior.
 * Ownership / failure: Uses live private state/dom. startPositionTracking/stopPositionTracking are paired;
 *   Apps.destroy() stops tracking. Never add permanent global mouse-movement measurement for hidden panels.
 * Registration: apps/ZentralPanelPosition
 * Loaded/created by: features/apps/ZentralApps.uc.js
 * Returned factory API: getAppsBarPanelBounds; getAppsBarPanelMaxWidth; isCollapsedLayoutMode;
 *   isCollapsedSidebar; isPanelAttachedToRight; isPanelDockedToAppsBar; isPhysicallySidebarCollapsed;
 *   isPlacementVerticalBar; isSidebarRight; isVerticalBarOnRight; loadWidth; onDrag; onStopDrag;
 *   positionPanel; prepareResize; saveWidth; scheduleRepositionGrid; startPositionTracking; startResize;
 *   stopPositionTracking; updateWidthVar
 * Live owner accessors/callbacks: createSVG; dom; state
 * Cross-file calls / ctx suppliers: features/apps/controllers/ZentralAppModel.js -> saveApps; features/apps/controllers/ZentralAppsLauncher.js
 *   -> repositionGrid, updateVerticalBarBounds
 * Contract fields assigned here: access.dom.expandBtn.title; access.dom.panel.style.pointerEvents;
 *   access.dom.root.style.width; access.state.isExpanded; access.state.panelWidthPx;
 *   access.state.repositionTimer
 * Literal DOM event subscriptions: mousemove; mouseup; resize
 *
 * Drag lifecycle: startResize adds a window blur handler; onStopDrag restores input and saves only an active drag.
 *   PanelLifecycle.closePanel and Apps.destroy call onStopDrag before closing/removing the browser surface.
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("apps/ZentralPanelPosition", function ({ Services, shared, runtime, access }) {
const { Constants, Core, createSVGElement, SVG_STRINGS, WELL_KNOWN_SERVICES } = shared;
return {
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
            window.ZentralRuntime?.nativeSidebarElement?.() ||
            gBrowser?.tabContainer;
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
        },
isPlacementVerticalBar() {
          return (
            Core.getPref(Constants.Apps.PREF_PLACEMENT, "sidebar") ===
            "vertical-bar"
          );
        },
isVerticalBarOnRight() {
          return !this.isSidebarRight();
        },
isPanelAttachedToRight() {
          if (this.isPlacementVerticalBar()) {
            return this.isVerticalBarOnRight();
          }
          return this.isSidebarRight();
        },
isCollapsedSidebar() {
          // Fully delegate to the single authoritative collapse-detection method.
          // Previously this method duplicated zen-sidebar-collapsed + sidebar-expanded pref reads
          // that isPhysicallySidebarCollapsed() already handles — removed duplication (Q-05).
          return this.isPhysicallySidebarCollapsed();
        },
isCollapsedLayoutMode() {
          if (access.dom.grid?.classList.contains("zen-apps-horizontal"))
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
        },
isPhysicallySidebarCollapsed() {
          if (
            document.documentElement.getAttribute("zen-compact-mode") === "true"
          )
            return true;
          // DOM attribute set by Zen in Collapsed Sidebar mode
          const collapsedAttr = document.documentElement.getAttribute(
            "zen-sidebar-collapsed",
          );
          if (collapsedAttr === "true") return true;

          // Compact mode: sidebar is visually collapsed but pref says expanded.
          // Detect by measuring physical width of the tab/sidebar container.
          const sidebarBox =
            window.ZentralRuntime?.nativeSidebarElement?.() ||
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
        },
startPositionTracking() {
          if (this._isTrackingPosition) return;
          this._isTrackingPosition = true;

          this.positionPanel();

          const reposition = () => {
            if (
              access.state.activeAppId &&
              access.dom.root?.hasAttribute("open")
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
            for (const [target, properties] of this._activePositionTransitions || []) {
              for (const [property, deadline] of properties)
                if (!target.isConnected || Date.now() >= deadline) properties.delete(property);
              if (!properties.size) this._activePositionTransitions.delete(target);
            }
            if (
              this._activePositionTransitions?.size ||
              Date.now() - lastActivityTime < 200
            ) {
              rafId = requestAnimationFrame(rafLoop);
              this._positionTrackingRAF = rafId;
            } else {
              rafId = null;
              this._positionTrackingRAF = null;
            }
          };

          const triggerBurst = () => {
            if (
              !this.isPlacementVerticalBar() &&
              !access.dom.root?.hasAttribute("open")
            )
              return;
            lastActivityTime = Date.now();
            if (!rafId) {
              rafId = requestAnimationFrame(rafLoop);
              this._positionTrackingRAF = rafId;
            }
          };

          // Pointer movement is not a geometry change. Resize/transition events
          // already track the native sidebar without taxing its hover path.

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
                properties = new Map();
                activeTransitions.set(target, properties);
              }
              properties.set(property, Date.now() + 5000);
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
              "zen-sidebar-right",
              "zen-sidebar-collapsed",
              "zen-compact-sidebar-visible",
              "zen-compact-navbar-visible",
            ],
          });

          this._windowResizeListener = reposition;
          window.addEventListener("resize", this._windowResizeListener, {
            passive: true,
          });
        },
stopPositionTracking() {
          this._isTrackingPosition = false;
          if (this._positionTrackingRAF != null) cancelAnimationFrame(this._positionTrackingRAF);
          this._positionTrackingRAF = null;

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
        },
getAppsBarPanelBounds() {
          const gap = 12;
          const onRight = this.isVerticalBarOnRight();
          const bar = access.dom.verticalBar;
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
            window.ZentralRuntime?.nativeSidebarElement?.() ||
            gBrowser?.tabContainer ||
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
        },
isPanelDockedToAppsBar() {
          return (
            this.isPlacementVerticalBar() &&
            document.documentElement.getAttribute(
              "bgalazka-opposite-docking",
            ) !== "true"
          );
        },
getAppsBarPanelMaxWidth() {
          const { left, right } = this.getAppsBarPanelBounds();
          // Keep the outward-growing pill reachable beside the native sidebar.
          return Math.max(1, Math.floor(right - left - 44));
        },
updateWidthVar(px) {
          if (this.isPanelDockedToAppsBar())
            px = Math.max(1, Math.min(px, this.getAppsBarPanelMaxWidth()));
          if (access.state.activeAppId && !access.state.isExpanded) {
            const app = access.state.apps.find(
              (a) => a.id === access.state.activeAppId,
            );
            if (app) app.width = px;
          }
          access.state.panelWidthPx = px;
          if (access.dom.root)
            access.dom.root.style.width = Math.round(px) + "px";
        },
positionPanel() {
          const root = access.dom.root;
          if (!root || !gBrowser?.tabContainer) return;
          const tcRect = gBrowser.tabContainer.getBoundingClientRect();
          const gap = 12;

          let sidebarRect = tcRect;
          const sidebarEl =
            window.ZentralRuntime?.nativeSidebarElement?.() ||
            gBrowser?.tabContainer;
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

          const panelWidth = access.state.panelWidthPx || 420;
          let panelLeft = 0;
          let panelRight = window.innerWidth;

          if (this.isPanelDockedToAppsBar()) {
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
          window.ZentralRuntime?.constrainPanelToSidebar?.(root);
        },
loadWidth() {
          let width = Core.getPref(Constants.Apps.PREF_WIDTH);
          return Math.max(
            Constants.Apps.MIN_WIDTH_PX,
            width || window.innerWidth * 0.333,
          );
        },
saveWidth(px) {
          if (access.state.activeAppId) {
            const app = access.state.apps.find(
              (a) => a.id === access.state.activeAppId,
            );
            if (app) app.width = px;
            this.saveApps();
          }
        },
startResize(e) {
          if (e.button !== 0) return;
          e.preventDefault();
          this._startX = e.clientX;
          const app = access.state.apps.find(
            (a) => a.id === access.state.activeAppId,
          );
          this._startW =
            access.dom.root?.getBoundingClientRect().width ||
            app?.width ||
            this.loadWidth();
          if (access.dom.panel) access.dom.panel.style.pointerEvents = "none";
          this._zentralWidthDragging = true;
          document.addEventListener("mousemove", this.onDrag);
          document.addEventListener("mouseup", this.onStopDrag);
          window.addEventListener("blur", this.onStopDrag);
        },
prepareResize() {
          if (!access.state.isExpanded) return;
          access.state.isExpanded = false;
          if (access.dom.expandBtn) {
            access.dom.expandBtn.title = "Expand panel";
            access.dom.expandBtn.replaceChildren(
              access.createSVG(SVG_STRINGS.EXPAND),
            );
          }
        },
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
        },
onStopDrag() {
          document.removeEventListener("mousemove", this.onDrag);
          document.removeEventListener("mouseup", this.onStopDrag);
          window.removeEventListener("blur", this.onStopDrag);
          if (access.dom.panel) access.dom.panel.style.pointerEvents = "";
          if (this._zentralWidthDragging) this.saveWidth(access.state.panelWidthPx);
          this._zentralWidthDragging = false;
        },
scheduleRepositionGrid(delay = 120) {
          if (access.state.repositionTimer)
            clearTimeout(access.state.repositionTimer);
          access.state.repositionTimer = setTimeout(() => {
            access.state.repositionTimer = null;
            this.repositionGrid();
          }, delay);
        }
};
});
})();
