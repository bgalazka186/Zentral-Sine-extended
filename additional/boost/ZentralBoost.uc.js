/*
 * ZENTRAL FILE GUIDE - additional/boost/ZentralBoost.uc.js
 *
 * Purpose: Memory Boost - read total browser RAM on demand, free memory losslessly, and trim once after startup.
 *   The owner measured his own browser (docs/PLAN_CODING_AGENT.md): the whole window including every Zentral script is
 *   ~49 MB, so this module never refactors code for size. What it can do is ask Gecko to give memory back, and later
 *   (OW-91/OW-92) unload what is not in use at all.
 * Interaction / execution: Runtime registers boost; standalone mode can start after browser readiness (requestProcInfo
 *   and the memory reporter manager must both exist). Every timer goes through the scope/lifecycle helpers and is
 *   cancelled on destroy: there is no interval anywhere in this file.
 * Ownership / failure: Owns its own timers, its listeners and the public API. Missing this feature does not affect
 *   tabs, panels, Notes or widgets; a build without `ChromeUtils.requestProcInfo()` disables the module with one
 *   console warning instead of failing the window.
 * Registration: boost
 * Loaded/created by: loader/ZentralCatalog.js
 * Literal DOM event subscriptions: none (it only listens to the window for user input while the startup trim waits)
 *
 * Navigation: ARCHITECTURE.md and FILE_GUIDE.json map the whole tree. Symbols below are static
 * contracts from this source, not a promise that every collaborator is enabled at runtime.
 */
