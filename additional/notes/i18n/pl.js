// Pure Polish language table for Zentral Notes & Calendar (AU-B4a / AU-B4b).
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
    code: "pl",
    locale: "pl-PL",
    name: "Polski (Polish)",
    todayLabel: "Dzi\u015b",
    overdueLabel: "Zaleg\u0142e",
    agendaLabels: ["Dzi\u015b", "Jutro", "Pojutrze"],
    dateKinds: {
      today: "Dzi\u015b",
      tomorrow: "Jutro",
      next: "Nast\u0119pny dzie\u0144 roboczy",
      other: "Inna data\u2026",
      earlier: "Wcze\u015bniejsze dni",
    },
    relative: {
      "-2": ["przedwczoraj"],
      "-1": ["wczoraj"],
      "0": ["dzi\u015b", "dzis", "dzisiaj"],
      "1": ["jutro"],
      "2": ["pojutrze"],
      "3": ["popojutrze"],
    },
    weekdays: [
      ["niedziela", "niedziel\u0119", "niedziele", "niedz", "ndz", "nd"],
      ["poniedzia\u0142ek", "poniedzialek", "pon", "pn"],
      ["wtorek", "wt"],
      ["\u015broda", "\u015brod\u0119", "sroda", "srode", "\u015br", "sr"],
      ["czwartek", "czw", "cz"],
      ["pi\u0105tek", "piatek", "pt"],
      ["sobota", "sobot\u0119", "sobote", "sob", "sb"],
    ],
    weekdayPrefixes: [
      "w",
      "we",
      "na",
      "ten",
      "ta",
      "t\u0119",
      "przysz\u0142y",
      "przysz\u0142a",
      "przysz\u0142\u0105",
      "w przysz\u0142y",
      "w przysz\u0142\u0105",
      "nast\u0119pny",
      "nast\u0119pna",
      "nast\u0119pn\u0105",
      "w nast\u0119pny",
      "w nast\u0119pn\u0105",
    ],
    weekdaysDisplay: {
      short: ["Pon", "Wt", "\u015ar", "Czw", "Pt", "Sob", "Ndz"],
      long: ["poniedzia\u0142ek", "wtorek", "\u015broda", "czwartek", "pi\u0105tek", "sobota", "niedziela"],
    },
    months: [
      ["stycze\u0144", "stycznia", "styczniu", "sty"],
      ["luty", "lutego", "lutym", "lut"],
      ["marzec", "marca", "marcu", "mar"],
      ["kwiecie\u0144", "kwietnia", "kwietniu", "kwi", "kwiec"],
      ["maj", "maja", "maju"],
      ["czerwiec", "czerwca", "czerwcu", "cze", "czerw"],
      ["lipiec", "lipca", "lipcu", "lip"],
      ["sierpie\u0144", "sierpnia", "sierpniu", "sie", "sierp"],
      ["wrzesie\u0144", "wrze\u015bnia", "wrze\u015bniu", "wrz", "wrzes"],
      ["pa\u017adziernik", "pa\u017adziernika", "pa\u017adzierniku", "pa\u017a", "paz"],
      ["listopad", "listopada", "listopadzie", "lis", "list"],
      ["grudzie\u0144", "grudnia", "grudniu", "gru", "grudz"],
    ],
    offsets: {
      phrases: [
        { phrase: "za dzie\u0144", unit: "d", count: 1 },
        { phrase: "dzie\u0144 temu", unit: "d", count: -1 },
        { phrase: "za tydzie\u0144", unit: "w", count: 1 },
        { phrase: "tydzie\u0144 temu", unit: "w", count: -1 },
        { phrase: "przysz\u0142y tydzie\u0144", unit: "w", count: 1 },
        { phrase: "w przysz\u0142ym tygodniu", unit: "w", count: 1 },
        { phrase: "nast\u0119pny tydzie\u0144", unit: "w", count: 1 },
        { phrase: "w nast\u0119pnym tygodniu", unit: "w", count: 1 },
        { phrase: "zesz\u0142y tydzie\u0144", unit: "w", count: -1 },
        { phrase: "w zesz\u0142ym tygodniu", unit: "w", count: -1 },
        { phrase: "za miesi\u0105c", unit: "m", count: 1 },
        { phrase: "przysz\u0142y miesi\u0105c", unit: "m", count: 1 },
        { phrase: "w przysz\u0142ym miesi\u0105cu", unit: "m", count: 1 },
        { phrase: "za rok", unit: "y", count: 1 },
        { phrase: "przysz\u0142y rok", unit: "y", count: 1 },
        { phrase: "w przysz\u0142ym roku", unit: "y", count: 1 },
      ],
      counted: [
        {
          prefix: "za",
          suffix: "",
          sign: 1,
          units: {
            d: ["dzie\u0144", "dni"],
            w: ["tydzie\u0144", "tygodnie", "tygodni"],
            m: ["miesi\u0105c", "miesi\u0105ce", "miesi\u0119cy"],
            y: ["rok", "lata", "lat"],
          },
        },
        {
          prefix: "",
          suffix: "temu",
          sign: -1,
          units: {
            d: ["dzie\u0144", "dni"],
            w: ["tydzie\u0144", "tygodnie", "tygodni"],
            m: ["miesi\u0105c", "miesi\u0105ce", "miesi\u0119cy"],
            y: ["rok", "lata", "lat"],
          },
        },
      ],
    },
    ordinals: [".", "-go", "go", "-ego", "ego"],
    strings: {},
  });

  if (typeof window !== "undefined" && window) {
    if (!window.__zentralNotesLangTables) window.__zentralNotesLangTables = {};
    window.__zentralNotesLangTables[lang.code] = lang;
    if (window.ZentralModuleLoader && typeof window.ZentralModuleLoader.define === "function") {
      window.ZentralModuleLoader.define("notes-lang-pl", lang);
    }
  }
  if (typeof module === "object" && module) module.exports = lang;
})();
