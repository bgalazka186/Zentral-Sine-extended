/*
 * ZENTRAL FILE GUIDE - features/panels/interaction/ZentralPanelInput.js
 *
 * Purpose: Scopes panel pointer/navigation/context-menu input and delegates native Back/Forward commands
 *   and menu actions to the correct visible panel browser.
 * Interaction / execution: Constructed early by ZentralPanels; getVisiblePanelBrowser supports coordinator
 *   keyboard targeting. Works with hover visibility, owned browser enumeration and native
 *   AppCommand/bookmark/context APIs.
 * Ownership / failure: Registers native listener/hook restoration and event cleanup with ctx.
 *   Closing/autohidden panels must not intercept input; ordinary browser input delegates to the original
 *   native handler.
 * Registration: panels/ZentralPanelInput
 * Loaded/created by: features/panels/ZentralPanels.uc.js
 * Returned factory API: getVisiblePanelBrowser
 * Shared ctx symbols used: canPanelNavigate; getActiveAppBrowser; navigatePanelHistory
 * Cross-file calls / ctx suppliers: features/panels/navigation/ZentralPanelToolbar.uc.js -> ctx.canPanelNavigate,
 *   ctx.getActiveAppBrowser, ctx.navigatePanelHistory
 * Literal DOM event subscriptions: AppCommand; blur; command; mouseout; popuphidden; popupshowing
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "panels/ZentralPanelInput",
    function ({
      BGALAZKA_EXT_PREFS,
      Services,
      clearTimeout,
      ctx,
      getPref,
      registerCleanup,
      setPref,
      setTimeout,
    }) {
      function ensureInputShieldForKeybinds() {
        if (!getPref(BGALAZKA_EXT_PREFS.KEYBINDS_ENABLED, false)) return;
        if (!getPref(BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, false)) {
          setPref(BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, true);
        }
        document.documentElement.setAttribute(
          "bgalazka-panel-input-shield",
          "true",
        );
      }
      ensureInputShieldForKeybinds();

      /* ==========================================================================
       * NORMAL TAB MIDDLE-CLICK UNLOAD
       * -----------------------------------------------------------------------
       * Optional replacement for Zen/Firefox's native MMB-close behavior on
       * ordinary, loaded tabs. Already-unloaded tabs are deliberately NOT
       * intercepted, so their native MMB action still closes them. Corner app
       * tiles are excluded because they have their own MMB unload behavior.
       * ========================================================================== */

      /* ==========================================================================
       * PANEL INPUT SHIELD
       * -----------------------------------------------------------------------
       * UNIVERSAL: use runtime DOM/browser ownership, never installation/profile
       * paths. Native side buttons may arrive as AppCommand rather than DOM mouse
       * events. Firefox registers HandleAppCommandEvent on window in capture phase
       * before mods load; adding a later listener cannot undo its navigation. We
       * replace that specific listener with a scoped delegate and restore it on
       * cleanup. Ordinary commands and input outside panels retain native behavior.
       * Triple/Super View must route to the browser under the input, not the last
       * browser in the main slider. No overlay may cover the page's own controls.
       * ========================================================================== */
      const PANEL_INPUT_SHIELD_EVENTS = [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "auxclick",
      ];
      const PANEL_INPUT_SHIELD_POINTER_EVENTS = ["pointermove", "mouseover"];
      let panelShieldPointerKnown = false;
      let panelShieldPointer = null;
      const panelShieldPresses = new Map();
      let panelShieldLastNav = null;

      function panelShieldIsOpen() {
        const root = document.getElementById("zen-app-panel-root");
        return Boolean(
          root?.hasAttribute("open") &&
          !root.hasAttribute("closing") &&
          !document.documentElement.hasAttribute(
            "bgalazka-hover-panel-hidden",
          ) &&
          root.dataset.instaPeek !== "true",
        );
      }

      function panelShieldIsVisible(node) {
        if (!node?.isConnected) return false;
        const style = window.getComputedStyle(node);
        return (
          !node.hidden &&
          node.getAttribute("hidden") !== "true" &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.visibility !== "collapse" &&
          node.getClientRects().length > 0
        );
      }

      function getVisiblePanelBrowser() {
        const panel = document.getElementById("zen-app-panel-slider");
        const primary = ctx.getActiveAppBrowser?.();
        if (
          primary &&
          panel?.contains(primary) &&
          panelShieldIsVisible(primary)
        )
          return primary;
        return (
          Array.from(panel?.querySelectorAll("browser") || [])
            .reverse()
            .find(panelShieldIsVisible) || null
        );
      }

      function panelShieldBrowserForNode(node) {
        if (!panelShieldIsOpen() || !node?.closest) return null;
        const surface = node.closest(
          "#zen-app-panel-root, #bgalazka-super-panel",
        );
        if (!surface || !panelShieldIsVisible(surface)) return null;
        const direct = node.closest("browser");
        if (direct && surface.contains(direct) && panelShieldIsVisible(direct))
          return direct;
        const secondary = node.closest("#bgalazka-super-panel");
        if (secondary) {
          // In Triple View the secondary toolbar and browser are siblings.
          const browser =
            secondary.querySelector("browser") ||
            document.querySelector(
              'browser[data-bgalazka-triple-slot="bottom"]',
            );
          return panelShieldIsVisible(browser) ? browser : null;
        }
        return getVisiblePanelBrowser();
      }

      function panelShieldBrowserForEvent(event) {
        for (const node of event.composedPath?.() || [event.target]) {
          const browser = panelShieldBrowserForNode(node);
          if (browser) return browser;
        }
        // Remote content/native commands can be retargeted to the chrome window.
        // Hit-test the actual chrome point, never a remembered active app alone.
        if (
          event.type !== "AppCommand" &&
          Number.isFinite(event.clientX) &&
          Number.isFinite(event.clientY)
        )
          return panelShieldBrowserForNode(
            document.elementFromPoint(event.clientX, event.clientY),
          );
        return null;
      }

      function panelShieldTrackPointer(event) {
        panelShieldPointerKnown = true;
        panelShieldPointer = { x: event.clientX, y: event.clientY };
      }
      function panelShieldPointerOut(event) {
        if (!event.relatedTarget) {
          panelShieldPointerKnown = true;
          panelShieldPointer = null;
        }
      }
      function panelShieldResetInput() {
        panelShieldPresses.clear();
        panelShieldPointerKnown = false;
        panelShieldPointer = null;
        panelShieldLastNav = null;
      }

      function panelShieldConsume(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }

      function navigateVisiblePanelBrowser(
        button,
        browser = getVisiblePanelBrowser(),
      ) {
        if (!browser) return;
        try {
          ctx.navigatePanelHistory(browser, button === 3 ? -1 : 1);
        } catch (error) {
          console.warn(
            "[BgalazkaExtension] Panel input shield navigation failed:",
            error,
          );
        }
      }

      function panelShieldNavigate(button, browser, source) {
        const now = Date.now();
        const previous = panelShieldLastNav;
        // Some drivers report both native AppCommand and DOM mouseup for one
        // press. Suppress only a paired transport, never rapid presses on the
        // same transport. A new DOM down also starts a fresh physical sequence.
        if (
          previous &&
          previous.button === button &&
          previous.browser === browser &&
          previous.source !== source &&
          !previous.paired &&
          now - previous.time < 220
        ) {
          previous.paired = true;
          return;
        }
        panelShieldLastNav = {
          button,
          browser,
          source,
          time: now,
          paired: false,
        };
        navigateVisiblePanelBrowser(button, browser);
      }

      const panelInputShieldHandler = (event) => {
        if (event.type === "mouseup") panelShieldPresses.delete(event.button);
        if (!getPref(BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, false)) return;
        if (event.button !== 3 && event.button !== 4) return;
        if (!panelShieldIsOpen()) return;
        const browser = panelShieldBrowserForEvent(event);
        if (!browser) return;
        panelShieldTrackPointer(event);
        panelShieldConsume(event);
        if (event.type === "pointerdown" || event.type === "mousedown") {
          if (!panelShieldPresses.has(event.button)) {
            panelShieldPresses.set(event.button, browser);
            panelShieldLastNav = null;
          }
        } else if (event.type === "mouseup") {
          panelShieldPresses.delete(event.button);
          panelShieldNavigate(event.button, browser, "mouse");
        }
      };

      const panelInputShieldAppCommandHandler = (event) => {
        if (
          !getPref(BGALAZKA_EXT_PREFS.PANEL_INPUT_SHIELD, false) ||
          !panelShieldIsOpen()
        )
          return false;
        const button =
          event.command === "Back" ? 3 : event.command === "Forward" ? 4 : null;
        if (button === null) return false;
        let browser = panelShieldBrowserForEvent(event);
        if (!browser && panelShieldPointerKnown) {
          if (panelShieldPointer)
            browser = panelShieldBrowserForNode(
              document.elementFromPoint(
                panelShieldPointer.x,
                panelShieldPointer.y,
              ),
            );
        } else if (!browser) {
          // Keyboard/hardware commands may have no pointer observation. Only
          // actual focus inside a visible panel can then claim the command.
          browser = panelShieldBrowserForNode(document.activeElement);
        }
        if (!browser) return false;
        // Consume even at the beginning/end of panel history: falling back to
        // the selected main tab here is precisely the pass-through bug.
        panelShieldConsume(event);
        panelShieldNavigate(button, browser, "appcommand");
        return true;
      };

      const nativePanelAppCommandHandler = window.HandleAppCommandEvent;
      const panelAppCommandDelegate = function (event) {
        if (panelInputShieldAppCommandHandler(event)) return;
        if (typeof nativePanelAppCommandHandler === "function")
          nativePanelAppCommandHandler.call(window, event);
      };
      if (typeof nativePanelAppCommandHandler === "function")
        window.removeEventListener(
          "AppCommand",
          nativePanelAppCommandHandler,
          true,
        );
      window.addEventListener("AppCommand", panelAppCommandDelegate, true);
      PANEL_INPUT_SHIELD_EVENTS.forEach((type) =>
        window.addEventListener(type, panelInputShieldHandler, true),
      );
      PANEL_INPUT_SHIELD_POINTER_EVENTS.forEach((type) =>
        window.addEventListener(type, panelShieldTrackPointer, true),
      );
      window.addEventListener("mouseout", panelShieldPointerOut, true);
      window.addEventListener("blur", panelShieldResetInput);
      registerCleanup(() => {
        window.removeEventListener("AppCommand", panelAppCommandDelegate, true);
        if (typeof nativePanelAppCommandHandler === "function")
          window.addEventListener(
            "AppCommand",
            nativePanelAppCommandHandler,
            true,
          );
        PANEL_INPUT_SHIELD_EVENTS.forEach((type) =>
          window.removeEventListener(type, panelInputShieldHandler, true),
        );
        PANEL_INPUT_SHIELD_POINTER_EVENTS.forEach((type) =>
          window.removeEventListener(type, panelShieldTrackPointer, true),
        );
        window.removeEventListener("mouseout", panelShieldPointerOut, true);
        window.removeEventListener("blur", panelShieldResetInput);
        panelShieldResetInput();
      });

      /* ==========================================================================
       * PANEL CONTENT CONTEXT MENU
       * UNIVERSAL: freeze the browser from Gecko's menu context, not the selected
       * tab, current app, pointer location after opening, or an installation path.
       * This also identifies the correct upper/lower/floating secondary browser.
       * Firefox's navigation items forward through shared command elements and
       * Bookmark This Page uses selectedBrowser. Temporarily detach ONLY these
       * menu items from their shared commands; never change gBrowser selection.
       * Bubble popupshowing runs after Gecko has built gContextMenu. Restore on
       * the next turn after popuphidden, because XUL can hide before dispatching
       * the chosen command. Copy/link/media items keep their native actor routing.
       * ========================================================================== */
      const PANEL_CONTEXT_ACTIONS = new Map([
        ["context-back", "back"],
        ["context-forward", "forward"],
        ["context-reload", "reload"],
        ["context-stop", "stop"],
        ["context-bookmarkpage", "bookmark"],
      ]);
      const PANEL_CONTEXT_ATTRIBUTES = [
        "command",
        "observes",
        "oncommand",
        "disabled",
        "hidden",
        "starred",
        "data-l10n-id",
        "data-l10n-args",
        "label",
        "tooltiptext",
      ];
      let panelContextSession = null;
      let panelContextRestoreTimer = null;

      function restorePanelContextMenu() {
        if (panelContextRestoreTimer !== null)
          clearTimeout(panelContextRestoreTimer);
        panelContextRestoreTimer = null;
        const session = panelContextSession;
        panelContextSession = null;
        if (!session) return;
        for (const [item, attributes] of session.saved) {
          for (const [name, value] of attributes) {
            if (value === null) item.removeAttribute(name);
            else item.setAttribute(name, value);
          }
        }
      }

      function panelContextSetFlag(item, name, enabled) {
        if (!item) return;
        // XUL uses the literal "true" for disabled/hidden, not HTML's empty
        // boolean attribute; toggleAttribute alone leaves these icons enabled.
        if (enabled) item.setAttribute(name, "true");
        else item.removeAttribute(name);
      }

      function applyPanelContextBookmarkState() {
        const session = panelContextSession;
        const item = session?.items.get("context-bookmarkpage");
        if (!item) return;
        item.toggleAttribute("starred", session.starred);
        const mac = Services.appinfo.OS === "Darwin";
        const id = session.starred
          ? "main-context-menu-edit-bookmark"
          : "main-context-menu-bookmark-page";
        // Do not modify the URL-bar star or the selected tab's bookmark state.
        document.l10n?.setAttributes(item, id + (mac ? "-mac" : ""));
      }

      function onPanelContextMenuPreparing(event) {
        if (event.target?.id === "contentAreaContextMenu")
          restorePanelContextMenu();
      }

      function onPanelContextMenuShowing(event) {
        const menu = event.target;
        if (menu?.id !== "contentAreaContextMenu" || event.defaultPrevented)
          return;
        const context = window.gContextMenu;
        const browser = context?.browser;
        if (!browser || panelShieldBrowserForNode(browser) !== browser) return;
        let url = "";
        try {
          url = Services.io.createExposableURI(browser.currentURI).spec;
        } catch (_) {
          // Never fall back to selectedBrowser if the clicked browser went away.
          return;
        }
        const session = {
          menu,
          context,
          browser,
          url,
          title: browser.contentTitle || url,
          saved: new Map(),
          items: new Map(),
          starred: false,
          handled: false,
        };
        panelContextSession = session;
        for (const id of PANEL_CONTEXT_ACTIONS.keys()) {
          const item = document.getElementById(id);
          if (!item || !menu.contains(item)) continue;
          session.items.set(id, item);
          session.saved.set(
            item,
            PANEL_CONTEXT_ATTRIBUTES.map((name) => [
              name,
              item.hasAttribute(name) ? item.getAttribute(name) : null,
            ]),
          );
          item.removeAttribute("command");
          item.removeAttribute("observes");
          item.removeAttribute("oncommand");
          item.removeAttribute("disabled");
        }
        panelContextSetFlag(
          session.items.get("context-back"),
          "disabled",
          !ctx.canPanelNavigate(browser, -1),
        );
        panelContextSetFlag(
          session.items.get("context-forward"),
          "disabled",
          !ctx.canPanelNavigate(browser, 1),
        );
        // A loading main tab must not turn the idle panel's Reload into Stop.
        const loading = Boolean(browser.webProgress?.isLoadingDocument);
        panelContextSetFlag(
          session.items.get("context-reload"),
          "hidden",
          loading,
        );
        panelContextSetFlag(
          session.items.get("context-stop"),
          "hidden",
          !loading,
        );
        panelContextSetFlag(
          session.items.get("context-bookmarkpage"),
          "disabled",
          !url || typeof window.PlacesCommandHook?.bookmarkLink !== "function",
        );
        applyPanelContextBookmarkState();
        try {
          const places =
            window.PlacesUtils ||
            ChromeUtils.importESModule(
              "resource://gre/modules/PlacesUtils.sys.mjs",
            ).PlacesUtils;
          Promise.resolve(places.bookmarks.fetch({ url }))
            .then((info) => {
              if (panelContextSession !== session) return;
              session.starred = Boolean(info);
              applyPanelContextBookmarkState();
            })
            .catch((error) =>
              console.warn("[Zentral] Panel bookmark lookup failed:", error),
            );
        } catch (error) {
          console.warn("[Zentral] Panel bookmark lookup unavailable:", error);
        }
      }

      function onPanelContextMenuCommand(event) {
        const session = panelContextSession;
        if (!session) return;
        // sourceEvent covers older XUL versions that forward command events.
        let source = event;
        let item = null;
        for (
          let depth = 0;
          source && depth < 8;
          depth++, source = source.sourceEvent
        ) {
          const candidate = session.items.get(source.target?.id);
          if (candidate && candidate === source.target) {
            item = candidate;
            break;
          }
        }
        if (!item) return;
        panelShieldConsume(event);
        // A closed/unloaded/replaced panel never delegates to the main tab.
        if (
          session.handled ||
          item.getAttribute("disabled") === "true" ||
          panelShieldBrowserForNode(session.browser) !== session.browser
        )
          return;
        session.handled = true;
        const browser = session.browser;
        const action = PANEL_CONTEXT_ACTIONS.get(item.id);
        try {
          switch (action) {
            case "back":
              ctx.navigatePanelHistory(browser, -1);
              break;
            case "forward":
              ctx.navigatePanelHistory(browser, 1);
              break;
            case "reload": {
              const bypass = Boolean(
                event.shiftKey || event.sourceEvent?.shiftKey,
              );
              if (bypass) {
                const flags =
                  Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE |
                  Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_PROXY;
                if (typeof browser.reloadWithFlags === "function")
                  browser.reloadWithFlags(flags);
                else browser.webNavigation?.reload(flags);
              } else if (typeof browser.reload === "function") browser.reload();
              else browser.webNavigation?.reload(0);
              break;
            }
            case "stop":
              if (typeof browser.stop === "function") browser.stop();
              else browser.webNavigation?.stop(Ci.nsIWebNavigation.STOP_ALL);
              break;
            case "bookmark":
              // The URL/title are captured before any async bookmark dialog work.
              // bookmarkLink explicitly adds/edits this URL and never selects a tab.
              Promise.resolve(
                window.PlacesCommandHook.bookmarkLink(
                  session.url,
                  session.title,
                ),
              ).catch((error) =>
                console.warn("[Zentral] Panel bookmark command failed:", error),
              );
              break;
          }
        } catch (error) {
          console.warn("[Zentral] Panel context command failed:", error);
        }
      }

      function onPanelContextMenuHidden(event) {
        if (event.target !== panelContextSession?.menu) return;
        panelContextRestoreTimer = setTimeout(restorePanelContextMenu, 0);
      }
      // The selected-tab bookmark query may finish while this popup is open.
      // Reapply only the context item after native updates so that its label/star
      // cannot be overwritten with the main tab's async bookmark result.
      const nativeContextBookmarkUpdate =
        window.BookmarkingUI?.updateBookmarkPageMenuItem;
      const panelContextBookmarkUpdate = function (...args) {
        const result = nativeContextBookmarkUpdate.apply(this, args);
        applyPanelContextBookmarkState();
        return result;
      };
      if (typeof nativeContextBookmarkUpdate === "function")
        window.BookmarkingUI.updateBookmarkPageMenuItem =
          panelContextBookmarkUpdate;
      window.addEventListener(
        "popupshowing",
        onPanelContextMenuPreparing,
        true,
      );
      window.addEventListener("popupshowing", onPanelContextMenuShowing);
      window.addEventListener("command", onPanelContextMenuCommand, true);
      window.addEventListener("popuphidden", onPanelContextMenuHidden, true);
      registerCleanup(() => {
        window.removeEventListener(
          "popupshowing",
          onPanelContextMenuPreparing,
          true,
        );
        window.removeEventListener("popupshowing", onPanelContextMenuShowing);
        window.removeEventListener("command", onPanelContextMenuCommand, true);
        window.removeEventListener(
          "popuphidden",
          onPanelContextMenuHidden,
          true,
        );
        if (
          window.BookmarkingUI?.updateBookmarkPageMenuItem ===
          panelContextBookmarkUpdate
        )
          window.BookmarkingUI.updateBookmarkPageMenuItem =
            nativeContextBookmarkUpdate;
        restorePanelContextMenu();
      });

      return { getVisiblePanelBrowser };
    },
  );
})();
