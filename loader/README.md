# Core bootstrap/runtime

Start at `Zentral.uc.js`. Starts the loader, publishes shared services, owns feature availability/cleanup and registers ordered owner-gated styles. Catalog names the feature entrypoints and the settings owner list.

## Startup and diagnostics

The runtime loads feature declarations and their owned styles before activating modules. All feature activation, including live enable requests during startup, waits for session restoration, Zen workspace initialization, and `gZenStartup.promiseInitialized` (when available) through one shared `nativeReady` promise. Zen’s final startup barrier initializes compact-mode mouse actions; activating against the earlier workspace promise alone can leave saved window-entry reveal inactive. A final task lets native preference observers settle. Features still activate in dependency order, and an individual feature failure remains isolated.

Developer status and copied reports expose `startupStage`, readiness warnings, feature failures and dependency blocks. Startup stages distinguish waiting for the browser, loading sources, loading styles, waiting for native restoration, activating features and ready. Closing the window cancels owned work; a completed readiness promise cannot reactivate a disposed runtime.

## Feature lifecycle contract (including instructions for future AI edits)

Core schedules and owns work; features own behavior. Do not add feature-specific preferences, DOM selectors, visual changes or native patches to the scheduler. Existing sidebar geometry/appearance code is legacy ownership, not a pattern for new features.

1. Sine loads only `loader/Zentral.uc.js`. Source loading must synchronously register definitions/factories; it must not start a feature, patch native objects or wait on a promise. Never register each `.uc.js` independently.
2. Catalog IDs are unique. `requires` lists services that must be active before initialization. `sources` lists panel parts that must be declared. `contextDependencies` documents the shared panel context and is not an ordering graph. Missing required dependencies block only their consumers; optional files must have optional callers.
3. Core completes the entire declaration pass before validating registrations, loads owned CSS in catalog order, then waits for native restoration. It re-reads live native promises after each barrier because managers can be created while another service restores. Rejected barriers are reported; closing the window cancels the wait. An unresolved native restoration promise remains a visible waiting state, not permission to mutate partially restored tabs.
4. `init({ shared, runtime, lifecycle })` is synchronous and runs once. Core marks it initializing before calling it and coalesces reentrant activation requests. Return a disposer or a service with `destroy()`. Register partial cleanup with `lifecycle.own()` **before** fallible work. A failed initializer is rolled back and reported, not blindly replayed. Existing legacy feature cleanup remains supported.
5. A preference being true does not prove its native hooks exist. Use `lifecycle.watchNative()` for lazy or replaceable browser APIs. Put availability probes and attachment behavior in the feature; the core watcher owns bounded startup checks, live preference subscriptions, event-driven recovery and rollback. `resolve` must be read-only and return a stable object identity or null. `attach` is synchronous and receives a fresh child scope. Return a disposer or service with an optional `isCurrent()` to detect same-object hook replacement. Never query properties with side effects just to test readiness.
6. Watchers make five startup checks over roughly 6.2 seconds, then stop scheduling checks. Native events or an explicit interaction can still recover a late API. Declare only relevant events/topics; do not add permanent polling or a full-document subtree observer. Synchronous capture recovery is appropriate only when hooks must exist before a native interaction. `onReadyEvent(event)` can prime that one interaction because listeners installed during dispatch may miss it.
7. `enabled` must read the saved preference live. False detaches the native attachment, cancels timers and removes its event/topic listeners; only its preference subscription remains. Do not reset user choices at startup. Native method restoration must compare exact descriptor ownership so another mod's newer hook is never overwritten. Captured old wrappers must become inert after disposal.
8. Use scope `listen`, `observe`, `preference`, `setTimeout`, `requestAnimationFrame`, and `own` rather than unowned work. Scope teardown is idempotent, reverse ordered and continues after cleanup errors. For async work, capture the child scope and check `child.active` after every await before touching DOM/native state. Aborting a request is preferable when supported. A feature-specific controller may keep its existing cancellation generation.
9. Create the coordinator cleanup array **before** publishing lazy context getters or calling `prepareParts(ctx, cleanupFns)`. Pass that array explicitly. Core must never invoke `ctx.cleanupFns` or other lazy getters during preparation: their backing lexical bindings may not yet exist. Descriptor snapshots must use `Object.getOwnPropertyDescriptors`, without reading property values. Optional panel preparation must publish reversible configurable context properties only, register cleanup immediately, and yield before activation. Core isolates preparation failures and restores context descriptors. Nested shared-object mutation during preparation is forbidden: core cannot infer how to reverse it. Required-part failure blocks its coordinator; optional-part failure must not break other parts. Parts activate once, in the coordinator's documented order.
10. Removing a feature means removing its catalog entry, owned CSS/settings metadata and optional callers together. Keep required dependency errors explicit. Do not delete shared controllers used by other owners. Test the installation both with and without optional files. Module-level developer switches remain restart-scoped; feature preferences can be live. Do not imply that a module toggle hot-unloads its dependents.

### Minimal native integration pattern

```js
ZentralRuntime.register({
  id: "my-feature", // same ID as the catalog
  init({ lifecycle }) {
    lifecycle.watchNative({
      name: "native-binding",
      prefs: [MY_PREF],
      enabled: () => Services.prefs.getBoolPref(MY_PREF, false),
      resolve: () => findReadyNativeObject(), // stable identity; no mutation
      events: ["activate", "aftercustomization"],
      attach(native, child) {
        const release = installOwnedBehavior(native);
        child.own(release); // register immediately, before the next operation
        return { isCurrent: () => stillOwnsNativeHooks(native) };
      },
    });
    // Core already owns lifecycle; returning a separate service is optional.
  },
});
```

