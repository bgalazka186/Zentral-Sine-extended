/*
 * ZENTRAL FILE GUIDE - extension/panels/interaction/ZentralPanelHover.js
 *
 * Purpose: Owns extended panel hover reveal/hide, pinned offscreen geometry, edge/pill reveal controls and
 *   hover/resize holds.
 * Interaction / execution: Constructed by ZentralPanels with live ctx, geometry scheduling and
 *   push/fallback synchronization callbacks. Calls BrowserIntegrations activity policy before
 *   showing/hiding loaded panel content.
 * Ownership / failure: Registers timers/listeners/control cleanup with ctx. Hidden pages retain
 *   notification policy; hover reveal restores rendering/input. Keep the native compact sidebar reveal
 *   bezel unobstructed.
 * Registration: panels/ZentralPanelHover
 * Loaded/created by: extension/panels/ZentralPanels.uc.js
 * Returned factory API: clearHoverHide; ensureAutohidePanelPinned; ensurePillHoverRevealButton;
 *   extendHoverResizeHold; onHoverRootLeave; setHoverPanelHidden; syncHoverPanelAvailability;
 *   updateHiddenPanelGeometry; updateRevealEdgeGeometry
 * Shared ctx symbols used: cancelPanelRetry; getActiveAppBrowser; requestPanelActivity;
 *   syncAppPanelBrowserActivity
 * Cross-file calls / ctx suppliers: extension/panels/browsers/ZentralBrowserIntegrations.uc.js -> ctx.syncAppPanelBrowserActivity;
 *   extension/panels/navigation/ZentralPanelToolbar.uc.js -> ctx.getActiveAppBrowser
 * Literal DOM event subscriptions: blur; click; contextmenu; focusin; focusout; keydown; mousedown;
 *   mouseup; pointercancel; pointerdown; pointerenter; pointerleave; pointermove; pointerout; pointerover;
 *   pointerup; popuphidden; popupshowing; resize; zentral-notes-request-reveal (document; Notes asks for an
 *   autohidden panel to come back before it docks its sheet inside it). The pill autohide recognizer uses only
 *   pointerdown/move/up/cancel plus click, with a real movement threshold.
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "panels/ZentralPanelHover",
    function ({
      BGALAZKA_EXT_PREFS,
      PREF_ICONS,
      Services,
      ZentralRuntime,
      clearTimeout,
      ctx,
      getPref,
      parseSVG,
      registerCleanup,
      schedulePanelModeGeometrySync,
      setPref,
      setTimeout,
      syncPanelFallbackPolling,
      syncPanelPushState,
      togglePanelPushPreference,
    }) {
      let hoverBoundRoot = null;
      let hoverHideTimer = null;
      let panelEntryHeld = false;
      let hoverRevealFrame = null;
      let hoverRevealTimer = null;
      let hoverRevealSurface = null;
      let hoverRevealLedgeBounds = null;
      const HIDDEN_PANEL_REVEAL_DEFAULT_MS = 160;
      const HIDDEN_PANEL_REVEAL_DEFAULT_WIDTH_PX = 1;
      // OW-130 / 3.4.1: a short pointer-up hides once, even when the saved
      // autohide preference is off; a completed 550 ms hold toggles that
      // preference. Pointer jitter inside this radius does not cancel either
      // gesture. The existing Triple/Super-pin long press is untouched.
      const PILL_AUTOHIDE_HOLD_MS = 550;
      const PILL_AUTOHIDE_MOVE_TOLERANCE_PX = 8;
      const PILL_AUTOHIDE_SELECTOR = "#zen-app-hover-reveal-btn";
      const PILL_AUTOHIDE_HIDDEN_ONCE_ATTR = "bgalazka-hover-panel-hidden-once";
      const hoverPanelHiddenOnce = () =>
        document.documentElement.hasAttribute(PILL_AUTOHIDE_HIDDEN_ONCE_ATTR);
      let hoverResizing = false;
      let hoverHoldUntil = 0;
      let hoverTypingUntil = 0;
      const hoverOpenPopups = new Set();
      let hoverContextPending = false;
      let hoverContextTimer = null;
      const hoverRevealId = "bgalazka-panel-reveal-edge";
      const panelOutsidePref =
        "zen.workspace.zentral.compatibility.panel_outside_window_tracking";
      const panelHoverPushWidthPref =
        "zen.workspace.zentral.panels.hover_push_width_px";
      const panelEdgeRevealPref =
        "zen.workspace.zentral.panels.hover_edge_reveal";
      const panelOutsideDistancePref =
        "zen.workspace.zentral.panels.outside_distance_px";
      const panelOutsideMarginPref =
        "zen.workspace.zentral.panels.outside_trigger_margin_px";
      const panelOutsideFullEdgePref =
        "zen.workspace.zentral.panels.outside_full_edge";
      const panelHideDelayPref =
        "zen.workspace.zentral.panels.autohide_delay_ms";
      const boundedPanelPref = (key, fallback, min, max) => {
        const value = getPref(key, fallback);
        return typeof value === "number" && Number.isFinite(value)
          ? Math.max(min, Math.min(max, Math.round(value)))
          : fallback;
      };
      let panelOutsideHeld = false;
      let panelOutsidePending = null;
      let panelOutsideService = null;
      let panelOutsideOwned = false;
      let panelOutsideGeneration = 0;
      let panelPointerOutside = false;
      function releasePanelOutsideTracking() {
        panelOutsideGeneration++;
        if (panelOutsidePending != null) clearTimeout(panelOutsidePending);
        panelOutsidePending = null;
        panelOutsideHeld = false;
        // Zen may have taken over the per-window tracker after our registration.
        // Never unregister a session currently owned by the compact-mode manager.
        if (
          panelOutsideOwned &&
          !window.gZenCompactModeManager?._outsideTrackedElement
        ) {
          try {
            panelOutsideService?.unregisterWindow(window);
          } catch (_) {}
        }
        panelOutsideOwned = false;
        panelOutsideService = null;
      }
      function onPanelOutsideWindowLeave(event) {
        if (event.target !== document.documentElement) return;
        panelPointerOutside = true;
        releasePanelOutsideTracking();
        const root = document.getElementById("zen-app-panel-root");
        if (
          !getPref(panelOutsidePref, false) ||
          !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) ||
          !root?.hasAttribute("open") ||
          root.hasAttribute("closing") ||
          hoverResizing ||
          hoverMenuVisible()
        )
          return;
        const side =
          root.getAttribute("data-panel-side") ||
          (window.Zentral?.Apps?.isPanelAttachedToRight?.() ? "right" : "left");
        const windowBox = document.documentElement.getBoundingClientRect();
        const panelBox = root.getBoundingClientRect();
        // Only exiting through the panel's docked left/right window edge counts.
        if (
          Math.abs(event.clientX - windowBox[side]) >
            boundedPanelPref(panelOutsideMarginPref, 10, 1, 64) ||
          (!getPref(panelOutsideFullEdgePref, true) &&
            (event.clientY < panelBox.top || event.clientY > panelBox.bottom))
        )
          return;
        clearHoverHide();
        // This trigger is independent of the internal hover ledge/delay.
        // An already open, autohidden panel is revealed on the window-edge exit.
        setHoverPanelHidden(false);
        const generation = panelOutsideGeneration;
        // Give Zen's delayed native leave handler first choice of the tracker.
        panelOutsidePending = setTimeout(
          () => {
            panelOutsidePending = null;
            if (
              generation !== panelOutsideGeneration ||
              !panelPointerOutside ||
              !getPref(panelOutsidePref, false) ||
              !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) ||
              !root.isConnected ||
              !root.hasAttribute("open") ||
              root.hasAttribute("closing")
            )
              return;
            const manager = window.gZenCompactModeManager;
            const nativeTarget = manager?._outsideTrackedElement;
            if (nativeTarget) {
              // Share notifications only when Zen is tracking the same edge.
              let entry;
              try {
                const entries = manager.hoverableElements;
                entry =
                  Array.isArray(entries) &&
                  entries.find((entry) => entry.element === nativeTarget);
              } catch (_) {}
              if (entry?.screenEdge === side) {
                panelOutsideHeld = true;
                clearHoverHide();
                return;
              }
              onHoverRootLeave();
              return;
            }
            try {
              const service = Cc["@mozilla.org/zen/mouse-tracker;1"].getService(
                Ci.nsIZenMouseTracker,
              );
              service.registerWindow(
                window,
                side,
                boundedPanelPref(panelOutsideDistancePref, 250, 1, 2000),
              );
              panelOutsideService = service;
              panelOutsideOwned = true;
              panelOutsideHeld = true;
              clearHoverHide();
            } catch (_) {
              // Unsupported platforms/builds retain the existing timed autohide.
              onHoverRootLeave();
            }
          },
          Math.max(0, window.gZenCompactModeManager?.HOVER_HACK_DELAY || 0) +
            20,
        );
      }
      function onPanelOutsideWindowReturn() {
        panelPointerOutside = false;
        const hadSession = panelOutsideHeld || panelOutsidePending != null;
        releasePanelOutsideTracking();
        if (hadSession) onHoverRootLeave();
      }
      function onPanelOutsideWindowEnter(event) {
        if (event.target === document.documentElement)
          onPanelOutsideWindowReturn();
      }
      const panelOutsideExitObserver = {
        observe(subject) {
          if (subject !== window || !panelOutsideHeld) return;
          releasePanelOutsideTracking();
          onHoverRootLeave();
        },
      };
      function onPanelOutsidePrefChange() {
        releasePanelOutsideTracking();
        onHoverRootLeave();
      }
      document.documentElement.addEventListener(
        "pointerleave",
        onPanelOutsideWindowLeave,
      );
      document.documentElement.addEventListener(
        "pointerenter",
        onPanelOutsideWindowEnter,
      );
      document.addEventListener(
        "pointermove",
        onPanelOutsideWindowReturn,
        true,
      );
      window.addEventListener("blur", onPanelOutsideWindowReturn);
      window.addEventListener("resize", onPanelOutsideWindowReturn);
      Services.obs.addObserver(
        panelOutsideExitObserver,
        "zen-mouse-tracker:exited",
      );
      const panelOutsidePrefs = [
        panelOutsidePref,
        panelOutsideDistancePref,
        panelOutsideMarginPref,
        panelOutsideFullEdgePref,
      ];
      for (const pref of panelOutsidePrefs)
        Services.prefs.addObserver(pref, onPanelOutsidePrefChange);
      registerCleanup(() => {
        releasePanelOutsideTracking();
        document.documentElement.removeEventListener(
          "pointerleave",
          onPanelOutsideWindowLeave,
        );
        document.documentElement.removeEventListener(
          "pointerenter",
          onPanelOutsideWindowEnter,
        );
        document.removeEventListener(
          "pointermove",
          onPanelOutsideWindowReturn,
          true,
        );
        window.removeEventListener("blur", onPanelOutsideWindowReturn);
        window.removeEventListener("resize", onPanelOutsideWindowReturn);
        Services.obs.removeObserver(
          panelOutsideExitObserver,
          "zen-mouse-tracker:exited",
        );
        for (const pref of panelOutsidePrefs)
          Services.prefs.removeObserver(pref, onPanelOutsidePrefChange);
      });

      function ensureAutohidePanelPinned() {
        if (ctx.floating?.manualPinOverridden?.()) return;
        if (!getPref("zen.workspace.bgalazka.hover_reveal_panel", false))
          return;
        const root = document.getElementById("zen-app-panel-root");
        const pin = document.querySelector(
          "#zen-app-panel-pill .zen-app-btn[data-pinned]",
        );
        if (!root?.hasAttribute("open") || root.hasAttribute("closing") || !pin)
          return;
        // Change native state through the real action, not merely its CSS marker.
        // Turning autohide off leaves this deliberate pin in place.
        if (pin.getAttribute("data-pinned") !== "true")
          window.Zentral?.Apps?.togglePin?.();
      }
      function hoverPanelAvailable() {
        return !!window.Zentral?.Apps;
      }
      function updateHiddenPanelGeometry(root) {
        if (
          !root ||
          !document.documentElement.hasAttribute("bgalazka-hover-panel-hidden")
        )
          return;
        const side =
          root.getAttribute("data-panel-side") ||
          (window.Zentral?.Apps?.isPanelAttachedToRight?.() ? "right" : "left");
        // offsetLeft/offsetWidth exclude the hide transform. Reading the
        // animated rectangle here compounds the outset after a layout change.
        const inset =
          side === "left"
            ? root.offsetLeft
            : window.innerWidth - root.offsetLeft - root.offsetWidth;
        root.style.setProperty(
          "--bgalazka-hover-outset",
          `${Math.max(80, inset + 80)}px`,
        );
        document.documentElement.setAttribute("bgalazka-panel-side", side);
      }
      function getHiddenPanelRevealWidth() {
        const width = getPref(
          BGALAZKA_EXT_PREFS.HOVER_REVEAL_WIDTH,
          HIDDEN_PANEL_REVEAL_DEFAULT_WIDTH_PX,
        );
        return typeof width === "number" && Number.isFinite(width)
          ? Math.max(1, Math.min(64, Math.round(width)))
          : HIDDEN_PANEL_REVEAL_DEFAULT_WIDTH_PX;
      }
      function updateRevealEdgeGeometry() {
        const revealWidth = getHiddenPanelRevealWidth();
        const width = revealWidth + "px";
        const uiStyle = document.documentElement.style;
        const pushWidth =
          (getPref(panelEdgeRevealPref, true)
            ? boundedPanelPref(panelHoverPushWidthPref, 0, 0, 64)
            : 0) + "px";
        if (
          uiStyle.getPropertyValue("--bgalazka-hover-push-width") !== pushWidth
        )
          uiStyle.setProperty("--bgalazka-hover-push-width", pushWidth);
        if (uiStyle.getPropertyValue("--bgalazka-hover-reveal-width") !== width)
          uiStyle.setProperty("--bgalazka-hover-reveal-width", width);
        const edge = document.getElementById(hoverRevealId);
        const box = document.getElementById("tabbrowser-tabbox");
        if (!edge || !box) return;
        if (edge.style.width !== width) edge.style.width = width;
        const rect = box.getBoundingClientRect();
        const apps = window.Zentral?.Apps;
        if (apps?.isPlacementVerticalBar?.()) {
          const bounds = apps.getAppsBarPanelBounds();
          // When both surfaces hide, return the reveal target to the bezel.
          // A target left floating inside the page steals clicks there.
          const barInset =
            bounds.autohide &&
            document.documentElement.hasAttribute("bgalazka-hover-panel-hidden")
              ? 0
              : bounds.barInset;
          const onRight = apps.isVerticalBarOnRight();
          edge.style.left = onRight ? "auto" : barInset + "px";
          edge.style.right = onRight ? barInset + "px" : "auto";
        } else {
          const panel = document.getElementById("zen-app-panel-root");
          const onRight = panel?.getAttribute("data-panel-side") === "right";
          // Reveal edge always anchors to the window edge; the sidebar never pushes it.
          const inset = 0;
          edge.style.left = onRight ? "auto" : inset + "px";
          edge.style.right = onRight ? inset + "px" : "auto";
        }
        edge.style.top = `${Math.max(0, rect.top)}px`;
        edge.style.height = `${Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top))}px`;
      }
      function clearHoverReveal() {
        if (hoverRevealTimer) clearTimeout(hoverRevealTimer);
        hoverRevealTimer = null;
        hoverRevealSurface = null;
      }
      function getHiddenPanelRevealDelay() {
        const delay = getPref(
          BGALAZKA_EXT_PREFS.HOVER_REVEAL_DELAY,
          HIDDEN_PANEL_REVEAL_DEFAULT_MS,
        );
        return typeof delay === "number" && Number.isFinite(delay)
          ? Math.max(0, Math.min(2000, Math.round(delay)))
          : HIDDEN_PANEL_REVEAL_DEFAULT_MS;
      }
      function scheduleHoverReveal(surface) {
        if (
          surface?.id === hoverRevealId &&
          !getPref(panelEdgeRevealPref, true)
        )
          return;
        clearHoverHide();
        if (
          !document.documentElement.hasAttribute("bgalazka-hover-panel-hidden")
        )
          return;
        if (hoverRevealTimer && hoverRevealSurface === surface) return;
        clearHoverReveal();
        hoverRevealSurface = surface;
        hoverRevealTimer = setTimeout(() => {
          clearHoverReveal();
          if (
            surface?.isConnected &&
            surface.matches(":hover") &&
            document.hasFocus() &&
            hoverPanelAvailable() &&
            (getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) ||
              hoverPanelHiddenOnce())
          ) {
            // Revealing removes the strip from hit testing. Preserve its ledge
            // until a real pointer movement leaves it, rather than treating the
            // resulting pointerleave as the user leaving the panel.
            if (
              surface.id === hoverRevealId ||
              surface.id === "zentral-apps-vertical-bar-trigger"
            ) {
              const rect = surface.getBoundingClientRect();
              hoverRevealLedgeBounds = {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
              };
            }
            setHoverPanelHidden(false);
          }
        }, getHiddenPanelRevealDelay());
      }

      const onHoverLedgePointerMove = (event) => {
        const bounds = hoverRevealLedgeBounds;
        if (!bounds) return;
        if (
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom
        )
          return;
        hoverRevealLedgeBounds = null;
        onHoverRootLeave();
      };
      const onHoverLedgeWindowLeave = () => {
        clearHoverReveal();
        hoverRevealLedgeBounds = null;
        onHoverRootLeave();
      };
      document.addEventListener("pointermove", onHoverLedgePointerMove, true);
      document.documentElement.addEventListener(
        "pointerleave",
        onHoverLedgeWindowLeave,
      );
      window.addEventListener("blur", onHoverLedgeWindowLeave);
      window.addEventListener("resize", onHoverLedgeWindowLeave);
      registerCleanup(() => {
        clearHoverReveal();
        hoverRevealLedgeBounds = null;
        document.removeEventListener(
          "pointermove",
          onHoverLedgePointerMove,
          true,
        );
        document.documentElement.removeEventListener(
          "pointerleave",
          onHoverLedgeWindowLeave,
        );
        window.removeEventListener("blur", onHoverLedgeWindowLeave);
        window.removeEventListener("resize", onHoverLedgeWindowLeave);
      });

      function clearHoverHide() {
        if (hoverHideTimer) clearTimeout(hoverHideTimer);
        hoverHideTimer = null;
      }
      function extendHoverResizeHold() {
        if (
          !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) &&
          !hoverPanelHiddenOnce()
        )
          return;
        hoverResizing = true;
        hoverHoldUntil = Date.now() + 3200;
        clearHoverHide();
        setHoverPanelHidden(false);
      }
      // Notes (additional/notes) asks for a panel that autohide has slid away: it is about to put its sheet
      // inside that panel, so the panel comes back and is held for a few seconds (the normal leave logic
      // takes over afterwards). One document event is the whole contract; nothing here reads Notes state.
      // An absent or closing panel is left alone: Notes then keeps its standalone card.
      const onNotesRevealRequest = () => {
        const root = document.getElementById("zen-app-panel-root");
        if (!root?.hasAttribute("open") || root.hasAttribute("closing")) return;
        hoverHoldUntil = Date.now() + 5000;
        clearHoverHide();
        setHoverPanelHidden(false);
      };
      document.addEventListener("zentral-notes-request-reveal", onNotesRevealRequest);
      registerCleanup(() =>
        document.removeEventListener("zentral-notes-request-reveal", onNotesRevealRequest),
      );
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
      function setHoverPanelHidden(hidden, opts = {}) {
        clearHoverReveal();
        const root = document.getElementById("zen-app-panel-root");
        const available =
          hoverPanelAvailable() &&
          root?.hasAttribute("open") &&
          !root.hasAttribute("closing");
        const autohideEnabled =
          available &&
          getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) === true;
        // A deliberate short press is a one-shot hide: it must not depend on
        // the saved preference. The marker also keeps the hidden panel's CSS
        // and hover-reveal edge active until the panel is brought back.
        const once = !!opts.once;
        const oneShot = once && !!hidden && available;
        const hideAllowed = autohideEnabled || oneShot;
        const shouldHide = !!(hideAllowed && hidden);
        const hiddenOnce = shouldHide && oneShot;
        document.documentElement.toggleAttribute(
          PILL_AUTOHIDE_HIDDEN_ONCE_ATTR,
          hiddenOnce,
        );
        document.documentElement.toggleAttribute(
          "bgalazka-hover-panel-enabled",
          autohideEnabled || hiddenOnce,
        );
        if (!hideAllowed || shouldHide) releasePanelOutsideTracking();
        if (!hideAllowed || shouldHide) hoverRevealLedgeBounds = null;
        const hiddenChanged =
          document.documentElement.hasAttribute(
            "bgalazka-hover-panel-hidden",
          ) !== shouldHide;
        document.documentElement.toggleAttribute(
          "bgalazka-hover-panel-hidden",
          shouldHide,
        );
        updateHiddenPanelGeometry(root);
        const apps = window.Zentral?.Apps;
        if (hiddenChanged) {
          if (shouldHide) {
            apps?.stopPositionTracking?.();
            ctx.cancelPanelRetry("panel-activity");
            if (root?.contains(document.activeElement))
              gBrowser.selectedBrowser?.focus();
            ctx.syncAppPanelBrowserActivity?.();
          } else {
            if (autohideEnabled) {
              apps?.startPositionTracking?.();
              ctx.requestPanelActivity?.();
            }
            ctx.scheduleSecondaryGeometryFit?.();
          }
          syncPanelFallbackPolling();
        }
        if (
          hiddenChanged &&
          (apps?.isPlacementVerticalBar?.() ||
            document.documentElement.getAttribute(
              "bgalazka-opposite-docking",
            ) !== "true")
        ) {
          if (apps?.isPlacementVerticalBar?.())
            apps.syncPanelAutohideVisibility?.();
          // Closing a hidden panel must release its push reservation now,
          // rather than briefly restoring it before the deferred close sync.
          syncPanelPushState();
        }
        const edge = document.getElementById(hoverRevealId);
        if (edge) {
          edge.hidden = !shouldHide || !getPref(panelEdgeRevealPref, true);
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
        ensureAutohidePanelPinned();
        const available = hoverPanelAvailable();
        const autohideEnabled =
          getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) === true;
        const hiddenOnce = hoverPanelHiddenOnce();
        const btn = document.getElementById("zen-app-hover-reveal-btn");
        if (btn) {
          btn.hidden = getPref(BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN, false);
          btn.disabled = false;
          btn.title =
            "Toggle panel autohide (click: hide once; hold: on/off)";
          btn.setAttribute("aria-label", btn.title);
          btn.removeAttribute("data-hold-active");
          btn.setAttribute("data-active", autohideEnabled ? "true" : "false");
          btn.setAttribute("aria-pressed", btn.dataset.active);
          btn.setAttribute("data-once-hidden", hiddenOnce ? "true" : "false");
        }
        document.documentElement.toggleAttribute(
          "bgalazka-hover-panel-enabled",
          available && (autohideEnabled || hiddenOnce),
        );
        // Turning the preference off reveals an ordinary autohidden panel. A
        // deliberate one-shot hide stays hidden until its reveal edge is used.
        if (!available || (!autohideEnabled && !hiddenOnce)) {
          releasePanelOutsideTracking();
          clearHoverHide();
          setHoverPanelHidden(false);
        }
      }
      // Native tabbar hover belongs to Zen. Only Zentral's panel, launcher
      // and explicit reveal controls participate in this hover session.
      function isAppsBarHoverSurfaceHovered() {
        const active = ctx.getActiveAppBrowser()?._bgalazkaAppId;
        if (
          active &&
          Array.from(
            document.querySelectorAll(".zen-app-tile[data-app-id]:hover"),
          ).some(
            (tile) => tile.dataset.appId === active && tile.matches(":hover"),
          )
        )
          return true;
        if (!window.Zentral?.Apps?.isPlacementVerticalBar?.()) return false;
        return !!(
          document
            .getElementById("zentral-apps-vertical-bar")
            ?.matches(":hover") ||
          document
            .getElementById("zentral-apps-vertical-bar-trigger")
            ?.matches(":hover")
        );
      }
      function isSidebarHoverSurfaceHovered() {
        // Zen sets zen-has-hover on the sidebar even when it is retracted in
        // compact mode, so check that first (same approach as ZentralLibraryResize).
        const sidebar = window.ZentralRuntime?.nativeSidebarElement?.();
        if (sidebar?.hasAttribute("zen-has-hover")) return true;
        if (sidebar?.matches?.(":hover")) return true;
        // Fall back to direct :hover for non-compact / visible sidebars.
        // Include #tabbrowser-tabs and #navigator-toolbox because Zen 1.24.1b+
        // keeps Firefox's #vertical-tabs stub hidden (display: none).
        return !!(
          document.getElementById("navigator-toolbox")?.matches(":hover") ||
          document.getElementById("tabbrowser-tabs")?.matches(":hover") ||
          document.getElementById("sidebar-box")?.matches(":hover") ||
          document.getElementById("sidebar-container")?.matches(":hover") ||
          document.getElementById("vertical-tabs")?.matches(":hover")
        );
      }
      function appsBarHoverSurface(event) {
        const launcher = activeHoverLauncher(event);
        if (launcher) return launcher;
        if (!window.Zentral?.Apps?.isPlacementVerticalBar?.()) return null;
        return event.target.closest?.(
          "#zentral-apps-vertical-bar, #zentral-apps-vertical-bar-trigger",
        );
      }
      const onAppsBarPanelPointerOver = (event) => {
        if (
          !appsBarHoverSurface(event) ||
          (!getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) &&
            !hoverPanelHiddenOnce())
        )
          return;
        const root = document.getElementById("zen-app-panel-root");
        if (!root?.hasAttribute("open") || root.hasAttribute("closing")) return;
        scheduleHoverReveal(appsBarHoverSurface(event));
      };
      const onAppsBarPanelPointerOut = (event) => {
        if (
          hoverRevealSurface &&
          !hoverRevealSurface.contains(event.relatedTarget)
        )
          clearHoverReveal();
        if (
          !appsBarHoverSurface(event) ||
          !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false)
        )
          return;
        const root = document.getElementById("zen-app-panel-root");
        if (!root?.hasAttribute("open") || root.hasAttribute("closing")) return;
        // Moving among bar buttons, its trigger, and the panel is one hover
        // session. The existing delay also bridges the gutter between them.
        if (
          activeHoverLauncher({ target: event.relatedTarget || {} }) ||
          event.relatedTarget?.closest?.(
            "#zentral-apps-vertical-bar, #zentral-apps-vertical-bar-trigger, #zen-app-panel-root, #bgalazka-panel-reveal-edge",
          )
        ) {
          clearHoverHide();
          return;
        }
        onHoverRootLeave();
      };
      const onHoverRootEnter = () => {
        clearHoverReveal();
        clearHoverHide();
      };
      const onHoverRootLeave = (event) => {
        clearHoverReveal();
        clearHoverHide();
        if (
          !hoverPanelAvailable() ||
          !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) ||
          hoverResizing ||
          panelEntryHeld ||
          panelOutsideHeld ||
          panelOutsidePending != null ||
          hoverMenuVisible() ||
          hoverRevealLedgeBounds ||
          isAppsBarHoverSurfaceHovered() ||
          isSidebarHoverSurfaceHovered()
        )
          return;
        // Leaving the panel toward the sidebar keeps the panel open; the
        // sidebar hover surface is a continuous hover session with the panel.
        if (event?.relatedTarget) {
          const sidebar = event.relatedTarget.closest?.(
            "#navigator-toolbox, #tabbrowser-tabs, #sidebar-box, #sidebar-container, #vertical-tabs, #sidebar",
          );
          if (sidebar) return;
        }
        hoverHideTimer = setTimeout(
          () => {
            hoverHideTimer = null;
            const root = document.getElementById("zen-app-panel-root");
            const edge = document.getElementById(hoverRevealId);
            if (
              root?.matches(":hover") ||
              edge?.matches(":hover") ||
              hoverRevealLedgeBounds ||
              isAppsBarHoverSurfaceHovered() ||
              isSidebarHoverSurfaceHovered() ||
              hoverResizing ||
              panelEntryHeld ||
              panelOutsideHeld ||
              panelOutsidePending != null ||
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
            Math.max(
              0,
              Math.min(5000, Number(getPref(panelHideDelayPref, 400)) || 0),
            ),
            hoverHoldUntil - Date.now(),
            hoverTypingUntil - Date.now(),
          ),
        );
      };
      function classifyPillAutohideGesture(opts = {}) {
        // An absent timestamp is not 0/Unix epoch: it is not a press at all.
        const downAt = typeof opts.downAt === "number" ? opts.downAt : NaN;
        const upAt = typeof opts.upAt === "number" ? opts.upAt : NaN;
        const requestedHold = Number(opts.holdMs);
        const holdMs =
          Number.isFinite(requestedHold) && requestedHold >= 0
            ? requestedHold
            : 550;
        const valid =
          Number.isFinite(downAt) &&
          Number.isFinite(upAt) &&
          !opts.moved &&
          !opts.cancelled &&
          upAt >= downAt;
        const pressedMs = valid ? Math.max(0, Math.round(upAt - downAt)) : 0;
        const held = valid && pressedMs >= holdMs;
        const action = !valid ? "none" : held ? "toggle" : "hide-once";
        return { action, held, pressedMs };
      }
      function pillPointerMovement(opts = {}) {
        const finite = (value) =>
          typeof value === "number" && Number.isFinite(value);
        const startX = finite(opts.startX) ? opts.startX : NaN;
        const startY = finite(opts.startY) ? opts.startY : NaN;
        const x = finite(opts.x) ? opts.x : NaN;
        const y = finite(opts.y) ? opts.y : NaN;
        const tolerancePx =
          finite(opts.tolerancePx) && opts.tolerancePx >= 0
            ? opts.tolerancePx
            : 8;
        const hasCoords = finite(startX) && finite(startY) && finite(x) && finite(y);
        const distancePx = hasCoords ? Math.hypot(x - startX, y - startY) : 0;
        return {
          moved: hasCoords && distancePx > tolerancePx,
          distancePx: Math.round(distancePx * 100) / 100,
        };
      }
      // <<OW-130 GESTURE END>>
      let lastAutohidePref =
        getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) === true;
      let pillAutohidePress = null;
      let pillAutohideConsumedClick = false;
      let pillAutohideSuppressClick = false;
      const pillPointerMatches = (press, event) =>
        press.pointerId == null ||
        event?.pointerId == null ||
        press.pointerId === event.pointerId;
      function hidePanelOnce() {
        clearHoverHide();
        setHoverPanelHidden(true, { once: true });
      }
      function toggleAutohidePref() {
        const next = !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false);
        lastAutohidePref = next;
        setPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, next);
        // Disabling the preference brings the panel back. Enabling leaves a
        // one-shot hidden panel hidden; the next genuine pointer exit owns it.
        if (!next) setHoverPanelHidden(false);
        syncHoverPanelAvailability();
      }
      function clearPillAutohidePress() {
        const press = pillAutohidePress;
        pillAutohidePress = null;
        if (!press) return;
        press.target.removeAttribute("data-hold-active");
        if (press.timer != null) clearTimeout(press.timer);
      }
      function pillAutohideTarget(event) {
        const target = event?.target?.closest?.(PILL_AUTOHIDE_SELECTOR);
        return target || null;
      }
      const onPillAutohideDown = (event) => {
        if (event.button !== 0 || event.isTrusted === false) return;
        const target = pillAutohideTarget(event);
        if (!target) return;
        clearPillAutohidePress();
        pillAutohideConsumedClick = false;
        pillAutohideSuppressClick = false;
        const press = {
          downAt: Date.now(),
          target,
          pointerId:
            typeof event.pointerId === "number" ? event.pointerId : null,
          startX:
            typeof event.clientX === "number" && Number.isFinite(event.clientX)
              ? event.clientX
              : null,
          startY:
            typeof event.clientY === "number" && Number.isFinite(event.clientY)
              ? event.clientY
              : null,
          moved: false,
          cancelled: false,
          held: false,
          timer: null,
        };
        pillAutohidePress = press;
        press.timer = setTimeout(() => {
          if (pillAutohidePress !== press) return;
          press.held = true;
          press.target.setAttribute("data-hold-active", "true");
        }, PILL_AUTOHIDE_HOLD_MS);
      };
      const onPillAutohideCancel = (event) => {
        const press = pillAutohidePress;
        if (press && !pillPointerMatches(press, event)) return;
        const hadPress = !!press;
        if (press) press.cancelled = true;
        clearPillAutohidePress();
        pillAutohideConsumedClick = false;
        pillAutohideSuppressClick = hadPress;
      };
      const onPillAutohideMove = (event) => {
        const press = pillAutohidePress;
        if (!press || !pillPointerMatches(press, event)) return;
        // A zero-delta or sub-threshold pointermove is jitter, not a drag.
        const movement = pillPointerMovement({
          startX: press.startX,
          startY: press.startY,
          x: event.clientX,
          y: event.clientY,
          tolerancePx: PILL_AUTOHIDE_MOVE_TOLERANCE_PX,
        });
        if (!movement.moved) return;
        press.moved = true;
        onPillAutohideCancel(event);
      };
      const onPillAutohideUp = (event) => {
        const press = pillAutohidePress;
        if (!press) {
          pillAutohideConsumedClick = false;
          return;
        }
        if (!pillPointerMatches(press, event)) return;
        if (!pillAutohideTarget(event)) {
          onPillAutohideCancel(event);
          return;
        }
        const release = pillPointerMovement({
          startX: press.startX,
          startY: press.startY,
          x: event.clientX,
          y: event.clientY,
          tolerancePx: PILL_AUTOHIDE_MOVE_TOLERANCE_PX,
        });
        const verdict = classifyPillAutohideGesture({
          downAt: press.downAt,
          upAt: Date.now(),
          moved: press.moved || release.moved,
          cancelled:
            press.cancelled ||
            (typeof event.button === "number" && event.button !== 0),
          holdMs: PILL_AUTOHIDE_HOLD_MS,
        });
        const held = press.held || verdict.held;
        clearPillAutohidePress();
        if (verdict.action === "none") {
          pillAutohideConsumedClick = false;
          pillAutohideSuppressClick = true;
          return;
        }
        pillAutohideConsumedClick = true;
        if (held || verdict.action === "toggle") toggleAutohidePref();
        else hidePanelOnce();
      };
      const onPillAutohideClick = (event) => {
        if (!pillAutohideTarget(event)) {
          pillAutohideConsumedClick = false;
          pillAutohideSuppressClick = false;
          return;
        }
        if (pillAutohideConsumedClick || pillAutohideSuppressClick) {
          pillAutohideConsumedClick = false;
          pillAutohideSuppressClick = false;
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          return;
        }
        // A plain click, keyboard activation or a synthetic click without a
        // pointerdown/up pair is the one-shot hide.
        hidePanelOnce();
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      };
      const onPillAutohideKeyDown = (event) => {
        if (event.key === "Escape" || event.key === "Esc")
          onPillAutohideCancel(event);
      };
      const removePillAutohideListeners = () => {
        document.removeEventListener("pointerdown", onPillAutohideDown, true);
        window.removeEventListener("pointerup", onPillAutohideUp, true);
        window.removeEventListener("pointermove", onPillAutohideMove, true);
        window.removeEventListener("pointercancel", onPillAutohideCancel, true);
        window.removeEventListener("blur", onPillAutohideCancel, true);
        document.removeEventListener("click", onPillAutohideClick, true);
        window.removeEventListener("keydown", onPillAutohideKeyDown, true);
        clearPillAutohidePress();
        pillAutohideConsumedClick = false;
        pillAutohideSuppressClick = false;
      };
      document.addEventListener("pointerdown", onPillAutohideDown, true);
      window.addEventListener("pointerup", onPillAutohideUp, true);
      window.addEventListener("pointermove", onPillAutohideMove, true);
      window.addEventListener("pointercancel", onPillAutohideCancel, true);
      window.addEventListener("blur", onPillAutohideCancel, true);
      document.addEventListener("click", onPillAutohideClick, true);
      window.addEventListener("keydown", onPillAutohideKeyDown, true);

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
          edge.style.width = getHiddenPanelRevealWidth() + "px";
          edge.addEventListener("pointerenter", () => {
            scheduleHoverReveal(edge);
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
          btn.title = "Show panel on hover at its docked edge";
          btn.setAttribute("aria-label", btn.title);
          btn.setAttribute("aria-pressed", "false");
          btn.appendChild(parseSVG(PREF_ICONS.HOVER_EYE));
          const anchor =
            document.getElementById("zen-app-dual-view-btn") || pill.firstChild;
          if (anchor?.parentNode)
            anchor.parentNode.insertBefore(btn, anchor.nextSibling);
          else pill.appendChild(btn);
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
        hoverHoldUntil = Date.now() + 5000;
        clearHoverHide();
        syncHoverPanelAvailability();
        setHoverPanelHidden(false);
        onHoverRootLeave();
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
        hoverHoldUntil = Date.now() + 5000;
        syncHoverPanelAvailability();
        setHoverPanelHidden(false);
        onHoverRootLeave();
      };
      const onHoverPopupShowing = (event) => {
        if (
          (!getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) &&
            !hoverPanelHiddenOnce()) ||
          !document
            .getElementById("zen-app-panel-root")
            ?.hasAttribute("open") ||
          document.documentElement.hasAttribute(
            "bgalazka-hover-panel-hidden",
          ) ||
          !["menupopup", "panel", "panel-list"].includes(
            event.target?.localName,
          )
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
      // Delegate for Apps Bars and active tab launchers, including rebuilt tiles.
      document.addEventListener("pointerover", onAppsBarPanelPointerOver, true);
      document.addEventListener("pointerout", onAppsBarPanelPointerOut, true);
      document.addEventListener("pointerover", onWebPagePointer, true);
      window.addEventListener("focusout", onHoverPanelFocusOut, true);
      window.addEventListener("focusin", onHoverPanelFocusIn, true);
      window.addEventListener("keydown", onHoverPanelKeyDown, true);
      // Window resizing fires this every frame and the handler measures the page box and
      // the apps bar. One run per frame is enough; the last size always wins.
      let revealResizeFrame = 0;
      const onRevealEdgeResize = () => {
        if (revealResizeFrame) return;
        revealResizeFrame = window.requestAnimationFrame(() => {
          revealResizeFrame = 0;
          updateRevealEdgeGeometry();
        });
      };
      window.addEventListener("resize", onRevealEdgeResize);
      const onHoverRevealWidthChange = () => {
        clearHoverReveal();
        hoverRevealLedgeBounds = null;
        updateRevealEdgeGeometry();
        const edge = document.getElementById(hoverRevealId);
        if (edge?.matches(":hover")) scheduleHoverReveal(edge);
        else onHoverRootLeave();
      };
      for (const pref of [
        BGALAZKA_EXT_PREFS.HOVER_REVEAL_WIDTH,
        panelHoverPushWidthPref,
      ]) {
        Services.prefs.addObserver(pref, onHoverRevealWidthChange);
        registerCleanup(() =>
          Services.prefs.removeObserver(pref, onHoverRevealWidthChange),
        );
      }
      const onHoverPrefChange = () => {
        const enabled =
          getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) === true;
        // A preference turned off from Settings reveals the panel even when a
        // one-shot hide marker is present; enabling it preserves that hide.
        if (lastAutohidePref && !enabled) setHoverPanelHidden(false);
        lastAutohidePref = enabled;
        clearHoverReveal();
        hoverRevealLedgeBounds = null;
        syncHoverPanelAvailability();
        updateRevealEdgeGeometry();
        const edge = document.getElementById(hoverRevealId);
        if (edge)
          edge.hidden =
            !getPref(panelEdgeRevealPref, true) ||
            !document.documentElement.hasAttribute(
              "bgalazka-hover-panel-hidden",
            );
        schedulePanelModeGeometrySync();
        onHoverRootLeave();
      };
      for (const pref of [
        BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL,
        BGALAZKA_EXT_PREFS.HIDE_HOVER_REVEAL_BTN,
        BGALAZKA_EXT_PREFS.OPPOSITE_DOCKING,
        panelEdgeRevealPref,
        panelHideDelayPref,
      ]) {
        Services.prefs.addObserver(pref, onHoverPrefChange);
        registerCleanup(() =>
          Services.prefs.removeObserver(pref, onHoverPrefChange),
        );
      }
      registerCleanup(() => {
        document.removeEventListener(
          "pointerover",
          onAppsBarPanelPointerOver,
          true,
        );
        document.removeEventListener(
          "pointerout",
          onAppsBarPanelPointerOut,
          true,
        );
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
        window.removeEventListener("resize", onRevealEdgeResize);
        if (revealResizeFrame) window.cancelAnimationFrame(revealResizeFrame);
        revealResizeFrame = 0;
        hoverBoundRoot?.removeEventListener("pointerenter", onHoverRootEnter);
        hoverBoundRoot?.removeEventListener("pointerleave", onHoverRootLeave);
        document.getElementById(hoverRevealId)?.remove();
        document.documentElement.style.removeProperty(
          "--bgalazka-hover-reveal-width",
        );
        document.documentElement.style.removeProperty(
          "--bgalazka-hover-push-width",
        );
        document.getElementById("zen-app-hover-reveal-btn")?.remove();
        document.documentElement.removeAttribute(
          "bgalazka-hover-panel-enabled",
        );
        document.documentElement.removeAttribute("bgalazka-hover-panel-hidden");
        document.documentElement.removeAttribute(
          PILL_AUTOHIDE_HIDDEN_ONCE_ATTR,
        );
        window.Zentral?.Apps?.syncPanelAutohideVisibility?.();
      });

      // Optional outside -> inside entry reveal. Independent of the normal
      // hover ledge: only temporary first-return listeners; no polling/tracker.
      const compactHoverPref =
        "zen.workspace.zentral.experimental.compact_sidebar_hover";
      const windowEntryPref = compactHoverPref + ".window_entry_reveal";
      const panelEntryPref = windowEntryPref + ".panels";
      const panelEntryOverlayPref = panelEntryPref + ".only_when_not_pushing";
      let panelEntryAllowed = false;
      let panelEntryOverlayOnly = true;
      let panelEntryListening = false;
      let panelEntryTimer = null;
      let panelEntryGrace = 250;
      let panelExitAt = null;
      let panelExitBox = null;
      let panelExitSide = null;
      function clearPanelExit() {
        if (panelExitAt === null) return;
        panelExitAt = null;
        panelExitBox = null;
        panelExitSide = null;
        window.removeEventListener("mouseover", onPanelFirstReturn, true);
        window.removeEventListener("mousemove", onPanelFirstReturn, true);
      }
      function onPanelWindowLeave(event) {
        if (
          !panelEntryListening ||
          event.target !== document.documentElement ||
          !event.isTrusted
        )
          return;
        clearPanelExit();
        const root = document.getElementById("zen-app-panel-root");
        if (
          !root?.hasAttribute("open") ||
          root.hasAttribute("closing") ||
          hoverResizing ||
          hoverMenuVisible()
        )
          return;
        const windowBox = window.windowUtils?.getBoundsWithoutFlushing
          ? window.windowUtils.getBoundsWithoutFlushing(
              document.documentElement,
            )
          : document.documentElement.getBoundingClientRect();
        const box = window.windowUtils?.getBoundsWithoutFlushing
          ? window.windowUtils.getBoundsWithoutFlushing(root)
          : root.getBoundingClientRect();
        const side =
          root.getAttribute("data-panel-side") ||
          (window.Zentral?.Apps?.isPanelAttachedToRight?.() ? "right" : "left");
        const crossedSide =
          side === "right"
            ? event.clientX >= windowBox.right - 10
            : event.clientX <= windowBox.left + 10;
        if (
          !crossedSide ||
          event.clientY <= windowBox.top + 10 ||
          event.clientY >= windowBox.bottom - 10 ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          return;
        panelExitAt = Date.now();
        panelExitBox = windowBox;
        panelExitSide = side;
        window.addEventListener("mouseover", onPanelFirstReturn, true);
        window.addEventListener("mousemove", onPanelFirstReturn, true);
      }
      function onPanelFirstReturn(event) {
        if (!event.isTrusted || panelExitAt === null) return;
        if (
          event.clientX < panelExitBox.left ||
          event.clientX > panelExitBox.right ||
          event.clientY < panelExitBox.top ||
          event.clientY > panelExitBox.bottom
        )
          return;
        onPanelWindowEntry(event, true);
        clearPanelExit(); // Detach after the first return, successful or not.
      }
      function releasePanelEntry(scheduleHide = true) {
        const held = panelEntryHeld;
        if (panelEntryTimer !== null) clearTimeout(panelEntryTimer);
        panelEntryTimer = null;
        panelEntryHeld = false;
        if (held && scheduleHide) onHoverRootLeave();
      }
      function onPanelWindowEntry(event, fallback = false) {
        const windowRoot = document.documentElement;
        if (
          !panelEntryListening ||
          (panelEntryOverlayOnly &&
            windowRoot.getAttribute("bgalazka-push-page") === "true") ||
          (!fallback && event.target !== windowRoot) ||
          !event.isTrusted ||
          (!fallback &&
            event.relatedTarget &&
            windowRoot.contains(event.relatedTarget)) ||
          hoverResizing ||
          hoverMenuVisible() ||
          window.gZenCompactModeManager?._isTabBeingDragged
        )
          return;
        const root = document.getElementById("zen-app-panel-root");
        if (!root?.hasAttribute("open") || root.hasAttribute("closing")) return;
        const read = (element) =>
          window.windowUtils?.getBoundsWithoutFlushing
            ? window.windowUtils.getBoundsWithoutFlushing(element)
            : element.getBoundingClientRect();
        const windowBox = read(windowRoot);
        const box = read(root);
        const side =
          root.getAttribute("data-panel-side") ||
          (window.Zentral?.Apps?.isPanelAttachedToRight?.() ? "right" : "left");
        const recentExit =
          panelExitAt !== null &&
          Date.now() - panelExitAt <= 1500 &&
          panelExitSide === side;
        clearPanelExit();
        const matchingHalf =
          side === "right"
            ? event.clientX >= (windowBox.left + windowBox.right) / 2
            : event.clientX <= (windowBox.left + windowBox.right) / 2;
        if (
          event.clientX < windowBox.left ||
          event.clientX > windowBox.right ||
          (Math.abs(event.clientX - windowBox[side]) > 10 &&
            !(recentExit && matchingHalf)) ||
          event.clientY <= windowBox.top + 10 ||
          event.clientY >= windowBox.bottom - 10 ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          return;
        releasePanelEntry(false);
        clearHoverHide();
        panelEntryHeld = true;
        setHoverPanelHidden(false);
        panelEntryTimer = setTimeout(() => {
          panelEntryTimer = null;
          panelEntryHeld = false;
          // Existing hover, resize, typing and popup rules decide whether to
          // hide, using the existing panel autohide delay.
          onHoverRootLeave();
        }, panelEntryGrace);
      }
      function onPanelNativeWindowEntry(event) {
        if (event.isTrusted && !event.relatedTarget)
          onPanelWindowEntry(event, true);
      }
      function syncPanelEntryListener() {
        const enabled =
          panelEntryAllowed &&
          (!panelEntryOverlayOnly ||
            document.documentElement.getAttribute("bgalazka-push-page") !==
              "true");
        if (panelEntryListening === enabled) return;
        panelEntryListening = enabled;
        if (!enabled) {
          clearPanelExit();
          releasePanelEntry();
        }
        const method = enabled ? "addEventListener" : "removeEventListener";
        window[method]("mouseover", onPanelNativeWindowEntry, true);
        document.documentElement[method](
          "mouseenter",
          onPanelWindowEntry,
          true,
        );
        document.documentElement[method](
          "mouseleave",
          onPanelWindowLeave,
          true,
        );
        for (const type of [
          "blur",
          "deactivate",
          "resize",
          "sizemodechange",
          "dragstart",
        ])
          window[method](type, clearPanelEntry, true);
      }
      const pushStateObserver = new MutationObserver(syncPanelEntryListener);
      function syncPanelWindowEntry() {
        panelEntryAllowed = Boolean(
          getPref(windowEntryPref, false) &&
          getPref(panelEntryPref, false) &&
          getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false),
        );
        panelEntryOverlayOnly = getPref(panelEntryOverlayPref, true);
        panelEntryGrace = Math.max(
          250,
          Math.min(
            2000,
            Number(
              getPref("zen.view.compact.sidebar-keep-hover.duration", 0),
            ) || 0,
          ),
        );
        pushStateObserver.disconnect();
        if (panelEntryAllowed && panelEntryOverlayOnly) {
          // This resolved attribute already includes Triple View's push choice.
          // Hidden panels keep their push mode, avoiding reveal/hide feedback.
          pushStateObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["bgalazka-push-page"],
          });
        }
        syncPanelEntryListener();
      }
      const entryPrefs = [
        windowEntryPref,
        BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL,
        "zen.view.compact.sidebar-keep-hover.duration",
      ];
      const entrySettings = new Set([
        windowEntryPref,
        panelEntryPref,
        panelEntryOverlayPref,
        BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL,
        "zen.view.compact.sidebar-keep-hover.duration",
      ]);
      const entryObserver = {
        observe(subject, topic, pref) {
          if (entrySettings.has(pref)) syncPanelWindowEntry();
        },
      };
      for (const pref of entryPrefs)
        Services.prefs.addObserver(pref, entryObserver);
      const clearPanelEntry = () => {
        clearPanelExit();
        releasePanelEntry();
      };
      registerCleanup(() => {
        removePillAutohideListeners();
        clearPillAutohidePress();
        panelEntryAllowed = false;
        panelEntryListening = false;
        window.removeEventListener("mouseover", onPanelNativeWindowEntry, true);
        pushStateObserver.disconnect();
        clearPanelExit();
        releasePanelEntry(false);
        document.documentElement.removeEventListener(
          "mouseenter",
          onPanelWindowEntry,
          true,
        );
        document.documentElement.removeEventListener(
          "mouseleave",
          onPanelWindowLeave,
          true,
        );
        for (const pref of entryPrefs)
          Services.prefs.removeObserver(pref, entryObserver);
        for (const type of [
          "blur",
          "deactivate",
          "resize",
          "sizemodechange",
          "dragstart",
        ])
          window.removeEventListener(type, clearPanelEntry, true);
      });
      syncPanelWindowEntry();

      return {
        classifyPillAutohideGesture,
        clearHoverHide,
        ensureAutohidePanelPinned,
        ensurePillHoverRevealButton,
        extendHoverResizeHold,
        onHoverRootLeave,
        setHoverPanelHidden,
        syncHoverPanelAvailability,
        updateHiddenPanelGeometry,
        updateRevealEdgeGeometry,
      };
    },
  );
})();
