/*
 * ZENTRAL FILE GUIDE - extension/panels/secondary-views/ZentralSecondaryViews.uc.js
 *
 * Purpose: Optional Triple View/Super Pin secondary browser shells and associated toolbar/geometry
 *   synchronization.
 * Interaction / execution: Optional generator part resumed late by ZentralPanels after BrowserIntegrations,
 *   CornerPanels, PanelStyles and Toolbar. Uses the same panel ctx and Apps owner.
 * Ownership / failure: Owns secondary browser/control cleanup through ctx. Omission disables secondary
 *   views; required extended-panel internals still need the coordinator and Apps.
 * Registration: secondary-views
 * Loaded/created by: loader/ZentralCatalog.js
 * Contract fields assigned here: ctx.healSecondaryPanel; ctx.openStartupSinglePanel; ctx.recreateLoadedPanels;
 *   ctx.scheduleSecondaryGeometryFit; ctx.secondaryContentReady; ctx.syncSecondaryFallbackPolling; ctx.syncSecondaryToolbarPreferences; ctx.updateSecondaryFallbackState
 * Literal DOM event subscriptions: blur; click; keydown; lostpointercapture; pointercancel; pointerdown;
 *   pointermove; pointerup
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
  // Feature: secondary-views. Imports and exports are listed in ARCHITECTURE.md.
  // Preparation publishes functions; activation preserves the baseline initialization order.
  ZentralRuntime.registerPart("secondary-views", function* (ctx) {
    Object.defineProperties(ctx, {});
    yield;
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
        pollUpdate: null,
        secondToolbarCleanup: null,
        resizeCleanup: null,
        geometryObserver: null,
        share: 0.5,
        dividerHandle: null,
        handleFrame: null,
        pair: null,
        secondURL: null,
        notesOpen: null,
      };
      ctx.secondarySnapshot = () => ({
        mode: state.mode,
        root: state.shell,
        browser: state.second,
        primary: state.first,
      });
      ctx.registerCleanup(() => {
        delete ctx.secondarySnapshot;
      });
      const slider = () => document.getElementById("zen-app-panel-slider");
      const root = () => document.getElementById("zen-app-panel-root");
      const isOpen = () =>
        root()?.hasAttribute("open") && !root()?.hasAttribute("closing");
      const active = () => {
        if (state.mode && state.first?.isConnected) return state.first;
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
            ctx.getPref("zen.workspace.apps.sidebar.apps", "[]"),
          );
          return Array.isArray(list) ? list : [];
        } catch (_) {
          return [];
        }
      }
      function hasStoredEssentialTab(id) {
        if (!id || !id.startsWith("bgalazka-essential-")) return false;
        const tabs =
          window.gZenWorkspaces?.allStoredTabs ?? window.gBrowser?.tabs ?? [];
        const ss = window.SessionStore;
        for (const tab of tabs) {
          if (!tab?.isConnected || tab.closing) continue;
          try {
            const raw = ss?.getCustomTabValue?.(tab, "bgalazka-panel-settings");
            if (raw && JSON.parse(raw)?.panelId === id) return true;
          } catch (_) {}
        }
        return false;
      }
      function resolvePairApp(pair, id, { promoteMissing = true } = {}) {
        const tabRecord = ctx.essentialPanels.get(id);
        if (tabRecord?.tab.isConnected) return tabRecord.app;
        const normal = savedNormalApps().find((app) => app.id === id);
        if (normal) return normal;
        const snapshot = pair.apps?.[id];
        if (!snapshot?.url) return null;
        const app = { ...snapshot, id, workspaceId: "all" };
        // During cold startup (without ZentralStartup waking sleeping Essential tabs) or while
        // the tab still exists in session restore, use the saved snapshot directly without
        // duplicating it into the normal Apps grid.
        if (
          !promoteMissing ||
          !id.startsWith("bgalazka-essential-") ||
          hasStoredEssentialTab(id)
        )
          return app;
        // A tab closed while this window was shut down: create its dedicated launcher from the
        // saved metadata without creating a browser.
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
        ctx.saveLinkedTriplePairs();
      }
      function linkCurrentPair(firstApp, secondApp) {
        const top = firstApp?.id;
        const bottom = secondApp?.id;
        if (!top || !bottom || top === bottom) return;
        const same = ctx.linkedPairFor(top);
        if (same && same === ctx.linkedPairFor(bottom)) {
          state.pair = same;
          return;
        }
        ctx.unlinkTriplePair(top);
        ctx.unlinkTriplePair(bottom);
        const pair = {
          top,
          bottom,
          share: state.share,
          apps: {
            [top]: { ...firstApp, id: top },
            [bottom]: { ...secondApp, id: bottom },
          },
        };
        ctx.linkedTriplePairs.push(pair);
        state.pair = pair;
        ctx.saveLinkedTriplePairs();
      }
      function enterTriple(first) {
        state.first = first;
        state.mode = "triple";
        const btn = document.getElementById("zen-app-dual-view-btn");
        btn?.setAttribute("data-hold-active", "true");
        ui.setAttribute("bgalazka-triple-view", "true");
        ctx.syncPanelPushState();
        refreshViewZenCss(first);
      }
      function refreshViewZenCss(browser) {
        if (!ctx.zenCssEnabled() || !browser?.isConnected) return;
        ctx.attachZenInternetPanelBrowser(browser);
        ctx.updateZenCssBrowser(browser);
      }
      function showPair(pair, opts = {}) {
        const top = resolvePairApp(pair, pair.top, opts);
        const bottom = resolvePairApp(pair, pair.bottom, opts);
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
        scheduleSecondaryHeal({ fresh: true });
        return true;
      }
      function swapPair() {
        const pair = state.pair;
        if (!pair || state.mode !== "triple" || !state.second) return;
        rememberPair();
        [pair.top, pair.bottom] = [pair.bottom, pair.top];
        ctx.saveLinkedTriplePairs();
        // Notes between the panels: the gap's upper part (taken from the upper panel) becomes the lower part,
        // so the panels trade places at exactly the sizes they had and Notes stays where it is.
        const gapNow = notesGap(),
          upNow = notesGapUp();
        if (gapNow > 0 && upNow >= 0)
          document.documentElement.style.setProperty(
            "--zentral-notes-gap-up",
            `${Math.round(gapNow - upNow)}px`,
          );
        state.notesOpen = null; // refreshed by the fit below; a stale pre-swap record must never be committed
        const oldFirst = state.first,
          oldSecond = state.second;
        // discardSecond only removes chrome in Triple View; both live browsers
        // remain siblings in the same XUL container throughout this swap.
        discardSecond();
        state.first = oldSecond;
        state.second = oldFirst;
        state.secondURL =
          oldFirst.currentURI?.spec || pair.apps[pair.bottom]?.url;
        state.share = 1 - state.share;
        pair.share = state.share;
        apps.selectHostedPanelBrowser(state.first);
        ctx.floating?.preservePrimaryFor?.(state.first);
        makeShell(state.second, resolvePairApp(pair, pair.bottom));
        ctx.saveLinkedTriplePairs();
        markTiles();
        ctx.updateWebToolbarState();
        fitSecondaryBrowsers();
        // Notes follows the swap (its band sits above the divider, which just moved).
        try {
          document.dispatchEvent(new Event("zentral-triple-swapped"));
        } catch (_) {}
        ctx.requestPanelActivity();
        refreshViewZenCss(state.first);
        refreshViewZenCss(state.second);
        scheduleSecondaryGeometryFit();
      }
      const markTiles = () =>
        document
          .querySelectorAll(".zen-app-tile[data-app-id]")
          .forEach((tile) => {
            if (
              state.mode &&
              tile.dataset.appId === state.first?._bgalazkaAppId
            )
              tile.dataset.active = "true";
            if (
              state.second &&
              tile.dataset.appId === state.second._bgalazkaAppId
            )
              tile.dataset.active = "true";
          });
      function notesGap() {
        const v = parseFloat(document.documentElement.style.getPropertyValue("--zentral-notes-gap"));
        return Number.isFinite(v) && v > 0 ? v : 0;
      }
      // Px of the Notes gap taken from the UPPER panel (the rest comes from the lower one). Absent = the gap is
      // shared in proportion to state.share (the pre-edge-drag behaviour). Only Notes edge drags set it; it never
      // touches state.share.
      function notesGapUp() {
        const v = parseFloat(document.documentElement.style.getPropertyValue("--zentral-notes-gap-up"));
        return notesGap() > 0 && Number.isFinite(v) && v >= 0 ? Math.min(v, notesGap()) : -1;
      }
      // Pure: how small a web panel may get. Without Notes: 160 px, or a quarter of the two when that is less.
      // While Notes holds the gap: 120 px, or a quarter of what the two share WITHOUT Notes (`usable + gap`) when
      // that is less. The second floor must not depend on the gap. It used to be a quarter of `usable`, which
      // changes with every px of the gap: a panel resting on its floor then moved whenever Notes was resized, and
      // the edge of Notes that was NOT being dragged moved with it (OW-26). Notes keeps the same floor
      // (gapPageFloor in additional/notes/ZentralNotes.uc.js; tests/notes-triple-view-startup.test.cjs compares
      // the two). A gap that leaves less than two floors (the panel just shrank): the panels halve what is left.
      function tripleFloor({ usable, gap = 0 }) {
        if (!(gap > 0)) return Math.min(160, usable * 0.25);
        return Math.max(0, Math.min(120, (usable + gap) / 4, usable / 2));
      }
      // Pure: heights of the two web panels. `usable` already excludes the gap; the panels would share
      // `usable + gap` without Notes. up < 0 = proportional gap. U + L always equals `usable`.
      function tripleHeights({ usable, gap = 0, share = 0.5, up = -1 }) {
        const min = tripleFloor({ usable, gap });
        const s = Number.isFinite(share) ? share : 0.5;
        const raw = up >= 0 && gap > 0 ? (usable + gap) * s - Math.min(up, gap) : usable * s;
        const top = Math.max(min, Math.min(usable - min, raw));
        return { top, bottom: usable - top };
      }
      // Pure inverse for a divider drag: the share that puts the upper panel at `topPx`.
      function tripleShareFor({ usable, gap = 0, topPx, up = -1 }) {
        const min = tripleFloor({ usable, gap });
        const top = Math.max(min, Math.min(usable - min, topPx));
        return up >= 0 && gap > 0 ? (top + Math.min(up, gap)) / (usable + gap) : top / usable;
      }
      // Pure: the part of the gap the upper panel really gave, given the height it ended up with. Equal to the
      // `up` Notes asked for unless a floor held one of the panels.
      function tripleGapUp({ usable, gap = 0, share = 0.5, top }) {
        const s = Number.isFinite(share) ? share : 0.5;
        return Math.max(0, Math.min(gap, (usable + gap) * s - top));
      }
      // Pure: does the band of Notes lie where a band that has just been opened would lie? A new band is centred
      // on the divider (Notes takes Math.round(gap / 2) from the upper panel) and is off centre only as far as a
      // floor pushes it. `top` = the upper panel's height now. Also true for a band whose edge was dragged back to
      // that place: the two cannot be told apart and need not be. One px either way is the same place: the swap
      // mirrors the upper part of a band of an odd height to the other half (172 of 345 instead of 173), and the
      // split a floor allowed is reported in whole px.
      function tripleBandAsOpened({ usable, gap = 0, share = 0.5, top }) {
        if (!(gap > 0) || !Number.isFinite(top)) return true;
        return Math.abs(tripleHeights({ usable, gap, share, up: Math.round(gap / 2) }).top - top) < 1.5;
      }
      // Pure: the share that puts the divider in the MIDDLE of the Notes band that is closing. `top` = the upper
      // panel's height while Notes was open, `gap` = the band's height, `total` = both panels plus the band. Both
      // panels then take back half of it, whatever the edges had been dragged to. No band = unchanged. Only for
      // a band that does not lie where it was opened (tripleBandAsOpened; see onNotesGap for why).
      // The middle is a whole px, rounded the way Notes divides a new band (Math.round(px / 2) in its bar
      // adapter), so a band that closes and opens again takes from the upper panel exactly what the close gave
      // back to it. With the exact half, a band of an odd height moved the divider half a px up at every close
      // and reopen. A panel that slides away and returns with Notes open is one such pair, and the split is
      // saved each time: it crept until the upper panel stood on its floor (OW-26).
      function tripleShareAfterNotes({ top, gap, total, share = 0.5 }) {
        if (!(gap > 0) || !(total > 0) || !Number.isFinite(top)) return share;
        return Math.max(0.05, Math.min(0.95, (top + Math.round(gap / 2)) / total));
      }
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
        // V4-R2: Notes between the panels opens a gap at the divider; both panels share what is left.
        const gap = notesGap();
        const usable =
          rect.height -
          (toolbar?.offsetHeight || 0) -
          state.shell.offsetHeight -
          state.divider.offsetHeight -
          gap -
          panel.clientTop * 2;
        if (usable <= 0) return;
        // What closing Notes needs later (the band is gone by then): the upper panel's height, the band and the
        // whole stack while it was open.
        const up = notesGapUp();
        const { top } = tripleHeights({ usable, gap, share: state.share, up });
        // Notes asked for a split one panel cannot give (an uneven pair, a panel that shrank, a start-up that
        // re-centres the band on a divider saved for another split): publish the split that was applied. The
        // variable is the truth both sides read (the swap already mirrors it); left at the wish, the next edge
        // drag of Notes started from a split that was not on screen and moved the opposite edge.
        if (gap > 0 && up >= 0) {
          const applied = Math.round(tripleGapUp({ usable, gap, share: state.share, top }));
          if (applied !== Math.round(up))
            document.documentElement.style.setProperty("--zentral-notes-gap-up", `${applied}px`);
        }
        state.notesOpen =
          gap > 0
            ? { top, gap, total: usable + gap, asOpened: tripleBandAsOpened({ usable, gap, share: state.share, top }) }
            : null;
        const topValue = `${Math.round(top)}px`,
          bottomValue = `${Math.round(usable - top)}px`;
        if (panel.style.getPropertyValue("--bgalazka-top-share") !== topValue)
          panel.style.setProperty("--bgalazka-top-share", topValue);
        if (
          panel.style.getPropertyValue("--bgalazka-bottom-share") !==
          bottomValue
        )
          panel.style.setProperty("--bgalazka-bottom-share", bottomValue);
        if (state.handleFrame) cancelAnimationFrame(state.handleFrame);
        state.handleFrame = requestAnimationFrame(() => {
          state.handleFrame = null;
          if (!state.dividerHandle?.isConnected || !state.divider?.isConnected)
            return;
          const line = state.divider.getBoundingClientRect();
          state.dividerHandle.style.left = `${line.left}px`;
          // While Notes owns the gap its bottom grip ends exactly at the divider's top edge: the handle must
          // not reach above it, or the two hit targets overlap and the divider steals the Notes drag.
          const lead = notesGap() > 0 ? 0 : 3;
          state.dividerHandle.style.top = `${line.top - lead}px`;
          state.dividerHandle.style.width = `${line.width}px`;
          state.dividerHandle.style.height = `${line.height + 3 + lead}px`;
        });
      }
      // A cold startup or a freshly-created second browser can report transient zero/stale
      // chrome heights before the flex layout settles: fit again after a frame and once more a
      // little later. (This was added in the belief that a missing fit was why Notes' gap grips
      // misbehaved until the panels were swapped. It was not: see tripleFloor and the split written
      // back in fitSecondaryBrowsers, OW-26. The follow-up stays for the transient heights.)
      // var, not let: a startup restore can request a pair before this line has run, and a let would then
      // throw from its temporal dead zone. A hoisted undefined is harmless to cancelAnimationFrame / clearTimeout.
      var secondaryFitFrame = null;
      var secondaryFitTimer = null;
      function scheduleSecondaryGeometryFit() {
        if (state.mode !== "triple" || !state.second?.isConnected) return;
        if (secondaryFitFrame != null) cancelAnimationFrame(secondaryFitFrame);
        secondaryFitFrame = requestAnimationFrame(() => {
          secondaryFitFrame = null;
          fitSecondaryBrowsers();
        });
        if (secondaryFitTimer != null) ctx.clearTimeout(secondaryFitTimer);
        secondaryFitTimer = ctx.setTimeout(() => {
          secondaryFitTimer = null;
          fitSecondaryBrowsers();
        }, 280);
      }
      ctx.scheduleSecondaryGeometryFit = scheduleSecondaryGeometryFit;

      // ---- a cold or sleeping second panel heals itself --------------------------------------------------
      // Two long-standing faults had one shape: the lower page of a Triple View that a start-up (or a reveal of an
      // autohidden panel) built while the panel was still settling stayed empty until "Swap top and bottom panels"
      // rebuilt its shell. The swap helped because it ran every step again once the panel was laid out. The same
      // steps are now taken by the panel itself, when it is on screen, a few times while the start-up settles and
      // at every reveal: publish the split, un-hide both pages, load a page that is still blank, and wake both
      // pages. Each step only acts when it finds something wrong, so a healthy pair is left exactly as it is.
      // var, not const/let: a start-up restore may reach discardSecond before these lines have run (see secondaryFitFrame).
      var HEAL_DELAYS_MS = [350, 1200, 3000, 7000];
      var HEAL_MAX_RELOADS = 3;
      var healReloads = new WeakMap();
      var healTimers = [];
      var healSettledPending = false;
      const panelOnScreen = () =>
        !!isOpen() &&
        !ui.hasAttribute("bgalazka-hover-panel-hidden") &&
        document.visibilityState !== "hidden";
      const isBlankSpec = (spec) => !spec || spec === "about:blank";
      // A page counts as blank only when every place that knows what it shows says so: a browser that a tab hosts
      // can report about:blank as its current URI while the page it shows has a document URI and a title.
      const isBlankPage = (browser) =>
        isBlankSpec(browser?.currentURI?.spec) &&
        isBlankSpec(browser?.documentURI?.spec) &&
        !browser?.contentTitle;
      // Every recovery step and every give-up goes to the console AND to the support report (Settings > Logs &
      // Diagnostics > Copy diagnostics), which works even when the console logger is off.
      function noteHeal(message, data) {
        syncSecondaryHealthDot();
        console.warn("[Zentral] " + message, data ?? "");
        try {
          window.ZentralRuntime?.noteDiagnostic?.("Triple View", message, data);
        } catch (_) {}
      }
      const describeBrowser = (b) =>
        b
          ? {
              app: b._bgalazkaAppId,
              url: b.currentURI?.spec,
              documentURI: b.documentURI?.spec,
              title: b.contentTitle,
              pending: b.hasAttribute?.("pending") || false,
              remote: b.isRemoteBrowser,
              hasWindowGlobal: !!b.browsingContext?.currentWindowGlobal,
              height: Math.round(b.getBoundingClientRect?.().height || 0),
              docShellIsActive: b.docShellIsActive,
              loading: !!b.webProgress?.isLoadingDocument,
              reloads: healReloads.get(b) || 0,
            }
          : null;
      const unregisterPanelReporter = window.ZentralRuntime?.registerDiagnosticReporter?.(
        "Panels · Triple View",
        () => {
          const slot = slider();
          return JSON.stringify(
            {
              mode: state.mode,
              open: !!isOpen(),
              autohidden: ui.hasAttribute("bgalazka-hover-panel-hidden"),
              share: state.share,
              topShare: slot?.style.getPropertyValue("--bgalazka-top-share") || null,
              bottomShare: slot?.style.getPropertyValue("--bgalazka-bottom-share") || null,
              settlePending: healSettledPending,
              upper: describeBrowser(state.first),
              lower: describeBrowser(state.second),
            },
            null,
            2,
          );
        },
      );
      ctx.registerCleanup(() => unregisterPanelReporter?.());
      function secondaryLoadTarget(browser) {
        const id = browser?._bgalazkaAppId;
        const url =
          browser?._bgalazkaSuperPinReturnURL ||
          state.secondURL ||
          (id && state.pair?.apps?.[id]?.url) ||
          "";
        return url && url !== "about:blank" ? url : "";
      }
      // Returns true when the pair is healthy (both pages laid out, the lower one has content and is awake).
      function healSecondaryPanel() {
        const second = state.second;
        if (
          state.mode !== "triple" ||
          !second?.isConnected ||
          !state.shell?.isConnected ||
          !panelOnScreen()
        )
          return false;
        try {
          for (const browser of [state.first, second]) {
            if (!browser?.isConnected) continue;
            if (browser.hidden) browser.hidden = false;
            browser.removeAttribute?.("hidden");
            if (browser.style.display === "none") browser.style.display = "";
          }
          fitSecondaryBrowsers();
          const panel = slider();
          const split =
            !!panel?.style.getPropertyValue("--bgalazka-top-share") &&
            !!panel?.style.getPropertyValue("--bgalazka-bottom-share");
          if (isBlankPage(second) && !second.webProgress?.isLoadingDocument) {
            const target = secondaryLoadTarget(second);
            const used = healReloads.get(second) || 0;
            if (target && used < HEAL_MAX_RELOADS) {
              healReloads.set(second, used + 1);
              noteHeal("lower panel was blank; loading it again (" + (used + 1) + "/" + HEAL_MAX_RELOADS + ")", target);
              navigate(second, target);
            } else if (target) {
              noteHeal("lower panel is still blank; reload limit reached", target);
            }
          }
          ctx.requestPanelActivity?.();
          if (ctx.zenCssEnabled?.()) refreshViewZenCss(second);
          syncSecondaryHealthDot();
          const laidOut = second.getBoundingClientRect().height > 0;
          const hasPage =
            !isBlankPage(second) && !!second.browsingContext?.currentWindowGlobal;
          return split && laidOut && hasPage;
        } catch (error) {
          console.warn("[BgalazkaExtension] Secondary panel recovery failed", error);
          return false;
        }
      }
      function cancelSecondaryHeal() {
        for (const timer of healTimers) ctx.clearTimeout(timer);
        healTimers = [];
      }
      // `settled` tells Notes (which sized its band from the pages it measured) that the pages now have their
      // final size, so a band measured while they were still settling is measured again.
      function announceTripleSettled() {
        if (!healSettledPending) return;
        healSettledPending = false;
        try {
          document.dispatchEvent(new Event("zentral-triple-settled"));
        } catch (_) {}
      }
      function scheduleSecondaryHeal({ fresh = false } = {}) {
        if (state.mode !== "triple") return;
        if (fresh) healSettledPending = true;
        cancelSecondaryHeal();
        HEAL_DELAYS_MS.forEach((delay, index) => {
          const timer = ctx.setTimeout(() => {
            healTimers = healTimers.filter((t) => t !== timer);
            if (state.mode !== "triple" || !state.second?.isConnected) return;
            const healthy = healSecondaryPanel();
            if (healthy && panelOnScreen()) announceTripleSettled();
            if (healthy) cancelSecondaryHeal();
            else if (index === HEAL_DELAYS_MS.length - 1 && panelOnScreen()) {
              // Never fail quietly: say what the lower page looked like when recovery gave up.
              noteHeal("lower panel is still not showing content after recovery", describeBrowser(state.second));
            }
          }, delay);
          healTimers.push(timer);
        });
      }
      ctx.panelHealReloads = (browser) => healReloads.get(browser) || 0;
      // Refreshes the dot of the lower bar. Called by the main toolbar's poll, every recovery pass, every reveal.
      function syncSecondaryHealthDot() {
        try {
          if (state.shell?.isConnected && state.second) ctx.syncHealthDot?.(state.shell, state.second);
        } catch (_) {}
      }
      ctx.syncSecondaryHealthDot = syncSecondaryHealthDot;
      ctx.healSecondaryPanel = () => {
        if (state.mode !== "triple") return;
        healSecondaryPanel();
        scheduleSecondaryHeal();
      };
      // True when no second page is expected, or when it has content (a start-up may then let the panel slide away).
      ctx.secondaryContentReady = () =>
        state.mode !== "triple" ||
        !state.second?.isConnected ||
        (!isBlankPage(state.second) && !!state.second.browsingContext?.currentWindowGlobal);
      ctx.registerCleanup(() => {
        cancelSecondaryHeal();
        delete ctx.healSecondaryPanel;
        delete ctx.panelHealReloads;
        delete ctx.syncSecondaryHealthDot;
        delete ctx.secondaryContentReady;
      });

      // Resume can leave secondary geometry/activity stale without a resize.
      // Coalesce native lifecycle signals; one delayed pass covers restored layout.
      let resumeFrame = null;
      let resumeTimer = null;
      const secondaryResumeVisible = () =>
        !!state.mode &&
        state.second?.isConnected &&
        isOpen() &&
        document.visibilityState !== "hidden" &&
        !ui.hasAttribute("bgalazka-hover-panel-hidden");
      const queueSecondaryResumeFrame = () => {
        if (resumeFrame !== null || !secondaryResumeVisible()) return;
        resumeFrame = requestAnimationFrame(() => {
          resumeFrame = null;
          if (!secondaryResumeVisible()) return;
          fitSecondaryBrowsers();
          ctx.requestPanelActivity();
        });
      };
      const resumeSecondaryView = () => {
        if (!secondaryResumeVisible()) return;
        queueSecondaryResumeFrame();
        if (resumeTimer === null)
          resumeTimer = ctx.setTimeout(() => {
            resumeTimer = null;
            queueSecondaryResumeFrame();
          }, 250);
      };
      // Notes (bottom bar of Triple View) opens / closes its gap at the divider: fit both panels again.
      // A band that lay where it was opened goes away without a trace: each panel takes back what it gave and
      // the saved split is the one from before (owner 2026-11-15). Until 3.3.173 the divider went to the middle of
      // every band. For a pair too uneven to centre the band (one panel on its floor) that replaced the saved
      // split: 30 / 70 came back as 41 / 59, at the first start-up whose panel slid away with Notes open.
      // A band that lies elsewhere (an edge of Notes was dragged, or the divider was dragged away from a band a
      // floor had pushed off centre) still ends with the divider in its middle. Its place is not remembered, the
      // next band is centred on the divider, so this is what brings Notes back where it was.
      const onNotesGap = () => {
        const was = state.notesOpen;
        if (was && notesGap() === 0 && state.mode === "triple") {
          if (!was.asOpened) state.share = tripleShareAfterNotes({ ...was, share: state.share });
          state.notesOpen = null;
          if (state.pair && state.second) rememberPair();
        }
        fitSecondaryBrowsers();
        scheduleSecondaryGeometryFit();
      };
      document.addEventListener("zentral-notes-reserve", onNotesGap);
      ctx.registerCleanup(() => document.removeEventListener("zentral-notes-reserve", onNotesGap));
      window.addEventListener("activate", resumeSecondaryView);
      window.addEventListener("sizemodechange", resumeSecondaryView);
      document.addEventListener("visibilitychange", resumeSecondaryView);
      Services.obs.addObserver(resumeSecondaryView, "wake_notification");
      ctx.registerCleanup(() => {
        window.removeEventListener("activate", resumeSecondaryView);
        window.removeEventListener("sizemodechange", resumeSecondaryView);
        document.removeEventListener("visibilitychange", resumeSecondaryView);
        Services.obs.removeObserver(resumeSecondaryView, "wake_notification");
        if (resumeFrame !== null) cancelAnimationFrame(resumeFrame);
        if (resumeTimer !== null) ctx.clearTimeout(resumeTimer);
        if (secondaryFitFrame !== null) cancelAnimationFrame(secondaryFitFrame);
        if (secondaryFitTimer !== null) ctx.clearTimeout(secondaryFitTimer);
        resumeFrame = resumeTimer = secondaryFitFrame = secondaryFitTimer = null;
        delete ctx.scheduleSecondaryGeometryFit;
      });
      function moveBrowser(browser, parent) {
        if (browser.parentNode === parent) return;
        const sameRoot =
          typeof parent.getRootNode === "function" &&
          typeof browser.getRootNode === "function"
            ? parent.getRootNode() === browser.getRootNode()
            : true;
        if (typeof browser._zentralMoveTo === "function")
          browser._zentralMoveTo(parent);
        else if (
          sameRoot &&
          typeof parent.moveBefore === "function" &&
          typeof browser.connectedMoveCallback === "function"
        )
          parent.moveBefore(browser, null);
        else parent.appendChild(browser);
      }
      function discardSecond() {
        cancelSecondaryHeal();
        healSettledPending = false;
        state.geometryObserver?.disconnect();
        state.geometryObserver = null;
        state.hoverObserver?.disconnect();
        state.hoverObserver = null;
        state.slideCleanup?.();
        state.slideCleanup = null;
        if (state.handleFrame) cancelAnimationFrame(state.handleFrame);
        state.handleFrame = null;
        state.dividerHandle?.remove();
        state.dividerHandle = null;
        state.resizeCleanup?.();
        state.resizeCleanup = null;
        state.secondToolbarCleanup?.();
        state.secondToolbarCleanup = null;
        state.pollUpdate = null;
        const second = state.second;
        if (second) ctx.cancelPanelRetry(second);
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
          if (second.parentNode !== slider()) moveBrowser(second, slider());
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
        ctx.updateWebToolbarState();
        window.ZentralRuntime.baseBridge?.emit("secondary-closing", {
          root: state.shell,
          browser: second,
        });
        if (state.shell) ctx.cancelPanelRetry(state.shell);
        state.shell?.remove();
        state.shell = null;
        slider()?.style.removeProperty("--bgalazka-top-share");
        slider()?.style.removeProperty("--bgalazka-bottom-share");
        state.first?.removeAttribute("data-bgalazka-triple-slot");
        second?.removeAttribute("data-bgalazka-triple-slot");
        ctx.syncAppPanelBrowserActivity();
      }
      function leaveMode() {
        if (!state.mode) return;
        const mode = state.mode;
        if (mode === "triple") rememberPair();
        discardSecond();
        state.notesOpen = null;
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
        if (mode === "triple") ctx.syncPanelPushState();
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
          ctx.unlinkTriplePair(state.pair.top);
          state.pair = null;
        }
        leaveMode();
      }
      function navigate(browser, value) {
        try {
          const target = ctx.looksLikeUrl(value)
            ? /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
              ? value
              : "https://" + value
            : ctx.buildSearchUrl(value);
          const uri = Services.io.newURI(target);
          const options = {
            triggeringPrincipal:
              Services.scriptSecurityManager.createContentPrincipal(uri, {
                userContextId:
                  Number(browser.getAttribute("usercontextid")) || 0,
              }),
          };
          if (typeof browser.fixupAndLoadURIString === "function")
            browser.fixupAndLoadURIString(target, options);
          else browser.loadURI(uri, options);
        } catch (error) {
          console.warn(
            "[BgalazkaExtension] Secondary navigation failed",
            error,
          );
        }
      }
      function repairSuperPinReturn(browser) {
        const url = browser?._bgalazkaSuperPinReturnURL;
        if (!url) return;
        ctx.retryPanelTask(browser, () => {
          if (
            !browser.isConnected ||
            browser._bgalazkaSuperPinReturnURL !== url ||
            !isOpen() ||
            ui.hasAttribute("bgalazka-hover-panel-hidden") ||
            browser.style.display === "none"
          )
            return true;
          const current = browser.currentURI?.spec;
          if (current && current !== "about:blank") {
            delete browser._bgalazkaSuperPinReturnURL;
            return true;
          }
          if (!browser.webProgress?.isLoadingDocument) navigate(browser, url);
          return false;
        });
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
          el.appendChild(ctx.parseSVG(icon));
          return el;
        };
        iconButton(ctx.PREF_ICONS.BACK, "Back", () =>
          ctx.navigatePanelHistory(browser, -1),
        );
        iconButton(ctx.PREF_ICONS.RELOAD, "Reload", () =>
          browser.reload(),
        ).classList.add("zentral-secondary-reload");
        iconButton(ctx.PREF_ICONS.FORWARD, "Forward", () =>
          ctx.navigatePanelHistory(browser, 1),
        );
        const grip = document.createElement("div");
        grip.className = "bgalazka-second-grip";
        grip.title = "Drag to move second panel";
        grip.appendChild(ctx.parseSVG(ctx.PREF_ICONS.DRAG_HANDLE));
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
        // Health dot at the edge of the URL field (same dot as the main panel's bar; see panelHealth() in
        // ZentralPanelToolbar.uc.js). Hidden while the lower page is fine.
        const healthDot = document.createElement("span");
        healthDot.className = "zen-toolbar-health-dot bgalazka-second-health-dot";
        healthDot.hidden = true;
        healthDot.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (state.second?.isConnected) {
            ctx.reloadPanelFromDot?.(state.second);
            window.setTimeout(() => ctx.syncSecondaryHealthDot?.(), 400);
          }
        });
        healthDot.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          try {
            window.ZentralRuntime?.copyDiagnostics?.();
          } catch (error) {
            console.warn("[Zentral] Copy diagnostics failed", error);
          }
        });
        bar.append(grip, url, healthDot);
        iconButton(ctx.PREF_ICONS.ZOOM_OUT, "Zoom out", () =>
          zoom(-0.1),
        ).classList.add("bgalazka-second-zoom");
        const zoomText = button("100%", "Reset zoom", () => zoom(0));
        zoomText.classList.add(
          "bgalazka-second-zoom-label",
          "bgalazka-second-zoom",
        );
        iconButton(ctx.PREF_ICONS.ZOOM_IN, "Zoom in", () =>
          zoom(0.1),
        ).classList.add("bgalazka-second-zoom");
        const quickSwitch = button("⇄", "Switch search engine", () => {
          const next = ctx.getPanelQuickSwitchTarget?.(browser);
          if (next) navigate(browser, next.url);
        });
        quickSwitch.classList.add("bgalazka-second-quickswitch");
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
            ctx.persistPanelZoom?.(browser, next);
            zoomText.textContent = Math.round(next * 100) + "%";
          } catch (_) {}
        }
        const tools = document.createElement("div");
        tools.className = "zentral-secondary-tools";
        for (const child of [...bar.children])
          if (
            child.matches(
              ".bgalazka-second-zoom,.bgalazka-second-quickswitch,.bgalazka-second-swap",
            )
          )
            tools.append(child);
        bar.insertBefore(tools, bar.querySelector(".bgalazka-second-close"));
        box.appendChild(bar);
        if (state.mode === "super") {
          // Atomic moves require both source and destination to be connected.
          (document.body || document.documentElement).appendChild(box);
          moveBrowser(browser, box);
        }
        browser.hidden = false;
        browser.removeAttribute("hidden");
        browser.style.display = "";
        if (state.first) {
          state.first.hidden = false;
          state.first.removeAttribute("hidden");
          state.first.style.display = "";
        }
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
          ctx.updateWebToolbarState();
          const balance = (clientY) => {
            const panel = slider();
            const rect = panel.getBoundingClientRect();
            const toolbarHeight =
              document.getElementById("zen-app-panel-toolbar")?.offsetHeight ||
              0;
            const usable =
              rect.height -
              toolbarHeight -
              bar.offsetHeight -
              divider.offsetHeight -
              notesGap();
            if (usable <= 0) return;
            // The divider sits BELOW the Notes gap, so its top is the upper panel's height plus the gap.
            state.share = tripleShareFor({
              usable,
              gap: notesGap(),
              topPx: clientY - rect.top - toolbarHeight - panel.clientTop - notesGap(),
              up: notesGapUp(),
            });
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
          const HoverObserver =
            typeof MutationObserver === "function"
              ? MutationObserver
              : window.MutationObserver;
          if (HoverObserver) {
            state.hoverObserver = new HoverObserver(() => {
              if (!ui.hasAttribute("bgalazka-hover-panel-hidden")) {
                scheduleSecondaryGeometryFit();
                scheduleSecondaryHeal();
                syncSecondaryHealthDot();
              }
            });
            state.hoverObserver.observe(ui, {
              attributes: true,
              attributeFilter: ["bgalazka-hover-panel-hidden"],
            });
          }
          const panelRoot = root();
          if (panelRoot) {
            const onPanelSlideEnd = (event) => {
              if (
                event.target === panelRoot &&
                event.propertyName === "transform" &&
                !ui.hasAttribute("bgalazka-hover-panel-hidden")
              )
                fitSecondaryBrowsers();
            };
            panelRoot.addEventListener("transitionend", onPanelSlideEnd);
            state.slideCleanup = () =>
              panelRoot.removeEventListener("transitionend", onPanelSlideEnd);
          }
          let shield = null;
          let grabOffset = 0;
          let pointerId = null;
          let captureTarget = null;
          const endResize = (event) => {
            if (event?.pointerId != null && event.pointerId !== pointerId)
              return;
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
          const bounds = window.ZentralRuntime.sidebarSafeBounds();
          const leftRoom = first.left - bounds.left - 12,
            rightRoom = bounds.right - first.right - 12;
          const useLeft = leftRoom >= rightRoom;
          const proposed = useLeft ? first.left - width - 12 : first.right + 12;
          box.style.left = `${Math.max(bounds.left + 12, Math.min(bounds.right - width - 12, proposed))}px`;
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
              const bounds = window.ZentralRuntime.sidebarSafeBounds();
              width = Math.min(
                width,
                Math.max(0, bounds.right - bounds.left - 24),
              );
              box.style.left = `${Math.max(bounds.left + 12, Math.min(bounds.right - width - 12, left))}px`;
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
            const bounds = window.ZentralRuntime.sidebarSafeBounds();
            box.style.left = `${Math.max(
              bounds.left + 12,
              Math.min(
                bounds.right - box.getBoundingClientRect().width - 12,
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
        window.ZentralRuntime.baseBridge?.emit("secondary-created", {
          root: box,
          browser,
          mode: state.mode,
        });
        // Establish both remote viewport sizes before openSecond navigates.
        // ResizeObserver handles subsequent geometry changes without reloads.
        fitSecondaryBrowsers();
        ctx.retryPanelTask(box, () => {
          if (state.shell !== box || !browser.isConnected) return true;
          fitSecondaryBrowsers();
          ctx.requestPanelActivity();
          const ready =
            !!browser.browsingContext?.currentWindowGlobal &&
            browser.getBoundingClientRect().height > 0;
          if (!ready) return false;
          const url = browser.currentURI?.spec;
          if (
            (!url || url === "about:blank") &&
            app.url !== "about:blank" &&
            !browser.webProgress?.isLoadingDocument
          ) {
            navigate(browser, browser._bgalazkaSuperPinReturnURL || app.url);
            return false;
          }
          refreshViewZenCss(browser);
          return !!url && url !== "about:blank";
        }, { minAttempts: 12 });
        window.ZentralRuntime?.requestSidebarLayout?.();
        const refreshSecondaryToolbar = () => {
          if (state.second !== browser || !box.isConnected) return;
          const nextSearch = ctx.getPanelQuickSwitchTarget?.(browser);
          quickSwitch.style.setProperty(
            "display",
            ctx.getPref(
              ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH,
              false,
            ) && nextSearch
              ? "inline-flex"
              : "none",
            "important",
          );
          if (nextSearch) quickSwitch.title = "Search with " + nextSearch.label;
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
            window.ZentralRuntime.baseBridge?.emit("navigation", { browser });
          },
          onStateChange(progress) {
            if (progress && !progress.isTopLevel) return;
            window.ZentralRuntime.baseBridge?.emit("navigation", { browser });
          },
          QueryInterface: ChromeUtils.generateQI([
            "nsIWebProgressListener",
            "nsISupportsWeakReference",
          ]),
        };
        try {
          browser.webProgress?.addProgressListener(
            secondaryProgress,
            Ci.nsIWebProgress.NOTIFY_LOCATION |
              Ci.nsIWebProgress.NOTIFY_STATE_NETWORK,
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
        ctx.syncSecondaryFallbackPolling();
      }
      ctx.updateSecondaryFallbackState = () => {
        if (isOpen() && !ui.hasAttribute("bgalazka-hover-panel-hidden"))
          state.pollUpdate?.();
      };
      ctx.syncSecondaryFallbackPolling = () => {
        ctx.updateSecondaryFallbackState();
        ctx.syncPanelFallbackPolling();
      };
      ctx.registerCleanup(() => {
        delete ctx.updateSecondaryFallbackState;
      });

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
        if (
          isNew ||
          (browser.currentURI?.spec === "about:blank" &&
            !browser.webProgress?.isLoadingDocument)
        )
          navigate(browser, browser._bgalazkaSuperPinReturnURL || app.url);
        repairSuperPinReturn(browser);
        ctx.requestPanelActivity();
        if (state.mode === "triple" && createLink) {
          const firstId = state.first?._bgalazkaAppId;
          const firstApp =
            ctx.essentialPanels.get(firstId)?.app ||
            savedNormalApps().find((item) => item.id === firstId);
          linkCurrentPair(firstApp, app);
        }
        markTiles();
        if (state.mode === "triple") {
          scheduleSecondaryGeometryFit();
          scheduleSecondaryHeal({ fresh: true });
        }
        return true;
      }
      // Startup can request one panel even when it belongs to a saved Triple View pair.
      // Normal launcher clicks still restore the linked pair through the wrapper below.

      ctx.syncSecondaryToolbarPreferences = () => {
        state.pollUpdate?.();
        fitSecondaryBrowsers();
      };
      const fallbackRecreatePanels = ctx.recreateLoadedPanels;
      ctx.recreateLoadedPanels = (ids) => {
        const view = apps.capturePanelViewState();
        const primary = view.open
          ? state.mode
            ? state.first
            : active()
          : null;
        const loaded = new Map(
          ctx
            .getAllAppBrowsers()
            .map((browser) => [browser._bgalazkaAppId, browser]),
        );
        for (const id of ids) {
          const old = loaded.get(id);
          const source =
            ctx.essentialPanels.get(id)?.app ||
            savedNormalApps().find((a) => a.id === id) ||
            state.pair?.apps?.[id] ||
            ctx.linkedPairFor?.(id)?.apps?.[id];
          if (!old || !source) continue;
          const app = {
            ...source,
            url:
              old.currentURI?.spec && old.currentURI.spec !== "about:blank"
                ? old.currentURI.spec
                : source.url,
          };
          const isFirst = old === primary;
          const isSecond = old === state.second;
          const shellStyle = state.shell?.style.cssText;
          const share = state.share,
            pair = state.pair;

          if (isSecond) discardSecond();
          const closePanel = apps.closePanel;
          try {
            apps.closePanel = () => {};
            origCloseApp.call(apps, id);
          } finally {
            apps.closePanel = closePanel;
          }
          if (isFirst) {
            origOpen.call(apps, app);
            if (state.mode)
              state.first = ctx
                .getAllAppBrowsers()
                .find((b) => b._bgalazkaAppId === id);
            else state.first = null;
            if (state.mode === "triple")
              state.first?.setAttribute("data-bgalazka-triple-slot", "top");
            if (state.second) state.second.style.display = "";
            apps.restorePanelViewState(view);
          } else if (isSecond) {
            openSecond(app, false);
            if (state.mode === "super" && state.shell && shellStyle)
              state.shell.style.cssText = shellStyle;
          } else {
            const created = apps.getOrCreateAppBrowser(app);
            if (created?.browser) {
              created.browser.style.display = "none";
              navigate(created.browser, app.url);
            }
          }
          state.share = share;
          state.pair = pair;
          if (state.mode) fitSecondaryBrowsers();
        }
        markTiles();
        ctx.syncAppPanelBrowserActivity();
      };
      ctx.registerCleanup(() => {
        ctx.recreateLoadedPanels = fallbackRecreatePanels;
        delete ctx.syncSecondaryToolbarPreferences;
      });
      ctx.openStartupSinglePanel = (app) => origOpen.call(apps, app);
      ctx.openStartupTriplePair = (id) => {
        const pair = id && ctx.linkedPairFor?.(id);
        return pair ? showPair(pair, { promoteMissing: false }) : false;
      };
      // Self-sufficient Triple View startup restore (OW-30): works without ZentralStartup
      // and even when no outer coordinator runs the startup loop (uses loader/ZentralRuntime).
      let cancelSelfStartup = null;
      if (
        !ctx.startupPanelCoordinator &&
        typeof window.ZentralRuntime?.whenNativeReady === "function"
      ) {
        const readStartup = () => {
          if (typeof window.ZentralRuntime?.readStartupPanel === "function")
            return window.ZentralRuntime.readStartupPanel();
          try {
            const value = JSON.parse(
              ctx.getPref("zen.workspace.bgalazka.open_at_startup", "null"),
            );
            return value &&
              typeof value.id === "string" &&
              value.id.length > 0 &&
              ["single", "triple"].includes(value.mode)
              ? value
              : null;
          } catch (_) {
            return null;
          }
        };
        const initialSelection = readStartup();
        if (initialSelection?.mode === "triple") {
          const hoverPref =
            ctx.BGALAZKA_EXT_PREFS?.HOVER_REVEAL_PANEL ||
            "zen.workspace.bgalazka.hover_reveal_panel";
          if (typeof ctx.setPref === "function") ctx.setPref(hoverPref, true);
          else {
            try {
              Services.prefs.setBoolPref(hoverPref, true);
            } catch (_) {}
          }
          let attempted = false;
          const trySelfRestore = () => {
            const sel = readStartup();
            if (
              !sel ||
              sel.mode !== "triple" ||
              !ctx.getPref("zen.workspace.apps.sidebar.enabled", true)
            )
              return true;
            if (!attempted && root()?.hasAttribute("open")) return true;
            const pair = ctx.linkedPairFor?.(sel.id);
            if (!pair) return true;
            attempted = true;
            const already =
              root()?.hasAttribute("open") &&
              ui.getAttribute("bgalazka-triple-view") === "true" &&
              ctx
                .getAllAppBrowsers()
                .some((b) => b.isConnected && b._bgalazkaAppId === sel.id);
            if (!already && !ctx.openStartupTriplePair(sel.id)) return false;
            const opened =
              root()?.hasAttribute("open") &&
              ui.getAttribute("bgalazka-triple-view") === "true";
            if (opened) ctx.onStartupPanelOpened?.();
            return opened;
          };
          cancelSelfStartup = window.ZentralRuntime.whenNativeReady(() => {
            ctx.retryPanelTask?.("secondary-startup-triple", trySelfRestore);
          });
        }
      }
      apps.openPanel = function (app) {
        const pair = app?.id && ctx.linkedPairFor(app.id);
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
        ctx.unlinkTriplePair(id);
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
          timer: ctx.setTimeout(() => {
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
        if (pending) ctx.clearTimeout(pending.timer);
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
        // A short click always reaches its own action. Only a completed
        // long press is consumed above; mode exit belongs to a second hold.
      };
      window.addEventListener("pointerdown", onDown, true);
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", cancelPending, true);
      window.addEventListener("pointercancel", cancelPending, true);
      window.addEventListener("blur", cancelPending);
      window.addEventListener("click", onClick, true);
      ctx.registerCleanup(() => {
        cancelPending();
        leaveMode();
        window.removeEventListener("pointerdown", onDown, true);
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", cancelPending, true);
        window.removeEventListener("pointercancel", cancelPending, true);
        window.removeEventListener("blur", cancelPending);
        window.removeEventListener("click", onClick, true);
        cancelSelfStartup?.();
        ctx.cancelPanelRetry?.("secondary-startup-triple");
        delete ctx.openStartupSinglePanel;
        delete ctx.openStartupTriplePair;
        apps.openPanel = origOpen;
        apps.closePanel = origClose;
        apps.closeApp = origCloseApp;
        apps.removeApp = origRemoveApp;
        apps.renderGrid = origRender;
      });
    })();
  });
})();
