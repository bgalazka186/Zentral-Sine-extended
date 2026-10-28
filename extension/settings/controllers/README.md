# extension/settings/controllers

Owner and local file guide for Extended 3.1.3. Original Zentral reference: 1.1.0.

| File                              | Responsibility                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ZentralBackup.js`                | Optional appearance/settings backup export/import, validation and backup control construction. |
| `ZentralDeveloperSettings.js`     | Optional source manager overlay, module/CSS toggles, local add-on registration and             |
| `ZentralFeatureSettings.js`       | Builds extended feature controls and look controls, associates them with category metadata and |
| `ZentralNativeBrowserSettings.js` | Local source/contract; see its header                                                          |
| `ZentralSettingsCatalog.js`       | Combines available owner descriptors into settings schema/metadata and applies categories plus |
| `ZentralSettingsRows.js`          | Reusable DOM row constructors for keybinds, toggles, selects, text, sliders and colors.        |
| `ZentralSettingsShell.js`         | Owns the settings modal, base Apps/Groups controls, app editor/matrix, category                |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.

`ZentralReleaseLab.js` builds the 3.0+ testing copies from `release-settings.json`. Copies use `data-shortcut-key` and the same change/save builders; they must never carry `data-setting-key` or be moved into original categories. Optional view failures do not block normal settings. Companion recommendations are local informational links, not installers.
