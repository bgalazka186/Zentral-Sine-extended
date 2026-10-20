# Sidebar video preview

Start at `ZentralVideoPreview.uc.js`. The entrypoint owns state and passes live contracts. Controllers own distinct discovery, transport, rendering, UI, scheduling, captions, settings and diagnostic responsibilities. content/ runs in browser documents; chrome controllers run in the browser window.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                                     | Responsibility                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ZentralVideoPreview.css`                | Video card/receiver/controls/captions/sidebar sizing and display states.                                                                                              |
| `ZentralVideoPreview.uc.js`              | Owns per-window video preferences/state, live controller contracts, content helper strings/identity, event binding, preference transitions and final preview cleanup. |
| `content/ZentralVideoActor.sys.mjs`      | Versioned Gecko window actor classes and content-side media/renderer implementation with document leases, identity checks and receiver teardown.                      |
| `content/ZentralVideoBasicFrame.js`      | Simpler frame-message fallback for source discovery, playback controls and caption watching without the full renderer helper.                                         |
| `content/ZentralVideoFrame.js`           | Content frame-message implementation for discovery/control/captions and authorized sidebar renderer operations with leases and resource cleanup.                      |
| `controllers/ZentralVideoCaptions.js`    | Optional subtitle watch/event refresh with recovery polling and direct/actor/frame caption extraction.                                                                |
| `controllers/ZentralVideoDiagnostics.js` | Optional developer experiment controls, source/receiver motion sampling and combined preview-method diagnostic tests.                                                 |
| `controllers/ZentralVideoDiscovery.js`   | Enumerates direct/frame/actor media sources, filters duplicates, preserves source identity and enforces source visibility policy.                                     |
| `controllers/ZentralVideoRendering.js`   | Owns receiver creation, live preview/still capture, fallback canvas ownership, render health/probing and source presentation refresh.                                 |
| `controllers/ZentralVideoScheduling.js`  | Coordinates scan/paint scheduling, native compact-tabbar visibility, compact pause/resume and start/stop of preview work.                                             |
| `controllers/ZentralVideoSettings.js`    | Optional video categories, preference controls and availability-aware settings hooks.                                                                                 |
| `controllers/ZentralVideoSidebar.js`     | Creates video card, source selector/buttons, seek/progress synchronization and compact/pinned/hidden UI state.                                                        |
| `controllers/ZentralVideoTransport.js`   | Registers the versioned actor, creates/releases frame bridges and bounds parent/content/player requests.                                                              |
| `settings.json`                          | Settings schema and category/section metadata owned by video.                                                                                                         |

## Outside collaborators

- `loader/Zentral.uc.js`
- `loader/ZentralCatalog.js`
- `loader/ZentralRuntime.js`
- `extension/settings/controllers/ZentralSettingsShell.js (optional settings UI)`

Full installation uses root `theme.json` and `preferences.json`, plus `loader/`; Sine loads `loader/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.

## Actor loading and failure recovery

The actor resource alias resolves the installed Sine chrome path to its file or JAR location before registration. A separate resolved actor identity avoids reusing an older failed module cache. Registration failures remain visible in video diagnostics.

Definite actor query failures stop automatic actor discovery for that document. Navigation creates a fresh document and allows another attempt; explicitly running video diagnostics also retries. Timeouts and document-destruction cancellations do not disable the actor. This recovery adds no polling or retry timers. Requests from an obsolete scan or navigated document cannot publish sources or overwrite discovery diagnostics.

Temporary enlarged preview is owned by `controllers/ZentralVideoEnlarge.js`; see that folder's README for UI actions, compact-sidebar behavior and capability fallback. No separate stream, Apps dependency or OS Picture-in-Picture window is created.
