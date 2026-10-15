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

## Settings flow

1. **Start here:** full settings export/import, links to setup pages, and seven essential switches (Apps/panels, video, tab groups, panel toolbar, Essential-tab panels, startup loading and middle-click unloading).
2. **Simple appearance:** five style presets, primary/secondary palette, transparency, button style and adjustable readability backing.
3. **Detailed appearance:** visible only in Detailed mode. Switching from Simple first copies the resolved palette. Collapsible sections cover text, panels, controls, settings, toolbars, pill, video, launcher decoration, menus and compatibility styling.
4. **Layout & density:** always available, independent of both palette modes and presets. Covers tab/folder density, icon sizes, app grid, controls and panel/video dimensions.
5. Feature behavior, integrations, advanced recovery/module tools and experiments follow; diagnostics is last.

The public preferences schema and owner descriptors expose the same 308 settings, including every independently switchable module/CSS group. Runtime fills missing native controls from that schema and replaces temporary rows when a feature supplies its specialized UI. Protected module switches still use the module manager.

Themes write an explicit set of color and decorative preferences, never density, panel dimensions, shortcuts or feature behavior. Selecting one starts in Simple mode. Default shares the canonical reset defaults. Reset colors leaves layout, decoration and web backing alone. Look backups include appearance and layout; full backups include feature preferences too.

Search opens Detailed before focusing an individual appearance control and expands its section. Shared pages keep their own identity when video or optional settings components unload. UI synchronization is event-driven; disabled artwork scaling does not observe the browser subtree.

Settings structure is cached per modal and feature/schema revision. Reopening only syncs existing schema fields; feature UI arriving later invalidates the cache. Hidden settings do not rebuild on runtime notifications. Schema booleans use the same switch markup as native controls, never text-field classes. Appearance edits are coalesced per animation frame and do not schedule panel-wide host/tile/browser maintenance. Black web backing preserves toolbar and URL-field theme colors.

Readability strength also reinforces the toolbar strip and sidebar-video card, not only buttons and URL fields. Their foreground colors are computed against the same effective backing. Paper explicitly starts those surfaces at 100% opacity; light Simple palettes derive pale fields instead of gray fields. Transparent keeps low strength and approximately 90–95% transparent chrome. These surfaces paint locally to prevent inherited sidebar styling from separating their text and backing.

Primary propagates to both panel toolbars/URL surfaces, video, menus and settings in Simple mode. Secondary supplies borders, focus/caret/selection, source highlights and active indicators. URL focus no longer uses Zen's unrelated browser accent. Destructive menu actions use the configured Danger color; their foreground follows the displayed, contrast-adjusted color. Muted text is not faded again after contrast correction. Detailed mode retains a snapshot of these derived roles.
