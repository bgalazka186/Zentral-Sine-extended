/* HYBRID U110-THEME: feature-owned adaptation of upstream effective theme tracking.
 * Browser chrome, content, system, light and dark are user choices. Observers are scoped. */
(function () {
  "use strict";
  window.ZentralModuleLoader.load("additional/theme/ZentralThemePolicy.js", {
    owner: "theme-service",
  });
  window.ZentralRuntime.register({
    id: "theme-service",
    init({ lifecycle, shared, runtime }) {
      const math = window.ZentralModuleLoader.create("theme-policy");
      const { Core } = shared,
        ui = document.documentElement;
      const previous = new Map(
        ["zentral-effective-theme", "zentral-contrast-policy"].map((k) => [
          k,
          ui.getAttribute(k),
        ]),
      );
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      let scheduled = null;
      function sync() {
        scheduled = null;
        const policy = Core.getPref(
          "zen.workspace.zentral.theme.policy",
          "browser",
        );
        const scheme = Core.getNativePref("zen.view.window.scheme", 2);
        const content = Core.getNativePref(
          "layout.css.prefers-color-scheme.content-override",
          2,
        );
        const browserDark =
          scheme === 0
            ? true
            : scheme === 1
              ? false
              : typeof window.gZenThemePicker?.isDarkMode === "boolean"
                ? window.gZenThemePicker.isDarkMode
                : ui.getAttribute("lwtheme-brighttext") === "true" ||
                  mq.matches;
        const theme = math.resolveTheme(policy, {
          browserDark,
          contentDark:
            content === 0 ? true : content === 1 ? false : mq.matches,
          systemDark: mq.matches,
        });
        const contrast = Core.getPref(
          "zen.workspace.zentral.theme.contrast",
          "adaptive",
        );
        if (ui.getAttribute("zentral-effective-theme") !== theme)
          ui.setAttribute("zentral-effective-theme", theme);
        if (ui.getAttribute("zentral-contrast-policy") !== contrast)
          ui.setAttribute("zentral-contrast-policy", contrast);
        runtime.themeState = { policy, theme, contrast };
      }
      function queue() {
        if (scheduled === null)
          scheduled = lifecycle.requestAnimationFrame(sync);
      }
      for (const pref of [
        "zen.workspace.zentral.theme.",
        "zen.view.window.scheme",
        "layout.css.prefers-color-scheme.content-override",
      ])
        lifecycle.preference(pref, queue);
      for (const topic of ["look-and-feel-changed", "zen-theme-change"])
        lifecycle.observe(topic, queue);
      if (mq.addEventListener) lifecycle.listen(mq, "change", queue);
      else {
        mq.addListener(queue);
        lifecycle.own(() => mq.removeListener(queue));
      }
      const observer = new MutationObserver(queue);
      observer.observe(ui, {
        attributes: true,
        attributeFilter: [
          "lwtheme",
          "lwtheme-brighttext",
          "lwt-default-theme-in-dark-mode",
        ],
      });
      lifecycle.own(() => observer.disconnect());
      lifecycle.own(() => {
        for (const [key, value] of previous) {
          if (value === null) ui.removeAttribute(key);
          else ui.setAttribute(key, value);
        }
        delete runtime.themeState;
      });
      sync();
    },
  });
})();
