(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime;
  // Feature: panel-toolbar. Imports and exposed are listed in ARCHITECTURE.md.
  // Preparation publishes functions; activation preserves the baseline initialization order.
  ZentralRuntime.registerPart("panel-toolbar", function* (ctx) {
    Object.defineProperties(ctx, {
      QUICK_SWITCH_BUILTIN_TARGETS: {
        configurable: true,
        get: () => QUICK_SWITCH_BUILTIN_TARGETS,
      },
      QUICK_SWITCH_CUSTOM_PREFS: {
        configurable: true,
        get: () => QUICK_SWITCH_CUSTOM_PREFS,
      },
      QUICK_SWITCH_TARGET_PREF_PREFIX: {
        configurable: true,
        get: () => QUICK_SWITCH_TARGET_PREF_PREFIX,
      },
      SEARCH_CUSTOM_ENGINE_PREFS: {
        configurable: true,
        get: () => SEARCH_CUSTOM_ENGINE_PREFS,
      },
      applyForcePanelBlackVisual: {
        configurable: true,
        get: () => applyForcePanelBlackVisual,
      },
      buildSearchUrl: { configurable: true, get: () => buildSearchUrl },
      canPanelNavigate: { configurable: true, get: () => canPanelNavigate },
      ensureWebToolbar: { configurable: true, get: () => ensureWebToolbar },
      forcePanelBlackState: {
        configurable: true,
        get: () => forcePanelBlackState,
        set: (value) => {
          forcePanelBlackState = value;
        },
      },
      getActiveAppBrowser: {
        configurable: true,
        get: () => getActiveAppBrowser,
      },
      isValidQuickSwitchTemplate: {
        configurable: true,
        get: () => isValidQuickSwitchTemplate,
      },
      looksLikeUrl: { configurable: true, get: () => looksLikeUrl },
      navigatePanelHistory: {
        configurable: true,
        get: () => navigatePanelHistory,
      },
      periodicFallbackPollingEnabled: {
        configurable: true,
        get: () => periodicFallbackPollingEnabled,
      },
      refreshBrowserSearchTemplate: {
        configurable: true,
        get: () => refreshBrowserSearchTemplate,
      },
      startWebToolbarPolling: {
        configurable: true,
        get: () => startWebToolbarPolling,
      },
      syncSecondaryFallbackPolling: {
        configurable: true,
        get: () => syncSecondaryFallbackPolling,
        set: (value) => {
          syncSecondaryFallbackPolling = value;
        },
      },
      updateWebToolbarState: {
        configurable: true,
        get: () => updateWebToolbarState,
      },
    });
    yield;
    function getActiveAppBrowser() {
      const panel = document.getElementById("zen-app-panel-slider");
      if (!panel) return null;
      // In Triple-View the secondary browser is nested in its own shell.
      // Keep the original toolbar and pill bound to Zentral's first browser.
      if (document.documentElement.hasAttribute("bgalazka-triple-view")) {
        const primary = panel.querySelector(
          'browser[data-bgalazka-triple-slot="top"]',
        );
        if (primary?.isConnected) return primary;
      }
      const browsers = panel.querySelectorAll("browser");
      for (const b of Array.from(browsers).reverse()) {
        if (b.style.display !== "none") return b;
      }
      return null;
    }

    /* --------------------------------------------------------------------
     * URL BAR: URL-vs-SEARCH DETECTION AND SEARCH ENGINE TEMPLATES
     * ----------------------------------------------------------------------
     * The toolbar's URL bar has to decide, on Enter, whether what was typed
     * is a URL to load directly or a search phrase to hand to a search
     * engine (this is what a normal browser's urlbar does via its own
     * "fixup" step). We do this ourselves with looksLikeUrl() below instead
     * of relying on <browser>.fixupAndLoadURIString()'s own built-in
     * keyword-search fallback, because that fallback goes through Gecko's
     * OWN default search engine / keyword.enabled machinery, which we have
     * no clean way to redirect to a user-chosen engine from here (chrome
     * <browser> loads don't expose a "use this search engine instead"
     * option) — building the destination URL ourselves and loading it as a
     * plain https:// URL sidesteps that entirely.
     * -------------------------------------------------------------------- */
    // Built-in quick-switch destinations. These are ready to use: users select
    // them in Extension Settings and never need to look up a GET URL manually.
    // Google and Bing are intentionally not part of this list.
    const QUICK_SWITCH_BUILTIN_TARGETS = [
      {
        key: "ddg",
        label: "DuckDuckGo",
        template: "https://duckduckgo.com/?q=%s",
        param: "q",
        test: (u) => /^https?:\/\/(www\.)?duckduckgo\.com\//i.test(u),
      },
      {
        key: "startpage",
        label: "Startpage",
        template: "https://www.startpage.com/sp/search?query=%s",
        param: "query",
        test: (u) =>
          /^https?:\/\/(www\.)?startpage\.com\/(sp|do)\/(d?search)/i.test(u),
      },
      {
        key: "brave",
        label: "Brave Search",
        template: "https://search.brave.com/search?q=%s",
        param: "q",
        test: (u) => /^https?:\/\/search\.brave\.com\/search/i.test(u),
      },
      {
        key: "yahoo",
        label: "Yahoo Search",
        template: "https://search.yahoo.com/search?p=%s",
        param: "p",
        test: (u) => /^https?:\/\/search\.yahoo\.com\/search/i.test(u),
      },
      {
        key: "ecosia",
        label: "Ecosia",
        template: "https://www.ecosia.org/search?q=%s",
        param: "q",
        test: (u) => /^https?:\/\/(www\.)?ecosia\.org\/search/i.test(u),
      },
      {
        key: "qwant",
        label: "Qwant",
        template: "https://www.qwant.com/?q=%s",
        param: "q",
        test: (u) => /^https?:\/\/(www\.)?qwant\.com\//i.test(u),
      },
      {
        key: "youtube",
        label: "YouTube",
        template: "https://www.youtube.com/results?search_query=%s",
        param: "search_query",
        test: (u) => /^https?:\/\/(www\.|m\.)?youtube\.com\/results/i.test(u),
      },
      {
        key: "wikipedia",
        label: "Wikipedia",
        template: "https://en.wikipedia.org/w/index.php?search=%s",
        param: "search",
        test: (u) =>
          /^https?:\/\/[a-z0-9-]+\.wikipedia\.org\/w\/index\.php/i.test(u),
      },
      {
        key: "reddit",
        label: "Reddit",
        template: "https://www.reddit.com/search/?q=%s",
        param: "q",
        test: (u) => /^https?:\/\/(www\.)?reddit\.com\/search\/?/i.test(u),
      },
      {
        key: "github",
        label: "GitHub",
        template: "https://github.com/search?q=%s",
        param: "q",
        test: (u) => /^https?:\/\/github\.com\/search/i.test(u),
      },
    ];

    const QUICK_SWITCH_TARGET_PREF_PREFIX =
      "zen.workspace.bgalazka.web_toolbar_quickswitch_target.";
    const QUICK_SWITCH_CUSTOM_PREFS = Array.from(
      { length: 5 },
      (_, index) =>
        `zen.workspace.bgalazka.web_toolbar_quickswitch_custom_${index + 1}`,
    );
    // One legacy primary-custom slot plus five additional slots. Keeping the
    // existing pref names preserves current users' engines while presenting all
    // six as one coherent list in Settings.
    const SEARCH_CUSTOM_ENGINE_PREFS = [
      ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_CUSTOM_URL,
      ...QUICK_SWITCH_CUSTOM_PREFS,
    ];
    let cachedQuickSwitchTargets = null;
    const searchTargetsObserver = () => {
      cachedQuickSwitchTargets = null;
    };
    Services.prefs.addObserver(
      "zen.workspace.bgalazka.web_toolbar_",
      searchTargetsObserver,
    );
    ctx.registerCleanup(() =>
      Services.prefs.removeObserver(
        "zen.workspace.bgalazka.web_toolbar_",
        searchTargetsObserver,
      ),
    );
    const QUICK_SWITCH_COMMON_GET_PARAMS = [
      "q",
      "query",
      "p",
      "search_query",
      "search",
      "keyword",
      "keywords",
      "term",
      "text",
      "wd",
      "k",
      "s",
    ];

    const SEARCH_ENGINE_TEMPLATES = Object.fromEntries(
      QUICK_SWITCH_BUILTIN_TARGETS.map(({ key, template }) => [key, template]),
    );

    // Patterns used to recognize built-in result pages and recover the search
    // term. Generic GET pages are handled separately below.
    const SEARCH_ENGINE_PATTERNS = Object.fromEntries(
      QUICK_SWITCH_BUILTIN_TARGETS.map(({ key, test, param }) => [
        key,
        { test, param },
      ]),
    );

    function detectSearchEngine(urlStr) {
      if (!urlStr) return null;
      for (const key of Object.keys(SEARCH_ENGINE_PATTERNS)) {
        if (SEARCH_ENGINE_PATTERNS[key].test(urlStr)) return key;
      }
      return null;
    }

    function extractSearchQuery(urlStr, engineKey) {
      try {
        const params = new URL(urlStr).searchParams;
        return params.get(SEARCH_ENGINE_PATTERNS[engineKey].param);
      } catch (_) {
        return null;
      }
    }

    // A GET parameter alone is not evidence of search: article/product pages
    // often carry ?q=, ?s= or tracking parameters. Accept an enabled custom
    // template, a recognized built-in results URL, or an obvious search route
    // with a known query key (e.g. Google/Bing /search?q=...).
    function extractGetSearchQuery(urlStr) {
      try {
        const url = new URL(urlStr);
        if (!/^https?:$/.test(url.protocol)) return null;

        for (const target of getQuickSwitchTargets()) {
          if (!target.key.startsWith("custom-")) continue;
          const term = extractCustomSearchQuery(target.template, urlStr);
          if (term?.trim()) return term;
        }

        const knownEngine = detectSearchEngine(urlStr);
        if (knownEngine) {
          const term = extractSearchQuery(urlStr, knownEngine);
          return term?.trim() ? term : null;
        }

        const isResultsRoute =
          /(?:^|\/)(?:search|results|find)(?:\/|$)/i.test(url.pathname) ||
          /^search[.-]/i.test(url.hostname);
        if (!isResultsRoute) return null;
        for (const param of QUICK_SWITCH_COMMON_GET_PARAMS) {
          const value = url.searchParams.get(param);
          if (value?.trim()) return value;
        }
        return null;
      } catch (_) {
        return null;
      }
    }

    function isValidQuickSwitchTemplate(template) {
      if (typeof template !== "string" || !template.includes("%s"))
        return false;
      try {
        const probe = new URL(template.replaceAll("%s", "bgalazkaprobe"));
        return (
          /^https?:$/.test(probe.protocol) &&
          !probe.username &&
          !probe.password &&
          !probe.host.includes("bgalazkaprobe")
        );
      } catch (_) {
        return false;
      }
    }

    function customTemplateMatchesUrl(template, urlStr) {
      return extractCustomSearchQuery(template, urlStr) !== null;
    }

    function extractCustomSearchQuery(template, urlStr) {
      if (!isValidQuickSwitchTemplate(template)) return null;
      try {
        const marker = "bgalazkaprobe";
        const templateUrl = new URL(template.replaceAll("%s", marker));
        const currentUrl = new URL(urlStr);
        if (templateUrl.origin !== currentUrl.origin) return null;
        let term = null;
        const matchPart = (pattern, value, encoded = false) => {
          if (value == null) return false;
          if (!pattern.includes(marker)) return pattern === value;
          const escaped = pattern
            .split(marker)
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          const match = value.match(
            new RegExp("^" + escaped.join("(.*?)") + "$"),
          );
          if (!match) return false;
          return match.slice(1).every((part) => {
            const query = encoded ? decodeURIComponent(part) : part;
            if (!query.trim() || (term !== null && term !== query))
              return false;
            term = query;
            return true;
          });
        };
        if (
          !matchPart(
            templateUrl.pathname.replace(/\/$/, ""),
            currentUrl.pathname.replace(/\/$/, ""),
            true,
          )
        )
          return null;
        for (const [name, value] of templateUrl.searchParams.entries()) {
          if (!matchPart(value, currentUrl.searchParams.get(name))) return null;
        }
        if (
          templateUrl.hash &&
          !matchPart(templateUrl.hash, currentUrl.hash, true)
        )
          return null;
        return term;
      } catch (_) {}
      return null;
    }

    function getQuickSwitchTargets() {
      if (cachedQuickSwitchTargets) return cachedQuickSwitchTargets;
      const builtIns = QUICK_SWITCH_BUILTIN_TARGETS.filter((target, index) =>
        ctx.getPref(
          QUICK_SWITCH_TARGET_PREF_PREFIX + target.key,
          index < 2, // retain the old DDG <-> Startpage behavior by default
        ),
      ).map((target) => ({
        ...target,
        matches: (urlStr) => target.test(urlStr),
      }));

      const custom = SEARCH_CUSTOM_ENGINE_PREFS.map((pref, index) => ({
        key: `custom-${index + 1}`,
        label: `Custom Engine ${index + 1}`,
        template: String(ctx.getPref(pref, "") || "").trim(),
      }))
        .filter(({ template }) => isValidQuickSwitchTemplate(template))
        .map((target) => ({
          ...target,
          matches: (urlStr) =>
            customTemplateMatchesUrl(target.template, urlStr),
        }));

      const seen = new Set();
      cachedQuickSwitchTargets = [...builtIns, ...custom].filter(
        ({ template }) => {
          if (seen.has(template)) return false;
          seen.add(template);
          return true;
        },
      );
      return cachedQuickSwitchTargets;
    }

    function getNextQuickSwitchTarget(
      urlStr,
      targets = getQuickSwitchTargets(),
    ) {
      if (!targets.length) return null;
      const currentIndex = targets.findIndex((target) =>
        target.matches(urlStr),
      );
      // A single selected destination already hosting this search is not a
      // switch. Keep the icon hidden instead of reloading the same results.
      if (targets.length === 1 && currentIndex === 0) return null;
      return targets[(currentIndex + 1) % targets.length];
    }

    ctx.getPanelQuickSwitchTarget = (browser) => {
      const current = browser?.currentURI?.spec || "";
      const query = extractGetSearchQuery(current);
      const next = getNextQuickSwitchTarget(current);
      return query != null && next
        ? {
            url: next.template.replaceAll("%s", encodeURIComponent(query)),
            label: next.label || next.key,
          }
        : null;
    };
    // Best-effort mirror of Firefox's OWN default search engine, for the
    // "Browser Default" option. Services.search is promise-based, and we
    // don't want the URL bar's Enter handler to await anything (typing +
    // Enter should feel instant), so this is fetched once up front (and
    // again if the user switches TO "Browser Default" in settings) and
    // cached; buildSearchUrl() below just reads the cached value.
    // The "%s" template is recovered by asking the engine for a submission
    // URL for a unique marker string, then swapping that marker back out for
    // "%s" in the resulting URL — the same trick many search-engine-import
    // tools use, since nsISearchEngine only exposes "give me the URL for
    // THIS term", not the raw template.
    let cachedBrowserSearchTemplate = null;
    function refreshBrowserSearchTemplate() {
      try {
        const marker = "bgalazkaquerymarker";
        Services.search
          .getDefault()
          .then((engine) => {
            try {
              const submission = engine?.getSubmission?.(marker);
              const url = submission?.uri?.spec;
              if (!url) return;
              const encodedMarker = encodeURIComponent(marker);
              if (url.includes(encodedMarker)) {
                cachedBrowserSearchTemplate = url.replace(encodedMarker, "%s");
              } else if (url.includes(marker)) {
                cachedBrowserSearchTemplate = url.replace(marker, "%s");
              }
            } catch (_) {}
          })
          .catch(() => {});
      } catch (_) {}
    }
    refreshBrowserSearchTemplate();

    // Builds the final URL to load for a typed search phrase, honoring
    // WEB_TOOLBAR_SEARCH_ENGINE. Always falls back to DuckDuckGo so a bad/
    // empty custom template or a not-yet-loaded browser-default template
    // never leaves the URL bar doing nothing.
    function buildSearchUrl(term) {
      const mode = ctx.getPref(
        ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_SEARCH_ENGINE,
        "ddg",
      );
      let template;
      if (mode === "custom" || /^custom-\d+$/.test(mode)) {
        // "custom" is the legacy value for slot 1. New selections use
        // custom-2..custom-6, allowing more than one user-created engine.
        const slot =
          mode === "custom" ? 0 : Math.max(0, parseInt(mode.slice(7), 10) - 1);
        const pref = SEARCH_CUSTOM_ENGINE_PREFS[slot];
        template =
          (pref && ctx.getPref(pref, "")) || SEARCH_ENGINE_TEMPLATES.ddg;
      } else if (mode === "browser") {
        template = cachedBrowserSearchTemplate || SEARCH_ENGINE_TEMPLATES.ddg;
      } else {
        template = SEARCH_ENGINE_TEMPLATES[mode] || SEARCH_ENGINE_TEMPLATES.ddg;
      }
      // Old preferences can contain invalid templates even after UI validation
      // is added. Never navigate a typed search to javascript:/data: or invent
      // a query parameter that the user's engine does not support.
      if (!isValidQuickSwitchTemplate(template))
        template = SEARCH_ENGINE_TEMPLATES.ddg;
      return template.replaceAll("%s", encodeURIComponent(term));
    }

    // Same "has a dot before the first slash" rule real browsers' urlbars use
    // to decide URL vs. keyword search, plus the obvious explicit-scheme and
    // localhost/IP cases. A typed phrase with a space is never treated as a
    // URL even if it happens to contain a dot (e.g. "prices in Warsaw pl.").
    function looksLikeUrl(raw) {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return true; // explicit scheme
      if (/\s/.test(raw)) return false;
      if (
        /^(localhost|(\d{1,3}\.){3}\d{1,3}|\[[0-9a-fA-F:]+\])(:\d+)?(\/.*)?$/.test(
          raw,
        )
      )
        return true;
      const hostPart = raw.split("/")[0].split(":")[0];
      return hostPart.includes(".") && !hostPart.endsWith(".");
    }

    // The browser owns session history, including redirects, replaceState,
    // pushState, POST entries and bfcache. Observing a URL is not a new visit.
    // In particular, never replay observed URLs with loadURI as a Back fallback.
    function canPanelNavigate(browser, direction) {
      if (!browser) return false;
      try {
        const key = direction < 0 ? "canGoBack" : "canGoForward";
        return !!(browser.webNavigation?.[key] ?? browser[key]);
      } catch (_) {
        return false;
      }
    }

    function navigatePanelHistory(browser, direction) {
      if (!canPanelNavigate(browser, direction)) return;
      const method = direction < 0 ? "goBack" : "goForward";
      try {
        // Gecko skips entries without user interaction, including redirect hops.
        if (typeof browser[method] === "function") browser[method](true);
        else browser.webNavigation?.[method]?.(true);
      } catch (error) {
        console.warn(
          "[BgalazkaExtension] Panel history navigation failed",
          error,
        );
      }
    }

    let forcePanelBlackSwitchTimer = null;
    const opacityPref = ctx.BGALAZKA_EXT_PREFS.PANEL_BLACK_OPACITY;
    const stepsPref = ctx.BGALAZKA_EXT_PREFS.PANEL_BLACK_STEPS;
    const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    let forcePanelBlackState = clamp(ctx.getPref(opacityPref, 0));
    function backgroundSteps() {
      const numbers = String(
        ctx.getPref(stepsPref, "0,1,5,10,20,30,40,50,60,70,80,90,100"),
      )
        .split(/[,;\s]+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 100);
      return [
        ...new Set(
          numbers.length
            ? numbers
            : [0, 1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
        ),
      ].sort((a, b) => a - b);
    }
    function syncForcePanelBlackButton(button, opacity = forcePanelBlackState) {
      if (!button) return;
      button.dataset.active = opacity > 0 ? "true" : "false";
      button.setAttribute(
        "aria-label",
        `Black panel backing ${opacity}%. Click to cycle; hold to reset.`,
      );
      button.setAttribute("aria-valuenow", String(opacity));
      button.title = `Black panel backing ${opacity}%. Click to cycle; hold to reset to 0%.`;
    }
    function applyForcePanelBlackVisual(
      opacity = forcePanelBlackState,
      button = null,
      instant = true,
    ) {
      forcePanelBlackState = clamp(opacity);
      const root = document.documentElement;
      if (instant) root.setAttribute("bgalazka-panel-black-switching", "true");
      root.setAttribute(
        "bgalazka-force-panel-black",
        forcePanelBlackState > 0 ? "true" : "false",
      );
      root.style.setProperty(
        "--bgalazka-panel-black-opacity",
        `${forcePanelBlackState}%`,
      );
      syncForcePanelBlackButton(
        button ||
          document.querySelector(
            "#zen-app-panel-toolbar .bgalazka-panel-black-btn",
          ),
      );
      if (instant) {
        if (forcePanelBlackSwitchTimer)
          ctx.clearTimeout(forcePanelBlackSwitchTimer);
        forcePanelBlackSwitchTimer = ctx.setTimeout(() => {
          forcePanelBlackSwitchTimer = null;
          root.removeAttribute("bgalazka-panel-black-switching");
        }, 80);
      }
    }
    function setForcePanelBlack(opacity) {
      opacity = clamp(opacity);
      applyForcePanelBlackVisual(opacity);
      if (ctx.getPref(opacityPref, 0) !== opacity)
        ctx.setPref(opacityPref, opacity);
    }
    ctx.registerCleanup(() => {
      if (forcePanelBlackSwitchTimer)
        ctx.clearTimeout(forcePanelBlackSwitchTimer);
      document.documentElement.removeAttribute(
        "bgalazka-panel-black-switching",
      );
      document.documentElement.style.removeProperty(
        "--bgalazka-panel-black-opacity",
      );
    });

    function ensureWebToolbar() {
      const panel = document.getElementById("zen-app-panel-slider");
      if (!panel) return false;
      if (document.getElementById("zen-app-panel-toolbar")) return true; // already built

      // Thin invisible strip used only in autohide mode (see chrome.css) to
      // reveal the toolbar on hover, same sibling-hover trick the pill itself
      // uses. Must come BEFORE the toolbar in the DOM for the `~` selector.
      const hoverZone = document.createElement("div");
      hoverZone.className = "zen-toolbar-hover-zone";

      const toolbar = document.createElement("div");
      toolbar.id = "zen-app-panel-toolbar";

      const backBtn = document.createElement("button");
      backBtn.className = "zen-toolbar-btn zen-toolbar-back-btn";
      backBtn.title = "Back";
      backBtn.appendChild(ctx.parseSVG(ctx.PREF_ICONS.BACK));
      backBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigatePanelHistory(getActiveAppBrowser(), -1);
      });

      const fwdBtn = document.createElement("button");
      fwdBtn.className = "zen-toolbar-btn zen-toolbar-fwd-btn";
      fwdBtn.title = "Forward";
      fwdBtn.appendChild(ctx.parseSVG(ctx.PREF_ICONS.FORWARD));
      fwdBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const b = getActiveAppBrowser();
        navigatePanelHistory(b, 1);
      });

      // Reload moved here from the pill's own refresh button (still present
      // natively, but hidden via CSS while the toolbar is enabled — see
      // chrome.css). Reuses the exact same spinning-icon feedback.
      const reloadBtn = document.createElement("button");
      reloadBtn.className = "zen-toolbar-btn zen-toolbar-reload-btn";
      reloadBtn.title = "Reload";
      reloadBtn.appendChild(ctx.parseSVG(ctx.PREF_ICONS.RELOAD));
      reloadBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const b = getActiveAppBrowser();
        if (!b) return;
        reloadBtn.classList.add("zen-toolbar-spinning");
        ctx.setTimeout(
          () => reloadBtn.classList.remove("zen-toolbar-spinning"),
          450,
        );
        try {
          b.reload();
        } catch (_) {}
      });

      const urlWrap = document.createElement("div");
      urlWrap.className = "zen-toolbar-urlwrap";

      // Panel position drag grip (note 18): small leading handle inside the
      // URL bar row, separate element from the <input> itself so it can't
      // interfere with clicking/selecting/typing the URL. Only ever visible
      // when the URL bar itself is (see chrome.css -- it's a plain descendant
      // of .zen-toolbar-urlwrap, which is already hidden via
      // WEB_TOOLBAR_URLBAR when that toggle is off), so no separate
      // hide-toggle was needed for it.
      const urlDragHandle = document.createElement("div");
      urlDragHandle.className = "zen-toolbar-urlbar-drag-handle";
      urlDragHandle.title = "Drag to move panel";
      urlDragHandle.appendChild(ctx.parseSVG(ctx.PREF_ICONS.DRAG_HANDLE));
      urlDragHandle.addEventListener("mousedown", ctx.startPanelPositionDrag);
      urlWrap.appendChild(urlDragHandle);

      const urlInput = document.createElement("input");
      urlInput.type = "text";
      urlInput.className = "zen-toolbar-urlbar";
      urlInput.spellcheck = false;
      urlInput.setAttribute("autocomplete", "off");
      urlInput.addEventListener("keydown", (e) => {
        // Stop keys from leaking to the panel's own shortcuts (Escape closes
        // the panel elsewhere) while typing a URL.
        e.stopPropagation();
        if (e.key === "Enter") {
          const b = getActiveAppBrowser();
          const raw = urlInput.value.trim();
          if (!b || !raw) return;
          try {
            const isUrl = looksLikeUrl(raw);
            const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
            // Not a URL (e.g. "google" or "weather warsaw") -> run it through
            // the configured search engine instead (see buildSearchUrl()).
            const target = isUrl
              ? hasScheme
                ? raw
                : "https://" + raw
              : buildSearchUrl(raw);
            const uri = Services.io.newURI(target);
            if (typeof b.fixupAndLoadURIString === "function") {
              // BUG FIX: this used to pass `raw` here instead of `target`.
              // For a plain typed URL that's mostly harmless (Gecko's own
              // fixup re-derives the same https:// URL), but for a search
              // it meant the literal search PHRASE was handed to fixup
              // instead of the search-engine URL we just built, so typed
              // terms never actually reached DuckDuckGo/Startpage/etc.
              b.fixupAndLoadURIString(target, {
                triggeringPrincipal:
                  Services.scriptSecurityManager.createContentPrincipal(
                    uri,
                    {},
                  ),
              });
            }
          } catch (e2) {
            console.warn("[BgalazkaExtension] Toolbar navigation failed:", e2);
          }
          urlInput.blur();
        } else if (e.key === "Escape") {
          urlInput.blur();
          updateWebToolbarState(); // update after blur, otherwise the focus guard skips it
        }
      });
      urlInput.addEventListener("focus", () => urlInput.select());
      urlWrap.appendChild(urlInput);

      // Triple View style repair: deliberately manual and cheap. Automatic
      // health repair runs on the existing 2s panel tick; this button forces
      // both visible panel browsers through docshell + Zen Internet CSS sync.
      const repairStyleBtn = document.createElement("button");
      repairStyleBtn.type = "button";
      repairStyleBtn.className =
        "zen-toolbar-btn bgalazka-panel-style-repair-btn";
      repairStyleBtn.title = "Repair Triple View panel styles";
      repairStyleBtn.style.display = "none";
      repairStyleBtn.appendChild(ctx.parseSVG(ctx.PREF_ICONS.REPAIR_STYLE));
      // Keep toolbar utility clicks from focusing the panel first. With panel
      // translucency enabled, button focus would otherwise kick :focus-within
      // to its brighter opacity just before the requested action, producing a
      // needless flash/transition. Preventing mousedown focus keeps the action
      // visually direct while the subsequent click still fires normally.
      repairStyleBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      repairStyleBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        repairStyleBtn.classList.remove("zen-toolbar-spinning");
        // Restart the one-shot animation even on rapid repeated clicks.
        void repairStyleBtn.offsetWidth;
        repairStyleBtn.classList.add("zen-toolbar-spinning");
        ctx.setTimeout(
          () => repairStyleBtn.classList.remove("zen-toolbar-spinning"),
          450,
        );
        ctx.repairVisiblePanelPresentation(true);
      });

      // Click cycles user levels; a 600 ms hold resets to zero.
      const blackPanelBtn = document.createElement("button");
      blackPanelBtn.type = "button";
      blackPanelBtn.className = "zen-toolbar-btn bgalazka-panel-black-btn";
      blackPanelBtn.appendChild(ctx.parseSVG(ctx.PREF_ICONS.PANEL_BLACK));
      let holdTimer = null;
      let held = false;
      const cancelHold = () => {
        if (holdTimer) ctx.clearTimeout(holdTimer);
        holdTimer = null;
      };
      blackPanelBtn.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        held = false;
        cancelHold();
        holdTimer = ctx.setTimeout(() => {
          holdTimer = null;
          held = true;
          setForcePanelBlack(0);
        }, 600);
      });
      blackPanelBtn.addEventListener("pointerup", cancelHold);
      blackPanelBtn.addEventListener("pointercancel", cancelHold);
      blackPanelBtn.addEventListener("pointerleave", cancelHold);
      blackPanelBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (held) {
          held = false;
          return;
        }
        const steps = backgroundSteps();
        setForcePanelBlack(
          steps.find((n) => n > forcePanelBlackState) ?? steps[0],
        );
      });
      ctx.registerCleanup(cancelHold);

      // Search-engine quick-switch. When the current HTTP(S) page exposes a
      // recognizable GET search term, each click advances to the next enabled
      // built-in/custom target while preserving that exact term.
      const swapBtn = document.createElement("button");
      swapBtn.className = "zen-toolbar-btn zen-toolbar-swap-btn";
      swapBtn.title = "Search with next selected service";
      swapBtn.style.display = "none"; // shown by updateWebToolbarState() only when a GET search term is detected
      swapBtn.appendChild(ctx.parseSVG(ctx.PREF_ICONS.SWAP));
      swapBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const b = getActiveAppBrowser();
        if (!b) return;
        const cur = b.currentURI?.spec || "";
        const term = extractGetSearchQuery(cur);
        if (term == null) return;
        const nextTarget = getNextQuickSwitchTarget(cur);
        if (!nextTarget) return;
        const target = nextTarget.template.replaceAll(
          "%s",
          encodeURIComponent(term),
        );
        try {
          const uri = Services.io.newURI(target);
          if (typeof b.fixupAndLoadURIString === "function") {
            b.fixupAndLoadURIString(target, {
              triggeringPrincipal:
                Services.scriptSecurityManager.createContentPrincipal(uri, {}),
            });
          }
        } catch (_) {}
      });

      // Zoom controls follow WEB_TOOLBAR_ZOOM. ZoomManager is a standard global in the browser
      // chrome window; wrapped defensively in case that ever changes.
      const zoomWrap = document.createElement("div");
      zoomWrap.className = "zen-toolbar-zoomwrap";
      const zoomOutBtn = document.createElement("button");
      zoomOutBtn.className = "zen-toolbar-btn zen-toolbar-zoom-btn";
      zoomOutBtn.title = "Zoom out";
      zoomOutBtn.appendChild(ctx.parseSVG(ctx.PREF_ICONS.ZOOM_OUT));
      const zoomLabel = document.createElement("span");
      zoomLabel.className = "zen-toolbar-zoom-label";
      zoomLabel.title = "Reset zoom";
      zoomLabel.textContent = "100%";
      const zoomInBtn = document.createElement("button");
      zoomInBtn.className = "zen-toolbar-btn zen-toolbar-zoom-btn";
      zoomInBtn.title = "Zoom in";
      zoomInBtn.appendChild(ctx.parseSVG(ctx.PREF_ICONS.ZOOM_IN));

      const stepZoom = (delta) => {
        const b = getActiveAppBrowser();
        if (!b) return;
        try {
          const cur = ZoomManager.getZoomForBrowser(b);
          const next =
            delta === 0 ? 1 : Math.max(0.3, Math.min(3, cur + delta));
          ZoomManager.setZoomForBrowser(b, next);
          zoomLabel.textContent = Math.round(next * 100) + "%";
        } catch (_) {}
      };
      zoomOutBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        stepZoom(-0.1);
      });
      zoomLabel.addEventListener("click", (e) => {
        e.stopPropagation();
        stepZoom(0);
      });
      zoomInBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        stepZoom(0.1);
      });
      zoomWrap.append(zoomOutBtn, zoomLabel, zoomInBtn);

      toolbar.append(
        backBtn,
        reloadBtn,
        fwdBtn,
        swapBtn,
        urlWrap,
        zoomWrap,
        repairStyleBtn,
        blackPanelBtn,
      );
      panel.append(hoverZone, toolbar);
      ZentralRuntime.hooks.emit("panel-toolbar:ready", {
        toolbar,
        getActiveBrowser: getActiveAppBrowser,
      });
      startWebToolbarPolling();
      return true;
    }

    // Refreshes back/forward enabled-state, the URL bar text (unless the user
    // is actively typing in it), and the zoom label, for whichever app browser
    // is currently active. Called after switching apps and on a light polling
    // interval below (SPA/history.pushState navigations don't reliably fire
    // the 'load'/'pageshow' events this file already listens for elsewhere).
    function updateWebToolbarState() {
      const root = document.getElementById("zen-app-panel-root");
      if (
        !root?.hasAttribute("open") ||
        root.hasAttribute("closing") ||
        document.documentElement.getAttribute("bgalazka-webtoolbar") !== "true"
      )
        return;
      const toolbar = document.getElementById("zen-app-panel-toolbar");
      if (!toolbar) return;
      const b = getActiveAppBrowser();
      const backBtn = toolbar.querySelector(".zen-toolbar-back-btn");
      const fwdBtn = toolbar.querySelector(".zen-toolbar-fwd-btn");
      const urlInput = toolbar.querySelector(".zen-toolbar-urlbar");
      const zoomLabel = toolbar.querySelector(".zen-toolbar-zoom-label");
      const swapBtn = toolbar.querySelector(".zen-toolbar-swap-btn");
      const repairStyleBtn = toolbar.querySelector(
        ".bgalazka-panel-style-repair-btn",
      );
      const blackPanelBtn = toolbar.querySelector(".bgalazka-panel-black-btn");

      if (repairStyleBtn) {
        const showRepair =
          ctx.getPref(ctx.BGALAZKA_EXT_PREFS.SHOW_TRIPLE_STYLE_REPAIR, false) &&
          ctx.zenCssEnabled() &&
          document.documentElement.getAttribute("bgalazka-triple-view") ===
            "true" &&
          document.documentElement.getAttribute("bgalazka-triple-populated") ===
            "true";
        const display = showRepair ? "" : "none";
        if (repairStyleBtn.style.display !== display)
          repairStyleBtn.style.display = display;
      }
      if (blackPanelBtn) {
        const mirrored =
          document.documentElement.getAttribute(
            "bgalazka-force-panel-black",
          ) === "true";
        if (mirrored !== forcePanelBlackState > 0)
          applyForcePanelBlackVisual(
            forcePanelBlackState,
            blackPanelBtn,
            false,
          );
        else syncForcePanelBlackButton(blackPanelBtn, forcePanelBlackState);
      }

      let curSpec = "";
      try {
        curSpec = b?.currentURI?.spec || "";
      } catch (_) {}

      if (backBtn) backBtn.disabled = !canPanelNavigate(b, -1);
      if (fwdBtn) fwdBtn.disabled = !canPanelNavigate(b, 1);

      if (urlInput && document.activeElement !== urlInput) {
        if (urlInput.value !== curSpec) urlInput.value = curSpec;
      }

      if (zoomLabel) {
        try {
          const label = b
            ? Math.round(ZoomManager.getZoomForBrowser(b) * 100) + "%"
            : "100%";
          if (zoomLabel.textContent !== label) zoomLabel.textContent = label;
        } catch (_) {
          if (zoomLabel.textContent !== "100%") zoomLabel.textContent = "100%";
        }
      }

      // Show only on a recognized search-results GET URL with a useful next
      // destination. A random page with ?q= or one arbitrary parameter is not
      // enough evidence to offer "search again elsewhere".
      if (swapBtn) {
        const quickswitchOn = ctx.getPref(
          ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH,
          false,
        );
        const targets = quickswitchOn ? getQuickSwitchTargets() : [];
        const nextTarget = getNextQuickSwitchTarget(curSpec, targets);
        const show =
          quickswitchOn &&
          nextTarget !== null &&
          extractGetSearchQuery(curSpec) !== null;
        const display = show ? "" : "none";
        if (swapBtn.style.display !== display) swapBtn.style.display = display;
        const title = nextTarget
          ? `Search with ${nextTarget.label}`
          : "Search with next selected service";
        if (swapBtn.title !== title) swapBtn.title = title;
      }
    }

    function periodicFallbackPollingEnabled() {
      return ctx.getPref(
        ctx.BGALAZKA_EXT_PREFS.PERIODIC_FALLBACK_POLLING,
        false,
      );
    }

    // Secondary Triple/Super toolbar installs its concrete synchronizer later.
    // Keeping this callable here lets the Settings toggle affect an already-open
    // Triple View without requiring the user to close/reopen it.
    let syncSecondaryFallbackPolling = () => {};

    let webToolbarObservedRoot = null;
    let webToolbarVisibilityObserver = null;
    function startWebToolbarPolling() {
      if (ctx.extensionDisposed) return;
      const root = document.getElementById("zen-app-panel-root");
      if (root !== webToolbarObservedRoot) {
        webToolbarVisibilityObserver?.disconnect();
        webToolbarObservedRoot = root;
        if (root) {
          webToolbarVisibilityObserver = new MutationObserver(
            startWebToolbarPolling,
          );
          // Attributes on the panel ONLY: never observe tabstrip descendants.
          webToolbarVisibilityObserver.observe(root, {
            attributes: true,
            attributeFilter: ["open", "closing"],
          });
        }
      }
      const active =
        root?.hasAttribute("open") &&
        !root.hasAttribute("closing") &&
        ctx.getPref(ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_ENABLED, false);
      if (active) updateWebToolbarState();
      ctx.syncPanelFallbackPolling();
    }
    ctx.registerCleanup(() => {
      webToolbarVisibilityObserver?.disconnect();
    });
    startWebToolbarPolling();

    // BUG FIX: this used to be called from inside patchAppsInstance(), which
    // runs synchronously much earlier in the script — before PREF_ICONS and
    // BGALAZKA_EXT_PREFS (both `const`, declared further up but still after
    // that point) had actually been initialized. Reading PREF_ICONS.BACK from
    // in there threw an uncaught "can't access lexical declaration before
    // initialization" (TDZ) ReferenceError, which — since nothing caught it —
    // silently aborted the rest of the top-level script, breaking every
    // feature wired up further down the file (settings UI, dual-view, the
    // pill peek-dot, corner tiles) while leaving only what had already run
    // before the crash (opposite-docking positioning, translucency) working.
    // Called from here instead, well after both consts exist, with the same
    // retry-until-ready pattern ensureMobileUaMenuItem() uses below, in case
    // #zen-app-panel-slider somehow isn't in the DOM yet at this point.
    ctx.retryPanelTask("toolbar-ui", () =>
      ctx.safeCall(ensureWebToolbar, "ensureWebToolbar"),
    );
  });
})();
