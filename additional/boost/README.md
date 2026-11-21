# Memory Boost

Start at `ZentralBoost.uc.js`. Reads total browser RAM on demand and gives memory back without closing, unloading or
reloading anything. Part of the owner's RAM plan (`docs/PLAN_CODING_AGENT.md`, tasks B2–B7).

## What it does (B2, `OW-89`)

- **The reading** (`memoryMB()`): the sum of `memory` over the parent process and every child returned by
  `ChromeUtils.requestProcInfo()`. Firefox reports those values in **bytes**; Boost divides the sum once by
  `1,000,000` and rounds it to decimal MB before the widget formats GB. Sampled **only on demand** — while the Boost
  popup is open (every 2 s) or while the RAM limiter wants readings. No other sampling, and no `setInterval`
  anywhere in this file.
- **Free memory, light** (`runLevel1()`): `minimizeMemoryUsage()` on the memory reporter manager, then `forceGC()` and
  `forceCC()`, each in its own `try/catch` so a build that refuses one step still frees the rest. Returns
  `{ beforeMB, afterMB, freedMB, by }`, with the "after" reading taken ~3 s later because Gecko frees on its own
  schedule. Nothing is closed, unloaded or reloaded: this is the same work `about:memory`'s "Minimize memory usage"
  button does.
- **One trim after startup**: once per browser start, after session restore and the Startup module are done and the
  browser has been quiet for 90 s (no key/mouse/wheel/touch input) with nothing audible or playing. Every deferred step
  is a single one-shot timer that a new input cancels and re-arms; the final run waits for `requestIdleCallback` with a
  timeout. A hard ceiling runs it once anyway if the session never goes quiet (a first-run session with lots of input).

## The widget (OW-90, OW-121, W2–W6)

There is **one Boost-owned widget implementation** in every installation. The full pack and standalone Boost package
load the same `ZentralBoostWidget.js` and `ZentralBoostWidget.css` from this folder. The card reads Boost's own
`memoryMB()` / `onChange()` result and exposes Light, Deep, Game Mode and Restore; it does not register with or probe
the generic Widgets tray. Widgets likewise has no Boost code or callback, so the two features can be installed,
disabled and reloaded independently.

When Zen exposes a safe sidebar mount point, `#zentral-boost-widget` is a real in-flow tile in the sidebar flex
column. If the generic `#zentral-sidebar-widgets` tray is present, the stable order is **tray → Boost tile → media /
bottom chrome**. The tile is seated with the shared safe selector in `loader/ZentralSidebarMount.js`, preserving the
video player's anchor adjacency; the Widgets free-area measurement counts its visible in-flow height like other
sidebar chrome. No overlay is used in this main mode. If no safe target exists, Boost retains the hover-card plus
small anchor fallback. Hidden and compact-hidden sidebar states are CSS-controlled; turning the sidebar back on
reveals the same tile without a polling loop.

The OW-121 level group is one horizontal row, capped at 26 px high: **Light**, **Deep**, **Game** and **Restore**.
It is not a drop-down list and adds no height to the widget. Each action keeps its deterministic one-line tooltip in
English and Polish:

- **Light** — GC/CC + memory minimize. No tabs touched.
- **Deep** — Light clean first, then eligible tabs sleep. Restore available.
- **Game Mode** — pauses repeating features and idles non-essential browsers.
- **Restore** — reloads what was unloaded: panels as panels, tabs as tabs.

OW-115's grouped skip reasons and pinned/unpinned loaded-tab counts are folded into the Deep tooltip. The existing
post-run toast adds a short ` · skipped N protected tab(s)` suffix when a run reports grouped skips; no result row
was added under the card. `zen.workspace.zentral.boost.widget_enabled` is the single full-pack and standalone widget
switch (default `true`) and is shown in Boost's Memory settings. When it is false, Boost leaves no tile or mount
observer. G7's preview, final report, OFF toast and live Restore counts come from the same card source in both
installations. The Boost-owned stylesheet is declared through `css` in `standalone.json` and the full-pack catalog.

## Preferences

