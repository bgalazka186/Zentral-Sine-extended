/*
 * ZENTRAL FILE GUIDE - additional/notes/flavors/ZentralNotesShortcuts.js
 *
 * Purpose: Typing shortcuts for the Notes editor as pure logic: write {{date}}, @today or /today and the editor
 *   swaps it for the real date (or time, title ...). The note then holds plain text, so it reads the same in every app.
 * Interaction / execution: ZentralNotes.uc.js calls expandTyped() from the editor's input event with the character
 *   that was just typed, and applies the returned edit through the same applyEdit the [[ completion uses (undo stays).
 * Ownership / failure: no DOM, no preferences, no clock of its own (the caller passes `now`). Returns null when nothing
 *   should happen. Never expands inside a code fence or an inline code span.
 * Registration: notes-shortcuts
 * Loaded/created by: additional/notes/ZentralNotes.uc.js
 *
 * FAMILIES (the pref `text_shortcuts`: all / braces / off)
 *   braces   {{date}} {{time}} {{title}} {{date:DD.MM.YYYY}} {{time:HH:mm}} ...  Obsidian's Templates plugin, expands the
 *            moment the closing }} is typed.
 *   at       @today @now @tomorrow @yesterday @date @time @datetime @weekday     Notion style, expands when Space or Enter follows.
 *   slash    /today /now /tomorrow /yesterday /date /time /datetime /weekday     Logseq style, same rule, only after a space or at a line start.
 */
