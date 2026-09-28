(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime;
  // Panel integration owns the ordered interaction points between panel features.
  ZentralRuntime.register({
    id: "panels",
    init() {
      const ctx = {};
      ZentralRuntime.panelContext = ctx;
      Object.defineProperties(ctx, {
        BGALAZKA_EXT_PREFS: {
          configurable: true,
          get: () => BGALAZKA_EXT_PREFS,
        },
        EXT_KEYBIND_ACTIONS: {
          configurable: true,
          get: () => EXT_KEYBIND_ACTIONS,
        },
        EXT_KEYBIND_DEFAULTS: {
          configurable: true,
          get: () => EXT_KEYBIND_DEFAULTS,
        },
        EXT_PREFS: { configurable: true, get: () => EXT_PREFS },
        PREF_ICONS: { configurable: true, get: () => PREF_ICONS },
        PROFILE_DEFAULTS: { configurable: true, get: () => PROFILE_DEFAULTS },
        applyAttributes: { configurable: true, get: () => applyAttributes },
        cleanupFns: { configurable: true, get: () => cleanupFns },
        clearInterval: { configurable: true, get: () => clearInterval },
        clearTimeout: { configurable: true, get: () => clearTimeout },
        computeOppositeDockingSafeMaxWidth: {
          configurable: true,
          get: () => computeOppositeDockingSafeMaxWidth,
        },
        ensureNativeAudioButton: {
          configurable: true,
          get: () => ensureNativeAudioButton,
        },
        ensurePillAllSidesResizeButton: {
          configurable: true,
          get: () => ensurePillAllSidesResizeButton,
        },
        extendHoverResizeHold: {
          configurable: true,
          get: () => extendHoverResizeHold,
        },
        extensionDisposed: {
          configurable: true,
          get: () => extensionDisposed,
          set: (value) => {
            extensionDisposed = value;
          },
        },
        getPref: { configurable: true, get: () => getPref },
        keybindFromEvent: { configurable: true, get: () => keybindFromEvent },
        parseSVG: { configurable: true, get: () => parseSVG },
        performBgalazkaUnload: {
          configurable: true,
          get: () => performBgalazkaUnload,
        },
        refreshPanelAudio: { configurable: true, get: () => refreshPanelAudio },
        registerCleanup: { configurable: true, get: () => registerCleanup },
        restartBrowser: { configurable: true, get: () => restartBrowser },
        safeCall: { configurable: true, get: () => safeCall },
        setInterval: { configurable: true, get: () => setInterval },
        setPref: { configurable: true, get: () => setPref },
        setTimeout: { configurable: true, get: () => setTimeout },
        syncHoverPanelAvailability: {
          configurable: true,
          get: () => syncHoverPanelAvailability,
        },
        syncPanelFallbackPolling: {
          configurable: true,
          get: () => syncPanelFallbackPolling,
        },
        syncPanelPushState: {
          configurable: true,
          get: () => syncPanelPushState,
        },
        togglePanelAudio: { configurable: true, get: () => togglePanelAudio },
        updateCSSVars: { configurable: true, get: () => updateCSSVars },
      });
      ZentralRuntime.prepareParts(ctx);

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
        SHOW_TRIPLE_STYLE_REPAIR:
          "zen.workspace.bgalazka.show_triple_style_repair",
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
        KEYBIND_TOGGLE_DUAL_VIEW:
          "zen.workspace.bgalazka.keybind.toggle_dual_view",
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
            if (typeof fallback === "number")
              return Services.prefs.getIntPref(key);
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
          if (typeof value === "boolean")
            Services.prefs.setBoolPref(key, value);
          if (typeof value === "number") Services.prefs.setIntPref(key, value);
          // BUG FIX: string prefs previously matched neither `if`, so this was a
          // silent no-op — the dropdown/UI looked like it saved (it updated the
          // live DOM attribute on "change") but nothing ever reached
          // Services.prefs, so the value reset to default on every restart.
          if (typeof value === "string")
            Services.prefs.setStringPref(key, value);
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

      window.ZentralRuntime.runPart("geometry");

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
          return origIsPanelAttachedToRight
            ? origIsPanelAttachedToRight()
            : false;
        };

        // Fix the off-screen ~1920px calculation bug when docked opposite (note 7).
        const origPositionPanel =
          appsInstance.positionPanel?.bind(appsInstance);
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
              ctx.applyVerticalResizeExtras(root);
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
          const navbar = document.getElementById(
            "zen-appcontent-navbar-wrapper",
          );
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
            document.documentElement.getAttribute("bgalazka-push-page") ===
              "true"
          )
            ctx.applyVerticalResizeExtras(root);
          if (root.getAttribute("data-panel-side") !== side)
            root.setAttribute("data-panel-side", side);
          if (sideChanged) ctx.applyHorizontalPanelOffset(root);
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
          ctx.applyVerticalResizeExtras(openedRoot);
          ctx.applyHorizontalPanelOffset(openedRoot);

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
        let rescuedAppsPref;
        let rescuedAppsCount = 0;
        appsInstance.renderGrid = function () {
          // Keep standalone apps renderable with Hide Unattached Controls enabled.
          // The renderer publishes whether this workspace has tiles; CSS collapses
          // the empty area. Promoted tab panels must also survive the native cap.
          const raw = getPref("zen.workspace.apps.sidebar.apps", "[]");
          if (raw !== rescuedAppsPref) {
            rescuedAppsPref = raw;
            rescuedAppsCount = 0;
            try {
              const saved = JSON.parse(raw);
              if (
                Array.isArray(saved) &&
                saved.some((app) => app?.id?.startsWith("bgalazka-essential-"))
              ) {
                rescuedAppsCount = saved.length;
              }
            } catch (_) {}
          }
          const core = window.Zentral?.Core;
          const get = core?.getPref;
          const overrideCap = rescuedAppsCount > 0 && typeof get === "function";
          try {
            if (overrideCap)
              core.getPref = function (key, ...args) {
                if (key !== "zen.workspace.apps.sidebar.max_apps")
                  return get.call(this, key, ...args);
                return Math.max(
                  Number(get.call(this, key, ...args)) || 0,
                  rescuedAppsCount,
                );
              };
            if (origRenderGrid) origRenderGrid();
          } finally {
            if (overrideCap) core.getPref = get;
          }
          ctx.requestTileSync(60);
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
          if (
            currentWidth > safeMax &&
            typeof this.updateWidthVar === "function"
          )
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
                document.documentElement.getAttribute(
                  "bgalazka-triple-view",
                ) === "true") &&
              document
                .getElementById("zen-app-panel-root")
                ?.hasAttribute("open");
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

      window.ZentralRuntime.runPart("corner-panels");

      /* ==========================================================================
       * 4. SETTINGS UI INJECTION (DOM-SAFE XHTML BUILDER)
       * ========================================================================== */
      const BGALAZKA_EXT_PREFS = {
        FORCE_PANEL_BLACK: "zen.workspace.bgalazka.force_panel_black",
        PANEL_BLACK_OPACITY: "zen.workspace.bgalazka.panel_black_opacity",
        PANEL_BLACK_STEPS: "zen.workspace.bgalazka.panel_black_steps",
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
        PILL_BACKGROUND_OPACITY:
          "zen.workspace.bgalazka.pill_background_opacity",
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
        WEB_TOOLBAR_QUICKSWITCH:
          "zen.workspace.bgalazka.web_toolbar_quickswitch",
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
        PANEL_HORIZONTAL_OFFSET: ctx.PANEL_HORIZONTAL_OFFSET_PREF,
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
        SHOW_TRIPLE_STYLE_REPAIR:
          "zen.workspace.bgalazka.show_triple_style_repair",
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
        KEYBIND_TOGGLE_DUAL_VIEW:
          "zen.workspace.bgalazka.keybind.toggle_dual_view",
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
            if (canGoBack === false && !ctx.canPanelNavigate(browser, -1))
              return;
            ctx.navigatePanelHistory(browser, -1);
          } else if (button === 4) {
            const canGoForward =
              typeof browser.canGoForward === "boolean"
                ? browser.canGoForward
                : browser.webNavigation?.canGoForward;
            if (canGoForward === false && !ctx.canPanelNavigate(browser, 1))
              return;
            ctx.navigatePanelHistory(browser, 1);
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
        if (
          !available ||
          !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false)
        ) {
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
          Math.max(
            400,
            hoverHoldUntil - Date.now(),
            hoverTypingUntil - Date.now(),
          ),
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
                document.documentElement.getAttribute(
                  "bgalazka-triple-view",
                ) !== "true"
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
          if (!root?.matches(":hover") && !hoverPanelHasFocus())
            onHoverRootLeave();
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
          ctx.getActiveAppBrowser()?._bgalazkaAppId !== tile.dataset.appId
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
          !document
            .getElementById("zen-app-panel-root")
            ?.hasAttribute("open") ||
          document.documentElement.hasAttribute(
            "bgalazka-hover-panel-hidden",
          ) ||
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
        if (!hoverOpenPopups.delete(event.target) || hoverOpenPopups.size)
          return;
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
        document.removeEventListener(
          "mousedown",
          onActiveLauncherMouseDown,
          true,
        );
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
        document.documentElement.removeAttribute(
          "bgalazka-hover-panel-enabled",
        );
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
              if (
                Math.max(Math.abs(dx), Math.abs(dy)) <= BUTTON_DRAG_DEADZONE_PX
              )
                return;
              dragStarted = true;
              btn._bgalazkaDragWasRouted = true;
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);

              // Preserve the ORIGINAL mousedown coordinates for both axes so the
              // panel catches up smoothly after crossing the click-vs-drag guard.
              ctx.startPanelHorizontalPositionDrag(moveEvt, startX);
              ctx.startPanelPositionDrag(moveEvt, startY);
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

            ctx.ensureVerticalResizeHandles();
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
        ctx.applyVerticalResizeExtras(root);
        if (!ctx.hResizeState && !ctx.hPosDragState && !ctx.vPosDragState)
          ctx.applyHorizontalPanelOffset(root);
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
          document.documentElement.getAttribute("bgalazka-triple-view") ===
          "true";
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
        const isOpen =
          root?.hasAttribute("open") && !root?.hasAttribute("closing");
        const triple =
          document.documentElement.getAttribute("bgalazka-triple-view") ===
          "true";
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
        const effectivePinned =
          isOpen && (isPinned || dualViewActive || triple);

        // Re-evaluate all user panel offsets whenever Dual-View changes. Both
        // helpers suppress their axis-specific margins only while Dual-View is on
        // and automatically restore the saved values when it turns off.
        ctx.applyVerticalResizeExtras(root);
        // The drag handler owns the margin until mouseup. Reapplying the saved
        // value from a native resize callback can alternate two X positions.
        if (!ctx.hResizeState) ctx.applyHorizontalPanelOffset(root);
        const side =
          root?.getAttribute("data-panel-side") ||
          (window.Zentral?.Apps?.isPanelAttachedToRight?.() ? "right" : "left");
        const width =
          root?.getBoundingClientRect()?.width ||
          parseInt(root?.style?.width, 10) ||
          350;

        const docRoot = document.documentElement;
        const widthValue = `${Math.round(width)}px`;
        if (
          docRoot.style.getPropertyValue("--bgalazka-panel-width") !==
          widthValue
        )
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

      window.ZentralRuntime.runPart("panel-toolbar");

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
        {
          key: "TOGGLE_EXPAND",
          pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_EXPAND,
        },
        {
          key: "TOGGLE_DUAL_VIEW",
          pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_DUAL_VIEW,
        },
        {
          key: "TOGGLE_RESIZE",
          pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_RESIZE,
        },
        {
          key: "TOGGLE_TOOLBAR",
          pref: BGALAZKA_EXT_PREFS.KEYBIND_TOGGLE_TOOLBAR,
        },
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
        {
          key: "OPEN_SETTINGS",
          pref: BGALAZKA_EXT_PREFS.KEYBIND_OPEN_SETTINGS,
        },
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
        if (!raw || ["Control", "Shift", "Alt", "Meta"].includes(raw))
          return "";
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
          document.documentElement.setAttribute(
            rootAttr,
            next ? "true" : "false",
          );
        }
        return next;
      }

      function stepActivePanelZoom(delta) {
        const browser = ctx.getActiveAppBrowser?.() || getVisiblePanelBrowser();
        if (!browser) return false;
        try {
          const cur = ZoomManager.getZoomForBrowser(browser);
          const next =
            delta === 0 ? 1 : Math.max(0.3, Math.min(3, cur + delta));
          ZoomManager.setZoomForBrowser(browser, next);
          ctx.updateWebToolbarState?.();
          return true;
        } catch (_) {
          return false;
        }
      }

      function runExtensionKeybindAction(actionKey) {
        const apps = window.Zentral?.Apps;
        const browser = ctx.getActiveAppBrowser?.() || getVisiblePanelBrowser();
        switch (actionKey) {
          case "CLOSE_PANEL":
            apps?.closePanel?.();
            return true;
          case "BACK":
            if (!browser) return false;
            try {
              ctx.navigatePanelHistory(browser, -1);
              return true;
            } catch (_) {
              return false;
            }
          case "FORWARD":
            if (!browser) return false;
            try {
              ctx.navigatePanelHistory(browser, 1);
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
            ctx.ensureWebToolbar();
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
            if (enabled) ctx.ensureWebToolbar();
            ctx.updateWebToolbarState();
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
            ctx.applyVerticalResizeExtras(
              document.getElementById("zen-app-panel-root"),
            );
            ctx.applyHorizontalPanelOffset(
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
          const configured = String(
            getPref(pref, EXT_KEYBIND_DEFAULTS[key]) || "",
          );
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

      window.ZentralRuntime.runPart("extension-settings");

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

      window.ZentralRuntime.runPart("browser-integrations");

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

      window.ZentralRuntime.runPart("panel-styles");

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
              const matched = ctx
                .getAllAppBrowsers()
                .find(
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
          console.warn(
            "[BgalazkaExtension] Popup containment unavailable:",
            error,
          );
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
          button.replaceChildren(
            parseSVG(state.muted ? MUTED_ICON : AUDIO_ICON),
          );
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
          togglePanelAudio(ctx.getActiveAppBrowser());
        });
        wrap.appendChild(button);
      }
      function refreshPanelAudio() {
        const browsers = ctx.getAllAppBrowsers();
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
        if (button) updateAudioButton(button, ctx.getActiveAppBrowser());
        const byId = new Map(
          browsers.map((browser) => [browser._bgalazkaAppId, browser]),
        );
        const enabled = getPref(BGALAZKA_EXT_PREFS.AUDIO_INDICATOR, false);
        document
          .querySelectorAll(".zen-app-tile[data-app-id]")
          .forEach((tile) => {
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
        const record = ctx.essentialPanels.get(popup.dataset.activeAppId);
        if (!record) return; // native handler already restored the normal app menu
        ctx.ensurePanelPrivacyMenuItems();
        ctx.ensureMobileUaMenuItem();
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
        if (!tile || !ctx.essentialPanels.has(tile.dataset.appId)) return;
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
        const record = ctx.essentialPanels.get(popup?.dataset.activeAppId);
        if (!record) return;
        event.stopImmediatePropagation();
        record.app.preload = !record.app.preload;
        record.preloadAttempted = false;
        ctx.saveEssentialSettings(record);
        if (record.app.preload) ctx.requestTileSync(0);
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
          ctx.updateAddonHostInspection();
        if (getPref(EXT_PREFS.CORNER_TILES, false)) ctx.syncCornerTiles();
        if (getPref(BGALAZKA_EXT_PREFS.AUDIO_INDICATOR, false))
          refreshPanelAudio();

        // This entire maintenance pass is optional now. The normal path is
        // event-driven; enable Periodic Fallback Polling only for a Zen build
        // that still revokes docshell activity or leaves CSS/UI state stale.
        if (
          document.documentElement.getAttribute("zentral-app-panel-open") ===
          "true"
        ) {
          const panelBrowsers = ctx.getAllAppBrowsers();
          ctx.syncAppPanelBrowserActivity(panelBrowsers);
          if (ctx.zenCssEnabled())
            ctx.repairZenInternetPanelCss(panelBrowsers, false);
        }
      }
      function syncPanelFallbackPolling() {
        if (panelStatusTimer) {
          clearInterval(panelStatusTimer);
          panelStatusTimer = null;
        }
        if (!ctx.periodicFallbackPollingEnabled() || extensionDisposed) return;
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
          navigationListeners.forEach(
            ({ onNav, progressListener }, browser) => {
              if (
                browser.isConnected &&
                (!appId || browser._bgalazkaAppId !== appId)
              )
                return;
              ["load", "pageshow", "DOMTitleChanged"].forEach((type) =>
                browser.removeEventListener(type, onNav),
              );
              try {
                browser.webProgress?.removeProgressListener(progressListener);
              } catch (_) {}
              browser.removeEventListener(
                "DOMAudioPlaybackStarted",
                onAudioStarted,
              );
              browser.removeEventListener(
                "DOMAudioPlaybackStopped",
                onAudioStopped,
              );
              navigationListeners.delete(browser);
            },
          );
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
              document
                .getElementById("zen-app-panel-root")
                ?.hasAttribute("open") &&
              !document
                .getElementById("zen-app-panel-root")
                ?.hasAttribute("closing");
            const res = origOpen(...args);
            if (ctx.zenCssEnabled()) {
              const openedBrowser = ctx.getActiveAppBrowser();
              if (openedBrowser) {
                ctx.attachZenInternetPanelBrowser(openedBrowser);
                ctx.updateZenCssBrowser(openedBrowser);
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
            ctx.syncAddonHostBrowserActivity();
            ctx.syncAppPanelBrowserActivity();
            // A single deferred re-assertion can still lose the race against a
            // cold content-process spawn (new site/container/first launch),
            // which is exactly what left panels gray until manually closed and
            // reopened. requestAnimationFrame lands before the next paint,
            // which is tighter than any setTimeout; stagger a few more after it
            // as a fallback for slower spawns.
            requestAnimationFrame(ctx.syncAppPanelBrowserActivity);
            for (const delay of [30, 150, 500, 1500]) {
              setTimeout(ctx.syncAppPanelBrowserActivity, delay);
            }
            setTimeout(() => {
              ensurePillDualViewButton();
              ensurePillHoverRevealButton();
              ensurePillAllSidesResizeButton();
              ctx.ensureVerticalResizeHandles();
              ctx.ensurePillGrabberVerticalDrag();
              syncPanelPushState();
              ctx.ensureWebToolbar();
              refreshPanelAudio();
              ctx.updateWebToolbarState();
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
            ctx.syncAddonHostBrowserActivity();
            ctx.syncAppPanelBrowserActivity();
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
            const userContextId = ctx.getPanelUserContextId(app?.id);
            const result = ctx.callGetOrCreateWithAddonHostBrowser(
              origGetOrCreateBrowser,
              app,
              userContextId,
            );
            // Tag the browser once so launchers, audio, and essential duplicates
            // all resolve the same native panel instance.
            if (result?.browser) {
              result.browser._bgalazkaAppId = app?.id || null;
              ctx.applyPanelContainerLoadContext(result.browser, userContextId);
            }
            if (
              result?.browser &&
              getPref(BGALAZKA_EXT_PREFS.ZEN_INTERNET_PANEL_CSS, false)
            )
              ctx.attachZenInternetPanelBrowser(result.browser);
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
            if (result?.isNew && result.browser && ctx.isMobileUaApp(app?.id)) {
              try {
                const bc = result.browser.browsingContext;
                if (bc) bc.customUserAgent = ctx.MOBILE_UA_STRING;
                else result.browser.customUserAgent = ctx.MOBILE_UA_STRING;
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
                ctx.syncAppPanelBrowserActivity();
                ctx.updateWebToolbarState();
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
                  ctx.scheduleZenCssFirstLoad(result.browser);
                  ctx.updateWebToolbarState();
                },
                onStateChange(progress, request, stateFlags) {
                  if (progress && !progress.isTopLevel) return;
                  if (
                    ctx.zenCssEnabled() &&
                    stateFlags & Ci.nsIWebProgressListener.STATE_STOP &&
                    stateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK
                  ) {
                    ctx.cancelZenCssFirstLoad(result.browser);
                    ctx.scheduleZenCssFirstLoad(result.browser);
                  }
                  ctx.updateWebToolbarState();
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
              navigationListeners.set(result.browser, {
                onNav,
                progressListener,
              });
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
            if (!ctx.essentialPanels.has(id))
              return origRefreshApp(id, ...args);
            const browser = ctx
              .getAllAppBrowsers()
              .find((browser) => browser._bgalazkaAppId === id);
            if (browser) browser.reload();
            else ctx.loadEssentialInBackground(ctx.essentialPanels.get(id));
          };
        const origSaveWidth = apps.saveWidth?.bind(apps);
        if (origSaveWidth)
          apps.saveWidth = function (width) {
            const record = ctx.essentialPanels.get(
              ctx.getActiveAppBrowser()?._bgalazkaAppId,
            );
            if (record) {
              record.app.width = width;
              ctx.saveEssentialSettings(record);
            } else return origSaveWidth(width);
          };
        const origCloseApp = apps.closeApp?.bind(apps);
        if (origCloseApp) {
          apps.closeApp = function (appId, ...args) {
            pruneNavigationListeners(appId);
            ctx.removeAddonHostRecord(appId);
            const res = origCloseApp(appId, ...args);
            if (!ctx.addonHostByAppId.size)
              setTimeout(ctx.removeEmptyAddonHostFolder, 0);
            return res;
          };
        }

        const origRemoveApp = apps.removeApp?.bind(apps);
        if (origRemoveApp) {
          apps.removeApp = function (appId, ...args) {
            pruneNavigationListeners(appId);
            ctx.removeAddonHostRecord(appId);
            const res = origRemoveApp(appId, ...args);
            if (!ctx.addonHostByAppId.size)
              setTimeout(ctx.removeEmptyAddonHostFolder, 0);
            return res;
          };
        }

        registerCleanup(() => {
          navigationListeners.forEach(
            ({ onNav, progressListener }, browser) => {
              try {
                browser.webProgress?.removeProgressListener(progressListener);
              } catch (_) {}
              browser.removeEventListener(
                "DOMAudioPlaybackStarted",
                onAudioStarted,
              );
              browser.removeEventListener(
                "DOMAudioPlaybackStopped",
                onAudioStopped,
              );
              ["load", "pageshow", "DOMTitleChanged"].forEach((type) =>
                browser.removeEventListener(type, onNav),
              );
            },
          );
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
          if (
            safeCall(hookAppsInstance, "hookAppsInstance") ||
            hookAttempts > 40
          )
            clearInterval(hookTimer);
        }, 150);
        registerCleanup(() => clearInterval(hookTimer));
      }

      // SessionStore may restore last session's host tabs and Zen folder before
      // this script starts. They do not belong to this window's live bridge.
      function pruneRestoredAddonHosts() {
        const folder =
          ctx.findAddonHostFolder() ||
          [...document.querySelectorAll("zen-folder")].find(
            (node) =>
              node.getAttribute("label") === ctx.ADDON_HOST_FOLDER_LABEL,
          );
        if (folder) {
          ctx.addonHostFolder = folder;
          ctx.keepAddonHostFolderCollapsed(folder);
        }
        for (const tab of [...(window.gBrowser?.tabs || [])]) {
          if (ctx.addonHostByTab.get(tab)) continue;
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
              console.warn(
                "[BgalazkaExtension] Stale host cleanup failed",
                error,
              );
            }
          }
        }
        if (!ctx.addonHostByAppId.size) ctx.removeEmptyAddonHostFolder();
      }
      // Session restoration can inject the folder after the first UI sync.
      const restoredHostTimers = [0, 1000, 4000].map((delay) =>
        setTimeout(pruneRestoredAddonHosts, delay),
      );
      registerCleanup(() => restoredHostTimers.forEach(clearTimeout));

      // Hot-reload/startup normalization: if the opt-in bridge was already on
      // and a standalone panel browser predates this extension instance, unload it
      // once so the next open is born as a real-tab-backed browser.
      if (ctx.isAddonTabIdBridgeEnabled()) {
        setTimeout(ctx.unloadPanelBrowsersForAddonBridge, 0);
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
          document.documentElement.getAttribute("bgalazka-panel-pinned") !==
            "true"
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
      window.addEventListener("resize", requestPanelPushSync, {
        passive: true,
      });
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
          [
            BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED,
            "bgalazka-webtoolbar",
            false,
          ],
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
          [
            BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ZOOM,
            "bgalazka-webtoolbar-zoom",
            false,
          ],
          [
            BGALAZKA_EXT_PREFS.WEB_TOOLBAR_TOP,
            "bgalazka-webtoolbar-top",
            false,
          ],
        ];
        // Migrate the old boolean once; the integer preference owns the state now.
        const opacityPref = BGALAZKA_EXT_PREFS.PANEL_BLACK_OPACITY;
        if (
          !Services.prefs.prefHasUserValue(opacityPref) &&
          getPref(BGALAZKA_EXT_PREFS.FORCE_PANEL_BLACK, false)
        )
          setPref(opacityPref, 100);
        ctx.applyForcePanelBlackVisual(getPref(opacityPref, 0), null, false);
        try {
          const blackObserver = () => {
            const opacity = getPref(opacityPref, 0);
            const button = document.querySelector(
              "#zen-app-panel-toolbar .bgalazka-panel-black-btn",
            );
            ctx.applyForcePanelBlackVisual(opacity, button, false);
          };
          Services.prefs.addObserver(opacityPref, blackObserver, false);
          registerCleanup(() => {
            try {
              Services.prefs.removeObserver(opacityPref, blackObserver);
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
                ctx.ensureWebToolbar();
                ctx.startWebToolbarPolling();
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
            ctx.injectSettingsUI();
          } catch (error) {
            console.error(
              "[BgalazkaExtension] Extension settings failed:",
              error,
            );
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
          if (patchSettingsInstance() || attempts > 40)
            clearInterval(retryTimer);
        }, 150);
        registerCleanup(() => clearInterval(retryTimer));
      }

      // Safe window event hooks that fire strictly AFTER tab operations finish
      const tabPinnedHandler = () => ctx.requestTileSync(80);
      const tabUnpinnedHandler = () => ctx.requestTileSync(0);
      const workspaceSwitchedHandler = () => ctx.requestTileSync(300);
      window.addEventListener("TabPinned", tabPinnedHandler);
      window.addEventListener("TabClose", tabUnpinnedHandler);
      window.addEventListener("TabAttrModified", tabPinnedHandler);
      window.addEventListener("TabUnpinned", tabUnpinnedHandler);
      window.addEventListener(
        "zen-workspace-switched",
        workspaceSwitchedHandler,
      );
      window.addEventListener(
        "zen-workspace-changed",
        workspaceSwitchedHandler,
      );
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
          document.documentElement.setAttribute(
            rootAttr,
            val ? "true" : "false",
          );
        }
      });

      // Initialize
      ctx.requestTileSync(150);
      setTimeout(() => ctx.requestTileSync(150), 1600);

      // ALL-SIDES RESIZE (note 16): the panel root usually already exists by
      // this point (see patchAppsInstance's own retry comment above), but this
      // covers the case where our IIFE races ahead of it. Also re-triggered
      // from the openPanel hook above for the (normal) case where the panel
      // root doesn't exist until the base mod actually builds it.
      const initAllSidesResizeUi = () => {
        const ok = ctx.ensureVerticalResizeHandles();
        ensurePillAllSidesResizeButton();
        // Not actually an all-sides-resize feature (note 25, not 16) -- just
        // reusing this same "root/pill exists yet?" retry loop instead of
        // spinning up a near-identical second setInterval for it.
        ctx.ensurePillGrabberVerticalDrag();
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

      window.ZentralRuntime.runPart("secondary-views");

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

      return () => performBgalazkaUnload();
    },
  });
})();