| Pref | Default | Meaning |
| :--- | :------ | :------ |
| `zen.workspace.zentral.boost.enabled` | `true` | Master Boost feature/API switch. |
| `zen.workspace.zentral.boost.widget_enabled` | `true` | Show the one Boost-owned sidebar widget in the full pack or standalone install. |
| `zen.workspace.zentral.boost.startup_trim` | `true` | The single post-startup trim runs. Off = only explicit "free memory" actions. |
| `zen.workspace.zentral.boost.unload_pinned` | `false` | A deep pass may include pinned and Essential tabs. Renamed from `keep_pinned` in 3.4.0 (the old name said the opposite); an existing `true` is migrated once and read as a fallback for one release. |
| `zen.workspace.zentral.boost.shortcut` | `""` | Keyboard shortcut for the light pass, e.g. `Accel+Shift+B`; empty installs nothing. |
| `zen.workspace.zentral.boost.limit_enabled` | `false` | RAM limiter on/off. |
| `zen.workspace.zentral.boost.limit_mb` | `4096` | Total-RAM limit in MB. |
| `zen.workspace.zentral.boost.limit_mode` | `soft` | `soft` tells you; `hard` unloads in batches. |
| `zen.workspace.zentral.boost.limit_cooldown_s` | `60` | Minimum seconds between hard runs. |
| `zen.workspace.zentral.boost.limit_target_pct` | `85` | Stop a hard run at this share of the limit. |
| `zen.workspace.zentral.boost.game_mode` | `false` | Game Mode toggle; off again after a restart. |
| `zen.workspace.zentral.boost.stronger_saver` | `false` | Also sleep `live` Essential apps in manual Level 2 OUTSIDE Game Mode. |
| `zen.workspace.zentral.boost.game_keep_hosts` | `""` | Comma-separated host names Game Mode must keep loaded, e.g. `music.example.com`. |
| `zen.workspace.zentral.boost.game_park_selected` | `true` | Kill-switch: park the selected tab on a temporary `about:blank` tab so it can be unloaded too. |
| `zen.workspace.zentral.boost.game_restore_tabs` | `"all"` | Restore profile: `all`, `recent`, `panels` or `none` (selection hand-back only). |
| `zen.workspace.zentral.boost.game_restore_recent_n` | `8` | How many newest-`lastAccessed` tabs the `recent` profile restores. |
| `zen.workspace.zentral.boost.game_restore_stagger_ms` | `700` | One restore item per one-shot timer; at most two loading at once. |
| `zen.workspace.zentral.boost.game_restore_on_exit` | `"ask"` | Kill-switch: `ask` waits for the Restore action, `always` restores on Game Mode off, `never` leaves it manual. |

### One-time widget-toggle migration (W5)

The retired Widgets toggle `zen.workspace.zentral.widgets.boost.enabled` is read only to migrate an existing saved
choice. If it has a user value and `zen.workspace.zentral.boost.widget_enabled` does not, Boost copies that value
once. If the new pref already has a user value, it wins (including an explicit `false`). With neither user value,
the widget defaults to `true`. The old pref is never cleared, rewritten or shown as a Widgets setting.

All of them are read live, so switching them needs no restart, and (G11) **every one is rendered in the Zentral main
settings window** under Memory Boost · Memory / Limiter / Game Mode. `node tools/check-settings-consistency.cjs`
now fails when an owner descriptor, a generated `preferences.json` field or a standalone setting has no placed
schema row; new Game Mode prefs must be added to `settings.json`, `layout.order` and the generated preference files
together. This module writes nothing to disk and keeps no history.

## Unload what is not in use (B4, `OW-91`)

- **One tab policy.** `loader/ZentralTabPolicy.js` answers "may this tab be unloaded?" for both this module and the
  middle-click unloader, so the "never" list cannot drift apart: the selected tab, a Zentral host tab, a Notes/Agenda
  placeholder, an audible tab, a sharing tab, a picture-in-picture tab, the video preview's source tab, an already
  sleeping tab, and — unless `zen.workspace.zentral.boost.unload_pinned` says otherwise — pinned and Essential tabs.
  Each refusal is a named reason, which is what `state()` and the tests read.
