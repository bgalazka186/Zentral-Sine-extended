"use strict";

/* =============================================================================================================
 * BGALAZKA'S EXTENSION TO THE ZENTRAL MOD (v2)
 * -------------------------------------------------------------------------------------------------------------
 * ARCHITECTURAL NOTES & INSTRUCTIONS FOR FUTURE AI AGENTS:
 * 0. DEFAULT-OFF CONTRACT (CRITICAL): every behavior/visual feature added by THIS extension MUST default to OFF.
 *    A fresh install with no `zen.workspace.bgalazka.*` user prefs must behave like the base Zentral mod with
 *    no Bgalazka extension behavior enabled. Users opt in feature-by-feature (translucency, opposite docking,
 *    corner/essential docking, toolbar, mini-pill, isolation, resize helpers, hide-* controls, etc.). For every
 *    NEW boolean feature: use `false` in getPref fallbacks, ATTR_MAP/default maps, createToggleRow defaults,
 *    startup attribute sync, and observer sync. Parent-disabled subfeatures should ALSO show unchecked by default.
 *    Non-boolean tuning values may keep neutral defaults, but must have no effect until their owning feature is on.
 *    EXCEPTION — PANEL BASELINE INSET: the floating panel intentionally keeps a tiny default top/bottom inset
 *    even when every optional extension toggle is OFF. This is not an opt-in feature; it is the neutral panel
 *    presentation requested for fresh installs so the panel retains the normal floating-card look instead of
 *    appearing flush to the viewport edges. Keep this inset small and symmetric; do not turn it into a feature.
 * 1. ONLY modify or append code BELOW this marker when working on Bgalazka's Extension.
 * 2. ALWAYS deliver fully compiled, complete ready-to-paste chunks for both the JS and CSS extension sections.
 * 3. EXPLAIN THE "WHY" IN CODE COMMENTS: Document Gecko/Zen workarounds so future models do not undo working solutions.
 * 4. TAB CRASH GUARD: NEVER attach a MutationObserver with { childList: true, subtree: true } to the tabstrip,
 *    the settings modal's ancestor tree, or documentElement. Modifying/observing tab children during
 *    gBrowser.pinTab() triggers a fatal C++ assertion crash in Gecko's frame constructor. This includes
 *    observers that merely WATCH an ancestor of the tabstrip with subtree:true, even if they don't mutate
 *    anything themselves — the previous version of this file did exactly that to detect the settings modal
 *    opening (observing documentElement), which is the same forbidden pattern and the most likely cause of
 *    "crashes when pinning". Detect UI state changes via method hooks instead (see section 5).
 * 5. SCOPE BUG (CRITICAL): `ZentralApps`, `ZentralTabGroups`, and `ZentralSettings` are `class` declarations
 *    scoped INSIDE the base mod's own top-level IIFE. They are NOT global identifiers. Referencing the bare
 *    class name from this separately-appended IIFE (`typeof ZentralApps !== "undefined"`) always evaluates to
 *    false, silently skipping any code guarded by it — this is what happened in the previous version and is
 *    why the opposite-docking/pin-state hooks never actually ran. Always reach the class via the singleton
 *    instance instead: `window.Zentral.Apps`, `window.Zentral.TabGroups`, `window.Zentral.Settings`.
 *    `Constants` is private to the base IIFE too. Never use bare `Constants` in this extension;
 *    use local pref keys or `window.Zentral.Core.defaultPrefs` for the base key inventory.
 * 6. TAB CLICK PASS-THROUGH: Any click on a tile inside a tab bubbles to the tab unless mousedown, mouseup,
 *    click, and auxclick are stopped in the CAPTURE phase (e.stopPropagation()). This prevents essential tabs
 *    from switching on LMB.
 * 7. OPPOSITE-SIDE DOCKING MATH: Native Zentral's positionPanel() calculates targetRight as
 *    (window.innerWidth - sidebarRect.left). If the sidebar is on the left, targetRight evaluates to ~1920px,
 *    pushing the panel completely off the screen! We hook positionPanel() and isPanelAttachedToRight() on the
 *    Apps INSTANCE (see note 5) to force root.style.right/left = "12px" directly.
 * 8. RESIZE INVERSION: Zentral's onDrag() internally checks this.isPanelAttachedToRight() ? (startW - diff) : (startW + diff).
 *    Hooking isPanelAttachedToRight() to return the opposite attachment side in Opposite-Side mode makes both
 *    native resize and extension-owned horizontal handles share one corrected direction source. Do NOT invert
 *    onDrag() again or the native grabber gets double-flipped.
 * 9. PANEL OPACITY: Web pages inside <browser> render opaque backgrounds. Applying only background-color to
 *    the slider is invisible behind the page canvas. Real transparency requires setting CSS `opacity` on
 *    #zen-app-panel-slider itself.
 * 10. NATIVE FEATURE PARITY (v1.0.2): the base mod now natively sets data-loaded="true"/"false" on tiles
 *     (in renderGrid/getOrCreateAppBrowser/closeApp, searched via a document-wide querySelectorAll so it stays
 *     correct even after we move a tile into an essential tab's corner) and natively handles middle-click
 *     unload on the tile itself (mousedown+auxclick, stopPropagation). We must NOT reimplement either of
 *     these anymore — our old duplicate implementations were overwriting the native, more-accurate state and
 *     silently blocking the native middle-click handler from ever running (capture-phase
 *     stopImmediatePropagation upstream prevents the tile's own listeners from firing at all).
 * 11. ESSENTIAL DUPLICATES: each genuine pinned/essential tab owns a separate app identity for this window.
 *     Its launcher opens the existing Zentral panel engine, sharing the toolbar, pill, resize, pin, keyboard
 *     and popup-containment behavior. Normal app tiles stay in their own list. Reordering never reassigns
 *     records; closing/unpinning preserves a loaded duplicate as a normal app. Multiple simultaneous panels are deferred.
 * 13. PILL CONTRAST: see chrome.css note 13 for the CSS half. The expanded/hovered pill uses a plain black
 *     background plus forced white icons for predictable contrast. Its background opacity is deliberately
 *     independent from the shrunk mini-pill opacity: PILL_PEEK_DOT_OPACITY controls only the idle mini pill,
 *     while PILL_BACKGROUND_OPACITY controls only the expanded pill's black background. Keep these separate so
 *     making the idle marker subtle does not also make the opened control surface hard to read.
 * 14. WEB TOOLBAR SEARCH + NATIVE HISTORY: the URL bar now runs typed non-URL text through a configurable
 *     search engine (see SEARCH_ENGINE_TEMPLATES/buildSearchUrl()/looksLikeUrl()) rather than relying on
 *     <browser>.fixupAndLoadURIString()'s own keyword-search fallback, since that goes through Gecko's OWN
 *     default engine with no override hook exposed to chrome <browser> loads — we build the destination URL
 *     ourselves and load it as a plain https:// URL instead. Back/Forward now use Gecko session history only,
 *     with user-interaction filtering. No synthetic URL trail or home fallback is used: either can turn a
 *     redirect, replacement navigation or POST entry into an incorrect extra visit. Top-level progress
 *     notifications and toolbar polling refresh the URL and native navigation capability flags.
 *     The quick-switch button (re-runs the same query on the other of DDG/Startpage) only appears when the
 *     active page matches one of SEARCH_ENGINE_PATTERNS, so it never shows on an unrelated page.
 * 15. TOOLBAR BUTTON ORDER / TOP DOCKING (v4): button order is just DOM append order in ensureWebToolbar()'s
 *     `toolbar.append(...)` call -- there's no CSS `order` per-button, so reordering buttons only ever needs
 *     that one line changed. Top-vs-bottom docking is the opposite: it's CSS-only (see chrome.css note 15),
 *     driven by the `bgalazka-webtoolbar-top` root attribute; nothing here needs to know which edge the
 *     toolbar is actually on.
 * 16. ALL-SIDES RESIZE (v5/v8): native Zentral owns `top`/`bottom` and refreshes them from positionPanel().
 *     Our persisted resize and position offsets are represented by margin-top/margin-bottom instead. For an
 *     absolutely/fixed positioned box constrained by top+bottom, those margins move its rendered edges and
 *     alter its height exactly like adjusted top/bottom, but native never resets them. They are written only
 *     when a pref changes, the root appears, or the user actually drags -- never from positionPanel()'s RAF
 *     loop. During a drag startVerticalResize() snapshots native top/bottom and updates only the two margins.
 *     This needs
 *     ZERO opposite-docking-specific or data-panel-side-specific math anywhere (contrast note 7/8): top and
 *     bottom are the same edges regardless of which side the panel is docked to, and dual-view/push only ever
 *     touches width, never height, so no interaction with note 12's push-state sync was needed either.
 *     IMPORTANT: applyVerticalResizeExtras() must NEVER check EXT_PREFS.ALL_SIDES_RESIZE. That pref only
 *     gates whether the drag SURFACES are interactive (CSS pointer-events, see chrome.css) and whether
 *     startVerticalResize() will start a NEW drag -- it must have no say over whether an already-saved size
 *     keeps being applied, or unchecking the toggle would silently reset the user's chosen height back to
 *     natural, which is the opposite of what a "turn the drag surfaces off" toggle should do.
 * 17. ALL-SIDES WIDTH + CORNERS (v8): the toggle now gates native's outer width edge, the extension's inverse-
 *     delta inner edge, and four additive corner handles. The extension never rewrites a private width field:
 *     all new horizontal paths call public updateWidthVar() and saveWidth(), with the same safe maximum used by
 *     opposite docking. Corner drags simply run the existing vertical and extension horizontal handlers in
 *     parallel because those handlers own disjoint axes.
 * 18. PANEL POSITION DRAG / URL BAR GRIP (v8): vertical whole-panel motion remains a separate feature using
 *     PANEL_POSITION_OFFSET_PREF. Along with resize extras it is now expressed through persistent margins,
 *     not positionPanel()-time top/bottom writes. PANEL_HORIZONTAL_OFFSET_PREF uses the same margin principle
 *     for bounded physical left/right motion and is applied only on panel open, explicit setting changes, or a
 *     real docking-side change -- never from the positioning RAF loop.
 * 19. LIVE DRAG STATE (v6/v8): applyVerticalResizeExtras() prefers the in-progress drag values over the saved
 *     prefs, so the margins track the pointer immediately and are persisted only on mouseup. Native may keep
 *     refreshing top/bottom concurrently, but the two code paths no longer write the same properties and
 *     therefore cannot undo or retrigger each other.
 * 21. Services.prefs IN THE PER-FRAME HOT PATH: the base mod's own startPositionTracking()/reposition()/rafLoop
 *     (a few hundred lines above initBgalazkaExtension in this same file) calls positionPanel() -- OUR patched
 *     positionPanel() -- on every throttled mousemove AND on every transitionstart/transitionrun/transitionend
 *     ANYWHERE in the entire window, for as long as the panel is open, re-arming a requestAnimationFrame loop
 *     for another 200ms each time. On a profile with a lot of ambient chrome UI churn (more tabs/pins/
 *     workspaces = more small hover/indicator transitions happening at any moment), that loop can be re-armed
 *     continuously and never go idle while the panel stays open, so positionPanel() -- and everything it calls
 *     -- can run on EVERY animation frame indefinitely, not just briefly. getVerticalExtras()/getPositionOffset()
 *     (note 16) and the two isPanelAttachedToRight()/positionPanel() OPPOSITE_DOCKING checks were each calling
 *     Services.prefs synchronously from inside that loop -- real per-frame XPCOM overhead, and completely
 *     unconditional (present no matter which extension toggle is on/off, which is why bisection-by-toggle
 *     testing never found it). Fix: both hot spots now read a plain in-memory cache kept in sync by a
 *     Services.prefs.addObserver (fires only on an actual pref write, never per frame) instead of hitting
 *     Services.prefs synchronously every frame. See the comment above getVerticalExtras() and above
 *     isOppositeDockingCached() for specifics. CONFIRMED BY PROFILING (note 22): a capture with this fix
 *     already installed showed "zen.workspace.bgalazka.opposite_docking" down to a single read for the entire
 *     capture, and the two panel_*_extra_px/position_offset_px prefs didn't register at all -- so this part of
 *     the fix worked exactly as intended. It just wasn't the dominant cost; see note 22.
 * 22. THE DOMINANT COST, FOUND VIA PROFILING: with note 21 already installed, a Firefox Profiler capture
 *     (closed -> open+janky -> closed, same profile) showed 2452 total "Preference Read" events in the ~10s
 *     capture, and 1911 of them (78%) were "zen.workspace.apps.sidebar.placement" -- read by the NATIVE
 *     isPlacementVerticalBar() (see its own definition earlier in this file), which hits Services.prefs fresh
 *     on every single call with no caching of its own, and gets called directly by the base mod's own
 *     reposition()/triggerBurst() (note 21) one or more times per animation frame for as long as the panel
 *     stays open. Everything note 21 fixed shows up as single-digit read counts in the same capture by
 *     comparison -- real, but minor next to this. This is the actual explanation for the whole thread of
 *     reports: a native method with an uncached per-call pref read, invoked by native code at up to 60fps+
 *     for as long as our panel is open, is unconditional (no extension toggle touches it, matching "no matter
 *     the settings"), scales with how much ambient CSS transition activity keeps the native loop alive (more
 *     tabs/pins/workspaces = busier profile = the loop rarely goes idle), and is native code this file must
 *     not edit directly per the "only touch EXTENSION parts" rule. Fix: rather than editing the native method
 *     (isPlacementVerticalBar() at line ~963, untouched), we monkey-patch it the same way positionPanel() and
 *     isPanelAttachedToRight() already are -- appsInstance.isPlacementVerticalBar = () => cachedIsVerticalBar,
 *     with the cache kept live by a Services.prefs.addObserver. Because native methods call it as
 *     `this.isPlacementVerticalBar()`, overriding the property on the shared instance makes EVERY caller --
 *     reposition()/triggerBurst() included -- use the cache, not just our own two call sites. This is override-
 *     by-replacement of a live property on an object instance, not an edit to any line of the original
 *     implementation, which is still sitting untouched earlier in this file.
 *     UPDATE: user confirmed this alone did NOT fix the reported jank. A follow-up analysis of the SAME
 *     profile (self-time by category, not just marker counts -- see note 23) showed the main thread was ~99.8%
 *     Idle the whole time; the ~1911 pref reads this note fixes were real but too cheap individually to be the
 *     visible bottleneck. Left in place -- it's still a correct, worthwhile reduction in per-frame native
 *     overhead -- but note 23 is what actually explained the visible FPS drop, and note 24 is what a direct
 *     user repro then pinned down as the dominant trigger.
 * 23. UNCONDITIONAL data-panel-side WRITE, FOUND BY RE-ANALYZING THE SAME PROFILE: with note 22 confirmed
 *     insufficient, self-time-by-category analysis of the main thread showed it was ~99.8% Idle overall, but
 *     eventDelay spiked to 400ms+ in a sawtooth pattern during exactly the reported-janky window, and marker
 *     analysis of that window found 52 overlapping "CSS transition" markers totalling 8123ms of duration in a
 *     ~4.4s span -- many with `oncompositor: false` (properties that force a real main-thread layout+paint
 *     pass, not a cheap GPU-only composite), on both native chrome elements (navigator-toolbox, titlebar,
 *     urlbar, tabs -- retriggered continuously by ordinary hover during the test) and our own
 *     #zen-apps-sidebar-grid. The positionPanel() wrapper (notes 7/21/22) was writing
 *     style.left/right + setAttribute("data-panel-side", ...) UNCONDITIONALLY on every call from that same
 *     per-frame native loop -- chrome.css has over a dozen selectors keyed on [data-panel-side="..."], so every
 *     redundant write forced Gecko to re-evaluate all of them, even though the value (which side the panel
 *     docks to) essentially never changes within a session. Fix: cache the last-applied side on the root
 *     element and skip the writes entirely once nothing has changed, invalidating the cache whenever this
 *     branch isn't the one driving positioning (opposite-docking off, or vertical-bar mode) so a later
 *     re-entry can't skip a write it actually needs. See the comment inside the positionPanel wrapper for the
 *     invalidation reasoning.
 * 24. THE DOMINANT TRIGGER, CONFIRMED BY DIRECT USER REPRO: any non-zero vertical resize/position pref made
 *     the affected profile janky, and commenting out applyVerticalResizeExtras() restored smooth animation.
 *     The old implementation let native positionPanel() write natural top/bottom, then immediately overwrote
 *     both with adjusted values on every RAF iteration. The next iteration restored the natural values and the
 *     extension changed them again, creating continuous layout churn; rounding could not fix that property
 *     fight. v8 removes applyVerticalResizeExtras() from positionPanel() completely and expresses the same
 *     geometry through persistent margins (note 16), updated only on real state changes or pointer movement.
 * 25. GRABBER DUAL-AXIS DRAG: the 6-dot grabber starts horizontal width resizing immediately. Its separate
 *     vertical pill-position listener waits for a 28px Y deadzone, then subtracts that distance once and tracks
 *     every further Y movement at sub-percent precision until mouseup. X continues independently during diagonals.
 *     All-sides resize only gates the extra panel-edge handles, not this pill grabber.
 * 27. FIREFOX ADD-ON TAB-ID BRIDGE (v9): Zentral normally creates app panels as standalone chrome <browser>
 *     elements, so Firefox WebExtensions cannot resolve them to a native tab and sender.tab/tab APIs see no real
 *     tab identity. The opt-in bridge below creates a REAL background Firefox tab first, then temporarily intercepts
 *     document.createXULElement("browser") only for the synchronous base getOrCreateAppBrowser() call and hands
 *     Zentral that tab's own linkedBrowser. The base private appBrowsers Map therefore stores the genuine tab browser
 *     without any edit above this marker. Zen still gets the visible/pinned tab it expects, while the page shown inside
 *     Zentral is the exact same browsing context that owns the Firefox tabId -- not a dummy/shadow duplicate. Backing
 *     tabs are pinned into one collapsed `Zentral Add-on Hosts` Zen folder and compacted by extension CSS. NEVER replace
 *     this with a fake tabId map: WebExtension APIs resolve operations back through nativeTab.linkedBrowser, so a dummy
 *     tab would target the wrong document. The bridge follows PROFILE_DEFAULTS and intentionally unloads existing panel browsers
 *     when toggled so every recreated panel has one coherent browser/tab identity from birth.
 * 28. THE GRAY-PANEL / "GHOST INTERACTION" BUG (docShellIsActive) -- read this before touching panel
 *     visibility, preload, or the video-sidebar preview module:
 *     SYMPTOM (as reported by the user, verbatim pattern): an app panel (or the video-sidebar preview) loads
 *     and plays normally for a fraction of a second, then visibly grays out / goes blank, WHILE pause/play,
 *     seeking, link navigation and audio all keep working -- i.e. the page is alive and interactive, it just
 *     isn't being painted. This is the single most important diagnostic signature: if playback/interaction
 *     still works on a gray/blank surface, this is a *compositor* problem, not a load/network/crash problem.
 *     Do not chase load failures, CSP, or network errors for this symptom -- there aren't any.
 *     WHY TOGGLE-INDEPENDENT: the user tried disabling every relevant pref (including smart_sleep, which
 *     sounds related but only ever gated *whether* a browser got preloaded -- see preloadAppsSequence() in the
 *     base mod). None of that mattered because the bug isn't in any toggled feature; it's structural.
 *     ROOT CAUSE: every standalone `<browser remote="true">` this extension (or the base mod) creates outside
 *     gBrowser's tab strip -- normal app-panel browsers from getOrCreateAppBrowser(), Triple/Super-View's
 *     second browser, and the video-sidebar's own preview browser in startLivePreview() below -- has no
 *     automatic docShellIsActive management. Firefox only drives that flag for real selected tabs. Gecko still
 *     paints the very first frame after such a browser is shown, then treats its docShell as inactive and stops
 *     compositing it. The content process (and therefore audio, and anything reading decoded frames directly
 *     such as the video-preview's canvas capture path, which bypasses the compositor entirely) is completely
 *     unaffected, which is exactly why those things kept working while the picture didn't.
 *     ONE NARROW PRIOR FIX EXISTED: syncAddonHostBrowserActivity() (bridge feature, note 27) already set
 *     docShellIsActive = true, but only for adopted addon-host browsers -- never for ordinary panel browsers or
 *     the video preview, which is why disabling every other toggle didn't help; this bug was simply never
 *     patched for the common case.
 *     THE FIX, IN THREE PARTS -- do not remove any part without understanding why it exists:
 *       a) syncAppPanelBrowserActivity() (defined near syncAddonHostBrowserActivity) mirrors docShellIsActive
 *          to the SAME display:none/"" flag core already uses to mark which panel browser is on-screen
 *          (getAllAppBrowsers() covers the normal grid, the addon-host bridge, and Triple/Super-View in one
 *          pass). Wired into the openPanel/closePanel hooks.
 *       b) RETRY STAGGERING ON OPEN: a single activation call at open time can still lose the race against a
 *          cold content-process spawn (new site, new container, first launch this session) -- the
 *          browsingContext may not exist yet on the same tick the <browser> is appended, so the call silently
 *          no-ops. This is what caused the "grays out, only recovers after manually closing and reopening the
 *          panel" reports even after part (a) was in place. Fixed by firing the activation again on
 *          requestAnimationFrame (lands before the next paint -- faster than any setTimeout) plus a staggered
 *          setTimeout fallback (30/150/500/1500ms) for slower spawns. If gray flashes on open are still
 *          reported after this, the next step is NOT to add more retries blindly -- log
 *          browser.browsingContext to find the actual real-world spawn latency and size the stagger to it.
 *       c) OPTIONAL CONTINUOUS SELF-HEAL: Gecko can revoke docShellIsActive again later on its own even after
 *          a successful activation. Normal open/navigation retries remain event-driven; the Settings toggle
 *          "Periodic Fallback Polling" can additionally run a 2s safety pass for docshell/CSS/UI state on
 *          Zen builds that still show random stale/gray panels. It is OFF by default to avoid needless wakeups.
 *     VIDEO-SIDEBAR PREVIEW MIRRORS THE SAME BUG: startLivePreview()'s preview <browser> and paint()'s
 *     LIVE_MODES health-check branch got the identical three-part treatment (activate on create, activate once
 *     browsingContext exists, re-activate every health-check tick) for the same underlying reason. If a
 *     similar "loads, plays briefly, freezes to a still frame, then goes blank, audio/capture still work"
 *     report ever comes in for a DIFFERENT feature, look for a standalone createXULElement("browser") in that
 *     feature first -- this exact bug is very likely recurring in a fourth place.
 * 29. PERF: getAllAppBrowsers() is used by panel lifecycle work and optional recovery. The periodic recovery
 *     pass is disabled by default; when enabled it still reuses one browser collection for docshell/CSS checks.
 *     The helper used to run an unconditional document-wide
 *     `document.querySelectorAll("#bgalazka-super-panel browser")` on every call even though that panel only
 *     exists while Triple/Super-View is in use (rare). It now checks `document.getElementById("bgalazka-super-panel")`
 *     first and only runs the scoped query when that container actually exists. Keep this shape if you add more
 *     browser sources to this function -- gate each with a cheap existence check before scanning for it.
 * ============================================================================================================= */

(function initBgalazkaExtension() {
  // Sine can run this file before Zen has finished restoring its sidebar and
  // tabs. Build tiles and apply layout attributes only after that UI exists.
  if (
    typeof gBrowserInit !== "undefined" &&
    !gBrowserInit.delayedStartupFinished
  ) {
    if (window.BgalazkaExtensionStartupPending) return;
    window.BgalazkaExtensionStartupPending = true;
    const ready = (subject, topic) => {
      if (subject !== window) return;
      cancelReady();
      initBgalazkaExtension();
    };
    const cancelReady = () => {
      if (!window.BgalazkaExtensionStartupPending) return;
      window.BgalazkaExtensionStartupPending = false;
      Services.obs.removeObserver(ready, "browser-delayed-startup-finished");
      window.removeEventListener("unload", cancelReady);
    };
    Services.obs.addObserver(ready, "browser-delayed-startup-finished");
    window.addEventListener("unload", cancelReady, { once: true });
    if (typeof window.addUnloadListener === "function")
      window.addUnloadListener(cancelReady);
    else if (typeof UC_API !== "undefined" && UC_API.addUnloadListener)
      UC_API.addUnloadListener(cancelReady);
    // A synchronous startup completion around observer registration must not
    // leave this instance waiting for an event that has already fired.
    if (gBrowserInit.delayedStartupFinished)
      ready(window, "browser-delayed-startup-finished");
    return;
  }
  /* NOTE 26 - PANEL INPUT SHIELD: configurable `panel_input_shield` keeps the open
   * panel as a pointer hit-test barrier and scopes mouse Back/Forward buttons
   * to the visible app browser. Its initial value follows PROFILE_DEFAULTS. */
  if (window.BgalazkaExtensionInitialized) return;
  window.BgalazkaExtensionInitialized = true;

  const cleanupFns = [];
  const registerCleanup = (fn) => cleanupFns.push(fn);
  let extensionDisposed = false;
  // Scope every extension timer to this instance. Delayed UI work must not
  // resurrect controls or operate on a new mod instance after hot unload.
  const pendingTimeouts = new Set();
  const pendingIntervals = new Set();
  const setTimeout = (callback, delay, ...args) => {
    if (extensionDisposed) return null;
    const id = window.setTimeout(() => {
      pendingTimeouts.delete(id);
      if (!extensionDisposed) callback(...args);
    }, delay);
    pendingTimeouts.add(id);
    return id;
  };
  const clearTimeout = (id) => {
    pendingTimeouts.delete(id);
    window.clearTimeout(id);
  };
  const setInterval = (callback, delay) => {
    if (extensionDisposed) return null;
    const id = window.setInterval(() => {
      if (!extensionDisposed) callback();
    }, delay);
    pendingIntervals.add(id);
    return id;
  };
  const clearInterval = (id) => {
    pendingIntervals.delete(id);
    window.clearInterval(id);
  };
  registerCleanup(() => {
    pendingTimeouts.forEach((id) => window.clearTimeout(id));
    pendingIntervals.forEach((id) => window.clearInterval(id));
    pendingTimeouts.clear();
    pendingIntervals.clear();
    window.removeEventListener("unload", performBgalazkaUnload);
  });

  const EXT_PREFS = {
    TRANSLUCENCY: "zen.workspace.bgalazka.translucency",
    OPPOSITE_DOCKING: "zen.workspace.bgalazka.opposite_docking",
    EDGE_ATTACHED_PANELS: "zen.workspace.bgalazka.edge_attached_panels",
    TAB_ISOLATION: "zen.workspace.bgalazka.tab_isolation",
    CORNER_TILES: "zen.workspace.bgalazka.corner_tiles",
    ALL_TAB_PANELS: "zen.workspace.bgalazka.all_tab_panels",
    HIDE_EXPAND: "zen.workspace.bgalazka.hide_expand",
    OPACITY_UNPINNED: "zen.workspace.bgalazka.opacity_unpinned",
    OPACITY_PINNED_FOCUS: "zen.workspace.bgalazka.opacity_pinned_focus",
    OPACITY_PINNED_BLUR: "zen.workspace.bgalazka.opacity_pinned_blur",
    PANEL_INPUT_SHIELD: "zen.workspace.bgalazka.panel_input_shield",
    ADDON_TAB_ID_BRIDGE: "zen.workspace.bgalazka.addon_tab_id_bridge",
    SHOW_ADDON_HOST_FOLDER: "zen.workspace.bgalazka.show_addon_host_folder",
    ZEN_INTERNET_PANEL_CSS: "zen.workspace.bgalazka.zen_internet_panel_css",
    SHOW_TRIPLE_STYLE_REPAIR: "zen.workspace.bgalazka.show_triple_style_repair",
    PERIODIC_FALLBACK_POLLING:
      "zen.workspace.bgalazka.periodic_fallback_polling",
    // Primary-toolbar quick override. No Settings row: this is deliberately a
    // one-click escape hatch that preserves every user appearance pref and
    // merely forces the panel backing surfaces to opaque black while active.
    FORCE_PANEL_BLACK: "zen.workspace.bgalazka.force_panel_black",
    SMART_SLEEP: "zen.workspace.bgalazka.smart_sleep",
    AUDIO_INDICATOR: "zen.workspace.bgalazka.audio_indicator",
    HIDE_UNATTACHED_APP_CONTROLS:
      "zen.workspace.bgalazka.hide_unattached_app_controls",

    RSS_HIDE_EMPTY: "zen.workspace.bgalazka.rss.hide_empty",
    RSS_COMPACT_HEADERS: "zen.workspace.bgalazka.rss.compact_headers",
    TABBAR_COMPACT: "zen.workspace.bgalazka.look.compact_tabbar",
    TABBAR_ROW_HEIGHT: "zen.workspace.bgalazka.look.tabbar_row_height",
    TABBAR_ROW_GAP: "zen.workspace.bgalazka.look.tabbar_row_gap",
    TABBAR_ICON_GAP: "zen.workspace.bgalazka.look.tabbar_icon_gap",

    // Extension keyboard shortcuts. The master switch defaults OFF to obey
    // the extension's default-off contract; string defaults below are inert
    // until the user enables keybinds. Each binding is independently editable.
    KEYBINDS_ENABLED: "zen.workspace.bgalazka.keybinds_enabled",
    MMB_UNLOAD_NORMAL_TABS: "zen.workspace.bgalazka.mmb_unload_normal_tabs",
    KEYBIND_CLOSE_PANEL: "zen.workspace.bgalazka.keybind.close_panel",
    KEYBIND_BACK: "zen.workspace.bgalazka.keybind.back",
    KEYBIND_FORWARD: "zen.workspace.bgalazka.keybind.forward",
    KEYBIND_RELOAD: "zen.workspace.bgalazka.keybind.reload",
    KEYBIND_FOCUS_URL: "zen.workspace.bgalazka.keybind.focus_url",
    KEYBIND_TOGGLE_PIN: "zen.workspace.bgalazka.keybind.toggle_pin",
    KEYBIND_TOGGLE_EXPAND: "zen.workspace.bgalazka.keybind.toggle_expand",
    KEYBIND_TOGGLE_DUAL_VIEW: "zen.workspace.bgalazka.keybind.toggle_dual_view",
    KEYBIND_TOGGLE_RESIZE: "zen.workspace.bgalazka.keybind.toggle_resize",
    KEYBIND_TOGGLE_TOOLBAR: "zen.workspace.bgalazka.keybind.toggle_toolbar",
    KEYBIND_TOGGLE_TRANSLUCENCY:
      "zen.workspace.bgalazka.keybind.toggle_translucency",
    KEYBIND_TOGGLE_OPPOSITE_DOCKING:
      "zen.workspace.bgalazka.keybind.toggle_opposite_docking",
    KEYBIND_TOGGLE_EDGE_ATTACHED:
      "zen.workspace.bgalazka.keybind.toggle_edge_attached",
    KEYBIND_TOGGLE_INPUT_SHIELD:
      "zen.workspace.bgalazka.keybind.toggle_input_shield",
    KEYBIND_ZOOM_IN: "zen.workspace.bgalazka.keybind.zoom_in",
    KEYBIND_ZOOM_OUT: "zen.workspace.bgalazka.keybind.zoom_out",
    KEYBIND_ZOOM_RESET: "zen.workspace.bgalazka.keybind.zoom_reset",
    KEYBIND_OPEN_SETTINGS: "zen.workspace.bgalazka.keybind.open_settings",
  };

  const ATTR_MAP = [
    {
      pref: EXT_PREFS.TRANSLUCENCY,
      attr: "bgalazka-translucency",
      defaultVal: false,
    },
    {
      pref: EXT_PREFS.OPPOSITE_DOCKING,
      attr: "bgalazka-opposite-docking",
      defaultVal: false,
    },
    {
      pref: EXT_PREFS.EDGE_ATTACHED_PANELS,
      attr: "bgalazka-edge-attached-panels",
      defaultVal: false,
    },
    {
      pref: EXT_PREFS.TAB_ISOLATION,
      attr: "bgalazka-tab-isolation",
      defaultVal: true,
    },
    {
      pref: EXT_PREFS.CORNER_TILES,
      attr: "bgalazka-corner-tiles",
      defaultVal: false,
    },
    {
      pref: "zen.workspace.bgalazka.hover_corner_tiles",
      attr: "bgalazka-hover-corner-tiles",
      defaultVal: false,
    },
    {
      pref: "zen.workspace.bgalazka.hide_hover_reveal_btn",
      attr: "bgalazka-hide-hover-reveal-btn",
      defaultVal: false,
    },
    {
      pref: EXT_PREFS.HIDE_EXPAND,
      attr: "bgalazka-hide-expand",
      defaultVal: false,
    },
    {
      pref: EXT_PREFS.HIDE_UNATTACHED_APP_CONTROLS,
      attr: "bgalazka-hide-unattached-app-controls",
      defaultVal: false,
    },
    {
      pref: EXT_PREFS.PANEL_INPUT_SHIELD,
      attr: "bgalazka-panel-input-shield",
      defaultVal: false,
    },
    {
      pref: EXT_PREFS.ADDON_TAB_ID_BRIDGE,
      attr: "bgalazka-addon-tab-id-bridge",
      defaultVal: false,
    },
    {
      pref: EXT_PREFS.SHOW_ADDON_HOST_FOLDER,
      attr: "bgalazka-show-addon-host-folder",
      defaultVal: false,
    },
    {
      pref: EXT_PREFS.TABBAR_COMPACT,
      attr: "bgalazka-tabbar-compact",
      defaultVal: false,
    },
  ];

  // Reusable defaults from the owner's exported profile. Keep per-app data,
  // linked pairs, shortcuts, private URLs, panel coordinates and viewport
  // dimensions out of this table. Existing saved preferences always win.
  const PROFILE_DEFAULTS = Object.freeze({
    [EXT_PREFS.TRANSLUCENCY]: true,
    [EXT_PREFS.OPPOSITE_DOCKING]: true,
    [EXT_PREFS.TAB_ISOLATION]: true,
    [EXT_PREFS.CORNER_TILES]: true,
    [EXT_PREFS.ALL_TAB_PANELS]: true,
    [EXT_PREFS.PANEL_INPUT_SHIELD]: true,
    [EXT_PREFS.ADDON_TAB_ID_BRIDGE]: true,
    [EXT_PREFS.SMART_SLEEP]: true,
    [EXT_PREFS.AUDIO_INDICATOR]: true,
    "zen.workspace.bgalazka.push_page": true,
    "zen.workspace.bgalazka.pill_peek_dot": true,
    "zen.workspace.bgalazka.pill_peek_dot_color": "#5e0002",
    "zen.workspace.bgalazka.pill_peek_dot_opacity": 31,
    "zen.workspace.bgalazka.pill_background_opacity": 48,
    "zen.workspace.bgalazka.blur_intensity": 0,
    "zen.workspace.bgalazka.web_toolbar_enabled": true,
    "zen.workspace.bgalazka.web_toolbar_urlbar": true,
    "zen.workspace.bgalazka.web_toolbar_zoom": true,
    "zen.workspace.bgalazka.web_toolbar_quickswitch": true,
    "zen.workspace.bgalazka.web_toolbar_quickswitch_target.ddg": true,
    "zen.workspace.bgalazka.web_toolbar_quickswitch_target.startpage": true,
    "zen.workspace.bgalazka.web_toolbar_quickswitch_target.youtube": true,
  });

  function getPref(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(PROFILE_DEFAULTS, key))
      fallback = PROFILE_DEFAULTS[key];
    try {
      if (Services.prefs.prefHasUserValue(key)) {
        if (typeof fallback === "boolean")
          return Services.prefs.getBoolPref(key);
        if (typeof fallback === "number") return Services.prefs.getIntPref(key);
        // BUG FIX: string-typed prefs (e.g. any future dropdown pref) had no
        // branch here at all, so they always fell through to `fallback`
        // below even when a value had actually been saved. See setPref()
        // for the matching write-side half of this fix.
        if (typeof fallback === "string")
          return Services.prefs.getStringPref(key);
      }
    } catch (_) {}
    return fallback;
  }

  function setPref(key, value) {
    try {
      if (typeof value === "boolean") Services.prefs.setBoolPref(key, value);
      if (typeof value === "number") Services.prefs.setIntPref(key, value);
      // BUG FIX: string prefs previously matched neither `if`, so this was a
      // silent no-op — the dropdown/UI looked like it saved (it updated the
      // live DOM attribute on "change") but nothing ever reached
      // Services.prefs, so the value reset to default on every restart.
      if (typeof value === "string") Services.prefs.setStringPref(key, value);
    } catch (e) {
      console.warn("[BgalazkaExtension] Failed to save pref:", key, e);
    }
  }

  // The pill sits translate(-100%)/translate(100%) OUTSIDE the panel's own
  // edge (see chrome.css section 2), so it needs its own clearance beyond
  // the sidebar's. It's a fixed-width vertical stack of .zen-app-btn (26px)
  // plus 4px side padding plus a 1px border each side ~= 36px; we hardcode
  // a slightly generous constant instead of measuring the live DOM element
  // because during an active resize-drag the pill can be in either its
  // "peek dot" idle (scaled down ~0.22x) or full-size hover state depending
  // on exact mouse position, so a live getBoundingClientRect() reading
  // would be unreliable — see onDrag's patch below.
  const BGALAZKA_PILL_WIDTH_RESERVE_PX = 44;

  /* ------------------------------------------------------------------
   * Shared by the toggleExpand and onDrag fixes below (note 7 + this
   * session's follow-up bug reports): the true maximum width the panel can
   * grow to in opposite-docking mode without pushing the pill off-screen or
   * overlapping the sidebar. Native code has no equivalent notion of this
   * at all (see toggleExpand's own math, and onDrag's flat
   * `window.innerWidth * Constants.Apps.MAX_WIDTH_RATIO` clamp, neither of
   * which know the panel is docked away from the sidebar).
   * ------------------------------------------------------------------ */
  // BUG-CLASS DEFENSE: an uncaught exception thrown by any of this file's
  // synchronous top-level init calls (patchAppsInstance, hookAppsInstance,
  // ensureWebToolbar, ensureMobileUaMenuItem, ...) aborts the ENTIRE rest of
  // this IIFE silently — everything textually after the throw simply never
  // runs, with no error dialog, which is exactly what happened when
  // ensureWebToolbar() was (mistakenly) called too early and hit a
  // temporal-dead-zone ReferenceError on PREF_ICONS. Every first synchronous
  // call to one of these init functions is now wrapped through this helper
  // so one function's bug can never again cascade into every later feature
  // silently failing to load.
  function safeCall(fn, label) {
    try {
      return fn();
    } catch (e) {
      console.error(`[BgalazkaExtension] ${label} threw:`, e);
      return false;
    }
  }

  function computeOppositeDockingSafeMaxWidth() {
    const gap = 12; // must match the gap our positionPanel() override uses
    const sidebarEl =
      document.getElementById("sidebar-box") ||
      document.getElementById("sidebar-container") ||
      document.getElementById("vertical-tabs");
    const sidebarRect = sidebarEl
      ? sidebarEl.getBoundingClientRect()
      : gBrowser?.tabContainer?.getBoundingClientRect();
    const sidebarWidth =
      sidebarRect && sidebarRect.width > 0 ? sidebarRect.width : 0;
    // MIN_WIDTH_PX (280) is hardcoded here because Constants is scoped
    // inside the base mod's own IIFE and unreachable from here (note 5).
    return Math.max(
      280,
      window.innerWidth -
        sidebarWidth -
        BGALAZKA_PILL_WIDTH_RESERVE_PX -
        gap * 2,
    );
  }

  // NOTE: values are written as plain integers with a unit suffix (e.g. "92%") so the
  // CSS side can consume them directly via var() without any extra calc()/unit wrangling.
  function updateCSSVars() {
    const root = document.documentElement;
    root.style.setProperty(
      "--bg-opacity-unpinned",
      getPref(EXT_PREFS.OPACITY_UNPINNED, 92) + "%",
    );
    root.style.setProperty(
      "--bg-opacity-pinned-focus",
      getPref(EXT_PREFS.OPACITY_PINNED_FOCUS, 85) + "%",
    );
    root.style.setProperty(
      "--bg-opacity-pinned-blur",
      getPref(EXT_PREFS.OPACITY_PINNED_BLUR, 45) + "%",
    );
    // Pill vertical offset, -50 to 50, 0 = centered. NOTE: EXT_PREFS.PILL_POSITION
    // is only merged in further below (once BGALAZKA_EXT_PREFS exists), so the
    // very first call to updateCSSVars() at init (via applyAttributes(), before
    // that merge runs) will harmlessly read `undefined` here and fall back to 0;
    // the "Initial attribute sync" block near the end of this file calls
    // updateCSSVars() again once the real pref key exists, which applies the
    // actual saved value. The CSS side clamps this with clamp() so no matter
    // what value is stored, the pill can never be pushed fully off-screen.
    //
    // BUG FIX (this pill was landing in the wrong spot in NORMAL, non-opposite
    // docking -- nothing to do with opposite-docking mode): this pref used to
    // be a "top"/"center"/"bottom" STRING enum (see the BGALAZKA_EXT_PREFS.
    // PILL_POSITION comment). getPref() trusts Firefox's own stored pref TYPE
    // (Services.prefs.getPrefType()), not a runtime typeof-number check, so a
    // leftover string value from that old dropdown (e.g. "center") comes back
    // AS A STRING here, not 0 -- the old inline comment claiming getPref()
    // "will just fail its typeof-number fallback check" was describing
    // behavior that doesn't actually exist in getPref()'s current
    // implementation. Left unguarded, `"center" + "%"` produces the CSS
    // custom-property value `center%`, which is invalid inside the
    // chrome.css `calc(50% + var(--bgalazka-pill-offset, 0%))` expression --
    // an invalid var() substitution doesn't fall back to the var()'s own
    // `0%` default, it makes the whole `top` DECLARATION invalid at
    // computed-value time, so `top` silently reverts to its initial value
    // (`auto`) instead of the intended centered position. Coerced to a
    // clamped finite number here so a bad/legacy value can never reach the
    // CSS layer; see the one-time migration further below (near "Initial
    // attribute sync") that also clears the stale string off disk so the
    // settings-panel slider stops silently disagreeing with it too.
    const rawPillOffset = getPref(EXT_PREFS.PILL_POSITION, 0);
    const pillOffset =
      typeof rawPillOffset === "number" && Number.isFinite(rawPillOffset)
        ? Math.max(-50, Math.min(50, rawPillOffset))
        : 0;
    root.style.setProperty("--bgalazka-pill-offset", pillOffset + "%");
    root.style.setProperty(
      "--bgalazka-pill-peek-color",
      getPref(EXT_PREFS.PILL_PEEK_DOT_COLOR, "#4da6ff"),
    );
    root.style.setProperty(
      "--bgalazka-pill-peek-opacity",
      getPref(EXT_PREFS.PILL_PEEK_DOT_OPACITY, 90) + "%",
    );
    root.style.setProperty(
      "--bgalazka-pill-background-opacity",
      getPref(EXT_PREFS.PILL_BACKGROUND_OPACITY, 90) + "%",
    );
  }

  function applyAttributes() {
    ATTR_MAP.forEach(({ pref, attr, defaultVal }) => {
      document.documentElement.setAttribute(
        attr,
        getPref(pref, defaultVal) ? "true" : "false",
      );
    });
    updateCSSVars();
  }
  applyAttributes();

  // Mirror Arc's effective prefs, including built-in default values. The
  // extension's getPref() intentionally reads only user-set preferences, so
  // use Firefox's direct boolean getter for compatibility with Arc's media
  // queries without putting vendor-specific @media syntax in chrome.css.
  for (const [pref, attr] of [
    ["browser.tabs.fadeOutUnloadedTabs", "bgalazka-arc-fade-unloaded"],
    ["arc-grayscale-unloaded-tabs", "bgalazka-arc-gray-unloaded"],
  ]) {
    const sync = () => {
      document.documentElement.setAttribute(
        attr,
        Services.prefs.getBoolPref(pref, false) ? "true" : "false",
      );
    };
    sync();
    Services.prefs.addObserver(pref, sync);
    registerCleanup(() => {
      Services.prefs.removeObserver(pref, sync);
      document.documentElement.removeAttribute(attr);
    });
  }

  ATTR_MAP.forEach(({ pref, attr, defaultVal }) => {
    const observer = () => {
      document.documentElement.setAttribute(
        attr,
        getPref(pref, defaultVal) ? "true" : "false",
      );
    };
    try {
      Services.prefs.addObserver(pref, observer, false);
      registerCleanup(() => {
        try {
          Services.prefs.removeObserver(pref, observer);
        } catch (_) {}
      });
    } catch (_) {}
  });

  function restartBrowser() {
    try {
      const appStartup =
        Cc["@mozilla.org/toolkit/app-startup;1"]?.getService(
          Ci.nsIAppStartup,
        ) || Services.startup;
      if (appStartup)
        appStartup.quit(
          Ci.nsIAppStartup.eRestart | Ci.nsIAppStartup.eAttemptQuit,
        );
    } catch (e) {
      console.error("[BgalazkaExtension] Restart failed:", e);
    }
  }

  /* ==========================================================================
   * ALL-SIDES RESIZE: STATE + DRAG MATH (see note 16)
   * -----------------------------------------------------------------------
   * These two prefs deliberately live OUTSIDE BGALAZKA_EXT_PREFS (which the
   * "Apply default or stored attribute states on startup" block at the end
   * of this file auto-enumerates as BOOLEAN prefs and mirrors onto root
   * attributes). Pulling numeric pixel offsets into that same object would
   * make every startup silently hit-and-catch a type-mismatch exception on
   * these two keys (getBoolPref() on an int-typed pref) and stamp a useless
   * "bgalazka-panel-top-extra-px" attribute nothing reads. Same pattern as
   * MOBILE_UA_PREF further below for the same reason.
   * ========================================================================== */
  const PANEL_TOP_EXTRA_PREF = "zen.workspace.bgalazka.panel_top_extra_px";
  const PANEL_BOTTOM_EXTRA_PREF =
    "zen.workspace.bgalazka.panel_bottom_extra_px";
  // Whole-panel vertical REPOSITION (not resize): positive = shifted UP from
  // wherever positionPanel() would naturally place it. Kept as its own pref,
  // separate from the two resize extras above, so "drag the panel up/down"
  // (the URL bar grip, see note 18) and "resize its height" (the top/bottom
  // edge strips, note 16) never fight over the same number -- they're two
  // independent offsets summed together once in applyVerticalResizeExtras().
  const PANEL_POSITION_OFFSET_PREF =
    "zen.workspace.bgalazka.panel_position_offset_px";
  // Positive values move the whole panel toward the physical right edge.
  // Implemented as an anchored-side margin, never as a positionPanel() patch.
  const PANEL_HORIZONTAL_OFFSET_PREF =
    "zen.workspace.bgalazka.panel_horizontal_offset_px";
  // An unset offset pulls the panel across Zentral's native 12px side gap.
  // The saved pref remains a physical X offset; mirror only its default.
  const DEFAULT_PANEL_EDGE_OFFSET_PX = -12;
  // Kept separate from PANEL_POSITION_OFFSET_PREF: this moves only the pill
  // within its panel, while the latter moves the complete panel in the window.
  // The settings UI declares the same key later as BGALAZKA_EXT_PREFS.PILL_POSITION.
  const PILL_POSITION_PREF = "zen.workspace.bgalazka.pill_position";
  const PILL_POSITION_MIN = -50;
  const PILL_POSITION_MAX = 50;
  const V_RESIZE_MIN_HEIGHT = 200; // mirrors Constants.Apps.MIN_WIDTH_PX's spirit (note 5: unreachable directly)
  // Fresh-install baseline: add only a tiny amount to Zentral's own native
  // top/bottom gap so the floating panel reads as a normal inset card. This
  // is deliberately NOT a toggle and is the sole exception to the extension's
  // default-off visual contract above. Saved user resize values still win.
  const DEFAULT_PANEL_VERTICAL_EXTRA_PX = 4;
  let vResizeState = null;
  let vPosDragState = null;
  let hPosDragState = null;
  let pillPosDragState = null;

  /* ------------------------------------------------------------------
   * PERF (note 21): getVerticalExtras()/getPositionOffset() used to call
   * getPref() -> Services.prefs.prefHasUserValue()+getIntPref() fresh on
   * every call. That looked harmless in isolation, but applyVerticalResizeExtras()
   * (which calls both) runs from inside our positionPanel() override, and
   * positionPanel() is called by the BASE MOD's own reposition()/rafLoop
   * (startPositionTracking(), a few hundred lines up in this same file) --
   * which fires on EVERY mousemove (throttled to ~60/s) AND on EVERY
   * transitionstart/transitionrun/transitionend ANYWHERE in the entire
   * browser window, for as long as the panel is open, re-arming its own
   * requestAnimationFrame loop for another 200ms each time one of those
   * fires. On a profile with a lot of ambient chrome UI (many tabs/pins/
   * workspaces = many small hover/indicator transitions happening at any
   * given moment), that loop can be re-armed continuously and effectively
   * never go idle while the panel stays open -- meaning positionPanel(),
   * and therefore these two getPref() calls, can run on every single
   * animation frame indefinitely, not just briefly after a drag. Two
   * Services.prefs XPCOM round-trips per frame, sustained at 60fps, is
   * real, measurable overhead -- and it is COMPLETELY UNCONDITIONAL: it
   * runs regardless of OPPOSITE_DOCKING, ALL_SIDES_RESIZE, TRANSLUCENCY,
   * or any other toggle (this is why disabling those individually didn't
   * help -- they were never in this path to begin with). This is also a
   * plausible reason a fresh profile never shows it: few ambient
   * transitions means the rafLoop naturally dies out after ~200ms of
   * quiet, so the overhead is a brief burst instead of continuous.
   *
   * Fix: read/write an in-memory cache instead of hitting Services.prefs
   * from the hot path. The cache is kept in sync two ways: (1) synchronously
   * on our own writes (saveVerticalExtras/savePositionOffset update the
   * cache immediately, not just the pref, so there's no round-trip lag
   * between "user let go of the drag" and "cache reflects it"), and (2)
   * via Services.prefs.addObserver, for the (rare) case these get changed
   * from outside this session, e.g. about:config or a future
   * import/export-config feature. Observers are cheap: they only fire on
   * an actual pref WRITE, not per frame.
   * ------------------------------------------------------------------ */
  let cachedTopExtra = getPref(
    PANEL_TOP_EXTRA_PREF,
    DEFAULT_PANEL_VERTICAL_EXTRA_PX,
  );
  let cachedBottomExtra = getPref(
    PANEL_BOTTOM_EXTRA_PREF,
    DEFAULT_PANEL_VERTICAL_EXTRA_PX,
  );
  let cachedPosOffset = getPref(PANEL_POSITION_OFFSET_PREF, 0);
  let cachedHorizontalOffset = getPref(PANEL_HORIZONTAL_OFFSET_PREF, 0);
  let hasSavedHorizontalOffset = Services.prefs.prefHasUserValue(
    PANEL_HORIZONTAL_OFFSET_PREF,
  );

  [
    [PANEL_TOP_EXTRA_PREF, (v) => (cachedTopExtra = v)],
    [PANEL_BOTTOM_EXTRA_PREF, (v) => (cachedBottomExtra = v)],
    [PANEL_POSITION_OFFSET_PREF, (v) => (cachedPosOffset = v)],
    [PANEL_HORIZONTAL_OFFSET_PREF, (v) => (cachedHorizontalOffset = v)],
  ].forEach(([prefKey, setCache]) => {
    const observer = () => {
      if (prefKey === PANEL_HORIZONTAL_OFFSET_PREF)
        hasSavedHorizontalOffset = Services.prefs.prefHasUserValue(
          PANEL_HORIZONTAL_OFFSET_PREF,
        );
      const fallback =
        prefKey === PANEL_TOP_EXTRA_PREF || prefKey === PANEL_BOTTOM_EXTRA_PREF
          ? DEFAULT_PANEL_VERTICAL_EXTRA_PX
          : 0;
      setCache(getPref(prefKey, fallback));
      applyVerticalResizeExtras(document.getElementById("zen-app-panel-root"));
      applyHorizontalPanelOffset(document.getElementById("zen-app-panel-root"));
    };
    try {
      Services.prefs.addObserver(prefKey, observer, false);
      registerCleanup(() => {
        try {
          Services.prefs.removeObserver(prefKey, observer);
        } catch (_) {}
      });
    } catch (_) {}
  });

  function getVerticalExtras() {
    return { top: cachedTopExtra, bottom: cachedBottomExtra };
  }

  function saveVerticalExtras(top, bottom) {
    cachedTopExtra = Math.round(top);
    cachedBottomExtra = Math.round(bottom);
    setPref(PANEL_TOP_EXTRA_PREF, cachedTopExtra);
    setPref(PANEL_BOTTOM_EXTRA_PREF, cachedBottomExtra);
  }

  function getPositionOffset() {
    return cachedPosOffset;
  }

  function savePositionOffset(px) {
    cachedPosOffset = Math.round(px);
    setPref(PANEL_POSITION_OFFSET_PREF, cachedPosOffset);
  }

  function getHorizontalAnchorSide(root) {
    if (!root) return "left";
    const side = root.getAttribute("data-panel-side");
    if (side === "left" || side === "right") return side;
    return root.style.left === "auto" && root.style.right !== "auto"
      ? "right"
      : "left";
  }

  function getHorizontalOffsetPreference(root) {
    if (hResizeState?.adjustsOffset || hPosDragState || vPosDragState)
      return cachedHorizontalOffset;
    if (hasSavedHorizontalOffset) return cachedHorizontalOffset;
    return getHorizontalAnchorSide(root) === "right"
      ? -DEFAULT_PANEL_EDGE_OFFSET_PX
      : DEFAULT_PANEL_EDGE_OFFSET_PX;
  }

  function getAppliedHorizontalOffset(root) {
    if (!root) return 0;
    if (Number.isFinite(root._bgalazkaAppliedHorizontalOffset))
      return root._bgalazkaAppliedHorizontalOffset;
    const anchoredRight = getHorizontalAnchorSide(root) === "right";
    const margin = parseFloat(
      anchoredRight ? root.style.marginRight : root.style.marginLeft,
    );
    const physicalOffset = Number.isFinite(margin) ? margin : 0;
    return anchoredRight ? -physicalOffset : physicalOffset;
  }

  function getHorizontalOffsetBounds(root) {
    if (!root) return { min: 0, max: 0 };
    // The root is fixed-position. Its offset geometry includes saved
    // margins but ignores the translateX animation used by hover reveal and
    // panel opening. Measuring getBoundingClientRect() during that animation
    // clamps the saved position against an off-screen rectangle, so clicking
    // the eye can make the panel jump until the next positioning event.
    const left = root.offsetLeft;
    const right = left + root.offsetWidth;
    const appliedOffset = getAppliedHorizontalOffset(root);
    return {
      min: appliedOffset - left,
      max: appliedOffset + (window.innerWidth - right),
    };
  }

  function clampHorizontalOffsetToViewport(root, desiredOffset) {
    const desired = Number.isFinite(desiredOffset) ? desiredOffset : 0;
    const { min, max } = getHorizontalOffsetBounds(root);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max)
      return Math.round(desired);
    return Math.max(min, Math.min(max, desired));
  }

  function applyHorizontalPanelOffset(root) {
    if (!root) return;

    // Dual/Triple View closes the built-in 12px side gap while retaining a
    // 12px gutter to the pushed page. Do not overwrite the user's saved X
    // offset; it returns when the view closes.
    const dualViewActive =
      document.documentElement.getAttribute("bgalazka-push-page") === "true";
    const edgeAttachedPanels =
      document.documentElement.getAttribute("bgalazka-edge-attached-panels") ===
      "true";
    const anchorSide = getHorizontalAnchorSide(root);
    if (dualViewActive || edgeAttachedPanels) {
      const edgeMargin = dualViewActive ? "-12px" : "0px";
      const leftMargin = anchorSide === "left" ? edgeMargin : "0px";
      const rightMargin = anchorSide === "right" ? edgeMargin : "0px";
      if (root.style.marginLeft !== leftMargin)
        root.style.marginLeft = leftMargin;
      if (root.style.marginRight !== rightMargin)
        root.style.marginRight = rightMargin;
      root._bgalazkaAppliedHorizontalOffset = dualViewActive
        ? anchorSide === "right"
          ? 12
          : -12
        : 0;
      root._bgalazkaHorizontalAnchorSide = anchorSide;
      return;
    }

    // If docking moved the panel to the other side, discard only the OLD
    // side's live margin before measuring bounds. The saved logical offset is
    // preserved and reapplied against the new anchor immediately below.
    if (
      root._bgalazkaHorizontalAnchorSide &&
      root._bgalazkaHorizontalAnchorSide !== anchorSide
    ) {
      root.style.marginLeft = "0px";
      root.style.marginRight = "0px";
      root._bgalazkaAppliedHorizontalOffset = 0;
    }
    root._bgalazkaHorizontalAnchorSide = anchorSide;

    const anchoredRight = anchorSide === "right";
    const offset = clampHorizontalOffsetToViewport(
      root,
      Math.round(getHorizontalOffsetPreference(root)),
    );
    const leftMargin = anchoredRight ? "0px" : offset + "px";
    const rightMargin = anchoredRight ? -offset + "px" : "0px";
    if (root.style.marginLeft !== leftMargin)
      root.style.marginLeft = leftMargin;
    if (root.style.marginRight !== rightMargin)
      root.style.marginRight = rightMargin;
    root._bgalazkaAppliedHorizontalOffset = offset;
  }

  // Whole-panel horizontal REPOSITION using the already-existing
  // Panel Horizontal Offset preference. This is intentionally separate from
  // width resizing: dragging the all-sides pill button sideways should move
  // the complete panel left/right without changing its saved width.
  function startPanelHorizontalPositionDrag(e, startX = e.clientX) {
    if (e.button !== 0) return;
    const root = document.getElementById("zen-app-panel-root");
    if (!root) return;
    e.preventDefault();
    e.stopPropagation();

    // Normalize any stale saved value first, then derive the REAL drag limits
    // from the panel's current viewport rectangle. No arbitrary +/-300px cap.
    applyHorizontalPanelOffset(root);
    const startOffset = getAppliedHorizontalOffset(root);
    const { min, max } = getHorizontalOffsetBounds(root);
    hPosDragState = {
      startX,
      startOffset,
      liveOffset: startOffset,
      minOffset: min,
      maxOffset: max,
    };

    const slider = document.getElementById("zen-app-panel-slider");
    if (slider) slider.style.pointerEvents = "none";
    document.documentElement.setAttribute(
      "bgalazka-panel-hpos-dragging",
      "true",
    );
    document.addEventListener("mousemove", onPanelHorizontalPositionDrag);
    document.addEventListener("mouseup", stopPanelHorizontalPositionDrag);
    onPanelHorizontalPositionDrag(e);
  }

  function onPanelHorizontalPositionDrag(e) {
    if (!hPosDragState) return;
    const root = document.getElementById("zen-app-panel-root");
    if (!root) return;
    const next = Math.max(
      hPosDragState.minOffset,
      Math.min(
        hPosDragState.maxOffset,
        hPosDragState.startOffset + (e.clientX - hPosDragState.startX),
      ),
    );
    hPosDragState.liveOffset = next;
    cachedHorizontalOffset = next;
    applyHorizontalPanelOffset(root);
  }

  function stopPanelHorizontalPositionDrag() {
    document.removeEventListener("mousemove", onPanelHorizontalPositionDrag);
    document.removeEventListener("mouseup", stopPanelHorizontalPositionDrag);
    const slider = document.getElementById("zen-app-panel-slider");
    if (slider) slider.style.pointerEvents = "";
    document.documentElement.removeAttribute("bgalazka-panel-hpos-dragging");
    if (hPosDragState) {
      cachedHorizontalOffset = Math.round(hPosDragState.liveOffset);
      setPref(PANEL_HORIZONTAL_OFFSET_PREF, cachedHorizontalOffset);
    }
    hPosDragState = null;
  }
  registerCleanup(() => {
    document.removeEventListener("mousemove", onPanelHorizontalPositionDrag);
    document.removeEventListener("mouseup", stopPanelHorizontalPositionDrag);
  });

  /* ------------------------------------------------------------------
   * PILL VERTICAL DRAG (extension-only maintenance note): the native
   * .zen-app-grabber resizes width through the extension's horizontal path.
   * The Y listener stays dormant until the pointer crosses its deliberately
   * large vertical deadzone; X keeps resizing throughout. We update the
   * EXISTING pill_position pref/CSS variable, not the panel
   * position pref. This keeps vertical grabber dragging a local pill-layout
   * operation and leaves panel geometry/positionPanel() untouched.
   * ------------------------------------------------------------------ */
  function clampPillPosition(value) {
    return Math.max(PILL_POSITION_MIN, Math.min(PILL_POSITION_MAX, value));
  }

  function getPillPosition() {
    const value = getPref(PILL_POSITION_PREF, 0);
    return typeof value === "number" && Number.isFinite(value)
      ? clampPillPosition(value)
      : 0;
  }

  function applyPillPosition(value) {
    document.documentElement.style.setProperty(
      "--bgalazka-pill-offset",
      // Keep fractional percentages during the gesture: rounding to a whole
      // percent moves a tall panel's pill in visible multi-pixel steps.
      clampPillPosition(value) + "%",
    );
  }

  function startPillPositionDrag(e, startY, startPosition) {
    const panelRoot = document.getElementById("zen-app-panel-root");
    if (!panelRoot) return;
    pillPosDragState = {
      startY,
      startPosition: clampPillPosition(startPosition),
      livePosition: clampPillPosition(startPosition),
    };
    document.documentElement.setAttribute("bgalazka-pill-pos-dragging", "true");
    document.addEventListener("mousemove", onPillPositionDrag);
    document.addEventListener("mouseup", stopPillPositionDrag);
    onPillPositionDrag(e);
  }

  function onPillPositionDrag(e) {
    if (!pillPosDragState) return;
    const panelRoot = document.getElementById("zen-app-panel-root");
    const panelHeight = panelRoot?.getBoundingClientRect().height || 0;
    if (panelHeight <= 0) return;
    const next = clampPillPosition(
      pillPosDragState.startPosition +
        ((e.clientY - pillPosDragState.startY) / panelHeight) * 100,
    );
    pillPosDragState.livePosition = next;
    applyPillPosition(next);
  }

  function stopPillPositionDrag() {
    document.removeEventListener("mousemove", onPillPositionDrag);
    document.removeEventListener("mouseup", stopPillPositionDrag);
    document.documentElement.removeAttribute("bgalazka-pill-pos-dragging");
    if (pillPosDragState)
      setPref(PILL_POSITION_PREF, Math.round(pillPosDragState.livePosition));
    pillPosDragState = null;
  }
  registerCleanup(() => {
    document.removeEventListener("mousemove", onPillPositionDrag);
    document.removeEventListener("mouseup", stopPillPositionDrag);
  });

  // Applies the user's saved top/bottom RESIZE extras (note 16) and the
  // whole-panel POSITION offset (note 18) as margins. Native Zentral remains
  // the sole owner of top/bottom, so its hot positionPanel()/RAF path can run
  // without this extension changing layout-affecting coordinates every frame.
  // Margins survive native top/bottom refreshes and only need updating when a
  // pref changes, a drag moves, or a newly-created panel root appears.
  //
  // IMPORTANT: this does NOT check EXT_PREFS.ALL_SIDES_RESIZE. The toggle
  // (settings row + pill button) only controls whether the RESIZE drag
  // surfaces are interactive/visible (that gating lives entirely in
  // chrome.css, keyed off the same "bgalazka-all-sides-resize" attribute)
  // -- it must NOT also decide whether an already-dragged size (or the
  // independent position offset, which isn't gated by this toggle AT ALL --
  // it has its own surface, the URL bar grip, see note 18) keeps being
  // applied, or every uncheck would snap the panel back to its natural
  // size/position, which defeats the point of a size/position the user
  // deliberately chose. startVerticalResize() below is the ONLY place that
  // gates on the toggle, since that's what actually needs to be prevented
  // while the resize surfaces are "off".
  function applyVerticalResizeExtras(root) {
    if (!root) return;

    // Dual/Triple View fills the content's usable height, respecting the
    // browser toolbar above it. Saved resize/position offsets return later.
    const dualViewActive =
      document.documentElement.getAttribute("bgalazka-push-page") === "true";
    const edgeAttachedPanels =
      document.documentElement.getAttribute("bgalazka-edge-attached-panels") ===
      "true";
    if (dualViewActive || edgeAttachedPanels) {
      let topMargin = "0px";
      let bottomMargin = "0px";
      if (dualViewActive) {
        const content = document.getElementById("tabbrowser-tabbox");
        const rect = content?.getBoundingClientRect();
        const nativeTop = parseFloat(root.style.top) || 12;
        const nativeBottom = parseFloat(root.style.bottom) || 12;
        let desiredTop =
          rect?.height > 0 ? Math.max(0, Math.round(rect.top)) : 0;
        const navbar = document.getElementById("zen-appcontent-navbar-wrapper");
        if (navbar) {
          const style = window.getComputedStyle(navbar);
          if (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            parseFloat(style.opacity || "1") > 0.1
          )
            desiredTop = Math.max(
              desiredTop,
              Math.round(navbar.getBoundingClientRect().bottom),
            );
        }
        const desiredBottom =
          rect?.height > 0
            ? Math.max(0, Math.round(window.innerHeight - rect.bottom))
            : 0;
        topMargin = Math.min(0, desiredTop - nativeTop) + "px";
        bottomMargin = desiredBottom - nativeBottom + "px";
      }
      if (root.style.marginTop !== topMargin) root.style.marginTop = topMargin;
      if (root.style.marginBottom !== bottomMargin)
        root.style.marginBottom = bottomMargin;
      return;
    }

    const { top: resizeTop, bottom: resizeBottom } = vResizeState
      ? { top: vResizeState.liveExtraTop, bottom: vResizeState.liveExtraBottom }
      : getVerticalExtras();
    const posOffset = vPosDragState
      ? vPosDragState.livePosOffset
      : getPositionOffset();
    // Positive posOffset moves the complete panel upward: the top margin
    // decreases while the bottom margin increases by the same amount.
    const marginTop = Math.round(resizeTop - posOffset) + "px";
    const marginBottom = Math.round(resizeBottom + posOffset) + "px";
    if (root.style.marginTop !== marginTop) root.style.marginTop = marginTop;
    if (root.style.marginBottom !== marginBottom)
      root.style.marginBottom = marginBottom;
  }
  registerCleanup(() => {
    const root = document.getElementById("zen-app-panel-root");
    if (!root) return;
    root.style.marginTop = "";
    root.style.marginBottom = "";
    root.style.marginLeft = "";
    root.style.marginRight = "";
  });

  // Mousedown handler for both the top and bottom edge strips (see
  // ensureVerticalResizeHandles() further below). `edge` is "top" or
  // "bottom". Mirrors native startResize()/onDrag()'s shape (snapshot on
  // mousedown, live style writes on mousemove, persist on mouseup) but for
  // the vertical axis, which the base mod has no equivalent of at all.
  function startVerticalResize(e, edge) {
    if (e.button !== 0) return;
    if (!getPref(EXT_PREFS.ALL_SIDES_RESIZE, false)) return;
    const root = document.getElementById("zen-app-panel-root");
    if (!root) return;
    extendHoverResizeHold();
    e.preventDefault();
    e.stopPropagation();

    const extras = getVerticalExtras();
    const posOffset = getPositionOffset();
    vResizeState = {
      edge,
      startY: e.clientY,
      naturalTop: parseFloat(root.style.top) || 0,
      naturalBottom: parseFloat(root.style.bottom) || 12,
      posOffset,
      startExtraTop: extras.top,
      startExtraBottom: extras.bottom,
      liveExtraTop: extras.top,
      liveExtraBottom: extras.bottom,
    };

    // Same reason as native startResize(): stop the <browser> underneath
    // from swallowing mousemove while dragging over it.
    const slider = document.getElementById("zen-app-panel-slider");
    if (slider) slider.style.pointerEvents = "none";
    document.documentElement.setAttribute("bgalazka-vresize-active", edge);
    document.addEventListener("mousemove", onVerticalResizeDrag);
    document.addEventListener("mouseup", stopVerticalResizeDrag);
  }

  function onVerticalResizeDrag(e) {
    if (!vResizeState) return;
    extendHoverResizeHold();
    const root = document.getElementById("zen-app-panel-root");
    if (!root) return;
    const diff = e.clientY - vResizeState.startY;

    // Dragging the TOP edge up (mouse moves up, diff < 0) should grow the
    // panel upward, i.e. shrink its top offset -- so the extra tracks diff
    // directly. Dragging the BOTTOM edge down (diff > 0) should grow the
    // panel downward, i.e. shrink its bottom offset -- so the extra tracks
    // the diff inverted. Only the dragged edge's extra changes per-drag.
    let extraTop = vResizeState.startExtraTop;
    let extraBottom = vResizeState.startExtraBottom;
    if (vResizeState.edge === "top") {
      extraTop = vResizeState.startExtraTop + diff;
    } else {
      extraBottom = vResizeState.startExtraBottom - diff;
    }

    let newTop = Math.max(
      0,
      vResizeState.naturalTop + extraTop - vResizeState.posOffset,
    );
    let newBottom = Math.max(
      0,
      vResizeState.naturalBottom + extraBottom + vResizeState.posOffset,
    );

    // Clamp so the two edges can never cross and eat the panel down to
    // nothing: if their combined offset would leave less than the minimum
    // height, pull back only the edge actually being dragged.
    const maxCombined = window.innerHeight - V_RESIZE_MIN_HEIGHT;
    if (newTop + newBottom > maxCombined) {
      if (vResizeState.edge === "top") {
        newTop = Math.max(0, maxCombined - newBottom);
      } else {
        newBottom = Math.max(0, maxCombined - newTop);
      }
    }

    vResizeState.liveExtraTop =
      newTop - vResizeState.naturalTop + vResizeState.posOffset;
    vResizeState.liveExtraBottom =
      newBottom - vResizeState.naturalBottom - vResizeState.posOffset;
    applyVerticalResizeExtras(root);
  }

  function stopVerticalResizeDrag() {
    document.removeEventListener("mousemove", onVerticalResizeDrag);
    document.removeEventListener("mouseup", stopVerticalResizeDrag);
    const slider = document.getElementById("zen-app-panel-slider");
    if (slider) slider.style.pointerEvents = "";
    document.documentElement.removeAttribute("bgalazka-vresize-active");
    if (vResizeState) {
      saveVerticalExtras(
        vResizeState.liveExtraTop,
        vResizeState.liveExtraBottom,
      );
    }
    vResizeState = null;
  }
  registerCleanup(() => {
    document.removeEventListener("mousemove", onVerticalResizeDrag);
    document.removeEventListener("mouseup", stopVerticalResizeDrag);
  });

  /* ------------------------------------------------------------------
   * HORIZONTAL INNER-EDGE / CORNER RESIZE (extension-only maintenance note):
   * Zentral exposes only its content-facing outer edge. We do not replace that
   * native listener. Instead the all-sides toggle enables an additive inner
   * edge and four corner handles. They use updateWidthVar(), the base mod's
   * public width writer, while choosing the inverse delta for the inner edge.
   * Keeping this independent avoids touching private Zentral state.
   * ------------------------------------------------------------------ */
  let hResizeState = null;
  let hResizeFrame = 0;

  function flushHorizontalResize() {
    hResizeFrame = 0;
    if (!hResizeState) return;
    const { apps, liveWidth, liveOffset, adjustsOffset } = hResizeState;
    apps.updateWidthVar(Math.round(liveWidth));
    if (adjustsOffset) {
      cachedHorizontalOffset = liveOffset;
      applyHorizontalPanelOffset(document.getElementById("zen-app-panel-root"));
    }
  }

  function startHorizontalResize(e, edge) {
    if (e.button !== 0) return;
    if (edge !== "pill" && !getPref(EXT_PREFS.ALL_SIDES_RESIZE, false)) return;
    const apps = window.Zentral?.Apps;
    const root = document.getElementById("zen-app-panel-root");
    if (!apps || !root || typeof apps.updateWidthVar !== "function") return;
    extendHoverResizeHold();
    e.preventDefault();
    e.stopPropagation();

    applyHorizontalPanelOffset(root);
    const rootRect = root.getBoundingClientRect();
    const handleRect = e.currentTarget?.getBoundingClientRect?.();
    const handleCenterX = handleRect
      ? handleRect.left + handleRect.width / 2
      : e.clientX;
    const physicalEdge =
      handleCenterX < rootRect.left + rootRect.width / 2 ? "left" : "right";
    const anchorSide = getHorizontalAnchorSide(root);
    const startOffset = getAppliedHorizontalOffset(root);

    hResizeState = {
      apps,
      edge,
      physicalEdge,
      anchorSide,
      startX: e.clientX,
      startWidth: rootRect.width,
      startLeft: rootRect.left,
      startRight: rootRect.right,
      startOffset,
      liveWidth: rootRect.width,
      liveOffset: startOffset,
      adjustsOffset: physicalEdge === anchorSide,
      maxWidth: Math.max(
        280,
        Math.min(
          getPref(EXT_PREFS.OPPOSITE_DOCKING, false) &&
            !apps.isPlacementVerticalBar?.()
            ? computeOppositeDockingSafeMaxWidth()
            : Math.max(280, Math.round(window.innerWidth * 0.8)),
          physicalEdge === "left"
            ? rootRect.right
            : window.innerWidth - rootRect.left,
        ),
      ),
    };
    apps.prepareResize?.();
    const slider = document.getElementById("zen-app-panel-slider");
    if (slider) slider.style.pointerEvents = "none";
    document.documentElement.setAttribute("bgalazka-hresize-active", edge);
    document.addEventListener("mousemove", onHorizontalResizeDrag);
    document.addEventListener("mouseup", stopHorizontalResizeDrag);
  }

  function onHorizontalResizeDrag(e) {
    if (!hResizeState) return;
    extendHoverResizeHold();
    const root = document.getElementById("zen-app-panel-root");
    if (!root) return;
    const {
      apps,
      physicalEdge,
      anchorSide,
      startX,
      startWidth,
      startLeft,
      startRight,
      startOffset,
    } = hResizeState;
    const maxWidth = hResizeState.maxWidth;
    const dx = e.clientX - startX;
    const unclampedWidth =
      physicalEdge === "left" ? startWidth - dx : startWidth + dx;
    const nextWidth = Math.max(280, Math.min(maxWidth, unclampedWidth));

    // Reconstruct the ACTUAL dragged edge after width clamping. This avoids a
    // position jump when the min/max width boundary is reached.
    const nextDraggedEdge =
      physicalEdge === "left" ? startRight - nextWidth : startLeft + nextWidth;
    const startDraggedEdge = physicalEdge === "left" ? startLeft : startRight;
    const edgeDelta = nextDraggedEdge - startDraggedEdge;
    let nextOffset = startOffset;

    // Width alone moves only the non-anchored edge. When the user grabs the
    // anchored edge, translate the panel by exactly the dragged-edge delta so
    // that edge follows the cursor and the opposite edge remains stationary.
    if (physicalEdge === anchorSide) nextOffset = startOffset + edgeDelta;

    hResizeState.liveWidth = nextWidth;
    hResizeState.liveOffset = nextOffset;
    // Pointer events may arrive faster than paints on a cold remote browser.
    // Write width and the anchored-side margin together once per frame.
    if (!hResizeFrame)
      hResizeFrame = requestAnimationFrame(flushHorizontalResize);
  }

  function stopHorizontalResizeDrag() {
    document.removeEventListener("mousemove", onHorizontalResizeDrag);
    document.removeEventListener("mouseup", stopHorizontalResizeDrag);
    const slider = document.getElementById("zen-app-panel-slider");
    if (slider) slider.style.pointerEvents = "";
    document.documentElement.removeAttribute("bgalazka-hresize-active");
    if (hResizeState) {
      if (hResizeFrame) cancelAnimationFrame(hResizeFrame);
      flushHorizontalResize(); // commit the final pointer even before a paint
      hResizeState.apps.saveWidth?.(Math.round(hResizeState.liveWidth));
      if (hResizeState.adjustsOffset) {
        cachedHorizontalOffset = Math.round(hResizeState.liveOffset);
        setPref(PANEL_HORIZONTAL_OFFSET_PREF, cachedHorizontalOffset);
      }
      hResizeState = null;
    }
  }
  registerCleanup(() => {
    if (hResizeFrame) cancelAnimationFrame(hResizeFrame);
    document.removeEventListener("mousemove", onHorizontalResizeDrag);
    document.removeEventListener("mouseup", stopHorizontalResizeDrag);
  });

  function startCornerResize(e, verticalEdge, horizontalEdge) {
    if (!getPref(EXT_PREFS.ALL_SIDES_RESIZE, false)) return;
    // Corners intentionally start BOTH axis engines from the same mousedown.
    // There is no dominant-axis decision: every mousemove can change width
    // and height at the same time.
    startVerticalResize(e, verticalEdge);
    startHorizontalResize(e, horizontalEdge);
  }

  /* ==========================================================================
   * PANEL 2D POSITION DRAG (URL bar grip) -- see note 18
   * -----------------------------------------------------------------------
   * Same "extra offset layered on top of the natural value, applied once
   * per positionPanel() call" trick as the resize extras above, but for a
   * REPOSITION instead of a resize: vertical movement changes the paired
   * top/bottom position offset while horizontal movement updates the existing
   * physical panel offset, so one small URL-bar grip moves the panel in 2D.
   * Vertical height stays constant -- see
   * applyVerticalResizeExtras() for where the two are actually summed.
   * NOT gated by EXT_PREFS.ALL_SIDES_RESIZE at all: this is a fully separate
   * feature/surface (the URL bar grip lives inside the web toolbar, and is
   * only ever visible when the toolbar + its URL bar are themselves
   * enabled -- see ensureWebToolbar()), not a 3rd resize edge.
   * ========================================================================== */
  function startPanelPositionDrag(e) {
    if (e.button !== 0) return;
    const root = document.getElementById("zen-app-panel-root");
    if (!root) return;
    e.preventDefault();
    e.stopPropagation();

    const { top: resizeTop, bottom: resizeBottom } = getVerticalExtras();
    const posOffset = getPositionOffset();
    // Normalize stale X state before taking a drag snapshot, then calculate
    // the only legal horizontal range from the actual viewport borders.
    applyHorizontalPanelOffset(root);
    const startHorizontalOffset = getAppliedHorizontalOffset(root);
    const horizontalBounds = getHorizontalOffsetBounds(root);
    // Base gaps include the resize margins but not the position offset.
    // Native top/bottom stay untouched throughout the drag.
    vPosDragState = {
      startX: e.clientX,
      startY: e.clientY,
      baseTop: (parseFloat(root.style.top) || 0) + resizeTop,
      baseBottom: (parseFloat(root.style.bottom) || 12) + resizeBottom,
      startPosOffset: posOffset,
      livePosOffset: posOffset,
      startHorizontalOffset,
      liveHorizontalOffset: startHorizontalOffset,
      minHorizontalOffset: horizontalBounds.min,
      maxHorizontalOffset: horizontalBounds.max,
    };

    const slider = document.getElementById("zen-app-panel-slider");
    if (slider) slider.style.pointerEvents = "none";
    document.documentElement.setAttribute(
      "bgalazka-panel-pos-dragging",
      "true",
    );
    document.addEventListener("mousemove", onPanelPositionDrag);
    document.addEventListener("mouseup", stopPanelPositionDrag);
  }

  function onPanelPositionDrag(e) {
    if (!vPosDragState) return;
    const root = document.getElementById("zen-app-panel-root");
    if (!root) return;
    const diffY = e.clientY - vPosDragState.startY;
    const diffX = e.clientX - vPosDragState.startX;
    // Mouse moved up (diffY < 0) -> panel should move up -> posOffset grows.
    let newPosOffset = vPosDragState.startPosOffset - diffY;
    // Clamp so the panel can never be dragged past either edge of the
    // viewport -- this alone keeps height perfectly constant too, since
    // newTop/newBottom below are each guaranteed >= 0 by construction.
    newPosOffset = Math.max(
      -vPosDragState.baseBottom,
      Math.min(vPosDragState.baseTop, newPosOffset),
    );
    vPosDragState.livePosOffset = newPosOffset;

    // The URL-bar grip is a true 2D move surface. Horizontal movement shares
    // the same viewport-derived bounds as every other whole-panel move path:
    // no arbitrary pixel cap, only keep both panel edges inside the window.
    const newHorizontalOffset = Math.max(
      vPosDragState.minHorizontalOffset,
      Math.min(
        vPosDragState.maxHorizontalOffset,
        vPosDragState.startHorizontalOffset + diffX,
      ),
    );
    vPosDragState.liveHorizontalOffset = newHorizontalOffset;
    cachedHorizontalOffset = newHorizontalOffset;

    applyVerticalResizeExtras(root);
    applyHorizontalPanelOffset(root);
  }

  function stopPanelPositionDrag() {
    document.removeEventListener("mousemove", onPanelPositionDrag);
    document.removeEventListener("mouseup", stopPanelPositionDrag);
    const slider = document.getElementById("zen-app-panel-slider");
    if (slider) slider.style.pointerEvents = "";
    document.documentElement.removeAttribute("bgalazka-panel-pos-dragging");
    if (vPosDragState) {
      savePositionOffset(vPosDragState.livePosOffset);
      cachedHorizontalOffset = Math.round(vPosDragState.liveHorizontalOffset);
      setPref(PANEL_HORIZONTAL_OFFSET_PREF, cachedHorizontalOffset);
    }
    vPosDragState = null;
  }
  registerCleanup(() => {
    document.removeEventListener("mousemove", onPanelPositionDrag);
    document.removeEventListener("mouseup", stopPanelPositionDrag);
  });

  /* ==========================================================================
   * GRABBER DUAL-AXIS DRAG (note 25): sideways uses the existing width path.
   * Past a large vertical deadzone, it adjusts the existing Pill Menu Vertical
   * Offset setting instead. This is deliberately a pill-only operation, not a
   * whole-panel reposition; the URL-bar grip remains the panel-position tool.
   * ========================================================================== */
  function ensurePillGrabberVerticalDrag() {
    const grabberBtn = document.querySelector(
      "#zen-app-panel-pill .zen-app-grabber",
    );
    if (!grabberBtn || grabberBtn._bgalazkaVDragHooked) return false;
    grabberBtn._bgalazkaVDragHooked = true;

    grabberBtn.title =
      "Drag sideways to resize • drag up/down to reposition the pill • diagonal does both";

    // A deliberate Y gesture must clear this threshold once. After it
    // activates there is no further threshold or axis lock; diagonal drags
    // continue resizing X while positioning the pill smoothly along Y.
    const VDRAG_DEADZONE_PX = 110;

    grabberBtn.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (!window.Zentral?.Apps) return;
      startHorizontalResize(e, "pill");
      // A fixed glass pane keeps mousemove/mouseup on chrome while crossing
      // remote content, and prevents releasing over another pill button.
      const shield = document.createElement("div");
      shield.className = "bgalazka-pill-drag-shield";
      document.documentElement.setAttribute(
        "bgalazka-pill-drag-feedback",
        "true",
      );
      // Inline important wins over the native and hover styles for the short
      // gesture, without changing the user's saved mini-pill preferences.
      const pill = document.getElementById("zen-app-panel-pill");
      const props = [
        "opacity",
        "background",
        "transform",
        "transform-origin",
        "pointer-events",
      ];
      const previous = props.map((prop) => [
        prop,
        pill?.style.getPropertyValue(prop) || "",
        pill?.style.getPropertyPriority(prop) || "",
      ]);
      const side = document
        .getElementById("zen-app-panel-root")
        ?.getAttribute("data-panel-side");
      const fromRight = side === "right";
      pill?.style.setProperty("opacity", ".8", "important");
      pill?.style.setProperty("background", "#dc143c", "important");
      pill?.style.setProperty(
        "transform",
        `translate(${fromRight ? "-100%" : "100%"}, -50%) scale(.32)`,
        "important",
      );
      pill?.style.setProperty(
        "transform-origin",
        fromRight ? "right center" : "left center",
        "important",
      );
      pill?.style.setProperty("pointer-events", "none", "important");
      document.documentElement.appendChild(shield);
      let moved = false;
      const cleanupShield = () => {
        shield.remove();
        document.documentElement.removeAttribute("bgalazka-pill-drag-feedback");
        for (const [prop, value, priority] of previous) {
          if (value) pill?.style.setProperty(prop, value, priority);
          else pill?.style.removeProperty(prop);
        }
        window.removeEventListener("mouseup", cleanupShield, true);
        window.removeEventListener("blur", cleanupShield);
        if (moved) {
          const blockClick = (event) => {
            if (event.target.closest?.("#zen-app-panel-pill")) {
              event.preventDefault();
              event.stopImmediatePropagation();
            }
            window.removeEventListener("click", blockClick, true);
          };
          window.addEventListener("click", blockClick, true);
          setTimeout(
            () => window.removeEventListener("click", blockClick, true),
            300,
          );
        }
      };
      window.addEventListener("mouseup", cleanupShield, true);
      window.addEventListener("blur", cleanupShield);

      const startY = e.clientY;
      let verticalStarted = false;

      const trackMove = (moveEvt) => {
        if (verticalStarted) return;
        const dy = moveEvt.clientY - startY;
        if (Math.abs(dy) > 4 || Math.abs(moveEvt.clientX - e.clientX) > 4)
          moved = true;
        if (Math.abs(dy) <= VDRAG_DEADZONE_PX) return;

        verticalStarted = true;
        document.removeEventListener("mousemove", trackMove);
        document.removeEventListener("mouseup", trackUp);

        // Preserve the small deadzone without cancelling native X resize.
        // From this point both document mousemove listeners run concurrently:
        // Zentral's native onDrag() changes width while our listener changes Y.
        const activationY = moveEvt.clientY;
        safeCall(
          () => startPillPositionDrag(moveEvt, activationY, getPillPosition()),
          "ensurePillGrabberVerticalDrag/startPillPositionDrag",
        );
      };
      const trackUp = () => {
        document.removeEventListener("mousemove", trackMove);
        document.removeEventListener("mouseup", trackUp);
      };
      document.addEventListener("mousemove", trackMove);
      document.addEventListener("mouseup", trackUp);
    });
    return true;
  }

  // Creates extension-owned all-sides handles once per panel root. CSS hides
  // the base outer strip completely: keeping two handlers on one edge was the
  // source of conflicting opposite-docking drag signs.
  function ensureVerticalResizeHandles() {
    const root = document.getElementById("zen-app-panel-root");
    if (!root) return false;
    applyVerticalResizeExtras(root);
    applyHorizontalPanelOffset(root);

    if (!root.querySelector(".zen-app-resize-strip-top")) {
      const topStrip = document.createElement("div");
      topStrip.className = "zen-app-resize-strip-top";
      topStrip.title = "Drag to resize (top)";
      topStrip.addEventListener("mousedown", (e) =>
        startVerticalResize(e, "top"),
      );
      root.appendChild(topStrip);
    }
    if (!root.querySelector(".zen-app-resize-strip-bottom")) {
      const bottomStrip = document.createElement("div");
      bottomStrip.className = "zen-app-resize-strip-bottom";
      bottomStrip.title = "Drag to resize (bottom)";
      bottomStrip.addEventListener("mousedown", (e) =>
        startVerticalResize(e, "bottom"),
      );
      root.appendChild(bottomStrip);
    }
    if (!root.querySelector(".zen-app-resize-strip-inner")) {
      const innerStrip = document.createElement("div");
      innerStrip.className = "zen-app-resize-strip-inner";
      innerStrip.title = "Drag to resize (inner edge)";
      innerStrip.addEventListener("mousedown", (e) =>
        startHorizontalResize(e, "inner"),
      );
      root.appendChild(innerStrip);
    }
    if (!root.querySelector(".zen-app-resize-strip-outer")) {
      const outerStrip = document.createElement("div");
      outerStrip.className = "zen-app-resize-strip-outer";
      outerStrip.title = "Drag to resize (outer edge)";
      outerStrip.addEventListener("mousedown", (e) =>
        startHorizontalResize(e, "outer"),
      );
      root.appendChild(outerStrip);
    }

    [
      ["top", "outer"],
      ["top", "inner"],
      ["bottom", "outer"],
      ["bottom", "inner"],
    ].forEach(([verticalEdge, horizontalEdge]) => {
      const className = `zen-app-resize-corner-${verticalEdge}-${horizontalEdge}`;
      if (root.querySelector(`.${className}`)) return;
      const corner = document.createElement("div");
      corner.className = `zen-app-resize-corner zen-app-resize-corner-${horizontalEdge} ${className}`;
      corner.title = `Drag to resize (${verticalEdge} ${horizontalEdge} corner)`;
      corner.addEventListener("mousedown", (e) =>
        startCornerResize(e, verticalEdge, horizontalEdge),
      );
      root.appendChild(corner);
    });
    return true;
  }

  /* ==========================================================================
   * 1. INSTANCE HOOKS: OPPOSITE DOCKING, RESIZE MATH & PIN STATE
   * -----------------------------------------------------------------------
   * CRITICAL FIX (see note 5 above): the previous version guarded this whole
   * block behind `typeof ZentralApps !== "undefined"`, which is ALWAYS false
   * because ZentralApps is not a global — so none of this ever ran, which is
   * why pinning never actually changed anything visually (data-pinned was
   * never mirrored onto the panel root) even though the translucency CSS
   * itself was correct. We patch the singleton instance (window.Zentral.Apps)
   * directly instead.
   * ========================================================================== */
  const patchAppsInstance = () => {
    const appsInstance = window.Zentral?.Apps;
    if (!appsInstance) return false;
    if (appsInstance._bgalazkaPatched) return true;
    appsInstance._bgalazkaPatched = true;

    // PERF (note 22, found via a Firefox Profiler capture): isPlacementVerticalBar()
    // is NATIVE (see its own definition earlier in this file) and reads
    // "zen.workspace.apps.sidebar.placement" via Services.prefs fresh on
    // EVERY call, with no caching of its own. A profile taken with the panel
    // closed, then open (animation janky), then closed again, on the same
    // profile, showed 1911 "Preference Read" events for exactly this one
    // pref inside the ~4.5s "panel open" window -- ~78% of every pref read
    // captured, and by far the dominant cost (note 21's fixes, by contrast,
    // show up as single-digit read counts each in the same capture -- real,
    // but minor next to this). The volume comes from the base mod's OWN
    // reposition()/triggerBurst() (see startPositionTracking(), a few
    // hundred lines above initBgalazkaExtension in this file) calling it
    // directly, one or more times per animation frame, for as long as the
    // panel stays open -- entirely inside the base mod's own code, which
    // this file does not otherwise touch, and which is presumably also why
    // a fresh profile (little ambient UI churn keeping that loop alive) and
    // vanilla mod (no extension patch adding its own extra calls into the
    // same loop, see below) never surfaced it.
    //
    // We can't edit that native call site, so instead we monkey-patch
    // isPlacementVerticalBar() ITSELF -- same override-by-replacement
    // technique already used just below for isPanelAttachedToRight and
    // positionPanel, and nothing here edits a standard-mod line; the
    // original implementation is still sitting untouched earlier in this
    // file, it's just no longer the one that runs once this extension
    // loads. Because every native method calls it as `this.isPlacementVerticalBar()`,
    // overriding the property on this one shared instance makes ALL
    // callers -- reposition()/triggerBurst() included, not just our own
    // two call sites below -- read the cached value instead of hitting
    // Services.prefs. The cache is kept correct via a
    // Services.prefs.addObserver on the same pref (fires only on an actual
    // write, never per frame).
    let cachedIsVerticalBar =
      getPref("zen.workspace.apps.sidebar.placement", "sidebar") ===
      "vertical-bar";
    {
      const placementObserver = () => {
        cachedIsVerticalBar =
          getPref("zen.workspace.apps.sidebar.placement", "sidebar") ===
          "vertical-bar";
      };
      try {
        Services.prefs.addObserver(
          "zen.workspace.apps.sidebar.placement",
          placementObserver,
          false,
        );
        registerCleanup(() => {
          try {
            Services.prefs.removeObserver(
              "zen.workspace.apps.sidebar.placement",
              placementObserver,
            );
          } catch (_) {}
        });
      } catch (_) {}
    }
    const origIsPlacementVerticalBar = appsInstance.isPlacementVerticalBar;
    appsInstance.isPlacementVerticalBar = () => cachedIsVerticalBar;

    // PERF (note 21): both isPanelAttachedToRight() and positionPanel() are
    // in the same per-animation-frame hot path described in the note-21
    // comment above getVerticalExtras() -- called by the base mod's own
    // reposition()/rafLoop on every transitionstart/run/end anywhere in the
    // window and every throttled mousemove, for as long as the panel stays
    // open. EXT_PREFS.OPPOSITE_DOCKING is already mirrored onto
    // documentElement's "bgalazka-opposite-docking" attribute by the
    // ATTR_MAP block above (kept live via a Services.prefs observer), so
    // reading that attribute here is a plain DOM read instead of a second
    // Services.prefs round-trip on every single frame.
    const isOppositeDockingCached = () =>
      document.documentElement.getAttribute("bgalazka-opposite-docking") ===
      "true";

    const origIsPanelAttachedToRight =
      appsInstance.isPanelAttachedToRight?.bind(appsInstance);
    appsInstance.isPanelAttachedToRight = function () {
      if (isOppositeDockingCached() && !this.isPlacementVerticalBar()) {
        return !this.isSidebarRight();
      }
      return origIsPanelAttachedToRight ? origIsPanelAttachedToRight() : false;
    };

    // Fix the off-screen ~1920px calculation bug when docked opposite (note 7).
    const origPositionPanel = appsInstance.positionPanel?.bind(appsInstance);
    appsInstance.positionPanel = function () {
      const root = document.getElementById("zen-app-panel-root");
      if (!isOppositeDockingCached() || this.isPlacementVerticalBar()) {
        const oldTop = root?.style.top;
        const oldBottom = root?.style.bottom;
        if (origPositionPanel) origPositionPanel();
        if (
          root &&
          document.documentElement.getAttribute("bgalazka-push-page") ===
            "true" &&
          (root.style.top !== oldTop || root.style.bottom !== oldBottom)
        )
          applyVerticalResizeExtras(root);
        if (root) root._bgalazkaLastSide = undefined;
        return;
      }
      if (!root) return;

      // Native positioning assumes sidebar-adjacent docking and overwrites
      // left/right on EVERY call. Running it before a cached correction lets
      // the second call send an opposite-docked panel off screen. Own only
      // this opt-in branch, retaining native's toolbar-clearance calculation
      // and writing geometry only when it changes (no native/extension fight).
      const gap = 12;
      let top = gap;
      const content =
        document.getElementById("tabbrowser-tabbox") ||
        document.getElementById("tabbrowser-tabpanels") ||
        window.gBrowser?.selectedBrowser ||
        document.getElementById("appcontent");
      const contentTop = content?.getBoundingClientRect().top;
      if (contentTop > 0 && contentTop < 200)
        top = Math.max(top, Math.round(contentTop));
      const navbar = document.getElementById("zen-appcontent-navbar-wrapper");
      if (navbar) {
        const style = window.getComputedStyle(navbar);
        if (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          parseFloat(style.opacity || "1") > 0.1
        ) {
          const rect = navbar.getBoundingClientRect();
          if (rect.height > 0 && rect.bottom > 0 && rect.bottom < 200)
            top = Math.max(top, Math.round(rect.bottom));
        }
      }
      const dockOnRight = !this.isSidebarRight();
      const side = dockOnRight ? "right" : "left";
      const sideChanged = root._bgalazkaLastSide !== side;
      root._bgalazkaLastSide = side;
      const geometry = {
        top: top + "px",
        bottom: gap + "px",
        transform: "translateX(0)",
        left: dockOnRight ? "auto" : gap + "px",
        right: dockOnRight ? gap + "px" : "auto",
      };
      const verticalChanged =
        root.style.top !== geometry.top ||
        root.style.bottom !== geometry.bottom;
      for (const [key, value] of Object.entries(geometry)) {
        if (root.style[key] !== value) root.style[key] = value;
      }
      if (
        verticalChanged &&
        document.documentElement.getAttribute("bgalazka-push-page") === "true"
      )
        applyVerticalResizeExtras(root);
      if (root.getAttribute("data-panel-side") !== side)
        root.setAttribute("data-panel-side", side);
      if (sideChanged) applyHorizontalPanelOffset(root);
    };

    // Mirror data-pinned onto #zen-app-panel-root so the translucency CSS (which
    // is keyed off the root, not the pin button) actually reacts to pin state.
    const origTogglePin = appsInstance.togglePin?.bind(appsInstance);
    appsInstance.togglePin = function () {
      if (origTogglePin) origTogglePin();
      const root = document.getElementById("zen-app-panel-root");
      const pinBtn = document.querySelector(
        "#zen-app-panel-pill .zen-app-btn[data-pinned]",
      );
      if (root && pinBtn) {
        if (pinBtn.getAttribute("data-pinned") === "true")
          root.setAttribute("data-pinned", "true");
        else root.removeAttribute("data-pinned");
      }
    };

    const origOpenPanel = appsInstance.openPanel?.bind(appsInstance);
    appsInstance.openPanel = function (app) {
      if (origOpenPanel) origOpenPanel(app);
      const openedRoot = document.getElementById("zen-app-panel-root");
      openedRoot?.removeAttribute("data-pinned");
      applyVerticalResizeExtras(openedRoot);
      applyHorizontalPanelOffset(openedRoot);

      // Defensive: a width saved while opposite-docking was off (or before
      // a window/sidebar resize) could already exceed the current safe
      // bound the moment the panel opens, pushing the pill off-screen
      // without the user ever touching expand or the resize strip. Clamp
      // it down here too, same helper as toggleExpand/onDrag above.
      if (
        getPref(EXT_PREFS.OPPOSITE_DOCKING, false) &&
        !this.isPlacementVerticalBar?.()
      ) {
        const root = document.getElementById("zen-app-panel-root");
        const safeMax = computeOppositeDockingSafeMaxWidth();
        if (
          root &&
          root.getBoundingClientRect().width > safeMax &&
          typeof this.updateWidthVar === "function"
        ) {
          this.updateWidthVar(safeMax);
        }
      }
    };

    const origRenderGrid = appsInstance.renderGrid?.bind(appsInstance);
    appsInstance.renderGrid = function () {
      // Zero is below the native Apps Number Cap UI's minimum of one. Feed
      // it only to this synchronous renderer, never save it as a native pref:
      // slice(0, 0) creates no standalone tiles and the Add button is skipped.
      // The existing essential-panel rescue still applies when this is off.
      const hideUnattached = getPref(
        EXT_PREFS.HIDE_UNATTACHED_APP_CONTROLS,
        false,
      );
      const core = window.Zentral?.Core;
      const get = core?.getPref;
      let saved = [];
      if (!hideUnattached) {
        try {
          saved = JSON.parse(getPref("zen.workspace.apps.sidebar.apps", "[]"));
        } catch (_) {}
      }
      const rescued =
        Array.isArray(saved) &&
        saved.some((app) => app.id?.startsWith("bgalazka-essential-"));
      try {
        if ((hideUnattached || rescued) && typeof get === "function")
          core.getPref = function (key, ...args) {
            if (key !== "zen.workspace.apps.sidebar.max_apps")
              return get.call(this, key, ...args);
            if (hideUnattached) return 0;
            return Math.max(
              Number(get.call(this, key, ...args)) || 0,
              saved.length,
            );
          };
        if (origRenderGrid) origRenderGrid();
      } finally {
        if ((hideUnattached || rescued) && get) core.getPref = get;
      }
      requestTileSync(60);
    };

    // Changes from Settings or about:config refresh the grid once; the pref
    // observer runs on writes, not during rendering or animation frames.
    const unattachedControlsObserver = () => appsInstance.renderGrid();
    Services.prefs.addObserver(
      EXT_PREFS.HIDE_UNATTACHED_APP_CONTROLS,
      unattachedControlsObserver,
    );
    registerCleanup(() =>
      Services.prefs.removeObserver(
        EXT_PREFS.HIDE_UNATTACHED_APP_CONTROLS,
        unattachedControlsObserver,
      ),
    );

    /* ------------------------------------------------------------------
     * BUG FIX: "Expand / Restore" panel button did nothing useful (or
     * shrank the panel to its minimum width), and after an initial fix,
     * pushed the pill off the edge of the screen, whenever Opposite-Side
     * Docking was active.
     *
     * Root cause (part 1): native toggleExpand()'s full-width math (see
     * note 7 for the same category of bug in positionPanel) measures the
     * gap between the panel and gBrowser.tabContainer (the sidebar) and
     * assumes the panel is docked directly adjacent to it:
     *   targetRight = innerWidth - tcRect.left + gap   (attached-right case)
     * That's correct for NATIVE docking, where the panel sits right next
     * to the sidebar. But our positionPanel() override (above) docks the
     * panel against the OPPOSITE viewport edge instead when opposite
     * docking is on, entirely ignoring tcRect. So native toggleExpand()
     * computes a huge bogus targetRight (~window width, since tcRect.left
     * is near 0 when the sidebar is on the left) and the resulting
     * fullWidth goes negative, getting clamped down to MIN_WIDTH_PX — the
     * panel "expands" to its smallest possible size instead of growing.
     *
     * Root cause (part 2, found after the first fix): the pill sits
     * translate(-100%)/translate(100%) OUTSIDE the panel's own edge (see
     * chrome.css section 2), i.e. further out past whichever edge faces
     * the sidebar. A width calculation that only reserves room for the
     * sidebar itself (and not the pill's own footprint beyond the panel's
     * edge) can grow the panel wide enough that the pill's reserved space
     * runs past the screen edge entirely. computeOppositeDockingSafeMaxWidth()
     * (above) now accounts for both.
     *
     * Fix: let the native method run first (it still correctly flips
     * isExpanded and updates the button icon/title via our patched
     * isPanelAttachedToRight() above), then — only when we just grew the
     * panel (isExpanded, detected from the button's own title text since
     * #state is a private class field we cannot read from outside the
     * class, see note 5) and opposite docking applies — recompute the
     * correct full width ourselves and overwrite it via updateWidthVar(),
     * a public method safe to call again. The "restore to previous width"
     * branch needs no fix: it just replays a previously-saved pixel width
     * and never depended on docking side.
     * ------------------------------------------------------------------ */
    const origToggleExpand = appsInstance.toggleExpand?.bind(appsInstance);
    appsInstance.toggleExpand = function () {
      if (origToggleExpand) origToggleExpand();
      if (
        !getPref(EXT_PREFS.OPPOSITE_DOCKING, false) ||
        this.isPlacementVerticalBar?.()
      )
        return;

      const pill = document.getElementById("zen-app-panel-pill");
      const justExpanded = !!pill?.querySelector(
        '.zen-app-btn[title="Restore panel"]',
      );
      if (!justExpanded) return; // this call collapsed the panel, nothing to fix

      if (typeof this.updateWidthVar === "function")
        this.updateWidthVar(computeOppositeDockingSafeMaxWidth());
    };

    /* ------------------------------------------------------------------
     * BUG FIX: dragging the panel's resize strip in opposite-docking mode
     * felt "jumpy"/messy at wide widths. Root cause: native onDrag() clamps
     * the dragged width against a flat `window.innerWidth *
     * Constants.Apps.MAX_WIDTH_RATIO` (80% of the full window, see line 86)
     * with no idea the panel is docked away from the sidebar in this mode —
     * the exact same blind spot as toggleExpand() above, just for a
     * continuous drag instead of a one-shot button. That let the user drag
     * the panel wide enough to overlap the sidebar and push the pill off
     * the edge of the screen before the (much larger, and therefore
     * effectively irrelevant) native clamp ever kicked in, which is what
     * felt like a sudden "jump" once it finally did.
     *
     * Fix: same wrap-then-correct approach as toggleExpand — let native
     * onDrag() run first (it handles the isExpanded/#state bookkeeping we
     * can't reach), then clamp the width it just set down to the real safe
     * maximum every single drag frame, so resistance is felt smoothly right
     * at the true boundary instead of far past it.
     * ------------------------------------------------------------------ */
    const origOnDrag = appsInstance.onDrag?.bind(appsInstance);
    const origStartResize = appsInstance.startResize?.bind(appsInstance);
    if (origStartResize)
      appsInstance.startResize = function (e) {
        if (e?.button === 0) extendHoverResizeHold();
        return origStartResize(e);
      };
    appsInstance.onDrag = function (e) {
      extendHoverResizeHold();
      // Native onDrag() must see the already-patched
      // isPanelAttachedToRight() unchanged. That patch is the original
      // Opposite-Side resize-direction fix and is also used by the pill
      // grabber. Flipping it again here double-inverts the native drag.
      if (origOnDrag) origOnDrag(e);
      if (
        !getPref(EXT_PREFS.OPPOSITE_DOCKING, false) ||
        this.isPlacementVerticalBar?.()
      )
        return;

      const root = document.getElementById("zen-app-panel-root");
      if (!root) return;
      const safeMax = computeOppositeDockingSafeMaxWidth();
      const currentWidth =
        this._startW +
        (this.isPanelAttachedToRight()
          ? this._startX - e.clientX
          : e.clientX - this._startX);
      if (currentWidth > safeMax && typeof this.updateWidthVar === "function")
        this.updateWidthVar(safeMax);
    };

    /* ------------------------------------------------------------------
     * BUG FIX: right-clicking content inside the Apps floating panel and
     * clicking a context-menu item (e.g. "Copy") closed the panel and
     * silently ate the command; the keyboard shortcut (Ctrl+C) kept
     * working because it never goes through this code path at all.
     *
     * Root cause: native handleOutsideClick() is a window-level "mousedown"
     * listener that closes the panel unless the click's composedPath()
     * contains #zen-app-panel-root (or a short allow-list of other Zen UI
     * containers). Firefox renders a <browser>'s native context menu
     * (#contentAreaContextMenu) as a XUL <menupopup> appended to
     * #mainPopupSet, a sibling far outside #zen-app-panel-root in the DOM
     * — so clicking any item in that menu is, from handleOutsideClick's
     * point of view, indistinguishable from clicking outside the panel.
     * It closes the panel out from under the still-pending menu command,
     * which is what breaks "Copy" (and every other context-menu action).
     *
     * Fix: we can't just reassign appsInstance.handleOutsideClick and walk
     * away — setupObservers() (which runs during the base mod's deferred
     * Init(), i.e. possibly AFTER this patch runs) captures whatever
     * function value was current at the time it calls addEventListener,
     * so a later reassignment alone wouldn't reach an already-registered
     * listener, and doing nothing risks setupObservers() re-adding the
     * original later even if we did swap it live. So we cover both
     * timings at once: grab the original bound function reference (the
     * exact one setupObservers() would use or already used),
     * unconditionally remove it from window (a harmless no-op if it was
     * never added yet) and add our wrapper in its place, AND reassign the
     * instance property — so whichever of "already attached" or "not yet
     * attached" turns out to be true, only our wrapper ends up listening.
     * ------------------------------------------------------------------ */
    const origHandleOutsideClick = appsInstance.handleOutsideClick;
    let wrappedHandleOutsideClick = null;
    if (typeof origHandleOutsideClick === "function") {
      wrappedHandleOutsideClick = function (e) {
        // A split view stays open while the user interacts with the webpage.
        // Triple View must still do this when its page-push option is off.
        const splitViewKeepsPanelOpen =
          (document.documentElement.getAttribute("bgalazka-push-page") ===
            "true" ||
            document.documentElement.getAttribute("bgalazka-triple-view") ===
              "true") &&
          document.getElementById("zen-app-panel-root")?.hasAttribute("open");
        if (splitViewKeepsPanelOpen) return;

        const path = e.composedPath ? e.composedPath() : [];
        const insideOpenPopup = path.some(
          (el) =>
            el &&
            el.nodeType === 1 &&
            (el.tagName === "menupopup" ||
              el.tagName === "panel" ||
              el.id === "mainPopupSet" ||
              el.id === "contentAreaContextMenu"),
        );
        if (insideOpenPopup) return;
        return origHandleOutsideClick(e);
      };
      window.removeEventListener("mousedown", origHandleOutsideClick);
      window.addEventListener("mousedown", wrappedHandleOutsideClick);
      appsInstance.handleOutsideClick = wrappedHandleOutsideClick;
    }

    registerCleanup(() => {
      appsInstance.isPlacementVerticalBar = origIsPlacementVerticalBar;
      if (origIsPanelAttachedToRight)
        appsInstance.isPanelAttachedToRight = origIsPanelAttachedToRight;
      if (origPositionPanel) appsInstance.positionPanel = origPositionPanel;
      if (origTogglePin) appsInstance.togglePin = origTogglePin;
      if (origOpenPanel) appsInstance.openPanel = origOpenPanel;
      if (origRenderGrid) appsInstance.renderGrid = origRenderGrid;
      if (origToggleExpand) appsInstance.toggleExpand = origToggleExpand;
      if (origOnDrag) appsInstance.onDrag = origOnDrag;
      if (origStartResize) appsInstance.startResize = origStartResize;
      if (wrappedHandleOutsideClick) {
        window.removeEventListener("mousedown", wrappedHandleOutsideClick);
        appsInstance.handleOutsideClick = origHandleOutsideClick;
        // Base Destroy may have run first; never reattach a dead instance.
        if (window.Zentral?.Apps === appsInstance)
          window.addEventListener("mousedown", origHandleOutsideClick);
      }
      appsInstance._bgalazkaPatched = false;
    });

    return true;
  };

  // window.Zentral.Apps is assigned synchronously when the base script parses (before
  // Zentral.Init() itself, which may be deferred until browser-delayed-startup-finished),
  // but retry briefly just in case script load order ever changes.
  if (!safeCall(patchAppsInstance, "patchAppsInstance")) {
    let attempts = 0;
    const retryTimer = setInterval(() => {
      attempts++;
      if (safeCall(patchAppsInstance, "patchAppsInstance") || attempts > 40)
        clearInterval(retryTimer);
    }, 150);
    registerCleanup(() => clearInterval(retryTimer));
  }
  /* ==========================================================================
   * 2. TAB CLICK ISOLATION (note 6)
   * -----------------------------------------------------------------------
   * Middle-click unload and loaded/unloaded tile state are NOT handled here
   * anymore (note 10) — the base mod now does both natively and correctly.
   * We only need to stop mouse interaction on a docked tile from activating,
   * closing, or otherwise operating on the essential tab underneath it.
   *
   * IMPORTANT: LMB activation happens from the mouse-button sequence before
   * the tile's click handler runs. Therefore mousedown must be intercepted
   * during the window capture phase and default-prevented so the essential
   * tab cannot select itself. The tile's own click handler is intentionally
   * left untouched so it can still open the web panel.
   *
   * click/auxclick are isolated when they bubble through the tile. This
   * allows clicks on its icon descendants to reach the tile's own listener
   * before stopping propagation to the containing tab.
   *
   * No MutationObserver is used on the tabstrip or documentElement.
   * ========================================================================== */
  const isolatedTiles = new Map();

  // Capture only the small audio badge. Run before the essential tab/MMB
  // guards so muting cannot select, open, drag or unload the containing tab.
  const tileAudioEvents = [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "auxclick",
    "dblclick",
    "dragstart",
    "keydown",
    "keyup",
  ];
  const onTileAudioInput = (event) => {
    const badge = event.target.closest?.(".bgalazka-tile-audio");
    const tile = badge?.closest?.(".zen-app-tile[data-app-id]");
    if (!tile || !getPref(EXT_PREFS.AUDIO_INDICATOR, false)) return;
    const keyboard = event.type === "keydown" || event.type === "keyup";
    if (keyboard && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (
      (event.type === "click" && event.button === 0) ||
      (event.type === "keydown" && !event.repeat)
    ) {
      const browser = getAllAppBrowsers().find(
        (b) => b._bgalazkaAppId === tile.dataset.appId,
      );
      togglePanelAudio(browser);
    }
  };
  tileAudioEvents.forEach((type) =>
    window.addEventListener(type, onTileAudioInput, true),
  );
  registerCleanup(() =>
    tileAudioEvents.forEach((type) =>
      window.removeEventListener(type, onTileAudioInput, true),
    ),
  );

  const getTileFromEvent = (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return null;

    const tile = target.closest(".zen-app-tile[data-app-id]");
    if (!tile || !tile.closest(".tabbrowser-tab")) return null;

    return tile;
  };

  const tileMouseDownIsolationHandler = (e) => {
    const tile = getTileFromEvent(e);
    if (!tile) return;

    /*
     * Essential/pinned tabs can react to mousedown before the tile's
     * click handler opens the panel. Prevent the browser's tab-selection
     * default action and stop the event before it reaches the tab.
     *
     * The tile's own mousedown handler is not required for normal corner
     * button activation; the native middle-click unload is handled by the
     * later auxclick listener on the tile.
     */
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  window.addEventListener("pointerdown", tileMouseDownIsolationHandler, true);
  window.addEventListener("mousedown", tileMouseDownIsolationHandler, true);

  const isolateTile = (tile) => {
    if (!(tile instanceof Element)) return;
    if (!tile.matches(".zen-app-tile[data-app-id]")) return;
    if (isolatedTiles.has(tile)) return;

    const clickIsolationHandler = (e) => {
      if (!tile.closest(".tabbrowser-tab")) return;
      e.stopPropagation();
    };

    const auxClickIsolationHandler = (e) => {
      if (!tile.closest(".tabbrowser-tab")) return;
      e.stopPropagation();
    };

    // A capture stop on the tile swallows clicks on its icon descendants.
    // Bubble isolation preserves the native handler; window down/MMB guards
    // already protect the containing tab before it can act on those presses.
    tile.addEventListener("click", clickIsolationHandler);
    tile.addEventListener("auxclick", auxClickIsolationHandler);

    isolatedTiles.set(tile, {
      click: clickIsolationHandler,
      auxclick: auxClickIsolationHandler,
    });
  };

  const pruneIsolationTiles = () => {
    // Grid renders replace tiles; release detached nodes and their closures.
    isolatedTiles.forEach((handlers, tile) => {
      if (tile.isConnected) return;
      tile.removeEventListener("click", handlers.click);
      tile.removeEventListener("auxclick", handlers.auxclick);
      isolatedTiles.delete(tile);
    });
  };
  const scanIsolationTiles = (root = document) => {
    pruneIsolationTiles();
    if (root instanceof Element) isolateTile(root);
    root.querySelectorAll?.(".zen-app-tile[data-app-id]").forEach(isolateTile);
  };

  scanIsolationTiles();

  const tileIsolationObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;

        if (node.matches(".zen-app-tile[data-app-id]")) {
          isolateTile(node);
        }

        node
          .querySelectorAll?.(".zen-app-tile[data-app-id]")
          .forEach(isolateTile);
      });
    });
    // Added subtrees were scanned above. Badge/content mutations do not
    // require another query across the entire browser document.
    pruneIsolationTiles();
  });

  const appsGrid = document.getElementById("zen-apps-sidebar-grid");
  if (appsGrid) {
    tileIsolationObserver.observe(appsGrid, {
      childList: true,
      subtree: true,
    });
  }

  registerCleanup(() => {
    window.removeEventListener(
      "pointerdown",
      tileMouseDownIsolationHandler,
      true,
    );
    window.removeEventListener(
      "mousedown",
      tileMouseDownIsolationHandler,
      true,
    );

    isolatedTiles.forEach((handlers, tile) => {
      tile.removeEventListener("click", handlers.click);
      tile.removeEventListener("auxclick", handlers.auxclick);
    });

    isolatedTiles.clear();
    tileIsolationObserver.disconnect();
  });
  /* ==========================================================================
   * 3. CORNER TILES DOM SYNCHRONIZATION (SAFE & CRASH-PROOF, STABLE DOCKING)
   * ========================================================================== */
  let isSyncingTiles = false;

  // Global root-level capture guard:
  // Intercepts MMB at the window level BEFORE Zen's tabContainer or .tabbrowser-tab
  // can capture it, preventing the underlying essential tab from hibernating/unloading.
  const mmbEvents = [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
    "auxclick",
  ];
  let lastUnloadTime = 0;

  const onWindowMMBCapture = (e) => {
    // STRICT: Only intercept Middle Mouse Button (button === 1).
    // LMB (button 0) and RMB (button 2) pass straight through untouched.
    if (e.button !== 1) return;

    const target = e.target;
    if (!target) return;

    // Check if the click target is a corner-docked tile on a tab
    const tile = target.closest?.(".zen-app-tile");
    if (!tile) return;

    const parentTab = tile.closest(".tabbrowser-tab");
    if (!parentTab) return; // In sidebar grid, let base mod handle it

    // Terminate event propagation at the root so the tab never sees it
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Trigger app unload on button release
    if (e.type === "auxclick" || e.type === "mouseup") {
      const now = Date.now();
      if (now - lastUnloadTime < 250) return;
      lastUnloadTime = now;

      const appId = tile.getAttribute("data-app-id");
      if (appId) {
        try {
          if (typeof window.Zentral?.Apps?.closeApp === "function") {
            window.Zentral.Apps.closeApp(appId);
          } else if (typeof window.ZenApps?.closeApp === "function") {
            window.ZenApps.closeApp(appId);
          }
        } catch (_) {}

        tile.dataset.loaded = "false";
        tile.dataset.active = "false";
        tile.querySelector(".zen-app-badge")?.remove();
      }
    }
  };

  mmbEvents.forEach((type) => {
    window.addEventListener(type, onWindowMMBCapture, { capture: true });
  });

  registerCleanup(() => {
    mmbEvents.forEach((type) => {
      window.removeEventListener(type, onWindowMMBCapture, { capture: true });
    });
  });

  // Essential duplicates have their own app identity/browser, but all panel
  // UI and behavior comes from Zentral's existing panel engine. Never move a
  // normal grid tile or create a second panel implementation.
  const essentialPanels = new Map();
  const essentialTabRecords = new WeakMap();
  // Pair identities belong to the extension, not to the lifetime of a browser.
  const linkedTriplePref = "zen.workspace.bgalazka.linked_triple_pairs";
  let linkedTriplePairs = [];
  try {
    const saved = JSON.parse(getPref(linkedTriplePref, "[]"));
    if (Array.isArray(saved))
      linkedTriplePairs = saved.filter(
        (pair) =>
          pair &&
          typeof pair.top === "string" &&
          typeof pair.bottom === "string" &&
          pair.top !== pair.bottom &&
          pair.apps &&
          pair.apps[pair.top] &&
          pair.apps[pair.bottom],
      );
  } catch (_) {}
  const linkedPairFor = (id) =>
    linkedTriplePairs.find((pair) => pair.top === id || pair.bottom === id);
  function saveLinkedTriplePairs() {
    Services.prefs.setStringPref(
      linkedTriplePref,
      JSON.stringify(linkedTriplePairs),
    );
  }
  function unlinkTriplePair(id) {
    const pair = linkedPairFor(id);
    if (!pair) return;
    linkedTriplePairs = linkedTriplePairs.filter((item) => item !== pair);
    saveLinkedTriplePairs();
  }
  function normalPanelIdExists(id) {
    try {
      const apps = JSON.parse(getPref("zen.workspace.apps.sidebar.apps", "[]"));
      return Array.isArray(apps) && apps.some((app) => app.id === id);
    } catch (_) {
      return false;
    }
  }

  // Essentials are separate app objects. Zentral's normal badge updater looks
  // for a grid button, so title changes in a preloaded panel never reach the
  // corner tile even though the site's background page received them.
  const essentialBadgeApps = window.Zentral?.Apps;
  const originalEssentialBadgeUpdater = essentialBadgeApps?.updateAppBadge;
  if (typeof originalEssentialBadgeUpdater === "function") {
    const updateBadge = function (appId, hasNotification, notifCount) {
      const result = originalEssentialBadgeUpdater.call(
        this,
        appId,
        hasNotification,
        notifCount,
      );
      const tile = essentialPanels.get(appId)?.tile;
      if (!tile?.isConnected) return result;
      let badge = tile.querySelector(".zen-app-badge");
      if (!hasNotification) {
        badge?.remove();
        return result;
      }
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "zen-app-badge";
        tile.appendChild(badge);
      }
      if (notifCount) {
        badge.textContent = notifCount > 99 ? "99+" : String(notifCount);
        badge.removeAttribute("data-dot");
      } else {
        badge.textContent = "";
        badge.setAttribute("data-dot", "true");
      }
      return result;
    };
    essentialBadgeApps.updateAppBadge = updateBadge;
    registerCleanup(() => {
      if (essentialBadgeApps.updateAppBadge === updateBadge)
        essentialBadgeApps.updateAppBadge = originalEssentialBadgeUpdater;
    });
  }

  function syncEssentialBadge(record, browser) {
    const apps = window.Zentral?.Apps;
    if (
      !record.tile?.isConnected ||
      !apps?.extractBadgeFromTitle ||
      !apps?.updateAppBadge
    )
      return;
    let title = "";
    if (browser?.isConnected) {
      try {
        title =
          browser.browsingContext?.currentWindowGlobal?.documentTitle ||
          browser.contentTitle ||
          browser.getAttribute("label") ||
          "";
      } catch (_) {
        title = browser.contentTitle || browser.getAttribute("label") || "";
      }
    }
    // A new browser briefly has no title. Keep the last badge until the
    // first page title arrives; clear it if its browser was actually closed.
    if (!title && browser?.isConnected) return;
    const { hasNotification, notifCount } = apps.extractBadgeFromTitle(title);
    const badge = record.tile.querySelector(".zen-app-badge");
    if (
      record.app.hasNotification !== hasNotification ||
      record.app.notificationCount !== notifCount ||
      !!badge !== hasNotification
    ) {
      record.app.hasNotification = hasNotification;
      record.app.notificationCount = notifCount;
      apps.updateAppBadge(record.app.id, hasNotification, notifCount);
    }
  }
  let nextEssentialId = 0;
  const essentialIdPrefix = `bgalazka-essential-${Date.now()}-`;

  const essentialSettingsCache = new WeakMap();
  function essentialSessionStore() {
    if (window.SessionStore) return window.SessionStore;
    for (const uri of [
      "resource:///modules/sessionstore/SessionStore.sys.mjs",
      "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
    ]) {
      try {
        return ChromeUtils.importESModule(uri).SessionStore;
      } catch (_) {}
    }
    return null;
  }
  function readEssentialSettings(tab) {
    if (essentialSettingsCache.has(tab)) return essentialSettingsCache.get(tab);
    try {
      const raw = essentialSessionStore()?.getCustomTabValue(
        tab,
        "bgalazka-panel-settings",
      );
      const restored =
        raw ||
        (() => {
          try {
            const state = JSON.parse(
              essentialSessionStore()?.getTabState(tab) || "{}",
            );
            return state.extData?.["bgalazka-panel-settings"] || "";
          } catch (_) {
            return "";
          }
        })();
      const value = restored ? JSON.parse(restored) : {};
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    } catch (_) {
      return {};
    }
  }
  function saveEssentialSettings(record) {
    const value = {
      panelId: record.app.id,
      preload: !!record.app.preload,
      mobileUa: !!record.mobileUa,
      userContextId: record.userContextId,
      width: record.app.width,
    };
    essentialSettingsCache.set(record.tab, value);
    try {
      essentialSessionStore()?.setCustomTabValue(
        record.tab,
        "bgalazka-panel-settings",
        JSON.stringify(value),
      );
    } catch (error) {
      console.warn(
        "[BgalazkaExtension] Could not persist essential panel settings",
        error,
      );
    }
  }
  function loadEssentialInBackground(record) {
    const apps = window.Zentral?.Apps;
    if (!apps?.getOrCreateAppBrowser) return false;
    const { browser, isNew } = apps.getOrCreateAppBrowser(record.app) || {};
    if (!browser) return false;
    if (isNew || browser.currentURI?.spec === "about:blank") {
      browser.style.display = "none";
      // This opt-in preload is meant to receive site notifications even
      // before the Essential tab itself is selected or restored.
      try {
        browser.docShellIsActive = true;
      } catch (_) {}
      const uri = Services.io.newURI(record.app.url);
      browser.fixupAndLoadURIString(record.app.url, {
        triggeringPrincipal:
          Services.scriptSecurityManager.createContentPrincipal(uri, {
            userContextId: record.userContextId,
          }),
      });
      record.loadedSource = record.app.url;
      setTimeout(() => {
        if (
          !record.tab.isConnected ||
          !browser.isConnected ||
          browser.currentURI?.spec !== "about:blank" ||
          browser.webProgress?.isLoadingDocument
        )
          return;
        try {
          browser.fixupAndLoadURIString(record.app.url, {
            triggeringPrincipal:
              Services.scriptSecurityManager.createContentPrincipal(
                Services.io.newURI(record.app.url),
                {
                  userContextId: record.userContextId,
                },
              ),
          });
        } catch (error) {
          console.warn(
            "[BgalazkaExtension] Essential preload retry failed",
            error,
          );
        }
      }, 3000);
    }
    return true;
  }
  function promoteEssentialPanel(record) {
    const browser = getAllAppBrowsers().find(
      (b) => b._bgalazkaAppId === record.app.id,
    );
    // A linked launcher must survive its tab even if Smart Sleep never
    // instantiated its browser. Promotion itself does not trigger a load.
    if (!browser && !linkedPairFor(record.app.id)) return false;
    const apps = window.Zentral?.Apps;
    // Keep the same app id: Zentral's private browser map, active panel,
    // browsing history, mute, pin and in-page form state all stay intact.
    apps.saveApps();
    const saved = JSON.parse(getPref("zen.workspace.apps.sidebar.apps", "[]"));
    if (!Array.isArray(saved)) throw new Error("Invalid normal panel list");
    const app = {
      ...record.app,
      url:
        browser?.currentURI?.spec !== "about:blank"
          ? browser?.currentURI?.spec || record.app.url
          : record.app.url,
      workspaceId: "all",
    };
    if (!saved.some((item) => item.id === app.id)) saved.push(app);
    const assignments = getPanelContainerAssignments();
    if (record.userContextId > 0) assignments[app.id] = record.userContextId;
    savePanelContainerAssignments(assignments);
    const mobileIds = getMobileUaAppIds();
    if (record.mobileUa) mobileIds.add(app.id);
    else mobileIds.delete(app.id);
    saveMobileUaAppIds(mobileIds);
    // Do not use the best-effort preference helper here: a failed save must
    // throw so sync retains the live browser and retries instead of losing it.
    Services.prefs.setStringPref(
      "zen.workspace.apps.sidebar.apps",
      JSON.stringify(saved),
    );
    apps.loadApps();
    apps.renderGrid();
    return true;
  }

  function getEssentialSource(tab) {
    const url = tab.linkedBrowser?.currentURI?.spec;
    return url && /^(https?|about):/i.test(url) && url !== "about:blank"
      ? url
      : null;
  }

  function getRestoredEssentialSource(tab) {
    const live = getEssentialSource(tab);
    if (live) return live;
    try {
      const state = JSON.parse(
        essentialSessionStore()?.getTabState(tab) || "{}",
      );
      const entry = state.entries?.[Math.max(0, (state.index || 1) - 1)];
      const url = entry?.url;
      return url && /^(https?|about):/i.test(url) && url !== "about:blank"
        ? url
        : null;
    } catch (_) {
      return null;
    }
  }
  function openEssentialPanel(record) {
    const apps = window.Zentral?.Apps;
    if (!apps?.openPanel || !record.tab.isConnected) return;
    const root = document.getElementById("zen-app-panel-root");
    if (
      root?.hasAttribute("open") &&
      !root.hasAttribute("closing") &&
      getActiveAppBrowser()?._bgalazkaAppId === record.app.id
    ) {
      apps.closePanel();
      return;
    }
    const source = getEssentialSource(record.tab);
    const existing = getAllAppBrowsers().find(
      (b) => b._bgalazkaAppId === record.app.id,
    );
    if (!existing && source) record.app.url = source;
    if (!record.app.url) return;
    apps.openPanel(record.app);
    if (!existing) record.loadedSource = record.app.url;
    syncCornerTiles();
  }

  function isEssentialPanelTab(tab) {
    // Pinned is not synonymous with Essential. Zen marks essentials explicitly.
    return (
      tab.hasAttribute("zen-essential") &&
      tab.getAttribute("zen-essential") !== "false"
    );
  }
  function releaseTabPanelLauncher(record) {
    record.tile?.remove();
    record.iconHost?.classList.remove("bgalazka-panel-icon-host");
    record.tab.removeAttribute("bgalazka-tab-panel-launcher");
  }

  function syncCornerTiles() {
    if (isSyncingTiles) return;
    isSyncingTiles = true;
    try {
      const enabled = getPref(EXT_PREFS.CORNER_TILES, false);
      const targets = new Set(
        enabled
          ? [...(window.gBrowser?.tabs || [])].filter(
              (tab) =>
                tab.isConnected &&
                !tab.closing &&
                !tab.hasAttribute("bgalazka-addon-host") &&
                !tab.hasAttribute("bgalazka-addon-host-fallback") &&
                !tab.closest(
                  "#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']",
                ) &&
                (isEssentialPanelTab(tab) ||
                  getPref(EXT_PREFS.ALL_TAB_PANELS, false)),
            )
          : [],
      );
      for (const [id, record] of essentialPanels) {
        if (targets.has(record.tab)) continue;
        const removed =
          record.tab.closing ||
          !(window.gBrowser?.tabs || []).includes(record.tab) ||
          (record.wasEssential && !isEssentialPanelTab(record.tab));
        try {
          if (!removed || !promoteEssentialPanel(record))
            window.Zentral?.Apps?.closeApp?.(id);
        } catch (error) {
          // Never destroy a live page when saving its new normal-panel entry fails.
          console.error(
            "[BgalazkaExtension] Could not preserve removed essential panel",
            error,
          );
          continue;
        }
        releaseTabPanelLauncher(record);
        essentialTabRecords.delete(record.tab);
        essentialPanels.delete(id);
      }
      const browsers = new Map(
        getAllAppBrowsers().map((b) => [b._bgalazkaAppId, b]),
      );
      const root = document.getElementById("zen-app-panel-root");
      const active =
        root?.hasAttribute("open") && !root.hasAttribute("closing")
          ? getActiveAppBrowser()?._bgalazkaAppId
          : null;
      for (const tab of targets) {
        let record = essentialTabRecords.get(tab);
        if (!record) {
          const source = getRestoredEssentialSource(tab);
          if (!source) continue; // wait until SessionStore has supplied its URL
          const settings = readEssentialSettings(tab);
          const savedId = settings.panelId;
          const stableId =
            typeof savedId === "string" &&
            /^bgalazka-essential-[\w-]+$/.test(savedId) &&
            !essentialPanels.has(savedId) &&
            !normalPanelIdExists(savedId)
              ? savedId
              : essentialIdPrefix + ++nextEssentialId;
          const app = {
            preload: settings.preload === true,
            width:
              Number.isFinite(settings.width) && settings.width > 0
                ? settings.width
                : undefined,
            id: stableId,
            url: source,
            title: tab.label || source,
            workspaceId: "all",
          };
          record = {
            tab,
            app,
            tile: null,
            loadedSource: null,
            preloadAttempted: false,
            mobileUa: settings.mobileUa === true,
            userContextId:
              Number.isInteger(settings.userContextId) &&
              settings.userContextId >= 0
                ? settings.userContextId
                : Number(
                    tab.getAttribute("usercontextid") ||
                      tab.linkedBrowser?.getAttribute("usercontextid"),
                  ) || 0,
          };
          essentialTabRecords.set(tab, record);
          essentialPanels.set(app.id, record);
          if (settings.panelId !== stableId) saveEssentialSettings(record);
        }
        if (record.app.preload && !record.preloadAttempted) {
          try {
            record.preloadAttempted = loadEssentialInBackground(record);
          } catch (error) {
            // Keep it eligible for the next sync after startup settles.
            console.warn("[BgalazkaExtension] Essential preload failed", error);
          }
        }
        const essential = isEssentialPanelTab(tab);
        record.wasEssential = essential;
        const iconHost = !essential
          ? tab.querySelector(".tab-icon-stack")
          : null;
        if (record.iconHost !== iconHost) {
          record.iconHost?.classList.remove("bgalazka-panel-icon-host");
          record.iconHost = iconHost;
        }
        iconHost?.classList.add("bgalazka-panel-icon-host");
        if (!essential) tab.setAttribute("bgalazka-tab-panel-launcher", "true");
        else tab.removeAttribute("bgalazka-tab-panel-launcher");
        // Essential themes can tint the tab stack. Keep its panel button on
        // the tab itself so only the tab's own filter (such as Arc unload
        // grayscale) reaches it, not a stack-specific color treatment.
        const host = iconHost || tab;
        if (!record.tile?.isConnected || record.tile.parentNode !== host) {
          record.tile?.remove();
          const tile = document.createElement("button");
          tile.type = "button";
          tile.className = "zen-app-tile bgalazka-essential-tile";
          tile.dataset.appId = record.app.id;
          tile.appendChild(document.createElement("img"));
          tile.addEventListener("click", (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            openEssentialPanel(record);
          });
          tile.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const popup = document.getElementById(
              "zen-apps-sidebar-tile-context",
            );
            if (popup) {
              popup.dataset.activeAppId = record.app.id;
              popup.openPopupAtScreen(event.screenX, event.screenY, true);
            }
          });
          host.appendChild(tile);
          record.tile = tile;
          isolateTile(tile);
        }
        record.app.title = tab.label || record.app.url;
        record.app.icon =
          gBrowser?.getIcon?.(tab) ||
          tab.getAttribute("image") ||
          `page-icon:${record.app.url}`;
        const tile = record.tile;
        tile.classList.toggle("bgalazka-tab-icon-panel", !essential);
        const icon = tile.querySelector("img");
        if (icon.getAttribute("src") !== record.app.icon)
          icon.setAttribute("src", record.app.icon);
        const tabLoaded =
          !tab.hasAttribute("pending") &&
          (!tab.hasAttribute("zen-dormant") ||
            tab.getAttribute("zen-dormant") === "false") &&
          !tab.hasAttribute("discarded") &&
          !!tab.linkedBrowser?.isConnected &&
          !!tab.linkedBrowser?.browsingContext;
        const panelBrowser = browsers.get(record.app.id);
        const panelLoaded = !!panelBrowser?.isConnected;
        const title = `${record.app.title} — tab ${tabLoaded ? "loaded" : "unloaded"}; panel ${panelLoaded ? "loaded" : "unloaded"}. Click to toggle panel; middle-click to unload panel.`;
        if (tile.title !== title) {
          tile.title = title;
          tile.setAttribute("aria-label", title);
        }
        tile.dataset.active =
          active === record.app.id ||
          !!browsers
            .get(record.app.id)
            ?.hasAttribute("data-bgalazka-triple-slot")
            ? "true"
            : "false";
        tile.dataset.loaded = panelLoaded ? "true" : "false";
        if (record.app.preload && panelBrowser?.isConnected) {
          // Preload may start before its remote browsingContext exists. The
          // existing two-second tile sync also reasserts activation if Gecko
          // resets this standalone browser while it remains in the background.
          try {
            panelBrowser.docShellIsActive = true;
          } catch (_) {}
        }
        syncEssentialBadge(record, panelBrowser);
        tile.dataset.tabLoaded = tabLoaded ? "true" : "false";
      }
      pruneIsolationTiles();
    } finally {
      isSyncingTiles = false;
    }
  }
  registerCleanup(() => {
    for (const [id, record] of essentialPanels) {
      window.Zentral?.Apps?.closeApp?.(id);
      releaseTabPanelLauncher(record);
    }
    essentialPanels.clear();
  });

  let syncTimer = null;
  function requestTileSync(delay = 120) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(syncCornerTiles, delay);
  }
  registerCleanup(() => {
    if (syncTimer) clearTimeout(syncTimer);
  });
  /* ==========================================================================
   * 4. SETTINGS UI INJECTION (DOM-SAFE XHTML BUILDER)
   * ========================================================================== */
  const BGALAZKA_EXT_PREFS = {
    TRANSLUCENCY: "zen.workspace.bgalazka.translucency",
    OPPOSITE_DOCKING: "zen.workspace.bgalazka.opposite_docking",
    HOVER_REVEAL_PANEL: "zen.workspace.bgalazka.hover_reveal_panel",
    HIDE_HOVER_REVEAL_BTN: "zen.workspace.bgalazka.hide_hover_reveal_btn",
    EDGE_ATTACHED_PANELS: "zen.workspace.bgalazka.edge_attached_panels",
    PUSH_PAGE: "zen.workspace.bgalazka.push_page",
    TRIPLE_PUSH_PAGE: "zen.workspace.bgalazka.triple_push_page",
    TAB_ISOLATION: "zen.workspace.bgalazka.tab_isolation",
    CORNER_TILES: "zen.workspace.bgalazka.corner_tiles",
    ALL_TAB_PANELS: "zen.workspace.bgalazka.all_tab_panels",
    HOVER_CORNER_TILES: "zen.workspace.bgalazka.hover_corner_tiles",
    HIDE_CORNER_BADGES: "zen.workspace.bgalazka.hide_corner_badges",
    HIDE_PILL: "zen.workspace.bgalazka.hide_pill",
    HIDE_UNATTACHED_APP_CONTROLS:
      "zen.workspace.bgalazka.hide_unattached_app_controls",
    // Numeric percent offset from vertical center, -50 (near top) to +50
    // (near bottom), 0 = centered. Was previously a "top"|"center"|"bottom"
    // string enum; changed to a continuous slider per user request. A
    // leftover string value from that old enum, if still on disk, is NOT
    // harmless on its own (getPref() returns it as-is, matching whatever
    // type Firefox's prefs system has it stored as -- see getPref() above --
    // it does not detect or coerce type mismatches against a caller's
    // expectations). Both call sites that read this pref now defend against
    // that themselves (updateCSSVars() coerces to a clamped number; see its
    // comment), and the one-time migration near "Initial attribute sync"
    // clears a leftover string off disk entirely so this pref can't keep
    // producing surprises at any future read site.
    PILL_POSITION: "zen.workspace.bgalazka.pill_position",
    // Whether the opposite-docking pill stays visible as a tiny "peek dot"
    // while idle (true), or fully disappears like classic autohide (false).
    PILL_PEEK_DOT: "zen.workspace.bgalazka.pill_peek_dot",
    // Background color (hex) used only for the idle peek-dot state, so it
    // stands out from whatever page content is behind it regardless of the
    // panel's own theme color.
    PILL_PEEK_DOT_COLOR: "zen.workspace.bgalazka.pill_peek_dot_color",
    // Opacity (0-100) of the shrunk "mini pill" while idle. Stored as a
    // whole-number percent, same convention as PILL_POSITION.
    PILL_PEEK_DOT_OPACITY: "zen.workspace.bgalazka.pill_peek_dot_opacity",
    // Opacity (0-100) of the EXPANDED pill's black background. Kept
    // independent from the mini-pill opacity so the idle marker and opened
    // controls can be tuned separately.
    PILL_BACKGROUND_OPACITY: "zen.workspace.bgalazka.pill_background_opacity",
    // Web Panel Navigation Toolbar: back/forward/reload + URL bar (+ optional
    // zoom controls) docked at the bottom of the floating app panel.
    WEB_TOOLBAR_ENABLED: "zen.workspace.bgalazka.web_toolbar_enabled",
    WEB_TOOLBAR_AUTOHIDE: "zen.workspace.bgalazka.web_toolbar_autohide",
    WEB_TOOLBAR_URLBAR: "zen.workspace.bgalazka.web_toolbar_urlbar",
    WEB_TOOLBAR_ZOOM: "zen.workspace.bgalazka.web_toolbar_zoom",
    // Which template the URL bar uses when the typed text isn't a URL (see
    // looksLikeUrl()/buildSearchUrl() below). "ddg"/"startpage" are built-in
    // templates; "browser" mirrors Firefox's own default search engine
    // (refreshed lazily, see refreshBrowserSearchTemplate()); "custom" reads
    // WEB_TOOLBAR_SEARCH_CUSTOM_URL instead.
    WEB_TOOLBAR_SEARCH_ENGINE:
      "zen.workspace.bgalazka.web_toolbar_search_engine",
    // User-supplied template containing a literal "%s" placeholder, e.g.
    // "https://example.com/search?q=%s". Only read when the mode above is
    // "custom".
    WEB_TOOLBAR_SEARCH_CUSTOM_URL:
      "zen.workspace.bgalazka.web_toolbar_search_custom_url",
    // Master toggle for the quick-switch button (see ensureWebToolbar()).
    // Its selectable built-in/custom target list is stored under the
    // QUICK_SWITCH_* pref prefixes declared beside the search templates.
    WEB_TOOLBAR_QUICKSWITCH: "zen.workspace.bgalazka.web_toolbar_quickswitch",
    // Dock the toolbar at the top of the web panel instead of the bottom.
    WEB_TOOLBAR_TOP: "zen.workspace.bgalazka.web_toolbar_top",
    HIDE_DUAL_VIEW: "zen.workspace.bgalazka.hide_dual_view",
    HIDE_PIN: "zen.workspace.bgalazka.hide_pin",
    HIDE_EXPAND: "zen.workspace.bgalazka.hide_expand",
    HIDE_GRABBER: "zen.workspace.bgalazka.hide_grabber",
    HIDE_REFRESH: "zen.workspace.bgalazka.hide_refresh",
    HIDE_CLOSE: "zen.workspace.bgalazka.hide_close",
    OPACITY_UNPINNED: "zen.workspace.bgalazka.opacity_unpinned",
    OPACITY_PINNED_FOCUS: "zen.workspace.bgalazka.opacity_pinned_focus",
    OPACITY_PINNED_BLUR: "zen.workspace.bgalazka.opacity_pinned_blur",
    // Master toggle for dragging the panel's TOP/BOTTOM edges to resize its
    // height (see note 16). Off by default: it's a new interactive drag
    // surface layered over the top/bottom edges of the floating panel, and
    // should be an explicit opt-in rather than silently changing existing
    // hover behavior near those edges.
    ALL_SIDES_RESIZE: "zen.workspace.bgalazka.all_sides_resize",
    // Positive moves the full panel toward the physical right; bounded in
    // applyHorizontalPanelOffset() so a stale/out-of-range pref is harmless.
    PANEL_HORIZONTAL_OFFSET: PANEL_HORIZONTAL_OFFSET_PREF,
    // "Hide button" toggle for the pill button above, same convention as
    // HIDE_DUAL_VIEW/HIDE_PIN/HIDE_EXPAND/etc. -- deliberately a SEPARATE
    // pref from ALL_SIDES_RESIZE itself: this only hides the pill icon,
    // it does not disable the feature (the settings-panel row still works
    // when the pill button is hidden, same as every other hide-toggle).
    HIDE_ALL_SIDES_RESIZE_BTN:
      "zen.workspace.bgalazka.hide_all_sides_resize_btn",
    // Opt-in input barrier for open app panels. CSS makes the panel root/clip
    // explicit pointer hit-test targets so transparent/focused panels cannot
    // leak ordinary clicks to the page behind them. The JS half below also
    // traps mouse Back/Forward buttons (3/4) over the panel and routes them
    // to the visible app browser instead of the main selected browser.
    PANEL_INPUT_SHIELD: "zen.workspace.bgalazka.panel_input_shield",
    // Opt-in Firefox WebExtension compatibility: use a real pinned Firefox
    // tab's linkedBrowser as the Zentral panel browser so the panel owns a
    // genuine tabId. See architecture note 27 and the bridge implementation.
    ADDON_TAB_ID_BRIDGE: "zen.workspace.bgalazka.addon_tab_id_bridge",
    SHOW_ADDON_HOST_FOLDER: "zen.workspace.bgalazka.show_addon_host_folder",
    ZEN_INTERNET_PANEL_CSS: "zen.workspace.bgalazka.zen_internet_panel_css",
    SHOW_TRIPLE_STYLE_REPAIR: "zen.workspace.bgalazka.show_triple_style_repair",
    PERIODIC_FALLBACK_POLLING:
      "zen.workspace.bgalazka.periodic_fallback_polling",
    SMART_SLEEP: "zen.workspace.bgalazka.smart_sleep",
    AUDIO_INDICATOR: "zen.workspace.bgalazka.audio_indicator",
    // Keep the settings-side preference table complete. The previous build
    // omitted these keys here even though EXT_PREFS defined them earlier,
    // which made the master keybind toggle write to an undefined pref and
    // appear to reset as soon as Settings resynchronized.
    KEYBINDS_ENABLED: "zen.workspace.bgalazka.keybinds_enabled",
    MMB_UNLOAD_NORMAL_TABS: "zen.workspace.bgalazka.mmb_unload_normal_tabs",
    KEYBIND_CLOSE_PANEL: "zen.workspace.bgalazka.keybind.close_panel",
    KEYBIND_BACK: "zen.workspace.bgalazka.keybind.back",
    KEYBIND_FORWARD: "zen.workspace.bgalazka.keybind.forward",
    KEYBIND_RELOAD: "zen.workspace.bgalazka.keybind.reload",
    KEYBIND_FOCUS_URL: "zen.workspace.bgalazka.keybind.focus_url",
    KEYBIND_TOGGLE_PIN: "zen.workspace.bgalazka.keybind.toggle_pin",
    KEYBIND_TOGGLE_EXPAND: "zen.workspace.bgalazka.keybind.toggle_expand",
    KEYBIND_TOGGLE_DUAL_VIEW: "zen.workspace.bgalazka.keybind.toggle_dual_view",
    KEYBIND_TOGGLE_RESIZE: "zen.workspace.bgalazka.keybind.toggle_resize",
    KEYBIND_TOGGLE_TOOLBAR: "zen.workspace.bgalazka.keybind.toggle_toolbar",
    KEYBIND_TOGGLE_TRANSLUCENCY:
      "zen.workspace.bgalazka.keybind.toggle_translucency",
    KEYBIND_TOGGLE_OPPOSITE_DOCKING:
      "zen.workspace.bgalazka.keybind.toggle_opposite_docking",
    KEYBIND_TOGGLE_EDGE_ATTACHED:
      "zen.workspace.bgalazka.keybind.toggle_edge_attached",
    KEYBIND_TOGGLE_INPUT_SHIELD:
      "zen.workspace.bgalazka.keybind.toggle_input_shield",
    KEYBIND_ZOOM_IN: "zen.workspace.bgalazka.keybind.zoom_in",
    KEYBIND_ZOOM_OUT: "zen.workspace.bgalazka.keybind.zoom_out",
    KEYBIND_ZOOM_RESET: "zen.workspace.bgalazka.keybind.zoom_reset",
    KEYBIND_OPEN_SETTINGS: "zen.workspace.bgalazka.keybind.open_settings",
  };
  if (typeof EXT_PREFS !== "undefined") {
    Object.assign(EXT_PREFS, BGALAZKA_EXT_PREFS);
  }

  // Keybinds intentionally depend on the panel input shield. Without it,
  // browser-level shortcuts/buttons can still escape the focused app panel
  // and act on the main tab behind it. This is one-way: enabling keybinds
  // turns the shield on, but disabling keybinds never turns the shield off.
  function ensureInputShieldForKeybinds() {
    if (!getPref(BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED, false)) return;
    if (!getPref(BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, false)) {
      setPref(BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, true);
    }
    document.documentElement.setAttribute(
      "bgalazka-panel-input-shield",
      "true",
    );
  }
  ensureInputShieldForKeybinds();

  /* ==========================================================================
   * NORMAL TAB MIDDLE-CLICK UNLOAD
   * -----------------------------------------------------------------------
   * Optional replacement for Zen/Firefox's native MMB-close behavior on
   * ordinary, loaded tabs. Already-unloaded tabs are deliberately NOT
   * intercepted, so their native MMB action still closes them. Corner app
   * tiles are excluded because they have their own MMB unload behavior.
   * ========================================================================== */
  const normalTabMmbEvents = [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
    "auxclick",
  ];
  let normalTabMmbGesture = null;
  let normalTabMmbFallbackTimer = null;

  function getNormalTabFromMiddleClickEvent(event) {
    const target = event?.target;
    if (!target?.closest) return null;
    if (target.closest(".zen-app-tile")) return null;
    const tab = target.closest(".tabbrowser-tab");
    if (
      !tab?.isConnected ||
      tab.closing ||
      tab.hidden ||
      tab.pinned ||
      tab.hasAttribute("zen-essential") ||
      tab.hasAttribute("zen-empty-tab") ||
      tab.hasAttribute("bgalazka-addon-host") ||
      tab.hasAttribute("bgalazka-addon-host-fallback") ||
      tab.closest(
        "#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']",
      )
    ) {
      return null;
    }
    return tab;
  }

  function isNormalTabAlreadyUnloaded(tab) {
    return !!(
      !tab?.linkedPanel ||
      tab.hasAttribute("pending") ||
      tab.hasAttribute("discarded") ||
      (tab.hasAttribute("zen-dormant") &&
        tab.getAttribute("zen-dormant") !== "false")
    );
  }

  function ensureSafeSuccessorBeforeNormalTabUnload(tab) {
    if (gBrowser.selectedTab !== tab) return true;

    try {
      // Mirror Zen's pinned/Essential unload path whenever real-tab-backed
      // Zentral web-panel hosts exist: blur away from the selected tab BEFORE
      // explicitUnloadTabs() is allowed to run. Native Zen does the same with
      // _findTabToBlurTo() for selected pinned/Essential tabs.
      //
      // The important Zentral-specific addition is that a panel host is never
      // a valid blur target. If Zen's native successor finder returns one, or
      // cannot find a usable successor, fall back to Zen's own invisible
      // zen-empty-tab via selectEmptyTab(). This prevents a reparented panel
      // browser from ever becoming the selected tab during the discard race.
      if (!isAddonTabIdBridgeEnabled() || addonHostByAppId.size === 0) {
        return true;
      }

      let successor = null;
      if (typeof gBrowser._findTabToBlurTo === "function") {
        try {
          successor = gBrowser._findTabToBlurTo(tab, [tab]);
        } catch (_) {}
      }

      if (
        successor &&
        successor !== tab &&
        isUsableNormalTab(successor) &&
        !isAddonHostTab(successor)
      ) {
        gBrowser.selectedTab = successor;
        if (
          gBrowser.selectedTab === successor &&
          !isAddonHostTab(gBrowser.selectedTab)
        ) {
          lastNonAddonHostTab = successor;
          return true;
        }
      }

      const safeTab = createNormalTabForAddonHost();
      return !!(
        safeTab?.isConnected &&
        gBrowser.selectedTab === safeTab &&
        gBrowser.selectedTab !== tab &&
        !isAddonHostTab(gBrowser.selectedTab)
      );
    } catch (error) {
      console.warn(
        "[BgalazkaExtension] Could not prepare a safe successor before unloading a selected normal tab:",
        error,
      );
      // With panel hosts present, abort rather than let native successor
      // selection choose a reparented host browser.
      return false;
    }
  }

  async function unloadNormalTabFromMiddleClick(tab) {
    if (!tab?.isConnected || tab.closing || isNormalTabAlreadyUnloaded(tab)) {
      return;
    }

    try {
      if (!ensureSafeSuccessorBeforeNormalTabUnload(tab)) return;

      // Match Zen's Essential behavior: selected tabs have already been moved
      // to a verified non-host successor above, so explicitUnloadTabs() never
      // has to choose between ordinary tabs and Zentral's hidden host tabs.
      if (typeof gBrowser.explicitUnloadTabs === "function") {
        await gBrowser.explicitUnloadTabs([tab]);
        if (isAddonTabIdBridgeEnabled() && addonHostByAppId.size > 0) {
          repairAddonHostSelectionAfterTransition(tab);
        }
        return;
      }

      // Compatibility fallback for builds that predate explicitUnloadTabs().
      // discardBrowser() cannot discard the selected tab, so move selection
      // first when necessary.
      if (gBrowser.selectedTab === tab) {
        const replacement = Array.from(gBrowser.tabs || []).find(
          (candidate) =>
            candidate !== tab &&
            candidate?.isConnected &&
            !candidate.closing &&
            !candidate.hidden &&
            !isAddonHostTab(candidate) &&
            !!candidate.linkedPanel,
        );
        if (replacement) {
          gBrowser.selectedTab = replacement;
        } else if (typeof gBrowser.addTrustedTab === "function") {
          gBrowser.selectedTab = gBrowser.addTrustedTab("about:newtab", {
            skipAnimation: true,
          });
        }
      }

      if (gBrowser.selectedTab === tab) return;
      if (typeof gBrowser.prepareDiscardBrowser === "function") {
        await gBrowser.prepareDiscardBrowser(tab);
      }
      gBrowser.discardBrowser?.(tab, true);
      if (isAddonTabIdBridgeEnabled() && addonHostByAppId.size > 0) {
        repairAddonHostSelectionAfterTransition(tab);
      }
    } catch (_) {}
  }

  function clearNormalTabMmbGesture(tab = null) {
    if (tab && normalTabMmbGesture?.tab !== tab) return;
    if (normalTabMmbFallbackTimer) {
      window.clearTimeout(normalTabMmbFallbackTimer);
      normalTabMmbFallbackTimer = null;
    }
    normalTabMmbGesture = null;
  }

  function onNormalTabMMBCapture(event) {
    if (event.button !== 1) return;
    if (!getPref(EXT_PREFS.MMB_UNLOAD_NORMAL_TABS, false)) {
      clearNormalTabMmbGesture();
      return;
    }

    const tab = getNormalTabFromMiddleClickEvent(event);
    if (!tab) return;

    // A fresh MMB gesture only gets captured for a loaded normal tab. If the
    // tab is already unloaded, do nothing here and let Zen's native MMB close
    // behavior run exactly as before.
    if (normalTabMmbGesture?.tab !== tab) {
      if (isNormalTabAlreadyUnloaded(tab)) return;
      if (tab.linkedBrowser && tab.linkedBrowser.isRemoteBrowser === false) {
        return;
      }
      clearNormalTabMmbGesture();
      normalTabMmbGesture = { tab, unloadTriggered: false };
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const gesture = normalTabMmbGesture;
    if (!gesture || gesture.tab !== tab) return;

    if (event.type === "auxclick") {
      if (!gesture.unloadTriggered) {
        gesture.unloadTriggered = true;
        void unloadNormalTabFromMiddleClick(tab);
      }
      clearNormalTabMmbGesture(tab);
      return;
    }

    if (event.type === "mouseup" && !gesture.unloadTriggered) {
      // Some Zen builds perform their MMB tab action on mouseup. Keep the
      // gesture captured through the following auxclick so a tab that becomes
      // unloaded here cannot immediately receive the native close action.
      gesture.unloadTriggered = true;
      void unloadNormalTabFromMiddleClick(tab);
      normalTabMmbFallbackTimer = window.setTimeout(
        () => clearNormalTabMmbGesture(tab),
        500,
      );
    }
  }

  normalTabMmbEvents.forEach((type) =>
    window.addEventListener(type, onNormalTabMMBCapture, true),
  );
  registerCleanup(() => {
    normalTabMmbEvents.forEach((type) =>
      window.removeEventListener(type, onNormalTabMMBCapture, true),
    );
    clearNormalTabMmbGesture();
  });

  /* ==========================================================================
   * PANEL INPUT SHIELD
   * -----------------------------------------------------------------------
   * CSS is the ordinary click-through barrier. Gecko's extra mouse buttons
   * (button 3/4 = Back/Forward) are different: they are chrome-level browser
   * navigation inputs, and an app <browser> is not gBrowser.selectedBrowser.
   * Without interception, pressing them over the focused app panel can act on
   * the main tab behind it. This opt-in handler consumes only buttons 3/4 and
   * routes one navigation action to the currently visible app browser.
   * LMB/MMB/RMB and normal page controls remain untouched.
   * ========================================================================== */
  const PANEL_INPUT_SHIELD_EVENTS = [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "auxclick",
  ];

  function getVisiblePanelBrowser() {
    const panel = document.getElementById("zen-app-panel-slider");
    if (!panel) return null;
    return (
      Array.from(panel.querySelectorAll("browser"))
        .reverse()
        .find((browser) => {
          if (!browser.isConnected) return false;
          if (browser.hidden || browser.getAttribute("hidden") === "true")
            return false;
          return browser.style?.display !== "none";
        }) || null
    );
  }

  function navigateVisiblePanelBrowser(button) {
    const browser = getVisiblePanelBrowser();
    if (!browser) return;
    try {
      if (button === 3) {
        const canGoBack =
          typeof browser.canGoBack === "boolean"
            ? browser.canGoBack
            : browser.webNavigation?.canGoBack;
        if (canGoBack === false && !canPanelNavigate(browser, -1)) return;
        navigatePanelHistory(browser, -1);
      } else if (button === 4) {
        const canGoForward =
          typeof browser.canGoForward === "boolean"
            ? browser.canGoForward
            : browser.webNavigation?.canGoForward;
        if (canGoForward === false && !canPanelNavigate(browser, 1)) return;
        navigatePanelHistory(browser, 1);
      }
    } catch (e) {
      console.warn(
        "[BgalazkaExtension] Panel input shield navigation failed:",
        e,
      );
    }
  }

  let panelInputShieldLastNav = { button: -1, time: 0 };
  const panelInputShieldHandler = (e) => {
    if (!getPref(BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, false)) return;
    if (e.button !== 3 && e.button !== 4) return;

    const root = document.getElementById("zen-app-panel-root");
    if (!root?.hasAttribute("open") || root.dataset.instaPeek === "true")
      return;

    const path = e.composedPath ? e.composedPath() : [];
    if (!path.includes(root)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // pointerup + mouseup + auxclick can describe the same physical press.
    // Navigate on mouseup only, with a tiny de-duplication guard.
    if (e.type === "mouseup") {
      const now = Date.now();
      if (
        panelInputShieldLastNav.button !== e.button ||
        now - panelInputShieldLastNav.time > 220
      ) {
        panelInputShieldLastNav = { button: e.button, time: now };
        navigateVisiblePanelBrowser(e.button);
      }
    }
  };

  PANEL_INPUT_SHIELD_EVENTS.forEach((type) =>
    window.addEventListener(type, panelInputShieldHandler, true),
  );
  registerCleanup(() => {
    PANEL_INPUT_SHIELD_EVENTS.forEach((type) =>
      window.removeEventListener(type, panelInputShieldHandler, true),
    );
  });

  function parseSVG(markup) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(markup, "image/svg+xml");
      if (
        doc.documentElement &&
        doc.documentElement.tagName.toLowerCase() === "svg"
      ) {
        return document.importNode(doc.documentElement, true);
      }
    } catch (_) {}
    const span = document.createElement("span");
    span.innerHTML = markup;
    return span.firstElementChild || span;
  }

  const PREF_ICONS = {
    GLASS: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="8.5" height="8.5" rx="2"/><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="2" stroke-dasharray="2 2"/></svg>`,
    DOCK: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="13" height="12" rx="2"/><line x1="10" y1="2" x2="10" y2="14"/></svg>`,
    PUSH: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="7" height="12" rx="1.5"/><rect x="10.5" y="2" width="4" height="12" rx="1" stroke-dasharray="2 2"/></svg>`,
    CORNER: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="13" height="12" rx="2"/><rect x="8" y="7.5" width="6.5" height="6.5" rx="1" fill="currentColor" fill-opacity="0.3"/></svg>`,
    HOVER_EYE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2.5"/></svg>`,
    ISOLATION: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 2v12a6 6 0 0 0 0-12z" fill="currentColor"/></svg>`,
    BADGE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12.5h9c-.8-1-1.5-2.5-1.5-5a4 4 0 1 0-8 0c0 2.5-.7 4-1.5 5z"/><circle cx="12" cy="4" r="2.5" fill="currentColor"/></svg>`,
    PILL: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="6" height="12" rx="3"/><circle cx="8" cy="5" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="11" r="1" fill="currentColor"/></svg>`,
    PILL_POS: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="14" y2="2"/><line x1="2" y1="8" x2="14" y2="8" stroke-dasharray="2 2"/><line x1="2" y1="14" x2="14" y2="14"/><rect x="6" y="5" width="4" height="6" rx="2" fill="currentColor"/></svg>`,
    PIN: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V15M3.5 11.5h9c0 0 0-2-1.5-3l-.5-4c0 0 .5-.5.5-1H5.5c0 .5.5 1 .5 1L5.5 8.5c-1.5 1-2 3-2 3z"/></svg>`,
    EXPAND: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>`,
    TOOLBAR: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="13" height="12" rx="2"/><line x1="1.5" y1="10.5" x2="14.5" y2="10.5"/></svg>`,
    BACK: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>`,
    FORWARD: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>`,
    RELOAD: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.8-4.1"/><path d="M13.5 2.5v3.2h-3.2"/></svg>`,
    ZOOM_OUT: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="8" x2="13" y2="8"/></svg>`,
    ZOOM_IN: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="8" x2="13" y2="8"/><line x1="8" y1="3" x2="8" y2="13"/></svg>`,
    GRABBER: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="11" cy="12" r="1.5"/></svg>`,
    REFRESH: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.8 6.5A5.5 5.5 0 1 0 8 13.5a5.5 5.5 0 0 0 5.2-3.7M14 2v4.5H9.5"/></svg>`,
    REPAIR_STYLE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.2 11.8 9.8 4.2"/><path d="m8.8 2.2 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"/><path d="m3.2 9.3.7 1.4 1.4.7-1.4.7-.7 1.4-.7-1.4-1.4-.7 1.4-.7.7-1.4Z"/></svg>`,
    PANEL_BLACK: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M8 2v12"/><path d="M8 2h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8z" fill="currentColor" stroke="none"/></svg>`,
    CLOSE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`,
    // Search-engine quick-switch (toolbar button) / dropdown icon: two
    // opposing arrows, standard "swap" glyph language.
    SWAP: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5h10.5M10 3l2.5 2.5L10 8"/><path d="M14 10.5H3.5M6 8l-2.5 2.5L6 13"/></svg>`,
    // All-Sides Resize (pill button + settings row): a centered crosshair
    // with 4 short arms pointing at all four edges, standard "resize on
    // every side" glyph language (distinct from GRABBER's 6-dot handle,
    // which is specifically the native width-only strip's own icon).
    RESIZE_ALL: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4"/><path d="M8 1.5 6.3 3.2M8 1.5l1.7 1.7M8 14.5l-1.7-1.7M8 14.5l1.7-1.7M1.5 8l1.7-1.7M1.5 8l1.7 1.7M14.5 8l-1.7-1.7M14.5 8l-1.7 1.7"/></svg>`,
    // URL bar drag grip (note 18): the standard 3-bar "drag handle" glyph,
    // deliberately distinct from RESIZE_ALL above so the two features read
    // as visually different at a glance (reposition vs. resize).
    DRAG_HANDLE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><rect x="2" y="3.2" width="12" height="1.6" rx="0.8"/><rect x="2" y="7.2" width="12" height="1.6" rx="0.8"/><rect x="2" y="11.2" width="12" height="1.6" rx="0.8"/></svg>`,
  };

  // A hidden panel retains its browser and active app. The reveal strip is
  // separate from the translated panel root, so it remains reachable at the
  // outer edge without sitting over webpage content.
  let hoverBoundRoot = null;
  let hoverHideTimer = null;
  let hoverRevealFrame = null;
  let hoverResizing = false;
  let hoverHoldUntil = 0;
  let hoverTypingUntil = 0;
  const hoverOpenPopups = new Set();
  let hoverContextPending = false;
  let hoverContextTimer = null;
  const hoverRevealId = "bgalazka-panel-reveal-edge";

  function hoverPanelAvailable() {
    return (
      getPref(BGALAZKA_EXT_PREFS.OPPOSITE_DOCKING, false) === true &&
      !window.Zentral?.Apps?.isPlacementVerticalBar?.()
    );
  }
  function updateRevealEdgeGeometry() {
    const edge = document.getElementById(hoverRevealId);
    const box = document.getElementById("tabbrowser-tabbox");
    if (!edge || !box) return;
    const rect = box.getBoundingClientRect();
    edge.style.top = `${Math.max(0, rect.top)}px`;
    edge.style.height = `${Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top))}px`;
  }
  function clearHoverHide() {
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    hoverHideTimer = null;
  }
  function extendHoverResizeHold() {
    if (!getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false)) return;
    hoverResizing = true;
    hoverHoldUntil = Date.now() + 3200;
    clearHoverHide();
    setHoverPanelHidden(false);
  }
  function hoverMenuVisible() {
    for (const popup of hoverOpenPopups) {
      if (!popup.isConnected || popup.state === "closed")
        hoverOpenPopups.delete(popup);
    }
    if (hoverOpenPopups.size || hoverContextPending) return true;
    return ["contentAreaContextMenu", "zen-apps-sidebar-tile-context"].some(
      (id) => {
        const popup = document.getElementById(id);
        return popup?.state === "open" || popup?.state === "showing";
      },
    );
  }
  function hoverPanelHasFocus() {
    const root = document.getElementById("zen-app-panel-root");
    return !!(
      root?.hasAttribute("open") &&
      document.activeElement &&
      root.contains(document.activeElement)
    );
  }
  function setHoverPanelHidden(hidden) {
    const root = document.getElementById("zen-app-panel-root");
    const enabled =
      hoverPanelAvailable() &&
      getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) === true &&
      root?.hasAttribute("open") &&
      !root.hasAttribute("closing");
    const shouldHide = !!(enabled && hidden);
    if (
      shouldHide &&
      !document.documentElement.hasAttribute("bgalazka-hover-panel-hidden")
    ) {
      const side = root.getAttribute("data-panel-side") || "right";
      const rect = root.getBoundingClientRect();
      const inset =
        side === "left" ? rect.left : window.innerWidth - rect.right;
      root.style.setProperty(
        "--bgalazka-hover-outset",
        `${Math.max(80, inset + 80)}px`,
      );
      document.documentElement.setAttribute("bgalazka-panel-side", side);
    }
    document.documentElement.toggleAttribute(
      "bgalazka-hover-panel-hidden",
      shouldHide,
    );
    const edge = document.getElementById(hoverRevealId);
    if (edge) {
      edge.hidden = !shouldHide;
      edge.setAttribute("aria-hidden", "true");
    }
    if (shouldHide) {
      if (hoverRevealFrame) cancelAnimationFrame(hoverRevealFrame);
      hoverRevealFrame = requestAnimationFrame(() => {
        hoverRevealFrame = null;
        updateRevealEdgeGeometry();
      });
    }
  }
  function syncHoverPanelAvailability() {
    const available = hoverPanelAvailable();
    const btn = document.getElementById("zen-app-hover-reveal-btn");
    if (btn) {
      const triple =
        document.documentElement.getAttribute("bgalazka-triple-view") ===
        "true";
      const pushing = getPref(BGALAZKA_EXT_PREFS.TRIPLE_PUSH_PAGE, true);
      btn.hidden =
        (!available && !triple) ||
        getPref(BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN, false);
      btn.disabled = !available && !triple;
      btn.title = triple
        ? available
          ? `Click: toggle autohide. Hold: ${pushing ? "stop" : "resume"} pushing the webpage in Triple View.`
          : `Hover requires Opposite-Side Docking. Hold: ${pushing ? "stop" : "resume"} pushing the webpage in Triple View.`
        : "Show panel on hover at the opposite edge";
      btn.setAttribute("aria-label", btn.title);
      btn.setAttribute(
        "data-hold-active",
        triple && !pushing ? "true" : "false",
      );
      btn.setAttribute(
        "data-active",
        available && getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false)
          ? "true"
          : "false",
      );
      btn.setAttribute("aria-pressed", btn.dataset.active);
    }
    document.documentElement.toggleAttribute(
      "bgalazka-hover-panel-enabled",
      available &&
        getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) === true,
    );
    if (!available || !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false)) {
      clearHoverHide();
      setHoverPanelHidden(false);
    }
  }
  const onHoverRootEnter = () => clearHoverHide();
  const onHoverRootLeave = () => {
    clearHoverHide();
    if (
      !hoverPanelAvailable() ||
      !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) ||
      hoverResizing ||
      hoverMenuVisible()
    )
      return;
    hoverHideTimer = setTimeout(
      () => {
        hoverHideTimer = null;
        const root = document.getElementById("zen-app-panel-root");
        const edge = document.getElementById(hoverRevealId);
        if (
          root?.matches(":hover") ||
          edge?.matches(":hover") ||
          hoverResizing ||
          hoverMenuVisible()
        )
          return;
        if (Date.now() < Math.max(hoverHoldUntil, hoverTypingUntil)) {
          onHoverRootLeave();
          return;
        }
        setHoverPanelHidden(true);
      },
      Math.max(400, hoverHoldUntil - Date.now(), hoverTypingUntil - Date.now()),
    );
  };
  function ensurePillHoverRevealButton() {
    const pill = document.getElementById("zen-app-panel-pill");
    const root = document.getElementById("zen-app-panel-root");
    if (!pill || !root) return;
    if (hoverBoundRoot !== root) {
      hoverBoundRoot?.removeEventListener("pointerenter", onHoverRootEnter);
      hoverBoundRoot?.removeEventListener("pointerleave", onHoverRootLeave);
      hoverBoundRoot = root;
      root.addEventListener("pointerenter", onHoverRootEnter);
      root.addEventListener("pointerleave", onHoverRootLeave);
    }
    let edge = document.getElementById(hoverRevealId);
    if (!edge) {
      edge = document.createElement("div");
      edge.id = hoverRevealId;
      edge.hidden = true;
      edge.title = "Hover to reveal panels";
      edge.addEventListener("pointerenter", () => {
        clearHoverHide();
        setHoverPanelHidden(false);
      });
      edge.addEventListener("pointerleave", onHoverRootLeave);
      document.documentElement.appendChild(edge);
    }
    let btn = document.getElementById("zen-app-hover-reveal-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "zen-app-hover-reveal-btn";
      btn.type = "button";
      btn.className = "zen-app-btn zen-app-hover-reveal-btn";
      btn.title = "Show panel on hover at the opposite edge";
      btn.setAttribute("aria-label", btn.title);
      btn.setAttribute("aria-pressed", "false");
      btn.appendChild(parseSVG(PREF_ICONS.HOVER_EYE));
      let holdTimer = null;
      let held = false;
      let startX = 0;
      let startY = 0;
      const cancelHold = () => {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;
      };
      btn.addEventListener("pointerdown", (event) => {
        held = false;
        if (
          event.button !== 0 ||
          document.documentElement.getAttribute("bgalazka-triple-view") !==
            "true"
        )
          return;
        startX = event.clientX;
        startY = event.clientY;
        cancelHold();
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (
            document.documentElement.getAttribute("bgalazka-triple-view") !==
            "true"
          )
            return;
          held = true;
          togglePanelPushPreference();
        }, 550);
      });
      btn.addEventListener("pointermove", (event) => {
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > 8)
          cancelHold();
      });
      btn.addEventListener("pointerup", cancelHold);
      btn.addEventListener("pointercancel", cancelHold);
      btn.addEventListener("pointerleave", cancelHold);
      btn.addEventListener(
        "click",
        (event) => {
          if (!held) return;
          held = false;
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        true,
      );
      registerCleanup(cancelHold);
      const anchor =
        document.getElementById("zen-app-dual-view-btn") || pill.firstChild;
      if (anchor?.parentNode === pill)
        pill.insertBefore(btn, anchor.nextSibling);
      else pill.appendChild(btn);
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!hoverPanelAvailable()) return;
        const next = !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false);
        setPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, next);
        // Enabling leaves the currently visible panel alone; the next
        // pointer exit toward the webpage decides when to hide it.
        syncHoverPanelAvailability();
      });
    }
    syncHoverPanelAvailability();
    btn.setAttribute("aria-pressed", btn.dataset.active);
  }
  const onResizeStartForHover = (event) => {
    if (
      event.button !== 0 ||
      !event.target.closest?.(
        "#zen-app-panel-root .zen-app-resize-strip, #zen-app-panel-root [class*='zen-app-resize-'], #zen-app-panel-root .zen-app-grabber, #zen-app-panel-root .zen-app-all-sides-resize-btn",
      )
    )
      return;
    extendHoverResizeHold();
  };
  const onResizeEndForHover = () => {
    if (!hoverResizing) return;
    hoverResizing = false;
    hoverHoldUntil = Date.now() + 3200;
    const root = document.getElementById("zen-app-panel-root");
    if (!root?.matches(":hover")) onHoverRootLeave();
  };
  document.addEventListener("mousedown", onResizeStartForHover, true);
  window.addEventListener("mouseup", onResizeEndForHover, true);
  window.addEventListener("blur", onResizeEndForHover);
  const onWebPagePointer = (event) => {
    if (event.target.closest?.("#tabbrowser-tabbox")) onHoverRootLeave();
  };
  const onHoverPanelFocusOut = () => {
    hoverTypingUntil = 0;
    setTimeout(() => {
      const root = document.getElementById("zen-app-panel-root");
      if (!root?.matches(":hover") && !hoverPanelHasFocus()) onHoverRootLeave();
    }, 0);
  };
  const onHoverPanelKeyDown = () => {
    if (hoverPanelHasFocus()) {
      hoverTypingUntil = Date.now() + 3000;
      clearHoverHide();
      setHoverPanelHidden(false);
    }
  };
  const onHoverPanelFocusIn = () => {
    if (hoverPanelHasFocus()) {
      hoverTypingUntil = Date.now() + 1500;
      clearHoverHide();
      setHoverPanelHidden(false);
    }
  };
  // A second click on the active launcher makes the panel permanently visible
  // and turns off hover mode. Capture before both native and Essential click
  // handlers, which otherwise close the panel or let a pending hide win.
  let hoverLauncherHandled = null;
  const activeHoverLauncher = (event) => {
    const tile = event.target.closest?.(".zen-app-tile[data-app-id]");
    const root = document.getElementById("zen-app-panel-root");
    if (
      !tile ||
      !root?.hasAttribute("open") ||
      root.hasAttribute("closing") ||
      getActiveAppBrowser()?._bgalazkaAppId !== tile.dataset.appId
    )
      return null;
    return tile;
  };
  const onActiveLauncherMouseDown = (event) => {
    if (
      event.button !== 0 ||
      !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false)
    )
      return;
    if (event.target.closest?.(".bgalazka-tile-audio")) return;
    const tile = activeHoverLauncher(event);
    if (!tile) return;
    hoverLauncherHandled = tile;
    setTimeout(() => {
      if (hoverLauncherHandled === tile) hoverLauncherHandled = null;
    }, 1000);
    event.preventDefault();
    event.stopImmediatePropagation();
    setPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false);
    clearHoverHide();
    syncHoverPanelAvailability();
    setHoverPanelHidden(false);
  };
  const onActiveLauncherClick = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest?.(".bgalazka-tile-audio")) return;
    const tile = event.target.closest?.(".zen-app-tile[data-app-id]");
    if (tile && tile === hoverLauncherHandled) {
      hoverLauncherHandled = null;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // Keyboard activation has no preceding mousedown.
    if (
      !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) ||
      !activeHoverLauncher(event)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false);
    syncHoverPanelAvailability();
    setHoverPanelHidden(false);
  };
  const onHoverPopupShowing = (event) => {
    if (
      !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) ||
      !document.getElementById("zen-app-panel-root")?.hasAttribute("open") ||
      document.documentElement.hasAttribute("bgalazka-hover-panel-hidden") ||
      !["menupopup", "panel"].includes(event.target?.localName)
    )
      return;
    hoverOpenPopups.add(event.target);
    hoverContextPending = false;
    if (hoverContextTimer) clearTimeout(hoverContextTimer);
    hoverContextTimer = null;
    clearHoverHide();
    setHoverPanelHidden(false);
  };
  const onHoverPopupHidden = (event) => {
    if (!hoverOpenPopups.delete(event.target) || hoverOpenPopups.size) return;
    onHoverRootLeave();
  };
  const onHoverContextMenu = (event) => {
    if (
      !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) ||
      !event
        .composedPath?.()
        .includes(document.getElementById("zen-app-panel-root"))
    )
      return;
    hoverContextPending = true;
    clearHoverHide();
    if (hoverContextTimer) clearTimeout(hoverContextTimer);
    hoverContextTimer = setTimeout(() => {
      hoverContextTimer = null;
      hoverContextPending = false;
      onHoverRootLeave();
    }, 1100);
  };
  document.addEventListener("click", onActiveLauncherClick, true);
  document.addEventListener("mousedown", onActiveLauncherMouseDown, true);
  window.addEventListener("popupshowing", onHoverPopupShowing, true);
  window.addEventListener("popuphidden", onHoverPopupHidden, true);
  window.addEventListener("contextmenu", onHoverContextMenu, true);
  document.addEventListener("pointerover", onWebPagePointer, true);
  window.addEventListener("focusout", onHoverPanelFocusOut, true);
  window.addEventListener("focusin", onHoverPanelFocusIn, true);
  window.addEventListener("keydown", onHoverPanelKeyDown, true);
  window.addEventListener("resize", updateRevealEdgeGeometry);
  const onHoverPrefChange = () => {
    syncHoverPanelAvailability();
    schedulePanelModeGeometrySync();
  };
  for (const pref of [
    BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL,
    BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
    BGALAZKA_EXT_PREFS.OPPOSITE_DOCKING,
  ]) {
    Services.prefs.addObserver(pref, onHoverPrefChange);
    registerCleanup(() =>
      Services.prefs.removeObserver(pref, onHoverPrefChange),
    );
  }
  registerCleanup(() => {
    document.removeEventListener("pointerover", onWebPagePointer, true);
    window.removeEventListener("focusout", onHoverPanelFocusOut, true);
    window.removeEventListener("focusin", onHoverPanelFocusIn, true);
    window.removeEventListener("keydown", onHoverPanelKeyDown, true);
    document.removeEventListener("click", onActiveLauncherClick, true);
    document.removeEventListener("mousedown", onActiveLauncherMouseDown, true);
    window.removeEventListener("popupshowing", onHoverPopupShowing, true);
    window.removeEventListener("popuphidden", onHoverPopupHidden, true);
    window.removeEventListener("contextmenu", onHoverContextMenu, true);
    if (hoverContextTimer) clearTimeout(hoverContextTimer);
    hoverOpenPopups.clear();
    document.removeEventListener("mousedown", onResizeStartForHover, true);
    window.removeEventListener("mouseup", onResizeEndForHover, true);
    window.removeEventListener("blur", onResizeEndForHover);
    clearHoverHide();
    if (hoverRevealFrame) cancelAnimationFrame(hoverRevealFrame);
    window.removeEventListener("resize", updateRevealEdgeGeometry);
    hoverBoundRoot?.removeEventListener("pointerenter", onHoverRootEnter);
    hoverBoundRoot?.removeEventListener("pointerleave", onHoverRootLeave);
    document.getElementById(hoverRevealId)?.remove();
    document.getElementById("zen-app-hover-reveal-btn")?.remove();
    document.documentElement.removeAttribute("bgalazka-hover-panel-enabled");
    document.documentElement.removeAttribute("bgalazka-hover-panel-hidden");
  });

  function ensurePillDualViewButton() {
    const pill = document.getElementById("zen-app-panel-pill");
    if (!pill) return;

    let btn = document.getElementById("zen-app-dual-view-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "zen-app-dual-view-btn";
      btn.className = "zen-app-btn zen-app-dual-view-btn";
      btn.setAttribute("type", "button");
      btn.title = "Toggle Dual-View (Push Webpage)";
      btn.appendChild(parseSVG(PREF_ICONS.PUSH));

      const pinBtn = pill.querySelector(".zen-app-btn");
      if (pinBtn && pinBtn.nextSibling) {
        pill.insertBefore(btn, pinBtn.nextSibling);
      } else {
        pill.prepend(btn);
      }

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        // In Triple View the push button controls Triple View's own push
        // choice. In ordinary/dual view it controls the saved dual preference.
        togglePanelPushPreference();
      });
    }

    const isPushActive = getPref(BGALAZKA_EXT_PREFS.PUSH_PAGE, false);
    btn.setAttribute("data-active", isPushActive ? "true" : "false");
  }

  // Pill-menu twin of the "All-Sides Panel Resize" settings toggle (note
  // 16): both read/write the SAME pref, so flipping either one updates the
  // other immediately, same convention as the Dual-View button above.
  function ensurePillAllSidesResizeButton() {
    const pill = document.getElementById("zen-app-panel-pill");
    if (!pill) return;

    let btn = document.getElementById("zen-app-all-sides-resize-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "zen-app-all-sides-resize-btn";
      btn.className = "zen-app-btn zen-app-all-sides-resize-btn";
      btn.setAttribute("type", "button");
      btn.title = "Toggle all-sides resize • drag to move panel freely";
      btn.appendChild(parseSVG(PREF_ICONS.RESIZE_ALL));

      // Sits right after the Dual-View button (or the pin button if
      // Dual-View isn't in the DOM yet) so the two panel-shape toggles
      // stay grouped together in the pill.
      const anchor =
        document.getElementById("zen-app-dual-view-btn") ||
        pill.querySelector(".zen-app-btn");
      if (anchor) pill.insertBefore(btn, anchor.nextSibling);
      else pill.prepend(btn);

      // A click still toggles this feature. Once enabled, dragging the button
      // moves the WHOLE panel freely in X and Y at the same time. The small
      // deadzone exists only to distinguish click from drag; it never chooses
      // or locks an axis.
      btn.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || !getPref(EXT_PREFS.ALL_SIDES_RESIZE, false))
          return;
        const startX = e.clientX;
        const startY = e.clientY;
        const BUTTON_DRAG_DEADZONE_PX = 8;
        let dragStarted = false;
        const onMove = (moveEvt) => {
          if (dragStarted) return;
          const dx = moveEvt.clientX - startX;
          const dy = moveEvt.clientY - startY;
          if (Math.max(Math.abs(dx), Math.abs(dy)) <= BUTTON_DRAG_DEADZONE_PX)
            return;
          dragStarted = true;
          btn._bgalazkaDragWasRouted = true;
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);

          // Preserve the ORIGINAL mousedown coordinates for both axes so the
          // panel catches up smoothly after crossing the click-vs-drag guard.
          startPanelHorizontalPositionDrag(moveEvt, startX);
          startPanelPositionDrag(moveEvt, startY);
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Browsers dispatch click after a drag. Consume that synthetic click
        // so using the button as a resize/move handle cannot also flip its
        // own all-sides toggle off at mouseup.
        if (btn._bgalazkaDragWasRouted) {
          btn._bgalazkaDragWasRouted = false;
          return;
        }
        const cur = getPref(EXT_PREFS.ALL_SIDES_RESIZE, false);
        const next = !cur;
        setPref(EXT_PREFS.ALL_SIDES_RESIZE, next);
        document.documentElement.setAttribute(
          "bgalazka-all-sides-resize",
          next ? "true" : "false",
        );
        btn.setAttribute("data-active", next ? "true" : "false");

        const input = document.querySelector(
          `input[data-pref="${EXT_PREFS.ALL_SIDES_RESIZE}"]`,
        );
        if (input) input.checked = next;

        ensureVerticalResizeHandles();
      });
    }

    const isActive = getPref(EXT_PREFS.ALL_SIDES_RESIZE, false);
    btn.setAttribute("data-active", isActive ? "true" : "false");
  }

  // Keep the eye (hover), push button (page layout), and Triple View's
  // separate push preference independent. Refresh geometry after CSS settles
  // so the panel cannot stay at a stale position until the next mouse event.
  let modeGeometryFrame = null;
  let modeGeometryTimer = null;
  let lastSyncedTripleMode = null;
  function reconcilePanelModeGeometry() {
    const root = document.getElementById("zen-app-panel-root");
    if (!root?.hasAttribute("open") || root.hasAttribute("closing")) return;
    window.Zentral?.Apps?.positionPanel?.();
    applyVerticalResizeExtras(root);
    if (!hResizeState && !hPosDragState && !vPosDragState)
      applyHorizontalPanelOffset(root);
    updateRevealEdgeGeometry();
  }
  function schedulePanelModeGeometrySync() {
    if (modeGeometryFrame) cancelAnimationFrame(modeGeometryFrame);
    modeGeometryFrame = requestAnimationFrame(() => {
      modeGeometryFrame = null;
      reconcilePanelModeGeometry();
    });
    // The tabbox margin and hover transform each transition for ~0.2s.
    if (modeGeometryTimer) clearTimeout(modeGeometryTimer);
    modeGeometryTimer = setTimeout(() => {
      modeGeometryTimer = null;
      reconcilePanelModeGeometry();
    }, 260);
  }
  registerCleanup(() => {
    if (modeGeometryFrame) cancelAnimationFrame(modeGeometryFrame);
    if (modeGeometryTimer) clearTimeout(modeGeometryTimer);
  });

  function togglePanelPushPreference() {
    const triple =
      document.documentElement.getAttribute("bgalazka-triple-view") === "true";
    const pref = triple
      ? BGALAZKA_EXT_PREFS.TRIPLE_PUSH_PAGE
      : BGALAZKA_EXT_PREFS.PUSH_PAGE;
    setPref(pref, !getPref(pref, triple));
    if (!triple) {
      const input = document.querySelector(
        `input[data-pref="${BGALAZKA_EXT_PREFS.PUSH_PAGE}"]`,
      );
      if (input) input.checked = getPref(pref, false);
    }
    syncPanelPushState();
  }

  function syncPanelPushState() {
    ensurePillDualViewButton();
    ensurePillHoverRevealButton();
    const root = document.getElementById("zen-app-panel-root");
    const pill = document.getElementById("zen-app-panel-pill");
    const pinBtn = pill?.querySelector(".zen-app-btn[data-pinned]");

    const isPinned = pinBtn?.getAttribute("data-pinned") === "true";
    const isOpen = root?.hasAttribute("open") && !root?.hasAttribute("closing");
    const triple =
      document.documentElement.getAttribute("bgalazka-triple-view") === "true";
    const dualViewActive = triple
      ? getPref(BGALAZKA_EXT_PREFS.TRIPLE_PUSH_PAGE, true)
      : getPref(BGALAZKA_EXT_PREFS.PUSH_PAGE, false);
    const pushChanged =
      document.documentElement.getAttribute("bgalazka-push-page") !==
      String(dualViewActive);
    const tripleChanged = lastSyncedTripleMode !== triple;
    lastSyncedTripleMode = triple;
    document.documentElement.setAttribute(
      "bgalazka-push-page",
      String(dualViewActive),
    );
    const pushBtn = document.getElementById("zen-app-dual-view-btn");
    if (pushBtn) {
      pushBtn.setAttribute("data-active", String(dualViewActive));
      pushBtn.title = triple
        ? "Toggle webpage push in Triple View"
        : "Toggle Dual-View (Push Webpage)";
      pushBtn.setAttribute("aria-label", pushBtn.title);
      pushBtn.setAttribute("aria-pressed", String(dualViewActive));
    }
    syncHoverPanelAvailability();
    // Dual and Triple View act as an effective pin without changing the
    // native Pin button. Triple View remains open even when page push is off.
    const effectivePinned = isOpen && (isPinned || dualViewActive || triple);

    // Re-evaluate all user panel offsets whenever Dual-View changes. Both
    // helpers suppress their axis-specific margins only while Dual-View is on
    // and automatically restore the saved values when it turns off.
    applyVerticalResizeExtras(root);
    // The drag handler owns the margin until mouseup. Reapplying the saved
    // value from a native resize callback can alternate two X positions.
    if (!hResizeState) applyHorizontalPanelOffset(root);
    const side =
      root?.getAttribute("data-panel-side") ||
      (window.Zentral?.Apps?.isPanelAttachedToRight?.() ? "right" : "left");
    const width =
      root?.getBoundingClientRect()?.width ||
      parseInt(root?.style?.width, 10) ||
      350;

    const docRoot = document.documentElement;
    const widthValue = `${Math.round(width)}px`;
    if (docRoot.style.getPropertyValue("--bgalazka-panel-width") !== widthValue)
      docRoot.style.setProperty("--bgalazka-panel-width", widthValue);
    const pinnedValue = effectivePinned ? "true" : "false";
    if (docRoot.getAttribute("bgalazka-panel-pinned") !== pinnedValue)
      docRoot.setAttribute("bgalazka-panel-pinned", pinnedValue);
    if (docRoot.getAttribute("bgalazka-panel-side") !== side)
      docRoot.setAttribute("bgalazka-panel-side", side);
    if (pushChanged || tripleChanged) schedulePanelModeGeometrySync();
  }

  /* ==========================================================================
   * WEB PANEL NAVIGATION TOOLBAR
   * Docked at the bottom of the floating app panel: back / forward / reload
   * (moved here from the pill) + a URL bar, with optional zoom controls.
   * Master-toggleable, URL-bar-toggleable, zoom-toggleable, and can be set to
   * only reveal itself on hover instead of permanently reserving space.
   * ========================================================================== */

  // Multiple <browser> elements can live inside #zen-app-panel-slider (one
  // per app, per getOrCreateAppBrowser() above), with only the active one
  // NOT set to style.display = "none" (see openPanel()'s app-switch loop).
  // There's no dedicated "active" attribute on the browser itself, so this
  // is the only reliable way to find it from outside the class (activeAppId
  // is a private field, see note 5).
  function getActiveAppBrowser() {
    const panel = document.getElementById("zen-app-panel-slider");
    if (!panel) return null;
    // In Triple-View the secondary browser is nested in its own shell.
    // Keep the original toolbar and pill bound to Zentral's first browser.
    if (document.documentElement.hasAttribute("bgalazka-triple-view")) {
      const primary = panel.querySelector(
        'browser[data-bgalazka-triple-slot="top"]',
      );
      if (primary?.isConnected) return primary;
    }
    const browsers = panel.querySelectorAll("browser");
    for (const b of Array.from(browsers).reverse()) {
      if (b.style.display !== "none") return b;
    }
    return null;
  }

  /* --------------------------------------------------------------------
   * URL BAR: URL-vs-SEARCH DETECTION AND SEARCH ENGINE TEMPLATES
   * ----------------------------------------------------------------------
   * The toolbar's URL bar has to decide, on Enter, whether what was typed
   * is a URL to load directly or a search phrase to hand to a search
   * engine (this is what a normal browser's urlbar does via its own
   * "fixup" step). We do this ourselves with looksLikeUrl() below instead
   * of relying on <browser>.fixupAndLoadURIString()'s own built-in
   * keyword-search fallback, because that fallback goes through Gecko's
   * OWN default search engine / keyword.enabled machinery, which we have
   * no clean way to redirect to a user-chosen engine from here (chrome
   * <browser> loads don't expose a "use this search engine instead"
   * option) — building the destination URL ourselves and loading it as a
   * plain https:// URL sidesteps that entirely.
   * -------------------------------------------------------------------- */
  // Built-in quick-switch destinations. These are ready to use: users select
  // them in Extension Settings and never need to look up a GET URL manually.
  // Google and Bing are intentionally not part of this list.
  const QUICK_SWITCH_BUILTIN_TARGETS = [
    {
      key: "ddg",
      label: "DuckDuckGo",
      template: "https://duckduckgo.com/?q=%s",
      param: "q",
      test: (u) => /^https?:\/\/(www\.)?duckduckgo\.com\//i.test(u),
    },
    {
      key: "startpage",
      label: "Startpage",
      template: "https://www.startpage.com/sp/search?query=%s",
      param: "query",
      test: (u) =>
        /^https?:\/\/(www\.)?startpage\.com\/(sp|do)\/(d?search)/i.test(u),
    },
    {
      key: "brave",
      label: "Brave Search",
      template: "https://search.brave.com/search?q=%s",
      param: "q",
      test: (u) => /^https?:\/\/search\.brave\.com\/search/i.test(u),
    },
    {
      key: "yahoo",
      label: "Yahoo Search",
      template: "https://search.yahoo.com/search?p=%s",
      param: "p",
      test: (u) => /^https?:\/\/search\.yahoo\.com\/search/i.test(u),
    },
    {
      key: "ecosia",
      label: "Ecosia",
      template: "https://www.ecosia.org/search?q=%s",
      param: "q",
      test: (u) => /^https?:\/\/(www\.)?ecosia\.org\/search/i.test(u),
    },
    {
      key: "qwant",
      label: "Qwant",
      template: "https://www.qwant.com/?q=%s",
      param: "q",
      test: (u) => /^https?:\/\/(www\.)?qwant\.com\//i.test(u),
    },
    {
      key: "youtube",
      label: "YouTube",
      template: "https://www.youtube.com/results?search_query=%s",
      param: "search_query",
      test: (u) => /^https?:\/\/(www\.|m\.)?youtube\.com\/results/i.test(u),
    },
    {
      key: "wikipedia",
      label: "Wikipedia",
      template: "https://en.wikipedia.org/w/index.php?search=%s",
      param: "search",
      test: (u) =>
        /^https?:\/\/[a-z0-9-]+\.wikipedia\.org\/w\/index\.php/i.test(u),
    },
    {
      key: "reddit",
      label: "Reddit",
      template: "https://www.reddit.com/search/?q=%s",
      param: "q",
      test: (u) => /^https?:\/\/(www\.)?reddit\.com\/search\/?/i.test(u),
    },
    {
      key: "github",
      label: "GitHub",
      template: "https://github.com/search?q=%s",
      param: "q",
      test: (u) => /^https?:\/\/github\.com\/search/i.test(u),
    },
  ];

  const QUICK_SWITCH_TARGET_PREF_PREFIX =
    "zen.workspace.bgalazka.web_toolbar_quickswitch_target.";
  const QUICK_SWITCH_CUSTOM_PREFS = Array.from(
    { length: 5 },
    (_, index) =>
      `zen.workspace.bgalazka.web_toolbar_quickswitch_custom_${index + 1}`,
  );
  // One legacy primary-custom slot plus five additional slots. Keeping the
  // existing pref names preserves current users' engines while presenting all
  // six as one coherent list in Settings.
  const SEARCH_CUSTOM_ENGINE_PREFS = [
    BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_CUSTOM_URL,
    ...QUICK_SWITCH_CUSTOM_PREFS,
  ];
  let cachedQuickSwitchTargets = null;
  const searchTargetsObserver = () => {
    cachedQuickSwitchTargets = null;
  };
  Services.prefs.addObserver(
    "zen.workspace.bgalazka.web_toolbar_",
    searchTargetsObserver,
  );
  registerCleanup(() =>
    Services.prefs.removeObserver(
      "zen.workspace.bgalazka.web_toolbar_",
      searchTargetsObserver,
    ),
  );
  const QUICK_SWITCH_COMMON_GET_PARAMS = [
    "q",
    "query",
    "p",
    "search_query",
    "search",
    "keyword",
    "keywords",
    "term",
    "text",
    "wd",
    "k",
    "s",
  ];

  const SEARCH_ENGINE_TEMPLATES = Object.fromEntries(
    QUICK_SWITCH_BUILTIN_TARGETS.map(({ key, template }) => [key, template]),
  );

  // Patterns used to recognize built-in result pages and recover the search
  // term. Generic GET pages are handled separately below.
  const SEARCH_ENGINE_PATTERNS = Object.fromEntries(
    QUICK_SWITCH_BUILTIN_TARGETS.map(({ key, test, param }) => [
      key,
      { test, param },
    ]),
  );

  function detectSearchEngine(urlStr) {
    if (!urlStr) return null;
    for (const key of Object.keys(SEARCH_ENGINE_PATTERNS)) {
      if (SEARCH_ENGINE_PATTERNS[key].test(urlStr)) return key;
    }
    return null;
  }

  function extractSearchQuery(urlStr, engineKey) {
    try {
      const params = new URL(urlStr).searchParams;
      return params.get(SEARCH_ENGINE_PATTERNS[engineKey].param);
    } catch (_) {
      return null;
    }
  }

  // A GET parameter alone is not evidence of search: article/product pages
  // often carry ?q=, ?s= or tracking parameters. Accept an enabled custom
  // template, a recognized built-in results URL, or an obvious search route
  // with a known query key (e.g. Google/Bing /search?q=...).
  function extractGetSearchQuery(urlStr) {
    try {
      const url = new URL(urlStr);
      if (!/^https?:$/.test(url.protocol)) return null;

      for (const target of getQuickSwitchTargets()) {
        if (!target.key.startsWith("custom-")) continue;
        const term = extractCustomSearchQuery(target.template, urlStr);
        if (term?.trim()) return term;
      }

      const knownEngine = detectSearchEngine(urlStr);
      if (knownEngine) {
        const term = extractSearchQuery(urlStr, knownEngine);
        return term?.trim() ? term : null;
      }

      const isResultsRoute =
        /(?:^|\/)(?:search|results|find)(?:\/|$)/i.test(url.pathname) ||
        /^search[.-]/i.test(url.hostname);
      if (!isResultsRoute) return null;
      for (const param of QUICK_SWITCH_COMMON_GET_PARAMS) {
        const value = url.searchParams.get(param);
        if (value?.trim()) return value;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function isValidQuickSwitchTemplate(template) {
    if (typeof template !== "string" || !template.includes("%s")) return false;
    try {
      const probe = new URL(template.replaceAll("%s", "bgalazkaprobe"));
      return (
        /^https?:$/.test(probe.protocol) &&
        !probe.username &&
        !probe.password &&
        !probe.host.includes("bgalazkaprobe")
      );
    } catch (_) {
      return false;
    }
  }

  function customTemplateMatchesUrl(template, urlStr) {
    return extractCustomSearchQuery(template, urlStr) !== null;
  }

  function extractCustomSearchQuery(template, urlStr) {
    if (!isValidQuickSwitchTemplate(template)) return null;
    try {
      const marker = "bgalazkaprobe";
      const templateUrl = new URL(template.replaceAll("%s", marker));
      const currentUrl = new URL(urlStr);
      if (templateUrl.origin !== currentUrl.origin) return null;
      let term = null;
      const matchPart = (pattern, value, encoded = false) => {
        if (value == null) return false;
        if (!pattern.includes(marker)) return pattern === value;
        const escaped = pattern
          .split(marker)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        const match = value.match(
          new RegExp("^" + escaped.join("(.*?)") + "$"),
        );
        if (!match) return false;
        return match.slice(1).every((part) => {
          const query = encoded ? decodeURIComponent(part) : part;
          if (!query.trim() || (term !== null && term !== query)) return false;
          term = query;
          return true;
        });
      };
      if (
        !matchPart(
          templateUrl.pathname.replace(/\/$/, ""),
          currentUrl.pathname.replace(/\/$/, ""),
          true,
        )
      )
        return null;
      for (const [name, value] of templateUrl.searchParams.entries()) {
        if (!matchPart(value, currentUrl.searchParams.get(name))) return null;
      }
      if (
        templateUrl.hash &&
        !matchPart(templateUrl.hash, currentUrl.hash, true)
      )
        return null;
      return term;
    } catch (_) {}
    return null;
  }

  function getQuickSwitchTargets() {
    if (cachedQuickSwitchTargets) return cachedQuickSwitchTargets;
    const builtIns = QUICK_SWITCH_BUILTIN_TARGETS.filter((target, index) =>
      getPref(
        QUICK_SWITCH_TARGET_PREF_PREFIX + target.key,
        index < 2, // retain the old DDG <-> Startpage behavior by default
      ),
    ).map((target) => ({
      ...target,
      matches: (urlStr) => target.test(urlStr),
    }));

    const custom = SEARCH_CUSTOM_ENGINE_PREFS.map((pref, index) => ({
      key: `custom-${index + 1}`,
      label: `Custom Engine ${index + 1}`,
      template: String(getPref(pref, "") || "").trim(),
    }))
      .filter(({ template }) => isValidQuickSwitchTemplate(template))
      .map((target) => ({
        ...target,
        matches: (urlStr) => customTemplateMatchesUrl(target.template, urlStr),
      }));

    const seen = new Set();
    cachedQuickSwitchTargets = [...builtIns, ...custom].filter(
      ({ template }) => {
        if (seen.has(template)) return false;
        seen.add(template);
        return true;
      },
    );
    return cachedQuickSwitchTargets;
  }

  function getNextQuickSwitchTarget(urlStr, targets = getQuickSwitchTargets()) {
    if (!targets.length) return null;
    const currentIndex = targets.findIndex((target) => target.matches(urlStr));
    // A single selected destination already hosting this search is not a
    // switch. Keep the icon hidden instead of reloading the same results.
    if (targets.length === 1 && currentIndex === 0) return null;
    return targets[(currentIndex + 1) % targets.length];
  }

  // Best-effort mirror of Firefox's OWN default search engine, for the
  // "Browser Default" option. Services.search is promise-based, and we
  // don't want the URL bar's Enter handler to await anything (typing +
  // Enter should feel instant), so this is fetched once up front (and
  // again if the user switches TO "Browser Default" in settings) and
  // cached; buildSearchUrl() below just reads the cached value.
  // The "%s" template is recovered by asking the engine for a submission
  // URL for a unique marker string, then swapping that marker back out for
  // "%s" in the resulting URL — the same trick many search-engine-import
  // tools use, since nsISearchEngine only exposes "give me the URL for
  // THIS term", not the raw template.
  let cachedBrowserSearchTemplate = null;
  function refreshBrowserSearchTemplate() {
    try {
      const marker = "bgalazkaquerymarker";
      Services.search
        .getDefault()
        .then((engine) => {
          try {
            const submission = engine?.getSubmission?.(marker);
            const url = submission?.uri?.spec;
            if (!url) return;
            const encodedMarker = encodeURIComponent(marker);
            if (url.includes(encodedMarker)) {
              cachedBrowserSearchTemplate = url.replace(encodedMarker, "%s");
            } else if (url.includes(marker)) {
              cachedBrowserSearchTemplate = url.replace(marker, "%s");
            }
          } catch (_) {}
        })
        .catch(() => {});
    } catch (_) {}
  }
  refreshBrowserSearchTemplate();

  // Builds the final URL to load for a typed search phrase, honoring
  // WEB_TOOLBAR_SEARCH_ENGINE. Always falls back to DuckDuckGo so a bad/
  // empty custom template or a not-yet-loaded browser-default template
  // never leaves the URL bar doing nothing.
  function buildSearchUrl(term) {
    const mode = getPref(BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_ENGINE, "ddg");
    let template;
    if (mode === "custom" || /^custom-\d+$/.test(mode)) {
      // "custom" is the legacy value for slot 1. New selections use
      // custom-2..custom-6, allowing more than one user-created engine.
      const slot =
        mode === "custom" ? 0 : Math.max(0, parseInt(mode.slice(7), 10) - 1);
      const pref = SEARCH_CUSTOM_ENGINE_PREFS[slot];
      template = (pref && getPref(pref, "")) || SEARCH_ENGINE_TEMPLATES.ddg;
    } else if (mode === "browser") {
      template = cachedBrowserSearchTemplate || SEARCH_ENGINE_TEMPLATES.ddg;
    } else {
      template = SEARCH_ENGINE_TEMPLATES[mode] || SEARCH_ENGINE_TEMPLATES.ddg;
    }
    // Old preferences can contain invalid templates even after UI validation
    // is added. Never navigate a typed search to javascript:/data: or invent
    // a query parameter that the user's engine does not support.
    if (!isValidQuickSwitchTemplate(template))
      template = SEARCH_ENGINE_TEMPLATES.ddg;
    return template.replaceAll("%s", encodeURIComponent(term));
  }

  // Same "has a dot before the first slash" rule real browsers' urlbars use
  // to decide URL vs. keyword search, plus the obvious explicit-scheme and
  // localhost/IP cases. A typed phrase with a space is never treated as a
  // URL even if it happens to contain a dot (e.g. "prices in Warsaw pl.").
  function looksLikeUrl(raw) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return true; // explicit scheme
    if (/\s/.test(raw)) return false;
    if (
      /^(localhost|(\d{1,3}\.){3}\d{1,3}|\[[0-9a-fA-F:]+\])(:\d+)?(\/.*)?$/.test(
        raw,
      )
    )
      return true;
    const hostPart = raw.split("/")[0].split(":")[0];
    return hostPart.includes(".") && !hostPart.endsWith(".");
  }

  // The browser owns session history, including redirects, replaceState,
  // pushState, POST entries and bfcache. Observing a URL is not a new visit.
  // In particular, never replay observed URLs with loadURI as a Back fallback.
  function canPanelNavigate(browser, direction) {
    if (!browser) return false;
    try {
      const key = direction < 0 ? "canGoBack" : "canGoForward";
      return !!(browser.webNavigation?.[key] ?? browser[key]);
    } catch (_) {
      return false;
    }
  }

  function navigatePanelHistory(browser, direction) {
    if (!canPanelNavigate(browser, direction)) return;
    const method = direction < 0 ? "goBack" : "goForward";
    try {
      // Gecko skips entries without user interaction, including redirect hops.
      if (typeof browser[method] === "function") browser[method](true);
      else browser.webNavigation?.[method]?.(true);
    } catch (error) {
      console.warn(
        "[BgalazkaExtension] Panel history navigation failed",
        error,
      );
    }
  }

  let forcePanelBlackSwitchTimer = null;
  // Runtime state is authoritative while this chrome window is alive. The
  // preference persists it across restarts; the root attribute/button are
  // presentation mirrors only. This prevents panel/toolbars rebuilds or a
  // temporarily stale DOM attribute from inverting the next click.
  let forcePanelBlackState = getPref(
    BGALAZKA_EXT_PREFS.FORCE_PANEL_BLACK,
    false,
  );

  function syncForcePanelBlackButton(button, forced = forcePanelBlackState) {
    if (!button) return;
    button.dataset.active = forced ? "true" : "false";
    button.setAttribute("aria-pressed", forced ? "true" : "false");
    button.title = forced
      ? "Use saved panel background / transparency"
      : "Force opaque black panel background";
  }

  function applyForcePanelBlackVisual(
    forced = forcePanelBlackState,
    button = null,
    instant = true,
  ) {
    forcePanelBlackState = !!forced;
    const root = document.documentElement;
    if (instant) root.setAttribute("bgalazka-panel-black-switching", "true");
    root.setAttribute(
      "bgalazka-force-panel-black",
      forcePanelBlackState ? "true" : "false",
    );
    syncForcePanelBlackButton(
      button ||
        document.querySelector(
          "#zen-app-panel-toolbar .bgalazka-panel-black-btn",
        ),
      forcePanelBlackState,
    );
    if (!instant) return;
    if (forcePanelBlackSwitchTimer) clearTimeout(forcePanelBlackSwitchTimer);
    forcePanelBlackSwitchTimer = setTimeout(() => {
      forcePanelBlackSwitchTimer = null;
      root.removeAttribute("bgalazka-panel-black-switching");
    }, 80);
  }

  function setForcePanelBlack(forced, { persist = true, instant = true } = {}) {
    forced = !!forced;
    applyForcePanelBlackVisual(forced, null, instant);
    if (
      persist &&
      getPref(BGALAZKA_EXT_PREFS.FORCE_PANEL_BLACK, false) !== forced
    )
      setPref(BGALAZKA_EXT_PREFS.FORCE_PANEL_BLACK, forced);
  }

  registerCleanup(() => {
    if (forcePanelBlackSwitchTimer) clearTimeout(forcePanelBlackSwitchTimer);
    document.documentElement.removeAttribute("bgalazka-panel-black-switching");
  });

  function ensureWebToolbar() {
    const panel = document.getElementById("zen-app-panel-slider");
    if (!panel) return false;
    if (document.getElementById("zen-app-panel-toolbar")) return true; // already built

    // Thin invisible strip used only in autohide mode (see chrome.css) to
    // reveal the toolbar on hover, same sibling-hover trick the pill itself
    // uses. Must come BEFORE the toolbar in the DOM for the `~` selector.
    const hoverZone = document.createElement("div");
    hoverZone.className = "zen-toolbar-hover-zone";

    const toolbar = document.createElement("div");
    toolbar.id = "zen-app-panel-toolbar";

    const backBtn = document.createElement("button");
    backBtn.className = "zen-toolbar-btn zen-toolbar-back-btn";
    backBtn.title = "Back";
    backBtn.appendChild(parseSVG(PREF_ICONS.BACK));
    backBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigatePanelHistory(getActiveAppBrowser(), -1);
    });

    const fwdBtn = document.createElement("button");
    fwdBtn.className = "zen-toolbar-btn zen-toolbar-fwd-btn";
    fwdBtn.title = "Forward";
    fwdBtn.appendChild(parseSVG(PREF_ICONS.FORWARD));
    fwdBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const b = getActiveAppBrowser();
      navigatePanelHistory(b, 1);
    });

    // Reload moved here from the pill's own refresh button (still present
    // natively, but hidden via CSS while the toolbar is enabled — see
    // chrome.css). Reuses the exact same spinning-icon feedback.
    const reloadBtn = document.createElement("button");
    reloadBtn.className = "zen-toolbar-btn zen-toolbar-reload-btn";
    reloadBtn.title = "Reload";
    reloadBtn.appendChild(parseSVG(PREF_ICONS.RELOAD));
    reloadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const b = getActiveAppBrowser();
      if (!b) return;
      reloadBtn.classList.add("zen-toolbar-spinning");
      setTimeout(() => reloadBtn.classList.remove("zen-toolbar-spinning"), 450);
      try {
        b.reload();
      } catch (_) {}
    });

    const urlWrap = document.createElement("div");
    urlWrap.className = "zen-toolbar-urlwrap";

    // Panel position drag grip (note 18): small leading handle inside the
    // URL bar row, separate element from the <input> itself so it can't
    // interfere with clicking/selecting/typing the URL. Only ever visible
    // when the URL bar itself is (see chrome.css -- it's a plain descendant
    // of .zen-toolbar-urlwrap, which is already hidden via
    // WEB_TOOLBAR_URLBAR when that toggle is off), so no separate
    // hide-toggle was needed for it.
    const urlDragHandle = document.createElement("div");
    urlDragHandle.className = "zen-toolbar-urlbar-drag-handle";
    urlDragHandle.title = "Drag to move panel";
    urlDragHandle.appendChild(parseSVG(PREF_ICONS.DRAG_HANDLE));
    urlDragHandle.addEventListener("mousedown", startPanelPositionDrag);
    urlWrap.appendChild(urlDragHandle);

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "zen-toolbar-urlbar";
    urlInput.spellcheck = false;
    urlInput.setAttribute("autocomplete", "off");
    urlInput.addEventListener("keydown", (e) => {
      // Stop keys from leaking to the panel's own shortcuts (Escape closes
      // the panel elsewhere) while typing a URL.
      e.stopPropagation();
      if (e.key === "Enter") {
        const b = getActiveAppBrowser();
        const raw = urlInput.value.trim();
        if (!b || !raw) return;
        try {
          const isUrl = looksLikeUrl(raw);
          const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
          // Not a URL (e.g. "google" or "weather warsaw") -> run it through
          // the configured search engine instead (see buildSearchUrl()).
          const target = isUrl
            ? hasScheme
              ? raw
              : "https://" + raw
            : buildSearchUrl(raw);
          const uri = Services.io.newURI(target);
          if (typeof b.fixupAndLoadURIString === "function") {
            // BUG FIX: this used to pass `raw` here instead of `target`.
            // For a plain typed URL that's mostly harmless (Gecko's own
            // fixup re-derives the same https:// URL), but for a search
            // it meant the literal search PHRASE was handed to fixup
            // instead of the search-engine URL we just built, so typed
            // terms never actually reached DuckDuckGo/Startpage/etc.
            b.fixupAndLoadURIString(target, {
              triggeringPrincipal:
                Services.scriptSecurityManager.createContentPrincipal(uri, {}),
            });
          }
        } catch (e2) {
          console.warn("[BgalazkaExtension] Toolbar navigation failed:", e2);
        }
        urlInput.blur();
      } else if (e.key === "Escape") {
        urlInput.blur();
        updateWebToolbarState(); // update after blur, otherwise the focus guard skips it
      }
    });
    urlInput.addEventListener("focus", () => urlInput.select());
    urlWrap.appendChild(urlInput);

    // Triple View style repair: deliberately manual and cheap. Automatic
    // health repair runs on the existing 2s panel tick; this button forces
    // both visible panel browsers through docshell + Zen Internet CSS sync.
    const repairStyleBtn = document.createElement("button");
    repairStyleBtn.type = "button";
    repairStyleBtn.className =
      "zen-toolbar-btn bgalazka-panel-style-repair-btn";
    repairStyleBtn.title = "Repair Triple View panel styles";
    repairStyleBtn.style.display = "none";
    repairStyleBtn.appendChild(parseSVG(PREF_ICONS.REPAIR_STYLE));
    // Keep toolbar utility clicks from focusing the panel first. With panel
    // translucency enabled, button focus would otherwise kick :focus-within
    // to its brighter opacity just before the requested action, producing a
    // needless flash/transition. Preventing mousedown focus keeps the action
    // visually direct while the subsequent click still fires normally.
    repairStyleBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    repairStyleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      repairStyleBtn.classList.remove("zen-toolbar-spinning");
      // Restart the one-shot animation even on rapid repeated clicks.
      void repairStyleBtn.offsetWidth;
      repairStyleBtn.classList.add("zen-toolbar-spinning");
      setTimeout(
        () => repairStyleBtn.classList.remove("zen-toolbar-spinning"),
        450,
      );
      repairVisiblePanelPresentation(true);
    });

    // Quick opaque-black backing toggle. This does not overwrite any Look or
    // translucency sliders; turning it off reveals the user's saved values.
    const blackPanelBtn = document.createElement("button");
    blackPanelBtn.type = "button";
    blackPanelBtn.className = "zen-toolbar-btn bgalazka-panel-black-btn";
    blackPanelBtn.appendChild(parseSVG(PREF_ICONS.PANEL_BLACK));
    blackPanelBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    blackPanelBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Runtime state is authoritative; persistence happens after the visual
      // change so this stays immediate even if pref observers are busy.
      const next = !forcePanelBlackState;
      applyForcePanelBlackVisual(next, blackPanelBtn);
      if (getPref(BGALAZKA_EXT_PREFS.FORCE_PANEL_BLACK, false) !== next)
        setPref(BGALAZKA_EXT_PREFS.FORCE_PANEL_BLACK, next);
    });

    // Search-engine quick-switch. When the current HTTP(S) page exposes a
    // recognizable GET search term, each click advances to the next enabled
    // built-in/custom target while preserving that exact term.
    const swapBtn = document.createElement("button");
    swapBtn.className = "zen-toolbar-btn zen-toolbar-swap-btn";
    swapBtn.title = "Search with next selected service";
    swapBtn.style.display = "none"; // shown by updateWebToolbarState() only when a GET search term is detected
    swapBtn.appendChild(parseSVG(PREF_ICONS.SWAP));
    swapBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const b = getActiveAppBrowser();
      if (!b) return;
      const cur = b.currentURI?.spec || "";
      const term = extractGetSearchQuery(cur);
      if (term == null) return;
      const nextTarget = getNextQuickSwitchTarget(cur);
      if (!nextTarget) return;
      const target = nextTarget.template.replaceAll(
        "%s",
        encodeURIComponent(term),
      );
      try {
        const uri = Services.io.newURI(target);
        if (typeof b.fixupAndLoadURIString === "function") {
          b.fixupAndLoadURIString(target, {
            triggeringPrincipal:
              Services.scriptSecurityManager.createContentPrincipal(uri, {}),
          });
        }
      } catch (_) {}
    });

    // Zoom controls follow WEB_TOOLBAR_ZOOM. ZoomManager is a standard global in the browser
    // chrome window; wrapped defensively in case that ever changes.
    const zoomWrap = document.createElement("div");
    zoomWrap.className = "zen-toolbar-zoomwrap";
    const zoomOutBtn = document.createElement("button");
    zoomOutBtn.className = "zen-toolbar-btn zen-toolbar-zoom-btn";
    zoomOutBtn.title = "Zoom out";
    zoomOutBtn.appendChild(parseSVG(PREF_ICONS.ZOOM_OUT));
    const zoomLabel = document.createElement("span");
    zoomLabel.className = "zen-toolbar-zoom-label";
    zoomLabel.title = "Reset zoom";
    zoomLabel.textContent = "100%";
    const zoomInBtn = document.createElement("button");
    zoomInBtn.className = "zen-toolbar-btn zen-toolbar-zoom-btn";
    zoomInBtn.title = "Zoom in";
    zoomInBtn.appendChild(parseSVG(PREF_ICONS.ZOOM_IN));

    const stepZoom = (delta) => {
      const b = getActiveAppBrowser();
      if (!b) return;
      try {
        const cur = ZoomManager.getZoomForBrowser(b);
        const next = delta === 0 ? 1 : Math.max(0.3, Math.min(3, cur + delta));
        ZoomManager.setZoomForBrowser(b, next);
        zoomLabel.textContent = Math.round(next * 100) + "%";
      } catch (_) {}
    };
    zoomOutBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      stepZoom(-0.1);
    });
    zoomLabel.addEventListener("click", (e) => {
      e.stopPropagation();
      stepZoom(0);
    });
    zoomInBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      stepZoom(0.1);
    });
    zoomWrap.append(zoomOutBtn, zoomLabel, zoomInBtn);

    toolbar.append(
      backBtn,
      reloadBtn,
      fwdBtn,
      swapBtn,
      urlWrap,
      zoomWrap,
      repairStyleBtn,
      blackPanelBtn,
    );
    panel.append(hoverZone, toolbar);
    startWebToolbarPolling();
    return true;
  }

  // Refreshes back/forward enabled-state, the URL bar text (unless the user
  // is actively typing in it), and the zoom label, for whichever app browser
  // is currently active. Called after switching apps and on a light polling
  // interval below (SPA/history.pushState navigations don't reliably fire
  // the 'load'/'pageshow' events this file already listens for elsewhere).
  function updateWebToolbarState() {
    const root = document.getElementById("zen-app-panel-root");
    if (
      !root?.hasAttribute("open") ||
      root.hasAttribute("closing") ||
      document.documentElement.getAttribute("bgalazka-webtoolbar") !== "true"
    )
      return;
    const toolbar = document.getElementById("zen-app-panel-toolbar");
    if (!toolbar) return;
    const b = getActiveAppBrowser();
    const backBtn = toolbar.querySelector(".zen-toolbar-back-btn");
    const fwdBtn = toolbar.querySelector(".zen-toolbar-fwd-btn");
    const urlInput = toolbar.querySelector(".zen-toolbar-urlbar");
    const zoomLabel = toolbar.querySelector(".zen-toolbar-zoom-label");
    const swapBtn = toolbar.querySelector(".zen-toolbar-swap-btn");
    const repairStyleBtn = toolbar.querySelector(
      ".bgalazka-panel-style-repair-btn",
    );
    const blackPanelBtn = toolbar.querySelector(".bgalazka-panel-black-btn");

    if (repairStyleBtn) {
      const showRepair =
        getPref(BGALAZKA_EXT_PREFS.SHOW_TRIPLE_STYLE_REPAIR, false) &&
        zenCssEnabled() &&
        document.documentElement.getAttribute("bgalazka-triple-view") ===
          "true" &&
        document.documentElement.getAttribute("bgalazka-triple-populated") ===
          "true";
      const display = showRepair ? "" : "none";
      if (repairStyleBtn.style.display !== display)
        repairStyleBtn.style.display = display;
    }
    if (blackPanelBtn) {
      const mirrored =
        document.documentElement.getAttribute("bgalazka-force-panel-black") ===
        "true";
      if (mirrored !== forcePanelBlackState)
        applyForcePanelBlackVisual(forcePanelBlackState, blackPanelBtn, false);
      else syncForcePanelBlackButton(blackPanelBtn, forcePanelBlackState);
    }

    let curSpec = "";
    try {
      curSpec = b?.currentURI?.spec || "";
    } catch (_) {}

    if (backBtn) backBtn.disabled = !canPanelNavigate(b, -1);
    if (fwdBtn) fwdBtn.disabled = !canPanelNavigate(b, 1);

    if (urlInput && document.activeElement !== urlInput) {
      if (urlInput.value !== curSpec) urlInput.value = curSpec;
    }

    if (zoomLabel) {
      try {
        const label = b
          ? Math.round(ZoomManager.getZoomForBrowser(b) * 100) + "%"
          : "100%";
        if (zoomLabel.textContent !== label) zoomLabel.textContent = label;
      } catch (_) {
        if (zoomLabel.textContent !== "100%") zoomLabel.textContent = "100%";
      }
    }

    // Show only on a recognized search-results GET URL with a useful next
    // destination. A random page with ?q= or one arbitrary parameter is not
    // enough evidence to offer "search again elsewhere".
    if (swapBtn) {
      const quickswitchOn = getPref(
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH,
        false,
      );
      const targets = quickswitchOn ? getQuickSwitchTargets() : [];
      const nextTarget = getNextQuickSwitchTarget(curSpec, targets);
      const show =
        quickswitchOn &&
        nextTarget !== null &&
        extractGetSearchQuery(curSpec) !== null;
      const display = show ? "" : "none";
      if (swapBtn.style.display !== display) swapBtn.style.display = display;
      const title = nextTarget
        ? `Search with ${nextTarget.label}`
        : "Search with next selected service";
      if (swapBtn.title !== title) swapBtn.title = title;
    }
  }

  function periodicFallbackPollingEnabled() {
    return getPref(BGALAZKA_EXT_PREFS.PERIODIC_FALLBACK_POLLING, false);
  }

  // Secondary Triple/Super toolbar installs its concrete synchronizer later.
  // Keeping this callable here lets the Settings toggle affect an already-open
  // Triple View without requiring the user to close/reopen it.
  let syncSecondaryFallbackPolling = () => {};

  let webToolbarPollTimer = null;
  let webToolbarObservedRoot = null;
  let webToolbarVisibilityObserver = null;
  function startWebToolbarPolling() {
    if (extensionDisposed) return;
    const root = document.getElementById("zen-app-panel-root");
    if (root !== webToolbarObservedRoot) {
      webToolbarVisibilityObserver?.disconnect();
      webToolbarObservedRoot = root;
      if (root) {
        webToolbarVisibilityObserver = new MutationObserver(
          startWebToolbarPolling,
        );
        // Attributes on the panel ONLY: never observe tabstrip descendants.
        webToolbarVisibilityObserver.observe(root, {
          attributes: true,
          attributeFilter: ["open", "closing"],
        });
      }
    }
    const active =
      root?.hasAttribute("open") &&
      !root.hasAttribute("closing") &&
      getPref(BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED, false);
    if (active) updateWebToolbarState();
    if (!active || !periodicFallbackPollingEnabled()) {
      clearInterval(webToolbarPollTimer);
      webToolbarPollTimer = null;
      return;
    }
    if (webToolbarPollTimer) return;
    // Normal loads/location changes are event-driven. This optional interval
    // only covers SPA history.pushState/replaceState edge cases.
    webToolbarPollTimer = setInterval(updateWebToolbarState, 1000);
  }
  registerCleanup(() => {
    clearInterval(webToolbarPollTimer);
    webToolbarPollTimer = null;
    webToolbarVisibilityObserver?.disconnect();
  });
  startWebToolbarPolling();

  // BUG FIX: this used to be called from inside patchAppsInstance(), which
  // runs synchronously much earlier in the script — before PREF_ICONS and
  // BGALAZKA_EXT_PREFS (both `const`, declared further up but still after
  // that point) had actually been initialized. Reading PREF_ICONS.BACK from
  // in there threw an uncaught "can't access lexical declaration before
  // initialization" (TDZ) ReferenceError, which — since nothing caught it —
  // silently aborted the rest of the top-level script, breaking every
  // feature wired up further down the file (settings UI, dual-view, the
  // pill peek-dot, corner tiles) while leaving only what had already run
  // before the crash (opposite-docking positioning, translucency) working.
  // Called from here instead, well after both consts exist, with the same
  // retry-until-ready pattern ensureMobileUaMenuItem() uses below, in case
  // #zen-app-panel-slider somehow isn't in the DOM yet at this point.
  if (!safeCall(ensureWebToolbar, "ensureWebToolbar")) {
    let webToolbarAttempts = 0;
    const webToolbarTimer = setInterval(() => {
      webToolbarAttempts++;
      if (
        safeCall(ensureWebToolbar, "ensureWebToolbar") ||
        webToolbarAttempts > 40
      ) {
        clearInterval(webToolbarTimer);
      }
    }, 150);
    registerCleanup(() => clearInterval(webToolbarTimer));
  }

  /* ==========================================================================
   * EXTENSION KEYBINDS
   * -----------------------------------------------------------------------
   * These shortcuts are deliberately opt-in. They are only considered while
   * the floating app panel is open AND the keyboard event belongs to that
   * panel/browser, so enabling them does not turn Zentral into a browser-wide
   * hotkey layer. Settings/text fields keep their normal typing behavior.
   *
   * Bindings are stored as readable canonical strings (e.g. "Escape",
   * "Ctrl+Shift+P", "Alt+ArrowLeft"). The recorder below uses the exact same
   * normalizer as the runtime matcher, so what Settings shows is what matches.
   * ========================================================================== */
  const EXT_KEYBIND_DEFAULTS = Object.freeze({
    CLOSE_PANEL: "Escape",
    BACK: "Alt+ArrowLeft",
    FORWARD: "Alt+ArrowRight",
    RELOAD: "Ctrl+R",
    FOCUS_URL: "Ctrl+L",
    TOGGLE_PIN: "Ctrl+Shift+P",
    TOGGLE_EXPAND: "Ctrl+Shift+E",
    TOGGLE_DUAL_VIEW: "Ctrl+Shift+D",
    TOGGLE_RESIZE: "Ctrl+Shift+R",
    TOGGLE_TOOLBAR: "Ctrl+Shift+T",
    TOGGLE_TRANSLUCENCY: "",
    TOGGLE_OPPOSITE_DOCKING: "",
    TOGGLE_EDGE_ATTACHED: "",
    TOGGLE_INPUT_SHIELD: "",
    ZOOM_IN: "Ctrl+Shift+Plus",
    ZOOM_OUT: "Ctrl+Minus",
    ZOOM_RESET: "Ctrl+0",
    OPEN_SETTINGS: "Ctrl+Shift+Comma",
  });

  const EXT_KEYBIND_ACTIONS = Object.freeze([
    { key: "CLOSE_PANEL", pref: BGALAZKA_EXT_PREFS.KEYBIND_CLOSE_PANEL },
    { key: "BACK", pref: BGALAZKA_EXT_PREFS.KEYBIND_BACK },
    { key: "FORWARD", pref: BGALAZKA_EXT_PREFS.KEYBIND_FORWARD },
    { key: "RELOAD", pref: BGALAZKA_EXT_PREFS.KEYBIND_RELOAD },
    { key: "FOCUS_URL", pref: BGALAZKA_EXT_PREFS.KEYBIND_FOCUS_URL },
    { key: "TOGGLE_PIN", pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_PIN },
    { key: "TOGGLE_EXPAND", pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_EXPAND },
    {
      key: "TOGGLE_DUAL_VIEW",
      pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_DUAL_VIEW,
    },
    { key: "TOGGLE_RESIZE", pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_RESIZE },
    { key: "TOGGLE_TOOLBAR", pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_TOOLBAR },
    {
      key: "TOGGLE_TRANSLUCENCY",
      pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_TRANSLUCENCY,
    },
    {
      key: "TOGGLE_OPPOSITE_DOCKING",
      pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_OPPOSITE_DOCKING,
    },
    {
      key: "TOGGLE_EDGE_ATTACHED",
      pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_EDGE_ATTACHED,
    },
    {
      key: "TOGGLE_INPUT_SHIELD",
      pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_INPUT_SHIELD,
    },
    { key: "ZOOM_IN", pref: BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_IN },
    { key: "ZOOM_OUT", pref: BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_OUT },
    { key: "ZOOM_RESET", pref: BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_RESET },
    { key: "OPEN_SETTINGS", pref: BGALAZKA_EXT_PREFS.KEYBIND_OPEN_SETTINGS },
  ]);

  function normalizeKeybindKey(key) {
    if (!key) return "";
    if (key === " ") return "Space";
    if (key === "+") return "Plus";
    if (key === "-") return "Minus";
    if (key === "," || key === "<") return "Comma";
    if (key === "." || key === ">") return "Period";
    if (key === "Esc") return "Escape";
    if (key === "Left") return "ArrowLeft";
    if (key === "Right") return "ArrowRight";
    if (key === "Up") return "ArrowUp";
    if (key === "Down") return "ArrowDown";
    if (key.length === 1 && /[a-z]/i.test(key)) return key.toUpperCase();
    return key;
  }

  function keybindFromEvent(e) {
    const raw = normalizeKeybindKey(e.key);
    if (!raw || ["Control", "Shift", "Alt", "Meta"].includes(raw)) return "";
    const parts = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
    parts.push(raw);
    return parts.join("+");
  }

  function isEditableKeybindTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
      ),
    );
  }

  function panelOwnsKeyboardEvent(e) {
    const root = document.getElementById("zen-app-panel-root");
    if (!root?.hasAttribute("open") || root.dataset.instaPeek === "true")
      return false;
    const path = e.composedPath?.() || [];
    if (path.includes(root)) return true;
    const active = document.activeElement;
    return Boolean(active && (active === root || root.contains(active)));
  }

  function toggleExtensionBooleanPref(pref, rootAttr = null) {
    const next = !getPref(pref, false);
    setPref(pref, next);
    if (rootAttr) {
      document.documentElement.setAttribute(rootAttr, next ? "true" : "false");
    }
    return next;
  }

  function stepActivePanelZoom(delta) {
    const browser = getActiveAppBrowser?.() || getVisiblePanelBrowser();
    if (!browser) return false;
    try {
      const cur = ZoomManager.getZoomForBrowser(browser);
      const next = delta === 0 ? 1 : Math.max(0.3, Math.min(3, cur + delta));
      ZoomManager.setZoomForBrowser(browser, next);
      updateWebToolbarState?.();
      return true;
    } catch (_) {
      return false;
    }
  }

  function runExtensionKeybindAction(actionKey) {
    const apps = window.Zentral?.Apps;
    const browser = getActiveAppBrowser?.() || getVisiblePanelBrowser();
    switch (actionKey) {
      case "CLOSE_PANEL":
        apps?.closePanel?.();
        return true;
      case "BACK":
        if (!browser) return false;
        try {
          navigatePanelHistory(browser, -1);
          return true;
        } catch (_) {
          return false;
        }
      case "FORWARD":
        if (!browser) return false;
        try {
          navigatePanelHistory(browser, 1);
          return true;
        } catch (_) {
          return false;
        }
      case "RELOAD":
        try {
          browser?.reload?.();
          return Boolean(browser);
        } catch (_) {
          return false;
        }
      case "FOCUS_URL": {
        if (!getPref(BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED, false))
          return false;
        if (!getPref(BGALAZKA_EXT_PREFS.WEB_TOOLBAR_URLBAR, false))
          return false;
        ensureWebToolbar();
        const input = document.querySelector(
          "#zen-app-panel-toolbar .zen-toolbar-urlbar",
        );
        if (!input) return false;
        input.focus();
        input.select?.();
        return true;
      }
      case "TOGGLE_PIN":
        apps?.togglePin?.();
        return Boolean(apps?.togglePin);
      case "TOGGLE_EXPAND":
        apps?.toggleExpand?.();
        return Boolean(apps?.toggleExpand);
      case "TOGGLE_DUAL_VIEW":
        togglePanelPushPreference();
        return true;
      case "TOGGLE_RESIZE":
        toggleExtensionBooleanPref(
          BGALAZKA_EXT_PREFS.ALL_SIDES_RESIZE,
          "bgalazka-all-sides-resize",
        );
        ensurePillAllSidesResizeButton();
        return true;
      case "TOGGLE_TOOLBAR": {
        const enabled = toggleExtensionBooleanPref(
          BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED,
          "bgalazka-webtoolbar",
        );
        if (enabled) ensureWebToolbar();
        updateWebToolbarState();
        return true;
      }
      case "TOGGLE_TRANSLUCENCY":
        toggleExtensionBooleanPref(
          BGALAZKA_EXT_PREFS.TRANSLUCENCY,
          "bgalazka-translucency",
        );
        updateCSSVars();
        return true;
      case "TOGGLE_OPPOSITE_DOCKING":
        toggleExtensionBooleanPref(
          BGALAZKA_EXT_PREFS.OPPOSITE_DOCKING,
          "bgalazka-opposite-docking",
        );
        syncHoverPanelAvailability();
        apps?.positionPanel?.();
        return true;
      case "TOGGLE_EDGE_ATTACHED":
        toggleExtensionBooleanPref(
          BGALAZKA_EXT_PREFS.EDGE_ATTACHED_PANELS,
          "bgalazka-edge-attached-panels",
        );
        applyVerticalResizeExtras(
          document.getElementById("zen-app-panel-root"),
        );
        applyHorizontalPanelOffset(
          document.getElementById("zen-app-panel-root"),
        );
        return true;
      case "TOGGLE_INPUT_SHIELD":
        toggleExtensionBooleanPref(
          BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD,
          "bgalazka-panel-input-shield",
        );
        return true;
      case "ZOOM_IN":
        return stepActivePanelZoom(0.1);
      case "ZOOM_OUT":
        return stepActivePanelZoom(-0.1);
      case "ZOOM_RESET":
        return stepActivePanelZoom(0);
      case "OPEN_SETTINGS":
        window.Zentral?.Settings?.open?.();
        return true;
      default:
        return false;
    }
  }

  const extensionKeybindHandler = (e) => {
    if (e.defaultPrevented || e.repeat) return;
    if (!getPref(BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED, false)) return;
    if (!panelOwnsKeyboardEvent(e)) return;
    if (isEditableKeybindTarget(e.target)) return;

    const pressed = keybindFromEvent(e);
    if (!pressed) return;
    const match = EXT_KEYBIND_ACTIONS.find(({ key, pref }) => {
      const configured = String(getPref(pref, EXT_KEYBIND_DEFAULTS[key]) || "");
      return configured && configured === pressed;
    });
    if (!match) return;

    // Consume the key before Firefox/Zen can also apply its browser-wide
    // shortcut to the selected main tab behind the focused app panel.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    runExtensionKeybindAction(match.key);
  };
  window.addEventListener("keydown", extensionKeybindHandler, true);
  registerCleanup(() =>
    window.removeEventListener("keydown", extensionKeybindHandler, true),
  );

  function createKeybindRow(labelText, sublabelText, prefKey, defaultVal) {
    const row = document.createElement("div");
    row.className = "zs-row zs-keybind-row";

    const labelContainer = document.createElement("div");
    labelContainer.className = "zs-label-container";
    const label = document.createElement("span");
    label.className = "zs-label";
    label.textContent = labelText;
    const sublabel = document.createElement("span");
    sublabel.className = "zs-sublabel";
    sublabel.textContent = sublabelText;
    labelContainer.append(label, sublabel);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "zs-keybind-input";
    input.readOnly = true;
    input.spellcheck = false;
    input.value = getPref(prefKey, defaultVal) || "";
    input.placeholder = "Unassigned";
    input.title = "Click, then press a shortcut. Backspace/Delete clears it.";

    input.addEventListener("focus", () => {
      input.dataset.recording = "true";
      input.select();
    });
    input.addEventListener("blur", () =>
      input.removeAttribute("data-recording"),
    );
    input.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.key === "Backspace" || e.key === "Delete") {
        input.value = "";
        setPref(prefKey, "");
        return;
      }
      const value = keybindFromEvent(e);
      if (!value) return;
      input.value = value;
      setPref(prefKey, value);
      input.blur();
    });

    row.append(labelContainer, input);
    return { row, input };
  }

  function createToggleRow(
    labelText,
    sublabelText,
    prefKey,
    rootAttr,
    defaultVal = false,
    iconSvg = null,
    onChange = null,
  ) {
    const row = document.createElement("div");
    row.className = "zs-row";

    const leftBox = document.createElement("div");
    leftBox.className = "zs-setting-with-icon";

    if (iconSvg) {
      const iconWrapper = document.createElement("div");
      iconWrapper.className = "zs-icon-preview";
      iconWrapper.appendChild(parseSVG(iconSvg));
      leftBox.appendChild(iconWrapper);
    }

    const labelContainer = document.createElement("div");
    labelContainer.className = "zs-label-container";
    const label = document.createElement("span");
    label.className = "zs-label";
    label.textContent = labelText;
    labelContainer.appendChild(label);

    if (sublabelText) {
      const sublabel = document.createElement("span");
      sublabel.className = "zs-sublabel";
      sublabel.textContent = sublabelText;
      labelContainer.appendChild(sublabel);
    }
    leftBox.appendChild(labelContainer);

    const switchLabel = document.createElement("label");
    switchLabel.className = "zs-switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("data-pref", prefKey);
    input.checked = getPref(prefKey, defaultVal);

    input.addEventListener("change", () => {
      setPref(prefKey, input.checked);
      if (rootAttr) {
        document.documentElement.setAttribute(
          rootAttr,
          input.checked ? "true" : "false",
        );
      }
      if (
        prefKey === (EXT_PREFS?.CORNER_TILES || BGALAZKA_EXT_PREFS.CORNER_TILES)
      ) {
        requestTileSync(50);
      }
      if (prefKey === BGALAZKA_EXT_PREFS.PUSH_PAGE) {
        syncPanelPushState();
      }
      if (typeof onChange === "function") {
        onChange(input.checked);
      }
    });

    const slider = document.createElement("span");
    slider.className = "zs-slider";
    switchLabel.appendChild(input);
    switchLabel.appendChild(slider);

    row.appendChild(leftBox);
    row.appendChild(switchLabel);
    return { row, input };
  }

  // Reusable dropdown-style setting row. rootAttr is OPTIONAL: pass a root
  // <html> attribute name to mirror the selected value onto documentElement
  // (for CSS to key off, same convention as createToggleRow's rootAttr), or
  // omit/null it for a setting that's only ever read from JS via getPref().
  function createSelectRow(
    labelText,
    sublabelText,
    prefKey,
    options,
    defaultVal,
    iconSvg,
    rootAttr = null,
    onChange = null,
  ) {
    const row = document.createElement("div");
    row.className = "zs-row";

    const leftBox = document.createElement("div");
    leftBox.className = "zs-setting-with-icon";

    if (iconSvg) {
      const iconWrapper = document.createElement("div");
      iconWrapper.className = "zs-icon-preview";
      iconWrapper.appendChild(parseSVG(iconSvg));
      leftBox.appendChild(iconWrapper);
    }

    const labelContainer = document.createElement("div");
    labelContainer.className = "zs-label-container";
    const label = document.createElement("span");
    label.className = "zs-label";
    label.textContent = labelText;
    labelContainer.appendChild(label);

    if (sublabelText) {
      const sublabel = document.createElement("span");
      sublabel.className = "zs-sublabel";
      sublabel.textContent = sublabelText;
      labelContainer.appendChild(sublabel);
    }
    leftBox.appendChild(labelContainer);

    const select = document.createElement("select");
    select.className = "zs-select-input";
    select.style.cssText = `
      background: #18181b !important;
      color: #ffffff !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      border-radius: 8px !important;
      padding: 4px 10px !important;
      font-size: 12px !important;
      font-weight: 500 !important;
      outline: none !important;
      cursor: pointer !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
    `;

    const currentVal = getPref(prefKey, defaultVal);
    options.forEach((opt) => {
      const optionEl = document.createElement("option");
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      if (opt.value === currentVal) optionEl.selected = true;
      select.appendChild(optionEl);
    });

    select.addEventListener("change", () => {
      setPref(prefKey, select.value);
      // BUG FIX: this used to unconditionally write "bgalazka-pill-position"
      // here regardless of which setting owned the row (a leftover from
      // when this function was only ever sketched out for that one use).
      // Since this function was never actually called anywhere, it was a
      // latent bug rather than an active one — now that it has real
      // callers (search engine picker, etc.), only mirror an attribute
      // when the caller actually asked for one.
      if (rootAttr) {
        document.documentElement.setAttribute(rootAttr, select.value);
      }
      if (typeof onChange === "function") onChange(select.value);
    });

    row.appendChild(leftBox);
    row.appendChild(select);
    return { row, select };
  }

  // Reusable free-text setting row (e.g. pasting a custom search engine
  // URL). Writes the pref on "change" (blur/Enter) rather than on every
  // keystroke, both to avoid hammering Services.prefs while typing and so
  // an in-progress edit isn't half-applied.
  function createTextRow(
    labelText,
    sublabelText,
    prefKey,
    placeholder,
    iconSvg = null,
    onChange = null,
  ) {
    const row = document.createElement("div");
    row.className = "zs-row";
    row.style.display = "flex";
    row.style.flexDirection = "column";
    row.style.alignItems = "stretch";
    row.style.textAlign = "left";
    row.style.padding = "8px 16px";
    row.style.gap = "8px";

    const labelContainer = document.createElement("div");
    labelContainer.className = "zs-label-container";
    labelContainer.style.width = "100%";
    labelContainer.style.textAlign = "left";
    labelContainer.style.alignItems = "flex-start";
    labelContainer.style.display = "flex";
    labelContainer.style.flexDirection = "column";

    const label = document.createElement("span");
    label.className = "zs-label";
    label.style.textAlign = "left";
    label.textContent = labelText;
    labelContainer.appendChild(label);

    if (sublabelText) {
      const sublabel = document.createElement("span");
      sublabel.className = "zs-sublabel";
      sublabel.style.textAlign = "left";
      sublabel.textContent = sublabelText;
      labelContainer.appendChild(sublabel);
    }

    if (iconSvg) {
      const iconWrapper = document.createElement("div");
      iconWrapper.className = "zs-icon-preview";
      iconWrapper.appendChild(parseSVG(iconSvg));
      labelContainer.prepend(iconWrapper);
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = "zs-text-input";
    input.spellcheck = false;
    input.setAttribute("autocomplete", "off");
    if (placeholder) input.placeholder = placeholder;
    input.style.width = "100%";
    input.value = getPref(prefKey, "");

    const commitTextValue = () => {
      const val = input.value.trim();
      if (
        SEARCH_CUSTOM_ENGINE_PREFS.includes(prefKey) &&
        val &&
        !isValidQuickSwitchTemplate(val)
      ) {
        const message =
          'Use an HTTP(S) URL with "%s" for the search term. The previous URL is still saved.';
        input.setCustomValidity(message);
        input.setAttribute("aria-invalid", "true");
        error.textContent = message;
        error.hidden = false;
        return false;
      }
      input.value = val;
      input.setCustomValidity("");
      input.removeAttribute("aria-invalid");
      error.hidden = true;
      if (getPref(prefKey, "") !== val) setPref(prefKey, val);
      if (typeof onChange === "function") onChange(val);
      return true;
    };
    const error = document.createElement("span");
    error.className = "zs-field-error";
    error.id = "zs-error-" + prefKey.replace(/[^a-z0-9_-]/gi, "-");
    error.setAttribute("role", "status");
    error.hidden = true;
    input.setAttribute("aria-label", labelText);
    input.setAttribute("aria-describedby", error.id);
    input.addEventListener("change", commitTextValue);
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (commitTextValue()) input.blur();
    });

    row.appendChild(labelContainer);
    row.appendChild(input);
    row.appendChild(error);
    return { row, input };
  }

  function createSliderRow(
    labelText,
    sublabelText,
    prefKey,
    min,
    max,
    defaultVal,
    suffix,
    toPreference = (value) => value,
    fromPreference = (value) => value,
  ) {
    const row = document.createElement("div");
    row.className = "zs-row";
    row.style.display = "flex";
    row.style.flexDirection = "column";
    row.style.alignItems = "stretch";
    row.style.textAlign = "left";
    row.style.padding = "8px 16px";
    row.style.gap = "8px";

    const labelContainer = document.createElement("div");
    labelContainer.className = "zs-label-container";
    labelContainer.style.width = "100%";
    labelContainer.style.textAlign = "left";
    labelContainer.style.alignItems = "flex-start";
    labelContainer.style.display = "flex";
    labelContainer.style.flexDirection = "column";

    const label = document.createElement("span");
    label.className = "zs-label";
    label.style.textAlign = "left";
    label.textContent = labelText;

    const sublabel = document.createElement("span");
    sublabel.className = "zs-sublabel";
    sublabel.style.textAlign = "left";
    sublabel.textContent = sublabelText;

    labelContainer.appendChild(label);
    labelContainer.appendChild(sublabel);

    const sliderContainer = document.createElement("div");
    sliderContainer.className = "zs-stacked-slider";
    sliderContainer.style.width = "100%";

    const header = document.createElement("div");
    header.className = "zs-stacked-slider-header";
    header.style.display = "flex";
    header.style.justifyContent = "flex-start";
    header.style.alignItems = "center";
    header.style.marginBottom = "4px";

    const badge = document.createElement("span");
    badge.className = "zs-mono-badge";

    const input = document.createElement("input");
    input.type = "range";
    input.className = "zs-range-slider";
    input.style.width = "100%";
    input.min = min;
    input.max = max;
    input.value = fromPreference(getPref(prefKey, defaultVal));
    badge.textContent = input.value + suffix;

    input.addEventListener("input", () => {
      badge.textContent = input.value + suffix;
      setPref(prefKey, toPreference(parseInt(input.value, 10)));
      if (typeof updateCSSVars === "function") {
        updateCSSVars();
      }
    });

    header.appendChild(badge);
    sliderContainer.appendChild(header);
    sliderContainer.appendChild(input);

    row.appendChild(labelContainer);
    row.appendChild(sliderContainer);

    return { row, input, badge };
  }

  function createColorRow(labelText, sublabelText, prefKey, defaultVal) {
    const row = document.createElement("div");
    row.className = "zs-row";

    const leftBox = document.createElement("div");
    leftBox.style.display = "flex";
    leftBox.style.flexDirection = "column";

    const labelContainer = document.createElement("div");
    labelContainer.className = "zs-label-container";
    const label = document.createElement("span");
    label.className = "zs-label";
    label.textContent = labelText;
    labelContainer.appendChild(label);

    if (sublabelText) {
      const sublabel = document.createElement("span");
      sublabel.className = "zs-sublabel";
      sublabel.textContent = sublabelText;
      labelContainer.appendChild(sublabel);
    }
    leftBox.appendChild(labelContainer);

    const input = document.createElement("input");
    input.type = "color";
    input.style.cssText = `
      width: 36px;
      height: 26px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
    `;
    input.value = getPref(prefKey, defaultVal);

    input.addEventListener("input", () => {
      setPref(prefKey, input.value);
      updateCSSVars();
    });

    row.appendChild(leftBox);
    row.appendChild(input);
    return { row, input };
  }

  // The base mod's `Constants` lives inside another IIFE and is not visible
  // here. Keep these exact visual keys local; discover the other base keys
  // from Zentral.Core.defaultPrefs when building a full backup.
  const LOOK_GROUP_PREFS = Object.freeze({
    SHOW_CHEVRON: "zen.workspace.tabgroups.show_chevron",
    INDICATOR_TYPE: "zen.workspace.tabgroups.indicator_type",
    LABEL_OPACITY: "zen.workspace.tabgroups.label_opacity",
  });

  // Appearance belongs to its own preference namespace, so a Look-only file
  // cannot accidentally change panel placement, shortcuts, or browsing data.
  const LOOK_PREFS = Object.freeze({
    STYLE: "zen.workspace.bgalazka.look.style",
    CANVAS: "zen.workspace.bgalazka.look.canvas",
    SURFACE: "zen.workspace.bgalazka.look.surface",
    RAISED: "zen.workspace.bgalazka.look.raised",
    ACCENT: "zen.workspace.bgalazka.look.accent",
    TEXT: "zen.workspace.bgalazka.look.text",
    MUTED: "zen.workspace.bgalazka.look.muted",
    SURFACE_OPACITY: "zen.workspace.bgalazka.look.surface_opacity",
    RAISED_OPACITY: "zen.workspace.bgalazka.look.raised_opacity",
    TOOLBAR_OPACITY: "zen.workspace.bgalazka.look.toolbar_opacity",
    ADDRESS_OPACITY: "zen.workspace.bgalazka.look.address_opacity",
    BUTTON_OPACITY: "zen.workspace.bgalazka.look.button_opacity",
    TILE_OPACITY: "zen.workspace.bgalazka.look.tile_opacity",
    VIDEO_OPACITY: "zen.workspace.bgalazka.look.video_opacity",
    VIDEO_CONTROL_OPACITY: "zen.workspace.bgalazka.look.video_control_opacity",
    POPUP_OPACITY: "zen.workspace.bgalazka.look.popup_opacity",
    RADIUS: "zen.workspace.bgalazka.look.radius",
    DEPTH: "zen.workspace.bgalazka.look.depth",
    SPACING: "zen.workspace.bgalazka.look.spacing",
    VIDEO_RADIUS: "zen.workspace.zentral.video_preview.radius_px",
    PANEL_BORDER: "zen.workspace.bgalazka.look.panel_border",
    TOOLBAR_SURFACE: "zen.workspace.bgalazka.look.toolbar_surface",
    TOOLBAR_URL: "zen.workspace.bgalazka.look.toolbar_url",
    TOOLBAR_BORDER: "zen.workspace.bgalazka.look.toolbar_border",
    BUTTON_STYLE: "zen.workspace.bgalazka.look.button_style",
    BUTTON_SURFACE: "zen.workspace.bgalazka.look.button_surface",
    BUTTON_TEXT: "zen.workspace.bgalazka.look.button_text",
    BUTTON_BORDER_COLOR: "zen.workspace.bgalazka.look.button_border_color",
    BUTTON_BORDER: "zen.workspace.bgalazka.look.button_border",
    CONTROL_SIZE: "zen.workspace.bgalazka.look.control_size",
    TILE_STYLE: "zen.workspace.bgalazka.look.tile_style",
    ROW_STYLE: "zen.workspace.bgalazka.look.row_style",
    ROW_PADDING: "zen.workspace.bgalazka.look.row_padding",
    ROW_RULE: "zen.workspace.bgalazka.look.row_rule",
    VIDEO_CANVAS: "zen.workspace.bgalazka.look.video_canvas",
    VIDEO_CONTROL: "zen.workspace.bgalazka.look.video_control",
    VIDEO_TEXT: "zen.workspace.bgalazka.look.video_text",
    VIDEO_MUTED: "zen.workspace.bgalazka.look.video_muted",
    VIDEO_SELECTED: "zen.workspace.bgalazka.look.video_selected",
    VIDEO_BORDER: "zen.workspace.bgalazka.look.video_border",
    VIDEO_PADDING: "zen.workspace.bgalazka.look.video_padding",
    VIDEO_ROW_HEIGHT: "zen.workspace.bgalazka.look.video_row_height",
    VIDEO_SOURCE_STYLE: "zen.workspace.bgalazka.look.video_source_style",
    TABBAR_COMPACT: EXT_PREFS.TABBAR_COMPACT,
    TABBAR_ROW_HEIGHT: EXT_PREFS.TABBAR_ROW_HEIGHT,
    TABBAR_ROW_GAP: EXT_PREFS.TABBAR_ROW_GAP,
    TABBAR_ICON_GAP: EXT_PREFS.TABBAR_ICON_GAP,
  });
  const LOOK_DEFAULTS = Object.freeze({
    [LOOK_PREFS.STYLE]: "atelier",
    [LOOK_PREFS.CANVAS]: "#17191b",
    [LOOK_PREFS.SURFACE]: "#202224",
    [LOOK_PREFS.RAISED]: "#2b2e31",
    [LOOK_PREFS.ACCENT]: "#a5bec0",
    [LOOK_PREFS.TEXT]: "#dce0e1",
    [LOOK_PREFS.MUTED]: "#a4aaad",
    [LOOK_PREFS.SURFACE_OPACITY]: 100,
    [LOOK_PREFS.RAISED_OPACITY]: 100,
    [LOOK_PREFS.TOOLBAR_OPACITY]: 100,
    [LOOK_PREFS.ADDRESS_OPACITY]: 100,
    [LOOK_PREFS.BUTTON_OPACITY]: 100,
    [LOOK_PREFS.TILE_OPACITY]: 100,
    [LOOK_PREFS.VIDEO_OPACITY]: 100,
    [LOOK_PREFS.VIDEO_CONTROL_OPACITY]: 100,
    [LOOK_PREFS.POPUP_OPACITY]: 100,
    [LOOK_PREFS.RADIUS]: 0,
    [LOOK_PREFS.DEPTH]: 0,
    [LOOK_PREFS.SPACING]: "comfortable",
    [LOOK_PREFS.TABBAR_COMPACT]: false,
    [LOOK_PREFS.TABBAR_ROW_HEIGHT]: 20,
    [LOOK_PREFS.TABBAR_ROW_GAP]: 0,
    [LOOK_PREFS.TABBAR_ICON_GAP]: 4,
    [LOOK_PREFS.VIDEO_RADIUS]: 0,
    [LOOK_PREFS.PANEL_BORDER]: 1,
    [LOOK_PREFS.TOOLBAR_SURFACE]: "#202224",
    [LOOK_PREFS.TOOLBAR_URL]: "#292c2e",
    [LOOK_PREFS.TOOLBAR_BORDER]: 1,
    [LOOK_PREFS.BUTTON_STYLE]: "outline",
    [LOOK_PREFS.BUTTON_SURFACE]: "#34373a",
    [LOOK_PREFS.BUTTON_TEXT]: "#d4d8d9",
    [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#292929",
    [LOOK_PREFS.BUTTON_BORDER]: 0,
    [LOOK_PREFS.CONTROL_SIZE]: 22,
    [LOOK_PREFS.TILE_STYLE]: "bare",
    [LOOK_PREFS.ROW_STYLE]: "lines",
    [LOOK_PREFS.ROW_PADDING]: 4,
    [LOOK_PREFS.ROW_RULE]: 0,
    [LOOK_PREFS.VIDEO_CANVAS]: "#0a0a0a",
    [LOOK_PREFS.VIDEO_CONTROL]: "#000000",
    [LOOK_PREFS.VIDEO_TEXT]: "#d8d8d8",
    [LOOK_PREFS.VIDEO_MUTED]: "#838383",
    [LOOK_PREFS.VIDEO_SELECTED]: "#7d0000",
    [LOOK_PREFS.VIDEO_BORDER]: 0,
    [LOOK_PREFS.VIDEO_PADDING]: 0,
    [LOOK_PREFS.VIDEO_ROW_HEIGHT]: 22,
    [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "line",
    [LOOK_GROUP_PREFS.SHOW_CHEVRON]: true,
    [LOOK_GROUP_PREFS.INDICATOR_TYPE]: "circle",
    [BGALAZKA_EXT_PREFS.TRANSLUCENCY]: true,
    [BGALAZKA_EXT_PREFS.OPACITY_UNPINNED]: 92,
    [BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS]: 85,
    [BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR]: 45,
    [BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR]: "#5e0002",
    [BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY]: 31,
    [BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY]: 48,
    [LOOK_GROUP_PREFS.LABEL_OPACITY]: 85,
  });
  // Presets only write values that also have individual controls below.
  const LOOK_THEMES = Object.freeze([
    { name: "Ink", swatch: "#a5bec0", values: {} },
    {
      name: "Copper",
      swatch: "#d99a6a",
      values: {
        [LOOK_PREFS.CANVAS]: "#1d1917",
        [LOOK_PREFS.SURFACE]: "#29211d",
        [LOOK_PREFS.RAISED]: "#3b2d25",
        [LOOK_PREFS.ACCENT]: "#d99a6a",
        [LOOK_PREFS.TEXT]: "#f4e9dc",
        [LOOK_PREFS.MUTED]: "#c4a998",
        [LOOK_PREFS.TOOLBAR_SURFACE]: "#29211d",
        [LOOK_PREFS.TOOLBAR_URL]: "#372b25",
        [LOOK_PREFS.BUTTON_SURFACE]: "#483326",
        [LOOK_PREFS.BUTTON_TEXT]: "#f4e9dc",
        [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#a86e48",
        [LOOK_PREFS.BUTTON_STYLE]: "outline",
        [LOOK_PREFS.BUTTON_BORDER]: 1,
        [LOOK_PREFS.ROW_STYLE]: "cards",
        [LOOK_PREFS.ROW_RULE]: 1,
        [LOOK_PREFS.RADIUS]: 2,
        [LOOK_PREFS.VIDEO_CANVAS]: "#211c19",
        [LOOK_PREFS.VIDEO_CONTROL]: "#483326",
        [LOOK_PREFS.VIDEO_TEXT]: "#f4e9dc",
        [LOOK_PREFS.VIDEO_MUTED]: "#c4a998",
        [LOOK_PREFS.VIDEO_SELECTED]: "#d99a6a",
      },
    },
    {
      name: "Moss",
      swatch: "#9ab89a",
      values: {
        [LOOK_PREFS.CANVAS]: "#161c18",
        [LOOK_PREFS.SURFACE]: "#1f2921",
        [LOOK_PREFS.RAISED]: "#2b382d",
        [LOOK_PREFS.ACCENT]: "#9ab89a",
        [LOOK_PREFS.TEXT]: "#e1ebe1",
        [LOOK_PREFS.MUTED]: "#a1b2a3",
        [LOOK_PREFS.TOOLBAR_SURFACE]: "#1f2921",
        [LOOK_PREFS.TOOLBAR_URL]: "#29372c",
        [LOOK_PREFS.BUTTON_SURFACE]: "#344739",
        [LOOK_PREFS.BUTTON_TEXT]: "#e1ebe1",
        [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#648069",
        [LOOK_PREFS.BUTTON_STYLE]: "filled",
        [LOOK_PREFS.BUTTON_BORDER]: 0,
        [LOOK_PREFS.TILE_STYLE]: "soft",
        [LOOK_PREFS.VIDEO_CANVAS]: "#1b241d",
        [LOOK_PREFS.VIDEO_CONTROL]: "#344739",
        [LOOK_PREFS.VIDEO_TEXT]: "#e1ebe1",
        [LOOK_PREFS.VIDEO_MUTED]: "#a1b2a3",
        [LOOK_PREFS.VIDEO_SELECTED]: "#9ab89a",
        [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "filled",
      },
    },
    {
      name: "Cobalt",
      swatch: "#90baf2",
      values: {
        [LOOK_PREFS.CANVAS]: "#121b2a",
        [LOOK_PREFS.SURFACE]: "#1b2940",
        [LOOK_PREFS.RAISED]: "#293b59",
        [LOOK_PREFS.ACCENT]: "#90baf2",
        [LOOK_PREFS.TEXT]: "#e7effb",
        [LOOK_PREFS.MUTED]: "#a8bad1",
        [LOOK_PREFS.TOOLBAR_SURFACE]: "#1b2940",
        [LOOK_PREFS.TOOLBAR_URL]: "#253650",
        [LOOK_PREFS.BUTTON_SURFACE]: "#304a70",
        [LOOK_PREFS.BUTTON_TEXT]: "#e7effb",
        [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#729cd0",
        [LOOK_PREFS.BUTTON_STYLE]: "outline",
        [LOOK_PREFS.BUTTON_BORDER]: 1,
        [LOOK_PREFS.RADIUS]: 6,
        [LOOK_PREFS.ROW_STYLE]: "cards",
        [LOOK_PREFS.TILE_STYLE]: "soft",
        [LOOK_PREFS.VIDEO_CANVAS]: "#172236",
        [LOOK_PREFS.VIDEO_CONTROL]: "#304a70",
        [LOOK_PREFS.VIDEO_TEXT]: "#e7effb",
        [LOOK_PREFS.VIDEO_MUTED]: "#a8bad1",
        [LOOK_PREFS.VIDEO_SELECTED]: "#90baf2",
      },
    },
    {
      name: "Transparent",
      swatch: "#ffffff",
      values: {
        [LOOK_PREFS.CANVAS]: "#000000",
        [LOOK_PREFS.SURFACE]: "#000000",
        [LOOK_PREFS.RAISED]: "#000000",
        [LOOK_PREFS.ACCENT]: "#ffffff",
        [LOOK_PREFS.TEXT]: "#ffffff",
        [LOOK_PREFS.MUTED]: "#d0d0d0",
        [LOOK_PREFS.TOOLBAR_SURFACE]: "#000000",
        [LOOK_PREFS.TOOLBAR_URL]: "#000000",
        [LOOK_PREFS.BUTTON_SURFACE]: "#000000",
        [LOOK_PREFS.BUTTON_TEXT]: "#ffffff",
        [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#ffffff",
        [LOOK_PREFS.VIDEO_CANVAS]: "#000000",
        [LOOK_PREFS.VIDEO_CONTROL]: "#000000",
        [LOOK_PREFS.VIDEO_TEXT]: "#ffffff",
        [LOOK_PREFS.VIDEO_MUTED]: "#d0d0d0",
        [LOOK_PREFS.VIDEO_SELECTED]: "#ffffff",
        [LOOK_PREFS.SURFACE_OPACITY]: 20,
        [LOOK_PREFS.RAISED_OPACITY]: 25,
        [LOOK_PREFS.TOOLBAR_OPACITY]: 28,
        [LOOK_PREFS.ADDRESS_OPACITY]: 18,
        [LOOK_PREFS.BUTTON_OPACITY]: 22,
        [LOOK_PREFS.TILE_OPACITY]: 18,
        [LOOK_PREFS.VIDEO_OPACITY]: 25,
        [LOOK_PREFS.VIDEO_CONTROL_OPACITY]: 22,
        [LOOK_PREFS.POPUP_OPACITY]: 35,
        [LOOK_PREFS.RADIUS]: 0,
        [LOOK_PREFS.VIDEO_RADIUS]: 0,
        [LOOK_PREFS.DEPTH]: 0,
        [LOOK_PREFS.PANEL_BORDER]: 0,
        [LOOK_PREFS.TOOLBAR_BORDER]: 0,
        [LOOK_PREFS.BUTTON_BORDER]: 0,
        [LOOK_PREFS.VIDEO_BORDER]: 0,
        [LOOK_PREFS.ROW_RULE]: 0,
        [LOOK_PREFS.BUTTON_STYLE]: "filled",
        [LOOK_PREFS.TILE_STYLE]: "soft",
        [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "line",
        [BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY]: 55,
      },
    },
    {
      name: "Orchid",
      swatch: "#c9a4dc",
      values: {
        [LOOK_PREFS.CANVAS]: "#201923",
        [LOOK_PREFS.SURFACE]: "#2d2231",
        [LOOK_PREFS.RAISED]: "#423149",
        [LOOK_PREFS.ACCENT]: "#c9a4dc",
        [LOOK_PREFS.TEXT]: "#f1e9f3",
        [LOOK_PREFS.MUTED]: "#bfadbf",
        [LOOK_PREFS.TOOLBAR_SURFACE]: "#2d2231",
        [LOOK_PREFS.TOOLBAR_URL]: "#3b2c41",
        [LOOK_PREFS.BUTTON_SURFACE]: "#503a58",
        [LOOK_PREFS.BUTTON_TEXT]: "#f1e9f3",
        [LOOK_PREFS.BUTTON_BORDER_COLOR]: "#9875a6",
        [LOOK_PREFS.BUTTON_STYLE]: "filled",
        [LOOK_PREFS.BUTTON_BORDER]: 1,
        [LOOK_PREFS.RADIUS]: 10,
        [LOOK_PREFS.ROW_STYLE]: "cards",
        [LOOK_PREFS.SPACING]: "airy",
        [LOOK_PREFS.VIDEO_CANVAS]: "#281e2b",
        [LOOK_PREFS.VIDEO_CONTROL]: "#503a58",
        [LOOK_PREFS.VIDEO_TEXT]: "#f1e9f3",
        [LOOK_PREFS.VIDEO_MUTED]: "#bfadbf",
        [LOOK_PREFS.VIDEO_SELECTED]: "#c9a4dc",
        [LOOK_PREFS.VIDEO_SOURCE_STYLE]: "filled",
      },
    },
  ]);
  const LOOK_KEYS = new Set(Object.keys(LOOK_DEFAULTS));
  const LOOK_TRANSPARENCY_KEYS = new Set([
    LOOK_PREFS.SURFACE_OPACITY,
    LOOK_PREFS.RAISED_OPACITY,
    LOOK_PREFS.TOOLBAR_OPACITY,
    LOOK_PREFS.ADDRESS_OPACITY,
    LOOK_PREFS.BUTTON_OPACITY,
    LOOK_PREFS.TILE_OPACITY,
    LOOK_PREFS.VIDEO_OPACITY,
    LOOK_PREFS.VIDEO_CONTROL_OPACITY,
    LOOK_PREFS.POPUP_OPACITY,
  ]);
  // One schema drives import validation, live CSS variables and visible
  // controls. New Look values belong here and in the Look panel below.
  const LOOK_COLORS = [
    "CANVAS",
    "SURFACE",
    "RAISED",
    "ACCENT",
    "TEXT",
    "MUTED",
    "TOOLBAR_SURFACE",
    "TOOLBAR_URL",
    "BUTTON_SURFACE",
    "BUTTON_TEXT",
    "BUTTON_BORDER_COLOR",
    "VIDEO_CANVAS",
    "VIDEO_CONTROL",
    "VIDEO_TEXT",
    "VIDEO_MUTED",
    "VIDEO_SELECTED",
  ];
  const LOOK_ENUMS = Object.freeze({
    [LOOK_PREFS.STYLE]: ["atelier", "classic"],
    [LOOK_PREFS.SPACING]: ["compact", "comfortable", "airy"],
    [LOOK_PREFS.BUTTON_STYLE]: ["plain", "filled", "outline"],
    [LOOK_PREFS.TILE_STYLE]: ["bare", "soft"],
    [LOOK_PREFS.ROW_STYLE]: ["lines", "cards"],
    [LOOK_PREFS.VIDEO_SOURCE_STYLE]: ["line", "filled"],
    [LOOK_GROUP_PREFS.INDICATOR_TYPE]: ["circle", "chevron"],
  });
  const LOOK_BOUNDS = Object.freeze({
    ...Object.fromEntries(
      [
        LOOK_PREFS.SURFACE_OPACITY,
        LOOK_PREFS.RAISED_OPACITY,
        LOOK_PREFS.TOOLBAR_OPACITY,
        LOOK_PREFS.ADDRESS_OPACITY,
        LOOK_PREFS.BUTTON_OPACITY,
        LOOK_PREFS.TILE_OPACITY,
        LOOK_PREFS.VIDEO_OPACITY,
        LOOK_PREFS.VIDEO_CONTROL_OPACITY,
        LOOK_PREFS.POPUP_OPACITY,
      ].map((key) => [key, [0, 100]]),
    ),
    [LOOK_PREFS.RADIUS]: [0, 26],
    [LOOK_PREFS.DEPTH]: [0, 100],
    [LOOK_PREFS.VIDEO_RADIUS]: [0, 24],
    [LOOK_PREFS.PANEL_BORDER]: [0, 3],
    [LOOK_PREFS.TOOLBAR_BORDER]: [0, 3],
    [LOOK_PREFS.BUTTON_BORDER]: [0, 3],
    [LOOK_PREFS.CONTROL_SIZE]: [18, 32],
    [LOOK_PREFS.ROW_PADDING]: [4, 20],
    [LOOK_PREFS.ROW_RULE]: [0, 2],
    [LOOK_PREFS.VIDEO_BORDER]: [0, 3],
    [LOOK_PREFS.VIDEO_PADDING]: [0, 16],
    [LOOK_PREFS.VIDEO_ROW_HEIGHT]: [22, 36],
    [LOOK_PREFS.TABBAR_ROW_HEIGHT]: [18, 36],
    [LOOK_PREFS.TABBAR_ROW_GAP]: [0, 8],
    [LOOK_PREFS.TABBAR_ICON_GAP]: [0, 12],
    [LOOK_GROUP_PREFS.LABEL_OPACITY]: [0, 100],
    [BGALAZKA_EXT_PREFS.OPACITY_UNPINNED]: [10, 100],
    [BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS]: [10, 100],
    [BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR]: [10, 100],
    [BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY]: [10, 100],
    [BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY]: [10, 100],
  });
  const applyLook = () => {
    const root = document.documentElement;
    for (const [key, attribute] of [
      ["STYLE", "bgalazka-look"],
      ["SPACING", "bgalazka-look-spacing"],
      ["BUTTON_STYLE", "bgalazka-look-buttons"],
      ["TILE_STYLE", "bgalazka-look-tiles"],
      ["ROW_STYLE", "bgalazka-look-rows"],
      ["VIDEO_SOURCE_STYLE", "bgalazka-look-video-selection"],
    ]) {
      const pref = LOOK_PREFS[key];
      const value = getPref(pref, LOOK_DEFAULTS[pref]);
      root.setAttribute(
        attribute,
        LOOK_ENUMS[pref].includes(value) ? value : LOOK_DEFAULTS[pref],
      );
    }
    for (const key of LOOK_COLORS) {
      const pref = LOOK_PREFS[key];
      const value = getPref(pref, LOOK_DEFAULTS[pref]);
      root.style.setProperty(
        "--bgalazka-look-" + key.toLowerCase().replaceAll("_", "-"),
        /^#[0-9a-fA-F]{6}$/.test(value) ? value : LOOK_DEFAULTS[pref],
      );
    }
    for (const key of [
      "RADIUS",
      "DEPTH",
      "VIDEO_RADIUS",
      "PANEL_BORDER",
      "TOOLBAR_BORDER",
      "BUTTON_BORDER",
      "CONTROL_SIZE",
      "ROW_PADDING",
      "ROW_RULE",
      "VIDEO_BORDER",
      "VIDEO_PADDING",
      "VIDEO_ROW_HEIGHT",
      "TABBAR_ROW_HEIGHT",
      "TABBAR_ROW_GAP",
      "TABBAR_ICON_GAP",
      "SURFACE_OPACITY",
      "RAISED_OPACITY",
      "TOOLBAR_OPACITY",
      "ADDRESS_OPACITY",
      "BUTTON_OPACITY",
      "TILE_OPACITY",
      "VIDEO_OPACITY",
      "VIDEO_CONTROL_OPACITY",
      "POPUP_OPACITY",
    ]) {
      const pref = LOOK_PREFS[key];
      const value = getPref(pref, LOOK_DEFAULTS[pref]);
      const [min, max] = LOOK_BOUNDS[pref];
      const clamped =
        typeof value === "number" && Number.isFinite(value)
          ? Math.max(min, Math.min(max, value))
          : LOOK_DEFAULTS[pref];
      root.style.setProperty(
        "--bgalazka-look-" + key.toLowerCase().replaceAll("_", "-"),
        key === "DEPTH" || key.endsWith("_OPACITY")
          ? clamped + "%"
          : clamped + "px",
      );
    }
  };
  // A visual preference error must not halt panel hooks or Settings loading.
  // Keep this optional startup path isolated from the rest of the extension.
  try {
    applyLook();
    Services.prefs.addObserver("zen.workspace.bgalazka.look.", applyLook);
    registerCleanup(() =>
      Services.prefs.removeObserver("zen.workspace.bgalazka.look.", applyLook),
    );
    Services.prefs.addObserver(LOOK_PREFS.VIDEO_RADIUS, applyLook);
    registerCleanup(() =>
      Services.prefs.removeObserver(LOOK_PREFS.VIDEO_RADIUS, applyLook),
    );
  } catch (error) {
    console.error("[BgalazkaExtension] Look initialization failed:", error);
  }

  function syncAppearanceAfterImport() {
    applyLook();
    updateCSSVars();
    applyAttributes();
    window.Zentral?.TabGroups?.applyLabelOpacityPref?.();
    window.Zentral?.TabGroups?.applyChevronPref?.();
    window.Zentral?.TabGroups?.applyIndicatorTypePref?.();
    window.Zentral?.Settings?.populate?.();
    const videoRadius = document.getElementById("zs-video-preview-radius");
    if (videoRadius) {
      videoRadius.value = getPref(LOOK_PREFS.VIDEO_RADIUS, 0);
      videoRadius.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const panel = document.getElementById("zs-panel-bgalazka");
    panel?._toggles?.forEach(({ input, pref, def, onSync, isSelect }) => {
      const value = getPref(pref, def);
      if (isSelect) input.value = value;
      else input.checked = value;
      onSync?.(value);
    });
    document.getElementById("zs-panel-extension-look")?._syncLook?.();
  }

  // Export only owned preference keys; reject arbitrary keys and malformed
  // data before applying anything. Import merges selected keys into this profile.
  // Core owns the base default table. Reading it through the exposed
  // instance avoids reaching across IIFE scope and tracks future base keys.
  const baseBackupKeys = () =>
    new Set(Object.keys(window.Zentral?.Core?.defaultPrefs || {}));
  const reusableBaseDefaults = new Set([
    "zen.workspace.apps.sidebar.animation_speed",
    "zen.workspace.apps.sidebar.animation_type",
    "zen.workspace.apps.sidebar.apps_per_row",
    "zen.workspace.apps.sidebar.max_apps",
    "zen.workspace.apps.sidebar.max_rows",
    "zen.workspace.apps.sidebar.hide_utility_section",
    "zen.workspace.tabgroups.enabled",
    "zen.workspace.tabgroups.thumbnails",
  ]);
  const fullBackupKeys = () =>
    new Set([
      ...baseBackupKeys(),
      ...Object.keys(PROFILE_DEFAULTS),
      ...Services.prefs.getChildList("zen.workspace.bgalazka."),
      ...Services.prefs.getChildList("zen.workspace.zentral.video_preview."),
      ...LOOK_KEYS,
    ]);
  const ownedBackupKey = (key) =>
    LOOK_KEYS.has(key) ||
    baseBackupKeys().has(key) ||
    key.startsWith("zen.workspace.bgalazka.") ||
    key.startsWith("zen.workspace.zentral.video_preview.");
  async function chooseBackupFile(mode, title, defaultName) {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker,
    );
    picker.init(window.browsingContext || window, title, mode);
    picker.appendFilter("JSON files", "*.json");
    if (defaultName) picker.defaultString = defaultName;
    const result = await new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      try {
        const maybe = picker.open({ done });
        if (maybe?.then) maybe.then(done, () => done(null));
      } catch (_) {
        try {
          const maybe = picker.open(done);
          if (maybe?.then) maybe.then(done, () => done(null));
        } catch (_) {
          done(null);
        }
      }
    });
    return result === Ci.nsIFilePicker.returnOK ||
      result === Ci.nsIFilePicker.returnReplace
      ? picker.file?.path
      : null;
  }
  async function exportBackup(scope) {
    const prefs = {};
    for (const key of scope === "look" ? LOOK_KEYS : fullBackupKeys()) {
      const baseline =
        LOOK_DEFAULTS[key] ??
        PROFILE_DEFAULTS[key] ??
        (reusableBaseDefaults.has(key)
          ? window.Zentral?.Core?.defaultPrefs?.[key]
          : undefined);
      if (
        scope === "full" &&
        !Services.prefs.prefHasUserValue(key) &&
        baseline === undefined
      )
        continue;
      const type = Services.prefs.getPrefType(key);
      const fallback = baseline;
      try {
        prefs[key] =
          !Services.prefs.prefHasUserValue(key) && fallback !== undefined
            ? fallback
            : type === Services.prefs.PREF_BOOL
              ? Services.prefs.getBoolPref(key)
              : type === Services.prefs.PREF_INT
                ? Services.prefs.getIntPref(key)
                : type === Services.prefs.PREF_STRING
                  ? Services.prefs.getStringPref(key)
                  : fallback;
      } catch (_) {
        if (fallback !== undefined) prefs[key] = fallback;
      }
    }
    const path = await chooseBackupFile(
      Ci.nsIFilePicker.modeSave,
      "Export Zentral " + scope + " settings",
      "zentral-" +
        scope +
        "-" +
        new Date().toISOString().slice(0, 10) +
        ".json",
    );
    if (!path) return false;
    await IOUtils.writeUTF8(
      path,
      JSON.stringify(
        { format: "zentral-settings", version: 1, scope, prefs },
        null,
        2,
      ),
    );
    return true;
  }
  async function importBackup(scope) {
    const path = await chooseBackupFile(
      Ci.nsIFilePicker.modeOpen,
      "Import Zentral " + scope + " settings",
    );
    if (!path) return false;
    if ((await IOUtils.stat(path)).size > 16 * 1024 * 1024)
      throw new Error("Settings file is too large");
    const data = JSON.parse(await IOUtils.readUTF8(path));
    if (
      data?.format !== "zentral-settings" ||
      data.version !== 1 ||
      !["look", "full"].includes(data.scope) ||
      !data.prefs ||
      Array.isArray(data.prefs) ||
      typeof data.prefs !== "object"
    )
      throw new Error("Not a supported Zentral settings file");
    if (scope === "full" && data.scope !== "full")
      throw new Error("Choose a full settings export here");
    const entries = Object.entries(data.prefs);
    if (entries.length > 1500 || !entries.length)
      throw new Error("Invalid settings count");
    const changes = entries.filter(
      ([key]) => scope === "full" || LOOK_KEYS.has(key),
    );
    if (scope === "look" && !changes.length)
      throw new Error("No Look options in this file");
    for (const [key, value] of entries) {
      if (
        !ownedBackupKey(key) ||
        (data.scope === "look" && !LOOK_KEYS.has(key)) ||
        !["string", "boolean", "number"].includes(typeof value) ||
        (typeof value === "number" && !Number.isSafeInteger(value)) ||
        (typeof value === "string" && value.length > 8 * 1024 * 1024)
      )
        throw new Error("Invalid preference in settings file: " + key);
      if (LOOK_KEYS.has(key)) {
        const expected = LOOK_DEFAULTS[key];
        if (
          typeof value !== typeof expected ||
          ([
            ...LOOK_COLORS.map((name) => LOOK_PREFS[name]),
            BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
          ].includes(key) &&
            !/^#[0-9a-fA-F]{6}$/.test(value)) ||
          (LOOK_ENUMS[key] && !LOOK_ENUMS[key].includes(value)) ||
          (LOOK_BOUNDS[key] &&
            (value < LOOK_BOUNDS[key][0] || value > LOOK_BOUNDS[key][1]))
        )
          throw new Error("Invalid Look value: " + key);
      }
    }
    // Store original types as well: a malformed or interrupted write can be
    // rolled back without discarding an existing preference.
    const previous = new Map(
      changes.map(([key]) => {
        const hadUserValue = Services.prefs.prefHasUserValue(key);
        const type = Services.prefs.getPrefType(key);
        const value = hadUserValue
          ? type === Services.prefs.PREF_BOOL
            ? Services.prefs.getBoolPref(key)
            : type === Services.prefs.PREF_INT
              ? Services.prefs.getIntPref(key)
              : type === Services.prefs.PREF_STRING
                ? Services.prefs.getStringPref(key)
                : undefined
          : undefined;
        return [key, { hadUserValue, value }];
      }),
    );
    try {
      for (const [key, value] of changes) {
        if (
          previous.get(key).hadUserValue &&
          typeof previous.get(key).value !== typeof value
        )
          Services.prefs.clearUserPref(key);
        if (typeof value === "boolean") Services.prefs.setBoolPref(key, value);
        else if (typeof value === "number")
          Services.prefs.setIntPref(key, value);
        else Services.prefs.setStringPref(key, value);
      }
    } catch (error) {
      for (const [key, { hadUserValue, value }] of previous) {
        try {
          if (Services.prefs.prefHasUserValue(key))
            Services.prefs.clearUserPref(key);
          if (hadUserValue) setPref(key, value);
        } catch (_) {}
      }
      throw error;
    }
    syncAppearanceAfterImport();
    return true;
  }
  function addLookBackupControls(container) {
    const heading = document.createElement("h4");
    heading.className = "zs-look-heading";
    heading.textContent = "Import & export";
    const note = document.createElement("p");
    note.className = "zs-look-note";
    note.textContent =
      "Look files contain appearance only. Full files contain Zentral settings and panel preferences; imported values merge with your current profile. Restart Zen for changes outside Look to take full effect.";
    const actions = document.createElement("div");
    actions.className = "zs-look-actions";
    for (const [label, action, scope] of [
      ["Export Look", exportBackup, "look"],
      ["Import Look", importBackup, "look"],
      ["Export all settings", exportBackup, "full"],
      ["Import all settings", importBackup, "full"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zs-look-action";
      button.textContent = label;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          if (await action(scope)) window.alert(label + " complete.");
        } catch (error) {
          console.error("[Zentral] Settings transfer failed:", error);
          window.alert(label + " failed: " + error.message);
        } finally {
          button.disabled = false;
        }
      });
      actions.append(button);
    }
    container.append(heading, note, actions);
  }

  /* RSS sidebar display only. Zen owns fetching, tab creation, dismissal and
   * session state. This never moves or closes its tabs or folders. An empty
   * live folder can still contain Zen's restoration placeholder; only tabs
   * explicitly marked as placeholders may be ignored. No tabstrip subtree observer: that
   * pattern can crash Gecko during pinning (architecture note 4). */
  const rssMarkedFolders = new Set();
  let rssScanTimer = null;
  const rssEnabled = () =>
    getPref(EXT_PREFS.RSS_HIDE_EMPTY, false) ||
    getPref(EXT_PREFS.RSS_COMPACT_HEADERS, false);
  function clearRssMarks() {
    for (const folder of rssMarkedFolders) {
      folder.removeAttribute("bgalazka-rss-live-folder");
      folder.removeAttribute("bgalazka-rss-empty");
    }
    rssMarkedFolders.clear();
  }
  function isNativeLiveFolder(folder) {
    // Zen versions expose the live-folder flag either as a DOM property or
    // an attribute. Fail closed if neither is present: ordinary folders must
    // never be hidden simply because they are empty.
    return (
      folder.isLiveFolder === true ||
      (folder.hasAttribute("is-live-folder") &&
        folder.getAttribute("is-live-folder") !== "false") ||
      folder.getAttribute("isLiveFolder") === "true" ||
      (folder.hasAttribute("zen-live-folder") &&
        folder.getAttribute("zen-live-folder") !== "false") ||
      (folder.hasAttribute("data-is-live-folder") &&
        folder.getAttribute("data-is-live-folder") !== "false")
    );
  }
  function scanRssFolders() {
    if (!rssEnabled()) return;
    const live = new Set();
    for (const folder of document.querySelectorAll(
      "#tabbrowser-tabs zen-folder",
    )) {
      if (!isNativeLiveFolder(folder)) continue;
      live.add(folder);
      if (!folder.hasAttribute("bgalazka-rss-live-folder"))
        folder.setAttribute("bgalazka-rss-live-folder", "true");
      // Track before inspecting children, so failure cleanup also clears the
      // current folder's marker instead of leaving a partially hidden row.
      rssMarkedFolders.add(folder);
      // A manually placed tab or nested folder is content too. Zen's
      // restoration placeholder is not an article and must not keep an
      // otherwise empty live folder visible.
      const hasContent =
        Boolean(
          folder.querySelector("tab[selected], .tabbrowser-tab[selected]"),
        ) ||
        [...folder.querySelectorAll("tab, .tabbrowser-tab, zen-folder")].some(
          (child) => {
            if (child.localName === "zen-folder") return true;
            if (child.hasAttribute("zen-live-folder-item-id")) return true;
            if (
              child.hasAttribute("zen-empty-tab") ||
              child.hasAttribute("zen-folder-empty-tab")
            )
              return false;
            // A real tab may also be about:blank. Treat every unmarked tab as
            // content; an unknown Zen placeholder leaves its folder visible.
            return true;
          },
        );
      if (folder.hasAttribute("bgalazka-rss-empty") === hasContent)
        folder.toggleAttribute("bgalazka-rss-empty", !hasContent);
    }
    for (const folder of rssMarkedFolders) {
      if (live.has(folder)) continue;
      folder.removeAttribute("bgalazka-rss-live-folder");
      folder.removeAttribute("bgalazka-rss-empty");
      rssMarkedFolders.delete(folder);
    }
  }
  function safeScanRssFolders() {
    try {
      scanRssFolders();
    } catch (error) {
      console.warn("[BgalazkaExtension] RSS display scan failed:", error);
      clearRssMarks();
    }
  }
  function syncRssFolderDisplay() {
    const enabled = rssEnabled();
    document.documentElement.toggleAttribute(
      "bgalazka-rss-hide-empty",
      getPref(EXT_PREFS.RSS_HIDE_EMPTY, false),
    );
    document.documentElement.toggleAttribute(
      "bgalazka-rss-compact-headers",
      getPref(EXT_PREFS.RSS_COMPACT_HEADERS, false),
    );
    if (!enabled) {
      if (rssScanTimer !== null) clearInterval(rssScanTimer);
      rssScanTimer = null;
      clearRssMarks();
      return;
    }
    safeScanRssFolders();
    if (rssScanTimer === null)
      rssScanTimer = setInterval(safeScanRssFolders, 2000);
  }
  for (const pref of [
    EXT_PREFS.RSS_HIDE_EMPTY,
    EXT_PREFS.RSS_COMPACT_HEADERS,
  ]) {
    try {
      Services.prefs.addObserver(pref, syncRssFolderDisplay);
      registerCleanup(() => {
        try {
          Services.prefs.removeObserver(pref, syncRssFolderDisplay);
        } catch (_) {}
      });
    } catch (error) {
      console.warn("[BgalazkaExtension] RSS pref observer unavailable:", error);
    }
  }
  registerCleanup(() => {
    if (rssScanTimer !== null) clearInterval(rssScanTimer);
    clearRssMarks();
    document.documentElement.removeAttribute("bgalazka-rss-hide-empty");
    document.documentElement.removeAttribute("bgalazka-rss-compact-headers");
  });
  syncRssFolderDisplay();

  function injectSettingsUI() {
    const modal = document.getElementById("zentral-settings-modal");
    if (!modal) return;
    const tabBar = modal.querySelector(".zs-tab-bar");
    const body = modal.querySelector(".zs-body");
    if (!tabBar || !body) return;

    let tabBtn = modal.querySelector("#zs-tab-btn-bgalazka");
    let panel = modal.querySelector("#zs-panel-bgalazka");

    if (!panel) {
      panel = document.createElement("div");
      panel.id = "zs-panel-bgalazka";
      panel.className = "zs-tab-panel";
      panel.setAttribute("data-panel", "bgalazka");

      const header = document.createElement("div");
      header.className = "zs-section-header";

      const titleGroup = document.createElement("div");
      titleGroup.className = "zs-title-group";

      const title = document.createElement("h3");
      title.className = "zs-section-title";
      title.textContent = "Panel & Apps";

      const badge = document.createElement("span");
      badge.className = "zs-version-badge";
      badge.textContent = "Bgalazka extension";

      titleGroup.appendChild(title);
      titleGroup.appendChild(badge);

      const restartBtn = document.createElement("button");
      restartBtn.className = "zs-restart-btn";
      restartBtn.id = "zs-bg-restart-btn";
      restartBtn.type = "button";
      restartBtn.title =
        "Restart Zen Browser immediately to reload scripts and reset cache";

      const restartSvg = parseSVG(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;"><path d="M13.8 6.5A5.5 5.5 0 1 0 8 13.5a5.5 5.5 0 0 0 5.2-3.7M14 2v4.5H9.5"/></svg>`,
      );
      const restartText = document.createElement("span");
      restartText.textContent = "Restart Browser";
      restartText.style.pointerEvents = "none";

      restartBtn.appendChild(restartSvg);
      restartBtn.appendChild(restartText);
      restartBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        restartBrowser();
      });

      header.appendChild(titleGroup);
      header.appendChild(restartBtn);
      panel.appendChild(header);

      const content = document.createElement("div");
      content.className = "zs-section-content";
      content.style.paddingTop = "14px";
      panel._toggles = [];

      // ====================================================================
      // 1. Panel Appearance & Translucency
      // ====================================================================
      const aestheticHeader = document.createElement("div");
      aestheticHeader.className = "zs-section-header";
      aestheticHeader.style.marginTop = "8px";
      const aesTitle = document.createElement("h3");
      aesTitle.className = "zs-section-title";
      aesTitle.textContent = "Panel Appearance & Translucency";
      aestheticHeader.appendChild(aesTitle);
      // The appearance heading moves to the Look category below.

      const slidersGroup = document.createElement("div");
      slidersGroup.className = "zs-conditional-group";
      slidersGroup.id = "zs-translucency-sliders-group";

      const t1 = createToggleRow(
        "Pinned Panel Translucency",
        "Frosted glass effect when pinned; automatically becomes solid when Dual-View pushes page",
        BGALAZKA_EXT_PREFS.TRANSLUCENCY,
        "bgalazka-translucency",
        false,
        PREF_ICONS.GLASS,
        (enabled) =>
          slidersGroup.setAttribute("data-hidden", enabled ? "false" : "true"),
      );
      content.appendChild(t1.row);

      const s1 = createSliderRow(
        "Unpinned Opacity",
        "Base solidness of standard floating panels",
        BGALAZKA_EXT_PREFS.OPACITY_UNPINNED,
        10,
        100,
        92,
        "%",
      );
      const s2 = createSliderRow(
        "Pinned Focus Opacity",
        "Solidness when hovering or interacting with pinned panels",
        BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS,
        10,
        100,
        85,
        "%",
      );
      const s3 = createSliderRow(
        "Pinned Idle Opacity",
        "Translucency limit when panel is pinned and unfocused",
        BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR,
        10,
        100,
        45,
        "%",
      );
      slidersGroup.append(s1.row, s2.row, s3.row);
      slidersGroup.setAttribute(
        "data-hidden",
        getPref(BGALAZKA_EXT_PREFS.TRANSLUCENCY, false) ? "false" : "true",
      );
      content.appendChild(slidersGroup);

      const tPanelInputShield = createToggleRow(
        "Prevent Panel Input Pass-Through",
        "Keep clicks inside an open panel and route mouse Back/Forward buttons to the focused panel instead of the webpage behind it",
        BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD,
        "bgalazka-panel-input-shield",
        false,
        PREF_ICONS.ISOLATION,
      );
      content.appendChild(tPanelInputShield.row);

      // ====================================================================
      // 2. Workspace Layout & Dual-View
      // ====================================================================
      const dockHeader = document.createElement("div");
      dockHeader.className = "zs-section-header";
      dockHeader.style.marginTop = "20px";
      const dockTitle = document.createElement("h3");
      dockTitle.className = "zs-section-title";
      dockTitle.textContent = "Workspace Layout & Dual-View";
      dockHeader.appendChild(dockTitle);
      content.appendChild(dockHeader);

      const t2 = createToggleRow(
        "Opposite-Side Docking & Controls",
        "Dock floating panels, pill menus, and resize handles opposite to active sidebar",
        BGALAZKA_EXT_PREFS.OPPOSITE_DOCKING,
        "bgalazka-opposite-docking",
        false,
        PREF_ICONS.DOCK,
        (enabled) => {
          syncHoverPanelAvailability();
        },
      );
      content.appendChild(t2.row);

      const tHoverReveal = createToggleRow(
        "Show Opposite-Side Panels on Hover",
        "Requires Opposite-Side Docking. Leave a panel to hide it, then hover the outer edge to reveal it",
        BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL,
        null,
        false,
        PREF_ICONS.HOVER_EYE,
        () => syncHoverPanelAvailability(),
      );
      content.appendChild(tHoverReveal.row);

      const tEdgeAttached = createToggleRow(
        "Edge-Attached Panels",
        "Dock every floating panel flush to its current screen edge and temporarily ignore saved panel margins/position offsets; does not pin or push the webpage",
        BGALAZKA_EXT_PREFS.EDGE_ATTACHED_PANELS,
        "bgalazka-edge-attached-panels",
        false,
        PREF_ICONS.DOCK,
        () => {
          const root = document.getElementById("zen-app-panel-root");
          applyVerticalResizeExtras(root);
          applyHorizontalPanelOffset(root);
        },
      );
      content.appendChild(tEdgeAttached.row);

      const tPush = createToggleRow(
        "Dual-View Mode",
        "Keep the panel open and contract the active webpage beside it; does not change your manual Pin state. Triple View has its own push choice on the pill button.",
        BGALAZKA_EXT_PREFS.PUSH_PAGE,
        "bgalazka-push-page",
        false,
        PREF_ICONS.PUSH,
      );
      content.appendChild(tPush.row);

      // Mirrors the pill button of the same name (note 16): both read/write
      // BGALAZKA_EXT_PREFS.ALL_SIDES_RESIZE, so this row's onChange keeps
      // the pill button's own data-active state in sync when toggled here.
      const tAllSidesResize = createToggleRow(
        "All-Sides Panel Resize",
        "Enable outer, inner, top, bottom, and corner resize handles; drag this pill button freely to move the whole panel in 2D",
        BGALAZKA_EXT_PREFS.ALL_SIDES_RESIZE,
        "bgalazka-all-sides-resize",
        false,
        PREF_ICONS.RESIZE_ALL,
        () => ensurePillAllSidesResizeButton(),
      );
      content.appendChild(tAllSidesResize.row);

      const panelHorizontalOffsetBounds = (() => {
        const root = document.getElementById("zen-app-panel-root");
        if (!root?.hasAttribute("open")) {
          const fallback = Math.max(1, window.innerWidth);
          return { min: -fallback, max: fallback };
        }
        applyHorizontalPanelOffset(root);
        return getHorizontalOffsetBounds(root);
      })();
      const panelHorizontalOffsetSlider = createSliderRow(
        "Panel Horizontal Offset",
        "Move the whole floating panel left/right without changing its width; limits are the actual window borders",
        BGALAZKA_EXT_PREFS.PANEL_HORIZONTAL_OFFSET,
        Math.floor(panelHorizontalOffsetBounds.min),
        Math.ceil(panelHorizontalOffsetBounds.max),
        getHorizontalOffsetPreference(
          document.getElementById("zen-app-panel-root"),
        ),
        "px",
      );
      content.appendChild(panelHorizontalOffsetSlider.row);

      // ====================================================================
      // 3. Floating Panel Pill Controls
      // ====================================================================
      const pillHeader = document.createElement("div");
      pillHeader.className = "zs-section-header";
      pillHeader.style.marginTop = "20px";
      const pillTitle = document.createElement("h3");
      pillTitle.className = "zs-section-title";
      pillTitle.textContent = "Floating Panel Pill Controls";
      pillHeader.appendChild(pillTitle);
      content.appendChild(pillHeader);

      const pillSubgroup = document.createElement("div");
      pillSubgroup.className = "zs-conditional-group";

      const tMasterPill = createToggleRow(
        "Hide Floating Pill Menu",
        "Completely hide the side action capsule on the app panel",
        BGALAZKA_EXT_PREFS.HIDE_PILL,
        "bgalazka-hide-pill",
        false,
        PREF_ICONS.PILL,
        (hidden) =>
          pillSubgroup.setAttribute("data-hidden", hidden ? "true" : "false"),
      );
      content.appendChild(tMasterPill.row);

      // NOTE: this used to be a "top"/"center"/"bottom" dropdown backed by a
      // string pref. It never actually persisted (see the string-branch fix
      // in getPref/setPref above) and only offered 3 fixed spots. Replaced
      // with a continuous -50%..+50% offset from center (0% = centered),
      // matching createSliderRow's existing number-pref handling, which
      // already worked correctly. The CSS side (chrome.css) clamps the
      // computed position so the pill can never be pushed fully off-screen
      // even at the extreme -50%/+50% ends — see "Pill Menu Vertical Offset"
      // in chrome.css for the failsafe.
      const pillPosSlider = createSliderRow(
        "Pill Menu Vertical Offset",
        "-50% anchors near the top, +50% near the bottom, 0% is centered",
        BGALAZKA_EXT_PREFS.PILL_POSITION,
        -50,
        50,
        0,
        "%",
      );
      const tPeekDot = createToggleRow(
        "Show Mini Pill When Idle",
        "Keep a small colored version of the pill visible instead of fully autohiding",
        BGALAZKA_EXT_PREFS.PILL_PEEK_DOT,
        "bgalazka-pill-peek-dot",
        false,
        PREF_ICONS.PILL_POS,
      );
      const peekColorRow = createColorRow(
        "Mini Pill Color",
        "Background color used only for the shrunk idle pill (the expanded pill always uses black)",
        BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
        "#4da6ff",
      );
      const peekOpacitySlider = createSliderRow(
        "Mini Pill Opacity",
        "Controls only the shrunk idle mini pill; 100% is fully opaque",
        BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY,
        10,
        100,
        90,
        "%",
      );
      const pillBackgroundOpacitySlider = createSliderRow(
        "Pill Background Opacity",
        "Controls the expanded pill's black background independently from Mini Pill Opacity; icons remain fully opaque",
        BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY,
        10,
        100,
        90,
        "%",
      );
      const tDualView = createToggleRow(
        "Hide Dual-View Button",
        "Remove dual-view toggle from pill menu",
        BGALAZKA_EXT_PREFS.HIDE_DUAL_VIEW,
        "bgalazka-hide-dual-view",
        false,
        PREF_ICONS.PUSH,
      );
      const tHideHoverRevealBtn = createToggleRow(
        "Hide Show-on-Hover Pill Button",
        "Remove the eye button from the panel pill; use the setting above to enable hover reveal",
        BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
        "bgalazka-hide-hover-reveal-btn",
        false,
        PREF_ICONS.HOVER_EYE,
        () => syncHideHoverControls(),
      );
      const tHideHoverRevealBtnPillCategory = createToggleRow(
        "Hide Show-on-Hover Pill Button",
        "Remove the eye button from the panel pill",
        BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
        "bgalazka-hide-hover-reveal-btn",
        false,
        PREF_ICONS.HOVER_EYE,
        () => syncHideHoverControls(),
      );
      const syncHideHoverControls = () => {
        const hidden = getPref(BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN, false);
        tHideHoverRevealBtn.input.checked = hidden;
        tHideHoverRevealBtnPillCategory.input.checked = hidden;
        syncHoverPanelAvailability();
      };
      const tHideAllSidesResizeBtn = createToggleRow(
        "Hide All-Sides Resize Button",
        "Remove all-sides resize toggle from pill menu (the settings row above still works)",
        BGALAZKA_EXT_PREFS.HIDE_ALL_SIDES_RESIZE_BTN,
        "bgalazka-hide-all-sides-resize-btn",
        false,
        PREF_ICONS.RESIZE_ALL,
      );
      const tPin = createToggleRow(
        "Hide Pin Button",
        "Remove panel pinning toggle",
        BGALAZKA_EXT_PREFS.HIDE_PIN,
        "bgalazka-hide-pin",
        false,
        PREF_ICONS.PIN,
      );
      const t5 = createToggleRow(
        "Hide Expand / Restore Button",
        "Remove full-width panel expand toggle",
        BGALAZKA_EXT_PREFS.HIDE_EXPAND,
        "bgalazka-hide-expand",
        false,
        PREF_ICONS.EXPAND,
      );
      const tGrabber = createToggleRow(
        "Hide Resize Grabber Handle",
        "Remove the 6-dot drag-resize handle",
        BGALAZKA_EXT_PREFS.HIDE_GRABBER,
        "bgalazka-hide-grabber",
        false,
        PREF_ICONS.GRABBER,
      );
      const tRefresh = createToggleRow(
        "Hide Refresh Button",
        "Remove active web app reload button",
        BGALAZKA_EXT_PREFS.HIDE_REFRESH,
        "bgalazka-hide-refresh",
        false,
        PREF_ICONS.REFRESH,
      );
      const tClose = createToggleRow(
        "Hide Close Button",
        "Remove close 'X' button from pill menu",
        BGALAZKA_EXT_PREFS.HIDE_CLOSE,
        "bgalazka-hide-close",
        false,
        PREF_ICONS.CLOSE,
      );

      pillSubgroup.append(
        pillPosSlider.row,
        tPeekDot.row,
        peekColorRow.row,
        peekOpacitySlider.row,
        pillBackgroundOpacitySlider.row,
      );
      pillSubgroup.setAttribute(
        "data-hidden",
        getPref(BGALAZKA_EXT_PREFS.HIDE_PILL, false) ? "true" : "false",
      );
      content.appendChild(pillSubgroup);

      // ====================================================================
      // 3b. Extension — Hide Pill Controls
      // ====================================================================
      const hidePillHeader = document.createElement("div");
      hidePillHeader.className = "zs-section-header";
      hidePillHeader.style.marginTop = "20px";
      const hidePillTitle = document.createElement("h3");
      hidePillTitle.className = "zs-section-title";
      hidePillTitle.textContent = "Extension — Hide Pill Controls";
      hidePillHeader.appendChild(hidePillTitle);
      content.appendChild(hidePillHeader);

      const hidePillGroup = document.createElement("div");
      hidePillGroup.className =
        "zs-conditional-group zs-hide-pill-controls-group";
      hidePillGroup.append(
        tDualView.row,
        tHideHoverRevealBtnPillCategory.row,
        tHideAllSidesResizeBtn.row,
        tPin.row,
        t5.row,
        tGrabber.row,
        tRefresh.row,
        tClose.row,
      );
      content.appendChild(hidePillGroup);
      tHoverReveal.row.after(tHideHoverRevealBtn.row);

      // ====================================================================
      // 4. Web Panel Navigation Toolbar
      // ====================================================================
      const toolbarHeader = document.createElement("div");
      toolbarHeader.className = "zs-section-header";
      toolbarHeader.style.marginTop = "20px";
      const toolbarTitle = document.createElement("h3");
      toolbarTitle.className = "zs-section-title";
      toolbarTitle.textContent = "Web Panel Navigation Toolbar";
      toolbarHeader.appendChild(toolbarTitle);
      content.appendChild(toolbarHeader);

      const webToolbarSubgroup = document.createElement("div");
      webToolbarSubgroup.className = "zs-conditional-group";

      const tWebToolbar = createToggleRow(
        "Enable Navigation Toolbar",
        "Back / forward / reload + URL bar docked at the bottom of the web panel",
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED,
        "bgalazka-webtoolbar",
        false,
        PREF_ICONS.TOOLBAR,
        (enabled) =>
          webToolbarSubgroup.setAttribute(
            "data-hidden",
            enabled ? "false" : "true",
          ),
      );
      content.appendChild(tWebToolbar.row);

      const tToolbarAutohide = createToggleRow(
        "Only Show Toolbar on Hover",
        "Keep the web panel full-height; reveal the toolbar only when hovering its edge",
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_AUTOHIDE,
        "bgalazka-webtoolbar-autohide",
        false,
      );
      const tToolbarTop = createToggleRow(
        "Move Toolbar to Top of Panel",
        "Dock back/forward/reload/URL bar at the top of the web panel instead of the bottom",
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_TOP,
        "bgalazka-webtoolbar-top",
        false,
      );
      const tToolbarUrlbar = createToggleRow(
        "Show URL Bar",
        "Display and allow editing the current page's address",
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_URLBAR,
        "bgalazka-webtoolbar-urlbar",
        false,
      );
      const tToolbarZoom = createToggleRow(
        "Show Zoom Controls",
        "Add page zoom in/out/reset buttons to the toolbar",
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ZOOM,
        "bgalazka-webtoolbar-zoom",
        false,
      );

      // Custom engines are always visible in their dedicated category. This
      // makes creating a second engine discoverable instead of hiding the
      // fields behind the selected default and the quick-switch toggle.
      const customSearchSubgroup = document.createElement("div");
      customSearchSubgroup.className = "zs-search-engine-list zs-settings-card";
      const tSearchCustomUrl = createTextRow(
        "Custom Engine 1",
        'Must contain a literal "%s" placeholder for the search term, e.g. https://example.com/search?q=%s',
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_CUSTOM_URL,
        "https://example.com/search?q=%s",
        null,
        () => syncCustomSearchOptions(),
      );
      customSearchSubgroup.append(tSearchCustomUrl.row);

      const tSearchEngine = createSelectRow(
        "Default Search Engine",
        'Used when the URL bar text isn\'t a URL, e.g. typing "weather" instead of a full address',
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_ENGINE,
        [
          ...QUICK_SWITCH_BUILTIN_TARGETS.map(({ key, label }) => ({
            value: key,
            label,
          })),
          { value: "browser", label: "Browser Default" },
          { value: "custom", label: "Custom Engine 1" },
          ...QUICK_SWITCH_CUSTOM_PREFS.map((_, index) => ({
            value: `custom-${index + 2}`,
            label: `Custom Engine ${index + 2}`,
          })),
        ],
        "ddg",
        PREF_ICONS.SWAP,
        null, // no root attribute to mirror; only read via getPref() in buildSearchUrl()
        (value) => {
          // Re-fetch Firefox's own default engine right when the user
          // picks this mode, rather than only at startup, in case they
          // changed their system default engine since the browser opened.
          if (value === "browser") refreshBrowserSearchTemplate();
        },
      );

      const quickSwitchTargetsSubgroup = document.createElement("div");
      quickSwitchTargetsSubgroup.className = "zs-conditional-group";

      const quickSwitchTargetsHeader = document.createElement("div");
      quickSwitchTargetsHeader.className = "zs-section-header";
      const quickSwitchTargetsTitle = document.createElement("h3");
      quickSwitchTargetsTitle.className = "zs-section-title";
      quickSwitchTargetsTitle.textContent = "Quick-Switch Destinations";
      quickSwitchTargetsHeader.appendChild(quickSwitchTargetsTitle);

      const quickSwitchTargetRows = QUICK_SWITCH_BUILTIN_TARGETS.map(
        (target, index) =>
          createToggleRow(
            target.label,
            "Include in the Quick-Switch cycle",
            QUICK_SWITCH_TARGET_PREF_PREFIX + target.key,
            null,
            index < 2,
            null,
          ),
      );
      const quickSwitchCustomRows = QUICK_SWITCH_CUSTOM_PREFS.map(
        (pref, index) =>
          createTextRow(
            `Custom Engine ${index + 2}`,
            'Optional HTTP(S) GET template containing "%s", e.g. https://example.com/search?q=%s',
            pref,
            "https://example.com/search?q=%s",
            null,
            () => syncCustomSearchOptions(),
          ),
      );
      const syncCustomSearchOptions = () => {
        SEARCH_CUSTOM_ENGINE_PREFS.forEach((pref, index) => {
          const value = index === 0 ? "custom" : `custom-${index + 1}`;
          const option = Array.from(tSearchEngine.select.options).find(
            (o) => o.value === value,
          );
          if (!option) return;
          option.disabled = !isValidQuickSwitchTemplate(getPref(pref, ""));
          option.textContent =
            `Custom Engine ${index + 1}` +
            (option.disabled ? " (add a valid URL)" : "");
        });
      };
      syncCustomSearchOptions();
      quickSwitchTargetsSubgroup.append(
        quickSwitchTargetsHeader,
        ...quickSwitchTargetRows.map(({ row }) => row),
      );
      customSearchSubgroup.append(
        ...quickSwitchCustomRows.map(({ row }) => row),
      );

      const tQuickswitch = createToggleRow(
        "Search Engine Quick-Switch Button",
        "Shows on HTTP(S) pages with a detectable GET search term and cycles through the selected destinations",
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH,
        null,
        false,
        PREF_ICONS.SWAP,
        (enabled) =>
          quickSwitchTargetsSubgroup.setAttribute(
            "data-hidden",
            enabled ? "false" : "true",
          ),
      );
      quickSwitchTargetsSubgroup.setAttribute(
        "data-hidden",
        getPref(BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH, false)
          ? "false"
          : "true",
      );

      webToolbarSubgroup.append(
        tToolbarAutohide.row,
        tToolbarTop.row,
        tToolbarUrlbar.row,
        tToolbarZoom.row,
      );
      webToolbarSubgroup.setAttribute(
        "data-hidden",
        getPref(BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED, false)
          ? "false"
          : "true",
      );
      content.appendChild(webToolbarSubgroup);

      // ====================================================================
      // 5. Firefox Add-on Compatibility
      // ====================================================================
      const addonCompatHeader = document.createElement("div");
      addonCompatHeader.className = "zs-section-header";
      addonCompatHeader.style.marginTop = "20px";
      const addonCompatTitle = document.createElement("h3");
      addonCompatTitle.className = "zs-section-title";
      addonCompatTitle.textContent = "Firefox Add-on Compatibility";
      addonCompatHeader.appendChild(addonCompatTitle);
      content.appendChild(addonCompatHeader);

      const tAddonTabIdBridge = createToggleRow(
        "Real Tab IDs for Web Panels",
        "Back each loaded Zentral app with a real pinned Firefox tab so WebExtensions/add-ons receive a genuine tabId. Host tabs are kept inside a collapsed, ultra-compact ‘Zentral Add-on Hosts’ Zen folder. Toggling this unloads currently loaded web panels so they can be recreated safely.",
        BGALAZKA_EXT_PREFS.ADDON_TAB_ID_BRIDGE,
        "bgalazka-addon-tab-id-bridge",
        false,
        PREF_ICONS.PIN,
        (enabled) => setAddonTabIdBridgeEnabled(enabled),
      );
      content.appendChild(tAddonTabIdBridge.row);
      const tZenInternetCss = createToggleRow(
        "Use Zen Internet CSS in Web Panels (experimental)",
        "Read Zen Internet's locally stored styles and its global, per-site, skip-list, and feature settings. Apply them only inside Zentral web panels. Zentral makes no network requests for styles and never selects tabs or changes Zen Internet's storage. Real Tab IDs are optional.",
        BGALAZKA_EXT_PREFS.ZEN_INTERNET_PANEL_CSS,
        "bgalazka-zen-internet-panel-css",
        false,
        PREF_ICONS.REFRESH,
        (enabled) => setZenInternetPanelCssEnabled(enabled),
      );
      content.appendChild(tZenInternetCss.row);
      const tShowTripleStyleRepair = createToggleRow(
        "Show Triple View Style Repair Button",
        "Show the manual repair control at the end of the primary panel URL bar while Triple View is populated. Leave this off when the automatic document-generation styling fix is working normally.",
        BGALAZKA_EXT_PREFS.SHOW_TRIPLE_STYLE_REPAIR,
        null,
        false,
        PREF_ICONS.REPAIR_STYLE,
        () => updateWebToolbarState(),
      );
      content.appendChild(tShowTripleStyleRepair.row);
      const tPeriodicFallbackPolling = createToggleRow(
        "Periodic Fallback Polling",
        "Enable low-frequency safety polling for panel activation/CSS health plus primary and secondary toolbar state. Normal loads, navigation, styling, audio and panel lifecycle remain event-driven with this off. Turn it on only if your Zen build still develops stale or gray panels/UI over time.",
        BGALAZKA_EXT_PREFS.PERIODIC_FALLBACK_POLLING,
        null,
        false,
        PREF_ICONS.REFRESH,
        () => {
          startWebToolbarPolling();
          syncPanelFallbackPolling();
          syncSecondaryFallbackPolling();
        },
      );
      content.appendChild(tPeriodicFallbackPolling.row);
      const tShowAddonHostFolder = createToggleRow(
        "Show Web Panel Tab ID Folder",
        "Reveal the Zentral Add-on Hosts folder and its tabs in the sidebar so you can check whether panel host tabs are cleaned up. Requires Real Tab IDs for Web Panels to create host tabs.",
        BGALAZKA_EXT_PREFS.SHOW_ADDON_HOST_FOLDER,
        "bgalazka-show-addon-host-folder",
        false,
        PREF_ICONS.PIN,
        () => {
          keepAddonHostFolderCollapsed(findAddonHostFolder());
          updateAddonHostInspection();
        },
      );
      content.appendChild(tShowAddonHostFolder.row);
      const addonHostInspection = document.createElement("div");
      addonHostInspection.id = "zs-addon-host-inspection";
      addonHostInspection.className = "zs-sublabel";
      addonHostInspection.style.cssText =
        "padding:4px 12px 12px;white-space:normal";
      content.appendChild(addonHostInspection);
      updateAddonHostInspection();

      const audioIndicator = createToggleRow(
        "Panel Audio Indicator and Quick Mute",
        "Show audio on panel launcher buttons and quick mute in the URL bar; silent panels have no audio control",
        BGALAZKA_EXT_PREFS.AUDIO_INDICATOR,
        null,
        false,
        PREF_ICONS.SOUND || PREF_ICONS.ISOLATION,
        () => {
          ensureNativeAudioButton();
          refreshPanelAudio();
        },
      );
      content.appendChild(audioIndicator.row);
      const smartSleep = createToggleRow(
        "Smart Sleep (defer preloads)",
        "Defer configured background panel preloads at startup; opened panels keep running",
        BGALAZKA_EXT_PREFS.SMART_SLEEP,
        null,
        false,
        PREF_ICONS.ISOLATION,
        () => requestTileSync(0),
      );
      content.appendChild(smartSleep.row);
      // ====================================================================
      // 6. Extension Keybinds
      // ====================================================================
      const keybindHeader = document.createElement("div");
      keybindHeader.className = "zs-section-header";
      keybindHeader.style.marginTop = "20px";
      const keybindTitle = document.createElement("h3");
      keybindTitle.className = "zs-section-title";
      keybindTitle.textContent = "Extension Keybinds";
      keybindHeader.appendChild(keybindTitle);
      content.appendChild(keybindHeader);

      const keybindSubgroup = document.createElement("div");
      keybindSubgroup.className = "zs-conditional-group zs-keybinds-group";

      const tMmbUnloadNormalTabs = createToggleRow(
        "Middle-Click Unloads Normal Tabs",
        "Middle-click a loaded normal tab to unload it instead of closing it; middle-click an already unloaded normal tab to close it",
        BGALAZKA_EXT_PREFS.MMB_UNLOAD_NORMAL_TABS,
        null,
        false,
        PREF_ICONS.TOOLBAR,
      );
      content.appendChild(tMmbUnloadNormalTabs.row);

      const tKeybindsEnabled = createToggleRow(
        "Enable Extension Keybinds",
        "Shortcuts only apply while the floating app panel is open and focused; click any binding below and press a new combination",
        BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED,
        null,
        false,
        PREF_ICONS.TOOLBAR,
        (enabled) => {
          keybindSubgroup.setAttribute(
            "data-hidden",
            enabled ? "false" : "true",
          );
          if (enabled) {
            setPref(BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, true);
            document.documentElement.setAttribute(
              "bgalazka-panel-input-shield",
              "true",
            );
            tPanelInputShield.input.checked = true;
          }
        },
      );
      content.appendChild(tKeybindsEnabled.row);

      const keybindRows = [
        [
          "Close Panel",
          "Close the focused app panel",
          BGALAZKA_EXT_PREFS.KEYBIND_CLOSE_PANEL,
          EXT_KEYBIND_DEFAULTS.CLOSE_PANEL,
        ],
        [
          "Back",
          "Navigate the focused panel back",
          BGALAZKA_EXT_PREFS.KEYBIND_BACK,
          EXT_KEYBIND_DEFAULTS.BACK,
        ],
        [
          "Forward",
          "Navigate the focused panel forward",
          BGALAZKA_EXT_PREFS.KEYBIND_FORWARD,
          EXT_KEYBIND_DEFAULTS.FORWARD,
        ],
        [
          "Reload",
          "Reload the focused app page",
          BGALAZKA_EXT_PREFS.KEYBIND_RELOAD,
          EXT_KEYBIND_DEFAULTS.RELOAD,
        ],
        [
          "Focus Panel URL Bar",
          "Focus/select the extension URL bar when that toolbar and URL bar are enabled",
          BGALAZKA_EXT_PREFS.KEYBIND_FOCUS_URL,
          EXT_KEYBIND_DEFAULTS.FOCUS_URL,
        ],
        [
          "Toggle Pin",
          "Pin or unpin the focused panel",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_PIN,
          EXT_KEYBIND_DEFAULTS.TOGGLE_PIN,
        ],
        [
          "Expand / Restore",
          "Toggle full-width panel expansion",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_EXPAND,
          EXT_KEYBIND_DEFAULTS.TOGGLE_EXPAND,
        ],
        [
          "Toggle Dual-View",
          "Turn Dual-View page push on/off",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_DUAL_VIEW,
          EXT_KEYBIND_DEFAULTS.TOGGLE_DUAL_VIEW,
        ],
        [
          "Toggle All-Sides Resize",
          "Enable/disable extension resize handles",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_RESIZE,
          EXT_KEYBIND_DEFAULTS.TOGGLE_RESIZE,
        ],
        [
          "Toggle Navigation Toolbar",
          "Show/hide the extension web navigation toolbar",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_TOOLBAR,
          EXT_KEYBIND_DEFAULTS.TOGGLE_TOOLBAR,
        ],
        [
          "Toggle Panel Translucency",
          "Enable/disable extension panel translucency",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_TRANSLUCENCY,
          EXT_KEYBIND_DEFAULTS.TOGGLE_TRANSLUCENCY,
        ],
        [
          "Toggle Opposite-Side Docking",
          "Switch extension opposite-side docking on/off",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_OPPOSITE_DOCKING,
          EXT_KEYBIND_DEFAULTS.TOGGLE_OPPOSITE_DOCKING,
        ],
        [
          "Toggle Edge-Attached Panels",
          "Attach/detach the panel from its current window edge",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_EDGE_ATTACHED,
          EXT_KEYBIND_DEFAULTS.TOGGLE_EDGE_ATTACHED,
        ],
        [
          "Toggle Input Pass-Through Shield",
          "Enable/disable the extension panel input barrier",
          BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_INPUT_SHIELD,
          EXT_KEYBIND_DEFAULTS.TOGGLE_INPUT_SHIELD,
        ],
        [
          "Zoom In",
          "Increase zoom of the focused app page",
          BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_IN,
          EXT_KEYBIND_DEFAULTS.ZOOM_IN,
        ],
        [
          "Zoom Out",
          "Decrease zoom of the focused app page",
          BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_OUT,
          EXT_KEYBIND_DEFAULTS.ZOOM_OUT,
        ],
        [
          "Reset Zoom",
          "Reset focused app page zoom to 100%",
          BGALAZKA_EXT_PREFS.KEYBIND_ZOOM_RESET,
          EXT_KEYBIND_DEFAULTS.ZOOM_RESET,
        ],
        [
          "Open Zentral Settings",
          "Open Zentral Settings from the focused app panel",
          BGALAZKA_EXT_PREFS.KEYBIND_OPEN_SETTINGS,
          EXT_KEYBIND_DEFAULTS.OPEN_SETTINGS,
        ],
      ].map(([label, description, pref, def]) =>
        createKeybindRow(label, description, pref, def),
      );
      keybindRows.forEach(({ row }) => keybindSubgroup.appendChild(row));
      keybindSubgroup.setAttribute(
        "data-hidden",
        getPref(BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED, false) ? "false" : "true",
      );
      content.appendChild(keybindSubgroup);

      // ====================================================================
      // 7. Tab Corner App Tiles
      // ====================================================================
      const cornerHeader = document.createElement("div");
      cornerHeader.className = "zs-section-header";
      cornerHeader.style.marginTop = "20px";
      const cornerTitle = document.createElement("h3");
      cornerTitle.className = "zs-section-title";
      cornerTitle.textContent = "Tab Corner App Tiles";
      cornerHeader.appendChild(cornerTitle);
      content.appendChild(cornerHeader);

      const cornerSubgroup = document.createElement("div");
      cornerSubgroup.className = "zs-conditional-group";

      const t4 = createToggleRow(
        "Panels on Essentials",
        "Give each tab marked Essential its own independent panel launcher",
        BGALAZKA_EXT_PREFS.CORNER_TILES,
        "bgalazka-corner-tiles",
        false,
        PREF_ICONS.CORNER,
        (enabled) =>
          cornerSubgroup.setAttribute(
            "data-hidden",
            enabled ? "false" : "true",
          ),
      );
      content.appendChild(t4.row);

      const tAllTabs = createToggleRow(
        "Panel Launchers on All Tabs",
        "Also show panel launchers over the favicon of non-essential tabs; their panel copies stay independent",
        BGALAZKA_EXT_PREFS.ALL_TAB_PANELS,
        "bgalazka-all-tab-panels",
        false,
        PREF_ICONS.CORNER,
        () => requestTileSync(0),
      );
      const tHoverCorner = createToggleRow(
        "Show Tab Panel Launchers on Hover",
        "Hide panel buttons until tab hover; normal tabs keep their favicon and gain a blue launcher outline on hover",
        BGALAZKA_EXT_PREFS.HOVER_CORNER_TILES,
        "bgalazka-hover-corner-tiles",
        false,
        PREF_ICONS.HOVER_EYE,
      );
      const t3 = createToggleRow(
        "Show Loaded Panel Dot on Tabs",
        "Show a dot on ordinary tabs with loaded panels. Essential panel buttons gray out when their panels unload",
        BGALAZKA_EXT_PREFS.TAB_ISOLATION,
        "bgalazka-tab-isolation",
        true,
        PREF_ICONS.ISOLATION,
      );
      const tBadges = createToggleRow(
        "Hide Corner Notification Badges",
        "Suppress unread indicators and counter badges on tab corner tiles",
        BGALAZKA_EXT_PREFS.HIDE_CORNER_BADGES,
        "bgalazka-hide-corner-badges",
        false,
        PREF_ICONS.BADGE,
      );
      cornerSubgroup.append(
        tAllTabs.row,
        tHoverCorner.row,
        t3.row,
        tBadges.row,
      );
      cornerSubgroup.setAttribute(
        "data-hidden",
        getPref(BGALAZKA_EXT_PREFS.CORNER_TILES, false) ? "false" : "true",
      );
      content.appendChild(cornerSubgroup);

      const tHideUnattached = createToggleRow(
        "Hide Unattached App Controls",
        "Hide standalone app buttons, Add App, and the three-dot utility controls; tab-attached panel launchers remain available",
        BGALAZKA_EXT_PREFS.HIDE_UNATTACHED_APP_CONTROLS,
        "bgalazka-hide-unattached-app-controls",
        false,
        PREF_ICONS.CORNER,
      );
      content.appendChild(tHideUnattached.row);

      panel._toggles.push(
        ...[s1, s2, s3].map(({ input, badge }, index) => ({
          input,
          pref: [
            BGALAZKA_EXT_PREFS.OPACITY_UNPINNED,
            BGALAZKA_EXT_PREFS.OPACITY_PINNED_FOCUS,
            BGALAZKA_EXT_PREFS.OPACITY_PINNED_BLUR,
          ][index],
          def: [92, 85, 45][index],
          isSelect: true,
          onSync: (v) => {
            badge.textContent = v + "%";
          },
        })),
        {
          input: t1.input,
          pref: BGALAZKA_EXT_PREFS.TRANSLUCENCY,
          def: false,
          onSync: (v) =>
            slidersGroup.setAttribute("data-hidden", v ? "false" : "true"),
        },
        {
          input: tPanelInputShield.input,
          pref: BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD,
          def: false,
        },
        {
          input: t2.input,
          pref: BGALAZKA_EXT_PREFS.OPPOSITE_DOCKING,
          def: false,
          onSync: () => syncHoverPanelAvailability(),
        },
        {
          input: tHoverReveal.input,
          pref: BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL,
          def: false,
          onSync: () => syncHoverPanelAvailability(),
        },
        {
          input: tEdgeAttached.input,
          pref: BGALAZKA_EXT_PREFS.EDGE_ATTACHED_PANELS,
          def: false,
          onSync: () => {
            const root = document.getElementById("zen-app-panel-root");
            applyVerticalResizeExtras(root);
            applyHorizontalPanelOffset(root);
          },
        },
        { input: tPush.input, pref: BGALAZKA_EXT_PREFS.PUSH_PAGE, def: false },
        {
          input: tAllSidesResize.input,
          pref: BGALAZKA_EXT_PREFS.ALL_SIDES_RESIZE,
          def: false,
          onSync: () => ensurePillAllSidesResizeButton(),
        },
        {
          input: panelHorizontalOffsetSlider.input,
          pref: BGALAZKA_EXT_PREFS.PANEL_HORIZONTAL_OFFSET,
          def: getHorizontalOffsetPreference(
            document.getElementById("zen-app-panel-root"),
          ),
          isSelect: true,
          onSync: (v) => {
            const root = document.getElementById("zen-app-panel-root");
            cachedHorizontalOffset = v;
            if (root) {
              applyHorizontalPanelOffset(root);
              const applied = Math.round(getAppliedHorizontalOffset(root));
              const { min, max } = getHorizontalOffsetBounds(root);
              panelHorizontalOffsetSlider.input.min = Math.floor(min);
              panelHorizontalOffsetSlider.input.max = Math.ceil(max);
              panelHorizontalOffsetSlider.input.value = applied;
              panelHorizontalOffsetSlider.badge.textContent = applied + "px";
            } else {
              panelHorizontalOffsetSlider.badge.textContent = v + "px";
            }
          },
        },
        {
          input: tMasterPill.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_PILL,
          def: false,
          onSync: (v) =>
            pillSubgroup.setAttribute("data-hidden", v ? "true" : "false"),
        },
        {
          input: pillPosSlider.input,
          pref: BGALAZKA_EXT_PREFS.PILL_POSITION,
          def: 0,
          isSelect: true, // reused flag: means "sync via .value", true for <select> and <input type=range> alike
          onSync: (v) => {
            pillPosSlider.badge.textContent = v + "%";
            updateCSSVars();
          },
        },
        {
          input: tPeekDot.input,
          pref: BGALAZKA_EXT_PREFS.PILL_PEEK_DOT,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-pill-peek-dot",
              v ? "true" : "false",
            ),
        },
        {
          input: peekColorRow.input,
          pref: BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
          def: "#4da6ff",
          isSelect: true, // reused flag: sync via .value, same as color/range inputs
          onSync: () => updateCSSVars(),
        },
        {
          input: peekOpacitySlider.input,
          pref: BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY,
          def: 90,
          isSelect: true, // reused flag: sync via .value, same as slider/color inputs
          onSync: (v) => {
            peekOpacitySlider.badge.textContent = v + "%";
            updateCSSVars();
          },
        },
        {
          input: pillBackgroundOpacitySlider.input,
          pref: BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY,
          def: 90,
          isSelect: true,
          onSync: (v) => {
            pillBackgroundOpacitySlider.badge.textContent = v + "%";
            updateCSSVars();
          },
        },
        {
          input: tWebToolbar.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED,
          def: false,
          onSync: (v) => {
            document.documentElement.setAttribute(
              "bgalazka-webtoolbar",
              v ? "true" : "false",
            );
            webToolbarSubgroup.setAttribute(
              "data-hidden",
              v ? "false" : "true",
            );
          },
        },
        {
          input: tToolbarAutohide.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_AUTOHIDE,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-webtoolbar-autohide",
              v ? "true" : "false",
            ),
        },
        {
          input: tToolbarTop.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_TOP,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-webtoolbar-top",
              v ? "true" : "false",
            ),
        },
        {
          input: tToolbarUrlbar.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_URLBAR,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-webtoolbar-urlbar",
              v ? "true" : "false",
            ),
        },
        {
          input: tToolbarZoom.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ZOOM,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-webtoolbar-zoom",
              v ? "true" : "false",
            ),
        },
        {
          input: tSearchEngine.select,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_ENGINE,
          def: "ddg",
          isSelect: true,
          onSync: (v) => {
            syncCustomSearchOptions();
            if (v === "browser") refreshBrowserSearchTemplate();
          },
        },
        {
          input: tSearchCustomUrl.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_CUSTOM_URL,
          def: "",
          isSelect: true, // reused flag: means "sync via .value", true for text inputs too
        },
        {
          input: tQuickswitch.input,
          pref: BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH,
          def: false,
          onSync: (v) =>
            quickSwitchTargetsSubgroup.setAttribute(
              "data-hidden",
              v ? "false" : "true",
            ),
        },
        ...quickSwitchTargetRows.map(({ input }, index) => ({
          input,
          pref:
            QUICK_SWITCH_TARGET_PREF_PREFIX +
            QUICK_SWITCH_BUILTIN_TARGETS[index].key,
          def: index < 2,
        })),
        ...quickSwitchCustomRows.map(({ input }, index) => ({
          input,
          pref: QUICK_SWITCH_CUSTOM_PREFS[index],
          def: "",
          isSelect: true,
        })),
        {
          input: tDualView.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_DUAL_VIEW,
          def: false,
        },
        {
          input: tHideHoverRevealBtn.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
          def: false,
          onSync: () => syncHoverPanelAvailability(),
        },
        {
          input: tHideHoverRevealBtnPillCategory.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
          def: false,
        },
        {
          input: tHideAllSidesResizeBtn.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_ALL_SIDES_RESIZE_BTN,
          def: false,
        },
        { input: tPin.input, pref: BGALAZKA_EXT_PREFS.HIDE_PIN, def: false },
        { input: t5.input, pref: BGALAZKA_EXT_PREFS.HIDE_EXPAND, def: false },
        {
          input: tGrabber.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_GRABBER,
          def: false,
        },
        {
          input: tRefresh.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_REFRESH,
          def: false,
        },
        {
          input: tClose.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_CLOSE,
          def: false,
        },
        {
          input: audioIndicator.input,
          pref: BGALAZKA_EXT_PREFS.AUDIO_INDICATOR,
          def: false,
        },
        {
          input: smartSleep.input,
          pref: BGALAZKA_EXT_PREFS.SMART_SLEEP,
          def: false,
        },
        {
          input: tAddonTabIdBridge.input,
          pref: BGALAZKA_EXT_PREFS.ADDON_TAB_ID_BRIDGE,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-addon-tab-id-bridge",
              v ? "true" : "false",
            ),
        },
        {
          input: tZenInternetCss.input,
          pref: BGALAZKA_EXT_PREFS.ZEN_INTERNET_PANEL_CSS,
          def: false,
        },
        {
          input: tShowTripleStyleRepair.input,
          pref: BGALAZKA_EXT_PREFS.SHOW_TRIPLE_STYLE_REPAIR,
          def: false,
          onSync: () => updateWebToolbarState(),
        },
        {
          input: tPeriodicFallbackPolling.input,
          pref: BGALAZKA_EXT_PREFS.PERIODIC_FALLBACK_POLLING,
          def: false,
        },
        {
          input: tShowAddonHostFolder.input,
          pref: BGALAZKA_EXT_PREFS.SHOW_ADDON_HOST_FOLDER,
          def: false,
          onSync: (v) =>
            document.documentElement.setAttribute(
              "bgalazka-show-addon-host-folder",
              v ? "true" : "false",
            ),
        },
        {
          input: tMmbUnloadNormalTabs.input,
          pref: BGALAZKA_EXT_PREFS.MMB_UNLOAD_NORMAL_TABS,
          def: false,
        },
        {
          input: tKeybindsEnabled.input,
          pref: BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED,
          def: false,
          onSync: (v) => {
            keybindSubgroup.setAttribute("data-hidden", v ? "false" : "true");
            if (v) {
              setPref(BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, true);
              document.documentElement.setAttribute(
                "bgalazka-panel-input-shield",
                "true",
              );
              tPanelInputShield.input.checked = true;
            }
          },
        },
        ...keybindRows.map(({ input }, index) => ({
          input,
          pref: EXT_KEYBIND_ACTIONS[index].pref,
          def: EXT_KEYBIND_DEFAULTS[EXT_KEYBIND_ACTIONS[index].key],
          isSelect: true,
        })),
        {
          input: t4.input,
          pref: BGALAZKA_EXT_PREFS.CORNER_TILES,
          def: false,
          onSync: (v) =>
            cornerSubgroup.setAttribute("data-hidden", v ? "false" : "true"),
        },
        {
          input: tAllTabs.input,
          pref: BGALAZKA_EXT_PREFS.ALL_TAB_PANELS,
          def: false,
          onSync: () => requestTileSync(0),
        },
        {
          input: tHoverCorner.input,
          pref: BGALAZKA_EXT_PREFS.HOVER_CORNER_TILES,
          def: false,
        },
        {
          input: tHideUnattached.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_UNATTACHED_APP_CONTROLS,
          def: false,
        },
        { input: t3.input, pref: BGALAZKA_EXT_PREFS.TAB_ISOLATION, def: true },
        {
          input: tBadges.input,
          pref: BGALAZKA_EXT_PREFS.HIDE_CORNER_BADGES,
          def: false,
        },
      );

      // Bulk actions change only boolean feature controls. Slider values,
      // search URLs, shortcut assignments, and saved panel geometry survive.
      // Clicking each control runs its existing live-update handler.
      const presetActions = document.createElement("div");
      presetActions.className = "zs-extension-presets";
      const recommendedExceptions = new Set([
        BGALAZKA_EXT_PREFS.EDGE_ATTACHED_PANELS,
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_TOP,
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_AUTOHIDE,
        BGALAZKA_EXT_PREFS.ADDON_TAB_ID_BRIDGE,
        BGALAZKA_EXT_PREFS.SHOW_ADDON_HOST_FOLDER,
        EXT_PREFS.TABBAR_COMPACT,
        EXT_PREFS.RSS_HIDE_EMPTY,
        EXT_PREFS.RSS_COMPACT_HEADERS,
      ]);
      const applyPreset = (recommended) => {
        const message = recommended
          ? "Apply recommended extension switches? This will replace your current on/off choices. Custom values and shortcuts will be kept."
          : "Turn off every extension switch? This will replace your current on/off choices. Custom values and shortcuts will be kept.";
        if (!window.confirm(message)) return;
        for (const { input, pref, isSelect } of panel._toggles) {
          if (isSelect || input.type !== "checkbox") continue;
          const experimental = /experimental/i.test(
            input.closest(".zs-row")?.textContent || "",
          );
          const wanted =
            recommended &&
            !pref.startsWith("zen.workspace.bgalazka.hide_") &&
            !recommendedExceptions.has(pref) &&
            !experimental;
          if (input.checked !== wanted) input.click();
        }
        // The video category is built by a separate extension module and
        // keeps its own pref namespace, so include its visible switches too.
        for (const input of modal.querySelectorAll(
          '#zs-panel-video-cloning input[type="checkbox"]',
        )) {
          const isHideOption = /hide/i.test(
            input.closest(".zs-row")?.textContent || "",
          );
          const wanted = recommended && !isHideOption;
          if (input.checked !== wanted) input.click();
        }
      };
      for (const [label, recommended] of [
        ["Recommended settings", true],
        ["Turn everything off", false],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "zs-extension-preset-btn";
        button.textContent = label;
        button.addEventListener("click", () => applyPreset(recommended));
        presetActions.appendChild(button);
      }
      content.prepend(presetActions);

      // ------------------------------------------------------------------
      // SETTINGS CATEGORY SPLIT
      // ------------------------------------------------------------------
      // These are real sibling Settings categories/tabs, not headings inside
      // Extension Core. We build them from the same controls so persistence
      // and live synchronization remain centralized in panel._toggles.
      const makeExtensionSettingsPanel = (id, dataPanel) => {
        const subPanel = document.createElement("div");
        subPanel.id = id;
        subPanel.className = "zs-tab-panel zs-extension-subpanel";
        subPanel.setAttribute("data-panel", dataPanel);
        const subContent = document.createElement("div");
        subContent.className = "zs-section-content";
        subContent.style.paddingTop = "14px";
        subPanel.appendChild(subContent);
        return { subPanel, subContent };
      };

      const tabsCategory = makeExtensionSettingsPanel(
        "zs-panel-extension-tabs",
        "extension-tabs",
      );
      cornerHeader.style.marginTop = "8px";
      tabsCategory.subContent.append(
        cornerHeader,
        t4.row,
        cornerSubgroup,
        tHideUnattached.row,
      );

      const hideCategory = makeExtensionSettingsPanel(
        "zs-panel-extension-hide-pill",
        "extension-hide-pill",
      );
      hidePillHeader.style.marginTop = "8px";
      hideCategory.subContent.append(hidePillHeader, hidePillGroup);

      const keybindCategory = makeExtensionSettingsPanel(
        "zs-panel-extension-keybinds",
        "extension-keybinds",
      );
      keybindHeader.style.marginTop = "8px";
      keybindCategory.subContent.append(
        keybindHeader,
        tMmbUnloadNormalTabs.row,
        tKeybindsEnabled.row,
        keybindSubgroup,
      );

      const toolbarCategory = makeExtensionSettingsPanel(
        "zs-panel-extension-toolbar",
        "extension-toolbar",
      );
      toolbarHeader.style.marginTop = "8px";
      toolbarCategory.subContent.append(
        toolbarHeader,
        tWebToolbar.row,
        webToolbarSubgroup,
      );

      const searchCategory = makeExtensionSettingsPanel(
        "zs-panel-extension-search",
        "extension-search",
      );
      const searchHeader = document.createElement("div");
      searchHeader.className = "zs-section-header";
      const searchTitle = document.createElement("h3");
      searchTitle.className = "zs-section-title";
      searchTitle.textContent = "Search Engines";
      searchHeader.appendChild(searchTitle);

      const customEnginesHeader = document.createElement("div");
      customEnginesHeader.className = "zs-section-header zs-subsection-header";
      const customEnginesTitle = document.createElement("h3");
      customEnginesTitle.className = "zs-section-title";
      customEnginesTitle.textContent = "Custom Engines";
      customEnginesHeader.appendChild(customEnginesTitle);

      searchCategory.subContent.append(
        searchHeader,
        tSearchEngine.row,
        customEnginesHeader,
        customSearchSubgroup,
        tQuickswitch.row,
        quickSwitchTargetsSubgroup,
      );

      const rssCategory = makeExtensionSettingsPanel(
        "zs-panel-extension-rss",
        "extension-rss",
      );
      const rssHeader = document.createElement("div");
      rssHeader.className = "zs-section-header";
      const rssTitle = document.createElement("h3");
      rssTitle.className = "zs-section-title";
      rssTitle.textContent = "RSS live folders";
      rssHeader.appendChild(rssTitle);
      const rssNote = document.createElement("p");
      rssNote.className = "zs-sublabel";
      rssNote.textContent =
        "Keep your native feeds and their individual output folders. These switches only change how live folders appear in the sidebar.";
      const rssHideEmpty = createToggleRow(
        "Hide empty live folders",
        "Free sidebar space when a live folder has no articles. Folders return when Zen adds items; other live-folder providers are included.",
        EXT_PREFS.RSS_HIDE_EMPTY,
        null,
        false,
        null,
        syncRssFolderDisplay,
      );
      const rssCompact = createToggleRow(
        "Compact live-folder headers",
        "Reduce the height and spacing of live-folder rows, including folders that have articles.",
        EXT_PREFS.RSS_COMPACT_HEADERS,
        null,
        false,
        null,
        syncRssFolderDisplay,
      );
      rssCategory.subContent.append(
        rssHeader,
        rssNote,
        rssHideEmpty.row,
        rssCompact.row,
      );
      panel._toggles.push(
        {
          input: rssHideEmpty.input,
          pref: EXT_PREFS.RSS_HIDE_EMPTY,
          def: false,
        },
        {
          input: rssCompact.input,
          pref: EXT_PREFS.RSS_COMPACT_HEADERS,
          def: false,
        },
      );

      // Keep every pill-related control together: appearance first, then the
      // visibility list. Moving existing nodes preserves all listeners.
      hidePillTitle.textContent = "Pill Controls";
      hideCategory.subContent.prepend(
        pillHeader,
        tMasterPill.row,
        pillSubgroup,
      );

      // Move the existing appearance controls, retaining their original event
      // handlers. The group-opacity control is owned by the base settings UI.
      const lookCategory = makeExtensionSettingsPanel(
        "zs-panel-extension-look",
        "extension-look",
      );
      lookCategory.subContent.classList.add("zs-look-content");
      const lookIntro = document.createElement("div");
      lookIntro.className = "zs-look-intro";
      lookIntro.innerHTML = `<span class="zs-look-eyebrow">LOOK</span>
        <h3>Appearance</h3>
        <p>Every visual choice below saves as you change it. Classic restores the previous style.</p>`;
      lookCategory.subContent.append(lookIntro);
      const addLookHeading = (label) => {
        const heading = document.createElement("h4");
        heading.className = "zs-look-heading";
        heading.textContent = label;
        lookCategory.subContent.appendChild(heading);
      };
      const lookControls = [];
      const ensureCustomLook = (key) => {
        if (
          key !== LOOK_PREFS.STYLE &&
          getPref(LOOK_PREFS.STYLE, "atelier") === "classic"
        ) {
          setPref(LOOK_PREFS.STYLE, "atelier");
          lookCategory.subPanel._syncLook?.();
        }
        applyLook();
      };
      const addLookSelect = (label, description, key, options) => {
        const control = createSelectRow(
          label,
          description,
          key,
          options,
          LOOK_DEFAULTS[key],
          null,
          null,
          () => ensureCustomLook(key),
        );
        control.select.removeAttribute("style");
        lookCategory.subContent.append(control.row);
        lookControls.push({ input: control.select, key });
      };
      const addLookColor = (label, description, key) => {
        const control = createColorRow(
          label,
          description,
          key,
          LOOK_DEFAULTS[key],
        );
        control.input.addEventListener("input", () => ensureCustomLook(key));
        lookCategory.subContent.append(control.row);
        lookControls.push({ input: control.input, key });
      };
      const addLookSlider = (label, description, key, min, max, suffix) => {
        const inverted = LOOK_TRANSPARENCY_KEYS.has(key);
        const invert = (value) => 100 - value;
        const control = createSliderRow(
          label,
          description,
          key,
          min,
          max,
          LOOK_DEFAULTS[key],
          suffix,
          inverted ? invert : undefined,
          inverted ? invert : undefined,
        );
        // Density controls apply in Classic as well; changing them must not
        // switch the user's other Look choices to Custom.
        if (
          key !== LOOK_PREFS.TABBAR_ROW_HEIGHT &&
          key !== LOOK_PREFS.TABBAR_ROW_GAP &&
          key !== LOOK_PREFS.TABBAR_ICON_GAP
        )
          control.input.addEventListener("input", () => ensureCustomLook(key));
        lookCategory.subContent.append(control.row);
        lookControls.push({
          input: control.input,
          badge: control.badge,
          suffix,
          key,
          inverted,
        });
      };
      const syncLookControls = () => {
        for (const { input, badge, suffix, key, inverted } of lookControls) {
          const value = getPref(key, LOOK_DEFAULTS[key]);
          input.value = inverted ? 100 - value : value;
          if (badge) badge.textContent = input.value + suffix;
        }
      };
      lookCategory.subPanel._syncLook = syncLookControls;
      addLookHeading("Style");
      addLookSelect(
        "Interface style",
        "Switch to the original styling any time",
        LOOK_PREFS.STYLE,
        [
          { value: "atelier", label: "Custom" },
          { value: "classic", label: "Classic" },
        ],
      );
      const themeChoices = document.createElement("div");
      themeChoices.className = "zs-look-themes";
      for (const theme of LOOK_THEMES) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "zs-look-theme";
        choice.style.setProperty("--zs-theme-swatch", theme.swatch);
        choice.textContent = theme.name;
        choice.title =
          "Apply " + theme.name + "; every value stays editable below";
        choice.addEventListener("click", () => {
          for (const [key, value] of Object.entries(LOOK_DEFAULTS)) {
            // Theme swatches change colors and shapes, not the user's chosen
            // sidebar density. Reset Look defaults still turns it off.
            if (
              key === LOOK_PREFS.TABBAR_COMPACT ||
              key === LOOK_PREFS.TABBAR_ROW_HEIGHT ||
              key === LOOK_PREFS.TABBAR_ROW_GAP ||
              key === LOOK_PREFS.TABBAR_ICON_GAP
            )
              continue;
            if (
              key.startsWith("zen.workspace.bgalazka.look.") ||
              key === LOOK_PREFS.VIDEO_RADIUS
            )
              setPref(key, theme.values[key] ?? value);
            else if (Object.hasOwn(theme.values, key))
              setPref(key, theme.values[key]);
          }
          syncAppearanceAfterImport();
        });
        themeChoices.append(choice);
      }
      lookCategory.subContent.append(themeChoices);
      addLookHeading("Palette");
      addLookColor("Canvas", "Backdrop behind the controls", LOOK_PREFS.CANVAS);
      addLookColor(
        "Surface",
        "Main cards and floating panels",
        LOOK_PREFS.SURFACE,
      );
      addLookColor(
        "Raised surface",
        "Controls, hover states and nested cards",
        LOOK_PREFS.RAISED,
      );
      addLookColor(
        "Accent",
        "Active indicators and highlights",
        LOOK_PREFS.ACCENT,
      );
      addLookColor("Text", "Main labels", LOOK_PREFS.TEXT);
      addLookColor(
        "Secondary text",
        "Descriptions and captions",
        LOOK_PREFS.MUTED,
      );
      addLookHeading("Transparency");
      const transparencyHelp = document.createElement("p");
      transparencyHelp.className = "zs-look-note";
      transparencyHelp.textContent =
        "0% is solid; 100% clears panel backgrounds. Dual and Triple View keep content fully visible.";
      lookCategory.subContent.append(transparencyHelp);
      addLookSlider(
        "Panel background",
        "Both panel frames; whole-panel opacity still applies on top",
        LOOK_PREFS.SURFACE_OPACITY,
        0,
        100,
        "%",
      );
      addLookSlider(
        "Raised surfaces",
        "Hovered toolbar buttons",
        LOOK_PREFS.RAISED_OPACITY,
        0,
        100,
        "%",
      );
      addLookSlider(
        "Panel toolbars",
        "Top and secondary toolbar backgrounds",
        LOOK_PREFS.TOOLBAR_OPACITY,
        0,
        100,
        "%",
      );
      addLookSlider(
        "Address fields",
        "Both panel address field backgrounds",
        LOOK_PREFS.ADDRESS_OPACITY,
        0,
        100,
        "%",
      );
      addLookSlider(
        "Button fills",
        "Filled navigation and zoom buttons",
        LOOK_PREFS.BUTTON_OPACITY,
        0,
        100,
        "%",
      );
      addLookSlider(
        "App tiles",
        "Soft tile and hovered tile backgrounds",
        LOOK_PREFS.TILE_OPACITY,
        0,
        100,
        "%",
      );
      addLookSlider(
        "Video backdrop",
        "Video preview frame, without fading the picture",
        LOOK_PREFS.VIDEO_OPACITY,
        0,
        100,
        "%",
      );
      addLookSlider(
        "Video controls",
        "Filled video buttons and selected source highlight",
        LOOK_PREFS.VIDEO_CONTROL_OPACITY,
        0,
        100,
        "%",
      );
      addLookSlider(
        "Group popup",
        "Tab group control popup background",
        LOOK_PREFS.POPUP_OPACITY,
        0,
        100,
        "%",
      );
      addLookHeading("Tab bar");
      const compactTabbar = createToggleRow(
        "Compact tabs and folders",
        "Tighter tab and folder rows with room for favicons and readable titles. Text size stays controlled by your other mod.",
        LOOK_PREFS.TABBAR_COMPACT,
        "bgalazka-tabbar-compact",
        false,
      );
      lookCategory.subContent.append(compactTabbar.row);
      panel._toggles.push({
        input: compactTabbar.input,
        pref: LOOK_PREFS.TABBAR_COMPACT,
        def: false,
      });
      addLookSlider(
        "Tab and folder height",
        "Minimum row height; titles grow if your font needs more room",
        LOOK_PREFS.TABBAR_ROW_HEIGHT,
        18,
        36,
        " px",
      );
      addLookSlider(
        "Space between rows",
        "0 px puts adjacent favicons as close as the row height allows",
        LOOK_PREFS.TABBAR_ROW_GAP,
        0,
        8,
        " px",
      );
      addLookSlider(
        "Icon to title gap",
        "Space after each favicon, without changing icon or text size",
        LOOK_PREFS.TABBAR_ICON_GAP,
        0,
        12,
        " px",
      );
      addLookHeading("Shape & depth");
      addLookSlider(
        "Corner radius",
        "0 px keeps windows and controls square",
        LOOK_PREFS.RADIUS,
        0,
        26,
        " px",
      );
      addLookSlider(
        "Panel border",
        "0 px removes the floating window outline",
        LOOK_PREFS.PANEL_BORDER,
        0,
        3,
        " px",
      );
      addLookSlider(
        "Shadow depth",
        "0 removes the floating window shadow",
        LOOK_PREFS.DEPTH,
        0,
        100,
        "%",
      );
      addLookSelect(
        "Spacing",
        "Space between settings and controls",
        LOOK_PREFS.SPACING,
        [
          { value: "compact", label: "Compact" },
          { value: "comfortable", label: "Comfortable" },
          { value: "airy", label: "Airy" },
        ],
      );
      addLookHeading("Buttons & settings");
      addLookSelect(
        "Button style",
        "Applies to toolbars, video and settings actions",
        LOOK_PREFS.BUTTON_STYLE,
        [
          { value: "plain", label: "Flat" },
          { value: "filled", label: "Filled" },
          { value: "outline", label: "Outline" },
        ],
      );
      addLookColor(
        "Button fill",
        "Fill for the Filled style",
        LOOK_PREFS.BUTTON_SURFACE,
      );
      addLookColor("Button text", "Icons and labels", LOOK_PREFS.BUTTON_TEXT);
      addLookColor(
        "Button outline",
        "Outline style and focus edge",
        LOOK_PREFS.BUTTON_BORDER_COLOR,
      );
      addLookSlider(
        "Button border width",
        "0 px removes outlines, including Filled buttons",
        LOOK_PREFS.BUTTON_BORDER,
        0,
        3,
        " px",
      );
      addLookSlider(
        "Control size",
        "Toolbar and video action buttons",
        LOOK_PREFS.CONTROL_SIZE,
        18,
        32,
        " px",
      );
      addLookSelect(
        "App tiles",
        "Bare or softly filled launchers",
        LOOK_PREFS.TILE_STYLE,
        [
          { value: "bare", label: "Bare" },
          { value: "soft", label: "Soft fill" },
        ],
      );
      addLookSelect(
        "Setting rows",
        "Simple lines or individual cards",
        LOOK_PREFS.ROW_STYLE,
        [
          { value: "lines", label: "Lines" },
          { value: "cards", label: "Cards" },
        ],
      );
      addLookSlider(
        "Row padding",
        "Vertical space inside a setting",
        LOOK_PREFS.ROW_PADDING,
        4,
        20,
        " px",
      );
      addLookSlider(
        "Row divider",
        "0 removes row lines and card outlines",
        LOOK_PREFS.ROW_RULE,
        0,
        2,
        " px",
      );
      addLookHeading("Panel toolbar");
      addLookColor(
        "Toolbar surface",
        "Behind navigation and zoom controls",
        LOOK_PREFS.TOOLBAR_SURFACE,
      );
      addLookColor(
        "Address field",
        "Background of the second address bar",
        LOOK_PREFS.TOOLBAR_URL,
      );
      addLookSlider(
        "Toolbar divider",
        "0 removes the line above the bar",
        LOOK_PREFS.TOOLBAR_BORDER,
        0,
        3,
        " px",
      );
      addLookHeading("Sidebar video");
      addLookColor(
        "Video surface",
        "Backdrop around the picture",
        LOOK_PREFS.VIDEO_CANVAS,
      );
      addLookColor(
        "Video control fill",
        "Fill used by the Filled button style",
        LOOK_PREFS.VIDEO_CONTROL,
      );
      addLookColor(
        "Video text",
        "Source and action labels",
        LOOK_PREFS.VIDEO_TEXT,
      );
      addLookColor(
        "Video muted text",
        "Caption and source details",
        LOOK_PREFS.VIDEO_MUTED,
      );
      addLookColor(
        "Selected source",
        "Small selection marker or filled highlight",
        LOOK_PREFS.VIDEO_SELECTED,
      );
      addLookSlider(
        "Video border",
        "0 removes the card and picture outline",
        LOOK_PREFS.VIDEO_BORDER,
        0,
        3,
        " px",
      );
      addLookSlider(
        "Video padding",
        "Space around the media and controls",
        LOOK_PREFS.VIDEO_PADDING,
        0,
        16,
        " px",
      );
      addLookSlider(
        "Source row height",
        "Height of each source in the list",
        LOOK_PREFS.VIDEO_ROW_HEIGHT,
        22,
        36,
        " px",
      );
      addLookSelect(
        "Source selection",
        "Line or filled highlight, without a box border",
        LOOK_PREFS.VIDEO_SOURCE_STYLE,
        [
          { value: "line", label: "Line" },
          { value: "filled", label: "Filled" },
        ],
      );
      addLookSlider(
        "Video corners",
        "0 px keeps the sidebar video square",
        LOOK_PREFS.VIDEO_RADIUS,
        0,
        24,
        " px",
      );
      const videoLookInput = lookControls.at(-1).input;
      videoLookInput.addEventListener("input", () => {
        const original = document.getElementById("zs-video-preview-radius");
        if (!original) return;
        original.value = videoLookInput.value;
        original.dispatchEvent(new Event("input", { bubbles: true }));
      });
      addLookHeading("Existing appearance");
      lookCategory.subContent.append(aestheticHeader, t1.row, slidersGroup);
      const pillLookGroup = document.createElement("div");
      pillLookGroup.className = "zs-look-group";
      pillLookGroup.append(
        peekColorRow.row,
        peekOpacitySlider.row,
        pillBackgroundOpacitySlider.row,
      );
      lookCategory.subContent.append(pillLookGroup);
      const groupOpacity = modal
        .querySelector("#zs-tg-opacity")
        ?.closest(".zs-stacked-slider");
      if (groupOpacity) lookCategory.subContent.append(groupOpacity);
      const groupIndicator = modal.querySelector("#zs-tg-indicator-type-row");
      const groupToggle = modal
        .querySelector("#zs-tg-chevron")
        ?.closest(".zs-row");
      if (groupToggle) lookCategory.subContent.append(groupToggle);
      if (groupIndicator) lookCategory.subContent.append(groupIndicator);
      // Base settings normally persist these on Save. In Look they save as
      // soon as they change, just like the other live appearance controls.
      const groupOpacityInput = modal.querySelector("#zs-tg-opacity");
      groupOpacityInput?.addEventListener("input", () =>
        setPref(
          LOOK_GROUP_PREFS.LABEL_OPACITY,
          Number(groupOpacityInput.value),
        ),
      );
      const indicatorToggle = modal.querySelector("#zs-tg-chevron");
      indicatorToggle?.addEventListener("change", () => {
        setPref(LOOK_GROUP_PREFS.SHOW_CHEVRON, indicatorToggle.checked);
        window.Zentral?.TabGroups?.applyChevronPref?.();
      });
      groupIndicator
        ?.querySelectorAll(".zs-custom-select-option")
        .forEach((option) =>
          option.addEventListener("click", () => {
            setPref(LOOK_GROUP_PREFS.INDICATOR_TYPE, option.dataset.value);
            window.Zentral?.TabGroups?.applyIndicatorTypePref?.();
          }),
        );
      const resetLook = document.createElement("button");
      resetLook.type = "button";
      resetLook.className = "zs-look-action";
      resetLook.textContent = "Reset Look defaults";
      resetLook.addEventListener("click", () => {
        if (!window.confirm("Reset all Look options to their defaults?"))
          return;
        for (const [key, value] of Object.entries(LOOK_DEFAULTS))
          setPref(key, value);
        syncAppearanceAfterImport();
      });
      lookCategory.subContent.append(resetLook);
      addLookBackupControls(lookCategory.subContent);

      panel.appendChild(content);
      body.append(
        panel,
        lookCategory.subPanel,
        tabsCategory.subPanel,
        hideCategory.subPanel,
        toolbarCategory.subPanel,
        searchCategory.subPanel,
        rssCategory.subPanel,
        keybindCategory.subPanel,
      );
      registerCleanup(() => {
        const wasActive = Boolean(
          modal.querySelector(
            '#zs-panel-bgalazka[data-active="true"], .zs-extension-subpanel[data-active="true"]',
          ),
        );
        modal
          .querySelectorAll(
            '#zs-panel-bgalazka, .zs-extension-subpanel, #zs-tab-btn-bgalazka, [id^="zs-tab-btn-extension-"]',
          )
          .forEach((node) => node.remove());
        if (wasActive) modal.querySelector(".zs-tab-btn")?.click();
      });
    } else if (Array.isArray(panel._toggles)) {
      panel._toggles.forEach(({ input, pref, def, onSync, isSelect }) => {
        if (isSelect) {
          input.value = getPref(pref, def);
        } else {
          input.checked = getPref(pref, def);
        }
        if (typeof onSync === "function") {
          onSync(isSelect ? input.value : input.checked);
        }
      });
    }

    modal.querySelector("#zs-panel-extension-look")?._syncLook?.();
    applyLook();
    const extensionCategories = [
      {
        buttonId: "zs-tab-btn-bgalazka",
        panelId: "zs-panel-bgalazka",
        dataTab: "bgalazka",
        label: "Panels",
      },
      {
        buttonId: "zs-tab-btn-extension-look",
        panelId: "zs-panel-extension-look",
        dataTab: "extension-look",
        label: "Look",
      },
      {
        buttonId: "zs-tab-btn-extension-tabs",
        panelId: "zs-panel-extension-tabs",
        dataTab: "extension-tabs",
        label: "Tabs",
      },
      {
        buttonId: "zs-tab-btn-extension-hide-pill",
        panelId: "zs-panel-extension-hide-pill",
        dataTab: "extension-hide-pill",
        label: "Pill",
      },
      {
        buttonId: "zs-tab-btn-extension-toolbar",
        panelId: "zs-panel-extension-toolbar",
        dataTab: "extension-toolbar",
        label: "Toolbar",
      },
      {
        buttonId: "zs-tab-btn-extension-search",
        panelId: "zs-panel-extension-search",
        dataTab: "extension-search",
        label: "Search",
      },
      {
        buttonId: "zs-tab-btn-extension-rss",
        panelId: "zs-panel-extension-rss",
        dataTab: "extension-rss",
        label: "RSS",
      },
      {
        buttonId: "zs-tab-btn-extension-keybinds",
        panelId: "zs-panel-extension-keybinds",
        dataTab: "extension-keybinds",
        label: "Shortcuts",
      },
    ];

    // Label the base categories without changing the original code.
    const baseSettings = modal.querySelector(
      '.zs-tab-btn[data-tab="settings"]',
    );
    const baseDiagnostics = modal.querySelector(
      '.zs-tab-btn[data-tab="diagnostics"]',
    );
    if (baseSettings) baseSettings.textContent = "Settings";
    if (baseDiagnostics) baseDiagnostics.textContent = "Diagnostics";
    const diagnosticPanel = modal.querySelector("#zs-panel-diagnostics");
    if (
      diagnosticPanel &&
      !diagnosticPanel.querySelector("#zs-base-diagnostic-note")
    ) {
      const note = document.createElement("p");
      note.id = "zs-base-diagnostic-note";
      note.className = "zs-ownership-note";
      note.textContent =
        "Diagnostics and issue reports here are for the original Zentral base mod only. For problems caused by Bgalazka's extension, please do not contact the original creator.";
      diagnosticPanel.prepend(note);
    }
    const donation = modal.querySelector("#zs-kofi-btn");
    if (donation) {
      const message =
        "Donation for the original Zentral base mod only; it does not support Bgalazka's extension.";
      donation.title = message;
      donation.setAttribute("aria-label", message);
      if (!modal.querySelector("#zs-base-donation-note")) {
        const note = document.createElement("span");
        note.id = "zs-base-donation-note";
        note.className = "zs-donation-note";
        note.textContent = "Base mod donation only · original creator";
        donation.insertAdjacentElement("afterend", note);
      }
    }

    const extensionButtonIds = new Set(
      extensionCategories.map(({ buttonId }) => buttonId),
    );

    extensionCategories.forEach(({ buttonId, panelId, dataTab, label }) => {
      const targetPanel = modal.querySelector(`#${panelId}`);
      if (!targetPanel) return;
      let button = modal.querySelector(`#${buttonId}`);
      if (!button) {
        button = document.createElement("button");
        button.id = buttonId;
        button.className = "zs-tab-btn";
        button.setAttribute("data-tab", dataTab);
        tabBar.appendChild(button);
      }
      button.textContent = label;
      if (!button.dataset.bgalazkaBound) {
        button.dataset.bgalazkaBound = "true";
        button.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          modal
            .querySelectorAll(".zs-tab-bar .zs-tab-btn")
            .forEach((b) => b.removeAttribute("data-active"));
          modal
            .querySelectorAll(".zs-body .zs-tab-panel")
            .forEach((p) => p.removeAttribute("data-active"));
          button.setAttribute("data-active", "true");
          targetPanel.setAttribute("data-active", "true");
        });
      }
    });

    // One heading per category group frees space for actual setting names.
    // Keep the headings outside .zs-tab-btn so native click handling ignores
    // them, and put the extension heading before its first real tab.
    const firstExtension = modal.querySelector("#zs-tab-btn-bgalazka");
    for (const [id, label, before] of [
      ["zs-base-category-label", "Base", baseSettings],
      ["zs-extension-category-label", "Extension", firstExtension],
    ]) {
      if (!before || modal.querySelector("#" + id)) continue;
      const heading = document.createElement("span");
      heading.id = id;
      heading.className = "zs-category-heading";
      heading.textContent = label;
      tabBar.insertBefore(heading, before);
    }

    // Native Zentral tab buttons do not know about extension-injected panels,
    // so explicitly deactivate extension categories when a native
    // category is chosen. One capture listener is enough for the whole bar.
    if (!tabBar.dataset.bgalazkaCategoryGuard) {
      tabBar.dataset.bgalazkaCategoryGuard = "true";
      const categoryGuard = (e) => {
        const clicked = e.target.closest(".zs-tab-btn");
        if (!clicked || extensionButtonIds.has(clicked.id)) return;
        extensionCategories.forEach(({ buttonId, panelId }) => {
          modal.querySelector(`#${buttonId}`)?.removeAttribute("data-active");
          modal.querySelector(`#${panelId}`)?.removeAttribute("data-active");
        });
      };
      tabBar.addEventListener("click", categoryGuard, true);
      registerCleanup(() => {
        tabBar.removeEventListener("click", categoryGuard, true);
        delete tabBar.dataset.bgalazkaCategoryGuard;
      });
    }
  }

  /* ==========================================================================
   * FIREFOX CONTAINERS + PER-PANEL CACHE/COOKIE CLEARING
   * -----------------------------------------------------------------------
   * Adds two app-specific controls beside the native "Load at Startup" row:
   *   1) Container: <name>  -> choose a Firefox Contextual Identity per app.
   *   2) Clear Panel Cache & Cookies -> clear this app site's cookies/caches
   *      only for the selected userContextId.
   *
   * WHY THIS LIVES ENTIRELY IN THE EXTENSION (see architecture notes 1 & 5):
   * - Container assignments are stored in their own JSON pref, so we do not
   *   add fields to Zentral's native app object or edit saveApps()/loadApps().
   * - Firefox containers are backed by ContextualIdentityService. Its public
   *   identities expose the numeric userContextId that Gecko stores in Origin
   *   Attributes and uses to isolate cookie jars and other site state.
   * - Zentral's native getOrCreateAppBrowser() hard-codes usercontextid="0"
   *   BEFORE appending the <browser>. For a remote <browser>, the identity must
   *   be present before connection/frame-loader creation. Because the base code
   *   above this marker is intentionally immutable, the getOrCreate wrapper
   *   below temporarily intercepts ONLY the synchronous setAttribute call made
   *   while that one app browser is being constructed, then immediately restores
   *   Element.prototype. Nothing remains globally patched after the call.
   * - The same wrapper also stamps userContextId into subsequent load options
   *   and content principals. Firefox's own URI-loading helper does the same
   *   principal OriginAttributes adjustment for container-tab navigations.
   * - ClearDataService.deleteDataFromSite() is used instead of globally clearing
   *   a whole container. The OriginAttributes pattern { userContextId } keeps
   *   the operation scoped to this app's selected container, while the site key
   *   keeps it scoped to this app's configured site. A panel is unloaded first
   *   so a live page cannot immediately repopulate cookies while clearing.
   * ========================================================================== */
  const PANEL_CONTAINERS_PREF =
    "zen.workspace.bgalazka.panel_container_assignments";
  const BASE_ZENTRAL_APPS_PREF = "zen.workspace.apps.sidebar.apps";
  const FIREFOX_CONTAINERS_ENABLED_PREF = "privacy.userContext.enabled";

  let ContextualIdentityService = null;
  let panelContainerIdentityCache = [];
  let panelContainerIdentityRefreshPromise = null;

  // Zen currently ships Gecko's ContextualIdentityService, but userChrome
  // scripts can run early enough that a direct eager import/clone path is not
  // always dependable. Resolve it lazily and keep profile-file enumeration as
  // an independent fallback. This also avoids making the menu depend on
  // getUserContextLabel(), which can throw when a stale l10n id is present.
  function resolveContextualIdentityService() {
    if (ContextualIdentityService) return ContextualIdentityService;

    try {
      const mod = ChromeUtils.importESModule(
        "resource://gre/modules/ContextualIdentityService.sys.mjs",
      );
      ContextualIdentityService = mod?.ContextualIdentityService || null;
    } catch (e) {
      console.warn(
        "[BgalazkaExtension] Direct ContextualIdentityService import failed:",
        e,
      );
    }

    // A lazy ES-module getter uses the same Gecko module but is a useful
    // second path in Zen/userChrome environments where the eager import above
    // was attempted before the module was ready.
    if (!ContextualIdentityService) {
      try {
        const lazy = {};
        ChromeUtils.defineESModuleGetters(lazy, {
          ContextualIdentityService:
            "resource://gre/modules/ContextualIdentityService.sys.mjs",
        });
        ContextualIdentityService = lazy.ContextualIdentityService || null;
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] Lazy ContextualIdentityService import failed:",
          e,
        );
      }
    }

    return ContextualIdentityService;
  }

  // Try once at extension startup, but all callers resolve lazily again.
  resolveContextualIdentityService();

  function normalizeUserContextId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : 0;
  }

  function normalizeContainerIdentity(identity) {
    const userContextId = normalizeUserContextId(identity?.userContextId);
    if (!userContextId) return null;
    return {
      userContextId,
      public: identity?.public !== false,
      name: typeof identity?.name === "string" ? identity.name.trim() : "",
      l10nId:
        typeof identity?.l10nId === "string"
          ? identity.l10nId
          : typeof identity?.l10nID === "string"
            ? identity.l10nID
            : "",
      icon: typeof identity?.icon === "string" ? identity.icon : "",
      color: typeof identity?.color === "string" ? identity.color : "",
    };
  }

  function mergeContainerIdentities(...lists) {
    const byId = new Map();
    for (const list of lists) {
      for (const raw of list || []) {
        const identity = normalizeContainerIdentity(raw);
        if (!identity || identity.public === false) continue;
        const old = byId.get(identity.userContextId);
        // Prefer whichever source has more useful human-readable metadata.
        if (
          !old ||
          (!old.name && identity.name) ||
          (!old.l10nId && identity.l10nId)
        ) {
          byId.set(identity.userContextId, { ...old, ...identity });
        }
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) => a.userContextId - b.userContextId,
    );
  }

  function getPanelContainerAssignments() {
    try {
      const raw = Services.prefs.getStringPref(PANEL_CONTAINERS_PREF, "{}");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      const clean = {};
      for (const [appId, rawId] of Object.entries(parsed)) {
        const userContextId = normalizeUserContextId(rawId);
        if (appId && userContextId > 0) clean[appId] = userContextId;
      }
      return clean;
    } catch (_) {
      return {};
    }
  }

  function savePanelContainerAssignments(assignments) {
    try {
      Services.prefs.setStringPref(
        PANEL_CONTAINERS_PREF,
        JSON.stringify(assignments || {}),
      );
    } catch (e) {
      console.warn(
        "[BgalazkaExtension] Failed to save panel container assignments:",
        e,
      );
    }
  }

  function getPanelUserContextId(appId) {
    if (!appId) return 0;
    const essential = essentialPanels.get(appId);
    if (essential) return essential.userContextId;
    return normalizeUserContextId(getPanelContainerAssignments()[appId]);
  }

  function setPanelUserContextId(appId, userContextId) {
    if (!appId) return;
    const essential = essentialPanels.get(appId);
    if (essential) {
      essential.userContextId = normalizeUserContextId(userContextId);
      saveEssentialSettings(essential);
      return;
    }
    const assignments = getPanelContainerAssignments();
    const normalized = normalizeUserContextId(userContextId);
    if (normalized > 0) assignments[appId] = normalized;
    else delete assignments[appId];
    savePanelContainerAssignments(assignments);
  }

  function getStoredZentralApp(appId) {
    if (!appId) return null;
    if (essentialPanels.has(appId)) return essentialPanels.get(appId).app;
    try {
      const raw = Services.prefs.getStringPref(BASE_ZENTRAL_APPS_PREF, "[]");
      const apps = JSON.parse(raw);
      if (!Array.isArray(apps)) return null;
      return apps.find((app) => app?.id === appId) || null;
    } catch (_) {
      return null;
    }
  }

  function areFirefoxContainersEnabled() {
    try {
      return Services.prefs.getBoolPref(FIREFOX_CONTAINERS_ENABLED_PREF, false);
    } catch (_) {
      return false;
    }
  }

  function readContainerIdentitiesFromService() {
    const service = resolveContextualIdentityService();
    if (!service) return [];

    // First use the supported service API. In current Firefox/Zen this calls
    // ensureDataReady() internally and returns all public identities.
    try {
      const identities = service.getPublicIdentities?.();
      const normalized = mergeContainerIdentities(identities);
      if (normalized.length) return normalized;
    } catch (e) {
      console.warn(
        "[BgalazkaExtension] ContextualIdentityService public enumeration failed; using Zen-safe fallback:",
        e,
      );
    }

    // Zen-safe fallback: force the service's synchronous profile load, then
    // read the already-parsed identity records. This avoids Cu.cloneInto()
    // and localization paths entirely while still using Gecko's own data.
    try {
      service.ensureDataReady?.();
      if (Array.isArray(service._identities)) {
        return mergeContainerIdentities(
          service._identities.filter((identity) => identity?.public === true),
        );
      }
    } catch (e) {
      console.warn(
        "[BgalazkaExtension] ContextualIdentityService internal enumeration failed:",
        e,
      );
    }

    return [];
  }

  async function readContainerIdentitiesFromProfile() {
    try {
      if (typeof IOUtils === "undefined") return [];
      const file = Services.dirsvc.get("ProfD", Ci.nsIFile).clone();
      file.append("containers.json");
      if (!file.exists()) return [];

      const bytes = await IOUtils.read(file.path);
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (!Array.isArray(data?.identities)) return [];
      return mergeContainerIdentities(
        data.identities.filter((identity) => identity?.public === true),
      );
    } catch (e) {
      console.warn(
        "[BgalazkaExtension] Failed to read Zen/Firefox containers.json:",
        e,
      );
      return [];
    }
  }

  function getObservedZenContainerIds() {
    // Last-resort discovery for a partially broken containers.json/service:
    // Zen stores the effective context directly on tabs. Include IDs already
    // in use so a working Zen container never disappears from the menu just
    // because ContextualIdentityService's metadata layer is unhealthy.
    const ids = new Set();
    try {
      for (const tab of window.gBrowser?.tabs || []) {
        const id = normalizeUserContextId(tab?.getAttribute?.("usercontextid"));
        if (id) ids.add(id);
      }
    } catch (_) {}
    return Array.from(ids, (userContextId) => ({
      userContextId,
      public: true,
      name: "",
      l10nId: "",
      icon: "",
      color: "",
    }));
  }

  function getFirefoxContainerState() {
    const serviceIdentities = readContainerIdentitiesFromService();
    panelContainerIdentityCache = mergeContainerIdentities(
      panelContainerIdentityCache,
      serviceIdentities,
      getObservedZenContainerIds(),
    );
    return {
      enabled: areFirefoxContainersEnabled(),
      // Profile-file fallback means an import failure is not fatal in Zen.
      available:
        !!resolveContextualIdentityService() || typeof IOUtils !== "undefined",
      identities: panelContainerIdentityCache,
    };
  }

  async function refreshFirefoxContainerState() {
    if (!panelContainerIdentityRefreshPromise) {
      panelContainerIdentityRefreshPromise = (async () => {
        const serviceIdentities = readContainerIdentitiesFromService();
        const profileIdentities = await readContainerIdentitiesFromProfile();
        panelContainerIdentityCache = mergeContainerIdentities(
          panelContainerIdentityCache,
          serviceIdentities,
          profileIdentities,
          getObservedZenContainerIds(),
        );
        return panelContainerIdentityCache;
      })().finally(() => {
        panelContainerIdentityRefreshPromise = null;
      });
    }

    await panelContainerIdentityRefreshPromise;
    return getFirefoxContainerState();
  }

  // Warm the cache as soon as the extension starts so Zen users normally see
  // their containers immediately on the very first context-menu open.
  refreshFirefoxContainerState().catch((e) =>
    console.warn(
      "[BgalazkaExtension] Initial Firefox/Zen container discovery failed:",
      e,
    ),
  );

  const BUILTIN_CONTAINER_LABELS = Object.freeze({
    "user-context-personal": "Personal",
    "user-context-personal2": "Personal",
    "userContextPersonal.label": "Personal",
    "user-context-work": "Work",
    "user-context-work2": "Work",
    "userContextWork.label": "Work",
    "user-context-banking": "Banking",
    "user-context-banking2": "Banking",
    "userContextBanking.label": "Banking",
    "user-context-shopping": "Shopping",
    "user-context-shopping2": "Shopping",
    "userContextShopping.label": "Shopping",
  });

  function getFirefoxContainerLabel(identity) {
    const userContextId = normalizeUserContextId(identity?.userContextId);
    if (!userContextId) return "Default";

    if (typeof identity?.name === "string" && identity.name.trim()) {
      return identity.name.trim();
    }

    const l10nId =
      typeof identity?.l10nId === "string"
        ? identity.l10nId
        : typeof identity?.l10nID === "string"
          ? identity.l10nID
          : "";
    if (BUILTIN_CONTAINER_LABELS[l10nId]) {
      return BUILTIN_CONTAINER_LABELS[l10nId];
    }

    // Use Gecko localization only as a best-effort enhancement. Zen builds
    // affected by stale contextual-identity Fluent IDs can throw here, so a
    // label failure must never hide an otherwise valid container.
    try {
      const service = resolveContextualIdentityService();
      const localized = service?.getUserContextLabel?.(userContextId);
      if (typeof localized === "string" && localized.trim()) {
        return localized.trim();
      }
    } catch (_) {}

    return `Container ${userContextId}`;
  }

  function getFirefoxContainerById(userContextId, identities = null) {
    const id = normalizeUserContextId(userContextId);
    if (!id) return null;
    const list = identities || getFirefoxContainerState().identities;
    return (
      list.find(
        (identity) => normalizeUserContextId(identity?.userContextId) === id,
      ) || null
    );
  }

  function getPanelContainerMenuLabel(appId, identities = null) {
    const id = getPanelUserContextId(appId);
    if (!id) return "Container: Default";
    const identity = getFirefoxContainerById(id, identities);
    return identity
      ? `Container: ${getFirefoxContainerLabel(identity)}`
      : `Container: Unavailable (#${id})`;
  }

  function getContainerIconUrl(identity) {
    const icon = typeof identity?.icon === "string" ? identity.icon.trim() : "";
    return icon ? `resource://usercontext-content/${icon}.svg` : "";
  }

  async function clearPanelCacheAndCookies(appId) {
    const app = getStoredZentralApp(appId);
    if (!app?.url) {
      throw new Error("Unable to resolve this panel's configured URL.");
    }

    const uri = Services.io.newURI(app.url);
    const schemelessSite = Services.eTLD.getSchemelessSite(uri);
    if (!schemelessSite) {
      throw new Error("This panel URL does not have clearable site data.");
    }

    const userContextId = getPanelUserContextId(appId);
    const flags =
      Ci.nsIClearDataService.CLEAR_COOKIES |
      Ci.nsIClearDataService.CLEAR_ALL_CACHES;

    // Stop the live page before clearing so it cannot race the operation and
    // immediately recreate cookies/cache entries while the callback is pending.
    try {
      window.Zentral?.Apps?.closeApp?.(appId);
    } catch (_) {}

    await new Promise((resolve, reject) => {
      Services.clearData.deleteDataFromSite(
        schemelessSite,
        { userContextId },
        true,
        flags,
        {
          onDataDeleted(failedFlags) {
            if (failedFlags) {
              reject(
                new Error(
                  `Firefox failed to clear data flags 0x${Number(
                    failedFlags,
                  ).toString(16)}.`,
                ),
              );
            } else {
              resolve();
            }
          },
        },
      );
    });
  }

  async function rebuildPanelContainerSubmenu(
    popup,
    containerMenu,
    containerPopup,
  ) {
    const appId = popup.dataset.activeAppId || "";
    if (!appId) return;

    const selectedId = getPanelUserContextId(appId);

    const renderState = (state) => {
      // The user may have opened the context menu for another app while the
      // async containers.json fallback was running. Never paint stale data.
      if ((popup.dataset.activeAppId || "") !== appId) return;

      containerMenu.setAttribute(
        "label",
        getPanelContainerMenuLabel(appId, state.identities),
      );
      containerPopup.replaceChildren();

      const appendChoice = (label, userContextId, identity = null) => {
        const item = document.createXULElement("menuitem");
        item.classList.add("bgalazka-container-choice");
        item.setAttribute("label", label);
        item.setAttribute("type", "checkbox");
        item.dataset.userContextId = String(userContextId);
        if (selectedId === userContextId) item.setAttribute("checked", "true");

        const iconUrl = getContainerIconUrl(identity);
        if (iconUrl) {
          item.classList.add("menuitem-iconic");
          item.setAttribute("image", iconUrl);
        }
        if (identity?.color) {
          item.dataset.identityColor = String(identity.color);
        }

        // If Firefox/Zen has globally disabled contextual identities, leave
        // Default usable but don't pretend a non-default container can work.
        if (userContextId > 0 && !state.enabled) {
          item.setAttribute("disabled", "true");
          item.disabled = true;
        }

        item.addEventListener("command", () => {
          if (item.disabled) return;
          const nextId = normalizeUserContextId(userContextId);
          if (getPanelUserContextId(appId) === nextId) return;
          setPanelUserContextId(appId, nextId);
          containerMenu.setAttribute(
            "label",
            nextId
              ? `Container: ${getFirefoxContainerLabel(identity)}`
              : "Container: Default",
          );

          // Container identity is part of the remote browser's OriginAttributes
          // and cannot be safely hot-swapped. Recreate on next open/preload.
          try {
            window.Zentral?.Apps?.closeApp?.(appId);
          } catch (_) {}
        });
        containerPopup.appendChild(item);
      };

      appendChoice("Default (no container)", 0, null);

      if (state.identities.length) {
        containerPopup.appendChild(document.createXULElement("menuseparator"));
        for (const identity of state.identities) {
          appendChoice(
            getFirefoxContainerLabel(identity),
            normalizeUserContextId(identity.userContextId),
            identity,
          );
        }
      }

      if (!state.enabled) {
        containerPopup.appendChild(document.createXULElement("menuseparator"));
        const status = document.createXULElement("menuitem");
        status.classList.add("bgalazka-container-status");
        status.setAttribute(
          "label",
          "Container Tabs are disabled in browser settings",
        );
        status.setAttribute("disabled", "true");
        containerPopup.appendChild(status);
      } else if (!state.identities.length) {
        const status = document.createXULElement("menuitem");
        status.classList.add("bgalazka-container-status");
        status.setAttribute(
          "label",
          state.available
            ? "No Firefox/Zen containers found"
            : "Container service is unavailable",
        );
        status.setAttribute("disabled", "true");
        containerPopup.appendChild(status);
      }

      // Preserve an assignment even if its container was deleted. Showing it
      // explicitly prevents an accidental silent privacy downgrade to Default.
      if (
        selectedId > 0 &&
        !getFirefoxContainerById(selectedId, state.identities)
      ) {
        const stale = document.createXULElement("menuitem");
        stale.classList.add("bgalazka-container-status");
        stale.setAttribute("label", `Unavailable container (#${selectedId})`);
        stale.setAttribute("type", "checkbox");
        stale.setAttribute("checked", "true");
        stale.setAttribute("disabled", "true");
        containerPopup.appendChild(stale);
      }
    };

    // Paint immediately from Gecko's service/cache. If that path is empty,
    // show a transient loading row instead of incorrectly claiming that Zen
    // has no containers while containers.json is still being read.
    const initialState = getFirefoxContainerState();
    if (initialState.identities.length || !initialState.available) {
      renderState(initialState);
    } else {
      containerMenu.setAttribute(
        "label",
        getPanelContainerMenuLabel(appId, initialState.identities),
      );
      containerPopup.replaceChildren();
      const loading = document.createXULElement("menuitem");
      loading.classList.add("bgalazka-container-status");
      loading.setAttribute("label", "Loading Firefox/Zen containers…");
      loading.setAttribute("disabled", "true");
      containerPopup.appendChild(loading);
    }

    // Merge in Zen's profile containers.json asynchronously. This fixes Zen
    // builds where the service's public clone/localization path is broken.
    try {
      const refreshed = await refreshFirefoxContainerState();
      renderState(refreshed);
    } catch (e) {
      console.warn(
        "[BgalazkaExtension] Failed to refresh Firefox/Zen containers:",
        e,
      );
    }
  }

  function ensurePanelPrivacyMenuItems() {
    const popup = document.getElementById("zen-apps-sidebar-tile-context");
    if (!popup) return false;
    const preloadItem = popup.querySelector("#zen-apps-sidebar-preload-item");
    if (!preloadItem) return false;

    let containerMenu = popup.querySelector("#zen-apps-sidebar-container-menu");
    let containerPopup = popup.querySelector(
      "#zen-apps-sidebar-container-popup",
    );
    let clearItem = popup.querySelector(
      "#zen-apps-sidebar-clear-panel-data-item",
    );

    if (!containerMenu) {
      containerMenu = document.createXULElement("menu");
      containerMenu.id = "zen-apps-sidebar-container-menu";
      containerMenu.setAttribute("label", "Container: Default");
      containerMenu.setAttribute(
        "tooltiptext",
        "Choose the Firefox Container used by this app panel",
      );

      containerPopup = document.createXULElement("menupopup");
      containerPopup.id = "zen-apps-sidebar-container-popup";
      containerMenu.appendChild(containerPopup);
      preloadItem.insertAdjacentElement("afterend", containerMenu);
    }

    if (!clearItem) {
      clearItem = document.createXULElement("menuitem");
      clearItem.id = "zen-apps-sidebar-clear-panel-data-item";
      clearItem.setAttribute("label", "Clear Panel Cache & Cookies");
      clearItem.setAttribute(
        "tooltiptext",
        "Clear cookies and caches for this app's site in its selected Firefox Container",
      );
      containerMenu.insertAdjacentElement("afterend", clearItem);
    }

    if (!popup._bgalazkaPanelPrivacyMenuHooked) {
      popup._bgalazkaPanelPrivacyMenuHooked = true;

      const onPopupShowing = (event) => {
        // popupshowing bubbles from the Container submenu too. Rebuilding the
        // submenu while it is itself opening can make XUL close/reopen it, so
        // only handle the top-level app context popup here.
        if (event.target !== popup) return;
        const appId = popup.dataset.activeAppId || "";
        const menu = popup.querySelector("#zen-apps-sidebar-container-menu");
        const sub = popup.querySelector("#zen-apps-sidebar-container-popup");
        const clear = popup.querySelector(
          "#zen-apps-sidebar-clear-panel-data-item",
        );
        if (!menu || !sub || !clear) return;

        menu.hidden = !appId;
        clear.hidden = !appId;
        clear.removeAttribute("disabled");
        clear.disabled = false;
        clear.setAttribute("label", "Clear Panel Cache & Cookies");
        if (!appId) return;

        rebuildPanelContainerSubmenu(popup, menu, sub);
        if (!getStoredZentralApp(appId)?.url) {
          clear.setAttribute("disabled", "true");
          clear.disabled = true;
        }
      };

      const onClearCommand = async (event) => {
        const target = event.target;
        if (target?.id !== "zen-apps-sidebar-clear-panel-data-item") return;
        const appId = popup.dataset.activeAppId || "";
        if (!appId || target.disabled) return;

        target.disabled = true;
        target.setAttribute("disabled", "true");
        target.setAttribute("label", "Clearing Cache & Cookies…");
        try {
          await clearPanelCacheAndCookies(appId);
          target.setAttribute("label", "Cache & Cookies Cleared");
        } catch (e) {
          console.error(
            "[BgalazkaExtension] Failed to clear panel cache/cookies:",
            appId,
            e,
          );
          target.setAttribute("label", "Clear Failed — See Browser Console");
        } finally {
          target.disabled = false;
          target.removeAttribute("disabled");
        }
      };

      popup.addEventListener("popupshowing", onPopupShowing);
      popup.addEventListener("command", onClearCommand);
      registerCleanup(() => {
        try {
          popup.removeEventListener("popupshowing", onPopupShowing);
          popup.removeEventListener("command", onClearCommand);
          delete popup._bgalazkaPanelPrivacyMenuHooked;
          popup.querySelector("#zen-apps-sidebar-container-menu")?.remove();
          popup
            .querySelector("#zen-apps-sidebar-clear-panel-data-item")
            ?.remove();
        } catch (_) {}
      });
    }

    return true;
  }

  if (!safeCall(ensurePanelPrivacyMenuItems, "ensurePanelPrivacyMenuItems")) {
    let panelPrivacyMenuAttempts = 0;
    const panelPrivacyMenuTimer = setInterval(() => {
      panelPrivacyMenuAttempts++;
      if (
        safeCall(ensurePanelPrivacyMenuItems, "ensurePanelPrivacyMenuItems") ||
        panelPrivacyMenuAttempts > 40
      ) {
        clearInterval(panelPrivacyMenuTimer);
      }
    }, 150);
    registerCleanup(() => clearInterval(panelPrivacyMenuTimer));
  }

  /* ==========================================================================
   * FIREFOX ADD-ON TAB-ID BRIDGE (architecture note 27)
   * --------------------------------------------------------------------------
   * A standalone chrome <browser> is not a gBrowser tab. Firefox WebExtension
   * tab tracking therefore cannot give it the normal tab identity expected by
   * add-ons that use sender.tab.id / browser.tabs.*.
   *
   * The important part is that we do NOT create a dummy tab beside the panel.
   * We create the real tab first, then lend its actual linkedBrowser to the
   * base Zentral getOrCreateAppBrowser() factory. Because the interception is
   * synchronous and scoped to one exact createXULElement("browser") call, the
   * base implementation's PRIVATE appBrowsers Map ends up containing the real
   * tab browser naturally. No Zentral core/private-field edit is required.
   * ========================================================================== */
  const ADDON_HOST_FOLDER_ID = "bgalazka-zentral-addon-hosts";
  const ADDON_HOST_FOLDER_LABEL = "Zentral Add-on Hosts";
  const addonHostByAppId = new Map();
  const addonHostByTab = new WeakMap();
  let addonHostFolder = null;
  let lastNonAddonHostTab = window.gBrowser?.selectedTab || null;
  let addonBridgeResetting = false;

  function isAddonTabIdBridgeEnabled() {
    return getPref(BGALAZKA_EXT_PREFS.ADDON_TAB_ID_BRIDGE, false);
  }

  function isAddonHostFolderVisible() {
    return getPref(BGALAZKA_EXT_PREFS.SHOW_ADDON_HOST_FOLDER, false);
  }

  function updateAddonHostInspection() {
    const status = document.getElementById("zs-addon-host-inspection");
    if (!status) return;
    status.hidden = !isAddonHostFolderVisible();
    if (status.hidden) return;
    if (!isAddonTabIdBridgeEnabled()) {
      status.textContent =
        "Real Tab IDs is off. Enable it and open a web panel to create a host tab.";
      return;
    }
    const folder = findAddonHostFolder();
    const hosts = [...addonHostByAppId.values()].filter(
      (record) => record.tab?.isConnected,
    );
    const fallback = document.querySelectorAll(
      'tab[bgalazka-addon-host-fallback="true"]',
    ).length;
    const names = hosts
      .map((record) => getAddonHostAppLabel(record.app))
      .join(", ");
    const folderVisible =
      folder &&
      getComputedStyle(folder).display !== "none" &&
      folder.getBoundingClientRect().height > 0;
    status.textContent =
      !hosts.length && !folder && !fallback
        ? "No host tabs yet. Open a web panel to create one."
        : `${folder ? (folderVisible ? "Folder visible" : "Folder exists but is hidden by the sidebar layout") : fallback ? "Pinned tab fallback (no Zen folder)" : "Folder missing"} · ${hosts.length} active host tab${hosts.length === 1 ? "" : "s"}${names ? `: ${names}` : ""}`;
  }

  function getAddonHostAppLabel(app) {
    return String(
      app?.name || app?.title || app?.label || app?.url || app?.id || "App",
    ).slice(0, 80);
  }

  function findAddonHostFolder() {
    if (
      addonHostFolder?.isConnected &&
      (addonHostFolder.isZenFolder ||
        addonHostFolder.localName === "zen-folder")
    ) {
      return addonHostFolder;
    }
    const existing =
      document.getElementById(ADDON_HOST_FOLDER_ID) ||
      document.querySelector('zen-folder[bgalazka-addon-host-folder="true"]');
    if (
      existing &&
      (existing.isZenFolder || existing.localName === "zen-folder")
    ) {
      addonHostFolder = existing;
      existing.setAttribute("bgalazka-addon-host-folder", "true");
      return existing;
    }
    addonHostFolder = null;
    return null;
  }

  function keepAddonHostFolderCollapsed(folder) {
    if (!folder) return;
    folder.setAttribute("bgalazka-addon-host-folder", "true");
    // Zen applies the initial collapsed state on a zero-delay timer. Reveal
    // the folder's tab list when inspection is enabled, including at startup.
    setTimeout(() => {
      try {
        if (!folder.isConnected) return;
        folder.collapsed = !isAddonHostFolderVisible();
        if (folder.collapsed) {
          folder.removeAttribute("has-active");
          window.gZenFolders?.relayoutCollapsedFolder?.(folder);
        }
      } catch (_) {}
    }, 0);
  }

  function putAddonHostTabInFolder(tab) {
    if (!tab || !window.gBrowser) return null;
    let folder = findAddonHostFolder();

    try {
      if (folder) {
        if (!tab.pinned) gBrowser.pinTab(tab);
        if (tab.group !== folder) folder.addTabs([tab]);
        tab.removeAttribute("bgalazka-addon-host-fallback");
        keepAddonHostFolderCollapsed(folder);
        return folder;
      }

      if (window.gZenFolders?.createFolder) {
        const workspaceId =
          tab.getAttribute?.("zen-workspace-id") ||
          window.gZenWorkspaces?.activeWorkspace ||
          undefined;
        folder = window.gZenFolders.createFolder([tab], {
          id: ADDON_HOST_FOLDER_ID,
          label: ADDON_HOST_FOLDER_LABEL,
          renameFolder: false,
          collapsed: true,
          workspaceId,
        });
        addonHostFolder = folder;
        tab.removeAttribute("bgalazka-addon-host-fallback");
        keepAddonHostFolderCollapsed(folder);
        return folder;
      }
    } catch (e) {
      console.warn(
        "[BgalazkaExtension] Could not place add-on host tab in Zen folder; falling back to a pinned tab:",
        e,
      );
    }

    // Compatibility fallback for Zen builds where the internal folder API is
    // unavailable/changed. A normal pinned tab still provides the real tabId;
    // CSS compacts the marked tab as much as possible.
    try {
      if (!tab.pinned) gBrowser.pinTab(tab);
      tab.setAttribute("bgalazka-addon-host-fallback", "true");
    } catch (_) {}
    return null;
  }

  function createAddonHostRecord(app, userContextId) {
    if (!window.gBrowser?.addTab) return null;
    const appId = app?.id;
    if (!appId) return null;

    const existing = addonHostByAppId.get(appId);
    if (existing?.tab?.isConnected && existing?.browser) return existing;

    const id = normalizeUserContextId(userContextId);
    const options = {
      skipAnimation: true,
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    };
    if (id) options.userContextId = id;

    let tab = null;
    try {
      tab = gBrowser.addTab("about:blank", options);
      if (!tab?.linkedBrowser)
        throw new Error("gBrowser.addTab returned no linkedBrowser");

      tab.setAttribute("bgalazka-addon-host", "true");
      tab.setAttribute("data-bgalazka-app-id", String(appId));
      tab.setAttribute("label", `Zentral Host · ${getAddonHostAppLabel(app)}`);
      tab._bgalazkaAddonAppId = appId;

      const browser = tab.linkedBrowser;
      browser._bgalazkaAddonHostBrowser = true;
      browser._bgalazkaAddonHostTab = tab;
      browser._bgalazkaAppId = appId;

      // Remember where Firefox originally mounted this linkedBrowser. Zentral
      // will reparent the SAME element into its floating panel. Before a host
      // tab is removed we put it back so gBrowser.removeTab() sees the normal
      // tabbrowser DOM shape and can tear it down safely.
      const originalParent = browser.parentNode;
      const originalNextSibling = browser.nextSibling;
      const record = {
        appId,
        app,
        tab,
        browser,
        originalParent,
        originalNextSibling,
        adoptedByZentral: false,
      };
      addonHostByAppId.set(appId, record);
      addonHostByTab.set(tab, record);

      putAddonHostTabInFolder(tab);
      return record;
    } catch (e) {
      console.error("[BgalazkaExtension] Failed to create add-on host tab:", e);
      try {
        if (tab?.isConnected) {
          gBrowser.removeTab(tab, {
            animate: false,
            skipPermitUnload: true,
            skipSessionStore: true,
          });
        }
      } catch (_) {}
      return null;
    }
  }

  function restoreAddonHostBrowserToTab(record) {
    const browser = record?.browser;
    const parent = record?.originalParent;
    if (!browser || !parent?.isConnected || browser.parentNode === parent)
      return;
    try {
      const before =
        record.originalNextSibling?.parentNode === parent
          ? record.originalNextSibling
          : null;
      parent.insertBefore(browser, before);
    } catch (e) {
      try {
        parent.appendChild(browser);
      } catch (_) {}
    }
  }

  function removeAddonHostRecord(appId, { removeTab = true } = {}) {
    const record = addonHostByAppId.get(appId);
    if (!record) return null;

    // Remove our lookup FIRST. Our own removeTab() emits TabClose; doing this
    // first distinguishes that expected event from a user manually closing a
    // host tab, which is handled by addonHostTabCloseHandler below.
    addonHostByAppId.delete(appId);
    if (record.browser) {
      // Return the linkedBrowser to normal tab-switcher ownership before
      // restoring/removing its backing tab.
      record.browser.zenModeActive = false;
      record.browser._bgalazkaAddonHostBrowser = false;
      record.browser._bgalazkaAddonHostTab = null;
    }

    if (removeTab && record.tab?.isConnected) {
      restoreAddonHostBrowserToTab(record);
      try {
        gBrowser.removeTab(record.tab, {
          animate: false,
          skipPermitUnload: true,
          skipSessionStore: true,
        });
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] Failed to remove add-on host tab:",
          e,
        );
      }
    }
    return record;
  }

  function removeEmptyAddonHostFolder() {
    const folder = findAddonHostFolder();
    if (!folder || addonHostByAppId.size) return;
    addonHostFolder = null;
    try {
      // Zen's folder owns an internal about:blank placeholder. delete() is the
      // correct API because it cleans that placeholder and folder state too.
      const maybePromise = folder.delete?.();
      maybePromise?.catch?.(() => {});
    } catch (_) {}
  }

  function unloadPanelBrowsersForAddonBridge() {
    const apps = window.Zentral?.Apps;
    if (!apps || addonBridgeResetting) return;
    addonBridgeResetting = true;
    try {
      // Toggling cannot safely retrofit an already-created standalone
      // <browser> into a real tab. Unload each loaded app so its next open goes
      // through the real-tab factory from the beginning.
      const ids = new Set();
      for (const browser of getAllAppBrowsers()) {
        if (browser?._bgalazkaAppId) ids.add(browser._bgalazkaAppId);
      }
      for (const appId of addonHostByAppId.keys()) ids.add(appId);

      try {
        apps.closePanel?.();
      } catch (_) {}
      for (const appId of ids) {
        try {
          apps.closeApp?.(appId);
        } catch (e) {
          console.warn(
            "[BgalazkaExtension] Failed to unload panel while changing add-on bridge mode:",
            appId,
            e,
          );
        }
      }
    } finally {
      addonBridgeResetting = false;
      if (!isAddonTabIdBridgeEnabled()) removeEmptyAddonHostFolder();
    }
  }

  function syncAddonHostBrowserActivity() {
    for (const record of addonHostByAppId.values()) {
      if (!record?.adoptedByZentral || !record.browser?.isConnected) continue;
      try {
        // Zen's tab switcher can deactivate a real tab-backed browser when
        // another tab is selected. Split view uses zenModeActive to prevent
        // that; an adopted panel browser needs the same protection.
        record.browser.zenModeActive = true;
        if (record.browser.docShellIsActive !== true)
          record.browser.docShellIsActive = true;
      } catch (_) {}
    }
  }

  // ROOT FIX for "panel loads, plays for a second, then goes gray while
  // audio keeps playing" -- see ARCHITECTURE NOTE 28 above initBgalazkaExtension()
  // for the full symptom/diagnosis/fix history before changing anything here.
  //
  // Short version: core's getOrCreateAppBrowser() (and the
  // preload-sequence path) create standalone <browser remote="true">
  // elements that never sit in gBrowser's tab strip. Nothing in Gecko
  // activates those docShells on its own, and nothing in core ever sets
  // docShellIsActive either (see BUG-NOTES above the addon-host fix,
  // which only patches one narrow adopted-browser case). Gecko paints the
  // very first frame regardless, then treats the docShell as inactive and
  // stops compositing it - the tab's content process (and its audio) is
  // untouched, so playback continues while the panel goes visually gray.
  // This is independent of smart_sleep / any other toggle: it happens to
  // every panel browser, preloaded or not, the moment it's first shown.
  //
  // Fix: mirror docShellIsActive to the same display:none/'' visibility
  // flag core already uses to track which panel browser is on-screen
  // (getAllAppBrowsers() covers the normal grid, the Essentials/addon-host
  // bridge, and Triple/Super-View secondary browsers in one pass). This
  // also restores the resource-saving half of "smart sleep": browsers that
  // get hidden are explicitly deactivated instead of being left however
  // Gecko happens to leave them.
  function syncAppPanelBrowserActivity(browsers = getAllAppBrowsers()) {
    for (const browser of browsers) {
      if (!browser?.isConnected) continue;
      try {
        // On close, the slider is hidden even though a child browser can
        // retain display:"". Do not keep a hidden panel's docshell active.
        const panelOpen =
          document.documentElement.getAttribute("zentral-app-panel-open") ===
          "true";
        // An Essential explicitly set to Load at Startup must stay active
        // while its panel is hidden so notification pages can keep updating.
        // Other hidden app browsers retain the existing idle behavior.
        const essential = essentialPanels.get(browser._bgalazkaAppId);
        const backgroundPreload =
          essential?.app.preload && essential.tab.isConnected;
        const hostRecord = addonHostByAppId.get(browser._bgalazkaAppId);
        const adoptedHost =
          hostRecord?.adoptedByZentral && hostRecord.browser === browser;
        // A real-tab-backed browser must stay active while it is adopted.
        // syncAddonHostBrowserActivity() keeps it active on close, so setting
        // it false here immediately afterward caused an activation fight.
        const shouldBeActive =
          !!adoptedHost ||
          !!backgroundPreload ||
          (panelOpen && browser.style.display !== "none");
        // Gecko may reset this flag during navigation/process swaps. Only
        // write on a real state change: repeatedly assigning true while a
        // remote browser is loading can keep its tab in a busy/gray cycle.
        if (browser.docShellIsActive !== shouldBeActive)
          browser.docShellIsActive = shouldBeActive;
      } catch (_) {}
    }
  }

  function setAddonTabIdBridgeEnabled(enabled) {
    document.documentElement.setAttribute(
      "bgalazka-addon-tab-id-bridge",
      enabled ? "true" : "false",
    );
    unloadPanelBrowsersForAddonBridge();
  }

  function callGetOrCreateWithAddonHostBrowser(
    origGetOrCreateBrowser,
    app,
    userContextId,
  ) {
    if (!isAddonTabIdBridgeEnabled()) {
      return callGetOrCreateWithPanelUserContext(
        origGetOrCreateBrowser,
        app,
        userContextId,
      );
    }

    // If this app already has a bridge record, the base private Map should
    // return that same connected browser without creating anything new.
    const existing = addonHostByAppId.get(app?.id);
    if (existing?.browser?.isConnected && existing.adoptedByZentral) {
      return callGetOrCreateWithPanelUserContext(
        origGetOrCreateBrowser,
        app,
        userContextId,
      );
    }

    const record = createAddonHostRecord(app, userContextId);
    if (!record) {
      // Fail open: Zentral still works even if Zen's tab/folder internals have
      // changed. Only add-on tab-ID compatibility is lost for this instance.
      return callGetOrCreateWithPanelUserContext(
        origGetOrCreateBrowser,
        app,
        userContextId,
      );
    }

    const nativeCreateXULElement = document.createXULElement;
    let intercepted = false;
    try {
      document.createXULElement = function (name, options) {
        if (!intercepted && String(name).toLowerCase() === "browser") {
          intercepted = true;
          return record.browser;
        }
        return nativeCreateXULElement.call(this, name, options);
      };
      if (document.createXULElement === nativeCreateXULElement) {
        throw new Error(
          "document.createXULElement could not be temporarily wrapped",
        );
      }

      const result = callGetOrCreateWithPanelUserContext(
        origGetOrCreateBrowser,
        app,
        userContextId,
      );

      if (!intercepted || !result?.isNew || result.browser !== record.browser) {
        // A pre-existing standalone panel browser beat us to the base Map.
        // Remove the unused host and keep the working base result rather than
        // trying to mutate private state after the fact.
        removeAddonHostRecord(record.appId);
        removeEmptyAddonHostFolder();
        return result;
      }

      record.adoptedByZentral = true;
      // Keep the host's tab identity without letting Zen deactivate its
      // reparented browser when the ordinary selected tab changes.
      result.browser.zenModeActive = true;
      result.browser.setAttribute("bgalazka-addon-host-browser", "true");
      return result;
    } catch (e) {
      removeAddonHostRecord(record.appId);
      removeEmptyAddonHostFolder();
      console.error(
        "[BgalazkaExtension] Real-tab browser adoption failed; using normal Zentral browser:",
        e,
      );
      return callGetOrCreateWithPanelUserContext(
        origGetOrCreateBrowser,
        app,
        userContextId,
      );
    } finally {
      try {
        document.createXULElement = nativeCreateXULElement;
      } catch (_) {}
    }
  }

  // The host's linkedBrowser belongs to a real tab, but that tab is never a
  // valid destination for the selected browser. Keep this test centralized so
  // unload, close, discard, and TabSelect recovery all enforce the same rule.
  function isAddonHostTab(tab) {
    return !!(
      tab &&
      (tab.hasAttribute?.("bgalazka-addon-host") ||
        tab.hasAttribute?.("bgalazka-addon-host-fallback") ||
        tab.closest?.(
          "#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']",
        ))
    );
  }

  function isUsableNormalTab(tab) {
    return !!(
      tab?.isConnected &&
      !tab.closing &&
      !tab.hidden &&
      !isAddonHostTab(tab)
    );
  }

  function isOrdinaryTab(tab) {
    // Zen's pinned tabs, Essentials, and empty-tab placeholder are all real
    // tabs, but none counts as an ordinary successor when the last one closes.
    // A discarded ordinary tab still counts: selecting it restores its page.
    return !!(
      isUsableNormalTab(tab) &&
      !tab.pinned &&
      !tab.hasAttribute("zen-essential") &&
      !tab.hasAttribute("zen-empty-tab")
    );
  }

  function findVisibleOrdinaryTab(except) {
    return [...(gBrowser.visibleTabs || gBrowser.tabs)].find(
      (tab) => tab !== except && isOrdinaryTab(tab),
    );
  }

  function createNormalTabForAddonHost() {
    try {
      // Use Zen's own empty-tab selection so URL-bar-only new tabs keep their
      // native invisible placeholder. Its tab is a safe selected browser even
      // while the panel's real host tabs remain open in the background.
      if (typeof window.gZenWorkspaces?.selectEmptyTab === "function") {
        try {
          window.gZenWorkspaces.selectEmptyTab("about:blank");
          const tab = gBrowser.selectedTab;
          if (isUsableNormalTab(tab)) {
            lastNonAddonHostTab = tab;
            return tab;
          }
        } catch (error) {
          console.warn(
            "[BgalazkaExtension] Zen empty-tab selection failed:",
            error,
          );
        }
      }
      // Older Zen builds may lack selectEmptyTab. Keep a real blank tab in
      // that case rather than allow the adopted panel browser to be selected.
      const tab = gBrowser.addTab("about:blank", {
        inBackground: true,
        skipAnimation: true,
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      });
      if (tab) {
        lastNonAddonHostTab = tab;
        gBrowser.selectedTab = tab;
      }
      return tab;
    } catch (error) {
      console.warn(
        "[BgalazkaExtension] Could not select an empty tab after the last ordinary tab closed:",
        error,
      );
      return null;
    }
  }

  // Central invariant for the real-tab bridge: a Zentral panel host may exist
  // in gBrowser for WebExtension tabId compatibility, but it must never remain
  // the selected tab. Prefer an already-safe tab, then the last safe tab, then
  // another ordinary tab, and finally Zen's own invisible empty tab.
  function ensureSafeSelectedTabForAddonHosts(exceptTab = null) {
    if (!isAddonTabIdBridgeEnabled() || addonHostByAppId.size === 0) {
      return gBrowser.selectedTab;
    }

    const selected = gBrowser.selectedTab;
    if (
      selected !== exceptTab &&
      isUsableNormalTab(selected) &&
      !isAddonHostTab(selected)
    ) {
      lastNonAddonHostTab = selected;
      return selected;
    }

    let candidate = null;
    if (
      lastNonAddonHostTab !== exceptTab &&
      isUsableNormalTab(lastNonAddonHostTab) &&
      !isAddonHostTab(lastNonAddonHostTab)
    ) {
      candidate = lastNonAddonHostTab;
    } else {
      candidate = findVisibleOrdinaryTab(exceptTab);
    }

    if (candidate) {
      try {
        gBrowser.selectedTab = candidate;
        if (
          gBrowser.selectedTab === candidate &&
          candidate !== exceptTab &&
          !isAddonHostTab(candidate)
        ) {
          lastNonAddonHostTab = candidate;
          return candidate;
        }
      } catch (_) {}
    }

    const emptyTab = createNormalTabForAddonHost();
    if (
      emptyTab?.isConnected &&
      gBrowser.selectedTab === emptyTab &&
      emptyTab !== exceptTab &&
      !isAddonHostTab(emptyTab)
    ) {
      return emptyTab;
    }
    return null;
  }

  // Selection can settle over more than one turn during close/discard. Repair
  // immediately, in a microtask, on the next task, and once on the next frame.
  // Every pass is conditional, so normal user selection is left untouched.
  function repairAddonHostSelectionAfterTransition(exceptTab = null) {
    if (!isAddonTabIdBridgeEnabled() || addonHostByAppId.size === 0) return;

    const repair = () => {
      if (!isAddonTabIdBridgeEnabled() || addonHostByAppId.size === 0) return;
      const selected = gBrowser.selectedTab;
      if (
        selected === exceptTab ||
        isAddonHostTab(selected) ||
        !isUsableNormalTab(selected)
      ) {
        ensureSafeSelectedTabForAddonHosts(exceptTab);
      }
    };

    repair();
    Promise.resolve().then(repair);
    window.setTimeout(repair, 0);
    window.requestAnimationFrame?.(repair);
  }

  // A click/keyboard selection of a host returns to a normal tab and opens
  // the corresponding panel. The saved tab can have closed in the meantime.
  // No MutationObserver is used -- see the tab crash guard above.
  const addonHostTabSelectHandler = (event) => {
    const tab = event.target;
    const record = addonHostByTab.get(tab);

    // Enforce the invariant synchronously. This handler is registered in the
    // capture phase below so our reparented panel browser is moved off the
    // selected slot before ordinary bubbling TabSelect listeners run.
    if (isAddonTabIdBridgeEnabled() && isAddonHostTab(tab)) {
      const safeTab = ensureSafeSelectedTabForAddonHosts(tab);
      if (record) keepAddonHostFolderCollapsed(record.tab?.group);
      if (!safeTab) return;

      // Preserve the old inspection-folder behavior: selecting a host means
      // "show its panel", but the host itself never stays selected.
      if (record?.app) {
        window.setTimeout(() => {
          try {
            if (record.tab?.isConnected) {
              window.Zentral?.Apps?.openPanel?.(record.app);
            }
          } catch (_) {}
        }, 0);
      }
      return;
    }

    if (!record) {
      if (isUsableNormalTab(tab)) lastNonAddonHostTab = tab;
      return;
    }
  };

  const addonHostTabCloseHandler = (event) => {
    const tab = event.target;
    const record = addonHostByTab.get(tab);
    if (!record) {
      const wasActiveNonHostTab =
        gBrowser.selectedTab === tab || lastNonAddonHostTab === tab;
      if (lastNonAddonHostTab === tab) lastNonAddonHostTab = null;
      if (
        isAddonTabIdBridgeEnabled() &&
        addonHostByAppId.size &&
        wasActiveNonHostTab &&
        !tab.hasAttribute("bgalazka-addon-host") &&
        !tab.hasAttribute("bgalazka-addon-host-fallback") &&
        !tab.closest(
          "#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']",
        ) &&
        !tab.hasAttribute("zen-empty-tab") &&
        !findVisibleOrdinaryTab(tab)
      ) {
        // TabClose fires while the closing tab is still in the tab strip.
        // The closing tab can be ordinary, pinned, or Essential. Supply Zen's
        // empty-tab successor now, before native close logic can pick a host.
        createNormalTabForAddonHost();
      }
      return;
    }
    if (addonHostByAppId.get(record.appId) !== record) return;

    // This path means the user/Zen closed the backing tab directly. Let the
    // tab close finish first, then ask Zentral to unload the matching private
    // Map entry/browser. Our own programmatic teardown removes the Map record
    // before removeTab(), so it never enters this branch.
    restoreAddonHostBrowserToTab(record);
    addonHostByAppId.delete(record.appId);
    record.browser.zenModeActive = false;
    setTimeout(() => {
      try {
        window.Zentral?.Apps?.closeApp?.(record.appId);
      } catch (_) {}
      removeEmptyAddonHostFolder();
    }, 0);
  };

  const addonHostTabDiscardedHandler = (event) => {
    const tab = event.target;
    if (!isAddonTabIdBridgeEnabled() || !addonHostByAppId.size) return;

    // A discard can trigger more than one native selection adjustment. Treat
    // every discard as a chance to reassert the bridge invariant; the repair
    // helper is a no-op while a normal/Essential/empty tab is safely selected.
    if (lastNonAddonHostTab === tab) lastNonAddonHostTab = null;
    repairAddonHostSelectionAfterTransition(tab);
  };

  // Capture TabSelect so a real panel-host tab is redirected before normal
  // bubbling listeners can treat its reparented browser as the active page.
  window.addEventListener("TabSelect", addonHostTabSelectHandler, true);
  window.addEventListener("TabClose", addonHostTabCloseHandler);
  window.addEventListener("TabBrowserDiscarded", addonHostTabDiscardedHandler);
  registerCleanup(() => {
    window.removeEventListener("TabSelect", addonHostTabSelectHandler, true);
    window.removeEventListener("TabClose", addonHostTabCloseHandler);
    window.removeEventListener(
      "TabBrowserDiscarded",
      addonHostTabDiscardedHandler,
    );
    const apps = window.Zentral?.Apps;
    const ids = [...addonHostByAppId.keys()];
    for (const appId of ids) {
      try {
        apps?.closeApp?.(appId);
      } catch (_) {
        removeAddonHostRecord(appId);
      }
    }
    removeEmptyAddonHostFolder();
  });

  function callGetOrCreateWithPanelUserContext(
    origGetOrCreateBrowser,
    app,
    userContextId,
  ) {
    const id = normalizeUserContextId(userContextId);
    if (!id) return origGetOrCreateBrowser(app);

    // The base function writes usercontextid="0" before appendChild(). Patch
    // Element.prototype only for the synchronous duration of that one call and
    // only for the exact unattached content <browser> shape Zentral creates.
    // This gets the desired id onto the element before connectedCallback/frame
    // loader creation without editing a single line of the base implementation.
    const proto = window.Element?.prototype;
    const nativeSetAttribute = proto?.setAttribute;
    let patched = false;

    if (proto && typeof nativeSetAttribute === "function") {
      try {
        proto.setAttribute = function (name, value) {
          let nextValue = value;
          if (
            String(name).toLowerCase() === "usercontextid" &&
            this?.localName === "browser" &&
            (this._bgalazkaAddonHostBrowser ||
              (!this.isConnected &&
                this.getAttribute?.("type") === "content" &&
                this.getAttribute?.("messagemanagergroup") === "browsers"))
          ) {
            nextValue = String(id);
          }
          return nativeSetAttribute.call(this, name, nextValue);
        };
        patched = proto.setAttribute !== nativeSetAttribute;
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] Could not pre-apply panel userContextId:",
          e,
        );
      }
    }

    try {
      return origGetOrCreateBrowser(app);
    } finally {
      if (patched) {
        try {
          proto.setAttribute = nativeSetAttribute;
        } catch (_) {}
      }
    }
  }

  function applyPanelContainerLoadContext(browser, userContextId) {
    const id = normalizeUserContextId(userContextId);
    if (!browser || !id) return;

    browser._bgalazkaUserContextId = id;
    try {
      // Normally already correct from callGetOrCreateWithPanelUserContext().
      // Keep this as a defensive postcondition for browser builds where the
      // temporary prototype interception is unavailable.
      if (
        normalizeUserContextId(browser.getAttribute("usercontextid")) !== id
      ) {
        browser.setAttribute("usercontextid", String(id));
      }
    } catch (_) {}

    if (browser._bgalazkaContainerLoadHooked) return;
    browser._bgalazkaContainerLoadHooked = true;

    const applyLoadOptions = (target, options) => {
      const next = { ...(options || {}), userContextId: id };
      try {
        const principal = next.triggeringPrincipal;
        if (principal?.isContentPrincipal) {
          const attrs = {
            ...(principal.originAttributes || {}),
            userContextId: id,
          };
          next.triggeringPrincipal =
            Services.scriptSecurityManager.principalWithOA(principal, attrs);
        } else if (!principal) {
          const uri =
            typeof target === "string" ? Services.io.newURI(target) : target;
          if (uri) {
            next.triggeringPrincipal =
              Services.scriptSecurityManager.createContentPrincipal(uri, {
                userContextId: id,
              });
          }
        }
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] Failed to apply container OriginAttributes to load:",
          e,
        );
      }
      return next;
    };

    const nativeFixupAndLoad = browser.fixupAndLoadURIString?.bind(browser);
    if (nativeFixupAndLoad) {
      try {
        browser.fixupAndLoadURIString = function (url, options = {}) {
          return nativeFixupAndLoad(url, applyLoadOptions(url, options));
        };
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] Could not wrap fixupAndLoadURIString for container loads:",
          e,
        );
      }
    }

    const nativeLoadURI = browser.loadURI?.bind(browser);
    if (nativeLoadURI) {
      try {
        browser.loadURI = function (uri, options = {}) {
          return nativeLoadURI(uri, applyLoadOptions(uri, options));
        };
      } catch (e) {
        console.warn(
          "[BgalazkaExtension] Could not wrap loadURI for container loads:",
          e,
        );
      }
    }
  }

  /* ==========================================================================
   * MOBILE USER AGENT TOGGLE (per-app checkbox, mirrors native "Load at Startup")
   * -----------------------------------------------------------------------
   * Feature: a per-app "Mobile User Agent" checkbox living in the same tile
   * right-click menu as the native "Load at Startup" item, remembered per-app
   * across restarts exactly the same way.
   *
   * WHY THIS IS HOOKED RATHER THAN EDITED IN PLACE (see notes 1 & 5 above):
   * - setupContextMenu() and getOrCreateAppBrowser() belong to the
   *   ZentralApps class defined in the base mod's own IIFE, ABOVE the
   *   Bgalazka marker. We never edit that source directly; we reach the
   *   singleton instance (window.Zentral.Apps, see note 5) and either wrap
   *   its methods or attach DOM nodes to elements it already built.
   * - We deliberately do NOT add a "mobileUA" field to the base mod's own
   *   app objects / saveApps() whitelist, since that means editing
   *   ZentralApps.saveApps() itself. Instead the per-app flag lives in its
   *   own dedicated pref (a JSON array of app ids), entirely inside this
   *   extension, so the native save/load code never needs to change.
   * - Gecko does not re-apply a <browser>'s "useragent"/"customuseragent"
   *   attribute to an already-connected/loaded docShell. So flipping the
   *   checkbox unloads that app's browser via the singleton's own
   *   closeApp() (same public method "Unload App" already uses) instead of
   *   trying to hot-swap the UA live — it reloads with the correct UA next
   *   time the app is opened or preloaded.
   * ========================================================================== */
  const MOBILE_UA_PREF = "zen.workspace.bgalazka.mobile_ua_apps";
  const MOBILE_UA_STRING =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";

  function getMobileUaAppIds() {
    try {
      const raw = Services.prefs.getStringPref(MOBILE_UA_PREF, "[]");
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) {
      return new Set();
    }
  }

  function saveMobileUaAppIds(set) {
    try {
      Services.prefs.setStringPref(
        MOBILE_UA_PREF,
        JSON.stringify(Array.from(set)),
      );
    } catch (e) {
      console.warn("[BgalazkaExtension] Failed to save mobile UA list:", e);
    }
  }

  function isMobileUaApp(appId) {
    if (essentialPanels.has(appId))
      return !!essentialPanels.get(appId).mobileUa;
    return !!appId && getMobileUaAppIds().has(appId);
  }

  function toggleMobileUaApp(appId) {
    const essential = essentialPanels.get(appId);
    if (essential) {
      essential.mobileUa = !essential.mobileUa;
      saveEssentialSettings(essential);
      return essential.mobileUa;
    }
    const set = getMobileUaAppIds();
    const next = !set.has(appId);
    if (next) set.add(appId);
    else set.delete(appId);
    saveMobileUaAppIds(set);
    return next;
  }

  // Injects one extra <menuitem> into the native tile context menu, right
  // after "Load at Startup" — instead of editing ZentralApps.setupContextMenu().
  function ensureMobileUaMenuItem() {
    const popup = document.getElementById("zen-apps-sidebar-tile-context");
    if (!popup) return false;
    const preloadItem = popup.querySelector("#zen-apps-sidebar-preload-item");
    if (!preloadItem) return false;

    let item = popup.querySelector("#zen-apps-sidebar-mobile-ua-item");
    if (!item) {
      item = document.createXULElement("menuitem");
      item.id = "zen-apps-sidebar-mobile-ua-item";
      item.setAttribute("label", "Mobile User Agent");
      item.setAttribute("type", "checkbox");
      // Keep the privacy controls directly after the native preload row:
      // Load at Startup -> Container -> Clear Cache & Cookies -> Mobile UA.
      const insertionAnchor =
        popup.querySelector("#zen-apps-sidebar-clear-panel-data-item") ||
        popup.querySelector("#zen-apps-sidebar-container-menu") ||
        preloadItem;
      insertionAnchor.insertAdjacentElement("afterend", item);

      // Same hide/show + checked-state contract as the native items: driven
      // entirely by popup.dataset.activeAppId, which ZentralApps already
      // sets before showing the menu.
      popup.addEventListener("popupshowing", () => {
        const appId = popup.dataset.activeAppId || "";
        item.hidden = !appId;
        if (!appId) return;
        if (isMobileUaApp(appId)) item.setAttribute("checked", "true");
        else item.removeAttribute("checked");
      });

      item.addEventListener("command", () => {
        const appId = popup.dataset.activeAppId;
        if (!appId) return;
        const enabled = toggleMobileUaApp(appId);
        if (enabled) item.setAttribute("checked", "true");
        else item.removeAttribute("checked");

        // Force a clean reload with the new UA (see note above).
        const apps = window.Zentral?.Apps;
        // Let the XUL command/popup finish before destroying its live remote
        // browser. The next open creates a fresh context with the new UA.
        if (apps?.closeApp) setTimeout(() => apps.closeApp(appId), 0);
      });
    }
    return true;
  }

  if (!safeCall(ensureMobileUaMenuItem, "ensureMobileUaMenuItem")) {
    let mobileUaAttempts = 0;
    const mobileUaMenuTimer = setInterval(() => {
      mobileUaAttempts++;
      if (
        safeCall(ensureMobileUaMenuItem, "ensureMobileUaMenuItem") ||
        mobileUaAttempts > 40
      ) {
        clearInterval(mobileUaMenuTimer);
      }
    }, 150);
    registerCleanup(() => clearInterval(mobileUaMenuTimer));
  }

  /* ==========================================================================
   * WEB PANEL POPUP CONTAINMENT
   * -----------------------------------------------------------------------
   * Pages loaded inside a web panel occasionally try to escape it: a
   * target="_blank" link, a window.open() call, or (as reported) Startpage's
   * own result-link handling all ask Gecko to open a brand-new tab/window
   * rather than navigating the page that asked for it. Our app panel
   * <browser>s are NOT members of gBrowser.tabs (they live inside
   * #zen-app-panel-slider instead, see note 5), so such a request has no
   * "containing" tab to reuse and Gecko's normal fallback is to surface a
   * real tab in the MAIN window -- reported as "Startpage opens links in a
   * new tab no matter the setting" (Startpage's own new-window preference
   * only controls ITS OWN intent, not where Gecko actually lands it).
   *
   * FIX: hook nsIBrowserDOMWindow.openURI, the single chokepoint every such
   * request funnels through before any tab/window is actually created. If
   * the request's opener traces back to one of our own app <browser>s, load
   * the target URL into THAT SAME browser and hand its browsingContext back
   * instead of letting Gecko create anything new -- window.open()'s return
   * value (and any further script-driven navigation through it) then
   * transparently targets our panel browser too. This is intentionally
   * generic/site-agnostic (no Startpage-specific logic), so it also covers
   * any other site with the same "opens results in a new tab" behavior.
   * ========================================================================== */
  function getAllAppBrowsers() {
    const panel = document.getElementById("zen-app-panel-slider");
    const list = panel ? Array.from(panel.querySelectorAll("browser")) : [];
    // Cheap existence check first: Triple/Super-View is rare, so skip the
    // document-wide query entirely unless that panel actually exists.
    const superPanel = document.getElementById("bgalazka-super-panel");
    if (superPanel) list.push(...superPanel.querySelectorAll("browser"));
    return list;
  }

  // Zen Internet 3.2.0 stores its downloaded styles and all feature switches
  // in storage.local. Read its own data and render only into Zentral browsers.
  // This bridge never changes the add-on, native tabs, or their selected state.
  // Compatibility reference: Zen Internet and its my-internet styles are MIT
  // licensed by Transparent Zen; no upstream CSS is packaged with this mod.
  const ZEN_CSS_EXTENSION_ID = "{91aa3897-2634-4a8a-9092-279db23a7689}";
  const ZEN_CSS_CHANNEL =
    "ZentralZenCSS:" + Math.random().toString(36).slice(2);
  const ZEN_CSS_STYLE_ID = "zentral-zen-internet-styles";
  const ZEN_CSS_FRAME_SOURCE = `(() => {
    const bridgeGlobal = this;
    const channel = "${ZEN_CSS_CHANNEL}";
    const styleId = "${ZEN_CSS_STYLE_ID}";
    const normalizedUrl = value => String(value || "").split("#")[0];
    const currentInnerWindowId = () => {
      try {
        return Number(content?.windowGlobalChild?.innerWindowId) || 0;
      } catch (_) {
        return 0;
      }
    };

    // A userChrome mod can be reloaded while panel browsers/content processes
    // survive. Never return just because an older Zentral bridge exists: that
    // older bridge may listen on a different random channel, making every new
    // parent message a no-op until a full page reload. Tear down the previous
    // bridge/state and install this instance instead.
    try { this.__zentralZenCSSBridge?.teardown?.(); } catch (_) {}
    // Clean legacy bridge hooks from builds that predate __zentralZenCSSBridge.
    // Their message channel was not recorded, so that old message listener can
    // only die with the frame-global; its DOM listeners *are* removable here.
    try {
      const oldApply = this.__zentralZenCSSApplyPending;
      if (typeof oldApply === "function") {
        removeEventListener("DOMContentLoaded", oldApply, true);
        removeEventListener("pageshow", oldApply, true);
      }
      this.__zentralZenCSSPending = null;
      this.__zentralZenCSSApplyPending = null;
      this.__zentralZenCSSListener = null;
    } catch (_) {}
    try {
      const oldState = this.__zentralZenCSSState;
      oldState?.headObserver?.disconnect();
      oldState?.nativeObserver?.disconnect();
      oldState?.style?.remove?.();
    } catch (_) {}
    this.__zentralZenCSSState = null;

    let state = null;
    const clearState = () => {
      try {
        state?.headObserver?.disconnect();
        state?.nativeObserver?.disconnect();
        state?.style?.remove?.();
      } catch (_) {}
      state = null;
      this.__zentralZenCSSState = null;
    };

    const ensureState = doc => {
      if (state?.doc === doc) return state;
      clearState();
      state = { doc, css: "", native: null, style: null, head: null };
      this.__zentralZenCSSState = state;

      const updateNative = () => {
        const native = doc.getElementById("zeninternet-styles");
        if (native === state.native) return false;
        state.nativeObserver?.disconnect();
        state.native = native;
        if (native) {
          state.nativeObserver = new doc.defaultView.MutationObserver(sync);
          state.nativeObserver.observe(native, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        }
        return true;
      };

      const watchHead = () => {
        const head = doc.head || doc.documentElement;
        if (head === state.head) return false;
        state.headObserver?.disconnect();
        state.head = head;
        if (!head) return true;
        state.headObserver = new doc.defaultView.MutationObserver(mutations => {
          const nativeChanged = updateNative();
          if (nativeChanged || (state.css && state.style && !state.style.isConnected))
            sync();
          if (!state.style?.textContent) return;
          const addedCss = mutations.some(({ addedNodes }) =>
            Array.from(addedNodes).some(node => node !== state.style &&
              node !== state.native && node.nodeType === 1 &&
              (node.localName === "style" ||
               (node.localName === "link" && /stylesheet/i.test(node.rel)))));
          if (addedCss && state.head?.lastChild !== state.style)
            state.head?.appendChild(state.style);
        });
        state.headObserver.observe(head, { childList: true });
        return true;
      };

      const sync = () => {
        if (!state || state.doc !== doc) return;
        watchHead();
        updateNative();
        let style = state.style || doc.getElementById(styleId);
        if (!style && state.css) {
          style = doc.createElement("style");
          style.id = styleId;
        }
        state.style = style;
        if (!style) return;
        const nativeCss = state.native?.textContent || "";
        const expected = String(state.css || "").trim();
        const desired = expected && !nativeCss.includes(expected) ? state.css : "";
        if (style.textContent !== desired) style.textContent = desired;
        if (desired && style.parentNode !== state.head)
          state.head?.appendChild(style);
      };
      state.sync = sync;
      watchHead();
      return state;
    };

    const announce = reason => {
      try {
        const doc = content.document;
        const url = doc?.URL || "";
        const windowId = currentInnerWindowId();
        if (!/^https?:/i.test(url) || !windowId) return;
        sendAsyncMessage(channel + ":ready", { url, windowId, reason });
      } catch (_) {}
    };

    const onApply = message => {
      try {
        const data = message.data || {};
        const doc = content.document;
        const windowId = currentInnerWindowId();
        if (!doc || !windowId || Number(data.windowId) !== windowId) return;
        if (normalizedUrl(doc.URL) !== normalizedUrl(data.url)) return;
        if (data.reset) clearState();
        const current = ensureState(doc);
        current.css = typeof data.css === "string" ? data.css : "";
        current.sync();
        const expected = current.css.trim();
        const nativeCss = current.native?.textContent || "";
        const injectedCss = current.style?.textContent || "";
        const applied =
          !expected ||
          nativeCss.includes(expected) ||
          (!!current.style?.isConnected && injectedCss.includes(expected));
        sendAsyncMessage(channel + ":ack", {
          url: data.url,
          sequence: data.sequence,
          windowId,
          applied,
          expectedLength: expected.length,
          injectedLength: injectedCss.length,
          nativeLength: nativeCss.length,
          documentURL: doc.URL,
        });
      } catch (_) {}
    };

    const onProbe = message => {
      const data = message.data || {};
      if (data.clear) {
        clearState();
        return;
      }
      if (data.reset) clearState();
      announce(data.reset ? "repair" : "probe");
    };
    const onDocument = () => announce("document");

    addMessageListener(channel + ":apply", onApply);
    addMessageListener(channel + ":probe", onProbe);
    addEventListener("DOMContentLoaded", onDocument, true);
    addEventListener("pageshow", onDocument, true);

    const bridge = {
      channel,
      teardown() {
        try { removeMessageListener(channel + ":apply", onApply); } catch (_) {}
        try { removeMessageListener(channel + ":probe", onProbe); } catch (_) {}
        try { removeEventListener("DOMContentLoaded", onDocument, true); } catch (_) {}
        try { removeEventListener("pageshow", onDocument, true); } catch (_) {}
        clearState();
        if (bridgeGlobal.__zentralZenCSSBridge === bridge)
          bridgeGlobal.__zentralZenCSSBridge = null;
      },
    };
    this.__zentralZenCSSChannel = channel;
    this.__zentralZenCSSBridge = bridge;
    announce("install");
  })();`;
  const ZEN_CSS_FRAME_URI =
    "data:application/javascript;charset=utf-8," +
    encodeURIComponent(ZEN_CSS_FRAME_SOURCE);
  const zenCssBrowsers = new WeakMap();
  const zenCssUpdateVersions = new WeakMap();
  const zenCssFirstLoads = new WeakMap();
  let zenCssSource = null;
  let zenCssSourcePromise = null;
  let zenCssStorage = null;
  let zenCssExtension = null;
  let zenCssBackend = null;
  let zenCssChangeTimer = null;
  const ZEN_CSS_KEYS = [
    "styles",
    "transparentZenSettings",
    "skipThemingList",
    "skipForceThemingList",
    "fallbackBackgroundList",
    "stylesMapping",
    "userStylesMapping",
  ];

  function zenCssEnabled() {
    return getPref(BGALAZKA_EXT_PREFS.ZEN_INTERNET_PANEL_CSS, false);
  }

  function zenCssStorageChanged(changes) {
    if (
      !Object.keys(changes || {}).some(
        (key) =>
          ZEN_CSS_KEYS.includes(key) ||
          key.startsWith("transparentZenSettings."),
      )
    )
      return;
    zenCssSource = null;
    if (zenCssChangeTimer) clearTimeout(zenCssChangeTimer);
    zenCssChangeTimer = setTimeout(() => {
      zenCssChangeTimer = null;
      refreshZenInternetPanelCss();
    }, 150);
  }

  async function getZenCssStorage() {
    if (!zenCssEnabled()) return null;
    const { ExtensionParent } = ChromeUtils.importESModule(
      "resource://gre/modules/ExtensionParent.sys.mjs",
    );
    const extension =
      ExtensionParent.GlobalManager.getExtension(ZEN_CSS_EXTENSION_ID);
    if (!extension?.policy?.active || !extension.hasPermission("storage"))
      return null;
    if (zenCssStorage && zenCssExtension === extension) return zenCssStorage;
    if (zenCssBackend) {
      zenCssBackend.removeOnChangedListener(
        ZEN_CSS_EXTENSION_ID,
        zenCssStorageChanged,
      );
      zenCssBackend = null;
    }
    const { ExtensionStorageIDB } = ChromeUtils.importESModule(
      "resource://gre/modules/ExtensionStorageIDB.sys.mjs",
    );
    const selected = await ExtensionStorageIDB.selectBackend({ extension });
    if (!zenCssEnabled()) return null;
    let storage;
    if (selected.backendEnabled) {
      const db = await ExtensionStorageIDB.open(
        ExtensionStorageIDB.getStoragePrincipal(extension),
        extension.hasPermission("unlimitedStorage"),
      );
      if (!zenCssEnabled()) return null;
      storage = { get: (keys) => db.get(keys) };
      zenCssBackend = ExtensionStorageIDB;
    } else {
      const { ExtensionStorage } = ChromeUtils.importESModule(
        "resource://gre/modules/ExtensionStorage.sys.mjs",
      );
      storage = {
        get: (keys) => ExtensionStorage.get(ZEN_CSS_EXTENSION_ID, keys),
      };
      zenCssBackend = ExtensionStorage;
    }
    zenCssBackend.addOnChangedListener(
      ZEN_CSS_EXTENSION_ID,
      zenCssStorageChanged,
    );
    zenCssExtension = extension;
    zenCssStorage = storage;
    zenCssSource = null;
    return storage;
  }

  async function readZenCssSource() {
    if (
      zenCssSource &&
      Date.now() - zenCssSource.readAt <
        (zenCssSource.styles?.website ? 30000 : 1000)
    )
      return zenCssSource;
    if (zenCssSourcePromise) return zenCssSourcePromise;
    zenCssSourcePromise = (async () => {
      const storage = await getZenCssStorage();
      if (!storage) return null;
      const values = await storage.get(ZEN_CSS_KEYS);
      zenCssSource = { ...values, readAt: Date.now() };
      return zenCssSource;
    })();
    try {
      return await zenCssSourcePromise;
    } finally {
      zenCssSourcePromise = null;
    }
  }

  function matchZenCssFeatures(host, source) {
    const website = source?.styles?.website;
    if (!website || typeof website !== "object") return null;
    let bestKey = null;
    let bestLength = -1;
    for (const key of Object.keys(website)) {
      const site = key.replace(/\.css$/, "");
      const base = site.replace(/^www\./, "");
      let length = -1;
      if (host === base) length = 100000 + base.length;
      else if (site.startsWith("+")) {
        const domain = site.slice(1);
        if (host === domain || host.endsWith(`.${domain}`))
          length = domain.length;
      } else if (site.startsWith("-")) {
        const domain = site.slice(1).split(".").slice(0, -1).join(".");
        if (domain && host.split(".").slice(0, -1).join(".") === domain)
          length = domain.length;
      } else if (host.endsWith(`.${base}`)) length = base.length;
      if (length > bestLength) {
        bestLength = length;
        bestKey = key;
      }
    }
    if (bestKey) return website[bestKey];
    const mapping = { ...(source.stylesMapping?.mapping || {}) };
    for (const [key, targets] of Object.entries(
      source.userStylesMapping?.mapping || {},
    ))
      mapping[key] = [
        ...(Array.isArray(mapping[key]) ? mapping[key] : []),
        ...(Array.isArray(targets) ? targets : []),
      ];
    for (const [key, targets] of Object.entries(mapping)) {
      if (Array.isArray(targets) && targets.includes(host))
        return website[key] || website[`${key}.css`] || null;
    }
    return null;
  }

  async function buildZenCss(host, source) {
    const settings = source?.transparentZenSettings || {};
    if (settings.enableStyling === false) return "";
    const fallback = (source.fallbackBackgroundList || []).includes(host);
    let features = matchZenCssFeatures(host, source);
    const hasStyle = !!features;
    const skipped = (source.skipThemingList || []).includes(host);
    if (hasStyle && !fallback && !!settings.whitelistStyleMode !== skipped)
      features = null;
    if (!hasStyle && !fallback && settings.forceStyling) {
      const forceListed = (source.skipForceThemingList || []).includes(host);
      if (!!settings.whitelistMode === forceListed)
        features = source.styles?.website?.["example.com.css"] || null;
    }
    if (!features && !fallback) return "";
    const storage = await getZenCssStorage();
    const siteKey = `transparentZenSettings.${host}`;
    const siteSettings = (await storage?.get(siteKey))?.[siteKey] || {};
    let css = "";
    for (const [feature, value] of Object.entries(features || {})) {
      if (typeof value !== "string" || siteSettings[feature] === false)
        continue;
      // A locally stored CSS rule can still request remote images or fonts.
      // Keep this bridge fully offline by omitting resource-bearing features.
      if (/@import\b|url\s*\(|(?:-webkit-)?image-set\s*\(/i.test(value))
        continue;
      const name = feature.toLowerCase();
      if (
        name.includes("transparency") &&
        (settings.disableTransparency || fallback)
      )
        continue;
      if (name.includes("hover") && settings.disableHover) continue;
      if (name.includes("footer") && settings.disableFooter) continue;
      if (
        (name.includes("darkreader") ||
          value.toLowerCase().includes("darkreader")) &&
        settings.disableDarkReader
      )
        continue;
      if (
        host === "youtube.com" &&
        name.includes("transparent overlay chat") &&
        siteSettings.movableLiveChat !== false
      )
        continue;
      css += value + "\n";
    }
    if (fallback) css += "html{background-color:light-dark(#fff,#111);}";
    return css;
  }

  function currentZenCssInnerWindowId(browser) {
    try {
      return (
        Number(browser?.browsingContext?.currentWindowGlobal?.innerWindowId) ||
        0
      );
    } catch (_) {
      return 0;
    }
  }

  function cleanZenCssUrl(value) {
    return String(value || "").split("#")[0];
  }

  function disposeZenCssRecord(browser, { clearContent = false } = {}) {
    const record = zenCssBrowsers.get(browser);
    if (!record) return;
    clearTimeout(record.retryTimer);
    if (clearContent) {
      try {
        record.manager.sendAsyncMessage(`${ZEN_CSS_CHANNEL}:probe`, {
          clear: true,
        });
      } catch (_) {}
    }
    try {
      record.manager.removeMessageListener(
        `${ZEN_CSS_CHANNEL}:ready`,
        record.onReady,
      );
    } catch (_) {}
    try {
      record.manager.removeMessageListener(
        `${ZEN_CSS_CHANNEL}:ack`,
        record.onAck,
      );
    } catch (_) {}
    try {
      record.manager.removeDelayedFrameScript(ZEN_CSS_FRAME_URI);
    } catch (_) {}
    zenCssBrowsers.delete(browser);
  }

  function ensureZenCssBridge(browser, { replace = false } = {}) {
    if (!browser?.isConnected) return null;
    let manager;
    try {
      manager = browser.messageManager;
    } catch (_) {
      return null;
    }
    if (!manager?.loadFrameScript || !manager?.sendAsyncMessage) return null;

    let record = zenCssBrowsers.get(browser);
    if (record && (replace || record.manager !== manager)) {
      disposeZenCssRecord(browser, { clearContent: replace });
      record = null;
    }
    if (record) return record;

    record = {
      manager,
      sequence: 0,
      retryTimer: null,
      acknowledged: false,
      ackWindowId: 0,
      expectedCssLength: 0,
      applied: false,
      url: "",
    };

    record.onReady = (message) => {
      if (zenCssBrowsers.get(browser) !== record || !browser.isConnected)
        return;
      const windowId = Number(message.data?.windowId) || 0;
      const url = String(message.data?.url || "");
      if (!windowId || !/^https?:/i.test(url)) return;
      if (currentZenCssInnerWindowId(browser) !== windowId) return;
      // The document tells us when it exists. This is the authoritative
      // trigger; we no longer guess with 600/1800ms first-load timers.
      updateZenCssBrowser(browser, {
        targetUrl: url,
        targetWindowId: windowId,
      });
    };

    record.onAck = (message) => {
      if (
        zenCssBrowsers.get(browser) !== record ||
        message.data?.sequence !== record.sequence ||
        cleanZenCssUrl(message.data?.url) !== cleanZenCssUrl(record.url)
      )
        return;
      const liveWindowId = currentZenCssInnerWindowId(browser);
      const ackWindowId = Number(message.data?.windowId) || 0;
      if (!liveWindowId || !ackWindowId || liveWindowId !== ackWindowId) return;
      if (message.data?.applied !== true) return;
      const expectedLength = Number(message.data?.expectedLength) || 0;
      if (expectedLength !== record.expectedCssLength) return;
      record.ackWindowId = ackWindowId;
      record.applied = true;
      record.acknowledged = true;
      clearTimeout(record.retryTimer);
      record.retryTimer = null;
    };

    manager.addMessageListener(`${ZEN_CSS_CHANNEL}:ready`, record.onReady);
    manager.addMessageListener(`${ZEN_CSS_CHANNEL}:ack`, record.onAck);
    zenCssBrowsers.set(browser, record);
    try {
      // The frame script replaces any older Zentral bridge living in this
      // content process, even one from a previous hot-reloaded mod instance.
      manager.loadFrameScript(ZEN_CSS_FRAME_URI, true, true);
    } catch (error) {
      disposeZenCssRecord(browser);
      console.warn(
        "[BgalazkaExtension] Could not install Zen Internet CSS bridge:",
        error,
      );
      return null;
    }
    return record;
  }

  function sendZenCss(
    browser,
    css,
    url,
    { reset = false, targetWindowId = 0 } = {},
  ) {
    if (!browser?.isConnected || !/^https?:/i.test(url)) return;
    const windowId = targetWindowId || currentZenCssInnerWindowId(browser);
    if (!windowId) return;
    const record = ensureZenCssBridge(browser);
    if (!record) return;
    const sequence = ++record.sequence;
    record.url = url;
    record.acknowledged = false;
    record.ackWindowId = 0;
    record.applied = false;
    record.expectedCssLength = String(css || "").trim().length;
    clearTimeout(record.retryTimer);

    const payload = { css, url, sequence, reset, windowId };
    const deliver = (attempt = 0) => {
      if (
        !browser.isConnected ||
        zenCssBrowsers.get(browser) !== record ||
        record.sequence !== sequence ||
        record.acknowledged ||
        currentZenCssInnerWindowId(browser) !== windowId
      )
        return;
      try {
        record.manager.sendAsyncMessage(`${ZEN_CSS_CHANNEL}:apply`, payload);
      } catch (_) {
        return;
      }
      // Only two short-lived retries for a document that explicitly announced
      // itself. This replaces the old long blind retry ladder and disappears
      // immediately after a verified ACK.
      const delays = [250, 900];
      if (attempt < delays.length)
        record.retryTimer = setTimeout(
          () => deliver(attempt + 1),
          delays[attempt],
        );
    };
    deliver();
  }

  async function updateZenCssBrowser(
    browser,
    { reset = false, targetUrl = null, targetWindowId = 0 } = {},
  ) {
    if (!browser?.isConnected) return;
    const windowId = targetWindowId || currentZenCssInnerWindowId(browser);
    if (!windowId) {
      ensureZenCssBridge(browser);
      return;
    }
    const url = targetUrl || browser.currentURI?.spec || "";
    if (!/^https?:/i.test(url)) return;
    const version = (zenCssUpdateVersions.get(browser) || 0) + 1;
    zenCssUpdateVersions.set(browser, version);
    if (!zenCssEnabled()) {
      sendZenCss(browser, "", url, { reset, targetWindowId: windowId });
      return;
    }
    try {
      const source = await readZenCssSource();
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
      const css = source ? await buildZenCss(host, source) : "";
      if (
        browser.isConnected &&
        currentZenCssInnerWindowId(browser) === windowId &&
        zenCssUpdateVersions.get(browser) === version &&
        zenCssEnabled()
      )
        sendZenCss(browser, css, url, {
          reset,
          targetWindowId: windowId,
        });
    } catch (error) {
      console.warn("[BgalazkaExtension] Zen Internet CSS read failed:", error);
    }
  }

  function zenCssBrowserHealthy(browser) {
    if (!browser?.isConnected) return true;
    const windowId = currentZenCssInnerWindowId(browser);
    if (!windowId) return false;
    const record = zenCssBrowsers.get(browser);
    return !!(
      record &&
      record.manager === browser.messageManager &&
      record.acknowledged &&
      record.applied &&
      record.ackWindowId === windowId
    );
  }

  function requestZenCssDocument(browser, { reset = false } = {}) {
    if (!browser?.isConnected || !zenCssEnabled()) return;
    const record = ensureZenCssBridge(browser, { replace: reset });
    if (!record) return;
    const sendProbe = () => {
      if (!browser.isConnected || zenCssBrowsers.get(browser) !== record)
        return;
      try {
        record.manager.sendAsyncMessage(`${ZEN_CSS_CHANNEL}:probe`, { reset });
      } catch (_) {}
    };
    // loadFrameScript announces on install. Probe once after it has had a
    // chance to register, covering content-process scheduling differences.
    if (!reset) sendProbe();
    else setTimeout(sendProbe, 40);
  }

  function repairZenInternetPanelCss(
    browsers = getAllAppBrowsers(),
    force = false,
  ) {
    if (!zenCssEnabled()) return;
    if (force) zenCssSource = null;
    for (const browser of browsers) {
      if (!browser?.isConnected) continue;
      attachZenInternetPanelBrowser(browser);
      if (force || !zenCssBrowserHealthy(browser))
        requestZenCssDocument(browser, { reset: force });
    }
  }

  function repairVisiblePanelPresentation(forceZenCss = false) {
    const visible = getAllAppBrowsers().filter(
      (browser) => browser?.isConnected && browser.style.display !== "none",
    );
    if (!visible.length) return;
    syncAppPanelBrowserActivity(visible);
    if (forceZenCss) {
      // Treat the button as an explicit FrameLoader/remoteness recovery, not
      // merely a CSS resend. Reinstall every visible browser's bridge on the
      // message manager that exists RIGHT NOW.
      zenCssSource = null;
      for (const browser of visible) {
        attachZenInternetPanelBrowser(browser);
        requestZenCssDocument(browser, { reset: true });
      }
    }
    requestAnimationFrame(() => syncAppPanelBrowserActivity(visible));
    setTimeout(() => {
      const stillVisible = visible.filter(
        (browser) => browser?.isConnected && browser.style.display !== "none",
      );
      syncAppPanelBrowserActivity(stillVisible);
      if (forceZenCss) {
        // If a remoteness swap landed just after the click, the event handler
        // above normally reinstalls the bridge. This one verification pass
        // only handles a transition that raced the button itself.
        for (const browser of stillVisible)
          if (!zenCssBrowserHealthy(browser))
            requestZenCssDocument(browser, { reset: true });
      }
    }, 180);
  }

  // Kept as compatibility wrappers because navigation hooks elsewhere in this
  // extension already call these names. They are now event-driven probes, not
  // multi-second retry schedulers.
  function cancelZenCssFirstLoad(browser) {
    const pending = zenCssFirstLoads.get(browser);
    if (!pending) return;
    for (const timer of pending.timers || []) clearTimeout(timer);
    zenCssFirstLoads.delete(browser);
  }

  function scheduleZenCssFirstLoad(browser) {
    if (!zenCssEnabled() || !browser?.isConnected) return;
    attachZenInternetPanelBrowser(browser);
    requestZenCssDocument(browser);
  }

  function detachZenInternetPanelBrowser(
    browser,
    { clearContent = false } = {},
  ) {
    if (!browser) return;
    cancelZenCssFirstLoad(browser);
    const onRemoteness = browser._bgalazkaZenCssRemotenessHandler;
    if (onRemoteness) {
      try {
        browser.removeEventListener("DidChangeBrowserRemoteness", onRemoteness);
      } catch (_) {}
      delete browser._bgalazkaZenCssRemotenessHandler;
    }
    disposeZenCssRecord(browser, { clearContent });
    delete browser._bgalazkaZenCssOnLoad;
  }

  function attachZenInternetPanelBrowser(browser) {
    if (!browser?.isConnected) return;
    if (!browser._bgalazkaZenCssRemotenessHandler) {
      // Firefox can keep the same <browser> element while replacing its
      // FrameLoader/message-manager endpoint. Delayed frame scripts are not a
      // reliable substitute for explicitly reinstalling our bridge after that
      // remoteness transition. Mozilla's own ContentPage helper does the same.
      const onRemoteness = () => {
        if (!browser.isConnected || !zenCssEnabled()) return;
        // Invalidate any async CSS build that targeted the old WindowGlobal.
        zenCssUpdateVersions.set(
          browser,
          (zenCssUpdateVersions.get(browser) || 0) + 1,
        );
        // Rebuild against the browser's NEW message manager/frame loader.
        // reset=true also clears any stale content-side observer/style state.
        requestZenCssDocument(browser, { reset: true });
      };
      browser._bgalazkaZenCssRemotenessHandler = onRemoteness;
      browser.addEventListener("DidChangeBrowserRemoteness", onRemoteness);
    }
    browser._bgalazkaZenCssOnLoad = true;
    ensureZenCssBridge(browser);
  }

  function refreshZenInternetPanelCss() {
    for (const browser of getAllAppBrowsers()) {
      if (!browser?.isConnected) continue;
      if (!zenCssEnabled()) {
        const record = zenCssBrowsers.get(browser);
        if (record) {
          try {
            record.manager.sendAsyncMessage(`${ZEN_CSS_CHANNEL}:probe`, {
              clear: true,
            });
          } catch (_) {}
        }
        continue;
      }
      attachZenInternetPanelBrowser(browser);
      const windowId = currentZenCssInnerWindowId(browser);
      if (windowId)
        updateZenCssBrowser(browser, {
          targetUrl: browser.currentURI?.spec || "",
          targetWindowId: windowId,
        });
      else requestZenCssDocument(browser);
    }
  }

  function setZenInternetPanelCssEnabled(enabled) {
    if (enabled) {
      zenCssSource = null;
      refreshZenInternetPanelCss();
      return;
    }
    for (const browser of getAllAppBrowsers()) {
      cancelZenCssFirstLoad(browser);
      const record = zenCssBrowsers.get(browser);
      if (record) {
        try {
          record.manager.sendAsyncMessage(`${ZEN_CSS_CHANNEL}:probe`, {
            clear: true,
          });
        } catch (_) {}
      }
      detachZenInternetPanelBrowser(browser);
    }
    if (zenCssChangeTimer) {
      clearTimeout(zenCssChangeTimer);
      zenCssChangeTimer = null;
    }
    if (zenCssBackend) {
      zenCssBackend.removeOnChangedListener(
        ZEN_CSS_EXTENSION_ID,
        zenCssStorageChanged,
      );
      zenCssBackend = null;
    }
    zenCssStorage = null;
    zenCssExtension = null;
    zenCssSource = null;
  }

  registerCleanup(() => {
    if (zenCssChangeTimer) clearTimeout(zenCssChangeTimer);
    for (const browser of getAllAppBrowsers()) {
      cancelZenCssFirstLoad(browser);
      detachZenInternetPanelBrowser(browser, { clearContent: true });
    }
    if (zenCssBackend)
      zenCssBackend.removeOnChangedListener(
        ZEN_CSS_EXTENSION_ID,
        zenCssStorageChanged,
      );
  });
  if (zenCssEnabled()) setTimeout(refreshZenInternetPanelCss, 500);

  // browserDOMWindow is a WrappedNative on some Zen/Gecko builds. Do not add
  // sentinel properties to it: XPConnect rejects writes to WrappedNatives.
  const popupHookedWindows = new WeakSet();
  let popupHookUnsupported = false;

  function hookPopupContainment() {
    const bdw = window.browserDOMWindow;
    if (!bdw) return false;
    if (popupHookUnsupported || popupHookedWindows.has(bdw)) return true;
    const origOpenURI = bdw.openURI;
    if (!origOpenURI) return false;

    const openURIWrapper = function (
      aURI,
      aOpener,
      aWhere,
      aFlags,
      aTriggeringPrincipal,
      aCsp,
    ) {
      try {
        if (aOpener) {
          const matched = getAllAppBrowsers().find(
            (b) => b.browsingContext && b.browsingContext === aOpener,
          );
          if (matched) {
            if (aURI) {
              if (typeof matched.fixupAndLoadURIString === "function") {
                matched.fixupAndLoadURIString(aURI.spec, {
                  triggeringPrincipal: aTriggeringPrincipal,
                });
              } else if (matched.loadURI) {
                matched.loadURI(aURI, {
                  triggeringPrincipal: aTriggeringPrincipal,
                });
              }
            }
            // aURI can be null (e.g. window.open() called with no URL,
            // navigated separately right after) -- either way, handing back
            // our OWN browsingContext instead of creating a new one is what
            // keeps the whole thing contained to the panel.
            return matched.browsingContext;
          }
        }
      } catch (e) {
        console.warn("[BgalazkaExtension] Popup containment failed:", e);
      }
      return origOpenURI.call(
        bdw,
        aURI,
        aOpener,
        aWhere,
        aFlags,
        aTriggeringPrincipal,
        aCsp,
      );
    };
    try {
      bdw.openURI = openURIWrapper;
      if (bdw.openURI !== openURIWrapper)
        throw new Error("browserDOMWindow.openURI did not accept the hook");
    } catch (error) {
      // WrappedNative objects can reject changes to interface methods as well
      // as custom properties. Leave Gecko's popup routing intact and stop the
      // retry timer; repeating this assignment cannot make it writable.
      popupHookUnsupported = true;
      console.warn("[BgalazkaExtension] Popup containment unavailable:", error);
      return true;
    }
    popupHookedWindows.add(bdw);

    registerCleanup(() => {
      try {
        if (popupHookedWindows.has(bdw)) {
          if (bdw.openURI === openURIWrapper) bdw.openURI = origOpenURI;
          popupHookedWindows.delete(bdw);
        }
      } catch (_) {}
    });
    return true;
  }

  if (!safeCall(hookPopupContainment, "hookPopupContainment")) {
    let popupHookAttempts = 0;
    const popupHookTimer = setInterval(() => {
      popupHookAttempts++;
      if (
        safeCall(hookPopupContainment, "hookPopupContainment") ||
        popupHookAttempts > 40
      ) {
        clearInterval(popupHookTimer);
      }
    }, 150);
    registerCleanup(() => clearInterval(popupHookTimer));
  }

  // Audio state belongs to the panel browser, never the underlying essential.
  // Controller events work across remote content; polling also covers older
  // Gecko builds and a controller being replaced by a process switch.
  const panelMediaListeners = new Map();
  const panelAudioSeen = new WeakSet();
  const mediaEvents = [
    "audiblechange",
    "playbackstatechange",
    "activated",
    "deactivated",
  ];
  const AUDIO_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>';
  const MUTED_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/></svg>';

  function panelAudioState(browser) {
    if (!browser) return { playing: false, muted: false, visible: false };
    try {
      const controller = browser.browsingContext?.mediaController;
      const tab = window.gBrowser?.getTabForBrowser?.(browser);
      const playing = !!(
        controller?.isAudible ||
        browser._bgalazkaAudioPlaying ||
        tab?.hasAttribute("soundplaying")
      );
      const muted = !!(
        browser.audioMuted ||
        controller?.isMuted ||
        tab?.hasAttribute("muted")
      );
      if (playing) panelAudioSeen.add(browser);
      // Keep Unmute reachable after muting; never show on a silent fresh page.
      return {
        playing,
        muted,
        visible: playing || (muted && panelAudioSeen.has(browser)),
      };
    } catch (_) {
      return { playing: false, muted: false, visible: false };
    }
  }

  function onAudioStarted(event) {
    event.currentTarget._bgalazkaAudioPlaying = true;
    refreshPanelAudio();
  }
  function onAudioStopped(event) {
    event.currentTarget._bgalazkaAudioPlaying = false;
    refreshPanelAudio();
  }
  function trackPanelMedia(browser) {
    const controller = browser.browsingContext?.mediaController;
    const previous = panelMediaListeners.get(browser);
    if (previous === controller) return;
    if (previous)
      mediaEvents.forEach((type) =>
        previous.removeEventListener(type, refreshPanelAudio),
      );
    panelMediaListeners.delete(browser);
    if (controller) {
      mediaEvents.forEach((type) =>
        controller.addEventListener(type, refreshPanelAudio),
      );
      panelMediaListeners.set(browser, controller);
    }
  }
  function updateAudioButton(button, browser) {
    const state = panelAudioState(browser);
    button.hidden =
      !getPref(BGALAZKA_EXT_PREFS.AUDIO_INDICATOR, false) || !state.visible;
    const muted = state.muted ? "true" : "false";
    if (button.dataset.muted !== muted) {
      button.dataset.muted = muted;
      button.replaceChildren(parseSVG(state.muted ? MUTED_ICON : AUDIO_ICON));
    }
    button.title = state.muted ? "Unmute panel" : "Mute panel";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", muted);
  }
  function togglePanelAudio(browser) {
    if (!browser) return;
    try {
      const muted = panelAudioState(browser).muted;
      const tab = window.gBrowser?.getTabForBrowser?.(browser);
      const method = muted ? "unmute" : "mute";
      // Use native browser/tab APIs when present (Zen versions differ).
      if (typeof tab?.toggleMuteAudio === "function") tab.toggleMuteAudio();
      else if (typeof browser[method] === "function") browser[method]();
      else browser.browsingContext?.mediaController?.[method]?.();
      refreshPanelAudio();
    } catch (error) {
      console.warn("[BgalazkaExtension] Panel mute failed", error);
    }
  }
  function ensureNativeAudioButton() {
    const wrap = document.querySelector(
      "#zen-app-panel-toolbar .zen-toolbar-urlwrap",
    );
    if (!wrap || wrap.querySelector(".bgalazka-audio-button")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "zen-toolbar-btn bgalazka-audio-button";
    button.hidden = true;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePanelAudio(getActiveAppBrowser());
    });
    wrap.appendChild(button);
  }
  function refreshPanelAudio() {
    const browsers = getAllAppBrowsers();
    for (const [browser, controller] of panelMediaListeners) {
      if (browser.isConnected) continue;
      mediaEvents.forEach((type) =>
        controller.removeEventListener(type, refreshPanelAudio),
      );
      panelMediaListeners.delete(browser);
    }
    for (const browser of browsers) trackPanelMedia(browser);
    ensureNativeAudioButton();
    const button = document.querySelector(
      "#zen-app-panel-toolbar .bgalazka-audio-button",
    );
    if (button) updateAudioButton(button, getActiveAppBrowser());
    const byId = new Map(
      browsers.map((browser) => [browser._bgalazkaAppId, browser]),
    );
    const enabled = getPref(BGALAZKA_EXT_PREFS.AUDIO_INDICATOR, false);
    document.querySelectorAll(".zen-app-tile[data-app-id]").forEach((tile) => {
      const state = panelAudioState(byId.get(tile.dataset.appId));
      let indicator = tile.querySelector(".bgalazka-tile-audio");
      if (!enabled || !state.visible) {
        indicator?.remove();
        return;
      }
      if (!indicator) {
        // The tile is already a button: use an indicator span, not nested buttons.
        indicator = document.createElement("span");
        indicator.className = "bgalazka-tile-audio";
        indicator.setAttribute("role", "button");
        indicator.setAttribute("tabindex", "0");
        tile.appendChild(indicator);
      }
      const muted = state.muted ? "true" : "false";
      indicator.title = state.muted ? "Unmute panel" : "Mute panel";
      indicator.setAttribute("aria-label", indicator.title);
      indicator.setAttribute("aria-pressed", muted);
      if (indicator.dataset.muted !== muted) {
        indicator.dataset.muted = muted;
        indicator.replaceChildren(
          parseSVG(state.muted ? MUTED_ICON : AUDIO_ICON),
        );
      }
    });
  }
  const essentialPopupHandler = (event) => {
    const popup = event.target;
    if (popup.id !== "zen-apps-sidebar-tile-context") return;
    const record = essentialPanels.get(popup.dataset.activeAppId);
    if (!record) return; // native handler already restored the normal app menu
    ensurePanelPrivacyMenuItems();
    ensureMobileUaMenuItem();
    const preload = popup.querySelector("#zen-apps-sidebar-preload-item");
    if (preload) {
      preload.hidden = false;
      preload.removeAttribute("hidden");
      if (record.app.preload) preload.setAttribute("checked", "true");
      else preload.removeAttribute("checked");
    }
    for (const id of [
      "zen-apps-sidebar-pin-to-menu",
      "zen-apps-sidebar-remove-item",
      "zen-apps-sidebar-sec2-sep",
      "zen-apps-sidebar-sec3-sep",
    ])
      popup.querySelector(`#${id}`)?.setAttribute("hidden", "true");
  };
  const essentialContextMenu = (event) => {
    const tile = event.target.closest?.(".bgalazka-essential-tile");
    if (!tile || !essentialPanels.has(tile.dataset.appId)) return;
    const popup = document.getElementById("zen-apps-sidebar-tile-context");
    if (!popup) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    popup.dataset.activeAppId = tile.dataset.appId;
    popup.openPopupAtScreen(event.screenX, event.screenY, true);
  };
  const essentialPreloadCommand = (event) => {
    if (event.target.id !== "zen-apps-sidebar-preload-item") return;
    const popup = document.getElementById("zen-apps-sidebar-tile-context");
    const record = essentialPanels.get(popup?.dataset.activeAppId);
    if (!record) return;
    event.stopImmediatePropagation();
    record.app.preload = !record.app.preload;
    record.preloadAttempted = false;
    saveEssentialSettings(record);
    if (record.app.preload) requestTileSync(0);
    if (record.app.preload) event.target.setAttribute("checked", "true");
    else event.target.removeAttribute("checked");
  };
  window.addEventListener("popupshowing", essentialPopupHandler);
  window.addEventListener("command", essentialPreloadCommand, true);
  window.addEventListener("contextmenu", essentialContextMenu, true);
  registerCleanup(() => {
    window.removeEventListener("popupshowing", essentialPopupHandler);
    window.removeEventListener("command", essentialPreloadCommand, true);
    window.removeEventListener("contextmenu", essentialContextMenu, true);
  });
  let panelStatusTimer = null;
  function runPanelFallbackMaintenance() {
    if (document.getElementById("zs-addon-host-inspection"))
      updateAddonHostInspection();
    if (getPref(EXT_PREFS.CORNER_TILES, false)) syncCornerTiles();
    if (getPref(BGALAZKA_EXT_PREFS.AUDIO_INDICATOR, false)) refreshPanelAudio();

    // This entire maintenance pass is optional now. The normal path is
    // event-driven; enable Periodic Fallback Polling only for a Zen build
    // that still revokes docshell activity or leaves CSS/UI state stale.
    if (
      document.documentElement.getAttribute("zentral-app-panel-open") === "true"
    ) {
      const panelBrowsers = getAllAppBrowsers();
      syncAppPanelBrowserActivity(panelBrowsers);
      if (zenCssEnabled()) repairZenInternetPanelCss(panelBrowsers, false);
    }
  }
  function syncPanelFallbackPolling() {
    if (panelStatusTimer) {
      clearInterval(panelStatusTimer);
      panelStatusTimer = null;
    }
    if (!periodicFallbackPollingEnabled() || extensionDisposed) return;
    runPanelFallbackMaintenance();
    panelStatusTimer = setInterval(runPanelFallbackMaintenance, 2000);
  }
  syncPanelFallbackPolling();
  registerCleanup(() => {
    if (panelStatusTimer) clearInterval(panelStatusTimer);
    panelStatusTimer = null;
    for (const controller of panelMediaListeners.values())
      mediaEvents.forEach((type) =>
        controller.removeEventListener(type, refreshPanelAudio),
      );
    panelMediaListeners.clear();
    document
      .querySelectorAll(".bgalazka-audio-button, .bgalazka-tile-audio")
      .forEach((el) => el.remove());
  });

  // Safe method hook on Zentral Apps singleton (eliminates infinite observer loops)
  const hookAppsInstance = () => {
    const apps = window.Zentral?.Apps;
    if (!apps || apps._bgalazkaHooked) return !!apps;
    apps._bgalazkaHooked = true;
    const hookNames = [
      "openPanel",
      "closePanel",
      "getOrCreateAppBrowser",
      "closeApp",
      "removeApp",
      "togglePin",
      "onDrag",
      "refreshApp",
      "saveWidth",
    ];
    const originalMethods = new Map(
      hookNames.map((name) => [name, apps[name]]),
    );
    const navigationListeners = new Map();
    const pruneNavigationListeners = (appId = null) => {
      navigationListeners.forEach(({ onNav, progressListener }, browser) => {
        if (browser.isConnected && (!appId || browser._bgalazkaAppId !== appId))
          return;
        ["load", "pageshow", "DOMTitleChanged"].forEach((type) =>
          browser.removeEventListener(type, onNav),
        );
        try {
          browser.webProgress?.removeProgressListener(progressListener);
        } catch (_) {}
        browser.removeEventListener("DOMAudioPlaybackStarted", onAudioStarted);
        browser.removeEventListener("DOMAudioPlaybackStopped", onAudioStopped);
        navigationListeners.delete(browser);
      });
    };

    const origOpen = apps.openPanel?.bind(apps);
    if (origOpen) {
      apps.openPanel = function (...args) {
        // Native openPanel clears its private pin flag on every switch. Keep
        // a deliberate pin when selecting another normal app from the grid.
        const wasPinned =
          document.querySelector(
            "#zen-app-panel-pill .zen-app-btn[data-pinned='true']",
          ) !== null &&
          document.getElementById("zen-app-panel-root")?.hasAttribute("open") &&
          !document
            .getElementById("zen-app-panel-root")
            ?.hasAttribute("closing");
        const res = origOpen(...args);
        if (zenCssEnabled()) {
          const openedBrowser = getActiveAppBrowser();
          if (openedBrowser) {
            attachZenInternetPanelBrowser(openedBrowser);
            updateZenCssBrowser(openedBrowser);
          }
        }
        ensurePillHoverRevealButton();
        clearHoverHide();
        setHoverPanelHidden(false);
        if (
          wasPinned &&
          document.querySelector(
            "#zen-app-panel-pill .zen-app-btn[data-pinned='false']",
          )
        )
          this.togglePin?.();
        refreshPanelAudio();
        syncAddonHostBrowserActivity();
        syncAppPanelBrowserActivity();
        // A single deferred re-assertion can still lose the race against a
        // cold content-process spawn (new site/container/first launch),
        // which is exactly what left panels gray until manually closed and
        // reopened. requestAnimationFrame lands before the next paint,
        // which is tighter than any setTimeout; stagger a few more after it
        // as a fallback for slower spawns.
        requestAnimationFrame(syncAppPanelBrowserActivity);
        for (const delay of [30, 150, 500, 1500]) {
          setTimeout(syncAppPanelBrowserActivity, delay);
        }
        setTimeout(() => {
          ensurePillDualViewButton();
          ensurePillHoverRevealButton();
          ensurePillAllSidesResizeButton();
          ensureVerticalResizeHandles();
          ensurePillGrabberVerticalDrag();
          syncPanelPushState();
          ensureWebToolbar();
          refreshPanelAudio();
          updateWebToolbarState();
        }, 30);
        return res;
      };
    }

    const origClose = apps.closePanel?.bind(apps);
    if (origClose) {
      apps.closePanel = function (...args) {
        const res = origClose(...args);
        clearHoverHide();
        setHoverPanelHidden(false);
        syncAddonHostBrowserActivity();
        syncAppPanelBrowserActivity();
        setTimeout(syncPanelPushState, 30);
        return res;
      };
    }

    const origTogglePin = apps.togglePin?.bind(apps);
    if (origTogglePin) {
      apps.togglePin = function (...args) {
        const res = origTogglePin(...args);
        setTimeout(syncPanelPushState, 30);
        return res;
      };
    }

    const origOnDrag = apps.onDrag?.bind(apps);
    if (origOnDrag) {
      apps.onDrag = function (...args) {
        const res = origOnDrag(...args);
        syncPanelPushState();
        return res;
      };
    }

    // Applies the Mobile User Agent flag to freshly-created app <browser>s.
    // Only isNew results are touched — an already-connected browser keeps
    // whatever UA it started with (see note above the mobile UA block).
    const origGetOrCreateBrowser = apps.getOrCreateAppBrowser?.bind(apps);
    if (origGetOrCreateBrowser) {
      apps.getOrCreateAppBrowser = function (app) {
        const userContextId = getPanelUserContextId(app?.id);
        const result = callGetOrCreateWithAddonHostBrowser(
          origGetOrCreateBrowser,
          app,
          userContextId,
        );
        // Tag the browser once so launchers, audio, and essential duplicates
        // all resolve the same native panel instance.
        if (result?.browser) {
          result.browser._bgalazkaAppId = app?.id || null;
          applyPanelContainerLoadContext(result.browser, userContextId);
        }
        if (
          result?.browser &&
          getPref(BGALAZKA_EXT_PREFS.ZEN_INTERNET_PANEL_CSS, false)
        )
          attachZenInternetPanelBrowser(result.browser);
        if (result?.browser?._bgalazkaAddonHostBrowser) {
          try {
            if (result.browser.docShellIsActive !== true)
              result.browser.docShellIsActive = true;
          } catch (_) {}
        }
        // BUG FIX: setAttribute("useragent"/"customuseragent", ...) is only
        // ever read by the <browser> element once, at its connectedCallback
        // — which already ran inside origGetOrCreateBrowser's own
        // panel.appendChild(b), i.e. BEFORE this wrapper runs. Setting those
        // attributes afterward is a silent no-op, which is why toggling the
        // checkbox never changed anything sites saw. The live override is
        // browsingContext.customUserAgent — the same dynamic property
        // Firefox's own Responsive Design Mode uses — which DOES apply to
        // the upcoming navigation as long as it's set before the caller's
        // loadURI/fixupAndLoadURIString call that runs right after this
        // getOrCreateAppBrowser() call returns.
        if (result?.isNew && result.browser && isMobileUaApp(app?.id)) {
          try {
            const bc = result.browser.browsingContext;
            if (bc) bc.customUserAgent = MOBILE_UA_STRING;
            else result.browser.customUserAgent = MOBILE_UA_STRING;
          } catch (e) {
            console.warn(
              "[BgalazkaExtension] Failed to apply mobile UA:",
              app?.id,
              e,
            );
          }
        }
        // Keep the toolbar's URL bar / back-forward buttons in sync with
        // real navigations on this browser (full loads at least; SPA
        // history.pushState navigations are covered by the polling
        // fallback in startWebToolbarPolling() above, since those don't
        // reliably fire these events).
        if (result?.browser && !navigationListeners.has(result.browser)) {
          const onNav = () => {
            // A process swap can revoke activation after openPanel's first
            // retries. Reassert promptly on navigation instead of waiting
            // for the periodic status check.
            syncAppPanelBrowserActivity();
            updateWebToolbarState();
          };
          result.browser.addEventListener("load", onNav);
          result.browser.addEventListener("pageshow", onNav);
          result.browser.addEventListener("DOMTitleChanged", onNav);
          result.browser.addEventListener(
            "DOMAudioPlaybackStarted",
            onAudioStarted,
          );
          result.browser.addEventListener(
            "DOMAudioPlaybackStopped",
            onAudioStopped,
          );
          const progressListener = {
            onLocationChange(progress) {
              if (progress && !progress.isTopLevel) return;
              scheduleZenCssFirstLoad(result.browser);
              updateWebToolbarState();
            },
            onStateChange(progress, request, stateFlags) {
              if (progress && !progress.isTopLevel) return;
              if (
                zenCssEnabled() &&
                stateFlags & Ci.nsIWebProgressListener.STATE_STOP &&
                stateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK
              ) {
                cancelZenCssFirstLoad(result.browser);
                scheduleZenCssFirstLoad(result.browser);
              }
              updateWebToolbarState();
            },
            QueryInterface: ChromeUtils.generateQI([
              "nsIWebProgressListener",
              "nsISupportsWeakReference",
            ]),
          };
          try {
            result.browser.webProgress?.addProgressListener(
              progressListener,
              Ci.nsIWebProgress.NOTIFY_LOCATION |
                Ci.nsIWebProgress.NOTIFY_STATE_NETWORK,
            );
          } catch (_) {}
          navigationListeners.set(result.browser, { onNav, progressListener });
        }
        return result;
      };
    }

    // Teardown order matters for real-tab-backed panel browsers: first move
    // the linkedBrowser back to its normal tabbrowser stack and remove the
    // host tab, THEN let base closeApp/removeApp clear its private browser Map.
    // Calling base first would detach the browser before gBrowser can cleanly
    // destroy its owning tab.
    const origRefreshApp = apps.refreshApp?.bind(apps);
    if (origRefreshApp)
      apps.refreshApp = function (id, ...args) {
        if (!essentialPanels.has(id)) return origRefreshApp(id, ...args);
        const browser = getAllAppBrowsers().find(
          (browser) => browser._bgalazkaAppId === id,
        );
        if (browser) browser.reload();
        else loadEssentialInBackground(essentialPanels.get(id));
      };
    const origSaveWidth = apps.saveWidth?.bind(apps);
    if (origSaveWidth)
      apps.saveWidth = function (width) {
        const record = essentialPanels.get(
          getActiveAppBrowser()?._bgalazkaAppId,
        );
        if (record) {
          record.app.width = width;
          saveEssentialSettings(record);
        } else return origSaveWidth(width);
      };
    const origCloseApp = apps.closeApp?.bind(apps);
    if (origCloseApp) {
      apps.closeApp = function (appId, ...args) {
        pruneNavigationListeners(appId);
        removeAddonHostRecord(appId);
        const res = origCloseApp(appId, ...args);
        if (!addonHostByAppId.size) setTimeout(removeEmptyAddonHostFolder, 0);
        return res;
      };
    }

    const origRemoveApp = apps.removeApp?.bind(apps);
    if (origRemoveApp) {
      apps.removeApp = function (appId, ...args) {
        pruneNavigationListeners(appId);
        removeAddonHostRecord(appId);
        const res = origRemoveApp(appId, ...args);
        if (!addonHostByAppId.size) setTimeout(removeEmptyAddonHostFolder, 0);
        return res;
      };
    }

    registerCleanup(() => {
      navigationListeners.forEach(({ onNav, progressListener }, browser) => {
        try {
          browser.webProgress?.removeProgressListener(progressListener);
        } catch (_) {}
        browser.removeEventListener("DOMAudioPlaybackStarted", onAudioStarted);
        browser.removeEventListener("DOMAudioPlaybackStopped", onAudioStopped);
        ["load", "pageshow", "DOMTitleChanged"].forEach((type) =>
          browser.removeEventListener(type, onNav),
        );
      });
      navigationListeners.clear();
      originalMethods.forEach((method, name) => {
        apps[name] = method;
      });
      delete apps._bgalazkaHooked;
    });
    return true;
  };

  if (!safeCall(hookAppsInstance, "hookAppsInstance")) {
    let hookAttempts = 0;
    const hookTimer = setInterval(() => {
      hookAttempts++;
      if (safeCall(hookAppsInstance, "hookAppsInstance") || hookAttempts > 40)
        clearInterval(hookTimer);
    }, 150);
    registerCleanup(() => clearInterval(hookTimer));
  }

  // SessionStore may restore last session's host tabs and Zen folder before
  // this script starts. They do not belong to this window's live bridge.
  function pruneRestoredAddonHosts() {
    const folder =
      findAddonHostFolder() ||
      [...document.querySelectorAll("zen-folder")].find(
        (node) => node.getAttribute("label") === ADDON_HOST_FOLDER_LABEL,
      );
    if (folder) {
      addonHostFolder = folder;
      keepAddonHostFolderCollapsed(folder);
    }
    for (const tab of [...(window.gBrowser?.tabs || [])]) {
      if (addonHostByTab.get(tab)) continue;
      if (
        tab.hasAttribute("bgalazka-addon-host") ||
        tab.hasAttribute("bgalazka-addon-host-fallback") ||
        (folder && tab.group === folder)
      ) {
        try {
          gBrowser.removeTab(tab, {
            animate: false,
            skipPermitUnload: true,
            skipSessionStore: true,
          });
        } catch (error) {
          console.warn("[BgalazkaExtension] Stale host cleanup failed", error);
        }
      }
    }
    if (!addonHostByAppId.size) removeEmptyAddonHostFolder();
  }
  // Session restoration can inject the folder after the first UI sync.
  const restoredHostTimers = [0, 1000, 4000].map((delay) =>
    setTimeout(pruneRestoredAddonHosts, delay),
  );
  registerCleanup(() => restoredHostTimers.forEach(clearTimeout));

  // Hot-reload/startup normalization: if the opt-in bridge was already on
  // and a standalone panel browser predates this extension instance, unload it
  // once so the next open is born as a real-tab-backed browser.
  if (isAddonTabIdBridgeEnabled()) {
    setTimeout(unloadPanelBrowsersForAddonBridge, 0);
  }
  // Add-on-host diagnostics used to have their own permanent 1s timer even
  // while Settings was closed. The existing 2s maintenance tick now refreshes
  // this label when it exists, avoiding an extra window wakeup.

  // A click normally emits mouseup too. Coalesce the pair and skip geometry
  // work entirely when an unrelated click occurs with no visible app panel.
  let panelPushSyncTimer = null;
  const requestPanelPushSync = () => {
    const root = document.getElementById("zen-app-panel-root");
    if (
      !root?.hasAttribute("open") &&
      document.documentElement.getAttribute("bgalazka-panel-pinned") !== "true"
    )
      return;
    if (panelPushSyncTimer) return;
    panelPushSyncTimer = setTimeout(() => {
      panelPushSyncTimer = null;
      syncPanelPushState();
    }, 40);
  };
  window.addEventListener("click", requestPanelPushSync, true);
  window.addEventListener("mouseup", requestPanelPushSync, true);
  window.addEventListener("resize", requestPanelPushSync, { passive: true });
  registerCleanup(() => {
    clearTimeout(panelPushSyncTimer);
    window.removeEventListener("click", requestPanelPushSync, true);
    window.removeEventListener("mouseup", requestPanelPushSync, true);
    window.removeEventListener("resize", requestPanelPushSync);
  });

  // Initial attribute sync on script startup
  // NOTE: bgalazka-pill-position used to be set here as a "top"/"center"/
  // "bottom" attribute for CSS attribute-selectors to key off. Now that pill
  // vertical position is a numeric CSS var (--bgalazka-pill-offset) instead,
  // we just re-run updateCSSVars() here — its very first call happened way
  // up in applyAttributes(), before BGALAZKA_EXT_PREFS existed yet, so
  // EXT_PREFS.PILL_POSITION was still undefined at that point and it wrote a
  // temporary "0%" fallback. This call applies the real saved value.
  //
  // ONE-TIME MIGRATION (pairs with the updateCSSVars() fix above): if this
  // pref still holds a string from the pre-slider "top"/"center"/"bottom"
  // enum, clear it so it goes back to reading as the numeric default (0)
  // everywhere, including the settings-panel slider itself. Without this,
  // updateCSSVars()'s coercion keeps the CSS side safe, but the settings
  // slider (`input.value = getPref(prefKey, defaultVal)` in
  // createSliderRow()) would keep silently discarding the same bad string,
  // showing its own built-in range-input midpoint instead — meaning the UI
  // would look fine (slider sitting at 0%) while never actually being able
  // to fix the real problem until the user nudges it, since nudging is the
  // only thing that writes a fresh, valid integer over the old string. Only
  // ever clears, never writes a value itself, so it can't fight the user's
  // real saved offset if one legitimately exists as a proper number/int.
  try {
    if (
      Services.prefs.prefHasUserValue(BGALAZKA_EXT_PREFS.PILL_POSITION) &&
      Services.prefs.getPrefType(BGALAZKA_EXT_PREFS.PILL_POSITION) ===
        Services.prefs.PREF_STRING
    ) {
      Services.prefs.clearUserPref(BGALAZKA_EXT_PREFS.PILL_POSITION);
    }
  } catch (_) {}
  updateCSSVars();
  try {
    const pillPosObserver = () => updateCSSVars();
    Services.prefs.addObserver(
      BGALAZKA_EXT_PREFS.PILL_POSITION,
      pillPosObserver,
      false,
    );
    // Same observer handles the peek-dot color/opacity prefs too, since all
    // three just need updateCSSVars() re-run to pick up the new CSS var value.
    Services.prefs.addObserver(
      BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
      pillPosObserver,
      false,
    );
    Services.prefs.addObserver(
      BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY,
      pillPosObserver,
      false,
    );
    Services.prefs.addObserver(
      BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY,
      pillPosObserver,
      false,
    );
    registerCleanup(() => {
      try {
        Services.prefs.removeObserver(
          BGALAZKA_EXT_PREFS.PILL_POSITION,
          pillPosObserver,
        );
        Services.prefs.removeObserver(
          BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_COLOR,
          pillPosObserver,
        );
        Services.prefs.removeObserver(
          BGALAZKA_EXT_PREFS.PILL_PEEK_DOT_OPACITY,
          pillPosObserver,
        );
        Services.prefs.removeObserver(
          BGALAZKA_EXT_PREFS.PILL_BACKGROUND_OPACITY,
          pillPosObserver,
        );
      } catch (_) {}
    });
  } catch (_) {}
  // bgalazka-pill-peek-dot: boolean attribute (not a CSS var, since chrome.css
  // needs to pick a whole different rule set for "off", not just tweak a
  // value) controlling whether the pill stays visible as a small "mini
  // pill" (shrunk, colored) while idle, or fully disappears like classic
  // autohide.
  document.documentElement.setAttribute(
    "bgalazka-pill-peek-dot",
    getPref(BGALAZKA_EXT_PREFS.PILL_PEEK_DOT, false) ? "true" : "false",
  );
  try {
    const pillPeekDotObserver = () => {
      document.documentElement.setAttribute(
        "bgalazka-pill-peek-dot",
        getPref(BGALAZKA_EXT_PREFS.PILL_PEEK_DOT, false) ? "true" : "false",
      );
    };
    Services.prefs.addObserver(
      BGALAZKA_EXT_PREFS.PILL_PEEK_DOT,
      pillPeekDotObserver,
      false,
    );
    registerCleanup(() => {
      try {
        Services.prefs.removeObserver(
          BGALAZKA_EXT_PREFS.PILL_PEEK_DOT,
          pillPeekDotObserver,
        );
      } catch (_) {}
    });
  } catch (_) {}
  document.documentElement.setAttribute(
    "bgalazka-hide-dual-view",
    getPref(BGALAZKA_EXT_PREFS.HIDE_DUAL_VIEW, false) ? "true" : "false",
  );
  document.documentElement.setAttribute(
    "bgalazka-push-page",
    getPref(BGALAZKA_EXT_PREFS.PUSH_PAGE, false) ? "true" : "false",
  );

  // Web panel navigation toolbar: initial attribute sync + live observers,
  // same pattern as bgalazka-pill-peek-dot above (createToggleRow's rootAttr
  // only fires on user interaction with the settings UI, not at startup).
  {
    const WEB_TOOLBAR_ATTR_MAP = [
      [BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED, "bgalazka-webtoolbar", false],
      [
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_AUTOHIDE,
        "bgalazka-webtoolbar-autohide",
        false,
      ],
      [
        BGALAZKA_EXT_PREFS.WEB_TOOLBAR_URLBAR,
        "bgalazka-webtoolbar-urlbar",
        false,
      ],
      [BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ZOOM, "bgalazka-webtoolbar-zoom", false],
      [BGALAZKA_EXT_PREFS.WEB_TOOLBAR_TOP, "bgalazka-webtoolbar-top", false],
    ];
    forcePanelBlackState = getPref(BGALAZKA_EXT_PREFS.FORCE_PANEL_BLACK, false);
    applyForcePanelBlackVisual(forcePanelBlackState, null, false);
    try {
      const blackObserver = () => {
        const forced = getPref(BGALAZKA_EXT_PREFS.FORCE_PANEL_BLACK, false);
        forcePanelBlackState = forced;
        const button = document.querySelector(
          "#zen-app-panel-toolbar .bgalazka-panel-black-btn",
        );
        applyForcePanelBlackVisual(forced, button, false);
      };
      Services.prefs.addObserver(
        BGALAZKA_EXT_PREFS.FORCE_PANEL_BLACK,
        blackObserver,
        false,
      );
      registerCleanup(() => {
        try {
          Services.prefs.removeObserver(
            BGALAZKA_EXT_PREFS.FORCE_PANEL_BLACK,
            blackObserver,
          );
        } catch (_) {}
      });
    } catch (_) {}

    WEB_TOOLBAR_ATTR_MAP.forEach(([pref, attr, def]) => {
      document.documentElement.setAttribute(
        attr,
        getPref(pref, def) ? "true" : "false",
      );
      try {
        const observer = () => {
          document.documentElement.setAttribute(
            attr,
            getPref(pref, def) ? "true" : "false",
          );
          if (pref === BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED) {
            ensureWebToolbar();
            startWebToolbarPolling();
          }
        };
        Services.prefs.addObserver(pref, observer, false);
        registerCleanup(() => {
          try {
            Services.prefs.removeObserver(pref, observer);
          } catch (_) {}
        });
      } catch (_) {}
    });
  }

  /* ==========================================================================
   * 5. SETTINGS MODAL DETECTION (NO OBSERVERS — see crash-guard note 4)
   * -----------------------------------------------------------------------
   * Direct hook into ZentralSettings.open avoids subtree MutationObserver
   * violations over tabstrip ancestors during session initialization.
   * ========================================================================== */
  // Native updateAllSubGroupsBadges queried the groups once, then scanned that
  // entire array for EVERY group (quadratic). Bucket direct children once and
  // reuse the native single-group renderer so text, split-view exclusions and
  // dirty checking stay identical. No tabstrip observer or base edit needed.
  const tabGroups = window.Zentral?.TabGroups;
  if (
    tabGroups?.updateAllSubGroupsBadges &&
    tabGroups.updateGroupSubGroupsBadge
  ) {
    const originalUpdateAll = tabGroups.updateAllSubGroupsBadges;
    let updatingBadges = false;
    tabGroups.updateAllSubGroupsBadges = function () {
      if (updatingBadges || extensionDisposed) return;
      updatingBadges = true;
      try {
        const groups = Array.from(
          document.querySelectorAll(
            "tab-group:not([split-view-group]):not([zen-split-view]):not([is-zen-split])",
          ),
        ).filter((group) => !group.classList?.contains("zen-split-view"));
        const children = new Map();
        groups.forEach((group) => {
          const parent = group.parentElement?.closest("tab-group");
          if (!parent) return;
          if (!children.has(parent)) children.set(parent, []);
          children.get(parent).push(group);
        });
        groups.forEach((group) =>
          this.updateGroupSubGroupsBadge(group, children.get(group) || []),
        );
      } finally {
        updatingBadges = false;
      }
    };
    registerCleanup(() => {
      tabGroups.updateAllSubGroupsBadges = originalUpdateAll;
    });
  }

  const patchSettingsInstance = () => {
    const settingsInstance = window.Zentral?.Settings;
    if (!settingsInstance) return false;
    if (settingsInstance._bgalazkaPatched) return true;
    settingsInstance._bgalazkaPatched = true;

    const origOpen = settingsInstance.open?.bind(settingsInstance);
    settingsInstance.open = function (...args) {
      const result = origOpen?.(...args);
      // Optional extension settings must never make the base modal unusable.
      // A single failed row should be reported without aborting other hooks.
      try {
        injectSettingsUI();
      } catch (error) {
        console.error("[BgalazkaExtension] Extension settings failed:", error);
      }
      return result;
    };

    registerCleanup(() => {
      if (origOpen) settingsInstance.open = origOpen;
      settingsInstance._bgalazkaPatched = false;
    });

    return true;
  };

  if (!patchSettingsInstance()) {
    let attempts = 0;
    const retryTimer = setInterval(() => {
      attempts++;
      if (patchSettingsInstance() || attempts > 40) clearInterval(retryTimer);
    }, 150);
    registerCleanup(() => clearInterval(retryTimer));
  }

  // Safe window event hooks that fire strictly AFTER tab operations finish
  const tabPinnedHandler = () => requestTileSync(80);
  const tabUnpinnedHandler = () => requestTileSync(0);
  const workspaceSwitchedHandler = () => requestTileSync(300);
  window.addEventListener("TabPinned", tabPinnedHandler);
  window.addEventListener("TabClose", tabUnpinnedHandler);
  window.addEventListener("TabAttrModified", tabPinnedHandler);
  window.addEventListener("TabUnpinned", tabUnpinnedHandler);
  window.addEventListener("zen-workspace-switched", workspaceSwitchedHandler);
  window.addEventListener("zen-workspace-changed", workspaceSwitchedHandler);
  registerCleanup(() => {
    window.removeEventListener("TabPinned", tabPinnedHandler);
    window.removeEventListener("TabClose", tabUnpinnedHandler);
    window.removeEventListener("TabAttrModified", tabPinnedHandler);
    window.removeEventListener("TabUnpinned", tabUnpinnedHandler);
    window.removeEventListener(
      "zen-workspace-switched",
      workspaceSwitchedHandler,
    );
    window.removeEventListener(
      "zen-workspace-changed",
      workspaceSwitchedHandler,
    );
  });

  // Apply default or stored attribute states on startup
  Object.keys(BGALAZKA_EXT_PREFS).forEach((key) => {
    // Triple push defaults on and is read only while Triple View is active.
    if (key === "TRIPLE_PUSH_PAGE") return;
    const prefName = BGALAZKA_EXT_PREFS[key];
    const rootAttr = "bgalazka-" + key.toLowerCase().replace(/_/g, "-");
    // DEFAULT-OFF CONTRACT: unknown/unset extension booleans are always false.
    // Do not add feature names to a truthy fallback list here.
    const val = getPref(prefName, false);
    if (typeof val === "boolean") {
      document.documentElement.setAttribute(rootAttr, val ? "true" : "false");
    }
  });

  // Initialize
  requestTileSync(150);
  setTimeout(() => requestTileSync(150), 1600);

  // ALL-SIDES RESIZE (note 16): the panel root usually already exists by
  // this point (see patchAppsInstance's own retry comment above), but this
  // covers the case where our IIFE races ahead of it. Also re-triggered
  // from the openPanel hook above for the (normal) case where the panel
  // root doesn't exist until the base mod actually builds it.
  const initAllSidesResizeUi = () => {
    const ok = ensureVerticalResizeHandles();
    ensurePillAllSidesResizeButton();
    // Not actually an all-sides-resize feature (note 25, not 16) -- just
    // reusing this same "root/pill exists yet?" retry loop instead of
    // spinning up a near-identical second setInterval for it.
    ensurePillGrabberVerticalDrag();
    return ok;
  };
  if (!safeCall(initAllSidesResizeUi, "initAllSidesResizeUi")) {
    let vResizeInitAttempts = 0;
    const vResizeInitTimer = setInterval(() => {
      vResizeInitAttempts++;
      if (
        safeCall(initAllSidesResizeUi, "initAllSidesResizeUi") ||
        vResizeInitAttempts > 40
      )
        clearInterval(vResizeInitTimer);
    }, 150);
    registerCleanup(() => clearInterval(vResizeInitTimer));
  }

  /* Secondary views keep the native first panel and its toolbar intact. */
  (() => {
    const apps = window.Zentral?.Apps;
    if (!apps) return;
    const ui = document.documentElement;
    const state = {
      mode: null,
      first: null,
      second: null,
      shell: null,
      divider: null,
      previousPin: null,
      poll: null,
      pollUpdate: null,
      secondToolbarCleanup: null,
      loadTimers: [],
      resizeCleanup: null,
      geometryObserver: null,
      share: 0.5,
      dividerHandle: null,
      handleFrame: null,
      pair: null,
      secondURL: null,
    };
    const slider = () => document.getElementById("zen-app-panel-slider");
    const root = () => document.getElementById("zen-app-panel-root");
    const isOpen = () =>
      root()?.hasAttribute("open") && !root()?.hasAttribute("closing");
    const active = () => {
      const browsers = [...(slider()?.querySelectorAll("browser") || [])];
      const activeIds = [
        ...document.querySelectorAll(
          ".zen-app-tile[data-app-id][data-active='true']",
        ),
      ].map((tile) => tile.dataset.appId);
      const selected = browsers.find(
        (browser) =>
          activeIds.includes(browser._bgalazkaAppId) &&
          browser.style.display !== "none" &&
          !browser.hasAttribute("hidden"),
      );
      return (
        selected ||
        browsers
          .reverse()
          .find(
            (browser) =>
              browser.style.display !== "none" &&
              !browser.hasAttribute("hidden"),
          )
      );
    };
    const origOpen = apps.openPanel;
    const origClose = apps.closePanel;
    const origCloseApp = apps.closeApp;
    const origRemoveApp = apps.removeApp;
    const origRender = apps.renderGrid;
    function savedNormalApps() {
      try {
        const list = JSON.parse(
          getPref("zen.workspace.apps.sidebar.apps", "[]"),
        );
        return Array.isArray(list) ? list : [];
      } catch (_) {
        return [];
      }
    }
    function resolvePairApp(pair, id) {
      const tabRecord = essentialPanels.get(id);
      if (tabRecord?.tab.isConnected) return tabRecord.app;
      const normal = savedNormalApps().find((app) => app.id === id);
      if (normal) return normal;
      // A tab may have closed while this window was shut down. Create its
      // dedicated launcher from the saved metadata without creating a browser.
      const snapshot = pair.apps[id];
      if (!id.startsWith("bgalazka-essential-") || !snapshot?.url) return null;
      const app = { ...snapshot, id, workspaceId: "all" };
      Services.prefs.setStringPref(
        "zen.workspace.apps.sidebar.apps",
        JSON.stringify([...savedNormalApps(), app]),
      );
      apps.loadApps();
      apps.renderGrid();
      return app;
    }
    function rememberPair() {
      const pair = state.pair;
      if (!pair) return;
      pair.share = Math.max(0.05, Math.min(0.95, state.share));
      for (const browser of [state.first, state.second]) {
        const id = browser?._bgalazkaAppId;
        if (!id || !pair.apps[id]) continue;
        const url = browser.currentURI?.spec;
        if (url && url !== "about:blank" && /^(https?|about):/i.test(url))
          pair.apps[id].url = url;
      }
      saveLinkedTriplePairs();
    }
    function linkCurrentPair(firstApp, secondApp) {
      const top = firstApp?.id;
      const bottom = secondApp?.id;
      if (!top || !bottom || top === bottom) return;
      const same = linkedPairFor(top);
      if (same && same === linkedPairFor(bottom)) {
        state.pair = same;
        return;
      }
      unlinkTriplePair(top);
      unlinkTriplePair(bottom);
      const pair = {
        top,
        bottom,
        share: state.share,
        apps: {
          [top]: { ...firstApp, id: top },
          [bottom]: { ...secondApp, id: bottom },
        },
      };
      linkedTriplePairs.push(pair);
      state.pair = pair;
      saveLinkedTriplePairs();
    }
    function enterTriple(first) {
      state.first = first;
      state.mode = "triple";
      const btn = document.getElementById("zen-app-dual-view-btn");
      btn?.setAttribute("data-hold-active", "true");
      ui.setAttribute("bgalazka-triple-view", "true");
      syncPanelPushState();
      refreshViewZenCss(first);
    }
    function refreshViewZenCss(browser) {
      if (!zenCssEnabled() || !browser?.isConnected) return;
      attachZenInternetPanelBrowser(browser);
      updateZenCssBrowser(browser);
    }
    function showPair(pair) {
      const top = resolvePairApp(pair, pair.top);
      const bottom = resolvePairApp(pair, pair.bottom);
      if (!top || !bottom) return false;
      if (state.mode) leaveMode();
      origOpen.call(apps, top);
      const first = active();
      if (!first) return false;
      state.share = Number.isFinite(pair.share) ? pair.share : 0.5;
      enterTriple(first);
      repairSuperPinReturn(first);
      if (!openSecond(bottom, false)) {
        leaveMode();
        return false;
      }
      state.pair = pair;
      return true;
    }
    function swapPair() {
      const pair = state.pair;
      if (!pair || state.mode !== "triple" || !state.second) return;
      rememberPair();
      [pair.top, pair.bottom] = [pair.bottom, pair.top];
      saveLinkedTriplePairs();
      showPair(pair);
    }
    const markTiles = () =>
      document
        .querySelectorAll(".zen-app-tile[data-app-id]")
        .forEach((tile) => {
          if (state.mode && tile.dataset.appId === state.first?._bgalazkaAppId)
            tile.dataset.active = "true";
          if (
            state.second &&
            tile.dataset.appId === state.second._bgalazkaAppId
          )
            tile.dataset.active = "true";
        });
    function fitSecondaryBrowsers() {
      // Keep the live XUL <browser> elements under layout control. Writing
      // width/height attributes or absolute inline sizes can recreate or
      // freeze their remote viewports when a second panel appears.
      if (
        state.mode !== "triple" ||
        !state.second?.isConnected ||
        !state.divider?.isConnected
      )
        return;
      const panel = slider();
      const rect = panel?.getBoundingClientRect();
      if (!rect) return;
      const toolbar = document.getElementById("zen-app-panel-toolbar");
      const usable =
        rect.height -
        (toolbar?.offsetHeight || 0) -
        state.shell.offsetHeight -
        state.divider.offsetHeight -
        panel.clientTop * 2;
      if (usable <= 0) return;
      const min = Math.min(160, usable * 0.25);
      const top = Math.max(min, Math.min(usable - min, usable * state.share));
      panel.style.setProperty("--bgalazka-top-share", `${top}px`);
      panel.style.setProperty("--bgalazka-bottom-share", `${usable - top}px`);
      if (state.handleFrame) cancelAnimationFrame(state.handleFrame);
      state.handleFrame = requestAnimationFrame(() => {
        state.handleFrame = null;
        if (!state.dividerHandle?.isConnected || !state.divider?.isConnected)
          return;
        const line = state.divider.getBoundingClientRect();
        state.dividerHandle.style.left = `${line.left}px`;
        state.dividerHandle.style.top = `${line.top - 3}px`;
        state.dividerHandle.style.width = `${line.width}px`;
        state.dividerHandle.style.height = `${line.height + 6}px`;
      });
    }
    function discardSecond() {
      state.geometryObserver?.disconnect();
      state.geometryObserver = null;
      if (state.handleFrame) cancelAnimationFrame(state.handleFrame);
      state.handleFrame = null;
      state.dividerHandle?.remove();
      state.dividerHandle = null;
      state.loadTimers.forEach(clearTimeout);
      state.loadTimers.length = 0;
      state.resizeCleanup?.();
      state.resizeCleanup = null;
      clearInterval(state.poll);
      state.poll = null;
      state.secondToolbarCleanup?.();
      state.secondToolbarCleanup = null;
      state.pollUpdate = null;
      const second = state.second;
      if (state.mode === "super" && second) {
        // Reparenting a live remote browser can reset its document without
        // removing the element from Zentral's private app-browser Map.
        const liveURL = second.currentURI?.spec;
        const lastURL =
          liveURL && liveURL !== "about:blank" ? liveURL : state.secondURL;
        if (lastURL && lastURL !== "about:blank")
          second._bgalazkaSuperPinReturnURL = lastURL;
      }
      if (second?.isConnected && slider()) {
        if (second.parentNode !== slider()) slider().appendChild(second);
        second.style.display = "none";
      }
      if (second?._bgalazkaAppId)
        document
          .querySelectorAll(".zen-app-tile[data-app-id]")
          .forEach((tile) => {
            if (tile.dataset.appId === second._bgalazkaAppId)
              tile.dataset.active = "false";
          });
      state.second = null;
      state.secondURL = null;
      state.divider?.remove();
      state.divider = null;
      ui.removeAttribute("bgalazka-triple-populated");
      // Do not wait for the toolbar's SPA fallback poll to hide the repair
      // control when Triple View loses its second panel.
      updateWebToolbarState();
      state.shell?.remove();
      state.shell = null;
      slider()?.style.removeProperty("--bgalazka-top-share");
      slider()?.style.removeProperty("--bgalazka-bottom-share");
      state.first?.removeAttribute("data-bgalazka-triple-slot");
      second?.removeAttribute("data-bgalazka-triple-slot");
    }
    function leaveMode() {
      if (!state.mode) return;
      const mode = state.mode;
      if (mode === "triple") rememberPair();
      discardSecond();
      state.mode = null;
      state.first = null;
      state.pair = null;
      ui.removeAttribute("bgalazka-triple-view");
      ui.removeAttribute("bgalazka-super-pin");
      document
        .getElementById("zen-app-dual-view-btn")
        ?.removeAttribute("data-hold-active");
      document
        .querySelector("#zen-app-panel-pill .zen-app-btn[data-pinned]")
        ?.removeAttribute("data-hold-active");
      if (mode === "triple") syncPanelPushState();
      if (mode === "super" && state.previousPin === false && isOpen()) {
        const pin = document.querySelector(
          "#zen-app-panel-pill .zen-app-btn[data-pinned]",
        );
        if (pin?.getAttribute("data-pinned") === "true") apps.togglePin();
      }
      state.previousPin = null;
    }
    function leaveAndUnlinkTriple() {
      if (state.mode === "triple" && state.pair) {
        unlinkTriplePair(state.pair.top);
        state.pair = null;
      }
      leaveMode();
    }
    function navigate(browser, value) {
      try {
        const target = looksLikeUrl(value)
          ? /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
            ? value
            : "https://" + value
          : buildSearchUrl(value);
        const uri = Services.io.newURI(target);
        const options = {
          triggeringPrincipal:
            Services.scriptSecurityManager.createContentPrincipal(uri, {
              userContextId: Number(browser.getAttribute("usercontextid")) || 0,
            }),
        };
        if (typeof browser.fixupAndLoadURIString === "function")
          browser.fixupAndLoadURIString(target, options);
        else browser.loadURI(uri, options);
      } catch (error) {
        console.warn("[BgalazkaExtension] Secondary navigation failed", error);
      }
    }
    function repairSuperPinReturn(browser) {
      const url = browser?._bgalazkaSuperPinReturnURL;
      if (!url) return;
      // The reset can happen a paint or two after reparenting. Check only
      // while this panel is visible; leave the marker for a later open if it
      // was hidden before the remote frame finished reconnecting.
      for (const delay of [0, 80, 300, 1000, 2500]) {
        setTimeout(() => {
          if (
            !browser.isConnected ||
            browser._bgalazkaSuperPinReturnURL !== url
          )
            return;
          if (!isOpen() || browser.style.display === "none") return;
          const current = browser.currentURI?.spec;
          if (
            current === "about:blank" &&
            !browser.webProgress?.isLoadingDocument
          )
            navigate(browser, url);
          if (delay === 2500 && browser.currentURI?.spec !== "about:blank")
            delete browser._bgalazkaSuperPinReturnURL;
        }, delay);
      }
    }
    function makeShell(browser, app) {
      // SuperPin needs a native XUL container for its remote browser to
      // receive resize and input events. Triple-View only uses the bar.
      const box =
        state.mode === "super"
          ? document.createXULElement("vbox")
          : document.createElement("div");
      box.id = "bgalazka-super-panel";
      const bar = document.createElement("div");
      bar.className = "bgalazka-super-bar";
      const button = (label, title, action) => {
        const el = document.createElement("button");
        el.type = "button";
        el.textContent = label;
        el.title = title;
        el.setAttribute("aria-label", title);
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          action();
        });
        bar.appendChild(el);
        return el;
      };
      const iconButton = (icon, title, action) => {
        const el = button("", title, action);
        el.appendChild(parseSVG(icon));
        return el;
      };
      iconButton(PREF_ICONS.BACK, "Back", () =>
        navigatePanelHistory(browser, -1),
      );
      iconButton(PREF_ICONS.RELOAD, "Reload", () => browser.reload());
      iconButton(PREF_ICONS.FORWARD, "Forward", () =>
        navigatePanelHistory(browser, 1),
      );
      const grip = document.createElement("div");
      grip.className = "bgalazka-second-grip";
      grip.title = "Drag to move second panel";
      grip.appendChild(parseSVG(PREF_ICONS.DRAG_HANDLE));
      const url = document.createElement("input");
      url.type = "text";
      url.className = "bgalazka-second-url";
      url.placeholder = app.url || "URL or search";
      url.spellcheck = false;
      url.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter" && url.value.trim()) {
          navigate(browser, url.value.trim());
          url.blur();
        } else if (event.key === "Escape") url.blur();
      });
      bar.append(grip, url);
      iconButton(PREF_ICONS.ZOOM_OUT, "Zoom out", () => zoom(-0.1));
      const zoomText = button("100%", "Reset zoom", () => zoom(0));
      zoomText.classList.add("bgalazka-second-zoom-label");
      iconButton(PREF_ICONS.ZOOM_IN, "Zoom in", () => zoom(0.1));
      if (state.mode === "triple")
        button("⇅", "Swap top and bottom panels", swapPair).classList.add(
          "bgalazka-second-swap",
        );
      button(
        "×",
        state.mode === "triple" ? "Unlink panels" : "Close second panel",
        () => {
          if (state.mode === "triple") leaveAndUnlinkTriple();
          else discardSecond();
        },
      ).classList.add("bgalazka-second-close");
      function zoom(step) {
        try {
          const current = ZoomManager.getZoomForBrowser(browser);
          const next = step ? Math.max(0.3, Math.min(3, current + step)) : 1;
          ZoomManager.setZoomForBrowser(browser, next);
          zoomText.textContent = Math.round(next * 100) + "%";
        } catch (_) {}
      }
      box.appendChild(bar);
      if (state.mode === "super") box.appendChild(browser);
      browser.style.display = "";
      if (state.mode === "triple") {
        const divider = document.createElement("div");
        divider.className = "bgalazka-triple-divider";
        divider.title = "Drag to balance panel heights";
        divider.setAttribute("role", "separator");
        divider.setAttribute("aria-orientation", "horizontal");
        // CSS order places the bars around the divider. Neither loaded XUL
        // browser is moved; moving a live browser can restart its document.
        slider().append(divider, box);
        state.first.setAttribute("data-bgalazka-triple-slot", "top");
        browser.setAttribute("data-bgalazka-triple-slot", "bottom");
        ui.setAttribute("bgalazka-triple-populated", "true");
        // Make the primary toolbar's Triple View controls appear immediately;
        // the 1s poll is only a navigation fallback, not a UI lifecycle hook.
        updateWebToolbarState();
        const balance = (clientY) => {
          const panel = slider();
          const rect = panel.getBoundingClientRect();
          const toolbarHeight =
            document.getElementById("zen-app-panel-toolbar")?.offsetHeight || 0;
          const usable =
            rect.height -
            toolbarHeight -
            bar.offsetHeight -
            divider.offsetHeight;
          if (usable <= 0) return;
          const min = Math.min(160, usable * 0.25);
          const pixels = Math.max(
            min,
            Math.min(
              usable - min,
              clientY - rect.top - toolbarHeight - panel.clientTop,
            ),
          );
          state.share = pixels / usable;
          fitSecondaryBrowsers();
        };
        state.divider = divider;
        const handle = document.createElement("div");
        handle.className = "bgalazka-triple-drag-handle";
        handle.title = divider.title;
        (document.body || document.documentElement).appendChild(handle);
        state.dividerHandle = handle;
        state.geometryObserver = new ResizeObserver(fitSecondaryBrowsers);
        state.geometryObserver.observe(slider());
        state.geometryObserver.observe(bar);
        const toolbar = document.getElementById("zen-app-panel-toolbar");
        if (toolbar) state.geometryObserver.observe(toolbar);
        requestAnimationFrame(fitSecondaryBrowsers);
        let shield = null;
        let grabOffset = 0;
        let pointerId = null;
        let captureTarget = null;
        const endResize = (event) => {
          if (event?.pointerId != null && event.pointerId !== pointerId) return;
          document.removeEventListener("pointermove", moveResize, true);
          document.removeEventListener("pointerup", endResize, true);
          document.removeEventListener("pointercancel", endResize, true);
          window.removeEventListener("blur", endResize);
          const target = captureTarget;
          const id = pointerId;
          captureTarget = null;
          pointerId = null;
          if (target && id != null && target.hasPointerCapture?.(id))
            target.releasePointerCapture(id);
          shield?.remove();
          shield = null;
          if (state.pair && state.second) rememberPair();
        };
        const moveResize = (event) => {
          if (shield && event.pointerId === pointerId)
            balance(event.clientY - grabOffset);
        };
        const startResize = (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          endResize();
          grabOffset = event.clientY - divider.getBoundingClientRect().top;
          pointerId = event.pointerId;
          captureTarget = event.currentTarget;
          shield = document.createElement("div");
          shield.className = "bgalazka-triple-drag-shield";
          (document.body || document.documentElement).appendChild(shield);
          // Keep pointer events routed to the handle even when the cursor
          // crosses into the lower remote browser viewport.
          try {
            captureTarget.setPointerCapture(pointerId);
          } catch (_) {}
          document.addEventListener("pointermove", moveResize, true);
          document.addEventListener("pointerup", endResize, true);
          document.addEventListener("pointercancel", endResize, true);
          window.addEventListener("blur", endResize);
        };
        handle.addEventListener("pointerdown", startResize);
        divider.addEventListener("pointerdown", startResize);
        state.resizeCleanup = endResize;
      } else {
        (document.body || document.documentElement).appendChild(box);
        const first = root().getBoundingClientRect();
        const width = Math.min(
          Math.max(270, Math.round(first.width * 0.75)),
          window.innerWidth - 24,
        );
        const height = Math.min(
          Math.max(220, Math.round(first.height * 0.68)),
          window.innerHeight - 24,
        );
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
        box.style.left = `${Math.max(
          12,
          Math.min(
            window.innerWidth - width - 12,
            first.left < window.innerWidth / 2
              ? first.right + 12
              : first.left - width - 12,
          ),
        )}px`;
        box.style.top = `${Math.max(12, Math.min(window.innerHeight - height - 12, first.top))}px`;
        // Eight edge/corner surfaces resize the secondary independently.
        for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
          const handle = document.createElement("div");
          handle.className = `bgalazka-second-resize bgalazka-resize-${edge}`;
          handle.title = "Drag to resize second panel";
          box.appendChild(handle);
          let start = null;
          handle.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = box.getBoundingClientRect();
            start = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            };
            handle.setPointerCapture(event.pointerId);
          });
          handle.addEventListener("pointermove", (event) => {
            if (!start || event.pointerId !== start.id) return;
            let left = start.left,
              top = start.top;
            let width = start.width,
              height = start.height;
            const dx = event.clientX - start.x,
              dy = event.clientY - start.y;
            if (edge.includes("e")) width += dx;
            if (edge.includes("w")) {
              left += dx;
              width -= dx;
            }
            if (edge.includes("s")) height += dy;
            if (edge.includes("n")) {
              top += dy;
              height -= dy;
            }
            width = Math.max(
              250,
              Math.min(width, window.innerWidth - Math.max(0, left)),
            );
            height = Math.max(
              180,
              Math.min(height, window.innerHeight - Math.max(0, top)),
            );
            if (edge.includes("w")) left = start.left + start.width - width;
            if (edge.includes("n")) top = start.top + start.height - height;
            box.style.left = `${Math.max(0, left)}px`;
            box.style.top = `${Math.max(0, top)}px`;
            box.style.width = `${width}px`;
            box.style.height = `${height}px`;
          });
          const doneResize = () => {
            start = null;
          };
          handle.addEventListener("pointerup", doneResize);
          handle.addEventListener("pointercancel", doneResize);
          handle.addEventListener("lostpointercapture", doneResize);
        }
        let drag = null;
        grip.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const rect = box.getBoundingClientRect();
          drag = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: rect.left,
            top: rect.top,
          };
          grip.setPointerCapture(event.pointerId);
        });
        grip.addEventListener("pointermove", (event) => {
          if (!drag || event.pointerId !== drag.id) return;
          box.style.left = `${Math.max(
            0,
            Math.min(
              window.innerWidth - box.getBoundingClientRect().width,
              drag.left + event.clientX - drag.x,
            ),
          )}px`;
          box.style.top = `${Math.max(
            0,
            Math.min(
              window.innerHeight - box.getBoundingClientRect().height,
              drag.top + event.clientY - drag.y,
            ),
          )}px`;
        });
        const done = () => {
          drag = null;
        };
        grip.addEventListener("pointerup", done);
        grip.addEventListener("pointercancel", done);
        grip.addEventListener("lostpointercapture", done);
      }
      state.shell = box;
      const refreshSecondaryToolbar = () => {
        if (state.second !== browser || !box.isConnected) return;
        const liveURL = browser.currentURI?.spec;
        if (liveURL && liveURL !== "about:blank") state.secondURL = liveURL;
        if (document.activeElement !== url)
          url.value =
            browser.currentURI?.spec === "about:blank"
              ? app.url
              : browser.currentURI?.spec || app.url || "";
        try {
          zoomText.textContent = `${Math.round(ZoomManager.getZoomForBrowser(browser) * 100)}%`;
        } catch (_) {}
      };
      state.pollUpdate = refreshSecondaryToolbar;
      const secondaryEvents = ["load", "pageshow", "DOMTitleChanged"];
      secondaryEvents.forEach((type) =>
        browser.addEventListener(type, refreshSecondaryToolbar),
      );
      const secondaryProgress = {
        onLocationChange(progress) {
          if (progress && !progress.isTopLevel) return;
          refreshSecondaryToolbar();
        },
        QueryInterface: ChromeUtils.generateQI([
          "nsIWebProgressListener",
          "nsISupportsWeakReference",
        ]),
      };
      try {
        browser.webProgress?.addProgressListener(
          secondaryProgress,
          Ci.nsIWebProgress.NOTIFY_LOCATION,
        );
      } catch (_) {}
      state.secondToolbarCleanup = () => {
        secondaryEvents.forEach((type) =>
          browser.removeEventListener(type, refreshSecondaryToolbar),
        );
        try {
          browser.webProgress?.removeProgressListener(secondaryProgress);
        } catch (_) {}
      };
      refreshSecondaryToolbar();
      syncSecondaryFallbackPolling();
    }
    syncSecondaryFallbackPolling = () => {
      if (state.poll) {
        clearInterval(state.poll);
        state.poll = null;
      }
      state.pollUpdate?.();
      if (
        !periodicFallbackPollingEnabled() ||
        !state.second?.isConnected ||
        !state.pollUpdate
      )
        return;
      state.poll = setInterval(() => state.pollUpdate?.(), 1000);
    };

    function openSecond(app, createLink = true) {
      if (!app?.id || !isOpen() || !state.first?.isConnected) return false;
      if (app.id === state.first._bgalazkaAppId) return true;
      if (app.id === state.second?._bgalazkaAppId) return true;
      const { browser, isNew } = apps.getOrCreateAppBrowser(app) || {};
      if (!browser) return false;
      discardSecond();
      state.second = browser;
      state.secondURL = app.url;
      makeShell(browser, app); // attach before navigating a remote browser
      refreshViewZenCss(state.first);
      refreshViewZenCss(browser);
      // Superpin reparents the remote browser; the document can restart
      // after the move without delivering another load event to the wrapper.
      for (const delay of [400, 1600]) {
        state.loadTimers.push(
          setTimeout(() => {
            if (state.mode && state.first?.isConnected)
              refreshViewZenCss(state.first);
            if (state.second === browser && browser.isConnected)
              refreshViewZenCss(browser);
          }, delay),
        );
      }
      try {
        browser.docShellIsActive = true;
      } catch (_) {}
      if (
        isNew ||
        (browser.currentURI?.spec === "about:blank" &&
          !browser.webProgress?.isLoadingDocument)
      )
        navigate(browser, browser._bgalazkaSuperPinReturnURL || app.url);
      repairSuperPinReturn(browser);
      state.loadTimers.push(
        setTimeout(() => {
          if (
            state.second === browser &&
            browser.isConnected &&
            browser.currentURI?.spec === "about:blank" &&
            !browser.webProgress?.isLoadingDocument
          )
            navigate(browser, browser._bgalazkaSuperPinReturnURL || app.url);
        }, 2500),
      );
      // Remote content may reset activity while its process starts. The
      // existing guarded sync only writes when Gecko actually changed it.
      requestAnimationFrame(syncAppPanelBrowserActivity);
      for (const delay of [50, 250, 1000]) {
        state.loadTimers.push(setTimeout(syncAppPanelBrowserActivity, delay));
      }
      if (state.mode === "triple" && createLink) {
        const firstId = state.first?._bgalazkaAppId;
        const firstApp =
          essentialPanels.get(firstId)?.app ||
          savedNormalApps().find((item) => item.id === firstId);
        linkCurrentPair(firstApp, app);
      }
      markTiles();
      return true;
    }
    apps.openPanel = function (app) {
      const pair = app?.id && linkedPairFor(app.id);
      if (pair) {
        if (
          state.mode === "triple" &&
          state.pair === pair &&
          state.second?.isConnected &&
          isOpen()
        ) {
          // The primary tile's native toggle closes directly; the secondary
          // tile arrives here instead, so give both icons the same behavior.
          this.closePanel();
          return;
        }
        if (showPair(pair)) return;
      }
      if (
        state.pair &&
        app?.id !== state.first?._bgalazkaAppId &&
        app?.id !== state.second?._bgalazkaAppId
      )
        leaveMode();
      if (
        state.mode &&
        state.first?.isConnected &&
        isOpen() &&
        app?.id !== state.first._bgalazkaAppId
      ) {
        if (openSecond(app)) return;
      }
      if (state.mode) leaveMode();
      const result = origOpen.call(this, app);
      repairSuperPinReturn(
        [...(slider()?.querySelectorAll("browser") || [])].find(
          (browser) => browser._bgalazkaAppId === app?.id,
        ),
      );
      return result;
    };
    apps.closePanel = function (...args) {
      leaveMode();
      return origClose.apply(this, args);
    };
    apps.closeApp = function (id, ...args) {
      if (state.first?._bgalazkaAppId === id) leaveMode();
      else if (state.second?._bgalazkaAppId === id) discardSecond();
      return origCloseApp.call(this, id, ...args);
    };
    apps.removeApp = function (id, ...args) {
      unlinkTriplePair(id);
      if (state.pair && (state.pair.top === id || state.pair.bottom === id)) {
        state.pair = null;
        leaveMode();
      }
      return origRemoveApp.call(this, id, ...args);
    };
    apps.renderGrid = function (...args) {
      const result = origRender.apply(this, args);
      markTiles();
      return result;
    };
    const HOLD_MS = 550;
    let pending = null;
    let suppress = null;
    const targetButton = (node) =>
      node?.closest?.(
        "#zen-app-dual-view-btn, #zen-app-panel-pill .zen-app-btn[data-pinned]",
      );
    const onDown = (event) => {
      if (event.button !== 0 || !isOpen()) return;
      const btn = targetButton(event.target);
      if (!btn) return;
      const kind = btn.id === "zen-app-dual-view-btn" ? "triple" : "super";
      pending = {
        btn,
        x: event.clientX,
        y: event.clientY,
        timer: setTimeout(() => {
          pending = null;
          const first = active();
          if (!first || !isOpen()) return;
          suppress = btn;
          if (state.mode === kind) {
            if (kind === "triple") leaveAndUnlinkTriple();
            else leaveMode();
            return;
          }
          leaveMode();
          if (kind === "triple") state.share = 0.5;
          state.first = first;
          state.mode = kind;
          if (kind === "triple") {
            enterTriple(first);
          } else {
            state.previousPin = btn.getAttribute("data-pinned") === "true";
            if (!state.previousPin) apps.togglePin();
            ui.setAttribute("bgalazka-super-pin", "true");
            refreshViewZenCss(first);
          }
          btn.setAttribute("data-hold-active", "true");
          markTiles();
        }, HOLD_MS),
      };
    };
    const cancelPending = () => {
      if (pending) clearTimeout(pending.timer);
      pending = null;
    };
    const onMove = (event) => {
      if (
        pending &&
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8
      )
        cancelPending();
    };
    const onClick = (event) => {
      const btn = targetButton(event.target);
      if (!btn) return;
      if (suppress === btn) {
        suppress = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (
        (btn.id === "zen-app-dual-view-btn" && state.mode === "triple") ||
        (btn.id !== "zen-app-dual-view-btn" && state.mode === "super")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (btn.id === "zen-app-dual-view-btn") leaveAndUnlinkTriple();
        else leaveMode();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", cancelPending, true);
    window.addEventListener("pointercancel", cancelPending, true);
    window.addEventListener("blur", cancelPending);
    window.addEventListener("click", onClick, true);
    registerCleanup(() => {
      cancelPending();
      leaveMode();
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", cancelPending, true);
      window.removeEventListener("pointercancel", cancelPending, true);
      window.removeEventListener("blur", cancelPending);
      window.removeEventListener("click", onClick, true);
      apps.openPanel = origOpen;
      apps.closePanel = origClose;
      apps.closeApp = origCloseApp;
      apps.removeApp = origRemoveApp;
      apps.renderGrid = origRender;
    });
  })();

  /* ==========================================================================
   * 6. CLEANUP / UNLOAD
   * ========================================================================== */
  const performBgalazkaUnload = () => {
    if (extensionDisposed) return;
    extensionDisposed = true;
    // Later wrappers wrap earlier wrappers. Unwind in reverse order so a
    // restored outer wrapper cannot leave a stale inner extension installed.
    cleanupFns
      .splice(0)
      .reverse()
      .forEach((fn) => {
        try {
          fn();
        } catch (_) {}
      });
    window.BgalazkaExtensionInitialized = false;
  };
  if (typeof window.addUnloadListener === "function") {
    window.addUnloadListener(performBgalazkaUnload);
  } else if (typeof UC_API !== "undefined" && UC_API.addUnloadListener) {
    UC_API.addUnloadListener(performBgalazkaUnload);
  }
  window.addEventListener("unload", performBgalazkaUnload, { once: true });
})();
