# ZentralNotes — Master TODO & Roadmap

> **Read this first.** This file contains ONLY work that is still to do, in the order it should be done. Every finished (`DONE`) row lives in `docs/LEGACY_done_rows.md` and `docs/LEGACY_notes_roadmap.md`; never look there for work. Rebuilt 2026-11-14 from the old roadmap, two source-code audits (2026-11-13) and the owner's 2026-11-14 list.
>
> 1. **Do tasks in the order of the Master Order table**, top to bottom; a task's `Depends on` must be `DONE` (removed from this file) first. The blocks below follow the same order.
> 2. **Each task is a block** (`####`) with Problem, Plan (ordered sub-steps), Tests. Carried-over tasks keep their original wording under 'Current state' / 'Full specification'.
> 3. **When a task is finished: delete its block and its table row, renumber nothing (IDs are stable), append the finished row to `docs/LEGACY_done_rows.md`, and report it in the NEXT SESSION HANDOFF.** Partial work: keep the block, change `Status` to `PARTIAL` and write `DONE:` / `LEFT:`.
> 4. Owner decisions are binding (see 'Ground rules' and 'Track 2 design rules').

### ID prefixes

| Prefix                   | Meaning                                               |
| :----------------------- | :---------------------------------------------------- |
| `F0.x`                   | Test/measurement foundation                           |
| `H1.x`                   | Hardening: loops, data loss, alert storms             |
| `PF2.x`                  | Performance                                           |
| `TM3.x`                  | Time correctness (wake, DST, overdue, missed)         |
| `UI4.x`                  | Interaction safety (click, drag, keyboard, re-render) |
| `OW-xx`                  | Owner request or bug report (stable IDs)              |
| `SB6.x`                  | Zen sidebar polish                                    |
| `ST7.x`                  | Structural changes                                    |
| `T1.x`..`T4.x`, `B3.3.x` | Carried over from the previous roadmap                |
| `DOC-x`                  | Documentation that disagrees with the code            |

## Ground rules

Finished work and the long history live in `docs/LEGACY_notes_roadmap.md` and `docs/LEGACY_done_rows.md` (both frozen; the second holds every row that was DONE on 2026-11-14). Row references like "Cycle G #26" or "S6 W4" point into that file.

- Ordered by **impact on the daily user experience**, biggest first; inside a similar impact the cheaper item goes first. Re-order when the owner's priorities change.
- Everything that was listed as "verify in a real Zen" is **assumed to work** (owner decision, 2026-11-04). Do not re-add live-check items; only add one when a new Zen-only change cannot be reasoned about.
- Effort: S = under one session slice, M = one session, L = several sessions or a new subsystem.
- Never build: cloud sync inside the mod (owner: NO until the whole mod is finished); a sandboxed iframe with user JS (unsafe in chrome context); the Zen-native "Notes" folder as a Sync-excluded object (blocked, `docs/NOTES-ZEN-FOLDER-BLOCKER.md`).
- Never build (added 2026-11-07, security): raw HTML from a note reaching the chrome document (`<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<video src>` or any attribute copied from the note: K12, B23); embeds from any host other than YouTube (and only through the player in row 22); code that runs inside a note (Templater-style `<% %>`, N10); text-expander words such as `;date` (N11); opening a dropped file from inside Notes (show it in the folder instead).
- Dropped on 2026-11-16, do not re-add: `T3.11` (live checks and low-value polish), `T4.4` (its premise was wrong: `stretched()` and `SLOT.quad` are live code), `AU-B2` (folded into `T3.4a`).
- Dropped on 2026-11-07, do not re-add without the owner: "panel-like options for standalone Notes: push page, reveal on hover over the top edge" (the card already has them since 3.1.28); "Open in new container on the Notes folder" (edge case, our tabs already hide the native items); "footer-counter debounce knob" (breaks the rule that a setting exists only where a person can notice a difference).
- Effort and impact columns: S = under one session slice, M = one session, L = several sessions or a new subsystem.

### Status legend (every row's Implementation Plan starts with one of these words)

| Word      | Meaning                                                     | What the AI does                                                         |
| :-------- | :---------------------------------------------------------- | :----------------------------------------------------------------------- |
| `DONE`    | Code, tests and handoff note exist in this repository.      | Nothing. Do not redo; only re-open if a test fails.                      |
| `PARTIAL` | A pure/tested part exists; the named `LEFT:` part does not. | Implement only the `LEFT:` part.                                         |
| `OPEN`    | Specified, approved by the owner, not started.              | Implement exactly as written; follow the dependency list.                |
| `PARKED`  | Idea, **not approved**.                                     | **Do not implement.** Only the owner can promote it (see _Parking lot_). |

### Rules for the AI that executes this plan (read before every task)

These apply to every row. They come from past regressions; each rule was checked against this code base (vanilla JS in a Firefox/Zen chrome window, no React, no Remark, no bundler).

1. **One row per chunk, dependencies first.** Do the lowest open row whose `Depends on` rows are `DONE`. If a row says `LEFT:`, do not touch what is `DONE`. Never start `T2.13` (ICS) before every other Track 2 row is `DONE`.
2. **Pure function first.** Write the logic as a pure function in `additional/notes/calendar/ZentralNotesCalendar.js` (or the existing pure parts), export it through the module `api` (and `__zentralNotesTestSeam.core` for `ZentralNotes.uc.js` code), write the failing test, then the code, then the UI wiring. Test file name pattern: `tests/notes-<topic>.test.cjs`; copy the style of `tests/notes-calendar-category.test.cjs`.
3. **Date keys are local and immutable.** The key of a day is the local `YYYY-MM-DD` made with `localDateKey(ms)` / `ymd(date)` from the calendar module. NEVER `toISOString().slice(0, 10)` for a day key (UTC shifts the day near midnight; a test fails if one appears). NEVER use a formatted display string (`14-11-2026`, `Reminders for 14-11-2026`) as an id, key, file name or lookup; format only when drawing (`formatDateKey`, `dateNoteTitle`). Existing date notes are found by their ISO title (`DATE_TITLE_RE`); changing how a title looks needs a migration plus a lookup that still finds old notes.
   3a. **Marker preservation.** Never strip or rewrite hidden markers when parsing or saving a note: `%%zn-item-id:...%%` (line identity), `%%not-date%%`-style ignore marks, `%%calendar%%` sections, front matter, and `<!-- r-id: UUID -->` comments if a note contains them. Removing one detaches the line from its stored item, calendar note, moved time or reminder.
4. **Never mutate stored objects in place.** `store.items`, `meta`, note objects: copy, change the copy, hand it to the store method. UI lists re-render from a fresh array.
5. **Context menus.** Every right-click handler calls `e.preventDefault()` and `e.stopPropagation()`; every menu closes on outside click, Escape, action, cancel, view switch and sheet destroy, and removes its listeners/timers (see `T2.12c1`). No MutationObservers, no global disabled-state normalizers, no document-wide polling.
6. **Listeners and timers** are created through the scope helpers (`listen`, `setTimeout`, `own`) or registered for cleanup before fallible work; after an `await`, check the scope is still active. This mod uses no `BroadcastChannel` or `WebSocket`; do not add one.
7. **Conflicts: last write wins.** Two edits of one record (calendar editor and note text, two windows) resolve with `lwwPick(local, remote)` (newer `updated`, then higher `rev`); do not invent vector clocks. Millisecond `updated` is the only clock.
8. **Do not add a setting** that nobody can notice a difference from. A new setting follows "How to add a feature (short)" below, including `tools/organize-layout-order.cjs`, `tools/build-preferences.cjs` and the drift checks.
9. **Security rules in "Never build" stay absolute** (no raw HTML from notes, no code execution in notes, no remote embeds except YouTube).
10. **Finish every chunk the same way:** run the release loop, run `node tests/run-all.cjs`, update this file (rows, handoff, version), commit the changes to Git (owner now uses Git-based AIs; do NOT create or present ZIPs unless the owner asks in chat).

11. **Tests before changes.** No change to the Zen sidebar projections without a harness test (`F0.1`), no change to a hot path (projection, scheduler, recurrence, history) without a budget test in the production call shape (`F0.2`). Record before/after numbers in the handoff.
12. **Performance rules.** Never scan all records or all items per occurrence (use indexes, see `PF2.1`); never run heavy work directly in a handler that fires on every store event (debounce, filter by event kind and id); never deep-copy with JSON round trips in loops.
13. **Sidebar safety.** Touch only tabs/folders that carry our attributes; ignore events caused by our own operations; reconcile must be idempotent (a second run on an unchanged store performs zero DOM operations); a foreign tab/folder inside a managed folder is moved out, never destroyed.
14. **Alerts.** One alert per stage per occurrence and schedule; never fire several stages in one pass (`H1.5`); alerts must survive sleep/clock changes (`TM3.1`).
15. **Owner rule reversal 2026-11-14.** In Month view a click selects the day; it does not open Day view (`OW-06`). Do not re-add the old behaviour from old rows or tests.
16. **Never hand a DOM element to `assert.equal` / `assert.deepEqual`.** When such an assertion fails, Node renders both fake DOM trees into the message and the test file never ends. Compare elements with `===` inside `assert.ok(...)` and assert on ids, labels or counts. `tests/run-all.cjs` stops a file after 5 minutes (`ZENTRAL_TEST_TIMEOUT_MS`) and reports it as failed; while writing a new test file, run it under `timeout 60 node …`.
17. **Sidebar projection & pseudo-tab regression guards (retained from `ST7.1`/`OW-18`).** Always materialize `querySelectorAll()` (`[...list]`) before calling Array methods (`NodeList` has no `.filter`/`.map`); bind NOTES/Agenda click and select handlers before fallible workspace projection sync; keep storage/data ownership separate from sidebar projection DOM movement (`syncSharedWorkspace`); exclude Notes/Agenda pseudo-tabs from normal-tab unload successors using live URI/SessionStore predicates (never cached labels/stale expandos); allow dragging ordinary web tabs out of managed folders; activate Agenda pseudo-tabs on stationary unmodified left `mouseup` with single-fire delayed-click suppression.
18. **Real Zen sidebar DOM guardrails (retained from `OW-40`).** Never short-circuit onto `document.getElementById("vertical-tabs") || ...` or `#sidebar-box` without filtering out `display: none` / `0×0` Firefox stubs — in Zen `1.24.1b+`, `#vertical-tabs` and `#sidebar-box` remain in the DOM as hidden `0×0` boxes while real tabs live under `#navigator-toolbox` → `#TabsToolbar-customization-target` → `#tabbrowser-tabs` → `zen-workspace[active]` (with off-screen inactive workspaces and `.zen-workspace-empty-space`). Any sidebar layout, anchoring, or hover change must be tested against `tests/helpers/real-zen-sidebar-dom.cjs` and keep `tests/zen-sidebar-dom-guardrails.test.cjs` green.

---

## Master Order (all remaining work)

Order = impact first (High to Low); inside the same impact the cheapest effort first (S to L); a row never comes before a row it depends on. Impact and effort: S = under one session slice, M = one session, L = several sessions.

