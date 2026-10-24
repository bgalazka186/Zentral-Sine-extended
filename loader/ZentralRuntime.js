// ==UserScript==
// @name Zentral Core and Settings
// @include chrome://browser/content/browser.xhtml
// @version 3.1.0
// ==/UserScript==
/*
 * ZENTRAL FILE GUIDE - loader/ZentralRuntime.js
 *
 * Purpose: Owns per-window feature records, preparation/activation, availability, hooks, CSS registration,
 *   settings routing and native sidebar geometry tracking.
 * Interaction / execution: Loads catalog and shared services, optionally constructs settings, waits for
 *   native delayed startup, loads feature declarations, applies owner-gated CSS, then activates
 *   dependency-ready features. Panel parts resume in the coordinator.
 * Ownership / failure: Owns disposers and sidebar observers/listeners; destroy unwinds cleanup in reverse,
 *   closes settings, removes registered sheets and destroys the loader. Features should register their
 *   cleanup here.
 * Loaded/created by: loader/Zentral.uc.js
 * Direct local resource paths: loader/Zentral.uc.js; loader/ZentralCatalog.js; loader/ZentralShared.js;
 *   extension/settings/controllers/ZentralDeveloperSettings.js; extension/settings/controllers/ZentralFeatureSettings.js;
 *   extension/settings/controllers/ZentralSettingsCatalog.js; extension/settings/controllers/ZentralSettingsShell.js;
 *   additional/video/controllers/ZentralVideoSettings.js
 * Constructed factory IDs: catalog; developer-settings; feature-settings; settings-catalog; settings-shell;
 *   shared
 * Injected deps state/callbacks used: some
 * Literal DOM event subscriptions: click; input; unload; zentral-runtime-change
 *
 * Settings dependency contract: successful descriptors publish availableOwners; record state controls rows.
 *   Mixed-owner categories stay reachable; section/row sorting follows layout.json and preserves conditional groups.
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  if (window.ZentralRuntime) return;
  const moduleLoader = window.ZentralModuleLoader;
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const VERSION = "3.1.0";
  // Sine installs this package under theme.json's id. Resolve from the
  // executing script so local folders and installed copies use their own files.
  // Keep this universal: never hard-code a mod id, folder name, or profile path.
  // Modules that need assets should resolve them against runtime.rootURI.
  const ROOT = Services.io.newURI(
    "../",
    null,
    Services.io.newURI(moduleLoader.rootURI + "loader/Zentral.uc.js"),
  ).spec;
  const PREF = "zen.workspace.zentral.modules.";
  const definitions = new Map(),
    parts = new Map(),
    records = new Map(),
    styles = new Map(),
    disposers = [],
    availability = new Map();
  let ready = false,
    stopped = false,
    activationReady = false,
    startupStage = "waiting-browser";
  let resolveStop;
  const stopSignal = new Promise((resolve) => {
    resolveStop = resolve;
  });
  const hookListeners = new Map(),
    hookLast = new Map();
  const hooks = {
    on(event, id, callback, priority = 0) {
      let entries = hookListeners.get(event);
      if (!entries) hookListeners.set(event, (entries = new Map()));
      if (entries.has(id)) throw new Error("Duplicate hook: " + id);
      entries.set(id, { callback, priority });
      if (hookLast.has(event)) {
        try {
          callback(hookLast.get(event));
        } catch (error) {
          console.error("[Zentral hook]", id, error);
        }
      }
      return () => entries.delete(id);
    },
    emit(event, payload) {
      hookLast.set(event, payload);
      for (const [id, entry] of [...(hookListeners.get(event) || [])].sort(
        (a, b) => a[1].priority - b[1].priority,
      )) {
        try {
          entry.callback(payload);
        } catch (error) {
          console.error("[Zentral hook]", id, error);
        }
      }
    },
  };
  const getPref = (key, fallback) => {
    try {
      switch (Services.prefs.getPrefType(key)) {
        case 128:
          return Services.prefs.getBoolPref(key);
        case 64:
          return Services.prefs.getIntPref(key);
        case 32:
          return Services.prefs.getStringPref(key);
      }
    } catch (_) {}
    return fallback;
  };
  const setPref = (key, value) => {
    if (typeof value === "boolean") Services.prefs.setBoolPref(key, value);
    else if (typeof value === "number")
      Services.prefs.setIntPref(key, Math.round(value));
    else Services.prefs.setStringPref(key, String(value));
  };
  let hostUnloadWarning = false;
  function registerHostUnload(callback) {
    // Host hooks are optional. Native unload and Runtime.destroy already own
    // teardown; a faulty loader API must not abort feature initialization.
    try {
      if (typeof window.addUnloadListener === "function") {
        window.addUnloadListener(callback);
        return true;
      }
      if (
        typeof UC_API !== "undefined" &&
        typeof UC_API.addUnloadListener === "function"
      ) {
        UC_API.addUnloadListener(callback);
        return true;
      }
    } catch (error) {
      if (!hostUnloadWarning) {
        hostUnloadWarning = true;
        console.warn(
          "[Zentral] Optional loader unload hook failed; native cleanup remains active",
          error,
        );
      }
    }
    return false;
  }
  const arcSidebarPref = "zen.workspace.zentral.arc2.match_compact_sidebar";
  // The Library background (Arc 2.0 match and custom color) is owned by
  // additional/library/ZentralLibraryResize.uc.js so it also works when that
  // module is installed alone. The pref name stays here only for the settings UI.
  const arcLibraryPref = "zen.workspace.zentral.arc2.match_compact_library";
  const arcSidebarColorPref = "arc-compact-sidebar-bg";
  const arcSidebarAttribute = "zentral-arc2-regular-sidebar";
  const arcSidebarColorProperty = "--zentral-arc2-sidebar-background";
  // Arc stores its color and alpha together (for example rgba/8-digit hex).
  // Reuse that exact CSS value; opacity on the Library element would also fade
  // text/icons, and painting multiple matching surfaces would stack the alpha.
  const syncArcSidebar = () => {
    // Sine can load this runtime before browser.xhtml has a root element.
    // DOM styling must not abort registration of the entire framework.
    const ui = document.documentElement;
    if (stopped || !ui) return;
    const color = getPref(arcSidebarColorPref, "");
    const validColor = typeof color === "string" && color.trim() !== "";
    const sidebarActive = getPref(arcSidebarPref, false) === true && validColor;
    ui.toggleAttribute(arcSidebarAttribute, sidebarActive);
    if (sidebarActive) ui.style.setProperty(arcSidebarColorProperty, color);
    else ui.style.removeProperty(arcSidebarColorProperty);
  };
  const arcSidebarObserver = { observe: syncArcSidebar };
  syncArcSidebar();
  if (!document.documentElement)
    document.addEventListener("DOMContentLoaded", syncArcSidebar, {
      once: true,
    });
  Services.prefs.addObserver(arcSidebarPref, arcSidebarObserver);
  Services.prefs.addObserver(arcSidebarColorPref, arcSidebarObserver);
  disposers.push(() => {
    Services.prefs.removeObserver(arcSidebarPref, arcSidebarObserver);
    Services.prefs.removeObserver(arcSidebarColorPref, arcSidebarObserver);
    document.removeEventListener("DOMContentLoaded", syncArcSidebar);
    const ui = document.documentElement;
    ui?.removeAttribute(arcSidebarAttribute);
    ui?.style.removeProperty(arcSidebarColorProperty);
  });
  const unsafeCorePref =
    "zen.workspace.zentral.modules.allow_unsafe_core_disable";
  const protectedModules = new Set([
    "apps",
    "panels",
    "geometry",
    "corner-panels",
    "panel-toolbar",
    "browser-integrations",
    "panel-styles",
  ]);
  const protectedCSS = new Set([
    "Base",
    "Panels",
    "CornerPanels",
    "Controls",
    "PanelToolbar",
    "PanelGeometry",
    "BrowserIntegrations",
    "Appearance",
  ]);
  const unsafeCoreDisabled = () => getPref(unsafeCorePref, false) === true;
  const enabled = (id) =>
    id === "extension-settings"
      ? settingsSupport
      : protectedModules.has(id) && !unsafeCoreDisabled()
        ? true
        : getPref(PREF + id + ".enabled", true) !== false;
  const emit = () =>
    window.dispatchEvent(new CustomEvent("zentral-runtime-change"));
  const fail = (r, error) => {
    r.state = "failed";
    r.error = String(error?.stack || error);
    console.error(`[Zentral/${r.id}]`, error);
    emit();
  };
  // CORE LIFECYCLE CONTRACT (for future contributors/AI): keep this generic.
  // Features declare dependencies in the catalog and register synchronously.
  // init receives one owned scope; register cleanup BEFORE fallible/async work.
  // Use watchNative for optional/lazy browser APIs, not another startup loop.
  // resolve must be read-only and return a stable identity or null. attach must
  // register rollback in its child scope and return {destroy,isCurrent} (or a
  // disposer with those properties). Never retry an unrolled-back initializer.
  // All callbacks must respect scope.active; a disposed generation cannot revive.
  // Feature prefs, DOM selectors, native patches and visual behavior stay outside
  // core. See loader/README.md for adding/removing modules and testing the contract.
  function createFeatureScope(owner) {
    let active = true;
    const cleanups = new Set(),
      timers = new Set(),
      frames = new Set();
    const bindings = new Map();
    const report = (error) => console.warn("[Zentral lifecycle]", owner, error);
    const scope = {
      get active() {
        return active && !stopped;
      },
      bindings,
      own(dispose) {
        if (typeof dispose !== "function")
          throw new TypeError("Cleanup must be a function");
        let owned = true;
        const release = () => {
          if (!owned) return;
          owned = false;
          cleanups.delete(release);
          try {
            dispose();
          } catch (error) {
            report(error);
          }
        };
        if (scope.active) cleanups.add(release);
        else release();
        return release;
      },
      listen(target, type, callback, options) {
        if (!scope.active) return () => {};
        const guarded = (...args) => {
          if (scope.active) callback.apply(target, args);
        };
        target.addEventListener(type, guarded, options);
        return scope.own(() =>
          target.removeEventListener(type, guarded, options),
        );
      },
      observe(topic, callback) {
        if (!scope.active) return () => {};
        const observer = {
          observe(...args) {
            if (scope.active) callback(...args);
          },
        };
        Services.obs.addObserver(observer, topic);
        return scope.own(() => Services.obs.removeObserver(observer, topic));
      },
      preference(prefix, callback) {
        if (!scope.active) return () => {};
        const observer = {
          observe(...args) {
            if (scope.active) callback(...args);
          },
        };
        Services.prefs.addObserver(prefix, observer);
        return scope.own(() => Services.prefs.removeObserver(prefix, observer));
      },
      setTimeout(callback, delay = 0) {
        if (!scope.active) return null;
        const id = window.setTimeout(() => {
          timers.delete(id);
          if (scope.active) callback();
        }, delay);
        timers.add(id);
        return id;
      },
      clearTimeout(id) {
        window.clearTimeout(id);
        timers.delete(id);
      },
      requestAnimationFrame(callback) {
        if (!scope.active) return null;
        const id = window.requestAnimationFrame((time) => {
          frames.delete(id);
          if (scope.active) callback(time);
        });
        frames.add(id);
        return id;
      },
      cancelAnimationFrame(id) {
        window.cancelAnimationFrame(id);
        frames.delete(id);
      },
      destroy() {
        if (!active) return;
        active = false;
        for (const id of timers) window.clearTimeout(id);
        for (const id of frames) window.cancelAnimationFrame(id);
        timers.clear();
        frames.clear();
        for (const release of [...cleanups].reverse()) release();
      },
      watchNative(spec) {
        const name = spec.name || "native";
        if (bindings.has(name))
          throw new Error("Duplicate native binding: " + name);
        const status = { state: "disabled", attempts: 0 };
        bindings.set(name, status);
        let listening = false,
          disposed = false,
          busy = false;
        let target = null,
          installed = null,
          attachment = null;
        let scheduled = null,
          retry = null,
          retryIndex = 0;
        let lastError = null;
        const listeners = [];
        const delays = [50, 150, 500, 1500, 4000];
        const allowed = () =>
          scope.active && !disposed && (!spec.enabled || spec.enabled());
        function cancelWork() {
          scope.clearTimeout(scheduled);
          scope.clearTimeout(retry);
          scheduled = retry = null;
        }
        function detach() {
          attachment?.destroy();
          attachment = installed = target = null;
        }
        function scheduleRetry() {
          if (!allowed() || retry !== null || retryIndex >= delays.length)
            return;
          retry = scope.setTimeout(() => {
            retry = null;
            check();
            scheduleRetry();
          }, delays[retryIndex++]);
        }
        function check(event) {
          if (!allowed() || busy) return;
          busy = true;
          try {
            const next = spec.resolve();
            if (
              attachment &&
              next === target &&
              installed?.isCurrent?.() !== false
            )
              return;
            detach();
            if (!next) {
              status.state = "waiting-native";
              return;
            }
            target = next;
            const attempt = (attachment = createFeatureScope(
              owner + "/" + name,
            ));
            status.attempts++;
            installed = spec.attach(next, attempt);
            const result = installed;
            if (result && typeof result.then === "function") {
              Promise.resolve(result).then((late) => {
                if (typeof late === "function") attempt.own(late);
                else if (late?.destroy) attempt.own(() => late.destroy());
              }, report);
              throw new Error("Native attachment must be synchronous");
            }
            if (typeof result === "function") attempt.own(result);
            else if (result?.destroy) attempt.own(() => result.destroy());
            if (!allowed()) {
              detach();
              return;
            }
            status.state = "active";
            delete status.error;
            lastError = null;
            installed?.onReadyEvent?.(event);
          } catch (error) {
            detach();
            status.state = "waiting-native";
            status.error = String(error);
            if (lastError !== status.error) {
              lastError = status.error;
              report(error);
            }
          } finally {
            busy = false;
          }
        }
        function queue(event) {
          if (!allowed() || scheduled !== null) return;
          scheduled = scope.setTimeout(() => {
            scheduled = null;
            check(event);
          });
        }
        function sync() {
          const on = allowed();
          if (on !== listening) {
            listening = on;
            cancelWork();
            retryIndex = 0;
            for (const release of listeners.splice(0)) release();
            if (on) {
              for (const item of spec.events || []) {
                const event = typeof item === "string" ? { type: item } : item;
                listeners.push(
                  scope.listen(
                    event.target || window,
                    event.type,
                    (value) => {
                      if (event.filter && !event.filter(value)) return;
                      if (event.synchronous) check(value);
                      else queue(value);
                    },
                    event.capture || false,
                  ),
                );
              }
              for (const topic of spec.topics || [])
                listeners.push(scope.observe(topic, () => queue()));
            }
          }
          if (!on) {
            detach();
            status.state = "disabled";
            delete status.error;
            return;
          }
          check();
          scheduleRetry();
        }
        const prefs = (spec.prefs || []).map((pref) =>
          scope.preference(pref, sync),
        );
        const destroy = scope.own(() => {
          disposed = true;
          cancelWork();
          for (const release of listeners.splice(0)) release();
          for (const release of prefs) release();
          detach();
          status.state = "stopped";
        });
        sync();
        return { check, refresh: queue, destroy, status };
      },
    };
    return scope;
  }
  // END CORE LIFECYCLE CONTRACT
  const featureScopes = new Map();
  const runtime = (window.ZentralRuntime = {
    version: VERSION,
    rootURI: ROOT,
    hooks,
    registerHostUnload,
    services: { platform: Services },
    shared: null,
    panelContext: null,
    setAvailable(id, value) {
      availability.set(id, !!value);
      const row = records.get(id);
      if (!row) return;
      if (!value && ["registered", "active"].includes(row.state)) {
        row.state = "dormant";
        row.reason = "Base preference is off; enabling it starts this feature";
      } else if (value && row.state === "dormant") {
        row.state = "active";
        row.reason = undefined;
        if (ready) activateReady();
      }
      syncOwnerStyles(id);
      emit();
    },
    failFeature(id, error) {
      const row = records.get(id);
      if (row) fail(row, error);
    },
    addSettings(id, entries) {
      for (const entry of entries) {
        if (
          !entry.property ||
          SETTINGS_SCHEMA.some((x) => x.property === entry.property)
        )
          continue;
        SETTINGS_SCHEMA.push({ ...entry, feature: id });
      }
    },
    register(def) {
      if (!def?.id || typeof def.init !== "function")
        throw new Error("Feature registration needs id and init");
      if (definitions.has(def.id) || parts.has(def.id))
        throw new Error("Duplicate feature: " + def.id);
      definitions.set(def.id, def);
      if (def.settings) this.addSettings(def.id, def.settings);
    },
    registerPart(id, factory) {
      if (parts.has(id) || definitions.has(id))
        throw new Error("Duplicate feature: " + id);
      parts.set(id, { factory, iterator: null });
    },
    prepareParts(
      ctx,
      preparationCleanups = Object.getOwnPropertyDescriptor(ctx, "cleanupFns")
        ?.value,
    ) {
      for (const m of MANIFEST.filter((m) => m.part && enabled(m.id))) {
        const p = parts.get(m.id);
        if (!p) {
          if (m.optional) continue;
          throw new Error("Missing panel source: " + m.id);
        }
        if (p.iterator) continue;
        // Preparation runs before many coordinator bindings exist. Inspecting
        // property DESCRIPTORS is safe; invoking a lazy ctx getter is not.
        // Coordinators pass their already-created cleanup array explicitly.
        const cleanups = preparationCleanups,
          before = cleanups?.length || 0;
        const descriptors = Object.getOwnPropertyDescriptors(ctx);
        try {
          p.iterator = p.factory(ctx);
          p.iterator.next();
        } catch (error) {
          const row = records.get(m.id);
          if (row) fail(row, error);
          try {
            p.iterator?.return();
          } catch (_) {}
          p.iterator = null;
          for (const dispose of cleanups?.splice(before).reverse() || []) {
            try {
              dispose();
            } catch (_) {}
          }
          if (!m.optional) throw error;
          // Optional preparation must only publish reversible ctx properties.
          for (const key of Reflect.ownKeys(ctx)) {
            if (
              !Object.hasOwn(descriptors, key) &&
              Object.getOwnPropertyDescriptor(ctx, key)?.configurable
            )
              delete ctx[key];
          }
          for (const key of Reflect.ownKeys(descriptors)) {
            try {
              Object.defineProperty(ctx, key, descriptors[key]);
            } catch (_) {}
          }
        }
      }
    },
    runPart(id) {
      const r = records.get(id),
        optional = MANIFEST.find((m) => m.id === id)?.optional;
      if (!enabled(id)) {
        if (r) r.state = "disabled";
        return;
      }
      if (r?.state === "active" || r?.state === "initializing") return;
      if (r?.state === "failed" && optional) return;
      const p = parts.get(id);
      if (!p?.iterator) {
        if (optional) {
          if (r) {
            r.state = "blocked";
            r.reason = "Optional source unavailable";
          }
          return;
        }
        throw new Error("Panel phase was not prepared: " + id);
      }
      const cleanup = runtime.panelContext?.cleanupFns;
      const before = cleanup?.length ?? 0;
      try {
        if (r) r.state = "initializing";
        p.iterator.next();
        if (r) r.state = "active";
      } catch (e) {
        if (r) fail(r, e);
        if (!optional) throw e;
        for (const dispose of cleanup?.splice(before).reverse() || []) {
          try {
            dispose();
          } catch (error) {
            console.warn("[Zentral] Optional part cleanup", id, error);
          }
        }
      }
    },
    snapshot() {
      return {
        version: VERSION,
        compactHover: runtime.compactHoverStatus || null,
        ready: activationReady,
        startupStage,
        nativeReadinessWarnings: runtime.nativeReadinessWarnings || [],
        settingsLayout: runtime.settingsLayoutStatus || {
          stage: "not opened",
          failures: [],
        },
        nativeSidebar: runtime.nativeSidebarDiagnostics?.() || null,
        sidebarLayoutRepair: runtime.sidebarLayoutRepair || {
          stage: "not started",
        },
        sources: moduleLoader.sources(),
        features: [...records.values()].map((r) => ({
          ...r,
          nextEnabled: enabled(r.id),
          nativeBindings: Object.fromEntries(
            featureScopes.get(r.id)?.bindings || [],
          ),
        })),
        css: [...styles.values()].map((r) => ({
          ...r,
          nextEnabled: getPref(
            PREF + "css." + (r.legacyControl || r.id) + ".enabled",
            true,
          ),
        })),
      };
    },
    openSettings: () => openManager(),
    destroy() {
      if (stopped) return;
      stopped = true;
      resolveStop();
      activationReady = false;
      startupStage = "stopped";
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          dispose();
        } catch (e) {
          console.warn("[Zentral] Cleanup", e);
        }
      }
      for (const part of parts.values()) {
        try {
          part.iterator?.return();
        } catch (_) {}
      }
      hookLast.clear();
      hookListeners.clear();
      delete window.ZentralRuntime;
      if (runtime.shared && window.Zentral?.Core === runtime.shared.Core)
        delete window.Zentral;
      moduleLoader.destroy();
    },
  });

  // Native sidebar geometry is part of the runtime lifecycle.
  const { installSidebarLayoutTracking } = (function ({
    runtime,
    getPref,
    disposers,
  }) {
    // Measure native chrome, never the pushed web-content box.
    function nativeSidebarElement() {
      const tabs = window.gBrowser?.tabContainer;
      const candidates = [
        window.gNavToolbox,
        document.getElementById("navigator-toolbox"),
        document.getElementById("sidebar-container"),
        document.getElementById("vertical-tabs"),
        tabs,
      ];
      for (const node of new Set(candidates)) {
        if (!node?.isConnected) continue;
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "collapse")
          continue;
        const r = node.getBoundingClientRect();
        // Wide sidebars are valid. Only reject absent or full-window hosts;
        // tab containment can be incomplete during native startup/reparenting.
        const verticalNative =
          (node === window.gNavToolbox || node.id === "navigator-toolbox") &&
          r.height > window.innerHeight / 2;
        if (
          [r.width, r.height, r.left, r.right, r.top, r.bottom].every(
            Number.isFinite,
          ) &&
          r.width > 0 &&
          (verticalNative || r.width < window.innerWidth - 1) &&
          r.height > 0
        )
          return node;
      }
      return null;
    }
    function nativeSidebarRect() {
      const r = nativeSidebarElement()?.getBoundingClientRect();
      if (!r)
        return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
      const left = Math.max(0, Math.min(window.innerWidth, r.left));
      const right = Math.max(left, Math.min(window.innerWidth, r.right));
      const top = Math.max(0, Math.min(window.innerHeight, r.top));
      const bottom = Math.max(top, Math.min(window.innerHeight, r.bottom));
      return {
        left,
        right,
        top,
        bottom,
        width: right - left,
        height: bottom - top,
      };
    }
    function nativeSidebarSide() {
      const ui = document.documentElement;
      for (const key of ["zen-right-side", "zen-sidebar-right"])
        if (ui.hasAttribute(key))
          return ui.getAttribute(key) === "false" ? "left" : "right";
      if (getPref("zen.tabs.vertical.right-side", false)) return "right";
      const r = nativeSidebarRect();
      return r.width && r.left + r.width / 2 > window.innerWidth / 2
        ? "right"
        : "left";
    }
    function sidebarSafeBounds() {
      let left = 0,
        right = window.innerWidth;
      const native = nativeSidebarElement();
      const nodes = new Set([
        native,
        document.getElementById("sidebar-box"),
        document.getElementById("zen-sidebar-splitter"),
      ]);
      const ui = document.documentElement,
        onRight = nativeSidebarSide() === "right";
      if (
        ui.getAttribute("zen-compact-mode") === "true" &&
        ui.getAttribute("zen-compact-sidebar-visible") === "true"
      ) {
        if (onRight) right -= 22;
        else left += 22;
      }
      for (const node of nodes) {
        if (!node?.isConnected) continue;
        const style = window.getComputedStyle(node),
          r = node.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          (node.id !== "zen-sidebar-splitter" && style.opacity === "0") ||
          r.width <= 0 ||
          (node !== native && r.width >= window.innerWidth - 1) ||
          r.height <= 0 ||
          r.right <= 0 ||
          r.left >= window.innerWidth
        )
          continue;
        const belongsRight =
          node === native || node.id === "zen-sidebar-splitter"
            ? onRight
            : r.left + r.width / 2 >= window.innerWidth / 2;
        if (belongsRight) right = Math.min(right, r.left);
        else left = Math.max(left, r.right);
      }
      // Reserve space for the Zentral apps bar (second sidebar) so panels
      // never overlap it, no matter whether the bar is in autohide mode.
      // The bar sits on the side opposite the native sidebar.
      const barIsOnRight = nativeSidebarSide() !== "right";
      const appsBar = document.getElementById("zentral-apps-vertical-bar");
      if (appsBar?.isConnected) {
        const barStyle = window.getComputedStyle(appsBar);
        const autohide =
          document.documentElement.getAttribute("zentral-apps-autohide") === "true";
        let barInset = 0;
        if (autohide) {
          const offsetWidth = appsBar.offsetWidth || 44;
          const inset = parseFloat(barStyle[barIsOnRight ? "right" : "left"]) || 8;
          barInset = offsetWidth + Math.max(0, inset);
        } else {
          const rect = appsBar.getBoundingClientRect();
          if (rect.width > 0)
            barInset = barIsOnRight
              ? window.innerWidth - rect.left
              : rect.right;
        }
        if (Number.isFinite(barInset) && barInset > 0) {
          if (barIsOnRight) right = Math.min(right, window.innerWidth - barInset);
          else left = Math.max(left, barInset);
        }
      }
      left = Math.max(0, Math.min(left, window.innerWidth));
      right = Math.max(left, Math.min(right, window.innerWidth));
      return { left, right, top: 0, bottom: window.innerHeight };
    }
    function setLayoutStyle(node, name, value) {
      if (node.style.getPropertyValue(name) !== value)
        node.style.setProperty(name, value);
    }
    function constrainPanelToSidebar(panel) {
      if (!panel?.hasAttribute("open")) return;
      if (runtime.panelContext?.floating?.owns(panel)) {
        runtime.panelContext.floating.apply(panel);
        return;
      }
      const bounds = sidebarSafeBounds(),
        side = panel.getAttribute("data-panel-side");
      const width = panel.getBoundingClientRect().width;
      const style = window.getComputedStyle(panel);
      const ml = parseFloat(style.marginLeft) || 0,
        mr = parseFloat(style.marginRight) || 0;
      const requested =
        side === "right"
          ? window.innerWidth -
            (parseFloat(panel.style.right) || 0) -
            width -
            mr
          : (parseFloat(panel.style.left) || 0) + ml;
      // Keep panels flush with their docked edge in every mode. Panel geometry
      // already removes the native inset; adding 12px here cancels that offset
      // and leaves a gap. Only the pill on the opposite side needs clearance.
      const min = bounds.left + (side === "right" ? 44 : 0);
      const max = Math.max(
        min,
        bounds.right - width - (side === "left" ? 44 : 0),
      );
      // Edge-attached panels are flush with their docked safe edge. The inline
      // left/right still carries the normal 12px sidebar gap, which these
      // variables would otherwise re-apply as a visible seam.
      const edgeAttached =
        document.documentElement.getAttribute(
          "bgalazka-edge-attached-panels",
        ) === "true";
      const flush = side === "right" ? bounds.right - width : bounds.left;
      const left = Math.max(
        min,
        Math.min(max, edgeAttached ? flush : requested),
      );
      setLayoutStyle(
        panel,
        "--zentral-safe-panel-left",
        Math.round(left - ml) + "px",
      );
      setLayoutStyle(
        panel,
        "--zentral-safe-panel-right",
        Math.round(window.innerWidth - left - width - mr) + "px",
      );
    }
    runtime.nativeSidebarElement = nativeSidebarElement;
    runtime.nativeSidebarRect = nativeSidebarRect;
    runtime.nativeSidebarSide = nativeSidebarSide;
    runtime.nativeSidebarDiagnostics = () => {
      try {
        const divider = document.getElementById("zen-sidebar-splitter");
        const r = divider?.getBoundingClientRect(),
          style = divider && window.getComputedStyle(divider);
        const target =
          r && r.width > 0 && r.height > 0
            ? document.elementFromPoint(
                Math.max(
                  0,
                  Math.min(window.innerWidth - 1, r.left + r.width / 2),
                ),
                Math.max(
                  0,
                  Math.min(window.innerHeight - 1, r.top + r.height / 2),
                ),
              )
            : null;
        return {
          side: nativeSidebarSide(),
          rect: nativeSidebarRect(),
          bounds: sidebarSafeBounds(),
          divider: {
            present: !!divider?.isConnected,
            width: r?.width || 0,
            height: r?.height || 0,
            pointerEvents: style?.pointerEvents,
            display: style?.display,
            hit: target === divider || !!divider?.contains(target),
          },
        };
      } catch (error) {
        return { error: String(error) };
      }
    };
    runtime.sidebarSafeBounds = sidebarSafeBounds;
    runtime.constrainPanelToSidebar = constrainPanelToSidebar;
    function installSidebarLayoutTracking() {
      let frame = null,
        disposed = false;
      const transitions = new Map(),
        watched = new Set();
      const geometry =
        /^(transform|translate|width|height|min-width|max-width|left|right|inset.*|margin.*|padding.*|flex-basis|opacity)$/;
      const queue = () => {
        if (!disposed && frame == null)
          frame = window.requestAnimationFrame(update);
      };
      runtime.requestSidebarLayout = queue;
      const rebind = () => {
        bind();
        queue();
      };
      const resize = new ResizeObserver(queue);
      const anchors = new MutationObserver(queue);
      const bind = () => {
        const native = nativeSidebarElement();
        for (const start of [
          native,
          window.gBrowser?.tabContainer,
          document.getElementById("sidebar-box"),
        ]) {
          if (!start) continue;
          for (
            let node = start;
            node && node !== document.documentElement;
            node = node.parentElement
          ) {
            if (watched.has(node)) continue;
            watched.add(node);
            resize.observe(node);
            anchors.observe(node, {
              attributes: true,
              attributeFilter: [
                "style",
                "class",
                "hidden",
                "collapsed",
                "zen-sidebar-expanded",
                "zen-sidebar-hidden",
              ],
            });
          }
        }
      };
      const update = () => {
        frame = null;
        if (disposed) return;
        const bounds = sidebarSafeBounds(),
          ui = document.documentElement;
        const side = nativeSidebarSide();
        if (ui.getAttribute("zentral-native-sidebar-side") !== side)
          ui.setAttribute("zentral-native-sidebar-side", side);
        if (ui.getAttribute("zentral-safe-layout") !== "true")
          ui.setAttribute("zentral-safe-layout", "true");
        setLayoutStyle(
          ui,
          "--zentral-safe-left",
          Math.ceil(bounds.left) + "px",
        );
        setLayoutStyle(
          ui,
          "--zentral-safe-right",
          Math.ceil(window.innerWidth - bounds.right) + "px",
        );
        const panel = document.getElementById("zen-app-panel-root");
        const panelVisible =
          panel?.hasAttribute("open") &&
          !panel.hasAttribute("closing") &&
          !ui.hasAttribute("bgalazka-hover-panel-hidden");
        if (panelVisible) {
          window.Zentral?.Apps?.positionPanel?.();
          runtime.panelContext?.syncSidebarLayout?.();
        }
        const superPanel = document.getElementById("bgalazka-super-panel");
        if (
          ui.getAttribute("bgalazka-super-pin") === "true" &&
          runtime.panelContext?.floating?.owns(superPanel)
        ) {
          runtime.panelContext.floating.apply(superPanel);
        } else if (
          ui.getAttribute("bgalazka-super-pin") === "true" &&
          superPanel
        ) {
          const rect = superPanel.getBoundingClientRect();
          const width = Math.min(
            rect.width,
            Math.max(0, bounds.right - bounds.left - 24),
          );
          if (rect.width > width)
            setLayoutStyle(superPanel, "width", width + "px");
          setLayoutStyle(
            superPanel,
            "left",
            Math.round(
              Math.max(
                bounds.left + 12,
                Math.min(bounds.right - width - 12, rect.left),
              ),
            ) + "px",
          );
        }
        // Missing transitionend (e.g. a detached anchor) must not spin forever.
        for (const [node, props] of transitions) {
          for (const [name, deadline] of props)
            if (!node.isConnected || Date.now() >= deadline) props.delete(name);
          if (!props.size) transitions.delete(node);
        }
        if (
          transitions.size &&
          (panelVisible || ui.getAttribute("bgalazka-super-pin") === "true")
        )
          queue();
      };
      const launcherLayoutAttributes = new Set([
        "zen-right-side",
        "zen-sidebar-right",
        "zen-sidebar-collapsed",
        "zen-sidebar-expanded",
        "zen-sidebar-hidden",
        "zen-compact-mode",
        "inFullscreen",
      ]);
      const rootObserver = new MutationObserver((mutations) => {
        // Native reveal/hide changes geometry, not the launcher's DOM home.
        // Avoid moving/repainting toolbar children during Zen's animation.
        if (
          mutations.some((m) => launcherLayoutAttributes.has(m.attributeName))
        ) {
          bind();
          window.Zentral?.Apps?.scheduleRepositionGrid?.(0);
        }
        queue();
      });
      rootObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [
          "zen-right-side",
          "zen-sidebar-right",
          "zen-sidebar-collapsed",
          "zen-sidebar-expanded",
          "zen-sidebar-hidden",
          "zen-compact-mode",
          "zen-compact-navbar-visible",
          "zen-compact-sidebar-visible",
          "inFullscreen",
        ],
      });
      const transition = (event) => {
        if (!watched.has(event.target) || !geometry.test(event.propertyName))
          return;
        let props = transitions.get(event.target);
        if (
          event.type === "transitionrun" ||
          event.type === "transitionstart"
        ) {
          if (!props) transitions.set(event.target, (props = new Map()));
          props.set(event.propertyName, Date.now() + 5000);
        } else {
          props?.delete(event.propertyName);
          if (!props?.size) transitions.delete(event.target);
        }
        queue();
      };
      const prefs = {
        observe: () => {
          window.Zentral?.Apps?.scheduleRepositionGrid?.(0);
          queue();
        },
      };
      Services.prefs.addObserver("zen.view.", prefs);
      for (const type of [
        "transitionrun",
        "transitionstart",
        "transitionend",
        "transitioncancel",
      ])
        window.addEventListener(type, transition, true);
      for (const type of [
        "resize",
        "aftercustomization",
        "zen-workspace-switched",
      ])
        window.addEventListener(type, rebind);
      bind();
      update();
      disposers.push(() => {
        delete runtime.requestSidebarLayout;
        disposed = true;
        if (frame != null) window.cancelAnimationFrame(frame);
        resize.disconnect();
        anchors.disconnect();
        rootObserver.disconnect();
        Services.prefs.removeObserver("zen.view.", prefs);
        for (const type of [
          "transitionrun",
          "transitionstart",
          "transitionend",
          "transitioncancel",
        ])
          window.removeEventListener(type, transition, true);
        for (const type of [
          "resize",
          "aftercustomization",
          "zen-workspace-switched",
        ])
          window.removeEventListener(type, rebind);
        for (const name of ["--zentral-safe-left", "--zentral-safe-right"])
          document.documentElement.style.removeProperty(name);
        document.documentElement.removeAttribute("zentral-safe-layout");
        document.documentElement.removeAttribute("zentral-native-sidebar-side");
      });
    }

    return { installSidebarLayoutTracking };
  })({ runtime, getPref, disposers });
  moduleLoader.load("loader/ZentralCatalog.js");
  const {
    MANIFEST,
    CSS_MANIFEST,
    settingsSupport = true,
  } = moduleLoader.create("catalog");
  moduleLoader.diagnosticsOnly = !settingsSupport;
  moduleLoader.settingsOwners = new Set([
    "core",
    ...MANIFEST.map((item) => item.id),
  ]);
  const catalogAvailable =
    settingsSupport &&
    moduleLoader.load(
      "extension/settings/controllers/ZentralSettingsCatalog.js",
      { optional: true, owner: "settings" },
    );
  const { SETTINGS_SCHEMA, SETTINGS_ORGANIZATION } = catalogAvailable
    ? moduleLoader.create("settings-catalog", undefined, {
        optional: true,
      }) || {
        SETTINGS_SCHEMA: [],
        SETTINGS_ORGANIZATION: {
          categories: [],
          settings: {},
          availableOwners: [],
        },
      }
    : {
        SETTINGS_SCHEMA: [],
        SETTINGS_ORGANIZATION: {
          categories: [],
          settings: {},
          availableOwners: [],
        },
      };
  const releaseLab = moduleLoader.load(
    "extension/settings/controllers/ZentralReleaseLab.js",
    { optional: true, owner: "settings" },
  )
    ? moduleLoader.create(
        "release-lab",
        {
          schema: SETTINGS_SCHEMA,
          metadata: settingsMetadata,
          createRow: createSchemaSetting,
          ensureCategory: ensureSettingsCategory,
          available: settingsItemAvailable,
          runtime,
        },
        { optional: true },
      )
    : null;
  function validPanelBackingSteps(value) {
    const tokens = String(value)
      .trim()
      .split(/[,;\s]+/)
      .filter(Boolean);
    return (
      tokens.length > 0 &&
      tokens.every((token) => /^\d+$/.test(token) && Number(token) <= 100)
    );
  }
  function settingsOwnerAvailable(id) {
    // Local add-ons register their schema through addSettings rather than an
    // installed owner descriptor; only catalog-owned packages need one.
    if (moduleLoader.settingsOwners && !moduleLoader.settingsOwners.has(id))
      return true;
    return (
      !SETTINGS_ORGANIZATION.availableOwners ||
      SETTINGS_ORGANIZATION.availableOwners.includes(id)
    );
  }
  function settingsModuleLoaded(id) {
    if (!id) return true;
    if (
      (id === "core" || MANIFEST.some((item) => item.id === id)) &&
      !settingsOwnerAvailable(id)
    )
      return false;
    if (id === "core") return true;
    if (
      id === "video" &&
      typeof moduleLoader !== "undefined" &&
      moduleLoader
        .sources()
        .some(
          (row) =>
            row.file ===
              "additional/video/controllers/ZentralVideoSettings.js" &&
            row.state === "failed",
        )
    )
      return false;
    return ["active", "dormant"].includes(records.get(id)?.state);
  }
  function settingsMetadata(item) {
    return (
      SETTINGS_ORGANIZATION.settings[item.property] || {
        category: "addons",
        section: "Registered add-on settings",
        owner: item.feature || "core",
      }
    );
  }
  function settingsItemAvailable(item) {
    return settingsModuleLoaded(settingsMetadata(item).owner);
  }
  function selectSettingsCategory(modal, target) {
    // Seven shortcuts share their real preference; refresh only on navigation.
    for (const row of modal.querySelectorAll("[data-shortcut-key]")) {
      const item = SETTINGS_SCHEMA.find(
        (item) => item.property === row.dataset.shortcutKey,
      );
      if (item) {
        syncSchemaSetting(item, row);
        if (row.closest("#zs-panel-organized-release-lab")) {
          const control = row.querySelector("input,select");
          if (control) control.disabled = !settingsItemAvailable(item);
        }
      }
    }
    if (
      target === "theme-details" &&
      document.documentElement.getAttribute("bgalazka-palette-mode") !==
        "detailed"
    )
      modal
        .querySelector("#zs-panel-extension-look")
        ?._setPaletteMode?.("detailed");
    for (const button of modal.querySelectorAll(".zs-tab-btn"))
      button.setAttribute(
        "data-active",
        button.dataset.settingsCategory === target ? "true" : "false",
      );
    for (const panel of modal.querySelectorAll(".zs-tab-panel"))
      panel.setAttribute(
        "data-active",
        panel.dataset.settingsCategory === target ? "true" : "false",
      );
  }
  const settingsIcons = Object.freeze({
    home: "M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7",
    palette:
      "M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-3-4-6-9-6M7 8h.01M12 6h.01M6 13h.01",
    sliders: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
    layers: "m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4",
    text: "M4 5h16M12 5v15M8 20h8",
    window: "M3 4h18v16H3zM3 9h18M6 6.5h.01M9 6.5h.01",
    navigation: "m8 6-6 6 6 6M2 12h20M16 6l6 6-6 6",
    video: "M3 5h18v14H3zM10 9l5 3-5 3z",
    tabs: "M3 7h14v14H3zM7 3h14v14",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    menu: "M4 6h16M4 12h16M4 18h16",
    puzzle: "M3 3h6v3a3 3 0 1 0 6 0V3h6v6h-3a3 3 0 1 0 0 6h3v6H3z",
    move: "M12 2v20M2 12h20m-14-6 4-4 4 4M6 8l-4 4 4 4m12-8 4 4-4 4m-10 2 4 4 4-4",
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    folder: "M3 6V4h7l2 3h9v13H3z",
    rss: "M4 4a16 16 0 0 1 16 16M4 11a9 9 0 0 1 9 9M4 20h.01",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
    columns: "M3 4h18v16H3zM12 4v16",
    search: "M10 3a7 7 0 1 0 0 14 7 7 0 1 0 0-14m5 12 6 6",
    bell: "M5 17h14l-2-3V8a5 5 0 0 0-10 0v6zM10 21h4",
    power: "M12 2v10M6 5a9 9 0 1 0 12 0",
    keyboard:
      "M2 5h20v14H2zM5 9h.01M9 9h.01M13 9h.01M17 9h.01M5 13h.01M9 13h.01M13 13h.01M17 13h.01M8 16h8",
    list: "M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01",
    gauge: "M4 19a10 10 0 1 1 16 0M12 14l5-6M5 19h14",
    refresh: "M20 8a9 9 0 1 0 0 8M20 3v5h-5",
    flask: "M9 3h6M10 3v7L4 20h16l-6-10V3M7 15h10",
  });
  function settingsIcon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("zs-category-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", settingsIcons[name] || settingsIcons.sliders);
    svg.appendChild(path);
    return svg;
  }
  function ensureSettingsSection(modal, category, label) {
    const content = ensureSettingsCategory(modal, category).content;
    let segment = [...content.children].find(
      (node) => node.dataset.settingsSection === label,
    );
    if (!segment) {
      const detailed = category === "theme-details";
      segment = document.createElement(detailed ? "details" : "section");
      segment.className = "zs-category-segment";
      segment.dataset.settingsSection = label;
      const definition = SETTINGS_ORGANIZATION.categories.find(
        (item) => item.id === category,
      );
      const section = definition?.sections.find((item) => item.label === label);
      const heading = document.createElement(detailed ? "summary" : "h4");
      heading.append(
        settingsIcon(section?.icon || definition?.icon),
        document.createTextNode(label),
      );
      segment.appendChild(heading);
      if (detailed && label === "Text & contrast") segment.open = true;
      content.appendChild(segment);
    }
    return segment;
  }
  runtime.ensureSettingsSection = ensureSettingsSection;
  function ensureSettingsCategory(modal, id) {
    const definition = SETTINGS_ORGANIZATION.categories.find(
      (category) => category.id === id,
    );
    if (!definition) throw new Error("Unknown settings category: " + id);
    let panel = modal.querySelector("#zs-panel-organized-" + id);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "zs-panel-organized-" + id;
      panel.className = "zs-tab-panel zs-organized-panel";
      panel.dataset.settingsCategory = id;
      panel.dataset.settingsOwner = definition.owner;
      const heading = document.createElement("h3");
      heading.className = "zs-section-title";
      heading.textContent = definition.label;
      const content = document.createElement("div");
      content.className = "zs-section-content zs-organized-content";
      panel.append(heading);
      if (definition.description) {
        const description = document.createElement("p");
        description.className = "zs-category-description";
        description.textContent = definition.description;
        panel.append(description);
      }
      panel.append(content);
      modal.querySelector(".zs-body").appendChild(panel);
      const button = document.createElement("button");
      button.id = "zs-tab-btn-organized-" + id;
      button.type = "button";
      button.className = "zs-tab-btn";
      button.dataset.settingsCategory = id;
      button.append(
        settingsIcon(definition.icon),
        document.createTextNode(definition.label),
      );
      button.addEventListener("click", () => selectSettingsCategory(modal, id));
      modal.querySelector(".zs-tab-bar").appendChild(button);
      if (id !== "modules" && id !== "addons" && !definition.external) {
        const all = document.createElement("button");
        all.type = "button";
        all.className = "zs-category-all-settings";
        all.textContent =
          id === "theme"
            ? "Customize in Detailed appearance…"
            : id === "theme-details"
              ? "Return to Simple controls"
              : "All " + definition.label.toLowerCase() + " settings";
        all.title =
          "Open every setting in this category, including advanced values";
        all.addEventListener("click", () => {
          if (id === "theme") {
            modal
              .querySelector("#zs-panel-extension-look")
              ?._setPaletteMode?.("detailed");
            selectSettingsCategory(modal, "theme-details");
          } else if (id === "theme-details") {
            modal
              .querySelector("#zs-panel-extension-look")
              ?._setPaletteMode?.("simple");
            selectSettingsCategory(modal, "theme");
          } else openManager(id);
        });
        panel.appendChild(all);
      }
    }
    return {
      panel,
      button: modal.querySelector("#zs-tab-btn-organized-" + id),
      content: panel.querySelector(".zs-organized-content"),
    };
  }
  runtime.ensureSettingsCategory = ensureSettingsCategory;
  runtime.selectSettingsCategory = selectSettingsCategory;
  runtime.settingsModuleLoaded = settingsModuleLoaded;
  runtime.settingsOwnerAvailable = settingsOwnerAvailable;
  runtime.settingsMetadata = settingsMetadata;
  function settingsCategoryAvailable(category) {
    if (!category) return false;
    if (category.id === "release-lab") return !!releaseLab;
    if (category.external)
      return runtime.externalSettingsCategories?.has(category.id) === true;
    return SETTINGS_SCHEMA.some(
      (item) =>
        settingsMetadata(item).category === category.id &&
        settingsItemAvailable(item),
    );
  }
  function setSettingsUnavailable(node, unavailable) {
    if (unavailable) {
      if (!Object.hasOwn(node.dataset, "settingsUnavailable"))
        node.dataset.settingsUnavailable = String(node.hidden);
      node.hidden = true;
    } else if (Object.hasOwn(node.dataset, "settingsUnavailable")) {
      node.hidden = node.dataset.settingsUnavailable === "true";
      delete node.dataset.settingsUnavailable;
    }
  }
  // Settings structure is stable between UI/feature changes. Reopening only
  // refreshes schema controls; it does not move hundreds of live DOM nodes.
  // Settings construction has one owner and a fixed order, independent of
  // feature activation order. No module replaces another module's open hook.
  const settingsOpenHooks = new Map();
  let assemblingSettings = false;
  runtime.registerSettingsHook = (id, order, build) => {
    if (typeof build !== "function")
      throw new TypeError("Settings hook must be callable");
    const hook = { order, build };
    settingsOpenHooks.set(id, hook);
    runtime.invalidateSettingsLayout?.();
    const modal = document.getElementById("zentral-settings-modal");
    if (!assemblingSettings && modal?.getAttribute("data-open") === "true")
      assembleSettings(modal);
    return () => {
      if (settingsOpenHooks.get(id) === hook) {
        settingsOpenHooks.delete(id);
        runtime.invalidateSettingsLayout?.();
      }
    };
  };
  function assembleSettings(modal) {
    if (!modal || assemblingSettings) return;
    const failures = [];
    runtime.settingsLayoutStatus = { stage: "building controls", failures };
    assemblingSettings = true;
    try {
      for (const [id, hook] of [...settingsOpenHooks].sort(
        (a, b) => a[1].order - b[1].order,
      )) {
        try {
          hook.build();
        } catch (error) {
          failures.push({ owner: id, error: String(error) });
          console.error("[Zentral] Settings controls failed:", id, error);
        }
      }
    } finally {
      assemblingSettings = false;
    }
    runtime.settingsLayoutStatus.stage = "arranging categories";
    try {
      organizeNativeSettings(modal);
      runtime.settingsLayoutStatus.stage = failures.length
        ? "ready with fallback controls"
        : "ready";
    } catch (error) {
      runtime.settingsLayoutStatus.stage = "failed";
      runtime.settingsLayoutStatus.error = String(error);
      throw error;
    }
  }
  disposers.push(() => settingsOpenHooks.clear());
  const settingsLayouts = new WeakMap();
  let settingsLayoutRevision = 0;
  runtime.invalidateSettingsLayout = () => {
    settingsLayoutRevision++;
  };
  function syncSchemaSetting(item, row) {
    const input = row.querySelector("input, select");
    if (!input || document.activeElement === input) return;
    const value = Core.getPref(item.property, item.defaultValue);
    if (input.type === "checkbox") {
      if (input.checked !== value) input.checked = value;
    } else {
      if (
        item.type === "dropdown" &&
        ![...input.options].some((option) => option.value === String(value))
      ) {
        const option = document.createElement("option");
        option.value = String(value);
        option.textContent = String(value) + " (current)";
        input.appendChild(option);
      }
      if (input.value !== String(value)) input.value = value;
    }
  }
  function createSchemaSetting(item, meta) {
    const key = item.property;
    const row = document.createElement("div");
    row.className = "zs-row zs-schema-row";
    row.dataset.settingKey = key;
    row.dataset.settingsOwner = meta.owner;
    row.dataset.schemaFallback = "true";
    const label = document.createElement("label");
    label.className = "zs-label";
    label.textContent = item.label;
    const input = document.createElement(
      item.type === "dropdown" ? "select" : "input",
    );
    input.id = "zs-schema-" + key.replace(/[^a-z0-9_-]/gi, "-");
    label.htmlFor = input.id;
    input.setAttribute("aria-label", item.label);
    if (item.type === "dropdown") {
      input.className = "zs-select-input";
      for (const option of item.options || []) {
        const el = document.createElement("option");
        el.value = String(option.value);
        el.textContent = option.label;
        input.appendChild(el);
      }
    } else {
      input.type =
        item.type === "checkbox"
          ? "checkbox"
          : typeof item.defaultValue === "number"
            ? "number"
            : "text";
      if (input.type !== "checkbox") input.className = "zs-text-input";
    }
    input.addEventListener("change", () => {
      let value = input.type === "checkbox" ? input.checked : input.value;
      if (typeof item.defaultValue === "number") value = Number(value);
      const valid =
        (typeof value !== "number" || Number.isInteger(value)) &&
        (!item.label.includes("#RRGGBB") || /^#[0-9a-fA-F]{6}$/.test(value));
      input.setCustomValidity(
        valid
          ? ""
          : "Enter a valid value; the previous setting is still saved.",
      );
      if (!valid) {
        input.reportValidity?.();
        return;
      }
      if (
        key === "zen.workspace.bgalazka.look.palette_mode" &&
        runtime.panelContext?.setLookPaletteMode
      )
        runtime.panelContext.setLookPaletteMode(value);
      else {
        Core.setPref(key, value);
        runtime.panelContext?.syncSettingsAfterImport?.(key);
      }
    });
    row.appendChild(label);
    if (item.type === "checkbox") {
      const control = document.createElement("label");
      control.className = "zs-switch";
      const slider = document.createElement("span");
      slider.className = "zs-slider";
      control.append(input, slider);
      row.appendChild(control);
    } else row.appendChild(input);
    return row;
  }
  function ensureSettingsCoverage(modal) {
    const present = new Map(
      [...modal.querySelectorAll("[data-setting-key]")].map((row) => [
        row.dataset.settingKey,
        row,
      ]),
    );
    const fallbacks = [];
    for (const item of SETTINGS_SCHEMA) {
      const key = item.property,
        meta = settingsMetadata(item);
      if (
        !key ||
        !settingsItemAvailable(item) ||
        ["modules", "addons"].includes(meta.category)
      )
        continue;
      const old = present.get(key);
      if (old && !old.dataset.schemaFallback) continue;
      const row = old || createSchemaSetting(item, meta);
      if (!old) {
        const content =
          meta.category === "logging"
            ? modal.querySelector("#zs-panel-diagnostics")
            : ensureSettingsSection(modal, meta.category, meta.section);
        content?.appendChild(row);
      }
      syncSchemaSetting(item, row);
      fallbacks.push({ item, row });
    }
    return fallbacks;
  }
  function ensureFeatureShortcuts(modal) {
    const destinations = {
      "zen.workspace.apps.sidebar.enabled": [
        "apps",
        "Launcher grid & placement",
      ],
      "zen.workspace.tabgroups.enabled": [
        "tab-groups",
        "Group behavior & indicators",
      ],
      "zen.workspace.zentral.video_preview.enabled": [
        "video-playback",
        "Playback & captions",
      ],
      "zen.workspace.zentral.startup.enabled": [
        "startup",
        "Panel background loading",
      ],
      "zen.workspace.bgalazka.corner_tiles": [
        "tab-panels",
        "Launchers, loaded state & badges",
      ],
      "zen.workspace.bgalazka.web_toolbar_enabled": [
        "theme-details",
        "Navigation toolbar",
      ],
      "zen.workspace.bgalazka.mmb_unload_normal_tabs": [
        "shortcuts",
        "Panel shortcuts & mouse actions",
      ],
    };
    const shortcuts = [];
    const existing = new Map(
      [...modal.querySelectorAll("[data-shortcut-key]")].map((row) => [
        row.dataset.shortcutKey,
        row,
      ]),
    );
    for (const item of SETTINGS_SCHEMA) {
      const destination = destinations[item.property];
      if (!destination || !settingsItemAvailable(item)) continue;
      // The catalog removes empty/failed owner sections. Optional shortcuts must
      // not abort the entire settings layout when their destination is absent.
      const category = SETTINGS_ORGANIZATION.categories.find(
        (category) => category.id === destination[0],
      );
      if (
        !category?.sections.some((section) => section.label === destination[1])
      )
        continue;
      const meta = settingsMetadata(item);
      let row = existing.get(item.property);
      if (!row) {
        row = createSchemaSetting(item, meta);
        delete row.dataset.settingKey;
        delete row.dataset.schemaFallback;
        row.dataset.shortcutKey = item.property;
        const input = row.querySelector("input");
        input.id += "-shortcut";
        row.querySelector("label").htmlFor = input.id;
        input.addEventListener("change", () => {
          for (const original of modal.querySelectorAll("[data-setting-key]"))
            if (original.dataset.settingKey === item.property)
              syncSchemaSetting(item, original);
        });
      }
      const section = ensureSettingsSection(modal, ...destination);
      if (row.parentElement !== section)
        section.insertBefore(row, section.children[1] || null);
      syncSchemaSetting(item, row);
      shortcuts.push({ item, row });
    }
    return shortcuts;
  }
  function orderSettingsNodes(parent, nodes) {
    const wanted = new Set(nodes);
    const existing = [...parent.children].filter((node) => wanted.has(node));
    if (
      existing.length === nodes.length &&
      existing.every((node, index) => node === nodes[index])
    )
      return;
    for (const node of nodes) parent.appendChild(node);
  }
  function organizeNativeSettings(modal) {
    if (assemblingSettings) return;
    if (!modal?.querySelector(".zs-body")) return;
    const layout = settingsLayouts.get(modal);
    if (
      layout?.revision === settingsLayoutRevision &&
      layout.schemaLength === SETTINGS_SCHEMA.length &&
      layout.rowCount === modal.querySelectorAll("[data-setting-key]").length
    ) {
      for (const { item, row } of layout.fallbacks)
        syncSchemaSetting(item, row);
      syncAppearanceNavigation(modal);
      try {
        releaseLab?.render(modal);
      } catch (error) {
        console.warn("[Zentral] Release settings refresh", error);
      }
      return;
    }
    const bar = modal.querySelector(".zs-tab-bar");
    // Existing controls are moved, preserving their handlers, recorder state,
    // live saves, and parent visibility rules. No preference values are rewritten.
    for (const [id, category] of [
      ["zs-ag-col", "apps"],
      ["zs-tg-col", "tab-groups"],
    ]) {
      const column = modal.querySelector("#" + id);
      if (column) {
        if (
          !SETTINGS_ORGANIZATION.categories.some((item) => item.id === category)
        ) {
          column.hidden = true;
          continue;
        }
        const target = ensureSettingsCategory(modal, category).content;
        if (column.parentElement !== target) target.appendChild(column);
      }
    }
    const baseKeys = {
      "zs-ag-enabled": "apps.sidebar.enabled",
      "zs-ag-placement": "apps.sidebar.placement",
      "zs-apps-row": "apps.sidebar.apps_per_row",
      "zs-max-rows": "apps.sidebar.max_rows",
      "zs-max-apps": "apps.sidebar.max_apps",
      "zs-hide-utility-section": "apps.sidebar.hide_utility_section",
      "zs-ag-autohide": "apps.sidebar.autohide",
      "zs-panel-width": "apps.sidebar.width",
      "zs-anim-type": "apps.sidebar.animation_type",
      "zs-anim-speed": "apps.sidebar.animation_speed",
      "zs-insta-peek-shortcut": "apps.insta_peek.shortcut",
      "zs-tg-enabled": "tabgroups.enabled",
      "zs-tg-collapse": "tabgroups.collapse_on_launch",
      "zs-tg-thumbnails": "tabgroups.thumbnails",
      "zs-tg-chevron": "tabgroups.show_chevron",
      "zs-tg-indicator-type": "tabgroups.indicator_type",
      "zs-tg-opacity": "tabgroups.label_opacity",
    };
    for (const [id, suffix] of Object.entries(baseKeys)) {
      const input = modal.querySelector("#" + id);
      const row = input?.closest(".zs-row, .zs-stacked-slider");
      if (row) row.dataset.settingKey = "zen.workspace." + suffix;
    }
    // Ensure even advanced settings absent from legacy UI have a category route.
    for (const category of SETTINGS_ORGANIZATION.categories) {
      if (category.id === "logging" || !settingsCategoryAvailable(category))
        continue;
      const target = ensureSettingsCategory(modal, category.id);
      if (
        ["modules", "addons"].includes(category.id) &&
        !target.content.children.length
      ) {
        const route = document.createElement("button");
        route.type = "button";
        route.textContent =
          category.id === "modules"
            ? "Manage modules and CSS files"
            : "Manage local add-ons";
        route.addEventListener("click", () => openManager(category.id));
        target.content.appendChild(route);
      }
    }
    for (const [id, key] of Object.entries({
      enabled: "zen.workspace.zentral.debug",
      full: "zen.workspace.zentral.debug.full",
      core: "zen.workspace.zentral.debug.core",
      tabs: "zen.workspace.zentral.debug.tabs",
      apps: "zen.workspace.zentral.debug.apps",
      menus: "zen.workspace.zentral.debug.menus",
      layout: "zen.workspace.zentral.debug.layout",
      path: "zen.workspace.zentral.logger.path",
    })) {
      const row = modal
        .querySelector("#zs-pref-logger-" + id)
        ?.closest(".zs-row");
      if (row) row.dataset.settingKey = key;
    }
    // A late feature UI replaces a temporary schema row without duplicate controls.
    const videoKeys = new Set(
      [
        ...modal.querySelectorAll(
          '[data-video-settings="row"][data-setting-key]',
        ),
      ].map((row) => row.dataset.settingKey),
    );
    for (const row of modal.querySelectorAll("[data-setting-key]"))
      if (
        videoKeys.has(row.dataset.settingKey) &&
        row.dataset.videoSettings !== "row"
      )
        row.remove();
    const realKeys = new Set(
      [...modal.querySelectorAll("[data-setting-key]")]
        .filter((row) => !row.dataset.schemaFallback)
        .map((row) => row.dataset.settingKey),
    );
    for (const row of modal.querySelectorAll("[data-schema-fallback]"))
      if (realKeys.has(row.dataset.settingKey)) row.remove();
    const seen = new Set();
    const units = new Set();
    for (const row of [...modal.querySelectorAll("[data-setting-key]")]) {
      const meta = SETTINGS_ORGANIZATION.settings[row.dataset.settingKey];
      if (!meta) {
        setSettingsUnavailable(row, true);
        continue;
      }
      const category = SETTINGS_ORGANIZATION.categories.find(
        (category) => category.id === meta.category,
      );
      if (
        !category?.sections.some((section) => section.label === meta.section)
      ) {
        setSettingsUnavailable(row, true);
        continue;
      }
      if (meta.category === "logging") continue;
      if (row.dataset.videoSettings === "row") {
        const segment = ensureSettingsSection(
          modal,
          meta.category,
          meta.section,
        );
        if (row.parentElement !== segment) segment.appendChild(row);
        continue;
      }
      // Video's complex controls are grouped by its own module. Its shared
      // appearance controls use the same category identity and lifecycle.
      if (seen.has(row.dataset.settingKey)) {
        row.remove();
        continue;
      }
      seen.add(row.dataset.settingKey);
      row.dataset.settingsOwner = meta.owner;
      let unit = row;
      for (
        let parent = row.parentElement;
        parent && !parent.classList.contains("zs-section-content");
        parent = parent.parentElement
      ) {
        if (
          !parent.classList.contains("zs-conditional-group") &&
          !parent.classList.contains("zs-look-group")
        )
          continue;
        const members = [...parent.querySelectorAll("[data-setting-key]")];
        if (
          members.every((member) => {
            const memberMeta =
              SETTINGS_ORGANIZATION.settings[member.dataset.settingKey];
            return (
              memberMeta?.category === meta.category &&
              memberMeta.section === meta.section
            );
          })
        )
          unit = parent;
      }
      if (units.has(unit)) continue;
      units.add(unit);
      const segment = ensureSettingsSection(modal, meta.category, meta.section);
      if (unit.parentElement !== segment) segment.appendChild(unit);
    }
    const fallbacks = ensureSettingsCoverage(modal);
    fallbacks.push(...ensureFeatureShortcuts(modal));
    // Non-setting actions and explanatory status remain next to their controls.
    for (const [selector, category] of [
      [".zs-look-themes, .zs-look-transfer", "theme"],
      [".zs-full-backup", "essentials"],
      [".zs-extension-presets", "recovery"],
      ["#zs-addon-host-inspection", "compatibility"],
    ]) {
      const target = modal.querySelector(
        "#zs-panel-organized-" + category + " .zs-organized-content",
      );
      if (target)
        for (const node of [...modal.querySelectorAll(selector)])
          if (
            node.classList.contains("zs-full-backup") ||
            (category === "theme" && node.classList.contains("zs-look-themes"))
          ) {
            if (target.firstChild !== node)
              target.insertBefore(node, target.firstChild);
          } else if (
            category === "theme" &&
            node.classList.contains("zs-look-transfer")
          ) {
            if (target.lastChild !== node) target.appendChild(node);
          } else if (node.parentElement !== target && !target.contains(node))
            target.appendChild(node);
    }
    // Only retire the old extension pages once their controls were built.
    for (const button of modal.querySelectorAll(
      '#zs-tab-btn-bgalazka, [id^="zs-tab-btn-extension-"]',
    )) {
      button.hidden = true;
      button.setAttribute("data-active", "false");
    }
    const original = modal.querySelector('.zs-tab-btn[data-tab="settings"]');
    if (original) {
      original.hidden = true;
      original.setAttribute("data-active", "false");
    }
    for (const panel of modal.querySelectorAll(
      "#zs-panel-settings, #zs-panel-bgalazka, .zs-extension-subpanel",
    ))
      panel.setAttribute("data-active", "false");
    const logs = modal.querySelector('.zs-tab-btn[data-tab="diagnostics"]');
    if (logs) {
      logs.replaceChildren(
        settingsIcon("list"),
        document.createTextNode("Logs & Diagnostics"),
      );
      logs.dataset.settingsCategory = "logging";
      logs.hidden = !settingsModuleLoaded("logger");
    }
    const logPanel = modal.querySelector("#zs-panel-diagnostics");
    if (logPanel) logPanel.dataset.settingsCategory = "logging";
    const ranks = new Map(
      SETTINGS_SCHEMA.map((item, index) => [item.property, index]),
    );
    const rankCache = new WeakMap();
    const rank = (node) => {
      if (!rankCache.has(node))
        rankCache.set(
          node,
          Math.min(
            ...[node, ...node.querySelectorAll("[data-setting-key]")].map(
              (row) => ranks.get(row.dataset.settingKey) ?? Infinity,
            ),
          ),
        );
      return rankCache.get(node);
    };
    for (const category of SETTINGS_ORGANIZATION.categories) {
      const target = modal.querySelector("#zs-panel-organized-" + category.id);
      const button = modal.querySelector(
        "#zs-tab-btn-organized-" + category.id,
      );
      if (!target || !button) continue;
      const available = settingsCategoryAvailable(category);
      button.hidden = !available;
      if (!available) target.setAttribute("data-active", "false");
      for (const row of target.querySelectorAll("[data-settings-owner]"))
        setSettingsUnavailable(
          row,
          !settingsModuleLoaded(row.dataset.settingsOwner),
        );
      const sectionOrder = new Map(
        category.sections.map((section, index) => [section.label, index]),
      );
      const content = target.querySelector(".zs-organized-content");
      for (const segment of content.querySelectorAll(".zs-category-segment")) {
        const definition = category.sections.find(
          (section) => section.label === segment.dataset.settingsSection,
        );
        segment.hidden =
          !category.external &&
          !category.virtual &&
          !definition?.properties.some((property) =>
            settingsItemAvailable({ property }),
          );
        // Move whole units so conditional groups and their event handlers remain intact.
        orderSettingsNodes(
          segment,
          [...segment.children]
            .filter((node) => !["h4", "summary"].includes(node.localName))
            .sort((a, b) => rank(a) - rank(b)),
        );
      }
      const sections = [...content.children].filter((node) =>
        node.classList.contains("zs-category-segment"),
      );
      orderSettingsNodes(
        content,
        sections.sort(
          (a, b) =>
            (sectionOrder.get(a.dataset.settingsSection) ?? Infinity) -
            (sectionOrder.get(b.dataset.settingsSection) ?? Infinity),
        ),
      );
      if (category.id === "theme") {
        const transfer = content.querySelector(".zs-look-transfer");
        if (transfer && content.lastChild !== transfer)
          content.appendChild(transfer);
      }
    }
    for (const heading of bar.querySelectorAll(".zs-category-heading"))
      heading.remove();
    let group = null;
    for (const definition of SETTINGS_ORGANIZATION.categories) {
      const button =
        definition.id === "logging"
          ? logs
          : modal.querySelector("#zs-tab-btn-organized-" + definition.id);
      if (!button || button.hidden) continue;
      if (group !== definition.group) {
        group = definition.group;
        const heading = document.createElement("span");
        heading.className = "zs-category-heading";
        heading.textContent = group;
        bar.appendChild(heading);
      }
      bar.appendChild(button);
    }
    if (!bar.dataset.organizedGuard) {
      bar.dataset.organizedGuard = "true";
      bar.addEventListener(
        "click",
        (event) => {
          const clicked = event.target.closest?.(".zs-tab-btn");
          if (clicked?.dataset.settingsCategory)
            selectSettingsCategory(modal, clicked.dataset.settingsCategory);
        },
        true,
      );
    }
    if (!modal.dataset.settingsStarted) {
      modal.dataset.settingsStarted = "true";
      selectSettingsCategory(modal, "essentials");
    }
    if (!modal.querySelector('.zs-tab-btn[data-active="true"]:not([hidden])')) {
      const first = bar.querySelector(
        ".zs-tab-btn[data-settings-category]:not([hidden])",
      );
      if (first) selectSettingsCategory(modal, first.dataset.settingsCategory);
    }
    syncAppearanceNavigation(modal);
    if (!bar.querySelector("#zs-settings-search")) {
      const search = document.createElement("input");
      search.id = "zs-settings-search";
      search.type = "search";
      search.placeholder = "Find a setting";
      search.setAttribute("aria-label", "Search all available settings");
      const results = document.createElement("div");
      results.id = "zs-settings-search-results";
      results.hidden = true;
      search.addEventListener("input", () => {
        results.replaceChildren();
        const query = search.value.trim().toLowerCase();
        results.hidden = !query;
        if (!query) return;
        const matches = SETTINGS_SCHEMA.filter(
          (item) =>
            item.property &&
            settingsItemAvailable(item) &&
            (
              item.label +
              " " +
              item.property +
              " " +
              SETTINGS_ORGANIZATION.categories.find(
                (category) => category.id === settingsMetadata(item).category,
              )?.label
            )
              .toLowerCase()
              .includes(query),
        );
        for (const item of matches) {
          const meta = settingsMetadata(item),
            definition = SETTINGS_ORGANIZATION.categories.find(
              (category) => category.id === meta.category,
            );
          const result = document.createElement("button");
          result.type = "button";
          result.textContent = item.label + " · " + definition.label;
          result.addEventListener("click", () => {
            const row = [...modal.querySelectorAll("[data-setting-key]")].find(
              (row) => row.dataset.settingKey === item.property,
            );
            const category = modal.querySelector(
              "#zs-panel-organized-" + meta.category,
            );
            if (meta.category === "theme-details")
              modal
                .querySelector("#zs-panel-extension-look")
                ?._setPaletteMode?.("detailed");
            if (
              row &&
              category &&
              !row.closest('[data-hidden="true"], [hidden]')
            ) {
              selectSettingsCategory(modal, meta.category);
              for (
                let parent = row.parentElement;
                parent && parent !== modal;
                parent = parent.parentElement
              )
                if (parent.localName === "details") parent.open = true;
              row.scrollIntoView({ block: "center" });
              const control = row.querySelector("input, select, button");
              control?.focus();
            } else openManager(meta.category, item.property);
          });
          results.appendChild(result);
        }
        if (!matches.length)
          results.textContent = "No matching settings in loaded modules.";
      });
      bar.prepend(search, results);
    }
    try {
      releaseLab?.render(modal);
    } catch (error) {
      console.warn("[Zentral] Optional release settings view failed", error);
    }
    settingsLayouts.set(modal, {
      revision: settingsLayoutRevision,
      schemaLength: SETTINGS_SCHEMA.length,
      rowCount: modal.querySelectorAll("[data-setting-key]").length,
      fallbacks,
    });
    // Commit only after navigation, shortcuts and every category are ready.
    modal
      .querySelector(".zs-dialog")
      ?.setAttribute("data-settings-organized", "true");
  }
  function syncAppearanceNavigation(
    modal = document.getElementById("zentral-settings-modal"),
  ) {
    if (!modal) return;
    const detailed =
      document.documentElement.getAttribute("bgalazka-palette-mode") ===
      "detailed";
    const button = modal.querySelector("#zs-tab-btn-organized-theme-details");
    if (button) {
      const hidden =
        !detailed ||
        !settingsCategoryAvailable(
          SETTINGS_ORGANIZATION.categories.find(
            (c) => c.id === "theme-details",
          ),
        );
      if (button.hidden !== hidden) button.hidden = hidden;
    }
    if (
      !detailed &&
      modal.querySelector(
        '#zs-panel-organized-theme-details[data-active="true"]',
      )
    )
      selectSettingsCategory(modal, "theme");
  }
  runtime.syncAppearanceNavigation = syncAppearanceNavigation;
  runtime.organizeSettings = organizeNativeSettings;
  const refreshSettingsCategories = () => {
    settingsLayoutRevision++;
    const modal = document.getElementById("zentral-settings-modal");
    if (modal?.getAttribute("data-open") === "true")
      organizeNativeSettings(modal);
  };
  window.addEventListener("zentral-runtime-change", refreshSettingsCategories);
  disposers.push(() =>
    window.removeEventListener(
      "zentral-runtime-change",
      refreshSettingsCategories,
    ),
  );

  moduleLoader.load("loader/ZentralShared.js");
  const {
    Constants,
    Core,
    createSVGElement,
    SVG_STRINGS,
    WELL_KNOWN_SERVICES,
  } = moduleLoader.create("shared", { Services, runtime });
  const shellAvailable =
    settingsSupport &&
    moduleLoader.load(
      "extension/settings/controllers/ZentralSettingsShell.js",
      {
        optional: true,
        owner: "settings",
      },
    );
  const Settings = (shellAvailable
    ? moduleLoader.create(
        "settings-shell",
        {
          Services,
          Core,
          Constants,
          createSVGElement,
          SVG_STRINGS,
          WELL_KNOWN_SERVICES,
          runtime,
        },
        { optional: true },
      )
    : null) || {
    open: () => moduleLoader.showDiagnostics(),
    destroy() {},
    close() {},
  };
  const openNativeSettings = Settings.open.bind(Settings);
  Settings.open = function (...args) {
    const result = openNativeSettings(...args);
    assembleSettings(document.getElementById("zentral-settings-modal"));
    return result;
  };
  disposers.push(() => Settings.destroy());
  window.Zentral = { Core, Settings };
  window.ZentralSettingsInstance = Settings;
  runtime.shared = {
    Constants,
    Core,
    createSVGElement,
    SVG_STRINGS,
    WELL_KNOWN_SERVICES,
  };
  const extensionSettingsAvailable =
    settingsSupport &&
    moduleLoader.load(
      "extension/settings/controllers/ZentralFeatureSettings.js",
      { optional: true, owner: "extension-settings" },
    );
  if (extensionSettingsAvailable)
    moduleLoader.create(
      "feature-settings",
      {
        Services,
        ZentralRuntime,
        Core,
        Settings,
        Constants,
        organizeNativeSettings,
        validPanelBackingSteps,
        SETTINGS_SCHEMA,
        SETTINGS_ORGANIZATION,
        selectSettingsCategory,
        arcSidebarPref,
        arcLibraryPref,
      },
      { optional: true },
    );
  // UI-only native controls join the shared settings assembly before layout.
  // Their browser preferences are deliberately outside SETTINGS_SCHEMA/defaults.
  if (
    settingsSupport &&
    moduleLoader.load(
      "extension/settings/controllers/ZentralNativeBrowserSettings.js",
      { optional: true, owner: "settings" },
    )
  )
    moduleLoader.create(
      "native-browser-settings",
      { Services, runtime, disposers },
      { optional: true },
    );
  const developerAvailable =
    settingsSupport &&
    moduleLoader.load(
      "extension/settings/controllers/ZentralDeveloperSettings.js",
      { optional: true, owner: "settings" },
    );
  const developer = developerAvailable
    ? moduleLoader.create(
        "developer-settings",
        {
          Services,
          Core,
          Settings,
          runtime,
          records,
          styles,
          MANIFEST,
          CSS_MANIFEST,
          SETTINGS_SCHEMA,
          SETTINGS_ORGANIZATION,
          getPref,
          setPref,
          enabled,
          unsafeCoreDisabled,
          protectedModules,
          protectedCSS,
          PREF,
          ROOT,
          VERSION,
          disposers,
          settingsMetadata,
          settingsItemAvailable,
          selectSettingsCategory,
          organizeNativeSettings,
          validateAddons,
          unsafeCorePref,
        },
        { optional: true },
      )
    : null;
  function openManager(...args) {
    return developer
      ? developer.openManager(...args)
      : moduleLoader.showDiagnostics();
  }
  function validateAddons(list) {
    if (!Array.isArray(list)) throw new Error("Add-ons must be an array");
    const known = new Set(MANIFEST.map((m) => m.id));
    for (const x of list) {
      if (!x || !/^addon-[a-z0-9-]+$/.test(x.id) || known.has(x.id))
        throw new Error("Use a unique id starting with addon-");
      if (
        !/^(?:JS|CSS|settings|loader|zentral|extension|additional)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.uc)?\.js$/.test(
          x.file,
        )
      )
        throw new Error(
          "Add-on JS must use a local JS/, loader/, zentral/, extension/ or additional/ path",
        );
      if (x.requires && !Array.isArray(x.requires))
        throw new Error("requires must be an array");
      if (
        x.css &&
        (!Array.isArray(x.css) ||
          x.css.some(
            (p) =>
              !/^(?:CSS|loader|zentral|extension|additional)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.css$/.test(
                p,
              ),
          ))
      )
        throw new Error(
          "CSS must use local CSS/, loader/, zentral/, extension/ or additional/ stylesheet paths",
        );
      known.add(x.id);
    }
    return list;
  }
  // Base-feature toggles own their sheets as well as their JavaScript hooks.
  function syncOwnerStyles(id) {
    for (const row of styles.values()) {
      const owners = row.owners || (row.owner ? [row.owner] : []);
      if (!owners.includes(id)) continue;
      const available = owners.some((owner) =>
        owner === "settings"
          ? moduleLoader.has("settings-shell")
          : availability.get(owner) !== false &&
            ["registered", "initializing", "active", "dormant"].includes(
              records.get(owner)?.state,
            ),
      );
      if (!available && row.state === "loaded") {
        try {
          window.windowUtils.removeSheet(
            row.uri,
            window.windowUtils.USER_SHEET,
          );
          row.state = "blocked";
          row.reason = "Owner feature disabled";
        } catch (error) {
          console.warn(
            "[Zentral] Could not remove owner stylesheet",
            row.id,
            error,
          );
        }
      } else if (available && row.state === "blocked") {
        loadCSS(row);
      }
    }
  }
  async function loadCSS(spec) {
    if (stopped) return;
    const row = { ...spec, state: "loading" };
    styles.set(spec.id, row);
    const owners = spec.owners || (spec.owner ? [spec.owner] : []);
    if (
      owners.length &&
      !owners.some((id) =>
        id === "settings"
          ? moduleLoader.has("settings-shell")
          : availability.get(id) !== false &&
            ["registered", "initializing", "active", "dormant"].includes(
              records.get(id)?.state,
            ),
      )
    ) {
      row.state = "blocked";
      row.reason = "Owner source unavailable or disabled";
      return;
    }

    if (
      !(
        protectedCSS.has(spec.legacyControl || spec.id) && !unsafeCoreDisabled()
      ) &&
      !getPref(
        PREF + "css." + (spec.legacyControl || spec.id) + ".enabled",
        true,
      )
    ) {
      row.state = "disabled";
      return;
    }
    try {
      row.uri = Services.io.newURI(ROOT + spec.file);
      window.windowUtils.loadSheet(row.uri, window.windowUtils.USER_SHEET);
      row.state = "loaded";
      disposers.push(() => {
        try {
          window.windowUtils.removeSheet(
            row.uri,
            window.windowUtils.USER_SHEET,
          );
        } catch (_) {}
      });
    } catch (e) {
      row.state = "failed";
      row.error = String(e);
      console.error("[Zentral] Stylesheet failed:", spec.file, e);
    }
  }
  // Resume features when an initially disabled base engine becomes available.
  let activating = false,
    activationRequested = false;
  function activateReady() {
    if (!activationReady || stopped) return;
    if (activating) {
      activationRequested = true;
      return;
    }
    activating = true;
    try {
      // Topological startup with no timed retries. Independent features still start
      // when another feature is disabled, missing, throws, or has a dependency cycle.
      let progress = true;
      while (progress) {
        progress = false;
        activationRequested = false;
        for (const m of MANIFEST) {
          const r = records.get(m.id);
          if (m.part || !["registered", "blocked"].includes(r.state)) continue;
          const deps = m.requires || [],
            sourceDeps = m.sources || [];
          if (deps.some((id) => records.get(id)?.state !== "active")) continue;
          if (
            sourceDeps.some(
              (id) =>
                !MANIFEST.find((part) => part.id === id)?.optional &&
                !["registered", "active", "blocked"].includes(
                  records.get(id)?.state,
                ),
            )
          )
            continue;
          // The full pack owns every feature. A separately installed standalone
          // copy (additional/<module> via Sine) must release its hooks first so
          // native Library/tab code is never hooked twice.
          try {
            window.__zentralStandalone?.[m.id]?.dispose?.();
          } catch (error) {
            console.warn("[Zentral] standalone copy cleanup", m.id, error);
          }
          r.state = "initializing";
          const lifecycle = createFeatureScope(m.id);
          featureScopes.set(m.id, lifecycle);
          disposers.push(() => lifecycle.destroy());
          try {
            const cleanup = definitions.get(m.id).init({
              lifecycle,
              shared: runtime.shared,
              services: runtime.services,
              runtime,
            });
            if (cleanup && typeof cleanup.then === "function") {
              Promise.resolve(cleanup).then(
                (late) => {
                  if (typeof late === "function") lifecycle.own(late);
                  else if (late?.destroy) lifecycle.own(() => late.destroy());
                },
                (error) =>
                  console.warn("[Zentral] Rejected async init", m.id, error),
              );
              throw new Error(
                "init must be synchronous; use lifecycle.watchNative within a feature",
              );
            }
            if (typeof cleanup === "function") lifecycle.own(cleanup);
            else if (cleanup) {
              runtime.services[m.id] = cleanup;
              lifecycle.own(() => {
                if (runtime.services[m.id] === cleanup)
                  delete runtime.services[m.id];
                cleanup.destroy?.();
              });
            }
            if (stopped) {
              lifecycle.destroy();
              r.state = "stopped";
              return;
            }
            if (r.state === "failed") {
              lifecycle.destroy();
              continue;
            }
            const verify = definitions.get(m.id).verify;
            if (
              verify &&
              verify({
                runtime,
                shared: runtime.shared,
                services: runtime.services,
              }) !== true
            )
              throw new Error("Initialization postcondition failed: " + m.id);
            r.initialized = true;
            r.verified = !!verify;
            r.state = availability.get(m.id) === false ? "dormant" : "active";
            r.reason = undefined;
          } catch (e) {
            lifecycle.destroy();
            fail(r, e);
            if (m.id === "panels") {
              try {
                runtime.panelContext?.cleanupFns
                  ?.splice(0)
                  .reverse()
                  .forEach((fn) => {
                    try {
                      fn();
                    } catch (_) {}
                  });
              } catch (_) {}
              window.BgalazkaExtensionInitialized = false;
              for (const p of MANIFEST.filter((x) => x.part)) {
                const pr = records.get(p.id);
                if (pr.state === "active") pr.state = "stopped";
              }
            }
          }
          progress = true;
          emit();
        }
        progress ||= activationRequested;
      }
      for (const r of records.values())
        if (r.state === "registered" || r.state === "blocked") {
          r.state = "blocked";
          r.reason = r.part
            ? "Panel coordinator did not start"
            : [...(r.requires || []), ...(r.sources || [])]
                .filter((id) => records.get(id)?.state !== "active")
                .join(", ") || "Dependency cycle";
        }
    } finally {
      activating = false;
      if (!stopped) for (const id of records.keys()) syncOwnerStyles(id);
    }
  }
  async function waitForNativeStartup() {
    const seen = new Set();
    const warnings = (runtime.nativeReadinessWarnings = []);
    let session = window.SessionStore;
    if (!session) {
      try {
        session = ChromeUtils.importESModule(
          "resource:///modules/sessionstore/SessionStore.sys.mjs",
        ).SessionStore;
      } catch (_) {}
    }
    // Resolve live native services again AFTER each barrier: restoration can
    // create/replace the workspace/startup manager while we await its predecessor.
    // Never cache an absent promise as permanent readiness, nor await our own
    // startup from feature init. Feature-specific late APIs use watchNative.
    for (let round = 0; round < 4 && !stopped; round++) {
      const pending = [];
      for (const read of [
        () => (window.SessionStore || session)?.promiseAllWindowsRestored,
        () => window.gZenWorkspaces?.promiseInitialized,
        () => window.gZenStartup?.promiseInitialized,
      ]) {
        try {
          const promise = read();
          if (promise?.then && !seen.has(promise)) {
            seen.add(promise);
            pending.push(promise);
          }
        } catch (error) {
          warnings.push(String(error));
        }
      }
      if (round && !pending.length) break;
      const results = await Promise.race([
        Promise.allSettled(pending),
        stopSignal.then(() => []),
      ]);
      if (stopped) return;
      for (const result of results)
        if (result.status === "rejected") warnings.push(String(result.reason));
      await new Promise((resolve) => {
        const timer = window.setTimeout(resolve, 0);
        disposers.push(() => {
          window.clearTimeout(timer);
          resolve();
        });
      });
    }
    for (const warning of warnings)
      console.warn("[Zentral] Native startup readiness failed:", warning);
  }
  async function boot() {
    if (ready || stopped) return;
    ready = true;
    syncArcSidebar();
    window.clearTimeout(readinessNotice);
    let addons = [];
    try {
      addons = validateAddons(
        JSON.parse(getPref("zen.workspace.zentral.addons", "[]")),
      );
    } catch (e) {
      console.error("[Zentral] Invalid add-on list", e);
    }
    for (const a of addons)
      MANIFEST.push({
        ...a,
        name: a.name || a.id,
        description: "Local extension add-on",
      });
    for (const m of MANIFEST)
      records.set(m.id, {
        ...m,
        state: enabled(m.id) ? "pending" : "disabled",
        enabledAtStart: enabled(m.id),
      });
    const cssSpecs = [
      ...CSS_MANIFEST,
      ...addons.flatMap((a) =>
        (a.css || []).map((file, i) => ({
          id: a.id + "-" + i,
          file,
          owner: a.id,
        })),
      ),
    ];
    startupStage = "loading-sources";
    // First load declarations only. No feature initializes during this pass.
    for (const m of MANIFEST) {
      const r = records.get(m.id);
      if (!r.enabledAtStart) continue;
      try {
        if (m.file) moduleLoader.load(m.file, { owner: m.id });
        r.state = "loaded";
      } catch (e) {
        fail(r, e);
      }
    }
    // Validate only after the declaration pass: a coordinator can register
    // built-in parts listed earlier in the catalog. No init runs during load.
    for (const m of MANIFEST) {
      const row = records.get(m.id);
      if (row.state !== "loaded") continue;
      if (definitions.has(m.id) || parts.has(m.id)) row.state = "registered";
      else fail(row, new Error("Source did not register " + m.id));
    }
    startupStage = "loading-styles";
    // Apply only available owners, retaining the original relative sheet order.
    for (const spec of cssSpecs) {
      if (stopped) return;
      await loadCSS(spec);
    }
    if (stopped) return;
    startupStage = "waiting-native-restoration";
    runtime.nativeReady = waitForNativeStartup();
    await runtime.nativeReady;
    if (stopped) return;
    activationReady = true;
    startupStage = "activating-features";
    activateReady();
    installSidebarLayoutTracking();
    startupStage = "ready";
    console.info("[Zentral] Framework startup complete", runtime.snapshot());
    emit();
  }
  function readyNow() {
    return (
      !!window.gBrowser &&
      (!window.gBrowserInit ||
        window.gBrowserInit.delayedStartupFinished === true)
    );
  }
  const readyObserver = {
    observe(subject, topic) {
      if (subject === window && topic === "browser-delayed-startup-finished") {
        Services.obs.removeObserver(readyObserver, topic);
        boot().catch((e) => {
          startupStage = "failed";
          console.error("[Zentral] Boot failed; settings remain available", e);
          emit();
        });
      }
    },
  };
  Services.obs.addObserver(readyObserver, "browser-delayed-startup-finished");
  disposers.push(() => {
    try {
      Services.obs.removeObserver(
        readyObserver,
        "browser-delayed-startup-finished",
      );
    } catch (_) {}
  });
  const readinessNotice = window.setTimeout(() => {
    if (!ready)
      console.warn(
        "[Zentral] Waiting for browser readiness. Ctrl+Alt+= opens settings.",
      );
  }, 15000);
  disposers.push(() => window.clearTimeout(readinessNotice));
  if (readyNow())
    readyObserver.observe(window, "browser-delayed-startup-finished");
  const onWindowUnload = () => runtime.destroy();
  window.addEventListener("unload", onWindowUnload, { once: true });
  disposers.push(() => window.removeEventListener("unload", onWindowUnload));
  registerHostUnload(() => runtime.destroy());
})();
