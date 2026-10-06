# Essential corner tiles

Start at `ZentralCornerPanels.uc.js`. Required panel generator part. Owns Essential tile linkage/background loading and its CSS/settings. Browser hosts, toolbar, styles and coordinator remain collaborators.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File | Responsibility |
| --- | --- |
| `ZentralCornerPanels.css` | Essential corner tiles and their panel interaction visuals. |
| `ZentralCornerPanels.uc.js` | Creates Essential-tab corner tiles, panel linkage and background loading, manages linked Triple View pairs and tile input isolation. |
| `settings.json` | Settings schema and category/section metadata owned by corner-panels. |

## Outside collaborators

- `features/panels/ZentralPanels.uc.js`
- `features/panels/browsers/ZentralBrowserIntegrations.uc.js`
- `features/panels/navigation/ZentralPanelToolbar.uc.js`
- `features/panels/styling/ZentralPanelStyles.uc.js`

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.
