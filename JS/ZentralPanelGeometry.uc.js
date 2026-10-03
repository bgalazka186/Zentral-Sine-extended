(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime;
  // Feature: geometry. Imports and exposed are listed in ARCHITECTURE.md.
  // Preparation publishes functions; activation preserves the baseline initialization order.
  ZentralRuntime.registerPart("geometry", function* (ctx) {
    Object.defineProperties(ctx, {
      PANEL_HORIZONTAL_OFFSET_PREF: {
        configurable: true,
        get: () => PANEL_HORIZONTAL_OFFSET_PREF,
      },
      applyHorizontalPanelOffset: {
        configurable: true,
        get: () => applyHorizontalPanelOffset,
      },
      applyVerticalResizeExtras: {
        configurable: true,
        get: () => applyVerticalResizeExtras,
      },
      cachedHorizontalOffset: {
        configurable: true,
        get: () => cachedHorizontalOffset,
        set: (value) => {
          cachedHorizontalOffset = value;
        },
      },
      ensurePillGrabberVerticalDrag: {
        configurable: true,
        get: () => ensurePillGrabberVerticalDrag,
      },
      ensureVerticalResizeHandles: {
        configurable: true,
        get: () => ensureVerticalResizeHandles,
      },
      getAppliedHorizontalOffset: {
        configurable: true,
        get: () => getAppliedHorizontalOffset,
      },
      getHorizontalOffsetBounds: {
        configurable: true,
        get: () => getHorizontalOffsetBounds,
      },
      getHorizontalOffsetPreference: {
        configurable: true,
        get: () => getHorizontalOffsetPreference,
      },
      hPosDragState: {
        configurable: true,
        get: () => hPosDragState,
        set: (value) => {
          hPosDragState = value;
        },
      },
      hResizeState: {
        configurable: true,
        get: () => hResizeState,
        set: (value) => {
          hResizeState = value;
        },
      },
      startPanelHorizontalPositionDrag: {
        configurable: true,
        get: () => startPanelHorizontalPositionDrag,
      },
      startPanelPositionDrag: {
        configurable: true,
        get: () => startPanelPositionDrag,
      },
      vPosDragState: {
        configurable: true,
        get: () => vPosDragState,
        set: (value) => {
          vPosDragState = value;
        },
      },
    });
    yield;
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
    let cachedTopExtra = ctx.getPref(
      PANEL_TOP_EXTRA_PREF,
      DEFAULT_PANEL_VERTICAL_EXTRA_PX,
    );
    let cachedBottomExtra = ctx.getPref(
      PANEL_BOTTOM_EXTRA_PREF,
      DEFAULT_PANEL_VERTICAL_EXTRA_PX,
    );
    let cachedPosOffset = ctx.getPref(PANEL_POSITION_OFFSET_PREF, 0);
    let cachedHorizontalOffset = ctx.getPref(PANEL_HORIZONTAL_OFFSET_PREF, 0);
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
          prefKey === PANEL_TOP_EXTRA_PREF ||
          prefKey === PANEL_BOTTOM_EXTRA_PREF
            ? DEFAULT_PANEL_VERTICAL_EXTRA_PX
            : 0;
        setCache(ctx.getPref(prefKey, fallback));
        applyVerticalResizeExtras(
          document.getElementById("zen-app-panel-root"),
        );
        applyHorizontalPanelOffset(
          document.getElementById("zen-app-panel-root"),
        );
      };
      try {
        Services.prefs.addObserver(prefKey, observer, false);
        ctx.registerCleanup(() => {
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
      ctx.setPref(PANEL_TOP_EXTRA_PREF, cachedTopExtra);
      ctx.setPref(PANEL_BOTTOM_EXTRA_PREF, cachedBottomExtra);
    }

    function getPositionOffset() {
      return cachedPosOffset;
    }

    function savePositionOffset(px) {
      cachedPosOffset = Math.round(px);
      ctx.setPref(PANEL_POSITION_OFFSET_PREF, cachedPosOffset);
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
      const bounds = window.ZentralRuntime?.sidebarSafeBounds?.() || {
        left: 0,
        right: window.innerWidth,
      };
      return {
        min: appliedOffset + bounds.left - left,
        max: appliedOffset + (bounds.right - right),
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
        document.documentElement.getAttribute(
          "bgalazka-edge-attached-panels",
        ) === "true";
      const anchorSide = getHorizontalAnchorSide(root);
      if (dualViewActive || edgeAttachedPanels) {
        const edgeMargin =
          dualViewActive && !edgeAttachedPanels ? "-12px" : "0px";
        const leftMargin = anchorSide === "left" ? edgeMargin : "0px";
        const rightMargin = anchorSide === "right" ? edgeMargin : "0px";
        if (root.style.marginLeft !== leftMargin)
          root.style.marginLeft = leftMargin;
        if (root.style.marginRight !== rightMargin)
          root.style.marginRight = rightMargin;
        root._bgalazkaAppliedHorizontalOffset =
          dualViewActive && !edgeAttachedPanels
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
    // Locked modes ignore offsets: refuse gestures instead of editing hidden saved geometry.
    function panelGeometryLocked() {
      const ui = document.documentElement;
      return (
        ui.getAttribute("bgalazka-push-page") === "true" ||
        ui.getAttribute("bgalazka-edge-attached-panels") === "true"
      );
    }

    function startPanelHorizontalPositionDrag(e, startX = e.clientX) {
      if (panelGeometryLocked()) return;
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
        ctx.setPref(PANEL_HORIZONTAL_OFFSET_PREF, cachedHorizontalOffset);
      }
      hPosDragState = null;
    }
    ctx.registerCleanup(() => {
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
      const value = ctx.getPref(PILL_POSITION_PREF, 0);
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
      document.documentElement.setAttribute(
        "bgalazka-pill-pos-dragging",
        "true",
      );
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
        ctx.setPref(
          PILL_POSITION_PREF,
          Math.round(pillPosDragState.livePosition),
        );
      pillPosDragState = null;
    }
    ctx.registerCleanup(() => {
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
        document.documentElement.getAttribute(
          "bgalazka-edge-attached-panels",
        ) === "true";
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
          const navbar = document.getElementById(
            "zen-appcontent-navbar-wrapper",
          );
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
        if (root.style.marginTop !== topMargin)
          root.style.marginTop = topMargin;
        if (root.style.marginBottom !== bottomMargin)
          root.style.marginBottom = bottomMargin;
        return;
      }

      const { top: resizeTop, bottom: resizeBottom } = vResizeState
        ? {
            top: vResizeState.liveExtraTop,
            bottom: vResizeState.liveExtraBottom,
          }
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
    ctx.registerCleanup(() => {
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
      if (panelGeometryLocked()) return;
      if (e.button !== 0) return;
      if (!ctx.getPref(ctx.EXT_PREFS.ALL_SIDES_RESIZE, false)) return;
      const root = document.getElementById("zen-app-panel-root");
      if (!root) return;
      ctx.extendHoverResizeHold();
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
      ctx.extendHoverResizeHold();
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
    ctx.registerCleanup(() => {
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
        applyHorizontalPanelOffset(
          document.getElementById("zen-app-panel-root"),
        );
      }
    }

    function startHorizontalResize(e, edge) {
      if (e.button !== 0) return;
      if (
        edge !== "pill" &&
        !ctx.getPref(ctx.EXT_PREFS.ALL_SIDES_RESIZE, false)
      )
        return;
      const apps = window.Zentral?.Apps;
      const root = document.getElementById("zen-app-panel-root");
      if (!apps || !root || typeof apps.updateWidthVar !== "function") return;
      ctx.extendHoverResizeHold();
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
      if (panelGeometryLocked() && physicalEdge === anchorSide) return;
      ctx.extendHoverResizeHold();
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
            ctx.getPref(ctx.EXT_PREFS.OPPOSITE_DOCKING, false) ||
              apps.isPlacementVerticalBar?.()
              ? ctx.computeOppositeDockingSafeMaxWidth()
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
      ctx.extendHoverResizeHold();
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
        physicalEdge === "left"
          ? startRight - nextWidth
          : startLeft + nextWidth;
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
          ctx.setPref(PANEL_HORIZONTAL_OFFSET_PREF, cachedHorizontalOffset);
        }
        hResizeState = null;
      }
    }
    ctx.registerCleanup(() => {
      if (hResizeFrame) cancelAnimationFrame(hResizeFrame);
      document.removeEventListener("mousemove", onHorizontalResizeDrag);
      document.removeEventListener("mouseup", stopHorizontalResizeDrag);
    });

    function startCornerResize(e, verticalEdge, horizontalEdge) {
      if (!ctx.getPref(ctx.EXT_PREFS.ALL_SIDES_RESIZE, false)) return;
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
      if (panelGeometryLocked()) return;
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
        ctx.setPref(PANEL_HORIZONTAL_OFFSET_PREF, cachedHorizontalOffset);
      }
      vPosDragState = null;
    }
    ctx.registerCleanup(() => {
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
          document.documentElement.removeAttribute(
            "bgalazka-pill-drag-feedback",
          );
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
            ctx.setTimeout(
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
          ctx.safeCall(
            () =>
              startPillPositionDrag(moveEvt, activationY, getPillPosition()),
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
  });
})();
