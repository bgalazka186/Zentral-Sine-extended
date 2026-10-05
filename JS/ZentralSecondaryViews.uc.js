(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime;
  // Feature: secondary-views. Imports and exposed are listed in ARCHITECTURE.md.
  // Preparation publishes functions; activation preserves the baseline initialization order.
  ZentralRuntime.registerPart("secondary-views", function* (ctx) {
    Object.defineProperties(ctx, {});
    yield;
    (() => {
      const apps = window.Zentral?.Apps;
      if (!apps) return;
      const ui = document.documentElement;
      const state = {
        mode: null,
        first: null,
        second: null,
        shell: null,
        divider: null,
        previousPin: null,
        pollUpdate: null,
        secondToolbarCleanup: null,
        resizeCleanup: null,
        geometryObserver: null,
        share: 0.5,
        dividerHandle: null,
        handleFrame: null,
        pair: null,
        secondURL: null,
      };
      const slider = () => document.getElementById("zen-app-panel-slider");
      const root = () => document.getElementById("zen-app-panel-root");
      const isOpen = () =>
        root()?.hasAttribute("open") && !root()?.hasAttribute("closing");
      const active = () => {
        const browsers = [...(slider()?.querySelectorAll("browser") || [])];
        const activeIds = [
          ...document.querySelectorAll(
            ".zen-app-tile[data-app-id][data-active='true']",
          ),
        ].map((tile) => tile.dataset.appId);
        const selected = browsers.find(
          (browser) =>
            activeIds.includes(browser._bgalazkaAppId) &&
            browser.style.display !== "none" &&
            !browser.hasAttribute("hidden"),
        );
        return (
          selected ||
          browsers
            .reverse()
            .find(
              (browser) =>
                browser.style.display !== "none" &&
                !browser.hasAttribute("hidden"),
            )
        );
      };
      const origOpen = apps.openPanel;
      const origClose = apps.closePanel;
      const origCloseApp = apps.closeApp;
      const origRemoveApp = apps.removeApp;
      const origRender = apps.renderGrid;
      function savedNormalApps() {
        try {
          const list = JSON.parse(
            ctx.getPref("zen.workspace.apps.sidebar.apps", "[]"),
          );
          return Array.isArray(list) ? list : [];
        } catch (_) {
          return [];
        }
      }
      function resolvePairApp(pair, id) {
        const tabRecord = ctx.essentialPanels.get(id);
        if (tabRecord?.tab.isConnected) return tabRecord.app;
        const normal = savedNormalApps().find((app) => app.id === id);
        if (normal) return normal;
        // A tab may have closed while this window was shut down. Create its
        // dedicated launcher from the saved metadata without creating a browser.
        const snapshot = pair.apps[id];
        if (!id.startsWith("bgalazka-essential-") || !snapshot?.url)
          return null;
        const app = { ...snapshot, id, workspaceId: "all" };
        Services.prefs.setStringPref(
          "zen.workspace.apps.sidebar.apps",
          JSON.stringify([...savedNormalApps(), app]),
        );
        apps.loadApps();
        apps.renderGrid();
        return app;
      }
      function rememberPair() {
        const pair = state.pair;
        if (!pair) return;
        pair.share = Math.max(0.05, Math.min(0.95, state.share));
        for (const browser of [state.first, state.second]) {
          const id = browser?._bgalazkaAppId;
          if (!id || !pair.apps[id]) continue;
          const url = browser.currentURI?.spec;
          if (url && url !== "about:blank" && /^(https?|about):/i.test(url))
            pair.apps[id].url = url;
        }
        ctx.saveLinkedTriplePairs();
      }
      function linkCurrentPair(firstApp, secondApp) {
        const top = firstApp?.id;
        const bottom = secondApp?.id;
        if (!top || !bottom || top === bottom) return;
        const same = ctx.linkedPairFor(top);
        if (same && same === ctx.linkedPairFor(bottom)) {
          state.pair = same;
          return;
        }
        ctx.unlinkTriplePair(top);
        ctx.unlinkTriplePair(bottom);
        const pair = {
          top,
          bottom,
          share: state.share,
          apps: {
            [top]: { ...firstApp, id: top },
            [bottom]: { ...secondApp, id: bottom },
          },
        };
        ctx.linkedTriplePairs.push(pair);
        state.pair = pair;
        ctx.saveLinkedTriplePairs();
      }
      function enterTriple(first) {
        state.first = first;
        state.mode = "triple";
        const btn = document.getElementById("zen-app-dual-view-btn");
        btn?.setAttribute("data-hold-active", "true");
        ui.setAttribute("bgalazka-triple-view", "true");
        ctx.syncPanelPushState();
        refreshViewZenCss(first);
      }
      function refreshViewZenCss(browser) {
        if (!ctx.zenCssEnabled() || !browser?.isConnected) return;
        ctx.attachZenInternetPanelBrowser(browser);
        ctx.updateZenCssBrowser(browser);
      }
      function showPair(pair) {
        const top = resolvePairApp(pair, pair.top);
        const bottom = resolvePairApp(pair, pair.bottom);
        if (!top || !bottom) return false;
        if (state.mode) leaveMode();
        origOpen.call(apps, top);
        const first = active();
        if (!first) return false;
        state.share = Number.isFinite(pair.share) ? pair.share : 0.5;
        enterTriple(first);
        repairSuperPinReturn(first);
        if (!openSecond(bottom, false)) {
          leaveMode();
          return false;
        }
        state.pair = pair;
        return true;
      }
      function swapPair() {
        const pair = state.pair;
        if (!pair || state.mode !== "triple" || !state.second) return;
        rememberPair();
        [pair.top, pair.bottom] = [pair.bottom, pair.top];
        ctx.saveLinkedTriplePairs();
        showPair(pair);
      }
      const markTiles = () =>
        document
          .querySelectorAll(".zen-app-tile[data-app-id]")
          .forEach((tile) => {
            if (
              state.mode &&
              tile.dataset.appId === state.first?._bgalazkaAppId
            )
              tile.dataset.active = "true";
            if (
              state.second &&
              tile.dataset.appId === state.second._bgalazkaAppId
            )
              tile.dataset.active = "true";
          });
      function fitSecondaryBrowsers() {
        // Keep the live XUL <browser> elements under layout control. Writing
        // width/height attributes or absolute inline sizes can recreate or
        // freeze their remote viewports when a second panel appears.
        if (
          state.mode !== "triple" ||
          !state.second?.isConnected ||
          !state.divider?.isConnected
        )
          return;
        const panel = slider();
        const rect = panel?.getBoundingClientRect();
        if (!rect) return;
        const toolbar = document.getElementById("zen-app-panel-toolbar");
        const usable =
          rect.height -
          (toolbar?.offsetHeight || 0) -
          state.shell.offsetHeight -
          state.divider.offsetHeight -
          panel.clientTop * 2;
        if (usable <= 0) return;
        const min = Math.min(160, usable * 0.25);
        const top = Math.max(min, Math.min(usable - min, usable * state.share));
        const topValue = `${Math.round(top)}px`,
          bottomValue = `${Math.round(usable - top)}px`;
        if (panel.style.getPropertyValue("--bgalazka-top-share") !== topValue)
          panel.style.setProperty("--bgalazka-top-share", topValue);
        if (
          panel.style.getPropertyValue("--bgalazka-bottom-share") !==
          bottomValue
        )
          panel.style.setProperty("--bgalazka-bottom-share", bottomValue);
        if (state.handleFrame) cancelAnimationFrame(state.handleFrame);
        state.handleFrame = requestAnimationFrame(() => {
          state.handleFrame = null;
          if (!state.dividerHandle?.isConnected || !state.divider?.isConnected)
            return;
          const line = state.divider.getBoundingClientRect();
          state.dividerHandle.style.left = `${line.left}px`;
          state.dividerHandle.style.top = `${line.top - 3}px`;
          state.dividerHandle.style.width = `${line.width}px`;
          state.dividerHandle.style.height = `${line.height + 6}px`;
        });
      }
      function discardSecond() {
        state.geometryObserver?.disconnect();
        state.geometryObserver = null;
        if (state.handleFrame) cancelAnimationFrame(state.handleFrame);
        state.handleFrame = null;
        state.dividerHandle?.remove();
        state.dividerHandle = null;
        state.resizeCleanup?.();
        state.resizeCleanup = null;
        state.secondToolbarCleanup?.();
        state.secondToolbarCleanup = null;
        state.pollUpdate = null;
        const second = state.second;
        if (second) ctx.cancelPanelRetry(second);
        if (state.mode === "super" && second) {
          // Reparenting a live remote browser can reset its document without
          // removing the element from Zentral's private app-browser Map.
          const liveURL = second.currentURI?.spec;
          const lastURL =
            liveURL && liveURL !== "about:blank" ? liveURL : state.secondURL;
          if (lastURL && lastURL !== "about:blank")
            second._bgalazkaSuperPinReturnURL = lastURL;
        }
        if (second?.isConnected && slider()) {
          if (second.parentNode !== slider()) slider().appendChild(second);
          second.style.display = "none";
        }
        if (second?._bgalazkaAppId)
          document
            .querySelectorAll(".zen-app-tile[data-app-id]")
            .forEach((tile) => {
              if (tile.dataset.appId === second._bgalazkaAppId)
                tile.dataset.active = "false";
            });
        state.second = null;
        state.secondURL = null;
        state.divider?.remove();
        state.divider = null;
        ui.removeAttribute("bgalazka-triple-populated");
        // Do not wait for the toolbar's SPA fallback poll to hide the repair
        // control when Triple View loses its second panel.
        ctx.updateWebToolbarState();
        state.shell?.remove();
        state.shell = null;
        slider()?.style.removeProperty("--bgalazka-top-share");
        slider()?.style.removeProperty("--bgalazka-bottom-share");
        state.first?.removeAttribute("data-bgalazka-triple-slot");
        second?.removeAttribute("data-bgalazka-triple-slot");
        ctx.syncAppPanelBrowserActivity();
      }
      function leaveMode() {
        if (!state.mode) return;
        const mode = state.mode;
        if (mode === "triple") rememberPair();
        discardSecond();
        state.mode = null;
        state.first = null;
        state.pair = null;
        ui.removeAttribute("bgalazka-triple-view");
        ui.removeAttribute("bgalazka-super-pin");
        document
          .getElementById("zen-app-dual-view-btn")
          ?.removeAttribute("data-hold-active");
        document
          .querySelector("#zen-app-panel-pill .zen-app-btn[data-pinned]")
          ?.removeAttribute("data-hold-active");
        if (mode === "triple") ctx.syncPanelPushState();
        if (mode === "super" && state.previousPin === false && isOpen()) {
          const pin = document.querySelector(
            "#zen-app-panel-pill .zen-app-btn[data-pinned]",
          );
          if (pin?.getAttribute("data-pinned") === "true") apps.togglePin();
        }
        state.previousPin = null;
      }
      function leaveAndUnlinkTriple() {
        if (state.mode === "triple" && state.pair) {
          ctx.unlinkTriplePair(state.pair.top);
          state.pair = null;
        }
        leaveMode();
      }
      function navigate(browser, value) {
        try {
          const target = ctx.looksLikeUrl(value)
            ? /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
              ? value
              : "https://" + value
            : ctx.buildSearchUrl(value);
          const uri = Services.io.newURI(target);
          const options = {
            triggeringPrincipal:
              Services.scriptSecurityManager.createContentPrincipal(uri, {
                userContextId:
                  Number(browser.getAttribute("usercontextid")) || 0,
              }),
          };
          if (typeof browser.fixupAndLoadURIString === "function")
            browser.fixupAndLoadURIString(target, options);
          else browser.loadURI(uri, options);
        } catch (error) {
          console.warn(
            "[BgalazkaExtension] Secondary navigation failed",
            error,
          );
        }
      }
      function repairSuperPinReturn(browser) {
        const url = browser?._bgalazkaSuperPinReturnURL;
        if (!url) return;
        ctx.retryPanelTask(browser, () => {
          if (
            !browser.isConnected ||
            browser._bgalazkaSuperPinReturnURL !== url ||
            !isOpen() ||
            ui.hasAttribute("bgalazka-hover-panel-hidden") ||
            browser.style.display === "none"
          )
            return true;
          const current = browser.currentURI?.spec;
          if (current && current !== "about:blank") {
            delete browser._bgalazkaSuperPinReturnURL;
            return true;
          }
          if (!browser.webProgress?.isLoadingDocument) navigate(browser, url);
          return false;
        });
      }
      function makeShell(browser, app) {
        // SuperPin needs a native XUL container for its remote browser to
        // receive resize and input events. Triple-View only uses the bar.
        const box =
          state.mode === "super"
            ? document.createXULElement("vbox")
            : document.createElement("div");
        box.id = "bgalazka-super-panel";
        const bar = document.createElement("div");
        bar.className = "bgalazka-super-bar";
        const button = (label, title, action) => {
          const el = document.createElement("button");
          el.type = "button";
          el.textContent = label;
          el.title = title;
          el.setAttribute("aria-label", title);
          el.addEventListener("click", (event) => {
            event.stopPropagation();
            action();
          });
          bar.appendChild(el);
          return el;
        };
        const iconButton = (icon, title, action) => {
          const el = button("", title, action);
          el.appendChild(ctx.parseSVG(icon));
          return el;
        };
        iconButton(ctx.PREF_ICONS.BACK, "Back", () =>
          ctx.navigatePanelHistory(browser, -1),
        );
        iconButton(ctx.PREF_ICONS.RELOAD, "Reload", () => browser.reload());
        iconButton(ctx.PREF_ICONS.FORWARD, "Forward", () =>
          ctx.navigatePanelHistory(browser, 1),
        );
        const grip = document.createElement("div");
        grip.className = "bgalazka-second-grip";
        grip.title = "Drag to move second panel";
        grip.appendChild(ctx.parseSVG(ctx.PREF_ICONS.DRAG_HANDLE));
        const url = document.createElement("input");
        url.type = "text";
        url.className = "bgalazka-second-url";
        url.placeholder = app.url || "URL or search";
        url.spellcheck = false;
        url.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if (event.key === "Enter" && url.value.trim()) {
            navigate(browser, url.value.trim());
            url.blur();
          } else if (event.key === "Escape") url.blur();
        });
        bar.append(grip, url);
        iconButton(ctx.PREF_ICONS.ZOOM_OUT, "Zoom out", () =>
          zoom(-0.1),
        ).classList.add("bgalazka-second-zoom");
        const zoomText = button("100%", "Reset zoom", () => zoom(0));
        zoomText.classList.add(
          "bgalazka-second-zoom-label",
          "bgalazka-second-zoom",
        );
        iconButton(ctx.PREF_ICONS.ZOOM_IN, "Zoom in", () =>
          zoom(0.1),
        ).classList.add("bgalazka-second-zoom");
        const quickSwitch = button("⇄", "Switch search engine", () => {
          const next = ctx.getPanelQuickSwitchTarget?.(browser);
          if (next) navigate(browser, next.url);
        });
        quickSwitch.classList.add("bgalazka-second-quickswitch");
        if (state.mode === "triple")
          button("⇅", "Swap top and bottom panels", swapPair).classList.add(
            "bgalazka-second-swap",
          );
        button(
          "×",
          state.mode === "triple" ? "Unlink panels" : "Close second panel",
          () => {
            if (state.mode === "triple") leaveAndUnlinkTriple();
            else discardSecond();
          },
        ).classList.add("bgalazka-second-close");
        function zoom(step) {
          try {
            const current = ZoomManager.getZoomForBrowser(browser);
            const next = step ? Math.max(0.3, Math.min(3, current + step)) : 1;
            ZoomManager.setZoomForBrowser(browser, next);
            zoomText.textContent = Math.round(next * 100) + "%";
          } catch (_) {}
        }
        box.appendChild(bar);
        if (state.mode === "super") box.appendChild(browser);
        browser.style.display = "";
        if (state.mode === "triple") {
          const divider = document.createElement("div");
          divider.className = "bgalazka-triple-divider";
          divider.title = "Drag to balance panel heights";
          divider.setAttribute("role", "separator");
          divider.setAttribute("aria-orientation", "horizontal");
          // CSS order places the bars around the divider. Neither loaded XUL
          // browser is moved; moving a live browser can restart its document.
          slider().append(divider, box);
          state.first.setAttribute("data-bgalazka-triple-slot", "top");
          browser.setAttribute("data-bgalazka-triple-slot", "bottom");
          ui.setAttribute("bgalazka-triple-populated", "true");
          // Make the primary toolbar's Triple View controls appear immediately;
          // the 1s poll is only a navigation fallback, not a UI lifecycle hook.
          ctx.updateWebToolbarState();
          const balance = (clientY) => {
            const panel = slider();
            const rect = panel.getBoundingClientRect();
            const toolbarHeight =
              document.getElementById("zen-app-panel-toolbar")?.offsetHeight ||
              0;
            const usable =
              rect.height -
              toolbarHeight -
              bar.offsetHeight -
              divider.offsetHeight;
            if (usable <= 0) return;
            const min = Math.min(160, usable * 0.25);
            const pixels = Math.max(
              min,
              Math.min(
                usable - min,
                clientY - rect.top - toolbarHeight - panel.clientTop,
              ),
            );
            state.share = pixels / usable;
            fitSecondaryBrowsers();
          };
          state.divider = divider;
          const handle = document.createElement("div");
          handle.className = "bgalazka-triple-drag-handle";
          handle.title = divider.title;
          (document.body || document.documentElement).appendChild(handle);
          state.dividerHandle = handle;
          state.geometryObserver = new ResizeObserver(fitSecondaryBrowsers);
          state.geometryObserver.observe(slider());
          state.geometryObserver.observe(bar);
          const toolbar = document.getElementById("zen-app-panel-toolbar");
          if (toolbar) state.geometryObserver.observe(toolbar);
          requestAnimationFrame(fitSecondaryBrowsers);
          let shield = null;
          let grabOffset = 0;
          let pointerId = null;
          let captureTarget = null;
          const endResize = (event) => {
            if (event?.pointerId != null && event.pointerId !== pointerId)
              return;
            document.removeEventListener("pointermove", moveResize, true);
            document.removeEventListener("pointerup", endResize, true);
            document.removeEventListener("pointercancel", endResize, true);
            window.removeEventListener("blur", endResize);
            const target = captureTarget;
            const id = pointerId;
            captureTarget = null;
            pointerId = null;
            if (target && id != null && target.hasPointerCapture?.(id))
              target.releasePointerCapture(id);
            shield?.remove();
            shield = null;
            if (state.pair && state.second) rememberPair();
          };
          const moveResize = (event) => {
            if (shield && event.pointerId === pointerId)
              balance(event.clientY - grabOffset);
          };
          const startResize = (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            endResize();
            grabOffset = event.clientY - divider.getBoundingClientRect().top;
            pointerId = event.pointerId;
            captureTarget = event.currentTarget;
            shield = document.createElement("div");
            shield.className = "bgalazka-triple-drag-shield";
            (document.body || document.documentElement).appendChild(shield);
            // Keep pointer events routed to the handle even when the cursor
            // crosses into the lower remote browser viewport.
            try {
              captureTarget.setPointerCapture(pointerId);
            } catch (_) {}
            document.addEventListener("pointermove", moveResize, true);
            document.addEventListener("pointerup", endResize, true);
            document.addEventListener("pointercancel", endResize, true);
            window.addEventListener("blur", endResize);
          };
          handle.addEventListener("pointerdown", startResize);
          divider.addEventListener("pointerdown", startResize);
          state.resizeCleanup = endResize;
        } else {
          (document.body || document.documentElement).appendChild(box);
          const first = root().getBoundingClientRect();
          const width = Math.min(
            Math.max(270, Math.round(first.width * 0.75)),
            window.innerWidth - 24,
          );
          const height = Math.min(
            Math.max(220, Math.round(first.height * 0.68)),
            window.innerHeight - 24,
          );
          box.style.width = `${width}px`;
          box.style.height = `${height}px`;
          box.style.left = `${Math.max(
            12,
            Math.min(
              window.innerWidth - width - 12,
              first.left < window.innerWidth / 2
                ? first.right + 12
                : first.left - width - 12,
            ),
          )}px`;
          box.style.top = `${Math.max(12, Math.min(window.innerHeight - height - 12, first.top))}px`;
          // Eight edge/corner surfaces resize the secondary independently.
          for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
            const handle = document.createElement("div");
            handle.className = `bgalazka-second-resize bgalazka-resize-${edge}`;
            handle.title = "Drag to resize second panel";
            box.appendChild(handle);
            let start = null;
            handle.addEventListener("pointerdown", (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = box.getBoundingClientRect();
              start = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              };
              handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener("pointermove", (event) => {
              if (!start || event.pointerId !== start.id) return;
              let left = start.left,
                top = start.top;
              let width = start.width,
                height = start.height;
              const dx = event.clientX - start.x,
                dy = event.clientY - start.y;
              if (edge.includes("e")) width += dx;
              if (edge.includes("w")) {
                left += dx;
                width -= dx;
              }
              if (edge.includes("s")) height += dy;
              if (edge.includes("n")) {
                top += dy;
                height -= dy;
              }
              width = Math.max(
                250,
                Math.min(width, window.innerWidth - Math.max(0, left)),
              );
              height = Math.max(
                180,
                Math.min(height, window.innerHeight - Math.max(0, top)),
              );
              if (edge.includes("w")) left = start.left + start.width - width;
              if (edge.includes("n")) top = start.top + start.height - height;
              const bounds = window.ZentralRuntime.sidebarSafeBounds();
              width = Math.min(
                width,
                Math.max(0, bounds.right - bounds.left - 24),
              );
              box.style.left = `${Math.max(bounds.left + 12, Math.min(bounds.right - width - 12, left))}px`;
              box.style.top = `${Math.max(0, top)}px`;
              box.style.width = `${width}px`;
              box.style.height = `${height}px`;
            });
            const doneResize = () => {
              start = null;
            };
            handle.addEventListener("pointerup", doneResize);
            handle.addEventListener("pointercancel", doneResize);
            handle.addEventListener("lostpointercapture", doneResize);
          }
          let drag = null;
          grip.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            const rect = box.getBoundingClientRect();
            drag = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              left: rect.left,
              top: rect.top,
            };
            grip.setPointerCapture(event.pointerId);
          });
          grip.addEventListener("pointermove", (event) => {
            if (!drag || event.pointerId !== drag.id) return;
            const bounds = window.ZentralRuntime.sidebarSafeBounds();
            box.style.left = `${Math.max(
              bounds.left + 12,
              Math.min(
                bounds.right - box.getBoundingClientRect().width - 12,
                drag.left + event.clientX - drag.x,
              ),
            )}px`;
            box.style.top = `${Math.max(
              0,
              Math.min(
                window.innerHeight - box.getBoundingClientRect().height,
                drag.top + event.clientY - drag.y,
              ),
            )}px`;
          });
          const done = () => {
            drag = null;
          };
          grip.addEventListener("pointerup", done);
          grip.addEventListener("pointercancel", done);
          grip.addEventListener("lostpointercapture", done);
        }
        state.shell = box;
        window.ZentralRuntime?.requestSidebarLayout?.();
        const refreshSecondaryToolbar = () => {
          if (state.second !== browser || !box.isConnected) return;
          const nextSearch = ctx.getPanelQuickSwitchTarget?.(browser);
          quickSwitch.style.setProperty(
            "display",
            ctx.getPref(
              ctx.BGALAZKA_EXT_PREFS.WEB_TOOLBAR_QUICKSWITCH,
              false,
            ) && nextSearch
              ? "inline-flex"
              : "none",
            "important",
          );
          if (nextSearch) quickSwitch.title = "Search with " + nextSearch.label;
          const liveURL = browser.currentURI?.spec;
          if (liveURL && liveURL !== "about:blank") state.secondURL = liveURL;
          if (document.activeElement !== url)
            url.value =
              browser.currentURI?.spec === "about:blank"
                ? app.url
                : browser.currentURI?.spec || app.url || "";
          try {
            zoomText.textContent = `${Math.round(ZoomManager.getZoomForBrowser(browser) * 100)}%`;
          } catch (_) {}
        };
        state.pollUpdate = refreshSecondaryToolbar;
        const secondaryEvents = ["load", "pageshow", "DOMTitleChanged"];
        secondaryEvents.forEach((type) =>
          browser.addEventListener(type, refreshSecondaryToolbar),
        );
        const secondaryProgress = {
          onLocationChange(progress) {
            if (progress && !progress.isTopLevel) return;
            refreshSecondaryToolbar();
          },
          QueryInterface: ChromeUtils.generateQI([
            "nsIWebProgressListener",
            "nsISupportsWeakReference",
          ]),
        };
        try {
          browser.webProgress?.addProgressListener(
            secondaryProgress,
            Ci.nsIWebProgress.NOTIFY_LOCATION,
          );
        } catch (_) {}
        state.secondToolbarCleanup = () => {
          secondaryEvents.forEach((type) =>
            browser.removeEventListener(type, refreshSecondaryToolbar),
          );
          try {
            browser.webProgress?.removeProgressListener(secondaryProgress);
          } catch (_) {}
        };
        refreshSecondaryToolbar();
        ctx.syncSecondaryFallbackPolling();
      }
      ctx.updateSecondaryFallbackState = () => {
        if (isOpen() && !ui.hasAttribute("bgalazka-hover-panel-hidden"))
          state.pollUpdate?.();
      };
      ctx.syncSecondaryFallbackPolling = () => {
        ctx.updateSecondaryFallbackState();
        ctx.syncPanelFallbackPolling();
      };
      ctx.registerCleanup(() => {
        delete ctx.updateSecondaryFallbackState;
      });

      function openSecond(app, createLink = true) {
        if (!app?.id || !isOpen() || !state.first?.isConnected) return false;
        if (app.id === state.first._bgalazkaAppId) return true;
        if (app.id === state.second?._bgalazkaAppId) return true;
        const { browser, isNew } = apps.getOrCreateAppBrowser(app) || {};
        if (!browser) return false;
        discardSecond();
        state.second = browser;
        state.secondURL = app.url;
        makeShell(browser, app); // attach before navigating a remote browser
        refreshViewZenCss(state.first);
        refreshViewZenCss(browser);
        if (
          isNew ||
          (browser.currentURI?.spec === "about:blank" &&
            !browser.webProgress?.isLoadingDocument)
        )
          navigate(browser, browser._bgalazkaSuperPinReturnURL || app.url);
        repairSuperPinReturn(browser);
        ctx.requestPanelActivity();
        if (state.mode === "triple" && createLink) {
          const firstId = state.first?._bgalazkaAppId;
          const firstApp =
            ctx.essentialPanels.get(firstId)?.app ||
            savedNormalApps().find((item) => item.id === firstId);
          linkCurrentPair(firstApp, app);
        }
        markTiles();
        return true;
      }
      // Startup can request one panel even when it belongs to a saved Triple View pair.
      // Normal launcher clicks still restore the linked pair through the wrapper below.

      ctx.syncSecondaryToolbarPreferences = () => {
        state.pollUpdate?.();
        fitSecondaryBrowsers();
      };
      const fallbackRecreatePanels = ctx.recreateLoadedPanels;
      ctx.recreateLoadedPanels = (ids) => {
        const view = apps.capturePanelViewState();
        const primary = view.open
          ? state.mode
            ? state.first
            : active()
          : null;
        const loaded = new Map(
          ctx
            .getAllAppBrowsers()
            .map((browser) => [browser._bgalazkaAppId, browser]),
        );
        for (const id of ids) {
          const old = loaded.get(id);
          const source =
            ctx.essentialPanels.get(id)?.app ||
            savedNormalApps().find((a) => a.id === id);
          if (!old || !source) continue;
          const app = {
            ...source,
            url:
              old.currentURI?.spec && old.currentURI.spec !== "about:blank"
                ? old.currentURI.spec
                : source.url,
          };
          const isFirst = old === primary;
          const isSecond = old === state.second;
          const shellStyle = state.shell?.style.cssText;
          const share = state.share,
            pair = state.pair;

          if (isSecond) discardSecond();
          const closePanel = apps.closePanel;
          try {
            apps.closePanel = () => {};
            origCloseApp.call(apps, id);
          } finally {
            apps.closePanel = closePanel;
          }
          if (isFirst) {
            origOpen.call(apps, app);
            if (state.mode)
              state.first = ctx
                .getAllAppBrowsers()
                .find((b) => b._bgalazkaAppId === id);
            else state.first = null;
            if (state.mode === "triple")
              state.first?.setAttribute("data-bgalazka-triple-slot", "top");
            if (state.second) state.second.style.display = "";
            apps.restorePanelViewState(view);
          } else if (isSecond) {
            openSecond(app, false);
            if (state.mode === "super" && state.shell && shellStyle)
              state.shell.style.cssText = shellStyle;
          } else {
            const created = apps.getOrCreateAppBrowser(app);
            if (created?.browser) {
              created.browser.style.display = "none";
              navigate(created.browser, app.url);
            }
          }
          state.share = share;
          state.pair = pair;
          if (state.mode) fitSecondaryBrowsers();
        }
        markTiles();
        ctx.syncAppPanelBrowserActivity();
      };
      ctx.registerCleanup(() => {
        ctx.recreateLoadedPanels = fallbackRecreatePanels;
        delete ctx.syncSecondaryToolbarPreferences;
      });
      ctx.openStartupSinglePanel = (app) => origOpen.call(apps, app);
      apps.openPanel = function (app) {
        const pair = app?.id && ctx.linkedPairFor(app.id);
        if (pair) {
          if (
            state.mode === "triple" &&
            state.pair === pair &&
            state.second?.isConnected &&
            isOpen()
          ) {
            // The primary tile's native toggle closes directly; the secondary
            // tile arrives here instead, so give both icons the same behavior.
            this.closePanel();
            return;
          }
          if (showPair(pair)) return;
        }
        if (
          state.pair &&
          app?.id !== state.first?._bgalazkaAppId &&
          app?.id !== state.second?._bgalazkaAppId
        )
          leaveMode();
        if (
          state.mode &&
          state.first?.isConnected &&
          isOpen() &&
          app?.id !== state.first._bgalazkaAppId
        ) {
          if (openSecond(app)) return;
        }
        if (state.mode) leaveMode();
        const result = origOpen.call(this, app);
        repairSuperPinReturn(
          [...(slider()?.querySelectorAll("browser") || [])].find(
            (browser) => browser._bgalazkaAppId === app?.id,
          ),
        );
        return result;
      };
      apps.closePanel = function (...args) {
        leaveMode();
        return origClose.apply(this, args);
      };
      apps.closeApp = function (id, ...args) {
        if (state.first?._bgalazkaAppId === id) leaveMode();
        else if (state.second?._bgalazkaAppId === id) discardSecond();
        return origCloseApp.call(this, id, ...args);
      };
      apps.removeApp = function (id, ...args) {
        ctx.unlinkTriplePair(id);
        if (state.pair && (state.pair.top === id || state.pair.bottom === id)) {
          state.pair = null;
          leaveMode();
        }
        return origRemoveApp.call(this, id, ...args);
      };
      apps.renderGrid = function (...args) {
        const result = origRender.apply(this, args);
        markTiles();
        return result;
      };
      const HOLD_MS = 550;
      let pending = null;
      let suppress = null;
      const targetButton = (node) =>
        node?.closest?.(
          "#zen-app-dual-view-btn, #zen-app-panel-pill .zen-app-btn[data-pinned]",
        );
      const onDown = (event) => {
        if (event.button !== 0 || !isOpen()) return;
        const btn = targetButton(event.target);
        if (!btn) return;
        const kind = btn.id === "zen-app-dual-view-btn" ? "triple" : "super";
        pending = {
          btn,
          x: event.clientX,
          y: event.clientY,
          timer: ctx.setTimeout(() => {
            pending = null;
            const first = active();
            if (!first || !isOpen()) return;
            suppress = btn;
            if (state.mode === kind) {
              if (kind === "triple") leaveAndUnlinkTriple();
              else leaveMode();
              return;
            }
            leaveMode();
            if (kind === "triple") state.share = 0.5;
            state.first = first;
            state.mode = kind;
            if (kind === "triple") {
              enterTriple(first);
            } else {
              state.previousPin = btn.getAttribute("data-pinned") === "true";
              if (!state.previousPin) apps.togglePin();
              ui.setAttribute("bgalazka-super-pin", "true");
              refreshViewZenCss(first);
            }
            btn.setAttribute("data-hold-active", "true");
            markTiles();
          }, HOLD_MS),
        };
      };
      const cancelPending = () => {
        if (pending) ctx.clearTimeout(pending.timer);
        pending = null;
      };
      const onMove = (event) => {
        if (
          pending &&
          Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8
        )
          cancelPending();
      };
      const onClick = (event) => {
        const btn = targetButton(event.target);
        if (!btn) return;
        if (suppress === btn) {
          suppress = null;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (
          (btn.id === "zen-app-dual-view-btn" && state.mode === "triple") ||
          (btn.id !== "zen-app-dual-view-btn" && state.mode === "super")
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (btn.id === "zen-app-dual-view-btn") leaveAndUnlinkTriple();
          else leaveMode();
        }
      };
      window.addEventListener("pointerdown", onDown, true);
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", cancelPending, true);
      window.addEventListener("pointercancel", cancelPending, true);
      window.addEventListener("blur", cancelPending);
      window.addEventListener("click", onClick, true);
      ctx.registerCleanup(() => {
        cancelPending();
        leaveMode();
        window.removeEventListener("pointerdown", onDown, true);
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", cancelPending, true);
        window.removeEventListener("pointercancel", cancelPending, true);
        window.removeEventListener("blur", cancelPending);
        window.removeEventListener("click", onClick, true);
        delete ctx.openStartupSinglePanel;
        apps.openPanel = origOpen;
        apps.closePanel = origClose;
        apps.closeApp = origCloseApp;
        apps.removeApp = origRemoveApp;
        apps.renderGrid = origRender;
      });
    })();
  });
})();
