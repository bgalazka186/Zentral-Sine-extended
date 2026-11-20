# FOLLOW-UP 2 for the coding agent — make Game Mode invasive but fully recoverable (Zentral 3.4.0)

**This file is the active TODO list for this branch.** It replaces the earlier ad-hoc TODOs for Game Mode work;
work the tasks in the order below, one commit per task, and keep the status table in section 7 current.
Read `AGENTS.md` and `loader/README.md` (the lifecycle contract) before the first change. `docs/PLAN_CODING_AGENT.md`
section 1 (rules) still applies: tests required, kill-switch prefs for risky behavior, no new `setInterval`, locate
code by symbol name, update `docs/perf-results.md` and the single handoff (`TODO_notes_roadmap.md`).
The two owner additions to this plan are **G10** (Boost widget in the standalone Boost mod) and **G11** (every
setting in `preferences.json` reachable from the Zentral main settings menu). G11 is a prerequisite for the new
Game Mode prefs of G2/G5; G10 is a prerequisite for the widget changes of G7 to work outside the full pack.

## 0. Review result of 3.4.0

- Build check up to date, `node tests/run-all.cjs`: 282/282 passed. **(Earlier snapshot. The current tree has 294
  test files; see G0.)**
- Earlier follow-ups are done and fine: panel records are owned by the panel loop (OW-111), `unload_pinned`
  replaced `keep_pinned` (OW-112), the video source getter `window.__zentralVideoSourceTab` exists, Notes placeholder
  visuals were fixed (OW-116/119/120), the deep pass runs a light clean first (OW-121).
- The owner reports that **Game Mode does very little**. The code review shows why, below. The owner's requirement:
  **Game Mode must be invasive (free as much RAM as possible) but recoverable with one Restore action.**

### 0a. Findings that differ from this plan (rule 9: record them, do not invent a different design)

- The checkout arrived with **unresolved merge markers** in six files (`.gitignore`, `TODO_notes_roadmap.md`,
  `docs/LEGACY_done_rows.md`, `docs/ow-114-pending-css-audit.md`, `z-heights_map.md`,
  `additional/notes/standalone.lock.json`). That made `node tools/check-settings-consistency.cjs` crash on the lock
  file and broke 7 of 294 test files. G0 repairs this; no feature code was changed to do it.
- `PLAN_DIAGNOSTICS.md` was supplied by the owner on 2026-11-19 and is now persisted as
  `docs/PLAN_DIAGNOSTICS.md` (section 11 carries the supplied normal-session D1 baseline, `TOTAL_MB=5933`). The D1
  procedure can be followed as written; the **after-sleep comparison** for G1 is still an owner gate, not measured
  here. Do not invent a replacement measurement and call it D1.
- `additional/boost/settings.json` declared only the `Memory` and `Limiter` sections in its own `categories` block
  while its `game_mode` / `stronger_saver` rows point at `Game Mode`. The shared `extension/settings/layout.json`
  already had the section; G11 adds the missing local declaration.
- `extension/settings/controllers/ZentralSettingsCatalog.js` listed 24 owner descriptors but **not Boost's**, so
  11 of the 601 settings in the root `preferences.json` had no control in the main settings window. This is the
  OW-61 bug class; G11 fixes it and adds a guard.
