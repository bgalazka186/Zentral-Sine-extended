/* Temporary enlarged view of the EXISTING preview; no second stream.
 * Sidebar owns mount/sync/destroy; Scheduling.stop calls closeEnlarged.
 * Normal sidebar size is independent. Saved size describes the video area;
 * saved position describes the whole card. Fullscreen is transient.
 * Top layer escapes compact transforms. Supported atomic whole-card moves
 * escape display:none ancestors without rebuilding live browsers (Gecko149+).
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.load(
    "additional/video/controllers/ZentralVideoPlayerInput.js",
    { owner: "video", optional: true },
  );
  window.ZentralModuleLoader.define(
    "video/enlarge",
    ({
      Services,
      onLayout,
      onReturn,
      getRatio,
      canOpen,
      onControls,
      onWindowResize,
      control,
      getSourceKey,
    }) => {
      const P = "zen.workspace.zentral.video_preview.",
        listeners = [],
        handles = [];
      let box = null,
        picture = null,
        bar = null,
        hit = null,
        back = null,
        full = null,
        drag = null,
        rect = null,
        home = null;
      let peeking = false,
        peekShortcut = "";
      let resizeTick = null,
        resizeSettle = null;
      let applied = null,
        gestureTick = null,
        pendingRect = null;
      let opened = false,
        destroyed = false,
        fullscreen = false,
        ownedFullscreen = false,
        createdBar = false,
        controls = null,
        seek = null,
        suppressUntil = 0;
      let playerInput = window.ZentralModuleLoader.create(
        "video/player-input",
        {
          Services,
          getBox: () => box,
          getPicture: () => picture,
          isOpen: () => opened,
          isPeeking: () => peeking,
          isSuppressed: () => !!drag?.moved || Date.now() < suppressUntil,
          control,
          getSourceKey,
          fullscreen: toggleFullscreen,
          close,
        },
        { optional: true },
      );
      let trim = { w: 10, h: 45 };
      const listen = (node, type, fn, options) => {
        node.addEventListener(type, fn, options);
        listeners.push(() => node.removeEventListener(type, fn, options));
      };
      const clamp = (n, a, b) => Math.max(a, Math.min(Math.max(a, b), n));
      const inset = () =>
        Math.min(12, window.innerWidth / 4, window.innerHeight / 4);
      function bounds(r) {
        const gap = inset(),
          maxW = Math.max(1, window.innerWidth - gap * 2),
          maxH = Math.max(1, window.innerHeight - gap * 2);
        const w = clamp(Number(r.w) || 1290, Math.min(320, maxW), maxW),
          h = clamp(Number(r.h) || 765, Math.min(220, maxH), maxH);
        return {
          x: clamp(Number(r.x) || 0, gap, window.innerWidth - w - gap),
          y: clamp(Number(r.y) || 0, gap, window.innerHeight - h - gap),
          w,
          h,
        };
      }
      const keepAspect = () =>
        Services.prefs.getBoolPref(P + "enlarged_keep_aspect", true);
      const ratio = () => {
        const value = Number(getRatio?.());
        return Number.isFinite(value) && value > 0
          ? clamp(value, 0.05, 20)
          : 16 / 9;
      };
      // Work in video dimensions; captions, padding and controls are additive trim.
      // Scale uniformly at viewport limits, even when nominal minimums cannot fit.
      function proportional(r, edge = "") {
        if (!keepAspect()) return bounds(r);
        const gap = inset(),
          a = ratio();
        const maxW = Math.max(1, window.innerWidth - gap * 2 - trim.w);
        const maxH = Math.max(1, window.innerHeight - gap * 2 - trim.h);
        const fromHeight = /[ns]/.test(edge) && !/[ew]/.test(edge);
        let w = fromHeight ? (r.h - trim.h) * a : r.w - trim.w;
        const minimum = Math.min(310, maxW, maxH * a);
        w = clamp(w, Math.max(1, minimum), Math.min(maxW, maxH * a));
        const size = { w: w + trim.w, h: w / a + trim.h };
        return {
          x: clamp(
            edge.includes("w") ? r.x + r.w - size.w : r.x,
            gap,
            window.innerWidth - size.w - gap,
          ),
          y: clamp(
            edge.includes("n") ? r.y + r.h - size.h : r.y,
            gap,
            window.innerHeight - size.h - gap,
          ),
          ...size,
        };
      }
      function apply() {
        if (!opened) return;
        rect = keepAspect() ? proportional(rect) : bounds(rect);
        const visible = fullscreen
          ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
          : rect;
        const sizeChanged =
          !applied || applied.w !== visible.w || applied.h !== visible.h;
        for (const [k, v] of Object.entries(visible))
          if (!applied || applied[k] !== v)
            box.style.setProperty("--zentral-enlarge-" + k, v + "px");
        applied = { ...visible };
        // Pure movement and unchanged window bounds need no capture/layout work.
        if (sizeChanged && !box.hasAttribute("data-window-resizing"))
          onLayout?.();
      }
      function save() {
        Services.prefs.setIntPref(
          P + "enlarged_width",
          Math.max(1, Math.round(rect.w - trim.w)),
        );
        Services.prefs.setIntPref(
          P + "enlarged_height",
          Math.max(1, Math.round(rect.h - trim.h)),
        );
        Services.prefs.setStringPref(
          P + "enlarged_position",
          JSON.stringify({
            version: 2,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
          }),
        );
      }
      function flushGesture() {
        clearTimeout(gestureTick);
        gestureTick = null;
        if (!pendingRect) return;
        rect = pendingRect;
        pendingRect = null;
        apply();
      }
      function finish(event) {
        if (
          !drag ||
          (event?.pointerId !== undefined && event.pointerId !== drag.id)
        )
          return;
        const previous = drag;
        const canceled = ["pointercancel", "blur"].includes(event?.type);
        if (canceled) {
          clearTimeout(gestureTick);
          gestureTick = null;
          pendingRect = null;
        } else flushGesture();
        drag = null;
        try {
          previous.target.releasePointerCapture(previous.id);
        } catch (_) {}
        if (!previous.moved) return;
        suppressUntil = Date.now() + 250;
        if (canceled) {
          rect = previous.start;
          apply();
        } else save();
        if (previous.edge) {
          box.removeAttribute("data-window-resizing");
          onWindowResize?.(false);
        }
      }
      function exitFullscreen() {
        if (!fullscreen) return;
        fullscreen = false;
        box.removeAttribute("data-enlarged-fullscreen");
        if (ownedFullscreen) {
          ownedFullscreen = false;
          window.fullScreen = false;
        }
        if (full) {
          full.title = "Fullscreen";
          full.setAttribute("aria-label", full.title);
          full.setAttribute("aria-pressed", "false");
        }
        apply();
      }
      function toggleFullscreen() {
        if (!opened) return;
        if (fullscreen) {
          exitFullscreen();
          return;
        }
        finish({ type: "pointercancel" });
        fullscreen = true;
        ownedFullscreen = !window.fullScreen;
        box.setAttribute("data-enlarged-fullscreen", "true");
        if (ownedFullscreen) window.fullScreen = true;
        full.title = "Exit fullscreen";
        full.setAttribute("aria-label", full.title);
        full.setAttribute("aria-pressed", "true");
        apply();
      }
      function endPeek() {
        if (!peeking) return;
        peeking = false;
        box?.removeAttribute("data-temporary-hidden");
        onLayout?.();
      }
      function shortcutMatches(event, shortcut) {
        const parts = shortcut.split("+").map((x) => x.trim().toUpperCase());
        const primary = parts.pop();
        return (
          !!primary &&
          primary !== "NONE" &&
          event.altKey === parts.includes("ALT") &&
          event.ctrlKey === parts.includes("CTRL") &&
          event.shiftKey === parts.includes("SHIFT") &&
          event.metaKey ===
            parts.some((x) => ["META", "CMD", "WIN"].includes(x)) &&
          ((event.key || "").toUpperCase() === primary ||
            (event.code || "").toUpperCase() === "KEY" + primary ||
            (primary === "SPACE" &&
              [" ", "SPACEBAR"].includes((event.key || "").toUpperCase())) ||
            (event.code || "").toUpperCase() === primary)
        );
      }
      function defaultBottomGap() {
        let gap = clamp(
          Services.prefs.getIntPref(P + "enlarged_bottom_gap_px", 64),
          12,
          240,
        );
        for (const node of document.querySelectorAll(
          "#zen-workspaces-button,#zen-workspaces-button-toolbar,#zen-workspaces-button-container,#zen-sidebar-bottom-buttons",
        )) {
          const r = node.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.top > window.innerHeight * 0.65)
            gap = Math.max(gap, window.innerHeight - r.top + 8);
        }
        return Math.min(gap, window.innerHeight / 3);
      }
      function cancelWindowResize() {
        clearTimeout(resizeTick);
        clearTimeout(resizeSettle);
        resizeTick = resizeSettle = null;
        box?.removeAttribute("data-window-resizing");
      }
      function windowResize() {
        if (!opened) return;
        if (!box.hasAttribute("data-window-resizing")) {
          finish({ type: "pointercancel" });
          box.setAttribute("data-window-resizing", "true");
          onWindowResize?.(true);
        }
        // Keep the receiver's fixed pixel size throughout OS resizing; one
        // final clamp after the quiet period avoids repeated content reflows.
        clearTimeout(resizeSettle);
        resizeSettle = setTimeout(() => {
          cancelWindowResize();
          if (!opened) return;
          apply();
          onWindowResize?.(false);
        }, 160);
      }
      function close() {
        if (!opened) return;
        playerInput?.cancel?.();
        cancelWindowResize();
        finish({ type: "pointercancel" });
        endPeek();
        exitFullscreen();
        opened = false;
        applied = null;
        try {
          box.hidePopover();
        } catch (_) {}
        box.removeAttribute("popover");
        box.removeAttribute("data-enlarged");
        box.removeAttribute("data-source-menu");
        box.removeAttribute("data-hover-controls");
        if (controls) box.append(controls);
        if (box.getAttribute("tabindex") === "-1")
          box.removeAttribute("tabindex");
        box.removeAttribute("data-controls-visible");
        box
          .querySelector('[aria-haspopup="listbox"]')
          ?.setAttribute("aria-expanded", "false");
        if (home) {
          const place = home;
          home = null;
          if (
            place.parent.isConnected &&
            typeof place.parent.moveBefore === "function"
          ) {
            try {
              place.parent.moveBefore(
                box,
                place.next?.parentNode === place.parent ? place.next : null,
              );
            } catch (error) {
              console.warn(
                "[Zentral video] Could not restore preview anchor",
                error,
              );
            }
          }
        }
        for (const key of ["x", "y", "w", "h"])
          box.style.removeProperty("--zentral-enlarge-" + key);
        onLayout?.();
        if (!destroyed) onReturn?.();
      }
      function open() {
        if (
          destroyed ||
          opened ||
          (canOpen && !canOpen()) ||
          !box?.isConnected ||
          box.hidden ||
          picture.hidden ||
          !Services.prefs.getBoolPref(P + "double_click_enlarge", true)
        )
          return;
        if (typeof box.showPopover !== "function") {
          console.warn(
            "[Zentral video] Enlarged preview needs the Popover API",
          );
          return;
        }
        let position = null;
        try {
          const p = JSON.parse(
            Services.prefs.getStringPref(P + "enlarged_position", ""),
          );
          if (
            Services.prefs.getBoolPref(
              P + "enlarged_remember_position",
              false,
            ) &&
            Number.isFinite(p.x) &&
            Number.isFinite(p.y)
          )
            position = p;
        } catch (_) {}
        let w = Services.prefs.getIntPref(P + "enlarged_width", 1280),
          h = Services.prefs.getIntPref(P + "enlarged_height", 720);
        const bottomGap = position ? inset() : defaultBottomGap();
        // Migrate the former untouched 640x420 default; preserve other custom sizes.
        if (!position && w === 640 && h === 420) {
          w = 1280;
          h = 720;
        }
        const root = document.documentElement;
        const atomic =
          Number.parseInt(Services.appinfo?.platformVersion, 10) >= 149 &&
          typeof root.moveBefore === "function" &&
          [...box.querySelectorAll("browser")].every(
            (browser) => typeof browser.connectedMoveCallback === "function",
          );
        if (
          atomic &&
          box.parentNode !== root &&
          typeof box.parentNode?.moveBefore === "function"
        ) {
          const place = { parent: box.parentNode, next: box.nextSibling };
          try {
            root.moveBefore(box, null);
            home = place;
          } catch (error) {
            console.warn(
              "[Zentral video] Atomic preview move unavailable",
              error,
            );
          }
        }
        // Controls contain no browser; moving this small wrapper preserves the receiver.
        if (controls) picture.append(controls);
        box.setAttribute("tabindex", "-1");
        box.setAttribute("popover", "manual");
        box.setAttribute("data-enlarged", "true");
        opened = true;
        syncControls();
        rect = bounds({ x: 0, y: 0, w: w + trim.w, h: h + trim.h });
        apply();
        try {
          box.showPopover();
          // Flush the top-layer placement before accepting the very first gesture.
          // Input is captured on the card, before an embedded browser can focus.
          box.getBoundingClientRect();
        } catch (error) {
          close();
          console.warn("[Zentral video] Could not enlarge preview", error);
          return;
        }
        // Measure only visible popup chrome: source list and sidebar resize grip are
        // hidden here. Then size the VIDEO at 1280x720, scaling down to fit if needed.
        const outer = box.getBoundingClientRect?.(),
          image = picture.getBoundingClientRect?.();
        if (outer?.width > 0 && image?.width > 0 && image.height > 0) {
          trim = {
            w: Math.max(0, outer.width - image.width),
            h: Math.max(0, outer.height - image.height),
          };
        }
        const gap = inset(),
          scale = Math.min(
            1,
            (window.innerWidth - gap * 2 - trim.w) / Math.max(1, w),
            (window.innerHeight - gap - bottomGap - trim.h) / Math.max(1, h),
          );
        const size = bounds({
          x: 0,
          y: 0,
          w: Math.max(1, w * scale) + trim.w,
          h: Math.max(1, h * scale) + trim.h,
        });
        const right =
          (root.hasAttribute("zen-right-side") &&
            root.getAttribute("zen-right-side") !== "false") ||
          (root.hasAttribute("zen-sidebar-right") &&
            root.getAttribute("zen-sidebar-right") !== "false") ||
          Services.prefs.getBoolPref("zen.tabs.vertical.right-side", false);
        rect = bounds({
          ...size,
          x: position?.x ?? (right ? window.innerWidth - size.w - gap : gap),
          y: position?.y ?? window.innerHeight - size.h - bottomGap,
        });
        apply();
        // Establish chrome focus before the first press, without shifting the page.
        try {
          box.focus({ preventScroll: true });
        } catch (_) {}
      }
      function toggle() {
        opened ? close() : open();
      }
      function resize(start, edge, dx, dy) {
        const gap = inset(),
          minW = Math.min(320, window.innerWidth - gap * 2),
          minH = Math.min(220, window.innerHeight - gap * 2);
        let left = start.x,
          right = start.x + start.w,
          top = start.y,
          bottom = start.y + start.h;
        if (edge.includes("w")) left = clamp(left + dx, gap, right - minW);
        if (edge.includes("e"))
          right = clamp(right + dx, left + minW, window.innerWidth - gap);
        if (edge.includes("n")) top = clamp(top + dy, gap, bottom - minH);
        if (edge.includes("s"))
          bottom = clamp(bottom + dy, top + minH, window.innerHeight - gap);
        return proportional(
          { x: left, y: top, w: right - left, h: bottom - top },
          edge,
        );
      }
      const down = (edge) => (event) => {
        if (
          !opened ||
          fullscreen ||
          event.button !== 0 ||
          event.target.closest("button")
        )
          return;
        finish({ type: "pointercancel" });
        // Preserve click/dblclick targeting. Capture only once movement is real.
        if (edge) event.preventDefault();
        drag = {
          id: event.pointerId,
          target: event.target,
          edge,
          x: event.clientX,
          y: event.clientY,
          start: { ...rect },
          moved: false,
        };
        // Pointermove/up are observed at the window capture phase until capture.
        // This also leaves ordinary focus and double-click delivery intact.
      };
      function syncControls() {
        box.toggleAttribute(
          "data-hover-controls",
          Services.prefs.getBoolPref(P + "enlarged_hover_controls", true),
        );
      }
      return {
        mount(card, image) {
          if (box || destroyed) return;
          box = card;
          picture = image;
          hit = document.createElement("div");
          hit.className = "zentral-video-enlarge-hit";
          hit.title =
            "Double-click to enlarge / return; drag anywhere on enlarged video to move";
          hit.setAttribute("aria-hidden", "true");
          picture.append(hit);
          listen(
            box,
            "dblclick",
            (event) => {
              if (
                event.target.closest?.(
                  "button,input,.zentral-video-enlarge-controls,.zentral-video-enlarge-resize",
                )
              )
                return;
              if (
                !opened &&
                event.target !== hit &&
                !picture.contains(event.target)
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              if (Date.now() >= suppressUntil) toggle();
            },
            true,
          );
          // One delegated capture handler also handles native browser retargeting.
          listen(
            box,
            "pointerdown",
            (event) => {
              const handle = event.target.closest?.(
                ".zentral-video-enlarge-resize",
              );
              if (handle) down(handle.dataset.edge)(event);
              else if (opened && event.target === box) {
                // If a top-layer press is retargeted to the popover itself,
                // preserve that first gesture, including its border grips.
                const x = event.clientX - rect.x,
                  y = event.clientY - rect.y;
                const edge =
                  (y < 7 ? "n" : y > rect.h - 7 ? "s" : "") +
                  (x < 7 ? "w" : x > rect.w - 7 ? "e" : "");
                down(edge)(event);
              } else if (
                event.target === hit ||
                event.target === picture ||
                event.target.closest?.(".zentral-video-preview-player,canvas")
              )
                down("")(event);
            },
            true,
          );
          listen(box, "pointermove", (event) => {
            if (!opened) return;
            const bottom =
              (fullscreen ? window.innerHeight : rect.y + rect.h) - trim.h + 4;
            const visible = event.clientY >= bottom - 100;
            if (visible !== box.hasAttribute("data-controls-visible")) {
              box.toggleAttribute("data-controls-visible", visible);
              onControls?.();
            }
          });
          listen(box, "pointerleave", () =>
            box.removeAttribute("data-controls-visible"),
          );
          bar = box.querySelector(".zentral-video-preview-bar");
          if (!bar) {
            bar = document.createElement("div");
            bar.className = "zentral-video-preview-bar";
            box.append(bar);
            createdBar = true;
          }
          seek = box.querySelector(".zentral-video-preview-seek");
          controls = document.createElement("div");
          controls.className = "zentral-video-enlarge-controls";
          if (seek) controls.append(seek);
          controls.append(bar);
          box.append(controls);
          const button = (className, title, path, action) => {
            const node = document.createElement("button");
            node.type = "button";
            node.className = className;
            node.title = title;
            node.setAttribute("aria-label", title);
            node.innerHTML =
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="' +
              path +
              '"/></svg>';
            bar.append(node);
            listen(node, "click", action);
            return node;
          };
          back = button(
            "zentral-video-enlarge-back",
            "Return to sidebar (Escape or double-click video)",
            "M19 5 5 19M5 9v10h10",
            close,
          );
          full = button(
            "zentral-video-enlarge-fullscreen",
            "Fullscreen",
            "M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6",
            toggleFullscreen,
          );
          for (const edge of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
            const handle = document.createElement("div");
            handle.className = "zentral-video-enlarge-resize";
            handle.dataset.edge = edge;
            handle.title = "Drag to resize enlarged video";
            box.append(handle);
            handles.push(handle);
          }
          listen(
            window,
            "pointermove",
            (event) => {
              if (!drag || event.pointerId !== drag.id) return;
              const dx = event.clientX - drag.x,
                dy = event.clientY - drag.y;
              if (!drag.moved && Math.hypot(dx, dy) < 4) return;
              if (!drag.moved) {
                drag.moved = true;
                try {
                  drag.target.setPointerCapture(drag.id);
                } catch (_) {}
                if (drag.edge) {
                  box.setAttribute("data-window-resizing", "true");
                  onWindowResize?.(true);
                }
              }
              event.preventDefault();
              pendingRect = drag.edge
                ? resize(drag.start, drag.edge, dx, dy)
                : bounds({
                    ...drag.start,
                    x: drag.start.x + dx,
                    y: drag.start.y + dy,
                  });
              if (gestureTick === null)
                gestureTick = setTimeout(flushGesture, 32);
            },
            true,
          );
          for (const type of [
            "pointerup",
            "pointercancel",
            "lostpointercapture",
            "blur",
          ])
            listen(window, type, finish, true);
          listen(
            window,
            "keydown",
            (event) => {
              if (opened && event.key === "Escape") {
                event.preventDefault();
                event.stopImmediatePropagation();
                fullscreen ? exitFullscreen() : close();
              }
            },
            true,
          );
          // Uses the existing configurable Insta Peek chord; works without Apps.
          // Do not stop propagation: the normal panel owner handles its own state.
          listen(
            window,
            "keydown",
            (event) => {
              if (!opened) return;
              const shortcut = Services.prefs.getStringPref(
                "zen.workspace.apps.insta_peek.shortcut",
                "Alt+Q",
              );
              if (!shortcutMatches(event, shortcut)) return;
              event.preventDefault();
              if (peeking) return;
              finish({ type: "pointercancel" });
              peeking = true;
              peekShortcut = shortcut;
              box.setAttribute("data-temporary-hidden", "true");
              onLayout?.();
            },
            true,
          );
          listen(
            window,
            "keyup",
            (event) => {
              if (peeking && shortcutMatches(event, peekShortcut)) endPeek();
              else if (
                peeking &&
                !shortcutMatches(
                  {
                    ...event,
                    key: peekShortcut.split("+").at(-1),
                    code: "",
                    altKey: event.altKey,
                    ctrlKey: event.ctrlKey,
                    shiftKey: event.shiftKey,
                    metaKey: event.metaKey,
                  },
                  peekShortcut,
                )
              )
                endPeek();
            },
            true,
          );
          try {
            playerInput?.mount?.();
          } catch (error) {
            try {
              playerInput?.destroy?.();
            } catch (_) {}
            playerInput = null;
            window.ZentralModuleLoader.fail?.(
              "additional/video/controllers/ZentralVideoPlayerInput.js",
              error,
              "mount",
            );
            console.warn(
              "[Zentral video] Optional player input unavailable",
              error,
            );
          }
          listen(window, "blur", endPeek);
          listen(window, "resize", windowResize);
          listen(window, "sizemodechange", () => {
            if (fullscreen && !window.fullScreen) exitFullscreen();
            else if (opened) windowResize();
          });
        },
        sync() {
          if (opened && !box.hasAttribute("data-window-resizing")) {
            syncControls();
            const outer = box.getBoundingClientRect(),
              image = picture.getBoundingClientRect();
            if (
              !fullscreen &&
              outer.width > 0 &&
              image.width > 0 &&
              image.height > 0
            ) {
              const next = {
                w: Math.max(0, outer.width - image.width),
                h: Math.max(0, outer.height - image.height),
              };
              if (
                Math.abs(next.h - trim.h) > 0.5 ||
                Math.abs(next.w - trim.w) > 0.5
              ) {
                rect.w += next.w - trim.w;
                rect.h += next.h - trim.h;
                trim = next;
                apply();
              } else if (keepAspect()) apply();
            }
          }
          if (
            opened &&
            (box.hidden ||
              picture.hidden ||
              !Services.prefs.getBoolPref(P + "double_click_enlarge", true))
          )
            close();
          if (hit)
            hit.hidden = !Services.prefs.getBoolPref(
              P + "double_click_enlarge",
              true,
            );
        },
        toggle,
        close,
        toggleFullscreen,
        isOpen: () => opened,
        isPeeking: () => peeking,
        destroy() {
          destroyed = true;
          close();
          playerInput?.destroy?.();
          for (const off of listeners.splice(0)) off();
          hit?.remove();
          back?.remove();
          full?.remove();
          for (const handle of handles) handle.remove();
          if (controls) {
            if (seek) box.append(seek);
            box.append(bar);
            controls.remove();
          }
          if (createdBar) bar?.remove();
        },
      };
    },
  );
})();
