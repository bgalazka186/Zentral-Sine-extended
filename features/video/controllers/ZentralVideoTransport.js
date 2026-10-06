/*
 * ZENTRAL FILE GUIDE - features/video/controllers/ZentralVideoTransport.js
 *
 * Purpose: Registers the versioned actor, creates/releases frame bridges and bounds parent/content/player
 *   requests.
 * Interaction / execution: VideoPreview supplies ACTOR/channel/helper strings and live request state.
 *   Discovery asks for media sources, Rendering asks for receiver operations, Captions and Diagnostics use
 *   the same IPC.
 * Ownership / failure: Owns per-browser bridge/pending request handling; VideoPreview cleanup releases
 *   bridges. Actor/frame/basic-frame helpers are separate execution environments, not interchangeable
 *   files.
 * Registration: video/ZentralVideoTransport
 * Loaded/created by: features/video/ZentralVideoPreview.uc.js
 * Returned factory API: bridge; ensureActor; limited; playerQuery; query; releaseBridge
 * Injected deps state/callbacks used: ACTOR; CAPTIONS_PREF; CAPTION_EVENTS_PREF; CHANNEL;
 *   EXPERIMENTAL_ACTOR_SOURCE; EXPERIMENTAL_FRAME_URI; EXPERIMENT_HELPER_ID; FRAME_URI; MEDIA_EVENTS_PREF;
 *   Services; actorAttempted; actorModuleURI; actorReady; bridges; captionWatch; current; diagnostics;
 *   enabled; experimentalBridgeDisabled; featureOn; liveBridgeEnabled; liveModeEnabled; methodError;
 *   methodState; nextRequest; normalLivePreviewEnabled; queueDiscovery; setCaption; videoHidden
 * Contract fields assigned here: deps.actorAttempted; deps.actorModuleURI; deps.actorReady;
 *   deps.diagnostics.module; deps.methodState.actor; deps.methodState.frame; deps.nextRequest
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("video/ZentralVideoTransport", function (deps) {
        function ensureActor() {
          // Discovery List queries do not require live-renderer authorization.
          // Registration is still lazy when the selected renderer is still-only.
          if (deps.actorAttempted) return deps.actorReady;
          deps.actorAttempted = true;
          try {
            const file = deps.Services.dirsvc.get("UChrm", Ci.nsIFile);
            file.append(
              "zentral-video-bridge-v12-" + deps.EXPERIMENT_HELPER_ID + ".sys.mjs",
            );
            // Versioned URI and actor name prevent reuse of a cached older helper.
            // Rewrite the opt-in helper to heal same-length corruption as well.
            {
              const stream = Cc[
                "@mozilla.org/network/file-output-stream;1"
              ].createInstance(Ci.nsIFileOutputStream);
              stream.init(file, 0x02 | 0x08 | 0x20, 0o600, 0);
              try {
                stream.write(
                  deps.EXPERIMENTAL_ACTOR_SOURCE,
                  deps.EXPERIMENTAL_ACTOR_SOURCE.length,
                );
              } finally {
                stream.close();
              }
            }
            deps.actorModuleURI = deps.Services.io.newFileURI(file).spec;
            // Resource mappings are propagated to content processes. Keep the old
            // file route as a compatibility fallback if this Gecko lacks the handler.
            try {
              const handler = deps.Services.io
                .getProtocolHandler("resource")
                .QueryInterface(Ci.nsIResProtocolHandler);
              handler.setSubstitution(
                "zentral-video-bridge",
                deps.Services.io.newFileURI(file.parent),
              );
              deps.actorModuleURI =
                "resource://zentral-video-bridge/" + file.leafName;
            } catch (_) {}
            try {
              // Gecko 154+ requires an explicit opt-in for ordinary web processes.
              // This actor only queries media / operates our own preview document;
              // it exposes no privileged parent-side message handlers.
              ChromeUtils.registerWindowActor(deps.ACTOR, {
                allFrames: true,
                safeForUntrustedWebProcess: true,
                child: { esModuleURI: deps.actorModuleURI },
              });
            } catch (error) {
              if (!String(error).includes("already registered")) throw error;
            }
            deps.actorReady = true;
            deps.methodState.actor = "registered; waiting for reply";
          } catch (error) {
            deps.methodError("actor", error);
          }
          return deps.actorReady;
        }
        function bridge(browser) {
          const manager = browser.messageManager;
          const existing = deps.bridges.get(browser);
          const uri = deps.liveBridgeEnabled() ? deps.EXPERIMENTAL_FRAME_URI : deps.FRAME_URI;
          if (existing && existing.manager === manager && existing.uri === uri)
            return existing;
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
            deps.methodState.frame = "working (content replied)";
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
          manager.addMessageListener(deps.CHANNEL + ":reply", onResult);
          try {
            manager.loadFrameScript(uri, true);
          } catch (error) {
            manager.removeMessageListener(deps.CHANNEL + ":reply", onResult);
            throw error;
          }
          const state = { manager, pending, onResult, uri: uri };
          state.onMedia = () => {
            if (!deps.featureOn(deps.MEDIA_EVENTS_PREF)) return;
            deps.queueDiscovery(browser);
          };
          manager.addMessageListener(deps.CHANNEL + ":media", state.onMedia);
          state.onCaption = (message) => {
            const data = message.data;
            if (
              !deps.enabled() ||
              !deps.captionWatch ||
              !deps.featureOn(deps.CAPTION_EVENTS_PREF) ||
              !deps.featureOn(deps.CAPTIONS_PREF) ||
              deps.videoHidden ||
              deps.current?.browser !== browser ||
              deps.current?.data.frameId !== data?.frameId ||
              deps.current?.data.id !== data?.id
            )
              return;
            deps.setCaption(String(data.text || "").slice(0, 1000));
          };
          manager.addMessageListener(deps.CHANNEL + ":caption", state.onCaption);
          deps.bridges.set(browser, state);
          deps.diagnostics.module = "browser frame message manager";
          return state;
        }
        function releaseBridge(browser) {
          const state = deps.bridges.get(browser);
          if (!state) return;
          deps.bridges.delete(browser);
          for (const request of state.pending.values()) request.finish(null);
          try {
            state.manager.sendAsyncMessage(deps.CHANNEL + ":shutdown");
          } catch (_) {}
          try {
            state.manager.removeMessageListener(
              deps.CHANNEL + ":reply",
              state.onResult,
            );
            state.manager.removeMessageListener(
              deps.CHANNEL + ":media",
              state.onMedia,
            );
            state.manager.removeMessageListener(
              deps.CHANNEL + ":caption",
              state.onCaption,
            );
          } catch (_) {}
          try {
            state.manager.removeDelayedFrameScript(state.uri || deps.FRAME_URI);
          } catch (_) {}
        }
        function query(browser, kind, data = {}) {
          const state = bridge(browser);
          const requestId = ++deps.nextRequest;
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
              kind === "Preview" || kind === "ControlPreview" ? 9000 : 1500,
            );
            state.pending.set(requestId, request);
            try {
              state.manager.sendAsyncMessage(deps.CHANNEL + ":request", {
                requestId,
                kind,
                ...data,
                ...(deps.liveBridgeEnabled()
                  ? {
                      experimentalEnabled: !deps.experimentalBridgeDisabled(),
                      previewEnabled: deps.normalLivePreviewEnabled(),
                    }
                  : {}),
              });
            } catch (error) {
              state.pending.delete(requestId);
              clearTimeout(request.timeout);
              reject(error);
            }
          });
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
        async function playerQuery(browser, mode, kind, data = {}) {
          if (!deps.liveModeEnabled(mode) || !deps.liveBridgeEnabled())
            throw new Error(
              "disabled: Experimental Video Bridge disabled in settings",
            );
          if (!browser?.isConnected)
            throw new Error("cancelled: Preview receiver removed");
          if (mode === "native" || mode === "stream") {
            if (!ensureActor())
              throw new Error("Experimental actor unavailable");
            return limited(
              browser.browsingContext.currentWindowGlobal
                .getActor(deps.ACTOR)
                .sendQuery(kind, {
                  ...data,
                  experimentalEnabled: !deps.experimentalBridgeDisabled(),
                  previewEnabled: deps.normalLivePreviewEnabled(),
                }),
              kind === "Preview" || kind === "ControlPreview" ? 9000 : 1500,
              mode + " " + kind,
            );
          }
          return query(browser, kind, {
            ...data,
            frameId: browser.browsingContext.id,
          });
        }
return { ensureActor, bridge, releaseBridge, query, limited, playerQuery };
});
})();
