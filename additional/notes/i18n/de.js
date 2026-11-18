// Pure German language table for Zentral Notes & Calendar (OW-79).
//
// This file is the PROOF of OW-79's promise, not a completed translation: it exists so that "adding a language is a data
// file" can be tested rather than asserted. It is deliberately INCOMPLETE — the calendar, weekday, month and date words
// are German (they are the ones a person types), and only the handful of strings a person sees first are translated.
// Everything else falls through to English per key, which is exactly what the row requires: no half-finished language
// ever shows a raw key. `notesLanguages()` reports it as `complete: false` with a missing count, and the language menu
// names that count beside the name.
//
// To finish it: translate the rest of `de` below (compare `en.js`), then run `node tools/build-languages.cjs` — the
// table appears in the menu because the file exists, never because a JS list was edited.
(function () {
  "use strict";

  const freezeDeep = (value) => {
    if (Array.isArray(value)) return Object.freeze(value.map(freezeDeep));
    if (value && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value)) out[key] = freezeDeep(value[key]);
      return Object.freeze(out);
    }
    return value;
  };

  // The keys translated so far. Everything not named here answers in English (per key, never per table).
  const de = {
    "common.today": "Heute",
    "common.tomorrow": "Morgen",
    "common.cancel": "Abbrechen",
    "common.apply": "Anwenden",
    "common.close": "Schlie\u00dfen",
    "common.undo": "R\u00fcckg\u00e4ngig",
    "cal.todayBtn": "Zu heute",
    "cal.ics.title": "Kalenderdatei importieren",
    "cal.ics.importBtn": "Importieren",
    "cal.ics.exportTitle": "Diesen Kalender exportieren",
    "cal.ics.exportBtn": "Exportieren",
    "settings.choice.notesLanguage.de": "Deutsch (German)",
  };

  const lang = freezeDeep({
    code: "de",
    locale: "de-DE",
    name: "Deutsch (German)",
    todayLabel: "Heute",
    overdueLabel: "\u00dcberf\u00e4llig",
    agendaLabels: ["Heute", "Morgen"],
    dateKinds: {
      today: "Heute",
      tomorrow: "Morgen",
      next: "N\u00e4chster Werktag",
      other: "Anderes Datum\u2026",
      earlier: "Fr\u00fchere Tage",
    },
    relative: {
      "-2": ["vorgestern"],
      "-1": ["gestern"],
      "0": ["heute"],
      "1": ["morgen"],
      "2": ["\u00fcbermorgen"],
    },
    weekdays: [
      ["sonntag", "so"],
      ["montag", "mo"],
      ["dienstag", "di"],
      ["mittwoch", "mi"],
      ["donnerstag", "do"],
      ["freitag", "fr"],
      ["samstag", "sa"],
    ],
    weekdayPrefixes: ["am", "diesen", "n\u00e4chsten"],
    weekdaysDisplay: {
      short: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
      long: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
    },
    months: [
      ["januar", "jan"],
      ["februar", "feb"],
      ["m\u00e4rz", "mrz"],
      ["april", "apr"],
      ["mai"],
      ["juni", "jun"],
      ["juli", "jul"],
      ["august", "aug"],
      ["september", "sep", "sept"],
      ["oktober", "okt"],
      ["november", "nov"],
      ["dezember", "dez"],
    ],
    offsets: {
      phrases: [
        { phrase: "n\u00e4chste woche", unit: "w", count: 1 },
        { phrase: "letzte woche", unit: "w", count: -1 },
        { phrase: "n\u00e4chsten monat", unit: "m", count: 1 },
        { phrase: "letzten monat", unit: "m", count: -1 },
        { phrase: "n\u00e4chstes jahr", unit: "y", count: 1 },
        { phrase: "letztes jahr", unit: "y", count: -1 },
        { phrase: "in einem tag", unit: "d", count: 1 },
        { phrase: "in einer woche", unit: "w", count: 1 },
        { phrase: "in einem monat", unit: "m", count: 1 },
        { phrase: "in einem jahr", unit: "y", count: 1 },
      ],
      counted: [
        {
          prefix: "in",
          suffix: "",
          sign: 1,
          units: {
            d: ["tag", "tagen"],
            w: ["woche", "wochen"],
            m: ["monat", "monaten"],
            y: ["jahr", "jahren"],
          },
        },
        {
          prefix: "vor",
          suffix: "",
          sign: -1,
          units: {
            d: ["tag", "tagen"],
            w: ["woche", "wochen"],
            m: ["monat", "monaten"],
            y: ["jahr", "jahren"],
          },
        },
      ],
    },
    ordinals: [".", "er", "te", "ten"],
    // German is a two-category language (one / other), like English. `pluralCategory` returns "other" for a language
    // it has no rule for, which is the correct answer here; naming it makes the file say so on purpose.
    plural: { one: 1, few: 0, many: 0, other: 1 },
    strings: de,
  });

  if (typeof window !== "undefined" && window) {
    if (!window.__zentralNotesLangTables) window.__zentralNotesLangTables = {};
    window.__zentralNotesLangTables[lang.code] = lang;
    if (window.ZentralModuleLoader && typeof window.ZentralModuleLoader.define === "function") {
      window.ZentralModuleLoader.define("notes-lang-de", lang);
    }
  }
  if (typeof module === "object" && module) module.exports = lang;
})();
