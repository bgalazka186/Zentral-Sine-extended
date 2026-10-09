/*
 * ZENTRAL FILE GUIDE - features/video/controllers/ZentralVideoCaptions.js
 *
 * Purpose: Optional subtitle watch/event refresh with recovery polling and direct/actor/frame caption
 *   extraction.
 * Interaction / execution: VideoPreview provides live caption state and Transport queries; Sidebar displays
 *   captionNode and Scheduling starts/stops caption work.
 * Ownership / failure: clearCaptionWatch relinquishes owned content watches. Disabled/hidden/disposed state
 *   checks prevent stale subtitle writes; missing controller disables captions without disabling preview.
 * Registration: video/ZentralVideoCaptions
 * Loaded/created by: features/video/ZentralVideoPreview.uc.js
 * Returned factory API: clearCaptionWatch; refreshCaption; setCaption
 * Injected deps state/callbacks used: ACTOR; CAPTIONS_PREF; CAPTION_EVENTS_PREF; CAPTION_RECOVERY_PREF;
 *   SUSPEND_HIDDEN_PREF; SUSPEND_VISIBLE_PREF; bridges; captionBusy; captionIntervalMs; captionNode;
 *   captionText; captionWatch; compactPaused; current; disposed; enabled; featureOn; lastCaptionPollAt;
 *   lastCaptionRecoveryAt; limited; picture; powerOn; previewVisible; query; restartCaptionTimer;
 *   sameSource; sourceVisibilityBlocked; videoHidden
 * Contract fields assigned here: deps.captionBusy; deps.captionNode.hidden; deps.captionNode.textContent;
 *   deps.captionText; deps.captionWatch; deps.lastCaptionPollAt; deps.lastCaptionRecoveryAt
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "video/ZentralVideoCaptions",
    function (deps) {
      function setCaption(text) {
        if (deps.captionText === text && deps.captionNode?.textContent === text)
          return;
        deps.captionText = text;
        if (deps.captionNode) {
          deps.captionNode.textContent = text;
          deps.captionNode.hidden =
            !text || deps.videoHidden || !deps.featureOn(deps.CAPTIONS_PREF);
        }
      }
      function clearCaptionWatch() {
        const watch = deps.captionWatch;
        deps.captionWatch = null;
        deps.lastCaptionPollAt = 0;
        deps.lastCaptionRecoveryAt = 0;
        if (watch && deps.bridges.has(watch.browser))
          deps
            .query(watch.browser, "WatchCaption", {
              frameId: watch.frameId,
              id: watch.id,
              active: false,
            })
            .catch(() => {});
      }
      async function refreshCaption() {
        const source = deps.current;
        if (
          !deps.featureOn(deps.CAPTIONS_PREF) ||
          (deps.powerOn(deps.SUSPEND_HIDDEN_PREF) && !deps.previewVisible()) ||
          (deps.powerOn(deps.SUSPEND_VISIBLE_PREF) &&
            deps.sourceVisibilityBlocked) ||
          deps.videoHidden ||
          deps.compactPaused ||
          !deps.enabled() ||
          !source ||
          source.data.kind !== "video" ||
          !deps.picture?.isConnected ||
          deps.picture.hidden
        ) {
          if (deps.captionText) setCaption("");
          clearCaptionWatch();
          return;
        }
        if (deps.captionBusy) return;
        const watched =
          deps.captionWatch?.browser === source.browser &&
          deps.captionWatch.frameId === source.data.frameId &&
          deps.captionWatch.id === source.data.id;
        const recoveryMs =
          watched &&
          deps.featureOn(deps.CAPTION_EVENTS_PREF) &&
          deps.powerOn(deps.CAPTION_RECOVERY_PREF)
            ? Math.max(3000, deps.captionIntervalMs())
            : deps.captionIntervalMs();
        if (Date.now() - deps.lastCaptionRecoveryAt < recoveryMs) return;
        deps.lastCaptionRecoveryAt = Date.now();
        deps.captionBusy = true;
        try {
          let text = "";
          if (source.method === "frame") {
            const sameWatch =
              deps.captionWatch?.browser === source.browser &&
              deps.captionWatch.frameId === source.data.frameId &&
              deps.captionWatch.id === source.data.id;
            if (!sameWatch) clearCaptionWatch();
            // Rebind occasionally: sites can replace their caption DOM or tracks.
            // A successful watch never suppresses the independent recovery poll.
            if (
              deps.featureOn(deps.CAPTION_EVENTS_PREF) &&
              (!sameWatch || Date.now() - deps.lastCaptionPollAt >= 5000)
            ) {
              const active = await deps.query(source.browser, "WatchCaption", {
                frameId: source.data.frameId,
                id: source.data.id,
                active: true,
              });
              if (
                deps.disposed ||
                source !== deps.current ||
                !deps.enabled() ||
                !deps.featureOn(deps.CAPTIONS_PREF) ||
                deps.videoHidden
              ) {
                deps
                  .query(source.browser, "WatchCaption", {
                    frameId: source.data.frameId,
                    id: source.data.id,
                    active: false,
                  })
                  .catch(() => {});
                return;
              }
              deps.captionWatch = active
                ? {
                    browser: source.browser,
                    frameId: source.data.frameId,
                    id: source.data.id,
                  }
                : null;
              deps.lastCaptionPollAt = Date.now();
            }
            text = await deps.query(source.browser, "Caption", {
              frameId: source.data.frameId,
              id: source.data.id,
            });
          } else if (source.method === "actor")
            text = await deps.limited(
              source.context.currentWindowGlobal
                .getActor(deps.ACTOR)
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
            ) {
              const button = doc.querySelector(".ytp-subtitles-button");
              const active =
                !button ||
                button.getAttribute("aria-pressed") === "true" ||
                button.classList.contains("ytp-button-active");
              text = active
                ? [...doc.querySelectorAll(".ytp-caption-segment")]
                    .filter((node) => {
                      for (
                        let ancestor = node;
                        ancestor;
                        ancestor = ancestor.parentElement
                      ) {
                        const style =
                          doc.defaultView.getComputedStyle(ancestor);
                        if (
                          ancestor.hidden ||
                          style.display === "none" ||
                          style.visibility === "hidden" ||
                          style.opacity === "0"
                        )
                          return false;
                      }
                      return true;
                    })
                    .map((node) => node.textContent.trim())
                    .filter(Boolean)
                    .join(" ")
                : "";
            }
          }
          if (
            source === deps.current &&
            deps.enabled() &&
            deps.featureOn(deps.CAPTIONS_PREF) &&
            !deps.videoHidden &&
            !deps.compactPaused &&
            (!deps.powerOn(deps.SUSPEND_HIDDEN_PREF) || deps.previewVisible())
          )
            setCaption(String(text || "").slice(0, 1000));
        } catch (_) {
          if (deps.sameSource(source, deps.current)) setCaption("");
        } finally {
          deps.captionBusy = false;
          deps.restartCaptionTimer();
        }
      }
      return { setCaption, clearCaptionWatch, refreshCaption };
    },
  );
})();
