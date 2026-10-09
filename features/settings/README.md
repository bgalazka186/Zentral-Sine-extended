# Shared settings UI

Start at `controllers/ZentralSettingsShell.js`. Controllers build the modal, categories/search, rows, extended controls, backups and developer manager. layout.json describes global categories/order; extension-settings.json owns mixed extended UI metadata. Other features own their own settings.json.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                                      | Responsibility                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `controllers/ZentralBackup.js`            | Optional appearance/settings backup export/import, validation and backup control construction.                                                               |
| `controllers/ZentralDeveloperSettings.js` | Optional source manager overlay, module/CSS toggles, local add-on registration and diagnostic/settings inventory views.                                      |
| `controllers/ZentralFeatureSettings.js`   | Builds extended feature controls and look controls, associates them with category metadata and synchronizes preference changes/imports.                      |
| `controllers/ZentralSettingsCatalog.js`   | Combines available owner descriptors into settings schema/metadata and applies categories plus original preference order from features/settings/layout.json. |
| `controllers/ZentralSettingsRows.js`      | Reusable DOM row constructors for keybinds, toggles, selects, text, sliders and colors.                                                                      |
| `controllers/ZentralSettingsShell.js`     | Owns the settings modal, base Apps/Groups controls, app editor/matrix, category navigation/search and bounded content scrolling.                             |
| `extension-settings.json`                 | Settings schema and category/section metadata owned by extension-settings.                                                                                   |
| `layout.json`                             | Category/section definitions and original setting order; data only, no feature activation.                                                                   |
| `styles/ZentralControls.css`              | Shared panel and settings control presentation.                                                                                                              |
| `styles/ZentralSettings.css`              | Settings categories/navigation/search and content scrolling.                                                                                                 |
| `styles/ZentralSettingsInjected.css`      | Modal/base control rules injected by the SettingsShell into a chrome style element.                                                                          |

## Outside collaborators

- `core/settings.json`
- `features/appearance/ZentralAppearance.js`
- `features/apps/settings.json`
- `features/diagnostics/settings.json`
- `features/groups/settings.json`
- `features/panels/ZentralPanels.uc.js`
- `features/panels/browsers/ZentralBrowserIntegrations.uc.js`
- `features/panels/browsers/settings.json`
- `features/panels/corner-tiles/ZentralCornerPanels.uc.js`
- `features/panels/corner-tiles/settings.json`
- `features/panels/geometry/ZentralPanelGeometry.uc.js`
- `features/panels/geometry/settings.json`
- `features/panels/navigation/ZentralPanelToolbar.uc.js`
- `features/panels/navigation/settings.json`
- `features/panels/secondary-views/settings.json`
- `features/panels/settings.json`
- `features/panels/styling/ZentralPanelStyles.uc.js`
- `features/panels/styling/settings.json`
- `features/rss/settings.json`
- `features/tabs/startup/settings.json`
- `features/tabs/unloading/settings.json`
- `features/video/settings.json`

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.

## Styles owned here

| File                                   | Responsibility                                                   |
| -------------------------------------- | ---------------------------------------------------------------- |
| `styles/ZentralSettingsFoundation.css` | Shared settings modal, app editor and base control presentation. |
