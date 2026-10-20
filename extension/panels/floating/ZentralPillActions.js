/* Extended panel chrome actions. No base state, browser or geometry ownership.
 * Called by the floating owner; all listeners/hooks/nodes share its lifecycle.
 * B001 controls identifies Expand without relying on button order or labels.
 * B015 launcherPolicy is the only interception of the native toolbar fallback. */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "panels/pill-actions",
    ({ lifecycle, Core, bridge, apps, ctx, runtime, service, button }) => {
      const key = "zen.workspace.zentral.compat.keep_launcher_in_sidebar";
      const policy = {
        useToolbar: () => (Core.getPref(key, true) ? false : null),
      };
      bridge.launcherPolicy = policy;
      lifecycle.own(() => {
        if (bridge.launcherPolicy === policy) delete bridge.launcherPolicy;
      });
      const reposition = () => {
        apps.repositionGrid?.();
        runtime.requestSidebarLayout?.();
      };
      lifecycle.preference(key, reposition);
      reposition();
      let pending = null,
        suppressed = null;
      function cancel() {
        if (pending) {
          lifecycle.clearTimeout(pending.timer);
          pending.control.removeAttribute("data-long-press");
        }
        pending = null;
      }
      function kind(node) {
        const control = node?.closest?.(
          "#zen-app-panel-pill .zen-app-btn,.zentral-toolbar-close,.bgalazka-second-close",
        );
        if (!control) return null;
        if (
          control.id === "zen-app-all-sides-resize-btn" ||
          control.classList.contains("zen-app-all-sides-resize-btn")
        )
          return { control, type: "dock" };
        if (
          control.matches(
            ".zen-app-close-btn,.zentral-toolbar-close,.bgalazka-second-close",
          )
        )
          return { control, type: "unload" };
        return null;
      }
      const onDown = (event) => {
        if (pending && pending.control === kind(event.target)?.control) return;
        cancel();
        suppressed = null;
        if (event.button !== 0) return;
        const action = kind(event.target);
        if (!action) return;
        const secondary = !!action.control.closest(".bgalazka-super-bar");
        const ids = secondary
          ? [ctx.secondarySnapshot?.()?.browser?._bgalazkaAppId]
          : [
              ctx.getActiveAppBrowser?.()?._bgalazkaAppId ||
                bridge.snapshot().appId,
              ctx.secondarySnapshot?.()?.browser?._bgalazkaAppId,
            ];
        action.control.setAttribute("data-long-press", "pending");
        pending = {
          ...action,
          x: event.clientX,
          y: event.clientY,
          timer: lifecycle.setTimeout(() => {
            pending = null;
            suppressed = action.control;
            action.control.removeAttribute("data-long-press");
            if (action.type === "dock") service.toggleDock();
            else {
              // Capture identities BEFORE closing Triple/Super View changes their hosts.
              for (const id of new Set(ids.filter(Boolean)))
                try {
                  apps.closeApp(id);
                } catch (error) {
                  console.warn("[Zentral] Panel unload failed", error);
                }
              if (!secondary) apps.closePanel();
            }
          }, 550),
        };
      };
      const onMove = (event) => {
        if (
          pending &&
          Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= 4
        )
          cancel();
      };
      lifecycle.listen(window, "pointerdown", onDown, true);
      lifecycle.listen(window, "mousedown", onDown, true);
      lifecycle.listen(window, "pointermove", onMove, true);
      lifecycle.listen(window, "mousemove", onMove, true);
      for (const name of ["pointerup", "mouseup", "pointercancel", "blur"])
        lifecycle.listen(window, name, cancel, true);
      lifecycle.listen(
        window,
        "click",
        (event) => {
          if (
            suppressed &&
            event.target.closest?.(
              ".zen-app-btn,.zentral-toolbar-close,.bgalazka-second-close",
            ) === suppressed
          ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            suppressed = null;
          }
        },
        true,
      );
      lifecycle.own(cancel);
      return {
        sync() {
          const expand = bridge.snapshot().controls?.expand;
          if (expand) {
            expand.title = bridge.snapshot().expanded
              ? "Restore panel"
              : "Expand panel";
            expand.setAttribute("aria-label", expand.title);
          }
          const move = document.getElementById("zen-app-all-sides-resize-btn");
          if (move) {
            move.title =
              "Move / resize: click to toggle all-side handles; hold to attach / detach panel; drag to move panel";
            move.setAttribute("aria-label", move.title);
          }
          const pill = document.getElementById("zen-app-panel-pill"),
            pillClose = pill?.querySelector(".zen-app-close-btn");
          if (pillClose) {
            pillClose.title =
              "Click: close panel. Hold: close and unload visible panel apps.";
            pillClose.setAttribute("aria-label", pillClose.title);
          }
          for (const bar of [
            document.getElementById("zen-app-panel-toolbar"),
            ctx
              .secondarySnapshot?.()
              ?.root?.querySelector(".bgalazka-super-bar"),
          ]) {
            if (!bar) continue;
            let close = bar.querySelector(
              ".bgalazka-second-close,.zentral-toolbar-close",
            );
            if (close?.classList.contains("zentral-toolbar-close")) {
              close.remove();
              close = null;
            }
            if (!close) continue; // Primary Close belongs only to the pill.
            const save = bar.querySelector(".zentral-toolbar-save");
            if (save && save.nextElementSibling !== close)
              bar.insertBefore(save, close);
            if (bar.lastElementChild !== close) bar.append(close);
          }
        },
      };
    },
  );
})();
