/*
 * ZENTRAL FILE GUIDE - features/video/controllers/ZentralVideoDiscovery.js
 *
 * Purpose: Enumerates direct/frame/actor media sources, filters duplicates, preserves source identity and
 *   enforces source visibility policy.
 * Interaction / execution: VideoPreview creates this controller with shared state plus Transport queries.
 *   scan/queueDiscovery feed Sidebar source selection and Rendering; Scheduling triggers source/visibility
 *   work.
 * Ownership / failure: Asynchronous discovery checks owner state/generation and supplied callbacks. Keep
 *   discovery separate from receiver construction and source-page playback control.
 * Registration: video/ZentralVideoDiscovery
 * Loaded/created by: features/video/ZentralVideoPreview.uc.js
 * Returned factory API: canOpenSourceTab; contexts; discoveryVideos; filterMutedDuplicates;
 *   guardLiveSourceVisibility; hasVideoAudioTrack; hiddenByLayout; inspectActor; inspectBrowser;
 *   inspectDirect; inspectFrame; liveSourceVisible; pageMediaKey; queueDiscovery; rememberedSource;
 *   sameSource; scan; sourceCertainlyHidden; sourceKey; sourceLabel; validMediaRequest
 * Injected deps state/callbacks used: ACTOR; AUDIO_CACHE_PREF; DISCOVERY_CACHE_MS;
 *   EMPTY_DISCOVERY_CACHE_MS; KEEP_VISIBLE_PREF; PINNED_DISCOVERY_PREF; SUSPEND_VISIBLE_PREF; Services;
 *   activeScanToken; audioProbeCache; autoPreviewChoice; autoShowVideo; bridges; browserReports;
 *   compactPaused; compactResumeSource; cropStates; current; diagnostics; directIds; dirtyBrowsers;
 *   discoveryCache; discoveryChoice; discoveryLocks; discoveryWakeTimer; discoveryWinner; disposed;
 *   enabled; ensureActor; experimentalBridgeDisabled; featureOn; hideMutedDuplicates; limited;
 *   liveBridgeEnabled; methodError; methodState; metrics; mount; nextDirectId; normalLivePreviewEnabled;
 *   pinnedSource; powerOn; previewAutoSelected; previewBrowser; previewGeneration; previewMode; query;
 *   queuedDiscovery; queuedFullScan; recordError; refreshCard; releaseBridge; rendererChoice;
 *   rendererRetryCounts; requireAudio; resetRendering; scanCursor; scanGeneration; scanning; select;
 *   sourceVisibilityBlocked; sourceVisibilityBusy; sources; testingAll; unavailableBySource;
 *   visibilityCheckAt; visibilityIntervalMs; visibilitySourceKey; wakePaint
 * Contract fields assigned here: deps.activeScanToken; deps.compactResumeSource; deps.current;
 *   deps.diagnostics.found; deps.diagnostics.inspected; deps.diagnostics.lastError; deps.diagnostics.phase;
 *   deps.discoveryWakeTimer; deps.discoveryWinner; deps.methodState.actor; deps.methodState.direct;
 *   deps.metrics.dirtyInspections; deps.metrics.discoveryCacheHits; deps.metrics.discoveryCalls;
 *   deps.metrics.lastScanMs; deps.metrics.scans; deps.nextDirectId; deps.pinnedSource;
 *   deps.pinnedSource.id; deps.previewAutoSelected; deps.queuedDiscovery; deps.queuedFullScan;
 *   deps.scanCursor; deps.scanGeneration; deps.scanning; deps.sourceVisibilityBlocked;
 *   deps.sourceVisibilityBusy; deps.sources; deps.visibilityCheckAt; deps.visibilitySourceKey
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("video/ZentralVideoDiscovery", function (deps) {
        function sameSource(a, b) {
          return !!(
            a &&
            b &&
            a.browser === b.browser &&
            a.method === b.method &&
            a.data.frameId === b.data.frameId &&
            a.data.documentId === b.data.documentId &&
            a.data.id === b.data.id &&
            a.data.currentSrc === b.data.currentSrc &&
            (a.data.pageMediaKey || "") === (b.data.pageMediaKey || "")
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
            `${source.data.currentSrc || ""}:${source.data.pageMediaKey || ""}`
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
            const root = source.browser.closest?.(
              "#zen-app-panel-root, #bgalazka-super-panel",
            );
            // Inspect this panel's browser, not the global any-panel-open flag.
            return (
              hiddenByLayout(source.browser) || (!!root && hiddenByLayout(root))
            );
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
        async function liveSourceVisible(source) {
          if (
            !deps.liveBridgeEnabled() ||
            (!deps.Services.prefs.getBoolPref(deps.KEEP_VISIBLE_PREF, true) &&
              !deps.powerOn(deps.SUSPEND_VISIBLE_PREF))
          )
            return false;
          if (sourceCertainlyHidden(source)) return false;
          if (!source?.data.videoRef) return true; // Uncertain visibility must not move the source.
          try {
            const args = {
              videoRef: source.data.videoRef,
              frameId: source.data.frameId,
              experimentalEnabled: !deps.experimentalBridgeDisabled(),
              previewEnabled: deps.normalLivePreviewEnabled(),
              ignoreDocumentVisibility: true,
            };
            const probe =
              source.method === "actor"
                ? await deps.limited(
                    source.context.currentWindowGlobal
                      .getActor(deps.ACTOR)
                      .sendQuery("Probe", args),
                    1500,
                    "source visibility",
                  )
                : await deps.query(source.browser, "Probe", args);
            return probe.visible !== false;
          } catch (_) {
            return true;
          }
        }
        async function guardLiveSourceVisibility() {
          if (
            deps.sourceVisibilityBusy ||
            deps.disposed ||
            !deps.current ||
            !deps.liveBridgeEnabled() ||
            deps.powerOn(deps.SUSPEND_VISIBLE_PREF) ||
            !deps.previewBrowser ||
            !["frame-native", "native"].includes(
              deps.previewBrowser._zvpMode || deps.previewMode,
            )
          )
            return;
          deps.sourceVisibilityBusy = true;
          const source = deps.current,
            browser = deps.previewBrowser,
            generation = deps.previewGeneration;
          try {
            if (
              (await liveSourceVisible(source)) &&
              generation === deps.previewGeneration &&
              browser === deps.previewBrowser
            ) {
              deps.sourceVisibilityBlocked = true;
              deps.visibilitySourceKey = sourceKey(source);
              deps.visibilityCheckAt = Date.now() + deps.visibilityIntervalMs();
              deps.resetRendering();
              deps.wakePaint();
            }
          } finally {
            deps.sourceVisibilityBusy = false;
          }
        }
        function filterMutedDuplicates(candidates) {
          if (!deps.hideMutedDuplicates()) return candidates;
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
            const cached = deps.audioProbeCache.get(media);
            if (
              deps.featureOn(deps.AUDIO_CACHE_PREF) &&
              cached?.key === key &&
              Date.now() - cached.at < 30000
            )
              return cached.hasAudio;
            if (deps.liveBridgeEnabled())
              return typeof media.mozHasAudio === "boolean"
                ? media.mozHasAudio
                : true;
            const capture = media.captureStream || media.mozCaptureStream;
            if (typeof capture !== "function") return false;
            const stream = capture.call(media);
            const hasAudio = stream.getAudioTracks().length > 0;
            for (const track of stream.getTracks()) track.stop();
            if (deps.featureOn(deps.AUDIO_CACHE_PREF))
              deps.audioProbeCache.set(media, { key, at: Date.now(), hasAudio });
            return hasAudio;
          } catch (_) {
            return false;
          }
        }
        function discoveryVideos(doc) {
          const videos = Array.from(doc.querySelectorAll("video"));
          const host = doc.location?.hostname || "";
          if (!/(^|\.)youtube\.com$/.test(host)) return videos;
          const url = new URL(doc.location.href);
          if (url.pathname !== "/watch" || !url.searchParams.get("v"))
            return videos;
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
          if (!/(^|\.)youtube\.com$/.test(doc.location?.hostname || ""))
            return "";
          const url = new URL(doc.location.href);
          return url.pathname === "/watch"
            ? "youtube:" + (url.searchParams.get("v") || "")
            : "";
        }
        function validMediaRequest(media, args = {}) {
          if (!media?.isConnected) return false;
          if (
            args.pageMediaKey != null &&
            pageMediaKey(media) !== args.pageMediaKey
          )
            return false;
          if (
            args.currentSrc != null &&
            (media.currentSrc || "") !== args.currentSrc
          )
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
            if (
              media.ownerDocument.querySelector?.("ytd-watch-flexy[video-id]")
            )
              return false;
          }
          return true;
        }
        async function inspectDirect(item) {
          const { browser, tab, panel } = item;
          let doc;
          try {
            doc = browser.contentDocument;
          } catch (_) {
            deps.methodState.direct =
              "unavailable: document is not locally accessible";
            return [];
          }
          if (!doc?.defaultView) {
            deps.methodState.direct =
              "unavailable: document is not locally accessible";
            return [];
          }
          const win = doc.defaultView;
          const found = [];
          for (const media of discoveryVideos(doc)) {
            if (
              media.hasAttribute?.("data-zentral-preview-owned") ||
              media.ended ||
              media.readyState < 1
            )
              continue;
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
              (deps.requireAudio() && !hasVideoAudioTrack(media))
            )
              continue;
            let id = deps.directIds.get(media);
            if (!id) {
              id = ++deps.nextDirectId;
              deps.directIds.set(media, id);
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
                pageMediaKey: pageMediaKey(media),
                documentId: win.windowGlobalChild?.innerWindowId || 0,
                width: media.videoWidth || 0,
                height: media.videoHeight || 0,
              },
            });
          }
          deps.methodState.direct = "working (document accessible)";
          return found;
        }
        async function inspectActor(item) {
          if (!deps.ensureActor()) return [];
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
                const candidates = await deps.limited(
                  global.getActor(deps.ACTOR).sendQuery("List", {
                    requireAudio: deps.requireAudio(),
                    cacheAudio: deps.featureOn(deps.AUDIO_CACHE_PREF),
                  }),
                  2500,
                  "actor reply",
                );
                deps.methodState.actor = "working (content replied)";
                return (candidates || []).map((data) => ({
                  ...item,
                  method: "actor",
                  context,
                  data: { ...data, frameId: context.id },
                }));
              } catch (error) {
                deps.methodError("actor", error);
                return [];
              }
            }),
          );
          return groups.flat();
        }
        async function inspectFrame(item) {
          try {
            const candidates = await deps.query(item.browser, "List", {
              requireAudio: deps.requireAudio(),
              cacheAudio: deps.featureOn(deps.AUDIO_CACHE_PREF),
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
            deps.methodError("frame", error);
            return [];
          }
        }
        async function inspectBrowser(item) {
          if (!item.browser?.browsingContext || item.tab?.closing) return [];
          const generation = deps.scanGeneration;
          deps.diagnostics.inspected++;
          const choice = deps.discoveryChoice();
          const run = async (method) => {
            deps.metrics.discoveryCalls++;
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
              deps.methodError(method, error);
              return [];
            }
          };
          const groups = {};
          const methods =
            choice === "auto" ? ["frame", "actor", "direct"] : [choice];
          let winner = null;
          // Probe the preferred transport first; do not launch fallback work
          // after a useful video reply. The outer discovery cache still avoids
          // re-probing unchanged documents between its existing expiry/events.
          for (const method of methods) {
            if (deps.disposed || !deps.enabled() || generation !== deps.scanGeneration)
              return [];
            groups[method] = await run(method);
            if (deps.disposed || !deps.enabled() || generation !== deps.scanGeneration)
              return [];
            if (groups[method].length) {
              winner = method;
              break;
            }
          }
          if (winner && groups[winner]?.length)
            deps.discoveryLocks.set(item.browser, winner);
          else deps.discoveryLocks.delete(item.browser);
          deps.browserReports.set(item.browser, {
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
          if (deps.disposed || !deps.enabled() || deps.compactPaused) return;
          if (browser) deps.dirtyBrowsers.add(browser);
          deps.queuedDiscovery = true;
          if (deps.scanning || deps.discoveryWakeTimer) return;
          deps.discoveryWakeTimer = setTimeout(() => {
            deps.discoveryWakeTimer = null;
            if (deps.scanning) return;
            deps.queuedDiscovery = false;
            scan();
          }, 75);
        }
        async function scan(all = false, resumeOnly = false) {
          if (deps.disposed || !deps.enabled() || deps.compactPaused || deps.testingAll) return;
          if (deps.scanning) {
            if (all) deps.queuedFullScan = true;
            return;
          }
          deps.scanning = true;
          const scanToken = ++deps.activeScanToken;
          deps.queuedDiscovery = false;
          const scanStarted = Date.now();
          deps.metrics.scans++;
          const generation = ++deps.scanGeneration;
          try {
            deps.mount();
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
            for (const browser of deps.browserReports.keys())
              if (!known.has(browser)) {
                deps.browserReports.delete(browser);
                deps.discoveryLocks.delete(browser);
              }
            for (const browser of deps.discoveryCache.keys())
              if (!known.has(browser)) deps.discoveryCache.delete(browser);
            for (const browser of deps.dirtyBrowsers)
              if (!known.has(browser)) deps.dirtyBrowsers.delete(browser);
            for (const key of deps.unavailableBySource.keys())
              if (!deps.sources.some((source) => sourceKey(source) === key))
                deps.unavailableBySource.delete(key);
            for (const browser of deps.bridges.keys())
              if (!known.has(browser) && browser !== deps.previewBrowser)
                deps.releaseBridge(browser);
            if (!items.length) {
              deps.discoveryWinner = null;
              deps.sources = [];
              deps.current = null;
              deps.resetRendering();
              deps.refreshCard();
              return;
            }
            // Check the current video each pass; rotate through the other tabs in
            // bounded batches so hundreds of open tabs never stall the chrome UI.
            const batch = [];
            const active =
              items.find(
                (item) =>
                  item.browser ===
                  (deps.compactResumeSource?.browser || deps.current?.browser),
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
              deps.dirtyBrowsers.has(selectedItem.browser) &&
              !batch.includes(selectedItem)
            )
              batch.push(selectedItem);
            for (const item of items)
              if (deps.dirtyBrowsers.has(item.browser) && !batch.includes(item))
                batch.push(item);
            const pinValid =
              active &&
              deps.pinnedSource &&
              deps.current &&
              deps.pinnedSource.browser === deps.current.browser &&
              deps.pinnedSource.frameId === deps.current.data.frameId &&
              deps.pinnedSource.id === deps.current.data.id &&
              deps.current.browser?.isConnected;
            if (
              (!resumeOnly || !active) &&
              !(deps.powerOn(deps.PINNED_DISCOVERY_PREF) && pinValid && !all)
            ) {
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
                const item = items[(deps.scanCursor + i) % items.length];
                if (!batch.includes(item)) batch.push(item);
              }
              deps.scanCursor =
                (deps.scanCursor + (all ? items.length : 12)) % items.length;
            }
            const now = Date.now();
            const found = (
              await Promise.all(
                batch.map(async (item) => {
                  const browser = item.browser;
                  const wasDirty = deps.dirtyBrowsers.delete(browser);
                  const cached = deps.discoveryCache.get(browser);
                  const global = browser?.browsingContext?.currentWindowGlobal;
                  const cacheAgeLimit = cached?.sources.length
                    ? deps.DISCOVERY_CACHE_MS
                    : deps.EMPTY_DISCOVERY_CACHE_MS;
                  if (
                    !all &&
                    !wasDirty &&
                    cached &&
                    cached.global === global &&
                    now - cached.at < cacheAgeLimit
                  ) {
                    deps.metrics.discoveryCacheHits++;
                    return cached.sources.map((source) => ({
                      ...source,
                      tab: item.tab,
                      panel: item.panel,
                    }));
                  }
                  if (wasDirty) deps.metrics.dirtyInspections++;
                  if (cached && cached.global !== global)
                    deps.discoveryLocks.delete(browser);
                  // Each uncached browser starts with the preferred transport.
                  const result = await inspectBrowser(item);
                  if (
                    generation === deps.scanGeneration &&
                    !deps.dirtyBrowsers.has(browser)
                  )
                    deps.discoveryCache.set(browser, {
                      global,
                      at: Date.now(),
                      sources: result,
                    });
                  return result;
                }),
              )
            ).flat();
            if (deps.disposed || generation !== deps.scanGeneration) return;
            deps.diagnostics.found = found.length;
            if (found.length) deps.diagnostics.lastError = "";
            deps.diagnostics.phase = found.length
              ? "source found"
              : "scanning (no video found in this batch)";
            const batchBrowsers = new Set(batch.map((item) => item.browser));
            deps.sources = deps.sources.filter(
              (item) =>
                !batchBrowsers.has(item.browser) &&
                items.some((entry) => entry.browser === item.browser),
            );
            deps.sources.push(...found);
            deps.sources = filterMutedDuplicates(deps.sources);
            const activeKeys = new Set(deps.sources.map(sourceKey));
            for (const key of deps.unavailableBySource.keys())
              if (!activeKeys.has(key)) deps.unavailableBySource.delete(key);
            for (const key of deps.rendererRetryCounts.keys())
              if (
                ![...activeKeys].some((source) => key.startsWith(source + ":"))
              )
                deps.rendererRetryCounts.delete(key);
            for (const key of deps.cropStates.keys())
              if (!activeKeys.has(key)) deps.cropStates.delete(key);
            deps.sources.sort((a, b) => b.data.score - a.data.score);
            if (deps.discoveryChoice() === "auto")
              deps.discoveryWinner =
                deps.sources.find((item) => item.data.kind === "video")?.method ||
                null;
            const remembered = deps.compactResumeSource;
            if (remembered) {
              const restored = rememberedSource(deps.sources, remembered);
              if (restored) {
                deps.compactResumeSource = null;
                deps.select(restored, false, remembered.autoSelected);
              } else if (
                !remembered.browser.isConnected ||
                Date.now() - remembered.at > 15000
              )
                deps.compactResumeSource = null;
            }
            const stillPlaying = deps.sources.find((item) =>
              sameSource(item, deps.current),
            );
            if (deps.pinnedSource && !deps.pinnedSource.browser?.isConnected)
              deps.pinnedSource = null;
            let pinnedMatch =
              deps.pinnedSource &&
              deps.sources.find(
                (item) =>
                  item.browser === deps.pinnedSource.browser &&
                  item.data.frameId === deps.pinnedSource.frameId &&
                  item.data.id === deps.pinnedSource.id,
              );
            if (!pinnedMatch && deps.pinnedSource) {
              const sameFrame = deps.sources.filter(
                (item) =>
                  item.browser === deps.pinnedSource.browser &&
                  item.data.frameId === deps.pinnedSource.frameId,
              );
              if (sameFrame.length === 1) {
                pinnedMatch = sameFrame[0];
                deps.pinnedSource.id = pinnedMatch.data.id;
              }
            }
            // Playback may start after TabSelect's scan. Prefer the selected
            // playing tab on each pass, while honoring manual and pinned choices.
            const selectedPlaying =
              deps.autoShowVideo() &&
              selectedItem &&
              deps.sources.find(
                (source) =>
                  source.browser === selectedItem.browser &&
                  source.data.kind === "video" &&
                  !source.data.paused,
              );
            if (pinnedMatch) deps.select(pinnedMatch, false, true);
            else if (deps.pinnedSource) {
              deps.current = null;
              deps.resetRendering();
            } else if (selectedPlaying && (deps.previewAutoSelected || !deps.current))
              deps.select(selectedPlaying, false, true);
            else if (stillPlaying) deps.select(stillPlaying);
            else {
              deps.current = null;
              deps.previewAutoSelected = false;
              deps.resetRendering();
              const choice = deps.rendererChoice();
              if (deps.autoShowVideo() && deps.autoPreviewChoice(choice)) {
                const candidate = deps.sources.find(
                  (source) =>
                    source.data.kind === "video" &&
                    !source.data.paused &&
                    (choice !== "snapshot" || source.data.rect),
                );
                if (candidate) deps.select(candidate, false, true);
              }
            }
            deps.refreshCard();
          } catch (error) {
            deps.recordError(error);
            deps.refreshCard();
          } finally {
            if (scanToken === deps.activeScanToken) {
              deps.scanning = false;
              deps.metrics.lastScanMs = Date.now() - scanStarted;
              if (deps.queuedFullScan) {
                deps.queuedFullScan = false;
                setTimeout(() => scan(true), 0);
              } else if (deps.queuedDiscovery || deps.dirtyBrowsers.size) {
                queueDiscovery();
              }
            }
          }
        }
return { sameSource, canOpenSourceTab, rememberedSource, sourceLabel, sourceKey, hiddenByLayout, sourceCertainlyHidden, liveSourceVisible, guardLiveSourceVisibility, filterMutedDuplicates, contexts, hasVideoAudioTrack, discoveryVideos, pageMediaKey, validMediaRequest, inspectDirect, inspectActor, inspectFrame, inspectBrowser, queueDiscovery, scan };
});
})();
