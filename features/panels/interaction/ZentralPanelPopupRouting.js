/*
 * ZENTRAL FILE GUIDE - features/panels/interaction/ZentralPanelPopupRouting.js
 *
 * Purpose: Optional adapter for opening links/popups into owned panels while delegating normal browser
 *   requests.
 * Interaction / execution: Constructed by ZentralPanels after toolbar/settings and before
 *   BrowserIntegrations. hookPopupContainment wraps the BrowserDOMWindow object through a delegate rather
 *   than writing a read-only native method.
 * Ownership / failure: Cleanup restores only its installed delegate. Missing/failing adapter leaves native
 *   popup behavior and does not block the panel suite.
 * Registration: panel-popup-routing
 * Loaded/created by: features/panels/ZentralPanels.uc.js
 * Returned factory API: hookPopupContainment
 * Shared ctx symbols used: getAllAppBrowsers
 * Cross-file calls / ctx suppliers: features/panels/styling/ZentralPanelStyles.uc.js -> ctx.getAllAppBrowsers
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "panel-popup-routing",
    function ({ ctx, registerCleanup }) {
      let popupAdapter = null;
      let popupHookUnsupported = false;

      function hookPopupContainment() {
        const original = window.browserDOMWindow;
        if (!original) return false;
        if (popupHookUnsupported || popupAdapter) return true;

        // browserDOMWindow is an XPCOM interface: its methods are read-only.
        // Install a complete delegating implementation through the window setter.
        const adapter = {
          QueryInterface: ChromeUtils.generateQI(["nsIBrowserDOMWindow"]),
          get tabCount() {
            return original.tabCount;
          },
          canClose() {
            return original.canClose();
          },
        };
        for (const method of [
          "openURI",
          "createContentWindow",
          "openURIInFrame",
          "createContentWindowInFrame",
        ]) {
          adapter[method] = function (...args) {
            const [uri, info, where, flags] = args;
            const inFrame = method.endsWith("InFrame");
            const createOnly = method.startsWith("create");
            const api = Ci.nsIBrowserDOMWindow;
            try {
              // External opens and printing retain Gecko's native routing.
              if (
                !(flags & api.OPEN_EXTERNAL) &&
                where !== api.OPEN_PRINT_BROWSER
              ) {
                const opener = inFrame
                  ? info?.openWindowInfo?.parent
                  : info?.parent;
                const context = opener?.top || opener;
                const matched = ctx
                  .getAllAppBrowsers()
                  .find(
                    (browser) =>
                      browser.isConnected &&
                      browser.browsingContext &&
                      (browser.browsingContext === context ||
                        (inFrame && info?.openerBrowser === browser)),
                  );
                if (matched) {
                  if (!createOnly && uri) {
                    const options = {
                      triggeringPrincipal: inFrame
                        ? info.triggeringPrincipal
                        : args[4],
                    };
                    if (inFrame) {
                      options.referrerInfo = info.referrerInfo;
                      options.policyContainer = info.policyContainer;
                    } else if (args[5]) {
                      // Gecko renamed the sixth argument from CSP to policy container.
                      if (typeof Ci.nsIPolicyContainer !== "undefined")
                        options.policyContainer = args[5];
                      else options.csp = args[5];
                    }
                    if (flags & api.OPEN_NO_REFERRER)
                      options.referrerInfo = null;
                    matched.loadURI(uri, options);
                  }
                  return inFrame ? matched : matched.browsingContext;
                }
              }
            } catch (error) {
              console.warn(
                "[BgalazkaExtension] Popup containment failed:",
                error,
              );
            }
            return original[method](...args);
          };
        }
        try {
          window.browserDOMWindow = adapter;
          // The getter may return a new XPCOM wrapper, so identity is not a test.
          if (!window.browserDOMWindow)
            throw new Error("browserDOMWindow setter rejected the adapter");
          popupAdapter = window.browserDOMWindow;
        } catch (error) {
          popupHookUnsupported = true;
          console.warn(
            "[BgalazkaExtension] Popup containment unavailable:",
            error,
          );
          return true;
        }
        registerCleanup(() => {
          try {
            // Do not overwrite a replacement installed by another extension.
            if (window.browserDOMWindow === popupAdapter)
              window.browserDOMWindow = original;
          } catch (_) {}
          popupAdapter = null;
        });
        return true;
      }

      return { hookPopupContainment };
    },
  );
})();
