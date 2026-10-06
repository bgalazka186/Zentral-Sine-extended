/*
 * ZENTRAL FILE GUIDE - features/panels/corner-tiles/ZentralCornerPanels.uc.js
 *
 * Purpose: Creates Essential-tab corner tiles, panel linkage and background loading, manages linked Triple
 *   View pairs and tile input isolation.
 * Interaction / execution: Required panel part resumed by ZentralPanels. Uses BrowserIntegrations for
 *   hosts/activity, Toolbar for navigation and PanelStyles for browser enumeration; Notifications reads
 *   essentialPanels for badge updates.
 * Ownership / failure: Registers tile/events cleanup through ctx. Tile middle-click unload is distinct from
 *   ordinary tab unloading; do not select the underlying Essential tab while opening its panel.
 * Registration: corner-panels
 * Loaded/created by: core/ZentralCatalog.js
 * Published lazy ctx API: essentialPanels; linkedPairFor; linkedTriplePairs; loadEssentialInBackground;
 *   requestTileSync; saveEssentialSettings; saveLinkedTriplePairs; syncCornerTiles; unlinkTriplePair
 * Shared ctx symbols used: EXT_PREFS; clearTimeout; getActiveAppBrowser; getAllAppBrowsers;
 *   getMobileUaAppIds; getPanelContainerAssignments; getPref; registerCleanup; retryPanelTask;
 *   saveMobileUaAppIds; savePanelContainerAssignments; setTimeout; syncAppPanelBrowserActivity;
 *   togglePanelAudio
 * Cross-file calls / ctx suppliers: features/panels/browsers/ZentralBrowserIntegrations.uc.js -> ctx.getMobileUaAppIds,
 *   ctx.getPanelContainerAssignments, ctx.saveMobileUaAppIds, ctx.savePanelContainerAssignments,
 *   ctx.syncAppPanelBrowserActivity; features/panels/styling/ZentralPanelStyles.uc.js -> ctx.getAllAppBrowsers;
 *   features/panels/navigation/ZentralPanelToolbar.uc.js -> ctx.getActiveAppBrowser; features/panels/ZentralPanels.uc.js -> ctx.EXT_PREFS,
 *   ctx.clearTimeout, ctx.getPref, ctx.registerCleanup, ctx.setTimeout, ctx.togglePanelAudio
 * Literal DOM event subscriptions: auxclick; click; contextmenu; mousedown; pointerdown
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime;
  // Feature: corner-panels. Imports and exports are listed in ARCHITECTURE.md.
  // Preparation publishes functions; activation preserves the baseline initialization order.
  ZentralRuntime.registerPart("corner-panels", function* (ctx) {
    Object.defineProperties(ctx, {
      essentialPanels: { configurable: true, get: () => essentialPanels },
      linkedPairFor: { configurable: true, get: () => linkedPairFor },
      linkedTriplePairs: {
        configurable: true,
        get: () => linkedTriplePairs,
        set: (value) => {
          linkedTriplePairs = value;
        },
      },
      loadEssentialInBackground: {
        configurable: true,
        get: () => loadEssentialInBackground,
      },
      requestTileSync: { configurable: true, get: () => requestTileSync },
      saveEssentialSettings: {
        configurable: true,
        get: () => saveEssentialSettings,
      },
      saveLinkedTriplePairs: {
        configurable: true,
        get: () => saveLinkedTriplePairs,
      },
      syncCornerTiles: { configurable: true, get: () => syncCornerTiles },
      unlinkTriplePair: { configurable: true, get: () => unlinkTriplePair },
    });
    yield;
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
      if (!tile || !ctx.getPref(ctx.EXT_PREFS.AUDIO_INDICATOR, false)) return;
      const keyboard = event.type === "keydown" || event.type === "keyup";
      if (keyboard && event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (
        (event.type === "click" && event.button === 0) ||
        (event.type === "keydown" && !event.repeat)
      ) {
        const browser = ctx
          .getAllAppBrowsers()
          .find((b) => b._bgalazkaAppId === tile.dataset.appId);
        ctx.togglePanelAudio(browser);
      }
    };
    tileAudioEvents.forEach((type) =>
      window.addEventListener(type, onTileAudioInput, true),
    );
    ctx.registerCleanup(() =>
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
      root
        .querySelectorAll?.(".zen-app-tile[data-app-id]")
        .forEach(isolateTile);
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

    ctx.registerCleanup(() => {
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

    ctx.registerCleanup(() => {
      mmbEvents.forEach((type) => {
        window.removeEventListener(type, onWindowMMBCapture, { capture: true });
      });
    });

    // Essential duplicates have their own app identity/browser, but all panel
    // UI and behavior comes from Zentral's existing panel engine. Never move a
    // normal grid tile or create a second panel implementation.
    const essentialPanels = new Map();
    const essentialTabRecords = new WeakMap();
    let nextPreloadAt = 0;
    const pendingPreloads = new Set();
    function scheduleEssentialPreload(record) {
      record.preloadAttempted = true;
      const now = Date.now(),
        delay = Math.max(
          ctx.getPref(ctx.EXT_PREFS.SMART_SLEEP, true) ? 5000 : 0,
          nextPreloadAt - now,
        );
      nextPreloadAt = now + delay + 1500;
      const timer = ctx.setTimeout(() => {
        pendingPreloads.delete(timer);
        if (
          !record.tab.isConnected ||
          !record.app.preload ||
          essentialPanels.get(record.app.id) !== record ||
          !window.Zentral?.Core?.getPref(
            "zen.workspace.apps.sidebar.enabled",
            true,
          )
        ) {
          record.preloadAttempted = false;
          return;
        }
        try {
          loadEssentialInBackground(record);
        } catch (error) {
          console.warn("[Zentral] Essential preload failed", error);
        }
      }, delay);
      pendingPreloads.add(timer);
    }
    ctx.registerCleanup(() => {
      for (const timer of pendingPreloads) ctx.clearTimeout(timer);
      pendingPreloads.clear();
    });

    // Pair identities belong to the extension, not to the lifetime of a browser.
    const linkedTriplePref = "zen.workspace.bgalazka.linked_triple_pairs";
    let linkedTriplePairs = [];
    try {
      const saved = JSON.parse(ctx.getPref(linkedTriplePref, "[]"));
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
        const apps = JSON.parse(
          ctx.getPref("zen.workspace.apps.sidebar.apps", "[]"),
        );
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
      ctx.registerCleanup(() => {
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
      if (essentialSettingsCache.has(tab))
        return essentialSettingsCache.get(tab);
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
      if (
        !apps?.getOrCreateAppBrowser ||
        !document.getElementById("zen-app-panel-slider")
      )
        return false;
      const { browser, isNew } = apps.getOrCreateAppBrowser(record.app) || {};
      if (!browser) return false;
      if (isNew || browser.currentURI?.spec === "about:blank") {
        browser.style.display = "none";
        // This opt-in preload is meant to receive site notifications even
        // before the Essential tab itself is selected or restored.
        try {
          browser.docShellIsActive = true;
          if (browser.isRemoteBrowser) browser.renderLayers = false;
        } catch (_) {}
        const uri = Services.io.newURI(record.app.url);
        browser.fixupAndLoadURIString(record.app.url, {
          triggeringPrincipal:
            Services.scriptSecurityManager.createContentPrincipal(uri, {
              userContextId: record.userContextId,
            }),
        });
        record.loadedSource = record.app.url;
        let preloadStarted = false;
        ctx.retryPanelTask(browser, () => {
          if (!preloadStarted) { preloadStarted = true; return false; }
          if (
            !record.tab.isConnected ||
            !browser.isConnected ||
            browser.currentURI?.spec !== "about:blank" ||
            browser.webProgress?.isLoadingDocument
          )
            return true;
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
          return true;
        });
      }
      return true;
    }
    function promoteEssentialPanel(record) {
      const browser = ctx
        .getAllAppBrowsers()
        .find((b) => b._bgalazkaAppId === record.app.id);
      // A linked launcher must survive its tab even if Smart Sleep never
      // instantiated its browser. Promotion itself does not trigger a load.
      if (!browser && !linkedPairFor(record.app.id)) return false;
      const apps = window.Zentral?.Apps;
      // Keep the same app id: Zentral's private browser map, active panel,
      // browsing history, mute, pin and in-page form state all stay intact.
      apps.saveApps();
      const saved = JSON.parse(
        ctx.getPref("zen.workspace.apps.sidebar.apps", "[]"),
      );
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
      const assignments = ctx.getPanelContainerAssignments();
      if (record.userContextId > 0) assignments[app.id] = record.userContextId;
      ctx.savePanelContainerAssignments(assignments);
      const mobileIds = ctx.getMobileUaAppIds();
      if (record.mobileUa) mobileIds.add(app.id);
      else mobileIds.delete(app.id);
      ctx.saveMobileUaAppIds(mobileIds);
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
        ctx.getActiveAppBrowser()?._bgalazkaAppId === record.app.id
      ) {
        apps.closePanel();
        return;
      }
      const source = getEssentialSource(record.tab);
      const existing = ctx
        .getAllAppBrowsers()
        .find((b) => b._bgalazkaAppId === record.app.id);
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
        const enabled = ctx.getPref(ctx.EXT_PREFS.CORNER_TILES, false);
        const allTabs = ctx.getPref(ctx.EXT_PREFS.ALL_TAB_PANELS, false);
        const targets = new Set(
          (enabled || allTabs) &&
            window.Zentral?.Core?.getPref(
              "zen.workspace.apps.sidebar.enabled",
              true,
            )
            ? [...(window.gBrowser?.tabs || [])].filter(
                (tab) =>
                  tab.isConnected &&
                  !tab.closing &&
                  !tab.hasAttribute("bgalazka-addon-host") &&
                  !tab.hasAttribute("bgalazka-addon-host-fallback") &&
                  !tab.closest(
                    "#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']",
                  ) &&
                  (isEssentialPanelTab(tab) ? enabled : allTabs),
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
          ctx.getAllAppBrowsers().map((b) => [b._bgalazkaAppId, b]),
        );
        const root = document.getElementById("zen-app-panel-root");
        const active =
          root?.hasAttribute("open") && !root.hasAttribute("closing")
            ? ctx.getActiveAppBrowser()?._bgalazkaAppId
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
          if (record.app.preload && !record.preloadAttempted)
            scheduleEssentialPreload(record);
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
          if (!essential)
            tab.setAttribute("bgalazka-tab-panel-launcher", "true");
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
          syncEssentialBadge(record, panelBrowser);
          tile.dataset.tabLoaded = tabLoaded ? "true" : "false";
        }
        pruneIsolationTiles();
        ctx.syncAppPanelBrowserActivity?.();
        window.dispatchEvent(new CustomEvent("zentral-essential-tiles-changed"));
      } finally {
        isSyncingTiles = false;
      }
    }
    ctx.registerCleanup(() => {
      for (const [id, record] of essentialPanels) {
        window.Zentral?.Apps?.closeApp?.(id);
        releaseTabPanelLauncher(record);
      }
      essentialPanels.clear();
    });

    let syncTimer = null;
    function requestTileSync(delay = 120) {
      if (syncTimer) ctx.clearTimeout(syncTimer);
      syncTimer = ctx.setTimeout(syncCornerTiles, delay);
    }
    ctx.registerCleanup(() => {
      if (syncTimer) ctx.clearTimeout(syncTimer);
    });
  });
})();
