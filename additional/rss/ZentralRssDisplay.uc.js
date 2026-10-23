/*
 * ZENTRAL FILE GUIDE - additional/rss/ZentralRssDisplay.uc.js
 *
 * Purpose: Independent RSS folder badge/display refresh driven by relevant native events and preferences.
 * Interaction / execution: Runtime exposes services.rss.refresh used by FeatureSettings; standalone mode
 *   waits for native browser readiness. No Apps/panel suite dependency.
 * Ownership / failure: Owns RSS observer/listener cleanup and its stylesheet. Preserve event-driven refresh
 *   rather than reinstalling a permanent folder repair scan.
 * Reader card: The card's appearance is owned by the Look custom properties written by
 *   extension/appearance/ZentralAppearance.js. This file owns the behavior switches
 *   (zen.workspace.bgalazka.rss.card_*): hover and hide delay, side, visible parts,
 *   middle-click dismiss, pointer re-target, dismiss-all confirmation and tooltip replacement.
 * Registration: rss
 * Loaded/created by: loader/ZentralCatalog.js
 * Literal DOM event subscriptions: unload
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
  const ZentralRuntime = window.ZentralRuntime || window.__zentralStandaloneRuntime;

  function standaloneReady(start) {
    let started = false;
    const run = () => {
      if (started || !window.gBrowser) return;
      started = true;
      try {
        Services.obs.removeObserver(
          observer,
          "browser-delayed-startup-finished",
        );
      } catch (_) {}
      start();
    };
    const observer = {
      observe(subject, topic) {
        if (subject === window && topic === "browser-delayed-startup-finished")
          run();
      },
    };
    if (
      window.gBrowser &&
      (!window.gBrowserInit || window.gBrowserInit.delayedStartupFinished)
    )
      run();
    else {
      Services.obs.addObserver(observer, "browser-delayed-startup-finished");
      window.addEventListener(
        "unload",
        () => {
          try {
            Services.obs.removeObserver(
              observer,
              "browser-delayed-startup-finished",
            );
          } catch (_) {}
        },
        { once: true },
      );
      if (window.gBrowserInit?.delayedStartupFinished) run();
    }
  }
  (function () {
    function start({ lifecycle } = {}) {
      const cleanups = [];
      const registerCleanup = (fn) => cleanups.push(fn);
      const getPref = (key, fallback) =>
        Services.prefs.getBoolPref(key, fallback);
      // Colors are optional overrides: an unset (or invalid) value keeps the
      // theme token that the stylesheet falls back to.
      const getStringPref = (key, fallback) => {
        try {
          if (!Services.prefs.prefHasUserValue(key)) return fallback;
          return Services.prefs.getStringPref(key);
        } catch (_) {
          return fallback;
        }
      };
      const getNumberPref = (key, fallback) => {
        try {
          if (!Services.prefs.prefHasUserValue(key)) return fallback;
          return Services.prefs.getIntPref(key);
        } catch (_) {
          return fallback;
        }
      };
      const EXT_PREFS = {
        RSS_HIDE_EMPTY: "zen.workspace.bgalazka.rss.hide_empty",
        RSS_COMPACT_HEADERS: "zen.workspace.bgalazka.rss.compact_headers",
        RSS_READER_CARD: "zen.workspace.bgalazka.rss.reader_card",
        RSS_CARD_HOVER_DELAY: "zen.workspace.bgalazka.rss.card_hover_delay",
        RSS_CARD_HIDE_DELAY: "zen.workspace.bgalazka.rss.card_hide_delay",
        RSS_CARD_SIDE: "zen.workspace.bgalazka.rss.card_side",
        RSS_CARD_SHOW_FOLDER: "zen.workspace.bgalazka.rss.card_show_folder",
        RSS_CARD_SHOW_URL: "zen.workspace.bgalazka.rss.card_show_url",
        RSS_CARD_SHOW_BUTTONS: "zen.workspace.bgalazka.rss.card_show_buttons",
        RSS_CARD_MMB_DISMISS: "zen.workspace.bgalazka.rss.card_mmb_dismiss",
        RSS_CARD_RETARGET: "zen.workspace.bgalazka.rss.card_retarget",
        RSS_CARD_CONFIRM_ALL: "zen.workspace.bgalazka.rss.card_confirm_all",
        RSS_CARD_REPLACE_TOOLTIP:
          "zen.workspace.bgalazka.rss.card_replace_tooltip",
      };
      // Behavior delays are bounded so a stray value can never make the card
      // unusable. The card's look lives in the Look custom properties.
      const CARD_DELAY_LIMITS = Object.freeze({
        hover: [0, 2000],
        hide: [0, 5000],
      });
      const CARD_DELAY_DEFAULTS = Object.freeze({
        hover: 0,
        hide: 250,
      });
      const rssMarkedFolders = new Set();
      let rssScanTimer = null;
      let rssObserver = null,
        rssObservedContainer = null,
        nativeBinding = null;
      let disposed = false;
      const readerOn = () => getPref(EXT_PREFS.RSS_READER_CARD, false);
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
            [
              ...folder.querySelectorAll("tab, .tabbrowser-tab, zen-folder"),
            ].some((child) => {
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
            });
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

      // ---- Reader card -------------------------------------------------
      // Own hover card for live-folder articles. Replaces the native tab
      // tooltip (only for those tabs) and continues with the next article
      // after a dismiss, so no extra mouse movement is needed.
      let card = null,
        cardTab = null,
        hideTimer = null,
        showTimer = null,
        showTab = null,
        lastXY = null,
        readerBound = false;
      const itemTab = (el) => {
        const tab = el?.closest?.("tab, .tabbrowser-tab");
        if (!tab) return null;
        if (tab.hasAttribute("zen-live-folder-item-id")) return tab;
        const folder = tab.closest("zen-folder");
        return folder && isNativeLiveFolder(folder) ? tab : null;
      };
      const tabUrl = (tab) => {
        try {
          return tab.linkedBrowser?.currentURI?.spec || "";
        } catch (_) {
          return "";
        }
      };
      const cancelHide = () => {
        clearTimeout(hideTimer);
        hideTimer = null;
      };
      const cancelShow = () => {
        clearTimeout(showTimer);
        showTimer = null;
        showTab = null;
      };
      const cardDelay = (name, key) => {
        const [min, max] = CARD_DELAY_LIMITS[name];
        const raw = Number(getNumberPref(key, CARD_DELAY_DEFAULTS[name]));
        if (!Number.isFinite(raw)) return CARD_DELAY_DEFAULTS[name];
        return Math.max(min, Math.min(max, Math.round(raw)));
      };
      const hoverDelay = () =>
        cardDelay("hover", EXT_PREFS.RSS_CARD_HOVER_DELAY);
      const hideDelay = () => cardDelay("hide", EXT_PREFS.RSS_CARD_HIDE_DELAY);
      const readerSide = () => {
        const value = getStringPref(EXT_PREFS.RSS_CARD_SIDE, "auto");
        return ["auto", "left", "right"].includes(value) ? value : "auto";
      };
      // The distance to the sidebar follows the Look gap value.
      const cardGap = () => {
        const value = parseFloat(
          getComputedStyle(document.documentElement)
            .getPropertyValue("--bgalazka-look-rss-card-gap"),
        );
        return Number.isFinite(value)
          ? Math.max(0, Math.min(32, value))
          : 6;
      };
      // The card's look is owned by the Look custom properties on the root
      // element. Only the behavior switches are applied here.
      function applyCardParts() {
        if (!card) return;
        card.querySelector(".rc-folder").hidden = !getPref(
          EXT_PREFS.RSS_CARD_SHOW_FOLDER,
          true,
        );
        card.querySelector(".rc-url").hidden = !getPref(
          EXT_PREFS.RSS_CARD_SHOW_URL,
          true,
        );
        card.querySelector(".rc-actions").hidden = !getPref(
          EXT_PREFS.RSS_CARD_SHOW_BUTTONS,
          true,
        );
        card.dataset.side = readerSide();
      }
      // A behavior change only restyles the open card; it never triggers a
      // folder refresh.
      function applyCardStyle() {
        applyCardParts();
        if (card && cardTab && !card.hidden) showCard(cardTab);
      }
      function hideCard(delay = 0) {
        cancelShow();
        cancelHide();
        hideTimer = setTimeout(() => {
          hideTimer = null;
          if (card) card.hidden = true;
          cardTab = null;
        }, Math.max(0, delay));
      }
      function ensureCard() {
        if (card) return card;
        card = document.createElement("div");
        card.id = "bgalazka-rss-card";
        card.hidden = true;
        card.innerHTML =
          '<div class="rc-folder"></div><div class="rc-text"></div>' +
          '<div class="rc-url"></div><div class="rc-actions">' +
          '<button data-a="open">Open</button>' +
          '<button data-a="dismiss">Dismiss</button>' +
          '<button data-a="all">Dismiss all</button></div>';
        card.addEventListener("mouseenter", cancelHide);
        card.addEventListener("mouseleave", () => hideCard(hideDelay()));
        card.addEventListener("click", (e) => {
          const a = e.target.closest("button")?.dataset.a;
          if (!a || !cardTab) return;
          const tab = cardTab;
          if (a === "open") {
            gBrowser.selectedTab = tab;
            hideCard();
          } else if (a === "dismiss") dismiss(tab, false);
          else if (a === "all") {
            const folder = tab.closest("zen-folder");
            const tabs = folder
              ? [...folder.querySelectorAll("tab, .tabbrowser-tab")].filter(
                  (t) => itemTab(t) && !t.hasAttribute("zen-empty-tab"),
                )
              : [tab];
            if (
              getPref(EXT_PREFS.RSS_CARD_CONFIRM_ALL, false) &&
              !window.confirm(
                "Dismiss all " +
                  tabs.length +
                  " article" +
                  (tabs.length === 1 ? "" : "s") +
                  " in this folder?",
              )
            )
              return;
            hideCard();
            tabs.forEach((t) => gBrowser.removeTab(t, { animate: false }));
          }
        });
        document.documentElement.appendChild(card);
        applyCardParts();
        registerCleanup(() => card?.remove());
        return card;
      }
      // The article that follows the dismissed one inside the same folder.
      function nextArticle(folder, tab) {
        if (!folder) return null;
        const items = [
          ...folder.querySelectorAll("tab, .tabbrowser-tab"),
        ].filter((item) => itemTab(item) && !item.hasAttribute("zen-empty-tab"));
        const index = items.indexOf(tab);
        if (index < 0) return items[0] || null;
        return items[index + 1] || items[index - 1] || null;
      }
      function showCard(tab) {
        if (!tab) return;
        const c = ensureCard();
        cancelHide();
        cancelShow();
        cardTab = tab;
        const folder = tab.closest("zen-folder");
        c.querySelector(".rc-folder").textContent =
          folder?.label || folder?.getAttribute("label") || "";
        c.querySelector(".rc-text").textContent =
          tab.label || tab.getAttribute("label") || "";
        const url = tabUrl(tab);
        c.querySelector(".rc-url").textContent = url;
        applyCardParts();
        c.hidden = false;
        const side = document.getElementById("navigator-toolbox");
        const sr = side?.getBoundingClientRect();
        const tr = tab.getBoundingClientRect();
        const w = c.offsetWidth,
          h = c.offsetHeight;
        const onRight = sr && sr.left > window.innerWidth / 2;
        const sidePref = readerSide();
        const placeLeft =
          sidePref === "left" ? true : sidePref === "right" ? false : onRight;
        const gap = cardGap();
        let left = placeLeft ? tr.left - w - gap : tr.right + gap;
        // Fall back to the other side when the chosen one has no room.
        if (left < 4) {
          const flipped = tr.right + gap;
          if (flipped + w <= window.innerWidth - 4) left = flipped;
        }
        c.style.left =
          Math.max(4, Math.min(left, window.innerWidth - w - 4)) + "px";
        c.style.top =
          Math.max(4, Math.min(tr.top, window.innerHeight - h - 4)) + "px";
      }
      // A dismiss never hides the card first: it continues with the next
      // article, so the reader sees no flash of a closed card.
      function dismiss(tab, viaPointer) {
        if (!tab) return;
        const folder = tab.closest("zen-folder");
        const next = nextArticle(folder, tab);
        gBrowser.removeTab(tab, { animate: false });
        if (
          viaPointer &&
          getPref(EXT_PREFS.RSS_CARD_RETARGET, true) &&
          lastXY
        ) {
          // The list shifts under a still pointer: re-target the item that
          // moved under it. The card stays open while that happens.
          window.requestAnimationFrame(() => {
            if (!readerOn()) return;
            const under = itemTab(document.elementFromPoint(...lastXY));
            if (under) showCard(under);
            else if (next?.isConnected) showCard(next);
            else hideCard();
          });
          return;
        }
        if (next) {
          showCard(next);
          return;
        }
        hideCard();
      }
      const onOver = (e) => {
        if (!readerOn()) return;
        lastXY = [e.clientX, e.clientY];
        const tab = itemTab(e.target);
        if (tab) {
          scheduleShow(tab);
          return;
        }
        if (card && !card.hidden && !card.contains(e.target))
          hideCard(hideDelay());
      };
      const scheduleShow = (tab) => {
        const delay = hoverDelay();
        if (delay <= 0) {
          cancelShow();
          showCard(tab);
          return;
        }
        if (showTimer !== null && showTab === tab) return;
        cancelShow();
        showTab = tab;
        showTimer = setTimeout(() => {
          showTimer = null;
          showTab = null;
          if (readerOn()) showCard(tab);
        }, delay);
      };
      const onMove = (e) => (lastXY = [e.clientX, e.clientY]);
      const onAux = (e) => {
        if (e.button !== 1 || !readerOn()) return;
        if (!getPref(EXT_PREFS.RSS_CARD_MMB_DISMISS, true)) return;
        const tab = itemTab(e.target);
        if (!tab) return;
        e.preventDefault();
        e.stopPropagation();
        dismiss(tab, true);
      };
      const onPopup = (e) => {
        if (!readerOn() || e.target.id !== "tabbrowser-tab-tooltip") return;
        if (!getPref(EXT_PREFS.RSS_CARD_REPLACE_TOOLTIP, true)) return;
        if (itemTab(e.target.triggerNode)) e.preventDefault();
      };
      const onKeyDown = (e) => {
        if (e.key !== "Escape" || !readerOn()) return;
        if (!card || card.hidden) return;
        e.preventDefault();
        e.stopPropagation();
        hideCard();
      };
      const onContainerLeave = () => hideCard(hideDelay());
      function syncReader() {
        const container = window.gBrowser?.tabContainer;
        // Appearance preferences reach the card through the same refresh path
        // as the folder state, so a change applies without a restart.
        applyCardStyle();
        if (readerOn() && container && !readerBound) {
          readerBound = true;
          container.addEventListener("mouseover", onOver);
          container.addEventListener("mousemove", onMove);
          container.addEventListener("auxclick", onAux, true);
          container.addEventListener("mouseleave", onContainerLeave);
          window.addEventListener("popupshowing", onPopup, true);
          window.addEventListener("keydown", onKeyDown);
          registerCleanup(() => {
            container.removeEventListener("mouseover", onOver);
            container.removeEventListener("mousemove", onMove);
            container.removeEventListener("auxclick", onAux, true);
            container.removeEventListener("mouseleave", onContainerLeave);
            window.removeEventListener("popupshowing", onPopup, true);
            window.removeEventListener("keydown", onKeyDown);
          });
        } else if (!readerOn()) hideCard();
      }
      function syncRssFolderDisplay() {
        if (disposed) return;
        syncReader();
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
          if (rssScanTimer !== null) clearTimeout(rssScanTimer);
          rssScanTimer = null;
          rssObserver?.disconnect();
          rssObserver = rssObservedContainer = null;
          clearRssMarks();
          return;
        }
        const container = window.gBrowser?.tabContainer;
        if (rssObserver && rssObservedContainer !== container) {
          rssObserver.disconnect();
          rssObserver = rssObservedContainer = null;
          if (rssScanTimer !== null) clearTimeout(rssScanTimer);
          rssScanTimer = null;
        }
        safeScanRssFolders();
        if (!rssObserver && container) {
          rssObservedContainer = container;
          rssObserver = new MutationObserver(() => {
            if (disposed || !rssEnabled() || rssScanTimer !== null) return;
            rssScanTimer = setTimeout(() => {
              rssScanTimer = null;
              safeScanRssFolders();
            }, 100);
          });
          rssObserver.observe(container, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
              "is-live-folder",
              "isLiveFolder",
              "zen-live-folder",
              "data-is-live-folder",
              "zen-live-folder-item-id",
              "zen-empty-tab",
              "zen-folder-empty-tab",
              "selected",
            ],
          });
        }
        nativeBinding?.check();
      }
      // An enabled RSS setting must recover a late/replaced native tab strip.
      // Core owns bounded probes and lifecycle events; no permanent scan loop.
      if (lifecycle)
        nativeBinding = lifecycle.watchNative({
          name: "rss-tab-strip",
          prefs: [
            EXT_PREFS.RSS_HIDE_EMPTY,
            EXT_PREFS.RSS_COMPACT_HEADERS,
            EXT_PREFS.RSS_READER_CARD,
          ],
          enabled: () => rssEnabled() || readerOn(),
          resolve: () => window.gBrowser?.tabContainer || null,
          events: ["activate", "aftercustomization", "TabOpen"],
          attach(container, child) {
            child.own(() => {
              if (rssObservedContainer !== container) return;
              rssObserver?.disconnect();
              rssObserver = rssObservedContainer = null;
              if (rssScanTimer !== null) clearTimeout(rssScanTimer);
              rssScanTimer = null;
            });
            syncRssFolderDisplay();
            return {
              isCurrent: () =>
                rssObservedContainer === container && !!rssObserver,
            };
          },
        });
      for (const pref of [
        EXT_PREFS.RSS_HIDE_EMPTY,
        EXT_PREFS.RSS_COMPACT_HEADERS,
        EXT_PREFS.RSS_READER_CARD,
      ]) {
        try {
          Services.prefs.addObserver(pref, syncRssFolderDisplay);
          registerCleanup(() => {
            try {
              Services.prefs.removeObserver(pref, syncRssFolderDisplay);
            } catch (_) {}
          });
        } catch (error) {
          console.warn(
            "[BgalazkaExtension] RSS pref observer unavailable:",
            error,
          );
        }
      }
      // Reader card behavior uses its own light observer: a behavior change
      // restyles the open card and never rescans the feed folders.
      const onReaderBehaviorChanged = () => {
        applyCardStyle();
        syncReader();
      };
      for (const pref of [
        EXT_PREFS.RSS_CARD_HOVER_DELAY,
        EXT_PREFS.RSS_CARD_HIDE_DELAY,
        EXT_PREFS.RSS_CARD_SIDE,
        EXT_PREFS.RSS_CARD_SHOW_FOLDER,
        EXT_PREFS.RSS_CARD_SHOW_URL,
        EXT_PREFS.RSS_CARD_SHOW_BUTTONS,
        EXT_PREFS.RSS_CARD_MMB_DISMISS,
        EXT_PREFS.RSS_CARD_RETARGET,
        EXT_PREFS.RSS_CARD_CONFIRM_ALL,
        EXT_PREFS.RSS_CARD_REPLACE_TOOLTIP,
      ]) {
        try {
          Services.prefs.addObserver(pref, onReaderBehaviorChanged);
          registerCleanup(() => {
            try {
              Services.prefs.removeObserver(pref, onReaderBehaviorChanged);
            } catch (_) {}
          });
        } catch (error) {
          console.warn(
            "[BgalazkaExtension] RSS card pref observer unavailable:",
            error,
          );
        }
      }
      registerCleanup(() => {
        if (rssScanTimer !== null) clearTimeout(rssScanTimer);
        rssObserver?.disconnect();
        clearRssMarks();
        document.documentElement.removeAttribute("bgalazka-rss-hide-empty");
        document.documentElement.removeAttribute(
          "bgalazka-rss-compact-headers",
        );
      });
      syncRssFolderDisplay();

      const api = {
        refresh: syncRssFolderDisplay,
        destroy() {
          if (disposed) return;
          disposed = true;
          nativeBinding?.destroy();
          if (window.ZentralRuntime?.services.rss === api)
            delete window.ZentralRuntime.services.rss;
          cleanups
            .splice(0)
            .reverse()
            .forEach((fn) => fn());
        },
      };
      if (window.ZentralRuntime) ZentralRuntime.services.rss = api;
      window.addEventListener("unload", () => api.destroy(), { once: true });
      return () => api.destroy();
    }
    if (ZentralRuntime)
      ZentralRuntime.register({ id: "rss", init: start });
    else standaloneReady(start);
  })();
})();