| Order | ID          | Status    | Impact              | Effort | Depends on        | Task                                                                                                     |
| ----: | :---------- | :-------- | :------------------ | :----- | :---------------- | :------------------------------------------------------------------------------------------------------- |
|    36 | `T2.13`     | `DONE`    | Med                 | M      | all other Track 2 | ICS export/import and Google-sync groundwork (always last in Track 2)                                    |
|    41 | `T4.3a`     | `OPEN`    | Med                 | M      | none              | Extract calendar UI from `ZentralNotes.uc.js`                                                            |
|    42 | `T4.3b`     | `OPEN`    | Med                 | M      | T4.3a             | Extract parser/wiki graph and import/export                                                              |
|    43 | `T4.3c`     | `OPEN`    | Med                 | M      | T4.3b             | Extract Zen sidebar UI; single build entry                                                               |

|    54 | `ST7.4`     | `OPEN`    | Low-Med (long term) | L      | ST7.1             | Render Agenda rows without real tabs (research)                                                          |
|    88 | `OW-63`     | `DONE`    | High                | M      | 3.3.297           | Stopwatch face: clicking the running stopwatch does not go back to the clock, and on a narrow widget its text fields push the buttons out of view |
|    89 | `OW-64`     | `DONE`    | Med                 | M      | 3.3.299           | One language selector for every widget, following the Notes language until the person overrides it |
|    90 | `OW-62`     | `DONE`    | High                | S-M    | 3.3.298           | An imported .ics reminder still cannot be deleted: recreate the missing note instead of refusing |
|    91 | `OW-65`     | `DONE`    | High                | S      | 3.3.301           | Clock card: quick note under the clock by default, the stopwatch/countdown panel under it on a click, the clock no longer drawn above it, and "Wyzeruj" no longer clipped |
|    92 | `OW-66`     | `OPEN`    | Med                 | S      | —                 | The live Zen check the owner still owes `OW-58`–`OW-65`, `OW-73`–`OW-76` and `OW-80`–`OW-86`: each shipped fix confirmed in the real sidebar (no code work) |
|    93 | `OW-67`     | `DONE`    | High                | S      | —                 | Widgets stay blank after the sidebar is revealed when "pause when hidden" is off: nothing repaints an unpaused widget whose state changed while hidden |
|    94 | `OW-68`     | `DONE`    | High                | S      | —                 | Clock quick note must stay ONE line, and the Save button wins the space (the field gives ground, never the button) |
|    95 | `OW-69`     | `DONE`    | High                | S      | —                 | The quick note is optional again: one switch that hides it, remembering the choice |
|    96 | `OW-70`     | `DONE`    | High                | M      | —                 | Status widget: no battery on a desktop and no memory reading on this build — find out why, and make "this machine has no battery" quiet rather than a broken card |
|    97 | `OW-71`     | `DONE`    | Med                 | M      | —                 | Let the person order the widgets top to bottom (drag and keyboard), persisted, with the order surviving restarts |
|    98 | `OW-72`     | `DONE`    | Med                 | M      | —                 | Let the person pick the widgets' appearance (colours/contrast) so the cards stay readable in every theme |
|    99 | `OW-73`     | `DONE`    | High                | S      | —                 | All-notes toolbar: "Recent" and the Split view / Folder tree / Hide calendar buttons fit on one line but wrap to two |
|   100 | `OW-74`     | `DONE`    | High                | M      | —                 | With the calendar control strip hidden the basic controls must still be reachable, sitting right of the calendar name and left of the long month name, and outranking the name |
|   101 | `OW-75`     | `DONE`    | Med                 | M      | —                 | Re-see every calendar menu — they are unreadable: regroup by how often each option is used, move the "create … from calendar" extras under Notes "+" |
|   102 | `OW-76`     | `DONE`    | Med                 | M      | —                 | Calendar and notes must copy the style of Zentral's appearance themes by default, with extra customisation only if the person opts in |
|   103 | `OW-77`     | `DONE`    | Med                 | M      | —                 | A visual audit of every calendar/notes menu in real Chromium (the fit-audit harness) so "unreadable" is measured, not argued, and stays measured |
|   104 | `OW-78`     | `DONE`    | Med                 | S      | —                 | One theme-resolution path: the CSS `--zn-*` variables and the JS resolver must agree, so `zentral` cannot mean two different palettes |
|   105 | `OW-79`     | `DONE`    | Low-Med             | M      | —                 | More languages without code: a language file must be droppable in, and a missing translation must never show a raw key like `cal.todayBtn` |
|   106 | `OW-80`     | `DONE`    | High                | L      | —                 | Big Picture: the Notes tree must be there too, on the left edge, with all of its functions — including drag of a note into the calendar to create an item |
|   107 | `OW-81`     | `DONE`    | Med                 | S      | —                 | Quick settings: choose whether dragging a note into the calendar creates an event or a reminder by default |
|   108 | `OW-82`     | `DONE`    | High                | M      | —                 | Dragging a calendar item onto empty space asks before deleting it, with a "don't ask for 5 minutes" button — in All notes AND Big Picture |
|   109 | `OW-83`     | `DONE`    | Med                 | S      | —                 | The calendar's `‹` / `›` chevrons are small bare glyphs, not bordered pills the size of the buttons beside them |
|   110 | `OW-84`     | `DONE`    | Low                 | S      | —                 | The Notes `+` menu must not offer the same creation twice ("New reminder" and "Create timed reminder…" opened the same composer) |
|   111 | `OW-85`     | `DONE`    | High                | M      | —                 | Correction to OW-73: revert it (it targeted the Notes rows) and put the split-view / folder-tree / hide-calendar buttons in the bar under the title, above the search, where they cannot be cut by the window edge |
|   112 | `OW-86`     | `DONE`    | Med                 | M      | —                 | In the Big Picture tree a click selects (Shift/Ctrl as in the docked tree), a double click opens, and dropping several selected notes on one day asks what the drop should make |
|   113 | `OW-87`     | `DONE`    | Low                 | S      | —                 | The logger's core category must default to off in the repository, so a fresh install does not turn on a debug stream the owner already switched off locally |
|   114 | `OW-88`     | `DONE`    | High                | M      | —                 | Notes and Agenda sidebar placeholders each hold a whole content process (about 11 extra processes, half a gigabyte): keep them unloaded and every visible behaviour identical |
|   115 | `OW-89`     | `DONE`    | High                | M      | OW-88             | Boost, part one: read total browser RAM on demand, free memory losslessly, trim once after startup |
|   116 | `OW-90`     | `DONE`    | Med                 | M      | OW-89             | Boost, part two: the sidebar card and its menu (replaces the Status card) |
|   117 | `OW-91`     | `DONE`    | Med                 | L      | OW-89             | Boost, part three: unload what is not in use (normal tabs and opt-in panels), with one Restore |
|   118 | `OW-92`     | `DONE`    | Med                 | M      | OW-89             | Boost, part four: a RAM limiter with a soft and a hard mode, one-shot timers only |
|   119 | `OW-93`     | `DONE`    | Med                 | M      | OW-91             | Background mode per essential panel (live / throttled / allow sleep), so a hidden arena.ai is throttled instead of burning a core |
|   120 | `OW-94`     | `DONE`    | Med                 | L      | OW-91             | Game Mode: pause every feature's timers and keep only audible tabs and the video source active, with a stronger saver behind a second switch |
|   121 | `OW-95`     | `DONE`    | High                | M      | —                 | Weather card: more than three places, and a click that cycles Today / Tomorrow / Week instead of swapping two halves. Long press goes to the next place, a hold (or Escape) comes back to Today and the first place |
|   122 | `OW-96`     | `DONE`    | High                | L      | —                 | Calendar: a small weather symbol and temperature above the weekday name in Week view (Month view an option, off by default), a Week view that goes up to 48 days and stacks them in two rows of 24 when the pane allows, and a refresh trust that decays with how far a day is |
|   123 | `OW-97`     | `DONE`    | High                | S      | —                 | All notes: the calendar's "Go to today" and month/week buttons must be GLYPHS (calendar + dot, chevron), never words, and the header must give up its room in this order — the title first, then the long date range, then nothing — so settings and Big Picture can never be pushed out of the window. The notes tree is a pixel WIDTH the user sets and the calendar takes what is left, so stretching the window moves only the calendar |
|   124 | `OW-98`     | `DONE`    | High                | M      | —                 | Zen sidebar: a normal tab's right-click menu wins over ours on rows where a note or a reminder lives (a note inside a Zen folder is the reported case). Find out which path actually takes the event and make ours win only on our own rows, never on a plain tab |
|   125 | `OW-99`     | `DONE`    | Med                 | M      | OW-98             | "Scan all performance improvements for bugs and issues": one pass over every perf claim in the tree (the widget scheduler, the calendar fit loop, the Notes store writes, the Boost/RAM paths, the sidebar listeners) looking for the same class of bug the OW-96 `prefBool` mistake was — a guard that cannot be true, a listener that is never removed, a timer that is never cleared |
|   126 | `OW-100`    | `DONE`    | Med                 | S      | —                 | Widgets: dragging elements inside a card does nothing — either make it reorder something real or take the drag away, so the cursor and the affordance stop promising a move that never happens |
|   127 | `OW-101`    | `DONE`    | High                | S      | —                 | Notes: while writing, the note's most top bar is glued to the bottom of the space it has and is partly hidden behind the tool strip. It must sit in the middle of the space available to it |
|   128 | `OW-102`    | `DONE`    | High                | M      | —                 | Calendar: creating more than one event at once does not work — the second creation is lost, refused or overwrites the first. Find where the composer's state or the store write is shared between two creations |
|   129 | `OW-103`    | `DONE`    | High                | M      | —                 | Switching the Zentral web panel throws the person out of All notes / the calendar view: the view is reset on switch instead of being kept (or restored) where it was |
|   130 | `OW-104`    | `DONE`    | Med                 | S      | —                 | All notes / calendar: the three-dot menu on the top bar still acts on the last open note, which is confusing — it must either act on the calendar view that is showing, or say plainly which note it belongs to (and be disabled when none is open) |
|   131 | `OW-105`    | `DONE`    | High                | S      | —                 | Widgets: explicit colour values forced in settings must be applied to every widget card and its controls |
|   132 | `OW-106`    | `DONE`    | High                | S      | —                 | Notes / Calendar: opening the feature defaults to the All notes screen, not the last note opened |
|   133 | `OW-107`    | `DONE`    | High                | S-M    | —                 | Weather: audit what location data leaves the browser, where it is sent, and what permissions/consent are involved; document the actual behaviour and close any unnecessary exposure |

---

## Task blocks (same order as the Master Order)

### RAM plan (`OW-87`–`OW-94`) — source: `docs/PLAN_CODING_AGENT.md`

