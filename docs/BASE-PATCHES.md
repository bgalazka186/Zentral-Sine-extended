# Zentral Extended 3.0.0 — base modifications

Upstream reference: **Zentral 1.1.0**, commit `0e18990c0bfa2563d22de8f5d04135da186ef1b0`.
Extended input: `3e96d2e68faf7338374a28a9dc1c460d007016bb` from the supplied ZIP.

## What runs

Sine loads `loader/Zentral.uc.js` once. Core declares the catalog, loads sources and settings, waits for native restoration and activates dependencies. `zentral/apps/` and `zentral/groups/` contain the original-derived implementation with Extended's existing hardening preserved. `zentral/compatibility/ZentralBaseBridge.js` exposes the versioned boundary. `extension/` owns Zentral-dependent behavior and `additional/` owns independent features. The untouched upstream reference under `zentral/upstream/1.1.0/` is never executed or registered as a stylesheet.

The base retains Extended's extracted controllers rather than restoring the upstream monolith. This preserves its native restoration, validated storage, containers, notifications and compatibility work. The 1.1.0 behavior is integrated through the ports below. This is a selective, documented hybrid adaptation, not a claim that the runtime is a byte-identical upstream 1.1.0 file plus a tiny patch. The structural diff is consequently large; use the source map and change ledger for semantic review.

## New base edits

| ID       | Source / symbol                                                         | Change, reason and ownership                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B001     | `zentral/apps/ZentralApps.uc.js` / `getPanelSnapshot`                   | Exposes active identity, root, browser and presentation flags. The repair adds a frozen `controls` bundle containing live Pin/Expand/Refresh references for stable button identity. App data is a frozen copy; private fields remain base-owned. Extensions no longer guess active identity from tiles alone. DOM/browser references are live and must not be repurposed or retained after disposal. |
| B002     | Same / `updateAppStartURL`; `controllers/ZentralAppModel.js` / `addApp` | One validated update path for normal app records; addApp returns its new record to report success. Existing validators, limits, width, zoom, workspace and icon storage remain authoritative. Essential/secondary actions create a new normal app.                                                                                                                                                   |
| B003     | `zentral/apps/controllers/ZentralPanelPosition.js` / `positionPanel`    | Delegates to the optional placement owner while it owns a root. Companion guards in the coordinator, legacy geometry and native sidebar constraint prevent competing writes. Without that owner, existing Extended geometry runs.                                                                                                                                                                    |
| B004     | `zentral/apps/ZentralApps.uc.js` / `setPanelExpanded`                   | Updates base expand state/icon without calculating geometry again. The new geometry service owns the rectangle; base view-state capture/restoration stays consistent.                                                                                                                                                                                                                                |
| B014     | `zentral/groups/ZentralTabGroups.uc.js` / `onEnabled`                   | An explicit external-Tab-Groups compatibility preference pauses Zentral group hooks and owned CSS. It does not delete saved groups, change the external mod, or silently reset the user's Zentral enable preference.                                                                                                                                                                                 |
| B015     | `zentral/apps/controllers/ZentralAppsLauncher.js` / `repositionGrid`    | Optional `runtime.baseBridge.launcherPolicy.useToolbar(this)` boolean policy. A null/undefined result uses the original collapsed-sidebar decision. The extension owns the preference and cleanup; the base keeps all DOM placement.                                                                                                                                                                 |
| B016     | `zentral/apps/ZentralApps.uc.js` / `selectHostedPanelBrowser(browser)`  | Validates a connected browser already contained in the open primary slider, then selects only its active app identity. Triple View swaps call it after exchanging live slot roles. It never navigates, reparents, changes geometry or writes app records. This keeps base unload/toggle semantics aligned with the new top slot.                                                                     |
| U110-GEO | `zentral/geometry/ZentralPanelMath.js`                                  | A single pure geometry implementation adapted from upstream's separate helper. Finite-number validation, small-window bounds and reachability are centralized. There is no competing embedded fallback.                                                                                                                                                                                              |

## Existing Extended base changes retained

These are inherited behavior, not new 3.0.0 features. Their controller headers/READMEs document local contracts; compare the supplied input or the generated patch when auditing them.

| Area                        | Why it stays                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| App model                   | Validated app IDs/URLs, bounded data, persistent zoom and workspace identities.                                       |
| Panel lifecycle             | Bounded startup/preload work, browser reuse, close versus unload semantics, cold-start visibility ordering, teardown. |
| Launcher/position           | Current sidebar and vertical-bar behavior, native Library collision guard and theme integration.                      |
| Notifications               | Essential-aware event-driven badges; optional configurable fallback polling.                                          |
| Groups store/native adapter | Existing SessionStore, hierarchy, native tab and Zen Library compatibility.                                           |
| Shared Core                 | Common utilities used by independent features; kept in `loader/`, does not instantiate Apps/Groups.                   |

## 1.1.0 integration ledger

