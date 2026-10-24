# additional/video/controllers

Owner and local file guide for Extended 3.1.0. Original Zentral reference: 1.1.0.

| File                           | Responsibility                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `ZentralVideoCaptionLayout.js` | Local source/contract; see its header                                                               |
| `ZentralVideoCaptions.js`      | Optional subtitle watch/event refresh with recovery polling and direct/actor/frame caption          |
| `ZentralVideoDiagnostics.js`   | Optional developer experiment controls, source/receiver motion sampling and combined                |
| `ZentralVideoEnlarge.js`       | Temporary enlarged view, double-click/return, drag/resize, remembered size and top-layer lifecycle. |
| `ZentralVideoDiscovery.js`     | Enumerates direct/frame/actor media sources, filters duplicates, preserves source identity and      |
| `ZentralVideoRendering.js`     | Owns receiver creation, live preview/still capture, fallback canvas ownership, render               |
| `ZentralVideoScheduling.js`    | Coordinates scan/paint scheduling, native compact-tabbar visibility, compact pause/resume and       |
| `ZentralVideoSettings.js`      | Optional video categories, preference controls and availability-aware settings hooks.               |
| `ZentralVideoSidebar.js`       | Creates video card, source selector/buttons, seek/progress synchronization and                      |
| `ZentralVideoTransport.js`     | Registers the versioned actor, creates/releases frame bridges and bounds parent/content/player      |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.

Caption presentation is shared/cached by `ZentralVideoCaptionLayout.js`: a fixed band, one-to-eight real clamped lines, optional fitting/scrolling and explicit white text. `ZentralVideoCaptions.js` owns capture/watch state; the UI-visible caption switch must stop timers and content watches, not just hide the node. No selected recovery interval may be silently raised to three seconds. See the repair handoff for watch-rebinding policy and in-flight cancellation behavior.

`ZentralVideoEnlarge.js` uses the existing card/renderer. Double-click the image to enlarge/return, drag anywhere on video to move, drag any edge/corner to resize, or press Escape to return. Video width/height and card x/y are remembered separately from sidebar dimensions. Default video size is 1280×720, scaled to fit and placed in the bottom corner on the sidebar side. Return/Fullscreen are in the existing bottom bar; there is no top bar. Fullscreen is temporary and preserves any pre-existing window fullscreen. `VideoSidebar.closeEnlarged` is passed through the entrypoint to Scheduling.stop; final teardown destroys listeners/nodes.

An enlarged card bypasses only compact-sidebar suspension. Window minimization, video disable/hide, source visibility policies and resource cleanup remain owned by the existing controllers. Normal compact policy is rechecked on return. Top-layer popovers escape transforms/opacity/clipping; `display:none` ancestors require atomic whole-card placement at the document root. This is capability gated on Gecko >=149, moveBefore and each live custom browser's connectedMoveCallback; normal DOM insert/remove is never used for this enlargement move. Mozilla bug 2007742 explains the version boundary. Older runtimes retain the top-layer-only path. The supplied profile records Gecko 158.

Caption entrypoint dependencies MUST include live `box` and `Services` accessors. setCaption writes through the shared layout immediately; it must never wait for refreshCard. Recovery uses one repeating scheduler, not a new interval after each async request. An older poll cannot overwrite newer event text. Fit mode verifies actual inner text height, then clamps at the selected line limit. Scroll mode must have pointer events enabled.

Enlarged preview: the bottom-bar source button opens the existing source selector upward. Back/forward buttons seek ±10 seconds from the live media time through all direct, frame and actor transports, clamped to the video duration. Returning closes the menu.

`ZentralVideoPlayerInput.js` is an optional `video/player-input` module mounted by Enlarge. It owns focused playback keys and delayed image clicks through the existing source-identity-checked control transport. Missing or failed input mounting leaves preview layout and drag available. Close, blur, pointer press, double-click and disposal cancel pending clicks; a changed source cannot receive an earlier click.

See [sidebar and player input notes](../../../docs/SIDEBAR-AND-PLAYER-INPUT.md) for keyboard scope, appearance ownership and validation limits.
