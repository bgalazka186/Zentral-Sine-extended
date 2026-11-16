"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const ROOT = path.resolve(__dirname, "..");

async function run() {
  // 1. Language tables live as pure data files under additional/notes/i18n/.
  const enPath = path.join(ROOT, "additional/notes/i18n/en.js");
  const plPath = path.join(ROOT, "additional/notes/i18n/pl.js");
  assert.equal(fs.existsSync(enPath), true, "English language data file exists");
  assert.equal(fs.existsSync(plPath), true, "Polish language data file exists");

  const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
  assert.deepEqual([...cal.NOTES_LANGUAGES], ["en", "pl"]);
  assert.equal(cal.cleanNotesLanguage("pl"), "pl");
  assert.equal(cal.cleanNotesLanguage("pl-PL"), "pl");
  assert.equal(cal.cleanNotesLanguage("en"), "en");
  assert.equal(cal.cleanNotesLanguage("unknown"), "en");
  assert.equal(cal.notesLocaleFor("pl"), "pl-PL");

  // Monday, 16 November 2026 at 09:00 local time.
  const now = new Date(2026, 10, 16, 9, 0, 0, 0).getTime();
  const keyOf = (text, opts) => {
    const ms = cal.parseDateText(text, now, opts);
    return ms === null ? null : cal.localDateKey(ms);
  };

  // 2. Polish relative words, diacritic folding (including ł -> l), weekdays, months, 'za N dni', 'next week', ordinals.
  assert.equal(keyOf("dziś", { lang: "pl" }), "2026-11-16");
  assert.equal(keyOf("dzis", { lang: "pl" }), "2026-11-16");
  assert.equal(keyOf("dzisiaj", { lang: "pl" }), "2026-11-16");
  assert.equal(keyOf("jutro", { lang: "pl" }), "2026-11-17");
  assert.equal(keyOf("pojutrze", { lang: "pl" }), "2026-11-18");
  assert.equal(keyOf("popojutrze", { lang: "pl" }), "2026-11-19");
  assert.equal(keyOf("wczoraj", { lang: "pl" }), "2026-11-15");
  assert.equal(keyOf("przedwczoraj", { lang: "pl" }), "2026-11-14");

  assert.equal(keyOf("day after tomorrow", { lang: "en" }), "2026-11-18");
  assert.equal(keyOf("day before yesterday", { lang: "en" }), "2026-11-14");
  assert.equal(keyOf("in 3 days", { lang: "en" }), "2026-11-19");
  assert.equal(keyOf("in 1 day", { lang: "en" }), "2026-11-17");
  assert.equal(keyOf("in 2 weeks", { lang: "en" }), "2026-11-30");
  assert.equal(keyOf("next week", { lang: "en" }), "2026-11-23");
  assert.equal(keyOf("2 days ago", { lang: "en" }), "2026-11-14");

  assert.equal(keyOf("za 3 dni", { lang: "pl" }), "2026-11-19");
  assert.equal(keyOf("za 1 dzień", { lang: "pl" }), "2026-11-17");
  assert.equal(keyOf("za dzien", { lang: "pl" }), "2026-11-17");
  assert.equal(keyOf("za tydzień", { lang: "pl" }), "2026-11-23");
  assert.equal(keyOf("za tydzien", { lang: "pl" }), "2026-11-23");
  assert.equal(keyOf("za 2 tygodnie", { lang: "pl" }), "2026-11-30");
  assert.equal(keyOf("przyszły tydzień", { lang: "pl" }), "2026-11-23");
  assert.equal(keyOf("w przyszlym tygodniu", { lang: "pl" }), "2026-11-23");
  assert.equal(keyOf("następny tydzień", { lang: "pl" }), "2026-11-23");
  assert.equal(keyOf("2 dni temu", { lang: "pl" }), "2026-11-14");

  // Weekdays with inflected and unaccented Polish forms.
  assert.equal(keyOf("wtorek", { lang: "pl" }), "2026-11-17");
  assert.equal(keyOf("we wtorek", { lang: "pl" }), "2026-11-17");
  assert.equal(keyOf("środa", { lang: "pl" }), "2026-11-18");
  assert.equal(keyOf("sroda", { lang: "pl" }), "2026-11-18");
  assert.equal(keyOf("w środę", { lang: "pl" }), "2026-11-18");
  assert.equal(keyOf("w srode", { lang: "pl" }), "2026-11-18");
  assert.equal(keyOf("piątek", { lang: "pl" }), "2026-11-20");
  assert.equal(keyOf("piatek", { lang: "pl" }), "2026-11-20");
  assert.equal(keyOf("w piątek", { lang: "pl" }), "2026-11-20");
  assert.equal(keyOf("poniedziałek", { lang: "pl" }), "2026-11-23");
  assert.equal(keyOf("poniedzialek", { lang: "pl" }), "2026-11-23");
  assert.equal(keyOf("śr", { lang: "pl" }), "2026-11-18");
  assert.equal(keyOf("ndz", { lang: "pl" }), "2026-11-22");
  assert.equal(keyOf("on friday", { lang: "en" }), "2026-11-20");
  assert.equal(keyOf("next tuesday", { lang: "en" }), "2026-11-17");

  // Months (nominative, genitive, short, unaccented) and ordinals.
  assert.equal(keyOf("25 listopada 2026", { lang: "pl" }), "2026-11-25");
  assert.equal(keyOf("14. listopada 2026", { lang: "pl" }), "2026-11-14");
  assert.equal(keyOf("14-go listopada 2026", { lang: "pl" }), "2026-11-14");
  assert.equal(keyOf("3 maja 2027", { lang: "pl" }), "2027-05-03");
  assert.equal(keyOf("10 października 2026", { lang: "pl" }), "2026-10-10");
  assert.equal(keyOf("10 pazdziernika 2026", { lang: "pl" }), "2026-10-10");
  assert.equal(keyOf("5 sty 2027", { lang: "pl" }), "2027-01-05");
  assert.equal(keyOf("14th November 2026", { lang: "en" }), "2026-11-14");
  assert.equal(keyOf("November 14th, 2026", { lang: "en" }), "2026-11-14");
  assert.equal(keyOf("1st dec 2026", { lang: "en" }), "2026-12-01");
  assert.equal(keyOf("22nd nov 2026", { lang: "en" }), "2026-11-22");
  assert.equal(keyOf("23rd nov 2026", { lang: "en" }), "2026-11-23");
  // Legacy multilingual month support remains intact when acceptAll !== false.
  assert.equal(keyOf("11. März 2026"), "2026-03-11");

  // 3. acceptAll preference gating: default true accepts all registered languages; false restricts to chosen language.
  assert.equal(keyOf("tomorrow", { lang: "pl", acceptAll: true }), "2026-11-17");
  assert.equal(keyOf("jutro", { lang: "en", acceptAll: true }), "2026-11-17");
  assert.equal(keyOf("in 3 days", { lang: "pl", acceptAll: true }), "2026-11-19");
  assert.equal(keyOf("za 3 dni", { lang: "en", acceptAll: true }), "2026-11-19");

  assert.equal(keyOf("jutro", { lang: "pl", acceptAll: false }), "2026-11-17");
  assert.equal(keyOf("pojutrze", { lang: "pl", acceptAll: false }), "2026-11-18");
  assert.equal(keyOf("za 3 dni", { lang: "pl", acceptAll: false }), "2026-11-19");
  assert.equal(keyOf("środa", { lang: "pl", acceptAll: false }), "2026-11-18");
  assert.equal(keyOf("25 listopada 2026", { lang: "pl", acceptAll: false }), "2026-11-25");
  assert.equal(keyOf("tomorrow", { lang: "pl", acceptAll: false }), null);
  assert.equal(keyOf("day after tomorrow", { lang: "pl", acceptAll: false }), null);
  assert.equal(keyOf("in 3 days", { lang: "pl", acceptAll: false }), null);
  assert.equal(keyOf("wednesday", { lang: "pl", acceptAll: false }), null);
  assert.equal(keyOf("25 November 2026", { lang: "pl", acceptAll: false }), null);

  assert.equal(keyOf("tomorrow", { lang: "en", acceptAll: false }), "2026-11-17");
  assert.equal(keyOf("day after tomorrow", { lang: "en", acceptAll: false }), "2026-11-18");
  assert.equal(keyOf("in 3 days", { lang: "en", acceptAll: false }), "2026-11-19");
  assert.equal(keyOf("jutro", { lang: "en", acceptAll: false }), null);
  assert.equal(keyOf("pojutrze", { lang: "en", acceptAll: false }), null);
  assert.equal(keyOf("za 3 dni", { lang: "en", acceptAll: false }), null);
  assert.equal(keyOf("25 listopada 2026", { lang: "en", acceptAll: false }), null);
  // ISO and symbolic offsets always work regardless of language restriction.
  assert.equal(keyOf("2026-11-25", { lang: "pl", acceptAll: false }), "2026-11-25");
  assert.equal(keyOf("+3d", { lang: "pl", acceptAll: false }), "2026-11-19");

  // 4. Adding a language is a pure data registration, not parser logic.
  cal.registerLanguage({
    code: "es-test",
    locale: "es-ES",
    name: "Español (test)",
    agendaLabels: ["Hoy", "Mañana", "Pasado mañana"],
    overdueLabel: "Atrasado",
    relative: {
      0: ["hoy"],
      1: ["manana"],
      2: ["pasado manana"],
      "-1": ["ayer"],
    },
    weekdays: [["domingo"], ["lunes"], ["martes"], ["miercoles"], ["jueves"], ["viernes"], ["sabado"]],
    weekdaysDisplay: {
      short: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
      long: ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"],
    },
    months: [
      ["enero"], ["febrero"], ["marzo"], ["abril"], ["mayo"], ["junio"],
      ["julio"], ["agosto"], ["septiembre"], ["octubre"], ["noviembre"], ["diciembre"],
    ],
  });
  assert.equal(keyOf("mañana", { lang: "es-test", acceptAll: false }), "2026-11-17");
  assert.equal(keyOf("pasado mañana", { lang: "es-test", acceptAll: false }), "2026-11-18");
  assert.equal(cal.agendaDayLabel(2, cal.addDays(cal.dayStart(now), 2), "es-test"), "Pasado mañana");

  // 5. Date entry, %%calendar%% list lines, and @inline chips never expand typed note prose.
  assert.equal(cal.parseDateEntry("pojutrze", { now, lang: "pl", acceptAll: false }), "2026-11-18");
  assert.equal(cal.parseDateEntry("za 3 dni", { now, lang: "pl", acceptAll: false }), "2026-11-19");
  assert.equal(cal.parseDateEntry("21st", { now, lang: "en", acceptAll: false }), "2026-11-21");
  assert.equal(cal.parseDateEntry("14-go", { now, lang: "pl", acceptAll: false }), "2026-11-14");
  assert.equal(cal.parseDateEntry("tomorrow", { now, lang: "pl", acceptAll: false }), "");

  const noteBody = [
    "# Plan tygodnia",
    "%%calendar%%",
    "- jutro 09:00 Spotkanie zespołu",
    "- pojutrze Wizyta u lekarza",
    "- za 3 dni 14:00-15:00 Przegląd projektu",
  ].join("\n");
  const prepared = cal.ensureNoteItemIds(noteBody, "n-pl", now, { lang: "pl", acceptAll: false });
  assert.match(prepared.body, /- jutro 09:00 Spotkanie zespołu/, "note text keeps relative Polish words unexpanded");
  assert.match(prepared.body, /- pojutrze Wizyta u lekarza/, "note text keeps pojutrze unexpanded");
  const extracted = cal.extractNoteItems(prepared.body, "n-pl", now, { lang: "pl", acceptAll: false });
  assert.equal(extracted.length, 3);
  assert.equal(cal.localDateKey(extracted[0].start), "2026-11-17");
  assert.equal(cal.localDateKey(extracted[1].start), "2026-11-18");
  assert.equal(cal.localDateKey(extracted[2].start), "2026-11-19");

  const tokens = cal.inlineDateTokens(
    "Spotkanie @jutro 10:30 i @pojutrze oraz 25 listopada 2026 z @marek",
    now,
    { lang: "pl", acceptAll: false },
  );
  assert.deepEqual(
    tokens.map((t) => ({ raw: t.raw, ymd: t.ymd, time: t.time })),
    [
      { raw: "@jutro 10:30", ymd: "2026-11-17", time: "10:30" },
      { raw: "@pojutrze", ymd: "2026-11-18", time: "" },
      { raw: "25 listopada 2026", ymd: "2026-11-25", time: "" },
    ],
  );

  // 6. Agenda labels (Dziś, Jutro, Pojutrze, then weekday + date), overdue label, and weekday headers.
  const baseDay = cal.dayStart(now);
  assert.equal(cal.agendaDayLabel(0, baseDay, "pl"), "Dziś");
  assert.equal(cal.agendaDayLabel(1, cal.addDays(baseDay, 1), "pl"), "Jutro");
  assert.equal(cal.agendaDayLabel(2, cal.addDays(baseDay, 2), "pl"), "Pojutrze");
  assert.equal(
    cal.agendaDayLabel(3, cal.addDays(baseDay, 3), "pl"),
    new Date(cal.addDays(baseDay, 3)).toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" }),
  );
  assert.equal(cal.agendaDayLabel(0, baseDay, "en"), "Today");
  assert.equal(cal.agendaDayLabel(1, cal.addDays(baseDay, 1), "en"), "Tomorrow");
  assert.deepEqual(cal.weekdayLabels(1, "short", "pl"), ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Ndz"]);

  const zenProj = cal.agendaZenProjection(extracted, now, 4, () => false, null, null, { lang: "pl" });
  assert.deepEqual(zenProj.slice(0, 3).map((d) => d.label), ["Dziś", "Jutro", "Pojutrze"]);
  const overdueItem = cal.cleanItem({
    id: "ov-1",
    summary: "Zaległy rachunek",
    start: { dateTime: new Date(2026, 10, 14, 10, 0, 0, 0).toISOString() },
    status: "confirmed",
    x: { kind: "reminder" },
  });
  const overdueProj = cal.agendaOverdueProjection([overdueItem], now, { lang: "pl" });
  assert.equal(overdueProj.label, "Zaległe");

  console.log("PASS notes-language-dates");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
