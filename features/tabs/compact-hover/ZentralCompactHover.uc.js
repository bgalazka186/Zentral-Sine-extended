/* Experimental native compact sidebar hover guard. No CSS or tracker ownership.
 * Preserve an existing hover during stale native leave callbacks, using the
 * last visible bounds rather than the animated/hidden sidebar hit-test.
 *
 * Edge hysteresis: a soft margin around the visible bounds plus a short
 * "leaving" grace state keeps the sidebar open while the pointer wiggles
 * across its edge.
 */
(function () {
  "use strict";
  const PREF = "zen.workspace.zentral.experimental.compact_sidebar_hover";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  function start() {
    const manager = window.gZenCompactModeManager;
    if (typeof manager?._setElementExpandAttribute !== "function")
      throw new Error(
        "Compact hover guard requires Zen's native compact manager",
      );
    // Tunables for edge wiggle tolerance.
    const EDGE_MARGIN = 12; // px of tolerance around the visible bounds
    const EXIT_GRACE = 250; // ms before a real exit is allowed to hide
    let active = true,
      inside = false,
      outside = false,
      leaving = false,
      bounds = null;
    let blocked = false,
      timer = null;
    let configured = false,
      keepHoverDelay = 0,
      listening = false;
    let frameBounds = null,
      boundsFrame = null;
    const cleanups = [];
    const enabled = () => active && configured && !manager._ignoreNextHover;
    const contains = (box, event, m = 0) =>
      box &&
      event.clientX >= box.left - m &&
      event.clientX <= box.right + m &&
      event.clientY >= box.top - m &&
      event.clientY <= box.bottom + m;
    function cancelTimer() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    }
    function invalidateBounds() {
      if (boundsFrame !== null) window.cancelAnimationFrame(boundsFrame);
      boundsFrame = null;
      frameBounds = null;
    }
    function readBounds(sidebar) {
      if (!frameBounds) {
        // Zen's non-flushing read avoids forcing layout during mouse movement.
        // The fallback is limited to one read per animation frame as well.
        frameBounds = window.windowUtils?.getBoundsWithoutFlushing
          ? window.windowUtils.getBoundsWithoutFlushing(sidebar)
          : sidebar.getBoundingClientRect();
        boundsFrame = window.requestAnimationFrame(() => {
          boundsFrame = null;
          frameBounds = null;
        });
      }
      return frameBounds;
    }
    function reset(release = true) {
      cancelTimer();
      invalidateBounds();
      const hadBlocked = blocked;
      inside = outside = blocked = leaving = false;
      bounds = null;
      if (release && hadBlocked && manager.sidebar)
        manager._setElementExpandAttribute(manager.sidebar, false);
    }
    function expire(delay) {
      cancelTimer();
      timer = window.setTimeout(() => {
        timer = null;
        reset();
      }, delay);
    }
    function wrap(key, create) {
      const original = manager[key];
      if (typeof original !== "function") return;
      const own = Object.getOwnPropertyDescriptor(manager, key);
      const wrapper = create(original);
      Object.defineProperty(manager, key, {
        configurable: true,
        writable: true,
        enumerable: own?.enumerable ?? true,
        value: wrapper,
      });
      cleanups.push(() => {
        if (manager[key] !== wrapper) return; // Another mod may wrap ours later.
        if (own) Object.defineProperty(manager, key, own);
        else delete manager[key];
      });
    }
    function listen(target, type, callback) {
      target.addEventListener(type, callback, true);
      cleanups.push(() => target.removeEventListener(type, callback, true));
    }
    function onMove(event) {
      if (!event.isTrusted) return;
      if (!enabled()) {
        reset();
        return;
      }
      const sidebar = manager.sidebar;
      if (!sidebar?.hasAttribute("zen-has-hover")) {
        reset();
        return;
      }
      const box = readBounds(sidebar);
      const wasOutside = outside;
      // On window re-entry, retain the pre-exit bounds for the first hit-test.
      const ref = wasOutside && bounds ? bounds : box;
      // Margin only applies once the pointer was already inside/leaving, so it
      // never makes the sidebar easier to trigger from far away.
      const hit = contains(
        ref,
        event,
        inside || leaving || wasOutside ? EDGE_MARGIN : 0,
      );
      if (wasOutside) cancelTimer();
      outside = false;
      if (hit) {
        inside = true;
        leaving = false;
        bounds = box;
        cancelTimer();
      } else if (inside) {
        // Just crossed the edge: keep protecting for a short grace period.
        inside = false;
        leaving = true;
        expire(Math.max(EXIT_GRACE, keepHoverDelay));
      } else if (!leaving) {
        bounds = null;
        if (blocked && timer === null) {
          // A vetoed native callback will not necessarily be scheduled again.
          // The outside-window timeout must not delay a return to page content.
          expire(keepHoverDelay);
        }
      }
      // else: leaving, grace timer already running; a return cancels it via hit.
    }
    function onLeave(event) {
      if (event.target !== document.documentElement || !event.isTrusted) return;
      if (
        !enabled() ||
        !(inside || leaving) ||
        !manager.sidebar?.hasAttribute("zen-has-hover")
      ) {
        reset();
        return;
      }
      inside = false;
      leaving = false;
      outside = true;
      // Bounded fallback on platforms without global mouse tracking. Native
      // tracker exit/deactivation can end this grace period earlier.
      expire(1500);
    }
    function setMovementListeners(value) {
      if (listening === value) return;
      listening = value;
      const method = value ? "addEventListener" : "removeEventListener";
      window[method]("mousemove", onMove, true);
      // Capture re-entry before Zen's once-only document mousemove callback.
      window[method]("mouseover", onMove, true);
      document.documentElement[method]("mouseleave", onLeave, true);
    }
    function refresh() {
      reset();
      configured =
        active &&
        Services.prefs.getBoolPref(PREF, false) &&
        manager.preference &&
        manager.canHideSidebar &&
        Services.prefs.getBoolPref(
          "zen.view.compact.show-sidebar-and-toolbar-on-hover",
          true,
        );
      keepHoverDelay = Math.max(
        0,
        Math.min(
          2000,
          Services.prefs.getIntPref(
            "zen.view.compact.sidebar-keep-hover.duration",
            0,
          ),
        ),
      );
      setMovementListeners(Boolean(configured));
    }
    function destroy() {
      if (!active) return;
      active = false;
      setMovementListeners(false);
      reset();
      for (const cleanup of cleanups.reverse()) cleanup();
    }
    try {
      wrap(
        "_setElementExpandAttribute",
        (original) =>
          function (element, value, attr = "zen-has-hover") {
            if (
              active &&
              element === this.sidebar &&
              value === false &&
              attr === "zen-has-hover"
            ) {
              if (
                enabled() &&
                element.hasAttribute(attr) &&
                (inside || outside || leaving)
              ) {
                blocked = true;
                return;
              }
              // A native hide already fulfilled any pending release. Do not hide
              // again later or retain stale geometry for the next reveal.
              reset(false);
            }
            return original.call(this, element, value, attr);
          },
      );
      // Explicit native cleanup must win over pointer continuity.
      for (const key of ["_collapseTrackedElement", "_clearAllHoverStates"]) {
        wrap(
          key,
          (original) =>
            function (...args) {
              if (active) reset();
              return original.apply(this, args);
            },
        );
      }
      for (const type of [
        "deactivate",
        "resize",
        "sizemodechange",
        "dragstart",
      ])
        listen(window, type, () => reset());
      listen(window, "ZenCompactMode:Toggled", refresh);
      listen(window, "unload", destroy);
      const observer = { observe: refresh };
      for (const pref of [
        PREF,
        "zen.view.compact",
        "zen.view.use-single-toolbar",
        "zen.tabs.vertical.right-side",
      ]) {
        Services.prefs.addObserver(pref, observer);
        cleanups.push(() => Services.prefs.removeObserver(pref, observer));
      }
      refresh();
      return destroy;
    } catch (error) {
      destroy();
      throw error;
    }
  }
  window.ZentralRuntime.register({ id: "compact-hover", init: start });
})();