- **Deep pass** (`runLevel2()`): OW-121 starts with the shared `lightClean()` — reporter-manager minimize + GC/CC, with no second 3 s settle — then every eligible tab **oldest `lastAccessed` first**, plus the Essential
  panel records whose own mode is `asleep-allowed`. G1 adds one sleep door, `sleepPanelRecord(record, ctx)`: it calls the public
  `window.Zentral.Apps.closeApp(appId)` FIRST (the "Unload App" menu's own method, which stops navigation, removes the panel's
  `<browser>`, deletes it from `state.appBrowsers` and sets the tile `data-loaded="false"`), THEN unloads the record's tab only
  if it is still loaded. A pending tab can still hold a fully loaded panel, so the two holders are independent; audible,
  selected and video-preview-source records are never closed. The result is `{ slept, how: "panel" | "tab" | "both" | "none", reason }`.
  Manual Level 2, limiter batches and Stronger saver all go through it; Game Mode's invasive pass (G3–G5) uses the same door. A tab that backs an Essential-panel record is owned by its record
  (`OW-111`): the generic tab sweep skips it, and the record's mode is the consent that lets a pinned/Essential tab
  sleep — `live` and `throttled` stay loaded even when the pinned-tab pref is on, while Stronger saver may sleep all
  three modes. Every other "never" rule still wins. Sleep is `gBrowser.explicitUnloadTabs([tab])` with the same
  `discardBrowser` fallback TabUnload uses; panels wake through `loadEssentialInBackground(record, false)` (explicit wake). The result now also carries `light: { by: "minimize" | "gc-cc-only" }`, so a deep pass says which light-clean path ran. Nothing is
  closed, and the deep pass itself never moves the selection — a tab that would need a successor is simply not unloaded.
- **Restore** (`restore()`): an in-memory `undoState` (cap 50) of what the last deep run put to sleep. Panels wake
  immediately; tabs are listed and reload when clicked. The record is deliberately lost on restart. G3 adds a second,
  larger `gameSession` snapshot (cap 500 per list) shared by Level 2 and Game Mode: it keeps the **real tab element**
  (an unloaded tab stays in the strip as a pending row), the URL/title/`lastAccessed`/`wasPinned`, the panel record
  reference and mode, the browser activity Game Mode changed, and the before/after RAM/process readings. Closed tabs
  are skipped silently (`sessionTabsForRestore()`); `restore()`, window unload and `destroy()` clear the snapshot.
  G5 made this the input of the staggered, one-click Restore engine.
- **Panel background modes** (`.setBackgroundMode(appId, mode)`, saved with the app settings): `live` (default for
  every existing record), `throttled` (OW-93: active only while visible — hidden, Gecko throttles its timers and it
  stops painting, but the browser stays loaded so its sockets and badge events keep working) and `asleep-allowed` (the
  only one a plain deep pass sleeps). The tile's own context menu carries them under **Background mode**, and a change
  applies on the spot.
- **Shortcut** (`zen.workspace.zentral.boost.shortcut`, empty by default): two keys minimum, parsed like the app
  shortcut module's own combinations, and it runs the light pass only — a keystroke never unloads a tab.

## The RAM limiter (B5, `OW-92`)

Off by default (`zen.workspace.zentral.boost.limit_enabled`). When on, Boost measures on a one-shot chain — every 60 s
below the limit, every 10 s once the total is above 70 % of it — and acts only when the total crosses `limit_mb`:

- **`soft`** (default): one notification with the reading and the target. Nothing is unloaded.
- **`hard`**: the same deep pass OW-91 runs, in batches of three tabs, re-sampled after every batch, stopping at
  `limit_mb × limit_target_pct / 100` or the moment nothing eligible is left. One report at the end.
- **Cooldown** (`limit_cooldown_s`, 60): a hard run never starts again inside the window, whatever the reading says.
- Still above the limit with nothing eligible: at most one line per ten minutes, never a loop of them.

**What this can never do:** a real per-process or per-site memory hard cap is impossible from userscript JS in the
browser window. The limiter works by putting tabs and panels to sleep, which is what actually gives memory back; it
cannot make one page use less. If a single tab is the whole problem, the honest answer is "close or reload that tab",
not a memory cap this module cannot enforce.

