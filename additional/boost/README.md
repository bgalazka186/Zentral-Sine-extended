# Memory Boost

Start at `ZentralBoost.uc.js`. Reads total browser RAM on demand and gives memory back without closing, unloading or
reloading anything. Part of the owner's RAM plan (`docs/PLAN_CODING_AGENT.md`, tasks B2–B7).

## What it does (B2, `OW-89`)

- **The reading** (`memoryMB()`): the sum of `memory` over the parent process and every child returned by
  `ChromeUtils.requestProcInfo()`, rounded to MB. Sampled **only on demand** — while the Boost popup is open (every
  2 s) or while the RAM limiter wants readings. No other sampling, and no `setInterval` anywhere in this file.
- **Free memory, light** (`runLevel1()`): `minimizeMemoryUsage()` on the memory reporter manager, then `forceGC()` and
  `forceCC()`, each in its own `try/catch` so a build that refuses one step still frees the rest. Returns
  `{ beforeMB, afterMB, freedMB, by }`, with the "after" reading taken ~3 s later because Gecko frees on its own
  schedule. Nothing is closed, unloaded or reloaded: this is the same work `about:memory`'s "Minimize memory usage"
  button does.
- **One trim after startup**: once per browser start, after session restore and the Startup module are done and the
  browser has been quiet for 90 s (no key/mouse/wheel/touch input) with nothing audible or playing. Every deferred step
  is a single one-shot timer that a new input cancels and re-arms; the final run waits for `requestIdleCallback` with a
  timeout. A hard ceiling runs it once anyway if the session never goes quiet (a first-run session with lots of input).

## The widget (OW-90)

The sidebar Widgets tray draws this module as the card **Boost**, which replaced the old Status card: the RAM number
and the button that lowers it, in one place. The card lives in `additional/widgets/` and knows only three things about
this module — `runLevel1()`, `onChange(cb)` and `lastMB()` — so this file stays usable with the tray switched off.
A click runs Level 1 and the card toasts what was freed; the arrow opens a menu whose **Free memory (light)** entry
works and whose **deep** / **Restore** entries are greyed until OW-91. The card's own switch is
`zen.workspace.zentral.widgets.boost.enabled` (default on).

## Preferences

| Pref | Default | Meaning |
| :--- | :------ | :------ |
| `zen.workspace.zentral.boost.enabled` | `true` | The widget and the API exist (OW-90). |
| `zen.workspace.zentral.boost.startup_trim` | `true` | The single post-startup trim runs. Off = only explicit "free memory" actions. |
| `zen.workspace.zentral.boost.keep_pinned` | `false` | A deep pass may include pinned and Essential tabs. |
| `zen.workspace.zentral.boost.shortcut` | `""` | Keyboard shortcut for the light pass, e.g. `Accel+Shift+B`; empty installs nothing. |

Both are read live, so switching them needs no restart. This module writes nothing to disk and keeps no history.

## Unload what is not in use (B4, `OW-91`)

- **One tab policy.** `loader/ZentralTabPolicy.js` answers "may this tab be unloaded?" for both this module and the
  middle-click unloader, so the "never" list cannot drift apart: the selected tab, a Zentral host tab, a Notes/Agenda
  placeholder, an audible tab, a sharing tab, a picture-in-picture tab, the video preview's source tab, an already
  sleeping tab, and — unless `zen.workspace.zentral.boost.keep_pinned` says otherwise — pinned and Essential tabs.
  Each refusal is a named reason, which is what `state()` and the tests read.
- **Deep pass** (`runLevel2()`): Level 1 plus every eligible tab **oldest `lastAccessed` first**, plus the Essential
  panel records whose own mode is `asleep-allowed`. Sleep is `gBrowser.explicitUnloadTabs([tab])` with the same
  `discardBrowser` fallback TabUnload uses; panels wake through `loadEssentialInBackground(record, true)`. Nothing is
  closed, and the selection never moves — a tab that would need a successor is simply not unloaded by a deep run.
- **Restore** (`restore()`): an in-memory `undoState` (cap 50) of what the last deep run put to sleep. Panels wake
  immediately; tabs are listed and reload when clicked. The record is deliberately lost on restart.
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

