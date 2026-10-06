/*
 * ZENTRAL FILE GUIDE - features/video/controllers/ZentralVideoScheduling.js
 *
 * Purpose: Coordinates scan/paint scheduling, native compact-tabbar visibility, compact pause/resume and
 *   start/stop of preview work.
 * Interaction / execution: VideoPreview supplies live timers/state and callbacks from Discovery, Rendering,
 *   Sidebar and optional Captions. Native tab hover reveals schedule a delayed preview wake through the
 *   existing policy.
 * Ownership / failure: stop cancels controller work and owned renderer/bridge activity through callbacks.
 *   Preserve the single pending paint timeout and avoid hidden 100ms visibility loops or global
 *   mouse-movement layout scans.
 * Registration: video/ZentralVideoScheduling
 * Loaded/created by: features/video/ZentralVideoPreview.uc.js
 * Returned factory API: compactTabbarHidden; pauseCompactPreview; start; stop; syncCompactVisibility;
 *   updatePaintTimer
 * Injected deps state/callbacks used: ACTOR; FRAME_MS; IDLE_TIMER_PREF; LIVE_MODES; Services;
 *   WORKING_MODES; activeScanToken; actorAttempted; actorReady; box; bridges; browserReports;
 *   cancelExperimentTests; captionTimer; clearCaptionWatch; compactCheckTimer; compactHiddenSince;
 *   compactHovering; compactMountTimer; compactPaused; compactResumeSource; current; decodedCanvas;
 *   diagnostics; dirtyBrowsers; discoveryCache; discoveryLocks; discoveryWakeTimer; discoveryWinner;
 *   disposed; enabled; ensureActor; featureOn; frameTimer; liveBridgeEnabled; metrics; mount;
 *   mountObserver; nextHealthCheck; nextRenderProbe; nextStillCapture; paint; paintTimerMs;
 *   pauseWhenCompactHidden; previewAutoSelected; previewMode; previewVisible; queuedDiscovery;
 *   queuedFullScan; refreshSettingList; releaseBridge; renderBusy; rendererChoice; rendererRetryCounts;
 *   resetProgressSync; resetRendering; restartCaptionTimer; restartDiscoveryTimer; restartVisibilityTimer;
 *   scan; scanGeneration; scanTimer; scanning; select; setCaption; sourceVisibilityTimer; sources;
 *   syncProgressState; unavailableBySource; videoHidden; visibilityCheckAt; visibilityPolicyApplies;
 *   wakeTimer
 * Contract fields assigned here: deps.activeScanToken; deps.actorAttempted; deps.actorReady;
 *   deps.box.hidden; deps.captionTimer; deps.compactCheckTimer; deps.compactHiddenSince;
 *   deps.compactMountTimer; deps.compactPaused; deps.compactResumeSource; deps.compactResumeSource.at;
 *   deps.current; deps.decodedCanvas; deps.diagnostics.lastError; deps.diagnostics.phase;
 *   deps.discoveryWakeTimer; deps.discoveryWinner; deps.frameTimer; deps.metrics.paintWakeups;
 *   deps.mountObserver; deps.paintTimerMs; deps.previewAutoSelected; deps.queuedDiscovery;
 *   deps.queuedFullScan; deps.scanGeneration; deps.scanTimer; deps.scanning; deps.sourceVisibilityTimer;
 *   deps.sources; deps.wakeTimer
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("video/ZentralVideoScheduling", function (deps) {
        function updatePaintTimer(active = true) {
          clearTimeout(deps.frameTimer);
          deps.frameTimer = null;
          if (!deps.scanTimer || deps.renderBusy) return;
          if (
            (!active || !deps.current || deps.videoHidden || !deps.previewVisible()) &&
            deps.featureOn(deps.IDLE_TIMER_PREF)
          ) {
            deps.paintTimerMs = 0;
            return;
          }
          // A single timeout is scheduled after the previous asynchronous paint.
          // Live preview health does not need 10 empty wakeups per second.
          const due =
            active && deps.LIVE_MODES.includes(deps.previewMode)
              ? deps.nextHealthCheck
              : active && deps.WORKING_MODES.includes(deps.previewMode)
                ? deps.nextStillCapture
                : active && deps.nextRenderProbe
                  ? deps.nextRenderProbe
                  : Date.now() + deps.FRAME_MS;
          const needsVisibilityPoll =
            deps.visibilityPolicyApplies() &&
            !["frame-native", "native"].includes(deps.previewMode);
          const nextDue =
            needsVisibilityPoll && deps.visibilityCheckAt > 0
              ? Math.min(due, deps.visibilityCheckAt)
              : due;
          deps.paintTimerMs = Math.max(1, nextDue - Date.now());
          deps.frameTimer = setTimeout(() => {
            deps.frameTimer = null;
            deps.metrics.paintWakeups++;
            deps.paint();
          }, deps.paintTimerMs);
        }
        function compactTabbarHidden() {
          if (
            !deps.pauseWhenCompactHidden() ||
            document.documentElement.getAttribute("zen-compact-mode") !== "true"
          )
            return false;
          const tabs =
            document.getElementById("tabbrowser-tabs") || gBrowser.tabContainer;
          if (!tabs?.isConnected) return false; // Do not pause on an unknown layout.
          // A pointer entering the actual tabs is stronger evidence than a rectangle
          // or opacity sampled midway through the compact reveal animation.
          if (deps.compactHovering) return false;
          const rect = tabs.getBoundingClientRect();
          if (
            rect.width < 2 ||
            rect.height < 2 ||
            rect.right <= 0 ||
            rect.left >= window.innerWidth ||
            rect.bottom <= 0 ||
            rect.top >= window.innerHeight
          )
            return true;
          for (
            let node = tabs;
            node && node !== document.documentElement;
            node = node.parentElement
          ) {
            const style = getComputedStyle(node);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              Number(style.opacity) < 0.05
            )
              return true;
          }
          return false;
        }
        function pauseCompactPreview() {
          clearInterval(deps.sourceVisibilityTimer);
          deps.sourceVisibilityTimer = null;
          deps.resetProgressSync();
          deps.clearCaptionWatch();
          clearInterval(deps.captionTimer);
          deps.captionTimer = null;
          deps.setCaption("");
          if (deps.compactPaused) return;
          deps.compactPaused = true;
          if (deps.current?.browser?.isConnected)
            deps.compactResumeSource = {
              browser: deps.current.browser,
              method: deps.current.method,
              frameId: deps.current.data.frameId,
              documentId: deps.current.data.documentId,
              id: deps.current.data.id,
              autoSelected: deps.previewAutoSelected,
              at: Date.now(),
            };
          ++deps.scanGeneration; // Ignore replies from a scan started before hiding.
          clearTimeout(deps.discoveryWakeTimer);
          deps.discoveryWakeTimer = null;
          deps.dirtyBrowsers.clear();
          deps.discoveryCache.clear();
          deps.queuedDiscovery = deps.queuedFullScan = false;
          clearTimeout(deps.compactMountTimer);
          deps.compactMountTimer = null;
          clearInterval(deps.scanTimer);
          clearTimeout(deps.frameTimer);
          deps.mountObserver?.disconnect();
          deps.mountObserver = null;
          deps.scanTimer = deps.frameTimer = null;
          deps.paintTimerMs = 0;
          ++deps.activeScanToken;
          deps.scanning = false; // An old scan may still be settling after cancellation.
          deps.resetRendering(); // Stops live renderers and cancels pending still captures.
          for (const browser of deps.bridges.keys()) deps.releaseBridge(browser);
          deps.sources = [];
          deps.current = null;
          // Capture pause must preserve the user's source lock.
          deps.previewAutoSelected = false;
          deps.browserReports.clear();
          deps.discoveryLocks.clear();
          if (deps.compactResumeSource?.browser?.isConnected)
            deps.discoveryLocks.set(
              deps.compactResumeSource.browser,
              deps.compactResumeSource.method,
            );
          deps.discoveryWinner = null;
          if (deps.box) deps.box.hidden = true;
          deps.diagnostics.phase = "paused (compact tabbar hidden)";
          deps.refreshSettingList();
        }
        function syncCompactVisibility(settled = false) {
          if (deps.disposed) return;
          clearTimeout(deps.compactCheckTimer);
          deps.compactCheckTimer = null;
          const watching = deps.enabled() && deps.pauseWhenCompactHidden() &&
            document.documentElement.getAttribute("zen-compact-mode") === "true";
          const hidden = watching && compactTabbarHidden();
          if (hidden) {
            if (!deps.compactHiddenSince) deps.compactHiddenSince = Date.now();
            const remaining = 350 - (Date.now() - deps.compactHiddenSince);
            if (remaining <= 0) pauseCompactPreview();
            else deps.compactCheckTimer = setTimeout(() => syncCompactVisibility(true), remaining);
          } else {
            deps.compactHiddenSince = 0;
            if (deps.compactPaused && deps.enabled()) {
              // Keep source/renderer reconstruction off the native reveal event.
              if (watching && !settled)
                deps.compactCheckTimer = setTimeout(() => syncCompactVisibility(true), 250);
              else {
                deps.compactPaused = false;
                if (deps.compactResumeSource) deps.compactResumeSource.at = Date.now();
                start(true);
                deps.refreshSettingList();
              }
            }
          }
        }
        function stop() {
          deps.resetProgressSync();
          clearInterval(deps.sourceVisibilityTimer);
          deps.sourceVisibilityTimer = null;
          deps.cancelExperimentTests();
          deps.decodedCanvas = null;
          deps.clearCaptionWatch();
          clearTimeout(deps.wakeTimer);
          deps.wakeTimer = null;
          clearTimeout(deps.discoveryWakeTimer);
          deps.discoveryWakeTimer = null;
          deps.dirtyBrowsers.clear();
          deps.discoveryCache.clear();
          deps.queuedDiscovery = deps.queuedFullScan = false;
          clearInterval(deps.captionTimer);
          deps.captionTimer = null;
          deps.setCaption("");
          ++deps.scanGeneration;
          deps.resetRendering();
          clearInterval(deps.scanTimer);
          clearTimeout(deps.frameTimer);
          deps.mountObserver?.disconnect();
          deps.mountObserver = null;
          clearTimeout(deps.compactMountTimer);
          deps.compactMountTimer = null;
          deps.scanTimer = deps.frameTimer = null;
          deps.paintTimerMs = 0;
          deps.sources = [];
          deps.current = null;
          deps.compactResumeSource = null;
          deps.compactHiddenSince = 0;
          deps.previewAutoSelected = false;
          deps.compactPaused = false;
          ++deps.activeScanToken;
          deps.scanning = false;
          deps.browserReports.clear();
          deps.discoveryLocks.clear();
          deps.discoveryWinner = null;
          deps.unavailableBySource.clear();
          deps.rendererRetryCounts.clear();
          deps.box?.remove();
          deps.diagnostics.phase = "disabled";
          for (const browser of deps.bridges.keys()) deps.releaseBridge(browser);
          if (deps.actorReady) {
            try {
              const windows = deps.Services.wm.getEnumerator("navigator:browser");
              let otherRunning = false;
              while (windows.hasMoreElements()) {
                const other = windows.getNext();
                if (
                  other !== window &&
                  other.ZentralVideoPreview?.diagnostics()?.actorName ===
                    deps.ACTOR &&
                  (other.ZentralVideoPreview?.diagnostics()?.running ||
                    other.ZentralVideoPreview?.diagnostics()?.compactPaused) &&
                  other.ZentralVideoPreview?.diagnostics()?.actorRegistered ===
                    true
                )
                  otherRunning = true;
              }
              if (!otherRunning) ChromeUtils.unregisterWindowActor(deps.ACTOR);
            } catch (_) {
              /* Another window or a prior copy may own the actor. */
            }
          }
          deps.actorReady = deps.actorAttempted = false;
        }
        function start(resuming = false) {
          if (deps.disposed || !deps.enabled() || deps.scanTimer) return;
          if (compactTabbarHidden()) {
            pauseCompactPreview();
            return;
          }
          deps.compactPaused = false;
          deps.diagnostics.lastError = "";
          deps.diagnostics.phase = "scanning";
          if (
            deps.liveBridgeEnabled() &&
            ["auto", "native", "stream"].includes(deps.rendererChoice())
          )
            deps.ensureActor();
          deps.mount();
          deps.restartDiscoveryTimer();
          deps.syncProgressState();
          deps.restartVisibilityTimer();
          deps.paintTimerMs = 0;
          updatePaintTimer();
          deps.restartCaptionTimer();
          deps.mountObserver = new MutationObserver(records => {
            if (!records.some(record => {
              const target = record.target;
              if (deps.box?.contains(target) || target?.closest?.("tab, .tabbrowser-tab")) return false;
              return [...record.addedNodes, ...record.removedNodes].some(node =>
                node === deps.box || node.nodeType === 1 &&
                (node.matches?.("#zen-media-controls-toolbar,#zen-sidebar-bottom-buttons,#tabbrowser-tabs,#vertical-tabs") ||
                 node.querySelector?.("#zen-media-controls-toolbar,#zen-sidebar-bottom-buttons,#tabbrowser-tabs,#vertical-tabs")));
            })) return;
            clearTimeout(deps.compactMountTimer);
            deps.compactMountTimer = setTimeout(() => {
              deps.compactMountTimer = null;
              if (!deps.disposed && !deps.compactPaused && deps.enabled()) deps.mount();
            }, 100);
          });
          const sidebar = document.getElementById("navigator-toolbox") || gBrowser.tabContainer.parentElement;
          if (sidebar) deps.mountObserver.observe(sidebar, { childList: true, subtree: true });
          // A compact reveal can finish after the first mount attempt.
          deps.compactMountTimer = setTimeout(() => {
            deps.compactMountTimer = null;
            if (deps.disposed || deps.compactPaused || !deps.enabled()) return;
            deps.mount();
            if (deps.current && deps.box?.isConnected && deps.box.hidden)
              deps.select(deps.current, true, deps.previewAutoSelected);
          }, 200);
          if (resuming || deps.compactResumeSource?.browser?.isConnected) {
            deps.scan(false, true).then(() => {
              if (!deps.disposed && deps.enabled() && !deps.compactPaused) deps.scan();
            });
          } else {
            deps.compactResumeSource = null;
            deps.scan();
          }
        }
return { updatePaintTimer, compactTabbarHidden, pauseCompactPreview, syncCompactVisibility, stop, start };
});
})();
