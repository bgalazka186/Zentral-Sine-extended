/* Experimental native Library layout. Activated by the shared native startup
 * barrier; no private Zen imports, prototype patches, polling or native prefs.
 * Disabled: only our preference observer remains. Enabled: observe Library's
 * own animation/style and border-box sizes, coalescing work to one frame.
 */
(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const PREF = "zen.workspace.zentral.experimental.library_resize";
  const ATTR = "zentral-library-resize-active";
  const VARS = [
    "--zentral-library-space-left",
    "--zentral-library-space-right",
    "--zentral-library-padding-left",
    "--zentral-library-padding-right",
    "--zentral-library-top",
    "--zentral-library-side-inset",
  ];
  function start() {
    const root = document.documentElement;
    let disposed = false,
      enabled = false,
      frame = null,
      library = null;
    let tabbox = null,
      style = null,
      observer = null,
      sizes = null,
      discovery = null;
    let bound = false,
      active = false,
      baseLeft = 0,
      baseRight = 0;
    let headers = [],
      sidebar = null,
      dismissing = false,
      discoveryHost = null;
    const layoutEvents = [
      "resize",
      "ZenCompactMode:LayoutUpdate",
      "activate",
      "aftercustomization",
    ];
    function onLibraryCommand(event) {
      const target = event.target;
      if (
        target?.id === "cmd_zenToggleLibrary" ||
        target?.id === "zen-library-button" ||
        target?.getAttribute?.("command") === "cmd_zenToggleLibrary"
      )
        schedule();
    }
    const HEADER_IDS = [
      "zen-appcontent-navbar-wrapper",
      "nav-bar",
      "toolbar-menubar",
      "zen-sidebar-top-buttons",
    ];
    function number(key, fallback, min, max) {
      return Math.max(
        min,
        Math.min(max, Services.prefs.getIntPref(PREF + key, fallback)),
      );
    }
    function set(name, value) {
      if (root.style.getPropertyValue(name) !== value)
        root.style.setProperty(name, value);
    }
    function clear() {
      active = false;
      setDismissListeners(false);
      root.removeAttribute(ATTR);
      root.removeAttribute("zentral-library-sidebar-visible");
      for (const name of VARS) root.style.removeProperty(name);
    }
    function closeNativeLibrary() {
      if (!active || !library?.isConnected) return false;
      const api = library.constructor;
      // Use the existing instance's public close path; no native imports or
      // toggling commands that could accidentally reopen Library.
      if (typeof api?.close !== "function") return false;
      api.close();
      return true;
    }
    function onOutsideClick(event) {
      if (!active || event.defaultPrevented) return;
      const path = event.composedPath?.() || [event.target];
      if (
        path.some(
          (node) =>
            node === library ||
            [
              "navigator-toolbox",
              "sidebar-box",
              "PersonalToolbar",
              "nav-bar",
              "zen-library-button",
            ].includes(node?.id) ||
            ["menupopup", "panel", "panel-list"].includes(node?.localName) ||
            node?.getAttribute?.("command") === "cmd_zenToggleLibrary" ||
            (typeof node?.id === "string" && node.id.includes("sine")),
        )
      )
        return;
      if (library.contains?.(event.target)) return;
      closeNativeLibrary();
    }
    function onEscape(event) {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented)
        return;
      const path = event.composedPath?.() || [event.target];
      // Native Library owns Escape within its contents, including editing and
      // section search. Its new opening-focus path must get the key first.
      if (
        path.some(
          (node) =>
            node === library ||
            ["menupopup", "panel", "panel-list"].includes(node?.localName),
        )
      )
        return;
      if (closeNativeLibrary()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    function setDismissListeners(value) {
      if (dismissing === value) return;
      dismissing = value;
      if (value) {
        window.addEventListener("mousedown", onOutsideClick);
        window.addEventListener("keydown", onEscape, true);
      } else {
        window.removeEventListener("mousedown", onOutsideClick);
        window.removeEventListener("keydown", onEscape, true);
      }
    }
    function schedule() {
      if (!enabled || disposed || frame !== null) return;
      frame = window.requestAnimationFrame(update);
    }
    function bind() {
      const next = document.querySelector("zen-library");
      const nextHost = document.getElementById("zen-main-app-wrapper");
      const nextTabbox = document.getElementById("tabbrowser-tabbox");
      const nextSidebar = document.getElementById("navigator-toolbox");
      const nextHeaders = HEADER_IDS.map((id) =>
        document.getElementById(id),
      ).filter(Boolean);
      if (
        bound &&
        nextHost === discoveryHost &&
        next === library &&
        nextTabbox === tabbox &&
        nextSidebar === sidebar &&
        nextHeaders.length === headers.length &&
        nextHeaders.every((node, i) => node === headers[i])
      )
        return;
      bound = true;
      discoveryHost = nextHost;
      headers = nextHeaders;
      sidebar = nextSidebar;
      observer?.disconnect();
      sizes?.disconnect();
      discovery?.disconnect();
      clear();
      library = next;
      tabbox = nextTabbox;
      // Native Library is normally present before shared startup completes.
      // Shallow parent observation also handles late creation/replacement.
      const parents = new Set([
        library?.parentNode,
        tabbox?.parentNode,
        sidebar?.parentNode,
        discoveryHost,
        document.body,
        root,
      ]);
      for (const parent of parents)
        if (parent) discovery.observe(parent, { childList: true });
      if (!library || !tabbox) return;
      observer.observe(library, {
        attributes: true,
        attributeFilter: ["open", "style", "hidden"],
      });
      observer.observe(root, {
        attributes: true,
        attributeFilter: [
          "zen-right-side",
          "zen-sidebar-right",
          "zen-sidebar-expanded",
          "zen-single-toolbar",
          "zen-compact-mode",
          "sizemode",
          "inFullscreen",
        ],
      });
      if (sidebar) {
        observer.observe(sidebar, {
          attributes: true,
          attributeFilter: [
            "zen-has-hover",
            "zen-compact-mode-active",
            "has-popup-menu",
            "flash-popup",
            "zen-user-show",
            "hidden",
          ],
        });
        sizes.observe(sidebar, { box: "border-box" });
      }
      sizes.observe(library, { box: "border-box" });
      sizes.observe(tabbox, { box: "border-box" });
      for (const header of headers)
        sizes.observe(header, { box: "border-box" });
    }
    function update() {
      frame = null;
      if (!enabled || disposed) return;
      bind();
      if (!library?.isConnected || !tabbox?.isConnected) {
        clear();
        return;
      }
      const progress = Number(library.openProgress);
      const animate = Services.prefs.getBoolPref(
        PREF + ".animate_content",
        false,
      );
      const showing =
        !library.hidden &&
        (library.hasAttribute("open") ||
          (Number.isFinite(progress) && progress > 0.001));
      if (!showing) {
        clear();
        return;
      }
      if (!active) {
        const computed = window.getComputedStyle(tabbox);
        baseLeft = parseFloat(computed.paddingLeft) || 0;
        baseRight = parseFloat(computed.paddingRight) || 0;
        set(VARS[2], baseLeft + "px");
        set(VARS[3], baseRight + "px");
        root.setAttribute(ATTR, "true");
        active = true;
        setDismissListeners(true);
      }
      const box = tabbox.getBoundingClientRect();
      const host = (
        library.offsetParent || library.parentNode
      )?.getBoundingClientRect?.();
      const right =
        root.getAttribute("zen-right-side") === "true" ||
        root.getAttribute("zen-sidebar-right") === "true";
      const canHideSidebar =
        root.getAttribute("zen-compact-mode") === "true" &&
        (window.gZenCompactModeManager?.canHideSidebar ?? true);
      const sidebarVisible =
        !!sidebar &&
        !sidebar.hidden &&
        (!canHideSidebar ||
          [
            "zen-has-hover",
            "zen-compact-mode-active",
            "has-popup-menu",
            "flash-popup",
            "zen-user-show",
          ].some((attribute) => sidebar.hasAttribute(attribute)));
      // Cancel Library's toolbox animation only for a genuinely visible
      // sidebar; never force a hidden compact sidebar back onto the screen.
      if (sidebarVisible)
        root.setAttribute("zentral-library-sidebar-visible", "true");
      else root.removeAttribute("zentral-library-sidebar-visible");
      if (host) {
        const sideRect = sidebarVisible
          ? sidebar.getBoundingClientRect()
          : null;
        // Use untransformed width, so a hover/spring animation cannot leave a
        // partly measured inset. Native sidebar visibility events drive updates.
        const sideWidth =
          sideRect && sideRect.height > 0
            ? sidebar.offsetWidth || sideRect.width
            : 0;
        const inset = Math.max(0, Math.min(host.width - 1, sideWidth));
        set(VARS[5], Math.round(inset) + "px");
        const paneWidth = Math.min(
          library.getBoundingClientRect().width,
          host.width - inset,
        );
        const paneLeft = right
          ? host.right - inset - paneWidth
          : host.left + inset;
        const paneRight = paneLeft + paneWidth;
        // Avoid whole TabsToolbar/titlebar containers: in vertical layouts
        // they can include folders/tabs. Count only actual intersecting rows.
        let top = host.top;
        for (const header of headers) {
          const rect = header.getBoundingClientRect();
          if (
            !header.hidden &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.width >= rect.height &&
            rect.bottom > host.top &&
            rect.top < host.top + host.height / 2 &&
            rect.right > paneLeft &&
            rect.left < paneRight
          )
            top = Math.max(top, rect.bottom);
        }
        set(
          VARS[4],
          Math.round(Math.max(0, Math.min(host.height - 1, top - host.top))) +
            "px",
        );
      }
      if (
        Services.prefs.getStringPref(PREF + ".mode", "resize") === "overlay"
      ) {
        set(VARS[0], "0px");
        set(VARS[1], "0px");
        return;
      }
      // Native transform is suppressed by our scoped rule. Padding reserves
      // space inside the tabbox, preserving independent panel-push margins.
      const pane = library.getBoundingClientRect();
      // Undo only Library's native slide when reserving full width once.
      // The native getter exposes progress; no private API or style parsing.
      const slide =
        !animate && Number.isFinite(progress) ? pane.width * (1 - progress) : 0;
      const overlap = Math.max(
        0,
        right ? box.right - (pane.left - slide) : pane.right + slide - box.left,
      );
      const minimum = number(".minimum_content_width_px", 200, 0, 1000);
      const available = Math.max(0, box.width - baseLeft - baseRight - minimum);
      const reserve = Math.round(Math.min(available, overlap));
      set(VARS[0], (right ? 0 : reserve) + "px");
      set(VARS[1], (right ? reserve : 0) + "px");
    }
    function stop() {
      enabled = false;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      observer?.disconnect();
      sizes?.disconnect();
      discovery?.disconnect();
      observer = sizes = discovery = null;
      library = tabbox = sidebar = discoveryHost = null;
      headers = [];
      bound = false;
      clear();
      style?.remove();
      style = null;
      for (const type of layoutEvents)
        window.removeEventListener(type, schedule);
      window.removeEventListener("command", onLibraryCommand, true);
    }
    function sync() {
      if (disposed) return;
      if (!Services.prefs.getBoolPref(PREF, false)) {
        stop();
        return;
      }
      if (!enabled) {
        enabled = true;
        observer = new MutationObserver((records) => {
          if (
            (Services.prefs.getStringPref(PREF + ".mode", "resize") !==
              "overlay" &&
              Services.prefs.getBoolPref(PREF + ".animate_content", false)) ||
            records.some((record) => record.attributeName !== "style")
          )
            schedule();
        });
        sizes = new ResizeObserver(schedule);
        discovery = new MutationObserver(schedule);
        style = document.createElement("style");
        style.id = "zentral-library-resize-style";
        style.textContent = `
          :root[${ATTR}] #zen-appcontent-wrapper,
          :root[${ATTR}] #zen-toast-container { transform: none !important; }
          :root[${ATTR}][zentral-library-sidebar-visible] #navigator-toolbox {
            transform: none !important; opacity: 1 !important;
          }
          :root[${ATTR}] zen-library {
            top: var(${VARS[4]}, 0px) !important;
            bottom: 0 !important; height: auto !important;
            left: var(${VARS[5]}, 0px) !important; right: auto !important;
            min-width: 0 !important;
            max-width: calc(100% - var(${VARS[5]}, 0px)) !important;
          }
          :root[${ATTR}]:is([zen-right-side="true"], [zen-sidebar-right="true"]) zen-library {
            right: var(${VARS[5]}, 0px) !important; left: auto !important;
          }
          :root[${ATTR}] #tabbrowser-tabbox {
            box-sizing: border-box !important; min-width: 0 !important;
            padding-left: calc(var(${VARS[2]}, 0px) + var(${VARS[0]}, 0px)) !important;
            padding-right: calc(var(${VARS[3]}, 0px) + var(${VARS[1]}, 0px)) !important;
          }`;
        root.appendChild(style);
        // Rebind lazy/replaced Library chrome on lifecycle or its actual open
        // command. Observe shallow native parents, never the document subtree.
        for (const type of layoutEvents)
          window.addEventListener(type, schedule);
        window.addEventListener("command", onLibraryCommand, true);
        bind();
      }
      schedule();
    }
    const runtime = window.ZentralRuntime;
    const unregisterSettings = runtime.registerSettingsHook?.(
      "library-resize",
      24,
      () => {
        const modal = document.getElementById("zentral-settings-modal");
        if (!modal || modal.querySelector("#zentral-library-resize-note"))
          return;
        const section = runtime.ensureSettingsSection(
          modal,
          "experimental",
          "Library layout",
        );
        const note = document.createElement("p");
        note.id = "zentral-library-resize-note";
        note.className = "zs-category-description";
        note.textContent =
          "Keeps browser UI in place. Resize mode reserves webpage space; Overlay mode covers the webpage without resizing it. Sits beside the visible native sidebar and below intersecting top controls. Click the webpage or press Escape to close; sidebar/toolbars and popup menus remain usable. Off by default; on in Recommended, using Overlay. Minimum width and animated resizing apply only to Resize mode. Animation adds webpage layout work; the minimum width may leave overlap in narrow windows. Disabling restores native behavior.";
        section.appendChild(note);
      },
    );
    const preferenceObserver = { observe: sync };
    Services.prefs.addObserver(PREF, preferenceObserver);
    try {
      sync();
    } catch (error) {
      stop();
      unregisterSettings?.();
      Services.prefs.removeObserver(PREF, preferenceObserver);
      throw error;
    }
    return () => {
      disposed = true;
      unregisterSettings?.();
      document.getElementById("zentral-library-resize-note")?.remove();
      Services.prefs.removeObserver(PREF, preferenceObserver);
      stop();
    };
  }
  window.ZentralRuntime.register({ id: "library-resize", init: start });
})();
