# Apps and base panel engine

Start at `ZentralApps.uc.js`. The entrypoint owns private state/lifecycle. Controllers cover model, launcher, browser/panel lifecycle, notifications, placement, interactions and native Library compatibility. Styles and app settings are local.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                                         | Responsibility                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ZentralApps.uc.js`                          | Owns the Apps class, private app/browser/DOM state, construction, enable transitions, observer setup and teardown; installs controller methods on the same owner instance. |
| `controllers/ZentralAppModel.js`             | Reads/validates/saves app definitions and utility ordering; adds apps and resolves workspace metadata and display labels.                                                  |
| `controllers/ZentralAppNotifications.js`     | Parses unread counts/dots from page titles, updates launcher badges, synchronizes normal and Essential apps and manages configurable fallback badge polling.               |
| `controllers/ZentralAppsInteractions.js`     | Owns Apps context-menu commands, outside-click handling and Insta Peek shortcut matching, press/release and blur restoration.                                              |
| `controllers/ZentralAppsLauncher.js`         | Creates launcher/panel containers, renders the Apps grid and utility bar, handles their autohide/repositioning and copies native toolbar theme into the vertical Apps bar. |
| `controllers/ZentralLibraryCompatibility.js` | Coordinates native Zen Library and bookmarks/history/downloads opening with Apps panels and owns the compatibility guard around Library animation.                         |
| `controllers/ZentralPanelLifecycle.js`       | Owns base app browser creation/reuse, preload sequencing, unload/remove/refresh, panel open/close and pin/expand presentation and view restoration.                        |
| `controllers/ZentralPanelPosition.js`        | Computes sidebar/docking bounds and panel width, positions the panel, tracks visible geometry and handles width drag/resize.                                               |
| `settings.json`                              | Settings schema and category/section metadata owned by apps.                                                                                                               |
| `styles/ZentralAppsInjected.css`             | Apps grid/bar, utility and panel base rules injected by the Apps class into a chrome style element.                                                                        |

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.

## Styles owned here

| File                                        | Responsibility                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `styles/ZentralAppTiles.css`                | App tile loaded/active states and compact/horizontal tile presentation.       |
| `styles/ZentralAppMenus.css`                | App context-menu empty-area filtering and destructive Remove action.          |
| `styles/ZentralVerticalBarLayout.css`       | Vertical app bar docking, autohide frame, background, footer and geometry.    |
| `styles/ZentralAutohideIndicators.css`      | Eye icon state for vertical-bar and utility autohide buttons.                 |
| `styles/ZentralVerticalBarPresentation.css` | Vertical-bar tile/icon states and panel hover/resize hit regions.             |
| `styles/ZentralLauncherAutohide.css`        | Refresh-button animation and sidebar launcher collapsed/revealed grid states. |
| `styles/ZentralUtilityControls.css`         | Utility section reveal transition, dot triggers, slots, buttons and divider.  |
| `styles/ZentralUtilityPlacement.css`        | Horizontal utility placement, reveal dimensions and permanent-hide policy.    |