<<<<<<< HEAD
- The live handoff in `TODO_notes_roadmap.md` says **keep the version at 3.4.0 until the owner says otherwise**.
=======
- The live handoff in `TODO_notes_roadmap.md` says **keep the version at 3.4.1 until the owner says otherwise**.
>>>>>>> 3e6d7d32ec15c70a605d41b01dd18c88b7eb08db
  That overrides rule 5's `--bump`: use the `--keep-version` chain from G0 and run `node tools/sync-version.cjs
  --check`, never a version bump, unless the owner explicitly approves one.

## 1. Why Game Mode does little today (verified in `additional/boost/ZentralBoost.uc.js`)

1. `applyGameMode(true)` = `performance.setPaused(true)` + `runLevel2({ allowPanels: false })` + `deactivateForGameMode(gameModeTargets())`. Background tabs are already inactive in Firefox, so setting `docShellIsActive=false` / `renderLayers=false` on them frees almost nothing; it only saves some CPU.
2. `runLevel2` keeps pinned and essential tabs unless `unload_pinned` is on (the owner has 39 pinned tabs of 45), and with `allowPanels:false` it never touches panel records. So almost nothing is unloaded.
3. "Stronger saver" is a separate pref (`stronger_saver`, default false) and runs only after Level 2 resolves.
4. **Sleeping a panel record unloads the wrong object.** `runLevel2` and `strongerSaverSleep` call `gBrowser.explicitUnloadTabs([record.tab])`. For Essential panels the live page is the panel's own app browser, created by `getOrCreateAppBrowser(record.app)` inside `loadEssentialInBackground` and stored in `state.appBrowsers`. Zentral's own CSS says "A pending tab can contain an already loaded panel" (`extension/appearance/ZentralAppearance.css`, tile `data-loaded="true"`). `apps.closeApp(appId)` (`zentral/apps/controllers/ZentralPanelLifecycle.js`) is the function that stops navigation, removes that `<browser>`, deletes it from `appBrowsers` and sets the tile `data-loaded="false"`. Boost never calls it. Unloading only the tab can leave WhatsApp/Messenger/arena.ai fully loaded in the panel. The wake side already uses the app-browser path (`loadEssentialInBackground`), so sleep and wake are not symmetric. This is the most likely main cause; it must be confirmed by measurement (task G1).
5. The selected tab is never unloaded (`gameModeExemptReason` returns `selected`), even when it is a 0.6–1 GB page that is not playing anything.
6. Restore is incomplete: `rememberUndone("tabs", { tab: null, url, title })` stores no element although an unloaded tab stays in the strip as a pending tab; `restore()` only wakes panels and merely counts tabs. Turning Game Mode off restores activity and unpauses but does not wake anything.
7. Nothing stops Zentral's own automatic wake paths (preload, `syncAppPanelBrowserActivity`) from undoing the sleep while Game Mode is on.
8. The person cannot see what was kept and why, or how much was freed.

## 2. Target behavior (the contract for this follow-up)

**Game Mode ON** (widget switch, shortcut, or pref):
1. Take a **snapshot** of the session (what is loaded, which tab is selected, each browser's activity state).
2. Free everything except the **exemptions**: any audible tab or panel; the video preview's source tab; tabs in a call, sharing, or Picture-in-Picture; tabs whose host matches the optional `game_keep_hosts` list; the Boost parking tab (G4). Nothing else is protected. Pinned/essential tabs and EVERY panel record are included, whatever `unload_pinned` or the record's `backgroundMode` say: switching Game Mode on is the consent.
3. The selected tab is parked (G4) so it can be unloaded too, unless it is exempt.
4. Pause Zentral's timers (already done), block automatic wakes (G6), run the cleanup (G8), and report: freed MB, unloaded tabs, slept apps, kept items with reasons.

**Game Mode OFF**: unpause, reactivate the selected tab, show a toast "Restore N apps and M tabs" with a Restore action; the snapshot stays available until Restore is used or the browser restarts. Pref `game_restore_on_exit`: `ask` (default, toast with action), `always` (restore immediately), `never`.

**Restore** (button in the widget, toast action, menu entry; works while Game Mode is on or after it is off): brings the session back in a staggered, ordered way (G5) and clears the snapshot.

## 3. Tasks, in this order

### G0 — Prerequisite: clean checkout (DONE this session, one `chore` commit)

- Resolve the six conflict-marker files listed in 0a: keep both sides of the `.gitignore` docs exceptions, keep the
  newer `beta` side of the roadmap/done-rows, regenerate `docs/ow-114-pending-css-audit.md` with
  `node tools/audit-pending-placeholder-css.cjs --write`, `z-heights_map.md` with `node tools/build-z-map.cjs`, and
  the Notes standalone lock (never hand-edit a lock) with `node tools/build-standalone.cjs --keep-version`.
- Green chain, no version bump: `node tools/build-standalone.cjs --keep-version && node tools/sync-version.cjs
  --check && node tools/build-preferences.cjs && node tools/build-z-map.cjs && node tools/build-standalone.cjs
  --check && node tools/check-settings-consistency.cjs && node tests/run-all.cjs`.
- After G0: the 7 previously failing suites are green and the full suite is 294/294 (295 with G11's new test).
- Record the corrected baseline in the handoff. Do not start G1 on a tree with conflict markers.

### G11 — Every `preferences.json` setting reachable in the Zentral main settings menu (DONE this session)

Owner point: "all settings from preferences.json are accessible in zentral main settings menu".

- Verified gap: `tools/build-preferences.cjs` generates all 601 root Sine preferences from the 25 owner
  `settings.json` schemas and `extension/settings/layout.json` (which already declares the `boost` category with
  `Memory`, `Limiter` and `Game Mode` sections and orders all 11 Boost keys). But
  `ZentralSettingsCatalog.js`'s `descriptorFiles` array omitted `additional/boost/settings.json`, so the full pack's
  main settings window rendered none of them. `tools/check-settings-consistency.cjs` only checked
  schema → settings metadata, so it could not catch a whole missing descriptor (OW-61's bug class).
- Fix: add `{ owner: "boost", file: "additional/boost/settings.json" }` to `descriptorFiles` (`settingsOwners`
  already contains `boost` from the catalog). Add the missing `Game Mode` section to Boost's own `categories` block.
- Add `tools/lib/settings-coverage.cjs` and wire it into `tools/check-settings-consistency.cjs` (which still must
  print `catalog checks passed` and now exits non-zero on errors). It checks: every owner schema file is listed by
  the catalog; every root `preferences.json` field resolves to a schema row with a declared category/section
  (numeric `<key>_text` twins map back through `textKey()` from `tools/lib/sine-prefs.cjs`); every standalone
  package's generated `preferences.json` resolves to an owned/borrowed row and every owned row is shipped unless
  `excludePrefs` says otherwise.
- Tests `tests/settings-catalog-coverage.test.cjs`: RED on the pre-G11 catalog (Boost descriptor removed in a temp
  fixture), GREEN on the fix; numeric twins, orphan Sine pref, missing standalone pref, all 601 fields placed,
  all 11 Boost keys ordered/generated/declared.
- **This guard is a prerequisite for G2/G5**: every new `game_*` pref must be in `settings.json` (schema +
  settings), `layout.order`, the generated root `preferences.json`, and Boost's standalone `preferences.json`.
  Run `node tools/organize-layout-order.cjs && node tools/build-preferences.cjs` after adding them, then
  `node tools/check-settings-consistency.cjs`.
- Docs: one line in `docs/perf-results.md`, Boost README, the handoff. No new pref, no version bump.

### G1 — Real panel sleep and wake (HIGH, do first, because everything else depends on it)

- Sleeping a panel record must free BOTH possible holders: (a) the panel's app browser, with `window.Zentral.Apps.closeApp(appId)` (the same public method the "Unload App" menu uses; it persists zoom and cleans addon-host records through the wrapper in `ZentralPanels.uc.js`), and (b) the record's tab, with `gBrowser.explicitUnloadTabs([record.tab])` if the tab is loaded (not `pending`). Order: panel browser first, then the tab. Never call `closeApp` for the audible/selected/video-source exceptions.
- Use one helper `sleepPanelRecord(record, ctx)` in Boost for the deep pass, the limiter, Stronger saver and Game Mode. It returns `{ slept: bool, how: "panel"|"tab"|"both"|"none", reason }`.
- Wake with the existing `ctx.loadEssentialInBackground(record, false)`; check its second parameter in `extension/panels/corner-tiles/ZentralCornerPanels.uc.js` (`automatic`): `false` is correct for an explicit wake (it skips the `record.app.preload` gate). After a wake, the tile must show `data-loaded="true"` and the page must load. Do not change `loadEssentialInBackground`.
- Handle the case where the page is in the tab and not in a panel browser (a tab the person opened and used directly): the tab path then does the work.
- Tests with fakes: a record with a live app browser and a pending tab → `closeApp` called once, tab not unloaded again; a record with a loaded tab and no app browser → tab unloaded; both loaded → both; audible → neither; wake calls `loadEssentialInBackground(record,false)` once.
- **OWNER GATE G1** (tell the owner in the handoff): with WhatsApp and Messenger panels open, run Level 2 with their mode set to `asleep-allowed`, then D1 (see `docs/PLAN_DIAGNOSTICS.md` section 9; the supplied normal-session baseline is section 11, `TOTAL_MB=5933`). The WhatsApp/Messenger processes must disappear from D1 and total MB must drop by about 0.7–0.9 GB each. If they remain, report the process titles. The procedure is now supplied; the after-sleep D1 comparison is still an unmeasured owner gate.

### G2 — Game Mode planner (pure logic, with dry run)

- Add `planGameMode(input)` (pure, unit-testable) returning `{ sleepPanels: [...], sleepTabs: [...], park: tab|null, keep: [{ id, kind, reason }] }`. Input: tabs, panel records, selected tab, video source, `keepHosts`, policy functions. Reasons are the policy's own strings plus `audible`, `video-source`, `selected` (only if parking is off or impossible), `keep-host`, `parking-tab`.
- It must ignore `unload_pinned` and each record's `backgroundMode` (Game Mode consent). It must still respect: audible, sharing/camera/mic, PiP, video source, already pending, private windows rules of the policy, and `explicitUnloadTabs` refusals (`beforeunload` prompts): a refusal is recorded as `kept: refused`, never forced.
- Expose `planGameMode` through the API as a **dry run** `previewGameMode()` that returns the plan without changing anything. The widget uses it for the hint text "Will free about N tabs and M apps" (counts only, no scanning in a timer: compute only when the menu/hint is opened).
- New prefs in `additional/boost/preferences.json` and `settings.json`: `zen.workspace.zentral.boost.game_keep_hosts` (string, comma-separated host names, default empty), `game_park_selected` (bool, default true). **Both must also be placed by G11's checker** (schema, `settings` meta, `layout.order`, root + standalone `preferences.json`).

### G3 — Snapshot and undo that really remember (replaces `tab: null`)

- `gameSession = { active, startedAt, panels: [{ appId, recordRef, wasLoaded, mode }], tabs: [{ tab, url, title, lastAccessed, wasPinned }], originalSelected: tab|null, parkingTab: tab|null, activity: Map(browser → {docShellIsActive, renderLayers}), beforeMB, afterMB, processesBefore, processesAfter }`.
- Keep real tab elements (an unloaded tab stays in the strip). Cap 500 entries; clear on Restore, on window unload, and on `destroy`. If an element is no longer connected when restoring, skip it silently.
- The same structure serves the deep pass (Level 2) so its Restore can also reload tabs (see G5); keep the old 50 cap for the limiter's undo list.
- Tests: snapshot content for a fake session; closed tabs are skipped on restore; `destroy` clears it.

### G4 — Park and unload the selected tab (invasive part)

- If `game_park_selected` and the selected tab is not exempt: create ONE parking tab (`gBrowser.addTab("about:blank", { skipAnimation: true, skipSessionStore: true, triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(), userContextId: <the selected tab's> })`), mark it with an attribute `zentral-boost-parking`, select it from a deferred task, then unload the original with `explicitUnloadTabs`. Remember the original in `originalSelected`.
- HAZARD (read the comment in `ZentralNotes.uc.js` `onZenSelect`): never change the selection inside Zen's own TabSelect dispatch (it corrupts the tab switcher and a pending tab may then never load). Use a scope `setTimeout(…, 0)` exactly like the Notes hand-back, and never from inside a `TabSelect` listener.
- On Restore/exit: select `originalSelected` (it is pending, selecting loads it), then close the parking tab. If `originalSelected` is gone, select the nearest normal tab and close the parking tab anyway. The parking tab must never be pinned, never saved to session (`skipSessionStore`), and must be excluded from every unload list.
- If anything fails (no `addTab`, selection change refused), do nothing and keep the old behavior (selected tab stays, reason `selected`).
- Tests: parking is created once; selection changes from a deferred task only; failure path leaves the session unchanged; Restore closes the parking tab; closing the original tab while parked is handled.

### G5 — Restore engine (staggered, ordered, one click)

- `restoreSession(options)` replaces and extends `restore()`; the existing `restore()` and its tests keep working for the deep pass (call into the same engine with the panels-only profile).
- Order: (1) re-select `originalSelected` first (it loads at once), (2) wake panel records in the snapshot with `loadEssentialInBackground(record,false)` (records that were `live` before first), (3) reload the other tabs newest-`lastAccessed` first.
- Stagger: one item every `game_restore_stagger_ms` (default 700) with at most 2 loading at a time (one scope timer chain; wait for `load`/`DOMContentLoaded` or an 8 s timeout, whichever first). This keeps the PC responsive right after a game and avoids a huge memory spike.
- How to load a pending tab WITHOUT selecting it: reuse the Startup module's helper (`wake(tab)` in `additional/tabs/startup/ZentralStartup.uc.js` ~line 112, which ends with `browser.reload()`); copy its logic into a small shared function, do not invent another way. Test in the real browser (owner gate) that a woken background tab actually loads.
- Prefs: `game_restore_tabs` (`all` default | `recent` | `panels` | `none`), `game_restore_recent_n` (default 8), `game_restore_stagger_ms` (default 700), `game_restore_on_exit` (`ask` default | `always` | `never`). **All four must pass G11's coverage guard.**
- Cancel: a second Game Mode ON or `destroy` cancels pending restore timers. A user click on a tab or tile that is still waiting simply loads it earlier; the engine skips items that are already loaded.
- Tests: ordering, staggering with a fake timer, concurrency cap, `recent`/`panels`/`none` profiles, skip-if-loaded, cancel on destroy, no work when the snapshot is empty.

### G6 — Block automatic wakes while Game Mode is on

- Audit every path that can load a slept panel or tab without a click and guard it with `ZentralRuntime.performance.isPaused()` or the Game Mode flag: `scheduleAutomaticPreloads` and the `loadEssentialInBackground(record, true)` callers in `ZentralCornerPanels.uc.js`, the `syncAppPanelBrowserActivity` branch that re-activates `live` preload panels (`ZentralBrowserIntegrations.uc.js`), the badge/notification sync, and the Startup module. Explicit user actions (clicking a tile or tab) must keep working, and a user-woken item is removed from the snapshot.
- Write the list of audited call sites in the handoff.
- Tests: with Game Mode on, an automatic preload request returns without creating a browser; with it off, unchanged.
- **DONE (G6):** all call sites below are guarded by the same live pause/Game Mode predicate, and the handoff carries the same list. Explicit actions are not blocked; a user-woken item is removed from the snapshot and pending Restore queue. `noteUserWake()` / `isRestoreWake()` keep Restore's own panel wakes from being mistaken for a click. No new pref, polling loop or `setInterval` was added; owned pause subscriptions re-arm the same one-shot work on resume, and the only new listener is Boost's capture `TabSelect`, removed by `destroy()`. `tests/g6-automatic-wake-guards.test.cjs` (11 passed) was run RED against a detached `d16728b` worktree and GREEN here.
  - `extension/panels/corner-tiles/ZentralCornerPanels.uc.js`: `scheduleEssentialPreload()` and `loadEssentialInBackground(record, true)`; explicit `false` wakes still work.
  - `zentral/apps/ZentralApps.uc.js` and `zentral/apps/controllers/ZentralPanelLifecycle.js`: `init()` / re-enable callers of `scheduleAutomaticPreloads()`, plus `cancelAutomaticPreloads()` / `preloadAppsSequence()` / the deferred schedule callback.
  - `extension/panels/browsers/ZentralBrowserIntegrations.uc.js`: `syncAppPanelBrowserActivity()`.
  - `zentral/apps/controllers/ZentralAppNotifications.js`: `syncAllAppBadges()` and `ensureBadgeSyncLoop()` (including its existing `setInterval` callback).
  - `additional/tabs/startup/ZentralStartup.uc.js`: `wake(tab)`, `pump()` and `scan()`.
  - `extension/panels/ZentralPanels.uc.js`: `syncPanelFallbackPolling()` / `runPanelFallbackMaintenance()`, the `ctx.syncAppPanelBrowserActivity()` wrappers/callers, and the explicit `apps.refreshApp()` wrapper that notes a user wake.
  - `additional/boost/ZentralBoost.uc.js`: `noteUserWake()`, `isRestoreWake()`, the owned capture `TabSelect` listener and the G5 Restore panel-wake marker.

### G7 — Feedback in the UI (DONE)

- Widget Boost card: Game Mode switch hint from `previewGameMode()` before switching on; after ON a toast: "Game Mode: freed X MB · N tabs, M apps unloaded · kept: <name (reason)>, …" (max 3 names, then "+K more"); after OFF a toast with the Restore action; the Restore button shows "Restore (M apps, N tabs)" while a snapshot exists and is disabled with the existing "Nothing to restore yet" text otherwise. Add en and pl strings like the existing ones. **G10 must be done first** so the same feedback exists when only the standalone Boost mod is installed.
- Extend `gameModeState()` with `{ freedMB, beforeMB, afterMB, processesBefore, processesAfter, unloaded: { tabs, panels }, kept: [{ id, kind, reason }], snapshot: { panels, tabs } }`. `processes*` = number of parent+children from `requestProcInfo`. The owner reads it with `Services.wm.getMostRecentWindow("navigator:browser").ZentralBoost.gameModeState()`.
- G8 already supplies the final freed/process/unloaded/kept fields; G7 therefore adds the UI feedback, EN/PL strings and the remaining snapshot summary after G10, without a second measurement path.

<<<<<<< HEAD
- **DONE (G7):** both Boost card owners now read `previewGameMode()` on hover/focus and immediately before ON, subscribe to Boost's one `onGameModeEvent()` door, show the G8 settled/final report as `Game Mode: freed X MB · N tabs, M apps unloaded · kept: …` (three named reasons then `+K more`), and show an OFF toast with a real Restore action. The Restore button uses the G3/G5 snapshot counts (`Restore (M apps, N tabs)`) or the existing `Nothing to restore yet` phrase while disabled. Boost owns the EN/PL strings and pure feedback helpers; the full-pack tray has matching pure fallbacks for a Widgets-only install. `gameModeState()` gains the snapshot summary without a second measurement path; `tests/g7-game-mode-feedback.test.cjs` (10 passed) is strict RED on detached `2fa3fd8` and GREEN here, the exact no-bump chain stays at 608 prefs/3.4.0, and the full suite is `305/305 passed; 0 failed`. No new pref, `setInterval`, polling loop or permanent observer was added; live toasts/visual parity remain owner gates.
=======
- **DONE (G7):** both Boost card owners now read `previewGameMode()` on hover/focus and immediately before ON, subscribe to Boost's one `onGameModeEvent()` door, show the G8 settled/final report as `Game Mode: freed X MB · N tabs, M apps unloaded · kept: …` (three named reasons then `+K more`), and show an OFF toast with a real Restore action. The Restore button uses the G3/G5 snapshot counts (`Restore (M apps, N tabs)`) or the existing `Nothing to restore yet` phrase while disabled. Boost owns the EN/PL strings and pure feedback helpers; the full-pack tray has matching pure fallbacks for a Widgets-only install. `gameModeState()` gains the snapshot summary without a second measurement path; `tests/g7-game-mode-feedback.test.cjs` (10 passed) is strict RED on detached `2fa3fd8` and GREEN here, the exact no-bump chain stays at 608 prefs/3.4.1, and the full suite is `306/306 passed; 0 failed`. No new pref, `setInterval`, polling loop or permanent observer was added; live toasts/visual parity remain owner gates.
>>>>>>> 3e6d7d32ec15c70a605d41b01dd18c88b7eb08db

### G8 — Cleanup after unloading, and no interference

- After the unload step: wait the existing settle time, run `lightClean()` again, and schedule ONE more `lightClean()` about 30 s later (one-shot timer, cancelled on Game Mode off/destroy) because Gecko frees content-process memory late. Report the final freed value in `gameModeState()`.
- While Game Mode is on: the RAM limiter does not run (no second pass fighting the first), startup trim is skipped, manual Level 2 returns the Game Mode state instead of starting a parallel pass.
- Tests: second clean scheduled once and cancelled on exit; limiter is idle in Game Mode.
- **DONE (G8):** `applyGameMode()` now runs ONE plan-driven `runGameModePass()` instead of `runLevel2({allowPanels:false})` + `strongerSaverSleep()`. The pass waits for G4's deferred parking door, re-reads the shared policy, unloads planned ordinary tabs and EVERY planned panel record through G1's `sleepPanelRecord`, and writes the G3 snapshot/undo entries once. It runs the shared `lightClean()` before the unload, again after the existing 3 s settle, and ONE more `lightClean()` after a 30 s one-shot scope timer; Game Mode off, Restore, a second ON and `destroy()` cancel the owned generation/timers. `gameModeState()` reports `freedMB`/`finalFreedMB`, before/after/final MB, process counts, unloaded counts, kept reasons and cleanup counters. While Game Mode is on, the RAM limiter does not run, startup trim is skipped once, and manual Level 2 returns the Game Mode state instead of a parallel pass. `stronger_saver` remains the all-panel-modes switch for Level 2 OUTSIDE Game Mode; its default is unchanged. A `false` `explicitUnloadTabs()` answer is reported as a kept `refused` reason, never force-closed. `tests/g8-game-mode-cleanup.test.cjs` (9 passed) was run RED (exit 1) against a detached `56fbeaa` worktree and GREEN here; no new pref, `setInterval` or polling was added.

### G9 — Docs

Update `additional/boost/README.md` (what Game Mode does and does not do, the exemption list, the prefs, how Restore works, what is lost: unsaved page state in unloaded tabs and a short reload time), the Settings strings, and the handoff.
- **DONE (G9):** `additional/boost/README.md` now has a dedicated Game Mode guide: what the one plan-driven pass does, what it never does, the full NEVER/keep-host/parking exemption list, every owned pref and kill switch, Restore order, and the explicit unsaved-page-state / short-reload warning. `additional/boost/settings.json` descriptions and `extension/settings/layout.json` carry the same semantics and warning to the Zentral main settings window; generated root and standalone `preferences.json` were rebuilt by the tools. `stronger_saver` is documented as the OUTSIDE-Game-Mode manual Level 2 switch. `docs/perf-results.md`, the plan tracker and the single next-session handoff are updated. No new pref, timer, listener or runtime polling was added.

### G10 — Boost feature widget available in the standalone Boost mod (DONE)

Owner point: "ensuring that boost feature widget is available in standalone boost mod".

- **Verified gap** (OW-123 finding 1, `docs/ow-123-standalone-ownership-audit.md`): the standalone Boost package
  (`additional/boost/standalone.json`, `theme.json`) ships `ZentralBoost.standalone.uc.js` + `loader/ZentralTabPolicy.js`
  and its own 11 preferences, but **no widget**. The Boost card, the on-demand RAM display, the Light / Deep / Game /
  Restore group and the limiter toasts are all registered by `registerWidget({ id: "boost", ... })` in
  `additional/widgets/ZentralWidgets.uc.js` (see `boostParts`, `boostMenuItems`, `boostResultText` and the
  `WIDGET_PREFS.BOOST_ENABLED` / `DEFAULTS.BOOST_ENABLED` constants there). Installing only `additional/boost/`,
  or removing/disabling Widgets in the full pack, leaves startup trim, settings, limiter, Game Mode's pref and the
  programmatic API, but no card. The Boost README currently calls the widget "a convenience" and says the module
  works without the tray — that must become true for a person, not only for an API caller.
- Contract: with **only** `additional/boost/` installed, one Boost widget must be visible with the same four actions
  (Light, Deep, Game Mode, Restore), the live RAM reading (on demand only), en/pl strings, the Game Mode state hint
  from `previewGameMode()` (G7) and a working Restore. With the full pack or with the standalone Widgets tray also
  installed, there must be **exactly one** Boost card: the tray owns it, and Boost must not create a second one.
- Design constraints: no new `setInterval`, no polling, no permanent document observer. Use the shim's
  `createSidebarHoverCard` / `nativeSidebarRect` / scope helpers and one-shot scope timers; every DOM node,
  listener, timer and `onChange` / `startSampling` subscription is owned and removed by `destroy()` and window
  unload. Sampling stays balanced with `stopSampling()` while the card is open. Keep the 26 px one-row popup rule
  from OW-121 (`additional/widgets/ZentralWidgets.css`), with a Boost-owned stylesheet declared via `css` in
  `additional/boost/standalone.json`. Do not hand-edit `*.standalone.uc.js` or `standalone.lock.json`; add sources
  through `sharedSources`/`extras` in `standalone.json` and rebuild with `--keep-version`.
- Prefs: if a card needs its own visibility switch, add
  `zen.workspace.zentral.boost.widget_enabled` (bool, default `true`, kill-switch) to `additional/boost/settings.json`
  (schema + `settings` meta), then run `node tools/organize-layout-order.cjs`, `node tools/build-preferences.cjs`
  and `node tools/build-standalone.cjs --keep-version`. Any pref the new source reads must be owned, borrowed via
  `borrowedSettings`, or declared in `externalPrefs` with a reason — `tools/build-standalone.cjs` enforces this.
  Do **not** borrow `zen.workspace.zentral.widgets.boost.enabled` as a second switch; keep one owner per pref.
- If Widgets is installed later than Boost, decide once from a deferred task (not inside a `TabSelect` dispatch):
  prefer `window.ZentralWidgets.registerWidget` when it exists, otherwise create the self-contained card, and
  publish a marker so a late tray can take over without a duplicate. Document the load-order choice in the README.
- Tests (`tests/boost-standalone-widget.test.cjs`): fake DOM + the generated standalone bundle with
  `window.ZentralRuntime` absent → one card with the four actions and a RAM value; full pack runtime present → zero
  cards; Widgets tray present → zero self-contained cards and one tray registration; click actions call
  `runLevel1`, `runLevel2`, `setGameMode`, `restoreSession`; `destroy()` removes the card, listeners, timers and
  sampling; en/pl strings; no `setInterval`; `standalone.json` declares the new source/CSS and generated
  `preferences.json`/lock are current. Also assert G11's coverage checker still passes for the new pref.
- Docs: `additional/boost/README.md` (standalone install includes the widget, what is missing without panels),
  `docs/perf-results.md`, the handoff, and the new owner gate 6 below. Update `docs/ow-123-standalone-ownership-audit.md`
  only as a dated follow-up note; do not rewrite the frozen audit.

- **DONE (G10):** the standalone package now embeds a Boost-owned card extra and stylesheet through `standalone.json` (`loader` + `extras` + `css`), with `zen.workspace.zentral.boost.widget_enabled` as its kill switch. With only Boost installed, the shim's `createSidebarHoverCard` / `nativeSidebarRect` draw one visible 26 px card. With the full pack present the bundle returns; with the standalone Widgets tray present either the tray's built-in Boost card stays or Boost's marker hands one `boost` definition to `registerWidget()` and destroys its own card. No `setInterval`, polling, permanent document observer or second card was added; the exact no-bump chain stays at 3.4.0 with 608 placed preferences. G7 can now add the same feedback to both card owners.

## 4. Do NOT

- Do not force-close tabs that refuse `beforeunload`; report them as kept.
- Do not touch the audible tab, the video source tab, calls/sharing/PiP tabs.
- Do not persist Game Mode across a restart (existing behavior stays: the pref is cleared on teardown).
- Do not unload or modify extensions, add-ons or other Sine mods.
- Do not add polling or `setInterval`; every delay is a one-shot scope timer with teardown.
- Do not silently change defaults of existing prefs (`unload_pinned`, `stronger_saver`, limiter prefs). The new behavior belongs to Game Mode only. `stronger_saver` stays as the switch for Level 2 + panels outside Game Mode; Game Mode itself no longer depends on it.
- Do not ship a second Boost card in the full pack (G10), or drop/ignore a preference from `preferences.json` just to make G11's checker pass. External/retired prefs stay explicit in `externalPrefs` with a reason.
<<<<<<< HEAD
- Do not bump the version (`--bump` / `sync-version` without `--check`) while the handoff says 3.4.0; do not re-add merge markers, hand-edit generated bundles/locks, or edit `zentral/upstream/**`.
=======
- Do not bump the version (`--bump` / `sync-version` without `--check`) while the handoff says 3.4.1; do not re-add merge markers, hand-edit generated bundles/locks, or edit `zentral/upstream/**`.
>>>>>>> 3e6d7d32ec15c70a605d41b01dd18c88b7eb08db

## 5. Owner gates (put these in the handoff, in this order)

1. **G1:** the WhatsApp/Messenger process disappears from D1 after sleeping a record, and wakes with a normal load on Restore. (`docs/PLAN_DIAGNOSTICS.md` is supplied with a normal-session baseline of `TOTAL_MB=5933`; the after-sleep D1 comparison remains an OWNER GATE.)
2. **Game Mode on, no media:** D1 total drops by roughly the sum of the unloaded tabs/panels (expected 3–5 GB on the owner's session); `gameModeState()` shows counts and kept reasons.
3. **Game Mode on with a video in the sidebar preview or an audible Twitch tab:** audio and preview keep playing; everything else is unloaded.
4. **Restore:** original tab selected and loaded first, WhatsApp and Messenger back within ~15 s, other tabs reload newest first, the parking tab is gone, nothing loads twice, no stuck blank tab.
5. **Cancel path:** switch Game Mode on and off within 5 s; the browser returns to normal with no leftover parking tab and no half-restored state.
6. **G10 standalone widget:** install ONLY `additional/boost/` in Zen/Sine; confirm one Boost card with a RAM number and Light / Deep / Game / Restore, then install `additional/widgets/` as well and confirm exactly one card, no duplicate, no leftover DOM after disabling/unloading Boost, no extra polling while the popup is closed.
7. **G11 settings:** open the Zentral main settings window and find every one of the 608 current root `preferences.json` settings (including all Boost rows, after G2/G5 every new `game_*` row, and G10’s `widget_enabled`); check that changing a Game Mode pref there writes the same value the widget reads. In a standalone install, check that every field on the Sine preferences page has a corresponding control/label.

## 6. Definition of done

`node tests/run-all.cjs` green, build commands from `PLAN_CODING_AGENT.md` rule 5 green (with the 0a `--keep-version` override), new tests fail on the old code and pass on the new, `docs/perf-results.md` has one line per task, kill-switch prefs documented (`game_park_selected`, `game_restore_on_exit`, and G10's `widget_enabled` if used), handoff lists the audited wake paths (G6) and the seven owner gates above. `node tools/check-settings-consistency.cjs` must print `catalog checks passed` after **every** task that adds a pref (G2, G5, G10), and `node tools/build-standalone.cjs --check` must report `Standalone packages are up to date`. G10 and G11 are part of done: no Game Mode work ships with invisible settings or a widget that only exists in the full pack.

## 7. Status tracker (edit in place, one row per task)

| Task | State | Evidence / next action |
| :--- | :---- | :--------------------- |
| `G0` | **DONE** (this session) | six conflict-marker files resolved, generated reports/locks rebuilt, 7 previously failing suites green, chain green at 3.4.0 |
| `G11` | **DONE** (this session) | Boost descriptor added to the settings catalog, `Game Mode` section declared, `tools/lib/settings-coverage.cjs` + `tools/check-settings-consistency.cjs` guard, `tests/settings-catalog-coverage.test.cjs` RED→GREEN, 601/601 root prefs reachable |
| `G1` | **DONE** (code + tests) | `sleepPanelRecord(record, ctx)` closes the app browser first, then the still-loaded tab; deep pass / limiter / Stronger saver use it; `tests/g1-panel-sleep.test.cjs` (10 passed) RED on the old tree; G8 now consumes the plan through that same door. **OWNER GATE:** `docs/PLAN_DIAGNOSTICS.md` supplied, normal-session D1 `TOTAL_MB=5933` recorded; after-sleep D1 comparison still pending |
| `G2` | **DONE** (code + tests) | `planGameMode(input)` + `previewGameMode()` dry run, `game_keep_hosts` / `game_park_selected` prefs in schema, layout order, root + standalone `preferences.json`; `tests/g2-game-mode-planner.test.cjs` (8 passed) RED on the old tree, G11 checker green at 603 prefs. G8 now consumes the plan; G3–G5 supplied the snapshot, parking and Restore engine |
| `G3` | **DONE** (code + tests) | `tab: null` replaced by real tab elements; shared `gameSession` snapshot with panels/activity/MB/processes, 500 cap, cleared on Restore/unload/destroy, closed tabs skipped; `tests/g3-session-snapshot.test.cjs` (7 passed) RED on the old tree |
| `G4` | **DONE** (code + tests) | one ephemeral parking tab (`zentral-boost-parking`, `skipSessionStore`, inherited `userContextId`), 0 ms deferred selection + awaited unload, refusal rollback, Restore/exit hand-back, nearest-normal-tab fallback, excluded from every unload list; `tests/g4-selected-tab-parking.test.cjs` (9 passed) RED on the old tree. No new pref; `game_park_selected` remains the kill switch |
| `G5` | **DONE** (code + tests) | `restoreSession()` engine (selection → live-first panels → newest tabs), 700 ms / 2-loading / 8 s bounded chain, `recent`/`panels`/`none`, skip-if-loaded, cancel on second Game Mode ON/destroy, four owned prefs + `_text` twins at 607 root settings; `tests/g5-restore-engine.test.cjs` (10 passed) RED on the old tree |
| `G6` | **DONE** (code + tests) | all audited automatic wake call sites use one live pause/Game Mode predicate; explicit/Restore wakes keep working and user-woken items leave the snapshot and pending queue. No new pref/polling; `tests/g6-automatic-wake-guards.test.cjs` (11 passed) strict RED on `d16728b`, GREEN here; audited call sites are listed in section 4 and the handoff |
<<<<<<< HEAD
| `G7` | **DONE** (code + tests) | G10 shipped first; both card owners now share the `previewGameMode()` hint, event-driven G8 final report, OFF Restore toast and snapshot Restore label in EN/PL; `tests/g7-game-mode-feedback.test.cjs` (10 passed) strict RED on detached `2fa3fd8`, exact no-bump chain at 608 prefs/3.4.0 and full suite `305/305 passed; 0 failed`; live toast/visual checks remain owner gates |
| `G8` | **DONE** (code + tests) | one plan-driven unload pass through `sleepPanelRecord`; second `lightClean()` after the 3 s settle; ONE 30 s one-shot late clean cancelled on OFF/Restore/destroy; final freed/process/unloaded/kept values in `gameModeState()`. Limiter idle, startup trim skipped and manual Level 2 gated while Game Mode is on; `stronger_saver` stays the OUTSIDE-Game-Mode Level 2 switch; `beforeunload` refusals are kept reasons, never force-closes. `tests/g8-game-mode-cleanup.test.cjs` (9 passed) strict RED on detached `56fbeaa`, GREEN here; no new pref |
| `G9` | **DONE** (docs + strings) | Boost README guide (what Game Mode does/does not do, NEVER exemptions, prefs/kill switches, Restore order, unsaved page state and short reload), accurate `settings.json` descriptions, a Boost settings-category warning, rebuilt generated root/standalone preferences, `docs/perf-results.md`, plan tracker and handoff. G8 behavior/defaults unchanged; no new pref, timer or polling |
| `G10` | **DONE** (code + tests) | `additional/boost/standalone/ZentralBoostWidget.js` + `ZentralBoostWidget.css`, `widget_enabled` kill switch, marker hand-off in `ZentralWidgets.uc.js`, one visible standalone card with RAM on demand / Light / Deep / Game / Restore / EN-PL / preview hint / `restoreSession()`, zero duplicate cards in the full pack or Widgets tray, teardown-owned DOM/listeners/timers/sampling, `tests/boost-standalone-widget.test.cjs` (10 passed) strict RED on detached `f6ec969`, exact no-bump chain at 608 prefs/3.4.0 and full suite `304/304 passed; 0 failed`; live install matrix is owner gate 6 |
=======
| `G7` | **DONE** (code + tests) | G10 shipped first; both card owners now share the `previewGameMode()` hint, event-driven G8 final report, OFF Restore toast and snapshot Restore label in EN/PL; `tests/g7-game-mode-feedback.test.cjs` (10 passed) strict RED on detached `2fa3fd8`, exact no-bump chain at 608 prefs/3.4.1 and full suite `306/306 passed; 0 failed`; live toast/visual checks remain owner gates |
| `G8` | **DONE** (code + tests) | one plan-driven unload pass through `sleepPanelRecord`; second `lightClean()` after the 3 s settle; ONE 30 s one-shot late clean cancelled on OFF/Restore/destroy; final freed/process/unloaded/kept values in `gameModeState()`. Limiter idle, startup trim skipped and manual Level 2 gated while Game Mode is on; `stronger_saver` stays the OUTSIDE-Game-Mode Level 2 switch; `beforeunload` refusals are kept reasons, never force-closes. `tests/g8-game-mode-cleanup.test.cjs` (9 passed) strict RED on detached `56fbeaa`, GREEN here; no new pref |
| `G9` | **DONE** (docs + strings) | Boost README guide (what Game Mode does/does not do, NEVER exemptions, prefs/kill switches, Restore order, unsaved page state and short reload), accurate `settings.json` descriptions, a Boost settings-category warning, rebuilt generated root/standalone preferences, `docs/perf-results.md`, plan tracker and handoff. G8 behavior/defaults unchanged; no new pref, timer or polling |
| `G10` | **DONE** (code + tests) | `additional/boost/standalone/ZentralBoostWidget.js` + `ZentralBoostWidget.css`, `widget_enabled` kill switch, marker hand-off in `ZentralWidgets.uc.js`, one visible standalone card with RAM on demand / Light / Deep / Game / Restore / EN-PL / preview hint / `restoreSession()`, zero duplicate cards in the full pack or Widgets tray, teardown-owned DOM/listeners/timers/sampling, `tests/boost-standalone-widget.test.cjs` (10 passed) strict RED on detached `f6ec969`, exact no-bump chain at 608 prefs/3.4.1 and full suite `304/304 passed; 0 failed`; live install matrix is owner gate 6 |
>>>>>>> 3e6d7d32ec15c70a605d41b01dd18c88b7eb08db