## Game Mode (B7, `OW-94`)

A toggle, not a one-shot action: `zen.workspace.zentral.boost.game_mode`, off by default and **off again after a
restart** — a browser that comes back paused looks broken to whoever forgot they left it on.

Turning it on does three things in order:

1. **One plan-driven unload pass (G8)** — `previewGameMode()` decides what may sleep, G4 parks the selected tab
   through its deferred door, and `runGameModePass()` unloads those tabs and EVERY planned panel record through G1's
   `sleepPanelRecord`: the panel's own app browser is closed and a still-loaded record tab is unloaded. Game Mode is
   the consent, so pinned/Essential tabs and `live`/`throttled` records may sleep; the shared policy's NEVER rules
   still win. The pass runs the shared `lightClean()` before unloading, again after the existing 3 s settle, and ONE
   more `lightClean()` about 30 s later for late Gecko content-process frees. Those two Game Mode cleanup timers are
   one-shot scope timers; Game Mode off, Restore, a second ON and `destroy()` cancel the generation.
2. **Pause everything that repeats**, through `ZentralRuntime.performance` (`loader/ZentralPerformanceSwitch.js`): the
   video preview's discovery/caption/visibility intervals, the widget scheduler, the RSS scan, Notes' minute wake and
   the panel fallback poll each subscribe and skip their work while paused, then re-arm on resume. Notes catches up
   rather than losing a deadline: deadlines are absolute instants, so the wake that follows the game fires what came
   due in between.
3. **Stop painting what nobody is looking at** — `docShellIsActive = false` and `renderLayers = false` on every tab's
   browser and every loaded panel browser, except two: **an audible tab** (the podcast) and **the video preview's
   source tab**. That exception is the owner gate: play a video, turn Game Mode on, the video keeps playing.

**Stronger saver** (`zen.workspace.zentral.boost.stronger_saver`, off by default) is now the OUTSIDE-Game-Mode Level 2
switch: when it is on, a manual deep pass sleeps records in every `backgroundMode`, including `live`; when it is off,
Level 2 still sleeps only `asleep-allowed` records. Game Mode itself no longer depends on this pref and no longer
starts a second generic saver pass. What Level 2 or Game Mode puts to sleep fills `undoState` and the G3 snapshot, so
**Restore** brings it back.

Turning it off puts back exactly what it changed, reactivates the **selected tab**, and lets everything else reload
lazily — resurrecting every browser on the way out of a game would cost the memory the mode just saved. Destroying the
window while it is on runs the same off-path, so nothing is left deactivated.

## Game Mode planner (G2)

`planGameMode(input)` is pure: it takes tabs, panel records, the selected tab, the video source, the host allow-list
and the policy functions, and returns `{ sleepPanels, sleepTabs, park, keep }`. Switching Game Mode on is the consent,
so `unload_pinned` and each record's `backgroundMode` are ignored — pinned/Essential tabs and EVERY panel record are
candidates. The policy's NEVER rules still win (audible, sharing/camera/mic, PiP, video preview source, host tab,
private window, already pending, and any `beforeunload` refusal, reported as `refused` and never forced). The selected
tab is planned for parking (G4) when `game_park_selected` is on and `gBrowser.addTab` exists; otherwise it is kept
with the reason `selected`. `previewGameMode()` is the dry run: it reads the live session **on demand** when a menu or
hint opens, returns the plan plus `counts`, and writes no pref, arms no timer, samples no RAM and unloads nothing.
`applyGameMode()` consumes this plan in G8's full unload pass; panels always go through `sleepPanelRecord`, and a
manual `runLevel2()` while Game Mode is on returns `gameModeState()` instead of starting a parallel sweep.

## Game Mode cleanup and report (G8)

