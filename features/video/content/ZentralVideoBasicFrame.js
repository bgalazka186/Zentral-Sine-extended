/*
 * ZENTRAL FILE GUIDE - features/video/content/ZentralVideoBasicFrame.js
 *
 * Purpose: Simpler frame-message fallback for source discovery, playback controls and caption watching
 *   without the full renderer helper.
 * Interaction / execution: VideoPreview reads/substitutes its channel and Transport loads it in browser
 *   content when using the basic bridge. Discovery/Captions/Sidebar use the returned source/control/caption
 *   protocol.
 * Ownership / failure: Separate fallback capability and execution environment. Keep channel/request
 *   identity and content cleanup intact; this is not a chrome controller and must not be loaded as a normal
 *   subscript.
 * Loaded/created by: features/video/ZentralVideoPreview.uc.js
 * Literal DOM event subscriptions: cuechange; loadeddata
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
// Loaded into each browser's content process through its frame message manager.
// The channel is replaced at startup so separate browser windows stay isolated.
(function () {
  // Shared by actor and frame-script transports; no parent-side privileges.
  class ZentralVideoRenderer {
    constructor(doc) {
      this.doc = doc;
      this.serial = 0;
    }
    async start({ videoRef, mode, fit = "contain" }) {
      if (this.doc?.documentURI !== "about:blank")
        throw new Error("Invalid preview document");
      this.stop();
      const serial = this.serial;
      const { ContentDOMReference } = ChromeUtils.importESModule(
        "resource://gre/modules/ContentDOMReference.sys.mjs",
      );
      const media = await ContentDOMReference.resolve(videoRef);
      if (serial !== this.serial) throw new Error("Preview cancelled");
      if (!media?.isConnected || media.localName !== "video")
        throw new Error("Video reference unavailable in preview process");
      this.source = media;
      const doc = this.doc,
        win = doc.defaultView;
      if (!doc.body) doc.documentElement.appendChild(doc.createElement("body"));
      doc.body.style.cssText = "margin:0;overflow:hidden;background:#000";
      const target = doc.createElement("video");
      target.muted = true;
      target.autoplay = true;
      target.style.cssText =
        "display:block;width:100vw;height:100vh;object-fit:" +
        (fit === "cover" ? "cover" : "contain") +
        ";background:#000";
      doc.body.appendChild(target);
      this.video = target;
      this.mode = mode;
      this.presentedCallbacks = 0;
      if (typeof target.requestVideoFrameCallback === "function") {
        const tick = () => {
          if (this.video !== target) return;
          this.presentedCallbacks++;
          this.frameCallback = target.requestVideoFrameCallback(tick);
        };
        this.frameCallback = target.requestVideoFrameCallback(tick);
      }
      try {
        if (mode === "native") {
          if (media.isCloningElementVisually)
            throw new Error("Source already has a visual clone");
          if (typeof media.cloneElementVisually !== "function")
            throw new Error("Native cloning unavailable");
          await media.cloneElementVisually(target);
        } else if (mode === "stream") {
          const capture = media.captureStream || media.mozCaptureStream;
          if (typeof capture !== "function")
            throw new Error("Stream capture unavailable");
          this.stream = capture.call(media);
          const tracks = this.stream.getVideoTracks();
          if (!tracks.length) throw new Error("Stream contains no video track");
          target.srcObject = new win.MediaStream(tracks);
          await target.play();
          if (serial !== this.serial) throw new Error("Preview cancelled");
          await this.firstFrame(target);
        } else if (mode === "canvas-stream") {
          // Create the canvas under the source document's principal. Drawing
          // media from another origin into about:blank taints its capture stream.
          const surface = media.ownerDocument.createElement("canvas");
          surface.width = Math.min(640, media.videoWidth);
          surface.height = Math.max(
            1,
            Math.round((surface.width * media.videoHeight) / media.videoWidth),
          );
          const ctx = surface.getContext("2d", { alpha: false });
          ctx.drawImage(media, 0, 0, surface.width, surface.height);
          this.stream = surface.captureStream(30);
          target.srcObject = this.stream;
          // Keep all copies inside the source process. No per-frame JPEG or IPC.
          // Use the visible preview window clock: source rVFC may stop in a hidden tab.
          let lastTime = NaN;
          this.timer = win.setInterval(() => {
            if (!media.isConnected || media.ended) {
              this.failure = "Source ended or detached";
              return;
            }
            if (media.currentTime === lastTime || media.readyState < 2) return;
            try {
              ctx.drawImage(media, 0, 0, surface.width, surface.height);
              lastTime = media.currentTime;
            } catch (error) {
              this.failure = String(error);
            }
          }, 1000 / 30);
          await target.play();
          if (serial !== this.serial) throw new Error("Preview cancelled");
          await this.firstFrame(target);
        } else throw new Error("Unknown preview mode");
        if (serial !== this.serial) throw new Error("Preview cancelled");
        return { ok: true, mode };
      } catch (error) {
        if (serial === this.serial) this.stop();
        throw error;
      }
    }
    firstFrame(target) {
      if (target.readyState >= 2 && target.videoWidth > 0)
        return Promise.resolve();
      return new Promise((resolve, reject) => {
        const win = this.doc.defaultView;
        const done = (error) => {
          win.clearTimeout(timer);
          target.removeEventListener("loadeddata", loaded);
          this.cancelWait = null;
          error ? reject(error) : resolve();
        };
        const loaded = () => done();
        const timer = win.setTimeout(
          () => done(new Error("Stream produced no decoded frame")),
          1800,
        );
        this.cancelWait = () => done(new Error("Preview cancelled"));
        target.addEventListener("loadeddata", loaded, { once: true });
      });
    }
    health() {
      const tracks = this.stream?.getVideoTracks() || [];
      const rect = this.video?.getBoundingClientRect();
      const ok =
        !!this.video?.isConnected &&
        !!this.source?.isConnected &&
        !this.failure &&
        !this.source.ended &&
        ((this.mode === "native" && this.source.isCloningElementVisually) ||
          (this.video.readyState >= 2 &&
            tracks.some(
              (track) => track.readyState !== "ended" && !track.muted,
            )));
      return {
        ok,
        error: ok
          ? null
          : this.failure || "Preview disconnected or stream unavailable",
        paused: this.source?.paused,
        time: this.source?.currentTime,
        sourceFrames:
          this.source?.getVideoPlaybackQuality?.().totalVideoFrames || 0,
        frames: this.video?.getVideoPlaybackQuality?.().totalVideoFrames || 0,
        presentedCallbacks: this.presentedCallbacks || 0,
        readyState: this.video?.readyState,
        targetPaused: this.video?.paused,
        targetTime: this.video?.currentTime,
        visibility: this.doc.visibilityState,
        dimensions: [this.video?.videoWidth, this.video?.videoHeight],
        targetRect: rect
          ? [Math.round(rect.width), Math.round(rect.height)]
          : null,
        viewport: [
          this.doc.defaultView.innerWidth,
          this.doc.defaultView.innerHeight,
        ],
        tracks: tracks.map((track) => ({
          readyState: track.readyState,
          muted: track.muted,
        })),
      };
    }
    stop() {
      ++this.serial;
      this.cancelWait?.();
      if (this.timer != null) this.doc.defaultView.clearInterval(this.timer);
      this.timer = null;
      if (this.mode === "native" && this.source) {
        try {
          this.source.stopCloningElementVisually?.();
        } catch (_) {}
      }
      try {
        this.video?.cancelVideoFrameCallback?.(this.frameCallback);
      } catch (_) {}
      this.frameCallback = null;
      this.video?.remove();
      this.video = null;
      for (const track of this.stream?.getTracks() || []) track.stop();
      this.stream = null;
      this.source = null;
      this.failure = null;
    }
  }

  function captionText(doc = content.document, media = null) {
    try {
      media ??= doc?.querySelector("video");
      for (const track of media?.textTracks || []) {
        if (
          track.mode !== "showing" ||
          !["captions", "subtitles"].includes(track.kind)
        )
          continue;
        const cues = Array.from(track.activeCues || []);
        if (cues.length)
          return cues
            .map((cue) => cue.text || "")
            .join(" ")
            .replace(/\s+/g, " ")
            .slice(0, 1000);
      }
      const host = doc?.location?.hostname || "";
      if (
        host !== "youtube.com" &&
        !host.endsWith(".youtube.com") &&
        host !== "youtube-nocookie.com" &&
        !host.endsWith(".youtube-nocookie.com")
      )
        return "";
      const button = doc.querySelector(".ytp-subtitles-button");
      if (
        button &&
        button.getAttribute("aria-pressed") !== "true" &&
        !button.classList.contains("ytp-button-active")
      )
        return "";
      return Array.from(doc.querySelectorAll(".ytp-caption-segment"))
        .filter((el) => {
          for (let node = el; node; node = node.parentElement) {
            const style = doc.defaultView.getComputedStyle(node);
            if (
              node.hidden ||
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.opacity === "0"
            )
              return false;
          }
          return true;
        })
        .map((el) => el.textContent.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 1000);
    } catch (_) {
      return "";
    }
  }

  let captionObserver = null;
  let watchedMedia = null;
  let captionTracks = [];
  let captionQueued = false;
  const onCaptionChange = () => {
    if (captionQueued || !watchedMedia) return;
    captionQueued = true;
    content.setTimeout(() => {
      captionQueued = false;
      if (stopped || !watchedMedia) return;
      sendAsyncMessage(CHANNEL + ":caption", {
        frameId: frameId(),
        id: ids.get(watchedMedia),
        text: captionText(content.document, watchedMedia),
      });
    }, 50);
  };
  function watchCaption(id, active = true) {
    captionObserver?.disconnect();
    captionObserver = null;
    for (const track of captionTracks)
      track.removeEventListener("cuechange", onCaptionChange);
    captionTracks = [];
    watchedMedia = active ? elements.get(id) || null : null;
    if (!watchedMedia) return false;
    for (const track of watchedMedia.textTracks || []) {
      track.addEventListener("cuechange", onCaptionChange);
      captionTracks.push(track);
    }
    if (
      /(^|\.)youtube(?:-nocookie)?\.com$/.test(
        content.document.location?.hostname || "",
      )
    ) {
      const root =
        content.document.querySelector(".html5-video-player") ||
        content.document.querySelector(".ytp-caption-window-container");
      if (root) {
        captionObserver = new content.MutationObserver((records) => {
          const selector =
            ".ytp-caption-window-container,.caption-window,.ytp-caption-segment,.ytp-subtitles-button";
          const relevant = (node) => {
            if (node?.nodeType === 3) node = node.parentElement;
            return !!(
              node?.matches?.(selector) ||
              node?.closest?.(selector) ||
              node?.querySelector?.(selector)
            );
          };
          if (
            records.some(
              (record) =>
                relevant(record.target) ||
                (record.type === "attributes" && record.target === root) ||
                [
                  ...(record.addedNodes || []),
                  ...(record.removedNodes || []),
                ].some(relevant),
            )
          )
            onCaptionChange();
        });
        captionObserver.observe(root, {
          childList: true,
          characterData: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style", "hidden", "aria-pressed"],
        });
      }
    }
    onCaptionChange();
    return true;
  }

  let renderer = null;
  let stopped = false;
  const CHANNEL = "__CHANNEL__";
  const ids = new WeakMap();
  const elements = new Map();
  let nextId = 0;
  const frameId = () => content.browsingContext?.id || 0;

  function discoveryVideos(doc) {
    const videos = Array.from(doc.querySelectorAll("video"));
    const host = doc.location?.hostname || "";
    if (!/(^|\.)youtube\.com$/.test(host)) return videos;
    const url = new URL(doc.location.href);
    if (url.pathname !== "/watch" || !url.searchParams.get("v")) return videos;
    const id = url.searchParams.get("v");
    const watches = Array.from(
      doc.querySelectorAll("ytd-watch-flexy[video-id]"),
    );
    // A watch root left behind by SPA navigation must not control the new page.
    // If roots exist but none matches the URL, wait for the new player metadata.
    const matching = watches.filter(
      (root) => root.getAttribute("video-id") === id,
    );
    if (watches.length && !matching.length) return [];
    const players = matching.flatMap((root) =>
      Array.from(root.querySelectorAll("#movie_player")),
    );
    if (players.length) {
      const candidates = videos.filter((media) =>
        players.some((player) => player.contains(media)),
      );
      const visible = candidates.filter((media) => {
        for (
          let node = media;
          node && node !== doc.documentElement;
          node = node.parentElement
        ) {
          if (node.hidden) return false;
          const style = doc.defaultView.getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden")
            return false;
        }
        return true;
      });
      const main = visible.filter((media) =>
        media.classList?.contains("html5-main-video"),
      );
      return main.length ? main : visible;
    }
    // Embedded/alternate YouTube layouts without watch roots keep generic discovery.
    return watches.length ? [] : videos;
  }
  function pageMediaKey(media) {
    const doc = media.ownerDocument;
    if (!/(^|\.)youtube\.com$/.test(doc.location?.hostname || "")) return "";
    const url = new URL(doc.location.href);
    return url.pathname === "/watch"
      ? "youtube:" + (url.searchParams.get("v") || "")
      : "";
  }
  function validMediaRequest(media, args = {}) {
    if (!media?.isConnected) return false;
    if (args.pageMediaKey != null && pageMediaKey(media) !== args.pageMediaKey)
      return false;
    if (args.currentSrc != null && (media.currentSrc || "") !== args.currentSrc)
      return false;
    if (args.pageMediaKey) {
      // Capture/control validation must stay local to the selected element. Do not
      // run discovery or computed-style walks once per captured frame.
      const root = media.closest?.("ytd-watch-flexy[video-id]");
      if (root)
        return (
          !root.hidden &&
          "youtube:" + root.getAttribute("video-id") === args.pageMediaKey
        );
      // Legacy/embedded layouts without watch roots retain generic discovery.
      // A video outside an existing watch root is not its selected watch player.
      if (media.ownerDocument.querySelector?.("ytd-watch-flexy[video-id]"))
        return false;
    }
    return true;
  }

  const audioCache = new WeakMap();
  function hasVideoAudioTrack(media, cacheAudio = true) {
    // Track presence is independent of the viewer's mute and volume choices.
    try {
      if (media.srcObject?.getAudioTracks)
        return media.srcObject.getAudioTracks().length > 0;
      if (media.audioTracks) return media.audioTracks.length > 0;
      const key = media.currentSrc || media.src || "";
      const cached = audioCache.get(media);
      if (cacheAudio && cached?.key === key && Date.now() - cached.at < 30000)
        return cached.hasAudio;
      const capture = media.captureStream || media.mozCaptureStream;
      if (typeof capture !== "function") return false;
      const stream = capture.call(media);
      const hasAudio = stream.getAudioTracks().length > 0;
      for (const track of stream.getTracks()) track.stop();
      if (cacheAudio) audioCache.set(media, { key, at: Date.now(), hasAudio });
      return hasAudio;
    } catch (_) {
      return false;
    }
  }

  function list({ requireAudio = false, cacheAudio = true } = {}) {
    const doc = content.document;
    if (!doc) return [];
    const found = [];
    const live = new Set();
    for (const media of discoveryVideos(doc)) {
      if (media.localName !== "video" || media.ended || media.readyState < 1)
        continue;
      const box = media.getBoundingClientRect();
      const x = Math.max(0, box.left);
      const y = Math.max(0, box.top);
      const width = Math.min(content.innerWidth, box.right) - x;
      const height = Math.min(content.innerHeight, box.bottom) - y;
      if (
        media.videoWidth < 240 ||
        media.videoHeight < 135 ||
        (Number.isFinite(media.duration) &&
          media.duration > 0 &&
          media.duration < 8) ||
        (requireAudio && !hasVideoAudioTrack(media, cacheAudio))
      )
        continue;
      let id = ids.get(media);
      if (!id) {
        id = ++nextId;
        ids.set(media, id);
      }
      elements.set(id, media);
      live.add(id);
      const label =
        media.getAttribute("aria-label") ||
        media.getAttribute("title") ||
        media.closest("[aria-label]")?.getAttribute("aria-label") ||
        doc.title ||
        "Video";
      let videoRef = null;
      try {
        const { ContentDOMReference } = ChromeUtils.importESModule(
          "resource://gre/modules/ContentDOMReference.sys.mjs",
        );
        videoRef = ContentDOMReference.get(media);
      } catch (_) {}
      found.push({
        id,
        videoRef,
        documentId: content.windowGlobalChild?.innerWindowId || 0,
        frameId: frameId(),
        label: String(label).slice(0, 100),
        kind: "video",
        canClone: typeof media.cloneElementVisually === "function",
        canStream:
          typeof (media.captureStream || media.mozCaptureStream) === "function",
        canCanvasStream:
          typeof doc.createElement("canvas").captureStream === "function",
        rect: width > 0 && height > 0 ? { x, y, width, height } : null,
        score:
          (media.paused ? 0 : 10000000) +
          Math.max(0, width) * Math.max(0, height),
        paused: media.paused,
        muted: media.muted,
        currentTime: media.currentTime,
        duration: Number.isFinite(media.duration) ? media.duration : 0,
        currentSrc: media.currentSrc || "",
        pageMediaKey: pageMediaKey(media),
        width: media.videoWidth || 0,
        height: media.videoHeight || 0,
      });
    }
    for (const id of elements.keys()) if (!live.has(id)) elements.delete(id);
    return found;
  }

  const frameStates = new WeakMap();
  function stopFrameTracking(media) {
    const state = frameStates.get(media);
    if (!state) return;
    state.active = false;
    try {
      media.cancelVideoFrameCallback?.(state.callbackId);
    } catch (_) {}
    frameStates.delete(media);
  }
  function unchangedFrame(media, frameAware) {
    if (!frameAware || typeof media.requestVideoFrameCallback !== "function")
      return false;
    let state = frameStates.get(media);
    if (!state) {
      state = {
        presented: 0,
        seen: -1,
        callbackAt: 0,
        capturedAt: 0,
        active: true,
        callbackId: null,
      };
      frameStates.set(media, state);
      const tick = (_, metadata) => {
        if (!state.active || !media.isConnected) return;
        state.presented = metadata.presentedFrames;
        state.callbackAt = media.ownerDocument.defaultView.performance.now();
        state.callbackId = media.requestVideoFrameCallback(tick);
      };
      state.callbackId = media.requestVideoFrameCallback(tick);
    }
    const now = media.ownerDocument.defaultView.performance.now();
    if (
      state.seen === state.presented &&
      now - state.callbackAt < 250 &&
      now - state.capturedAt < 1000
    )
      return true;
    state.seen = state.presented;
    state.capturedAt = now;
    return false;
  }

  let captureCanvas, captureContext;
  function captureFrame({
    id,
    captureWidth = 480,
    binary = false,
    frameAware = true,
    pageMediaKey: pageKey,
    currentSrc,
  }) {
    const media = elements.get(id);
    if (
      !validMediaRequest(media, { pageMediaKey: pageKey, currentSrc }) ||
      media.localName !== "video" ||
      media.readyState < 2
    )
      throw new Error("No decoded video frame available");
    if (unchangedFrame(media, frameAware)) return { unchanged: true };
    const maxDimension = Math.max(
      160,
      Math.min(640, Math.round(captureWidth) || 480),
    );
    const width = Math.max(
      1,
      Math.min(
        media.videoWidth,
        Math.round(
          (maxDimension * media.videoWidth) /
            Math.max(media.videoWidth, media.videoHeight),
        ),
      ),
    );
    const height = Math.max(
      1,
      Math.round((width * media.videoHeight) / media.videoWidth),
    );
    captureCanvas ??= content.document.createElement("canvas");
    if (captureCanvas.width !== width || captureCanvas.height !== height) {
      captureCanvas.width = width;
      captureCanvas.height = height;
    }
    captureContext ??= captureCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });
    captureContext.drawImage(media, 0, 0, width, height);
    if (binary)
      return {
        pixels: captureContext.getImageData(0, 0, width, height).data.buffer,
        width,
        height,
      };
    return { url: captureCanvas.toDataURL("image/jpeg", 0.75), width, height };
  }

  function controlMedia({
    id,
    action,
    value,
    pageMediaKey: pageKey,
    currentSrc,
  }) {
    const media = elements.get(id);
    if (!validMediaRequest(media, { pageMediaKey: pageKey, currentSrc }))
      return null;
    switch (action) {
      case "toggle":
        if (media.paused) media.play().catch(() => {});
        else media.pause();
        break;
      case "mute":
        media.muted = !media.muted;
        break;
      case "seek":
        if (Number.isFinite(value) && Number.isFinite(media.duration))
          media.currentTime = Math.max(0, Math.min(media.duration, value));
        break;
    }
    return {
      paused: media.paused,
      muted: media.muted,
      currentTime: media.currentTime,
      duration: Number.isFinite(media.duration) ? media.duration : 0,
    };
  }

  async function onRequest(message) {
    const { requestId, kind, frameId: requestedFrame, ...args } = message.data;
    if (stopped || (kind !== "List" && requestedFrame !== frameId())) return;
    try {
      let result;
      if (kind === "List") result = list(args);
      else if (kind === "Preview") {
        renderer ??= new ZentralVideoRenderer(content.document);
        result = await renderer.start(args);
      } else if (kind === "Health")
        result = renderer?.health() || { ok: false };
      else if (kind === "StopPreview") {
        renderer?.stop();
        result = true;
      } else if (kind === "Caption")
        result = captionText(content.document, elements.get(args.id));
      else if (kind === "WatchCaption")
        result = watchCaption(args.id, args.active);
      else if (kind === "ActorCheck") {
        ChromeUtils.importESModule(args.moduleURI);
        result = true;
      } else
        result = kind === "Capture" ? captureFrame(args) : controlMedia(args);
      if (!stopped) sendAsyncMessage(CHANNEL + ":reply", { requestId, result });
    } catch (error) {
      if (!stopped)
        sendAsyncMessage(CHANNEL + ":reply", {
          requestId,
          error: String(error),
          result: [],
        });
    }
  }
  function onShutdown() {
    stopped = true;
    removeEventListener("yt-navigate-finish", onPageMediaChange, true);
    removeEventListener("popstate", onPageMediaChange, true);
    renderer?.stop();
    removeMessageListener(CHANNEL + ":request", onRequest);
    removeMessageListener(CHANNEL + ":shutdown", onShutdown);
    watchCaption(0, false);
    for (const media of elements.values()) stopFrameTracking(media);
    elements.clear();
    captureCanvas = captureContext = null;
    for (const event of mediaEvents)
      removeEventListener(event, onMediaEvent, true);
  }
  const mediaEvents = [
    "play",
    "playing",
    "pause",
    "ended",
    "emptied",
    "volumechange",
    "loadedmetadata",
    "loadeddata",
    "durationchange",
  ];
  let eventQueued = false;
  function onMediaEvent(event) {
    if (event.target?.localName !== "video" || eventQueued) return;
    eventQueued = true;
    content.setTimeout(() => {
      eventQueued = false;
      if (!stopped)
        sendAsyncMessage(CHANNEL + ":media", { frameId: frameId() });
    }, 100);
  }
  const onPageMediaChange = () => {
    if (!stopped) sendAsyncMessage(CHANNEL + ":media", { frameId: frameId() });
  };
  addEventListener("yt-navigate-finish", onPageMediaChange, true);
  addEventListener("popstate", onPageMediaChange, true);
  for (const event of mediaEvents) addEventListener(event, onMediaEvent, true);
  addEventListener("unload", () => renderer?.stop());
  addMessageListener(CHANNEL + ":request", onRequest);
  addMessageListener(CHANNEL + ":shutdown", onShutdown);
})();
