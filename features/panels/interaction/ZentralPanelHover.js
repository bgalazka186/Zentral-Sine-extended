/*
 * ZENTRAL FILE GUIDE - features/panels/interaction/ZentralPanelHover.js
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
 * Loaded/created by: features/panels/ZentralPanels.uc.js
 * Returned factory API: clearHoverHide; ensureAutohidePanelPinned; ensurePillHoverRevealButton;
 *   extendHoverResizeHold; onHoverRootLeave; setHoverPanelHidden; syncHoverPanelAvailability;
 *   updateHiddenPanelGeometry; updateRevealEdgeGeometry
 * Shared ctx symbols used: cancelPanelRetry; getActiveAppBrowser; requestPanelActivity;
 *   syncAppPanelBrowserActivity
 * Cross-file calls / ctx suppliers: features/panels/browsers/ZentralBrowserIntegrations.uc.js -> ctx.syncAppPanelBrowserActivity;
 *   features/panels/navigation/ZentralPanelToolbar.uc.js -> ctx.getActiveAppBrowser
 * Literal DOM event subscriptions: blur; click; contextmenu; focusin; focusout; keydown; mousedown;
 *   mouseup; pointercancel; pointerdown; pointerenter; pointerleave; pointermove; pointerout; pointerover;
 *   pointerup; popuphidden; popupshowing; resize
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
      let hoverRevealFrame = null;
      let hoverRevealTimer = null;
      let hoverRevealSurface = null;
      let hoverRevealLedgeBounds = null;
      const HIDDEN_PANEL_REVEAL_DEFAULT_MS = 160;
      const HIDDEN_PANEL_REVEAL_DEFAULT_WIDTH_PX = 6;
      let hoverResizing = false;
      let hoverHoldUntil = 0;
      let hoverTypingUntil = 0;
      const hoverOpenPopups = new Set();
      let hoverContextPending = false;
      let hoverContextTimer = null;
      const hoverRevealId = "bgalazka-panel-reveal-edge";

      function ensureAutohidePanelPinned() {
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
        if (uiStyle.getPropertyValue("--bgalazka-hover-reveal-width") !== width)
          uiStyle.setProperty("--bgalazka-hover-reveal-width", width);
        const edge = document.getElementById(hoverRevealId);
        const box = document.getElementById("tabbrowser-tabbox");
        if (!edge || !box) return;
        if (edge.style.width !== width) edge.style.width = width;
        const rect = box.getBoundingClientRect();
        const apps = window.Zentral?.Apps;
        if (apps?.isPanelDockedToAppsBar?.()) {
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
          const ui = document.documentElement;
          const atViewportEdge =
            ui.getAttribute("bgalazka-opposite-docking") === "true" &&
            !apps?.isPlacementVerticalBar?.();
          let inset = 0;
          if (!atViewportEdge) {
            const sidebar =
              window.ZentralRuntime?.nativeSidebarElement?.() ||
              window.gBrowser?.tabContainer;
            const sidebarRect = sidebar?.getBoundingClientRect();
            if (sidebarRect?.width > 0)
              inset = onRight
                ? window.innerWidth - sidebarRect.left
                : sidebarRect.right;
          }
          // Follow the native bar's content-facing edge, including compact or
          // temporarily collapsed layouts. Never keep a stale opposite-side inset.
          inset = Math.max(0, Math.min(window.innerWidth - revealWidth, inset));
          edge.style.left = onRight ? "auto" : inset + "px";
          edge.style.right = onRight ? inset + "px" : "auto";
        }
        const safe = window.ZentralRuntime?.sidebarSafeBounds?.();
        if (safe) {
          if (edge.style.left !== "auto")
            edge.style.left =
              Math.max(safe.left, parseFloat(edge.style.left) || 0) + "px";
          if (edge.style.right !== "auto")
            edge.style.right =
              Math.max(
                window.innerWidth - safe.right,
                parseFloat(edge.style.right) || 0,
              ) + "px";
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
            getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false)
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
        clearHoverReveal();
        const root = document.getElementById("zen-app-panel-root");
        const enabled =
          hoverPanelAvailable() &&
          getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) === true &&
          root?.hasAttribute("open") &&
          !root.hasAttribute("closing");
        const shouldHide = !!(enabled && hidden);
        if (!enabled || shouldHide) hoverRevealLedgeBounds = null;
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
          } else if (enabled) {
            apps?.startPositionTracking?.();
            ctx.requestPanelActivity?.();
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
        ensureAutohidePanelPinned();
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
            ? `Click: toggle autohide. Hold: ${pushing ? "stop" : "resume"} pushing the webpage in Triple View.`
            : "Show panel on hover at its docked edge";
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
      // Native tabbar hover belongs to Zen. Only Zentral's panel, launcher
      // and explicit reveal controls participate in this hover session.
      function isAppsBarHoverSurfaceHovered() {
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
      function appsBarHoverSurface(event) {
        if (!window.Zentral?.Apps?.isPlacementVerticalBar?.()) return null;
        return event.target.closest?.(
          "#zentral-apps-vertical-bar, #zentral-apps-vertical-bar-trigger",
        );
      }
      const onAppsBarPanelPointerOver = (event) => {
        if (
          !appsBarHoverSurface(event) ||
          !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false)
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
      const onHoverRootLeave = () => {
        clearHoverReveal();
        clearHoverHide();
        if (
          !hoverPanelAvailable() ||
          !getPref(BGALAZKA_EXT_PREFS.HOVER_REVEAL_PANEL, false) ||
          hoverResizing ||
          hoverMenuVisible() ||
          hoverRevealLedgeBounds ||
          isAppsBarHoverSurfaceHovered()
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
              hoverRevealLedgeBounds ||
              isAppsBarHoverSurfaceHovered() ||
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
      // Delegate so late-created/rebuilt Apps Bars need no listener rebinding.
      document.addEventListener("pointerover", onAppsBarPanelPointerOver, true);
      document.addEventListener("pointerout", onAppsBarPanelPointerOut, true);
      document.addEventListener("pointerover", onWebPagePointer, true);
      window.addEventListener("focusout", onHoverPanelFocusOut, true);
      window.addEventListener("focusin", onHoverPanelFocusIn, true);
      window.addEventListener("keydown", onHoverPanelKeyDown, true);
      window.addEventListener("resize", updateRevealEdgeGeometry);
      const onHoverRevealWidthChange = () => {
        clearHoverReveal();
        hoverRevealLedgeBounds = null;
        updateRevealEdgeGeometry();
        const edge = document.getElementById(hoverRevealId);
        if (edge?.matches(":hover")) scheduleHoverReveal(edge);
        else onHoverRootLeave();
      };
      Services.prefs.addObserver(
        BGALAZKA_EXT_PREFS.HOVER_REVEAL_WIDTH,
        onHoverRevealWidthChange,
      );
      registerCleanup(() =>
        Services.prefs.removeObserver(
          BGALAZKA_EXT_PREFS.HOVER_REVEAL_WIDTH,
          onHoverRevealWidthChange,
        ),
      );
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
        window.removeEventListener("resize", updateRevealEdgeGeometry);
        hoverBoundRoot?.removeEventListener("pointerenter", onHoverRootEnter);
        hoverBoundRoot?.removeEventListener("pointerleave", onHoverRootLeave);
        document.getElementById(hoverRevealId)?.remove();
        document.documentElement.style.removeProperty(
          "--bgalazka-hover-reveal-width",
        );
        document.getElementById("zen-app-hover-reveal-btn")?.remove();
        document.documentElement.removeAttribute(
          "bgalazka-hover-panel-enabled",
        );
        document.documentElement.removeAttribute("bgalazka-hover-panel-hidden");
        window.Zentral?.Apps?.syncPanelAutohideVisibility?.();
      });

      return {
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
