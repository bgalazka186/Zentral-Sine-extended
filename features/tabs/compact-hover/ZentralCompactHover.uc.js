/* Optional window-entry reveal. Native sidebar hover remains untouched. */
(function () {
  "use strict";
  const PREF = "zen.workspace.zentral.experimental.compact_sidebar_hover";
  const MARGIN_PREF=PREF+".edge_margin_px", GRACE_PREF=PREF+".exit_grace_ms";
  const RETURN_GRACE_MS=250, RECENT_EXIT_MS=1500;
  const ENTRY_PREF = "zen.workspace.zentral.experimental.compact_sidebar_hover.window_entry_reveal";
  const REPAIR_PREF = "zen.workspace.zentral.experimental.sidebar_startup_recalculate";
  const Services = globalThis.Services || ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
  function attachEntry() {
    const manager = window.gZenCompactModeManager;
    const root = document.documentElement;
    let timer = null, point = null, owned = false, exitAt = null, rightAtExit = false;
    const enabled = () => Services.prefs.getBoolPref(ENTRY_PREF, false) && manager.preference &&
      manager.canHideSidebar && !manager._ignoreNextHover &&
      Services.prefs.getBoolPref("zen.view.compact.show-sidebar-and-toolbar-on-hover", true);
    const bounds = node => window.windowUtils?.getBoundsWithoutFlushing?.(node) || node.getBoundingClientRect();
    const inside = (box,p) => p && p.clientX >= box.left && p.clientX <= box.right && p.clientY >= box.top && p.clientY <= box.bottom;
    function release() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null; point = null; exitAt = null;
      const hide = owned; owned = false;
      if (hide) manager._setElementExpandAttribute(manager.sidebar, false);
    }
    function enter(event, fallback = false) {
      if ((!fallback && event.target !== root) || !event.isTrusted || !enabled() || timer !== null ||
          manager._isTabBeingDragged || manager._hasHoveredUrlbar ||
          root.getAttribute("supress-primary-adjustment") === "true" ||
          (!fallback && event.relatedTarget && root.contains(event.relatedTarget))) return;
      const box = bounds(root), sidebar = manager.sidebar, side = bounds(sidebar), right = !!manager.sidebarIsOnRight;
      const recent = exitAt !== null && Date.now() - exitAt <= 1500 && rightAtExit === right;
      exitAt = null;
      if (!inside(box,event) || event.clientY <= box.top+10 || event.clientY >= box.bottom-10 ||
          event.clientY < side.top || event.clientY > side.bottom ||
          (Math.abs(event.clientX-(right?box.right:box.left))>10 &&
           !(recent && (right?event.clientX>=(box.left+box.right)/2:event.clientX<=(box.left+box.right)/2)))) return;
      manager.clearFlashTimeout?.("has-hover"+sidebar.id);
      const frame = manager._removeHoverFrames?.[sidebar.id];
      if (frame != null) window.cancelAnimationFrame(frame);
      owned = !sidebar.hasAttribute("zen-has-hover");
      if (owned) manager._setElementExpandAttribute(sidebar,true);
      point = {clientX:event.clientX,clientY:event.clientY};
      timer = window.setTimeout(() => {
        timer=null;
        const hide = owned && !inside(bounds(sidebar),point);
        owned=false;point=null;
        if (hide) manager._setElementExpandAttribute(sidebar,false);
      },250);
    }
    function move(event) {
      if (!event.isTrusted) return;
      if (exitAt !== null && inside(bounds(root),event)) enter(event,true);
      if (point) {point.clientX=event.clientX;point.clientY=event.clientY;}
    }
    function leave(event) {
      if (event.target !== root || !event.isTrusted || !enabled()) return;
      const box=bounds(root),right=!!manager.sidebarIsOnRight;
      exitAt=(right?event.clientX>=box.right-10:event.clientX<=box.left+10)?Date.now():null;
      rightAtExit=right;
    }
    root.addEventListener("mouseenter",enter,true);
    root.addEventListener("mouseleave",leave,true);
    window.addEventListener("mousemove",move,true);
    const resets=["deactivate","resize","sizemodechange","dragstart"];
    for(const type of resets)window.addEventListener(type,release,true);
    const destroy=()=>{
      release();root.removeEventListener("mouseenter",enter,true);root.removeEventListener("mouseleave",leave,true);
      window.removeEventListener("mousemove",move,true);
      for(const type of resets)window.removeEventListener(type,release,true);
    };
    destroy.manager=manager;destroy.refresh=release;
    return destroy;
  }
  function attachStabilizer() {
    const manager = window.gZenCompactModeManager;
    if (typeof manager?._setElementExpandAttribute !== "function")
      throw new Error(
        "Compact hover guard requires Zen's native compact manager",
      );
    // Tunables for edge wiggle tolerance.
    let edgeMargin = 12; // px of tolerance around the visible bounds
    let exitGrace = 250; // ms before a real exit is allowed to hide
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
    let entryListening = false,
      entryRevealed = false,
      returning = false,
      returnTimer = null,
      returnPoint = null;
    let exitAt = null,
      exitWindowBox = null,
      exitOnRight = false;
    let frameBounds = null,
      boundsFrame = null;
    const cleanups = [];
    const hookCleanups = [];
    let hooksInstalled = false;
    let refreshFrame = null;
    let configuredSidebar = null,
      configuredRight = false;
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
      if (returnTimer !== null) window.clearTimeout(returnTimer);
      returnTimer = null;
      returnPoint = null;
      returning = false;
      const hadBlocked = blocked || entryRevealed;
      entryRevealed = false;
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
      hookCleanups.push(() => {
        if (manager[key] !== wrapper) return; // Another mod may wrap ours later.
        if (own) Object.defineProperty(manager, key, own);
        else delete manager[key];
      });
    }
    function listen(target, type, callback) {
      target.addEventListener(type, callback, true);
      cleanups.push(() => target.removeEventListener(type, callback, true));
    }
    function clearEntryExit() {
      exitAt = null;
      exitWindowBox = null;
    }
    function rememberEntryExit(event) {
      clearEntryExit();
      if (!entryListening || !enabled() || !manager.sidebar) return;
      const root = document.documentElement;
      const windowBox = window.windowUtils?.getBoundsWithoutFlushing
        ? window.windowUtils.getBoundsWithoutFlushing(root)
        : root.getBoundingClientRect();
      const box = readBounds(manager.sidebar);
      const right = Boolean(manager.sidebarIsOnRight);
      const crossedSide = right
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
      exitAt = Date.now();
      exitWindowBox = windowBox;
      exitOnRight = right;
    }
    function onWindowEnter(event, fallback = false) {
      const root = document.documentElement;
      const sidebar = manager.sidebar;
      // Root entry only: ordinary movement over sidebar controls never reveals.
      // Child mouseenter events are also captured here, so reject their targets.
      if (
        (!fallback && event.target !== root) ||
        !event.isTrusted ||
        !entryListening ||
        !enabled() ||
        !sidebar ||
        returning ||
        (!fallback &&
          event.relatedTarget &&
          root.contains(event.relatedTarget)) ||
        manager._isTabBeingDragged ||
        manager._hasHoveredUrlbar ||
        root.getAttribute("supress-primary-adjustment") === "true"
      )
        return;
      const windowBox = window.windowUtils?.getBoundsWithoutFlushing
        ? window.windowUtils.getBoundsWithoutFlushing(root)
        : root.getBoundingClientRect();
      const box = readBounds(sidebar);
      const right = Boolean(manager.sidebarIsOnRight);
      const recentExit =
        exitAt !== null &&
        Date.now() - exitAt <= RECENT_EXIT_MS &&
        exitOnRight === right;
      clearEntryExit(); // One return attempt, never an inside hover trigger.
      const side = right ? "right" : "left";
      const matchingHalf = right
        ? event.clientX >= (windowBox.left + windowBox.right) / 2
        : event.clientX <= (windowBox.left + windowBox.right) / 2;
      // A recent side exit explains a fast return whose first sample lands
      // deeper inside. Otherwise retain the boundary-only trigger.
      if (
        !contains(windowBox, event) ||
        (Math.abs(event.clientX - windowBox[side]) > 10 &&
          !(recentExit && matchingHalf)) ||
        event.clientY <= windowBox.top + 10 ||
        event.clientY >= windowBox.bottom - 10 ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      )
        return;
      // Zen 1.23.3b skips onEnter cleanup when we already set zen-has-hover.
      // A real return supersedes hide work scheduled for the previous exit.
      manager.clearFlashTimeout?.("has-hover" + sidebar.id);
      const removeFrame = manager._removeHoverFrames?.[sidebar.id];
      if (removeFrame != null) window.cancelAnimationFrame(removeFrame);
      invalidateBounds();
      cancelTimer();
      inside = outside = leaving = false;
      bounds = null;
      returning = true;
      returnPoint = { clientX: event.clientX, clientY: event.clientY };
      if (!sidebar.hasAttribute("zen-has-hover")) {
        manager._setElementExpandAttribute(sidebar, true);
        entryRevealed = sidebar.hasAttribute("zen-has-hover");
      }
      if (!sidebar.hasAttribute("zen-has-hover")) {
        reset(false);
        return;
      }
      // One bounded timeout per crossing; animation can finish before the
      // final hit-test. No polling, outside tracker, or repeated timer restarts.
      returnTimer = window.setTimeout(
        () => {
          returnTimer = null;
          returning = false;
          const point = returnPoint;
          returnPoint = null;
          if (!enabled() || !sidebar.hasAttribute("zen-has-hover")) {
            reset();
            return;
          }
          const visibleBox = readBounds(sidebar);
          if (point && contains(visibleBox, point)) {
            inside = true;
            leaving = false;
            bounds = visibleBox;
          } else {
            reset();
          }
        },
        Math.max(RETURN_GRACE_MS, keepHoverDelay),
      );
    }
    function setEntryListener(value) {
      if (entryListening === value) return;
      entryListening = value;
      if (!value) clearEntryExit();
      document.documentElement[
        value ? "addEventListener" : "removeEventListener"
      ]("mouseenter", onWindowEnter, true);
    }
    function onMove(event) {
      if (!event.isTrusted) return;
      if (!enabled()) {
        reset();
        return;
      }
      // Reuse the existing guard listener: only a null check when not armed.
      if (exitAt !== null && contains(exitWindowBox, event)) {
        onWindowEnter(event, true);
        clearEntryExit();
      }
      if (returning) {
        // The bounded return timer owns protection while the sidebar animates.
        // Update two numbers only; no layout reads or per-event allocation.
        returnPoint.clientX = event.clientX;
        returnPoint.clientY = event.clientY;
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
      const ref = (wasOutside || leaving) && bounds ? bounds : box;
      // Margin only applies once the pointer was already inside/leaving, so it
      // never makes the sidebar easier to trigger from far away.
      const hit = contains(
        ref,
        event,
        inside || leaving || wasOutside ? edgeMargin : 0,
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
        expire(Math.max(exitGrace, keepHoverDelay));
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
      // Native visibility cleanup must not erase recent crossing evidence.
      rememberEntryExit(event);
      if (
        !enabled() ||
        !(inside || leaving || returning) ||
        !manager.sidebar?.hasAttribute("zen-has-hover")
      ) {
        reset();
        return;
      }
      if (returnTimer !== null) window.clearTimeout(returnTimer);
      returnTimer = null;
      returnPoint = null;
      returning = false;
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
    function refreshTunables() {
      // Preference reads stay outside the pointer-event path. Updating sliders
      // affects the next hit-test/exit without restarting an active grace timer.
      edgeMargin = Math.max(
        0,
        Math.min(64, Services.prefs.getIntPref(MARGIN_PREF, 12)),
      );
      exitGrace = Math.max(
        0,
        Math.min(2000, Services.prefs.getIntPref(GRACE_PREF, 250)),
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
    }
    function refresh() {
      const nextConfigured = Boolean(
        active &&
        Services.prefs.getBoolPref(PREF, false) &&
        manager.preference &&
        manager.canHideSidebar &&
        Services.prefs.getBoolPref(
          "zen.view.compact.show-sidebar-and-toolbar-on-hover",
          true,
        ),
      );
      const nextEntry = false; // Window entry is controlled independently.
      const nextRight = Boolean(manager.sidebarIsOnRight);
      // Window activation may follow the crossing event. Rechecking an unchanged
      // setup must preserve both the recorded exit and the brief return guard.
      if (
        configured !== nextConfigured ||
        entryListening !== nextEntry ||
        configuredSidebar !== manager.sidebar ||
        configuredRight !== nextRight
      ) {
        clearEntryExit();
        reset();
      }
      configured = nextConfigured;
      configuredSidebar = manager.sidebar;
      configuredRight = nextRight;
      refreshTunables();
      setHooks(configured);
      setMovementListeners(configured);
      setEntryListener(nextEntry);
    }
    function refreshAfterNative() {
      refresh(); // Master-off remains immediate.
      if (refreshFrame !== null) window.cancelAnimationFrame(refreshFrame);
      refreshFrame = null;
      if (!active || !Services.prefs.getBoolPref(PREF, false)) return;
      refreshFrame = window.requestAnimationFrame(() => {
        refreshFrame = null;
        if (active) refresh();
      });
    }
    function destroy() {
      if (!active) return;
      active = false;
      if (refreshFrame !== null) window.cancelAnimationFrame(refreshFrame);
      refreshFrame = null;
      setMovementListeners(false);
      setEntryListener(false);
      reset();
      setHooks(false);
      for (const cleanup of cleanups.reverse()) cleanup();
    }
    function setHooks(value) {
      if (hooksInstalled === value) return;
      hooksInstalled = value;
      if (!value) {
        for (const cleanup of hookCleanups.splice(0).reverse()) cleanup();
        return;
      }
      wrap(
        "_setElementExpandAttribute",
        (original) =>
          function (element, value, attr = "zen-has-hover") {
            if (
              active &&
              configured &&
              element === this.sidebar &&
              value === false &&
              attr === "zen-has-hover"
            ) {
              if (
                enabled() &&
                element.hasAttribute(attr) &&
                (inside || outside || leaving || returning)
              ) {
                blocked = true;
                return;
              }
              // A native hide already fulfilled any pending release. Do not hide
              // again later or retain stale geometry for the next reveal.
              reset(false);
            }
            // Native hover now expands synchronously, potentially in the same
            // frame as a hidden-sidebar measurement from a crossing event.
            if (active && configured && element === this.sidebar && value && attr === "zen-has-hover" &&
                !element.hasAttribute(attr)) invalidateBounds();
            return original.call(this, element, value, attr);
          },
      );
      // Explicit native cleanup must win over pointer continuity.
      for (const key of ["_collapseTrackedElement", "_clearAllHoverStates"]) {
        wrap(
          key,
          (original) =>
            function (...args) {
              // A tracker for the toolbar (or no tracker) owns no sidebar state.
              if (active && configured &&
                  (key === "_clearAllHoverStates" ||
                   this._outsideTrackedElement === this.sidebar)) reset();
              return original.apply(this, args);
            },
        );
      }
      const onReset = () => {
        clearEntryExit();
        reset();
      };
      for (const type of [
        "deactivate",
        "resize",
        "sizemodechange",
        "dragstart",
      ]) {
        window.addEventListener(type, onReset, true);
        hookCleanups.push(() =>
          window.removeEventListener(type, onReset, true),
        );
      }
    }
    try {
      listen(window, "ZenCompactMode:Toggled", refreshAfterNative);
      listen(window, "ZenCompactMode:LayoutUpdate", refreshAfterNative);
      listen(window, "unload", destroy);
      const refreshPrefs = new Set([
        PREF,
        ENTRY_PREF,
        "zen.view.compact",
        "zen.view.use-single-toolbar",
        "zen.tabs.vertical.right-side",
        "zen.view.compact.show-sidebar-and-toolbar-on-hover",
        "zen.view.compact.hide-tabbar",
      ]);
      // Preference observers match prefixes. Ignore panel-only settings and
      // sliders here, so changing them does not collapse a protected sidebar.
      const observer = {
        observe(subject, topic, pref) {
          if (refreshPrefs.has(pref)) refreshAfterNative();
        },
      };
      for (const pref of [
        PREF,
        "zen.view.compact",
        "zen.view.use-single-toolbar",
        "zen.tabs.vertical.right-side",
      ]) {
        Services.prefs.addObserver(pref, observer);
        cleanups.push(() => Services.prefs.removeObserver(pref, observer));
      }
      const tunablesObserver = { observe: refreshTunables };
      for (const pref of [
        MARGIN_PREF,
        GRACE_PREF,
        "zen.view.compact.sidebar-keep-hover.duration",
      ]) {
        Services.prefs.addObserver(pref, tunablesObserver);
        cleanups.push(() =>
          Services.prefs.removeObserver(pref, tunablesObserver),
        );
      }
      refreshAfterNative();
      destroy.refresh = refreshAfterNative;
      destroy.manager = manager;
      return destroy;
    } catch (error) {
      destroy();
      throw error;
    }
  }
  function attach() {
    const guardOn=Services.prefs.getBoolPref(PREF,false), entryOn=Services.prefs.getBoolPref(ENTRY_PREF,false);
    const guard=guardOn?attachStabilizer():null, entry=entryOn?attachEntry():null;
    const destroy=()=>{entry?.();guard?.();};
    destroy.manager=window.gZenCompactModeManager;
    destroy.guardOn=guardOn;destroy.entryOn=entryOn;
    destroy.refresh=()=>{guard?.refresh();};
    return destroy;
  }
  function start() {
    let stopped = false,
      cleanup = null,
      task = null,
      watching = false;
    const root = document.documentElement;
    let repairFrame = null,
      repairTimer = null,
      restoreTimer = null,
      repairDone = false,
      restoreRepair = null;
    const repairStatus = (stage) => {
      window.ZentralRuntime.sidebarLayoutRepair = { stage };
    };
    function cancelRepair() {
      if (repairTimer !== null) window.clearTimeout(repairTimer);
      repairTimer = null;
      if (repairFrame !== null) window.cancelAnimationFrame(repairFrame);
      repairFrame = null;
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      restoreTimer = null;
      const restore = restoreRepair;
      restoreRepair = null;
      restore?.();
    }
    function syncRepair() {
      if (stopped || !Services.prefs.getBoolPref(REPAIR_PREF, false)) {
        cancelRepair();
        repairStatus(stopped ? "stopped" : "disabled");
        return;
      }
      if (repairDone || repairFrame !== null || repairTimer !== null) return;
      const delay =
        Math.max(
          0,
          Math.min(
            60,
            Services.prefs.getIntPref(REPAIR_PREF + ".delay_seconds", 0),
          ),
        ) * 1000;
      repairStatus(
        "scheduled: waiting " + delay + " ms before sidebar expansion",
      );
      repairTimer = window.setTimeout(() => {
        repairTimer = null;
        if (stopped || !Services.prefs.getBoolPref(REPAIR_PREF, false)) return;
        const sidebar =
          document.getElementById("navigator-toolbox") ||
          window.gZenCompactModeManager?.sidebar;
        const width = sidebar?.isConnected
          ? sidebar.getBoundingClientRect().width
          : 0;
        const tune = (suffix, fallback, min, max) =>
          Math.max(
            min,
            Math.min(
              max,
              Services.prefs.getIntPref(REPAIR_PREF + "." + suffix, fallback),
            ),
          );
        const targetWidth = tune("target_width_px", 400, 200, 2000);
        const extraWidth = tune("extra_width_px", 100, 50, 1200);
        const holdMs = tune("hold_ms", 100, 50, 5000);
        const verificationFrames = tune("verification_frames", 2, 1, 10);
        const expanded = Math.floor(
          Math.min(
            window.innerWidth - 40,
            Math.max(targetWidth, width + extraWidth),
          ),
        );
        if (!sidebar?.style || !(width > 0) || expanded <= width + 32) {
          repairDone = true;
          repairStatus(
            "skipped: sidebar unavailable or insufficient room to expand",
          );
          return;
        }
        const value = expanded + "px",
          snapshots = [];
        const hadWidthAttribute = sidebar.hasAttribute("width");
        const previousWidthAttribute = sidebar.getAttribute("width");
        let expansionObserved = false;
        const notifyNativeResize = () => {
          // ZenCustomizableUI.#initSidebarResizer updates width + its native
          // attribute, then dispatches this event. CSS expansion alone does not
          // run the same workspace/toolbar calculations as dragging the divider.
          sidebar.getBoundingClientRect(); // Make the new width measurable now.
          window.dispatchEvent(new window.Event("resize"));
        };
        const change = (node, key, temporary) => {
          const previous = node.style.getPropertyValue(key),
            priority = node.style.getPropertyPriority(key);
          snapshots.push({ node, key, temporary, previous, priority });
          node.style.setProperty(key, temporary, "important");
        };
        const finish = () => {
          if (repairFrame !== null) window.cancelAnimationFrame(repairFrame);
          repairFrame = null;
          if (restoreTimer !== null) window.clearTimeout(restoreTimer);
          restoreTimer = null;
          const restore = restoreRepair;
          restoreRepair = null;
          restore?.();
        };
        restoreRepair = () => {
          repairDone = true;
          if (!expansionObserved && sidebar.isConnected)
            expansionObserved =
              sidebar.getBoundingClientRect().width > width + 32;
          // Native/user changes made during the refresh win over our snapshot.
          for (const {
            node,
            key,
            temporary,
            previous,
            priority,
          } of snapshots.reverse()) {
            if (
              node.style.getPropertyValue(key) !== temporary ||
              node.style.getPropertyPriority(key) !== "important"
            )
              continue;
            if (previous) node.style.setProperty(key, previous, priority);
            else node.style.removeProperty(key);
          }
          if (sidebar.getAttribute("width") === value) {
            if (hadWidthAttribute)
              sidebar.setAttribute("width", previousWidthAttribute);
            else sidebar.removeAttribute("width");
          }
          if (!stopped && sidebar.isConnected) notifyNativeResize();
          repairStatus(
            expansionObserved
              ? "completed: native sidebar resize cycle and previous width restored"
              : "not applied: browser styles prevented sidebar expansion",
          );
        };
        try {
          // Match Zen's manual setWidth path, retaining temporary constraints
          // only to provide enough space for the configured expansion.
          change(sidebar, "--zen-sidebar-width", value);
          change(sidebar, "width", value);
          // Expansion cannot hit the current minimum. Only lift a maximum
          // when necessary; avoid extra constraint writes for the small default.
          const maxWidth = parseFloat(
            sidebar.style.getPropertyValue("max-width"),
          );
          if (!Number.isFinite(maxWidth) || maxWidth < expanded)
            change(sidebar, "max-width", value);
          sidebar.setAttribute("width", value);
          notifyNativeResize();
          const verifyExpansion = (remaining) => {
            repairFrame = window.requestAnimationFrame(() => {
              if (remaining > 1) {
                verifyExpansion(remaining - 1);
                return;
              }
              repairFrame = null;
              const measured = sidebar.getBoundingClientRect().width;
              expansionObserved = measured > width + 32;
              if (!expansionObserved) {
                finish();
                repairStatus(
                  "not applied: browser styles prevented sidebar expansion",
                );
              }
            });
          };
          verifyExpansion(verificationFrames);
          // One bounded hold allows native overflow work to settle at the wide
          // size. Also restores when animation frames are suspended. No polling.
          restoreTimer = window.setTimeout(finish, holdMs);
        } catch (error) {
          finish();
          repairStatus("sidebar expansion failed: " + error);
        }
      }, delay);
    }

    function reconcile() {
      task = null;
      if (stopped || !(Services.prefs.getBoolPref(ENTRY_PREF, false) || Services.prefs.getBoolPref(PREF,false))) return;
      const manager = window.gZenCompactModeManager;
      if (cleanup && (cleanup.manager !== manager ||
          cleanup.guardOn !== Services.prefs.getBoolPref(PREF,false) ||
          cleanup.entryOn !== Services.prefs.getBoolPref(ENTRY_PREF,false))) {
        cleanup();
        cleanup = null;
      }
      if (cleanup) {
        cleanup.refresh();
        return;
      }
      if (
        typeof manager?._setElementExpandAttribute !== "function" ||
        !manager.sidebar
      )
        return;
      cleanup = attach();
    }
    function queueReconcile() {
      if (stopped || !watching || task !== null) return;
      task = window.setTimeout(reconcile, 0);
    }
    const hostObserver = new MutationObserver(queueReconcile);
    const hostEvents = [
      "ZenCompactMode:Toggled",
      "ZenCompactMode:LayoutUpdate",
      "activate",
      "aftercustomization",
    ];
    function syncWatching() {
      const value = !stopped && (Services.prefs.getBoolPref(ENTRY_PREF, false) || Services.prefs.getBoolPref(PREF,false));
      if (watching !== value) {
        watching = value;
        const method = value ? "addEventListener" : "removeEventListener";
        for (const type of hostEvents) window[method](type, queueReconcile);
        hostObserver.disconnect();
        if (value)
          hostObserver.observe(root, {
            attributes: true,
            attributeFilter: [
              "zen-compact-mode",
              "zen-sidebar-collapsed",
              "zen-right-side",
              "zen-sidebar-right",
              // canHideSidebar also depends on Zen's late single-toolbar layout.
              "zen-single-toolbar",
              "zen-sidebar-expanded",
            ],
          });
      }
      if (!value && task !== null) {
        window.clearTimeout(task);
        task = null;
      }
      if (!value && cleanup) {
        cleanup();
        cleanup = null;
      }
      if (value) reconcile();
    }
    const observer = {
      observe(subject, topic, pref) {
        if (pref === ENTRY_PREF || pref === PREF) syncWatching();
        if (pref === REPAIR_PREF) syncRepair();
        if (pref === REPAIR_PREF + ".delay_seconds" && repairTimer !== null) {
          window.clearTimeout(repairTimer);
          repairTimer = null;
          syncRepair();
        }
      },
    };
    function destroy() {
      if (stopped) return;
      stopped = true;
      cancelRepair();
      syncWatching();
      cleanup?.();
      cleanup = null;
      Services.prefs.removeObserver(ENTRY_PREF, observer);
      Services.prefs.removeObserver(PREF, observer);
      Services.prefs.removeObserver(REPAIR_PREF, observer);
      window.removeEventListener("unload", destroy);
    }
    Services.prefs.addObserver(ENTRY_PREF, observer);
    Services.prefs.addObserver(PREF, observer);
    Services.prefs.addObserver(REPAIR_PREF, observer);
    window.addEventListener("unload", destroy, { once: true });
    try {
      syncWatching();
      syncRepair();
    } catch (error) {
      destroy();
      throw error;
    }
    return destroy;
  }
  window.ZentralRuntime.register({ id: "compact-hover", init: start });
})();
