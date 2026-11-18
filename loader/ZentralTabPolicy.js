// <Zentral> shared tab policy: one answer to "may this tab be unloaded?", asked by every module that unloads.
// <owner>Every module that unloads a tab: additional/tabs/unloading/ZentralTabUnload.uc.js and
//   additional/boost/ZentralBoost.uc.js, both of which embed this file (standalone) or load it (full pack).
// <contract>Pure predicates over a tab and a context. Nothing here touches prefs, DOM or the tabbrowser: callers pass
//   what they read, so the table is testable and a change to one caller's rules is a change here for everybody.
// <cleanup>None. No listeners, no timers, no state.
//
// OW-91 (plan B4.1): TabUnload and Boost both need to know which tabs are safe to unload. Keeping two copies was how
// "never unload the selected tab" became true in one module and forgotten in the other, so the rules live here once.
// The reason string is part of the contract: a caller shows it (`boost.state()`), a test asserts it, and a future
// caller can tell "audible" from "selected" without re-deriving the tab's state.
(function () {
  "use strict";

  const NEVER = "never";
  const ALLOWED = "allowed";

  // The reasons, in the order a person would care about them: the loud/visible ones first.
  const REASONS = Object.freeze({
    noTab: "no-tab",
    closing: "closing",
    notConnected: "not-connected",
    selected: "selected",
    pending: "pending",
    discarded: "discarded",
    dormant: "dormant",
    addonHost: "addon-host",
    notesPlaceholder: "notes-placeholder",
    hidden: "hidden-panel",
    essential: "essential-live",
    pinned: "pinned-kept",
    audible: "audible",
    sharing: "sharing",
    pictureInPicture: "picture-in-picture",
    videoSource: "video-source",
    private: "private-tab",
    noPanel: "no-panel",
  });

  const URL_OF = (tab) => {
    try {
      return String(tab?.linkedBrowser?.currentURI?.spec || tab?._zentralNotesUrl || "");
    } catch (_) {
      return "";
    }
  };

  // A tab that is already asleep: nothing to unload, and unloading it again would only reset its session state.
  function isUnloadable_AlreadyUnloaded(tab) {
    if (!tab) return false;
    return (
      !tab.linkedPanel ||
      tab.hasAttribute("pending") ||
      tab.hasAttribute("discarded") ||
      (tab.hasAttribute("zen-dormant") && tab.getAttribute("zen-dormant") !== "false")
    );
  }

  // Notes and Agenda sidebar entries are inert about:blank placeholders: selecting one hands the selection straight
  // back to the tab being unloaded, and unloading one throws away a row that is not a page. Matched on the live URL,
  // then on the session entry, then on the legacy markers — the order TabUnload already used.
  function isNotesAgendaPlaceholder(tab, sessionUrl = "") {
    if (!tab) return false;
    const url = URL_OF(tab);
    if (url && url !== "about:blank") return /^about:blank#zn-(?:note:|new:|agenda-)/.test(url);
    const fromSession = String(sessionUrl || "");
    if (fromSession && fromSession !== "about:blank") return /^about:blank#zn-(?:note:|new:|agenda-)/.test(fromSession);
    if (tab.hasAttribute?.("bgalazka-notes-item") || tab.hasAttribute?.("bgalazka-notes-agenda-item")) return true;
    return /^about:blank#zn-(?:note:|new:|agenda-)/.test(String(tab._zentralNotesUrl || url || ""));
  }

  function isAddonHostTab(tab) {
    return !!tab?.matches?.("[bgalazka-addon-host], [bgalazka-addon-host-fallback]");
  }

  // Picture-in-picture: the tab's browser is inside a PiP window, so unloading it would blank that window.
  function isPictureInPicture(tab) {
    try {
      return Boolean(tab?.linkedBrowser?.isPictureInPicture || tab?._pipState?.active || tab?.pictureInPicture);
    } catch (_) {
      return false;
    }
  }

  // Camera/microphone/screen sharing. `_sharingState` is an object with `camera`/`microphone`/`screen` when sharing.
  function isSharing(tab) {
    const state = tab?._sharingState;
    if (!state) return false;
    if (typeof state !== "object") return Boolean(state);
    return Boolean(state.camera || state.microphone || state.screen || state.devices);
  }

  function isAudible(tab) {
    try {
      return Boolean(tab?.soundPlaying || tab?.linkedBrowser?.audioPlaybackActive || tab?.linkedBrowser?.soundPlaying);
    } catch (_) {
      return false;
    }
  }

  /**
   * The policy table. Every "never" is a fact about the tab or about what the person is doing right now; every input
   * is an argument, so the answer can be computed for a tab that is not mounted in a window (that is how it is tested).
   *
   * @param {object} tab     the tab element
   * @param {object} ctx     everything the caller knows and this file cannot read:
   *   - `keepPinned`      (bool) may pinned/essential tabs be unloaded at all?
   *   - `videoSourceTab`  the tab the video preview currently shows (unloading it would blank the preview)
   *   - `sessionUrl`      the tab's session entry URL, for a placeholder whose live URL is about:blank
   *   - `isHostTab`       the caller's own host-tab test (Zentral's hidden panel tabs), when it has one
   *   - `selectedTab`     the window's selected tab, when the caller is not in a window that owns `gBrowser`
   * @returns {{allowed: boolean, reason: string}}
   */
  function isUnloadable(tab, ctx = {}) {
    const decide = (allowed, reason) => ({ allowed, reason });
    if (!tab) return decide(false, REASONS.noTab);
    if (tab.closing) return decide(false, REASONS.closing);
    if (tab.isConnected === false && ctx.requireConnected !== false) return decide(false, REASONS.notConnected);
    // The calm answer first: a tab that is already asleep is not a candidate, and not an error either.
    if (isUnloadable_AlreadyUnloaded(tab)) {
      if (tab.hasAttribute?.("pending")) return decide(false, REASONS.pending);
      if (tab.hasAttribute?.("discarded")) return decide(false, REASONS.discarded);
      if (tab.hasAttribute?.("zen-dormant")) return decide(false, REASONS.dormant);
      return decide(false, REASONS.noPanel);
    }
    const selected = ctx.selectedTab !== undefined ? ctx.selectedTab : ctx.gBrowser?.selectedTab;
    if (selected === tab) return decide(false, REASONS.selected);
    if (isAddonHostTab(tab) || ctx.isHostTab?.(tab)) return decide(false, REASONS.addonHost);
    if (isNotesAgendaPlaceholder(tab, ctx.sessionUrl)) return decide(false, REASONS.notesPlaceholder);
    if (tab.hidden) return decide(false, REASONS.hidden);
    if (isPictureInPicture(tab)) return decide(false, REASONS.pictureInPicture);
    if (isSharing(tab)) return decide(false, REASONS.sharing);
    if (isAudible(tab)) return decide(false, REASONS.audible);
    if (ctx.videoSourceTab && ctx.videoSourceTab === tab) return decide(false, REASONS.videoSource);
    // Pinned and Essentials are the person's own shortlist: unloadable only when they said so.
    if ((tab.pinned || tab.hasAttribute?.("zen-essential")) && !ctx.keepPinned) {
      return decide(false, tab.hasAttribute?.("zen-essential") ? REASONS.essential : REASONS.pinned);
    }
    if (ctx.isPrivate && ctx.isPrivate(tab)) return decide(false, REASONS.private);
    return decide(true, ALLOWED);
  }

  // The successor rules, kept with the policy because they answer the same question one step earlier: which tab may
  // hold the selection while another one goes to sleep. Shared so a deep run can find a safe successor for the tab it
  // is about to unload without growing a second copy of the "never" list.
  function isSuccessorCandidate(tab, current, ctx = {}) {
    if (!tab || tab === current) return false;
    if (tab.isConnected === false || tab.closing || tab.hidden) return false;
    if (isAddonHostTab(tab)) return false;
    if (isNotesAgendaPlaceholder(tab, ctx.sessionUrl)) return false;
    return Boolean(tab.linkedPanel);
  }

  // One oldest-first order for a deep run: the tabs nobody has touched for longest go first, and a tab with no
  // `lastAccessed` sorts as the oldest, because that is what "we do not know, so it is not fresh" means.
  function byOldestFirst(a, b) {
    const left = Number(a?.lastAccessed);
    const right = Number(b?.lastAccessed);
    const aKnown = Number.isFinite(left);
    const bKnown = Number.isFinite(right);
    if (!aKnown && !bKnown) return 0;
    if (!aKnown) return -1;
    if (!bKnown) return 1;
    return left - right;
  }

  const api = Object.freeze({
    REASONS,
    NEVER,
    ALLOWED,
    isUnloadable_AlreadyUnloaded,
    isNotesAgendaPlaceholder,
    isAddonHostTab,
    isPictureInPicture,
    isSharing,
    isAudible,
    isUnloadable,
    isSuccessorCandidate,
    byOldestFirst,
  });

  // The table is published on the window under one name. Both callers read that name, so the standalone builds (which
  // embed this file verbatim) and the full pack reach the same object.
  window.ZentralTabPolicy = api;
})();
