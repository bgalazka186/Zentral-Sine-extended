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
- **Shared sidebar space:** the tray measures other visible, in-flow children of its mount host as occupied chrome. Its calculation does not require those siblings to register with or call the Widgets module; the tray accounts for their height and yields space without owning them.
- **No permanent polling:** No `setInterval`. Each widget defines its own refresh interval and optional boundary alignment, caches its last good value, and pauses all timers whenever the window or sidebar is hidden.
- **Built-in Clock & Date widgets:**
  - **Clock** (`zen.workspace.zentral.widgets.clock.*`): new-tab-page digital clock (`auto` / `24h` / `12h`), optional seconds and time-zone label, boundary-aligned to the exact minute (or second when seconds are enabled) so it wakes up once per minute/second and zero times while hidden.
  - **Date** (`zen.workspace.zentral.widgets.date.*`): mini calendar badge + weekday/date (`long` / `short` / `iso`), optional year and ISO week number (`W#`), boundary-aligned to local midnight (wakes up once per day, and catches missed midnight transitions on resume).

## Weather location data and network privacy (OW-107 audit)

Weather is off by default. It does not read browser/device geolocation, call `navigator.geolocation`, or derive a position from the network. A location comes from the place name or coordinates that the owner enters in Zentral Settings.

When Weather is enabled, there are two HTTPS destinations:

1. **Place-name lookup:** `https://geocoding-api.open-meteo.com/v1/search`. When a saved place has a name but no valid coordinate pair, Zentral sends that name (trimmed and capped at 80 characters) with `count=1`, `language=en` and `format=json`. This happens after a relevant place-setting change or when Weather starts enabled with an unresolved saved place. It does not run as a periodic poll.
2. **Forecast:** `https://api.open-meteo.com/v1/forecast`. The request sends the selected latitude and longitude, unit options, `timezone=auto`, the requested current/daily weather fields, a seven-day forecast window, and Option A hourly / bounded 15-minute rain-timing fields. It does **not** send the saved display name.

Both requests use `fetch()` with `credentials: "omit"`, `cache: "no-store"` and `referrerPolicy: "no-referrer"`: browser cookies/HTTP credentials are not attached, the browser is asked not to use its HTTP cache, and the page referrer is suppressed. The calls do not use an API key. Open-Meteo still necessarily receives the query parameters described above and ordinary connection metadata such as the caller's IP address, request time and browser/network headers; this code cannot establish the provider's server-side retention policy. A user who enters a precise home address as the place name will disclose that text to the geocoding endpoint, so a town/city name or deliberately approximate coordinates are preferable for privacy.

Configured names and coordinates are stored in the widget's browser preferences (`zen.workspace.zentral.widgets.weather.places`, with legacy single-place preferences retained for migration). A name saved while Weather is disabled is not geocoded until the widget is enabled. Disabling Weather invalidates pending lookup results; it cannot retract a request already sent.

## Install as a standalone Sine feature

In Sine, add this folder as a mod using:

`https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/widgets`

Enable `sine.allow-unsafe-js` and restart Zen after the first install. Sine pulls later updates from this folder, loads the module stylesheet itself, and exposes this feature's settings in Sine preferences. When the full pack is also installed, Zentral Extended owns the feature and the standalone copy stays inactive; both use the same preference keys.

`ZentralWidgets.standalone.uc.js`, `theme.json`, `preferences.json` and `standalone.lock.json` are **generated** by `node tools/build-standalone.cjs` from `ZentralWidgets.uc.js`; edit the source and rebuild, never the generated files.
