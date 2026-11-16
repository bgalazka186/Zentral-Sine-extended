// Pure English language table for Zentral Notes & Calendar (AU-B4a / AU-B4b).
// Adding a language is a data file, not parser or UI logic.
(function () {
  "use strict";

  const freezeDeep = (value) => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) freezeDeep(value[key]);
    return value;
  };

  const lang = freezeDeep({
    code: "en",
    locale: "en-GB",
    name: "English",
    todayLabel: "Today",
    overdueLabel: "Overdue",
    agendaLabels: ["Today", "Tomorrow"],
    dateKinds: {
      today: "Today",
      tomorrow: "Tomorrow",
      next: "Next work day",
      other: "Other date\u2026",
      earlier: "Earlier days",
    },
    relative: {
      "-2": ["day before yesterday", "the day before yesterday"],
      "-1": ["yesterday"],
      "0": ["today"],
      "1": ["tomorrow", "tmr", "tmrw"],
      "2": ["day after tomorrow", "the day after tomorrow", "overmorrow"],
    },
    weekdays: [
      ["sunday", "sun"],
      ["monday", "mon"],
      ["tuesday", "tue", "tues"],
      ["wednesday", "wed"],
      ["thursday", "thu", "thur", "thurs"],
      ["friday", "fri"],
      ["saturday", "sat"],
    ],
    weekdayPrefixes: ["on", "this", "next"],
    weekdaysDisplay: {
      short: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      long: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    },
    months: [
      ["january", "jan"],
      ["february", "feb"],
      ["march", "mar"],
      ["april", "apr"],
      ["may"],
      ["june", "jun"],
      ["july", "jul"],
      ["august", "aug"],
      ["september", "sep", "sept"],
      ["october", "oct"],
      ["november", "nov"],
      ["december", "dec"],
    ],
    offsets: {
      phrases: [
        { phrase: "next week", unit: "w", count: 1 },
        { phrase: "last week", unit: "w", count: -1 },
        { phrase: "next month", unit: "m", count: 1 },
        { phrase: "last month", unit: "m", count: -1 },
        { phrase: "next year", unit: "y", count: 1 },
        { phrase: "last year", unit: "y", count: -1 },
        { phrase: "in a day", unit: "d", count: 1 },
        { phrase: "in a week", unit: "w", count: 1 },
        { phrase: "in a month", unit: "m", count: 1 },
        { phrase: "in a year", unit: "y", count: 1 },
      ],
      counted: [
        {
          prefix: "in",
          suffix: "",
          sign: 1,
          units: {
            d: ["day", "days"],
            w: ["week", "weeks"],
            m: ["month", "months"],
            y: ["year", "years"],
          },
        },
        {
          prefix: "",
          suffix: "from now",
          sign: 1,
          units: {
            d: ["day", "days"],
            w: ["week", "weeks"],
            m: ["month", "months"],
            y: ["year", "years"],
          },
        },
        {
          prefix: "",
          suffix: "ago",
          sign: -1,
          units: {
            d: ["day", "days"],
            w: ["week", "weeks"],
            m: ["month", "months"],
            y: ["year", "years"],
          },
        },
      ],
    },
    ordinals: ["st", "nd", "rd", "th", "."],
    strings: {},
  });

  if (typeof window !== "undefined" && window) {
    if (!window.__zentralNotesLangTables) window.__zentralNotesLangTables = {};
    window.__zentralNotesLangTables[lang.code] = lang;
    if (window.ZentralModuleLoader && typeof window.ZentralModuleLoader.define === "function") {
      window.ZentralModuleLoader.define("notes-lang-en", lang);
    }
  }
  if (typeof module === "object" && module) module.exports = lang;
})();
