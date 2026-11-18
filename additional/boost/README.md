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
  every existing record), `throttled` (a promise nothing in this build breaks) and `asleep-allowed` (the only one a
  deep pass sleeps). The tile's own context menu carries them under **Background mode**.
- **Shortcut** (`zen.workspace.zentral.boost.shortcut`, empty by default): two keys minimum, parsed like the app
  shortcut module's own combinations, and it runs the light pass only — a keystroke never unloads a tab.

## Public API

`window.ZentralBoost` (also on the runtime as the feature `boost`):

```js
ZentralBoost.memoryMB();          // total MB, or null when this build cannot answer
ZentralBoost.runLevel1();         // Promise<{beforeMB, afterMB, freedMB, by}>
ZentralBoost.runLevel2();         // Promise<{...same, unloaded:{tabs,panels}, skipped, undoSize}>
ZentralBoost.restore();           // {panels, tabs} — panels wake now, tabs when clicked
ZentralBoost.undoSize();          // how many things the last deep run put to sleep
ZentralBoost.setBackgroundMode(appId, "live" | "throttled" | "asleep-allowed");
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

## Not in this file (later tasks)

`OW-92` adds the RAM limiter, `OW-93` the per-panel background behaviours behind the modes this file already stores,
`OW-94` Game Mode. Each adds its own prefs and its own tests; none of them may introduce an interval.

## Install as a standalone Sine feature

`https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/boost`

Enable `sine.allow-unsafe-js` and restart Zen after the first install. `ZentralBoost.standalone.uc.js`,
`theme.json`, `preferences.json` and `standalone.lock.json` are **generated** by `node tools/build-standalone.cjs`
from `ZentralBoost.uc.js`; edit the source and rebuild, never the generated files.
