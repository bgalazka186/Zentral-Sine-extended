# zentral/apps/controllers

Owner and local file guide for Extended 3.0.0. Original Zentral reference: 1.1.0.

| File                             | Responsibility                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ZentralAppModel.js`             | Reads/validates/saves app definitions and utility ordering; adds apps and resolves workspace     |
| `ZentralAppNotifications.js`     | Parses unread counts/dots from page titles, updates launcher badges, synchronizes normal and     |
| `ZentralAppsInteractions.js`     | Owns Apps context-menu commands, outside-click handling and Insta Peek shortcut matching,        |
| `ZentralAppsLauncher.js`         | Creates launcher/panel containers, renders the Apps grid and utility bar, handles their          |
| `ZentralLibraryCompatibility.js` | Coordinates native Zen Library and bookmarks/history/downloads opening with Apps panels and owns |
| `ZentralPanelLifecycle.js`       | Owns base app browser creation/reuse, preload sequencing, unload/remove/refresh, panel           |
| `ZentralPanelPosition.js`        | Computes sidebar/docking bounds and panel width, positions the panel, tracks visible geometry    |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.
