/*
 * ZENTRAL FILE GUIDE - additional/notes/calendar/ZentralNotesCalendar.js
 *
 * Purpose: The calendar of Notes as pure logic (roadmap T2.1): the item model (events and reminders, shaped like
 *   Google Calendar events so a later sync only maps ids), date and time parsing, the month grid, the days-forward list,
 *   side-by-side lanes for overlapping events, merged busy time, and move / resize helpers for dragging.
 * Interaction / execution: ZentralNotes.uc.js loads this file (full pack: module loader; standalone: embedded include) and
 *   the calendar views (T2.4+) call these functions. Nothing here touches the DOM, a preference, the disk or the clock:
 *   every function that needs "now" takes it as an argument.
 * Ownership / failure: a missing file means "no calendar" (the rest of Notes is unaffected). Bad input is cleaned or
 *   rejected (null), never thrown.
 * Registration: notes-calendar
 * Loaded/created by: additional/notes/ZentralNotes.uc.js
 *
 * ITEM (Google field names; our own fields live under `x`)
 *   { id, summary, description, start: {date}|{dateTime}, end: {date}|{dateTime}|undefined, status, updated, etag,
 *     recurrence: [RRULE...], reminders: { overrides: [{ method, minutes }] },
 *     x: { kind: "event"|"reminder", noteId, heading, category, tz, src: "list"|"note"|"manual", key, moved, calNote } }
 *   Times: `dateTime` is a UTC ISO string (Google also allows an offset; we always write Z). `date` is a local calendar
 *   day YYYY-MM-DD. An all-day item ends on an EXCLUSIVE date, as in Google. A reminder has a start and NO end.
 */
