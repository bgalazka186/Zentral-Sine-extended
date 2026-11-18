# Sidebar widgets

Start at `ZentralWidgets.uc.js`. Independent sidebar widget tray shell, free-area measurement, sidebar video-player avoidance, per-widget toggles, per-widget refresh scheduling (no permanent polling), pause-when-hidden, and last-value caching.

## Sharing this area for a review

Send this folder for a change confined to sidebar widgets. Each source header explains its callers, contracts, and cleanup.

| File                  | Responsibility                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `ZentralWidgets.css`  | New-tab-page-style widget tray and card styling in normal sidebar flex flow (zero overlay conflict). |
| `ZentralWidgets.uc.js`| Widget tray shell, free-area calculation, video-player avoidance, registry, scheduler, and cache.    |
| `settings.json`       | Settings schema and category/section metadata owned by `widgets`.                                    |

Full installation uses root `theme.json` and `preferences.json`, plus `loader/`; Sine loads `loader/Zentral.uc.js`. Per-feature `settings.json` is metadata, not an activation script.

## Design rules

- **Video-player avoidance:** `#zentral-sidebar-widgets` mounts cleanly above `#zen-media-controls-toolbar` / `#zen-sidebar-bottom-buttons` without disturbing `#zentral-video-preview` or its anchor adjacency. The tray reads `#zentral-video-preview`'s live measured height (never a fixed aspect ratio, and `0` while hidden or popped out to Big Preview) and subtracts it directly from available free height.
- **Room for tabs, folders, and Essentials:** Free height excludes top/bottom chrome, Essentials, the sidebar video player, and occupied tabs/folders height. The tray height is capped by `max_height_share` (%) minus `tabs_reserve_px` (px) and hides automatically whenever free height drops below `min_free_height` (px) or sidebar width drops below `min_sidebar_width` (px).
- **No permanent polling:** No `setInterval`. Each widget defines its own refresh interval and optional boundary alignment, caches its last good value, and pauses all timers whenever the window or sidebar is hidden.
- **Built-in Clock & Date widgets:**
  - **Clock** (`zen.workspace.zentral.widgets.clock.*`): new-tab-page digital clock (`auto` / `24h` / `12h`), optional seconds and time-zone label, boundary-aligned to the exact minute (or second when seconds are enabled) so it wakes up once per minute/second and zero times while hidden.
  - **Date** (`zen.workspace.zentral.widgets.date.*`): mini calendar badge + weekday/date (`long` / `short` / `iso`), optional year and ISO week number (`W#`), boundary-aligned to local midnight (wakes up once per day, and catches missed midnight transitions on resume).
  - **Boost** (`zen.workspace.zentral.widgets.boost.enabled`, default on, OW-90): the browser's RAM and the action that lowers it, in one card. It **replaced the Status card** (battery + memory); the battery half left with it, because a desktop has none and the owner read the old "no battery" line as a broken widget. The card owns no reading and no timer of its own: `additional/boost/` measures, samples every 2 s only while the popup is open, and the card hears every value through `onChange`. A click on the card runs `runLevel1()` and toasts what was freed (4 s, `role="status"`); the arrow opens a small menu that expands the card inline (no `z-index`, no overlay) with **Free memory (light)** working and **deep** / **Restore** drawn greyed until OW-91 ships them, so nobody thinks they arrived early. A missing Boost module leaves a dash and a card that does nothing, never an error; the tray's `pause_when_hidden` applies like every other card.

## Install as a standalone Sine feature

In Sine, add this folder as a mod using:

`https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/widgets`

Enable `sine.allow-unsafe-js` and restart Zen after the first install. Sine pulls later updates from this folder, loads the module stylesheet itself, and exposes this feature's settings in Sine preferences. When the full pack is also installed, Zentral Extended owns the feature and the standalone copy stays inactive; both use the same preference keys.

`ZentralWidgets.standalone.uc.js`, `theme.json`, `preferences.json` and `standalone.lock.json` are **generated** by `node tools/build-standalone.cjs` from `ZentralWidgets.uc.js`; edit the source and rebuild, never the generated files.
