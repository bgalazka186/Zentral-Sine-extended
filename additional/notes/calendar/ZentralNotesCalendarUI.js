/*
 * ZENTRAL FILE GUIDE - additional/notes/calendar/ZentralNotesCalendarUI.js
 *
 * Purpose: T4.3a — the calendar UI's pure/measurable decisions live here, outside ZentralNotes.uc.js. The sheet
 *   still owns the DOM it builds and the store it reads; this module answers geometry, label, colour, time,
 *   week-span, fit and drag questions from arguments. Nothing here reads a pref, starts a timer or writes a file.
 * Interaction / execution: loaded as "notes-calendar-ui" by the full pack's module loader and embedded in the
 *   standalone Notes bundle. A Node test (or an audit harness) gets the same object through module.exports.
 * Ownership / failure: every function tolerates a missing calendar core or an unmeasurable element; a missing
 *   module means the sheet keeps its old compatibility shims, never a crash.
 * Registration: notes-calendar-ui
 * Loaded/created by: additional/notes/ZentralNotes.uc.js
 */
(function () {
  "use strict";
  const fallbackSpan = Object.freeze({ days: 7, anchor: "weekStart" });
  const fallbackHolidayPrefs = Object.freeze({
    enabled: true, region: "none", locales: [], weekend: "auto", personalDays: [],
  });
  const fallbackWorkFree = Object.freeze({
    workFree: false, weekend: false, holiday: null, holidays: [], personal: null, reasons: [], tooltip: "",
  });

  // The viewport-aware placement shared by every calendar menu. Pure: no document, no prefs.
  function menuPosition({ anchor, viewport, size, pad = 6 }) {
    const width = Math.max(0, viewport.width), height = Math.max(0, viewport.height);
    const minX = Math.min(pad, width / 2), minY = Math.min(pad, height / 2);
    const usableWidth = Math.max(0, width - 2 * minX), usableHeight = Math.max(0, height - 2 * minY);
    const w = Math.min(Math.max(0, size.width), usableWidth), h = Math.min(Math.max(0, size.height), usableHeight);
    const x = anchor.left + w <= width - minX ? anchor.left : anchor.right - w;
    const y = anchor.bottom + 4 + h <= height - minY ? anchor.bottom + 4 : anchor.top - 4 - h;
    return {
      left: Math.round(Math.max(minX, Math.min(x, width - minX - w))),
      top: Math.round(Math.max(minY, Math.min(y, height - minY - h))),
      maxHeight: Math.floor(usableHeight),
    };
  }

  const weekSpanConfig = (C, span) => (C ? C.cleanWeekSpan(span) : fallbackSpan);

  function shownWeekDays(C, { cursorOverride, storedCursor, today, weekStart, span, widthPx, panDay }) {
    if (!C) return [];
    const cursor = cursorOverride !== undefined
      ? cursorOverride
      : (storedCursor ? storedCursor.getTime() : today);
    return C.resolveWeekVisibleDays({ cursor, today, weekStart, span, widthPx, panDay });
  }

  // The visible width of the calendar content, falling back to its pane and then to zero.
  function weekAutoWidth({ content, pane } = {}) {
    const cw = Number(content?.clientWidth);
    if (cw > 0) return cw;
    const cr = content?.getBoundingClientRect?.();
    if (cr && Number(cr.width) > 0) return Number(cr.width);
    const pr = pane?.getBoundingClientRect?.();
    if (pr && Number(pr.width) > 0) return Number(pr.width);
    return 0;
  }

  function dayLabel(C, day, { formatDateKey, locale, weekday = "long" } = {}) {
    if (!C) return String(day);
    const key = C.localDateKey(day);
    const date = typeof formatDateKey === "function" ? formatDateKey(key) : key;
    if (weekday === false) return date;
    const d = new Date(day);
    const word = d.toLocaleDateString(locale, { weekday });
    return word ? word + ", " + date : date;
  }

  function itemColor(C, item, { linkedNote = null, categoryColor = "", colorHex } = {}) {
    if (!C) return "";
    const resolved = C.resolveItemColor(item?.x?.color || "", linkedNote?.color || "", categoryColor);
    return (typeof colorHex === "function" ? colorHex(resolved) : "") || resolved;
  }

  function itemTime(C, item, { allDayLabel = "All day" } = {}) {
    if (!C) return allDayLabel;
    if (C.isAllDay(item)) return allDayLabel;
    const [start, end] = C.itemRange(item);
    const first = C.clockIn(start, item.x?.tz);
    if (C.isReminder(item) || !(end > start)) return first;
    return first + "–" + C.clockIn(end, item.x?.tz);
  }

  function sourceTitle(note) {
    const body = String(note?.body || "");
    const lines = body.split("\n");
    const heading = lines.find((line) => /^\s*#\s+/.test(line));
    return (heading || lines.find((line) => line.trim()) || "").replace(/^\s*#\s+/, "").trim() || "Untitled note";
  }

  const monthRowPx = (grid) => {
    const height = Number(grid?.clientHeight);
    return height > 0 ? (height - 15) / 6 : NaN;
  };
  const timelineRoom = (scroll) => {
    const height = Number(scroll?.clientHeight);
    return height > 0 ? Math.max(1, height - 3) : NaN;
  };

  function fontPx(win, el) {
    let value = NaN;
    try { value = parseFloat(win?.getComputedStyle?.(el)?.fontSize); } catch (_) {}
    return value > 0 ? value : NaN;
  }

  function paneWidth(pane, bigPicture) {
    const rect = pane?.getBoundingClientRect?.();
    const measured = Math.max(0, Number(pane?.clientWidth) || Number(rect?.width) || 0);
    if (measured > 0) return measured;
    return bigPicture?.box?.width || 0;
  }

  function paneHeight(pane, bigPicture) {
    const rect = pane?.getBoundingClientRect?.();
    const measured = Math.max(0, Number(pane?.clientHeight) || Number(rect?.height) || Number(pane?.offsetHeight) || 0);
    if (measured > 0) return measured;
    return bigPicture?.box?.height ? Math.max(0, bigPicture.box.height - 44) : 0;
  }

  const sizedView = (name, compact) => name === "week" || name === "day" || (name === "month" && !compact);

  function dragPoint(C, g, event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    const clip = g.scroll.getBoundingClientRect();
    if (event.clientX < clip.left || event.clientX >= clip.right || event.clientY < clip.top || event.clientY >= clip.bottom) return null;
    for (const track of g.columns.querySelectorAll(g.allDay ? ".zn-cal-time-allday-cell" : ".zn-cal-time-track")) {
      const rect = track.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) continue;
      const minute = g.allDay ? 0 : C.gridMinuteAt(event.clientY - rect.top, g.hourHeight, g.grid);
      return { track, day: track.getAttribute("data-day"), minute };
    }
    return null;
  }

  const interacting = ({ drag, noteDrop, dialog, menu }) => !!(drag || noteDrop || dialog || menu?.calendar);

  function monthNarrow(C, meta, width, height) {
    const picker = C?.cleanCalendarPicker?.(meta?.calendarPicker) || { mode: "auto", minWidth: 470, minHeight: 360 };
    if (picker.mode === "picker") return true;
    if (picker.mode === "month") return false;
    return (width > 0 && width < picker.minWidth) || (height > 0 && height < picker.minHeight);
  }

  const displayZone = (C, meta) => C?.cleanZone?.(meta?.calendarDisplayZone) || "";

  function todayLabel(C, lang, fallback) {
    try { return C.notesLanguageTable(lang).todayLabel; } catch (_) { return fallback; }
  }
  const todayKey = (C, now, zone) => (C ? C.zonedDateKey(now, zone) : "");
  function todayDay(C, now, zone) {
    if (!C) return new Date(now).setHours(0, 0, 0, 0);
    return C.parseYmd(C.zonedDateKey(now, zone))?.getTime() || C.dayStart(now);
  }
  const holidayPrefs = (C, value) => (C?.cleanCalendarHolidays?.(value) || fallbackHolidayPrefs);
  const workFreeInfo = (C, day, prefs, lang) => (C?.isWorkFree?.(day, prefs, lang) || fallbackWorkFree);

  const api = {
    menuPosition, weekSpanConfig, shownWeekDays, weekAutoWidth, dayLabel, itemColor, itemTime, sourceTitle,
    monthRowPx, timelineRoom, fontPx, paneWidth, paneHeight, sizedView, dragPoint, interacting, monthNarrow,
    displayZone, todayLabel, todayKey, todayDay, holidayPrefs, workFreeInfo,
    fallbackSpan, fallbackHolidayPrefs, fallbackWorkFree,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.ZentralModuleLoader?.define)
    window.ZentralModuleLoader.define("notes-calendar-ui", () => api);
})();