The owner measured his own browser (2026-11-18) and wrote the plan himself with an AI: the whole window including
every Zentral script and DOM is about 49 MB, so **the code is not the problem and nothing here refactors for size**.
What costs RAM is (a) about eleven Notes/Agenda placeholder tabs, each holding a content process of 43–51 MB, and
(b) real heavy pages (Messenger ≈0.9 GB, arena.ai ≈0.9 GB, WhatsApp ≈0.75 GB, an idle YouTube ≈1.1 GB) which the mod
can only unload or throttle on demand. The full task text, owner gates and the do-not list live in that file; these
blocks are the roadmap-sized version of it. Order is fixed: `OW-87` → `OW-88` → `OW-89` → `OW-90` → `OW-91` → `OW-92`
→ `OW-93` → `OW-94`. Every row keeps the plan's kill-switch rule (default ON = new behaviour, off = exactly today),
adds `tests/<id>.test.cjs`, and writes one line into `docs/perf-results.md` with effect "not measured".

#### `OW-87` — The core logger category is off in the repository too

**Status:** `DONE` (3.3.315) · **Impact:** Low · **Effort:** S · **Source:** `docs/PLAN_CODING_AGENT.md` task B0

**Problem:** the owner already switched `zen.workspace.zentral.debug.core` off on his machine, but the repository shipped
it as `true` in `additional/diagnostics/settings.json`, in the settings preset `extension/settings/recommended.json`
and in `ZentralShared`'s fallback table, so every fresh install turned a debug stream back on — and the settings dialog
hard-set it to `true` on save.

**Done at 3.3.315** — the default is `false` in the schema, the preset and Core's fallback table (so `preferences.json`
rebuilt to `false` as well); the logger's `isModuleEnabled` no longer short-circuits `core` to `true`, so the category
follows its own pref like every other one — without that, the owner's local `false` and the new switch would both have
been decorative; and the settings row is a real switch that loads from and saves to the pref instead of a checked,
`disabled` control that re-forced `true` on every save. `zen.workspace.zentral.modules.logger.enabled` is untouched, by
the plan's own instruction. `tests/ow-87-debug-core-default.test.cjs` (6 tests) pins all four places, and
`tests/diagnostics-logger.test.cjs` grew the two cases that prove core is now switch-governed.

#### `OW-88` — Notes/Agenda placeholders must not hold a content process

**Status:** `DONE` (3.3.317) · **Impact:** High · **Effort:** M · **Source:** `docs/PLAN_CODING_AGENT.md` task B1

**Done at 3.3.317** — implemented exactly as written below, plus the three defects the tests found on the way.

`parkPseudoTab(tab)` discards a placeholder and returns the reason it did not (`pref-off`, `disconnected`, `off`,
`already-pending`, `selected`, `busy`, `not-a-placeholder`, `no-discard`, `failed`), so the guard table is testable
rather than implied. It is called from a deferred task for every tab `zenNewTab`/`agendaNewTab` finished marking and
pinning, for every placeholder `onPseudoTabRestored` sees, and right after both deferred hand-backs in `onZenSelect`.
The discard opens the existing `zenEventsIgnored()` quiet window, so the `TabBrowserDiscarded` it causes cannot start a
projection repair run.

Three things the first draft got wrong, each now pinned by a test: (a) one coalesced timer parked only the LAST of the
tabs a projection run created — a queue drained by one task parks all of them (twenty placeholders → twenty discards);
(b) a click answers with an activation that is still running, so the first parking attempt legitimately says `busy` and
the row stayed loaded — there is now a bounded retry (three tries, 2.5 s apart, no polling); (c) parking at 0 ms/400 ms
collided with the existing 0 ms interaction tasks and turned six passing Notes tests red — the parking delays are
1200 ms and 2500 ms, deliberately away from every delay the sheet already uses (0/16/50/60/300/500/1000/6000/6500/
90000), because a test that fires one timer by its delay must not hit ours.

Pref `zen.workspace.zentral.notes.park_pseudo_tabs` (default on) is declared in `additional/notes/settings.json`, the
layout order, the standalone list and the in-app list (a **Memory** heading, translated in `en` and `pl`), and it is
read live. `tests/ow-88-park-pseudo-tabs.test.cjs` (8 tests) drives the guards, the kill switch, the click path, a
restored placeholder, the quiet window, the bounded retry and an Agenda row. Full suite 247/247.

**OWNER GATE (three checks, in the real sidebar):** (1) opening a note and an agenda item from the sidebar still works;
(2) labels and icons stay; (3) About:Memory or D1 shows the number of `web` processes down from about 11 to 1–2. If
anything breaks, the fix is to switch the kill-switch pref off (old behaviour exactly), not to patch around it.

**Problem:** `about:blank#zn-note:<id>` and `about:blank#zn-agenda-<key>` are created as live tabs, so each one loads a
content process (~50 MB) for a page that only exists to be a sidebar row.

**Plan (symbols in `additional/notes/ZentralNotes.uc.js`):** `parkPseudoTab(tab)` = `discardBrowser(tab, true)` in
`try/catch`, skipped when the tab is disconnected, selected, `zenBusy`, already `pending`, or not a placeholder; called
from a scope `setTimeout(…, 0)` after `addManagedPseudoTab`'s callers finish marking/pinning, after
`onPseudoTabRestored`, and right after the deferred hand-back in `onZenSelect`/`activateZenTab`; wrapped in the
existing `zenEventsIgnored()` quiet window. Pref `zen.workspace.zentral.notes.park_pseudo_tabs` (default `true`) in the
Notes settings Advanced section: "Keep sidebar note/agenda placeholders unloaded (saves memory)".
Never touch a real note tab or a non-placeholder tab; never re-select inside Zen's own `TabSelect` dispatch.

**Tests:** 20 placeholders → 20 discards after the creator returns; selected/busy/pending/disconnected skipped;
kill-switch off → zero calls; a click still opens the note, hands selection back, then parks again; the existing
Notes tests pass unchanged. **Owner gate:** a note and an agenda item still open from the sidebar, labels/icons stay,
`about:memory` / D1 shows `web` processes down from ~11 to 1–2.

#### `OW-89` — Boost core: memory meter, Level 1, post-startup trim — `DONE` (3.3.318)

**Shipped:** `additional/boost/` (`ZentralBoost.uc.js`, `settings.json`, `standalone.json`, `README.md`, generated
standalone set), catalog entry `boost` beside `tab-unload`, category `boost` · section `Memory` in the Sine settings
page (after `startup`). `memoryMB()` = parent + every child `memory`, MB, `null` when the build cannot answer, one
warning and the meter turns itself off while "free memory" keeps working; `runLevel1()` = reporter manager
`minimizeMemoryUsage({run})` → `forceGC()` → `forceCC()` (each in `try/catch`, `by` reports `minimize` or
`gc-cc-only`) → after reading 3 s later, `{beforeMB, afterMB, freedMB, by}`, one run at a time, nothing closed or
unloaded; the post-startup trim = one Level 1 per browser start, after session restore, 90 s without input, nothing
audible/playing, through `requestIdleCallback`, with a 6-minute hard ceiling and one one-shot timer that input
re-arms. Sampling only while someone holds it (`startSampling`/`stopSampling`, 2 s, two users max), no `setInterval`
anywhere. Prefs `zen.workspace.zentral.boost.enabled` and `...boost.startup_trim` (both `true`, read live).
`destroy()` cancels every timer, listener and idle callback and removes `window.ZentralBoost`.
**Tests:** `tests/ow-89-boost-core.test.cjs` (14) runs the real module in a fake chrome window. **Deviations:** the
startup barrier is the session-restore promise plus the runtime's own native-ready ordering, because the standalone
shim does not provide `whenNativeReady` (`build-standalone.cjs` rejects it by name). **Open for the owner:** one live
check — RAM number matches about:memory, one trim at startup, `state()` shows `trimDone` (kill switch = pref off).

**Plan:** new module `additional/boost/` (id `boost`), same file set as `additional/tabs/unloading/`, catalog entry
beside `tab-unload`. `memoryMB()` sums `memory` over the parent and all `children` of
`ChromeUtils.requestProcInfo()`, sampled only on demand (popup open: 2 s; limiter: per `OW-92`). Level 1 =
`minimizeMemoryUsage()` on the reporter manager, then `forceGC()`, `forceCC()` in `try/catch`, returning
`{beforeMB, afterMB, freedMB}` measured ~3 s later — nothing is closed, unloaded or reloaded. Post-startup trim runs
Level 1 once per browser start, after session restore and the Startup module, 90 s without user input and no audible
media, through one `setTimeout` chain plus `requestIdleCallback` — never polling. Pref
`zen.workspace.zentral.boost.startup_trim` (default `true`). Public API `window.ZentralBoost` with `runLevel1()`,
`memoryMB()`, `onChange(cb)`.

**Tests:** Level 1 calls the manager once and returns the measured numbers; the trim runs once, never while media
plays or input is recent; the kill-switch is respected; destroy cancels pending timers.

#### `OW-90` — The Boost widget replaces the Status widget — `DONE` (3.3.320)