1. **Level 2** (`runLevel2({allowPanels:false})`) — the same deep pass, tabs only.
2. **Pause everything that repeats**, through `ZentralRuntime.performance` (`loader/ZentralPerformanceSwitch.js`): the
   video preview's discovery/caption/visibility intervals, the widget scheduler, the RSS scan, Notes' minute wake and
   the panel fallback poll each subscribe and skip their work while paused, then re-arm on resume. Notes catches up
   rather than losing a deadline: deadlines are absolute instants, so the wake that follows the game fires what came
   due in between.
3. **Stop painting what nobody is looking at** — `docShellIsActive = false` and `renderLayers = false` on every tab's
   browser and every loaded panel browser, except two: **an audible tab** (the podcast) and **the video preview's
   source tab**. That exception is the owner gate: play a video, turn Game Mode on, the video keeps playing.

**Stronger saver** (`zen.workspace.zentral.boost.stronger_saver`, off by default) also *sleeps* the panel records marked
`live` (WhatsApp, Messenger) instead of only idling them, by running the deep pass with every mode opened up. That
switch is the consent; a plain deep pass still sleeps only `asleep-allowed` records. What it puts to sleep fills
`undoState`, so **Restore** brings them back.

Turning it off puts back exactly what it changed, reactivates the **selected tab**, and lets everything else reload
lazily — resurrecting every browser on the way out of a game would cost the memory the mode just saved. Destroying the
window while it is on runs the same off-path, so nothing is left deactivated.

## Public API

`window.ZentralBoost` (also on the runtime as the feature `boost`):

```js
ZentralBoost.memoryMB();          // total MB, or null when this build cannot answer
ZentralBoost.runLevel1();         // Promise<{beforeMB, afterMB, freedMB, by}>
ZentralBoost.runLevel2();         // Promise<{...same, unloaded:{tabs,panels}, skipped, undoSize}>
ZentralBoost.restore();           // {panels, tabs} — panels wake now, tabs when clicked
ZentralBoost.undoSize();          // how many things the last deep run put to sleep
ZentralBoost.setBackgroundMode(appId, "live" | "throttled" | "asleep-allowed");
ZentralBoost.decideLimiter({ totalMB, settings, lastRunAt, now });  // pure: {action, cadenceMs, reason, targetMB}
ZentralBoost.onLimiterEvent(cb);   // notify | hard-done | nothing-eligible
ZentralBoost.limiterState();
ZentralBoost.setGameMode(true);   // B7 toggle: Level 2 + pause every timer + idle every background browser
ZentralBoost.gameModeState();     // {on, paused, stronger, saved, woke, acted, run}
ZentralBoost.decideGameMode({targets});  // pure: which may be deactivated, and why the others may not
ZentralBoost.onChange(cb);        // one callback for results and samples; returns an unsubscribe
ZentralBoost.startSampling();     // balanced with stopSampling(); two callers at most (popup, limiter)
ZentralBoost.lastMB();            // last sampled value
ZentralBoost.state();             // what the trim has decided, for a live check
ZentralBoost.destroy();
```

`by` says which path answered: `minimize` (the reporter manager ran), `gc-cc-only` (the manager was missing or threw,
so only GC/CC ran).

## Rules this module keeps

- Every timer, listener and deferred step is registered for cleanup and cancelled by `destroy()`; the window `unload`
  handler calls it too.
- A build without `ChromeUtils.requestProcInfo()` logs **one** warning and keeps the "free memory" half working; nothing
  errors in the window.
- Themes: the widget (OW-90) draws with the tray's own variables; this file has no CSS.
- If the widget tray is disabled or absent the module still works through the API, and later through the shortcut
  (OW-91). The widget is a convenience, never the only door.

## Full pack and standalone

In the full pack the runtime owns this file: it is registered as the feature `boost`, reads the two preferences above,
and is started after the runtime's native-ready barrier. The standalone build runs the same source on its own.

## Where this stops

Every part of the owner's RAM plan that lives in this module has shipped: B4 (`OW-91`), B5 (`OW-92`), B7 (`OW-94`), and
the panel half of B6 (`OW-93`). None of them introduced an interval; the only repeating thing is the limiter's
one-shot `setTimeout` chain, and Game Mode is the one switch that stops every other repeating timer in the window.

## Install as a standalone Sine feature

`https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/boost`

Enable `sine.allow-unsafe-js` and restart Zen after the first install. `ZentralBoost.standalone.uc.js`,
`theme.json`, `preferences.json` and `standalone.lock.json` are **generated** by `node tools/build-standalone.cjs`
from `ZentralBoost.uc.js`; edit the source and rebuild, never the generated files.
