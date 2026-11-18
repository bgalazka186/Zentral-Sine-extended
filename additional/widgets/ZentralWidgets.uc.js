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
    WEATHER_ENABLED: "zen.workspace.zentral.widgets.weather.enabled",
    WEATHER_PLACE: "zen.workspace.zentral.widgets.weather.place",
    WEATHER_LATITUDE: "zen.workspace.zentral.widgets.weather.latitude",
    WEATHER_LONGITUDE: "zen.workspace.zentral.widgets.weather.longitude",
    WEATHER_UNITS: "zen.workspace.zentral.widgets.weather.units",
    WEATHER_REFRESH_MINUTES: "zen.workspace.zentral.widgets.weather.refresh_minutes",
    WEATHER_PLACES: "zen.workspace.zentral.widgets.weather.places",
    TIMER_ENABLED: "zen.workspace.zentral.widgets.timer.enabled",
    TIMER_CLICK_STOPWATCH: "zen.workspace.zentral.widgets.timer.click_stopwatch",
    CLOCK_QUICK_NOTE: "zen.workspace.zentral.widgets.clock.quick_note",
    ORDER: "zen.workspace.zentral.widgets.order",
    APPEARANCE_BG: "zen.workspace.zentral.widgets.appearance.background",
    APPEARANCE_TEXT: "zen.workspace.zentral.widgets.appearance.text",
    // OW-56: one Clock card, two faces; and what a finished countdown does.
    CLOCK_MODE: "zen.workspace.zentral.widgets.clock.mode",
    TIMER_END_SOUND: "zen.workspace.zentral.widgets.timer.end_sound",
    TIMER_END_NOTICE: "zen.workspace.zentral.widgets.timer.end_notice",
    STATUS_ENABLED: "zen.workspace.zentral.widgets.status.enabled",
    STATUS_SHOW_BATTERY: "zen.workspace.zentral.widgets.status.show_battery",
    STATUS_SHOW_MEMORY: "zen.workspace.zentral.widgets.status.show_memory",
    // OW-64: one language for every widget. "auto" follows the Notes interface language, so the two never disagree
    // until the person says otherwise; anything else is their own choice and stays their own choice.
    LANGUAGE: "zen.workspace.zentral.widgets.language",
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
    // T3.9c: weather is off until a place is set; it only asks the network then.
    WEATHER_ENABLED: false,
    WEATHER_PLACE: "",
    WEATHER_LATITUDE: "",
    WEATHER_LONGITUDE: "",
    WEATHER_UNITS: "auto",
    WEATHER_REFRESH_MINUTES: 30,
    TIMER_ENABLED: true,
    TIMER_CLICK_STOPWATCH: true,
    CLOCK_QUICK_NOTE: true,
    ORDER: "",
    APPEARANCE_BG: "",
    APPEARANCE_TEXT: "",
    CLOCK_MODE: "clock",
    TIMER_END_SOUND: "beep",
    TIMER_END_NOTICE: "none",
    STATUS_ENABLED: false,
    STATUS_SHOW_BATTERY: true,
    STATUS_SHOW_MEMORY: true,
    LANGUAGE: "auto",
  });

  // ---- OW-64: one language for every widget ----------------------------------------------------------------
  // "auto" means "whatever Notes is set to", read at the moment a string is needed, so changing the Notes language
  // changes every widget that has not been told otherwise. An explicit choice is that person's choice and stays it.
  const WIDGET_LANGUAGES = Object.freeze(["auto", "en", "pl"]);
  // Lower-cased before the check: a pref is a person's text, and "PL" is not a different language from "pl".
  const cleanWidgetLanguage = (v) => {
    const value = String(v ?? "").trim().toLowerCase();
    return WIDGET_LANGUAGES.includes(value) ? value : "auto";
  };
  const NOTES_LANGUAGE_PREF = "zen.workspace.zentral.notes.language";
  // Every string a widget draws. Kept small on purpose: the widgets are a clock, a date, a weather line and a status
  // line, and everything here is a word a person sees.
  const WIDGET_STRINGS = Object.freeze({
    en: Object.freeze({
      "clock.title": "Clock",
      "date.title": "Date",
      "weather.title": "Weather",
      "status.title": "Status",
      "tray.label": "Sidebar widgets",
      "tray.move": "Move this widget",
      "tray.moveUp": "Move this widget up",
      "tray.moveDown": "Move this widget down",
      "tray.moved": "{title} moved to position {position} of {total}",
      "tray.moveHint": "Drag, or press Alt+Up / Alt+Down",
      "clock.aria": "Clock. Click for the timer.",
      "clock.ariaAlert": "Countdown finished. ",
      "timer.aria": "Timer {value}{kind}. Click for the clock.",
      "timer.kind.countdown": ", countdown",
      "timer.kind.stopwatch": ", stopwatch",
      "timer.kind.stopped": ", stopped",
      "timer.clickClock": " Click for the clock.",
      "timer.start": "Start",
      "timer.stop": "Stop",
      "timer.resume": "Resume",
      "timer.set": "Set",
      "timer.save": "Save",
      "timer.note": "Note",
      "timer.lap": "Lap",
      "timer.reset": "Reset",
      "timer.setTitle": "Start the countdown with the typed duration",
      "timer.fieldAria": "A duration for the timer, for example 5 min or 1:30",
      "timer.presetTitle": "Start a countdown of {value}",
      "timer.noteAria": "Write a quick note",
      "timer.noteSaveTitle": "Save this text as a note",
      "timer.countdownRunning": "Countdown running",
      "timer.stopwatchRunning": "Stopwatch running",
      "timer.stopTitle": "Stop the countdown",
      "timer.stopStopwatchTitle": "Stop the stopwatch",
      "timer.startStopwatchTitle": "Start the stopwatch",
      "status.noBattery": "no battery",
      "status.noBatteryTitle": "This machine has no battery the browser can read",
      "status.memoryUnavailable": "Memory usage is not available in this build",
      "status.memoryTitle": "Memory used by the browser",
    }),
    pl: Object.freeze({
      "clock.title": "Zegar",
      "date.title": "Data",
      "weather.title": "Pogoda",
      "status.title": "Stan",
      "tray.label": "Widgety panelu bocznego",
      "tray.move": "Przenieś ten widget",
      "tray.moveUp": "Przenieś ten widget wyżej",
      "tray.moveDown": "Przenieś ten widget niżej",
      "tray.moved": "{title} przeniesiono na pozycję {position} z {total}",
      "tray.moveHint": "Przeciągnij albo użyj Alt+góra / Alt+dół",
      "clock.aria": "Zegar. Kliknij, aby otworzyć minutnik.",
      "clock.ariaAlert": "Minutnik zakończony. ",
      "timer.aria": "Minutnik {value}{kind}. Kliknij, aby wrócić do zegara.",
      "timer.kind.countdown": ", odliczanie",
      "timer.kind.stopwatch": ", stoper",
      "timer.kind.stopped": ", zatrzymany",
      "timer.clickClock": " Kliknij, aby wrócić do zegara.",
      "timer.start": "Start",
      "timer.stop": "Stop",
      "timer.resume": "Wznów",
      "timer.set": "Ustaw",
      "timer.save": "Zapisz",
      "timer.note": "Notatka",
      "timer.lap": "Międzyczas",
      "timer.reset": "Wyzeruj",
      "timer.setTitle": "Uruchom odliczanie wpisanego czasu",
      "timer.fieldAria": "Czas minutnika, na przykład 5 min lub 1:30",
      "timer.presetTitle": "Uruchom odliczanie {value}",
      "timer.noteAria": "Napisz szybką notatkę",
      "timer.noteSaveTitle": "Zapisz ten tekst jako notatkę",
      "timer.countdownRunning": "Odliczanie trwa",
      "timer.stopwatchRunning": "Stoper działa",
      "timer.stopTitle": "Zatrzymaj odliczanie",
      "timer.stopStopwatchTitle": "Zatrzymaj stoper",
      "timer.startStopwatchTitle": "Uruchom stoper",
      "status.noBattery": "brak baterii",
      "status.noBatteryTitle": "Ten komputer nie ma baterii, którą przeglądarka potrafi odczytać",
      "status.memoryUnavailable": "Zużycie pamięci nie jest dostępne w tej wersji",
      "status.memoryTitle": "Pamięć zużywana przez przeglądarkę",
    }),
  });
  // What the widgets are really set to right now. `notesRaw` is the Notes language as read from its pref; the caller
  // passes it in so this stays a pure function.
  function resolveWidgetLanguage(setting, notesRaw) {
    const chosen = cleanWidgetLanguage(setting);
    if (chosen !== "auto") return chosen;
    return String(notesRaw ?? "").toLowerCase().startsWith("pl") ? "pl" : "en";
  }
  // A string with {placeholders}. A missing key falls back to English and then to the key itself, so a half-finished
  // translation can never draw an empty button.
  function widgetText(lang, key, params = null) {
    const code = WIDGET_STRINGS[lang] ? lang : "en";
    let text = WIDGET_STRINGS[code][key];
    if (text === undefined) text = WIDGET_STRINGS.en[key];
    if (text === undefined) return String(key);
    if (params && typeof params === "object")
      text = text.replace(/\{([a-z]+)\}/gi, (all, name) => (Object.hasOwn(params, name) ? String(params[name]) : all));
    return text;
  }

  const CLOCK_FORMATS = Object.freeze(["auto", "24h", "12h"]);
  const DATE_FORMATS = Object.freeze(["long", "short", "iso"]);
  const WEATHER_UNITS = Object.freeze(["auto", "metric", "imperial"]);
  const WEATHER_REFRESH_MIN = 15;
  const WEATHER_REFRESH_MAX = 180;
  // The one host the weather widget talks to. Open-Meteo needs no key and no account, which keeps the widget
  // inside the "no cloud inside the mod" rule: nothing is synced, one place name goes out per refresh.
  const WEATHER_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
  // A week is what the card needs: today, tomorrow, and the first day that looks wet. One request, same host.
  const WEATHER_FORECAST_DAYS = 7;
  const WET_ICON_GROUPS = Object.freeze(["rain", "snow", "sleet", "storm", "drizzle"]);

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
  const CALENDAR_OPENER_SYM = Symbol.for("zentral/notes-calendar-opener/v1");
  const CALENDAR_AVAILABILITY_EVENT = "zentral-notes-calendar-availability";
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

  // OW-71: the order the person chose, applied to whatever widgets exist. Three promises, in this order:
  //   1. the stored ids that still exist come first, in the stored order;
  //   2. an id nobody recognises is dropped silently (a widget was removed; that is not the person's mistake);
  //   3. every widget NOT in the stored list follows, in its own default order — so a new widget appears without the
  //      person having to re-order anything, and nothing is ever lost from the tray.
  const cleanWidgetOrder = (raw) => {
    const out = [];
    if (typeof raw !== "string") return out;
    for (const part of raw.split(/[\s,;]+/)) {
      const id = normalizeWidgetId(part);
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  };
  // `defs` is every enabled definition in its DEFAULT order.
  function orderedByIds(defs, orderIds) {
    const list = Array.isArray(defs) ? defs : [];
    const wanted = Array.isArray(orderIds) ? orderIds : [];
    const byId = new Map(list.map((d) => [d.id, d]));
    const out = [];
    for (const id of wanted) {
      const def = byId.get(id);
      if (def && !out.includes(def)) out.push(def);
    }
    for (const def of list) if (!out.includes(def)) out.push(def);
    return out;
  }
  // The stored order after moving `id` one place in `dir` (-1 up, +1 down), among the ids that exist right now.
  function moveInOrder(ids, id, dir, existing) {
    const list = (Array.isArray(ids) ? ids : []).filter((x) => !existing || existing.includes(x));
    const at = list.indexOf(id);
    if (at < 0) return list;
    const to = at + (dir < 0 ? -1 : 1);
    if (to < 0 || to >= list.length) return list;
    const next = list.slice();
    next.splice(at, 1);
    next.splice(to, 0, id);
    return next;
  }

  // OW-72: the colours a person may pick. "" means "follow the theme", which is the default and writes nothing at all.
  // Anything stored is normalised to lowercase #rrggbb, so a half-typed value can never reach the stylesheet.
  const THEME_COLOR = /^#[0-9a-f]{6}$/;
  function cleanWidgetColor(raw) {
    const v = String(raw ?? "").trim().toLowerCase();
    if (!v) return "";
    if (/^#[0-9a-f]{3}$/.test(v)) return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    if (THEME_COLOR.test(v)) return v;
    // A named colour is accepted only when the platform can parse it (rgb/name/hsl all come back as rgb()).
    return "";
  }
  function parseWidgetColor(raw) {
    const v = String(raw ?? "").trim().toLowerCase();
    if (!v) return null;
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(v)) {
      const hex = v.length === 4 ? "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3] : v;
      return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
    }
    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
    if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
    return null;
  }
  // WCAG relative luminance and contrast ratio: the honest test of "is this readable", not a guess about "light" or
  // "dark". AA for normal text is 4.5:1.
  function relativeLuminance(c) {
    const ch = [c.r, c.g, c.b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  // What the person chose, as CSS custom properties for the tray. An unreadable pair is REFUSED here (not written and
  // then complained about), so the cards can never end up invisible; the caller decides whether to say why.
  const CONTRAST_MIN = 4.5;
  function widgetAppearanceVars(bgRaw, textRaw) {
    const bg = cleanWidgetColor(bgRaw);
    const text = cleanWidgetColor(textRaw);
    if (!bg && !text) return { vars: {}, readable: true, contrast: 0, refused: false };
    const refused =
      Boolean(bg && text) && contrastRatio(parseWidgetColor(bg), parseWidgetColor(text)) < CONTRAST_MIN;
    if (refused) return { vars: {}, readable: false, contrast: contrastRatio(parseWidgetColor(bg), parseWidgetColor(text)), refused: true };
    const vars = {};
    if (bg) vars["--zw-card-bg"] = bg;
    if (text) vars["--zw-card-text"] = text;
    const contrast = bg && text ? contrastRatio(parseWidgetColor(bg), parseWidgetColor(text)) : 0;
    return { vars, readable: true, contrast, refused: false };
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

  // A bounded LRU keeps Intl formatter construction out of the 1 Hz seconds path.
  const CLOCK_FORMATTER_CACHE_LIMIT = 24;
  const clockFormatterCache = new Map();
  function getClockDateTimeFormat(locale, options) {
    const key = JSON.stringify([locale || "", options || {}]);
    let formatter = clockFormatterCache.get(key);
    if (formatter) {
      clockFormatterCache.delete(key);
      clockFormatterCache.set(key, formatter);
      return formatter;
    }
    formatter = new Intl.DateTimeFormat(locale || undefined, options || {});
    clockFormatterCache.set(key, formatter);
    if (clockFormatterCache.size > CLOCK_FORMATTER_CACHE_LIMIT) {
      clockFormatterCache.delete(clockFormatterCache.keys().next().value);
    }
    return formatter;
  }
  function clearClockDateTimeFormatCache() {
    clockFormatterCache.clear();
  }

  function setClockTextIfChanged(element, rawValue) {
    if (!element) return false;
    const value = rawValue == null ? "" : String(rawValue);
    if (element.textContent === value) return false;
    element.textContent = value;
    return true;
  }
  function setClockHiddenIfChanged(element, hidden) {
    if (!element) return false;
    const value = Boolean(hidden);
    if (Boolean(element.hidden) === value) return false;
    element.hidden = value;
    return true;
  }
  function setClockAttributeIfChanged(element, name, rawValue) {
    if (!element || typeof element.setAttribute !== "function") return false;
    const value = String(rawValue == null ? "" : rawValue);
    if (element.getAttribute?.(name) === value) return false;
    element.setAttribute(name, value);
    return true;
  }

  /**
   * Applies a clock snapshot without layout reads or redundant DOM writes.
   * The static presentation changes only when the minute or display options change;
   * on a steady 1 Hz tick, only the seconds text node is touched.
   */
  // `force` is the repaint path (OW-67): a card that is being shown again must be written even when the value looks
  // unchanged, because the DOM may have been emptied while the sidebar was folded. Without it the "nothing changed"
  // shortcut kept a blank clock blank forever — the owner's "sometimes it stays not rendered".
  function renderClockElements(elements, value, previousStaticKey = "", force = false) {
    if (!elements || !value) return previousStaticKey;
    const minuteKey = value.minuteKey || value.key || "";
    const staticKey = [
      minuteKey,
      value.time || "",
      value.meridiem || "",
      value.zoneLabel || "",
      value.format || "",
      value.showSeconds ? "1" : "0",
      value.showZone ? "1" : "0",
    ].join("\\u001f");
    if (force || staticKey !== previousStaticKey) {
      setClockTextIfChanged(elements.timeEl, value.time || "");
      setClockHiddenIfChanged(elements.secEl, !value.showSeconds);
      setClockTextIfChanged(elements.merEl, value.meridiem || "");
      setClockHiddenIfChanged(elements.merEl, !value.meridiem);
      setClockTextIfChanged(elements.zoneEl, value.zoneLabel || "");
      setClockHiddenIfChanged(elements.zoneEl, !value.zoneLabel);
      setClockAttributeIfChanged(elements.wrap, "data-zw-clock-key", minuteKey);
      // OW-56: the card labels itself for whichever face is up; the clock's own text only wins while the clock is up.
    if (elements.wrap?.getAttribute?.("data-zw-clock-face") !== "timer") {
      setClockAttributeIfChanged(
        elements.wrap,
        "aria-label",
        value.accessibleText || value.time || "Clock",
      );
    }
    }
    setClockTextIfChanged(
      elements.secEl,
      value.showSeconds && value.seconds ? ":" + value.seconds : "",
    );
    return staticKey;
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
        const fmt = getClockDateTimeFormat(locale || "en-US", {
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
      const parts = getClockDateTimeFormat(locale, intlOpts).formatToParts(d);
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
    const minuteKey = `${civil.year}-${pad2(civil.month)}-${pad2(civil.day)}T${pad2(civil.hour)}:${pad2(civil.minute)}`;
    const key = showSeconds ? `${minuteKey}:${pad2(civil.second)}` : minuteKey;

    return {
      time,
      hours,
      minutes,
      seconds: showSeconds ? seconds : "",
      meridiem,
      zoneLabel: showZone ? zoneLabel : "",
      text,
      accessibleText: meridiem ? `${time} ${meridiem}` : time,
      key,
      minuteKey,
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
    const tabs = resolveTabsHost(doc, win, null);

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

  function isFlexibleSpacerElement(el) {
    if (!el) return false;
    const tag = String(el.localName || el.tagName || "").toLowerCase();
    if (tag === "toolbarspring" || tag === "spacer") return true;
    return Boolean(el.classList?.contains?.("zen-workspace-empty-space"));
  }

  /**
   * Resolves the real visible tabs container inside the sidebar.
   * In Zen Browser, Firefox's legacy #vertical-tabs element still exists in the
   * DOM as a hidden 0x0 box (display: none) while Zen's live sidebar tabs live
   * inside #tabbrowser-tabs. Always prefer a visible, connected host inside
   * mountHost rather than blindly short-circuiting on a hidden #vertical-tabs.
   */
  function resolveTabsHost(doc, win, mountHost = null) {
    if (!doc || typeof doc.getElementById !== "function") return null;
    const candidates = [
      doc.getElementById("tabbrowser-tabs"),
      doc.getElementById("vertical-tabs"),
    ].filter(Boolean);
    if (!candidates.length) return null;

    if (mountHost) {
      for (const el of candidates) {
        if (
          (el === mountHost || mountHost.contains?.(el)) &&
          !isElementHidden(el, win)
        ) {
          const r = safeRect(el);
          if (!r || r.height > 0) return el;
        }
      }
    }
    for (const el of candidates) {
      if (!isElementHidden(el, win)) {
        const r = safeRect(el);
        if (!r || r.height > 0) return el;
      }
    }
    for (const el of candidates) {
      if (!isElementHidden(el, win)) return el;
    }
    return candidates[0];
  }

  function isRectHorizontallyInHost(rect, hostRect) {
    if (!rect || !hostRect || hostRect.width <= 0) return true;
    // Inactive Zen workspaces may be slid off-screen horizontally via scroll or
    // transform rather than display:none; ignore off-screen workspace elements.
    if (rect.width <= 0) return false;
    return rect.right > hostRect.left + 1 && rect.left < hostRect.right - 1;
  }

  function findActiveZenWorkspace(tabsHost, win, hostRect) {
    if (!tabsHost || typeof tabsHost.querySelectorAll !== "function")
      return null;
    let workspaces = [];
    try {
      workspaces = Array.from(
        tabsHost.querySelectorAll("zen-workspace, .zen-workspace-tabs-section"),
      ).filter((el) => String(el?.localName || el?.tagName || "").toLowerCase() === "zen-workspace");
    } catch (_) {
      workspaces = [];
    }
    if (!workspaces.length) return null;

    const explicit = workspaces.find(
      (ws) =>
        (ws.getAttribute?.("active") === "true" ||
          (ws.hasAttribute?.("active") && ws.getAttribute?.("active") !== "false")) &&
        !isElementHidden(ws, win),
    );
    if (explicit) return explicit;

    return (
      workspaces.find((ws) => {
        if (isElementHidden(ws, win)) return false;
        const r = safeRect(ws);
        return Boolean(r && r.height > 0 && isRectHorizontallyInHost(r, hostRect));
      }) || null
    );
  }

  function measureTabsContentHeight(tabsHost, win) {
    if (!tabsHost || isElementHidden(tabsHost, win)) return 0;
    const hostRect = safeRect(tabsHost);
    if (!hostRect) return 0;

    const activeWs = findActiveZenWorkspace(tabsHost, win, hostRect);
    const scopeRoot = activeWs || tabsHost;

    // Check overflow on tabsHost AND Zen's inner scroll wrappers (#zen-tabs-wrapper,
    // #tabbrowser-arrowscrollbox, active zen-workspace).
    let overflowHeight = 0;
    const scrollContainers = [tabsHost];
    if (typeof tabsHost.querySelectorAll === "function") {
      try {
        for (const sc of tabsHost.querySelectorAll(
          "#zen-tabs-wrapper, #tabbrowser-arrowscrollbox",
        )) {
          if (sc && !isElementHidden(sc, win)) scrollContainers.push(sc);
        }
      } catch (_) {}
    }
    if (activeWs && !scrollContainers.includes(activeWs)) {
      scrollContainers.push(activeWs);
    }
    for (const sc of scrollContainers) {
      const r = safeRect(sc);
      const cH = Number(sc.clientHeight) || r?.height || 0;
      const sH = Number(sc.scrollHeight) || 0;
      if (sH > cH + 1) {
        const scTop = r ? Math.max(0, r.top - hostRect.top) : 0;
        overflowHeight = Math.max(overflowHeight, Math.ceil(scTop + sH));
      }
    }

    // In Zen Browser, the active workspace renders a flex-grow spacer
    // (vbox.zen-workspace-empty-space) filling the exact unused space below tabs,
    // folders, and Essentials. When visible and non-overflowing,
    // (hostRect.height - emptySpace.height) equals the exact occupied height of
    // all tab chrome — and stays invariant before AND after the widget tray opens
    // (preventing shrink-then-hide oscillation).
    if (overflowHeight === 0 && typeof scopeRoot.querySelectorAll === "function") {
      let emptyNodes = [];
      try {
        emptyNodes = Array.from(
          scopeRoot.querySelectorAll(".zen-workspace-empty-space"),
        );
      } catch (_) {
        emptyNodes = [];
      }
      for (const emptyEl of emptyNodes) {
        if (!emptyEl || isElementHidden(emptyEl, win)) continue;
        const er = safeRect(emptyEl);
        if (!er || er.height <= 0) continue;
        if (!isRectHorizontallyInHost(er, hostRect)) continue;
        const occupied = Math.max(0, Math.ceil(hostRect.height - er.height));
        return occupied;
      }
    }

    let maxBottom = 0;
    const scrollTop = Number.isFinite(tabsHost.scrollTop)
      ? Math.max(0, tabsHost.scrollTop)
      : 0;

    // Inspect concrete visible tab/folder/action items so stretched flex wrappers
    // inside #tabbrowser-tabs / #vertical-tabs do not falsely consume all free space.
    let items = [];
    if (typeof scopeRoot.querySelectorAll === "function") {
      try {
        items = Array.from(
          scopeRoot.querySelectorAll(
            "tab, .tabbrowser-tab, zen-folder, #tabs-newtab-button, #vertical-tabs-newtab-button, .zen-workspace-pinned-tabs-section > *, .zen-workspace-normal-tabs-section > *, toolbarseparator",
          ),
        );
      } catch (_) {
        items = [];
      }
    }

    for (const item of items) {
      if (
        !item ||
        item === tabsHost ||
        isFlexibleSpacerElement(item) ||
        isElementHidden(item, win)
      )
        continue;
      const r = safeRect(item);
      if (!r || r.height <= 0) continue;
      if (!isRectHorizontallyInHost(r, hostRect)) continue;
      const bottom = r.bottom - hostRect.top + scrollTop;
      if (bottom > maxBottom) maxBottom = bottom;
    }

    if (overflowHeight > 0) {
      maxBottom = Math.max(maxBottom, overflowHeight);
    } else if (maxBottom === 0 && items.length === 0) {
      const attrH = Number(tabsHost.getAttribute?.("data-zw-tabs-height"));
      if (Number.isFinite(attrH) && attrH >= 0) maxBottom = attrH;
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

    const tabsHost = resolveTabsHost(doc, win, mountHost);

    let otherChromeHeight = 0;
    const children = mountHost.children ? Array.from(mountHost.children) : [];
    for (const child of children) {
      if (!child || child === tray || child === videoEl) continue;
      if (isFlexibleSpacerElement(child)) continue;
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
      if (typeof def.cacheKey === "function") {
        try {
          const custom = def.cacheKey();
          if (custom) return String(custom);
        } catch (_) {}
      }
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
        resumeAll(area);
      }
    }

    // OW-67: coming back into view always paints what is known, whether or not the pause setting changed. The bug the
    // owner reported ("sometimes it stays not rendered when its hidden in sidebar") was exactly this: with pausing
    // turned OFF the paused flag never moves, so a widget whose card was blanked while the sidebar was folded was
    // never painted again. A card the person cannot see must still be correct the moment it can be seen.
    function resumeAll(area) {
      for (const entry of entries.values()) {
        const painted = paintCached(entry, area);
        // A pure render-only widget has no fetched value to paint from, so it must be asked to draw itself: that is
        // the case the owner hit (the Clock has no `fetch`). A widget WITH a cache keeps the "fresh cache is painted,
        // not refetched" rule and only asks for a refresh when its value is actually stale.
        refresh(entry.def.id, { force: !painted && typeof entry.instance?.fetch !== "function", area });
      }
    }

    // OW-67, the other half: coming back into view when the widget was NEVER paused (the owner's setting). Nothing here
    // may fetch — a fetch while the sidebar is folded is what the setting asked us not to do — so this only repaints
    // what is already known, and asks a render-only widget to draw itself from its own state.
    function repaintAll(area) {
      for (const entry of entries.values()) {
        const painted = paintCached(entry, area);
        if (!painted && typeof entry.instance?.fetch !== "function") refresh(entry.def.id, { force: true, area });
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
      resumeAll,
      repaintAll,
      refresh,
      getCached,
      setCached,
      clearCache,
      isPaused: () => paused,
      activeTimerCount,
      destroy,
    };
  }

  // ---- T3.9e: battery and memory ------------------------------------------------------------------------------
  // Nothing here reads the machine: every helper takes the numbers the caller collected, so the card is a painter
  // and the reading can be tested without a battery.
  function batteryParts(info) {
    if (!info || typeof info !== "object") return null;
    const level = Number(info.level);
    const charging = Boolean(info.charging);
    if (!Number.isFinite(level)) return null;
    const percent = Math.round(Math.max(0, Math.min(1, level)) * 100);
    const state = charging ? "charging" : info.dischargingTime === Infinity || info.dischargingTime === 0 ? "plugged in" : "on battery";
    return {
      percent,
      charging,
      text: percent + "%",
      title: percent + "% — " + state,
      level: percent <= 10 ? "critical" : percent <= 25 ? "low" : "ok",
    };
  }

  // The chrome window has no `navigator.getBattery`; the platform owns the battery through the power manager
  // (`navigator.getBattery()` on a content window, `Services`' power service in the browser window). The reading is
  // normalised here once, so the card never has to know which one answered.
  function readBatteryInfo(source) {
    if (!source || typeof source !== "object") return null;
    const level = source.level;
    return {
      level: Number.isFinite(Number(level)) ? Number(level) : Number(source.percent) / 100,
      charging: Boolean(source.charging),
      dischargingTime: source.dischargingTime,
    };
  }

  // Two different kinds of "nothing": a desktop simply has no battery (quiet — the setting asked for a battery, there
  // is none), while a build that cannot report memory is a surprise worth one dash. Neither is ever drawn as 0%.
  function unavailableParts(opts = {}, batterySupported = true, memorySupported = true) {
    // OW-64: the words follow the widget language; the language comes in through `opts` so this stays pure.
    const lang = resolveWidgetLanguage(opts.language, opts.notesRaw);
    const out = [];
    if (opts.showMemory !== false && !memorySupported) {
      out.push({ kind: "memory", text: "\u2014", title: widgetText(lang, "status.memoryUnavailable"), level: "muted", unavailable: true });
    }
    // OW-70: a machine with no battery is a desktop, not a fault. The owner has one and saw a card that looked broken,
    // so "there is no battery" is now a TITLE only — the line itself stays empty rather than printing a complaint
    // nobody can act on. It still never draws 0%, and the fact is kept where it is useful (the tooltip).
    if (opts.showBattery !== false && !batterySupported && opts.showMemory === false) {
      out.push({ kind: "battery", text: "", title: widgetText(lang, "status.noBatteryTitle"), level: "muted", unavailable: true });
    }
    return out;
  }

  // "used / limit" from the two byte counts Firefox reports; a missing limit prints only what is used.
  // OW-70: the platform's memory counters do not all have one shape. `getMemoryUsage()` hands back
  // `{ usedSize, totalSize }` on some builds, `{ memorySize }` on others, and some callers pass a pair. One reader, so
  // the card cannot be broken by a shape it has not met — which is what the owner saw as "ram info doesnt work".
  function readMemoryUsage(raw) {
    if (!raw) return null;
    let used = NaN;
    let limit = NaN;
    if (Array.isArray(raw)) {
      used = Number(raw[0]);
      limit = Number(raw[1]);
    } else if (typeof raw === "object") {
      used = Number(raw.usedSize ?? raw.used ?? raw.memorySize ?? raw.usage);
      limit = Number(raw.totalSize ?? raw.total ?? raw.limit ?? raw.max);
    }
    if (!Number.isFinite(used) || used <= 0) return null;
    return { used, total: Number.isFinite(limit) && limit > 0 ? limit : 0 };
  }
  function memoryParts(usage, opts = {}) {
    if (!usage || typeof usage !== "object") return null;
    const used = Number(usage.usedSize ?? usage.used ?? usage.memorySize ?? usage.usage ?? (Array.isArray(usage) ? usage[0] : NaN));
    const limit = Number(usage.totalSize ?? usage.total ?? usage.limit ?? usage.max ?? (Array.isArray(usage) ? usage[1] : NaN));
    if (!Number.isFinite(used) || used <= 0) return null;
    const gb = (bytes) => Math.round((bytes / (1024 ** 3)) * 10) / 10;
    const hasLimit = Number.isFinite(limit) && limit > 0;
    const text = hasLimit ? gb(used) + " / " + gb(limit) + " GB" : gb(used) + " GB";
    return {
      usedBytes: used,
      limitBytes: hasLimit ? limit : 0,
      sharePercent: hasLimit ? Math.round((used / limit) * 100) : 0,
      text,
      title: widgetText(resolveWidgetLanguage(opts.language, opts.notesRaw), "status.memoryTitle"),
    };
  }

  // One line, only what the person asked for, in a stable order.
  function statusLineParts(opts = {}, battery, memory) {
    const out = [];
    if (opts.showBattery !== false) {
      const b = batteryParts(battery);
      if (b) out.push({ kind: "battery", text: b.text + (b.charging ? " \u26a1" : ""), title: b.title, level: b.level });
    }
    if (opts.showMemory !== false) {
      const m = memoryParts(memory, opts);
      if (m) out.push({ kind: "memory", text: m.text, title: m.title, level: m.sharePercent >= 90 ? "critical" : m.sharePercent >= 75 ? "low" : "ok" });
    }
    return out;
  }

  // The card's whole line: real readings first, and only when a half has no reading does its honest placeholder show.
  // One missing reading never removes the other, and a card with nothing readable still says so.
  function composeStatusParts(opts = {}, battery, memory, support = {}) {
    const real = statusLineParts(opts, battery, memory);
    // Only a half that has neither a reading nor a supported source is worth mentioning.
    const missing = unavailableParts(
      opts,
      support.battery !== false || Boolean(battery),
      support.memory !== false || Boolean(memory),
    ).filter((part) => !real.some((r) => r.kind === part.kind));
    return [...real, ...missing];
  }

  // Battery changes are events; memory is a reading, so it is refreshed on a slow interval through the scheduler.
  function nextStatusDelayMs(battery) {
    if (battery && battery.charging) return 60000;
    return 5 * 60000;
  }

  // ---- T3.9d: stopwatch, quick timer and quick note -----------------------------------------------------------
  // What a click on the Clock means. Pure, so the rule is testable and the card stays a painter:
  //  - the quick timer wins while a countdown it started is running (a second click stops it);
  //  - otherwise a plain click starts the stopwatch, or stops it when it runs;
  //  - a long press (or the widget's own button) opens the "in X seconds" sheet instead.
  function resolveClockClick(opts = {}) {
    const enabled = Boolean(opts.clickEnabled);
    const timerRunning = Boolean(opts.timerRunning);
    const stopwatchRunning = Boolean(opts.stopwatchRunning);
    const long = Boolean(opts.long);
    if (!enabled) return { action: "none" };
    if (timerRunning) return { action: "timer-stop" };
    if (long) return { action: "ask-duration" };
    return { action: stopwatchRunning ? "stopwatch-stop" : "stopwatch-start" };
  }

  // OW-49: the Clock is the only visible surface. A click on it opens one small panel; that panel is the whole timer
  // UI. The rule is pure so the layout can be tested without a sidebar:
  //   idle clock + click -> open the panel (and start nothing by itself)
  //   panel open  + click -> close it, unless a countdown is running (then the click stops the countdown)
  //   running countdown, panel closed -> the clock line carries the time, so a running timer is never invisible.
  function resolveClockPanelState(opts = {}) {
    const open = Boolean(opts.open);
    if (opts.timerRunning) return { action: "stop-timer", open };
    if (open) return { action: "close", open: false };
    return { action: "open", open: true };
  }

  // OW-56: one card with two faces. The mode is a setting (`clock` | `timer`), and a click on the card turns it over.
  // A person who turned the Clock click off keeps the setting as the only way to change it (the click answers
  // "none"), which is the promise TIMER_CLICK_STOPWATCH always made.
  const WIDGET_MODES = Object.freeze(["clock", "timer"]);
  function cleanWidgetMode(raw) {
    const mode = String(raw ?? "").trim().toLowerCase();
    return WIDGET_MODES.includes(mode) ? mode : "clock";
  }
  // `event`: "click" (the card is turned over), or anything else (a setting change) which never flips it.
  function nextWidgetMode(mode, event, opts = {}) {
    const current = cleanWidgetMode(mode);
    if (event !== "click") return current;
    if (opts.clickEnabled === false) return current;
    return current === "clock" ? "timer" : "clock";
  }

  // OW-56: what a finished countdown does. Two independent choices, one alert per end:
  //   sound:  none | beep (the platform beep) | chime (a short two-note tone through WebAudio, the reminder path)
  //   notice: none | toast (a line in the window) | system (Services.alerts, when the platform has it)
  const TIMER_END_SOUNDS = Object.freeze(["none", "beep", "chime"]);
  const TIMER_END_NOTICES = Object.freeze(["none", "toast", "system"]);
  function cleanTimerEndSound(raw) {
    const v = String(raw ?? "").trim().toLowerCase();
    return TIMER_END_SOUNDS.includes(v) ? v : "beep";
  }
  function cleanTimerEndNotice(raw) {
    const v = String(raw ?? "").trim().toLowerCase();
    return TIMER_END_NOTICES.includes(v) ? v : "none";
  }
  // Every question a finished countdown asks, answered once: what to play, what to show, and whether the clock turns
  // red. `alreadyRung` is the guard that makes a second tick (or a second window event) silent, the same rule H1.5
  // applies to reminders: one end, one alert.
  function timerEndPlan(opts = {}) {
    const sound = cleanTimerEndSound(opts.sound);
    const notice = cleanTimerEndNotice(opts.notice);
    const alreadyRung = Boolean(opts.alreadyRung);
    return {
      sound: alreadyRung ? "none" : sound,
      notice: alreadyRung ? "none" : notice,
      markClock: !alreadyRung,
      text: String(opts.text ?? "").trim() || "Time is up",
    };
  }

  // OW-56: the clock's face while a countdown has ended and nobody has looked at it yet. The state is a flag on the
  // card (per window, per run): a finished countdown is a moment, not a setting, so nothing is stored.
  function clockAlertState(state = {}, opts = {}) {
    const ringing = Boolean(state.ringing);
    if (opts.clicked) return { ringing: false, tone: "none" };
    return { ringing, tone: ringing ? "alert" : "none" };
  }

  // What the panel's own buttons are, in the order they are drawn. Deliberately few: one primary button, a lap button
  // that exists only while the stopwatch runs, and a reset that is disabled when there is nothing to reset.
  function clockPanelControls(state = {}, opts = {}) {
    const timer = state.timer;
    const stopwatch = state.stopwatch;
    const usingTimer = Boolean(timer && (timer.running || (timer.remainingMs > 0 && timer.remainingMs < timer.durationMs)));
    const primary = usingTimer
      ? timer.running ? "Stop" : "Resume"
      : stopwatch && stopwatch.running ? "Stop" : "Start";
    return {
      primary,
      lap: Boolean(stopwatch && stopwatch.running),
      reset: Boolean((stopwatch && (stopwatch.running || stopwatch.accumulatedMs > 0)) || usingTimer),
      field: !usingTimer, // while a countdown runs the readout replaces the field, not sits next to it
      presets: Boolean(opts.wide) && !usingTimer,
      note: Boolean(opts.quickNote),
      controls: ["primary", ...(stopwatch && stopwatch.running ? ["lap"] : []), ...((stopwatch && (stopwatch.running || stopwatch.accumulatedMs > 0)) || usingTimer ? ["reset"] : [])],
    };
  }

  // What the Clock line shows while the panel is closed: a running countdown, then a running stopwatch, then nothing.
  function clockBadge(state = {}, nowMs = 0) {
    const timer = state.timer;
    const stopwatch = state.stopwatch;
    if (timer && timer.running) return { kind: "countdown", text: formatDuration(timerRemaining(timer, nowMs)) };
    if (stopwatch && stopwatch.running) return { kind: "stopwatch", text: formatDuration(stopwatchElapsed(stopwatch, nowMs)) };
    return { kind: "none", text: "" };
  }

  // A quick timer from "in X": the duration is read with the same parser as the widget's own field.
  function quickTimerFromText(text, nowMs) {
    const ms = parseTimerDuration(text);
    return ms > 0 ? timerStart(ms, nowMs) : null;
  }

  // All three are pure state machines over a clock value the caller supplies: nothing in this part reads the wall
  // clock, so a suspended window catches up instead of drifting.
  const TIMER_PRESETS_MS = Object.freeze([60, 300, 600, 1800, 3600].map((s) => s * 1000));

  // "5", "5m", "2 min", "90s", "1h30", "1:30" -> milliseconds. Words in both languages the mod ships.
  function parseTimerDuration(text) {
    const raw = String(text ?? "").trim().toLowerCase();
    if (!raw) return 0;
    const clock = raw.match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/);
    if (clock) {
      const a = Number(clock[1]);
      const b = Number(clock[2]);
      const c = clock[3] === undefined ? null : Number(clock[3]);
      const seconds = c === null ? a * 60 + b : a * 3600 + b * 60 + c;
      return Math.max(0, Math.min(24 * 3600, seconds)) * 1000;
    }
    // Split at the unit letters first ("1h30" -> "1h", "30"), then read each piece on its own.
    const parts = raw.match(/\d+(?:[.,]\d+)?\s*(?:godz\w*|hours?|h|min\w*|minutes?|m|sec\w*|sek\w*|s)?/g);
    if (!parts) return 0;
    let total = 0;
    let sawHour = false;
    for (const part of parts) {
      const value = Number(part.replace(",", ".").replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(value)) continue;
      const unit = part.replace(/[0-9.,\s]+/g, "");
      // The unit decides the scale; the letters are matched whole, so "1h30" reads as an hour and thirty minutes.
      if (/^(h|godz\w*|hours?)$/.test(unit)) { total += value * 3600; sawHour = true; }
      else if (/^(m|min\w*|minutes?)$/.test(unit)) total += value * 60;
      // A bare number after an hour is minutes ("1h30"), otherwise seconds ("90" means ninety seconds).
      else if (sawHour) total += value * 60;
      else total += value;
    }
    return Math.max(0, Math.min(24 * 3600, total)) * 1000;
  }

  // 0:07 / 12:07 / 1:02:07 — an hour field only appears when there is an hour.
  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? h + ":" + pad2(m) + ":" + pad2(s) : m + ":" + pad2(s);
  }

  const STOPWATCH_IDLE = Object.freeze({ running: false, startedAt: 0, accumulatedMs: 0, laps: [] });

  function stopwatchElapsed(state, nowMs) {
    const acc = Number(state?.accumulatedMs) || 0;
    if (!state?.running) return Math.max(0, acc);
    return Math.max(0, acc + Math.max(0, Number(nowMs) - Number(state.startedAt || nowMs)));
  }

  function stopwatchStart(state, nowMs) {
    if (state?.running) return { ...state };
    return { running: true, startedAt: Number(nowMs) || 0, accumulatedMs: Number(state?.accumulatedMs) || 0, laps: [...(state?.laps || [])] };
  }

  function stopwatchStop(state, nowMs) {
    if (!state?.running) return { ...STOPWATCH_IDLE, accumulatedMs: Number(state?.accumulatedMs) || 0, laps: [...(state?.laps || [])] };
    return { running: false, startedAt: 0, accumulatedMs: stopwatchElapsed(state, nowMs), laps: [...(state.laps || [])] };
  }

  function stopwatchLap(state, nowMs) {
    if (!state?.running) return state;
    const at = stopwatchElapsed(state, nowMs);
    const laps = [...(state.laps || []), at];
    return { ...state, laps: laps.slice(-500) };
  }

  const stopwatchReset = () => ({ ...STOPWATCH_IDLE, laps: [] });

  // ---- countdown ("timer in X seconds/minutes", quick alarm) ----
  const TIMER_IDLE = Object.freeze({ running: false, endsAt: 0, remainingMs: 0, durationMs: 0, rung: false });

  function timerStart(durationMs, nowMs) {
    const span = Math.max(1000, Math.min(24 * 3600 * 1000, Math.round(Number(durationMs) || 0)));
    return { running: true, endsAt: Number(nowMs) + span, remainingMs: span, durationMs: span, rung: false };
  }
  function timerRemaining(state, nowMs) {
    if (!state?.running) return Math.max(0, Number(state?.remainingMs) || 0);
    return Math.max(0, Number(state.endsAt || 0) - Number(nowMs));
  }
  // The one place a timer decides it has finished: `rung` makes it fire exactly once, even across a sleep.
  function timerTick(state, nowMs) {
    if (!state?.running) return { state: { ...state }, finished: false };
    const left = timerRemaining(state, nowMs);
    if (left > 0) return { state, finished: false };
    if (state.rung) return { state, finished: false };
    return { state: { ...state, running: false, remainingMs: 0, rung: true }, finished: true };
  }
  // Stopping freezes what is left; the caller says when, so the value is the same on every machine.
  function timerStop(state, nowMs) {
    return {
      running: false,
      endsAt: 0,
      remainingMs: timerRemaining(state, nowMs ?? state?.endsAt ?? 0),
      durationMs: Number(state?.durationMs) || 0,
      rung: false,
    };
  }
  const timerReset = () => ({ ...TIMER_IDLE });

  // How long until the next visible change: a running timer ticks once a second only while it is on screen.
  function nextTimerTickDelayMs(state, nowMs) {
    if (!state?.running) return 0;
    const left = timerRemaining(state, nowMs);
    return left > 0 ? Math.min(1000, left) : 0;
  }

  // ---- T3.9c: weather (Open-Meteo, no key, one request per refresh) -------------------------------------------
  // WMO weather codes, as Open-Meteo reports them. The table is the whole vocabulary: a code nobody knows is drawn
  // as "unknown", never guessed.
  const WMO_CODES = Object.freeze({
    0: ["Clear sky", "sun", "Bezchmurnie"],
    1: ["Mainly clear", "sun", "Prawie bezchmurnie"],
    2: ["Partly cloudy", "cloud-sun", "Częściowe zachmurzenie"],
    3: ["Overcast", "cloud", "Zachmurzenie"],
    45: ["Fog", "fog", "Mgła"],
    48: ["Depositing rime fog", "fog", "Mgła osadzająca szadź"],
    51: ["Light drizzle", "drizzle", "Słaba mżawka"],
    53: ["Drizzle", "drizzle", "Mżawka"],
    55: ["Dense drizzle", "drizzle", "Gęsta mżawka"],
    56: ["Light freezing drizzle", "sleet", "Słaba marznąca mżawka"],
    57: ["Freezing drizzle", "sleet", "Marznąca mżawka"],
    61: ["Light rain", "rain", "Słaby deszcz"],
    63: ["Rain", "rain", "Deszcz"],
    65: ["Heavy rain", "rain", "Ulewny deszcz"],
    66: ["Light freezing rain", "sleet", "Słaby marznący deszcz"],
    67: ["Freezing rain", "sleet", "Marznący deszcz"],
    71: ["Light snow", "snow", "Słaby śnieg"],
    73: ["Snow", "snow", "Śnieg"],
    75: ["Heavy snow", "snow", "Intensywny śnieg"],
    77: ["Snow grains", "snow", "Ziarna śniegu"],
    80: ["Light showers", "rain", "Słabe przelotne opady"],
    81: ["Showers", "rain", "Przelotne opady"],
    82: ["Violent showers", "rain", "Gwałtowne przelotne opady"],
    85: ["Light snow showers", "snow", "Słabe opady śniegu"],
    86: ["Snow showers", "snow", "Opady śniegu"],
    95: ["Thunderstorm", "storm", "Burza"],
    96: ["Thunderstorm with hail", "storm", "Burza z gradem"],
    99: ["Heavy thunderstorm with hail", "storm", "Silna burza z gradem"],
  });

  // Plain text glyphs, not pictures: they follow the widget font and never load a remote asset.
  const WEATHER_ICON_GLYPHS = Object.freeze({
    sun: "\u2600",
    "cloud-sun": "\u26c5",
    cloud: "\u2601",
    fog: "\u2592",
    drizzle: "\u2614",
    rain: "\u2614",
    sleet: "\u2745",
    snow: "\u2744",
    storm: "\u26a1",
    unknown: "\u2601",
  });

  // OW-64: the description follows the widget language. `lang` defaults to English so a pure caller (and every test
  // written before this) keeps exactly the words it had.
  function weatherCodeInfo(code, lang = "en") {
    const entry = WMO_CODES[Math.round(Number(code))];
    if (!entry) return { code: -1, label: lang === "pl" ? "Nieznana" : "Unknown", icon: "unknown" };
    const label = lang === "pl" && entry[2] ? entry[2] : entry[0];
    return { code: Math.round(Number(code)), label, icon: entry[1] };
  }

  function cleanWeatherUnits(raw) {
    const value = String(raw ?? "").trim().toLowerCase();
    return WEATHER_UNITS.includes(value) ? value : "auto";
  }

  // Metric unless the place is in the United States (and the person did not choose): the setting is "auto".
  function resolveWeatherUnits(units, countryCode) {
    const chosen = cleanWeatherUnits(units);
    if (chosen !== "auto") return chosen;
    return String(countryCode || "").trim().toUpperCase() === "US" ? "imperial" : "metric";
  }

  function cleanRefreshMinutes(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULTS.WEATHER_REFRESH_MINUTES;
    return Math.round(Math.max(WEATHER_REFRESH_MIN, Math.min(WEATHER_REFRESH_MAX, n)));
  }

  // A place needs both numbers, in their real ranges: no request is made from half a place.
  function cleanWeatherPlace(latitude, longitude) {
    const rawLat = String(latitude ?? "").trim();
    const rawLon = String(longitude ?? "").trim();
    if (!rawLat || !rawLon) return null;
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    if (lat === 0 && lon === 0) return null; // the null island is never a place somebody chose
    return { latitude: Math.round(lat * 10000) / 10000, longitude: Math.round(lon * 10000) / 10000 };
  }

  // OW-57: up to three places, cycled by a click. One JSON pref holds the list; the old single place (name +
  // latitude + longitude) is migrated as the first entry, so a saved place is never lost. Each entry carries its own
  // id, which is what makes the cache key differ per place: the old place's numbers can never show for the new one.
  const WEATHER_PLACES_MAX = 3;
  const WEATHER_PLACE_NAME_MAX = 60;
  function cleanWeatherPlaceName(raw) {
    return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, WEATHER_PLACE_NAME_MAX);
  }
  function cleanWeatherPlaceId(raw, fallback) {
    const id = String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return id ? id.slice(0, 40) : fallback;
  }
  // `raw` is the stored JSON (string) or an already-parsed value. Returns [] for junk, at most three entries, each
  // { id, name, latitude, longitude } with a unique id. A entry without real numbers is dropped: no place, no request.
  function cleanWeatherPlaces(raw) {
    let value = raw;
    if (typeof raw === "string") {
      const text = raw.trim();
      if (!text) return [];
      try {
        value = JSON.parse(text);
      } catch (_) {
        return [];
      }
    }
    const list = Array.isArray(value) ? value : Array.isArray(value?.places) ? value.places : [];
    const out = [];
    const seen = new Set();
    for (const entry of list) {
      if (out.length >= WEATHER_PLACES_MAX) break;
      const named = cleanWeatherPlaceName(entry?.name);
      const place = cleanWeatherPlace(entry?.latitude, entry?.longitude);
      // A typed name with no numbers yet is still a place: the lookup fills it in. Nothing is requested from it.
      if (!place && !named) continue;
      const name = named || `${place.latitude}, ${place.longitude}`;
      let id = cleanWeatherPlaceId(entry?.id, "place-" + (out.length + 1));
      while (seen.has(id)) id += "-2";
      seen.add(id);
      out.push(place ? { id, name, latitude: place.latitude, longitude: place.longitude } : { id, name, latitude: null, longitude: null });
    }
    return out;
  }
  function serializeWeatherPlaces(list) {
    return JSON.stringify(cleanWeatherPlaces(list));
  }
  // The place that is showing: the one the person last cycled to, if it still exists, else the first ready one. An
  // entry whose name was typed but whose numbers are still being looked up is skipped: there is nothing to fetch yet.
  const weatherPlaceReady = (p) => Boolean(cleanWeatherPlace(p?.latitude, p?.longitude));
  function currentWeatherPlace(list, currentId) {
    const places = cleanWeatherPlaces(list);
    if (!places.length) return null;
    const ready = places.filter(weatherPlaceReady);
    const pool = ready.length ? ready : places;
    return pool.find((p) => p.id === currentId) || pool[0];
  }
  // A click moves to the next place and wraps; one place (or none) is a no-op that still answers a place or null.
  function nextWeatherPlace(list, currentId) {
    const places = cleanWeatherPlaces(list);
    if (!places.length) return null;
    const ready = places.filter(weatherPlaceReady);
    const pool = ready.length ? ready : places;
    const at = pool.findIndex((p) => p.id === currentId);
    if (at < 0) return pool[0];
    return pool[(at + 1) % pool.length];
  }
  // The old three prefs are one place: the reader for a build that has not migrated yet.
  function weatherPlacesFromLegacy(name, latitude, longitude) {
    const place = cleanWeatherPlace(latitude, longitude);
    if (!place) return [];
    return cleanWeatherPlaces([{ id: "place-1", name: cleanWeatherPlaceName(name) || `${place.latitude}, ${place.longitude}`, ...place }]);
  }
  // The cache key of the weather card: one entry per place, or the plain id when there is no place yet.
  function weatherCacheKeyFor(baseId, place) {
    const p = cleanWeatherPlace(place?.latitude, place?.longitude);
    return p ? `${baseId}:${p.latitude},${p.longitude}` : baseId;
  }

  function weatherRequestUrl(place, units) {
    const p = cleanWeatherPlace(place?.latitude, place?.longitude);
    if (!p) return "";
    const params = [
      "latitude=" + p.latitude,
      "longitude=" + p.longitude,
      "current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
      "daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_hours,snowfall_sum",
      "forecast_days=" + WEATHER_FORECAST_DAYS,
      "timeformat=unixtime",
      "timezone=auto",
      resolveWeatherUnits(units) === "imperial" ? "temperature_unit=fahrenheit&wind_speed_unit=mph" : "temperature_unit=celsius&wind_speed_unit=kmh",
    ];
    return WEATHER_ENDPOINT + "?" + params.join("&");
  }

  const roundWeather = (value, digits = 0) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const f = 10 ** digits;
    return Math.round(n * f) / f;
  };

  // A day is "wet" when its code says rain/snow/sleet/storm AND the numbers agree (hours of precipitation or a real
  // chance of it). A dry-looking code with 90% probability, or a wet code with zero hours and zero chance, is noise.
  function isWetDay(day) {
    if (!day || typeof day !== "object") return false;
    const info = weatherCodeInfo(day.code);
    if (!WET_ICON_GROUPS.includes(info.icon)) return false;
    const hours = Number(day.precipitationHours);
    const chance = Number(day.precipitationProbability);
    const snow = Number(day.snowfall);
    if (Number.isFinite(snow) && snow > 0) return true;
    if (Number.isFinite(hours) && hours > 0) return true;
    if (Number.isFinite(chance) && chance >= 40) return true;
    // The code alone still counts when the day reports nothing at all.
    return !Number.isFinite(hours) && !Number.isFinite(chance);
  }

  // The first wet day after today: { index, daysAhead, date, code, label, icon } or null for a dry week.
  function nextWetDay(days, fromIndex = 1, lang = "en") {
    if (!Array.isArray(days)) return null;
    for (let i = Math.max(0, fromIndex); i < days.length; i++) {
      const day = days[i];
      if (!isWetDay(day)) continue;
      const info = weatherCodeInfo(day.code, lang);
      return {
        index: i,
        daysAhead: i,
        date: day.date || "",
        code: info.code,
        label: info.label,
        icon: info.icon,
      };
    }
    return null;
  }

  // What the card's second line says. Wide: tomorrow plus the next wet day. Narrow: one of them, and a click swaps.
  // Pure, so the swap is testable without a sidebar.
  function weatherOutlookParts(week, opts = {}) {
    const days = Array.isArray(week) ? week : [];
    const labels = weatherUnitLabels(opts.units, opts.countryCode);
    const temp = (n) => (n == null ? "" : Math.round(n) + labels.temperature);
    const tomorrow = days[1] || null;
    const wet = nextWetDay(days, 1);
    // "tomorrow" itself counts as the next wet day; say so once, not twice.
    const wetIsTomorrow = Boolean(wet && wet.index === 1);
    const wetText = wet
      ? wetIsTomorrow
        ? "Rain tomorrow"
        : wet.daysAhead === 2
          ? "Rain in 2 days"
          : "Rain " + wet.label.toLowerCase() + " in " + wet.daysAhead + " days"
      : days.length > 1
        ? "No rain this week"
        : "";
    const tomorrowText = tomorrow
      ? "Tomorrow " + temp(tomorrow.high) + " / " + temp(tomorrow.low) + (tomorrow.icon && tomorrow.icon !== "sun" ? " " + tomorrow.icon : "")
      : "";
    // OW-54: the two halves are two lines, never one that a narrow card shortens. A whole answer that wraps onto a
    // second row is read at a glance; a fragment of it is not read at all.
    const lines = [tomorrowText, wetText].filter(Boolean);
    return {
      tomorrow: tomorrowText,
      wet: wetText,
      wetDay: wet ? { ...wet } : null,
      lines,
      // Kept for callers that want the old pair (and for an older card that swapped between them).
      faces: lines.slice(),
      text: lines.join(" \u00b7 "),
    };
  }

  // The response is reduced to what is drawn, once: the cache then holds a tiny object, not the raw payload.
  function readWeatherPayload(payload, units, lang = "en") {
    if (!payload || typeof payload !== "object") return null;
    const cur = payload.current;
    if (!cur || typeof cur !== "object") return null;
    const info = weatherCodeInfo(cur.weather_code, lang);
    const day = payload.daily || {};
    const high = Array.isArray(day.temperature_2m_max) ? roundWeather(day.temperature_2m_max[0]) : null;
    const low = Array.isArray(day.temperature_2m_min) ? roundWeather(day.temperature_2m_min[0]) : null;
    // A week, reduced to one small object per day: the cache must stay tiny, and a raw payload never reaches the card.
    const codes = Array.isArray(day.weather_code) ? day.weather_code : [];
    const highs = Array.isArray(day.temperature_2m_max) ? day.temperature_2m_max : [];
    const lows = Array.isArray(day.temperature_2m_min) ? day.temperature_2m_min : [];
    const chances = Array.isArray(day.precipitation_probability_max) ? day.precipitation_probability_max : [];
    const hours = Array.isArray(day.precipitation_hours) ? day.precipitation_hours : [];
    const snows = Array.isArray(day.snowfall_sum) ? day.snowfall_sum : [];
    const dates = Array.isArray(day.time) ? day.time : [];
    const week = codes.slice(0, WEATHER_FORECAST_DAYS).map((code, index) => ({
      code: weatherCodeInfo(code, lang).code,
      icon: weatherCodeInfo(code, lang).icon,
      label: weatherCodeInfo(code, lang).label,
      high: index < highs.length ? roundWeather(highs[index]) : null,
      low: index < lows.length ? roundWeather(lows[index]) : null,
      precipitationProbability: index < chances.length ? roundWeather(chances[index]) : null,
      precipitationHours: index < hours.length ? roundWeather(hours[index], 1) : null,
      snowfall: index < snows.length ? roundWeather(snows[index], 1) : null,
      date: index < dates.length ? String(dates[index]) : "",
    }));
    return {
      week,
      units: cleanWeatherUnits(units),
      temperature: roundWeather(cur.temperature_2m, 1),
      humidity: roundWeather(cur.relative_humidity_2m),
      wind: roundWeather(cur.wind_speed_10m, 1),
      code: info.code,
      label: info.label,
      icon: info.icon,
      high,
      low,
      countryCode: typeof payload.countryCode === "string" ? payload.countryCode : "",
      observedAt: Number.isFinite(Number(cur.time)) ? Number(cur.time) * 1000 : 0,
      timezone: typeof payload.timezone === "string" ? payload.timezone : "",
    };
  }

  // "auto" is settled by the country the geocoder reported; without one the metric world is assumed.
  function weatherUnitLabels(units, countryCode) {
    const imperial = resolveWeatherUnits(units, countryCode) === "imperial";
    return { temperature: imperial ? "\u00b0F" : "\u00b0C", wind: imperial ? "mph" : "km/h" };
  }

  // What the card says, as plain parts so the DOM code stays a dumb painter.
  function formatWeatherParts(value, units) {
    if (!value) return null;
    const labels = weatherUnitLabels(value.units, value.countryCode);
    const temp = value.temperature == null ? "\u2014" : Math.round(value.temperature) + labels.temperature;
    const range = value.high == null || value.low == null ? "" : Math.round(value.high) + "\u00b0 / " + Math.round(value.low) + "\u00b0";
    const details = [];
    if (value.wind != null) details.push(Math.round(value.wind) + " " + labels.wind);
    if (value.humidity != null) details.push(Math.round(value.humidity) + "%");
    return {
      temperature: temp,
      label: value.label || "Unknown",
      icon: value.icon || "unknown",
      range,
      details: details.join(" \u00b7 "),
      text: [temp, value.label || "Unknown", range, details.join(", ")].filter(Boolean).join(", "),
    };
  }

  // The cache is good for as long as the refresh interval; a value written by another setting set is not ours.
  function isWeatherCacheFresh(nowMs, cached, refreshMinutes) {
    if (!cached?.value) return false;
    const age = Number(nowMs) - Number(cached.updatedAt || 0);
    if (!Number.isFinite(age) || age < 0) return false;
    return age < cleanRefreshMinutes(refreshMinutes) * 60000;
  }

  // How far the next automatic refresh is: aligned to the refresh interval, never faster than a minute.
  function nextWeatherDelayMs(nowMs, refreshMinutes, updatedAt) {
    const span = cleanRefreshMinutes(refreshMinutes) * 60000;
    // A value written by this cycle (originAt) is fresh; only an older write shortens the wait.
    const written = Number(updatedAt);
    const since = Number.isFinite(written) && written > 0 && written >= Number(nowMs) - span ? Number(nowMs) - written : span;
    return Math.max(60000, span - Math.max(0, since));
  }

  // "Warsaw, Poland" is not geocoded behind the person's back: the settings dialog asks the same host once, and
  // this only picks the first usable hit.
  function readGeocodePayload(payload) {
    const hit = payload?.results?.[0];
    if (!hit) return null;
    const place = cleanWeatherPlace(hit.latitude, hit.longitude);
    if (!place) return null;
    const name = [hit.name, hit.admin1, hit.country].filter((x) => typeof x === "string" && x.trim()).join(", ");
    return { ...place, name, countryCode: typeof hit.country_code === "string" ? hit.country_code : "" };
  }

  function geocodeUrl(query) {
    const q = String(query ?? "").trim().slice(0, 80);
    if (!q) return "";
    return "https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" + encodeURIComponent(q);
  }

  function resolveCalendarOpener(win) {
    try {
      const opener = win?.[CALENDAR_OPENER_SYM];
      if (!opener || typeof opener.openCalendar !== "function") return null;
      if (typeof opener.isAvailable === "function" && !opener.isAvailable()) {
        return null;
      }
      return opener;
    } catch (_) {
      return null;
    }
  }

  const core = Object.freeze({
    WIDGET_PREFS,
    DEFAULTS,
    LIMITS,
    CLOCK_FORMATS,
    DATE_FORMATS,
    VIDEO_PLAYER_ID,
    TRAY_ID,
    CALENDAR_OPENER_SYM,
    CALENDAR_AVAILABILITY_EVENT,
    clampInt,
    normalizeWidgetId,
    parseDisabledIds,
    serializeDisabledIds,
    isVideoPlayerElement,
    resolveCalendarOpener,
    cleanClockFormat,
    cleanDateFormat,
    isoWeekNumber,
    getClockDateTimeFormat,
    clearClockDateTimeFormatCache,
    renderClockElements,
    formatClockParts,
    formatDateParts,
    nextClockDelayMs,
    nextLocalMidnightDelayMs,
    WMO_CODES,
    WEATHER_UNITS,
    WEATHER_ENDPOINT,
    WEATHER_REFRESH_MIN,
    WEATHER_REFRESH_MAX,
    weatherCodeInfo,
    cleanWeatherUnits,
    resolveWeatherUnits,
    cleanRefreshMinutes,
    cleanWeatherPlace,
    cleanWeatherPlaces,
    serializeWeatherPlaces,
    currentWeatherPlace,
    nextWeatherPlace,
    weatherPlaceReady,
    weatherPlacesFromLegacy,
    weatherCacheKeyFor,
    WEATHER_PLACES_MAX,
    weatherRequestUrl,
    readWeatherPayload,
    WEATHER_FORECAST_DAYS,
    isWetDay,
    nextWetDay,
    weatherOutlookParts,
    weatherUnitLabels,
    formatWeatherParts,
    isWeatherCacheFresh,
    nextWeatherDelayMs,
    readGeocodePayload,
    geocodeUrl,
    TIMER_PRESETS_MS,
    batteryParts,
    readMemoryUsage,
    cleanWidgetOrder,
    cleanWidgetColor, parseWidgetColor, contrastRatio, widgetAppearanceVars, CONTRAST_MIN,
    orderedByIds,
    moveInOrder,
    memoryParts,
    statusLineParts,
    composeStatusParts,
    readBatteryInfo,
    unavailableParts,
    nextStatusDelayMs,
    resolveClockClick,
    resolveClockPanelState,
    WIDGET_MODES,
    cleanWidgetMode,
    nextWidgetMode,
    TIMER_END_SOUNDS,
    TIMER_END_NOTICES,
    cleanTimerEndSound,
    cleanTimerEndNotice,
    timerEndPlan,
    clockAlertState,
    clockPanelControls,
    clockBadge,
    quickTimerFromText,
    parseTimerDuration,
    formatDuration,
    STOPWATCH_IDLE,
    TIMER_IDLE,
    stopwatchElapsed,
    stopwatchStart,
    stopwatchStop,
    stopwatchLap,
    stopwatchReset,
    timerStart,
    timerRemaining,
    timerTick,
    timerStop,
    timerReset,
    nextTimerTickDelayMs,
    isClockCacheStale,
    isDateCacheStale,
    resolveWidgetRefreshMs,
    computeWidgetArea,
    chooseWidgetMountTarget,
    resolveTabsHost,
    measureTabsContentHeight,
    measureSidebarMetrics,
    createWidgetScheduler,
    // OW-64: the language contract, so a test can prove the rule without a running panel.
    WIDGET_LANGUAGES,
    WIDGET_STRINGS,
    cleanWidgetLanguage,
    resolveWidgetLanguage,
    widgetText,
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

      // OW-64: the language every widget draws with, resolved once per draw. `auto` asks Notes at that moment, so a
      // change there shows up here without a restart.
      const widgetLang = () =>
        resolveWidgetLanguage(getString(WIDGET_PREFS.LANGUAGE, DEFAULTS.LANGUAGE), getString(NOTES_LANGUAGE_PREF, "en"));
      // One string, in that language. Read at call time, never cached: the same rule as the language itself.
      const tw = (key, params = null) => widgetText(widgetLang(), key, params);

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
      // OW-67: the previous "is the tray on screen" answer, so only a real transition repaints (never every measure).
      let wasVisible = false;

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
          tray.setAttribute("aria-label", tw("tray.label"));
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
                    rec.target?.id === "zen-essentials" ||
                    rec.target?.id === "zen-sidebar-bottom-buttons" ||
                    rec.target?.id === "vertical-tabs" ||
                    rec.target?.id === "tabbrowser-tabs" ||
                    String(rec.target?.localName || rec.target?.tagName || "").toLowerCase() ===
                      "zen-workspace"
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
              attributeFilter: [
                "hidden",
                "style",
                "data-enlarged",
                "collapsed",
                "active",
              ],
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
        // OW-71: the handle is part of every card, not of a widget's own drawing, so a widget cannot forget it. It is a
        // real button: draggable by pointer, and Alt+Up / Alt+Down work from it for anyone who cannot drag.
        const grip = document.createElement("button");
        grip.type = "button";
        grip.className = "zw-grip";
        grip.setAttribute("draggable", "true");
        grip.title = tw("tray.moveHint");
        grip.setAttribute("aria-label", tw("tray.move") + " — " + tw("tray.moveHint"));
        grip.textContent = "⋮⋮";
        card.appendChild(grip);
        card.setAttribute("data-zw-order-id", def.id);
        installCardReordering(def, card, grip);
        if (typeof instance?.onMountCard === "function") {
          try {
            instance.onMountCard(card);
          } catch (err) {
            console.warn("[ZentralWidgets] widget onMountCard failed:", def.id, err);
          }
        }
        return { card, body };
      }

      // OW-71: moving a card. Both doors (drag, and Alt+Arrow on the handle) write the SAME pref, through this one
      // function, so the two can never disagree about what the order is.
      let lastMovedId = "";
      function currentOrderIds() {
        return sortedDefinitions().map((d) => d.id);
      }
      function commitOrder(ids) {
        const existing = [...registry.keys()];
        const cleaned = ids.filter((id) => existing.includes(id));
        try {
          Services.prefs.setStringPref(WIDGET_PREFS.ORDER, cleaned.join(","));
        } catch (_) {}
        syncWidgetsAndLayout();
        announceMove();
      }
      // Say where the focused card went, for a person who cannot see the tray move.
      let liveRegion = null;
      function ensureLiveRegion() {
        if (liveRegion && liveRegion.isConnected !== false) return liveRegion;
        liveRegion = document.createElement("div");
        liveRegion.className = "zw-live";
        liveRegion.setAttribute("role", "status");
        liveRegion.setAttribute("aria-live", "polite");
        document.body?.appendChild?.(liveRegion);
        return liveRegion;
      }
      function announceMove() {
        const id = lastMovedId;
        if (!id) return;
        const ids = currentOrderIds();
        const at = ids.indexOf(id);
        const def = registry.get(id);
        const title = def?.title || id;
        const region = ensureLiveRegion();
        if (region) region.textContent = widgetText(widgetLang(), "tray.moved", { title, position: at + 1, total: ids.length });
      }
      function moveCard(id, dir) {
        const ids = currentOrderIds();
        const existing = [...registry.keys()];
        const next = moveInOrder(ids, id, dir, existing);
        if (next.join(",") === ids.join(",")) return false; // already at the edge: nothing moved, nothing written
        lastMovedId = id;
        commitOrder(next);
        return true;
      }
      function installCardReordering(def, card, grip) {
        let dragId = "";
        grip.addEventListener("click", (e) => {
          // A click on the handle must never reach the card's own click target (the Clock turns over on a click).
          e?.stopPropagation?.();
          e?.preventDefault?.();
          grip.focus?.({ preventScroll: true });
        });
        grip.addEventListener("keydown", (e) => {
          if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          e.preventDefault();
          e.stopPropagation();
          moveCard(def.id, e.key === "ArrowUp" ? -1 : 1);
        });
        grip.addEventListener("dragstart", (e) => {
          dragId = def.id;
          card.setAttribute("data-zw-dragging", "true");
          try {
            e?.dataTransfer?.setData?.("text/plain", def.id);
            if (e?.dataTransfer) e.dataTransfer.effectAllowed = "move";
          } catch (_) {}
        });
        grip.addEventListener("dragend", () => {
          dragId = "";
          card.removeAttribute("data-zw-dragging");
        });
        // The drop target is the CARD, not the handle: a person drops on the card they want to land on.
        card.addEventListener("dragover", (e) => {
          if (!dragId || dragId === def.id) return;
          e?.preventDefault?.();
        });
        card.addEventListener("drop", (e) => {
          if (!dragId || dragId === def.id) return;
          e?.preventDefault?.();
          const ids = currentOrderIds();
          const from = ids.indexOf(dragId);
          const to = ids.indexOf(def.id);
          if (from < 0 || to < 0) return;
          const next = ids.slice();
          next.splice(from, 1);
          next.splice(to, 0, dragId);
          lastMovedId = dragId;
          dragId = "";
          card.removeAttribute("data-zw-dragging");
          commitOrder(next);
        });
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
        const byDefault = [...registry.values()].sort(
          (a, b) =>
            (Number(a.order) || 100) - (Number(b.order) || 100) ||
            a.id.localeCompare(b.id),
        );
        // OW-71: the person's order wins where they have one; everything else keeps its default place.
        const chosen = cleanWidgetOrder(getString(WIDGET_PREFS.ORDER, DEFAULTS.ORDER));
        return chosen.length ? orderedByIds(byDefault, chosen) : byDefault;
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
                        getArea: () => ({ ...lastArea }),
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

        // OW-72: the look is written on the TRAY, once, so every card (and every future card) inherits it. Nothing is
        // written when both prefs are empty, which is what "follow the theme" means.
        if (tray) {
          const look = widgetAppearanceVars(
            getString(WIDGET_PREFS.APPEARANCE_BG, DEFAULTS.APPEARANCE_BG),
            getString(WIDGET_PREFS.APPEARANCE_TEXT, DEFAULTS.APPEARANCE_TEXT),
          );
          for (const name of ["--zw-card-bg", "--zw-card-text"]) tray.style.removeProperty(name);
          for (const [name, value] of Object.entries(look.vars)) tray.style.setProperty(name, value);
          tray.setAttribute("data-zw-look", look.refused ? "unreadable" : Object.keys(look.vars).length ? "custom" : "theme");
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
          // OW-67: a real hidden->visible transition repaints EVERY mounted card from its cache, whatever the pause
          // setting says. `setPaused` only runs when its flag moves, and with pausing turned off it never moves — so
          // this is the one place that can guarantee a card blanked while folded is whole again when it is shown.
          if (!wasVisible && !area.paused) scheduler.repaintAll(area);
          for (const mounted of mountedCards.values()) {
            try {
              mounted.instance?.onAreaChange?.(area);
            } catch (_) {}
          }
        }
        wasVisible = area.visible;

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

      // OW-60: the standalone Timer card is gone, but people have it switched on. That intent must not be lost: an
      // owner who had `timer.enabled` (or `"timer"` in disabled_ids) gets the Clock resting on its timer face, once.
      // The old pref is left alone rather than cleared — uninstalling this version must not silently change a setting.
      function adoptLegacyTimerCard() {
        try {
          const def = registry.get("clock");
          if (!def || !isWidgetEnabled(def)) return;
          const wasOn = getBool(WIDGET_PREFS.TIMER_ENABLED, DEFAULTS.TIMER_ENABLED);
          if (!wasOn) return;
          if (getString(WIDGET_PREFS.CLOCK_MODE, DEFAULTS.CLOCK_MODE) === "timer") return;
          writeStringPref(WIDGET_PREFS.CLOCK_MODE, "timer");
        } catch (_) {}
      }

      const onShellPref = () => syncWidgetsAndLayout();
      for (const pref of [
        WIDGET_PREFS.ENABLED,
        WIDGET_PREFS.MAX_HEIGHT_SHARE,
        WIDGET_PREFS.MIN_FREE_HEIGHT,
        WIDGET_PREFS.MIN_SIDEBAR_WIDTH,
        WIDGET_PREFS.TABS_RESERVE_PX,
        WIDGET_PREFS.PAUSE_WHEN_HIDDEN,
        WIDGET_PREFS.DISABLED_IDS,
        WIDGET_PREFS.ORDER,
        WIDGET_PREFS.APPEARANCE_BG,
        WIDGET_PREFS.APPEARANCE_TEXT,
      ]) {
        watchPref(pref, onShellPref);
      }

      adoptLegacyTimerCard();
      // One listener for the whole module: when Notes appears or leaves, the mounted Clock card re-checks its note chip.
      // It is registered with the module's own cleanups, so `destroy` removes it like every other shell listener.
      const onCalendarAvailability = () => {
        try { clockNoteSync?.(); } catch (_) {}
      };
      if (typeof window.addEventListener === "function") {
        window.addEventListener(CALENDAR_AVAILABILITY_EVENT, onCalendarAvailability);
        registerCleanup(() => window.removeEventListener(CALENDAR_AVAILABILITY_EVENT, onCalendarAvailability));
      }

      // ---- Built-in widgets: Clock & Date (T3.9b) ----

      // OW-56: the Clock card's own painter, registered by the clock widget so the timer can repaint the face it owns.
      let clockFacePainter = null;
      // OW-60: the badge element lives on the Clock card now. Declared here, ABOVE the card that assigns it — the OW-56
      // factory-order trap in reverse: a module-level hook must be declared before the factory that uses it runs.
      let clockBadgeElement = null;
      // OW-60: the Clock card's availability refresh, published here so exactly ONE window listener serves it.
      let clockNoteSync = null;
      // The ended-countdown flag lives here (per window, per run): the clock reads it, the timer sets it, a click clears
      // it. Nothing is written to prefs — a finished countdown is a moment, not a setting.
      const clockAlert = { ringing: false };

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

      // OW-57: which place is showing. Per-window state like the timer's: the place a person glanced at is not a
      // setting, and two windows may look at two places. -1 / a missing card means "the list decides" (first entry).
      const weatherView = { placeId: "", mounted: false };

      // The saved places. The JSON pref is the truth once it exists; a build that only ever had the three single
      // prefs reads them as one place, and the first read writes that place into the JSON pref so nothing is lost.
      function readWeatherPlaces() {
        const stored = cleanWeatherPlaces(getString(WIDGET_PREFS.WEATHER_PLACES, ""));
        if (stored.length) return stored;
        const legacy = weatherPlacesFromLegacy(
          getString(WIDGET_PREFS.WEATHER_PLACE, ""),
          getString(WIDGET_PREFS.WEATHER_LATITUDE, ""),
          getString(WIDGET_PREFS.WEATHER_LONGITUDE, ""),
        );
        if (legacy.length) {
          try {
            Services.prefs.setStringPref(WIDGET_PREFS.WEATHER_PLACES, serializeWeatherPlaces(legacy));
          } catch (_) {}
        }
        return legacy;
      }

      // T3.9c: everything the weather card needs, read once per refresh.
      function readWeatherOpts() {
        const places = readWeatherPlaces();
        const active = currentWeatherPlace(places, weatherView.placeId);
        return {
          places,
          placeId: active?.id || "",
          place: active?.name || "",
          place_: active ? cleanWeatherPlace(active.latitude, active.longitude) : null,
          units: cleanWeatherUnits(getString(WIDGET_PREFS.WEATHER_UNITS, "auto")),
          refreshMinutes: cleanRefreshMinutes(getInt(WIDGET_PREFS.WEATHER_REFRESH_MINUTES, DEFAULTS.WEATHER_REFRESH_MINUTES)),
        };
      }

      registerWidget({
        id: "clock",
        title: tw("clock.title"),
        showHeader: false,
        order: 10,
        pref: WIDGET_PREFS.CLOCK_ENABLED,
        defaultEnabled: true,
        watchPrefs: [
          WIDGET_PREFS.CLOCK_FORMAT,
          WIDGET_PREFS.CLOCK_SHOW_SECONDS,
          WIDGET_PREFS.CLOCK_SHOW_ZONE,
          WIDGET_PREFS.CLOCK_MODE,
          WIDGET_PREFS.CLOCK_QUICK_NOTE,
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
          // OW-49: while the timer panel is closed a running countdown still shows here, so it is never invisible.
          const badgeEl = doc.createElement("span");
          badgeEl.className = "zw-clock-badge";
          badgeEl.hidden = true;
          clockBadgeElement = badgeEl;
          let staticRenderKey = "";

          // OW-60: the second face is the whole stopwatch/countdown panel, not a readout. OW-56 drew the numbers here
          // but left every control on a second card, so the two faces did not replace each other at all. The parts are
          // the ones the old Timer card had (same classes, same pure helpers); the click still turns the card over and
          // the setting still says which face it rests on.
          const timerFace = doc.createElement("div");
          timerFace.className = "zw-clock-timer-face zw-timer";
          timerFace.hidden = true;

          const readout = doc.createElement("div");
          readout.className = "zw-timer-readout";
          const timerValueEl = doc.createElement("span");
          timerValueEl.className = "zw-timer-value zw-clock-timer-value";
          const timerKindEl = doc.createElement("span");
          timerKindEl.className = "zw-timer-mode zw-clock-timer-kind";
          readout.appendChild(timerValueEl);
          readout.appendChild(timerKindEl);

          const timerActions = doc.createElement("div");
          timerActions.className = "zw-timer-actions";
          const timerButtons = {};
          const mkTimerButton = (name, text, title) => {
            const b = doc.createElement("button");
            b.type = "button";
            b.className = "zw-timer-btn";
            b.textContent = text;
            b.title = title;
            b.setAttribute("aria-label", title);
            timerButtons[name] = b;
            timerActions.appendChild(b);
            return b;
          };
          const startBtn = mkTimerButton("start", tw("timer.start"), tw("timer.startStopwatchTitle"));
          const lapBtn = mkTimerButton("lap", tw("timer.lap"), tw("timer.lap"));
          const resetBtn = mkTimerButton("reset", tw("timer.reset"), tw("timer.reset"));

          // The same five durations the old card offered, as short chips.
          const presets = doc.createElement("div");
          presets.className = "zw-timer-presets";
          const CHIP_TEXT = ["1m", "5m", "10m", "30m", "1h"];
          const presetButtons = TIMER_PRESETS_MS.map((ms, index) => {
            const b = doc.createElement("button");
            b.type = "button";
            b.className = "zw-timer-preset";
            b.textContent = CHIP_TEXT[index] || formatDuration(ms);
            b.title = tw("timer.presetTitle", { value: formatDuration(ms) });
            b.setAttribute("aria-label", tw("timer.presetTitle", { value: formatDuration(ms) }));
            presets.appendChild(b);
            return { ms, button: b };
          });

          const fieldRow = doc.createElement("div");
          fieldRow.className = "zw-timer-field-row";
          const field = doc.createElement("input");
          field.type = "text";
          field.className = "zw-timer-field";
          field.placeholder = "in 5 min";
          field.setAttribute("aria-label", tw("timer.fieldAria"));
          field.spellcheck = false;
          const setBtn = doc.createElement("button");
          setBtn.type = "button";
          setBtn.className = "zw-timer-btn";
          setBtn.textContent = tw("timer.set");
          setBtn.title = tw("timer.setTitle");
          fieldRow.appendChild(field);
          fieldRow.appendChild(setBtn);

          const laps = doc.createElement("ol");
          laps.className = "zw-timer-laps";
          laps.hidden = true;

          timerFace.appendChild(readout);
          timerFace.appendChild(timerActions);
          timerFace.appendChild(presets);
          timerFace.appendChild(fieldRow);
          timerFace.appendChild(laps);

          // OW-60: the quick note is reachable from the CLOCK face, which is the owner's third complaint. It is the
          // same one opener channel (`openQuickNote`) the old card used, and it disappears entirely without Notes.
          const clockNoteRow = doc.createElement("div");
          clockNoteRow.className = "zw-clock-note-row";
          clockNoteRow.hidden = true;
          const clockNoteField = doc.createElement("input");
          clockNoteField.type = "text";
          clockNoteField.className = "zw-clock-note";
          clockNoteField.placeholder = "Quick note";
          clockNoteField.setAttribute("aria-label", tw("timer.noteAria"));
          clockNoteField.spellcheck = false;
          const clockNoteBtn = doc.createElement("button");
          clockNoteBtn.type = "button";
          clockNoteBtn.className = "zw-clock-note-btn";
          clockNoteBtn.textContent = tw("timer.save");
          clockNoteBtn.title = tw("timer.noteSaveTitle");
          clockNoteRow.appendChild(clockNoteField);
          clockNoteRow.appendChild(clockNoteBtn);
          const clockNoteChip = doc.createElement("button");
          clockNoteChip.type = "button";
          clockNoteChip.className = "zw-clock-chip zw-clock-note-chip";
          clockNoteChip.textContent = tw("timer.note");
          clockNoteChip.title = tw("timer.noteAria");
          clockNoteChip.setAttribute("aria-label", tw("timer.noteAria"));

          const modeHintEl = doc.createElement("div");
          modeHintEl.className = "zw-card-meta zw-clock-mode-hint";
          modeHintEl.hidden = true;

          // The owner's shape, in one place: the card is a column with a time area on top and the quick note under it.
          // The time area holds both faces — the clock and the stopwatch panel — and exactly one of them is shown, so
          // the note never moves: it is always directly under whichever time element is up.
          const timeCol = doc.createElement("div");
          timeCol.className = "zw-clock-time-col";
          timeCol.appendChild(main);
          timeCol.appendChild(timerFace);
          wrap.appendChild(timeCol);
          wrap.appendChild(badgeEl);
          wrap.appendChild(zoneEl);
          wrap.appendChild(clockNoteRow);
          wrap.appendChild(modeHintEl);
          presets.appendChild(clockNoteChip);

          // T3.9d: the Clock is also a shortcut. A plain click starts/stops the stopwatch, a long press (or a
          // right click) asks for "in X", and a click while a quick timer runs stops it. The rule itself lives in
          // resolveClockClick (pure); this block only feeds it what it cannot know.
          let longPressTimer = null;
          let longPressFired = false;
          const cancelLongPress = () => {
            if (longPressTimer !== null && typeof window.clearTimeout === "function") window.clearTimeout(longPressTimer);
            longPressTimer = null;
          };
          wrap.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            longPressFired = false;
            cancelLongPress();
            if (typeof window.setTimeout !== "function") return;
            longPressTimer = window.setTimeout(() => {
              longPressTimer = null;
              longPressFired = true;
              const kind = clockClickKind({ shiftKey: true });
              if (kind.action !== "none") clockClick(kind.action);
            }, 550);
          });
          wrap.addEventListener("pointerup", cancelLongPress);
          wrap.addEventListener("pointercancel", () => { cancelLongPress(); longPressFired = false; });
          wrap.addEventListener("pointerleave", cancelLongPress);
          wrap.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const kind = clockClickKind({ shiftKey: true });
            if (kind.action !== "none") clockClick(kind.action);
          });
          // OW-56: one click, one meaning. It turns the card over (the owner's request), and it is also the answer to
          // a finished countdown: the red numbers go back to their colour. The panel is still reachable — from the
          // timer face's own hint line and from a long press — but it no longer swallows the click.
          const flipFace = () => {
            const clickEnabled = getBool(WIDGET_PREFS.TIMER_CLICK_STOPWATCH, DEFAULTS.TIMER_CLICK_STOPWATCH);
            const next = nextWidgetMode(readMode(), "click", { clickEnabled });
            const acknowledged = clockAlert.ringing;
            if (acknowledged) clockAlert.ringing = false;
            if (next !== readMode()) writeStringPref(WIDGET_PREFS.CLOCK_MODE, next);
            paintFace();
            // The timer loop lives on this card now, so turning it over is enough to keep the countdown moving.
            paintFace();
            return { next, acknowledged };
          };

          // OW-56: which face is up, and the alert that a countdown ended while nobody was looking. `alert` is the
          // flag; it is cleared by a click, never by time.
          const faceState = { mode: "clock" };
          const readMode = () => cleanWidgetMode(getString(WIDGET_PREFS.CLOCK_MODE, DEFAULTS.CLOCK_MODE));
          // OW-60: one timer loop for the whole card, on the card that is actually always there. The old card owned a
          // timer of its own; this one is woken by the shared rule (`nextTimerTickDelayMs`) and only while something
          // moves, so a stopped clock still does no work.
          let pendingTick = null;
          const clearTick = () => {
            if (pendingTick !== null && typeof window.clearTimeout === "function") window.clearTimeout(pendingTick);
            pendingTick = null;
          };
          const nowMs = () => Date.now();

          const paintFace = () => {
            const mode = readMode();
            const alert = clockAlertState({ ringing: clockAlert.ringing }, {});
            const timerFaceUp = mode === "timer";
            main.hidden = timerFaceUp;
            zoneEl.hidden = timerFaceUp || !getBool(WIDGET_PREFS.CLOCK_SHOW_ZONE, false);
            timerFace.hidden = !timerFaceUp;
            wrap.setAttribute("data-zw-clock-face", mode);
            wrap.setAttribute("data-zw-clock-alert", alert.ringing ? "true" : "false");

            // The panel is drawn whatever the face is: the state it shows must be right the instant it is turned over,
            // and the Clock line's badge is read from it while the panel is hidden.
            const sw = timerState.stopwatch;
            const t = timerState.timer;
            const usingTimer = t.running || (t.remainingMs > 0 && t.remainingMs < t.durationMs);
            const value = usingTimer ? timerRemaining(t, nowMs()) : stopwatchElapsed(sw, nowMs());
            timerValueEl.textContent = formatDuration(value);
            const kindKey = usingTimer ? "timer.kind.countdown" : sw.running ? "timer.kind.stopwatch" : sw.accumulatedMs > 0 ? "timer.kind.stopped" : "";
            timerKindEl.textContent = kindKey ? tw(kindKey).replace(/^[, ]+/, "") : "";
            startBtn.textContent = usingTimer ? (t.running ? tw("timer.stop") : tw("timer.resume")) : sw.running ? tw("timer.stop") : tw("timer.start");
            startBtn.title = usingTimer ? tw("timer.stopTitle") : sw.running ? tw("timer.stopStopwatchTitle") : tw("timer.startStopwatchTitle");
            startBtn.setAttribute("aria-label", startBtn.title);
            // The face changes with the state instead of showing every control at once (OW-49's rule, kept).
            const wide = (() => {
              try {
                const width = getArea?.()?.width;
                return typeof width === "number" ? width >= 200 : true;
              } catch (_) {
                return true;
              }
            })();
            const controls = clockPanelControls(timerState, { wide, quickNote: true });
            lapBtn.hidden = !controls.lap;
            lapBtn.disabled = !sw.running;
            resetBtn.disabled = !controls.reset;
            fieldRow.hidden = !controls.field;
            presets.hidden = !controls.presets;
            laps.hidden = !sw.laps.length || !sw.running;
            if (sw.laps.length) {
              const doc2 = laps.ownerDocument || doc;
              laps.replaceChildren(...sw.laps.map((at, i) => {
                const li = doc2.createElement("li");
                li.textContent = "#" + (i + 1) + "  " + formatDuration(at);
                return li;
              }));
            }
            wrap.setAttribute("data-zw-timer", usingTimer ? (t.running ? "countdown" : "countdown-stopped") : sw.running ? "stopwatch" : "idle");
            // OW-49: a running countdown is readable on the Clock line while the panel is closed, so it is never invisible.
            const badge = clockBadge(timerState, nowMs());
            wrap.dataset.zwBadge = badge.text;
            if (clockBadgeElement) {
              clockBadgeElement.textContent = badge.text;
              clockBadgeElement.hidden = !badge.text;
              clockBadgeElement.setAttribute("data-zw-badge", badge.kind);
              if (badge.text) clockBadgeElement.title = badge.kind === "countdown" ? tw("timer.countdownRunning") : tw("timer.stopwatchRunning");
            }

            if (timerFaceUp) {
              wrap.setAttribute("aria-label", tw("timer.aria", { value: timerValueEl.textContent, kind: timerKindEl.textContent ? ", " + timerKindEl.textContent : "" }));
            } else {
              wrap.setAttribute("aria-label", (alert.ringing ? tw("clock.ariaAlert") : "") + tw("clock.aria"));
            }
            modeHintEl.hidden = true;

            // One wake-up at a time, and only while something moves.
            clearTick();
            const moving = usingTimer ? t.running : sw.running;
            if (moving && typeof window.setTimeout === "function") {
              const delay = usingTimer ? nextTimerTickDelayMs(t, nowMs()) : 1000;
              pendingTick = window.setTimeout(() => {
                pendingTick = null;
                const tick = usingTimer ? timerTick(timerState.timer, nowMs()) : { state: timerState.timer, finished: false };
                if (usingTimer && tick.state !== timerState.timer) timerState.timer = tick.state;
                if (tick.finished) ringTimer();
                try { paintFace(); } catch (_) {}
              }, Math.max(200, delay));
            }
          };
          faceState.paint = paintFace;
          // OW-60: nothing else paints this state any more — the card owns it, so the hook is just its own draw.
          clockFacePainter = paintFace;

          // ---- the panel's actions: every one of these is a pure helper that already existed on the old card ----
          const repaint = () => paintFace();
          const startStop = () => {
            const t = timerState.timer;
            if (t.running) {
              timerState.timer = timerStop(t, nowMs());
            } else if (t.remainingMs > 0 && t.durationMs) {
              timerState.timer = timerStart(t.remainingMs, nowMs());
            } else {
              timerState.stopwatch = timerState.stopwatch.running ? stopwatchStop(timerState.stopwatch, nowMs()) : stopwatchStart(timerState.stopwatch, nowMs());
            }
            repaint();
          };
          startBtn.addEventListener("click", (e) => { e?.stopPropagation?.(); startStop(); });
          lapBtn.addEventListener("click", (e) => {
            e?.stopPropagation?.();
            timerState.stopwatch = stopwatchLap(timerState.stopwatch, nowMs());
            repaint();
          });
          resetBtn.addEventListener("click", (e) => {
            e?.stopPropagation?.();
            timerState.stopwatch = stopwatchReset();
            timerState.timer = timerReset();
            repaint();
          });
          const startFromField = () => {
            const next = quickTimerFromText(field.value, nowMs());
            if (!next) { field.select?.(); return; }
            timerState.timer = next;
            field.value = "";
            repaint();
          };
          setBtn.addEventListener("click", (e) => { e?.stopPropagation?.(); startFromField(); });
          field.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); startFromField(); }
          });
          // OW-63: only a CONTROL keeps its click to itself. The timer FACE used to swallow every click here, which is
          // exactly why clicking the stopwatch never went back to the clock: the card's own handler never saw it. The
          // face itself now behaves like the clock face and turns the card over; the buttons and the field stop their
          // own clicks below, where each one already does its work.
          for (const el of [timerActions, presets, fieldRow]) {
            el.addEventListener?.("click", (e) => e?.stopPropagation?.());
          }
          // A click on the numbers, the kind line or the empty part of the face is a click on the card.
          for (const el of [timerFace, readout, timerKindEl, laps]) {
            el?.addEventListener?.("click", (e) => { e?.stopPropagation?.(); flipFace(); });
          }
          for (const { ms, button } of presetButtons) {
            button.addEventListener("click", (e) => {
              e?.stopPropagation?.();
              timerState.timer = timerStart(ms, nowMs());
              repaint();
            });
          }

          // OW-56: a countdown that ends answers the two settings once, and marks the card so the end is not missed.
          const ringTimer = () => {
            const plan = timerEndPlan({
              sound: getString(WIDGET_PREFS.TIMER_END_SOUND, DEFAULTS.TIMER_END_SOUND),
              notice: getString(WIDGET_PREFS.TIMER_END_NOTICE, DEFAULTS.TIMER_END_NOTICE),
              alreadyRung: clockAlert.ringing,
              text: timerNoticeText(),
            });
            wrap.setAttribute("data-zw-rang", "true");
            if (typeof window.setTimeout === "function") {
              window.setTimeout(() => wrap.removeAttribute("data-zw-rang"), 4000);
            }
            playTimerEndSound(plan.sound);
            showTimerEndNotice(plan.notice, plan.text);
            if (plan.markClock) {
              clockAlert.ringing = true;
              paintFace();
            }
          };

          // OW-60: the quick note lives on the clock face now. Same opener channel, same gate, and no button at all
          // when Notes is not installed (a button that cannot work is worse than none).
          const saveClockNote = () => {
            const text = String(clockNoteField.value || "").trim();
            const opener = resolveCalendarOpener(window);
            if (!opener || typeof opener.openQuickNote !== "function") return;
            try { opener.openQuickNote(text); } catch (_) {}
            clockNoteField.value = "";
            clockNoteRow.hidden = true;
          };
          // The quick note is part of the Clock face, not a feature to switch on: it is there whenever Notes can take a
          // note, and it simply disappears when it cannot. No chip, no fold, nothing to configure.
          // OW-69: one honest switch (the old chip-and-fold arrangement is gone for good). Off means the row is not in
          // the layout at all — it reserves no space and is not merely invisible — and it is live, no restart.
          const syncClockNote = () => {
            const opener = resolveCalendarOpener(window);
            const wanted = getBool(WIDGET_PREFS.CLOCK_QUICK_NOTE, DEFAULTS.CLOCK_QUICK_NOTE);
            const canNote = Boolean(opener && typeof opener.openQuickNote === "function");
            const ok = wanted && canNote;
            clockNoteChip.hidden = true;
            clockNoteRow.hidden = !ok;
            clockNoteRow.setAttribute("data-zw-forced-off", ok ? "false" : "true");
            clockNoteRow.style.display = ok ? "" : "none";
          };
          clockNoteRow.addEventListener("click", (e) => e?.stopPropagation?.());
          clockNoteBtn.addEventListener("click", (e) => { e?.stopPropagation?.(); saveClockNote(); });
          clockNoteField.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); saveClockNote(); }
          });
          syncClockNote();
          // OW-60: the availability listener is NOT registered here. `create` runs again on every `registerWidget`, and
          // an instance discarded by that path never reaches `dispose`, so a per-card listener leaks by construction
          // (the 3-listener leak the clock/date test caught). One module-level listener re-paints the mounted card.
          clockNoteSync = syncClockNote;

          return {
            element: wrap,
            onMountCard(card) {
              // The card, not only its body: a click anywhere on the Clock card turns it over.
              if (!card || typeof card.addEventListener !== "function") return;
              card.addEventListener("click", (e) => {
                if (longPressFired) return; // a long press asked for a duration; that is not a flip
                if (e && ((e.button != null && e.button !== 0) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) return;
                if (e && typeof e.stopPropagation === "function") e.stopPropagation();
                flipFace();
              });
            },
            fetch({ now }) {
              return formatClockParts(now, readClockOpts());
            },
            isStale(now, cached) {
              return isClockCacheStale(now, cached, readClockOpts());
            },
            nextDelayMs(now) {
              return nextClockDelayMs(now, readClockOpts().showSeconds);
            },
            render(value, info) {
              if (!value) return;
              staticRenderKey = renderClockElements(
                { wrap, timeEl, secEl, merEl, zoneEl },
                value,
                staticRenderKey,
                // A cached repaint is the "show this card again" case: write it, do not trust the previous key.
                Boolean(info && info.cached),
              );
              // OW-69: every draw re-answers "should the quick note be on this face?" — a pref change repaints the card
              // but must also put the row away (or bring it back), and this is the one place every draw goes through.
              syncClockNote();
              // OW-56: the face is drawn after the clock's own text, so the two never fight over the same elements.
              paintFace();
            },
            // OW-60: the old Timer card answered these (the Clock's long press / right click used to land there).
            // Now that the card is gone, the Clock answers them itself.
            clockClick(kind) {
              if (kind === "stopwatch-start") timerState.stopwatch = stopwatchStart(timerState.stopwatch, nowMs());
              else if (kind === "stopwatch-stop") timerState.stopwatch = stopwatchStop(timerState.stopwatch, nowMs());
              else if (kind === "timer-stop") timerState.timer = timerStop(timerState.timer, nowMs());
              else if (kind === "ask-duration") {
                if (readMode() !== "timer") writeStringPref(WIDGET_PREFS.CLOCK_MODE, "timer");
                field.focus?.();
              }
              paintFace();
              return true;
            },
            state: timerState,
            dispose() {
              clearTick();
              if (clockNoteSync === syncClockNote) clockNoteSync = null;
            },
          };
        },
      });

      registerWidget({
        id: "date",
        title: tw("date.title"),
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

          let cardEl = null;
          let lastAriaDate = "Date";
          const localCleanups = [];

          const bindInteractiveTarget = (el) => {
            if (!el || typeof el.addEventListener !== "function") return;
            const onClick = (event) => {
              if (
                event &&
                ((event.button != null && event.button !== 0) ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.altKey ||
                  event.shiftKey)
              ) {
                return;
              }
              const opener = resolveCalendarOpener(window);
              if (!opener) return;
              event?.preventDefault?.();
              event?.stopPropagation?.();
              try {
                opener.openCalendar();
              } catch (err) {
                console.warn("[ZentralWidgets] openCalendar failed:", err);
              }
            };
            const onKeyDown = (event) => {
              const key = event?.key;
              if (key !== "Enter" && key !== " " && key !== "Spacebar") return;
              const opener = resolveCalendarOpener(window);
              if (!opener) return;
              event?.preventDefault?.();
              event?.stopPropagation?.();
              try {
                opener.openCalendar();
              } catch (err) {
                console.warn("[ZentralWidgets] openCalendar failed:", err);
              }
            };
            el.addEventListener("click", onClick);
            el.addEventListener("keydown", onKeyDown);
            localCleanups.push(() => {
              try {
                el.removeEventListener("click", onClick);
                el.removeEventListener("keydown", onKeyDown);
              } catch (_) {}
            });
          };

          const syncInteractiveState = () => {
            const target = cardEl || wrap;
            const available = Boolean(resolveCalendarOpener(window));
            if (available) {
              target.setAttribute("role", "button");
              target.setAttribute("tabindex", "0");
              target.setAttribute("data-zw-clickable", "true");
              target.setAttribute("title", "Open Calendar");
              target.setAttribute("aria-label", `${lastAriaDate} — Open Calendar`);
              wrap.setAttribute("data-zw-clickable", "true");
            } else {
              target.removeAttribute("role");
              target.removeAttribute("tabindex");
              target.removeAttribute("data-zw-clickable");
              target.removeAttribute("title");
              target.setAttribute("aria-label", cardEl ? "Date" : lastAriaDate);
              wrap.removeAttribute("data-zw-clickable");
            }
          };

          const onAvailabilityChange = () => syncInteractiveState();
          if (typeof window.addEventListener === "function") {
            window.addEventListener(
              CALENDAR_AVAILABILITY_EVENT,
              onAvailabilityChange,
            );
            localCleanups.push(() => {
              try {
                window.removeEventListener(
                  CALENDAR_AVAILABILITY_EVENT,
                  onAvailabilityChange,
                );
              } catch (_) {}
            });
          }

          return {
            element: wrap,
            onMountCard(card) {
              cardEl = card;
              bindInteractiveTarget(card);
              syncInteractiveState();
            },
            dispose() {
              while (localCleanups.length) {
                const fn = localCleanups.pop();
                try {
                  fn();
                } catch (_) {}
              }
              cardEl = null;
            },
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
              lastAriaDate = value.text || "Date";
              wrap.setAttribute("data-zw-date-key", value.key || "");
              wrap.setAttribute("aria-label", lastAriaDate);
              syncInteractiveState();
            },
          };
        },
      });

      // ---- T3.9c: weather -------------------------------------------------------------------------------------
      // One request per refresh to Open-Meteo (no key, no account, no sync). The scheduler owns the timer, pauses it
      // with the sidebar, and paints the cached value first, so a cold sidebar shows the last reading immediately.
      registerWidget({
        id: "weather",
        title: tw("weather.title"),
        showHeader: false,
        order: 30,
        pref: WIDGET_PREFS.WEATHER_ENABLED,
        defaultEnabled: false,
        refreshPref: WIDGET_PREFS.WEATHER_REFRESH_MINUTES,
        refreshScale: 60000,
        minRefreshMs: WEATHER_REFRESH_MIN * 60000,
        maxRefreshMs: WEATHER_REFRESH_MAX * 60000,
        refreshMs: DEFAULTS.WEATHER_REFRESH_MINUTES * 60000,
        watchPrefs: [
          WIDGET_PREFS.WEATHER_PLACE,
          WIDGET_PREFS.WEATHER_LATITUDE,
          WIDGET_PREFS.WEATHER_LONGITUDE,
          WIDGET_PREFS.WEATHER_PLACES,
          WIDGET_PREFS.WEATHER_UNITS,
          WIDGET_PREFS.WEATHER_REFRESH_MINUTES,
        ],
        // OW-57: the cache holds one entry per place, or the place switched in the same card would show the old
        // place's numbers for a moment (the scheduler looks the cache up by this key before every paint).
        cacheKey() {
          const opts = readWeatherOpts();
          return weatherCacheKeyFor("weather", opts.place_);
        },
        create({ document: doc, requestRefresh }) {
          const wrap = doc.createElement("div");
          wrap.className = "zw-weather";

          const main = doc.createElement("div");
          main.className = "zw-weather-main";
          const iconEl = doc.createElement("span");
          iconEl.className = "zw-weather-icon";
          iconEl.setAttribute("aria-hidden", "true");
          const tempEl = doc.createElement("span");
          tempEl.className = "zw-weather-temp";
          const labelEl = doc.createElement("span");
          labelEl.className = "zw-weather-label";
          main.appendChild(iconEl);
          main.appendChild(tempEl);
          main.appendChild(labelEl);

          const metaEl = doc.createElement("div");
          metaEl.className = "zw-card-meta zw-weather-meta";
          const rangeEl = doc.createElement("span");
          rangeEl.className = "zw-weather-range";
          const detailsEl = doc.createElement("span");
          detailsEl.className = "zw-weather-details";
          metaEl.appendChild(rangeEl);
          metaEl.appendChild(detailsEl);

          const placeEl = doc.createElement("div");
          placeEl.className = "zw-card-meta zw-weather-place";

          // OW-50: the second line is tomorrow, and the next day that looks wet. On a narrow card only one fits, so a
          // click swaps between them. The swap is per-window state, not a pref: it is a glance, not a setting.
          const outlookEl = doc.createElement("div");
          outlookEl.className = "zw-card-meta zw-weather-outlook";
          outlookEl.hidden = true;
          let outlookFaces = [];

          wrap.appendChild(main);
          wrap.appendChild(metaEl);
          wrap.appendChild(outlookEl);
          wrap.appendChild(placeEl);

          const areaWidth = () => {
            try {
              const width = getArea?.()?.width;
              return typeof width === "number" ? width : null;
            } catch (_) {
              return null;
            }
          };
          // OW-54: every half of the outlook is drawn, each on its own line. A narrow card wraps; it never hides one half
          // behind a click. This used to swap the two on a click when the card was under 200px, which was a workaround
          // for the line being cut (white-space: nowrap + ellipsis) — the cut is gone, so the workaround is too.
          const paintOutlook = (parts, opts) => {
            const lines = (parts && (parts.lines || parts.faces)) || [];
            if (!parts || !lines.length) {
              outlookEl.hidden = true;
              outlookEl.replaceChildren();
              outlookEl.removeAttribute("data-zw-outlook-face");
              outlookFaces = [];
              return;
            }
            outlookEl.replaceChildren();
            for (const line of lines) {
              const row = doc.createElement("span");
              row.className = "zw-weather-outlook-line";
              row.textContent = line;
              outlookEl.appendChild(row);
            }
            outlookEl.title = lines.join(" \u00b7 ");
            outlookEl.removeAttribute("data-zw-outlook-face");
            outlookFaces = lines.slice();
            outlookEl.hidden = false;
            outlookEl.setAttribute("aria-label", (opts?.place ? opts.place + ": " : "") + lines.join(", "));
          };
          // The card's own click is not the outlook's business any more; OW-57 owns a click on the card (place cycling).
          outlookEl.addEventListener("click", (e) => e.stopPropagation());

          const paint = (value, info = {}) => {
            const opts = readWeatherOpts();
            placeEl.textContent = opts.place || "Set a place in Settings";
            // A control only when a click can do something: one place is a label, not a button.
            const readyPlaces = opts.places.filter(weatherPlaceReady);
            const cyclable = readyPlaces.length > 1;
            wrap.setAttribute("data-zw-places", String(readyPlaces.length));
            if (cyclable) {
              wrap.setAttribute("role", "button");
              wrap.setAttribute("tabindex", "0");
              wrap.setAttribute("aria-label", `${opts.place || ""}: click for the next place (${readyPlaces.length} saved)`);
            } else {
              wrap.removeAttribute("role");
              wrap.removeAttribute("tabindex");
            }
            wrap.setAttribute("data-zw-weather", value ? (info.cached ? "cached" : "live") : info.error ? "error" : "empty");
            if (!value) {
              iconEl.textContent = "\u2601";
              tempEl.textContent = info.error ? "\u2014" : "";
              labelEl.textContent = info.error ? "Weather unavailable" : "";
              rangeEl.textContent = "";
              detailsEl.textContent = "";
              outlookEl.hidden = true;
              outlookFaces = [];
              wrap.setAttribute("aria-label", info.error ? "Weather unavailable" : "Weather: no place set");
              return;
            }
            const parts = formatWeatherParts(value, opts.units);
            iconEl.textContent = WEATHER_ICON_GLYPHS[parts.icon] || WEATHER_ICON_GLYPHS.unknown;
            tempEl.textContent = parts.temperature;
            labelEl.textContent = parts.label;
            rangeEl.textContent = parts.range;
            detailsEl.textContent = parts.details;
            try {
              paintOutlook(weatherOutlookParts(value.week, opts), opts);
            } catch (err) {
              outlookEl.hidden = true;
              console.warn("[ZentralWidgets] weather outlook failed:", err);
            }
            wrap.setAttribute("aria-label", (opts.place ? opts.place + ": " : "") + parts.text);
          };

          // OW-57: the whole card is the control. A click shows the next place; one place (or none) leaves it alone.
          // The outlook no longer owns a click (OW-54), so there is nothing left to collide with.
          const cyclePlace = () => {
            const places = readWeatherPlaces().filter(weatherPlaceReady);
            if (places.length < 2) return false;
            const active = currentWeatherPlace(places, weatherView.placeId);
            const next = nextWeatherPlace(places, active?.id);
            if (!next || next.id === active?.id) return false;
            weatherView.placeId = next.id;
            requestRefresh({ force: true });
            return true;
          };
          wrap.addEventListener("click", () => {
            try {
              cyclePlace();
            } catch (err) {
              console.warn("[ZentralWidgets] weather place cycle failed:", err);
            }
          });
          wrap.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            cyclePlace();
          });

          return {
            element: wrap,
            cacheKey() {
              const opts = readWeatherOpts();
              return weatherCacheKeyFor("weather", opts.place_);
            },
            fetch({ now, cachedValue }) {
              const opts = readWeatherOpts();
              if (!opts.place_) return null; // no place, no request, no network
              if (cachedValue && isWeatherCacheFresh(now, { value: cachedValue, updatedAt: now }, opts.refreshMinutes)) return undefined;
              const url = weatherRequestUrl(opts.place_, opts.units);
              if (!url) return null;
              return fetch(url, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
                .then((res) => (res && res.ok ? res.json() : null))
                .then((payload) => (payload ? readWeatherPayload(payload, opts.units, widgetLang()) : null))
                .catch(() => null);
            },
            isStale(now, cached) {
              return !cached?.value || !isWeatherCacheFresh(now, cached, readWeatherOpts().refreshMinutes);
            },
            nextDelayMs(now, cached) {
              return nextWeatherDelayMs(now, readWeatherOpts().refreshMinutes, cached?.updatedAt);
            },
            render(value, info) {
              try {
                paint(value, info || {});
              } catch (err) {
                console.warn("[ZentralWidgets] weather render failed:", err);
              }
            },
          };
        },
      });

      // A place name is looked up once, when the person types it (a setting change, never a poll) and on load if an
      // entry is stored without numbers. The answer fills that entry in the places list: a name is a label, the
      // numbers are the truth. The first entry also mirrors into the three single prefs, so someone who edits those
      // by hand still sees what they edited.
      let placeLookupToken = 0;
      // OW-56: the face is a setting, so it is written the one way this file writes settings.
      function writeStringPref(pref, value) {
        try {
          Services.prefs.setStringPref(pref, String(value));
          return true;
        } catch (_) {
          return false;
        }
      }
      function writeWeatherPlaces(list) {
        try {
          Services.prefs.setStringPref(WIDGET_PREFS.WEATHER_PLACES, serializeWeatherPlaces(list));
          return true;
        } catch (_) {
          return false;
        }
      }
      function applyGeocodeHit(hit, placeId) {
        const places = readWeatherPlaces();
        if (!places.length) return false;
        const at = places.findIndex((p) => p.id === placeId);
        if (at < 0) return false;
        const target = places[at];
        const name = hit.name && hit.name !== target.name ? hit.name : target.name;
        const filled = places.map((p) =>
          p.id === target.id ? { ...p, name, latitude: hit.latitude, longitude: hit.longitude } : p,
        );
        if (!writeWeatherPlaces(filled)) return false;
        if (at === 0) {
          try {
            Services.prefs.setStringPref(WIDGET_PREFS.WEATHER_LATITUDE, String(hit.latitude));
            Services.prefs.setStringPref(WIDGET_PREFS.WEATHER_LONGITUDE, String(hit.longitude));
            if (name) Services.prefs.setStringPref(WIDGET_PREFS.WEATHER_PLACE, name);
          } catch (_) {}
        }
        return true;
      }
      // One name -> one place. `placeId` empty means "the legacy single place", which becomes entry one.
      function geocodeWeatherName(name, placeId) {
        const url = geocodeUrl(name);
        if (!url || typeof fetch !== "function") return Promise.resolve(false);
        const token = ++placeLookupToken;
        return fetch(url, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
          .then((res) => (res && res.ok ? res.json() : null))
          .then((payload) => {
            if (disposed || token !== placeLookupToken) return false;
            const hit = readGeocodePayload(payload);
            if (!hit) return false;
            if (placeId) return applyGeocodeHit(hit, placeId);
            // The legacy name has no entry yet: make it entry one, then fill it.
            const seeded = weatherPlacesFromLegacy(name, hit.latitude, hit.longitude);
            if (!seeded.length || !writeWeatherPlaces(seeded)) return false;
            return applyGeocodeHit(hit, seeded[0].id);
          })
          .catch(() => false);
      }
      function lookupMissingWeatherPlaces() {
        const places = readWeatherPlaces();
        if (places.length) {
          const missing = places.find((p) => !cleanWeatherPlace(p.latitude, p.longitude));
          return missing ? geocodeWeatherName(missing.name, missing.id) : Promise.resolve(false);
        }
        const legacyName = String(getString(WIDGET_PREFS.WEATHER_PLACE, "") || "").trim();
        return legacyName ? geocodeWeatherName(legacyName, "") : Promise.resolve(false);
      }
      watchPref(WIDGET_PREFS.WEATHER_PLACES, () => {
        lookupMissingWeatherPlaces();
      });
      watchPref(WIDGET_PREFS.WEATHER_PLACE, () => {
        // Typing a name in the single pref after a list exists fills the first entry, not a phantom place.
        const places = readWeatherPlaces();
        const name = String(getString(WIDGET_PREFS.WEATHER_PLACE, "") || "").trim();
        if (!name || !places.length) return;
        if (cleanWeatherPlace(getString(WIDGET_PREFS.WEATHER_LATITUDE, ""), getString(WIDGET_PREFS.WEATHER_LONGITUDE, ""))) return;
        geocodeWeatherName(name, places[0].id);
      });
      if (getBool(WIDGET_PREFS.WEATHER_ENABLED, DEFAULTS.WEATHER_ENABLED)) lookupMissingWeatherPlaces();

      // ---- T3.9d: timer, stopwatch and quick note --------------------------------------------------------------
      // One card: a stopwatch and a countdown that share a single readout, five presets, one free field and a laps
      // list. Its state lives here (not in prefs): a stopwatch is a moment, not a setting.
      const timerState = { stopwatch: stopwatchReset(), timer: timerReset(), lapsOpen: false };
      // The Clock line's small badge; the timer panel writes into it so a running countdown survives a closed panel.

      // OW-56: the two halves of "a countdown that ends". Both are best-effort and silent on a platform that has
      // neither; a missing alert must never make the timer fail to end.
      let timerSoundCtx = null;
      function playTimerEndSound(kind) {
        const sound = cleanTimerEndSound(kind);
        if (sound === "none") return;
        if (sound === "beep") {
          try { Services.sound.beep(); } catch (_) {}
          return;
        }
        // A short two-note tone: the same WebAudio path the reminder alert uses, so it is louder than a beep but
        // still one gesture long. A platform without WebAudio falls back to the beep.
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) throw new Error("no audio");
          const ctx = timerSoundCtx || (timerSoundCtx = new Ctx());
          if (ctx.state === "suspended") ctx.resume?.().catch?.(() => {});
          for (const [at, hz] of [[0, 880], [0.22, 1174]]) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = hz;
            gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
            gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + at + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.2);
            osc.connect(gain).connect(ctx.destination);
            osc.start(ctx.currentTime + at);
            osc.stop(ctx.currentTime + at + 0.22);
          }
        } catch (_) {
          try { Services.sound.beep(); } catch (err) {}
        }
      }
      function timerNoticeText() {
        const t = timerState.timer;
        const minutes = t && t.durationMs ? Math.round(t.durationMs / 60000) : 0;
        return minutes >= 1 ? `Countdown finished (${minutes} min)` : "Countdown finished";
      }
      function showTimerEndNotice(kind, text) {
        const notice = cleanTimerEndNotice(kind);
        if (notice === "none") return;
        if (notice === "system") {
          // The platform's own alert: outside the window, so it is seen while Zen is in the background.
          try {
            const alerts = Services.alerts;
            if (alerts && typeof alerts.showAlertNotification === "function") {
              alerts.showAlertNotification(null, "Timer", text, false, "", null, null, null, null, null, null);
              return;
            }
            if (typeof window.Notification === "function") {
              new window.Notification("Timer", { body: text });
              return;
            }
          } catch (_) {}
        }
        showWidgetToast(text);
      }
      // A line in the window, on the widget tray, that leaves by itself. No pref, no timer of its own: one
      // setTimeout that a second end replaces.
      let widgetToastEl = null;
      let widgetToastTimer = null;
      function showWidgetToast(text) {
        try {
          const doc = window.document;
          const host = tray || doc?.getElementById?.(TRAY_ID) || doc?.body;
          if (!doc || !host || typeof doc.createElement !== "function") return;
          if (!widgetToastEl || !widgetToastEl.isConnected) {
            widgetToastEl = doc.createElement("div");
            widgetToastEl.className = "zw-toast";
            widgetToastEl.setAttribute("role", "status");
            host.appendChild(widgetToastEl);
          }
          widgetToastEl.textContent = String(text || "");
          widgetToastEl.hidden = false;
          if (widgetToastTimer !== null && typeof window.clearTimeout === "function") window.clearTimeout(widgetToastTimer);
          widgetToastTimer = null;
          if (typeof window.setTimeout !== "function") return;
          widgetToastTimer = window.setTimeout(() => {
            widgetToastTimer = null;
            if (widgetToastEl) widgetToastEl.hidden = true;
          }, 5000);
        } catch (_) {}
      }

      // OW-60: the panel is part of the Clock card, so a Clock click has nowhere to travel. One function, one card.
      function clockClick(action) {
        const clock = mountedCards.get("clock")?.instance;
        if (!clock || typeof clock.clockClick !== "function") return false;
        // "open"/"close-panel" only mean "show the panel" now: the panel is the other face of this same card.
        if (action === "open" || action === "close-panel") {
          const wanted = action === "open" ? "timer" : "clock";
          if (readWidgetModePref() !== wanted) writeStringPref(WIDGET_PREFS.CLOCK_MODE, wanted);
          clockFacePainter?.();
          return true;
        }
        return clock.clockClick(action) !== false;
      }
      const readWidgetModePref = () => cleanWidgetMode(getString(WIDGET_PREFS.CLOCK_MODE, DEFAULTS.CLOCK_MODE));
      function clockClickKind(event) {
        return resolveClockClick({
          clickEnabled: getBool(WIDGET_PREFS.TIMER_CLICK_STOPWATCH, DEFAULTS.TIMER_CLICK_STOPWATCH),
          timerRunning: Boolean(timerState.timer?.running),
          stopwatchRunning: Boolean(timerState.stopwatch?.running),
          long: Boolean(event?.shiftKey),
        });
      }

      // ---- T3.9e: battery and memory ---------------------------------------------------------------------------
      // Battery events come from the platform (charging, level change); memory is a reading, so it rides the
      // scheduler's slow interval. Neither is polled per second, and neither runs while the sidebar is hidden.
      // The browser window has no `navigator.getBattery`; the platform exposes the battery through the power
      // manager. Either answer is normalised by readBatteryInfo(), and "no battery at all" is a fact worth printing,
      // not a reason to hide the card.
      let batteryRef = null;
      let batterySeen = null;
      let batterySupport = null; // null = not known yet, true = a reading is possible, false = this machine/build cannot
      // OW-70: the memory reading, from every source the platform might offer, with the one that answered kept so the
      // card can say where its number came from. A build without `getMemoryUsage` is not a build without memory: the
      // resident-size counter is a second door, and the end of that road is "no reading", never a wrong number.
      let memorySource = "";
      const readMemory = () => {
        try {
          const usage = Services.appinfo?.getMemoryUsage?.();
          const fromUsage = readMemoryUsage(usage);
          if (fromUsage) { memorySource = "appinfo"; return fromUsage; }
        } catch (_) {}
        try {
          // Fallback: the process' own resident size, when the app reports one.
          const resident = Number(Services.appinfo?.getMemoryUsage?.()?.residentFast ?? NaN);
          if (Number.isFinite(resident) && resident > 0) { memorySource = "resident"; return { used: resident, total: 0 }; }
        } catch (_) {}
        return null;
      };
      let memorySupport = null;
      const memorySupported = () => {
        if (memorySupport !== null) return memorySupport;
        try {
          memorySupport = Boolean(readMemory());
        } catch (_) {
          memorySupport = false;
        }
        return memorySupport;
      };
      const adoptBattery = (source) => {
        if (disposed) return;
        batteryRef = source;
        batterySeen = batteryParts(readBatteryInfo(source));
        // A source that answers but reports no usable level is still a battery the machine has.
        batterySupport = true;
        const changed = () => {
          batterySeen = batteryParts(readBatteryInfo(batteryRef));
          scheduler.refresh("status", { force: true, area: lastArea });
        };
        source.addEventListener?.("levelchange", changed);
        source.addEventListener?.("chargingchange", changed);
        registerCleanup(() => {
          try {
            source.removeEventListener?.("levelchange", changed);
            source.removeEventListener?.("chargingchange", changed);
          } catch (_) {}
        });
        scheduler.refresh("status", { force: true, area: lastArea });
      };
      const watchBattery = () => {
        if (batteryRef || disposed) return;
        // A content-side navigator, when the runtime hands one over, is the simplest source.
        if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
          try {
            navigator.getBattery().then(adoptBattery).catch(() => { batterySupport = false; });
            return;
          } catch (_) {}
        }
        // The browser window reads the same power manager Firefox's own battery indicator uses.
        try {
          const power =
            (typeof Services !== "undefined" ? Services.power : null) ||
            (typeof Cc !== "undefined" && typeof Ci !== "undefined"
              ? Cc["@mozilla.org/power/powermanagerservice;1"].getService(Ci.nsIPowerManagerService)
              : null);
          const battery = power?.battery;
          if (!battery) {
            batterySupport = false;
            return;
          }
          adoptBattery(battery);
          return;
        } catch (_) {}
        batterySupport = false;
      };
      registerWidget({
        id: "status",
        title: tw("status.title"),
        showHeader: false,
        order: 50,
        pref: WIDGET_PREFS.STATUS_ENABLED,
        defaultEnabled: false,
        refreshMs: 5 * 60000,
        watchPrefs: [WIDGET_PREFS.STATUS_SHOW_BATTERY, WIDGET_PREFS.STATUS_SHOW_MEMORY],
        create({ document: doc }) {
          const wrap = doc.createElement("div");
          wrap.className = "zw-status";
          const batteryEl = doc.createElement("span");
          batteryEl.className = "zw-status-item zw-status-battery";
          const memoryEl = doc.createElement("span");
          memoryEl.className = "zw-status-item zw-status-memory";
          wrap.appendChild(batteryEl);
          wrap.appendChild(memoryEl);
          return {
            element: wrap,
            fetch() {
              watchBattery();
              const opts = {
                showBattery: getBool(WIDGET_PREFS.STATUS_SHOW_BATTERY, DEFAULTS.STATUS_SHOW_BATTERY),
                showMemory: getBool(WIDGET_PREFS.STATUS_SHOW_MEMORY, DEFAULTS.STATUS_SHOW_MEMORY),
              };
              const memory = readMemory();
              return {
                opts,
                battery: batterySeen,
                memory,
                support: {
                  battery: batterySupport !== false,
                  memory: memorySupport !== false && memorySupported(),
                },
              };
            },
            nextDelayMs(_now, cached) {
              return nextStatusDelayMs(cached?.value?.battery);
            },
            render(value) {
              // OW-64: the card's words follow the widget language, read now (not when the reading was taken).
              const opts = { ...(value?.opts || { showBattery: true, showMemory: true }), language: getString(WIDGET_PREFS.LANGUAGE, DEFAULTS.LANGUAGE), notesRaw: getString(NOTES_LANGUAGE_PREF, "en") };
              const parts = composeStatusParts(opts, value?.battery, value?.memory, value?.support || {});
              const find = (kind) => parts.find((p) => p.kind === kind);
              const b = find("battery");
              const m = find("memory");
              batteryEl.hidden = !b;
              memoryEl.hidden = !m;
              batteryEl.textContent = b ? b.text : "";
              batteryEl.title = b ? b.title : "";
              batteryEl.setAttribute("data-zw-level", b ? b.level : "");
              memoryEl.textContent = m ? m.text : "";
              memoryEl.title = m ? m.title : "";
              memoryEl.setAttribute("data-zw-level", m ? m.level : "");
              wrap.hidden = !parts.length;
              wrap.setAttribute("aria-label", parts.map((p) => p.title).join("; ") || "Status");
              // OW-70: which source answered, in the DOM where the owner can look, not only in a console nobody opens.
              wrap.setAttribute("data-zw-source", [m ? "memory:" + (memorySource || "none") : "", b ? "battery" : ""].filter(Boolean).join(" "));
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
        moveWidget: (id, dir) => moveCard(normalizeWidgetId(id), dir),
        widgetOrder: () => currentOrderIds(),
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
        resolveWeatherPlace: () => resolveWeatherPlaceFromName(),
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