`runtime.snapshot().features[].nativeBindings` reports waiting/active/disabled state, attachment attempts and the last error. A feature can be initialized while its native binding waits. Use this status when an enabled setting appears ineffective; do not suppress the error or force its preference off and on.

### Startup audit and regression coverage

The catalog's feature entrypoints, required/optional panel parts, owned CSS and literal controller load paths are checked for presence and consistent IDs. Apps and Groups already own their preference-driven instances; the panel coordinator owns its prepared parts and retry queue; startup tab loading owns restoration cancellation; RSS, unloading, video and diagnostics retain their existing cleanup. RSS also uses the shared native watcher to recover late/replaced tab strips. Library and compact-hover retain their specialized event/layout logic, including event-driven recovery for late native readiness. These are not blindly reinitialized by the generic watcher. Background tab dragging now uses the shared watcher because its native API may arrive late or be replaced after initialization.

Run `node tests/core-startup.test.cjs`, `node tests/zen-1.23.3b-compat.test.cjs` and `node tests/zen-followup-regressions.test.cjs` when the development tests are available. Cover dependency order and reentrancy, failed-init rollback, missing optional/required sources, late/rejected native barriers, shutdown during startup, preferences off/on, same-object hook replacement, first interaction after late attachment, and exact descriptor restoration. Mocks cannot verify real Gecko event dispatch, sleep/wake compositor behavior or every Sine/Zen build; also test cold startup, a second window, customization and disabled preferences in live Zen.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                | Responsibility                                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Zentral.uc.js`     | Canonical bootstrap. Resolves the install root from the executing script, creates the privileged source/resource loader, caches registrations and reads, and opens bootstrap diagnostics. |
| `ZentralCatalog.js` | Data catalog of feature entrypoints, required/optional panel parts, context dependencies and ordered stylesheet ownership.                                                                |
| `ZentralRuntime.js` | Owns per-window feature records, preparation/activation, availability, hooks, CSS registration, settings routing and native sidebar geometry tracking.                                    |
| `ZentralShared.js`  | Shared preference constants, Core preference/logging utilities, SVG construction, icon strings and known service metadata.                                                                |
| `settings.json`     | Settings schema and category/section metadata owned by core.                                                                                                                              |

## Outside collaborators

- `extension/appearance/ZentralAppearance.css`
- `zentral/apps/ZentralApps.uc.js`
- `zentral/apps/styles/ZentralAppTiles.css`
- `zentral/apps/styles/ZentralAppMenus.css`
- `zentral/apps/styles/ZentralVerticalBarLayout.css`
- `zentral/apps/styles/ZentralVerticalBarPresentation.css`
- `zentral/apps/styles/ZentralUtilityPlacement.css`
- `zentral/apps/styles/ZentralAutohideIndicators.css`
- `zentral/apps/styles/ZentralAutohideIndicators.css`
- `additional/diagnostics/ZentralLogger.uc.js`
- `zentral/groups/ZentralTabGroups.uc.js`
- `zentral/groups/styles/ZentralGroupStructure.css`
- `zentral/groups/styles/ZentralGroupPresentation.css`
- `zentral/groups/styles/ZentralGroupMenus.css`
- `zentral/groups/styles/ZentralGroupMenus.css`
- `extension/panels/ZentralPanels.css`
- `extension/panels/ZentralPanels.uc.js`
- `extension/panels/browsers/ZentralBrowserIntegrations.css`
- `extension/panels/browsers/ZentralBrowserIntegrations.uc.js`
- `extension/panels/corner-tiles/ZentralCornerPanels.css`
- `extension/panels/corner-tiles/ZentralCornerPanels.uc.js`
- `extension/panels/geometry/ZentralPanelGeometry.css`
- `extension/panels/geometry/ZentralPanelGeometry.uc.js`
- `extension/panels/navigation/ZentralPanelToolbar.uc.js`
- `extension/panels/navigation/styles/ZentralPanelBackground.css`
- `extension/panels/navigation/styles/ZentralPanelToolbar.css`
- `extension/panels/secondary-views/ZentralSecondaryViews.uc.js`
- `extension/panels/styling/ZentralPanelStyles.uc.js`
- `additional/rss/ZentralRssDisplay.css`
- `additional/rss/ZentralRssDisplay.uc.js`
- `extension/settings/controllers/ZentralDeveloperSettings.js`
- `extension/settings/controllers/ZentralFeatureSettings.js`
- `extension/settings/controllers/ZentralSettingsCatalog.js`
- `extension/settings/controllers/ZentralSettingsShell.js`
- `extension/settings/styles/ZentralSettingsFoundation.css`
- `extension/settings/styles/ZentralControls.css`
- `extension/settings/styles/ZentralSettings.css`
- `additional/tabs/ZentralTabDensity.css`
- `additional/tabs/startup/ZentralStartup.uc.js`
- `additional/tabs/unloading/ZentralTabUnload.uc.js`
- `additional/video/ZentralVideoPreview.css`
- `additional/video/ZentralVideoPreview.uc.js`
- `additional/video/controllers/ZentralVideoSettings.js`

Full installation uses root `theme.json` and `preferences.json`, plus `loader/`; Sine loads `loader/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.

## Styles owned here

| File                           | Responsibility                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `ZentralNativeInteraction.css` | Disable page input while split views resize; keep native hidden tabs hidden.                    |
| `ZentralSidebarSizing.css`     | Expanded native sidebar width limits and collapsed width reset. Independent of Apps activation. |
