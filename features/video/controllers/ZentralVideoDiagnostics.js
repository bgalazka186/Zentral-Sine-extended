/*
 * ZENTRAL FILE GUIDE - features/video/controllers/ZentralVideoDiagnostics.js
 *
 * Purpose: Optional developer experiment controls, source/receiver motion sampling and combined
 *   preview-method diagnostic tests.
 * Interaction / execution: VideoPreview injects Transport/Rendering/Sidebar/state callbacks; VideoSettings
 *   hosts test controls. Does not own the normal preview implementation.
 * Ownership / failure: cancelExperimentTests and owner cleanup invalidate outstanding probes. Experimental
 *   source-page control remains gated separately from ordinary sidebar rendering; do not broaden
 *   authorization to fix a diagnostic.
 * Registration: video/ZentralVideoDiagnostics
 * Loaded/created by: features/video/ZentralVideoPreview.uc.js
 * Returned factory API: cancelExperimentTests; ensureVideoDevCategory; ensureVideoTestControls;
 *   pictureChanged; runCombinedVideoTests; runSourceExperiment; sameVideoSource; samplePlayerPicture;
 *   sampleSourceControl; sharedReceiverFailure; targetAdvanced; testEverything
 * Injected deps state/callbacks used: ACTOR; BUILD; CHANNEL; EXPERIMENT_HELPER_ID; LEGACY_CAPTURE_PREF;
 *   LIVE_MODES; RENDER_MODES; Services; bridges; canvas; captureSnapshot; captureVideo; combinedReportText;
 *   current; disposePlayer; disposed; experimentSources; experimentTestToken; experimentWindowIdentity;
 *   experimentalBridgeDisabled; inspectActor; inspectDirect; inspectFrame; lastExperiment; limited;
 *   methodState; nextRequest; playerQuery; previewBrowser; previewGeneration; query; recordError;
 *   resetRendering; scanning; sources; startLivePreview; testingAll; wakePaint
 * Contract fields assigned here: deps.combinedReportText; deps.experimentTestToken; deps.nextRequest;
 *   deps.testingAll
 * Literal DOM event subscriptions: click
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("video/ZentralVideoDiagnostics", function (deps) {
        function ensureVideoTestControls(content) {
          content = document.getElementById("zs-video-preview-advanced") ||
            content.querySelector("#zs-video-preview-advanced") || content;
          if (content.querySelector("#zs-video-preview-test-all")) return;
          const testButton = document.createElement("button");
          testButton.id = "zs-video-preview-test-all";
          testButton.type = "button";
          testButton.className = "zs-btn-save";
          testButton.textContent =
            "Test everything and copy results to clipboard";
          testButton.addEventListener("click", async () => {
            if (deps.testingAll) return;
            testButton.disabled = true;
            testButton.textContent = "Testing video methods…";
            try {
              const copied = await testEverything(
                deps.sources[
                  document.getElementById("zs-video-preview-sources")
                    ?.selectedIndex
                ] || deps.current,
                (label) => {
                  testButton.textContent = `Testing ${label}…`;
                },
              );
              testButton.textContent = copied
                ? "Results copied; test again"
                : "Report below; copy manually";
            } catch (error) {
              testButton.textContent = "Test failed; retry";
              deps.recordError(error);
            } finally {
              testButton.disabled = false;
            }
          });
          content.appendChild(testButton);
          if (content.querySelector("#zs-video-preview-test-report")) return;
          const testReport = document.createElement("textarea");
          testReport.id = "zs-video-preview-test-report";
          testReport.readOnly = true;
          testReport.hidden =
            deps.experimentalBridgeDisabled() || !deps.combinedReportText;
          if (!deps.experimentalBridgeDisabled())
            testReport.value = deps.combinedReportText;
          testReport.setAttribute("aria-label", "Video method test report");
          testReport.style.cssText =
            "width:100%;height:180px;box-sizing:border-box;font:11px monospace;white-space:pre;";
          content.appendChild(testReport);
        }
        function ensureVideoDevCategory(modal, tabBar, body) {
          const panel = modal.querySelector("#zs-panel-video-cloning");
          const content = panel?.querySelector(".zs-section-content");
          const oldPanel = modal.querySelector("#zs-panel-extension-video-dev");
          const oldContent = oldPanel?.querySelector(".zs-section-content");
          if (content && oldContent) {
            for (const node of [...oldContent.children])
              content.appendChild(node);
          }
          oldPanel?.remove();
          modal.querySelector("#zs-tab-btn-extension-video-dev")?.remove();
          return {
            panel,
            button: modal.querySelector("#zs-tab-btn-video-cloning"),
            content,
          };
        }
        function cancelExperimentTests() {
          ++deps.experimentTestToken;
          for (const entry of deps.experimentSources) {
            try {
              if (entry.method === "actor")
                entry.actor.sendAsyncMessage("StopControl");
              else
                deps.bridges
                  .get(entry.browser)
                  ?.manager.sendAsyncMessage(deps.CHANNEL + ":request", {
                    requestId: ++deps.nextRequest,
                    kind: "StopControl",
                    frameId: entry.frameId,
                  });
            } catch (_) {}
          }
          deps.experimentSources.clear();
        }
        async function runSourceExperiment(mode) {
          if (deps.experimentalBridgeDisabled() || deps.disposed || deps.testingAll) return;
          cancelExperimentTests();
          const token = deps.experimentTestToken;
          const selected = deps.current;
          const lines = [
            `Zentral ${deps.BUILD} · source-document ${mode} control · 60 seconds`,
            "Inspect the moving image and listen for unchanged source audio.",
          ];
          const report = document.getElementById(
            "zs-video-preview-test-report",
          );
          const publish = () => {
            if (report) {
              report.hidden = false;
              report.value = lines.join("\n");
            }
          };
          const check = () => {
            if (
              deps.disposed ||
              deps.experimentalBridgeDisabled() ||
              token !== deps.experimentTestToken
            )
              throw new Error("cancelled: Source experiment cancelled");
          };
          let entry;
          deps.testingAll = true;
          try {
            deps.resetRendering();
            if (!selected?.browser?.isConnected)
              throw new Error("Choose a connected video source first");
            // Actor discovery reaches isolated child documents; frame transport
            // remains a fallback for builds where custom actors cannot register.
            const item = {
              browser: selected.browser,
              tab: selected.tab,
              panel: selected.panel,
            };
            let candidates = await deps.inspectActor(item);
            check();
            if (!candidates.length) candidates = await deps.inspectFrame(item);
            check();
            const source =
              candidates.find(
                (candidate) =>
                  candidate.data.frameId === selected.data.frameId &&
                  candidate.data.videoRef?.id != null &&
                  candidate.data.videoRef.id === selected.data.videoRef?.id,
              ) ||
              candidates.find(
                (candidate) =>
                  candidate.data.frameId === selected.data.frameId &&
                  !!selected.data.currentSrc &&
                  candidate.data.currentSrc === selected.data.currentSrc &&
                  candidate.data.width === selected.data.width &&
                  candidate.data.height === selected.data.height,
              );
            if (!source?.data.videoRef)
              throw new Error(
                "Selected source could not be resolved; refresh sources",
              );
            const global = source.context.currentWindowGlobal;
            entry = {
              method: source.method,
              browser: source.browser,
              frameId: source.data.frameId,
              documentId: global.innerWindowId,
              actor: source.method === "actor" ? global.getActor(deps.ACTOR) : null,
            };
            deps.experimentSources.add(entry);
            const send = (kind, data = {}) => {
              check();
              if (
                source.context.currentWindowGlobal?.innerWindowId !==
                entry.documentId
              )
                throw new Error("expired-reference: Source navigated");
              return entry.actor
                ? deps.limited(
                    entry.actor.sendQuery(kind, {
                      ...data,
                      experimentalEnabled: true,
                    }),
                    kind === "ControlPreview" ? 9000 : 1500,
                    kind,
                  )
                : deps.query(entry.browser, kind, {
                    ...data,
                    frameId: entry.frameId,
                  });
            };
            lines.push(
              "Placement: " + JSON.stringify(deps.experimentWindowIdentity(global)),
            );
            publish();
            const result = await send("ControlPreview", {
              videoRef: source.data.videoRef,
              sourceDocumentId: entry.documentId,
              mode,
              durationMs: 65000,
              allowLegacyCapture: deps.Services.prefs.getBoolPref(
                deps.LEGACY_CAPTURE_PREF,
                false,
              ),
            });
            check();
            lines.push("Attachment: " + JSON.stringify(result));
            const started = Date.now();
            let previous = null,
              samples = 0,
              advancing = 0,
              unconfirmed = 0;
            while (Date.now() - started < 60000) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              check();
              const health = await send("ControlHealth");
              check();
              if (!health?.ok)
                throw new Error(health?.error || "Source experiment stopped");
              samples++;
              if (!health.presented) unconfirmed++;
              if (
                previous &&
                (health.presentedCallbacks > previous.presentedCallbacks ||
                  health.paintedFrames > previous.paintedFrames)
              )
                advancing++;
              previous = health;
              if (samples === 1 || samples % 5 === 0) {
                lines.push(
                  `${Math.round((Date.now() - started) / 1000)}s: ${JSON.stringify(health)}`,
                );
                publish();
              }
            }
            lines.push(
              `Completed: ${samples} health samples; ${advancing} intervals with advancing target frames; ${unconfirmed} samples without presentation evidence.`,
            );
            lines.push(
              "A completed test is not automatic promotion. Confirm visible motion, original audio, background behavior and teardown.",
            );
          } catch (error) {
            lines.push("Result: " + String(error));
          } finally {
            if (entry) {
              try {
                if (entry.actor) entry.actor.sendAsyncMessage("StopControl");
                else
                  deps.bridges
                    .get(entry.browser)
                    ?.manager.sendAsyncMessage(deps.CHANNEL + ":request", {
                      requestId: ++deps.nextRequest,
                      kind: "StopControl",
                      frameId: entry.frameId,
                    });
              } catch (_) {}
              deps.experimentSources.delete(entry);
            }
            deps.testingAll = false;
            publish();
            if (!deps.disposed && token === deps.experimentTestToken) {
              deps.resetRendering();
              deps.wakePaint();
            }
          }
        }
        function sameVideoSource(a, b) {
          if (a?.browser !== b?.browser) return false;
          if (a?.element && b?.element) return a.element === b.element;
          if (!a?.data?.videoRef || !b?.data?.videoRef) return false;
          return (
            JSON.stringify(a.data.videoRef) === JSON.stringify(b.data.videoRef)
          );
        }
        function targetAdvanced(before, after) {
          return (
            !!before &&
            !!after &&
            ((after.presentedCallbacks || 0) >
              (before.presentedCallbacks || 0) ||
              (after.paintedFrames || 0) > (before.paintedFrames || 0))
          );
        }
        function pictureChanged(before, after) {
          return (
            before?.fingerprint != null &&
            after?.fingerprint != null &&
            before.fingerprint !== after.fingerprint
          );
        }
        function sharedReceiverFailure(error) {
          return /receiver-readiness:|process-mismatch:|process-identity:|origin-attributes:|helper-version:/.test(
            String(error),
          );
        }
        async function sampleSourceControl(source, health) {
          let bitmap;
          try {
            const box = health?.targetBox;
            if (!box || box[2] < 2 || box[3] < 2)
              return { error: "Target has no drawable rectangle" };
            bitmap = await deps.limited(
              source.context.currentWindowGlobal.drawSnapshot(
                new DOMRect(...box),
                Math.min(1, 48 / box[2]),
                "rgb(0, 0, 0)",
              ),
              1200,
              "source target snapshot",
            );
            const surface = document.createElement("canvas");
            surface.width = 24;
            surface.height = 14;
            const context = surface.getContext("2d", {
              willReadFrequently: true,
            });
            context.drawImage(bitmap, 0, 0, 24, 14);
            const pixels = context.getImageData(0, 0, 24, 14).data;
            let fingerprint = 2166136261,
              litPixels = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              const sum = pixels[i] + pixels[i + 1] + pixels[i + 2];
              if (sum > 36) litPixels++;
              fingerprint = Math.imul(fingerprint ^ (sum >> 3), 16777619) >>> 0;
            }
            return { fingerprint, litPixels };
          } catch (error) {
            return { error: String(error) };
          } finally {
            bitmap?.close?.();
          }
        }
        async function runCombinedVideoTests(selected, progress = () => {}) {
          if (deps.experimentalBridgeDisabled() || deps.disposed || deps.testingAll)
            return false;
          cancelExperimentTests();
          const token = deps.experimentTestToken,
            started = Date.now(),
            deadline = started + 180000;
          const sourceId =
            selected?.context?.currentWindowGlobal?.innerWindowId;
          const report = {
            schema: "zentral.video.matrix.v1",
            build: deps.BUILD,
            helper: deps.EXPERIMENT_HELPER_ID,
            browser: {
              name: deps.Services.appinfo.name,
              version: deps.Services.appinfo.version,
              platform: deps.Services.appinfo.platformVersion,
              build: deps.Services.appinfo.appBuildID,
              OS: deps.Services.appinfo.OS,
            },
            source: deps.experimentWindowIdentity(
              selected?.context?.currentWindowGlobal,
            ),
            rows: [],
            audio:
              "Listen to the original source; state checks cannot prove audible output.",
            visual:
              "Confirm visible motion. Pixel changes and callbacks are diagnostic evidence, not universal certification.",
            outcome: "running",
          };
          const publish = () => {
            deps.combinedReportText = JSON.stringify(report, null, 2);
            const node = document.getElementById(
              "zs-video-preview-test-report",
            );
            if (node) {
              node.hidden = false;
              node.value = deps.combinedReportText;
            }
          };
          const check = () => {
            if (
              deps.disposed ||
              deps.experimentalBridgeDisabled() ||
              token !== deps.experimentTestToken
            )
              throw new Error("cancelled: Experimental test stopped");
            if (Date.now() >= deadline)
              throw new Error("deadline: Combined test reached 180 seconds");
            if (
              !selected?.browser?.isConnected ||
              selected.context?.currentWindowGlobal?.innerWindowId !== sourceId
            )
              throw new Error(
                "expired-reference: Selected source navigated or was removed",
              );
          };
          const pause = async (ms) => {
            check();
            await new Promise((resolve) => setTimeout(resolve, ms));
            check();
          };
          const row = (id, status, detail = {}) => {
            report.rows.push({ id, status, ...detail });
            publish();
          };
          const watchdog = setTimeout(() => {
            cancelExperimentTests();
            deps.resetRendering();
          }, 180000);
          let control = null,
            winner = null;
          const stopControl = () => {
            if (!control) return;
            try {
              if (control.actor) control.actor.sendAsyncMessage("StopControl");
              else
                deps.bridges
                  .get(control.browser)
                  ?.manager.sendAsyncMessage(deps.CHANNEL + ":request", {
                    requestId: ++deps.nextRequest,
                    kind: "StopControl",
                    frameId: control.frameId,
                  });
            } catch (_) {}
            deps.experimentSources.delete(control);
            control = null;
          };
          const cleanupPlayer = () => {
            deps.disposePlayer();
            deps.canvas?.style.removeProperty("display");
          };
          deps.testingAll = true;
          try {
            check();
            deps.resetRendering();
            const item = {
              browser: selected.browser,
              tab: selected.tab,
              panel: selected.panel,
            };
            const discovered = {};
            // Sequential discovery avoids shared-helper setup races; renderers are never concurrent.
            for (const [name, inspect] of [
              ["frame", deps.inspectFrame],
              ["actor", deps.inspectActor],
              ["direct", deps.inspectDirect],
            ]) {
              check();
              progress(name + " discovery");
              try {
                const candidates = await inspect(item);
                check();
                discovered[name] = candidates.find((candidate) =>
                  sameVideoSource(candidate, selected),
                );
                row(
                  "discovery/" + name,
                  discovered[name] ? "selected-source-found" : "unavailable",
                  {
                    count: candidates.length,
                    transport: deps.methodState[name],
                    reason: discovered[name]
                      ? undefined
                      : "No exact reference match; no different video was substituted",
                  },
                );
              } catch (error) {
                check();
                row("discovery/" + name, "failed", { error: String(error) });
              }
            }
            const source =
              discovered.frame ||
              discovered.actor ||
              discovered.direct ||
              selected;
            for (const [mode, capture] of [
              ["canvas", deps.captureVideo],
              ["snapshot", deps.captureSnapshot],
            ]) {
              check();
              progress("baseline " + mode);
              let bitmap;
              try {
                bitmap = await capture(source);
                check();
                row(
                  "baseline/" + mode,
                  bitmap ? "image-returned" : "inconclusive",
                  {
                    dimensions: bitmap ? [bitmap.width, bitmap.height] : null,
                  },
                );
              } catch (error) {
                check();
                row("baseline/" + mode, "failed", { error: String(error) });
              } finally {
                bitmap?.close?.();
              }
            }
            let controlSource = null,
              sourceProbe = null,
              sendControl = null;
            for (const candidate of [discovered.frame, discovered.actor].filter(
              Boolean,
            )) {
              check();
              const entry = {
                browser: candidate.browser,
                frameId: candidate.context.id,
                actor:
                  candidate.method === "actor"
                    ? candidate.context.currentWindowGlobal.getActor(deps.ACTOR)
                    : null,
              };
              const send = async (kind, data = {}) => {
                check();
                const payload = { ...data, experimentalEnabled: true };
                const result = entry.actor
                  ? await deps.limited(
                      entry.actor.sendQuery(kind, payload),
                      kind === "ControlPreview" ? 9000 : 1500,
                      kind,
                    )
                  : await deps.query(entry.browser, kind, {
                      ...payload,
                      frameId: entry.frameId,
                    });
                check();
                return result;
              };
              try {
                sourceProbe = await send("Probe", {
                  videoRef: candidate.data.videoRef,
                });
                if (
                  sourceProbe.build !== deps.BUILD ||
                  sourceProbe.helperId !== deps.EXPERIMENT_HELPER_ID
                )
                  throw new Error(
                    "helper-version: Source helper fingerprint mismatch",
                  );
                row("source/probe/" + candidate.method, "replied", sourceProbe);
                controlSource = candidate;
                sendControl = send;
                control = entry;
                deps.experimentSources.add(entry);
                break;
              } catch (error) {
                check();
                row("source/probe/" + candidate.method, "failed", {
                  error: String(error),
                });
              }
            }
            for (const mode of ["native", "stream", "canvas-stream"]) {
              check();
              progress("source " + mode);
              const skip = !controlSource
                ? "No source helper could resolve the exact selected video"
                : mode === "native" &&
                    (!sourceProbe.clone || sourceProbe.cloneBusy)
                  ? "Native API missing or existing PiP/clone owns source"
                  : mode !== "native" && sourceProbe.encrypted
                    ? "Encrypted media cannot use stream/canvas capture"
                    : mode === "stream" &&
                        !sourceProbe.stream &&
                        !sourceProbe.srcObject
                      ? "No unprefixed stream API; legacy remains off"
                      : null;
              if (skip) {
                row("source/" + mode, "skipped-dependency", { reason: skip });
                continue;
              }
              try {
                const attachment = await sendControl("ControlPreview", {
                  videoRef: controlSource.data.videoRef,
                  sourceDocumentId: sourceId,
                  sourcePageMediaKey: source.data.pageMediaKey,
                  sourceCurrentSrc: source.data.currentSrc,
                  mode,
                  durationMs: 12000,
                  allowLegacyCapture: false,
                });
                let previous = null,
                  previousPicture = null,
                  advancing = 0,
                  changed = 0,
                  health;
                for (let i = 0; i < 4; i++) {
                  await pause(1000);
                  health = await sendControl("ControlHealth");
                  if (!health.ok)
                    throw new Error(
                      health.error || "source-health: Receiver stopped",
                    );
                  const picture = await sampleSourceControl(
                    controlSource,
                    health,
                  );
                  check();
                  if (targetAdvanced(previous, health)) advancing++;
                  if (pictureChanged(previousPicture, picture)) changed++;
                  previous = health;
                  previousPicture = picture;
                }
                const after = await sendControl("Probe", {
                  videoRef: controlSource.data.videoRef,
                });
                row(
                  "source/" + mode,
                  health.visibility === "hidden"
                    ? "hidden-target-snapshot-only"
                    : advancing || changed
                      ? "target-motion-evidence"
                      : "presentation-inconclusive",
                  {
                    attachment,
                    advancingIntervals: advancing,
                    changedPictures: changed,
                    health,
                    sourceStateUnchanged:
                      after.muted === sourceProbe.muted &&
                      after.volume === sourceProbe.volume &&
                      after.paused === sourceProbe.paused,
                  },
                );
              } catch (error) {
                check();
                row("source/" + mode, "failed", { error: String(error) });
              } finally {
                // Keep the authorized transport, but release this rendering session before the next mode.
                if (control) {
                  try {
                    await sendControl("StopControl");
                  } catch (_) {}
                }
              }
            }
            stopControl();
            const blocked = {};
            for (const mode of deps.LIVE_MODES) {
              check();
              progress("sidebar " + mode);
              const transport =
                mode === "native" || mode === "stream" ? "actor" : "frame";
              const skip =
                blocked[transport] ||
                (mode.includes("native") &&
                sourceProbe &&
                (!sourceProbe.clone || sourceProbe.cloneBusy)
                  ? "Native API missing or existing clone owns source"
                  : null) ||
                (mode.includes("stream") && sourceProbe?.encrypted
                  ? "Encrypted capture is unsupported"
                  : null);
              if (skip) {
                row("sidebar/" + mode, "skipped-dependency", { reason: skip });
                continue;
              }
              try {
                await deps.startLivePreview(source, mode, deps.previewGeneration, true);
                check();
                let previous = null,
                  previousPicture = null,
                  advancing = 0,
                  changed = 0,
                  health;
                for (let i = 0; i < 4; i++) {
                  await pause(1000);
                  health = await deps.playerQuery(deps.previewBrowser, mode, "Health");
                  check();
                  if (!health.ok)
                    throw new Error(
                      health.error || "sidebar-health: Receiver stopped",
                    );
                  const picture = await samplePlayerPicture(deps.previewBrowser);
                  check();
                  if (targetAdvanced(previous, health)) advancing++;
                  if (pictureChanged(previousPicture, picture)) changed++;
                  previous = health;
                  previousPicture = picture;
                }
                row(
                  "sidebar/" + mode,
                  advancing || changed
                    ? "target-motion-evidence"
                    : "presentation-inconclusive",
                  {
                    advancingIntervals: advancing,
                    changedPictures: changed,
                    placement: deps.lastExperiment,
                    health,
                  },
                );
                if (!winner && (advancing || changed)) winner = mode;
              } catch (error) {
                check();
                row("sidebar/" + mode, "failed", {
                  error: String(error),
                  placement: deps.lastExperiment,
                });
                if (sharedReceiverFailure(error))
                  blocked[transport] =
                    "Shared receiver prerequisite: " + String(error);
              } finally {
                cleanupPlayer();
              }
            }
            if (winner && deadline - Date.now() > 20000) {
              progress(
                "watch " +
                  winner +
                  "; listen to source audio; you may background its tab",
              );
              await deps.startLivePreview(source, winner, deps.previewGeneration, true);
              check();
              const until = Math.min(deadline - 5000, Date.now() + 60000);
              let previous = null,
                previousPicture = null,
                advancing = 0,
                changedPictures = 0,
                samples = 0,
                backgroundSamples = 0;
              while (Date.now() < until) {
                await pause(1000);
                const health = await deps.playerQuery(
                  deps.previewBrowser,
                  winner,
                  "Health",
                );
                check();
                if (!health.ok)
                  throw new Error(
                    health.error || "candidate-health: Receiver stopped",
                  );
                if (targetAdvanced(previous, health)) advancing++;
                if (samples % 3 === 0) {
                  const picture = await samplePlayerPicture(deps.previewBrowser);
                  check();
                  if (pictureChanged(previousPicture, picture))
                    changedPictures++;
                  previousPicture = picture;
                }
                if (selected.tab && selected.tab !== gBrowser.selectedTab)
                  backgroundSamples++;
                previous = health;
                samples++;
                if (samples % 5 === 0) {
                  report.candidate = {
                    mode: winner,
                    samples,
                    advancing,
                    changedPictures,
                    backgroundSamples,
                    health,
                  };
                  publish();
                }
              }
              row(
                "candidate/" + winner,
                advancing || changedPictures
                  ? "motion-observed"
                  : "presentation-inconclusive",
                {
                  samples,
                  advancing,
                  changedPictures,
                  backgroundSamples,
                  backgroundStatus: backgroundSamples
                    ? "sampled"
                    : "not-tested-user-kept-source-active",
                  audioStatus: "requires-user-listening",
                  visualStatus: "requires-user-confirmation",
                },
              );
            }
            if (sendControl) {
              try {
                const after = await sendControl("Probe", {
                  videoRef: controlSource.data.videoRef,
                });
                report.sourceAfter = {
                  time: after.time,
                  paused: after.paused,
                  muted: after.muted,
                  volume: after.volume,
                  stateUnchanged:
                    after.paused === sourceProbe.paused &&
                    after.muted === sourceProbe.muted &&
                    after.volume === sourceProbe.volume,
                };
              } catch (error) {
                report.sourceAfter = { error: String(error) };
              }
            }
            report.outcome = winner
              ? "live-motion-evidence-awaiting-visual-audio-confirmation"
              : "keep-working-baseline; inspect-first-specific-blocker";
          } catch (error) {
            report.outcome = "stopped";
            row("runner", "stopped", { error: String(error) });
          } finally {
            clearTimeout(watchdog);
            stopControl();
            cleanupPlayer();
            report.elapsedMs = Date.now() - started;
            report.cleanup = {
              receiverRemoved: !deps.previewBrowser?.isConnected,
              sourceConnected: !!selected?.browser?.isConnected,
              masterDisableDuringRun: deps.experimentalBridgeDisabled(),
              settingsChangedByRunner: false,
            };
            deps.testingAll = false;
            publish();
            if (!deps.disposed && token === deps.experimentTestToken) {
              deps.resetRendering();
              deps.wakePaint();
            }
          }
          try {
            Cc["@mozilla.org/widget/clipboardhelper;1"]
              .getService(Ci.nsIClipboardHelper)
              .copyString(JSON.stringify(report, null, 2));
            return true;
          } catch (_) {
            return false;
          }
        }
        async function testEverything(selected, progress) {
          if (!deps.experimentalBridgeDisabled())
            return runCombinedVideoTests(selected, progress);
          const experimentalRun = !deps.experimentalBridgeDisabled();
          const testToken = deps.experimentTestToken;
          const checkTest = () => {
            if (
              experimentalRun &&
              (deps.disposed ||
                deps.experimentalBridgeDisabled() ||
                testToken !== deps.experimentTestToken)
            )
              throw new Error("cancelled: Experiment test cancelled");
          };
          const lines = [
            `ZentralVideoPreview ${deps.BUILD} — ${new Date().toISOString()}`,
            `Experimental bridge: ${deps.experimentalBridgeDisabled() ? "disabled" : "enabled"}`,
            `Selected source: ${selected?.tab?.label || selected?.data?.label || "none"}`,
            `Source tab active: ${selected?.tab === gBrowser.selectedTab}`,
            `Source browser connected: ${!!selected?.browser?.isConnected}`,
            `Source reference: ${!!selected?.data?.videoRef}`,
            ...(!deps.experimentalBridgeDisabled()
              ? [
                  `Browser: ${deps.Services.appinfo.name} ${deps.Services.appinfo.version}; build ${deps.Services.appinfo.appBuildID}; platform ${deps.Services.appinfo.platformVersion}; OS ${deps.Services.appinfo.OS}`,
                  `Placement: ${JSON.stringify(deps.experimentWindowIdentity(selected?.context?.currentWindowGlobal))}`,
                ]
              : []),
            `Capabilities: clone=${selected?.data?.canClone}, stream=${selected?.data?.canStream}, canvas-stream=${selected?.data?.canCanvasStream}`,
            "",
          ];
          const reportNode = document.getElementById(
            "zs-video-preview-test-report",
          );
          const publish = () => {
            if (reportNode) {
              reportNode.hidden = false;
              reportNode.value = lines.join("\n");
            }
          };
          if (!selected?.browser?.isConnected) {
            lines.push(
              "No connected video selected. Select a source and run the test again.",
            );
            publish();
          } else {
            deps.testingAll = true;
            try {
              for (let i = 0; deps.scanning && i < 20; i++)
                await new Promise((resolve) => setTimeout(resolve, 100));
              deps.resetRendering();
              const item = {
                browser: selected.browser,
                tab: selected.tab,
                panel: selected.panel,
              };
              for (const [method, inspect] of [
                ["frame", deps.inspectFrame],
                ["actor", deps.inspectActor],
                ["direct", deps.inspectDirect],
              ]) {
                checkTest();
                progress(method + " discovery");
                let candidates = [];
                try {
                  candidates = await inspect(item);
                  lines.push(
                    `${method} discovery: ${candidates.length} video(s); ${deps.methodState[method]}`,
                  );
                } catch (error) {
                  lines.push(`${method} discovery: ERROR ${String(error)}`);
                }
                const source =
                  candidates.find(
                    (candidate) =>
                      candidate.data?.kind === "video" &&
                      candidate.data.width === selected.data.width &&
                      candidate.data.height === selected.data.height,
                  ) ||
                  candidates.find(
                    (candidate) => candidate.data?.kind === "video",
                  );
                if (!source) {
                  for (const mode of deps.RENDER_MODES)
                    lines.push(
                      `${method} + ${mode}: SKIPPED discovery found no video`,
                    );
                  lines.push("");
                  publish();
                  continue;
                }
                lines.push(
                  `${method} video: ${source.data.width}×${source.data.height}; ref=${!!source.data.videoRef}; rect=${!!source.data.rect}`,
                );
                for (const mode of deps.RENDER_MODES) {
                  checkTest();
                  progress(`${method} + ${mode}`);
                  const started = performance.now();
                  let bitmap;
                  try {
                    if (deps.LIVE_MODES.includes(mode)) {
                      await deps.startLivePreview(
                        source,
                        mode,
                        deps.previewGeneration,
                        true,
                      );
                      checkTest();
                      const first = await deps.playerQuery(
                        deps.previewBrowser,
                        mode,
                        "Health",
                      );
                      await new Promise((resolve) => setTimeout(resolve, 700));
                      checkTest();
                      const second = await deps.playerQuery(
                        deps.previewBrowser,
                        mode,
                        "Health",
                      );
                      const picture = await samplePlayerPicture(deps.previewBrowser);
                      checkTest();
                      lines.push(
                        `${method} + ${mode}: OK; first=${JSON.stringify(first)}; after 700ms=${JSON.stringify(second)}; picture=${JSON.stringify(picture)}; ${Math.round(performance.now() - started)}ms`,
                      );
                    } else {
                      bitmap =
                        mode === "canvas"
                          ? await deps.captureVideo(source)
                          : await deps.captureSnapshot(source);
                      lines.push(
                        `${method} + ${mode}: ${bitmap ? `OK ${bitmap.width}×${bitmap.height}` : "unchanged frame"}; ${Math.round(performance.now() - started)}ms`,
                      );
                    }
                  } catch (error) {
                    lines.push(
                      `${method} + ${mode}: ERROR ${String(error)}; ${Math.round(performance.now() - started)}ms`,
                    );
                  } finally {
                    bitmap?.close?.();
                    if (!experimentalRun || testToken === deps.experimentTestToken) {
                      deps.disposePlayer();
                      deps.canvas?.style.removeProperty("display");
                    }
                  }
                  publish();
                }
                lines.push("");
              }
            } catch (error) {
              lines.push(`Test runner: ERROR ${String(error)}`);
            } finally {
              deps.testingAll = false;
              if (!experimentalRun || testToken === deps.experimentTestToken) {
                deps.disposePlayer();
                deps.resetRendering();
                deps.wakePaint();
              }
              publish();
            }
          }
          try {
            Cc["@mozilla.org/widget/clipboardhelper;1"]
              .getService(Ci.nsIClipboardHelper)
              .copyString(lines.join("\n"));
            return true;
          } catch (error) {
            lines.push(
              `Clipboard: ${String(error)}; select the report below to copy it.`,
            );
            publish();
            return false;
          }
        }
        async function samplePlayerPicture(browser) {
          let bitmap;
          try {
            const rect = browser.getBoundingClientRect();
            const global = browser.browsingContext?.currentWindowGlobal;
            if (!global || rect.width < 2 || rect.height < 2)
              return {
                error: "Preview browser has no drawable viewport",
                size: [rect.width, rect.height],
              };
            bitmap = await deps.limited(
              global.drawSnapshot(
                new DOMRect(0, 0, rect.width, rect.height),
                Math.min(1, 48 / rect.width),
                "rgb(0, 0, 0)",
              ),
              1200,
              "preview snapshot",
            );
            const surface = document.createElement("canvas");
            surface.width = 24;
            surface.height = 14;
            const context = surface.getContext("2d", {
              willReadFrequently: true,
            });
            context.drawImage(bitmap, 0, 0, 24, 14);
            const pixels = context.getImageData(0, 0, 24, 14).data;
            let lit = 0,
              fingerprint = 2166136261;
            for (let i = 0; i < pixels.length; i += 4) {
              const sum = pixels[i] + pixels[i + 1] + pixels[i + 2];
              if (sum > 36) lit++;
              fingerprint = Math.imul(fingerprint ^ (sum >> 3), 16777619) >>> 0;
            }
            return {
              litPixels: lit,
              fingerprint,
              totalPixels: 336,
              viewport: [Math.round(rect.width), Math.round(rect.height)],
            };
          } catch (error) {
            return { error: String(error) };
          } finally {
            bitmap?.close?.();
          }
        }
return { ensureVideoTestControls, ensureVideoDevCategory, cancelExperimentTests, runSourceExperiment, sameVideoSource, targetAdvanced, pictureChanged, sharedReceiverFailure, sampleSourceControl, runCombinedVideoTests, testEverything, samplePlayerPicture };
});
})();
