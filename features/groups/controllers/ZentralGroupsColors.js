/*
 * ZENTRAL FILE GUIDE - features/groups/controllers/ZentralGroupsColors.js
 *
 * Purpose: Persists/applies group colors, derives average favicon/fallback colors and creates the
 *   interactive color-picker popup.
 * Interaction / execution: Installed by ZentralTabGroups; Menus opens ensureColorPickerPanel and
 *   Dom/restore flows apply colors. Uses live state/restoring and colorPickerDragCleanup accessors.
 * Ownership / failure: Color calculations and picker share the same owner; keep them together.
 *   Groups.destroy() runs drag cleanup and removes the owned picker. Favicon extraction is asynchronous and
 *   bounded by its existing completion path.
 * Registration: groups/ZentralGroupsColors
 * Loaded/created by: features/groups/ZentralTabGroups.uc.js
 * Returned factory API: applyAverageGroupColor; calculateAverageColor; checkAndApplyFirstTimeGroupColor;
 *   clearStoredColorData; ensureColorPickerPanel; extractTabFaviconColor; getContrastColor;
 *   getTabFallbackColor; isGroupKnownInSavedState; loadSavedColors; removeSavedColor; saveTabGroupColors
 * Live owner accessors/callbacks: colorPickerDragCleanup; isRestoring; state
 * Cross-file calls / ctx suppliers: features/groups/controllers/ZentralGroupsDom.js -> getDirectTabs;
 *   features/groups/controllers/ZentralGroupsNativeAdapter.js -> isLibraryCopy, queryLiveTabNodes;
 *   features/groups/controllers/ZentralGroupsStore.js -> scheduleStateSave
 * Contract fields assigned here: access.colorPickerDragCleanup; access.state.colorPickerPanel;
 *   ctx.fillStyle
 * Literal DOM event subscriptions: change; click; input; mousedown; mousemove; mouseup
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("groups/ZentralGroupsColors", function ({ Services, shared, runtime, access }) {
const { Constants, Core, createSVGElement, SVG_STRINGS, WELL_KNOWN_SERVICES } = shared;
return {
// Responsibility: ZentralGroupsColors
isGroupKnownInSavedState(groupId) {
          if (!groupId) return false;
          try {
            const stateStr = Core.getPref(Constants.TabGroups.PREF_STATE);
            if (stateStr && stateStr !== "{}") {
              const parsed = JSON.parse(stateStr);
              const groups =
                parsed && parsed.groups ? parsed.groups : parsed || {};
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
        },
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
                const ctx = canvas.getContext("2d", {
                  willReadFrequently: true,
                });
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
        },
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
                return [
                  parseInt(match[1]),
                  parseInt(match[2]),
                  parseInt(match[3]),
                ];
            }
          } catch (_) {}
          return [112, 122, 194];
        },
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
        },
checkAndApplyFirstTimeGroupColor(group) {
          if (this.isLibraryCopy(group)) return;
          // 1. Never run while the browser is starting up / restoring sessions
          if (access.isRestoring) return;

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
          if (
            group._zentralInitialColorChecked ||
            group._zentralColoringInProgress
          )
            return;

          // 4. If group already has an explicit custom color assigned, don't overwrite it
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

          // 5. If group was previously saved/known in persistent storage, NEVER default to auto color on reconstruction
          if (this.isGroupKnownInSavedState(group.id)) return;

          // This is a brand new group created for the FIRST TIME EVER:
          this.applyAverageGroupColor(group, false);
        },
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
        },
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
        },
clearStoredColorData() {
          if (window.gZenThemePicker) {
            delete window.gZenThemePicker._currentTabGroup;
            delete window.gZenThemePicker._tabGroupForColorPicker;
          }
        },
async saveTabGroupColors() {
          let colors = {};
          try {
            const raw = Core.getPref(Constants.TabGroups.PREF_COLORS);
            if (raw && raw !== "{}") colors = JSON.parse(raw) || {};
          } catch (_) {}
          this.queryLiveTabNodes("tab-group:not([split-view-group])").forEach(
            (group) => {
              if (group.id) {
                const customColor = group.style.getPropertyValue(
                  "--zentral-custom-color",
                );
                const tgColor =
                  group.style.getPropertyValue("--tab-group-color");
                const color =
                  customColor &&
                  customColor.trim() &&
                  customColor !== "transparent"
                    ? customColor
                    : tgColor &&
                        !tgColor.startsWith("var(--tab-group-") &&
                        tgColor !== "transparent"
                      ? tgColor
                      : null;
                if (color) colors[group.id] = color;
              }
            },
          );
          Core.setPref(Constants.TabGroups.PREF_COLORS, JSON.stringify(colors));
          this.scheduleStateSave();
        },
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
        },
async removeSavedColor(groupId) {
          try {
            const colors = JSON.parse(
              Core.getPref(Constants.TabGroups.PREF_COLORS),
            );
            if (colors[groupId]) {
              delete colors[groupId];
              Core.setPref(
                Constants.TabGroups.PREF_COLORS,
                JSON.stringify(colors),
              );
              this.scheduleStateSave();
            }
          } catch (e) {}
        },

// Responsibility: ZentralGroupsColorPicker
ensureColorPickerPanel() {
          if (
            access.state.colorPickerPanel &&
            access.state.colorPickerPanel.isConnected
          ) {
            return access.state.colorPickerPanel;
          }

          const popupSet =
            document.getElementById("mainPopupSet") ||
            document.documentElement ||
            document.body;
          let existing = document.getElementById("zentral-group-color-picker");
          if (existing && existing.isConnected) {
            access.state.colorPickerPanel = existing;
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
          const wheelContainer = panel.querySelector(
            "#zentral-tg-wheel-container",
          );
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

            const whiteGrad = ctx.createLinearGradient(
              0,
              0,
              satValCanvas.width,
              0,
            );
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
          access.colorPickerDragCleanup?.();
          window.addEventListener("mousemove", onColorPickerMove);
          window.addEventListener("mouseup", onColorPickerUp);
          access.colorPickerDragCleanup = () => {
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
                  "#" +
                    parts.map((n) => n.toString(16).padStart(2, "0")).join(""),
                );
              }
            });

          access.state.colorPickerPanel = panel;
          return panel;
        }
};
});
})();
