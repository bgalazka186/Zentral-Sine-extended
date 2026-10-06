# Core bootstrap/runtime

Start at `Zentral.uc.js`. Starts the loader, publishes shared services, owns feature availability/cleanup and registers ordered owner-gated styles. Catalog names the feature entrypoints and the settings owner list.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File | Responsibility |
| --- | --- |
| `Zentral.uc.js` | Canonical bootstrap. Resolves the install root from the executing script, creates the privileged source/resource loader, caches registrations and reads, and opens bootstrap diagnostics. |
| `ZentralCatalog.js` | Data catalog of feature entrypoints, required/optional panel parts, context dependencies and ordered stylesheet ownership. |
| `ZentralRuntime.js` | Owns per-window feature records, preparation/activation, availability, hooks, CSS registration, settings routing and native sidebar geometry tracking. |
| `ZentralShared.js` | Shared preference constants, Core preference/logging utilities, SVG construction, icon strings and known service metadata. |
| `settings.json` | Settings schema and category/section metadata owned by core. |

## Outside collaborators

- `features/appearance/ZentralAppearance.css`
- `features/apps/ZentralApps.uc.js`
- `features/apps/styles/ZentralAppTiles.css`
- `features/apps/styles/ZentralAppMenus.css`
- `features/apps/styles/ZentralVerticalBarLayout.css`
- `features/apps/styles/ZentralVerticalBarPresentation.css`
- `features/apps/styles/ZentralUtilityPlacement.css`
- `features/apps/styles/ZentralAutohideIndicators.css`
- `features/apps/styles/ZentralAutohideIndicators.css`
- `features/diagnostics/ZentralLogger.uc.js`
- `features/groups/ZentralTabGroups.uc.js`
- `features/groups/styles/ZentralGroupStructure.css`
- `features/groups/styles/ZentralGroupPresentation.css`
- `features/groups/styles/ZentralGroupMenus.css`
- `features/groups/styles/ZentralGroupMenus.css`
- `features/panels/ZentralPanels.css`
- `features/panels/ZentralPanels.uc.js`
- `features/panels/browsers/ZentralBrowserIntegrations.css`
- `features/panels/browsers/ZentralBrowserIntegrations.uc.js`
- `features/panels/corner-tiles/ZentralCornerPanels.css`
- `features/panels/corner-tiles/ZentralCornerPanels.uc.js`
- `features/panels/geometry/ZentralPanelGeometry.css`
- `features/panels/geometry/ZentralPanelGeometry.uc.js`
- `features/panels/navigation/ZentralPanelToolbar.uc.js`
- `features/panels/navigation/styles/ZentralPanelBackground.css`
- `features/panels/navigation/styles/ZentralPanelToolbar.css`
- `features/panels/secondary-views/ZentralSecondaryViews.uc.js`
- `features/panels/styling/ZentralPanelStyles.uc.js`
- `features/rss/ZentralRssDisplay.css`
- `features/rss/ZentralRssDisplay.uc.js`
- `features/settings/controllers/ZentralDeveloperSettings.js`
- `features/settings/controllers/ZentralFeatureSettings.js`
- `features/settings/controllers/ZentralSettingsCatalog.js`
- `features/settings/controllers/ZentralSettingsShell.js`
- `features/settings/styles/ZentralSettingsFoundation.css`
- `features/settings/styles/ZentralControls.css`
- `features/settings/styles/ZentralSettings.css`
- `features/tabs/ZentralTabDensity.css`
- `features/tabs/startup/ZentralStartup.uc.js`
- `features/tabs/unloading/ZentralTabUnload.uc.js`
- `features/video/ZentralVideoPreview.css`
- `features/video/ZentralVideoPreview.uc.js`
- `features/video/controllers/ZentralVideoSettings.js`

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.

## Styles owned here

| File | Responsibility |
| --- | --- |
| `ZentralNativeInteraction.css` | Disable page input while split views resize; keep native hidden tabs hidden. |
| `ZentralSidebarSizing.css` | Expanded native sidebar width limits and collapsed width reset. Independent of Apps activation. |