While Game Mode is on, the RAM limiter does not run, the one-shot post-startup trim is skipped and manual Level 2 does
not start a second pass. `gameModeState()` reports `freedMB` / `finalFreedMB` from the FINAL reading, `beforeMB`,
`afterMB` / `finalMB`, `processesBefore` / `processesAfter`, `unloaded: { tabs, panels }`, bounded `kept` reasons and
a `cleanup` object with the first/second/late clean counts and timer state. The owner can read it with
`Services.wm.getMostRecentWindow("navigator:browser").ZentralBoost.gameModeState()`. The settle and late cleans are
one-shot scope timers, cancelled on Game Mode off, Restore and `destroy()`; no `setInterval` or polling was added.
A `false` `explicitUnloadTabs()` answer stays a kept `refused` reason: no tab is force-closed, and the panel browser's
public unload is still reported separately. `tests/g8-game-mode-cleanup.test.cjs` pins the second clean, the single
30 s late clean, cancellation, limiter idle, startup-trim skip, manual-Level-2 state, refusal handling and the final
freed value.

## G7 UI feedback

The card does not guess what Game Mode did. Hovering or focusing **Game** reads the G2 dry run on demand and says
how many tabs and apps will sleep before the switch is thrown. Boost emits one `onGameModeEvent()` report for ON, the
3 s settled reading, the 30 s late-Gecko final reading and OFF; the same Boost-owned card source subscribes once in
either the full pack or standalone package and releases that subscription with the card. The final toast is
`Game Mode: freed X MB · N tabs, M apps unloaded · kept: <name (reason)>, …`, with at most three named kept items
followed by `+K more`. OFF says `Game Mode off` with the snapshot counts and a **Restore** action. The Restore button
reads `Restore (M apps, N tabs)` while a G3/G5 snapshot exists, otherwise stays disabled with the existing
`Nothing to restore yet` text. English and Polish come from the same Boost-owned dictionary. A Widgets-only install
does not load the card or any Boost strings. There is no polling, no new preference and no second RAM measurement
path.

## Game Mode guide, exemptions and kill switches (G9)

**What it does.** Game Mode takes a dry-run plan of the live tabs and Essential-panel records, parks the selected tab
when allowed, closes each planned panel's own app browser through `Zentral.Apps.closeApp(appId)`, unloads the planned
strip tabs with `gBrowser.explicitUnloadTabs`, pauses repeating Zentral work and deactivates background browsers. It
asks Gecko to minimize memory once before the pass, again after the existing 3 s settle and once more about 30 s later
for late content-process frees. The final `gameModeState()` reading reports freed MB, process counts, unloaded counts
and bounded kept reasons. Switching off resumes the limiter, restores browser activity and hands the selection back;
Restore uses the G5 engine.

**What it does not do.** It never closes a tab that refuses `beforeunload`, never force-selects a page, never persists
the Game Mode pref across a restart, never unloads or modifies extensions/add-ons/other Sine mods, never changes the
existing `unload_pinned`, `stronger_saver` or limiter defaults, never removes features/UI/settings, and never polls or
adds `setInterval`. Game Mode does not depend on `stronger_saver`: that pref only opens every panel mode to a manual
Level 2 pass OUTSIDE Game Mode. While Game Mode is on, the limiter, startup trim and manual Level 2 do not start a
parallel pass.

**Exemptions.** The shared tab policy's NEVER rules still win: audible tabs, the video-preview source, screen/camera/
microphone sharing, picture-in-picture, private windows, Zentral add-on host tabs, Notes/Agenda placeholders, hidden
or closing tabs, and any `explicitUnloadTabs` refusal. `game_keep_hosts` adds exact host or subdomain matches. The
Boost parking tab is excluded from every unload list. When `game_park_selected` is off, the selected tab is kept with
reason `selected`; otherwise it is parked and unloaded through G4's deferred door.

**Preferences and kill switches.** `game_mode` (off) is the master switch and is cleared on teardown/restart;
`stronger_saver` (off) controls manual Level 2 outside Game Mode; `game_keep_hosts` (empty) is the host allow-list;
`game_park_selected` (on) is the selected-tab parking kill switch; `game_restore_tabs` (`all`), `game_restore_recent_n`
(8), `game_restore_stagger_ms` (700) and `game_restore_on_exit` (`ask`) own Restore. `game_restore_on_exit=never`
disables automatic Restore on exit; `game_restore_tabs=none` restores only the selection hand-back. `startup_trim`,
`limit_enabled` and `unload_pinned` keep their existing defaults. `boost.widget_enabled` is the shared card's
full-pack/standalone visibility switch and has a placed row in Boost's Memory category. Every generated root and
standalone `preferences.json` field has a placed settings row through the G11 catalog checker.

