/* Optional Big Preview input. Uses the existing source-control transport;
 * never synthesizes page keystrokes. Missing module leaves preview/drag intact. */
(function () {
  "use strict";
  window.ZentralModuleLoader.define(
    "video/player-input",
    ({
      Services,
      getBox,
      getPicture,
      isOpen,
      isPeeking,
      isSuppressed,
      getSourceKey,
      control,
      fullscreen,
      close,
    }) => {
      const P = "zen.workspace.zentral.video_preview.",
        listeners = [];
      let clickTimer = null;
      const listen = (node, type, fn, options) => {
        node.addEventListener(type, fn, options);
        listeners.push(() => node.removeEventListener(type, fn, options));
      };
      function cancel() {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      function active() {
        return (
          isOpen() &&
          !isPeeking() &&
          getBox()?.isConnected &&
          document.documentElement?.getAttribute("zentral-insta-peek") !==
            "true"
        );
      }
      function send(action, value) {
        try {
          Promise.resolve(control?.(action, value)).catch(() => {});
        } catch (_) {}
      }
      function toggleCaptions() {
        getBox()?.querySelector(".zentral-video-preview-subs")?.click();
      }
      function focused() {
        const box = getBox();
        return (
          box &&
          (document.activeElement === box ||
            box.contains(document.activeElement))
        );
      }
      const textTarget = (node) =>
        !!node?.isContentEditable ||
        !!node?.closest?.(
          'textarea,select,input:not([type="range"]),[contenteditable]:not([contenteditable="false"]),[role="textbox"]',
        );
      function keydown(event) {
        if (
          !active() ||
          !focused() ||
          event.defaultPrevented ||
          event.isComposing ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          textTarget(event.target) ||
          !Services.prefs.getBoolPref(P + "enlarged_keyboard_controls", true)
        )
          return;
        const key = event.key,
          lower = key?.toLowerCase();
        // Native button activation and range navigation keep their own semantics.
        if (
          (event.target?.closest?.('input[type="range"]') &&
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
            ].includes(key)) ||
          ((key === " " || key === "Enter") &&
            event.target?.closest?.("button"))
        )
          return;
        let action,
          value,
          once = false,
          special;
        if (key === " " || lower === "k" || key === "MediaPlayPause") {
          action = "toggle";
          once = true;
        } else if (lower === "m") {
          action = "mute";
          once = true;
        } else if (lower === "f") {
          special = fullscreen;
          once = true;
        } else if (lower === "c") {
          special = toggleCaptions;
          once = true;
        } else if (lower === "i") {
          special = close;
          once = true;
        } else if (lower === "j" || key === "ArrowLeft") {
          action = "seekRelative";
          value = lower === "j" ? -10 : -5;
        } else if (lower === "l" || key === "ArrowRight") {
          action = "seekRelative";
          value = lower === "l" ? 10 : 5;
        } else if (key === "ArrowUp" || key === "ArrowDown") {
          action = "volumeRelative";
          value = key === "ArrowUp" ? 0.05 : -0.05;
        } else if (/^[0-9]$/.test(key || "")) {
          action = "seekFraction";
          value = Number(key) / 10;
        } else if (key === "Home" || key === "End") {
          action = "seekFraction";
          value = key === "Home" ? 0 : 1;
        } else if (key === ">" || key === "<") {
          action = "rateRelative";
          value = key === ">" ? 0.25 : -0.25;
        } else return;
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
        if (once && event.repeat) return;
        if (special) special();
        else send(action, value);
      }
      function click(event) {
        if (
          !active() ||
          event.button !== 0 ||
          event.defaultPrevented ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          event.shiftKey ||
          isSuppressed() ||
          !Services.prefs.getBoolPref(P + "enlarged_click_toggle", true)
        )
          return;
        const target = event.target,
          box = getBox(),
          picture = getPicture();
        if (
          target?.closest?.(
            "button,input,.zentral-video-enlarge-controls,.zentral-video-enlarge-resize,.zentral-video-preview-subtitles",
          )
        )
          return;
        if (target !== box && !picture?.contains(target)) return;
        cancel();
        try {
          box.focus({ preventScroll: true });
        } catch (_) {}
        if (event.detail > 1) return;
        // A complete double-click must return to sidebar without changing playback.
        const delay = Math.max(
          250,
          Math.min(
            1000,
            Services.prefs.getIntPref("ui.mouse.double_click_interval", 500),
          ),
        );
        const source = getSourceKey?.();
        clickTimer = setTimeout(() => {
          clickTimer = null;
          if (active() && !isSuppressed() && source === getSourceKey?.())
            send("toggle");
        }, delay);
      }
      return {
        mount() {
          const box = getBox();
          listen(window, "keydown", keydown, true);
          listen(box, "click", click);
          listen(box, "dblclick", cancel, true);
          listen(box, "pointerdown", cancel, true);
          listen(window, "blur", cancel);
        },
        cancel,
        destroy() {
          cancel();
          for (const off of listeners.splice(0)) off();
        },
      };
    },
  );
})();
