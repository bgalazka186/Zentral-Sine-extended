# Ordinary tab middle-click unloading

Start at `ZentralTabUnload.uc.js`. Independent loaded-native-tab unload behavior with native close delegation for unloaded tabs. This folder contains entrypoint and settings; corner tile unloading belongs to panels.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File | Responsibility |
| --- | --- |
| `ZentralTabUnload.uc.js` | Independent middle-click unloading of loaded ordinary native tabs while keeping native close behavior for already-unloaded tabs. |
| `settings.json` | Settings schema and category/section metadata owned by tab-unload. |

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.
