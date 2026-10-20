/* Temporary enlarged view of the EXISTING preview; no second stream.
 * Sidebar owns mount/sync/destroy; Scheduling.stop calls closeEnlarged.
 * Normal sidebar size is independent. Saved size describes the video area;
 * saved position describes the whole card. Fullscreen is transient.
 * Top layer escapes compact transforms. Supported atomic whole-card moves
 * escape display:none ancestors without rebuilding live browsers (Gecko149+).
 */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "video/enlarge",
    ({ Services, onLayout, onReturn }) => {
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
      let opened = false,
        destroyed = false,
        fullscreen = false,
        ownedFullscreen = false,
        createdBar = false,
        suppressUntil = 0;
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
      function apply() {
        if (!opened) return;
        rect = bounds(rect);
        const visible = fullscreen
          ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
          : rect;
        for (const [k, v] of Object.entries(visible))
          box.style.setProperty("--zentral-enlarge-" + k, v + "px");
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
      function finish(event) {
        if (
          !drag ||
          (event?.pointerId !== undefined && event.pointerId !== drag.id)
        )
          return;
        const previous = drag;
        drag = null;
        try {
          previous.target.releasePointerCapture(previous.id);
        } catch (_) {}
        if (!previous.moved) return;
        suppressUntil = Date.now() + 250;
        if (event?.type === "pointercancel" || event?.type === "blur") {
          rect = previous.start;
          apply();
        } else save();
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
      function close() {
        if (!opened) return;
        finish({ type: "pointercancel" });
        exitFullscreen();
        opened = false;
        try {
          box.hidePopover();
        } catch (_) {}
        box.removeAttribute("popover");
        box.removeAttribute("data-enlarged");
        box.removeAttribute("data-source-menu");
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
          if (Number.isFinite(p.x) && Number.isFinite(p.y)) position = p;
        } catch (_) {}
        let w = Services.prefs.getIntPref(P + "enlarged_width", 1280),
          h = Services.prefs.getIntPref(P + "enlarged_height", 720);
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
        box.setAttribute("popover", "manual");
        box.setAttribute("data-enlarged", "true");
        opened = true;
        rect = bounds({ x: 0, y: 0, w: w + trim.w, h: h + trim.h });
        apply();
        try {
          box.showPopover();
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
            (window.innerHeight - gap * 2 - trim.h) / Math.max(1, h),
          );
        const size = bounds({
          x: 0,
          y: 0,
          w: Math.max(1, w * scale) + trim.w,
          h: Math.max(1, h * scale) + trim.h,
        });
        const right =
          root.getAttribute("zen-right-side") === "true" ||
          root.getAttribute("zen-sidebar-right") === "true" ||
          Services.prefs.getBoolPref("zen.tabs.vertical.right-side", false);
        rect = bounds({
          ...size,
          x: position?.x ?? (right ? window.innerWidth - size.w - gap : gap),
          y: position?.y ?? window.innerHeight - size.h - gap,
        });
        apply();
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
        return { x: left, y: top, w: right - left, h: bottom - top };
      }
      const down = (edge) => (event) => {
        if (
          !opened ||
          fullscreen ||
          event.button !== 0 ||
          event.target.closest("button")
        )
          return;
        drag = {
          id: event.pointerId,
          target: event.currentTarget,
          edge,
          x: event.clientX,
          y: event.clientY,
          start: { ...rect },
          moved: false,
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch (_) {}
        // Keep ordinary click/double-click delivery intact until movement is real.
      };
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
          listen(hit, "dblclick", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (Date.now() >= suppressUntil) toggle();
          });
          listen(hit, "pointerdown", down(""));
          bar = box.querySelector(".zentral-video-preview-bar");
          if (!bar) {
            bar = document.createElement("div");
            bar.className = "zentral-video-preview-bar";
            box.append(bar);
            createdBar = true;
          }
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
            listen(handle, "pointerdown", down(edge));
          }
          listen(
            window,
            "pointermove",
            (event) => {
              if (!drag || event.pointerId !== drag.id) return;
              const dx = event.clientX - drag.x,
                dy = event.clientY - drag.y;
              if (!drag.moved && Math.hypot(dx, dy) < 4) return;
              drag.moved = true;
              event.preventDefault();
              rect = drag.edge
                ? resize(drag.start, drag.edge, dx, dy)
                : bounds({
                    ...drag.start,
                    x: drag.start.x + dx,
                    y: drag.start.y + dy,
                  });
              apply();
            },
            true,
          );
          for (const type of ["pointerup", "pointercancel", "blur"])
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
          listen(window, "resize", () => {
            if (opened) apply();
          });
          listen(window, "sizemodechange", () => {
            if (fullscreen && !window.fullScreen) exitFullscreen();
            else if (opened) apply();
          });
        },
        sync() {
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
        destroy() {
          destroyed = true;
          close();
          for (const off of listeners.splice(0)) off();
          hit?.remove();
          back?.remove();
          full?.remove();
          for (const handle of handles) handle.remove();
          if (createdBar) bar?.remove();
        },
      };
    },
  );
})();
