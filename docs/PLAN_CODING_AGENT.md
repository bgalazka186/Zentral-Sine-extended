# PLAN 1 — CODING AGENT: lower RAM in the Zentral mod

Put this file at `docs/PLAN_CODING_AGENT.md`. It is for a coding agent working in the Zentral repo (version 3.3.307 at the time of writing). Follow it literally. Everything here is based on measurements from the owner's machine; nothing is a guess about priorities.

## 0. What the measurements said (why these tasks, in this order)

- The whole main browser window, including Zen's UI and ALL Zentral JavaScript and DOM, is only about 49 MB. The mod's code size is NOT the problem. Do not refactor code for size.
- About 11 extra content processes of 43–51 MB each (≈ 0.5 GB) are caused by Zentral Notes' sidebar placeholder tabs (`about:blank#zn-note:<id>` and `about:blank#zn-agenda-<key>`). Each is created as a live tab, so each loads `about:blank` in its own content process. This is the biggest RAM item that lives in Zentral code.
- The heavy pages (Messenger ≈ 0.9 GB, arena.ai ≈ 0.9 GB, WhatsApp ≈ 0.75 GB, an idle YouTube tab ≈ 1.1 GB) are real websites. Zentral cannot make them smaller; it can only unload or throttle them on demand (Boost, tasks B1–B4).
- "Minimize memory" (the same thing as about:memory's button) freed 779 MB of 5858 MB with no functional loss.
- The owner's WhatsApp, Messenger and arena.ai are **essential/pinned Zen tabs shown as Zentral panels** (`ctx.essentialPanels` records with `record.tab`, `record.app`, `record.tile`), NOT Zentral sidebar apps (`zen.workspace.apps.sidebar.apps` is empty and the Apps utility section is hidden).
- The owner wants WhatsApp and Messenger to keep running by default (messages). They may be put to sleep only in an explicit "stronger saver" action, always with a one-click Restore.

## 1. Rules (hard)

1. One task at a time, in the order below. One commit per task: `perf(<id>): <what>`.
2. Locate code by symbol name with `grep`, never by line number alone. Line numbers in this file were read from 3.3.280 and are hints only.
3. Read `AGENTS.md` and `loader/README.md` (the "Feature lifecycle contract") before the first change. All timers, observers and listeners go through the scope helpers and are torn down on destroy. **No new `setInterval`. No new permanent polling.**
4. Never edit `zentral/upstream/**`. Never run a formatter on the repo. Never hand-edit `*.standalone.uc.js`, `standalone.lock.json`, or the root `preferences.json`.
5. After code changes run: `node tools/build-standalone.cjs --bump && node tools/sync-version.cjs && node tools/build-standalone.cjs && node tools/build-preferences.cjs && node tools/build-z-map.cjs && node tools/build-standalone.cjs --check && node tests/run-all.cjs`. Everything must pass.
6. Every task adds tests in `tests/<task-id>.test.cjs` in the style of existing tests (helpers in `tests/helpers/`). No passing test = not done.
7. Every new pref is named `zen.workspace.zentral.<area>.<name>`, added to the owning `settings.json`, then preferences are rebuilt. Each risky change gets a **kill-switch pref** (default ON for the new behavior, switching it off restores the old behavior exactly).
8. If you change Notes, update the single NEXT SESSION HANDOFF block at the end of `TODO_notes_roadmap.md`, and move finished items per the roadmap rules.
9. If a symbol or behavior named here does not exist or differs, STOP and write the finding in the handoff. Do not invent a different design.
10. Do not remove features, settings or UI to save memory.
11. When you finish a task, add one line to `docs/perf-results.md`: task id, what changed, expected effect, "not measured" (the owner measures later).

## 2. PHASE 1 — do now (safe or low risk, high value)

### B0 — Quick prerequisites (tiny)
- Check that the logger/debug defaults the owner already switched off locally (`zen.workspace.zentral.debug.core`) default to `false` in the repo `settings.json`. If the default is `true`, change it to `false`. Do NOT change `zen.workspace.zentral.modules.logger.enabled` (the owner decides that separately).
- Done when the default is false and a test pins it.

### B1 — Notes / Agenda placeholder tabs must not hold a content process (≈ 0.5 GB)

Goal: Notes and Agenda sidebar placeholder tabs never keep a content process alive, and every user-visible behavior stays identical (clicking one opens the note/agenda item, the previous tab stays selected, ordering, icons and labels unchanged).

Where (find by symbol in `additional/notes/ZentralNotes.uc.js`): `addManagedPseudoTab(url)`, `zenNewTab`, `agendaNewTab`, `activateZenTab`, `onZenSelect`, `routePseudoTab`, `currentPseudoTabUrl`, `ZEN_TAB_EVENTS` (contains `TabBrowserDiscarded`), `SSTabRestored` handling (`onPseudoTabRestored`), `zenBusy` / `zenEventsIgnored`.

Facts already in the code that you must respect:
- `addManagedPseudoTab` calls `gBrowser.addTab(url, { skipAnimation: true, skipSessionStore: true, triggeringPrincipal })`, marks the tab (`EPHEMERAL_TAB_ATTR`, `SKIP_SESSION_ATTR`), and callers then set `NOTES_ATTR`/`AGENDA_ATTR`, `tab._zentralNotesUrl` and pin it.
- Selecting a placeholder "hands the selection straight back" to the previous tab from a deferred task, NEVER inside Zen's own TabSelect dispatch (a comment in `onZenSelect` explains that re-selecting inside the dispatch corrupts the tab switcher). Keep that rule.
- The code already understands PENDING (unloaded) placeholders: it reads the URL from `_zentralNotesUrl` and from the session state when the tab is pending (see `currentPseudoTabUrl`, and the `pending` checks around the agenda code). Restored placeholders after a restart are already handled the same way.

Design (implement exactly this):
1. Add a helper `parkPseudoTab(tab)`: returns without doing anything if the kill-switch pref `zen.workspace.zentral.notes.park_pseudo_tabs` is `false`, if the tab is not connected, is selected, has `zenBusy` set, or already has the `pending` attribute. Otherwise call `window.gBrowser.discardBrowser(tab, true)` inside `try/catch`; on failure do nothing (the tab simply stays live, as today).
2. Call `parkPseudoTab` from a scope `setTimeout(…, 0)` (never synchronously inside `addTab`/`TabOpen`/session events) for: every tab created by `addManagedPseudoTab` after the caller has finished marking and pinning it; every restored placeholder detected in `onPseudoTabRestored`; and every placeholder that was selected and handed back (right after the deferred hand-back in `onZenSelect` and in `activateZenTab`, so a clicked placeholder does not stay loaded).
3. Do not touch the real note tabs or any non-placeholder tab. A tab is a placeholder only if `zenManagedTab(tab)` is true or it is an Agenda tab.
4. Wrap discards so that `TabBrowserDiscarded` events they cause do not trigger projection repair loops: use the existing `zenEventsIgnored()` quiet window (`zenQuietUntil`) around your call, exactly like other internal tab changes in this file.
5. Pref `zen.workspace.zentral.notes.park_pseudo_tabs` default `true`, shown in Notes settings (Advanced) with the text "Keep sidebar note/agenda placeholders unloaded (saves memory)".

Tests (fake `gBrowser`, same style as the existing Notes tests): (a) creating 20 placeholders results in 20 `discardBrowser` calls scheduled after the creator finished; (b) selected, busy, pending, disconnected tabs are skipped; (c) kill-switch false = zero calls; (d) a click on a placeholder still opens the note and hands selection back, then the placeholder is parked again; (e) all existing Notes tests (agenda, folders, multiwindow, session restore) pass unchanged.

OWNER GATE: after merging, the owner checks (1) opening a note and an agenda item from the sidebar still works, (2) labels and icons stay, (3) D1 shows the number of `web` processes dropped from about 11 to 1–2. Write these three checks in the handoff. If the owner reports any breakage, the fix is to set the kill-switch default to `false`, not to patch around it.

### B2 — Boost core: memory service, Level 1, post-startup trim (lossless)

Create a new small feature module `additional/boost/` (id `boost`). Copy the structure of `additional/tabs/unloading/` (files: `ZentralBoost.uc.js`, `settings.json`, `preferences.json`, `theme.json`, `standalone.json`, `README.md`; and its entry in `loader/ZentralCatalog.js`, next to `tab-unload`). Follow the lifecycle contract: everything torn down on destroy.

B2.1 Memory meter (`boost.memory`): total browser RAM in MB = sum of `memory` over the parent and all `children` returned by `ChromeUtils.requestProcInfo()`. Sample ONLY on demand (the button popup is open: every 2 s; the RAM limiter is on: see B5). No other sampling. If `requestProcInfo` throws or is missing, the feature disables itself with one console warning.

B2.2 Level 1 "Light": call `Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager).minimizeMemoryUsage(callback)` (wrap the function in an object with `run()` if the call rejects a bare function), then `Cu.forceGC()` and `Cu.forceCC()` each in `try/catch`. Do not close, unload or reload anything. Return `{beforeMB, afterMB, freedMB}` measured with B2.1 about 3 s after the callback.

B2.3 Post-startup trim: once per browser start, run Level 1 after session restore and the Startup module are done AND 90 seconds have passed with no user input AND no audible/playing media tab (one `setTimeout` chain, no polling; use `requestIdleCallback` with a timeout for the final run). Pref `zen.workspace.zentral.boost.startup_trim` default `true`. Reason: the browser process is about 1.4–1.56 GB right after start and about 0.85–1.1 GB later.

B2.4 Public API for later tasks: `window.ZentralBoost = { runLevel1(), memoryMB(), onChange(cb) }` exposed through the runtime like the other features (see how `ZentralTabUnload` / `ZentralWidgets` expose theirs).

Tests: Level 1 calls the reporter manager once and returns the measured numbers; trim runs once, never twice, never while media plays or user input is recent; kill-switch pref respected; destroy cancels pending timers.

### B3 — Boost button (UI)

Put the control where the owner can actually see it. The owner has the Apps utility section hidden, so do NOT use it. Use the existing sidebar **Widgets tray** (`additional/widgets/ZentralWidgets.uc.js`, `registerWidget(def)`; see the `clock` widget registration for the shape and the README for rules: no `setInterval`, pause when hidden). Register a widget `boost`:
- Compact tile: label "Boost", live RAM number (only updates while the popup is open, otherwise shows the last value), no animation.
- Left click: run Level 1 and show a toast "Freed X MB". Right click or click on the arrow: small menu with "Free memory (light)", and entries added later by B4/B5 (greyed out until they exist).
- Toast: build a tiny self-contained notification element inside Boost (no dependency on other modules), auto-hide after 4 s, accessible, theme-aware.
- Pref `zen.workspace.zentral.widgets.boost.enabled` default `true`; the widget respects the tray's existing `pause_when_hidden`.
- Tests: registerWidget called once; click triggers `runLevel1`; the popup open/close starts/stops the 2 s sampler.
- If the widget tray is disabled or absent the module still works (API + shortcut); document this in the README.

## 3. PHASE 2 — worth doing (medium effort, do after Phase 1 is merged and verified by the owner)

### B4 — Shared tab policy and Boost Level 2 (unload what is not in use, with Restore)

B4.1 Extract the predicates from `additional/tabs/unloading/ZentralTabUnload.uc.js` (find `isNormalTabAlreadyUnloaded`, `isSuccessorCandidate`, host-tab exclusion) into a shared service `ZentralTabPolicy.isUnloadable(tab, ctx)` used by BOTH TabUnload and Boost. TabUnload behavior must not change; its tests must pass unchanged.

B4.2 A tab is NEVER unloaded if: it is the selected tab; it is a Zentral hidden host tab or a panel tile that is not an essential-panel record; `tab.soundPlaying`; it is sharing camera/mic/screen (`tab._sharingState` non-empty); it is in picture-in-picture; it is the current source tab of the Zentral video preview (`additional/video`, find how the source is identified in `ZentralVideoDiscovery.js`); it is already `pending`; pinned/essential tabs only if the pref `zen.workspace.zentral.boost.keep_pinned` is true (default false: pinned tabs are unloadable, they restore on demand like today).

B4.3 Essential-panel tabs (`ctx.essentialPanels` records) get a per-record tier stored with the app settings (`saveEssentialSettings`): `backgroundMode` = `live` | `throttled` | `asleep-allowed`. Default for every existing record: `live`. Level 2 unloads only `asleep-allowed` records and normal tabs. Sleep = `gBrowser.explicitUnloadTabs([record.tab])` (fallback exactly as in TabUnload). Wake = `ctx.loadEssentialInBackground(record, true)`. Add a right-click menu item on the panel tile "Background mode: Live / Throttled / Allow sleep". Do not use `closeApp` for essential panels.

B4.4 Level 2 = Level 1 + unload all eligible tabs oldest-`lastAccessed` first + sleep `asleep-allowed` panel records. Return counts and MB freed.

B4.5 Restore (required): Boost keeps an in-memory `undoState` = records and tabs it unloaded (cap 50). A "Restore" action (menu entry, and in the toast after Level 2) wakes the panel records with `loadEssentialInBackground(record, true)` immediately and reloads the listed tabs on request (default only panels; tabs reload when clicked). The state is lost on browser restart, which is fine.

B4.6 Add "Free memory (deep)" and "Restore" to the Boost widget menu. Add a shortcut pref `zen.workspace.zentral.boost.shortcut` (default empty) using the pattern in `extension/panels/interaction/ZentralAppShortcuts.js`.

Tests: policy table tests for every NEVER rule; Level 2 never touches the selected/audible/PiP/video-source tab; `asleep-allowed` vs `live` vs `throttled`; Restore wakes exactly what was slept; TabUnload regression tests unchanged.

### B5 — RAM limiter (Opera-style, tab/panel granularity)

Prefs: `zen.workspace.zentral.boost.limit_enabled` (false), `limit_mb` (int, default 4096), `limit_mode` (`soft` = toast only, `hard` = auto Level 2), `limit_cooldown_s` (60), `limit_target_pct` (85).
Logic with one-shot timers, no interval: sample (B2.1) every 60 s, every 10 s when above 70 % of the limit. If total > limit: `soft` → toast with a "Free now" button; `hard` → run Level 2 steps in batches of 3 tabs, re-sample after each batch, stop at `limit_mb * target_pct / 100` or when nothing is eligible; then show one toast with the result. Never repeat inside the cooldown. If still above the limit with nothing eligible, one toast per 10 minutes. Real per-process hard caps are impossible from JS: say so in the README.
Tests: state machine (hysteresis, cooldown, no repeat, soft vs hard, nothing eligible).

### B6 — Background mode `throttled` for essential panels

Context: preloaded panel browsers are kept fully active (`docShellIsActive = true`) in `syncAppPanelBrowserActivity` (`extension/panels/browsers/ZentralBrowserIntegrations.uc.js`) and the corner-panel equivalent (`extension/panels/corner-tiles/ZentralCornerPanels.uc.js`) so that notification apps keep working. A non-notification page like arena.ai then burns ~35 % of a core while hidden because Firefox cannot throttle it.
- For records with `backgroundMode === "throttled"`: while the panel is hidden set `browser.docShellIsActive = false` and `renderLayers = false`; restore active state when shown. The browser stays loaded, so sockets and title/badge events keep working; only timers/animation are throttled by Gecko.
- `live` records keep exactly today's behavior (this is the default; do not change it).
- Tests: `live` unchanged; `throttled` sets inactive while hidden and active while shown; switching modes at runtime applies immediately.
- OWNER GATE: the owner sets arena.ai to `throttled` first. Messenger/WhatsApp stay `live` unless the owner tests and agrees.

### B7 — Game Mode (Level 3) and pause state

B7.1 `ZentralRuntime.performance = { paused:false, setPaused(bool), onChange(cb) }`. When paused, features with timers skip work and re-arm on resume: the video preview scan/caption timers, widgets refresh, RSS scan, Notes minute wake, panel fallback poll. Each feature subscribes through the scope helpers; no feature may keep a timer running while paused.
B7.2 Level 3 "Game Mode" is a TOGGLE: Level 2 + `setPaused(true)` + `docShellIsActive=false` and `renderLayers=false` on every kept browser except the exempt tabs (audible tabs and the Big Picture video source stay active: the owner wants to finish a podcast while gaming). A separate toggle "Stronger saver" also sleeps records marked `live` and `throttled` (WhatsApp, Messenger) and is OFF by default; when ON it fills `undoState` so Restore brings them back.
B7.3 Toggling Game Mode off: `setPaused(false)`, restore activity for the selected tab only; everything else reloads lazily.
Tests: pause propagates to each subscribed feature; exempt tabs stay active; toggle off restores; Restore after Stronger saver wakes records.
OWNER GATE: the owner plays a video in the sidebar preview, switches Game Mode on, and confirms the video still plays.

## 4. NOT in this plan (do not do these)

Measured as not worth it, or decided elsewhere. If you believe one is needed, write it in the handoff instead of starting it.
- Loader text cache eviction, lazy settings catalog, splitting `ZentralNotes.uc.js`, lazy Notes i18n/flavors, popup-window guard, observer merging, CSS refactors: the whole window including all Zentral code is only about 49 MB.
- Video preview rewrites (`requestVideoFrameCallback`, capture size, discovery back-off): the preview already uses a 160 px canvas at 10 fps and event-driven discovery; a diagnostics plan decides if anything is needed.
- Disabling or changing the logger module default, Zen/Firefox preferences, add-on or theme advice: owner decisions handled in the diagnostics plan.
- Any change to Sine, Zen internals or `zentral/upstream/**`.

## 5. Definition of done (every task)
- Code and tests merged, build commands from rule 5 green.
- Kill-switch prefs exist for B1, B6, B7 and documented in the module README.
- `docs/perf-results.md` has the new line; the handoff states the OWNER GATE checks for that task.
