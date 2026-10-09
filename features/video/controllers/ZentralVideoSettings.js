/*
 * ZENTRAL FILE GUIDE - features/video/controllers/ZentralVideoSettings.js
 *
 * Purpose: Optional video categories, preference controls and availability-aware settings hooks.
 * Interaction / execution: VideoPreview creates it with settings lookup and live option/state callbacks;
 *   SettingsShell contains its pages, Runtime reorganizes categories and Diagnostics adds experiment
 *   controls when available.
 * Ownership / failure: Omission removes video settings UI while preview can still use stored preferences.
 *   VideoPreview cleanup handles registered UI hooks/events; category enable switches remain reachable.
 * Registration: video/ZentralVideoSettings
 * Loaded/created by: features/video/ZentralVideoPreview.uc.js; core/ZentralRuntime.js
 * Returned factory API: hookSettings; injectSetting; organizeVideoSettings
 * Injected deps state/callbacks used: ADAPTIVE_DETAIL_PREF; AUDIO_CACHE_PREF; AUTO_HEIGHT_BUTTON_PREF;
 *   AUTO_SHOW_PREF; BINARY_FRAMES_PREF; CANVAS_STREAM_FPS_PREF; CANVAS_STREAM_WIDTH_PREF; CAPTIONS_PREF;
 *   CAPTION_EVENTS_PREF; CAPTION_INTERVALS; CAPTION_POLL_PREF; CAPTION_RECOVERY_PREF; CAPTURE_RATES;
 *   CAPTURE_RATE_PREF; CAPTURE_WIDTH_PREF; COMPACT_BUTTON_PREF; DIRECT_DISCOVERY_NOTICE; DISCOVERY_PREF;
 *   DISPLAY_CAP_PREF; EXPERIMENTAL_DISABLED_PREF; FIT_WIDTH_PREF; FRAME_AWARE_PREF; FRAMING_PREF;
 *   HEIGHT_PREF; HIDE_BUTTON_PREF; HIDE_DUPLICATES_PREF; IDLE_TIMER_PREF; KEEP_VISIBLE_PREF;
 *   LEGACY_CAPTURE_PREF; LIGHT_MONITOR_PREF; LIVE_MODES; MEDIA_EVENTS_PREF; PAUSE_COMPACT_PREF;
 *   PERF_DIAG_PREF; PINNED_DISCOVERY_PREF; PIN_BUTTON_PREF; PREF; RADIUS_PREF; RENDER_PREF;
 *   REQUIRE_AUDIO_PREF; RETRY_BACKOFF_PREF; SCAN_INTERVAL_PREF; SLOW_HEALTH_PREF; STRICT_MODE_PREF;
 *   SUSPEND_HIDDEN_PREF; SUSPEND_VISIBLE_PREF; Services; WIDTH_PREF; ZentralRuntime; adaptiveWidth;
 *   applyPowerSettings; autoShowVideo; cancelExperimentTests; canvasStreamFps; canvasStreamWidth;
 *   captionIntervalMs; captureRateDescription; captureRateTenths; captureWidth; clearCaptionWatch;
 *   compactPaused; cropStates; current; diagnostics; discoveryChoice; discoveryLocks; discoveryWinner;
 *   enabled; ensureVideoDevCategory; ensureVideoTestControls; experimentalBridgeDisabled; fastCaptures;
 *   featureOn; fillWidth; fitPicture; framingChoice; heightPx; hideMutedDuplicates; nextStillCapture;
 *   originalSettingsOpen; paint; pauseWhenCompactHidden; pinnedSource; powerOn; previewAutoSelected;
 *   previewMode; previewVisible; radiusPx; refreshCaption; refreshCard; refreshMethodStatus;
 *   refreshPlaybackStatus; refreshSettingList; rendererChoice; rendererRetryCounts; requireAudio;
 *   resetRendering; runSourceExperiment; scan; scanIntervalMs; select; setAutoHeight; setCaption;
 *   settingsCategoryGuard; settingsInstance; slowCaptures; sources; unavailableBySource; updatePaintTimer;
 *   videoSettingFromMenu; visibilityCheckAt; widthPercent; wrappedSettingsOpen
 * Contract fields assigned here: deps.adaptiveWidth; deps.current; deps.discoveryWinner; deps.fastCaptures;
 *   deps.heightPx; deps.nextStillCapture; deps.originalSettingsOpen; deps.pinnedSource;
 *   deps.previewAutoSelected; deps.radiusPx; deps.settingsCategoryGuard; deps.settingsInstance;
 *   deps.slowCaptures; deps.videoSettingFromMenu; deps.visibilityCheckAt; deps.widthPercent;
 *   deps.wrappedSettingsOpen
 * Literal DOM event subscriptions: change; click; input
 *
 * Metadata dependency: Runtime.settingsOwnerAvailable prevents building Video pages after its descriptor fails.
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "video/ZentralVideoSettings",
    function (deps) {
      function organizeVideoSettings(
        modal,
        originalContent,
        category,
        originalPanel,
      ) {
        if (
          !deps.ZentralRuntime?.ensureSettingsCategory ||
          originalPanel.dataset.videoOrganized === "true"
        )
          return;
        const own = (id) =>
          deps.ZentralRuntime.ensureSettingsCategory(modal, id);
        const playback = own("video-playback");
        const appearance = own("video-appearance");
        const keys = {
          width: deps.WIDTH_PREF,
          height: deps.HEIGHT_PREF,
          radius: deps.RADIUS_PREF,
          framing: deps.FRAMING_PREF,
          renderer: deps.RENDER_PREF,
          discovery: deps.DISCOVERY_PREF,
          "capture-width": deps.CAPTURE_WIDTH_PREF,
          "capture-rate": deps.CAPTURE_RATE_PREF,
          "pause-compact": deps.PAUSE_COMPACT_PREF,
          "disable-experimental": deps.EXPERIMENTAL_DISABLED_PREF,
        };
        for (const [id, pref] of Object.entries(keys)) {
          const control = modal.querySelector("#zs-video-preview-" + id);
          const row = control?.closest(".zs-row, label");
          if (row) row.dataset.settingKey = pref;
        }
        // Playback/source/capture/testing sections are built here and removed
        // as one module. Shared style prefs remain in their existing namespace.
        for (const section of [
          ...modal.querySelectorAll("[data-video-settings]"),
        ]) {
          const target = own(section.dataset.settingsCategory).content;
          if (section.parentElement !== target) target.appendChild(section);
        }
        const enable = modal.querySelector("#zs-video-preview-row");
        if (enable && enable.parentElement !== playback.content)
          playback.content.prepend(enable);
        const appearanceIds = [
          "fit-width",
          "hide-button",
          "auto-height-button",
          "pin-button",
          "compact-button",
        ];
        for (const id of appearanceIds) {
          const row = modal
            .querySelector("#zs-video-preview-" + id)
            ?.closest(".zs-row");
          if (row && row.parentElement !== appearance.content)
            appearance.content.appendChild(row);
        }
        for (const id of ["width", "height", "radius"]) {
          const control = modal.querySelector("#zs-video-preview-" + id);
          const row = control?.closest(".zs-row");
          if (row && row.parentElement !== appearance.content)
            appearance.content.appendChild(row);
        }
        for (const row of [...modal.querySelectorAll("[data-setting-key]")]) {
          if (
            !row.dataset.settingKey.startsWith(
              "zen.workspace.zentral.video_preview.",
            )
          )
            continue;
          if (
            !row.querySelector('[id^="zs-video-preview-"]') &&
            row.id !== "zs-video-preview-row"
          )
            continue;
          const meta = deps.ZentralRuntime.settingsMetadata({
            property: row.dataset.settingKey,
          });
          row.dataset.videoSettings = "row";
          row.dataset.settingsOwner = "video";
          const target = own(meta.category).content;
          if (!target.contains(row)) target.appendChild(row);
        }
        const resetHeight = modal.querySelector(
          "#zs-video-preview-reset-height",
        );
        if (resetHeight && resetHeight.parentElement !== appearance.content)
          appearance.content.appendChild(resetHeight);
        const experiments = own("video-experiments");
        const switchRow = modal
          .querySelector("#zs-video-preview-disable-experimental")
          ?.closest(".zs-row");
        if (switchRow && switchRow.parentElement !== experiments.content)
          experiments.content.prepend(switchRow);
        category.hidden = true;
        category.setAttribute("data-active", "false");
        originalPanel.setAttribute("data-active", "false");
        originalPanel.dataset.videoOrganized = "true";
        deps.ZentralRuntime.organizeSettings?.(modal);
      }
      function injectSetting() {
        const modal = document.getElementById("zentral-settings-modal");
        const tabBar = modal?.querySelector(".zs-tab-bar");
        const body = modal?.querySelector(".zs-body");
        if (!tabBar || !body) return;
        // Missing/corrupt metadata must not create fallback Video pages or
        // throw while the independent playback controller is still usable.
        if (deps.ZentralRuntime?.settingsOwnerAvailable?.("video") === false)
          return;
        let category = modal.querySelector("#zs-tab-btn-video-cloning");
        let panel = modal.querySelector("#zs-panel-video-cloning");
        if (!panel) {
          panel = document.createElement("div");
          panel.id = "zs-panel-video-cloning";
          panel.className = "zs-tab-panel";
          panel.dataset.tab = "video-cloning";
          panel.setAttribute("data-active", "false");
          const header = document.createElement("div");
          header.className = "zs-section-header";
          const title = document.createElement("h3");
          title.className = "zs-section-title";
          title.textContent = "Video";
          header.appendChild(title);
          const content = document.createElement("div");
          content.className = "zs-section-content";
          content.style.cssText =
            "overflow-y:auto; display:flex; flex-direction:column; gap:14px;";
          panel.append(header, content);
          body.appendChild(panel);
        }
        if (!category) {
          category = document.createElement("button");
          category.id = "zs-tab-btn-video-cloning";
          category.type = "button";
          category.className = "zs-tab-btn";
          category.dataset.tab = "video-cloning";
          category.textContent = "Video";
          tabBar.appendChild(category);
          category.addEventListener("click", () => {
            modal
              .querySelectorAll(".zs-tab-bar .zs-tab-btn")
              .forEach((button) =>
                button.setAttribute(
                  "data-active",
                  button === category ? "true" : "false",
                ),
              );
            modal
              .querySelectorAll(".zs-body .zs-tab-panel")
              .forEach((tab) =>
                tab.setAttribute(
                  "data-active",
                  tab === panel ? "true" : "false",
                ),
              );
            deps.refreshSettingList();
          });
          // Native settings tabs capture their buttons before this category exists.
          deps.settingsCategoryGuard = (event) => {
            if (event.target.closest?.(".zs-tab-btn") !== category) {
              category.setAttribute("data-active", "false");
              panel.setAttribute("data-active", "false");
            }
          };
          tabBar.addEventListener("click", deps.settingsCategoryGuard, true);
        }
        // The preview uses an older Zentral-pref namespace but is extension-owned.
        // Keep it after the other extension categories when Settings reopens.
        tabBar.appendChild(category);
        const content = panel.querySelector(".zs-section-content");
        deps.ensureVideoDevCategory(modal, tabBar, body);
        // The content is the sole scroll owner; its flex panel supplies height.
        content.style.cssText =
          "overflow-y:auto;overflow-x:hidden;min-height:0;flex:1 1 auto;display:flex;flex-direction:column;gap:14px;padding-bottom:24px";
        if (!deps.experimentalBridgeDisabled())
          deps.ensureVideoTestControls(content);
        let input = modal.querySelector("#zs-video-preview-enabled");
        if (!input) {
          const row = document.createElement("div");
          row.id = "zs-video-preview-row";
          row.className = "zs-row";
          row.dataset.settingKey = deps.PREF;
          const labels = document.createElement("div");
          labels.className = "zs-label-container";
          const title = document.createElement("span");
          title.className = "zs-label";
          title.textContent = "Sidebar Video Preview";
          const description = document.createElement("span");
          description.className = "zs-sublabel";
          description.id = "zs-video-preview-status";
          labels.append(title, description);
          const switchLabel = document.createElement("label");
          switchLabel.className = "zs-switch";
          input = document.createElement("input");
          input.type = "checkbox";
          input.id = "zs-video-preview-enabled";
          const slider = document.createElement("span");
          slider.className = "zs-slider";
          switchLabel.append(input, slider);
          row.append(labels, switchLabel);
          content.appendChild(row);
          input.addEventListener("change", () =>
            deps.Services.prefs.setBoolPref(deps.PREF, input.checked),
          );
          const addToggle = (
            label,
            preference,
            initial,
            onchange = () => {},
          ) => {
            const row = document.createElement("label");
            row.className = "zs-row";
            row.dataset.settingKey = preference;
            row.style.cssText =
              "display:flex;align-items:center;justify-content:space-between;gap:12px";
            const text = document.createElement("span");
            text.className = "zs-label";
            text.textContent = label;
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            const ids = new Map([
              [deps.STRICT_MODE_PREF, "selected-mode-only"],
              [deps.KEEP_VISIBLE_PREF, "keep-source-visible"],
              [deps.HIDE_DUPLICATES_PREF, "hide-muted-duplicates"],
              [deps.FIT_WIDTH_PREF, "fit-width"],
              [deps.REQUIRE_AUDIO_PREF, "require-audio"],
              [deps.AUTO_SHOW_PREF, "auto-show"],
              [deps.HIDE_BUTTON_PREF, "hide-button"],
              [deps.AUTO_HEIGHT_BUTTON_PREF, "auto-height-button"],
              [deps.BINARY_FRAMES_PREF, "binary-frames"],
              [deps.DISPLAY_CAP_PREF, "display-cap"],
              [deps.ADAPTIVE_DETAIL_PREF, "adaptive-detail"],
              [deps.MEDIA_EVENTS_PREF, "media-events"],
              [deps.CAPTIONS_PREF, "captions"],
              [deps.IDLE_TIMER_PREF, "idle-timer"],
              [deps.AUDIO_CACHE_PREF, "audio-cache"],
              [deps.FRAME_AWARE_PREF, "frame-aware"],
              [deps.CAPTION_EVENTS_PREF, "caption-events"],
              [deps.PIN_BUTTON_PREF, "pin-button"],
              [deps.COMPACT_BUTTON_PREF, "compact-button"],
              [deps.PERF_DIAG_PREF, "perf-diag"],
              [deps.SUSPEND_HIDDEN_PREF, "suspend-hidden"],
              [deps.LIGHT_MONITOR_PREF, "light-monitor"],
              [deps.SLOW_HEALTH_PREF, "slow-health"],
              [deps.PINNED_DISCOVERY_PREF, "pinned-discovery"],
              [deps.CAPTION_RECOVERY_PREF, "caption-recovery"],
              [deps.RETRY_BACKOFF_PREF, "retry-backoff"],
              [deps.SUSPEND_VISIBLE_PREF, "suspend-visible"],
            ]);
            checkbox.id = "zs-video-preview-" + ids.get(preference);
            checkbox.checked = deps.Services.prefs.getBoolPref(
              preference,
              initial,
            );
            checkbox.addEventListener("change", () => {
              deps.videoSettingFromMenu = true;
              try {
                deps.Services.prefs.setBoolPref(preference, checkbox.checked);
              } finally {
                deps.videoSettingFromMenu = false;
              }
              onchange();
            });
            row.append(text, checkbox);
            content.appendChild(row);
            return row;
          };
          const experimentalRow = document.createElement("label");
          experimentalRow.className = "zs-row";
          experimentalRow.style.cssText =
            "display:flex;align-items:center;justify-content:space-between;gap:12px";
          const experimentalText = document.createElement("span");
          experimentalText.className = "zs-label-container";
          const experimentalTitle = document.createElement("span");
          experimentalTitle.className = "zs-label";
          experimentalTitle.textContent = "Enable experimental video features";
          const experimentalHelp = document.createElement("span");
          experimentalHelp.className = "zs-sublabel";
          experimentalHelp.textContent =
            "Shows advanced options and diagnostic tests below. Normal sidebar playback remains available when experiments are off.";
          experimentalText.append(experimentalTitle, experimentalHelp);
          const experimentalCheckbox = document.createElement("input");
          experimentalCheckbox.type = "checkbox";
          experimentalCheckbox.id = "zs-video-preview-disable-experimental";
          experimentalCheckbox.checked = !deps.experimentalBridgeDisabled();
          experimentalCheckbox.addEventListener("change", () =>
            deps.Services.prefs.setBoolPref(
              deps.EXPERIMENTAL_DISABLED_PREF,
              !experimentalCheckbox.checked,
            ),
          );
          experimentalRow.append(experimentalText, experimentalCheckbox);
          content.appendChild(experimentalRow);
          const lab = document.createElement("div");
          lab.id = "zs-video-preview-experiment-lab";
          lab.hidden = deps.experimentalBridgeDisabled();
          const legacyLabel = document.createElement("label");
          const legacyCapture = document.createElement("input");
          legacyCapture.type = "checkbox";
          legacyCapture.id = "zs-video-preview-legacy-capture";
          legacyCapture.checked = deps.Services.prefs.getBoolPref(
            deps.LEGACY_CAPTURE_PREF,
            false,
          );
          legacyCapture.addEventListener("change", () => {
            deps.Services.prefs.setBoolPref(
              deps.LEGACY_CAPTURE_PREF,
              legacyCapture.checked,
            );
            deps.resetRendering();
          });
          legacyLabel.append(
            legacyCapture,
            " Allow legacy stream capture (may suppress source audio; off by default)",
          );
          lab.appendChild(legacyLabel);
          const experimentHelp = document.createElement("p");
          experimentHelp.className = "zs-sublabel";
          experimentHelp.textContent =
            "Source-document controls show a small test video on the source page for 60 seconds. Compare with the sidebar and check original audio. The report measures frames; it cannot replace visual inspection.";
          lab.appendChild(experimentHelp);
          for (const [mode, label] of [
            ["native", "Test source clone · 60 s"],
            ["stream", "Test source stream · 60 s"],
            ["canvas-stream", "Test source canvas · 60 s"],
          ]) {
            const button = document.createElement("button");
            button.className = "zs-button";
            button.textContent = label;
            button.addEventListener("click", () =>
              deps.runSourceExperiment(mode),
            );
            lab.appendChild(button);
          }
          const cancel = document.createElement("button");
          cancel.className = "zs-button";
          cancel.textContent = "Stop experiment tests";
          cancel.addEventListener("click", deps.cancelExperimentTests);
          lab.appendChild(cancel);
          content.appendChild(lab);
          if (!deps.experimentalBridgeDisabled())
            deps.ensureVideoTestControls(content);
          const pauseRow = document.createElement("label");
          pauseRow.className = "zs-row";
          pauseRow.style.cssText =
            "display:flex;align-items:center;justify-content:space-between;gap:12px";
          const pauseText = document.createElement("span");
          pauseText.className = "zs-label-container";
          const pauseTitle = document.createElement("span");
          pauseTitle.className = "zs-label";
          pauseTitle.textContent =
            "Pause preview when compact tabbar is hidden";
          const pauseHelp = document.createElement("span");
          pauseHelp.className = "zs-sublabel";
          pauseHelp.textContent =
            "On by default. Stops video scanning and all preview capture methods " +
            "while the compact tabbar is hidden; remembers the selected source " +
            "and checks it first when the tabbar returns. Source playback is unaffected.";
          pauseText.append(pauseTitle, pauseHelp);
          const pauseCheck = document.createElement("input");
          pauseCheck.type = "checkbox";
          pauseCheck.id = "zs-video-preview-pause-compact";
          pauseCheck.checked = deps.pauseWhenCompactHidden();
          pauseCheck.addEventListener("change", () =>
            deps.Services.prefs.setBoolPref(
              deps.PAUSE_COMPACT_PREF,
              pauseCheck.checked,
            ),
          );
          pauseRow.append(pauseText, pauseCheck);
          content.appendChild(pauseRow);
          addToggle(
            "Use selected mode only (no fallback)",
            deps.STRICT_MODE_PREF,
            false,
            () => {
              deps.resetRendering();
              deps.refreshPlaybackStatus();
              if (deps.enabled()) deps.paint();
            },
          );
          addToggle(
            "Keep video on its page while visible",
            deps.KEEP_VISIBLE_PREF,
            true,
            () => {
              deps.visibilityCheckAt = 0;
              deps.resetRendering();
              if (deps.enabled()) deps.paint();
            },
          );
          addToggle(
            "Hide muted copies when an unmuted video matches",
            deps.HIDE_DUPLICATES_PREF,
            true,
            () => {
              if (deps.enabled()) deps.scan(true);
            },
          );
          addToggle(
            "Do not display videos without an audio track",
            deps.REQUIRE_AUDIO_PREF,
            true,
            () => {
              if (deps.enabled()) deps.scan(true);
            },
          );
          addToggle(
            "Show playing videos automatically",
            deps.AUTO_SHOW_PREF,
            true,
            () => {
              if (!deps.autoShowVideo() && deps.previewAutoSelected) {
                deps.current = null;
                deps.previewAutoSelected = false;
                deps.resetRendering();
                deps.refreshCard();
              } else if (deps.enabled()) deps.scan(true);
            },
          );
          addToggle(
            "Fill available sidebar width",
            deps.FIT_WIDTH_PREF,
            true,
            () => {
              deps.fitPicture();
              injectSetting();
            },
          );
          addToggle(
            "Show hide/show video button",
            deps.HIDE_BUTTON_PREF,
            true,
            deps.refreshCard,
          );
          addToggle(
            "Show Auto height button after resizing",
            deps.AUTO_HEIGHT_BUTTON_PREF,
            true,
            deps.refreshCard,
          );
          addToggle(
            "Show pin source button",
            deps.PIN_BUTTON_PREF,
            true,
            () => {
              if (!deps.featureOn(deps.PIN_BUTTON_PREF))
                deps.pinnedSource = null;
              deps.refreshCard();
            },
          );
          addToggle(
            "Show compact card button",
            deps.COMPACT_BUTTON_PREF,
            true,
            deps.refreshCard,
          );
          addToggle(
            "Transfer raw frames (fall back to JPEG)",
            deps.BINARY_FRAMES_PREF,
            true,
            () => {
              deps.resetRendering();
              if (deps.enabled()) deps.paint();
            },
          );
          addToggle(
            "Limit still capture to displayed size",
            deps.DISPLAY_CAP_PREF,
            true,
            () => {
              deps.nextStillCapture = 0;
              if (deps.enabled()) deps.paint();
            },
          );
          addToggle(
            "Adapt still capture detail under load",
            deps.ADAPTIVE_DETAIL_PREF,
            true,
            () => {
              deps.adaptiveWidth = deps.slowCaptures = deps.fastCaptures = 0;
            },
          );
          addToggle(
            "Skip duplicate decoded frames",
            deps.FRAME_AWARE_PREF,
            true,
            () => {
              deps.nextStillCapture = 0;
            },
          );
          addToggle(
            "Stop paint timer when preview is not visible",
            deps.IDLE_TIMER_PREF,
            true,
            () => {
              if (
                deps.featureOn(deps.IDLE_TIMER_PREF) &&
                !deps.previewVisible()
              )
                deps.updatePaintTimer(false);
              else deps.updatePaintTimer(true);
            },
          );
          addToggle(
            "Refresh sources on media events",
            deps.MEDIA_EVENTS_PREF,
            true,
            () => {
              if (deps.enabled()) deps.scan();
            },
          );
          addToggle(
            "Cache audio-track checks for 30 seconds",
            deps.AUDIO_CACHE_PREF,
            true,
            () => {
              if (deps.enabled()) deps.scan(true);
            },
          );
          addToggle(
            "Mirror captions (text tracks and YouTube)",
            deps.CAPTIONS_PREF,
            true,
            () => {
              if (!deps.featureOn(deps.CAPTIONS_PREF)) {
                deps.clearCaptionWatch();
                deps.setCaption("");
              } else deps.refreshCaption();
            },
          );
          addToggle(
            "Use caption change events when available",
            deps.CAPTION_EVENTS_PREF,
            true,
            () => {
              deps.clearCaptionWatch();
              deps.refreshCaption();
            },
          );
          addToggle(
            "Show performance diagnostics",
            deps.PERF_DIAG_PREF,
            true,
            deps.refreshMethodStatus,
          );
          const addRange = (title, id, min, max, currentValue, update) => {
            const row = document.createElement("label");
            row.className = "zs-row";
            row.style.cssText = "display:flex;align-items:center;gap:12px";
            const text = document.createElement("span");
            text.className = "zs-label";
            text.textContent = title;
            const value = document.createElement("span");
            value.id = id + "-value";
            value.style.cssText = "min-width:46px;text-align:right";
            const input = document.createElement("input");
            input.type = "range";
            input.id = id;
            input.min = String(min);
            input.max = String(max);
            input.value = String(currentValue);
            input.style.cssText = "min-width:70px;flex:1";
            input.addEventListener("input", () =>
              update(Number(input.value), value),
            );
            input.addEventListener("change", () =>
              update(Number(input.value), value, true),
            );
            row.append(text, input, value);
            content.appendChild(row);
            return { input, value, row };
          };
          const width = addRange(
            "Width",
            "zs-video-preview-width",
            35,
            100,
            deps.widthPercent,
            (number, label, save) => {
              deps.widthPercent = number;
              label.textContent = number + "%";
              if (save) deps.Services.prefs.setIntPref(deps.WIDTH_PREF, number);
              deps.fitPicture();
            },
          );
          width.value.textContent = deps.widthPercent + "%";
          const height = addRange(
            "Video height",
            "zs-video-preview-height",
            90,
            800,
            deps.heightPx || Math.min(800, 230),
            (number, label, save) => {
              deps.heightPx = Math.max(90, Math.min(800, number));
              label.textContent = deps.heightPx + " px";
              if (save)
                deps.Services.prefs.setIntPref(deps.HEIGHT_PREF, deps.heightPx);
              deps.fitPicture();
            },
          );
          height.value.textContent = deps.heightPx
            ? deps.heightPx + " px"
            : "Auto";
          const resetHeight = document.createElement("button");
          resetHeight.id = "zs-video-preview-reset-height";
          resetHeight.type = "button";
          resetHeight.className = "zs-btn-save";
          resetHeight.textContent = "Auto height (video ratio)";
          resetHeight.addEventListener("click", () => {
            deps.setAutoHeight();
          });
          content.appendChild(resetHeight);
          const radius = addRange(
            "Corner rounding",
            "zs-video-preview-radius",
            0,
            24,
            deps.radiusPx,
            (number, label, save) => {
              deps.radiusPx = number;
              label.textContent = number + " px";
              if (save)
                deps.Services.prefs.setIntPref(deps.RADIUS_PREF, number);
              deps.fitPicture();
            },
          );
          radius.value.textContent = deps.radiusPx + " px";
          const detailLabel = document.createElement("label");
          detailLabel.textContent =
            "Capture detail, longest edge (frames and snapshots only) ";
          const detail = document.createElement("select");
          detail.id = "zs-video-preview-capture-width";
          for (const [value, label] of [
            [160, "Tiny preview · 160 px"],
            [240, "Small preview · 240 px"],
            [320, "Lower load · 320 px"],
            [480, "Balanced · 480 px (default)"],
            [640, "Sharper · 640 px"],
          ]) {
            const option = document.createElement("option");
            option.value = String(value);
            option.textContent = label;
            detail.appendChild(option);
          }
          detail.value = String(deps.captureWidth());
          detail.addEventListener("change", () => {
            deps.Services.prefs.setIntPref(
              deps.CAPTURE_WIDTH_PREF,
              Number(detail.value),
            );
            if (deps.enabled()) deps.paint();
          });
          detailLabel.appendChild(detail);
          content.appendChild(detailLabel);
          const rateLabel = document.createElement("label");
          rateLabel.textContent = "Video Frames / Page Snapshots capture rate ";
          const rate = document.createElement("input");
          rate.type = "range";
          rate.id = "zs-video-preview-capture-rate";
          rate.min = "0";
          rate.max = String(deps.CAPTURE_RATES.length - 1);
          rate.step = "1";
          rate.value = String(
            deps.CAPTURE_RATES.indexOf(deps.captureRateTenths()),
          );
          const rateValue = document.createElement("span");
          rateValue.id = "zs-video-preview-capture-rate-value";
          rateValue.textContent = deps.captureRateTenths() / 10 + " fps";
          rate.addEventListener("input", () => {
            const tenths = deps.CAPTURE_RATES[Number(rate.value)];
            rateValue.textContent = tenths / 10 + " fps";
            rateCost.textContent = deps.captureRateDescription(tenths);
          });
          rate.addEventListener("change", () =>
            deps.Services.prefs.setIntPref(
              deps.CAPTURE_RATE_PREF,
              deps.CAPTURE_RATES[Number(rate.value)],
            ),
          );
          rateLabel.append(rate, rateValue);
          content.appendChild(rateLabel);
          const rateCost = document.createElement("span");
          rateCost.id = "zs-video-preview-capture-rate-cost";
          rateCost.className = "zs-sublabel";
          content.appendChild(rateCost);
          const frameLabel = document.createElement("label");
          frameLabel.textContent = "Video framing ";
          const frameSelect = document.createElement("select");
          frameSelect.id = "zs-video-preview-framing";
          for (const [value, title] of [
            ["auto", "Auto crop bars in captured frames"],
            ["contain", "Show complete image (may show bars)"],
            ["cover", "Fill area (may crop edges)"],
          ]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = title;
            frameSelect.appendChild(option);
          }
          frameSelect.value = deps.framingChoice();
          frameSelect.addEventListener("change", () => {
            deps.Services.prefs.setStringPref(
              deps.FRAMING_PREF,
              frameSelect.value,
            );
            deps.cropStates.clear();
            if (deps.current?.data) {
              delete deps.current.data.displayWidth;
              delete deps.current.data.displayHeight;
            }
            deps.fitPicture();
            deps.refreshCard();
            if (deps.LIVE_MODES.includes(deps.previewMode)) {
              deps.resetRendering();
              deps.paint();
            }
          });
          frameLabel.appendChild(frameSelect);
          content.appendChild(frameLabel);
          const listTitle = document.createElement("span");
          listTitle.className = "zs-label";
          listTitle.textContent = "Detected video sources";
          const list = document.createElement("select");
          list.id = "zs-video-preview-sources";
          list.size = 9;
          list.style.cssText =
            "width:100%; min-height:180px; background:#15151d; color:inherit; border-radius:8px; padding:8px;";
          const actions = document.createElement("div");
          actions.style.cssText = "display:flex; gap:8px;";
          const preview = document.createElement("button");
          preview.type = "button";
          preview.className = "zs-btn-save";
          preview.textContent = "Preview selected";
          preview.addEventListener("click", () =>
            deps.select(deps.sources[list.selectedIndex], true),
          );
          const refresh = document.createElement("button");
          refresh.type = "button";
          refresh.className = "zs-btn-save";
          refresh.textContent = "Refresh sources";
          refresh.addEventListener("click", () => {
            deps.discoveryLocks.clear();
            deps.discoveryWinner = null;
            deps.unavailableBySource.clear();
            deps.rendererRetryCounts.clear();
            deps.scan(true);
          });
          actions.append(preview, refresh);
          content.append(listTitle, list, actions);
          deps.ensureVideoTestControls(content);
          const bridgesStatus = document.createElement("div");
          bridgesStatus.id = "zs-video-preview-bridges";
          bridgesStatus.style.cssText =
            "white-space:pre-wrap; font-size:11px; opacity:.8;";
          content.appendChild(bridgesStatus);
          const rendererLabel = document.createElement("label");
          rendererLabel.textContent = "Preview renderer ";
          const renderer = document.createElement("select");
          renderer.id = "zs-video-preview-renderer";
          for (const [value, label] of [
            ["auto", "Automatic (best available first)"],
            ["frame-native", "Native cloning (frame bridge)"],
            ["native", "Native cloning (actor)"],
            ["frame-stream", "Video stream (frame bridge)"],
            ["stream", "Video stream (actor)"],
            ["canvas-stream", "Canvas stream (up to 30 fps)"],
            ["canvas", "Video frames"],
            ["snapshot", "Page snapshots"],
          ]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            renderer.appendChild(option);
          }
          renderer.value = deps.rendererChoice();
          renderer.addEventListener("change", () =>
            deps.Services.prefs.setStringPref(deps.RENDER_PREF, renderer.value),
          );
          rendererLabel.appendChild(renderer);
          content.appendChild(rendererLabel);
          const methodHelp = document.createElement("p");
          methodHelp.id = "zs-video-preview-method-help";
          methodHelp.className = "zs-sublabel";
          const activeMode = document.createElement("p");
          activeMode.id = "zs-video-preview-active-mode";
          activeMode.setAttribute("role", "status");
          content.append(methodHelp, activeMode);
          const availability = document.createElement("div");
          availability.id = "zs-video-preview-availability";
          availability.className = "zs-sublabel";
          availability.style.cssText = "white-space:pre-wrap;font-size:11px";
          content.appendChild(availability);
          const discoveryLabel = document.createElement("label");
          discoveryLabel.textContent = "Source discovery ";
          const discovery = document.createElement("select");
          discovery.id = "zs-video-preview-discovery";
          for (const value of ["auto", "frame", "actor", "direct"]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent =
              value === "auto"
                ? "Automatic (frame → actor → direct)"
                : value === "direct"
                  ? "Direct (local document only)"
                  : value;
            discovery.appendChild(option);
          }
          discovery.value = deps.discoveryChoice();
          discovery.addEventListener("change", () =>
            deps.Services.prefs.setStringPref(
              deps.DISCOVERY_PREF,
              discovery.value,
            ),
          );
          discoveryLabel.appendChild(discovery);
          const discoveryHelp = document.createElement("span");
          discoveryHelp.id = "zs-video-preview-discovery-help";
          discoveryHelp.className = "zs-sublabel";
          discoveryHelp.style.display = "block";
          discoveryHelp.textContent = deps.DIRECT_DISCOVERY_NOTICE;
          discoveryHelp.hidden = deps.discoveryChoice() !== "direct";
          discoveryLabel.appendChild(discoveryHelp);
          content.appendChild(discoveryLabel);
          const help = document.createElement("div");
          help.className = "zs-sublabel";
          help.textContent =
            "Checks for videos at your chosen discovery interval, plus enabled events. Drag the grip below the video to set its height; use the Auto button to restore automatic height. Auto crop checks once, after about 3 seconds of playback. Click the framing button to check again; hold it to show the complete image. Your framing choice is saved.";
          content.appendChild(help);
          const settingsRow = (id) =>
            content
              .querySelector("#zs-video-preview-" + id)
              ?.closest(".zs-row");
          const group = (title, description, nodes) => {
            const section = document.createElement("section");
            section.className = "zvp-settings-group";
            const heading = document.createElement("h4");
            heading.textContent = title;
            const summary = document.createElement("p");
            summary.textContent = description;
            section.append(heading, summary, ...nodes.filter(Boolean));
            section.dataset.videoSettings = "true";
            section.dataset.settingsCategory =
              title === "Playback & layout"
                ? "video-playback"
                : title === "Still capture"
                  ? "video-performance"
                  : "video-sources";
            content.appendChild(section);
          };
          group("Playback & layout", "Sidebar controls and appearance.", [
            rendererLabel,
            settingsRow("selected-mode-only"),
            activeMode,
            methodHelp,
            settingsRow("auto-show"),
            settingsRow("keep-source-visible"),
            settingsRow("hide-button"),
            settingsRow("auto-height-button"),
            settingsRow("pin-button"),
            settingsRow("compact-button"),
            pauseRow,
            settingsRow("fit-width"),
            width.row,
            height.row,
            resetHeight,
            radius.row,
            frameLabel,
            settingsRow("captions"),
            help,
          ]);
          group(
            "Still capture",
            "FPS and resolution apply to Video frames and Page snapshots only.",
            [detailLabel, rateLabel, rateCost],
          );
          const performance = document.createElement("section");
          performance.id = "zs-video-preview-performance";
          performance.dataset.videoSettings = "true";
          performance.dataset.settingsCategory = "video-performance";
          performance.className = "zvp-settings-group";
          const performanceTitle = document.createElement("h4");
          performanceTitle.textContent = "Power & responsiveness";
          const performanceHelp = document.createElement("p");
          performanceHelp.className = "zs-sublabel";
          performanceHelp.textContent =
            "Slower scans delay new source detection. Events can still trigger scans; disable media-event refresh for fewer background scans. Lower canvas-stream FPS and resolution reduce drawing work but lose smoothness and detail. Slower caption checks can delay recovery from missed events. Native cloning and direct streams keep their source quality.";
          performance.append(performanceTitle, performanceHelp);
          const addPerformanceSelect = (id, label, pref, values, selected) => {
            const row = document.createElement("label");
            row.textContent = label + " ";
            row.dataset.settingKey = pref;
            const select = document.createElement("select");
            select.id = "zs-video-preview-" + id;
            for (const [value, text] of values) {
              const option = document.createElement("option");
              option.value = String(value);
              option.textContent = text;
              select.appendChild(option);
            }
            select.value = String(selected);
            select.addEventListener("change", () =>
              deps.Services.prefs.setIntPref(pref, Number(select.value)),
            );
            row.appendChild(select);
            performance.appendChild(row);
          };
          addPerformanceSelect(
            "scan-interval",
            "Source discovery interval",
            deps.SCAN_INTERVAL_PREF,
            [
              [5000, "5 s · default"],
              [15000, "15 s"],
              [30000, "30 s"],
              [60000, "60 s · lazy"],
              [120000, "2 min · very lazy"],
              [0, "Events and manual refresh only"],
            ],
            deps.scanIntervalMs(),
          );
          addPerformanceSelect(
            "caption-poll",
            "Caption recovery check",
            deps.CAPTION_POLL_PREF,
            deps.CAPTION_INTERVALS.map((value) => [
              value,
              value + " ms" + (value === 750 ? " · default" : ""),
            ]),
            deps.captionIntervalMs(),
          );
          addPerformanceSelect(
            "canvas-stream-width",
            "Canvas stream resolution",
            deps.CANVAS_STREAM_WIDTH_PREF,
            [160, 240, 320, 480, 640].map((value) => [
              value,
              value + " px" + (value === 640 ? " · default" : ""),
            ]),
            deps.canvasStreamWidth(),
          );
          addPerformanceSelect(
            "canvas-stream-fps",
            "Canvas stream frame rate",
            deps.CANVAS_STREAM_FPS_PREF,
            [5, 10, 15, 24, 30].map((value) => [
              value,
              value + " FPS" + (value === 30 ? " · default" : ""),
            ]),
            deps.canvasStreamFps(),
          );
          performance.append(
            ...[
              "media-events",
              "idle-timer",
              "display-cap",
              "adaptive-detail",
              "frame-aware",
              "audio-cache",
              "caption-events",
            ]
              .map(settingsRow)
              .filter(Boolean),
          );
          content.appendChild(performance);
          group(
            "Video sources",
            "Choose a playing video from tabs or panels.",
            [
              settingsRow("hide-muted-duplicates"),
              settingsRow("require-audio"),
              discoveryLabel,
              listTitle,
              list,
              actions,
            ],
          );
          content.appendChild(experimentalRow);
          const advanced = document.createElement("section");
          advanced.id = "zs-video-preview-advanced";
          advanced.dataset.videoSettings = "true";
          advanced.dataset.settingsCategory = "video-experiments";
          advanced.className = "zvp-settings-group";
          const advancedTitle = document.createElement("h4");
          advancedTitle.textContent = "Experimental options & tests";
          advanced.append(
            advancedTitle,
            addToggle(
              "Suspend receivers while hidden/minimized (brief restart on reveal)",
              deps.SUSPEND_HIDDEN_PREF,
              true,
              deps.applyPowerSettings,
            ),
            addToggle(
              "Sample frame telemetry every 2 seconds (full telemetry in tests)",
              deps.LIGHT_MONITOR_PREF,
              true,
              deps.applyPowerSettings,
            ),
            addToggle(
              "Slow steady-state health checks (10\u201315 second failure detection)",
              deps.SLOW_HEALTH_PREF,
              true,
              deps.applyPowerSettings,
            ),
            addToggle(
              "Limit periodic discovery to a valid pinned source (Refresh finds others)",
              deps.PINNED_DISCOVERY_PREF,
              true,
              deps.applyPowerSettings,
            ),
            addToggle(
              "Use caption events with 3 second recovery polling (missed cues recover later)",
              deps.CAPTION_RECOVERY_PREF,
              true,
              deps.applyPowerSettings,
            ),
            addToggle(
              "Back off repeated renderer failures up to 5 minutes",
              deps.RETRY_BACKOFF_PREF,
              true,
              deps.applyPowerSettings,
            ),
            addToggle(
              "Suspend sidebar video while original is visible (instead of stream fallback)",
              deps.SUSPEND_VISIBLE_PREF,
              false,
              deps.applyPowerSettings,
            ),
            availability,
            ...["binary-frames", "perf-diag"].map(settingsRow).filter(Boolean),
            lab,
            bridgesStatus,
          );
          content.appendChild(advanced);
          for (const id of [
            "zs-video-preview-test-all",
            "zs-video-preview-test-report",
          ])
            if (content.querySelector("#" + id))
              advanced.appendChild(content.querySelector("#" + id));
        }
        organizeVideoSettings(modal, content, category, panel);
        const advanced = modal.querySelector("#zs-video-preview-advanced");
        if (advanced) {
          advanced.hidden = deps.experimentalBridgeDisabled();
          advanced.style.setProperty(
            "display",
            advanced.hidden ? "none" : "block",
            "important",
          );
        }
        for (const [id, value] of [
          ["scan-interval", deps.scanIntervalMs()],
          ["caption-poll", deps.captionIntervalMs()],
          ["canvas-stream-width", deps.canvasStreamWidth()],
          ["canvas-stream-fps", deps.canvasStreamFps()],
        ]) {
          const select = modal.querySelector("#zs-video-preview-" + id);
          if (select) select.value = String(value);
        }
        const visibleCheck = modal.querySelector(
          "#zs-video-preview-keep-source-visible",
        );
        if (visibleCheck)
          visibleCheck.checked = deps.Services.prefs.getBoolPref(
            deps.KEEP_VISIBLE_PREF,
            true,
          );
        for (const [id, pref] of [
          ["suspend-hidden", deps.SUSPEND_HIDDEN_PREF],
          ["light-monitor", deps.LIGHT_MONITOR_PREF],
          ["slow-health", deps.SLOW_HEALTH_PREF],
          ["pinned-discovery", deps.PINNED_DISCOVERY_PREF],
          ["caption-recovery", deps.CAPTION_RECOVERY_PREF],
          ["retry-backoff", deps.RETRY_BACKOFF_PREF],
          ["suspend-visible", deps.SUSPEND_VISIBLE_PREF],
        ]) {
          const control = modal.querySelector("#zs-video-preview-" + id);
          if (control) control.checked = deps.powerOn(pref);
        }
        input.checked = deps.enabled();
        const lab = modal.querySelector("#zs-video-preview-experiment-lab");
        if (lab) lab.hidden = deps.experimentalBridgeDisabled();
        const legacyCapture = modal.querySelector(
          "#zs-video-preview-legacy-capture",
        );
        if (legacyCapture)
          legacyCapture.checked = deps.Services.prefs.getBoolPref(
            deps.LEGACY_CAPTURE_PREF,
            false,
          );
        const experimentalCheck = modal.querySelector(
          "#zs-video-preview-disable-experimental",
        );
        if (experimentalCheck)
          experimentalCheck.checked = !deps.experimentalBridgeDisabled();
        const pauseCheck = modal.querySelector(
          "#zs-video-preview-pause-compact",
        );
        if (pauseCheck) pauseCheck.checked = deps.pauseWhenCompactHidden();
        for (const [id, pref] of [
          ["hide-button", deps.HIDE_BUTTON_PREF],
          ["auto-height-button", deps.AUTO_HEIGHT_BUTTON_PREF],
          ["binary-frames", deps.BINARY_FRAMES_PREF],
          ["display-cap", deps.DISPLAY_CAP_PREF],
          ["adaptive-detail", deps.ADAPTIVE_DETAIL_PREF],
          ["media-events", deps.MEDIA_EVENTS_PREF],
          ["captions", deps.CAPTIONS_PREF],
          ["idle-timer", deps.IDLE_TIMER_PREF],
          ["audio-cache", deps.AUDIO_CACHE_PREF],
          ["frame-aware", deps.FRAME_AWARE_PREF],
          ["caption-events", deps.CAPTION_EVENTS_PREF],
          ["pin-button", deps.PIN_BUTTON_PREF],
          ["compact-button", deps.COMPACT_BUTTON_PREF],
          ["perf-diag", deps.PERF_DIAG_PREF],
        ]) {
          const checkbox = modal.querySelector("#zs-video-preview-" + id);
          if (checkbox) checkbox.checked = deps.featureOn(pref);
        }
        const widthCheck = modal.querySelector("#zs-video-preview-width");
        if (widthCheck) widthCheck.disabled = deps.fillWidth();
        const fillCheck = modal.querySelector("#zs-video-preview-fit-width");
        if (fillCheck) fillCheck.checked = deps.fillWidth();
        const heightInput = modal.querySelector("#zs-video-preview-height");
        if (heightInput)
          heightInput.value = String(deps.heightPx || Math.min(800, 230));
        const heightLabel = modal.querySelector(
          "#zs-video-preview-height-value",
        );
        if (heightLabel)
          heightLabel.textContent = deps.heightPx
            ? deps.heightPx + " px"
            : "Auto";
        const radiusInput = modal.querySelector("#zs-video-preview-radius");
        if (radiusInput) radiusInput.value = String(deps.radiusPx);
        const radiusLabel = modal.querySelector(
          "#zs-video-preview-radius-value",
        );
        if (radiusLabel) radiusLabel.textContent = deps.radiusPx + " px";
        const detailSelect = modal.querySelector(
          "#zs-video-preview-capture-width",
        );
        if (detailSelect) detailSelect.value = String(deps.captureWidth());
        const rateSelect = modal.querySelector(
          "#zs-video-preview-capture-rate",
        );
        if (rateSelect)
          rateSelect.value = String(
            deps.CAPTURE_RATES.indexOf(deps.captureRateTenths()),
          );
        const rateValue = modal.querySelector(
          "#zs-video-preview-capture-rate-value",
        );
        if (rateValue)
          rateValue.textContent = deps.captureRateTenths() / 10 + " fps";
        const rateCost = modal.querySelector(
          "#zs-video-preview-capture-rate-cost",
        );
        if (rateCost)
          rateCost.textContent = deps.captureRateDescription(
            deps.captureRateTenths(),
          );
        const frameSelect = modal.querySelector("#zs-video-preview-framing");
        if (frameSelect) frameSelect.value = deps.framingChoice();
        const hideCheckbox = modal.querySelector(
          "#zs-video-preview-hide-muted-duplicates",
        );
        if (hideCheckbox) hideCheckbox.checked = deps.hideMutedDuplicates();
        const audioCheckbox = modal.querySelector(
          "#zs-video-preview-require-audio",
        );
        if (audioCheckbox) audioCheckbox.checked = deps.requireAudio();
        const autoCheckbox = modal.querySelector("#zs-video-preview-auto-show");
        if (autoCheckbox) autoCheckbox.checked = deps.autoShowVideo();
        const status = modal.querySelector("#zs-video-preview-status");
        if (status)
          status.textContent = !deps.enabled()
            ? "Off; no media scan or preview runs"
            : deps.compactPaused
              ? "Paused while the compact tabbar is hidden"
              : deps.diagnostics.lastError
                ? "Preview error: " + deps.diagnostics.lastError
                : deps.current
                  ? "Showing a media source"
                  : "On; choose a detected source below to show its preview";
        deps.refreshMethodStatus();
        deps.refreshSettingList();
        deps.refreshPlaybackStatus();
      }
      function hookSettings() {
        const instance = window.Zentral?.Settings;
        if (!instance || deps.settingsInstance) return;
        deps.settingsInstance = instance;
        deps.originalSettingsOpen = instance.open;
        deps.wrappedSettingsOpen = function (...args) {
          const result = deps.originalSettingsOpen.apply(this, args);
          injectSetting();
          return result;
        };
        instance.open = deps.wrappedSettingsOpen;
        injectSetting();
      }
      return { organizeVideoSettings, injectSetting, hookSettings };
    },
  );
})();
