# Native tab startup loading

Start at `ZentralStartup.uc.js`. Independent session/workspace-aware tab loading. Its stylesheet and settings are beside the entrypoint. It remains separate from Apps preload and panel startup restoration.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                   | Responsibility                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ZentralStartup.css`   | Native tab startup-loading display state.                                                                                      |
| `ZentralStartup.uc.js` | Independent loading of selected native tabs after session/workspace restoration, with bounded recovery and readiness handling. |
| `settings.json`        | Settings schema and category/section metadata owned by startup.                                                                |

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.