**Restore and what is lost.** Restore rebuilds exactly the holders that existed before the sleep, and nothing else
(R1/R2):

| Before the sleep | After Restore |
| :--- | :--- |
| page lived only in the record's TAB (a loaded pinned/Essential tab, no panel browser) | the tab is reloaded in the background; **no** panel is created |
| page lived only in the PANEL app browser (the tab was pending) | the panel is woken with `loadEssentialInBackground(record, false)`; the tab stays pending |
| both were loaded | both come back, panel first and then the tab |
| neither (nothing was freed) | nothing is restored |

`sleepPanelRecord()` reports `panelWas`/`tabWas` from the pre-sleep state and the one `recordPanelSleepHolders()`
recorder writes the matching snapshot entries: a panel entry with `holders`, and/or a tab entry with `recordAppId`.
The counts a person sees follow the same rule — a record freed only as a tab is a tab, not an app.

Restore first re-selects the original tab, wakes the panel entries that had a panel holder first with
`loadEssentialInBackground(record, false)`, then reloads the tab entries newest `lastAccessed` first, one item per
one-shot stagger tick with at most two loading at once. A record tab is never turned into a second holder: when that
app already has a live panel browser and the record had no panel holder, the tab task is skipped. Because a record
tab belongs to the tab list, the `panels` profile does **not** reload it — "panels" means apps that lived in panels.

A user click or tile action removes that item from the queue.
Unloaded tabs lose **unsaved page state** (form text, in-page drafts and transient client state); they need a short
reload when selected or restored. Session URLs, labels, order and pinned state are remembered in memory only, capped at
500 entries and cleared on Restore/destroy. Explicit Restore and direct user clicks keep working while Game Mode is on.
The Boost-owned card source ships in this folder and is used by both loaders; the generic Widgets tray never owns
or registers a Boost card.

## Selected-tab parking (G4)

`parkSelected(plan)` creates **one** temporary `about:blank` tab when `game_park_selected` is on, the planner has
approved the exact selected tab, and `addTab` / `removeTab` / `explicitUnloadTabs` all exist. The tab is marked
`zentral-boost-parking` and `skipSessionStore`, is never pinned, inherits the selected tab's `userContextId`, and is
excluded from the planner, `gameModeTargets()` and the deep pass's unload list. Its selection change and the unload
of the original happen in a **0 ms scope timer**, never inside Zen's `TabSelect` dispatch (the
`ZentralNotes.uc.js` `onZenSelect` hazard). Only after the parking tab is really selected is
`explicitUnloadTabs([original])` awaited; a `false`/thrown refusal is never force-closed. Any failure rolls back in
another deferred task: the original stays selected and the parking tab is closed. Restore and Game Mode off select
the original (or the nearest normal tab if it was closed) from the same deferred hand-back, then close the parking
tab. `originalSelected` stays in the `gameSession` snapshot until Restore clears it, so G5 can put it first in the
restore order even when the person switched Game Mode off before pressing Restore. The two timers are one-shot scope
timers and are cancelled on teardown; no `setInterval` or polling was added.

## Staggered Restore (G5)

`restoreSession(options)` is the one restore engine; the old `restore()` is now its panels-only **immediate**
profile (panels wake now, tabs are still reported for a click). The full profile reads the four G5 prefs live and
restores in order: (1) re-select `originalSelected` from a deferred 0 ms task (selecting a pending tab loads it),
(2) wake panel records with `loadEssentialInBackground(record, false)` — records that were `live` come first —
(3) reload the other tabs newest `lastAccessed` first. `recent` limits the tab list to
`game_restore_recent_n`; `panels` skips tabs; `none` is a kill switch that only hands the selection back. One item
starts per `game_restore_stagger_ms` (default 700) with at most **two** loading at once. Each item waits for
`load`/`DOMContentLoaded` or one 8 s scope timeout, whichever comes first; all listeners are removed on teardown.
Pending tabs are woken in the background with a small copy of `ZentralStartup.uc.js` `wake(tab)`'s native
`linkedBrowser.reload()` check — no selecting, no new tab, no second way to reload. A user click that loads a tab
or tile earlier makes the engine skip that item. A second Game Mode ON, a new Restore, or `destroy()` cancels the
chain and frees its owned timers/listeners. `game_restore_on_exit=always` starts the engine when Game Mode is
switched off; `ask` (default) waits for G7's Restore action and `never` leaves the snapshot for a manual Restore.

