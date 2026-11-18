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
  const ZentralRuntime =
    window.ZentralRuntime || window.__zentralStandaloneRuntime;

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
  // A reader binding belongs to exactly one native tab strip.
  function readerBindingAction(enabled, current, next) {
    if (!enabled || !next) return current ? "unbind" : "keep";
    if (!current) return "bind";
    return current === next ? "keep" : "replace";
  }
  // Small pure helpers the card's behaviour is built from, exported for the suite: a clamped delay, a known side,
  // and a URL that is only a URL when the platform agrees.
  // The bounds the running card uses (see CARD_DELAY_LIMITS in start()); kept here so the seam has no inner state.
  const CARD_DELAY_BOUNDS = Object.freeze({ hover: [0, 2000], hide: [0, 5000] });
  function clampCardDelay(name, raw) {
    const [min, max] = CARD_DELAY_BOUNDS[name] || [0, 0];
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return Math.max(min, Math.min(max, Math.round(value)));
  }
  function cleanReaderSide(value) {
    return ["auto", "left", "right"].includes(value) ? value : "auto";
  }
  function cleanCardGap(raw) {
    const value = parseFloat(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(32, value)) : 6;
  }
  function urlsInText(text, hrefOf) {
    const re = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
    const out = [];
    let match;
    while ((match = re.exec(String(text ?? "")))) {
      const href = typeof hrefOf === "function" ? hrefOf(match[0]) : "";
      if (href) out.push(href);
    }
    return out;
  }
  if (window.__zentralRssTestSeam) {
    window.__zentralRssTestSeam.readerBindingAction = readerBindingAction;
    window.__zentralRssTestSeam.clampCardDelay = clampCardDelay;
    window.__zentralRssTestSeam.cleanReaderSide = cleanReaderSide;
    window.__zentralRssTestSeam.cleanCardGap = cleanCardGap;
    window.__zentralRssTestSeam.urlsInText = urlsInText;
    window.__zentralRssTestSeam.LIMITS = CARD_DELAY_BOUNDS;
  }
  (function () {
    function start({ lifecycle, runtime: hostRuntime } = {}) {
      const cleanups = [];
      const registerCleanup = (fn) => cleanups.push(fn);
      const getRuntime = () =>
        hostRuntime || window.ZentralRuntime || window.__zentralStandaloneRuntime || null;
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
      // OW-94 (plan B7.1): the shared pause switch. Absent in a standalone build with no full pack around it, and a
      // missing switch means "not paused", which is exactly the behaviour from before.
      const rssPerformance = window.ZentralRuntime?.performance || null;
      const performancePaused = () => Boolean(rssPerformance?.isPaused?.());
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
      // Own hover card for live-folder articles, backed by the shared
      // createSidebarHoverCard engine (full pack + standalone). Replaces the
      // native tab tooltip (only for those tabs) and continues with the next
      // article after a dismiss, so no extra mouse movement is needed.
      let readerContainer = null;
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
          getComputedStyle(document.documentElement).getPropertyValue(
            "--bgalazka-look-rss-card-gap",
          ),
        );
        return Number.isFinite(value) ? Math.max(0, Math.min(32, value)) : 6;
      };
      // The card's look is owned by the Look custom properties on the root
      // element. Only the behavior switches are applied here.
      function applyCardParts(node) {
        const target = node || rssCard?.getNode?.();
        if (!target) return;
        const folderEl = target.querySelector(".rc-folder");
        const urlEl = target.querySelector(".rc-url");
        const actionsEl = target.querySelector(".rc-actions");
        if (folderEl) folderEl.hidden = !getPref(EXT_PREFS.RSS_CARD_SHOW_FOLDER, true);
        if (urlEl) urlEl.hidden = !getPref(EXT_PREFS.RSS_CARD_SHOW_URL, true);
        if (actionsEl) actionsEl.hidden = !getPref(EXT_PREFS.RSS_CARD_SHOW_BUTTONS, true);
        target.dataset.side = readerSide();
      }
      // A behavior change only restyles the open card; it never triggers a
      // folder refresh.
      function applyCardStyle() {
        applyCardParts();
        rssCard?.refresh?.();
      }
      const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
      const HTML_HINT_RE =
        /<[a-z!/][\s\S]*?>|&(?:#\d+|#x[0-9a-f]+|[a-z0-9]+);/i;

      function normalizeHttpUrl(raw, baseUrl = "") {
        if (!raw) return "";
        const trimmed = String(raw).trim();
        if (!trimmed) return "";
        const candidate = /^www\./i.test(trimmed)
          ? "https://" + trimmed
          : trimmed;
        try {
          const parsed = baseUrl
            ? new URL(candidate, baseUrl)
            : new URL(candidate);
          if (["http:", "https:", "mailto:"].includes(parsed.protocol))
            return parsed.href;
        } catch (_) {}
        return "";
      }

      function splitTrailingPunctuation(rawUrl) {
        let url = rawUrl;
        let trailing = "";
        while (url.length) {
          const last = url[url.length - 1];
          if (/[.,;:!?'"]/.test(last)) {
            trailing = last + trailing;
            url = url.slice(0, -1);
            continue;
          }
          if (last === ")") {
            const opens = (url.match(/\(/g) || []).length;
            const closes = (url.match(/\)/g) || []).length;
            if (closes > opens) {
              trailing = last + trailing;
              url = url.slice(0, -1);
              continue;
            }
          }
          if (last === "]") {
            const opens = (url.match(/\[/g) || []).length;
            const closes = (url.match(/\]/g) || []).length;
            if (closes > opens) {
              trailing = last + trailing;
              url = url.slice(0, -1);
              continue;
            }
          }
          break;
        }
        return { url, trailing };
      }

      function createLinkNode(href, label) {
        const a = document.createElement("a");
        a.className = "rc-link";
        a.href = href;
        a.title = href;
        a.textContent = label || href;

        const openLink = (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            if (typeof window.openTrustedLinkIn === "function") {
              window.openTrustedLinkIn(href, "tab");
            } else if (
              window.gBrowser &&
              typeof window.gBrowser.addTrustedTab === "function"
            ) {
              window.gBrowser.selectedTab = window.gBrowser.addTrustedTab(href);
            } else if (
              window.gBrowser &&
              typeof window.gBrowser.addTab === "function"
            ) {
              window.gBrowser.selectedTab = window.gBrowser.addTab(href, {
                triggeringPrincipal:
                  Services.scriptSecurityManager.getSystemPrincipal(),
              });
            } else {
              window.open(href, "_blank");
            }
          } catch (err) {
            console.error("Failed to open RSS link:", err);
          }
        };

        a.addEventListener("click", (e) => {
          if (e.button === 0) openLink(e);
        });
        a.addEventListener("auxclick", (e) => {
          if (e.button === 1) openLink(e);
        });

        return a;
      }

      function appendLinkifiedText(target, text, baseUrl) {
        if (!text) return;
        URL_RE.lastIndex = 0;
        let lastIndex = 0;
        let match;
        while ((match = URL_RE.exec(text)) !== null) {
          const start = match.index;
          if (start > lastIndex) {
            target.appendChild(
              document.createTextNode(text.slice(lastIndex, start)),
            );
          }
          const { url, trailing } = splitTrailingPunctuation(match[0]);
          const href = normalizeHttpUrl(url, baseUrl);
          if (href) {
            target.appendChild(createLinkNode(href, url));
          } else {
            target.appendChild(document.createTextNode(url));
          }
          if (trailing) {
            target.appendChild(document.createTextNode(trailing));
          }
          lastIndex = start + match[0].length;
        }
        if (lastIndex < text.length) {
          target.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
      }

      function renderRichText(container, rawText, baseUrl = "") {
        container.replaceChildren();
        const source = String(rawText || "").trim();
        if (!source) return;
        if (!HTML_HINT_RE.test(source)) {
          appendLinkifiedText(container, source, baseUrl);
        } else {
          const doc = new DOMParser().parseFromString(source, "text/html");
          appendLinkifiedText(container, doc.body?.textContent || "", baseUrl);
        }
      }
      // The article that follows the dismissed one inside the same folder.
      function nextArticle(folder, tab) {
        if (!folder) return null;
        const items = [
          ...folder.querySelectorAll("tab, .tabbrowser-tab"),
        ].filter(
          (item) => itemTab(item) && !item.hasAttribute("zen-empty-tab"),
        );
        const index = items.indexOf(tab);
        if (index < 0) return items[0] || null;
        return items[index + 1] || items[index - 1] || null;
      }
      function getFullTabText(tab) {
        if (!tab) return "";
        const candidates = [];

        // Firefox's internal untruncated tab label property
        if (typeof tab._fullLabel === "string" && tab._fullLabel) {
          candidates.push(tab._fullLabel);
        }

        // SessionStore lazy data (used for unloaded / pending RSS live-folder tabs)
        try {
          const ss = window.SessionStore || globalThis.SessionStore;
          if (ss && typeof ss.getLazyTabValue === "function") {
            const lazyTitle = ss.getLazyTabValue(tab, "title");
            if (typeof lazyTitle === "string" && lazyTitle)
              candidates.push(lazyTitle);
          }
          if (tab.__SS_lazyData?.title) {
            candidates.push(tab.__SS_lazyData.title);
          }
        } catch (_) {}

        // Only fall back to the expensive getTabState serialization if the fast
        // properties did not already yield something longer than tab.label.
        const labelLen = typeof tab.label === "string" ? tab.label.length : 0;
        const fastBest = candidates.reduce(
          (max, c) => Math.max(max, String(c).trim().length),
          0,
        );
        if (fastBest <= labelLen) {
          try {
            const ss = window.SessionStore || globalThis.SessionStore;
            if (ss && typeof ss.getTabState === "function") {
              const state = JSON.parse(ss.getTabState(tab));
              const entry =
                state?.entries?.[(state.index || 1) - 1] || state?.entries?.[0];
              if (entry?.title) candidates.push(entry.title);
            }
          } catch (_) {}
        }

        // Linked browser contentTitle & Places/Zen custom attributes
        if (tab.linkedBrowser?.contentTitle) {
          candidates.push(tab.linkedBrowser.contentTitle);
        }
        for (const attr of [
          "data-rss-fulltext",
          "zen-original-label",
          "tooltiptext",
          "label",
        ]) {
          const val = tab.getAttribute?.(attr);
          if (val) candidates.push(val);
        }
        if (typeof tab.label === "string" && tab.label) {
          candidates.push(tab.label);
        }

        // Pick the longest valid candidate so the 250-char truncated `tab.label`
        // loses to the full title stored elsewhere.
        let best = "";
        for (const c of candidates) {
          const str = String(c).trim();
          if (str.length > best.length) {
            best = str;
          }
        }
        return best;
      }
      let rssCard = null;
      function ensureRssCard() {
        if (rssCard) return rssCard;
        const factory = getRuntime()?.createSidebarHoverCard;
        if (typeof factory !== "function") return null;
        rssCard = factory({
          id: "bgalazka-rss-card",
          describeTarget: false,
          defaultWidth: 340,
          defaultHeight: 120,
          isEnabled: () => !disposed && readerOn(),
          matchTarget: itemTab,
          isValid: (tab) => !disposed && readerOn() && !!tab && tab.isConnected !== false && !!itemTab(tab),
          getShowDelay: hoverDelay,
          getHideDelay: hideDelay,
          getSide: readerSide,
          getGap: cardGap,
          suppressTooltipWhenClosed: true,
          shouldSuppressTooltip: () => getPref(EXT_PREFS.RSS_CARD_REPLACE_TOOLTIP, true),
          onCreate(c, ctrl) {
            const makeEl = (tag, cls, text) => {
              const el = document.createElement(tag);
              if (cls) el.className = cls;
              if (text) el.textContent = text;
              return el;
            };
            const folderEl = makeEl("div", "rc-folder");
            const textEl = makeEl("div", "rc-text");
            const urlEl = makeEl("div", "rc-url");
            const actionsEl = makeEl("div", "rc-actions");
            for (const [action, label] of [
              ["open", "Open"],
              ["dismiss", "Dismiss"],
              ["all", "Dismiss all"],
            ]) {
              const btn = makeEl("button", "", label);
              btn.setAttribute("data-a", action);
              btn.dataset.a = action;
              actionsEl.append(btn);
            }
            c.append(folderEl, textEl, urlEl, actionsEl);
            c.addEventListener("click", (e) => {
              const btn = e.target.closest?.("button");
              const a = btn?.getAttribute?.("data-a") || btn?.dataset?.a;
              const tab = ctrl.getTarget();
              if (!a || !tab) return;
              if (a === "open") {
                window.gBrowser.selectedTab = tab;
                ctrl.hide();
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
                ctrl.hide();
                tabs.forEach((t) => window.gBrowser.removeTab(t, { animate: false }));
              }
            });
            applyCardParts(c);
          },
          render(c, tab) {
            const folder = tab.closest("zen-folder");
            const folderEl = c.querySelector(".rc-folder");
            if (folderEl) folderEl.textContent = folder?.label || folder?.getAttribute("label") || "";
            const url = tabUrl(tab);
            const rcText = c.querySelector(".rc-text");
            if (rcText) {
              rcText.className = "rc-text";
              renderRichText(rcText, getFullTabText(tab), url);
            }
            const urlEl = c.querySelector(".rc-url");
            if (urlEl) urlEl.textContent = url;
            applyCardParts(c);
          },
        });
        registerCleanup(() => { rssCard?.destroy(); rssCard = null; });
        return rssCard;
      }
      // A dismiss never hides the card first: it continues with the next
      // article, so the reader sees no flash of a closed card.
      function dismiss(tab, viaPointer) {
        if (!tab) return;
        const folder = tab.closest("zen-folder");
        const next = nextArticle(folder, tab);
        window.gBrowser.removeTab(tab, { animate: false });
        const ctrl = ensureRssCard();
        if (!ctrl) return;
        ctrl.retarget(tab, {
          viaPointer: !!viaPointer,
          allowPointer: getPref(EXT_PREFS.RSS_CARD_RETARGET, true),
          nextTarget: next,
        });
      }
      const onOver = (e) => { ensureRssCard()?.over(e); };
      const onMove = (e) => { ensureRssCard()?.move(e); };
      const onAux = (e) => {
        if (e.button !== 1 || !readerOn()) return;
        if (!getPref(EXT_PREFS.RSS_CARD_MMB_DISMISS, true)) return;
        const tab = itemTab(e.target);
        if (!tab) return;
        e.preventDefault();
        e.stopPropagation();
        dismiss(tab, true);
      };
      const onPopup = (e) => { ensureRssCard()?.popup(e); };
      const onKeyDown = (e) => { ensureRssCard()?.key(e); };
      const onContainerLeave = () => { rssCard?.scheduleHide?.(); };
      function unbindReader() {
        const container = readerContainer;
        if (!container) return;
        readerContainer = null;
        container.removeEventListener("mouseover", onOver);
        container.removeEventListener("mousemove", onMove);
        container.removeEventListener("auxclick", onAux, true);
        container.removeEventListener("mouseleave", onContainerLeave);
        window.removeEventListener("popupshowing", onPopup, true);
        window.removeEventListener("keydown", onKeyDown);
      }
      function resetReaderCard() {
        rssCard?.hide?.();
      }
      registerCleanup(() => { unbindReader(); resetReaderCard(); });
      function syncReader() {
        const container = window.gBrowser?.tabContainer || null;
        applyCardStyle();
        const action = readerBindingAction(readerOn(), readerContainer, container);
        if (action === "unbind" || action === "replace") {
          unbindReader();
          resetReaderCard();
        }
        if (action === "bind" || action === "replace") {
          readerContainer = container;
          container.addEventListener("mouseover", onOver);
          container.addEventListener("mousemove", onMove);
          container.addEventListener("auxclick", onAux, true);
          container.addEventListener("mouseleave", onContainerLeave);
          window.addEventListener("popupshowing", onPopup, true);
          window.addEventListener("keydown", onKeyDown);
        }
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
        // OW-94: a paused pass does not scan. Folders change while a person is not gaming too, so the observer stays
        // attached and the scan that follows the resume picks up everything it missed — this only skips the work.
        if (performancePaused()) {
          if (rssScanTimer !== null) clearTimeout(rssScanTimer);
          rssScanTimer = null;
          return;
        }
        safeScanRssFolders();
        if (!rssObserver && container) {
          rssObservedContainer = container;
          rssObserver = new MutationObserver(() => {
            if (disposed || !rssEnabled() || rssScanTimer !== null) return;
            rssScanTimer = setTimeout(() => {
              rssScanTimer = null;
              if (performancePaused()) return;
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

      // OW-94: resume runs the scan the paused window skipped. Registered with the module's own cleanups, and a
      // switch that is missing entirely simply has no listener to add.
      if (rssPerformance?.subscribe) {
        const unsubscribe = rssPerformance.subscribe((paused) => {
          if (!paused && !disposed) syncRssFolderDisplay();
        });
        if (unsubscribe) cleanups.push(() => unsubscribe());
      }

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
    if (ZentralRuntime) ZentralRuntime.register({ id: "rss", init: start });
    else standaloneReady(start);
  })();
})();
