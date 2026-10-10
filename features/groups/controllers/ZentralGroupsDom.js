/*
 * ZENTRAL FILE GUIDE - features/groups/controllers/ZentralGroupsDom.js
 *
 * Purpose: Enhances native group DOM, renaming, chevrons/indicators/labels and subgroup badges with
 *   scheduled badge updates.
 * Interaction / execution: Installed by ZentralTabGroups; native observers call
 *   processGroup/processExistingGroups, Store preserves state and Menus supplies context actions. Reads
 *   live processedGroups/groupObservers/state.
 * Ownership / failure: Groups.destroy() disconnects observers and cancels badge RAF. Treat Zen Library
 *   copies through NativeAdapter helpers rather than modifying every matching node in the document.
 * Registration: groups/ZentralGroupsDom
 * Loaded/created by: features/groups/ZentralTabGroups.uc.js
 * Returned factory API: applyChevronPref; applyIndicatorTypePref; applyLabelOpacityPref; getDirectTabs;
 *   processExistingGroups; processGroup; renameGroupHalt; renameGroupKeydown; renameGroupStart;
 *   safeHideTooltip; scheduleBadgeUpdate; updateAllSubGroupsBadges; updateCollapsedLabel;
 *   updateGroupSubGroupsBadge
 * Live owner accessors/callbacks: badgeUpdateRAF; createSVG; groupObservers; isUpdatingBadges;
 *   processedGroups; state
 * Cross-file calls / ctx suppliers: features/groups/controllers/ZentralGroupsColors.js -> checkAndApplyFirstTimeGroupColor,
 *   removeSavedColor; features/groups/controllers/ZentralGroupsMenus.js -> addContextMenu;
 *   features/groups/controllers/ZentralGroupsNativeAdapter.js -> isLibraryCopy, queryLiveTabNodes;
 *   features/groups/controllers/ZentralGroupsStore.js -> loadTabGroupState, scheduleStateSave
 * Contract fields assigned here: access.badgeUpdateRAF; access.isUpdatingBadges; access.state.groupEdited;
 *   access.state.groupEdited.style.display; access.state.isStartingRename
 * Literal DOM event subscriptions: blur; click; dblclick; keydown; mousedown; mouseenter; mouseleave
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "groups/ZentralGroupsDom",
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
        updateCollapsedLabel(labelContainer, title) {
          if (!labelContainer) return;
          let initialsEl = labelContainer.querySelector(
            ".zentral-group-initials",
          );
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
        },
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
        },
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
        },
        processExistingGroups() {
          const groups = this.queryLiveTabNodes(
            "tab-group:not([split-view-group])",
          );
          groups.forEach((group) => this.processGroup(group));
          this.loadTabGroupState();
        },
        renameGroupKeydown(event) {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            const label = access.state.groupEdited;
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
            access.state.groupEdited = null;
          } else if (event.key === "Escape") {
            event.preventDefault();
            this.renameGroupHalt(event, true);
          }
        },
        renameGroupStart(group, selectAll = true) {
          if (!group || access.state.groupEdited) return;
          const labelElement = group.querySelector(".tab-group-label");
          if (!labelElement) return;

          access.state.groupEdited = labelElement;
          access.state.isStartingRename = true;
          setTimeout(() => {
            access.state.isStartingRename = false;
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

          lifecycle.listen(input, "keydown", (e) => this.renameGroupKeydown(e));
          lifecycle.listen(input, "blur", (e) => this.renameGroupHalt(e));
        },
        renameGroupHalt(event, force = false) {
          if (access.state.isStartingRename && !force) return;
          if (!access.state.groupEdited) return;

          const input = document.getElementById("tab-label-input");
          if (input && document.activeElement === input && !force) return;

          document.documentElement.removeAttribute("zen-renaming-group");
          if (input) input.remove();
          if (access.state.groupEdited) {
            access.state.groupEdited.classList.remove(
              "tab-group-label-editing",
            );
            access.state.groupEdited.style.display = "";
            access.state.groupEdited = null;
          }
        },
        processGroup(group) {
          if (this.isLibraryCopy(group)) return;
          // Use a WeakSet instead of a DOM attribute to avoid persisting across restarts
          // and to prevent guard bypasses when native code resets group attributes.
          if (
            !group ||
            access.processedGroups.has(group) ||
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
          lifecycle.capturePresentation(group);
          group.classList.add("zentral-standard");
          group.setAttribute("zentral-group", "true");
          group.style.setProperty("border-radius", "6px", "important");

          // Ensure full internal structure exists
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
            lifecycle.listen(labelContainer, "click", (e) => {
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
                child.style.setProperty(
                  "list-style-image",
                  "none",
                  "important",
                );
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
              labelContainer.style.setProperty(
                "border-radius",
                "8px",
                "important",
              );
              labelContainer.style.setProperty(
                "aspect-ratio",
                "auto",
                "important",
              );
              labelContainer.style.setProperty(
                "align-self",
                "stretch",
                "important",
              );
              labelContainer.style.setProperty("width", "100%", "important");
              labelContainer.style.setProperty(
                "min-width",
                "100%",
                "important",
              );
              labelContainer.style.setProperty(
                "max-width",
                "100%",
                "important",
              );
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
              innerLabel.style.setProperty(
                "border-radius",
                "12px",
                "important",
              );
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
            access.groupObservers.set(group, styleWatcher);

            // Labels are always full-width ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no hover expand/collapse needed.

            let hoverTimer = null;
            lifecycle.listen(labelContainer, "mouseenter", () => {
              if (!Core.getPref(Constants.TabGroups.PREF_THUMBNAILS)) return;
              labelContainer.setAttribute("zentral-hover", "true");
              hoverTimer = setTimeout(() => {
                const panel = document.getElementById(
                  "zentral-tabgroup-tooltip",
                );
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
                        (window.gBrowser &&
                          window.gBrowser.selectedTab === tab);
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

                      lifecycle.listen(row, "click", (e) => {
                        if (e.target.closest(".zentral-tooltip-close-btn"))
                          return;
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
                        access.createSVG(
                          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`,
                        ),
                      );
                      lifecycle.listen(closeBtn, "click", (e) => {
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
            lifecycle.listen(labelContainer, "mouseleave", () => {
              labelContainer.removeAttribute("zentral-hover");
              if (hoverTimer) clearTimeout(hoverTimer);
              this.safeHideTooltip(350);
            });
            lifecycle.listen(labelContainer, "mousedown", () => {
              if (hoverTimer) clearTimeout(hoverTimer);
              const panel = document.getElementById("zentral-tabgroup-tooltip");
              if (panel && panel.hidePopup) panel.hidePopup();
            });
            lifecycle.listen(labelContainer, "dblclick", (e) => {
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
              frag.querySelector(".tab-group-icon-container") ||
              frag.children[0];
            const closeButton =
              frag.querySelector(".tab-close-button") || frag.children[1];

            labelContainer.insertBefore(
              iconContainer,
              labelContainer.firstChild,
            );
            labelContainer.appendChild(closeButton);

            lifecycle.listen(closeButton, "click", (event) => {
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
          let wrapper = labelContainer.querySelector(
            ".zentral-tab-title-wrapper",
          );
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

          let subGroupsBadge = wrapper.querySelector(
            ".zentral-subgroups-badge",
          );
          if (!subGroupsBadge) {
            subGroupsBadge = document.createElement("span");
            subGroupsBadge.className = "zentral-subgroups-badge";
            wrapper.appendChild(subGroupsBadge);
          }

          group.classList.remove("tab-group-editor-mode-create");
          access.processedGroups.add(group);
          group.setAttribute("data-close-button-added", "true"); // Kept for external compatibility

          this.addContextMenu(group);

          if (
            !group.label ||
            group.label === "" ||
            ("defaultGroupName" in group &&
              group.label === group.defaultGroupName)
          ) {
            this.renameGroupStart(group, false);
          }

          this.checkAndApplyFirstTimeGroupColor(group);
          this.updateGroupSubGroupsBadge(group);
          const parentGroup = group.parentElement?.closest("tab-group");
          if (parentGroup) this.updateGroupSubGroupsBadge(parentGroup);
        },
        scheduleBadgeUpdate() {
          if (access.badgeUpdateRAF) return;
          access.badgeUpdateRAF = requestAnimationFrame(() => {
            access.badgeUpdateRAF = null;
            this.updateAllSubGroupsBadges();
          });
        },
        updateGroupSubGroupsBadge(group, cachedAllGroups = null) {
          if (this.isLibraryCopy(group)) return;
          if (
            !group ||
            !group.isConnected ||
            group.nodeType !== Node.ELEMENT_NODE
          )
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
              this.queryLiveTabNodes(
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
        },
        updateAllSubGroupsBadges() {
          if (access.isUpdatingBadges) return;
          access.isUpdatingBadges = true;
          try {
            const allGroups = Array.from(
              this.queryLiveTabNodes(
                "tab-group:not([split-view-group]):not([zen-split-view]):not([is-zen-split])",
              ),
            ).filter((g) => !g.classList?.contains("zen-split-view"));
            allGroups.forEach((g) => {
              this.updateGroupSubGroupsBadge(g, allGroups);
            });
          } catch (err) {
            Core.error("ZentralTabGroups", "Error updating badges:", err);
          } finally {
            access.isUpdatingBadges = false;
          }
        },
        applyChevronPref() {
          const showChevron = Core.getPref(
            Constants.TabGroups.PREF_SHOW_CHEVRON,
          );
          document.documentElement.setAttribute(
            "zentral-show-chevron",
            showChevron !== false ? "true" : "false",
          );
        },
        applyIndicatorTypePref() {
          const indicatorType = Core.getPref(
            Constants.TabGroups.PREF_INDICATOR_TYPE,
            "circle",
          );
          document.documentElement.setAttribute(
            "zentral-indicator-type",
            indicatorType === "chevron" ? "chevron" : "circle",
          );
        },
        applyLabelOpacityPref() {
          const opacityPct = Core.getPref(
            Constants.TabGroups.PREF_LABEL_OPACITY,
          );
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
        },
      };
    },
  );
})();
