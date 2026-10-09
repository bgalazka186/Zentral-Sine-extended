/*
 * ZENTRAL FILE GUIDE - features/apps/controllers/ZentralAppsLauncher.js
 *
 * Purpose: Creates launcher/panel containers, renders the Apps grid and utility bar, handles their
 *   autohide/repositioning and copies native toolbar theme into the vertical Apps bar.
 * Interaction / execution: Installed by ZentralApps constructor before user interaction. Interactions
 *   handles commands; Position supplies bounds; Lifecycle controls the displayed browser. Theme helpers
 *   remain alongside the DOM they style.
 * Ownership / failure: Uses live state/dom and resize observer accessors. Apps.destroy() owns timers,
 *   resize observers and UI removal. Launcher autohide is separate from extended panel hover reveal.
 * Registration: apps/ZentralAppsLauncher
 * Loaded/created by: features/apps/ZentralApps.uc.js
 * Returned factory API: _debouncedSyncTheme; applyHideUtilitySectionPref; cancelAutohideReveal;
 *   createContainers; isAppPanelKeepingAppsRevealed; renderGrid; renderUtilitySection; repositionGrid;
 *   scheduleAutohideCollapse; scheduleAutohideReveal; scheduleUtilityCollapse; setAutohideHovered;
 *   setUtilityHovered; syncPanelAutohideVisibility; syncVerticalBarTheme; updateAutohideState;
 *   updateScrollMask; updateVerticalBarAddBtnPlacement; updateVerticalBarBounds
 * Live owner accessors/callbacks: createSVG; dom; gridResizeObs; pillHoverZoneResizeObs; state
 * Cross-file calls / ctx suppliers: features/apps/controllers/ZentralAppModel.js -> addApp, formatAppDisplayName, saveApps,
 *   saveUtilityOrder; features/apps/controllers/ZentralAppNotifications.js -> ensureBadgeSyncLoop, syncAllAppBadges;
 *   features/apps/controllers/ZentralLibraryCompatibility.js -> openBookmarksSidebar, openBrowserLibrary, openZenLibrary;
 *   features/apps/controllers/ZentralPanelLifecycle.js -> closeApp, closePanel, openPanel, refreshApp, toggleExpand,
 *   togglePin; features/apps/controllers/ZentralPanelPosition.js -> isCollapsedSidebar, isPhysicallySidebarCollapsed,
 *   isPlacementVerticalBar, isSidebarRight, isVerticalBarOnRight
 * Contract fields assigned here: access.dom.autohideDots; access.dom.clip; access.dom.expandBtn;
 *   access.dom.grid; access.dom.grid.id; access.dom.grid.style.direction; access.dom.panel;
 *   access.dom.pill; access.dom.pinBtn; access.dom.refreshBtn; access.dom.root; access.dom.scrollBox;
 *   access.dom.scrollBox.scrollLeft; access.dom.utilityAutohideBtn; access.dom.utilityAutohideBtn.title;
 *   access.dom.utilityContent; access.dom.utilityDivider; access.dom.utilityDots;
 *   access.dom.utilityDotsVertical; access.dom.utilityRow; access.dom.utilitySection;
 *   access.dom.utilitySettingsBtn; access.dom.vbAutohideBtn; access.dom.vbAutohideBtn.title;
 *   access.dom.vbFooter; access.dom.vbSettingsBtn; access.dom.verticalBar;
 *   access.dom.verticalBar.style.display; access.dom.verticalBarTrigger;
 *   access.dom.verticalBarTrigger.style.bottom; access.dom.verticalBarTrigger.style.display;
 *   access.dom.verticalBarTrigger.style.top; access.gridResizeObs; access.pillHoverZoneResizeObs;
 *   access.state.autohideCollapseTimer; access.state.autohideRevealTimer;
 *   access.state.utilityCollapseTimer; access.state.utilitySlots; access.state.utilitySlots.0;
 *   access.state.utilitySlots.emptyIdx; access.state.utilitySlots.fromIdx; access.state.utilitySlots.toIdx
 * Literal DOM event subscriptions: TabAttrModified; TabSelect; auxclick; blur; click; contextmenu; dragend;
 *   dragleave; dragover; dragstart; drop; mousedown; mouseenter; mouseleave; mousemove; resize; scroll;
 *   wheel
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "apps/ZentralAppsLauncher",
    function ({ Services, shared, runtime, access }) {
      const {
        Constants,
        Core,
        createSVGElement,
        SVG_STRINGS,
        WELL_KNOWN_SERVICES,
      } = shared;
      return {
        // Responsibility: ZentralAppsLauncher
        createContainers() {
          if (!access.dom.grid) {
            access.dom.grid = document.createElement("div");
            access.dom.grid.id = "zen-apps-sidebar-grid";

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

            access.dom.grid.appendChild(utilitySection);

            access.dom.utilitySection = utilitySection;
            access.dom.utilityDots = uDots;
            access.dom.utilityDotsVertical = uDotsVert;
            access.dom.utilityContent = uContent;
            access.dom.utilityRow = uRow;
            access.dom.utilityDivider = uDivider;

            const dots = document.createElement("div");
            dots.className = "zen-apps-autohide-dots";
            dots.innerHTML = `
          <span class="zen-apps-autohide-dot"></span>
          <span class="zen-apps-autohide-dot"></span>
          <span class="zen-apps-autohide-dot"></span>
        `;
            access.dom.grid.appendChild(dots);
            access.dom.autohideDots = dots;

            const scrollBox = document.createElement("div");
            scrollBox.className = "zen-apps-scroll-box";

            access.dom.grid.appendChild(scrollBox);
            access.dom.scrollBox = scrollBox;

            utilitySection.addEventListener("mouseenter", () => {
              if (!this.isPlacementVerticalBar()) {
                this.setUtilityHovered(true);
              }
            });
            utilitySection.addEventListener("mouseleave", (e) => {
              if (!this.isPlacementVerticalBar()) {
                if (
                  access.dom.grid &&
                  !access.dom.grid.contains(e.relatedTarget)
                ) {
                  this.scheduleUtilityCollapse(260);
                }
              }
            });

            let cachedGridRect = null;
            const refreshGridRect = () => {
              if (access.dom.grid) {
                const r = access.dom.grid.getBoundingClientRect();
                if (r.width > 0 || r.height > 0) {
                  cachedGridRect = r;
                }
              }
            };

            this._refreshGridRectListener = refreshGridRect;
            window.addEventListener("resize", this._refreshGridRectListener, {
              passive: true,
            });
            if (typeof ResizeObserver !== "undefined" && access.dom.grid) {
              try {
                access.gridResizeObs = new ResizeObserver(refreshGridRect);
                access.gridResizeObs.observe(access.dom.grid);
              } catch (_) {}
            }

            access.dom.grid.addEventListener("mouseenter", () => {
              if (!this.isPlacementVerticalBar()) {
                this.setAutohideHovered(true);
                refreshGridRect();
                if (access.state.utilityCollapseTimer) {
                  clearTimeout(access.state.utilityCollapseTimer);
                  access.state.utilityCollapseTimer = null;
                }
                if (access.state.autohideCollapseTimer) {
                  clearTimeout(access.state.autohideCollapseTimer);
                  access.state.autohideCollapseTimer = null;
                }
              }
            });
            access.dom.grid.addEventListener("mouseleave", () => {
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
                  access.dom.verticalBar?.hasAttribute("data-revealed");

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
                    if (access.state.autohideCollapseTimer) {
                      clearTimeout(access.state.autohideCollapseTimer);
                      access.state.autohideCollapseTimer = null;
                    }
                  } else {
                    this.scheduleAutohideCollapse(250);
                  }
                }
                return;
              }

              // Sidebar Grid Autohide:
              const grid = access.dom.grid;
              if (!grid) return;
              if (grid.classList.contains("zen-apps-horizontal")) return;
              if (access.state.activeAppId) return; // Keep revealed while an app panel is open

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
                if (access.state.utilityCollapseTimer) {
                  clearTimeout(access.state.utilityCollapseTimer);
                  access.state.utilityCollapseTimer = null;
                }
                if (access.state.autohideCollapseTimer) {
                  clearTimeout(access.state.autohideCollapseTimer);
                  access.state.autohideCollapseTimer = null;
                }
              } else if (isNearTopEdge) {
                // Hovering near top edge: refresh collapse timer
                this.scheduleAutohideCollapse(260);
                this.scheduleUtilityCollapse(260);
              } else {
                // Cursor is outside grid and outside top buffer (e.g. webpage, top bar, lower sidebar)
                const isRevealed =
                  grid.hasAttribute("data-revealed") ||
                  access.dom.utilitySection?.hasAttribute(
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
              if (this.isPlacementVerticalBar() || access.state.activeAppId)
                return;
              this.setAutohideHovered(false);
              this.setUtilityHovered(false);
            };
            window.addEventListener("blur", this._autohideBlurListener);

            scrollBox.addEventListener(
              "wheel",
              (e) => {
                if (!access.dom.grid.classList.contains("zen-apps-horizontal"))
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

            access.dom.grid.addEventListener("contextmenu", (e) => {
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

          if (!access.dom.verticalBar) {
            let vb = document.getElementById("zentral-apps-vertical-bar");
            if (!vb) {
              vb = document.createElement("div");
              vb.id = "zentral-apps-vertical-bar";
            }

            vb.addEventListener("mouseenter", () => {
              if (this.isPlacementVerticalBar()) {
                if (access.state.autohideCollapseTimer) {
                  clearTimeout(access.state.autohideCollapseTimer);
                  access.state.autohideCollapseTimer = null;
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
                  const scroller = access.dom.scrollBox || access.dom.grid;
                  if (scroller && e.deltaY) {
                    e.preventDefault();
                    e.stopPropagation();
                    scroller.scrollTop += e.deltaY;
                  }
                }
              },
              { passive: false },
            );
            access.dom.verticalBar = vb;

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

            // Zen 1.23 provides its own Library; retain direct Places shortcuts.
            // Keep one compact shortcut by default; direct shortcuts are opt-in.
            for (const [key, label, section, icon] of [
              [
                `library`,
                `Zen Library`,
                `ZenLibrary`,
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
                `Bookmarks sidebar`,
                `BookmarksSidebar`,
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
              button.appendChild(access.createSVG(icon));
              button.addEventListener("mousedown", (event) => {
                if (event.button === 0) event.stopPropagation();
              });
              button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (section === "ZenLibrary") this.openZenLibrary();
                else if (section === "BookmarksSidebar")
                  this.openBookmarksSidebar();
                else this.openBrowserLibrary(section);
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
              autohideBtn.appendChild(access.createSVG(SVG_STRINGS.EYE_OPEN));
              autohideBtn.appendChild(access.createSVG(SVG_STRINGS.EYE_CLOSED));
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
              settingsBtn.appendChild(access.createSVG(SVG_STRINGS.SETTINGS));
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

            access.dom.vbFooter = footer;
            access.dom.vbAutohideBtn = autohideBtn;
            access.dom.vbSettingsBtn = settingsBtn;

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
            access.dom.verticalBarTrigger = trigger;
          }

          if (!access.dom.root) {
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
            pinBtn.appendChild(access.createSVG(SVG_STRINGS.PIN));
            pinBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              this.togglePin();
            });

            const expandBtn = document.createElement("button");
            expandBtn.className = "zen-app-btn";
            expandBtn.title = "Expand panel";
            expandBtn.appendChild(access.createSVG(SVG_STRINGS.EXPAND));
            expandBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              this.toggleExpand();
            });

            const grabberBtn = document.createElement("div");
            grabberBtn.className = "zen-app-grabber";
            grabberBtn.title = "Drag to resize";
            grabberBtn.appendChild(access.createSVG(SVG_STRINGS.GRABBER));
            // The extension owns this grabber drag, using its direct edge resize path.

            const refreshBtn = document.createElement("button");
            refreshBtn.className = "zen-app-btn zen-app-refresh-btn";
            refreshBtn.title = "Refresh app";
            refreshBtn.appendChild(access.createSVG(SVG_STRINGS.REFRESH));
            refreshBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (access.state.activeAppId) {
                refreshBtn.classList.add("zen-app-refresh-spinning");
                setTimeout(
                  () => refreshBtn.classList.remove("zen-app-refresh-spinning"),
                  450,
                );
                this.refreshApp(access.state.activeAppId);
              }
            });

            const closeBtn = document.createElement("button");
            closeBtn.className = "zen-app-btn zen-app-close-btn";
            closeBtn.title = "Close panel";
            closeBtn.appendChild(access.createSVG(SVG_STRINGS.CLOSE_X));
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
            access.pillHoverZoneResizeObs = new ResizeObserver(syncHoverHeight);
            access.pillHoverZoneResizeObs.observe(pill);

            access.dom.root = root;
            access.dom.clip = clip;
            access.dom.panel = panel;
            access.dom.pill = pill;
            access.dom.pinBtn = pinBtn;
            access.dom.expandBtn = expandBtn;
            access.dom.refreshBtn = refreshBtn;
          }
        },
        renderGrid() {
          if (!access.dom.grid) return;
          const oldAddBtn =
            document.querySelector(
              "#zentral-apps-vertical-bar .zen-app-add-btn",
            ) || access.dom.grid.querySelector(".zen-app-add-btn");
          if (oldAddBtn) oldAddBtn.remove();
          const targetContainer = access.dom.scrollBox || access.dom.grid;
          targetContainer.replaceChildren(); // Faster than innerHTML = '' — avoids serialization

          const isVerticalBar = this.isPlacementVerticalBar();
          if (isVerticalBar) {
            access.dom.grid.style.direction = "ltr";
          } else {
            const sidebarRight = this.isSidebarRight();
            const isCollapsed = this.isCollapsedSidebar();
            const shouldFlip = !sidebarRight && !isCollapsed;
            access.dom.grid.style.direction = shouldFlip ? "rtl" : "ltr";
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
          access.dom.grid.style.setProperty("--zentral-grid-cols", cols);
          access.dom.grid.style.setProperty("--zentral-max-rows", maxRows);

          const maxApps = Math.max(
            0,
            Math.min(
              200,
              parseInt(Core.getPref(Constants.Apps.PREF_MAX_APPS, 21), 10) || 0,
            ),
          );
          const activeWorkspaceId = window.gZenWorkspaces?.activeWorkspace;
          const visibleApps = access.state.apps.filter((app) => {
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
            access.state.apps.length < maxApps;
          const appCount = activeApps.length + (canAdd ? 1 : 0);
          const actualRows = Math.min(Math.ceil(appCount / cols), maxRows);
          const expandedGridHeight =
            (hideUtility ? 0 : 44) + actualRows * 42 + 4;
          access.dom.grid.style.setProperty(
            "--zentral-apps-grid-expanded-height",
            `${expandedGridHeight}px`,
          );
          let draggedAppId = null;
          const fragment = document.createDocumentFragment();

          this.updateAutohideState();
          this.renderUtilitySection();

          activeApps.forEach((app) => {
            const isLoaded = access.state.appBrowsers.has(app.id);
            const btn = document.createElement("button");
            btn.id = "zen-app-btn-" + app.id;
            btn.className = "zen-app-tile";
            btn.dataset.appId = app.id;
            btn.dataset.active =
              access.state.activeAppId === app.id ? "true" : "false";
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
              if (access.state.activeAppId === app.id) {
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
                if (access.state.appBrowsers.has(app.id)) {
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
                const fromIdx = access.state.apps.findIndex(
                  (a) => a.id === draggedAppId,
                );
                const toIdx = access.state.apps.findIndex(
                  (a) => a.id === app.id,
                );
                if (fromIdx > -1 && toIdx > -1) {
                  const [movedApp] = access.state.apps.splice(fromIdx, 1);
                  const destination = access.state.apps.findIndex(
                    (a) => a.id === app.id,
                  );
                  access.state.apps.splice(destination, 0, movedApp);
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
            addBtn.appendChild(access.createSVG(SVG_STRINGS.ADD));
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
            access.dom.utilitySection &&
            access.dom.utilitySection.parentNode === access.dom.grid
          ) {
            if (access.dom.grid.classList.contains("zen-apps-horizontal")) {
              access.dom.grid.appendChild(access.dom.utilitySection);
            } else {
              if (access.dom.grid.firstChild !== access.dom.utilitySection) {
                access.dom.grid.insertBefore(
                  access.dom.utilitySection,
                  access.dom.grid.firstChild,
                );
              }
            }
          }

          if (access.dom.scrollBox) {
            if (
              access.dom.grid.classList.contains("zen-apps-horizontal") &&
              activeApps.length >= 8
            ) {
              access.dom.scrollBox.style.setProperty(
                "min-width",
                "calc(8 * 38px + 7 * 4px)",
                "important",
              );
            } else {
              access.dom.scrollBox.style.removeProperty("min-width");
            }
          }

          if (this._renderGridRAF) cancelAnimationFrame(this._renderGridRAF);
          this._renderGridRAF = requestAnimationFrame(() => {
            this._renderGridRAF = null;
            if (this._destroyed || !access.dom.grid?.isConnected) return;
            this.updateScrollMask();
            if (isVerticalBar) {
              this.updateVerticalBarAddBtnPlacement();
            }
            if (
              access.dom.scrollBox &&
              access.dom.scrollBox.scrollWidth >
                access.dom.scrollBox.clientWidth
            ) {
              access.dom.scrollBox.scrollLeft =
                access.dom.scrollBox.scrollWidth -
                access.dom.scrollBox.clientWidth;
              this.updateScrollMask();
            }
          });
        },
        renderUtilitySection() {
          if (!access.dom.utilitySection || !access.dom.utilityRow) return;
          const row = access.dom.utilityRow;
          row.replaceChildren();

          const hideUtility =
            Core.getPref(Constants.Apps.PREF_HIDE_UTILITY_SECTION, false) ===
            true;
          if (hideUtility) {
            access.dom.utilitySection.style.setProperty(
              "display",
              "none",
              "important",
            );
            access.dom.utilitySection.setAttribute(
              "data-permanently-hidden",
              "true",
            );
            return;
          }
          access.dom.utilitySection.style.removeProperty("display");
          access.dom.utilitySection.removeAttribute("data-permanently-hidden");

          const isAutohide =
            Core.getPref(Constants.Apps.PREF_AUTOHIDE, false) === true;
          const isHorizontal = access.dom.grid?.classList.contains(
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
            btn.appendChild(access.createSVG(SVG_STRINGS.SETTINGS));
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (window.Zentral?.Settings) window.Zentral.Settings.open();
              else if (window.ZentralSettingsInstance)
                window.ZentralSettingsInstance.open();
            });
            btn.addEventListener("mousedown", (e) => {
              if (e.button === 0) e.stopPropagation();
            });
            access.dom.utilitySettingsBtn = btn;
            row.appendChild(btn);
            return;
          }

          if (
            !Array.isArray(access.state.utilitySlots) ||
            access.state.utilitySlots.length !== slotCount
          ) {
            const slots = new Array(slotCount).fill(null);
            if (Array.isArray(access.state.utilitySlots)) {
              access.state.utilitySlots.forEach((k, idx) => {
                if (idx < slotCount && k) slots[idx] = k;
              });
            }
            access.state.utilitySlots = slots;
          }

          const required = ["settings", "autohide"];
          required.forEach((reqKey) => {
            if (!access.state.utilitySlots.includes(reqKey)) {
              const emptyIdx = access.state.utilitySlots.indexOf(null);
              if (emptyIdx > -1) {
                access.state.utilitySlots[emptyIdx] = reqKey;
              } else {
                access.state.utilitySlots[0] = reqKey;
              }
            }
          });

          let draggedKey = null;

          for (let slotIdx = 0; slotIdx < slotCount; slotIdx++) {
            const slotEl = document.createElement("div");
            slotEl.className = "zentral-utility-slot";
            slotEl.dataset.slotIndex = slotIdx;

            const btnKey = access.state.utilitySlots[slotIdx];
            if (btnKey) {
              let btn = null;
              if (btnKey === "settings") {
                btn = document.createElement("button");
                btn.id = "zentral-utility-settings-btn";
                btn.className = "zen-app-tile zentral-utility-btn";
                btn.dataset.utilityKey = "settings";
                btn.title = "Zentral Settings";
                btn.draggable = true;
                btn.appendChild(access.createSVG(SVG_STRINGS.SETTINGS));
                btn.addEventListener("click", (e) => {
                  e.stopPropagation();
                  if (window.Zentral?.Settings) window.Zentral.Settings.open();
                  else if (window.ZentralSettingsInstance)
                    window.ZentralSettingsInstance.open();
                });
                btn.addEventListener("mousedown", (e) => {
                  if (e.button === 0) e.stopPropagation();
                });
                access.dom.utilitySettingsBtn = btn;
              } else if (btnKey === "autohide") {
                btn = document.createElement("button");
                btn.id = "zentral-utility-autohide-btn";
                btn.className = "zen-app-tile zentral-utility-btn";
                btn.dataset.utilityKey = "autohide";
                btn.title = isAutohide ? "Disable Autohide" : "Enable Autohide";
                btn.draggable = true;
                btn.appendChild(access.createSVG(SVG_STRINGS.EYE_OPEN));
                btn.appendChild(access.createSVG(SVG_STRINGS.EYE_CLOSED));
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
                access.dom.utilityAutohideBtn = btn;
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
                const fromIdx = access.state.utilitySlots.indexOf(sourceKey);
                const toIdx = slotIdx;
                if (fromIdx > -1 && fromIdx !== toIdx) {
                  const targetKey = access.state.utilitySlots[toIdx];
                  access.state.utilitySlots[toIdx] = sourceKey;
                  access.state.utilitySlots[fromIdx] = targetKey || null;
                  this.saveUtilityOrder();
                  this.renderUtilitySection();
                }
              }
            });

            row.appendChild(slotEl);
          }
        },
        updateScrollMask() {
          const scrollBox = access.dom.scrollBox;
          if (!scrollBox) return;

          if (!access.dom.grid?.classList.contains("zen-apps-horizontal")) {
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
        },
        repositionGrid() {
          const grid = access.dom.grid;
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

              const vb = access.dom.verticalBar;
              if (vb) {
                if (grid.parentNode !== vb) {
                  if (
                    access.dom.vbFooter &&
                    access.dom.vbFooter.parentNode === vb
                  ) {
                    vb.insertBefore(grid, access.dom.vbFooter);
                  } else {
                    vb.appendChild(grid);
                  }
                }
                if (
                  access.dom.vbFooter &&
                  access.dom.vbFooter.parentNode !== vb
                ) {
                  vb.appendChild(access.dom.vbFooter);
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
              if (access.dom.verticalBar) {
                access.dom.verticalBar.style.display = "none";
                access.dom.verticalBar.removeAttribute("data-revealed");
              }
              if (access.dom.verticalBarTrigger) {
                access.dom.verticalBarTrigger.style.display = "none";
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
                  access.dom.utilitySection &&
                  access.dom.utilitySection.parentNode === grid
                ) {
                  grid.appendChild(access.dom.utilitySection);
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
                  access.dom.utilitySection &&
                  access.dom.utilitySection.parentNode === grid
                ) {
                  if (grid.firstChild !== access.dom.utilitySection) {
                    grid.insertBefore(
                      access.dom.utilitySection,
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
        },
        updateVerticalBarBounds() {
          const vb = access.dom.verticalBar;
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
          if (access.dom.verticalBarTrigger) {
            access.dom.verticalBarTrigger.style.top = top + "px";
            access.dom.verticalBarTrigger.style.bottom = gap + "px";
          }

          this.syncVerticalBarTheme();
          this.updateVerticalBarAddBtnPlacement();
        },
        updateVerticalBarAddBtnPlacement() {
          if (!this.isPlacementVerticalBar() || !access.dom.verticalBar) return;
          const vb = access.dom.verticalBar;
          const grid = access.dom.grid;
          const scrollBox = access.dom.scrollBox;
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
        },
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
            if (access.dom.grid)
              access.dom.grid.removeAttribute("data-revealed");
            if (access.dom.verticalBar)
              access.dom.verticalBar.removeAttribute("data-revealed");
          }
          if (isVerticalBar) {
            this.updateVerticalBarBounds();
          }
          if (access.dom.vbAutohideBtn) {
            access.dom.vbAutohideBtn.title = isAutohide
              ? "Disable Autohide"
              : "Enable Autohide";
          }
          if (access.dom.utilityAutohideBtn) {
            access.dom.utilityAutohideBtn.title = isAutohide
              ? "Disable Autohide"
              : "Enable Autohide";
          }
          this.applyHideUtilitySectionPref();

          if (!this._badgeSyncInitialized) {
            this._badgeSyncInitialized = true;
            this._badgeSyncHandler = (event) => {
              const browser = event.target?.linkedBrowser;
              if (browser?._bgalazkaAppId)
                this.syncAllAppBadges(browser._bgalazkaAppId);
            };
            window.addEventListener("TabSelect", this._badgeSyncHandler, {
              passive: true,
            });
            window.addEventListener("TabAttrModified", this._badgeSyncHandler, {
              passive: true,
            });
          }
          if (access.state.appBrowsers && access.state.appBrowsers.size > 0) {
            this.ensureBadgeSyncLoop();
          }
        },
        applyHideUtilitySectionPref() {
          const hide =
            Core.getPref(Constants.Apps.PREF_HIDE_UTILITY_SECTION, false) ===
            true;
          document.documentElement.setAttribute(
            "zentral-apps-hide-utility",
            hide ? "true" : "false",
          );
          if (access.dom.utilitySection) {
            access.dom.utilitySection.setAttribute(
              "data-permanently-hidden",
              hide ? "true" : "false",
            );
            if (hide) {
              access.dom.utilitySection.style.setProperty(
                "display",
                "none",
                "important",
              );
              if (access.dom.utilityRow)
                access.dom.utilityRow.replaceChildren();
            } else {
              access.dom.utilitySection.style.removeProperty("display");
              this.renderUtilitySection();
            }
          }
        },
        setUtilityHovered(hovered) {
          if (access.state.utilityCollapseTimer) {
            clearTimeout(access.state.utilityCollapseTimer);
            access.state.utilityCollapseTimer = null;
          }
          if (
            Core.getPref(Constants.Apps.PREF_HIDE_UTILITY_SECTION, false) ===
            true
          )
            return;
          const util = access.dom.utilitySection;
          if (!util) return;

          if (hovered) {
            util.setAttribute("data-utility-revealed", "true");
          } else {
            util.removeAttribute("data-utility-revealed");
          }
        },
        scheduleUtilityCollapse(delay = 350) {
          if (access.state.utilityCollapseTimer)
            clearTimeout(access.state.utilityCollapseTimer);
          access.state.utilityCollapseTimer = setTimeout(() => {
            access.state.utilityCollapseTimer = null;
            this.setUtilityHovered(false);
          }, delay);
        },
        scheduleAutohideReveal(delay = 320) {
          if (access.state.autohideCollapseTimer) {
            clearTimeout(access.state.autohideCollapseTimer);
            access.state.autohideCollapseTimer = null;
          }
          if (access.state.autohideRevealTimer) return;
          access.state.autohideRevealTimer = setTimeout(() => {
            access.state.autohideRevealTimer = null;
            this.setAutohideHovered(true);
          }, delay);
        },
        cancelAutohideReveal() {
          if (access.state.autohideRevealTimer) {
            clearTimeout(access.state.autohideRevealTimer);
            access.state.autohideRevealTimer = null;
          }
        },
        isAppPanelKeepingAppsRevealed() {
          return (
            !!access.state.activeAppId &&
            !(
              this.isPlacementVerticalBar() &&
              document.documentElement.hasAttribute(
                "bgalazka-hover-panel-hidden",
              )
            )
          );
        },
        syncPanelAutohideVisibility() {
          if (
            !this.isPlacementVerticalBar() ||
            document.documentElement.getAttribute("zentral-apps-autohide") !==
              "true"
          )
            return;
          this.setAutohideHovered(
            this.isAppPanelKeepingAppsRevealed() ||
              !!access.dom.verticalBar?.matches(":hover"),
          );
        },
        setAutohideHovered(hovered) {
          this.cancelAutohideReveal();
          if (access.state.autohideCollapseTimer) {
            clearTimeout(access.state.autohideCollapseTimer);
            access.state.autohideCollapseTimer = null;
          }
          if (access.dom.grid) {
            if (hovered) {
              access.dom.grid.setAttribute("data-revealed", "true");
            } else if (!this.isAppPanelKeepingAppsRevealed()) {
              access.dom.grid.removeAttribute("data-revealed");
            }
          }
          if (access.dom.verticalBar) {
            if (hovered) {
              this.updateVerticalBarBounds();
              access.dom.verticalBar.setAttribute("data-revealed", "true");
            } else if (!this.isAppPanelKeepingAppsRevealed()) {
              access.dom.verticalBar.removeAttribute("data-revealed");
            }
          }
        },
        scheduleAutohideCollapse(delay = 250) {
          // Mousemove may request collapse every frame. For a hover-hidden
          // two-bar panel, keep the first deadline instead of postponing it
          // until the pointer stops moving. Sidebar timing stays unchanged.
          if (
            this.isPlacementVerticalBar() &&
            !this.isAppPanelKeepingAppsRevealed() &&
            access.state.autohideCollapseTimer
          )
            return;
          this.cancelAutohideReveal();
          if (access.state.autohideCollapseTimer)
            clearTimeout(access.state.autohideCollapseTimer);
          access.state.autohideCollapseTimer = setTimeout(() => {
            access.state.autohideCollapseTimer = null;
            if (!this.isAppPanelKeepingAppsRevealed()) {
              this.setAutohideHovered(false);
            }
          }, delay);
        },

        // Responsibility: ZentralAppsAppearance
        _debouncedSyncTheme(delay = 32) {
          if (this._syncThemeTimer) clearTimeout(this._syncThemeTimer);
          this._syncThemeTimer = setTimeout(() => {
            this._syncThemeTimer = null;
            this.syncVerticalBarTheme();
          }, delay);
        },
        syncVerticalBarTheme() {
          const vb = access.dom.verticalBar;
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
        },
      };
    },
  );
})();