(function () {
  "use strict";
  const MIN = 60000, DAY_MS = 86400000;
  const p2 = (n) => String(n).padStart(2, "0");
  const KINDS = Object.freeze(["event", "reminder"]);
  const MAX_TEXT = 500, MAX_DESC = 20000;
  const SOUND_LEVELS = Object.freeze(["silent", "quiet", "normal", "loud"]);
  const DEFAULT_CATEGORY_NOTIFY = Object.freeze({
    pre: Object.freeze({ enabled: true, leadMinutes: 5, sound: "quiet", quietAllow: Object.freeze([]) }),
    due: Object.freeze({ enabled: true, sound: "loud", quietAllow: Object.freeze([]) }),
    followup: Object.freeze({ enabled: true, delayMinutes: 2, sound: "normal", quietAllow: Object.freeze([]) }),
  });
  const DEFAULT_CATEGORIES = Object.freeze([
    Object.freeze({ name: "Birthdays", color: "#e58aac" }),
    Object.freeze({ name: "Deadlines", color: "#e36b68" }),
    Object.freeze({ name: "Subscriptions", color: "#6c9fe8" }),
    Object.freeze({ name: "Work", color: "#55ad86" }),
  ]);

  // ---------- dates ----------
  const ymd = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  function parseYmd(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || "").trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], da = +m[3];
    const d = new Date(y, mo - 1, da);
    return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da ? d : null;
  }
  const dayStart = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const addDays = (ms, n) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime(); };
  const iso = (ms) => new Date(ms).toISOString();

  // ---------- parsing ----------
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  // Month aliases are offline and cover English, German and Polish (including Polish genitive forms).
  const MONTH_ALIASES = Object.create(null);
  const MONTH_WORDS = [
    ["january", "jan", "januar", "styczen", "stycznia", "sty"],
    ["february", "feb", "februar", "luty", "lutego", "lut"],
    ["march", "mar", "maerz", "marz", "marzec", "marca"],
    ["april", "apr", "kwiecien", "kwietnia", "kwi"],
    ["may", "mai", "maj", "maja"],
    ["june", "jun", "juni", "czerwiec", "czerwca", "cze"],
    ["july", "jul", "juli", "lipiec", "lipca", "lip"],
    ["august", "aug", "sierpien", "sierpnia", "sie"],
    ["september", "sep", "sept", "wrzesien", "wrzesnia", "wrz"],
    ["october", "oct", "oktober", "okt", "pazdziernik", "pazdziernika", "paz"],
    ["november", "nov", "listopad", "listopada", "lis"],
    ["december", "dec", "dezember", "dez", "grudzien", "grudnia", "gru"],
  ];
  MONTH_WORDS.forEach((words, i) => words.forEach((word) => { MONTH_ALIASES[word] = i + 1; }));
  const monthWord = (word) => String(word || "").toLowerCase().replace(/\.$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const dateFromParts = (year, month, date) => {
    if (!Number.isInteger(year) || year < 1 || year > 9999) return null;
    const d = parseYmd(year + "-" + p2(month) + "-" + p2(date));
    return d ? d.getTime() : null;
  };
  function futureMonthDay(month, date, base) {
    const year = new Date(base).getFullYear();
    // Leap-day birthdays must find the next leap year, not just the next calendar year.
    for (let y = year; y <= year + 8; y++) {
      const ms = dateFromParts(y, month, date);
      if (ms !== null && ms >= base) return ms;
    }
    return null;
  }
  const twoDigitYear = (year) => year < 50 ? 2000 + year : 1900 + year;
  // Relative month/year arithmetic clamps to the final valid day of the target month instead of overflowing
  // into a later month (Jan 31 + 1m = Feb 28/29; Feb 29 + 1y = Feb 28).
  function shiftCalendarDate(base, amount, unit) {
    const source = new Date(base), first = new Date(base);
    first.setDate(1);
    if (unit === "m") first.setMonth(first.getMonth() + amount);
    else first.setFullYear(first.getFullYear() + amount);
    const year = first.getFullYear(), month = first.getMonth();
    if (year < 1 || year > 9999) return null;
    const lastDate = new Date(first);
    lastDate.setMonth(month + 1, 0);
    return new Date(year, month, Math.min(source.getDate(), lastDate.getDate())).getTime();
  }
  // A date as people type it: ISO, day/month/year, dotted/dashed/slashed dates, month names, @today, @tomorrow,
  // @+3d / @-2d / @+1w / @+1m, @monday. Numeric day-first forms are deliberate; no locale-dependent guessing.
  // Two-digit years use 00-49 => 2000-2049 and 50-99 => 1950-1999.
  function parseDateText(text, now) {
    const t = String(text || "").trim().toLowerCase().replace(/^[@/]/, "").replace(/[,.]$/, "").trim();
    if (!t) return null;
    const base = dayStart(now);
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
    if (m) return dateFromParts(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(t);
    if (m) return dateFromParts(m[3].length === 2 ? twoDigitYear(+m[3]) : +m[3], +m[2], +m[1]);
    m = /^(\d{1,2})\.?\s+([a-z\u00c0-\u024f]+)(?:\s+(\d{2,4}))?$/.exec(t);
    if (m) {
      const month = MONTH_ALIASES[monthWord(m[2])];
      if (!month) return null;
      return m[3] ? dateFromParts(m[3].length === 2 ? twoDigitYear(+m[3]) : +m[3], month, +m[1]) : futureMonthDay(month, +m[1], base);
    }
    m = /^([a-z\u00c0-\u024f]+)\s+(\d{1,2})(?:,?\s+(\d{2,4}))?$/.exec(t);
    if (m) {
      const month = MONTH_ALIASES[monthWord(m[1])];
      if (!month) return null;
      return m[3] ? dateFromParts(m[3].length === 2 ? twoDigitYear(+m[3]) : +m[3], month, +m[2]) : futureMonthDay(month, +m[2], base);
    }
    m = /^(\d{1,2})[./-](\d{1,2})\.?$/.exec(t);
    if (m) return futureMonthDay(+m[2], +m[1], base);
    if (t === "today") return base;
    if (t === "tomorrow") return addDays(base, 1);
    if (t === "yesterday") return addDays(base, -1);
    m = /^([+-])(\d{1,4})([dwmy])$/.exec(t);
    if (m) {
      const n = (m[1] === "-" ? -1 : 1) * +m[2], d = new Date(base);
      if (m[3] === "d") return addDays(base, n);
      if (m[3] === "w") return addDays(base, n * 7);
      if (m[3] === "m" || m[3] === "y") return shiftCalendarDate(base, n, m[3]);
    }
    const wd = WEEKDAYS.findIndex((w) => w === t || w.slice(0, 3) === t);
    if (wd >= 0) return addDays(base, ((wd - new Date(base).getDay() + 7) % 7) || 7);
    return null;
  }
  // Inline dates are deliberately recognised only in visible plain-text runs by the renderer. This scanner only
  // supplies candidates; the Markdown renderer decides whether the run is inside code, math or a link.
  function inlineDateTokens(text, now) {
    const source = String(text || ""), out = [];
    const month = "[a-z\\u00c0-\\u024f]+\\.?";
    const relative = "@(?:today|tomorrow|yesterday|[+-]\\d{1,4}[dwmy]|(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?))";
    const patterns = [
      relative,
      "\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}",
      "\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?",
      "\\d{1,2}\\.\\d{1,2}\\.(?:\\d{2,4})?",
      "\\d{1,2}\\.?\\s+" + month + "(?:\\s+\\d{2,4})?",
      month + "\\s+\\d{1,2}(?:,?\\s+\\d{2,4})?",
    ];
    const re = new RegExp("(?<![\\w/@])(" + patterns.join("|") + ")(?:[ T](\\d{1,2}):(\\d{2}))?(?![\\w/-])", "giu");
    for (let m; (m = re.exec(source)); ) {
      const raw = m[1], day = parseDateText(raw, now);
      // An unknown word can look like a month name (for example "12 and 25 listopada"). Do not let
      // that rejected candidate consume the next, valid date; resume one character after its start.
      if (day === null) { re.lastIndex = m.index + 1; continue; }
      const time = m[2] !== undefined && +m[2] < 24 ? String(+m[2]).padStart(2, "0") + ":" + m[3] : "";
      if (m[2] !== undefined && !time) continue;
      out.push({ start: m.index, end: re.lastIndex, raw: m[0], dateText: raw, ymd: ymd(new Date(day)), time });
    }
    return out;
  }
  const DATE_IGNORE_RE = /%%\s*zn-date-ignore:((?:%[0-9a-f]{2}|[^%]){1,180})\s*%%/gi;
  function ignoredDateTokens(line) {
    const out = [];
    for (const m of String(line || "").matchAll(DATE_IGNORE_RE)) {
      try { out.push(decodeURIComponent(m[1]).toLowerCase()); } catch (_) { out.push(m[1].toLowerCase()); }
    }
    return out;
  }
  const stripDateIgnoreMarks = (line) => String(line || "").replace(DATE_IGNORE_RE, "");
  // A date prefix for list/heading lines; month-name forms can contain spaces.
  function parseDatePrefix(text, now) {
    const s = String(text || "").trim();
    const patterns = [
      /^(\d{4}[./-]\d{1,2}[./-]\d{1,2})(?=\s|$)/,
      /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})(?=\s|$)/,
      /^(\d{1,2}[./-]\d{1,2}\.?)(?=\s|$)/,
      /^(\d{1,2}\.?\s+[a-z\u00c0-\u024f]+\.?\s+\d{2,4})(?=\s|$)/i,
      /^(\d{1,2}\.?\s+[a-z\u00c0-\u024f]+\.?)(?=\s|$)/i,
      /^([a-z\u00c0-\u024f]+\.?\s+\d{1,2},?\s+\d{2,4})(?=\s|$)/i,
      /^([a-z\u00c0-\u024f]+\.?\s+\d{1,2},?)(?=\s|$)/i,
      /^(\S+)/,
    ];
    for (const re of patterns) {
      const m = re.exec(s);
      if (!m) continue;
      const raw = m[1], day = parseDateText(raw, now);
      // This is deliberately prefix-only. These patterns are anchored and non-global, so lastIndex cannot
      // resume a search later in the line; a leading non-date token means this is not a dated list/heading.
      if (day === null) continue;
      const yearless = /^\d{1,2}[./-]\d{1,2}\.?$/.test(raw) || /^\d{1,2}\.?\s+[a-z\u00c0-\u024f]+\.?$/i.test(raw) || /^[a-z\u00c0-\u024f]+\.?\s+\d{1,2},?$/i.test(raw);
      return { day, raw, rest: s.slice(raw.length).trim(), yearless };
    }
    return null;
  }
  // "6:00", "06:00", "14:30" -> minutes after midnight or -1.
  function parseClock(text) {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(text || "").trim());
    if (!m) return -1;
    const h = +m[1], mi = +m[2];
    return h > 23 || mi > 59 ? -1 : h * 60 + mi;
  }
  // "06:00-14:00", "6:00 - 14:00", "14:30" -> { startMin, endMin (-1 = none) } or null.
  function parseTimeRange(text) {
    const t = String(text || "").trim();
    const r = /^(\d{1,2}[:.]\d{2})\s*[-\u2013\u2014]\s*(\d{1,2}[:.]\d{2})$/.exec(t);
    if (r) { const a = parseClock(r[1]), b = parseClock(r[2]); return a < 0 || b < 0 ? null : { startMin: a, endMin: b }; }
    const a = parseClock(t);
    return a < 0 ? null : { startMin: a, endMin: -1 };
  }
  // One line of a plain list: "- 06:00-14:00 Work", "10-08 Jan Kowalski", "2026-11-20 14:00 Dentist" -> parts or null.
  // The leading date is optional when `defaultDay` (local midnight ms) is given.
  function parseLine(line, now, defaultDay) {
    let t = String(line || "").replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "").trim();
    if (!t) return null;
    let day = defaultDay ?? null, yearless = false;
    const prefix = parseDatePrefix(t, now);
    // "03.12." (trailing dot) is a day-month date; "03.12" / "03:12" stay clock times.
    if (prefix && (!/^\d{1,2}[:.]\d{2}$/.test(prefix.raw) || /^\d{1,2}\.\d{1,2}\.$/.test(prefix.raw))) {
      day = prefix.day; t = prefix.rest; yearless = prefix.yearless;
    }
    if (day === null) return null;
    let range = null;
    const tr = /^(\d{1,2}[:.]\d{2}(?:\s*[-\u2013\u2014]\s*\d{1,2}[:.]\d{2})?)\s*(.*)$/.exec(t);
    if (tr) { range = parseTimeRange(tr[1]); if (range) t = tr[2]; }
    t = t.replace(/^[-\u2013\u2014:]\s*/, "").trim();
    if (!t) return null;
    return { day, startMin: range ? range.startMin : -1, endMin: range ? range.endMin : -1, summary: t.slice(0, MAX_TEXT), yearless };
  }

  // ---------- item model ----------
  function makeId(seed) {
    let h = 2166136261;
    const s = String(seed) + "|" + Math.random();
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return "n" + (h >>> 0).toString(36) + Date.now().toString(36);
  }
  const etagOf = (it) => {
    let h = 5381;
    const s = JSON.stringify([it.summary, it.description, it.start, it.end, it.status, it.recurrence, it.x, it.rev]);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return '"' + (h >>> 0).toString(36) + '"';
  };
  function cleanWhen(w) {
    if (!w || typeof w !== "object") return null;
    if (typeof w.date === "string") return parseYmd(w.date) ? { date: w.date } : null;
    if (typeof w.dateTime === "string") { const t = Date.parse(w.dateTime); return Number.isFinite(t) ? { dateTime: iso(t) } : null; }
    return null;
  }
  const whenMs = (w) => (w.date ? parseYmd(w.date).getTime() : Date.parse(w.dateTime));
  const MAX_OCCURRENCE_SHIFT_MS = 10 * 366 * DAY_MS;
  const RECURRENCE_EXCEPTION_SCOPES = Object.freeze(["this", "following", "series"]);
  function cleanRecurrenceException(raw, allDay) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const recurrenceId = cleanWhen(raw.recurrenceId);
    if (!recurrenceId || !!recurrenceId.date !== !!allDay) return null;
    const scope = RECURRENCE_EXCEPTION_SCOPES.includes(raw.scope) ? raw.scope : "";
    if (!scope) return null;
    if (scope === "this") {
      const cancelled = raw.cancelled === true;
      if (cancelled) return { recurrenceId, scope, cancelled: true };
      const start = cleanWhen(raw.start);
      if (!start || !!start.date !== !!allDay) return null;
      let end;
      if (raw.end !== undefined && raw.end !== null) {
        end = cleanWhen(raw.end);
        if (!end || !!end.date !== !!allDay || whenMs(end) <= whenMs(start)) return null;
      }
      return { recurrenceId, scope, cancelled: false, start, ...(end ? { end } : {}) };
    }
    if (allDay) {
      if (raw.shiftDays === null || raw.shiftDays === undefined || raw.shiftDays === "" || typeof raw.shiftDays === "boolean") return null;
      const shiftDays = Number(raw.shiftDays);
      if (!Number.isSafeInteger(shiftDays) || Math.abs(shiftDays) > 3660) return null;
      return { recurrenceId, scope, shiftDays };
    }
    if (raw.shiftMs === null || raw.shiftMs === undefined || raw.shiftMs === "" || typeof raw.shiftMs === "boolean") return null;
    const shiftMs = Number(raw.shiftMs);
    if (!Number.isSafeInteger(shiftMs) || Math.abs(shiftMs) > MAX_OCCURRENCE_SHIFT_MS) return null;
    return { recurrenceId, scope, shiftMs };
  }
  function cleanRecurrenceExceptions(raw, allDay) {
    if (!Array.isArray(raw)) return [];
    const byKey = new Map();
    for (const record of raw.slice(-1000)) {
      const exception = cleanRecurrenceException(record, allDay);
      if (!exception) continue;
      byKey.set(exception.scope + "|" + whenMs(exception.recurrenceId), exception);
    }
    return [...byKey.values()].sort((a, b) => whenMs(a.recurrenceId) - whenMs(b.recurrenceId) || RECURRENCE_EXCEPTION_SCOPES.indexOf(a.scope) - RECURRENCE_EXCEPTION_SCOPES.indexOf(b.scope)).slice(-500);
  }
  const recurrenceIdWhen = (ms, allDay) => allDay ? { date: ymd(new Date(ms)) } : { dateTime: iso(ms) };
  const cleanCategoryName = (value) => String(value ?? "").replace(/[\r\n%]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const categoryKey = (value) => cleanCategoryName(value).toLocaleLowerCase();
  const cleanStageRule = (raw, fallback, stage) => {
    const src = raw && typeof raw === "object" ? raw : {};
    const out = { enabled: typeof src.enabled === "boolean" ? src.enabled : fallback.enabled !== false };
    if (stage === "pre") out.leadMinutes = Number.isFinite(+src.leadMinutes) ? Math.max(1, Math.min(10, Math.round(+src.leadMinutes))) : fallback.leadMinutes;
    if (stage === "followup") out.delayMinutes = Number.isFinite(+src.delayMinutes) ? Math.max(1, Math.min(30, Math.round(+src.delayMinutes))) : fallback.delayMinutes;
    const soundSpecified = typeof src.soundSpecified === "boolean" ? src.soundSpecified : SOUND_LEVELS.includes(src.sound);
    if (soundSpecified && SOUND_LEVELS.includes(src.sound)) out.sound = src.sound;
    if (soundSpecified) out.soundSpecified = true;
    const quietAllowSpecified = typeof src.quietAllowSpecified === "boolean" ? src.quietAllowSpecified : Array.isArray(src.quietAllow);
    if (quietAllowSpecified && Array.isArray(src.quietAllow)) out.quietAllow = [...new Set(src.quietAllow.filter((level) => SOUND_LEVELS.includes(level) && level !== "silent"))];
    if (quietAllowSpecified) out.quietAllowSpecified = true;
    return out;
  };
  function cleanCategoryNotify(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    return {
      pre: cleanStageRule(src.pre, DEFAULT_CATEGORY_NOTIFY.pre, "pre"),
      due: cleanStageRule(src.due, DEFAULT_CATEGORY_NOTIFY.due, "due"),
      followup: cleanStageRule(src.followup, DEFAULT_CATEGORY_NOTIFY.followup, "followup"),
    };
  }
  function cleanNotifyOverrides(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const stage of ["pre", "due", "followup"]) {
      const src = raw[stage];
      if (!src || typeof src !== "object" || Array.isArray(src)) continue;
      const rule = {};
      if (typeof src.enabled === "boolean") rule.enabled = src.enabled;
      if (stage === "pre" && Number.isFinite(+src.leadMinutes)) rule.leadMinutes = Math.max(1, Math.min(10, Math.round(+src.leadMinutes)));
      if (stage === "followup" && Number.isFinite(+src.delayMinutes)) rule.delayMinutes = Math.max(1, Math.min(30, Math.round(+src.delayMinutes)));
      if (SOUND_LEVELS.includes(src.sound) && src.soundSpecified !== false) { rule.sound = src.sound; rule.soundSpecified = true; }
      if (Array.isArray(src.quietAllow) && src.quietAllowSpecified !== false) { rule.quietAllow = [...new Set(src.quietAllow.filter((level) => SOUND_LEVELS.includes(level) && level !== "silent"))]; rule.quietAllowSpecified = true; }
      if (Object.keys(rule).length) out[stage] = rule;
    }
    return out;
  }
  // Tier 1 adapts to how far ahead the reminder was saved: one minute for an imminent
  // reminder, up to ten minutes for a reminder scheduled at least 100 minutes ahead.
  // Use the persisted `updated` stamp rather than the current clock so a timer re-arm
  // cannot move the pre-alert target as the reminder approaches.
  function adaptiveReminderLeadMinutes(startMs, updated) {
    const start = Number(startMs), saved = typeof updated === "string" ? Date.parse(updated) : Number(updated);
    if (!Number.isFinite(start)) return 1;
    const horizon = Number.isFinite(saved) && saved > 0 ? Math.max(0, start - saved) : 0;
    return Math.max(1, Math.min(10, Math.ceil(horizon / (10 * MIN))));
  }
  // Pure stage planner shared by the scheduler and its tests. Category defaults are
  // inherited first, then per-item rules override only fields they explicitly carry.
  function reminderStagePlan(item, categoryNotify = null, now = Date.now()) {
    if (!item || item.status === "cancelled" || (!isReminder(item) && !(item.reminders?.overrides || []).length)) return [];
    const start = whenMs(item.start);
    if (!Number.isFinite(start) || start <= 0) return [];
    const googleLead = (item.reminders?.overrides || []).reduce((max, override) => Math.max(max, Number(override?.minutes) || 0), 0);
    const dueAt = start - googleLead * MIN;
    const category = cleanCategoryNotify(categoryNotify);
    const overrides = cleanNotifyOverrides(item.x?.notify);
    const out = [];
    for (const stage of ["pre", "due", "followup"]) {
      const rule = { ...category[stage], ...(overrides[stage] || {}) };
      if (rule.enabled === false) continue;
      if (stage === "pre") {
        const adaptive = adaptiveReminderLeadMinutes(start, item.updated);
        const configured = Math.max(1, Math.min(10, Math.round(Number(rule.leadMinutes) || 5)));
        const leadMinutes = Math.min(configured, adaptive);
        out.push({ stage, at: dueAt - leadMinutes * MIN, leadMinutes });
      } else if (stage === "due") out.push({ stage, at: dueAt, leadMinutes: googleLead });
      else {
        const delayMinutes = Math.max(1, Math.min(30, Math.round(Number(rule.delayMinutes) || 2)));
        out.push({ stage, at: dueAt + delayMinutes * MIN, delayMinutes });
      }
    }
    return out.sort((a, b) => a.at - b.at || ["pre", "due", "followup"].indexOf(a.stage) - ["pre", "due", "followup"].indexOf(b.stage));
  }
  const DEFAULT_ALERT_SETTINGS = Object.freeze({
    stages: Object.freeze({ pre: Object.freeze({ sound: "quiet", quietAllow: Object.freeze([]) }), due: Object.freeze({ sound: "loud", quietAllow: Object.freeze([]) }), followup: Object.freeze({ sound: "normal", quietAllow: Object.freeze([]) }) }),
    quietHours: Object.freeze({ enabled: false, start: "22:00", end: "07:00", days: Object.freeze([0, 1, 2, 3, 4, 5, 6]), allowed: Object.freeze({ pre: Object.freeze([]), due: Object.freeze([]), followup: Object.freeze([]) }) }),
  });
  function cleanSoundRule(raw, fallback = {}) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      sound: SOUND_LEVELS.includes(src.sound) ? src.sound : (SOUND_LEVELS.includes(fallback.sound) ? fallback.sound : "normal"),
      soundSpecified: typeof src.soundSpecified === "boolean" ? src.soundSpecified : SOUND_LEVELS.includes(src.sound),
      quietAllow: Array.isArray(src.quietAllow) ? [...new Set(src.quietAllow.filter((level) => SOUND_LEVELS.includes(level) && level !== "silent"))] : [...(fallback.quietAllow || [])],
      quietAllowSpecified: typeof src.quietAllowSpecified === "boolean" ? src.quietAllowSpecified : Array.isArray(src.quietAllow),
    };
  }
  function cleanAlertSettings(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const q = src.quietHours && typeof src.quietHours === "object" ? src.quietHours : {};
    const time = (value, fallback) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? String(value) : fallback;
    const days = Array.isArray(q.days) ? [...new Set(q.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : [...DEFAULT_ALERT_SETTINGS.quietHours.days];
    const stages = {};
    const allowed = {};
    for (const stage of ["pre", "due", "followup"]) {
      stages[stage] = cleanSoundRule(src.stages?.[stage], DEFAULT_ALERT_SETTINGS.stages[stage]);
      const values = q.allowed?.[stage];
      allowed[stage] = Array.isArray(values) ? [...new Set(values.filter((level) => SOUND_LEVELS.includes(level) && level !== "silent"))] : [...stages[stage].quietAllow];
      stages[stage].quietAllow = [...allowed[stage]];
    }
    return { stages, quietHours: { enabled: q.enabled === true, start: time(q.start, "22:00"), end: time(q.end, "07:00"), days, allowed } };
  }
  function quietHoursActive(now, raw) {
    const q = cleanAlertSettings({ quietHours: raw }).quietHours;
    if (!q.enabled || !q.days.length || q.start === q.end) return false;
    const date = new Date(Number(now));
    if (!Number.isFinite(date.getTime())) return false;
    const minute = date.getHours() * 60 + date.getMinutes();
    const start = Number(q.start.slice(0, 2)) * 60 + Number(q.start.slice(3));
    const end = Number(q.end.slice(0, 2)) * 60 + Number(q.end.slice(3));
    if (start < end) return minute >= start && minute < end && q.days.includes(date.getDay());
    if (minute >= start) return q.days.includes(date.getDay());
    if (minute < end) return q.days.includes((date.getDay() + 6) % 7);
    return false;
  }
  function cleanNoteAlertOverrides(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [id, value] of Object.entries(raw).slice(0, 5000)) {
      const key = String(id || "").trim().slice(0, 120);
      if (!key || !value || typeof value !== "object" || Array.isArray(value)) continue;
      const stages = cleanNotifyOverrides(value), clean = {};
      for (const stage of ["pre", "due", "followup"]) {
        const rule = stages[stage];
        if (!rule) continue;
        const next = {};
        if (rule.soundSpecified) next.sound = rule.sound;
        if (rule.quietAllowSpecified) next.quietAllow = rule.quietAllow;
        if (Object.keys(next).length) clean[stage] = next;
      }
      if (Object.keys(clean).length) out[key] = clean;
    }
    return out;
  }
  function resolveAlertPolicy(item, categoryNotify, noteNotify, globalRaw, stage, now = Date.now()) {
    if (!["pre", "due", "followup"].includes(stage)) return { sound: "silent", play: false, quiet: false, volume: 0 };
    const global = cleanAlertSettings(globalRaw);
    const category = cleanCategoryNotify(categoryNotify)[stage];
    const note = cleanNotifyOverrides(noteNotify)[stage] || {};
    const reminder = cleanNotifyOverrides(item?.x?.notify)[stage] || {};
    const soundSource = [reminder, note, category].find((rule) => rule.soundSpecified === true || (rule.soundSpecified === undefined && SOUND_LEVELS.includes(rule.sound)));
    const sound = soundSource?.sound || global.stages[stage].sound || "normal";
    const allowSource = [reminder, note, category].find((rule) => rule.quietAllowSpecified === true || (rule.quietAllowSpecified === undefined && Array.isArray(rule.quietAllow)));
    const quietAllow = allowSource ? allowSource.quietAllow : global.quietHours.allowed[stage];
    const quiet = quietHoursActive(now, global.quietHours);
    const play = sound !== "silent" && (!quiet || quietAllow.includes(sound));
    const volume = ({ silent: 0, quiet: 0.08, normal: 0.2, loud: 0.35 })[sound];
    return { sound, play, quiet, volume, quietAllow: [...quietAllow] };
  }
  function cleanCategory(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = cleanCategoryName(raw.name);
    if (!name) return null;
    const color = /^#[0-9a-f]{6}$/i.test(String(raw.color || "")) ? String(raw.color).toLowerCase() : "#7d8da8";
    return { id: String(raw.id || "cat-" + categoryKey(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).slice(0, 100), name, color, notify: cleanCategoryNotify(raw.notify), agenda: cleanAgendaWindow(raw.agenda) };
  }
  // Validates and normalises anything that claims to be an item. Returns a fresh object or null.
  // An event without a usable end gets one hour (or one day when all-day); a reminder never has an end.
  function cleanItem(raw, now = 0) {
    if (!raw || typeof raw !== "object") return null;
    const start = cleanWhen(raw.start);
    if (!start) return null;
    const x = raw.x && typeof raw.x === "object" ? raw.x : {};
    const kind = KINDS.includes(x.kind) ? x.kind : raw.end ? "event" : "reminder";
    const allDay = !!start.date;
    let end;
    if (kind === "event") {
      end = cleanWhen(raw.end);
      if (end && (!!end.date !== allDay || whenMs(end) <= whenMs(start))) end = null;
      if (!end) end = allDay ? { date: ymd(new Date(addDays(whenMs(start), 1))) } : { dateTime: iso(whenMs(start) + 60 * MIN) };
    }
    const status = ["confirmed", "tentative", "cancelled"].includes(raw.status) ? raw.status : "confirmed";
    const minutes = (raw.reminders?.overrides || []).filter((o) => o && Number.isFinite(+o.minutes) && +o.minutes >= 0 && +o.minutes <= 40320)
      .slice(0, 5).map((o) => ({ method: o.method === "email" ? "email" : "popup", minutes: Math.round(+o.minutes) }));
    const item = {
      id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 120) : makeId(raw.summary),
      summary: String(raw.summary ?? "").slice(0, MAX_TEXT),
      description: String(raw.description ?? "").slice(0, MAX_DESC),
      start, status,
      updated: typeof raw.updated === "string" && Number.isFinite(Date.parse(raw.updated)) ? raw.updated : iso(now || Date.now()),
      // Monotonic per-record revision breaks same-millisecond write ties across the calendar and Markdown writers.
      rev: Number.isSafeInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 0,
      recurrence: Array.isArray(raw.recurrence) ? raw.recurrence.filter((r) => typeof r === "string" && /^(RRULE|EXRULE|RDATE|EXDATE)(?:;[A-Z0-9-]+=[^:;]+)*:/i.test(r)).slice(0, 20) : [],
      reminders: { overrides: minutes },
      x: {
        kind, noteId: String(x.noteId ?? "").slice(0, 120), heading: String(x.heading ?? "").slice(0, MAX_TEXT),
        category: cleanCategoryName(x.category), tz: cleanZone(x.tz), historyId: String(x.historyId ?? "").slice(0, 120), src: ["list", "note", "manual"].includes(x.src) ? x.src : "manual", key: String(x.key ?? "").slice(0, 60), legacyKey: String(x.legacyKey ?? "").slice(0, 60), moved: x.moved ? "1" : "", calNote: String(x.calNote ?? "").slice(0, MAX_DESC), notify: cleanNotifyOverrides(x.notify), agendaWindow: cleanAgendaWindow(x.agendaWindow), recurrenceExceptions: cleanRecurrenceExceptions(x.recurrenceExceptions, allDay),
      },
    };
    if (end) item.end = end;
    item.etag = typeof raw.etag === "string" && raw.etag ? raw.etag : etagOf(item);
    return item;
  }
  const makeItem = (input, now) => cleanItem(input, now);
  // [startMs, endMs) of an item. A reminder is a point (end = start); all-day items cover whole local days.
  function itemRange(it) {
    const s = whenMs(it.start);
    return [s, it.end ? whenMs(it.end) : s];
  }
  const isReminder = (it) => it.x.kind === "reminder";
  const isAllDay = (it) => !!it.start.date;
  // Build an item from a parsed list line (parseLine).
  function itemFromLine(parsed, extra = {}, now = 0) {
    if (!parsed) return null;
    const startMs = parsed.startMin < 0 ? parsed.day : addDays(parsed.day, 0) + parsed.startMin * MIN;
    const base = { summary: parsed.summary, x: { ...extra } };
    if (parsed.startMin < 0) {
      base.start = { date: ymd(new Date(parsed.day)) };
      if (extra.kind === "event") base.end = { date: ymd(new Date(addDays(parsed.day, 1))) };
      else base.x.kind = "reminder";
    } else {
      base.start = { dateTime: iso(startMs) };
      if (parsed.endMin >= 0) {
        // A range that ends at or before its start crosses midnight. Equal clocks mean a full 24-hour event.
        const endDay = parsed.endMin <= parsed.startMin ? addDays(parsed.day, 1) : parsed.day;
        base.end = { dateTime: iso(endDay + parsed.endMin * MIN) };
        base.x.kind = "event";
      } else base.x.kind = "reminder";
    }
    return cleanItem(base, now);
  }

  // ---------- views ----------
  const live = (it) => it.status !== "cancelled";
  // Items that touch [from, to). Events overlap when start < to and end > from; reminders when start is inside.
  function itemsInRange(items, from, to) {
    return items.filter((it) => {
      if (!live(it)) return false;
      const [s, e] = itemRange(it);
      return isReminder(it) ? s >= from && s < to : s < to && e > from;
    }).sort((a, b) => itemRange(a)[0] - itemRange(b)[0] || itemRange(b)[1] - itemRange(a)[1] || (a.id < b.id ? -1 : 1));
  }
  // Month grid: 6 weeks x 7 days of local midnights; weekStart 0 = Sunday, 1 = Monday.
  function monthGrid(year, month, weekStart = 1) {
    const first = new Date(year, month, 1);
    const lead = (first.getDay() - weekStart + 7) % 7;
    const days = [];
    for (let i = 0; i < 42; i++) days.push(new Date(year, month, 1 - lead + i).getTime());
    return Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));
  }
  // Seven local midnights containing `day`; defaults to Monday-first to match the month view.
  function weekDays(day, weekStart = 1) {
    const start = dayStart(day), offset = (new Date(start).getDay() - ((Number(weekStart) || 0) + 7) % 7 + 7) % 7;
    const first = addDays(start, -offset);
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }
  // [{ day, items }] for `count` days from `from` (local midnight). Multi-day events appear on every day they cover.
  function daysForward(items, from, count) {
    const n = Math.max(1, Math.min(366, Math.floor(count) || 1));
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = addDays(from, i);
      out.push({ day: d, items: itemsInRange(items, d, addDays(d, 1)) });
    }
    return out;
  }
  // Side-by-side columns for the TIMED events of one day, so overlapping events never hide each other.
  // Returns [{ item, lane, lanes, startMin, endMin }]: `lanes` = columns in the item's overlap cluster (width = 1/lanes).
  function layoutDay(items, day, zone = "") {
    const dateKey = localDateKey(day), bounds = zone ? zonedDayBounds(dateKey, zone) : [day, addDays(day, 1)];
    const d0 = bounds[0], d1 = bounds[1];
    const rows = itemsInRange(items, d0, d1).filter((it) => !isReminder(it) && !isAllDay(it)).map((it) => {
      const [s, e] = itemRange(it);
      return { item: it, s: Math.max(s, d0), e: Math.min(e, d1) };
    });
    const out = [];
    let cluster = [], clusterEnd = -Infinity;
    const flush = () => {
      const laneEnds = [];
      for (const r of cluster) {
        let lane = laneEnds.findIndex((end) => end <= r.s);
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(r.e); } else laneEnds[lane] = r.e;
        r.lane = lane;
      }
      for (const r of cluster) out.push({ item: r.item, lane: r.lane, lanes: laneEnds.length,
        startMin: zone ? Math.round(zonedMinuteOfDay(r.s, dateKey, zone)) : Math.round((r.s - d0) / MIN),
        endMin: zone ? Math.round(zonedMinuteOfDay(r.e, dateKey, zone)) : Math.round((r.e - d0) / MIN) });
      cluster = []; clusterEnd = -Infinity;
    };
    for (const r of rows) {
      if (cluster.length && r.s >= clusterEnd) flush();
      cluster.push(r); clusterEnd = Math.max(clusterEnd, r.e);
    }
    if (cluster.length) flush();
    return out;
  }
  // Merged "taken" ranges [[s,e],...] of timed and all-day events in [from, to); reminders take no time.
  function busyRanges(items, from, to) {
    // Expand masters here so callers such as freeSlots cannot accidentally ignore a recurring event. Already-expanded
    // occurrences carry x.series and are range-filtered without expanding their copied RRULE a second time.
    const rs = expandRange(items, from, to).filter((it) => !isReminder(it)).map((it) => { const [s, e] = itemRange(it); return [Math.max(s, from), Math.min(e, to)]; }).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of rs) {
      if (out.length && r[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], r[1]);
      else out.push([r[0], r[1]]);
    }
    return out;
  }
  // Next items from `now` (running events first), at most `limit`.
  function upcoming(items, now, limit = 20) {
    return items.filter((it) => { if (!live(it)) return false; const [s, e] = itemRange(it); return isReminder(it) ? s >= now : e > now; })
      .sort((a, b) => Math.max(itemRange(a)[0], now) - Math.max(itemRange(b)[0], now) || (a.id < b.id ? -1 : 1)).slice(0, Math.max(0, limit));
  }

  // ---------- dragging ----------
  const snapTo = (ms, snapMin) => { const st = Math.max(1, Math.round(snapMin || 15)) * MIN; return Math.round(ms / st) * st; };
  // Move an item by deltaMs (snapped to the step). Returns a new item; all-day items move by whole days.
  function moveItem(it, deltaMs, snapMin = 15, now = Date.now()) {
    const copy = JSON.parse(JSON.stringify(it));
    if (isAllDay(it)) {
      const days = Math.round(deltaMs / DAY_MS);
      copy.start = { date: ymd(new Date(addDays(whenMs(it.start), days))) };
      if (it.end) copy.end = { date: ymd(new Date(addDays(whenMs(it.end), days))) };
    } else {
      const [s, e] = itemRange(it);
      const ns = snapTo(s + deltaMs, snapMin);
      copy.start = { dateTime: iso(ns) };
      if (it.end) copy.end = { dateTime: iso(ns + (e - s)) };
    }
    const stamp = typeof now === "function" ? now() : Number(now);
    return cleanItem({ ...copy, etag: "", updated: iso(Number.isFinite(stamp) ? stamp : Date.now()) }, 0);
  }
  // Convert a grid gesture into a civil target without touching storage or repeatedly
  // resolving a time zone while the pointer moves. The grabbed segment may be a
  // clipped continuation of a multi-day event, so the delta is relative to the
  // pointer's original day, not the event's first visible day.
  function calendarMovePlacement(item, originKey, originMinute, targetKey, targetMinute, zone = "", snapMin = 15) {
    const origin = parseYmd(originKey), target = parseYmd(targetKey), start = item?.start?.dateTime ? Date.parse(item.start.dateTime) : NaN;
    if (!origin || !target || !Number.isFinite(start) || !Number.isFinite(originMinute) || !Number.isFinite(targetMinute)
        || originMinute < 0 || originMinute > 1440 || targetMinute < 0 || targetMinute > 1440 || (zone && !cleanZone(zone))) return null;
    const parts = zoneParts(start, zone);
    if (!parts) return null;
    const dayIndex = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
    const step = Math.max(1, Math.min(1440, Math.round(Number(snapMin) || 15)));
    const minutes = Math.round((parts.hour * 60 + parts.minute + (dayIndex(target) - dayIndex(origin)) * 1440 + targetMinute - originMinute) / step) * step;
    const wall = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + minutes * MIN);
    const date = String(wall.getUTCFullYear()).padStart(4, "0") + "-" + p2(wall.getUTCMonth() + 1) + "-" + p2(wall.getUTCDate());
    if (!parseYmd(date)) return null;
    return { date, minute: wall.getUTCHours() * 60 + wall.getUTCMinutes() };
  }
  // Moving an expanded recurring occurrence requires a scope chooser; legacy note
  // reminders and all-day items use separate paths and are never accepted here.
  function calendarMoveTimedEvent(item, placement, zone = "", now = Date.now()) {
    if (!item || isReminder(item) || isAllDay(item) || !item.start?.dateTime || !item.end?.dateTime || item.x?.src === "note"
        || item.x?.series || (item.recurrence || []).length || !parseYmd(placement?.date)
        || !Number.isInteger(placement?.minute) || placement.minute < 0 || placement.minute >= 1440 || (zone && !cleanZone(zone))) return null;
    const [start, end] = itemRange(item);
    if (!(Number.isFinite(start) && end > start)) return null;
    const clock = p2(Math.floor(placement.minute / 60)) + ":" + p2(placement.minute % 60);
    const target = zonedDateTimeToMs(placement.date, clock, zone);
    if (!Number.isFinite(target)) return null;
    const stamp = typeof now === "function" ? now() : Number(now);
    return cleanItem({ ...item, start: { dateTime: iso(target) }, end: { dateTime: iso(target + end - start) },
      x: { ...item.x, moved: item.x?.src === "list" ? "1" : item.x?.moved }, etag: "", updated: iso(Number.isFinite(stamp) ? stamp : Date.now()) }, 0);
  }
  // Move one edge of an event ("start" or "end"); never shorter than one snap step. Reminders have no end.
  function resizeItem(it, edge, deltaMs, snapMin = 15, now = Date.now()) {
    if (isReminder(it) || isAllDay(it) || !it.end) return it;
    const [s, e] = itemRange(it), step = Math.max(1, Math.round(snapMin)) * MIN;
    let ns = s, ne = e;
    if (edge === "start") ns = Math.min(snapTo(s + deltaMs, snapMin), e - step);
    else ne = Math.max(snapTo(e + deltaMs, snapMin), s + step);
    const stamp = typeof now === "function" ? now() : Number(now);
    return cleanItem({ ...JSON.parse(JSON.stringify(it)), start: { dateTime: iso(ns) }, end: { dateTime: iso(ne) }, etag: "", updated: iso(Number.isFinite(stamp) ? stamp : Date.now()) }, 0);
  }

  // ---------- Google shape ----------
  // The plain Google event resource for an item (our `x` goes into extendedProperties.private, as Google allows).
  function toGoogle(it) {
    const priv = {};
    for (const [k, v] of Object.entries(it.x)) if (v !== "" && v !== undefined && v !== null && !(Array.isArray(v) && !v.length)) priv["zentral_" + k] = ["notify", "recurrenceExceptions", "agendaWindow"].includes(k) ? JSON.stringify(v) : String(v);
    const out = { id: it.id, summary: it.summary, description: it.description, status: it.status, start: it.start, updated: it.updated, extendedProperties: { private: priv } };
    out.end = it.end || it.start;
    if (it.recurrence.length) out.recurrence = it.recurrence;
    if (it.reminders.overrides.length) out.reminders = { useDefault: false, overrides: it.reminders.overrides };
    return out;
  }
  function fromGoogle(g) {
    if (!g || typeof g !== "object") return null;
    const priv = g.extendedProperties?.private || {};
    const x = {};
    for (const k of ["kind", "noteId", "heading", "category", "tz", "src", "key", "legacyKey", "moved", "calNote", "notify", "agendaWindow", "recurrenceExceptions", "historyId"]) if (priv["zentral_" + k] !== undefined) {
      if (["notify", "agendaWindow", "recurrenceExceptions"].includes(k)) { try { x[k] = JSON.parse(priv["zentral_" + k]); } catch (_) {} }
      else x[k] = priv["zentral_" + k];
    }
    const sameEnd = g.end && JSON.stringify(g.end) === JSON.stringify(g.start);
    return cleanItem({ id: g.id, summary: g.summary, description: g.description, status: g.status, start: g.start, end: sameEnd ? undefined : g.end,
      updated: g.updated, recurrence: g.recurrence, reminders: g.reminders, x: { ...x, kind: x.kind || (sameEnd ? "reminder" : "event") } }, 0);
  }


  // ---------- items inside a note (roadmap T2.3) ----------
  // A section of a note becomes calendar items when a marker line `%%calendar: Category%%` stands in it (an Obsidian
  // comment, so other apps show nothing). The section runs to the next heading of the same or a higher level (or the
  // next marker; a marker above every heading runs to the end). Every list line in it that starts with a date and/or a
  // time becomes one item; under a heading that is itself a date (`## 2026-11-25`) the date may be left out.
  const MARKER_RE = /^\s*%%\s*calendar\s*(?::\s*([^%]*?))?\s*%%\s*$/i;
  function calendarSectionAt(body, offset = 0) {
    const text = String(body || ""), pos = Math.max(0, Math.min(text.length, Number(offset) || 0));
    let lineStart = 0, heading = { level: 0, text: "" }, section = null, fence = "";
    const lines = text.split("\n");
    for (const line of lines) {
      const lineEnd = lineStart + line.length;
      if (lineStart > pos) break;
      const f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (pos <= lineEnd) return null; // a caret on a fence delimiter is still inside a code block
        fence = !fence ? f[1][0] : (f[1][0] === fence ? "" : fence);
        lineStart = lineEnd + 1;
        continue;
      }
      if (fence) {
        if (pos <= lineEnd) return null;
        lineStart = lineEnd + 1;
        continue;
      }
      if (!fence) {
        const hm = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
        if (hm) {
          const next = { level: hm[1].length, text: hm[2] };
          if (section && next.level <= section.level) section = null;
          heading = next;
        } else {
          const mk = MARKER_RE.exec(line);
          if (mk) section = { category: cleanCategoryName(mk[1] || ""), level: heading.level, lineStart, lineEnd, heading: heading.text };
        }
      }
      if (pos <= lineEnd) return section;
      lineStart = lineEnd + 1;
    }
    return section;
  }
  function setCalendarSectionCategory(body, offset, name) {
    const text = String(body || ""), category = cleanCategoryName(name);
    if (!category) return null;
    const section = calendarSectionAt(text, offset);
    if (!section) {
      const pos = Math.max(0, Math.min(text.length, Number(offset) || 0));
      let lineStart = 0, fence = "";
      for (const line of text.split("\n")) {
        const lineEnd = lineStart + line.length;
        if (lineStart > pos) break;
        const marker = /^\s*(`{3,}|~{3,})/.exec(line);
        if (marker) fence = !fence ? marker[1][0] : (marker[1][0] === fence ? "" : fence);
        if (pos <= lineEnd) break;
        lineStart = lineEnd + 1;
      }
      if (fence) return null; // never insert a calendar marker into a code fence
    }
    const marker = `%%calendar: ${category}%%`;
    if (section) {
      const next = text.slice(0, section.lineStart) + marker + text.slice(section.lineEnd);
      return { body: next, created: false, category, lineStart: section.lineStart, delta: next.length - text.length };
    }
    const pos = Math.max(0, Math.min(text.length, Number(offset) || 0));
    const lineStart = text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
    const prefix = text.slice(0, lineStart), suffix = text.slice(lineStart);
    const before = prefix && !prefix.endsWith("\n\n") ? "\n" : "";
    const insertion = (before ? "\n" : "") + marker + "\n";
    const next = prefix + (before ? "\n" : "") + insertion.slice(before.length) + suffix;
    return { body: next, created: true, category, lineStart: lineStart + (before ? 1 : 0), delta: next.length - text.length };
  }
  const hashText = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  // Inline Obsidian-style comments carry identity for note-derived items without adding visible Markdown. The token
  // travels with its list line when the owner reorders or edits other lines, so identical entries keep independent extras.
  const ITEM_ID_RE = /%%\s*zn-item-id:([a-z0-9_-]{4,60})\s*%%/gi;
  function itemIdTokens(line) { return [...String(line || "").matchAll(ITEM_ID_RE)].map((m) => m[1]); }
  const stripItemIdMarks = (line) => String(line || "").replace(ITEM_ID_RE, "");
  function parseMarkedLine(line, heading, now) {
    const ignored = ignoredDateTokens(line);
    let sourceLine = stripItemIdMarks(stripDateIgnoreMarks(line));
    const listText = sourceLine.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s+)?/, "");
    const prefix = parseDatePrefix(listText, now);
    // Ignoring a leading date disables that trigger; a dated heading may still supply its own date.
    if (prefix && ignored.some((raw) => raw === prefix.raw.toLowerCase() || raw.startsWith(prefix.raw.toLowerCase() + " "))) {
      const at = sourceLine.indexOf(prefix.raw);
      if (at >= 0) sourceLine = sourceLine.slice(0, at) + sourceLine.slice(at + prefix.raw.length);
    }
    const dayOfHeading = heading.text ? (parseDatePrefix(heading.text, now)?.day ?? null) : null;
    return { sourceLine, parsed: parseLine(sourceLine, now, dayOfHeading) };
  }
  function visitCalendarListLines(body, now, visit) {
    const lines = String(body || "").split("\n");
    let fence = "", heading = { level: 0, text: "" }, sec = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (f) { fence = !fence ? f[1][0] : (f[1][0] === fence ? "" : fence); continue; }
      if (fence) continue;
      const hm = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (hm) {
        heading = { level: hm[1].length, text: hm[2] };
        if (sec && sec.level > 0 && heading.level <= sec.level) sec = null;
        continue;
      }
      const mk = MARKER_RE.exec(line);
      if (mk) { sec = { category: (mk[1] || "").trim().slice(0, 80), level: heading.level }; continue; }
      if (!sec) continue;
      const result = parseMarkedLine(line, heading, now);
      if (result.parsed) visit({ index: i, line, heading, category: sec.category, ...result });
    }
    return lines;
  }
  function ensureNoteItemIds(body, noteId, now = 0) {
    const lines = String(body || "").split("\n"), seen = new Set();
    let changed = false;
    visitCalendarListLines(body, now, (entry) => {
      const ids = itemIdTokens(entry.line);
      let id = ids.find((candidate) => !seen.has(candidate)) || "";
      if (!id) id = makeId([noteId, entry.index, entry.sourceLine, seen.size].join("|"));
      // Existing duplicate tokens can happen when a user duplicates a whole Markdown line. Keep the first ID and
      // generate a fresh one for the copied line so its metadata cannot collide with the original.
      if (seen.has(id)) id = makeId([noteId, entry.index, entry.sourceLine, seen.size, Math.random()].join("|"));
      seen.add(id);
      if (ids.length !== 1 || ids[0] !== id) {
        const without = stripItemIdMarks(entry.line);
        const trailing = /\s*$/.exec(without)?.[0] || "";
        const core = trailing ? without.slice(0, -trailing.length) : without;
        lines[entry.index] = core + " %%zn-item-id:" + id + "%%" + trailing;
        changed = true;
      }
    });
    return { body: changed ? lines.join("\n") : String(body || ""), changed, count: seen.size };
  }
  // The jump target for note-less items: a `## Agenda` heading in their date note. An existing heading of any level
  // and letter case is reused; nothing else in the note changes.
  function ensureAgendaHeading(body) {
    const text = String(body || "");
    if (/^#{1,6}\s+agenda\s*#*\s*$/im.test(text)) return { body: text, heading: "Agenda", changed: false };
    const trimmed = text.replace(/\s+$/, "");
    return { body: (trimmed ? trimmed + "\n\n" : "") + "## Agenda\n", heading: "Agenda", changed: true };
  }
  // ---- Reschedule -> note text ----
  const pad2c = (n) => String(n).padStart(2, "0");
  const clockText = (ms) => { const d = new Date(ms); return pad2c(d.getHours()) + ":" + pad2c(d.getMinutes()); };
  const LINE_HEAD_RE = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[^\]]\]\s+)?)(.*)$/s;
  const LINE_TIME_RE = /^(\d{1,2}[:.]\d{2}(?:\s*[-\u2013\u2014]\s*\d{1,2}[:.]\d{2})?)(?=\s|$)/;
  // Pure: the list line with its leading date (and time range) replaced by the item's current schedule, written as
  // ISO `YYYY-MM-DD [HH:MM[-HH:MM]]` in local time. Box, text, hidden id mark and every other character stay.
  // Returns null when the line has no leading date of its own (the date comes from a heading), carries a date-ignore
  // mark, or the item has no usable schedule: the caller then leaves the text alone.
  function rewriteLineSchedule(line, item, now = 0) {
    const text = String(line || "");
    if (!item || ignoredDateTokens(text).length || /%%\s*not-date/i.test(text)) return null;
    const head = LINE_HEAD_RE.exec(text);
    if (!head) return null;
    const afterBox = head[2], prefix = parseDatePrefix(stripItemIdMarks(afterBox), now);
    if (!prefix || afterBox.indexOf(prefix.raw) !== 0 || /^\d{1,2}[:.]\d{2}$/.test(prefix.raw)) return null;
    let rest = afterBox.slice(prefix.raw.length);
    const lead = /^\s*/.exec(rest)[0];
    rest = rest.slice(lead.length);
    const t = LINE_TIME_RE.exec(rest);
    if (t) rest = rest.slice(t[1].length);
    const [startMs, endMs] = itemRange(item);
    if (!Number.isFinite(startMs) || startMs <= 0) return null;
    let when = ymd(new Date(startMs));
    if (!isAllDay(item)) when += " " + clockText(startMs) + (item.end && Number.isFinite(endMs) && endMs > startMs ? "-" + clockText(endMs) : "");
    const gap = rest && !/^\s/.test(rest) ? " " : "";
    return head[1] + when + gap + rest;
  }
  function setListLineSchedule(body, lineId, item, now = 0) {
    const lines = String(body || "").split("\n");
    let found = false, changed = false;
    visitCalendarListLines(body, now, (entry) => {
      if (found || itemIdTokens(entry.line)[0] !== lineId) return;
      found = true;
      const next = rewriteLineSchedule(entry.line, item, now);
      if (next === null || next === entry.line) return;
      lines[entry.index] = next; changed = true;
    });
    return { body: changed ? lines.join("\n") : String(body || ""), changed, found };
  }
  // ---- Mirror a note-less item as an Agenda list line (B3.3.32-7) ----
  const AGENDA_HEAD_RE = /^(#{1,6})\s+agenda\s*#*\s*$/i;
  const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s/;
  const isRecurringItem = (item) => !!item?.x?.series || (Array.isArray(item?.recurrence) && item.recurrence.length > 0);
  // Pure: the `- [ ] YYYY-MM-DD [HH:MM[-HH:MM]] Summary %%zn-item-id:ID%%` line that represents `item`, or null when a
  // list line cannot say the same thing (recurring, all-day event, event of 24 h or more, seconds, text the line parser
  // would read differently). The result is re-parsed with the real extractor and must give back the same summary, kind,
  // start and end, so mirroring never changes what the calendar shows.
  function agendaMirrorLine(item, { lineId = "", done = false, now = 0 } = {}) {
    if (!item || typeof item !== "object" || isRecurringItem(item)) return null;
    const summary = String(item.summary ?? "").replace(/\s+/g, " ").trim();
    if (!summary || /%%/.test(summary)) return null;
    const [startMs, endMs] = itemRange(item);
    if (!Number.isFinite(startMs) || startMs <= 0) return null;
    const allDay = isAllDay(item), event = !isReminder(item);
    let when = ymd(new Date(startMs));
    if (allDay) { if (event) return null; }
    else {
      when += " " + clockText(startMs);
      if (event) {
        if (!(item.end && Number.isFinite(endMs) && endMs > startMs && endMs - startMs < 24 * 60 * MIN)) return null;
        when += "-" + clockText(endMs);
      }
    }
    // Derived from the item id (not random): two windows mirroring the same item produce the same token.
    const id = /^[a-z0-9_-]{4,60}$/i.test(String(lineId)) ? String(lineId) : "zm" + hashText(String(item.id)).padStart(6, "0");
    const line = "- [" + (done ? "x" : " ") + "] " + when + " " + summary + " %%zn-item-id:" + id + "%%";
    const back = extractNoteItems("## Agenda\n%%calendar%%\n" + line, "mirror", now)[0];
    if (!back || back.summary !== summary || isReminder(back) !== !event || isAllDay(back) !== allDay) return null;
    const [bs, be] = itemRange(back);
    if (bs !== startMs || (event && be !== endMs)) return null;
    return { line, lineId: id };
  }
  // Pure: `line` added under the note's `## Agenda` heading (created when missing), inside its `%%calendar%%` section
  // (created when missing), after the section's last list line. Nothing else in the note changes.
  function insertAgendaLine(body, line, category = "") {
    const lines = ensureAgendaHeading(body).body.split("\n");
    let hi = -1, level = 0, fence = "";
    for (let i = 0; i < lines.length && hi < 0; i++) {
      const f = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
      if (f) { fence = !fence ? f[1][0] : (f[1][0] === fence ? "" : fence); continue; }
      if (fence) continue;
      const m = AGENDA_HEAD_RE.exec(lines[i]);
      if (m) { hi = i; level = m[1].length; }
    }
    if (hi < 0) {
      // The only "Agenda" heading sits inside a code fence (it is not a heading): add a real section at the end.
      const base = String(body || "").replace(/\s+$/, "");
      return { body: (base ? base + "\n\n" : "") + "## Agenda\n" + (cleanCategoryName(category) ? "%%calendar: " + cleanCategoryName(category) + "%%" : "%%calendar%%") + "\n" + line + "\n", changed: true };
    }
    let end = lines.length;
    fence = "";
    for (let j = hi + 1; j < lines.length; j++) {
      const f = /^\s*(`{3,}|~{3,})/.exec(lines[j]);
      if (f) { fence = !fence ? f[1][0] : (f[1][0] === fence ? "" : fence); continue; }
      if (fence) continue;
      const h = /^(#{1,6})\s/.exec(lines[j]);
      if (h && h[1].length <= level) { end = j; break; }
    }
    // The line joins a section whose marker has the item's category (none = a plain `%%calendar%%`), so the stored
    // category survives the next note sync; otherwise a new marker for that category is added at the end of the block.
    const want = cleanCategoryName(category).toLowerCase();
    let mk = -1;
    for (let j = hi + 1; j < end && mk < 0; j++) {
      const m = MARKER_RE.exec(lines[j]);
      if (m && cleanCategoryName(m[1] || "").toLowerCase() === want) mk = j;
    }
    if (mk >= 0) {
      let pos = mk + 1;
      while (pos < end && LIST_LINE_RE.test(lines[pos])) pos++;
      lines.splice(pos, 0, line);
    } else {
      let last = hi;
      for (let j = hi + 1; j < end; j++) if (lines[j].trim()) last = j;
      const gap = last > hi && LIST_LINE_RE.test(lines[last]) ? [""] : [];
      lines.splice(last + 1, 0, ...gap, want ? "%%calendar: " + cleanCategoryName(category) + "%%" : "%%calendar%%", line);
    }
    return { body: lines.join("\n"), changed: true };
  }
  // Pure: the list line that carries the hidden id `lineId` (null when absent) and the body without it.
  function findAgendaLine(body, lineId) {
    let hit = null;
    visitCalendarListLines(body, 0, (entry) => { if (!hit && itemIdTokens(entry.line)[0] === lineId) hit = { index: entry.index, line: entry.line }; });
    return hit;
  }
  function removeAgendaLine(body, lineId) {
    const hit = findAgendaLine(body, lineId);
    if (!hit) return { body: String(body || ""), changed: false, line: "" };
    const lines = String(body || "").split("\n");
    lines.splice(hit.index, 1);
    return { body: lines.join("\n"), changed: true, line: hit.line };
  }
  // Pure: the stored item re-keyed to its Agenda line. Every extra (calendar note, tz, notify, colour, status, moved,
  // alert overrides) stays; the original identity moves into x.historyId so history stays attached.
  function mirroredItem(item, noteId, lineId, heading = "Agenda") {
    return { ...item, id: noteLineItemId(noteId, lineId), x: { ...item.x, src: "list", noteId, heading, key: lineId, legacyKey: "", historyId: item.x?.historyId || item.id } };
  }
  // ---- Agenda checkbox <-> reminder lifecycle (owner-approved 2026-11-12) ----
  // The stored item id of a line that carries a hidden `%%zn-item-id:...%%` token (same formula as extractNoteItems).
  const noteLineItemId = (noteId, lineId) => "l" + hashText(String(noteId)) + "-" + String(lineId);
  const CHECKBOX_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s)/;
  // Map<lineId, boolean> for every calendar-list line that has BOTH a hidden id and a plain `[ ]` / `[x]` box.
  // Extended task states ([-], [/], [?], [!]) are not a done/pending choice, so they are left out and never rewritten.
  function listCheckboxStates(body, now = 0) {
    const out = new Map();
    visitCalendarListLines(body, now, (entry) => {
      const id = itemIdTokens(entry.line)[0];
      const m = id ? CHECKBOX_LINE_RE.exec(entry.line) : null;
      if (m) out.set(id, m[2] !== " ");
    });
    return out;
  }
  // Pure, idempotent: returns { body, changed, found }. Only the box character of the one line changes; the hidden
  // id mark, date, text and every other line stay byte-identical (marker preservation, rule 3a).
  function setListCheckbox(body, lineId, done, now = 0) {
    const lines = String(body || "").split("\n");
    let found = false, changed = false;
    visitCalendarListLines(body, now, (entry) => {
      if (found || itemIdTokens(entry.line)[0] !== lineId) return;
      const m = CHECKBOX_LINE_RE.exec(entry.line);
      if (!m) return;
      found = true;
      if ((m[2] !== " ") === !!done) return;
      lines[entry.index] = entry.line.replace(CHECKBOX_LINE_RE, "$1" + (done ? "x" : " ") + "$3");
      changed = true;
    });
    return { body: changed ? lines.join("\n") : String(body || ""), changed, found };
  }
  function extractNoteItems(body, noteId, now = 0) {
    const lines = String(body || "").split("\n");
    const out = [], seen = new Map();
    let fence = "", heading = { level: 0, text: "" }, sec = null;
    for (const line of lines) {
      const f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (f) { fence = !fence ? f[1][0] : (f[1][0] === fence ? "" : fence); continue; }
      if (fence) continue;
      const hm = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (hm) {
        heading = { level: hm[1].length, text: hm[2] };
        if (sec && sec.level > 0 && heading.level <= sec.level) sec = null;
        continue;
      }
      const mk = MARKER_RE.exec(line);
      if (mk) { sec = { category: (mk[1] || "").trim().slice(0, 80), level: heading.level }; continue; }
      if (!sec) continue;
      const result = parseMarkedLine(line, heading, now), sourceLine = result.sourceLine, parsed = result.parsed;
      if (!parsed) continue;
      const norm = sourceLine.replace(/\s+/g, " ").trim().toLowerCase() + "|" + heading.text;
      const n = (seen.get(norm) || 0) + 1; seen.set(norm, n);
      const legacyKey = hashText(noteId + "|" + norm) + (n > 1 ? "-" + n : "");
      const lineId = itemIdTokens(line)[0] || "";
      const key = lineId || legacyKey;
      const it = itemFromLine(parsed, { noteId, heading: heading.text, category: sec.category, src: "list", key, legacyKey }, now);
      if (!it) continue;
      it.id = lineId ? "l" + hashText(noteId) + "-" + lineId : "l" + hashText(noteId) + legacyKey;
      it._legacyKey = legacyKey;
      it._lineId = !!lineId;
      if (parsed.yearless) it.recurrence = ["RRULE:FREQ=YEARLY"];
      it.etag = etagOf(it);
      out.push(it);
    }
    return out;
  }
  // The old one-reminder-per-note field shown as items (read only; the scheduler still owns it until T2.7).
  function itemsFromNoteReminders(notes, titleOf = (b) => String(b || "").split("\n")[0]) {
    const out = [];
    for (const n of notes || []) {
      if (!n || n.trashed || !(n.remind > 0)) continue;
      const it = cleanItem({ id: "remind:" + n.id, summary: titleOf(n.body) || "Note", start: { dateTime: iso(n.remind) }, x: { kind: "reminder", noteId: n.id, src: "note" } }, 0);
      if (it) out.push(it);
    }
    return out;
  }

  // ---------- item store ----------
  // All items live in ONE file next to the notes (`calendar.json`), never in the note tree. `io` is the same object the note
  // store uses (readUTF8, writeUTF8). Items made from a note's marked lists (src "list") are rebuilt by syncNote; the person's
  // own additions (src "manual") and the extras on a listed item (calendar note, reminders, status, a moved time) survive.
  const ITEMS_FILE = "calendar.json";
  // Reminder lifecycle is intentionally separate from Google Calendar's `status` field. Records are
  // immutable snapshots in their own versioned file; history is retained indefinitely (no silent pruning).
  const REMINDER_HISTORY_FILE = "reminder-history.json";
  const REMINDER_HISTORY_ACTIONS = Object.freeze(["alerted", "done", "dismissed", "reopened", "snoozed", "rescheduled"]);
  function cleanReminderHistoryRecord(raw, fallbackAt = 0) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const action = REMINDER_HISTORY_ACTIONS.includes(raw.action) ? raw.action : "";
    const itemId = String(raw.itemId || "").trim().slice(0, 120);
    const occurrenceId = String(raw.occurrenceId || itemId).trim().slice(0, 160);
    const stamp = raw.at === undefined || raw.at === null || raw.at === "" ? fallbackAt : raw.at;
    const at = Number.isFinite(Number(stamp)) && Number(stamp) > 0 ? Math.floor(Number(stamp)) : 0;
    if (!action || !itemId || !occurrenceId || !at) return null;
    const start = cleanWhen(raw.start);
    return {
      id: String(raw.id || makeId(itemId + "|" + occurrenceId + "|" + action + "|" + at)).slice(0, 140),
      seq: Number.isSafeInteger(raw.seq) && raw.seq > 0 ? raw.seq : 0,
      itemId, occurrenceId, noteId: String(raw.noteId || "").slice(0, 120),
      summary: String(raw.summary || "").slice(0, MAX_TEXT), start: start ? { ...start } : null,
      action, stage: ["pre", "due", "followup"].includes(raw.stage) ? raw.stage : "", at,
    };
  }
  // Display and cross-window retirement rules for occurrence-scoped reminder cards.
  function reminderAlertPresentation(stage) {
    const value = ["pre", "due", "followup"].includes(stage) ? stage : "followup";
    return { stage: value, rank: value === "pre" ? 1 : value === "due" ? 2 : 3,
      label: value === "pre" ? "Coming up" : value === "due" ? "Due now" : "Reminder overdue" };
  }
  function reminderSnoozeTomorrowMinutes(at) {
    const stamp = Number(at);
    if (!Number.isFinite(stamp)) return 0;
    const date = new Date(stamp);
    date.setDate(date.getDate() + 1);
    const minutes = Math.round((date.getTime() - stamp) / 60000);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  }
  function reminderAlertShouldClose(identity, records, seen = new Set()) {
    if (!identity?.itemId || !identity?.occurrenceId) return false;
    return (records || []).some((record) => record && !seen.has(record.id) &&
      record.itemId === identity.itemId && record.occurrenceId === identity.occurrenceId &&
      ["done", "dismissed", "snoozed", "rescheduled"].includes(record.action));
  }
  function reminderStateAfter(action, current = "pending") {
    if (action === "done") return "done";
    if (action === "dismissed") return "dismissed";
    if (action === "reopened") return "pending";
    // Snoozing/rescheduling changes only when the reminder is due; it never completes or dismisses it.
    return current === "done" || current === "dismissed" ? current : "pending";
  }
  // Stable history identity: an ordinary legacy note reminder has one namespaced state, while
  // recurring note-derived occurrences retain the series ID plus their expanded occurrence ID.
  function reminderIdentity(item) {
    if (!item || typeof item !== "object") return null;
    const x = item.x && typeof item.x === "object" ? item.x : {};
    const noteId = String(x.noteId || "").trim();
    const recurring = !!String(x.series || "") || (Array.isArray(item.recurrence) && item.recurrence.length > 0);
    if (x.src === "note" && noteId && !recurring) {
      const itemId = "note-reminder:" + noteId;
      return { itemId, occurrenceId: itemId, noteId, legacyNote: true };
    }
    // A note-less item mirrored into an Agenda line gets a new line-based id; `x.historyId` keeps its original
    // identity so earlier history (done / snoozed / alerted) stays attached. Recurring series never use it.
    const kept = !recurring ? String(x.historyId || "").trim() : "";
    const itemId = String(x.series || kept || item.id || "").trim();
    if (!itemId) return null;
    return { itemId, occurrenceId: String(kept || item.id || itemId), noteId, legacyNote: false };
  }
  function createReminderHistoryStore({ io, getDir, now = () => Date.now(), setTimer, clearTimer, warn = () => {}, delayMs = 400, onWrite = () => {} }) {
    const records = [];
    const listeners = new Set();
    const emit = (event) => { for (const fn of [...listeners]) { try { fn(event); } catch (error) { safeWarn(error); } } };
    const lifecycle = new Map();
    let nextSeq = 1;
    let dirty = false, timer = null, chain = Promise.resolve(), writeBlocked = false, retryCount = 0;
    const transitionAction = (action) => ["done", "dismissed", "reopened"].includes(action);
    const lifecycleKey = (itemId, occurrenceId) => String(itemId) + "\u0000" + String(occurrenceId);
    const indexTransition = (record) => {
      if (!transitionAction(record.action)) return;
      const key = lifecycleKey(record.itemId, record.occurrenceId), old = lifecycle.get(key);
      if (!old || record.at > old.at || (record.at === old.at && record.seq > old.seq)) lifecycle.set(key, record);
    };
    let storage = { state: "unopened", error: "", backupPath: "" };
    const safeWarn = (error) => { try { warn(error); } catch (_) {} };
    const state = () => ({ ...storage, dirty, writeBlocked, retryCount, count: records.length });
    const scheduleTimer = (ms = delayMs) => {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => { timer = null; writeNow().catch(() => {}); }, ms);
    };
    const schedule = () => { dirty = true; if (!writeBlocked) scheduleTimer(); };
    function writeNow() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      const dir = getDir();
      if (!dirty || !dir) return chain;
      if (writeBlocked) return Promise.reject(new Error("Reminder history is protected because its existing file could not be read safely."));
      const text = JSON.stringify({ v: 1, records: records.map((record) => ({ ...record, start: record.start ? { ...record.start } : null })) });
      dirty = false;
      const task = chain.catch(() => {}).then(async () => {
        try {
          await io.writeUTF8(io.join(dir, REMINDER_HISTORY_FILE), text, { tmpPath: io.join(dir, REMINDER_HISTORY_FILE + ".tmp") });
          try { onWrite(dir); } catch (error) { safeWarn(error); }
          retryCount = 0;
          if (["unopened", "missing", "recovery-pending"].includes(storage.state)) storage = { ...storage, state: "ready", error: "" };
          if (dirty && timer === null && !writeBlocked) scheduleTimer();
          return true;
        } catch (error) {
          dirty = true; retryCount++; safeWarn(error);
          if (retryCount <= 3 && timer === null && !writeBlocked) scheduleTimer(Math.min(delayMs * Math.pow(2, retryCount), 5000));
          throw error;
        }
      });
      chain = task;
      return task;
    }
    return {
      async open() {
        const dir = getDir();
        if (!dir) return state();
        const file = io.join(dir, REMINDER_HISTORY_FILE);
        let text;
        try { text = await io.readUTF8(file); }
        catch (error) {
          const message = String(error?.message || error || "");
          const missing = error?.code === "ENOENT" || error?.name === "NotFoundError" || /(?:^|\b)(?:nf|not found|no such file|does not exist|NS_ERROR_FILE_NOT_FOUND)(?:\b|$)/i.test(message);
          let exists = !missing;
          if (typeof io.exists === "function") { try { exists = await io.exists(file); } catch (_) { exists = true; } }
          if (!exists || missing) {
            records.length = 0; lifecycle.clear(); nextSeq = 1; dirty = false; writeBlocked = false; retryCount = 0;
            storage = { state: "missing", error: "", backupPath: "" };
          } else {
            writeBlocked = true; storage = { state: "unreadable", error: String(error?.message || error), backupPath: "" }; safeWarn(error);
          }
          return state();
        }
        let parsed;
        try {
          parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.v !== 1 || !Array.isArray(parsed.records)) throw new Error("Reminder history has an unsupported or damaged structure.");
          const clean = parsed.records.map((record) => cleanReminderHistoryRecord(record, now()));
          if (clean.some((record) => !record)) throw new Error("Reminder history contains an invalid record.");
          const seen = new Set();
          if (clean.some((record) => seen.has(record.id) || !seen.add(record.id))) throw new Error("Reminder history contains duplicate record IDs.");
          clean.forEach((record, index) => { if (!record.seq) record.seq = index + 1; });
          records.splice(0, records.length, ...clean);
          lifecycle.clear();
          for (const record of records) indexTransition(record);
          nextSeq = records.reduce((max, record) => Math.max(max, record.seq), 0) + 1;
        } catch (error) {
          const stamp = Math.max(0, Math.floor(Number(now()) || Date.now()));
          const base = file + ".corrupt-" + stamp + ".bak";
          let backupPath = base, suffix = 1;
          if (typeof io.exists === "function") { try { while (await io.exists(backupPath)) backupPath = base.replace(/\.bak$/, "-" + (++suffix) + ".bak"); } catch (_) {} }
          let backedUp = false;
          try { await io.writeUTF8(backupPath, String(text), { tmpPath: backupPath + ".tmp" }); backedUp = true; } catch (backupError) { safeWarn(backupError); }
          writeBlocked = true; storage = { state: "corrupt", error: String(error?.message || error), backupPath: backedUp ? backupPath : "" }; safeWarn(error);
          return state();
        }
        dirty = false; writeBlocked = false; retryCount = 0; storage = { state: "ready", error: "", backupPath: "" };
        return state();
      },
      storageState: state,
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      append(raw) {
        if (writeBlocked) return null;
        const record = cleanReminderHistoryRecord({ ...raw, seq: nextSeq, at: raw?.at ?? now() }, now());
        if (!record) return null;
        nextSeq = Math.max(nextSeq + 1, record.seq + 1);
        // Immutable append: duplicate records are allowed because repeated transitions are meaningful.
        records.push(record); indexTransition(record); schedule();
        emit({ kind: "append", action: record.action });
        return { ...record, start: record.start ? { ...record.start } : null };
      },
      // Merge records another window wrote since we last read the file (matched by record id; nothing is dropped or
      // rewritten). Best effort: a missing or damaged file changes nothing here, `open()` owns recovery.
      async refresh() {
        const dir = getDir();
        if (!dir || writeBlocked) return 0;
        let parsed;
        try { parsed = JSON.parse(await io.readUTF8(io.join(dir, REMINDER_HISTORY_FILE))); } catch (_) { return 0; }
        if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.records)) return 0;
        const known = new Set(records.map((record) => record.id));
        let added = 0;
        for (const raw of parsed.records) {
          const record = cleanReminderHistoryRecord(raw, now());
          if (!record || known.has(record.id)) continue;
          known.add(record.id);
          record.seq = nextSeq++;
          records.push(record); indexTransition(record); added++;
        }
        if (added) { dirty = true; emit({ kind: "refresh", count: added }); }
        return added;
      },
      // Cross-window "alert exactly once per saved schedule": re-read the shared file, skip when ANY window already
      // alerted this occurrence for this schedule, otherwise append and write immediately so the other window sees it.
      // The remaining read-to-write gap is a few milliseconds; it can show one extra banner, never lose history.
      async claimAlert(raw) {
        if (writeBlocked) return null;
        try { await this.refresh(); } catch (error) { safeWarn(error); }
        const same = (a, b) => (a?.date || "") === (b?.date || "") && (a?.dateTime || "") === (b?.dateTime || "");
        const requestedStage = ["pre", "due", "followup"].includes(raw.stage) ? raw.stage : "";
        const duplicate = records.some((record) => record.action === "alerted" && record.itemId === raw.itemId && record.occurrenceId === raw.occurrenceId && same(record.start, raw.start) && (record.stage === requestedStage || (!record.stage && requestedStage === "due")));
        if (duplicate) return null;
        const record = this.append({ ...raw, action: "alerted" });
        if (!record) return null;
        try { await writeNow(); } catch (error) { safeWarn(error); }
        return record;
      },
      list({ itemId = "", occurrenceId = "", noteId = "", limit = 0, offset = 0 } = {}) {
        let out = records.filter((record) => (!itemId || record.itemId === itemId) && (!occurrenceId || record.occurrenceId === occurrenceId) && (!noteId || record.noteId === noteId));
        out = out.slice().sort((a, b) => b.at - a.at || b.seq - a.seq);
        const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(10000, Math.floor(Number(limit))) : 0;
        const skip = Number.isFinite(Number(offset)) ? Math.max(0, Math.min(out.length, Math.floor(Number(offset)))) : 0;
        return (max ? out.slice(skip, skip + max) : out.slice(skip)).map((record) => ({ ...record, start: record.start ? { ...record.start } : null }));
      },
      stateFor(itemId, occurrenceId = itemId) {
        const latest = lifecycle.get(lifecycleKey(itemId, occurrenceId));
        // Snooze/reschedule records do not alter lifecycle state; only state transitions enter this index.
        return latest ? reminderStateAfter(latest.action) : "pending";
      },
      flush: writeNow,
    };
  }

  function createItemStore({ io, getDir, now = () => Date.now(), setTimer, clearTimer, warn = () => {}, delayMs = 600, onHistoryWrite = () => {} }) {
    const items = new Map();
    const history = createReminderHistoryStore({ io, getDir, now, setTimer, clearTimer, warn, delayMs, onWrite: onHistoryWrite });
    const categoryDefs = new Map();
    const hidden = new Set(); // noteIds whose items stay stored but are not shown (note in Trash, or its file is missing)
    const listeners = new Set();
    let dirty = false, timer = null, chain = Promise.resolve(), retryCount = 0;
    let storage = { state: "unopened", error: "", backupPath: "" }, writeBlocked = false;
    const shown = (it) => !it.x.noteId || !hidden.has(it.x.noteId);
    const safeWarn = (error) => { try { warn(error); } catch (_) {} };
    const emit = (kind, id) => { for (const fn of [...listeners]) { try { fn(kind, id); } catch (e) { safeWarn(e); } } };
    const state = () => ({ ...storage, dirty, writeBlocked, retryCount });
    const scheduleTimer = (ms = delayMs) => {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => { timer = null; writeNow().catch(() => {}); }, ms);
    };
    const schedule = () => { dirty = true; if (!writeBlocked) scheduleTimer(delayMs); };
    function writeNow() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      const dir = getDir();
      if (!dirty || !dir) return chain;
      if (writeBlocked) {
        const error = new Error("Calendar storage is protected because its existing file could not be read safely.");
        safeWarn(error);
        return Promise.reject(error);
      }
      const text = JSON.stringify({ v: 2, items: [...items.values()], categories: [...categoryDefs.values()] });
      // Clear only for this snapshot. If I/O fails, restore dirty; if a newer edit arrives while writing, its dirty
      // flag remains set and the next queued write stores the newer snapshot.
      dirty = false;
      const task = chain.catch(() => {}).then(async () => {
        try {
          await io.writeUTF8(io.join(dir, ITEMS_FILE), text, { tmpPath: io.join(dir, ITEMS_FILE + ".tmp") });
          retryCount = 0;
          if (storage.state === "unopened" || storage.state === "missing" || storage.state === "recovery-pending") storage = { ...storage, state: "ready", error: "" };
          if (dirty && timer === null && !writeBlocked) scheduleTimer(delayMs);
          return true;
        } catch (error) {
          dirty = true;
          retryCount++;
          safeWarn(error);
          if (retryCount <= 3 && timer === null && !writeBlocked) scheduleTimer(Math.min(delayMs * Math.pow(2, retryCount), 5000));
          throw error;
        }
      });
      chain = task;
      return task;
    }
    return {
      async open() {
        try { await history.open(); } catch (error) { safeWarn(error); }
        const file = io.join(getDir(), ITEMS_FILE);
        let text;
        try {
          text = await io.readUTF8(file);
        } catch (error) {
          const message = String(error?.message || error || "");
          const missingError = error?.code === "ENOENT" || error?.name === "NotFoundError" || /(?:^|\b)(?:nf|not found|no such file|does not exist|NS_ERROR_FILE_NOT_FOUND)(?:\b|$)/i.test(message);
          let exists = !missingError;
          if (typeof io.exists === "function") {
            try { exists = await io.exists(file); } catch (_) { exists = true; }
          }
          if (!exists || missingError) {
            items.clear(); categoryDefs.clear(); hidden.clear(); dirty = false; writeBlocked = false;
            storage = { state: "missing", error: "", backupPath: "" };
          } else {
            // A permission/I/O error is not an empty store. Keep existing in-memory data and prohibit overwriting
            // the unreadable file until the caller explicitly resolves the storage problem.
            writeBlocked = true;
            storage = { state: "unreadable", error: String(error?.message || error), backupPath: "" };
            safeWarn(error);
          }
          emit("reset");
          return state();
        }
        let raw, parsedItems, parsedCategories;
        try {
          raw = JSON.parse(text);
          if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.items) || (raw.categories !== undefined && !Array.isArray(raw.categories)))
            throw new Error("Calendar file has an unsupported or damaged structure.");
          parsedItems = raw.items.map((record) => cleanItem(record, 0));
          parsedCategories = (Array.isArray(raw.categories) ? raw.categories : []).map(cleanCategory);
          if (parsedItems.some((item) => !item) || parsedCategories.some((category) => !category))
            throw new Error("Calendar file contains an invalid item or category record.");
        } catch (error) {
          const stamp = Math.max(0, Math.floor(Number(now()) || Date.now()));
          const baseBackupPath = file + ".corrupt-" + stamp + ".bak";
          let backupPath = baseBackupPath, suffix = 1;
          if (typeof io.exists === "function") {
            try { while (await io.exists(backupPath)) backupPath = baseBackupPath.replace(/\.bak$/, "-" + (++suffix) + ".bak"); } catch (_) {}
          }
          let backedUp = false;
          try {
            await io.writeUTF8(backupPath, String(text), { tmpPath: backupPath + ".tmp" });
            backedUp = true;
          } catch (backupError) { safeWarn(backupError); }
          writeBlocked = true;
          storage = { state: "corrupt", error: String(error?.message || error), backupPath: backedUp ? backupPath : "" };
          safeWarn(error);
          emit("reset");
          return state();
        }
        items.clear(); categoryDefs.clear(); hidden.clear(); dirty = false; writeBlocked = false; retryCount = 0;
        for (const it of parsedItems) if (!items.has(it.id)) items.set(it.id, it);
        for (const category of parsedCategories) categoryDefs.set(categoryKey(category.name), category);
        storage = { state: "ready", error: "", backupPath: "" };
        emit("reset");
        return state();
      },
      storageState: state,
      // This intentionally requires an explicit caller decision. The damaged original has already been copied to
      // `backupPath`; unreadable files (where no backup could be made) cannot be replaced through this API.
      replaceDamagedStore() {
        if (!writeBlocked || storage.state !== "corrupt" || !storage.backupPath) return false;
        writeBlocked = false;
        storage = { ...storage, state: "recovery-pending", error: "" };
        retryCount = 0;
        dirty = true;
        scheduleTimer(0);
        emit("recovery");
        return true;
      },
      list({ noteId = "", kind = "", category = "", includeHidden = false } = {}) {
        // includeHidden is intentionally opt-in: normal calendar views never show Trash items, while
        // destructive-action confirmations still need to count the reminders that would be removed.
        return [...items.values()].filter((it) => (includeHidden || shown(it)) && (!noteId || it.x.noteId === noteId) && (!kind || it.x.kind === kind) && (!category || it.x.category === category));
      },
      get: (id) => { const it = items.get(id); return it && shown(it) ? it : null; },
      has: (id) => { const it = items.get(id); return !!it && shown(it); },
      // `categories()` retains the old live-item view; `categoryList()` is the editable registry used by the UI.
      categories: () => [...new Set([...items.values()].filter(shown).map((it) => it.x.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      category(name) {
        const key = categoryKey(name);
        if (!key) return null;
        const saved = categoryDefs.get(key);
        if (saved) return { ...saved, notify: JSON.parse(JSON.stringify(saved.notify)), agenda: { ...saved.agenda } };
        const preset = DEFAULT_CATEGORIES.find((c) => categoryKey(c.name) === key);
        if (preset) return cleanCategory({ ...preset, notify: DEFAULT_CATEGORY_NOTIFY });
        const used = [...items.values()].find((it) => categoryKey(it.x.category) === key);
        return used ? cleanCategory({ name: used.x.category }) : null;
      },
      categoryList() {
        const names = new Map();
        for (const preset of DEFAULT_CATEGORIES) names.set(categoryKey(preset.name), preset.name);
        for (const c of categoryDefs.values()) names.set(categoryKey(c.name), c.name);
        for (const it of items.values()) if (it.x.category) names.set(categoryKey(it.x.category), it.x.category);
        return [...names.values()].map((name) => this.category(name)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
      },
      upsertCategory(raw) {
        const category = cleanCategory(raw);
        if (!category) return null;
        const key = categoryKey(category.name), old = categoryDefs.get(key);
        if (old && !raw.id) category.id = old.id;
        if (old && JSON.stringify(old) === JSON.stringify(category)) return { ...old, notify: JSON.parse(JSON.stringify(old.notify)), agenda: { ...old.agenda } };
        categoryDefs.set(key, category);
        schedule(); emit("category", key);
        return { ...category, notify: JSON.parse(JSON.stringify(category.notify)), agenda: { ...category.agenda } };
      },
      // A trashed note keeps its items (extras, dragged times) out of sight; restoring it brings them back untouched.
      hideNote(noteId) { if (!noteId || hidden.has(noteId) || ![...items.values()].some((it) => it.x.noteId === noteId)) return false; hidden.add(noteId); emit("remove", noteId); return true; },
      showNote(noteId) { if (!hidden.delete(noteId)) return false; emit("change", noteId); return true; },
      isHidden: (noteId) => hidden.has(noteId),
      upsert(raw) {
        const stamp = now();
        const it = cleanItem({ ...raw, updated: raw?.updated || iso(stamp), etag: "" }, stamp);
        if (!it) return null;
        const old = items.get(it.id);
        if (old) {
          // A modal may still hold the version it opened. Do not let that older snapshot overwrite a newer edit
          // made from the note text (or another calendar editor) while the modal was open.
          if (lwwPick(old, it) !== it) return null;
          it.rev = Math.min(Number.MAX_SAFE_INTEGER, Math.max(old.rev || 0, it.rev || 0) + 1);
        } else {
          it.rev = Math.max(1, it.rev || 0);
        }
        it.updated = iso(stamp);
        it.etag = etagOf(it);
        if (old && JSON.stringify(old) === JSON.stringify(it)) return old;
        if (old && isReminder(it)) {
          const changedStart = JSON.stringify(old.start) !== JSON.stringify(it.start);
          const changedRecurrence = raw?.historyAction === "rescheduled" && !!raw?.occurrenceId
            && JSON.stringify(old.x?.recurrenceExceptions || []) !== JSON.stringify(it.x?.recurrenceExceptions || []);
          if (changedStart || changedRecurrence) {
            const action = raw?.historyAction === "snoozed" ? "snoozed" : "rescheduled";
            const historyStart = cleanWhen(raw?.historyStart) || it.start;
            const ident = it.x.historyId ? reminderIdentity(it) : null;
            const record = history.append({ itemId: ident?.itemId || it.id, occurrenceId: String(raw?.occurrenceId || ident?.occurrenceId || it.id), noteId: it.x.noteId, summary: it.summary, start: historyStart, action, at: stamp });
            if (!record) return null; // Never accept a lifecycle transition that cannot be recorded safely.
          }
        }
        items.set(it.id, it); schedule(); emit("change", it.id);
        return it;
      },
      remove(id) { if (!items.delete(id)) return false; schedule(); emit("remove", id); return true; },
      removeNote(noteId) {
        let n = 0;
        hidden.delete(noteId);
        for (const it of [...items.values()]) if (it.x.noteId === noteId) { items.delete(it.id); n++; }
        if (n) { schedule(); emit("remove", noteId); }
        return n;
      },
      // Auto-managed hidden IDs travel with Markdown lines, giving identical repeated rows stable per-line identity.
      ensureNoteIds(noteId, body) { return ensureNoteItemIds(body, noteId, now()); },
      // Rebuild the note-derived items. During upgrade, migrate extras from legacy IDs using the old content/ordinal key.
      // Thereafter exact line IDs win; unique legacy matches are safe, while an unidentified duplicate never inherits
      // another duplicate's metadata.
      syncNote(noteId, body, { sourceEdit = false, updatedAt = 0 } = {}) {
        const had = [...items.values()].filter((it) => it.x.noteId === noteId && it.x.src === "list");
        if (!had.length && !/%%\s*calendar/i.test(String(body || ""))) return false;
        const fresh = extractNoteItems(body, noteId, now());
        const exact = new Map(had.map((it) => [it.id, it]));
        const byLegacy = new Map();
        for (const it of had) {
          const k = String(it.x.legacyKey || it.x.key || "");
          if (!k) continue;
          if (!byLegacy.has(k)) byLegacy.set(k, []);
          byLegacy.get(k).push(it);
        }
        const group = (key) => String(key || "").replace(/-\d+$/, "");
        const oldCounts = new Map(), newCounts = new Map();
        for (const it of had) { const k = group(it.x.legacyKey || it.x.key); oldCounts.set(k, (oldCounts.get(k) || 0) + 1); }
        for (const it of fresh) { const k = group(it._legacyKey); newCounts.set(k, (newCounts.get(k) || 0) + 1); }
        const usedOld = new Set(), retainedOld = new Set();
        let changed = false;
        for (const f of fresh) {
          let old = exact.get(f.id) || null;
          if (old && usedOld.has(old.id)) old = null;
          if (!old && f._legacyKey) {
            const candidates = (byLegacy.get(f._legacyKey) || []).filter((it) => !usedOld.has(it.id));
            const groupKey = group(f._legacyKey), duplicate = (newCounts.get(groupKey) || 0) > 1 || (oldCounts.get(groupKey) || 0) > 1;
            if (candidates.length === 1 && !duplicate) old = candidates[0];
            else if (duplicate && f._lineId && candidates.length === 1 && !candidates[0].x.legacyKey && candidates[0].x.key === f._legacyKey && oldCounts.get(groupKey) === newCounts.get(groupKey)) old = candidates[0];
          }
          if (old) usedOld.add(old.id);
          // `f.etag` was computed for the parsed revision. Recompute it after applying the store's revision.
          let next = cleanItem({ ...f, rev: 1, etag: "", updated: Number.isFinite(Number(updatedAt)) && Number(updatedAt) > 0 ? iso(Number(updatedAt)) : f.updated }, 0);
          if (old) {
            const revision = sourceEdit ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, old.rev || 0) + 1) : Math.max(0, old.rev || 0);
            const stamp = sourceEdit && Number.isFinite(Number(updatedAt)) && Number(updatedAt) > 0 ? iso(Number(updatedAt)) : old.updated;
            next = cleanItem({ ...f, start: old.start, end: old.end, status: old.status, reminders: old.reminders, recurrence: old.recurrence.length ? old.recurrence : f.recurrence, updated: stamp, rev: revision, etag: "",
              description: f.description || old.description, x: { ...f.x, tz: old.x.tz, calNote: old.x.calNote, moved: old.x.moved, notify: old.x.notify, agendaWindow: old.x.agendaWindow, recurrenceExceptions: old.x.recurrenceExceptions, historyId: old.x.historyId } }, 0);
            next.x.heading = f.x.heading; next.x.category = f.x.category;
            // The text writer is a newer logical version whenever a body edit triggered this sync. Otherwise
            // lwwPick provides the documented equal-version remote-wins tie break while preserving old extras above.
            const winner = lwwPick(old, next);
            next = winner;
            next.etag = etagOf(next);
            if (old.id === next.id) retainedOld.add(old.id);
          }
          if (!old || JSON.stringify(old) !== JSON.stringify(next)) { items.set(next.id, next); changed = true; emit("change", next.id); }
        }
        // A legacy item matched during migration may have a different new ID. Its old record must be replaced,
        // not retained alongside the migrated one.
        for (const it of had) if (!retainedOld.has(it.id)) { items.delete(it.id); changed = true; emit("remove", it.id); }
        if (changed) schedule();
        return changed;
      },
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      history,
      flush() { return Promise.all([writeNow(), history.flush()]); },
    };
  }

  // ---------- calendar view layout (roadmap T2.4a) ----------
  // Keep the orientation decision pure so the sheet can react to its actual available rectangle (not the
  // browser window alone), and the threshold behavior can be regression-tested without Gecko layout.
  const CALENDAR_DENSITIES = Object.freeze(["comfortable", "compact", "extra-compact"]);
  function cleanCalendarDensity(value) { return CALENDAR_DENSITIES.includes(value) ? value : "comfortable"; }
  function calendarDensityHourHeight(value) { return ({ comfortable: 54, compact: 44, "extra-compact": 36 })[cleanCalendarDensity(value)]; }
  const CALENDAR_LAYOUT_MODES = Object.freeze(["auto", "lr", "tb"]);
  function cleanCalendarLayout(value) { return CALENDAR_LAYOUT_MODES.includes(value) ? value : "auto"; }
  function calendarLayoutFor(mode, width, height) {
    const w = Math.max(0, Number(width) || 0), h = Math.max(0, Number(height) || 0);
    const requested = cleanCalendarLayout(mode);
    const orientation = requested === "auto" ? (w >= h * 1.08 ? "lr" : "tb") : requested;
    // Two useful minimum panes: tree >= 230px and calendar >= 280px side-by-side; vertically
    // tree >= 170px and calendar >= 230px. Below that, tabs avoid unusable slivers.
    const tabs = orientation === "lr" ? (w < 560 || h < 260) : (w < 300 || h < 430);
    return { mode: requested, orientation, tabs, width: w, height: h };
  }
  function cleanCalendarShare(value, fallback = 0.36) {
    const n = Number(value);
    return Math.round(Math.max(0.2, Math.min(0.8, Number.isFinite(n) ? n : fallback)) * 1000) / 1000;
  }

  // ---------- all-day strip ----------
  // Items that sit in the strip above the time grid on `day`: all-day events and all-day reminders.
  const allDayOf = (items, day) => itemsInRange(items, day, addDays(day, 1)).filter((it) => isAllDay(it) || (isReminder(it) && isAllDay(it)));

  // ---------- recurrence (RRULE subset: FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY for weekly) ----------
  const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  function parseRule(text) {
    const m = /^RRULE:(.+)$/.exec(String(text || ""));
    if (!m) return null;
    const o = {};
    for (const part of m[1].split(";")) { const [k, v] = part.split("="); if (k && v !== undefined) o[k.toUpperCase()] = v; }
    if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(o.FREQ)) return null;
    const interval = Math.max(1, Math.min(999, parseInt(o.INTERVAL, 10) || 1));
    const count = o.COUNT ? Math.max(1, Math.min(1000000, parseInt(o.COUNT, 10) || 0)) : 0;
    let until = 0;
    if (o.UNTIL) { const u = /^(\d{4})(\d{2})(\d{2})/.exec(o.UNTIL); if (u) until = addDays(new Date(+u[1], +u[2] - 1, +u[3]).getTime(), 1); }
    const byday = o.BYDAY ? [...new Set(o.BYDAY.split(",").map((d) => DAY_CODES.indexOf(d.slice(-2))).filter((n) => n >= 0))].sort((a, b) => a - b) : [];
    return { freq: o.FREQ, interval, count, until, byday };
  }
  // Local calendar-day ordinal, immune to 23/25-hour DST days.
  function localDayOrdinal(ms) {
    const d = new Date(ms);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  }
  function recurrencePeriodIndex(rule, base, targetMs) {
    const target = new Date(targetMs), targetDay = localDayOrdinal(targetMs), baseDay = localDayOrdinal(base.getTime());
    if (rule.freq === "DAILY") return Math.max(0, Math.floor((targetDay - baseDay) / rule.interval) - 1);
    if (rule.freq === "WEEKLY") {
      const targetWeek = targetDay - target.getDay(), baseWeek = baseDay - base.getDay();
      return Math.max(0, Math.floor((targetWeek - baseWeek) / (7 * rule.interval)) - 1);
    }
    if (rule.freq === "MONTHLY") {
      const months = (target.getFullYear() - base.getFullYear()) * 12 + target.getMonth() - base.getMonth();
      return Math.max(0, Math.floor(months / rule.interval) - 1);
    }
    return Math.max(0, Math.floor((target.getFullYear() - base.getFullYear()) / rule.interval) - 1);
  }
  // Occurrence dates for a frequency period. Invalid month/year dates (e.g. the 31st in February) are skipped,
  // matching the existing rule semantics rather than overflowing into the following month.
  function recurrencePeriodDates(rule, base, index) {
    const y = base.getFullYear(), m = base.getMonth(), d = base.getDate();
    if (rule.freq === "DAILY") return [new Date(y, m, d + index * rule.interval)];
    if (rule.freq === "WEEKLY") {
      const week = new Date(y, m, d - base.getDay() + index * 7 * rule.interval);
      const days = rule.byday.length ? rule.byday : [base.getDay()];
      return [...days].sort((a, b) => a - b).map((weekday) => new Date(week.getFullYear(), week.getMonth(), week.getDate() + weekday));
    }
    if (rule.freq === "MONTHLY") {
      const first = new Date(y, m + index * rule.interval, 1);
      const candidate = new Date(first.getFullYear(), first.getMonth(), d);
      return candidate.getDate() === d ? [candidate] : [];
    }
    const candidate = new Date(y + index * rule.interval, m, d);
    return candidate.getFullYear() === y + index * rule.interval && candidate.getMonth() === m && candidate.getDate() === d ? [candidate] : [];
  }
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return Math.abs(a); };
  // COUNT is ordinal from DTSTART. Compute the number before a fast-forwarded period without replaying the history.
  // Daily/weekly are arithmetic; monthly/yearly validity repeats on the Gregorian 400-year cycle.
  function recurrenceCountBefore(rule, base, period) {
    if (period <= 0 || !rule.count) return 0;
    if (rule.freq === "DAILY") return period;
    if (rule.freq === "WEEKLY") {
      const days = rule.byday.length ? rule.byday : [base.getDay()];
      const firstWeekCount = days.filter((weekday) => weekday >= base.getDay()).length;
      return firstWeekCount + (period - 1) * days.length;
    }
    const cycle = (rule.freq === "MONTHLY" ? 4800 : 400) / gcd(rule.freq === "MONTHLY" ? 4800 : 400, rule.interval);
    let fullCycles = Math.floor(period / cycle), remainder = period % cycle;
    let perCycle = 0, tail = 0;
    for (let i = 0; i < cycle; i++) if (recurrencePeriodDates(rule, base, i).length) perCycle++;
    for (let i = 0; i < remainder; i++) if (recurrencePeriodDates(rule, base, i).length) tail++;
    return fullCycles * perCycle + tail;
  }
  function recurrencePeriodAnchor(rule, base, index) {
    const y = base.getFullYear(), m = base.getMonth(), d = base.getDate();
    if (rule.freq === "DAILY") return new Date(y, m, d + index * rule.interval).getTime();
    if (rule.freq === "WEEKLY") return new Date(y, m, d - base.getDay() + index * 7 * rule.interval).getTime();
    if (rule.freq === "MONTHLY") return new Date(y, m + index * rule.interval, 1).getTime();
    return new Date(y + index * rule.interval, m, 1).getTime();
  }
  // RFC 5545 EXDATE values supported offline: VALUE=DATE, UTC DATE-TIME and local floating DATE-TIME.
  function recurrenceExdateSet(it) {
    const out = new Set();
    for (const line of it.recurrence || []) {
      const m = /^EXDATE(?:;[^:]+)?:([^\r\n]+)$/i.exec(line);
      if (!m) continue;
      for (const value of m[1].split(",")) {
        let hit = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
        if (hit) {
          const day = parseYmd(hit[1] + "-" + hit[2] + "-" + hit[3]);
          if (day) out.add(day.getTime());
          continue;
        }
        hit = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(value);
        if (!hit) continue;
        const parts = hit.slice(1, 7).map(Number);
        const ms = hit[7] ? Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5])
          : new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).getTime();
        if (Number.isFinite(ms)) out.add(ms);
      }
    }
    return out;
  }
  function occurrenceShift(exceptions, recurrenceMs, allDay) {
    const applicable = exceptions.filter((entry) => entry.scope !== "this" && whenMs(entry.recurrenceId) <= recurrenceMs)
      .sort((a, b) => whenMs(a.recurrenceId) - whenMs(b.recurrenceId) || (a.scope === "series" ? -1 : 1));
    const chosen = applicable[applicable.length - 1];
    if (!chosen) return 0;
    return allDay ? addDays(recurrenceMs, chosen.shiftDays) - recurrenceMs : chosen.shiftMs;
  }
  function recurrenceSearchMargins(it, allDay) {
    let positive = 0, negative = 0;
    for (const entry of it.x?.recurrenceExceptions || []) {
      let shift = 0;
      if (entry.scope === "this" && !entry.cancelled) shift = whenMs(entry.start) - whenMs(entry.recurrenceId);
      else if (entry.scope !== "this") shift = allDay ? entry.shiftDays * 26 * 60 * MIN : entry.shiftMs;
      positive = Math.max(positive, shift);
      negative = Math.max(negative, -shift);
    }
    return { positive, negative };
  }
  // Occurrences retain their original recurrence key in the ID even when the visible start is overridden.
  // This keeps reminder history and links stable after a move.
  function recurrenceCivilDate(ms, zone = "") {
    const parts = zone ? zoneParts(ms, zone) : null;
    return parts ? new Date(parts.year, parts.month - 1, parts.day) : new Date(ms);
  }
  function recurrenceWallClock(ms, zone = "") {
    const date = new Date(ms), parts = zone ? zoneParts(ms, zone) : null;
    return parts ? { hour: parts.hour, minute: parts.minute, second: parts.second, millisecond: date.getUTCMilliseconds() }
      : { hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(), millisecond: date.getMilliseconds() };
  }
  function recurrenceCandidateMs(date, wall, zone = "") {
    if (!zone) return new Date(date.getFullYear(), date.getMonth(), date.getDate(), wall.hour, wall.minute, wall.second, wall.millisecond).getTime();
    const key = ymd(date), minute = zonedDateTimeToMs(key, p2(wall.hour) + ":" + p2(wall.minute), zone);
    return Number.isFinite(minute) ? minute + wall.second * 1000 + wall.millisecond : NaN;
  }
  function expandItem(it, from, to) {
    const rule = (it.recurrence || []).map(parseRule).find(Boolean);
    if (!rule) return itemsInRange([it], from, to);
    if (!(Number.isFinite(from) && Number.isFinite(to)) || to <= from) return [];
    const [s0, e0] = itemRange(it), len = Math.max(0, e0 - s0), allDay = isAllDay(it), reminder = isReminder(it);
    const allDaySpan = allDay ? Math.max(1, localDayOrdinal(e0) - localDayOrdinal(s0)) : 0;
    const zone = allDay ? "" : cleanZone(it.x?.tz);
    const base = recurrenceCivilDate(s0, zone), wall = recurrenceWallClock(s0, zone);
    const out = [], exceptions = it.x?.recurrenceExceptions || [], exdates = recurrenceExdateSet(it);
    const margins = recurrenceSearchMargins(it, allDay);
    const limit = Math.min(to + margins.negative, rule.until || Infinity);
    if (limit <= s0) return [];
    // Recurrence arithmetic is performed on civil dates in the item's IANA zone, not the host OS zone.
    const seekFrom = (reminder ? from : from - len) - margins.positive;
    let period = recurrencePeriodIndex(rule, base, recurrenceCivilDate(seekFrom, zone).getTime());
    const limitCivil = recurrenceCivilDate(limit, zone).getTime();
    // COUNT is based on original recurrence candidates, never the number remaining after exclusions.
    const countBefore = recurrenceCountBefore(rule, base, period);
    if (rule.count && countBefore >= rule.count) return [];
    let ordinal = countBefore;
    const timedAt = (d) => allDay ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      : recurrenceCandidateMs(d, wall, zone);
    for (let scanned = 0; scanned < 100000; scanned++, period++) {
      if (recurrencePeriodAnchor(rule, base, period) >= limitCivil) break;
      const candidates = recurrencePeriodDates(rule, base, period).map(timedAt).sort((a, b) => a - b);
      for (const recurrenceMs of candidates) {
        if (recurrenceMs < s0) continue;
        if (recurrenceMs >= (rule.until || Infinity)) return out;
        if (rule.count && ordinal >= rule.count) return out;
        ordinal++;
        if (exdates.has(recurrenceMs)) continue;
        const recurrenceId = recurrenceIdWhen(recurrenceMs, allDay);
        const exception = exceptions.find((entry) => entry.scope === "this" && whenMs(entry.recurrenceId) === recurrenceMs);
        if (exception?.cancelled) continue;
        let visibleStart = recurrenceMs + occurrenceShift(exceptions, recurrenceMs, allDay);
        let visibleEnd = allDay ? addDays(visibleStart, allDaySpan) : visibleStart + len;
        if (exception && !exception.cancelled) {
          visibleStart = whenMs(exception.start);
          visibleEnd = exception.end ? whenMs(exception.end) : visibleStart + len;
        }
        const touches = reminder ? visibleStart >= from && visibleStart < to : visibleStart < to && visibleEnd > from;
        if (!touches) continue;
        const occ = JSON.parse(JSON.stringify(it));
        occ.id = recurrenceMs === s0 ? it.id : it.id + "@" + recurrenceMs;
        occ.x.series = it.id;
        occ.x.recurrenceId = String(recurrenceMs);
        occ.start = allDay ? { date: ymd(new Date(visibleStart)) } : { dateTime: iso(visibleStart) };
        if (it.end) occ.end = allDay ? { date: ymd(new Date(visibleEnd)) } : { dateTime: iso(visibleEnd) };
        else delete occ.end;
        out.push(occ);
      }
    }
    return out;
  }

  function isRecurrenceCandidate(master, recurrenceMs) {
    const rule = (master?.recurrence || []).map(parseRule).find(Boolean);
    if (!rule || !Number.isSafeInteger(recurrenceMs) || recurrenceMs < whenMs(master.start) || recurrenceMs >= (rule.until || Infinity)) return false;
    const allDay = isAllDay(master), zone = allDay ? "" : cleanZone(master.x?.tz);
    const base = recurrenceCivilDate(whenMs(master.start), zone);
    const firstPeriod = recurrencePeriodIndex(rule, base, recurrenceCivilDate(recurrenceMs, zone).getTime());
    // The search helper deliberately starts one period early so event spans and BYDAY weeks are not missed.
    // Check that period and its successor to find the candidate's actual COUNT ordinal.
    for (let period = firstPeriod; period <= firstPeriod + 1; period++) {
      const wall = recurrenceWallClock(whenMs(master.start), zone);
      const candidates = recurrencePeriodDates(rule, base, period).map((date) => allDay
        ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
        : recurrenceCandidateMs(date, wall, zone)).sort((a, b) => a - b);
      const index = candidates.findIndex((candidate) => candidate === recurrenceMs);
      if (index < 0) continue;
      const countBefore = recurrenceCountBefore(rule, base, period);
      const priorInPeriod = candidates.slice(0, index).filter((candidate) => candidate >= whenMs(master.start)).length;
      return !rule.count || countBefore + priorInPeriod < rule.count;
    }
    return false;
  }
  function validOccurrenceIdentity(master, occurrence, { allowCancelled = false } = {}) {
    if (!master || !occurrence || occurrence.x?.series !== master.id) return false;
    const recurrenceMs = Number(occurrence.x?.recurrenceId);
    if (!Number.isSafeInteger(recurrenceMs) || recurrenceMs <= 0) return false;
    const expectedId = recurrenceMs === whenMs(master.start) ? master.id : master.id + "@" + recurrenceMs;
    if (occurrence.id !== expectedId || !isRecurrenceCandidate(master, recurrenceMs) || recurrenceExdateSet(master).has(recurrenceMs)) return false;
    const allDay = isAllDay(master), [masterStart, masterEnd] = itemRange(master);
    const span = allDay ? Math.max(1, localDayOrdinal(masterEnd) - localDayOrdinal(masterStart)) : Math.max(0, masterEnd - masterStart);
    const exception = (master.x?.recurrenceExceptions || []).find((entry) => entry.scope === "this" && whenMs(entry.recurrenceId) === recurrenceMs);
    if (exception?.cancelled) {
      if (!allowCancelled) return false;
      // A cancelled occurrence deliberately has no visible start override. Its old rendered object may still
      // carry the pre-cancellation moved time; stable recurrence identity is sufficient to restore it.
      return !!occurrence.start && !!occurrence.start.date === allDay && !!occurrence.end === !!master.end;
    }
    let expectedStart = recurrenceMs + occurrenceShift(master.x?.recurrenceExceptions || [], recurrenceMs, allDay);
    let expectedEnd = allDay ? addDays(expectedStart, span) : expectedStart + span;
    if (exception && !exception.cancelled) {
      expectedStart = whenMs(exception.start);
      expectedEnd = exception.end ? whenMs(exception.end) : (allDay ? addDays(expectedStart, span) : expectedStart + span);
    }
    if (!occurrence.start || whenMs(occurrence.start) !== expectedStart || !!occurrence.end !== !!master.end) return false;
    return !master.end || whenMs(occurrence.end) === expectedEnd;
  }
  function occurrenceMoveRecord(master, occurrence, targetStart, scope) {
    if (!validOccurrenceIdentity(master, occurrence)) return null;
    if (!RECURRENCE_EXCEPTION_SCOPES.includes(scope)) return null;
    const allDay = isAllDay(master), target = cleanWhen(targetStart);
    if (!target || !!target.date !== allDay) return null;
    const recurrenceMs = Number(occurrence.x.recurrenceId);
    const selectedStart = whenMs(occurrence.start), targetMs = whenMs(target);
    const occurrenceEnd = occurrence.end ? whenMs(occurrence.end) : selectedStart;
    const duration = Math.max(0, occurrenceEnd - selectedStart);
    const recurrenceId = recurrenceIdWhen(recurrenceMs, allDay);
    if (scope === "this") {
      const end = occurrence.end ? (allDay
        ? { date: ymd(new Date(addDays(targetMs, Math.max(1, localDayOrdinal(occurrenceEnd) - localDayOrdinal(selectedStart))))) }
        : { dateTime: iso(targetMs + duration) }) : null;
      return { recurrenceId, scope, cancelled: false, start: target, ...(end ? { end } : {}) };
    }
    const selectedShift = allDay ? localDayOrdinal(selectedStart) - localDayOrdinal(recurrenceMs) : selectedStart - recurrenceMs;
    const delta = allDay ? localDayOrdinal(targetMs) - localDayOrdinal(selectedStart) : targetMs - selectedStart;
    if (allDay) return { recurrenceId: scope === "series" ? cleanWhen(master.start) : recurrenceId, scope, shiftDays: selectedShift + delta };
    return { recurrenceId: scope === "series" ? cleanWhen(master.start) : recurrenceId, scope, shiftMs: selectedShift + delta };
  }
  function moveOccurrence(master, occurrence, targetStart, scope, now = Date.now()) {
    if (!master || !(master.recurrence || []).some((line) => parseRule(line))) return null;
    const record = occurrenceMoveRecord(master, occurrence, targetStart, scope);
    if (!record) return null;
    // x.recurrenceId is a millisecond string, not a Google date/dateTime object.
    const anchor = whenMs(record.recurrenceId), selectedAnchor = Number(occurrence.x.recurrenceId);
    const prior = master.x?.recurrenceExceptions || [];
    const exceptions = prior.filter((entry) => {
      const at = whenMs(entry.recurrenceId);
      if (scope === "series") return entry.scope === "this" && entry.cancelled;
      if (scope === "this") return !(entry.scope === "this" && at === selectedAnchor);
      if (entry.scope === "series" || at < anchor) return true;
      return entry.scope === "this" && entry.cancelled;
    });
    if (scope === "series" || scope === "following") {
      const allDay = isAllDay(master), delta = allDay
        ? localDayOrdinal(whenMs(targetStart)) - localDayOrdinal(whenMs(occurrence.start))
        : whenMs(targetStart) - whenMs(occurrence.start);
      for (const entry of prior) {
        const at = whenMs(entry.recurrenceId), applies = scope === "series" || at >= anchor;
        if (!applies || (entry.scope === "this" && at === selectedAnchor) || (scope === "following" && at === anchor && entry.scope === "following")) continue;
        if (entry.scope === "this" && !entry.cancelled) {
          const shiftedStart = allDay ? addDays(whenMs(entry.start), delta) : whenMs(entry.start) + delta;
          const shiftedEnd = entry.end ? (allDay ? addDays(whenMs(entry.end), delta) : whenMs(entry.end) + delta) : 0;
          exceptions.push({ ...entry, start: recurrenceIdWhen(shiftedStart, allDay), ...(entry.end ? { end: recurrenceIdWhen(shiftedEnd, allDay) } : {}) });
        } else if (entry.scope === "following" && at > anchor) {
          exceptions.push({ ...entry, ...(allDay ? { shiftDays: entry.shiftDays + delta } : { shiftMs: entry.shiftMs + delta }) });
        }
      }
    }
    exceptions.push(record);
    const stamp = typeof now === "function" ? now() : Number(now);
    return cleanItem({ ...master, x: { ...master.x, moved: master.x?.src === "list" ? "1" : master.x?.moved, recurrenceExceptions: exceptions }, updated: iso(Number.isFinite(stamp) ? stamp : Date.now()), etag: "" }, 0);
  }
  function cancelOccurrence(master, occurrence, now = Date.now()) {
    if (!master || !validOccurrenceIdentity(master, occurrence)) return null;
    const recurrenceMs = Number(occurrence.x.recurrenceId);
    const allDay = isAllDay(master), recurrenceId = recurrenceIdWhen(recurrenceMs, allDay);
    const exceptions = (master.x?.recurrenceExceptions || []).filter((entry) => !(entry.scope === "this" && whenMs(entry.recurrenceId) === recurrenceMs));
    exceptions.push({ recurrenceId, scope: "this", cancelled: true });
    const stamp = typeof now === "function" ? now() : Number(now);
    return cleanItem({ ...master, x: { ...master.x, moved: master.x?.src === "list" ? "1" : master.x?.moved, recurrenceExceptions: exceptions }, updated: iso(Number.isFinite(stamp) ? stamp : Date.now()), etag: "" }, 0);
  }
  function clearOccurrenceException(master, occurrence, now = Date.now()) {
    if (!master || !validOccurrenceIdentity(master, occurrence, { allowCancelled: true })) return null;
    const recurrenceMs = Number(occurrence.x.recurrenceId);
    const before = master.x?.recurrenceExceptions || [];
    const exceptions = before.filter((entry) => !(entry.scope === "this" && whenMs(entry.recurrenceId) === recurrenceMs));
    if (exceptions.length === before.length) return master;
    const stamp = typeof now === "function" ? now() : Number(now);
    return cleanItem({ ...master, x: { ...master.x, recurrenceExceptions: exceptions }, updated: iso(Number.isFinite(stamp) ? stamp : Date.now()), etag: "" }, 0);
  }
  // Like itemsInRange, but repeating items are expanded.
  function expandRange(items, from, to) {
    return items.filter(live).flatMap((it) => it.x.series ? itemsInRange([it], from, to) : expandItem(it, from, to))
      .sort((a, b) => itemRange(a)[0] - itemRange(b)[0] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // ---------- working hours and free time ----------
  const DEFAULT_WORK = Object.freeze({ days: [1, 2, 3, 4, 5], startMin: 540, endMin: 1020 });
  function cleanWork(w) {
    const o = w && typeof w === "object" ? w : {};
    const days = Array.isArray(o.days) ? [...new Set(o.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : DEFAULT_WORK.days.slice();
    let a = Number.isFinite(+o.startMin) ? Math.round(+o.startMin) : DEFAULT_WORK.startMin, b = Number.isFinite(+o.endMin) ? Math.round(+o.endMin) : DEFAULT_WORK.endMin;
    a = Math.max(0, Math.min(1439, a)); b = Math.max(1, Math.min(1440, b));
    if (b <= a) { a = DEFAULT_WORK.startMin; b = DEFAULT_WORK.endMin; }
    return { days, startMin: a, endMin: b };
  }
  // The working range of one local day as [s, e) ms, or null on a day off. Shade everything outside it.
  function workRange(day, work, zone = "") {
    const w = cleanWork(work), dateKey = localDateKey(day), date = parseYmd(dateKey);
    if (!date || !w.days.includes(date.getDay())) return null;
    if (!zone) return [dayStart(day) + w.startMin * MIN, dayStart(day) + w.endMin * MIN];
    const valid = cleanZone(zone);
    if (!valid) return null;
    const startText = p2(Math.floor(w.startMin / 60)) + ":" + p2(w.startMin % 60);
    const start = zonedDateTimeToMs(dateKey, startText, valid);
    const endKey = w.endMin === 1440 ? localDateKey(addDays(day, 1)) : dateKey;
    const endMinute = w.endMin === 1440 ? 0 : w.endMin;
    const endText = p2(Math.floor(endMinute / 60)) + ":" + p2(endMinute % 60);
    const end = zonedDateTimeToMs(endKey, endText, valid);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [start, end] : null;
  }
  // Free gaps of at least `minMin` minutes between `from` and `to`, optionally only inside working hours.
  // Reminders take no time; all-day events block the whole day only when `blockAllDay` is true.
  function freeSlots(items, from, to, minMin = 60, opts = {}) {
    const zone = cleanZone(opts.zone || "");
    let rangeFrom = from, rangeTo = to;
    if (zone) {
      const fromKey = localDateKey(from), toKey = localDateKey(Math.max(from, to - 1));
      const first = zonedDayBounds(fromKey, zone), last = zonedDayBounds(toKey, zone);
      if (first && last) { rangeFrom = first[0]; rangeTo = last[1]; }
    }
    const busy = busyRanges(items.filter((it) => opts.blockAllDay || !isAllDay(it)), rangeFrom, rangeTo);
    const windows = [];
    if (opts.work) {
      for (let d = dayStart(from); d < to; d = addDays(d, 1)) { const r = workRange(d, opts.work, zone); if (r) windows.push([Math.max(r[0], rangeFrom), Math.min(r[1], rangeTo)]); }
    } else windows.push([rangeFrom, rangeTo]);
    const need = Math.max(1, Math.round(minMin)) * MIN, out = [];
    for (const [ws, we] of windows) {
      let cur = ws;
      for (const [bs, be] of busy) {
        if (be <= cur || bs >= we) continue;
        if (bs - cur >= need) out.push([cur, bs]);
        cur = Math.max(cur, be);
      }
      if (we - cur >= need) out.push([cur, we]);
    }
    return out.filter((r) => r[1] > r[0]);
  }

  // ---------- time zones ----------
  // An IANA zone name the engine knows, or "" (stored in x.tz so a Google sync can keep it).
  function cleanZone(name) {
    const t = String(name || "").trim();
    if (!t) return "";
    try { new Intl.DateTimeFormat("en", { timeZone: t }); return t; } catch (_) { return ""; }
  }
  function zoneParts(ms, zone = "") {
    const z = cleanZone(zone), date = new Date(Number(ms));
    if (!Number.isFinite(date.getTime())) return null;
    try {
      const formatter = new Intl.DateTimeFormat("en-US", { ...(z ? { timeZone: z } : {}), calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
      const parts = Object.create(null);
      for (const part of formatter.formatToParts(date)) if (part.type !== "literal") parts[part.type] = Number(part.value);
      if (![parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].every(Number.isFinite)) return null;
      return parts;
    } catch (_) { return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds() }; }
  }
  function zonedDateKey(ms, zone = "") {
    const parts = zoneParts(ms, zone);
    return parts ? String(parts.year).padStart(4, "0") + "-" + p2(parts.month) + "-" + p2(parts.day) : "";
  }
  function zonedDayBounds(dateKey, zone = "") {
    const date = parseYmd(dateKey);
    if (!date) return null;
    if (!zone) return [date.getTime(), addDays(date.getTime(), 1)];
    const valid = cleanZone(zone);
    if (!valid) return null;
    const nextKey = localDateKey(addDays(date.getTime(), 1));
    const start = zonedDateTimeToMs(dateKey, "00:00", valid), end = zonedDateTimeToMs(nextKey, "00:00", valid);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [start, end] : null;
  }
  function zonedMinuteOfDay(ms, dateKey, zone = "") {
    const date = parseYmd(dateKey);
    if (!date || !Number.isFinite(Number(ms))) return NaN;
    if (!zone) return Math.max(0, Math.min(1440, (Number(ms) - date.getTime()) / MIN));
    const bounds = zonedDayBounds(dateKey, zone);
    if (!bounds) return NaN;
    if (ms <= bounds[0]) return 0;
    if (ms >= bounds[1]) return 1440;
    const parts = zoneParts(ms, zone);
    if (!parts || zonedDateKey(ms, zone) !== dateKey) return NaN;
    return parts.hour * 60 + parts.minute + parts.second / 60;
  }
  // "HH:MM" of an instant in a zone ("" = the local zone).
  function clockIn(ms, zone) {
    const parts = zoneParts(ms, zone);
    return parts ? p2(parts.hour) + ":" + p2(parts.minute) : "--:--";
  }

  // ---------- text of a week (print / export) ----------
  // Markdown for the 7 days from `weekFrom` (local midnight): one heading per day, one line per item, reminders marked.
  function weekText(items, weekFrom, opts = {}) {
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const lines = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekFrom, i);
      lines.push("## " + names[new Date(d).getDay()] + " " + ymd(new Date(d)));
      const list = expandRange(items, d, addDays(d, 1));
      if (!list.length) lines.push("- (nothing)");
      for (const it of list) {
        const [s, e] = itemRange(it);
        const when = isAllDay(it) ? "all day" : isReminder(it) ? clockIn(s, it.x.tz) : clockIn(Math.max(s, d), it.x.tz) + "-" + clockIn(Math.min(e, addDays(d, 1)), it.x.tz);
        lines.push("- " + when + " " + (isReminder(it) ? "(reminder) " : "") + it.summary + (it.x.category && opts.category !== false ? " [" + it.x.category + "]" : ""));
      }
      lines.push("");
    }
    return lines.join("\n").trim() + "\n";
  }

  // ---------- date picker model ----------
  // What the mini-calendar draws for a month: 6 weeks of cells with today / selected / other-month flags and how many
  // items fall on each day (for the dots). `selected` = local midnight ms or 0.
  function pickerMonth(year, month, { weekStart = 1, now = 0, selected = 0, items = [] } = {}) {
    const today = now ? dayStart(now) : 0, sel = selected ? dayStart(selected) : 0;
    const grid = monthGrid(year, month, weekStart);
    const first = grid[0][0], last = addDays(grid[5][6], 1);
    const counts = new Map();
    for (const it of expandRange(items, first, last)) {
      const [s, e] = itemRange(it);
      for (let d = Math.max(dayStart(s), first); d < Math.min(isReminder(it) ? s + 1 : e, last); d = addDays(d, 1)) counts.set(d, (counts.get(d) || 0) + 1);
    }
    return grid.map((w) => w.map((d) => ({ day: d, date: new Date(d).getDate(), inMonth: new Date(d).getMonth() === month, today: d === today, selected: d === sel, count: counts.get(d) || 0 })));
  }
  // Month stepping for the picker arrows: { year, month } after `delta` months (works across years).
  function stepMonth(year, month, delta) {
    const d = new Date(year, month + Math.round(delta), 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }
  // Keyboard moves in the picker: arrows = 1 day / 1 week, PageUp/PageDown = 1 month, Home/End = start/end of week.
  function pickerKey(day, key, weekStart = 1) {
    const d = new Date(day);
    switch (key) {
      case "ArrowLeft": return addDays(day, -1);
      case "ArrowRight": return addDays(day, 1);
      case "ArrowUp": return addDays(day, -7);
      case "ArrowDown": return addDays(day, 7);
      case "PageUp": return new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth(), 0).getDate())).getTime();
      case "PageDown": return new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate())).getTime();
      case "Home": return addDays(day, -((d.getDay() - weekStart + 7) % 7));
      case "End": return addDays(day, 6 - ((d.getDay() - weekStart + 7) % 7));
      default: return day;
    }
  }

  // ---------- date display format, agenda buckets, blank-date-note rule, last-write-wins (roadmap T2.14-T2.17) ----------
  // Display strings are NEVER keys: the immutable key is always the local "YYYY-MM-DD" (`localDateKey`).
  const DATE_FORMATS = Object.freeze(["DD-MM-YYYY", "YYYY-MM-DD", "MM/DD/YYYY", "DD.MM.YYYY", "DD/MM/YYYY", "long"]);
  const AGENDA_WINDOW_MAX_DAYS = 31;
  const DEFAULT_DATE_FORMAT = "DD-MM-YYYY";
  const cleanDateFormat = (v) => (DATE_FORMATS.includes(v) ? v : DEFAULT_DATE_FORMAT);
  // Local calendar-day key of an instant; never uses toISOString (UTC shifts a day near midnight).
  const localDateKey = (ms) => (Number.isFinite(Number(ms)) ? ymd(new Date(Number(ms))) : "");
  // "YYYY-MM-DD" key -> text in the chosen format; "" for an invalid key. `locale` only matters for "long".
  function formatDateKey(key, fmt = DEFAULT_DATE_FORMAT, locale) {
    const d = parseYmd(key);
    if (!d) return "";
    const f = cleanDateFormat(fmt);
    const Y = String(d.getFullYear()).padStart(4, "0"), M = p2(d.getMonth() + 1), D = p2(d.getDate());
    if (f === "long") {
      try { return new Intl.DateTimeFormat(locale || undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(d); }
      catch (_) { return Y + "-" + M + "-" + D; }
    }
    return f.replace("YYYY", Y).replace("MM", M).replace("DD", D);
  }
  // Display title of a date-bound note: always derived, never stored as a key.
  const dateNoteTitle = (key, fmt, prefix = "Reminders for ", locale) => { const t = formatDateKey(key, fmt, locale); return t ? prefix + t : ""; };
  // Read an existing date title / Journal heading back into its immutable local ISO key. The selected format is
  // tried first to resolve the inherently ambiguous MM/DD vs DD/MM case; every other supported format is then
  // accepted so changing the display preference never strands older date notes. New generated headings remain ISO.
  function parseDateKeyText(value, preferredFormat = DEFAULT_DATE_FORMAT, locale) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const validKey = (year, month, day) => {
      if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || year < 1000 || year > 9999) return "";
      const key = String(year).padStart(4, "0") + "-" + p2(month) + "-" + p2(day);
      return parseYmd(key) ? key : "";
    };
    let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?=$|[\s,])/.exec(text);
    if (m) return validKey(+m[1], +m[2], +m[3]);
    const patterns = {
      "DD-MM-YYYY": /^(\d{1,2})-(\d{1,2})-(\d{4})(?=$|[\s,])/,
      "YYYY-MM-DD": /^(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[\s,])/,
      "MM/DD/YYYY": /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?=$|[\s,])/,
      "DD.MM.YYYY": /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?=$|[\s,])/,
      "DD/MM/YYYY": /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?=$|[\s,])/,
    };
    const formats = [cleanDateFormat(preferredFormat), ...DATE_FORMATS.filter((f) => f !== cleanDateFormat(preferredFormat))];
    for (const fmt of formats) {
      const pattern = patterns[fmt];
      if (!pattern) continue;
      m = pattern.exec(text);
      if (!m) continue;
      const yearFirst = fmt === "YYYY-MM-DD";
      const a = +m[1], b = +m[2], year = +(yearFirst ? m[1] : m[3]);
      const month = yearFirst ? b : fmt === "MM/DD/YYYY" ? a : b;
      const day = yearFirst ? +m[3] : fmt === "MM/DD/YYYY" ? b : a;
      const key = validKey(year, month, day);
      if (key) return key;
    }
    // `long` follows the active Firefox locale. Read its month lexemes through Intl rather than Date.parse,
    // which only reliably understands English. Day and year remain numeric in the Intl output.
    try {
      const lower = text.toLocaleLowerCase(locale || undefined);
      const yearMatch = /(?:^|[^0-9])(\d{4})(?:$|[^0-9])/.exec(text);
      if (!yearMatch) return "";
      const year = Number(yearMatch[1]);
      const numbers = [...text.matchAll(/\d{1,4}/g)].map((x) => Number(x[0]));
      const day = numbers.find((n) => n !== year && n >= 1 && n <= 31);
      if (!day) return "";
      const monthNames = new Map();
      for (let month = 0; month < 12; month++) {
        for (const sampleDay of [1, 2, 15, 21]) {
          const parts = new Intl.DateTimeFormat(locale || undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).formatToParts(new Date(2026, month, sampleDay));
          const name = parts.find((part) => part.type === "month")?.value;
          if (name) monthNames.set(name.toLocaleLowerCase(locale || undefined), month + 1);
        }
      }
      const names = [...monthNames.keys()].sort((a, b) => b.length - a.length);
      const found = names.find((name) => name && lower.includes(name));
      return found ? validKey(year, monthNames.get(found), day) : "";
    } catch (_) {
      return "";
    }
  }
  // Agenda window: today .. today+days-1 (default 4 days = T..T+3). Counts live items per local day (recurrences expanded); `isDone(item)` is supplied by the reminder lifecycle (T2.7a), the item model has no done flag yet.
  const AGENDA_LABELS = Object.freeze(["Today", "Tomorrow"]);
  function agendaDayLabel(offset, day, locale = undefined) {
    if (offset === 0 || offset === 1) return AGENDA_LABELS[offset];
    return new Date(day).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  }
  // Agenda visibility is independent of reminder alerts, snooze and recurrence state.
  // Each layer is sparse: an omitted field inherits from the next layer.
  function cleanAgendaWindow(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
    for (const key of ["leadDays", "tailDays"]) {
      if (raw[key] === "" || raw[key] === null || raw[key] === undefined) continue;
      const n = Number(raw[key]);
      if (Number.isFinite(n)) out[key] = Math.max(0, Math.min(AGENDA_WINDOW_MAX_DAYS, Math.round(n)));
    }
    return out;
  }
  function cleanNoteAgendaOverrides(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [id, value] of Object.entries(raw).slice(0, 5000)) {
      const key = String(id || "").trim().slice(0, 120);
      if (!key) continue;
      const policy = cleanAgendaWindow(value);
      if (Object.keys(policy).length) out[key] = policy;
    }
    return out;
  }
  function resolveAgendaWindow(item, categoryRaw = null, noteRaw = null, globalRaw = null) {
    const layers = [
      cleanAgendaWindow(item?.x?.agendaWindow),
      cleanAgendaWindow(noteRaw),
      cleanAgendaWindow(categoryRaw),
      cleanAgendaWindow(globalRaw),
    ];
    const pick = (key, fallback) => {
      for (const layer of layers) if (Object.prototype.hasOwnProperty.call(layer, key)) return layer[key];
      return fallback;
    };
    return { enabled: pick("enabled", true), leadDays: pick("leadDays", 0), tailDays: pick("tailDays", 0) };
  }
  // Return local-midnight [from, to) boundaries. Offsets are civil days rather than
  // 24-hour durations, so spring/fall DST changes never shift the visible date.
  function agendaVisibilityRange(item, rawPolicy = {}) {
    if (!item?.start) return null;
    const policy = resolveAgendaWindow({ x: { agendaWindow: rawPolicy } });
    if (!policy.enabled) return null;
    const start = whenMs(item.start), end = item.end ? whenMs(item.end) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    const lastVisibleItemDay = dayStart(end > start ? end - 1 : start);
    return {
      from: addDays(dayStart(start), -policy.leadDays),
      to: addDays(lastVisibleItemDay, policy.tailDays + 1),
    };
  }
  // The virtual Agenda is a rolling local-day projection. Refresh only when the next
  // day can change a visible bucket, or when a far-future window first enters its horizon.
  // Recurring series are re-evaluated daily because their next occurrence is generated
  // from the recurrence rule rather than stored as a separate item.
  function nextAgendaVisibilityBoundary(items, now, days = 4, getWindow = null) {
    const stamp = Number(now);
    if (!Number.isFinite(stamp)) return null;
    const today = dayStart(stamp), count = Math.max(1, Math.min(31, Math.floor(Number(days)) || 4));
    const tomorrow = addDays(today, 1), horizon = addDays(today, count);
    let next = Infinity;
    for (const item of items || []) {
      const policy = resolveAgendaWindow(item, null, null, getWindow ? getWindow(item) : null);
      if (!policy.enabled) continue;
      if (isRecurringItem(item)) { next = Math.min(next, tomorrow); continue; }
      const range = agendaVisibilityRange(item, policy);
      if (!range || range.to <= today) continue;
      const boundary = range.from < horizon ? tomorrow : addDays(range.from, -(count - 1));
      if (boundary > stamp) next = Math.min(next, boundary);
    }
    return Number.isFinite(next) ? next : null;
  }
  function agendaBuckets(items, now, days = 4, isDone = () => false) {
    const n = Math.max(1, Math.min(31, Math.floor(Number(days)) || 4));
    const base = dayStart(now);
    const out = [];
    for (let i = 0; i < n; i++) {
      const from = addDays(base, i), to = addDays(base, i + 1);
      const list = expandRange(items, from, to).filter((it) => !isDone(it));
      out.push({ offset: i, key: localDateKey(from), label: agendaDayLabel(i, from), from, to, count: list.length, items: list });
    }
    return out;
  }
  // Compact startup Day-Plan data. `tomorrowPreview` is a Markdown section suitable
  // for the transient preview surface; it is not written into a person's date note.
  function dayPlanSnapshot(items, now, isDone = () => false) {
    const buckets = agendaBuckets(items, now, 2, isDone);
    const line = (item) => {
      if (isAllDay(item)) return "- All day · " + (item.summary || "Untitled");
      const [start, end] = itemRange(item);
      const clock = (ms) => { const d = new Date(ms); return p2(d.getHours()) + ":" + p2(d.getMinutes()); };
      const range = isReminder(item) ? clock(start) : clock(start) + "–" + clock(end);
      return "- " + range + " · " + (item.summary || "Untitled");
    };
    const today = buckets[0] || { key: localDateKey(dayStart(now)), items: [], count: 0 };
    const tomorrow = buckets[1] || { key: localDateKey(addDays(dayStart(now), 1)), items: [], count: 0 };
    return {
      today: { ...today, lines: today.items.map(line) },
      tomorrow: { ...tomorrow, lines: tomorrow.items.map(line) },
      tomorrowPreview: "## Tomorrow\n" + (tomorrow.items.length ? tomorrow.items.map(line).join("\n") : "- Nothing scheduled"),
    };
  }
  // Synchronous preference operations are shared by all browser windows. Keep
  // this claim independent of the async note/meta writers and calendar history.
  const DAY_PLAN_CLAIM_PREF = "zen.workspace.zentral.notes." + "last_day_plan_date";
  function dayPlanNeedsClaim(snapshot, lastKey) {
    const key = snapshot?.today?.key;
    return typeof key === "string" && !!parseYmd(key) && key !== lastKey && (Number(snapshot?.today?.count) > 0 || Number(snapshot?.tomorrow?.count) > 0);
  }
  function claimDayPlan(snapshot, prefs) {
    const key = snapshot?.today?.key;
    try {
      const previous = prefs.getStringPref(DAY_PLAN_CLAIM_PREF, "");
      if (!dayPlanNeedsClaim(snapshot, previous)) return null;
      prefs.setStringPref(DAY_PLAN_CLAIM_PREF, key);
      let active = true;
      return { rollback() {
        if (!active) return;
        active = false;
        try {
          if (prefs.getStringPref(DAY_PLAN_CLAIM_PREF, "") !== key) return;
          if (previous) prefs.setStringPref(DAY_PLAN_CLAIM_PREF, previous);
          else prefs.clearUserPref(DAY_PLAN_CLAIM_PREF);
        } catch (_) {}
      } };
    } catch (_) { return null; }
  }
  // Projection for the virtual Zen Agenda folder. Keys are occurrence-scoped, not
  // display strings or formatted dates, so duplicate summaries remain independent.
  function agendaZenProjection(items, now, days = 4, isDone = () => false, getWindow = null) {
    const clock = (ms) => { const d = new Date(ms); return p2(d.getHours()) + ":" + p2(d.getMinutes()); };
    // Expand the complete local window once, then fan overlapping multi-day events into
    // each day bucket. Calling expandRange once per day is needlessly O(days * items).
    const sourceItems = items || [];
    const n = Math.max(1, Math.min(31, Math.floor(Number(days)) || 4));
    const base = dayStart(now), baseOrdinal = localDayOrdinal(base), windowEnd = addDays(base, n);
    // The overwhelmingly common path has no per-item policy and no supplied default
    // resolver. Preserve the old projection's tight loop instead of normalising four
    // sparse inheritance layers for every one of thousands of events.
    const hasItemPolicy = !getWindow && sourceItems.some((item) => {
      const policy = item?.x?.agendaWindow;
      return policy && Object.keys(policy).length > 0;
    });
    const fastDefault = !getWindow && !hasItemPolicy;
    let maxLead = 0, maxTail = 0;
    if (!fastDefault) for (const source of sourceItems) {
      const policy = resolveAgendaWindow(source, null, null, getWindow ? getWindow(source) : null);
      if (!policy.enabled) continue;
      maxLead = Math.max(maxLead, policy.leadDays);
      maxTail = Math.max(maxTail, policy.tailDays);
    }
    const candidateFrom = fastDefault ? base : addDays(base, -maxTail);
    const candidateTo = fastDefault ? windowEnd : addDays(windowEnd, maxLead);
    const buckets = Array.from({ length: n }, (_, offset) => {
      const from = addDays(base, offset), to = addDays(base, offset + 1);
      return { offset, key: localDateKey(from), label: agendaDayLabel(offset, from), from, to, count: 0, items: [] };
    });
    let candidates;
    if (fastDefault) {
      // Avoid expandRange's per-item filter/map/single-item arrays and sort comparator work
      // for the common non-recurring case. Keep recurrence and occurrence semantics identical.
      candidates = [];
      for (const source of sourceItems) {
        if (!live(source)) continue;
        if (source.x?.series || !(source.recurrence || []).length) {
          const start = whenMs(source.start), end = source.end ? whenMs(source.end) : start;
          if (isReminder(source) ? start >= candidateFrom && start < candidateTo : start < candidateTo && end > candidateFrom) candidates.push(source);
        } else {
          const expanded = expandItem(source, candidateFrom, candidateTo);
          for (const occurrence of expanded) candidates.push(occurrence);
        }
      }
      candidates.sort((a, b) => whenMs(a.start) - whenMs(b.start) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    } else candidates = expandRange(sourceItems, candidateFrom, candidateTo);
    for (const item of candidates) {
      if (isDone(item)) continue;
      let first, last;
      if (fastDefault) {
        const [start, end] = itemRange(item);
        first = Math.max(0, localDayOrdinal(start) - baseOrdinal);
        last = Math.min(n - 1, localDayOrdinal(end > start ? end - 1 : start) - baseOrdinal);
      } else {
        const policy = resolveAgendaWindow(item, null, null, getWindow ? getWindow(item) : null);
        if (!policy.enabled) continue;
        const visible = agendaVisibilityRange(item, policy);
        if (!visible) continue;
        first = Math.max(0, localDayOrdinal(visible.from) - baseOrdinal);
        last = Math.min(n - 1, localDayOrdinal(visible.to - 1) - baseOrdinal);
      }
      for (let offset = first; offset <= last && offset < n; offset++) buckets[offset].items.push(item);
    }
    for (const bucket of buckets) bucket.count = bucket.items.length;
    return buckets.map((bucket) => ({
      key: "day:" + bucket.key,
      date: bucket.key,
      label: bucket.label,
      count: bucket.count,
      items: bucket.items.map((item) => {
        const [start, end] = itemRange(item);
        const summary = String(item.summary || "Untitled").replace(/[\r\n]+/g, " ").trim();
        const label = isAllDay(item) ? "All day · " + summary : (isReminder(item) ? clock(start) : clock(start) + "–" + clock(end)) + "  " + summary;
        const identity = reminderIdentity(item) || { itemId: item.id, occurrenceId: String(item.x?.recurrenceId || item.id), noteId: item.x?.noteId || "" };
        const details = [item.description, item.x?.calNote, item.x?.sourceNoteTitle ? "Source note: " + item.x.sourceNoteTitle : "", item.x?.heading ? "Heading: " + item.x.heading : "", item.x?.category ? "Category: " + item.x.category : "", item.x?.tz ? "Time zone: " + item.x.tz : ""].filter(Boolean).join("\n");
        return {
          key: "item:" + identity.itemId + ":" + identity.occurrenceId,
          itemId: identity.itemId,
          occurrenceId: identity.occurrenceId,
          recordId: String(item.x?.series || item.id),
          noteId: item.x?.noteId || identity.noteId || "",
          heading: item.x?.heading || "",
          label,
          summary,
          details,
          start,
          end,
          allDay: isAllDay(item),
          reminder: isReminder(item),
          ended: !isReminder(item) && end > start && end <= Number(now),
        };
      }),
    }));
  }
  // Only days with at least one visible item get a Zen Agenda folder. Empty
  // days (count === 0) are omitted so no empty Tomorrow / Day N folders are
  // created, and a day that becomes empty is removed on the next run.
  // Item-store listeners receive (kind, id); older event-object callers are
  // accepted too so the same projection policy applies across integrations.
  function agendaItemEventAffectsProjection(event) {
    const kind = typeof event === "string" ? event : event?.type;
    return ["change", "remove", "category", "reset", "recovery"].includes(kind);
  }
  function agendaPendingItems(items, stateFor = () => "pending") {
    return (items || []).filter((item) => !["done", "dismissed"].includes(stateFor(item)));
  }
  function agendaVisibleDays(projection) {
    return (projection || []).filter((day) => day && day.count > 0);
  }
  // Coalesced, store-change-driven controller for the virtual Zen Agenda folder. The host
  // supplies DOM/Zen operations through `api`; this controller owns no browser globals.
  function createZenAgenda({ api, getItems, getDays = () => 4, getEnabled = () => true, getPosition = () => "above", now = () => Date.now(), isDone = () => false, getWindow = null, setTimer = setTimeout, clearTimer = clearTimeout, warn = () => {} } = {}) {
    let dead = false, timer = null, timerAt = Infinity, last = [];
    const safeWarn = (error) => { try { warn(error); } catch (_) {} };
    function armAt(due) {
      if (dead || !Number.isFinite(due)) return;
      const stamp = Number(now());
      const wait = Math.max(0, due - (Number.isFinite(stamp) ? stamp : Date.now()));
      if (timer !== null && timerAt <= due) return;
      if (timer !== null) clearTimer(timer);
      timerAt = due;
      timer = setTimer(() => { timer = null; timerAt = Infinity; runNow(); }, wait);
    }
    function clearScheduled() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      timerAt = Infinity;
    }
    function scheduleBoundary(items) {
      const due = nextAgendaVisibilityBoundary(items, now(), getDays(), getWindow);
      if (due === null) clearScheduled(); else armAt(due);
    }
    function runNow() {
      if (dead) return [];
      let sourceItems = [];
      try {
        if (!getEnabled()) { api.removeAll?.(); last = []; clearScheduled(); return []; }
        sourceItems = getItems?.() || [];
        const projection = agendaVisibleDays(agendaZenProjection(sourceItems, now(), getDays(), isDone, getWindow));
        if (!projection.length) {
          api.removeAll?.(); last = projection; scheduleBoundary(sourceItems); return projection;
        }
        if (api.ensureRoot?.(getPosition() === "below" ? "below" : "above") === false) { scheduleBoundary(sourceItems); return last; }
        const desired = [];
        for (const day of projection) {
          desired.push({ key: day.key, kind: "day", label: day.label, date: day.date, count: day.count, parent: "" });
          for (const item of day.items) desired.push({ ...item, kind: "item", parent: day.key, tooltip: item.details });
        }
        const current = api.list?.() || [], currentByKey = new Map();
        for (const entry of current) if (entry?.key && !currentByKey.has(entry.key)) currentByKey.set(entry.key, entry);
        const desiredByKey = new Map(desired.map((entry) => [entry.key, entry]));
        for (const entry of current) if (entry?.key && !desiredByKey.has(entry.key)) api.remove?.(entry.key);
        for (const entry of desired) {
          const old = currentByKey.get(entry.key);
          if (!old || old.parent !== entry.parent || old.kind !== entry.kind) {
            if (old) api.remove?.(entry.key);
            if (api.add?.(entry) === false) safeWarn("Zen Agenda: could not add " + entry.key);
          } else api.update?.(entry);
        }
        api.reorder?.("", desired.filter((entry) => entry.kind === "day").map((entry) => entry.key));
        for (const day of desired.filter((entry) => entry.kind === "day"))
          api.reorder?.(day.key, desired.filter((entry) => entry.kind === "item" && entry.parent === day.key).map((entry) => entry.key));
        last = projection;
        scheduleBoundary(sourceItems);
        return projection;
      } catch (error) {
        safeWarn(error);
        try { scheduleBoundary(sourceItems); } catch (scheduleError) { safeWarn(scheduleError); }
        return last;
      }
    }
    function schedule(ms = 250) {
      if (dead) return;
      const stamp = Number(now()), due = (Number.isFinite(stamp) ? stamp : Date.now()) + Math.max(0, Number(ms) || 0);
      armAt(due);
    }
    return {
      runNow,
      schedule,
      get projection() { return last; },
      destroy() { dead = true; clearScheduled(); try { api.removeAll?.(); } catch (error) { safeWarn(error); } },
    };
  }
  // Resolve a projected sidebar identity against current records, not against
  // a stale tab label. Recurring identities refer to the expanded occurrence;
  // the displayed start/end bounds keep lookup local even for old series.
  function resolveAgendaOccurrence(items, identity = {}) {
    const itemId = String(identity.itemId || ""), occurrenceId = String(identity.occurrenceId || ""), recordId = String(identity.recordId || "");
    if (!itemId || !occurrenceId || !recordId || !Array.isArray(items)) return null;
    for (const item of items) {
      if (!item || item.id !== recordId || !live(item)) continue;
      const key = reminderIdentity(item);
      if (!key || key.itemId !== itemId) continue;
      if (!(item.recurrence || []).length || item.x?.series) {
        if (key.occurrenceId === occurrenceId) return item;
        continue;
      }
      const start = Number(identity.start), end = Number(identity.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      const from = start - 2 * 86400000, to = Math.max(start + 1, end) + 2 * 86400000;
      const occurrence = expandItem(item, from, to).find((candidate) => {
        const id = reminderIdentity(candidate);
        return id?.itemId === itemId && id.occurrenceId === occurrenceId;
      });
      if (occurrence) return occurrence;
    }
    return null;
  }

  // Per-target context menu model for calendar rows. This stays pure so every calendar surface can
  // render the same capabilities and reasons without duplicating lifecycle/source rules.
  function calendarItemMenuModel(item, { state = "pending", historyWritable = false, agendaVisible, agendaWritable = true } = {}) {
    if (!item || typeof item !== "object" || !String(item.id || "")) return [];
    const reminder = isReminder(item);
    const source = ["list", "note", "manual"].includes(item.x?.src) ? item.x.src : "manual";
    const manual = source === "manual";
    const recurring = !!item.x?.series || (Array.isArray(item.recurrence) && item.recurrence.length > 0);
    const lifecycle = ["pending", "done", "dismissed"].includes(state) ? state : "pending";
    const action = (id, label, enabled = true, reason = "") => ({ id, command: id, label, enabled: !!enabled, reason: enabled ? "" : String(reason || "Unavailable in the current state") });
    const rows = [
      action("open", item.x?.noteId ? "Open source note" : "Show details"),
      action("edit", "Edit details…"),
      action("change-time", recurring ? "Change occurrence time…" : "Change time…", source !== "note" && (!recurring || !!item.x?.recurrenceId), source === "note" ? "This note reminder is scheduled in its source note" : "Choose an expanded recurrence occurrence before moving it"),
      action("convert", reminder ? "Convert to event" : "Convert to reminder", manual, "Items parsed from a note keep the type defined by their source text"),
      { sep: true },
      action("duplicate", "Duplicate as independent item"),
      action("delete", "Delete item…", manual, "Remove this item from its source note instead of deleting only its calendar copy"),
    ];
    if (typeof agendaVisible === "boolean") rows.splice(4, 0,
      action("agenda-visibility", agendaWritable ? (agendaVisible ? "Hide in Zen Agenda" : "Show in Zen Agenda") + (recurring ? " (series)" : "") : "Zen Agenda visibility unavailable", agendaWritable, "This legacy note reminder is not stored as an Agenda item"));
    if (reminder) {
      const writable = !!historyWritable;
      rows.push(
        { sep: true },
        { heading: true, label: "Reminder · " + lifecycle },
        action("mark-done", "Mark as done", writable && lifecycle !== "done", !writable ? "Reminder history storage is protected or unavailable" : "Already done"),
        action("dismiss", "Dismiss", writable && lifecycle !== "dismissed", !writable ? "Reminder history storage is protected or unavailable" : "Already dismissed"),
        action("reopen", "Reopen", writable && lifecycle !== "pending", !writable ? "Reminder history storage is protected or unavailable" : "Already pending"),
        { id: "snooze", command: "snooze", label: "Snooze", group: [
          action("snooze-1d", "Snooze +1 day", writable && !recurring, !writable ? "Reminder history storage is protected or unavailable" : "Recurring occurrences need exception support before they can be snoozed"),
          action("snooze-3d", "Snooze +3 days", writable && !recurring, !writable ? "Reminder history storage is protected or unavailable" : "Recurring occurrences need exception support before they can be snoozed"),
          action("snooze-monday", "Snooze until next Monday", writable && !recurring, !writable ? "Reminder history storage is protected or unavailable" : "Recurring occurrences need exception support before they can be snoozed"),
          action("snooze-custom", "Custom date and time…", writable && !recurring, !writable ? "Reminder history storage is protected or unavailable" : "Recurring occurrences need exception support before they can be snoozed"),
        ] },
      );
    }
    return rows;
  }

  // Snooze helper: whole local days later, keeping the wall-clock time (DST-safe). Returns ms.
  const snoozeDays = (ms, n) => addDays(ms, Math.round(Number(n) || 0));
  // Convert a wall-clock date/time in an IANA zone to an instant. During a fall-back overlap the earlier
  // instant wins; during a spring-forward gap the first valid wall minute after the requested time wins.
  function zonedDateTimeToMs(dateKey, timeText, zone = "") {
    const day = parseYmd(dateKey), clock = /^(\d{1,2}):(\d{2})$/.exec(String(timeText || "").trim());
    if (!day || !clock) return null;
    const hour = Number(clock[1]), minute = Number(clock[2]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
    if (!zone) return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime();
    const validZone = cleanZone(zone);
    if (!validZone) return null;
    const targetWall = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
    const targetEnd = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat("en-US", { timeZone: validZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch (_) { return null; }
    let exact = null, next = null, nextWall = Infinity;
    const from = targetWall - 16 * 60 * MIN, to = targetWall + 16 * 60 * MIN;
    for (let at = from; at <= to; at += MIN) {
      const parts = Object.create(null);
      for (const part of formatter.formatToParts(new Date(at))) if (part.type !== "literal") parts[part.type] = Number(part.value);
      if (![parts.year, parts.month, parts.day, parts.hour, parts.minute].every(Number.isFinite)) continue;
      const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
      if (wall === targetWall) { exact = at; break; }
      if (wall > targetWall && wall < targetEnd && (wall < nextWall || (wall === nextWall && (next === null || at < next)))) { nextWall = wall; next = at; }
    }
    return exact === null ? next : exact;
  }
  // Turn a date-bearing sentence into a human title without leaving a dangling date preposition.
  // This is intentionally conservative: only the recognised date token and a trailing connector are removed.
  function titleFromDateText(text, dateToken) {
    let value = String(text ?? "").replace(/%%\s*zn-date-ignore:[^%]*%%/gi, "");
    const token = String(dateToken ?? "").trim();
    if (token) value = value.replace(token, " ").replace(/\b(?:on|at|by|for)\s*$/i, "");
    return value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  }

  // Source-note colour is authoritative for linked items; category colour is only the fallback.
  // An empty/"none" note colour deliberately does not mask a useful category colour.
  function resolveItemColor(noteColor, categoryColor) {
    const note = typeof noteColor === "string" ? noteColor.trim() : "";
    const category = typeof categoryColor === "string" ? categoryColor.trim() : "";
    return note && note !== "none" ? note : category;
  }

  // Build a complete calendar item from composer fields. Dates are civil YYYY-MM-DD values;
  // timed values are interpreted in the supplied IANA zone (or the machine's local zone).
  // A full-day reminder is represented by start.date with no end, while all-day event ends
  // are exclusive. Returning null is the only failure mode so callers can keep the dialog open.
  function composeCalendarItem(input = {}, now = Date.now()) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const kind = KINDS.includes(input.kind) ? input.kind : "reminder";
    const allDay = input.allDay === true;
    const summary = String(input.summary ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
    const startDate = String(input.startDate || "").trim();
    if (!summary || !parseYmd(startDate)) return null;
    const rawZone = String(input.tz || "").trim();
    const zone = rawZone ? cleanZone(rawZone) : "";
    if (rawZone && !zone) return null;
    const wallTime = (date, time) => {
      if (!parseYmd(date) || parseClock(time) < 0) return null;
      return zonedDateTimeToMs(date, String(time), zone);
    };
    let start;
    if (allDay) start = { date: startDate };
    else {
      const ms = wallTime(startDate, input.startTime);
      if (!Number.isFinite(ms)) return null;
      start = { dateTime: iso(ms) };
    }
    let end;
    if (kind === "event") {
      if (allDay) {
        const endDate = String(input.endDate || "").trim();
        if (!parseYmd(endDate) || endDate <= startDate) return null;
        end = { date: endDate };
      } else {
        const endDate = String(input.endDate || startDate).trim();
        const endMs = wallTime(endDate, input.endTime);
        const startMs = Date.parse(start.dateTime);
        if (!Number.isFinite(endMs) || endMs <= startMs) return null;
        end = { dateTime: iso(endMs) };
      }
    }
    const previous = input.item && typeof input.item === "object" ? input.item : null;
    const previousX = previous?.x && typeof previous.x === "object" ? previous.x : {};
    const noteId = String(input.noteId ?? previousX.noteId ?? "").trim().slice(0, 120);
    const category = cleanCategoryName(input.category ?? previousX.category ?? "");
    const recurrence = Array.isArray(input.recurrence) ? input.recurrence : (previous?.recurrence || []);
    const notify = cleanNotifyOverrides(input.notify === undefined ? previousX.notify : input.notify);
    const moved = previousX.moved || (previous && JSON.stringify(previous.start) !== JSON.stringify(start) ? "1" : "");
    const record = {
      ...(previous || {}),
      id: String(input.id || previous?.id || "").slice(0, 120) || undefined,
      summary,
      description: String(input.description ?? previous?.description ?? "").slice(0, MAX_DESC),
      start,
      ...(kind === "event" ? { end } : { end: undefined }),
      recurrence,
      x: {
        ...previousX,
        kind,
        noteId,
        heading: String(input.heading ?? previousX.heading ?? "").trim().slice(0, MAX_TEXT),
        category,
        tz: zone,
        src: previousX.src || "manual",
        calNote: String(input.calNote ?? previousX.calNote ?? "").slice(0, MAX_DESC),
        notify,
        agendaWindow: cleanAgendaWindow(input.agendaWindow === undefined ? previousX.agendaWindow : input.agendaWindow),
        moved,
      },
    };
    return cleanItem(record, now);
  }

  function snoozedItemStart(item, days = 1, targetMs = 0) {
    const start = cleanWhen(item?.start);
    if (!start) return null;
    const explicit = Number(targetMs);
    const moved = Number.isFinite(explicit) && explicit > 0 ? Math.floor(explicit) : snoozeDays(whenMs(start), days);
    if (!Number.isFinite(moved) || moved <= 0) return null;
    return start.date ? { date: ymd(new Date(dayStart(moved))) } : { dateTime: iso(moved) };
  }
  // A generated date note counts as untouched (safe to purge) only when its body is nothing but the generated heading.
  // Tags, files, links, any text, or a user-edited heading make it "touched". `touched` is the store's own edit flag.
  function isBlankDateNote(note, key) {
    if (!note || note.touched || (note.tags && note.tags.length) || (note.files && note.files.length) || (note.attachments && note.attachments.length)) return false;
    // Empty Agenda scaffolding (heading + `%%calendar%%` markers with no list line, left behind when its items moved
    // to another day) does not make a generated date note "used".
    const body = String(note.body == null ? "" : note.body).replace(/\r\n?/g, "\n").split("\n")
      .filter((l) => !AGENDA_HEAD_RE.test(l) && !MARKER_RE.test(l)).join("\n").trim();
    if (!body) return true;
    const k = String(key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("^#\\s+" + (k || "\\d{4}-\\d{2}-\\d{2}") + "(?:\\s+[A-Za-zÀ-ž]+)?$").test(body);
  }
  // Last-write-wins between two versions of one record: newer `updated` wins; equal -> higher `rev`; equal -> `remote`.
  function lwwPick(local, remote) {
    if (!local) return remote || null;
    if (!remote) return local;
    const stamp = (value) => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0; }
      return 0;
    };
    const revision = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const lu = stamp(local.updated), ru = stamp(remote.updated);
    if (lu !== ru) return lu > ru ? local : remote;
    const lr = revision(local.rev), rr = revision(remote.rev);
    return lr > rr ? local : remote; // exact ties deliberately prefer remote
  }

  const api = {
    KINDS, ymd, parseYmd, dayStart, addDays, parseDateText, inlineDateTokens, ignoredDateTokens, stripDateIgnoreMarks, ensureNoteItemIds, parseClock, parseTimeRange, parseLine, makeItem, cleanItem, itemFromLine,
    cleanCategoryName, cleanCategoryNotify, cleanNotifyOverrides, cleanCategory, DEFAULT_CATEGORY_NOTIFY, DEFAULT_CATEGORIES, SOUND_LEVELS, DEFAULT_ALERT_SETTINGS, cleanAlertSettings, cleanNoteAlertOverrides, cleanAgendaWindow, cleanNoteAgendaOverrides, resolveAgendaWindow, agendaVisibilityRange, nextAgendaVisibilityBoundary, AGENDA_WINDOW_MAX_DAYS, quietHoursActive, resolveAlertPolicy, adaptiveReminderLeadMinutes, reminderStagePlan, calendarSectionAt, setCalendarSectionCategory,
    itemRange, isReminder, isAllDay, itemsInRange, extractNoteItems, ensureAgendaHeading, agendaMirrorLine, insertAgendaLine, findAgendaLine, removeAgendaLine, mirroredItem, isRecurringItem, rewriteLineSchedule, setListLineSchedule, noteLineItemId, listCheckboxStates, setListCheckbox, itemsFromNoteReminders, createReminderHistoryStore, REMINDER_HISTORY_FILE, REMINDER_HISTORY_ACTIONS, reminderAlertPresentation, reminderSnoozeTomorrowMinutes, reminderAlertShouldClose, reminderStateAfter, reminderIdentity, createItemStore, ITEMS_FILE, CALENDAR_DENSITIES, cleanCalendarDensity, calendarDensityHourHeight, CALENDAR_LAYOUT_MODES, cleanCalendarLayout, calendarLayoutFor, cleanCalendarShare, allDayOf, parseRule, expandItem, expandRange, cleanRecurrenceExceptions, validOccurrenceIdentity, occurrenceMoveRecord, moveOccurrence, cancelOccurrence, clearOccurrenceException, DEFAULT_WORK, cleanWork, workRange, freeSlots, cleanZone, zoneParts, zonedDateKey, zonedDayBounds, zonedMinuteOfDay, clockIn, weekText, pickerMonth, stepMonth, pickerKey, monthGrid, weekDays, daysForward, DATE_FORMATS, DEFAULT_DATE_FORMAT, cleanDateFormat, localDateKey, formatDateKey, dateNoteTitle, parseDateKeyText, AGENDA_LABELS, agendaDayLabel, agendaBuckets, dayPlanSnapshot, dayPlanNeedsClaim, claimDayPlan, agendaZenProjection, agendaVisibleDays, agendaPendingItems, agendaItemEventAffectsProjection, createZenAgenda, resolveAgendaOccurrence, calendarItemMenuModel, resolveItemColor, titleFromDateText, composeCalendarItem, snoozeDays, zonedDateTimeToMs, snoozedItemStart, isBlankDateNote, lwwPick, layoutDay, busyRanges, upcoming, moveItem, calendarMovePlacement, calendarMoveTimedEvent, resizeItem, toGoogle, fromGoogle,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.ZentralModuleLoader?.define) window.ZentralModuleLoader.define("notes-calendar", () => api);
})();