## Automatic wakes and explicit clicks (G6)

While the runtime performance switch is paused or `gameModeState().on` is true, every automatic wake path is inert:
Corner Tiles preloads, Apps Grid preload sequencing, hidden-panel activity sync, badge/title sync, Startup
`wake`/`pump`/`scan`, and ZentralPanels fallback maintenance. The guard is a synchronous predicate checked both
before a one-shot preload timer is armed and again in its callback, so a game that starts in between still keeps
the item asleep. Owned pause subscriptions in Apps Grid, Corner Tiles, ZentralPanels and Startup re-arm the same one-shot work when the pause ends; existing intervals are only disarmed, and G6 adds no `setInterval`, polling loop, pref or new default.

Explicit clicks, tile actions, `apps.refreshApp()` and Restore still load their panel. Boost owns one capture
`TabSelect` listener and `noteUserWake(kind, key)`; a person waking a tab or panel removes that item from the G3
snapshot and the pending G5 Restore queue. `isRestoreWake(kind, key)` prevents Restore's own panel wakes from
being mistaken for a click. The listener is removed by `destroy()`.

**Kill switches:** there is no new G6 pref. Turning Game Mode off or unpausing `ZentralRuntime.performance`
re-enables the normal automatic paths; disabling Boost stops its user-wake bookkeeping; `game_restore_on_exit=never`
remains the kill switch for automatic Restore on Game Mode exit. `game_park_selected` and `game_restore_tabs=none`
keep their existing G4/G5 meanings. The audited call-site list is in `docs/PLAN_CODING_AGENT_FOLLOWUP_GAME_MODE.md`
section 4 and `TODO_notes_roadmap.md`'s handoff.

## Public API

`window.ZentralBoost` (also on the runtime as the feature `boost`):

```js
ZentralBoost.memoryMB();          // total MB, or null when this build cannot answer
ZentralBoost.runLevel1();         // Promise<{beforeMB, afterMB, freedMB, by}>
ZentralBoost.runLevel2();         // Promise<{...same, unloaded:{tabs,panels}, skipped, skippedCounts, undoSize, light:{by}}>
ZentralBoost.restore();           // {panels, tabs} — panels wake now, tabs when clicked
ZentralBoost.undoSize();          // how many things the last deep run put to sleep
ZentralBoost.setBackgroundMode(appId, "live" | "throttled" | "asleep-allowed");
ZentralBoost.decideLimiter({ totalMB, settings, lastRunAt, now });  // pure: {action, cadenceMs, reason, targetMB}
ZentralBoost.onLimiterEvent(cb);   // notify | hard-done | nothing-eligible
ZentralBoost.limiterState();
ZentralBoost.setGameMode(true);   // B7 toggle: Level 2 + pause every timer + idle every background browser
ZentralBoost.gameModeState();     // {on, paused, stronger, saved, woke, acted, run, parking, restoreOnExit, restoreProfile, restorePending}
ZentralBoost.decideGameMode({targets});  // pure: which may be deactivated, and why the others may not
ZentralBoost.planGameMode(input);       // G2 pure: { sleepPanels, sleepTabs, park, keep }
ZentralBoost.previewGameMode();         // G2 dry run: the plan + counts, nothing changed
ZentralBoost.parkSelected();            // G4 one parking tab; selection/unload happen in a deferred task
ZentralBoost.unparkSelected();          // G4 deferred hand-back of the original selection
ZentralBoost.parkingState();            // G4 pending / parked / restoring diagnostic flags
ZentralBoost.restoreSession(options);   // G5 one-click staggered Restore
ZentralBoost.restoreState();            // G5 active / queue / loading / log diagnostics
ZentralBoost.cancelRestore(reason);     // G5 cancel the owned restore chain
ZentralBoost.noteUserWake(kind, key);   // G6 remove an explicitly woken panel/tab from the snapshot and restore queue
ZentralBoost.isRestoreWake(kind, key);  // G6 true only while Restore owns that panel wake
ZentralBoost.onChange(cb);        // one callback for results and samples; returns an unsubscribe
ZentralBoost.startSampling();     // balanced with stopSampling(); two callers at most (popup, limiter)
ZentralBoost.lastMB();            // last sampled value
ZentralBoost.state();             // what the trim has decided, plus lastSkipped/loadedTabs (OW-115)
ZentralBoost.destroy();
```

