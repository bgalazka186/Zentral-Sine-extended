# Zen 1.23.4b compatibility

## Baseline

Zen was updated **1.23.3b → 1.23.4b** (installed: `C:\Program Files\Zen Browser\application.ini`,
Version=1.23.4b, BuildID=20261020090730, SourceStamp=541ee55). This mod (Zentral Extended 3.0.2)
was last validated against 1.23.3b (`docs/REPAIR-HANDOFF-3.0.0.md:45`).

## Upstream change table (1.23.3b → 1.23.4b)

| Upstream change (1.23.4b) | Mod exposure | Verdict |
| --- | --- | --- |
| `ZenCompactMode.mjs` hover fix (PR #16001) | `additional/tabs/compact-hover/` guard + entry reveal | **re-scoped (this plan)** |
| `src/zen/media/ZenMediaController.mjs` → `.sys.mjs` (ES-module class, `#sharingCard` → `#sharingCardForBrowser(browser)`, `window.gZenMediaController` removed) | mod only uses the DOM id `zen-media-controls-toolbar` as 1 of 4 fallback anchors (`additional/video/controllers/ZentralVideoSidebar.js:182-189`); no import of the module | no change (verify the id still exists) |
| `src/zen/folders/ZenFolders.mjs`: event `ZenFolderAnimationFinished` → `TabGroupAnimationComplete` | mod's groups code listens to neither | no change |
| `src/zen/library/zen-library.css`, `zen-library-widget.css` (`currentColor` → `--border-color`, hover selector relaxed) | mod's Library resize feature positions `zen-library` but does not override badge/gradient colors | no change |
| `src/zen/boosts/*`: new `<zen-zap-bar>` element, sets `zen-zapping` on `.browserSidebarContainer` (+2px outline) | mod does not hook that attribute; outline is cosmetic | no change (visual check) |
| `src/zen/sessionstore/ZenSessionManager.sys.mjs` (`__isNewZenWindow`), `src/zen/space-routing/ZenSpaceRoutingManager.sys.mjs` (`routeStartupTab`, `getStartupUserContextId`) | mod uses neither | no change |
| `src/zen/common/styles/zen-browser-container.css` (`[zen-zapping]` outline only) | no geometry change | no change |
| `src/zen/glance/`, `src/zen/common/ZenPreloadedScripts.js`, `zen-icons/icons.css`, build/workflow files | no mod hooks | no change |

## Native compact-mode member contract the mod depends on

Every native member the mod touches still exists in 1.23.4b with an unchanged contract:
`gZenCompactModeManager._setElementExpandAttribute(element, value, attr = "zen-has-hover")`,
`_collapseTrackedElement()`, `_clearAllHoverStates()`, `clearFlashTimeout(id)`, `_removeHoverFrames`,
`_outsideTrackedElement`, `_stopTrackingMouseOutsideWindow()`, `canHideSidebar`, `sidebar`,
`sidebarIsOnRight`, `preference`, `_ignoreNextHover`, `_hasHoveredUrlbar`, `_isTabBeingDragged`.
No mod code needs a compatibility shim.

## The upstream fix (PR #16001 / gh-15995)

`zen-browser/desktop` commit `b20e548`, merged 2026-10-18, in `src/zen/compact-mode/ZenCompactMode.mjs`,
changes exactly three things in the native compact-mode hover flow:

1. `onEnter` now always calls `this.clearFlashTimeout("has-hover" + target.id)` **before** the
   "already expanded" early return (a pending keep-hover hide used to survive a re-enter and fire
   while the mouse was still over the sidebar).
2. the `pendingEnter` callback bails on `!isHovering` for any event type (was
   `event.type === "mouseenter" && !isHovering`).
3. the deferred `onLeave` collapse bails when `isHovering || target.matches(":hover")`
   (was `event.target.matches(":hover")`, checked after the `pendingEnter` branch).

This is the exact bug the experimental `compact_sidebar_hover` feature used to work around
(`additional/tabs/compact-hover/ZentralCompactHover.uc.js:333` documented the old native behaviour:
"Zen 1.23.3b skips onEnter cleanup when we already set zen-has-hover").

## Re-scope decision

**Re-scope the feature instead of retiring it.** The upstream bug is fixed, so the feature is no
longer a "stabilization workaround". It is now an **opt-in extra-tolerance layer** over native
behaviour: a small edge tolerance around the visible sidebar and a short grace before the sidebar
may close. It stays **off by default**, is **removed from the Recommended preset**, and its wording
must stop claiming a native bug. Window-entry reveal, panel entry reveal and startup recalculation
are **unchanged**.

Remaining value over native 1.23.4b: edge tolerance (0–64 px, default 12), exit grace
(0–2000 ms, default 250) and the 1500 ms window-exit grace. Native now handles "pointer still over
the sidebar" itself, and adds its own keep-hover duration and (Windows/macOS) outside-window tracking.

## Live validation matrix

Zen 1.23.4b with the mod installed. Fill in the results column.

| Check | Expected | Result |
| --- | --- | --- |
| Feature off (default) — compact mode, tab bar hidden; hover the sidebar and move the pointer fast across its edge into the page | sidebar closes promptly (native behaviour, no extra grace); must not hide while the pointer is over it (native 1.23.4b fix) | |
| Off ⇒ native untouched — Browser Console: `gZenCompactModeManager._setElementExpandAttribute` is the native function (no mod wrapper); `ZentralRuntime.snapshot().compactHover` is `null` when both master and entry switches are off | native descriptor identity; snapshot null | |
| Feature on — wiggle ~10 px outside the visible sidebar | sidebar stays open (beyond native) | |
| Feature on — leave the sidebar | sidebar closes after ~250 ms | |
| Feature on — leave the window through the sidebar edge | sidebar holds ≤ 1500 ms then closes; afterwards `gZenCompactModeManager._outsideTrackedElement` is `null` | |
| Regression sweep — right-side sidebar, compact-mode toggle, window resize, tab drag, window deactivate, second window, sleep/wake, one third-party theme | no stuck or half-open sidebar | |
| Independent features — window-entry reveal alone, panel entry reveal alone, startup recalculation alone, and all off | each still behaves as documented | |
| Preset — apply "Apply recommended settings" | stabilization switch off, window-entry reveal on, sliders keep 12 px / 250 ms | |