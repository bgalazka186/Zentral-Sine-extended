"use strict";

/* ============================================================================
 * ZENTRAL VIDEO PREVIEW (independent feature; safe to disable or remove)
 * Set zen.workspace.zentral.video_preview.enabled = false to disable it.
 * Sine loads this file alone. The content frame script is embedded below.
 * ============================================================================ */
(function initZentralVideoPreview() {
  if (typeof gBrowser === "undefined") return;
  // Sine can execute an updated .uc.js while an older instance still runs.
  // Shut that instance down so its actor errors cannot mask the new bridge.
  try {
    window.ZentralVideoPreview?.destroy?.();
  } catch (error) {
    console.warn("[ZentralVideoPreview] Could not stop previous build", error);
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
  const AUTO_SHOW_PREF = "zen.workspace.zentral.video_preview.auto_show_video";
  const CAPTURE_WIDTH_PREF =
    "zen.workspace.zentral.video_preview.capture_width_px";
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
  // Only frame capture and page snapshots use this cap. Keep the established
  // 480 px default; live cloning and streams use their own rendering paths.
  function captureWidth() {
    try {
      const value = Services.prefs.getIntPref(CAPTURE_WIDTH_PREF, 480);
      return [320, 480, 640].includes(value) ? value : 480;
    } catch (_) {
      return 480;
    }
  }
  const BUILD = "video-resume-2026-09-24-3";
  const FRAME_SOURCE =
    '// Loaded into each browser\'s content process through its frame message manager.\n// The channel is replaced at startup so separate browser windows stay isolated.\n(function () {\n  // Shared by actor and frame-script transports; no parent-side privileges.\nclass ZentralVideoRenderer {\n  constructor(doc) { this.doc = doc; this.serial = 0; }\n  async start({ videoRef, mode, fit = "contain" }) {\n    if (this.doc?.documentURI !== "about:blank") throw new Error("Invalid preview document");\n    this.stop();\n    const serial = this.serial;\n    const { ContentDOMReference } = ChromeUtils.importESModule(\n      "resource://gre/modules/ContentDOMReference.sys.mjs");\n    const media = await ContentDOMReference.resolve(videoRef);\n    if (serial !== this.serial) throw new Error("Preview cancelled");\n    if (!media?.isConnected || media.localName !== "video")\n      throw new Error("Video reference unavailable in preview process");\n    this.source = media;\n    const doc = this.doc, win = doc.defaultView;\n    if (!doc.body) doc.documentElement.appendChild(doc.createElement("body"));\n    doc.body.style.cssText = "margin:0;overflow:hidden;background:#000";\n    const target = doc.createElement("video");\n    target.muted = true;\n    target.autoplay = true;\n    target.style.cssText = "display:block;width:100vw;height:100vh;object-fit:" +\n      (fit === "cover" ? "cover" : "contain") + ";background:#000";\n    doc.body.appendChild(target);\n    this.video = target;\n    this.mode = mode;\n    try {\n      if (mode === "native") {\n        if (media.isCloningElementVisually) throw new Error("Source already has a visual clone");\n        if (typeof media.cloneElementVisually !== "function") throw new Error("Native cloning unavailable");\n        await media.cloneElementVisually(target);\n      } else if (mode === "stream") {\n        const capture = media.captureStream || media.mozCaptureStream;\n        if (typeof capture !== "function") throw new Error("Stream capture unavailable");\n        this.stream = capture.call(media);\n        const tracks = this.stream.getVideoTracks();\n        if (!tracks.length) throw new Error("Stream contains no video track");\n        target.srcObject = new win.MediaStream(tracks);\n        await target.play();\n        if (serial !== this.serial) throw new Error("Preview cancelled");\n        await this.firstFrame(target);\n      } else if (mode === "canvas-stream") {\n        const surface = doc.createElement("canvas");\n        surface.width = Math.min(640, media.videoWidth);\n        surface.height = Math.max(1, Math.round(surface.width * media.videoHeight / media.videoWidth));\n        const ctx = surface.getContext("2d", { alpha: false });\n        ctx.drawImage(media, 0, 0, surface.width, surface.height);\n        this.stream = surface.captureStream(30);\n        target.srcObject = this.stream;\n        // Keep all copies inside the source process. No per-frame JPEG or IPC.\n        // Use the visible preview window clock: source rVFC may stop in a hidden tab.\n        let lastTime = NaN;\n        this.timer = win.setInterval(() => {\n          if (!media.isConnected || media.ended) { this.failure = "Source ended or detached"; return; }\n          if (media.currentTime === lastTime || media.readyState < 2) return;\n          try {\n            ctx.drawImage(media, 0, 0, surface.width, surface.height);\n            lastTime = media.currentTime;\n          } catch (error) { this.failure = String(error); }\n        }, 1000 / 30);\n        await target.play();\n        if (serial !== this.serial) throw new Error("Preview cancelled");\n        await this.firstFrame(target);\n      } else throw new Error("Unknown preview mode");\n      if (serial !== this.serial) throw new Error("Preview cancelled");\n      return { ok: true, mode };\n    } catch (error) {\n      if (serial === this.serial) this.stop();\n      throw error;\n    }\n  }\n  firstFrame(target) {\n    if (target.readyState >= 2 && target.videoWidth > 0) return Promise.resolve();\n    return new Promise((resolve, reject) => {\n      const win = this.doc.defaultView;\n      const done = error => {\n        win.clearTimeout(timer);\n        target.removeEventListener("loadeddata", loaded);\n        this.cancelWait = null;\n        error ? reject(error) : resolve();\n      };\n      const loaded = () => done();\n      const timer = win.setTimeout(() => done(new Error("Stream produced no decoded frame")), 1800);\n      this.cancelWait = () => done(new Error("Preview cancelled"));\n      target.addEventListener("loadeddata", loaded, { once: true });\n    });\n  }\n  health() {\n    const tracks = this.stream?.getVideoTracks() || [];\n    return { ok: !!this.video?.isConnected && !!this.source?.isConnected && !this.failure &&\n      !this.source.ended && ((this.mode === "native" && this.source.isCloningElementVisually) ||\n        (this.video.readyState >= 2 && tracks.some(track => track.readyState !== "ended" && !track.muted))),\n      error: this.failure || "Preview disconnected or stream unavailable",\n      paused: this.source?.paused, time: this.source?.currentTime,\n      frames: this.video?.getVideoPlaybackQuality?.().totalVideoFrames || 0 };\n  }\n  stop() {\n    ++this.serial;\n    this.cancelWait?.();\n    if (this.timer != null) this.doc.defaultView.clearInterval(this.timer);\n    this.timer = null;\n    this.video?.remove();\n    this.video = null;\n    for (const track of this.stream?.getTracks() || []) track.stop();\n    this.stream = null;\n    this.source = null;\n    this.failure = null;\n  }\n}\n\n  let renderer = null;\n  let stopped = false;\n  const CHANNEL = "__CHANNEL__";\n  const ids = new WeakMap();\n  const elements = new Map();\n  let nextId = 0;\n  const frameId = () => content.browsingContext?.id || 0;\n\n  function hasVideoAudioTrack(media) {\n  // Track presence is independent of the viewer\'s mute and volume choices.\n  try {\n    if (media.srcObject?.getAudioTracks) return media.srcObject.getAudioTracks().length > 0;\n    if (media.audioTracks) return media.audioTracks.length > 0;\n    const capture = media.captureStream || media.mozCaptureStream;\n    if (typeof capture !== "function") return false;\n    const stream = capture.call(media);\n    const hasAudio = stream.getAudioTracks().length > 0;\n    for (const track of stream.getTracks()) track.stop();\n    return hasAudio;\n  } catch (_) { return false; }\n}\n\n  function list({ requireAudio = false } = {}) {\n    const doc = content.document;\n    if (!doc) return [];\n    const found = [];\n    const live = new Set();\n    for (const media of doc.querySelectorAll("video")) {\n      if (media.localName !== "video" || media.ended || media.readyState < 1) continue;\n      const box = media.getBoundingClientRect();\n      const x = Math.max(0, box.left);\n      const y = Math.max(0, box.top);\n      const width = Math.min(content.innerWidth, box.right) - x;\n      const height = Math.min(content.innerHeight, box.bottom) - y;\n      if (media.videoWidth < 240 || media.videoHeight < 135 ||\n          (Number.isFinite(media.duration) && media.duration > 0 && media.duration < 8) ||\n          (requireAudio && !hasVideoAudioTrack(media))) continue;\n      let id = ids.get(media);\n      if (!id) { id = ++nextId; ids.set(media, id); }\n      elements.set(id, media);\n      live.add(id);\n      const label = media.getAttribute("aria-label") || media.getAttribute("title") ||\n        media.closest("[aria-label]")?.getAttribute("aria-label") ||\n        doc.title || "Video";\n      let videoRef = null;\n      try {\n        const { ContentDOMReference } = ChromeUtils.importESModule(\n          "resource://gre/modules/ContentDOMReference.sys.mjs");\n        videoRef = ContentDOMReference.get(media);\n      } catch (_) {}\n      found.push({ id, videoRef, documentId: content.windowGlobalChild?.innerWindowId || 0,\n        frameId: frameId(), label: String(label).slice(0, 100),\n        kind: "video",\n        canClone: typeof media.cloneElementVisually === "function",\n        canStream: typeof (media.captureStream || media.mozCaptureStream) === "function",\n        canCanvasStream: typeof doc.createElement("canvas").captureStream === "function",\n        rect: width > 0 && height > 0 ? { x, y, width, height } : null,\n        score: (media.paused ? 0 : 10000000) + Math.max(0, width) * Math.max(0, height),\n        paused: media.paused, muted: media.muted,\n        currentTime: media.currentTime,\n        duration: Number.isFinite(media.duration) ? media.duration : 0,\n        width: media.videoWidth || 0, height: media.videoHeight || 0 });\n    }\n    for (const id of elements.keys()) if (!live.has(id)) elements.delete(id);\n    return found;\n  }\n\n  function captureFrame({ id, captureWidth = 480 }) {\n    const media = elements.get(id);\n    if (!media?.isConnected || media.localName !== "video" || media.readyState < 2)\n      throw new Error("No decoded video frame available");\n    const canvas = content.document.createElement("canvas");\n    canvas.width = Math.min([320, 480, 640].includes(captureWidth) ? captureWidth : 480, media.videoWidth);\n    canvas.height = Math.max(1, Math.round(canvas.width * media.videoHeight / media.videoWidth));\n    canvas.getContext("2d", { alpha: false }).drawImage(media, 0, 0, canvas.width, canvas.height);\n    return { url: canvas.toDataURL("image/jpeg", 0.75), width: canvas.width, height: canvas.height };\n  }\n\n  function controlMedia({ id, action, value }) {\n    const media = elements.get(id);\n    if (!media?.isConnected) return null;\n    switch (action) {\n      case "toggle":\n        if (media.paused) media.play().catch(() => {});\n        else media.pause();\n        break;\n      case "mute": media.muted = !media.muted; break;\n      case "seek":\n        if (Number.isFinite(value) && Number.isFinite(media.duration))\n          media.currentTime = Math.max(0, Math.min(media.duration, value));\n        break;\n    }\n    return { paused: media.paused, muted: media.muted,\n      currentTime: media.currentTime,\n      duration: Number.isFinite(media.duration) ? media.duration : 0 };\n  }\n\n  async function onRequest(message) {\n    const { requestId, kind, frameId: requestedFrame, ...args } = message.data;\n    if (stopped || (kind !== "List" && requestedFrame !== frameId())) return;\n    try {\n      let result;\n      if (kind === "List") result = list(args);\n      else if (kind === "Preview") {\n        renderer ??= new ZentralVideoRenderer(content.document);\n        result = await renderer.start(args);\n      } else if (kind === "Health") result = renderer?.health() || { ok: false };\n      else if (kind === "StopPreview") { renderer?.stop(); result = true; }\n      else if (kind === "ActorCheck") {\n        ChromeUtils.importESModule(args.moduleURI);\n        result = true;\n      } else result = kind === "Capture" ? captureFrame(args) : controlMedia(args);\n      if (!stopped) sendAsyncMessage(CHANNEL + ":reply", { requestId, result });\n    } catch (error) {\n      if (!stopped) sendAsyncMessage(CHANNEL + ":reply", { requestId, error: String(error), result: [] });\n    }\n  }\n  function onShutdown() {\n    stopped = true;\n    renderer?.stop();\n    removeMessageListener(CHANNEL + ":request", onRequest);\n    removeMessageListener(CHANNEL + ":shutdown", onShutdown);\n    elements.clear();\n  }\n  addEventListener("unload", () => renderer?.stop());\n  addMessageListener(CHANNEL + ":request", onRequest);\n  addMessageListener(CHANNEL + ":shutdown", onShutdown);\n})();\n';
  const ACTOR_SOURCE =
    '// Shared by actor and frame-script transports; no parent-side privileges.\nclass ZentralVideoRenderer {\n  constructor(doc) { this.doc = doc; this.serial = 0; }\n  async start({ videoRef, mode, fit = "contain" }) {\n    if (this.doc?.documentURI !== "about:blank") throw new Error("Invalid preview document");\n    this.stop();\n    const serial = this.serial;\n    const { ContentDOMReference } = ChromeUtils.importESModule(\n      "resource://gre/modules/ContentDOMReference.sys.mjs");\n    const media = await ContentDOMReference.resolve(videoRef);\n    if (serial !== this.serial) throw new Error("Preview cancelled");\n    if (!media?.isConnected || media.localName !== "video")\n      throw new Error("Video reference unavailable in preview process");\n    this.source = media;\n    const doc = this.doc, win = doc.defaultView;\n    if (!doc.body) doc.documentElement.appendChild(doc.createElement("body"));\n    doc.body.style.cssText = "margin:0;overflow:hidden;background:#000";\n    const target = doc.createElement("video");\n    target.muted = true;\n    target.autoplay = true;\n    target.style.cssText = "display:block;width:100vw;height:100vh;object-fit:" +\n      (fit === "cover" ? "cover" : "contain") + ";background:#000";\n    doc.body.appendChild(target);\n    this.video = target;\n    this.mode = mode;\n    try {\n      if (mode === "native") {\n        if (media.isCloningElementVisually) throw new Error("Source already has a visual clone");\n        if (typeof media.cloneElementVisually !== "function") throw new Error("Native cloning unavailable");\n        await media.cloneElementVisually(target);\n      } else if (mode === "stream") {\n        const capture = media.captureStream || media.mozCaptureStream;\n        if (typeof capture !== "function") throw new Error("Stream capture unavailable");\n        this.stream = capture.call(media);\n        const tracks = this.stream.getVideoTracks();\n        if (!tracks.length) throw new Error("Stream contains no video track");\n        target.srcObject = new win.MediaStream(tracks);\n        await target.play();\n        if (serial !== this.serial) throw new Error("Preview cancelled");\n        await this.firstFrame(target);\n      } else if (mode === "canvas-stream") {\n        const surface = doc.createElement("canvas");\n        surface.width = Math.min(640, media.videoWidth);\n        surface.height = Math.max(1, Math.round(surface.width * media.videoHeight / media.videoWidth));\n        const ctx = surface.getContext("2d", { alpha: false });\n        ctx.drawImage(media, 0, 0, surface.width, surface.height);\n        this.stream = surface.captureStream(30);\n        target.srcObject = this.stream;\n        // Keep all copies inside the source process. No per-frame JPEG or IPC.\n        // Use the visible preview window clock: source rVFC may stop in a hidden tab.\n        let lastTime = NaN;\n        this.timer = win.setInterval(() => {\n          if (!media.isConnected || media.ended) { this.failure = "Source ended or detached"; return; }\n          if (media.currentTime === lastTime || media.readyState < 2) return;\n          try {\n            ctx.drawImage(media, 0, 0, surface.width, surface.height);\n            lastTime = media.currentTime;\n          } catch (error) { this.failure = String(error); }\n        }, 1000 / 30);\n        await target.play();\n        if (serial !== this.serial) throw new Error("Preview cancelled");\n        await this.firstFrame(target);\n      } else throw new Error("Unknown preview mode");\n      if (serial !== this.serial) throw new Error("Preview cancelled");\n      return { ok: true, mode };\n    } catch (error) {\n      if (serial === this.serial) this.stop();\n      throw error;\n    }\n  }\n  firstFrame(target) {\n    if (target.readyState >= 2 && target.videoWidth > 0) return Promise.resolve();\n    return new Promise((resolve, reject) => {\n      const win = this.doc.defaultView;\n      const done = error => {\n        win.clearTimeout(timer);\n        target.removeEventListener("loadeddata", loaded);\n        this.cancelWait = null;\n        error ? reject(error) : resolve();\n      };\n      const loaded = () => done();\n      const timer = win.setTimeout(() => done(new Error("Stream produced no decoded frame")), 1800);\n      this.cancelWait = () => done(new Error("Preview cancelled"));\n      target.addEventListener("loadeddata", loaded, { once: true });\n    });\n  }\n  health() {\n    const tracks = this.stream?.getVideoTracks() || [];\n    return { ok: !!this.video?.isConnected && !!this.source?.isConnected && !this.failure &&\n      !this.source.ended && ((this.mode === "native" && this.source.isCloningElementVisually) ||\n        (this.video.readyState >= 2 && tracks.some(track => track.readyState !== "ended" && !track.muted))),\n      error: this.failure || "Preview disconnected or stream unavailable",\n      paused: this.source?.paused, time: this.source?.currentTime,\n      frames: this.video?.getVideoPlaybackQuality?.().totalVideoFrames || 0 };\n  }\n  stop() {\n    ++this.serial;\n    this.cancelWait?.();\n    if (this.timer != null) this.doc.defaultView.clearInterval(this.timer);\n    this.timer = null;\n    this.video?.remove();\n    this.video = null;\n    for (const track of this.stream?.getTracks() || []) track.stop();\n    this.stream = null;\n    this.source = null;\n    this.failure = null;\n  }\n}\n\nfunction hasVideoAudioTrack(media) {\n  // Track presence is independent of the viewer\'s mute and volume choices.\n  try {\n    if (media.srcObject?.getAudioTracks) return media.srcObject.getAudioTracks().length > 0;\n    if (media.audioTracks) return media.audioTracks.length > 0;\n    const capture = media.captureStream || media.mozCaptureStream;\n    if (typeof capture !== "function") return false;\n    const stream = capture.call(media);\n    const hasAudio = stream.getAudioTracks().length > 0;\n    for (const track of stream.getTracks()) track.stop();\n    return hasAudio;\n  } catch (_) { return false; }\n}\n\n// Content-process source discovery for Zentral\'s sidebar video preview.\n// It never changes playback unless the user presses a preview control.\nexport class ZentralVideoBridgeChild extends JSWindowActorChild {\n  receiveMessage(message) {\n    if (message.name === "List") return this.list(message.data);\n    if (message.name === "Control") return this.control(message.data);\n    if (message.name === "Capture") return this.capture(message.data);\n    if (message.name === "Health") return this.renderer?.health() || { ok: false };\n    if (message.name === "Preview") return this.preview(message.data);\n    if (message.name === "StopPreview") { this.stopPreview(); return true; }\n    return null;\n  }\n\n  list({ requireAudio = false } = {}) {\n    const doc = this.document;\n    const win = this.contentWindow;\n    if (!doc || !win) return [];\n    this.ids ??= new WeakMap();\n    this.elements ??= new Map();\n    this.nextId ??= 1;\n    const found = [];\n    const live = new Set();\n\n    for (const media of doc.querySelectorAll("video")) {\n      if (media.localName !== "video" || media.ended || media.readyState < 1) continue;\n      const box = media.getBoundingClientRect();\n      const x = Math.max(0, box.left);\n      const y = Math.max(0, box.top);\n      const width = Math.min(win.innerWidth, box.right) - x;\n      const height = Math.min(win.innerHeight, box.bottom) - y;\n      // Require decoded video frames; skip tiny decorative clips.\n      if (media.videoWidth < 240 || media.videoHeight < 135 ||\n          (Number.isFinite(media.duration) && media.duration > 0 && media.duration < 8) ||\n          (requireAudio && !hasVideoAudioTrack(media))) continue;\n\n      let id = this.ids.get(media);\n      if (!id) { id = this.nextId++; this.ids.set(media, id); }\n      this.elements.set(id, media);\n      live.add(id);\n      const label = media.getAttribute("aria-label") || media.getAttribute("title") ||\n        media.closest("[aria-label]")?.getAttribute("aria-label") ||\n        doc.title || "Video";\n      let videoRef = null;\n      try {\n        const { ContentDOMReference } = ChromeUtils.importESModule(\n          "resource://gre/modules/ContentDOMReference.sys.mjs");\n        videoRef = ContentDOMReference.get(media);\n      } catch (_) { /* Snapshot / canvas capture can still work. */ }\n      found.push({ id, videoRef, documentId: this.manager?.innerWindowId || 0,\n        label: String(label).slice(0, 100),\n        kind: "video",\n        canClone: typeof media.cloneElementVisually === "function",\n        canStream: typeof (media.captureStream || media.mozCaptureStream) === "function",\n        canCanvasStream: typeof doc.createElement("canvas").captureStream === "function",\n        rect: width > 0 && height > 0 ? { x, y, width, height } : null,\n        score: (media.paused ? 0 : 10000000) + Math.max(0, width) * Math.max(0, height),\n        paused: media.paused, muted: media.muted,\n        currentTime: media.currentTime,\n        duration: Number.isFinite(media.duration) ? media.duration : 0,\n        width: media.videoWidth || 0, height: media.videoHeight || 0 });\n    }\n    for (const id of this.elements.keys()) if (!live.has(id)) this.elements.delete(id);\n    return found;\n  }\n\n  capture({ id, captureWidth = 480 } = {}) {\n    const media = this.elements?.get(id);\n    if (!media?.isConnected || media.localName !== "video" || media.readyState < 2)\n      throw new Error("No decoded video frame available");\n    const canvas = this.document.createElement("canvas");\n    canvas.width = Math.min([320, 480, 640].includes(captureWidth) ? captureWidth : 480, media.videoWidth);\n    canvas.height = Math.max(1, Math.round(canvas.width * media.videoHeight / media.videoWidth));\n    canvas.getContext("2d", { alpha: false }).drawImage(media, 0, 0, canvas.width, canvas.height);\n    return { url: canvas.toDataURL("image/jpeg", 0.75), width: canvas.width, height: canvas.height };\n  }\n\n  async preview(data) {\n    this.renderer ??= new ZentralVideoRenderer(this.document);\n    return this.renderer.start(data);\n  }\n\n  stopPreview() { this.renderer?.stop(); }\n\n  didDestroy() {\n    this.stopPreview();\n    this.elements?.clear();\n  }\n\n  control({ id, action, value } = {}) {\n    const media = this.elements?.get(id);\n    if (!media?.isConnected) return null;\n    switch (action) {\n      case "toggle":\n        if (media.paused) media.play().catch(() => {});\n        else media.pause();\n        break;\n      case "mute": media.muted = !media.muted; break;\n      case "seek":\n        if (Number.isFinite(value) && Number.isFinite(media.duration))\n          media.currentTime = Math.max(0, Math.min(media.duration, value));\n        break;\n    }\n    return { paused: media.paused, muted: media.muted,\n      currentTime: media.currentTime,\n      duration: Number.isFinite(media.duration) ? media.duration : 0 };\n  }\n}\n';
  const ACTOR = "ZentralVideoBridge";
  const CHANNEL = "ZentralVideoPreview:" + Math.random().toString(36).slice(2);
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
    lastScanMs: 0,
    frames: 0,
    captureMs: 0,
  };
  let actorReady = false;
  let actorAttempted = false;
  const methodState = {
    frame: "waiting",
    actor: experimentalBridgeDisabled() ? "disabled in settings" : "waiting",
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
  let previewGeneration = 0;
  let previewMode = null;
  let noPictureChecks = 0;
  let lastSourceVisibility = null;
  let previewAutoSelected = false;
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
  let nextRenderProbe = 0;
  let nextHealthCheck = 0;
  let lastHealth = null;
  let lastScan = 0;
  let heightPx = 0,
    radiusPx = 0;
  let cropCache = null;
  try {
    heightPx = Math.max(
      0,
      Math.min(800, Services.prefs.getIntPref(HEIGHT_PREF, 0)),
    );
  } catch (_) {}
  try {
    radiusPx = Math.max(
      0,
      Math.min(24, Services.prefs.getIntPref(RADIUS_PREF, 0)),
    );
  } catch (_) {}
  let widthPercent = 100;
  try {
    widthPercent = Math.max(
      35,
      Math.min(100, Services.prefs.getIntPref(WIDTH_PREF, 100)),
    );
  } catch (_) {}
  let disposed = false;
  let scanning = false;
  let scanCursor = 0;
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
      Object.values(methodState).every((state) => !state.startsWith("working"))
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
        actorModuleURI = "resource://zentral-video-bridge/" + file.leafName;
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
        if (Array.isArray(reply.result)) request.results.push(...reply.result);
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
      state.manager.removeMessageListener(CHANNEL + ":reply", state.onResult);
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
            tab.setAttribute("data-active", tab === panel ? "true" : "false"),
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
        checkbox.id =
          preference === HIDE_DUPLICATES_PREF
            ? "zs-video-preview-hide-muted-duplicates"
            : preference === FIT_WIDTH_PREF
              ? "zs-video-preview-fit-width"
              : preference === REQUIRE_AUDIO_PREF
                ? "zs-video-preview-require-audio"
                : "zs-video-preview-auto-show";
        checkbox.checked = Services.prefs.getBoolPref(preference, initial);
        checkbox.addEventListener("change", () => {
          Services.prefs.setBoolPref(preference, checkbox.checked);
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
      pauseTitle.textContent = "Pause preview when compact tabbar is hidden";
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
        Services.prefs.setBoolPref(PAUSE_COMPACT_PREF, pauseCheck.checked),
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
          if (!autoShowVideo() && previewAutoSelected) {
            current = null;
            previewAutoSelected = false;
            resetRendering();
            refreshCard();
          } else if (enabled()) scan(true);
        },
      );
      addToggle("Fill available sidebar width", FIT_WIDTH_PREF, true, () => {
        fitPicture();
        injectSetting();
      });
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
        heightPx = 0;
        Services.prefs.setIntPref(HEIGHT_PREF, 0);
        fitPicture();
        injectSetting();
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
      detailLabel.textContent = "Capture detail (frames and snapshots only) ";
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
        Services.prefs.setIntPref(CAPTURE_WIDTH_PREF, Number(detail.value));
        cropCache = null;
        if (enabled()) paint();
      });
      detailLabel.appendChild(detail);
      content.appendChild(detailLabel);
      const rateLabel = document.createElement("label");
      rateLabel.textContent = "Video Frames / Page Snapshots capture rate ";
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
        cropCache = null;
        fitPicture();
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
        "Checks every 5 seconds. Drag the grip below the video to set its height; double-click for automatic height. Auto crop detects matching dark borders and may need a moment to adjust.";
      content.appendChild(help);
    }
    input.checked = enabled();
    const experimentalCheck = modal.querySelector(
      "#zs-video-preview-disable-experimental",
    );
    if (experimentalCheck)
      experimentalCheck.checked = experimentalBridgeDisabled();
    const pauseCheck = modal.querySelector("#zs-video-preview-pause-compact");
    if (pauseCheck) pauseCheck.checked = pauseWhenCompactHidden();
    const widthCheck = modal.querySelector("#zs-video-preview-width");
    if (widthCheck) widthCheck.disabled = fillWidth();
    const fillCheck = modal.querySelector("#zs-video-preview-fit-width");
    if (fillCheck) fillCheck.checked = fillWidth();
    const heightInput = modal.querySelector("#zs-video-preview-height");
    if (heightInput) heightInput.value = String(heightPx || Math.min(800, 230));
    const heightLabel = modal.querySelector("#zs-video-preview-height-value");
    if (heightLabel)
      heightLabel.textContent = heightPx ? heightPx + " px" : "Auto";
    const radiusInput = modal.querySelector("#zs-video-preview-radius");
    if (radiusInput) radiusInput.value = String(radiusPx);
    const radiusLabel = modal.querySelector("#zs-video-preview-radius-value");
    if (radiusLabel) radiusLabel.textContent = radiusPx + " px";
    const detailSelect = modal.querySelector("#zs-video-preview-capture-width");
    if (detailSelect) detailSelect.value = String(captureWidth());
    const rateSelect = modal.querySelector("#zs-video-preview-capture-rate");
    if (rateSelect)
      rateSelect.value = String(CAPTURE_RATES.indexOf(captureRateTenths()));
    const rateValue = modal.querySelector(
      "#zs-video-preview-capture-rate-value",
    );
    if (rateValue) rateValue.textContent = captureRateTenths() / 10 + " fps";
    const rateCost = modal.querySelector("#zs-video-preview-capture-rate-cost");
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
    const autoCheckbox = modal.querySelector("#zs-video-preview-auto-show");
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
        `\nLive source confirmed hidden: ${current ? sourceCertainlyHidden(current) : "no source"}` +
        `\nDiscovery calls: ${metrics.discoveryCalls}; last scan: ${Math.round(metrics.lastScanMs)} ms elapsed` +
        `\nCompact tabbar pause: ${compactPaused ? "paused" : pauseWhenCompactHidden() ? "enabled" : "off"}` +
        `\nStill captures target: ${captureRateTenths() / 10} fps` +
        `\nCaptured frames: ${metrics.frames}; mean capture: ${Math.round(metrics.captureMs / Math.max(1, metrics.frames))} ms elapsed` +
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
        const index = sources.findIndex((item) => sameSource(item, current));
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
        heightPx = 0;
        Services.prefs.setIntPref(HEIGHT_PREF, 0);
        fitPicture();
        injectSetting();
      });
      box.append(sourceList, sourceCapabilities, picture, grip, seekBar, bar);
      box._nextButton = next;
      box._openButton = open;
    }
    if (
      box.parentNode !== controls.parentNode ||
      box.previousSibling !== controls
    )
      controls.after(box);
  }

  function sameSource(a, b) {
    return !!(
      a &&
      b &&
      a.browser === b.browser &&
      a.method === b.method &&
      a.data.frameId === b.data.frameId &&
      a.data.documentId === b.data.documentId &&
      a.data.id === b.data.id
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
      `${source.data.documentId || 0}:${source.data.id}:${source.method}`
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
        document.documentElement.getAttribute("zentral-app-panel-open") ===
          "true" ||
        window.Zentral?.Apps?.isPanelOpen?.()
      )
        return false;
      const root = source.browser.closest?.(
        "#zen-app-panel-root, #bgalazka-super-panel",
      );
      return !!root && hiddenByLayout(root);
    }
    if (
      !source.tab ||
      !source.tab.isConnected ||
      source.tab === gBrowser.selectedTab
    )
      return false;
    return hiddenByLayout(source.browser);
  }

  function sourceVisible(source) {
    return !sourceCertainlyHidden(source);
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
    if (!source || source.data.kind !== "video") return "Choose a video source";
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
    if (LIVE_MODES.includes(mode) && !sourceCertainlyHidden(source))
      return "Source visibility is not confirmed hidden; switch to another tab or close the panel";
    if (
      (mode === "native" || mode === "stream") &&
      source.method !== "actor" &&
      !methodState.actor.startsWith("working")
    )
      return "Actor bridge did not respond on this source";
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
    if (!unavailableBySource.has(key)) unavailableBySource.set(key, new Map());
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
      picker.title = unavailableReason(rendererChoice()) || "Preview renderer";
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
      const eligible = RENDER_MODES.filter((mode) => !unavailableReason(mode));
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
    renderSidebarSources();
    refreshRendererOptions();
    sourceList.hidden = !sources.length;
    picture.hidden = current?.data.kind !== "video";
    seekBar.hidden = !current?.data.duration;
    controlBar.hidden = false;
    box._openButton.hidden = !canOpenSourceTab(current);
    if (!current) {
      caption.textContent = sources.length
        ? "Choose a source"
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
    picture.hidden = data.kind !== "video";
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
    if (changed) previewAutoSelected = automatic;
    if (changed && canvas) {
      cropCache = null;
      lastSourceVisibility = null;
      canvas.width = 1;
      canvas.height = 1;
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
      const capture = media.captureStream || media.mozCaptureStream;
      if (typeof capture !== "function") return false;
      const stream = capture.call(media);
      const hasAudio = stream.getAudioTracks().length > 0;
      for (const track of stream.getTracks()) track.stop();
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
            typeof doc.createElement("canvas").captureStream === "function",
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
              !["http", "https", "file", "moz-extension"].includes(scheme))
          )
            return [];
          const candidates = await limited(
            global
              .getActor(ACTOR)
              .sendQuery("List", { requireAudio: requireAudio() }),
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
      });
      const frames = contexts(item.browser.browsingContext);
      return (candidates || []).flatMap((data) => {
        const context =
          frames.find((entry) => entry.id === data.frameId) ||
          (data.frameId ? null : item.browser.browsingContext);
        return context ? [{ ...item, method: "frame", context, data }] : [];
      });
    } catch (error) {
      methodError("frame", error);
      return [];
    }
  }

  async function inspectBrowser(item) {
    if (!item.browser?.browsingContext || item.tab?.closing) return [];
    const generation = scanGeneration;
    diagnostics.inspected++;
    const choice = discoveryChoice();
    const locked =
      choice === "auto"
        ? discoveryLocks.get(item.browser) || discoveryWinner
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
      (!discoveryWinner || item.browser === compactResumeSource?.browser) &&
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
    if (disposed || !enabled() || generation !== scanGeneration) return [];
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

  async function scan(all = false, resumeOnly = false) {
    if (disposed || !enabled() || compactPaused || scanning) return;
    scanning = true;
    const scanStarted = Date.now();
    lastScan = scanStarted;
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
            tab.linkedBrowser?.hasAttribute?.("bgalazka-addon-host-browser") ||
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
            item.browser === (compactResumeSource?.browser || current?.browser),
        ) || (resumeOnly ? items.find((item) => item.tab?.soundPlaying) : null);
      if (active) batch.push(active);
      if (!resumeOnly || !active) {
        const focused = items.find((item) => item.tab === gBrowser.selectedTab);
        if (focused && !batch.includes(focused)) batch.push(focused);
        for (const panelItem of items.filter((item) => item.panel).slice(0, 4))
          if (!batch.includes(panelItem)) batch.push(panelItem);
        for (
          let i = 0;
          i < Math.min(all ? items.length : 12, items.length);
          i++
        ) {
          const item = items[(scanCursor + i) % items.length];
          if (!batch.includes(item)) batch.push(item);
        }
        scanCursor = (scanCursor + (all ? items.length : 12)) % items.length;
      }
      const found = (await Promise.all(batch.map(inspectBrowser))).flat();
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
      sources.sort((a, b) => b.data.score - a.data.score);
      if (discoveryChoice() === "auto")
        discoveryWinner =
          sources.find((item) => item.data.kind === "video")?.method || null;
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
      const stillPlaying = sources.find((item) => sameSource(item, current));
      if (stillPlaying) select(stillPlaying);
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
    } finally {
      if (generation === scanGeneration) {
        scanning = false;
        metrics.lastScanMs = Date.now() - scanStarted;
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
      if (!ensureActor()) throw new Error("Experimental actor unavailable");
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

  async function verifyPlayerPicture(browser, source, generation) {
    // Setup and decoded-stream events can succeed while a detached browser
    // compositor shows only black. Check a small sample of the actual output.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (generation !== previewGeneration)
        throw new Error("Preview cancelled");
      await new Promise((resolve) => setTimeout(resolve, 180));
      let bitmap;
      try {
        const global = browser.browsingContext?.currentWindowGlobal;
        const r = browser.getBoundingClientRect();
        if (!global || r.width < 2 || r.height < 2) continue;
        bitmap = await limited(
          global.drawSnapshot(
            new DOMRect(0, 0, r.width, r.height),
            Math.min(1, 48 / r.width),
            "rgb(0, 0, 0)",
          ),
          1200,
          "preview surface",
        );
        if (generation !== previewGeneration)
          throw new Error("Preview cancelled");
        const sample = document.createElement("canvas");
        sample.width = 24;
        sample.height = 14;
        const ctx = sample.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0, 24, 14);
        const pixels = ctx.getImageData(0, 0, 24, 14).data;
        let lit = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 36) lit++;
        if (lit >= 5) return;
      } catch (error) {
        if (attempt === 3) throw error;
      } finally {
        bitmap?.close?.();
      }
    }
    throw new Error("Preview process replied but displayed no video pixels");
  }

  async function startLivePreview(source, mode, generation) {
    const reason = unavailableReason(mode, source);
    if (reason) throw new Error(reason);
    if (!source.data.videoRef)
      throw new Error("No content video reference; refresh sources");
    const global = source.context.currentWindowGlobal;
    const browser = document.createXULElement("browser");
    browser._zvpMode = mode;
    browser.setAttribute("class", "zentral-video-preview-player");
    browser.setAttribute("type", "content");
    browser.setAttribute("remote", "true");
    browser.setAttribute("nodefaultsrc", "true");
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
      await verifyPlayerPicture(browser, source, generation);
      if (generation !== previewGeneration || sourceVisible(source))
        throw new Error("Preview cancelled or source visible");
      canvas.style.setProperty("display", "none", "important");
    } catch (error) {
      disposePlayer(browser);
      throw error;
    }
  }

  async function captureVideo(source) {
    const payload = {
      id: source.data.id,
      frameId: source.data.frameId,
      captureWidth: captureWidth(),
    };
    let frame;
    if (source.method === "frame")
      frame = await query(source.browser, "Capture", payload);
    else if (source.method === "actor")
      frame = await limited(
        source.context.currentWindowGlobal
          .getActor(ACTOR)
          .sendQuery("Capture", payload),
        900,
        "video frame",
      );
    else {
      const media = source.element;
      const surface = media.ownerDocument.createElement("canvas");
      surface.width = Math.min(payload.captureWidth, media.videoWidth);
      surface.height = Math.max(
        1,
        Math.round((surface.width * media.videoHeight) / media.videoWidth),
      );
      surface
        .getContext("2d")
        .drawImage(media, 0, 0, surface.width, surface.height);
      frame = { url: surface.toDataURL("image/jpeg", 0.75) };
    }
    if (
      typeof frame?.url !== "string" ||
      !frame.url.startsWith("data:image/jpeg;base64,") ||
      frame.url.length > 16 * 1024 * 1024
    )
      throw new Error("Invalid video frame response");
    return limited(
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Video frame decode failed"));
        img.src = frame.url;
      }),
      1000,
      "frame decode",
    );
  }

  async function captureSnapshot(source) {
    if (!source.data.rect)
      throw new Error("Video is outside the page viewport");
    const { x, y, width, height } = source.data.rect;
    return limited(
      source.context.currentWindowGlobal.drawSnapshot(
        new DOMRect(x, y, width, height),
        Math.min(1, captureWidth() / width),
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
    const full = { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    if (framingChoice() !== "auto" || bitmap.width < 40 || bitmap.height < 30)
      return full;
    const key = sourceKey(source);
    if (
      cropCache?.key === key &&
      cropCache.width === bitmap.width &&
      cropCache.height === bitmap.height &&
      Date.now() - cropCache.at < 2000
    )
      return cropCache.rect || full;
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
        left >= 2 && 63 - right >= 2 && Math.abs(left - (63 - right)) <= 5;
      const yCrop =
        top >= 2 && 35 - bottom >= 2 && Math.abs(top - (35 - bottom)) <= 4;
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
    cropCache = {
      key,
      width: bitmap.width,
      height: bitmap.height,
      at: Date.now(),
      rect,
    };
    return rect || full;
  }

  async function paint() {
    if (disposed || !enabled() || compactPaused || renderBusy) return;
    if (current?.data.kind !== "video" || !box?.isConnected || box.hidden) {
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
    const visible = sourceVisible(source);
    if (
      choice === "auto" &&
      lastSourceVisibility !== null &&
      lastSourceVisibility !== visible
    )
      resetRendering();
    lastSourceVisibility = visible;
    const generation = previewGeneration;
    renderBusy = true;
    try {
      if (LIVE_MODES.includes(previewMode)) {
        if (sourceVisible(source)) {
          methodState[previewMode] = "stopped (source became visible)";
          disposePlayer();
          previewMode = null;
          canvas.style.removeProperty("display");
          nextRenderProbe = 0;
        }
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
              throw new Error(state?.error || "Preview no longer available");
            // Re-check output if the source advanced but the live picture appears
            // dark twice; a compositing failure can leave transport health true.
            if (
              !state.paused &&
              lastHealth &&
              state.time > lastHealth.time + 1
            ) {
              try {
                await verifyPlayerPicture(previewBrowser, source, generation);
                noPictureChecks = 0;
              } catch (error) {
                if (++noPictureChecks >= 2) throw error;
              }
            }
            // Stream targets must keep presenting frames while source playback advances.
            if (
              previewMode !== "native" &&
              previewMode !== "frame-native" &&
              lastHealth &&
              !state.paused &&
              state.time > lastHealth.time + 1 &&
              state.frames === lastHealth.frames
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
      if (WORKING_MODES.includes(previewMode) && Date.now() < nextStillCapture)
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
        let bitmap;
        try {
          if (LIVE_MODES.includes(mode))
            await startLivePreview(source, mode, generation);
          else {
            bitmap = await (mode === "canvas"
              ? captureVideo(source)
              : captureSnapshot(source));
            if (generation !== previewGeneration) return;
            const crop = detectContentRect(bitmap, source);
            canvas.width = Math.max(1, crop.width);
            canvas.height = Math.max(1, crop.height);
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
            if (
              source.data.displayWidth !== crop.width ||
              source.data.displayHeight !== crop.height
            ) {
              source.data.displayWidth = crop.width;
              source.data.displayHeight = crop.height;
              fitPicture();
            }
            metrics.frames++;
            metrics.captureMs += Date.now() - started;
            nextStillCapture = Date.now() + captureIntervalMs();
          }
          if (generation !== previewGeneration) return;
          previewMode = mode;
          methodState[mode] = LIVE_MODES.includes(mode)
            ? "working (live video)"
            : "working (frame received)";
          nextHealthCheck = Date.now() + POLL_MS;
          return;
        } catch (error) {
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
        (experimentalBridgeDisabled() ? WORKING_MODES : RENDER_MODES).every(
          (mode) => failedRenderers.has(mode),
        )
      )
        failedRenderers.clear();
      nextRenderProbe = Date.now() + POLL_MS;
    } finally {
      renderBusy = false;
      updatePaintTimer();
      if (Date.now() - lastPaintStatusAt >= 500) {
        lastPaintStatusAt = Date.now();
        refreshMethodStatus();
      }
    }
  }

  function updatePaintTimer(active = true) {
    if (!frameTimer) return;
    const interval =
      active && WORKING_MODES.includes(previewMode)
        ? captureIntervalMs()
        : FRAME_MS;
    if (paintTimerMs === interval) return;
    clearInterval(frameTimer);
    paintTimerMs = interval;
    frameTimer = setInterval(paint, interval);
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
    clearTimeout(compactMountTimer);
    compactMountTimer = null;
    clearInterval(scanTimer);
    clearInterval(frameTimer);
    clearInterval(mountTimer);
    scanTimer = frameTimer = mountTimer = null;
    paintTimerMs = 0;
    scanning = false; // An old scan may still be settling after cancellation.
    resetRendering(); // Stops live renderers and cancels pending still captures.
    for (const browser of bridges.keys()) releaseBridge(browser);
    sources = [];
    current = null;
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
      document.documentElement.getAttribute("zen-compact-mode") === "true";
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
      ? setTimeout(syncCompactVisibility, compactPaused || hidden ? 100 : 500)
      : null;
  }

  function stop() {
    ++scanGeneration;
    resetRendering();
    clearInterval(scanTimer);
    clearInterval(frameTimer);
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
    paintTimerMs = FRAME_MS;
    frameTimer = setInterval(paint, FRAME_MS);
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
  const onTab = () => {
    if (enabled() && Date.now() - lastScan >= POLL_MS) scan();
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
    discoveryWinner = null;
    ++scanGeneration; // Ignore results of an old automatic probe.
    sources = [];
    current = null;
    resetRendering();
    refreshCard();
    if (enabled()) scan(true);
  };
  Services.prefs.addObserver(EXPERIMENTAL_DISABLED_PREF, onExperimentalPref);
  Services.prefs.addObserver(PAUSE_COMPACT_PREF, onPauseCompactPref);
  Services.prefs.addObserver(CAPTURE_RATE_PREF, onCaptureRatePref);
  Services.prefs.addObserver(RENDER_PREF, onRenderPref);
  Services.prefs.addObserver(DISCOVERY_PREF, onDiscoveryPref);
  Services.prefs.addObserver(PREF, onPref);
  for (const type of ["TabOpen", "TabClose", "TabSelect", "TabAttrModified"])
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
  function destroy() {
    if (disposed) return;
    disposed = true;
    compactObserver.disconnect();
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
    for (const type of ["TabOpen", "TabClose", "TabSelect", "TabAttrModified"])
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
      pauseWhenCompactHidden: pauseWhenCompactHidden(),
      compactPaused,
      resumePending: !!compactResumeSource,
      autoSelected: previewAutoSelected,
      hideMutedDuplicates: hideMutedDuplicates(),
      performance: { ...metrics },
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
  else start();
})();
