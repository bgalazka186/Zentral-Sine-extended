/*
 * ZENTRAL FILE GUIDE - features/panels/styling/ZentralPanelStyles.uc.js
 *
 * Purpose: Enumerates owned panel browsers, repairs visible presentation and synchronizes opt-in Zen
 *   Internet styles into panel content.
 * Interaction / execution: Required panel part resumed by ZentralPanels; BrowserIntegrations and
 *   CornerPanels use its browser/style hooks, Audio uses enumeration and SecondaryViews adds browsers.
 * Ownership / failure: Cleanup removes owned style bridges/listeners and cancels first-load jobs via ctx.
 *   Never inject these styles into unrelated native tabs or add-on state.
 * Registration: panel-styles
 * Loaded/created by: core/ZentralCatalog.js
 * Published lazy ctx API: attachZenInternetPanelBrowser; cancelZenCssFirstLoad; getAllAppBrowsers;
 *   repairVisiblePanelPresentation; repairZenInternetPanelCss; scheduleZenCssFirstLoad;
 *   setZenInternetPanelCssEnabled; updateZenCssBrowser; zenCssEnabled
 * Shared ctx symbols used: BGALAZKA_EXT_PREFS; cancelPanelRetry; clearTimeout; getPref; registerCleanup;
 *   retryPanelTask; setTimeout; syncAppPanelBrowserActivity
 * Cross-file calls / ctx suppliers: features/panels/browsers/ZentralBrowserIntegrations.uc.js -> ctx.syncAppPanelBrowserActivity;
 *   features/panels/ZentralPanels.uc.js -> ctx.BGALAZKA_EXT_PREFS, ctx.clearTimeout, ctx.getPref, ctx.registerCleanup,
 *   ctx.setTimeout
 * Literal DOM event subscriptions: DidChangeBrowserRemoteness
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
  // Feature: panel-styles. Imports and exports are listed in ARCHITECTURE.md.
  // Preparation publishes functions; activation preserves the baseline initialization order.
  ZentralRuntime.registerPart("panel-styles", function* (ctx) {
    Object.defineProperties(ctx, {
      attachZenInternetPanelBrowser: {
        configurable: true,
        get: () => attachZenInternetPanelBrowser,
      },
      cancelZenCssFirstLoad: {
        configurable: true,
        get: () => cancelZenCssFirstLoad,
      },
      getAllAppBrowsers: { configurable: true, get: () => getAllAppBrowsers },
      repairVisiblePanelPresentation: {
        configurable: true,
        get: () => repairVisiblePanelPresentation,
      },
      repairZenInternetPanelCss: {
        configurable: true,
        get: () => repairZenInternetPanelCss,
      },
      scheduleZenCssFirstLoad: {
        configurable: true,
        get: () => scheduleZenCssFirstLoad,
      },
      setZenInternetPanelCssEnabled: {
        configurable: true,
        get: () => setZenInternetPanelCssEnabled,
      },
      updateZenCssBrowser: {
        configurable: true,
        get: () => updateZenCssBrowser,
      },
      zenCssEnabled: { configurable: true, get: () => zenCssEnabled },
    });
    yield;
    function getAllAppBrowsers() {
      const panel = document.getElementById("zen-app-panel-slider");
      const list = panel ? Array.from(panel.querySelectorAll("browser")) : [];
      // Cheap existence check first: Triple/Super-View is rare, so skip the
      // document-wide query entirely unless that panel actually exists.
      const superPanel = document.getElementById("bgalazka-super-panel");
      if (superPanel) list.push(...superPanel.querySelectorAll("browser"));
      return list;
    }

    // Zen Internet 3.2.0 stores its downloaded styles and all feature switches
    // in storage.local. Read its own data and render only into Zentral browsers.
    // This bridge never changes the add-on, native tabs, or their selected state.
    // Compatibility reference: Zen Internet and its my-internet styles are MIT
    // licensed by Transparent Zen; no upstream CSS is packaged with this mod.
    const ZEN_CSS_EXTENSION_ID = "{91aa3897-2634-4a8a-9092-279db23a7689}";
    const ZEN_CSS_CHANNEL =
      "ZentralZenCSS:" + Math.random().toString(36).slice(2);
    const ZEN_CSS_STYLE_ID = "zentral-zen-internet-styles";
    const ZEN_CSS_FRAME_SOURCE = `(() => {
    const bridgeGlobal = this;
    const channel = "${ZEN_CSS_CHANNEL}";
    const styleId = "${ZEN_CSS_STYLE_ID}";
    const normalizedUrl = value => String(value || "").split("#")[0];
    const currentInnerWindowId = () => {
      try {
        return Number(content?.windowGlobalChild?.innerWindowId) || 0;
      } catch (_) {
        return 0;
      }
    };

    // A userChrome mod can be reloaded while panel browsers/content processes
    // survive. Never return just because an older Zentral bridge exists: that
    // older bridge may listen on a different random channel, making every new
    // parent message a no-op until a full page reload. Tear down the previous
    // bridge/state and install this instance instead.
    try { this.__zentralZenCSSBridge?.teardown?.(); } catch (_) {}
    // Clean legacy bridge hooks from builds that predate __zentralZenCSSBridge.
    // Their message channel was not recorded, so that old message listener can
    // only die with the frame-global; its DOM listeners *are* removable here.
    try {
      const oldApply = this.__zentralZenCSSApplyPending;
      if (typeof oldApply === "function") {
        removeEventListener("DOMContentLoaded", oldApply, true);
        removeEventListener("pageshow", oldApply, true);
      }
      this.__zentralZenCSSPending = null;
      this.__zentralZenCSSApplyPending = null;
      this.__zentralZenCSSListener = null;
    } catch (_) {}
    try {
      const oldState = this.__zentralZenCSSState;
      oldState?.headObserver?.disconnect();
      oldState?.nativeObserver?.disconnect();
      oldState?.style?.remove?.();
    } catch (_) {}
    this.__zentralZenCSSState = null;

    let state = null;
    const clearState = () => {
      try {
        state?.headObserver?.disconnect();
        state?.nativeObserver?.disconnect();
        state?.style?.remove?.();
      } catch (_) {}
      state = null;
      this.__zentralZenCSSState = null;
    };

    const ensureState = doc => {
      if (state?.doc === doc) return state;
      clearState();
      state = { doc, css: "", native: null, style: null, head: null };
      this.__zentralZenCSSState = state;

      const updateNative = () => {
        const native = doc.getElementById("zeninternet-styles");
        if (native === state.native) return false;
        state.nativeObserver?.disconnect();
        state.native = native;
        if (native) {
          state.nativeObserver = new doc.defaultView.MutationObserver(sync);
          state.nativeObserver.observe(native, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        }
        return true;
      };

      const watchHead = () => {
        const head = doc.head || doc.documentElement;
        if (head === state.head) return false;
        state.headObserver?.disconnect();
        state.head = head;
        if (!head) return true;
        state.headObserver = new doc.defaultView.MutationObserver(mutations => {
          const nativeChanged = updateNative();
          if (nativeChanged || (state.css && state.style && !state.style.isConnected))
            sync();
          if (!state.style?.textContent) return;
          const addedCss = mutations.some(({ addedNodes }) =>
            Array.from(addedNodes).some(node => node !== state.style &&
              node !== state.native && node.nodeType === 1 &&
              (node.localName === "style" ||
               (node.localName === "link" && /stylesheet/i.test(node.rel)))));
          if (addedCss && state.head?.lastChild !== state.style)
            state.head?.appendChild(state.style);
        });
        state.headObserver.observe(head, { childList: true });
        return true;
      };

      const sync = () => {
        if (!state || state.doc !== doc) return;
        watchHead();
        updateNative();
        let style = state.style || doc.getElementById(styleId);
        if (!style && state.css) {
          style = doc.createElement("style");
          style.id = styleId;
        }
        state.style = style;
        if (!style) return;
        const nativeCss = state.native?.textContent || "";
        const expected = String(state.css || "").trim();
        const desired = expected && !nativeCss.includes(expected) ? state.css : "";
        if (style.textContent !== desired) style.textContent = desired;
        if (desired && style.parentNode !== state.head)
          state.head?.appendChild(style);
      };
      state.sync = sync;
      watchHead();
      return state;
    };

    const announce = reason => {
      try {
        const doc = content.document;
        const url = doc?.URL || "";
        const windowId = currentInnerWindowId();
        if (!/^https?:/i.test(url) || !windowId) return;
        sendAsyncMessage(channel + ":ready", { url, windowId, reason });
      } catch (_) {}
    };

    const onApply = message => {
      try {
        const data = message.data || {};
        const doc = content.document;
        const windowId = currentInnerWindowId();
        if (!doc || !windowId || Number(data.windowId) !== windowId) return;
        if (normalizedUrl(doc.URL) !== normalizedUrl(data.url)) return;
        if (data.reset) clearState();
        const current = ensureState(doc);
        current.css = typeof data.css === "string" ? data.css : "";
        current.sync();
        const expected = current.css.trim();
        const nativeCss = current.native?.textContent || "";
        const injectedCss = current.style?.textContent || "";
        const applied =
          !expected ||
          nativeCss.includes(expected) ||
          (!!current.style?.isConnected && injectedCss.includes(expected));
        sendAsyncMessage(channel + ":ack", {
          url: data.url,
          sequence: data.sequence,
          windowId,
          applied,
          expectedLength: expected.length,
          injectedLength: injectedCss.length,
          nativeLength: nativeCss.length,
          documentURL: doc.URL,
        });
      } catch (_) {}
    };

    const onProbe = message => {
      const data = message.data || {};
      if (data.clear) {
        clearState();
        return;
      }
      if (data.reset) clearState();
      announce(data.reset ? "repair" : "probe");
    };
    const onDocument = () => announce("document");

    addMessageListener(channel + ":apply", onApply);
    addMessageListener(channel + ":probe", onProbe);
    addEventListener("DOMContentLoaded", onDocument, true);
    addEventListener("pageshow", onDocument, true);

    const bridge = {
      channel,
      teardown() {
        try { removeMessageListener(channel + ":apply", onApply); } catch (_) {}
        try { removeMessageListener(channel + ":probe", onProbe); } catch (_) {}
        try { removeEventListener("DOMContentLoaded", onDocument, true); } catch (_) {}
        try { removeEventListener("pageshow", onDocument, true); } catch (_) {}
        clearState();
        if (bridgeGlobal.__zentralZenCSSBridge === bridge)
          bridgeGlobal.__zentralZenCSSBridge = null;
      },
    };
    this.__zentralZenCSSChannel = channel;
    this.__zentralZenCSSBridge = bridge;
    announce("install");
  })();`;
    const ZEN_CSS_FRAME_URI =
      "data:application/javascript;charset=utf-8," +
      encodeURIComponent(ZEN_CSS_FRAME_SOURCE);
    const zenCssBrowsers = new WeakMap();
    const zenCssUpdateVersions = new WeakMap();
    const zenCssFirstLoads = new WeakMap();
    let zenCssSource = null;
    let zenCssSourcePromise = null;
    let zenCssStorage = null;
    let zenCssExtension = null;
    let zenCssBackend = null;
    let zenCssChangeTimer = null;
    const ZEN_CSS_KEYS = [
      "styles",
      "transparentZenSettings",
      "skipThemingList",
      "skipForceThemingList",
      "fallbackBackgroundList",
      "stylesMapping",
      "userStylesMapping",
    ];

    function zenCssEnabled() {
      return ctx.getPref(ctx.BGALAZKA_EXT_PREFS.ZEN_INTERNET_PANEL_CSS, false);
    }

    function zenCssStorageChanged(changes) {
      if (
        !Object.keys(changes || {}).some(
          (key) =>
            ZEN_CSS_KEYS.includes(key) ||
            key.startsWith("transparentZenSettings."),
        )
      )
        return;
      zenCssSource = null;
      if (zenCssChangeTimer) ctx.clearTimeout(zenCssChangeTimer);
      zenCssChangeTimer = ctx.setTimeout(() => {
        zenCssChangeTimer = null;
        refreshZenInternetPanelCss();
      }, 150);
    }

    async function getZenCssStorage() {
      if (!zenCssEnabled()) return null;
      const { ExtensionParent } = ChromeUtils.importESModule(
        "resource://gre/modules/ExtensionParent.sys.mjs",
      );
      const extension =
        ExtensionParent.GlobalManager.getExtension(ZEN_CSS_EXTENSION_ID);
      if (!extension?.policy?.active || !extension.hasPermission("storage"))
        return null;
      if (zenCssStorage && zenCssExtension === extension) return zenCssStorage;
      if (zenCssBackend) {
        zenCssBackend.removeOnChangedListener(
          ZEN_CSS_EXTENSION_ID,
          zenCssStorageChanged,
        );
        zenCssBackend = null;
      }
      const { ExtensionStorageIDB } = ChromeUtils.importESModule(
        "resource://gre/modules/ExtensionStorageIDB.sys.mjs",
      );
      const selected = await ExtensionStorageIDB.selectBackend({ extension });
      if (!zenCssEnabled()) return null;
      let storage;
      if (selected.backendEnabled) {
        const db = await ExtensionStorageIDB.open(
          ExtensionStorageIDB.getStoragePrincipal(extension),
          extension.hasPermission("unlimitedStorage"),
        );
        if (!zenCssEnabled()) return null;
        storage = { get: (keys) => db.get(keys) };
        zenCssBackend = ExtensionStorageIDB;
      } else {
        const { ExtensionStorage } = ChromeUtils.importESModule(
          "resource://gre/modules/ExtensionStorage.sys.mjs",
        );
        storage = {
          get: (keys) => ExtensionStorage.get(ZEN_CSS_EXTENSION_ID, keys),
        };
        zenCssBackend = ExtensionStorage;
      }
      zenCssBackend.addOnChangedListener(
        ZEN_CSS_EXTENSION_ID,
        zenCssStorageChanged,
      );
      zenCssExtension = extension;
      zenCssStorage = storage;
      zenCssSource = null;
      return storage;
    }

    async function readZenCssSource() {
      if (
        zenCssSource &&
        Date.now() - zenCssSource.readAt <
          (zenCssSource.styles?.website ? 30000 : 1000)
      )
        return zenCssSource;
      if (zenCssSourcePromise) return zenCssSourcePromise;
      zenCssSourcePromise = (async () => {
        const storage = await getZenCssStorage();
        if (!storage) return null;
        const values = await storage.get(ZEN_CSS_KEYS);
        zenCssSource = { ...values, readAt: Date.now() };
        return zenCssSource;
      })();
      try {
        return await zenCssSourcePromise;
      } finally {
        zenCssSourcePromise = null;
      }
    }

    function matchZenCssFeatures(host, source) {
      const website = source?.styles?.website;
      if (!website || typeof website !== "object") return null;
      let bestKey = null;
      let bestLength = -1;
      for (const key of Object.keys(website)) {
        const site = key.replace(/\.css$/, "");
        const base = site.replace(/^www\./, "");
        let length = -1;
        if (host === base) length = 100000 + base.length;
        else if (site.startsWith("+")) {
          const domain = site.slice(1);
          if (host === domain || host.endsWith(`.${domain}`))
            length = domain.length;
        } else if (site.startsWith("-")) {
          const domain = site.slice(1).split(".").slice(0, -1).join(".");
          if (domain && host.split(".").slice(0, -1).join(".") === domain)
            length = domain.length;
        } else if (host.endsWith(`.${base}`)) length = base.length;
        if (length > bestLength) {
          bestLength = length;
          bestKey = key;
        }
      }
      if (bestKey) return website[bestKey];
      const mapping = { ...(source.stylesMapping?.mapping || {}) };
      for (const [key, targets] of Object.entries(
        source.userStylesMapping?.mapping || {},
      ))
        mapping[key] = [
          ...(Array.isArray(mapping[key]) ? mapping[key] : []),
          ...(Array.isArray(targets) ? targets : []),
        ];
      for (const [key, targets] of Object.entries(mapping)) {
        if (Array.isArray(targets) && targets.includes(host))
          return website[key] || website[`${key}.css`] || null;
      }
      return null;
    }

    async function buildZenCss(host, source) {
      const settings = source?.transparentZenSettings || {};
      if (settings.enableStyling === false) return "";
      const fallback = (source.fallbackBackgroundList || []).includes(host);
      let features = matchZenCssFeatures(host, source);
      const hasStyle = !!features;
      const skipped = (source.skipThemingList || []).includes(host);
      if (hasStyle && !fallback && !!settings.whitelistStyleMode !== skipped)
        features = null;
      if (!hasStyle && !fallback && settings.forceStyling) {
        const forceListed = (source.skipForceThemingList || []).includes(host);
        if (!!settings.whitelistMode === forceListed)
          features = source.styles?.website?.["example.com.css"] || null;
      }
      if (!features && !fallback) return "";
      const storage = await getZenCssStorage();
      const siteKey = `transparentZenSettings.${host}`;
      const siteSettings = (await storage?.get(siteKey))?.[siteKey] || {};
      let css = "";
      for (const [feature, value] of Object.entries(features || {})) {
        if (typeof value !== "string" || siteSettings[feature] === false)
          continue;
        // A locally stored CSS rule can still request remote images or fonts.
        // Keep this bridge fully offline by omitting resource-bearing features.
        if (/@import\b|url\s*\(|(?:-webkit-)?image-set\s*\(/i.test(value))
          continue;
        const name = feature.toLowerCase();
        if (
          name.includes("transparency") &&
          (settings.disableTransparency || fallback)
        )
          continue;
        if (name.includes("hover") && settings.disableHover) continue;
        if (name.includes("footer") && settings.disableFooter) continue;
        if (
          (name.includes("darkreader") ||
            value.toLowerCase().includes("darkreader")) &&
          settings.disableDarkReader
        )
          continue;
        if (
          host === "youtube.com" &&
          name.includes("transparent overlay chat") &&
          siteSettings.movableLiveChat !== false
        )
          continue;
        css += value + "\n";
      }
      if (fallback) css += "html{background-color:light-dark(#fff,#111);}";
      return css;
    }

    function currentZenCssInnerWindowId(browser) {
      try {
        return (
          Number(
            browser?.browsingContext?.currentWindowGlobal?.innerWindowId,
          ) || 0
        );
      } catch (_) {
        return 0;
      }
    }

    function cleanZenCssUrl(value) {
      return String(value || "").split("#")[0];
    }

    function disposeZenCssRecord(browser, { clearContent = false } = {}) {
      const record = zenCssBrowsers.get(browser);
      if (!record) return;
      ctx.cancelPanelRetry(record);
      if (clearContent) {
        try {
          record.manager.sendAsyncMessage(`${ZEN_CSS_CHANNEL}:probe`, {
            clear: true,
          });
        } catch (_) {}
      }
      try {
        record.manager.removeMessageListener(
          `${ZEN_CSS_CHANNEL}:ready`,
          record.onReady,
        );
      } catch (_) {}
      try {
        record.manager.removeMessageListener(
          `${ZEN_CSS_CHANNEL}:ack`,
          record.onAck,
        );
      } catch (_) {}
      try {
        record.manager.removeDelayedFrameScript(ZEN_CSS_FRAME_URI);
      } catch (_) {}
      zenCssBrowsers.delete(browser);
    }

    function ensureZenCssBridge(browser, { replace = false } = {}) {
      if (!browser?.isConnected) return null;
      let manager;
      try {
        manager = browser.messageManager;
      } catch (_) {
        return null;
      }
      if (!manager?.loadFrameScript || !manager?.sendAsyncMessage) return null;

      let record = zenCssBrowsers.get(browser);
      if (record && (replace || record.manager !== manager)) {
        disposeZenCssRecord(browser, { clearContent: replace });
        record = null;
      }
      if (record) return record;

      record = {
        manager,
        sequence: 0,
        acknowledged: false,
        ackWindowId: 0,
        expectedCssLength: 0,
        applied: false,
        url: "",
      };

      record.onReady = (message) => {
        if (zenCssBrowsers.get(browser) !== record || !browser.isConnected)
          return;
        const windowId = Number(message.data?.windowId) || 0;
        const url = String(message.data?.url || "");
        if (!windowId || !/^https?:/i.test(url)) return;
        if (currentZenCssInnerWindowId(browser) !== windowId) return;
        // The document tells us when it exists. This is the authoritative
        // trigger; we no longer guess with 600/1800ms first-load timers.
        updateZenCssBrowser(browser, {
          targetUrl: url,
          targetWindowId: windowId,
        });
      };

      record.onAck = (message) => {
        if (
          zenCssBrowsers.get(browser) !== record ||
          message.data?.sequence !== record.sequence ||
          cleanZenCssUrl(message.data?.url) !== cleanZenCssUrl(record.url)
        )
          return;
        const liveWindowId = currentZenCssInnerWindowId(browser);
        const ackWindowId = Number(message.data?.windowId) || 0;
        if (!liveWindowId || !ackWindowId || liveWindowId !== ackWindowId)
          return;
        if (message.data?.applied !== true) return;
        const expectedLength = Number(message.data?.expectedLength) || 0;
        if (expectedLength !== record.expectedCssLength) return;
        record.ackWindowId = ackWindowId;
        record.applied = true;
        record.acknowledged = true;
        ctx.cancelPanelRetry(record);
      };

      manager.addMessageListener(`${ZEN_CSS_CHANNEL}:ready`, record.onReady);
      manager.addMessageListener(`${ZEN_CSS_CHANNEL}:ack`, record.onAck);
      zenCssBrowsers.set(browser, record);
      try {
        // The frame script replaces any older Zentral bridge living in this
        // content process, even one from a previous hot-reloaded mod instance.
        manager.loadFrameScript(ZEN_CSS_FRAME_URI, true, true);
      } catch (error) {
        disposeZenCssRecord(browser);
        console.warn(
          "[BgalazkaExtension] Could not install Zen Internet CSS bridge:",
          error,
        );
        return null;
      }
      return record;
    }

    function sendZenCss(
      browser,
      css,
      url,
      { reset = false, targetWindowId = 0 } = {},
    ) {
      if (!browser?.isConnected || !/^https?:/i.test(url)) return;
      const windowId = targetWindowId || currentZenCssInnerWindowId(browser);
      if (!windowId) return;
      const record = ensureZenCssBridge(browser);
      if (!record) return;
      const sequence = ++record.sequence;
      record.url = url;
      record.acknowledged = false;
      record.ackWindowId = 0;
      record.applied = false;
      record.expectedCssLength = String(css || "").trim().length;
      ctx.cancelPanelRetry(record);

      const payload = { css, url, sequence, reset, windowId };
      ctx.retryPanelTask(record, () => {
        if (
          !browser.isConnected ||
          zenCssBrowsers.get(browser) !== record ||
          record.sequence !== sequence ||
          record.acknowledged ||
          currentZenCssInnerWindowId(browser) !== windowId
        )
          return true;
        try {
          record.manager.sendAsyncMessage(`${ZEN_CSS_CHANNEL}:apply`, payload);
        } catch (_) {
          return true;
        }
        return false;
      });
    }

    async function updateZenCssBrowser(
      browser,
      { reset = false, targetUrl = null, targetWindowId = 0 } = {},
    ) {
      if (!browser?.isConnected) return;
      const windowId = targetWindowId || currentZenCssInnerWindowId(browser);
      if (!windowId) {
        ensureZenCssBridge(browser);
        return;
      }
      const url = targetUrl || browser.currentURI?.spec || "";
      if (!/^https?:/i.test(url)) return;
      const version = (zenCssUpdateVersions.get(browser) || 0) + 1;
      zenCssUpdateVersions.set(browser, version);
      if (!zenCssEnabled()) {
        sendZenCss(browser, "", url, { reset, targetWindowId: windowId });
        return;
      }
      try {
        const source = await readZenCssSource();
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
        const css = source ? await buildZenCss(host, source) : "";
        if (
          browser.isConnected &&
          currentZenCssInnerWindowId(browser) === windowId &&
          zenCssUpdateVersions.get(browser) === version &&
          zenCssEnabled()
        )
          sendZenCss(browser, css, url, {
            reset,
            targetWindowId: windowId,
          });
      } catch (error) {
        console.warn(
          "[BgalazkaExtension] Zen Internet CSS read failed:",
          error,
        );
      }
    }

    function zenCssBrowserHealthy(browser) {
      if (!browser?.isConnected) return true;
      const windowId = currentZenCssInnerWindowId(browser);
      if (!windowId) return false;
      const record = zenCssBrowsers.get(browser);
      return !!(
        record &&
        record.manager === browser.messageManager &&
        record.acknowledged &&
        record.applied &&
        record.ackWindowId === windowId
      );
    }

    function requestZenCssDocument(browser, { reset = false } = {}) {
      if (!browser?.isConnected || !zenCssEnabled()) return;
      const record = ensureZenCssBridge(browser, { replace: reset });
      if (!record) return;
      const sendProbe = () => {
        if (!browser.isConnected || zenCssBrowsers.get(browser) !== record)
          return;
        try {
          record.manager.sendAsyncMessage(`${ZEN_CSS_CHANNEL}:probe`, {
            reset,
          });
        } catch (_) {}
      };
      // loadFrameScript announces on install. Probe once after it has had a
      // chance to register, covering content-process scheduling differences.
      if (!reset) sendProbe();
      else ctx.setTimeout(sendProbe, 40);
    }

    function repairZenInternetPanelCss(
      browsers = getAllAppBrowsers(),
      force = false,
    ) {
      if (!zenCssEnabled()) return;
      if (force) zenCssSource = null;
      for (const browser of browsers) {
        if (!browser?.isConnected) continue;
        attachZenInternetPanelBrowser(browser);
        if (force || !zenCssBrowserHealthy(browser))
          requestZenCssDocument(browser, { reset: force });
      }
    }

    function repairVisiblePanelPresentation(forceZenCss = false) {
      const visible = getAllAppBrowsers().filter(
        (browser) => browser?.isConnected && browser.style.display !== "none",
      );
      if (!visible.length) return;
      ctx.syncAppPanelBrowserActivity(visible);
      if (forceZenCss) {
        // Treat the button as an explicit FrameLoader/remoteness recovery, not
        // merely a CSS resend. Reinstall every visible browser's bridge on the
        // message manager that exists RIGHT NOW.
        zenCssSource = null;
        for (const browser of visible) {
          attachZenInternetPanelBrowser(browser);
          requestZenCssDocument(browser, { reset: true });
        }
      }
      requestAnimationFrame(() => ctx.syncAppPanelBrowserActivity(visible));
      ctx.setTimeout(() => {
        const stillVisible = visible.filter(
          (browser) => browser?.isConnected && browser.style.display !== "none",
        );
        ctx.syncAppPanelBrowserActivity(stillVisible);
        if (forceZenCss) {
          // If a remoteness swap landed just after the click, the event handler
          // above normally reinstalls the bridge. This one verification pass
          // only handles a transition that raced the button itself.
          for (const browser of stillVisible)
            if (!zenCssBrowserHealthy(browser))
              requestZenCssDocument(browser, { reset: true });
        }
      }, 180);
    }

    // Kept as compatibility wrappers because navigation hooks elsewhere in this
    // extension already call these names. They are now event-driven probes, not
    // multi-second retry schedulers.
    function cancelZenCssFirstLoad(browser) {
      const pending = zenCssFirstLoads.get(browser);
      if (!pending) return;
      for (const timer of pending.timers || []) ctx.clearTimeout(timer);
      zenCssFirstLoads.delete(browser);
    }

    function scheduleZenCssFirstLoad(browser) {
      if (!zenCssEnabled() || !browser?.isConnected) return;
      attachZenInternetPanelBrowser(browser);
      requestZenCssDocument(browser);
    }

    function detachZenInternetPanelBrowser(
      browser,
      { clearContent = false } = {},
    ) {
      if (!browser) return;
      cancelZenCssFirstLoad(browser);
      const onRemoteness = browser._bgalazkaZenCssRemotenessHandler;
      if (onRemoteness) {
        try {
          browser.removeEventListener(
            "DidChangeBrowserRemoteness",
            onRemoteness,
          );
        } catch (_) {}
        delete browser._bgalazkaZenCssRemotenessHandler;
      }
      disposeZenCssRecord(browser, { clearContent });
      delete browser._bgalazkaZenCssOnLoad;
    }

    function attachZenInternetPanelBrowser(browser) {
      if (!browser?.isConnected) return;
      if (!browser._bgalazkaZenCssRemotenessHandler) {
        // Firefox can keep the same <browser> element while replacing its
        // FrameLoader/message-manager endpoint. Delayed frame scripts are not a
        // reliable substitute for explicitly reinstalling our bridge after that
        // remoteness transition. Mozilla's own ContentPage helper does the same.
        const onRemoteness = () => {
          if (!browser.isConnected || !zenCssEnabled()) return;
          // Invalidate any async CSS build that targeted the old WindowGlobal.
          zenCssUpdateVersions.set(
            browser,
            (zenCssUpdateVersions.get(browser) || 0) + 1,
          );
          // Rebuild against the browser's NEW message manager/frame loader.
          // reset=true also clears any stale content-side observer/style state.
          requestZenCssDocument(browser, { reset: true });
        };
        browser._bgalazkaZenCssRemotenessHandler = onRemoteness;
        browser.addEventListener("DidChangeBrowserRemoteness", onRemoteness);
      }
      browser._bgalazkaZenCssOnLoad = true;
      ensureZenCssBridge(browser);
    }

    function refreshZenInternetPanelCss() {
      for (const browser of getAllAppBrowsers()) {
        if (!browser?.isConnected) continue;
        if (!zenCssEnabled()) {
          const record = zenCssBrowsers.get(browser);
          if (record) {
            try {
              record.manager.sendAsyncMessage(`${ZEN_CSS_CHANNEL}:probe`, {
                clear: true,
              });
            } catch (_) {}
          }
          continue;
        }
        attachZenInternetPanelBrowser(browser);
        const windowId = currentZenCssInnerWindowId(browser);
        if (windowId)
          updateZenCssBrowser(browser, {
            targetUrl: browser.currentURI?.spec || "",
            targetWindowId: windowId,
          });
        else requestZenCssDocument(browser);
      }
    }

    function setZenInternetPanelCssEnabled(enabled) {
      if (enabled) {
        zenCssSource = null;
        refreshZenInternetPanelCss();
        return;
      }
      for (const browser of getAllAppBrowsers()) {
        cancelZenCssFirstLoad(browser);
        const record = zenCssBrowsers.get(browser);
        if (record) {
          try {
            record.manager.sendAsyncMessage(`${ZEN_CSS_CHANNEL}:probe`, {
              clear: true,
            });
          } catch (_) {}
        }
        detachZenInternetPanelBrowser(browser);
      }
      if (zenCssChangeTimer) {
        ctx.clearTimeout(zenCssChangeTimer);
        zenCssChangeTimer = null;
      }
      if (zenCssBackend) {
        zenCssBackend.removeOnChangedListener(
          ZEN_CSS_EXTENSION_ID,
          zenCssStorageChanged,
        );
        zenCssBackend = null;
      }
      zenCssStorage = null;
      zenCssExtension = null;
      zenCssSource = null;
    }

    ctx.registerCleanup(() => {
      if (zenCssChangeTimer) ctx.clearTimeout(zenCssChangeTimer);
      for (const browser of getAllAppBrowsers()) {
        cancelZenCssFirstLoad(browser);
        detachZenInternetPanelBrowser(browser, { clearContent: true });
      }
      if (zenCssBackend)
        zenCssBackend.removeOnChangedListener(
          ZEN_CSS_EXTENSION_ID,
          zenCssStorageChanged,
        );
    });
    if (zenCssEnabled()) ctx.setTimeout(refreshZenInternetPanelCss, 500);
  });
})();
