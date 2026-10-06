# Extended panel suite

Start at `ZentralPanels.uc.js`. The coordinator owns shared ctx, scoped timers/retries, wrappers and cleanup. Subfolders identify geometry, corner tiles, navigation, browser hosts/containers, style bridges and optional secondary views. interaction/ contains distinct input/hover/audio and optional popup adapters.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File | Responsibility |
| --- | --- |
| `ZentralPanels.css` | Extended panel visibility, hit testing, toolbar/pill and closing/hover state presentation. |
| `ZentralPanels.uc.js` | Coordinates extended panels, shared ctx exports, defaults/keybinds, Apps method wrappers, startup restoration, push/layout policy, fallback maintenance and bounded recovery scheduling. |
| `browsers/ZentralBrowserIntegrations.css` | Container/mobile-UA/add-on host controls and browser integration presentation. |
| `browsers/ZentralBrowserIntegrations.uc.js` | Owns containers/mobile user agent, add-on real-tab host records/folder, browser adoption/removal and docshell/render activity policy. |
| `browsers/settings.json` | Settings schema and category/section metadata owned by browser-integrations. |
| `corner-tiles/ZentralCornerPanels.css` | Essential corner tiles and their panel interaction visuals. |
| `corner-tiles/ZentralCornerPanels.uc.js` | Creates Essential-tab corner tiles, panel linkage and background loading, manages linked Triple View pairs and tile input isolation. |
| `corner-tiles/settings.json` | Settings schema and category/section metadata owned by corner-panels. |
| `geometry/ZentralPanelGeometry.css` | Extended panel position/drag/resize and related geometry states. |
| `geometry/ZentralPanelGeometry.uc.js` | Adds horizontal offset, all-sides/vertical resize handles and pill-based panel dragging. |
| `geometry/settings.json` | Settings schema and category/section metadata owned by geometry. |
| `interaction/ZentralPanelAudio.js` | Tracks owned panel media controllers, builds native mute/unmute controls and performs bounded visible activity recovery. |
| `interaction/ZentralPanelHover.js` | Owns extended panel hover reveal/hide, pinned offscreen geometry, edge/pill reveal controls and hover/resize holds. |
| `interaction/ZentralPanelInput.js` | Scopes panel pointer/navigation/context-menu input and delegates native Back/Forward commands and menu actions to the correct visible panel browser. |
| `interaction/ZentralPanelPopupRouting.js` | Optional adapter for opening links/popups into owned panels while delegating normal browser requests. |
| `navigation/ZentralPanelToolbar.uc.js` | Owns panel URL/navigation/search toolbar, quick-switch targets and forced black backing controls. |
| `navigation/settings.json` | Settings schema and category/section metadata owned by panel-toolbar. |
| `navigation/styles/ZentralPanelBackground.css` | Toolbar-controlled panel black backing and related root attribute rules. |
| `navigation/styles/ZentralPanelToolbar.css` | Panel URL/search/navigation controls and quick-switch/backing presentation. |
| `secondary-views/ZentralSecondaryViews.uc.js` | Optional Triple View/Super Pin secondary browser shells and associated toolbar/geometry synchronization. |
| `secondary-views/settings.json` | Settings schema and category/section metadata owned by secondary-views. |
| `settings.json` | Settings schema and category/section metadata owned by panels. |
| `styling/ZentralPanelStyles.uc.js` | Enumerates owned panel browsers, repairs visible presentation and synchronizes opt-in Zen Internet styles into panel content. |
| `styling/settings.json` | Settings schema and category/section metadata owned by panel-styles. |

## Outside collaborators

- `features/settings/controllers/ZentralFeatureSettings.js`

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.
