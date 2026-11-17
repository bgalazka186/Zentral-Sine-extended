/*
 * ZENTRAL FILE GUIDE - additional/widgets/ZentralWidgets.uc.js
 *
 * Purpose: Independent sidebar widget tray shell, free-area measurement, sidebar video-player avoidance,
 *   per-widget on/off toggles, per-widget refresh scheduling (no permanent polling), pause-when-hidden,
 *   and last-value caching. Concrete widgets (clock/date, weather, timer, quick note, RSS, system) register
 *   into this shell via registerWidget().
 * Interaction / execution: Full pack activates via ZentralRuntime.register({ id: "widgets" }) and exposes
 *   ZentralRuntime.services.widgets; standalone mode runs via standaloneReady and yields if full pack loads.
 * Ownership / failure: Never interacts with, moves, styles, or depends on #zentral-video-preview (read-only
 *   rect measurement only). Always preserves space for tabs, folders, and Essentials; hides automatically when
 *   free height or sidebar width falls below configured minimums. Owns all timers, observers, and DOM cleanup.
 * Registration: widgets
 * Loaded/created by: loader/ZentralCatalog.js
 * Literal DOM event subscriptions: visibilitychange; sizemodechange; resize; unload; zen-workspace-switched
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
  const ZentralRuntime =
    window.ZentralRuntime || window.__zentralStandaloneRuntime;

  const WIDGET_PREFS = Object.freeze({
    ENABLED: "zen.workspace.zentral.widgets.enabled",
    MAX_HEIGHT_SHARE: "zen.workspace.zentral.widgets.max_height_share",
    MIN_FREE_HEIGHT: "zen.workspace.zentral.widgets.min_free_height",
    MIN_SIDEBAR_WIDTH: "zen.workspace.zentral.widgets.min_sidebar_width",
    TABS_RESERVE_PX: "zen.workspace.zentral.widgets.tabs_reserve_px",
    PAUSE_WHEN_HIDDEN: "zen.workspace.zentral.widgets.pause_when_hidden",
    DISABLED_IDS: "zen.workspace.zentral.widgets.disabled_ids",
    CLOCK_ENABLED: "zen.workspace.zentral.widgets.clock.enabled",
    CLOCK_FORMAT: "zen.workspace.zentral.widgets.clock.format",
    CLOCK_SHOW_SECONDS: "zen.workspace.zentral.widgets.clock.show_seconds",
    CLOCK_SHOW_ZONE: "zen.workspace.zentral.widgets.clock.show_zone",
    DATE_ENABLED: "zen.workspace.zentral.widgets.date.enabled",
    DATE_FORMAT: "zen.workspace.zentral.widgets.date.format",
    DATE_SHOW_YEAR: "zen.workspace.zentral.widgets.date.show_year",
    DATE_SHOW_WEEK: "zen.workspace.zentral.widgets.date.show_week_number",
  });

  const DEFAULTS = Object.freeze({
    ENABLED: false,
    MAX_HEIGHT_SHARE: 45,
    MIN_FREE_HEIGHT: 140,
    MIN_SIDEBAR_WIDTH: 120,
    TABS_RESERVE_PX: 24,
    PAUSE_WHEN_HIDDEN: true,
    DISABLED_IDS: "",
    CLOCK_ENABLED: true,
    CLOCK_FORMAT: "auto",
    CLOCK_SHOW_SECONDS: false,
    CLOCK_SHOW_ZONE: false,
    DATE_ENABLED: true,
    DATE_FORMAT: "long",
    DATE_SHOW_YEAR: false,
    DATE_SHOW_WEEK: false,
  });

  const CLOCK_FORMATS = Object.freeze(["auto", "24h", "12h"]);
  const DATE_FORMATS = Object.freeze(["long", "short", "iso"]);

  const LIMITS = Object.freeze({
    MAX_HEIGHT_SHARE: [15, 80],
    MIN_FREE_HEIGHT: [60, 400],
    MIN_SIDEBAR_WIDTH: [80, 320],
    TABS_RESERVE_PX: [0, 200],
    MIN_RENDERABLE_TRAY_PX: 40,
    MIN_ERROR_RETRY_MS: 5000,
  });

  const VIDEO_PLAYER_ID = "zentral-video-preview";
  const TRAY_ID = "zentral-sidebar-widgets";
  const VIDEO_ANCHOR_IDS = new Set([
    "zen-media-controls-toolbar",
    "zen-sidebar-bottom-buttons",
    "tabbrowser-tabs",
    "vertical-tabs",
  ]);

  function standaloneReady(start) {
    let started = false;
    const run = () => {
      if (started || !window.gBrowser) return;
      started = true;
      try {
        Services.obs.removeObserver(
          observer,
          "browser-delayed-startup-finished",
        );
      } catch (_) {}
      start();
    };
    const observer = {
      observe(subject, topic) {
        if (subject === window && topic === "browser-delayed-startup-finished")
          run();
      },
    };
    if (
      window.gBrowser &&
      (!window.gBrowserInit || window.gBrowserInit.delayedStartupFinished)
    )
      run();
    else {
      Services.obs.addObserver(observer, "browser-delayed-startup-finished");
      window.addEventListener(
        "unload",
        () => {
          try {
            Services.obs.removeObserver(
              observer,
              "browser-delayed-startup-finished",
            );
          } catch (_) {}
        },
        { once: true },
      );
      if (window.gBrowserInit?.delayedStartupFinished) run();
    }
  }

  // ---- Pure core helpers (exported for tests and concrete widgets) ----

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function normalizeWidgetId(id) {
    const s = String(id || "")
      .trim()
      .toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{0,47}$/.test(s) ? s : "";
  }

  function parseDisabledIds(raw) {
    const out = new Set();
    if (!raw || typeof raw !== "string") return out;
    for (const part of raw.split(/[\s,;]+/)) {
      const id = normalizeWidgetId(part);
      if (id) out.add(id);
    }
    return out;
  }

  function serializeDisabledIds(ids) {
    const clean = [];
    const seen = new Set();
    for (const raw of ids || []) {
      const id = normalizeWidgetId(raw);
      if (id && !seen.has(id)) {
        seen.add(id);
        clean.push(id);
      }
    }
    clean.sort();
    return clean.join(",");
  }

  function isVideoPlayerElement(node) {
    return Boolean(node && node.id === VIDEO_PLAYER_ID);
  }

  function cleanClockFormat(val) {
    const s = String(val || "")
      .trim()
      .toLowerCase();
    return CLOCK_FORMATS.includes(s) ? s : DEFAULTS.CLOCK_FORMAT;
  }

  function cleanDateFormat(val) {
    const s = String(val || "")
      .trim()
      .toLowerCase();
    return DATE_FORMATS.includes(s) ? s : DEFAULTS.DATE_FORMAT;
  }

  function pad2(n) {
    return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, "0");
  }

  /**
   * DST-safe ISO 8601 week number (Monday-first, week 1 contains Jan 4).
   */
  function isoWeekNumber(year, month1, day) {
    const utc = new Date(Date.UTC(year, month1 - 1, day));
    const dow = utc.getUTCDay() || 7; // Mon=1 .. Sun=7
    utc.setUTCDate(utc.getUTCDate() + 4 - dow);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    return Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  }

  function civilPartsOf(nowMs, { locale, timeZone } = {}) {
    const d = new Date(nowMs);
    if (timeZone) {
      try {
        const fmt = new Intl.DateTimeFormat(locale || "en-US", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        });
        const map = {};
        for (const p of fmt.formatToParts(d)) map[p.type] = p.value;
        const year = Number(map.year);
        const month = Number(map.month);
        const day = Number(map.day);
        const hour = Number(map.hour) % 24;
        const minute = Number(map.minute);
        const second = Number(map.second);
        if (
          [year, month, day, hour, minute, second].every(Number.isFinite)
        ) {
          return { year, month, day, hour, minute, second };
        }
      } catch (_) {}
    }
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      second: d.getSeconds(),
    };
  }

  function formatClockParts(nowMs, opts = {}) {
    const format = cleanClockFormat(opts.format);
    const showSeconds = Boolean(opts.showSeconds);
    const showZone = Boolean(opts.showZone);
    const locale = opts.locale || undefined;
    const timeZone = opts.timeZone || undefined;
    const d = new Date(nowMs);
    const civil = civilPartsOf(nowMs, { locale, timeZone });

    let hours = pad2(civil.hour);
    let minutes = pad2(civil.minute);
    let seconds = pad2(civil.second);
    let meridiem = "";
    let zoneLabel = "";

    const intlOpts = {
      hour: format === "12h" ? "numeric" : "2-digit",
      minute: "2-digit",
    };
    if (showSeconds) intlOpts.second = "2-digit";
    if (format === "24h") intlOpts.hourCycle = "h23";
    else if (format === "12h") intlOpts.hour12 = true;
    if (timeZone) intlOpts.timeZone = timeZone;
    if (showZone) intlOpts.timeZoneName = "short";

    try {
      const parts = new Intl.DateTimeFormat(locale, intlOpts).formatToParts(d);
      const map = {};
      for (const p of parts) {
        if (!(p.type in map)) map[p.type] = p.value;
      }
      if (map.hour != null) hours = format === "24h" ? pad2(Number(map.hour) % 24) : map.hour;
      if (map.minute != null) minutes = map.minute;
      if (map.second != null) seconds = map.second;
      if (map.dayPeriod) meridiem = map.dayPeriod.trim();
      if (map.timeZoneName) zoneLabel = map.timeZoneName.trim();
    } catch (_) {
      if (format === "12h") {
        meridiem = civil.hour >= 12 ? "PM" : "AM";
        hours = String(civil.hour % 12 || 12);
      }
    }

    const time = `${hours}:${minutes}`;
    const fullTime = showSeconds ? `${time}:${seconds}` : time;
    const text = meridiem ? `${fullTime} ${meridiem}` : fullTime;
    const key = showSeconds
      ? `${civil.year}-${pad2(civil.month)}-${pad2(civil.day)}T${pad2(civil.hour)}:${pad2(civil.minute)}:${pad2(civil.second)}`
      : `${civil.year}-${pad2(civil.month)}-${pad2(civil.day)}T${pad2(civil.hour)}:${pad2(civil.minute)}`;

    return {
      time,
      hours,
      minutes,
      seconds: showSeconds ? seconds : "",
      meridiem,
      zoneLabel: showZone ? zoneLabel : "",
      text,
      key,
      format,
      showSeconds,
      showZone,
    };
  }

  function formatDateParts(nowMs, opts = {}) {
    const format = cleanDateFormat(opts.format);
    const showYear = Boolean(opts.showYear);
    const showWeekNumber = Boolean(opts.showWeekNumber);
    const locale = opts.locale || undefined;
    const timeZone = opts.timeZone || undefined;
    const d = new Date(nowMs);
    const civil = civilPartsOf(nowMs, { locale, timeZone });
    const isoDate = `${civil.year}-${pad2(civil.month)}-${pad2(civil.day)}`;
    const weekNumber = isoWeekNumber(civil.year, civil.month, civil.day);

    let weekdayShort = "";
    let weekdayLong = "";
    let monthLabel = "";

    try {
      const base = timeZone ? { timeZone } : {};
      weekdayShort = new Intl.DateTimeFormat(locale, {
        ...base,
        weekday: "short",
      }).format(d);
      weekdayLong = new Intl.DateTimeFormat(locale, {
        ...base,
        weekday: "long",
      }).format(d);
      monthLabel = new Intl.DateTimeFormat(locale, {
        ...base,
        month: format === "short" ? "short" : "long",
      }).format(d);
    } catch (_) {
      const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const MONTHS = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];
      const utcDow = new Date(Date.UTC(civil.year, civil.month - 1, civil.day)).getUTCDay();
      weekdayShort = DAYS[utcDow] || "";
      weekdayLong = weekdayShort;
      monthLabel = MONTHS[civil.month - 1] || "";
    }

    let primary = "";
    let secondary = "";
    if (format === "iso") {
      primary = isoDate;
      secondary = weekdayLong;
    } else if (format === "short") {
      primary = `${monthLabel} ${civil.day}${showYear ? `, ${civil.year}` : ""}`;
      secondary = weekdayShort;
    } else {
      primary = `${monthLabel} ${civil.day}${showYear ? `, ${civil.year}` : ""}`;
      secondary = weekdayLong;
    }

    const weekBadge = showWeekNumber ? `W${weekNumber}` : "";
    const text = [secondary, primary, weekBadge].filter(Boolean).join(" · ");

    return {
      isoDate,
      year: civil.year,
      month: civil.month,
      dayNumber: String(civil.day),
      weekdayShort,
      weekdayLong,
      monthLabel,
      weekNumber,
      weekBadge,
      primary,
      secondary,
      text,
      key: isoDate,
      format,
      showYear,
      showWeekNumber,
    };
  }

  /**
   * Exact milliseconds until the next second or minute wall-clock boundary.
   */
  function nextClockDelayMs(nowMs, showSeconds = false) {
    const unit = showSeconds ? 1000 : 60000;
    const rem = unit - (((nowMs % unit) + unit) % unit);
    return Math.max(50, Math.min(unit, rem === 0 ? unit : rem));
  }

  /**
   * Exact milliseconds until the next local calendar midnight (DST-safe).
   */
  function nextLocalMidnightDelayMs(nowMs, timeZone) {
    if (timeZone) {
      const c = civilPartsOf(nowMs, { timeZone });
      const elapsedSec = c.hour * 3600 + c.minute * 60 + c.second;
      const msInSec = ((nowMs % 1000) + 1000) % 1000;
      const approx = Math.max(1000, (86400 - elapsedSec) * 1000 - msInSec + 100);
      return Math.min(86400000, approx);
    }
    const d = new Date(nowMs);
    const nextMidnight = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + 1,
      0,
      0,
      0,
      100,
    ).getTime();
    return Math.max(1000, nextMidnight - nowMs);
  }

  function isClockCacheStale(nowMs, cached, opts = {}) {
    if (!cached?.value) return true;
    const format = cleanClockFormat(opts.format);
    const showSeconds = Boolean(opts.showSeconds);
    const showZone = Boolean(opts.showZone);
    if (
      cached.value.format !== format ||
      Boolean(cached.value.showSeconds) !== showSeconds ||
      Boolean(cached.value.showZone) !== showZone
    )
      return true;
    const fresh = formatClockParts(nowMs, opts);
    return fresh.key !== cached.value.key;
  }

  function isDateCacheStale(nowMs, cached, opts = {}) {
    if (!cached?.value) return true;
    const format = cleanDateFormat(opts.format);
    const showYear = Boolean(opts.showYear);
    const showWeekNumber = Boolean(opts.showWeekNumber);
    if (
      cached.value.format !== format ||
      Boolean(cached.value.showYear) !== showYear ||
      Boolean(cached.value.showWeekNumber) !== showWeekNumber
    )
      return true;
    const civil = civilPartsOf(nowMs, opts);
    const isoDate = `${civil.year}-${pad2(civil.month)}-${pad2(civil.day)}`;
    return isoDate !== cached.value.key;
  }

  function resolveWidgetRefreshMs(def, rawPrefValue) {
    const fallback =
      typeof def?.refreshMs === "number" && Number.isFinite(def.refreshMs)
        ? Math.max(0, Math.round(def.refreshMs))
        : 0;
    if (fallback === 0 && rawPrefValue == null) return 0;
    const minMs =
      typeof def?.minRefreshMs === "number" && Number.isFinite(def.minRefreshMs)
        ? Math.max(1000, Math.round(def.minRefreshMs))
        : 1000;
    const maxMs =
      typeof def?.maxRefreshMs === "number" && Number.isFinite(def.maxRefreshMs)
        ? Math.max(minMs, Math.round(def.maxRefreshMs))
        : 86400000;
    const scale =
      typeof def?.refreshScale === "number" && def.refreshScale > 0
        ? def.refreshScale
        : 1;
    if (rawPrefValue != null && Number.isFinite(Number(rawPrefValue))) {
      const raw = Math.round(Number(rawPrefValue) * scale);
      if (raw <= 0 && fallback === 0) return 0;
      return Math.max(minMs, Math.min(maxMs, raw));
    }
    if (fallback <= 0) return 0;
    return Math.max(minMs, Math.min(maxMs, fallback));
  }

  /**
   * Pure free-area & budget calculation.
   *
   * Never assumes a fixed aspect ratio for #zentral-video-preview: whatever actual
   * measured height the video player occupies (0 when hidden or popped out via
   * Big Preview) is subtracted directly alongside other fixed sidebar chrome and
   * occupied tabs/folders height. Own tray height is NEVER an input here, so
   * showing or resizing the widget tray cannot cause a measurement feedback loop.
   */
  function computeWidgetArea(metrics = {}, config = {}) {
    const sidebarWidth = Math.max(
      0,
      Math.floor(Number(metrics.sidebarWidth) || 0),
    );
    const sidebarHeight = Math.max(
      0,
      Math.floor(Number(metrics.sidebarHeight) || 0),
    );
    const otherChromeHeight = Math.max(
      0,
      Math.ceil(Number(metrics.otherChromeHeight) || 0),
    );
    const videoPlayerVisible = Boolean(
      metrics.videoPlayerVisible && Number(metrics.videoPlayerHeight) > 0,
    );
    const videoReservedHeight = videoPlayerVisible
      ? Math.ceil(Number(metrics.videoPlayerHeight) || 0)
      : 0;
    const tabsContentHeight = Math.max(
      0,
      Math.ceil(Number(metrics.tabsContentHeight) || 0),
    );
    const windowHidden = Boolean(metrics.windowHidden);
    const sidebarHidden = Boolean(metrics.sidebarHidden);

    const enabled = Boolean(config.enabled);
    const pauseWhenHidden =
      config.pauseWhenHidden === undefined
        ? DEFAULTS.PAUSE_WHEN_HIDDEN
        : Boolean(config.pauseWhenHidden);
    const maxHeightShare = clampInt(
      config.maxHeightShare,
      LIMITS.MAX_HEIGHT_SHARE[0],
      LIMITS.MAX_HEIGHT_SHARE[1],
      DEFAULTS.MAX_HEIGHT_SHARE,
    );
    const minFreeHeight = clampInt(
      config.minFreeHeight,
      LIMITS.MIN_FREE_HEIGHT[0],
      LIMITS.MIN_FREE_HEIGHT[1],
      DEFAULTS.MIN_FREE_HEIGHT,
    );
    const minSidebarWidth = clampInt(
      config.minSidebarWidth,
      LIMITS.MIN_SIDEBAR_WIDTH[0],
      LIMITS.MIN_SIDEBAR_WIDTH[1],
      DEFAULTS.MIN_SIDEBAR_WIDTH,
    );
    const tabsReservePx = clampInt(
      config.tabsReservePx,
      LIMITS.TABS_RESERVE_PX[0],
      LIMITS.TABS_RESERVE_PX[1],
      DEFAULTS.TABS_RESERVE_PX,
    );
    const activeWidgetCount = Math.max(
      0,
      Math.floor(Number(config.activeWidgetCount) || 0),
    );

    const rawFreeHeight = Math.max(
      0,
      Math.floor(
        sidebarHeight -
          otherChromeHeight -
          videoReservedHeight -
          tabsContentHeight,
      ),
    );
    const usableFreeHeight = Math.max(0, rawFreeHeight - tabsReservePx);
    const shareBudgetHeight = Math.floor(
      rawFreeHeight * (maxHeightShare / 100),
    );
    const maxTrayHeight = Math.max(
      0,
      Math.min(usableFreeHeight, shareBudgetHeight),
    );
    const density =
      sidebarWidth <= 176
        ? "compact"
        : sidebarWidth >= 230
          ? "comfortable"
          : "regular";

    let visible = true;
    let paused = false;
    let reason = "visible";

    if (!enabled) {
      visible = false;
      paused = true;
      reason = "disabled";
    } else if (windowHidden) {
      visible = false;
      paused = pauseWhenHidden;
      reason = "window-hidden";
    } else if (sidebarHidden) {
      visible = false;
      paused = pauseWhenHidden;
      reason = "sidebar-hidden";
    } else if (activeWidgetCount <= 0) {
      visible = false;
      paused = true;
      reason = "no-widgets";
    } else if (sidebarWidth < minSidebarWidth) {
      visible = false;
      paused = pauseWhenHidden;
      reason = "narrow-sidebar";
    } else if (
      rawFreeHeight < minFreeHeight ||
      maxTrayHeight < LIMITS.MIN_RENDERABLE_TRAY_PX
    ) {
      visible = false;
      paused = pauseWhenHidden;
      reason = "low-free-height";
    }

    return {
      visible,
      paused,
      reason,
      sidebarWidth,
      sidebarHeight,
      rawFreeHeight,
      usableFreeHeight,
      maxTrayHeight: visible ? maxTrayHeight : 0,
      shareBudgetHeight,
      videoPlayerVisible,
      videoReservedHeight,
      tabsContentHeight,
      otherChromeHeight,
      tabsReservePx,
      density,
    };
  }

  function isAncestorVisible(el, win) {
    const getStyle = win?.getComputedStyle;
    for (let p = el?.parentElement; p; p = p.parentElement) {
      if (p.hidden) return false;
      if (typeof getStyle === "function") {
        try {
          const st = getStyle(p);
          if (st?.display === "none" || st?.visibility === "collapse")
            return false;
        } catch (_) {}
      }
    }
    return true;
  }

  /**
   * Picks a safe mount position inside the Zen sidebar flex column without EVER
   * touching #zentral-video-preview or inserting between a video anchor and
   * #zentral-video-preview (which ZentralVideoSidebar expects to be adjacent).
   */
  function chooseWidgetMountTarget(doc, win, fallbackSidebar) {
    if (!doc || typeof doc.getElementById !== "function") return null;

    const media = doc.getElementById("zen-media-controls-toolbar");
    if (media?.parentNode && isAncestorVisible(media, win)) {
      return {
        parent: media.parentNode,
        before: media,
        anchorId: "zen-media-controls-toolbar",
      };
    }

    const bottom = doc.getElementById("zen-sidebar-bottom-buttons");
    if (bottom?.parentNode && isAncestorVisible(bottom, win)) {
      return {
        parent: bottom.parentNode,
        before: bottom,
        anchorId: "zen-sidebar-bottom-buttons",
      };
    }

    const video = doc.getElementById(VIDEO_PLAYER_ID);
    const tabs =
      doc.getElementById("vertical-tabs") ||
      doc.getElementById("tabbrowser-tabs");

    if (tabs?.parentNode && isAncestorVisible(tabs, win)) {
      let next = tabs.nextSibling;
      // If #zentral-video-preview is mounted immediately after the tabs anchor,
      // skip past it so we never disturb video.previousSibling === tabs.
      if (next && isVideoPlayerElement(next)) {
        next = next.nextSibling;
      }
      return {
        parent: tabs.parentNode,
        before: next || null,
        anchorId: tabs.id || "tabs",
      };
    }

    if (video?.parentNode && isAncestorVisible(video, win)) {
      const prev = video.previousSibling;
      if (prev && VIDEO_ANCHOR_IDS.has(prev.id)) {
        return {
          parent: video.parentNode,
          before: video.nextSibling || null,
          anchorId: VIDEO_PLAYER_ID + ":after",
        };
      }
      return {
        parent: video.parentNode,
        before: video,
        anchorId: VIDEO_PLAYER_ID + ":before",
      };
    }

    const sidebar =
      doc.getElementById("navigator-toolbox") || fallbackSidebar || null;
    if (sidebar) {
      return {
        parent: sidebar,
        before: null,
        anchorId: sidebar.id || "sidebar",
      };
    }
    return null;
  }

  function safeStyle(el, win) {
    if (!el || typeof win?.getComputedStyle !== "function") return null;
    try {
      return win.getComputedStyle(el);
    } catch (_) {
      return null;
    }
  }

  function safeRect(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return null;
    try {
      const r = el.getBoundingClientRect();
      if (
        !r ||
        ![r.top, r.bottom, r.left, r.right, r.width, r.height].every(
          Number.isFinite,
        )
      )
        return null;
      return r;
    } catch (_) {
      return null;
    }
  }

  function parsePx(val) {
    const n = Number.parseFloat(val);
    return Number.isFinite(n) ? n : 0;
  }

  function outerVerticalSize(el, win) {
    const r = safeRect(el);
    if (!r || r.height <= 0) return 0;
    const st = safeStyle(el, win);
    const mt = st ? Math.max(0, parsePx(st.marginTop)) : 0;
    const mb = st ? Math.max(0, parsePx(st.marginBottom)) : 0;
    return r.height + mt + mb;
  }

  function isElementHidden(el, win) {
    if (!el || el.hidden) return true;
    const st = safeStyle(el, win);
    if (
      st &&
      (st.display === "none" ||
        st.visibility === "hidden" ||
        st.visibility === "collapse")
    )
      return true;
    return false;
  }

  function measureTabsContentHeight(tabsHost, win) {
    if (!tabsHost || isElementHidden(tabsHost, win)) return 0;
    const hostRect = safeRect(tabsHost);
    if (!hostRect) return 0;

    let maxBottom = 0;
    const scrollTop = Number.isFinite(tabsHost.scrollTop)
      ? Math.max(0, tabsHost.scrollTop)
      : 0;

    // Inspect concrete visible tab/folder/action items so stretched flex wrappers
    // inside #vertical-tabs do not falsely consume all free space.
    let items = [];
    if (typeof tabsHost.querySelectorAll === "function") {
      try {
        items = Array.from(
          tabsHost.querySelectorAll(
            "tab, .tabbrowser-tab, zen-folder, #tabs-newtab-button, #vertical-tabs-newtab-button, .zen-workspace-pinned-tabs-section > *, .zen-workspace-normal-tabs-section > *, toolbarseparator",
          ),
        );
      } catch (_) {
        items = [];
      }
    }

    for (const item of items) {
      if (!item || item === tabsHost || isElementHidden(item, win)) continue;
      const r = safeRect(item);
      if (!r || r.height <= 0) continue;
      const bottom = r.bottom - hostRect.top + scrollTop;
      if (bottom > maxBottom) maxBottom = bottom;
    }

    // If the tabs container itself overflows its own viewport (many open tabs),
    // scrollHeight reflects the true full height demanded by tabs & folders.
    const clientH = Number(tabsHost.clientHeight) || hostRect.height;
    const scrollH = Number(tabsHost.scrollHeight) || 0;
    if (scrollH > clientH + 1) {
      maxBottom = Math.max(maxBottom, scrollH);
    } else if (maxBottom === 0 && scrollH > 0 && items.length === 0) {
      // Fallback for minimal/mock tabs containers that expose scrollHeight directly.
      const attrH = Number(tabsHost.getAttribute?.("data-zw-tabs-height"));
      if (Number.isFinite(attrH) && attrH >= 0) maxBottom = attrH;
    } else {
      const attrH = Number(tabsHost.getAttribute?.("data-zw-tabs-height"));
      if (Number.isFinite(attrH) && attrH >= 0 && items.length === 0)
        maxBottom = attrH;
    }

    return Math.max(0, Math.ceil(maxBottom));
  }

  /**
   * Read-only measurement of the live Zen sidebar geometry.
   * Never mutates DOM or styles, and never touches #zentral-video-preview.
   */
  function measureSidebarMetrics(doc, win, tray, fallbackSidebar) {
    const root = doc?.documentElement;
    const windowHidden = Boolean(
      doc?.hidden ||
        (Number.isFinite(win?.STATE_MINIMIZED) &&
          win?.windowState === win?.STATE_MINIMIZED),
    );

    const compactHidden = Boolean(
      root?.getAttribute?.("zen-sidebar-hidden") === "true" ||
        (root?.getAttribute?.("zen-compact-mode") === "true" &&
          root?.getAttribute?.("zen-compact-sidebar-visible") !== "true" &&
          root?.getAttribute?.("zen-sidebar-expanded") !== "true"),
    );

    const mountHost =
      tray?.parentNode && tray.parentNode.nodeType === 1
        ? tray.parentNode
        : doc?.getElementById?.("navigator-toolbox") ||
          fallbackSidebar ||
          null;

    if (!mountHost || compactHidden || isElementHidden(mountHost, win)) {
      return {
        sidebarWidth: 0,
        sidebarHeight: 0,
        otherChromeHeight: 0,
        videoPlayerVisible: false,
        videoPlayerHeight: 0,
        tabsContentHeight: 0,
        windowHidden,
        sidebarHidden: true,
      };
    }

    const hostRect = safeRect(mountHost);
    if (!hostRect || hostRect.width <= 0 || hostRect.height <= 0) {
      return {
        sidebarWidth: 0,
        sidebarHeight: 0,
        otherChromeHeight: 0,
        videoPlayerVisible: false,
        videoPlayerHeight: 0,
        tabsContentHeight: 0,
        windowHidden,
        sidebarHidden: true,
      };
    }

    const hostStyle = safeStyle(mountHost, win);
    const padX = hostStyle
      ? parsePx(hostStyle.paddingLeft) + parsePx(hostStyle.paddingRight)
      : 0;
    const padY = hostStyle
      ? parsePx(hostStyle.paddingTop) + parsePx(hostStyle.paddingBottom)
      : 0;
    const sidebarWidth = Math.max(0, Math.floor(hostRect.width - padX));
    const sidebarHeight = Math.max(0, Math.floor(hostRect.height - padY));

    const videoEl = doc.getElementById?.(VIDEO_PLAYER_ID) || null;
    const videoEnlarged = Boolean(videoEl?.hasAttribute?.("data-enlarged"));
    const videoVisible = Boolean(
      videoEl &&
        videoEl.isConnected !== false &&
        !videoEnlarged &&
        !isElementHidden(videoEl, win),
    );
    const videoPlayerHeight = videoVisible
      ? Math.ceil(outerVerticalSize(videoEl, win))
      : 0;

    const tabsHost =
      doc.getElementById?.("vertical-tabs") ||
      doc.getElementById?.("tabbrowser-tabs") ||
      null;

    let otherChromeHeight = 0;
    const children = mountHost.children ? Array.from(mountHost.children) : [];
    for (const child of children) {
      if (!child || child === tray || child === videoEl) continue;
      if (
        tabsHost &&
        (child === tabsHost || child.contains?.(tabsHost))
      )
        continue;
      if (isElementHidden(child, win)) continue;
      const st = safeStyle(child, win);
      if (st && (st.position === "fixed" || st.position === "absolute"))
        continue;
      otherChromeHeight += outerVerticalSize(child, win);
    }

    const tabsContentHeight = measureTabsContentHeight(tabsHost, win);

    return {
      sidebarWidth,
      sidebarHeight,
      otherChromeHeight: Math.ceil(otherChromeHeight),
      videoPlayerVisible: videoVisible && videoPlayerHeight > 0,
      videoPlayerHeight,
      tabsContentHeight,
      windowHidden,
      sidebarHidden: false,
    };
  }

  /**
   * Pure per-widget refresh scheduler + value cache (single-shot timeouts only; no polling).
   * Supports injectable clock & timers for deterministic unit tests.
   */
  function createWidgetScheduler({
    now = () => Date.now(),
    setTimer = (fn, ms) => window.setTimeout(fn, ms),
    clearTimer = (id) => window.clearTimeout(id),
    onError = (id, err) =>
      console.warn("[ZentralWidgets] widget failed:", id, err),
  } = {}) {
    const entries = new Map(); // id -> { def, instance, timer, token, inflight, intervalMs }
    const cache = new Map(); // cacheKey -> { value, updatedAt }
    let paused = true;
    let disposed = false;

    function cacheKeyOf(def) {
      return def.cacheKey || def.id;
    }

    function clearEntryTimer(entry) {
      if (entry.timer !== null) {
        clearTimer(entry.timer);
        entry.timer = null;
      }
    }

    function scheduleNext(entry, { isError = false, lastValue } = {}) {
      clearEntryTimer(entry);
      if (disposed || paused || !entries.has(entry.def.id)) return;
      const intervalMs = entry.intervalMs;
      if (!intervalMs || intervalMs <= 0) return;
      let delay = intervalMs;
      if (isError) {
        delay = Math.max(LIMITS.MIN_ERROR_RETRY_MS, intervalMs);
      } else if (typeof entry.instance?.nextDelayMs === "function") {
        try {
          const custom = entry.instance.nextDelayMs(
            now(),
            intervalMs,
            lastValue,
          );
          if (Number.isFinite(custom) && custom >= 50)
            delay = Math.round(custom);
        } catch (_) {}
      }
      entry.timer = setTimer(() => {
        entry.timer = null;
        if (!disposed && !paused && entries.has(entry.def.id)) {
          refresh(entry.def.id, { force: true });
        }
      }, delay);
    }

    function paintCached(entry, area) {
      const cached = cache.get(cacheKeyOf(entry.def));
      if (!cached || typeof entry.instance?.render !== "function") return false;
      try {
        entry.instance.render(cached.value, {
          cached: true,
          updatedAt: cached.updatedAt,
          error: null,
          area,
        });
      } catch (err) {
        onError(entry.def.id, err);
      }
      return true;
    }

    function refresh(id, { force = false, area = null } = {}) {
      const entry = entries.get(id);
      if (!entry || disposed) return Promise.resolve(false);
      if (paused && !force) return Promise.resolve(false);
      const cached = cache.get(cacheKeyOf(entry.def));
      if (!force && cached && entry.intervalMs > 0) {
        const customStale =
          typeof entry.instance?.isStale === "function"
            ? Boolean(entry.instance.isStale(now(), cached, entry.intervalMs))
            : now() - cached.updatedAt >= entry.intervalMs;
        if (!customStale) {
          let remaining = Math.max(
            50,
            entry.intervalMs - (now() - cached.updatedAt),
          );
          if (typeof entry.instance?.nextDelayMs === "function") {
            try {
              const custom = entry.instance.nextDelayMs(
                now(),
                entry.intervalMs,
                cached.value,
              );
              if (Number.isFinite(custom) && custom >= 50)
                remaining = Math.round(custom);
            } catch (_) {}
          }
          clearEntryTimer(entry);
          if (!paused) {
            entry.timer = setTimer(() => {
              entry.timer = null;
              if (!disposed && !paused && entries.has(id))
                refresh(id, { force: true, area });
            }, remaining);
          }
          return Promise.resolve(false);
        }
      }

      if (typeof entry.instance?.fetch !== "function") {
        // Pure render-only widget: invoke render(undefined, ...) on schedule.
        const ts = now();
        try {
          entry.instance?.render?.(cached?.value, {
            cached: false,
            updatedAt: ts,
            error: null,
            area,
          });
        } catch (err) {
          onError(id, err);
        }
        if (entry.intervalMs > 0) scheduleNext(entry, { lastValue: cached?.value });
        return Promise.resolve(true);
      }

      clearEntryTimer(entry);
      const token = ++entry.token;
      entry.inflight = true;

      let result;
      try {
        result = entry.instance.fetch({
          now: now(),
          cachedValue: cached?.value,
          updatedAt: cached?.updatedAt || 0,
          area,
        });
      } catch (err) {
        entry.inflight = false;
        onError(id, err);
        try {
          entry.instance?.render?.(cached?.value, {
            cached: Boolean(cached),
            updatedAt: cached?.updatedAt || 0,
            error: err,
            area,
          });
        } catch (_) {}
        if (!paused) scheduleNext(entry, { isError: true, lastValue: cached?.value });
        return Promise.resolve(false);
      }

      const finish = (value) => {
        if (disposed) return false;
        const ts = now();
        if (value !== undefined) {
          cache.set(cacheKeyOf(entry.def), { value, updatedAt: ts });
        }
        const current = entries.get(id);
        if (!current || current !== entry || current.token !== token)
          return false;
        current.inflight = false;
        const stored = cache.get(cacheKeyOf(entry.def));
        try {
          current.instance?.render?.(stored?.value, {
            cached: false,
            updatedAt: stored?.updatedAt || ts,
            error: null,
            area,
          });
        } catch (err) {
          onError(id, err);
        }
        if (!paused) scheduleNext(current, { lastValue: stored?.value });
        return true;
      };

      const fail = (err) => {
        if (disposed) return false;
        const current = entries.get(id);
        if (!current || current !== entry || current.token !== token)
          return false;
        current.inflight = false;
        onError(id, err);
        const prev = cache.get(cacheKeyOf(entry.def));
        try {
          current.instance?.render?.(prev?.value, {
            cached: Boolean(prev),
            updatedAt: prev?.updatedAt || 0,
            error: err,
            area,
          });
        } catch (_) {}
        if (!paused) scheduleNext(current, { isError: true, lastValue: prev?.value });
        return false;
      };

      if (result && typeof result.then === "function") {
        return result.then(finish, fail);
      }
      return Promise.resolve(finish(result));
    }

    function activate(def, instance, intervalMs, area) {
      deactivate(def.id);
      const entry = {
        def,
        instance,
        timer: null,
        token: 0,
        inflight: false,
        intervalMs: Math.max(0, Number(intervalMs) || 0),
      };
      entries.set(def.id, entry);
      paintCached(entry, area);
      if (!paused) {
        refresh(def.id, { force: false, area });
      }
    }

    function deactivate(id) {
      const entry = entries.get(id);
      if (!entry) return;
      entry.token++;
      clearEntryTimer(entry);
      entries.delete(id);
    }

    function updateInterval(id, intervalMs, area) {
      const entry = entries.get(id);
      if (!entry) return;
      entry.intervalMs = Math.max(0, Number(intervalMs) || 0);
      clearEntryTimer(entry);
      if (!paused && entry.intervalMs > 0) {
        refresh(id, { force: false, area });
      }
    }

    function setPaused(nextPaused, area) {
      const target = Boolean(nextPaused);
      if (target === paused) return;
      paused = target;
      if (paused) {
        for (const entry of entries.values()) {
          clearEntryTimer(entry);
        }
      } else {
        for (const entry of entries.values()) {
          paintCached(entry, area);
          refresh(entry.def.id, { force: false, area });
        }
      }
    }

    function getCached(idOrKey) {
      const entry = entries.get(idOrKey);
      const key = entry ? cacheKeyOf(entry.def) : idOrKey;
      const item = cache.get(key);
      return item ? { value: item.value, updatedAt: item.updatedAt } : null;
    }

    function setCached(idOrKey, value, updatedAt = now()) {
      const entry = entries.get(idOrKey);
      const key = entry ? cacheKeyOf(entry.def) : idOrKey;
      cache.set(key, { value, updatedAt });
    }

    function clearCache(idOrKey) {
      if (idOrKey == null) cache.clear();
      else cache.delete(idOrKey);
    }

    function activeTimerCount() {
      let n = 0;
      for (const entry of entries.values()) if (entry.timer !== null) n++;
      return n;
    }

    function destroy() {
      disposed = true;
      paused = true;
      for (const entry of entries.values()) {
        entry.token++;
        clearEntryTimer(entry);
      }
      entries.clear();
    }

    return {
      activate,
      deactivate,
      updateInterval,
      setPaused,
      refresh,
      getCached,
      setCached,
      clearCache,
      isPaused: () => paused,
      activeTimerCount,
      destroy,
    };
  }

  const core = Object.freeze({
    WIDGET_PREFS,
    DEFAULTS,
    LIMITS,
    CLOCK_FORMATS,
    DATE_FORMATS,
    VIDEO_PLAYER_ID,
    TRAY_ID,
    clampInt,
    normalizeWidgetId,
    parseDisabledIds,
    serializeDisabledIds,
    isVideoPlayerElement,
    cleanClockFormat,
    cleanDateFormat,
    isoWeekNumber,
    formatClockParts,
    formatDateParts,
    nextClockDelayMs,
    nextLocalMidnightDelayMs,
    isClockCacheStale,
    isDateCacheStale,
    resolveWidgetRefreshMs,
    computeWidgetArea,
    chooseWidgetMountTarget,
    measureTabsContentHeight,
    measureSidebarMetrics,
    createWidgetScheduler,
  });

  if (window.__zentralWidgetsTestSeam) {
    window.__zentralWidgetsTestSeam.core = core;
  }

  // ---- Runtime feature shell ----

  (function () {
    function start({ lifecycle, runtime: hostRuntime } = {}) {
      let disposed = false;
      const cleanups = [];
      const registerCleanup = (fn) => cleanups.push(fn);
      const getRuntime = () =>
        hostRuntime ||
        window.ZentralRuntime ||
        window.__zentralStandaloneRuntime ||
        null;

      const getBool = (key, fallback) => {
        try {
          return Services.prefs.getBoolPref(key, fallback);
        } catch (_) {
          return fallback;
        }
      };
      const getInt = (key, fallback) => {
        try {
          return Services.prefs.getIntPref(key, fallback);
        } catch (_) {
          return fallback;
        }
      };
      const getString = (key, fallback) => {
        try {
          return Services.prefs.getStringPref(key, fallback);
        } catch (_) {
          return fallback;
        }
      };

      const registry = new Map(); // id -> def
      const mountedCards = new Map(); // id -> { card, body, instance }
      const watchedPrefs = new Map(); // pref -> observerFn
      const scheduler = createWidgetScheduler();

      let tray = null;
      let observedHost = null;
      let observedVideo = null;
      let resizeObserver = null;
      let hostMutationObserver = null;
      let rootAttrObserver = null;
      let rafMeasure = null;
      let lastArea = computeWidgetArea({}, { enabled: false });

      function readConfig() {
        return {
          enabled: getBool(WIDGET_PREFS.ENABLED, false),
          maxHeightShare: clampInt(
            getInt(WIDGET_PREFS.MAX_HEIGHT_SHARE, 45),
            LIMITS.MAX_HEIGHT_SHARE[0],
            LIMITS.MAX_HEIGHT_SHARE[1],
            DEFAULTS.MAX_HEIGHT_SHARE,
          ),
          minFreeHeight: clampInt(
            getInt(WIDGET_PREFS.MIN_FREE_HEIGHT, 140),
            LIMITS.MIN_FREE_HEIGHT[0],
            LIMITS.MIN_FREE_HEIGHT[1],
            DEFAULTS.MIN_FREE_HEIGHT,
          ),
          minSidebarWidth: clampInt(
            getInt(WIDGET_PREFS.MIN_SIDEBAR_WIDTH, 120),
            LIMITS.MIN_SIDEBAR_WIDTH[0],
            LIMITS.MIN_SIDEBAR_WIDTH[1],
            DEFAULTS.MIN_SIDEBAR_WIDTH,
          ),
          tabsReservePx: clampInt(
            getInt(WIDGET_PREFS.TABS_RESERVE_PX, 24),
            LIMITS.TABS_RESERVE_PX[0],
            LIMITS.TABS_RESERVE_PX[1],
            DEFAULTS.TABS_RESERVE_PX,
          ),
          pauseWhenHidden: getBool(WIDGET_PREFS.PAUSE_WHEN_HIDDEN, true),
          disabledIds: parseDisabledIds(
            getString(WIDGET_PREFS.DISABLED_IDS, ""),
          ),
        };
      }

      function isWidgetEnabled(def, config = readConfig()) {
        if (!def) return false;
        if (config.disabledIds.has(def.id)) return false;
        if (def.pref) {
          return getBool(def.pref, def.defaultEnabled !== false);
        }
        return def.defaultEnabled !== false;
      }

      function widgetIntervalMs(def) {
        if (typeof def.resolveIntervalMs === "function") {
          try {
            const custom = def.resolveIntervalMs();
            if (Number.isFinite(custom) && custom >= 0) return Math.round(custom);
          } catch (_) {}
        }
        let rawPref = null;
        if (def.refreshPref) {
          try {
            if (Services.prefs.getPrefType?.(def.refreshPref)) {
              rawPref = Services.prefs.getIntPref(def.refreshPref);
            }
          } catch (_) {}
        }
        return resolveWidgetRefreshMs(def, rawPref);
      }

      function watchPref(pref, handler) {
        if (!pref || watchedPrefs.has(pref)) return;
        const obs = {
          observe(_s, _t, data) {
            if (!disposed && (!data || data === pref)) handler(pref);
          },
        };
        try {
          Services.prefs.addObserver(pref, obs);
          watchedPrefs.set(pref, obs);
        } catch (_) {}
      }

      function unwatchAllPrefs() {
        for (const [pref, obs] of watchedPrefs) {
          try {
            Services.prefs.removeObserver(pref, obs);
          } catch (_) {}
        }
        watchedPrefs.clear();
      }

      function ensureTray() {
        if (disposed) return null;
        if (!tray) {
          const existing = document.getElementById?.(TRAY_ID);
          if (existing) existing.remove();
          tray = document.createElement("div");
          tray.id = TRAY_ID;
          tray.className = "zw-tray";
          tray.hidden = true;
          tray.setAttribute("role", "region");
          tray.setAttribute("aria-label", "Sidebar widgets");
        }
        const rt = getRuntime();
        const fallbackSidebar =
          typeof rt?.nativeSidebarElement === "function"
            ? rt.nativeSidebarElement()
            : null;
        const target = chooseWidgetMountTarget(
          document,
          window,
          fallbackSidebar,
        );
        if (!target?.parent) return tray;
        // Never move into or touch #zentral-video-preview.
        if (isVideoPlayerElement(target.parent)) return tray;
        const alreadyInPlace =
          tray.parentNode === target.parent &&
          tray.nextSibling === (target.before || null);
        if (!alreadyInPlace) {
          try {
            if (target.before && target.before.parentNode === target.parent) {
              target.parent.insertBefore(tray, target.before);
            } else {
              target.parent.appendChild(tray);
            }
          } catch (_) {}
        }
        attachSidebarObservers(target.parent);
        return tray;
      }

      function detachSidebarObservers() {
        try {
          resizeObserver?.disconnect();
        } catch (_) {}
        resizeObserver = null;
        try {
          hostMutationObserver?.disconnect();
        } catch (_) {}
        hostMutationObserver = null;
        observedHost = null;
        observedVideo = null;
      }

      function syncVideoResizeTarget() {
        if (!resizeObserver) return;
        const videoEl = document.getElementById?.(VIDEO_PLAYER_ID) || null;
        if (videoEl === observedVideo) return;
        if (observedVideo) {
          try {
            resizeObserver.unobserve?.(observedVideo);
          } catch (_) {}
        }
        observedVideo = videoEl;
        if (observedVideo) {
          try {
            resizeObserver.observe(observedVideo);
          } catch (_) {}
        }
      }

      function attachSidebarObservers(host) {
        if (disposed || !host || host === observedHost) {
          syncVideoResizeTarget();
          return;
        }
        detachSidebarObservers();
        observedHost = host;

        if (typeof ResizeObserver === "function") {
          try {
            resizeObserver = new ResizeObserver(() => {
              scheduleMeasure();
            });
            resizeObserver.observe(host);
            syncVideoResizeTarget();
          } catch (_) {
            resizeObserver = null;
          }
        }

        if (typeof MutationObserver === "function") {
          try {
            hostMutationObserver = new MutationObserver((records) => {
              let relevant = false;
              for (const rec of records) {
                // Ignore all mutations inside our own widget tray to prevent feedback loops.
                if (tray && (rec.target === tray || tray.contains?.(rec.target)))
                  continue;
                if (rec.type === "attributes") {
                  if (
                    isVideoPlayerElement(rec.target) ||
                    rec.target?.id === "zen-media-controls-toolbar" ||
                    rec.target?.id === "zen-essentials-container" ||
                    rec.target?.id === "zen-sidebar-bottom-buttons" ||
                    rec.target?.id === "vertical-tabs" ||
                    rec.target?.id === "tabbrowser-tabs"
                  ) {
                    relevant = true;
                    break;
                  }
                } else if (rec.type === "childList") {
                  const changed = [
                    ...(rec.addedNodes || []),
                    ...(rec.removedNodes || []),
                  ];
                  if (changed.some((n) => n !== tray)) {
                    relevant = true;
                    break;
                  }
                }
              }
              if (relevant) {
                syncVideoResizeTarget();
                scheduleMeasure();
              }
            });
            hostMutationObserver.observe(host, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ["hidden", "style", "data-enlarged", "collapsed"],
            });
          } catch (_) {
            hostMutationObserver = null;
          }
        }
      }

      function buildCardWrapper(def, instance) {
        const card = document.createElement("section");
        card.className = "zw-card";
        card.setAttribute("data-zw-widget", def.id);
        card.setAttribute("aria-label", def.title || def.id);
        if (def.showHeader !== false && def.title) {
          const head = document.createElement("div");
          head.className = "zw-card-head";
          const label = document.createElement("span");
          label.className = "zw-card-title";
          label.textContent = def.title;
          head.appendChild(label);
          card.appendChild(head);
        }
        const body = document.createElement("div");
        body.className = "zw-card-body";
        if (instance?.element) body.appendChild(instance.element);
        card.appendChild(body);
        return { card, body };
      }

      function unmountWidgetCard(id) {
        scheduler.deactivate(id);
        const mounted = mountedCards.get(id);
        if (!mounted) return;
        mountedCards.delete(id);
        try {
          mounted.instance?.dispose?.();
        } catch (err) {
          console.warn("[ZentralWidgets] widget dispose failed:", id, err);
        }
        try {
          mounted.card.remove();
        } catch (_) {}
      }

      function sortedDefinitions() {
        return [...registry.values()].sort(
          (a, b) =>
            (Number(a.order) || 100) - (Number(b.order) || 100) ||
            a.id.localeCompare(b.id),
        );
      }

      function syncWidgetsAndLayout() {
        if (disposed) return lastArea;
        const config = readConfig();
        const defs = sortedDefinitions();
        const enabledDefs = config.enabled
          ? defs.filter((d) => isWidgetEnabled(d, config))
          : [];
        const enabledIds = new Set(enabledDefs.map((d) => d.id));

        // Unmount disabled or removed widgets first.
        for (const id of [...mountedCards.keys()]) {
          if (!enabledIds.has(id)) unmountWidgetCard(id);
        }

        if (config.enabled) {
          ensureTray();
        } else if (tray) {
          tray.hidden = true;
          tray.setAttribute("data-zw-reason", "disabled");
        }

        const rt = getRuntime();
        const fallbackSidebar =
          typeof rt?.nativeSidebarElement === "function"
            ? rt.nativeSidebarElement()
            : null;
        const metrics = measureSidebarMetrics(
          document,
          window,
          tray,
          fallbackSidebar,
        );
        const area = computeWidgetArea(metrics, {
          ...config,
          activeWidgetCount: enabledDefs.length,
        });
        lastArea = area;

        // Mount newly enabled widgets in deterministic sort order.
        if (config.enabled && tray) {
          for (const def of enabledDefs) {
            if (!mountedCards.has(def.id)) {
              let instance = null;
              try {
                instance =
                  typeof def.create === "function"
                    ? def.create({
                        id: def.id,
                        document,
                        window,
                        area,
                        getPref: getString,
                        getBool,
                        getInt,
                        requestRefresh: (opts) =>
                          scheduler.refresh(def.id, { force: true, area: lastArea, ...opts }),
                        getCachedValue: () => scheduler.getCached(def.id),
                        setCachedValue: (v) => scheduler.setCached(def.id, v),
                      })
                    : null;
              } catch (err) {
                console.warn("[ZentralWidgets] widget create failed:", def.id, err);
                continue;
              }
              if (!instance) continue;
              const { card, body } = buildCardWrapper(def, instance);
              mountedCards.set(def.id, { card, body, instance });
              tray.appendChild(card);
              scheduler.activate(def, instance, widgetIntervalMs(def), area);
            } else {
              // Ensure card stays in sorted order inside tray without unnecessary moves.
              const mounted = mountedCards.get(def.id);
              if (mounted.card.parentNode !== tray) {
                tray.appendChild(mounted.card);
              }
            }
          }
          // Reconcile DOM order among mounted cards only if out of order.
          let expectedIdx = 0;
          for (const def of enabledDefs) {
            const mounted = mountedCards.get(def.id);
            if (!mounted) continue;
            if (tray.children[expectedIdx] !== mounted.card) {
              tray.insertBefore(
                mounted.card,
                tray.children[expectedIdx] || null,
              );
            }
            expectedIdx++;
          }
        }

        // Apply layout budget & visibility without ever touching #zentral-video-preview.
        if (tray) {
          tray.hidden = !area.visible;
          tray.setAttribute("data-zw-reason", area.reason);
          tray.setAttribute("data-zw-density", area.density);
          tray.setAttribute(
            "data-zw-video-avoiding",
            area.videoPlayerVisible ? "true" : "false",
          );
          if (area.visible) {
            tray.style.setProperty("--zw-max-height", area.maxTrayHeight + "px");
            tray.style.setProperty("--zw-free-height", area.rawFreeHeight + "px");
          } else {
            tray.style.removeProperty("--zw-max-height");
            tray.style.removeProperty("--zw-free-height");
          }
        }

        // Pause or resume per-widget refresh timers.
        scheduler.setPaused(area.paused, area);

        if (area.visible) {
          for (const mounted of mountedCards.values()) {
            try {
              mounted.instance?.onAreaChange?.(area);
            } catch (_) {}
          }
        }

        return area;
      }

      function scheduleMeasure() {
        if (disposed) return;
        if (rafMeasure !== null) return;
        const raf =
          typeof window.requestAnimationFrame === "function"
            ? window.requestAnimationFrame.bind(window)
            : (fn) => window.setTimeout(fn, 16);
        rafMeasure = raf(() => {
          rafMeasure = null;
          if (!disposed) syncWidgetsAndLayout();
        });
      }

      function cancelScheduledMeasure() {
        if (rafMeasure === null) return;
        try {
          if (typeof window.cancelAnimationFrame === "function")
            window.cancelAnimationFrame(rafMeasure);
          else window.clearTimeout(rafMeasure);
        } catch (_) {}
        rafMeasure = null;
      }

      function registerWidget(def) {
        if (disposed) return false;
        const id = normalizeWidgetId(def?.id);
        if (!id || typeof def?.create !== "function")
          throw new Error("Invalid widget definition: need id and create()");
        const cleanDef = {
          ...def,
          id,
          title: def.title || id,
          order: Number.isFinite(Number(def.order)) ? Number(def.order) : 100,
        };
        if (registry.has(id)) unmountWidgetCard(id);
        registry.set(id, cleanDef);
        if (cleanDef.pref) {
          watchPref(cleanDef.pref, () => syncWidgetsAndLayout());
        }
        if (cleanDef.refreshPref) {
          watchPref(cleanDef.refreshPref, () => {
            if (mountedCards.has(id)) {
              scheduler.updateInterval(id, widgetIntervalMs(cleanDef), lastArea);
            }
          });
        }
        if (Array.isArray(cleanDef.watchPrefs)) {
          for (const wp of cleanDef.watchPrefs) {
            watchPref(wp, () => {
              if (mountedCards.has(id)) {
                scheduler.updateInterval(
                  id,
                  widgetIntervalMs(cleanDef),
                  lastArea,
                );
                scheduler.refresh(id, { force: true, area: lastArea });
              }
            });
          }
        }
        syncWidgetsAndLayout();
        return true;
      }

      function unregisterWidget(id) {
        const cleanId = normalizeWidgetId(id);
        if (!cleanId || !registry.has(cleanId)) return false;
        unmountWidgetCard(cleanId);
        registry.delete(cleanId);
        syncWidgetsAndLayout();
        return true;
      }

      function setWidgetEnabled(id, enabled) {
        const cleanId = normalizeWidgetId(id);
        if (!cleanId) return false;
        const def = registry.get(cleanId);
        const on = Boolean(enabled);
        const disabled = parseDisabledIds(
          getString(WIDGET_PREFS.DISABLED_IDS, ""),
        );
        if (def?.pref) {
          try {
            Services.prefs.setBoolPref(def.pref, on);
          } catch (_) {}
          if (on && disabled.delete(cleanId)) {
            try {
              Services.prefs.setStringPref(
                WIDGET_PREFS.DISABLED_IDS,
                serializeDisabledIds(disabled),
              );
            } catch (_) {}
          }
        } else {
          if (on) disabled.delete(cleanId);
          else disabled.add(cleanId);
          try {
            Services.prefs.setStringPref(
              WIDGET_PREFS.DISABLED_IDS,
              serializeDisabledIds(disabled),
            );
          } catch (_) {}
        }
        syncWidgetsAndLayout();
        return true;
      }

      function listWidgets() {
        const config = readConfig();
        return sortedDefinitions().map((def) => ({
          id: def.id,
          title: def.title,
          order: def.order,
          pref: def.pref || null,
          refreshPref: def.refreshPref || null,
          refreshMs: widgetIntervalMs(def),
          enabled: isWidgetEnabled(def, config),
          mounted: mountedCards.has(def.id),
          cached: scheduler.getCached(def.id),
        }));
      }

      // ---- Event & pref wiring (no permanent polling) ----

      const onShellPref = () => syncWidgetsAndLayout();
      for (const pref of [
        WIDGET_PREFS.ENABLED,
        WIDGET_PREFS.MAX_HEIGHT_SHARE,
        WIDGET_PREFS.MIN_FREE_HEIGHT,
        WIDGET_PREFS.MIN_SIDEBAR_WIDTH,
        WIDGET_PREFS.TABS_RESERVE_PX,
        WIDGET_PREFS.PAUSE_WHEN_HIDDEN,
        WIDGET_PREFS.DISABLED_IDS,
      ]) {
        watchPref(pref, onShellPref);
      }

      // ---- Built-in widgets: Clock & Date (T3.9b) ----

      function readClockOpts() {
        return {
          format: cleanClockFormat(
            getString(WIDGET_PREFS.CLOCK_FORMAT, "auto"),
          ),
          showSeconds: getBool(WIDGET_PREFS.CLOCK_SHOW_SECONDS, false),
          showZone: getBool(WIDGET_PREFS.CLOCK_SHOW_ZONE, false),
        };
      }

      function readDateOpts() {
        return {
          format: cleanDateFormat(
            getString(WIDGET_PREFS.DATE_FORMAT, "long"),
          ),
          showYear: getBool(WIDGET_PREFS.DATE_SHOW_YEAR, false),
          showWeekNumber: getBool(WIDGET_PREFS.DATE_SHOW_WEEK, false),
        };
      }

      registerWidget({
        id: "clock",
        title: "Clock",
        showHeader: false,
        order: 10,
        pref: WIDGET_PREFS.CLOCK_ENABLED,
        defaultEnabled: true,
        watchPrefs: [
          WIDGET_PREFS.CLOCK_FORMAT,
          WIDGET_PREFS.CLOCK_SHOW_SECONDS,
          WIDGET_PREFS.CLOCK_SHOW_ZONE,
        ],
        resolveIntervalMs: () =>
          getBool(WIDGET_PREFS.CLOCK_SHOW_SECONDS, false) ? 1000 : 60000,
        create({ document: doc }) {
          const wrap = doc.createElement("div");
          wrap.className = "zw-clock";

          const main = doc.createElement("div");
          main.className = "zw-clock-main";
          const timeEl = doc.createElement("span");
          timeEl.className = "zw-clock-time";
          const secEl = doc.createElement("span");
          secEl.className = "zw-clock-seconds";
          secEl.hidden = true;
          const merEl = doc.createElement("span");
          merEl.className = "zw-clock-meridiem";
          merEl.hidden = true;
          main.appendChild(timeEl);
          main.appendChild(secEl);
          main.appendChild(merEl);

          const zoneEl = doc.createElement("div");
          zoneEl.className = "zw-card-meta zw-clock-zone";
          zoneEl.hidden = true;

          wrap.appendChild(main);
          wrap.appendChild(zoneEl);

          return {
            element: wrap,
            fetch({ now }) {
              return formatClockParts(now, readClockOpts());
            },
            isStale(now, cached) {
              return isClockCacheStale(now, cached, readClockOpts());
            },
            nextDelayMs(now) {
              return nextClockDelayMs(now, readClockOpts().showSeconds);
            },
            render(value) {
              if (!value) return;
              timeEl.textContent = value.time || "";
              if (value.seconds) {
                secEl.textContent = ":" + value.seconds;
                secEl.hidden = false;
              } else {
                secEl.textContent = "";
                secEl.hidden = true;
              }
              if (value.meridiem) {
                merEl.textContent = value.meridiem;
                merEl.hidden = false;
              } else {
                merEl.textContent = "";
                merEl.hidden = true;
              }
              if (value.zoneLabel) {
                zoneEl.textContent = value.zoneLabel;
                zoneEl.hidden = false;
              } else {
                zoneEl.textContent = "";
                zoneEl.hidden = true;
              }
              wrap.setAttribute("data-zw-clock-key", value.key || "");
              wrap.setAttribute("aria-label", value.text || "Clock");
            },
          };
        },
      });

      registerWidget({
        id: "date",
        title: "Date",
        showHeader: false,
        order: 20,
        pref: WIDGET_PREFS.DATE_ENABLED,
        defaultEnabled: true,
        refreshMs: 86400000,
        watchPrefs: [
          WIDGET_PREFS.DATE_FORMAT,
          WIDGET_PREFS.DATE_SHOW_YEAR,
          WIDGET_PREFS.DATE_SHOW_WEEK,
        ],
        create({ document: doc }) {
          const wrap = doc.createElement("div");
          wrap.className = "zw-date";

          const badge = doc.createElement("div");
          badge.className = "zw-date-badge";
          badge.setAttribute("aria-hidden", "true");
          const badgeDow = doc.createElement("span");
          badgeDow.className = "zw-date-badge-dow";
          const badgeDay = doc.createElement("span");
          badgeDay.className = "zw-date-badge-day";
          badge.appendChild(badgeDow);
          badge.appendChild(badgeDay);

          const info = doc.createElement("div");
          info.className = "zw-date-info";
          const topRow = doc.createElement("div");
          topRow.className = "zw-date-top";
          const secondaryEl = doc.createElement("span");
          secondaryEl.className = "zw-date-secondary";
          const weekEl = doc.createElement("span");
          weekEl.className = "zw-date-week";
          weekEl.hidden = true;
          topRow.appendChild(secondaryEl);
          topRow.appendChild(weekEl);

          const primaryEl = doc.createElement("div");
          primaryEl.className = "zw-date-primary";

          info.appendChild(topRow);
          info.appendChild(primaryEl);

          wrap.appendChild(badge);
          wrap.appendChild(info);

          return {
            element: wrap,
            fetch({ now }) {
              return formatDateParts(now, readDateOpts());
            },
            isStale(now, cached) {
              return isDateCacheStale(now, cached, readDateOpts());
            },
            nextDelayMs(now) {
              return nextLocalMidnightDelayMs(now);
            },
            render(value) {
              if (!value) return;
              badgeDow.textContent = value.weekdayShort || "";
              badgeDay.textContent = value.dayNumber || "";
              secondaryEl.textContent = value.secondary || "";
              primaryEl.textContent = value.primary || "";
              if (value.weekBadge) {
                weekEl.textContent = value.weekBadge;
                weekEl.hidden = false;
              } else {
                weekEl.textContent = "";
                weekEl.hidden = true;
              }
              wrap.setAttribute("data-zw-date-key", value.key || "");
              wrap.setAttribute("aria-label", value.text || "Date");
            },
          };
        },
      });

      const onVisibilityOrResize = () => scheduleMeasure();
      const listen = (target, type, fn, opts) => {
        if (!target || typeof target.addEventListener !== "function") return;
        target.addEventListener(type, fn, opts);
        registerCleanup(() => {
          try {
            target.removeEventListener(type, fn, opts);
          } catch (_) {}
        });
      };

      listen(document, "visibilitychange", onVisibilityOrResize);
      listen(window, "sizemodechange", onVisibilityOrResize);
      listen(window, "resize", onVisibilityOrResize);
      listen(window, "zen-workspace-switched", onVisibilityOrResize);

      const tabContainer = window.gBrowser?.tabContainer;
      if (tabContainer) {
        for (const ev of [
          "TabOpen",
          "TabClose",
          "TabPinned",
          "TabUnpinned",
          "TabShow",
          "TabHide",
        ]) {
          listen(tabContainer, ev, onVisibilityOrResize);
        }
      }

      if (typeof MutationObserver === "function" && document.documentElement) {
        try {
          rootAttrObserver = new MutationObserver(() => scheduleMeasure());
          rootAttrObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: [
              "zen-compact-mode",
              "zen-sidebar-hidden",
              "zen-sidebar-expanded",
              "zen-compact-sidebar-visible",
              "zen-right-side",
              "zen-sidebar-right",
            ],
          });
          registerCleanup(() => {
            try {
              rootAttrObserver?.disconnect();
            } catch (_) {}
            rootAttrObserver = null;
          });
        } catch (_) {}
      }

      syncWidgetsAndLayout();

      const api = {
        core,
        registerWidget,
        unregisterWidget,
        listWidgets,
        isWidgetEnabled: (id) => {
          const def = registry.get(normalizeWidgetId(id));
          return isWidgetEnabled(def);
        },
        setWidgetEnabled,
        refreshWidget: (id, opts) =>
          scheduler.refresh(normalizeWidgetId(id), {
            force: true,
            area: lastArea,
            ...opts,
          }),
        refreshAll: () => {
          for (const id of mountedCards.keys()) {
            scheduler.refresh(id, { force: true, area: lastArea });
          }
        },
        getCachedValue: (id) => scheduler.getCached(normalizeWidgetId(id) || id),
        setCachedValue: (id, value, updatedAt) =>
          scheduler.setCached(normalizeWidgetId(id) || id, value, updatedAt),
        clearCache: (id) => scheduler.clearCache(id),
        getArea: () => ({ ...lastArea }),
        getTray: () => tray,
        isPaused: () => scheduler.isPaused(),
        activeTimerCount: () => scheduler.activeTimerCount(),
        remeasure: () => syncWidgetsAndLayout(),
        destroy() {
          if (disposed) return;
          disposed = true;
          cancelScheduledMeasure();
          unwatchAllPrefs();
          detachSidebarObservers();
          for (const id of [...mountedCards.keys()]) unmountWidgetCard(id);
          registry.clear();
          scheduler.destroy();
          if (tray) {
            try {
              tray.remove();
            } catch (_) {}
            tray = null;
          }
          cleanups
            .splice(0)
            .reverse()
            .forEach((fn) => {
              try {
                fn();
              } catch (_) {}
            });
          if (window.ZentralRuntime?.services?.widgets === api)
            delete window.ZentralRuntime.services.widgets;
          if (window.ZentralWidgets === api) delete window.ZentralWidgets;
          if (window.__zentralWidgetsTestSeam?.instance === api)
            delete window.__zentralWidgetsTestSeam.instance;
        },
      };

      if (window.ZentralRuntime?.services)
        window.ZentralRuntime.services.widgets = api;
      window.ZentralWidgets = api;
      if (window.__zentralWidgetsTestSeam) {
        window.__zentralWidgetsTestSeam.instance = api;
      }

      if (typeof lifecycle?.addCleanup === "function") {
        lifecycle.addCleanup(() => api.destroy());
      }
      window.addEventListener("unload", () => api.destroy(), { once: true });
      return () => api.destroy();
    }

    if (ZentralRuntime) ZentralRuntime.register({ id: "widgets", init: start });
    else standaloneReady(start);
  })();
})();
