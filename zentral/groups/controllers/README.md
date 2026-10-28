# zentral/groups/controllers

Owner and local file guide for Extended 3.1.3. Original Zentral reference: 1.1.0.

| File                            | Responsibility                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `ZentralGroupsColors.js`        | Persists/applies group colors, derives average favicon/fallback colors and creates the     |
| `ZentralGroupsDom.js`           | Enhances native group DOM, renaming, chevrons/indicators/labels and subgroup badges with   |
| `ZentralGroupsLifecycle.js`     | Local source/contract; see its header                                                      |
| `ZentralGroupsMenus.js`         | Creates group/folder/tab context actions and conversion between native folders and groups. |
| `ZentralGroupsNativeAdapter.js` | Integrates native tab opening/addTab, group API hooks, tabstrip observation and popup      |
| `ZentralGroupsStore.js`         | Validates, saves, loads and reconstructs group state using SessionStore and workspace      |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.
