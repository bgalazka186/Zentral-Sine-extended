# Panel navigation and backing

Start at `ZentralPanelToolbar.uc.js`. Required panel generator part. Owns URL/history/search/quick-switch and black backing behavior. Both stylesheets are in styles/; preferences are in settings.json.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                                | Responsibility                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ZentralPanelToolbar.uc.js`         | Owns panel URL/navigation/search toolbar, quick-switch targets and forced black backing controls. |
| `settings.json`                     | Settings schema and category/section metadata owned by panel-toolbar.                             |
| `styles/ZentralPanelBackground.css` | Toolbar-controlled panel black backing and related root attribute rules.                          |
| `styles/ZentralPanelToolbar.css`    | Panel URL/search/navigation controls and quick-switch/backing presentation.                       |

## Outside collaborators

- `features/panels/ZentralPanels.uc.js`
- `features/panels/geometry/ZentralPanelGeometry.uc.js`
- `features/panels/styling/ZentralPanelStyles.uc.js`

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.
