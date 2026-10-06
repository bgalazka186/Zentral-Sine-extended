/*
 * ZENTRAL FILE GUIDE - features/video/content/ZentralVideoActor.sys.mjs
 *
 * Purpose: Versioned Gecko window actor classes and content-side media/renderer implementation with
 *   document leases, identity checks and receiver teardown.
 * Interaction / execution: Transport registers this installed module through a versioned resource
 *   alias and sends queries. Actor child works in the source/receiver document, parent is the privileged
 *   IPC endpoint.
 * Ownership / failure: Execution environment is JSWindowActor, not a window.ZentralModuleLoader factory.
 *   Shared renderer code is duplicated with Frame in this supplied runtime-only tree; its historical
 *   templates/build tool are absent. Edit/check both implementations when changing shared behavior.
 * Loaded/created by: features/video/ZentralVideoPreview.uc.js
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
// CONTENT HELPER: shared by frame and actor transports; generated into readable content helper files.
// Normal leases allow sidebar renderers. Full experimental leases additionally
// permit source-document controls and explicit legacy capture. The experiments
// directory and older function names are compatibility history, not a gate for
// promoted playback. Browser UI/preferences and receiver creation stay parent-side.
//
// Maintainer sections: authorization -> source probe -> renderer attachment ->
// ongoing presentation/track handling -> health -> owned-resource teardown.
// Historical templates/build tool are absent here; coordinate shared edits in Frame and Actor.
const EXPERIMENT_HELPER_ID = "4a4f1a02e13063aa";
const EXPERIMENT_BUILD = "video-preview-2026-10-04-25-regression-fix";
// User preferences are owned by chrome; content may not see the same value.
// Only privileged parent IPC can grant this document a short-lived lease.
const experimentLeases = new WeakMap();
const nativeOnlyLeases = new WeakSet();
const normalOnlyLeases = new WeakSet();
function authorizeExperiments(doc, data = {}) {
  if (
    data.experimentalEnabled === true ||
    data.nativeEnabled === true ||
    data.previewEnabled === true
  ) {
    // Normal about:blank sidebar receivers renew through parent Health IPC.
    // A 15 s health interval must not race a 15 s expiry. Keep a bounded
    // 60 s lease without adding heartbeat work; source experiments retain 15 s.
    const sidebarLease =
      doc.documentURI === "about:blank" &&
      (data.previewEnabled === true || data.nativeEnabled === true);
    experimentLeases.set(doc, Date.now() + (sidebarLease ? 60000 : 15000));
    if (data.experimentalEnabled === true) {
      nativeOnlyLeases.delete(doc);
      normalOnlyLeases.delete(doc);
    } else {
      normalOnlyLeases.add(doc);
      if (data.previewEnabled === true) nativeOnlyLeases.delete(doc);
      else nativeOnlyLeases.add(doc);
    }
  } else if (data.experimentalEnabled === false) {
    experimentLeases.delete(doc);
    nativeOnlyLeases.delete(doc);
    normalOnlyLeases.delete(doc);
  }
}
function experimentsEnabled(doc) {
  return !!doc && (experimentLeases.get(doc) || 0) > Date.now();
}
function previewError(stage, message) {
  const error = new Error(stage + ": " + message);
  error.stage = stage;
  return error;
}
function previewIdentity(doc) {
  const win = doc?.defaultView;
  const principal = doc?.nodePrincipal;
  const attrs = principal?.originAttributes || {};
  return {
    documentId: win?.windowGlobalChild?.innerWindowId || 0,
    contextId: win?.browsingContext?.id || 0,
    // No full URLs, media addresses, titles or tokens in experiment telemetry.
    principalKind: principal?.isSystemPrincipal
      ? "system"
      : principal?.isNullPrincipal
        ? "null"
        : "content",
    originAttributes: {
      userContextId: attrs.userContextId || 0,
      privateBrowsingId: attrs.privateBrowsingId || 0,
    },
  };
}
// Conservative viewport check; a partially visible video stays on its page.
function sourceVideoVisible(media, ignoreDocumentVisibility = false) {
  try {
    let doc = media.ownerDocument;
    if (!ignoreDocumentVisibility && doc.visibilityState === "hidden")
      return false;
    let node = media;
    for (;;) {
      const win = doc.defaultView,
        rect = node.getBoundingClientRect();
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
        const style = win.getComputedStyle(ancestor);
        if (
          ancestor.hidden ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          style.opacity === "0"
        )
          return false;
      }
      if (
        rect.width < 1 ||
        rect.height < 1 ||
        rect.right <= 0 ||
        rect.bottom <= 0 ||
        rect.left >= win.innerWidth ||
        rect.top >= win.innerHeight
      )
        return false;
      if (!win.frameElement) return true;
      node = win.frameElement;
      doc = node.ownerDocument;
    }
  } catch (_) {
    return true;
  }
}
async function probeSourceVideo(doc, args) {
  if (!experimentsEnabled(doc))
    throw previewError("disabled", "Parent authorization missing");
  const { ContentDOMReference } = ChromeUtils.importESModule(
    "resource://gre/modules/ContentDOMReference.sys.mjs",
  );
  const media = await ContentDOMReference.resolve(args.videoRef);
  if (
    !media?.isConnected ||
    media.ownerDocument !== doc ||
    media.localName !== "video"
  )
    throw previewError("reference", "Selected video is not in this document");
  return {
    build: EXPERIMENT_BUILD,
    helperId: EXPERIMENT_HELPER_ID,
    visible: sourceVideoVisible(media, args.ignoreDocumentVisibility),
    identity: previewIdentity(doc),
    permission: "parent-lease",
    clone: typeof media.cloneElementVisually === "function",
    cloneBusy: !!media.isCloningElementVisually,
    encrypted: !!media.mediaKeys,
    stream: typeof media.captureStream === "function",
    legacyStream: typeof media.mozCaptureStream === "function",
    canvasStream:
      typeof doc.createElement("canvas").captureStream === "function",
    srcObject: !!media.srcObject,
    paused: media.paused,
    ended: media.ended,
    time: media.currentTime,
    muted: media.muted,
    volume: media.volume,
    readyState: media.readyState,
    dimensions: [media.videoWidth, media.videoHeight],
  };
}
// ATTACHMENT: native shares decoded output; streams share/clone video tracks;
// canvas stream draws in the SOURCE document to preserve its origin context.
// Every awaited attachment is fenced by session identity to handle late results.
class ZentralVideoRenderer {
  constructor(doc) {
    this.doc = doc;
    this.serial = 0;
    this.session = null;
  }
  async start({
    videoRef,
    mode,
    fit = "contain",
    sourceDocumentId = 0,
    sourcePageMediaKey = null,
    sourceCurrentSrc = null,
    canvasStreamWidth = 640,
    canvasStreamFps = 30,
    sameDocument = false,
    allowLegacyCapture = false,
    requireHiddenSource = false,
    durationMs = 60000,
    lightMonitoring = false,
  } = {}) {
    if (!experimentsEnabled(this.doc))
      throw previewError(
        "disabled",
        "Experimental Video Bridge disabled in settings",
      );
    if (!sameDocument && this.doc?.documentURI !== "about:blank")
      throw previewError("receiver-document", "Expected about:blank");
    if (nativeOnlyLeases.has(this.doc) && (mode !== "native" || sameDocument))
      throw previewError(
        "disabled",
        "Only normal sidebar native cloning is authorized",
      );
    if (normalOnlyLeases.has(this.doc) && (sameDocument || allowLegacyCapture))
      throw previewError(
        "disabled",
        "Source tests and legacy capture require Video experiments",
      );
    this.stop();
    this.lastStopReason = null;
    const serial = this.serial;
    const { ContentDOMReference } = ChromeUtils.importESModule(
      "resource://gre/modules/ContentDOMReference.sys.mjs",
    );
    const media = await ContentDOMReference.resolve(videoRef);
    if (serial !== this.serial || !experimentsEnabled(this.doc))
      throw previewError("cancelled", "Preview cancelled");
    if (!media?.isConnected || media.localName !== "video")
      throw previewError(
        "reference",
        "Video reference unavailable in receiver process",
      );
    if (
      !validMediaRequest(media, {
        pageMediaKey: sourcePageMediaKey,
        currentSrc: sourceCurrentSrc,
      })
    )
      throw previewError(
        "expired-reference",
        "Source video changed; refresh sources",
      );
    const sourceDoc = media.ownerDocument;
    const identity = previewIdentity(sourceDoc);
    if (sourceDocumentId && identity.documentId !== sourceDocumentId)
      throw previewError(
        "expired-reference",
        "Source document changed; refresh sources",
      );
    if (sameDocument && sourceDoc !== this.doc)
      throw previewError(
        "receiver-document",
        "Control must run in the source document",
      );
    if (requireHiddenSource && sourceVideoVisible(media))
      throw previewError(
        "source-visible",
        "Keep video on its page while visible",
      );
    const doc = this.doc,
      win = doc.defaultView;
    const s = (this.session = {
      serial,
      media,
      doc,
      win,
      mode,
      stage: "receiver",
      stopped: false,
      cleanups: [],
      ownedTracks: new Set(),
      trackClones: new Map(),
      tracked: new Set(),
      waiters: new Set(),
      presentedCallbacks: 0,
      lastPresentedAt: 0,
      attached: false,
      startedAt: Date.now(),
      sourceSrc: media.currentSrc,
      sourceObject: media.srcObject,
      sourcePageMediaKey: pageMediaKey(media),
      sameDocument,
      requireHiddenSource,
      identity,
      targetIdentity: previewIdentity(doc),
      allowLegacyCapture,
    });
    // Retain the public helper properties used by older diagnostics.
    this.source = media;
    this.mode = mode;
    try {
      this.listen(s, sourceDoc.defaultView, "pagehide", () =>
        this.stopSession(s),
      );
      this.listen(s, win, "pagehide", () => this.stopSession(s));
      if (!doc.body)
        throw previewError("receiver-document", "Receiver body is not ready");
      const target = (s.target = doc.createElement("video"));
      this.video = target;
      target.setAttribute("data-zentral-preview-owned", "true");
      target.muted = true;
      target.defaultMuted = true;
      target.autoplay = true;
      target.playsInline = true;
      target.style.cssText =
        "display:block;width:100%;height:100%;object-fit:" +
        (fit === "cover" ? "cover" : "contain") +
        ";background:#000;pointer-events:none";
      const host = (s.host = doc.createElement("div"));
      host.setAttribute("data-zentral-preview-owned", "true");
      host.style.cssText = sameDocument
        ? "position:fixed;right:12px;bottom:12px;width:320px;height:180px;z-index:2147483647;background:#000;pointer-events:none"
        : "position:fixed;inset:0;background:#000;overflow:hidden";
      host.appendChild(target);
      doc.body.appendChild(host);
      if (sameDocument) {
        const label = doc.createElement("div");
        label.textContent =
          "Zentral experiment \u00b7 " + mode + " \u00b7 closes automatically";
        label.style.cssText =
          "position:absolute;top:0;left:0;padding:4px;background:#000b;color:white;font:11px sans-serif";
        host.appendChild(label);
      }
      if (typeof target.requestVideoFrameCallback === "function") {
        const tick = () => {
          if (!this.active(s)) return;
          s.presentedCallbacks++;
          s.lastPresentedAt = Date.now();
          this.presentedCallbacks = s.presentedCallbacks;
          // Sample presentation without a per-frame JS wakeup in normal playback.
          // Keep the first callback immediate: startup MUST still prove presentation.
          if (lightMonitoring && !sameDocument) {
            s.frameSampleTimer = win.setTimeout(() => {
              s.frameSampleTimer = null;
              if (this.active(s))
                s.frameCallback = target.requestVideoFrameCallback(tick);
            }, 2000);
          } else s.frameCallback = target.requestVideoFrameCallback(tick);
        };
        s.frameCallback = target.requestVideoFrameCallback(tick);
      }
      if (mode === "native") {
        s.stage = "clone-attachment";
        if (media.isCloningElementVisually)
          throw previewError(
            "clone-busy",
            "Source already has a visual clone; leave existing PiP untouched",
          );
        if (typeof media.cloneElementVisually !== "function")
          throw previewError("capability", "Native cloning unavailable");
        // Bounded even when Gecko's attachment promise never settles. Detaching
        // OUR target cancels cloning; never stop an unrelated/newer source clone.
        const attachment = media.cloneElementVisually(target);
        s.cloneRequested = true;
        // Gecko may register the clone without settling its attachment promise.
        // Registration is not presentation; the parent still checks the target.
        await this.waitClone(s, attachment, 2500);
        this.assertActive(s);
        s.attached = true;
      } else if (mode === "stream") {
        s.stage = "capture";
        if (media.mediaKeys)
          throw previewError(
            "protected-media",
            "Encrypted media cannot be stream-captured",
          );
        await this.waitFor(
          s,
          () => media.readyState >= 2 && media.videoWidth > 0,
          2000,
          "source-readiness",
        );
        if (media.srcObject?.getVideoTracks) {
          s.capture = media.srcObject;
          s.borrowedCapture = true;
          s.captureKind = "srcObject video-track clones";
        } else {
          const capture =
            media.captureStream ||
            (allowLegacyCapture && media.mozCaptureStream);
          if (typeof capture !== "function")
            throw previewError(
              "capability",
              media.mozCaptureStream
                ? "Only legacy mozCaptureStream available; enable its separate audio-risk opt-in to test"
                : "Stream capture unavailable",
            );
          s.captureKind = media.captureStream
            ? "captureStream"
            : "mozCaptureStream (legacy opt-in)";
          try {
            s.capture = capture.call(media);
          } catch (error) {
            throw previewError("capture", error.name || String(error));
          }
          for (const track of s.capture.getTracks()) s.ownedTracks.add(track);
        }
        this.stream = s.capture;
        const output = (s.output = new win.MediaStream());
        target.srcObject = output;
        const sync = () => this.syncTracks(s);
        this.listen(s, s.capture, "addtrack", sync);
        this.listen(s, s.capture, "removetrack", sync);
        sync();
        await this.waitFor(
          s,
          () =>
            output
              .getVideoTracks()
              .some((t) => t.readyState === "live" && !t.muted),
          2000,
          "video-track",
        );
        s.stage = "target-play";
        await this.waitPromise(s, target.play(), 1500, "target-play");
        s.attached = true;
        await this.firstFrame(target);
      } else if (mode === "canvas-stream") {
        s.stage = "canvas-readback";
        if (media.mediaKeys)
          throw previewError(
            "protected-media",
            "Encrypted media cannot be canvas-captured",
          );
        await this.waitFor(
          s,
          () => media.readyState >= 2 && media.videoWidth > 0,
          2000,
          "source-readiness",
        );
        const surface = (s.surface = sourceDoc.createElement("canvas"));
        const ctx = surface.getContext("2d", {
          alpha: false,
          willReadFrequently: true,
        });
        if (!ctx || typeof surface.captureStream !== "function")
          throw previewError("capability", "Canvas stream unavailable");
        const streamWidth = [160, 240, 320, 480, 640].includes(
          canvasStreamWidth,
        )
          ? canvasStreamWidth
          : 640;
        const streamFps = [5, 10, 15, 24, 30].includes(canvasStreamFps)
          ? canvasStreamFps
          : 30;
        const draw = () => {
          if (!this.active(s) || media.readyState < 2) return;
          const width = Math.max(1, Math.min(streamWidth, media.videoWidth));
          const height = Math.max(
            1,
            Math.round(
              (width * media.videoHeight) / Math.max(1, media.videoWidth),
            ),
          );
          const resized = surface.width !== width || surface.height !== height;
          if (resized) {
            surface.width = width;
            surface.height = height;
          }
          ctx.drawImage(media, 0, 0, width, height);
          // Prove origin cleanliness before capture and after resizing, then
          // recheck periodically instead of synchronously reading every frame.
          if (resized || Date.now() >= (s.nextReadabilityCheck || 0)) {
            ctx.getImageData(0, 0, 1, 1);
            s.nextReadabilityCheck = Date.now() + 1000;
          }
        };
        try {
          draw();
        } catch (error) {
          throw previewError("origin-clean", error.name || String(error));
        }
        s.capture = surface.captureStream(streamFps);
        this.stream = s.capture;
        for (const track of s.capture.getTracks()) s.ownedTracks.add(track);
        s.output = s.capture;
        target.srcObject = s.output;
        let lastTime = NaN;
        s.drawTimer = win.setInterval(() => {
          if (!this.active(s) || s.failure) return;
          if (media.currentTime === lastTime) return;
          try {
            draw();
            lastTime = media.currentTime;
          } catch (error) {
            s.failure = "origin-clean: " + (error.name || String(error));
          }
        }, 1000 / streamFps);
        s.stage = "target-play";
        await this.waitPromise(s, target.play(), 1500, "target-play");
        s.attached = true;
        await this.firstFrame(target);
      } else throw previewError("capability", "Unknown preview mode");
      this.assertActive(s);
      s.stage = "presentation";
      // Native clones need not update media-element readyState. Parent checks
      // target frame telemetry / bounded snapshot evidence separately.
      s.monitor = win.setInterval(
        () => {
          if (s.requireHiddenSource && sourceVideoVisible(media)) {
            this.lastStopReason = "source-visible: Source returned to view";
            this.stopSession(s);
            return;
          }
          if (!experimentsEnabled(this.doc)) {
            this.lastStopReason =
              "authorization-expired: Parent preview authorization expired";
            this.stopSession(s);
            return;
          }
          if (!media.isConnected || !target.isConnected) {
            this.stopSession(s);
            return;
          }
          if (
            media.currentSrc !== s.sourceSrc ||
            media.srcObject !== s.sourceObject ||
            pageMediaKey(media) !== s.sourcePageMediaKey
          )
            s.failure =
              "source-replaced: Refresh the preview for the new media resource";
          if (s.mode === "stream") this.syncTracks(s);
        },
        lightMonitoring && !sameDocument ? 1000 : 250,
      );
      if (sameDocument)
        s.deadline = win.setTimeout(
          () => this.stopSession(s),
          Math.max(1000, Math.min(65000, durationMs)),
        );
      return {
        ok: true,
        mode,
        build: EXPERIMENT_BUILD,
        helperId: EXPERIMENT_HELPER_ID,
        attached: true,
        source: s.identity,
        target: s.targetIdentity,
        sameOrigin: this.sameOrigin(s),
        capture: s.captureKind || mode,
      };
    } catch (error) {
      this.stopSession(s);
      throw error?.stage
        ? error
        : previewError(s.stage, error?.name || String(error));
    }
  }
  sameOrigin(s) {
    try {
      return s.media.ownerDocument.nodePrincipal.equals(s.doc.nodePrincipal);
    } catch (_) {
      return null;
    }
  }
  active(s) {
    return this.session === s && !s.stopped && s.serial === this.serial;
  }
  assertActive(s) {
    if (!this.active(s) || !experimentsEnabled(this.doc))
      throw previewError("cancelled", "Preview cancelled");
  }
  listen(s, object, name, callback) {
    object.addEventListener(name, callback);
    s.cleanups.push(() => object.removeEventListener(name, callback));
  }
  waitPromise(s, promise, ms, stage) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, value) => {
        if (done) return;
        done = true;
        s.win.clearTimeout(timer);
        s.waiters.delete(cancel);
        error ? reject(error) : resolve(value);
      };
      const cancel = () =>
        finish(previewError("cancelled", "Preview cancelled"));
      const timer = s.win.setTimeout(
        () => finish(previewError(stage, "Timed out")),
        ms,
      );
      s.waiters.add(cancel);
      Promise.resolve(promise).then(
        (value) => finish(null, value),
        (error) => finish(error),
      );
      if (!this.active(s)) cancel();
    });
  }
  waitClone(s, attachment, milliseconds) {
    return new Promise((resolve, reject) => {
      let done = false,
        timer;
      const started = Date.now();
      const finish = (error) => {
        if (done) return;
        done = true;
        s.win.clearTimeout(timer);
        s.waiters.delete(cancel);
        error ? reject(error) : resolve();
      };
      const cancel = () =>
        finish(previewError("cancelled", "Preview cancelled"));
      const tick = () => {
        if (!this.active(s) || !experimentsEnabled(this.doc)) {
          cancel();
          return;
        }
        if (s.media.isCloningElementVisually) {
          finish();
          return;
        }
        if (Date.now() - started >= milliseconds) {
          finish(previewError("clone-attachment", "Timed out"));
          return;
        }
        timer = s.win.setTimeout(tick, 40);
      };
      s.waiters.add(cancel);
      Promise.resolve(attachment).then(
        () => {
          if (this.active(s)) {
            s.cloneSettled = true;
            finish();
          }
        },
        (error) => {
          if (this.active(s)) {
            s.failure = "clone-attachment: " + String(error);
            finish(error);
          }
        },
      );
      tick();
    });
  }
  waitFor(s, predicate, ms, stage) {
    return new Promise((resolve, reject) => {
      let done = false,
        timer;
      const started = Date.now();
      const finish = (error) => {
        if (done) return;
        done = true;
        s.win.clearTimeout(timer);
        s.waiters.delete(cancel);
        error ? reject(error) : resolve();
      };
      const cancel = () =>
        finish(previewError("cancelled", "Preview cancelled"));
      const tick = () => {
        if (!this.active(s) || !experimentsEnabled(this.doc)) {
          cancel();
          return;
        }
        try {
          if (predicate()) {
            finish();
            return;
          }
          if (s.failure) {
            finish(previewError(stage, s.failure));
            return;
          }
        } catch (error) {
          finish(error);
          return;
        }
        if (Date.now() - started >= ms) {
          finish(previewError(stage, "Timed out"));
          return;
        }
        timer = s.win.setTimeout(tick, 40);
      };
      s.waiters.add(cancel);
      tick();
    });
  }
  firstFrame(target) {
    const s = this.session;
    if (!s || s.target !== target)
      return Promise.reject(previewError("cancelled", "Preview cancelled"));
    return this.waitFor(
      s,
      () => target.readyState >= 2 && target.videoWidth > 0,
      1800,
      "first-frame",
    );
  }
  syncTracks(s) {
    if (!this.active(s) || !s.capture || !s.output) return;
    try {
      const tracks = s.capture
        .getVideoTracks()
        .filter((t) => t.readyState !== "ended");
      for (const [original, clone] of s.trackClones) {
        if (tracks.includes(original)) continue;
        s.output.removeTrack(clone);
        clone.stop();
        s.ownedTracks.delete(clone);
        s.trackClones.delete(original);
      }
      for (const original of tracks) {
        if (!s.tracked.has(original)) {
          s.tracked.add(original);
          if (!s.borrowedCapture) s.ownedTracks.add(original);
          for (const event of ["mute", "unmute", "ended"])
            this.listen(s, original, event, () => {
              s.trackEvent = event;
              this.syncTracks(s);
            });
        }
        if (!s.trackClones.has(original)) {
          const clone = original.clone();
          s.ownedTracks.add(clone);
          s.trackClones.set(original, clone);
          s.output.addTrack(clone);
        }
      }
      // Captured audio is never connected to the target. Dispose only tracks
      // from a stream we created, never the source's srcObject audio/video.
      if (!s.borrowedCapture)
        for (const track of s.capture.getAudioTracks()) {
          if (!s.ownedTracks.has(track)) s.ownedTracks.add(track);
          if (track.readyState !== "ended") track.stop();
        }
    } catch (error) {
      s.failure = "track-replacement: " + (error.name || String(error));
    }
  }
  // HEALTH: native clones need not advance normal HTML video playback fields.
  // Target presentation counters are separate from source decoding counters.
  health() {
    const s = this.session;
    if (!s || !this.active(s))
      return {
        ok: false,
        error: this.lastStopReason || "Preview stopped",
        stage: "stopped",
        build: EXPERIMENT_BUILD,
      };
    if (!experimentsEnabled(this.doc)) {
      this.lastStopReason =
        "authorization-expired: Parent preview authorization expired";
      this.stop();
      return {
        ok: false,
        error: this.lastStopReason,
        stage: "disabled",
        build: EXPERIMENT_BUILD,
      };
    }
    const target = s.target,
      media = s.media;
    const tracks = s.output?.getVideoTracks() || [];
    const rect = target.getBoundingClientRect();
    const frames = target.getVideoPlaybackQuality?.().totalVideoFrames || 0;
    const paintedFrames = target.mozPaintedFrames || 0;
    const attached =
      s.attached && (s.mode !== "native" || !!media.isCloningElementVisually);
    const connected = !!target.isConnected && !!media.isConnected;
    const presented = s.presentedCallbacks > 0 || paintedFrames > 0;
    const recovering =
      s.mode !== "native" &&
      (!tracks.some((t) => t.readyState === "live" && !t.muted) ||
        target.readyState < 2);
    if (recovering && !s.recoveringSince) s.recoveringSince = Date.now();
    if (!recovering) s.recoveringSince = 0;
    const ok =
      connected &&
      attached &&
      !s.failure &&
      (!recovering || Date.now() - s.recoveringSince < 5000);
    return {
      ok,
      attached,
      presented,
      recovering,
      stage: s.failure ? "failed" : s.stage,
      error: ok
        ? null
        : s.failure || "Preview disconnected or video tracks unavailable",
      build: EXPERIMENT_BUILD,
      paused: media.paused,
      ended: media.ended,
      time: media.currentTime,
      frames,
      paintedFrames,
      sourceFrames: media.getVideoPlaybackQuality?.().totalVideoFrames || 0,
      presentedCallbacks: s.presentedCallbacks,
      lastPresentedAt: s.lastPresentedAt,
      readyState: target.readyState,
      targetPaused: target.paused,
      targetTime: target.currentTime,
      visibility: this.doc.visibilityState,
      dimensions: [target.videoWidth, target.videoHeight],
      targetRect: [Math.round(rect.width), Math.round(rect.height)],
      targetBox: [
        Math.round(rect.x || 0),
        Math.round(rect.y || 0),
        Math.round(rect.width),
        Math.round(rect.height),
      ],
      viewport: [s.win.innerWidth, s.win.innerHeight],
      source: s.identity,
      target: s.targetIdentity,
      sameOrigin: this.sameOrigin(s),
      capture: s.captureKind || s.mode,
      trackEvent: s.trackEvent || null,
      tracks: tracks.map((t) => ({ readyState: t.readyState, muted: t.muted })),
    };
  }
  stopSession(s) {
    if (!s || s.stopped) return;
    s.stopped = true;
    for (const cancel of [...s.waiters]) cancel();
    if (s.frameSampleTimer != null) s.win.clearTimeout(s.frameSampleTimer);
    s.frameSampleTimer = null;
    for (const key of ["drawTimer", "monitor"])
      if (s[key] != null) s.win.clearInterval(s[key]);
    if (s.deadline != null) s.win.clearTimeout(s.deadline);
    try {
      s.target?.cancelVideoFrameCallback?.(s.frameCallback);
    } catch (_) {}
    for (const cleanup of s.cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (_) {}
    }
    // Gecko ends cloning when the target is detached. Calling the source-wide
    // stopCloningElementVisually here could stop a user's newer PiP session.
    try {
      s.target?.remove();
      s.host?.remove();
    } catch (_) {}
    try {
      if (s.target) {
        s.target.pause();
        s.target.srcObject = null;
      }
    } catch (_) {}
    for (const track of s.ownedTracks) {
      try {
        track.stop();
      } catch (_) {}
    }
    s.ownedTracks.clear();
    s.trackClones.clear();
    s.tracked.clear();
    if (this.session === s) {
      this.session = null;
      this.source = this.video = this.stream = null;
      this.failure = null;
      this.presentedCallbacks = 0;
    }
  }
  // TEARDOWN: never stop borrowed source tracks or pause/mute the page video.
  stop() {
    ++this.serial;
    this.stopSession(this.session);
  }
}

function discoveryVideos(doc) {
  const videos = Array.from(doc.querySelectorAll("video"));
  const host = doc.location?.hostname || "";
  if (!/(^|\.)youtube\.com$/.test(host)) return videos;
  const url = new URL(doc.location.href);
  if (url.pathname !== "/watch" || !url.searchParams.get("v")) return videos;
  const id = url.searchParams.get("v");
  const watches = Array.from(doc.querySelectorAll("ytd-watch-flexy[video-id]"));
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
    const hasAudio =
      typeof media.mozHasAudio === "boolean" ? media.mozHasAudio : true;
    if (cacheAudio) audioCache.set(media, { key, at: Date.now(), hasAudio });
    return hasAudio;
  } catch (_) {
    return false;
  }
}

function captionText(doc, media = null) {
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

// Content-process source discovery for Zentral's sidebar video preview.
// It never changes playback unless the user presses a preview control.
export class ZentralVideoBridgeChild extends JSWindowActorChild {
  async receiveMessage(message) {
    authorizeExperiments(this.document, message.data);
    if (
      [
        "Ready",
        "Probe",
        "Preview",
        "Health",
        "ControlPreview",
        "ControlHealth",
      ].includes(message.name) &&
      !experimentsEnabled(this.document)
    )
      throw previewError(
        "disabled",
        "Experimental Video Bridge disabled in settings",
      );
    if (message.name === "Ready")
      return {
        build: EXPERIMENT_BUILD,
        helperId: EXPERIMENT_HELPER_ID,
        ready: !!this.document.body && this.document.readyState !== "loading",
        documentURI: this.document.documentURI,
        identity: previewIdentity(this.document),
      };
    if (message.name === "Probe")
      return probeSourceVideo(this.document, message.data);
    if (message.name === "ControlPreview") {
      this.controlRenderer ??= new ZentralVideoRenderer(this.document);
      return this.controlRenderer.start({
        ...message.data,
        sameDocument: true,
      });
    }
    if (message.name === "ControlHealth")
      return this.controlRenderer?.health() || { ok: false };
    if (message.name === "StopControl") {
      this.controlRenderer?.stop();
      return true;
    }
    if (message.name === "List") return this.list(message.data);
    if (message.name === "Control") return this.control(message.data);
    if (message.name === "Capture") return this.capture(message.data);
    if (message.name === "Caption")
      return captionText(this.document, this.elements?.get(message.data?.id));
    if (message.name === "Health")
      return this.renderer?.health() || { ok: false };
    if (message.name === "Preview") return this.preview(message.data);
    if (message.name === "StopPreview") {
      this.stopPreview();
      return true;
    }
    return null;
  }

  list({ requireAudio = false, cacheAudio = true } = {}) {
    const doc = this.document;
    const win = this.contentWindow;
    if (!doc || !win) return [];
    this.ids ??= new WeakMap();
    this.elements ??= new Map();
    this.nextId ??= 1;
    const found = [];
    const live = new Set();

    for (const media of discoveryVideos(doc)) {
      if (
        media.hasAttribute("data-zentral-preview-owned") ||
        media.localName !== "video" ||
        media.ended ||
        media.readyState < 1
      )
        continue;
      const box = media.getBoundingClientRect();
      const x = Math.max(0, box.left);
      const y = Math.max(0, box.top);
      const width = Math.min(win.innerWidth, box.right) - x;
      const height = Math.min(win.innerHeight, box.bottom) - y;
      // Require decoded video frames; skip tiny decorative clips.
      if (
        media.videoWidth < 240 ||
        media.videoHeight < 135 ||
        (Number.isFinite(media.duration) &&
          media.duration > 0 &&
          media.duration < 8) ||
        (requireAudio && !hasVideoAudioTrack(media, cacheAudio))
      )
        continue;

      let id = this.ids.get(media);
      if (!id) {
        id = this.nextId++;
        this.ids.set(media, id);
      }
      this.elements.set(id, media);
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
      } catch (_) {
        /* Snapshot / canvas capture can still work. */
      }
      found.push({
        id,
        videoRef,
        documentId: this.manager?.innerWindowId || 0,
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
    for (const id of this.elements.keys())
      if (!live.has(id)) this.elements.delete(id);
    return found;
  }

  capture({
    id,
    captureWidth = 480,
    binary = false,
    frameAware = true,
    pageMediaKey: pageKey,
    currentSrc,
  } = {}) {
    const media = this.elements?.get(id);
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
    this.captureCanvas ??= this.document.createElement("canvas");
    if (
      this.captureCanvas.width !== width ||
      this.captureCanvas.height !== height
    ) {
      this.captureCanvas.width = width;
      this.captureCanvas.height = height;
    }
    this.captureContext ??= this.captureCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });
    this.captureContext.drawImage(media, 0, 0, width, height);
    if (binary)
      return {
        pixels: this.captureContext.getImageData(0, 0, width, height).data
          .buffer,
        width,
        height,
      };
    return {
      url: this.captureCanvas.toDataURL("image/jpeg", 0.75),
      width,
      height,
    };
  }

  async preview(data) {
    this.renderer ??= new ZentralVideoRenderer(this.document);
    return this.renderer.start(data);
  }

  stopPreview() {
    this.renderer?.stop();
  }

  didDestroy() {
    this.stopPreview();
    this.controlRenderer?.stop();
    for (const media of this.elements?.values() || []) stopFrameTracking(media);
    this.elements?.clear();
    this.captureCanvas = this.captureContext = null;
  }

  control({ id, action, value, pageMediaKey: pageKey, currentSrc } = {}) {
    const media = this.elements?.get(id);
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
}

export { ZentralVideoBridgeChild as ZentralVideoBridgeV12_4a4f1a02e13063aaChild };
