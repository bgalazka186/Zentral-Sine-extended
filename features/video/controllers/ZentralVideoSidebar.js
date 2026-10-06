/*
 * ZENTRAL FILE GUIDE - features/video/controllers/ZentralVideoSidebar.js
 *
 * Purpose: Creates video card, source selector/buttons, seek/progress synchronization and
 *   compact/pinned/hidden UI state.
 * Interaction / execution: VideoPreview injects Discovery source identity, Rendering and Transport
 *   operations plus scheduling/visibility callbacks. VideoSettings/Diagnostics refresh card status and
 *   method lists.
 * Ownership / failure: Sidebar DOM/state belongs to the VideoPreview instance. Suspend owned hidden
 *   receivers and pair progress synchronization with resetProgressSync; Scheduling/owner cleanup stops
 *   timers.
 * Registration: video/ZentralVideoSidebar
 * Loaded/created by: features/video/ZentralVideoPreview.uc.js
 * Returned factory API: cancelResize; control; directControl; fitPicture; mount; progressVisible; refreshCard;
 *   refreshMethodStatus; refreshPlaybackStatus; refreshProgress; refreshSettingList; renderOptions;
 *   renderSidebarSources; resetProgressSync; select; setAutoHeight; setButtonIcon; setVideoHidden;
 *   showState; suspendHiddenReceiver; syncProgressState; toggleCompactCard; togglePin;
 *   updateProgressFromHealth; updateSeekProgress; wakePaint
 * Injected deps state/callbacks used: ACTOR; AUTO_HEIGHT_BUTTON_PREF; BUILD; CAPTIONS_PREF;
 *   COMPACT_BUTTON_PREF; COMPACT_STATE_PREF; DIRECT_DISCOVERY_NOTICE; DISPLAY_CAP_PREF; FRAMING_PREF;
 *   HEIGHT_PREF; HIDE_BUTTON_PREF; IDLE_TIMER_PREF; LIVE_MODES; PERF_DIAG_PREF; PIN_BUTTON_PREF;
 *   PROGRESS_REFRESH_MS; RENDER_MODES; STRICT_MODE_PREF; SUSPEND_HIDDEN_PREF; Services; VIDEO_HIDDEN_PREF;
 *   adaptiveWidth; autoShowVideo; box; browserReports; canOpenSourceTab; canvas; caption; captionNode;
 *   captionText; captureRateTenths; captureWorkMs; cardCompact; clearCaptionWatch; compactPaused;
 *   compactResumeSource; controlBar; cropStates; current; diagnostics; discoveryChoice; discoveryLocks;
 *   discoveryWinner; disposed; enabled; experimentalBridgeDisabled; fastCaptures; featureOn; fillWidth;
 *   framingChoice; healthIntervalMs; heightPx; hiddenByLayout; hideMutedDuplicates; injectSetting;
 *   lastExperiment; limited; methodDescription; methodName; methodState; metrics; muteButton;
 *   nextStillCapture; paint; pauseWhenCompactHidden; picture; pictureObserver; pinnedSource; playButton;
 *   powerOn; previewAutoSelected; previewBrowser; previewMode; previewModeNotice; previewTransitionReason;
 *   previewVisible; progressBusy; progressEpoch; progressNextAt; progressSourceKey; query; radiusPx;
 *   refreshCaption; refreshRendererOptions; renderBusy; rendererChoice; resetRendering; sameSource; scan;
 *   scanIntervalMs; scanTimer; seekBar; selectedModeOnly; setCaption; slowCaptures; sourceCapabilities;
 *   sourceCertainlyHidden; sourceKey; sourceLabel; sourceList; sourceVisibilityBlocked; sources;
 *   testingAll; updatePaintTimer; validMediaRequest; videoHidden; visibilityObserver; wakeTimer;
 *   widthPercent
 * Contract fields assigned here: deps.adaptiveWidth; deps.box; deps.box._autoButton;
 *   deps.box._autoButton.hidden; deps.box._compactButton; deps.box._compactButton.hidden;
 *   deps.box._compactButton.title; deps.box._framingButton; deps.box._framingButton.hidden;
 *   deps.box._framingButton.title; deps.box._grip; deps.box._grip.hidden; deps.box._hideButton;
 *   deps.box._nextButton; deps.box._nextButton.hidden; deps.box._openButton; deps.box._openButton.hidden;
 *   deps.box._pinButton; deps.box._pinButton.hidden; deps.box._pinButton.title; deps.box.hidden;
 *   deps.box.id; deps.canvas; deps.canvas.height; deps.canvas.width; deps.caption; deps.caption.className;
 *   deps.caption.style.cssText; deps.caption.textContent; deps.caption.title; deps.captionNode;
 *   deps.captionNode.className; deps.captionNode.hidden; deps.captureWorkMs; deps.cardCompact;
 *   deps.compactResumeSource; deps.controlBar; deps.controlBar.hidden; deps.current;
 *   deps.current.data.currentTime; deps.current.data.duration; deps.diagnostics.anchor; deps.fastCaptures;
 *   deps.heightPx; deps.muteButton; deps.muteButton.hidden; deps.muteButton.textContent;
 *   deps.muteButton.title; deps.muteButton.type; deps.nextStillCapture; deps.picture;
 *   deps.picture.className; deps.picture.hidden; deps.pictureObserver; deps.pinnedSource; deps.playButton;
 *   deps.playButton.hidden; deps.playButton.textContent; deps.playButton.title; deps.playButton.type;
 *   deps.previewAutoSelected; deps.previewModeNotice; deps.previewModeNotice.hidden;
 *   deps.previewModeNotice.style.cssText; deps.previewModeNotice.textContent; deps.progressBusy;
 *   deps.progressEpoch; deps.progressNextAt; deps.progressSourceKey; deps.seekBar; deps.seekBar.className;
 *   deps.seekBar.hidden; deps.seekBar.max; deps.seekBar.min; deps.seekBar.title; deps.seekBar.type;
 *   deps.seekBar.value; deps.slowCaptures; deps.sourceCapabilities; deps.sourceCapabilities.className;
 *   deps.sourceCapabilities.textContent; deps.sourceCapabilities.title; deps.sourceList;
 *   deps.sourceList.className; deps.sourceList.hidden; deps.sourceList.scrollTop; deps.videoHidden;
 *   deps.visibilityObserver; deps.wakeTimer
 * Literal DOM event subscriptions: change; click; contextmenu; dblclick; lostpointercapture; pointerdown;
 *   pointermove
 *
 * Resize lifecycle: cancelResize releases the grip pointer and transient listeners without saving during teardown.
 *   Pointerup/cancel/lostcapture and window blur end an ordinary gesture; VideoPreview.destroy calls cancelResize.
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("video/ZentralVideoSidebar", function (deps) {
        let finishResize = null;
        function cancelResize() { finishResize?.({ cancel: true }); }
        function mount() {
          if (deps.disposed || !deps.enabled() || deps.compactPaused) return;
          const visibleParent = (element) => {
            for (
              let parent = element?.parentElement;
              parent;
              parent = parent.parentElement
            )
              if (getComputedStyle(parent).display === "none") return false;
            return true;
          };
          const controls = [
            "zen-media-controls-toolbar",
            "zen-sidebar-bottom-buttons",
            "tabbrowser-tabs",
            "vertical-tabs",
          ]
            .map((id) => document.getElementById(id))
            .find((node) => node?.parentNode && visibleParent(node));
          if (!controls?.parentNode) {
            deps.diagnostics.anchor = "No visible Zen sidebar anchor found";
            return;
          }
          deps.diagnostics.anchor = controls.id;
          if (!deps.box) {
            deps.box = document.createElement("div");
            deps.box.id = "zentral-video-preview";
            deps.box.hidden = true;
            deps.box.setAttribute("aria-label", "Playing video preview");
            deps.picture = document.createElement("div");
            deps.picture.className = "zentral-video-preview-picture";
            deps.canvas = document.createElement("canvas");
            deps.picture.appendChild(deps.canvas);
            deps.captionNode = document.createElement("div");
            deps.captionNode.className = "zentral-video-preview-subtitles";
            deps.captionNode.hidden = true;
            deps.picture.appendChild(deps.captionNode);
            deps.previewModeNotice = document.createElement("div");
            deps.previewModeNotice.setAttribute("role", "status");
            deps.previewModeNotice.style.cssText =
              "position:absolute;inset:0;z-index:5;background:#111;color:white;padding:12px;align-items:center;justify-content:center;text-align:center;font:12px sans-serif;pointer-events:none";
            deps.previewModeNotice.hidden = true;
            deps.picture.appendChild(deps.previewModeNotice);
            deps.pictureObserver = new ResizeObserver(() => {
              if (deps.featureOn(deps.DISPLAY_CAP_PREF)) deps.nextStillCapture = 0;
              wakePaint();
            });
            deps.pictureObserver.observe(deps.picture);
            deps.sourceList = document.createElement("div");
            deps.sourceList.className = "zentral-video-preview-sources";
            deps.sourceList.setAttribute("role", "listbox");
            deps.sourceList.setAttribute(
              "aria-label",
              "Detected videos; click one to preview",
            );
            deps.sourceCapabilities = document.createElement("span");
            deps.sourceCapabilities.className = "zentral-video-preview-capabilities";
            deps.controlBar = document.createElement("div");
            const bar = deps.controlBar;
            bar.className = "zentral-video-preview-bar";
            deps.caption = document.createElement("span");
            deps.caption.className = "zentral-video-preview-caption";
            deps.playButton = document.createElement("button");
            deps.playButton.type = "button";
            deps.playButton.title = "Play or pause source";
            deps.playButton.addEventListener("click", () => control("toggle"));
            deps.muteButton = document.createElement("button");
            deps.muteButton.type = "button";
            deps.muteButton.title = "Mute or unmute source";
            deps.muteButton.addEventListener("click", () => control("mute"));
            deps.seekBar = document.createElement("input");
            deps.seekBar.type = "range";
            deps.seekBar.className = "zentral-video-preview-seek";
            deps.seekBar.min = "0";
            deps.seekBar.max = "1000";
            deps.seekBar.value = "0";
            deps.seekBar.title = "Seek video or audio";
            deps.seekBar.addEventListener("change", () => {
              const duration = deps.current?.data?.duration;
              if (duration)
                control("seek", (Number(deps.seekBar.value) / 1000) * duration);
            });
            const next = document.createElement("button");
            next.type = "button";
            next.title = "Next detected source";
            next.textContent = "⇄";
            next.addEventListener("click", () => {
              if (deps.sources.length < 2) return;
              const index = deps.sources.findIndex((item) =>
                deps.sameSource(item, deps.current),
              );
              select(deps.sources[(index + 1) % deps.sources.length]);
            });
            const open = document.createElement("button");
            open.type = "button";
            open.title = "Open source tab";
            open.textContent = "↗";
            open.addEventListener("click", () => {
              if (deps.canOpenSourceTab(deps.current)) gBrowser.selectedTab = deps.current.tab;
            });
            bar.append(deps.playButton, deps.caption, deps.muteButton, next, open);
            const grip = document.createElement("div");
            grip.className = "zentral-video-preview-resize";
            grip.setAttribute("role", "separator");
            grip.title =
              "Drag up/down to change video height; double-click for Auto height";
            grip.addEventListener("pointerdown", (event) => {
              if (event.button !== 0) return;
              cancelResize();
              const pointerId = event.pointerId;
              const startY = event.clientY;
              const initial =
                deps.heightPx || deps.picture.getBoundingClientRect().height || 180;
              try { grip.setPointerCapture(pointerId); } catch (_) { return; }
              const move = (e) => {
                if (e.pointerId !== pointerId) return;
                deps.heightPx = Math.round(
                  Math.max(90, Math.min(800, initial + e.clientY - startY)),
                );
                fitPicture();
              };
              const end = (e) => {
                if (e?.pointerId != null && e.pointerId !== pointerId) return;
                if (finishResize !== end) return;
                finishResize = null;
                grip.removeEventListener("pointermove", move);
                grip.removeEventListener("lostpointercapture", end);
                grip.removeEventListener("pointerup", end);
                grip.removeEventListener("pointercancel", end);
                window.removeEventListener("blur", end);
                try { if (grip.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId); } catch (_) {}
                if (e?.cancel) return;
                deps.Services.prefs.setIntPref(deps.HEIGHT_PREF, deps.heightPx);
                deps.injectSetting();
              };
              finishResize = end;
              grip.addEventListener("pointermove", move);
              grip.addEventListener("lostpointercapture", end);
              grip.addEventListener("pointerup", end);
              grip.addEventListener("pointercancel", end);
              window.addEventListener("blur", end);
              event.preventDefault();
            });
            grip.addEventListener("dblclick", () => {
              setAutoHeight();
            });
            const hideButton = document.createElement("button");
            hideButton.type = "button";
            hideButton.className = "zentral-video-preview-hide";
            hideButton.addEventListener("click", () =>
              setVideoHidden(!deps.videoHidden),
            );
            const autoButton = document.createElement("button");
            autoButton.type = "button";
            autoButton.className = "zentral-video-preview-auto";
            setButtonIcon(autoButton, "auto");
            autoButton.title = "Restore automatic video height";
            autoButton.setAttribute("aria-label", autoButton.title);
            autoButton.addEventListener("click", setAutoHeight);
            const framingButton = document.createElement("button");
            framingButton.type = "button";
            framingButton.className = "zentral-video-preview-framing";
            framingButton.textContent = "▣";
            framingButton.style.touchAction = "none";
            framingButton.addEventListener("contextmenu", (event) =>
              event.preventDefault(),
            );
            let framingHold = null;
            let heldFraming = false;
            framingButton.addEventListener("pointerdown", (event) => {
              if (event.button !== 0) return;
              heldFraming = false;
              clearTimeout(framingHold);
              framingHold = setTimeout(() => {
                framingHold = null;
                heldFraming = true;
                deps.Services.prefs.setStringPref(deps.FRAMING_PREF, "contain");
                deps.cropStates.clear();
                if (deps.current?.data) {
                  delete deps.current.data.displayWidth;
                  delete deps.current.data.displayHeight;
                }
                fitPicture();
                deps.nextStillCapture = 0;
                if (deps.LIVE_MODES.includes(deps.previewMode)) deps.resetRendering();
                deps.paint();
                refreshCard();
                deps.injectSetting();
              }, 650);
            });
            for (const type of ["pointerup", "pointercancel", "pointerleave"])
              framingButton.addEventListener(type, () => {
                clearTimeout(framingHold);
                framingHold = null;
              });
            framingButton.addEventListener("click", (event) => {
              if (heldFraming) {
                event.preventDefault();
                heldFraming = false;
                return;
              }
              deps.Services.prefs.setStringPref(deps.FRAMING_PREF, "auto");
              if (deps.current)
                deps.cropStates.set(deps.sourceKey(deps.current), { checkNow: true });
              if (deps.current?.data) {
                delete deps.current.data.displayWidth;
                delete deps.current.data.displayHeight;
              }
              fitPicture();
              deps.nextStillCapture = 0;
              if (deps.LIVE_MODES.includes(deps.previewMode)) deps.resetRendering();
              deps.paint();
              refreshCard();
              deps.injectSetting();
            });
            const pinButton = document.createElement("button");
            pinButton.type = "button";
            pinButton.className = "zentral-video-preview-pin";
            setButtonIcon(pinButton, "pin");
            pinButton.addEventListener("click", togglePin);
            const compactButton = document.createElement("button");
            compactButton.type = "button";
            compactButton.className = "zentral-video-preview-compact";
            setButtonIcon(compactButton, "compact");
            compactButton.addEventListener("click", toggleCompactCard);
            bar.append(
              autoButton,
              framingButton,
              hideButton,
              pinButton,
              compactButton,
            );
            deps.box.append(
              deps.sourceList,
              deps.sourceCapabilities,
              deps.picture,
              grip,
              deps.seekBar,
              bar,
            );
            bar.style.cssText =
              "display:flex!important;flex:0 0 auto!important;flex-wrap:nowrap!important;align-items:center!important;gap:2px!important;width:100%!important;min-width:0!important;height:auto!important;max-height:none!important;box-sizing:border-box!important;overflow:hidden!important";
            deps.caption.style.cssText =
              "flex:1 999 auto!important;min-width:0!important;overflow:hidden!important;white-space:nowrap!important;text-overflow:ellipsis!important";
            for (const button of bar.querySelectorAll("button")) {
              button.style.cssText =
                "position:static!important;inset:auto!important;transform:none!important;float:none!important;box-sizing:border-box!important;flex:0 1 26px!important;width:26px!important;min-width:18px!important;max-width:26px!important;height:26px!important;min-height:26px!important;max-height:26px!important;margin:0!important;padding:0!important;overflow:hidden!important;align-items:center!important;justify-content:center!important;color:white!important";
            }
            deps.box._nextButton = next;
            deps.box._openButton = open;
            deps.box._grip = grip;
            deps.box._hideButton = hideButton;
            deps.box._autoButton = autoButton;
            deps.box._framingButton = framingButton;
            deps.box._pinButton = pinButton;
            deps.box._compactButton = compactButton;
          }
          const attached =
            deps.box.parentNode !== controls.parentNode ||
            deps.box.previousSibling !== controls;
          if (attached) controls.after(deps.box);
          if (
            !deps.visibilityObserver &&
            typeof IntersectionObserver === "function"
          ) {
            try {
              deps.visibilityObserver = new IntersectionObserver((entries) => {
                if (entries[0]?.isIntersecting) wakePaint();
                else {
                  suspendHiddenReceiver();
                  if (deps.featureOn(deps.IDLE_TIMER_PREF)) deps.updatePaintTimer(false);
                }
              });
              deps.visibilityObserver.observe(deps.box);
            } catch (_) {
              deps.visibilityObserver?.disconnect();
              deps.visibilityObserver = null;
            }
          }
          // The first scan can finish before Zen creates a visible sidebar anchor.
          // A later mount must reveal and populate the card on its own.
          if (attached) {
            if (deps.current) select(deps.current, true, deps.previewAutoSelected);
            else refreshCard();
          }
        }
        function setButtonIcon(button, kind) {
          if (button._zvpIcon === kind) return;
          button._zvpIcon = kind;
          const ns = "http://www.w3.org/2000/svg";
          const svg = document.createElementNS(ns, "svg");
          svg.setAttribute("viewBox", "0 0 24 24");
          svg.setAttribute("aria-hidden", "true");
          svg.style.cssText =
            "display:block!important;width:16px!important;height:16px!important;flex:0 0 16px!important;position:static!important;pointer-events:none!important";
          const path = document.createElementNS(ns, "path");
          const paths = {
            pin: "M16 9V4l1-1V2H7v1l1 1v5c0 1.66-1.34 3-3 3v2h6v7l1 1 1-1v-7h6v-2c-1.66 0-3-1.34-3-3z",
            compact: "M3 3l6 6m0-5v5H4M21 21l-6-6m0 5v-5h5",
            expand: "M9 9 3 3m0 5V3h5m7 12 6 6m-5 0h5v-5",
            auto: "M12 3v18m-5-5 5 5 5-5M7 8l5-5 5 5M4 12h16",
          };
          path.setAttribute("d", paths[kind]);
          path.style.cssText =
            kind === "pin"
              ? "fill:white!important;stroke:none!important"
              : "fill:none!important;stroke:white!important;stroke-width:2!important;stroke-linecap:round!important;stroke-linejoin:round!important";
          svg.appendChild(path);
          button.replaceChildren(svg);
        }
        function fitPicture() {
          if (!deps.picture) return;
          const data = deps.current?.data;
          const width = data?.displayWidth || data?.width;
          const height = data?.displayHeight || data?.height;
          deps.picture.style.setProperty(
            "--zvp-ratio",
            width && height ? `${width} / ${height}` : "16 / 9",
          );
          deps.picture.style.setProperty(
            "--zvp-width",
            (deps.fillWidth() ? 100 : deps.widthPercent) + "%",
          );
          deps.picture.style.setProperty(
            "--zvp-height",
            deps.heightPx ? deps.heightPx + "px" : "auto",
          );
          deps.picture.style.setProperty(
            "--zvp-object-fit",
            deps.framingChoice() === "contain" ? "contain" : "cover",
          );
          deps.picture.style.setProperty("--zvp-radius", deps.radiusPx + "px");
          deps.box?.style.setProperty("--zvp-radius", deps.radiusPx + "px");
        }
        function setAutoHeight() {
          deps.heightPx = 0;
          deps.Services.prefs.setIntPref(deps.HEIGHT_PREF, 0);
          fitPicture();
          refreshCard();
          deps.injectSetting();
        }
        function togglePin() {
          if (!deps.featureOn(deps.PIN_BUTTON_PREF)) return;
          deps.pinnedSource = deps.pinnedSource
            ? null
            : deps.current && {
                browser: deps.current.browser,
                frameId: deps.current.data.frameId,
                id: deps.current.data.id,
              };
          refreshCard();
          if (!deps.pinnedSource && deps.enabled()) deps.scan(true);
        }
        function toggleCompactCard() {
          deps.cardCompact = !deps.cardCompact;
          deps.Services.prefs.setBoolPref(deps.COMPACT_STATE_PREF, deps.cardCompact);
          refreshCard();
          wakePaint();
        }
        function setVideoHidden(hidden) {
          deps.videoHidden = !!hidden;
          deps.Services.prefs.setBoolPref(deps.VIDEO_HIDDEN_PREF, deps.videoHidden);
          if (deps.videoHidden) {
            deps.clearCaptionWatch();
            deps.resetRendering();
            deps.setCaption("");
          } else deps.nextStillCapture = 0;
          refreshCard();
          if (!deps.videoHidden && deps.current) wakePaint();
        }
        function suspendHiddenReceiver() {
          syncProgressState();
          if (!deps.powerOn(deps.SUSPEND_HIDDEN_PREF) || deps.testingAll || deps.previewVisible())
            return;
          if (deps.previewBrowser || deps.renderBusy) deps.resetRendering();
          deps.clearCaptionWatch();
          deps.updatePaintTimer(false);
        }
        function wakePaint() {
          if (
            deps.disposed ||
            !deps.enabled() ||
            deps.compactPaused ||
            deps.videoHidden ||
            !deps.current
          )
            return;
          if (!deps.previewVisible()) {
            suspendHiddenReceiver();
            return;
          }
          deps.updatePaintTimer(true);
          if (!deps.wakeTimer)
            deps.wakeTimer = setTimeout(() => {
              deps.wakeTimer = null;
              deps.paint();
            }, 0);
        }
        function renderOptions(list) {
          if (!list) return;
          const previous = list.value;
          const fragment = document.createDocumentFragment();
          for (const source of deps.sources) {
            const option = document.createElement("option");
            option.value = deps.sourceKey(source);
            option.textContent = deps.sourceLabel(source);
            fragment.appendChild(option);
          }
          list.replaceChildren(fragment);
          if (
            previous &&
            [...list.options].some((option) => option.value === previous)
          )
            list.value = previous;
          else
            list.selectedIndex = deps.sources.findIndex((item) =>
              deps.sameSource(item, deps.current),
            );
        }
        function renderSidebarSources() {
          if (!deps.sourceList) return;
          const scrollTop = deps.sourceList.scrollTop;
          const fragment = document.createDocumentFragment();
          for (const source of deps.sources) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "zentral-video-preview-source";
            button.setAttribute("role", "option");
            button.setAttribute(
              "aria-selected",
              deps.sameSource(source, deps.current) ? "true" : "false",
            );
            button.textContent = deps.sourceLabel(source);
            button.title = button.textContent;
            button.addEventListener("click", () => select(source));
            fragment.appendChild(button);
          }
          deps.sourceList.replaceChildren(fragment);
          deps.sourceList.scrollTop = scrollTop;
        }
        function refreshCard() {
          if (!deps.box) return;
          deps.box.hidden = !deps.enabled();
          deps.box.toggleAttribute(
            "data-compact-card",
            deps.cardCompact && deps.featureOn(deps.COMPACT_BUTTON_PREF),
          );
          renderSidebarSources();
          deps.refreshRendererOptions();
          deps.sourceList.hidden = !deps.sources.length;
          deps.picture.hidden = deps.current?.data.kind !== "video" || deps.videoHidden;
          const hasVideo = deps.current?.data.kind === "video";
          const hideButton = deps.box._hideButton;
          hideButton.hidden = !hasVideo || !deps.featureOn(deps.HIDE_BUTTON_PREF);
          hideButton.textContent = deps.videoHidden ? "◉" : "◌";
          hideButton.title = deps.videoHidden
            ? "Show video preview"
            : "Hide video preview";
          hideButton.setAttribute("aria-label", hideButton.title);
          hideButton.setAttribute("aria-pressed", String(deps.videoHidden));
          deps.box._autoButton.hidden =
            !hasVideo || !deps.heightPx || !deps.featureOn(deps.AUTO_HEIGHT_BUTTON_PREF);
          deps.box._autoButton.setAttribute(
            "aria-label",
            "Restore automatic video height",
          );
          deps.box._framingButton.hidden = !hasVideo;
          deps.box._framingButton.title =
            deps.framingChoice() === "contain"
              ? "Show complete image. Click to check for black borders; hold to keep complete image"
              : "Check black borders again; hold to show complete image";
          deps.box._framingButton.setAttribute(
            "aria-label",
            deps.box._framingButton.title,
          );
          deps.box._framingButton.setAttribute(
            "aria-pressed",
            String(deps.framingChoice() === "contain"),
          );
          deps.box._pinButton.hidden =
            !deps.featureOn(deps.PIN_BUTTON_PREF) || (!hasVideo && !deps.pinnedSource);
          deps.box._pinButton.title = deps.pinnedSource
            ? "Unpin source"
            : "Pin this source";
          deps.box._pinButton.setAttribute("aria-label", deps.box._pinButton.title);
          deps.box._pinButton.setAttribute("aria-pressed", String(!!deps.pinnedSource));
          deps.box._compactButton.hidden = !deps.featureOn(deps.COMPACT_BUTTON_PREF);
          setButtonIcon(deps.box._compactButton, deps.cardCompact ? "expand" : "compact");
          deps.box._compactButton.title = deps.cardCompact
            ? "Expand video card"
            : "Compact video card";
          deps.box._compactButton.setAttribute(
            "aria-label",
            deps.box._compactButton.title,
          );
          deps.box._compactButton.setAttribute("aria-pressed", String(deps.cardCompact));
          deps.box._grip.hidden = !hasVideo || deps.videoHidden;
          if (deps.captionNode)
            deps.captionNode.hidden =
              !deps.captionText || deps.videoHidden || !deps.featureOn(deps.CAPTIONS_PREF);
          deps.seekBar.hidden = !deps.current?.data.duration;
          deps.controlBar.hidden = false;
          deps.box._openButton.hidden = !deps.canOpenSourceTab(deps.current);
          if (!deps.current) {
            deps.caption.textContent = deps.sources.length
              ? deps.pinnedSource
                ? "Pinned source unavailable · unpin to switch"
                : "Choose a source"
              : deps.diagnostics.lastError
                ? "Video scan error · open Video Cloning"
                : deps.discoveryChoice() === "direct"
                  ? "Direct only · no locally accessible video"
                  : deps.diagnostics.inspected
                    ? "No video sources found"
                    : "Scanning video sources…";
            deps.caption.title =
              deps.discoveryChoice() === "direct" ? deps.DIRECT_DISCOVERY_NOTICE : "";
            deps.playButton.hidden =
              deps.muteButton.hidden =
              deps.box._nextButton.hidden =
              deps.box._openButton.hidden =
                true;
          } else deps.playButton.hidden = deps.muteButton.hidden = false;
          refreshSettingList();
          syncProgressState();
        }
        async function control(action, value) {
          const source = deps.current;
          if (!source) return;
          try {
            const payload = {
              frameId: source.data.frameId,
              id: source.data.id,
              action,
              value,
              pageMediaKey: source.data.pageMediaKey,
              currentSrc: source.data.currentSrc,
            };
            const data =
              source.method === "frame"
                ? await deps.query(source.browser, "Control", payload)
                : source.method === "actor"
                  ? await source.context.currentWindowGlobal
                      .getActor(deps.ACTOR)
                      .sendQuery("Control", payload)
                  : directControl(source.element, action, value, payload);
            if (!deps.disposed && data && deps.sameSource(source, deps.current)) {
              Object.assign(source.data, data);
              showState();
            }
          } catch (_) {
            /* The source navigated before the control arrived. */
          }
        }
        function directControl(media, action, value, expected = {}) {
          if (!deps.validMediaRequest(media, expected)) return null;
          if (action === "toggle") {
            if (media.paused) media.play().catch(() => {});
            else media.pause();
          } else if (action === "mute") media.muted = !media.muted;
          else if (
            action === "seek" &&
            Number.isFinite(value) &&
            Number.isFinite(media.duration)
          )
            media.currentTime = Math.max(0, Math.min(media.duration, value));
          return {
            paused: media.paused,
            muted: media.muted,
            currentTime: media.currentTime,
            duration: Number.isFinite(media.duration) ? media.duration : 0,
          };
        }
        function progressVisible() {
          return (
            !deps.disposed &&
            deps.enabled() &&
            !deps.compactPaused &&
            !!deps.scanTimer &&
            !!deps.current &&
            Number.isFinite(deps.current.data.duration) &&
            deps.current.data.duration > 0 &&
            !!deps.seekBar?.isConnected &&
            !deps.seekBar.hidden &&
            deps.previewVisible() &&
            !deps.hiddenByLayout(deps.seekBar)
          );
        }
        function resetProgressSync() {
          deps.progressSourceKey = "";
          deps.progressNextAt = 0;
          ++deps.progressEpoch;
        }
        function updateSeekProgress(data) {
          if (
            !progressVisible() ||
            document.activeElement === deps.seekBar ||
            !Number.isFinite(data.currentTime) ||
            !Number.isFinite(data.duration) ||
            data.duration <= 0
          )
            return;
          deps.seekBar.value = String(
            Math.round(
              1000 * Math.max(0, Math.min(1, data.currentTime / data.duration)),
            ),
          );
        }
        function syncProgressState() {
          if (!progressVisible()) {
            if (deps.progressSourceKey) resetProgressSync();
            return;
          }
          const key = deps.sourceKey(deps.current);
          if (deps.progressSourceKey !== key) {
            resetProgressSync();
            deps.progressSourceKey = key;
          }
          // Live health IPC already supplies fresh source time. Do not query it
          // twice. Still modes use the existing mount/event schedule, not a timer.
          if (
            deps.LIVE_MODES.includes(deps.previewMode) ||
            deps.progressBusy ||
            Date.now() < deps.progressNextAt
          )
            return;
          refreshProgress();
        }
        function updateProgressFromHealth(source, state) {
          if (
            !deps.sameSource(source, deps.current) ||
            !progressVisible() ||
            !Number.isFinite(state?.time)
          )
            return;
          const key = deps.sourceKey(deps.current);
          if (deps.progressSourceKey !== key) {
            resetProgressSync();
            deps.progressSourceKey = key;
          }
          if (Date.now() < deps.progressNextAt || document.activeElement === deps.seekBar)
            return;
          deps.current.data.currentTime = state.time;
          updateSeekProgress(deps.current.data);
          deps.progressNextAt =
            Date.now() +
            Math.max(
              1000,
              deps.PROGRESS_REFRESH_MS - deps.healthIntervalMs(deps.previewMode) / 2,
            );
        }
        async function refreshProgress() {
          if (!progressVisible() || deps.progressBusy) return;
          const source = deps.current,
            epoch = deps.progressEpoch;
          const documentId = source.context?.currentWindowGlobal?.innerWindowId;
          deps.progressNextAt = Date.now() + deps.PROGRESS_REFRESH_MS;
          deps.progressBusy = true;
          try {
            // Existing Control handlers return state for this read-only action.
            // No full discovery, pixel capture or source playback change is needed.
            if (document.activeElement === deps.seekBar) return;
            const payload = {
              frameId: source.data.frameId,
              id: source.data.id,
              action: "state",
              pageMediaKey: source.data.pageMediaKey,
              currentSrc: source.data.currentSrc,
            };
            const data =
              source.method === "frame"
                ? await deps.query(source.browser, "Control", payload)
                : source.method === "actor"
                  ? await deps.limited(
                      source.context.currentWindowGlobal
                        .getActor(deps.ACTOR)
                        .sendQuery("Control", payload),
                      1500,
                      "progress state",
                    )
                  : directControl(source.element, "state", payload);
            if (
              epoch !== deps.progressEpoch ||
              !deps.sameSource(source, deps.current) ||
              source.context?.currentWindowGlobal?.innerWindowId !==
                documentId ||
              !progressVisible() ||
              !data
            )
              return;
            // Update only progress fields; renderers and discovery retain ownership
            // of their own state and scheduling.
            deps.current.data.currentTime = data.currentTime;
            deps.current.data.duration = data.duration;
            deps.seekBar.hidden =
              !Number.isFinite(data.duration) || data.duration <= 0;
            updateSeekProgress(data);
          } catch (_) {
            // Navigation or an unavailable transport should not change renderer.
          } finally {
            deps.progressBusy = false;
          }
        }
        function showState() {
          if (!deps.current || !deps.box) return;
          const data = deps.current.data;
          fitPicture();
          deps.picture.hidden = data.kind !== "video" || deps.videoHidden;
          deps.playButton.textContent = data.paused ? "▶" : "❚❚";
          deps.muteButton.textContent = data.muted ? "🔇" : "♪";
          deps.seekBar.hidden = !data.duration;
          updateSeekProgress(data);
          syncProgressState();
        }
        function select(source, force = false, automatic = false) {
          if (!source?.browser?.isConnected) return;
          const changed = !deps.sameSource(deps.current, source) || force;
          if (changed && !automatic) deps.compactResumeSource = null;
          if (deps.pinnedSource && !automatic)
            deps.pinnedSource = {
              browser: source.browser,
              frameId: source.data.frameId,
              id: source.data.id,
            };
          if (changed) deps.previewAutoSelected = automatic;
          if (changed && deps.canvas) {
            deps.clearCaptionWatch();
            deps.setCaption("");
            deps.adaptiveWidth = deps.slowCaptures = deps.fastCaptures = 0;
            deps.captureWorkMs = 0;
            deps.nextStillCapture = 0;
            deps.canvas.width = 1;
            deps.canvas.height = 1;
          }
          if (deps.framingChoice() === "auto") {
            const saved = deps.cropStates.get(deps.sourceKey(source));
            if (saved?.checked) {
              source.data.displayWidth = saved.displayWidth;
              source.data.displayHeight = saved.displayHeight;
            }
          }
          deps.current = source;
          mount();
          if (!deps.box?.isConnected) return;
          deps.box.hidden = false;
          deps.caption.textContent = source.panel
            ? source.browser.contentTitle ||
              source.browser._bgalazkaAppId ||
              "Panel media"
            : source.tab?.label || "Playing video";
          deps.caption.title = deps.caption.textContent;
          deps.box._nextButton.hidden = deps.sources.length < 2;
          deps.box._openButton.hidden = !deps.canOpenSourceTab(source);
          showState();
          refreshCard();
          if (changed) {
            deps.resetRendering();
            deps.refreshCaption();
            if (source.data.kind === "video") deps.paint();
          }
        }
        function refreshMethodStatus() {
          const node = document.getElementById("zs-video-preview-bridges");
          if (node)
            node.textContent =
              `Build: ${deps.BUILD}\n` +
              Object.entries(deps.methodState)
                .map(([name, result]) => `${name}: ${result}`)
                .join("\n") +
              `\nExperimental bridge: ${deps.experimentalBridgeDisabled() ? "disabled" : "enabled (restart after bridge updates)"}` +
              `\nDiscovery: ${deps.discoveryChoice()} (using ${deps.discoveryWinner || "probing"}; ${deps.scanIntervalMs() ? deps.scanIntervalMs() / 1000 + " s checks" : "events/manual only"})` +
              `\nActive renderer: ${deps.previewMode || "searching"} (setting: ${deps.rendererChoice()})` +
              (!deps.experimentalBridgeDisabled() && deps.lastExperiment
                ? `\nExperiment: ${JSON.stringify(deps.lastExperiment)}`
                : "") +
              `\nAuto-show: ${deps.autoShowVideo() ? "on" : "off"}; hide muted copies: ${deps.hideMutedDuplicates() ? "on" : "off"}` +
              `\nSource tab hidden (informational): ${deps.current ? deps.sourceCertainlyHidden(deps.current) : "no source"}` +
              `\nDiscovery calls: ${deps.metrics.discoveryCalls}; last scan: ${Math.round(deps.metrics.lastScanMs)} ms elapsed` +
              `\nCompact tabbar pause: ${deps.compactPaused ? "paused" : deps.pauseWhenCompactHidden() ? "enabled" : "off"}` +
              `\nStill captures target: ${deps.captureRateTenths() / 10} fps` +
              `\nCaptured frames: ${deps.metrics.frames}; mean capture: ${Math.round(deps.metrics.captureMs / Math.max(1, deps.metrics.frames))} ms elapsed` +
              (deps.featureOn(deps.PERF_DIAG_PREF)
                ? `\nStill-frame effective rate: ${deps.metrics.effectiveFps} fps; skipped duplicate frames: ${deps.metrics.skippedFrames}` +
                  `\nCanvas payload: ${(deps.metrics.bytes / 1048576).toFixed(1)} MiB total; mean active paint pass: ${Math.round(deps.metrics.paintMs / Math.max(1, deps.metrics.paintPasses))} ms; failures: ${deps.metrics.failures}` +
                  ["raw", "jpeg"]
                    .map((mode) => {
                      const row = deps.metrics.transport[mode];
                      return `\n${mode}: ${row.frames} frames; mean ${Math.round(row.ms / Math.max(1, row.frames))} ms; ${(row.bytes / 1048576).toFixed(1)} MiB`;
                    })
                    .join("")
                : "") +
              "\n\nRecent browser probes (candidate counts):\n" +
              [...deps.browserReports.values()]
                .slice(-12)
                .map(
                  (report) =>
                    `${report.label}: actor ${report.actor}, frame ${report.frame}, direct ${report.direct}; using ${deps.discoveryLocks.get(report.browser) || "probing"}`,
                )
                .join("\n");
        }
        function refreshPlaybackStatus() {
          const choice = deps.rendererChoice(),
            strict = deps.selectedModeOnly();
          const fallback =
            deps.previewMode &&
            (choice === "auto"
              ? deps.RENDER_MODES.indexOf(deps.previewMode) > 0
              : deps.previewMode !== choice);
          const reason = deps.sourceVisibilityBlocked
            ? "Source video is visible; native cloning deferred"
            : deps.previewTransitionReason;
          const status = deps.previewMode
            ? "Active: " +
              deps.methodName(deps.previewMode) +
              (fallback ? " · fallback" : "")
            : (strict ? "Selected mode only: " : "Waiting for ") +
              deps.methodName(choice);
          const text =
            status +
            (reason && (fallback || !deps.previewMode) ? " · " + reason : "");
          const node = document.getElementById("zs-video-preview-active-mode");
          if (node) node.textContent = text;
          if (deps.sourceCapabilities) {
            deps.sourceCapabilities.textContent =
              deps.current?.data.kind === "video" ? text : "";
            deps.sourceCapabilities.title = text;
          }
          const methodHelp = document.getElementById(
            "zs-video-preview-method-help",
          );
          if (methodHelp) methodHelp.textContent = deps.methodDescription(choice);
          const force = document.getElementById(
            "zs-video-preview-selected-mode-only",
          );
          if (force) {
            force.checked = deps.Services.prefs.getBoolPref(deps.STRICT_MODE_PREF, false);
            force.disabled = choice === "auto";
          }
          if (deps.previewModeNotice) {
            const waiting =
              strict &&
              deps.current?.data.kind === "video" &&
              deps.previewMode !== choice;
            deps.previewModeNotice.hidden = !waiting;
            deps.previewModeNotice.style.setProperty(
              "display",
              waiting ? "flex" : "none",
              "important",
            );
            deps.previewModeNotice.textContent = text;
            if (waiting && deps.canvas) {
              deps.canvas.width = 1;
              deps.canvas.height = 1;
            }
          }
        }
        function refreshSettingList() {
          const modal = document.getElementById("zentral-settings-modal");
          renderOptions(modal?.querySelector("#zs-video-preview-sources"));
          const status = modal?.querySelector("#zs-video-preview-status");
          if (status && deps.enabled() && !deps.diagnostics.lastError)
            status.textContent = deps.sources.length
              ? `${deps.sources.length} source${deps.sources.length === 1 ? "" : "s"} found; choose one below`
              : deps.discoveryChoice() === "direct"
                ? "Direct only; no locally accessible video found. " +
                  deps.DIRECT_DISCOVERY_NOTICE
                : "On; scanning open tabs and panels for video";
          deps.refreshRendererOptions();
          refreshMethodStatus();
        }
return { cancelResize, mount, setButtonIcon, fitPicture, setAutoHeight, togglePin, toggleCompactCard, setVideoHidden, suspendHiddenReceiver, wakePaint, renderOptions, renderSidebarSources, refreshCard, control, directControl, progressVisible, resetProgressSync, updateSeekProgress, syncProgressState, updateProgressFromHealth, refreshProgress, showState, select, refreshMethodStatus, refreshPlaybackStatus, refreshSettingList };
});
})();
