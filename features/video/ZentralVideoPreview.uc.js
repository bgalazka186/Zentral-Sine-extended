/*
 * ZENTRAL FILE GUIDE - features/video/ZentralVideoPreview.uc.js
 *
 * Purpose: Owns per-window video preferences/state, live controller contracts, content helper
 *   strings/identity, event binding, preference transitions and final preview cleanup.
 * Interaction / execution: Runtime starts video independently; standalone mode can initialize its own
 *   loader. Loads required Transport/Discovery/Rendering/Sidebar/Scheduling and optional
 *   Captions/Settings/Diagnostics. Content helpers run through actor/frame IPC.
 * Ownership / failure: All controllers share getter/setter-backed deps; do not replace mutable fields with
 *   copied values. stop/cleanup cancel owned timers/requests/renderers; page media playback belongs to the
 *   source page.
 * Registration: video
 * Loaded/created by: core/ZentralCatalog.js
 * Direct local resource paths: features/video/controllers/ZentralVideoCaptions.js; features/video/controllers/ZentralVideoDiagnostics.js;
 *   features/video/controllers/ZentralVideoDiscovery.js; features/video/controllers/ZentralVideoRendering.js;
 *   features/video/controllers/ZentralVideoScheduling.js; features/video/controllers/ZentralVideoSettings.js; features/video/controllers/ZentralVideoSidebar.js;
 *   features/video/controllers/ZentralVideoTransport.js; features/video/content/ZentralVideoActor.sys.mjs;
 *   features/video/content/ZentralVideoBasicFrame.js; features/video/content/ZentralVideoFrame.js
 * Constructed factory IDs: video/ZentralVideoCaptions; video/ZentralVideoDiagnostics;
 *   video/ZentralVideoDiscovery; video/ZentralVideoRendering; video/ZentralVideoScheduling;
 *   video/ZentralVideoSettings; video/ZentralVideoSidebar; video/ZentralVideoTransport
 * Literal DOM event subscriptions: click; pointerenter; pointerleave; resize; scroll; sizemodechange;
 *   unload; visibilitychange
 *
 * Resize cleanup contract: Sidebar.cancelResize releases active grip capture before owner destruction.
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  /*
   * ZENTRAL SIDEBAR VIDEO PREVIEW - maintainer map (Zen 1.23b / Gecko 157)
   *
   * 1. Bootstrap, preferences and per-window state.
   * 2. Generated content helpers and frame/actor transport.
   * 3. Video settings; diagnostic controls require the experiments toggle.
   * 4. Sidebar UI, source identity, visibility and discovery.
   * 5. Receiver construction, live presentation and still-image capture.
   * 6. Paint scheduling, preference transitions and resource teardown.
   * Search the numbered SECTION comments below to navigate this file.
   *
   * Controllers: features/video/controllers/*.js. Content helpers: features/video/content/*.
   * This supplied tree contains installed helpers only; shared renderer/templates
   * and their historical build tool are not included. Coordinate shared edits in
   * both Frame and Actor helpers until that source/build workflow is restored.
   * This entrypoint owns window state and passes explicit controller contracts.
   * See ARCHITECTURE.md and FILE_GUIDE.json for current contracts.
   * Historic experiment names and preference keys are retained for compatibility.
   * Normal sidebar methods now work without experiments; source-page tests and
   * legacy capture still require the toggle (and legacy's separate opt-in).
   *
   * Reconstruction / browser-update checklist:
   * - Check exact source reference, document lifetime, process, container and
   *   private context. Matching remoteType alone does not prove same process.
   * - Content authorization comes from privileged parent IPC, not a content
   *   read of browser preferences. Never broaden grants to arbitrary pages.
   * - Lay out a visible about:blank receiver before attaching decoded output.
   * - Native target currentTime/readyState/quality counters can stay zero;
   *   inspect painted frames, callbacks and bounded receiver snapshots too.
   * - CRITICAL display fix: detach the fallback canvas after verified live
   *   presentation. In earlier builds it covered moving video; display:none
   *   was unreliable against user-origin !important CSS. Restore the same
   *   canvas on failure/teardown. Never delete the original fallback methods.
   * - Cancel stale async work by generation/session identity. Stop only owned
   *   receivers/clones/tracks; source playback and audio belong to the page.
   *
   * Acceptance evidence, 2026-10-03: build 19 on Windows / YouTube recorded
   * motion for all five sidebar live modes, with fallbackInPicture=false.
   * Native sustained 59 advancing intervals / 60 samples in the background.
   * Hidden source-page canvas control still timed out; sidebar canvas passed.
   * This is a tested configuration, not certification of every future Gecko
   * build, site, encrypted video or panel. Recheck the failing stage only.
   */
  // SECTION 1: Bootstrap, preferences and state.
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  if (!window.ZentralModuleLoader) {
  const Services = globalThis.Services || ChromeUtils.importESModule(
    "resource://gre/modules/Services.sys.mjs").Services;
  const rootURI = Services.io.newURI("../../", null,
    Services.io.newURI(Components.stack.filename)).spec;
  const definitions = new Map(), files = new Map(), textCache = new Map(), sourceById = new Map();
  let loadingSource = null, netUtil = null;
  const safePath = path => /^(?:JS|CSS|settings|core|features)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\.uc|\.sys)?\.(?:js|mjs|css|json)$/.test(path);
  const loader = window.ZentralModuleLoader = {
    rootURI,
    define(id, factory) {
      if (definitions.has(id)) throw new Error("Duplicate component: " + id);
      definitions.set(id, factory);
      sourceById.set(id, loadingSource);
    },
    load(path, { optional = false, owner = "core" } = {}) {
      if (!safePath(path) || !/^(?:JS|core|features)\//.test(path)) throw new Error("Unsafe module path: " + path);
      const existing = files.get(path);
      if (existing?.state === "loaded") return true;
      if (existing?.state === "failed") {
        if (optional) return false;
        throw new Error("Required source unavailable: " + path + ": " + existing.error);
      }
      const row = { file: path, owner, phase: "load", state: "loading" };
      files.set(path, row);
      const previousSource = loadingSource;
      loadingSource = path;
      try {
        Services.scriptloader.loadSubScript(rootURI + path, window, "UTF-8");
        row.state = "loaded";
        return true;
      } catch (error) {
        row.state = "failed"; row.error = String(error?.stack || error);
        console.error("[Zentral source]", path, error);
        window.dispatchEvent(new CustomEvent("zentral-runtime-change"));
        if (!optional) throw error;
        return false;
      } finally { loadingSource = previousSource; }
    },
    readText(path, owner = "core") {
      if (!safePath(path)) throw new Error("Unsafe resource path: " + path);
      if (textCache.has(path)) return textCache.get(path);
      const existing = files.get(path);
      if (existing?.state === "failed")
        throw new Error("Resource unavailable: " + path + ": " + existing.error);
      const row = { file: path, owner, phase: "resource", state: "loading" };
      files.set(path, row);
      try {
        // Read installed chrome resources with a privileged channel. Window XHR
        // can reject synchronous chrome:// requests even when loadSubScript works.
        netUtil ||= ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs").NetUtil;
        const channel = netUtil.newChannel({
          uri: Services.io.newURI(rootURI + path),
          loadUsingSystemPrincipal: true,
        });
        let input = null, converter = null;
        const chunks = [];
        try {
          input = channel.open();
          converter = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
            .createInstance(Components.interfaces.nsIConverterInputStream);
          converter.init(input, "UTF-8", 4096, 0);
          const chunk = {};
          while (converter.readString(4096, chunk)) chunks.push(chunk.value);
        } finally {
          try { converter?.close(); } catch (_) {}
          try { input?.close(); } catch (_) {}
        }
        const text = chunks.join("");
        if (!text) throw new Error("Empty resource: " + path);
        textCache.set(path, text); row.state = "loaded";
        return text;
      } catch (error) {
        row.state = "failed"; row.error = String(error) + (error?.stack ? "\n" + error.stack : "");
        console.error("[Zentral source]", path, error);
        throw error;
      }
    },
    create(id, args, { optional = false } = {}) {
      const file = sourceById.get(id);
      try { return this.require(id)(args); }
      catch (error) {
        const row = file && files.get(file);
        if (row) { row.state = "failed"; row.phase = "factory"; row.component = id; row.error = String(error?.stack || error); }
        console.error("[Zentral component]", file || id, error);
        if (!optional) throw error;
        return null;
      }
    },
    require(id) {
      if (!definitions.has(id)) throw new Error("Component did not register: " + id);
      return definitions.get(id);
    },
    has: id => definitions.has(id) && files.get(sourceById.get(id))?.state !== "failed",
    sources: () => [...files.values()].map(row => ({ ...row })),
    report() {
      return { sources: this.sources(), runtime: window.ZentralRuntime?.snapshot?.() || null };
    },
    showDiagnostics() {
      let box = document.getElementById("zentral-bootstrap-diagnostics");
      if (box) { box.remove(); return; }
      box = document.createElement("pre"); box.id = "zentral-bootstrap-diagnostics";
      box.style.cssText = "position:fixed;inset:8%;overflow:auto;z-index:2147483647;padding:20px;background:#171923;color:#f3f4f6;white-space:pre-wrap;border:1px solid #64748b";
      box.textContent = "Zentral source diagnostics (click to close)\n\n" + JSON.stringify(this.report(), null, 2);
      box.addEventListener("click", () => box.remove(), { once: true });
      document.documentElement.append(box);
    },
    destroy() { definitions.clear(); files.clear(); textCache.clear(); sourceById.clear(); netUtil = null; delete window.ZentralModuleLoader; }
  };

  }
  const ZentralRuntime = window.ZentralRuntime;
  if (!ZentralRuntime) window.addEventListener("unload", () => window.ZentralModuleLoader?.destroy(), { once: true });

  function standaloneReady(start) {
    let started = false;
    const run = () => {
      if (started || !window.gBrowser) return;
      started = true;
      try {
        Services.obs.removeObserver(
          observer,
          "browser-delayed-startup-finished",
        );
      } catch (_) {}
      start();
    };
    const observer = {
      observe(subject, topic) {
        if (subject === window && topic === "browser-delayed-startup-finished")
          run();
      },
    };
    if (
      window.gBrowser &&
      (!window.gBrowserInit || window.gBrowserInit.delayedStartupFinished)
    )
      run();
    else {
      Services.obs.addObserver(observer, "browser-delayed-startup-finished");
      window.addEventListener(
        "unload",
        () => {
          try {
            Services.obs.removeObserver(
              observer,
              "browser-delayed-startup-finished",
            );
          } catch (_) {}
        },
        { once: true },
      );
      if (window.gBrowserInit?.delayedStartupFinished) run();
    }
  }
  (function () {
    const start = () => {
      (function initZentralVideoPreview() {
        window.ZentralModuleLoader.load("features/video/controllers/ZentralVideoTransport.js", { owner: "video" });
        const { ensureActor, bridge, releaseBridge, query, limited, playerQuery } = window.ZentralModuleLoader.create("video/ZentralVideoTransport", {
          get ACTOR() { return ACTOR; },
          get CAPTIONS_PREF() { return CAPTIONS_PREF; },
          get CAPTION_EVENTS_PREF() { return CAPTION_EVENTS_PREF; },
          get CHANNEL() { return CHANNEL; },
          get EXPERIMENTAL_ACTOR_SOURCE() { return EXPERIMENTAL_ACTOR_SOURCE; },
          get EXPERIMENTAL_FRAME_URI() { return EXPERIMENTAL_FRAME_URI; },
          get EXPERIMENT_HELPER_ID() { return EXPERIMENT_HELPER_ID; },
          get FRAME_URI() { return FRAME_URI; },
          get MEDIA_EVENTS_PREF() { return MEDIA_EVENTS_PREF; },
          get Services() { return Services; },
          get actorAttempted() { return actorAttempted; },
          set actorAttempted(value) { actorAttempted = value; },
          get actorModuleURI() { return actorModuleURI; },
          set actorModuleURI(value) { actorModuleURI = value; },
          get actorReady() { return actorReady; },
          set actorReady(value) { actorReady = value; },
          get bridges() { return bridges; },
          get captionWatch() { return captionWatch; },
          set captionWatch(value) { captionWatch = value; },
          get current() { return current; },
          set current(value) { current = value; },
          get diagnostics() { return diagnostics; },
          get enabled() { return enabled; },
          get experimentalBridgeDisabled() { return experimentalBridgeDisabled; },
          get featureOn() { return featureOn; },
          get liveBridgeEnabled() { return liveBridgeEnabled; },
          get liveModeEnabled() { return liveModeEnabled; },
          get methodError() { return methodError; },
          get methodState() { return methodState; },
          get nextRequest() { return nextRequest; },
          set nextRequest(value) { nextRequest = value; },
          get normalLivePreviewEnabled() { return normalLivePreviewEnabled; },
          get queueDiscovery() { return queueDiscovery; },
          get setCaption() { return setCaption; },
          get videoHidden() { return videoHidden; },
          set videoHidden(value) { videoHidden = value; }
        });
        const video_ZentralVideoDiagnosticsAvailable = window.ZentralModuleLoader.load("features/video/controllers/ZentralVideoDiagnostics.js", { optional: true, owner: "video/ZentralVideoDiagnostics" });
        const { ensureVideoTestControls, ensureVideoDevCategory, cancelExperimentTests, runSourceExperiment, sameVideoSource, targetAdvanced, pictureChanged, sharedReceiverFailure, sampleSourceControl, runCombinedVideoTests, testEverything, samplePlayerPicture } = video_ZentralVideoDiagnosticsAvailable
          ? window.ZentralModuleLoader.create("video/ZentralVideoDiagnostics", {
          get ACTOR() { return ACTOR; },
          get BUILD() { return BUILD; },
          get CHANNEL() { return CHANNEL; },
          get EXPERIMENT_HELPER_ID() { return EXPERIMENT_HELPER_ID; },
          get LEGACY_CAPTURE_PREF() { return LEGACY_CAPTURE_PREF; },
          get LIVE_MODES() { return LIVE_MODES; },
          get RENDER_MODES() { return RENDER_MODES; },
          get Services() { return Services; },
          get bridges() { return bridges; },
          get canvas() { return canvas; },
          set canvas(value) { canvas = value; },
          get captureSnapshot() { return captureSnapshot; },
          get captureVideo() { return captureVideo; },
          get combinedReportText() { return combinedReportText; },
          set combinedReportText(value) { combinedReportText = value; },
          get current() { return current; },
          set current(value) { current = value; },
          get disposePlayer() { return disposePlayer; },
          get disposed() { return disposed; },
          set disposed(value) { disposed = value; },
          get experimentSources() { return experimentSources; },
          get experimentTestToken() { return experimentTestToken; },
          set experimentTestToken(value) { experimentTestToken = value; },
          get experimentWindowIdentity() { return experimentWindowIdentity; },
          get experimentalBridgeDisabled() { return experimentalBridgeDisabled; },
          get inspectActor() { return inspectActor; },
          get inspectDirect() { return inspectDirect; },
          get inspectFrame() { return inspectFrame; },
          get lastExperiment() { return lastExperiment; },
          set lastExperiment(value) { lastExperiment = value; },
          get limited() { return limited; },
          get methodState() { return methodState; },
          get nextRequest() { return nextRequest; },
          set nextRequest(value) { nextRequest = value; },
          get playerQuery() { return playerQuery; },
          get previewBrowser() { return previewBrowser; },
          set previewBrowser(value) { previewBrowser = value; },
          get previewGeneration() { return previewGeneration; },
          set previewGeneration(value) { previewGeneration = value; },
          get query() { return query; },
          get recordError() { return recordError; },
          get resetRendering() { return resetRendering; },
          get scanning() { return scanning; },
          set scanning(value) { scanning = value; },
          get sources() { return sources; },
          set sources(value) { sources = value; },
          get startLivePreview() { return startLivePreview; },
          get testingAll() { return testingAll; },
          set testingAll(value) { testingAll = value; },
          get wakePaint() { return wakePaint; }
        }, { optional: true }) || Object.fromEntries(["ensureVideoTestControls","ensureVideoDevCategory","cancelExperimentTests","runSourceExperiment","sameVideoSource","targetAdvanced","pictureChanged","sharedReceiverFailure","sampleSourceControl","runCombinedVideoTests","testEverything","samplePlayerPicture"].map(name => [name, () => undefined]))
          : Object.fromEntries(["ensureVideoTestControls","ensureVideoDevCategory","cancelExperimentTests","runSourceExperiment","sameVideoSource","targetAdvanced","pictureChanged","sharedReceiverFailure","sampleSourceControl","runCombinedVideoTests","testEverything","samplePlayerPicture"].map(name => [name, () => undefined]));
        const video_ZentralVideoSettingsAvailable = window.ZentralModuleLoader.load("features/video/controllers/ZentralVideoSettings.js", { optional: true, owner: "video/ZentralVideoSettings" });
        const { organizeVideoSettings, injectSetting, hookSettings } = video_ZentralVideoSettingsAvailable
          ? window.ZentralModuleLoader.create("video/ZentralVideoSettings", {
          get ADAPTIVE_DETAIL_PREF() { return ADAPTIVE_DETAIL_PREF; },
          get AUDIO_CACHE_PREF() { return AUDIO_CACHE_PREF; },
          get AUTO_HEIGHT_BUTTON_PREF() { return AUTO_HEIGHT_BUTTON_PREF; },
          get AUTO_SHOW_PREF() { return AUTO_SHOW_PREF; },
          get BINARY_FRAMES_PREF() { return BINARY_FRAMES_PREF; },
          get CANVAS_STREAM_FPS_PREF() { return CANVAS_STREAM_FPS_PREF; },
          get CANVAS_STREAM_WIDTH_PREF() { return CANVAS_STREAM_WIDTH_PREF; },
          get CAPTIONS_PREF() { return CAPTIONS_PREF; },
          get CAPTION_EVENTS_PREF() { return CAPTION_EVENTS_PREF; },
          get CAPTION_INTERVALS() { return CAPTION_INTERVALS; },
          get CAPTION_POLL_PREF() { return CAPTION_POLL_PREF; },
          get CAPTION_RECOVERY_PREF() { return CAPTION_RECOVERY_PREF; },
          get CAPTURE_RATES() { return CAPTURE_RATES; },
          get CAPTURE_RATE_PREF() { return CAPTURE_RATE_PREF; },
          get CAPTURE_WIDTH_PREF() { return CAPTURE_WIDTH_PREF; },
          get COMPACT_BUTTON_PREF() { return COMPACT_BUTTON_PREF; },
          get DIRECT_DISCOVERY_NOTICE() { return DIRECT_DISCOVERY_NOTICE; },
          get DISCOVERY_PREF() { return DISCOVERY_PREF; },
          get DISPLAY_CAP_PREF() { return DISPLAY_CAP_PREF; },
          get EXPERIMENTAL_DISABLED_PREF() { return EXPERIMENTAL_DISABLED_PREF; },
          get FIT_WIDTH_PREF() { return FIT_WIDTH_PREF; },
          get FRAME_AWARE_PREF() { return FRAME_AWARE_PREF; },
          get FRAMING_PREF() { return FRAMING_PREF; },
          get HEIGHT_PREF() { return HEIGHT_PREF; },
          get HIDE_BUTTON_PREF() { return HIDE_BUTTON_PREF; },
          get HIDE_DUPLICATES_PREF() { return HIDE_DUPLICATES_PREF; },
          get IDLE_TIMER_PREF() { return IDLE_TIMER_PREF; },
          get KEEP_VISIBLE_PREF() { return KEEP_VISIBLE_PREF; },
          get LEGACY_CAPTURE_PREF() { return LEGACY_CAPTURE_PREF; },
          get LIGHT_MONITOR_PREF() { return LIGHT_MONITOR_PREF; },
          get LIVE_MODES() { return LIVE_MODES; },
          get MEDIA_EVENTS_PREF() { return MEDIA_EVENTS_PREF; },
          get PAUSE_COMPACT_PREF() { return PAUSE_COMPACT_PREF; },
          get PERF_DIAG_PREF() { return PERF_DIAG_PREF; },
          get PINNED_DISCOVERY_PREF() { return PINNED_DISCOVERY_PREF; },
          get PIN_BUTTON_PREF() { return PIN_BUTTON_PREF; },
          get PREF() { return PREF; },
          get RADIUS_PREF() { return RADIUS_PREF; },
          get RENDER_PREF() { return RENDER_PREF; },
          get REQUIRE_AUDIO_PREF() { return REQUIRE_AUDIO_PREF; },
          get RETRY_BACKOFF_PREF() { return RETRY_BACKOFF_PREF; },
          get SCAN_INTERVAL_PREF() { return SCAN_INTERVAL_PREF; },
          get SLOW_HEALTH_PREF() { return SLOW_HEALTH_PREF; },
          get STRICT_MODE_PREF() { return STRICT_MODE_PREF; },
          get SUSPEND_HIDDEN_PREF() { return SUSPEND_HIDDEN_PREF; },
          get SUSPEND_VISIBLE_PREF() { return SUSPEND_VISIBLE_PREF; },
          get Services() { return Services; },
          get WIDTH_PREF() { return WIDTH_PREF; },
          get ZentralRuntime() { return ZentralRuntime; },
          get adaptiveWidth() { return adaptiveWidth; },
          set adaptiveWidth(value) { adaptiveWidth = value; },
          get applyPowerSettings() { return applyPowerSettings; },
          get autoShowVideo() { return autoShowVideo; },
          get cancelExperimentTests() { return cancelExperimentTests; },
          get canvasStreamFps() { return canvasStreamFps; },
          get canvasStreamWidth() { return canvasStreamWidth; },
          get captionIntervalMs() { return captionIntervalMs; },
          get captureRateDescription() { return captureRateDescription; },
          get captureRateTenths() { return captureRateTenths; },
          get captureWidth() { return captureWidth; },
          get clearCaptionWatch() { return clearCaptionWatch; },
          get compactPaused() { return compactPaused; },
          set compactPaused(value) { compactPaused = value; },
          get cropStates() { return cropStates; },
          get current() { return current; },
          set current(value) { current = value; },
          get diagnostics() { return diagnostics; },
          get discoveryChoice() { return discoveryChoice; },
          get discoveryLocks() { return discoveryLocks; },
          get discoveryWinner() { return discoveryWinner; },
          set discoveryWinner(value) { discoveryWinner = value; },
          get enabled() { return enabled; },
          get ensureVideoDevCategory() { return ensureVideoDevCategory; },
          get ensureVideoTestControls() { return ensureVideoTestControls; },
          get experimentalBridgeDisabled() { return experimentalBridgeDisabled; },
          get fastCaptures() { return fastCaptures; },
          set fastCaptures(value) { fastCaptures = value; },
          get featureOn() { return featureOn; },
          get fillWidth() { return fillWidth; },
          get fitPicture() { return fitPicture; },
          get framingChoice() { return framingChoice; },
          get heightPx() { return heightPx; },
          set heightPx(value) { heightPx = value; },
          get hideMutedDuplicates() { return hideMutedDuplicates; },
          get nextStillCapture() { return nextStillCapture; },
          set nextStillCapture(value) { nextStillCapture = value; },
          get originalSettingsOpen() { return originalSettingsOpen; },
          set originalSettingsOpen(value) { originalSettingsOpen = value; },
          get paint() { return paint; },
          get pauseWhenCompactHidden() { return pauseWhenCompactHidden; },
          get pinnedSource() { return pinnedSource; },
          set pinnedSource(value) { pinnedSource = value; },
          get powerOn() { return powerOn; },
          get previewAutoSelected() { return previewAutoSelected; },
          set previewAutoSelected(value) { previewAutoSelected = value; },
          get previewMode() { return previewMode; },
          set previewMode(value) { previewMode = value; },
          get previewVisible() { return previewVisible; },
          get radiusPx() { return radiusPx; },
          set radiusPx(value) { radiusPx = value; },
          get refreshCaption() { return refreshCaption; },
          get refreshCard() { return refreshCard; },
          get refreshMethodStatus() { return refreshMethodStatus; },
          get refreshPlaybackStatus() { return refreshPlaybackStatus; },
          get refreshSettingList() { return refreshSettingList; },
          get rendererChoice() { return rendererChoice; },
          get rendererRetryCounts() { return rendererRetryCounts; },
          get requireAudio() { return requireAudio; },
          get resetRendering() { return resetRendering; },
          get runSourceExperiment() { return runSourceExperiment; },
          get scan() { return scan; },
          get scanIntervalMs() { return scanIntervalMs; },
          get select() { return select; },
          get setAutoHeight() { return setAutoHeight; },
          get setCaption() { return setCaption; },
          get settingsCategoryGuard() { return settingsCategoryGuard; },
          set settingsCategoryGuard(value) { settingsCategoryGuard = value; },
          get settingsInstance() { return settingsInstance; },
          set settingsInstance(value) { settingsInstance = value; },
          get slowCaptures() { return slowCaptures; },
          set slowCaptures(value) { slowCaptures = value; },
          get sources() { return sources; },
          set sources(value) { sources = value; },
          get unavailableBySource() { return unavailableBySource; },
          get updatePaintTimer() { return updatePaintTimer; },
          get videoSettingFromMenu() { return videoSettingFromMenu; },
          set videoSettingFromMenu(value) { videoSettingFromMenu = value; },
          get visibilityCheckAt() { return visibilityCheckAt; },
          set visibilityCheckAt(value) { visibilityCheckAt = value; },
          get widthPercent() { return widthPercent; },
          set widthPercent(value) { widthPercent = value; },
          get wrappedSettingsOpen() { return wrappedSettingsOpen; },
          set wrappedSettingsOpen(value) { wrappedSettingsOpen = value; }
        }, { optional: true }) || Object.fromEntries(["organizeVideoSettings","injectSetting","hookSettings"].map(name => [name, () => undefined]))
          : Object.fromEntries(["organizeVideoSettings","injectSetting","hookSettings"].map(name => [name, () => undefined]));
        window.ZentralModuleLoader.load("features/video/controllers/ZentralVideoDiscovery.js", { owner: "video" });
        const { sameSource, canOpenSourceTab, rememberedSource, sourceLabel, sourceKey, hiddenByLayout, sourceCertainlyHidden, liveSourceVisible, guardLiveSourceVisibility, filterMutedDuplicates, contexts, hasVideoAudioTrack, discoveryVideos, pageMediaKey, validMediaRequest, inspectDirect, inspectActor, inspectFrame, inspectBrowser, queueDiscovery, scan } = window.ZentralModuleLoader.create("video/ZentralVideoDiscovery", {
          get ACTOR() { return ACTOR; },
          get AUDIO_CACHE_PREF() { return AUDIO_CACHE_PREF; },
          get DISCOVERY_CACHE_MS() { return DISCOVERY_CACHE_MS; },
          get EMPTY_DISCOVERY_CACHE_MS() { return EMPTY_DISCOVERY_CACHE_MS; },
          get KEEP_VISIBLE_PREF() { return KEEP_VISIBLE_PREF; },
          get PINNED_DISCOVERY_PREF() { return PINNED_DISCOVERY_PREF; },
          get SUSPEND_VISIBLE_PREF() { return SUSPEND_VISIBLE_PREF; },
          get Services() { return Services; },
          get activeScanToken() { return activeScanToken; },
          set activeScanToken(value) { activeScanToken = value; },
          get audioProbeCache() { return audioProbeCache; },
          get autoPreviewChoice() { return autoPreviewChoice; },
          get autoShowVideo() { return autoShowVideo; },
          get bridges() { return bridges; },
          get browserReports() { return browserReports; },
          get compactPaused() { return compactPaused; },
          set compactPaused(value) { compactPaused = value; },
          get compactResumeSource() { return compactResumeSource; },
          set compactResumeSource(value) { compactResumeSource = value; },
          get cropStates() { return cropStates; },
          get current() { return current; },
          set current(value) { current = value; },
          get diagnostics() { return diagnostics; },
          get directIds() { return directIds; },
          get dirtyBrowsers() { return dirtyBrowsers; },
          get discoveryCache() { return discoveryCache; },
          get discoveryChoice() { return discoveryChoice; },
          get discoveryLocks() { return discoveryLocks; },
          get discoveryWakeTimer() { return discoveryWakeTimer; },
          set discoveryWakeTimer(value) { discoveryWakeTimer = value; },
          get discoveryWinner() { return discoveryWinner; },
          set discoveryWinner(value) { discoveryWinner = value; },
          get disposed() { return disposed; },
          set disposed(value) { disposed = value; },
          get enabled() { return enabled; },
          get ensureActor() { return ensureActor; },
          get experimentalBridgeDisabled() { return experimentalBridgeDisabled; },
          get featureOn() { return featureOn; },
          get hideMutedDuplicates() { return hideMutedDuplicates; },
          get limited() { return limited; },
          get liveBridgeEnabled() { return liveBridgeEnabled; },
          get methodError() { return methodError; },
          get methodState() { return methodState; },
          get metrics() { return metrics; },
          get mount() { return mount; },
          get nextDirectId() { return nextDirectId; },
          set nextDirectId(value) { nextDirectId = value; },
          get normalLivePreviewEnabled() { return normalLivePreviewEnabled; },
          get pinnedSource() { return pinnedSource; },
          set pinnedSource(value) { pinnedSource = value; },
          get powerOn() { return powerOn; },
          get previewAutoSelected() { return previewAutoSelected; },
          set previewAutoSelected(value) { previewAutoSelected = value; },
          get previewBrowser() { return previewBrowser; },
          set previewBrowser(value) { previewBrowser = value; },
          get previewGeneration() { return previewGeneration; },
          set previewGeneration(value) { previewGeneration = value; },
          get previewMode() { return previewMode; },
          set previewMode(value) { previewMode = value; },
          get query() { return query; },
          get queuedDiscovery() { return queuedDiscovery; },
          set queuedDiscovery(value) { queuedDiscovery = value; },
          get queuedFullScan() { return queuedFullScan; },
          set queuedFullScan(value) { queuedFullScan = value; },
          get recordError() { return recordError; },
          get refreshCard() { return refreshCard; },
          get releaseBridge() { return releaseBridge; },
          get rendererChoice() { return rendererChoice; },
          get rendererRetryCounts() { return rendererRetryCounts; },
          get requireAudio() { return requireAudio; },
          get resetRendering() { return resetRendering; },
          get scanCursor() { return scanCursor; },
          set scanCursor(value) { scanCursor = value; },
          get scanGeneration() { return scanGeneration; },
          set scanGeneration(value) { scanGeneration = value; },
          get scanning() { return scanning; },
          set scanning(value) { scanning = value; },
          get select() { return select; },
          get sourceVisibilityBlocked() { return sourceVisibilityBlocked; },
          set sourceVisibilityBlocked(value) { sourceVisibilityBlocked = value; },
          get sourceVisibilityBusy() { return sourceVisibilityBusy; },
          set sourceVisibilityBusy(value) { sourceVisibilityBusy = value; },
          get sources() { return sources; },
          set sources(value) { sources = value; },
          get testingAll() { return testingAll; },
          set testingAll(value) { testingAll = value; },
          get unavailableBySource() { return unavailableBySource; },
          get visibilityCheckAt() { return visibilityCheckAt; },
          set visibilityCheckAt(value) { visibilityCheckAt = value; },
          get visibilityIntervalMs() { return visibilityIntervalMs; },
          get visibilitySourceKey() { return visibilitySourceKey; },
          set visibilitySourceKey(value) { visibilitySourceKey = value; },
          get wakePaint() { return wakePaint; }
        });
        window.ZentralModuleLoader.load("features/video/controllers/ZentralVideoRendering.js", { owner: "video" });
        const { unavailableReason, markUnavailable, refreshRendererOptions, disposePlayer, resetRendering, startLivePreview, hideExperimentFallback, restoreExperimentFallback, seedExperimentFallback, experimentWindowIdentity, captureVideo, captureSnapshot, previewVisible, detectContentRect, paint, refreshRendererSource } = window.ZentralModuleLoader.create("video/ZentralVideoRendering", {
          get ACTOR() { return ACTOR; },
          get BINARY_FRAMES_PREF() { return BINARY_FRAMES_PREF; },
          get BUILD() { return BUILD; },
          get CROP_DELAY_MS() { return CROP_DELAY_MS; },
          get EXPERIMENTAL_FRAME_URI() { return EXPERIMENTAL_FRAME_URI; },
          get EXPERIMENT_HELPER_ID() { return EXPERIMENT_HELPER_ID; },
          get FRAME_AWARE_PREF() { return FRAME_AWARE_PREF; },
          get FRAME_URI() { return FRAME_URI; },
          get KEEP_VISIBLE_PREF() { return KEEP_VISIBLE_PREF; },
          get LEGACY_CAPTURE_PREF() { return LEGACY_CAPTURE_PREF; },
          get LIGHT_MONITOR_PREF() { return LIGHT_MONITOR_PREF; },
          get LIVE_MODES() { return LIVE_MODES; },
          get POLL_MS() { return POLL_MS; },
          get RENDER_MODES() { return RENDER_MODES; },
          get RETRY_BACKOFF_PREF() { return RETRY_BACKOFF_PREF; },
          get SUSPEND_VISIBLE_PREF() { return SUSPEND_VISIBLE_PREF; },
          get Services() { return Services; },
          get WORKING_MODES() { return WORKING_MODES; },
          get box() { return box; },
          set box(value) { box = value; },
          get bridges() { return bridges; },
          get canvas() { return canvas; },
          set canvas(value) { canvas = value; },
          get canvasStreamFps() { return canvasStreamFps; },
          get canvasStreamWidth() { return canvasStreamWidth; },
          get captureDimension() { return captureDimension; },
          get captureIntervalMs() { return captureIntervalMs; },
          get captureWorkMs() { return captureWorkMs; },
          set captureWorkMs(value) { captureWorkMs = value; },
          get clearCaptionWatch() { return clearCaptionWatch; },
          get compactPaused() { return compactPaused; },
          set compactPaused(value) { compactPaused = value; },
          get cropStates() { return cropStates; },
          get current() { return current; },
          set current(value) { current = value; },
          get decodedCanvas() { return decodedCanvas; },
          set decodedCanvas(value) { decodedCanvas = value; },
          get discoveryCache() { return discoveryCache; },
          get discoveryChoice() { return discoveryChoice; },
          get disposed() { return disposed; },
          set disposed(value) { disposed = value; },
          get enabled() { return enabled; },
          get experimentCanvasAnchor() { return experimentCanvasAnchor; },
          set experimentCanvasAnchor(value) { experimentCanvasAnchor = value; },
          get experimentFallbackGeneration() { return experimentFallbackGeneration; },
          set experimentFallbackGeneration(value) { experimentFallbackGeneration = value; },
          get experimentalBridgeDisabled() { return experimentalBridgeDisabled; },
          get failedRenderers() { return failedRenderers; },
          get featureOn() { return featureOn; },
          get fitPicture() { return fitPicture; },
          get framingChoice() { return framingChoice; },
          get healthIntervalMs() { return healthIntervalMs; },
          get inspectFrame() { return inspectFrame; },
          get lastExperiment() { return lastExperiment; },
          set lastExperiment(value) { lastExperiment = value; },
          get lastHealth() { return lastHealth; },
          set lastHealth(value) { lastHealth = value; },
          get lastPaintStatusAt() { return lastPaintStatusAt; },
          set lastPaintStatusAt(value) { lastPaintStatusAt = value; },
          get limited() { return limited; },
          get liveBridgeEnabled() { return liveBridgeEnabled; },
          get liveModeEnabled() { return liveModeEnabled; },
          get liveSourceVisible() { return liveSourceVisible; },
          get methodError() { return methodError; },
          get methodName() { return methodName; },
          get methodState() { return methodState; },
          get metrics() { return metrics; },
          get nextHealthCheck() { return nextHealthCheck; },
          set nextHealthCheck(value) { nextHealthCheck = value; },
          get nextRenderProbe() { return nextRenderProbe; },
          set nextRenderProbe(value) { nextRenderProbe = value; },
          get nextStillCapture() { return nextStillCapture; },
          set nextStillCapture(value) { nextStillCapture = value; },
          get noPictureChecks() { return noPictureChecks; },
          set noPictureChecks(value) { noPictureChecks = value; },
          get picture() { return picture; },
          set picture(value) { picture = value; },
          get pinnedSource() { return pinnedSource; },
          set pinnedSource(value) { pinnedSource = value; },
          get playerQuery() { return playerQuery; },
          get powerOn() { return powerOn; },
          get previewBrowser() { return previewBrowser; },
          set previewBrowser(value) { previewBrowser = value; },
          get previewGeneration() { return previewGeneration; },
          set previewGeneration(value) { previewGeneration = value; },
          get previewMode() { return previewMode; },
          set previewMode(value) { previewMode = value; },
          get previewTransitionReason() { return previewTransitionReason; },
          set previewTransitionReason(value) { previewTransitionReason = value; },
          get query() { return query; },
          get queueDiscovery() { return queueDiscovery; },
          get recentFrames() { return recentFrames; },
          get recordCaptureDuration() { return recordCaptureDuration; },
          get refreshMethodStatus() { return refreshMethodStatus; },
          get refreshPlaybackStatus() { return refreshPlaybackStatus; },
          get releaseBridge() { return releaseBridge; },
          get renderBusy() { return renderBusy; },
          set renderBusy(value) { renderBusy = value; },
          get renderCandidates() { return renderCandidates; },
          get rendererChoice() { return rendererChoice; },
          get rendererRetryCounts() { return rendererRetryCounts; },
          get samplePlayerPicture() { return samplePlayerPicture; },
          get selectedModeOnly() { return selectedModeOnly; },
          get setCaption() { return setCaption; },
          get sourceCapabilities() { return sourceCapabilities; },
          set sourceCapabilities(value) { sourceCapabilities = value; },
          get sourceCertainlyHidden() { return sourceCertainlyHidden; },
          get sourceKey() { return sourceKey; },
          get sourceVisibilityBlocked() { return sourceVisibilityBlocked; },
          set sourceVisibilityBlocked(value) { sourceVisibilityBlocked = value; },
          get sources() { return sources; },
          set sources(value) { sources = value; },
          get suspendHiddenReceiver() { return suspendHiddenReceiver; },
          get testingAll() { return testingAll; },
          set testingAll(value) { testingAll = value; },
          get unavailableBySource() { return unavailableBySource; },
          get updatePaintTimer() { return updatePaintTimer; },
          get updateProgressFromHealth() { return updateProgressFromHealth; },
          get videoHidden() { return videoHidden; },
          set videoHidden(value) { videoHidden = value; },
          get visibilityCheckAt() { return visibilityCheckAt; },
          set visibilityCheckAt(value) { visibilityCheckAt = value; },
          get visibilityIntervalMs() { return visibilityIntervalMs; },
          get visibilityPolicyApplies() { return visibilityPolicyApplies; },
          get visibilitySourceKey() { return visibilitySourceKey; },
          set visibilitySourceKey(value) { visibilitySourceKey = value; }
        });
        window.ZentralModuleLoader.load("features/video/controllers/ZentralVideoSidebar.js", { owner: "video" });
        const { cancelResize, mount, setButtonIcon, fitPicture, setAutoHeight, togglePin, toggleCompactCard, setVideoHidden, suspendHiddenReceiver, wakePaint, renderOptions, renderSidebarSources, refreshCard, control, directControl, progressVisible, resetProgressSync, updateSeekProgress, syncProgressState, updateProgressFromHealth, refreshProgress, showState, select, refreshMethodStatus, refreshPlaybackStatus, refreshSettingList } = window.ZentralModuleLoader.create("video/ZentralVideoSidebar", {
          get ACTOR() { return ACTOR; },
          get AUTO_HEIGHT_BUTTON_PREF() { return AUTO_HEIGHT_BUTTON_PREF; },
          get BUILD() { return BUILD; },
          get CAPTIONS_PREF() { return CAPTIONS_PREF; },
          get COMPACT_BUTTON_PREF() { return COMPACT_BUTTON_PREF; },
          get COMPACT_STATE_PREF() { return COMPACT_STATE_PREF; },
          get DIRECT_DISCOVERY_NOTICE() { return DIRECT_DISCOVERY_NOTICE; },
          get DISPLAY_CAP_PREF() { return DISPLAY_CAP_PREF; },
          get FRAMING_PREF() { return FRAMING_PREF; },
          get HEIGHT_PREF() { return HEIGHT_PREF; },
          get HIDE_BUTTON_PREF() { return HIDE_BUTTON_PREF; },
          get IDLE_TIMER_PREF() { return IDLE_TIMER_PREF; },
          get LIVE_MODES() { return LIVE_MODES; },
          get PERF_DIAG_PREF() { return PERF_DIAG_PREF; },
          get PIN_BUTTON_PREF() { return PIN_BUTTON_PREF; },
          get PROGRESS_REFRESH_MS() { return PROGRESS_REFRESH_MS; },
          get RENDER_MODES() { return RENDER_MODES; },
          get STRICT_MODE_PREF() { return STRICT_MODE_PREF; },
          get SUSPEND_HIDDEN_PREF() { return SUSPEND_HIDDEN_PREF; },
          get Services() { return Services; },
          get VIDEO_HIDDEN_PREF() { return VIDEO_HIDDEN_PREF; },
          get adaptiveWidth() { return adaptiveWidth; },
          set adaptiveWidth(value) { adaptiveWidth = value; },
          get autoShowVideo() { return autoShowVideo; },
          get box() { return box; },
          set box(value) { box = value; },
          get browserReports() { return browserReports; },
          get canOpenSourceTab() { return canOpenSourceTab; },
          get canvas() { return canvas; },
          set canvas(value) { canvas = value; },
          get caption() { return caption; },
          set caption(value) { caption = value; },
          get captionNode() { return captionNode; },
          set captionNode(value) { captionNode = value; },
          get captionText() { return captionText; },
          set captionText(value) { captionText = value; },
          get captureRateTenths() { return captureRateTenths; },
          get captureWorkMs() { return captureWorkMs; },
          set captureWorkMs(value) { captureWorkMs = value; },
          get cardCompact() { return cardCompact; },
          set cardCompact(value) { cardCompact = value; },
          get clearCaptionWatch() { return clearCaptionWatch; },
          get compactPaused() { return compactPaused; },
          set compactPaused(value) { compactPaused = value; },
          get compactResumeSource() { return compactResumeSource; },
          set compactResumeSource(value) { compactResumeSource = value; },
          get controlBar() { return controlBar; },
          set controlBar(value) { controlBar = value; },
          get cropStates() { return cropStates; },
          get current() { return current; },
          set current(value) { current = value; },
          get diagnostics() { return diagnostics; },
          get discoveryChoice() { return discoveryChoice; },
          get discoveryLocks() { return discoveryLocks; },
          get discoveryWinner() { return discoveryWinner; },
          set discoveryWinner(value) { discoveryWinner = value; },
          get disposed() { return disposed; },
          set disposed(value) { disposed = value; },
          get enabled() { return enabled; },
          get experimentalBridgeDisabled() { return experimentalBridgeDisabled; },
          get fastCaptures() { return fastCaptures; },
          set fastCaptures(value) { fastCaptures = value; },
          get featureOn() { return featureOn; },
          get fillWidth() { return fillWidth; },
          get framingChoice() { return framingChoice; },
          get healthIntervalMs() { return healthIntervalMs; },
          get heightPx() { return heightPx; },
          set heightPx(value) { heightPx = value; },
          get hiddenByLayout() { return hiddenByLayout; },
          get hideMutedDuplicates() { return hideMutedDuplicates; },
          get injectSetting() { return injectSetting; },
          get lastExperiment() { return lastExperiment; },
          set lastExperiment(value) { lastExperiment = value; },
          get limited() { return limited; },
          get methodDescription() { return methodDescription; },
          get methodName() { return methodName; },
          get methodState() { return methodState; },
          get metrics() { return metrics; },
          get muteButton() { return muteButton; },
          set muteButton(value) { muteButton = value; },
          get nextStillCapture() { return nextStillCapture; },
          set nextStillCapture(value) { nextStillCapture = value; },
          get paint() { return paint; },
          get pauseWhenCompactHidden() { return pauseWhenCompactHidden; },
          get picture() { return picture; },
          set picture(value) { picture = value; },
          get pictureObserver() { return pictureObserver; },
          set pictureObserver(value) { pictureObserver = value; },
          get pinnedSource() { return pinnedSource; },
          set pinnedSource(value) { pinnedSource = value; },
          get playButton() { return playButton; },
          set playButton(value) { playButton = value; },
          get powerOn() { return powerOn; },
          get previewAutoSelected() { return previewAutoSelected; },
          set previewAutoSelected(value) { previewAutoSelected = value; },
          get previewBrowser() { return previewBrowser; },
          set previewBrowser(value) { previewBrowser = value; },
          get previewMode() { return previewMode; },
          set previewMode(value) { previewMode = value; },
          get previewModeNotice() { return previewModeNotice; },
          set previewModeNotice(value) { previewModeNotice = value; },
          get previewTransitionReason() { return previewTransitionReason; },
          set previewTransitionReason(value) { previewTransitionReason = value; },
          get previewVisible() { return previewVisible; },
          get progressBusy() { return progressBusy; },
          set progressBusy(value) { progressBusy = value; },
          get progressEpoch() { return progressEpoch; },
          set progressEpoch(value) { progressEpoch = value; },
          get progressNextAt() { return progressNextAt; },
          set progressNextAt(value) { progressNextAt = value; },
          get progressSourceKey() { return progressSourceKey; },
          set progressSourceKey(value) { progressSourceKey = value; },
          get query() { return query; },
          get radiusPx() { return radiusPx; },
          set radiusPx(value) { radiusPx = value; },
          get refreshCaption() { return refreshCaption; },
          get refreshRendererOptions() { return refreshRendererOptions; },
          get renderBusy() { return renderBusy; },
          set renderBusy(value) { renderBusy = value; },
          get rendererChoice() { return rendererChoice; },
          get resetRendering() { return resetRendering; },
          get sameSource() { return sameSource; },
          get scan() { return scan; },
          get scanIntervalMs() { return scanIntervalMs; },
          get scanTimer() { return scanTimer; },
          set scanTimer(value) { scanTimer = value; },
          get seekBar() { return seekBar; },
          set seekBar(value) { seekBar = value; },
          get selectedModeOnly() { return selectedModeOnly; },
          get setCaption() { return setCaption; },
          get slowCaptures() { return slowCaptures; },
          set slowCaptures(value) { slowCaptures = value; },
          get sourceCapabilities() { return sourceCapabilities; },
          set sourceCapabilities(value) { sourceCapabilities = value; },
          get sourceCertainlyHidden() { return sourceCertainlyHidden; },
          get sourceKey() { return sourceKey; },
          get sourceLabel() { return sourceLabel; },
          get sourceList() { return sourceList; },
          set sourceList(value) { sourceList = value; },
          get sourceVisibilityBlocked() { return sourceVisibilityBlocked; },
          set sourceVisibilityBlocked(value) { sourceVisibilityBlocked = value; },
          get sources() { return sources; },
          set sources(value) { sources = value; },
          get testingAll() { return testingAll; },
          set testingAll(value) { testingAll = value; },
          get updatePaintTimer() { return updatePaintTimer; },
          get validMediaRequest() { return validMediaRequest; },
          get videoHidden() { return videoHidden; },
          set videoHidden(value) { videoHidden = value; },
          get visibilityObserver() { return visibilityObserver; },
          set visibilityObserver(value) { visibilityObserver = value; },
          get wakeTimer() { return wakeTimer; },
          set wakeTimer(value) { wakeTimer = value; },
          get widthPercent() { return widthPercent; },
          set widthPercent(value) { widthPercent = value; }
        });
        const video_ZentralVideoCaptionsAvailable = window.ZentralModuleLoader.load("features/video/controllers/ZentralVideoCaptions.js", { optional: true, owner: "video/ZentralVideoCaptions" });
        const { setCaption, clearCaptionWatch, refreshCaption } = video_ZentralVideoCaptionsAvailable
          ? window.ZentralModuleLoader.create("video/ZentralVideoCaptions", {
          get ACTOR() { return ACTOR; },
          get CAPTIONS_PREF() { return CAPTIONS_PREF; },
          get CAPTION_EVENTS_PREF() { return CAPTION_EVENTS_PREF; },
          get CAPTION_RECOVERY_PREF() { return CAPTION_RECOVERY_PREF; },
          get SUSPEND_HIDDEN_PREF() { return SUSPEND_HIDDEN_PREF; },
          get SUSPEND_VISIBLE_PREF() { return SUSPEND_VISIBLE_PREF; },
          get bridges() { return bridges; },
          get captionBusy() { return captionBusy; },
          set captionBusy(value) { captionBusy = value; },
          get captionIntervalMs() { return captionIntervalMs; },
          get captionNode() { return captionNode; },
          set captionNode(value) { captionNode = value; },
          get captionText() { return captionText; },
          set captionText(value) { captionText = value; },
          get captionWatch() { return captionWatch; },
          set captionWatch(value) { captionWatch = value; },
          get compactPaused() { return compactPaused; },
          set compactPaused(value) { compactPaused = value; },
          get current() { return current; },
          set current(value) { current = value; },
          get disposed() { return disposed; },
          set disposed(value) { disposed = value; },
          get enabled() { return enabled; },
          get featureOn() { return featureOn; },
          get lastCaptionPollAt() { return lastCaptionPollAt; },
          set lastCaptionPollAt(value) { lastCaptionPollAt = value; },
          get lastCaptionRecoveryAt() { return lastCaptionRecoveryAt; },
          set lastCaptionRecoveryAt(value) { lastCaptionRecoveryAt = value; },
          get limited() { return limited; },
          get picture() { return picture; },
          set picture(value) { picture = value; },
          get powerOn() { return powerOn; },
          get previewVisible() { return previewVisible; },
          get query() { return query; },
          get restartCaptionTimer() { return restartCaptionTimer; },
          get sameSource() { return sameSource; },
          get sourceVisibilityBlocked() { return sourceVisibilityBlocked; },
          set sourceVisibilityBlocked(value) { sourceVisibilityBlocked = value; },
          get videoHidden() { return videoHidden; },
          set videoHidden(value) { videoHidden = value; }
        }, { optional: true }) || Object.fromEntries(["setCaption","clearCaptionWatch","refreshCaption"].map(name => [name, () => undefined]))
          : Object.fromEntries(["setCaption","clearCaptionWatch","refreshCaption"].map(name => [name, () => undefined]));
        window.ZentralModuleLoader.load("features/video/controllers/ZentralVideoScheduling.js", { owner: "video" });
        const { updatePaintTimer, compactTabbarHidden, pauseCompactPreview, syncCompactVisibility, stop, start } = window.ZentralModuleLoader.create("video/ZentralVideoScheduling", {
          get ACTOR() { return ACTOR; },
          get FRAME_MS() { return FRAME_MS; },
          get IDLE_TIMER_PREF() { return IDLE_TIMER_PREF; },
          get LIVE_MODES() { return LIVE_MODES; },
          get Services() { return Services; },
          get WORKING_MODES() { return WORKING_MODES; },
          get activeScanToken() { return activeScanToken; },
          set activeScanToken(value) { activeScanToken = value; },
          get actorAttempted() { return actorAttempted; },
          set actorAttempted(value) { actorAttempted = value; },
          get actorReady() { return actorReady; },
          set actorReady(value) { actorReady = value; },
          get box() { return box; },
          set box(value) { box = value; },
          get bridges() { return bridges; },
          get browserReports() { return browserReports; },
          get cancelExperimentTests() { return cancelExperimentTests; },
          get captionTimer() { return captionTimer; },
          set captionTimer(value) { captionTimer = value; },
          get clearCaptionWatch() { return clearCaptionWatch; },
          get compactCheckTimer() { return compactCheckTimer; },
          set compactCheckTimer(value) { compactCheckTimer = value; },
          get compactHiddenSince() { return compactHiddenSince; },
          set compactHiddenSince(value) { compactHiddenSince = value; },
          get compactHovering() { return compactHovering; },
          set compactHovering(value) { compactHovering = value; },
          get compactMountTimer() { return compactMountTimer; },
          set compactMountTimer(value) { compactMountTimer = value; },
          get compactPaused() { return compactPaused; },
          set compactPaused(value) { compactPaused = value; },
          get compactResumeSource() { return compactResumeSource; },
          set compactResumeSource(value) { compactResumeSource = value; },
          get current() { return current; },
          set current(value) { current = value; },
          get decodedCanvas() { return decodedCanvas; },
          set decodedCanvas(value) { decodedCanvas = value; },
          get diagnostics() { return diagnostics; },
          get dirtyBrowsers() { return dirtyBrowsers; },
          get discoveryCache() { return discoveryCache; },
          get discoveryLocks() { return discoveryLocks; },
          get discoveryWakeTimer() { return discoveryWakeTimer; },
          set discoveryWakeTimer(value) { discoveryWakeTimer = value; },
          get discoveryWinner() { return discoveryWinner; },
          set discoveryWinner(value) { discoveryWinner = value; },
          get disposed() { return disposed; },
          set disposed(value) { disposed = value; },
          get enabled() { return enabled; },
          get ensureActor() { return ensureActor; },
          get featureOn() { return featureOn; },
          get frameTimer() { return frameTimer; },
          set frameTimer(value) { frameTimer = value; },
          get liveBridgeEnabled() { return liveBridgeEnabled; },
          get metrics() { return metrics; },
          get mount() { return mount; },
          get mountObserver() { return mountObserver; },
          set mountObserver(value) { mountObserver = value; },
          get nextHealthCheck() { return nextHealthCheck; },
          set nextHealthCheck(value) { nextHealthCheck = value; },
          get nextRenderProbe() { return nextRenderProbe; },
          set nextRenderProbe(value) { nextRenderProbe = value; },
          get nextStillCapture() { return nextStillCapture; },
          set nextStillCapture(value) { nextStillCapture = value; },
          get paint() { return paint; },
          get paintTimerMs() { return paintTimerMs; },
          set paintTimerMs(value) { paintTimerMs = value; },
          get pauseWhenCompactHidden() { return pauseWhenCompactHidden; },
          get previewAutoSelected() { return previewAutoSelected; },
          set previewAutoSelected(value) { previewAutoSelected = value; },
          get previewMode() { return previewMode; },
          set previewMode(value) { previewMode = value; },
          get previewVisible() { return previewVisible; },
          get queuedDiscovery() { return queuedDiscovery; },
          set queuedDiscovery(value) { queuedDiscovery = value; },
          get queuedFullScan() { return queuedFullScan; },
          set queuedFullScan(value) { queuedFullScan = value; },
          get refreshSettingList() { return refreshSettingList; },
          get releaseBridge() { return releaseBridge; },
          get renderBusy() { return renderBusy; },
          set renderBusy(value) { renderBusy = value; },
          get rendererChoice() { return rendererChoice; },
          get rendererRetryCounts() { return rendererRetryCounts; },
          get resetProgressSync() { return resetProgressSync; },
          get resetRendering() { return resetRendering; },
          get restartCaptionTimer() { return restartCaptionTimer; },
          get restartDiscoveryTimer() { return restartDiscoveryTimer; },
          get restartVisibilityTimer() { return restartVisibilityTimer; },
          get scan() { return scan; },
          get scanGeneration() { return scanGeneration; },
          set scanGeneration(value) { scanGeneration = value; },
          get scanTimer() { return scanTimer; },
          set scanTimer(value) { scanTimer = value; },
          get scanning() { return scanning; },
          set scanning(value) { scanning = value; },
          get select() { return select; },
          get setCaption() { return setCaption; },
          get sourceVisibilityTimer() { return sourceVisibilityTimer; },
          set sourceVisibilityTimer(value) { sourceVisibilityTimer = value; },
          get sources() { return sources; },
          set sources(value) { sources = value; },
          get syncProgressState() { return syncProgressState; },
          get unavailableBySource() { return unavailableBySource; },
          get videoHidden() { return videoHidden; },
          set videoHidden(value) { videoHidden = value; },
          get visibilityCheckAt() { return visibilityCheckAt; },
          set visibilityCheckAt(value) { visibilityCheckAt = value; },
          get visibilityPolicyApplies() { return visibilityPolicyApplies; },
          get wakeTimer() { return wakeTimer; },
          set wakeTimer(value) { wakeTimer = value; }
        });
        if (typeof gBrowser === "undefined") return;
        // Sine can execute an updated .uc.js while an older instance still runs.
        // Shut that instance down so its actor errors cannot mask the new bridge.
        try {
          window.ZentralVideoPreview?.destroy?.();
        } catch (error) {
          console.warn(
            "[ZentralVideoPreview] Could not stop previous build",
            error,
          );
        }
        const PREF = "zen.workspace.zentral.video_preview.enabled";
        const EXPERIMENTAL_DISABLED_PREF =
          "zen.workspace.zentral.video_preview.disable_experimental_bridge";
        const STRICT_MODE_PREF =
          "zen.workspace.zentral.video_preview.selected_mode_only";
        let previewTransitionReason = "";
        let previewModeNotice = null;
        const KEEP_VISIBLE_PREF =
          "zen.workspace.zentral.video_preview.keep_source_visible";
        let visibilityCheckAt = 0,
          visibilitySourceKey = "",
          sourceVisibilityBlocked = false;
        let sourceVisibilityTimer = null,
          sourceVisibilityBusy = false;
        const PAUSE_COMPACT_PREF =
          "zen.workspace.zentral.video_preview.pause_when_compact_hidden";
        const RENDER_PREF = "zen.workspace.zentral.video_preview.renderer";
        const DISCOVERY_PREF = "zen.workspace.zentral.video_preview.discovery";
        const DIRECT_DISCOVERY_NOTICE =
          "Direct reads only tab documents exposed locally to the browser UI. Remote tabs are unsupported, including local files opened in a remote process. File type (.mp4, etc.) does not determine availability. Direct does not fall back to Frame or Actor.";
        const WIDTH_PREF = "zen.workspace.zentral.video_preview.width_percent";
        const FIT_WIDTH_PREF = "zen.workspace.zentral.video_preview.fit_width";
        const HEIGHT_PREF = "zen.workspace.zentral.video_preview.height_px";
        const RADIUS_PREF = "zen.workspace.zentral.video_preview.radius_px";
        const FRAMING_PREF = "zen.workspace.zentral.video_preview.framing";
        const HIDE_DUPLICATES_PREF =
          "zen.workspace.zentral.video_preview.hide_muted_duplicates";
        const REQUIRE_AUDIO_PREF =
          "zen.workspace.zentral.video_preview.require_audio";
        const AUTO_SHOW_PREF =
          "zen.workspace.zentral.video_preview.auto_show_video";
        const CAPTURE_WIDTH_PREF =
          "zen.workspace.zentral.video_preview.capture_width_px";
        const HIDE_BUTTON_PREF =
          "zen.workspace.zentral.video_preview.hide_button";
        const AUTO_HEIGHT_BUTTON_PREF =
          "zen.workspace.zentral.video_preview.auto_height_button";
        const VIDEO_HIDDEN_PREF =
          "zen.workspace.zentral.video_preview.video_hidden";
        const BINARY_FRAMES_PREF =
          "zen.workspace.zentral.video_preview.binary_frames";
        const DISPLAY_CAP_PREF =
          "zen.workspace.zentral.video_preview.display_capture_cap";
        const ADAPTIVE_DETAIL_PREF =
          "zen.workspace.zentral.video_preview.adaptive_detail";
        const MEDIA_EVENTS_PREF =
          "zen.workspace.zentral.video_preview.media_event_hints";
        const CAPTIONS_PREF =
          "zen.workspace.zentral.video_preview.youtube_captions";
        const IDLE_TIMER_PREF =
          "zen.workspace.zentral.video_preview.stop_idle_timer";
        const AUDIO_CACHE_PREF =
          "zen.workspace.zentral.video_preview.audio_probe_cache";
        const FRAME_AWARE_PREF =
          "zen.workspace.zentral.video_preview.frame_aware_capture";
        const CAPTION_EVENTS_PREF =
          "zen.workspace.zentral.video_preview.caption_events";
        const PIN_BUTTON_PREF =
          "zen.workspace.zentral.video_preview.pin_source_button";
        const COMPACT_BUTTON_PREF =
          "zen.workspace.zentral.video_preview.compact_card_button";
        const COMPACT_STATE_PREF =
          "zen.workspace.zentral.video_preview.compact_card";
        const PERF_DIAG_PREF =
          "zen.workspace.zentral.video_preview.performance_diagnostics";
        const SUSPEND_HIDDEN_PREF =
          "zen.workspace.zentral.video_preview.suspend_hidden_preview";
        const LIGHT_MONITOR_PREF =
          "zen.workspace.zentral.video_preview.light_frame_monitoring";
        const SLOW_HEALTH_PREF =
          "zen.workspace.zentral.video_preview.slow_health_checks";
        const PINNED_DISCOVERY_PREF =
          "zen.workspace.zentral.video_preview.pinned_discovery_only";
        const CAPTION_RECOVERY_PREF =
          "zen.workspace.zentral.video_preview.slow_caption_recovery";
        const RETRY_BACKOFF_PREF =
          "zen.workspace.zentral.video_preview.renderer_retry_backoff";
        const SUSPEND_VISIBLE_PREF =
          "zen.workspace.zentral.video_preview.suspend_when_source_visible";
        const POWER_PREFS = [
          SUSPEND_HIDDEN_PREF,
          LIGHT_MONITOR_PREF,
          SLOW_HEALTH_PREF,
          PINNED_DISCOVERY_PREF,
          CAPTION_RECOVERY_PREF,
          RETRY_BACKOFF_PREF,
          SUSPEND_VISIBLE_PREF,
        ];
        const featureOn = (pref) => Services.prefs.getBoolPref(pref, true);
        function readInt(pref, fallback) {
          try {
            return Services.prefs.getIntPref(pref, fallback);
          } catch (_) {
            return fallback;
          }
        }
        // Store tenths of an fps as an integer so the slowest choice is exactly 0.1 fps.
        const CAPTURE_RATE_PREF =
          "zen.workspace.zentral.video_preview.capture_rate_tenths";
        // Normal performance controls: timing preferences are milliseconds.
        const SCAN_INTERVAL_PREF =
          "zen.workspace.zentral.video_preview.scan_interval_ms";
        const CAPTION_POLL_PREF =
          "zen.workspace.zentral.video_preview.caption_poll_ms";
        const CANVAS_STREAM_WIDTH_PREF =
          "zen.workspace.zentral.video_preview.canvas_stream_width_px";
        const CANVAS_STREAM_FPS_PREF =
          "zen.workspace.zentral.video_preview.canvas_stream_fps";
        const SCAN_INTERVALS = [0, 5000, 15000, 30000, 60000, 120000];
        const CAPTION_INTERVALS = [250, 500, 750, 1500, 3000];
        function scanIntervalMs() {
          const value = Services.prefs.getIntPref(SCAN_INTERVAL_PREF, 5000);
          return SCAN_INTERVALS.includes(value) ? value : 5000;
        }
        function captionIntervalMs() {
          const value = Services.prefs.getIntPref(CAPTION_POLL_PREF, 750);
          return CAPTION_INTERVALS.includes(value) ? value : 750;
        }
        function canvasStreamWidth() {
          const value = Services.prefs.getIntPref(
            CANVAS_STREAM_WIDTH_PREF,
            640,
          );
          return [160, 240, 320, 480, 640].includes(value) ? value : 640;
        }
        function canvasStreamFps() {
          const value = Services.prefs.getIntPref(CANVAS_STREAM_FPS_PREF, 30);
          return [5, 10, 15, 24, 30].includes(value) ? value : 30;
        }
        // POWER SAVING (build 22): normal playback samples presentation at 2 s;
        // diagnostics retain every callback. First-frame proof is never skipped.
        // Receiver teardown preserves source audio and pin/selection. Resume
        // creates a fresh, generation-fenced receiver and detaches the fallback
        // only after presentation is confirmed again. Never pause source media.
        // Low-impact power defaults apply independently of the experiments switch.
        // The switch exposes controls; it does not disable normal optimizations.
        function powerOn(pref) {
          return Services.prefs.getBoolPref(
            pref,
            pref !== SUSPEND_VISIBLE_PREF,
          );
        }
        function applyPowerSettings() {
          lastCaptionRecoveryAt = 0;
          visibilityCheckAt = 0;
          resetRendering();
          restartVisibilityTimer();
          restartCaptionTimer();
          suspendHiddenReceiver();
          wakePaint();
          injectSetting();
        }
        function healthIntervalMs(mode = previewMode) {
          return powerOn(SLOW_HEALTH_PREF) && !testingAll
            ? ["native", "frame-native"].includes(mode)
              ? 15000
              : 10000
            : POLL_MS;
        }
        function visibilityIntervalMs() {
          return powerOn(SLOW_HEALTH_PREF) ? 1500 : 750;
        }
        function restartDiscoveryTimer() {
          clearInterval(scanTimer);
          // -1 is an active-session marker for event/manual-only discovery.
          // Other lifecycle code uses scanTimer to distinguish stopped sessions.
          scanTimer = scanIntervalMs()
            ? setInterval(scan, scanIntervalMs())
            : -1;
        }
        function restartVisibilityTimer() {
          clearInterval(sourceVisibilityTimer);
          sourceVisibilityTimer =
            scanTimer && visibilityPolicyApplies()
              ? setInterval(guardLiveSourceVisibility, visibilityIntervalMs())
              : null;
        }
        function restartCaptionTimer() {
          clearInterval(captionTimer);
          captionTimer =
            enabled() && scanTimer && featureOn(CAPTIONS_PREF) &&
            window.ZentralModuleLoader?.has("video/ZentralVideoCaptions")
              ? setInterval(
                  refreshCaption,
                  captionWatch &&
                    featureOn(CAPTION_EVENTS_PREF) &&
                    powerOn(CAPTION_RECOVERY_PREF)
                    ? Math.max(3000, captionIntervalMs())
                    : captionIntervalMs(),
                )
              : null;
        }
        const CAPTURE_RATES = [1, 2, 5, 10, 20, 50, 100, 150, 240, 300, 600];
        function captureRateTenths() {
          try {
            const value = Services.prefs.getIntPref(CAPTURE_RATE_PREF, 100);
            return CAPTURE_RATES.includes(value) ? value : 100;
          } catch (_) {
            return 100;
          }
        }
        function captureIntervalMs() {
          return Math.ceil(10000 / captureRateTenths());
        }
        function captureRateDescription(tenths) {
          return (
            `Up to ${tenths / 10} still captures per second` +
            (tenths === 1 ? " (one every 10 seconds)" : "") +
            ", " +
            `${Number((tenths / 100).toFixed(2))}× the capture requests of the default 10 fps. ` +
            "Higher rates can use more CPU; actual cost depends on the video, " +
            "capture detail and your system. Native and stream methods follow the " +
            "source video and are not capped by this setting."
          );
        }
        // Only frame capture and page snapshots use this longest-edge cap.
        // Live cloning and streams use their own rendering paths.
        function captureWidth() {
          try {
            const value = Services.prefs.getIntPref(CAPTURE_WIDTH_PREF, 480);
            return [160, 240, 320, 480, 640].includes(value) ? value : 480;
          } catch (_) {
            return 480;
          }
        }
        // BEGIN GENERATED EXPERIMENTAL HELPERS
        const CAPTION_FRAME_SOURCE = window.ZentralModuleLoader.readText("features/video/content/ZentralVideoBasicFrame.js", "video");
        const EXPERIMENT_HELPER_ID = "4a4f1a02e13063aa";
        const EXPERIMENTAL_FRAME_SOURCE = window.ZentralModuleLoader.readText("features/video/content/ZentralVideoFrame.js", "video");
        const EXPERIMENTAL_ACTOR_SOURCE = window.ZentralModuleLoader.readText("features/video/content/ZentralVideoActor.sys.mjs", "video");
        // END GENERATED EXPERIMENTAL HELPERS
        const BUILD = "video-preview-2026-10-04-25-regression-fix";


        const ACTOR = "ZentralVideoBridgeV12_" + EXPERIMENT_HELPER_ID;
        const CHANNEL =
          "ZentralVideoPreview:" + Math.random().toString(36).slice(2);
        const FRAME_URI =
          "data:application/javascript;charset=utf-8," +
          encodeURIComponent(
            CAPTION_FRAME_SOURCE.replaceAll("__CHANNEL__", CHANNEL),
          );
        const EXPERIMENTAL_FRAME_URI =
          "data:application/javascript;charset=utf-8," +
          encodeURIComponent(
            EXPERIMENTAL_FRAME_SOURCE.replaceAll("__CHANNEL__", CHANNEL),
          );
        const LEGACY_CAPTURE_PREF =
          "zen.workspace.zentral.video_preview.experimental_legacy_capture";
        const experimentSources = new Set();
        let experimentTestToken = 0;
        let lastExperiment = null;
        let experimentFallbackGeneration = -1;
        const bridges = new Map();
        const browserReports = new Map();
        let nextRequest = 0;
        let actorModuleURI = "";
        const discoveryLocks = new Map();
        let discoveryWinner = null;
        const failedRenderers = new Set();
        const metrics = {
          scans: 0,
          discoveryCalls: 0,
          discoveryCacheHits: 0,
          dirtyInspections: 0,
          paintWakeups: 0,
          lastScanMs: 0,
          frames: 0,
          captureMs: 0,
          bytes: 0,
          paintMs: 0,
          paintPasses: 0,
          skippedFrames: 0,
          failures: 0,
          lastFrameAt: 0,
          effectiveFps: 0,
          transport: {
            raw: { frames: 0, ms: 0, bytes: 0 },
            jpeg: { frames: 0, ms: 0, bytes: 0 },
          },
        };
        let actorReady = false;
        let actorAttempted = false;
        const methodState = {
          frame: "waiting",
          actor: "waiting",
          direct: "waiting",
          "frame-native": "choose a video",
          "frame-stream": "choose a video",
          "canvas-stream": "choose a video",
          native: "choose a video",
          stream: "choose a video",
          canvas: "choose a video",
          snapshot: "choose a video",
        };
        const directIds = new WeakMap();
        let nextDirectId = 0;
        let previewBrowser = null;
        let decodedCanvas = null;
        let previewGeneration = 0;
        let previewMode = null;
        let noPictureChecks = 0;
        let previewAutoSelected = false;
        let videoHidden = Services.prefs.getBoolPref(VIDEO_HIDDEN_PREF, false);
        let cardCompact = Services.prefs.getBoolPref(COMPACT_STATE_PREF, false);
        let pinnedSource = null;
        let captionBusy = false;
        let captionWatch = null;
        let lastCaptionPollAt = 0;
        let lastCaptionRecoveryAt = 0;
        let adaptiveWidth = 0;
        let slowCaptures = 0;
        let fastCaptures = 0;
        let captionText = "";
        let captionNode = null;
        let captionTimer = null;
        let pictureObserver = null;
        let cardObserver = null;
        let wakeTimer = null;
        let visibilityObserver = null;
        const recentFrames = [];
        const audioProbeCache = new WeakMap();
        const unavailableBySource = new Map();
        const rendererRetryCounts = new Map();
        const POLL_MS = 5000;
        const FRAME_MS = 100; // Probe for sources and check live preview health.
        const LIVE_MODES = [
          "frame-native",
          "native",
          "frame-stream",
          "stream",
          "canvas-stream",
        ];
        const RENDER_MODES = [...LIVE_MODES, "canvas", "snapshot"];
        const WORKING_MODES = ["canvas", "snapshot"];
        let renderBusy = false;
        let testingAll = false;
        let experimentCanvasAnchor = null;
        let nextRenderProbe = 0;
        let nextHealthCheck = 0;
        let lastHealth = null;
        let heightPx = 0,
          radiusPx = 0;
        // A crop belongs to the video, not to one discovery result or frame.
        const cropStates = new Map();
        const CROP_DELAY_MS = 3000;
        try {
          heightPx = Math.max(
            0,
            Math.min(800, Services.prefs.getIntPref(HEIGHT_PREF, 0)),
          );
        } catch (_) {}
        try {
          radiusPx = Math.max(0, Math.min(24, readInt(RADIUS_PREF, 0)));
        } catch (_) {}
        let widthPercent = 100;
        try {
          widthPercent = Math.max(35, Math.min(100, readInt(WIDTH_PREF, 100)));
        } catch (_) {}
        let disposed = false;
        let scanning = false;
        let activeScanToken = 0;
        let scanCursor = 0;
        // Events mark individual browsers dirty; the bounded sweep is a safety net.
        const dirtyBrowsers = new Set();
        const discoveryCache = new Map();
        const DISCOVERY_CACHE_MS = 20000;
        const EMPTY_DISCOVERY_CACHE_MS = 5000;
        let discoveryWakeTimer = null;
        let queuedDiscovery = false;
        let queuedFullScan = false;
        let sources = [];
        let current = null;
        let box = null;
        let canvas = null;
        let caption = null;
        let playButton = null;
        let muteButton = null;
        let seekBar = null;
        const PROGRESS_REFRESH_MS = 30000;
        let progressBusy = false;
        let progressEpoch = 0,
          progressSourceKey = "",
          progressNextAt = 0;
        let picture = null;
        let sourceList = null;
        let sourceCapabilities = null;
        let controlBar = null;
        let scanTimer = null;
        let frameTimer = null;
        let paintTimerMs = 0;
        let nextStillCapture = 0;
        let captureWorkMs = 0;
        let lastPaintStatusAt = 0;
        let mountObserver = null;
        let compactCheckTimer = null;
        let compactPaused = false;
        let compactResumeSource = null;
        let compactHovering = false;
        let compactHiddenSince = 0;
        let compactMountTimer = null;
        let scanGeneration = 0;
        let settingsInstance = null;
        let originalSettingsOpen = null;
        let wrappedSettingsOpen = null;
        let settingsCategoryGuard = null;
        const diagnostics = {
          phase: "waiting for startup",
          module: "",
          anchor: "",
          inspected: 0,
          found: 0,
          lastError: "",
          snapshotErrors: 0,
        };

        function methodError(method, error) {
          const message = String(error);
          methodState[method] = message.slice(0, 160);
          // A failed optional bridge should not obscure a successful one.
          if (
            Object.values(methodState).every(
              (state) => !state.startsWith("working"),
            )
          )
            recordError(error);
        }

        function recordError(error) {
          const message = String(error);
          if (diagnostics.lastError !== message) {
            diagnostics.lastError = message;
            console.warn("[ZentralVideoPreview]", error);
          }
        }

        function enabled() {
          try {
            return Services.prefs.getBoolPref(PREF, true);
          } catch (_) {
            return true;
          }
        }

        function hideMutedDuplicates() {
          try {
            return Services.prefs.getBoolPref(HIDE_DUPLICATES_PREF, true);
          } catch (_) {
            return true;
          }
        }
        function requireAudio() {
          try {
            return Services.prefs.getBoolPref(REQUIRE_AUDIO_PREF, true);
          } catch (_) {
            return true;
          }
        }
        function autoShowVideo() {
          try {
            return Services.prefs.getBoolPref(AUTO_SHOW_PREF, true);
          } catch (_) {
            return true;
          }
        }

        function fillWidth() {
          try {
            return Services.prefs.getBoolPref(FIT_WIDTH_PREF, true);
          } catch (_) {
            return true;
          }
        }
        function framingChoice() {
          try {
            const pref = Services.prefs.getStringPref(FRAMING_PREF, "auto");
            return ["auto", "contain", "cover"].includes(pref) ? pref : "auto";
          } catch (_) {
            return "auto";
          }
        }

        function pauseWhenCompactHidden() {
          try {
            return Services.prefs.getBoolPref(PAUSE_COMPACT_PREF, true);
          } catch (_) {
            return true;
          }
        }

        // Sidebar live renderers are normal features; diagnostic/source controls
        // and the separate legacy capture opt-in still require experiments.
        function nativePreviewEnabled() {
          return rendererChoice() === "frame-native";
        }
        function normalLivePreviewEnabled() {
          const choice = rendererChoice();
          return choice === "auto" || LIVE_MODES.includes(choice);
        }
        function liveBridgeEnabled() {
          return normalLivePreviewEnabled() || !experimentalBridgeDisabled();
        }
        function liveModeEnabled(mode) {
          return LIVE_MODES.includes(mode);
        }

        function autoPreviewChoice(choice) {
          return (
            ["auto", "canvas", "snapshot"].includes(choice) ||
            (liveBridgeEnabled() &&
              LIVE_MODES.includes(choice) &&
              liveModeEnabled(choice))
          );
        }

        function experimentalBridgeDisabled() {
          try {
            return Services.prefs.getBoolPref(EXPERIMENTAL_DISABLED_PREF, true);
          } catch (_) {
            return true;
          }
        }

        // SECTION 2: Content transport, helper loading and bounded IPC.


        // SECTION 3: Video settings and opt-in diagnostic controls.


        // Compatibility adapter: keep the historic method name, but use Video.
        // Move existing controls before removing an old Video-dev shell so a
        // re-injection does not discard listeners, report text or preferences.


        // BEGIN GENERATED EXPERIMENTAL DIAGNOSTICS
        // Embedded in the chrome runtime. No page script can invoke these helpers.
        let combinedReportText = "";


        // END GENERATED EXPERIMENTAL DIAGNOSTICS


        function rendererChoice() {
          try {
            const value = Services.prefs.getStringPref(RENDER_PREF, "auto");
            return RENDER_MODES.includes(value) ? value : "auto";
          } catch (_) {
            return "canvas";
          }
        }

        function selectedModeOnly() {
          return (
            rendererChoice() !== "auto" &&
            Services.prefs.getBoolPref(STRICT_MODE_PREF, false)
          );
        }
        function visibilityPolicyApplies() {
          const choice = rendererChoice();
          return (
            powerOn(SUSPEND_VISIBLE_PREF) ||
            (liveBridgeEnabled() &&
              Services.prefs.getBoolPref(KEEP_VISIBLE_PREF, true) &&
              (choice === "auto" ||
                ["frame-native", "native"].includes(choice)))
          );
        }
        function renderCandidates(choice, active, blocked, source) {
          if (active) return [active];
          if (selectedModeOnly()) return [choice];
          const ordered =
            choice === "auto"
              ? RENDER_MODES
              : RENDER_MODES.slice(Math.max(0, RENDER_MODES.indexOf(choice)));
          return ordered.filter(
            (mode) =>
              (!blocked || !["frame-native", "native"].includes(mode)) &&
              !unavailableReason(mode, source) &&
              !failedRenderers.has(mode),
          );
        }
        function methodName(mode) {
          return (
            {
              auto: "Automatic",
              "frame-native": "Native cloning · frame",
              native: "Native cloning · actor",
              "frame-stream": "Video stream · frame",
              stream: "Video stream · actor",
              "canvas-stream": "Canvas stream",
              canvas: "Video frames",
              snapshot: "Page snapshots",
            }[mode] ||
            mode ||
            "None"
          );
        }
        function methodDescription(mode) {
          return (
            {
              auto: "Tries native cloning, captured streams, canvas stream, video frames, then page snapshots. This is an engineering order, not a measured CPU ranking; low-FPS still capture can use less power than continuous video.",
              "frame-native":
                "Preferred continuous preview: reuses decoded video frames and keeps audio at the source. Can replace the page image with a PiP placeholder and cannot share a source with another PiP clone. Frame transport is the confirmed first choice.",
              native:
                "Same native image path and PiP tradeoffs, through a Firefox actor. Useful if the frame transport fails; actor registration adds setup work, with no measured steady-state advantage.",
              "frame-stream":
                "Continuous captured video without a native PiP clone. Keeps source audio at the source. Adds a media-stream pipeline; requires capture support and cannot capture encrypted media. Legacy capture stays off unless enabled in Video experiments.",
              stream:
                "Same captured-stream benefits and limits through an actor. Alternate transport for frame-bridge failures; no measured image-quality or steady-state resource advantage.",
              "canvas-stream":
                "Continuous canvas-backed video at your chosen stream FPS and width (up to 30 FPS / 640 px). Adds repeated canvas drawing and readback; cross-origin or encrypted media may block it. Heavier than native or direct stream capture.",
              canvas:
                "Captures video pixels at your chosen FPS and resolution. Predictable low-FPS power saving, but repeated readback and transfer cost more at high FPS; excludes page overlays and may fail on protected or cross-origin media.",
              snapshot:
                "Captures the visible page video region, including page overlays. Broad fallback when pixel capture fails; needs an on-screen source rectangle and may include controls. Repeated page snapshots are generally the last choice. FPS and resolution apply.",
            }[mode] || ""
          );
        }


        function discoveryChoice() {
          try {
            const value = Services.prefs.getStringPref(DISCOVERY_PREF, "auto");
            return ["frame", "actor", "direct"].includes(value)
              ? value
              : "auto";
          } catch (_) {
            return "auto";
          }
        }


        function captureDimension() {
          let width = adaptiveWidth || captureWidth();
          if (
            featureOn(DISPLAY_CAP_PREF) &&
            picture?.isConnected &&
            !picture.hidden
          ) {
            const rect = picture.getBoundingClientRect();
            const scale = Math.max(1, window.devicePixelRatio || 1);
            if (rect.width > 0 && rect.height > 0)
              width = Math.min(
                width,
                Math.max(
                  160,
                  Math.ceil(Math.max(rect.width, rect.height) * scale),
                ),
              );
          }
          return Math.max(160, Math.min(captureWidth(), width));
        }

        function recordCaptureDuration(ms) {
          if (!featureOn(ADAPTIVE_DETAIL_PREF)) return;
          const budget = captureIntervalMs();
          if (ms > budget * 1.5) {
            slowCaptures++;
            fastCaptures = 0;
            if (slowCaptures >= 3) {
              adaptiveWidth = Math.max(
                160,
                Math.min(
                  captureWidth(),
                  Math.round((adaptiveWidth || captureWidth()) * 0.75),
                ),
              );
              slowCaptures = 0;
            }
          } else if (ms < budget * 0.5) {
            fastCaptures++;
            slowCaptures = 0;
            if (fastCaptures >= 30) {
              adaptiveWidth = Math.min(
                captureWidth(),
                Math.round((adaptiveWidth || captureWidth()) / 0.75),
              );
              fastCaptures = 0;
            }
          } else slowCaptures = fastCaptures = 0;
        }


        // SECTION 4: Sidebar UI, source identity, visibility and discovery.


        // SECTION 5: Live receiver lifecycle, presentation and still captures.


        // DISPLAY INVARIANT: the canvas is above the receiver in the CSS stack.
        // User-origin important CSS can override inline display:none. Detach the
        // still surface only after verified live output. Retain the object and
        // anchor so error/stop restores baseline capture and caption ordering.
        // This was the build-15 breakthrough; do not replace it with CSS hiding.


        // SECTION 6: Scheduling, preference transitions and teardown.


        const onPref = () => {
          if (enabled()) start();
          else stop();
          syncCompactVisibility();
          injectSetting();
        };
        const onExperimentalPref = () => {
          stop();
          methodState.actor = "waiting";
          if (enabled()) start();
          injectSetting();
        };
        const onTab = (event) => {
          if (liveBridgeEnabled() && event.type === "TabSelect") {
            visibilityCheckAt = 0;
            if (
              current &&
              !sourceCertainlyHidden(current) &&
              ["frame-native", "native"].includes(previewMode) &&
              Services.prefs.getBoolPref(KEEP_VISIBLE_PREF, true)
            )
              resetRendering();
          }
          wakePaint();
          const tab = event.target;
          if (
            event.type === "TabAttrModified" &&
            tab !== gBrowser.selectedTab &&
            !tab?.soundPlaying
          )
            return;
          if (event.type === "TabClose")
            discoveryCache.delete(tab?.linkedBrowser);
          queueDiscovery(tab?.linkedBrowser);
        };

        const onRenderPref = async () => {
          unavailableBySource.clear();
          rendererRetryCounts.clear();
          resetRendering();
          visibilityCheckAt = 0;
          visibilitySourceKey = "";
          sourceVisibilityBlocked = false;
          clearInterval(sourceVisibilityTimer);
          sourceVisibilityTimer = null;
          restartVisibilityTimer();
          injectSetting();
          const generation = previewGeneration;
          try {
            await refreshRendererSource(current, generation);
          } catch (error) {
            if (generation === previewGeneration)
              previewTransitionReason = String(error).slice(0, 180);
          }
          if (disposed || generation !== previewGeneration) return;
          refreshCard();
          if (enabled()) {
            if (!scanTimer) start();
            else if (current) paint();
          }
        };
        const onPauseCompactPref = () => {
          syncCompactVisibility();
          injectSetting();
        };
        const onCaptureRatePref = () => {
          nextStillCapture = 0;
          updatePaintTimer();
          injectSetting();
          if (enabled() && WORKING_MODES.includes(previewMode)) paint();
        };
        const onDiscoveryPref = () => {
          discoveryLocks.clear();
          discoveryCache.clear();
          discoveryWinner = null;
          ++scanGeneration; // Ignore results of an old automatic probe.
          sources = [];
          current = null;
          resetRendering();
          refreshCard();
          if (enabled()) scan(true);
        };
        // Changes from import and the independent settings manager must also
        // update cached dimensions/state and the original video settings menu.
        // Coalesce a bulk import into one refresh, without polling.
        let videoSettingFromMenu = false;
        const videoSettingsBranch = "zen.workspace.zentral.video_preview.";
        const directlyObservedVideoPrefs = new Set([
          PREF,
          EXPERIMENTAL_DISABLED_PREF,
          PAUSE_COMPACT_PREF,
          CAPTURE_RATE_PREF,
          RENDER_PREF,
          DISCOVERY_PREF,
        ]);
        const changedVideoPrefs = new Set();
        let videoSettingsQueued = false;
        const onVideoSetting = (_subject, _topic, key) => {
          if (
            disposed ||
            videoSettingFromMenu ||
            directlyObservedVideoPrefs.has(key)
          )
            return;
          changedVideoPrefs.add(key);
          if (videoSettingsQueued) return;
          videoSettingsQueued = true;
          queueMicrotask(() => {
            videoSettingsQueued = false;
            if (disposed) {
              changedVideoPrefs.clear();
              return;
            }
            const changes = new Set(changedVideoPrefs);
            changedVideoPrefs.clear();
            heightPx = Math.max(0, Math.min(800, readInt(HEIGHT_PREF, 0)));
            radiusPx = Math.max(0, Math.min(24, readInt(RADIUS_PREF, 0)));
            widthPercent = Math.max(
              35,
              Math.min(100, readInt(WIDTH_PREF, 100)),
            );
            videoHidden = Services.prefs.getBoolPref(VIDEO_HIDDEN_PREF, false);
            cardCompact = Services.prefs.getBoolPref(COMPACT_STATE_PREF, false);
            if (
              changes.has(STRICT_MODE_PREF) ||
              (changes.has(KEEP_VISIBLE_PREF) && liveBridgeEnabled())
            ) {
              visibilityCheckAt = 0;
              resetRendering();
            }
            if (POWER_PREFS.some((pref) => changes.has(pref)))
              applyPowerSettings();
            if (changes.has(KEEP_VISIBLE_PREF)) restartVisibilityTimer();
            if (scanTimer && changes.has(SCAN_INTERVAL_PREF))
              restartDiscoveryTimer();
            if (changes.has(CAPTION_POLL_PREF) || changes.has(CAPTIONS_PREF))
              restartCaptionTimer();
            if (
              changes.has(CANVAS_STREAM_WIDTH_PREF) ||
              changes.has(CANVAS_STREAM_FPS_PREF)
            )
              resetRendering();
            if (changes.has(PIN_BUTTON_PREF) && !featureOn(PIN_BUTTON_PREF))
              pinnedSource = null;
            if (changes.has(ADAPTIVE_DETAIL_PREF))
              adaptiveWidth = slowCaptures = fastCaptures = 0;
            if (
              changes.has(CAPTURE_WIDTH_PREF) ||
              changes.has(DISPLAY_CAP_PREF) ||
              changes.has(FRAME_AWARE_PREF)
            )
              nextStillCapture = 0;
            if (
              changes.has(CAPTIONS_PREF) ||
              changes.has(CAPTION_EVENTS_PREF)
            ) {
              clearCaptionWatch();
              if (featureOn(CAPTIONS_PREF)) refreshCaption();
              else setCaption("");
            }
            if (
              changes.has(AUTO_SHOW_PREF) &&
              !autoShowVideo() &&
              previewAutoSelected
            ) {
              current = null;
              previewAutoSelected = false;
              resetRendering();
            }
            fitPicture();
            refreshCard();
            updatePaintTimer();
            injectSetting();
            if (
              enabled() &&
              [
                HIDE_DUPLICATES_PREF,
                REQUIRE_AUDIO_PREF,
                AUTO_SHOW_PREF,
                AUDIO_CACHE_PREF,
              ].some((pref) => changes.has(pref))
            )
              scan(true);
          });
        };
        Services.prefs.addObserver(videoSettingsBranch, onVideoSetting);
        Services.prefs.addObserver(
          EXPERIMENTAL_DISABLED_PREF,
          onExperimentalPref,
        );
        Services.prefs.addObserver(PAUSE_COMPACT_PREF, onPauseCompactPref);
        Services.prefs.addObserver(CAPTURE_RATE_PREF, onCaptureRatePref);
        Services.prefs.addObserver(RENDER_PREF, onRenderPref);
        Services.prefs.addObserver(DISCOVERY_PREF, onDiscoveryPref);
        Services.prefs.addObserver(PREF, onPref);
        for (const type of [
          "TabOpen",
          "TabClose",
          "TabSelect",
          "TabAttrModified",
        ])
          gBrowser.tabContainer.addEventListener(type, onTab);
        const compactObserver = new MutationObserver(() => {
          syncCompactVisibility();
        });
        compactObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: [
            "zen-compact-mode",
            "zen-sidebar-hidden",
            "zen-sidebar-expanded",
            "zen-compact-sidebar-visible",
          ],
        });
        const compactTabs = gBrowser.tabContainer;
        const onCompactEnter = () => {
          compactHovering = true;
          compactHiddenSince = 0;
          syncCompactVisibility();
        };
        const onCompactLeave = () => {
          compactHovering = false;
          compactHiddenSince = Date.now();
          clearTimeout(compactCheckTimer);
          compactCheckTimer = setTimeout(() => syncCompactVisibility(true), 350);
        };
        compactTabs.addEventListener("pointerenter", onCompactEnter);
        compactTabs.addEventListener("pointerleave", onCompactLeave);
        const onVisibilityWake = (event) => {
          if (event?.type !== "scroll") mount();
          suspendHiddenReceiver();
          wakePaint();
        };
        window.addEventListener("sizemodechange", onVisibilityWake);
        window.addEventListener("resize", onVisibilityWake);
        document.addEventListener("visibilitychange", onVisibilityWake);
        window.addEventListener("scroll", onVisibilityWake, true);
        function destroy() {
          if (disposed) return;
          cancelResize();
          disposed = true;
          changedVideoPrefs.clear();
          Services.prefs.removeObserver(videoSettingsBranch, onVideoSetting);
          compactObserver.disconnect();
          pictureObserver?.disconnect();
          pictureObserver = null;
          visibilityObserver?.disconnect();
          visibilityObserver = null;
          window.removeEventListener("sizemodechange", onVisibilityWake);
          window.removeEventListener("resize", onVisibilityWake);
          document.removeEventListener("visibilitychange", onVisibilityWake);
          window.removeEventListener("scroll", onVisibilityWake, true);
          compactTabs.removeEventListener("pointerenter", onCompactEnter);
          compactTabs.removeEventListener("pointerleave", onCompactLeave);
          clearTimeout(compactCheckTimer);
          compactCheckTimer = null;
          stop();
          Services.prefs.removeObserver(PREF, onPref);
          Services.prefs.removeObserver(
            EXPERIMENTAL_DISABLED_PREF,
            onExperimentalPref,
          );
          Services.prefs.removeObserver(PAUSE_COMPACT_PREF, onPauseCompactPref);
          Services.prefs.removeObserver(CAPTURE_RATE_PREF, onCaptureRatePref);
          Services.prefs.removeObserver(RENDER_PREF, onRenderPref);
          Services.prefs.removeObserver(DISCOVERY_PREF, onDiscoveryPref);
          for (const type of [
            "TabOpen",
            "TabClose",
            "TabSelect",
            "TabAttrModified",
          ])
            gBrowser.tabContainer.removeEventListener(type, onTab);
          window.removeEventListener("unload", destroy);
          if (
            settingsInstance?.open === wrappedSettingsOpen &&
            window.BgalazkaExtensionInitialized !== false
          )
            settingsInstance.open = originalSettingsOpen;
          const category = document.getElementById("zs-tab-btn-video-cloning");
          category?.parentElement?.removeEventListener(
            "click",
            settingsCategoryGuard,
            true,
          );
          category?.remove();
          document.getElementById("zs-panel-video-cloning")?.remove();
          for (const id of ["video-playback", "video-sources", "video-appearance", "video-performance", "video-experiments"]) {
            document.getElementById("zs-panel-organized-"+id)?.remove();
            document.getElementById("zs-tab-btn-organized-"+id)?.remove();
          }
          document.getElementById("zs-tab-btn-extension-video-dev")?.remove();
          document.getElementById("zs-panel-extension-video-dev")?.remove();
          delete window.ZentralVideoPreview;
        }
        window.ZentralVideoPreview = {
          destroy,
          refresh: scan,
          diagnostics: () => ({
            ...diagnostics,
            build: BUILD,
            actorName: ACTOR,
            actorRegistered: actorReady,
            methods: { ...methodState },
            enabled: enabled(),
            nativePreviewEnabled: nativePreviewEnabled(),
            normalLivePreviewEnabled: normalLivePreviewEnabled(),
            liveBridgeEnabled: liveBridgeEnabled(),
            selectedModeOnly: selectedModeOnly(),
            requestedRenderer: rendererChoice(),
            fallbackReason: previewTransitionReason,
            experimentalBridgeDisabled: experimentalBridgeDisabled(),
            renderer: previewMode,
            ...(liveBridgeEnabled()
              ? {
                  experiment: lastExperiment,
                  helperId: EXPERIMENT_HELPER_ID,
                }
              : {}),
            captureRateFps: captureRateTenths() / 10,
            captureWorkMs: Math.round(captureWorkMs * 10) / 10,
            nextPaintDelayMs: paintTimerMs,
            pauseWhenCompactHidden: pauseWhenCompactHidden(),
            compactPaused,
            resumePending: !!compactResumeSource,
            autoSelected: previewAutoSelected,
            hideMutedDuplicates: hideMutedDuplicates(),
            performance: {
              ...metrics,
              transport: {
                raw: { ...metrics.transport.raw },
                jpeg: { ...metrics.transport.jpeg },
              },
            },
            pinned: !!pinnedSource,
            compactCard: cardCompact,
            videoHidden,
            running: !!scanTimer,
            sources: sources.length,
            active: !!current,
            visible: !!box?.isConnected && !box.hidden,
          }),
        };
        hookSettings();
        syncCompactVisibility();
        window.addEventListener("unload", destroy, { once: true });
        if (typeof window.addUnloadListener === "function")
          window.addUnloadListener(destroy);
        else if (typeof UC_API !== "undefined" && UC_API.addUnloadListener)
          UC_API.addUnloadListener(destroy);
        if (
          typeof gBrowserInit !== "undefined" &&
          !gBrowserInit.delayedStartupFinished
        )
          Services.obs.addObserver(function ready(subject, topic) {
            if (subject !== window) return;
            Services.obs.removeObserver(ready, topic);
            start();
          }, "browser-delayed-startup-finished");
        else standaloneReady(start);
      })();
      return () => window.ZentralVideoPreview?.destroy?.();
    };
    if (window.ZentralRuntime)
      ZentralRuntime.register({ id: "video", init: start });
    else standaloneReady(start);
  })();
})();
