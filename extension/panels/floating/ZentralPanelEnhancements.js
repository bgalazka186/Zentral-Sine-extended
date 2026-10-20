/* Hybrid U110-FLOAT/NAV/PILL. One geometry owner, one browser owner.
 * Base edits B001/B002/B003 expose identity/store and avoid competing geometry.
 * No polling loop, browser reparenting, second Apps instance or content injection.
 * Persistence is per app by default, versioned, and committed at gesture end. */
(function () {
  "use strict";
  const loader = window.ZentralModuleLoader;
  loader.load("zentral/geometry/ZentralPanelMath.js", {
    owner: "panel-enhancements",
  });
  loader.load("extension/panels/floating/ZentralPillActions.js", {
    owner: "panel-enhancements",
  });
  window.ZentralRuntime.register({
    id: "panel-enhancements",
    init({ lifecycle, shared, runtime }) {
      const { Core } = shared,
        bridge = runtime.baseBridge,
        apps = window.Zentral.Apps,
        ctx = runtime.panelContext;
      const math = loader.create("zentral/panel-math"),
        P = "zen.workspace.zentral.hybrid.",
        storeKey = P + "placements";
      const ui = document.documentElement,
        hosts = new Map(),
        ownedNodes = new Set();
      let actionsUI = null,
        primary = null,
        gesture = null,
        frame = null,
        saving = false,
        destroyed = false,
        saved = {},
        pill = null,
        suppressClick = false,
        observedPill = null,
        pillObserver = null,
        pinTransitionInternal = false;
      lifecycle.own(cleanup);
      const hook = (...args) => lifecycle.own(bridge.wrap(...args));
      const optionCache = new Map();
      const pref = (key, fallback) => {
        if (!optionCache.has(key))
          optionCache.set(key, Core.getPref(P + key, fallback));
        return optionCache.get(key);
      };
      const enabled = () => pref("geometry_mode", "hybrid") === "hybrid";
      const defaultSide = () =>
        ctx.defaultPanelSide?.() ||
        (apps.isPanelAttachedToRight() ? "right" : "left");
      const workspace = () => {
        const active = window.gZenWorkspaces?.activeWorkspace;
        return String(
          (typeof active === "object"
            ? active?.uuid || active?.id || active?.workspaceId
            : active) || "all",
        );
      };
      const keyFor = (id, role) =>
        math.placementKey(id, workspace(), pref("position_scope", "app"), role);
      const detachedHeight = () =>
        Math.max(
          40,
          Math.min(100, Number(pref("detached_height_percent", 78)) || 78),
        ) / 100;
      function validSavedPlacement(value) {
        const placement = math.validPlacement(value);
        if (placement && value.customSide === true) placement.customSide = true;
        return placement;
      }
      function readStore() {
        try {
          const data = JSON.parse(
            Core.getPref(storeKey, '{"version":1,"entries":{}}'),
          );
          if (
            data.version !== 1 ||
            !data.entries ||
            Array.isArray(data.entries)
          )
            return {};
          return Object.fromEntries(
            Object.entries(data.entries)
              .map(([key, value]) => [key, validSavedPlacement(value)])
              .filter(([, value]) => value),
          );
        } catch (_) {
          return {};
        }
      }
      saved = readStore();
      function persist(host) {
        if (!host?.id || !host.layout || destroyed) return;
        // Merge the live pref so another window's unrelated app writes survive.
        saved = readStore();
        saved[host.key] = structuredClone(host.layout);
        saving = true;
        try {
          Core.setPref(
            storeKey,
            JSON.stringify({ version: 1, entries: saved }),
          );
        } finally {
          saving = false;
        }
      }
      function area() {
        const b = runtime.sidebarSafeBounds?.() || {
          left: 0,
          right: window.innerWidth,
        };
        const content = document
          .getElementById("tabbrowser-tabbox")
          ?.getBoundingClientRect();
        const top =
          content?.top > 0 && content.top < window.innerHeight / 2
            ? content.top
            : 0;
        // Optional overflow may cross page edges; reserved native sidebar stays usable.
        return {
          left: Math.max(0, b.left || 0),
          top,
          width: Math.max(1, (b.right || window.innerWidth) - (b.left || 0)),
          height: Math.max(1, window.innerHeight - top),
        };
      }
      const rectOf = (root) => {
        const r = root.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      };
      const isVisible = (host) =>
        host?.root?.isConnected &&
        (host.role === "secondary" || host.root.hasAttribute("open")) &&
        !host.root.hasAttribute("closing");
      function bounded(rect, box = area()) {
        return math.clampRect(
          rect,
          box,
          {},
          {
            allowOverflow: pref("allow_overflow", false),
            minVisibleMargin: 96,
          },
        );
      }
      function put(root, key, value) {
        if (root.style.getPropertyValue(key) !== value)
          root.style.setProperty(key, value);
      }
      function apply(host) {
        if (!enabled() || !host || !isVisible(host)) return;
        const pushing =
          host.role === "primary" &&
          host.layout.mode === "docked" &&
          ui.getAttribute("bgalazka-push-page") === "true";
        const box = pushing
          ? {
              left: 0,
              top: 0,
              width: window.innerWidth,
              height: window.innerHeight,
            }
          : area();
        let r = bounded(
          host.expanded
            ? { x: box.left, y: box.top, w: box.width, h: box.height }
            : host.layout.rect,
          box,
        );
        if (host.layout.mode === "docked" && !host.expanded) {
          if (!host.layout.customSide) host.layout.side = defaultSide();
          r = math.dockRect(
            host.layout.side,
            { ...r, y: box.top, h: box.height },
            box,
            pushing ? 0 : pref("dock_gap", 0),
          );
        }
        // Only the live rectangle is clamped after a temporary viewport shrink;
        // the stored desired rectangle is retained for a later larger window.
        host.liveRect = r;
        const root = host.root;
        const side = host.lockedPillSide || math.pickPillSide(r, box);
        for (const [key, value] of Object.entries({
          "data-hybrid-placement": "true",
          "data-floating": String(host.layout.mode === "floating"),
          "data-panel-side": host.layout.side,
          "data-hybrid-app-id": host.id,
          "data-pill-side": side,
        })) {
          if (root.getAttribute(key) !== value) root.setAttribute(key, value);
        }
        const pillSpace = 40,
          viewportInset = 4;
        const panelEdge = side === "left" ? r.x : r.x + r.w;
        const outsideLeft = side === "left" ? panelEdge - pillSpace : panelEdge;
        const outsideFits =
          outsideLeft >= viewportInset &&
          outsideLeft + pillSpace <= window.innerWidth - viewportInset;
        const fallbackLeft =
          side === "left" ? panelEdge : panelEdge - pillSpace;
        const desiredLeft = outsideFits ? outsideLeft : fallbackLeft;
        const pillLeft = Math.max(
          0,
          Math.min(window.innerWidth - pillSpace, desiredLeft),
        );
        const pillOrigin = outsideFits
          ? side === "left"
            ? "right center"
            : "left center"
          : side === "left"
            ? "left center"
            : "right center";
        put(root, "--hybrid-pill-inset", Math.round(pillLeft - r.x) + "px");
        put(root, "--hybrid-pill-origin", pillOrigin);
        const pillHeight = Math.min(
          Math.max(1, box.height - 16),
          pill?.scrollHeight || 400,
        );
        const visibleY = Math.max(
          box.top + pillHeight / 2 + 8,
          Math.min(
            box.top + box.height - pillHeight / 2 - 8,
            r.y +
              r.h *
                (0.5 +
                  Math.max(
                    -50,
                    Math.min(
                      50,
                      Number(
                        host.pillOffset ??
                          ctx.getPref(ctx.BGALAZKA_EXT_PREFS.PILL_POSITION, 0),
                      ) || 0,
                    ),
                  ) /
                    100),
          ),
        );
        put(root, "--hybrid-pill-y", Math.round(visibleY - r.y) + "px");
        for (const [key, value] of Object.entries({
          left: r.x + "px",
          top: r.y + "px",
          width: r.w + "px",
          height: r.h + "px",
          right: "auto",
          bottom: "auto",
          "margin-left": "0px",
          "margin-right": "0px",
          "margin-top": "0px",
          "margin-bottom": "0px",
          "--hybrid-x": r.x + "px",
          "--hybrid-y": r.y + "px",
          "--hybrid-w": r.w + "px",
          "--hybrid-h": r.h + "px",
          "--zentral-safe-panel-left": r.x + "px",
          "--zentral-safe-panel-right": window.innerWidth - r.x - r.w + "px",
        }))
          put(root, key, value);
        if (host.role === "primary") {
          const snap = bridge.snapshot();
          if (
            host.layout.mode === "floating" &&
            !snap.pinned &&
            !host.manualPin
          )
            setPinInternal();
        }
      }
      function clearHost(host) {
        if (!host) return;
        const root = host.root;
        for (const key of [
          "data-hybrid-placement",
          "data-floating",
          "data-hybrid-app-id",
          "data-pill-side",
        ])
          root.removeAttribute(key);
        for (const key of [
          "left",
          "top",
          "width",
          "height",
          "right",
          "bottom",
          "margin-left",
          "margin-right",
          "margin-top",
          "margin-bottom",
          "--hybrid-x",
          "--hybrid-y",
          "--hybrid-w",
          "--hybrid-h",
          "--hybrid-pill-inset",
          "--hybrid-pill-y",
          "--hybrid-pill-origin",
          "--zentral-safe-panel-left",
          "--zentral-safe-panel-right",
        ])
          root.style.removeProperty(key);
        hosts.delete(root);
      }
      function adopt(root, browser, id, role = "primary") {
        if (!root || !id || !enabled()) return null;
        const key = keyFor(id, role),
          prior = hosts.get(root);
        if (prior?.key === key) {
          prior.browser = browser;
          apply(prior);
          return prior;
        }
        if (prior) {
          persist(prior);
          clearHost(prior);
        }
        const raw = rectOf(root);
        const side = defaultSide();
        const layout = validSavedPlacement(saved[key]) || {
          mode: role === "secondary" ? "floating" : "docked",
          side,
          customSide: false,
          rect: bounded(raw),
          pinned: !!bridge.snapshot().pinned,
        };
        const host = { root, browser, id, role, key, layout, expanded: false };
        hosts.set(root, host);
        apply(host);
        return host;
      }
      function syncPrimary() {
        const snap = bridge.snapshot();
        if (
          !snap.root?.hasAttribute("open") ||
          snap.root.hasAttribute("closing")
        )
          return;
        // Triple View's base active id may be the second slot; the primary URL
        // toolbar resolves the top browser and is authoritative for this host.
        const browser = ctx.getActiveAppBrowser?.() || snap.browser;
        const id = browser?._bgalazkaAppId || snap.appId;
        primary = adopt(snap.root, browser, id);
      }
      function syncSecondary() {
        const second = ctx.secondarySnapshot?.();
        if (
          !second?.root?.isConnected ||
          second.mode !== "super" ||
          !second.browser
        )
          return;
        adopt(
          second.root,
          second.browser,
          second.browser._bgalazkaAppId,
          "secondary",
        );
      }
      function schedule() {
        if (frame !== null || destroyed) return;
        frame = lifecycle.requestAnimationFrame(() => {
          frame = null;
          syncPrimary();
          syncSecondary();
          syncControls();
        });
      }
      function setPinInternal() {
        pinTransitionInternal = true;
        try {
          apps.togglePin();
        } finally {
          pinTransitionInternal = false;
        }
      }
      // Re-attaching keeps the width the user chose while floating but returns to the
      // vertical extent the panel had at the edge (full-height "hugging" by default),
      // so a detach/attach round trip no longer leaves a shorter panel.
      function restoreDockedExtent(host) {
        const box = area(),
          d = host.layout.dockedRect;
        const base =
          d && Number.isFinite(d.y) && Number.isFinite(d.h)
            ? d
            : { y: box.top, h: box.height };
        host.layout.rect = bounded(
          { ...host.layout.rect, y: base.y, h: base.h },
          box,
        );
      }
      function syncDockState(host, mode, side = host.layout.side) {
        endGesture(false);
        const was = host.layout.mode;
        host.layout.mode = mode;
        host.layout.side = side;
        host.expanded = false;
        if (host.role === "primary") apps.setPanelExpanded(false);
        if (mode === "floating" && was !== "floating") {
          host.layout.pinned = !!bridge.snapshot().pinned;
          // Detaching never resizes: the floating rectangle is exactly what was docked,
          // and the docked rectangle is remembered so attaching restores the edge fit.
          host.layout.dockedRect = { ...host.liveRect };
          host.layout.rect = bounded({
            ...host.liveRect,
            y: area().top + (area().height * (1 - detachedHeight())) / 2,
            h: Math.min(host.liveRect.h, area().height * detachedHeight()),
          });
          if (host.role === "primary" && !bridge.snapshot().pinned)
            setPinInternal();
        }
        if (mode === "docked" && was === "floating") restoreDockedExtent(host);
        if (
          mode === "docked" &&
          was === "floating" &&
          host.role === "primary"
        ) {
          if (bridge.snapshot().pinned !== host.layout.pinned) setPinInternal();
        }
        apply(host);
        persist(host);
        ctx.syncPanelPushState?.();
        ctx.syncHoverPanelAvailability?.();
        syncControls();
      }
      const service = {
        owns: (root) => enabled() && hosts.has(root),
        manualPinOverridden: () => !!primary?.manualPin,
        apply: (root) => apply(hosts.get(root)),
        isDetached: () => enabled() && primary?.layout.mode === "floating",
        toggleDock() {
          if (primary)
            syncDockState(
              primary,
              primary.layout.mode === "floating" ? "docked" : "floating",
            );
        },
        switchDefaultSide() {
          if (!primary) return;
          const nextSide = primary.layout.side === "left" ? "right" : "left";
          primary.layout.customSide = true;
          syncDockState(primary, "docked", nextSide);
          schedule();
        },
        preservePrimaryFor(browser) {
          if (!primary || !browser?._bgalazkaAppId) return;
          persist(primary);
          primary.id = browser._bgalazkaAppId;
          primary.browser = browser;
          primary.key = keyFor(primary.id, "primary");
          persist(primary);
          apply(primary);
        },
        side: () =>
          enabled() && primary && isVisible(primary)
            ? primary.layout.side
            : null,
        sync: schedule,
        reset(id, role = null) {
          endGesture(false);
          saved = readStore();
          for (const key of Object.keys(saved)) {
            let parts;
            try {
              parts = JSON.parse(key);
            } catch (_) {
              continue;
            }
            if (
              (!role || parts[0] === role) &&
              (parts[1] === id || pref("position_scope", "app") === "global")
            )
              delete saved[key];
          }
          saving = true;
          try {
            Core.setPref(
              storeKey,
              JSON.stringify({ version: 1, entries: saved }),
            );
          } finally {
            saving = false;
          }
          for (const host of [...hosts.values()])
            if (host.id === id || pref("position_scope", "app") === "global") {
              if (host.role === "primary") {
                const previous = host.layout.pinned;
                clearHost(host);
                primary = null;
                if (bridge.snapshot().pinned !== previous) setPinInternal();
                apps.positionPanel();
                syncPrimary();
              } else {
                host.layout = {
                  mode: "floating",
                  side: host.layout.side,
                  rect: math.dockRect(
                    host.layout.side,
                    { x: 0, y: area().top, w: 350, h: 450 },
                    area(),
                  ),
                  pinned: false,
                };
                apply(host);
              }
            }
          schedule();
        },
      };
      ctx.floating = service;
      lifecycle.own(() => {
        if (ctx.floating === service) delete ctx.floating;
      });
      // Final method hooks are installed AFTER the existing extension and
      // secondary-view wrappers. This owner is destroyed before its dependencies.
      hook(
        apps,
        "openPanel",
        function (next, args) {
          endGesture(false);
          if (primary) persist(primary);
          // Keep the live host through secondary opens. adopt changes its identity
          // only after the secondary owner has completed the operation.
          const result = next(...args);
          syncPrimary();
          syncSecondary();
          syncControls();
          return result;
        },
        "panel-enhancements/open",
      );
      hook(
        apps,
        "closePanel",
        function (next, args) {
          endGesture(false);
          if (primary) persist(primary);
          const result = next(...args);
          return result;
        },
        "panel-enhancements/close",
      );
      hook(
        apps,
        "togglePin",
        function (next, args) {
          if (primary && !pinTransitionInternal) primary.manualPin = true;
          const result = next(...args);
          if (primary && !pinTransitionInternal) {
            primary.layout.pinned = !!bridge.snapshot().pinned;
            persist(primary);
            schedule();
          }
          return result;
        },
        "panel-enhancements/temporary-pin",
      );
      hook(
        apps,
        "toggleExpand",
        function (next, args) {
          if (!enabled() || !primary) return next(...args);
          primary.expanded = !primary.expanded;
          apps.setPanelExpanded(primary.expanded);
          apply(primary);
          syncControls();
          ctx.syncPanelPushState?.();
        },
        "panel-enhancements/expand",
      );
      if (typeof apps.restorePanelViewState === "function")
        hook(
          apps,
          "restorePanelViewState",
          function (next, args) {
            const result = next(...args);
            if (primary) {
              primary.expanded = !!bridge.snapshot().expanded;
              apply(primary);
            }
            return result;
          },
          "panel-enhancements/presentation-restore",
        );
      hook(
        apps,
        "removeApp",
        function (next, args) {
          const result = next(...args);
          if (result === false) return result; // Failed native host removal retains identity and placement.
          saved = readStore();
          for (const key of Object.keys(saved)) {
            try {
              if (JSON.parse(key)[1] === args[0]) delete saved[key];
            } catch (_) {}
          }
          saving = true;
          try {
            Core.setPref(
              storeKey,
              JSON.stringify({ version: 1, entries: saved }),
            );
          } finally {
            saving = false;
          }
          for (const host of [...hosts.values()])
            if (host.id === args[0]) {
              clearHost(host);
              if (primary === host) primary = null;
            }
          return result;
        },
        "panel-enhancements/remove",
      );
      // Controls and toolbar actions use actual browser identity, never the main tab.
      function reloadOrStop(browser) {
        if (!browser) return;
        try {
          if (browser.webProgress?.isLoadingDocument) {
            if (typeof browser.stop === "function") browser.stop();
            else browser.webNavigation?.stop(Ci.nsIWebNavigation.STOP_ALL);
          } else if (typeof browser.reload === "function") browser.reload();
          else browser.webNavigation?.reload(0);
        } catch (error) {
          console.warn("[Zentral panel reload/stop]", error);
        }
        schedule();
      }
      function saveURL(browser, secondary = false) {
        const url = math.validStartURL(browser?.currentURI?.spec);
        if (!url) return false;
        const id = browser?._bgalazkaAppId;
        // Essential/tab-linked and secondary hosts create independent launchers.
        const copy =
          secondary ||
          ctx.essentialPanels?.has(id) ||
          !bridge.app(id) ||
          id?.startsWith("bgalazka-essential-");
        const result = copy
          ? bridge.createApp(
              url,
              browser.contentTitle || "Panel",
              `page-icon:${url}`,
            )
          : bridge.updateStartURL(id, url);
        if (!result) {
          console.warn(
            "[Zentral] Could not save panel start URL (app limit or invalid record)",
          );
          return false;
        }
        return true;
      }
      function button(id, title, action) {
        const b = document.createElement("button");
        b.id = id;
        b.type = "button";
        b.className = "zen-app-btn zentral-hybrid-control";
        b.title = title;
        b.setAttribute("aria-label", title);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          action(e);
        });
        ownedNodes.add(b);
        return b;
      }
      const icons = {
        detach:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="7" width="14" height="14" rx="2"/><path d="M9 3h12v12M21 3L10 14"/></svg>',
        mobile:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/></svg>',
        save: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 3h13l4 4v14H3V3zM7 3v7h10V3M7 21v-8h10v8"/></svg>',
      };
      function setIcon(b, name) {
        if (!b.firstChild) b.appendChild(ctx.parseSVG(icons[name]));
      }
      function syncControls() {
        if (destroyed) return;
        const root = document.getElementById("zen-app-panel-root");
        pill = document.getElementById("zen-app-panel-pill");
        if (pill !== observedPill) {
          pillObserver?.disconnect();
          observedPill = pill;
          if (pill) {
            pillObserver = new MutationObserver(schedule);
            pillObserver.observe(pill, { childList: true, subtree: true });
          }
        }
        if (pill) {
          // These initializers must tolerate the split layout and late UI creation.
          ctx.ensurePillDualViewButton?.();
          ctx.ensurePillAllSidesResizeButton?.();
          // Explicit Attach/Detach uses the same geometry/pin transition owner.
          // UA remains in the existing RMB menu; Save stays on the URL bars.
          for (const id of ["zentral-mobile-btn", "zentral-save-url-btn"])
            document.getElementById(id)?.remove();
          document.getElementById("zentral-detach-btn")?.remove();
          // The existing all-sides control is the ONE move/resize button.
          // Its click retains the original resize toggle, dragging always moves.
          document.getElementById("zentral-move-btn")?.remove();
          const move = document.getElementById("zen-app-all-sides-resize-btn");
          if (move) {
            move.classList.add("zentral-hybrid-move");
            move.title =
              "Move / resize: click to toggle all-side handles; hold to attach / detach panel; drag to move panel";
            move.setAttribute("aria-label", move.title);
          }
          const pin = pill.querySelector(".zen-app-btn[data-pinned]");
          if (pin && primary?.layout.mode === "floating")
            pin.title = "Click: pin / unpin. Hold: toggle Super Pin.";
          const push = document.getElementById("zen-app-dual-view-btn");
          if (push) {
            const unavailable = !!service.isDetached();
            push.classList.toggle("zentral-unavailable", unavailable);
            let marker = push.querySelector(".zentral-disabled-mark");
            if (!marker) {
              marker = document.createElement("span");
              marker.className = "zentral-disabled-mark";
              marker.textContent = "×";
              marker.setAttribute("aria-hidden", "true");
              push.append(marker);
            }
            marker.hidden = !unavailable;
            push.setAttribute("aria-disabled", String(unavailable));
            push.title = unavailable
              ? "Page push is unavailable while detached. Dock the panel first. Hold still toggles Triple View."
              : "Click: toggle webpage push. Hold: toggle Triple View.";
            push.setAttribute("aria-label", push.title);
          }
          stylePill(pill);
        }
        syncToolbar(
          document.getElementById("zen-app-panel-toolbar"),
          ctx.getActiveAppBrowser?.(),
          false,
        );
        const second = ctx.secondarySnapshot?.();
        if (second?.root?.isConnected && second.browser) {
          const bar = second.root.querySelector(".bgalazka-super-bar");
          syncToolbar(bar, second.browser, true);
          bar?.querySelector(".zentral-secondary-detach")?.remove();
        }
        actionsUI?.sync();
      }
      function feedback(button, success) {
        button.setAttribute("data-save-result", success ? "saved" : "failed");
        button.title = success
          ? "Start URL saved"
          : "Could not save: check the app limit or page URL";
        lifecycle.setTimeout(() => {
          button.removeAttribute("data-save-result");
          button.title = "Use current page as app start URL";
        }, 1800);
      }
      function stylePill(node) {
        const split = pref("pill_layout", "upstream") === "upstream";
        let actions = node.querySelector(".zentral-pill-actions"),
          close = node.querySelector(".zentral-pill-close-box");
        if (split && !actions) {
          actions = document.createElement("div");
          actions.className = "zentral-pill-actions";
          close = document.createElement("div");
          close.className = "zentral-pill-close-box";
          ownedNodes.add(actions);
          ownedNodes.add(close);
          for (const child of [...node.children])
            (child.classList.contains("zen-app-close-btn")
              ? close
              : actions
            ).append(child);
          node.append(actions, close);
        } else if (split) {
          for (const child of [...node.children])
            if (child !== actions && child !== close)
              (child.classList.contains("zen-app-close-btn")
                ? close
                : actions
              ).append(child);
        } else if (actions) {
          node.append(...actions.children, ...close.children);
          actions.remove();
          close.remove();
        }
        if (close && node.lastElementChild !== close) node.append(close);
        if (!split) {
          const c = node.querySelector(":scope > .zen-app-close-btn");
          if (c && node.lastElementChild !== c) node.append(c);
        }
        if (close)
          close.hidden = ctx.getPref(ctx.BGALAZKA_EXT_PREFS.HIDE_CLOSE, false);
        node.toggleAttribute("data-upstream-layout", split);
      }
      function syncToolbar(toolbar, browser, secondary) {
        if (!toolbar) return;
        let save = toolbar.querySelector(".zentral-toolbar-save");
        if (!save) {
          save = button("", "Use current page as app start URL", () =>
            feedback(
              save,
              saveURL(
                secondary
                  ? ctx.secondarySnapshot?.()?.browser
                  : ctx.getActiveAppBrowser(),
                secondary,
              ),
            ),
          );
          save.classList.add("zentral-toolbar-save", "zen-toolbar-btn");
          setIcon(save, "save");
          toolbar.append(save);
        }
        save.hidden = false;
        save.disabled = !math.validStartURL(browser?.currentURI?.spec);
        const close = toolbar.querySelector(
          secondary ? ".bgalazka-second-close" : ".zentral-toolbar-close",
        );
        if (close && close !== toolbar.lastElementChild) toolbar.append(close);
        if (close && save.nextElementSibling !== close)
          toolbar.insertBefore(save, close);
        const reload = toolbar.querySelector(
          secondary ? ".zentral-secondary-reload" : ".zen-toolbar-reload-btn",
        );
        if (reload) {
          const loading = !!browser?.webProgress?.isLoadingDocument;
          reload.title = loading ? "Stop loading" : "Reload";
          reload.setAttribute("aria-label", reload.title);
          reload.setAttribute("data-loading", String(loading));
        }
      }
      // Existing top-level progress listeners signal this hook. No duplicate
      // progress listener and no permanent URL-bar polling are installed here.
      lifecycle.own(bridge.on("navigation", schedule));
      lifecycle.own(bridge.on("secondary-created", schedule));
      lifecycle.own(
        bridge.on("secondary-closing", ({ root }) => {
          const host = hosts.get(root);
          if (host) {
            persist(host);
            clearHost(host);
          }
          if (gesture?.host === host) endGesture(false);
        }),
      );
      // Capture only toolbar controls; native context-menu routing remains owned
      // by ZentralPanelInput. A loading main tab cannot stop an idle panel.
      lifecycle.listen(
        document,
        "click",
        (event) => {
          if (suppressClick) {
            suppressClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
          const target = event.target.closest?.(
            ".zen-toolbar-reload-btn,.zentral-secondary-reload",
          );
          if (!target) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          reloadOrStop(
            target.closest(".bgalazka-super-bar")
              ? ctx.secondarySnapshot?.()?.browser
              : ctx.getActiveAppBrowser(),
          );
        },
        true,
      );
      lifecycle.listen(
        window,
        "keydown",
        (event) => {
          if (
            !pref("panel_url_shortcut", true) ||
            !(event.ctrlKey || event.metaKey) ||
            event.altKey ||
            event.shiftKey ||
            event.key.toLowerCase() !== "l"
          )
            return;
          const second = ctx.secondarySnapshot?.(),
            focus = document.activeElement;
          const secondary =
            focus === second?.browser || !!second?.root?.contains(focus);
          const inside = secondary || bridge.snapshot().root?.contains(focus);
          if (!inside) return;
          const input = secondary
            ? second.root.querySelector(".bgalazka-second-url")
            : document.querySelector(
                "#zen-app-panel-toolbar .zen-toolbar-urlbar",
              );
          if (
            !input ||
            input.hidden ||
            getComputedStyle(input).display === "none"
          )
            return;
          event.preventDefault();
          event.stopImmediatePropagation();
          input.focus();
          input.select();
        },
        true,
      );
      // Right-click reset is available both on app tiles and on each panel's
      // chrome (without taking over web-content context menus).
      const resetItem = document.createXULElement("menuitem");
      resetItem.id = "zentral-reset-position-item";
      resetItem.setAttribute("label", "Reset position");
      ownedNodes.add(resetItem);
      const tilePopup = document.getElementById(
        "zen-apps-sidebar-tile-context",
      );
      if (tilePopup) {
        tilePopup.append(resetItem);
        lifecycle.listen(tilePopup, "popupshowing", () => {
          resetItem.hidden = !tilePopup.dataset.activeAppId;
        });
        lifecycle.listen(resetItem, "command", () =>
          service.reset(tilePopup.dataset.activeAppId),
        );
      }
      const positionPopup = document.createXULElement("menupopup");
      positionPopup.id = "zentral-panel-position-menu";
      ownedNodes.add(positionPopup);
      const panelReset = document.createXULElement("menuitem");
      panelReset.setAttribute("label", "Reset position");
      positionPopup.append(panelReset);
      (document.getElementById("mainPopupSet") || ui).append(positionPopup);
      let contextHost = null;
      lifecycle.listen(panelReset, "command", () => {
        if (contextHost) service.reset(contextHost.id, contextHost.role);
      });
      lifecycle.listen(document, "contextmenu", (event) => {
        if (
          !event.target.closest?.(
            "#zen-app-panel-pill,#zen-app-panel-toolbar,.bgalazka-super-bar",
          )
        )
          return;
        contextHost =
          hosts.get(event.target.closest("#bgalazka-super-panel")) || primary;
        if (!contextHost) return;
        event.preventDefault();
        event.stopPropagation();
        positionPopup.openPopupAtScreen(event.screenX, event.screenY, true);
      });
      // Drag geometry is committed once per gesture and cancelled on every
      // lifecycle exit. Pointer capture plus a removable shield covers XUL frames.
      const ghost = document.createElement("div");
      ghost.id = "zentral-dock-ghost";
      ownedNodes.add(ghost);
      ui.append(ghost);
      const shield = document.createElement("div");
      shield.id = "zentral-panel-drag-shield";
      ownedNodes.add(shield);
      ui.append(shield);
      function edgeDirection(target, host) {
        const cls = String(target.className || ""),
          explicit = cls.match(
            /bgalazka-resize-(nw|ne|sw|se|n|s|e|w)(?:\s|$)/,
          )?.[1];
        const grabber = target.classList.contains("zen-app-grabber");
        if (!explicit && !/zen-app-resize/.test(cls) && !grabber) return null;
        const box = target.getBoundingClientRect(),
          panel = host.liveRect;
        const horizontal =
          grabber ||
          /inner|outer/.test(cls) ||
          (explicit && /[we]/.test(explicit)) ||
          (!/top|bottom/.test(cls) && !explicit);
        const vertical =
          /top|bottom/.test(cls) || (explicit && /[ns]/.test(explicit));
        const fallback = host.layout.side === "left" ? "e" : "w";
        const x =
          box.width > 0
            ? box.left + box.width / 2 < panel.x + panel.w / 2
              ? "w"
              : "e"
            : explicit?.match(/[we]/)?.[0] ||
              (cls.includes("inner")
                ? fallback === "e"
                  ? "w"
                  : "e"
                : fallback);
        const y =
          box.height > 0
            ? box.top + box.height / 2 < panel.y + panel.h / 2
              ? "n"
              : "s"
            : explicit?.match(/[ns]/)?.[0] || (cls.includes("top") ? "n" : "s");
        return (vertical ? y : "") + (horizontal ? x : "");
      }
      function startGesture(event) {
        if (!enabled() || event.button !== 0) return;
        const target = event.target.closest?.(
          ".zentral-hybrid-move,.zen-toolbar-urlbar-drag-handle,.zen-toolbar-grip,.zen-app-all-sides-resize-btn,.bgalazka-second-grip,[class*='zen-app-resize'],[class*='bgalazka-second-resize'],.zen-app-grabber",
        );
        if (!target) return;
        // Triple View's lower toolbar belongs to the same combined host;
        // Super Pin has its own independently registered host.
        const host =
          hosts.get(target.closest("#bgalazka-super-panel")) ||
          hosts.get(target.closest("#zen-app-panel-root"));
        if (!host) return;
        const root = host.root;
        let dir = edgeDirection(target, host);
        const grabber = target.classList.contains("zen-app-grabber");

        if (
          !dir &&
          !target.matches(
            ".zentral-hybrid-move,.zen-toolbar-urlbar-drag-handle,.zen-toolbar-grip,.zen-app-all-sides-resize-btn,.bgalazka-second-grip",
          )
        )
          return;
        if (
          dir &&
          !grabber &&
          !target.classList.contains("zen-app-resize-strip") &&
          host.role === "primary" &&
          host.layout.mode !== "floating" &&
          !ctx.getPref(ctx.EXT_PREFS.ALL_SIDES_RESIZE, false)
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        endGesture(false);
        host.expanded = false;
        if (host.role === "primary") apps.setPanelExpanded(false);
        apply(host);
        gesture = {
          host,
          target,
          priorPinned: !!bridge.snapshot().pinned,
          pointerId: event.pointerId,
          start: { ...host.liveRect },
          x: event.clientX,
          y: event.clientY,
          dir,
          pillMove: grabber,
          pillOffsetBefore: ctx.getPref(
            ctx.BGALAZKA_EXT_PREFS.PILL_POSITION,
            0,
          ),
          moved: false,
          prior: structuredClone(host.layout),
          snap: null,
        };
        host.lockedPillSide = root.getAttribute("data-pill-side");
        try {
          target.setPointerCapture(event.pointerId);
        } catch (_) {}
        ui.setAttribute("zentral-geometry-dragging", "true");
        ctx.extendHoverResizeHold?.(60000);
      }
      function moveGesture(event) {
        if (!gesture || event.pointerId !== gesture.pointerId) return;
        event.preventDefault();
        const g = gesture,
          dx = event.clientX - g.x,
          dy = event.clientY - g.y;
        if (!g.moved && Math.hypot(dx, dy) < 4) return;
        g.moved = true;
        shield.setAttribute("data-active", "true");
        if (!g.dir && g.prior.mode === "docked" && !g.floatStart) {
          const h = Math.min(g.start.h, area().height * detachedHeight()),
            anchor = Math.max(
              0,
              Math.min(1, (g.y - g.start.y) / Math.max(1, g.start.h)),
            );
          g.floatStart = {
            ...g.start,
            y: g.start.y + (g.start.h - h) * anchor,
            h,
          };
        }
        const moveStart = g.floatStart || g.start;
        const r = g.dir
          ? math.computeResize(
              g.dir,
              g.start,
              dx,
              g.pillMove ? 0 : dy,
              {},
              area(),
              {
                allowOverflow: pref("allow_overflow", false),
                minVisibleMargin: 96,
              },
            )
          : bounded({ ...moveStart, x: moveStart.x + dx, y: moveStart.y + dy });
        g.host.layout.rect = r;
        if (g.pillMove)
          g.host.pillOffset = Math.max(
            -50,
            Math.min(
              50,
              Math.round(
                Number(g.pillOffsetBefore) +
                  (dy / Math.max(1, g.start.h)) * 100,
              ),
            ),
          );

        // A move leaves the edge; resize retains the chosen docking mode.
        if (
          !g.pillMove &&
          (!g.dir ||
            /[ns]/.test(g.dir) ||
            (g.host.layout.mode === "docked" &&
              (g.host.layout.side === "left"
                ? g.dir.includes("w")
                : g.dir.includes("e"))))
        ) {
          if (g.host.layout.mode === "docked")
            g.host.layout.dockedRect = { ...g.start };
          g.host.layout.mode = "floating";
        }
        apply(g.host);
        g.snap = null;
        if (!g.dir && pref("snap_enabled", true)) {
          const slots = {
            left: math.dockRect(
              "left",
              { ...r, y: area().top, h: area().height },
              area(),
              pref("dock_gap", 0),
            ),
            right: math.dockRect(
              "right",
              { ...r, y: area().top, h: area().height },
              area(),
              pref("dock_gap", 0),
            ),
          };
          // Use the proposed, UNCLAMPED panel edge, not cursor proximity.
          // Its width and the pointer's grab offset therefore both count.
          const proposedX = moveStart.x + dx,
            box = area(),
            penetration = Math.max(
              1,
              Math.min(100, Number(pref("dock_push_px", 15)) || 15),
            );
          const left = box.left - proposedX,
            right = proposedX + r.w - (box.left + box.width);
          if (pref("allow_overflow", false)) {
            // Overflow uses the NORMAL safe edge, not the extended clamp limit.
            // A nearby panel edge snaps; moving past the zone retains overflow.
            const dl = Math.abs(left),
              dr = Math.abs(right);
            g.snap =
              Math.min(dl, dr) <= penetration
                ? dl <= dr
                  ? "left"
                  : "right"
                : null;
          } else
            g.snap =
              left >= penetration || right >= penetration
                ? left >= right
                  ? "left"
                  : "right"
                : null;
          if (g.snap) {
            const s = slots[g.snap];
            for (const [k, v] of Object.entries({
              left: s.x + "px",
              top: s.y + "px",
              width: s.w + "px",
              height: s.h + "px",
            }))
              ghost.style.setProperty(k, v);
            ghost.setAttribute("data-active", "true");
          }
        }
        if (g.pillMove) {
          ghost.style.cssText = `left:${g.host.liveRect.x + parseFloat(g.host.root.style.getPropertyValue("--hybrid-pill-inset"))}px;top:${g.host.liveRect.y + parseFloat(g.host.root.style.getPropertyValue("--hybrid-pill-y"))}px;width:40px;height:3px`;
          ghost.setAttribute("data-active", "true");
        } else if (!g.snap) ghost.removeAttribute("data-active");
      }
      function endGesture(commit = true, event = null) {
        if (!gesture) return;
        if (
          event &&
          event.pointerId !== undefined &&
          event.pointerId !== gesture.pointerId
        )
          return;
        const g = gesture;
        gesture = null;
        g.host.lockedPillSide = null;
        if (g.pillMove && commit && g.moved)
          Core.setPref(
            ctx.BGALAZKA_EXT_PREFS.PILL_POSITION,
            g.host.pillOffset ?? g.pillOffsetBefore,
          );
        delete g.host.pillOffset;
        try {
          g.target.releasePointerCapture(g.pointerId);
        } catch (_) {}
        if (g.moved) {
          suppressClick = true;
          lifecycle.setTimeout(() => {
            suppressClick = false;
          }, 0);
        }
        ghost.removeAttribute("data-active");
        shield.removeAttribute("data-active");
        ui.removeAttribute("zentral-geometry-dragging");
        ctx.extendHoverResizeHold?.(250);
        if (!commit || !g.moved) {
          g.host.layout = g.prior;
          if (
            g.host.role === "primary" &&
            bridge.snapshot().pinned !== g.priorPinned
          )
            setPinInternal();
        } else {
          if (g.snap) {
            g.host.layout.mode = "docked";
            g.host.layout.side = g.snap;
            g.host.layout.customSide = true;
            restoreDockedExtent(g.host);
            if (
              g.host.role === "primary" &&
              bridge.snapshot().pinned !== g.host.layout.pinned
            )
              setPinInternal();
          }
          persist(g.host);
        }
        apply(g.host);
        ctx.syncPanelPushState?.();
        ctx.syncHoverPanelAvailability?.();
        syncControls();
      }
      lifecycle.listen(document, "pointerdown", startGesture, true);
      lifecycle.listen(window, "pointermove", moveGesture, true);
      lifecycle.listen(window, "pointerup", (e) => endGesture(true, e), true);
      lifecycle.listen(
        window,
        "pointercancel",
        (e) => endGesture(false, e),
        true,
      );
      lifecycle.listen(window, "blur", () => endGesture(false));
      lifecycle.listen(window, "resize", () => {
        endGesture(false);
        for (const h of hosts.values()) apply(h);
        schedule();
      });
      for (const type of ["zen-workspace-switched", "zen-workspace-changed"])
        lifecycle.listen(window, type, () => {
          endGesture(false);
          for (const h of hosts.values()) persist(h);
          saved = readStore();
          for (const h of [...hosts.values()]) clearHost(h);
          primary = null;
          schedule();
        });
      lifecycle.preference("zen.workspace.bgalazka.hide_", schedule);
      lifecycle.preference("zen.workspace.bgalazka.opposite_docking", () => {
        endGesture(false);
        schedule();
      });
      lifecycle.preference("zen.workspace.apps.sidebar.placement", schedule);
      lifecycle.preference("zen.workspace.bgalazka.pill_position", schedule);
      lifecycle.preference("zen.workspace.bgalazka.mobile_ua_apps", schedule);
      lifecycle.preference(P, (subject, topic, key) => {
        optionCache.delete(key.slice(P.length));
        if (saving || destroyed) return;
        endGesture(false);
        if (key === storeKey) saved = readStore();
        if (
          key === storeKey ||
          key === P + "position_scope" ||
          key === P + "geometry_mode"
        ) {
          for (const host of [...hosts.values()]) clearHost(host);
          primary = null;
          if (!enabled()) apps.positionPanel();
        }
        schedule();
      });
      function cleanup() {
        endGesture(false);
        for (const host of hosts.values()) persist(host);
        const restorePin =
          primary?.layout.mode === "floating" ? primary.layout.pinned : null;
        destroyed = true;
        pillObserver?.disconnect();
        if (pill) {
          const actions = pill.querySelector(".zentral-pill-actions"),
            close = pill.querySelector(".zentral-pill-close-box");
          if (actions)
            pill.append(...actions.children, ...(close?.children || []));
          pill.removeAttribute("data-upstream-layout");
          const pin = pill.querySelector(".zen-app-btn[data-pinned]");
          if (pin) pin.disabled = false;
        }
        for (const host of [...hosts.values()]) clearHost(host);
        for (const node of ownedNodes) node.remove();
        primary = null;
        if (!apps._destroyed) {
          if (restorePin !== null && bridge.snapshot().pinned !== restorePin)
            setPinInternal();
          apps.setPanelExpanded(false);
          apps.positionPanel();
        }
      }
      actionsUI = loader.create("panels/pill-actions", {
        lifecycle,
        Core,
        bridge,
        apps,
        ctx,
        runtime,
        service,
        button,
        setIcon,
      });
      syncPrimary();
      syncSecondary();
      syncControls();
      // Chrome-only additions are recoverable if the base reconstructs its UI.
      const root = bridge.snapshot().root;
      if (root) {
        const observer = new MutationObserver(schedule);
        observer.observe(root, {
          attributes: true,
          attributeFilter: ["open", "closing"],
          childList: true,
        });
        lifecycle.own(() => observer.disconnect());
      }
      return service;
    },
  });
})();