`by` says which path answered: `minimize` (the reporter manager ran), `gc-cc-only` (the manager was missing or threw,
so only GC/CC ran). `skipped` remains a bounded sample for diagnostics; OW-115 adds `skippedCounts` (every named
reason), `state().lastSkipped` (the last run's counts) and `state().loadedTabs` (`{pinned, unpinned}` — loaded rows
only), which the Deep card tooltip and the short post-run result line use to explain a pass that kept tabs.

## Rules this module keeps

- Every timer, listener and deferred step is registered for cleanup and cancelled by `destroy()`; the window `unload`
  handler calls it too.
- A build without `ChromeUtils.requestProcInfo()` logs **one** warning and keeps the "free memory" half working; nothing
  errors in the window.
- Themes: the full-pack and standalone loaders use the same Boost-owned `ZentralBoostWidget.css`, declared by
  `standalone.json` and the full-pack catalog. The normal card remains in sidebar flow; only the no-target fallback
  uses a small anchor for its hover card. No permanent document observer or polling is used.
- Disabling the generic Widgets tray does not disable or own the Boost card. `widget_enabled` controls Boost's own
  tile; the Boost API and shortcut remain available independently.

## Full pack and standalone

In the full pack the runtime owns the Boost feature and API. The catalog loads `additional/boost/ZentralBoostWidget.js`
for its card. Standalone Boost runs the same source through its embedded loader and the same `widget_enabled` pref.

Installing only `additional/boost/` gives one visible card with the on-demand RAM value, Light / Deep / Game / Restore,
English/Polish text, the `previewGameMode()` hint, the G8 final report and the Restore-labelled OFF toast. The
standalone package has no Essential-panel host, so Deep and Game Mode there unload ordinary tabs only; the panel-record
part of Game Mode needs the full pack. Installing the standalone Widgets package too does not change Boost ownership:
the generic tray and the Boost tile coexist in either load order without calling one another. A Widgets-only install
has no Boost element or strings. When the complete full pack is installed, its runtime remains the feature owner and
standalone copies stay inactive.

**Live checks remain open.** The automated coexistence suite is not a substitute for the five owner checks in
`TODO_handoff.md`; attach the requested Zen/Sine screenshots before marking visual placement, Settings migration,
button feedback or standalone behavior complete.

## Where this stops

Every part of the owner's RAM plan that lives in this module has shipped: B4 (`OW-91`), B5 (`OW-92`), B7 (`OW-94`), and
the panel half of B6 (`OW-93`). None of them introduced an interval; the only repeating thing is the limiter's
one-shot `setTimeout` chain, and Game Mode is the one switch that stops every other repeating timer in the window.

## Install as a standalone Sine feature

`https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/boost`

Enable `sine.allow-unsafe-js` and restart Zen after the first install. Installing this folder alone is sufficient
for the Boost card; the separate Widgets package is optional. If both are installed, they coexist without a runtime
registration or hand-off. Use `zen.workspace.zentral.boost.widget_enabled` in Boost's Memory settings to show or hide
the tile. An existing saved `zen.workspace.zentral.widgets.boost.enabled` value is migrated once as described above;
the old user pref is retained.

`ZentralBoost.standalone.uc.js`, `theme.json`, `preferences.json` and `standalone.lock.json` are **generated** by
`node tools/build-standalone.cjs` from `ZentralBoost.uc.js`, `ZentralBoostWidget.js`, `ZentralBoostWidget.css` and
`standalone.json`; edit the sources and rebuild, never the generated files. Keep version 3.4.2 with `--keep-version`
on this branch.
