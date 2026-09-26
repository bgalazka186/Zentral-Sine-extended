"use strict";
// Complete base class kept intact so private fields remain class-local.
(function () {
  const sources = (window.ZentralClassSources ||= Object.create(null));
  sources.settings = function defineZentralSettings({ Constants, Core }) {
  /* ============================================================================
   * 5.0 SETTINGS MODULE (ZentralSettings)
   * ============================================================================
   */

  /**
   * Zentral Settings Module
   * Manages the preferences modal dialog UI, form controls, and options persistence.
   */
  class ZentralSettings {
    /**
     * Constructs ZentralSettings instance.
     */
    constructor() {
      /** @type {Element|null} Reference to modal dialog overlay container */
      this.modal = null;
      this._stopShortcutRecordings = new Set();
    }

    /**
     * Module initialization hook.
     */
    init() {}

    /**
     * Module tear down for Sine hot unloading
     */
    destroy() {
      try {
        Core.log("ZentralSettings", "Destroying Settings module...");
        for (const stop of this._stopShortcutRecordings) stop();
        this._stopShortcutRecordings.clear();
        if (this.modal) {
          if (this.close) this.close();
          if (this.modal.parentNode) this.modal.remove();
          this.modal = null;
        }
        if (this._matrixMouseUpHandler) {
          window.removeEventListener("mouseup", this._matrixMouseUpHandler);
          this._matrixMouseUpHandler = null;
        }
        if (this._escapeKeyHandler) {
          window.removeEventListener("keydown", this._escapeKeyHandler);
          this._escapeKeyHandler = null;
        }
        const modalEl = document.getElementById("zentral-settings-modal");
        if (modalEl) modalEl.remove();
        const stylesEl = document.getElementById("zentral-settings-styles");
        if (stylesEl) stylesEl.remove();
        this._stylesInjected = false;
        delete window.ZentralSettingsInstance;
      } catch (e) {
        console.error("[Zentral] Settings destroy error:", e);
      }
    }

    /**
     * Dynamically positions the modal dialog to fit the content area, excluding the sidebar.
     */
    updatePosition() {
      if (!this.modal) return;
      try {
        const sidebar =
          document.getElementById("sidebar-box") ||
          document.getElementById("sidebar-container") ||
          document.getElementById("vertical-tabs") ||
          document
            .getElementById("tabbrowser-tabs")
            ?.closest(
              "#sidebar-box, #sidebar-container, #vertical-tabs, .zen-sidebar",
            ) ||
          document.getElementById("tabbrowser-tabs");

        const isSidebarCollapsed =
          document.documentElement.getAttribute("zen-sidebar-collapsed") ===
            "true" ||
          document.documentElement.getAttribute("zentral-sidebar-collapsed") ===
            "true";

        if (sidebar && !isSidebarCollapsed) {
          const sRect = sidebar.getBoundingClientRect();
          const isRight =
            document.documentElement.getAttribute("zen-sidebar-right") ===
              "true" ||
            document.documentElement.getAttribute("zen-right-side") ===
              "true" ||
            sRect.left > window.innerWidth / 2;

          if (sRect.width > 20 && sRect.width < window.innerWidth) {
            if (isRight) {
              this.modal.style.left = "0px";
              this.modal.style.top = "0px";
              this.modal.style.bottom = "0px";
              this.modal.style.right =
                window.innerWidth - Math.round(sRect.left) + "px";
              this.modal.style.width = Math.round(sRect.left) + "px";
            } else {
              this.modal.style.left = Math.round(sRect.right) + "px";
              this.modal.style.top = "0px";
              this.modal.style.bottom = "0px";
              this.modal.style.right = "0px";
              this.modal.style.width =
                window.innerWidth - Math.round(sRect.right) + "px";
            }
            this.modal.style.height = "100vh";
            return;
          }
        }
      } catch (_) {}

      this.modal.style.left = "0px";
      this.modal.style.top = "0px";
      this.modal.style.right = "0px";
      this.modal.style.bottom = "0px";
      this.modal.style.width = "100vw";
      this.modal.style.height = "100vh";
    }

    /**
     * Opens the settings modal dialog.
     */
    open() {
      if (!this.modal) {
        this.createModal();
      }
      this.modal.setAttribute("data-open", "true");
      this.modal.style.setProperty("display", "flex", "important");
      this.populate();
      this.updatePosition();

      if (!this._escapeKeyHandler) {
        this._escapeKeyHandler = (e) => {
          if (
            e.key === "Escape" &&
            this.modal &&
            this.modal.getAttribute("data-open") === "true"
          ) {
            this.close();
          }
        };
        window.addEventListener("keydown", this._escapeKeyHandler);
      }

      if (!this._resizeHandler) {
        this._resizeHandler = () => this.updatePosition();
        window.addEventListener("resize", this._resizeHandler, {
          passive: true,
        });
      }
    }

    /**
     * Closes the settings modal dialog.
     */
    close() {
      for (const stop of this._stopShortcutRecordings) stop();
      if (this.modal) {
        this.modal.setAttribute("data-open", "false");
        this.modal.style.setProperty("display", "none", "important");
      }
      if (this._escapeKeyHandler) {
        window.removeEventListener("keydown", this._escapeKeyHandler);
        this._escapeKeyHandler = null;
      }
      if (this._resizeHandler) {
        window.removeEventListener("resize", this._resizeHandler);
        this._resizeHandler = null;
      }
    }

    /**
     * Opens the native OS directory picker dialog to select an export folder.
     * @returns {Promise<string|null>} Selected directory path or null if cancelled.
     */
    async pickExportFolder() {
      return new Promise((resolve) => {
        try {
          const nsIFilePicker =
            Ci?.nsIFilePicker || Components.interfaces.nsIFilePicker;
          const fp = (
            Cc?.["@mozilla.org/filepicker;1"] ||
            Components.classes["@mozilla.org/filepicker;1"]
          ).createInstance(nsIFilePicker);

          const parentWin = window.browsingContext || window;
          fp.init(
            parentWin,
            "Select Diagnostic Log Export Directory",
            nsIFilePicker.modeGetFolder,
          );

          let resolved = false;
          const onDone = (result) => {
            if (resolved) return;
            resolved = true;
            if (result === nsIFilePicker.returnOK && fp.file) {
              resolve(fp.file.path);
            } else {
              resolve(null);
            }
          };

          if (typeof fp.open === "function") {
            try {
              const res = fp.open({
                done(val) {
                  onDone(val);
                },
              });
              if (res && typeof res.then === "function") {
                res.then((result) => onDone(result)).catch(() => onDone(null));
              }
            } catch (_) {
              try {
                const res2 = fp.open((val) => onDone(val));
                if (res2 && typeof res2.then === "function") {
                  res2
                    .then((result) => onDone(result))
                    .catch(() => onDone(null));
                }
              } catch (e2) {
                onDone(null);
              }
            }
          } else if (typeof fp.show === "function") {
            const res = fp.show();
            onDone(res);
          } else {
            onDone(null);
          }
        } catch (err) {
          console.error("[ZentralSettings] Error opening folder picker:", err);
          resolve(null);
        }
      });
    }

    /**
     * Updates the folder button label and description based on current export path.
     * @param {string} path - Directory path.
     */
    updatePathUI(path) {
      if (!this.modal) return;
      const label = this.modal.querySelector("#zs-btn-choose-path-label");
      const btn = this.modal.querySelector("#zs-btn-choose-path");
      const clearBtn = this.modal.querySelector("#zs-btn-clear-path");
      const desc = this.modal.querySelector("#zs-pref-logger-path-desc");
      if (!label || !btn) return;

      if (path && path.trim() !== "") {
        const cleanPath = path.trim();
        const parts = cleanPath.split(/[\\/]/).filter(Boolean);
        const folderName = parts.pop() || cleanPath;
        label.textContent = folderName;
        btn.title = cleanPath;
        if (clearBtn) clearBtn.style.display = "flex";
        if (desc) desc.textContent = `Saving to: ${cleanPath}`;
      } else {
        label.textContent = "Default Folder";
        btn.title =
          "Logs will be saved in profile chrome/logs directory. Click to change folder.";
        if (clearBtn) clearBtn.style.display = "none";
        if (desc)
          desc.textContent = "Directory where diagnostic logs are saved";
      }
    }

    /**
     * Reads preferences from ZentralCore and populates modal input fields and switches.
     */
    populate() {
      if (!this.modal) return;
      const get = (id) => this.modal.querySelector("#" + id);
      if (!get("zs-anim-speed")) return;

      const appsEnabled =
        Core.getPref(Constants.Apps.PREF_ENABLED, true) !== false;
      if (get("zs-ag-enabled")) {
        get("zs-ag-enabled").checked = appsEnabled;
        if (get("zs-ag-status")) {
          get("zs-ag-status").textContent = appsEnabled
            ? "Enabled"
            : "Disabled";
          get("zs-ag-status").setAttribute(
            "data-enabled",
            appsEnabled ? "true" : "false",
          );
        }
        if (get("zs-ag-content")) {
          get("zs-ag-content").setAttribute(
            "data-disabled",
            !appsEnabled ? "true" : "false",
          );
        }
      }

      const placement =
        Core.getPref(Constants.Apps.PREF_PLACEMENT, "sidebar") || "sidebar";
      if (get("zs-ag-placement")) get("zs-ag-placement").value = placement;
      if (get("zs-ag-col"))
        get("zs-ag-col").setAttribute("data-placement", placement);
      this.modal.querySelectorAll(".zs-placement-btn").forEach((btn) => {
        btn.setAttribute(
          "data-active",
          btn.dataset.placement === placement ? "true" : "false",
        );
      });

      // Show/hide Apps Box Matrix with smooth slide animation based on placement
      const matrixWrapper = get("zs-matrix-wrapper");
      if (matrixWrapper) {
        if (placement === "sidebar") {
          matrixWrapper.removeAttribute("data-hidden");
        } else {
          matrixWrapper.setAttribute("data-hidden", "true");
        }
      }

      const utilityRow = get("zs-utility-section-row");
      if (utilityRow) {
        if (placement === "sidebar") {
          utilityRow.removeAttribute("data-hidden");
        } else {
          utilityRow.setAttribute("data-hidden", "true");
        }
      }

      const cols = Core.getPref(Constants.Apps.PREF_APPS_PER_ROW, 7) || 7;
      const rows = Core.getPref(Constants.Apps.PREF_MAX_ROWS, 3) || 3;
      this.updateMatrixUI(cols, rows);

      const animType =
        Core.getPref(Constants.Apps.PREF_ANIMATION_TYPE, "slide") || "slide";
      const animSpeed =
        Core.getPref(Constants.Apps.PREF_ANIMATION_SPEED, 450) ?? 450;
      const maxApps = Core.getPref(Constants.Apps.PREF_MAX_APPS, 21) || 21;

      const animDropdown = this.modal.querySelector("#zs-anim-type-dropdown");
      if (animDropdown && animDropdown.syncValue) {
        animDropdown.syncValue(animType);
      } else if (get("zs-anim-type")) {
        get("zs-anim-type").value = animType;
      }

      get("zs-anim-speed").value = animSpeed;
      if (get("zs-anim-speed-slider"))
        get("zs-anim-speed-slider").value = animSpeed;
      if (get("zs-anim-speed-badge"))
        get("zs-anim-speed-badge").textContent = `${animSpeed} ms`;
      get("zs-max-apps").value = maxApps;
      if (get("zs-hide-utility-section")) {
        get("zs-hide-utility-section").checked =
          Core.getPref(Constants.Apps.PREF_HIDE_UTILITY_SECTION, false) ===
          true;
      }

      const instaPeekShortcut =
        Core.getPref(Constants.Apps.PREF_INSTA_PEEK_SHORTCUT, "Alt+Q") ||
        "Alt+Q";
      const instaPeekBtn = this.modal.querySelector("#zs-insta-peek-btn");
      if (instaPeekBtn && instaPeekBtn.syncValue) {
        instaPeekBtn.syncValue(instaPeekShortcut);
      } else if (get("zs-insta-peek-shortcut")) {
        get("zs-insta-peek-shortcut").value = instaPeekShortcut;
      }

      this.updatePreviewDemo(animType, animSpeed);

      const tgEnabled =
        Core.getPref(Constants.TabGroups.PREF_ENABLED, true) !== false;
      if (get("zs-tg-enabled")) {
        get("zs-tg-enabled").checked = tgEnabled;
        if (get("zs-tg-status")) {
          get("zs-tg-status").textContent = tgEnabled ? "Enabled" : "Disabled";
          get("zs-tg-status").setAttribute(
            "data-enabled",
            tgEnabled ? "true" : "false",
          );
        }
        if (get("zs-tg-content")) {
          get("zs-tg-content").setAttribute(
            "data-disabled",
            !tgEnabled ? "true" : "false",
          );
        }
      }

      get("zs-tg-collapse").checked =
        Core.getPref(Constants.TabGroups.PREF_COLLAPSE_ON_LAUNCH, false) ===
        true;
      get("zs-tg-thumbnails").checked =
        Core.getPref(Constants.TabGroups.PREF_THUMBNAILS, true) !== false;

      const showIndicator =
        Core.getPref(Constants.TabGroups.PREF_SHOW_CHEVRON, true) !== false;
      get("zs-tg-chevron").checked = showIndicator;
      const indicatorTypeRow = get("zs-tg-indicator-type-row");
      if (indicatorTypeRow) {
        if (showIndicator) {
          indicatorTypeRow.removeAttribute("data-hidden");
        } else {
          indicatorTypeRow.setAttribute("data-hidden", "true");
        }
      }

      const indicatorType =
        Core.getPref(Constants.TabGroups.PREF_INDICATOR_TYPE, "circle") ||
        "circle";
      const tgDropdown = this.modal.querySelector(
        "#zs-tg-indicator-type-dropdown",
      );
      if (tgDropdown && tgDropdown.syncValue) {
        tgDropdown.syncValue(indicatorType);
      } else if (get("zs-tg-indicator-type")) {
        get("zs-tg-indicator-type").value = indicatorType;
      }

      const opacity =
        Core.getPref(Constants.TabGroups.PREF_LABEL_OPACITY, 85) ?? 85;
      if (get("zs-tg-opacity")) {
        get("zs-tg-opacity").value = opacity;
        if (get("zs-tg-opacity-badge"))
          get("zs-tg-opacity-badge").textContent = opacity + "%";
      }

      if (get("zs-pref-logger-enabled")) {
        get("zs-pref-logger-enabled").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_ENABLED,
          false,
        );
      }
      if (get("zs-pref-logger-full")) {
        get("zs-pref-logger-full").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_FULL,
          true,
        );
      }
      if (get("zs-pref-logger-core")) {
        get("zs-pref-logger-core").checked = true; // Always on
      }
      if (get("zs-pref-logger-tabs")) {
        get("zs-pref-logger-tabs").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_TABS,
          false,
        );
      }
      if (get("zs-pref-logger-apps")) {
        get("zs-pref-logger-apps").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_APPS,
          false,
        );
      }
      if (get("zs-pref-logger-menus")) {
        get("zs-pref-logger-menus").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_MENUS,
          false,
        );
      }
      if (get("zs-pref-logger-layout")) {
        get("zs-pref-logger-layout").checked = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_LAYOUT,
          false,
        );
      }
      if (get("zs-pref-logger-path")) {
        const savedPath = Core.getPref(
          Constants.Diagnostics.PREF_LOGGER_PATH,
          "",
        );
        get("zs-pref-logger-path").value = savedPath;
        this.updatePathUI(savedPath);
      }

      this.updateLoggerUIState();
    }

    /**
     * Synchronizes dynamic visibility and interactivity across Diagnostic Logging toggles.
     */
    updateLoggerUIState() {
      if (!this.modal) return;
      const get = (id) => this.modal.querySelector("#" + id);
      const masterToggle = get("zs-pref-logger-enabled");
      const fullToggle = get("zs-pref-logger-full");
      const optionsSection = get("zs-logger-options-section");
      const modulesContainer = get("zs-logger-modules-container");

      const isMasterOn = masterToggle ? masterToggle.checked : false;
      if (optionsSection) {
        if (isMasterOn) {
          optionsSection.classList.remove("zs-section-disabled");
        } else {
          optionsSection.classList.add("zs-section-disabled");
        }
      }

      const isFull = fullToggle ? fullToggle.checked : true;
      if (modulesContainer) {
        modulesContainer.setAttribute("data-hidden", isFull ? "true" : "false");
      }
    }

    /**
     * Updates the animation preview demo element with live easing curve and duration.
     * @param {string} type - Animation easing type
     * @param {number} speedMs - Animation duration in milliseconds
     */
    updatePreviewDemo(type, speedMs) {
      if (!this.modal) return;
      const previewBox = this.modal.querySelector("#zs-anim-preview-box");
      if (!previewBox) return;

      let curve = "cubic-bezier(0.25, 1, 0.5, 1)";
      if (type === "spring-snappy")
        curve = "cubic-bezier(0.175, 0.885, 0.32, 1.275)";
      else if (type === "spring-gentle")
        curve = "cubic-bezier(0.34, 1.3, 0.64, 1)";
      else if (type === "spring-bouncy")
        curve = "cubic-bezier(0.68, -0.55, 0.265, 1.55)";
      else if (type === "elastic")
        curve = "cubic-bezier(0.68, -0.6, 0.32, 1.6)";
      else if (type === "none") curve = "step-end";

      const duration =
        type === "none" || speedMs <= 0
          ? "0.01s"
          : `${(speedMs / 1000).toFixed(2)}s`;
      previewBox.style.setProperty("--zs-preview-anim-curve", curve);
      previewBox.style.setProperty("--zs-preview-anim-duration", duration);
    }

    /**
     * Updates the 10x6 matrix selection visual state and hidden inputs.
     * @param {number} cols - Columns count (1 to 10)
     * @param {number} rows - Rows count (1 to 6)
     */
    updateMatrixUI(cols, rows) {
      if (!this.modal) return;
      const clampedCols = Math.max(1, Math.min(10, parseInt(cols, 10) || 1));
      const clampedRows = Math.max(1, Math.min(6, parseInt(rows, 10) || 1));

      const cells = this.modal.querySelectorAll(".zs-matrix-cell");
      cells.forEach((cell) => {
        const c = parseInt(cell.dataset.col, 10);
        const r = parseInt(cell.dataset.row, 10);
        cell.setAttribute(
          "data-selected",
          c <= clampedCols && r <= clampedRows ? "true" : "false",
        );
      });

      const get = (id) => this.modal.querySelector("#" + id);
      if (get("zs-apps-row")) get("zs-apps-row").value = clampedCols;
      if (get("zs-max-rows")) get("zs-max-rows").value = clampedRows;
      if (get("zs-matrix-dims"))
        get("zs-matrix-dims").textContent =
          `${clampedCols} Columns × ${clampedRows} Rows`;
      if (get("zs-matrix-total-badge"))
        get("zs-matrix-total-badge").textContent =
          `${clampedCols * clampedRows} Visible Apps`;
    }

    /**
     * Reads form fields from modal UI, saves settings via ZentralCore, and triggers UI re-renders.
     */
    save() {
      if (!this.modal) return;
      const get = (id) => this.modal.querySelector("#" + id);
      Core.setPref(Constants.Apps.PREF_ENABLED, get("zs-ag-enabled").checked);
      if (get("zs-ag-placement")) {
        Core.setPref(
          Constants.Apps.PREF_PLACEMENT,
          get("zs-ag-placement").value,
        );
      }
      Core.setPref(
        Constants.Apps.PREF_ANIMATION_TYPE,
        get("zs-anim-type").value,
      );
      Core.setPref(
        Constants.Apps.PREF_ANIMATION_SPEED,
        parseInt(get("zs-anim-speed").value) || 0,
      );
      Core.setPref(
        Constants.Apps.PREF_MAX_APPS,
        parseInt(get("zs-max-apps").value) || 21,
      );
      if (get("zs-hide-utility-section")) {
        Core.setPref(
          Constants.Apps.PREF_HIDE_UTILITY_SECTION,
          get("zs-hide-utility-section").checked,
        );
      }
      Core.setPref(
        Constants.Apps.PREF_APPS_PER_ROW,
        parseInt(get("zs-apps-row").value) || 7,
      );
      Core.setPref(
        Constants.Apps.PREF_MAX_ROWS,
        parseInt(get("zs-max-rows").value) || 3,
      );
      if (get("zs-insta-peek-shortcut")) {
        Core.setPref(
          Constants.Apps.PREF_INSTA_PEEK_SHORTCUT,
          get("zs-insta-peek-shortcut").value || "Alt+Q",
        );
      }

      Core.setPref(
        Constants.TabGroups.PREF_ENABLED,
        get("zs-tg-enabled").checked,
      );
      Core.setPref(
        Constants.TabGroups.PREF_COLLAPSE_ON_LAUNCH,
        get("zs-tg-collapse").checked,
      );
      Core.setPref(
        Constants.TabGroups.PREF_THUMBNAILS,
        get("zs-tg-thumbnails").checked,
      );
      Core.setPref(
        Constants.TabGroups.PREF_SHOW_CHEVRON,
        get("zs-tg-chevron").checked,
      );
      if (get("zs-tg-indicator-type")) {
        Core.setPref(
          Constants.TabGroups.PREF_INDICATOR_TYPE,
          get("zs-tg-indicator-type").value,
        );
      }
      if (get("zs-tg-opacity")) {
        Core.setPref(
          Constants.TabGroups.PREF_LABEL_OPACITY,
          Number.isFinite(parseInt(get("zs-tg-opacity").value, 10))
            ? Math.max(
                0,
                Math.min(100, parseInt(get("zs-tg-opacity").value, 10)),
              )
            : 85,
        );
      }

      if (get("zs-pref-logger-enabled")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_ENABLED,
          get("zs-pref-logger-enabled").checked,
        );
      }
      if (get("zs-pref-logger-full")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_FULL,
          get("zs-pref-logger-full").checked,
        );
      }
      Core.setPref(Constants.Diagnostics.PREF_LOGGER_CORE, true);
      if (get("zs-pref-logger-tabs")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_TABS,
          get("zs-pref-logger-tabs").checked,
        );
      }
      if (get("zs-pref-logger-apps")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_APPS,
          get("zs-pref-logger-apps").checked,
        );
      }
      if (get("zs-pref-logger-menus")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_MENUS,
          get("zs-pref-logger-menus").checked,
        );
      }
      if (get("zs-pref-logger-layout")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_LAYOUT,
          get("zs-pref-logger-layout").checked,
        );
      }
      if (get("zs-pref-logger-path")) {
        Core.setPref(
          Constants.Diagnostics.PREF_LOGGER_PATH,
          get("zs-pref-logger-path").value.trim(),
        );
      }

      this.close();
      if (window.Zentral?.Apps) {
        window.Zentral.Apps.applyHideUtilitySectionPref();
        window.Zentral.Apps.repositionGrid();
        window.Zentral.Apps.updateAutohideState();
        window.Zentral.Apps.renderGrid();
      }
      if (window.Zentral?.TabGroups) {
        window.Zentral.TabGroups.applyChevronPref();
        window.Zentral.TabGroups.applyIndicatorTypePref();
        window.Zentral.TabGroups.applyLabelOpacityPref();
      }
    }

    injectStyles() {
      const existing = document.getElementById("zentral-settings-styles");
      if (existing) existing.remove();
      this._stylesInjected = true;
      const css = `
        #zentral-settings-modal {
          position: fixed;
          top: 0;
          bottom: 0;
          left: 0;
          right: 0;
          height: 100vh;
          background: rgba(0, 0, 0, 0.75);
          z-index: 2147483647;
          display: none;
          align-items: center;
          justify-content: center;
          font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        #zentral-settings-modal[data-open="true"] {
          display: flex !important;
          animation: zsFadeIn 0.18s ease-out;
        }

        #zentral-settings-modal[data-open="false"] {
          display: none !important;
        }

        @keyframes zsFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes zsModalPop {
          from {
            opacity: 0;
            transform: scale(0.97) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        @keyframes zsTabFadeIn {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .zs-dialog {
          background: #0d0d12 !important;
          color: #e4e4e7 !important;
          width: 1120px !important;
          max-width: 95vw !important;
          height: 780px !important;
          max-height: 94vh !important;
          border-radius: 14px !important;
          box-shadow: 0 25px 70px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
          border: 1px solid rgba(255, 255, 255, 0.09) !important;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: zsModalPop 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .zs-header {
          padding: 18px 32px 14px 32px;
          background: #13131a !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07) !important;
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: #ffffff;
          flex-shrink: 0;
        }

        .zs-title-group {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .zs-title {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: #ffffff;
        }

        .zs-version-badge {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 9999px;
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--zen-primary-color, #6366f1) 25%, transparent);
          color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 85%, #ffffff);
          font-weight: 500;
        }

        .zs-close-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          background: transparent;
          border: none;
          border-radius: 0;
          box-shadow: none;
          color: #71717a;
          cursor: pointer;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.15s ease;
          padding: 0;
        }

        .zs-close-btn * {
          pointer-events: none;
        }

        .zs-close-btn:hover {
          color: #ffffff;
          background: transparent;
          border: none;
          box-shadow: none;
        }

        .zs-close-btn:active {
          color: #d4d4d8;
          background: transparent;
          border: none;
          box-shadow: none;
          transform: scale(0.94);
        }

        .zs-header-actions {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .zs-kofi-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          background: transparent;
          border: none;
          padding: 0;
          margin: 0;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 0;
          border-radius: 6px;
          transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.18s ease;
          text-decoration: none;
        }

        .zs-kofi-btn:hover {
          transform: translateY(-1px) scale(1.03);
          filter: brightness(1.0) drop-shadow(0 3px 8px rgba(19, 195, 117, 0.45));
        }

        .zs-kofi-btn:active {
          transform: translateY(0) scale(0.97);
          filter: brightness(0.95);
        }

        .zs-kofi-btn svg {
          height: 36px;
          width: auto;
          display: block;
          pointer-events: none;
        }

        .zs-tab-bar {
          display: flex;
          padding: 0 32px;
          background: #13131a !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07) !important;
          gap: 24px;
          flex-shrink: 0;
        }

        .zs-tab-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          background: transparent;
          border: none;
          border-radius: 0;
          box-shadow: none;
          padding: 10px 4px;
          font-size: 13.5px;
          font-weight: 500;
          color: #71717a;
          cursor: pointer;
          position: relative;
          transition: color 0.15s ease;
          user-select: none;
        }

        .zs-tab-btn:hover {
          color: #d4d4d8;
          background: transparent;
          border: none;
          outline: none;
          box-shadow: none;
        }

        .zs-tab-btn[data-active="true"] {
          color: #ffffff;
          font-weight: 600;
          background: transparent;
          border: none;
          outline: none;
          box-shadow: none;
        }

        .zs-tab-btn[data-active="true"]::after {
          content: "";
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--zen-primary-color, #6366f1);
        }

        .zs-body {
          padding: 22px 32px;
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
          overflow: hidden;
          background: #0d0d12 !important;
        }

        .zs-tab-panel {
          display: none;
          flex-direction: column;
          width: 100%;
          flex: 1 1 auto;
          height: 100%;
          min-height: 0;
        }

        .zs-tab-panel[data-active="true"] {
          display: flex !important;
          animation: zsTabFadeIn 0.18s ease-out;
        }

        .zs-columns {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          align-items: stretch;
          width: 100%;
          height: 100%;
          flex: 1 1 auto;
          min-height: 0;
          overflow: hidden;
        }

        .zs-col {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          min-width: 0;
          box-sizing: border-box;
          overflow: hidden;
        }

        #zs-ag-col {
          padding-right: 24px;
          border-right: 1px solid rgba(255, 255, 255, 0.08);
        }

        #zs-tg-col {
          padding-left: 24px;
          overflow: visible;
        }

        .zs-section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          padding-bottom: 8px;
          margin-bottom: 4px;
          flex-shrink: 0;
          pointer-events: auto;
          position: sticky;
          top: 0;
          background: #0d0d12;
          z-index: 10;
        }

        .zs-section-title {
          font-size: 13px;
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #f4f4f5;
          margin: 0;
        }

        .zs-header-toggle {
          display: flex;
          align-items: center;
          gap: 10px;
          pointer-events: auto;
        }

        .zs-toggle-status {
          font-size: 12px;
          font-weight: 500;
          color: #a1a1aa;
          user-select: none;
        }

        .zs-section-content {
          display: flex;
          flex-direction: column;
          gap: 14px;
          flex: 1 1 auto;
          min-height: 0;
          padding-top: 8px;
          padding-right: 4px;
          overflow-y: auto;
          overflow-x: hidden;
          transition: opacity 0.2s ease, filter 0.2s ease;
        }

        .zs-section-content > * {
          flex-shrink: 0;
        }

        .zs-section-content::-webkit-scrollbar,
        .zs-col::-webkit-scrollbar {
          width: 5px;
        }

        .zs-section-content::-webkit-scrollbar-track,
        .zs-col::-webkit-scrollbar-track {
          background: transparent;
        }

        .zs-section-content::-webkit-scrollbar-thumb,
        .zs-col::-webkit-scrollbar-thumb {
          background: #3f3f46;
          border-radius: 9999px;
        }

        .zs-section-content::-webkit-scrollbar-thumb:hover,
        .zs-col::-webkit-scrollbar-thumb:hover {
          background: #52525b;
        }

        .zs-section-content[data-disabled="true"] {
          opacity: 0.35;
          pointer-events: none;
          filter: grayscale(0.65);
        }

        .zs-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          min-height: 30px;
        }

        .zs-label-container {
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
          min-width: 0;
        }

        .zs-label {
          font-size: 13.5px;
          font-weight: 500;
          color: #ffffff;
        }

        .zs-sublabel {
          font-size: 11.5px;
          color: #a1a1aa;
          margin-top: 2px;
          line-height: 1.35;
        }

        .zs-placement-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .zs-placement-cards {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .zs-placement-btn {
          -moz-appearance: none;
          appearance: none;
          position: relative;
          background: rgba(24, 24, 27, 0.4);
          border: 2px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 12px 10px 10px 10px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
          color: #a1a1aa;
          outline: none;
          user-select: none;
          box-sizing: border-box;
          box-shadow: none;
        }

        .zs-placement-btn * {
          pointer-events: none;
        }

        .zs-placement-btn:hover {
          border-color: rgba(255, 255, 255, 0.22);
          background: rgba(39, 39, 42, 0.4);
          color: #f4f4f5;
          box-shadow: none;
        }

        .zs-placement-btn[data-active="true"] {
          border-color: var(--zen-primary-color, #6366f1);
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 12%, rgba(24, 24, 27, 0.7));
          box-shadow: none;
          color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 85%, #ffffff);
        }

        .zs-placement-btn .zs-placement-svg-box {
          width: 128px;
          height: 64px;
          border-radius: 6px;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          padding: 5px;
          gap: 5px;
          box-sizing: border-box;
        }

        .zs-placement-sidebar-container {
          width: 24px;
          height: 100%;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 3px;
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 2px;
          box-sizing: border-box;
          flex-shrink: 0;
        }

        .zs-placement-appbox-indicator {
          width: 100%;
          height: 15px;
          border-radius: 2px;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-sizing: border-box;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .zs-placement-btn[data-active="true"] .zs-placement-appbox-indicator {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 40%, transparent);
          border-color: var(--zen-primary-color, #6366f1);
        }

        .zs-placement-sidebar-body {
          width: 100%;
          flex: 1 1 auto;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 2px;
        }

        .zs-placement-btn .zs-placement-bar-indicator {
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 3px;
          transition: background 0.15s ease, border-color 0.15s ease;
        }

        .zs-placement-btn[data-active="true"] .zs-placement-bar-indicator {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 40%, transparent);
          border-color: var(--zen-primary-color, #6366f1);
        }

        .zs-placement-btn .zs-placement-content-preview {
          flex: 1 1 auto;
          height: 100%;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 3px;
        }

        .zs-placement-label {
          font-size: 13px;
          font-weight: 500;
          transition: color 0.15s ease, font-weight 0.15s ease;
        }

        .zs-placement-btn[data-active="true"] .zs-placement-label {
          color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 85%, #ffffff);
          font-weight: 700;
        }

        .zs-h-stepper {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 2px;
          height: 32px;
          box-sizing: border-box;
          flex-shrink: 0;
        }

        .zs-h-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          width: 28px;
          height: 28px;
          background: transparent;
          border: none;
          border-radius: 5px;
          color: #a1a1aa;
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.12s ease, color 0.12s ease;
          user-select: none;
          padding: 0;
        }

        .zs-h-btn:hover {
          background: #27272a;
          color: #ffffff;
        }

        .zs-h-btn:active {
          background: var(--zen-primary-color, #6366f1);
          color: #ffffff;
        }

        .zs-h-val {
          width: 32px;
          background: transparent;
          border: none;
          color: #ffffff;
          text-align: center;
          font-size: 13px;
          font-weight: 600;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          outline: none;
          -moz-appearance: textfield;
          appearance: textfield;
          padding: 0;
        }

        .zs-h-val::-webkit-outer-spin-button,
        .zs-h-val::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        .zs-stacked-slider {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
        }

        .zs-stacked-slider-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
        }

        .zs-mono-badge {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          background: #27272a;
          color: #d4d4d8;
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 500;
          letter-spacing: 0.02em;
        }

        .zs-range-slider {
          width: 100%;
          height: 5px;
          border-radius: 9999px;
          background: #27272a;
          outline: none;
          -webkit-appearance: none;
          appearance: none;
          cursor: pointer;
          transition: background-color 0.15s ease;
        }

        .zs-range-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 15px;
          height: 15px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
          cursor: pointer;
          transition: transform 0.12s ease;
        }

        .zs-range-slider::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }

        .zs-matrix-wrapper {
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: rgba(24, 24, 27, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 12px 14px 14px 14px;
          overflow: hidden;
          flex-shrink: 0;
          max-height: 420px;
          opacity: 1;
          transform: translateY(0);
          box-sizing: border-box;
          transition: max-height 0.32s cubic-bezier(0.16, 1, 0.3, 1),
                      opacity 0.22s ease,
                      padding 0.32s cubic-bezier(0.16, 1, 0.3, 1),
                      margin 0.32s cubic-bezier(0.16, 1, 0.3, 1),
                      border-width 0.32s ease,
                      transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .zs-matrix-wrapper[data-hidden="true"] {
          max-height: 0 !important;
          opacity: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          border-width: 0 !important;
          transform: translateY(-8px) !important;
          pointer-events: none !important;
        }

        .zs-matrix-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .zs-matrix-title {
          font-size: 13px;
          font-weight: 600;
          color: #ffffff;
        }

        .zs-matrix-readout {
          font-size: 12px;
          font-weight: 500;
          color: var(--zen-primary-color, #6366f1);
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .zs-matrix-badge {
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 85%, #ffffff);
          padding: 3px 8px;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 600;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }

        .zs-matrix-grid {
          display: grid;
          grid-template-columns: repeat(10, 1fr);
          grid-template-rows: repeat(6, 1fr);
          gap: 6px;
          width: 100%;
          max-width: 100%;
          user-select: none;
          touch-action: none;
          box-sizing: border-box;
          padding: 4px 0 2px 0;
        }

        .zs-matrix-cell {
          aspect-ratio: 1 / 1;
          width: 100%;
          height: auto;
          min-height: 0;
          max-height: none;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.12s ease, border-color 0.12s ease;
          box-shadow: none;
          box-sizing: border-box;
        }

        .zs-matrix-cell:hover,
        .zs-matrix-cell[data-hover="true"] {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 45%, rgba(255,255,255,0.12));
          border-color: var(--zen-primary-color, #6366f1);
          box-shadow: none;
        }

        .zs-matrix-cell[data-selected="true"] {
          background: var(--zen-primary-color, #6366f1);
          border-color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 75%, #ffffff);
          box-shadow: none;
        }

        .zs-matrix-cell[data-selected="true"]:hover,
        .zs-matrix-cell[data-selected="true"][data-hover="true"] {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 80%, #ffffff);
          border-color: #ffffff;
          box-shadow: none;
          filter: none;
          transform: none;
        }

        .zs-anim-preview-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: rgba(24, 24, 27, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 8px 12px;
        }

        .zs-anim-preview-box {
          position: relative;
          height: 56px;
          background: #131316;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          overflow: hidden;
          display: flex;
          align-items: center;
          cursor: pointer;
          user-select: none;
        }

        .zs-anim-preview-sidebar {
          width: 28px;
          height: 100%;
          background: rgba(255, 255, 255, 0.035);
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          flex-shrink: 0;
          z-index: 2;
        }

        .zs-anim-preview-dot {
          width: 12px;
          height: 12px;
          border-radius: 3.5px;
          background: rgba(255, 255, 255, 0.15);
        }

        .zs-anim-preview-panel {
          position: absolute;
          left: 29px;
          top: 5px;
          bottom: 5px;
          width: 0;
          max-width: 140px;
          opacity: 0;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid color-mix(in srgb, var(--zen-primary-color, #6366f1) 40%, rgba(255,255,255,0.1));
          border-radius: 6px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          padding: 5px 8px;
          gap: 3px;
          box-sizing: border-box;
          pointer-events: none;
          transform: translateX(-10px) scale(0.95);
          transition: width var(--zs-preview-anim-duration, 0.45s) var(--zs-preview-anim-curve, cubic-bezier(0.25, 1, 0.5, 1)),
                      opacity var(--zs-preview-anim-duration, 0.45s) var(--zs-preview-anim-curve, cubic-bezier(0.25, 1, 0.5, 1)),
                      transform var(--zs-preview-anim-duration, 0.45s) var(--zs-preview-anim-curve, cubic-bezier(0.25, 1, 0.5, 1));
        }

        .zs-anim-preview-box:hover .zs-anim-preview-panel,
        .zs-anim-preview-box[data-preview-active="true"] .zs-anim-preview-panel {
          width: 125px;
          opacity: 1;
          transform: translateX(0) scale(1);
        }

        .zs-anim-preview-pill {
          height: 5px;
          width: 44px;
          border-radius: 3px;
          background: var(--zen-primary-color, #6366f1);
        }

        .zs-anim-preview-line {
          height: 3.5px;
          border-radius: 2px;
          background: rgba(255, 255, 255, 0.2);
          margin-top: 1px;
        }

        .zs-anim-preview-hint {
          position: absolute;
          right: 12px;
          font-size: 11px;
          color: #71717a;
          pointer-events: none;
          transition: opacity 0.15s ease;
        }

        .zs-anim-preview-box:hover .zs-anim-preview-hint,
        .zs-anim-preview-box[data-preview-active="true"] .zs-anim-preview-hint {
          opacity: 0;
        }

        #zs-panel-diagnostics {
          overflow-y: auto !important;
          overflow-x: hidden !important;
          padding-right: 6px !important;
          scrollbar-width: thin !important;
          scrollbar-color: #3f3f46 transparent !important;
        }

        #zs-panel-diagnostics::-webkit-scrollbar {
          width: 5px;
        }

        #zs-panel-diagnostics::-webkit-scrollbar-track {
          background: transparent;
        }

        #zs-panel-diagnostics::-webkit-scrollbar-thumb {
          background: #3f3f46;
          border-radius: 9999px;
        }

        #zs-panel-diagnostics::-webkit-scrollbar-thumb:hover {
          background: #52525b;
        }

        .zs-custom-select {
          position: relative;
          user-select: none;
        }

        .zs-custom-select-trigger {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          width: 100%;
          height: 36px;
          min-height: 36px;
          max-height: 36px;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          color: #ffffff;
          padding: 0 12px;
          font-size: 13px;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease;
          box-sizing: border-box;
          box-shadow: none;
          white-space: nowrap;
        }

        .zs-custom-select-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1 1 auto;
          text-align: left;
          font-size: 12.5px;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }

        .zs-custom-select-trigger * {
          pointer-events: none;
        }

        .zs-custom-select-trigger:hover {
          background-color: #27272a;
          border-color: rgba(255, 255, 255, 0.22);
        }

        .zs-custom-select[data-open="true"] .zs-custom-select-trigger {
          border-color: var(--zen-primary-color, #6366f1);
        }

        .zs-shortcut-recorder {
          display: inline-flex;
          align-items: center;
          position: relative;
        }

        .zs-shortcut-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          height: 32px;
          min-height: 32px;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: #ffffff;
          padding: 0 14px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.03em;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
          box-sizing: border-box;
          user-select: none;
        }

        .zs-shortcut-btn:hover {
          background: #27272a;
          border-color: rgba(255, 255, 255, 0.22);
        }

        .zs-shortcut-btn[data-recording="true"] {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 22%, #18181b);
          border-color: var(--zen-primary-color, #6366f1);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--zen-primary-color, #6366f1) 35%, transparent);
          color: #ffffff;
        }

        .zs-shortcut-label {
          letter-spacing: 0.03em;
        }

        .zs-custom-select-arrow {
          width: 14px !important;
          height: 14px !important;
          min-width: 14px !important;
          min-height: 14px !important;
          max-width: 14px !important;
          max-height: 14px !important;
          color: rgba(255, 255, 255, 0.65);
          transition: transform 0.18s ease;
          flex-shrink: 0;
          display: block;
        }

        .zs-custom-select[data-open="true"] .zs-custom-select-arrow {
          transform: rotate(180deg);
        }

        .zs-custom-select-menu {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          min-width: 100%;
          width: max-content;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.65);
          padding: 4px;
          z-index: 1000;
          display: none;
          flex-direction: column;
          gap: 2px;
          animation: zsTabFadeIn 0.12s ease-out;
        }

        .zs-custom-select[data-open="true"] .zs-custom-select-menu {
          display: flex;
        }

        .zs-custom-select-option {
          padding: 6px 10px;
          font-size: 12.5px;
          font-weight: 500;
          color: #e4e4e7;
          border-radius: 6px;
          cursor: pointer;
          transition: background-color 0.1s ease, color 0.1s ease;
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .zs-custom-select-option:hover {
          background: #27272a;
          color: #ffffff;
        }

        .zs-custom-select-option[data-selected="true"] {
          background: color-mix(in srgb, var(--zen-primary-color, #6366f1) 18%, rgba(255, 255, 255, 0.05));
          color: color-mix(in srgb, var(--zen-primary-color, #6366f1) 85%, #ffffff);
          font-weight: 600;
        }

        .zs-cat-icon {
          width: 14px !important;
          height: 14px !important;
          min-width: 14px !important;
          min-height: 14px !important;
          color: rgba(255, 255, 255, 0.7);
          flex-shrink: 0;
          display: block;
        }

        .zs-custom-select-option:hover .zs-cat-icon,
        .zs-custom-select-option[data-selected="true"] .zs-cat-icon {
          color: currentColor;
        }

        #zs-tg-content {
          overflow: visible;
        }

        #zs-tg-indicator-type-row {
          overflow: visible;
          min-height: 30px;
          max-height: 48px;
          opacity: 1;
          transform: translateY(0);
          transition: max-height 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      min-height 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      opacity 0.20s ease,
                      margin 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      padding 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        }

        #zs-tg-indicator-type-row[data-hidden="true"] {
          min-height: 0 !important;
          height: 0 !important;
          max-height: 0 !important;
          opacity: 0 !important;
          overflow: hidden !important;
          margin-top: -14px !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
          transform: translateY(-6px) !important;
          pointer-events: none !important;
          visibility: hidden !important;
        }

        #zs-utility-section-row {
          transition: max-height 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      min-height 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      opacity 0.20s ease,
                      margin 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      padding 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                      transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
        }

        #zs-utility-section-row[data-hidden="true"] {
          min-height: 0 !important;
          height: 0 !important;
          max-height: 0 !important;
          opacity: 0 !important;
          overflow: hidden !important;
          margin-top: -14px !important;
          margin-bottom: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
          transform: translateY(-6px) !important;
          pointer-events: none !important;
          visibility: hidden !important;
        }

        .zs-switch {
          position: relative;
          display: inline-block;
          width: 36px;
          height: 20px;
          flex-shrink: 0;
          pointer-events: auto;
        }

        .zs-switch input {
          opacity: 0;
          width: 0;
          height: 0;
          pointer-events: auto;
        }

        .zs-slider {
          position: absolute;
          cursor: pointer;
          inset: 0;
          background-color: #3f3f46;
          transition: background-color 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
          border-radius: 9999px;
        }

        .zs-slider:before {
          position: absolute;
          content: "";
          height: 16px;
          width: 16px;
          left: 2px;
          bottom: 2px;
          background-color: #ffffff;
          transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
          border-radius: 50%;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
        }

        .zs-switch input:checked + .zs-slider {
          background-color: var(--zen-primary-color, #6366f1);
        }

        .zs-switch input:checked + .zs-slider:before {
          transform: translateX(16px);
        }

        .zs-switch input:disabled + .zs-slider {
          opacity: 0.55 !important;
          cursor: not-allowed !important;
        }

        .zs-modules-subgroup {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.025);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 10px;
          margin-top: -4px;
          margin-bottom: 2px;
          transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        .zs-modules-subgroup[data-hidden="true"] {
          display: none !important;
        }

        .zs-section-disabled {
          opacity: 0.45 !important;
          pointer-events: none !important;
        }

        .zs-text-input {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          width: 100%;
          height: 36px;
          min-height: 36px;
          max-height: 36px;
          background: #141417;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          color: #f4f4f5;
          font-family: inherit;
          font-size: 13px;
          padding: 0 12px;
          box-sizing: border-box;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }

        .zs-textarea-input {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          width: 100%;
          background: #141417;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          color: #f4f4f5;
          font-family: inherit;
          font-size: 13px;
          padding: 8px 12px;
          box-sizing: border-box;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
          resize: vertical;
          min-height: 76px;
        }

        .zs-text-input:focus,
        .zs-textarea-input:focus {
          background: #18181b;
          border-color: var(--zen-primary-color, #6366f1);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--zen-primary-color, #6366f1) 25%, transparent);
        }

        .zs-text-input::placeholder,
        .zs-textarea-input::placeholder {
          color: rgba(255, 255, 255, 0.35);
        }

        .zs-reset-btn {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          align-self: flex-start;
          background: #18181b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #d4d4d8;
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
          margin-top: auto;
        }

        .zs-reset-btn:hover {
          background: #27272a;
          color: #ffffff;
          border-color: rgba(255, 255, 255, 0.2);
        }

        .zs-reset-btn:active {
          transform: scale(0.98);
        }

        .zs-footer {
          padding: 16px 32px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          background: #13131a;
          flex-shrink: 0;
        }

        .zs-btn-cancel {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          background: transparent;
          border: none;
          color: #a1a1aa;
          padding: 8px 18px;
          border-radius: 8px;
          font-size: 13.5px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .zs-btn-cancel:hover {
          background: #27272a;
          color: #ffffff;
        }

        .zs-btn-cancel:active {
          transform: scale(0.98);
        }

        .zs-btn-save {
          -moz-appearance: none;
          appearance: none;
          outline: none;
          background: var(--zen-primary-color, #6366f1);
          border: none;
          color: #ffffff;
          padding: 8px 22px;
          border-radius: 8px;
          font-size: 13.5px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: none;
          transition: filter 0.15s ease, transform 0.15s ease;
        }

        .zs-btn-save:hover {
          filter: brightness(1.1);
          transform: translateY(-1px);
          box-shadow: none;
        }

        .zs-btn-save:active {
          transform: scale(0.98);
        }
      `;
      try {
        const style = document.createElement("style");
        style.id = "zentral-settings-styles";
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
      } catch (e) {
        console.error("[Zentral] Error injecting settings styles:", e);
      }
    }

    /**
     * Configures a custom dropdown select component with glitch-free option selection.
     * @param {string} dropdownId - Element ID of .zs-custom-select
     * @param {string} hiddenInputId - Element ID of associated hidden input
     * @param {Function} [onSelectCallback] - Optional callback when value changes
     */
    setupCustomSelect(dropdownId, hiddenInputId, onSelectCallback) {
      if (!this.modal) return;
      const dropdown = this.modal.querySelector("#" + dropdownId);
      const hiddenInput = this.modal.querySelector("#" + hiddenInputId);
      if (!dropdown || !hiddenInput) return;

      const trigger = dropdown.querySelector(".zs-custom-select-trigger");
      const label = dropdown.querySelector(".zs-custom-select-label");
      const options = dropdown.querySelectorAll(".zs-custom-select-option");

      const syncUI = (val) => {
        hiddenInput.value = val;
        options.forEach((opt) => {
          const isSelected = opt.dataset.value === val;
          opt.setAttribute("data-selected", isSelected ? "true" : "false");
          if (isSelected && label) {
            label.innerHTML = opt.innerHTML;
          }
        });
      };

      if (trigger) {
        trigger.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isOpen = dropdown.getAttribute("data-open") === "true";
          this.modal.querySelectorAll(".zs-custom-select").forEach((d) => {
            if (d !== dropdown) d.removeAttribute("data-open");
          });
          if (isOpen) {
            dropdown.removeAttribute("data-open");
          } else {
            dropdown.setAttribute("data-open", "true");
          }
        });
      }

      options.forEach((opt) => {
        opt.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const val = opt.dataset.value;
          syncUI(val);
          dropdown.removeAttribute("data-open");
          if (typeof onSelectCallback === "function") {
            onSelectCallback(val);
          }
        });
      });

      dropdown.syncValue = syncUI;
    }

    /**
     * Configures an interactive shortcut recorder button.
     * Click to record, press key combination, Escape to cancel, Backspace/Delete to clear to "None".
     * @param {string} buttonId - Button ID (e.g. "zs-insta-peek-btn")
     * @param {string} hiddenInputId - Hidden input ID (e.g. "zs-insta-peek-shortcut")
     * @param {Function} [onChangeCallback] - Optional callback
     */
    setupShortcutRecorder(buttonId, hiddenInputId, onChangeCallback) {
      if (!this.modal) return;
      const btn = this.modal.querySelector("#" + buttonId);
      const input = this.modal.querySelector("#" + hiddenInputId);
      if (!btn || !input) return;

      const label = btn.querySelector(".zs-shortcut-label") || btn;
      let isRecording = false;

      const stopRecording = () => {
        if (!isRecording) return;
        isRecording = false;
        window.removeEventListener("keydown", onKeyDown, true);
        btn.removeAttribute("data-recording");
        label.textContent = input.value;
      };
      this._stopShortcutRecordings.add(stopRecording);

      const syncUI = (val) => {
        stopRecording();
        const displayVal = !val || val === "None" ? "None" : val;
        input.value = displayVal;
        label.textContent = displayVal;
        btn.setAttribute("data-value", displayVal);
      };

      btn.syncValue = syncUI;

      const onKeyDown = (e) => {
        if (!isRecording) return;
        e.preventDefault();
        e.stopPropagation();

        if (e.key === "Escape") {
          syncUI(input.value);
          return;
        }

        if (e.key === "Backspace" || e.key === "Delete") {
          syncUI("None");
          if (typeof onChangeCallback === "function") onChangeCallback("None");
          return;
        }

        if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
          return;
        }

        const parts = [];
        if (e.ctrlKey) parts.push("Ctrl");
        if (e.altKey) parts.push("Alt");
        if (e.shiftKey) parts.push("Shift");
        if (e.metaKey) parts.push("Meta");

        let key = e.key;
        if (key === " " || key === "Spacebar") key = "Space";
        else if (key.length === 1) key = key.toUpperCase();
        else if (key.startsWith("Arrow")) key = key.replace("Arrow", "");

        parts.push(key);
        const combo = parts.join("+");

        syncUI(combo);
        if (typeof onChangeCallback === "function") onChangeCallback(combo);
      };

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isRecording) {
          syncUI(input.value);
          return;
        }
        isRecording = true;
        btn.setAttribute("data-recording", "true");
        label.textContent = "Press keys...";
        window.addEventListener("keydown", onKeyDown, true);
      });

      this.modal.addEventListener("mousedown", (e) => {
        if (isRecording && !e.target.closest("#" + buttonId)) {
          syncUI(input.value);
        }
      });
    }

    createModal() {
      this.injectStyles();
      this.modal = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      );
      this.modal.id = "zentral-settings-modal";
      this.modal.setAttribute("data-open", "true");

      const content = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      );
      content.className = "zs-dialog";

      // Generate 60 matrix cells (6 rows x 10 cols)
      let matrixCellsHtml = "";
      for (let r = 1; r <= 6; r++) {
        for (let c = 1; c <= 10; c++) {
          matrixCellsHtml += `<div class="zs-matrix-cell" data-row="${r}" data-col="${c}" title="Row ${r}, Col ${c}"></div>`;
        }
      }

      const htmlStr = `
        <div class="zs-header">
          <div class="zs-title-group">
            <h2 class="zs-title">Zentral Settings</h2>
            <span class="zs-version-badge">v1.0.2</span>
          </div>
          <div class="zs-header-actions">
            <button id="zs-kofi-btn" class="zs-kofi-btn" title="Support Zentral on Ko-fi (ko-fi.com/michele501st)">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 198" width="980" height="198">
<path d="M52.23 0.07C343.95 0.07 635.67 0.07 927.39 0.07C929.8 1.58 938.6 2.68 942.29 4.17C951.73 8 960.32 14.31 966.75 22.31C971.83 28.62 974.95 35.6 977.74 43.09C978.6 45.42 978.15 50.6 979.93 52.22C979.93 83.32 979.93 114.42 979.93 145.52C978.54 147.33 977.11 156.96 975.83 160.15C972.6 168.2 967.42 175.92 960.93 181.79C954.74 187.39 947.47 192.05 939.58 194.68C937.55 195.36 928.58 196.8 927.76 197.78C636.05 197.78 344.33 197.78 52.61 197.78C50.21 196.27 41.39 195.16 37.71 193.68C28.27 189.87 19.68 183.52 13.25 175.53C8.16 169.21 5.09 162.25 2.27 154.76C1.39 152.42 1.86 147.26 0.07 145.63C0.07 114.53 0.07 83.43 0.07 52.33C1.33 50.79 2.96 40.7 4.16 37.7C7.41 29.62 12.59 21.97 19.07 16.06C25.22 10.45 32.54 5.78 40.42 3.17C42.49 2.48 51.35 1.09 52.23 0.07ZM99.63 52.07C90.1 52.45 79.02 52.59 71.38 59.1C61.37 67.62 59.71 78.89 60.06 91.49C60.49 107.14 63.55 121.88 74.39 133.71C86.54 146.97 108.29 149.22 124.84 144.73C134.47 142.11 142.92 135.63 148.75 127.62C150.64 125.03 151.57 121.59 153.54 119.16C154.81 117.59 157.65 117.45 159.41 116.61C163.09 114.85 166.74 112.44 169.47 109.35C181.3 95.98 181.64 71.54 166.3 60.3C151.26 49.28 118.05 51.33 99.63 52.07ZM882.94 71.26C875.78 73.51 880.78 84.17 887.6 80.7C893.59 77.65 889 69.37 882.94 71.26ZM873.26 71.78C868.21 70.38 860.38 71.55 858.07 76.96C856.65 80.29 857.39 83.67 856.75 87.11C855.12 87.11 853.5 87.11 851.88 87.11C851.88 89.5 851.88 91.9 851.88 94.3C853.58 94.5 855.28 94.71 856.99 94.91C856.99 104.57 856.99 114.22 856.99 123.87C859.87 123.87 862.75 123.87 865.63 123.87C865.89 114.12 866.14 104.37 866.4 94.62C868.95 94.62 871.49 94.62 874.04 94.62C874.04 92.24 874.04 89.85 874.04 87.46C871.36 87.2 868.68 86.93 866 86.67C864.63 78.77 867.41 79.83 873.26 78.62C873.26 76.34 873.26 74.06 873.26 71.78ZM246.71 86.72C248.13 69.44 218.73 66.79 213.28 81.54C208.58 94.23 220.41 98.49 229.43 101.77C233.25 103.16 238.45 104.73 238.92 109.58C239.61 116.6 230.88 119.05 225.49 116.53C222.17 114.97 221.14 111.98 220.56 108.67C217.61 108.67 214.67 108.67 211.72 108.67C209.82 113.11 214.48 118.91 217.89 121.32C225.61 126.78 240.4 126.57 245.87 117.79C247.12 115.78 247.94 113.56 248.11 111.19C248.86 100.83 240.95 97.21 232.6 94.14C229.41 92.97 222.94 91.94 222.06 87.85C220.63 81.16 227.61 77.43 233.31 80.18C236.11 81.54 236.68 84.2 237.86 86.72C240.81 86.72 243.76 86.72 246.71 86.72ZM739.73 72.9C736.84 72.9 733.95 72.9 731.06 72.9C731.06 89.9 731.06 106.89 731.06 123.88C733.95 123.88 736.84 123.88 739.73 123.88C740.83 118.34 738.37 110.35 740.08 105.27C740.68 103.49 743.25 101.68 744.55 100.37C746.74 101.6 748.03 104.92 749.3 107.05C752.68 112.72 756.21 118.34 759.8 123.88C763.16 123.88 766.53 123.88 769.9 123.88C763.7 113.75 757.49 103.62 751.29 93.5C757.35 86.79 763.41 80.09 769.48 73.39C768.01 72.6 766.31 72.86 764.66 72.86C763.02 72.86 760.77 72.46 759.2 72.99C757.53 73.56 755.97 76.47 754.73 77.72C751.17 81.29 744.15 91.1 740.38 93.09C740.16 86.36 739.94 79.63 739.73 72.9ZM464.26 77.47C463.73 80.68 463.19 83.9 462.65 87.11C460.73 87.11 458.81 87.11 456.88 87.11C456.88 89.62 456.88 92.12 456.88 94.63C458.81 94.63 460.73 94.63 462.65 94.63C465.49 105.76 456.92 123.85 475.52 123.92C477.55 123.93 479.73 124.18 481.67 123.54C481.67 121.3 481.67 119.06 481.67 116.82C479.08 115.96 475.64 117.21 473.28 115.64C471.64 114.54 471.87 112.1 471.85 110.39C471.81 106.46 470.82 97.95 472.31 94.63C475.46 94.63 478.62 94.63 481.78 94.63C481.78 92.21 481.78 89.79 481.78 87.36C478.46 87.13 475.15 86.89 471.83 86.66C471.83 83.6 471.83 80.53 471.83 77.47C469.31 77.47 466.79 77.47 464.26 77.47ZM109.58 83.59C111.65 81.98 113.2 79.83 115.83 79.03C124.26 76.46 132.45 82.84 132.81 91.49C133.21 100.89 125.39 108.4 118.28 113.26C115.86 114.92 112.72 117.77 109.59 117.7C106.6 117.63 103.33 114.83 100.96 113.18C93.21 107.8 84.12 98.38 87.22 87.88C89.31 80.82 97.25 76.32 104.32 79.23C106.5 80.13 107.94 81.99 109.58 83.59ZM306.34 119.96C309.64 121.15 311.73 123.92 315.48 124.66C327.15 126.94 336.01 116.81 336.18 105.96C336.43 89.97 318.78 78.71 306.63 91.78C306.16 90.24 305.69 88.7 305.22 87.16C302.7 87.16 300.19 87.16 297.67 87.16C297.67 104.72 297.67 122.28 297.67 139.83C300.56 139.83 303.45 139.83 306.34 139.83C306.34 133.21 306.34 126.59 306.34 119.96ZM352.47 119.36C363.54 132.59 381.86 121.09 382.01 105.96C382.14 93.78 371.42 82.74 358.74 87.09C356.05 88.01 354.53 90.15 352.45 91.89C351.92 90.31 351.39 88.73 350.86 87.15C348.29 87.15 345.72 87.15 343.15 87.15C343.15 104.72 343.15 122.28 343.15 139.85C346.02 139.85 348.88 139.85 351.75 139.85C351.99 133.02 352.23 126.19 352.47 119.36ZM404.44 86.24C380.34 88.64 383.22 127.39 408.37 124.77C432.12 122.29 428.84 83.81 404.44 86.24ZM453.48 86.26C447.7 86.06 444.47 89.58 440.54 93C440.18 91.05 439.83 89.1 439.48 87.15C436.93 87.15 434.38 87.15 431.83 87.15C431.83 99.39 431.83 111.63 431.83 123.87C434.62 123.87 437.41 123.87 440.2 123.87C441.79 117.04 437.46 101.35 444.44 97.2C447.32 95.48 450.46 95.95 453.63 95.51C454.58 93.38 454.67 88.26 453.48 86.26ZM536.65 92.12C534.39 90.85 533.07 88.51 530.55 87.3C524.11 84.23 518.61 87.52 513.73 91.27C513.37 89.89 513.01 88.52 512.65 87.14C510.08 87.14 507.5 87.14 504.93 87.14C504.93 99.39 504.93 111.63 504.93 123.88C507.82 123.88 510.71 123.88 513.59 123.88C515.51 115.77 508.78 93.52 522.57 93.81C533.83 94.05 528.92 116.57 530.04 123.88C532.71 123.88 535.38 123.88 538.06 123.88C540.18 115.77 533.32 93.44 547.51 93.81C552.53 93.94 554.07 98 554.5 102.34C555.18 109.22 553.2 117.22 554.94 123.88C557.62 123.88 560.29 123.88 562.96 123.88C563.91 117.71 564.16 99.37 561.78 93.91C558.88 87.26 549.99 84.31 543.41 87.16C540.68 88.34 538.9 90.27 536.65 92.12ZM605.72 107.57C606.68 104.79 606.21 101.02 605.27 98.29C600.14 83.3 577.05 81.82 571.22 97.27C567.51 107.11 570.84 119.94 581.37 123.74C589.35 126.61 604.09 123.23 604.82 112.86C602.07 112.86 599.32 112.86 596.57 112.86C595.22 114.13 594.27 115.75 592.55 116.65C585.76 120.22 579.67 114.79 578.56 108.38C580.56 107.09 584.16 107.77 586.51 107.77C592.68 107.77 599.67 108.66 605.72 107.57ZM644.52 86.24C620.22 89.23 623.59 127.49 648.44 124.76C672.47 122.12 668.61 83.28 644.52 86.24ZM706.41 123.87C707.75 117.7 707.48 98.81 704.81 93.2C700.13 83.34 686.42 84.84 680.61 92.48C680.24 90.7 679.87 88.93 679.5 87.15C676.97 87.15 674.45 87.15 671.92 87.15C671.92 99.39 671.92 111.63 671.92 123.87C674.75 123.87 677.57 123.87 680.4 123.87C682.93 115.57 675.21 93.81 689.86 93.79C702.32 93.77 697.04 115.83 698.1 123.87C700.87 123.87 703.64 123.87 706.41 123.87ZM788.47 86.24C764.15 88.39 766.48 126.79 791.6 124.79C815.39 122.9 812.75 84.08 788.47 86.24ZM262.79 87.13C260.12 87.13 257.46 87.13 254.79 87.13C253.55 93.05 253.65 112.64 256.21 117.96C260.83 127.52 275.01 126.56 280.49 118.55C280.89 120.32 281.29 122.09 281.69 123.86C284.19 123.86 286.68 123.86 289.18 123.86C289.18 111.62 289.18 99.38 289.18 87.15C286.38 87.15 283.58 87.15 280.78 87.15C279.01 95.44 285.31 118.16 270.84 117.37C258.03 116.67 265.18 95.13 262.79 87.13ZM889.17 87.15C886.28 87.15 883.38 87.15 880.48 87.15C880.48 99.39 880.48 111.63 880.48 123.87C883.38 123.87 886.28 123.87 889.17 123.87C889.17 111.63 889.17 99.39 889.17 87.15ZM596.97 101.96C590.94 101.96 584.9 101.96 578.87 101.96C578.94 90.92 598.15 90.83 596.97 101.96ZM646.45 93.89C659.12 93.85 659.14 117.11 646.43 117.17C633.49 117.22 633.55 93.93 646.45 93.89ZM313.93 94.21C327.68 90.5 332.64 112.99 319.98 116.75C305.7 120.99 300.71 97.77 313.93 94.21ZM359.76 94.19C373.47 90.26 378.43 113.34 365.58 116.82C351.29 120.69 346.59 97.97 359.76 94.19ZM403.63 94.22C416.45 89.88 420.57 113.57 409.02 116.83C395.6 120.62 392.1 98.12 403.63 94.22ZM787.26 94.21C800.28 90.24 804.07 113.69 792.63 116.82C779.16 120.51 775.49 97.8 787.26 94.21ZM846.05 98.85C836.04 98.85 826.03 98.85 816.02 98.85C816.02 101.23 816.02 103.61 816.02 105.99C826.03 105.99 836.04 105.99 846.05 105.99C846.05 103.61 846.05 101.23 846.05 98.85Z" fill="#13C375" fill-rule="evenodd" stroke="#13C375" stroke-width="0.25" stroke-linejoin="round"/>
<path d="M148.19 112.25C142.26 130.73 127.03 139.07 108.38 139.06C99.29 139.06 90.65 137.16 83.27 131.65C71.25 122.68 68.31 107.54 67.67 93.5C67.34 86.16 66.91 78.46 70.33 71.74C75.33 61.93 85.53 60.28 95.51 59.87C110.1 59.27 124.75 59.21 139.34 59.86C146.62 60.18 154.42 60.94 160.52 65.29C172.95 74.14 173.9 93.8 163.63 104.71C159.19 109.44 153.79 109.98 148.19 112.25ZM141.36 104.35C146.26 102.43 149.54 104.69 155.21 100.72C164.04 94.55 165.15 78.44 155.66 72.16C149.19 67.87 140.36 68.11 132.91 67.95C120.54 67.69 107.85 67.25 95.51 68.11C88.55 68.6 80.39 69.42 77.2 76.61C75.02 81.52 75.86 87.85 75.99 93.09C76.25 103.35 78.05 116.26 86.24 123.48C97.72 133.58 119.98 134.05 131.45 123.61C137.15 118.41 139.57 111.6 141.36 104.35ZM882.94 71.26C889 69.37 893.59 77.65 887.6 80.7C880.78 84.17 875.78 73.51 882.94 71.26ZM873.26 71.78C873.26 74.06 873.26 76.34 873.26 78.62C867.41 79.83 864.63 78.77 866 86.67C868.68 86.93 871.36 87.2 874.04 87.46C874.04 89.85 874.04 92.24 874.04 94.62C871.49 94.62 868.95 94.62 866.4 94.62C866.14 104.37 865.89 114.12 865.63 123.87C862.75 123.87 859.87 123.87 856.99 123.87C856.99 114.22 856.99 104.57 856.99 94.91C855.28 94.71 853.58 94.5 851.88 94.3C851.88 91.9 851.88 89.5 851.88 87.11C853.5 87.11 855.12 87.11 856.75 87.11C857.39 83.67 856.65 80.29 858.07 76.96C860.38 71.55 868.21 70.38 873.26 71.78ZM246.71 86.72C243.76 86.72 240.81 86.72 237.86 86.72C236.68 84.2 236.11 81.54 233.31 80.18C227.61 77.43 220.63 81.16 222.06 87.85C222.94 91.94 229.41 92.97 232.6 94.14C240.95 97.21 248.86 100.83 248.11 111.19C247.94 113.56 247.12 115.78 245.87 117.79C240.4 126.57 225.61 126.78 217.89 121.32C214.48 118.91 209.82 113.11 211.72 108.67C214.67 108.67 217.61 108.67 220.56 108.67C221.14 111.98 222.17 114.97 225.49 116.53C230.88 119.05 239.61 116.6 238.92 109.58C238.45 104.73 233.25 103.16 229.43 101.77C220.41 98.49 208.58 94.23 213.28 81.54C218.73 66.79 248.13 69.44 246.71 86.72ZM739.73 72.9C739.94 79.63 740.16 86.36 740.38 93.09C744.15 91.1 751.17 81.29 754.73 77.72C755.97 76.47 757.53 73.56 759.2 72.99C760.77 72.46 763.02 72.86 764.66 72.86C766.31 72.86 768.01 72.6 769.48 73.39C763.41 80.09 757.35 86.79 751.29 93.5C757.49 103.62 763.7 113.75 769.9 123.88C766.53 123.88 763.16 123.88 759.8 123.88C756.21 118.34 752.68 112.72 749.3 107.05C748.03 104.92 746.74 101.6 744.55 100.37C743.25 101.68 740.68 103.49 740.08 105.27C738.37 110.35 740.83 118.34 739.73 123.88C736.84 123.88 733.95 123.88 731.06 123.88C731.06 106.89 731.06 89.9 731.06 72.9C733.95 72.9 736.84 72.9 739.73 72.9ZM142.2 78.22C151.66 74.79 157.77 89.14 149.42 93.75C141.5 98.13 141.49 91.94 141.49 86.26C141.49 83.61 141.07 80.67 142.2 78.22ZM464.26 77.47C466.79 77.47 469.31 77.47 471.83 77.47C471.83 80.53 471.83 83.6 471.83 86.66C475.15 86.89 478.46 87.13 481.78 87.36C481.78 89.79 481.78 92.21 481.78 94.63C478.62 94.63 475.46 94.63 472.31 94.63C470.82 97.95 471.81 106.46 471.85 110.39C471.87 112.1 471.64 114.54 473.28 115.64C475.64 117.21 479.08 115.96 481.67 116.82C481.67 119.06 481.67 121.3 481.67 123.54C479.73 124.18 477.55 123.93 475.52 123.92C456.92 123.85 465.49 105.76 462.65 94.63C460.73 94.63 458.81 94.63 456.88 94.63C456.88 92.12 456.88 89.62 456.88 87.11C458.81 87.11 460.73 87.11 462.65 87.11C463.19 83.9 463.73 80.68 464.26 77.47ZM306.34 119.96C306.34 126.59 306.34 133.21 306.34 139.83C303.45 139.83 300.56 139.83 297.67 139.83C297.67 122.28 297.67 104.72 297.67 87.16C300.19 87.16 302.7 87.16 305.22 87.16C305.69 88.7 306.16 90.24 306.63 91.78C318.78 78.71 336.43 89.97 336.18 105.96C336.01 116.81 327.15 126.94 315.48 124.66C311.73 123.92 309.64 121.15 306.34 119.96ZM352.47 119.36C352.23 126.19 351.99 133.02 351.75 139.85C348.88 139.85 346.02 139.85 343.15 139.85C343.15 122.28 343.15 104.72 343.15 87.15C345.72 87.15 348.29 87.15 350.86 87.15C351.39 88.73 351.92 90.31 352.45 91.89C354.53 90.15 356.05 88.01 358.74 87.09C371.42 82.74 382.14 93.78 382.01 105.96C381.86 121.09 363.54 132.59 352.47 119.36ZM404.44 86.24C428.84 83.81 432.12 122.29 408.37 124.77C383.22 127.39 380.34 88.64 404.44 86.24ZM453.48 86.26C454.67 88.26 454.58 93.38 453.63 95.51C450.46 95.95 447.32 95.48 444.44 97.2C437.46 101.35 441.79 117.04 440.2 123.87C437.41 123.87 434.62 123.87 431.83 123.87C431.83 111.63 431.83 99.39 431.83 87.15C434.38 87.15 436.93 87.15 439.48 87.15C439.83 89.1 440.18 91.05 440.54 93C444.47 89.58 447.7 86.06 453.48 86.26ZM536.65 92.12C538.9 90.27 540.68 88.34 543.41 87.16C549.99 84.31 558.88 87.26 561.78 93.91C564.16 99.37 563.91 117.71 562.96 123.88C560.29 123.88 557.62 123.88 554.94 123.88C553.2 117.22 555.18 109.22 554.5 102.34C554.07 98 552.53 93.94 547.51 93.81C533.32 93.44 540.18 115.77 538.06 123.88C535.38 123.88 532.71 123.88 530.04 123.88C528.92 116.57 533.83 94.05 522.57 93.81C508.78 93.52 515.51 115.77 513.59 123.88C510.71 123.88 507.82 123.88 504.93 123.88C504.93 111.63 504.93 99.39 504.93 87.14C507.5 87.14 510.08 87.14 512.65 87.14C513.01 88.52 513.37 89.89 513.73 91.27C518.61 87.52 524.11 84.23 530.55 87.3C533.07 88.51 534.39 90.85 536.65 92.12ZM605.72 107.57C599.67 108.66 592.68 107.77 586.51 107.77C584.16 107.77 580.56 107.09 578.56 108.38C579.67 114.79 585.76 120.22 592.55 116.65C594.27 115.75 595.22 114.13 596.57 112.86C599.32 112.86 602.07 112.86 604.82 112.86C604.09 123.23 589.35 126.61 581.37 123.74C570.84 119.94 567.51 107.11 571.22 97.27C577.05 81.82 600.14 83.3 605.27 98.29C606.21 101.02 606.68 104.79 605.72 107.57ZM644.52 86.24C668.61 83.28 672.47 122.12 648.44 124.76C623.59 127.49 620.22 89.23 644.52 86.24ZM706.41 123.87C703.64 123.87 700.87 123.87 698.1 123.87C697.04 115.83 702.32 93.77 689.86 93.79C675.21 93.81 682.93 115.57 680.4 123.87C677.57 123.87 674.75 123.87 671.92 123.87C671.92 111.63 671.92 99.39 671.92 87.15C674.45 87.15 676.97 87.15 679.5 87.15C679.87 88.93 680.24 90.7 680.61 92.48C686.42 84.84 700.13 83.34 704.81 93.2C707.48 98.81 707.75 117.7 706.41 123.87ZM788.47 86.24C812.75 84.08 815.39 122.9 791.6 124.79C766.48 126.79 764.15 88.39 788.47 86.24ZM262.79 87.13C265.18 95.13 258.03 116.67 270.84 117.37C285.31 118.16 279.01 95.44 280.78 87.15C283.58 87.15 286.38 87.15 289.18 87.15C289.18 99.38 289.18 111.62 289.18 123.86C286.68 123.86 284.19 123.86 281.69 123.86C281.29 122.09 280.89 120.32 280.49 118.55C275.01 126.56 260.83 127.52 256.21 117.96C253.65 112.64 253.55 93.05 254.79 87.13C257.46 87.13 260.12 87.13 262.79 87.13ZM889.17 87.15C889.17 99.39 889.17 111.63 889.17 123.87C886.28 123.87 883.38 123.87 880.48 123.87C880.48 111.63 880.48 99.39 880.48 87.15C883.38 87.15 886.28 87.15 889.17 87.15ZM596.97 101.96C598.15 90.83 578.94 90.92 578.87 101.96C584.9 101.96 590.94 101.96 596.97 101.96ZM646.45 93.89C633.55 93.93 633.49 117.22 646.43 117.17C659.14 117.11 659.12 93.85 646.45 93.89ZM313.93 94.21C300.71 97.77 305.7 120.99 319.98 116.75C332.64 112.99 327.68 90.5 313.93 94.21ZM359.76 94.19C346.59 97.97 351.29 120.69 365.58 116.82C378.43 113.34 373.47 90.26 359.76 94.19ZM403.63 94.22C392.1 98.12 395.6 120.62 409.02 116.83C420.57 113.57 416.45 89.88 403.63 94.22ZM787.26 94.21C775.49 97.8 779.16 120.51 792.63 116.82C804.07 113.69 800.28 90.24 787.26 94.21ZM846.05 98.85C846.05 101.23 846.05 103.61 846.05 105.99C836.04 105.99 826.03 105.99 816.02 105.99C816.02 103.61 816.02 101.23 816.02 98.85C826.03 98.85 836.04 98.85 846.05 98.85Z" fill="#252220" fill-rule="evenodd" stroke="#252220" stroke-width="0.25" stroke-linejoin="round"/>
<path d="M99.63 52.07C118.05 51.33 151.26 49.28 166.3 60.3C181.64 71.54 181.3 95.98 169.47 109.35C166.74 112.44 163.09 114.85 159.41 116.61C157.65 117.45 154.81 117.59 153.54 119.16C151.57 121.59 150.64 125.03 148.75 127.62C142.92 135.63 134.47 142.11 124.84 144.73C108.29 149.22 86.54 146.97 74.39 133.71C63.55 121.88 60.49 107.14 60.06 91.49C59.71 78.89 61.37 67.62 71.38 59.1C79.02 52.59 90.1 52.45 99.63 52.07ZM148.19 112.25C153.79 109.98 159.19 109.44 163.63 104.71C173.9 93.8 172.95 74.14 160.52 65.29C154.42 60.94 146.62 60.18 139.34 59.86C124.75 59.21 110.1 59.27 95.51 59.87C85.53 60.28 75.33 61.93 70.33 71.74C66.91 78.46 67.34 86.16 67.67 93.5C68.31 107.54 71.25 122.68 83.27 131.65C90.65 137.16 99.29 139.06 108.38 139.06C127.03 139.07 142.26 130.73 148.19 112.25ZM141.36 104.35C139.57 111.6 137.15 118.41 131.45 123.61C119.98 134.05 97.72 133.58 86.24 123.48C78.05 116.26 76.25 103.35 75.99 93.09C75.86 87.85 75.02 81.52 77.2 76.61C80.39 69.42 88.55 68.6 95.51 68.11C107.85 67.25 120.54 67.69 132.91 67.95C140.36 68.11 149.19 67.87 155.66 72.16C165.15 78.44 164.04 94.55 155.21 100.72C149.54 104.69 146.26 102.43 141.36 104.35ZM142.2 78.22C141.07 80.67 141.49 83.61 141.49 86.26C141.49 91.94 141.5 98.13 149.42 93.75C157.77 89.14 151.66 74.79 142.2 78.22ZM109.58 83.59C107.94 81.99 106.5 80.13 104.32 79.23C97.25 76.32 89.31 80.82 87.22 87.88C84.12 98.38 93.21 107.8 100.96 113.18C103.33 114.83 106.6 117.63 109.59 117.7C112.72 117.77 115.86 114.92 118.28 113.26C125.39 108.4 133.21 100.89 132.81 91.49C132.45 82.84 124.26 76.46 115.83 79.03C113.2 79.83 111.65 81.98 109.58 83.59Z" fill="#fefefe" fill-rule="evenodd" stroke="#fefefe" stroke-width="0.25" stroke-linejoin="round"/>
</svg>
          </button>
            <button id="zs-close" class="zs-close-btn" title="Close Settings">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l12 12M13 1L1 13"/></svg>
            </button>
          </div>
        </div>

        <div class="zs-tab-bar">
          <button type="button" class="zs-tab-btn" data-tab="settings" data-active="true">Settings</button>
          <button type="button" class="zs-tab-btn" data-tab="diagnostics" data-active="false">Diagnostics</button>
        </div>

        <div class="zs-body">
          <!-- Tab Panel 1: Settings (2-Column Open Layout with Vertical Separator) -->
          <div class="zs-tab-panel" id="zs-panel-settings" data-tab="settings" data-active="true">
            <div class="zs-columns">
              <!-- Column 1: Apps -->
              <div class="zs-col" id="zs-ag-col" data-placement="sidebar">
                <div class="zs-section-header">
                  <h3 class="zs-section-title">Apps</h3>
                  <div class="zs-header-toggle">
                    <span id="zs-ag-status" class="zs-toggle-status" data-enabled="true">Enabled</span>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-ag-enabled" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>
                </div>

                <div class="zs-section-content" id="zs-ag-content">
                  <!-- Apps Placement -->
                  <div class="zs-placement-group">
                    <div class="zs-label-container">
                      <span class="zs-label">Apps Placement</span>
                      <span class="zs-sublabel">Choose where the Apps will be located across the interface</span>
                    </div>
                    <input type="hidden" id="zs-ag-placement" value="sidebar" />
                    <div class="zs-placement-cards">
                      <button type="button" class="zs-placement-btn" id="zs-placement-sidebar" data-placement="sidebar" data-active="true" title="Dock Apps Box inside Zen Sidebar">
                        <div class="zs-placement-svg-box">
                          <div class="zs-placement-sidebar-container">
                            <div class="zs-placement-appbox-indicator"></div>
                            <div class="zs-placement-sidebar-body"></div>
                          </div>
                          <div class="zs-placement-content-preview"></div>
                        </div>
                        <span class="zs-placement-label">Sidebar</span>
                      </button>

                      <button type="button" class="zs-placement-btn" id="zs-placement-strip" data-placement="vertical-bar" data-active="false" title="Dock Apps Bar as dedicated strip on opposite edge">
                        <div class="zs-placement-svg-box">
                          <div class="zs-placement-content-preview"></div>
                          <div class="zs-placement-bar-indicator" style="width: 10px; height: 100%;"></div>
                        </div>
                        <span class="zs-placement-label">Apps Bar</span>
                      </button>
                    </div>
                  </div>

                  <!-- 10x6 Selection Matrix (Apps Box) -->
                  <div class="zs-matrix-wrapper" id="zs-matrix-wrapper">
                    <div class="zs-matrix-header">
                      <div class="zs-label-container">
                        <span class="zs-matrix-title">Apps Box</span>
                        <span class="zs-sublabel">Choose how many rows of Apps to show and how many Apps per rows</span>
                      </div>
                      <div class="zs-matrix-readout">
                        <span id="zs-matrix-dims">7 Columns × 3 Rows</span>
                        <span id="zs-matrix-total-badge" class="zs-matrix-badge">21 Visible Apps</span>
                      </div>
                    </div>
                    <input type="hidden" id="zs-apps-row" value="7" />
                    <input type="hidden" id="zs-max-rows" value="3" />
                    <div class="zs-matrix-grid" id="zs-matrix-grid">
                      ${matrixCellsHtml}
                    </div>
                  </div>

                  <!-- Hide Utility Section Toggle -->
                  <div class="zs-row" id="zs-utility-section-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Hide Utility Section</span>
                      <span class="zs-sublabel">Permanently hide the utility bar from the App Box</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-hide-utility-section" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <!-- Apps Number Cap -->
                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Apps Number Cap</span>
                      <span class="zs-sublabel">Maximum number of apps you can pin</span>
                    </div>
                    <div class="zs-h-stepper">
                      <button type="button" class="zs-h-btn zs-h-dec" data-target="zs-max-apps" data-step="-1">−</button>
                      <input type="number" id="zs-max-apps" class="zs-h-val" min="1" max="100" step="1" />
                      <button type="button" class="zs-h-btn zs-h-inc" data-target="zs-max-apps" data-step="1">+</button>
                    </div>
                  </div>

                  <!-- Insta-Peek Shortcut -->
                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Insta-Peek</span>
                      <span class="zs-sublabel">Hold shortcut to temporarily hide open panel and peek underneath</span>
                    </div>
                    <div class="zs-shortcut-recorder" id="zs-insta-peek-recorder">
                      <button type="button" class="zs-shortcut-btn" id="zs-insta-peek-btn" title="Click to record shortcut, Backspace to clear, Escape to cancel">
                        <span class="zs-shortcut-label" id="zs-insta-peek-label">Alt+Q</span>
                      </button>
                      <input type="hidden" id="zs-insta-peek-shortcut" value="Alt+Q" />
                    </div>
                  </div>

                  <!-- Panel Animation (Glitch-Free Custom Dropdown) -->
                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Panel Animation</span>
                      <span class="zs-sublabel">Opening/closing apps panel easing</span>
                    </div>
                    <div class="zs-custom-select" id="zs-anim-type-dropdown" data-value="slide">
                      <button type="button" class="zs-custom-select-trigger" id="zs-anim-type-trigger">
                        <span class="zs-custom-select-label">Smooth Slide</span>
                        <svg class="zs-custom-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                      </button>
                      <div class="zs-custom-select-menu" id="zs-anim-type-menu">
                        <div class="zs-custom-select-option" data-value="slide">Smooth Slide</div>
                        <div class="zs-custom-select-option" data-value="spring-snappy">Snappy Spring</div>
                        <div class="zs-custom-select-option" data-value="spring-gentle">Gentle Spring</div>
                        <div class="zs-custom-select-option" data-value="spring-bouncy">Bouncy Spring</div>
                        <div class="zs-custom-select-option" data-value="elastic">Elastic</div>
                        <div class="zs-custom-select-option" data-value="none">Instant</div>
                      </div>
                      <input type="hidden" id="zs-anim-type" value="slide" />
                    </div>
                  </div>

                  <!-- Animation Speed -->
                  <div class="zs-stacked-slider">
                    <div class="zs-stacked-slider-header">
                      <div class="zs-label-container">
                        <span class="zs-label">Animation Speed</span>
                        <span class="zs-sublabel">Adjust panel animation duration</span>
                      </div>
                      <span id="zs-anim-speed-badge" class="zs-mono-badge">450 ms</span>
                    </div>
                    <input type="range" id="zs-anim-speed-slider" class="zs-range-slider" min="0" max="2000" step="25" />
                    <input type="hidden" id="zs-anim-speed" value="450" />
                  </div>

                  <!-- Animation Preview Demo -->
                  <div class="zs-anim-preview-group">
                    <div class="zs-label-container">
                      <span class="zs-label">Animation Preview</span>
                      <span class="zs-sublabel">Hover or click below to test opening/closing speed and easing curve</span>
                    </div>
                    <div class="zs-anim-preview-box" id="zs-anim-preview-box">
                      <div class="zs-anim-preview-sidebar">
                        <div class="zs-anim-preview-dot"></div>
                        <div class="zs-anim-preview-dot"></div>
                        <div class="zs-anim-preview-dot"></div>
                      </div>
                      <div class="zs-anim-preview-panel" id="zs-anim-preview-panel">
                        <div class="zs-anim-preview-pill"></div>
                        <div class="zs-anim-preview-line" style="width: 85%;"></div>
                        <div class="zs-anim-preview-line" style="width: 65%;"></div>
                        <div class="zs-anim-preview-line" style="width: 75%;"></div>
                      </div>
                      <span class="zs-anim-preview-hint">Hover or click to preview</span>
                    </div>
                  </div>

                  <button id="zs-ag-reset" class="zs-reset-btn">Reset Apps Defaults</button>
                </div>
              </div>

              <!-- Column 2: Tab Groups -->
              <div class="zs-col" id="zs-tg-col">
                <div class="zs-section-header">
                  <h3 class="zs-section-title">Tab Groups</h3>
                  <div class="zs-header-toggle">
                    <span id="zs-tg-status" class="zs-toggle-status" data-enabled="true">Enabled</span>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-tg-enabled" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>
                </div>

                <div class="zs-section-content" id="zs-tg-content">
                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Close Groups at Startup</span>
                      <span class="zs-sublabel">Automatically fold groups when launching</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-tg-collapse" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Group Thumbnails</span>
                      <span class="zs-sublabel">Interactive thumbnails on hover</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-tg-thumbnails" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <div class="zs-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Group Indicator</span>
                      <span class="zs-sublabel">Show open/close indicator next to name</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-tg-chevron" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <div class="zs-row" id="zs-tg-indicator-type-row">
                    <div class="zs-label-container">
                      <span class="zs-label">Indicator Type</span>
                      <span class="zs-sublabel">Choose the style of the indicator</span>
                    </div>
                    <div class="zs-custom-select" id="zs-tg-indicator-type-dropdown" data-value="circle">
                      <button type="button" class="zs-custom-select-trigger" id="zs-tg-indicator-type-trigger">
                        <span class="zs-custom-select-label">Circle</span>
                        <svg class="zs-custom-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                      </button>
                      <div class="zs-custom-select-menu" id="zs-tg-indicator-type-menu">
                        <div class="zs-custom-select-option" data-value="circle">Circle</div>
                        <div class="zs-custom-select-option" data-value="chevron">Chevron</div>
                      </div>
                      <input type="hidden" id="zs-tg-indicator-type" value="circle" />
                    </div>
                  </div>

                  <div class="zs-stacked-slider">
                    <div class="zs-stacked-slider-header">
                      <div class="zs-label-container">
                        <span class="zs-label">Group Labels Opacity</span>
                        <span class="zs-sublabel">Adjust label pill transparency</span>
                      </div>
                      <span id="zs-tg-opacity-badge" class="zs-mono-badge">85%</span>
                    </div>
                    <input type="range" id="zs-tg-opacity" class="zs-range-slider" min="10" max="100" step="5" />
                  </div>

                  <button id="zs-tg-reset" class="zs-reset-btn">Reset Tab Groups Defaults</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Tab Panel 2: Diagnostics -->
          <div class="zs-tab-panel" id="zs-panel-diagnostics" data-tab="diagnostics" data-active="false">
            <div class="zs-section-header">
              <h3 class="zs-section-title">Diagnostic Logging</h3>
            </div>
            <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 14px;">
              <div class="zs-row">
                <div class="zs-label-container">
                  <span class="zs-label">Enable Diagnostic Logging</span>
                  <span class="zs-sublabel">Starts Zentral Logger in the background to capture internal layout events</span>
                </div>
                <label class="zs-switch">
                  <input type="checkbox" id="zs-pref-logger-enabled" />
                  <span class="zs-slider"></span>
                </label>
              </div>

              <!-- Options Sub-Section (Controlled by master toggle) -->
              <div id="zs-logger-options-section" style="display: flex; flex-direction: column; gap: 16px; transition: opacity 0.2s ease;">
                
                <!-- Full Log Toggle -->
                <div class="zs-row">
                  <div class="zs-label-container">
                    <span class="zs-label">Capture Full Diagnostic Log</span>
                    <span class="zs-sublabel">Records all diagnostic modules and events simultaneously</span>
                  </div>
                  <label class="zs-switch">
                    <input type="checkbox" id="zs-pref-logger-full" />
                    <span class="zs-slider"></span>
                  </label>
                </div>

                <!-- Modular Selections Container (Revealed when Full Log is unchecked) -->
                <div id="zs-logger-modules-container" class="zs-modules-subgroup" data-hidden="true">
                  <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(255,255,255,0.45); margin-bottom: 2px;">
                    Active Log Modules
                  </div>

                  <!-- 1. Core & Gecko Errors (Always On, Disabled) -->
                  <div class="zs-row" style="padding: 2px 0;">
                    <div class="zs-label-container">
                      <span class="zs-label" style="font-size: 13px;">Core Engine & Gecko Errors</span>
                      <span class="zs-sublabel" style="font-size: 11.5px;">Uncaught script exceptions and Gecko console errors (Always Active)</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-pref-logger-core" checked disabled />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <!-- 2. Tab Groups & Drag-and-Drop -->
                  <div class="zs-row" style="padding: 2px 0;">
                    <div class="zs-label-container">
                      <span class="zs-label" style="font-size: 13px;">Tab Groups & Drag-and-Drop</span>
                      <span class="zs-sublabel" style="font-size: 11.5px;">Tab groups lifecycle, split view actions, and drag interactions</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-pref-logger-tabs" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <!-- 3. Apps Sidebar & Panels -->
                  <div class="zs-row" style="padding: 2px 0;">
                    <div class="zs-label-container">
                      <span class="zs-label" style="font-size: 13px;">Apps Sidebar & Panels</span>
                      <span class="zs-sublabel" style="font-size: 11.5px;">Apps grid DOM modifications and panel open/pin events</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-pref-logger-apps" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <!-- 4. Context Menus & Popups -->
                  <div class="zs-row" style="padding: 2px 0;">
                    <div class="zs-label-container">
                      <span class="zs-label" style="font-size: 13px;">Context Menus & Popups</span>
                      <span class="zs-sublabel" style="font-size: 11.5px;">Right-click coordinates, popup showing/shown events, and menu item commands</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-pref-logger-menus" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>

                  <!-- 5. Layout Inspector Snapshot -->
                  <div class="zs-row" style="padding: 2px 0;">
                    <div class="zs-label-container">
                      <span class="zs-label" style="font-size: 13px;">Layout Inspector & CSS Snapshot</span>
                      <span class="zs-sublabel" style="font-size: 11.5px;">Computed styles, CSS variables, and element bounding boxes dump</span>
                    </div>
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-pref-logger-layout" />
                      <span class="zs-slider"></span>
                    </label>
                  </div>
                </div>

                <div class="zs-row">
                  <div class="zs-label-container">
                    <span class="zs-label">Export Log Path</span>
                    <span class="zs-sublabel" id="zs-pref-logger-path-desc">Directory where diagnostic logs are saved</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px; max-width: 55%;">
                    <input type="hidden" id="zs-pref-logger-path" />
                    <button type="button" id="zs-btn-choose-path" class="zs-reset-btn" style="margin: 0; padding: 6px 12px; font-size: 12px; background: #18181b; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: inherit; max-width: 240px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; cursor: pointer; display: flex; align-items: center; gap: 6px;" title="Click to choose export directory">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
                      <span id="zs-btn-choose-path-label">Default Folder</span>
                    </button>
                    <button type="button" id="zs-btn-clear-path" title="Reset to default folder (chrome/logs)" style="background: #18181b; border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.7); cursor: pointer; padding: 6px 10px; display: none; align-items: center; justify-content: center; font-size: 11px; border-radius: 6px;">✕</button>
                  </div>
                </div>

                <div class="zs-row">
                  <div class="zs-label-container">
                    <span class="zs-label">Capture Log</span>
                    <span class="zs-sublabel">Generate and save a diagnostic log file instantly. (Shortcut: <kbd style="background: #27272a; border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; padding: 1px 5px; font-size: 11px;">Alt</kbd>+<kbd style="background: #27272a; border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; padding: 1px 5px; font-size: 11px;">L</kbd>)</span>
                  </div>
                  <button id="zs-btn-capture-log" class="zs-btn-save" style="margin: 0; padding: 6px 18px; font-size: 12.5px;">Export</button>
                </div>
              </div>

              <!-- Report an Issue Section -->
              <div class="zs-section-header" style="margin-top: 20px;">
                <h3 class="zs-section-title">Report an Issue</h3>
              </div>
              <div id="zs-issue-report-card" class="zs-card" style="display: flex; flex-direction: column; gap: 14px; margin-top: 4px; padding: 16px; background: rgba(255, 255, 255, 0.025); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px;">
                
                <!-- Title & Category Row -->
                <div style="display: flex; gap: 12px; align-items: flex-start;">
                  <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
                    <label class="zs-label" for="zs-report-title" style="font-size: 12.5px;">Issue Title</label>
                    <input type="text" id="zs-report-title" class="zs-text-input" placeholder="Brief summary of the issue..." style="width: 100%;" />
                  </div>
                  <div style="width: 260px; min-width: 240px; display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;">
                    <label class="zs-label" style="font-size: 12.5px;">Category</label>
                    <div class="zs-custom-select" id="zs-report-category-dropdown" data-name="report-category" style="width: 100%;">
                      <button type="button" class="zs-custom-select-trigger" aria-haspopup="listbox" aria-expanded="false" style="width: 100%;">
                        <span class="zs-custom-select-label">
                          <svg class="zs-cat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>
                          <span>Bug / Malfunction</span>
                        </span>
                        <svg class="zs-custom-select-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; min-width: 14px; min-height: 14px; flex-shrink: 0;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                      </button>
                      <div class="zs-custom-select-menu" role="listbox">
                        <div class="zs-custom-select-option" role="option" data-value="bug" data-selected="true">
                          <svg class="zs-cat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>
                          <span>Bug / Malfunction</span>
                        </div>
                        <div class="zs-custom-select-option" role="option" data-value="layout">
                          <svg class="zs-cat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                          <span>Layout / Visual Alignment</span>
                        </div>
                        <div class="zs-custom-select-option" role="option" data-value="performance">
                          <svg class="zs-cat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                          <span>Performance / Lag</span>
                        </div>
                        <div class="zs-custom-select-option" role="option" data-value="enhancement">
                          <svg class="zs-cat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
                          <span>Feature Request / Feedback</span>
                        </div>
                      </div>
                    </div>
                    <input type="hidden" id="zs-report-category" value="bug" />
                  </div>
                </div>

                <!-- Description Field -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  <label class="zs-label" for="zs-report-description" style="font-size: 12.5px;">Description & Steps to Reproduce</label>
                  <textarea id="zs-report-description" class="zs-textarea-input" rows="4" placeholder="Describe what happened, expected behavior, and steps to reproduce..." style="width: 100%; resize: vertical; min-height: 80px;"></textarea>
                </div>

                <!-- Attach Log Toggle Row & Submit Action -->
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 4px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.06);">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <label class="zs-switch">
                      <input type="checkbox" id="zs-report-attach-log" checked />
                      <span class="zs-slider"></span>
                    </label>
                    <div style="display: flex; flex-direction: column;">
                      <span class="zs-label" style="font-size: 12.5px;">Attach Diagnostic Log</span>
                      <span class="zs-sublabel" style="font-size: 11px;">Includes active modules & layout snapshot</span>
                    </div>
                  </div>

                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span id="zs-report-status" style="font-size: 12px; font-weight: 500; display: none;"></span>
                    <button type="button" id="zs-btn-submit-report" class="zs-btn-save" style="margin: 0; padding: 7px 20px; font-size: 12.5px; display: flex; align-items: center; gap: 6px;">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                      <span>Submit Report</span>
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>

        <div class="zs-footer">
          <button id="zs-cancel" class="zs-btn-cancel">Cancel</button>
          <button id="zs-save" class="zs-btn-save">Save Changes</button>
        </div>
      `;

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlStr, "text/html");
      while (doc.body.firstChild) {
        content.appendChild(doc.body.firstChild);
      }

      this.modal.appendChild(content);
      const container =
        document.getElementById("browser") ||
        document.body ||
        document.documentElement;
      container.appendChild(this.modal);

      // Tab Switching Logic
      const tabBtns = this.modal.querySelectorAll(".zs-tab-btn");
      const tabPanels = this.modal.querySelectorAll(".zs-tab-panel");
      tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const targetTab = btn.dataset.tab;
          tabBtns.forEach((b) =>
            b.setAttribute("data-active", b === btn ? "true" : "false"),
          );
          tabPanels.forEach((p) =>
            p.setAttribute(
              "data-active",
              p.dataset.tab === targetTab ? "true" : "false",
            ),
          );
        });
      });

      this.modal
        .querySelector("#zs-kofi-btn")
        ?.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.close();
          const kofiUrl = "https://ko-fi.com/michele501st";
          if (window.gBrowser?.addTab) {
            const newTab = window.gBrowser.addTab(kofiUrl, {
              triggeringPrincipal:
                Services.scriptSecurityManager.getSystemPrincipal(),
              inBackground: false,
            });
            if (newTab) {
              window.gBrowser.selectedTab = newTab;
            }
          } else {
            window.open(kofiUrl, "_blank");
          }
        });

      this.modal
        .querySelector("#zs-close")
        .addEventListener("click", () => this.close());
      this.modal
        .querySelector("#zs-cancel")
        .addEventListener("click", () => this.close());
      this.modal
        .querySelector("#zs-save")
        .addEventListener("click", () => this.save());

      // Close open custom selects when clicking anywhere else
      this.modal.addEventListener("click", (e) => {
        if (!e.target.closest(".zs-custom-select")) {
          this.modal
            .querySelectorAll(".zs-custom-select")
            .forEach((d) => d.removeAttribute("data-open"));
        }
      });

      // Header Enable/Disable toggle sync (only disables section content, never lock out the toggle itself)
      const agToggle = this.modal.querySelector("#zs-ag-enabled");
      const agStatus = this.modal.querySelector("#zs-ag-status");
      const agContent = this.modal.querySelector("#zs-ag-content");
      if (agToggle) {
        agToggle.addEventListener("change", () => {
          const isEnabled = agToggle.checked;
          if (agStatus) {
            agStatus.textContent = isEnabled ? "Enabled" : "Disabled";
            agStatus.setAttribute("data-enabled", isEnabled ? "true" : "false");
          }
          if (agContent)
            agContent.setAttribute(
              "data-disabled",
              !isEnabled ? "true" : "false",
            );
        });
      }

      const tgToggle = this.modal.querySelector("#zs-tg-enabled");
      const tgStatus = this.modal.querySelector("#zs-tg-status");
      const tgContent = this.modal.querySelector("#zs-tg-content");
      if (tgToggle) {
        tgToggle.addEventListener("change", () => {
          const isEnabled = tgToggle.checked;
          if (tgStatus) {
            tgStatus.textContent = isEnabled ? "Enabled" : "Disabled";
            tgStatus.setAttribute("data-enabled", isEnabled ? "true" : "false");
          }
          if (tgContent)
            tgContent.setAttribute(
              "data-disabled",
              !isEnabled ? "true" : "false",
            );
        });
      }

      // Placement Visual Cards selection + Conditional matrix smooth slide visibility + Scrollable Apps Column
      const placementBtns = this.modal.querySelectorAll(".zs-placement-btn");
      const placementInput = this.modal.querySelector("#zs-ag-placement");
      const matrixWrapper = this.modal.querySelector("#zs-matrix-wrapper");
      const agCol = this.modal.querySelector("#zs-ag-col");

      placementBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const placement = btn.dataset.placement;
          if (placementInput) placementInput.value = placement;
          placementBtns.forEach((b) =>
            b.setAttribute("data-active", b === btn ? "true" : "false"),
          );
          if (agCol) agCol.setAttribute("data-placement", placement);
          if (matrixWrapper) {
            if (placement === "sidebar") {
              matrixWrapper.removeAttribute("data-hidden");
            } else {
              matrixWrapper.setAttribute("data-hidden", "true");
              if (agCol) agCol.scrollTop = 0;
            }
          }
          const utilityRow = this.modal.querySelector(
            "#zs-utility-section-row",
          );
          if (utilityRow) {
            if (placement === "sidebar") {
              utilityRow.removeAttribute("data-hidden");
            } else {
              utilityRow.setAttribute("data-hidden", "true");
            }
          }
        });
      });

      // Horizontal Stepper (+ / -)
      this.modal.querySelectorAll(".zs-h-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          const targetId = btn.dataset.target;
          const step = parseInt(btn.dataset.step, 10) || 1;
          const input = this.modal.querySelector("#" + targetId);
          if (input) {
            const min = input.min !== "" ? parseInt(input.min, 10) : 1;
            const max = input.max !== "" ? parseInt(input.max, 10) : 100;
            let current = parseInt(input.value, 10);
            if (isNaN(current)) current = 21;
            let nextVal = current + step;
            if (nextVal < min) nextVal = min;
            if (nextVal > max) nextVal = max;
            input.value = nextVal;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
      });

      // 10x6 Selection Matrix Mouse Handlers
      let isDraggingMatrix = false;
      const matrixGrid = this.modal.querySelector("#zs-matrix-grid");
      const matrixCells = this.modal.querySelectorAll(".zs-matrix-cell");

      matrixCells.forEach((cell) => {
        cell.addEventListener("mousedown", (e) => {
          e.preventDefault();
          isDraggingMatrix = true;
          const c = parseInt(cell.dataset.col, 10);
          const r = parseInt(cell.dataset.row, 10);
          this.updateMatrixUI(c, r);
        });

        cell.addEventListener("mouseenter", () => {
          const c = parseInt(cell.dataset.col, 10);
          const r = parseInt(cell.dataset.row, 10);
          if (isDraggingMatrix) {
            this.updateMatrixUI(c, r);
          } else {
            matrixCells.forEach((other) => {
              const oc = parseInt(other.dataset.col, 10);
              const or = parseInt(other.dataset.row, 10);
              other.setAttribute(
                "data-hover",
                oc <= c && or <= r ? "true" : "false",
              );
            });
          }
        });
      });

      if (matrixGrid) {
        matrixGrid.addEventListener("mouseleave", () => {
          matrixCells.forEach((c) => c.removeAttribute("data-hover"));
        });
      }

      this._matrixMouseUpHandler = () => {
        if (isDraggingMatrix) isDraggingMatrix = false;
      };
      window.addEventListener("mouseup", this._matrixMouseUpHandler);

      // Animation Type and Speed Sync + Preview Demo
      const animSpeedSlider = this.modal.querySelector("#zs-anim-speed-slider");
      const animSpeedInput = this.modal.querySelector("#zs-anim-speed");
      const animSpeedBadge = this.modal.querySelector("#zs-anim-speed-badge");
      const animPreviewBox = this.modal.querySelector("#zs-anim-preview-box");
      const animTypeDropdown = this.modal.querySelector(
        "#zs-anim-type-dropdown",
      );

      let previewPulseTimeout = null;
      if (animPreviewBox) {
        animPreviewBox.addEventListener("click", () => {
          animPreviewBox.setAttribute("data-preview-active", "true");
          if (previewPulseTimeout) clearTimeout(previewPulseTimeout);
          const speed =
            parseInt(animSpeedInput ? animSpeedInput.value : "450", 10) || 450;
          previewPulseTimeout = setTimeout(
            () => {
              if (animPreviewBox)
                animPreviewBox.removeAttribute("data-preview-active");
            },
            Math.max(speed + 500, 1000),
          );
        });
      }

      const onAnimChange = (typeVal) => {
        const hiddenInput = this.modal.querySelector("#zs-anim-type");
        const type = typeVal || (hiddenInput ? hiddenInput.value : "slide");
        let speed = parseInt(animSpeedInput ? animSpeedInput.value : "450", 10);
        if (isNaN(speed)) speed = 0;

        if (speed <= 0 && type !== "none") {
          if (animTypeDropdown && animTypeDropdown.syncValue)
            animTypeDropdown.syncValue("none");
        }
        if (animSpeedBadge) animSpeedBadge.textContent = `${speed} ms`;
        this.updatePreviewDemo(type, speed);
      };

      this.setupCustomSelect(
        "zs-anim-type-dropdown",
        "zs-anim-type",
        (selectedType) => {
          if (selectedType === "none") {
            if (animSpeedInput) animSpeedInput.value = 0;
            if (animSpeedSlider) animSpeedSlider.value = 0;
          } else {
            const currentSpeed = parseInt(
              animSpeedInput ? animSpeedInput.value : "0",
              10,
            );
            if (currentSpeed === 0) {
              if (animSpeedInput) animSpeedInput.value = 450;
              if (animSpeedSlider) animSpeedSlider.value = 450;
            }
          }
          onAnimChange(selectedType);
        },
      );

      this.setupShortcutRecorder("zs-insta-peek-btn", "zs-insta-peek-shortcut");
      this.setupCustomSelect(
        "zs-tg-indicator-type-dropdown",
        "zs-tg-indicator-type",
      );

      if (animSpeedSlider) {
        animSpeedSlider.addEventListener("input", (e) => {
          const val = parseInt(e.target.value, 10) || 0;
          if (animSpeedInput) animSpeedInput.value = val;
          const currentTypeInput = this.modal.querySelector("#zs-anim-type");
          const currentType = currentTypeInput
            ? currentTypeInput.value
            : "slide";
          if (val === 0 && animTypeDropdown && animTypeDropdown.syncValue) {
            animTypeDropdown.syncValue("none");
          } else if (
            val > 0 &&
            currentType === "none" &&
            animTypeDropdown &&
            animTypeDropdown.syncValue
          ) {
            animTypeDropdown.syncValue("slide");
          }
          onAnimChange();
        });
      }

      if (animSpeedInput) {
        animSpeedInput.addEventListener("input", (e) => {
          let val = parseInt(e.target.value, 10);
          if (isNaN(val)) val = 0;
          if (val < 0) val = 0;
          if (val > 2000) val = 2000;
          if (animSpeedSlider) animSpeedSlider.value = val;
          const currentTypeInput = this.modal.querySelector("#zs-anim-type");
          const currentType = currentTypeInput
            ? currentTypeInput.value
            : "slide";
          if (val === 0 && animTypeDropdown && animTypeDropdown.syncValue) {
            animTypeDropdown.syncValue("none");
          } else if (
            val > 0 &&
            currentType === "none" &&
            animTypeDropdown &&
            animTypeDropdown.syncValue
          ) {
            animTypeDropdown.syncValue("slide");
          }
          onAnimChange();
        });
      }

      // Group Indicator toggle -> smoothly slides/shows Indicator Type row
      const chevronToggle = this.modal.querySelector("#zs-tg-chevron");
      const indicatorTypeRow = this.modal.querySelector(
        "#zs-tg-indicator-type-row",
      );
      if (chevronToggle && indicatorTypeRow) {
        chevronToggle.addEventListener("change", () => {
          if (chevronToggle.checked) {
            indicatorTypeRow.removeAttribute("data-hidden");
          } else {
            indicatorTypeRow.setAttribute("data-hidden", "true");
          }
        });
      }

      // Tab Groups Opacity Slider Live Sync
      const opacitySlider = this.modal.querySelector("#zs-tg-opacity");
      const opacityBadge = this.modal.querySelector("#zs-tg-opacity-badge");
      if (opacitySlider) {
        opacitySlider.addEventListener("input", (e) => {
          const val = parseInt(e.target.value, 10) || 85;
          if (opacityBadge) opacityBadge.textContent = `${val}%`;
          document.documentElement.style.setProperty(
            "--zentral-tabgroup-label-opacity",
            (val / 100).toFixed(2),
          );
          document.documentElement.setAttribute(
            "zentral-label-opacity-below-85",
            val < 85 ? "true" : "false",
          );
        });
      }

      // Helper to auto-save all diagnostics options immediately on change
      const saveDiagnosticsPrefsImmediately = () => {
        if (loggerMasterToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_ENABLED,
            loggerMasterToggle.checked,
          );
          Core.setPref(Constants.Diagnostics.PREF_LOGGER_CORE, true);
        }
        if (loggerFullToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_FULL,
            loggerFullToggle.checked,
          );
        }
        if (tabsToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_TABS,
            tabsToggle.checked,
          );
        }
        if (appsToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_APPS,
            appsToggle.checked,
          );
        }
        if (menusToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_MENUS,
            menusToggle.checked,
          );
        }
        if (layoutToggle) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_LAYOUT,
            layoutToggle.checked,
          );
        }
        if (pathInput) {
          Core.setPref(
            Constants.Diagnostics.PREF_LOGGER_PATH,
            (pathInput.value || "").trim(),
          );
        }
      };

      // Diagnostic Logging Master Toggle
      const loggerMasterToggle = this.modal.querySelector(
        "#zs-pref-logger-enabled",
      );
      if (loggerMasterToggle) {
        loggerMasterToggle.addEventListener("change", () => {
          this.updateLoggerUIState();
          saveDiagnosticsPrefsImmediately();
        });
      }

      // Diagnostic Logging Full Log Toggle & Modular Sub-Selections
      const loggerFullToggle = this.modal.querySelector("#zs-pref-logger-full");
      const tabsToggle = this.modal.querySelector("#zs-pref-logger-tabs");
      const appsToggle = this.modal.querySelector("#zs-pref-logger-apps");
      const menusToggle = this.modal.querySelector("#zs-pref-logger-menus");
      const layoutToggle = this.modal.querySelector("#zs-pref-logger-layout");

      if (loggerFullToggle) {
        loggerFullToggle.addEventListener("change", () => {
          if (!loggerFullToggle.checked) {
            // When unchecking Full Log, reveal modules with optional ones unchecked by default
            if (tabsToggle) tabsToggle.checked = false;
            if (appsToggle) appsToggle.checked = false;
            if (menusToggle) menusToggle.checked = false;
            if (layoutToggle) layoutToggle.checked = false;
          }
          this.updateLoggerUIState();
          saveDiagnosticsPrefsImmediately();
        });
      }

      const optionalModuleToggles = [
        tabsToggle,
        appsToggle,
        menusToggle,
        layoutToggle,
      ].filter(Boolean);
      optionalModuleToggles.forEach((toggle) => {
        toggle.addEventListener("change", () => {
          const allChecked = optionalModuleToggles.every((t) => t.checked);
          if (allChecked && loggerFullToggle) {
            // If all optional modules get individually checked, switch back to Full Log mode
            loggerFullToggle.checked = true;
            this.updateLoggerUIState();
          }
          saveDiagnosticsPrefsImmediately();
        });
      });

      const choosePathBtn = this.modal.querySelector("#zs-btn-choose-path");
      const clearPathBtn = this.modal.querySelector("#zs-btn-clear-path");
      const pathInput = this.modal.querySelector("#zs-pref-logger-path");

      if (choosePathBtn) {
        choosePathBtn.addEventListener("click", async () => {
          const selectedFolder = await this.pickExportFolder();
          if (selectedFolder) {
            pathInput.value = selectedFolder;
            this.updatePathUI(selectedFolder);
            saveDiagnosticsPrefsImmediately();
          }
        });
      }

      if (clearPathBtn) {
        clearPathBtn.addEventListener("click", () => {
          pathInput.value = "";
          this.updatePathUI("");
          saveDiagnosticsPrefsImmediately();
        });
      }

      const captureBtn = this.modal.querySelector("#zs-btn-capture-log");
      if (captureBtn) {
        captureBtn.addEventListener("click", () => {
          saveDiagnosticsPrefsImmediately();
          const loggerToggle = this.modal.querySelector(
            "#zs-pref-logger-enabled",
          );
          const isEnabled = loggerToggle
            ? loggerToggle.checked
            : Core.getPref(Constants.Diagnostics.PREF_LOGGER_ENABLED, false);

          if (!isEnabled) {
            captureBtn.textContent = "⚠️ Logging Disabled";
            captureBtn.style.background = "#ef4444";
            captureBtn.style.color = "#ffffff";
            captureBtn.style.pointerEvents = "none";

            try {
              const promptService =
                Services.prompt ||
                Cc["@mozilla.org/embedcomp/prompt-service;1"]?.getService(
                  Ci.nsIPromptService,
                );
              if (promptService) {
                promptService.alert(
                  window,
                  "Zentral Diagnostics — Inactive",
                  "Diagnostic Logging is currently disabled.\n\nPlease toggle 'Enable Diagnostic Logging' ON above and save changes before exporting logs.",
                );
              }
            } catch (_) {}

            setTimeout(() => {
              if (this.modal && captureBtn) {
                captureBtn.textContent = "Export";
                captureBtn.style.background = "var(--zen-primary-color)";
                captureBtn.style.pointerEvents = "auto";
              }
            }, 2500);
            return;
          }

          if (pathInput && pathInput.value) {
            Core.setPref(
              Constants.Diagnostics.PREF_LOGGER_PATH,
              pathInput.value.trim(),
            );
          }
          window.dispatchEvent(new CustomEvent("ZentralCaptureLog"));

          const originalText = "Export";
          const originalBg = "var(--zen-primary-color)";
          captureBtn.textContent = "✓ Exported!";
          captureBtn.style.background = "#10b981";
          captureBtn.style.color = "#ffffff";
          captureBtn.style.pointerEvents = "none";

          setTimeout(() => {
            if (this.modal && captureBtn) {
              captureBtn.textContent = originalText;
              captureBtn.style.background = originalBg;
              captureBtn.style.pointerEvents = "auto";
            }
          }, 2200);
        });
      }

      // -----------------------------------------------------------------------
      // Issue Report Submission Engine
      // -----------------------------------------------------------------------
      this.setupCustomSelect(
        "zs-report-category-dropdown",
        "zs-report-category",
      );

      const submitReportBtn = this.modal.querySelector("#zs-btn-submit-report");
      const titleInput = this.modal.querySelector("#zs-report-title");
      const categoryInput = this.modal.querySelector("#zs-report-category");
      const descInput = this.modal.querySelector("#zs-report-description");
      const attachLogCheckbox = this.modal.querySelector(
        "#zs-report-attach-log",
      );
      const statusEl = this.modal.querySelector("#zs-report-status");

      if (submitReportBtn && titleInput && descInput) {
        submitReportBtn.addEventListener("click", async () => {
          saveDiagnosticsPrefsImmediately();
          const title = titleInput.value.trim();
          const desc = descInput.value.trim();
          const category = categoryInput ? categoryInput.value : "bug";
          const attachLogs = attachLogCheckbox
            ? attachLogCheckbox.checked
            : true;

          if (!title) {
            titleInput.focus();
            titleInput.style.borderColor = "#ef4444";
            setTimeout(() => {
              if (titleInput) titleInput.style.borderColor = "";
            }, 2000);
            return;
          }
          if (!desc) {
            descInput.focus();
            descInput.style.borderColor = "#ef4444";
            setTimeout(() => {
              if (descInput) descInput.style.borderColor = "";
            }, 2000);
            return;
          }

          // Visual loading state
          submitReportBtn.disabled = true;
          submitReportBtn.style.opacity = "0.7";
          submitReportBtn.style.pointerEvents = "none";
          const origBtnHTML = submitReportBtn.innerHTML;
          submitReportBtn.innerHTML = `<span>Submitting...</span>`;

          if (statusEl) {
            statusEl.style.display = "inline";
            statusEl.style.color = "rgba(255, 255, 255, 0.6)";
            statusEl.textContent = "Connecting to GitHub...";
          }

          // 1. Gather diagnostic logs & system metadata
          let logContent = "";
          if (attachLogs) {
            if (window.ZentralLogger?.generateLogString) {
              logContent = window.ZentralLogger.generateLogString();
            } else if (window.ZentralLogger?.entries) {
              logContent = window.ZentralLogger.entries.join("\n");
            }
          }

          // Safety guard: GitHub limits issue bodies to 65,536 characters.
          // Truncate logs if necessary, preserving the initial snapshot & most recent trace events.
          let sendLogContent = logContent;
          if (sendLogContent && sendLogContent.length > 50000) {
            const head = sendLogContent.slice(0, 12000);
            const tail = sendLogContent.slice(-36000);
            sendLogContent = `${head}\n\n... [Log truncated: Preserved initial system snapshot & most recent events to fit GitHub's 65,536-character limit] ...\n\n${tail}`;
          }

          const systemInfo = {
            zentralVersion: "v1.0.2",
            zenVersion: navigator.userAgent,
            platform: navigator.platform || "Desktop",
            windowSize: `${window.innerWidth}x${window.innerHeight}`,
            dpr: window.devicePixelRatio || 1,
            sidebarMode:
              document.documentElement.getAttribute("zen-sidebar-expanded") ===
              "true"
                ? "Expanded"
                : "Compact",
          };

          // 2. Attempt background submission to Cloudflare Worker endpoint if configured
          const endpointPref = Core.getPref(
            Constants.Diagnostics.PREF_REPORT_ENDPOINT,
          );
          let endpoint = null;
          try {
            const candidate = new URL(endpointPref);
            if (candidate.protocol === "https:") endpoint = candidate.href;
          } catch (_) {}
          let submitted = false;

          if (endpoint) {
            try {
              const resp = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title,
                  description: desc,
                  category,
                  systemInfo,
                  logs: sendLogContent,
                }),
              });

              const result = resp.status === 204 ? {} : await resp.json();
              if (resp.ok && result?.success) {
                submitted = true;
                if (statusEl) {
                  statusEl.style.display = "inline";
                  statusEl.style.color = "#10b981";
                  statusEl.replaceChildren();
                  const issueUrl = new URL(String(result.issueUrl || ""));
                  if (
                    issueUrl.protocol === "https:" &&
                    issueUrl.hostname === "github.com"
                  ) {
                    const link = document.createElement("a");
                    link.href = issueUrl.href;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.style.cssText =
                      "color: #10b981; text-decoration: underline";
                    link.textContent = `✓ Issue #${String(result.issueNumber).slice(0, 30)} created!`;
                    statusEl.appendChild(link);
                  } else {
                    statusEl.textContent =
                      "Issue created; open GitHub to view it.";
                  }
                }
                titleInput.value = "";
                descInput.value = "";
              } else {
                console.warn(
                  "[Zentral-Report] Worker returned error:",
                  resp.status,
                  result,
                );
              }
            } catch (postErr) {
              console.warn(
                "[Zentral-Report] Worker submission failed, falling back to Web:",
                postErr,
              );
            }
          }

          // 3. Fallback: If not submitted via worker, open pre-filled GitHub issue in new tab & copy logs to clipboard
          if (!submitted) {
            if (logContent) {
              try {
                const clipboardHelper = Cc[
                  "@mozilla.org/widget/clipboardhelper;1"
                ]?.getService(Ci.nsIClipboardHelper);
                if (clipboardHelper) {
                  clipboardHelper.copyString(sendLogContent);
                } else if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(sendLogContent);
                }
              } catch (_) {}
            }

            let ghBody = `### 📝 Description\n${desc}\n\n`;
            ghBody += `### 🖥️ Environment\n`;
            ghBody += `- **Zentral Version:** ${systemInfo.zentralVersion}\n`;
            ghBody += `- **Zen Build:** ${systemInfo.zenVersion}\n`;
            ghBody += `- **OS / Platform:** ${systemInfo.platform}\n`;
            ghBody += `- **Window / DPR:** ${systemInfo.windowSize} (DPR: ${systemInfo.dpr})\n\n`;
            if (logContent) {
              ghBody += `*(Diagnostic log copied to your clipboard — paste below if relevant)*\n\n`;
            }

            const ghUrl = `https://github.com/Michele501st/Zentral-Sine/issues/new?title=${encodeURIComponent(`[${category.toUpperCase()}] ${title}`)}&body=${encodeURIComponent(ghBody)}&labels=${encodeURIComponent(category)}`;

            if (window.gBrowser?.addTab) {
              window.gBrowser.addTab(ghUrl, {
                triggeringPrincipal:
                  Services.scriptSecurityManager.getSystemPrincipal(),
              });
            } else {
              window.open(ghUrl, "_blank");
            }

            if (statusEl) {
              statusEl.style.display = "inline";
              statusEl.style.color = "#60a5fa";
              statusEl.textContent = logContent
                ? "✓ Opened in GitHub (Log copied to clipboard!)"
                : "✓ Opened in GitHub!";
            }
          }

          submitReportBtn.disabled = false;
          submitReportBtn.style.opacity = "1";
          submitReportBtn.style.pointerEvents = "auto";
          submitReportBtn.innerHTML = origBtnHTML;
        });
      }

      this.modal.addEventListener("mousedown", (e) => {
        if (e.target === this.modal) this.close();
      });

      this.modal.querySelector("#zs-ag-reset").addEventListener("click", () => {
        const get = (id) => this.modal.querySelector("#" + id);
        get("zs-ag-enabled").checked = true;
        if (agStatus) {
          agStatus.textContent = "Enabled";
          agStatus.setAttribute("data-enabled", "true");
        }
        if (agContent) agContent.removeAttribute("data-disabled");

        if (placementInput) placementInput.value = "sidebar";
        placementBtns.forEach((b) =>
          b.setAttribute(
            "data-active",
            b.dataset.placement === "sidebar" ? "true" : "false",
          ),
        );
        if (agCol) agCol.setAttribute("data-placement", "sidebar");
        if (matrixWrapper) matrixWrapper.removeAttribute("data-hidden");
        if (get("zs-hide-utility-section"))
          get("zs-hide-utility-section").checked = false;
        const utilityRow = get("zs-utility-section-row");
        if (utilityRow) utilityRow.removeAttribute("data-hidden");

        this.updateMatrixUI(7, 3);
        const animDropdown = this.modal.querySelector("#zs-anim-type-dropdown");
        if (animDropdown && animDropdown.syncValue)
          animDropdown.syncValue("slide");
        else if (get("zs-anim-type")) get("zs-anim-type").value = "slide";

        get("zs-anim-speed").value = 450;
        if (get("zs-anim-speed-slider"))
          get("zs-anim-speed-slider").value = 450;
        if (get("zs-anim-speed-badge"))
          get("zs-anim-speed-badge").textContent = "450 ms";
        get("zs-max-apps").value = 21;
        const instaPeekBtn = this.modal.querySelector("#zs-insta-peek-btn");
        if (instaPeekBtn && instaPeekBtn.syncValue)
          instaPeekBtn.syncValue("Alt+Q");
        else if (get("zs-insta-peek-shortcut"))
          get("zs-insta-peek-shortcut").value = "Alt+Q";
        this.updatePreviewDemo("slide", 450);
      });

      this.modal.querySelector("#zs-tg-reset").addEventListener("click", () => {
        const get = (id) => this.modal.querySelector("#" + id);
        get("zs-tg-enabled").checked = true;
        if (tgStatus) {
          tgStatus.textContent = "Enabled";
          tgStatus.setAttribute("data-enabled", "true");
        }
        if (tgContent) tgContent.removeAttribute("data-disabled");

        get("zs-tg-collapse").checked = false;
        get("zs-tg-thumbnails").checked = true;
        get("zs-tg-chevron").checked = true;
        if (indicatorTypeRow) indicatorTypeRow.removeAttribute("data-hidden");

        const tgDropdown = this.modal.querySelector(
          "#zs-tg-indicator-type-dropdown",
        );
        if (tgDropdown && tgDropdown.syncValue) tgDropdown.syncValue("circle");
        else if (get("zs-tg-indicator-type"))
          get("zs-tg-indicator-type").value = "circle";

        get("zs-tg-opacity").value = 85;
        if (get("zs-tg-opacity-badge"))
          get("zs-tg-opacity-badge").textContent = "85%";
        document.documentElement.style.setProperty(
          "--zentral-tabgroup-label-opacity",
          "0.85",
        );
        document.documentElement.setAttribute(
          "zentral-label-opacity-below-85",
          "false",
        );
        document.documentElement.setAttribute(
          "zentral-indicator-type",
          "circle",
        );
      });

      this.populate();
    }
  }

    return ZentralSettings;
  };
})();
