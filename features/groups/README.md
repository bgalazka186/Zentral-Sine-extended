# Native tab group enhancements

Start at `ZentralTabGroups.uc.js`. The entrypoint owns private state/lifecycle. Store, DOM, menus, colors/picker and native adapter have separate debugging responsibilities. Styles and settings are local.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                                        | Responsibility                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ZentralTabGroups.uc.js`                    | Owns the Groups class, private state, session/workspace settlement, initialization/enable transitions, observer installation and cleanup.                           |
| `controllers/ZentralGroupsColors.js`        | Persists/applies group colors, derives average favicon/fallback colors and creates the interactive color-picker popup.                                              |
| `controllers/ZentralGroupsDom.js`           | Enhances native group DOM, renaming, chevrons/indicators/labels and subgroup badges with scheduled badge updates.                                                   |
| `controllers/ZentralGroupsMenus.js`         | Creates group/folder/tab context actions and conversion between native folders and groups.                                                                          |
| `controllers/ZentralGroupsNativeAdapter.js` | Integrates native tab opening/addTab, tab drag guards, tabstrip observation and popup suppression; filters Zen Library copies through a local compatibility switch. |
| `controllers/ZentralGroupsStore.js`         | Validates, saves, loads and reconstructs group state using SessionStore and workspace identities.                                                                   |
| `settings.json`                             | Settings schema and category/section metadata owned by tab-groups.                                                                                                  |
| `styles/ZentralGroupsInjected.css`          | Group enhancement rules injected by the Groups class into a chrome style element.                                                                                   |

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.

## Styles owned here

| File                                  | Responsibility                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `styles/ZentralGroupStructure.css`    | Native group layout, keyboard focus and split-group header suppression.         |
| `styles/ZentralGroupPresentation.css` | Group headers/cards, initials, marquee, hover preview and tooltip presentation. |
| `styles/ZentralGroupMenus.css`        | Suppress replaced native group menus and style custom Close Group actions.      |
