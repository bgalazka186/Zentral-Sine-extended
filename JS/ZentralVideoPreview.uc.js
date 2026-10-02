(function () {
  "use strict";
  /*
   * Experimental preview notes — 2026-09-27
   * Build 7, tested in Zen on YouTube and a local MP4: frame and actor
   * discovery found the video; Video Frames and Page Snapshots returned images.
   * Canvas Stream threw SecurityError because its canvas belonged to the
   * detached about:blank document. Direct discovery could not access these
   * remote content documents. Live renderers reported health OK, while
   * getVideoPlaybackQuality().totalVideoFrames stayed at zero.
   *
   * Build 8, tested on YouTube and a local MP4: creating the stream canvas in
   * the source document removed SecurityError. Native clone, media stream, and
   * canvas stream all had advancing target requestVideoFrameCallback counts,
   * nonblack preview snapshots, and healthy transport. The quality counter
   * still stayed at zero, so it is not a reliable lone presentation check.
   *
   * Build 9: ordinary playback now permits a visible source and uses frame
   * callbacks for stream health. This change still needs a normal Zen UI test;
   * the earlier observations came from the settings diagnostic runner.
   * Experimental modes remain opt-in. No browser security setting is changed.
   */
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime;

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
        const PAUSE_COMPACT_PREF =
          "zen.workspace.zentral.video_preview.pause_when_compact_hidden";
        const RENDER_PREF = "zen.workspace.zentral.video_preview.renderer";
        const DISCOVERY_PREF = "zen.workspace.zentral.video_preview.discovery";
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
        const featureOn = (pref) => Services.prefs.getBoolPref(pref, true);
        // Store tenths of an fps as an integer so the slowest choice is exactly 0.1 fps.
        const CAPTURE_RATE_PREF =
          "zen.workspace.zentral.video_preview.capture_rate_tenths";
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
            return [320, 480, 640].includes(value) ? value : 480;
          } catch (_) {
            return 480;
          }
        }
        const BUILD = "video-preview-2026-09-27-11";
        const FRAME_SOURCE =
          '// Loaded into each browser\'s content process through its frame message manager.\n// The channel is replaced at startup so separate browser windows stay isolated.\n(function () {\n  // Shared by actor and frame-script transports; no parent-side privileges.\nclass ZentralVideoRenderer {\n  constructor(doc) { this.doc = doc; this.serial = 0; }\n  async start({ videoRef, mode, fit = "contain" }) {\n    if (this.doc?.documentURI !== "about:blank") throw new Error("Invalid preview document");\n    this.stop();\n    const serial = this.serial;\n    const { ContentDOMReference } = ChromeUtils.importESModule(\n      "resource://gre/modules/ContentDOMReference.sys.mjs");\n    const media = await ContentDOMReference.resolve(videoRef);\n    if (serial !== this.serial) throw new Error("Preview cancelled");\n    if (!media?.isConnected || media.localName !== "video")\n      throw new Error("Video reference unavailable in preview process");\n    this.source = media;\n    const doc = this.doc, win = doc.defaultView;\n    if (!doc.body) doc.documentElement.appendChild(doc.createElement("body"));\n    doc.body.style.cssText = "margin:0;overflow:hidden;background:#000";\n    const target = doc.createElement("video");\n    target.muted = true;\n    target.autoplay = true;\n    target.style.cssText = "display:block;width:100vw;height:100vh;object-fit:" +\n      (fit === "cover" ? "cover" : "contain") + ";background:#000";\n    doc.body.appendChild(target);\n    this.video = target;\n    this.mode = mode;\n    this.presentedCallbacks = 0;\n    if (typeof target.requestVideoFrameCallback === "function") {\n      const tick = () => {\n        if (this.video !== target) return;\n        this.presentedCallbacks++;\n        this.frameCallback = target.requestVideoFrameCallback(tick);\n      };\n      this.frameCallback = target.requestVideoFrameCallback(tick);\n    }\n    try {\n      if (mode === "native") {\n        if (media.isCloningElementVisually) throw new Error("Source already has a visual clone");\n        if (typeof media.cloneElementVisually !== "function") throw new Error("Native cloning unavailable");\n        await media.cloneElementVisually(target);\n      } else if (mode === "stream") {\n        const capture = media.captureStream || media.mozCaptureStream;\n        if (typeof capture !== "function") throw new Error("Stream capture unavailable");\n        this.stream = capture.call(media);\n        const tracks = this.stream.getVideoTracks();\n        if (!tracks.length) throw new Error("Stream contains no video track");\n        target.srcObject = new win.MediaStream(tracks);\n        await target.play();\n        if (serial !== this.serial) throw new Error("Preview cancelled");\n        await this.firstFrame(target);\n      } else if (mode === "canvas-stream") {\n        // Create the canvas under the source document\'s principal. Drawing\n        // media from another origin into about:blank taints its capture stream.\n        const surface = media.ownerDocument.createElement("canvas");\n        surface.width = Math.min(640, media.videoWidth);\n        surface.height = Math.max(1, Math.round(surface.width * media.videoHeight / media.videoWidth));\n        const ctx = surface.getContext("2d", { alpha: false });\n        ctx.drawImage(media, 0, 0, surface.width, surface.height);\n        this.stream = surface.captureStream(30);\n        target.srcObject = this.stream;\n        // Keep all copies inside the source process. No per-frame JPEG or IPC.\n        // Use the visible preview window clock: source rVFC may stop in a hidden tab.\n        let lastTime = NaN;\n        this.timer = win.setInterval(() => {\n          if (!media.isConnected || media.ended) { this.failure = "Source ended or detached"; return; }\n          if (media.currentTime === lastTime || media.readyState < 2) return;\n          try {\n            ctx.drawImage(media, 0, 0, surface.width, surface.height);\n            lastTime = media.currentTime;\n          } catch (error) { this.failure = String(error); }\n        }, 1000 / 30);\n        await target.play();\n        if (serial !== this.serial) throw new Error("Preview cancelled");\n        await this.firstFrame(target);\n      } else throw new Error("Unknown preview mode");\n      if (serial !== this.serial) throw new Error("Preview cancelled");\n      return { ok: true, mode };\n    } catch (error) {\n      if (serial === this.serial) this.stop();\n      throw error;\n    }\n  }\n  firstFrame(target) {\n    if (target.readyState >= 2 && target.videoWidth > 0) return Promise.resolve();\n    return new Promise((resolve, reject) => {\n      const win = this.doc.defaultView;\n      const done = error => {\n        win.clearTimeout(timer);\n        target.removeEventListener("loadeddata", loaded);\n        this.cancelWait = null;\n        error ? reject(error) : resolve();\n      };\n      const loaded = () => done();\n      const timer = win.setTimeout(() => done(new Error("Stream produced no decoded frame")), 1800);\n      this.cancelWait = () => done(new Error("Preview cancelled"));\n      target.addEventListener("loadeddata", loaded, { once: true });\n    });\n  }\n  health() {\n    const tracks = this.stream?.getVideoTracks() || [];\n    const rect = this.video?.getBoundingClientRect();\n    const ok = !!this.video?.isConnected && !!this.source?.isConnected && !this.failure &&\n      !this.source.ended && ((this.mode === "native" && this.source.isCloningElementVisually) ||\n        (this.video.readyState >= 2 && tracks.some(track => track.readyState !== "ended" && !track.muted)));\n    return { ok, error: ok ? null : this.failure || "Preview disconnected or stream unavailable",\n      paused: this.source?.paused, time: this.source?.currentTime,\n      sourceFrames: this.source?.getVideoPlaybackQuality?.().totalVideoFrames || 0,\n      frames: this.video?.getVideoPlaybackQuality?.().totalVideoFrames || 0,\n      presentedCallbacks: this.presentedCallbacks || 0,\n      readyState: this.video?.readyState, targetPaused: this.video?.paused,\n      targetTime: this.video?.currentTime, visibility: this.doc.visibilityState,\n      dimensions: [this.video?.videoWidth, this.video?.videoHeight],\n      targetRect: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,\n      viewport: [this.doc.defaultView.innerWidth, this.doc.defaultView.innerHeight],\n      tracks: tracks.map(track => ({ readyState: track.readyState, muted: track.muted })) };\n  }\n  stop() {\n    ++this.serial;\n    this.cancelWait?.();\n    if (this.timer != null) this.doc.defaultView.clearInterval(this.timer);\n    this.timer = null;\n    if (this.mode === "native" && this.source) {\n      try { this.source.stopCloningElementVisually?.(); } catch (_) {}\n    }\n    try { this.video?.cancelVideoFrameCallback?.(this.frameCallback); } catch (_) {}\n    this.frameCallback = null;\n    this.video?.remove();\n    this.video = null;\n    for (const track of this.stream?.getTracks() || []) track.stop();\n    this.stream = null;\n    this.source = null;\n    this.failure = null;\n  }\n}\n\n\n  function captionText(doc = content.document, media = null) {\n    try {\n      media ??= doc?.querySelector("video");\n      for (const track of media?.textTracks || []) {\n        if (track.mode !== "showing" || !["captions", "subtitles"].includes(track.kind)) continue;\n        const cues = Array.from(track.activeCues || []);\n        if (cues.length) return cues.map(cue => cue.text || "").join(" ").replace(/\\s+/g, " ").slice(0, 1000);\n      }\n      const host = doc?.location?.hostname || "";\n      if (host !== "youtube.com" && !host.endsWith(".youtube.com") &&\n          host !== "youtube-nocookie.com" && !host.endsWith(".youtube-nocookie.com")) return "";\n      const button = doc.querySelector(".ytp-subtitles-button");\n      if (button && button.getAttribute("aria-pressed") !== "true" &&\n          !button.classList.contains("ytp-button-active")) return "";\n      return Array.from(doc.querySelectorAll(".ytp-caption-segment"))\n        .filter(el => {\n          const style = doc.defaultView.getComputedStyle(el);\n          const parent = el.closest(".caption-window");\n          const parentStyle = parent && doc.defaultView.getComputedStyle(parent);\n          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" &&\n            (!parentStyle || (parentStyle.display !== "none" && parentStyle.visibility !== "hidden" && parentStyle.opacity !== "0"));\n        }).map(el => el.textContent.trim()).filter(Boolean).join(" ").replace(/\\s+/g, " ").slice(0, 1000);\n    } catch (_) { return ""; }\n  }\n\n\n  let captionObserver = null;\n  let watchedMedia = null;\n  let captionTracks = [];\n  let captionQueued = false;\n  const onCaptionChange = () => {\n    if (captionQueued || !watchedMedia) return;\n    captionQueued = true;\n    content.setTimeout(() => {\n      captionQueued = false;\n      if (stopped || !watchedMedia) return;\n      sendAsyncMessage(CHANNEL + ":caption", {\n        frameId: frameId(), id: ids.get(watchedMedia),\n        text: captionText(content.document, watchedMedia),\n      });\n    }, 50);\n  };\n  function watchCaption(id, active = true) {\n    captionObserver?.disconnect(); captionObserver = null;\n    for (const track of captionTracks) track.removeEventListener("cuechange", onCaptionChange);\n    captionTracks = [];\n    watchedMedia = active ? elements.get(id) || null : null;\n    if (!watchedMedia) return false;\n    for (const track of watchedMedia.textTracks || []) {\n      track.addEventListener("cuechange", onCaptionChange);\n      captionTracks.push(track);\n    }\n    if (/(^|\\.)youtube(?:-nocookie)?\\.com$/.test(content.document.location?.hostname || "")) {\n      const root = content.document.querySelector(".ytp-caption-window-container") ||\n        content.document.querySelector(".html5-video-player");\n      if (root) {\n        captionObserver = new content.MutationObserver(onCaptionChange);\n        captionObserver.observe(root, { childList: true, characterData: true, subtree: true });\n      }\n    }\n    onCaptionChange();\n    return true;\n  }\n\n  let renderer = null;\n  let stopped = false;\n  const CHANNEL = "__CHANNEL__";\n  const ids = new WeakMap();\n  const elements = new Map();\n  let nextId = 0;\n  const frameId = () => content.browsingContext?.id || 0;\n\n  const audioCache = new WeakMap();\nfunction hasVideoAudioTrack(media, cacheAudio = true) {\n  // Track presence is independent of the viewer\'s mute and volume choices.\n  try {\n    if (media.srcObject?.getAudioTracks) return media.srcObject.getAudioTracks().length > 0;\n    if (media.audioTracks) return media.audioTracks.length > 0;\n    const key = media.currentSrc || media.src || "";\n    const cached = audioCache.get(media);\n    if (cacheAudio && cached?.key === key && Date.now() - cached.at < 30000)\n      return cached.hasAudio;\n    const capture = media.captureStream || media.mozCaptureStream;\n    if (typeof capture !== "function") return false;\n    const stream = capture.call(media);\n    const hasAudio = stream.getAudioTracks().length > 0;\n    for (const track of stream.getTracks()) track.stop();\n    if (cacheAudio) audioCache.set(media, { key, at: Date.now(), hasAudio });\n    return hasAudio;\n  } catch (_) { return false; }\n}\n\n  function list({ requireAudio = false, cacheAudio = true } = {}) {\n    const doc = content.document;\n    if (!doc) return [];\n    const found = [];\n    const live = new Set();\n    for (const media of doc.querySelectorAll("video")) {\n      if (media.localName !== "video" || media.ended || media.readyState < 1) continue;\n      const box = media.getBoundingClientRect();\n      const x = Math.max(0, box.left);\n      const y = Math.max(0, box.top);\n      const width = Math.min(content.innerWidth, box.right) - x;\n      const height = Math.min(content.innerHeight, box.bottom) - y;\n      if (media.videoWidth < 240 || media.videoHeight < 135 ||\n          (Number.isFinite(media.duration) && media.duration > 0 && media.duration < 8) ||\n          (requireAudio && !hasVideoAudioTrack(media, cacheAudio))) continue;\n      let id = ids.get(media);\n      if (!id) { id = ++nextId; ids.set(media, id); }\n      elements.set(id, media);\n      live.add(id);\n      const label = media.getAttribute("aria-label") || media.getAttribute("title") ||\n        media.closest("[aria-label]")?.getAttribute("aria-label") ||\n        doc.title || "Video";\n      let videoRef = null;\n      try {\n        const { ContentDOMReference } = ChromeUtils.importESModule(\n          "resource://gre/modules/ContentDOMReference.sys.mjs");\n        videoRef = ContentDOMReference.get(media);\n      } catch (_) {}\n      found.push({ id, videoRef, documentId: content.windowGlobalChild?.innerWindowId || 0,\n        frameId: frameId(), label: String(label).slice(0, 100),\n        kind: "video",\n        canClone: typeof media.cloneElementVisually === "function",\n        canStream: typeof (media.captureStream || media.mozCaptureStream) === "function",\n        canCanvasStream: typeof doc.createElement("canvas").captureStream === "function",\n        rect: width > 0 && height > 0 ? { x, y, width, height } : null,\n        score: (media.paused ? 0 : 10000000) + Math.max(0, width) * Math.max(0, height),\n        paused: media.paused, muted: media.muted,\n        currentTime: media.currentTime,\n        duration: Number.isFinite(media.duration) ? media.duration : 0,\n        currentSrc: media.currentSrc || "",\n        width: media.videoWidth || 0, height: media.videoHeight || 0 });\n    }\n    for (const id of elements.keys()) if (!live.has(id)) elements.delete(id);\n    return found;\n  }\n\n\n  const frameStates = new WeakMap();\n  function stopFrameTracking(media) {\n    const state = frameStates.get(media);\n    if (!state) return;\n    state.active = false;\n    try { media.cancelVideoFrameCallback?.(state.callbackId); } catch (_) {}\n    frameStates.delete(media);\n  }\n  function unchangedFrame(media, frameAware) {\n    if (!frameAware || typeof media.requestVideoFrameCallback !== "function") return false;\n    let state = frameStates.get(media);\n    if (!state) {\n      state = { presented: 0, seen: -1, callbackAt: 0, capturedAt: 0, active: true, callbackId: null };\n      frameStates.set(media, state);\n      const tick = (_, metadata) => {\n        if (!state.active || !media.isConnected) return;\n        state.presented = metadata.presentedFrames;\n        state.callbackAt = media.ownerDocument.defaultView.performance.now();\n        state.callbackId = media.requestVideoFrameCallback(tick);\n      };\n      state.callbackId = media.requestVideoFrameCallback(tick);\n    }\n    const now = media.ownerDocument.defaultView.performance.now();\n    if (state.seen === state.presented && now - state.callbackAt < 250 &&\n        now - state.capturedAt < 1000) return true;\n    state.seen = state.presented;\n    state.capturedAt = now;\n    return false;\n  }\n\n  let captureCanvas, captureContext;\n  function captureFrame({ id, captureWidth = 480, binary = false, frameAware = true }) {\n    const media = elements.get(id);\n    if (!media?.isConnected || media.localName !== "video" || media.readyState < 2)\n      throw new Error("No decoded video frame available");\n    if (unchangedFrame(media, frameAware)) return { unchanged: true };\n    const maxDimension = Math.max(160, Math.min(640, Math.round(captureWidth) || 480));\n    const width = Math.max(1, Math.min(media.videoWidth,\n      Math.round(maxDimension * media.videoWidth / Math.max(media.videoWidth, media.videoHeight))));\n    const height = Math.max(1, Math.round(width * media.videoHeight / media.videoWidth));\n    captureCanvas ??= content.document.createElement("canvas");\n    if (captureCanvas.width !== width || captureCanvas.height !== height) {\n      captureCanvas.width = width; captureCanvas.height = height;\n    }\n    captureContext ??= captureCanvas.getContext("2d", { alpha: false, willReadFrequently: true });\n    captureContext.drawImage(media, 0, 0, width, height);\n    if (binary) return { pixels: captureContext.getImageData(0, 0, width, height).data.buffer, width, height };\n    return { url: captureCanvas.toDataURL("image/jpeg", 0.75), width, height };\n  }\n\n  function controlMedia({ id, action, value }) {\n    const media = elements.get(id);\n    if (!media?.isConnected) return null;\n    switch (action) {\n      case "toggle":\n        if (media.paused) media.play().catch(() => {});\n        else media.pause();\n        break;\n      case "mute": media.muted = !media.muted; break;\n      case "seek":\n        if (Number.isFinite(value) && Number.isFinite(media.duration))\n          media.currentTime = Math.max(0, Math.min(media.duration, value));\n        break;\n    }\n    return { paused: media.paused, muted: media.muted,\n      currentTime: media.currentTime,\n      duration: Number.isFinite(media.duration) ? media.duration : 0 };\n  }\n\n  async function onRequest(message) {\n    const { requestId, kind, frameId: requestedFrame, ...args } = message.data;\n    if (stopped || (kind !== "List" && requestedFrame !== frameId())) return;\n    try {\n      let result;\n      if (kind === "List") result = list(args);\n      else if (kind === "Preview") {\n        renderer ??= new ZentralVideoRenderer(content.document);\n        result = await renderer.start(args);\n      } else if (kind === "Health") result = renderer?.health() || { ok: false };\n      else if (kind === "StopPreview") { renderer?.stop(); result = true; }\n      else if (kind === "Caption") result = captionText(content.document, elements.get(args.id));\n      else if (kind === "WatchCaption") result = watchCaption(args.id, args.active);\n      else if (kind === "ActorCheck") {\n        ChromeUtils.importESModule(args.moduleURI);\n        result = true;\n      } else result = kind === "Capture" ? captureFrame(args) : controlMedia(args);\n      if (!stopped) sendAsyncMessage(CHANNEL + ":reply", { requestId, result });\n    } catch (error) {\n      if (!stopped) sendAsyncMessage(CHANNEL + ":reply", { requestId, error: String(error), result: [] });\n    }\n  }\n  function onShutdown() {\n    stopped = true;\n    renderer?.stop();\n    removeMessageListener(CHANNEL + ":request", onRequest);\n    removeMessageListener(CHANNEL + ":shutdown", onShutdown);\n    watchCaption(0, false);\n    for (const media of elements.values()) stopFrameTracking(media);\n    elements.clear();\n    captureCanvas = captureContext = null;\n    for (const event of mediaEvents) removeEventListener(event, onMediaEvent, true);\n  }\n  const mediaEvents = ["play", "playing", "pause", "ended", "emptied", "volumechange", "loadedmetadata"];\n  let eventQueued = false;\n  function onMediaEvent(event) {\n    if (event.target?.localName !== "video" || eventQueued) return;\n    eventQueued = true;\n    content.setTimeout(() => {\n      eventQueued = false;\n      if (!stopped) sendAsyncMessage(CHANNEL + ":media", { frameId: frameId() });\n    }, 100);\n  }\n  for (const event of mediaEvents) addEventListener(event, onMediaEvent, true);\n  addEventListener("unload", () => renderer?.stop());\n  addMessageListener(CHANNEL + ":request", onRequest);\n  addMessageListener(CHANNEL + ":shutdown", onShutdown);\n})();\n';
        const ACTOR_SOURCE =
          '// Shared by actor and frame-script transports; no parent-side privileges.\nclass ZentralVideoRenderer {\n  constructor(doc) { this.doc = doc; this.serial = 0; }\n  async start({ videoRef, mode, fit = "contain" }) {\n    if (this.doc?.documentURI !== "about:blank") throw new Error("Invalid preview document");\n    this.stop();\n    const serial = this.serial;\n    const { ContentDOMReference } = ChromeUtils.importESModule(\n      "resource://gre/modules/ContentDOMReference.sys.mjs");\n    const media = await ContentDOMReference.resolve(videoRef);\n    if (serial !== this.serial) throw new Error("Preview cancelled");\n    if (!media?.isConnected || media.localName !== "video")\n      throw new Error("Video reference unavailable in preview process");\n    this.source = media;\n    const doc = this.doc, win = doc.defaultView;\n    if (!doc.body) doc.documentElement.appendChild(doc.createElement("body"));\n    doc.body.style.cssText = "margin:0;overflow:hidden;background:#000";\n    const target = doc.createElement("video");\n    target.muted = true;\n    target.autoplay = true;\n    target.style.cssText = "display:block;width:100vw;height:100vh;object-fit:" +\n      (fit === "cover" ? "cover" : "contain") + ";background:#000";\n    doc.body.appendChild(target);\n    this.video = target;\n    this.mode = mode;\n    this.presentedCallbacks = 0;\n    if (typeof target.requestVideoFrameCallback === "function") {\n      const tick = () => {\n        if (this.video !== target) return;\n        this.presentedCallbacks++;\n        this.frameCallback = target.requestVideoFrameCallback(tick);\n      };\n      this.frameCallback = target.requestVideoFrameCallback(tick);\n    }\n    try {\n      if (mode === "native") {\n        if (media.isCloningElementVisually) throw new Error("Source already has a visual clone");\n        if (typeof media.cloneElementVisually !== "function") throw new Error("Native cloning unavailable");\n        await media.cloneElementVisually(target);\n      } else if (mode === "stream") {\n        const capture = media.captureStream || media.mozCaptureStream;\n        if (typeof capture !== "function") throw new Error("Stream capture unavailable");\n        this.stream = capture.call(media);\n        const tracks = this.stream.getVideoTracks();\n        if (!tracks.length) throw new Error("Stream contains no video track");\n        target.srcObject = new win.MediaStream(tracks);\n        await target.play();\n        if (serial !== this.serial) throw new Error("Preview cancelled");\n        await this.firstFrame(target);\n      } else if (mode === "canvas-stream") {\n        // Create the canvas under the source document\'s principal. Drawing\n        // media from another origin into about:blank taints its capture stream.\n        const surface = media.ownerDocument.createElement("canvas");\n        surface.width = Math.min(640, media.videoWidth);\n        surface.height = Math.max(1, Math.round(surface.width * media.videoHeight / media.videoWidth));\n        const ctx = surface.getContext("2d", { alpha: false });\n        ctx.drawImage(media, 0, 0, surface.width, surface.height);\n        this.stream = surface.captureStream(30);\n        target.srcObject = this.stream;\n        // Keep all copies inside the source process. No per-frame JPEG or IPC.\n        // Use the visible preview window clock: source rVFC may stop in a hidden tab.\n        let lastTime = NaN;\n        this.timer = win.setInterval(() => {\n          if (!media.isConnected || media.ended) { this.failure = "Source ended or detached"; return; }\n          if (media.currentTime === lastTime || media.readyState < 2) return;\n          try {\n            ctx.drawImage(media, 0, 0, surface.width, surface.height);\n            lastTime = media.currentTime;\n          } catch (error) { this.failure = String(error); }\n        }, 1000 / 30);\n        await target.play();\n        if (serial !== this.serial) throw new Error("Preview cancelled");\n        await this.firstFrame(target);\n      } else throw new Error("Unknown preview mode");\n      if (serial !== this.serial) throw new Error("Preview cancelled");\n      return { ok: true, mode };\n    } catch (error) {\n      if (serial === this.serial) this.stop();\n      throw error;\n    }\n  }\n  firstFrame(target) {\n    if (target.readyState >= 2 && target.videoWidth > 0) return Promise.resolve();\n    return new Promise((resolve, reject) => {\n      const win = this.doc.defaultView;\n      const done = error => {\n        win.clearTimeout(timer);\n        target.removeEventListener("loadeddata", loaded);\n        this.cancelWait = null;\n        error ? reject(error) : resolve();\n      };\n      const loaded = () => done();\n      const timer = win.setTimeout(() => done(new Error("Stream produced no decoded frame")), 1800);\n      this.cancelWait = () => done(new Error("Preview cancelled"));\n      target.addEventListener("loadeddata", loaded, { once: true });\n    });\n  }\n  health() {\n    const tracks = this.stream?.getVideoTracks() || [];\n    const rect = this.video?.getBoundingClientRect();\n    const ok = !!this.video?.isConnected && !!this.source?.isConnected && !this.failure &&\n      !this.source.ended && ((this.mode === "native" && this.source.isCloningElementVisually) ||\n        (this.video.readyState >= 2 && tracks.some(track => track.readyState !== "ended" && !track.muted)));\n    return { ok, error: ok ? null : this.failure || "Preview disconnected or stream unavailable",\n      paused: this.source?.paused, time: this.source?.currentTime,\n      sourceFrames: this.source?.getVideoPlaybackQuality?.().totalVideoFrames || 0,\n      frames: this.video?.getVideoPlaybackQuality?.().totalVideoFrames || 0,\n      presentedCallbacks: this.presentedCallbacks || 0,\n      readyState: this.video?.readyState, targetPaused: this.video?.paused,\n      targetTime: this.video?.currentTime, visibility: this.doc.visibilityState,\n      dimensions: [this.video?.videoWidth, this.video?.videoHeight],\n      targetRect: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,\n      viewport: [this.doc.defaultView.innerWidth, this.doc.defaultView.innerHeight],\n      tracks: tracks.map(track => ({ readyState: track.readyState, muted: track.muted })) };\n  }\n  stop() {\n    ++this.serial;\n    this.cancelWait?.();\n    if (this.timer != null) this.doc.defaultView.clearInterval(this.timer);\n    this.timer = null;\n    if (this.mode === "native" && this.source) {\n      try { this.source.stopCloningElementVisually?.(); } catch (_) {}\n    }\n    try { this.video?.cancelVideoFrameCallback?.(this.frameCallback); } catch (_) {}\n    this.frameCallback = null;\n    this.video?.remove();\n    this.video = null;\n    for (const track of this.stream?.getTracks() || []) track.stop();\n    this.stream = null;\n    this.source = null;\n    this.failure = null;\n  }\n}\n\nconst audioCache = new WeakMap();\nfunction hasVideoAudioTrack(media, cacheAudio = true) {\n  // Track presence is independent of the viewer\'s mute and volume choices.\n  try {\n    if (media.srcObject?.getAudioTracks) return media.srcObject.getAudioTracks().length > 0;\n    if (media.audioTracks) return media.audioTracks.length > 0;\n    const key = media.currentSrc || media.src || "";\n    const cached = audioCache.get(media);\n    if (cacheAudio && cached?.key === key && Date.now() - cached.at < 30000)\n      return cached.hasAudio;\n    const capture = media.captureStream || media.mozCaptureStream;\n    if (typeof capture !== "function") return false;\n    const stream = capture.call(media);\n    const hasAudio = stream.getAudioTracks().length > 0;\n    for (const track of stream.getTracks()) track.stop();\n    if (cacheAudio) audioCache.set(media, { key, at: Date.now(), hasAudio });\n    return hasAudio;\n  } catch (_) { return false; }\n}\n\n\n  function captionText(doc, media = null) {\n    try {\n      media ??= doc?.querySelector("video");\n      for (const track of media?.textTracks || []) {\n        if (track.mode !== "showing" || !["captions", "subtitles"].includes(track.kind)) continue;\n        const cues = Array.from(track.activeCues || []);\n        if (cues.length) return cues.map(cue => cue.text || "").join(" ").replace(/\\s+/g, " ").slice(0, 1000);\n      }\n      const host = doc?.location?.hostname || "";\n      if (host !== "youtube.com" && !host.endsWith(".youtube.com") &&\n          host !== "youtube-nocookie.com" && !host.endsWith(".youtube-nocookie.com")) return "";\n      const button = doc.querySelector(".ytp-subtitles-button");\n      if (button && button.getAttribute("aria-pressed") !== "true" &&\n          !button.classList.contains("ytp-button-active")) return "";\n      return Array.from(doc.querySelectorAll(".ytp-caption-segment"))\n        .filter(el => {\n          const style = doc.defaultView.getComputedStyle(el);\n          const parent = el.closest(".caption-window");\n          const parentStyle = parent && doc.defaultView.getComputedStyle(parent);\n          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" &&\n            (!parentStyle || (parentStyle.display !== "none" && parentStyle.visibility !== "hidden" && parentStyle.opacity !== "0"));\n        }).map(el => el.textContent.trim()).filter(Boolean).join(" ").replace(/\\s+/g, " ").slice(0, 1000);\n    } catch (_) { return ""; }\n  }\n\n\n  const frameStates = new WeakMap();\n  function stopFrameTracking(media) {\n    const state = frameStates.get(media);\n    if (!state) return;\n    state.active = false;\n    try { media.cancelVideoFrameCallback?.(state.callbackId); } catch (_) {}\n    frameStates.delete(media);\n  }\n  function unchangedFrame(media, frameAware) {\n    if (!frameAware || typeof media.requestVideoFrameCallback !== "function") return false;\n    let state = frameStates.get(media);\n    if (!state) {\n      state = { presented: 0, seen: -1, callbackAt: 0, capturedAt: 0, active: true, callbackId: null };\n      frameStates.set(media, state);\n      const tick = (_, metadata) => {\n        if (!state.active || !media.isConnected) return;\n        state.presented = metadata.presentedFrames;\n        state.callbackAt = media.ownerDocument.defaultView.performance.now();\n        state.callbackId = media.requestVideoFrameCallback(tick);\n      };\n      state.callbackId = media.requestVideoFrameCallback(tick);\n    }\n    const now = media.ownerDocument.defaultView.performance.now();\n    if (state.seen === state.presented && now - state.callbackAt < 250 &&\n        now - state.capturedAt < 1000) return true;\n    state.seen = state.presented;\n    state.capturedAt = now;\n    return false;\n  }\n\n// Content-process source discovery for Zentral\'s sidebar video preview.\n// It never changes playback unless the user presses a preview control.\nexport class ZentralVideoBridgeChild extends JSWindowActorChild {\n  async receiveMessage(message) {\n    if (message.name === "List") return this.list(message.data);\n    if (message.name === "Control") return this.control(message.data);\n    if (message.name === "Capture") return this.capture(message.data);\n    if (message.name === "Caption") return captionText(this.document, this.elements?.get(message.data?.id));\n    if (message.name === "Health") return this.renderer?.health() || { ok: false };\n    if (message.name === "Preview") return this.preview(message.data);\n    if (message.name === "StopPreview") { this.stopPreview(); return true; }\n    return null;\n  }\n\n  list({ requireAudio = false, cacheAudio = true } = {}) {\n    const doc = this.document;\n    const win = this.contentWindow;\n    if (!doc || !win) return [];\n    this.ids ??= new WeakMap();\n    this.elements ??= new Map();\n    this.nextId ??= 1;\n    const found = [];\n    const live = new Set();\n\n    for (const media of doc.querySelectorAll("video")) {\n      if (media.localName !== "video" || media.ended || media.readyState < 1) continue;\n      const box = media.getBoundingClientRect();\n      const x = Math.max(0, box.left);\n      const y = Math.max(0, box.top);\n      const width = Math.min(win.innerWidth, box.right) - x;\n      const height = Math.min(win.innerHeight, box.bottom) - y;\n      // Require decoded video frames; skip tiny decorative clips.\n      if (media.videoWidth < 240 || media.videoHeight < 135 ||\n          (Number.isFinite(media.duration) && media.duration > 0 && media.duration < 8) ||\n          (requireAudio && !hasVideoAudioTrack(media, cacheAudio))) continue;\n\n      let id = this.ids.get(media);\n      if (!id) { id = this.nextId++; this.ids.set(media, id); }\n      this.elements.set(id, media);\n      live.add(id);\n      const label = media.getAttribute("aria-label") || media.getAttribute("title") ||\n        media.closest("[aria-label]")?.getAttribute("aria-label") ||\n        doc.title || "Video";\n      let videoRef = null;\n      try {\n        const { ContentDOMReference } = ChromeUtils.importESModule(\n          "resource://gre/modules/ContentDOMReference.sys.mjs");\n        videoRef = ContentDOMReference.get(media);\n      } catch (_) { /* Snapshot / canvas capture can still work. */ }\n      found.push({ id, videoRef, documentId: this.manager?.innerWindowId || 0,\n        label: String(label).slice(0, 100),\n        kind: "video",\n        canClone: typeof media.cloneElementVisually === "function",\n        canStream: typeof (media.captureStream || media.mozCaptureStream) === "function",\n        canCanvasStream: typeof doc.createElement("canvas").captureStream === "function",\n        rect: width > 0 && height > 0 ? { x, y, width, height } : null,\n        score: (media.paused ? 0 : 10000000) + Math.max(0, width) * Math.max(0, height),\n        paused: media.paused, muted: media.muted,\n        currentTime: media.currentTime,\n        duration: Number.isFinite(media.duration) ? media.duration : 0,\n        currentSrc: media.currentSrc || "",\n        width: media.videoWidth || 0, height: media.videoHeight || 0 });\n    }\n    for (const id of this.elements.keys()) if (!live.has(id)) this.elements.delete(id);\n    return found;\n  }\n\n  capture({ id, captureWidth = 480, binary = false, frameAware = true } = {}) {\n    const media = this.elements?.get(id);\n    if (!media?.isConnected || media.localName !== "video" || media.readyState < 2)\n      throw new Error("No decoded video frame available");\n    if (unchangedFrame(media, frameAware)) return { unchanged: true };\n    const maxDimension = Math.max(160, Math.min(640, Math.round(captureWidth) || 480));\n    const width = Math.max(1, Math.min(media.videoWidth,\n      Math.round(maxDimension * media.videoWidth / Math.max(media.videoWidth, media.videoHeight))));\n    const height = Math.max(1, Math.round(width * media.videoHeight / media.videoWidth));\n    this.captureCanvas ??= this.document.createElement("canvas");\n    if (this.captureCanvas.width !== width || this.captureCanvas.height !== height) {\n      this.captureCanvas.width = width; this.captureCanvas.height = height;\n    }\n    this.captureContext ??= this.captureCanvas.getContext("2d", { alpha: false, willReadFrequently: true });\n    this.captureContext.drawImage(media, 0, 0, width, height);\n    if (binary) return { pixels: this.captureContext.getImageData(0, 0, width, height).data.buffer, width, height };\n    return { url: this.captureCanvas.toDataURL("image/jpeg", 0.75), width, height };\n  }\n\n  async preview(data) {\n    this.renderer ??= new ZentralVideoRenderer(this.document);\n    return this.renderer.start(data);\n  }\n\n  stopPreview() { this.renderer?.stop(); }\n\n  didDestroy() {\n    this.stopPreview();\n    for (const media of this.elements?.values() || []) stopFrameTracking(media);\n    this.elements?.clear();\n    this.captureCanvas = this.captureContext = null;\n  }\n\n  control({ id, action, value } = {}) {\n    const media = this.elements?.get(id);\n    if (!media?.isConnected) return null;\n    switch (action) {\n      case "toggle":\n        if (media.paused) media.play().catch(() => {});\n        else media.pause();\n        break;\n      case "mute": media.muted = !media.muted; break;\n      case "seek":\n        if (Number.isFinite(value) && Number.isFinite(media.duration))\n          media.currentTime = Math.max(0, Math.min(media.duration, value));\n        break;\n    }\n    return { paused: media.paused, muted: media.muted,\n      currentTime: media.currentTime,\n      duration: Number.isFinite(media.duration) ? media.duration : 0 };\n  }\n}\n';
        const ACTOR = "ZentralVideoBridge";
        const CHANNEL =
          "ZentralVideoPreview:" + Math.random().toString(36).slice(2);
        const FRAME_URI =
          "data:application/javascript;charset=utf-8," +
          encodeURIComponent(FRAME_SOURCE.replaceAll("__CHANNEL__", CHANNEL));
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
          actor: experimentalBridgeDisabled()
            ? "disabled in settings"
            : "waiting",
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
        let mountTimer = null;
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

        function experimentalBridgeDisabled() {
          try {
            return Services.prefs.getBoolPref(EXPERIMENTAL_DISABLED_PREF, true);
          } catch (_) {
            return true;
          }
        }

        function ensureActor() {
          if (experimentalBridgeDisabled()) return false;
          if (actorAttempted) return actorReady;
          actorAttempted = true;
          try {
            const file = Services.dirsvc.get("UChrm", Ci.nsIFile);
            file.append("zentral-video-bridge.sys.mjs");
            // Fixed helper URI: updates to the experimental actor require a browser restart.
            // Rewrite the opt-in helper to heal same-length corruption as well.
            {
              const stream = Cc[
                "@mozilla.org/network/file-output-stream;1"
              ].createInstance(Ci.nsIFileOutputStream);
              stream.init(file, 0x02 | 0x08 | 0x20, 0o600, 0);
              try {
                stream.write(ACTOR_SOURCE, ACTOR_SOURCE.length);
              } finally {
                stream.close();
              }
            }
            actorModuleURI = Services.io.newFileURI(file).spec;
            // Resource mappings are propagated to content processes. Keep the old
            // file route as a compatibility fallback if this Gecko lacks the handler.
            try {
              const handler = Services.io
                .getProtocolHandler("resource")
                .QueryInterface(Ci.nsIResProtocolHandler);
              handler.setSubstitution(
                "zentral-video-bridge",
                Services.io.newFileURI(file.parent),
              );
              actorModuleURI =
                "resource://zentral-video-bridge/" + file.leafName;
            } catch (_) {}
            try {
              // Gecko 154+ requires an explicit opt-in for ordinary web processes.
              // This actor only queries media / operates our own preview document;
              // it exposes no privileged parent-side message handlers.
              ChromeUtils.registerWindowActor(ACTOR, {
                allFrames: true,
                safeForUntrustedWebProcess: true,
                child: { esModuleURI: actorModuleURI },
              });
            } catch (error) {
              if (!String(error).includes("already registered")) throw error;
            }
            actorReady = true;
            methodState.actor = "registered; waiting for reply";
          } catch (error) {
            methodError("actor", error);
          }
          return actorReady;
        }

        function bridge(browser) {
          const manager = browser.messageManager;
          const existing = bridges.get(browser);
          if (existing && existing.manager === manager) return existing;
          releaseBridge(browser);
          if (!manager?.loadFrameScript || !manager?.sendAsyncMessage)
            throw new Error("Browser frame message manager unavailable");
          const pending = new Map();
          const onResult = (message) => {
            const reply = message.data;
            const request = pending.get(reply?.requestId);
            if (!request) return;
            if (reply.error) {
              request.fail(new Error(reply.error));
              return;
            }
            methodState.frame = "working (content replied)";
            if (request.kind === "List") {
              if (Array.isArray(reply.result))
                request.results.push(...reply.result);
              // Gather other frames in the browser without waiting for every frame.
              if (!request.settle)
                request.settle = setTimeout(
                  () => request.finish(request.results),
                  180,
                );
            } else request.finish(reply.result);
          };
          manager.addMessageListener(CHANNEL + ":reply", onResult);
          try {
            manager.loadFrameScript(FRAME_URI, true);
          } catch (error) {
            manager.removeMessageListener(CHANNEL + ":reply", onResult);
            throw error;
          }
          const state = { manager, pending, onResult };
          state.onMedia = () => {
            if (!featureOn(MEDIA_EVENTS_PREF)) return;
            queueDiscovery(browser);
          };
          manager.addMessageListener(CHANNEL + ":media", state.onMedia);
          state.onCaption = (message) => {
            const data = message.data;
            if (
              !featureOn(CAPTION_EVENTS_PREF) ||
              !featureOn(CAPTIONS_PREF) ||
              videoHidden ||
              current?.browser !== browser ||
              current?.data.frameId !== data?.frameId ||
              current?.data.id !== data?.id
            )
              return;
            setCaption(String(data.text || "").slice(0, 1000));
          };
          manager.addMessageListener(CHANNEL + ":caption", state.onCaption);
          bridges.set(browser, state);
          diagnostics.module = "browser frame message manager";
          return state;
        }

        function releaseBridge(browser) {
          const state = bridges.get(browser);
          if (!state) return;
          bridges.delete(browser);
          for (const request of state.pending.values()) request.finish(null);
          try {
            state.manager.sendAsyncMessage(CHANNEL + ":shutdown");
          } catch (_) {}
          try {
            state.manager.removeMessageListener(
              CHANNEL + ":reply",
              state.onResult,
            );
            state.manager.removeMessageListener(
              CHANNEL + ":media",
              state.onMedia,
            );
            state.manager.removeMessageListener(
              CHANNEL + ":caption",
              state.onCaption,
            );
          } catch (_) {}
          try {
            state.manager.removeDelayedFrameScript(FRAME_URI);
          } catch (_) {}
        }

        function query(browser, kind, data = {}) {
          const state = bridge(browser);
          const requestId = ++nextRequest;
          return new Promise((resolve, reject) => {
            const request = {
              kind,
              results: [],
              settle: null,
              fail(error) {
                if (!state.pending.has(requestId)) return;
                state.pending.delete(requestId);
                clearTimeout(request.timeout);
                clearTimeout(request.settle);
                reject(error);
              },
              finish(result) {
                if (!state.pending.has(requestId)) return;
                state.pending.delete(requestId);
                clearTimeout(request.timeout);
                clearTimeout(request.settle);
                resolve(result);
              },
            };
            request.timeout = setTimeout(
              () => {
                if (!state.pending.has(requestId)) return;
                state.pending.delete(requestId);
                clearTimeout(request.settle);
                reject(new Error("No response from browser content frame"));
              },
              kind === "Preview" ? 4500 : 1500,
            );
            state.pending.set(requestId, request);
            try {
              state.manager.sendAsyncMessage(CHANNEL + ":request", {
                requestId,
                kind,
                ...data,
              });
            } catch (error) {
              state.pending.delete(requestId);
              clearTimeout(request.timeout);
              reject(error);
            }
          });
        }

        function injectSetting() {
          const modal = document.getElementById("zentral-settings-modal");
          const tabBar = modal?.querySelector(".zs-tab-bar");
          const body = modal?.querySelector(".zs-body");
          if (!tabBar || !body) return;
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
            title.textContent = "Sidebar Video Preview · Bgalazka extension";
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
              refreshSettingList();
            });
            // Native settings tabs capture their buttons before this category exists.
            settingsCategoryGuard = (event) => {
              if (event.target.closest?.(".zs-tab-btn") !== category) {
                category.setAttribute("data-active", "false");
                panel.setAttribute("data-active", "false");
              }
            };
            tabBar.addEventListener("click", settingsCategoryGuard, true);
          }
          // The preview uses an older Zentral-pref namespace but is extension-owned.
          // Keep it after the other extension categories when Settings reopens.
          tabBar.appendChild(category);
          const content = panel.querySelector(".zs-section-content");
          let input = modal.querySelector("#zs-video-preview-enabled");
          if (!input) {
            const row = document.createElement("div");
            row.id = "zs-video-preview-row";
            row.className = "zs-row";
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
              Services.prefs.setBoolPref(PREF, input.checked),
            );
            const addToggle = (label, preference, initial, onchange) => {
              const row = document.createElement("label");
              row.className = "zs-row";
              row.style.cssText =
                "display:flex;align-items:center;justify-content:space-between;gap:12px";
              const text = document.createElement("span");
              text.className = "zs-label";
              text.textContent = label;
              const checkbox = document.createElement("input");
              checkbox.type = "checkbox";
              const ids = new Map([
                [HIDE_DUPLICATES_PREF, "hide-muted-duplicates"],
                [FIT_WIDTH_PREF, "fit-width"],
                [REQUIRE_AUDIO_PREF, "require-audio"],
                [AUTO_SHOW_PREF, "auto-show"],
                [HIDE_BUTTON_PREF, "hide-button"],
                [AUTO_HEIGHT_BUTTON_PREF, "auto-height-button"],
                [BINARY_FRAMES_PREF, "binary-frames"],
                [DISPLAY_CAP_PREF, "display-cap"],
                [ADAPTIVE_DETAIL_PREF, "adaptive-detail"],
                [MEDIA_EVENTS_PREF, "media-events"],
                [CAPTIONS_PREF, "captions"],
                [IDLE_TIMER_PREF, "idle-timer"],
                [AUDIO_CACHE_PREF, "audio-cache"],
                [FRAME_AWARE_PREF, "frame-aware"],
                [CAPTION_EVENTS_PREF, "caption-events"],
                [PIN_BUTTON_PREF, "pin-button"],
                [COMPACT_BUTTON_PREF, "compact-button"],
                [PERF_DIAG_PREF, "perf-diag"],
              ]);
              checkbox.id = "zs-video-preview-" + ids.get(preference);
              checkbox.checked = Services.prefs.getBoolPref(
                preference,
                initial,
              );
              checkbox.addEventListener("change", () => {
                videoSettingFromMenu = true;
                try {
                  Services.prefs.setBoolPref(preference, checkbox.checked);
                } finally {
                  videoSettingFromMenu = false;
                }
                onchange();
              });
              row.append(text, checkbox);
              content.appendChild(row);
            };
            const experimentalRow = document.createElement("label");
            experimentalRow.className = "zs-row";
            experimentalRow.style.cssText =
              "display:flex;align-items:center;justify-content:space-between;gap:12px";
            const experimentalText = document.createElement("span");
            experimentalText.className = "zs-label-container";
            const experimentalTitle = document.createElement("span");
            experimentalTitle.className = "zs-label";
            experimentalTitle.textContent = "Disable Experimental Video Bridge";
            const experimentalHelp = document.createElement("span");
            experimentalHelp.className = "zs-sublabel";
            experimentalHelp.textContent =
              "On by default: Automatic tries Video Frames first, then Page Snapshots. " +
              "No bridge module is created or loaded. Turn off to test native/stream " +
              "capture and actor discovery; this creates or updates " +
              "zentral-video-bridge.sys.mjs in chrome. Bridge updates may require a browser restart. " +
              "Existing older bridge files are never deleted automatically.";
            experimentalText.append(experimentalTitle, experimentalHelp);
            const experimentalCheckbox = document.createElement("input");
            experimentalCheckbox.type = "checkbox";
            experimentalCheckbox.id = "zs-video-preview-disable-experimental";
            experimentalCheckbox.checked = experimentalBridgeDisabled();
            experimentalCheckbox.addEventListener("change", () =>
              Services.prefs.setBoolPref(
                EXPERIMENTAL_DISABLED_PREF,
                experimentalCheckbox.checked,
              ),
            );
            experimentalRow.append(experimentalText, experimentalCheckbox);
            content.appendChild(experimentalRow);
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
            pauseCheck.checked = pauseWhenCompactHidden();
            pauseCheck.addEventListener("change", () =>
              Services.prefs.setBoolPref(
                PAUSE_COMPACT_PREF,
                pauseCheck.checked,
              ),
            );
            pauseRow.append(pauseText, pauseCheck);
            content.appendChild(pauseRow);
            addToggle(
              "Hide muted copies when an unmuted video matches",
              HIDE_DUPLICATES_PREF,
              true,
              () => {
                if (enabled()) scan(true);
              },
            );
            addToggle(
              "Do not display videos without an audio track",
              REQUIRE_AUDIO_PREF,
              true,
              () => {
                if (enabled()) scan(true);
              },
            );
            addToggle(
              "Show playing videos automatically (without PiP)",
              AUTO_SHOW_PREF,
              true,
              () => {
                if (
                  changes.has(AUTO_SHOW_PREF) &&
                  !autoShowVideo() &&
                  previewAutoSelected
                ) {
                  current = null;
                  previewAutoSelected = false;
                  resetRendering();
                  refreshCard();
                } else if (enabled()) scan(true);
              },
            );
            addToggle(
              "Fill available sidebar width",
              FIT_WIDTH_PREF,
              true,
              () => {
                fitPicture();
                injectSetting();
              },
            );
            addToggle(
              "Show hide/show video button",
              HIDE_BUTTON_PREF,
              true,
              refreshCard,
            );
            addToggle(
              "Show Auto height button after resizing",
              AUTO_HEIGHT_BUTTON_PREF,
              true,
              refreshCard,
            );
            addToggle("Show pin source button", PIN_BUTTON_PREF, true, () => {
              if (!featureOn(PIN_BUTTON_PREF)) pinnedSource = null;
              refreshCard();
            });
            addToggle(
              "Show compact card button",
              COMPACT_BUTTON_PREF,
              true,
              refreshCard,
            );
            addToggle(
              "Transfer raw frames (fall back to JPEG)",
              BINARY_FRAMES_PREF,
              true,
              () => {
                resetRendering();
                if (enabled()) paint();
              },
            );
            addToggle(
              "Limit still capture to displayed size",
              DISPLAY_CAP_PREF,
              true,
              () => {
                nextStillCapture = 0;
                if (enabled()) paint();
              },
            );
            addToggle(
              "Adapt still capture detail under load",
              ADAPTIVE_DETAIL_PREF,
              true,
              () => {
                adaptiveWidth = slowCaptures = fastCaptures = 0;
              },
            );
            addToggle(
              "Skip duplicate decoded frames",
              FRAME_AWARE_PREF,
              true,
              () => {
                nextStillCapture = 0;
              },
            );
            addToggle(
              "Stop paint timer when preview is not visible",
              IDLE_TIMER_PREF,
              true,
              () => {
                if (featureOn(IDLE_TIMER_PREF) && !previewVisible())
                  updatePaintTimer(false);
                else updatePaintTimer(true);
              },
            );
            addToggle(
              "Refresh sources on media events",
              MEDIA_EVENTS_PREF,
              true,
              () => {
                if (enabled()) scan();
              },
            );
            addToggle(
              "Cache audio-track checks for 30 seconds",
              AUDIO_CACHE_PREF,
              true,
              () => {
                if (enabled()) scan(true);
              },
            );
            addToggle(
              "Mirror captions (text tracks and YouTube)",
              CAPTIONS_PREF,
              true,
              () => {
                if (!featureOn(CAPTIONS_PREF)) {
                  clearCaptionWatch();
                  setCaption("");
                } else refreshCaption();
              },
            );
            addToggle(
              "Use caption change events when available",
              CAPTION_EVENTS_PREF,
              true,
              () => {
                clearCaptionWatch();
                refreshCaption();
              },
            );
            addToggle(
              "Show performance diagnostics",
              PERF_DIAG_PREF,
              true,
              refreshMethodStatus,
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
              widthPercent,
              (number, label, save) => {
                widthPercent = number;
                label.textContent = number + "%";
                if (save) Services.prefs.setIntPref(WIDTH_PREF, number);
                fitPicture();
              },
            );
            width.value.textContent = widthPercent + "%";
            const height = addRange(
              "Video height",
              "zs-video-preview-height",
              90,
              800,
              heightPx || Math.min(800, 230),
              (number, label, save) => {
                heightPx = Math.max(90, Math.min(800, number));
                label.textContent = heightPx + " px";
                if (save) Services.prefs.setIntPref(HEIGHT_PREF, heightPx);
                fitPicture();
              },
            );
            height.value.textContent = heightPx ? heightPx + " px" : "Auto";
            const resetHeight = document.createElement("button");
            resetHeight.type = "button";
            resetHeight.className = "zs-btn-save";
            resetHeight.textContent = "Auto height (video ratio)";
            resetHeight.addEventListener("click", () => {
              setAutoHeight();
            });
            content.appendChild(resetHeight);
            const radius = addRange(
              "Corner rounding",
              "zs-video-preview-radius",
              0,
              24,
              radiusPx,
              (number, label, save) => {
                radiusPx = number;
                label.textContent = number + " px";
                if (save) Services.prefs.setIntPref(RADIUS_PREF, number);
                fitPicture();
              },
            );
            radius.value.textContent = radiusPx + " px";
            const detailLabel = document.createElement("label");
            detailLabel.textContent =
              "Capture detail, longest edge (frames and snapshots only) ";
            const detail = document.createElement("select");
            detail.id = "zs-video-preview-capture-width";
            for (const [value, label] of [
              [320, "Lower load · 320 px"],
              [480, "Balanced · 480 px (default)"],
              [640, "Sharper · 640 px"],
            ]) {
              const option = document.createElement("option");
              option.value = String(value);
              option.textContent = label;
              detail.appendChild(option);
            }
            detail.value = String(captureWidth());
            detail.addEventListener("change", () => {
              Services.prefs.setIntPref(
                CAPTURE_WIDTH_PREF,
                Number(detail.value),
              );
              if (enabled()) paint();
            });
            detailLabel.appendChild(detail);
            content.appendChild(detailLabel);
            const rateLabel = document.createElement("label");
            rateLabel.textContent =
              "Video Frames / Page Snapshots capture rate ";
            const rate = document.createElement("input");
            rate.type = "range";
            rate.id = "zs-video-preview-capture-rate";
            rate.min = "0";
            rate.max = String(CAPTURE_RATES.length - 1);
            rate.step = "1";
            rate.value = String(CAPTURE_RATES.indexOf(captureRateTenths()));
            const rateValue = document.createElement("span");
            rateValue.id = "zs-video-preview-capture-rate-value";
            rateValue.textContent = captureRateTenths() / 10 + " fps";
            rate.addEventListener("input", () => {
              const tenths = CAPTURE_RATES[Number(rate.value)];
              rateValue.textContent = tenths / 10 + " fps";
              rateCost.textContent = captureRateDescription(tenths);
            });
            rate.addEventListener("change", () =>
              Services.prefs.setIntPref(
                CAPTURE_RATE_PREF,
                CAPTURE_RATES[Number(rate.value)],
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
            frameSelect.value = framingChoice();
            frameSelect.addEventListener("change", () => {
              Services.prefs.setStringPref(FRAMING_PREF, frameSelect.value);
              cropStates.clear();
              if (current?.data) {
                delete current.data.displayWidth;
                delete current.data.displayHeight;
              }
              fitPicture();
              refreshCard();
              if (LIVE_MODES.includes(previewMode)) {
                resetRendering();
                paint();
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
              select(sources[list.selectedIndex], true),
            );
            const refresh = document.createElement("button");
            refresh.type = "button";
            refresh.className = "zs-btn-save";
            refresh.textContent = "Refresh sources";
            refresh.addEventListener("click", () => {
              discoveryLocks.clear();
              discoveryWinner = null;
              unavailableBySource.clear();
              scan(true);
            });
            actions.append(preview, refresh);
            content.append(listTitle, list, actions);
            const testButton = document.createElement("button");
            testButton.type = "button";
            testButton.className = "zs-btn-save";
            testButton.textContent =
              "Test everything and copy results to clipboard";
            testButton.addEventListener("click", async () => {
              if (testingAll) return;
              testButton.disabled = true;
              testButton.textContent = "Testing video methods…";
              try {
                const copied = await testEverything(
                  sources[list.selectedIndex] || current,
                  (label) => {
                    testButton.textContent = `Testing ${label}…`;
                  },
                );
                testButton.textContent = copied
                  ? "Results copied; test again"
                  : "Report below; copy manually";
              } catch (error) {
                testButton.textContent = "Test failed; retry";
                recordError(error);
              } finally {
                testButton.disabled = false;
              }
            });
            content.appendChild(testButton);
            const testReport = document.createElement("textarea");
            testReport.id = "zs-video-preview-test-report";
            testReport.readOnly = true;
            testReport.hidden = true;
            testReport.setAttribute("aria-label", "Video method test report");
            testReport.style.cssText =
              "width:100%;height:180px;box-sizing:border-box;font:11px monospace;white-space:pre;";
            content.appendChild(testReport);
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
              ["auto", "Automatic (probe available methods)"],
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
              option.textContent = LIVE_MODES.includes(value)
                ? label + " (experimental)"
                : label;
              renderer.appendChild(option);
            }
            renderer.value = rendererChoice();
            renderer.addEventListener("change", () =>
              Services.prefs.setStringPref(RENDER_PREF, renderer.value),
            );
            rendererLabel.appendChild(renderer);
            content.appendChild(rendererLabel);
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
                value === "auto" ? "Automatic (keep working method)" : value;
              discovery.appendChild(option);
            }
            discovery.value = discoveryChoice();
            discovery.addEventListener("change", () =>
              Services.prefs.setStringPref(DISCOVERY_PREF, discovery.value),
            );
            discoveryLabel.appendChild(discovery);
            content.appendChild(discoveryLabel);
            const help = document.createElement("div");
            help.className = "zs-sublabel";
            help.textContent =
              "Checks for videos every 5 seconds. Drag the grip below the video to set its height; use the Auto button to restore automatic height. Auto crop checks once, after about 3 seconds of playback. Click the framing button to check again; hold it to show the complete image. Your framing choice is saved.";
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
              content.appendChild(section);
            };
            group(
              "Playback & layout",
              "Controls on the sidebar card and its size.",
              [
                settingsRow("auto-show"),
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
                help,
              ],
            );
            group(
              "Sources & discovery",
              "Which videos appear and how Zentral finds them.",
              [
                settingsRow("hide-muted-duplicates"),
                settingsRow("require-audio"),
                settingsRow("audio-cache"),
                settingsRow("media-events"),
                experimentalRow,
                discoveryLabel,
                listTitle,
                list,
                actions,
              ],
            );
            group(
              "Capture & performance",
              "Still-frame transport, pacing, and renderer selection.",
              [
                settingsRow("binary-frames"),
                settingsRow("display-cap"),
                settingsRow("adaptive-detail"),
                settingsRow("frame-aware"),
                settingsRow("idle-timer"),
                detailLabel,
                rateLabel,
                rateCost,
                rendererLabel,
                availability,
              ],
            );
            group(
              "Captions & diagnostics",
              "Subtitle updates and live performance information.",
              [
                settingsRow("captions"),
                settingsRow("caption-events"),
                settingsRow("perf-diag"),
                bridgesStatus,
              ],
            );
          }
          input.checked = enabled();
          const experimentalCheck = modal.querySelector(
            "#zs-video-preview-disable-experimental",
          );
          if (experimentalCheck)
            experimentalCheck.checked = experimentalBridgeDisabled();
          const pauseCheck = modal.querySelector(
            "#zs-video-preview-pause-compact",
          );
          if (pauseCheck) pauseCheck.checked = pauseWhenCompactHidden();
          for (const [id, pref] of [
            ["hide-button", HIDE_BUTTON_PREF],
            ["auto-height-button", AUTO_HEIGHT_BUTTON_PREF],
            ["binary-frames", BINARY_FRAMES_PREF],
            ["display-cap", DISPLAY_CAP_PREF],
            ["adaptive-detail", ADAPTIVE_DETAIL_PREF],
            ["media-events", MEDIA_EVENTS_PREF],
            ["captions", CAPTIONS_PREF],
            ["idle-timer", IDLE_TIMER_PREF],
            ["audio-cache", AUDIO_CACHE_PREF],
            ["frame-aware", FRAME_AWARE_PREF],
            ["caption-events", CAPTION_EVENTS_PREF],
            ["pin-button", PIN_BUTTON_PREF],
            ["compact-button", COMPACT_BUTTON_PREF],
            ["perf-diag", PERF_DIAG_PREF],
          ]) {
            const checkbox = modal.querySelector("#zs-video-preview-" + id);
            if (checkbox) checkbox.checked = featureOn(pref);
          }
          const widthCheck = modal.querySelector("#zs-video-preview-width");
          if (widthCheck) widthCheck.disabled = fillWidth();
          const fillCheck = modal.querySelector("#zs-video-preview-fit-width");
          if (fillCheck) fillCheck.checked = fillWidth();
          const heightInput = modal.querySelector("#zs-video-preview-height");
          if (heightInput)
            heightInput.value = String(heightPx || Math.min(800, 230));
          const heightLabel = modal.querySelector(
            "#zs-video-preview-height-value",
          );
          if (heightLabel)
            heightLabel.textContent = heightPx ? heightPx + " px" : "Auto";
          const radiusInput = modal.querySelector("#zs-video-preview-radius");
          if (radiusInput) radiusInput.value = String(radiusPx);
          const radiusLabel = modal.querySelector(
            "#zs-video-preview-radius-value",
          );
          if (radiusLabel) radiusLabel.textContent = radiusPx + " px";
          const detailSelect = modal.querySelector(
            "#zs-video-preview-capture-width",
          );
          if (detailSelect) detailSelect.value = String(captureWidth());
          const rateSelect = modal.querySelector(
            "#zs-video-preview-capture-rate",
          );
          if (rateSelect)
            rateSelect.value = String(
              CAPTURE_RATES.indexOf(captureRateTenths()),
            );
          const rateValue = modal.querySelector(
            "#zs-video-preview-capture-rate-value",
          );
          if (rateValue)
            rateValue.textContent = captureRateTenths() / 10 + " fps";
          const rateCost = modal.querySelector(
            "#zs-video-preview-capture-rate-cost",
          );
          if (rateCost)
            rateCost.textContent = captureRateDescription(captureRateTenths());
          const frameSelect = modal.querySelector("#zs-video-preview-framing");
          if (frameSelect) frameSelect.value = framingChoice();
          const hideCheckbox = modal.querySelector(
            "#zs-video-preview-hide-muted-duplicates",
          );
          if (hideCheckbox) hideCheckbox.checked = hideMutedDuplicates();
          const audioCheckbox = modal.querySelector(
            "#zs-video-preview-require-audio",
          );
          if (audioCheckbox) audioCheckbox.checked = requireAudio();
          const autoCheckbox = modal.querySelector(
            "#zs-video-preview-auto-show",
          );
          if (autoCheckbox) autoCheckbox.checked = autoShowVideo();
          const status = modal.querySelector("#zs-video-preview-status");
          if (status)
            status.textContent = !enabled()
              ? "Off; no media scan or preview runs"
              : compactPaused
                ? "Paused while the compact tabbar is hidden"
                : diagnostics.lastError
                  ? "Preview error: " + diagnostics.lastError
                  : current
                    ? "Showing a media source"
                    : "On; choose a detected source below to show its preview";
          refreshMethodStatus();
          refreshSettingList();
        }

        async function testEverything(selected, progress) {
          const lines = [
            `ZentralVideoPreview ${BUILD} — ${new Date().toISOString()}`,
            `Experimental bridge: ${experimentalBridgeDisabled() ? "disabled" : "enabled"}`,
            `Selected source: ${selected?.tab?.label || selected?.data?.label || "none"}`,
            `Source tab active: ${selected?.tab === gBrowser.selectedTab}`,
            `Source browser connected: ${!!selected?.browser?.isConnected}`,
            `Source reference: ${!!selected?.data?.videoRef}`,
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
            testingAll = true;
            try {
              for (let i = 0; scanning && i < 20; i++)
                await new Promise((resolve) => setTimeout(resolve, 100));
              resetRendering();
              const item = {
                browser: selected.browser,
                tab: selected.tab,
                panel: selected.panel,
              };
              for (const [method, inspect] of [
                ["frame", inspectFrame],
                ["actor", inspectActor],
                ["direct", inspectDirect],
              ]) {
                progress(method + " discovery");
                let candidates = [];
                try {
                  candidates = await inspect(item);
                  lines.push(
                    `${method} discovery: ${candidates.length} video(s); ${methodState[method]}`,
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
                  for (const mode of RENDER_MODES)
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
                for (const mode of RENDER_MODES) {
                  progress(`${method} + ${mode}`);
                  const started = performance.now();
                  let bitmap;
                  try {
                    if (LIVE_MODES.includes(mode)) {
                      await startLivePreview(
                        source,
                        mode,
                        previewGeneration,
                        true,
                      );
                      const first = await playerQuery(
                        previewBrowser,
                        mode,
                        "Health",
                      );
                      await new Promise((resolve) => setTimeout(resolve, 700));
                      const second = await playerQuery(
                        previewBrowser,
                        mode,
                        "Health",
                      );
                      const picture = await samplePlayerPicture(previewBrowser);
                      lines.push(
                        `${method} + ${mode}: OK; first=${JSON.stringify(first)}; after 700ms=${JSON.stringify(second)}; picture=${JSON.stringify(picture)}; ${Math.round(performance.now() - started)}ms`,
                      );
                    } else {
                      bitmap =
                        mode === "canvas"
                          ? await captureVideo(source)
                          : await captureSnapshot(source);
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
                    disposePlayer();
                    canvas?.style.removeProperty("display");
                  }
                  publish();
                }
                lines.push("");
              }
            } catch (error) {
              lines.push(`Test runner: ERROR ${String(error)}`);
            } finally {
              disposePlayer();
              testingAll = false;
              resetRendering();
              wakePaint();
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
            bitmap = await limited(
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
            let lit = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 36) lit++;
            return {
              litPixels: lit,
              totalPixels: 336,
              viewport: [Math.round(rect.width), Math.round(rect.height)],
            };
          } catch (error) {
            return { error: String(error) };
          } finally {
            bitmap?.close?.();
          }
        }

        function refreshMethodStatus() {
          const node = document.getElementById("zs-video-preview-bridges");
          if (node)
            node.textContent =
              `Build: ${BUILD}\n` +
              Object.entries(methodState)
                .map(([name, result]) => `${name}: ${result}`)
                .join("\n") +
              `\nExperimental bridge: ${experimentalBridgeDisabled() ? "disabled" : "enabled (restart after bridge updates)"}` +
              `\nDiscovery: ${discoveryChoice()} (using ${discoveryWinner || "probing"}; 5 s checks)` +
              `\nActive renderer: ${previewMode || "searching"} (setting: ${rendererChoice()})` +
              `\nAuto-show: ${autoShowVideo() ? "on (no live PiP)" : "off"}; hide muted copies: ${hideMutedDuplicates() ? "on" : "off"}` +
              `\nSource tab hidden (informational): ${current ? sourceCertainlyHidden(current) : "no source"}` +
              `\nDiscovery calls: ${metrics.discoveryCalls}; last scan: ${Math.round(metrics.lastScanMs)} ms elapsed` +
              `\nCompact tabbar pause: ${compactPaused ? "paused" : pauseWhenCompactHidden() ? "enabled" : "off"}` +
              `\nStill captures target: ${captureRateTenths() / 10} fps` +
              `\nCaptured frames: ${metrics.frames}; mean capture: ${Math.round(metrics.captureMs / Math.max(1, metrics.frames))} ms elapsed` +
              (featureOn(PERF_DIAG_PREF)
                ? `\nStill-frame effective rate: ${metrics.effectiveFps} fps; skipped duplicate frames: ${metrics.skippedFrames}` +
                  `\nCanvas payload: ${(metrics.bytes / 1048576).toFixed(1)} MiB total; mean active paint pass: ${Math.round(metrics.paintMs / Math.max(1, metrics.paintPasses))} ms; failures: ${metrics.failures}` +
                  ["raw", "jpeg"]
                    .map((mode) => {
                      const row = metrics.transport[mode];
                      return `\n${mode}: ${row.frames} frames; mean ${Math.round(row.ms / Math.max(1, row.frames))} ms; ${(row.bytes / 1048576).toFixed(1)} MiB`;
                    })
                    .join("")
                : "") +
              "\n\nRecent browser probes (candidate counts):\n" +
              [...browserReports.values()]
                .slice(-12)
                .map(
                  (report) =>
                    `${report.label}: actor ${report.actor}, frame ${report.frame}, direct ${report.direct}; using ${discoveryLocks.get(report.browser) || "probing"}`,
                )
                .join("\n");
        }

        function rendererChoice() {
          try {
            const value = Services.prefs.getStringPref(RENDER_PREF, "canvas");
            return RENDER_MODES.includes(value) &&
              (!experimentalBridgeDisabled() || !LIVE_MODES.includes(value))
              ? value
              : "auto";
          } catch (_) {
            return "canvas";
          }
        }

        function discoveryChoice() {
          try {
            const value = Services.prefs.getStringPref(DISCOVERY_PREF, "frame");
            return ["frame", "actor", "direct"].includes(value) &&
              (value !== "actor" || !experimentalBridgeDisabled())
              ? value
              : "auto";
          } catch (_) {
            return "frame";
          }
        }

        function fitPicture() {
          if (!picture) return;
          const data = current?.data;
          const width = data?.displayWidth || data?.width;
          const height = data?.displayHeight || data?.height;
          picture.style.setProperty(
            "--zvp-ratio",
            width && height ? `${width} / ${height}` : "16 / 9",
          );
          picture.style.setProperty(
            "--zvp-width",
            (fillWidth() ? 100 : widthPercent) + "%",
          );
          picture.style.setProperty(
            "--zvp-height",
            heightPx ? heightPx + "px" : "auto",
          );
          picture.style.setProperty(
            "--zvp-object-fit",
            framingChoice() === "contain" ? "contain" : "cover",
          );
          picture.style.setProperty("--zvp-radius", radiusPx + "px");
          box?.style.setProperty("--zvp-radius", radiusPx + "px");
        }

        function setAutoHeight() {
          heightPx = 0;
          Services.prefs.setIntPref(HEIGHT_PREF, 0);
          fitPicture();
          refreshCard();
          injectSetting();
        }

        function togglePin() {
          if (!featureOn(PIN_BUTTON_PREF)) return;
          pinnedSource = pinnedSource
            ? null
            : current && {
                browser: current.browser,
                frameId: current.data.frameId,
                id: current.data.id,
              };
          refreshCard();
          if (!pinnedSource && enabled()) scan(true);
        }

        function toggleCompactCard() {
          cardCompact = !cardCompact;
          Services.prefs.setBoolPref(COMPACT_STATE_PREF, cardCompact);
          refreshCard();
          wakePaint();
        }

        function setVideoHidden(hidden) {
          videoHidden = !!hidden;
          Services.prefs.setBoolPref(VIDEO_HIDDEN_PREF, videoHidden);
          if (videoHidden) {
            clearCaptionWatch();
            resetRendering();
            setCaption("");
          } else nextStillCapture = 0;
          refreshCard();
          if (!videoHidden && current) wakePaint();
        }

        function wakePaint() {
          if (
            disposed ||
            !enabled() ||
            compactPaused ||
            videoHidden ||
            !current
          )
            return;
          if (!previewVisible()) return;
          updatePaintTimer(true);
          if (!wakeTimer)
            wakeTimer = setTimeout(() => {
              wakeTimer = null;
              paint();
            }, 0);
        }

        function setCaption(text) {
          captionText = text;
          if (captionNode) {
            captionNode.textContent = text;
            captionNode.hidden =
              !text || videoHidden || !featureOn(CAPTIONS_PREF);
          }
        }

        function clearCaptionWatch() {
          const watch = captionWatch;
          captionWatch = null;
          lastCaptionPollAt = 0;
          if (watch && bridges.has(watch.browser))
            query(watch.browser, "WatchCaption", {
              frameId: watch.frameId,
              id: watch.id,
              active: false,
            }).catch(() => {});
        }

        async function refreshCaption() {
          const source = current;
          if (
            !featureOn(CAPTIONS_PREF) ||
            videoHidden ||
            compactPaused ||
            !enabled() ||
            !source ||
            source.data.kind !== "video" ||
            !picture?.isConnected ||
            picture.hidden
          ) {
            if (captionText) setCaption("");
            clearCaptionWatch();
            return;
          }
          if (captionBusy) return;
          captionBusy = true;
          try {
            let text = "";
            if (source.method === "frame") {
              const sameWatch =
                captionWatch?.browser === source.browser &&
                captionWatch.frameId === source.data.frameId &&
                captionWatch.id === source.data.id;
              if (!sameWatch) clearCaptionWatch();
              if (featureOn(CAPTION_EVENTS_PREF) && !sameWatch) {
                await query(source.browser, "WatchCaption", {
                  frameId: source.data.frameId,
                  id: source.data.id,
                  active: true,
                });
                captionWatch = {
                  browser: source.browser,
                  frameId: source.data.frameId,
                  id: source.data.id,
                };
              }
              if (
                featureOn(CAPTION_EVENTS_PREF) &&
                sameWatch &&
                Date.now() - lastCaptionPollAt < 5000
              )
                return;
              lastCaptionPollAt = Date.now();
              text = await query(source.browser, "Caption", {
                frameId: source.data.frameId,
                id: source.data.id,
              });
            } else if (source.method === "actor")
              text = await limited(
                source.context.currentWindowGlobal
                  .getActor(ACTOR)
                  .sendQuery("Caption", { id: source.data.id }),
                900,
                "caption",
              );
            else {
              const media = source.element;
              const doc = media?.ownerDocument;
              for (const track of media?.textTracks || [])
                if (
                  track.mode === "showing" &&
                  ["captions", "subtitles"].includes(track.kind) &&
                  track.activeCues?.length
                )
                  text = Array.from(track.activeCues)
                    .map((cue) => cue.text || "")
                    .join(" ");
              if (
                !text &&
                doc &&
                /(^|\.)youtube(?:-nocookie)?\.com$/.test(
                  doc.location?.hostname || "",
                )
              )
                text = [...doc.querySelectorAll(".ytp-caption-segment")]
                  .map((node) => node.textContent.trim())
                  .filter(Boolean)
                  .join(" ");
            }
            if (sameSource(source, current))
              setCaption(String(text || "").slice(0, 1000));
          } catch (_) {
            if (sameSource(source, current)) setCaption("");
          } finally {
            captionBusy = false;
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
                240,
                Math.round((adaptiveWidth || captureWidth()) * 0.75),
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

        function hookSettings() {
          const instance = window.Zentral?.Settings;
          if (!instance || settingsInstance) return;
          settingsInstance = instance;
          originalSettingsOpen = instance.open;
          wrappedSettingsOpen = function (...args) {
            const result = originalSettingsOpen.apply(this, args);
            injectSetting();
            return result;
          };
          instance.open = wrappedSettingsOpen;
          injectSetting();
        }

        function mount() {
          if (disposed || !enabled() || compactPaused) return;
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
            diagnostics.anchor = "No visible Zen sidebar anchor found";
            return;
          }
          diagnostics.anchor = controls.id;
          if (!box) {
            box = document.createElement("div");
            box.id = "zentral-video-preview";
            box.hidden = true;
            box.setAttribute("aria-label", "Playing video preview");
            picture = document.createElement("div");
            picture.className = "zentral-video-preview-picture";
            canvas = document.createElement("canvas");
            picture.appendChild(canvas);
            captionNode = document.createElement("div");
            captionNode.className = "zentral-video-preview-subtitles";
            captionNode.hidden = true;
            picture.appendChild(captionNode);
            pictureObserver = new ResizeObserver(() => {
              if (featureOn(DISPLAY_CAP_PREF)) nextStillCapture = 0;
              wakePaint();
            });
            pictureObserver.observe(picture);
            sourceList = document.createElement("div");
            sourceList.className = "zentral-video-preview-sources";
            sourceList.setAttribute("role", "listbox");
            sourceList.setAttribute(
              "aria-label",
              "Detected videos; click one to preview",
            );
            sourceCapabilities = document.createElement("span");
            sourceCapabilities.className = "zentral-video-preview-capabilities";
            controlBar = document.createElement("div");
            const bar = controlBar;
            bar.className = "zentral-video-preview-bar";
            caption = document.createElement("span");
            caption.className = "zentral-video-preview-caption";
            playButton = document.createElement("button");
            playButton.type = "button";
            playButton.title = "Play or pause source";
            playButton.addEventListener("click", () => control("toggle"));
            muteButton = document.createElement("button");
            muteButton.type = "button";
            muteButton.title = "Mute or unmute source";
            muteButton.addEventListener("click", () => control("mute"));
            seekBar = document.createElement("input");
            seekBar.type = "range";
            seekBar.className = "zentral-video-preview-seek";
            seekBar.min = "0";
            seekBar.max = "1000";
            seekBar.value = "0";
            seekBar.title = "Seek video or audio";
            seekBar.addEventListener("change", () => {
              const duration = current?.data?.duration;
              if (duration)
                control("seek", (Number(seekBar.value) / 1000) * duration);
            });
            const next = document.createElement("button");
            next.type = "button";
            next.title = "Next detected source";
            next.textContent = "⇄";
            next.addEventListener("click", () => {
              if (sources.length < 2) return;
              const index = sources.findIndex((item) =>
                sameSource(item, current),
              );
              select(sources[(index + 1) % sources.length]);
            });
            const open = document.createElement("button");
            open.type = "button";
            open.title = "Open source tab";
            open.textContent = "↗";
            open.addEventListener("click", () => {
              if (canOpenSourceTab(current)) gBrowser.selectedTab = current.tab;
            });
            bar.append(playButton, caption, muteButton, next, open);
            const grip = document.createElement("div");
            grip.className = "zentral-video-preview-resize";
            grip.setAttribute("role", "separator");
            grip.title =
              "Drag up/down to change video height; double-click for Auto height";
            grip.addEventListener("pointerdown", (event) => {
              if (event.button !== 0) return;
              const startY = event.clientY;
              const initial =
                heightPx || picture.getBoundingClientRect().height || 180;
              grip.setPointerCapture(event.pointerId);
              const move = (e) => {
                heightPx = Math.round(
                  Math.max(90, Math.min(800, initial + e.clientY - startY)),
                );
                fitPicture();
              };
              const end = () => {
                grip.removeEventListener("pointermove", move);
                grip.removeEventListener("lostpointercapture", end);
                Services.prefs.setIntPref(HEIGHT_PREF, heightPx);
                injectSetting();
              };
              grip.addEventListener("pointermove", move);
              grip.addEventListener("lostpointercapture", end);
              event.preventDefault();
            });
            grip.addEventListener("dblclick", () => {
              setAutoHeight();
            });
            const hideButton = document.createElement("button");
            hideButton.type = "button";
            hideButton.className = "zentral-video-preview-hide";
            hideButton.addEventListener("click", () =>
              setVideoHidden(!videoHidden),
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
                Services.prefs.setStringPref(FRAMING_PREF, "contain");
                cropStates.clear();
                if (current?.data) {
                  delete current.data.displayWidth;
                  delete current.data.displayHeight;
                }
                fitPicture();
                nextStillCapture = 0;
                if (LIVE_MODES.includes(previewMode)) resetRendering();
                paint();
                refreshCard();
                injectSetting();
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
              Services.prefs.setStringPref(FRAMING_PREF, "auto");
              if (current)
                cropStates.set(sourceKey(current), { checkNow: true });
              if (current?.data) {
                delete current.data.displayWidth;
                delete current.data.displayHeight;
              }
              fitPicture();
              nextStillCapture = 0;
              if (LIVE_MODES.includes(previewMode)) resetRendering();
              paint();
              refreshCard();
              injectSetting();
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
            box.append(
              sourceList,
              sourceCapabilities,
              picture,
              grip,
              seekBar,
              bar,
            );
            bar.style.cssText =
              "display:flex!important;flex:0 0 auto!important;flex-wrap:nowrap!important;align-items:center!important;gap:2px!important;width:100%!important;min-width:0!important;height:auto!important;max-height:none!important;box-sizing:border-box!important;overflow:hidden!important";
            caption.style.cssText =
              "flex:1 999 auto!important;min-width:0!important;overflow:hidden!important;white-space:nowrap!important;text-overflow:ellipsis!important";
            for (const button of bar.querySelectorAll("button")) {
              button.style.cssText =
                "position:static!important;inset:auto!important;transform:none!important;float:none!important;box-sizing:border-box!important;flex:0 1 26px!important;width:26px!important;min-width:18px!important;max-width:26px!important;height:26px!important;min-height:26px!important;max-height:26px!important;margin:0!important;padding:0!important;overflow:hidden!important;align-items:center!important;justify-content:center!important;color:white!important";
            }
            box._nextButton = next;
            box._openButton = open;
            box._grip = grip;
            box._hideButton = hideButton;
            box._autoButton = autoButton;
            box._framingButton = framingButton;
            box._pinButton = pinButton;
            box._compactButton = compactButton;
          }
          const attached =
            box.parentNode !== controls.parentNode ||
            box.previousSibling !== controls;
          if (attached) controls.after(box);
          if (
            !visibilityObserver &&
            typeof IntersectionObserver === "function"
          ) {
            try {
              visibilityObserver = new IntersectionObserver((entries) => {
                if (entries[0]?.isIntersecting) wakePaint();
                else if (featureOn(IDLE_TIMER_PREF)) updatePaintTimer(false);
              });
              visibilityObserver.observe(box);
            } catch (_) {
              visibilityObserver?.disconnect();
              visibilityObserver = null;
            }
          }
          // The first scan can finish before Zen creates a visible sidebar anchor.
          // A later mount must reveal and populate the card on its own.
          if (attached) {
            if (current) select(current, true, previewAutoSelected);
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

        function sameSource(a, b) {
          return !!(
            a &&
            b &&
            a.browser === b.browser &&
            a.method === b.method &&
            a.data.frameId === b.data.frameId &&
            a.data.documentId === b.data.documentId &&
            a.data.id === b.data.id &&
            a.data.currentSrc === b.data.currentSrc
          );
        }

        function canOpenSourceTab(source) {
          const tab = source?.tab;
          return !!(
            source?.data?.kind === "video" &&
            !source.panel &&
            tab?.isConnected &&
            !tab.closing &&
            source.browser?.isConnected &&
            tab.linkedBrowser === source.browser &&
            !source.browser.hasAttribute?.("bgalazka-addon-host-browser") &&
            !source.browser._bgalazkaAppId &&
            !tab.hasAttribute?.("bgalazka-addon-host") &&
            !tab.hasAttribute?.("bgalazka-addon-host-fallback") &&
            !tab.closest?.(
              "#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']",
            )
          );
        }

        function rememberedSource(candidates, remembered) {
          if (!remembered) return null;
          const fromBrowser = candidates.filter(
            (item) =>
              item.browser === remembered.browser && item.data.kind === "video",
          );
          return (
            fromBrowser.find(
              (item) =>
                item.method === remembered.method &&
                item.data.frameId === remembered.frameId &&
                item.data.documentId === remembered.documentId &&
                item.data.id === remembered.id,
            ) ||
            (remembered.documentId &&
            fromBrowser.length === 1 &&
            fromBrowser[0].data.documentId === remembered.documentId
              ? fromBrowser[0]
              : null)
          );
        }

        function sourceLabel(source) {
          const host = source.panel
            ? source.browser._bgalazkaAppId || "Panel"
            : source.tab?.label || "Tab";
          const size = ` · ${source.data.width}×${source.data.height}`;
          return `${source.data.paused ? "Paused" : "Playing"}${source.data.muted ? " · muted" : ""} · ${host} · ${source.data.label}${size} · #${source.data.id}`;
        }

        function sourceKey(source) {
          if (!source) return "";
          return (
            `${source.browser.browsingContext?.id}:${source.data.frameId || 0}:` +
            `${source.data.documentId || 0}:${source.data.id}:${source.method}:` +
            `${source.data.currentSrc || ""}`
          );
        }

        function hiddenByLayout(element) {
          // getBoundingClientRect alone is insufficient: hidden tabs and panels can
          // retain the exact same rectangle as the visible browser.
          if (!element?.isConnected) return false;
          for (let node = element; node; node = node.parentElement) {
            if (node.hidden || node.collapsed) return true;
            const style = getComputedStyle(node);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.visibility === "collapse" ||
              style.opacity === "0"
            )
              return true;
          }
          const rect = element.getBoundingClientRect?.();
          if (!rect) return false;
          return (
            rect.width < 1 ||
            rect.height < 1 ||
            rect.right <= 0 ||
            rect.bottom <= 0 ||
            rect.left >= window.innerWidth ||
            rect.top >= window.innerHeight
          );
        }

        function sourceCertainlyHidden(source) {
          if (!source?.browser?.isConnected) return false;
          if (source.panel) {
            // A closed panel flag can precede the end of its exit animation. Demand
            // both the closed state and proof that the panel root is off screen.
            if (
              document.documentElement.getAttribute(
                "zentral-app-panel-open",
              ) === "true" ||
              window.Zentral?.Apps?.isPanelOpen?.()
            )
              return false;
            const root = source.browser.closest?.(
              "#zen-app-panel-root, #bgalazka-super-panel",
            );
            return !!root && hiddenByLayout(root);
          }
          if (
            !source.tab?.isConnected ||
            source.tab.closing ||
            source.tab.linkedBrowser !== source.browser ||
            source.tab === gBrowser.selectedTab
          )
            return false;
          // Zen can retain an on-screen rectangle for an inactive tab browser.
          // Check tab selection instead; a second selected pane also remains visible.
          if (gBrowser.selectedTabs?.includes?.(source.tab)) return false;
          return true;
        }

        function filterMutedDuplicates(candidates) {
          if (!hideMutedDuplicates()) return candidates;
          const norm = (source) =>
            String(source.data.label || "")
              .trim()
              .toLocaleLowerCase();
          return candidates.filter((source) => {
            if (source.data.kind !== "video" || !source.data.muted) return true;
            const label = norm(source);
            if (label.length < 8) return true;
            return !candidates.some(
              (other) =>
                other !== source &&
                other.browser === source.browser &&
                other.data.kind === "video" &&
                !other.data.muted &&
                norm(other) === label &&
                (!source.data.duration ||
                  !other.data.duration ||
                  Math.abs(source.data.duration - other.data.duration) < 3),
            );
          });
        }

        function unavailableReason(mode, source = current) {
          if (experimentalBridgeDisabled() && LIVE_MODES.includes(mode))
            return "Experimental Video Bridge disabled in settings";
          if (!source || source.data.kind !== "video")
            return "Choose a video source";
          const failures = unavailableBySource.get(sourceKey(source));
          if (failures?.has(mode)) {
            const failure = failures.get(mode);
            if (Date.now() < failure.until)
              return `${failure.reason}; retry in ${Math.ceil((failure.until - Date.now()) / 1000)}s`;
            failures.delete(mode);
            failedRenderers.delete(mode);
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
          const key = sourceKey(source);
          if (!unavailableBySource.has(key))
            unavailableBySource.set(key, new Map());
          unavailableBySource.get(key).set(mode, {
            reason: String(error).slice(0, 100),
            until: Date.now() + 30000,
          });
        }

        function refreshRendererOptions() {
          const picker = document.getElementById("zs-video-preview-renderer");
          if (picker) {
            for (const option of picker.options) {
              const reason =
                option.value === "auto" ? "" : unavailableReason(option.value);
              option.disabled = !!reason;
              option.title = reason || "Available for selected source";
            }
            picker.value = rendererChoice();
            picker.title =
              unavailableReason(rendererChoice()) || "Preview renderer";
          }
          const discoveryPicker = document.getElementById(
            "zs-video-preview-discovery",
          );
          if (discoveryPicker) {
            const actorOption = [...discoveryPicker.options].find(
              (option) => option.value === "actor",
            );
            if (actorOption) {
              actorOption.disabled = experimentalBridgeDisabled();
              actorOption.title = experimentalBridgeDisabled()
                ? "Experimental Video Bridge disabled in settings"
                : "Actor discovery (experimental)";
            }
            discoveryPicker.value = discoveryChoice();
          }
          const availability = document.getElementById(
            "zs-video-preview-availability",
          );
          if (availability)
            availability.textContent = !current
              ? "Select a video to see usable modes."
              : RENDER_MODES.map((mode) => {
                  const reason = unavailableReason(mode);
                  return `${mode}: ${reason || "available"}`;
                }).join("\n");
          if (sourceCapabilities) {
            const eligible = RENDER_MODES.filter(
              (mode) => !unavailableReason(mode),
            );
            sourceCapabilities.textContent =
              current?.data.kind === "video"
                ? `Available: ${eligible.length ? eligible.join(", ") : "none (open Video Cloning settings)"}`
                : "";
          }
        }

        function renderOptions(list) {
          if (!list) return;
          const previous = list.value;
          const fragment = document.createDocumentFragment();
          for (const source of sources) {
            const option = document.createElement("option");
            option.value = sourceKey(source);
            option.textContent = sourceLabel(source);
            fragment.appendChild(option);
          }
          list.replaceChildren(fragment);
          if (
            previous &&
            [...list.options].some((option) => option.value === previous)
          )
            list.value = previous;
          else
            list.selectedIndex = sources.findIndex((item) =>
              sameSource(item, current),
            );
        }

        function renderSidebarSources() {
          if (!sourceList) return;
          const scrollTop = sourceList.scrollTop;
          const fragment = document.createDocumentFragment();
          for (const source of sources) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "zentral-video-preview-source";
            button.setAttribute("role", "option");
            button.setAttribute(
              "aria-selected",
              sameSource(source, current) ? "true" : "false",
            );
            button.textContent = sourceLabel(source);
            button.title = button.textContent;
            button.addEventListener("click", () => select(source));
            fragment.appendChild(button);
          }
          sourceList.replaceChildren(fragment);
          sourceList.scrollTop = scrollTop;
        }

        function refreshSettingList() {
          const modal = document.getElementById("zentral-settings-modal");
          renderOptions(modal?.querySelector("#zs-video-preview-sources"));
          const status = modal?.querySelector("#zs-video-preview-status");
          if (status && enabled() && !diagnostics.lastError)
            status.textContent = sources.length
              ? `${sources.length} source${sources.length === 1 ? "" : "s"} found; choose one below`
              : "On; scanning open tabs and panels for video";
          refreshRendererOptions();
          refreshMethodStatus();
        }

        function refreshCard() {
          if (!box) return;
          box.hidden = !enabled();
          box.toggleAttribute(
            "data-compact-card",
            cardCompact && featureOn(COMPACT_BUTTON_PREF),
          );
          renderSidebarSources();
          refreshRendererOptions();
          sourceList.hidden = !sources.length;
          picture.hidden = current?.data.kind !== "video" || videoHidden;
          const hasVideo = current?.data.kind === "video";
          const hideButton = box._hideButton;
          hideButton.hidden = !hasVideo || !featureOn(HIDE_BUTTON_PREF);
          hideButton.textContent = videoHidden ? "◉" : "◌";
          hideButton.title = videoHidden
            ? "Show video preview"
            : "Hide video preview";
          hideButton.setAttribute("aria-label", hideButton.title);
          hideButton.setAttribute("aria-pressed", String(videoHidden));
          box._autoButton.hidden =
            !hasVideo || !heightPx || !featureOn(AUTO_HEIGHT_BUTTON_PREF);
          box._autoButton.setAttribute(
            "aria-label",
            "Restore automatic video height",
          );
          box._framingButton.hidden = !hasVideo;
          box._framingButton.title =
            framingChoice() === "contain"
              ? "Show complete image. Click to check for black borders; hold to keep complete image"
              : "Check black borders again; hold to show complete image";
          box._framingButton.setAttribute(
            "aria-label",
            box._framingButton.title,
          );
          box._framingButton.setAttribute(
            "aria-pressed",
            String(framingChoice() === "contain"),
          );
          box._pinButton.hidden =
            !featureOn(PIN_BUTTON_PREF) || (!hasVideo && !pinnedSource);
          box._pinButton.title = pinnedSource
            ? "Unpin source"
            : "Pin this source";
          box._pinButton.setAttribute("aria-label", box._pinButton.title);
          box._pinButton.setAttribute("aria-pressed", String(!!pinnedSource));
          box._compactButton.hidden = !featureOn(COMPACT_BUTTON_PREF);
          setButtonIcon(box._compactButton, cardCompact ? "expand" : "compact");
          box._compactButton.title = cardCompact
            ? "Expand video card"
            : "Compact video card";
          box._compactButton.setAttribute(
            "aria-label",
            box._compactButton.title,
          );
          box._compactButton.setAttribute("aria-pressed", String(cardCompact));
          box._grip.hidden = !hasVideo || videoHidden;
          if (captionNode)
            captionNode.hidden =
              !captionText || videoHidden || !featureOn(CAPTIONS_PREF);
          seekBar.hidden = !current?.data.duration;
          controlBar.hidden = false;
          box._openButton.hidden = !canOpenSourceTab(current);
          if (!current) {
            caption.textContent = sources.length
              ? pinnedSource
                ? "Pinned source unavailable · unpin to switch"
                : "Choose a source"
              : diagnostics.lastError
                ? "Video scan error · open Video Cloning"
                : diagnostics.inspected
                  ? "No video sources found"
                  : "Scanning video sources…";
            playButton.hidden =
              muteButton.hidden =
              box._nextButton.hidden =
              box._openButton.hidden =
                true;
          } else playButton.hidden = muteButton.hidden = false;
          refreshSettingList();
        }

        async function control(action, value) {
          const source = current;
          if (!source) return;
          try {
            const payload = {
              frameId: source.data.frameId,
              id: source.data.id,
              action,
              value,
            };
            const data =
              source.method === "frame"
                ? await query(source.browser, "Control", payload)
                : source.method === "actor"
                  ? await source.context.currentWindowGlobal
                      .getActor(ACTOR)
                      .sendQuery("Control", payload)
                  : directControl(source.element, action, value);
            if (!disposed && data && sameSource(source, current)) {
              Object.assign(source.data, data);
              showState();
            }
          } catch (_) {
            /* The source navigated before the control arrived. */
          }
        }

        function directControl(media, action, value) {
          if (!media?.isConnected) return null;
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

        function showState() {
          if (!current || !box) return;
          const data = current.data;
          fitPicture();
          picture.hidden = data.kind !== "video" || videoHidden;
          playButton.textContent = data.paused ? "▶" : "❚❚";
          muteButton.textContent = data.muted ? "🔇" : "♪";
          seekBar.hidden = !data.duration;
          if (data.duration && document.activeElement !== seekBar)
            seekBar.value = String(
              Math.round((1000 * data.currentTime) / data.duration),
            );
        }

        function select(source, force = false, automatic = false) {
          if (!source?.browser?.isConnected) return;
          const changed = !sameSource(current, source) || force;
          if (changed && !automatic) compactResumeSource = null;
          if (pinnedSource && !automatic)
            pinnedSource = {
              browser: source.browser,
              frameId: source.data.frameId,
              id: source.data.id,
            };
          if (changed) previewAutoSelected = automatic;
          if (changed && canvas) {
            clearCaptionWatch();
            setCaption("");
            adaptiveWidth = slowCaptures = fastCaptures = 0;
            captureWorkMs = 0;
            nextStillCapture = 0;
            canvas.width = 1;
            canvas.height = 1;
          }
          if (framingChoice() === "auto") {
            const saved = cropStates.get(sourceKey(source));
            if (saved?.checked) {
              source.data.displayWidth = saved.displayWidth;
              source.data.displayHeight = saved.displayHeight;
            }
          }
          current = source;
          mount();
          if (!box?.isConnected) return;
          box.hidden = false;
          caption.textContent = source.panel
            ? source.browser.contentTitle ||
              source.browser._bgalazkaAppId ||
              "Panel media"
            : source.tab?.label || "Playing video";
          caption.title = caption.textContent;
          box._nextButton.hidden = sources.length < 2;
          box._openButton.hidden = !canOpenSourceTab(source);
          showState();
          refreshCard();
          if (changed) {
            resetRendering();
            refreshCaption();
            if (source.data.kind === "video") paint();
          }
        }

        function contexts(root) {
          const result = [];
          const visit = (context) => {
            if (!context) return;
            result.push(context);
            for (const child of context.children || []) visit(child);
          };
          visit(root);
          return result;
        }

        function hasVideoAudioTrack(media) {
          // Track presence is independent of the viewer\'s mute and volume choices.
          try {
            if (media.srcObject?.getAudioTracks)
              return media.srcObject.getAudioTracks().length > 0;
            if (media.audioTracks) return media.audioTracks.length > 0;
            const key = media.currentSrc || media.src || "";
            const cached = audioProbeCache.get(media);
            if (
              featureOn(AUDIO_CACHE_PREF) &&
              cached?.key === key &&
              Date.now() - cached.at < 30000
            )
              return cached.hasAudio;
            const capture = media.captureStream || media.mozCaptureStream;
            if (typeof capture !== "function") return false;
            const stream = capture.call(media);
            const hasAudio = stream.getAudioTracks().length > 0;
            for (const track of stream.getTracks()) track.stop();
            if (featureOn(AUDIO_CACHE_PREF))
              audioProbeCache.set(media, { key, at: Date.now(), hasAudio });
            return hasAudio;
          } catch (_) {
            return false;
          }
        }

        function inspectDirect(item) {
          const { browser, tab, panel } = item;
          const doc = browser.contentDocument;
          if (!doc?.defaultView) {
            if (!methodState.direct.startsWith("working"))
              methodState.direct = "remote document (unavailable)";
            return [];
          }
          const win = doc.defaultView;
          const found = [];
          for (const media of doc.querySelectorAll("video")) {
            if (media.ended || media.readyState < 1) continue;
            if (media.localName !== "video") continue;
            const rect = media.getBoundingClientRect();
            const x = Math.max(0, rect.left),
              y = Math.max(0, rect.top);
            const width = Math.min(win.innerWidth, rect.right) - x;
            const height = Math.min(win.innerHeight, rect.bottom) - y;
            if (
              media.videoWidth < 240 ||
              media.videoHeight < 135 ||
              (Number.isFinite(media.duration) &&
                media.duration > 0 &&
                media.duration < 8) ||
              (requireAudio() && !hasVideoAudioTrack(media))
            )
              continue;
            let id = directIds.get(media);
            if (!id) {
              id = ++nextDirectId;
              directIds.set(media, id);
            }
            let videoRef = null;
            try {
              videoRef = ChromeUtils.importESModule(
                "resource://gre/modules/ContentDOMReference.sys.mjs",
              ).ContentDOMReference.get(media);
            } catch (_) {}
            found.push({
              ...item,
              method: "direct",
              context: browser.browsingContext,
              element: media,
              data: {
                id,
                videoRef,
                frameId: 0,
                kind: "video",
                canClone: typeof media.cloneElementVisually === "function",
                canStream:
                  typeof (media.captureStream || media.mozCaptureStream) ===
                  "function",
                canCanvasStream:
                  typeof doc.createElement("canvas").captureStream ===
                  "function",
                label: String(
                  media.getAttribute("aria-label") ||
                    media.getAttribute("title") ||
                    doc.title ||
                    "Video",
                ).slice(0, 100),
                rect: width > 0 && height > 0 ? { x, y, width, height } : null,
                score:
                  (media.paused ? 0 : 10000000) +
                  Math.max(0, width) * Math.max(0, height),
                paused: media.paused,
                muted: media.muted,
                currentTime: media.currentTime,
                duration: Number.isFinite(media.duration) ? media.duration : 0,
                currentSrc: media.currentSrc || "",
                width: media.videoWidth || 0,
                height: media.videoHeight || 0,
              },
            });
          }
          methodState.direct = "working (document accessible)";
          return found;
        }

        async function inspectActor(item) {
          if (experimentalBridgeDisabled() || !ensureActor()) return [];
          const groups = await Promise.all(
            contexts(item.browser.browsingContext).map(async (context) => {
              try {
                const global = context.currentWindowGlobal;
                const scheme = global?.documentURI?.scheme;
                if (
                  !global ||
                  (scheme &&
                    !["http", "https", "file", "moz-extension"].includes(
                      scheme,
                    ))
                )
                  return [];
                const candidates = await limited(
                  global.getActor(ACTOR).sendQuery("List", {
                    requireAudio: requireAudio(),
                    cacheAudio: featureOn(AUDIO_CACHE_PREF),
                  }),
                  2500,
                  "actor reply",
                );
                methodState.actor = "working (content replied)";
                return (candidates || []).map((data) => ({
                  ...item,
                  method: "actor",
                  context,
                  data: { ...data, frameId: context.id },
                }));
              } catch (error) {
                methodError("actor", error);
                return [];
              }
            }),
          );
          return groups.flat();
        }

        async function inspectFrame(item) {
          try {
            const candidates = await query(item.browser, "List", {
              requireAudio: requireAudio(),
              cacheAudio: featureOn(AUDIO_CACHE_PREF),
            });
            const frames = contexts(item.browser.browsingContext);
            return (candidates || []).flatMap((data) => {
              const context =
                frames.find((entry) => entry.id === data.frameId) ||
                (data.frameId ? null : item.browser.browsingContext);
              return context
                ? [{ ...item, method: "frame", context, data }]
                : [];
            });
          } catch (error) {
            methodError("frame", error);
            return [];
          }
        }

        async function inspectBrowser(item, probeNewBrowser = false) {
          if (!item.browser?.browsingContext || item.tab?.closing) return [];
          const generation = scanGeneration;
          diagnostics.inspected++;
          const choice = discoveryChoice();
          const locked =
            choice === "auto"
              ? discoveryLocks.get(item.browser) ||
                (probeNewBrowser ? null : discoveryWinner)
              : choice;
          const permittedLock =
            experimentalBridgeDisabled() && locked === "actor" ? null : locked;
          const run = async (method) => {
            metrics.discoveryCalls++;
            try {
              const found = await {
                frame: inspectFrame,
                actor: inspectActor,
                direct: inspectDirect,
              }[method](item);
              // Legacy bridge replies may still include audio. Only video may lock
              // automatic discovery, otherwise an audio-only panel blocks fallbacks.
              return found.filter((source) => source.data?.kind === "video");
            } catch (error) {
              methodError(method, error);
              return [];
            }
          };
          let groups = {};
          if (permittedLock) groups[permittedLock] = await run(permittedLock);
          if (
            choice === "auto" &&
            (!permittedLock || !groups[permittedLock].length)
          ) {
            discoveryLocks.delete(item.browser);
            const methods = (
              experimentalBridgeDisabled()
                ? ["frame", "direct"]
                : ["frame", "actor", "direct"]
            ).filter((method) => method !== permittedLock);
            await Promise.all(
              methods.map(async (method) => {
                groups[method] = await run(method);
              }),
            );
          }
          if (disposed || !enabled() || generation !== scanGeneration)
            return [];
          const winner =
            choice === "auto"
              ? [
                  permittedLock,
                  "frame",
                  ...(experimentalBridgeDisabled() ? [] : ["actor"]),
                  "direct",
                ].find((method) => groups[method]?.length)
              : choice;
          if (winner && groups[winner]?.length)
            discoveryLocks.set(item.browser, winner);
          browserReports.set(item.browser, {
            browser: item.browser,
            label:
              `${item.panel ? "Panel" : "Tab"} ${item.tab?.label || item.browser.contentTitle || "(untitled)"}`.slice(
                0,
                100,
              ),
            frame: groups.frame?.length ?? "standby",
            actor: groups.actor?.length ?? "standby",
            direct: groups.direct?.length ?? "standby",
          });
          return (groups[winner] || []).filter(
            (source) => source.data?.kind === "video",
          );
        }

        function queueDiscovery(browser) {
          if (disposed || !enabled() || compactPaused) return;
          if (browser) dirtyBrowsers.add(browser);
          queuedDiscovery = true;
          if (scanning || discoveryWakeTimer) return;
          discoveryWakeTimer = setTimeout(() => {
            discoveryWakeTimer = null;
            if (scanning) return;
            queuedDiscovery = false;
            scan();
          }, 75);
        }

        async function scan(all = false, resumeOnly = false) {
          if (disposed || !enabled() || compactPaused || testingAll) return;
          if (scanning) {
            if (all) queuedFullScan = true;
            return;
          }
          scanning = true;
          const scanToken = ++activeScanToken;
          queuedDiscovery = false;
          const scanStarted = Date.now();
          metrics.scans++;
          const generation = ++scanGeneration;
          try {
            mount();
            const items = Array.from(gBrowser.tabs)
              .filter((tab) => !tab.closing)
              .map((tab) => ({
                tab,
                browser: tab.linkedBrowser,
                panel: !!(
                  tab.hasAttribute("bgalazka-addon-host") ||
                  tab.hasAttribute("bgalazka-addon-host-fallback") ||
                  tab.closest(
                    "#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']",
                  ) ||
                  tab.linkedBrowser?.hasAttribute?.(
                    "bgalazka-addon-host-browser",
                  ) ||
                  tab.linkedBrowser?._bgalazkaAppId
                ),
              }));
            // Zentral's floating panels are standalone <browser>s, invisible to the
            // native Zen media toolbar. Include them without changing that toolbar.
            const known = new Set(items.map((item) => item.browser));
            for (const browser of document.querySelectorAll(
              "#zen-app-panel-slider browser, #bgalazka-super-panel browser",
            )) {
              if (!known.has(browser)) {
                known.add(browser);
                items.push({ browser, tab: null, panel: true });
              } else {
                const item = items.find((entry) => entry.browser === browser);
                if (item) item.panel = true;
              }
            }
            for (const browser of browserReports.keys())
              if (!known.has(browser)) {
                browserReports.delete(browser);
                discoveryLocks.delete(browser);
              }
            for (const browser of discoveryCache.keys())
              if (!known.has(browser)) discoveryCache.delete(browser);
            for (const browser of dirtyBrowsers)
              if (!known.has(browser)) dirtyBrowsers.delete(browser);
            for (const key of unavailableBySource.keys())
              if (!sources.some((source) => sourceKey(source) === key))
                unavailableBySource.delete(key);
            for (const browser of bridges.keys())
              if (!known.has(browser) && browser !== previewBrowser)
                releaseBridge(browser);
            if (!items.length) {
              discoveryWinner = null;
              sources = [];
              current = null;
              resetRendering();
              refreshCard();
              return;
            }
            // Check the current video each pass; rotate through the other tabs in
            // bounded batches so hundreds of open tabs never stall the chrome UI.
            const batch = [];
            const active =
              items.find(
                (item) =>
                  item.browser ===
                  (compactResumeSource?.browser || current?.browser),
              ) ||
              (resumeOnly
                ? items.find((item) => item.tab?.soundPlaying)
                : null);
            if (active) batch.push(active);
            const selectedItem = items.find(
              (item) => item.tab === gBrowser.selectedTab,
            );
            if (
              selectedItem &&
              dirtyBrowsers.has(selectedItem.browser) &&
              !batch.includes(selectedItem)
            )
              batch.push(selectedItem);
            for (const item of items)
              if (dirtyBrowsers.has(item.browser) && !batch.includes(item))
                batch.push(item);
            if (!resumeOnly || !active) {
              const focused = items.find(
                (item) => item.tab === gBrowser.selectedTab,
              );
              if (focused && !batch.includes(focused)) batch.push(focused);
              for (const panelItem of items
                .filter((item) => item.panel)
                .slice(0, 4))
                if (!batch.includes(panelItem)) batch.push(panelItem);
              for (
                let i = 0;
                i < Math.min(all ? items.length : 12, items.length);
                i++
              ) {
                const item = items[(scanCursor + i) % items.length];
                if (!batch.includes(item)) batch.push(item);
              }
              scanCursor =
                (scanCursor + (all ? items.length : 12)) % items.length;
            }
            const now = Date.now();
            const found = (
              await Promise.all(
                batch.map(async (item) => {
                  const browser = item.browser;
                  const wasDirty = dirtyBrowsers.delete(browser);
                  const cached = discoveryCache.get(browser);
                  const global = browser?.browsingContext?.currentWindowGlobal;
                  const cacheAgeLimit = cached?.sources.length
                    ? DISCOVERY_CACHE_MS
                    : EMPTY_DISCOVERY_CACHE_MS;
                  if (
                    !all &&
                    !wasDirty &&
                    cached &&
                    cached.global === global &&
                    now - cached.at < cacheAgeLimit
                  ) {
                    metrics.discoveryCacheHits++;
                    return cached.sources.map((source) => ({
                      ...source,
                      tab: item.tab,
                      panel: item.panel,
                    }));
                  }
                  if (wasDirty) metrics.dirtyInspections++;
                  if (cached && cached.global !== global)
                    discoveryLocks.delete(browser);
                  // A newly selected browser can use a different discovery method
                  // from the pinned/current one; probe its methods concurrently.
                  const result = await inspectBrowser(
                    item,
                    wasDirty &&
                      browser === selectedItem?.browser &&
                      !discoveryLocks.has(browser),
                  );
                  if (
                    generation === scanGeneration &&
                    !dirtyBrowsers.has(browser)
                  )
                    discoveryCache.set(browser, {
                      global,
                      at: Date.now(),
                      sources: result,
                    });
                  return result;
                }),
              )
            ).flat();
            if (disposed || generation !== scanGeneration) return;
            diagnostics.found = found.length;
            if (found.length) diagnostics.lastError = "";
            diagnostics.phase = found.length
              ? "source found"
              : "scanning (no video found in this batch)";
            const batchBrowsers = new Set(batch.map((item) => item.browser));
            sources = sources.filter(
              (item) =>
                !batchBrowsers.has(item.browser) &&
                items.some((entry) => entry.browser === item.browser),
            );
            sources.push(...found);
            sources = filterMutedDuplicates(sources);
            const activeKeys = new Set(sources.map(sourceKey));
            for (const key of unavailableBySource.keys())
              if (!activeKeys.has(key)) unavailableBySource.delete(key);
            for (const key of cropStates.keys())
              if (!activeKeys.has(key)) cropStates.delete(key);
            sources.sort((a, b) => b.data.score - a.data.score);
            if (discoveryChoice() === "auto")
              discoveryWinner =
                sources.find((item) => item.data.kind === "video")?.method ||
                null;
            const remembered = compactResumeSource;
            if (remembered) {
              const restored = rememberedSource(sources, remembered);
              if (restored) {
                compactResumeSource = null;
                select(restored, false, remembered.autoSelected);
              } else if (
                !remembered.browser.isConnected ||
                Date.now() - remembered.at > 15000
              )
                compactResumeSource = null;
            }
            const stillPlaying = sources.find((item) =>
              sameSource(item, current),
            );
            if (pinnedSource && !pinnedSource.browser?.isConnected)
              pinnedSource = null;
            let pinnedMatch =
              pinnedSource &&
              sources.find(
                (item) =>
                  item.browser === pinnedSource.browser &&
                  item.data.frameId === pinnedSource.frameId &&
                  item.data.id === pinnedSource.id,
              );
            if (!pinnedMatch && pinnedSource) {
              const sameFrame = sources.filter(
                (item) =>
                  item.browser === pinnedSource.browser &&
                  item.data.frameId === pinnedSource.frameId,
              );
              if (sameFrame.length === 1) {
                pinnedMatch = sameFrame[0];
                pinnedSource.id = pinnedMatch.data.id;
              }
            }
            // Playback may start after TabSelect's scan. Prefer the selected
            // playing tab on each pass, while honoring manual and pinned choices.
            const selectedPlaying =
              autoShowVideo() &&
              selectedItem &&
              sources.find(
                (source) =>
                  source.browser === selectedItem.browser &&
                  source.data.kind === "video" &&
                  !source.data.paused,
              );
            if (pinnedMatch) select(pinnedMatch, false, true);
            else if (pinnedSource) {
              current = null;
              resetRendering();
            } else if (selectedPlaying && (previewAutoSelected || !current))
              select(selectedPlaying, false, true);
            else if (stillPlaying) select(stillPlaying);
            else {
              current = null;
              previewAutoSelected = false;
              resetRendering();
              const choice = rendererChoice();
              if (
                autoShowVideo() &&
                ["auto", "canvas", "snapshot"].includes(choice)
              ) {
                const candidate = sources.find(
                  (source) =>
                    source.data.kind === "video" &&
                    !source.data.paused &&
                    (choice !== "snapshot" || source.data.rect),
                );
                if (candidate) select(candidate, false, true);
              }
            }
            refreshCard();
          } catch (error) {
            recordError(error);
            refreshCard();
          } finally {
            if (scanToken === activeScanToken) {
              scanning = false;
              metrics.lastScanMs = Date.now() - scanStarted;
              if (queuedFullScan) {
                queuedFullScan = false;
                setTimeout(() => scan(true), 0);
              } else if (queuedDiscovery || dirtyBrowsers.size) {
                queueDiscovery();
              }
            }
          }
        }

        function limited(promise, milliseconds, label) {
          return new Promise((resolve, reject) => {
            let done = false;
            const timer = setTimeout(() => {
              done = true;
              reject(new Error(label + " timed out"));
            }, milliseconds);
            Promise.resolve(promise).then(
              (value) => {
                if (done) {
                  value?.close?.();
                  return;
                }
                done = true;
                clearTimeout(timer);
                resolve(value);
              },
              (error) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                reject(error);
              },
            );
          });
        }

        function disposePlayer(browser = previewBrowser) {
          if (!browser) return;
          if (["native", "stream"].includes(browser._zvpMode)) {
            try {
              browser.browsingContext?.currentWindowGlobal
                ?.getActor(ACTOR)
                .sendAsyncMessage("StopPreview");
            } catch (_) {}
          }
          releaseBridge(browser);
          browser.remove();
          if (previewBrowser === browser) previewBrowser = null;
        }

        function resetRendering() {
          nextStillCapture = 0;
          ++previewGeneration;
          disposePlayer();
          previewMode = null;
          updatePaintTimer();
          noPictureChecks = 0;
          failedRenderers.clear();
          nextRenderProbe = nextHealthCheck = 0;
          lastHealth = null;
          canvas?.style.removeProperty("display");
        }

        async function playerQuery(browser, mode, kind, data = {}) {
          if (mode === "native" || mode === "stream") {
            if (!ensureActor())
              throw new Error("Experimental actor unavailable");
            return limited(
              browser.browsingContext.currentWindowGlobal
                .getActor(ACTOR)
                .sendQuery(kind, data),
              kind === "Preview" ? 4500 : 1500,
              mode + " " + kind,
            );
          }
          return query(browser, kind, {
            ...data,
            frameId: browser.browsingContext.id,
          });
        }

        async function startLivePreview(
          source,
          mode,
          generation,
          diagnostic = false,
        ) {
          const reason = unavailableReason(mode, source);
          if (reason && (!diagnostic || experimentalBridgeDisabled()))
            throw new Error(reason);
          if (!source.data.videoRef)
            throw new Error("No content video reference; refresh sources");
          const global = source.context.currentWindowGlobal;
          const browser = document.createXULElement("browser");
          browser._zvpMode = mode;
          browser.setAttribute("class", "zentral-video-preview-player");
          browser.setAttribute("type", "content");
          browser.setAttribute("remote", "true");
          browser.setAttribute("nodefaultsrc", "true");
          // ContentDOMReference can only resolve the source in its own process.
          browser.sameProcessAsFrameLoader = source.browser.frameLoader;
          browser.setAttribute("remoteType", global.domProcess.remoteType);
          browser.setAttribute(
            "initialBrowsingContextGroupId",
            global.browsingContext.group.id,
          );
          const container = source.browser.getAttribute("usercontextid");
          if (container) browser.setAttribute("usercontextid", container);
          browser.setAttribute("tabindex", "-1");
          browser.style.setProperty("opacity", "0", "important");
          picture.appendChild(browser);
          previewBrowser = browser;
          try {
            browser.loadURI(Services.io.newURI("about:blank"), {
              triggeringPrincipal:
                Services.scriptSecurityManager.getSystemPrincipal(),
            });
          } catch (error) {
            disposePlayer(browser);
            throw new Error("Preview document load failed: " + error);
          }
          try {
            browser.docShellIsActive = true;
          } catch (_) {}
          try {
            for (
              let i = 0;
              i < 40 && !browser.browsingContext?.currentWindowGlobal;
              i++
            ) {
              if (disposed || generation !== previewGeneration)
                throw new Error("Preview cancelled");
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            if (!browser.browsingContext?.currentWindowGlobal)
              throw new Error("Preview process did not start");
            try {
              browser.docShellIsActive = true;
            } catch (_) {}
            const result = await playerQuery(browser, mode, "Preview", {
              videoRef: source.data.videoRef,
              mode: mode.replace("frame-", ""),
              fit: framingChoice() === "contain" ? "contain" : "cover",
            });
            if (!result?.ok) throw new Error("Preview did not confirm startup");
            if (disposed || generation !== previewGeneration)
              throw new Error("Preview cancelled");
            // Keep the old canvas above the browser until actual video pixels show.
            try {
              browser.docShellIsActive = true;
            } catch (_) {}
            browser.style.removeProperty("opacity");
            const health = await playerQuery(browser, mode, "Health");
            if (!health?.ok)
              throw new Error(
                health?.error || "Live preview did not become ready",
              );
            if (generation !== previewGeneration)
              throw new Error("Preview cancelled");
            canvas.style.setProperty("display", "none", "important");
          } catch (error) {
            disposePlayer(browser);
            throw error;
          }
        }

        async function captureVideo(source) {
          const startedAt = performance.now();
          const recordTransport = (mode, bytes) => {
            metrics.bytes += bytes;
            const row = metrics.transport[mode];
            row.frames++;
            row.bytes += bytes;
            row.ms += performance.now() - startedAt;
          };
          const payload = {
            id: source.data.id,
            frameId: source.data.frameId,
            captureWidth: captureDimension(),
            binary: featureOn(BINARY_FRAMES_PREF),
            frameAware: featureOn(FRAME_AWARE_PREF),
          };
          let frame;
          const requestFrame = () =>
            source.method === "frame"
              ? query(source.browser, "Capture", payload)
              : limited(
                  source.context.currentWindowGlobal
                    .getActor(ACTOR)
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
              decodedCanvas ??= document.createElement("canvas");
              if (
                decodedCanvas.width !== frame.width ||
                decodedCanvas.height !== frame.height
              ) {
                decodedCanvas.width = frame.width;
                decodedCanvas.height = frame.height;
              }
              decodedCanvas
                .getContext("2d", { alpha: false })
                .putImageData(
                  new ImageData(pixels, frame.width, frame.height),
                  0,
                  0,
                );
              recordTransport("raw", pixels.byteLength);
              return decodedCanvas;
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
          const image = await limited(
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
          return limited(
            source.context.currentWindowGlobal.drawSnapshot(
              new DOMRect(x, y, width, height),
              Math.min(1, captureDimension() / Math.max(width, height)),
              "rgb(0, 0, 0)",
            ),
            1000,
            "snapshot",
          );
        }

        function previewVisible() {
          if (document.hidden || !box?.isConnected || box.hidden) return false;
          const rect = box.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 1 &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.top < window.innerHeight &&
            getComputedStyle(box).visibility !== "hidden"
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
            framingChoice() !== "auto" ||
            bitmap.width < 40 ||
            bitmap.height < 30
          )
            return full;
          const key = sourceKey(source);
          let state = cropStates.get(key);
          if (!state) {
            state = { startedAt: source.data.paused ? 0 : Date.now() };
            cropStates.set(key, state);
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
            if (Date.now() - state.startedAt < CROP_DELAY_MS) return full;
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
            disposed ||
            !enabled() ||
            compactPaused ||
            renderBusy ||
            testingAll
          )
            return;
          if (
            current?.data.kind !== "video" ||
            !box?.isConnected ||
            box.hidden ||
            videoHidden
          ) {
            updatePaintTimer(false);
            return;
          }
          if (!previewVisible()) {
            updatePaintTimer(false);
            lastHealth = null;
            try {
              if (previewBrowser) previewBrowser.docShellIsActive = false;
            } catch (_) {}
            return;
          }
          try {
            if (previewBrowser && !previewBrowser.docShellIsActive)
              previewBrowser.docShellIsActive = true;
          } catch (_) {}
          const source = current,
            choice = rendererChoice();
          const generation = previewGeneration;
          renderBusy = true;
          try {
            if (LIVE_MODES.includes(previewMode)) {
              if (previewMode && Date.now() < nextHealthCheck) return;
              if (previewMode) {
                nextHealthCheck = Date.now() + POLL_MS;
                try {
                  try {
                    previewBrowser.docShellIsActive = true;
                  } catch (_) {}
                  const state = await playerQuery(
                    previewBrowser,
                    previewMode,
                    "Health",
                  );
                  if (generation !== previewGeneration) return;
                  if (!state?.ok)
                    throw new Error(
                      state?.error || "Preview no longer available",
                    );
                  // The quality counter stays at zero for working clones/streams in
                  // Zen; target video-frame callbacks track presentation instead.
                  if (
                    previewMode !== "native" &&
                    previewMode !== "frame-native" &&
                    lastHealth &&
                    !state.paused &&
                    state.time > lastHealth.time + 1 &&
                    (state.presentedCallbacks || state.frames) ===
                      (lastHealth.presentedCallbacks || lastHealth.frames)
                  )
                    throw new Error("Stream stopped presenting video frames");
                  lastHealth = state;
                  return;
                } catch (error) {
                  if (generation !== previewGeneration) return;
                  methodError(previewMode, error);
                  failedRenderers.add(previewMode);
                  markUnavailable(source, previewMode, error);
                  disposePlayer();
                  previewMode = null;
                  canvas.style.removeProperty("display");
                  nextRenderProbe = Date.now() + POLL_MS;
                  return;
                }
              }
            }
            if (!previewMode && Date.now() < nextRenderProbe) return;
            if (
              WORKING_MODES.includes(previewMode) &&
              Date.now() < nextStillCapture
            )
              return;
            const modes = previewMode
              ? [previewMode]
              : choice === "auto"
                ? (experimentalBridgeDisabled()
                    ? WORKING_MODES
                    : RENDER_MODES
                  ).filter(
                    (mode) =>
                      (!previewAutoSelected || !LIVE_MODES.includes(mode)) &&
                      !unavailableReason(mode, source) &&
                      !failedRenderers.has(mode),
                  )
                : [choice];
            if (!modes.length && choice === "auto") {
              failedRenderers.clear();
              nextRenderProbe = Date.now() + POLL_MS;
              return;
            }
            for (const mode of modes) {
              if (generation !== previewGeneration || disposed) return;
              const started = Date.now();
              const workStarted = performance.now();
              let bitmap;
              try {
                if (LIVE_MODES.includes(mode))
                  await startLivePreview(source, mode, generation);
                else {
                  bitmap = await (mode === "canvas"
                    ? captureVideo(source)
                    : captureSnapshot(source));
                  if (generation !== previewGeneration) return;
                  if (!bitmap) {
                    metrics.skippedFrames++;
                    nextStillCapture = Date.now() + captureIntervalMs();
                    return;
                  }
                  const crop = detectContentRect(bitmap, source);
                  const targetWidth = Math.max(1, crop.width);
                  const targetHeight = Math.max(1, crop.height);
                  if (canvas.width !== targetWidth) canvas.width = targetWidth;
                  if (canvas.height !== targetHeight)
                    canvas.height = targetHeight;
                  canvas
                    .getContext("2d", { alpha: false })
                    .drawImage(
                      bitmap,
                      crop.x,
                      crop.y,
                      crop.width,
                      crop.height,
                      0,
                      0,
                      canvas.width,
                      canvas.height,
                    );
                  const saved = cropStates.get(sourceKey(source));
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
                    fitPicture();
                  }
                  metrics.frames++;
                  recentFrames.push(Date.now());
                  while (
                    recentFrames.length &&
                    recentFrames[0] < Date.now() - 5000
                  )
                    recentFrames.shift();
                  metrics.effectiveFps = Number(
                    (
                      recentFrames.length /
                      Math.min(
                        5,
                        Math.max(1, (Date.now() - recentFrames[0]) / 1000),
                      )
                    ).toFixed(1),
                  );
                  const workMs = performance.now() - workStarted;
                  metrics.captureMs += workMs;
                  recordCaptureDuration(workMs);
                  // Leave headroom when a capture and draw use most of a frame.
                  // Cheap captures retain the user's requested 60 fps ceiling.
                  captureWorkMs = captureWorkMs
                    ? captureWorkMs * 0.75 + workMs * 0.25
                    : workMs;
                  const budget = Math.max(
                    captureIntervalMs(),
                    captureWorkMs * 1.25,
                  );
                  nextStillCapture =
                    Date.now() + Math.max(1, Math.ceil(budget - workMs));
                }
                if (generation !== previewGeneration) return;
                previewMode = mode;
                methodState[mode] = LIVE_MODES.includes(mode)
                  ? "working (live video)"
                  : "working (frame received)";
                nextHealthCheck = Date.now() + POLL_MS;
                return;
              } catch (error) {
                metrics.failures++;
                if (generation !== previewGeneration) return;
                methodError(mode, error);
                failedRenderers.add(mode);
                if (
                  LIVE_MODES.includes(mode) &&
                  !/cancelled|source visible/i.test(String(error))
                ) {
                  markUnavailable(source, mode, error);
                }
                if (previewMode === mode) {
                  previewMode = null;
                  break;
                }
              } finally {
                bitmap?.close?.();
              }
            }
            if (
              (experimentalBridgeDisabled()
                ? WORKING_MODES
                : RENDER_MODES
              ).every((mode) => failedRenderers.has(mode))
            )
              failedRenderers.clear();
            nextRenderProbe = Date.now() + POLL_MS;
          } finally {
            renderBusy = false;
            metrics.paintMs += performance.now() - paintStarted;
            metrics.paintPasses++;
            updatePaintTimer();
            if (Date.now() - lastPaintStatusAt >= 500) {
              lastPaintStatusAt = Date.now();
              refreshMethodStatus();
            }
          }
        }

        function updatePaintTimer(active = true) {
          clearTimeout(frameTimer);
          frameTimer = null;
          if (!scanTimer || renderBusy) return;
          if (
            (!active || !current || videoHidden || !previewVisible()) &&
            featureOn(IDLE_TIMER_PREF)
          ) {
            paintTimerMs = 0;
            return;
          }
          // A single timeout is scheduled after the previous asynchronous paint.
          // Live preview health does not need 10 empty wakeups per second.
          const due =
            active && LIVE_MODES.includes(previewMode)
              ? nextHealthCheck
              : active && WORKING_MODES.includes(previewMode)
                ? nextStillCapture
                : active && nextRenderProbe
                  ? nextRenderProbe
                  : Date.now() + FRAME_MS;
          paintTimerMs = Math.max(1, due - Date.now());
          frameTimer = setTimeout(() => {
            frameTimer = null;
            metrics.paintWakeups++;
            paint();
          }, paintTimerMs);
        }

        function compactTabbarHidden() {
          if (
            !pauseWhenCompactHidden() ||
            document.documentElement.getAttribute("zen-compact-mode") !== "true"
          )
            return false;
          const tabs =
            document.getElementById("tabbrowser-tabs") || gBrowser.tabContainer;
          if (!tabs?.isConnected) return false; // Do not pause on an unknown layout.
          // A pointer entering the actual tabs is stronger evidence than a rectangle
          // or opacity sampled midway through the compact reveal animation.
          if (compactHovering) return false;
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
          clearCaptionWatch();
          clearInterval(captionTimer);
          captionTimer = null;
          setCaption("");
          if (compactPaused) return;
          compactPaused = true;
          if (current?.browser?.isConnected)
            compactResumeSource = {
              browser: current.browser,
              method: current.method,
              frameId: current.data.frameId,
              documentId: current.data.documentId,
              id: current.data.id,
              autoSelected: previewAutoSelected,
              at: Date.now(),
            };
          ++scanGeneration; // Ignore replies from a scan started before hiding.
          clearTimeout(discoveryWakeTimer);
          discoveryWakeTimer = null;
          dirtyBrowsers.clear();
          discoveryCache.clear();
          queuedDiscovery = queuedFullScan = false;
          clearTimeout(compactMountTimer);
          compactMountTimer = null;
          clearInterval(scanTimer);
          clearTimeout(frameTimer);
          clearInterval(mountTimer);
          scanTimer = frameTimer = mountTimer = null;
          paintTimerMs = 0;
          ++activeScanToken;
          scanning = false; // An old scan may still be settling after cancellation.
          resetRendering(); // Stops live renderers and cancels pending still captures.
          for (const browser of bridges.keys()) releaseBridge(browser);
          sources = [];
          current = null;
          pinnedSource = null;
          previewAutoSelected = false;
          browserReports.clear();
          discoveryLocks.clear();
          if (compactResumeSource?.browser?.isConnected)
            discoveryLocks.set(
              compactResumeSource.browser,
              compactResumeSource.method,
            );
          discoveryWinner = null;
          unavailableBySource.clear();
          if (box) box.hidden = true;
          diagnostics.phase = "paused (compact tabbar hidden)";
          refreshSettingList();
        }

        function syncCompactVisibility() {
          if (disposed) return;
          const watching =
            enabled() &&
            pauseWhenCompactHidden() &&
            document.documentElement.getAttribute("zen-compact-mode") ===
              "true";
          const hidden = watching && compactTabbarHidden();
          if (hidden) {
            if (!compactHiddenSince) compactHiddenSince = Date.now();
            // Ignore single-frame layout/opacity changes during the reveal animation.
            if (Date.now() - compactHiddenSince >= 350) pauseCompactPreview();
          } else {
            compactHiddenSince = 0;
          }
          if (!hidden && compactPaused && enabled()) {
            compactPaused = false;
            if (compactResumeSource) compactResumeSource.at = Date.now();
            start(true); // Verify the remembered or audible source first.
            refreshSettingList();
          }
          // Catch CSS-only hover reveals that do not change observed attributes.
          clearTimeout(compactCheckTimer);
          compactCheckTimer = watching
            ? setTimeout(
                syncCompactVisibility,
                compactPaused || hidden ? 100 : 500,
              )
            : null;
        }

        function stop() {
          decodedCanvas = null;
          clearCaptionWatch();
          clearTimeout(wakeTimer);
          wakeTimer = null;
          clearTimeout(discoveryWakeTimer);
          discoveryWakeTimer = null;
          dirtyBrowsers.clear();
          discoveryCache.clear();
          queuedDiscovery = queuedFullScan = false;
          clearInterval(captionTimer);
          captionTimer = null;
          setCaption("");
          ++scanGeneration;
          resetRendering();
          clearInterval(scanTimer);
          clearTimeout(frameTimer);
          clearInterval(mountTimer);
          clearTimeout(compactMountTimer);
          compactMountTimer = null;
          scanTimer = frameTimer = mountTimer = null;
          paintTimerMs = 0;
          sources = [];
          current = null;
          compactResumeSource = null;
          compactHiddenSince = 0;
          previewAutoSelected = false;
          compactPaused = false;
          ++activeScanToken;
          scanning = false;
          browserReports.clear();
          discoveryLocks.clear();
          discoveryWinner = null;
          unavailableBySource.clear();
          box?.remove();
          diagnostics.phase = "disabled";
          for (const browser of bridges.keys()) releaseBridge(browser);
          if (actorReady) {
            try {
              const windows = Services.wm.getEnumerator("navigator:browser");
              let otherRunning = false;
              while (windows.hasMoreElements()) {
                const other = windows.getNext();
                if (
                  other !== window &&
                  (other.ZentralVideoPreview?.diagnostics()?.running ||
                    other.ZentralVideoPreview?.diagnostics()?.compactPaused) &&
                  other.ZentralVideoPreview?.diagnostics()
                    ?.experimentalBridgeDisabled !== true
                )
                  otherRunning = true;
              }
              if (!otherRunning) ChromeUtils.unregisterWindowActor(ACTOR);
            } catch (_) {
              /* Another window or a prior copy may own the actor. */
            }
          }
          actorReady = actorAttempted = false;
        }
        function start(resuming = false) {
          if (disposed || !enabled() || scanTimer) return;
          if (compactTabbarHidden()) {
            pauseCompactPreview();
            return;
          }
          compactPaused = false;
          diagnostics.lastError = "";
          diagnostics.phase = "scanning";
          if (!experimentalBridgeDisabled()) ensureActor();
          mount();
          scanTimer = setInterval(scan, POLL_MS);
          paintTimerMs = 0;
          updatePaintTimer();
          captionTimer = setInterval(refreshCaption, 750);
          mountTimer = setInterval(mount, 3000);
          // A compact reveal can finish after the first mount attempt.
          compactMountTimer = setTimeout(() => {
            compactMountTimer = null;
            if (disposed || compactPaused || !enabled()) return;
            mount();
            if (current && box?.isConnected && box.hidden)
              select(current, true, previewAutoSelected);
          }, 200);
          if (resuming || compactResumeSource?.browser?.isConnected) {
            scan(false, true).then(() => {
              if (!disposed && enabled() && !compactPaused) scan();
            });
          } else {
            compactResumeSource = null;
            scan();
          }
        }
        const onPref = () => {
          if (enabled()) start();
          else stop();
          syncCompactVisibility();
          injectSetting();
        };
        const onExperimentalPref = () => {
          stop();
          methodState.actor = experimentalBridgeDisabled()
            ? "disabled in settings"
            : "waiting";
          if (enabled()) start();
          injectSetting();
        };
        const onTab = (event) => {
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
        const onRenderPref = () => {
          unavailableBySource.delete(sourceKey(current));
          const selector = document.getElementById("zs-video-preview-renderer");
          if (selector) selector.value = rendererChoice();
          resetRendering();
          if (enabled()) paint();
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
            const readInt = (pref, fallback) => {
              try {
                return Services.prefs.getIntPref(pref, fallback);
              } catch (_) {
                return fallback;
              }
            };
            heightPx = Math.max(0, Math.min(800, readInt(HEIGHT_PREF, 0)));
            radiusPx = Math.max(0, Math.min(24, readInt(RADIUS_PREF, 0)));
            widthPercent = Math.max(
              35,
              Math.min(100, readInt(WIDTH_PREF, 100)),
            );
            videoHidden = Services.prefs.getBoolPref(VIDEO_HIDDEN_PREF, false);
            cardCompact = Services.prefs.getBoolPref(COMPACT_STATE_PREF, false);
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
        const compactObserver = new MutationObserver(syncCompactVisibility);
        compactObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: [
            "zen-compact-mode",
            "zen-sidebar-hidden",
            "zen-sidebar-expanded",
          ],
        });
        const compactTabs = gBrowser.tabContainer;
        const onCompactEnter = () => {
          compactHovering = true;
          compactHiddenSince = 0;
          clearTimeout(compactLeaveTimer);
          syncCompactVisibility();
        };
        let compactLeaveTimer = null;
        const onCompactLeave = () => {
          compactHovering = false;
          clearTimeout(compactLeaveTimer);
          compactLeaveTimer = setTimeout(syncCompactVisibility, 250);
        };
        compactTabs.addEventListener("pointerenter", onCompactEnter);
        compactTabs.addEventListener("pointerleave", onCompactLeave);
        const onVisibilityWake = () => wakePaint();
        window.addEventListener("resize", onVisibilityWake);
        document.addEventListener("visibilitychange", onVisibilityWake);
        window.addEventListener("scroll", onVisibilityWake, true);
        function destroy() {
          if (disposed) return;
          disposed = true;
          changedVideoPrefs.clear();
          Services.prefs.removeObserver(videoSettingsBranch, onVideoSetting);
          compactObserver.disconnect();
          pictureObserver?.disconnect();
          pictureObserver = null;
          visibilityObserver?.disconnect();
          visibilityObserver = null;
          window.removeEventListener("resize", onVisibilityWake);
          document.removeEventListener("visibilitychange", onVisibilityWake);
          window.removeEventListener("scroll", onVisibilityWake, true);
          compactTabs.removeEventListener("pointerenter", onCompactEnter);
          compactTabs.removeEventListener("pointerleave", onCompactLeave);
          clearTimeout(compactLeaveTimer);
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
          delete window.ZentralVideoPreview;
        }
        window.ZentralVideoPreview = {
          destroy,
          refresh: scan,
          diagnostics: () => ({
            ...diagnostics,
            build: BUILD,
            methods: { ...methodState },
            enabled: enabled(),
            experimentalBridgeDisabled: experimentalBridgeDisabled(),
            renderer: previewMode,
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