(function () {
  "use strict";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const DEFAULT_DATE = "YYYY-MM-DD";
  const DEFAULT_TIME = "HH:mm";
  const MAX_FORMAT = 40;
  const p2 = (n) => String(n).padStart(2, "0");

  // Moment-style tokens: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm m ss s A a; [text] is copied as it is.
  function formatDate(ms, fmt) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    const f = String(fmt || DEFAULT_DATE).slice(0, MAX_FORMAT);
    const h12 = d.getHours() % 12 || 12;
    const map = {
      YYYY: String(d.getFullYear()), YY: String(d.getFullYear()).slice(-2),
      MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3), MM: p2(d.getMonth() + 1), M: String(d.getMonth() + 1),
      DD: p2(d.getDate()), D: String(d.getDate()),
      dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3),
      HH: p2(d.getHours()), H: String(d.getHours()), hh: p2(h12), h: String(h12),
      mm: p2(d.getMinutes()), m: String(d.getMinutes()), ss: p2(d.getSeconds()), s: String(d.getSeconds()),
      A: d.getHours() < 12 ? "AM" : "PM", a: d.getHours() < 12 ? "am" : "pm",
    };
    return f.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g, (t, lit) => (lit !== undefined ? lit : map[t]));
  }
  const addDays = (ms, n) => {
    const d = new Date(ms);
    d.setDate(d.getDate() + n);
    return d.getTime();
  };

  // word -> what it means. `fmt` is the optional {{date:FORMAT}} part.
  const WORDS = Object.freeze({ today: "date", date: "date", now: "datetime", datetime: "datetime", time: "time", tomorrow: "tomorrow", yesterday: "yesterday", weekday: "weekday", title: "title" });
  const AT_WORDS = ["today", "now", "tomorrow", "yesterday", "date", "time", "datetime", "weekday"];
  // "+3d", "-2d", "+1w", "+2m", "+1y" -> a date that far from today; "monday" ... "sunday" (or mon ... sun) -> the next
  // such day after today. Dates written this way are plain ISO text afterwards, which Notes recognises as a date.
  const DAY_KEYS = DAYS.map((d) => d.slice(0, 3).toLowerCase());
  function offsetDate(word, now) {
    const w = String(word).toLowerCase();
    let m = /^([+-])(\d{1,3})([dwmy])$/.exec(w);
    if (m) {
      const n = (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10);
      const d = new Date(now);
      if (m[3] === "d") d.setDate(d.getDate() + n);
      else if (m[3] === "w") d.setDate(d.getDate() + 7 * n);
      else if (m[3] === "m") d.setMonth(d.getMonth() + n);
      else d.setFullYear(d.getFullYear() + n);
      return d.getTime();
    }
    m = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/.exec(w);
    if (m && (w.length === 3 || DAYS.some((d) => d.toLowerCase() === w))) {
      const want = DAY_KEYS.indexOf(m[1]);
      const ahead = ((want - new Date(now).getDay() + 6) % 7) + 1; // 1..7: never today
      return addDays(now, ahead);
    }
    return null;
  }
  function resolve(word, fmt, ctx = {}) {
    const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
    const dateFmt = ctx.dateFormat || DEFAULT_DATE;
    const timeFmt = ctx.timeFormat || DEFAULT_TIME;
    const kind = WORDS[String(word || "").toLowerCase()];
    if (!kind) {
      const at = offsetDate(word, now);
      return at === null ? null : formatDate(at, fmt || dateFmt);
    }
    switch (kind) {
      case "date": return formatDate(now, fmt || dateFmt);
      case "time": return formatDate(now, fmt || timeFmt);
      case "datetime": return fmt ? formatDate(now, fmt) : formatDate(now, dateFmt) + " " + formatDate(now, timeFmt);
      case "tomorrow": return formatDate(addDays(now, 1), fmt || dateFmt);
      case "yesterday": return formatDate(addDays(now, -1), fmt || dateFmt);
      case "weekday": return formatDate(now, fmt || "dddd");
      case "title": return String(ctx.title || "");
      default: return null;
    }
  }

  // Is `pos` inside a fenced block or an inline code span? (A shortcut typed in code stays as typed.)
  function inCode(value, pos) {
    const head = String(value).slice(0, pos);
    let fenced = false;
    for (const line of head.split("\n").slice(0, -1)) if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return true;
    const cur = head.slice(head.lastIndexOf("\n") + 1);
    if (/^\s{0,3}(```|~~~)/.test(cur)) return true;
    return (cur.match(/`/g) || []).length % 2 === 1;
  }

  const BRACE_RE = /\{\{\s*([A-Za-z]+)\s*(?::([^{}\n]{1,40}))?\}\}$/;
  const EXTRA = "[+-]\\d{1,3}[dwmy]|(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?";
  const AT_RE = new RegExp("(^|[\\s(\\[>\"'])@(" + AT_WORDS.join("|") + "|" + EXTRA + ")$", "i");
  const SLASH_RE = new RegExp("(^|[\\s(])\\/(" + AT_WORDS.join("|") + "|" + EXTRA + ")$", "i");

  // value: the text after the keystroke; caret: where the caret is now; typed: the character that was typed
  // ("}" , " " or "\n"); ctx: { now, dateFormat, timeFormat, title }; families: "all" | "braces" | "off".
  // Returns { start, end, text, selStart, selEnd } (the shape applyEdit takes) or null.
  function expandTyped(value, caret, typed, ctx = {}, families = "all") {
    if (families === "off" || typeof value !== "string" || !typed) return null;
    if (typed === "}") {
      const before = value.slice(Math.max(0, caret - 90), caret);
      const m = BRACE_RE.exec(before);
      if (!m || !WORDS[m[1].toLowerCase()]) return null;
      const start = caret - m[0].length;
      if (inCode(value, start)) return null;
      const text = resolve(m[1], m[2] && m[2].trim(), ctx);
      if (text === null) return null;
      return { start, end: caret, text, selStart: start + text.length, selEnd: start + text.length };
    }
    if (families !== "all" || (typed !== " " && typed !== "\n")) return null;
    const tokenEnd = caret - 1; // the space or the newline that was just typed
    const before = value.slice(Math.max(0, tokenEnd - 30), tokenEnd);
    const m = AT_RE.exec(before) || SLASH_RE.exec(before);
    if (!m) return null;
    const start = tokenEnd - (m[0].length - m[1].length);
    if (inCode(value, start)) return null;
    const text = resolve(m[2], null, ctx);
    if (text === null) return null;
    return { start, end: tokenEnd, text, selStart: start + text.length + 1, selEnd: start + text.length + 1 };
  }

  // The list shown in docs/MARKDOWN_FLAVORS.md section N and in the in-app help: what you type, what you get.
  const SHORTCUTS = Object.freeze([
    { family: "braces", typed: "{{date}}", gives: "today, YYYY-MM-DD", app: "Obsidian Templates" },
    { family: "braces", typed: "{{time}}", gives: "now, HH:mm", app: "Obsidian Templates" },
    { family: "braces", typed: "{{date:DD.MM.YYYY}}", gives: "today in your own format", app: "Obsidian Templates" },
    { family: "braces", typed: "{{time:hh:mm A}}", gives: "now in your own format", app: "Obsidian Templates" },
    { family: "braces", typed: "{{title}}", gives: "the note title", app: "Obsidian Templates" },
    { family: "braces", typed: "{{datetime}} {{now}} {{today}} {{tomorrow}} {{yesterday}} {{weekday}}", gives: "date and time / today / next day / previous day / day name", app: "ours" },
    { family: "at", typed: "@today  @date", gives: "today, YYYY-MM-DD", app: "Notion" },
    { family: "at", typed: "@now  @datetime", gives: "date and time", app: "Notion" },
    { family: "at", typed: "@time", gives: "now, HH:mm", app: "ours" },
    { family: "at", typed: "@tomorrow  @yesterday  @weekday", gives: "next day / previous day / day name", app: "Notion" },
    { family: "at", typed: "@+3d  @-2d  @+1w  @+1m  @+1y", gives: "a date that far from today", app: "ours (for reminders)" },
    { family: "at", typed: "@monday ... @sunday  (@mon ... @sun)", gives: "the next such day after today", app: "ours (for reminders)" },
    { family: "slash", typed: "/today  /date  /now  /time  /tomorrow  /yesterday  /weekday", gives: "the same as @ (also /+3d, /monday)", app: "Logseq" },
  ]);

  const api = { formatDate, resolve, expandTyped, inCode, WORDS, AT_WORDS, SHORTCUTS, DEFAULT_DATE, DEFAULT_TIME };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.ZentralModuleLoader?.define) window.ZentralModuleLoader.define("notes-shortcuts", () => api);
})();
