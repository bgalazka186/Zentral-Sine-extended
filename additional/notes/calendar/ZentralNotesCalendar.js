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
  const DEFAULT_CATEGORY_NOTIFY = Object.freeze({
    pre: Object.freeze({ enabled: true, leadMinutes: 5 }),
    due: Object.freeze({ enabled: true }),
    followup: Object.freeze({ enabled: true, delayMinutes: 2 }),
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
      if (m[3] === "m") return new Date(d.getFullYear(), d.getMonth() + n, d.getDate()).getTime();
      return new Date(d.getFullYear() + n, d.getMonth(), d.getDate()).getTime();
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
      // An unknown word can look like a month name (for example "12 and 25 listopada"). Do not let
      // that rejected candidate consume the next, valid date; resume one character after its start.
      if (day === null) { re.lastIndex = m.index + 1; continue; }
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
    const s = JSON.stringify([it.summary, it.description, it.start, it.end, it.status, it.recurrence, it.x]);
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
  const cleanCategoryName = (value) => String(value ?? "").replace(/[\r\n%]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const categoryKey = (value) => cleanCategoryName(value).toLocaleLowerCase();
  const cleanStageRule = (raw, fallback, stage) => {
    const src = raw && typeof raw === "object" ? raw : {};
    const out = { enabled: typeof src.enabled === "boolean" ? src.enabled : fallback.enabled !== false };
    if (stage === "pre") out.leadMinutes = Number.isFinite(+src.leadMinutes) ? Math.max(1, Math.min(10, Math.round(+src.leadMinutes))) : fallback.leadMinutes;
    if (stage === "followup") out.delayMinutes = Number.isFinite(+src.delayMinutes) ? Math.max(1, Math.min(30, Math.round(+src.delayMinutes))) : fallback.delayMinutes;
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
      if (Object.keys(rule).length) out[stage] = rule;
    }
    return out;
  }
  function cleanCategory(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = cleanCategoryName(raw.name);
    if (!name) return null;
    const color = /^#[0-9a-f]{6}$/i.test(String(raw.color || "")) ? String(raw.color).toLowerCase() : "#7d8da8";
    return { id: String(raw.id || "cat-" + categoryKey(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).slice(0, 100), name, color, notify: cleanCategoryNotify(raw.notify) };
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
      recurrence: Array.isArray(raw.recurrence) ? raw.recurrence.filter((r) => typeof r === "string" && /^(RRULE|EXRULE|RDATE|EXDATE):/.test(r)).slice(0, 5) : [],
      reminders: { overrides: minutes },
      x: {
        kind, noteId: String(x.noteId ?? "").slice(0, 120), heading: String(x.heading ?? "").slice(0, MAX_TEXT),
        category: cleanCategoryName(x.category), tz: cleanZone(x.tz), src: ["list", "note", "manual"].includes(x.src) ? x.src : "manual", key: String(x.key ?? "").slice(0, 60), moved: x.moved ? "1" : "", calNote: String(x.calNote ?? "").slice(0, MAX_DESC), notify: cleanNotifyOverrides(x.notify),
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
      if (parsed.endMin > parsed.startMin) { base.end = { dateTime: iso(parsed.day + parsed.endMin * MIN) }; base.x.kind = "event"; }
      else base.x.kind = "reminder";
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
  function layoutDay(items, day) {
    const d0 = day, d1 = addDays(day, 1);
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
      for (const r of cluster) out.push({ item: r.item, lane: r.lane, lanes: laneEnds.length, startMin: Math.round((r.s - d0) / MIN), endMin: Math.round((r.e - d0) / MIN) });
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
    const rs = itemsInRange(items, from, to).filter((it) => !isReminder(it)).map((it) => { const [s, e] = itemRange(it); return [Math.max(s, from), Math.min(e, to)]; }).sort((a, b) => a[0] - b[0]);
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
  function moveItem(it, deltaMs, snapMin = 15) {
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
    return cleanItem({ ...copy, etag: "", updated: iso(Date.now()) }, 0);
  }
  // Move one edge of an event ("start" or "end"); never shorter than one snap step. Reminders have no end.
  function resizeItem(it, edge, deltaMs, snapMin = 15) {
    if (isReminder(it) || isAllDay(it) || !it.end) return it;
    const [s, e] = itemRange(it), step = Math.max(1, Math.round(snapMin)) * MIN;
    let ns = s, ne = e;
    if (edge === "start") ns = Math.min(snapTo(s + deltaMs, snapMin), e - step);
    else ne = Math.max(snapTo(e + deltaMs, snapMin), s + step);
    return cleanItem({ ...JSON.parse(JSON.stringify(it)), start: { dateTime: iso(ns) }, end: { dateTime: iso(ne) }, etag: "", updated: iso(Date.now()) }, 0);
  }

  // ---------- Google shape ----------
  // The plain Google event resource for an item (our `x` goes into extendedProperties.private, as Google allows).
  function toGoogle(it) {
    const priv = {};
    for (const [k, v] of Object.entries(it.x)) if (v !== "" && v !== undefined && v !== null) priv["zentral_" + k] = k === "notify" ? JSON.stringify(v) : String(v);
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
    for (const k of ["kind", "noteId", "heading", "category", "tz", "src", "key", "moved", "calNote", "notify"]) if (priv["zentral_" + k] !== undefined) {
      if (k === "notify") { try { x[k] = JSON.parse(priv["zentral_" + k]); } catch (_) {} }
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
      const dayOfHeading = heading.text ? (parseDatePrefix(heading.text, now)?.day ?? null) : null;
      const ignored = ignoredDateTokens(line);
      let sourceLine = stripDateIgnoreMarks(line);
      // If the ignored token is the leading date, it no longer drives the item date. In a dated heading
      // section the heading remains the date; otherwise the line is ordinary text and is not an item.
      const listText = sourceLine.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "");
      const prefix = parseDatePrefix(listText, now);
      if (prefix && ignored.some((raw) => raw === prefix.raw.toLowerCase() || raw.startsWith(prefix.raw.toLowerCase() + " "))) {
        const at = sourceLine.indexOf(prefix.raw);
        if (at >= 0) sourceLine = sourceLine.slice(0, at) + sourceLine.slice(at + prefix.raw.length);
      }
      const parsed = parseLine(sourceLine, now, dayOfHeading);
      if (!parsed) continue;
      const norm = sourceLine.replace(/\s+/g, " ").trim().toLowerCase() + "|" + heading.text;
      const n = (seen.get(norm) || 0) + 1; seen.set(norm, n);
      const key = hashText(noteId + "|" + norm) + (n > 1 ? "-" + n : "");
      const it = itemFromLine(parsed, { noteId, heading: heading.text, category: sec.category, src: "list", key }, now);
      if (!it) continue;
      it.id = "l" + hashText(noteId) + key;
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
  function createItemStore({ io, getDir, now = () => Date.now(), setTimer, clearTimer, warn = () => {}, delayMs = 600 }) {
    const items = new Map();
    const categoryDefs = new Map();
    const hidden = new Set(); // noteIds whose items stay stored but are not shown (note in Trash, or its file is missing)
    const listeners = new Set();
    let dirty = false, timer = null, chain = Promise.resolve();
    const shown = (it) => !it.x.noteId || !hidden.has(it.x.noteId);
    const emit = (kind, id) => { for (const fn of [...listeners]) { try { fn(kind, id); } catch (e) { warn(e); } } };
    const schedule = () => { dirty = true; if (timer !== null) clearTimer(timer); timer = setTimer(() => { timer = null; writeNow(); }, delayMs); };
    function writeNow() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      const dir = getDir();
      if (!dirty || !dir) return Promise.resolve();
      dirty = false;
      const text = JSON.stringify({ v: 2, items: [...items.values()], categories: [...categoryDefs.values()] });
      chain = chain.then(() => io.writeUTF8(io.join(dir, ITEMS_FILE), text, { tmpPath: io.join(dir, ITEMS_FILE + ".tmp") })).catch((e) => warn(e));
      return chain;
    }
    return {
      async open() {
        items.clear(); categoryDefs.clear(); hidden.clear();
        try {
          const raw = JSON.parse(await io.readUTF8(io.join(getDir(), ITEMS_FILE)));
          for (const r of Array.isArray(raw.items) ? raw.items : []) { const it = cleanItem(r, 0); if (it && !items.has(it.id)) items.set(it.id, it); }
          for (const r of Array.isArray(raw.categories) ? raw.categories : []) { const category = cleanCategory(r); if (category) categoryDefs.set(categoryKey(category.name), category); }
        } catch (_) {}
        emit("reset");
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
        if (saved) return { ...saved, notify: JSON.parse(JSON.stringify(saved.notify)) };
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
        if (old && JSON.stringify(old) === JSON.stringify(category)) return { ...old, notify: JSON.parse(JSON.stringify(old.notify)) };
        categoryDefs.set(key, category);
        schedule(); emit("category", key);
        return { ...category, notify: JSON.parse(JSON.stringify(category.notify)) };
      },
      // A trashed note keeps its items (extras, dragged times) out of sight; restoring it brings them back untouched.
      hideNote(noteId) { if (!noteId || hidden.has(noteId) || ![...items.values()].some((it) => it.x.noteId === noteId)) return false; hidden.add(noteId); emit("remove", noteId); return true; },
      showNote(noteId) { if (!hidden.delete(noteId)) return false; emit("change", noteId); return true; },
      isHidden: (noteId) => hidden.has(noteId),
      upsert(raw) {
        const it = cleanItem({ ...raw, updated: iso(now()), etag: "" }, now());
        if (!it) return null;
        const old = items.get(it.id);
        if (old && JSON.stringify(old) === JSON.stringify(it)) return old;
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
      // Rebuilds the items that come from the note's marked lists. Returns true when anything changed.
      syncNote(noteId, body) {
        const had = [...items.values()].filter((it) => it.x.noteId === noteId && it.x.src === "list");
        if (!had.length && !/%%\s*calendar/i.test(String(body || ""))) return false;
        const fresh = extractNoteItems(body, noteId, now()), keep = new Map(had.map((it) => [it.id, it]));
        let changed = false;
        const nextIds = new Set();
        for (const f of fresh) {
          nextIds.add(f.id);
          const old = keep.get(f.id);
          let next = f;
          if (old) {
            // the line is unchanged: keep the extras and the time the person may have dragged it to
            next = cleanItem({ ...f, start: old.start, end: old.end, status: old.status, reminders: old.reminders, recurrence: old.recurrence.length ? old.recurrence : f.recurrence, updated: old.updated,
              x: { ...f.x, tz: old.x.tz, calNote: old.x.calNote, moved: old.x.moved, notify: old.x.notify } }, 0);
            next.x.heading = f.x.heading; next.x.category = f.x.category;
            next.etag = etagOf(next);
          }
          if (!old || JSON.stringify(old) !== JSON.stringify(next)) { items.set(next.id, next); changed = true; emit("change", next.id); }
        }
        for (const it of had) if (!nextIds.has(it.id)) { items.delete(it.id); changed = true; emit("remove", it.id); }
        if (changed) schedule();
        return changed;
      },
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      flush: writeNow,
    };
  }

  // ---------- calendar view layout (roadmap T2.4a) ----------
  // Keep the orientation decision pure so the sheet can react to its actual available rectangle (not the
  // browser window alone), and the threshold behavior can be regression-tested without Gecko layout.
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
    const count = o.COUNT ? Math.max(1, Math.min(5000, parseInt(o.COUNT, 10) || 0)) : 0;
    let until = 0;
    if (o.UNTIL) { const u = /^(\d{4})(\d{2})(\d{2})/.exec(o.UNTIL); if (u) until = addDays(new Date(+u[1], +u[2] - 1, +u[3]).getTime(), 1); }
    const byday = o.BYDAY ? o.BYDAY.split(",").map((d) => DAY_CODES.indexOf(d.slice(-2))).filter((n) => n >= 0) : [];
    return { freq: o.FREQ, interval, count, until, byday };
  }
  // Occurrences of a repeating item inside [from, to): copies with id "<id>@<startMs>" and x.series = the original id.
  // The first occurrence is the item itself. Items without a usable RRULE come back as they are (if they touch the range).
  function expandItem(it, from, to) {
    const rule = (it.recurrence || []).map(parseRule).find(Boolean);
    if (!rule) return itemsInRange([it], from, to);
    const [s0, e0] = itemRange(it), len = e0 - s0, allDay = isAllDay(it);
    const base = new Date(s0), out = [];
    const starts = [];
    const push = (ms) => { if (ms >= s0) starts.push(ms); };
    const at = (d) => (allDay ? d.getTime() : new Date(d.getFullYear(), d.getMonth(), d.getDate(), base.getHours(), base.getMinutes()).getTime());
    const limit = Math.min(to, rule.until || Infinity);
    let n = 0;
    for (let i = 0; i < 3000 && n < (rule.count || 5000); i++) {
      let cand = [];
      if (rule.freq === "DAILY") cand = [at(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i * rule.interval))];
      else if (rule.freq === "WEEKLY") {
        const ws = new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay() + i * 7 * rule.interval);
        const days = rule.byday.length ? [...rule.byday].sort((a, b) => a - b) : [base.getDay()];
        cand = days.map((dw) => at(new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + dw)));
      } else if (rule.freq === "MONTHLY") { const d = new Date(base.getFullYear(), base.getMonth() + i * rule.interval, base.getDate()); cand = d.getDate() === base.getDate() ? [at(d)] : []; }
      else { const d = new Date(base.getFullYear() + i * rule.interval, base.getMonth(), base.getDate()); cand = d.getDate() === base.getDate() ? [at(d)] : []; }
      for (const c of cand) {
        if (c < s0) continue;
        if (rule.count && n >= rule.count) break;
        n++;
        if (c >= limit) return out;
        starts.length = 0; push(c);
        const end = c + len;
        const touches = isReminder(it) ? c >= from && c < to : c < to && end > from;
        if (touches) {
          const occ = JSON.parse(JSON.stringify(it));
          occ.id = c === s0 ? it.id : it.id + "@" + c;
          occ.x.series = it.id;
          occ.start = allDay ? { date: ymd(new Date(c)) } : { dateTime: iso(c) };
          if (it.end) occ.end = allDay ? { date: ymd(new Date(c + len)) } : { dateTime: iso(c + len) };
          out.push(occ);
        }
      }
      if (cand.length && Math.min(...cand) >= limit) break;
    }
    return out;
  }
  // Like itemsInRange, but repeating items are expanded.
  function expandRange(items, from, to) {
    return items.filter(live).flatMap((it) => expandItem(it, from, to)).sort((a, b) => itemRange(a)[0] - itemRange(b)[0] || (a.id < b.id ? -1 : 1));
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
  function workRange(day, work) {
    const w = cleanWork(work);
    if (!w.days.includes(new Date(day).getDay())) return null;
    return [addDays(day, 0) + w.startMin * MIN, addDays(day, 0) + w.endMin * MIN];
  }
  // Free gaps of at least `minMin` minutes between `from` and `to`, optionally only inside working hours.
  // Reminders take no time; all-day events block the whole day only when `blockAllDay` is true.
  function freeSlots(items, from, to, minMin = 60, opts = {}) {
    const busy = busyRanges(items.filter((it) => opts.blockAllDay || !isAllDay(it)), from, to);
    const windows = [];
    if (opts.work) {
      for (let d = dayStart(from); d < to; d = addDays(d, 1)) { const r = workRange(d, opts.work); if (r) windows.push([Math.max(r[0], from), Math.min(r[1], to)]); }
    } else windows.push([from, to]);
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
  // "HH:MM" of an instant in a zone ("" = the local zone).
  function clockIn(ms, zone) {
    const z = cleanZone(zone);
    try {
      const f = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(z ? { timeZone: z } : {}) });
      return f.format(new Date(ms));
    } catch (_) { return p2(new Date(ms).getHours()) + ":" + p2(new Date(ms).getMinutes()); }
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

  const api = {
    KINDS, ymd, parseYmd, dayStart, addDays, parseDateText, inlineDateTokens, ignoredDateTokens, stripDateIgnoreMarks, parseClock, parseTimeRange, parseLine, makeItem, cleanItem, itemFromLine,
    cleanCategoryName, cleanCategoryNotify, cleanNotifyOverrides, cleanCategory, DEFAULT_CATEGORY_NOTIFY, DEFAULT_CATEGORIES, calendarSectionAt, setCalendarSectionCategory,
    itemRange, isReminder, isAllDay, itemsInRange, extractNoteItems, itemsFromNoteReminders, createItemStore, ITEMS_FILE, CALENDAR_LAYOUT_MODES, cleanCalendarLayout, calendarLayoutFor, cleanCalendarShare, allDayOf, parseRule, expandItem, expandRange, DEFAULT_WORK, cleanWork, workRange, freeSlots, cleanZone, clockIn, weekText, pickerMonth, stepMonth, pickerKey, monthGrid, daysForward, layoutDay, busyRanges, upcoming, moveItem, resizeItem, toGoogle, fromGoogle,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.ZentralModuleLoader?.define) window.ZentralModuleLoader.define("notes-calendar", () => api);
})();
