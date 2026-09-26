// ==UserScript==
// @name           Zentral
// @description    Unified Apps Grid and Tabs Groups
// @author         Michele Pierini
// @version        v1.0.2
// @include        main
// ==/UserScript==

"use strict";

(function ZentralWorkspace() {
  if (typeof gBrowser === "undefined") return;
  if (window.ZentralInitialized === true) {
    return;
  }
  window.ZentralInitialized = true;

  /* ============================================================================
   * ZENTRAL ARCHITECTURE & INDEX (TABLE OF CONTENTS)
   * ============================================================================
   *
   * 1.0 CONFIGURATION & CONSTANTS
   *     1.1 Pref Key Definitions
   *     1.2 Default Constant Values
   *
   * 2.0 ZENTRAL CORE ENGINE (ZentralCore)
   *     2.1 Core State & Config Storage
   *     2.2 Native Browser Preference Utilities
   *     2.3 System Event Bus
   *
   * 3.0 APPS MODULE (ZentralApps)
   *     3.1 State Initialization & Properties
   *     3.2 CSS Style Injection
   *     3.3 Layout & Sidebar Position Detection
   *     3.4 Grid & Tile Rendering
   *     3.5 App Panel Lifecycle & Animations
   *     3.6 Drag & Drop / Grid Reordering
   *     3.7 App Context Menus & Space Scoping
   *
   * 4.0 TAB GROUPS MODULE (ZentralTabGroups)
   *     4.1 Initialization & Observers
   *     4.2 Custom CSS & Visual Enhancements
   *     4.3 Group Hierarchy & Storage Serialization
   *     4.4 Color Picker & Theme Processing
   *     4.5 Custom Tooltips & Context Menus
   *
   * 5.0 SETTINGS MODULE (ZentralSettings)
   *     5.1 Modal UI Structure & Injection
   *     5.2 Form Data Binding & Persistence
   *     5.3 Modal Animation & Dialog Styles
   *
   * 6.0 MASTER BOOTSTRAPPER & ENTRY POINT
   *     6.1 Global Namespace Definition
   *     6.2 Browser Startup Observers
   * ============================================================================
   */

  /* ============================================================================
   * 1.0 CONFIGURATION & CONSTANTS
   * ============================================================================
   */

  /**
   * Zentral Constants shared across modules (Preferences keys, default bounds, etc.)
   */
  const Constants = {
    /**
     * 1.1 Apps Module Preference Keys & Dimension Constraints
     */
    Apps: {
      PREF_APPS: "zen.workspace.apps.sidebar.apps",
      PREF_WIDTH: "zen.workspace.apps.sidebar.width",
      PREF_ANIMATION_SPEED: "zen.workspace.apps.sidebar.animation_speed",
      PREF_ANIMATION_TYPE: "zen.workspace.apps.sidebar.animation_type",
      PREF_ENABLED: "zen.workspace.apps.sidebar.enabled",
      PREF_MAX_APPS: "zen.workspace.apps.sidebar.max_apps",
      PREF_APPS_PER_ROW: "zen.workspace.apps.sidebar.apps_per_row",
      PREF_MAX_ROWS: "zen.workspace.apps.sidebar.max_rows",
      PREF_AUTOHIDE: "zen.workspace.apps.sidebar.autohide",
      PREF_INSTA_PEEK_SHORTCUT: "zen.workspace.apps.insta_peek.shortcut",
      PREF_PLACEMENT: "zen.workspace.apps.sidebar.placement",
      PREF_UTILITY_ORDER: "zen.workspace.apps.sidebar.utility_order",
      PREF_HIDE_UTILITY_SECTION:
        "zen.workspace.apps.sidebar.hide_utility_section",
      MIN_WIDTH_PX: 280,
      MAX_WIDTH_RATIO: 0.8,
      DEFAULT_SLIDE_MS: 450,
      DEFAULT_MAX_APPS: 21,
      DEFAULT_APPS_PER_ROW: 7,
      DEFAULT_MAX_ROWS: 3,
      /** Fixed number of slots hosted in the Utility section */
      UTILITY_SLOTS_COUNT: 4,
      /** Sidebar width (px) below which layout is treated as collapsed. */
      COLLAPSED_WIDTH_THRESHOLD: 140,
    },
    /**
     * 1.2 Tab Groups Preference Keys
     */
    TabGroups: {
      PREF_COLORS: "zen.workspace.tabgroups.colors",
      PREF_STATE: "zen.workspace.tabgroups.state",
      PREF_ENABLED: "zen.workspace.tabgroups.enabled",
      PREF_COLLAPSE_ON_LAUNCH: "zen.workspace.tabgroups.collapse_on_launch",
      PREF_THUMBNAILS: "zen.workspace.tabgroups.thumbnails",
      PREF_SHOW_CHEVRON: "zen.workspace.tabgroups.show_chevron",
      PREF_INDICATOR_TYPE: "zen.workspace.tabgroups.indicator_type",
      PREF_LABEL_OPACITY: "zen.workspace.tabgroups.label_opacity",
    },
    /**
     * 1.3 Diagnostics Preference Keys
     */
    Diagnostics: {
      PREF_LOGGER_ENABLED: "zen.workspace.zentral.debug",
      PREF_LOGGER_PATH: "zentral.logger.path",
      PREF_LOGGER_FULL: "zen.workspace.zentral.debug.full",
      PREF_LOGGER_CORE: "zen.workspace.zentral.debug.core",
      PREF_LOGGER_TABS: "zen.workspace.zentral.debug.tabs",
      PREF_LOGGER_APPS: "zen.workspace.zentral.debug.apps",
      PREF_LOGGER_MENUS: "zen.workspace.zentral.debug.menus",
      PREF_LOGGER_LAYOUT: "zen.workspace.zentral.debug.layout",
      PREF_REPORT_ENDPOINT: "zen.workspace.zentral.report_endpoint",
    },
    /** Debug logging preference — set true in about:config to enable verbose console output */
    DEBUG_PREF: "zen.workspace.zentral.debug",
  };

  /* ============================================================================
   * 1.5 MODULE-SCOPE CONSTANTS (shared SVG strings & lookup tables)
   * ============================================================================
   */

  /**
   * Frozen lookup table of well-known service hostnames → display names.
   * Allocated once at module load; never mutated.
   */
  const WELL_KNOWN_SERVICES = Object.freeze({
    "discord.com": "Discord",
    "web.whatsapp.com": "WhatsApp",
    "whatsapp.com": "WhatsApp",
    "web.telegram.org": "Telegram",
    "telegram.org": "Telegram",
    "t.me": "Telegram",
    "reddit.com": "Reddit",
    "youtube.com": "YouTube",
    "music.youtube.com": "YouTube Music",
    "mail.google.com": "Gmail",
    "gmail.com": "Gmail",
    "github.com": "GitHub",
    "twitter.com": "Twitter",
    "x.com": "X",
    "chatgpt.com": "ChatGPT",
    "chat.openai.com": "ChatGPT",
    "instagram.com": "Instagram",
    "facebook.com": "Facebook",
    "linkedin.com": "LinkedIn",
    "spotify.com": "Spotify",
    "open.spotify.com": "Spotify",
    "twitch.tv": "Twitch",
    "slack.com": "Slack",
    "notion.so": "Notion",
    "netflix.com": "Netflix",
    "google.com": "Google",
    "drive.google.com": "Google Drive",
    "calendar.google.com": "Google Calendar",
    "maps.google.com": "Google Maps",
    "translate.google.com": "Google Translate",
    "keep.google.com": "Google Keep",
    "pinterest.com": "Pinterest",
    "amazon.com": "Amazon",
    "wikipedia.org": "Wikipedia",
    "outlook.live.com": "Outlook",
    "outlook.com": "Outlook",
    "messenger.com": "Messenger",
    "tiktok.com": "TikTok",
    "soundcloud.com": "SoundCloud",
    "music.apple.com": "Apple Music",
    "bsky.app": "Bluesky",
    "mastodon.social": "Mastodon",
    "threads.net": "Threads",
    "medium.com": "Medium",
    "substack.com": "Substack",
    "trello.com": "Trello",
    "asana.com": "Asana",
    "figma.com": "Figma",
    "canva.com": "Canva",
    "dropbox.com": "Dropbox",
    "steamcommunity.com": "Steam",
    "store.steampowered.com": "Steam",
    "mail.proton.me": "ProtonMail",
    "proton.me": "Proton",
    "deezer.com": "Deezer",
    "crunchyroll.com": "Crunchyroll",
  });

  /**
   * Shared SVG string constants. Defined once at module scope to avoid
   * re-allocating identical string literals at every renderGrid() call.
   */
  const SVG_STRINGS = Object.freeze({
    SETTINGS: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    EYE_OPEN: `<svg class="zs-eye-open" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    EYE_CLOSED: `<svg class="zs-eye-closed" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    CLOSE_X: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`,
    EXPAND: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>`,
    COLLAPSE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4 6V2h2v4H4zm6 0V2h2v4h-2zm-6 4v4h2v-4H4zm6 0v4h2v-4h-2z"/></svg>`,
    PIN: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 11V15M3.5 11.5h9c0 0 0-2-1.5-3l-.5-4c0 0 .5-.5.5-1H5.5c0 .5.5 1 .5 1L5.5 8.5c-1.5 1-2 3-2 3z"/></svg>`,
    REFRESH: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M13.8 6.5A5.5 5.5 0 1 0 8 13.5a5.5 5.5 0 0 0 5.2-3.7M14 2v4.5H9.5"/></svg>`,
    GRABBER: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 14"><circle cx="3" cy="2.5" r="1.2"/><circle cx="7" cy="2.5" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11.5" r="1.2"/><circle cx="7" cy="11.5" r="1.2"/></svg>`,
    ADD: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  });

  /**
   * Creates an SVG element from a string using innerHTML (no DOMParser overhead).
   * Shared by all Zentral modules. Clones elements on repeated use.
   * @param {string} svgString - Raw SVG markup.
   * @returns {Element} The SVG DOM element.
   */
  function createSVGElement(svgString) {
    const wrap = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    // The XHTML fragment parser creates SVG elements in their SVG namespace.
    // A literal xmlns attribute is discarded by Gecko's chrome sanitizer and
    // logs one warning per icon, so omit that redundant attribute first.
    wrap.innerHTML = svgString.replace(/\s+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "");
    return wrap.firstElementChild;
  }

  /* ============================================================================
   * 2.0 ZENTRAL CORE ENGINE (ZentralCore)
   * ============================================================================
   */

  /**
   * Core orchestrator managing Events, Configurations, and Preference Fallbacks.
   */
  class ZentralCore {
    /**
     * Constructs the ZentralCore instance and initializes the event listener map and default preferences.
     */
    constructor() {
      /** @type {Map<string, Array<Function>>} Storage map for pub-sub event callbacks */
      this.listeners = new Map();

      /** @type {Object<string, any>} Default fallback preference values */
      this.defaultPrefs = {
        [Constants.Apps.PREF_APPS]: "[]",
        [Constants.Apps.PREF_WIDTH]: 350,
        [Constants.Apps.PREF_ANIMATION_SPEED]: 0,
        [Constants.Apps.PREF_ANIMATION_TYPE]: "none",
        [Constants.Apps.PREF_ENABLED]: true,
        [Constants.Apps.PREF_MAX_APPS]: -1,
        [Constants.Apps.PREF_APPS_PER_ROW]: 1,
        [Constants.Apps.PREF_MAX_ROWS]: 1,
        [Constants.Apps.PREF_AUTOHIDE]: false,
        [Constants.Apps.PREF_INSTA_PEEK_SHORTCUT]: "Alt+Q",
        [Constants.Apps.PREF_PLACEMENT]: "sidebar",
        [Constants.Apps.PREF_UTILITY_ORDER]:
          '["autohide",null,null,"settings"]',
        [Constants.Apps.PREF_HIDE_UTILITY_SECTION]: true,
        [Constants.TabGroups.PREF_COLORS]: "{}",
        [Constants.TabGroups.PREF_STATE]: "{}",
        [Constants.TabGroups.PREF_ENABLED]: false,
        [Constants.TabGroups.PREF_COLLAPSE_ON_LAUNCH]: false,
        [Constants.TabGroups.PREF_THUMBNAILS]: false,
        [Constants.TabGroups.PREF_SHOW_CHEVRON]: true,
        [Constants.TabGroups.PREF_INDICATOR_TYPE]: "circle",
        [Constants.TabGroups.PREF_LABEL_OPACITY]: 85,
        [Constants.Diagnostics.PREF_LOGGER_ENABLED]: false,
        [Constants.Diagnostics.PREF_LOGGER_PATH]: "",
        [Constants.Diagnostics.PREF_LOGGER_FULL]: true,
        [Constants.Diagnostics.PREF_LOGGER_CORE]: true,
        [Constants.Diagnostics.PREF_LOGGER_TABS]: false,
        [Constants.Diagnostics.PREF_LOGGER_APPS]: false,
        [Constants.Diagnostics.PREF_LOGGER_MENUS]: false,
        [Constants.Diagnostics.PREF_LOGGER_LAYOUT]: false,
        [Constants.Diagnostics.PREF_REPORT_ENDPOINT]:
          "https://zentral-issue-reporter.michele-pierini.workers.dev/",
      };
    }

    /**
     * Subscribes a callback function to a system or config event.
     * @param {string} event - The event identifier name.
     * @param {Function} callback - The handler function to invoke when event triggers.
     */
    on(event, callback) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push(callback);
    }

    /**
     * Emits an event to all subscribed callback functions.
     * @param {string} event - The event identifier name.
     * @param {any} data - The payload data passed to subscribers.
     */
    emit(event, data) {
      const callbacks = this.listeners.get(event);
      if (callbacks) {
        callbacks.forEach((cb) => {
          try {
            cb(data);
          } catch (e) {
            console.error(`[ZentralCore] Event error on ${event}:`, e);
          }
        });
      }
    }

    /**
     * Safely retrieves a Zentral preference value, returning configured default if user pref doesn't exist.
     * @param {string} key - Preference string identifier key.
     * @param {any} [fallback] - Optional override fallback value.
     * @returns {any} The stored or fallback preference value.
     */
    getPref(key, fallback) {
      const defaultVal =
        this.defaultPrefs[key] !== undefined
          ? this.defaultPrefs[key]
          : fallback;
      try {
        if (!Services.prefs.prefHasUserValue(key)) return defaultVal;
        const prefType = Services.prefs.getPrefType(key);
        if (prefType === Services.prefs.PREF_BOOL)
          return Services.prefs.getBoolPref(key);
        if (prefType === Services.prefs.PREF_INT)
          return Services.prefs.getIntPref(key);
        if (prefType === Services.prefs.PREF_STRING)
          return Services.prefs.getStringPref(key);
      } catch (e) {
        console.warn("[ZentralCore] Config failed to read pref", key, e);
      }
      return defaultVal;
    }

    /**
     * Sets a Zentral preference value and notifies subscribers via the config event channel.
     * @param {string} key - Preference string identifier key.
     * @param {any} value - The new value to assign.
     */
    setPref(key, value) {
      try {
        if (typeof value === "number") {
          if (Number.isInteger(value)) Services.prefs.setIntPref(key, value);
          else Services.prefs.setStringPref(key, value.toString());
        } else if (typeof value === "string")
          Services.prefs.setStringPref(key, value);
        else if (typeof value === "boolean")
          Services.prefs.setBoolPref(key, value);
        else return;
        this.emit(`config:${key}`, value);
      } catch (e) {
        console.warn("[ZentralCore] Config failed to save pref", key, e);
      }
    }

    getNativePref(key, fallback) {
      try {
        if (typeof fallback === "boolean")
          return Services.prefs.getBoolPref(key, fallback);
        if (typeof fallback === "number")
          return Number.isInteger(fallback)
            ? Services.prefs.getIntPref(key, fallback)
            : parseFloat(Services.prefs.getStringPref(key, String(fallback)));
        if (typeof fallback === "string")
          return Services.prefs.getStringPref(key, fallback);
      } catch (e) {
        return fallback;
      }
      return fallback;
    }

    /**
     * Standardized diagnostic logger routing to window.ZentralLogger or debug console.
     * @param {string} module - Component or module name tag (e.g. "ZentralApps").
     * @param {...any} args - Log arguments.
     */
    log(module, ...args) {
      if (window.ZentralLogger?.log) {
        window.ZentralLogger.log(module, ...args);
      } else if (this.getPref(Constants.DEBUG_PREF)) {
        console.log(`[${module}]`, ...args);
      }
    }

    /**
     * Standardized warning logger routing to window.ZentralLogger or native warn.
     * @param {string} module - Component or module name tag.
     * @param {...any} args - Warning arguments.
     */
    warn(module, ...args) {
      if (window.ZentralLogger?.warn) {
        window.ZentralLogger.warn(module, ...args);
      } else {
        console.warn(`[${module}]`, ...args);
      }
    }

    /**
     * Standardized error logger routing to window.ZentralLogger or native error.
     * @param {string} module - Component or module name tag.
     * @param {...any} args - Error arguments.
     */
    error(module, ...args) {
      if (window.ZentralLogger?.error) {
        window.ZentralLogger.error(module, ...args);
      } else {
        console.error(`[${module}]`, ...args);
      }
    }
  }

  // Instantiate Core immediately
  const Core = new ZentralCore();
  Core.log("ZentralCore", "Initialized.");
  const ZentralAppsSource = window.ZentralClassSources?.apps;
  if (typeof ZentralAppsSource !== "function")
    throw new Error("ZentralApps.uc.js did not load");
  const ZentralApps = ZentralAppsSource({ Constants, Core, createSVGElement,
    SVG_STRINGS, WELL_KNOWN_SERVICES });
  (window.ZentralClassStatus ||= Object.create(null)).apps = true;

  const ZentralTabGroupsSource = window.ZentralClassSources?.tabGroups;
  if (typeof ZentralTabGroupsSource !== "function")
    throw new Error("ZentralTabGroups.uc.js did not load");
  const ZentralTabGroups = ZentralTabGroupsSource({ Constants, Core, createSVGElement });
  (window.ZentralClassStatus ||= Object.create(null)).tabGroups = true;

  const ZentralSettingsSource = window.ZentralClassSources?.settings;
  if (typeof ZentralSettingsSource !== "function")
    throw new Error("ZentralSettings.uc.js did not load");
  const ZentralSettings = ZentralSettingsSource({ Constants, Core });
  (window.ZentralClassStatus ||= Object.create(null)).settings = true;

  const Apps = new ZentralApps();
  const TabGroups = new ZentralTabGroups();
  const Settings = new ZentralSettings();

  /**
   * 6.1 Global Namespace Definition
   * Exposes Zentral Core modules globally on window.Zentral for extensibility and devtools inspection.
   */
  window.Zentral = {
    Core,
    Apps,
    TabGroups,
    Settings,
    Init: () => {
      Core.log("Zentral", "Booting Master Script (v1.0.2)...");
      Apps.init();
      TabGroups.init();
      Settings.init();
      window.ZentralSettingsInstance = Settings;
    },
    Destroy: () => {
      Core.log("Zentral", "Unloading and destroying Zentral mod...");
      if (Apps.destroy) Apps.destroy();
      if (TabGroups.destroy) TabGroups.destroy();
      if (Settings.destroy) Settings.destroy();
      window.ZentralInitialized = false;
      delete window.Zentral;
    },
  };

  const performUnload = () => {
    window.removeEventListener("unload", performUnload);
    try {
      if (window.Zentral === zentralInstance) {
        zentralInstance.Destroy();
      }
    } catch (e) {
      console.error("[Zentral] Error during unload destroy:", e);
    }
  };

  const zentralInstance = window.Zentral;

  // Sine Mod engine dynamically unloads scripts
  if (typeof window.addUnloadListener === "function") {
    window.addUnloadListener(performUnload);
  } else if (typeof UC_API !== "undefined" && UC_API.addUnloadListener) {
    UC_API.addUnloadListener(performUnload);
  }
  // Fallback for full app closure
  window.addEventListener("unload", performUnload, { once: true });

  /**
   * 6.2 Browser Startup Observers
   * Ensures Zentral initializes safely after browser delayed startup completes.
   */
  try {
    if (
      typeof gBrowserInit !== "undefined" &&
      gBrowserInit.delayedStartupFinished
    ) {
      window.Zentral.Init();
    } else {
      let booted = false;
      const safeBoot = () => {
        if (booted) return;
        booted = true;
        try {
          window.Zentral.Init();
        } catch (err) {
          console.error("[Zentral] Boot error:", err);
        }
      };

      if (typeof Services !== "undefined" && Services.obs) {
        Services.obs.addObserver(
          function observer(subject, topic) {
            if (
              topic === "browser-delayed-startup-finished" &&
              subject === window
            ) {
              Services.obs.removeObserver(observer, topic);
              safeBoot();
            }
          },
          "browser-delayed-startup-finished",
          false,
        );
      }
    }
  } catch (e) {
    console.error(
      "[Zentral] Startup observer error, forcing immediate Init():",
      e,
    );
    try {
      window.Zentral.Init();
    } catch (_) {}
  }
})();
