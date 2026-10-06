// ==UserScript==
// @name Zentral Core and Settings
// @include chrome://browser/content/browser.xhtml
// @version 2.1.18
// ==/UserScript==
/*
 * ZENTRAL FILE GUIDE - core/ZentralRuntime.js
 *
 * Purpose: Owns per-window feature records, preparation/activation, availability, hooks, CSS registration,
 *   settings routing and native sidebar geometry tracking.
 * Interaction / execution: Loads catalog and shared services, optionally constructs settings, waits for
 *   native delayed startup, loads feature declarations, applies owner-gated CSS, then activates
 *   dependency-ready features. Panel parts resume in the coordinator.
 * Ownership / failure: Owns disposers and sidebar observers/listeners; destroy unwinds cleanup in reverse,
 *   closes settings, removes registered sheets and destroys the loader. Features should register their
 *   cleanup here.
 * Loaded/created by: core/Zentral.uc.js
 * Direct local resource paths: core/Zentral.uc.js; core/ZentralCatalog.js; core/ZentralShared.js;
 *   features/settings/controllers/ZentralDeveloperSettings.js; features/settings/controllers/ZentralFeatureSettings.js;
 *   features/settings/controllers/ZentralSettingsCatalog.js; features/settings/controllers/ZentralSettingsShell.js;
 *   features/video/controllers/ZentralVideoSettings.js
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
  const VERSION = "2.1.18";
  // Sine installs this package under theme.json's id. Resolve from the
  // executing script so local folders and installed copies use their own files.
  // Keep this universal: never hard-code a mod id, folder name, or profile path.
  // Modules that need assets should resolve them against runtime.rootURI.
  const ROOT = Services.io.newURI(
    "../",
    null,
    Services.io.newURI(moduleLoader.rootURI + "core/Zentral.uc.js"),
  ).spec;
  const PREF = "zen.workspace.zentral.modules.";
  const definitions = new Map(),
    parts = new Map(),
    records = new Map(),
    styles = new Map(),
    disposers = [],
    availability = new Map();
  let ready = false,
    stopped = false;
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
  const arcSidebarPref = "zen.workspace.zentral.arc2.match_compact_sidebar";
  const arcLibraryPref = "zen.workspace.zentral.arc2.match_compact_library";
  const arcLibraryAttribute = "zentral-arc2-library";
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
    const libraryActive = getPref(arcLibraryPref, false) === true && validColor;
    ui.toggleAttribute(arcSidebarAttribute, sidebarActive);
    ui.toggleAttribute(arcLibraryAttribute, libraryActive);
    if (sidebarActive || libraryActive)
      ui.style.setProperty(arcSidebarColorProperty, color);
    else ui.style.removeProperty(arcSidebarColorProperty);
  };
  const arcSidebarObserver = { observe: syncArcSidebar };
  syncArcSidebar();
  if (!document.documentElement)
    document.addEventListener("DOMContentLoaded", syncArcSidebar, {
      once: true,
    });
  Services.prefs.addObserver(arcSidebarPref, arcSidebarObserver);
  Services.prefs.addObserver(arcLibraryPref, arcSidebarObserver);
  Services.prefs.addObserver(arcSidebarColorPref, arcSidebarObserver);
  disposers.push(() => {
    Services.prefs.removeObserver(arcSidebarPref, arcSidebarObserver);
    Services.prefs.removeObserver(arcLibraryPref, arcSidebarObserver);
    Services.prefs.removeObserver(arcSidebarColorPref, arcSidebarObserver);
    document.removeEventListener("DOMContentLoaded", syncArcSidebar);
    const ui = document.documentElement;
    ui?.removeAttribute(arcSidebarAttribute);
    ui?.removeAttribute(arcLibraryAttribute);
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
  const runtime = (window.ZentralRuntime = {
    version: VERSION,
    rootURI: ROOT,
    hooks,
    services: { platform: Services },
    shared: null,
    panelContext: null,
    setAvailable(id, value) {
      availability.set(id, !!value);
      const row = records.get(id);
      if (!row) return;
      if (!value && row.state === "registered") {
        row.state = "dormant";
        row.reason = "Base preference is off; enabling it starts this feature";
      } else if (value && row.state === "dormant") {
        row.state = "active";
        row.reason = undefined;
        if (ready) activateReady();
      }
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
    prepareParts(ctx) {
      for (const m of MANIFEST.filter((m) => m.part && enabled(m.id))) {
        const p = parts.get(m.id);
        if (!p) {
          if (m.optional) continue;
          throw new Error("Missing panel source: " + m.id);
        }
        p.iterator = p.factory(ctx);
        p.iterator.next();
      }
    },
    runPart(id) {
      const r = records.get(id),
        optional = MANIFEST.find((m) => m.id === id)?.optional;
      if (!enabled(id)) {
        if (r) r.state = "disabled";
        return;
      }
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
        ready,
        sources: moduleLoader.sources(),
        features: [...records.values()].map((r) => ({
          ...r,
          nextEnabled: enabled(r.id),
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
        document.getElementById("navigator-toolbox"),
        document.getElementById("sidebar-container"),
        document.getElementById("vertical-tabs"),
        document.getElementById("sidebar-box"),
        tabs,
      ];
      return (
        candidates.find(
          (el) =>
            el?.isConnected &&
            (el === tabs || el.contains(tabs)) &&
            el.getBoundingClientRect().width < window.innerWidth * 0.65,
        ) ||
        tabs ||
        null
      );
    }
    function nativeSidebarRect() {
      const el = nativeSidebarElement();
      return (
        el?.getBoundingClientRect() || {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          width: 0,
          height: 0,
        }
      );
    }
    function sidebarSafeBounds() {
      let left = 0,
        right = window.innerWidth;
      const native = nativeSidebarElement();
      const nodes = new Set([native, document.getElementById("sidebar-box")]);
      const ui = document.documentElement;
      const onRight =
        ui.getAttribute("zen-right-side") === "true" ||
        ui.getAttribute("zen-sidebar-right") === "true";
      if (ui.getAttribute("zen-compact-mode") === "true") {
        // Preserve the native 8px reveal bezel even when a panel's exterior
        // resize grip extends 14px beyond its box.
        if (onRight) right -= 22;
        else left += 22;
      }
      for (const node of nodes) {
        if (!node?.isConnected) continue;
        const style = window.getComputedStyle(node),
          rect = node.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0" ||
          rect.width <= 0 ||
          rect.width >= window.innerWidth * 0.65 ||
          rect.height <= 0 ||
          rect.right <= 0 ||
          rect.left >= window.innerWidth
        )
          continue;
        if (rect.left + rect.width / 2 < window.innerWidth / 2)
          left = Math.max(left, rect.right);
        else right = Math.min(right, rect.left);
      }
      return {
        left: Math.max(0, Math.min(left, window.innerWidth)),
        right: Math.max(left, Math.min(right, window.innerWidth)),
        top: 0,
        bottom: window.innerHeight,
      };
    }
    function setLayoutStyle(node, name, value) {
      if (node.style.getPropertyValue(name) !== value)
        node.style.setProperty(name, value);
    }
    function constrainPanelToSidebar(panel) {
      if (!panel?.hasAttribute("open")) return;
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
      const left = Math.max(min, Math.min(max, requested));
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
        if (ui.getAttribute("bgalazka-super-pin") === "true" && superPanel) {
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
      const rootObserver = new MutationObserver(() => {
        bind();
        window.Zentral?.Apps?.scheduleRepositionGrid?.(0);
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
      });
    }

    return { installSidebarLayoutTracking };
  })({ runtime, getPref, disposers });
  moduleLoader.load("core/ZentralCatalog.js");
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
      "features/settings/controllers/ZentralSettingsCatalog.js",
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
            row.file === "features/video/controllers/ZentralVideoSettings.js" &&
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
      panel.append(heading, content);
      modal.querySelector(".zs-body").appendChild(panel);
      const button = document.createElement("button");
      button.id = "zs-tab-btn-organized-" + id;
      button.type = "button";
      button.className = "zs-tab-btn";
      button.dataset.settingsCategory = id;
      button.textContent = definition.label;
      button.addEventListener("click", () => selectSettingsCategory(modal, id));
      modal.querySelector(".zs-tab-bar").appendChild(button);
      if (id !== "modules" && id !== "addons") {
        const all = document.createElement("button");
        all.type = "button";
        all.className = "zs-category-all-settings";
        all.textContent = "All " + definition.label.toLowerCase() + " settings";
        all.title =
          "Open every setting in this category, including advanced values";
        all.addEventListener("click", () => openManager(id));
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
  function organizeNativeSettings(modal) {
    if (!modal?.querySelector(".zs-body")) return;
    const bar = modal.querySelector(".zs-tab-bar");
    modal
      .querySelector(".zs-dialog")
      ?.setAttribute("data-settings-organized", "true");
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
    const seen = new Set();
    const units = new Set();
    for (const row of [...modal.querySelectorAll("[data-setting-key]")]) {
      const meta = SETTINGS_ORGANIZATION.settings[row.dataset.settingKey];
      if (!meta) {
        setSettingsUnavailable(row, true);
        continue;
      }
      if (row.dataset.videoSettings === "row") continue;
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
      const content = ensureSettingsCategory(modal, meta.category).content;
      let segment = [...content.children].find(
        (node) => node.dataset.settingsSection === meta.section,
      );
      if (!segment) {
        segment = document.createElement("section");
        segment.className = "zs-category-segment";
        segment.dataset.settingsSection = meta.section;
        const heading = document.createElement("h4");
        heading.textContent = meta.section;
        segment.appendChild(heading);
        content.appendChild(segment);
      }
      if (unit.parentElement !== segment) segment.appendChild(unit);
    }
    // Non-setting actions and explanatory status remain next to their controls.
    for (const [selector, category] of [
      [".zs-look-themes, .zs-look-actions, .zs-look-action", "theme"],
      [".zs-extension-presets", "recovery"],
      ["#zs-addon-host-inspection", "compatibility"],
    ]) {
      const target = modal.querySelector(
        "#zs-panel-organized-" + category + " .zs-organized-content",
      );
      if (target)
        for (const node of [...modal.querySelectorAll(selector)])
          if (node.parentElement !== target && !target.contains(node))
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
      logs.textContent = "Logs & Diagnostics";
      logs.dataset.settingsCategory = "logging";
      logs.hidden = !settingsModuleLoaded("logger");
    }
    const logPanel = modal.querySelector("#zs-panel-diagnostics");
    if (logPanel) logPanel.dataset.settingsCategory = "logging";
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
      const ranks = new Map(
        SETTINGS_SCHEMA.map((item, index) => [item.property, index]),
      );
      const rank = (node) =>
        Math.min(
          ...[node, ...node.querySelectorAll("[data-setting-key]")].map(
            (row) => ranks.get(row.dataset.settingKey) ?? Infinity,
          ),
        );
      const content = target.querySelector(".zs-organized-content");
      for (const segment of content.querySelectorAll(".zs-category-segment")) {
        const definition = category.sections.find(
          (section) => section.label === segment.dataset.settingsSection,
        );
        segment.hidden = !definition?.properties.some((property) =>
          settingsItemAvailable({ property }),
        );
        // Move whole units so conditional groups and their event handlers remain intact.
        for (const unit of [...segment.children]
          .filter((node) => node.localName !== "h4")
          .sort((a, b) => rank(a) - rank(b)))
          segment.appendChild(unit);
      }
      const sections = [...content.children].filter((node) =>
        node.classList.contains("zs-category-segment"),
      );
      for (const segment of sections.sort(
        (a, b) =>
          (sectionOrder.get(a.dataset.settingsSection) ?? Infinity) -
          (sectionOrder.get(b.dataset.settingsSection) ?? Infinity),
      ))
        content.appendChild(segment);
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
    if (!modal.querySelector('.zs-tab-btn[data-active="true"]:not([hidden])')) {
      const first = bar.querySelector(
        ".zs-tab-btn[data-settings-category]:not([hidden])",
      );
      if (first) selectSettingsCategory(modal, first.dataset.settingsCategory);
    }
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
            if (
              row &&
              category &&
              !row.closest('[data-hidden="true"], [hidden]')
            ) {
              selectSettingsCategory(modal, meta.category);
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
  }
  runtime.organizeSettings = organizeNativeSettings;
  const refreshSettingsCategories = () => {
    const modal = document.getElementById("zentral-settings-modal");
    if (modal) organizeNativeSettings(modal);
  };
  window.addEventListener("zentral-runtime-change", refreshSettingsCategories);
  disposers.push(() =>
    window.removeEventListener(
      "zentral-runtime-change",
      refreshSettingsCategories,
    ),
  );

  moduleLoader.load("core/ZentralShared.js");
  const {
    Constants,
    Core,
    createSVGElement,
    SVG_STRINGS,
    WELL_KNOWN_SERVICES,
  } = moduleLoader.create("shared", { Services, runtime });
  const shellAvailable =
    settingsSupport &&
    moduleLoader.load("features/settings/controllers/ZentralSettingsShell.js", {
      optional: true,
      owner: "settings",
    });
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
      "features/settings/controllers/ZentralFeatureSettings.js",
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
  const developerAvailable =
    settingsSupport &&
    moduleLoader.load(
      "features/settings/controllers/ZentralDeveloperSettings.js",
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
        !/^(?:JS|core|features)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.uc)?\.js$/.test(
          x.file,
        )
      )
        throw new Error(
          "Add-on JS must be a local JS/, core/ or features/ script path",
        );
      if (x.requires && !Array.isArray(x.requires))
        throw new Error("requires must be an array");
      if (
        x.css &&
        (!Array.isArray(x.css) ||
          x.css.some(
            (p) =>
              !/^(?:CSS|core|features)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.css$/.test(
                p,
              ),
          ))
      )
        throw new Error(
          "CSS must contain local CSS/, core/ or features/ stylesheet paths",
        );
      known.add(x.id);
    }
    return list;
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
          : ["registered", "active", "dormant"].includes(
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
  function activateReady() {
    // Topological startup with no timed retries. Independent features still start
    // when another feature is disabled, missing, throws, or has a dependency cycle.
    let progress = true;
    while (progress) {
      progress = false;
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
        try {
          const cleanup = definitions.get(m.id).init({
            shared: runtime.shared,
            services: runtime.services,
            runtime,
          });
          if (cleanup && typeof cleanup.then === "function")
            throw new Error(
              "init must be synchronous; use browser-ready events within a feature",
            );
          if (typeof cleanup === "function") disposers.push(cleanup);
          else if (cleanup) {
            runtime.services[m.id] = cleanup;
            if (typeof cleanup.destroy === "function")
              disposers.push(() => cleanup.destroy());
          }
          if (r.state === "failed") continue;
          r.state = availability.get(m.id) === false ? "dormant" : "active";
          r.reason = undefined;
        } catch (e) {
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
    // First load declarations only. No feature initializes during this pass.
    for (const m of MANIFEST) {
      const r = records.get(m.id);
      if (!r.enabledAtStart) continue;
      try {
        if (m.file) moduleLoader.load(m.file, { owner: m.id });
        if (!definitions.has(m.id) && !parts.has(m.id))
          throw new Error("Source did not register " + m.id);
        r.state = "registered";
      } catch (e) {
        fail(r, e);
      }
    }
    // Apply only available owners, retaining the original relative sheet order.
    for (const spec of cssSpecs) {
      if (stopped) return;
      await loadCSS(spec);
    }
    if (stopped) return;
    activateReady();
    installSidebarLayoutTracking();
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
        boot().catch((e) =>
          console.error("[Zentral] Boot failed; settings remain available", e),
        );
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
  if (typeof window.addUnloadListener === "function")
    window.addUnloadListener(() => runtime.destroy());
})();
