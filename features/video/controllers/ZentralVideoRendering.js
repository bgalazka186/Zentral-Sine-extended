/*
 * ZENTRAL FILE GUIDE - features/video/controllers/ZentralVideoRendering.js
 *
 * Purpose: Owns receiver creation, live preview/still capture, fallback canvas ownership, render
 *   health/probing and source presentation refresh.
 * Interaction / execution: VideoPreview injects Transport/playerQuery, Sidebar UI state, Discovery
 *   visibility callbacks and scheduler update callbacks. Source content helpers attach authorized decoded
 *   output to the receiver.
 * Ownership / failure: disposePlayer/resetRendering release only owned receiver/clones/tracks. Restore the
 *   fallback on failure; remove its covering canvas only after live rendering is verified. Preserve source
 *   media playback/audio.
 * Registration: video/ZentralVideoRendering
 * Loaded/created by: features/video/ZentralVideoPreview.uc.js
 * Returned factory API: captureSnapshot; captureVideo; detectContentRect; disposePlayer;
 *   experimentWindowIdentity; hideExperimentFallback; markUnavailable; paint; previewVisible;
 *   refreshRendererOptions; refreshRendererSource; resetRendering; restoreExperimentFallback;
 *   seedExperimentFallback; startLivePreview; unavailableReason
 * Injected deps state/callbacks used: ACTOR; BINARY_FRAMES_PREF; BUILD; CROP_DELAY_MS;
 *   EXPERIMENTAL_FRAME_URI; EXPERIMENT_HELPER_ID; FRAME_AWARE_PREF; FRAME_URI; KEEP_VISIBLE_PREF;
 *   LEGACY_CAPTURE_PREF; LIGHT_MONITOR_PREF; LIVE_MODES; POLL_MS; RENDER_MODES; RETRY_BACKOFF_PREF;
 *   SUSPEND_VISIBLE_PREF; Services; WORKING_MODES; box; bridges; canvas; canvasStreamFps;
 *   canvasStreamWidth; captureDimension; captureIntervalMs; captureWorkMs; clearCaptionWatch;
 *   compactPaused; cropStates; current; decodedCanvas; discoveryCache; discoveryChoice; disposed; enabled;
 *   experimentCanvasAnchor; experimentFallbackGeneration; experimentalBridgeDisabled; failedRenderers;
 *   featureOn; fitPicture; framingChoice; healthIntervalMs; inspectFrame; lastExperiment; lastHealth;
 *   lastPaintStatusAt; limited; liveBridgeEnabled; liveModeEnabled; liveSourceVisible; methodError;
 *   methodName; methodState; metrics; nextHealthCheck; nextRenderProbe; nextStillCapture; noPictureChecks;
 *   picture; pinnedSource; playerQuery; powerOn; previewBrowser; previewGeneration; previewMode;
 *   previewTransitionReason; query; queueDiscovery; recentFrames; recordCaptureDuration;
 *   refreshMethodStatus; refreshPlaybackStatus; releaseBridge; renderBusy; renderCandidates;
 *   rendererChoice; rendererRetryCounts; samplePlayerPicture; selectedModeOnly; setCaption;
 *   sourceCapabilities; sourceCertainlyHidden; sourceKey; sourceVisibilityBlocked; sources;
 *   suspendHiddenReceiver; testingAll; unavailableBySource; updatePaintTimer; updateProgressFromHealth;
 *   videoHidden; visibilityCheckAt; visibilityIntervalMs; visibilityPolicyApplies; visibilitySourceKey
 * Contract fields assigned here: deps.canvas.height; deps.canvas.width; deps.captureWorkMs; deps.current;
 *   deps.decodedCanvas; deps.decodedCanvas.height; deps.decodedCanvas.width; deps.experimentCanvasAnchor;
 *   deps.experimentFallbackGeneration; deps.lastExperiment; deps.lastExperiment.attachment;
 *   deps.lastExperiment.chromePresentation; deps.lastExperiment.stage; deps.lastExperiment.target;
 *   deps.lastHealth; deps.lastPaintStatusAt; deps.methodState.mode; deps.metrics.bytes;
 *   deps.metrics.captureMs; deps.metrics.effectiveFps; deps.metrics.failures; deps.metrics.frames;
 *   deps.metrics.paintMs; deps.metrics.paintPasses; deps.metrics.skippedFrames; deps.nextHealthCheck;
 *   deps.nextRenderProbe; deps.nextStillCapture; deps.noPictureChecks; deps.pinnedSource.id;
 *   deps.previewBrowser; deps.previewBrowser.docShellIsActive; deps.previewGeneration; deps.previewMode;
 *   deps.previewTransitionReason; deps.renderBusy; deps.sourceCapabilities.title;
 *   deps.sourceVisibilityBlocked; deps.sources; deps.visibilityCheckAt; deps.visibilitySourceKey
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("video/ZentralVideoRendering", function (deps) {
        function unavailableReason(mode, source = deps.current) {
          if (!deps.liveModeEnabled(mode) && deps.LIVE_MODES.includes(mode))
            return "Experimental Video Bridge disabled in settings";
          if (!source || source.data.kind !== "video")
            return "Choose a video source";
          const failures = deps.unavailableBySource.get(deps.sourceKey(source));
          if (failures?.has(mode)) {
            const failure = failures.get(mode);
            if (failure.until === Infinity)
              return `${failure.reason}; recovery limit reached (restart preview to retry)`;
            if (Date.now() < failure.until)
              return `${failure.reason}; retry in ${Math.ceil((failure.until - Date.now()) / 1000)}s`;
            failures.delete(mode);
            deps.failedRenderers.delete(mode);
          }
          if (mode === "snapshot" && !source.data.rect)
            return "Video is outside page viewport";
          if (mode === "canvas") return "";
          if (!source.data.videoRef)
            return "Discovery method did not provide a video reference";
          if (
            (mode === "stream" || mode === "frame-stream") &&
            source.data.canStream === false
          )
            return "Source does not expose stream capture";
          if (mode === "canvas-stream" && source.data.canCanvasStream === false)
            return "Canvas stream unavailable in source process";
          if (
            (mode === "native" || mode === "frame-native") &&
            source.data.canClone === false
          )
            return "Native cloning unavailable in source process";
          return "";
        }
        function markUnavailable(source, mode, error) {
          const key = deps.sourceKey(source);
          if (!deps.unavailableBySource.has(key))
            deps.unavailableBySource.set(key, new Map());
          const retryKey = key + ":" + mode;
          const attempts = (deps.rendererRetryCounts.get(retryKey) || 0) + 1;
          deps.rendererRetryCounts.set(retryKey, attempts);
          const rawLimit = deps.Services.prefs.getIntPref("zen.workspace.bgalazka.panel_retry_limit", 2);
          const retryLimit = Math.max(0, Math.min(6, rawLimit));
          deps.unavailableBySource.get(key).set(mode, {
            reason: String(error).slice(0, 100),
            until: attempts > retryLimit ? Infinity :
              Date.now() +
              (!deps.experimentalBridgeDisabled() &&
              /origin-clean|protected-media|capability|process-mismatch|origin-attributes/.test(
                String(error),
              )
                ? 300000
                : deps.powerOn(deps.RETRY_BACKOFF_PREF)
                  ? Math.min(300000, 30000 * 2 ** Math.min(attempts - 1, 4))
                  : 30000),
          });
        }
        function refreshRendererOptions() {
          const picker = document.getElementById("zs-video-preview-renderer");
          if (picker) {
            for (const option of picker.options) {
              const reason =
                option.value === "auto" ? "" : unavailableReason(option.value);
              option.hidden = false;
              option.disabled = !!reason;
              option.title = reason || "Available for selected source";
            }
            picker.value = deps.rendererChoice();
            picker.title =
              unavailableReason(deps.rendererChoice()) || "Preview renderer";
          }
          const discoveryPicker = document.getElementById(
            "zs-video-preview-discovery",
          );
          if (discoveryPicker) {
            const actorOption = [...discoveryPicker.options].find(
              (option) => option.value === "actor",
            );
            if (actorOption) {
              actorOption.disabled = false;
              actorOption.title =
                "Actor discovery; Automatic tries this after frame discovery";
            }
            discoveryPicker.value = deps.discoveryChoice();
          }
          const discoveryHelp = document.getElementById(
            "zs-video-preview-discovery-help",
          );
          if (discoveryHelp)
            discoveryHelp.hidden = deps.discoveryChoice() !== "direct";
          const availability = document.getElementById(
            "zs-video-preview-availability",
          );
          if (availability)
            availability.textContent = !deps.current
              ? "Select a video to see usable modes."
              : deps.RENDER_MODES.map((mode) => {
                  const reason = unavailableReason(mode);
                  return `${mode}: ${reason || "available"}`;
                }).join("\n");
          if (deps.sourceCapabilities) {
            const eligible = deps.RENDER_MODES.filter(
              (mode) => !unavailableReason(mode),
            );
            deps.sourceCapabilities.title =
              "Available: " + eligible.map(deps.methodName).join(", ");
            deps.refreshPlaybackStatus();
          }
        }
        function disposePlayer(browser = deps.previewBrowser) {
          if (!browser) {
            restoreExperimentFallback();
            return;
          }
          if (["native", "stream"].includes(browser._zvpMode)) {
            try {
              browser.browsingContext?.currentWindowGlobal
                ?.getActor(deps.ACTOR)
                .sendAsyncMessage("StopPreview");
            } catch (_) {}
          }
          deps.releaseBridge(browser);
          browser.remove();
          if (deps.previewBrowser === browser) {
            deps.previewBrowser = null;
            restoreExperimentFallback();
          }
        }
        function resetRendering() {
          deps.previewTransitionReason = "";
          deps.nextStillCapture = 0;
          ++deps.previewGeneration;
          disposePlayer();
          deps.previewMode = null;
          deps.updatePaintTimer();
          deps.noPictureChecks = 0;
          deps.failedRenderers.clear();
          deps.nextRenderProbe = deps.nextHealthCheck = 0;
          deps.lastHealth = null;
          deps.canvas?.style.removeProperty("display");
        }
        async function startLivePreview(
          source,
          mode,
          generation,
          diagnostic = false,
        ) {
          if (!deps.liveModeEnabled(mode) || !deps.liveBridgeEnabled())
            throw new Error(
              "disabled: Experimental Video Bridge disabled in settings",
            );
          const reason = unavailableReason(mode, source);
          if (reason && !diagnostic) throw new Error(reason);
          if (!source.data.videoRef)
            throw new Error(
              "reference: No content video reference; refresh sources",
            );
          if (
            !diagnostic &&
            ["frame-native", "native"].includes(mode) &&
            (await deps.liveSourceVisible(source))
          )
            throw new Error(
              "source-visible: Keep video on its page while visible",
            );
          if (!deps.selectedModeOnly() || diagnostic)
            await seedExperimentFallback(source, generation);
          const global = source.context?.currentWindowGlobal;
          const sourceId = global?.innerWindowId;
          const check = () => {
            if (
              deps.disposed ||
              !deps.liveModeEnabled(mode) ||
              !deps.liveBridgeEnabled() ||
              generation !== deps.previewGeneration
            )
              throw new Error("cancelled: Preview cancelled");
            if (
              !source.browser?.isConnected ||
              source.context?.currentWindowGlobal?.innerWindowId !== sourceId
            )
              throw new Error(
                "expired-reference: Source navigated; refresh sources",
              );
          };
          check();
          if (
            !global ||
            (source.data.documentId && sourceId !== source.data.documentId)
          )
            throw new Error(
              "expired-reference: Source document changed; refresh sources",
            );
          const identity = experimentWindowIdentity(global);
          if (identity.process === null)
            throw new Error(
              "process-identity: This build does not expose a verifiable process ID",
            );
          const browser = document.createXULElement("browser");
          browser._zvpMode = mode;
          browser.setAttribute("class", "zentral-video-preview-player");
          browser.setAttribute("type", "content");
          browser.setAttribute("remote", "true");
          browser.setAttribute("nodefaultsrc", "true");
          const top = experimentWindowIdentity(
            source.browser.browsingContext?.currentWindowGlobal,
          );
          // Never bind an isolated iframe receiver to the top document's process.
          // Group + remote type request affinity; actual process equality below
          // is mandatory. Do not invent an iframe frameLoader API.
          if (identity.process === top.process)
            browser.sameProcessAsFrameLoader = source.browser.frameLoader;
          browser.setAttribute("remoteType", global.domProcess.remoteType);
          browser.setAttribute(
            "initialBrowsingContextGroupId",
            global.browsingContext.group.id,
          );
          const attrs = global.documentPrincipal?.originAttributes || {};
          const container =
            attrs.userContextId || source.browser.getAttribute("usercontextid");
          if (container) browser.setAttribute("usercontextid", container);
          if (attrs.privateBrowsingId)
            browser.setAttribute("privatebrowsing", "true");
          browser.setAttribute("tabindex", "-1");
          browser.setAttribute("aria-label", "Live sidebar video preview");
          // No opacity-zero startup: keep a real laid-out receiver under the
          // last good canvas while checking presentation.
          deps.picture.appendChild(browser);
          deps.previewBrowser = browser;
          deps.lastExperiment = {
            mode,
            stage: "receiver-load",
            source: identity,
            target: null,
          };
          try {
            browser.loadURI(deps.Services.io.newURI("about:blank"), {
              triggeringPrincipal:
                deps.Services.scriptSecurityManager.getSystemPrincipal(),
            });
            let ready = null,
              readinessError = null;
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
              check();
              try {
                browser.docShellIsActive = true;
              } catch (_) {}
              if (browser.browsingContext?.currentWindowGlobal) {
                try {
                  ready = await deps.playerQuery(browser, mode, "Ready");
                } catch (error) {
                  readinessError = String(error);
                }
                if (ready?.ready && ready.documentURI === "about:blank") break;
              }
              await new Promise((resolve) => setTimeout(resolve, 80));
            }
            check();
            if (!ready?.ready || ready.documentURI !== "about:blank")
              throw new Error(
                "receiver-readiness: Receiver document did not become ready" +
                  (readinessError
                    ? "; last helper error: " + readinessError
                    : "; last reply: " + JSON.stringify(ready)),
              );
            if (
              ready.build !== deps.BUILD ||
              ready.helperId !== deps.EXPERIMENT_HELPER_ID
            )
              throw new Error(
                "helper-version: Stale helper; restart the browser",
              );
            const targetGlobal = browser.browsingContext.currentWindowGlobal;
            const targetIdentity = experimentWindowIdentity(targetGlobal);
            deps.lastExperiment.target = targetIdentity;
            if (targetIdentity.process !== identity.process)
              throw new Error(
                "process-mismatch: Source " +
                  identity.process +
                  ", receiver " +
                  targetIdentity.process,
              );
            if (
              targetIdentity.userContextId !== identity.userContextId ||
              targetIdentity.privateBrowsingId !== identity.privateBrowsingId
            )
              throw new Error(
                "origin-attributes: Receiver container/private context differs from source",
              );
            deps.lastExperiment.stage = "attachment";
            const result = await deps.playerQuery(browser, mode, "Preview", {
              videoRef: source.data.videoRef,
              sourceDocumentId: sourceId,
              canvasStreamWidth: deps.canvasStreamWidth(),
              canvasStreamFps: deps.canvasStreamFps(),
              lightMonitoring: !diagnostic && deps.powerOn(deps.LIGHT_MONITOR_PREF),
              mode: mode.replace("frame-", ""),
              requireHiddenSource:
                !diagnostic &&
                ["frame-native", "native"].includes(mode) &&
                deps.Services.prefs.getBoolPref(deps.KEEP_VISIBLE_PREF, true) &&
                !deps.sourceCertainlyHidden(source),
              allowLegacyCapture:
                !deps.experimentalBridgeDisabled() &&
                deps.Services.prefs.getBoolPref(deps.LEGACY_CAPTURE_PREF, false),
              fit: deps.framingChoice() === "cover" ? "cover" : "contain",
            });
            check();
            if (
              !result?.ok ||
              result.build !== deps.BUILD ||
              result.helperId !== deps.EXPERIMENT_HELPER_ID
            )
              throw new Error("attachment: Preview did not confirm startup");
            deps.lastExperiment.attachment = result;
            deps.lastExperiment.stage = "presentation";
            const presentationDeadline = Date.now() + 3000;
            let health,
              evidence = null;
            while (Date.now() < presentationDeadline) {
              check();
              health = await deps.playerQuery(browser, mode, "Health");
              check();
              if (!health?.ok)
                throw new Error(
                  health?.error || "presentation: Receiver disconnected",
                );
              if (
                health.presented &&
                health.targetRect?.every((size) => size > 0)
              ) {
                evidence = "target-frame-telemetry";
                break;
              }
              // Native target counters can stay zero. A bounded snapshot can
              // prove nonblack output, but an all-black frame is inconclusive.
              if (mode === "native" || mode === "frame-native") {
                const sample = await deps.samplePlayerPicture(browser);
                check();
                if (sample.litPixels > 0) {
                  evidence = "receiver-snapshot";
                  break;
                }
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            if (!evidence)
              throw new Error(
                "presentation-unconfirmed: No target frame evidence; black output is inconclusive",
              );
            check();
            deps.rendererRetryCounts.delete(deps.sourceKey(source) + ":" + mode);
            deps.lastHealth = health;
            deps.updateProgressFromHealth(source, health);
            deps.lastExperiment = {
              ...deps.lastExperiment,
              stage: "presenting",
              evidence,
              health,
            };
            deps.canvas.style.setProperty("display", "none", "important");
            hideExperimentFallback();
            deps.lastExperiment.chromePresentation = {
              fallbackInPicture: deps.canvas.parentNode === deps.picture,
              receiverInPicture: browser.parentNode === deps.picture,
            };
          } catch (error) {
            deps.lastExperiment = {
              ...deps.lastExperiment,
              stage: "failed",
              error: String(error).slice(0, 200),
            };
            disposePlayer(browser);
            throw error;
          }
        }
        function hideExperimentFallback() {
          if (!deps.liveBridgeEnabled() || !deps.canvas?.parentNode) return;
          if (!deps.experimentCanvasAnchor) {
            deps.experimentCanvasAnchor = document.createComment(
              "Zentral fallback position",
            );
            deps.canvas.parentNode.insertBefore(deps.experimentCanvasAnchor, deps.canvas);
          }
          deps.canvas.remove();
        }
        function restoreExperimentFallback() {
          if (!deps.experimentCanvasAnchor) return;
          const parent = deps.experimentCanvasAnchor.parentNode;
          if (parent && deps.canvas) {
            parent.insertBefore(deps.canvas, deps.experimentCanvasAnchor);
            deps.canvas.style.removeProperty("display");
          }
          deps.experimentCanvasAnchor.remove();
          deps.experimentCanvasAnchor = null;
        }
        async function seedExperimentFallback(source, generation) {
          if (
            !deps.liveBridgeEnabled() ||
            generation !== deps.previewGeneration ||
            deps.experimentFallbackGeneration === generation
          )
            return;
          deps.experimentFallbackGeneration = generation;
          for (const capture of [captureVideo, captureSnapshot]) {
            let bitmap;
            try {
              bitmap = await capture(source);
              if (
                deps.disposed ||
                !deps.liveBridgeEnabled() ||
                generation !== deps.previewGeneration
              )
                return;
              if (!bitmap) continue;
              deps.canvas.width = bitmap.width;
              deps.canvas.height = bitmap.height;
              deps.canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0);
              deps.canvas.style.removeProperty("display");
              return;
            } catch (_) {
              /* The live backend may work even when readback cannot. */
            } finally {
              bitmap?.close?.();
            }
          }
        }
        function experimentWindowIdentity(global) {
          const attrs = global?.documentPrincipal?.originAttributes || {};
          const pid = global?.osPid;
          const child = global?.domProcess?.childID;
          return {
            documentId: global?.innerWindowId || 0,
            contextId: global?.browsingContext?.id || 0,
            process:
              pid > 0 ? "pid:" + pid : child != null ? "child:" + child : null,
            remoteType: global?.domProcess?.remoteType || "unknown",
            userContextId: attrs.userContextId || 0,
            privateBrowsingId: attrs.privateBrowsingId || 0,
          };
        }
        async function captureVideo(source) {
          const startedAt = performance.now();
          const recordTransport = (mode, bytes) => {
            deps.metrics.bytes += bytes;
            const row = deps.metrics.transport[mode];
            row.frames++;
            row.bytes += bytes;
            row.ms += performance.now() - startedAt;
          };
          const payload = {
            id: source.data.id,
            frameId: source.data.frameId,
            captureWidth: deps.captureDimension(),
            pageMediaKey: source.data.pageMediaKey,
            currentSrc: source.data.currentSrc,
            binary: deps.featureOn(deps.BINARY_FRAMES_PREF),
            frameAware: deps.featureOn(deps.FRAME_AWARE_PREF),
          };
          let frame;
          const requestFrame = () =>
            source.method === "frame"
              ? deps.query(source.browser, "Capture", payload)
              : deps.limited(
                  source.context.currentWindowGlobal
                    .getActor(deps.ACTOR)
                    .sendQuery("Capture", payload),
                  900,
                  "video frame",
                );
          if (source.method === "frame" || source.method === "actor") {
            try {
              frame = await requestFrame();
            } catch (error) {
              if (!payload.binary) throw error;
              payload.binary = false;
              frame = await requestFrame();
            }
            if (
              payload.binary &&
              !frame?.unchanged &&
              !frame?.pixels &&
              !frame?.url
            ) {
              payload.binary = false;
              frame = await requestFrame();
            }
          } else {
            const media = source.element;
            const surface = media.ownerDocument.createElement("canvas");
            surface.width = Math.max(
              1,
              Math.min(
                media.videoWidth,
                Math.round(
                  (payload.captureWidth * media.videoWidth) /
                    Math.max(media.videoWidth, media.videoHeight),
                ),
              ),
            );
            surface.height = Math.max(
              1,
              Math.round(
                (surface.width * media.videoHeight) / media.videoWidth,
              ),
            );
            const context = surface.getContext("2d", {
              alpha: false,
              willReadFrequently: payload.binary,
            });
            context.drawImage(media, 0, 0, surface.width, surface.height);
            frame = payload.binary
              ? {
                  pixels: context.getImageData(
                    0,
                    0,
                    surface.width,
                    surface.height,
                  ).data.buffer,
                  width: surface.width,
                  height: surface.height,
                }
              : { url: surface.toDataURL("image/jpeg", 0.75) };
          }
          if (frame?.unchanged) return null;
          if (
            payload.binary &&
            frame?.pixels &&
            Number.isInteger(frame.width) &&
            Number.isInteger(frame.height) &&
            frame.width > 0 &&
            frame.height > 0 &&
            frame.width * frame.height <= 640 * 1920
          ) {
            let pixels;
            try {
              pixels = ArrayBuffer.isView(frame.pixels)
                ? new Uint8ClampedArray(
                    frame.pixels.buffer,
                    frame.pixels.byteOffset,
                    frame.pixels.byteLength,
                  )
                : new Uint8ClampedArray(frame.pixels);
            } catch (_) {}
            if (pixels?.byteLength === frame.width * frame.height * 4) {
              deps.decodedCanvas ??= document.createElement("canvas");
              if (
                deps.decodedCanvas.width !== frame.width ||
                deps.decodedCanvas.height !== frame.height
              ) {
                deps.decodedCanvas.width = frame.width;
                deps.decodedCanvas.height = frame.height;
              }
              deps.decodedCanvas
                .getContext("2d", { alpha: false })
                .putImageData(
                  new ImageData(pixels, frame.width, frame.height),
                  0,
                  0,
                );
              recordTransport("raw", pixels.byteLength);
              return deps.decodedCanvas;
            }
          }
          if (payload.binary && !frame?.url && source.method !== "direct") {
            payload.binary = false;
            frame = await requestFrame();
          }
          if (
            typeof frame?.url !== "string" ||
            !frame.url.startsWith("data:image/jpeg;base64,") ||
            frame.url.length > 16 * 1024 * 1024
          )
            throw new Error("Invalid video frame response");
          const image = await deps.limited(
            new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = () =>
                reject(new Error("Video frame decode failed"));
              img.src = frame.url;
            }),
            1000,
            "frame decode",
          );
          recordTransport("jpeg", Math.floor((frame.url.length - 23) * 0.75));
          return image;
        }
        async function captureSnapshot(source) {
          if (!source.data.rect)
            throw new Error("Video is outside the page viewport");
          const { x, y, width, height } = source.data.rect;
          return deps.limited(
            source.context.currentWindowGlobal.drawSnapshot(
              new DOMRect(x, y, width, height),
              Math.min(1, deps.captureDimension() / Math.max(width, height)),
              "rgb(0, 0, 0)",
            ),
            1000,
            "snapshot",
          );
        }
        function previewVisible() {
          if (
            document.hidden ||
            window.windowState === (window.STATE_MINIMIZED ?? 2) ||
            !deps.box?.isConnected ||
            deps.box.hidden
          )
            return false;
          const rect = deps.box.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 1 &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.top < window.innerHeight &&
            getComputedStyle(deps.box).visibility !== "hidden"
          );
        }
        function detectContentRect(bitmap, source) {
          const full = {
            x: 0,
            y: 0,
            width: bitmap.width,
            height: bitmap.height,
          };
          if (
            deps.framingChoice() !== "auto" ||
            bitmap.width < 40 ||
            bitmap.height < 30
          )
            return full;
          const key = deps.sourceKey(source);
          let state = deps.cropStates.get(key);
          if (!state) {
            state = { startedAt: source.data.paused ? 0 : Date.now() };
            deps.cropStates.set(key, state);
          }
          if (state.checked) {
            const rect = state.rect;
            if (!rect) return full;
            const x = Math.round(rect.x * bitmap.width);
            const y = Math.round(rect.y * bitmap.height);
            return {
              x,
              y,
              width: Math.max(
                1,
                Math.min(
                  bitmap.width - x,
                  Math.round(rect.width * bitmap.width),
                ),
              ),
              height: Math.max(
                1,
                Math.min(
                  bitmap.height - y,
                  Math.round(rect.height * bitmap.height),
                ),
              ),
            };
          }
          if (!state.checkNow) {
            if (source.data.paused) {
              state.startedAt = 0;
              return full;
            }
            if (!state.startedAt) state.startedAt = Date.now();
            if (Date.now() - state.startedAt < deps.CROP_DELAY_MS) return full;
          }
          let rect = null;
          try {
            const sample = document.createElement("canvas");
            sample.width = 64;
            sample.height = 36;
            const ctx = sample.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(bitmap, 0, 0, 64, 36);
            const pixels = ctx.getImageData(0, 0, 64, 36).data;
            const active = (vertical, index) => {
              let lit = 0,
                total = vertical ? 36 : 64;
              for (let i = 0; i < total; i++) {
                const col = vertical ? index : i,
                  row = vertical ? i : index;
                const at = (row * 64 + col) * 4;
                if (pixels[at] + pixels[at + 1] + pixels[at + 2] > 45) lit++;
              }
              return lit > total * 0.12;
            };
            let left = 0,
              right = 63,
              top = 0,
              bottom = 35;
            while (left < 19 && !active(true, left)) left++;
            while (right > 44 && !active(true, right)) right--;
            while (top < 11 && !active(false, top)) top++;
            while (bottom > 24 && !active(false, bottom)) bottom--;
            // Require bars on opposing edges. A dark scene or corner overlay
            // should not crop a single side or eat into the picture.
            const xCrop =
              left >= 2 &&
              63 - right >= 2 &&
              Math.abs(left - (63 - right)) <= 5;
            const yCrop =
              top >= 2 &&
              35 - bottom >= 2 &&
              Math.abs(top - (35 - bottom)) <= 4;
            if (xCrop || yCrop) {
              const x = xCrop ? Math.round((left / 64) * bitmap.width) : 0;
              const y = yCrop ? Math.round((top / 36) * bitmap.height) : 0;
              const endX = xCrop
                ? Math.ceil(((right + 1) / 64) * bitmap.width)
                : bitmap.width;
              const endY = yCrop
                ? Math.ceil(((bottom + 1) / 36) * bitmap.height)
                : bitmap.height;
              if (endX > x && endY > y)
                rect = { x, y, width: endX - x, height: endY - y };
            }
          } catch (_) {
            /* Cross-origin/readback failures just keep the full frame. */
          }
          state.checked = true;
          state.checkNow = false;
          state.rect = rect && {
            x: rect.x / bitmap.width,
            y: rect.y / bitmap.height,
            width: rect.width / bitmap.width,
            height: rect.height / bitmap.height,
          };
          state.displayWidth = rect?.width || bitmap.width;
          state.displayHeight = rect?.height || bitmap.height;
          return rect || full;
        }
        async function paint() {
          const paintStarted = performance.now();
          if (
            deps.disposed ||
            !deps.enabled() ||
            deps.compactPaused ||
            deps.renderBusy ||
            deps.testingAll
          )
            return;
          if (
            deps.current?.data.kind !== "video" ||
            !deps.box?.isConnected ||
            deps.box.hidden ||
            deps.videoHidden
          ) {
            deps.updatePaintTimer(false);
            return;
          }
          if (!previewVisible()) {
            deps.suspendHiddenReceiver();
            deps.updatePaintTimer(false);
            deps.lastHealth = null;
            try {
              if (deps.previewBrowser) deps.previewBrowser.docShellIsActive = false;
            } catch (_) {}
            return;
          }
          try {
            if (deps.previewBrowser && !deps.previewBrowser.docShellIsActive)
              deps.previewBrowser.docShellIsActive = true;
          } catch (_) {}
          const source = deps.current,
            choice = deps.rendererChoice();
          const generation = deps.previewGeneration;
          deps.renderBusy = true;
          try {
            if (deps.visibilityPolicyApplies()) {
              const key = deps.sourceKey(source);
              if (
                key !== deps.visibilitySourceKey ||
                Date.now() >= deps.visibilityCheckAt
              ) {
                const blocked = await deps.liveSourceVisible(source);
                if (generation !== deps.previewGeneration) return;
                deps.visibilitySourceKey = key;
                deps.visibilityCheckAt = Date.now() + deps.visibilityIntervalMs();
                const changed = blocked !== deps.sourceVisibilityBlocked;
                deps.sourceVisibilityBlocked = blocked;
                if (
                  (blocked &&
                    ["frame-native", "native"].includes(deps.previewMode)) ||
                  (changed &&
                    !blocked &&
                    deps.previewMode &&
                    deps.previewMode !== choice &&
                    (choice === "auto" ||
                      ["frame-native", "native"].includes(choice)))
                ) {
                  disposePlayer();
                  deps.previewMode = null;
                  deps.lastHealth = null;
                  deps.failedRenderers.clear();
                  deps.nextRenderProbe = deps.nextHealthCheck = 0;
                }
              }
            }
            if (deps.powerOn(deps.SUSPEND_VISIBLE_PREF) && deps.sourceVisibilityBlocked) {
              if (deps.previewBrowser) {
                ++deps.previewGeneration;
                disposePlayer();
                deps.previewMode = null;
                deps.lastHealth = null;
              }
              deps.canvas
                ?.getContext("2d")
                ?.clearRect(0, 0, deps.canvas.width, deps.canvas.height);
              deps.clearCaptionWatch();
              deps.setCaption("");
              deps.previewTransitionReason =
                "Power saving: original video is visible";
              deps.nextRenderProbe = deps.visibilityCheckAt;
              return;
            }
            if (deps.LIVE_MODES.includes(deps.previewMode)) {
              if (deps.previewMode && Date.now() < deps.nextHealthCheck) return;
              if (deps.previewMode) {
                deps.nextHealthCheck = Date.now() + deps.healthIntervalMs();
                try {
                  try {
                    deps.previewBrowser.docShellIsActive = true;
                  } catch (_) {}
                  const state = await deps.playerQuery(
                    deps.previewBrowser,
                    deps.previewMode,
                    "Health",
                  );
                  if (generation !== deps.previewGeneration) return;
                  if (!state?.ok)
                    throw new Error(
                      state?.error || "Preview no longer available",
                    );
                  // The quality counter stays at zero for working clones/streams in
                  // Zen; target video-frame callbacks track presentation instead.
                  if (
                    !state.recovering &&
                    ((deps.previewMode !== "native" &&
                      deps.previewMode !== "frame-native") ||
                      state.presented) &&
                    deps.lastHealth &&
                    !state.paused &&
                    state.time > deps.lastHealth.time + 1 &&
                    (state.presentedCallbacks ||
                      state.paintedFrames ||
                      state.frames) ===
                      (deps.lastHealth.presentedCallbacks ||
                        deps.lastHealth.paintedFrames ||
                        deps.lastHealth.frames)
                  )
                    throw new Error("Stream stopped presenting video frames");
                  deps.lastHealth = state;
                  deps.updateProgressFromHealth(source, state);
                  if (deps.lastExperiment)
                    deps.lastExperiment = {
                      ...deps.lastExperiment,
                      health: state,
                      checkedAt: Date.now(),
                    };
                  return;
                } catch (error) {
                  if (generation !== deps.previewGeneration) return;
                  deps.previewTransitionReason = String(error).slice(0, 180);
                  deps.methodError(deps.previewMode, error);
                  if (!/source-visible/.test(String(error)))
                    deps.failedRenderers.add(deps.previewMode);
                  else {
                    deps.sourceVisibilityBlocked = true;
                    deps.visibilityCheckAt = 0;
                  }
                  if (!/source-visible/.test(String(error)))
                    markUnavailable(source, deps.previewMode, error);
                  disposePlayer();
                  deps.previewMode = null;
                  deps.canvas.style.removeProperty("display");
                  deps.nextRenderProbe = Date.now() + deps.POLL_MS;
                  return;
                }
              }
            }
            if (!deps.previewMode && Date.now() < deps.nextRenderProbe) return;
            if (
              deps.WORKING_MODES.includes(deps.previewMode) &&
              Date.now() < deps.nextStillCapture
            )
              return;
            const modes = deps.renderCandidates(
              choice,
              deps.previewMode,
              deps.sourceVisibilityBlocked,
              source,
            );
            if (!modes.length) {
              deps.failedRenderers.clear();
              deps.nextRenderProbe = Date.now() + deps.POLL_MS;
              return;
            }
            for (const mode of modes) {
              if (generation !== deps.previewGeneration || deps.disposed) return;
              const started = Date.now();
              const workStarted = performance.now();
              let bitmap;
              try {
                if (deps.LIVE_MODES.includes(mode))
                  await startLivePreview(source, mode, generation);
                else {
                  bitmap = await (mode === "canvas"
                    ? captureVideo(source)
                    : captureSnapshot(source));
                  if (generation !== deps.previewGeneration) return;
                  if (!bitmap) {
                    deps.metrics.skippedFrames++;
                    deps.nextStillCapture = Date.now() + deps.captureIntervalMs();
                    return;
                  }
                  const crop = detectContentRect(bitmap, source);
                  const targetWidth = Math.max(1, crop.width);
                  const targetHeight = Math.max(1, crop.height);
                  if (deps.canvas.width !== targetWidth) deps.canvas.width = targetWidth;
                  if (deps.canvas.height !== targetHeight)
                    deps.canvas.height = targetHeight;
                  deps.canvas
                    .getContext("2d", { alpha: false })
                    .drawImage(
                      bitmap,
                      crop.x,
                      crop.y,
                      crop.width,
                      crop.height,
                      0,
                      0,
                      deps.canvas.width,
                      deps.canvas.height,
                    );
                  const saved = deps.cropStates.get(deps.sourceKey(source));
                  const displayWidth = saved?.checked
                    ? saved.displayWidth
                    : source.data.width;
                  const displayHeight = saved?.checked
                    ? saved.displayHeight
                    : source.data.height;
                  if (
                    source.data.displayWidth !== displayWidth ||
                    source.data.displayHeight !== displayHeight
                  ) {
                    source.data.displayWidth = displayWidth;
                    source.data.displayHeight = displayHeight;
                    deps.fitPicture();
                  }
                  deps.metrics.frames++;
                  deps.recentFrames.push(Date.now());
                  while (
                    deps.recentFrames.length &&
                    deps.recentFrames[0] < Date.now() - 5000
                  )
                    deps.recentFrames.shift();
                  deps.metrics.effectiveFps = Number(
                    (
                      deps.recentFrames.length /
                      Math.min(
                        5,
                        Math.max(1, (Date.now() - deps.recentFrames[0]) / 1000),
                      )
                    ).toFixed(1),
                  );
                  const workMs = performance.now() - workStarted;
                  deps.metrics.captureMs += workMs;
                  deps.recordCaptureDuration(workMs);
                  // Leave headroom when a capture and draw use most of a frame.
                  // Cheap captures retain the user's requested 60 fps ceiling.
                  deps.captureWorkMs = deps.captureWorkMs
                    ? deps.captureWorkMs * 0.75 + workMs * 0.25
                    : workMs;
                  const budget = Math.max(
                    deps.captureIntervalMs(),
                    deps.captureWorkMs * 1.25,
                  );
                  deps.nextStillCapture =
                    Date.now() + Math.max(1, Math.ceil(budget - workMs));
                }
                if (generation !== deps.previewGeneration) return;
                deps.previewMode = mode;
                if (
                  mode === choice ||
                  (choice === "auto" && mode === deps.RENDER_MODES[0])
                )
                  deps.previewTransitionReason = "";
                deps.methodState[mode] = deps.LIVE_MODES.includes(mode)
                  ? "working (live video)"
                  : "working (frame received)";
                deps.nextHealthCheck = Date.now() + deps.healthIntervalMs();
                return;
              } catch (error) {
                deps.metrics.failures++;
                if (generation !== deps.previewGeneration) return;
                deps.previewTransitionReason =
                  deps.methodName(mode) + ": " + String(error).slice(0, 180);
                deps.methodError(mode, error);
                if (!/source-visible/.test(String(error)))
                  deps.failedRenderers.add(mode);
                if (
                  deps.LIVE_MODES.includes(mode) &&
                  !/cancelled|source[- ]visible/i.test(String(error))
                ) {
                  markUnavailable(source, mode, error);
                }
                if (deps.previewMode === mode) {
                  deps.previewMode = null;
                  break;
                }
              } finally {
                bitmap?.close?.();
              }
            }
            if (deps.RENDER_MODES.every((mode) => deps.failedRenderers.has(mode)))
              deps.failedRenderers.clear();
            deps.nextRenderProbe = Date.now() + deps.POLL_MS;
          } finally {
            deps.renderBusy = false;
            deps.metrics.paintMs += performance.now() - paintStarted;
            deps.metrics.paintPasses++;
            deps.updatePaintTimer();
            deps.refreshPlaybackStatus();
            if (Date.now() - deps.lastPaintStatusAt >= 500) {
              deps.lastPaintStatusAt = Date.now();
              deps.refreshMethodStatus();
            }
          }
        }
        async function refreshRendererSource(source, generation) {
          if (source?.method !== "frame") return;
          const state = deps.bridges.get(source.browser);
          const uri = deps.liveBridgeEnabled() ? deps.EXPERIMENTAL_FRAME_URI : deps.FRAME_URI;
          if (state?.uri === uri) return;
          // Helper replacement rebuilds numeric lookup IDs. Keep all displayed
          // sources until their new IDs are resolved from exact video references.
          const refreshed = await deps.inspectFrame({
            browser: source.browser,
            tab: source.tab,
            panel: source.panel,
          });
          if (
            deps.disposed ||
            generation !== deps.previewGeneration ||
            deps.current !== source
          )
            return;
          const match = refreshed.find(
            (item) =>
              item.data.documentId === source.data.documentId &&
              item.data.frameId === source.data.frameId &&
              item.data.videoRef?.id != null &&
              item.data.videoRef.id === source.data.videoRef?.id,
          );
          if (!match) {
            deps.queueDiscovery(source.browser);
            return;
          }
          deps.sources = deps.sources.map((item) => {
            if (item.browser !== source.browser || item.method !== "frame")
              return item;
            return (
              refreshed.find(
                (candidate) =>
                  candidate.data.documentId === item.data.documentId &&
                  candidate.data.frameId === item.data.frameId &&
                  candidate.data.videoRef?.id != null &&
                  candidate.data.videoRef.id === item.data.videoRef?.id,
              ) || item
            );
          });
          deps.current = match;
          if (
            deps.pinnedSource?.browser === source.browser &&
            deps.pinnedSource.frameId === source.data.frameId &&
            deps.pinnedSource.id === source.data.id
          )
            deps.pinnedSource.id = match.data.id;
          deps.discoveryCache.delete(source.browser);
        }
return { unavailableReason, markUnavailable, refreshRendererOptions, disposePlayer, resetRendering, startLivePreview, hideExperimentFallback, restoreExperimentFallback, seedExperimentFallback, experimentWindowIdentity, captureVideo, captureSnapshot, previewVisible, detectContentRect, paint, refreshRendererSource };
});
})();
