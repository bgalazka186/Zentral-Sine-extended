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
 *     x: { kind: "event"|"reminder", noteId, heading, category, calNote } }
 *   Times: `dateTime` is a UTC ISO string (Google also allows an offset; we always write Z). `date` is a local calendar
 *   day YYYY-MM-DD. An all-day item ends on an EXCLUSIVE date, as in Google. A reminder has a start and NO end.
 */
(function () {
  "use strict";
  const MIN = 60000, DAY_MS = 86400000;
  const p2 = (n) => String(n).padStart(2, "0");
  const KINDS = Object.freeze(["event", "reminder"]);
  const MAX_TEXT = 500, MAX_DESC = 20000;

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
  // A date as people type it: 2026-11-11, 11.11.2026, 11.11. / 11-11 (day-month, this or next year), @today, @tomorrow,
  // @+3d / @-2d / @+1w / @+1m, @monday (next such day). Returns local midnight ms or null.
  function parseDateText(text, now) {
    const t = String(text || "").trim().toLowerCase().replace(/^[@/]/, "");
    if (!t) return null;
    const base = dayStart(now);
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (m) { const d = parseYmd(m[1] + "-" + p2(m[2]) + "-" + p2(m[3])); return d ? d.getTime() : null; }
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
    if (m) { const d = parseYmd(m[3] + "-" + p2(m[2]) + "-" + p2(m[1])); return d ? d.getTime() : null; }
    m = /^(\d{1,2})[.-](\d{1,2})\.?$/.exec(t);
    if (m) {
      const y = new Date(base).getFullYear();
      for (const yy of [y, y + 1]) {
        const d = parseYmd(yy + "-" + p2(m[2]) + "-" + p2(m[1]));
        if (d && d.getTime() >= base) return d.getTime();
      }
      return null;
    }
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
    let day = defaultDay ?? null, tok = /^(\S+)\s*(.*)$/.exec(t);
    const d = tok ? parseDateText(tok[1], now) : null;
    if (d !== null && !/^\d{1,2}[:.]\d{2}/.test(tok[1])) { day = d; t = tok[2]; }
    if (day === null) return null;
    let range = null;
    const tr = /^(\d{1,2}[:.]\d{2}(?:\s*[-\u2013\u2014]\s*\d{1,2}[:.]\d{2})?)\s*(.*)$/.exec(t);
    if (tr) { range = parseTimeRange(tr[1]); if (range) t = tr[2]; }
    t = t.replace(/^[-\u2013\u2014:]\s*/, "").trim();
    if (!t) return null;
    return { day, startMin: range ? range.startMin : -1, endMin: range ? range.endMin : -1, summary: t.slice(0, MAX_TEXT) };
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
        category: String(x.category ?? "").slice(0, 80), tz: cleanZone(x.tz), calNote: String(x.calNote ?? "").slice(0, MAX_DESC),
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
    for (const [k, v] of Object.entries(it.x)) if (v !== "") priv["zentral_" + k] = String(v);
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
    for (const k of ["kind", "noteId", "heading", "category", "tz", "calNote"]) if (priv["zentral_" + k] !== undefined) x[k] = priv["zentral_" + k];
    const sameEnd = g.end && JSON.stringify(g.end) === JSON.stringify(g.start);
    return cleanItem({ id: g.id, summary: g.summary, description: g.description, status: g.status, start: g.start, end: sameEnd ? undefined : g.end,
      updated: g.updated, recurrence: g.recurrence, reminders: g.reminders, x: { ...x, kind: x.kind || (sameEnd ? "reminder" : "event") } }, 0);
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
    KINDS, ymd, parseYmd, dayStart, addDays, parseDateText, parseClock, parseTimeRange, parseLine, makeItem, cleanItem, itemFromLine,
    itemRange, isReminder, isAllDay, itemsInRange, allDayOf, parseRule, expandItem, expandRange, DEFAULT_WORK, cleanWork, workRange, freeSlots, cleanZone, clockIn, weekText, pickerMonth, stepMonth, pickerKey, monthGrid, daysForward, layoutDay, busyRanges, upcoming, moveItem, resizeItem, toGoogle, fromGoogle,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.ZentralModuleLoader?.define) window.ZentralModuleLoader.define("notes-calendar", () => api);
})();