**Shipped:** widget `boost` in `additional/widgets/ZentralWidgets.uc.js` beside the Clock and Date cards, and the
`status` card **removed** (registration, prefs `status.enabled`/`show_battery`/`show_memory`, its pure helpers, its CSS
and its settings section are all gone). The compact card shows the reading as `512 MB` / `1.4 GB` with a dash when the
build cannot measure; a click runs `runLevel1()` and toasts `Freed X MB` (4 s, `role="status"`, theme-aware, the
module's own `widgetToast` element), refusing a second run while one is in flight; the arrow opens a menu that expands
the card inline (no `z-index`, keeping the shell's normal-flow rule) with **Free memory (light)** working and **deep** /
**Restore** greyed with tooltips until OW-91. The card reads nothing from the platform itself — `additional/boost/` owns
the reading — and hears values through `onChange`, so it has no cadence of its own (`refreshMs: 0`). Pref
`zen.workspace.zentral.widgets.boost.enabled` (default `true`), section **Boost** (was **Status**), the tray's
`pause_when_hidden` applies as for every card, a missing module leaves a dash and an inert card, and a legacy
`status.enabled` owner is carried over to Boost once (`adoptLegacyStatusCard`, declared in `externalPrefs`).
Destroy unsubscribes from the module. The shared toast moved 5 s → 4 s (the plan's number for this card).
**Tests:** `tests/widgets-status.test.cjs` rewritten as the Boost card's rules (10), new
`tests/widgets-boost-card.test.cjs` (7, live: click → `runLevel1` once, toast, menu, greyed entries, Escape/outside
close, unsubscribe on destroy, missing module, no Status card), `tests/widgets-language.test.cjs` (Boost's words in
both languages), `tests/widgets-owner-reports.test.cjs` (OW-70/OW-71 follow the card that now exists).
**Owner gate:** the card is visible with a real number, a click frees memory and toasts it, and the old Status card is
gone (kill switch = the pref above).

**Plan:** register widget `boost` in `additional/widgets/ZentralWidgets.uc.js` and **remove the `status` widget**
(the owner's words: it replaces it) — the memory reading moves into Boost, the battery reading is dropped with the
card, since a desktop has none (`OW-70`). Compact tile "Boost" with the last RAM number (updates only while the
popup is open), left click runs Level 1 and toasts "Freed X MB", right click/arrow opens "Free memory (light)" plus
greyed entries for `OW-91`/`OW-92`. A self-contained toast (4 s, accessible, theme-aware, no cross-module
dependency). Pref `zen.workspace.zentral.widgets.boost.enabled` (default `true`); honours the tray's
`pause_when_hidden`; works with the tray absent (API + shortcut only, documented in the module README).

**Tests:** `registerWidget` called once and never for `status`; a click calls `runLevel1`; popup open/close
starts/stops the 2 s sampler; destruction stops it.

#### `OW-91` — Unload what is not in use, with Restore — `DONE` (3.3.322)

**Shipped:** the shared table is `loader/ZentralTabPolicy.js` (loaded by the runtime, embedded verbatim into the two
standalone builds through the new `sharedSources` manifest key). It answers `isUnloadable(tab, ctx)` with a **named
reason** for every never-rule — selected, addon host, Notes/Agenda placeholder, hidden panel host, audible, sharing,
picture-in-picture, video-preview source, already pending/discarded/dormant, pinned and Essential unless
`boost.keep_pinned` — plus `isSuccessorCandidate` and `byOldestFirst`. `TabUnload` now calls it (behaviour unchanged,
its own tests untouched). `runLevel2()` = Level 1's free-memory work plus eligible tabs oldest-first plus the panel
records whose own mode is `asleep-allowed`, through `explicitUnloadTabs` with the `discardBrowser` fallback, never
closing anything and never moving the selection. `undoState` (cap 50) + `restore()`: panels wake immediately, tabs
reload on click, the record dies with the session. Panel records carry `backgroundMode` (`live` default, `throttled`,
`asleep-allowed`) saved through `saveEssentialSettings` and restored with the record; the tile's own context menu
grows a **Background mode** submenu. The widget's deep and Restore entries are real now (Restore is greyed exactly
when nothing is asleep, deep exactly when the policy is missing). The shortcut (`boost.shortcut`, empty by default,
two keys minimum, read live) runs the light pass only. A standalone build declares `fullPackOnly: ["Zentral"]` for
the guarded panel layer (tabs only, no panels).
**Tests:** `tests/ow-91-boost-deep.test.cjs` (14): the policy table row by row, ordering, Level 2 against a fake
browser, pinned opt-in, panel modes + Restore, missing policy, undo cap, shortcut parsing and firing.
**Owner gate:** a deep run from the widget menu puts old tabs to sleep, Restore wakes the panels, the tile menu's
three modes stick across a restart, and nothing audible or selected is ever touched.

**Plan:** extract `isNormalTabAlreadyUnloaded` / `isSuccessorCandidate` / host-tab exclusion from
`additional/tabs/unloading/ZentralTabUnload.uc.js` into a shared `ZentralTabPolicy.isUnloadable(tab, ctx)` used by
both modules (TabUnload's behaviour unchanged). Never unload: the selected tab, a Zentral host tab, a playing tab
(`soundPlaying`), a sharing tab (`_sharingState`), a picture-in-picture tab, the video preview's source tab, an
already `pending` tab; pinned/essential only when `zen.workspace.zentral.boost.keep_pinned` (default `false`).
Essential-panel records get `backgroundMode` (`live` default | `throttled` | `asleep-allowed`) saved with the app
settings; Level 2 = Level 1 + eligible tabs oldest-`lastAccessed` first + sleeping only `asleep-allowed` records via
`explicitUnloadTabs`, waking through `loadEssentialInBackground(record, true)`. `undoState` (cap 50) feeds a
"Restore" entry and the toast after a deep run. Menu entries "Free memory (deep)" / "Restore"; shortcut pref
`zen.workspace.zentral.boost.shortcut` (default empty) following `extension/panels/interaction/ZentralAppShortcuts.js`.

**Tests:** the policy table for every never rule; Level 2 never touches selected/audible/PiP/video-source; the three
background modes; Restore wakes exactly what was slept; TabUnload tests unchanged.

#### `OW-92` — The RAM limiter — `DONE` (3.3.323)

**Shipped:** `decideLimiter()` is a pure function of the numbers (hysteresis: slow 60 s cadence, 10 s above 70 % of
the limit; cooldown; soft vs hard; no-reading; junk settings fall back to 4096 MB / soft / 60 s / 85 %). The live
chain is one one-shot timer re-armed per tick, started and stopped by its pref, gone on `destroy`; a hard run calls
the OW-91 deep pass in batches of three, re-samples after each, stops at `limit_mb × target_pct / 100` or when
nothing eligible is left, and is bounded to 12 rounds so a page that refuses to sleep cannot spin it. Still above the
limit with nothing eligible: at most one line per ten minutes. Prefs `limit_enabled` (false), `limit_mb` (4096),
`limit_mode` (soft), `limit_cooldown_s` (60), `limit_target_pct` (85) in a new **Limiter** section; the widget toasts
a soft notice, a finished hard run and the nag through `onLimiterEvent`. The README states plainly that a real
per-process memory cap is impossible from browser-window JS — the limiter works by putting tabs and panels to sleep.
**Tests:** `tests/ow-92-boost-limiter.test.cjs` (11: the state table, the live chain, soft vs hard, batching and the
bound, re-arm, destroy, every pref declared, the README's honesty) + the widget's limiter toast in
`tests/widgets-boost-card.test.cjs`.
**Owner gate:** switch the limiter on with a low limit and watch a soft notice, then a hard run in batches, then the
cooldown holding; nothing audible or selected is ever unloaded.

**Plan:** prefs `zen.workspace.zentral.boost.limit_enabled` (`false`), `limit_mb` (4096), `limit_mode` (`soft` |
`hard`), `limit_cooldown_s` (60), `limit_target_pct` (85). One-shot timers only: sample every 60 s, every 10 s above
70 % of the limit; above the limit `soft` toasts with "Free now", `hard` runs Level 2 in batches of three tabs,
re-samples, stops at `limit_mb * target_pct / 100` or when nothing is eligible, then one result toast; never inside
the cooldown; still above with nothing eligible = one toast per 10 minutes. The README says plainly that a real
per-process cap is impossible from JS.

**Tests:** the state machine — hysteresis, cooldown, no repeat, soft vs hard, nothing eligible.

#### `OW-93` — Background mode `throttled` for essential panels — `DONE` (3.3.323)

**Shipped:** the `throttled` mode finally has behaviour. In `syncAppPanelBrowserActivity`
(`extension/panels/browsers/ZentralBrowserIntegrations.uc.js`) a record whose `backgroundMode` is `throttled` is active
only while it is visible: hidden it gets `docShellIsActive = false` and `renderLayers = false`, so Gecko throttles its
timers and animations while the browser stays loaded (sockets, title/badge events still work). `live` records — and
every record written before this setting, and `asleep-allowed` records — keep exactly today's `visible || notifications`
rule. The preload path in `ZentralCornerPanels.uc.js` no longer forces such a record active, and the tile menu's mode
switch calls `syncAppPanelBrowserActivity()` so a change applies on the spot rather than at the next panel open.
**Tests:** `tests/ow-93-panel-throttle.test.cjs` (8): `syncAppPanelBrowserActivity` lifted from the shipped file and run
against fake browsers — live unchanged (including a hidden preload), throttled inactive/active by visibility, hidden
throttled preload throttled, `asleep-allowed` treated as live, records without a mode, the preload guard, immediate
apply, and save/restore of the value.
**OWNER GATE:** the owner sets arena.ai to `throttled` first; Messenger/WhatsApp stay `live` unless the owner tests and
agrees.

**Plan:** preloaded panel browsers are kept `docShellIsActive = true` in `syncAppPanelBrowserActivity`
(`extension/panels/browsers/ZentralBrowserIntegrations.uc.js`) and the corner-tile equivalent, which is why a hidden
arena.ai burns about 35 % of a core. For records with `backgroundMode === "throttled"`: while the panel is hidden,
`docShellIsActive = false` and `renderLayers = false`; restored when shown. The browser stays loaded, so sockets and
title/badge events keep working. `live` records keep exactly today's behaviour.

**Tests:** `live` unchanged; `throttled` inactive while hidden and active while shown; a runtime mode switch applies
immediately. **Owner gate:** the owner sets arena.ai to `throttled` first; Messenger and WhatsApp stay `live` until he
tests and agrees.

#### `OW-94` — Game Mode and the pause state — `DONE` (3.3.324)

**Shipped:** `loader/ZentralPerformanceSwitch.js` is the pause switch, published as `ZentralRuntime.performance`
(`isPaused`, `setPaused`, `toggle`, `subscribe`/`onChange`, `snapshot`), created before the runtime object that
publishes it and also provided by the standalone shim. Five repeating features subscribe and skip work while paused:
the video preview's discovery interval (`scanIntervalMs()` returns 0, which the file already read as "no interval"),
the widget scheduler (a second `held` flag, kept apart from the sidebar-fold setting so ending a game cannot un-pause a
folded sidebar), the RSS scan, Notes' minute wake (resumed with `check("wake")`, which fires what came due) and the
panel fallback poll. Game Mode (`zen.workspace.zentral.boost.game_mode`) is a toggle that runs Level 2, pauses every
subscriber, and sets `docShellIsActive = false` + `renderLayers = false` on every tab and panel browser except an
audible tab, the video preview's source tab and the selected tab. "Stronger saver"
(`zen.workspace.zentral.boost.stronger_saver`, OFF) runs the deep pass with every panel mode opened up, so `live`
records (WhatsApp, Messenger) are slept and land in `undoState` for Restore. Turning it off puts back what it changed,
reactivates the selected tab, and lets the rest reload lazily; destroying the window while on runs the same off-path.
**Also fixed here:** `window.Zentral.Panels` was **never published** by the runtime, so every panel step in Boost
(`runLevel2`'s panel half, `setBackgroundMode`, Restore's `loadEssentialInBackground`) had been silently doing
nothing — a getter on `window.Zentral` now returns the live `panelContext`. Also: the switch creation first landed
*after* the runtime literal that reads it, which is a temporal-dead-zone error at startup; the test that caught it is
the one asserting creation order.
**Tests:** `tests/ow-94-game-mode.test.cjs` (12) — the switch on its own, the runtime wiring, one row per subscribing
feature, the video pause path proving it touches no playback call, Notes' resume, the exemptions, Stronger saver's
single open-modes caller, restore-selected-only, and the two prefs; `tests/ow-94-game-mode-run.test.cjs` (7) — the
module booted against a fake `gBrowser`, proving an idle tab goes inactive while a podcast does not, off restores it,
the switch paused and resumed, the pref-at-start path, teardown, and the API.
**OWNER GATE:** play a video in the sidebar preview, switch Game Mode on, confirm the video keeps playing and the
podcast tab keeps playing; then switch it off and confirm the selected tab is active again.

**Plan:**

**Plan:** `ZentralRuntime.performance = { paused, setPaused(bool), onChange(cb) }`; paused features skip work and
re-arm on resume (video preview timers, widget refresh, RSS scan, Notes minute wake, panel fallback poll) through the
scope helpers. Level 3 "Game Mode" = Level 2 + pause + `docShellIsActive = false` / `renderLayers = false` on every
kept browser except audible tabs and the Big Picture video source. A separate "Stronger saver" toggle also sleeps
`live`/`throttled` records (WhatsApp, Messenger) and is **off** by default; when on it fills `undoState` so Restore
brings them back. Turning Game Mode off resumes and restores activity for the selected tab only; everything else
reloads lazily. Kill-switch pref `zen.workspace.zentral.boost.game_mode` is the toggle itself.

**Tests:** pause propagates to each subscribed feature; exempt tabs stay active; toggle off restores; Restore after
Stronger saver wakes records. **Owner gate:** a video played in the sidebar preview still plays with Game Mode on.

#### `T2.13a` — Holidays and the future Google Calendar sync/import

**Status:** `DONE` (3.3.310) · **Impact:** Med · **Effort:** S-M · **Depends on:** OW-44, T2.13 · **Source:** owner 2026-11-17

**Problem:** the owner's question — Google Calendar shows its own holiday calendars and today we do not know what would happen if a review of `T2.13` (ICS/Google groundwork) starts importing them.

**Plan (do this in order):**
1. Decide and write down (in the archived row, not in code first): **holiday sets stay local and are never imported**. A Google holiday calendar arrives as an ordinary read-only calendar of events; imported holiday events keep their own `uid`/`etag` and are never merged into a local set, because a local set is rule-computed and a set's year can be edited in `HOLIDAY_TABLE` (`OW-45`).
2. `toGoogle`/`fromGoogle` keep holiday entries out of the item store; no holiday data is written to a synced item's `extendedProperties` (`fromGoogle` already only reads `zentral_*` private fields).
3. When `T2.13` is implemented, imported all-day events whose source calendar is a known holiday feed are shown with a neutral "imported holiday" look instead of tinting the day as a work-free day, so a synced holiday week never silently changes work-free shading.
4. The settings dialog gets one line saying holidays are local and never synced.

**Tests / done when:** an imported holiday-like all-day event does not become a local holiday, `isWorkFree` is unchanged by it, and the local holiday sets still work with the import off.

**Done at 3.3.310** — the owner unblocked this row himself ("`T2.13a` is not blocked, go on work in loop"). All four
plan steps, in the order the plan asked for:

1. **Holiday sets stay local, and it is structural, not a promise.** `isWorkFree(day, prefs, lang)` takes prefs only —
   it has no parameter through which an item could arrive, so an imported event cannot reach the work-free answer even
   by accident. The test states this as the signature (`isWorkFree.length === 2`) so a future "just one more argument"
   fails loudly instead of quietly.
2. **A feed is recognised by the file, not by the event text.** `holidayFeedName` / `holidayFeedOf` read the file's
   `X-WR-CALNAME` (Google names its feeds "Holidays in Poland"; the URL form `…#holiday@group…` is matched too). The
   over-marking direction is deliberate: a calendar called "Holiday planning" is marked imported, which is quiet, while
   under-marking would be a silent day off.
3. **The look is imported, never work-free.** `markImportedHoliday` writes `x.icsHolidayFeed` + `x.icsHolidayName` on
   **all-day, non-reminder `.ics` items only**; `importedHolidayAttrs` turns that into the `is-imported-holiday` class
   and a `data-imported-holiday` naming the feed. The CSS paints it with a neutral `currentColor` edge and a dashed
   item border — it is asserted **not** to appear in the work-free or holiday tint rules, so a subscribed holiday week
   can never look like a day off this calendar decided on. Both the item button (Week/Day/Agenda) and the Month cell
   carry it.
4. **Two places say so in words.** The import card gains a line naming the feed and explaining that its days arrive as
   ordinary events; the holidays settings dialog gains `cal.holidays.importedNote` — "these holidays are local to Notes
   and are never synced". Both strings exist in en and pl, and the test fails if either key goes missing.

**No etag churn:** the two marks are kept by `cleanItem` only when present and only on `src: "ics"` items, so a file
that is not a holiday feed imports byte-identically to before, and a store that never saw one serialises and hashes
exactly as it did.

**Tests:** `tests/notes-calendar-imported-holidays.test.cjs` (14). The live one drives a real sheet (fake DOM, real
store, real module) through the actual `planIcsImport` → `store.items.upsert` → render path and asserts the mark lands
on `2026-11-01` and `2026-11-11` and on no other cell — verified by deliberately disabling the render call and watching
the test fail (1 negative check, not a claim). The harness the holiday tests share was extracted to
`tests/helpers/holiday-harness.cjs` so `notes-calendar-holidays.test.cjs` and this file cannot drift apart.

#### `T2.13` — ICS export/import and Google-sync groundwork (always last in Track 2)

**Status:** `DONE` (3.3.309) · **Impact:** Med · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** **DO NOT BEGIN UNTIL EVERY OTHER TRACK 2 ROW IS `DONE`.** Local `.ics` export/import with stable `uid` / `etag` / `updated`, `syncState`, and RRULE serialization.

**Progress:** the **import** half shipped ahead of this row as the owner's `OW-53` (3.3.280): `parseIcs` / `icsToItem` /
`planIcsImport` in the calendar module, with stable `x.icsUid`, `EXDATE` and the `RRULE` subset, and a card in Calendar →
Tools. **Finished at 3.3.309** — the three things that were LEFT, each verified rather than assumed:

1. **The writer.** `icsFromItems(items, {now, name, uidFor, prodId})` in the calendar module emits a full `VCALENDAR`
   (`VERSION`, `PRODID`, `CALSCALE`, `METHOD`, `X-WR-CALNAME`), one `VEVENT` per item with `UID`, `DTSTAMP`, `CREATED`,
   `DTSTART`/`DTEND`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `STATUS`, `RRULE`/`EXDATE` verbatim from the reader's own
   subset, and a `VALARM` for a reminder. Lines are CRLF and folded at **75 UTF-8 octets** — folding counts octets, not
   characters, so a 4-octet emoji is never cut in half (pinned). `DTSTART;TZID=` is written in the item's own zone and
   the wall clock is derived through `Intl`, so the instant round-trips: 09:00Z in `Europe/Warsaw` goes out as
   `20261118T100000` and comes back as 09:00Z. All-day uses `DTEND;VALUE=DATE` one day **after** the last day, which is
   what the reader expects. A timed event with no end gets the default duration. **Identity is the point:** an item's
   own `x.icsUid` is reused, and an item that never came from a file gets `<id>@zentral-notes` — never the clock, so the
   same item exported twice has the same UID and a re-import updates instead of duplicating. A cancelled import
   (`x.icsCancelled`) is filtered out **in the writer**, not in the card, so no caller can resurrect a cancelled event.
2. **`syncState` per item.** `x.syncedEtag` (the etag the other side holds) plus `x.syncedDeleted` give
   `syncStateOf(item)` → `new` / `changed` / `clean` / `deleted`; `markSynced(item, remoteEtag)` and
   `markSyncedDeleted(item)` write that bookkeeping; `syncPlan(items)` groups a whole calendar and counts what a pass has
   to push. Both fields are kept by `cleanItem` **only when present**, by the same rule as item colour, so an item that
   never synced serialises and hashes exactly as before — no etag churn (pinned). Nothing in this layer touches a
   network: it is what a sync reads, not the sync.
3. **The round-trip fixture.** `tests/notes-ics-export.test.cjs` (12 assertions) takes the **OW-53 import fixture** —
   Google-shaped, folded, escaped, with a `TZID` event, an all-day event, a weekly `RRULE` + `EXDATE`, a `VALARM` and a
   cancelled event — imports it, exports it, imports that back, and asserts the two calendars agree on every field that
   carries meaning (start instant, end, summary, description, location, recurrence, reminder, calendar name). It also
   asserts the strong form of "a second import updates": feeding the exported file back against the items it came from
   yields **3 updates, 0 adds**. `tests/notes-ics-export-card.test.cjs` drives the card itself with the real sheet code
   and the real calendar module (fake DOM, not a re-implementation): the row opens from Calendar → Tools, the card names
   `Everything (3)` with a cancelled import left out of the count, opening it writes nothing, and pressing Export saves
   one file through the host whose text imports back to those same three events. Well-formedness is checked over the whole file: no bare `LF`, no line over 76 octets,
   `BEGIN:VEVENT`/`END:VEVENT` balanced.

**The card and the seam:** Calendar → Tools → *Export calendar (.ics)…* opens the `zn-dialog-card` pattern with an
"Everything (n) / This year (n)" chip pair, and only the Export button writes; the file goes through `env.saveIcs`, the
same save picker as every other export, so a host (and a test) answers without a dialog. `cal.ics.export*` strings exist
in **en and pl**, and the test fails if either key is missing — no raw key can reach a person.

**Honest limits:** there is no network sync and no OAuth — the "Google-sync groundwork" is exactly the shape and the
bookkeeping (`toGoogle`/`fromGoogle` already existed; `syncState` is new). `TZID` is resolved through `Intl`, so a zone
whose rules differ between the platform's tzdata and Google's may disagree on a historical instant. `VALARM` is written
for the first reminder only. `T2.13a` (holiday feeds, `OW-44`) follows this row and is DONE at 3.3.310.

**Full specification (original row):** **OPEN — DO NOT BEGIN UNTIL EVERY OTHER T2 TASK IS COMPLETE.** Depends on all Track 2 item model, recurrence, reminder and calendar UI work. Export/import `.ics` locally (no network); stable `uid` / `etag` / `updated`, `syncState` per item, RRULE serialization and fixture coverage.

#### `T3.3` — Drag-and-drop note tabs within Zen sidebar

**Status:** `PARTIAL` · **Impact:** Med · **Effort:** M · **Source:** carried over from the previous roadmap

**Current state and what is LEFT:** DONE (3.3.251): a note has its own place in its folder (`order` in the note's front
matter, `cleanNoteOrder` / `noteOrderBetween` / `compareNotes`, `store.setNoteOrder`), the tree draws hand-placed notes
first in that order and the rest by last change, `noteDropTarget` and `noteTabDropPlan` turn a drop onto a folder row,
a note row or the root into exactly one store change, and the existing Zen drag guard still keeps a managed tab from
being taken out of the tree. Verified in `tests/notes-note-tab-order.test.cjs` (198/198 suite).

LEFT (only this): the gesture. Zen starts the tab drag itself, so the sidebar hook must read the drop position from
the live tab elements (`dragstart` / `dragover` / `drop` on `zen-folder` and `tab`), map the DOM row to a tree key and
call `store.setNoteOrder` / `store.setFolder` through `noteTabDropPlan`. Not written here because the exact DOM Zen
uses while a tab is being dragged cannot be reproduced in the fake sidebar; it needs the real window.

#### `T4.3a`..`T4.3c` — Modularize `ZentralNotes.uc.js` (split of T4.3)

**Status:** `OPEN` · **Impact:** Med · **Effort:** M each · **Source:** previous roadmap

`a`: calendar UI out of the monolith (module `api`, test seam unchanged). `b`: parser/wiki graph and import/export. `c`: Zen sidebar UI and one build entry. After each step all tests and the standalone build must pass unchanged.

#### `ST7.3` — Move calendar UI state out of notes metadata

**Status:** `DONE` (3.3.295) · **Impact:** Low-Med · **Effort:** S · **Depends on:** none · **Source:** Audit R2 P5

**Problem:** `setMeta` rewrites the whole meta file (folders, up to 5000 note agenda overrides) 600 ms after every view/cursor/size/filter change (one write 600 ms after the last change: a drag of the Size slider is one write).

**Plan (do in this order):**

1. Store `calendarView`, `calendarCursor`, scale/range, filters in a small separate file or prefs; migrate once.

**Tests / done when:** Migration test; no meta write on Prev/Next.

#### `OW-63` — Stopwatch face: click returns to the clock, and a narrow widget keeps its buttons

**Status:** `DONE` (3.3.297) · **Impact:** High · **Effort:** M · **Depends on:** OW-60 · **Source:** Owner report (2026-11-17)

**Problem (owner's words):** "clicking on stopwatch doesnt revert it to clock and text field elements of it do not adjust for buttons to be visible in lower width scenarios". OW-60 made the two faces replace each other and put the timer controls on the timer face, but the timer face only leaves by an explicit control, and its number inputs have fixed widths that overflow before the buttons wrap.

**Plan (in this order):**

1. A click on the timer face that is not on a button or a field goes back to the clock face (the same "click the face" gesture OW-60 gave the clock, in the other direction).
2. The timer face becomes a grid that wraps: the fields take what is left and the buttons move to a second row instead of being pushed out. No fixed pixel widths on the fields; `min-width: 0` so they can shrink.
3. Check the narrowest sidebar width and the text-size setting.

**Tests / done when:** A fake-DOM test clicks the timer face and asserts the clock is shown; a layout test asserts no control exceeds the card at 200 px; settings for text size do not overflow it.

#### `OW-64` — One language selector for every widget, following Notes until overridden

**Status:** `DONE` (3.3.299) · **Impact:** Med · **Effort:** M · **Depends on:** — · **Source:** Owner request (2026-11-17)

**Problem (owner's words):** "build language selector for all widgets, it should sync with notes language untill user decides that it should not". Only Notes has a language today (`notesLang`), and each other widget is English/Polish by its own rule.

**Plan (in this order):**

1. One pref, `widget_language` (`auto` = follow Notes, else `en`/`pl`), through the whole chain (schema, settings meta, layout, standalone) so it appears in the dialog.
2. Every widget's `t()` resolves through it: `auto` asks Notes, an explicit value wins and is remembered as the person's choice.
3. The selector shows "follow Notes" as its own state, and changing the Notes language changes every widget that is still on `auto`.

**Tests / done when:** `auto` follows a Notes language change; an explicit choice survives a Notes change; the pref is in the dialog.

#### `OW-62` — An imported .ics reminder that cannot be deleted: recreate its note

**Status:** `DONE` (3.3.298) · **Impact:** High · **Effort:** S-M · **Depends on:** OW-58 · **Source:** Owner report (2026-11-17)

**Problem (owner's words):** "i still can not delete reminder that was created by ics import, make safeguard for it that will at least try to create such note if it needs one and its not avalible". OW-58 made an item without a note deletable in principle; an imported item still refuses when its linked note is missing rather than making the note it says the person should edit.

**Plan (in this order):**

1. Find the refusal path (the item menu says "delete it in its linked note" when `noteId` is set but the note is not in the store).
2. When a note is needed and absent, create it (the same way the item's link would have) and then carry out the action — delete, unlink or edit — instead of stopping.
3. If the note cannot be created, the fallback is the OW-58 path: delete the item itself, saying so.

**Tests / done when:** An imported item whose note is missing can be deleted, and the note is created on the way; the menu never says "edit it in its note" about a note that does not exist.

#### `ST7.4` — Render Agenda rows without real tabs (research)

**Status:** `OPEN` · **Impact:** Low-Med (long term) · **Effort:** L · **Depends on:** ST7.1 · **Source:** Audit R1 D6

**Problem:** Every item is a real pinned `about:blank` tab, which is the root of the session/sync/tab-cycling edge cases.

**Plan (do in this order):**

1. Investigate whether Zen's folder DOM can host non-tab rows with the same hover/drag behaviour; prototype behind a flag; abandon if Zen internals fight it.

**Tests / done when:** Prototype report.

#### `OW-77` — Measure every calendar and notes menu, in a real browser, and keep the numbers

**Status:** `DONE` (3.3.314) · **Impact:** Med · **Effort:** M · **Depends on:** OW-75 · **Source:** Owner decision (2026-11-18), "go for it, going to be useful in the future, you can get all zentral elements there"

**Problem:** OW-75 was decided by measuring the menus by hand in the headless-Chromium harness of
`tools/audit-notes-calendar-fit.cjs` (the Tools menu was 18 rows, 568 px at 13 px text and 619 px with a scrollbar at
20 px). Those numbers are in this file's history, not in a check anyone can run tomorrow. The owner's complaint was
"unreadable", which is measurable: rows too tall or too short for the text size, labels clipped, a menu taller than the
window it opens into, a menu that covers its own trigger, or a submenu that loses the level you came from. None of that
is in the suite, because a fake DOM has no layout.

**Plan (in this order):**

1. Add `tools/audit-notes-menus.cjs`, modelled on the calendar-fit audit (same page, same real sheet, nothing mocked
   but the disk): open every Notes and calendar menu — View, Size, Snap, Days, Kind, Category, Tools and all of its
   groups, `+` and its calendar group, the item context menu, the note menu, the outline and find menus — at 2 text
   sizes, 2 sheet sizes and 2 scrollbar kinds.
2. Report, per menu: row height against the text size, label/row clipping, menu height against the window, whether a
   submenu keeps a Back row and keeps the trigger reachable, and focus order. Fail on a real defect; print the numbers.
3. Record the baseline in `docs/` so a regression is a diff, not a memory.
4. Keep it out of the suite (it needs a browser) but list it next to the other audits in the README/housekeeping notes,
   with the `NODE_PATH` recipe the other audits use.

**Tests / done when:** The tool runs at 0 findings on the current build, every calendar menu appears in its output with a
row height and a verdict, and the recipe is documented so the next session can re-run it.

**Done at 3.3.314.** `tools/audit-notes-menus.cjs` opens the real sheet in a headless Chromium (nothing mocked but the
disk) and opens **11 menus**: calendar View, Size, Snap, Days, Kind filter, Category filter, Tools, the month cell and the
calendar item context menus; the notes `+` menu and a note row. It also opens every group row inside each of them and
comes back through its Back row. Grid: 3 text sizes (13/20/28 px) × 2 sheet widths (1100/620) × 2 sheet heights
(560/720) × both scrollbar kinds = **264 measurements, 0 findings**, 16 cells "not applicable" (a 620 px sheet draws
Month as the date-only picker, so there are no cells or marks to right-click — counted apart, never as a defect).

**What it measures, per menu:** a row shorter than its own label (`row-tight`), a row over 2.6× the text size for one
line (`row-tall`), a label wider than its box with no ellipsis (`label-clipped`), a menu taller than the window and not
scrollable (`menu-too-tall`), a menu whose box leaves the window (`menu-off-window`), a group level with no Back row
(`group-no-back`), a group that loses its parent level (`group-loses`), an empty menu, and a page error.

**The numbers are kept.** `docs/MENU_BASELINE.md` is generated with `--baseline` (one row per measurement: rows, menu
height, verdict) and `--compare docs/MENU_BASELINE.md` fails when any menu height moves by more than `--tolerance` px.
At 13 px text the calendar Tools menu is 196 px (6 rows, 29.5 px each) and the `+` menu 196 px (6 rows); the largest is
the month cell menu at 10 rows, growing from 343.5 px at 13 px text to 591 px at 28 px.

**The tool was proved to catch defects, not just to pass.** Giving every menu row a 6 px height produced **67**
`row-tight` findings across all 11 menus; raising the rows' padding from 5 px to 18 px moved **226 of 264** baseline rows
and made `--compare` exit 1 with named menus (Tools 331 → 448 px, `+` 331 → 487 px). Both were reverted; the 0-finding
run above is on the real stylesheet.

**A real bug the tool found in itself, and one in the report:** the first version removed the open menu node by hand
between measurements, which left the sheet's own menu variable pointing at a detached element, so the next `fill` threw
"the node to be removed is no longer a child of this node" — it now closes menus the way a person does, with a
pointerdown outside. And skipped cells were still averaged into their menu's height range with an uninitialised value,
which made a 300 px menu look like it ran to 720 px; they are now excluded.

**Not in the suite**, deliberately: it needs a browser. The recipe is in the tool's header and in
`additional/notes/README.md` beside the other audits (`mkdir /tmp/ch && npm i @sparticuz/chromium puppeteer-core`, then
`AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x NODE_PATH=/tmp/ch/node_modules node tools/audit-notes-menus.cjs`).

**Honest limits:** measured in Blink; Zen draws with Gecko, which differs by a line's height and a glyph's width — the
verdicts are written for that ("tight" only when a label is actually cut, not when it is near the edge). Quick settings
opens a card, not a menu (`openCard` + `fitCard`), so it is measured by the settings-layout audit, not here.

#### `OW-78` — One palette: the CSS variables and the JS resolver must agree

**Status:** `DONE` (3.3.311) · **Impact:** Med · **Effort:** S · **Depends on:** OW-76 · **Source:** Owner decision (2026-11-18), "okey, plan it as to do after those few adjustments"

**Problem:** After OW-76 the sheet has two ways to arrive at a surface. The JS resolver (`resolveThemeSurface`) reads
`--zen-colors-base` / `--zen-colors-text` / `--zen-colors-border` / `--zen-primary-color`, applies contrast guarantees
and writes `--zn-surface-resolved` / `--zn-text-resolved` / `--zn-accent-safe`. The stylesheet separately defines
`--zn-surface: var(--bgalazka-look-toolbar-surface, var(--bgalazka-look-surface, #1e1e24))` and
`--zn-text: var(--bgalazka-look-text, #e9e9f0)`. So a rule that reads `--zn-surface` can still show the RSS card's
colour while a rule that reads `--zn-surface-resolved` shows Zen's — the same sheet in two palettes, which is exactly
the "how do the themes interact" complaint. It works today only because the resolved tokens are set inline and win.

**Plan (in this order):**

1. Make the stylesheet's own defaults read the resolved tokens first (`var(--zn-surface-resolved, ...zen tokens...)`)
   and keep the RSS variables as the last fallback only.
2. Delete any remaining hardcoded `#1e1e24` / `#e9e9f0` defaults that a theme should be able to move, or move them into
   the resolver's documented fallback so there is one source.
3. Add a check that the two paths cannot disagree again: a test that sets host tokens and asserts both the computed
   `--zn-surface` and the JS `surface` are the same colour.
4. Document the chain in one place (the CSS header comment) so the next person does not re-add an RSS token first.

**Tests / done when:** With `--zen-colors-base` set, the computed `--zn-surface`, `--zn-panel` and `--zn-surface-resolved`
are all that colour; with the tokens removed the documented fallback appears in all three; a test fails if the stylesheet
starts reading a non-resolved source first.

**Done at 3.3.311** — and the row earned its keep by finding a real bug, not just a reordering.

**The chain, now read from one end in every rule that sets it:** `--zn-surface: var(--zn-surface-resolved, var(--zen-colors-base, var(--bgalazka-look-…, #1e1e24)))`
and the same shape for `--zn-text`. All four theme rules (`recommended`, `light`, `dark`, `paper`) gained the resolved
token as their first rung; the fixed themes' own hexes stay as the second rung, so a sheet whose JS never ran still
paints exactly as before. The RSS card's `--bgalazka-look-*` set is now the **last** rung and is documented as such —
in the CSS header comment beside the tokens, which names this row and points at `resolveThemeSurface`.

**The bug it found:** `resolveThemeSurface` ended its text chain with `isLight ? "#1c1c22" : "#e9e9f0"` — a hardcoded
pair that only matched two of the four themes. `paper`'s stylesheet text is `#3b3226` and `light`'s is `#1d1d22`, so the
moment the resolved token started winning (step 1 of this plan), **the paper theme's text would have jumped from warm
brown to near-black and the light theme's by one step**, silently. The resolver now reads `base.text` — the theme's own
entry, already resolved for the scheme. Every theme now agrees with its stylesheet hex: light `#fbfbfd`/`#1d1d22`,
dark `#17171c`/`#e9e9f0`, paper `#f4ecd8`/`#3b3226`, zentral `#1e1e24`/`#e9e9f0`, recommended `#1f1f24`/`#eeeeee`.

**The one deliberate exception, written down:** an explicit override the person chose (`--zentral-notes-ov-bg` /
`-ov-text`) still opens its chain directly. A colour the owner picked is the last word and must not be mediated by the
resolver; the test allows exactly those two names and asserts there is no third.

**Tests:** `tests/notes-one-palette.test.cjs` (10). Static: the order of every `--zn-surface`/`--zn-text` chain in the
whole file, and that no rule opens with a foreign palette. Agreement: the resolver's per-theme fallback equals the
stylesheet's hex for every theme. Live: a real sheet, read back from its inline custom properties, with the theme it
says it is on resolved by the same function. Verified by negative check — restoring the hardcoded pair fails 1 of 10.

#### `OW-79` — More languages, and never a raw key on screen

**Status:** `DONE` (3.3.313) · **Impact:** Low-Med · **Effort:** M · **Depends on:** — · **Source:** Owner decision (2026-11-18), "you can prepare us for more languages"

**Problem:** Adding a language is meant to be a data file (`additional/notes/i18n/en.js`, `pl.js`), but a real browser
run of the harness showed the sheet drawing literal keys — `cal.todayBtn` appeared as the Today button's text — when no
language table was registered for the active language. In production that means any build or host that misses a table,
or a new language file that is not complete yet, shows a person `cal.todayBtn` instead of "Go to today". The i18n test
suite passes because it always registers both tables.

**Plan (in this order):**

1. Make `t()` fall back per key, not per table: a missing key in the chosen language falls through to English, and a key
   missing everywhere shows the English default (never the raw dotted key). Log the gap once so a developer sees it.
2. A test that builds the sheet with only one language registered, and with a deliberately incomplete table, asserting
   no rendered text matches `/^[a-z]+(\.[a-zA-Z]+)+$/` (a dotted key) anywhere in the sheet.
3. A test that a fully-formed language file discovered in `i18n/` is picked up by the language menu without touching JS.
4. Document "how to add a language" in `docs/`: the file shape, the plural categories, the date words, and how to check
   it with the audit tool.

**Tests / done when:** An incomplete language shows English for the missing keys and never a key name; a new file needs
only to exist to appear in the menu; the suite covers both.

**Done at 3.3.313** — and the third item on the list turned out to be the real work; the first two were half-done already.

1. **Per-key fallback was already there; the raw key was the hole.** `translate` fell through to English per key, but its
   last resort was `k` — the dotted key itself, which is exactly what a person saw. It now: falls through per key to
   English (an **empty string** in a table counts as missing too, so a blank line in a translation file cannot blank a
   label), and when no table has the key at all it draws **readable words** from the key's last segment
   (`cal.todayBtn` → `Today btn`), never the dotted form. The gap is reported **once per key and language** through
   `reportTranslationGap` — a `console.warn`, a `translationGaps()` list and an `onTranslationGap` subscription — because
   the sheet draws constantly and a warning per draw would be noise nobody reads.
   **Found and fixed while doing this:** two places in the sheet asked "is there a translation?" by comparing
   `t(key) === key`. Once `t()` stopped returning keys, that test became always-true and every settings option would have
   shown the readable form of its own key. Both now ask `hasTranslation(key)`, which is the question they meant.
2. **A new language is now genuinely a data file.** Before, it took three edits in two JS files: one `loadOptional` line
   per language, `NOTES_LANGUAGES = ["en","pl"]` in the core, and a hardcoded `[["en","English"],["pl","Polski"]]` in the
   settings menu — and the menu was the one nobody remembered. `tools/build-languages.cjs` now generates
   `i18n/registry.js` from the **directory**; the sheet loads the registry then each language it names; the menu is
   built by `notesLanguageChoices()` from `notesLanguages()`, i.e. from what actually registered. The core's
   `NOTES_LANGUAGES` survives as a floor, not a gate. `build-languages.cjs --check` runs in the suite (beside the z-map
   check), so a forgotten step fails in CI rather than in a user's browser.
   **Proven, not asserted:** `i18n/de.js` was added — a real German table (weekdays, months, relative words, counted
   offsets, ordinals) with only a handful of interface strings translated. It appeared in the registry, in the menu
   (`Deutsch (German) — 879 missing`), and its date words parse (`heute`, `übermorgen`, `25. dezember`, `in 3 tagen`,
   `vor 2 wochen`). The menu is honest about an incomplete language instead of pretending.
   **A shape change fell out of it:** three options make `choiceIsDropdown` true, so the language row is now a dropdown
   rather than a chip pair. `notes-i18n-ui` accepts either shape.
3. **The docs.** `docs/ADDING_A_LANGUAGE.md` — the file shape, the tables a language needs beyond `strings` (with the
   German example for each), the plural categories, the registry tool, how to check it, and what to do about keys no
   table has. `i18n/en.js`'s own header points at it, because that is the file a translator actually opens.

**Tests:** `tests/notes-more-languages.test.cjs` (11): per-key fallback, readable words for an unknown key, a blank
counting as missing, the gap listener, registry currency, "nothing in the JS names `de`", the menu's honesty, German
date parsing, and two live-sheet runs — one with the incomplete table registered, one with **no** table at all —
asserting no rendered text matches `/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/`. Verified by negative check: restoring
`template = k` fails 2 of 11.

---

## Owner requests added 2026-11-18 (Extended 3.4.0)


#### `OW-105` — Respect explicit widget colour settings

**Problem:** The widgets ignore colour values when a specific colour is forced through Settings. A saved explicit choice must take precedence over theme-derived fallback values.

**Plan (in this order):**

1. Trace the setting-to-render path for all widget cards and distinguish an unset value from an explicit valid colour.
2. Fix the smallest shared resolver/paint path so explicit values are applied consistently without changing automatic theme behaviour or unrelated app colours.
3. Add regression tests for explicit colours, unset colours, invalid values and live setting changes; cover all widget types that share the path.

**Tests / done when:** Explicit settings are visible on every supported widget after opening, repainting and changing theme; automatic colours still work when no override is set.

#### `OW-106` — Open Notes and Calendar on All notes

**Problem:** Opening Notes/Calendar resumes the last opened note, but the requested default landing place is the All notes screen.

**Plan (in this order):**

1. Trace startup/open routing and the persisted last-note state. Keep explicit navigation to a note working.
2. Make a fresh feature open and the default Notes/Calendar entry route land on All notes rather than replaying the last note.
3. Add tests covering a previously opened note, repeated open/close, a direct note link/reminder open, and switching between Notes and Calendar.

**Tests / done when:** The default open shows All notes every time; intentional navigation to a particular note still opens that note and does not get redirected.

#### `OW-107` — Weather location privacy and security audit

**Problem:** The owner needs a precise account of what weather location data is shared, with which service, on what trigger, and whether it is retained or reused.

**Plan (in this order):**

1. Trace place entry, geocoding, request construction, refresh, cache, diagnostics and error logging; identify every field sent and every network destination.
2. Verify that coordinates are resolved only from the user's explicit place choice, not silently read from browser/device geolocation; check request headers, credentials, referrer, redirects and third-party exposure.
3. Fix any unnecessary data exposure or unsafe handling. Keep the feature functional and explain any unavoidable provider-visible data in the README/settings copy.
4. Add tests that pin the request host, payload, headers, geocoding and refresh behaviour, including that no device location permission/API is invoked unexpectedly.

**Tests / done when:** A code-backed security report states exactly what data is sent, to whom and when; tests prevent silent geolocation or unintended extra disclosure.

---

## Track 2 design rules (owner decisions, still binding)

_Re-planned 2026-11-11 from the owner's wishes. The All notes view becomes an adjustable split: folder tree and calendar side-by-side in a wide window, stacked in a tall/narrow window. Dependency flow: calendar core and persistent item store (`T2.1`, `T2.3a`)_ $\rightarrow$ _date parser and shared date controls (`T2.12a–c`, `T2.2a`)_ $\rightarrow$ _date chips and Notes by date (`T2.2b–c`)_ $\rightarrow$ _item editors and safety prompts (`T2.3b–h`), duplicate-line identity follow-up (`T2.3a1`)_ $\rightarrow$ _calendar layout and views (`T2.4a–b`)_ $\rightarrow$ _calendar correctness audit (`T2.4b-audit`)_ $\rightarrow$ _week/day views (`T2.4c`)_ $\rightarrow$ _drag/resize/create (`T2.5`)_ $\rightarrow$ _Big Picture (`T2.6`)_ $\rightarrow$ _alerts (`T2.7a–c`)_ $\rightarrow$ _Agenda/Daily unification (`T2.8–9`)_ $\rightarrow$ _holidays and folder exclusion (`T2.10–11`)_ $\rightarrow$ _ICS groundwork (`T2.13`, always last)._

**Rules for the whole track (owner, 2026-11-11):**

- No Google sync now, but every stored item uses Google Calendar's field names and meanings (`id`, `summary`, `description`, `start` / `end` as `date` or `dateTime`, `status`, `updated`, `etag`, `recurrence`, `reminders.overrides`), plus our own `x` fields (`noteId`, `heading`, `category`, `kind`), so a later sync only has to map ids. Times are stored as UTC milliseconds plus an `allDay` flag; all-day items use an exclusive end date as Google does.
- An item has a **kind**: `event` (start and end; many may overlap and every one must stay visible and readable, details on hover) or `reminder` (a start and NO end; shown as a marker on its day and in the days-forward list, readable on hover).
- One note may hold **any number of items and any number of independent reminders**. Multiple reminders on the same note are a core requirement, not a one-reminder-per-note limitation: each reminder has its own date/time and, when implemented in `T2.7`, its own recurrence, alert settings, snooze, Done and Dismissed state. The calendar and Agenda folder show every item/reminder separately. The legacy single `remind` field is surfaced as one additional read-only compatibility reminder during the transition; it must never cap the number of new reminders.
- **Accepted by the owner (2026-11-11): reminder history.** Done and Dismissed are different outcomes. Provide one central, chronological **Reminder history** list exposed as a single virtual history note/list (not one generated note per reminder); every state change appends an entry containing reminder identity, linked source note, action and an exact timestamp. Clicking **Done** adds a visible entry such as _Marked done at 14:32_; **Dismiss** is recorded separately and must not imply completion. Clicking a history entry opens its source note at the relevant heading/item. Reopening, rescheduling and snoozing append further entries rather than overwriting old history. Recurring reminders record state/history per occurrence so completing one occurrence does not complete the series. Keep this state separate from Google event `status` (`confirmed`/`tentative`/`cancelled`).
- **Accepted by the owner (2026-11-11): configurable sound and quiet hours.** Quiet hours are **OFF by default** and must not change existing alert behavior until the user enables them. When enabled, the user can define a time window and days, including windows that cross midnight. Sound intensity is configurable for each alert stage, with defaults and overrides at global, category, note and individual-reminder level (precedence: reminder > note > category > global). Support at least _silent_, _quiet_, _normal_ and _loud_ sound levels. During quiet hours, the allowed sound levels/stages can also be configured globally or overridden for a particular note/reminder/category; examples: one note allows only _loud_, another allows _quiet_ and _normal_. Visual alerts and due times remain accurate; blocked sounds are suppressed rather than shifting reminder times or playing a catch-up burst when quiet hours end.
- Every item may have its own **calendar note** (free text). Calendar notes are never listed in the sidebar folder tree and never in the Zen NOTES folder.
- The calendar can be tiny in a narrow panel: it must stay usable at small sizes (list fallback), with a setting for "how many days forward" and a month view.
- Calendar interactions must be complete from both the calendar and Agenda: left-clicking a day in Month SELECTS the day and shows its list (changed 2026-11-14, `OW-06`); Day view opens from the date badge, double-click, context menu or keyboard; right-clicking a day or item opens a context menu with actions relevant to that target. Clicking a reminder/event in Calendar or Agenda opens its linked source note at the saved heading; Agenda items also have the same contextual actions.
- A linked reminder inherits the source note color and updates when that note color changes; use category color only as the fallback for unlinked/manual items. An explicit per-item color override may be offered, but must be intentional and visible in the editor.
- Calendar creation must support timed events, all-day events, timed reminders and all-day reminders. Do not model a full-day reminder as a timed reminder at midnight. The default reminder composer opens with its date/calendar preview, shared Clock controls and the full settings form (title, kind/all-day, color, category, linked note, description/calendar note, timezone, recurrence, and per-reminder alert settings); creation must not require writing a marker line manually.
- Calendar UI must offer denser sizing than the current default: a fit-to-pane default with a size slider (`OW-03`, built in 3.3.176; it replaced the old Comfortable / Compact / Extra compact steps, which remain as the three looks and as the spacing of the two lists), with responsive reductions to cell padding, row heights, labels and markers while keeping keyboard/context actions accessible; very narrow panes still use the existing list fallback.
- Calendar-only notes (e.g. a Birthday note) must be creatable or markable so they never appear as ordinary tabs in the Zen NOTES folder, while remaining available in All notes, search, links and Calendar. This is a per-note option in addition to inherited per-folder exclusion.
- Agenda tab visibility is per item/reminder: an entry appears in the Zen tabbar Agenda only inside its configured display window, then disappears outside it; support every reminder, not only events. The Agenda container itself hides when no entries are currently eligible. Display-window timing is separate from alert/snooze timing and has global/category/note defaults with per-item overrides.
- Mimic the hover card of `additional/rss` for item details (both inside the Notes sheet and on Zen sidebar Notes/Agenda tabs, see `T3.4a`); mimic the Big Picture mode of `additional/video` for the popup. Read both before building.
- Destructive actions must respect linked reminders: a note with one or more reminders must not be silently trashed or permanently deleted. The reminder-aware confirmation task below applies to every entry point, including Zen sidebar tabs and bulk Trash actions.

Accepted by the owner (2026-11-11), now part of the plan: working-hours shading (`workRange`, `cleanWork` core; UI in `T2.4c`), recurring items (`expandItem` / `expandRange`, DAILY/WEEKLY+BYDAY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL; editor in `T2.3d`), all-day strip (`allDayOf` core; UI in `T2.4b`), free-slot finder (`freeSlots` core; UI in `T2.4c`), per-item time zone (`x.tz`, `clockIn`; editor in `T2.3c`), print/export of a week (`weekText` core; menu/print in `T2.4c`), custom category colours (`T3.6` / `T2.3b`).
**Approved owner requirements (2026-11-11):** reminder lifecycle/history (`T2.7a`) and configurable sound profiles/quiet hours (`T2.7c`) are committed scope, not optional ideas.

---

## Parking lot — PARKED ideas (not approved; do NOT implement)

_From the owner's second roadmap (2026-11-12). Only the owner can promote a row; promoting means moving it into a Track with an `OPEN` plan. Notes for the future implementer are kept so nothing is researched twice._

| Ref  | Proposal                                                                                                  | Utility | Effort | Notes (checked against this code base)                                                                                                                                                                                               |
| :--- | :-------------------------------------------------------------------------------------------------------- | :------ | :----- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1` | Natural-language task creation (`- [ ] Call Sarah tomorrow at 4pm` becomes a reminder for tomorrow 16:00) | High    | High   | `parseDateText` / `parseLine` already understand relative words and times in calendar lists; the missing part is doing it outside a `%%calendar%%` section. Must stay offline and must not become a text expander (see Never build). |
| `P2` | Sub-task nesting in Agenda items                                                                          | Med     | High   | Needs parent/child fields in the item model and in the `zn-item-id` line identity; conflicts with the Google-shaped item rule unless kept in `x`.                                                                                    |
| `P3` | Auto-rollover of overdue tasks into Today                                                                 | High    | Med    | Needs `T2.7a` states first. Must never move a Done/Dismissed item; must never silently change the stored start time (show it, do not rewrite it).                                                                                    |
| `P4` | Drag-and-drop reordering of Agenda items in the Zen sidebar / dragging between day nodes to reschedule    | High    | High   | Overlaps `T3.3` (tab drag) and `T2.5e` (occurrence semantics). Do after both.                                                                                                                                                        |
| `P5` | Voice memos in date notes with transcription                                                              | Med     | High   | Needs microphone permission handling in the chrome window and an offline transcriber; no network calls allowed. Probably never.                                                                                                      |

---

## Housekeeping notes (not counted)

- S6 W5 is closed. Owner decision 2026-11-06: the seamless hand-over of the Notes card with a Zentral panel is NOT wanted; sharing more old panel keys stays optional polish.
- B1 (middle-click unload) is fixed in code since 3.1.19; W3 (table cell checkboxes) and W9 (`default_view`) are done. If B1 ever returns, log which tab is selected after the click (suspect Zen's `explicitUnloadTabs`).
- A table cell only knows `[ ]` / `[x]`; `<br>` in a cell is a line break everywhere (was literal text).
- With the sidebar order mirrored, every autosave of a note moves its tab to the top of its folder (sorted by last change like the tree); add a pref for a stable order if that annoys.
- The sheet's public `newNote(folderId)` fix is covered only by controller tests, not by a sheet test.
- Extended task states (`[-]` `[/]` `[?]` `[!]`) are plain text in other Markdown apps (by design).

## How to add a feature (short)

1. Add the pref: schema in `additional/notes/settings.json` (+ `layout` entry), list in `additional/notes/standalone.json`, constant in `PREF` and a row in the in-app settings list of `ZentralNotes.uc.js`; run `node tools/organize-layout-order.cjs`, `node tools/build-preferences.cjs`, `node tools/check-default-drift.cjs`. Copy the pattern of `default_view` or `tree_order` (grep it).
2. Pure function first, exported through `__zentralNotesTestSeam`, fixture test red, then implement. Parser changes go in `parseBlocks` / the inline parser; keep `exportHtml` and `exportText` in step.
3. Release loop: `node tools/build-standalone.cjs --bump`, `node tools/sync-version.cjs`, `node tools/build-standalone.cjs`, `node tools/build-preferences.cjs`, `node tools/build-z-map.cjs`, `node tools/build-standalone.cjs --check`, then `node tests/run-all.cjs`. The second and third commands keep the main mod and every standalone module on one version.

---

## NEXT SESSION HANDOFF (version 3.4.0, edit in place, keep it short)

**Rule for every AI session: update State, Completed this session, Known debts, Next action and version here in place. Keep the project version at 3.4.0 until the owner explicitly says otherwise.**

State: **3.4.0 on beta**. The existing roadmap through `OW-110` is complete (see `docs/LEGACY_done_rows.md`). Remaining open items are `T4.3a`..`T4.3c`, `ST7.4`, and the owner live-check item `OW-66`.

Completed this session: OW-108 restores Calendar weather; OW-109 adds `weather.default_view`, direct Today/Tomorrow/Week buttons persisted via `weather.view` independently from the default, compact day-of-month labels (`18.`, `19.`, ...), actual weather descriptions for all Week rows including Today/Tomorrow, and live EN/PL localization; OW-110 audits Boost and fixes Game Mode (`gameModeTargets()` no longer calls `getOrCreateAppBrowser`, `applyGameMode(true)` no longer calls `syncPanelActivity()` to re-wake preload panels, `syncAppPanelBrowserActivity` respects active Game Mode, `strongerSaverSleep()` chains after `runLevel2` instead of hitting `level2Busy`, teardown clears `game_mode` pref, pending settle timers resolve cleanly on `destroy()`, async `requestProcInfo()` Promises work, trim/unload/limiter cleanup guards, and Boost widget card popup sampling/disposal/late-attach).

Known debts: no live Zen/Sine runtime is available in this session; repository tests and CI must be used where possible, and live-only claims must not be presented as verified.

Next action: continue eligible smaller open items (`T4.3a` → `T4.3b` → `T4.3c`, `ST7.4`). Do not bump any version above 3.4.0.