| Upstream change                               | Resolution in 3.0.0                                                                                                                                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Floating placement and eight-direction resize | New feature owns placement; current browsers stay in their existing containers. Detached primary panels expose all resize handles; docked handles retain the existing All-Sides Resize setting.                                                          |
| Snap preview / side selection                 | One ghost and cancellable gesture; panel-edge penetration (default 15 px) and gap selectable. Saved side is per app by default, with workspace/global options.                                                                                           |
| Partial off-window placement                  | Explicit opt-in; keeps a visible strip and insets/clamps the primary pill into the visible area. Separate from hover hiding.                                                                                                                             |
| Remembered float rectangles                   | Versioned pref survives restarts; upstream's in-memory Map is not reused as persistence. Reset position is available from tile and panel-chrome RMB menus.                                                                                               |
| Auto-pin while detached                       | Temporary pin. Clicking Pin changes the preference restored on docking; holding Pin still enters Super Pin.                                                                                                                                              |
| Navbar                                        | Existing Extended toolbar retained. Search/custom engines and upstream-style address-only input are selectable. No duplicate upstream navbar is loaded.                                                                                                  |
| Reload/Stop and location updates              | Existing owned progress listeners signal the bridge; toolbar targets its own browser. No second progress-listener graph or new polling timer.                                                                                                            |
| Zoom                                          | Existing Extended model, ZoomManager and process-change restoration retained.                                                                                                                                                                            |
| Mobile UA                                     | Existing identity/container recreation and RMB switching retained. The user explicitly excludes a Mobile UA pill shortcut; do not add one or a competing `app.mobile` store.                                                                             |
| Save default URL                              | Explicit current-page action, validated before persistence. Does not strip meaningful query parameters. Essential/tab-linked and secondary pages create a standalone app.                                                                                |
| Ctrl/Cmd+L                                    | Panel/browser focus scoped. Outside panel focus, native browser shortcut is preserved.                                                                                                                                                                   |
| Pill layout                                   | Upstream-inspired separate close box is default; classic single pill selectable. Existing hide controls remain. The later repair removes redundant Detach/Mobile/Save pill controls and their hide settings, retaining Move/Resize and Save on URL bars. |
| Effective light/dark tooltip colors           | Independent theme service with browser/content/system/manual policy and readable/high-contrast/custom modes. All subscriptions are owned.                                                                                                                |
| Context-menu protection                       | Existing Extended outside-click and native command routing retained.                                                                                                                                                                                     |
| Independent original script registrations     | Not copied. Only the Core entrypoint is registered by Sine.                                                                                                                                                                                              |

## Ownership and cleanup

`base-bridge` depends on Apps. `panels` depends on Apps and the bridge. `panel-enhancements` depends on panels and the bridge. Independent video, RSS, tab startup/unload/drag, Library/compact-hover and theme services do not require Apps.

New method wrappers install through `bridge.wrap`, with per-feature cleanup as well as bridge cleanup. Restoring a method checks ownership. Captured wrappers become inert after disposal so a later mod's wrapper is not overwritten. `ctx.floating` is the sole primary/Super Pin rectangle writer while active. Legacy geometry and the native layout tracker delegate through B003. Shared `ctx` preparation remains registration-only and retains the existing native restoration barrier.

New placement work uses pointer events, one temporary shield, one ghost and gesture-end persistence. Cancellation, app/workspace changes, resize, window blur and unload release work. Navigation and toolbar updates reuse existing progress events. New settings bypass unrelated host reconstruction in `reconcileFeaturePreferences`.

The existing extension still contains inherited wrappers outside the new bridge. These have not all been rewritten into an API; keep their contracts during future updates. A full monkey-patch elimination is not claimed.

## Known validation boundary

Node DOM fixtures verify behavior and contracts, not native remote-XUL compositor behavior. Live tests are required for Sine hot unload, remote keyboard focus, visual pill positioning, captured-caption rendering and simultaneous companion mods. No live Zen instance was available for this build.

## Repair integration

Read `REPAIR-HANDOFF-3.0.0.md` before changing B001/B015 or geometry ownership. B001 controls is an additive contract-v1 capability; callers must tolerate missing controls when diagnosing mixed/partial installations. B015 is optional: returning null preserves native fallback behavior. Do not put feature preferences, hold timers or launcher rebuilding into the API method. Source/API changes are recorded by the regenerated adapted-base diff.

## Extended 3.0.1 sidebar/input audit

Original-derived Apps and Groups styles now accept boolean native sidebar flags, including an empty attribute, while respecting explicit `"false"`. PanelPosition and LibraryCompatibility use the shared runtime side resolver. Two inherited `-moz-window-dragging: no` values in AppsInjected are corrected to `no-drag`. These are adapted-base changes recorded in the regenerated patch; keep the pristine upstream snapshot unchanged. Native divider protection, measurement and input/appearance additions live outside the original-derived tree.
