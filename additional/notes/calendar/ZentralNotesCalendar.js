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

  // ---------- language registry & parsing (AU-B4a) ----------
  // Language dictionaries live in pure data files (`additional/notes/i18n/*.js`); parser logic is table-driven.
  const NOTES_LANGUAGES = Object.freeze(["en", "pl"]);
  const DEFAULT_NOTES_LANGUAGE = "en";
  const LANG_REGISTRY = new Map();
  const foldLanguageText = (text) =>
    String(text ?? "")
      .replace(/[\u0141\u0142]/g, "l")
      .replace(/\u00df/g, "ss")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Legacy German month words accepted when acceptAll !== false so multilingual month dates keep working.
  const EXTRA_MONTH_ALIASES = Object.freeze({
    januar: 1,
    februar: 2,
    maerz: 3,
    marz: 3,
    mai: 5,
    juni: 6,
    juli: 7,
    oktober: 10,
    okt: 10,
    dezember: 12,
    dez: 12,
  });

  function compileLanguageTable(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.code !== "string" || !raw.code.trim()) return null;
    const code = raw.code.trim().toLowerCase();
    const locale = typeof raw.locale === "string" && raw.locale.trim() ? raw.locale.trim() : code;
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : code;
    const agendaLabels = Object.freeze(
      Array.isArray(raw.agendaLabels) && raw.agendaLabels.length
        ? raw.agendaLabels.map((s) => String(s))
        : ["Today", "Tomorrow"],
    );
    const todayLabel = typeof raw.todayLabel === "string" && raw.todayLabel ? raw.todayLabel : agendaLabels[0] || "Today";
    const overdueLabel = typeof raw.overdueLabel === "string" && raw.overdueLabel ? raw.overdueLabel : "Overdue";
    const dk = raw.dateKinds && typeof raw.dateKinds === "object" ? raw.dateKinds : {};
    const dateKinds = Object.freeze({
      today: String(dk.today || todayLabel),
      tomorrow: String(dk.tomorrow || agendaLabels[1] || "Tomorrow"),
      next: String(dk.next || "Next work day"),
      other: String(dk.other || "Other date\u2026"),
      earlier: String(dk.earlier || "Earlier days"),
    });
    const shortMon = Array.isArray(raw.weekdaysDisplay?.short) && raw.weekdaysDisplay.short.length === 7
      ? raw.weekdaysDisplay.short.map((s) => String(s))
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const longMon = Array.isArray(raw.weekdaysDisplay?.long) && raw.weekdaysDisplay.long.length === 7
      ? raw.weekdaysDisplay.long.map((s) => String(s))
      : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const weekdaysDisplay = Object.freeze({
      short: Object.freeze(shortMon),
      long: Object.freeze(longMon),
      shortSun: Object.freeze([shortMon[6], ...shortMon.slice(0, 6)]),
      longSun: Object.freeze([longMon[6], ...longMon.slice(0, 6)]),
    });

    const relativeMap = new Map();
    const multiWordPhrases = new Set();
    if (raw.relative && typeof raw.relative === "object") {
      for (const [offsetKey, words] of Object.entries(raw.relative)) {
        const offset = Number(offsetKey);
        if (!Number.isInteger(offset) || !Array.isArray(words)) continue;
        for (const w of words) {
          const folded = foldLanguageText(w);
          if (!folded) continue;
          relativeMap.set(folded, offset);
          if (folded.includes(" ")) multiWordPhrases.add(folded);
        }
      }
    }

    const weekdayMap = new Map();
    const prefixes = Array.isArray(raw.weekdayPrefixes)
      ? raw.weekdayPrefixes.map((p) => foldLanguageText(p)).filter(Boolean)
      : [];
    if (Array.isArray(raw.weekdays) && raw.weekdays.length === 7) {
      raw.weekdays.forEach((words, wd) => {
        if (!Array.isArray(words)) return;
        for (const w of words) {
          const folded = foldLanguageText(String(w || "").replace(/\.$/, ""));
          if (!folded) continue;
          weekdayMap.set(folded, wd);
          for (const pref of prefixes) {
            const full = pref + " " + folded;
            weekdayMap.set(full, wd);
            multiWordPhrases.add(full);
          }
        }
      });
    }

    const monthMap = new Map();
    if (Array.isArray(raw.months) && raw.months.length === 12) {
      raw.months.forEach((words, idx) => {
        if (!Array.isArray(words)) return;
        for (const w of words) {
          const folded = foldLanguageText(String(w || "").replace(/\.$/, ""));
          if (folded) monthMap.set(folded, idx + 1);
        }
      });
    }

    const phraseOffsets = new Map();
    if (Array.isArray(raw.offsets?.phrases)) {
      for (const entry of raw.offsets.phrases) {
        const folded = foldLanguageText(entry?.phrase);
        const count = Number(entry?.count);
        const unit = String(entry?.unit || "");
        if (!folded || !Number.isInteger(count) || !["d", "w", "m", "y"].includes(unit)) continue;
        phraseOffsets.set(folded, Object.freeze({ unit, count }));
        if (folded.includes(" ")) multiWordPhrases.add(folded);
      }
    }

    const countedRules = [];
    const countedPrefixRes = [];
    if (Array.isArray(raw.offsets?.counted)) {
      for (const rule of raw.offsets.counted) {
        const pref = foldLanguageText(rule?.prefix);
        const suff = foldLanguageText(rule?.suffix);
        const sign = rule?.sign === -1 ? -1 : 1;
        const unitMap = new Map();
        const unitWords = [];
        for (const unit of ["d", "w", "m", "y"]) {
          for (const u of rule?.units?.[unit] || []) {
            const fu = foldLanguageText(u);
            if (fu) { unitMap.set(fu, unit); unitWords.push(escapeRegExp(fu)); }
          }
        }
        if (!unitWords.length) continue;
        unitWords.sort((a, b) => b.length - a.length);
        const unitGroup = "(?:" + unitWords.join("|") + ")";
        const head = pref ? escapeRegExp(pref) + " " : "";
        const tail = suff ? " " + escapeRegExp(suff) : "";
        countedRules.push({
          re: new RegExp("^" + head + "(\\d{1,4}) (" + unitGroup + ")" + tail + "$"),
          sign,
          unitMap,
        });
        const rawPref = pref ? pref.replace(/ /g, "\\s+") + "\\s+" : "";
        const rawSuff = suff ? "\\s+" + suff.replace(/ /g, "\\s+") : "";
        countedPrefixRes.push(new RegExp("^(" + rawPref + "\\d{1,4}\\s+[\\p{L}.]+" + rawSuff + ")(?=\\s|$)", "iu"));
      }
    }

    const ordinalSuffixes = Array.isArray(raw.ordinals)
      ? raw.ordinals.map((s) => foldLanguageText(s)).filter(Boolean).sort((a, b) => b.length - a.length)
      : ["."];
    const ordinalRe = ordinalSuffixes.length
      ? new RegExp("^(\\d{1,2})(?:" + ordinalSuffixes.map(escapeRegExp).join("|") + ")?$")
      : /^(\d{1,2})\.?$/;

    // Verify each candidate span with parseDateText in parseDatePrefix.
    const sortedPhrases = [...multiWordPhrases].sort((a, b) => b.length - a.length);
    const wordCounts = [...new Set(sortedPhrases.map((p) => p.split(" ").length))].sort((a, b) => b - a);
    const phraseSpanRes = [
      ...countedPrefixRes,
      ...wordCounts.map((n) => new RegExp("^([\\p{L}.-]+(?:\\s+[\\p{L}.-]+){" + (n - 1) + "})(?=\\s|$)", "iu")),
    ];

    return Object.freeze({
      code,
      locale,
      name,
      todayLabel,
      overdueLabel,
      agendaLabels,
      dateKinds,
      weekdaysDisplay,
      relativeMap,
      weekdayMap,
      monthMap,
      phraseOffsets,
      countedRules,
      ordinalRe,
      prefixRes: phraseSpanRes,
      strings: raw.strings && typeof raw.strings === "object" ? raw.strings : Object.freeze({}),
    });
  }

  function registerLanguage(raw) {
    const compiled = compileLanguageTable(raw);
    if (!compiled) return null;
    LANG_REGISTRY.set(compiled.code, compiled);
    return compiled;
  }

  // Bootstrap built-in language tables across browser loader, standalone bundle, VM test harness, and Node require.
  (function bootstrapBuiltinLanguages() {
    if (typeof window !== "undefined" && window) {
      const preloaded = window.__zentralNotesLangTables;
      if (preloaded && typeof preloaded === "object") {
        for (const key of Object.keys(preloaded)) registerLanguage(preloaded[key]);
      }
      if (window.ZentralModuleLoader && typeof window.ZentralModuleLoader.get === "function") {
        for (const code of NOTES_LANGUAGES) {
          if (!LANG_REGISTRY.has(code)) {
            const mod = window.ZentralModuleLoader.get("notes-lang-" + code);
            if (mod) registerLanguage(mod);
          }
        }
      }
    }
    if (typeof require === "function") {
      try { if (!LANG_REGISTRY.has("en")) registerLanguage(require("../i18n/en.js")); } catch (_) {}
      try { if (!LANG_REGISTRY.has("pl")) registerLanguage(require("../i18n/pl.js")); } catch (_) {}
    }
    // Minimal inline fallback if neither loader nor require supplied English yet.
    if (!LANG_REGISTRY.has("en")) {
      registerLanguage({
        code: "en",
        locale: "en-GB",
        name: "English",
        agendaLabels: ["Today", "Tomorrow"],
        relative: { "-1": ["yesterday"], "0": ["today"], "1": ["tomorrow"] },
        weekdays: [["sunday", "sun"], ["monday", "mon"], ["tuesday", "tue"], ["wednesday", "wed"], ["thursday", "thu"], ["friday", "fri"], ["saturday", "sat"]],
        months: [["january", "jan"], ["february", "feb"], ["march", "mar"], ["april", "apr"], ["may"], ["june", "jun"], ["july", "jul"], ["august", "aug"], ["september", "sep", "sept"], ["october", "oct"], ["november", "nov"], ["december", "dec"]],
        ordinals: ["st", "nd", "rd", "th", "."],
      });
    }
  })();

  function cleanNotesLanguage(value) {
    const s = String(value ?? "").trim().toLowerCase();
    if (!s) return DEFAULT_NOTES_LANGUAGE;
    if (LANG_REGISTRY.has(s)) return s;
    const base = s.split(/[-_]/)[0];
    if (base && LANG_REGISTRY.has(base)) return base;
    return DEFAULT_NOTES_LANGUAGE;
  }
  function notesLanguageTable(lang) {
    return LANG_REGISTRY.get(cleanNotesLanguage(lang)) || LANG_REGISTRY.get(DEFAULT_NOTES_LANGUAGE);
  }
  function notesLocaleFor(lang) {
    return notesLanguageTable(lang)?.locale || "en-GB";
  }
  // AU-B4b: interface string lookup with per-key English fallback and `{param}` interpolation.
  function translate(key, params = null, lang = DEFAULT_NOTES_LANGUAGE) {
    const k = String(key ?? "");
    if (!k) return "";
    const resolvedLang = cleanNotesLanguage(lang);
    const primary = notesLanguageTable(resolvedLang)?.strings;
    const fallback = notesLanguageTable(DEFAULT_NOTES_LANGUAGE)?.strings;
    let template = primary && Object.prototype.hasOwnProperty.call(primary, k) && typeof primary[k] === "string"
      ? primary[k]
      : (fallback && Object.prototype.hasOwnProperty.call(fallback, k) && typeof fallback[k] === "string" ? fallback[k] : k);
    if (params && typeof params === "object") {
      template = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(params, name) && params[name] !== undefined && params[name] !== null
          ? String(params[name])
          : match
      ));
    }
    return template;
  }
  const t = translate;
  function pluralCategory(count, lang = DEFAULT_NOTES_LANGUAGE) {
    const n = Math.abs(Math.trunc(Number(count) || 0));
    const code = cleanNotesLanguage(lang);
    if (code === "pl") {
      if (n === 1) return "one";
      const mod10 = n % 10, mod100 = n % 100;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
      return "other";
    }
    return n === 1 ? "one" : "other";
  }
  function tCount(baseKey, count, params = null, lang = DEFAULT_NOTES_LANGUAGE) {
    const n = Math.trunc(Number(count) || 0);
    const resolvedLang = cleanNotesLanguage(lang);
    const cat = pluralCategory(n, resolvedLang);
    const primary = notesLanguageTable(resolvedLang)?.strings || {};
    const fallback = notesLanguageTable(DEFAULT_NOTES_LANGUAGE)?.strings || {};
    let chosen = baseKey + "." + cat;
    if (!Object.prototype.hasOwnProperty.call(primary, chosen) || typeof primary[chosen] !== "string") {
      const enCat = pluralCategory(n, DEFAULT_NOTES_LANGUAGE);
      chosen = Object.prototype.hasOwnProperty.call(fallback, baseKey + "." + enCat) ? baseKey + "." + enCat : baseKey + ".other";
    }
    return translate(chosen, { ...(params && typeof params === "object" ? params : {}), count: n }, resolvedLang);
  }
  function translationKeys(lang = DEFAULT_NOTES_LANGUAGE) {
    const strings = notesLanguageTable(lang)?.strings;
    return strings && typeof strings === "object" ? Object.keys(strings) : [];
  }
  function missingTranslationKeys(lang) {
    const base = translationKeys(DEFAULT_NOTES_LANGUAGE);
    const target = notesLanguageTable(lang)?.strings || {};
    return base.filter((k) => !Object.prototype.hasOwnProperty.call(target, k) || typeof target[k] !== "string" || !target[k].length);
  }
  function normalizeDateParseOptions(opts) {
    if (!opts) return { lang: DEFAULT_NOTES_LANGUAGE, acceptAll: true };
    if (typeof opts === "string") return { lang: cleanNotesLanguage(opts), acceptAll: true };
    return {
      lang: cleanNotesLanguage(opts.lang),
      acceptAll: opts.acceptAll !== false,
    };
  }
  function activeLanguageTables(opts) {
    const { lang, acceptAll } = normalizeDateParseOptions(opts);
    const primary = notesLanguageTable(lang);
    if (!acceptAll) return { tables: [primary], acceptAll: false };
    const rest = [];
    for (const [code, table] of LANG_REGISTRY) if (code !== primary.code) rest.push(table);
    return { tables: [primary, ...rest], acceptAll: true };
  }
  function lookupMonthWord(word, tables, acceptAll) {
    const folded = foldLanguageText(String(word || "").replace(/\.$/, ""));
    if (!folded) return 0;
    for (const table of tables) {
      const m = table.monthMap.get(folded);
      if (m) return m;
    }
    return acceptAll ? EXTRA_MONTH_ALIASES[folded] || 0 : 0;
  }
  function parseOrdinalDayToken(token, tables) {
    const plain = /^(\d{1,2})\.?$/.exec(String(token || "").trim());
    if (plain) return +plain[1];
    const folded = foldLanguageText(token);
    for (const table of tables) {
      const m = table.ordinalRe.exec(folded);
      if (m) return +m[1];
    }
    return 0;
  }
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
  // @jutro, @pojutrze, @+3d / @-2d / @+1w / @+1m, 'in 3 days' / 'za 3 dni', 'next week', weekdays, and ordinals.
  // Numeric day-first forms are deliberate; no locale-dependent guessing.
  // Two-digit years use 00-49 => 2000-2049 and 50-99 => 1950-1999.
  function applyCalendarOffset(base, count, unit) {
    if (unit === "d") return addDays(base, count);
    if (unit === "w") return addDays(base, count * 7);
    if (unit === "m" || unit === "y") return shiftCalendarDate(base, count, unit);
    return null;
  }
  function parseDateText(text, now, opts) {
    const t = String(text || "").trim().toLowerCase().replace(/^[@/]/, "").replace(/[,.]$/, "").trim();
    if (!t) return null;
    const base = dayStart(now);
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
    if (m) return dateFromParts(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(t);
    if (m) return dateFromParts(m[3].length === 2 ? twoDigitYear(+m[3]) : +m[3], +m[2], +m[1]);
    const { tables, acceptAll } = activeLanguageTables(opts);
    m = /^(\d{1,2}(?:-[\p{L}]+|[\p{L}]+|\.)?)\s+([\p{L}]+)\.?(?:\s+(\d{2,4}))?$/iu.exec(t);
    if (m) {
      const date = parseOrdinalDayToken(m[1], tables);
      const month = date ? lookupMonthWord(m[2], tables, acceptAll) : 0;
      if (month && date) return m[3] ? dateFromParts(m[3].length === 2 ? twoDigitYear(+m[3]) : +m[3], month, date) : futureMonthDay(month, date, base);
    }
    m = /^([\p{L}]+)\.?\s+(\d{1,2}(?:-[\p{L}]+|[\p{L}]+|\.)?)(?:,?\s+(\d{2,4}))?$/iu.exec(t);
    if (m) {
      const month = lookupMonthWord(m[1], tables, acceptAll);
      const date = month ? parseOrdinalDayToken(m[2], tables) : 0;
      if (month && date) return m[3] ? dateFromParts(m[3].length === 2 ? twoDigitYear(+m[3]) : +m[3], month, date) : futureMonthDay(month, date, base);
    }
    m = /^(\d{1,2})[./-](\d{1,2})\.?$/.exec(t);
    if (m) return futureMonthDay(+m[2], +m[1], base);
    m = /^([+-])(\d{1,4})([dwmy])$/.exec(t);
    if (m) {
      const n = (m[1] === "-" ? -1 : 1) * +m[2];
      return applyCalendarOffset(base, n, m[3]);
    }
    const folded = foldLanguageText(t);
    if (!folded) return null;
    for (const table of tables) {
      if (table.relativeMap.has(folded)) return addDays(base, table.relativeMap.get(folded));
    }
    for (const table of tables) {
      const phrase = table.phraseOffsets.get(folded);
      if (phrase) return applyCalendarOffset(base, phrase.count, phrase.unit);
      for (const rule of table.countedRules) {
        const cm = rule.re.exec(folded);
        if (cm) {
          const unit = rule.unitMap.get(cm[2]);
          if (unit) return applyCalendarOffset(base, rule.sign * +cm[1], unit);
        }
      }
    }
    for (const table of tables) {
      const wd = table.weekdayMap.get(folded);
      if (wd !== undefined) return addDays(base, ((wd - new Date(base).getDay() + 7) % 7) || 7);
    }
    return null;
  }
  // Inline dates are deliberately recognised only in visible plain-text runs by the renderer. This scanner only
  // supplies candidates; the Markdown renderer decides whether the run is inside code, math or a link.
  function inlineDateTokens(text, now, opts) {
    const source = String(text || ""), out = [];
    const month = "[\\p{L}]+\\.?";
    const dayOrd = "\\d{1,2}(?:-[\\p{L}]+|[\\p{L}]+|\\.)?";
    const relative = "@(?:[+-]\\d{1,4}[dwmy]|[\\p{L}]+)";
    const patterns = [
      relative,
      "\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}",
      "\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?",
      "\\d{1,2}\\.\\d{1,2}\\.(?:\\d{2,4})?",
      dayOrd + "\\s+" + month + "(?:\\s+\\d{2,4})?",
      month + "\\s+" + dayOrd + "(?:,?\\s+\\d{2,4})?",
    ];
    const re = new RegExp("(?<![\\p{L}\\p{N}_/@])(" + patterns.join("|") + ")(?:[ T](\\d{1,2}):(\\d{2}))?(?![\\p{L}\\p{N}_/-])", "giu");
    for (let m; (m = re.exec(source)); ) {
      const raw = m[1], day = parseDateText(raw, now, opts);
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
  // A date prefix for list/heading lines; month-name and relative phrases can contain spaces.
  function parseDatePrefix(text, now, opts) {
    const s = String(text || "").trim();
    if (!s) return null;
    const { tables } = activeLanguageTables(opts);
    const phrasePatterns = [];
    for (const table of tables) for (const re of table.prefixRes) phrasePatterns.push(re);
    const patterns = [
      /^(\d{4}[./-]\d{1,2}[./-]\d{1,2})(?=\s|$)/,
      /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})(?=\s|$)/,
      /^(\d{1,2}[./-]\d{1,2}\.?)(?=\s|$)/,
      /^(\d{1,2}(?:-[\p{L}]+|[\p{L}]+|\.)?\s+[\p{L}]+\.?\s+\d{2,4})(?=\s|$)/iu,
      /^(\d{1,2}(?:-[\p{L}]+|[\p{L}]+|\.)?\s+[\p{L}]+\.?)(?=\s|$)/iu,
      /^([\p{L}]+\.?\s+\d{1,2}(?:-[\p{L}]+|[\p{L}]+|\.)?,?\s+\d{2,4})(?=\s|$)/iu,
      /^([\p{L}]+\.?\s+\d{1,2}(?:-[\p{L}]+|[\p{L}]+|\.)?,?)(?=\s|$)/iu,
      ...phrasePatterns,
      /^(\S+)/,
    ];
    for (const re of patterns) {
      const m = re.exec(s);
      if (!m) continue;
      const raw = m[1], day = parseDateText(raw, now, opts);
      // This is deliberately prefix-only. These patterns are anchored and non-global, so lastIndex cannot
      // resume a search later in the line; a leading non-date token means this is not a dated list/heading.
      if (day === null) continue;
      const yearless =
        /^\d{1,2}[./-]\d{1,2}\.?$/.test(raw)
        || (/^\d{1,2}(?:-[\p{L}]+|[\p{L}]+|\.)?\s+[\p{L}]+\.?$/iu.test(raw) && !phrasePatterns.some((pr) => pr.test(raw)))
        || (/^[\p{L}]+\.?\s+\d{1,2}(?:-[\p{L}]+|[\p{L}]+|\.)?,?$/iu.test(raw) && !phrasePatterns.some((pr) => pr.test(raw)));
      return { day, raw, rest: s.slice(raw.length).trim(), yearless };
    }
    return null;
  }
  // ---------- times and dates typed into a field (OW-24) ----------
  // These read what a person types into a field that holds nothing but a time or a date. Text of a note is NOT read
  // with them: parseLine and inlineDateTokens look for the strict forms first ("- 3 apples" is no event at 03:00).
  //
  // A time -> minutes after midnight, or -1.
  //   16, 8                              the hour
  //   830, 0830, 1630                    hour and minutes without a separator (the last two digits are the minutes)
  //   8:30, 8.30, 8,30, 8;30, 8 30, 8h30 hour and minutes; 9:5 is 09:05
  //   16h                                the hour
  //   9am, 9 pm, 9:15pm, 915p, 9.15 p.m. the twelve-hour clock (12am is 00:00, 12pm is 12:00)
  // Never a guess: 25, 860, 24:00, 13pm and 0am are no times.
  function parseClock(text) {
    let t = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!t) return -1;
    let half = "";
    const meridiem = /^(.*\d) ?([ap])(?:\.? ?m\.?)?$/.exec(t);
    if (meridiem) { t = meridiem[1]; half = meridiem[2]; }
    let hour, minute = 0, m;
    if ((m = /^(\d{1,2})$/.exec(t))) hour = +m[1];
    else if ((m = /^(\d{1,2})(\d{2})$/.exec(t))) { hour = +m[1]; minute = +m[2]; }
    else if ((m = /^(\d{1,2}) ?(?:[:.,;]|h) ?(\d{1,2})$/.exec(t)) || (m = /^(\d{1,2}) (\d{1,2})$/.exec(t))) { hour = +m[1]; minute = +m[2]; }
    else if (!half && (m = /^(\d{1,2}) ?h$/.exec(t))) hour = +m[1];
    else return -1;
    if (minute > 59) return -1;
    if (half) {
      if (hour < 1 || hour > 12) return -1;
      hour = (hour % 12) + (half === "p" ? 12 : 0);
    } else if (hour > 23) return -1;
    return hour * 60 + minute;
  }
  // "08:30" for minutes after midnight, "" for anything else. The form every field shows once a time was read.
  const clockOfMinutes = (minutes) => (Number.isInteger(minutes) && minutes >= 0 && minutes < 1440 ? p2(Math.floor(minutes / 60)) + ":" + p2(minutes % 60) : "");
  // A time or two times: "14:30", "06:00-14:00", "8-16", "8:30 - 16", "9am-5pm", "8 to 16"
  // -> { startMin, endMin (-1 = none) } or null. The end may be before the start (22-6): the caller decides.
  function parseTimeRange(text) {
    const t = String(text ?? "").trim();
    const single = parseClock(t);
    if (single >= 0) return { startMin: single, endMin: -1 };
    const m = /^(.*\S)\s*(?:[-\u2013\u2014]|\bto\b)\s*(\S.*)$/i.exec(t);
    if (!m) return null;
    const a = parseClock(m[1]), b = parseClock(m[2]);
    return a < 0 || b < 0 ? null : { startMin: a, endMin: b };
  }
  // Whether the month stands before the day where a date is typed without its year: "md" or "dm". The date format
  // of the settings decides (MM/DD/YYYY and YYYY-MM-DD have the month first; "long" follows the language).
  function dateEntryOrder(format, locale) {
    const f = cleanDateFormat(format);
    if (f === "MM/DD/YYYY" || f === "YYYY-MM-DD") return "md";
    if (f !== "long") return "dm";
    try {
      const kinds = new Intl.DateTimeFormat(locale || undefined, { month: "numeric", day: "numeric" }).formatToParts(new Date(2026, 0, 2)).map((part) => part.type).filter((type) => type === "month" || type === "day");
      return kinds[0] === "month" ? "md" : "dm";
    } catch (_) { return "dm"; }
  }
  // A date -> its key "YYYY-MM-DD", or "".
  //   14                                   the 14th of the month the field shows (opts.base, a key; else this month)
  //   1411, 14.11, 14,11, 14-11, 14/11, 14 11   day and month: the next such day from today on (this year or a later one)
  //   14.11.2026, 14-11-26, 2026-11-14     with the year; two digits of a year are 2000-2049 and 1950-1999
  //   tomorrow, +3d, fri, 14 nov           the words parseDateText knows
  // opts: { now, base, format, locale }. Where day and month could be either way round the format decides
  // (dateEntryOrder); the other order is taken only where the first gives no date at all (14.11 with the month first).
  function parseDateEntry(text, opts = {}) {
    const raw = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!raw) return "";
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now(), today = dayStart(now);
    const key = (year, month, day) => { const ms = dateFromParts(year, month, day); return ms === null ? "" : ymd(new Date(ms)); };
    const monthFirst = dateEntryOrder(opts.format, opts.locale) === "md";
    const orders = (a, b) => (monthFirst ? [[b, a], [a, b]] : [[a, b], [b, a]]); // [day, month], the order of the format first
    // Between two numbers: one of - / . , with a space on either side, or a space alone ("14.11", "14. 11", "14 11").
    let m = /^(\d{4})(?: ?[-/.] ?| )(\d{1,2})(?: ?[-/.] ?| )(\d{1,2})$/.exec(raw);
    if (m) return key(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})(?: ?[-/.,] ?| )(\d{1,2})(?: ?[-/.,] ?| )(\d{2}|\d{4})\.?$/.exec(raw);
    if (m) {
      const year = m[3].length === 2 ? twoDigitYear(+m[3]) : +m[3];
      for (const [day, month] of orders(+m[1], +m[2])) { const found = key(year, month, day); if (found) return found; }
      return "";
    }
    m = /^(\d{1,2})(?: ?[-/.,] ?| )(\d{1,2})\.?$/.exec(raw) || /^(\d{2})(\d{2})$/.exec(raw);
    if (m) {
      for (const [day, month] of orders(+m[1], +m[2])) { const ms = futureMonthDay(month, day, today); if (ms !== null) return ymd(new Date(ms)); }
      return "";
    }
    m = /^(\d{1,2})\.?$/.exec(raw);
    if (m) { const shown = parseYmd(opts.base) || new Date(today); return key(shown.getFullYear(), shown.getMonth() + 1, +m[1]); }
    const ordinal = parseOrdinalDayToken(raw, activeLanguageTables(opts).tables);
    if (ordinal) { const shown = parseYmd(opts.base) || new Date(today); return key(shown.getFullYear(), shown.getMonth() + 1, ordinal); }
    if (!/[\p{L}]/u.test(raw)) return "";
    const ms = parseDateText(raw, now, opts);
    return ms === null ? "" : ymd(new Date(ms));
  }
  // One line of a plain list: "- 06:00-14:00 Work", "10-08 Jan Kowalski", "2026-11-20 14:00 Dentist" -> parts or null.
  // The leading date is optional when `defaultDay` (local midnight ms) is given.
  function parseLine(line, now, defaultDay, opts) {
    let t = String(line || "").replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "").trim();
    if (!t) return null;
    let day = defaultDay ?? null, yearless = false;
    const prefix = parseDatePrefix(t, now, opts);
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
  function reminderDueAt(item) {
    if (!item?.start) return 0;
    const start = whenMs(item.start);
    if (!Number.isFinite(start) || start <= 0) return 0;
    const googleLead = (item.reminders?.overrides || []).reduce((max, override) => Math.max(max, Number(override?.minutes) || 0), 0);
    return start - googleLead * MIN;
  }
  function reminderPreCountdownText(dueAt, now = Date.now(), lang = DEFAULT_NOTES_LANGUAGE) {
    const due = Number(dueAt), at = Number(now);
    if (!Number.isFinite(due) || due <= 0 || !Number.isFinite(at)) return "";
    const remaining = due - at;
    if (remaining <= 0) return t("alert.countdown.dueNow", null, lang);
    const totalSec = Math.max(1, Math.ceil(remaining / 1000));
    if (totalSec >= 3600) {
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      return t("alert.countdown.hoursMin", { h, m }, lang);
    }
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return t("alert.countdown.minSec", { m, s: String(s).padStart(2, "0") }, lang);
  }
  function reminderCountdownDelayMs(dueAt, now = Date.now()) {
    const due = Number(dueAt), at = Number(now);
    if (!Number.isFinite(due) || due <= 0 || !Number.isFinite(at)) return 0;
    const remaining = due - at;
    if (remaining <= 0) return 0;
    if (remaining > 3600000) return (remaining % 60000) || 60000;
    return (remaining % 1000) || 1000;
  }
  const ALERT_LAYOUTS = Object.freeze(["corner", "large", "centred"]);
  function cleanAlertLayout(value, fallback = "corner") {
    const raw = String(value || "").trim().toLowerCase();
    const normalized = raw === "centered" ? "centred" : raw;
    if (ALERT_LAYOUTS.includes(normalized)) return normalized;
    const fb = String(fallback || "").trim().toLowerCase();
    const normFb = fb === "centered" ? "centred" : fb;
    return ALERT_LAYOUTS.includes(normFb) ? normFb : "corner";
  }
  const DEFAULT_ALERT_SETTINGS = Object.freeze({
    stages: Object.freeze({
      pre: Object.freeze({ sound: "normal", layout: "corner", quietAllow: Object.freeze([]) }),
      due: Object.freeze({ sound: "loud", layout: "large", quietAllow: Object.freeze([]) }),
      followup: Object.freeze({ sound: "normal", layout: "centred", quietAllow: Object.freeze([]) }),
    }),
    quietHours: Object.freeze({ enabled: false, start: "22:00", end: "07:00", days: Object.freeze([0, 1, 2, 3, 4, 5, 6]), allowed: Object.freeze({ pre: Object.freeze([]), due: Object.freeze([]), followup: Object.freeze([]) }) }),
  });
  function cleanSoundRule(raw, fallback = {}) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const rawLayout = String(src.layout || "").trim().toLowerCase();
    const layoutExplicit = ALERT_LAYOUTS.includes(rawLayout === "centered" ? "centred" : rawLayout);
    return {
      sound: SOUND_LEVELS.includes(src.sound) ? src.sound : (SOUND_LEVELS.includes(fallback.sound) ? fallback.sound : "normal"),
      soundSpecified: typeof src.soundSpecified === "boolean" ? src.soundSpecified : SOUND_LEVELS.includes(src.sound),
      layout: cleanAlertLayout(src.layout, fallback.layout || "corner"),
      layoutSpecified: typeof src.layoutSpecified === "boolean" ? src.layoutSpecified : layoutExplicit,
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
    if (x.src === "list" && typeof x.categoryOverride === "string") item.x.categoryOverride = cleanCategoryName(x.categoryOverride);
    if (x.src === "list" && x.categoryInNote === true) item.x.categoryInNote = true;
    if (x.src === "list") {
      const textSchedule = cleanTextSchedule(x.textSchedule);
      if (textSchedule) item.x.textSchedule = textSchedule;
    }
    if (end) item.end = end;
    if (typeof raw.created === "string" && Number.isFinite(Date.parse(raw.created))) item.created = iso(Date.parse(raw.created));
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

  // OW-29: Canonical schedule signature parsed from a Markdown calendar list line:
  // "YYYY-MM-DD|startMin|endMin|yearless(0|1)". Stored on src:"list" items as x.textSchedule so syncNote
  // moves an item only when the line's parsed schedule actually changed, while unrelated text edits keep
  // calendar moves intact.
  function lineScheduleSignature(parsed) {
    if (!parsed || !Number.isFinite(parsed.day)) return "";
    const dateKey = ymd(new Date(parsed.day));
    if (!parseYmd(dateKey)) return "";
    const s = Number.isInteger(parsed.startMin) && parsed.startMin >= 0 && parsed.startMin <= 1439 ? parsed.startMin : -1;
    const e = Number.isInteger(parsed.endMin) && parsed.endMin >= 0 && parsed.endMin <= 1439 ? parsed.endMin : -1;
    const y = parsed.yearless ? 1 : 0;
    return `${dateKey}|${s}|${e}|${y}`;
  }
  function cleanTextSchedule(value) {
    const m = /^(\d{4}-\d{2}-\d{2})\|(-?\d{1,4})\|(-?\d{1,4})\|([01])$/.exec(String(value || "").trim());
    if (!m || !parseYmd(m[1])) return "";
    const s = Number(m[2]), e = Number(m[3]);
    if (!Number.isInteger(s) || s < -1 || s > 1439) return "";
    if (!Number.isInteger(e) || e < -1 || e > 1439) return "";
    return `${m[1]}|${s}|${e}|${m[4]}`;
  }
  function scheduleSignatureFromItem(item, fallbackSig = "") {
    if (!item || !item.start) return "";
    const yearless = fallbackSig.endsWith("|1") ? 1 : 0;
    if (isAllDay(item)) return `${item.start.date}|-1|-1|${yearless}`;
    const [startMs, endMs] = itemRange(item);
    if (!Number.isFinite(startMs)) return "";
    const tz = cleanZone(item.x?.tz);
    const sp = zoneParts(startMs, tz);
    if (!sp) return "";
    const dateKey = `${sp.year}-${p2(sp.month)}-${p2(sp.day)}`;
    const startMin = sp.hour * 60 + sp.minute;
    let endMin = -1;
    if (item.end && item.x?.kind === "event" && Number.isFinite(endMs) && endMs > startMs) {
      const ep = zoneParts(endMs, tz);
      if (ep) endMin = ep.hour * 60 + ep.minute;
    }
    return `${dateKey}|${startMin}|${endMin}|${yearless}`;
  }
  // Build DST-safe { start, end, kind } from a parsed Markdown line, honoring an explicit IANA/fixed tz when set.
  function scheduleFromParsedLine(parsed, { tz = "", existing = null, defaultKind = "" } = {}) {
    if (!parsed || !Number.isFinite(parsed.day)) return null;
    const dateKey = ymd(new Date(parsed.day));
    if (!parseYmd(dateKey)) return null;
    const zone = cleanZone(tz);
    if (parsed.startMin < 0) {
      const keepAllDayEvent = (existing?.x?.kind === "event" && !!existing.start?.date) || defaultKind === "event";
      if (keepAllDayEvent) {
        const spanDays = existing?.start?.date && existing?.end?.date
          ? Math.max(1, localDayOrdinal(whenMs(existing.end)) - localDayOrdinal(whenMs(existing.start)))
          : 1;
        return { start: { date: dateKey }, end: { date: ymd(new Date(addDays(parsed.day, spanDays))) }, kind: "event" };
      }
      return { start: { date: dateKey }, end: undefined, kind: "reminder" };
    }
    const startMs = zonedDateTimeToMs(dateKey, clockOfMinutes(parsed.startMin), zone);
    if (!Number.isFinite(startMs)) return null;
    const start = { dateTime: iso(startMs) };
    if (parsed.endMin >= 0) {
      // A range that ends at or before its start crosses midnight. Equal clocks mean a full 24-hour event.
      const endDateKey = parsed.endMin <= parsed.startMin ? ymd(new Date(addDays(parsed.day, 1))) : dateKey;
      let endMs = zonedDateTimeToMs(endDateKey, clockOfMinutes(parsed.endMin), zone);
      if (!Number.isFinite(endMs) || endMs <= startMs) {
        const fallbackMin = ((parsed.endMin - parsed.startMin + 1440) % 1440) || 60;
        endMs = startMs + fallbackMin * MIN;
      }
      return { start, end: { dateTime: iso(endMs) }, kind: "event" };
    }
    return { start, end: undefined, kind: "reminder" };
  }
  const sameItemSchedule = (a, b) => Boolean(
    a && b &&
    JSON.stringify(a.start || null) === JSON.stringify(b.start || null) &&
    JSON.stringify(a.end || null) === JSON.stringify(b.end || null) &&
    (a.kind || a.x?.kind) === (b.kind || b.x?.kind)
  );
  // Pure OW-29 reconciliation of an existing list item `old` against freshly parsed line item `fresh`.
  function reconcileListItem(old, fresh, { sourceEdit = false, updatedAt = 0, calendarSync = false, remote = false } = {}) {
    const freshSig = cleanTextSchedule(fresh.x?.textSchedule || lineScheduleSignature(fresh._parsed));
    const storedSig = cleanTextSchedule(old.x?.textSchedule || "");
    const priorSig = storedSig || (!old.x?.moved ? scheduleSignatureFromItem(old, freshSig) : freshSig);
    const scheduleChanged = !calendarSync && Boolean(freshSig && priorSig && freshSig !== priorSig);

    const hasStamp = Number.isFinite(Number(updatedAt)) && Number(updatedAt) > 0;
    const editMs = hasStamp ? Number(updatedAt) : 0;
    const oldMs = Number.isFinite(Date.parse(old.updated)) ? Date.parse(old.updated) : 0;
    const stamp = hasStamp && (sourceEdit || scheduleChanged) ? iso(editMs) : old.updated;
    const shouldBumpRev = sourceEdit && !remote && (!hasStamp || editMs >= oldMs);
    const revision = shouldBumpRev
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, old.rev || 0) + 1)
      : Math.max(0, old.rev || 0);

    const noteCategory = fresh.x?.categoryInNote === true;
    const priorNoteCategory = old.x?.categoryInNote === true;
    const override = noteCategory ? fresh.x.categoryOverride : (!priorNoteCategory ? old.x.categoryOverride : undefined);

    let nextStart = old.start;
    let nextEnd = old.end;
    let nextKind = old.x.kind;
    let nextMoved = old.x.moved;
    let nextExceptions = old.x.recurrenceExceptions;

    if (scheduleChanged) {
      const parsedSched = fresh._parsed
        ? scheduleFromParsedLine(fresh._parsed, { tz: old.x.tz, existing: old })
        : { start: fresh.start, end: fresh.end, kind: fresh.x.kind };
      if (parsedSched) {
        if (sameItemSchedule(old, parsedSched)) {
          nextMoved = "";
        } else {
          const modeFlipped = Boolean(parsedSched.start?.date) !== Boolean(old.start?.date);
          nextStart = parsedSched.start;
          nextEnd = parsedSched.end;
          nextKind = parsedSched.kind;
          nextMoved = "";
          if (modeFlipped) nextExceptions = [];
          else if (Array.isArray(old.x.recurrenceExceptions) && old.x.recurrenceExceptions.length) {
            // Master start itself moved in text: drop stale whole-series shifts so they do not stack on top.
            nextExceptions = old.x.recurrenceExceptions.filter((entry) => entry.scope !== "series");
          }
        }
      }
    }

    const candidateRaw = {
      ...fresh,
      start: nextStart,
      status: old.status,
      reminders: old.reminders,
      recurrence: old.recurrence.length ? old.recurrence : fresh.recurrence,
      updated: stamp,
      rev: revision,
      etag: "",
      description: fresh.description || old.description,
      x: {
        ...fresh.x,
        kind: nextKind,
        tz: old.x.tz,
        calNote: old.x.calNote,
        moved: nextMoved,
        notify: old.x.notify,
        agendaWindow: old.x.agendaWindow,
        recurrenceExceptions: nextExceptions,
        historyId: old.x.historyId,
        ...(freshSig ? { textSchedule: freshSig } : {}),
        ...(typeof override === "string" ? { categoryOverride: override } : {}),
        ...(noteCategory ? { categoryInNote: true } : {}),
      },
    };
    if (nextEnd) candidateRaw.end = nextEnd;
    else delete candidateRaw.end;

    const candidate = cleanItem(candidateRaw, 0);
    candidate.x.heading = fresh.x.heading;
    candidate.x.category = typeof override === "string" ? override : fresh.x.category;
    const winner = lwwPick(old, candidate);
    if (winner === old) {
      // Keep the winning calendar record untouched, only syncing x.textSchedule to the current note line so a
      // later unrelated text edit does not mistake the stale line text for a fresh schedule retype.
      if (freshSig && old.x.textSchedule !== freshSig) {
        const syncedOld = cleanItem({ ...old, x: { ...old.x, textSchedule: freshSig }, etag: "" }, 0);
        syncedOld.etag = etagOf(syncedOld);
        return syncedOld;
      }
      return old;
    }
    winner.etag = etagOf(winner);
    return winner;
  }

  // Build an item from a parsed list line (parseLine).
  function itemFromLine(parsed, extra = {}, now = 0) {
    if (!parsed) return null;
    const sched = scheduleFromParsedLine(parsed, { tz: extra?.tz || "", defaultKind: extra?.kind || "" });
    if (!sched) return null;
    const textSchedule = lineScheduleSignature(parsed);
    const base = {
      summary: parsed.summary,
      start: sched.start,
      ...(sched.end ? { end: sched.end } : {}),
      x: { ...extra, kind: sched.kind, ...(textSchedule ? { textSchedule } : {}) },
    };
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
  const WEEK_START_DAYS = Object.freeze([1, 0]);
  function cleanWeekStart(value) {
    if (value === 0 || value === "0") return 0;
    if (value === 1 || value === "1") return 1;
    if (typeof value === "string") {
      const s = value.trim().toLowerCase();
      if (s === "sun" || s === "sunday") return 0;
      if (s === "mon" || s === "monday") return 1;
    }
    return 1;
  }
  function cleanWeekNumbers(value) {
    return value === true;
  }
  const SHORT_WEEKDAY_NAMES = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  const LONG_WEEKDAY_NAMES = Object.freeze(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
  function weekdayLabels(weekStart = 1, style = "short", lang = DEFAULT_NOTES_LANGUAGE) {
    const ws = cleanWeekStart(weekStart);
    const table = notesLanguageTable(lang);
    const names = style === "long" ? table.weekdaysDisplay.longSun : table.weekdaysDisplay.shortSun;
    return Array.from({ length: 7 }, (_, i) => names[(ws + i) % 7]);
  }
  // Pure week-of-year number in civil coordinates (immune to DST): ISO 8601 when weekStart = 1 (Monday),
  // Sunday-first week-of-year (Week 1 contains Jan 1) when weekStart = 0 (Sunday).
  function weekNumber(day, weekStart = 1) {
    const d = new Date(dayStart(day));
    const u = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const ws = cleanWeekStart(weekStart);
    if (ws === 0) {
      const dow = new Date(u).getUTCDay();
      const sat = u + (6 - dow) * 86400000;
      const year = new Date(sat).getUTCFullYear();
      const jan1 = Date.UTC(year, 0, 1);
      const week1Sun = jan1 - new Date(jan1).getUTCDay() * 86400000;
      const sun = u - dow * 86400000;
      return Math.floor((sun - week1Sun) / (7 * 86400000)) + 1;
    }
    const isoDow = new Date(u).getUTCDay() || 7;
    const thu = u + (4 - isoDow) * 86400000;
    const isoYear = new Date(thu).getUTCFullYear();
    const jan1 = Date.UTC(isoYear, 0, 1);
    return Math.ceil(((thu - jan1) / 86400000 + 1) / 7);
  }
  // Month grid: 6 weeks x 7 days of local midnights; weekStart 0 = Sunday, 1 = Monday.
  function monthGrid(year, month, weekStart = 1) {
    const ws = cleanWeekStart(weekStart);
    const first = new Date(year, month, 1);
    const lead = (first.getDay() - ws + 7) % 7;
    const days = [];
    for (let i = 0; i < 42; i++) days.push(new Date(year, month, 1 - lead + i).getTime());
    return Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));
  }
  // Seven local midnights containing `day`; defaults to Monday-first to match the month view.
  function weekDays(day, weekStart = 1) {
    const ws = cleanWeekStart(weekStart);
    const start = dayStart(day), offset = (new Date(start).getDay() - ws + 7) % 7;
    const first = addDays(start, -offset);
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }
  const WEEK_DAYS_LIMITS = Object.freeze({ min: 1, max: 14, default: 7, minColPx: 84, gutterPx: 42 });
  const WEEK_RANGE_STARTS = Object.freeze(["weekStart", "today", "selected"]);
  const DEFAULT_WEEK_SPAN = Object.freeze({ days: 7, anchor: "weekStart" });
  function cleanWeekDaysCount(value, fallback = 7) {
    if (typeof value === "string" && value.trim().toLowerCase() === "auto") return "auto";
    const n = Number(value);
    if (Number.isFinite(n) && value !== "" && value !== null && typeof value !== "boolean") {
      return Math.min(WEEK_DAYS_LIMITS.max, Math.max(WEEK_DAYS_LIMITS.min, Math.round(n)));
    }
    if (fallback === "auto") return "auto";
    const fb = Number(fallback);
    return Number.isFinite(fb) ? Math.min(WEEK_DAYS_LIMITS.max, Math.max(WEEK_DAYS_LIMITS.min, Math.round(fb))) : 7;
  }
  function cleanWeekRangeAnchor(value) {
    if (value === "today") return "today";
    if (value === "selected" || value === "cursor") return "selected";
    return "weekStart";
  }
  function cleanWeekSpan(raw) {
    if (raw === "auto" || typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "")) {
      return { days: cleanWeekDaysCount(raw, 7), anchor: "weekStart" };
    }
    if (!raw || typeof raw !== "object") return { ...DEFAULT_WEEK_SPAN };
    return {
      days: cleanWeekDaysCount(raw.days, 7),
      anchor: cleanWeekRangeAnchor(raw.anchor),
    };
  }
  function fitWeekDayCount(widthPx, { minColPx = WEEK_DAYS_LIMITS.minColPx, gutterPx = WEEK_DAYS_LIMITS.gutterPx, min = WEEK_DAYS_LIMITS.min, max = WEEK_DAYS_LIMITS.max, fallback = WEEK_DAYS_LIMITS.default } = {}) {
    const w = Number(widthPx);
    if (!(w > 0)) return fallback;
    const usable = Math.max(0, w - (Number(gutterPx) || 0));
    const col = Math.max(1, Number(minColPx) || WEEK_DAYS_LIMITS.minColPx);
    return Math.max(min, Math.min(max, Math.floor(usable / col) || 1));
  }
  // OW-25: `count` consecutive local midnights starting at `start` (clamped 1..14, DST-safe).
  function visibleDays(start, count = 7) {
    const base = dayStart(start);
    const n = cleanWeekDaysCount(count, 7);
    const len = n === "auto" ? 7 : n;
    return Array.from({ length: len }, (_, i) => addDays(base, i));
  }
  function resolveWeekVisibleDays({ cursor, today, weekStart = 1, span, widthPx = 0, panDay = "" } = {}) {
    const cfg = cleanWeekSpan(span);
    const count = cfg.days === "auto" ? fitWeekDayCount(widthPx) : cfg.days;
    const pan = panDay ? parseYmd(panDay) : null;
    let startDay;
    if (pan) startDay = pan.getTime();
    else if (cfg.anchor === "today") startDay = dayStart(today === undefined ? cursor : today);
    else if (cfg.anchor === "selected") startDay = dayStart(cursor);
    else startDay = weekDays(cursor, weekStart)[0];
    return visibleDays(startDay, count);
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
  // startMin / endMin are minutes on the clock of that day (in `zone`, or the computer's zone), cut off at its ends.
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
        startMin: Math.round(zonedMinuteOfDay(r.s, dateKey, zone)), endMin: Math.round(zonedMinuteOfDay(r.e, dateKey, zone)) });
      cluster = []; clusterEnd = -Infinity;
    };
    for (const r of rows) {
      if (cluster.length && r.s >= clusterEnd) flush();
      cluster.push(r); clusterEnd = Math.max(clusterEnd, r.e);
    }
    if (cluster.length) flush();
    return out;
  }
  // Side-by-side columns for Week/Day grid boxes measured in clock-grid minutes [0..1440].
  // Clustering on drawn clock-grid intervals keeps repeated fall-back events (1st-pass CEST vs 2nd-pass CET at 02:15)
  // in separate side-by-side lanes instead of burying each other, and prevents short pre-gap boxes (01:50 + 20px) on
  // spring-forward days from falsely colliding with post-gap events (03:05).
  function layoutGridSpans(spans, { minBoxMin = 1, overlapMin = 0, gridEndMin = 1440 } = {}) {
    const minBox = Math.max(1, Math.ceil(Number(minBoxMin) || 1));
    const allowOverlap = Math.max(0, Math.floor(Number(overlapMin) || 0));
    const endCap = Number.isFinite(Number(gridEndMin)) ? Number(gridEndMin) : 1440;
    const lastBoxStart = endCap - minBox;
    const rows = (spans || []).map((span) => {
      const reminder = !!span.reminder;
      const rawStart = Number(span.startMin) || 0;
      const rawEnd = reminder ? rawStart : (Number(span.endMin) || 0);
      const naturalLen = rawEnd - rawStart;
      let boxStartMin, boxEndMin;
      if (!reminder && naturalLen >= minBox) {
        boxStartMin = rawStart;
        boxEndMin = rawEnd;
      } else {
        boxStartMin = rawStart - Math.max(0, rawStart - lastBoxStart);
        const length = reminder ? minBox : Math.max(1, naturalLen, minBox - allowOverlap);
        boxEndMin = boxStartMin + length;
      }
      return {
        span,
        item: span.item,
        original: span.item,
        realStart: Number(span.start) || 0,
        startMin: boxStartMin,
        endMin: Math.max(boxStartMin + 1, boxEndMin),
      };
    }).sort((a, b) => (
      a.startMin - b.startMin ||
      a.realStart - b.realStart ||
      (b.endMin - b.startMin) - (a.endMin - a.startMin) ||
      (String(a.item?.id || "") < String(b.item?.id || "") ? -1 : String(a.item?.id || "") > String(b.item?.id || "") ? 1 : 0)
    ));
    const out = [];
    let cluster = [], clusterEnd = -Infinity;
    const flush = () => {
      const laneEnds = [];
      for (const r of cluster) {
        let lane = laneEnds.findIndex((end) => end <= r.startMin);
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(r.endMin); } else laneEnds[lane] = r.endMin;
        r.lane = lane;
      }
      for (const r of cluster) {
        out.push({
          item: r.item,
          original: r.original,
          span: r.span,
          lane: r.lane,
          lanes: laneEnds.length,
          startMin: r.startMin,
          endMin: r.endMin,
        });
      }
      cluster = [];
      clusterEnd = -Infinity;
    };
    for (const r of rows) {
      if (cluster.length && r.startMin >= clusterEnd) flush();
      cluster.push(r);
      clusterEnd = Math.max(clusterEnd, r.endMin);
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
  const CALENDAR_SNAP_STEPS = Object.freeze([5, 10, 15, 30, 60]);
  function cleanCalendarSnap(value) { const n = Number(value); return CALENDAR_SNAP_STEPS.includes(n) ? n : 15; }
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
    const step = cleanCalendarSnap(snapMin);
    const minutes = Math.round((parts.hour * 60 + parts.minute + (dayIndex(target) - dayIndex(origin)) * 1440 + targetMinute - originMinute) / step) * step;
    const wall = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + minutes * MIN);
    const date = String(wall.getUTCFullYear()).padStart(4, "0") + "-" + p2(wall.getUTCMonth() + 1) + "-" + p2(wall.getUTCDate());
    if (!parseYmd(date)) return null;
    return { date, minute: wall.getUTCHours() * 60 + wall.getUTCMinutes() };
  }
  // Moving an expanded recurring occurrence requires a scope chooser; legacy note
  // reminders and all-day items use separate paths and are never accepted here.
  function calendarMoveTimedItem(item, placement, zone = "", now = Date.now()) {
    if (!item?.x || !item?.start || isAllDay(item) || !item.start?.dateTime || (!isReminder(item) && !item.end?.dateTime) || item.x?.src === "note"
        || item.x?.series || (item.recurrence || []).length || !parseYmd(placement?.date)
        || !Number.isInteger(placement?.minute) || placement.minute < 0 || placement.minute >= 1440 || (zone && !cleanZone(zone))) return null;
    const [start, end] = itemRange(item);
    if (!Number.isFinite(start) || (!isReminder(item) && !(end > start))) return null;
    const clock = p2(Math.floor(placement.minute / 60)) + ":" + p2(placement.minute % 60);
    const target = zonedDateTimeToMs(placement.date, clock, zone);
    if (!Number.isFinite(target)) return null;
    const stamp = typeof now === "function" ? now() : Number(now);
    return cleanItem({ ...item, start: { dateTime: iso(target) }, end: isReminder(item) ? undefined : { dateTime: iso(target + end - start) },
      x: { ...item.x, moved: item.x?.src === "list" ? "1" : item.x?.moved }, etag: "", updated: iso(Number.isFinite(stamp) ? stamp : Date.now()) }, 0);
  }
  function calendarMoveAllDayReminder(item, originKey, targetKey, now = Date.now()) {
    const origin = parseYmd(originKey), target = parseYmd(targetKey), start = parseYmd(item?.start?.date);
    if (!item?.x || !item?.start || !isReminder(item) || !isAllDay(item) || !origin || !target || !start || item.x?.src === "note"
        || item.x?.series || (item.recurrence || []).length) return null;
    const offset = localDayOrdinal(target.getTime()) - localDayOrdinal(origin.getTime());
    const result = ymd(new Date(addDays(start.getTime(), offset)));
    if (!parseYmd(result)) return null;
    const stamp = typeof now === "function" ? now() : Number(now);
    return cleanItem({ ...item, start: { date: result }, end: undefined,
      x: { ...item.x, moved: item.x?.src === "list" ? "1" : item.x?.moved }, etag: "", updated: iso(Number.isFinite(stamp) ? stamp : Date.now()) }, 0);
  }
  function calendarMoveTimedEvent(item, placement, zone = "", now = Date.now()) {
    return !item?.x || isReminder(item) ? null : calendarMoveTimedItem(item, placement, zone, now);
  }
  // T2.5: resolve a pointer-drag placement on an expanded recurring occurrence into a target
  // start (`{ date }` for all-day, `{ dateTime }` for timed) without mutating anything.
  function calendarOccurrenceTargetStart(occurrence, placement, { originKey = "", zone = "", allDay = false } = {}) {
    if (!occurrence?.x?.series || !occurrence.x?.recurrenceId || !occurrence.start || !placement || typeof placement !== "object") return null;
    const itemAllDay = isAllDay(occurrence);
    if (Boolean(allDay) !== itemAllDay) return null;
    if (itemAllDay) {
      const origin = parseYmd(originKey || occurrence.start.date), target = parseYmd(placement.date), start = parseYmd(occurrence.start.date);
      if (!origin || !target || !start) return null;
      const offset = localDayOrdinal(target.getTime()) - localDayOrdinal(origin.getTime());
      const result = ymd(new Date(addDays(start.getTime(), offset)));
      return parseYmd(result) ? { date: result } : null;
    }
    if (!occurrence.start.dateTime || !parseYmd(placement.date)
        || !Number.isInteger(placement.minute) || placement.minute < 0 || placement.minute >= 1440 || (zone && !cleanZone(zone))) return null;
    const clock = p2(Math.floor(placement.minute / 60)) + ":" + p2(placement.minute % 60);
    const target = zonedDateTimeToMs(placement.date, clock, zone);
    return Number.isFinite(target) ? { dateTime: iso(target) } : null;
  }
  // T2.5: move an expanded recurring occurrence from a pointer-drag placement using an explicit
  // recurrence scope ("this" | "following" | "series"). Built on moveOccurrence so master/exceptions stay pure.
  function calendarMoveRecurringOccurrence(master, occurrence, placement, scope, { originKey = "", zone = "", allDay = false, now = Date.now() } = {}) {
    if (!master?.x || master.x.src === "note" || !occurrence?.x?.series || occurrence.x.series !== master.id) return null;
    const itemAllDay = isAllDay(master);
    if (Boolean(allDay) !== itemAllDay) return null;
    const targetStart = calendarOccurrenceTargetStart(occurrence, placement, { originKey, zone, allDay: itemAllDay });
    if (!targetStart) return null;
    return moveOccurrence(master, occurrence, targetStart, scope, now);
  }
  const NOTE_DRAG_MIME = "application/x-zentral-note-id";

  // OW-02: map a calendar drop surface and pointer position to composer prefill fields without mutating any store.
  // Month, narrow Month picker (OW-09) and Week/Day all-day cells resolve to all-day reminders (with an exclusive
  // next-day endDate ready if the user switches Type to Event); Week/Day time tracks snap to `snapMin` inside the
  // visible grid hours and resolve against `zone` (advancing across spring-forward gaps via zonedDateTimeToMs).
  function calendarNoteDropSlot(surface, dateKey, { offsetPx = 0, hourPx = 54, grid = null, snapMin = 15, zone = "", durationMin = 60 } = {}) {
    if (!["month", "picker", "allday", "time"].includes(surface)) return null;
    const day = parseYmd(dateKey);
    if (!day) return null;
    const rawZone = String(zone || "").trim();
    const validZone = rawZone ? cleanZone(rawZone) : "";
    if (rawZone && !validZone) return null;
    if (surface !== "time") {
      return {
        surface,
        kind: "reminder",
        allDay: true,
        date: dateKey,
        endDate: ymd(new Date(addDays(day.getTime(), 1))),
        tz: validZone,
        minute: null,
      };
    }
    const px = Number(hourPx);
    if (!Number.isFinite(px) || !(px > 0)) return null;
    const step = cleanCalendarSnap(snapMin);
    const minMinute = Math.max(0, gridStartMin(grid));
    const timeline = grid?.timeline || null;
    const endCap = timeline ? Math.max(0, timeline.totalMinutes - step) : 1440 - step;
    const maxMinute = Math.max(minMinute, Math.min(endCap, gridEndMin(grid)));
    const rawMinute = gridMinuteAt(offsetPx, px, grid);
    const snapped = Math.max(minMinute, Math.min(maxMinute, Math.round(rawMinute / step) * step));
    const startMs = timeline
      ? timelineMsAt(dateKey, snapped, timeline, validZone)
      : zonedDateTimeToMs(dateKey, clockOfMinutes(snapped), validZone);
    if (!Number.isFinite(startMs)) return null;
    const resolvedDate = zonedDateKey(startMs, validZone);
    const startTime = clockIn(startMs, validZone);
    const dur = Math.max(step, Math.round(Number(durationMin) || 60));
    const endMs = startMs + dur * MIN;
    const resolvedMin = parseClock(startTime);
    return {
      surface: "time",
      kind: "reminder",
      allDay: false,
      date: resolvedDate,
      startTime,
      endDate: zonedDateKey(endMs, validZone),
      endTime: clockIn(endMs, validZone),
      tz: validZone,
      minute: timeline ? snapped : (resolvedMin >= 0 ? resolvedMin : snapped),
    };
  }

  function calendarNoteDropLabel(target, fmt = DEFAULT_DATE_FORMAT) {
    if (!target || typeof target !== "object" || !parseYmd(target.date)) return "";
    const dayText = formatDateKey(target.date, fmt);
    if (target.allDay) return `${dayText} · all day`;
    return target.startTime ? `${dayText} · ${target.startTime}` : dayText;
  }

  // The drag-create range is civil-time based and direction independent. Only
  // produce composer fields after both endpoints resolve to real instants.
  function calendarDraftRange(originKey, originMinute, targetKey, targetMinute, zone = "", snapMin = 15) {
    const origin = parseYmd(originKey), target = parseYmd(targetKey);
    if (!origin || !target || !Number.isFinite(originMinute) || !Number.isFinite(targetMinute)
        || originMinute < 0 || originMinute > 1440 || targetMinute < 0 || targetMinute > 1440 || (zone && !cleanZone(zone))) return null;
    const step = cleanCalendarSnap(snapMin);
    const wall = (day, minute) => Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) + Math.round(minute / step) * step * MIN;
    const a = wall(origin, originMinute), b = wall(target, targetMinute);
    if (a === b) return null;
    const resolve = (stamp) => {
      const day = new Date(stamp), key = String(day.getUTCFullYear()).padStart(4, "0") + "-" + p2(day.getUTCMonth() + 1) + "-" + p2(day.getUTCDate());
      const clock = p2(day.getUTCHours()) + ":" + p2(day.getUTCMinutes());
      return parseYmd(key) ? zonedDateTimeToMs(key, clock, zone) : null;
    };
    const start = resolve(Math.min(a, b)), end = resolve(Math.max(a, b));
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
    return { startDate: zonedDateKey(start, zone), startTime: clockIn(start, zone), endDate: zonedDateKey(end, zone), endTime: clockIn(end, zone) };
  }
  function calendarResizePlacement(item, edge, originKey, originMinute, targetKey, targetMinute, zone = "", snapMin = 15) {
    if (!item?.x || !item?.start?.dateTime || !item?.end?.dateTime || isReminder(item) || !["start", "end"].includes(edge)
        || item.x?.src === "note" || item.x?.series || (item.recurrence || []).length) return null;
    return calendarMovePlacement({ start: item[edge] }, originKey, originMinute, targetKey, targetMinute, zone, snapMin);
  }
  function calendarResizeTimedEvent(item, edge, placement, zone = "", snapMin = 15, now = Date.now()) {
    if (!item?.x || !item?.start?.dateTime || !item?.end?.dateTime || isReminder(item) || !["start", "end"].includes(edge)
        || item.x?.src === "note" || item.x?.series || (item.recurrence || []).length || !parseYmd(placement?.date)
        || !Number.isInteger(placement?.minute) || placement.minute < 0 || placement.minute >= 1440 || (zone && !cleanZone(zone))) return null;
    const [start, end] = itemRange(item);
    if (!Number.isFinite(start) || !(end > start)) return null;
    const clock = p2(Math.floor(placement.minute / 60)) + ":" + p2(placement.minute % 60);
    const target = zonedDateTimeToMs(placement.date, clock, zone);
    if (!Number.isFinite(target)) return null;
    const step = cleanCalendarSnap(snapMin) * MIN;
    const newStart = edge === "start" ? Math.min(target, end - step) : start;
    const newEnd = edge === "end" ? Math.max(target, start + step) : end;
    const stamp = typeof now === "function" ? now() : Number(now);
    return cleanItem({ ...item, start: { dateTime: iso(newStart) }, end: { dateTime: iso(newEnd) },
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
    for (const [k, v] of Object.entries(it.x)) if ((v !== "" || k === "categoryOverride") && v !== undefined && v !== null && !(Array.isArray(v) && !v.length)) priv["zentral_" + k] = ["notify", "recurrenceExceptions", "agendaWindow", "categoryOverride", "categoryInNote"].includes(k) ? JSON.stringify(v) : String(v);
    const out = { id: it.id, summary: it.summary, description: it.description, status: it.status, start: it.start, updated: it.updated, extendedProperties: { private: priv } };
    out.end = it.end || it.start;
    if (it.created) out.created = it.created;
    if (it.recurrence.length) out.recurrence = it.recurrence;
    if (it.reminders.overrides.length) out.reminders = { useDefault: false, overrides: it.reminders.overrides };
    return out;
  }
  function fromGoogle(g) {
    if (!g || typeof g !== "object") return null;
    const priv = g.extendedProperties?.private || {};
    const x = {};
    for (const k of ["kind", "noteId", "heading", "category", "tz", "src", "key", "legacyKey", "moved", "calNote", "notify", "agendaWindow", "recurrenceExceptions", "historyId", "categoryOverride", "categoryInNote"]) if (priv["zentral_" + k] !== undefined) {
      if (["notify", "agendaWindow", "recurrenceExceptions", "categoryOverride", "categoryInNote"].includes(k)) { try { x[k] = JSON.parse(priv["zentral_" + k]); } catch (_) {} }
      else x[k] = priv["zentral_" + k];
    }
    const sameEnd = g.end && JSON.stringify(g.end) === JSON.stringify(g.start);
    return cleanItem({ id: g.id, summary: g.summary, description: g.description, status: g.status, start: g.start, end: sameEnd ? undefined : g.end,
      created: g.created, updated: g.updated, recurrence: g.recurrence, reminders: g.reminders, x: { ...x, kind: x.kind || (sameEnd ? "reminder" : "event") } }, 0);
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
  // An explicit per-line category in a Daily Note is an ordinary hidden Markdown
  // comment. An empty value means no category; absence means section inheritance.
  const ITEM_CATEGORY_RE = /%%\s*zn-item-category:([^%\r\n]*)%%/gi;
  function itemCategoryMark(line) {
    const match = [...String(line || "").matchAll(ITEM_CATEGORY_RE)];
    return match.length === 1 ? cleanCategoryName(match[0][1]) : null;
  }
  const stripItemCategoryMarks = (line) => String(line || "").replace(ITEM_CATEGORY_RE, "");
  function parseMarkedLine(line, heading, now, opts) {
    const ignored = ignoredDateTokens(line);
    let sourceLine = stripItemCategoryMarks(stripItemIdMarks(stripDateIgnoreMarks(line)));
    const listText = sourceLine.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s+)?/, "");
    const prefix = parseDatePrefix(listText, now, opts);
    // Ignoring a leading date disables that trigger; a dated heading may still supply its own date.
    if (prefix && ignored.some((raw) => raw === prefix.raw.toLowerCase() || raw.startsWith(prefix.raw.toLowerCase() + " "))) {
      const at = sourceLine.indexOf(prefix.raw);
      if (at >= 0) sourceLine = sourceLine.slice(0, at) + sourceLine.slice(at + prefix.raw.length);
    }
    const dayOfHeading = heading.text ? (parseDatePrefix(heading.text, now, opts)?.day ?? null) : null;
    return { sourceLine, parsed: parseLine(sourceLine, now, dayOfHeading, opts) };
  }
  function visitCalendarListLines(body, now, visit, opts) {
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
      const result = parseMarkedLine(line, heading, now, opts);
      if (result.parsed) visit({ index: i, line, heading, category: sec.category, ...result });
    }
    return lines;
  }
  function ensureNoteItemIds(body, noteId, now = 0, opts) {
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
    }, opts);
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
  const agendaMirrorLineId = (id) => "zm" + hashText(String(id)).padStart(6, "0");
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
    const id = /^[a-z0-9_-]{4,60}$/i.test(String(lineId)) ? String(lineId) : agendaMirrorLineId(item.id);
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
  // The original identity and deterministic generated token together distinguish
  // a mirrored manual item from a user-authored line that later moved dates.
  function isMirroredAgendaItem(item) {
    const x = item?.x || {}, id = String(x.historyId || ""), key = String(x.key || "");
    return x.src === "list" && !!id && !!x.noteId && key === agendaMirrorLineId(id) && item.id === noteLineItemId(x.noteId, key);
  }
  // The reverse of mirroredItem: the reminder a mirrored line stands for, as it was before a note carried its line
  // (same id, same details, no note). null for anything that is not a mirrored reminder.
  function unmirroredItem(item) {
    if (!isMirroredAgendaItem(item)) return null;
    return cleanItem({ ...item, id: item.x.historyId, etag: "", x: { ...item.x, src: "manual", noteId: "", heading: "", key: "", legacyKey: "", historyId: "" } }, 0);
  }
  function removeMirroredAgendaLine(body, item) {
    const text = String(body || "");
    if (!isMirroredAgendaItem(item)) return { body: text, changed: false };
    const ids = text.split("\n").flatMap(itemIdTokens).filter(id => id === item.x.key);
    if (ids.length !== 1) return { body: text, changed: false };
    const hit = findAgendaLine(text, item.x.key);
    if (!hit || itemIdTokens(hit.line).length !== 1) return { body: text, changed: false };
    return removeAgendaLine(text, item.x.key);
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
  // Replace a list item's parsed title only when its exact text is unambiguous;
  // never consume hidden markers or other Markdown if it cannot be located safely.
  function setListLineSummary(body, lineId, summary, now = 0) {
    const text = String(body || ""), lines = text.split("\n");
    let found = false, changed = false, safe = true;
    visitCalendarListLines(text, now, (entry) => {
      if (found || itemIdTokens(entry.line)[0] !== lineId) return;
      found = true;
      const old = entry.parsed.summary, next = String(summary || "").trim();
      if (old === next) return;
      if (!next || /%%|[\r\n]/.test(next) || /%%/.test(old)) { safe = false; return; }
      const pos = entry.line.indexOf(old);
      if (pos < 0 || entry.line.indexOf(old, pos + 1) !== -1) { safe = false; return; }
      const candidate = entry.line.slice(0, pos) + next + entry.line.slice(pos + old.length);
      if (parseMarkedLine(candidate, entry.heading, now).parsed?.summary !== next) { safe = false; return; }
      lines[entry.index] = candidate;
      changed = true;
    });
    return { body: changed ? lines.join("\n") : text, found, changed, safe };
  }
  // Edit only the one owned category comment, leaving line identity and other
  // note content intact. Duplicate markers are ambiguous and must not be changed.
  function setListLineCategory(body, lineId, category, now = 0) {
    const text = String(body || ""), lines = text.split("\n");
    let found = false, changed = false, safe = true;
    visitCalendarListLines(text, now, (entry) => {
      if (found || itemIdTokens(entry.line)[0] !== lineId) return;
      found = true;
      const matches = [...entry.line.matchAll(ITEM_CATEGORY_RE)];
      if (matches.length > 1) { safe = false; return; }
      const mark = category === null ? "" : "%%zn-item-category:" + (cleanCategoryName(category) ? " " + cleanCategoryName(category) : "") + "%%";
      let line = entry.line;
      if (matches.length) {
        const old = matches[0];
        if (mark) line = line.slice(0, old.index) + mark + line.slice(old.index + old[0].length);
        else {
          const pos = old.index > 0 && line[old.index - 1] === " " ? old.index - 1 : old.index;
          line = line.slice(0, pos) + line.slice(old.index + old[0].length);
        }
      } else if (mark) line += " " + mark;
      if (line !== entry.line) { lines[entry.index] = line; changed = true; }
    });
    return { body: changed ? lines.join("\n") : text, changed, found, safe };
  }
  function extractNoteItems(body, noteId, now = 0, opts) {
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
      const result = parseMarkedLine(line, heading, now, opts), sourceLine = result.sourceLine, parsed = result.parsed;
      if (!parsed) continue;
      const norm = sourceLine.replace(/\s+/g, " ").trim().toLowerCase() + "|" + heading.text;
      const n = (seen.get(norm) || 0) + 1; seen.set(norm, n);
      const legacyKey = hashText(noteId + "|" + norm) + (n > 1 ? "-" + n : "");
      const lineId = itemIdTokens(line)[0] || "";
      const key = lineId || legacyKey;
      const lineCategory = itemCategoryMark(line);
      const it = itemFromLine(parsed, { noteId, heading: heading.text, category: lineCategory === null ? sec.category : lineCategory, src: "list", key, legacyKey }, now);
      if (!it) continue;
      it._sectionCategory = cleanCategoryName(sec.category);
      if (lineCategory !== null) { it.x.categoryOverride = lineCategory; it.x.categoryInNote = true; }
      it.id = lineId ? "l" + hashText(noteId) + "-" + lineId : "l" + hashText(noteId) + legacyKey;
      it._legacyKey = legacyKey;
      it._lineId = !!lineId;
      it._parsed = parsed;
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
  // immutable snapshots in their own versioned file; older alerts/snoozes/superseded transitions are
  // compacted into an append-only JSONL archive (ST7.2) without losing lifecycle state or history.
  const REMINDER_HISTORY_FILE = "reminder-history.json";
  const REMINDER_HISTORY_ARCHIVE_FILE = "reminder-history.archive.jsonl";
  const REMINDER_HISTORY_RETENTION_DEFAULT = 30;
  const REMINDER_HISTORY_ACTIONS = Object.freeze(["alerted", "skipped", "done", "dismissed", "reopened", "snoozed", "rescheduled"]);
  function cleanReminderHistoryRetentionDays(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return REMINDER_HISTORY_RETENTION_DEFAULT;
    return Math.max(1, Math.min(3650, Math.floor(n)));
  }
  function compactReminderHistory(rawRecords, nowMs, { retentionDays = REMINDER_HISTORY_RETENTION_DEFAULT } = {}) {
    const list = Array.isArray(rawRecords) ? rawRecords : [];
    const days = cleanReminderHistoryRetentionDays(retentionDays);
    const stamp = Number.isFinite(Number(nowMs)) ? Math.floor(Number(nowMs)) : Date.now();
    const cutoff = stamp - days * 86400000;
    const isTransition = (action) => action === "done" || action === "dismissed" || action === "reopened";
    const keyOf = (record) => String(record.itemId) + "\u0000" + String(record.occurrenceId);
    const latestByOcc = new Map();
    for (let i = 0; i < list.length; i++) {
      const record = list[i];
      if (!record || !isTransition(record.action)) continue;
      const key = keyOf(record), prev = latestByOcc.get(key);
      if (!prev || record.at > prev.record.at || (record.at === prev.record.at && (record.seq > prev.record.seq || (record.seq === prev.record.seq && i > prev.index)))) {
        latestByOcc.set(key, { record, index: i });
      }
    }
    const scheduledStartMs = (record) => {
      if (!record?.start) return NaN;
      if (record.start.dateTime) return Date.parse(record.start.dateTime);
      if (record.start.date) {
        const parsed = parseYmd(record.start.date);
        return parsed ? new Date(parsed.y, parsed.m - 1, parsed.d).getTime() : NaN;
      }
      return NaN;
    };
    const kept = [], archived = [];
    for (let i = 0; i < list.length; i++) {
      const record = list[i];
      if (!record) continue;
      if (isTransition(record.action) && latestByOcc.get(keyOf(record))?.record === record) {
        kept.push(record);
        continue;
      }
      if (record.at >= cutoff) {
        kept.push(record);
        continue;
      }
      if (record.action === "alerted" || record.action === "skipped") {
        const startMs = scheduledStartMs(record);
        if (Number.isFinite(startMs) && startMs >= cutoff) {
          kept.push(record);
          continue;
        }
      }
      archived.push(record);
    }
    return { kept, archived, cutoff, retentionDays: days };
  }
  function formatHistoryArchiveLines(records) {
    if (!Array.isArray(records) || !records.length) return "";
    return records.map((record) => JSON.stringify({ ...record, start: record.start ? { ...record.start } : null })).join("\n") + "\n";
  }
  function parseHistoryArchiveLines(text) {
    const records = [], ids = new Set();
    let malformed = 0;
    for (const rawLine of String(text || "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        const clean = cleanReminderHistoryRecord(parsed, parsed?.at || 0);
        if (!clean) { malformed++; continue; }
        if (!ids.has(clean.id)) {
          ids.add(clean.id);
          records.push(clean);
        }
      } catch (_) { malformed++; }
    }
    return { records, ids, malformed };
  }
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
      ...(raw.coalesced === true ? { coalesced: true } : {}),
    };
  }
  const REMINDER_STACK_LIMIT = 3;
  // Display and cross-window retirement rules for occurrence-scoped reminder cards.
  function reminderAlertPresentation(stage, alertSettings = null, lang = DEFAULT_NOTES_LANGUAGE) {
    const value = ["pre", "due", "followup"].includes(stage) ? stage : "followup";
    const defaultLayout = value === "pre" ? "corner" : value === "due" ? "large" : "centred";
    const configured = alertSettings ? cleanAlertSettings(alertSettings).stages[value]?.layout : "";
    const layout = cleanAlertLayout(configured, defaultLayout);
    return {
      stage: value,
      rank: value === "pre" ? 1 : value === "due" ? 2 : 3,
      label: t("alert.stage." + value, null, lang),
      layout,
      overlay: layout === "centred",
      persistent: value !== "pre" || layout !== "corner",
    };
  }
  function orderOverlayAlertActions(actions) {
    if (!Array.isArray(actions)) return [];
    const bucket = (id) => {
      const k = String(id || "");
      if (k === "done") return 0;
      if (k.startsWith("snooze")) return 1;
      if (k === "open") return 2;
      if (k === "dismiss") return 3;
      return 4;
    };
    return actions
      .map((action, index) => ({ action, index, order: bucket(action?.id) }))
      .sort((a, b) => (a.order - b.order) || (a.index - b.index))
      .map((entry) => entry.action);
  }
  function reminderStackMoreLabel(hiddenCount, expanded = false, lang = DEFAULT_NOTES_LANGUAGE) {
    if (expanded === true) return t("alert.stack.showFewer", null, lang);
    const count = Math.trunc(Number(hiddenCount));
    return count > 0 ? t("alert.stack.more", { count }, lang) : "";
  }
  function reminderSnoozeTomorrowMinutes(at, zone = "") {
    const stamp = Number(at);
    if (!Number.isFinite(stamp)) return 0;
    const validZone = cleanZone(zone);
    let target = NaN;
    if (validZone) {
      const baseKey = zonedDateKey(stamp, validZone);
      const baseClock = clockIn(stamp, validZone);
      const baseDay = parseYmd(baseKey);
      if (baseDay && baseClock) {
        const nextKey = ymd(new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate() + 1));
        const zoned = zonedDateTimeToMs(nextKey, baseClock, validZone);
        if (Number.isFinite(zoned)) target = zoned;
      }
    }
    if (!Number.isFinite(target)) {
      const date = new Date(stamp);
      date.setDate(date.getDate() + 1);
      target = date.getTime();
    }
    const minutes = Math.round((target - stamp) / 60000);
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
  // A registry can be shared by independently loaded browser-window modules.
  // Gates are removed after the final waiter, so it retains no idle windows.
  // `waitMs` (with the caller's timers) limits how long a turn waits for the one before it: a window that was closed in
  // the middle of its turn never finishes it, and without a limit every later turn for that key would wait for ever.
  // After the limit the turn runs on its own (what every turn did before the registry was shared) and `onTimeout(key)`
  // is told once. 0 = no limit. One call can name its own limit (third argument `{ waitMs }`): reading a whole folder
  // takes longer than one save.
  // A turn whose window was closed is never finished: the browser stops running the promise steps of a closed window,
  // so its gate stays pending for ever (the gate itself can still be touched; browser windows and system modules share
  // one compartment, nothing turns into a dead object). `isAlive` is how the others find out: the owner's own answer
  // travels on the gate, and a gate whose owner says "gone" counts as released at once. A turn that is already waiting
  // asks once a second, so a window closed in the middle of a long turn costs the others a second, not the whole limit.
  // A gate that cannot even be touched (a dead object after all) is treated the same way and never fails the waiter.
  const localHistoryLocks = new Map();
  const HISTORY_GATE_PROBE_MS = 1000;
  const HISTORY_GATE_OWNER = "zentralTurnOwnerAlive";
  const historyGateGone = (gate) => {
    try {
      const alive = gate[HISTORY_GATE_OWNER];
      return typeof alive === "function" ? alive() === false : (void gate.then, false);
    } catch (_) { return true; }
  };
  function createHistoryCoordinator(registry = localHistoryLocks, { waitMs = 0, setTimer = null, clearTimer = null, onTimeout = null, isAlive = null } = {}) {
    const timed = typeof setTimer === "function";
    const waitFor = (previous, key, limit) => {
      if (historyGateGone(previous)) return undefined;
      if (!timed) return previous;
      return new Promise((resolve) => {
        let timer = null, probe = null, over = false;
        const end = (late) => {
          if (over) return;
          over = true;
          for (const id of [timer, probe]) if (id !== null) { try { clearTimer?.(id); } catch (_) {} }
          timer = probe = null;
          if (late) { try { onTimeout?.(key); } catch (_) {} }
          resolve();
        };
        try { Promise.resolve(previous).then(() => end(false), () => end(false)); } catch (_) { return end(false); }
        if (limit > 0) timer = setTimer(() => { timer = null; end(true); }, limit);
        if (limit > 0 && limit <= HISTORY_GATE_PROBE_MS) return;
        const look = () => {
          probe = null;
          if (over) return;
          if (historyGateGone(previous)) end(false);
          else probe = setTimer(look, HISTORY_GATE_PROBE_MS);
        };
        probe = setTimer(look, HISTORY_GATE_PROBE_MS);
      });
    };
    return async (key, work, { waitMs: ownWaitMs } = {}) => {
      const previous = registry.get(key);
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      if (typeof isAlive === "function") { try { Object.defineProperty(gate, HISTORY_GATE_OWNER, { value: isAlive }); } catch (_) {} }
      registry.set(key, gate);
      try {
        // A throw here means the gate could not even be looked at: the same as released.
        if (previous) { try { await waitFor(previous, key, Number.isFinite(ownWaitMs) && ownWaitMs >= 0 ? ownWaitMs : waitMs); } catch (_) {} }
        return await work();
      } finally {
        try { if (registry.get(key) === gate) registry.delete(key); } catch (_) {}
        release();
      }
    };
  }
  function createReminderHistoryStore({ io, getDir, now = () => Date.now(), setTimer, clearTimer, warn = () => {}, delayMs = 400, onWrite = () => {}, perf = null, withHistoryLock = createHistoryCoordinator(), getRetentionDays = () => REMINDER_HISTORY_RETENTION_DEFAULT }) {
    const records = [], unsaved = new Set();
    const listeners = new Set();
    const emit = (event) => { for (const fn of [...listeners]) { try { fn(event); } catch (error) { safeWarn(error); } } };
    const lifecycle = new Map();
    let nextSeq = 1;
    let dirty = false, timer = null, chain = Promise.resolve(), writeBlocked = false, retryCount = 0;
    let lastDiskText = null;
    const transitionAction = (action) => ["done", "dismissed", "reopened"].includes(action);
    const lifecycleKey = (itemId, occurrenceId) => String(itemId) + "\u0000" + String(occurrenceId);
    const indexTransition = (record) => {
      if (!transitionAction(record.action)) return;
      const key = lifecycleKey(record.itemId, record.occurrenceId), old = lifecycle.get(key);
      if (!old || record.at > old.at || (record.at === old.at && record.seq > old.seq)) lifecycle.set(key, record);
    };
    // These indexes contain references to immutable internal records; public
    // list() still returns defensive copies in the original sort order.
    const byIdentity = new Map(), claimedStages = new Set();
    const identityIndexKey = (itemId, occurrenceId) => JSON.stringify([itemId, occurrenceId]);
    const alertIndexKey = (itemId, occurrenceId, stage, start) => JSON.stringify([itemId, occurrenceId, stage, start?.date || "", start?.dateTime || ""]);
    const indexRecord = (record) => {
      indexTransition(record);
      const key = identityIndexKey(record.itemId, record.occurrenceId);
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(record);
      if (["alerted", "skipped"].includes(record.action)) {
        claimedStages.add(alertIndexKey(record.itemId, record.occurrenceId, record.stage, record.start));
        if (!record.stage) claimedStages.add(alertIndexKey(record.itemId, record.occurrenceId, "due", record.start));
      }
    };
    const clearIndexes = () => { lifecycle.clear(); byIdentity.clear(); claimedStages.clear(); };
    // A claim must not suppress its own retry if the write failed. Only discard
    // records still known to be unsaved; never undo another lifecycle action.
    function rollbackClaims(claims) {
      const removed = [];
      for (let i = records.length - 1; i >= 0; i--) {
        const record = records[i];
        if (!claims.has(record) || !unsaved.has(record)) continue;
        unsaved.delete(record); records.splice(i, 1); removed.push(record);
      }
      if (!removed.length) return;
      clearIndexes(); for (const record of records) indexRecord(record);
      dirty = unsaved.size > 0;
      if (!dirty && timer !== null) { clearTimer(timer); timer = null; }
      emit({ kind: "refresh", count: removed.length, identities: removed.map(({ itemId, occurrenceId }) => ({ itemId, occurrenceId })) });
    }
    let storage = { state: "unopened", error: "", backupPath: "", archivePath: "", archivedCount: 0 }, protectedText = null;
    const safeWarn = (error) => { try { warn(error); } catch (_) {} };
    const state = () => ({ ...storage, dirty: dirty || unsaved.size > 0, writeBlocked, retryCount, count: records.length });
    const retentionDaysNow = () => {
      try { return cleanReminderHistoryRetentionDays(typeof getRetentionDays === "function" ? getRetentionDays() : REMINDER_HISTORY_RETENTION_DEFAULT); }
      catch (_) { return REMINDER_HISTORY_RETENTION_DEFAULT; }
    };
    const isMissingError = (error) => {
      const message = String(error?.message || error || "");
      return error?.code === "ENOENT" || error?.name === "NotFoundError" || /(?:^|\b)(?:nf|not found|no such file|does not exist|NS_ERROR_FILE_NOT_FOUND)(?:\b|$)/i.test(message);
    };
    // Crash-safe compaction: append archived records to JSONL archive FIRST,
    // verify the main file has not changed concurrently, and ONLY THEN shrink
    // reminder-history.json. Any failure aborts cleanly with zero data loss.
    async function writeCompactedHistory(dir, file, expectedDiskText, kept, archived) {
      if (!archived.length) return { ok: false, archivedCount: 0, text: expectedDiskText, archivePath: "" };
      const archivePath = io.join(dir, REMINDER_HISTORY_ARCHIVE_FILE);
      let existingArchive = "";
      try { existingArchive = await io.readUTF8(archivePath); }
      catch (error) {
        let missing = isMissingError(error);
        if (!missing && typeof io.exists === "function") { try { missing = !(await io.exists(archivePath)); } catch (_) {} }
        if (!missing) throw error;
      }
      const existingIds = existingArchive ? parseHistoryArchiveLines(existingArchive).ids : new Set();
      const freshArchive = archived.filter((record) => record && !existingIds.has(record.id));
      if (freshArchive.length) {
        const prefix = existingArchive && !existingArchive.endsWith("\n") ? existingArchive + "\n" : existingArchive;
        const nextArchiveText = prefix + formatHistoryArchiveLines(freshArchive);
        await io.writeUTF8(archivePath, nextArchiveText, { tmpPath: archivePath + ".tmp" });
      }
      // TOCTOU guard: abort without overwriting if another window updated the main file.
      if (expectedDiskText !== null) {
        const currentDisk = await io.readUTF8(file);
        if (currentDisk !== expectedDiskText) {
          return { ok: false, conflict: true, archivedCount: 0, text: currentDisk, archivePath };
        }
      }
      const compactedText = JSON.stringify({ v: 1, records: kept.map((record) => ({ ...record, start: record.start ? { ...record.start } : null })) });
      perf?.recordBytes?.("history.bytes", compactedText);
      await io.writeUTF8(file, compactedText, { tmpPath: file + ".tmp" });
      return { ok: true, archivedCount: archived.length, text: compactedText, archivePath };
    }
    const scheduleTimer = (ms = delayMs) => {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => { timer = null; writeNow().catch(() => {}); }, ms);
    };
    const schedule = () => { dirty = true; if (!writeBlocked) scheduleTimer(); };
    async function backupHistory(dir, text) {
      const file = io.join(dir, REMINDER_HISTORY_FILE), stamp = Math.max(0, Math.floor(Number(now()) || Date.now()));
      const base = file + ".corrupt-" + stamp + ".bak";
      let path = base, suffix = 1;
      if (typeof io.exists === "function") while (await io.exists(path)) path = base.replace(/\.bak$/, "-" + (++suffix) + ".bak");
      else path = base.replace(/\.bak$/, "-" + Math.random().toString(36).slice(2) + ".bak");
      await io.writeUTF8(path, String(text), { tmpPath: path + ".tmp" });
      return path;
    }
    function badHistory(message, text = null) {
      const error = new Error(message); error.historyReadFailure = true; error.historyText = text; return error;
    }
    function decodeHistoryRecords(rawRecords) {
      const chosen = new Map(), rejected = [];
      for (let index = 0; index < rawRecords.length; index++) {
        const raw = rawRecords[index], record = cleanReminderHistoryRecord(raw, now());
        if (!record) { rejected.push({ reason: "invalid", record: raw }); continue; }
        if (!record.seq) record.seq = index + 1;
        const old = chosen.get(record.id);
        if (!old) { chosen.set(record.id, { record, raw, index }); continue; }
        const newer = record.at > old.record.at || (record.at === old.record.at && (record.seq > old.record.seq || (record.seq === old.record.seq && index > old.index)));
        if (newer) { rejected.push({ reason: "duplicate", record: old.raw }); chosen.set(record.id, { record, raw, index }); }
        else rejected.push({ reason: "duplicate", record: raw });
      }
      return { clean: [...chosen.values()].sort((a, b) => a.index - b.index).map((entry) => entry.record), rejected };
    }
    async function preserveRejected(dir, file, text, rejected) {
      const backupPath = await backupHistory(dir, text), base = io.join(dir, "reminder-history.rejected.json");
      let rejectedPath = base;
      if (typeof io.exists === "function") { let suffix = 1; while (await io.exists(rejectedPath)) rejectedPath = base.replace(/\.json$/, "-" + (++suffix) + ".json"); }
      else rejectedPath = base.replace(/\.json$/, "-" + Math.random().toString(36).slice(2) + ".json");
      await io.writeUTF8(rejectedPath, JSON.stringify({ v: 1, records: rejected }), { tmpPath: rejectedPath + ".tmp" });
      if (await io.readUTF8(file) !== text) throw new Error("Reminder history changed during recovery; reopen it before trying again.");
      return { backupPath, rejectedPath };
    }
    // A write must not overwrite an unreadable or damaged file discovered since
    // open. Background refresh remains best-effort; only the write path is strict.
    async function mergeStored(dir, strict = false) {
      const file = io.join(dir, REMINDER_HISTORY_FILE);
      let text;
      try { text = await io.readUTF8(file); }
      catch (error) {
        const message = String(error?.message || error || "");
        let missing = error?.code === "ENOENT" || error?.name === "NotFoundError" || /(?:^|\b)(?:nf|not found|no such file|does not exist|NS_ERROR_FILE_NOT_FOUND)(?:\b|$)/i.test(message);
        if (!missing && typeof io.exists === "function") { try { missing = !(await io.exists(file)); } catch (_) {} }
        if (missing || !strict) return 0;
        throw badHistory(message);
      }
      if (lastDiskText !== null && text === lastDiskText) return 0;
      let parsed;
      try { parsed = JSON.parse(text); } catch (error) { if (strict) throw badHistory(String(error?.message || error), String(text)); return 0; }
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.records)) {
        if (strict) throw badHistory("Reminder history has an unsupported or damaged structure.", String(text));
        return 0;
      }
      const { clean, rejected } = decodeHistoryRecords(parsed.records);
      if (strict && rejected.length) {
        try {
          const paths = await preserveRejected(dir, file, String(text), rejected);
          storage = { ...storage, ...paths };
        } catch (error) { throw badHistory(String(error?.message || error), String(text)); }
      }
      if (!rejected.length) lastDiskText = text;
      const known = new Set(records.map((record) => record.id));
      let added = 0;
      const changed = new Map();
      for (const record of clean) {
        if (!record || known.has(record.id)) continue;
        known.add(record.id); record.seq = nextSeq++; records.push(record); indexRecord(record); added++;
        changed.set(identityIndexKey(record.itemId, record.occurrenceId), { itemId: record.itemId, occurrenceId: record.occurrenceId });
      }
      if (added) emit({ kind: "refresh", count: added, identities: [...changed.values()] });
      return added;
    }
    function queueHistory(dir, work) {
      const task = chain.catch(() => {}).then(() => withHistoryLock(io.join(dir, REMINDER_HISTORY_FILE), work));
      chain = task;
      return task;
    }
    async function persistHistory(dir) {
      try {
        if (writeBlocked) throw new Error("Reminder history is protected because its existing file could not be read safely.");
        await mergeStored(dir, true);
        const includedUnsaved = [...unsaved];
        const text = JSON.stringify({ v: 1, records: records.map((record) => ({ ...record, start: record.start ? { ...record.start } : null })) });
        perf?.recordBytes?.("history.bytes", text);
        await io.writeUTF8(io.join(dir, REMINDER_HISTORY_FILE), text, { tmpPath: io.join(dir, REMINDER_HISTORY_FILE + ".tmp") });
        lastDiskText = text;
        for (const record of includedUnsaved) unsaved.delete(record);
        dirty = unsaved.size > 0;
        try { onWrite(dir); } catch (error) { safeWarn(error); }
        retryCount = 0;
        if (["unopened", "missing", "recovery-pending"].includes(storage.state)) storage = { ...storage, state: "ready", error: "" };
        if (dirty && timer === null && !writeBlocked) scheduleTimer();
        return true;
      } catch (error) {
        dirty = true; retryCount++; safeWarn(error);
        if (error?.historyReadFailure) {
          let backupPath = "";
          if (error.historyText !== null) { try { backupPath = await backupHistory(dir, error.historyText); } catch (backupError) { safeWarn(backupError); } }
          protectedText = backupPath ? error.historyText : null;
          writeBlocked = true;
          storage = { state: error.historyText === null ? "unreadable" : "corrupt", error: String(error.message || error), backupPath };
          emit({ kind: "protected" });
        }
        if (retryCount <= 3 && timer === null && !writeBlocked) scheduleTimer(Math.min(delayMs * Math.pow(2, retryCount), 5000));
        throw error;
      }
    }
    function writeNow() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      const dir = getDir();
      if (!dirty || !dir) return chain;
      if (writeBlocked) return Promise.reject(new Error("Reminder history is protected because its existing file could not be read safely."));
      dirty = false;
      return queueHistory(dir, () => persistHistory(dir));
    }
    if (perf?.wrapAsync) persistHistory = perf.wrapAsync("history.write", persistHistory);
    return {
      async open() {
        // Opening a second time must not discard pending local transitions.
        if (unsaved.size) return state();
        const dir = getDir();
        if (!dir) return state();
        return queueHistory(dir, async () => {
          if (unsaved.size) return state();
          const file = io.join(dir, REMINDER_HISTORY_FILE);
          let text;
          try { text = await io.readUTF8(file); }
          catch (error) {
            const message = String(error?.message || error || "");
            const missing = error?.code === "ENOENT" || error?.name === "NotFoundError" || /(?:^|\b)(?:nf|not found|no such file|does not exist|NS_ERROR_FILE_NOT_FOUND)(?:\b|$)/i.test(message);
            let exists = !missing;
            if (typeof io.exists === "function") { try { exists = await io.exists(file); } catch (_) { exists = true; } }
            if (!exists || missing) {
              if (unsaved.size) return state();
              records.length = 0; clearIndexes(); nextSeq = 1; dirty = false; writeBlocked = false; retryCount = 0;
              storage = { state: "missing", error: "", backupPath: "" };
            } else {
              writeBlocked = true; storage = { state: "unreadable", error: String(error?.message || error), backupPath: "" }; safeWarn(error);
            }
            return state();
          }
          let parsed, backupPath = "", rejectedPath = "", archivePath = "", archivedCount = 0, diskText = String(text);
          let loaded = null;
          try {
            parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.v !== 1 || !Array.isArray(parsed.records)) throw new Error("Reminder history has an unsupported or damaged structure.");
            const { clean, rejected } = decodeHistoryRecords(parsed.records);
            if (rejected.length) {
              // Save both the original and every rejected raw record before replacing anything.
              ({ backupPath, rejectedPath } = await preserveRejected(dir, file, String(text), rejected));
              diskText = JSON.stringify({ v: 1, records: clean });
              await io.writeUTF8(file, diskText, { tmpPath: file + ".tmp" });
            }
            if (unsaved.size) return state();
            loaded = clean;
            // ST7.2: compact aged alerts/snoozes/superseded transitions into JSONL archive
            // while keeping the latest transition per occurrence and recent records.
            const { kept, archived } = compactReminderHistory(clean, now(), { retentionDays: retentionDaysNow() });
            if (archived.length) {
              try {
                const res = await writeCompactedHistory(dir, file, diskText, kept, archived);
                if (res.ok) {
                  loaded = kept;
                  diskText = res.text;
                  archivePath = res.archivePath;
                  archivedCount = res.archivedCount;
                }
              } catch (compactError) { safeWarn(compactError); }
            }
            if (unsaved.size) return state();
            records.splice(0, records.length, ...loaded); clearIndexes();
            for (const record of records) indexRecord(record);
            nextSeq = records.reduce((max, record) => Math.max(max, record.seq), 0) + 1;
            lastDiskText = diskText;
          } catch (error) {
            if (!backupPath) { try { backupPath = await backupHistory(dir, text); } catch (backupError) { safeWarn(backupError); } }
            protectedText = backupPath ? String(text) : null;
            lastDiskText = null;
            writeBlocked = true; storage = { state: "corrupt", error: String(error?.message || error), backupPath, rejectedPath, archivePath, archivedCount }; safeWarn(error);
            return state();
          }
          dirty = false; writeBlocked = false; retryCount = 0; protectedText = null;
          storage = { state: "ready", error: "", backupPath, rejectedPath, archivePath, archivedCount };
          if (rejectedPath) { try { onWrite(dir); } catch (error) { safeWarn(error); } emit({ kind: "recovery", count: records.length }); }
          if (archivedCount > 0) { try { onWrite(dir); } catch (error) { safeWarn(error); } emit({ kind: "compact", archived: archivedCount, kept: records.length, archivePath }); }
          return state();
        });
      },
      async startFresh() {
        const dir = getDir();
        if (!dir || !writeBlocked || storage.state !== "corrupt" || !storage.backupPath || protectedText === null) return false;
        return queueHistory(dir, async () => {
          if (!writeBlocked || storage.state !== "corrupt" || !storage.backupPath || protectedText === null) return false;
          const file = io.join(dir, REMINDER_HISTORY_FILE);
          try {
            if (await io.readUTF8(file) !== protectedText) throw new Error("Reminder history changed since it was backed up; reopen before recovering.");
            const freshText = JSON.stringify({ v: 1, records });
            await io.writeUTF8(file, freshText, { tmpPath: file + ".tmp" });
            lastDiskText = freshText;
            unsaved.clear(); dirty = false; writeBlocked = false; retryCount = 0; protectedText = null;
            storage = { ...storage, state: "ready", error: "" };
            try { onWrite(dir); } catch (error) { safeWarn(error); }
            emit({ kind: "recovery", count: 0 });
            return true;
          } catch (error) { storage = { ...storage, error: String(error?.message || error) }; safeWarn(error); return false; }
        });
      },
      storageState: state,
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      append(raw) {
        if (writeBlocked) return null;
        const record = cleanReminderHistoryRecord({ ...raw, seq: nextSeq, at: raw?.at ?? now() }, now());
        if (!record) return null;
        nextSeq = Math.max(nextSeq + 1, record.seq + 1);
        // Immutable append: duplicate records are allowed because repeated transitions are meaningful.
        records.push(record); unsaved.add(record); indexRecord(record); schedule();
        emit({ kind: "append", action: record.action, itemId: record.itemId, occurrenceId: record.occurrenceId });
        return { ...record, start: record.start ? { ...record.start } : null };
      },
      // Merge records another window wrote since we last read the file (matched by record id; nothing is dropped or
      // rewritten). Best effort: a missing or damaged file changes nothing here, `open()` owns recovery.
      async refresh() {
        const dir = getDir();
        if (!dir || writeBlocked) return 0;
        return mergeStored(dir);
      },
      cancelTimers() {
        if (timer !== null) { clearTimer(timer); timer = null; }
      },
      unloadSnapshot() {
        if (writeBlocked || !unsaved.size || !getDir()) return null;
        return {
          records: [...unsaved].map((record) => ({ ...record, start: record.start ? { ...record.start } : null })),
        };
      },
      async reconcileRecoveryEntry(entry) {
        const dir = getDir();
        if (!dir || !entry || !Array.isArray(entry.records) || !entry.records.length) return { ok: true, changed: false };
        return queueHistory(dir, async () => {
          const file = io.join(dir, REMINDER_HISTORY_FILE);
          let existing = [];
          try {
            const text = await io.readUTF8(file);
            let raw;
            try { raw = JSON.parse(text); } catch (error) { return { ok: false, backedUp: false, error }; }
            if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.records)) return { ok: false, backedUp: false };
            existing = decodeHistoryRecords(raw.records).clean;
          } catch (error) {
            const message = String(error?.message || error || "");
            let missing = error?.code === "ENOENT" || error?.name === "NotFoundError" || /(?:^|\b)(?:nf|not found|no such file|does not exist|NS_ERROR_FILE_NOT_FOUND)(?:\b|$)/i.test(message);
            if (!missing && typeof io.exists === "function") { try { missing = !(await io.exists(file)); } catch (_) {} }
            if (!missing) return { ok: false, backedUp: false, error };
          }
          const incoming = decodeHistoryRecords(entry.records).clean;
          if (!incoming.length) return { ok: true, changed: false };
          const known = new Set(existing.map((record) => record.id));
          let changed = false;
          for (const record of incoming) {
            if (known.has(record.id)) continue;
            known.add(record.id);
            existing.push(record);
            changed = true;
          }
          if (!changed) return { ok: true, changed: false };
          const text = JSON.stringify({ v: 1, records: existing.map((record) => ({ ...record, start: record.start ? { ...record.start } : null })) });
          await io.writeUTF8(file, text, { tmpPath: file + ".tmp" });
          lastDiskText = null;
          return { ok: true, changed: true };
        });
      },
      async compact({ retentionDays } = {}) {
        const dir = getDir();
        if (writeBlocked || !dir) return { ok: false, archived: 0, kept: records.length, archivePath: "" };
        if (dirty || unsaved.size) {
          try { await writeNow(); } catch (_) { return { ok: false, archived: 0, kept: records.length, archivePath: "" }; }
        }
        return queueHistory(dir, async () => {
          if (writeBlocked || unsaved.size) return { ok: false, archived: 0, kept: records.length, archivePath: "" };
          try { await mergeStored(dir, true); } catch (error) { safeWarn(error); return { ok: false, archived: 0, kept: records.length, archivePath: "" }; }
          const days = retentionDays === undefined ? retentionDaysNow() : cleanReminderHistoryRetentionDays(retentionDays);
          const { kept, archived } = compactReminderHistory(records, now(), { retentionDays: days });
          if (!archived.length) return { ok: true, archived: 0, kept: records.length, archivePath: storage.archivePath || "" };
          const file = io.join(dir, REMINDER_HISTORY_FILE);
          let expectedDiskText = null;
          try { expectedDiskText = await io.readUTF8(file); } catch (_) { expectedDiskText = null; }
          try {
            const res = await writeCompactedHistory(dir, file, expectedDiskText, kept, archived);
            if (!res.ok) return { ok: false, archived: 0, kept: records.length, archivePath: res.archivePath || "" };
            records.splice(0, records.length, ...kept); clearIndexes();
            for (const record of records) indexRecord(record);
            nextSeq = Math.max(nextSeq, records.reduce((max, record) => Math.max(max, record.seq), 0) + 1);
            lastDiskText = res.text;
            storage = { ...storage, archivePath: res.archivePath, archivedCount: (storage.archivedCount || 0) + res.archivedCount };
            try { onWrite(dir); } catch (error) { safeWarn(error); }
            emit({ kind: "compact", archived: res.archivedCount, kept: records.length, archivePath: res.archivePath });
            return { ok: true, archived: res.archivedCount, kept: records.length, archivePath: res.archivePath };
          } catch (error) { safeWarn(error); return { ok: false, archived: 0, kept: records.length, archivePath: "" }; }
        });
      },
      // Check and persist while holding the same per-file lock as ordinary writes.
      async claimAlert(raw) {
        const dir = getDir();
        if (writeBlocked || !dir) return null;
        return queueHistory(dir, async () => {
          if (writeBlocked) return null;
          try { await mergeStored(dir); } catch (error) { safeWarn(error); }
          if (raw.requirePending && ["done", "dismissed"].includes(this.stateFor(raw.itemId, raw.occurrenceId))) return null;
          const requestedStage = ["pre", "due", "followup"].includes(raw.stage) ? raw.stage : "";
          const duplicate = claimedStages.has(alertIndexKey(raw.itemId, raw.occurrenceId, requestedStage, raw.start));
          if (duplicate) return null;
          const record = this.append({ ...raw, action: raw.action === "skipped" ? "skipped" : "alerted" });
          if (!record) return null;
          const claim = records[records.length - 1];
          if (timer !== null) { clearTimer(timer); timer = null; }
          dirty = false;
          try { await persistHistory(dir); }
          catch (error) { rollbackClaims(new Set([claim])); safeWarn(error); return null; }
          return record;
        });
      },
      // Digest claims use one merge and one durable write for the whole batch.
      // Each group starts with its highest stage: if another window claimed it,
      // none of that group's lower stages may become a new visible digest entry.
      async claimAlertGroups(groups) {
        const dir = getDir();
        if (writeBlocked || !dir || !Array.isArray(groups)) return [];
        return queueHistory(dir, async () => {
          if (writeBlocked) return [];
          try { await mergeStored(dir); } catch (error) { safeWarn(error); }
          if (writeBlocked) return [];
          const claimed = [], claimRecords = new Set();
          for (let index = 0; index < groups.length; index++) {
            const group = groups[index], top = Array.isArray(group) && group[0];
            if (!top || (top.requirePending && ["done", "dismissed"].includes(this.stateFor(top.itemId, top.occurrenceId)))) continue;
            const already = (raw) => claimedStages.has(alertIndexKey(raw.itemId, raw.occurrenceId, ["pre", "due", "followup"].includes(raw.stage) ? raw.stage : "", raw.start));
            if (already(top)) continue;
            const record = this.append({ ...top, action: "alerted" });
            if (!record) continue;
            claimed.push(index); claimRecords.add(records[records.length - 1]);
            for (const raw of group.slice(1)) if (raw && !already(raw)) {
              const lower = this.append({ ...raw, action: "alerted" });
              if (lower) claimRecords.add(records[records.length - 1]);
            }
          }
          if (claimed.length) {
            if (timer !== null) { clearTimer(timer); timer = null; }
            dirty = false;
            try { await persistHistory(dir); }
            catch (error) { rollbackClaims(claimRecords); safeWarn(error); return []; }
          }
          return claimed;
        });
      },
      list({ itemId = "", occurrenceId = "", noteId = "", limit = 0, offset = 0 } = {}) {
        const candidates = itemId && occurrenceId ? (byIdentity.get(identityIndexKey(itemId, occurrenceId)) || []) : records;
        let out = candidates.filter((record) => (!itemId || record.itemId === itemId) && (!occurrenceId || record.occurrenceId === occurrenceId) && (!noteId || record.noteId === noteId));
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

  // `beforeWrite` (optional, async) runs before every calendar write, outside the calendar lock. The note store uses it to
  // put pending note text on disk first, so `calendar.json` never refers to a note line that was not saved (UI4.7).
  function createItemStore({ io, getDir, now = () => Date.now(), setTimer, clearTimer, warn = () => {}, delayMs = 600, onHistoryWrite = () => {}, onItemsWrite = () => {}, perf = null, withHistoryLock, isNoteVisible = null, beforeWrite = null, noteFileState = null, getParseOptions = () => ({}), getHistoryRetentionDays = () => REMINDER_HISTORY_RETENTION_DEFAULT }) {
    const items = new Map();
    const history = createReminderHistoryStore({ io, getDir, now, setTimer, clearTimer, warn, delayMs, onWrite: onHistoryWrite, perf, withHistoryLock, getRetentionDays: getHistoryRetentionDays });
    const categoryDefs = new Map();
    const hidden = new Set(); // noteIds whose items stay stored but are not shown (note in Trash, or its file is missing)
    const listeners = new Set();
    let dirty = false, timer = null, chain = Promise.resolve(), retryCount = 0, pendingWrites = 0;
    let storage = { state: "unopened", error: "", backupPath: "" }, writeBlocked = false, protectedText = null;
    let baseline = { items: [], categories: [] };
    let heldBack = false; // the last write left out records whose note text was not in its file
    const withCalendarLock = withHistoryLock || createHistoryCoordinator();
    const shown = (it) => !it.x.noteId || (!hidden.has(it.x.noteId) && (!isNoteVisible || isNoteVisible(it.x.noteId)));
    const safeWarn = (error) => { try { warn(error); } catch (_) {} };
    const emit = (kind, id, detail) => { for (const fn of [...listeners]) { try { fn(kind, id, detail); } catch (e) { safeWarn(e); } } };
    const state = () => ({ ...storage, dirty, writeBlocked, retryCount });
    const scheduleTimer = (ms = delayMs) => {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => { timer = null; writeNow().catch(() => {}); }, ms);
    };
    const schedule = () => { dirty = true; if (!writeBlocked) scheduleTimer(delayMs); };
    const snapshot = () => JSON.parse(JSON.stringify({ items: [...items.values()], categories: [...categoryDefs.values()] }));
    const equalRecord = (a, b) => calendarRecordEqual(a ?? null, b ?? null);
    function parseCalendarSnapshot(text) {
      const raw = JSON.parse(text);
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.items) || (raw.categories !== undefined && !Array.isArray(raw.categories)))
        throw new Error("Calendar file has an unsupported or damaged structure.");
      const parsed = { items: raw.items.map((item) => cleanItem(item, 0)), categories: (raw.categories || []).map(cleanCategory) };
      if (parsed.items.some((item) => !item) || parsed.categories.some((category) => !category)) throw new Error("Calendar file contains an invalid item or category record.");
      // Reject duplicate keys rather than silently discarding an unrelated record.
      mergeCalendarSnapshots(parsed, parsed, parsed);
      return parsed;
    }
    async function backupCalendar(dir, label, text) {
      const base = io.join(dir, "calendar." + label + "-" + Math.max(0, Math.floor(Number(now()) || Date.now())));
      let path = base + ".bak", suffix = 1;
      if (typeof io.exists === "function") while (await io.exists(path)) path = base + "-" + (++suffix) + ".bak";
      else path = base + "-" + Math.random().toString(36).slice(2) + ".bak";
      await io.writeUTF8(path, text, { tmpPath: path + ".tmp" });
      return path;
    }
    async function backupLocalCalendar(dir, captured, remote = null) {
      try { return await backupCalendar(dir, "conflict", JSON.stringify({ v: 1, base: baseline, local: captured, remote })); }
      catch (error) { safeWarn(error); return ""; }
    }
    async function readCalendarForWrite(dir, captured) {
      const file = io.join(dir, ITEMS_FILE); let text;
      try { text = await io.readUTF8(file); }
      catch (error) {
        const message = String(error?.message || error || "");
        let missing = error?.code === "ENOENT" || error?.name === "NotFoundError" || /(?:^|\b)(?:nf|not found|no such file|does not exist|NS_ERROR_FILE_NOT_FOUND)(?:\b|$)/i.test(message);
        if (!missing && typeof io.exists === "function") { try { missing = !(await io.exists(file)); } catch (_) {} }
        if (missing && !baseline.items.length && !baseline.categories.length && storage.state !== "recovery-pending") return { items: [], categories: [] };
        if (missing) {
          const backupPath = await backupLocalCalendar(dir, captured);
          writeBlocked = true; storage = { state: "conflict", error: "Calendar file was removed while this window had edits.", backupPath };
          emit("conflict", "", { winner: "unresolved", backupPath });
          throw new Error(storage.error);
        }
        const localBackupPath = await backupLocalCalendar(dir, captured);
        writeBlocked = true; storage = { state: "unreadable", error: message, backupPath: "", localBackupPath };
        emit("conflict", "", { winner: "unresolved", backupPath: localBackupPath });
        throw new Error("Calendar storage is unreadable: " + message);
      }
      if (storage.state === "recovery-pending") {
        if (text !== protectedText) {
          const localBackupPath = await backupLocalCalendar(dir, captured);
          writeBlocked = true; storage = { ...storage, state: "conflict", error: "Calendar file changed since recovery was requested.", localBackupPath };
          emit("conflict", "", { winner: "unresolved", backupPath: localBackupPath });
          throw new Error(storage.error);
        }
        return null; // explicit replacement of the previously backed-up damaged file
      }
      try { return parseCalendarSnapshot(text); }
      catch (error) {
        let backupPath = "";
        try { backupPath = await backupCalendar(dir, "corrupt", String(text)); } catch (backupError) { safeWarn(backupError); }
        const localBackupPath = await backupLocalCalendar(dir, captured);
        protectedText = backupPath ? String(text) : null;
        writeBlocked = true; storage = { state: "corrupt", error: String(error?.message || error), backupPath, localBackupPath };
        emit("conflict", "", { winner: "unresolved", backupPath: localBackupPath });
        throw new Error("Calendar storage is corrupt: " + storage.error);
      }
    }
    function applyMerged(captured, merged) {
      const patch = (target, before, after, keyOf, kind) => {
        const old = new Map(before.map((record) => [keyOf(record), record]));
        const next = new Map(after.map((record) => [keyOf(record), record]));
        for (const id of new Set([...old.keys(), ...next.keys()])) {
          if (!equalRecord(target.get(id), old.get(id))) continue; // a newer local edit arrived during I/O
          const value = next.get(id), current = target.get(id);
          if (equalRecord(current, value)) continue;
          if (value) target.set(id, value); else target.delete(id);
          emit(kind === "category" ? "category" : value ? "change" : "remove", id);
        }
      };
      patch(items, captured.items, merged.items, (v) => v.id, "item");
      patch(categoryDefs, captured.categories, merged.categories, (v) => categoryKey(v.name), "category");
    }
    // The note file and the calendar file are not one transaction, and the hook only TRIES to save the notes. A record
    // must not start pointing at a note before that note is in its file: after a restart a record without its line is
    // dropped by the note sync, and a record of a note that was never created stays hidden for good. `noteFileState(id)`
    // says where the note stands: "saved" (the file has the text), "stale" (the file has older text), "absent" (no file).
    // Until the note is saved, a write presents such a record in the form that does not need the note:
    //   - a reminder that became a note line: the reminder itself (`unmirroredItem`), with its details of today;
    //   - a record that is only linked to the note: without the link, and only while the note has no file at all;
    //   - a line somebody typed: nothing, the text is all there is to it.
    // `noteTextSaved()` brings the real records along once the note is saved. A record that already points at its note
    // in the file is written as usual: a moved time or an edited detail never waits for the note.
    // Returns id -> the version to present (null = none).
    function withheld(captured) {
      const held = new Map();
      if (typeof noteFileState !== "function") return held;
      const before = new Map(baseline.items.map((record) => [record.id, record])), asked = new Map();
      const stateOf = (noteId) => {
        if (!asked.has(noteId)) {
          let fileState = "saved";
          try { fileState = noteFileState(noteId); } catch (error) { safeWarn(error); }
          asked.set(noteId, fileState === "stale" || fileState === "absent" ? fileState : "saved");
        }
        return asked.get(noteId);
      };
      const identity = (record) => String(record.x?.historyId || record.id);
      const mine = new Set(), waiting = new Map(); // identity -> the held record
      for (const record of captured.items) {
        mine.add(record.id);
        const noteId = record.x?.noteId, old = before.get(record.id) || null;
        if (!noteId || old?.x?.noteId === noteId) continue;
        const fileState = stateOf(noteId);
        if (fileState === "saved") continue;
        if (record.x.src === "manual") {
          // Only linked to the note. Behind a note without a file it would be hidden after a restart: written with
          // the link it had before (usually none).
          if (fileState === "absent") held.set(record.id, cleanItem({ ...record, etag: "", x: { ...record.x, noteId: old?.x?.noteId || "", heading: old?.x?.heading || "" } }, 0));
          continue;
        }
        held.set(record.id, old);
        waiting.set(identity(record), record);
      }
      if (!waiting.size) return held;
      const replaced = new Map(); // identity -> the record of the file that the held one took the place of
      for (const old of baseline.items) if (!mine.has(old.id) && waiting.has(identity(old))) replaced.set(identity(old), old);
      for (const [key, record] of waiting) {
        const old = replaced.get(key) || null;
        // The line was moved here from another note whose file still has it: that record stands as it is.
        if (old && old.x.src !== "manual" && old.x.noteId && stateOf(old.x.noteId) !== "saved") { held.set(old.id, old); continue; }
        // Otherwise the reminder itself, with its details of today (no note file has its line: a moved line whose
        // old note was saved without it would be dropped there); failing that, the reminder as the file has it.
        const reminder = unmirroredItem(record);
        if (reminder && !mine.has(reminder.id) && !held.has(reminder.id)) held.set(reminder.id, reminder);
        else if (old && old.x.src === "manual") held.set(old.id, old);
      }
      return held;
    }
    function writeNow() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      const dir = getDir();
      if (!dirty || !dir) return chain;
      if (writeBlocked) {
        const error = new Error("Calendar storage is protected because its existing file could not be read safely.");
        safeWarn(error); return Promise.reject(error);
      }
      dirty = false; pendingWrites++;
      // A failing hook is reported but never blocks the calendar: its own write error is shown by its owner.
      const prepare = typeof beforeWrite === "function" ? () => Promise.resolve().then(beforeWrite).catch(safeWarn) : () => null;
      const task = chain.catch(() => {}).then(prepare).then(() => withCalendarLock(io.join(dir, ITEMS_FILE), async () => {
        try {
          if (writeBlocked) throw new Error("Calendar storage is protected because its existing file could not be read safely.");
          const captured = snapshot(), held = withheld(captured);
          // What this window presents to the file: its records, the held ones in the form that needs no note.
          const local = !held.size ? captured : { categories: captured.categories,
            items: [...captured.items.filter((record) => !held.has(record.id)), ...[...held.values()].filter(Boolean)] };
          const remote = await readCalendarForWrite(dir, captured);
          const merged = remote ? mergeCalendarSnapshots(baseline, local, remote) : { ...local, conflicts: [], safe: true };
          if (!merged.safe) {
            const backupPath = await backupLocalCalendar(dir, captured, remote);
            writeBlocked = true; storage = { state: "conflict", error: "Calendar edits conflict with changes from another window.", backupPath };
            emit("conflict", "", { winner: "unresolved", backupPath });
            throw new Error(storage.error);
          }
          const text = JSON.stringify({ v: 2, items: merged.items, categories: merged.categories });
          perf?.recordBytes?.("calendar.bytes", text);
          await io.writeUTF8(io.join(dir, ITEMS_FILE), text, { tmpPath: io.join(dir, ITEMS_FILE + ".tmp") });
          try { onItemsWrite(dir); } catch (_) {}
          baseline = JSON.parse(JSON.stringify({ items: merged.items, categories: merged.categories }));
          applyMerged(local, merged);
          for (const conflict of merged.conflicts) if (conflict.winner === "remote") emit("conflict", conflict.id, conflict);
          retryCount = 0; protectedText = null; storage = { state: "ready", error: "", backupPath: "" };
          if (dirty && timer === null && !writeBlocked) scheduleTimer(delayMs);
          // Held records keep the store unsaved, without a timer of their own: they wait for `noteTextSaved()` or for
          // the next change, so a note that cannot be saved is not tried again faster than its own retry.
          heldBack = held.size > 0;
          if (heldBack) dirty = true;
          return true;
        } catch (error) {
          dirty = true; retryCount++; safeWarn(error);
          if (retryCount <= 3 && timer === null && !writeBlocked) scheduleTimer(Math.min(delayMs * Math.pow(2, retryCount), 5000));
          throw error;
        }
      })).finally(() => { pendingWrites--; });
      chain = task;
      return task;
    }
    if (perf?.wrapAsync) writeNow = perf.wrapAsync("calendar.write", writeNow);
    function skipPastAtCreation(item, stamp) {
      if (!isReminder(item) && !(item.reminders?.overrides || []).length) return;
      if (!(itemRange(item)[0] < stamp)) return;
      const occurrences = item.recurrence.length ? expandRange([item], stamp - 2 * DAY_MS, stamp + 1) : [item];
      for (const occurrence of occurrences) {
        const identity = reminderIdentity(occurrence);
        if (!identity || !(itemRange(occurrence)[0] < stamp)) continue;
        const category = occurrence.x.category ? categoryDefs.get(categoryKey(occurrence.x.category)) || DEFAULT_CATEGORIES.find((c) => categoryKey(c.name) === categoryKey(occurrence.x.category)) : null;
        for (const stage of reminderStagePlan(occurrence, category?.notify, stamp)) {
          if (stage.at >= stamp) continue;
          history.append({ ...identity, summary: occurrence.summary, start: occurrence.start, action: "skipped", stage: stage.stage, at: stamp });
        }
      }
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
            if (dirty || pendingWrites) return state();
            items.clear(); categoryDefs.clear(); hidden.clear(); dirty = false; writeBlocked = false; heldBack = false;
            baseline = { items: [], categories: [] }; protectedText = null;
            storage = { state: "missing", error: "", backupPath: "" };
          } else {
            // A permission/I/O error is not an empty store. Keep existing in-memory data and prohibit overwriting
            // the unreadable file until the caller explicitly resolves the storage problem.
            const hasPending = dirty || pendingWrites;
            const localBackupPath = hasPending ? await backupLocalCalendar(getDir(), snapshot()) : "";
            writeBlocked = true;
            storage = { state: "unreadable", error: String(error?.message || error), backupPath: "", localBackupPath };
            if (hasPending) emit("conflict", "", { winner: "unresolved", backupPath: localBackupPath });
            safeWarn(error);
          }
          emit("reset");
          return state();
        }
        let parsedItems, parsedCategories;
        try {
          const parsed = parseCalendarSnapshot(text);
          parsedItems = parsed.items; parsedCategories = parsed.categories;
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
          const hasPending = dirty || pendingWrites;
          const localBackupPath = hasPending ? await backupLocalCalendar(getDir(), snapshot()) : "";
          protectedText = backedUp ? String(text) : null;
          writeBlocked = true;
          storage = { state: "corrupt", error: String(error?.message || error), backupPath: backedUp ? backupPath : "", localBackupPath };
          if (hasPending) emit("conflict", "", { winner: "unresolved", backupPath: localBackupPath });
          safeWarn(error);
          emit("reset");
          return state();
        }
        if (dirty || pendingWrites) return state();
        items.clear(); categoryDefs.clear(); hidden.clear(); dirty = false; writeBlocked = false; retryCount = 0; heldBack = false;
        for (const it of parsedItems) if (!items.has(it.id)) items.set(it.id, it);
        for (const category of parsedCategories) categoryDefs.set(categoryKey(category.name), category);
        baseline = snapshot(); protectedText = null;
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
          it.rev = 1;
          it.created = iso(stamp);
        }
        if (old) { if (old.created) it.created = old.created; else delete it.created; }
        it.updated = iso(stamp);
        it.etag = etagOf(it);
        if (old && JSON.stringify(old) === JSON.stringify(it)) return old;
        if (old && isReminder(it)) {
          const changedStart = JSON.stringify(old.start) !== JSON.stringify(it.start);
          const changedRecurrence = ["rescheduled", "snoozed"].includes(raw?.historyAction) && !!raw?.occurrenceId
            && JSON.stringify(old.x?.recurrenceExceptions || []) !== JSON.stringify(it.x?.recurrenceExceptions || []);
          if (changedStart || changedRecurrence) {
            const action = raw?.historyAction === "snoozed" ? "snoozed" : "rescheduled";
            const historyStart = cleanWhen(raw?.historyStart) || it.start;
            const ident = it.x.historyId ? reminderIdentity(it) : null;
            const record = history.append({ itemId: ident?.itemId || it.id, occurrenceId: String(raw?.occurrenceId || ident?.occurrenceId || it.id), noteId: it.x.noteId, summary: it.summary, start: historyStart, action, at: stamp });
            if (!record) return null; // Never accept a lifecycle transition that cannot be recorded safely.
          }
        }
        if (!old) skipPastAtCreation(it, stamp);
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
      ensureNoteIds(noteId, body) { return ensureNoteItemIds(body, noteId, now(), getParseOptions()); },
      // Rebuild the note-derived items. During upgrade, migrate extras from legacy IDs using the old content/ordinal key.
      // Thereafter exact line IDs win; unique legacy matches are safe, while an unidentified duplicate never inherits
      // another duplicate's metadata.
      syncNote(noteId, body, { sourceEdit = false, updatedAt = 0, calendarSync = false, remote = false } = {}) {
        const had = [...items.values()].filter((it) => it.x.noteId === noteId && it.x.src === "list");
        if (!had.length && !/%%\s*calendar/i.test(String(body || ""))) return false;
        const fresh = extractNoteItems(body, noteId, now(), getParseOptions());
        const checkedLines = sourceEdit ? listCheckboxStates(body, now(), getParseOptions()) : null;
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
            next = reconcileListItem(old, f, { sourceEdit, updatedAt, calendarSync, remote });
            if (old.id === next.id) retainedOld.add(old.id);
          }
          if (old?.created) next.created = old.created;
          if (!old && sourceEdit) {
            next.created = iso(now());
            if (!checkedLines?.get(next.x.key)) skipPastAtCreation(next, now());
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
      cancelTimers() {
        if (timer !== null) { clearTimer(timer); timer = null; }
        history.cancelTimers?.();
      },
      unloadSnapshot() {
        if (writeBlocked || !dirty || !getDir()) return null;
        return {
          baseline: JSON.parse(JSON.stringify(baseline)),
          local: snapshot(),
        };
      },
      async refresh() {
        const dir = getDir();
        if (!dir || writeBlocked) return false;
        return withCalendarLock(io.join(dir, ITEMS_FILE), async () => {
          if (writeBlocked) return false;
          let text;
          try { text = await io.readUTF8(io.join(dir, ITEMS_FILE)); } catch (_) { return false; }
          let remote;
          try { remote = parseCalendarSnapshot(text); } catch (_) { return false; }
          const captured = snapshot();
          const merged = mergeCalendarSnapshots(baseline, captured, remote);
          if (!merged.safe) return false;
          baseline = JSON.parse(JSON.stringify(remote));
          applyMerged(captured, merged);
          return true;
        });
      },
      async reconcileRecoveryEntry(entry, blockedNoteIds = new Set()) {
        const dir = getDir();
        if (!dir || !entry || !entry.local || !Array.isArray(entry.local.items)) return { ok: true, changed: false, conflict: false };
        return withCalendarLock(io.join(dir, ITEMS_FILE), async () => {
          const base = {
            items: (Array.isArray(entry.baseline?.items) ? entry.baseline.items : []).map((it) => cleanItem(it, 0)).filter(Boolean),
            categories: (Array.isArray(entry.baseline?.categories) ? entry.baseline.categories : []).map(cleanCategory).filter(Boolean),
          };
          const rawLocal = {
            items: entry.local.items.map((it) => cleanItem(it, 0)).filter(Boolean),
            categories: (Array.isArray(entry.local.categories) ? entry.local.categories : []).map(cleanCategory).filter(Boolean),
          };
          // If a note's unload recovery was blocked by a foreign change, never write a mirrored calendar item pointing
          // at lines that did not land on disk (preserve it as a standalone reminder instead, matching UI4.7).
          const blocked = blockedNoteIds instanceof Set ? blockedNoteIds : new Set();
          let local = rawLocal;
          if (blocked.size) {
            const prevById = new Map(base.items.map((r) => [r.id, r]));
            const nextItems = [];
            const seen = new Set();
            for (const record of rawLocal.items) {
              const noteId = record.x?.noteId;
              const old = prevById.get(record.id) || null;
              if (noteId && blocked.has(noteId) && old?.x?.noteId !== noteId) {
                if (record.x.src === "manual") {
                  const unlinked = cleanItem({ ...record, etag: "", x: { ...record.x, noteId: old?.x?.noteId || "", heading: old?.x?.heading || "" } }, 0);
                  if (unlinked && !seen.has(unlinked.id)) { seen.add(unlinked.id); nextItems.push(unlinked); }
                } else {
                  const standalone = unmirroredItem(record);
                  if (standalone && !seen.has(standalone.id)) { seen.add(standalone.id); nextItems.push(standalone); }
                }
                continue;
              }
              if (!seen.has(record.id)) { seen.add(record.id); nextItems.push(record); }
            }
            local = { categories: rawLocal.categories, items: nextItems };
          }
          const file = io.join(dir, ITEMS_FILE);
          let remote = { items: [], categories: [] };
          let exists = true;
          let text = "";
          try { text = await io.readUTF8(file); }
          catch (error) {
            const message = String(error?.message || error || "");
            let missing = error?.code === "ENOENT" || error?.name === "NotFoundError" || /(?:^|\b)(?:nf|not found|no such file|does not exist|NS_ERROR_FILE_NOT_FOUND)(?:\b|$)/i.test(message);
            if (!missing && typeof io.exists === "function") { try { missing = !(await io.exists(file)); } catch (_) {} }
            if (!missing) {
              const backupPath = await backupLocalCalendar(dir, local);
              return { ok: !!backupPath, changed: false, conflict: true, backupPath };
            }
            exists = false;
          }
          if (exists) {
            try { remote = parseCalendarSnapshot(text); }
            catch (_) {
              const backupPath = await backupLocalCalendar(dir, local);
              return { ok: !!backupPath, changed: false, conflict: true, backupPath };
            }
          }
          const merged = mergeCalendarSnapshots(base, local, remote);
          if (!merged.safe) {
            const backupPath = await backupLocalCalendar(dir, local, remote);
            return { ok: !!backupPath, changed: false, conflict: true, backupPath };
          }
          const out = JSON.stringify({ v: 2, items: merged.items, categories: merged.categories });
          if (!exists || out !== text) {
            await io.writeUTF8(file, out, { tmpPath: file + ".tmp" });
          }
          return { ok: true, changed: true, conflict: false };
        });
      },
      // The owner of the note files saved text: records that waited for it (see `withheld`) are written now, straight
      // after the note as in every other save (no debounce: another window is about to read that note).
      noteTextSaved() { if (heldBack && dirty && !writeBlocked && getDir()) writeNow().catch(() => {}); },
    };
  }

  // ---------- calendar view layout (roadmap T2.4a) ----------
  // Keep the orientation decision pure so the sheet can react to its actual available rectangle (not the
  // browser window alone), and the threshold behavior can be regression-tested without Gecko layout.
  // The three looks of the style sheet (paddings and text sizes). Until 3.3.175 this was also the setting
  // `meta.calendarDensity`, one for all views; the setting is now `calendarScale` (see "the size of the calendar").
  const CALENDAR_DENSITIES = Object.freeze(["comfortable", "compact", "extra-compact"]);
  function cleanCalendarDensity(value) { return CALENDAR_DENSITIES.includes(value) ? value : "comfortable"; }
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
  // OW-32: All-notes tree pane squeeze tier from its effective inline width.
  // Priority order when squeezing: (1) never hide interactable areas, (2) keep titles intact, (3) collapse contents first.
  const TREE_SQUEEZE_THRESHOLDS = Object.freeze({ compact: 320, narrow: 245, tight: 170 });
  function treePaneSqueezeState(widthPx) {
    const w = Math.max(0, Number(widthPx) || 0);
    if (w <= 0 || w >= TREE_SQUEEZE_THRESHOLDS.compact) {
      return { tier: "full", hideSnippet: false, hideTime: false, hideBadges: false, compactIndent: false };
    }
    if (w >= TREE_SQUEEZE_THRESHOLDS.narrow) {
      return { tier: "compact", hideSnippet: true, hideTime: false, hideBadges: false, compactIndent: false };
    }
    if (w >= TREE_SQUEEZE_THRESHOLDS.tight) {
      return { tier: "narrow", hideSnippet: true, hideTime: true, hideBadges: false, compactIndent: true };
    }
    return { tier: "tight", hideSnippet: true, hideTime: true, hideBadges: true, compactIndent: true };
  }
  // OW-33: Small-window All-notes chrome density for non-calendar toolbars, header, chips, and batch bar.
  const ALL_NOTES_CHROME_THRESHOLDS = Object.freeze({ narrowWidth: 420, tightWidth: 310, shortHeight: 450 });
  function allNotesChromeDensity(widthPx, heightPx) {
    const w = Math.max(0, Number(widthPx) || 0);
    const h = Math.max(0, Number(heightPx) || 0);
    const tight = w > 0 && w < ALL_NOTES_CHROME_THRESHOLDS.tightWidth;
    const narrow = w > 0 && w < ALL_NOTES_CHROME_THRESHOLDS.narrowWidth;
    const short = h > 0 && h < ALL_NOTES_CHROME_THRESHOLDS.shortHeight;
    const compact = tight || narrow || short;
    return {
      density: tight ? "tight" : compact ? "compact" : "normal",
      compact,
      narrow,
      tight,
      short,
    };
  }
  // OW-34: Active-filter count for the quick-hide Calendar controls toggle.
  function calendarActiveFilterCount(kind, category) {
    let count = 0;
    if (kind === "event" || kind === "reminder") count++;
    if (typeof category === "string" && category.trim()) count++;
    return count;
  }
  // OW-35: Independent filter & controls-visibility state for regular Calendar pane vs Big Picture popup.
  const CALENDAR_FILTER_KINDS = Object.freeze(["all", "event", "reminder"]);
  function cleanCalendarFilterKind(value) { return CALENDAR_FILTER_KINDS.includes(value) ? value : "all"; }
  function cleanCalendarFilterCategory(value) { return typeof value === "string" ? value.slice(0, 80) : ""; }
  function calendarFilterKeysFor(isBigPicture) {
    return isBigPicture
      ? { kindKey: "calendarBigPictureFilterKind", categoryKey: "calendarBigPictureFilterCategory", collapsedKey: "calendarBigPictureFiltersCollapsed" }
      : { kindKey: "calendarFilterKind", categoryKey: "calendarFilterCategory", collapsedKey: "calendarFiltersCollapsed" };
  }
  function readCalendarFilters(meta, isBigPicture) {
    const keys = calendarFilterKeysFor(Boolean(isBigPicture));
    const src = meta && typeof meta === "object" ? meta : {};
    return {
      kind: cleanCalendarFilterKind(src[keys.kindKey]),
      category: cleanCalendarFilterCategory(src[keys.categoryKey]),
      collapsed: src[keys.collapsedKey] === true,
    };
  }
  // T2.6: Calendar Big Picture viewport card sizes (% of browser viewport) and geometry helper.
  const CALENDAR_BIG_PICTURE_SIZES = Object.freeze([70, 80, 90, 95]);
  const DEFAULT_CALENDAR_BIG_PICTURE_SIZE = 90;
  function cleanCalendarBigPictureSize(value) {
    const n = Number(value);
    return CALENDAR_BIG_PICTURE_SIZES.includes(n) ? n : DEFAULT_CALENDAR_BIG_PICTURE_SIZE;
  }
  function calendarBigPictureBox(viewport, pct = DEFAULT_CALENDAR_BIG_PICTURE_SIZE) {
    const cleanPct = cleanCalendarBigPictureSize(pct);
    const vw = Math.max(0, Math.round(Number(viewport?.width) || 0));
    const vh = Math.max(0, Math.round(Number(viewport?.height) || 0));
    if (!vw || !vh) return { pct: cleanPct, width: 0, height: 0, left: 0, top: 0 };
    const maxW = Math.max(0, vw - 16) || vw;
    const maxH = Math.max(0, vh - 16) || vh;
    const width = Math.min(maxW, Math.max(Math.min(320, maxW), Math.round((vw * cleanPct) / 100)));
    const height = Math.min(maxH, Math.max(Math.min(240, maxH), Math.round((vh * cleanPct) / 100)));
    const left = Math.max(0, Math.round((vw - width) / 2));
    const top = Math.max(0, Math.round((vh - height) / 2));
    return { pct: cleanPct, width, height, left, top };
  }

  // ---------- all-day strip ----------
  // Items that sit in the strip above the time grid on `day`: all-day events and all-day reminders.
  const allDayOf = (items, day) => itemsInRange(items, day, addDays(day, 1)).filter((it) => isAllDay(it) || (isReminder(it) && isAllDay(it)));

  // ---------- recurrence (RRULE subset: FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY for weekly) ----------
  const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const parsedRuleCache = new Map(), PARSED_RULE_CACHE_LIMIT = 256;
  function parseRule(text) {
    // UNTIL is a local civil date, so a timezone change must not reuse the old value.
    let zone = "";
    if (/;?UNTIL=/i.test(String(text || ""))) { try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) {} }
    const key = zone + "\u0000" + String(text || "");
    if (parsedRuleCache.has(key)) {
      const cached = parsedRuleCache.get(key);
      parsedRuleCache.delete(key); parsedRuleCache.set(key, cached);
      return cached ? { ...cached, byday: [...cached.byday] } : null;
    }
    const parsed = parseRuleUncached(text);
    parsedRuleCache.set(key, parsed);
    if (parsedRuleCache.size > PARSED_RULE_CACHE_LIMIT) parsedRuleCache.delete(parsedRuleCache.keys().next().value);
    return parsed ? { ...parsed, byday: [...parsed.byday] } : null;
  }
  function parseRuleUncached(text) {
    const m = /^RRULE:(.+)$/.exec(String(text || ""));
    if (!m) return null;
    const o = {};
    for (const part of m[1].split(";")) { const [k, v] = part.split("="); if (k && v !== undefined) o[k.toUpperCase()] = v; }
    if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(o.FREQ)) return null;
    const interval = Math.max(1, Math.min(999, parseInt(o.INTERVAL, 10) || 1));
    const count = o.COUNT ? Math.max(1, Math.min(1000000, parseInt(o.COUNT, 10) || 0)) : 0;
    // UNTIL is the last civil day of the series. `untilKey` is that day (YYYY-MM-DD, the value editors show);
    // `until` is its end in the system zone. Never derive the day from `until` by subtracting 24 hours: a 23-hour
    // day would give the day before.
    // The end is the first instant of the NEXT day, asked for directly. Not "the start of the last day plus one day":
    // where clocks go forward at midnight (Cuba, Lebanon, Egypt, Chile) such a day starts at 01:00, one day later is
    // 01:00 again, and the first hour after the last day was still let through (for an all-day item: one more day).
    let until = 0, untilKey = "";
    if (o.UNTIL) {
      const u = /^(\d{4})(\d{2})(\d{2})/.exec(o.UNTIL);
      if (u) { const last = new Date(+u[1], +u[2] - 1, +u[3]); until = new Date(+u[1], +u[2] - 1, +u[3] + 1).getTime(); untilKey = ymd(last); }
    }
    const byday = o.BYDAY ? [...new Set(o.BYDAY.split(",").map((d) => DAY_CODES.indexOf(d.slice(-2))).filter((n) => n >= 0))].sort((a, b) => a - b) : [];
    return { freq: o.FREQ, interval, count, until, untilKey, byday };
  }
  // First instant after the series end. A timed item pinned to a zone ends with its last day IN THAT ZONE, wherever
  // the computer is; all-day and unpinned items use the system zone. Infinity when the rule has no UNTIL.
  const untilBoundaryCache = new Map();
  function recurrenceUntilMs(rule, zone = "") {
    if (!rule || !rule.until) return Infinity;
    if (!zone || !rule.untilKey) return rule.until;
    const key = zone + "\u0000" + rule.untilKey;
    if (untilBoundaryCache.has(key)) return untilBoundaryCache.get(key);
    const last = parseYmd(rule.untilKey);
    const next = last ? zonedDateTimeToMs(localDateKey(addDays(last.getTime(), 1)), "00:00", zone) : null;
    const value = Number.isFinite(next) ? next : rule.until;
    untilBoundaryCache.set(key, value);
    if (untilBoundaryCache.size > PARSED_RULE_CACHE_LIMIT) untilBoundaryCache.delete(untilBoundaryCache.keys().next().value);
    return value;
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
  function recurrenceCandidateMs(date, wall, zone = "", base = null, startMs = NaN) {
    if (base && Number.isFinite(startMs) && date.getFullYear() === base.getFullYear() && date.getMonth() === base.getMonth() && date.getDate() === base.getDate()) return startMs;
    if (!zone) return new Date(date.getFullYear(), date.getMonth(), date.getDate(), wall.hour, wall.minute, wall.second, wall.millisecond).getTime();
    const key = ymd(date), minute = zonedDateTimeToMs(key, p2(wall.hour) + ":" + p2(wall.minute), zone);
    return Number.isFinite(minute) ? minute + wall.second * 1000 + wall.millisecond : NaN;
  }
  function copyOccurrenceRecord(value) {
    if (Array.isArray(value)) return value.map(copyOccurrenceRecord);
    if (!value || typeof value !== "object") return value;
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = copyOccurrenceRecord(value[key]);
    return copy;
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
    const singleExceptions = new Map();
    for (const entry of exceptions) if (entry.scope === "this") {
      const stamp = whenMs(entry.recurrenceId);
      if (!singleExceptions.has(stamp)) singleExceptions.set(stamp, entry);
    }
    const margins = recurrenceSearchMargins(it, allDay), until = recurrenceUntilMs(rule, zone);
    const limit = Math.min(to + margins.negative, until);
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
      : recurrenceCandidateMs(d, wall, zone, base, s0);
    for (let scanned = 0; scanned < 100000; scanned++, period++) {
      if (recurrencePeriodAnchor(rule, base, period) >= limitCivil) break;
      const candidates = recurrencePeriodDates(rule, base, period).map(timedAt).sort((a, b) => a - b);
      for (const recurrenceMs of candidates) {
        if (recurrenceMs < s0) continue;
        if (recurrenceMs >= until) return out;
        if (rule.count && ordinal >= rule.count) return out;
        ordinal++;
        if (exdates.has(recurrenceMs)) continue;
        const recurrenceId = recurrenceIdWhen(recurrenceMs, allDay);
        const exception = singleExceptions.get(recurrenceMs);
        if (exception?.cancelled) continue;
        let visibleStart = recurrenceMs + occurrenceShift(exceptions, recurrenceMs, allDay);
        let visibleEnd = allDay ? addDays(visibleStart, allDaySpan) : visibleStart + len;
        if (exception && !exception.cancelled) {
          visibleStart = whenMs(exception.start);
          visibleEnd = exception.end ? whenMs(exception.end) : visibleStart + len;
        }
        const touches = reminder ? visibleStart >= from && visibleStart < to : visibleStart < to && visibleEnd > from;
        if (!touches) continue;
        // Calendar items are normalized plain records. Clone nested values to
        // keep occurrences, siblings and their source independently editable.
        const occ = copyOccurrenceRecord(it);
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
    if (!rule || !Number.isSafeInteger(recurrenceMs) || recurrenceMs < whenMs(master.start)) return false;
    const allDay = isAllDay(master), zone = allDay ? "" : cleanZone(master.x?.tz);
    if (recurrenceMs >= recurrenceUntilMs(rule, zone)) return false;
    const base = recurrenceCivilDate(whenMs(master.start), zone);
    const firstPeriod = recurrencePeriodIndex(rule, base, recurrenceCivilDate(recurrenceMs, zone).getTime());
    // The search helper deliberately starts one period early so event spans and BYDAY weeks are not missed.
    // Check that period and its successor to find the candidate's actual COUNT ordinal.
    for (let period = firstPeriod; period <= firstPeriod + 1; period++) {
      const startMs = whenMs(master.start), wall = recurrenceWallClock(startMs, zone);
      const candidates = recurrencePeriodDates(rule, base, period).map((date) => allDay
        ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
        : recurrenceCandidateMs(date, wall, zone, base, startMs)).sort((a, b) => a - b);
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
    if (!zone) {
      // Clock times of that day in the computer's zone (09:00 is 09:00). Not midnight plus so many minutes: on a day
      // the clocks change that is an hour off.
      const at = (minute) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minute / 60), minute % 60).getTime();
      const start = at(w.startMin), end = at(w.endMin);
      return end > start ? [start, end] : null;
    }
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
    // opts.hours = { startMin, endMin }: only inside these hours of every day (the hours the Week / Day grid is held
    // to, OW-04). With opts.work as well, only what lies in both.
    const hours = opts.hours ? cleanCalendarHours({ ...opts.hours, on: true }) : null;
    const hoursOf = (d) => workRange(d, { days: [0, 1, 2, 3, 4, 5, 6], startMin: hours.startMin, endMin: hours.endMin }, zone);
    if (opts.work || hours) {
      for (let d = dayStart(from); d < to; d = addDays(d, 1)) {
        let r = opts.work ? workRange(d, opts.work, zone) : hoursOf(d);
        if (r && opts.work && hours) { const h = hoursOf(d); r = h ? [Math.max(r[0], h[0]), Math.min(r[1], h[1])] : null; }
        if (r) windows.push([Math.max(r[0], rangeFrom), Math.min(r[1], rangeTo)]);
      }
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

  // ---------- the hours the Week / Day grid shows (OW-04) ----------
  // Stored in meta.calendarHours as { on, startMin, endMin }, whole hours; off = the whole day. What is stored and
  // makes no sense falls back to 08:00-20:00, and only `on: true` switches it on.
  const DEFAULT_CALENDAR_HOURS = Object.freeze({ on: false, startMin: 480, endMin: 1200 });
  function cleanCalendarHours(value) {
    const o = value && typeof value === "object" ? value : {};
    const hour = (v) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Math.round(Number(v) / 60) * 60 : NaN);
    let a = hour(o.startMin), b = hour(o.endMin);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > 1440 || b <= a) { a = DEFAULT_CALENDAR_HOURS.startMin; b = DEFAULT_CALENDAR_HOURS.endMin; }
    return { on: o.on === true, startMin: a, endMin: b };
  }

  // Responsive main Month date picker. "auto" switches at either threshold; the other modes are explicit overrides.
  const DEFAULT_CALENDAR_PICKER = Object.freeze({ mode: "auto", minWidth: 470, minHeight: 360, colorMode: "count" });
  function cleanCalendarPicker(value) {
    const o = value && typeof value === "object" ? value : {};
    const bounded = (v, fallback, min, max) => {
      const number = typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : NaN;
      return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
    };
    return {
      mode: ["auto", "picker", "month"].includes(o.mode) ? o.mode : DEFAULT_CALENDAR_PICKER.mode,
      minWidth: bounded(o.minWidth, DEFAULT_CALENDAR_PICKER.minWidth, 320, 720),
      minHeight: bounded(o.minHeight, DEFAULT_CALENDAR_PICKER.minHeight, 240, 720),
      colorMode: ["count", "category"].includes(o.colorMode) ? o.colorMode : DEFAULT_CALENDAR_PICKER.colorMode,
    };
  }
  // The hours the grid has to show: the chosen ones, widened by whole hours until every timed item of the days in
  // view lies inside. Off = 0..1440. The hours follow the times of the items, not the size of their boxes: a reminder
  // at 19:50 lies inside 08:00-20:00 (the grid keeps its box inside), one at 20:00 sharp lies after it.
  //   itemsInView  one entry per visible day. { day, entries }: [{ startMin, endMin, item }] in minutes on the clock
  //                of that day, already cut off at its ends (the grid hands over what it draws from). Or
  //                { day, items }: calendar items, laid out here for `day` in `zone`; a timed reminder counts as one
  //                minute from its start. All-day and cancelled items never count.
  //   opts.draft   { day, startMin, endMin } of a range that is being dragged out; it counts like an item.
  // Returns { startMin, endMin, extendedTop, extendedBottom, top, bottom }. `top` / `bottom` say why the grid begins
  // earlier / ends later than chosen: { item, day, startMin, endMin } of the entry that reaches furthest (item null
  // for the draft), null where it was not widened.
  function visibleHourRange(settingRange, itemsInView, zone = "", opts = {}) {
    const set = cleanCalendarHours(settingRange);
    const timeline = opts?.timeline || null;
    const totalMin = Number.isFinite(timeline?.totalMinutes) && timeline.totalMinutes > 0 ? timeline.totalMinutes : 1440;
    if (!set.on) return { startMin: 0, endMin: totalMin, extendedTop: false, extendedBottom: false, top: null, bottom: null };
    const setStart = timeline ? timelineCivilToGridMin(timeline, set.startMin) : set.startMin;
    const setEnd = timeline ? timelineCivilToGridMin(timeline, set.endMin) : set.endMin;
    let first = null, last = null;
    const take = (startMin, endMin, item, day) => {
      const a = Number(startMin), b = Number(endMin);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return;
      const lo = Math.max(0, Math.min(totalMin, a)), hi = Math.max(lo, Math.min(totalMin, b));
      if (!first || lo < first.startMin) first = { item, day, startMin: lo, endMin: hi };
      if (!last || hi > last.endMin) last = { item, day, startMin: lo, endMin: hi };
    };
    for (const d of Array.isArray(itemsInView) ? itemsInView : []) {
      if (!d || typeof d !== "object") continue;
      if (Array.isArray(d.entries)) { for (const e of d.entries) if (e) take(e.startMin, e.endMin, e.item === undefined ? null : e.item, d.day); continue; }
      if (!Array.isArray(d.items) || !Number.isFinite(d.day)) continue;
      // layoutDay lays out events only: a timed reminder goes in as one minute from its start, and the original is
      // handed back as the reason.
      const originals = new Map();
      const spans = d.items.filter((it) => it && it.start && !isAllDay(it)).map((it) => {
        if (!isReminder(it)) return it;
        const copy = { ...it, x: { ...(it.x || {}), kind: "event" }, end: { dateTime: iso(itemRange(it)[0] + MIN) } };
        originals.set(copy, it);
        return copy;
      });
      for (const e of layoutDay(spans, d.day, zone)) take(e.startMin, Math.max(e.endMin, e.startMin + 1), originals.get(e.item) || e.item, d.day);
    }
    if (opts?.draft) take(opts.draft.startMin, opts.draft.endMin, null, opts.draft.day);
    const startMin = first ? Math.min(setStart, Math.floor(first.startMin / 60) * 60) : setStart;
    const endMin = last ? Math.max(setEnd, Math.ceil(last.endMin / 60) * 60) : setEnd;
    const extendedTop = startMin < setStart, extendedBottom = endMin > setEnd;
    return { startMin, endMin, extendedTop, extendedBottom, top: extendedTop ? first : null, bottom: extendedBottom ? last : null };
  }
  // A position in the grid <-> a minute of the day, for a grid that shows `range` ({ startMin, endMin }; none = the
  // whole day) at `hourPx` px an hour. Everything the grid draws and every pointer position it reads goes through
  // these two, so it cannot be drawn from one hour and measured from another.
  const gridStartMin = (range) => (Number.isFinite(range?.startMin) ? range.startMin : 0);
  const gridEndMin = (range) => (Number.isFinite(range?.endMin) ? range.endMin : 1440);
  function gridOffsetOf(minute, hourPx, range) { return (Number(minute) - gridStartMin(range)) / 60 * hourPx; }
  function gridMinuteAt(offsetPx, hourPx, range) {
    const a = gridStartMin(range), b = gridEndMin(range), minute = a + Number(offsetPx) * 60 / hourPx;
    return Number.isFinite(minute) ? Math.max(a, Math.min(b, minute)) : a;
  }

  // ---------- the size of the calendar (OW-03) ----------
  // Stored in meta.calendarScale as { month, week, day, upcoming, agenda }; each is "auto" or a whole number of px.
  //   week, day          the height of an hour. "auto": the hours the grid shows fill the timeline (fitHourHeight).
  //   month              the height of a week. "auto": the six weeks fill the pane (the style sheet does that).
  //   upcoming, agenda   lists have nothing to fit: "auto" is Comfortable, 44 Compact, 36 Extra compact.
  // Per view: `comfortable` / `compact` / `extraCompact` are the px the three old steps stood for. A size at or over
  // `comfortable` is drawn with the Comfortable look, at or over `compact` with Compact, under it with Extra compact.
  const CALENDAR_SCALE_VIEWS = Object.freeze(["month", "week", "day", "upcoming", "agenda"]);
  const HOUR_SCALE = Object.freeze({ min: 16, max: 120, comfortable: 54, compact: 44, extraCompact: 36 });
  const LIST_SCALE = Object.freeze({ min: 36, max: 54, comfortable: 54, compact: 44, extraCompact: 36, steps: true });
  const CALENDAR_SCALE_LIMITS = Object.freeze({ month: Object.freeze({ min: 44, max: 160, comfortable: 58, compact: 52, extraCompact: 44 }), week: HOUR_SCALE, day: HOUR_SCALE, upcoming: LIST_SCALE, agenda: LIST_SCALE });
  const scaleDensityOf = (limits, px) => (px >= limits.comfortable ? "comfortable" : px >= limits.compact ? "compact" : "extra-compact");
  // One view's size: "auto", or whole px inside the limits of that view. A number or digits (a slider hands over
  // text) are a size; everything else fits.
  function cleanCalendarScaleValue(view, value) {
    const limits = Object.hasOwn(CALENDAR_SCALE_LIMITS, view) ? CALENDAR_SCALE_LIMITS[view] : null;
    if (!limits) return "auto";
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (!Number.isFinite(n)) return "auto";
    if (limits.steps) {
      // A list has the three steps only; the comfortable one is the default and is stored as such.
      const density = n >= (limits.comfortable + limits.compact) / 2 ? "comfortable" : n >= (limits.compact + limits.extraCompact) / 2 ? "compact" : "extra-compact";
      return density === "comfortable" ? "auto" : density === "compact" ? limits.compact : limits.extraCompact;
    }
    return Math.max(limits.min, Math.min(limits.max, Math.round(n)));
  }
  // The px a named step stands for in a view ("auto" for Comfortable: the default).
  function calendarScaleStep(view, density) {
    const limits = Object.hasOwn(CALENDAR_SCALE_LIMITS, view) ? CALENDAR_SCALE_LIMITS[view] : null;
    if (!limits || density === "comfortable" || !CALENDAR_DENSITIES.includes(density)) return "auto";
    return density === "compact" ? limits.compact : limits.extraCompact;
  }
  // The whole setting. `legacyDensity` is the value of the old `calendarDensity` and is read only while no
  // `calendarScale` is stored: Compact and Extra compact keep their sizes in every view; Comfortable, the default
  // nobody chose, becomes the new default (as 54 px nobody would ever get it).
  function cleanCalendarScale(value, legacyDensity) {
    const out = {};
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const view of CALENDAR_SCALE_VIEWS) out[view] = cleanCalendarScaleValue(view, value[view]);
      return out;
    }
    const density = cleanCalendarDensity(legacyDensity);
    for (const view of CALENDAR_SCALE_VIEWS) out[view] = calendarScaleStep(view, density);
    return out;
  }
  // Which of the three looks a size is drawn with. A fitted Week or Day is always Comfortable (its header must not
  // change its height with the hour that is fitted to what the header leaves). A fitted Month follows the height
  // its weeks got, `measuredPx`; nothing measured = Comfortable.
  function calendarScaleDensity(view, value, measuredPx) {
    const limits = Object.hasOwn(CALENDAR_SCALE_LIMITS, view) ? CALENDAR_SCALE_LIMITS[view] : null;
    if (!limits) return "comfortable";
    const size = cleanCalendarScaleValue(view, value);
    if (size !== "auto") return scaleDensityOf(limits, size);
    const measured = Number(measuredPx);
    return view === "month" && typeof measuredPx === "number" && measured > 0 ? scaleDensityOf(limits, measured) : "comfortable";
  }
  // The fitted hour: `hours` hours fill `availablePx` (the height of the timeline without the 2 px above the first
  // label), in quarter px, so that under 24 hours no more than 6 px stay empty. Not under `opts.minPx` (an hour
  // that can still be read, fitMinHourPx): then the timeline scrolls. Where nothing can be measured (a hidden pane,
  // a test without a layout) an hour is 54 px, the comfortable hour of before.
  const FIT_FALLBACK_HOUR_PX = 54, FIT_MIN_HOUR_PX = 18, FIT_MAX_HOUR_PX = 240;
  function fitHourHeight(availablePx, hours, opts = {}) {
    const room = typeof availablePx === "number" ? availablePx : NaN, n = typeof hours === "number" ? hours : NaN;
    if (!(room > 0) || !(n > 0) || !Number.isFinite(room) || !Number.isFinite(n)) return FIT_FALLBACK_HOUR_PX;
    const min = typeof opts?.minPx === "number" && opts.minPx > 0 && Number.isFinite(opts.minPx) ? opts.minPx : FIT_MIN_HOUR_PX;
    return Math.min(FIT_MAX_HOUR_PX, Math.max(min, Math.floor(room / n * 4) / 4));
  }
  // The smallest hour the fit may produce at a text size of `fontPx`: the hour labels are .62 of that size and one
  // line of an item about half of it, so 1.4 of it holds a label and a half-hour item. 18 px at the usual 13 px.
  function fitMinHourPx(fontPx) {
    return typeof fontPx === "number" && fontPx > 0 && Number.isFinite(fontPx) ? Math.max(HOUR_SCALE.min, Math.round(fontPx * 1.4)) : FIT_MIN_HOUR_PX;
  }
  // The smallest box of an item in Week and Day (a reminder, a short event) at `hourPx` px an hour. 20 px, which
  // holds the time and the title, down to 36 px an hour (the old Extra compact). Under that it shrinks with the hour
  // (5/9 of it), never under 11 px: one line, the title. So in a dense grid half-hour events one after another are
  // not pushed side by side by their boxes (the grid lets a box reach over the next item by a fifth of its height).
  function calendarMinBoxPx(hourPx) {
    return typeof hourPx === "number" && hourPx > 0 && Number.isFinite(hourPx) ? Math.max(11, Math.min(20, hourPx * 5 / 9)) : 20;
  }
  // The minute a timeline that scrolls has at its top when it is drawn fresh (no timeline before it whose position
  // could be kept). `range`: the hours of the grid. opts.nowMin: the current time, given only when today is in view;
  // opts.workStartMin: where the working day begins; opts.firstMin: the earliest timed item in view. With the
  // current time in the grid: the hour before it. Else where the working day begins, or the first item when that is
  // earlier. Always a whole hour inside the grid.
  function gridOpenMinute(range, opts = {}) {
    const a = gridStartMin(range), b = gridEndMin(range);
    const inGrid = (minute) => typeof minute === "number" && Number.isFinite(minute) && minute >= a && minute <= b;
    let minute = a;
    if (inGrid(opts?.nowMin)) minute = opts.nowMin - 60;
    else {
      const starts = [opts?.workStartMin, opts?.firstMin].filter((m) => typeof m === "number" && Number.isFinite(m) && m <= b);
      if (starts.length) minute = Math.min(...starts);
    }
    return Math.max(a, Math.min(b, Math.floor(minute / 60) * 60));
  }
  // How many lines of one item each a Month cell holds when a week is `rowPx` high. sizes: { pad, datePx, markPx,
  // gap } as measured in the drawn grid (the padding of a cell, the height of the date and of an item, the gap
  // between lines); a cell also has 2 px of border. At least one line. null where nothing is measured.
  function monthCellLines(rowPx, sizes) {
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const row = num(rowPx), date = num(sizes?.datePx), mark = num(sizes?.markPx);
    if (!(row > 0) || !(date > 0) || !(mark > 0)) return null;
    const pad = num(sizes.pad) >= 0 ? num(sizes.pad) : 3, gap = num(sizes.gap) >= 0 ? num(sizes.gap) : 2;
    return Math.max(1, Math.floor((row - 2 - 2 * pad - date) / (mark + gap)));
  }
  // What a Month cell with `count` items shows in `lines` lines: all of them when they fit, else one line less and
  // "+N more" in the last one. `label`: whether the line "All day" is shown too (only where a line is left over).
  // Without `lines` (nothing measured): two items and the number of the others, as before the cells were measured.
  function monthCellPlan(count, lines, hasAllDay) {
    const n = typeof count === "number" && count > 0 && Number.isFinite(count) ? Math.floor(count) : 0;
    if (!(typeof lines === "number" && lines >= 1 && Number.isFinite(lines))) return { marks: Math.min(n, 2), more: Math.max(0, n - 2), label: !!hasAllDay };
    const room = Math.floor(lines);
    if (n <= room) return { marks: n, more: 0, label: !!hasAllDay && n < room };
    return { marks: room - 1, more: n - (room - 1), label: false };
  }

  // ---------- time zones ----------
  // A zone the calendar can compute with, or "" (stored in x.tz so a Google sync can keep it). Two kinds (OW-23):
  // an IANA name the engine knows ("Europe/Warsaw", returned as it was written), and a fixed offset from UTC, which
  // may be written "UTC+3", "utc+03:00", "GMT-5:30", "+0530" and is always returned as "UTC+03:00". A fixed offset
  // has no daylight-saving time and needs nothing from the engine; "UTC+0" is the IANA zone "UTC".
  const FIXED_ZONE_MIN = -12 * 60, FIXED_ZONE_MAX = 14 * 60;
  // Minutes east of UTC for a typed offset, or null. Only the quarter hours real zones use; "utc" alone is not an offset.
  function parseZoneOffset(text) {
    const m = /^(?:(?:utc|gmt)\s*)?([+\-\u2212\u2013])\s*(\d{1,2})(?:\s*[:.h]?\s*(\d{2}))?$/i.exec(String(text ?? "").trim());
    if (!m) return null;
    const hours = Number(m[2]), minutes = m[3] === undefined ? 0 : Number(m[3]);
    if (hours > 14 || ![0, 15, 30, 45].includes(minutes)) return null;
    const total = (m[1] === "+" ? 1 : -1) * (hours * 60 + minutes);
    return total < FIXED_ZONE_MIN || total > FIXED_ZONE_MAX ? null : total || 0;
  }
  // "UTC+03:00" / "UTC-05:30" for whole minutes east of UTC ("UTC" for none), "" outside -12:00..+14:00.
  function fixedZoneId(minutes) {
    if (!Number.isInteger(minutes) || minutes < FIXED_ZONE_MIN || minutes > FIXED_ZONE_MAX) return "";
    if (!minutes) return "UTC";
    const abs = Math.abs(minutes);
    return "UTC" + (minutes < 0 ? "-" : "+") + p2(Math.floor(abs / 60)) + ":" + p2(abs % 60);
  }
  // Minutes east of UTC of a zone in the stored form of a fixed offset, null for every other zone (IANA names, "").
  function zoneFixedOffset(zone) {
    const m = typeof zone === "string" && zone.length === 9 ? /^UTC([+-])(\d{2}):(\d{2})$/.exec(zone) : null;
    return m ? (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3])) : null;
  }
  // Asking the engine whether it knows a name builds a formatter; the answer for a name never changes.
  const ZONE_NAMES = new Map(), ZONE_FORMATTERS = new Map(), ZONE_CACHE_MAX = 600;
  function cleanZone(name) {
    const t = String(name || "").trim();
    if (!t) return "";
    const known = ZONE_NAMES.get(t);
    if (known !== undefined) return known;
    const offset = parseZoneOffset(t);
    let clean = "";
    if (offset !== null) clean = fixedZoneId(offset);
    else { try { new Intl.DateTimeFormat("en", { timeZone: t }); clean = t; } catch (_) { clean = ""; } }
    if (ZONE_NAMES.size >= ZONE_CACHE_MAX) ZONE_NAMES.clear();
    ZONE_NAMES.set(t, clean);
    return clean;
  }
  // One formatter per IANA zone (building one costs far more than using it). Never for the computer's own zone:
  // that one can change while the program runs.
  function zoneFormatter(zone) {
    let formatter = ZONE_FORMATTERS.get(zone);
    if (formatter) return formatter;
    try { formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); }
    catch (_) { return null; }
    if (ZONE_FORMATTERS.size >= ZONE_CACHE_MAX) ZONE_FORMATTERS.clear();
    ZONE_FORMATTERS.set(zone, formatter);
    return formatter;
  }
  function zoneParts(ms, zone = "") {
    const z = cleanZone(zone), date = new Date(Number(ms));
    if (!Number.isFinite(date.getTime())) return null;
    const fixed = zoneFixedOffset(z);
    if (fixed !== null) {
      const wall = new Date(date.getTime() + fixed * MIN);
      if (!Number.isFinite(wall.getTime())) return null;
      return { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate(), hour: wall.getUTCHours(), minute: wall.getUTCMinutes(), second: wall.getUTCSeconds() };
    }
    try {
      const formatter = z ? zoneFormatter(z) : new Intl.DateTimeFormat("en-US", { calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
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
    if (!zone) {
      // The computer's own zone. The minute on the clock, not the minutes since midnight: the two differ on the days
      // the clocks change (23 or 25 hours long), and counting from midnight put everything after the change one hour
      // too early or too late in a grid whose labels, drags and working hours are all clock times.
      const t = Number(ms), first = date.getTime();
      if (t < first) return 0;
      if (t >= addDays(first, 1)) return 1440;
      const d = new Date(t);
      return d.getHours() * 60 + d.getMinutes() + (d.getSeconds() * 1000 + d.getMilliseconds()) / MIN;
    }
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
  // ---- Real 23/24/25-hour DST time-grid model (T2.4c4) ------------------------------------------------
  function shortZoneOffset(offsetMin) {
    if (!Number.isFinite(offsetMin)) return "";
    if (offsetMin === 0) return "UTC";
    const sign = offsetMin > 0 ? "+" : "-";
    const abs = Math.abs(Math.round(offsetMin));
    const h = Math.floor(abs / 60), m = abs % 60;
    return sign + h + (m ? ":" + p2(m) : "");
  }
  // Real elapsed hour slots for one civil day in `zone` (23 on spring-forward, 24 normal, 25 on fall-back).
  function dayTimelineHours(dateKey, zone = "") {
    const bounds = zonedDayBounds(dateKey, zone);
    if (!bounds) return null;
    const [d0, d1] = bounds;
    const validZone = zone ? cleanZone(zone) : "";
    const hours = [];
    const seenCounts = new Map();
    let t = d0;
    let cursorMin = 0;
    const HOUR_MS = 60 * MIN;
    while (t < d1 && hours.length < 48) {
      const off0 = zoneOffsetAt(validZone, t);
      let stepMs = Math.min(HOUR_MS, d1 - t);
      if (stepMs === HOUR_MS) {
        const midOff = zoneOffsetAt(validZone, t + 30 * MIN);
        if (midOff !== off0) stepMs = 30 * MIN;
      }
      const parts = zoneParts(t, validZone);
      const hour = parts ? parts.hour : new Date(t).getHours();
      const minute = parts ? parts.minute : new Date(t).getMinutes();
      const key = hour * 60 + minute;
      const count = (seenCounts.get(key) || 0) + 1;
      seenCounts.set(key, count);
      const durationMin = Math.round(stepMs / MIN);
      hours.push({
        index: hours.length,
        startMs: t,
        endMs: t + stepMs,
        gridStartMin: cursorMin,
        gridEndMin: cursorMin + durationMin,
        durationMin,
        hour,
        minute,
        clock: p2(hour) + ":" + p2(minute),
        offsetMin: off0,
        offsetText: zoneOffsetText(off0),
        offsetShort: shortZoneOffset(off0),
        repeated: 0,
        transition: "",
        skippedBefore: [],
      });
      t += stepMs;
      cursorMin += durationMin;
    }
    const repeatedHours = [];
    const presentHours = new Set();
    for (const slot of hours) {
      presentHours.add(slot.hour);
      const key = slot.hour * 60 + slot.minute;
      if ((seenCounts.get(key) || 0) > 1) {
        const prior = hours.filter((s) => s.index < slot.index && s.hour === slot.hour && s.minute === slot.minute).length;
        slot.repeated = prior + 1;
        slot.transition = slot.repeated === 1 ? "fall-first" : "fall-second";
        if (!repeatedHours.includes(slot.hour)) repeatedHours.push(slot.hour);
      }
    }
    const skippedHours = [];
    for (let h = 0; h < 24; h++) if (!presentHours.has(h)) skippedHours.push(h);
    if (skippedHours.length) {
      for (const slot of hours) {
        const prevHour = slot.index > 0 ? hours[slot.index - 1].hour : -1;
        const missing = skippedHours.filter((h) => h > prevHour && h < slot.hour);
        if (missing.length) {
          slot.transition = "spring-after";
          slot.skippedBefore = missing;
        }
      }
    }
    const totalMinutes = cursorMin;
    const kind = totalMinutes < 1440 ? "spring" : totalMinutes > 1440 ? "fall" : "normal";
    return { dateKey, zone: validZone, startMs: d0, endMs: d1, totalMinutes, kind, hours, skippedHours, repeatedHours };
  }
  // Shared Y-axis row sequence across one day (Day view: 23/24/25 real rows) or multiple days (Week view:
  // aligns identical civil hours across columns while giving repeated fall-back hours two real rows and marking
  // skipped spring-forward hours on the transition column).
  function buildGridTimeline(days = [], zone = "") {
    const validZone = zone ? cleanZone(zone) : "";
    const keys = (Array.isArray(days) ? days : [])
      .map((d) => (typeof d === "string" ? d : localDateKey(d)))
      .filter((k) => !!parseYmd(k));
    const dayTimelines = new Map();
    for (const key of keys) dayTimelines.set(key, dayTimelineHours(key, validZone));
    const slots = [];
    const skippedHours = [];
    const repeatedHours = [];
    let cursorMin = 0;
    for (let h = 0; h < 24; h++) {
      let maxPasses = 0;
      let samplePasses = null;
      for (const dt of dayTimelines.values()) {
        if (!dt) continue;
        const matches = dt.hours.filter((s) => s.hour === h && s.minute === 0);
        if (matches.length > maxPasses) {
          maxPasses = matches.length;
          samplePasses = matches;
        }
      }
      if (maxPasses === 0) {
        skippedHours.push(h);
        continue;
      }
      if (maxPasses === 1) {
        const sample = samplePasses[0];
        slots.push({
          index: slots.length,
          hour: h,
          minute: 0,
          pass: 0,
          repeated: 0,
          clock: p2(h) + ":00",
          offsetMin: sample.offsetMin,
          offsetText: sample.offsetText,
          offsetShort: sample.offsetShort,
          gridStartMin: cursorMin,
          gridEndMin: cursorMin + 60,
          durationMin: 60,
          transition: "",
          springBefore: [],
        });
        cursorMin += 60;
      } else {
        repeatedHours.push(h);
        for (let p = 0; p < maxPasses; p++) {
          const sample = samplePasses[p] || samplePasses[samplePasses.length - 1];
          slots.push({
            index: slots.length,
            hour: h,
            minute: 0,
            pass: p + 1,
            repeated: p + 1,
            clock: p2(h) + ":00",
            offsetMin: sample.offsetMin,
            offsetText: sample.offsetText,
            offsetShort: sample.offsetShort,
            gridStartMin: cursorMin,
            gridEndMin: cursorMin + 60,
            durationMin: 60,
            transition: p === 0 ? "fall-first" : "fall-second",
            springBefore: [],
          });
          cursorMin += 60;
        }
      }
    }
    if (skippedHours.length) {
      for (const slot of slots) {
        const prevHour = slot.index > 0 ? slots[slot.index - 1].hour : -1;
        const missing = skippedHours.filter((h) => h > prevHour && h < slot.hour);
        if (missing.length) {
          slot.transition = slot.transition || "spring-after";
          slot.springBefore = missing;
        }
      }
    }
    const dayGaps = new Map();
    for (const [key, dt] of dayTimelines) {
      const gaps = [];
      if (dt) {
        for (const slot of slots) {
          const dayMatches = dt.hours.filter((s) => s.hour === slot.hour);
          if (!dayMatches.length) {
            gaps.push({ kind: "skipped", gridStartMin: slot.gridStartMin, gridEndMin: slot.gridEndMin, hour: slot.hour, clock: slot.clock, label: `${slot.clock} skipped (DST)` });
          } else if (slot.pass > 1 && dayMatches.length < slot.pass) {
            gaps.push({ kind: "spacer", gridStartMin: slot.gridStartMin, gridEndMin: slot.gridEndMin, hour: slot.hour, clock: slot.clock, label: `Extra DST hour (${slot.clock} ${slot.offsetText})` });
          }
        }
      }
      dayGaps.set(key, gaps);
    }
    return { zone: validZone, days: keys, slots, totalMinutes: cursorMin || 1440, skippedHours, repeatedHours, dayTimelines, dayGaps };
  }
  function timelineMinuteOfMs(ms, dateKey, timeline, zone = "") {
    if (!timeline || !Array.isArray(timeline.slots) || !timeline.slots.length) return zonedMinuteOfDay(ms, dateKey, zone);
    const dt = timeline.dayTimelines?.get(dateKey) || dayTimelineHours(dateKey, zone);
    if (!dt) return zonedMinuteOfDay(ms, dateKey, zone);
    const t = Number(ms);
    if (!Number.isFinite(t)) return NaN;
    if (t <= dt.startMs) return 0;
    if (t >= dt.endMs) return timeline.totalMinutes;
    const daySlot = dt.hours.find((s) => t >= s.startMs && t < s.endMs) || dt.hours[dt.hours.length - 1];
    if (!daySlot) return zonedMinuteOfDay(t, dateKey, zone);
    const desiredPass = daySlot.repeated > 0 ? daySlot.repeated : 1;
    const gridSlot = timeline.slots.find((s) => s.hour === daySlot.hour && (s.pass === 0 || s.pass === desiredPass))
      || timeline.slots.find((s) => s.hour === daySlot.hour);
    if (!gridSlot) return zonedMinuteOfDay(t, dateKey, zone);
    const offsetInHour = (t - daySlot.startMs) / MIN + daySlot.minute;
    return gridSlot.gridStartMin + Math.max(0, Math.min(gridSlot.durationMin, offsetInHour));
  }
  function timelineCivilToGridMin(timeline, civilMin) {
    const m = Number(civilMin);
    if (!Number.isFinite(m) || m <= 0) return 0;
    if (!timeline || !Array.isArray(timeline.slots) || !timeline.slots.length) return Math.min(1440, m);
    if (m >= 1440) return timeline.totalMinutes;
    const h = Math.floor(m / 60), rem = m % 60;
    const exact = timeline.slots.find((s) => s.hour === h);
    if (exact) return exact.gridStartMin + rem;
    const after = timeline.slots.find((s) => s.hour > h);
    return after ? after.gridStartMin : timeline.totalMinutes;
  }
  function timelineToCivilMinute(timeline, gridMin) {
    const g = Number(gridMin);
    if (!Number.isFinite(g) || g <= 0) return 0;
    if (!timeline || !Array.isArray(timeline.slots) || !timeline.slots.length) return Math.max(0, Math.min(1440, g));
    if (g >= timeline.totalMinutes) return 1440;
    const slot = timeline.slots.find((s) => g >= s.gridStartMin && g < s.gridEndMin) || timeline.slots[timeline.slots.length - 1];
    return Math.min(1440, slot.hour * 60 + Math.max(0, Math.min(59.999, g - slot.gridStartMin)));
  }
  function timelineClockLabel(timeline, gridMin) {
    const g = Number(gridMin);
    if (!Number.isFinite(g) || g <= 0) return "00:00";
    if (!timeline || !Array.isArray(timeline.slots) || !timeline.slots.length) {
      const m = Math.floor(Math.min(1440, g));
      return p2(Math.floor(m / 60)) + ":" + p2(m % 60);
    }
    if (g >= timeline.totalMinutes) return "24:00";
    const slot = timeline.slots.find((s) => g >= s.gridStartMin && g < s.gridEndMin) || timeline.slots[timeline.slots.length - 1];
    const rem = Math.max(0, Math.min(59, Math.floor(g - slot.gridStartMin)));
    return p2(slot.hour) + ":" + p2(rem);
  }
  function timelineMsAt(dateKey, gridMin, timeline, zone = "") {
    const dt = timeline?.dayTimelines?.get(dateKey) || dayTimelineHours(dateKey, zone);
    if (!dt) return zonedDateTimeToMs(dateKey, clockOfMinutes(Math.max(0, Math.min(1439, Math.round(gridMin)))), zone);
    const g = Number(gridMin);
    if (!Number.isFinite(g)) return NaN;
    if (g <= 0) return dt.startMs;
    if (g >= timeline.totalMinutes) return dt.endMs;
    const slot = timeline.slots.find((s) => g >= s.gridStartMin && g < s.gridEndMin);
    if (!slot) return dt.endMs;
    const rem = Math.max(0, g - slot.gridStartMin);
    const matches = dt.hours.filter((s) => s.hour === slot.hour);
    if (matches.length) {
      const chosen = slot.pass > 1 ? (matches[slot.pass - 1] || matches[matches.length - 1]) : matches[0];
      return chosen.startMs + Math.round(rem) * MIN;
    }
    const nextSlot = dt.hours.find((s) => s.hour > slot.hour);
    return nextSlot ? nextSlot.startMs : dt.endMs;
  }

  // ---------- choosing a time zone (OW-23) ----------
  // The country of every zone, as area=CC:city,city|CC:...; from zone.tab of the tz database, plus the older spellings
  // some engines still list (Asia/Calcutta beside Asia/Kolkata). The engine names the country (Intl.DisplayNames).
  const ZONE_COUNTRIES = "Africa=AO:Luanda|BF:Ouagadougou|BI:Bujumbura|BJ:Porto-Novo|BW:Gaborone|CD:Kinshasa,Lubumbashi|CF:Bangui|CG:Brazzaville|CI:Abidjan|CM:Douala|DJ:Djibouti|DZ:Algiers|EG:Cairo|EH:El_Aaiun|ER:Asmara,Asmera|ES:Ceuta|ET:Addis_Ababa|GA:Libreville|GH:Accra|GM:Banjul|GN:Conakry|GQ:Malabo|GW:Bissau|KE:Nairobi|LR:Monrovia|LS:Maseru|LY:Tripoli|MA:Casablanca|ML:Bamako|MR:Nouakchott|MW:Blantyre|MZ:Maputo|NA:Windhoek|NE:Niamey|NG:Lagos|RW:Kigali|SD:Khartoum|SL:Freetown|SN:Dakar|SO:Mogadishu|SS:Juba|ST:Sao_Tome|SZ:Mbabane|TD:Ndjamena|TG:Lome|TN:Tunis|TZ:Dar_es_Salaam|UG:Kampala|ZA:Johannesburg|ZM:Lusaka|ZW:Harare;America=AG:Antigua|AI:Anguilla|AR:Argentina/Buenos_Aires,Argentina/Catamarca,Argentina/Cordoba,Argentina/Jujuy,Argentina/La_Rioja,Argentina/Mendoza,Argentina/Rio_Gallegos,Argentina/Salta,Argentina/San_Juan,Argentina/San_Luis,Argentina/Tucuman,Argentina/Ushuaia,Buenos_Aires,Catamarca,Cordoba,Jujuy,Mendoza|AW:Aruba|BB:Barbados|BL:St_Barthelemy|BO:La_Paz|BQ:Kralendijk|BR:Araguaina,Bahia,Belem,Boa_Vista,Campo_Grande,Cuiaba,Eirunepe,Fortaleza,Maceio,Manaus,Noronha,Porto_Velho,Recife,Rio_Branco,Santarem,Sao_Paulo|BS:Nassau|BZ:Belize|CA:Atikokan,Blanc-Sablon,Cambridge_Bay,Coral_Harbour,Creston,Dawson,Dawson_Creek,Edmonton,Fort_Nelson,Glace_Bay,Goose_Bay,Halifax,Inuvik,Iqaluit,Moncton,Rankin_Inlet,Regina,Resolute,St_Johns,Swift_Current,Toronto,Vancouver,Whitehorse,Winnipeg|CL:Coyhaique,Punta_Arenas,Santiago|CO:Bogota|CR:Costa_Rica|CU:Havana|CW:Curacao|DM:Dominica|DO:Santo_Domingo|EC:Guayaquil|GD:Grenada|GF:Cayenne|GL:Danmarkshavn,Godthab,Nuuk,Scoresbysund,Thule|GP:Guadeloupe|GT:Guatemala|GY:Guyana|HN:Tegucigalpa|HT:Port-au-Prince|JM:Jamaica|KN:St_Kitts|KY:Cayman|LC:St_Lucia|MF:Marigot|MQ:Martinique|MS:Montserrat|MX:Bahia_Banderas,Cancun,Chihuahua,Ciudad_Juarez,Hermosillo,Matamoros,Mazatlan,Merida,Mexico_City,Monterrey,Ojinaga,Tijuana|NI:Managua|PA:Panama|PE:Lima|PM:Miquelon|PR:Puerto_Rico|PY:Asuncion|SR:Paramaribo|SV:El_Salvador|SX:Lower_Princes|TC:Grand_Turk|TT:Port_of_Spain|US:Adak,Anchorage,Boise,Chicago,Denver,Detroit,Indiana/Indianapolis,Indiana/Knox,Indiana/Marengo,Indiana/Petersburg,Indiana/Tell_City,Indiana/Vevay,Indiana/Vincennes,Indiana/Winamac,Indianapolis,Juneau,Kentucky/Louisville,Kentucky/Monticello,Los_Angeles,Louisville,Menominee,Metlakatla,New_York,Nome,North_Dakota/Beulah,North_Dakota/Center,North_Dakota/New_Salem,Phoenix,Sitka,Yakutat|UY:Montevideo|VC:St_Vincent|VE:Caracas|VG:Tortola|VI:St_Thomas;Antarctica=AQ:Casey,Davis,DumontDUrville,Mawson,McMurdo,Palmer,Rothera,Syowa,Troll,Vostok|AU:Macquarie;Arctic=SJ:Longyearbyen;Asia=AE:Dubai|AF:Kabul|AM:Yerevan|AZ:Baku|BD:Dhaka|BH:Bahrain|BN:Brunei|BT:Thimphu|CN:Shanghai,Urumqi|CY:Famagusta,Nicosia|GE:Tbilisi|HK:Hong_Kong|ID:Jakarta,Jayapura,Makassar,Pontianak|IL:Jerusalem|IN:Calcutta,Kolkata|IQ:Baghdad|IR:Tehran|JO:Amman|JP:Tokyo|KG:Bishkek|KH:Phnom_Penh|KP:Pyongyang|KR:Seoul|KW:Kuwait|KZ:Almaty,Aqtau,Aqtobe,Atyrau,Oral,Qostanay,Qyzylorda|LA:Vientiane|LB:Beirut|LK:Colombo|MM:Rangoon,Yangon|MN:Hovd,Ulaanbaatar|MO:Macau|MY:Kuala_Lumpur,Kuching|NP:Kathmandu,Katmandu|OM:Muscat|PH:Manila|PK:Karachi|PS:Gaza,Hebron|QA:Qatar|RU:Anadyr,Barnaul,Chita,Irkutsk,Kamchatka,Khandyga,Krasnoyarsk,Magadan,Novokuznetsk,Novosibirsk,Omsk,Sakhalin,Srednekolymsk,Tomsk,Ust-Nera,Vladivostok,Yakutsk,Yekaterinburg|SA:Riyadh|SG:Singapore|SY:Damascus|TH:Bangkok|TJ:Dushanbe|TL:Dili|TM:Ashgabat|TW:Taipei|UZ:Samarkand,Tashkent|VN:Ho_Chi_Minh,Saigon|YE:Aden;Atlantic=BM:Bermuda|CV:Cape_Verde|ES:Canary|FK:Stanley|FO:Faeroe,Faroe|GS:South_Georgia|IS:Reykjavik|PT:Azores,Madeira|SH:St_Helena;Australia=AU:Adelaide,Brisbane,Broken_Hill,Darwin,Eucla,Hobart,Lindeman,Lord_Howe,Melbourne,Perth,Sydney;Europe=AD:Andorra|AL:Tirane|AT:Vienna|AX:Mariehamn|BA:Sarajevo|BE:Brussels|BG:Sofia|BY:Minsk|CH:Zurich|CZ:Prague|DE:Berlin,Busingen|DK:Copenhagen|EE:Tallinn|ES:Madrid|FI:Helsinki|FR:Paris|GB:London|GG:Guernsey|GI:Gibraltar|GR:Athens|HR:Zagreb|HU:Budapest|IE:Dublin|IM:Isle_of_Man|IT:Rome|JE:Jersey|LI:Vaduz|LT:Vilnius|LU:Luxembourg|LV:Riga|MC:Monaco|MD:Chisinau|ME:Podgorica|MK:Skopje|MT:Malta|NL:Amsterdam|NO:Oslo|PL:Warsaw|PT:Lisbon|RO:Bucharest|RS:Belgrade|RU:Astrakhan,Kaliningrad,Kirov,Moscow,Samara,Saratov,Ulyanovsk,Volgograd|SE:Stockholm|SI:Ljubljana|SK:Bratislava|SM:San_Marino|TR:Istanbul|UA:Kiev,Kyiv,Simferopol|VA:Vatican;Indian=CC:Cocos|CX:Christmas|IO:Chagos|KM:Comoro|MG:Antananarivo|MU:Mauritius|MV:Maldives|RE:Reunion|SC:Mahe|TF:Kerguelen|YT:Mayotte;Pacific=AS:Pago_Pago|CK:Rarotonga|CL:Easter|EC:Galapagos|FJ:Fiji|FM:Chuuk,Kosrae,Pohnpei,Ponape,Truk|GU:Guam|KI:Enderbury,Kanton,Kiritimati,Tarawa|MH:Kwajalein,Majuro|MP:Saipan|NC:Noumea|NF:Norfolk|NR:Nauru|NU:Niue|NZ:Auckland,Chatham|PF:Gambier,Marquesas,Tahiti|PG:Bougainville,Port_Moresby|PN:Pitcairn|PW:Palau|SB:Guadalcanal|TK:Fakaofo|TO:Tongatapu|TV:Funafuti|UM:Midway,Wake|US:Honolulu|VU:Efate|WF:Wallis|WS:Apia";
  // Abbreviations people type. The engine gives them for a few zones per language only (CET in en-GB, EST in en-US),
  // so they are taken from its English long name ("Central European Summer Time"): name without its ending:standard/daylight.
  const ZONE_ABBREVIATIONS = "Central European:CET/CEST|Eastern European:EET/EEST|Western European:WET/WEST|Greenwich Mean:GMT|British:/BST|Irish:IST|Moscow:MSK|East Africa:EAT|Central Africa:CAT|West Africa:WAT|South Africa:SAST|Eastern:EST/EDT|Central:CST/CDT|Mountain:MST/MDT|Pacific:PST/PDT|Alaska:AKST/AKDT|Hawaii-Aleutian:HST/HDT|Atlantic:AST/ADT|Newfoundland:NST/NDT|Cuba:CST/CDT|India:IST|Pakistan:PKT|Israel:IST/IDT|Japan:JST|Korean:KST|China:CST|Hong Kong:HKT|Singapore:SGT|Indochina:ICT|Western Indonesia:WIB|Central Indonesia:WITA|Eastern Indonesia:WIT|Australian Eastern:AEST/AEDT|Australian Central:ACST/ACDT|Australian Western:AWST|New Zealand:NZST/NZDT|Chamorro:ChST|Brasilia:BRT|Argentina:ART|Gulf:GST|Coordinated Universal:UTC";
  // The fixed offsets the picker lists: every whole hour from -12 to +14 and the half and three-quarter hours in use.
  const FIXED_ZONE_CHOICES = Object.freeze([-720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 840]);
  // Cities the tz database renamed: both spellings are found, the newer one is shown whichever the engine lists.
  const ZONE_CITY_NAMES = "Calcutta=Kolkata|Kiev=Kyiv|Saigon=Ho Chi Minh|Katmandu=Kathmandu|Rangoon=Yangon|Godthab=Nuuk|Faeroe=Faroe|Asmera=Asmara";
  const ZONE_RECENT_MAX = 6;
  let zoneCountryIndex = null, zoneAbbreviationIndex = null, zoneCityIndex = null, zoneChoiceMemo = null;
  function zoneCountryCode(id) {
    if (!zoneCountryIndex) {
      zoneCountryIndex = new Map();
      for (const part of ZONE_COUNTRIES.split(";")) {
        const cut = part.indexOf("="), area = part.slice(0, cut);
        for (const entry of part.slice(cut + 1).split("|")) for (const city of entry.slice(3).split(",")) zoneCountryIndex.set(area + "/" + city, entry.slice(0, 2));
      }
    }
    return zoneCountryIndex.get(String(id)) || "";
  }
  function zoneAbbreviation(longName) {
    if (!zoneAbbreviationIndex) {
      zoneAbbreviationIndex = new Map();
      for (const entry of ZONE_ABBREVIATIONS.split("|")) { const [name, pair] = entry.split(":"), [standard, daylight = ""] = pair.split("/"); zoneAbbreviationIndex.set(name, [standard, daylight]); }
    }
    const text = String(longName || ""), daylight = /(?:Summer|Daylight) Time$/.test(text);
    const found = zoneAbbreviationIndex.get(text.replace(/ (?:Standard|Summer|Daylight) Time$| Time$/, ""));
    // [the one in force, the one of the other half of the year] ("cest" finds Berlin in winter too).
    return found ? [found[daylight ? 1 : 0] || "", found[daylight ? 0 : 1] || ""] : ["", ""];
  }
  // [name shown, other spelling] of a city as the zone id writes it.
  function zoneCityName(city) {
    if (!zoneCityIndex) {
      zoneCityIndex = new Map();
      for (const entry of ZONE_CITY_NAMES.split("|")) { const [old, current] = entry.split("="); zoneCityIndex.set(old, [current, old]); zoneCityIndex.set(current, [current, old]); }
    }
    return zoneCityIndex.get(city) || [city, ""];
  }
  // "UTC+01:00" for minutes east of UTC (any whole minutes; this is text for people, not a zone id).
  function zoneOffsetText(minutes) {
    if (!Number.isFinite(minutes)) return "";
    const abs = Math.abs(Math.round(minutes));
    return "UTC" + (minutes < 0 ? "-" : "+") + p2(Math.floor(abs / 60)) + ":" + p2(abs % 60);
  }
  // Minutes east of UTC that a zone is at an instant ("" = the computer's zone), NaN for an unknown zone.
  function zoneOffsetAt(zone, at) {
    const ms = Number(at);
    if (!Number.isFinite(ms)) return NaN;
    if (!zone) return -new Date(ms).getTimezoneOffset();
    const valid = cleanZone(zone);
    if (!valid) return NaN;
    const fixed = zoneFixedOffset(valid);
    if (fixed !== null) return fixed;
    const parts = zoneParts(ms, valid);
    if (!parts) return NaN;
    return Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000) / MIN);
  }
  // Lower case, no accents, no punctuation: what is typed is compared with this form of every name.
  function zoneSearchText(text) {
    return String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0142/g, "l").replace(/\u0141/g, "L").toLowerCase()
      .replace(/\u2212|\u2013/g, "-").replace(/[_/,;()]+/g, " ").replace(/\s+/g, " ").trim();
  }
  // The offset and the English long name of an IANA zone at an instant, from ONE formatter (building a formatter
  // is what costs: about a tenth of a millisecond, and the picker asks for some 420 zones). null = unknown zone.
  function zoneFacts(id, at) {
    try {
      const parts = Object.create(null);
      for (const part of new Intl.DateTimeFormat("en-US", { timeZone: id, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "long" }).formatToParts(new Date(at))) {
        if (part.type === "timeZoneName") parts.long = part.value;
        else if (part.type !== "literal") parts[part.type] = Number(part.value);
      }
      if (![parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second].every(Number.isFinite)) return null;
      const long = /^(?:GMT|UTC)[+\-\u2212]/.test(parts.long || "") ? "" : parts.long || "";
      return { long, offsetMin: Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(at / 1000) * 1000) / MIN) };
    } catch (_) { return null; }
  }
  const zoneOffsetShort = (offset) => offset.replace(/^UTC([+-])0?(\d+):(\d\d)$/, (_, sign, hours, minutes) => sign + hours + (minutes === "00" ? "" : ":" + minutes));
  function fixedZoneChoice(id) {
    const utc = id === "UTC", offsetMin = utc ? 0 : zoneFixedOffset(id), offset = zoneOffsetText(offsetMin), short = zoneOffsetShort(offset);
    return Object.freeze({ id, kind: "offset", city: "", area: "", sub: "", countryCode: "", country: "", offsetMin, offset, abbr: utc ? "UTC" : "", name: utc ? "Coordinated Universal Time" : "Fixed offset, no daylight-saving time",
      label: utc ? "UTC" : offset, detail: utc ? "UTC+00:00 · Coordinated Universal Time" : "Fixed offset, no daylight-saving time", cityKey: "", countryKey: "", abbrKey: utc ? "utc" : "",
      search: zoneSearchText([id, offset, "utc" + short, "gmt" + short, short, utc ? "gmt z zulu coordinated universal greenwich" : "", "fixed offset"].join(" ")) });
  }
  function namedZoneChoice(id, facts, names) {
    const cut = id.indexOf("/"), area = cut > 0 ? id.slice(0, cut) : "", rest = (cut > 0 ? id.slice(cut + 1) : id).split("/");
    const [city, otherCity] = zoneCityName(rest.pop().replace(/_/g, " ")), sub = rest.join(" ").replace(/_/g, " ");
    const countryCode = zoneCountryCode(id), country = String(names?.country || ""), countryLocal = String(names?.countryLocal || "");
    const [abbr, otherAbbr] = zoneAbbreviation(facts.long), offset = zoneOffsetText(facts.offsetMin), short = zoneOffsetShort(offset);
    return Object.freeze({ id, kind: "zone", city, area, sub, countryCode, country, offsetMin: facts.offsetMin, offset, abbr, name: facts.long,
      label: city + (country ? ", " + country : sub ? ", " + sub : ""), detail: [offset, abbr, facts.long].filter(Boolean).join(" · "),
      cityKey: zoneSearchText(city), countryKey: zoneSearchText(country), abbrKey: zoneSearchText(abbr),
      search: zoneSearchText([city, otherCity, country, countryLocal, countryCode, sub, area, abbr, otherAbbr, facts.long, id, offset, "utc" + short, "gmt" + short, short].join(" ")) });
  }
  // One entry of the picker for any zone cleanZone accepts (null otherwise), also one the list does not hold
  // (a stored "Asia/Kolkata" where the engine lists Asia/Calcutta, "UTC+08:15").
  function zoneChoice(zone, now) {
    const id = cleanZone(zone), at = Number(now);
    if (!id || !Number.isFinite(at)) return null;
    if (id === "UTC" || zoneFixedOffset(id) !== null) return fixedZoneChoice(id);
    const facts = zoneFacts(id, at);
    if (!facts) return null;
    const code = zoneCountryCode(id);
    let country = code;
    try { country = new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (_) {}
    return namedZoneChoice(id, facts, { country: code ? country : "" });
  }
  // Every zone the picker offers at `now`: the IANA zones the engine lists (city, country, the offset in force at
  // that instant, abbreviation) sorted by city, then the fixed offsets from UTC-12:00 to UTC+14:00.
  // opts: { zones: ids instead of the engine's list, locale: a second language for country names (search only) }.
  function zoneChoices(now, opts = {}) {
    const at = Number(now);
    if (!Number.isFinite(at)) return [];
    const custom = Array.isArray(opts.zones), locale = typeof opts.locale === "string" ? opts.locale : "";
    // Offsets and names change on quarter hours only, so one list serves until the next one.
    const stamp = Math.floor(at / (15 * MIN)) + "|" + locale;
    if (!custom && zoneChoiceMemo?.stamp === stamp) return zoneChoiceMemo.list.slice();
    let ids = custom ? opts.zones : null;
    if (!ids) { try { ids = Intl.supportedValuesOf("timeZone"); } catch (_) { ids = null; } }
    if (!ids || !ids.length) { zoneCountryCode(""); ids = [...zoneCountryIndex.keys()]; }
    const regionNames = (language) => { try { return new Intl.DisplayNames([language], { type: "region" }); } catch (_) { return null; } };
    const english = regionNames("en"), local = locale && !/^en\b/i.test(locale) ? regionNames(locale) : null;
    const nameOf = (names, code) => { try { const name = names && code ? names.of(code) : ""; return name && name !== code ? name : ""; } catch (_) { return ""; } };
    const seen = new Set(), zones = [];
    for (const raw of ids) {
      const id = String(raw || "");
      // Names without an area (UTC, GMT, EST, CET) and the Etc/ zones are offered as fixed offsets instead.
      if (!id.includes("/") || /^Etc\//i.test(id) || seen.has(id)) continue;
      seen.add(id);
      const facts = zoneFacts(id, at);
      if (!facts) continue;
      const code = zoneCountryCode(id);
      zones.push(namedZoneChoice(id, facts, { country: nameOf(english, code) || code, countryLocal: nameOf(local, code) }));
    }
    zones.sort((a, b) => (a.cityKey < b.cityKey ? -1 : a.cityKey > b.cityKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const list = zones.concat(FIXED_ZONE_CHOICES.map((minutes) => fixedZoneChoice(fixedZoneId(minutes))));
    if (!custom) zoneChoiceMemo = { stamp, list };
    return list.slice();
  }
  // The choices that match what was typed, best first: an offset ("+3", "utc+3", "gmt-5:30") gives that fixed offset
  // and then the zones at it now; words are looked for in city, country, abbreviation, zone name and id, and every
  // word must be found ("new york", "poland", "cet", "america los"). Nothing typed = no result (the picker shows its groups).
  function searchZones(choices, query, limit = 40) {
    const list = Array.isArray(choices) ? choices.filter((choice) => choice && typeof choice.id === "string" && typeof choice.search === "string") : [];
    const text = zoneSearchText(query), max = Number.isInteger(limit) && limit > 0 ? limit : 40;
    if (!text) return [];
    const typedOffset = parseZoneOffset(text);
    if (typedOffset !== null) {
      const id = fixedZoneId(typedOffset), exact = list.find((choice) => choice.id === id) || fixedZoneChoice(id);
      return [exact].concat(list.filter((choice) => choice.kind === "zone" && choice.offsetMin === typedOffset)).slice(0, max);
    }
    const words = text.split(" ");
    const scoreWord = (choice, word) => {
      if (choice.abbrKey && choice.abbrKey === word) return 100;
      if (choice.cityKey === word) return 96;
      if (choice.cityKey.startsWith(word)) return 90;
      if (choice.cityKey.includes(" " + word)) return 82;
      if (choice.countryKey === word) return 76;
      if (choice.countryKey.startsWith(word)) return 70;
      if (choice.countryKey.includes(" " + word)) return 62;
      const at = choice.search.indexOf(word);
      if (at < 0) return 0;
      for (let i = at; i >= 0; i = choice.search.indexOf(word, i + 1)) {
        if (i && choice.search[i - 1] !== " ") continue;
        const end = i + word.length;
        return end === choice.search.length || choice.search[end] === " " ? 50 : 40;
      }
      return word.length >= 3 ? 10 : 0;
    };
    const found = [];
    for (const choice of list) {
      let total = 0, ok = true;
      for (const word of words) { const score = scoreWord(choice, word); if (!score) { ok = false; break; } total += score; }
      if (ok) found.push({ choice, total });
    }
    found.sort((a, b) => b.total - a.total || (a.choice.label < b.choice.label ? -1 : a.choice.label > b.choice.label ? 1 : 0));
    return found.slice(0, max).map((entry) => entry.choice);
  }
  // The zone a typed text stands for: "" for nothing typed (the computer's zone); the id of an offset, of a zone
  // named by its id, or of the one zone the text clearly means (a city, a country with one zone); null when the text
  // is no zone or fits several ("cet", "united states"), so nothing is stored that the person did not choose.
  function resolveZoneText(choices, text) {
    const raw = String(text ?? "").trim();
    if (!raw) return "";
    const offset = parseZoneOffset(raw);
    if (offset !== null) return fixedZoneId(offset);
    const list = Array.isArray(choices) ? choices : [], lower = raw.toLowerCase();
    const named = list.find((choice) => choice && typeof choice.id === "string" && choice.id.toLowerCase() === lower);
    if (named) return named.id;
    // An id the list does not hold: another spelling ("Asia/Kolkata"), "Etc/GMT-3", "US/Pacific". Kept as written.
    if (raw.includes("/") && cleanZone(raw)) return zoneIdCase(raw);
    const word = zoneSearchText(raw), found = searchZones(list, raw, list.length || 1);
    const exact = found.filter((choice) => choice.cityKey === word || zoneSearchText(choice.label) === word);
    if (exact.length === 1) return exact[0].id;
    // "india" is also the beginning of Indiana and of the Indian Ocean; the country of that name has one zone.
    const land = exact.length ? [] : found.filter((choice) => choice.countryKey === word);
    if (land.length === 1) return land[0].id;
    return found.length === 1 ? found[0].id : null;
  }
  // A zone id in the letter case of the tz database ("asia/kolkata" -> "Asia/Kolkata") where the engine or the
  // country table knows it, otherwise as written. The engine takes any case, and what is stored is shown.
  function zoneIdCase(id) {
    const lower = id.toLowerCase();
    try {
      // Newer engines answer with the id they were given, older ones with the main id of the zone (Asia/Calcutta).
      const resolved = new Intl.DateTimeFormat("en", { timeZone: id }).resolvedOptions().timeZone;
      if (typeof resolved === "string" && resolved.toLowerCase() === lower) return resolved;
    } catch (_) {}
    zoneCountryCode("");
    for (const known of zoneCountryIndex.keys()) if (known.toLowerCase() === lower) return known;
    return id;
  }
  // The zones chosen lately, newest first, as stored: valid ids only, each once, at most six.
  function cleanRecentZones(value, add = "") {
    const out = [];
    for (const raw of [add].concat(Array.isArray(value) ? value : [])) {
      const id = cleanZone(raw);
      if (id && !out.includes(id)) out.push(id);
      if (out.length >= ZONE_RECENT_MAX) break;
    }
    return out;
  }
  // What the picker lists while nothing is typed: the computer's zone, the zones chosen lately, the fixed offsets,
  // then every zone by part of the world. opts: { system: zone id of the computer, recent: ids, now }.
  function zoneGroups(choices, opts = {}) {
    const list = Array.isArray(choices) ? choices.filter((choice) => choice && typeof choice.id === "string") : [];
    const byId = new Map(list.map((choice) => [choice.id, choice]));
    const at = Number.isFinite(Number(opts.now)) ? Number(opts.now) : 0;
    const pick = (id) => { const clean = cleanZone(id); return clean ? byId.get(clean) || zoneChoice(clean, at) : null; };
    const groups = [], system = pick(opts.system);
    if (system) groups.push({ id: "system", title: "This computer", items: [system] });
    const recent = cleanRecentZones(opts.recent).map(pick).filter((choice) => choice && choice.id !== system?.id);
    if (recent.length) groups.push({ id: "recent", title: "Chosen lately", items: recent });
    const fixed = list.filter((choice) => choice.kind === "offset");
    if (fixed.length) groups.push({ id: "offsets", title: "Fixed offset from UTC (no daylight-saving time)", items: fixed });
    const areas = new Map();
    for (const choice of list) if (choice.kind === "zone") { const key = choice.area || "Other"; if (!areas.has(key)) areas.set(key, []); areas.get(key).push(choice); }
    for (const key of [...areas.keys()].sort()) groups.push({ id: "area-" + key, title: key, items: areas.get(key) });
    return groups;
  }

  // ---------- text of a week (print / export) ----------
  // Markdown for the 7 days from `weekFrom` (local midnight): one heading per day, one line per item, reminders marked.
  function weekText(items, weekFrom, opts = {}) {
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const lines = [];
    if (opts && opts.weekNumbers === true) {
      lines.push("# Week " + weekNumber(weekFrom, opts.weekStart === undefined ? 1 : opts.weekStart), "");
    }
    const rawDays = Number(opts && opts.days);
    const dayCount = Number.isFinite(rawDays) && rawDays >= 1 ? Math.min(WEEK_DAYS_LIMITS.max, Math.max(1, Math.round(rawDays))) : 7;
    for (let i = 0; i < dayCount; i++) {
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

  // Day heat: count the live occurrences touching one local civil day and find its most common category.
  // Ties are resolved by category name, so the tint does not flicker with item order.
  function dayHeat(items, day) {
    const parsed = typeof day === "string" ? parseYmd(day) : null;
    const value = parsed ? parsed.getTime() : Number(day);
    if (!Number.isFinite(value)) return { day: 0, count: 0, level: 0, dominantCategory: "" };
    const from = dayStart(value), to = addDays(from, 1);
    const categories = new Map();
    const entries = expandRange(Array.isArray(items) ? items : [], from, to);
    for (const item of entries) {
      const name = String(item?.x?.category || "").trim();
      if (name) categories.set(name, (categories.get(name) || 0) + 1);
    }
    let dominantCategory = "", dominantCount = 0;
    for (const [name, count] of categories) {
      if (count > dominantCount || (count === dominantCount && (!dominantCategory || name < dominantCategory))) {
        dominantCategory = name;
        dominantCount = count;
      }
    }
    const count = entries.length;
    return { day: from, count, level: count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : 3, dominantCategory };
  }

  // ---------- date picker model ----------
  // What the mini-calendar draws for a month: 6 weeks of local days, item count, heat level and dominant category.
  // selected = local midnight ms or 0. A single expansion supplies all cells, including recurring occurrences.
  function pickerMonth(year, month, { weekStart = 1, now = 0, selected = 0, items = [] } = {}) {
    const ws = cleanWeekStart(weekStart);
    const today = now ? dayStart(now) : 0, sel = selected ? dayStart(selected) : 0;
    const grid = monthGrid(year, month, ws);
    const first = grid[0][0], last = addDays(grid[5][6], 1);
    const stats = new Map();
    for (const it of expandRange(Array.isArray(items) ? items : [], first, last)) {
      const [s, e] = itemRange(it);
      const category = String(it?.x?.category || "").trim();
      for (let d = Math.max(dayStart(s), first); d < Math.min(isReminder(it) ? s + 1 : e, last); d = addDays(d, 1)) {
        let stat = stats.get(d);
        if (!stat) stats.set(d, stat = { count: 0, categories: new Map() });
        stat.count++;
        if (category) stat.categories.set(category, (stat.categories.get(category) || 0) + 1);
      }
    }
    return grid.map((week) => week.map((d) => {
      const stat = stats.get(d), categories = stat?.categories || new Map();
      let dominantCategory = "", dominantCount = 0;
      for (const [name, count] of categories) {
        if (count > dominantCount || (count === dominantCount && (!dominantCategory || name < dominantCategory))) {
          dominantCategory = name;
          dominantCount = count;
        }
      }
      const count = stat?.count || 0;
      return {
        day: d, date: new Date(d).getDate(), inMonth: new Date(d).getMonth() === month,
        today: d === today, selected: d === sel, count,
        level: count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : 3,
        dominantCategory,
      };
    }));
  }
  // Month stepping for the picker arrows: { year, month } after `delta` months (works across years).
  function stepMonth(year, month, delta) {
    const d = new Date(year, month + Math.round(delta), 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }
  // Keyboard moves in the picker: arrows = 1 day / 1 week, PageUp/PageDown = 1 month, Home/End = start/end of week.
  function pickerKey(day, key, weekStart = 1) {
    const ws = cleanWeekStart(weekStart);
    const d = new Date(day);
    switch (key) {
      case "ArrowLeft": return addDays(day, -1);
      case "ArrowRight": return addDays(day, 1);
      case "ArrowUp": return addDays(day, -7);
      case "ArrowDown": return addDays(day, 7);
      case "PageUp": return new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth(), 0).getDate())).getTime();
      case "PageDown": return new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate())).getTime();
      case "Home": return addDays(day, -((d.getDay() - ws + 7) % 7));
      case "End": return addDays(day, 6 - ((d.getDay() - ws + 7) % 7));
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
  const localDateKey = (ms) => {
    if (ms && typeof ms === "object") {
      if (typeof ms.date === "string" && parseYmd(ms.date)) return ms.date;
      if (typeof ms.dateTime === "string") ms = Date.parse(ms.dateTime);
    }
    return Number.isFinite(Number(ms)) ? ymd(new Date(Number(ms))) : "";
  };
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
    const table = locale === undefined ? null : notesLanguageTable(locale);
    const specialLabels = locale === "pl" || (table && table.code !== "en" && table.code !== "pl");
    const labels = table?.agendaLabels || AGENDA_LABELS;
    if (offset >= 0 && offset < labels.length && (offset < 2 || specialLabels)) return labels[offset];
    const resolvedLocale = locale === undefined ? undefined : (LANG_REGISTRY.has(String(locale).toLowerCase()) ? notesLocaleFor(locale) : locale);
    return new Date(day).toLocaleDateString(resolvedLocale, { weekday: "short", day: "numeric", month: "short" });
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
  // Resolve the inherited layers once per source master. Expanded occurrences
  // retain the master's policy; the map is private to one reconciliation run.
  function prepareAgendaWindows(items, getWindow = null) {
    const policies = new Map();
    for (const item of items || []) if (item?.id) {
      policies.set(item.id, resolveAgendaWindow(item, null, null, getWindow ? getWindow(item) : null));
    }
    return policies;
  }
  function preparedAgendaWindow(item, getWindow, policies) {
    const key = item?.x?.series || item?.id;
    return (key && policies?.get(key)) || resolveAgendaWindow(item, null, null, getWindow ? getWindow(item) : null);
  }
  function resolvedAgendaVisibilityRange(item, policy) {
    if (!item?.start || !policy.enabled) return null;
    const start = whenMs(item.start), end = item.end ? whenMs(item.end) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    const lastVisibleItemDay = dayStart(end > start ? end - 1 : start);
    return { from: addDays(dayStart(start), -policy.leadDays), to: addDays(lastVisibleItemDay, policy.tailDays + 1) };
  }
  // Return local-midnight [from, to) boundaries. Offsets are civil days rather than
  // 24-hour durations, so spring/fall DST changes never shift the visible date.
  function agendaVisibilityRange(item, rawPolicy = {}) {
    return resolvedAgendaVisibilityRange(item, resolveAgendaWindow({ x: { agendaWindow: rawPolicy } }));
  }
  // The virtual Agenda is a rolling local-day projection. Refresh only when the next
  // day can change a visible bucket, or when a far-future window first enters its horizon.
  // Recurring series are re-evaluated daily because their next occurrence is generated
  // from the recurrence rule rather than stored as a separate item.
  function nextAgendaVisibilityBoundary(items, now, days = 4, getWindow = null, policies = null, projection = null) {
    const stamp = Number(now);
    if (!Number.isFinite(stamp)) return null;
    const today = dayStart(stamp), count = Math.max(1, Math.min(31, Math.floor(Number(days)) || 4));
    const tomorrow = addDays(today, 1), horizon = addDays(today, count);
    let next = Infinity;
    for (const item of items || []) {
      const policy = preparedAgendaWindow(item, getWindow, policies);
      if (!policy.enabled) continue;
      if (isRecurringItem(item)) { next = Math.min(next, tomorrow); continue; }
      const range = resolvedAgendaVisibilityRange(item, policy);
      if (!range || range.to <= today) continue;
      const boundary = range.from < horizon ? tomorrow : addDays(range.from, -(count - 1));
      if (boundary > stamp) next = Math.min(next, boundary);
    }
    // Projection already resolves recurrence moves, visibility policies and
    // multi-day fan-out. Reuse it in the controller; standalone callers build
    // it only when timed events exist, never for reminder-only workloads.
    if (!projection && (items || []).some((item) => item?.x && item.start && !isReminder(item) && !isAllDay(item)))
      projection = agendaZenProjection(items, stamp, count, () => false, getWindow, policies);
    const todayKey = localDateKey(today);
    for (const bucket of projection || []) if (bucket.date === todayKey) {
      for (const item of bucket.items || []) if (!item.reminder && !item.allDay && item.end > stamp && item.end <= tomorrow) next = Math.min(next, item.end);
    }
    return Number.isFinite(next) ? next : null;
  }
  function agendaBuckets(items, now, days = 4, isDone = () => false, locale = undefined) {
    const n = Math.max(1, Math.min(31, Math.floor(Number(days)) || 4));
    const base = dayStart(now);
    const out = [];
    for (let i = 0; i < n; i++) {
      const from = addDays(base, i), to = addDays(base, i + 1);
      const list = expandRange(items, from, to).filter((it) => !isDone(it));
      out.push({ offset: i, key: localDateKey(from), label: agendaDayLabel(i, from, locale), from, to, count: list.length, items: list });
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
  // Managed Agenda entries are projections, not movable user tabs/folders.
  // Reject every drop onto the managed region, including links and unknown
  // drag formats; unrelated drags elsewhere are never intercepted.
  function blockAgendaDrag({ phase, sourceManaged = false, selectedManaged = false, targetManaged = false, draggedManaged = false } = {}) {
    if (phase === "dragstart") return !!(sourceManaged || selectedManaged);
    return (phase === "dragover" || phase === "drop") && !!(targetManaged || draggedManaged);
  }
  // Projection for the virtual Zen Agenda folder. Keys are occurrence-scoped, not
  // display strings or formatted dates, so duplicate summaries remain independent.
  function agendaZenItem(item, bucketKey, now, lang = DEFAULT_NOTES_LANGUAGE) {
    const clock = (ms) => { const d = new Date(ms); return p2(d.getHours()) + ":" + p2(d.getMinutes()); };
    const [start, end] = itemRange(item);
    const summary = String(item.summary || "Untitled").replace(/[\r\n]+/g, " ").trim();
    const label = isAllDay(item) ? "All day · " + summary : (isReminder(item) ? clock(start) : clock(start) + "–" + clock(end)) + "  " + summary;
    const identity = reminderIdentity(item) || { itemId: item.id, occurrenceId: String(item.x?.recurrenceId || item.id), noteId: item.x?.noteId || "" };
    const sourceLine = item.x?.sourceNoteTrashed
      ? (item.x?.sourceNoteTrashedTitle
        ? t("hover.sourceInTrashNamed", { title: item.x.sourceNoteTrashedTitle }, lang)
        : t("hover.sourceInTrash", null, lang))
      : (item.x?.sourceNoteTitle ? "Source note: " + item.x.sourceNoteTitle : "");
    const details = [item.description, item.x?.calNote, sourceLine, item.x?.heading ? "Heading: " + item.x.heading : "", item.x?.category ? "Category: " + item.x.category : "", item.x?.tz ? "Time zone: " + item.x.tz : ""].filter(Boolean).join("\n");
    return {
      key: "item:" + identity.itemId + ":" + identity.occurrenceId + "@" + bucketKey,
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
      sourceNoteTrashed: !!item.x?.sourceNoteTrashed,
      color: String(item.x?.color || resolveItemColor(item.x?.noteColor || "", item.x?.categoryColor || "") || ""),
      ended: !isReminder(item) && end > start && end <= Number(now),
    };
  }
  function agendaZenProjection(items, now, days = 4, isDone = () => false, getWindow = null, policies = null, options = {}) {
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
    const fastDefault = policies ? sourceItems.every((item) => { const p = preparedAgendaWindow(item, getWindow, policies); return p.enabled && !p.leadDays && !p.tailDays; }) : !getWindow && !hasItemPolicy;
    let maxLead = 0, maxTail = 0;
    if (!fastDefault) for (const source of sourceItems) {
      const policy = preparedAgendaWindow(source, getWindow, policies);
      if (!policy.enabled) continue;
      maxLead = Math.max(maxLead, policy.leadDays);
      maxTail = Math.max(maxTail, policy.tailDays);
    }
    const candidateFrom = fastDefault ? base : addDays(base, -maxTail);
    const candidateTo = fastDefault ? windowEnd : addDays(windowEnd, maxLead);
    const buckets = Array.from({ length: n }, (_, offset) => {
      const from = addDays(base, offset), to = addDays(base, offset + 1);
      return { offset, key: localDateKey(from), label: agendaDayLabel(offset, from, options?.lang), from, to, count: 0, items: [] };
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
        const policy = preparedAgendaWindow(item, getWindow, policies);
        if (!policy.enabled) continue;
        const visible = resolvedAgendaVisibilityRange(item, policy);
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
      items: bucket.items.map((item) => agendaZenItem(item, bucket.key, now, options?.lang)),
    }));
  }
  // SB6.10: Incremental Agenda projection.
  // Flat, allocation-light item version signature covering every field that affects
  // expansion, visibility policy, identity, or rendered Agenda presentation.
  function agendaItemSignature(item, policy) {
    if (!item || typeof item !== "object") return "";
    const x = item.x && typeof item.x === "object" ? item.x : {};
    const rec = Array.isArray(item.recurrence) && item.recurrence.length ? item.recurrence.join("\u001e") : "";
    const ex = Array.isArray(x.recurrenceExceptions) && x.recurrenceExceptions.length ? JSON.stringify(x.recurrenceExceptions) : "";
    const pKey = policy ? ((policy.enabled ? "1" : "0") + ":" + (policy.leadDays || 0) + ":" + (policy.tailDays || 0)) : "1:0:0";
    return [
      item.id || "",
      item.rev ?? "",
      item.updated || "",
      item.etag || "",
      item.status || "",
      item.summary || "",
      item.description || "",
      item.start?.date || "",
      item.start?.dateTime || "",
      item.start?.timeZone || "",
      item.end?.date || "",
      item.end?.dateTime || "",
      item.end?.timeZone || "",
      rec,
      ex,
      x.kind || "",
      x.src || "",
      x.series || "",
      x.recurrenceId || "",
      x.historyId || "",
      x.noteId || "",
      x.heading || "",
      x.calNote || "",
      x.category || "",
      x.tz || "",
      x.color || "",
      x.noteColor || "",
      x.categoryColor || "",
      x.sourceNoteTitle || "",
      x.sourceNoteTrashed ? "1" : "0",
      x.sourceNoteTrashedTitle || "",
      x.rId || "",
      pKey,
    ].join("\u001f");
  }
  function createIncrementalAgendaProjector() {
    let ctx = null;
    let itemsById = new Map();
    let historyIdToSourceIds = new Map();
    let dayEntries = [];
    let dayBuckets = [];
    let runStamp = 0;
    let lastNow = NaN;
    let nextEndBoundary = Infinity;
    let prevEndBoundary = -Infinity;
    let lastHistoryVersion = undefined;
    let lastStats = { full: true, changedIds: [], removedIds: [], affectedDays: [] };

    const compareEntries = (a, b) =>
      a.sortStart - b.sortStart || (a.sortId < b.sortId ? -1 : a.sortId > b.sortId ? 1 : 0);

    function insertSorted(arr, entry) {
      let lo = 0, hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (compareEntries(arr[mid], entry) <= 0) lo = mid + 1;
        else hi = mid;
      }
      arr.splice(lo, 0, entry);
    }

    function addHistoryMapping(historyKey, sourceId) {
      if (!historyKey || historyKey === sourceId) return;
      let set = historyIdToSourceIds.get(historyKey);
      if (!set) { set = new Set(); historyIdToSourceIds.set(historyKey, set); }
      set.add(sourceId);
    }

    function removeHistoryMapping(historyKey, sourceId) {
      if (!historyKey || historyKey === sourceId) return;
      const set = historyIdToSourceIds.get(historyKey);
      if (!set) return;
      set.delete(sourceId);
      if (!set.size) historyIdToSourceIds.delete(historyKey);
    }

    function recomputeEndBoundaries(stamp) {
      let next = Infinity, prev = -Infinity;
      for (const entry of itemsById.values()) {
        const ends = entry.timedEnds;
        if (!ends || !ends.length) continue;
        for (let i = 0; i < ends.length; i++) {
          const endMs = ends[i];
          if (endMs > stamp) { if (endMs < next) next = endMs; }
          else { if (endMs > prev) prev = endMs; }
        }
      }
      nextEndBoundary = next;
      prevEndBoundary = prev;
    }

    function buildSingleItemProjection(source, policy, stamp, isDone, getWindow, policies) {
      const dayMap = new Map();
      const timedEnds = [];
      let rawOccurrences = [];
      if (!live(source)) {
        return { rawOccurrences, dayMap, dayOffsets: [], timedEnds };
      }
      const n = ctx.days, base = ctx.base, baseOrdinal = ctx.baseOrdinal, windowEnd = ctx.windowEnd;
      const itemPolicy = policy || resolveAgendaWindow(source);
      const isDefaultWin = itemPolicy.enabled && !itemPolicy.leadDays && !itemPolicy.tailDays && !getWindow;
      const candFrom = itemPolicy.tailDays ? addDays(base, -itemPolicy.tailDays) : base;
      const candTo = itemPolicy.leadDays ? addDays(windowEnd, itemPolicy.leadDays) : windowEnd;

      if (itemPolicy.enabled || (!policies && getWindow)) {
        if (source.x?.series || !(source.recurrence || []).length) {
          const [s, e] = itemRange(source);
          if (isReminder(source) ? (s >= candFrom && s < candTo) : (s < candTo && e > candFrom)) {
            rawOccurrences = [source];
          }
        } else {
          rawOccurrences = expandItem(source, candFrom, candTo);
        }
      }

      if (!rawOccurrences.length) {
        return { rawOccurrences, dayMap, dayOffsets: [], timedEnds };
      }

      const lang = ctx.lang;
      for (let i = 0; i < rawOccurrences.length; i++) {
        const occ = rawOccurrences[i];
        if (isDone && isDone(occ)) continue;
        let first, last;
        if (isDefaultWin) {
          const [start, end] = itemRange(occ);
          first = Math.max(0, localDayOrdinal(start) - baseOrdinal);
          last = Math.min(n - 1, localDayOrdinal(end > start ? end - 1 : start) - baseOrdinal);
        } else {
          const occPolicy = preparedAgendaWindow(occ, getWindow, policies);
          if (!occPolicy.enabled) continue;
          const visible = resolvedAgendaVisibilityRange(occ, occPolicy);
          if (!visible) continue;
          first = Math.max(0, localDayOrdinal(visible.from) - baseOrdinal);
          last = Math.min(n - 1, localDayOrdinal(visible.to - 1) - baseOrdinal);
        }
        if (first > last || first >= n || last < 0) continue;
        const [start, end] = itemRange(occ);
        if (!isReminder(occ) && end > start) timedEnds.push(end);
        for (let offset = first; offset <= last && offset < n; offset++) {
          const dateKey = ctx.dayKeys[offset];
          const zen = agendaZenItem(occ, dateKey, stamp, lang);
          let list = dayMap.get(offset);
          if (!list) { list = []; dayMap.set(offset, list); }
          list.push({ sourceId: source.id, sortStart: start, sortId: occ.id, zen });
        }
      }
      return { rawOccurrences, dayMap, dayOffsets: [...dayMap.keys()], timedEnds };
    }

    function materializeDayBucket(offset) {
      const entries = dayEntries[offset];
      const dateKey = ctx.dayKeys[offset];
      const items = new Array(entries.length);
      for (let i = 0; i < entries.length; i++) items[i] = entries[i].zen;
      dayBuckets[offset] = {
        key: "day:" + dateKey,
        date: dateKey,
        label: ctx.dayLabels[offset],
        count: items.length,
        items,
      };
    }

    function reset() {
      ctx = null;
      itemsById = new Map();
      historyIdToSourceIds = new Map();
      dayEntries = [];
      dayBuckets = [];
      runStamp = 0;
      lastNow = NaN;
      nextEndBoundary = Infinity;
      prevEndBoundary = -Infinity;
      lastHistoryVersion = undefined;
    }

    function fullRebuild(sourceItems, stamp, n, base, baseKey, baseOrdinal, windowEnd, lang, langCode, isDone, getWindow, policies, historyVersion) {
      reset();
      const dayKeys = new Array(n);
      const dayLabels = new Array(n);
      dayEntries = new Array(n);
      dayBuckets = new Array(n);
      for (let offset = 0; offset < n; offset++) {
        const from = addDays(base, offset);
        dayKeys[offset] = localDateKey(from);
        dayLabels[offset] = agendaDayLabel(offset, from, lang);
        dayEntries[offset] = [];
      }
      ctx = { baseKey, base, baseOrdinal, days: n, windowEnd, lang, langCode, dayKeys, dayLabels };
      runStamp = 1;

      const changedIds = [];
      for (let i = 0; i < sourceItems.length; i++) {
        const source = sourceItems[i];
        const id = source?.id;
        if (!id || itemsById.has(id)) {
          // Pathological missing or duplicate IDs: fall back to stateless full projection
          // and keep cache uninitialized so subsequent calls remain exact.
          reset();
          const fallback = agendaZenProjection(sourceItems, stamp, n, isDone || (() => false), getWindow, policies, { lang });
          lastStats = { full: true, changedIds: [], removedIds: [], affectedDays: Array.from({ length: n }, (_, k) => k) };
          return { projection: fallback, stats: lastStats };
        }
        const policy = preparedAgendaWindow(source, getWindow, policies);
        const policyKey = (policy.enabled ? "1" : "0") + ":" + (policy.leadDays || 0) + ":" + (policy.tailDays || 0);
        const sig = agendaItemSignature(source, policy);
        const built = buildSingleItemProjection(source, policy, stamp, isDone, getWindow, policies);
        const histKey = reminderIdentity(source)?.itemId || "";
        addHistoryMapping(histKey, id);
        itemsById.set(id, {
          ref: source,
          sig,
          policyKey,
          stamp: runStamp,
          historyKey: histKey,
          hasWindowOccurrences: built.rawOccurrences.length > 0,
          dayOffsets: built.dayOffsets,
          dayMap: built.dayMap,
          timedEnds: built.timedEnds,
        });
        for (const [offset, list] of built.dayMap) {
          const target = dayEntries[offset];
          for (let j = 0; j < list.length; j++) target.push(list[j]);
        }
        changedIds.push(id);
      }
      for (let offset = 0; offset < n; offset++) {
        dayEntries[offset].sort(compareEntries);
        materializeDayBucket(offset);
      }
      recomputeEndBoundaries(stamp);
      lastNow = stamp;
      lastHistoryVersion = historyVersion;
      lastStats = { full: true, changedIds, removedIds: [], affectedDays: Array.from({ length: n }, (_, k) => k) };
      return { projection: dayBuckets.slice(), stats: lastStats };
    }

    function project(items, now, options = {}) {
      const sourceItems = items || [];
      const stamp = Number(now);
      const n = Math.max(1, Math.min(31, Math.floor(Number(options.days)) || 4));
      const base = dayStart(stamp), baseKey = localDateKey(base), baseOrdinal = localDayOrdinal(base), windowEnd = addDays(base, n);
      const lang = options.lang;
      const langCode = notesLanguageTable(lang).code;
      const isDone = typeof options.isDone === "function" ? options.isDone : null;
      const getWindow = options.getWindow || null;
      const policies = options.policies || null;
      const historyVersion = options.historyVersion;

      if (
        !ctx ||
        options.forceFull ||
        ctx.baseKey !== baseKey ||
        ctx.days !== n ||
        ctx.langCode !== langCode
      ) {
        return fullRebuild(sourceItems, stamp, n, base, baseKey, baseOrdinal, windowEnd, lang, langCode, isDone, getWindow, policies, historyVersion);
      }

      runStamp++;
      const forcedDirty = new Set();

      // 1. Expand caller-provided dirtyIds (supports both source IDs and reminder history IDs).
      const rawDirty = options.dirtyIds;
      let dirtyAllInWindow = false;
      if (rawDirty === "*") {
        dirtyAllInWindow = true;
      } else if (rawDirty) {
        for (const rawId of rawDirty) {
          if (!rawId) continue;
          const sid = String(rawId);
          forcedDirty.add(sid);
          const mapped = historyIdToSourceIds.get(sid);
          if (mapped) for (const m of mapped) forcedDirty.add(m);
        }
      }

      // 2. Handle history / isDone invalidation when caller didn't specify exact dirtyIds.
      if (isDone) {
        if (historyVersion !== undefined) {
          if (historyVersion !== lastHistoryVersion && !rawDirty) dirtyAllInWindow = true;
        } else if (!rawDirty) {
          dirtyAllInWindow = true;
        }
      }
      if (dirtyAllInWindow) {
        for (const [id, entry] of itemsById) {
          if (entry.hasWindowOccurrences || entry.dayOffsets.length > 0) forcedDirty.add(id);
        }
      }

      // 3. Detect intra-day timed event `ended` transitions across all days (including tailDays).
      if (stamp >= nextEndBoundary || stamp < prevEndBoundary) {
        const lo = Math.min(lastNow, stamp), hi = Math.max(lastNow, stamp);
        for (const [id, entry] of itemsById) {
          const ends = entry.timedEnds;
          if (!ends || !ends.length) continue;
          for (let i = 0; i < ends.length; i++) {
            const endMs = ends[i];
            if (endMs > lo && endMs <= hi) { forcedDirty.add(id); break; }
          }
        }
      }

      const changedIds = [];
      const removedIds = [];
      const affectedDays = new Set();
      const dayDirtySources = new Map();
      const markDayDirty = (offset, sourceId) => {
        affectedDays.add(offset);
        let set = dayDirtySources.get(offset);
        if (!set) { set = new Set(); dayDirtySources.set(offset, set); }
        set.add(sourceId);
      };

      // 4. Diff sourceItems by reference / version signature / resolved policy.
      for (let i = 0; i < sourceItems.length; i++) {
        const source = sourceItems[i];
        const id = source?.id;
        if (!id) {
          return fullRebuild(sourceItems, stamp, n, base, baseKey, baseOrdinal, windowEnd, lang, langCode, isDone, getWindow, policies, historyVersion);
        }
        const prev = itemsById.get(id);
        if (prev && prev.stamp === runStamp) {
          // Duplicate id in sourceItems -> fall back cleanly.
          return fullRebuild(sourceItems, stamp, n, base, baseKey, baseOrdinal, windowEnd, lang, langCode, isDone, getWindow, policies, historyVersion);
        }
        const policy = preparedAgendaWindow(source, getWindow, policies);
        const policyKey = (policy.enabled ? "1" : "0") + ":" + (policy.leadDays || 0) + ":" + (policy.tailDays || 0);
        const isForced = forcedDirty.has(id);

        if (prev && !isForced && prev.ref === source && prev.policyKey === policyKey) {
          prev.stamp = runStamp;
          continue;
        }
        const sig = agendaItemSignature(source, policy);
        if (prev && !isForced && prev.sig === sig) {
          prev.ref = source;
          prev.stamp = runStamp;
          continue;
        }

        // Changed or newly added item: re-project ONLY this item ID.
        const built = buildSingleItemProjection(source, policy, stamp, isDone, getWindow, policies);
        if (prev && prev.sig === sig && prev.dayOffsets.length === built.dayOffsets.length) {
          let identical = true;
          for (let k = 0; k < built.dayOffsets.length && identical; k++) {
            const off = built.dayOffsets[k];
            const oldList = prev.dayMap.get(off);
            const newList = built.dayMap.get(off);
            if (!oldList || !newList || oldList.length !== newList.length) { identical = false; break; }
            for (let j = 0; j < newList.length; j++) {
              if (oldList[j].zen.key !== newList[j].zen.key || oldList[j].zen.ended !== newList[j].zen.ended) {
                identical = false;
                break;
              }
            }
          }
          if (identical) {
            prev.ref = source;
            prev.stamp = runStamp;
            continue;
          }
        }
        changedIds.push(id);
        if (prev) {
          for (let k = 0; k < prev.dayOffsets.length; k++) markDayDirty(prev.dayOffsets[k], id);
          removeHistoryMapping(prev.historyKey, id);
        }
        const histKey = reminderIdentity(source)?.itemId || "";
        addHistoryMapping(histKey, id);
        itemsById.set(id, {
          ref: source,
          sig,
          policyKey,
          stamp: runStamp,
          historyKey: histKey,
          hasWindowOccurrences: built.rawOccurrences.length > 0,
          dayOffsets: built.dayOffsets,
          dayMap: built.dayMap,
          timedEnds: built.timedEnds,
        });
        for (let k = 0; k < built.dayOffsets.length; k++) markDayDirty(built.dayOffsets[k], id);
      }

      // 5. Detect removed items (not seen in this run).
      for (const [id, entry] of itemsById) {
        if (entry.stamp === runStamp) continue;
        removedIds.push(id);
        for (let k = 0; k < entry.dayOffsets.length; k++) markDayDirty(entry.dayOffsets[k], id);
        removeHistoryMapping(entry.historyKey, id);
        itemsById.delete(id);
      }

      // 6. Rebuild ONLY affected days; unaffected days keep their existing bucket references.
      for (const offset of affectedDays) {
        const dirtySet = dayDirtySources.get(offset);
        const current = dayEntries[offset];
        if (dirtySet && dirtySet.size <= 16 && current.length > 32) {
          const kept = [];
          for (let i = 0; i < current.length; i++) {
            if (!dirtySet.has(current[i].sourceId)) kept.push(current[i]);
          }
          for (const sourceId of dirtySet) {
            const entry = itemsById.get(sourceId);
            const added = entry?.dayMap?.get(offset);
            if (!added) continue;
            for (let j = 0; j < added.length; j++) insertSorted(kept, added[j]);
          }
          dayEntries[offset] = kept;
        } else {
          const rebuilt = [];
          for (const entry of itemsById.values()) {
            const list = entry.dayMap.get(offset);
            if (!list) continue;
            for (let j = 0; j < list.length; j++) rebuilt.push(list[j]);
          }
          rebuilt.sort(compareEntries);
          dayEntries[offset] = rebuilt;
        }
        materializeDayBucket(offset);
      }

      if (changedIds.length || removedIds.length || stamp >= nextEndBoundary || stamp < prevEndBoundary) {
        recomputeEndBoundaries(stamp);
      }
      lastNow = stamp;
      lastHistoryVersion = historyVersion;
      lastStats = {
        full: false,
        changedIds,
        removedIds,
        affectedDays: [...affectedDays].sort((a, b) => a - b),
      };
      return { projection: dayBuckets.slice(), stats: lastStats };
    }

    return {
      project,
      reset,
      get lastStats() { return lastStats; },
    };
  }
  // Separate, occurrence-scoped overdue bucket. Civil-day look-back excludes
  // today even for a past time today; item visibility and lifecycle still apply.
  function agendaOverdueProjection(items, now, { enabled = true, days = 7, cap = 10, isDone = () => false, getWindow = null, policies = null, lang = undefined } = {}) {
    if (!enabled || !Number.isFinite(Number(now))) return null;
    const countDays = Math.max(1, Math.min(31, Math.floor(Number(days)) || 7));
    const limit = Math.max(1, Math.min(100, Math.floor(Number(cap)) || 10));
    const today = dayStart(Number(now)), from = addDays(today, -countDays);
    const masters = (items || []).filter((item) => item?.x && item.start && isReminder(item) && preparedAgendaWindow(item, getWindow, policies).enabled);
    const overdue = expandRange(masters, from, today).filter((item) => !isDone(item));
    if (!overdue.length) return null;
    const shown = overdue.slice(0, limit).map((item) => {
      const entry = agendaZenItem(item, "overdue", now, lang);
      entry.openDate = localDateKey(itemRange(item)[0]);
      return entry;
    });
    if (overdue.length > limit) shown.push({ key: "more:overdue", label: "+" + (overdue.length - limit) + " more", summary: "Open more overdue reminders", openDate: localDateKey(itemRange(overdue[limit])[0]) });
    return { key: "day:overdue", date: "overdue", label: notesLanguageTable(lang).overdueLabel, count: overdue.length, items: shown };
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
  // SB6.4: cap the total number of non-overdue Agenda sidebar tabs across day folders,
  // distributing budget earliest-first and collapsing overflow into a single '+N more…' node.
  const AGENDA_MAX_ITEMS_DEFAULT = 40;
  function applyAgendaItemCap(days, maxItems = 0, { lang = DEFAULT_NOTES_LANGUAGE } = {}) {
    const list = (days || []).filter((day) => day && Array.isArray(day.items) && day.items.length > 0);
    const rawLimit = Math.floor(Number(maxItems));
    if (!(rawLimit > 0)) return { days: list, hiddenCount: 0, more: null };
    const limit = Math.max(1, Math.min(200, rawLimit));
    let total = 0;
    for (const day of list) total += day.items.length;
    if (total <= limit) return { days: list, hiddenCount: 0, more: null };
    const keptDays = [];
    let remaining = limit;
    let firstHiddenDate = "";
    for (const day of list) {
      if (remaining > 0) {
        if (day.items.length <= remaining) {
          keptDays.push(day);
          remaining -= day.items.length;
        } else {
          if (!firstHiddenDate) firstHiddenDate = day.date || "";
          keptDays.push({ ...day, items: day.items.slice(0, remaining) });
          remaining = 0;
        }
      } else if (!firstHiddenDate) {
        firstHiddenDate = day.date || "";
      }
    }
    const hiddenCount = total - limit;
    const more = {
      key: "more:agenda",
      kind: "item",
      parent: "",
      label: t("sidebar.agenda.moreLabel", { count: hiddenCount }, lang),
      summary: t("sidebar.agenda.moreSummary", null, lang),
      details: t("sidebar.agenda.moreTooltip", { count: hiddenCount }, lang),
      openDate: firstHiddenDate || list[0]?.date || "",
      hiddenCount,
    };
    return { days: keptDays, hiddenCount, more };
  }
  // Coalesced, store-change-driven controller for the virtual Zen Agenda folder. The host
  // supplies DOM/Zen operations through `api`; this controller owns no browser globals.
  function createZenAgenda({ api, perf = null, getItems, getDays = () => 4, getMaxItems = () => 0, getEnabled = () => true, getReady = () => true, getPosition = () => "above", now = () => Date.now(), isDone = () => false, hasHistoryTracking = false, getWindow = null, getWindowIsMasterPolicy = false, getOverdue = () => ({ enabled: false }), getLanguage = () => undefined, setTimer = setTimeout, clearTimer = clearTimeout, warn = () => {} } = {}) {
    let dead = false, timer = null, timerAt = Infinity, last = [], lastMore = null, busy = false, consecutiveChanges = 0, blockedUntil = 0;
    const projector = createIncrementalAgendaProjector();
    let historyTracked = !!hasHistoryTracking, historyVersion = 0, pendingHistoryDirtyAll = false;
    const pendingHistoryDirtyIds = new Set();
    let lastProjectionStats = null;
    const safeWarn = (error) => { try { warn(error); } catch (_) {} };
    function markHistoryDirty(ids = null) {
      historyTracked = true;
      historyVersion++;
      if (!ids) { pendingHistoryDirtyAll = true; pendingHistoryDirtyIds.clear(); return; }
      if (pendingHistoryDirtyAll) return;
      for (const id of ids) if (id) pendingHistoryDirtyIds.add(String(id));
    }
    function armAt(due) {
      if (dead || !Number.isFinite(due)) return;
      const stamp = Number(now());
      due = Math.max(due, blockedUntil);
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
    function scheduleBoundary(items, policies, projection, overdue) {
      let due = nextAgendaVisibilityBoundary(items, now(), getDays(), getWindow, policies, projection);
      if (overdue) { const tomorrow = addDays(dayStart(now()), 1); if (due === null || tomorrow < due) due = tomorrow; }
      if (due === null) clearScheduled(); else armAt(due);
    }
    function runNow() {
      if (dead) return [];
      if (busy) return last;
      const stamp = Number(now());
      if (blockedUntil && stamp < blockedUntil) return last;
      if (blockedUntil) { blockedUntil = 0; consecutiveChanges = 0; }
      busy = true;
      let sourceItems = [], policies = null, fullProjection = null, overdue = null, operations = 0;
      const revision = api.mutationCount?.() || 0;
      try {
        if (!getEnabled()) { projector.reset(); api.removeAll?.(); last = []; lastMore = null; clearScheduled(); return []; }
        // The items are not loaded yet (startup, before the store has opened). An empty list now would not mean that
        // nothing is due: reconciling against it would remove the entries that session restore just brought back. The
        // host schedules a run when the store is ready.
        if (!getReady()) return last;
        sourceItems = getItems?.() || [];
        policies = getWindowIsMasterPolicy ? prepareAgendaWindows(sourceItems, getWindow) : null;
        const lang = getLanguage();
        const projNow = now();
        const dirtyIds = historyTracked
          ? (pendingHistoryDirtyAll ? "*" : (pendingHistoryDirtyIds.size ? [...pendingHistoryDirtyIds] : null))
          : null;
        pendingHistoryDirtyAll = false;
        pendingHistoryDirtyIds.clear();
        const projected = projector.project(sourceItems, projNow, {
          days: getDays(),
          isDone,
          getWindow,
          policies,
          lang,
          historyVersion: historyTracked ? historyVersion : undefined,
          dirtyIds,
        });
        fullProjection = projected.projection;
        lastProjectionStats = projected.stats;
        overdue = agendaOverdueProjection(sourceItems, projNow, { ...getOverdue(), isDone, getWindow, policies, lang });
        const capped = applyAgendaItemCap(agendaVisibleDays(fullProjection), getMaxItems?.(), { lang });
        const projection = [...(overdue ? [overdue] : []), ...capped.days];
        if (!projection.length && !capped.more) {
          api.removeAll?.(); last = projection; lastMore = null; scheduleBoundary(sourceItems, policies, fullProjection, overdue); return projection;
        }
        if (api.ensureRoot?.(getPosition() === "below" ? "below" : "above") === false) { scheduleBoundary(sourceItems, policies, fullProjection, overdue); return last; }
        const desired = [];
        for (const day of projection) {
          desired.push({ key: day.key, kind: "day", label: day.label, date: day.date, count: day.count, parent: "" });
          for (const item of day.items) desired.push({ ...item, kind: "item", parent: day.key, tooltip: item.details });
        }
        if (capped.more) desired.push({ ...capped.more, kind: "item", parent: "", tooltip: capped.more.details });
        const current = api.list?.() || [], currentByKey = new Map();
        for (const entry of current) if (entry?.key && !currentByKey.has(entry.key)) currentByKey.set(entry.key, entry);
        const desiredByKey = new Map(desired.map((entry) => [entry.key, entry]));
        for (const entry of current) if (entry?.key && !desiredByKey.has(entry.key)) { operations++; api.remove?.(entry.key); }
        for (const entry of desired) {
          const old = currentByKey.get(entry.key);
          if (!old || old.parent !== entry.parent || old.kind !== entry.kind) {
            if (old) { operations++; api.remove?.(entry.key); }
            operations++;
            if (api.add?.(entry) === false) safeWarn("Zen Agenda: could not add " + entry.key);
          } else api.update?.(entry);
        }
        api.reorder?.("", desired.filter((entry) => entry.parent === "").map((entry) => entry.key));
        for (const day of desired.filter((entry) => entry.kind === "day"))
          api.reorder?.(day.key, desired.filter((entry) => entry.kind === "item" && entry.parent === day.key).map((entry) => entry.key));
        last = projection;
        lastMore = capped.more;
        scheduleBoundary(sourceItems, policies, fullProjection, overdue);
        if (operations || (api.mutationCount?.() || 0) !== revision) consecutiveChanges++;
        else consecutiveChanges = 0;
        if (consecutiveChanges >= 3) {
          blockedUntil = (Number.isFinite(stamp) ? stamp : Date.now()) + 5000;
          safeWarn("Zen Agenda: repeated reconciliation changes; back-off for five seconds");
          clearScheduled(); armAt(blockedUntil);
        }
        return projection;
      } catch (error) {
        safeWarn(error);
        try { scheduleBoundary(sourceItems, policies, fullProjection, overdue); } catch (scheduleError) { safeWarn(scheduleError); }
        return last;
      } finally { busy = false; }
    }
    if (perf?.wrap) runNow = perf.wrap("agenda.runNow", runNow);
    function schedule(ms = 250) {
      if (dead) return;
      const stamp = Number(now()), due = (Number.isFinite(stamp) ? stamp : Date.now()) + Math.max(0, Number(ms) || 0);
      armAt(due);
    }
    return {
      runNow,
      schedule,
      invalidate(opts) { consecutiveChanges = 0; blockedUntil = 0; if (opts?.full) projector.reset(); },
      markHistoryDirty,
      refreshClock() { if (dead) return []; clearScheduled(); consecutiveChanges = 0; blockedUntil = 0; return runNow(); },
      get busy() { return busy; },
      get projection() { return last; },
      get more() { return lastMore; },
      get lastProjectionStats() { return lastProjectionStats; },
      destroy() { dead = true; projector.reset(); clearScheduled(); try { api.removeAll?.(); } catch (error) { safeWarn(error); } },
    };
  }
  // SB6.5: Pure Agenda Doctor diagnostics & safe-repair planner.
  // Classifies DOM and reminder-history snapshots without touching browser objects.
  function formatAgendaDoctorBytes(bytes) {
    const n = Math.max(0, Math.round(Number(bytes) || 0));
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace(/\.0$/, "") + " KB";
    return (n / (1024 * 1024)).toFixed(2).replace(/\.00$/, "") + " MB";
  }
  function diagnoseAgenda(snapshot = {}) {
    const enabled = snapshot?.enabled === true;
    const rawRoots = Array.isArray(snapshot?.roots) ? snapshot.roots : [];
    const rawTabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs : [];
    const rawForeign = Array.isArray(snapshot?.foreignTabs) ? snapshot.foreignTabs : [];
    const rawReleased = Array.isArray(snapshot?.releasedFolders) ? snapshot.releasedFolders : [];
    const rawHist = snapshot?.history && typeof snapshot.history === "object" ? snapshot.history : {};

    const duplicateRoots = rawRoots
      .filter((r) => r && !r.canonical)
      .map((r, i) => ({
        id: String(r.id || `root-${i}`),
        label: String(r.label || "Agenda"),
        foreignCount: Math.max(0, Math.floor(Number(r.foreignCount) || 0)),
      }));

    // Track seeds per parent folder so an intentional single fallback seed in an empty folder
    // (when Zen deletes empty folders) is treated as healthy rather than an orphan.
    const seedsByParent = new Map();
    for (const tab of rawTabs) {
      if (!tab) continue;
      const key = String(tab.key || "");
      const isSeed = tab.isSeed === true || key.startsWith("seed:");
      if (!isSeed) continue;
      const parentId = String(tab.parentId || (tab.insideRoot ? "__root__" : "__outside__"));
      if (!seedsByParent.has(parentId)) seedsByParent.set(parentId, []);
      seedsByParent.get(parentId).push(tab);
    }

    const orphanSeeds = [];
    const tabsOutsideRoot = [];
    const nonSeedByKey = new Map();
    for (let i = 0; i < rawTabs.length; i++) {
      const tab = rawTabs[i];
      if (!tab) continue;
      const id = String(tab.id ?? `tab-${i}`);
      const key = String(tab.key || "");
      const label = String(tab.label || key || "Agenda");
      const insideRoot = tab.insideRoot === true;
      const isSeed = tab.isSeed === true || key.startsWith("seed:");
      if (isSeed) {
        const parentId = String(tab.parentId || (insideRoot ? "__root__" : "__outside__"));
        const siblings = seedsByParent.get(parentId) || [];
        const isPrimaryFallback = enabled && insideRoot && tab.isFallbackSeed === true && (tab.fallbackRequired === true || !tab.parentHasNonSeed) && siblings[0] === tab;
        if (!isPrimaryFallback) {
          const reason = !enabled ? "disabled" : !insideRoot ? "outside-root" : (tab.parentHasNonSeed && !tab.fallbackRequired) ? "has-siblings" : siblings[0] !== tab ? "duplicate-seed" : "stale-seed";
          orphanSeeds.push({ id, key, label, insideRoot, reason });
        }
        continue;
      }
      if (!insideRoot || !enabled) {
        tabsOutsideRoot.push({ id, key, label, insideRoot, reason: !enabled ? "disabled" : "outside-root" });
      }
      if (key) {
        if (!nonSeedByKey.has(key)) nonSeedByKey.set(key, []);
        nonSeedByKey.get(key).push({ id, key, label, insideRoot });
      }
    }

    const duplicateKeys = [];
    const outsideSet = new Set(tabsOutsideRoot.map((t) => t.id));
    for (const [key, list] of nonSeedByKey.entries()) {
      if (list.length < 2) continue;
      // Prefer keeping the first copy that is already inside the canonical root.
      const keep = list.find((entry) => entry.insideRoot) || list[0];
      const extras = list.filter((entry) => entry !== keep);
      duplicateKeys.push({
        key,
        count: list.length,
        keepId: keep.id,
        extraIds: extras.map((entry) => entry.id),
        extraInRootIds: extras.filter((entry) => !outsideSet.has(entry.id)).map((entry) => entry.id),
        labels: list.map((entry) => entry.label),
      });
    }

    const foreignTabs = rawForeign
      .filter(Boolean)
      .map((f, i) => ({
        id: String(f.id ?? `foreign-${i}`),
        kind: f.kind === "folder" ? "folder" : "tab",
        label: String(f.label || f.url || "Tab"),
        url: String(f.url || ""),
        folderId: String(f.folderId || ""),
        folderLabel: String(f.folderLabel || "Agenda"),
      }));

    const releasedFolders = rawReleased
      .filter(Boolean)
      .map((f, i) => ({
        id: String(f.id ?? `released-${i}`),
        label: String(f.label || f.id || "Folder"),
        tabCount: Math.max(0, Math.floor(Number(f.tabCount) || 0)),
        foreignCount: Math.max(0, Math.floor(Number(f.foreignCount) || 0)),
        kind: f.kind === "agenda" ? "agenda" : "notes",
      }));

    const histStateRaw = String(rawHist.state || "unopened");
    const histWriteBlocked = rawHist.writeBlocked === true;
    const histDirty = rawHist.dirty === true;
    const histRetryCount = Math.max(0, Math.floor(Number(rawHist.retryCount) || 0));
    const histCount = Math.max(0, Math.floor(Number(rawHist.count) || 0));
    const histBytes = Math.max(0, Math.round(Number(rawHist.bytes) || 0));
    const histError = String(rawHist.error || "");
    const histBackupPath = String(rawHist.backupPath || "");
    const histSeverity = histWriteBlocked || histStateRaw === "corrupt" || histStateRaw === "unreadable"
      ? "error"
      : (histStateRaw === "partial" || histRetryCount > 0 || histDirty ? "warning" : "ok");
    const histStateKey = histWriteBlocked && histStateRaw !== "corrupt" && histStateRaw !== "unreadable"
      ? "blocked"
      : (["ready", "partial", "corrupt", "unreadable", "unopened"].includes(histStateRaw)
        ? (histStateRaw === "ready" && histDirty ? "dirty" : histStateRaw)
        : (histWriteBlocked ? "blocked" : "unopened"));

    const history = {
      state: histStateRaw,
      stateKey: histStateKey,
      severity: histSeverity,
      count: histCount,
      bytes: histBytes,
      sizeText: formatAgendaDoctorBytes(histBytes),
      dirty: histDirty,
      writeBlocked: histWriteBlocked,
      retryCount: histRetryCount,
      error: histError,
      backupPath: histBackupPath,
    };

    const duplicateExtraCount = duplicateKeys.reduce((sum, entry) => sum + entry.extraInRootIds.length, 0);
    const safeIssueCount = orphanSeeds.length + duplicateExtraCount + duplicateRoots.length + tabsOutsideRoot.length + foreignTabs.length;
    const totalIssues = safeIssueCount + releasedFolders.length + (history.severity === "error" ? 1 : 0);

    return {
      enabled,
      rootCount: rawRoots.length,
      orphanSeeds,
      duplicateKeys,
      duplicateRoots,
      tabsOutsideRoot,
      foreignTabs,
      releasedFolders,
      history,
      counts: {
        orphanSeeds: orphanSeeds.length,
        duplicateKeys: duplicateKeys.length,
        duplicateTabs: duplicateExtraCount,
        duplicateRoots: duplicateRoots.length,
        tabsOutsideRoot: tabsOutsideRoot.length,
        foreignTabs: foreignTabs.length,
        releasedFolders: releasedFolders.length,
        safeRepairable: safeIssueCount,
        totalIssues,
      },
      healthy: totalIssues === 0 && history.severity !== "error",
    };
  }
  function planAgendaDoctorRepair(report) {
    const r = report && typeof report === "object" ? report : diagnoseAgenda({});
    const removeOrphanSeeds = (r.orphanSeeds || []).map((entry) => entry.id);
    const removeTabsOutsideRoot = (r.tabsOutsideRoot || []).map((entry) => entry.id);
    const removeDuplicateTabs = (r.duplicateKeys || []).flatMap((entry) => entry.extraInRootIds || []);
    const retireDuplicateRoots = (r.duplicateRoots || []).map((entry) => entry.id);
    const evacuateForeignTabs = (r.foreignTabs || []).map((entry) => entry.id);
    const safeCount = removeOrphanSeeds.length + removeTabsOutsideRoot.length + removeDuplicateTabs.length + retireDuplicateRoots.length + evacuateForeignTabs.length;
    return {
      safeCount,
      hasSafeRepairs: safeCount > 0,
      actions: {
        removeOrphanSeeds,
        removeDuplicateTabs,
        removeTabsOutsideRoot,
        retireDuplicateRoots,
        evacuateForeignTabs,
        reconcile: safeCount > 0 && r.enabled === true,
      },
      manualOnly: {
        releasedFolders: (r.releasedFolders || []).map((entry) => entry.id),
        historyBlocked: r.history?.writeBlocked === true || r.history?.severity === "error",
      },
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
  // SB6.2: Agenda root folder right-click menu entries (localized via language tables).
  const AGENDA_ROOT_MENU_COMMANDS = Object.freeze(["open-calendar", "refresh-agenda", "agenda-settings", "hide-agenda"]);
  function agendaRootMenuModel({ lang = DEFAULT_NOTES_LANGUAGE } = {}) {
    return [
      { id: "open-calendar", label: t("sidebar.agenda.root.openCalendar", null, lang) },
      { id: "refresh-agenda", label: t("sidebar.agenda.root.refresh", null, lang) },
      { id: "agenda-settings", label: t("sidebar.agenda.root.settings", null, lang) },
      { id: "hide-agenda", label: t("sidebar.agenda.root.hide", null, lang) },
    ];
  }
  function calendarItemMenuModel(item, { state = "pending", historyWritable = false, agendaVisible, agendaWritable = true, lang = DEFAULT_NOTES_LANGUAGE } = {}) {
    if (!item || typeof item !== "object" || !String(item.id || "")) return [];
    const tr = (key, params = null) => t(key, params, lang);
    const reminder = isReminder(item);
    const source = ["list", "note", "manual"].includes(item.x?.src) ? item.x.src : "manual";
    const manual = source === "manual", mirrored = isMirroredAgendaItem(item);
    const recurring = !!item.x?.series || (Array.isArray(item.recurrence) && item.recurrence.length > 0);
    const lifecycle = ["pending", "done", "dismissed"].includes(state) ? state : "pending";
    const action = (id, label, enabled = true, reason = "") => ({ id, command: id, label, enabled: !!enabled, reason: enabled ? "" : String(reason || tr("menu.unavailable")) });
    const deleteKey = reminder
      ? (mirrored ? "menu.deleteReminderMirrored" : "menu.deleteReminder")
      : (mirrored ? "menu.deleteEventMirrored" : "menu.deleteEvent");
    const rows = [
      action("open", tr(item.x?.noteId ? "menu.openSourceNote" : "menu.showDetails")),
      action("edit", tr("menu.editDetails")),
      action("change-time", tr(recurring ? "menu.changeOccurrenceTime" : "menu.changeTime"), source !== "note" && (!recurring || !!item.x?.recurrenceId), tr(source === "note" ? "menu.changeTimeNoteReason" : "menu.changeTimeRecurringReason")),
      action("convert", tr(reminder ? "menu.convertToEvent" : "menu.convertToReminder"), manual, tr("menu.convertParsedReason")),
      { sep: true },
      action("duplicate", tr("menu.duplicate")),
      action("delete", tr(deleteKey), manual || mirrored, tr("menu.deleteSourceReason")),
    ];
    if (typeof agendaVisible === "boolean") {
      const agendaKey = !agendaWritable
        ? "menu.agendaUnavailable"
        : agendaVisible
          ? (recurring ? "menu.agendaHideSeries" : "menu.agendaHide")
          : (recurring ? "menu.agendaShowSeries" : "menu.agendaShow");
      rows.splice(4, 0, action("agenda-visibility", tr(agendaKey), agendaWritable, tr("menu.agendaLegacyReason")));
    }
    if (reminder) {
      const writable = !!historyWritable;
      const historyReason = tr("menu.historyProtectedReason");
      const canSnoozeOccurrence = !recurring || !!item.x?.recurrenceId;
      const unexpandedReason = tr("menu.snoozeUnexpandedReason");
      rows.push(
        { sep: true },
        { heading: true, label: tr("menu.reminderHeading." + lifecycle) },
        action("mark-done", tr("menu.markDone"), writable && lifecycle !== "done", !writable ? historyReason : tr("menu.alreadyDone")),
        action("dismiss", tr("menu.dismiss"), writable && lifecycle !== "dismissed", !writable ? historyReason : tr("menu.alreadyDismissed")),
        action("reopen", tr("menu.reopen"), writable && lifecycle !== "pending", !writable ? historyReason : tr("menu.alreadyPending")),
        { id: "snooze", command: "snooze", label: tr("menu.snooze"), group: [
          action("snooze-1h", tr("menu.snooze1h"), writable && canSnoozeOccurrence && !item.start?.date, !writable ? historyReason : !canSnoozeOccurrence ? unexpandedReason : tr("menu.snoozeAllDayReason")),
          action("snooze-1d", tr("menu.snooze1d"), writable && canSnoozeOccurrence, !writable ? historyReason : unexpandedReason),
          action("snooze-3d", tr("menu.snooze3d"), writable && canSnoozeOccurrence, !writable ? historyReason : unexpandedReason),
          action("snooze-monday", tr("menu.snoozeMonday"), writable && canSnoozeOccurrence, !writable ? historyReason : unexpandedReason),
          action("snooze-custom", tr("menu.snoozeCustom"), writable && canSnoozeOccurrence, !writable ? historyReason : unexpandedReason),
        ] },
      );
    }
    return rows;
  }

  // SB6.3: partition calendarItemMenuModel commands into headless one-click actions (run directly
  // against the item/history stores with an Undo toast, without opening the Notes sheet) vs commands
  // that legitimately need the Notes sheet UI (note view, composer, reschedule/snooze/delete dialogs).
  const HEADLESS_AGENDA_COMMANDS = Object.freeze([
    "mark-done",
    "dismiss",
    "reopen",
    "snooze-1h",
    "snooze-1d",
    "snooze-3d",
    "snooze-monday",
    "agenda-visibility",
    "convert",
    "duplicate",
  ]);
  const SHEET_AGENDA_COMMANDS = Object.freeze(["open", "edit", "change-time", "snooze-custom", "delete"]);
  const isHeadlessAgendaCommand = (command) => HEADLESS_AGENDA_COMMANDS.includes(String(command || ""));
  function snoozeMondayDays(item) {
    if (!item || typeof item !== "object") return 0;
    let dayKey = "";
    if (item.start?.date) dayKey = String(item.start.date).slice(0, 10);
    else if (item.start?.dateTime) {
      const ms = Date.parse(item.start.dateTime);
      if (Number.isFinite(ms)) dayKey = zonedDateKey(ms, cleanZone(item.x?.tz)) || ymd(new Date(ms));
    }
    const date = parseYmd(dayKey) || new Date(itemRange(item)[0]);
    if (!date || Number.isNaN(date.getTime())) return 0;
    return (8 - date.getDay()) % 7 || 7;
  }
  const undoLifecycleAction = (previousState) =>
    previousState === "done" ? "done" : previousState === "dismissed" ? "dismissed" : "reopened";
  function agendaActionMessage(command, { enabled = false, wasReminder = false, lang = DEFAULT_NOTES_LANGUAGE } = {}) {
    switch (String(command || "")) {
      case "mark-done": return t("toast.agenda.markDone", null, lang);
      case "dismiss": return t("toast.agenda.dismiss", null, lang);
      case "reopen": return t("toast.agenda.reopen", null, lang);
      case "snooze-1h": return t("toast.agenda.snooze1h", null, lang);
      case "snooze-1d": return t("toast.agenda.snooze1d", null, lang);
      case "snooze-3d": return t("toast.agenda.snooze3d", null, lang);
      case "snooze-monday": return t("toast.agenda.snoozeMonday", null, lang);
      case "agenda-visibility": return t(enabled ? "toast.agenda.shown" : "toast.agenda.hidden", null, lang);
      case "convert": return t(wasReminder ? "toast.agenda.convertedToEvent" : "toast.agenda.convertedToReminder", null, lang);
      case "duplicate": return t("toast.agenda.duplicated", null, lang);
      default: return "";
    }
  }
  // T3.4a: formatted date + time range label for Agenda sidebar hover cards.
  function formatAgendaHoverTime(item, { dateFormat = DEFAULT_DATE_FORMAT } = {}) {
    if (!item || typeof item !== "object") return "";
    const [start, end] = itemRange(item);
    if (!Number.isFinite(start)) return "";
    const fmt = cleanDateFormat(dateFormat);
    const zone = cleanZone(item.x?.tz);
    const localClock = (ms) => {
      if (zone) {
        const c = clockIn(ms, zone);
        if (c) return c;
      }
      const d = new Date(ms);
      return p2(d.getHours()) + ":" + p2(d.getMinutes());
    };
    const keyOf = (ms) => (zone ? zonedDateKey(ms, zone) : ymd(new Date(ms))) || ymd(new Date(ms));
    if (isAllDay(item)) {
      const startKey = item.start?.date ? String(item.start.date).slice(0, 10) : ymd(new Date(start));
      const endExclusive = item.end?.date ? String(item.end.date).slice(0, 10) : "";
      const endDate = endExclusive ? parseYmd(endExclusive) : null;
      const lastKey = endDate ? ymd(new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - 1)) : startKey;
      const sLabel = formatDateKey(startKey, fmt) || startKey;
      if (lastKey && lastKey > startKey) {
        const eLabel = formatDateKey(lastKey, fmt) || lastKey;
        return sLabel + " \u2013 " + eLabel + " \u00b7 All day";
      }
      return sLabel + " \u00b7 All day";
    }
    const startKey = keyOf(start);
    const sLabel = formatDateKey(startKey, fmt) || startKey;
    const sClock = localClock(start);
    const tzTag = zone ? " (" + zone + ")" : "";
    if (!isReminder(item) && Number.isFinite(end) && end > start) {
      const endKey = keyOf(end);
      const eClock = localClock(end);
      if (endKey && endKey !== startKey) {
        const eLabel = formatDateKey(endKey, fmt) || endKey;
        return sLabel + " " + sClock + " \u2013 " + eLabel + " " + eClock + tzTag;
      }
      return sLabel + " \u00b7 " + sClock + "\u2013" + eClock + tzTag;
    }
    return sLabel + " \u00b7 " + sClock + tzTag;
  }

  // Snooze helper: whole local days later, keeping the wall-clock time (DST-safe). Returns ms.
  const snoozeDays = (ms, n) => addDays(ms, Math.round(Number(n) || 0));
  // Convert a wall-clock date/time in a zone to an instant. During a fall-back overlap the earlier
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
    const fixed = zoneFixedOffset(validZone);
    if (fixed !== null) return targetWall - fixed * MIN;
    const targetEnd = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const formatter = zoneFormatter(validZone);
    if (!formatter) return null;
    // The clock of the zone at an instant, written as if it were UTC (whole minutes), or NaN.
    const wallAt = (at) => {
      const parts = Object.create(null);
      for (const part of formatter.formatToParts(new Date(at))) if (part.type !== "literal") parts[part.type] = Number(part.value);
      return [parts.year, parts.month, parts.day, parts.hour, parts.minute].every(Number.isFinite) ? Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) : NaN;
    };
    // The instant is the wall time minus the offset in force, and an offset is between -12 and +14 hours, so the
    // instant lies between 14 hours before and 12 hours after the wall time read as UTC. The offsets at those two
    // ends are the only candidates while the zone changes its clock at most once in between; the earlier instant
    // (the larger offset) is tried first, which is the first pass of a repeated hour. Each candidate is checked, so
    // a wrong guess costs time, never a wrong answer: what is left (a skipped time, or a zone that changed twice in
    // a day) is searched minute by minute as before OW-23, when every call paid for that search (1 to 6 ms).
    const before = targetWall - 14 * 60 * MIN, after = targetWall + 12 * 60 * MIN;
    const offsetBefore = wallAt(before) - before, offsetAfter = wallAt(after) - after;
    if (Number.isFinite(offsetBefore) && Number.isFinite(offsetAfter)) {
      const first = targetWall - Math.max(offsetBefore, offsetAfter), second = targetWall - Math.min(offsetBefore, offsetAfter);
      if (wallAt(first) === targetWall) return first;
      if (second !== first && wallAt(second) === targetWall) return second;
    }
    let exact = null, next = null, nextWall = Infinity;
    const from = targetWall - 16 * 60 * MIN, to = targetWall + 16 * 60 * MIN;
    for (let at = from; at <= to; at += MIN) {
      const wall = wallAt(at);
      if (!Number.isFinite(wall)) continue;
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
      const minutes = parseClock(time);
      if (!parseYmd(date) || minutes < 0) return null;
      return zonedDateTimeToMs(date, clockOfMinutes(minutes), zone);
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
        ...(previousX.src === "list" && category !== previousX.category ? { categoryOverride: category } : {}),
        tz: zone,
        src: previousX.src || "manual",
        calNote: String(input.calNote ?? previousX.calNote ?? "").slice(0, MAX_DESC),
        notify,
        agendaWindow: cleanAgendaWindow(input.agendaWindow === undefined ? previousX.agendaWindow : input.agendaWindow),
        moved,
      },
    };
    if (previousX.src === "list") {
      if (input.categoryOverride === null) delete record.x.categoryOverride;
      else if (typeof input.categoryOverride === "string") record.x.categoryOverride = cleanCategoryName(input.categoryOverride);
    }
    return cleanItem(record, now);
  }

  function snoozedItemStart(item, days = 1, targetMs = 0) {
    const start = cleanWhen(item?.start);
    if (!start) return null;
    const explicit = Number(targetMs);
    let moved;
    if (Number.isFinite(explicit) && explicit > 0) {
      moved = Math.floor(explicit);
    } else {
      const baseMs = whenMs(start);
      const stepDays = Math.round(Number(days) || 0);
      const zone = start.date ? "" : cleanZone(item?.x?.tz);
      if (zone && Number.isFinite(baseMs)) {
        const baseKey = zonedDateKey(baseMs, zone);
        const baseClock = clockIn(baseMs, zone);
        const baseDay = parseYmd(baseKey);
        if (baseDay && baseClock) {
          const nextKey = ymd(new Date(baseDay.getFullYear(), baseDay.getMonth(), baseDay.getDate() + stepDays));
          const zoned = zonedDateTimeToMs(nextKey, baseClock, zone);
          if (Number.isFinite(zoned) && zoned > 0) moved = zoned;
        }
      }
      if (!Number.isFinite(moved)) moved = snoozeDays(baseMs, stepDays);
    }
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
  // Compare JSON-shaped records by value, not property order: reading and
  // normalizing the same calendar file may reorder its object properties.
  function calendarRecordEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a), other = Object.keys(b);
    if (keys.length !== other.length) return false;
    return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && calendarRecordEqual(a[key], b[key]));
  }
  // Three-way snapshot merge. A missing item is a deletion, not an empty
  // value. Delete/edit races and simultaneous category edits cannot be
  // ordered from the current file format, so callers must not persist when
  // `safe` is false. Item conflicts use the existing last-write-wins rule.
  function mergeCalendarSnapshots(base, local, remote) {
    const conflicts = [];
    const equal = (a, b) => calendarRecordEqual(a ?? null, b ?? null);
    const index = (snapshot, field, keyOf) => {
      if (!snapshot || !Array.isArray(snapshot[field])) throw new Error("Invalid calendar " + field + " snapshot");
      const out = new Map();
      for (const record of snapshot[field]) {
        const key = keyOf(record);
        if (!key || out.has(key)) throw new Error("Invalid or duplicate calendar " + field + " key");
        out.set(key, record);
      }
      return out;
    };
    const merge = (field, kind, keyOf) => {
      const before = index(base, field, keyOf), mine = index(local, field, keyOf), theirs = index(remote, field, keyOf);
      const keys = new Set([...before.keys(), ...mine.keys(), ...theirs.keys()]), result = [];
      for (const id of keys) {
        const b = before.get(id) ?? null, l = mine.get(id) ?? null, r = theirs.get(id) ?? null;
        let chosen;
        if (equal(l, b)) chosen = r;
        else if (equal(r, b) || equal(l, r)) chosen = l;
        else if (kind === "item" && l && r) {
          chosen = lwwPick(l, r);
          conflicts.push({ kind, id, winner: chosen === l ? "local" : "remote" });
        } else {
          // Retain the extant value for inspection, but require a decision
          // before writing either side over the other.
          chosen = l || r;
          conflicts.push({ kind, id, winner: "unresolved" });
        }
        if (chosen) result.push(chosen);
      }
      return result;
    };
    const items = merge("items", "item", (v) => typeof v?.id === "string" ? v.id : "");
    const categories = merge("categories", "category", (v) => categoryKey(v?.name));
    return { items, categories, conflicts, safe: !conflicts.some((c) => c.winner === "unresolved") };
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

  // OW-07: '+' menu in All notes (New note, New folder, New reminder, New event, and Date note when Agenda is off),
  // remembering the last choice for a one-click default and falling back cleanly when Agenda hides Date note.
  const ALL_NOTES_NEW_CHOICES = Object.freeze(["note", "folder", "reminder", "event", "date"]);
  function cleanAllNotesNewChoice(value, { agendaEnabled = false, calendarAvailable = true } = {}) {
    const choice = typeof value === "string" ? value.trim() : "";
    if (!ALL_NOTES_NEW_CHOICES.includes(choice)) return "note";
    if (choice === "date" && agendaEnabled) return "note";
    if ((choice === "reminder" || choice === "event") && !calendarAvailable) return "note";
    return choice;
  }
  function allNotesNewMenuModel({ choice = "note", agendaEnabled = false, calendarAvailable = true, lang = DEFAULT_NOTES_LANGUAGE } = {}) {
    const activeChoice = cleanAllNotesNewChoice(choice, { agendaEnabled, calendarAvailable });
    const unavailableReason = calendarAvailable ? "" : t("menu.new.unavailableReason", null, lang);
    const entries = [
      { id: "note", icon: "plus", label: t("menu.new.note", null, lang), active: activeChoice === "note", enabled: true, reason: "" },
      { id: "folder", icon: "folder", label: t("menu.new.folder", null, lang), active: activeChoice === "folder", enabled: true, reason: "" },
      { id: "reminder", icon: "bell", label: t("menu.new.reminder", null, lang), active: activeChoice === "reminder", enabled: !!calendarAvailable, reason: unavailableReason },
      { id: "event", icon: "calendar-plus", label: t("menu.new.event", null, lang), active: activeChoice === "event", enabled: !!calendarAvailable, reason: unavailableReason },
    ];
    if (!agendaEnabled)
      entries.push({ id: "date", icon: "calendar", label: t("menu.new.date", null, lang), active: activeChoice === "date", enabled: true, reason: "" });
    return entries;
  }
  function allNotesNewButtonLabel(choice, opts = {}) {
    const lang = opts?.lang || DEFAULT_NOTES_LANGUAGE;
    const clean = cleanAllNotesNewChoice(choice, opts);
    if (clean === "folder") return t("menu.new.folder", null, lang);
    if (clean === "reminder") return t("menu.new.reminder", null, lang);
    if (clean === "event") return t("menu.new.event", null, lang);
    if (clean === "date") return t("menu.new.date", null, lang);
    return t("menu.new.noteShortcut", null, lang);
  }

  // OW-10: analog + digital Clock modes, locale 12h/24h detection, angle<->time math, snapping, and hand stepping.
  const CLOCK_MODES = Object.freeze(["both", "analog", "digital"]);
  function cleanClockMode(value) {
    const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
    return CLOCK_MODES.includes(mode) ? mode : "both";
  }
  function clockUses12Hour(locale) {
    try {
      const opts = new Intl.DateTimeFormat(locale || undefined, { hour: "numeric" }).resolvedOptions();
      if (typeof opts.hour12 === "boolean") return opts.hour12;
      return opts.hourCycle === "h11" || opts.hourCycle === "h12";
    } catch (_) {
      return false;
    }
  }
  function clockPointerAngle(dx, dy) {
    const x = Number(dx) || 0, y = Number(dy) || 0;
    const radius = Math.hypot(x, y);
    if (radius === 0) return { angleDeg: 0, radius: 0 };
    const angleDeg = ((Math.atan2(x, -y) * 180 / Math.PI) % 360 + 360) % 360;
    return { angleDeg, radius };
  }
  function clockAngleOfHour(hour24, { hour12 = false } = {}) {
    const h = ((Math.floor(Number(hour24) || 0) % 24) + 24) % 24;
    const slot = h % 12;
    return {
      hour: h,
      slot,
      angleDeg: slot * 30,
      inner: !hour12 && h >= 12,
      period: h >= 12 ? "PM" : "AM",
    };
  }
  function clockHourFromAngle(angleDeg, { hour12 = false, period = "AM", inner = false } = {}) {
    const deg = ((Number(angleDeg) || 0) % 360 + 360) % 360;
    const slot = Math.round(deg / 30) % 12;
    if (hour12) return String(period).toUpperCase() === "PM" ? slot + 12 : slot;
    return inner ? slot + 12 : slot;
  }
  function clockAngleOfMinute(minute) {
    const m = ((Math.floor(Number(minute) || 0) % 60) + 60) % 60;
    return m * 6;
  }
  const ANALOG_CLOCK_SNAP = 5;
  function clockMinuteFromAngle(angleDeg, snap = ANALOG_CLOCK_SNAP) {
    const deg = ((Number(angleDeg) || 0) % 360 + 360) % 360;
    const step = snap === 1 ? 1 : cleanCalendarSnap(snap);
    return (Math.round((deg / 6) / step) * step) % 60;
  }
  function stepClockHand(minutesOfDay, hand, deltaSteps = 1, { snap = ANALOG_CLOCK_SNAP } = {}) {
    const total = ((Math.floor(Number(minutesOfDay) || 0) % 1440) + 1440) % 1440;
    const h = Math.floor(total / 60), m = total % 60;
    const delta = Math.trunc(Number(deltaSteps) || 0);
    if (hand === "hour") {
      const nextH = ((h + delta) % 24 + 24) % 24;
      return clockOfMinutes(nextH * 60 + m);
    }
    const step = snap === 1 ? 1 : cleanCalendarSnap(snap);
    if (delta === 0) return clockOfMinutes(h * 60 + m);
    let nextM;
    if (m % step === 0) nextM = ((m + delta * step) % 60 + 60) % 60;
    else if (delta > 0) nextM = (((Math.floor(m / step) + delta) * step) % 60 + 60) % 60;
    else nextM = (((Math.ceil(m / step) + delta) * step) % 60 + 60) % 60;
    return clockOfMinutes(h * 60 + nextM);
  }
  function clockDialPoints({ hour12 = false } = {}) {
    const pt = (angleDeg, rPct) => {
      const rad = (angleDeg * Math.PI) / 180;
      return {
        xPct: Math.round((50 + rPct * Math.sin(rad)) * 100) / 100,
        yPct: Math.round((50 - rPct * Math.cos(rad)) * 100) / 100,
      };
    };
    const hours = [];
    for (let slot = 0; slot < 12; slot++) {
      const angleDeg = slot * 30;
      const disp = hour12 ? (slot === 0 ? 12 : slot) : slot;
      hours.push({
        value: slot,
        label: hour12 ? String(disp) : p2(disp),
        angleDeg,
        ring: "outer",
        ...pt(angleDeg, 39),
      });
      if (!hour12) {
        const innerVal = slot + 12;
        hours.push({
          value: innerVal,
          label: p2(innerVal),
          angleDeg,
          ring: "inner",
          ...pt(angleDeg, 24),
        });
      }
    }
    const minutes = [];
    for (let m = 0; m < 60; m += 5) {
      const angleDeg = m * 6;
      minutes.push({
        value: m,
        label: p2(m),
        angleDeg,
        ring: "outer",
        ...pt(angleDeg, 39),
      });
    }
    return { hours, minutes };
  }

  // ---- T3.6a: accessible color-palette contrast & surface-aware token derivation -------------------------
  const PALETTE_COLOR_HEX = Object.freeze({
    yellow: "#f5c542",
    green: "#4cc38a",
    blue: "#5aa9ff",
    pink: "#ff7eb6",
    purple: "#a78bfa",
    orange: "#ff9f43",
    red: "#ff6b6b",
    teal: "#2ec4b6",
    gray: "#9aa0a6",
    brown: "#a1887f",
    lime: "#b5d334",
    cyan: "#4dd0e1",
  });
  const CSS_NAMED_HEX = Object.freeze({
    white: "#ffffff",
    black: "#000000",
    gray: "#808080",
    grey: "#808080",
  });
  const NOTE_THEME_SURFACES = Object.freeze({
    light: Object.freeze({ scheme: "light", surface: "#fbfbfd", text: "#1d1d22", accent: "#3b6df0", line: "#dcdce4" }),
    dark: Object.freeze({ scheme: "dark", surface: "#17171c", text: "#e9e9f0", accent: "#83a5ff", line: "#31313a" }),
    paper: Object.freeze({ scheme: "light", surface: "#f4ecd8", text: "#3b3226", accent: "#9a6b2f", line: "#d5cbb4" }),
    recommended: Object.freeze({
      light: Object.freeze({ scheme: "light", surface: "#ffffff", text: "#18181b", accent: "#2459b4", line: "#d0d0d7" }),
      dark: Object.freeze({ scheme: "dark", surface: "#1f1f24", text: "#eeeeee", accent: "#9bbdff", line: "#44444c" }),
    }),
    zentral: Object.freeze({
      light: Object.freeze({ scheme: "light", surface: "#f5f5f8", text: "#1c1c22", accent: "#2f62d9", line: "#d4d4dc" }),
      dark: Object.freeze({ scheme: "dark", surface: "#1e1e24", text: "#e9e9f0", accent: "#83a5ff", line: "#363640" }),
    }),
  });

  function clampByte(n) {
    return Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
  }
  function rgbToHex(rgb) {
    if (!rgb || typeof rgb !== "object") return "";
    return "#" + [rgb.r, rgb.g, rgb.b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("");
  }
  function parseColorRgb(input, surfaceHex = "#1e1e24") {
    if (!input) return null;
    if (typeof input === "object" && Number.isFinite(input.r) && Number.isFinite(input.g) && Number.isFinite(input.b)) {
      return { r: clampByte(input.r), g: clampByte(input.g), b: clampByte(input.b) };
    }
    const raw = String(input).trim().toLowerCase();
    if (!raw) return null;
    if (raw === "transparent") return surfaceHex ? parseColorRgb(surfaceHex, null) : { r: 30, g: 30, b: 36 };
    const named = PALETTE_COLOR_HEX[raw] || CSS_NAMED_HEX[raw];
    if (named) return parseColorRgb(named, surfaceHex);
    const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(raw);
    if (hex3) {
      return {
        r: parseInt(hex3[1] + hex3[1], 16),
        g: parseInt(hex3[2] + hex3[2], 16),
        b: parseInt(hex3[3] + hex3[3], 16),
      };
    }
    const hex6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(raw);
    if (hex6) {
      const r = parseInt(hex6[1], 16), g = parseInt(hex6[2], 16), b = parseInt(hex6[3], 16);
      if (!hex6[4]) return { r, g, b };
      const a = parseInt(hex6[4], 16) / 255;
      const bg = (surfaceHex && parseColorRgb(surfaceHex, null)) || { r: 30, g: 30, b: 36 };
      return {
        r: clampByte(r * a + bg.r * (1 - a)),
        g: clampByte(g * a + bg.g * (1 - a)),
        b: clampByte(b * a + bg.b * (1 - a)),
      };
    }
    const fn = /^rgba?\(([^)]+)\)$/.exec(raw);
    if (fn) {
      const parts = fn[1].replace(/\//g, " ").trim().split(/[\s,]+/).filter(Boolean);
      if (parts.length >= 3) {
        const ch = (s) => (s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s));
        const r = clampByte(ch(parts[0])), g = clampByte(ch(parts[1])), b = clampByte(ch(parts[2]));
        let a = 1;
        if (parts[3] !== undefined) a = Math.max(0, Math.min(1, parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])));
        if (a >= 0.999) return { r, g, b };
        const bg = (surfaceHex && parseColorRgb(surfaceHex, null)) || { r: 30, g: 30, b: 36 };
        return {
          r: clampByte(r * a + bg.r * (1 - a)),
          g: clampByte(g * a + bg.g * (1 - a)),
          b: clampByte(b * a + bg.b * (1 - a)),
        };
      }
    }
    return null;
  }
  function relativeLuminance(color, surfaceHex) {
    const rgb = parseColorRgb(color, surfaceHex);
    if (!rgb) return 0;
    const lin = (v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  }
  function contrastRatio(fg, bg) {
    const l1 = relativeLuminance(fg, typeof bg === "string" ? bg : undefined);
    const l2 = relativeLuminance(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function mixSrgb(colorA, colorB, weightA = 0.5) {
    const w = Math.max(0, Math.min(1, Number(weightA)));
    const a = parseColorRgb(colorA) || { r: 128, g: 128, b: 128 };
    const b = parseColorRgb(colorB) || { r: 30, g: 30, b: 36 };
    return rgbToHex({
      r: a.r * w + b.r * (1 - w),
      g: a.g * w + b.g * (1 - w),
      b: a.b * w + b.b * (1 - w),
    });
  }
  function colorHsl(color) {
    const rgb = parseColorRgb(color);
    if (!rgb) return null;
    const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (d > 1e-7) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / d + 2) * 60;
      else h = ((r - g) / d + 4) * 60;
    }
    return { h: ((h % 360) + 360) % 360, s: s * 100, l: l * 100 };
  }
  function hslToHex(h, s, l) {
    const hh = (((Number(h) || 0) % 360) + 360) % 360;
    const ss = Math.max(0, Math.min(100, Number(s) || 0)) / 100;
    const ll = Math.max(0, Math.min(100, Number(l) || 0)) / 100;
    const c = (1 - Math.abs(2 * ll - 1)) * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = ll - c / 2;
    let r = 0, g = 0, b = 0;
    if (hh < 60) [r, g, b] = [c, x, 0];
    else if (hh < 120) [r, g, b] = [x, c, 0];
    else if (hh < 180) [r, g, b] = [0, c, x];
    else if (hh < 240) [r, g, b] = [0, x, c];
    else if (hh < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
  }
  function hueDistanceDeg(colorA, colorB) {
    const a = colorHsl(colorA), b = colorHsl(colorB);
    if (!a || !b || a.s < 2 || b.s < 2) return 0;
    const diff = Math.abs(a.h - b.h) % 360;
    return diff > 180 ? 360 - diff : diff;
  }
  function splitCssArgs(inner) {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === "(") depth++;
      else if (ch === ")" && depth > 0) depth--;
      else if (ch === "," && depth === 0) {
        out.push(inner.slice(start, i).trim());
        start = i + 1;
      }
    }
    const tail = inner.slice(start).trim();
    if (tail) out.push(tail);
    return out;
  }
  function resolveCssColor(expr, surfaceSpec = null) {
    const surfaceHex = surfaceSpec?.surface || "#1e1e24";
    const isLight = surfaceSpec ? !!surfaceSpec.isLight : relativeLuminance(surfaceHex) > 0.35;
    const raw = String(expr || "").trim();
    if (!raw) return "";
    const direct = parseColorRgb(raw, surfaceHex);
    if (direct) return rgbToHex(direct);
    const lower = raw.toLowerCase();
    if (lower.startsWith("light-dark(") && raw.endsWith(")")) {
      const args = splitCssArgs(raw.slice(11, -1));
      if (args.length >= 2) return resolveCssColor(isLight ? args[0] : args[1], surfaceSpec);
    }
    if (lower.startsWith("color-mix(") && raw.endsWith(")")) {
      const args = splitCssArgs(raw.slice(10, -1));
      if (args.length >= 3 && /^in\s+srgb/i.test(args[0])) {
        const parseStop = (token) => {
          const m = /^(.*?)\s+(-?\d+(?:\.\d+)?)%\s*$/.exec(token.trim());
          if (m) return { color: m[1].trim(), pct: Math.max(0, Math.min(100, parseFloat(m[2]))) };
          return { color: token.trim(), pct: null };
        };
        const a = parseStop(args[1]), b = parseStop(args[2]);
        const ca = resolveCssColor(a.color, surfaceSpec) || surfaceHex;
        const cb = resolveCssColor(b.color, surfaceSpec) || surfaceHex;
        let wa = 0.5;
        if (a.pct !== null && b.pct !== null) {
          const sum = a.pct + b.pct;
          if (sum <= 0) return surfaceHex;
          const mixed = mixSrgb(ca, cb, a.pct / sum);
          return sum < 100 ? mixSrgb(mixed, surfaceHex, sum / 100) : mixed;
        }
        if (a.pct !== null) wa = a.pct / 100;
        else if (b.pct !== null) wa = 1 - b.pct / 100;
        return mixSrgb(ca, cb, wa);
      }
    }
    return "";
  }
  function ensureContrastHex(seedColor, bgOrBgs, minRatio = 4.5, options = {}) {
    const bgs = (Array.isArray(bgOrBgs) ? bgOrBgs : [bgOrBgs])
      .map((b) => rgbToHex(parseColorRgb(b)))
      .filter(Boolean);
    if (!bgs.length) return rgbToHex(parseColorRgb(seedColor)) || "#83a5ff";
    const seedRgb = parseColorRgb(seedColor, bgs[0]) || { r: 131, g: 165, b: 255 };
    const seedHex = rgbToHex(seedRgb);
    const passes = (hex) => bgs.every((bg) => contrastRatio(hex, bg) >= minRatio);
    if (passes(seedHex)) return seedHex;
    const hsl = colorHsl(seedRgb) || { h: 220, s: 0, l: 50 };
    const sat = options.desaturate ? Math.min(hsl.s, options.maxSat ?? 45) : hsl.s;
    const avgLum = bgs.reduce((acc, bg) => acc + relativeLuminance(bg), 0) / bgs.length;
    const solveDir = (darken) => {
      const poleL = darken ? 0 : 100;
      const poleHex = hslToHex(hsl.h, sat, poleL);
      if (!passes(poleHex)) return "";
      let far = poleL, near = hsl.l;
      for (let i = 0; i < 24; i++) {
        const mid = (far + near) / 2;
        if (passes(hslToHex(hsl.h, sat, mid))) far = mid;
        else near = mid;
      }
      return hslToHex(hsl.h, sat, far);
    };
    const preferDark = avgLum >= 0.179;
    const first = solveDir(preferDark);
    if (first) return first;
    const second = solveDir(!preferDark);
    if (second) return second;
    const blackMin = Math.min(...bgs.map((b) => contrastRatio("#000000", b)));
    const whiteMin = Math.min(...bgs.map((b) => contrastRatio("#ffffff", b)));
    return blackMin >= whiteMin ? "#000000" : "#ffffff";
  }
  function resolveThemeSurface(theme = "zentral", options = {}) {
    const cleanTheme = Object.prototype.hasOwnProperty.call(NOTE_THEME_SURFACES, theme) ? theme : "zentral";
    const reqScheme = options.scheme === "light" ? "light" : options.scheme === "dark" ? "dark" : "";
    const baseEntry = NOTE_THEME_SURFACES[cleanTheme];
    let base = baseEntry.surface ? baseEntry : baseEntry[reqScheme || "dark"];
    if ((cleanTheme === "zentral" || cleanTheme === "recommended") && !reqScheme && options.hostSurface) {
      const hostLum = relativeLuminance(options.hostSurface);
      base = baseEntry[hostLum > 0.35 ? "light" : "dark"];
    }
    const ov = options.overrides && typeof options.overrides === "object" ? options.overrides : {};
    const rawSurface = ov.bg || (cleanTheme === "zentral" || cleanTheme === "recommended" ? options.hostSurface : "") || base.surface;
    const surface = rgbToHex(parseColorRgb(rawSurface)) || base.surface;
    const isLight = relativeLuminance(surface) > 0.35;
    const scheme = isLight ? "light" : "dark";
    if (!baseEntry.surface) base = baseEntry[scheme];
    const rawText = ov.text || (cleanTheme === "zentral" || cleanTheme === "recommended" ? options.hostText : "") || (isLight ? "#1c1c22" : "#e9e9f0");
    const text = ensureContrastHex(rawText, surface, 7.0);
    const mutedSeed = mixSrgb(text, surface, 0.68);
    const muted = ensureContrastHex(mutedSeed, surface, 4.55);
    const lineSeed = options.hostLine || mixSrgb(text, surface, isLight ? 0.18 : 0.22);
    const line = rgbToHex(parseColorRgb(lineSeed, surface)) || base.line;
    let rawAccent = ov.accent || (cleanTheme === "zentral" ? options.hostAccent : "") || base.accent;
    const accentHsl = colorHsl(rawAccent);
    // Zen's primary color can be pure black/near-gray on dark workspaces; fall back to the theme's chromatic accent when hostAccent is achromatic and clashes with surface.
    if (!ov.accent && cleanTheme === "zentral" && options.hostAccent && accentHsl && accentHsl.s < 8 && contrastRatio(rawAccent, surface) < 3.0) {
      rawAccent = base.accent;
    }
    const accent = ensureContrastHex(rawAccent, surface, 4.55);
    const accentOutline = ensureContrastHex(rawAccent, surface, 3.1);
    const accentFill = ensureContrastHex(rawAccent, surface, 3.0);
    const onWhite = contrastRatio("#ffffff", accentFill);
    const darkInk = isLight ? "#101826" : "#10141d";
    const onDark = contrastRatio(darkInk, accentFill);
    const accentOnFill = onWhite >= 4.5 && onWhite >= onDark ? "#ffffff" : onDark >= 4.5 ? darkInk : ensureContrastHex(darkInk, accentFill, 4.55);
    return Object.freeze({
      theme: cleanTheme,
      scheme,
      isLight,
      surface,
      text,
      muted,
      line,
      accent,
      accentOutline,
      accentFill,
      accentOnFill,
    });
  }
  const paletteTokenCache = new Map();
  function derivePaletteTokens(rawColor, surfaceInput, options = {}) {
    const surfaceSpec = surfaceInput?.surface && surfaceInput?.text
      ? surfaceInput
      : resolveThemeSurface(typeof surfaceInput === "string" ? surfaceInput : "dark");
    const kind = options.kind === "time" ? "time" : options.kind === "calendar" ? "calendar" : "swatch";
    const sourceHex = rgbToHex(parseColorRgb(rawColor, surfaceSpec.surface)) || surfaceSpec.accent;
    const cacheKey = `${sourceHex}|${surfaceSpec.surface}|${surfaceSpec.text}|${kind}`;
    if (paletteTokenCache.has(cacheKey)) return paletteTokenCache.get(cacheKey);

    const tintSeed = ensureContrastHex(sourceHex, surfaceSpec.surface, 3.1);
    const weights = kind === "time"
      ? (surfaceSpec.isLight ? [0.15, 0.22, 0.28] : [0.18, 0.25, 0.31])
      : (surfaceSpec.isLight ? [0.11, 0.18, 0.25] : [0.13, 0.20, 0.27]);
    const bg = mixSrgb(tintSeed, surfaceSpec.surface, weights[0]);
    const hoverBg = mixSrgb(tintSeed, surfaceSpec.surface, weights[1]);
    const selectedBg = mixSrgb(tintSeed, surfaceSpec.surface, weights[2]);
    const allBgs = [surfaceSpec.surface, bg, hoverBg, selectedBg];

    const outline = ensureContrastHex(sourceHex, [surfaceSpec.surface, bg, hoverBg], 3.08);
    const selectedOutline = ensureContrastHex(sourceHex, [surfaceSpec.surface, selectedBg], 3.4);
    const hueFg = ensureContrastHex(sourceHex, allBgs, 4.6);
    const textFg = ensureContrastHex(surfaceSpec.text, allBgs, 4.6);
    const fg = kind === "swatch" ? hueFg : textFg;
    const mutedSeed = mixSrgb(tintSeed, surfaceSpec.text, 0.32);
    const muted = ensureContrastHex(mutedSeed, allBgs, 4.6);
    const hoverFg = ensureContrastHex(fg, [hoverBg], 4.6);
    const selectedFg = ensureContrastHex(kind === "swatch" ? hueFg : textFg, [selectedBg], 4.6);

    const disabledBg = mixSrgb(tintSeed, surfaceSpec.surface, 0.06);
    const disabledSeed = mixSrgb(outline, surfaceSpec.surface, 0.38);
    const disabledFg = ensureContrastHex(disabledSeed, [surfaceSpec.surface, disabledBg], 3.15, { desaturate: true, maxSat: 48 });
    const disabledOutline = mixSrgb(outline, surfaceSpec.surface, 0.45);

    const hlBg = mixSrgb(tintSeed, surfaceSpec.surface, surfaceSpec.isLight ? 0.30 : 0.28);
    const hlFg = ensureContrastHex(surfaceSpec.text, [hlBg], 4.6);

    const out = Object.freeze({
      source: sourceHex,
      bg,
      fg,
      hueFg,
      muted,
      outline,
      hoverBg,
      hoverFg,
      hoverOutline: selectedOutline,
      selectedBg,
      selectedFg,
      selectedOutline,
      disabledBg,
      disabledFg,
      disabledOutline,
      hlBg,
      hlFg,
    });
    if (paletteTokenCache.size > 1024) paletteTokenCache.clear();
    paletteTokenCache.set(cacheKey, out);
    return out;
  }
  function resolveFolderSurfaceTokens(resolvedVisual, surfaceInput) {
    const surfaceSpec = surfaceInput?.surface && surfaceInput?.text
      ? surfaceInput
      : resolveThemeSurface(typeof surfaceInput === "string" ? surfaceInput : "dark");
    const props = resolvedVisual?.properties || {};
    const parts = resolvedVisual?.parts || {};
    const seedHex = resolveCssColor(resolvedVisual?.base || parts.accent || parts.front || parts.back || parts.label || surfaceSpec.accent, surfaceSpec) || surfaceSpec.accent;
    const baseTokens = derivePaletteTokens(seedHex, surfaceSpec, { kind: "swatch" });

    const rawTint = resolveCssColor(props["--tab-group-color-pale"], surfaceSpec);
    const tint = rawTint && Math.abs(relativeLuminance(rawTint) - relativeLuminance(surfaceSpec.surface)) <= 0.25
      ? rawTint
      : baseTokens.bg;
    const rawHover = resolveCssColor(props["--tab-group-background-color-hover"], surfaceSpec);
    const hover = rawHover && rawHover !== surfaceSpec.surface && Math.abs(relativeLuminance(rawHover) - relativeLuminance(surfaceSpec.surface)) <= 0.30
      ? rawHover
      : baseTokens.hoverBg;
    const selected = baseTokens.selectedBg;
    const rowBgs = [surfaceSpec.surface, tint, hover, selected];

    const rawStroke = resolveCssColor(props["--zen-folder-stroke"], surfaceSpec) || seedHex;
    const stroke = ensureContrastHex(rawStroke, [surfaceSpec.surface, tint], 3.08);
    const rawLabel = resolveCssColor(props["--bgalazka-fc-label"], surfaceSpec) || surfaceSpec.text;
    const label = props["--bgalazka-fc-label"]
      ? ensureContrastHex(rawLabel, rowBgs, 4.6)
      : ensureContrastHex(surfaceSpec.text, rowBgs, 4.6);
    const rawAccent = resolveCssColor(props["--tab-group-color"], surfaceSpec) || seedHex;
    const accent = ensureContrastHex(rawAccent, rowBgs, 4.6);

    return Object.freeze({
      tint,
      hover,
      selected,
      stroke,
      label,
      accent,
      disabledBg: baseTokens.disabledBg,
      disabledFg: baseTokens.disabledFg,
      disabledOutline: baseTokens.disabledOutline,
    });
  }

  // OW-11: pure resolver describing what 'Inherit' gives (and which layer provides it) across
  // Agenda window, item colour (T2.3g), category stage notify defaults, alert sound/quietAllow,
  // and note-section category inheritance.
  function describeInheritance(kind, item = null, layers = {}) {
    const k = String(kind || "").trim();
    const srcLayers = layers && typeof layers === "object" ? layers : {};
    const noteObj = srcLayers.note && typeof srcLayers.note === "object" ? srcLayers.note : {};
    const catObj = srcLayers.category && typeof srcLayers.category === "object" ? srcLayers.category : {};
    const globalObj = srcLayers.global && typeof srcLayers.global === "object" ? srcLayers.global : {};
    const noteTitle = String(noteObj.title ?? srcLayers.noteTitle ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const catName = cleanCategoryName(catObj.name ?? srcLayers.categoryName ?? "");
    const hasCategory = Boolean(catName || srcLayers.category || srcLayers.categoryNotify || srcLayers.categoryAgenda || srcLayers.categoryColor);
    const noteSourceLabel = noteTitle ? "note " + noteTitle : "linked note";
    const catSourceLabel = catName ? "category " + catName : "category";
    const pack = (value, source, sourceName, valueLabel, sourceLabel, labelOverride = "", inherited = null) => ({
      value,
      source,
      sourceName,
      valueLabel,
      sourceLabel,
      label: labelOverride || ("Inherit (" + valueLabel + ", from " + sourceLabel + ")"),
      ...(inherited ? { inherited } : {}),
    });

    const agendaKeyMap = {
      "agenda.enabled": "enabled", agendaEnabled: "enabled",
      "agenda.leadDays": "leadDays", agendaLeadDays: "leadDays",
      "agenda.tailDays": "tailDays", agendaTailDays: "tailDays",
    };
    if (Object.prototype.hasOwnProperty.call(agendaKeyMap, k)) {
      const key = agendaKeyMap[k];
      const fallback = key === "enabled" ? true : 0;
      const fmt = (v) => key === "enabled"
        ? (v ? "Show in Agenda" : "Hide from Agenda")
        : (v === 0 ? "Same day" : v === 1 ? "1 day" : v + " days");
      const noteAgenda = cleanAgendaWindow(noteObj.agenda ?? srcLayers.noteAgenda);
      const catAgenda = cleanAgendaWindow(catObj.agenda ?? srcLayers.categoryAgenda);
      const globalAgenda = cleanAgendaWindow(globalObj.agenda ?? srcLayers.globalAgenda);
      let inherited;
      if (Object.prototype.hasOwnProperty.call(noteAgenda, key)) {
        inherited = pack(noteAgenda[key], "note", noteTitle, fmt(noteAgenda[key]), noteSourceLabel);
      } else if (Object.prototype.hasOwnProperty.call(catAgenda, key)) {
        inherited = pack(catAgenda[key], "category", catName, fmt(catAgenda[key]), catSourceLabel);
      } else {
        const val = Object.prototype.hasOwnProperty.call(globalAgenda, key) ? globalAgenda[key] : fallback;
        inherited = pack(val, "global", "", fmt(val), "global defaults");
      }
      const itemAgenda = cleanAgendaWindow(item?.x?.agendaWindow);
      if (Object.prototype.hasOwnProperty.call(itemAgenda, key)) {
        return pack(itemAgenda[key], "item", "", fmt(itemAgenda[key]), "this item", fmt(itemAgenda[key]), inherited);
      }
      return inherited;
    }

    if (k === "color" || k === "colour") {
      const rawNote = String(noteObj.color ?? srcLayers.noteColor ?? "").trim();
      const rawCat = String(catObj.color ?? srcLayers.categoryColor ?? "").trim();
      const resolved = resolveItemColor(rawNote, rawCat);
      if (resolved && rawNote && rawNote !== "none") {
        const lower = rawNote.toLowerCase();
        const hex = PALETTE_COLOR_HEX[lower] || resolveCssColor(rawNote) || rawNote;
        const valLabel = PALETTE_COLOR_HEX[lower] ? (lower + " " + hex) : hex;
        const srcLbl = noteTitle ? ("note " + noteTitle + " colour") : "note colour";
        return pack(hex, "note", noteTitle, valLabel, srcLbl, "Inherit (" + srcLbl + ": " + valLabel + ")");
      }
      if (resolved && rawCat && rawCat !== "none") {
        const lower = rawCat.toLowerCase();
        const hex = PALETTE_COLOR_HEX[lower] || resolveCssColor(rawCat) || rawCat;
        const valLabel = PALETTE_COLOR_HEX[lower] ? (lower + " " + hex) : hex;
        const srcLbl = catName ? ("category " + catName + " colour") : "category colour";
        return pack(hex, "category", catName, valLabel, srcLbl, "Inherit (" + srcLbl + ": " + valLabel + ")");
      }
      return pack("", "none", "", "none", "default accent", "Inherit (no note or category colour)");
    }

    const notifyMatch = /^notify\.(pre|due|followup)(?:\.(enabled|leadMinutes|delayMinutes))?$/.exec(k);
    if (notifyMatch) {
      const stage = notifyMatch[1], field = notifyMatch[2] || "";
      const catNotify = cleanCategoryNotify(catObj.notify ?? srcLayers.categoryNotify);
      const baseRule = catNotify[stage];
      const baseSource = hasCategory ? "category" : "global";
      const baseSourceName = hasCategory ? catName : "";
      const baseSourceLabel = hasCategory ? catSourceLabel : "global defaults";
      const itemRule = cleanNotifyOverrides(item?.x?.notify)[stage];
      if (field) {
        const fmtField = (v) => field === "enabled" ? (v ? "On" : "Off") : (v + " min");
        const inh = pack(baseRule[field], baseSource, baseSourceName, fmtField(baseRule[field]), baseSourceLabel);
        if (itemRule && Object.prototype.hasOwnProperty.call(itemRule, field)) {
          return pack(itemRule[field], "item", "", fmtField(itemRule[field]), "this item", fmtField(itemRule[field]), inh);
        }
        return inh;
      }
      const pickShape = (r) => stage === "pre"
        ? { enabled: r.enabled, leadMinutes: r.leadMinutes }
        : stage === "followup"
          ? { enabled: r.enabled, delayMinutes: r.delayMinutes }
          : { enabled: r.enabled };
      const fmtStage = (r) => !r.enabled
        ? "Off"
        : stage === "pre"
          ? ("On, " + r.leadMinutes + " min")
          : stage === "followup"
            ? ("On, " + r.delayMinutes + " min")
            : "On";
      const inhShape = pickShape(baseRule);
      const inh = pack(inhShape, baseSource, baseSourceName, fmtStage(inhShape), baseSourceLabel);
      if (itemRule && (Object.prototype.hasOwnProperty.call(itemRule, "enabled") || Object.prototype.hasOwnProperty.call(itemRule, "leadMinutes") || Object.prototype.hasOwnProperty.call(itemRule, "delayMinutes"))) {
        const merged = pickShape({ ...baseRule, ...itemRule });
        return pack(merged, "item", "", fmtStage(merged), "this item", fmtStage(merged), inh);
      }
      return inh;
    }

    const alertMatch = /^alert\.(pre|due|followup)\.(sound|quietAllow)$/.exec(k);
    if (alertMatch) {
      const stage = alertMatch[1], prop = alertMatch[2];
      const globalAlert = cleanAlertSettings(globalObj.alert ?? srcLayers.globalAlert);
      const catStage = cleanCategoryNotify(catObj.notify ?? srcLayers.categoryNotify)[stage];
      const noteStage = cleanNotifyOverrides(noteObj.notify ?? srcLayers.noteNotify)[stage] || {};
      const itemStage = cleanNotifyOverrides(item?.x?.notify)[stage] || {};
      if (prop === "sound") {
        const hasSound = (r) => Boolean(r && (r.soundSpecified === true || (r.soundSpecified === undefined && SOUND_LEVELS.includes(r.sound))));
        const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : "Normal";
        let inh;
        if (hasSound(noteStage)) inh = pack(noteStage.sound, "note", noteTitle, cap(noteStage.sound), noteSourceLabel);
        else if (hasSound(catStage)) inh = pack(catStage.sound, "category", catName, cap(catStage.sound), catSourceLabel);
        else {
          const gSound = globalAlert.stages[stage].sound || "normal";
          inh = pack(gSound, "global", "", cap(gSound), "global defaults");
        }
        if (hasSound(itemStage)) return pack(itemStage.sound, "item", "", cap(itemStage.sound), "this item", cap(itemStage.sound), inh);
        return inh;
      }
      const hasAllow = (r) => Boolean(r && (r.quietAllowSpecified === true || (r.quietAllowSpecified === undefined && Array.isArray(r.quietAllow))));
      const fmtAllow = (arr) => arr.length ? arr.join(", ") : "none";
      let inh;
      if (hasAllow(noteStage)) inh = pack([...noteStage.quietAllow], "note", noteTitle, fmtAllow(noteStage.quietAllow), noteSourceLabel);
      else if (hasAllow(catStage)) inh = pack([...catStage.quietAllow], "category", catName, fmtAllow(catStage.quietAllow), catSourceLabel);
      else {
        const gAllow = [...globalAlert.quietHours.allowed[stage]];
        inh = pack(gAllow, "global", "", fmtAllow(gAllow), "global defaults");
      }
      if (hasAllow(itemStage)) return pack([...itemStage.quietAllow], "item", "", fmtAllow(itemStage.quietAllow), "this item", fmtAllow(itemStage.quietAllow), inh);
      return inh;
    }

    if (k === "category") {
      const sec = cleanCategoryName(srcLayers.sectionCategory ?? item?._sectionCategory ?? item?.x?.category ?? "");
      const valLabel = sec || "no category";
      const srcLabel = noteTitle ? ("note " + noteTitle + " section") : "note section";
      const inh = pack(sec, "note", noteTitle, valLabel, srcLabel);
      if (typeof item?.x?.categoryOverride === "string") {
        const ov = cleanCategoryName(item.x.categoryOverride);
        return pack(ov, "item", "", ov || "no category", "this item", ov || "no category", inh);
      }
      return inh;
    }

    return pack(null, "none", "", "", "none", "Inherit");
  }

  // ---- T2.10: Work-free-day tint + offline selectable holiday calendars ----
  const HOLIDAY_REGIONS = Object.freeze(["none", "PL", "DE", "GB", "US", "EG"]);
  const WEEKEND_PRESETS = Object.freeze(["auto", "sat-sun", "fri-sat", "none"]);
  const HOLIDAY_PERSONAL_MAX = 200;
  const holidayYearCache = new Map();

  function pad2(n) { return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, "0"); }
  function ymdParts(year, month, day) { return `${year}-${pad2(month)}-${pad2(day)}`; }
  function weekdayOfYmd(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    if (!m) return -1;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)).getUTCDay();
  }
  function shiftYmd(key, deltaDays) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    if (!m) return "";
    const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Math.trunc(Number(deltaDays) || 0), 12, 0, 0));
    return ymdParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  // Anonymous Gregorian Easter Sunday algorithm (Meeus/Jones/Butcher).
  function easterSundayYmd(year) {
    const y = Math.trunc(Number(year));
    if (!Number.isFinite(y) || y < 1583 || y > 9999) return "";
    const a = y % 19;
    const b = Math.floor(y / 100);
    const c = y % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return ymdParts(y, month, day);
  }
  // nth > 0: 1st..5th occurrence of weekday (0=Sun..6=Sat) in month (1..12); nth < 0: last (-1).
  function nthWeekdayYmd(year, month, weekday, nth) {
    const y = Math.trunc(Number(year)), mo = Math.trunc(Number(month)), wd = Math.trunc(Number(weekday)), n = Math.trunc(Number(nth));
    if (!Number.isFinite(y) || mo < 1 || mo > 12 || wd < 0 || wd > 6 || !n) return "";
    if (n > 0) {
      const firstWd = new Date(Date.UTC(y, mo - 1, 1, 12, 0, 0)).getUTCDay();
      const day = 1 + ((wd - firstWd + 7) % 7) + (n - 1) * 7;
      const dt = new Date(Date.UTC(y, mo - 1, day, 12, 0, 0));
      return dt.getUTCMonth() + 1 === mo ? ymdParts(y, mo, day) : "";
    }
    const lastDay = new Date(Date.UTC(y, mo, 0, 12, 0, 0)).getUTCDate();
    const lastWd = new Date(Date.UTC(y, mo - 1, lastDay, 12, 0, 0)).getUTCDay();
    const day = lastDay - ((lastWd - wd + 7) % 7) + (n + 1) * 7;
    return day >= 1 ? ymdParts(y, mo, day) : "";
  }
  function regionWeekendDays(region) {
    const code = HOLIDAY_REGIONS.includes(region) ? region : "none";
    return code === "EG" ? [5, 6] : [6, 0];
  }
  function weekendDaysFor(prefs) {
    const clean = cleanCalendarHolidays(prefs);
    if (clean.weekend === "none") return [];
    if (clean.weekend === "fri-sat") return [5, 6];
    if (clean.weekend === "sat-sun") return [6, 0];
    return regionWeekendDays(clean.region);
  }
  function defaultHolidayRegion(locale) {
    const parts = String(locale || "").trim().replace(/_/g, "-").split("-").filter(Boolean);
    const regionPart = parts.slice(1).find((part) => /^[a-z]{2}$/i.test(part));
    if (regionPart) {
      const region = regionPart.toUpperCase();
      return HOLIDAY_REGIONS.includes(region) && region !== "none" ? region : "none";
    }
    const language = String(parts[0] || "").toLowerCase();
    return language === "pl" ? "PL" : language === "de" ? "DE" : "none";
  }
  function cleanCalendarHolidays(raw, locale = "") {
    const src = raw && typeof raw === "object" ? raw : {};
    const enabled = src.enabled !== false;
    const regionExplicit = src.regionExplicit === true;
    const storedRegion = HOLIDAY_REGIONS.includes(src.region) ? src.region : null;
    const region = storedRegion && (storedRegion !== "none" || regionExplicit) ? storedRegion : defaultHolidayRegion(locale);
    const weekend = WEEKEND_PRESETS.includes(src.weekend) ? src.weekend : "auto";
    const personalMap = new Map();
    const list = Array.isArray(src.personalDays) ? src.personalDays : [];
    for (const entry of list) {
      if (personalMap.size >= HOLIDAY_PERSONAL_MAX) break;
      const date = typeof entry === "string" ? entry.trim() : String(entry?.date || "").trim();
      if (!parseYmd(date)) continue;
      const label = typeof entry === "string" ? "" : String(entry?.label || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 80);
      personalMap.set(date, { date, label });
    }
    const personalDays = [...personalMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { enabled, region, regionExplicit, weekend, personalDays };
  }
  function addPersonalDayOff(prefs, dateKey, label = "") {
    const clean = cleanCalendarHolidays(prefs);
    const key = typeof dateKey === "string" ? dateKey.trim() : localDateKey(dateKey);
    if (!parseYmd(key)) return clean;
    const nextLabel = String(label || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 80);
    const filtered = clean.personalDays.filter((entry) => entry.date !== key);
    if (filtered.length >= HOLIDAY_PERSONAL_MAX) return clean;
    return cleanCalendarHolidays({ ...clean, personalDays: [...filtered, { date: key, label: nextLabel }] });
  }
  function removePersonalDayOff(prefs, dateKey) {
    const clean = cleanCalendarHolidays(prefs);
    const key = typeof dateKey === "string" ? dateKey.trim() : localDateKey(dateKey);
    return cleanCalendarHolidays({ ...clean, personalDays: clean.personalDays.filter((entry) => entry.date !== key) });
  }
  function holidaysFor(region, year, lang = "en") {
    const code = HOLIDAY_REGIONS.includes(region) ? region : "none";
    const y = Math.trunc(Number(year));
    const lc = cleanNotesLanguage(lang);
    if (code === "none" || !Number.isFinite(y) || y < 1900 || y > 2100) return [];
    const cacheKey = `${code}:${y}:${lc}`;
    if (holidayYearCache.has(cacheKey)) return holidayYearCache.get(cacheKey);
    const pl = lc === "pl";
    const pick = (enName, plName) => (pl ? plName : enName);
    const out = [];
    const add = (date, name) => { if (date && name) out.push({ date, name, kind: "holiday" }); };
    const easter = easterSundayYmd(y);
    const observedSuffix = pl ? " (dzie\u0144 zast\u0119pczy)" : " (Observed)";
    const substituteSuffix = pl ? " (dzie\u0144 zast\u0119pczy)" : " (Substitute)";

    if (code === "PL") {
      add(ymdParts(y, 1, 1), pick("New Year's Day", "Nowy Rok"));
      add(ymdParts(y, 1, 6), pick("Epiphany", "\u015awi\u0119to Trzech Kr\u00f3li"));
      add(easter, pick("Easter Sunday", "Wielkanoc"));
      add(shiftYmd(easter, 1), pick("Easter Monday", "Poniedzia\u0142ek Wielkanocny"));
      add(ymdParts(y, 5, 1), pick("Labour Day", "\u015awi\u0119to Pracy"));
      add(ymdParts(y, 5, 3), pick("Constitution Day", "\u015awi\u0119to Konstytucji 3 Maja"));
      add(shiftYmd(easter, 49), pick("Pentecost Sunday", "Zielone \u015awi\u0105tki"));
      add(shiftYmd(easter, 60), pick("Corpus Christi", "Bo\u017ce Cia\u0142o"));
      add(ymdParts(y, 8, 15), pick("Assumption of Mary", "Wniebowzi\u0119cie NMP"));
      add(ymdParts(y, 11, 1), pick("All Saints' Day", "Wszystkich \u015awi\u0119tych"));
      add(ymdParts(y, 11, 11), pick("National Independence Day", "Narodowe \u015awi\u0119to Niepodleg\u0142o\u015bci"));
      if (y >= 2025) add(ymdParts(y, 12, 24), pick("Christmas Eve", "Wigilia Bo\u017cego Narodzenia"));
      add(ymdParts(y, 12, 25), pick("Christmas Day", "Bo\u017ce Narodzenie (pierwszy dzie\u0144)"));
      add(ymdParts(y, 12, 26), pick("Second Day of Christmas", "Bo\u017ce Narodzenie (drugi dzie\u0144)"));
    } else if (code === "DE") {
      add(ymdParts(y, 1, 1), pick("New Year's Day", "Nowy Rok"));
      add(shiftYmd(easter, -2), pick("Good Friday", "Wielki Pi\u0105tek"));
      add(shiftYmd(easter, 1), pick("Easter Monday", "Poniedzia\u0142ek Wielkanocny"));
      add(ymdParts(y, 5, 1), pick("Labour Day", "\u015awi\u0119to Pracy"));
      add(shiftYmd(easter, 39), pick("Ascension Day", "Wniebowst\u0105pienie Pa\u0144skie"));
      add(shiftYmd(easter, 50), pick("Whit Monday", "Poniedzia\u0142ek Zielono\u015bwi\u0105tkowy"));
      add(ymdParts(y, 10, 3), pick("German Unity Day", "Dzie\u0144 Jedno\u015bci Niemiec"));
      add(ymdParts(y, 12, 25), pick("Christmas Day", "Bo\u017ce Narodzenie (pierwszy dzie\u0144)"));
      add(ymdParts(y, 12, 26), pick("Boxing Day", "Bo\u017ce Narodzenie (drugi dzie\u0144)"));
    } else if (code === "GB") {
      const ny = ymdParts(y, 1, 1);
      const nyWd = weekdayOfYmd(ny);
      add(ny, pick("New Year's Day", "Nowy Rok"));
      if (nyWd === 6) add(ymdParts(y, 1, 3), pick("New Year's Day", "Nowy Rok") + substituteSuffix);
      else if (nyWd === 0) add(ymdParts(y, 1, 2), pick("New Year's Day", "Nowy Rok") + substituteSuffix);
      add(shiftYmd(easter, -2), pick("Good Friday", "Wielki Pi\u0105tek"));
      add(shiftYmd(easter, 1), pick("Easter Monday", "Poniedzia\u0142ek Wielkanocny"));
      add(nthWeekdayYmd(y, 5, 1, 1), pick("Early May Bank Holiday", "Wczesnomajowe \u015bwi\u0119to bankowe"));
      add(nthWeekdayYmd(y, 5, 1, -1), pick("Spring Bank Holiday", "Wiosenne \u015bwi\u0119to bankowe"));
      add(nthWeekdayYmd(y, 8, 1, -1), pick("Summer Bank Holiday", "Letnie \u015bwi\u0119to bankowe"));
      const xmas = ymdParts(y, 12, 25), boxing = ymdParts(y, 12, 26);
      const xWd = weekdayOfYmd(xmas);
      add(xmas, pick("Christmas Day", "Bo\u017ce Narodzenie"));
      add(boxing, pick("Boxing Day", "Drugi dzie\u0144 \u015awi\u0105t"));
      if (xWd === 5) { // Fri Dec 25, Sat Dec 26 -> substitute Mon Dec 28
        add(ymdParts(y, 12, 28), pick("Boxing Day", "Drugi dzie\u0144 \u015awi\u0105t") + substituteSuffix);
      } else if (xWd === 6) { // Sat Dec 25, Sun Dec 26 -> Mon Dec 27 & Tue Dec 28
        add(ymdParts(y, 12, 27), pick("Christmas Day", "Bo\u017ce Narodzenie") + substituteSuffix);
        add(ymdParts(y, 12, 28), pick("Boxing Day", "Drugi dzie\u0144 \u015awi\u0105t") + substituteSuffix);
      } else if (xWd === 0) { // Sun Dec 25, Mon Dec 26 -> Tue Dec 27
        add(ymdParts(y, 12, 27), pick("Christmas Day", "Bo\u017ce Narodzenie") + substituteSuffix);
      }
    } else if (code === "US") {
      const addUsFixed = (mo, da, enName, plName) => {
        const key = ymdParts(y, mo, da);
        const name = pick(enName, plName);
        add(key, name);
        const wd = weekdayOfYmd(key);
        if (wd === 6 && !(mo === 1 && da === 1)) add(shiftYmd(key, -1), name + observedSuffix);
        else if (wd === 0) add(shiftYmd(key, 1), name + observedSuffix);
      };
      addUsFixed(1, 1, "New Year's Day", "Nowy Rok");
      add(nthWeekdayYmd(y, 1, 1, 3), pick("Martin Luther King Jr. Day", "Dzie\u0144 Martina Luthera Kinga Jr."));
      add(nthWeekdayYmd(y, 2, 1, 3), pick("Presidents' Day", "Dzie\u0144 Prezydent\u00f3w"));
      add(nthWeekdayYmd(y, 5, 1, -1), pick("Memorial Day", "Dzie\u0144 Pami\u0119ci"));
      if (y >= 2021) addUsFixed(6, 19, "Juneteenth National Independence Day", "Juneteenth");
      addUsFixed(7, 4, "Independence Day", "Dzie\u0144 Niepodleg\u0142o\u015bci USA");
      add(nthWeekdayYmd(y, 9, 1, 1), pick("Labor Day", "\u015awi\u0119to Pracy USA"));
      add(nthWeekdayYmd(y, 10, 1, 2), pick("Columbus Day", "Dzie\u0144 Kolumba"));
      addUsFixed(11, 11, "Veterans Day", "Dzie\u0144 Weteran\u00f3w");
      add(nthWeekdayYmd(y, 11, 4, 4), pick("Thanksgiving Day", "\u015awi\u0119to Dzi\u0119kczynienia"));
      addUsFixed(12, 25, "Christmas Day", "Bo\u017ce Narodzenie");
      // If next year's Jan 1 falls on Saturday, Dec 31 of this year is the US federal observed New Year's Day.
      if (weekdayOfYmd(ymdParts(y + 1, 1, 1)) === 6) {
        add(ymdParts(y, 12, 31), pick("New Year's Day", "Nowy Rok") + observedSuffix);
      }
    } else if (code === "EG") {
      add(ymdParts(y, 1, 7), pick("Coptic Christmas Day", "Bo\u017ce Narodzenie koptyjskie"));
      add(ymdParts(y, 1, 25), pick("Revolution Day (25 January)", "Dzie\u0144 Rewolucji (25 stycznia)"));
      add(ymdParts(y, 4, 25), pick("Sinai Liberation Day", "Dzie\u0144 Wyzwolenia Synaju"));
      add(ymdParts(y, 5, 1), pick("Labour Day", "\u015awi\u0119to Pracy"));
      add(ymdParts(y, 6, 30), pick("June 30 Revolution Day", "Dzie\u0144 Rewolucji 30 czerwca"));
      add(ymdParts(y, 7, 23), pick("Revolution Day (23 July)", "Dzie\u0144 Rewolucji (23 lipca)"));
      add(ymdParts(y, 10, 6), pick("Armed Forces Day", "Dzie\u0144 Si\u0142 Zbrojnych"));
    }

    const sorted = Object.freeze(out.sort((a, b) => a.date.localeCompare(b.date)).map((entry) => Object.freeze(entry)));
    if (holidayYearCache.size > 120) holidayYearCache.clear();
    holidayYearCache.set(cacheKey, sorted);
    return sorted;
  }
  function isWorkFree(day, prefs, lang = "en") {
    const clean = cleanCalendarHolidays(prefs);
    const key = typeof day === "string" && parseYmd(day.trim()) ? day.trim() : localDateKey(day);
    if (!clean.enabled || !key) {
      return { workFree: false, weekend: false, holiday: null, personal: null, reasons: [], tooltip: "" };
    }
    const wd = weekdayOfYmd(key);
    const weekend = weekendDaysFor(clean).includes(wd);
    const year = Number(key.slice(0, 4));
    const holiday = clean.region !== "none" ? (holidaysFor(clean.region, year, lang).find((h) => h.date === key) || null) : null;
    const personal = clean.personalDays.find((p) => p.date === key) || null;
    const reasons = [];
    if (holiday) reasons.push(holiday.name);
    if (personal) reasons.push(personal.label ? personal.label : t("cal.holidays.personalDayOff", null, lang));
    const tooltip = reasons.join(" \u00b7 ");
    return {
      workFree: Boolean(weekend || holiday || personal),
      weekend,
      holiday,
      personal,
      reasons,
      tooltip,
    };
  }

  const api = {
    KINDS, NOTES_LANGUAGES, DEFAULT_NOTES_LANGUAGE, registerLanguage, cleanNotesLanguage, notesLanguageTable, notesLocaleFor, translate, t, pluralCategory, tCount, translationKeys, missingTranslationKeys, ymd, parseYmd, dayStart, addDays, parseDateText, inlineDateTokens, ignoredDateTokens, stripDateIgnoreMarks, ensureNoteItemIds, parseClock, clockOfMinutes, parseTimeRange, dateEntryOrder, parseDateEntry, parseLine, makeItem, cleanItem, lineScheduleSignature, cleanTextSchedule, scheduleSignatureFromItem, scheduleFromParsedLine, reconcileListItem, itemFromLine,
    cleanCategoryName, cleanCategoryNotify, cleanNotifyOverrides, cleanCategory, DEFAULT_CATEGORY_NOTIFY, DEFAULT_CATEGORIES, SOUND_LEVELS, ALERT_LAYOUTS, cleanAlertLayout, DEFAULT_ALERT_SETTINGS, cleanAlertSettings, cleanNoteAlertOverrides, cleanAgendaWindow, cleanNoteAgendaOverrides, resolveAgendaWindow, prepareAgendaWindows, agendaVisibilityRange, nextAgendaVisibilityBoundary, AGENDA_WINDOW_MAX_DAYS, quietHoursActive, resolveAlertPolicy, adaptiveReminderLeadMinutes, reminderStagePlan, reminderDueAt, reminderPreCountdownText, reminderCountdownDelayMs, calendarSectionAt, setCalendarSectionCategory,
    itemRange, isReminder, isAllDay, itemsInRange, extractNoteItems, ensureAgendaHeading, agendaMirrorLine, insertAgendaLine, findAgendaLine, removeAgendaLine, mirroredItem, unmirroredItem, isMirroredAgendaItem, removeMirroredAgendaLine, isRecurringItem, rewriteLineSchedule, setListLineSchedule, noteLineItemId, listCheckboxStates, setListCheckbox, setListLineSummary, setListLineCategory, itemsFromNoteReminders, createHistoryCoordinator, createReminderHistoryStore, REMINDER_HISTORY_FILE, REMINDER_HISTORY_ARCHIVE_FILE, REMINDER_HISTORY_RETENTION_DEFAULT, REMINDER_HISTORY_ACTIONS, cleanReminderHistoryRetentionDays, compactReminderHistory, formatHistoryArchiveLines, parseHistoryArchiveLines, REMINDER_STACK_LIMIT, reminderAlertPresentation, orderOverlayAlertActions, reminderStackMoreLabel, reminderSnoozeTomorrowMinutes, reminderAlertShouldClose, reminderStateAfter, reminderIdentity, createItemStore, ITEMS_FILE, CALENDAR_DENSITIES, cleanCalendarDensity, CALENDAR_LAYOUT_MODES, cleanCalendarLayout, calendarLayoutFor, cleanCalendarShare, TREE_SQUEEZE_THRESHOLDS, treePaneSqueezeState, ALL_NOTES_CHROME_THRESHOLDS, allNotesChromeDensity, calendarActiveFilterCount, CALENDAR_FILTER_KINDS, cleanCalendarFilterKind, cleanCalendarFilterCategory, calendarFilterKeysFor, readCalendarFilters, CALENDAR_BIG_PICTURE_SIZES, DEFAULT_CALENDAR_BIG_PICTURE_SIZE, cleanCalendarBigPictureSize, calendarBigPictureBox, HOLIDAY_REGIONS, WEEKEND_PRESETS, defaultHolidayRegion, easterSundayYmd, nthWeekdayYmd, shiftYmd, weekdayOfYmd, regionWeekendDays, weekendDaysFor, cleanCalendarHolidays, holidaysFor, isWorkFree, addPersonalDayOff, removePersonalDayOff, allDayOf, parseRule, expandItem, expandRange, cleanRecurrenceExceptions, isRecurrenceCandidate, recurrenceUntilMs, validOccurrenceIdentity, occurrenceMoveRecord, moveOccurrence, cancelOccurrence, clearOccurrenceException, DEFAULT_WORK, cleanWork, workRange, freeSlots, DEFAULT_CALENDAR_HOURS, cleanCalendarHours, DEFAULT_CALENDAR_PICKER, cleanCalendarPicker, visibleHourRange, gridOffsetOf, gridMinuteAt,
    CALENDAR_SCALE_VIEWS, CALENDAR_SCALE_LIMITS, cleanCalendarScaleValue, calendarScaleStep, cleanCalendarScale, calendarScaleDensity, fitHourHeight, fitMinHourPx, calendarMinBoxPx, gridOpenMinute, monthCellLines, monthCellPlan,
    cleanZone, parseZoneOffset, fixedZoneId, zoneFixedOffset, zoneOffsetAt, zoneOffsetText, zoneSearchText, zoneChoice, zoneChoices, searchZones, resolveZoneText, cleanRecentZones, zoneGroups, FIXED_ZONE_CHOICES, zoneParts, zonedDateKey, zonedDayBounds, zonedMinuteOfDay, clockIn, dayTimelineHours, buildGridTimeline, timelineMinuteOfMs, timelineCivilToGridMin, timelineToCivilMinute, timelineClockLabel, timelineMsAt, weekText, dayHeat, pickerMonth, stepMonth, pickerKey, WEEK_START_DAYS, cleanWeekStart, cleanWeekNumbers, weekdayLabels, weekNumber, monthGrid, weekDays, WEEK_DAYS_LIMITS, WEEK_RANGE_STARTS, DEFAULT_WEEK_SPAN, cleanWeekDaysCount, cleanWeekRangeAnchor, cleanWeekSpan, fitWeekDayCount, visibleDays, resolveWeekVisibleDays, daysForward, DATE_FORMATS, DEFAULT_DATE_FORMAT, cleanDateFormat, localDateKey, formatDateKey, dateNoteTitle, parseDateKeyText, AGENDA_LABELS, agendaDayLabel, agendaBuckets, dayPlanSnapshot, dayPlanNeedsClaim, claimDayPlan, blockAgendaDrag, agendaZenItem, agendaZenProjection, agendaItemSignature, createIncrementalAgendaProjector, agendaOverdueProjection, agendaVisibleDays, AGENDA_MAX_ITEMS_DEFAULT, applyAgendaItemCap, agendaPendingItems, agendaItemEventAffectsProjection, createZenAgenda, formatAgendaDoctorBytes, diagnoseAgenda, planAgendaDoctorRepair, resolveAgendaOccurrence, AGENDA_ROOT_MENU_COMMANDS, agendaRootMenuModel, calendarItemMenuModel, HEADLESS_AGENDA_COMMANDS, SHEET_AGENDA_COMMANDS, isHeadlessAgendaCommand, snoozeMondayDays, undoLifecycleAction, agendaActionMessage, formatAgendaHoverTime, resolveItemColor, titleFromDateText, composeCalendarItem, snoozeDays, zonedDateTimeToMs, snoozedItemStart, isBlankDateNote, mergeCalendarSnapshots, lwwPick, ALL_NOTES_NEW_CHOICES, cleanAllNotesNewChoice, allNotesNewMenuModel, allNotesNewButtonLabel, CLOCK_MODES, cleanClockMode, clockUses12Hour, clockPointerAngle, clockAngleOfHour, clockHourFromAngle, clockAngleOfMinute, ANALOG_CLOCK_SNAP, clockMinuteFromAngle, stepClockHand, clockDialPoints, PALETTE_COLOR_HEX, NOTE_THEME_SURFACES, parseColorRgb, rgbToHex, relativeLuminance, contrastRatio, mixSrgb, colorHsl, hslToHex, hueDistanceDeg, resolveCssColor, ensureContrastHex, resolveThemeSurface, derivePaletteTokens, resolveFolderSurfaceTokens, describeInheritance, layoutDay, layoutGridSpans, busyRanges, upcoming, moveItem, CALENDAR_SNAP_STEPS, cleanCalendarSnap, calendarMovePlacement, calendarMoveTimedItem, calendarMoveTimedEvent, calendarMoveAllDayReminder, calendarOccurrenceTargetStart, calendarMoveRecurringOccurrence, NOTE_DRAG_MIME, calendarNoteDropSlot, calendarNoteDropLabel, calendarDraftRange, calendarResizePlacement, calendarResizeTimedEvent, resizeItem, toGoogle, fromGoogle,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.ZentralModuleLoader?.define) window.ZentralModuleLoader.define("notes-calendar", () => api);
})();
