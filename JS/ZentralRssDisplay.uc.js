(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime;

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
    function start() {
      const cleanups = [];
      const registerCleanup = (fn) => cleanups.push(fn);
      const getPref = (key, fallback) =>
        Services.prefs.getBoolPref(key, fallback);
      const EXT_PREFS = {
        RSS_HIDE_EMPTY: "zen.workspace.bgalazka.rss.hide_empty",
        RSS_COMPACT_HEADERS: "zen.workspace.bgalazka.rss.compact_headers",
      };
      const rssMarkedFolders = new Set();
      let rssScanTimer = null;
      let rssObserver = null;
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
      function syncRssFolderDisplay() {
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
          rssObserver = null;
          clearRssMarks();
          return;
        }
        safeScanRssFolders();
        if (!rssObserver && gBrowser.tabContainer) {
          rssObserver = new MutationObserver(() => {
            if (rssScanTimer !== null) return;
            rssScanTimer = setTimeout(() => {
              rssScanTimer = null;
              safeScanRssFolders();
            }, 100);
          });
          rssObserver.observe(gBrowser.tabContainer, {
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
      }
      for (const pref of [
        EXT_PREFS.RSS_HIDE_EMPTY,
        EXT_PREFS.RSS_COMPACT_HEADERS,
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
          cleanups.reverse().forEach((fn) => fn());
        },
      };
      if (window.ZentralRuntime) ZentralRuntime.services.rss = api;
      window.addEventListener("unload", () => api.destroy(), { once: true });
      return () => api.destroy();
    }
    if (window.ZentralRuntime)
      ZentralRuntime.register({ id: "rss", init: start });
    else standaloneReady(start);
  })();
})();
