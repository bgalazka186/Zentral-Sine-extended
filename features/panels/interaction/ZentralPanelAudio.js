/*
 * ZENTRAL FILE GUIDE - features/panels/interaction/ZentralPanelAudio.js
 *
 * Purpose: Tracks owned panel media controllers, builds native mute/unmute controls and performs bounded
 *   visible activity recovery.
 * Interaction / execution: Constructed after BrowserIntegrations/PanelStyles by ZentralPanels. Calls
 *   ctx.getAllAppBrowsers and syncAppPanelBrowserActivity; uses coordinator retry keys and cleanup
 *   registration.
 * Ownership / failure: PanelMediaListeners track controller replacements; cleanup detaches controller
 *   listeners. Closing does not unload notification pages or stop source audio merely to suppress hidden
 *   rendering.
 * Registration: panels/ZentralPanelAudio
 * Loaded/created by: features/panels/ZentralPanels.uc.js
 * Returned factory API: ensureNativeAudioButton; mediaEvents; onAudioStarted; onAudioStopped;
 *   panelActivityRetryKey; panelMediaListeners; refreshPanelAudio; togglePanelAudio
 * Shared ctx symbols used: ensureMobileUaMenuItem; ensurePanelPrivacyMenuItems; essentialPanels;
 *   getActiveAppBrowser; getAllAppBrowsers; requestPanelActivity; requestTileSync; retryPanelTask;
 *   saveEssentialSettings; syncAppPanelBrowserActivity
 * Cross-file calls / ctx suppliers: features/panels/browsers/ZentralBrowserIntegrations.uc.js -> ctx.ensureMobileUaMenuItem,
 *   ctx.ensurePanelPrivacyMenuItems, ctx.syncAppPanelBrowserActivity; features/panels/corner-tiles/ZentralCornerPanels.uc.js ->
 *   ctx.essentialPanels, ctx.requestTileSync, ctx.saveEssentialSettings; features/panels/styling/ZentralPanelStyles.uc.js ->
 *   ctx.getAllAppBrowsers; features/panels/navigation/ZentralPanelToolbar.uc.js -> ctx.getActiveAppBrowser
 * Contract fields assigned here: ctx.requestPanelActivity
 * Literal DOM event subscriptions: click; command; contextmenu; popupshowing
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define("panels/ZentralPanelAudio", function ({ BGALAZKA_EXT_PREFS, ctx, getPref, parseSVG, registerCleanup }) {
      const panelMediaListeners = new Map();
      const panelAudioSeen = new WeakSet();
      const mediaEvents = [
        "audiblechange",
        "playbackstatechange",
        "activated",
        "deactivated",
      ];
      const AUDIO_ICON =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>';
      const MUTED_ICON =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4zM16 9l5 6M21 9l-5 6"/></svg>';

      function panelAudioState(browser) {
        if (!browser) return { playing: false, muted: false, visible: false };
        try {
          const controller = browser.browsingContext?.mediaController;
          const tab = window.gBrowser?.getTabForBrowser?.(browser);
          const playing = !!(
            controller?.isAudible ||
            browser._bgalazkaAudioPlaying ||
            tab?.hasAttribute("soundplaying")
          );
          const muted = !!(
            browser.audioMuted ||
            controller?.isMuted ||
            tab?.hasAttribute("muted")
          );
          if (playing) panelAudioSeen.add(browser);
          // Keep Unmute reachable after muting; never show on a silent fresh page.
          return {
            playing,
            muted,
            visible: playing || (muted && panelAudioSeen.has(browser)),
          };
        } catch (_) {
          return { playing: false, muted: false, visible: false };
        }
      }

      function onAudioStarted(event) {
        event.currentTarget._bgalazkaAudioPlaying = true;
        refreshPanelAudio();
      }
      function onAudioStopped(event) {
        event.currentTarget._bgalazkaAudioPlaying = false;
        refreshPanelAudio();
      }
      function trackPanelMedia(browser) {
        const controller = browser.browsingContext?.mediaController;
        const previous = panelMediaListeners.get(browser);
        if (previous === controller) return;
        if (previous)
          mediaEvents.forEach((type) =>
            previous.removeEventListener(type, refreshPanelAudio),
          );
        panelMediaListeners.delete(browser);
        if (controller) {
          mediaEvents.forEach((type) =>
            controller.addEventListener(type, refreshPanelAudio),
          );
          panelMediaListeners.set(browser, controller);
        }
      }
      function updateAudioButton(button, browser) {
        const state = panelAudioState(browser);
        button.hidden =
          !getPref(BGALAZKA_EXT_PREFS.AUDIO_INDICATOR, false) || !state.visible;
        const muted = state.muted ? "true" : "false";
        if (button.dataset.muted !== muted) {
          button.dataset.muted = muted;
          button.replaceChildren(
            parseSVG(state.muted ? MUTED_ICON : AUDIO_ICON),
          );
        }
        button.title = state.muted ? "Unmute panel" : "Mute panel";
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-pressed", muted);
      }
      function togglePanelAudio(browser) {
        if (!browser) return;
        try {
          const muted = panelAudioState(browser).muted;
          const tab = window.gBrowser?.getTabForBrowser?.(browser);
          const method = muted ? "unmute" : "mute";
          // Use native browser/tab APIs when present (Zen versions differ).
          if (typeof tab?.toggleMuteAudio === "function") tab.toggleMuteAudio();
          else if (typeof browser[method] === "function") browser[method]();
          else browser.browsingContext?.mediaController?.[method]?.();
          refreshPanelAudio();
        } catch (error) {
          console.warn("[BgalazkaExtension] Panel mute failed", error);
        }
      }
      function ensureNativeAudioButton() {
        const wrap = document.querySelector(
          "#zen-app-panel-toolbar .zen-toolbar-urlwrap",
        );
        if (!wrap || wrap.querySelector(".bgalazka-audio-button")) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "zen-toolbar-btn bgalazka-audio-button";
        button.hidden = true;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          togglePanelAudio(ctx.getActiveAppBrowser());
        });
        wrap.appendChild(button);
      }
      function refreshPanelAudio() {
        const browsers = ctx.getAllAppBrowsers();
        for (const [browser, controller] of panelMediaListeners) {
          if (browser.isConnected) continue;
          mediaEvents.forEach((type) =>
            controller.removeEventListener(type, refreshPanelAudio),
          );
          panelMediaListeners.delete(browser);
        }
        for (const browser of browsers) trackPanelMedia(browser);
        ensureNativeAudioButton();
        const button = document.querySelector(
          "#zen-app-panel-toolbar .bgalazka-audio-button",
        );
        if (button) updateAudioButton(button, ctx.getActiveAppBrowser());
        const byId = new Map(
          browsers.map((browser) => [browser._bgalazkaAppId, browser]),
        );
        const enabled = getPref(BGALAZKA_EXT_PREFS.AUDIO_INDICATOR, false);
        document
          .querySelectorAll(".zen-app-tile[data-app-id]")
          .forEach((tile) => {
            const state = panelAudioState(byId.get(tile.dataset.appId));
            let indicator = tile.querySelector(".bgalazka-tile-audio");
            if (!enabled || !state.visible) {
              indicator?.remove();
              return;
            }
            if (!indicator) {
              // The tile is already a button: use an indicator span, not nested buttons.
              indicator = document.createElement("span");
              indicator.className = "bgalazka-tile-audio";
              indicator.setAttribute("role", "button");
              indicator.setAttribute("tabindex", "0");
              tile.appendChild(indicator);
            }
            const muted = state.muted ? "true" : "false";
            indicator.title = state.muted ? "Unmute panel" : "Mute panel";
            indicator.setAttribute("aria-label", indicator.title);
            indicator.setAttribute("aria-pressed", muted);
            if (indicator.dataset.muted !== muted) {
              indicator.dataset.muted = muted;
              indicator.replaceChildren(
                parseSVG(state.muted ? MUTED_ICON : AUDIO_ICON),
              );
            }
          });
      }
      const essentialPopupHandler = (event) => {
        const popup = event.target;
        if (popup.id !== "zen-apps-sidebar-tile-context") return;
        const record = ctx.essentialPanels.get(popup.dataset.activeAppId);
        if (!record) return; // native handler already restored the normal app menu
        ctx.ensurePanelPrivacyMenuItems();
        ctx.ensureMobileUaMenuItem();
        const preload = popup.querySelector("#zen-apps-sidebar-preload-item");
        if (preload) {
          preload.hidden = false;
          preload.removeAttribute("hidden");
          if (record.app.preload) preload.setAttribute("checked", "true");
          else preload.removeAttribute("checked");
        }
        for (const id of [
          "zen-apps-sidebar-pin-to-menu",
          "zen-apps-sidebar-remove-item",
          "zen-apps-sidebar-sec2-sep",
          "zen-apps-sidebar-sec3-sep",
        ])
          popup.querySelector(`#${id}`)?.setAttribute("hidden", "true");
      };
      const essentialContextMenu = (event) => {
        const tile = event.target.closest?.(".bgalazka-essential-tile");
        if (!tile || !ctx.essentialPanels.has(tile.dataset.appId)) return;
        const popup = document.getElementById("zen-apps-sidebar-tile-context");
        if (!popup) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        popup.dataset.activeAppId = tile.dataset.appId;
        popup.openPopupAtScreen(event.screenX, event.screenY, true);
      };
      const essentialPreloadCommand = (event) => {
        if (event.target.id !== "zen-apps-sidebar-preload-item") return;
        const popup = document.getElementById("zen-apps-sidebar-tile-context");
        const record = ctx.essentialPanels.get(popup?.dataset.activeAppId);
        if (!record) return;
        event.stopImmediatePropagation();
        record.app.preload = !record.app.preload;
        record.preloadAttempted = false;
        ctx.saveEssentialSettings(record);
        if (record.app.preload) ctx.requestTileSync(0);
        if (record.app.preload) event.target.setAttribute("checked", "true");
        else event.target.removeAttribute("checked");
      };
      window.addEventListener("popupshowing", essentialPopupHandler);
      window.addEventListener("command", essentialPreloadCommand, true);
      window.addEventListener("contextmenu", essentialContextMenu, true);
      registerCleanup(() => {
        window.removeEventListener("popupshowing", essentialPopupHandler);
        window.removeEventListener("command", essentialPreloadCommand, true);
        window.removeEventListener("contextmenu", essentialContextMenu, true);
      });
      const panelActivityRetryKey = "panel-activity";
      ctx.requestPanelActivity = () => {
        ctx.retryPanelTask(panelActivityRetryKey, () => {
          ctx.syncAppPanelBrowserActivity();
          const root = document.getElementById("zen-app-panel-root");
          if (!root?.hasAttribute("open") || root.hasAttribute("closing") ||
              document.documentElement.hasAttribute("bgalazka-hover-panel-hidden")) return true;
          return ctx.getAllAppBrowsers().every(browser =>
            !browser.isConnected || browser.style.display === "none" ||
            browser.hasAttribute("hidden") ||
            (browser.browsingContext && browser.docShellIsActive &&
              (!browser.isRemoteBrowser || browser.renderLayers)));
        });
      };
return { ensureNativeAudioButton, mediaEvents, onAudioStarted, onAudioStopped, panelActivityRetryKey, panelMediaListeners, refreshPanelAudio, togglePanelAudio };
});
})();
