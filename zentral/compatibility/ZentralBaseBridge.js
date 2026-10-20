/* Extended 3.0.0 adapted-base/bridge owner. Original reference: Zentral 1.1.0.
 * See docs/BASE-PATCHES.md, docs/UPSTREAM-MAP.json and UPSTREAM.json before updating. */
/* Hybrid contract v1. B001/B002/B004/B016 are the documented private-state entrypoints.
 * This bridge never starts a second upstream instance. See docs/BASE-PATCHES.md.
 * Runtime requires Apps for this service; independent features do not require it. */
(function () {
  "use strict";
  window.ZentralRuntime.register({
    id: "base-bridge",
    init({ lifecycle, runtime }) {
      const apps = window.Zentral?.Apps;
      if (
        typeof apps?.getPanelSnapshot !== "function" ||
        typeof apps?.updateAppStartURL !== "function" ||
        typeof apps?.setPanelExpanded !== "function"
      )
        throw new Error(
          "Incompatible Zentral base: hybrid contract v1 is required",
        );
      const listeners = new Map();
      const hooks = new Set();
      const bridge = {
        version: 1,
        upstream: "0e18990c0bfa2563d22de8f5d04135da186ef1b0",
        snapshot: () => apps.getPanelSnapshot(),
        app(id) {
          const ctx = runtime.panelContext;
          return (
            ctx?.essentialPanels?.get(id)?.app ||
            (() => {
              try {
                return JSON.parse(
                  runtime.shared.Core.getPref(
                    "zen.workspace.apps.sidebar.apps",
                    "[]",
                  ),
                ).find((a) => a.id === id);
              } catch (_) {
                return null;
              }
            })()
          );
        },
        on(name, fn) {
          const set = listeners.get(name) || new Set();
          listeners.set(name, set);
          set.add(fn);
          return () => set.delete(fn);
        },
        emit(name, detail) {
          for (const fn of listeners.get(name) || []) {
            try {
              fn(detail);
            } catch (error) {
              console.error("[Zentral bridge]", name, error);
            }
          }
        },
        // Every new extension wrapper uses this ownership-aware installation.
        // If another owner wraps later, teardown makes our captured wrapper inert.
        wrap(target, key, around, owner) {
          if (typeof target?.[key] !== "function")
            throw new Error(`Missing base method ${key} for ${owner}`);
          const descriptor = Object.getOwnPropertyDescriptor(target, key);
          const original = target[key];
          let active = true;
          function wrapped(...args) {
            if (!active) return original.apply(this, args);
            return around.call(
              this,
              (...next) => original.apply(this, next),
              args,
            );
          }
          Object.defineProperty(target, key, {
            configurable: true,
            writable: true,
            enumerable: descriptor?.enumerable ?? true,
            value: wrapped,
          });
          const row = { owner, key };
          hooks.add(row);
          const release = () => {
            active = false;
            hooks.delete(row);
            if (target[key] !== wrapped) return;
            if (descriptor) Object.defineProperty(target, key, descriptor);
            else delete target[key];
          };
          lifecycle.own(release);
          return release;
        },
        hooks: () => [...hooks].map((x) => ({ ...x })),
        updateStartURL: (id, url) => apps.updateAppStartURL(id, url),
        createApp: (url, title, icon) => apps.addApp(url, title, icon),
      };
      runtime.baseBridge = bridge;
      lifecycle.own(() => {
        listeners.clear();
        if (runtime.baseBridge === bridge) delete runtime.baseBridge;
      });
      return bridge;
    },
  });
})();
