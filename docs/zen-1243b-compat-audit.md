# Zen 1.24.3b compatibility audit (OW-125)

Owner supplied the `v1.24.3b` release-notes link. GitHub tag `1.24.3b` resolves
to commit `300f9292ddbaaebf24626b4a7451e5426a11d3d8`; the release was published
2026-11-18 and its body was read through `gh api`. This is a static audit: no
live Zen/Sine runtime is available here.

## Release contents relevant to Zentral

- Firefox `160.0.1`; security fixes `GHSA-384m-hxgx-xpph`,
  `GHSA-gv58-qvc9-mhv2`, `GHSA-gq43-4g7g-3fc9`, `GHSA-p9x3-fx2f-hf87`.
- Boost color tinting/controls, closed browser/popup windows never freed,
  gradient-space switching, split-view/glance tabs unloaded under low memory,
  **Spaces Sync built-in containers**, copy URL while loading, opening new
  windows with mods, PDF thin lines, AMD Mac blank graphics, Linux Wayland
  WebGL/canvas colors, slow links, ChatGPT tab crashes, WebTransport datagrams,
  trackpad/mouse swipes.
- Copy URL / Markdown now copies URLs of all selected tabs.
- Zoom button hidden in single-toolbar layout; a toast shows the level instead.

## Findings

1. **Spaces Sync was the only required mod change and is already fixed by
   `OW-122`.** The 1.24.3b tree contains `ZenWindowSync.sys.mjs`,
   `ZenSessionManager.sys.mjs`, `ZenSpacesSyncModel.sys.mjs`,
   `ZenSpacesSyncApplier.sys.mjs` and `ZenSpacesSync.sys.mjs`. The engine is
   named `Spaces`; local cleanup previously ignored that name and the old
   `ZenPinnedTabsStorage.sys.mjs` shield has no target in this tree. `OW-122`
   adds reversible shields on the live APIs, filters pseudo-tab records in both
   directions, and sweeps restored stray seeds. See
   `docs/ow-122-restart-pseudo-tabs.md`.
2. **“Opening new windows with mods” performance:** the mod uses
   `Services.wm.getEnumerator("navigator:browser")` / `getMostRecentWindow`
   only in Notes, video scheduling and the library organizer; there is no
   permanent per-window polling added by Zentral. No change required from the
   static code; live cold-start and second-window timing remain an OWNER GATE.
3. **Copy URL of all selected tabs:** Zentral does not override the native copy
   URL/Markdown commands. No change required.
4. **Zoom button hidden in single toolbar with toast:** Zentral's widget and
   panel CSS does not depend on a visible native zoom button. No change
   required; live single-toolbar layout is an OWNER GATE.
5. **Boost, PDFs, graphics, WebGL, link latency, ChatGPT, WebTransport and
   swipe fixes** are browser/platform-level; no Zentral selector or preference
   depends on them. No change required.
6. **Split-view / glance tabs under low memory:** Zentral's unload policy lives
   in `loader/ZentralTabPolicy.js` and `additional/tabs/unloading/`; the audit
   found no hard-coded assumption that Zen never unloads split/glance tabs.
   Live behavior with OW-91/Boost remains an OWNER GATE.
7. **Security fixes:** no bundled Gecko/Firefox code is patched by Zentral. No
   change required.
8. **Weather rain timing (`OW-128`):** the owner chose Option A. The widget
   now uses one Open-Meteo request with hourly and bounded 15-minute fields,
   pure rain-series reduction, hourly/daily fallback and localized EN/PL
   phrases. This is a general `OW-128` fix, not a 1.24.3b-specific mod change;
   live text, timing and narrow-card layout remain an OWNER GATE.

## Static checks

- `additional/notes/ZentralNotes.uc.js` and `additional/widgets/ZentralWidgets.uc.js`
  parse with `node --check`.
- No `about:preferences` URL or hard-coded Firefox preferences window opener in
  `additional`, `extension`, `loader` or `zentral` runtime source.
- Root `theme.json` remains `3.4.0`; generated standalone bundles are rebuilt
  with `--keep-version`.
- Exact `--keep-version` chain is `CHAIN_GREEN` (12 packages, `601 Sine
  preferences`) and the docs-inclusive full suite is `294/294 passed; 0 failed`;
  see `docs/bugfix-2026-11-18.md`. The new cross-feature regression sweep adds
  six static/fake-DOM checks and fixes four batched regressions without changing
  the Zen 1.24.3b compatibility conclusion.
- `OW-128`'s Option A source has no hard-coded `Rain tomorrow` English outlook;
  `weatherRainPlan`, `pojutrze` and the bounded rain series are covered
  statically. No live weather rendering is claimed here.

## Conclusion

No further 1.24.3b-specific mod change is required beyond `OW-122`. The audit
does not claim live visual, performance, memory, multi-tab copy, compact-tab or
startup behavior; those remain OWNER GATEs.
