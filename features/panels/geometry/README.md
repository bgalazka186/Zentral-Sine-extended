# Extended panel geometry

Start at `ZentralPanelGeometry.uc.js`. Required panel generator part. Owns dragging/resize/horizontal offset and its CSS/settings. It shares the coordinator ctx and is not independently installable.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File | Responsibility |
| --- | --- |
| `ZentralPanelGeometry.css` | Extended panel position/drag/resize and related geometry states. |
| `ZentralPanelGeometry.uc.js` | Adds horizontal offset, all-sides/vertical resize handles and pill-based panel dragging. |
| `settings.json` | Settings schema and category/section metadata owned by geometry. |

## Outside collaborators

- `features/panels/ZentralPanels.uc.js`

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.
