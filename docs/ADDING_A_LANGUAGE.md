# Adding a language to Zentral Notes

A language is a **data file**, not parser or UI logic (`OW-79`). Drop `additional/notes/i18n/<code>.js` in, run
`node tools/build-languages.cjs`, and the language appears in the settings menu. Before `OW-79` this needed three
edits in two JS files — a `loadOptional("…/en.js")` line in `ZentralNotes.uc.js`, an entry in
`NOTES_LANGUAGES` inside `ZentralNotesCalendar.js`, and a hardcoded pair in the settings menu — and the menu was
the one everybody forgot.

## 1. The file

Copy `additional/notes/i18n/en.js` and change the values. The shape is:

```js
(function () {
  "use strict";
  const lang = {
    code: "xx",              // must match the file name
    locale: "xx-XX",         // the BCP-47 tag Intl and date formatting use
    name: "Xxxxx Xxx",       // what the settings menu shows
    todayLabel: "…",
    overdueLabel: "…",
    agendaLabels: ["…", "…"],
    dateKinds: { today, tomorrow, next, other, earlier },
    relative: { "-2": […], "-1": […], "0": […], "1": […], "2": […] },
    weekdays: [[…], …],       // seven rows, long form first, then accepted short forms
    weekdayPrefixes: […],     // "on", "this", "next"
    weekdaysDisplay: { short: [7], long: [7] },
    months: [[…], …],         // twelve rows, long form first, then accepted short forms
    offsets: { phrases: [{ phrase, unit, count }], counted: [{ prefix, suffix, sign, units }] },
    ordinals: […],
    strings: Object.freeze({ "cal.todayBtn": "…", … }),
  };
  // register + freeze, exactly as en.js does
})();
```

Freeze the table the way `en.js` does (`freezeDeep`); the module registers it through `registerLanguage` and nothing
else reads the raw object.

## 2. The tables a language needs beyond `strings`

`strings` is only the interface text. Four other tables drive **date parsing**, and a language that has `strings` but
no tables will draw correctly while refusing to understand what a person types:

| Table                | Feeds                                            | Example (`en`)                            |
| :------------------- | :----------------------------------------------- | :---------------------------------------- |
| `relative` + offsets | `parseDateText` — "today", "tomorrow", "in 3 days", "last week" | `"1": ["tomorrow", "tmr", "tmrw"]` |
| `weekdays` / `months` | weekday and month names in a typed line          | `["monday", "mon"]`                       |
| `weekdaysDisplay`     | the drawn column headers and month names         | `{ short: ["Mon", …], long: ["Monday", …] }` |
| `ordinals`            | `25th`, `1st`, `december 25.`                    | `["st", "nd", "rd", "th", "."]`            |

`pl` in the repository is the working example of a language whose grammar is not English: twelve month names in the
genitive, `relative` words, and counted forms in both directions.

## 3. Plurals

Interface keys ending in `.one`, `.few`, `.other` (for example `cal.days.one`, `cal.days.few`, `cal.days.other`) are
chosen by `pluralCategory(count, lang)` in `ZentralNotesCalendar.js`:

- `pl` — `one` for 1, `few` for 2–4 outside 12–14, `other` for the rest;
- every other language — `one` for 1, `other` for the rest.

`tCount(baseKey, count, params, lang)` falls back to the **English** plural category per key, then to `baseKey +
".other"`, so a half-written language still produces a grammatical English sentence instead of a missing label.

## 4. Missing keys are never dots on screen

`translate(key, params, lang)` looks in the chosen language first, then English, and if **no** table has the key it
calls `reportTranslationGap(key, lang)` once per key and language, and shows `readableKey(key)` — the readable last
segment of the key (`cal.doesNotExist` → `"Does Not Exist"`) — never `cal.doesNotExist`. An empty string in a table
counts as missing, so a blank line in a translation file cannot blank a label.

Two helpers exist for code that changes behaviour rather than text:

- `hasTranslation(key, lang)` — the explicit "did a table have this?" question (`translate` no longer returns the key,
  so comparing its result with the key is always false);
- `translationGaps()` — every key that reached a person untranslated, with the languages that asked for it.

## 5. The menu is built from what registered

`tools/build-languages.cjs` reads this directory and writes `i18n/registry.js` (`{"languages": […], "fallback":
"en"}`). The sheet loads every code named there and draws the settings menu from `notesLanguages()`, which reports
each language's `name`, `locale`, `complete`, `missing` and `total`. `--check` fails when the registry is stale; the
release loop runs it beside the z-map check.

## 6. Workflow

1. Copy `i18n/en.js` → `i18n/<code>.js`, translate what you can, leave the rest out (a missing key falls back to
   English and is counted in the menu as `N missing`).
2. `node tools/build-languages.cjs`
3. `node tests/notes-more-languages.test.cjs` and `node tests/notes-i18n-ui.test.cjs`
4. Release loop (`build-standalone --bump` → `sync-version` → `build-standalone` → `build-preferences` →
   `build-z-map` → `build-standalone --check` → `tests/run-all.cjs`).

A language with `missing: 0` is `complete: true`; nothing in the code requires that, and a partially translated
language is a supported state, not a broken one.
