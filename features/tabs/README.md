# Native tab behavior

Start at `startup/ZentralStartup.uc.js`. startup/ and unloading/ contain independently optional behaviors and settings. ZentralTabDensity.css is directly here: it does not need a one-file density folder. Density preference controls currently belong to shared Appearance/settings UI.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File | Responsibility |
| --- | --- |
| `ZentralTabDensity.css` | Native tab spacing/density/sizing presentation independent of Apps. |
| `startup/ZentralStartup.css` | Native tab startup-loading display state. |
| `startup/ZentralStartup.uc.js` | Independent loading of selected native tabs after session/workspace restoration, with bounded recovery and readiness handling. |
| `startup/settings.json` | Settings schema and category/section metadata owned by startup. |
| `unloading/ZentralTabUnload.uc.js` | Independent middle-click unloading of loaded ordinary native tabs while keeping native close behavior for already-unloaded tabs. |
| `unloading/settings.json` | Settings schema and category/section metadata owned by tab-unload. |

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.
