/* Shared, pure safe insertion-point selection for sidebar chrome.
 *
 * The result is { parent, before, anchorId }; callers decide how to mount and
 * observe their own node. Keeping selection here gives sidebar features the
 * same anchor priority and video-player adjacency rule. */
(function installZentralSidebarMount(targetWindow) {
  "use strict";

  const VIDEO_PLAYER_ID = "zentral-video-preview";
  const ANCHOR_IDS = Object.freeze([
    "zen-media-controls-toolbar",
    "zen-sidebar-bottom-buttons",
    "tabbrowser-tabs",
    "vertical-tabs",
  ]);
  const VIDEO_ANCHOR_IDS = new Set(ANCHOR_IDS);

  function safeStyle(element, win) {
    if (!element || typeof win?.getComputedStyle !== "function") return null;
    try {
      return win.getComputedStyle(element);
    } catch (_) {
      return null;
    }
  }

  function safeRect(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") return null;
    try {
      const rect = element.getBoundingClientRect();
      return rect && [rect.top, rect.bottom, rect.left, rect.right, rect.width, rect.height].every(Number.isFinite)
        ? rect
        : null;
    } catch (_) {
      return null;
    }
  }

  function isElementHidden(element, win) {
    if (!element || element.hidden) return true;
    const style = safeStyle(element, win);
    return Boolean(style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"));
  }

  function isAncestorVisible(element, win) {
    for (let parent = element?.parentElement || element?.parentNode; parent; parent = parent.parentElement || parent.parentNode) {
      if (parent.hidden) return false;
      const style = safeStyle(parent, win);
      if (style?.display === "none" || style?.visibility === "collapse") return false;
    }
    return true;
  }

  function resolveTabsHost(doc, win) {
    if (!doc || typeof doc.getElementById !== "function") return null;
    const candidates = [
      doc.getElementById("tabbrowser-tabs"),
      doc.getElementById("vertical-tabs"),
    ].filter(Boolean);
    if (!candidates.length) return null;

    for (const element of candidates) {
      if (isElementHidden(element, win)) continue;
      const rect = safeRect(element);
      if (!rect || rect.height > 0) return element;
    }
    for (const element of candidates) {
      if (!isElementHidden(element, win)) return element;
    }
    return candidates[0];
  }

  function chooseBottomMount(doc, win, fallbackSidebar = null) {
    if (!doc || typeof doc.getElementById !== "function") return null;

    const media = doc.getElementById("zen-media-controls-toolbar");
    if (media?.parentNode && isAncestorVisible(media, win)) {
      return { parent: media.parentNode, before: media, anchorId: "zen-media-controls-toolbar" };
    }

    const bottom = doc.getElementById("zen-sidebar-bottom-buttons");
    if (bottom?.parentNode && isAncestorVisible(bottom, win)) {
      return { parent: bottom.parentNode, before: bottom, anchorId: "zen-sidebar-bottom-buttons" };
    }

    const video = doc.getElementById(VIDEO_PLAYER_ID);
    const tabs = resolveTabsHost(doc, win);
    if (tabs?.parentNode && isAncestorVisible(tabs, win)) {
      let before = tabs.nextSibling;
      // If the player follows the tab anchor, insert after the player, never between the pair.
      if (before?.id === VIDEO_PLAYER_ID) before = before.nextSibling;
      return { parent: tabs.parentNode, before: before || null, anchorId: tabs.id || "tabs" };
    }

    if (video?.parentNode && isAncestorVisible(video, win)) {
      const previous = video.previousSibling;
      if (previous && VIDEO_ANCHOR_IDS.has(previous.id)) {
        return { parent: video.parentNode, before: video.nextSibling || null, anchorId: VIDEO_PLAYER_ID + ":after" };
      }
      return { parent: video.parentNode, before: video, anchorId: VIDEO_PLAYER_ID + ":before" };
    }

    const sidebar = doc.getElementById("navigator-toolbox") || fallbackSidebar || null;
    if (sidebar) {
      return { parent: sidebar, before: null, anchorId: sidebar.id || "sidebar" };
    }
    return null;
  }

  targetWindow.__zentralSidebarMount = Object.freeze({
    chooseBottomMount,
    anchorIds: ANCHOR_IDS,
    videoPlayerId: VIDEO_PLAYER_ID,
  });
})(window);
