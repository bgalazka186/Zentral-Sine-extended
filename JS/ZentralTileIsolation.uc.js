"use strict";
// The extension initializes this after the base Apps hooks are ready.
(function () {
  const sources = (window.ZentralFeatureSources ||= Object.create(null));
  sources.tileIsolation = function initTileIsolation({ getPref, EXT_PREFS,
    getAllAppBrowsers, togglePanelAudio, registerCleanup }) {
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
    return { isolateTile, pruneIsolationTiles };
  };
})();
