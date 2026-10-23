/* Zentral standalone shim - TEMPLATE. Never loaded by the full pack.
 * tools/build-standalone.cjs prepends this to a module to produce a bundle that
 * Sine can install on its own (…/additional/<module> folder URL).
 *
 * It provides ONLY what standalone modules use: register (with the same owned
 * lifecycle scope the full runtime hands to init), registerSettingsHook,
 * ensureSettingsSection, registerHostUnload, the native sidebar helpers and the
 * two status slots compact-hover writes. The sidebar helpers and the lifecycle
 * scope (createFeatureScope, including watchNative) are not written here: the
 * build copies them verbatim from loader/ZentralRuntime.js at the markers below,
 * so they cannot drift.
 *
 * Coexistence (full pack always wins, either load order):
 *   1. If window.ZentralRuntime exists, this bundle does nothing.
 *   2. Otherwise each feature is published in window.__zentralStandalone[id];
 *      the full runtime disposes it before activating the same feature id.
 * Placeholders replaced by the build: __FEATURE_VERSION__.
 */
const __ZENTRAL_STANDALONE_VERSION__ = "__FEATURE_VERSION__";
const __zentralShim = (function () {
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const PREF_STRING = 32,
    PREF_INT = 64,
    PREF_BOOL = 128;
  // Same contract as the runtime's getPref: only a user-visible stored value,
  // otherwise the fallback.
  function getPref(key, fallback) {
    try {
      switch (Services.prefs.getPrefType(key)) {
        case PREF_BOOL:
          return Services.prefs.getBoolPref(key);
        case PREF_INT:
          return Services.prefs.getIntPref(key);
        case PREF_STRING:
          return Services.prefs.getStringPref(key);
      }
    } catch (_) {}
    return fallback;
  }
  let stopped = false;
  /*__SIDEBAR_FUNCTIONS__*/
  /*__SCOPE_FUNCTIONS__*/
  const unloadHandlers = new Set();
  window.addEventListener(
    "unload",
    () => {
      stopped = true;
      for (const handler of [...unloadHandlers]) {
        try {
          handler();
        } catch (error) {
          console.warn("[Zentral standalone] unload cleanup", error);
        }
      }
      unloadHandlers.clear();
    },
    { once: true },
  );
  // Same barrier the full runtime uses: session restore, Zen workspaces and
  // Zen startup. Native promises are re-read after each await because Zen can
  // replace them during restoration. Bounded, never polls.
  async function nativeReady() {
    const seen = new Set();
    for (let round = 0; round < 4 && !stopped; round++) {
      const pending = [];
      for (const read of [
        () => window.SessionStore?.promiseAllWindowsRestored,
        () => window.gZenWorkspaces?.promiseInitialized,
        () => window.gZenStartup?.promiseInitialized,
      ]) {
        try {
          const promise = read();
          if (promise?.then && !seen.has(promise)) {
            seen.add(promise);
            pending.push(promise);
          }
        } catch (_) {}
      }
      if (round && !pending.length) break;
      await Promise.allSettled(pending);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
  const features = (window.__zentralStandalone ||= {});
  const shim = {
    standalone: true,
    getPref,
    nativeSidebarElement,
    nativeSidebarRect,
    nativeSidebarSide,
    sidebarLayoutRepair: null,
    compactHoverStatus: null,
    registerSettingsHook: () => () => {},
    ensureSettingsSection: () => null,
    registerHostUnload(fn) {
      unloadHandlers.add(fn);
      return () => unloadHandlers.delete(fn);
    },
    register(def) {
      if (!def?.id || typeof def.init !== "function")
        throw new Error("Standalone registration needs id and init");
      // 1. The full pack owns every feature it contains.
      if (window.ZentralRuntime) return;
      // Live re-run (Sine reloads scripts): replace the previous instance.
      try {
        features[def.id]?.dispose?.();
      } catch (_) {}
      const lifecycle = createFeatureScope(def.id);
      let cleanup = null,
        initialized = false,
        disposed = false;
      const handle = (features[def.id] = {
        version: __ZENTRAL_STANDALONE_VERSION__,
        dispose() {
          if (disposed) return;
          disposed = true;
          unloadHandlers.delete(handle.dispose);
          if (features[def.id] === handle) delete features[def.id];
          const fn = initialized ? (cleanup ?? def.dispose) : null;
          cleanup = null;
          try {
            if (typeof fn === "function") fn();
            else fn?.destroy?.();
          } catch (error) {
            console.warn("[Zentral standalone] cleanup", def.id, error);
          }
          lifecycle.destroy();
        },
      });
      unloadHandlers.add(handle.dispose);
      nativeReady().then(() => {
        // The full runtime may have appeared while we waited; it disposes us
        // (2) when activating, and if it already activated we must not start.
        if (disposed || stopped || window.ZentralRuntime) {
          handle.dispose();
          return;
        }
        try {
          initialized = true;
          const result = def.init({ lifecycle, runtime: shim });
          if (result && typeof result.then === "function")
            throw new Error("init must be synchronous");
          if (disposed) {
            // Disposed during init: release what init just created.
            const late = result ?? def.dispose;
            if (typeof late === "function") late();
            else late?.destroy?.();
            return;
          }
          cleanup = result;
        } catch (error) {
          console.error("[Zentral standalone] init failed:", def.id, error);
          handle.dispose();
        }
      });
    },
  };
  window.__zentralStandaloneRuntime = shim;
  return shim;
})();
