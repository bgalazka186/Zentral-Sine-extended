// ==UserScript==
// @name Zentral Load at Startup
// @include chrome://browser/content/browser.xhtml
// ==/UserScript==
/*
 * ZENTRAL FILE GUIDE - features/tabs/startup/ZentralStartup.uc.js
 *
 * Purpose: Independent loading of selected native tabs after session/workspace restoration, with bounded
 *   recovery and readiness handling.
 * Interaction / execution: Runtime registers startup; standalone mode waits for browser delayed startup.
 *   Resolves its stylesheet from the executing file/runtime root and native gBrowser/session events.
 * Ownership / failure: Owns readiness/restore listeners and scheduled startup work. Native tab loading is
 *   separate from Apps preload and panel startup restoration.
 * Registration: startup
 * Loaded/created by: core/ZentralCatalog.js
 * Direct local resource paths: features/tabs/startup/ZentralStartup.css
 * Literal DOM event subscriptions: command
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  // Keep paths universal: use the core root, or this script's own location.
  // Never hard-code a mod id, folder name, or profile path.
  // Capture this file before initialize() is called by the core.
  const SCRIPT_URI = Components.stack.filename;
  // The core registers this feature during its declaration pass, then starts
  // it after browser readiness. Without the core, initialize directly and
  // use the same browser/session/workspace readiness gates below.
  function initialize() {
    if (window.ZentralStartup) return window.ZentralStartup.destroy;
    const Services =
      globalThis.Services ||
      ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
        .Services;
    const ROOT =
      window.ZentralRuntime?.rootURI ||
      Services.io.newURI("../../../", null, Services.io.newURI(SCRIPT_URI))
        .spec;
    const PREF = "zen.workspace.zentral.startup.enabled";
    const TAB_KEY = "zentral-load-at-startup";
    const ITEM_ID = "zentral-tab-load-at-startup";
    const ROOT_ATTR = "zentral-startup-enabled";
    let stopped = false;
    let ready = false;
    let starting = false;
    let timer = null;
    let menuTab = null;
    let sheet = null;
    let sessionStore = null;
    const queue = new Set();
    const attempted = new WeakSet();
    const cleanups = [];
    const enabled = () => !stopped && Services.prefs.getBoolPref(PREF, false);
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    };
    function getSessionStore() {
      if (sessionStore) return sessionStore;
      if (window.SessionStore) return (sessionStore = window.SessionStore);
      for (const uri of [
        "resource:///modules/sessionstore/SessionStore.sys.mjs",
        "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
      ]) {
        try {
          return (sessionStore = ChromeUtils.importESModule(uri).SessionStore);
        } catch (_) {}
      }
      throw new Error("SessionStore is unavailable");
    }
    function eligible(tab) {
      return !!(
        tab?.isConnected &&
        !tab.closing &&
        Array.from(window.gBrowser?.tabs || []).includes(tab) &&
        (tab.pinned ||
          (tab.hasAttribute("zen-essential") &&
            tab.getAttribute("zen-essential") !== "false")) &&
        !tab.hasAttribute("zen-empty-tab") &&
        !tab.hasAttribute("bgalazka-addon-host") &&
        !tab.hasAttribute("bgalazka-addon-host-fallback") &&
        !tab.closest(
          "#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']",
        )
      );
    }
    function selected(tab) {
      try {
        return getSessionStore().getCustomTabValue(tab, TAB_KEY) === "true";
      } catch (_) {
        return false;
      }
    }
    function sleeping(tab) {
      return (
        !tab.linkedPanel ||
        tab.hasAttribute("pending") ||
        tab.hasAttribute("discarded") ||
        (tab.hasAttribute("zen-dormant") &&
          tab.getAttribute("zen-dormant") !== "false")
      );
    }
    function wake(tab) {
      // Recheck the actual live tab immediately before touching its browser.
      // Never add a tab, load a saved URL, select a tab or reload a running page.
      if (!enabled() || !eligible(tab) || !selected(tab) || attempted.has(tab))
        return;
      if (!sleeping(tab)) {
        attempted.add(tab);
        return;
      }
      // Use MozBrowser's native lazy reload binding. For a sleeping tab it
      // inserts the browser, waits for SessionStore's history restoration,
      // then resumes that tab's saved history entry in the background.
      // Do not insert manually first: that bypasses the lazy binding's wait.
      // SessionStore.restoreTabContent is internal, not a public API.
      const browser = tab.linkedBrowser;
      if (typeof browser?.reload !== "function") {
        throw new Error("Native browser reload API is unavailable");
      }
      browser.reload();
      // Mark only after a request was actually dispatched. A failed call
      // must not permanently suppress this tab in the current window.
      attempted.add(tab);
    }

    function pump() {
      timer = null;
      if (!enabled()) {
        queue.clear();
        return;
      }
      const tab = queue.values().next().value;
      if (!tab) return;
      queue.delete(tab);
      try {
        wake(tab);
      } catch (error) {
        console.warn("[ZentralStartup] Could not wake tab", error);
      }
      if (queue.size) timer = window.setTimeout(pump, 1500);
    }
    function scan() {
      if (!ready || !enabled()) return;
      for (const tab of window.gBrowser.tabs) {
        if (eligible(tab) && selected(tab) && !attempted.has(tab))
          queue.add(tab);
      }
      if (queue.size && timer === null) timer = window.setTimeout(pump, 0);
    }
    function updatePreference() {
      document.documentElement.toggleAttribute(ROOT_ATTR, enabled());
      if (!enabled()) {
        queue.clear();
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        menuTab = null;
        const item = document.getElementById(ITEM_ID);
        if (item) item.hidden = true;
      } else scan();
    }
    function onPopup(event) {
      const popup = event.target;
      if (popup.id !== "tabContextMenu") return;
      let item = document.getElementById(ITEM_ID);
      if (!item && enabled()) {
        item = document.createXULElement("menuitem");
        item.id = ITEM_ID;
        item.setAttribute("type", "checkbox");
        item.setAttribute("autocheck", "false");
        item.setAttribute("label", "Load at Startup");
        item.addEventListener("command", onCommand);
        popup.appendChild(item);
      }
      if (!item) return;
      // Native contextTab is the right-clicked tab, not the selected tab.
      menuTab =
        window.TabContextMenu?.contextTab ||
        popup.triggerNode?.closest?.(".tabbrowser-tab");
      item.hidden = !enabled() || !eligible(menuTab);
      if (item.hidden) menuTab = null;
      if (menuTab && selected(menuTab)) item.setAttribute("checked", "true");
      else item.removeAttribute("checked");
    }
    function onCommand(event) {
      const tab = menuTab;
      if (!enabled() || !eligible(tab)) return;
      try {
        const next = !selected(tab);
        // Keep an explicit false value on opt-out. No URL or detached tab id list.
        getSessionStore().setCustomTabValue(tab, TAB_KEY, String(next));
        if (next) event.target.setAttribute("checked", "true");
        else {
          event.target.removeAttribute("checked");
          queue.delete(tab);
        }
        // A menu choice applies on the next startup, not immediately.
      } catch (error) {
        console.warn("[ZentralStartup] Could not save tab choice", error);
      }
    }
    async function start() {
      if (starting || stopped || !window.gBrowser) return;
      starting = true;
      // These promises include restored tabs in other Zen workspaces. Do not
      // guess when restoration is finished with a fixed two-second delay.
      try {
        const store = getSessionStore();
        await store.promiseAllWindowsRestored;
        if (
          window.gZenWorkspaces?.workspaceEnabled &&
          !window.gZenWorkspaces.privateWindowOrDisabled
        ) {
          await window.gZenWorkspaces.promiseInitialized;
        }
        if (!stopped) {
          ready = true;
          scan();
        }
      } catch (error) {
        console.warn("[ZentralStartup] Startup restoration failed", error);
      }
    }
    function destroy() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      queue.clear();
      menuTab = null;
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          cleanup();
        } catch (_) {}
      }
      document.getElementById(ITEM_ID)?.remove();
      document.documentElement.removeAttribute(ROOT_ATTR);
      if (sheet) {
        try {
          window.windowUtils.removeSheet(sheet, window.windowUtils.USER_SHEET);
        } catch (_) {}
      }
      delete window.ZentralStartup;
    }
    window.ZentralStartup = { destroy };
    listen(window, "unload", destroy, { once: true });
    if (typeof window.addUnloadListener === "function")
      window.addUnloadListener(destroy);
    listen(window, "popupshowing", onPopup);
    listen(window, "TabClose", (event) => {
      queue.delete(event.target);
    });
    const prefObserver = { observe: updatePreference };
    Services.prefs.addObserver(PREF, prefObserver);
    cleanups.push(() => Services.prefs.removeObserver(PREF, prefObserver));
    const startupObserver = {
      observe(subject) {
        if (subject === window) start();
      },
    };
    Services.obs.addObserver(
      startupObserver,
      "browser-delayed-startup-finished",
    );
    cleanups.push(() =>
      Services.obs.removeObserver(
        startupObserver,
        "browser-delayed-startup-finished",
      ),
    );
    // Use this installation's package root; CSS failure cannot block logic.
    try {
      sheet = Services.io.newURI(
        ROOT + "features/tabs/startup/ZentralStartup.css",
      );
      window.windowUtils.loadSheet(sheet, window.windowUtils.USER_SHEET);
    } catch (error) {
      sheet = null;
      console.warn("[ZentralStartup] Stylesheet unavailable", error);
    }
    updatePreference();
    if (
      window.gBrowser &&
      (!window.gBrowserInit || window.gBrowserInit.delayedStartupFinished)
    )
      start();
    return destroy;
  }
  if (window.ZentralRuntime) {
    window.ZentralRuntime.register({ id: "startup", init: initialize });
  } else {
    initialize();
  }
})();
