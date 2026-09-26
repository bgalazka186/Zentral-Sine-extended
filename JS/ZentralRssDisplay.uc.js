"use strict";
// Sine loads this feature source before the extension starts. The extension
// calls it at the original startup position with its live preference helpers.
(function () {
  const sources = (window.ZentralFeatureSources ||= Object.create(null));
  sources.rss = function initRssDisplay({ EXT_PREFS, getPref, setInterval,
    clearInterval, registerCleanup }) {
  /* RSS sidebar display only. Zen owns fetching, tab creation, dismissal and
   * session state. This never moves or closes its tabs or folders. An empty
   * live folder can still contain Zen's restoration placeholder; only tabs
   * explicitly marked as placeholders may be ignored. No tabstrip subtree observer: that
   * pattern can crash Gecko during pinning (architecture note 4). */
  const rssMarkedFolders = new Set();
  let rssScanTimer = null;
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
        [...folder.querySelectorAll("tab, .tabbrowser-tab, zen-folder")].some(
          (child) => {
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
          },
        );
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
      if (rssScanTimer !== null) clearInterval(rssScanTimer);
      rssScanTimer = null;
      clearRssMarks();
      return;
    }
    safeScanRssFolders();
    if (rssScanTimer === null)
      rssScanTimer = setInterval(safeScanRssFolders, 2000);
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
      console.warn("[BgalazkaExtension] RSS pref observer unavailable:", error);
    }
  }
  registerCleanup(() => {
    if (rssScanTimer !== null) clearInterval(rssScanTimer);
    clearRssMarks();
    document.documentElement.removeAttribute("bgalazka-rss-hide-empty");
    document.documentElement.removeAttribute("bgalazka-rss-compact-headers");
  });
  syncRssFolderDisplay();

    return { syncRssFolderDisplay };
  };
})();
