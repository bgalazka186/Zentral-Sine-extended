# Weather rain-timing options (OW-128, owner chose Option A)

The owner wants the Today view to stop saying “tomorrow” when rain is due
today, and to support phrases such as `today`, `jutro` / `tomorrow`,
`pojutrze`, `in about 45 min / 30 min / 15 min`, a rain window like `9–15`,
`heavy rain`, and `all day`. The text must stay readable at every widget
width/height. Owner chose **Option A**. A pure, localized implementation now
ships in the widget source and tests; live text and layout remain an OWNER GATE.

## What Open-Meteo can provide

The generic Forecast API supports:

- **Hourly** `precipitation`, `rain`, `showers`, `weather_code` and
  `precipitation_probability` (preceding-hour values), plus `timeformat=unixtime`
  and `timezone=auto` for DST-safe local conversion [1](https://open-meteo.com/en/docs).
- **Daily** `precipitation_sum`, `rain_sum`, `precipitation_hours`,
  `precipitation_probability_max` and `weather_code` (the most severe code of
  the day) [1](https://open-meteo.com/en/docs).
- **15-minute** `precipitation`, `rain`, `showers`, `snowfall` and
  `weather_code`; native 15-minute models cover Central Europe / North America,
  elsewhere the API interpolates from hourly data. `forecast_minutely_15` /
  `past_minutely_15` limit the range [1](https://open-meteo.com/en/docs),
  [2](https://open-meteo.com/en/docs/dwd-api),
  [3](https://open-meteo.com/en/docs/gfs-api).
- WMO `weather_code` includes `51/53/55` drizzle, `61/63/65` slight/moderate/heavy
  rain, `66/67` freezing rain and `80/81/82` showers, so “heavy rain” can be
  derived from codes `65`, `67`, `82` or from an mm/h threshold instead of a
  guessed label [4](https://open-meteo.com/en/docs/bom-api).

The existing widget already asks Open-Meteo for a seven-day daily/current
forecast and converts Unix timestamps with the API's `utc_offset_seconds`
(`additional/widgets/ZentralWidgets.uc.js`). No new location data, account,
API key or endpoint is required for any option below; only the requested
variables and the local interpretation change.

## Option A — Hourly + optional 15-minute near-term (recommended)

Request `hourly=precipitation,rain,showers,weather_code,precipitation_probability`
and, when available, `minutely_15=precipitation,rain,weather_code` for the next
12–24 hours. Compute the **next wet interval** from the current local time:

- `in ~15/30/45 min`, `in ~N hours` for the first onset;
- `today`, `jutro` / `tomorrow`, `pojutrze` for later onsets;
- a compact window such as `9–15` or `all day` when precipitation covers a long
  contiguous run;
- `heavy rain` from WMO `65/67/82` or an explicit mm/h threshold;
- responsive short/long text: narrow cards show `Rain in 45 min · 9–15` and
  wider cards may add `heavy`, with no overflow and no clipped controls.

This best realizes the owner's examples, including same-day rain and minute-level
onset. Cost: one larger response and a local pure helper that scans up to ~48 h
of hourly values plus a short 15-minute prefix.

## Option B — Hourly only

Use the existing 7-day request plus `hourly=precipitation,weather_code` and a
pure next-rain helper. Produces `today` / `jutro` / `pojutrze`, `in N hours`,
`9–15`, `all day` and `heavy rain`, but not honest `15/30/45 min` precision.
Cheapest robust upgrade; no new 15-minute model dependency.

## Option C — Daily only

Use `daily.precipitation_sum`, `precipitation_hours`, `weather_code` and the
existing day labels. Produces `today`, `jutro` / `tomorrow`, `pojutrze`,
`all day` and `heavy rain` with minimal parsing, but cannot say `in 45 min` or
`9–15`. Only choose this if the owner wants the smallest possible change.

## Option D — 15-minute-first “umbrella now” view

Use `minutely_15` as the primary source for the next few hours and fall back to
hourly/daily beyond that. Best for `in 15/30/45 min` at the owner's Poland
location (Central Europe has native ICON-D2 / AROME data), but it is more
region-dependent and adds a second data shape to test.

## Implementation note (Option A, 2026-11-18)

Owner chose **Option A**. `weatherRequestUrl()` now asks for hourly
precipitation/rain/showers/WMO code/probability and a bounded 15-minute prefix
in the same one request, keeping the existing one-request refresh policy and
seven-day daily fallback. `readWeatherRainSeries()` reduces those arrays to
bounded wet/heavy samples; `weatherRainPlan()` prefers 15-minute onset, then
hourly, then the old daily week. `weatherOutlookParts()` exposes localized
short/long rain lines for EN/PL, including `pojutrze`, `~15/30/45 min`,
`9–15`, `heavy rain` / `ulewa` and `all day` / `cały dzień`. Responsive CSS
wraps or scrolls the outlook instead of clipping it.

`tests/ow-128-weather-rain-timing.test.cjs` is RED on the daily-only source and
GREEN here (8 passed). The exact `--keep-version` chain is `CHAIN_GREEN`
(12 packages, `601 Sine preferences`) and the docs-inclusive full suite is
`293/293 passed; 0 failed` (`323.3 s` combined / `120 s` wall). No live
Zen/Sine runtime, screenshot, click or visual result is claimed: live timing,
localization and narrow-card layout remain an OWNER GATE.

## Additional proposals (optional, not implemented)

- “Dry until 18:00” / “rain-free window” when there is a long gap before onset.
- “Heaviest burst 13:00–14:00” using hourly mm or WMO code severity.
- An umbrella badge or color accent only when rain starts within the owner's
  chosen lead time.
- A preference for the lead-time threshold (e.g. 2 h) and whether to show
  probability, without adding a new widget card or height.

## Recommendation

Option A, with graceful fallback to Option B when 15-minute data is missing or
outside a native model region. It fixes the “tomorrow when it rains today” bug
with real timestamps, supports all requested phrases, and keeps the existing
one-request refresh policy. The implementation must be pure/tested first, keep
the current weather card height readable at all widths, and remain an OWNER
GATE for live text and layout.