(function () {
  "use strict";
  const Services =
    globalThis.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs")
      .Services;
  const ZentralRuntime = window.ZentralRuntime || window.__zentralStandaloneRuntime;

  const PREF = Object.freeze({
    ENABLED: "zen.workspace.zentral.boost.enabled",
    STARTUP_TRIM: "zen.workspace.zentral.boost.startup_trim",
    // OW-112: the old `keep_pinned` name said the opposite of what it did — `true` meant a deep pass MAY UNLOAD
    // pinned/Essential tabs. The checkbox label always said so; now the pref does too. Off by default, unchanged.
    UNLOAD_PINNED: "zen.workspace.zentral.boost.unload_pinned",
    // Retired name, read only for one release so an existing `true` choice is carried over (and used as a
    // fallback if that write is refused). Declared as an external pref in `standalone.json`, never a second switch.
    LEGACY_KEEP_PINNED: "zen.workspace.zentral.boost.keep_pinned",
    // B4.6: the one shortcut that runs the light pass. Empty means none, and an empty shortcut installs no listener.
    SHORTCUT: "zen.workspace.zentral.boost.shortcut",
    // B5 (OW-92): the RAM limiter. Off by default: a browser that unloads things on its own is a promise about the
    // person's work, and that promise is theirs to make.
    LIMIT_ENABLED: "zen.workspace.zentral.boost.limit_enabled",
    LIMIT_MB: "zen.workspace.zentral.boost.limit_mb",
    LIMIT_MODE: "zen.workspace.zentral.boost.limit_mode",
    LIMIT_COOLDOWN_S: "zen.workspace.zentral.boost.limit_cooldown_s",
    LIMIT_TARGET_PCT: "zen.workspace.zentral.boost.limit_target_pct",
    // B7 (OW-94): Game Mode, the Level 3 TOGGLE. Off by default and not remembered across a restart: a browser that
    // comes back from a restart still paused would look broken to anyone who forgot they turned it on.
    GAME_MODE: "zen.workspace.zentral.boost.game_mode",
    // B7.2: "Stronger saver" also sleeps the records marked `live` (WhatsApp, Messenger). A separate switch, OFF by
    // default, because sleeping a notification app is the one thing the mode may not decide on its own.
    STRONGER_SAVER: "zen.workspace.zentral.boost.stronger_saver",
    // G2: the optional host allow-list and the kill-switch for parking the selected tab (G4).
    GAME_KEEP_HOSTS: "zen.workspace.zentral.boost.game_keep_hosts",
    GAME_PARK_SELECTED: "zen.workspace.zentral.boost.game_park_selected",
    // G5: the staggered Restore profiles and the kill switch for restoring automatically on Game Mode exit.
    GAME_RESTORE_TABS: "zen.workspace.zentral.boost.game_restore_tabs",
    GAME_RESTORE_RECENT_N: "zen.workspace.zentral.boost.game_restore_recent_n",
    GAME_RESTORE_STAGGER_MS: "zen.workspace.zentral.boost.game_restore_stagger_ms",
    GAME_RESTORE_ON_EXIT: "zen.workspace.zentral.boost.game_restore_on_exit",
  });
  // G4: the ONE ephemeral parking tab. It is never pinned, never saved to session and excluded from every unload
  // list. The attribute is also the planner's way of recognizing a tab that belongs to Boost, not to the person.
  const PARKING_ATTR = "zentral-boost-parking";
  const isBoostParkingTab = (tab) => Boolean(tab?.hasAttribute?.(PARKING_ATTR));
  // G5: bounded, one-shot restore work. Nothing here is an interval; the 8 s timeout is the plan's own ceiling
  // for a tab whose load/DOMContentLoaded event never arrives.
  const RESTORE_PROFILES = Object.freeze(["all", "recent", "panels", "none"]);
  const RESTORE_EXIT_POLICIES = Object.freeze(["ask", "always", "never"]);
  const RESTORE_MAX_LOADING = 2;
  const RESTORE_LOAD_TIMEOUT_MS = 8000;
  const RESTORE_DEFAULT_STAGGER_MS = 700;
  const RESTORE_DEFAULT_RECENT_N = 8;
  const normalizeRestoreProfile = (value) =>
    RESTORE_PROFILES.includes(String(value || "")) ? String(value) : "all";
  const normalizeRestoreExit = (value) =>
    RESTORE_EXIT_POLICIES.includes(String(value || "")) ? String(value) : "ask";
  const clampRestoreInt = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
  };

  /* G2: the pure Game Mode planner. It never touches the DOM, prefs, tabs or timers: the caller passes every fact
   * the policy cannot read. Switching Game Mode on is the consent, so `unload_pinned` and each record's
   * `backgroundMode` are deliberately ignored (keepPinned/panelConsent are always true here). The NEVER rules are
   * still the policy's own: audible, sharing/camera/mic, PiP, video source, host tab, private window, already
   * pending, and an explicitUnloadTabs refusal (reported as `refused`, never forced). */
  function hostOfTab(tab) {
    try {
      const spec = String(tab?.linkedBrowser?.currentURI?.spec || tab?._zentralNotesUrl || "");
      if (!spec || spec === "about:blank") return "";
      return new URL(spec).hostname.toLowerCase();
    } catch (_) {
      return "";
    }
  }
  function isPrivateTab(tab) {
    try {
      const utils = window.PrivateBrowsingUtils;
      return typeof utils?.isBrowserPrivate === "function"
        ? Boolean(utils.isBrowserPrivate(tab?.linkedBrowser))
        : false;
    } catch (_) {
      return false;
    }
  }
  function planGameMode(input = {}) {
    const {
      tabs = [], panelRecords = [], selectedTab = null, videoSourceTab = null,
      keepHosts = [], parkSelected = true, canPark = true,
      isAudible = () => false,
      isUnloadable = () => ({ allowed: false, reason: "no-policy" }),
      isPrivate = () => false,
      hostOf = hostOfTab,
      refused = () => false,
      labelOf = (x) => String(x?.label || x?.linkedBrowser?.currentURI?.spec || x?.app?.id || x?.appId || "unknown"),
    } = input;
    const hosts = (Array.isArray(keepHosts) ? keepHosts : [])
      .map((h) => String(h || "").trim().toLowerCase().replace(/^\*\./, ""))
      .filter(Boolean);
    const keep = [];
    const sleepTabs = [];
    const sleepPanels = [];
    const panelTabs = new Set(panelRecords.map((r) => r?.tab).filter(Boolean));
    let park = null;
    const addKeep = (id, kind, reason) => keep.push({ id, kind, reason });
    const hostMatch = (tab) => {
      const host = String(hostOf(tab) || "").toLowerCase();
      return Boolean(host) && hosts.some((h) => host === h || host.endsWith("." + h));
    };
    const policyVerdict = (tab, isPanelRecord) =>
      isUnloadable(tab, {
        // Game Mode consent: pinned, Essential and every record mode may sleep.
        keepPinned: true,
        panelConsent: true,
        isPanelRecord,
        videoSourceTab,
        selectedTab: null, // selection is decided by parking below, not by the policy
        isPrivate,
        isHostTab: () => false,
        sessionUrl: "",
      });
    for (const tab of tabs) {
      if (!tab) continue;
      const id = labelOf(tab);
      if (isBoostParkingTab(tab)) {
        addKeep(id, "tab", "parking-tab");
        continue;
      }
      if (panelTabs.has(tab)) continue; // owned by the panel list, not the generic sweep
      if (isAudible(tab)) { addKeep(id, "tab", "audible"); continue; }
      if (videoSourceTab && tab === videoSourceTab) { addKeep(id, "tab", "video-source"); continue; }
      if (tab === selectedTab && !(parkSelected && canPark)) { addKeep(id, "tab", "selected"); continue; }
      if (hostMatch(tab)) { addKeep(id, "tab", "keep-host"); continue; }
      const verdict = policyVerdict(tab, false);
      if (!verdict.allowed) { addKeep(id, "tab", String(verdict.reason || "policy-refused")); continue; }
      if (refused(tab)) { addKeep(id, "tab", "refused"); continue; }
      if (tab === selectedTab) park = tab;
      sleepTabs.push(tab);
    }
    for (const record of panelRecords) {
      if (!record) continue;
      const tab = record?.tab;
      const id = String(record?.app?.id || record?.appId || labelOf(record));
      if (isAudible(tab) || record?.browser?.audioPlaying) { addKeep(id, "panel", "audible"); continue; }
      if (videoSourceTab && tab === videoSourceTab) { addKeep(id, "panel", "video-source"); continue; }
      if (tab === selectedTab && !(parkSelected && canPark)) { addKeep(id, "panel", "selected"); continue; }
      if (hostMatch(tab)) { addKeep(id, "panel", "keep-host"); continue; }
      const verdict = policyVerdict(tab, true);
      // A pending/discarded tab can still hold a loaded panel browser (G1), so those two reasons are NOT a reason
      // to keep the record; every other policy refusal is.
      if (!verdict.allowed && verdict.reason !== "pending" && verdict.reason !== "no-panel" && verdict.reason !== "discarded") {
        addKeep(id, "panel", String(verdict.reason || "policy-refused"));
        continue;
      }
      if (refused(tab)) { addKeep(id, "panel", "refused"); continue; }
      // A selected, loaded panel record is also a parking candidate; a pending/discarded one already has no
      // selected tab to unload, so its panel browser is handled by sleepPanelRecord without a parking tab.
      if (tab === selectedTab && parkSelected && canPark && !park && verdict.allowed) park = tab;
      sleepPanels.push(record);
    }
    return { sleepPanels, sleepTabs, park, keep };
  }

  // B2.1: sample only on demand. These are the two situations the plan allows a 2 s sampler.
  const SAMPLE_INTERVAL_MS = 2000;
  // B2.2: Level 1 measures "after" this long after the reporter manager answers, because Gecko frees on its own
  // schedule and an immediate reading only sees the request, not the result.
  const LEVEL1_SETTLE_MS = 3000;
  // G8: content processes can free their memory well after a tab is made pending. Game Mode runs its second
  // lightClean() after the existing 3 s settle, then ONE more one-shot clean 30 s later while the mode is still on.
  const GAME_MODE_LATE_CLEAN_MS = 30000;
  // B2.3: after restore, one trim once the browser has been quiet this long. Every deferral is a fresh one-shot timer
  // that a new input cancels and re-arms; nothing polls.
  const TRIM_QUIET_MS = 90000;
  const TRIM_IDLE_TIMEOUT_MS = 30000;
  const TRIM_MAX_WAIT_MS = 6 * 60 * 1000;
  const INPUT_EVENTS = ["keydown", "mousedown", "wheel", "touchstart", "pointerdown"];
  // B4.5: Restore remembers what it put to sleep, for this session only. The cap keeps the record bounded; the state is
  // deliberately lost on restart, because a restored tab is the browser's own job after that.
  const UNDO_CAP = 50;
  // G3: the session snapshot keeps REAL tab elements (an unloaded tab stays in the strip) and is capped at 500
  // entries per list. The limiter's own 50-entry undo list above stays exactly as it was.
  const SESSION_CAP = 500;
  // B4.3: what a panel record may do in the background. `live` is the default for every existing record.
  const BACKGROUND_MODES = Object.freeze(["live", "throttled", "asleep-allowed"]);

  /* G10: strings and pure card data shared by the full-pack tray and the standalone Boost card. The standalone
   * package has no Widgets source, so Boost owns its own words here; nothing in this block reads a pref, touches
   * the DOM, starts a timer or samples RAM. Language comes from the caller (browser locale or Widgets language). */
  const BOOST_WIDGET_STRINGS = Object.freeze({
    en: Object.freeze({
      "card.title": "Memory Boost",
      "card.ram": "{mb} MB",
      "card.unknown": "RAM unknown",
      "card.light": "Light",
      "card.deep": "Deep",
      "card.game": "Game",
      "card.restore": "Restore",
      "card.lightHint": "Light: GC/CC + memory minimize. No tabs touched.",
      "card.deepHint": "Deep: Light clean first, then eligible tabs sleep.",
      "card.gameHint": "Game Mode: one plan-driven cleanup pass.",
      "card.gameHintOn": "Game Mode is on. Switch it off to Restore.",
      "card.deepSoon": "Needs the shared tab policy",
      "card.restoreHint": "Restore: wake the saved Game Mode snapshot.",
      "card.nothingRestore": "Nothing to restore yet",
      "card.busy": "Working\u2026",
      "card.result": "Freed {mb} MB",
      "card.deepResult": "Put {tabs} tab(s) and {panels} app(s) to sleep \u00b7 freed {mb} MB",
      "card.gameOn": "Game Mode on",
      "card.gameOff": "Game Mode off",
      "card.restoreDone": "Restoring {panels} apps and {tabs} tabs",
      "card.preview": "Will free about {tabs} tabs and {panels} apps before Game Mode starts",
      "card.restoreLabel": "Restore ({panels} apps, {tabs} tabs)",
      "feedback.gameOn": "Game Mode: freed {mb} MB · {tabs} tabs, {panels} apps unloaded · kept: {kept}",
      "feedback.gameStarting": "Game Mode: freeing memory…",
      "feedback.gameOff": "Game Mode off",
      "feedback.keptNone": "none",
      "feedback.keptMore": "+{count} more",
      "feedback.restoreAction": "Restore",
    }),
    pl: Object.freeze({
      "card.title": "Pami\u0119\u0107 Boost",
      "card.ram": "{mb} MB",
      "card.unknown": "Nieznana pami\u0119\u0107 RAM",
      "card.light": "Lekko",
      "card.deep": "G\u0142\u0119boko",
      "card.game": "Gra",
      "card.restore": "Przywr\u00f3\u0107",
      "card.lightHint": "Lekko: GC/CC i minimalizacja pami\u0119ci. Karty nie s\u0105 ruszane.",
      "card.deepHint": "G\u0142\u0119boko: najpierw lekkie czyszczenie, potem usypianie kart.",
      "card.gameHint": "Tryb gry: jeden planowy przebieg czyszczenia.",
      "card.gameHintOn": "Tryb gry jest w\u0142\u0105czony. Wy\u0142\u0105cz go, aby przywr\u00f3ci\u0107.",
      "card.deepSoon": "Wymaga wsp\u00f3lnej polityki kart",
      "card.restoreHint": "Przywr\u00f3\u0107: obud\u017a zapisany stan Trybu gry.",
      "card.nothingRestore": "Nie ma jeszcze czego przywraca\u0107",
      "card.busy": "Pracuj\u0119\u2026",
      "card.result": "Zwolniono {mb} MB",
      "card.deepResult": "U\u015bpiono {tabs} kart i {panels} aplikacji \u00b7 zwolniono {mb} MB",
      "card.gameOn": "Tryb gry w\u0142\u0105czony",
      "card.gameOff": "Tryb gry wy\u0142\u0105czony",
      "card.restoreDone": "Przywracanie {panels} aplikacji i {tabs} kart",
      "card.preview": "U\u015bpi oko\u0142o {tabs} kart i {panels} aplikacji przed w\u0142\u0105czeniem Trybu gry",
      "card.restoreLabel": "Przywr\u00f3\u0107 ({panels} aplikacji, {tabs} kart)",
      "feedback.gameOn": "Tryb gry: zwolniono {mb} MB \u00b7 {tabs} kart, {panels} aplikacji u\u015bpionych \u00b7 zachowano: {kept}",
      "feedback.gameStarting": "Tryb gry: zwalnianie pami\u0119ci\u2026",
      "feedback.gameOff": "Tryb gry wy\u0142\u0105czony",
      "feedback.keptNone": "brak",
      "feedback.keptMore": "+{count} wi\u0119cej",
      "feedback.restoreAction": "Przywr\u00f3\u0107",
    }),
  });
  function boostWidgetLanguage(raw) {
    const code = String(raw || "en").toLowerCase();
    return code === "pl" || code.startsWith("pl-") ? "pl" : "en";
  }
  function boostWidgetText(language, key, params = null) {
    const code = boostWidgetLanguage(language);
    const table = BOOST_WIDGET_STRINGS[code] || BOOST_WIDGET_STRINGS.en;
    let text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : BOOST_WIDGET_STRINGS.en[key];
    if (typeof text !== "string") text = String(key);
    if (!params || typeof params !== "object") return text;
    return text.replace(/\{([A-Za-z0-9_]+)\}/g, (_all, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? "") : "{" + name + "}");
  }
  function boostWidgetNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
  }
  function boostWidgetMenuItems(options = {}) {
    const language = boostWidgetLanguage(options.language);
    const t = (key, params) => boostWidgetText(language, key, params);
    const running = Boolean(options.running);
    const gameOn = Boolean(options.gameMode && options.gameMode.on);
    const snapshot = options.snapshot && typeof options.snapshot === "object" ? options.snapshot : {};
    const panels = boostWidgetNumber(snapshot.panels, 0);
    const tabs = boostWidgetNumber(snapshot.tabs, options.undoSize || 0);
    const restorable = panels + tabs;
    const gameHint = !gameOn && options.previewHint
      ? String(options.previewHint)
      : t(gameOn ? "card.gameHintOn" : "card.gameHint");
    return [
      {
        id: "free-light", level: "light", shortLabel: t("card.light"), label: t("card.light"),
        description: t("card.lightHint"), hint: t("card.lightHint"), available: !running,
      },
      {
        id: "free-deep", level: "deep", shortLabel: t("card.deep"), label: t("card.deep"),
        description: t("card.deepHint"), hint: options.canDeep === false ? t("card.deepSoon") : t("card.deepHint"),
        available: !running && options.canDeep !== false,
      },
      {
        id: "game-mode", level: "game", shortLabel: t("card.game"), label: t("card.game"),
        description: t("card.gameHint"), hint: gameHint, available: options.canGameMode !== false,
        checked: gameOn,
      },
      {
        id: "restore", level: "restore", shortLabel: t("card.restore"),
        label: options.restoreLabel || (restorable ? t("card.restoreLabel", { panels, tabs }) : t("card.restore")),
        description: t("card.restoreHint"),
        hint: restorable ? t("card.restoreHint") : t("card.nothingRestore"),
        available: options.canRestore !== false && !running && restorable > 0,
      },
    ];
  }
  function boostWidgetPreviewText(preview, language) {
    const counts = preview && typeof preview === "object" ? (preview.counts || preview) : {};
    return boostWidgetText(language, "card.preview", {
      tabs: boostWidgetNumber(counts.tabs, 0), panels: boostWidgetNumber(counts.panels, 0),
    });
  }
  function boostWidgetRestoreLabel(snapshot, language) {
    const s = snapshot && typeof snapshot === "object" ? snapshot : {};
    const panels = boostWidgetNumber(s.panels, 0), tabs = boostWidgetNumber(s.tabs, 0);
    return panels + tabs
      ? boostWidgetText(language, "card.restoreLabel", { panels, tabs })
      : boostWidgetText(language, "card.nothingRestore");
  }
  function boostWidgetFeedbackText(state, language) {
    const src = state && typeof state === "object" ? state : {};
    const unloaded = src.unloaded && typeof src.unloaded === "object" ? src.unloaded : {};
    const kept = Array.isArray(src.kept) ? src.kept : [];
    const names = kept.slice(0, 3).map((entry) => {
      const row = entry && typeof entry === "object" ? entry : { id: entry };
      const id = String(row.id || row.kind || "tab");
      const reason = String(row.reason || "kept");
      return id + " (" + reason + ")";
    });
    if (kept.length > 3)
      names.push(boostWidgetText(language, "feedback.keptMore", { count: kept.length - 3 }));
    return boostWidgetText(language, "feedback.gameOn", {
      mb: boostWidgetNumber(src.freedMB ?? src.finalFreedMB, 0),
      tabs: boostWidgetNumber(unloaded.tabs, 0),
      panels: boostWidgetNumber(unloaded.panels, 0),
      kept: names.length ? names.join(", ") : boostWidgetText(language, "feedback.keptNone"),
    });
  }
  function boostWidgetOffText(snapshot, language) {
    const restore = boostWidgetRestoreLabel(snapshot, language);
    const nothing = boostWidgetText(language, "card.nothingRestore");
    return boostWidgetText(language, "feedback.gameOff") +
      (restore && restore !== nothing ? " \u00b7 " + restore : "");
  }
  function boostWidgetResultText(result, language) {
    const r = result && typeof result === "object" ? result : {};
    if (r.unloaded && (r.unloaded.tabs || r.unloaded.panels)) {
      return boostWidgetText(language, "card.deepResult", {
        tabs: boostWidgetNumber(r.unloaded.tabs, 0), panels: boostWidgetNumber(r.unloaded.panels, 0),
        mb: boostWidgetNumber(r.freedMB, 0),
      });
    }
    return boostWidgetText(language, "card.result", { mb: boostWidgetNumber(r.freedMB, 0) });
  }
  // B5/OW-92: the limiter's own numbers. Two cadences, both one-shot chains: a slow idle check and a faster one while
  // above 70 % of the limit. Nothing here is an interval.
  const LIMIT_IDLE_MS = 60000;
  const LIMIT_HOT_MS = 10000;
  const LIMIT_HOT_SHARE = 0.7; // "above 70 % of the limit" is the plan's own line
  const LIMIT_BATCH = 3;       // tabs per batch in a hard run, re-sampled after each
  const LIMIT_NAG_MS = 10 * 60000; // nothing eligible: at most one toast per ten minutes
  // B7/OW-94: the two tab attributes that decide whether a browser may be deactivated in Game Mode. An audible tab
  // keeps playing a podcast; the video preview's own source tab keeps its picture. Everything else may go inactive.
  const GAME_MODE_EXEMPT = Object.freeze(["audible", "video-source"]);
  const DEFAULT_LIMIT = Object.freeze({
    mb: 4096,
    mode: "soft",
    cooldownS: 60,
    targetPct: 85,
  });

  function standaloneReady(start) {
    let started = false;
    const run = () => {
      if (started || !window.gBrowser) return;
      started = true;
      try {
        Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
      } catch (_) {}
      start();
    };
    const observer = {
      observe(subject, topic) {
        if (subject === window && topic === "browser-delayed-startup-finished") run();
      },
    };
    if (window.gBrowser && (!window.gBrowserInit || window.gBrowserInit.delayedStartupFinished)) run();
    else {
      Services.obs.addObserver(observer, "browser-delayed-startup-finished");
      window.addEventListener(
        "unload",
        () => {
          try {
            Services.obs.removeObserver(observer, "browser-delayed-startup-finished");
          } catch (_) {}
        },
        { once: true },
      );
      if (window.gBrowserInit?.delayedStartupFinished) run();
    }
  }

  (function () {
    function start() {
      if (window.ZentralBoost) return window.ZentralBoost.destroy;

      /* ---------------- preferences (read live, never cached at startup) ---------------- */

      const prefBool = (key, fallback) => {
        try {
          return Services.prefs.getBoolPref(key, fallback);
        } catch (_) {
          return fallback;
        }
      };
      const prefString = (key, fallback) => {
        try {
          return Services.prefs.getStringPref(key, fallback);
        } catch (_) {
          return fallback;
        }
      };
      const prefInt = (key, fallback) => {
        try {
          return Services.prefs.getIntPref(key, fallback);
        } catch (_) {
          return fallback;
        }
      };

      // OW-112: `unload_pinned` says what it does. A pref that somebody already set wins; otherwise the retired
      // `keep_pinned = true` is still honoured as a read-only fallback for one release. A one-time migration writes
      // the new pref so the choice survives after that fallback is removed, without ever overwriting an explicit
      // new choice (including an explicit `false`).
      const prefHasUserValue = (key) => {
        try {
          return Services.prefs.prefHasUserValue?.(key) === true;
        } catch (_) {
          return false;
        }
      };
      const mayUnloadPinned = () => {
        if (prefHasUserValue(PREF.UNLOAD_PINNED)) return prefBool(PREF.UNLOAD_PINNED, false);
        return prefBool(PREF.LEGACY_KEEP_PINNED, false) || prefBool(PREF.UNLOAD_PINNED, false);
      };
      const migrateUnloadPinned = () => {
        try {
          if (!prefBool(PREF.LEGACY_KEEP_PINNED, false)) return;
          if (prefHasUserValue(PREF.UNLOAD_PINNED)) return;
          Services.prefs.setBoolPref(PREF.UNLOAD_PINNED, true);
        } catch (_) {}
      };
      migrateUnloadPinned();

      /* ---------------- teardown ---------------- */

      const cleanups = [];
      const onCleanup = (fn) => {
        if (typeof fn === "function") cleanups.push(fn);
        return fn;
      };
      const timers = new Set();
      const setTimer = (fn, ms) => {
        let id = 0;
        id = window.setTimeout(() => {
          timers.delete(id);
          try {
            fn();
          } catch (error) {
            warn(error);
          }
        }, Math.max(0, Number(ms) || 0));
        timers.add(id);
        return id;
      };
      const clearTimer = (id) => {
        if (!id) return;
        timers.delete(id);
        try {
          window.clearTimeout(id);
        } catch (_) {}
      };

      const warn = (message) => {
        try {
          (window.console || console).warn("[Zentral Boost]", message);
        } catch (_) {}
      };

      /* ---------------- B2.1 memory meter ---------------- */
      // Firefox reports ProcInfo.memory in bytes. The widget's MB/GB switch is decimal
      // (1000 MB = 1 GB), so one conversion here keeps every reading and `freedMB`
      // in the unit the rest of Zentral already uses.
      const PROC_MEMORY_BYTES_PER_MB = 1_000_000;

      let probeInfo = null;
      const readProcInfo = () => {
        try {
          if (typeof ChromeUtils?.requestProcInfo !== "function") return null;
          return ChromeUtils.requestProcInfo();
        } catch (_) {
          return null;
        }
      };

      // Sum of the parent and every child's `memory` (BYTES), converted once to MB. Pure enough to
      // test directly: the caller hands in the object a browser returned, so nothing here talks to Gecko.
      function memoryMBFrom(info) {
        if (!info || typeof info !== "object") return null;
        let total = 0;
        let seen = 0;
        const add = (proc) => {
          const value = Number(proc?.memory);
          if (!Number.isFinite(value) || value < 0) return;
          total += value;
          seen += 1;
        };
        add(info);
        const children = Array.isArray(info.children) ? info.children : [];
        for (const child of children) add(child);
        return seen ? Math.round(total / PROC_MEMORY_BYTES_PER_MB) : null;
      }

      let memorySupport = null; // null = not probed yet, false = the build cannot answer

      function applyAsyncProcInfo(promise) {
        memorySupport = true;
        Promise.resolve(promise)
          .then((resolved) => {
            if (disposed) return;
            const mb = memoryMBFrom(resolved);
            if (mb != null) {
              lastSampleMB = mb;
              emit(mb);
            }
          })
          .catch(() => {});
      }

      function memoryMB() {
        // One probe at most: the startup check's own answer is used as the first reading rather than thrown away and
        // re-read (a browser that answers costs one read, a build that cannot answer warns once).
        const info = probeInfo || readProcInfo();
        probeInfo = null;
        if (!info) {
          if (memorySupport !== false) {
            memorySupport = false;
            warn(
              "this build does not expose ChromeUtils.requestProcInfo(); the memory reading is unavailable",
            );
          }
          return null;
        }
        if (typeof info.then === "function") {
          applyAsyncProcInfo(info);
          return lastSampleMB;
        }
        memorySupport = true;
        return memoryMBFrom(info);
      }

      /* ---------------- B2.2 Level 1: free memory without losing anything ---------------- */

      // Cc/Ci are window globals in a chrome window; both are looked up lazily because a test harness has neither.
      const reporterManager = () => {
        try {
          const C = globalThis.Cc || window.Cc;
          const I = globalThis.Ci || window.Ci;
          if (!C || !I) return null;
          return C["@mozilla.org/memory-reporter-manager;1"].getService(
            I.nsIMemoryReporterManager,
          );
        } catch (_) {
          return null;
        }
      };

      // The GC/CC pair on its own. OW-121 makes this the shared tail of the light-clean actions, and Level 2's
      // final settle still uses it after the tab/panel sweep so its own after-reading stays honest.
      function runGcCc() {
        try {
          if (typeof ChromeUtils?.forceGC === "function") ChromeUtils.forceGC();
        } catch (_) {}
        try {
          if (typeof ChromeUtils?.forceCC === "function") ChromeUtils.forceCC();
        } catch (_) {}
      }

      // Gecko's minimizeMemoryUsage takes a callback; some builds reject a bare function strictly, so it is wrapped in
      // an object with run() (the plan's own instruction) and every step is separately guarded: GC/CC that a build
      // refuses must not turn "free memory" into an error a person sees.
      //
      // OW-121: this is ONE shared light-clean action list, not a second 3 s wait. Level 1 uses it on its own;
      // Level 2 now awaits it before its tab/panel sweep, so "deep clean also does light clean" is true in the
      // module, not only in the widget. A build whose reporter manager never answers is bounded by a 50 ms
      // fallback, and destroy() resolves the pending promise instead of leaving a run hanging.
      const lightCleanCancels = new Set();
      function lightClean() {
        return new Promise((resolve) => {
          let settled = false;
          let fallback = 0;
          const done = (by) => {
            if (settled) return;
            settled = true;
            lightCleanCancels.delete(cancel);
            clearTimer(fallback);
            if (!disposed) runGcCc();
            resolve(by);
          };
          const cancel = () => done("gc-cc-only");
          lightCleanCancels.add(cancel);
          let manager = null;
          try {
            manager = reporterManager();
          } catch (_) {}
          if (!manager || typeof manager.minimizeMemoryUsage !== "function") {
            done("gc-cc-only");
            return;
          }
          let answered = false;
          const answer = () => {
            if (answered) return;
            answered = true;
            done("minimize");
          };
          fallback = setTimer(() => done("gc-cc-only"), 50);
          try {
            manager.minimizeMemoryUsage({ run: answer });
          } catch (_) {
            done("gc-cc-only");
          }
        });
      }

      let level1Busy = false;
      let level1Timer = 0;
      let cancelLevel1 = null;

      function runLevel1() {
        if (disposed || level1Busy) return Promise.resolve(null);
        const beforeMB = memoryMB();
        if (beforeMB != null) lastSampleMB = beforeMB;
        level1Busy = true;
        return new Promise((resolve) => {
          let settled = false;
          const settle = (value) => {
            if (settled) return;
            settled = true;
            cancelLevel1 = null;
            level1Busy = false;
            resolve(value);
          };
          cancelLevel1 = () => settle(null);
          // Level 1 is still "one click, one pass": the shared light-clean actions answer with the path they
          // used, then the SAME 3 s settle as before reads memory and emits exactly one result. No second
          // GC/minimize is stacked, no tab is touched, and a dispose while the manager answer or settle timer
          // is pending resolves null rather than leaving a dangling Promise. The widget, the shortcut and the
          // startup trim all keep their old contract: one light run, one honest after-reading, one toast.
          const finish = (freedBy) => {
            if (disposed) {
              settle(null);
              return;
            }
            level1Timer = setTimer(() => {
              level1Timer = 0;
              if (disposed) {
                settle(null);
                return;
              }
              const afterMB = memoryMB();
              const result = {
                beforeMB,
                afterMB,
                freedMB:
                  beforeMB != null && afterMB != null ? Math.max(0, beforeMB - afterMB) : null,
                by: freedBy,
              };
              lastSampleMB = afterMB != null ? afterMB : lastSampleMB;
              emit(afterMB != null ? afterMB : lastSampleMB);
              settle(result);
            }, LEVEL1_SETTLE_MS);
          };
          void lightClean().then(finish).catch(() => finish("gc-cc-only"));
        });
      }

      // Destroy while one or more light-clean answers are pending must not leave Level 1 / Level 2 waiting forever.
      onCleanup(() => {
        for (const cancel of [...lightCleanCancels]) cancel();
        lightCleanCancels.clear();
      });

      // Destroy while a Level 1 run is settling must not touch a disposed feature.
      onCleanup(() => {
        clearTimer(level1Timer);
        level1Timer = 0;
        level1Busy = false;
        cancelLevel1?.();
      });

      /* ---------------- sampling (only while someone is looking) ---------------- */

      const changeListeners = new Set();
      // G7: UI feedback is event-driven. The Game Mode pass emits ON, its settled and final reports, and OFF;
      // the cards subscribe once and never poll for a reading that G8 already owns.
      const gameModeListeners = new Set();
      function emitGameModeEvent(event) {
        for (const listener of [...gameModeListeners]) {
          try { listener(event); } catch (_) {}
        }
      }
      function onGameModeEvent(cb) {
        if (typeof cb !== "function") return () => {};
        gameModeListeners.add(cb);
        return () => gameModeListeners.delete(cb);
      }
      let sampleTimer = 0;
      let samplerUsers = 0; // the popup and the limiter (OW-92) are the only two callers
      let lastSampleMB = null;
      // OW-115: the last deep pass's named skip counts, read by the popup. A plain object, never a live count
      // of every tab: this is a one-line explanation, not another sampler or listener.
      let lastSkipped = {};

      // One door for "the total changed": a sample and a run both report here, so a card cannot tell them apart by
      // accident. A listener that throws is one listener's problem, never the module's.
      const emit = (value) => {
        for (const listener of changeListeners) {
          try {
            listener(value);
          } catch (_) {}
        }
      };

      const sampleOnce = () => {
        const value = memoryMB();
        if (value != null) {
          lastSampleMB = value;
          emit(value);
        }
        return value;
      };

      function armSampler() {
        if (sampleTimer || !samplerUsers) return;
        const tick = () => {
          sampleTimer = 0;
          if (!samplerUsers || disposed) return;
          sampleOnce();
          if (samplerUsers) sampleTimer = setTimer(tick, SAMPLE_INTERVAL_MS);
        };
        sampleOnce();
        sampleTimer = setTimer(tick, SAMPLE_INTERVAL_MS);
      }

      function stopSampler() {
        clearTimer(sampleTimer);
        sampleTimer = 0;
      }

      // "Someone is looking": the popup opened, or the limiter (later) asked for readings. Balanced by stopSampling.
      function startSampling() {
        if (disposed) return;
        samplerUsers += 1;
        armSampler();
      }

      function stopSampling() {
        samplerUsers = Math.max(0, samplerUsers - 1);
        if (!samplerUsers) stopSampler();
      }

      function onChange(cb) {
        if (typeof cb !== "function") return () => {};
        changeListeners.add(cb);
        return () => changeListeners.delete(cb);
      }

      /* ---------------- B2.3 post-startup trim ---------------- */

      // A tab is playing when Gecko or Zen says so. Both are read live and both are optional: a build without them
      // simply has no audible tab.
      function mediaPlaying() {
        try {
          const tabs = [...(window.gBrowser?.tabs || [])];
          if (typeof window.gBrowser?.getTabsWithoutMediaBlocked === "function") {
            const unblocked = window.gBrowser.getTabsWithoutMediaBlocked();
            if (Array.isArray(unblocked) && unblocked.length) return true;
          }
          return tabs.some((tab) => {
            if (tab?.soundPlaying) return true;
            try {
              return tab?.linkedBrowser?.browser?.isPlaying?.() === true;
            } catch (_) {
              return false;
            }
          });
        } catch (_) {
          return false;
        }
      }

      let trimTimer = 0;
      let trimMaxTimer = 0;
      let trimIdleId = 0;
      let trimDone = false;
      let lastInputAt = 0;
      let inputListenersAttached = false;

      const clearTrimTimers = () => {
        clearTimer(trimTimer);
        clearTimer(trimMaxTimer);
        trimTimer = 0;
        trimMaxTimer = 0;
        if (trimIdleId) {
          try {
            window.cancelIdleCallback?.(trimIdleId);
          } catch (_) {}
          trimIdleId = 0;
        }
      };

      const trimAllowed = () => !disposed && !trimDone && !gameMode.on && prefBool(PREF.STARTUP_TRIM, true);

      function armTrimQuietTimer() {
        if (!trimAllowed()) return;
        clearTimer(trimTimer);
        trimTimer = setTimer(runTrimIfQuiet, TRIM_QUIET_MS);
      }

      const onUserInput = () => {
        lastInputAt = Date.now();
        if (!trimAllowed()) return;
        armTrimQuietTimer();
      };

      const detachInputListeners = () => {
        if (!inputListenersAttached) return;
        inputListenersAttached = false;
        for (const type of INPUT_EVENTS) {
          try {
            window.removeEventListener(type, onUserInput, { capture: true, passive: true });
          } catch (_) {}
        }
      };

      // G8: a one-time startup trim must not fire later behind Game Mode's own settle/clean chain or Restore.
      function skipStartupTrimForGameMode() {
        clearTrimTimers();
        trimDone = true;
        detachInputListeners();
      }

      function finishStartupTrim() {
        if (gameMode.on) {
          skipStartupTrimForGameMode();
          return;
        }
        trimDone = true;
        clearTrimTimers();
        detachInputListeners();
        void runLevel1();
      }

      function runTrimIfQuiet() {
        trimTimer = 0;
        if (!trimAllowed()) return;
        // Two reasons to wait rather than run: the person is typing/clicking, or something is playing. Both re-arm one
        // timer; nothing is polled, and the hard ceiling (TRIM_MAX_WAIT_MS) stops the wait from outliving the session.
        if (mediaPlaying()) {
          armTrimQuietTimer();
          return;
        }
        if (typeof window.requestIdleCallback === "function") {
          try {
            trimIdleId = window.requestIdleCallback(
              () => {
                trimIdleId = 0;
                if (!trimAllowed()) return;
                finishStartupTrim();
              },
              { timeout: TRIM_IDLE_TIMEOUT_MS },
            );
            return;
          } catch (_) {
            trimIdleId = 0;
          }
        }
        finishStartupTrim();
      }

      for (const type of INPUT_EVENTS) {
        window.addEventListener(type, onUserInput, { capture: true, passive: true });
      }
      inputListenersAttached = true;
      onCleanup(detachInputListeners);

      function scheduleStartupTrim() {
        if (!trimAllowed()) return;
        clearTrimTimers();
        armTrimQuietTimer();
        trimMaxTimer = setTimer(() => {
          // The ceiling: if the browser was never quiet for 90 s (a first-run session with lots of input), one trim
          // still happens once, and never again.
          trimMaxTimer = 0;
          if (!trimAllowed()) return;
          finishStartupTrim();
        }, TRIM_MAX_WAIT_MS);
      }

      onCleanup(clearTrimTimers);

      /* ---------------- B4/OW-91: Level 2, what may go to sleep, and Restore ---------------- */

      // The policy table is shared with TabUnload: `loader/ZentralTabPolicy.js`, embedded in the standalone build and
      // loaded once by the runtime in the full pack. Without it (an old full pack) the module refuses to run a deep
      // pass rather than guessing: unloading a tab that is playing music is not something to re-derive here.
      const policy = () => window.ZentralTabPolicy || null;

      // The panel side. `ZentralPanels` publishes these on the window in the full pack; a standalone Boost has no
      // panels at all, which is why every use is guarded and a missing panel layer is normal, not an error.
      const panels = () => {
        const api = window.Zentral;
        const ctx = api?.Panels || api?.panels || null;
        return ctx && typeof ctx === "object" ? ctx : null;
      };
      const essentialRecords = () => {
        try {
          const map = panels()?.essentialPanels;
          if (!map || typeof map.values !== "function") return [];
          return [...map.values()].filter((record) => record?.tab);
        } catch (_) {
          return [];
        }
      };

      // The video preview's source tab, when the video module is up: unloading it would blank the preview, so it is one
      // of the policy's never-rules.
      const videoSourceTab = () => {
        try {
          const source = window.Zentral?.Video?.sourceTab || window.__zentralVideoSourceTab;
          return source?.isConnected ? source : null;
        } catch (_) {
          return null;
        }
      };

      const modeOf = (record) => {
        const raw = String(record?.backgroundMode || "");
        return BACKGROUND_MODES.includes(raw) ? raw : "live";
      };

      // The undo record: what a deep run put to sleep, newest last, capped. Panels and tabs are kept apart because
      // Restore treats them differently (panels wake now, tabs wake when clicked).
      const undoState = { panels: [], tabs: [] };
      const rememberUndone = (kind, entry) => {
        const list = undoState[kind];
        list.push(entry);
        while (list.length > UNDO_CAP) list.shift();
      };
      const undoSize = () => undoState.panels.length + undoState.tabs.length;

      /* G4: ONE ephemeral parking tab, and the two one-shot scope timers that own its deferred selection changes.
       * Notes' `onZenSelect` hazard is real: changing selection inside Zen's TabSelect dispatch corrupts the tab
       * switcher and can leave a pending tab unloaded forever. Both parking and handing the selection back happen
       * in a scope `setTimeout(..., 0)`, never in a TabSelect listener. */
      const parking = {
        parkTimer: 0,
        restoreTimer: 0,
        pendingTab: null,
        pendingOriginal: null,
        retiringTab: null,
        // G8: the plan-driven unload pass waits for G4's deferred selection/unload door. The hook is cancelled by
        // Game Mode off, a second ON, a Restore-owned hand-back or destroy; it is never a second timer chain.
        parkHook: null,
      };
      // G5: ONE restore engine. Every timer and load listener below belongs to this scope; a second Game Mode ON,
      // a new Restore, or destroy cancels all of them. The log exists for tests and the G7 report, not as history.
      const restoreWork = {
        active: false,
        cancelled: false,
        reason: "",
        generation: 0,
        profile: "all",
        staggerMs: RESTORE_DEFAULT_STAGGER_MS,
        timer: 0,
        selectionTimer: 0,
        selectionHook: null,
        queue: [],
        loading: new Set(),
        items: new Set(),
        // G6: IDs whose `loadEssentialInBackground(record,false)` call was made BY Restore, not by a person.
        wakingPanels: new Set(),
        log: [],
      };
      function closeParkingTab(tab) {
        if (!tab) return false;
        try {
          const gBrowser = window.gBrowser;
          if (typeof gBrowser?.removeTab === "function") {
            gBrowser.removeTab(tab, { animate: false, skipPermitUnload: true, skipSessionStore: true });
          } else {
            tab.remove?.();
          }
          return true;
        } catch (_) {
          return false;
        }
      }
      function parkingUserContextId(tab) {
        const raw = tab?.userContextId ?? tab?.getAttribute?.("usercontextid");
        const value = Number(raw);
        return Number.isFinite(value) ? value : 0;
      }
      function parkingTabOptions(tab) {
        const options = {
          skipAnimation: true,
          skipSessionStore: true,
          userContextId: parkingUserContextId(tab),
        };
        try {
          options.triggeringPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
        } catch (_) {
          // A Chrome scope without the security manager still gets the two skip flags; addTab decides if that is
          // enough, and a refusal below leaves the selected tab exactly where it was.
        }
        return options;
      }
      function nearestNormalTab(tabs, original, parked) {
        const list = Array.isArray(tabs) ? [...tabs] : [];
        const indexOfOriginal = list.indexOf(original);
        const indexOfParked = list.indexOf(parked);
        const origin = indexOfOriginal >= 0 ? indexOfOriginal : (indexOfParked >= 0 ? indexOfParked : 0);
        const normal = (tab) =>
          tab && tab !== parked && !isBoostParkingTab(tab) && tab.isConnected !== false &&
          !tab.closing && !tab.hidden && !tab.hasAttribute?.("bgalazka-addon-host") &&
          tab.linkedPanel !== null && tab.linkedPanel !== undefined;
        for (let distance = 1; distance <= list.length; distance++) {
          if (normal(list[origin - distance])) return list[origin - distance];
          if (normal(list[origin + distance])) return list[origin + distance];
        }
        return list.find(normal) || null;
      }
      function parkingState() {
        return {
          pending: Boolean(parking.pendingTab || parking.parkTimer),
          parked: Boolean(gameSession.parkingTab),
          restoring: Boolean(parking.restoreTimer || parking.retiringTab),
          parkTimer: Boolean(parking.parkTimer),
          restoreTimer: Boolean(parking.restoreTimer),
        };
      }

      /* G3: ONE snapshot for Level 2 and Game Mode. Unlike `tab: null`, these entries keep the real tab element:
       * an unloaded tab stays in the strip as a pending row, so Restore (G5) can select/reload that exact element.
       * Also remembers which browser activity Game Mode changed, and the before/after readings for G7's report.
       * Cleared on Restore, window unload and destroy; never persisted across a restart. */
      const gameSession = {
        active: false,
        startedAt: 0,
        panels: [],
        tabs: [],
        originalSelected: null,
        parkingTab: null,
        activity: new Map(),
        beforeMB: null,
        afterMB: null,
        processesBefore: 0,
        processesAfter: 0,
      };
      function touchSession() {
        if (gameSession.active) return;
        gameSession.active = true;
        gameSession.startedAt = Date.now();
      }
      function rememberSessionTab(entry) {
        touchSession();
        const list = gameSession.tabs;
        list.push(entry);
        while (list.length > SESSION_CAP) list.shift();
      }
      function rememberSessionPanel(entry) {
        touchSession();
        const list = gameSession.panels;
        list.push(entry);
        while (list.length > SESSION_CAP) list.shift();
      }
      function resetGameSession(teardown = false) {
        clearTimer(parking.parkTimer);
        parking.parkTimer = 0;
        parking.parkHook = null;
        const ownedParkingTabs = new Set(
          [gameSession.parkingTab, parking.pendingTab, parking.retiringTab].filter(Boolean),
        );
        parking.pendingTab = null;
        parking.pendingOriginal = null;
        // A Restore already scheduled its own deferred hand-back; do not close the tab twice. On a real teardown
        // that timer is cancelled and every Boost-owned parking tab is closed immediately.
        if (teardown) {
          clearTimer(parking.restoreTimer);
          parking.restoreTimer = 0;
          parking.retiringTab = null;
          for (const tab of ownedParkingTabs) closeParkingTab(tab);
        } else if (!parking.restoreTimer) {
          for (const tab of ownedParkingTabs) closeParkingTab(tab);
        }
        gameSession.active = false;
        gameSession.startedAt = 0;
        gameSession.panels.length = 0;
        gameSession.tabs.length = 0;
        gameSession.originalSelected = null;
        gameSession.parkingTab = null;
        gameSession.activity.clear();
        gameSession.beforeMB = null;
        gameSession.afterMB = null;
        gameSession.processesBefore = 0;
        gameSession.processesAfter = 0;
      }
      // Restore may only touch elements that are still in the strip; a closed tab is skipped silently.
      function sessionTabsForRestore() {
        return gameSession.tabs.filter(
          (entry) => entry?.tab && entry.tab.isConnected !== false && !entry.tab.closing,
        );
      }
      function sessionState() {
        return {
          active: gameSession.active,
          startedAt: gameSession.startedAt,
          panels: gameSession.panels.length,
          tabs: gameSession.tabs.length,
          restorableTabs: sessionTabsForRestore().length,
          hasSelected: Boolean(gameSession.originalSelected),
          hasParking: Boolean(gameSession.parkingTab),
          activity: gameSession.activity.size,
          beforeMB: gameSession.beforeMB,
          afterMB: gameSession.afterMB,
          processesBefore: gameSession.processesBefore,
          processesAfter: gameSession.processesAfter,
        };
      }

      /* G5: one bounded, staggered Restore engine. The tab wake is a copy of ZentralStartup.uc.js `wake(tab)`'s
       * essential two lines: re-check that the tab is really sleeping, then call `linkedBrowser.reload()` in the
       * background. It never selects the tab, adds a tab or invents a second way to reload a pending page. */
      function tabIsSleeping(tab) {
        return Boolean(
          !tab?.linkedPanel ||
          tab?.hasAttribute?.("pending") ||
          tab?.hasAttribute?.("discarded") ||
          (tab?.hasAttribute?.("zen-dormant") && tab?.getAttribute?.("zen-dormant") !== "false"),
        );
      }
      function wakePendingTab(tab) {
        if (!tab || tab.closing || tab.isConnected === false || !tabIsSleeping(tab)) return false;
        const browser = tab.linkedBrowser;
        if (typeof browser?.reload !== "function") return false;
        browser.reload(); // Startup's native lazy reload binding; selecting the tab would wake it in the foreground.
        return true;
      }
      function restoreNote(message) {
        restoreWork.log.push(String(message || ""));
        while (restoreWork.log.length > 500) restoreWork.log.shift();
      }
      function maybeFinishRestore() {
        if (!restoreWork.active) return;
        if (!restoreWork.selectionTimer && !restoreWork.timer && !restoreWork.queue.length &&
            !restoreWork.loading.size && !restoreWork.items.size) finishRestore();
      }
      function finishRestore() {
        if (!restoreWork.active) return;
        restoreWork.active = false;
        restoreWork.cancelled = false;
        restoreWork.reason = "complete";
        restoreWork.timer = 0;
        restoreWork.queue.length = 0;
        restoreWork.loading.clear();
        restoreWork.items.clear();
        restoreWork.wakingPanels.clear();
        restoreWork.selectionHook = null;
        restoreNote("done");
      }
      function cancelRestore(reason) {
        const hadWork = restoreWork.active || restoreWork.timer || restoreWork.selectionTimer ||
          restoreWork.items.size || restoreWork.queue.length || restoreWork.loading.size;
        if (!hadWork) return false;
        restoreWork.generation += 1;
        const adoptedParkingTimer = Boolean(
          parking.restoreTimer && restoreWork.selectionTimer === parking.restoreTimer,
        );
        clearTimer(restoreWork.timer);
        restoreWork.timer = 0;
        clearTimer(restoreWork.selectionTimer);
        restoreWork.selectionTimer = 0;
        if (adoptedParkingTimer) {
          parking.restoreTimer = 0;
          const retiring = parking.retiringTab;
          parking.retiringTab = null;
          closeParkingTab(retiring);
        }
        restoreWork.selectionHook = null;
        for (const item of restoreWork.items) {
          clearTimer(item.timeoutId);
          try { item.cleanup?.(); } catch (_) {}
        }
        restoreWork.items.clear();
        restoreWork.queue.length = 0;
        restoreWork.loading.clear();
        restoreWork.wakingPanels.clear();
        restoreWork.active = false;
        restoreWork.cancelled = true;
        restoreWork.reason = String(reason || "cancelled");
        restoreNote("cancel:" + restoreWork.reason);
        return true;
      }
      function ensureRestoreTick(delay) {
        if (!restoreWork.active || disposed || restoreWork.timer) return;
        restoreWork.timer = setTimer(restoreTick, Math.max(0, Number(delay) || 0));
      }
      function startRestoreTask(task) {
        restoreWork.loading.add(task);
        const item = {
          task, generation: restoreWork.generation, done: false, timeoutId: 0, cleanup: null,
        };
        restoreWork.items.add(item);
        const finish = (why) => {
          if (item.done || item.generation !== restoreWork.generation || !restoreWork.active) return;
          item.done = true;
          clearTimer(item.timeoutId);
          item.timeoutId = 0;
          try { item.cleanup?.(); } catch (_) {}
          restoreWork.items.delete(item);
          restoreWork.loading.delete(task);
          if (!restoreWork.active) return;
          if (restoreWork.queue.length) ensureRestoreTick(restoreWork.staggerMs);
          else if (!restoreWork.loading.size && !restoreWork.items.size) finishRestore();
        };
        // Register the timeout and the load listeners BEFORE the fallible wake, so every partial attachment has
        // an owner even when reload() throws. There is no polling; whichever arrives first finishes the item.
        item.timeoutId = setTimer(() => finish("timeout"), RESTORE_LOAD_TIMEOUT_MS);
        let hasListeners = false;
        const browser = task.tab?.linkedBrowser;
        if (browser && typeof browser.addEventListener === "function") {
          let inert = false;
          const onLoad = () => { if (!inert) finish("load"); };
          item.cleanup = () => {
            inert = true;
            for (const name of ["load", "DOMContentLoaded"]) {
              try { browser.removeEventListener?.(name, onLoad); } catch (_) {}
            }
          };
          for (const name of ["load", "DOMContentLoaded"]) {
            try { browser.addEventListener(name, onLoad, { once: true }); hasListeners = true; } catch (_) {}
          }
        }
        let result;
        try {
          result = task.run();
        } catch (_) {
          finish("failed");
          return;
        }
        if (result === false) {
          finish("failed");
          return;
        }
        if (result && typeof result.then === "function") {
          Promise.resolve(result).then(() => finish("ready"), () => finish("failed"));
        } else if (!hasListeners) {
          finish("started");
        }
      }
      function restoreTick() {
        restoreWork.timer = 0;
        if (!restoreWork.active || disposed) return;
        // ONE item per tick; the 2-slot cap is what keeps a whole 500-tab snapshot from spiking RAM at once.
        while (restoreWork.queue.length && restoreWork.loading.size < RESTORE_MAX_LOADING) {
          const task = restoreWork.queue.shift();
          let needed = false;
          try { needed = Boolean(task.needsWork()); } catch (_) {}
          if (!needed) {
            restoreNote("skip:" + task.label);
            continue;
          }
          restoreNote(task.label);
          startRestoreTask(task);
          break;
        }
        if (restoreWork.queue.length) ensureRestoreTick(restoreWork.staggerMs);
        else if (!restoreWork.loading.size && !restoreWork.items.size) finishRestore();
      }
      function currentPanelRecord(entry) {
        const appId = String(entry?.appId || "");
        const live = essentialRecords().find((r) => String(r?.app?.id || r?.appId || "") === appId);
        return live || entry?.recordRef || null;
      }
      /* R2: a panel entry only means something when the page really lived in the panel. `holders` is what R1 wrote;
       * data from an older build has no `holders`, so it keeps its old meaning through `wasLoaded`. */
      function panelHadHolder(entry) {
        if (entry && entry.holders) return entry.holders.panel === true;
        return entry?.wasLoaded === true;
      }
      // Data written by an older build has no `holders`; this is the one place that gives it the same shape, so the
      // engine never has to guess with a hard-coded `wasLoaded: false`.
      function normalizePanelRestoreEntry(entry) {
        if (entry && entry.holders) return entry;
        return {
          ...(entry || {}),
          wasLoaded: entry?.wasLoaded === true,
          holders: { panel: entry?.wasLoaded === true, tab: false },
        };
      }
      function panelNeedsWork(entry) {
        if (!panelHadHolder(entry)) return false;
        const record = currentPanelRecord(entry);
        if (!record || isBoostParkingTab(record.tab)) return false;
        return !livePanelBrowser(String(entry?.appId || ""));
      }
      function runPanelRestore(entry) {
        const record = currentPanelRecord(entry);
        const ctx = panels();
        if (!record || typeof ctx?.loadEssentialInBackground !== "function") return false;
        const appId = String(entry?.appId || record?.app?.id || "");
        // G6: Restore's own wake must not be mistaken for a person clicking the panel. Keep the marker across a
        // promise-returning wake so the low-level explicit path never erases this item from the restore queue.
        if (appId) restoreWork.wakingPanels.add(appId);
        let result;
        try {
          result = ctx.loadEssentialInBackground(record, false); // explicit wake, never an automatic preload
        } catch (_) {
          if (appId) restoreWork.wakingPanels.delete(appId);
          throw _;
        }
        const clear = () => { if (appId) restoreWork.wakingPanels.delete(appId); };
        if (result && typeof result.then === "function") Promise.resolve(result).then(clear, clear);
        else clear();
        return result === false ? false : (result && typeof result.then === "function" ? result : true);
      }
      function tabNeedsWork(entry) {
        const tab = entry?.tab;
        // R2: a record tab is never turned into a second holder. When the record had a panel entry, the panel task
        // already woke it and this tab task is the OTHER holder's wake; when it had none, a live panel browser means
        // somebody else opened the app in the meantime, so leave that page alone.
        const appId = String(entry?.recordAppId || "");
        if (appId && entry?.hadPanelHolder !== true && livePanelBrowser(appId)) return false;
        return Boolean(
          tab && tab.isConnected !== false && !tab.closing && !isBoostParkingTab(tab) &&
          tabIsSleeping(tab) && typeof tab.linkedBrowser?.reload === "function",
        );
      }
      function runTabRestore(entry) {
        return wakePendingTab(entry?.tab);
      }
      function restoreSnapshotEntries() {
        // R2: only entries that really had the panel holder become panel tasks. Older data (no `holders`) keeps the
        // `wasLoaded` answer it was written with instead of the hard-coded `false` that created panels out of tabs.
        const panelEntries = gameSession.panels.length
          ? gameSession.panels.slice()
          : undoState.panels.map((entry) => normalizePanelRestoreEntry({
              appId: entry.appId,
              recordRef: null,
              mode: "live",
              wasLoaded: entry?.wasLoaded === true,
              when: entry.when || 0,
            }));
        const seenPanels = new Set();
        const panels = panelEntries.filter((entry) => {
          const id = String(entry?.appId || "");
          if (!id || seenPanels.has(id)) return false;
          if (!panelHadHolder(entry)) return false;
          seenPanels.add(id);
          return true;
        });
        const rank = (entry) => (String(entry?.mode || "") === "live" ? 0 : 1);
        panels.sort((a, b) => rank(a) - rank(b) || (Number(a?.when) || 0) - (Number(b?.when) || 0));
        const tabEntries = gameSession.tabs.length
          ? sessionTabsForRestore().slice()
          : undoState.tabs.filter((entry) => entry?.tab && entry.tab.isConnected !== false && !entry.tab.closing);
        const seenTabs = new Set();
        const panelHolderIds = new Set(panels.map((entry) => String(entry?.appId || "")));
        const tabs = tabEntries.filter((entry) => {
          if (!entry?.tab || seenTabs.has(entry.tab)) return false;
          seenTabs.add(entry.tab);
          return true;
        }).map((entry) => ({
          ...entry,
          hadPanelHolder: Boolean(entry?.recordAppId) && panelHolderIds.has(String(entry.recordAppId)),
        }));
        tabs.sort((a, b) =>
          (Number(b?.lastAccessed) || 0) - (Number(a?.lastAccessed) || 0) ||
          (Number(b?.when) || 0) - (Number(a?.when) || 0));
        return {
          panels,
          tabs,
          originalSelected: gameSession.originalSelected || parking.pendingOriginal || null,
          hasParking: Boolean(gameSession.parkingTab || parking.pendingTab || parking.retiringTab),
        };
      }
      function originalTabAlive(tab) {
        const tabs = Array.isArray(window.gBrowser?.tabs) ? window.gBrowser.tabs : [];
        return Boolean(tab && tab.isConnected !== false && !tab.closing && tabs.includes(tab));
      }
      function beginRestoreSelection(original, hasParking) {
        if (disposed || (!originalTabAlive(original) && !hasParking)) return false;
        restoreNote("select");
        restoreWork.selectionHook = () => {
          restoreWork.selectionTimer = 0;
          maybeFinishRestore();
        };
        const handed = unparkSelected();
        if (handed) {
          restoreWork.selectionTimer = parking.restoreTimer;
          if (!restoreWork.selectionTimer) {
            restoreWork.selectionHook = null;
            maybeFinishRestore();
          }
          return true;
        }
        restoreWork.selectionHook = null;
        if (!originalTabAlive(original)) {
          maybeFinishRestore();
          return true;
        }
        restoreWork.selectionTimer = setTimer(() => {
          restoreWork.selectionTimer = 0;
          if (disposed || !restoreWork.active) return;
          try { window.gBrowser.selectedTab = original; } catch (_) {}
          maybeFinishRestore();
        }, 0);
        return true;
      }
      function restoreProfileSettings(options = {}) {
        return {
          profile: normalizeRestoreProfile(options.profile || prefString(PREF.GAME_RESTORE_TABS, "all")),
          recentN: clampRestoreInt(
            Number.isFinite(Number(options.recentN)) ? options.recentN : prefInt(PREF.GAME_RESTORE_RECENT_N, RESTORE_DEFAULT_RECENT_N),
            RESTORE_DEFAULT_RECENT_N, 0, SESSION_CAP,
          ),
          staggerMs: clampRestoreInt(
            Number.isFinite(Number(options.staggerMs)) ? options.staggerMs : prefInt(PREF.GAME_RESTORE_STAGGER_MS, RESTORE_DEFAULT_STAGGER_MS),
            RESTORE_DEFAULT_STAGGER_MS, 0, 60000,
          ),
        };
      }
      function restoreState() {
        return {
          active: restoreWork.active,
          cancelled: restoreWork.cancelled,
          reason: restoreWork.reason,
          generation: restoreWork.generation,
          profile: restoreWork.profile,
          staggerMs: restoreWork.staggerMs,
          queue: restoreWork.queue.length,
          loading: restoreWork.loading.size,
          items: restoreWork.items.size,
          restoringPanels: restoreWork.wakingPanels.size,
          timer: Boolean(restoreWork.timer),
          selectionTimer: Boolean(restoreWork.selectionTimer),
          log: restoreWork.log.slice(),
        };
      }
      // G6: the low-level panel wake asks whether THIS call belongs to Restore. A person's click during a restore has
      // no marker and is still forgotten from the pending queue; Restore's own wake is never mistaken for a click.
      function isRestoreWake(kind, key) {
        return kind === "panel" && restoreWork.active && restoreWork.wakingPanels.has(String(key || ""));
      }
      // G6: a click/tile/tab that wakes an item before the staggered Restore reaches it must take that item out of
      // every snapshot list and out of the pending restore queue. Explicit user actions are never blocked here.
      function noteUserWake(kind, key) {
        if (disposed || !key) return 0;
        const isPanel = kind === "panel";
        const appId = String(key);
        const matches = (entry) => isPanel
          ? String(entry?.appId || entry?.recordRef?.app?.id || "") === appId
          : entry?.tab === key || entry?.url === appId || entry?.title === appId;
        const removeFrom = (list) => {
          let removed = 0;
          for (let i = list.length - 1; i >= 0; i--) {
            if (matches(list[i])) { list.splice(i, 1); removed += 1; }
          }
          return removed;
        };
        let removed = 0;
        removed += removeFrom(isPanel ? gameSession.panels : gameSession.tabs);
        removed += removeFrom(isPanel ? undoState.panels : undoState.tabs);
        for (let i = restoreWork.queue.length - 1; i >= 0; i--) {
          if (matches(restoreWork.queue[i]?.entry)) { restoreWork.queue.splice(i, 1); removed += 1; }
        }
        if (!isPanel && gameSession.originalSelected === key) gameSession.originalSelected = null;
        if (restoreWork.active) {
          restoreNote("user-wake:" + kind + ":" + appId);
          maybeFinishRestore();
        }
        return removed;
      }
      // G6: TabSelect is a user action, not an automatic wake. This listener only forgets an item the person just
      // loaded; it never changes the selection inside Zen's dispatch (the G4 hazard still applies).
      let userWakeListener = null;
      try {
        userWakeListener = (event) => {
          try { noteUserWake("tab", event?.target); } catch (_) {}
        };
        window.addEventListener("TabSelect", userWakeListener, true);
        onCleanup(() => {
          try { window.removeEventListener("TabSelect", userWakeListener, true); } catch (_) {}
          userWakeListener = null;
        });
      } catch (_) {
        userWakeListener = null;
      }
      function restoreSession(options = {}) {
        if (disposed) {
          return { started: false, active: false, cancelled: false, panels: 0, tabs: 0, tabTasks: 0, selection: false, reason: "disposed" };
        }
        // G8: an explicit Restore while Game Mode is still on owns the hand-back. Cancel the game's settle/late
        // chain so its one-shot clean never runs behind a restored page.
        if (gameMode.on) cancelGameModeWork("restore");
        cancelRestore("new-restore");
        restoreWork.generation += 1;
        restoreWork.log.length = 0;
        restoreWork.cancelled = false;
        restoreWork.reason = "starting";
        restoreWork.queue.length = 0;
        restoreWork.loading.clear();
        restoreWork.items.clear();
        restoreWork.wakingPanels.clear();
        const settings = restoreProfileSettings(options);
        restoreWork.profile = settings.profile;
        restoreWork.staggerMs = settings.staggerMs;
        const snapshot = restoreSnapshotEntries();
        const immediate = Boolean(options.immediate);
        const selection = beginRestoreSelection(snapshot.originalSelected, snapshot.hasParking);
        const includePanels = settings.profile !== "none";
        const panelTasks = includePanels ? snapshot.panels.map((entry) => ({
          kind: "panel", label: "panel:" + String(entry.appId || ""), entry,
          needsWork: () => panelNeedsWork(entry), run: () => runPanelRestore(entry),
        })) : [];
        let tabEntries = snapshot.tabs;
        if (settings.profile === "recent") tabEntries = tabEntries.slice(0, settings.recentN);
        else if (settings.profile === "panels" || settings.profile === "none") tabEntries = [];
        const tabTasks = immediate ? [] : tabEntries.map((entry) => ({
          kind: "tab", label: "tab:" + String(entry.url || entry.tab?.label || ""), entry, tab: entry.tab,
          needsWork: () => tabNeedsWork(entry), run: () => runTabRestore(entry),
        }));
        // Restore owns the snapshot from now on: clear the old undo lists and G3's larger snapshot in one place.
        undoState.panels.length = 0;
        undoState.tabs.length = 0;
        resetGameSession();
        const hasWork = selection || panelTasks.length || tabTasks.length || snapshot.hasParking;
        if (!hasWork) {
          restoreWork.active = false;
          restoreWork.reason = "empty";
          restoreNote("empty");
          return {
            started: false, active: false, cancelled: false, profile: settings.profile,
            panels: 0, tabs: snapshot.tabs.length, tabTasks: 0, selection: false,
            staggerMs: settings.staggerMs, generation: restoreWork.generation,
          };
        }
        restoreWork.active = true;
        let panelsStarted = 0;
        if (immediate) {
          // Legacy `restore()` keeps its documented promise: panel records are waked NOW, while tabs are only
          // reported and load when clicked. No timer, no stagger, no background reload in this profile.
          for (const task of panelTasks) {
            if (!task.needsWork()) { restoreNote("skip:" + task.label); continue; }
            restoreNote(task.label);
            if (task.run() !== false) panelsStarted += 1;
          }
          maybeFinishRestore();
          return {
            started: true, active: restoreWork.active, cancelled: false, profile: settings.profile,
            panels: panelsStarted, tabs: snapshot.tabs.length, tabTasks: 0, selection,
            staggerMs: settings.staggerMs, generation: restoreWork.generation,
          };
        }
        restoreWork.queue.push(...panelTasks, ...tabTasks);
        if (restoreWork.queue.length) ensureRestoreTick(0);
        maybeFinishRestore();
        return {
          started: true, active: restoreWork.active, cancelled: false, profile: settings.profile,
          panels: panelTasks.length, tabs: snapshot.tabs.length, tabTasks: tabTasks.length,
          selection, staggerMs: settings.staggerMs, generation: restoreWork.generation,
        };
      }

      // G4: the one deferred hand-back. Both a refused parking attempt and Restore/Game Mode off use it: select the
      // original (or the nearest normal tab if it was closed), then close Boost's own about:blank tab. Nothing in
      // this path force-closes a user's page; only the parking tab is removed, with skipPermitUnload.
      function scheduleParkingHandback(original, parked, rollback = false) {
        if (disposed || !parked) return false;
        clearTimer(parking.restoreTimer);
        if (parking.retiringTab && parking.retiringTab !== parked) closeParkingTab(parking.retiringTab);
        parking.restoreTimer = 0;
        parking.retiringTab = parked;
        parking.restoreTimer = setTimer(() => {
          parking.restoreTimer = 0;
          parking.retiringTab = null;
          if (disposed) return;
          const gBrowser = window.gBrowser;
          const tabs = Array.isArray(gBrowser?.tabs) ? gBrowser.tabs : [];
          const originalAlive =
            original && original.isConnected !== false && !original.closing && tabs.includes(original);
          const target = originalAlive
            ? original
            : rollback ? null : nearestNormalTab(tabs, original, parked);
          if (target) {
            try {
              gBrowser.selectedTab = target;
            } catch (_) {}
          }
          closeParkingTab(parked);
          // G5: a Restore may have adopted this 0 ms hand-back as its first step. Only AFTER the real selection
          // change and parking-tab close may the engine finish a selection-only profile.
          restoreWork.selectionHook?.();
          restoreWork.selectionHook = null;
        }, 0);
        return true;
      }

      // G4: create ONE parking tab, mark it before anything else can see it, and defer the selection to the next
      // task. The planner has already said this exact selected tab is not exempt. A failure at ANY step rolls back
      // to the old behavior (selected tab stays loaded, reason `selected`); no page that refuses beforeunload is
      // force-closed. `explicitUnloadTabs` is awaited before the snapshot records the tab.
      function parkSelected(plan = previewGameMode(), onParked = null) {
        if (disposed) return { created: false, reason: "disposed" };
        if (!prefBool(PREF.GAME_PARK_SELECTED, true)) return { created: false, reason: "kill-switch" };
        if (gameSession.parkingTab || parking.pendingTab || parking.parkTimer)
          return { created: false, reason: "already-parked" };
        if (parking.restoreTimer || parking.retiringTab)
          return { created: false, reason: "restoring" };
        const gBrowser = window.gBrowser;
        if (!gBrowser || typeof gBrowser.addTab !== "function" ||
            typeof gBrowser.removeTab !== "function" ||
            typeof gBrowser.explicitUnloadTabs !== "function")
          return { created: false, reason: "no-browser-api" };
        const original = gBrowser.selectedTab;
        if (!original || original.closing || original.isConnected === false ||
            isBoostParkingTab(original) || !plan || plan.park !== original)
          return { created: false, reason: "not-eligible" };
        let parked = null;
        try {
          parked = gBrowser.addTab("about:blank", parkingTabOptions(original));
          if (!parked) throw new Error("addTab returned nothing");
          parked.setAttribute?.(PARKING_ATTR, "true");
          parked.setAttribute?.("skipSessionStore", "true");
        } catch (error) {
          if (parked) closeParkingTab(parked);
          warn(error);
          return { created: false, reason: "addTab-refused" };
        }
        parking.pendingTab = parked;
        parking.pendingOriginal = original;
        parking.parkHook = typeof onParked === "function" ? onParked : null;
        parking.parkTimer = setTimer(() => {
          parking.parkTimer = 0;
          void (async () => {
            try {
              if (disposed) return;
              gBrowser.selectedTab = parked;
              if (gBrowser.selectedTab !== parked) throw new Error("selection-refused");
              const result = await gBrowser.explicitUnloadTabs([original]);
              if (disposed) return;
              if (result === false && !tabAlreadyAsleep(original)) throw new Error("unload-refused");
              if (original.closing || original.isConnected === false) throw new Error("original-closed");
              gameSession.originalSelected = original;
              gameSession.parkingTab = parked;
              touchSession();
              const entry = {
                tab: original,
                url: String(original.linkedBrowser?.currentURI?.spec || ""),
                title: String(original.label || ""),
                lastAccessed: Number(original.lastAccessed) || 0,
                wasPinned: Boolean(original.pinned || original.hasAttribute?.("zen-essential")),
                parked: true,
                when: Date.now(),
              };
              rememberUndone("tabs", entry);
              rememberSessionTab(entry);
              parking.pendingTab = null;
              parking.pendingOriginal = null;
              const hook = parking.parkHook;
              parking.parkHook = null;
              try { hook?.(); } catch (_) {}
            } catch (error) {
              parking.pendingTab = null;
              parking.pendingOriginal = null;
              gameSession.originalSelected = null;
              gameSession.parkingTab = null;
              warn(error);
              scheduleParkingHandback(original, parked, true);
              // G8: a refused parking selection must not lose the rest of the Game Mode pass; the selected tab is
              // skipped by the pass because no Boost-owned parking tab was selected.
              const hook = parking.parkHook;
              parking.parkHook = null;
              try { hook?.(); } catch (_) {}
            }
          })().catch((error) => warn(error));
        }, 0);
        return { created: true, tab: parked, original, deferred: true };
      }

      // G4: Restore and Game Mode off hand the selection back. The parking tab is retired by a deferred task; its
      // snapshot field is cleared immediately so nothing can park twice. `originalSelected` stays in the session
      // snapshot until Restore clears the whole snapshot — G5 needs it as the first item of the restore order even
      // when the person switches Game Mode off before pressing Restore. A window teardown bypasses the timer.
      function unparkSelected() {
        if (disposed) return false;
        const original = gameSession.originalSelected || parking.pendingOriginal;
        const parked = gameSession.parkingTab || parking.pendingTab;
        clearTimer(parking.parkTimer);
        parking.parkTimer = 0;
        parking.parkHook = null;
        if (!parked) return Boolean(parking.restoreTimer || parking.retiringTab);
        parking.pendingTab = null;
        parking.pendingOriginal = null;
        gameSession.parkingTab = null;
        return scheduleParkingHandback(original, parked, false);
      }

      function processCount() {
        const info = readProcInfo();
        return info ? 1 + (Array.isArray(info.children) ? info.children.length : 0) : 0;
      }

      // One tab's verdict, with every input the policy cannot read passed in. `opts.panelRecord` marks a tab that
      // backs an Essential-panel record and `opts.panelConsent` is that record's explicit permission to sleep it
      // (OW-111): the mode belongs to the panel loop, not to the `unload_pinned` pref or a generic tab sweep.
      const canUnload = (tab, ctx, opts = {}) => {
        const table = policy();
        if (!table) return { allowed: false, reason: "no-policy" };
        return table.isUnloadable(tab, {
          keepPinned: ctx.keepPinned,
          videoSourceTab: ctx.videoSourceTab,
          selectedTab: ctx.selectedTab,
          sessionUrl: ctx.sessionUrlFor?.(tab) || "",
          isHostTab: ctx.isHostTab,
          isPrivate: ctx.isPrivate,
          isPanelRecord: Boolean(opts.panelRecord),
          panelConsent: Boolean(opts.panelConsent),
        });
      };

      // OW-115: how many tabs are currently loaded, split by pinned/Essential vs ordinary. The policy's own
      // "already unloaded" test is the one definition, so a discarded/pending/dormant row is never counted as
      // loaded. Called from state() on demand only — no scan in a timer, listener or hot path.
      const loadedTabCounts = () => {
        const counts = { pinned: 0, unpinned: 0 };
        const alreadyUnloaded = policy()?.isUnloadable_AlreadyUnloaded;
        if (!alreadyUnloaded) return counts;
        const tabs = window.gBrowser?.tabs;
        if (!tabs || !Array.isArray(tabs)) return counts;
        for (const tab of tabs) {
          if (!tab || isBoostParkingTab(tab) || alreadyUnloaded(tab)) continue;
          if (tab.pinned || tab.hasAttribute?.("zen-essential")) counts.pinned += 1;
          else counts.unpinned += 1;
        }
        return counts;
      };

      /* G1: ONE helper for every "put this Essential-panel record to sleep" path. The page can live in TWO places:
       * the panel's own <browser> (state.appBrowsers, made by getOrCreateAppBrowser) and the strip tab. Unloading
       * only the tab leaves WhatsApp/Messenger/arena.ai fully loaded in the panel — Zentral's own CSS even says a
       * pending tab can contain a loaded panel. `apps.closeApp(appId)` is the public unload method the "Unload App"
       * menu uses: it stops navigation, removes the <browser>, deletes it from appBrowsers and sets the tile
       * data-loaded="false". Order matters: panel browser FIRST, then the tab, and never for the audible / selected /
       * video-source exceptions. Wake stays with ctx.loadEssentialInBackground(record, false), which re-creates the
       * app browser on demand; that side of the pair is deliberately unchanged. */
      function livePanelBrowser(appId) {
        const apps = window.Zentral?.Apps;
        const direct =
          (typeof apps?.getAppBrowser === "function" ? apps.getAppBrowser(appId) : null) ||
          apps?.appBrowsers?.get?.(appId) ||
          null;
        if (direct && direct.isConnected !== false) return direct;
        const all =
          typeof panels()?.getAllAppBrowsers === "function" ? panels().getAllAppBrowsers() : [];
        return (all || []).find(
          (b) => b && b._bgalazkaAppId === appId && b.isConnected !== false,
        ) || null;
      }
      function panelSleepExempt(record, ctx, browser) {
        const t = record?.tab;
        if (!t) return "no-tab";
        const table = policy();
        if (table?.isAudible?.(t) || browser?.audioPlaying) return "audible";
        if (ctx?.videoSourceTab && t === ctx.videoSourceTab) return "video-source";
        if (t === window.gBrowser?.selectedTab) return "selected";
        return "";
      }
      function tabAlreadyAsleep(tab) {
        const check = policy()?.isUnloadable_AlreadyUnloaded;
        if (typeof check === "function") return Boolean(check(tab));
        return Boolean(
          !tab?.linkedPanel ||
          tab?.hasAttribute?.("pending") ||
          tab?.hasAttribute?.("discarded") ||
          (tab?.hasAttribute?.("zen-dormant") && tab?.getAttribute?.("zen-dormant") !== "false"),
        );
      }

      async function sleepPanelRecord(record, ctx = {}) {
        const appId = record?.app?.id || record?.appId || "";
        const browser = appId ? livePanelBrowser(appId) : null;
        // R1: what existed BEFORE this call acts. `how` says what was freed now; `panelWas`/`tabWas` say which
        // holders the page lived in, so Restore can rebuild exactly those and nothing else.
        const panelWas = Boolean(browser);
        const tabWas = Boolean(record?.tab) && !tabAlreadyAsleep(record.tab);
        const exempt = panelSleepExempt(record, ctx, browser);
        if (exempt) return { slept: false, how: "none", reason: exempt, panelWas, tabWas };
        let panel = false;
        let tab = false;
        let reason = "";
        // (a) The panel's own app browser. closeApp persists zoom and cleans addon-host records through the
        // ZentralPanels wrapper, so Boost never touches the private browser map itself.
        if (browser && appId) {
          try {
            const apps = window.Zentral?.Apps;
            if (typeof apps?.closeApp === "function") {
              apps.closeApp(appId);
              panel = true;
            }
          } catch (_) {
            reason = "close-failed";
          }
        }
        // (b) The record's tab, but only when it is still loaded. A pending tab can still hold a loaded panel, so
        // this check is independent of (a); a tab the person opened and uses directly has no app browser at all and
        // this path does all the work. The shared policy still has the final say (PiP, sharing, host tab, private...).
        const element = record?.tab;
        const gBrowser = window.gBrowser;
        if (element && !tabAlreadyAsleep(element) && gBrowser) {
          const verdict = canUnload(element, ctx, { panelRecord: true, panelConsent: true });
          if (!verdict.allowed) {
            if (!reason) reason = String(verdict.reason || "policy-refused");
          } else {
            try {
              let result = true;
              if (typeof gBrowser.explicitUnloadTabs === "function")
                result = await gBrowser.explicitUnloadTabs([element]);
              else {
                await gBrowser.prepareDiscardBrowser?.(element);
                result = gBrowser.discardBrowser?.(element, true);
              }
              // G8: a `false` answer is a beforeunload refusal, not a command to force-close. A pending row may still
              // have held a live panel browser, so the caller can report the panel part without counting this tab.
              if (result === false && !tabAlreadyAsleep(element)) {
                if (!reason) reason = "refused";
              } else {
                tab = true;
              }
            } catch (_) {
              if (!reason) reason = "unload-failed";
            }
          }
        }
        const how = panel && tab ? "both" : panel ? "panel" : tab ? "tab" : "none";
        if (!panel && !tab && !reason) reason = "already-asleep";
        return { slept: panel || tab, how, reason, panelWas, tabWas };
      }

      /* R1: ONE recorder for whatever sleepPanelRecord actually freed. A record whose page lived only in its TAB
       * is a TAB (snapshot tab entry, `unloaded.tabs`), never a panel: the old code counted every slept record as
       * a panel, which is why Restore created Zentral panels for pages that were ordinary loaded tabs. The panel
       * entry keeps `wasLoaded` for old readers only; `holders` is what the restore engine decides with. */
      function recordPanelSleepHolders(record, appId, slept, mode, extra = {}) {
        const when = Date.now();
        const holders = {
          panel: slept?.how === "panel" || slept?.how === "both",
          tab: slept?.how === "tab" || slept?.how === "both",
        };
        const counts = { panels: 0, tabs: 0 };
        if (holders.panel) {
          counts.panels = 1;
          rememberUndone("panels", { appId, title: String(record?.app?.name || ""), when, ...extra });
          rememberSessionPanel({
            appId,
            recordRef: record,
            wasLoaded: Boolean(slept?.panelWas),
            holders,
            mode,
            when,
            ...extra,
          });
        }
        if (holders.tab && record?.tab) {
          counts.tabs = 1;
          const entry = {
            tab: record.tab,
            url: String(record.tab.linkedBrowser?.currentURI?.spec || ""),
            title: String(record.tab.label || ""),
            lastAccessed: Number(record.tab.lastAccessed) || 0,
            wasPinned: Boolean(record.tab.pinned || record.tab.hasAttribute?.("zen-essential")),
            recordAppId: appId,
            when,
            ...extra,
          };
          rememberUndone("tabs", entry);
          rememberSessionTab(entry);
        }
        return counts;
      }

      // A deep run, in three steps that can each say no: tabs by the policy (oldest first), then panel records whose
      // mode allows sleep, then the wake-up list for Restore. The counts and the freed number are the result.
      let level2Busy = false;
      let cancelLevel2Wait = null;
      onCleanup(() => {
        cancelLevel2Wait?.();
        cancelLevel2Wait = null;
        level2Busy = false;
      });

      async function runLevel2(options = {}) {
        if (disposed) return null;
        // G8: Game Mode owns the unload pass. A manual Level 2 or a limiter batch reports its state instead of
        // starting a parallel sweep that would fight the plan-driven pass and double-write the undo snapshot.
        if (gameMode.on) return gameModeState();
        if (level2Busy) return null;
        if (!policy()) {
          warn("the tab policy is not loaded, so the deep pass is not offered in this build");
          return null;
        }
        const gBrowser = window.gBrowser;
        if (!gBrowser || !Array.isArray(gBrowser.tabs)) return null;
        if (options.allowTabs !== false && typeof gBrowser.explicitUnloadTabs !== "function" && typeof gBrowser.discardBrowser !== "function") {
          // A build that cannot put a tab to sleep gets the light pass and an honest zero, never a fake count.
          return runLevel1();
        }
        level2Busy = true;
        try {
          const beforeMB = memoryMB();
          if (beforeMB != null) lastSampleMB = beforeMB;
          // G3: the snapshot's before reading. Both numbers are on-demand reads, never a timer.
          gameSession.beforeMB = beforeMB;
          gameSession.processesBefore = processCount();
          // OW-121: every deep clean now includes the light clean first. This is the same shared minimize +
          // GC/CC action list Level 1 uses, without a second 3 s settle; the one after-reading below is the
          // honest combined result. The public deep action never skips it, and the result says which path ran.
          const lightBy = await lightClean();
          if (disposed) return null;
          const ctx = {
            // OW-112: read the consent once for the whole run, not once per tab.
            keepPinned: mayUnloadPinned(),
            videoSourceTab: videoSourceTab(),
            selectedTab: gBrowser.selectedTab,
            sessionUrlFor: (tab) => {
              try {
                const liveSpec = tab?.linkedBrowser?.currentURI?.spec;
                if (liveSpec && liveSpec !== "about:blank") return String(liveSpec);
                const state = JSON.parse(window.SessionStore?.getTabState?.(tab) || "{}");
                const entries = Array.isArray(state.entries) ? state.entries : [];
                const index = entries.length ? Math.max(0, Math.min(entries.length - 1, (Number(state.index) || 1) - 1)) : -1;
                return index >= 0 ? String(entries[index]?.url || "") : "";
              } catch (_) {
                return "";
              }
            },
            isHostTab: (tab) => Boolean(tab?.hasAttribute?.("bgalazka-addon-host") || tab?.hasAttribute?.("bgalazka-addon-host-fallback")),
          };
          const unloaded = { tabs: 0, panels: 0 };
          const skipped = [];
          // OW-115: the old five/eight-entry sample stays bounded, but the popup needs ALL reasons grouped.
          const skippedCounts = {};
          const recordSkip = (reason, cap = 5) => {
            const key = String(reason || "unknown");
            skippedCounts[key] = (skippedCounts[key] || 0) + 1;
            if (skipped.length < cap) skipped.push(key);
          };
          // OW-111: the tabs behind Essential-panel records are read ONCE, before either loop. A record tab belongs
          // to its record's `backgroundMode`: the TAB loop must never decide for it (that was how a `live` WhatsApp
          // could be unloaded just because `unload_pinned` was on), and the PANEL loop may sleep it only with the
          // mode's consent even though the tab is pinned/Essential.
          const records = essentialRecords();
          const recordTabs = new Set(records.map((r) => r.tab).filter(Boolean));
          // Tabs: oldest `lastAccessed` first, so the tab nobody has looked at for hours goes before the one from a
          // minute ago. Selection never moves: a tab that would need a successor is not unloaded by a deep run.
          if (options.allowTabs !== false) {
            const candidates = [...gBrowser.tabs].sort(policy().byOldestFirst);
            // A limiter run takes one batch at a time and re-reads memory after it; a manual deep pass takes all of
            // them. `batch` is the only difference, so both go through the same policy.
            const limit = Number(options.batch) > 0 ? Number(options.batch) : Infinity;
            for (const tab of candidates) {
              if (disposed || unloaded.tabs >= limit) break;
              // G4: Boost's parking tab is never unloaded, and the tab being parked by G4 belongs to the parking
              // path only. Without this guard a deep pass racing the deferred selection could unload it twice.
              if (isBoostParkingTab(tab) || tab === parking.pendingOriginal ||
                  tab === gameSession.originalSelected) continue;
              // A record tab is owned ONLY by the panel loop below; the policy says so with its own named reason,
              // so a live record stays loaded whatever the `unload_pinned` pref says.
              const verdict = canUnload(tab, ctx, { panelRecord: recordTabs.has(tab) });
              if (!verdict.allowed) {
                if (verdict.reason !== "selected" && verdict.reason !== "panel-record") recordSkip(verdict.reason, 5);
                continue;
              }
              try {
                if (typeof gBrowser.explicitUnloadTabs === "function") await gBrowser.explicitUnloadTabs([tab]);
                else {
                  await gBrowser.prepareDiscardBrowser?.(tab);
                  gBrowser.discardBrowser?.(tab, true);
                }
                if (disposed) return null;
                unloaded.tabs += 1;
                // G3: keep the REAL element. An unloaded tab stays in the strip as a pending row; storing `null`
                // here was why Restore could only count tabs and never wake them.
                const entry = {
                  tab,
                  url: String(tab.linkedBrowser?.currentURI?.spec || ""),
                  title: String(tab.label || ""),
                  lastAccessed: Number(tab.lastAccessed) || 0,
                  wasPinned: Boolean(tab.pinned || tab.hasAttribute?.("zen-essential")),
                  when: Date.now(),
                };
                rememberUndone("tabs", entry);
                rememberSessionTab(entry);
              } catch (_) {
                recordSkip("unload-failed", 5);
              }
            }
          }
          // Panels: only records the person marked `asleep-allowed`. `live` and `throttled` stay exactly as they are —
          // the mode is theirs, and this pass does not read it as advice.
          if (!disposed && options.allowPanels !== false) {
            // OUTSIDE Game Mode, `stronger_saver` is the explicit consent that opens every record mode to Level 2.
            // A plain deep pass (and the limiter) still sleeps only `asleep-allowed` records. Game Mode has its own
            // G8 plan-driven pass and never calls this loop, so the two unload paths cannot fight each other.
            const modes = Array.isArray(options.allowModes) ? options.allowModes :
              (prefBool(PREF.STRONGER_SAVER, false) ? [...BACKGROUND_MODES] : ["asleep-allowed"]);
            for (const record of records) {
              if (disposed) break;
              if (!modes.includes(modeOf(record))) continue;
              // OW-111: consent comes from THIS record's mode (or Stronger saver's all-modes switch), not from
              // `unload_pinned`. It waives only the pinned/Essential rule; audible/selected/PiP/etc. still win.
              // G1: the one helper frees BOTH holders. The policy verdict is asked inside it for the tab part;
              // the panel-browser part uses the three named exceptions because a pending tab can still hold a
              // live panel. Every deep-pass caller (manual Level 2, limiter batches, Stronger saver, and later
              // Game Mode) goes through this door, so sleep and wake cannot drift apart again.
              const appId = record.app?.id || record.appId;
              const slept = await sleepPanelRecord(record, ctx);
              if (disposed) return null;
              if (!slept.slept) {
                recordSkip("panel:" + (slept.reason || "not-slept"), 8);
                continue;
              }
              // R1: the recorder counts what was freed. A tab-only record is a tab here too, so a later Restore
              // reloads the tab instead of inventing a panel.
              const counts = recordPanelSleepHolders(record, appId, slept, modeOf(record));
              unloaded.panels += counts.panels;
              unloaded.tabs += counts.tabs;
            }
          }
          if (disposed) return null;
          // Gecko frees after the sleep, not during it: the same 3 s settle as Level 1, for the same reason.
          const afterMB = await new Promise((resolve) => {
            let done = false;
            let t1 = 0;
            let t2 = 0;
            const settle = (value) => {
              if (done) return;
              done = true;
              cancelLevel2Wait = null;
              clearTimer(t1);
              clearTimer(t2);
              resolve(value);
            };
            cancelLevel2Wait = () => settle(undefined);
            t1 = setTimer(() => {
              t1 = 0;
              if (disposed) {
                settle(undefined);
                return;
              }
              runGcCc();
              t2 = setTimer(() => {
                t2 = 0;
                settle(disposed ? undefined : memoryMB());
              }, LEVEL1_SETTLE_MS);
            }, LEVEL1_SETTLE_MS);
          });
          if (disposed || afterMB === undefined) return null;
          const freedMB = beforeMB != null && afterMB != null ? Math.max(0, beforeMB - afterMB) : null;
          if (afterMB != null) {
            lastSampleMB = afterMB;
            emit(afterMB);
          }
          // G3: the snapshot's after reading, for G7's "freed X MB" report.
          gameSession.afterMB = afterMB;
          gameSession.processesAfter = processCount();
          lastSkipped = { ...skippedCounts };
          return {
            beforeMB, afterMB, freedMB, by: "level2", unloaded, skipped,
            skippedCounts: { ...skippedCounts }, undoSize: undoSize(),
            light: { by: lightBy },
          };
        } finally {
          cancelLevel2Wait = null;
          level2Busy = false;
        }
      }

      // Restore: wakes what a deep run put to sleep. Panel records wake immediately (that is the promise Restore makes),
      // tabs are listed — waking them all at once would undo the run and cost the memory back in one go.
      function restore() {
        // G5: the old Restore is now the engine's panels-only, immediate profile. Panels wake NOW, the parking
        // hand-back still happens from a deferred task, and tabs are reported for the browser to load on click.
        // All of the snapshot/undo clearing lives in restoreSession(), never in a second path.
        const result = restoreSession({ profile: "panels", immediate: true });
        return { panels: result.panels, tabs: result.tabs };
      }

      // The panel tile's menu reads and writes one record's mode through the panel module's own store, so a mode set
      // here is the mode everyone else sees. `saveEssentialSettings` is the documented writer.
      function setBackgroundMode(appId, mode) {
        if (!BACKGROUND_MODES.includes(mode)) return null;
        const record = essentialRecords().find((r) => (r.app?.id || r.appId) === appId);
        if (!record) return null;
        record.backgroundMode = mode;
        try {
          panels()?.saveEssentialSettings?.(record);
        } catch (_) {
          return null;
        }
        return { appId, mode };
      }

      // ---- B4.6: the one shortcut, following the app-shortcut module's own parser ----
      const isMac = () => {
        try {
          return Services.appinfo.OS === "Darwin";
        } catch (_) {
          return false;
        }
      };
      const KEY_ALIASES = { esc: "Escape", escape: "Escape", space: "Space", enter: "Enter", tab: "Tab", delete: "Delete" };
      const normalizeKey = (rawKey, code = "") => {
        const c = String(code || "");
        if (/^Key([A-Z])$/.test(c)) return c.slice(3);
        if (/^Digit([0-9])$/.test(c)) return c.slice(5);
        if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(c)) return c.toUpperCase();
        const k = String(rawKey || "");
        if (/^[a-zA-Z]$/.test(k)) return k.toUpperCase();
        if (/^[0-9]$/.test(k)) return k;
        if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(k)) return k.toUpperCase();
        return KEY_ALIASES[k.toLowerCase()] || "";
      };
      // "Accel+Shift+B" -> a spec. The same token set the app shortcuts accept, minus the ones a single-key shortcut
      // would need: a boost shortcut must combine at least two keys, so it can never swallow ordinary typing.
      function parseShortcut(text) {
        if (!text || typeof text !== "string") return null;
        const spec = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
        for (const token of String(text).split("+").map((t) => t.trim()).filter(Boolean)) {
          const lower = token.toLowerCase();
          if (lower === "ctrl" || lower === "control") spec.ctrl = true;
          else if (lower === "alt" || lower === "option" || lower === "opt") spec.alt = true;
          else if (lower === "shift") spec.shift = true;
          else if (["meta", "cmd", "command", "super", "os"].includes(lower)) spec.meta = true;
          else if (["accel", "mod", "primary"].includes(lower)) {
            if (isMac()) spec.meta = true;
            else spec.ctrl = true;
          } else {
            const key = normalizeKey(token);
            if (!key || spec.key) return null;
            spec.key = key;
          }
        }
        if (!spec.key) return null;
        const count = (spec.ctrl ? 1 : 0) + (spec.alt ? 1 : 0) + (spec.shift ? 1 : 0) + (spec.meta ? 1 : 0) + 1;
        return count >= 2 ? spec : null;
      }
      function matchesShortcut(event, spec) {
        if (!event || !spec?.key) return false;
        if (!!event.ctrlKey !== spec.ctrl || !!event.altKey !== spec.alt) return false;
        if (!!event.shiftKey !== spec.shift || !!event.metaKey !== spec.meta) return false;
        return normalizeKey(event.key, event.code) === spec.key;
      }
      let shortcutSpec = null;
      let shortcutObserver = null;
      function readShortcut() {
        shortcutSpec = parseShortcut(prefString(PREF.SHORTCUT, ""));
      }
      function installShortcut() {
        readShortcut();
        // One listener for the whole window, registered with the module's cleanups. It runs the light pass only: the
        // deep pass closes nothing on a keystroke.
        const onKey = (event) => {
          if (!shortcutSpec || !matchesShortcut(event, shortcutSpec)) return;
          if (event.repeat) return;
          event.preventDefault?.();
          event.stopPropagation?.();
          void runLevel1();
        };
        window.addEventListener("keydown", onKey, true);
        onCleanup(() => {
          window.removeEventListener("keydown", onKey, true);
        });
        // A pref change re-reads the combination without a restart, like every other Boost setting.
        try {
          shortcutObserver = {
            observe(_subject, _topic, data) {
              if (!data || data === PREF.SHORTCUT) readShortcut();
            },
          };
          Services.prefs.addObserver(PREF.SHORTCUT, shortcutObserver);
          onCleanup(() => {
            try {
              Services.prefs.removeObserver(PREF.SHORTCUT, shortcutObserver);
            } catch (_) {}
            shortcutObserver = null;
          });
        } catch (_) {}
      }

      /* ---------------- B5/OW-92: the RAM limiter ---------------- */

      // Every decision is made here, as a pure function of the numbers, so the state machine can be proven without a
      // browser: hysteresis (the hot cadence starts at 70 % of the limit and the slow one returns below the target),
      // the cooldown, and the "nothing eligible" nag limit.
      //
      // @param {object} input
      //   - `totalMB`      the current reading, or null when the build cannot measure
      //   - `settings`     {enabled, limitMB, mode, cooldownS, targetPct}
      //   - `lastRunAt`    when the limiter last acted (0 = never)
      //   - `lastNagAt`    when it last said "nothing to do"
      //   - `now`
      // @returns {{action, cadenceMs, reason, targetMB}}
      function decideLimiter(input = {}) {
        const settings = {
          enabled: input.settings?.enabled !== false,
          limitMB: Number(input.settings?.limitMB) > 0 ? Number(input.settings.limitMB) : DEFAULT_LIMIT.mb,
          mode: input.settings?.mode === "hard" ? "hard" : "soft",
          cooldownS: Number.isFinite(Number(input.settings?.cooldownS)) ? Math.max(0, Number(input.settings.cooldownS)) : DEFAULT_LIMIT.cooldownS,
          targetPct: Number(input.settings?.targetPct) > 0 ? Math.min(100, Number(input.settings.targetPct)) : DEFAULT_LIMIT.targetPct,
        };
        const cadenceIdle = settings.targetPct ? LIMIT_IDLE_MS : LIMIT_IDLE_MS;
        const decide = (action, cadenceMs, reason) => ({
          action, cadenceMs, reason, targetMB: Math.round((settings.limitMB * settings.targetPct) / 100),
        });
        if (!settings.enabled) return decide("none", LIMIT_IDLE_MS, "off");
        const total = Number(input.totalMB);
        if (!Number.isFinite(total) || total <= 0) return decide("none", LIMIT_IDLE_MS, "no-reading");
        // Below the limit: a slow check, and specifically below the target so the two cadences do not oscillate.
        if (total <= settings.limitMB) return decide("none", total > settings.limitMB * LIMIT_HOT_SHARE ? LIMIT_HOT_MS : LIMIT_IDLE_MS, "under-limit");
        // Over the limit. The cooldown is a hard "do not act again yet", whatever the mode.
        const since = Number(input.now || 0) - Number(input.lastRunAt || 0);
        if (input.lastRunAt && since < settings.cooldownS * 1000) {
          return decide("none", Math.max(1000, settings.cooldownS * 1000 - since), "cooldown");
        }
        if (settings.mode === "soft") return decide("notify", LIMIT_HOT_MS, "soft");
        return decide("unload", LIMIT_HOT_MS, "hard");
      }

      // The nag rule, kept apart because it is about a person's attention rather than about memory: when a hard run
      // can do nothing, say it once per ten minutes, not every ten seconds.
      function shouldNag(lastNagAt, now) {
        if (!lastNagAt) return true;
        return Number(now) - Number(lastNagAt) >= LIMIT_NAG_MS;
      }

      const limiterSettings = () => ({
        enabled: prefBool(PREF.LIMIT_ENABLED, false),
        limitMB: prefInt(PREF.LIMIT_MB, DEFAULT_LIMIT.mb),
        mode: prefString(PREF.LIMIT_MODE, DEFAULT_LIMIT.mode),
        cooldownS: prefInt(PREF.LIMIT_COOLDOWN_S, DEFAULT_LIMIT.cooldownS),
        targetPct: prefInt(PREF.LIMIT_TARGET_PCT, DEFAULT_LIMIT.targetPct),
      });

      const limiter = {
        timer: 0,
        lastRunAt: 0,
        lastNagAt: 0,
        lastAction: "",
        lastReason: "",
        runs: 0,
        busy: false,
      };

      // One tick: read, decide, act, and arm exactly one more timer. The chain stops the moment the pref is off or the
      // feature is destroyed, so a limiter that is not asked for costs nothing.
      function limiterTick() {
        limiter.timer = 0;
        if (disposed) return;
        // G8: the limiter is idle while Game Mode owns the session; it re-arms on exit, never behind the game pass.
        if (gameMode.on) {
          limiter.lastAction = "none";
          limiter.lastReason = "game-mode";
          return;
        }
        const settings = limiterSettings();
        if (!settings.enabled) {
          limiter.lastAction = "none";
          limiter.lastReason = "off";
          return;
        }
        const totalMB = memoryMB();
        const decision = decideLimiter({
          totalMB,
          settings,
          lastRunAt: limiter.lastRunAt,
          now: Date.now(),
        });
        limiter.lastAction = decision.action;
        limiter.lastReason = decision.reason;
        if (decision.action === "notify") {
          limiter.lastRunAt = Date.now();
          limiter.runs += 1;
          for (const listener of limiterListeners) {
            try {
              listener({ kind: "limit", action: "notify", totalMB, limitMB: settings.limitMB, targetMB: decision.targetMB });
            } catch (_) {}
          }
        } else if (decision.action === "unload" && !limiter.busy) {
          limiter.lastRunAt = Date.now();
          limiter.runs += 1;
          void limiterRunHard(settings, decision, totalMB);
        }
        armLimiter(decision.cadenceMs);
      }

      // A hard run in batches: three tabs, re-read, stop at the target or when nothing is left. `runLevel2` already
      // does the policy work; this only decides when to stop, which is the part that makes a hard mode safe.
      async function limiterRunHard(settings, decision, totalMB) {
        if (limiter.busy) return;
        limiter.busy = true;
        try {
          let current = totalMB;
          let rounds = 0;
          let unloaded = { tabs: 0, panels: 0 };
          // A hard run is a deep pass repeated until the number is where the person wants it, with a bounded number of
          // rounds so a page that refuses to sleep cannot make this loop forever.
          while (!disposed && !gameMode.on && limiterSettings().enabled && rounds < 12 && current > decision.targetMB) {
            rounds += 1;
            const result = await runLevel2({ batch: LIMIT_BATCH });
            if (!result || result.by !== "level2") break;
            unloaded.tabs += result.unloaded?.tabs || 0;
            unloaded.panels += result.unloaded?.panels || 0;
            const after = Number(result.afterMB);
            if (!Number.isFinite(after) || after >= current) break; // nothing changed: stop rather than spin
            current = after;
            if (!(result.unloaded?.tabs || result.unloaded?.panels)) break;
          }
          if (disposed || gameMode.on || !limiterSettings().enabled) return;
          for (const listener of limiterListeners) {
            try {
              listener({ kind: "limit", action: "hard-done", totalMB: current, unloaded, runs: rounds });
            } catch (_) {}
          }
          // Still above the limit with nothing eligible: one quiet line per ten minutes, never a loop of them.
          if (current > decision.targetMB && !unloaded.tabs && !unloaded.panels && shouldNag(limiter.lastNagAt, Date.now())) {
            limiter.lastNagAt = Date.now();
            for (const listener of limiterListeners) {
              try {
                listener({ kind: "limit", action: "nothing-eligible", totalMB: current, limitMB: settings.limitMB });
              } catch (_) {}
            }
          }
        } finally {
          limiter.busy = false;
        }
      }

      function armLimiter(ms) {
        clearTimer(limiter.timer);
        limiter.timer = 0;
        if (disposed || gameMode.on) return;
        if (!limiterSettings().enabled) return;
        limiter.timer = setTimer(limiterTick, Math.max(1000, Number(ms) || LIMIT_IDLE_MS));
      }

      // G8: turning the game on clears the limiter's one-shot timer and records why. Exit calls armLimiter()
      // again, so an enabled limiter resumes its normal cadence without a second pass during the game.
      function stopLimiterForGameMode() {
        clearTimer(limiter.timer);
        limiter.timer = 0;
        limiter.lastAction = "none";
        limiter.lastReason = "game-mode";
      }

      const limiterListeners = new Set();
      function onLimiterEvent(cb) {
        if (typeof cb !== "function") return () => {};
        limiterListeners.add(cb);
        return () => limiterListeners.delete(cb);
      }

      // Live settings: switching the limiter on starts the chain, switching it off stops it, and a changed number
      // re-reads itself on the next tick (no restart, and no extra work now).
      function installLimiter() {
        armLimiter(LIMIT_IDLE_MS);
        const observers = [];
        for (const key of [PREF.LIMIT_ENABLED, PREF.LIMIT_MB, PREF.LIMIT_MODE, PREF.LIMIT_COOLDOWN_S, PREF.LIMIT_TARGET_PCT]) {
          const observer = {
            observe(_subject, _topic, data) {
              if (!data || data === key) armLimiter(LIMIT_IDLE_MS);
            },
          };
          try {
            Services.prefs.addObserver(key, observer);
            observers.push([key, observer]);
          } catch (_) {}
        }
        onCleanup(() => {
          for (const [key, observer] of observers) {
            try {
              Services.prefs.removeObserver(key, observer);
            } catch (_) {}
          }
        });
        onCleanup(() => {
          clearTimer(limiter.timer);
          limiter.timer = 0;
          limiterListeners.clear();
        });
      }

      /* ---------------- B7/OW-94: Game Mode, the Level 3 toggle ---------------- */

      // The plan's shape: Level 2 + pause every timer + deactivate every kept browser except the exempt ones. The
      // decision is a pure function so the rule can be read and tested on its own; the acting part can then only do
      // what that function said.
      const performanceSwitch = () => window.ZentralRuntime?.performance || null;

      // Which of these may be deactivated. `exempt` is the podcast (an audible tab) and the video preview's source tab:
      // the plan's own exception list, and the owner gate is exactly that a podcast keeps playing.
      //
      // A target is `{ id, exempt, kind }`. `kept` carries the reason, so a live check can say why a tab survived.
      function decideGameMode({ targets = [] } = {}) {
        const act = [];
        const kept = [];
        for (const target of targets) {
          if (!target || target.id == null) continue;
          if (target.exempt) kept.push({ id: target.id, reason: target.why || "exempt" });
          else act.push({ id: target.id, kind: target.kind || "tab" });
        }
        return { act, kept };
      }

      // Is this tab exempt from Game Mode? Two facts, both from the shared policy so there is one definition of
      // "audible" in the whole project.
      function gameModeExemptReason(tab, videoSource) {
        const table = policy();
        if (table?.isAudible?.(tab)) return "audible";
        if (videoSource && tab === videoSource) return "video-source";
        if (tab === window.gBrowser?.selectedTab) return "selected";
        return "";
      }

      // Everything Game Mode may touch: the browsers of open tabs (never the selected one) and ONLY already-loaded panel
      // browsers. Never call `getOrCreateAppBrowser` here: creating browsers for unloaded apps would spin up and load
      // every Zentra/Essential app on demand when turning Game Mode on.
      function gameModeTargets() {
        const bodies = [];
        const seen = new Set();
        const videoSource = videoSourceTab();
        const gBrowser = window.gBrowser;
        try {
          for (const tab of gBrowser?.tabs || []) {
            const browser = tab?.linkedBrowser;
            if (!browser || !tab.isConnected || isBoostParkingTab(tab) || seen.has(browser)) continue;
            seen.add(browser);
            const why = gameModeExemptReason(tab, videoSource);
            bodies.push({ id: browser, kind: "tab", exempt: Boolean(why), why });
          }
        } catch (_) {}
        try {
          const panelCtx = panels();
          const apps = window.Zentral?.Apps;
          const recordsByAppId = new Map();
          for (const record of essentialRecords()) {
            const appId = record?.app?.id || record?.appId;
            if (appId) recordsByAppId.set(appId, record);
          }
          const addPanelBrowser = (browser, record) => {
            if (!browser?.isConnected || seen.has(browser)) return;
            seen.add(browser);
            let why = record?.tab ? gameModeExemptReason(record.tab, videoSource) : "";
            if (!why && browser.audioPlaying) why = "audible";
            if (!why && videoSource && browser === videoSource.linkedBrowser) why = "video-source";
            bodies.push({ id: browser, kind: "panel", exempt: Boolean(why), why: why || "panel" });
          };
          const liveBrowsers =
            typeof panelCtx?.getAllAppBrowsers === "function" ? panelCtx.getAllAppBrowsers() : [];
          for (const browser of liveBrowsers || []) {
            const appId = browser?._bgalazkaAppId;
            addPanelBrowser(browser, appId ? recordsByAppId.get(appId) : null);
          }
          for (const record of recordsByAppId.values()) {
            const appId = record?.app?.id || record?.appId;
            const browser =
              (typeof apps?.getAppBrowser === "function" ? apps.getAppBrowser(appId) : null) ||
              apps?.appBrowsers?.get?.(appId) ||
              record?.tab?.linkedBrowser ||
              null;
            addPanelBrowser(browser, record);
          }
        } catch (_) {}
        return bodies;
      }

      // The state Game Mode owns. `saved` is everything it changed, so switching it off puts the session back instead of
      // guessing; `woke` is what a Stronger-saver pass put to sleep, so Restore can bring it back.
      const gameMode = {
        on: false, saved: new Map(), woke: [], pausedBy: false, run: 0,
        lastActed: 0, lastResult: null, lastPlan: null,
        // G8: the final memory report and the one-shot cleanup chain belong to the current Game Mode run only.
        beforeMB: null, afterMB: null, finalMB: null, freedMB: null, finalFreedMB: null,
        processesBefore: 0, processesAfter: 0,
        lastUnloaded: { tabs: 0, panels: 0 }, lastKept: [],
        firstCleanBy: "", secondCleanBy: "", lateCleanBy: "",
      };
      const gameModeWork = {
        active: false,
        generation: 0,
        reason: "",
        settleTimer: 0,
        lateTimer: 0,
        firstClean: 0,
        secondClean: 0,
        lateClean: 0,
      };
      const gameModeWorkValid = (generation) =>
        !disposed && gameMode.on && gameModeWork.active && generation === gameModeWork.generation;
      function cancelGameModeWork(reason) {
        gameModeWork.generation += 1;
        gameModeWork.active = false;
        gameModeWork.reason = String(reason || "cancelled");
        clearTimer(gameModeWork.settleTimer);
        clearTimer(gameModeWork.lateTimer);
        gameModeWork.settleTimer = 0;
        gameModeWork.lateTimer = 0;
        parking.parkHook = null;
      }

      function rememberBrowser(browser) {
        if (!browser || gameMode.saved.has(browser)) return;
        try {
          const state = {
            docShellIsActive: browser.docShellIsActive,
            renderLayers: browser.renderLayers,
          };
          gameMode.saved.set(browser, state);
          // G3: the same activity record belongs to the session snapshot, so Restore/G7 can report what changed.
          if (!gameSession.activity.has(browser)) gameSession.activity.set(browser, { ...state });
          touchSession();
        } catch (_) {}
      }

      // One pass over the live session. Returns what it did, for `gameModeState()` and for a test.
      function deactivateForGameMode(targets) {
        const decision = decideGameMode({ targets });
        let acted = 0;
        for (const entry of decision.act) {
          const browser = entry.id;
          try {
            rememberBrowser(browser);
            if (browser.docShellIsActive !== false) browser.docShellIsActive = false;
            if (browser.isRemoteBrowser && browser.renderLayers !== false) browser.renderLayers = false;
            acted += 1;
          } catch (_) {}
        }
        gameMode.lastActed = acted;
        return { acted, kept: decision.kept };
      }

      /* G8: ONE plan-driven Game Mode pass. G2 decides what may sleep, G4 parks the selected tab through its deferred
       * door, G1's sleepPanelRecord closes both holders of a panel record, and G3 remembers every real tab/panel for
       * the one Restore action. Nothing here calls runLevel2(): a second generic sweep would ignore Game Mode consent
       * for `live` records and write duplicate undo entries. */
      const gameModeLabel = (value) => {
        if (value == null) return "unknown";
        if (typeof value === "string" || typeof value === "number") return String(value);
        return String(value.label || value.app?.name || value.app?.id || value.appId ||
          value._bgalazkaAppId || value.currentURI?.spec || "browser");
      };
      function gameModeUnloadContext() {
        const gBrowser = window.gBrowser;
        return {
          // Game Mode consent: pinned/Essential tabs and every panel record mode may sleep. The policy's NEVER rules
          // (audible, video source, PiP, sharing, private, add-on host, placeholders and refusals) still win.
          keepPinned: true,
          videoSourceTab: videoSourceTab(),
          selectedTab: gBrowser?.selectedTab || null,
          sessionUrlFor: (tab) => {
            try {
              const liveSpec = tab?.linkedBrowser?.currentURI?.spec;
              if (liveSpec && liveSpec !== "about:blank") return String(liveSpec);
              const state = JSON.parse(window.SessionStore?.getTabState?.(tab) || "{}");
              const entries = Array.isArray(state.entries) ? state.entries : [];
              const index = entries.length ? Math.max(0, Math.min(entries.length - 1, (Number(state.index) || 1) - 1)) : -1;
              return index >= 0 ? String(entries[index]?.url || "") : "";
            } catch (_) {
              return "";
            }
          },
          isHostTab: (tab) => Boolean(tab?.hasAttribute?.("bgalazka-addon-host") || tab?.hasAttribute?.("bgalazka-addon-host-fallback")),
          isPrivate: isPrivateTab,
        };
      }
      function startGameModePass(plan, parked) {
        const generation = ++gameModeWork.generation;
        gameModeWork.active = true;
        gameModeWork.reason = "running";
        gameModeWork.firstClean = 0;
        gameModeWork.secondClean = 0;
        gameModeWork.lateClean = 0;
        const run = () => { void runGameModePass(plan, generation).catch(() => {}); };
        // G4's selection/unload is deferred. The hook runs after that one door finishes (or rolls back), so the pass
        // sees the parking tab as selected and never skips a panel record merely because it used to be selected.
        if (parked?.created) parking.parkHook = run;
        else run();
      }
      async function runGameModePass(plan, generation) {
        if (!gameModeWorkValid(generation)) return;
        const gBrowser = window.gBrowser;
        if (!gBrowser || !Array.isArray(gBrowser.tabs)) return;
        const beforeMB = memoryMB();
        const processesBefore = processCount();
        gameSession.beforeMB = beforeMB;
        gameSession.processesBefore = processesBefore;
        gameMode.beforeMB = beforeMB;
        gameMode.processesBefore = processesBefore;
        gameMode.afterMB = null;
        gameMode.finalMB = null;
        gameMode.freedMB = null;
        gameMode.finalFreedMB = null;
        gameMode.processesAfter = 0;
        gameMode.firstCleanBy = "";
        gameMode.secondCleanBy = "";
        gameMode.lateCleanBy = "";
        // G8: the pass starts with the same shared light-clean action list Level 2 used to run. It does not call
        // runLevel2() itself: the pass owns the unload plan, the settle and BOTH later cleans.
        gameModeWork.firstClean += 1;
        const firstBy = await lightClean();
        if (!gameModeWorkValid(generation)) return;
        gameMode.firstCleanBy = String(firstBy || "");
        const ctx = gameModeUnloadContext();
        const unloaded = { tabs: 0, panels: 0 };
        const kept = Array.isArray(gameMode.lastKept) ? gameMode.lastKept.slice() : [];
        const addKept = (kind, id, reason) => {
          kept.push({ id: gameModeLabel(id), kind, reason: String(reason || "kept") });
          while (kept.length > SESSION_CAP) kept.shift();
        };
        const recordTabs = new Set(essentialRecords().map((record) => record?.tab).filter(Boolean));
        const skipTabs = new Set([
          parking.pendingTab, parking.pendingOriginal, gameSession.parkingTab, gameSession.originalSelected,
        ].filter(Boolean));
        const parkingSelected = isBoostParkingTab(gBrowser.selectedTab);
        const selectedWithoutParking = (tab) => Boolean(tab && !parkingSelected && tab === gBrowser.selectedTab);
        if (!parkingSelected && gBrowser.selectedTab) skipTabs.add(gBrowser.selectedTab);
        const keepHosts = gameKeepHosts();
        const hostMatch = (tab) => {
          const host = String(hostOfTab(tab) || "").toLowerCase();
          return Boolean(host) && keepHosts.some((h) => host === h || host.endsWith("." + h));
        };
        // G4's deferred door owns the selected original. It already wrote the real tab into the G3 snapshot; count
        // that exact tab once here so the final report includes the full Game Mode pass, without unloading it twice.
        const parkedOriginal = gameSession.originalSelected;
        if (parkedOriginal && gameSession.tabs.some((entry) => entry?.tab === parkedOriginal)) unloaded.tabs += 1;
        // Ordinary tabs: the G2 plan already filtered exemptions, but live state can change between preview and the
        // deferred parking door. Re-read the policy and treat explicitUnloadTabs(false) as a refusal, never a close.
        for (const tab of (Array.isArray(plan?.sleepTabs) ? plan.sleepTabs : [])) {
          if (!gameModeWorkValid(generation)) return;
          if (!tab || isBoostParkingTab(tab) || skipTabs.has(tab) || recordTabs.has(tab)) continue;
          if (selectedWithoutParking(tab)) { addKept("tab", tab, "selected"); continue; }
          if (hostMatch(tab)) { addKept("tab", tab, "keep-host"); continue; }
          const verdict = canUnload(tab, ctx, { panelRecord: false });
          if (!verdict.allowed) {
            addKept("tab", tab, verdict.reason);
            continue;
          }
          try {
            let result = true;
            if (typeof gBrowser.explicitUnloadTabs === "function")
              result = await gBrowser.explicitUnloadTabs([tab]);
            else if (typeof gBrowser.discardBrowser === "function") {
              await gBrowser.prepareDiscardBrowser?.(tab);
              result = gBrowser.discardBrowser(tab, true);
            } else {
              addKept("tab", tab, "no-unload-api");
              continue;
            }
            if (!gameModeWorkValid(generation)) return;
            if (result === false && !tabAlreadyAsleep(tab)) {
              addKept("tab", tab, "refused");
              continue;
            }
            unloaded.tabs += 1;
            const entry = {
              tab,
              url: String(tab.linkedBrowser?.currentURI?.spec || ""),
              title: String(tab.label || ""),
              lastAccessed: Number(tab.lastAccessed) || 0,
              wasPinned: Boolean(tab.pinned || tab.hasAttribute?.("zen-essential")),
              gameMode: true,
              when: Date.now(),
            };
            rememberUndone("tabs", entry);
            rememberSessionTab(entry);
          } catch (_) {
            addKept("tab", tab, "unload-failed");
          }
        }
        // Panel records: every mode is in the G2 plan because Game Mode is the consent. sleepPanelRecord closes the
        // app browser and, when still loaded, unloads the record tab through the same policy door used by G1.
        for (const record of (Array.isArray(plan?.sleepPanels) ? plan.sleepPanels : [])) {
          if (!gameModeWorkValid(generation)) return;
          if (!record) continue;
          if (isBoostParkingTab(record.tab)) { addKept("panel", record, "parking-tab"); continue; }
          if (selectedWithoutParking(record?.tab)) { addKept("panel", record, "selected"); continue; }
          if (hostMatch(record?.tab)) { addKept("panel", record, "keep-host"); continue; }
          const appId = record.app?.id || record.appId;
          const slept = await sleepPanelRecord(record, ctx);
          if (!gameModeWorkValid(generation)) return;
          if (!slept.slept) {
            addKept("panel", appId || record, slept.reason || "not-slept");
            continue;
          }
          if (slept.reason) addKept("panel", appId || record, slept.reason);
          // R1: holders decide the counts and the snapshot lists. `how === "tab"` is a tab, not an app.
          const counts = recordPanelSleepHolders(record, appId, slept, modeOf(record), { gameMode: true });
          unloaded.panels += counts.panels;
          unloaded.tabs += counts.tabs;
          if (counts.panels) gameMode.woke.push("panel");
          if (counts.tabs) gameMode.woke.push("tab");
        }
        if (!gameModeWorkValid(generation)) return;
        gameMode.lastUnloaded = { ...unloaded };
        gameMode.lastKept = kept.slice();
        gameMode.lastResult = { ...gameModeState(), unloaded: { ...unloaded } };
        // Existing 3 s settle, then the SECOND lightClean(). One 30 s one-shot timer follows for late process frees.
        gameModeWork.reason = "settling";
        gameModeWork.settleTimer = setTimer(async () => {
          gameModeWork.settleTimer = 0;
          if (!gameModeWorkValid(generation)) return;
          gameModeWork.secondClean += 1;
          const by = await lightClean();
          if (!gameModeWorkValid(generation)) return;
          const afterMB = memoryMB();
          if (afterMB != null) {
            lastSampleMB = afterMB;
            emit(afterMB);
          }
          gameMode.afterMB = afterMB;
          gameMode.finalMB = afterMB;
          gameMode.processesAfter = processCount();
          gameMode.secondCleanBy = String(by || "");
          const freed = beforeMB != null && afterMB != null ? Math.max(0, beforeMB - afterMB) : null;
          gameMode.freedMB = freed;
          gameMode.finalFreedMB = freed;
          gameSession.afterMB = afterMB;
          gameSession.processesAfter = gameMode.processesAfter;
          gameMode.lastResult = { ...gameModeState(), unloaded: { ...unloaded } };
          emitGameModeEvent({ kind: "game-mode", action: "on-settle", state: gameMode.lastResult });
          gameModeWork.reason = "late-clean-armed";
          gameModeWork.lateTimer = setTimer(async () => {
            gameModeWork.lateTimer = 0;
            if (!gameModeWorkValid(generation)) return;
            gameModeWork.lateClean += 1;
            const lateBy = await lightClean();
            if (!gameModeWorkValid(generation)) return;
            const finalMB = memoryMB();
            if (finalMB != null) {
              lastSampleMB = finalMB;
              emit(finalMB);
            }
            gameMode.finalMB = finalMB;
            gameMode.afterMB = finalMB;
            gameMode.lateCleanBy = String(lateBy || "");
            const finalFreed = beforeMB != null && finalMB != null ? Math.max(0, beforeMB - finalMB) : freed;
            gameMode.finalFreedMB = finalFreed;
            gameMode.freedMB = finalFreed;
            gameMode.processesAfter = processCount();
            gameSession.afterMB = finalMB;
            gameSession.processesAfter = gameMode.processesAfter;
            gameModeWork.active = false;
            gameModeWork.reason = "complete";
            gameMode.lastResult = { ...gameModeState(), unloaded: { ...unloaded } };
            emitGameModeEvent({ kind: "game-mode", action: "on-final", state: gameMode.lastResult });
          }, GAME_MODE_LATE_CLEAN_MS);
        }, LEVEL1_SETTLE_MS);
      }

      function restoreGameModeActivity() {
        let restored = 0;
        for (const [browser, state] of gameMode.saved) {
          try {
            if (!browser?.isConnected) continue;
            if (browser.docShellIsActive !== state.docShellIsActive) browser.docShellIsActive = state.docShellIsActive;
            if (browser.isRemoteBrowser && browser.renderLayers !== state.renderLayers)
              browser.renderLayers = state.renderLayers;
            restored += 1;
          } catch (_) {}
        }
        gameMode.saved.clear();
        return restored;
      }

      // B7.3: switching off unpauses, restores the SELECTED tab, and lets everything else reload lazily. Reactivating
      // every browser on the way out of a game would cost exactly the memory the mode was saving.
      function restoreSelectedTabActivity() {
        const gBrowser = window.gBrowser;
        // G4: while parked, `gBrowser.selectedTab` is Boost's about:blank tab; the person's original tab is the
        // one whose activity must be made live again. Without a parking tab this is exactly the old expression.
        const original = gameSession.originalSelected;
        const browser = original?.linkedBrowser || gBrowser?.selectedTab?.linkedBrowser || gBrowser?.selectedBrowser;
        if (!browser) return 0;
        try {
          if (browser.docShellIsActive !== true) browser.docShellIsActive = true;
          if (browser.isRemoteBrowser && browser.renderLayers !== true) browser.renderLayers = true;
          return 1;
        } catch (_) {
          return 0;
        }
      }

      function syncPanelActivity() {
        try {
          panels()?.syncAppPanelBrowserActivity?.();
        } catch (_) {}
      }

      // One writer. `setGameMode` sets the pref, and the pref observer is what actually runs the change, so a switch in
      // the widget and a checkbox in Settings do the identical thing and neither can drift from the other.
      function setGameMode(on) {
        const target = Boolean(on);
        if (prefBool(PREF.GAME_MODE, false) !== target) {
          try {
            Services.prefs.setBoolPref(PREF.GAME_MODE, target);
          } catch (_) {}
        }
        return applyGameMode(target);
      }

      function applyGameMode(on) {
        const target = Boolean(on);
        // G5: a (re)entry into Game Mode cancels any staggered Restore still in flight, so a restore chain can
        // never wake tabs behind a fresh Game Mode pass. This runs even when the switch was already on.
        if (target) cancelRestore("game-mode-on");
        // Already in that state: a second switch, the pref observer having just done the work, or a restart with the
        // pref set. The caller still wants to know what the last real pass did, so that is what it gets.
        if (target === gameMode.on) return gameMode.lastResult || gameModeState();
        if (target) {
          // G8: the game owns every cleanup timer. A fresh ON clears any stale chain, stops the limiter and marks the
          // one-shot startup trim skipped; none of those paths may run a parallel pass behind the game plan.
          cancelGameModeWork("new-game-mode");
          gameMode.on = true;
          gameMode.run += 1;
          gameMode.woke.length = 0;
          gameMode.lastUnloaded = { tabs: 0, panels: 0 };
          gameMode.lastResult = null;
          stopLimiterForGameMode();
          skipStartupTrimForGameMode();
          const switchApi = performanceSwitch();
          if (switchApi && !switchApi.isPaused()) {
            switchApi.setPaused(true);
            gameMode.pausedBy = true;
          }
          // G2/G4/G8: one dry run decides what may sleep and whether the selected tab is parked. `parkSelected`
          // creates ONE ephemeral tab now and defers the selection/unload. The G8 pass waits for that same door,
          // then unloads exactly the planned tabs and panel records through G1's sleepPanelRecord helper. No
          // runLevel2(), Stronger-saver chain or generic tab sweep runs while Game Mode is on.
          // Do NOT call `syncPanelActivity()` here on turn-on: `deactivateForGameMode` already idled background
          // panels, whereas `syncPanelActivity()` would reactivate preload `live` notification panels right back.
          const plan = previewGameMode();
          gameMode.lastPlan = plan;
          gameMode.lastKept = plan.keep.slice(0, SESSION_CAP).map((item) => ({
            id: gameModeLabel(item?.id), kind: String(item?.kind || "tab"),
            reason: String(item?.reason || "kept"),
          }));
          const parked = parkSelected(plan);
          startGameModePass(plan, parked);
          const activity = deactivateForGameMode(gameModeTargets());
          gameMode.lastResult = {
            ...gameModeState(), acted: activity.acted, kept: activity.kept.length,
            parked: parked.created, plannedKept: plan.keep.length,
          };
          emitGameModeEvent({ kind: "game-mode", action: "on", state: gameMode.lastResult, preview: plan.counts });
          return gameMode.lastResult;
        }
        gameMode.on = false;
        // G8: OFF cancels the settle/late one-shot timers and their generation. A callback already in flight checks
        // the same generation, so no clean or memory report can land after the game has ended.
        if (gameModeWork.active || gameModeWork.settleTimer || gameModeWork.lateTimer)
          cancelGameModeWork(gameModeWork.reason === "destroy" ? "destroy" : "game-mode-off");
        const restored = restoreGameModeActivity();
        const selected = restoreSelectedTabActivity();
        // G4: hand the selection back from the parking tab. This is deferred, so the pending original loads on
        // the next task; the parking tab is closed in that same task. G5's `always` profile adopts that timer as
        // the first step of the staggered Restore; `ask` (default) waits for G7's Restore action and `never`
        // leaves the snapshot for a manual Restore.
        unparkSelected();
        const exitPolicy = normalizeRestoreExit(prefString(PREF.GAME_RESTORE_ON_EXIT, "ask"));
        if (exitPolicy === "always") restoreSession();
        gameMode.woke.length = 0;
        const switchApi = performanceSwitch();
        if (gameMode.pausedBy && switchApi) {
          switchApi.setPaused(false);
          gameMode.pausedBy = false;
        }
        syncPanelActivity();
        // G8: an enabled limiter takes its normal one-shot cadence back on exit, never during the game.
        armLimiter();
        gameMode.lastResult = { ...gameModeState(), restored, selected };
        emitGameModeEvent({ kind: "game-mode", action: "off", state: gameMode.lastResult });
        return gameMode.lastResult;
      }

      function gameModeState() {
        // G7: the snapshot is read on demand from G3/G5's session state; no second measurement path.
        const session = sessionState();
        return {
          on: gameMode.on,
          paused: Boolean(performanceSwitch()?.isPaused?.()),
          stronger: prefBool(PREF.STRONGER_SAVER, false),
          saved: gameMode.saved.size,
          woke: gameMode.woke.length,
          acted: gameMode.lastActed,
          run: gameMode.run,
          parking: parkingState(),
          restoreOnExit: normalizeRestoreExit(prefString(PREF.GAME_RESTORE_ON_EXIT, "ask")),
          restoreProfile: normalizeRestoreProfile(prefString(PREF.GAME_RESTORE_TABS, "all")),
          restorePending: restoreWork.active,
          // G8: `freedMB` is the FINAL reading after the settle clean and the one-shot 30 s clean. It starts null
          // while the pass is still settling; the owner reads the same shape from the Browser Console.
          freedMB: gameMode.finalFreedMB,
          finalFreedMB: gameMode.finalFreedMB,
          beforeMB: gameMode.beforeMB,
          afterMB: gameMode.finalMB == null ? gameMode.afterMB : gameMode.finalMB,
          finalMB: gameMode.finalMB,
          processesBefore: gameMode.processesBefore,
          processesAfter: gameMode.processesAfter,
          unloaded: { ...gameMode.lastUnloaded },
          kept: gameMode.lastKept.slice(),
          snapshot: {
            panels: session.panels,
            tabs: session.restorableTabs,
            active: session.active,
            hasSelected: session.hasSelected,
            hasParking: session.hasParking,
          },
          cleanup: {
            active: gameModeWork.active,
            reason: gameModeWork.reason,
            firstClean: gameModeWork.firstClean,
            secondClean: gameModeWork.secondClean,
            lateClean: gameModeWork.lateClean,
            settleArmed: Boolean(gameModeWork.settleTimer),
            lateArmed: Boolean(gameModeWork.lateTimer),
            firstCleanBy: gameMode.firstCleanBy,
            secondCleanBy: gameMode.secondCleanBy,
            lateCleanBy: gameMode.lateCleanBy,
          },
        };
      }

      // G2: the dry run. Everything is read on demand when the widget/menu asks; nothing here writes a pref, unloads
      // a tab, starts a timer or samples RAM. The widget uses `counts` for "Will free about N tabs and M apps".
      function gameKeepHosts() {
        return prefString(PREF.GAME_KEEP_HOSTS, "")
          .split(",")
          .map((h) => h.trim().toLowerCase().replace(/^\*\./, ""))
          .filter(Boolean);
      }
      function previewGameMode() {
        const table = policy();
        const gBrowser = window.gBrowser;
        const plan = planGameMode({
          tabs: [...(gBrowser?.tabs || [])],
          panelRecords: essentialRecords(),
          selectedTab: gBrowser?.selectedTab || null,
          videoSourceTab: videoSourceTab(),
          keepHosts: gameKeepHosts(),
          parkSelected: prefBool(PREF.GAME_PARK_SELECTED, true),
          canPark: typeof gBrowser?.addTab === "function",
          isAudible: (t) => Boolean(table?.isAudible?.(t)),
          isUnloadable: (t, ctx) =>
            table?.isUnloadable?.(t, ctx) || { allowed: false, reason: "no-policy" },
          isPrivate: isPrivateTab,
          hostOf: hostOfTab,
        });
        return {
          ...plan,
          counts: { tabs: plan.sleepTabs.length, panels: plan.sleepPanels.length },
        };
      }

      // The pref is the switch, so Settings and the widget write the same thing and only one path acts on it.
      function installGameMode() {
        if (prefBool(PREF.GAME_MODE, false)) applyGameMode(true);
        const observer = {
          observe(_subject, _topic, data) {
            if (data && data !== PREF.GAME_MODE) return;
            const next = prefBool(PREF.GAME_MODE, false);
            if (next === gameMode.on) return;
            applyGameMode(next);
          },
        };
        try {
          Services.prefs.addObserver(PREF.GAME_MODE, observer);
          onCleanup(() => {
            try {
              Services.prefs.removeObserver(PREF.GAME_MODE, observer);
            } catch (_) {}
          });
        } catch (_) {}
        // Leaving a window that is in Game Mode must not leave the browser deactivated or persist the pref across a
        // restart: turning it off on teardown restores activity and clears the pref so the next launch starts normal.
        onCleanup(() => {
          if (gameMode.on) applyGameMode(false);
          if (prefBool(PREF.GAME_MODE, false)) {
            try {
              Services.prefs.setBoolPref(PREF.GAME_MODE, false);
            } catch (_) {}
          }
        });
      }

      /* ---------------- public API ---------------- */

      let disposed = false;
      const api = {
        memoryMB,
        runLevel1,
        // B4/OW-91: the deep pass, its undo record, and the panel modes. Each refuses politely when its layer is
        // missing (no shared policy, no panel module) instead of throwing at a caller that only wanted a button.
        runLevel2,
        restore,
        undoSize,
        setBackgroundMode,
        backgroundModeOf: (record) => modeOf(record),
        BACKGROUND_MODES,
        // G1: the single sleep door, exposed for tests and for the Game Mode planner (G2). It reports which
        // holder(s) were freed so a caller can explain a record that stayed loaded.
        sleepPanelRecord,
        // B7/OW-94: Game Mode. `setGameMode(true/false)` is what the widget's switch and the pref both call; the pref
        // observer is the only other entry point.
        setGameMode,
        applyGameMode,
        gameModeState,
        decideGameMode,
        gameModeTargets,
        // G2: pure planner and its on-demand dry run; neither changes anything.
        planGameMode,
        previewGameMode,
        // G3: the session snapshot, its live-only restore list and its counts. G5 consumes these.
        sessionState,
        // R2: the pure holder questions behind Restore. Exposed so a test can prove the legacy rule (data written
        // without `holders` restores a panel only when it was written with `wasLoaded: true`).
        panelHadHolder,
        normalizePanelRestoreEntry,
        // G4: the one parking tab, its deferred hand-back and its diagnostic state. `parkSelected()` defaults to
        // the pure planner's dry run; `unparkSelected()` is idempotent.
        parkSelected,
        unparkSelected,
        parkingState,
        // G5: one-click staggered Restore, its diagnostic state and its canceller. `restore()` above is the
        // panels-only immediate profile; the widget calls restoreSession() for the real Game Mode Restore.
        restoreSession,
        restoreState,
        cancelRestore,
        // G6: explicit user wakes remove their item from the snapshot and pending restore queue.
        noteUserWake,
        isRestoreWake,
        sessionEntries: () => ({
          panels: gameSession.panels.slice(),
          tabs: gameSession.tabs.slice(),
        }),
        sessionTabsForRestore,
        // B5/OW-92: the limiter's decisions and its live state, for a caller (the widget, a live check) that wants to
        // show them. The deciding itself is pure and tested on its own.
        decideLimiter,
        onLimiterEvent,
        limiterState: () => ({
          enabled: prefBool(PREF.LIMIT_ENABLED, false),
          settings: limiterSettings(),
          armed: Boolean(limiter.timer),
          lastAction: limiter.lastAction,
          lastReason: limiter.lastReason,
          runs: limiter.runs,
        }),
        onChange,
        startSampling,
        stopSampling,
        // G10: one owner for the standalone card's words and menu data. The full-pack tray keeps its own OW-121
        // strings; both UIs call these pure helpers for the shared Game Mode preview and snapshot wording.
        BOOST_WIDGET_STRINGS,
        widgetLanguage: boostWidgetLanguage,
        widgetText: boostWidgetText,
        widgetMenu: boostWidgetMenuItems,
        widgetPreviewText: boostWidgetPreviewText,
        widgetRestoreLabel: boostWidgetRestoreLabel,
        widgetResultText: boostWidgetResultText,
        widgetFeedbackText: boostWidgetFeedbackText,
        widgetOffText: boostWidgetOffText,
        onGameModeEvent,
        // The last sampled value, for a widget that must show something before it samples (OW-90).
        lastMB: () => lastSampleMB,
        isSupported: () => memoryMB() != null,
        // Diagnostics for a live check: what the trim has decided, in one object.
        state: () => ({
          disposed,
          trimDone,
          trimArmed: !!trimTimer,
          sampling: !!sampleTimer,
          samplerUsers,
          lastInputAt,
          memorySupport,
          level2Busy,
          undoSize: undoSize(),
          shortcut: shortcutSpec ? "set" : "",
          policy: Boolean(policy()),
          panels: essentialRecords().length,
          // OW-115: explain a deep pass that kept tabs, and show the live pinned/unpinned loaded counts.
          lastSkipped: { ...lastSkipped },
          loadedTabs: loadedTabCounts(),
        }),
        destroy,
      };

      function destroy() {
        if (disposed) return;
        // G8: cancel the Game Mode settle/late chain before any cleanup can observe the disposed flag; its
        // generation guard and owned timers are removed here, never left to fire after the window goes away.
        cancelGameModeWork("destroy");
        disposed = true;
        // G5: cancel the restore chain and remove every owned load listener/timeout before the window goes away.
        cancelRestore("destroy");
        for (const fn of cleanups.splice(0).reverse()) {
          try {
            fn();
          } catch (_) {}
        }
        for (const id of [...timers]) clearTimer(id);
        changeListeners.clear();
        gameModeListeners.clear();
        // G3/G4: no snapshot or Boost-owned parking tab survives a window teardown; both are in-memory work.
        resetGameSession(true);
        delete window.ZentralBoost;
      }

      window.ZentralBoost = api;
      const onWindowUnload = () => api.destroy();
      window.addEventListener("unload", onWindowUnload, { once: true });
      onCleanup(() => {
        try {
          window.removeEventListener("unload", onWindowUnload);
        } catch (_) {}
      });
      installShortcut();
      installLimiter();
      installGameMode();

      // A build without requestProcInfo has a memory meter that can never answer: say so once and stay out of the way
      // (the plan's B2.1). Level 1 is still useful on its own, so the module keeps running rather than disabling
      // everything.
      probeInfo = readProcInfo();
      if (!probeInfo) {
        memorySupport = false;
        warn(
          "this build does not expose ChromeUtils.requestProcInfo(); the RAM reading is unavailable, freeing memory still works",
        );
      } else if (typeof probeInfo.then === "function") {
        const pendingProbe = probeInfo;
        probeInfo = null;
        applyAsyncProcInfo(pendingProbe);
      }

      // B2.3: after session restore, once per browser start. The runtime activates features only after its own
      // native-ready barrier (session restore, delayed startup, Zen workspaces/pinned tabs), so `start()` already runs
      // after restoration in the full pack; the standalone path waits for the same barrier itself. The extra session
      // promise is the one case the barrier cannot cover: a window that starts while another window restores.
      function scheduleAfterRestore() {
        if (disposed) return;
        const session = globalThis.SessionStore?.promiseInitialized;
        if (session && typeof session.then === "function") {
          Promise.resolve(session)
            .then(() => {
              if (!disposed) scheduleStartupTrim();
            })
            .catch(() => {});
          return;
        }
        scheduleStartupTrim();
      }
      scheduleAfterRestore();

      return () => api.destroy();
    }

    if (ZentralRuntime) ZentralRuntime.register({ id: "boost", init: start });
    else standaloneReady(start);
  })();
})();
