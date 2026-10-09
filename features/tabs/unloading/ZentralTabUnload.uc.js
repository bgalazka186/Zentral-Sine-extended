/*
 * ZENTRAL FILE GUIDE - features/tabs/unloading/ZentralTabUnload.uc.js
 *
 * Purpose: Independent middle-click unloading of loaded ordinary native tabs while keeping native close
 *   behavior for already-unloaded tabs.
 * Interaction / execution: Runtime registers tab-unload; standalone mode can start after browser readiness.
 *   Uses native gBrowser and its preferences, excluding corner/panel tiles with their own unload behavior.
 * Ownership / failure: Owns capture listeners and native integration cleanup. Missing this feature does not
 *   affect Apps/Video/Groups or panel notification policy.
 * Registration: tab-unload
 * Loaded/created by: core/ZentralCatalog.js
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
  // Standalone: set zen.workspace.bgalazka.mmb_unload_normal_tabs=true.
  // Middle-click loaded ordinary tabs to unload; already-unloaded tabs keep native close.
  (function () {
    function start() {
      if (window.ZentralTabUnload) return window.ZentralTabUnload.destroy;
      if (!window.gBrowser)
        throw new Error("Tab unloading requires a browser window");
      const cleanups = [];
      const registerCleanup = (fn) => cleanups.push(fn);
      const EXT_PREFS = {
        MMB_UNLOAD_NORMAL_TABS: "zen.workspace.bgalazka.mmb_unload_normal_tabs",
      };
      const getPref = (key, fallback) =>
        Services.prefs.getBoolPref(key, fallback);
      const normalTabMmbEvents = [
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "click",
        "auxclick",
      ];
      let normalTabMmbGesture = null;
      let normalTabMmbFallbackTimer = null;

      function getNormalTabFromMiddleClickEvent(event) {
        const target = event?.target;
        if (!target?.closest) return null;
        if (target.closest(".zen-app-tile")) return null;
        const tab = target.closest(".tabbrowser-tab");
        if (
          !tab?.isConnected ||
          tab.closing ||
          tab.hidden ||
          tab.pinned ||
          tab.hasAttribute("zen-essential") ||
          tab.hasAttribute("zen-empty-tab") ||
          tab.hasAttribute("bgalazka-addon-host") ||
          tab.hasAttribute("bgalazka-addon-host-fallback") ||
          tab.closest(
            "#bgalazka-zentral-addon-hosts, [bgalazka-addon-host-folder='true']",
          )
        ) {
          return null;
        }
        return tab;
      }

      function isNormalTabAlreadyUnloaded(tab) {
        return !!(
          !tab?.linkedPanel ||
          tab.hasAttribute("pending") ||
          tab.hasAttribute("discarded") ||
          (tab.hasAttribute("zen-dormant") &&
            tab.getAttribute("zen-dormant") !== "false")
        );
      }

      function isAddonHostTab(tab) {
        return !!tab?.matches?.(
          "[bgalazka-addon-host], [bgalazka-addon-host-fallback]",
        );
      }
      function ensureSafeSuccessorBeforeNormalTabUnload(tab) {
        if (gBrowser.selectedTab !== tab) return true;
        // Choose a visible ordinary tab ourselves: a hidden panel host must never
        // become selected while its browser is reparented into a panel.
        const next = Array.from(gBrowser.tabs || []).find(
          (t) =>
            t !== tab &&
            t.isConnected &&
            !t.closing &&
            !t.hidden &&
            !isAddonHostTab(t) &&
            !!t.linkedPanel,
        );
        if (next) gBrowser.selectedTab = next;
        else if (gBrowser.addTrustedTab)
          gBrowser.selectedTab = gBrowser.addTrustedTab("about:newtab", {
            skipAnimation: true,
          });
        return (
          gBrowser.selectedTab !== tab && !isAddonHostTab(gBrowser.selectedTab)
        );
      }

      async function unloadNormalTabFromMiddleClick(tab) {
        if (
          !tab?.isConnected ||
          tab.closing ||
          isNormalTabAlreadyUnloaded(tab)
        ) {
          return;
        }

        try {
          if (!ensureSafeSuccessorBeforeNormalTabUnload(tab)) return;

          // Match Zen's Essential behavior: selected tabs have already been moved
          // to a verified non-host successor above, so explicitUnloadTabs() never
          // has to choose between ordinary tabs and Zentral's hidden host tabs.
          if (typeof gBrowser.explicitUnloadTabs === "function") {
            await gBrowser.explicitUnloadTabs([tab]);
            return;
          }

          // Compatibility fallback for builds that predate explicitUnloadTabs().
          // discardBrowser() cannot discard the selected tab, so move selection
          // first when necessary.
          if (gBrowser.selectedTab === tab) {
            const replacement = Array.from(gBrowser.tabs || []).find(
              (candidate) =>
                candidate !== tab &&
                candidate?.isConnected &&
                !candidate.closing &&
                !candidate.hidden &&
                !isAddonHostTab(candidate) &&
                !!candidate.linkedPanel,
            );
            if (replacement) {
              gBrowser.selectedTab = replacement;
            } else if (typeof gBrowser.addTrustedTab === "function") {
              gBrowser.selectedTab = gBrowser.addTrustedTab("about:newtab", {
                skipAnimation: true,
              });
            }
          }

          if (gBrowser.selectedTab === tab) return;
          if (typeof gBrowser.prepareDiscardBrowser === "function") {
            await gBrowser.prepareDiscardBrowser(tab);
          }
          gBrowser.discardBrowser?.(tab, true);
        } catch (_) {}
      }

      function clearNormalTabMmbGesture(tab = null) {
        if (tab && normalTabMmbGesture?.tab !== tab) return;
        if (normalTabMmbFallbackTimer) {
          window.clearTimeout(normalTabMmbFallbackTimer);
          normalTabMmbFallbackTimer = null;
        }
        normalTabMmbGesture = null;
      }

      function onNormalTabMMBCapture(event) {
        if (event.button !== 1) return;
        if (!getPref(EXT_PREFS.MMB_UNLOAD_NORMAL_TABS, false)) {
          clearNormalTabMmbGesture();
          return;
        }

        const tab = getNormalTabFromMiddleClickEvent(event);
        if (!tab) return;

        // A fresh MMB gesture only gets captured for a loaded normal tab. If the
        // tab is already unloaded, do nothing here and let Zen's native MMB close
        // behavior run exactly as before.
        if (normalTabMmbGesture?.tab !== tab) {
          if (isNormalTabAlreadyUnloaded(tab)) return;
          if (
            tab.linkedBrowser &&
            tab.linkedBrowser.isRemoteBrowser === false
          ) {
            return;
          }
          clearNormalTabMmbGesture();
          normalTabMmbGesture = { tab, unloadTriggered: false };
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const gesture = normalTabMmbGesture;
        if (!gesture || gesture.tab !== tab) return;

        if (event.type === "auxclick") {
          if (!gesture.unloadTriggered) {
            gesture.unloadTriggered = true;
            void unloadNormalTabFromMiddleClick(tab);
          }
          clearNormalTabMmbGesture(tab);
          return;
        }

        if (event.type === "mouseup" && !gesture.unloadTriggered) {
          // Some Zen builds perform their MMB tab action on mouseup. Keep the
          // gesture captured through the following auxclick so a tab that becomes
          // unloaded here cannot immediately receive the native close action.
          gesture.unloadTriggered = true;
          void unloadNormalTabFromMiddleClick(tab);
          normalTabMmbFallbackTimer = window.setTimeout(
            () => clearNormalTabMmbGesture(tab),
            500,
          );
        }
      }

      normalTabMmbEvents.forEach((type) =>
        window.addEventListener(type, onNormalTabMMBCapture, true),
      );
      registerCleanup(() => {
        normalTabMmbEvents.forEach((type) =>
          window.removeEventListener(type, onNormalTabMMBCapture, true),
        );
        clearNormalTabMmbGesture();
      });

      const destroy = () => {
        cleanups
          .splice(0)
          .reverse()
          .forEach((fn) => fn());
        delete window.ZentralTabUnload;
      };
      window.ZentralTabUnload = { destroy };
      window.addEventListener("unload", destroy, { once: true });
      return destroy;
    }
    if (window.ZentralRuntime)
      ZentralRuntime.register({ id: "tab-unload", init: start });
    else standaloneReady(start);
  })();
})();
