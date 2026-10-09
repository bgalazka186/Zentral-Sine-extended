# Content style bridge

Start at `ZentralPanelStyles.uc.js`. Required panel generator part. Enumerates owned browsers and implements the opt-in Zen Internet style bridge. settings.json contains the bridge preference metadata.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                       | Responsibility                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ZentralPanelStyles.uc.js` | Enumerates owned panel browsers, repairs visible presentation and synchronizes opt-in Zen Internet styles into panel content. |
| `settings.json`            | Settings schema and category/section metadata owned by panel-styles.                                                          |

## Outside collaborators

- `features/panels/ZentralPanels.uc.js`
- `features/panels/browsers/ZentralBrowserIntegrations.uc.js`

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.
