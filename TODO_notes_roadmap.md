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

---

## Master Order (all remaining work)

Order = impact first (High to Low); inside the same impact the cheapest effort first (S to L); a row never comes before a row it depends on. Impact and effort: S = under one session slice, M = one session, L = several sessions.

| Order | ID          | Status    | Impact              | Effort | Depends on        | Task                                                                                                     |
| ----: | :---------- | :-------- | :------------------ | :----- | :---------------- | :------------------------------------------------------------------------------------------------------- |
|    11 | `T2.5`      | `PARTIAL` | Med-High            | M      | —                 | Drag, resize and create items in the calendar                                                            |
|    12 | `T2.9`      | `PARTIAL` | Med-High            | M      | none              | Daily-note lifecycle and archive policy inside Agenda                                                    |
|    13 | `T1.19b`    | `OPEN`    | Med-High            | M      | —                 | Obsidian vault export                                                                                    |
|    14 | `T1.19c`    | `OPEN`    | Med-High            | M      | T1.19b            | Obsidian vault import                                                                                    |
|    15 | `T3.2`      | `OPEN`    | Med-High            | M      | —                 | Multi-select notes & folders in tree view                                                                |
|    16 | `T4.2`      | `OPEN`    | Med-High            | M      | —                 | Performance audit & active timer/listener registry table                                                 |
|    17 | `OW-29`     | `OPEN`    | Med-High            | M      | —                 | Retyping a date or time in a calendar line moves the stored item                                         |
|    18 | `AU-B4b`    | `OPEN`    | Med-High            | L      | AU-B4a            | [new] Notes language: interface strings (English/Polish)                                                 |
|    19 | `SB6.2`     | `OPEN`    | Med                 | S      | none              | Agenda root folder right-click menu                                                                      |
|    20 | `T2.19`     | `PARTIAL` | Med                 | S      | —                 | Quick snooze on a reminder (+1 day / +3 days / next week)                                                |
|    21 | `SB6.7`     | `OPEN`    | Med                 | S      | UI4.7             | Items whose source note is in Trash                                                                      |
|    22 | `SB6.4`     | `PARTIAL` | Med                 | S      | TM3.3             | Cap the number of Agenda tabs ('+N more')                                                                |
|    23 | `T2.6`      | `OPEN`    | Med                 | S-M    | —                 | Big Picture popup for the calendar                                                                       |
|    24 | `SB6.5`     | `OPEN`    | Med                 | S-M    | F0.1              | Agenda Doctor (diagnostics and repair)                                                                   |
|    25 | `T2.11`     | `OPEN`    | Med                 | S-M    | none              | Exclude folders from the Zen NOTES sidebar                                                               |
|    26 | `T2.11a`    | `OPEN`    | High                | S-M    | T2.11             | Calendar-only notes (e.g. Birthdays) hidden from Zen NOTES                                               |
|    27 | `T3.9a`     | `OPEN`    | Med                 | S-M    | none              | Widgets module shell, free-area measurement, video-player avoidance                                      |
|    28 | `T3.9b`     | `OPEN`    | Med                 | S      | T3.9a             | Widgets: clock and date                                                                                  |
|    29 | `T3.10`     | `OPEN`    | Med                 | S-M    | —                 | Custom keyboard shortcut for opening a particular Zentral app or panel                                   |
|    30 | `SB6.10`    | `OPEN`    | Med                 | M      | PF2.3             | Incremental Agenda projection                                                                            |
|    31 | `B3.3.50-6` | `PARTIAL` | Med                 | M      | —                 | Harden ZenSync & SessionStore isolation for Agenda and Notes pseudo-tabs                                 |
|    32 | `ST7.2`     | `OPEN`    | Med                 | M      | H1.2, H1.3, PF2.1 | Reminder history compaction (or append-only segments)                                                    |
|    33 | `T2.10`     | `OPEN`    | Med                 | M      | none              | Work-free-day tint + selectable holiday calendars                                                        |
|    34 | `T2.11b1`   | `OPEN`    | High                | M      | Track 1-2 UI done | Audit UI discoverability of all Notes functions                                                          |
|    35 | `T2.11b2`   | `OPEN`    | Med                 | M      | T2.11b1           | Rebuild the Notes DEMO notes                                                                             |
|    36 | `T2.13`     | `OPEN`    | Med                 | M      | all other Track 2 | ICS export/import and Google-sync groundwork (always last in Track 2)                                    |
|    37 | `T3.3`      | `OPEN`    | Med                 | M      | —                 | Drag-and-drop note tabs within Zen sidebar                                                               |
|    38 | `T3.8`      | `OPEN`    | Med                 | M      | —                 | Split View as an equal-sized companion window/pane                                                       |
|    39 | `T3.9c`     | `OPEN`    | Med                 | M      | T3.9a             | Widgets: weather (cached, user refresh interval)                                                         |
|    40 | `T3.9d`     | `OPEN`    | Med                 | M      | T3.9a             | Widgets: timer, quick note, RSS headline                                                                 |
|    41 | `T4.3a`     | `OPEN`    | Med                 | M      | none              | Extract calendar UI from `ZentralNotes.uc.js`                                                            |
|    42 | `T4.3b`     | `OPEN`    | Med                 | M      | T4.3a             | Extract parser/wiki graph and import/export                                                              |
|    43 | `T4.3c`     | `OPEN`    | Med                 | M      | T4.3b             | Extract Zen sidebar UI; single build entry                                                               |
|    44 | `OW-21`     | `OPEN`    | Med                 | M      | —                 | [new, lower priority] Find and replace within Notes                                                      |
|    45 | `OW-22`     | `OPEN`    | Med                 | M      | —                 | [new, lower priority] Find next/previous match outside the visible viewport                              |
|    46 | `SB6.6`     | `OPEN`    | Low-Med             | S      | SB6.3             | Setting: what the X (close) button does on an Agenda tab                                                 |
|    47 | `ST7.3`     | `OPEN`    | Low-Med             | S      | none              | Move calendar UI state out of notes metadata                                                             |
|    48 | `T3.5`      | `PARTIAL` | Low-Med             | S      | —                 | Callout toolbar button: last-used on click, more kinds                                                   |
|    49 | `T3.9e`     | `OPEN`    | Low-Med             | S      | T3.9a             | Widgets: battery/system load + settings section                                                          |
|    50 | `UI4.9`     | `OPEN`    | Low-Med             | S      | —                 | Space before the unit in slider values                                                                   |
|    51 | `UI4.11`    | `OPEN`    | Low-Med             | S      | —                 | Escape returns the focus to the button that opened a menu                                                |
|    52 | `ST7.5`     | `OPEN`    | Low-Med             | S-M    | ST7.2             | Reminder history export, prune and inspect UI                                                            |
|    53 | `UI4.10`    | `OPEN`    | Low-Med             | S-M    | —                 | Settings dialog follows the text size                                                                    |
|    54 | `ST7.4`     | `OPEN`    | Low-Med (long term) | L      | ST7.1             | Render Agenda rows without real tabs (research)                                                          |
|    55 | `SB6.9`     | `OPEN`    | Low                 | S      | TM3.1             | Agenda sidebar quiet hours and 'left' counts                                                             |
|    56 | `F0.15`     | `OPEN`    | Low                 | S      | —                 | Isolate the time-budget test of the Agenda projection                                                    |
|    57 | `DOC-1`     | `OPEN`    | Low                 | S      | —                 | README documents a split view that does not exist                                                        |
|    58 | `TM3.7`     | `OPEN`    | Low                 | S      | —                 | Day range keeps the wall clock on the day the clocks go forward at midnight                              |
|    59 | `F0.16`     | `OPEN`    | Low                 | S-M    | —                 | Sweep tests that build fixtures around the real clock                                                    |

---

## Task blocks (same order as the Master Order)

#### `T1.19b` / `T1.19c` — Obsidian export, Obsidian import

**Status:** `OPEN` · **Impact:** Med-High · **Effort:** M each · **Depends on:** none (b), then b to c · **Source:** split of T1.19 (`T1.19a` DONE in `docs/LEGACY_done_rows.md`)

`b`: export a vault folder mapping YAML front matter, `[[Note#Heading|alias]]`, `![[embeds]]`, callouts, tags. `c`: import such a vault, with a re-import that does not duplicate notes.

#### `T2.5` — Drag, resize and create items in the calendar

**Status:** `PARTIAL` · **Impact:** Med-High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**LEFT (only this):** pointer drag of recurring occurrences with a scope choice (this / this and following / all). The scope chooser and the pure move exist now (`askCalendarItemReschedule`, `moveOccurrence`, `recurrenceExceptions`); `calendarMoveTimedItem` still returns null for a series, so build the drag on `moveOccurrence`. Everything else (timed move/resize, reminder move, drag-create, undo, snap) is DONE; `T2.5a`-`T2.5d` are merged here.

#### `T2.9` — Daily-note lifecycle and archive policy inside Agenda

**Status:** `PARTIAL` · **Impact:** Med-High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE (from the closed `B3.3.32-7`): the purge moves a past, blank, unreferenced date note to Trash (never today/future, never a date that holds a stored item, never a note with metadata, links, tags or files), the 30-day Trash retention exists (`trash_auto_empty_days`), the date-note folder is labelled **Agenda**, note-less non-recurring items are mirrored into `## Agenda` and backfilled at start-up. LEFT: the _always archive, never trash_ setting and archive folder, the migration of the old Daily folder and links, and the rule for past date notes that are not blank. Depends on `T2.2c` (`DONE`), `T2.8` (`DONE`). Migrate existing Daily notes/folder and preserve links. Past daily notes move to Trash the next day and stay 30 days, then live only in the 48-hour rolling backup; optional _always archive, never trash_ setting.

**Full specification (original row):** **OPEN.** Depends on `T2.2c`, `T2.8`. Migrate existing Daily notes/folder and preserve links. Past daily notes move to Trash the next day and stay 30 days, then live only in the 48-hour rolling backup. Setting _always archive, never trash_ keeps compressed copies in a separate archive folder. No duplicate Daily pseudo-folder beside Agenda.

**Owner decision needed first (2026-11-16):** past date notes that are not blank are never cleaned up today. Decide whether they may ever go to Trash automatically (the safe default is never; only the archive setting moves them).

#### `T3.2` — Multi-select notes & folders in tree view

**Status:** `OPEN` · **Impact:** Med-High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Support `Shift+Click` (range) and `Ctrl/Cmd+Click` (toggle) in the note tree for batch move, batch category/tag assignment, batch export, and batch Trash.

**Full specification (original row):** **OPEN.** Support `Shift+Click` (range) and `Ctrl/Cmd+Click` (toggle) in the note tree for batch move, batch category/tag assignment, batch export, and batch move to Trash.

#### `T4.2` — Performance audit & active timer/listener registry table

**Status:** `OPEN` · **Impact:** Med-High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Profile parser, reminder scheduler, and DOM observers; document all active timers/listeners and verify rapid date-note switching returns listener count to baseline.

**Full specification (original row):** **OPEN.** Profile parser, reminder scheduler, and DOM observers; document all active `setInterval`/`setTimeout`/event listeners in a central registry to guarantee zero memory leaks on panel close. Include the rapid-switch case from the owner's second roadmap: open several date/day notes quickly and assert the listener count returns to its baseline (this mod has no `BroadcastChannel`/`WebSocket`; the leak risk is `addEventListener` and timers).

#### `OW-29` — Retyping a date or time in a calendar line moves the stored item

**Status:** `OPEN` · **Impact:** Med-High · **Effort:** M · **Source:** handoff finding, accepted 2026-11-16

**Problem:** Once a calendar line has its hidden `%%zn-item-id%%`, retyping its date or time in the note text does not move the stored item (`syncNote` always keeps `old.start`); only the calendar UI moves it.
**Plan (do in this order):**

1. Remember the schedule parsed from each line.
2. In `syncNote` let the text win only when the parsed schedule changed in this edit; an unrelated edit keeps a time moved in the calendar.
3. Conflicts between text and a calendar move: `lwwPick`. Keep every hidden marker (rule 3a); recurring items and DST days keep working.

**Tests / done when:** Text edit moves the item; calendar move survives an unrelated text edit; recurring, DST, two windows.

#### `AU-B4b` — [new] Notes language: interface strings

**Status:** `OPEN` · **Impact:** Med-High · **Effort:** L · **Depends on:** AU-B4a · **Source:** Owner 2026-11-14

**Problem:** All buttons, menus, dialogs, alerts and settings text of Notes and the calendar are hard-coded English literals in `ZentralNotes.uc.js` and the calendar module.
**Plan:** 1. One `t(key, params)` helper with the language table from `AU-B4a` and English fallback per key. 2. Convert area by area, one chunk each: calendar toolbar/views, composer, context menus, reminder alerts, Agenda/sidebar menus, All notes tree, settings. 3. A test that fails on a new hard-coded user-visible literal in converted areas and on a key missing from a language. 4. Polish translation for every converted area.
**Tests / done when:** Per converted area: renders in Polish and English, no `undefined` keys.

#### `SB6.2` — Agenda root folder right-click menu

**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** none (the `T3.4` menu infrastructure is done; its last item is unrelated) · **Source:** Audit R1 B8

**Problem:** CSS hides the native rename/delete/unpack items for the Agenda root and `onAgendaFolderMenuShowing` returns early for the root, so the menu is nearly empty.

**Plan (do in this order):**

1. Add 'Open calendar', 'Hide Agenda', 'Agenda settings', 'Refresh Agenda'; keep foreign items from other mods visible.

**Tests / done when:** Menu handler test with a fake menupopup.

#### `T2.19` — Quick snooze on a reminder (+1 day / +3 days / next week)

**Status:** `PARTIAL` · **Impact:** Med · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: calendar reminder buttons/marks, in-app calendar item context menus, and the Zen Agenda sidebar item menu (it reuses `calendarItemMenuModel`, so the same Snooze group is there for non-recurring items). LEFT (only this): recurring snooze. The exception scopes it waited for exist now (`recurrenceExceptions`, `moveOccurrence`, the scope chooser of `Change time…`); wire Snooze to them with occurrence-scoped history and remove the disabled reason in `calendarItemMenuModel` (`Recurring occurrences need exception support…`).

**Full specification (original row):** **PARTIAL in 3.3.31.** DONE: calendar reminder buttons/marks and all rendered calendar item context menus expose Snooze +1 day, +3 days, next Monday, and a custom date/time picker. Timed reminders preserve wall-clock time across DST; IANA item zones are honored for custom times; fall-back overlap chooses the earlier instant and spring-forward gaps advance to the first valid wall minute. All-day reminders remain date-only. Snooze appends a schedule-only history record and leaves source Markdown unchanged. **LEFT:** expose the same actions on Zen Agenda sidebar surfaces (`T3.4`), and wire recurring snooze to the new exception scopes with occurrence-scoped history; recurring Snooze remains visibly disabled meanwhile.

#### `SB6.7` — Items whose source note is in Trash

**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** UI4.7 · **Source:** Audit R1 B13

**Problem:** `getItems` blanks the source title for a trashed note but still projects the item; clicking silently falls back to Day view.

**Plan (do in this order):**

1. Show 'source note in Trash' in the tooltip/card with a Restore action, or hide those items (setting).

**Tests / done when:** Projection + click tests.

#### `SB6.4` — Cap the number of Agenda tabs ('+N more')

**Status:** `PARTIAL` · **Impact:** Med · **Effort:** S · **Depends on:** TM3.3 · **Source:** Audit R2 P6

**Done:** the Overdue group is capped (`agendaOverdueProjection`, default 10, `+N more` node `more:overdue` that opens the day of the first hidden item). **Left:** the day folders have no cap.
**Problem:** A 31-day window can create hundreds of real pinned `about:blank` tabs (each `addTab`/`pinTab` fires events and session work).

**Plan (do in this order):**

1. Setting 'Max items in sidebar' (default 40); beyond it show a single '+N more…' node that opens Day/Agenda view.
2. Distribute the cap by day, earliest first.

**Tests / done when:** Projection test for the cap and the extra node.

#### `T2.6` — Big Picture popup for the calendar

**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** **OPEN.** Source audit found no Big Picture popup or dedicated tests. LEFT: temporarily move the live calendar pane to a large viewport card, persist 70/80/90/95% sizes, and restore host, view, scroll and focus with Escape/outside/teardown cleanup.

#### `SB6.5` — Agenda Doctor (diagnostics and repair)

**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M · **Depends on:** F0.1 · **Source:** Proposal S1

**Problem:** Orphan seed tabs, duplicate keys, tabs outside the root, released folders and history state are only discoverable by reading the DOM.

**Plan (do in this order):**

1. Settings button 'Check Agenda': counts and lists orphan seeds, duplicate keys, foreign tabs, released folders, history size/write state; one-click repair for safe cases.

**Tests / done when:** Harness-based repair tests.

#### `T2.11` — Exclude folders from the Zen NOTES sidebar

**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Depends on `T2.8` (`DONE`). Per-folder switch _Hide this folder from the Zen sidebar_ stored in `meta.json`; notes remain in All notes, search, calendar, and wiki links.

**Full specification (original row):** **OPEN.** Depends on shared Zen folder code in `T2.8`. Per-folder switch _Hide this folder from the Zen sidebar_ in tree and Zen folder menus, stored in `meta.json`. Notes remain in All notes, search, calendar and wiki links; only tabs and folder disappear from Zen NOTES. Children inherit parent exclusion unless explicitly overridden.

#### `T2.11a` — Calendar-only notes (e.g. Birthdays) hidden from Zen NOTES

**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Depends on `T2.11`. Per-note _Calendar-only / Hide from Zen NOTES_ flag + Birthday note preset/category so birthday notes never clutter Zen NOTES tabs while remaining searchable and active on the calendar.

**Full specification (original row):** **OPEN.** Extend `T2.11` to a per-note _Calendar-only / Hide from Zen NOTES_ flag, available during note creation and later in note/folder menus. Such notes never become ordinary Zen NOTES tabs, but remain in All notes, search, backlinks, calendar and reminder navigation. Provide a practical Birthday note preset/category and allow any number of independent birthday reminders. Per-note exclusion must coexist with inherited folder exclusion and must not hide the note from the calendar.

#### `T3.9a`..`T3.9e` — Sidebar widgets (split of T3.9)

**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M each · **Source:** owner 2026-11-10

Standalone module `additional/widgets` (also in the full pack). Rules for all: study how new-tab-page widgets work and mimic them; never interact with the sidebar video player (free area about 179x426, about 179x301 while a 16:9 player shows; no fixed ratio); always leave room for tabs, folders and Essentials (setting: max share of free height, hide below a minimum); no permanent polling, per-widget refresh interval, pause when window or sidebar is hidden, cache last value. `a`: shell, free-area measurement, player avoidance, per-widget on/off. `b`: clock, date. `c`: weather. `d`: timer, quick note, RSS headline. `e`: battery/system load and the settings section.

#### `T3.10` — Custom keyboard shortcut for opening a particular Zentral app or panel

**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Right-click an app/panel > "Add custom keyboard shortcut" (at least 2 keys, collision-checked, toggles visibility).

**Full specification (original row):** **OPEN.** Right-click an app/panel (for example an Instagram panel) > "Add custom keyboard shortcut"; prompt records the combination (at least 2 keys, no single key, refuse combinations that collide with Zen/Firefox or another Zentral shortcut) and stores it per app. The shortcut reveals the app if hidden and hides it if shown. Show and remove the shortcut in the same context menu and in settings. Reuse the Notes assignable-keys code where possible.

#### `SB6.10` — Incremental Agenda projection

**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Depends on:** PF2.3 · **Source:** Proposal S3

**Problem:** Every run rebuilds all days.

**Plan (do in this order):**

1. Diff items by version and re-project only changed ids and affected days.

**Tests / done when:** Equality test with full projection on random edits.

#### `B3.3.50-6` — Harden ZenSync & SessionStore isolation for Agenda and Notes pseudo-tabs

**Status:** `PARTIAL` · **Impact:** Med · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: stale restore cleanup and, when Zen’s `saveState` hook is available, non-mutating pseudo-tab/empty managed-folder and corresponding native-group filtering before sidebar/session and Sync projection, preserving foreign content across windows. LEFT: Firefox’s separate SessionStore snapshots, split-view metadata, and previously synced records.

**Detailed proposal (owner-approved 2026-11-13, owner notes included):**

### 4. Zero-Leak ZenSync & SessionStore Shield (`B3.3.50-6`)

Zen's `gZenPinnedTabManager` and Firefox's `SessionStore` treat pinned tabs inside `zen-folder` elements as persistent workspace tabs that get serialized to `sessionstore.jsonlz4` and synced via ZenSync. To guarantee Notes and Agenda pseudo-tabs never pollute ZenSync or survive as broken `about:blank#zn-*` tabs:

- Mark every Notes and Agenda pseudo-tab with `skipSessionStore` (and `zen-empty-tab` / custom `bgalazka-ephemeral-tab` where safe) and intercept `gZenPinnedTabManager` / `SessionStore` tab-data hooks if exposed.
- Run an unconditional startup + `SSTabRestored` sweep for both `about:blank#zn-note:`/`#zn-new:` AND `about:blank#zn-agenda-` URLs/folders regardless of whether the corresponding preference is currently enabled or disabled.

#### `ST7.2` — Reminder history compaction (or append-only segments)

**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Depends on:** H1.2, H1.3, PF2.1 · **Source:** Audit R2 P4

**Problem:** `writeNow` rewrites every record on every change; each reminder adds up to 3 `alerted` records plus snooze/done/dismiss and nothing is pruned. 5000 records = about 1 MB per write, 20000 = about 4 MB; `claimAlert` re-reads and parses the whole file before each alert.

**Plan (do in this order):**

1. On load keep the latest transition per occurrence and `alerted` records only for the last 30 days (setting); archive the rest to `reminder-history.archive.jsonl`.
2. Or switch to monthly append-only JSONL segments; `claimAlert` reads only the current segment.

**Tests / done when:** Compaction preserves `stateFor` results; size test.

#### `T2.10` — Work-free-day tint + selectable holiday calendars

**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Depends on `T2.1` (`DONE`), `T2.4b` (`DONE`). Greenish tint for weekends, public holidays and personal days off in month/week/list views with offline region rules (`holidaysFor(region, year)` / `isWorkFree(day, prefs)`).

**Full specification (original row):** **OPEN.** Depends on `T2.1`, `T2.4b`. Greenish tint for weekends, public holidays and personal days off in month/week/list views. Region selector (Polish, German, English, American, more later); offline fixed/Easter/weekday rules; pure `holidaysFor(region, year)` / `isWorkFree(day, prefs)` tested per year, tooltip names holiday, own extra days off. Decide weekend days per region (Sat/Sun or Fri/Sat).

#### `T2.11b1` / `T2.11b2` — Discoverability audit, then demo rebuild

**Status:** `OPEN` · **Impact:** High / Med · **Effort:** M each · **Depends on:** Track 1-2 UI done / T2.11b1 · **Source:** split of T2.11b

`T2.11b1`: list every implemented Notes function and where a person finds it; group related controls into menus; write the findings list. `T2.11b2`: rebuild the built-in DEMO notes to show every implemented function (after `T2.11b1`).

#### `T2.13` — ICS export/import and Google-sync groundwork (always last in Track 2)

**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** **DO NOT BEGIN UNTIL EVERY OTHER TRACK 2 ROW IS `DONE`.** Local `.ics` export/import with stable `uid` / `etag` / `updated`, `syncState`, and RRULE serialization.

**Full specification (original row):** **OPEN — DO NOT BEGIN UNTIL EVERY OTHER T2 TASK IS COMPLETE.** Depends on all Track 2 item model, recurrence, reminder and calendar UI work. Export/import `.ics` locally (no network); stable `uid` / `etag` / `updated`, `syncState` per item, RRULE serialization and fixture coverage.

#### `T3.3` — Drag-and-drop note tabs within Zen sidebar

**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Hook into Zen sidebar drag events so reordering or dropping a note tab into a folder updates the underlying Notes tree order/parent folder smoothly.

**Full specification (original row):** **OPEN.** Hook into Zen sidebar drag events so reordering or dropping a note tab into a folder updates the underlying Notes tree order/parent folder smoothly.

#### `T3.8` — Split View as an equal-sized companion window/pane

**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Allow opening a second note side-by-side in an equal-dimension split pane (or synchronized companion panel) for reference reading and cross-note editing. Audit 2026-11-16: nothing of this exists; `Split view` today is only editor + preview (`mode === "split"`). When this is built, also add the _open in split view_ action to the shared note/folder menu engine (moved here from the closed `T2.18`).

**Full specification (original row):** **OPEN.** Allow opening a second note side-by-side in an equal-dimension split pane (or synchronized companion panel) for reference reading and cross-note editing.

#### `T4.3a`..`T4.3c` — Modularize `ZentralNotes.uc.js` (split of T4.3)

**Status:** `OPEN` · **Impact:** Med · **Effort:** M each · **Source:** previous roadmap

`a`: calendar UI out of the monolith (module `api`, test seam unchanged). `b`: parser/wiki graph and import/export. `c`: Zen sidebar UI and one build entry. After each step all tests and the standalone build must pass unchanged.

#### `OW-21` — Find and replace within Notes (lower priority)

**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Depends on:** none · **Source:** Owner request

**Plan:** Add discoverable find-and-replace to Notes with explicit single/all replacement, preview/count and safe editable-note behavior; preserve undo, read-only/trash protections, literal matching semantics, selections and existing find behavior. Define behavior for case/accent options and zero/overlapping matches; never silently replace across unrelated notes.

**Tests / done when:** Unit and real-sheet tests cover replace one/all, matching options, no matches, undo, read-only/trash and non-target notes; document keyboard/accessibility behavior.

#### `OW-22` — Find next or previous match outside the visible viewport (lower priority)

**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Depends on:** none · **Source:** Owner request

**Plan:** Extend Ctrl+F with next/previous actions that skip all matches currently visible in the note viewport and move to the next not-displayed match, letting the user read all visible matches at once. Preserve existing single-match navigation, wrap behavior, selection and scroll; handle partially visible matches, no offscreen match, both directions, editable/read/split layouts and resizing.

**Tests / done when:** Geometry and real-sheet tests include several visible matches, offscreen matches in both directions, wrap/no-offscreen cases and accessible controls; verify live layout where possible.

_Not blocked by the calendar work._

#### `SB6.6` — Setting: what the X (close) button does on an Agenda tab

**Status:** `OPEN` · **Impact:** Low-Med · **Effort:** S · **Depends on:** SB6.3 · **Source:** Proposal D5

**Problem:** Closing an Agenda tab makes it reappear (`TabClose` -> `schedule(400)`).

**Plan (do in this order):**

1. Options: hide this item today / dismiss / do nothing (default hide today).

**Tests / done when:** Harness test for each option.

#### `ST7.3` — Move calendar UI state out of notes metadata

**Status:** `OPEN` · **Impact:** Low-Med · **Effort:** S · **Depends on:** none · **Source:** Audit R2 P5

**Problem:** `setMeta` rewrites the whole meta file (folders, up to 5000 note agenda overrides) 600 ms after every view/cursor/size/filter change (one write 600 ms after the last change: a drag of the Size slider is one write).

**Plan (do in this order):**

1. Store `calendarView`, `calendarCursor`, scale/range, filters in a small separate file or prefs; migrate once.

**Tests / done when:** Migration test; no meta write on Prev/Next.

#### `T3.5` — Callout toolbar button: last-used on click, more kinds

**Status:** `PARTIAL` · **Impact:** Low-Med · **Effort:** S · **Source:** audit 2026-11-16

**Current state and what is LEFT:** DONE: a `Callout…` entry in the More menu (`showCalloutMenu`), 15 kinds (`CALLOUT_KINDS`), and holding Quote or the More caret lists them. LEFT (only this): a primary click that inserts the last-used callout (remembered per window) and the extended kinds of the old spec (`[!faq]-` foldable, `[!bingo]`, `[!poll]`) in the picker.

#### `UI4.9` — Space before the unit in slider values

**Status:** `OPEN` · **Impact:** Low-Med · **Effort:** S · **Source:** handoff finding, accepted 2026-11-16

**Problem:** A slider value has no space before its unit (`7days`, `100000chars`).
**Plan:** One formatter for the value + unit of every settings slider; no space only for `%` and `px`.

**Tests / done when:** The settings layout test asserts the text of every slider value.

#### `UI4.11` — Escape returns the focus to the button that opened a menu

**Status:** `OPEN` · **Impact:** Low-Med · **Effort:** S · **Source:** handoff finding, accepted 2026-11-16

**Problem:** Escape closes a menu of the sheet (`closeMenu`) without giving the focus back to the button that opened it. Every menu is affected; keyboard users lose their place.
**Plan:** Remember the opener in `closeMenu` and focus it on Escape and on an action chosen by keyboard; do nothing when the opener is gone or the close came from an outside click.

**Tests / done when:** One test over every menu opener; focus returns on Escape, not on outside click.

#### `ST7.5` — Reminder history export, prune and inspect UI

**Status:** `OPEN` · **Impact:** Low-Med · **Effort:** S-M · **Depends on:** ST7.2 · **Source:** Audit R1 S6

**Problem:** History is hard to inspect and trim.

**Plan (do in this order):**

1. List/filter/export/prune in the Notes settings next to ICS groundwork.

**Tests / done when:** UI test for prune with confirmation.

#### `UI4.10` — Settings dialog follows the text size

**Status:** `OPEN` · **Impact:** Low-Med · **Effort:** S-M · **Source:** handoff finding, accepted 2026-11-16

**Problem:** The Settings card takes its size once, when it opens (from the Writing tab); a later change of text size or sheet size does not resize it and its body scrolls instead. Chips, tabs and dialog buttons keep 12 px (`.zn-chip { font-size: 12px }`), so at 28 px text the labels are large and the On / Off chips small. The Table creator shows both scrollbars where the card must be wider than the sheet (classic scrollbars): its number fields do not shrink and its size grid grows with the width.
**Plan (do in this order):**

1. Size chips, tabs and buttons from the text size.
2. Fit the card again when the text size or the sheet changes; in `fitCard` measure the height again once the natural width is known.
3. Table creator: let the number fields shrink and cap the size grid.

**Tests / done when:** `tests/notes-settings-layout.test.cjs` cases for a text-size change while open; run `tools/audit-notes-settings-layout.cjs` (0 findings).

#### `ST7.4` — Render Agenda rows without real tabs (research)

**Status:** `OPEN` · **Impact:** Low-Med (long term) · **Effort:** L · **Depends on:** ST7.1 · **Source:** Audit R1 D6

**Problem:** Every item is a real pinned `about:blank` tab, which is the root of the session/sync/tab-cycling edge cases.

**Plan (do in this order):**

1. Investigate whether Zen's folder DOM can host non-tab rows with the same hover/drag behaviour; prototype behind a flag; abandon if Zen internals fight it.

**Tests / done when:** Prototype report.

#### `SB6.9` — Agenda sidebar quiet hours and 'left' counts

**Status:** `OPEN` · **Impact:** Low · **Effort:** S · **Depends on:** TM3.1 · **Source:** Proposals S5/D3

**Problem:** Ideas from the audit.

**Plan (do in this order):**

1. Optional: collapse the Agenda folder outside work hours or when nothing is due within N hours.
2. Day pill and label show items 'left' (excludes ended and done).

**Tests / done when:** Projection tests.

#### `F0.15` — Isolate the time-budget test of the Agenda projection

**Status:** `OPEN` · **Impact:** Low · **Effort:** S · **Source:** handoff debt, accepted 2026-11-16

**Problem:** `tests/notes-agenda-projection.test.cjs` measures a time budget inside the parallel batch (75.6 ms against a ceiling of 55.7 ms, once in five full runs) because its name has no `perf`, so `run-all.cjs` does not isolate it.
**Plan:** Move the timing assertion to `tests/notes-agenda-projection-perf.test.cjs`; keep the behaviour assertions where they are.

#### `DOC-1` — README documents a split view that does not exist

**Status:** `OPEN` · **Impact:** Low · **Effort:** S · **Source:** audit 2026-11-16, accepted

**Problem:** `additional/notes/README.md` ("Split view as a second window (setting, off by default)") describes a setting with no code; only an orphan comment remains above `syncAllNewButton` in `ZentralNotes.uc.js` (~11129).
**Plan:** Remove the README line and the comment (rebuild standalone, keep the README test green), or build it as part of `T3.8`.

#### `TM3.7` — Day range on the day the clocks go forward at midnight

**Status:** `OPEN` · **Impact:** Low · **Effort:** S · **Source:** `F0.13` observation, accepted 2026-11-16

**Problem:** `addDays(dayStart, 1)` keeps the wall clock, so in a zone whose clocks go forward at midnight (Chile, Egypt, Lebanon, Cuba) the day of the change ends at 01:00 of the next day wherever a day range is built that way (views not checked). One day a year; only items between 00:00 and 00:59.
**Plan:** Build day ranges with `zonedDayBounds`/`dayStart` of the next day instead of adding 24 h or keeping the clock; check Week, Day, Month and Agenda.

**Tests / done when:** A golden case for such a zone in the time-zone matrix.

#### `F0.16` — Sweep tests that build fixtures around the real clock

**Status:** `OPEN` · **Impact:** Low · **Effort:** S-M · **Source:** handoff test noise, accepted 2026-11-16

**Problem:** `F0.14` fixed one test that failed at some hours of the day because it used the real "now". Others may fail at hours nobody has run them at.
**Plan:** List every test that reads `Date.now()` or `new Date()` for fixtures, fix the clock in each (pattern of `tests/notes-calendar-views.test.cjs`), then run the suite under the four-zone matrix at three different hours.

**Tests / done when:** A check that fails on a test using the real clock without fixing it.

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

## NEXT SESSION HANDOFF (version 3.3.204, edit in place, keep it short)

**Rule for every AI session: update State, Completed this session, Known debts, Next action and the version here in place. Move finished rows to `docs/LEGACY_done_rows.md`.**

State: **3.3.204.** `F0.1`–`F0.14`, `H1.1`–`H1.6`, `PF2.1`–`PF2.6`, `TM3.1`–`TM3.6`, `UI4.7`, `UI4.8`, `AU-B1`, `AU-B2`, `AU-B5`, `SB6.1`, `SB6.3`, `SB6.8`, `T1.18`, `T2.8b`, `T3.1`, `T3.4a`, `T3.6a`, `T4.1`, `T4.5`, `OW-18`, `OW-26`, `OW-04`, `OW-04a`, `OW-28`, `OW-03`, `OW-23`, `OW-24`, `OW-09`, `OW-05`, `OW-02`, `OW-07`, `OW-10`, `OW-11`, `OW-08a`, `OW-08b`, `OW-08c`, `OW-25`, `OW-30`, `AU-B4a`, `OW-27`, `T2.4c1`, `B3.3.32-7` and `T2.18` are DONE and archived. The main mod and every standalone module are on one version (`node tools/sync-version.cjs --check`). The full suite (`162/162` test files) passes in Node/fake-Zen at 3.3.204. Live Zen cold-restart fix verified by owner at 3.3.202. The settings dialogs are also measured in a headless Chromium (`tools/audit-notes-settings-layout.cjs`, not part of the suite: 240 cells, 0 findings, run again at 3.3.177), and so is the size of the calendar (`tools/audit-notes-calendar-fit.cjs`, not part of the suite: 160 full-Month cells, 0 findings at 3.3.177; the OW-09 date-picker audit measured 12 cells across 2 text sizes, 3 pane heights and 2 scrollbar kinds at 3.3.179, 0 findings).

Completed this session (3.3.163–3.3.204), every finished item archived in `docs/LEGACY_done_rows.md`:

- `T1.18` (3.3.204) — completed the remaining export syntax-mismatch & per-note flavor/ignore audit in `ZentralNotes.uc.js`: protected all Zentral calendar metadata markers (`%%calendar:...%%`, `%%zn-item-id:...%%`, `%%zn-item-category:...%%`, `%%zn-date-ignore:...%%`, `%%not-date%%`) as HTML comments even when `A31` is off; added warning + portable conversion for `E12`/`E19` list shorthands, `D02` Reddit no-space headings, `L04` Reddit `r/`/`u/` links (guarded against link labels), YouTube/video `![alt](...)` media embeds, and `B17` / Zentral `#w=&a=` image sizing; propagated per-note `flavor` into `markdownExportWarnings(noteObj, opts)`, `exportBody(..., readOpts)`, HTML/TXT `exportNote`, and PDF `printNote`. Expanded `tests/notes-export-flavor.test.cjs` (`162/162` suite).

- Hotfix follow-up chores & futureproofing (3.3.203) — added cross-root `sameRoot` guard before `parent.moveBefore(...)` in `ZentralSecondaryViews.uc.js` (`moveBrowser`), updated `loader/README.md` startup-barrier docs and `ZentralBrowserIntegrations.uc.js` ownership guide, and expanded `tests/panels-addon-host-root-protection.test.cjs` to 11 behavioral tests including full end-to-end Triple View (`OW-30`) + Real Tab IDs (`ZentralBrowserIntegrations` + `ZentralSecondaryViews` + `ZentralPanelLifecycle`) cold-start host-tab chaos recovery, real `ZentralPanels` `pruneRestoredAddonHosts` + late `SSTabRestored` execution, and real `ZentralNotes` `pseudoEventInside` non-Node `composedPath` testing (`162/162` suite).

- Hotfix (3.3.202) — live-verified fix for cold-start `#zen-app-panel-root` detachment caused by native `Tabbrowser.sys.mjs` `discardBrowser`/`_endRemoveTab` walking 3 `parentNode` hops (`browser` → `#zen-app-panel-slider` → `#zen-app-panel-clip` → `#zen-app-panel-root`) when Zen replaces/discards an early add-on host tab during pinned-folder restoration: guarded `gBrowser.getBrowserContainer`, `gBrowser.getPanel`, `gBrowser.discardBrowser`, and `gBrowser._endRemoveTab` (plus capture-phase `TabClose`, cross-root `moveBefore` fallback, and safe `removeEmptyAddonHostFolder`) in `ZentralBrowserIntegrations.uc.js`; extended `waitForNativeStartup()` in `ZentralRuntime.js`/`ZentralStandaloneShim.js` to await `SessionStore.promiseInitialized`, `delayedStartupPromise`, `gZenPinnedTabManager.promiseInitialized`, `gZenSessionStore.promiseInitialized`, and `gZenWindowSync.promiseInitialized`; hardened `pruneRestoredAddonHosts()` in `ZentralPanels.uc.js` (skip `zen-empty-tab`, run on `nativeReady` and late `SSTabRestored`); added detached-root self-heal in `ZentralPanelLifecycle.js`; and fixed non-Node `composedPath()` guard in `ZentralNotes.uc.js` `pseudoEventInside`. Added `tests/panels-addon-host-root-protection.test.cjs` (`162/162` suite).

- `OW-18` DONE (3.3.201) — workspace-scoped notes & calendar isolation (`tests/notes-space-isolation.test.cjs`, `161/161` suite).

- `T3.4a` + `AU-B2` DONE (3.3.200) — built a single shared top-layer hover card engine `createSidebarHoverCard` in `loader/ZentralRuntime.js` (copied verbatim into `loader/standalone/ZentralStandaloneShim.js` by `tools/build-standalone.cjs`), coordinated per window via `window.__zentralSidebarCardHost` so full-pack AND standalone RSS + standalone Notes (installed together without the core mod) share one engine and never overlap two cards; satisfied `AU-B2` by connecting a parent-only `{ childList: true }` `MutationObserver` on show and disconnecting on hide/destroy (zero document-wide or idle observers, zero extra always-on `mousemove` listeners). Migrated `additional/rss/ZentralRssDisplay.uc.js` (`#bgalazka-rss-card`) and `additional/notes/ZentralNotes.uc.js` (`#bgalazka-notes-agenda-card` and `#bgalazka-notes-sidebar-card`) onto the shared engine; added `"snooze-1h"` and `formatAgendaHoverTime` in `ZentralNotesCalendar.js`, pure `notePreviewLines`/`buildNoteHoverModel`/`buildAgendaHoverModel` in `ZentralNotes.uc.js`, Notes card (title, folder breadcrumb, tags, 3–4 line snippet, active/overdue reminder badge, Open, New note in folder, `T2.3e`-gated Trash), and Agenda card (title, formatted date + time range, category badge, clickable source note link, calendar note text, headless Open/Done/Snooze +1h/+1d/Dismiss with `nextAgendaItem` & pointer retargeting). Added `tests/notes-sidebar-hover-cards.test.cjs` and updated `tests/notes-agenda-hover.test.cjs`, `tests/z-heights.test.cjs`, and `tests/standalone.test.cjs` (`160/160` suite).

- `SB6.3` DONE (3.3.199) — added pure command partitioning and Undo/Monday helpers in `ZentralNotesCalendar.js` (`HEADLESS_AGENDA_COMMANDS`, `SHEET_AGENDA_COMMANDS`, `isHeadlessAgendaCommand`, `snoozeMondayDays`, `undoLifecycleAction`, `agendaActionMessage`), exposed headless `store.runAgendaCommand(item, command)` directly on the item/history stores with conflict-guarded Undo (supporting stored items, mirrored list checkboxes, and legacy front-matter note reminders), built compact top-layer `createAgendaActionToast` (`#bgalazka-notes-agenda-toast`, `popover="manual"`, `role="status"`, one-shot Undo, Escape dismissal with zero leaked listeners, hover/focus auto-hide pause), and wired `onAgendaTabMenuShowing` so Done, Dismiss, Reopen, Snooze (+1d/+3d/Monday), Zen Agenda visibility, Convert, and Duplicate run headlessly with zero Notes sheet opened while keeping the sheet for `Edit details…`, `Change time…`, `Open source note`, `Custom date and time…`, and `Delete…`. Added `tests/notes-agenda-headless-actions.test.cjs` (`159/159` suite).

- `OW-30` DONE (3.3.198) — moved panel start-up readiness and `open_at_startup` parsing into `loader/ZentralRuntime.js` and `loader/standalone/ZentralStandaloneShim.js` (`readStartupPanel`, `whenNativeReady`) so Triple View and single-panel startup restore never depend on the optional `ZentralStartup` mod; fixed sleeping Essential tab URL recovery in `ZentralCornerPanels.uc.js` (`syncCornerTiles` fallback to `linkedPairFor`), `ZentralPanels.uc.js` (`startupPanelCoordinator`, `startupApp`/`recreateLoadedPanels` fallbacks, `syncCornerTiles` before `onRestore`), and `ZentralSecondaryViews.uc.js` (`resolvePairApp` without duplicating Essential tabs, `ctx.openStartupTriplePair`, self-sufficient `whenNativeReady` restore when no panel coordinator is present); and persisted + restored exact pixel and proportional share heights (`gapPx`/`shareGap`, `dockPx`/`shareDock`, `cardH`/`cardHShare`, pure `resolveSlotHeight`/`resolveCardHeight`/`hasStartupPanelPref`, no-op drag guard, `finishOpen` post-load `applyState`/`applyPush`/`layout` pass, and detached card height restore) for Triple View, docked primary panels, and the standalone Notes card. Added `tests/notes-triple-view-ow30.test.cjs` (`158/158` suite).

- `H1.6` DONE (3.3.197) — added synchronous unload write staging (`UNLOAD_RECOVERY_DIR`, `unloadEntryStem`, `parseUnloadEntryName`, `planUnloadWrites`, `decideNoteRecovery`, `store.flushOnUnload`, `store.reconcileUnloadRecovery`, `items.unloadSnapshot`/`reconcileRecoveryEntry`/`refresh`, `history.unloadSnapshot`/`reconcileRecoveryEntry`, `realIO.copy`) wired to `window` `unload` so unsaved notes, `calendar.json`, reminder history and `meta.json` are copied and staged synchronously on Gecko's I/O thread in strict note-before-calendar order (`UI4.7`) without awaiting promise steps in the closed window, then automatically reconciled on next open or live sibling window without ever overwriting a foreign change (keeping only the recovery copy on conflict). Added `tests/notes-unload-save.test.cjs` + Gecko `unload()` dead-promise simulation in `tests/helpers/fake-panel-window.cjs` (`157/157` suite).
- `T4.1` DONE (3.3.196) — added pure `SHOWCASE_NOTE_ID` (`zn-demo-showcase`) and `buildShowcaseNote()` bundled into `DEMO_NOTES` (`Markdown & Extended Syntax Feature Showcase`, 12 sections: inline styles/dividers, H1–H6 + auto-updated `## Table of Contents`, multi-paragraph/nested blockquotes, Obsidian callouts including foldable `[!faq]-`, unordered/ordered/interactive task lists, aligned GFM table with escaped pipes `\|`, JS/Python/Rust/JSON highlighted code blocks, inline/block LaTeX equations & matrices, wikilinks with alias/`#Heading`/`^block-id`/nested `#tags`/`![[embeds|450]]`, standard & inline footnotes, native `<details>` accordions, and Mermaid `flowchart`/`gitGraph` blocks). Added `tests/notes-showcase.test.cjs` and updated `tests/notes-cycle-f.test.cjs` & `tests/notes-p4-ui.test.cjs` (`156/156` suite).

- Roadmap audit 2026-11-16 (no code changed, version stays 3.3.195): every open row was checked against the code and the tests. Closed and archived because the code and a passing test already exist: `OW-27` (an Agenda entry opens on the first stationary release, `tests/notes-agenda-click.test.cjs`, `tests/notes-agenda-bounce.test.cjs`), `T2.4c1` (nothing left that `T2.4c4` does not own), `B3.3.32-7` (its only LEFT was `T2.9`) and `T2.18` (the Zen Agenda day and item menus exist; its last bullet, the split-view menu action, moved to `T3.8`). Narrowed: `T2.19` (only recurring snooze left), `T3.4` (only _Create reminder in this folder…_ left), `T3.4a` (Agenda title card exists, now `PARTIAL`), `SB6.4` (Overdue is capped, now `PARTIAL`), `T2.9` (blank-note purge exists, now `PARTIAL`). Live-check wording removed from `T1.18`, `B3.3.50-6`, `T2.4c4`. `T4.4` carries a warning: `stretched()` and `SLOT.quad` are live code. Second pass 2026-11-16 (owner accepted all proposals): new rows `H1.6`, `OW-30`, `OW-29`, `UI4.9`, `F0.15`, `DOC-1`; dropped `T3.11`, `T4.4`, `AU-B2` (folded into `T3.4a`); `T3.5` trimmed; the phase headings are gone, the blocks follow the Master Order, and the Master Order is sorted by impact (High first), then effort (S first), never ahead of a dependency (59 rows after the third pass: new `UI4.10`, `UI4.11`, `F0.16`, `TM3.7`; `T2.5` reworded; `SB6.2`, `SB6.3`, `T3.4a`, `T2.11` no longer wait for `T3.4`; `T2.9` needs an owner decision first). The root `TODO_handoff.md` is a byte copy of `docs/LEGACY_handoff_3.1.3.md` and should be deleted from the repository.
- `UI4.7` DONE — multi-window and data-integrity edge tests closed: blocked stale write keeps later edits until its recovery copy exists; writers without a lock are detected by snapshot; note text is always written before `calendar.json` (`createItemStore({ beforeWrite })`); after a crash between the two writes the manual record and its mirror line become one reminder again (`mirrorItemToAgendaNote` twin re-key). `F0.5` and `F0.6` (finished earlier) were moved out of the roadmap.
- `T4.5` DONE — one version everywhere: `tools/sync-version.cjs` (+ `--check`, `--set`), `tests/version-sync.test.cjs`, CI workflow and release-loop documentation.
- `F0.8` + `AU-B1` DONE — readable recurrence golden table (`tests/notes-recurrence-golden.test.cjs`, 3 zones x 4 system zones). Fixed what it exposed: `UNTIL` now ends a series with its last day in the item's zone (`recurrenceUntilMs`), and both recurrence editors show the stored last date (`parseRule().untilKey`) instead of the day before on a 23-hour day.
- `F0.9` DONE (not a planned row, found while preparing `SB6.8`) — `tests/notes-undefined-identifiers.test.cjs` fails on any name used without a declaration and on any calendar function that is named but not exported. It exposed four defects, all fixed with behaviour tests: the sidebar command `Move note to trash` threw and did nothing; the three Save buttons of the Zen Agenda visibility dialogs threw after saving, so the sidebar folder was not refreshed; a failed side effect of Save left the calendar composer open (a second press stored the item twice); a restored Agenda tab outside the last projection got a bare title and the wrong icon.
- `SB6.8` DONE — sidebar guards are bound at start-up for Agenda and for NOTES entries; the boot timers only start the projections. Closed with it: projections never run before the notes are loaded (restored entries were removed and re-created), the first Agenda run after a restart adopts the restored tabs instead of replacing them, and writes from the guarded menus wait for the store. Test: `tests/notes-sidebar-startup.test.cjs`.
- `F0.10` DONE (not a planned row) — `tests/run-all.cjs` stops a test file after 5 minutes and reports it as failed. Before, one failing `assert.equal` on fake DOM elements stalled the whole run (rule 16).
- `F0.11` DONE (not a planned row, found while preparing `T3.1`) — the windows of one application now coordinate on Windows and Linux too. The registry of cross-window turns lived on Firefox's hidden window, which exists on macOS only; it now lives on the global shared by the system modules, and a turn waits at most 8 s for another window. Effects: one alert per reminder stage with two windows open, and a save never silently replaces a save of the same note made in another window. The toolbar widget is registered once (`CustomizableUI` is frozen, the old owner mark threw in every window). New test helper `tests/helpers/fake-panel-window.cjs`.
- `T3.1` first part (3.3.168) — start-up half: the restore of Notes, a sheet opened before the notes are read, a folder that is away at start-up, `meta.json` that cannot be read for a moment, two windows starting together and a panel suite built later all end the same way whatever happens first (points 1–6 of the archived row). Test: `tests/notes-startup.test.cjs`.
- `F0.12` DONE (not a planned row, found by the full run for `T3.1`) — the clock of the fake Zen window (`tests/helpers/fake-zen-browser.cjs`) is virtual. It ran on the real clock plus an offset, so a debounce re-armed on a busy machine asked for 220 ms instead of 250 and `fireTimer(250)` did not find it: `tests/notes-sidebar-startup.test.cjs` failed 14 of 24 runs under CPU load (also on the code before `T3.1`) and once in a normal parallel run. Now 0 of 24, and all 32 test files that use the fake windows pass under the same load.
- `F0.13` DONE (not a planned row: an external review of 3.3.168, fifteen points, each answered in the archived row) — fixed: a window closed in the middle of a shared step is no longer waited for (the review's dead-object mechanism does not occur; the real effect was a wait of the whole limit, because the browser runs no further promise step of a closed window; every gate now carries its owner's `isAlive`); the start-up turn has its own limit of 2 minutes, saves keep 8 s (a slow disk made the second window read the folder side by side with the first); the note save queue survives a failure whose report also fails; `calendar.json` never holds a record that points at a note which is not in its file (a reminder made while its date note could not be saved was lost at the next start; it is now written as a reminder of its own until the note is saved, `createItemStore({ noteFileState })`, `unmirroredItem`); sidebar actions asked for while the folder is away are carried out when it is back; a series whose last date is the day the clocks go forward at midnight (computer in Chile, Egypt, Lebanon, Cuba; items without their own zone, so every all-day item) no longer gets one occurrence more. Checked, no defect: same-millisecond edits, `meta.json` written through a temporary file, repeated start attempts, other readers of `until`. Not changed, with reasons in the row: lowering a version with `sync-version.cjs`, stopping child processes of a stalled test. Tests: `tests/notes-unsaved-note-records.test.cjs` and `tests/notes-save-queue.test.cjs` are new; `notes-shared-windows`, `notes-startup` and `notes-recurrence-golden` grew.
- `T3.1` second part (3.3.170; point 7 of the archived row) — two windows that are already running no longer undo each other's `meta.json`: a save reads the file and merges (folders by permanent id and field by field, a deleted folder stays deleted), the windows take turns, folders and the alert / Agenda rules show in the other windows about a second later, layout and view stay per window. A save made by another window while a starting window was catching up is no longer missed. `tests/notes-meta-windows.test.cjs` is new (15 cases), `tests/notes-startup.test.cjs` has 23.
- `T3.1` DONE (third and last part, 3.3.171; the row is archived) — Settings and Quick settings no longer lie over themselves at a larger text size or in a narrow sheet. Measured, not read: `tools/audit-notes-settings-layout.cjs` (new) opens the real sheet in a headless Chromium for text sizes 8–40 px, sheets 240–700 px wide, a short and a tall sheet, scrollbars with and without room (240 cells, 2 640 views of Quick settings, every Settings tab, Toolbar buttons, Keyboard shortcuts). Before: 63 156 findings, in all 240 cells, the default 13 px included; after: 0. Causes: the rows of the Settings body were squeezed to 28 px as soon as a tab was taller than the card (at 13 px the Theme dropdown of Appearance lay over the heading below it); `.zn-quick` was styled twice and the later rule made every list of setting rows run on like words; minus, value and plus were loose items and broke apart; rows could not wrap; a card that grows past the sheet was two pixels too low, 24 px too wide and off centre. `tests/notes-settings-layout.test.cjs` is new (6 cases, the 5 behaviour cases fail on the code before) with the helper `tests/helpers/css-cascade.cjs` (which declaration of the style sheet wins for an element of the fake DOM).
- `OW-26` DONE (3.3.172; the row is archived) — between the two panels of Triple View an edge of Notes moves only its own boundary. Shown in a fake window that runs the real secondary views beside the real Notes script on boxes computed from the real style sheets (`tests/helpers/fake-triple-view.cjs`, new): 152 of 240 start-up scenarios had a fault before, 0 after. Causes: the suite held a page at a floor that changed with every px of the band (a quarter of what the pages had left) and gave what the page could not give to the other side without telling Notes, so a drag of the top edge moved the bottom edge; pairs get there by themselves, because a band of an odd height moved the divider half a px up every time the panel slid away and returned (the split is saved each time); "Larger" left pages of 23–52 px that Notes stopped counting; the swap closed the sheet and opened another (caret lost, a folded sheet came back open); a folded sheet forgot where its edges had been dragged to. Now: one floor on both sides (120 px, or a quarter of the two pages), the suite reports the split it applied, the divider returns to a whole px, a held sheet moves to the rebuilt bar. `tests/notes-triple-view-startup.test.cjs` is new (26 cases, 24 fail on 3.3.171).
- `OW-04` DONE (3.3.173; the row is archived) — Week and Day can be held to a part of the day: the `08–20` button in the calendar toolbar, the hours under Tools → Visible hours…; stored as `meta.calendarHours`. While a day in view has a timed item outside, the grid is widened by whole hours on that side, hatched, with a line that names the item; all-day items and the time of day never widen it (a current time outside is a dotted mark on the edge of today's column). "When am I free?" can be held to the same hours. Pure: `visibleHourRange`, `gridOffsetOf`, `gridMinuteAt`; `layoutDay` and the two placement functions take no range (the archived row says why). Fixed with it, all present before: on the two days the clocks change, without a display zone, Week and Day drew every item after the change one hour off and shaded and searched working hours one hour off; a reminder late in the evening hung below the grid; two very short events close together lay over each other. `tests/notes-calendar-hours.test.cjs` is new (30 cases; it runs itself once more under `TZ=Europe/Warsaw` for the clock-change days).
- `OW-28` DONE (3.3.174; not a planned row: the owner's answer of 2026-11-15 to the question `OW-26` left; the row is archived) — Notes between the panels of Triple View goes away without changing the saved split. Before, the divider went to the middle of the band whenever Notes closed or the panel slid away with Notes open, and the split is saved each time: a pair too uneven to centre the band (one panel on its floor) lost its split, 30 / 70 came back as 41 / 59. In a grid of 208 scenarios in which nobody drags anything (pairs from 20 / 80 to 80 / 20, four panel heights, four Notes settings; start-up, slide away, close, open, resize, swap) the saved split was replaced in 174, in 118 of them by the start-up alone; now in none. A band that lies where a new band is put (`tripleBandAsOpened` in the secondary views) leaves the split alone; a band whose edge was dragged still ends with the divider in its middle, which is what brings it back to its place. Notes centres a band whose edges were never dragged every time it asks for it instead of keeping the split a floor had allowed as a ratio (`SLOT.moved`, `keptGapUp`). 14 new cases in `tests/notes-triple-view-startup.test.cjs` (40 in all; 10 of the new ones fail on 3.3.173).
- `OW-04a` DONE (3.3.175; a correction of 3.3.173, archived as its own row) — short events one after another keep one lane. Since 3.3.173 an event shorter than its 20 px box takes the lane of the box, so that two of them cannot lie over each other. That also sent half-hour events in a row side by side at 36 px an hour (18 px apart, boxes of 20 px), where before they were stacked with 2 px over each other. Now a box may reach up to 4 px over the item that follows it; more than that and the two stand side by side. Reminders are as they always were.
- `TM3.6` DONE (3.3.175; not a planned row, found by the test noise below) — with a display time zone that is behind the computer's zone, Week lost the all-day reminders of the first day it shows and Day lost all of them (all-day events stayed). The items were collected for the days of the display zone only, and an all-day reminder begins at the computer's midnight. Now for those days and for the dates as written.
- `F0.14` DONE (3.3.175; not a planned row) — `tests/notes-calendar-views.test.cjs` no longer runs on the real clock. It builds its calendar around "now" and failed at some hours of the day: the time-zone matrix failed on 2026-11-16 at 00:06 in Europe/Warsaw and at 12:06 in Pacific/Auckland, on 3.3.173 as well as on the tree being worked on. One failure was the fixture (the first free slot of the day lay over another event), the other was `TM3.6`. Its `Date` is now fixed at one instant and goes on from there.
- `OW-03` DONE (3.3.176; the row is archived) — the size of the calendar. The `Size` button replaces Comfortable / Compact / Extra compact. `Fit` (the default) makes the hours Week and Day show as high as the timeline allows, so all of them are in sight without a scrollbar, and makes the six weeks of Month fill the pane; a slider in the button's menu sets the height of an hour (16–120 px) or of a week (44–160 px) by hand, `Fit to the pane` goes back. Stored per view as `meta.calendarScale` (`"auto"` or px); the old setting is converted once (Comfortable becomes Fit). An hour is never fitted under 1.4 of the text size (18 px at 13 px text): in a pane too low for that the timeline scrolls, and a timeline that scrolls opens an hour before the current time or where the working day begins, not at midnight (the debt `OW-04` left). Decided with it: the smallest box of an item shrinks with the hour (`calendarMinBoxPx`), an event too low for its time above its title shows the title alone, a Month cell shows as many items as it holds (`monthCellLines`, `monthCellPlan`). A resize no longer draws the calendar again with every px: Month refits its cells in place, Week and Day are drawn again only when the fitted hour changes. Fixed with it, present before: in a very low pane the timeline was 0 px high. `tests/notes-calendar-scale.test.cjs` is new (25 cases, all fail on 3.3.175). Measured in a headless Chromium with `tools/audit-notes-calendar-fit.cjs` (new; text 8–28 px, sheets 330–1000 px high, both pane layouts, 160 cells): 3.3.175 has 2 210 findings in all 160 cells, 3.3.176 none.
- `OW-23` DONE (3.3.177; DST transitions hardened in 3.3.193; the row is archived) — a time zone is chosen from a list with find, and a fixed offset from UTC is a zone. One picker (`buildZonePicker`) in Tools → Display time zone, in the composer and in "Calendar item details": type a city, a country, an abbreviation or an offset (`berlin`, `poland`, `cet`, `utc+3`, `gmt-5:30`); the matches are listed under the field, the arrow keys and Enter or a click take one, Escape closes the list and not the dialog. `Browse…` lists everything: this computer, chosen lately (`meta.calendarRecentZones`, at most six), the fixed offsets, then the zones by part of the world. The field holds what is stored (`Europe/Warsaw`, `UTC+03:00`) and a line under it says what that is. A city, a country with one zone, an id in any letter case and an offset are taken as typed; a text that fits several zones (`cet`, `germany`) is refused on Save with a sentence that says what to do, and nothing is stored. `cleanZone` accepts `utc+3`, `GMT-5:30`, `+0530` and stores `UTC+03:00` (−12:00 to +14:00, quarter hours; `UTC+0` is `UTC`); day bounds, the clock of the grid, the visible hours, free slots and recurrence compute a fixed offset without the engine, and it has no daylight-saving time. The list is pure (`zoneChoices`, `searchZones`, `resolveZoneText`, `zoneGroups`, `cleanRecentZones`): the zones the engine lists (418 in Node 22) with city, country, the offset in force and the abbreviation, then 38 fixed offsets. Countries come from a table made from the tz database, abbreviations from a table keyed by the engine's English long name (the engine has a short name for a few zones per language only). Closed with it, the PERF debt of the golden table: `zonedDateTimeToMs` no longer scans minute by minute (one call for Warsaw 6.14 → 0.028 ms; a month grid with 20 daily items in their own zones about 3 400 → 35 ms, with a budget test), and gives what the scan gave around the clock changes of 12 zones. In 3.3.193, summer-time <-> standard-time (DST) transitions were verified and hardened across `snoozedItemStart` and `reminderSnoozeTomorrowMinutes` (preserving `item.x.tz` wall clock across spring-forward/fall-back), `layoutGridSpans` in Week/Day (side-by-side lanes for 1st- vs 2nd-pass repeated fall-back hours and no false lane collisions across spring-forward gaps), `askCalendarFreeSlots`/`askCalendarSlotEvent` (slot labels and composer prefill in `calendarDisplayZone`), and `askCustomReminderSnooze`/`Snooze until next Monday` (civil date in `item.x.tz`). `tests/notes-calendar-zones.test.cjs` (17 cases) and `tests/notes-calendar-dst-zones.test.cjs` (7 cases) both run in the 4-zone matrix (`154/154` suite, `232/232` matrix). The three dialogs were looked at in a headless Chromium at 13, 20 and 28 px text in sheets 340–700 px wide: nothing of the picker leaves its card, keys and a real click work; one fault was found that way and fixed (a card that had grown past the sheet kept the height it had with the list open).
- `OW-05` DONE (3.3.180) — All notes note-row context menu now offers “Add to Calendar…” through the shared `composeFromNote(noteId, when?)` entry used by the following drag/drop task. It pre-fills the note title and link, defaults to the selected calendar day (or local today), accepts a target date/time shape for reuse, and is disabled for trashed notes with the restore reason shown. `tests/notes-calendar-menu.test.cjs` checks the live action, linked-note/title/date/reminder defaults, cancel-without-write, and the trashed-note disabled state. Verified: `142/142` regression files and `200/200` timezone-matrix files across four zones at 3.3.180; standalone generation and patch-format check pass.
- `OW-02` DONE (3.3.181) — dragging a non-trashed note from the All notes tree onto Month cells, narrow Month picker cells (`OW-09`), Week/Day all-day cells or Week/Day time tracks highlights the computed target slot (`calendarNoteDropSlot`, `calendarNoteDropLabel`), cancels cleanly on `dragleave` or `Escape` without leaving All notes, and opens `composeFromNote(noteId, slot)` prefilled with the linked note, title, date and snapped slot time (or all-day). Tested in `tests/notes-calendar-note-drop.test.cjs` across four zones (`143/143` suite, `204/204` matrix).
- `OW-07` DONE (3.3.182) — the `+` control in All notes now pairs a one-click button (`.zn-new`) with a create menu (`.zn-new-menu`, also reachable via right-click or `ArrowDown`): `New note`, `New folder`, `New reminder`, `New event`, and `Date note` when Agenda is off (`ALL_NOTES_NEW_CHOICES`, `cleanAllNotesNewChoice`, `allNotesNewMenuModel`, `allNotesNewButtonLabel`). Reminder and event choices open the calendar composer defaulted to the selected calendar day (`store.meta.calendarCursor` or local today), and picking an entry remembers it in `meta.allNewChoice` (per window, falling back to `note` when Agenda hides `Date note`) for one-click creation while keeping `PREF.NEW_CHOOSER` intact. Tested in `tests/notes-all-new-menu.test.cjs` (`144/144` suite, `204/204` matrix).
- `OW-10` DONE (3.3.183; delinked from `calendarSnap` in 3.3.192) — `'Create calendar item'` now renders a compact month picker (`.zn-cal.is-compact`, with Start/End target chips for events) side by side with the shared Clock (`.zn-cal-clock`) inside `.zn-cal-compose-schedule-board`. `buildClockPicker` adds an analog dial (draggable/clickable hour hand auto-advancing to minute hand, 24-hour dual ring vs 12-hour AM/PM per locale via `clockUses12Hour`, fixed 5-minute analog resolution via `ANALOG_CLOCK_SNAP = 5` delinked from Week/Day `calendarSnap`, accessible `role="slider"` hour/minute controls with keyboard and wheel stepping) alongside digital selectors, a persisted `Both / Analog / Digital` toggle (`meta.calendarClockMode`), and full reuse across event Start/End, `Change time…`, and Custom reminder snooze (`T2.12b1`). Pure helpers (`CLOCK_MODES`, `cleanClockMode`, `clockUses12Hour`, `clockPointerAngle`, `clockAngleOfHour`, `clockHourFromAngle`, `clockAngleOfMinute`, `ANALOG_CLOCK_SNAP`, `clockMinuteFromAngle`, `stepClockHand`, `clockDialPoints`) and UI flows are tested in `tests/notes-calendar-clock.test.cjs` (`153/153` suite, `228/228` matrix).
- `T3.6a` DONE (3.3.184) — accessible color-palette contrast across light, dark, paper, recommended (light/dark system schemes) and zentral (light/dark host schemes plus custom Zen primary/surface overrides). Pure surface/contrast engine (`resolveThemeSurface`, `derivePaletteTokens`, `resolveFolderSurfaceTokens`, `ensureContrastHex`, `contrastRatio`, `hueDistanceDeg` in `ZentralNotesCalendar.js`) derives readable foreground, outline, hover, selected and disabled tokens from the actual rendered surface while preserving palette hue within <=15°. Wired across swatches/menus, `colorPicker` (with live `.zn-palette-preview`), `askFolderStyle` (preset swatch badges + live `.zn-fstyle-preview` sharing `applyFolderRowVisual` byte-for-byte with `.zn-frow`), `ZentralColorfulFolders` `.zcf-swatch-dot`, inline `.zn-hl` marks, narrow Month heatmap picker (`--zn-cal-picker-tint-safe`), and colored events/reminders (`T2.3g`, including done/dismissed lifecycle tokens and explicit Week/Day `<button>` foreground) across Month, Next days, Agenda, Week and Day with live theme/media refresh (`tests/notes-palette-contrast.test.cjs`, `146/146` suite, `208/208` matrix).
- `OW-11` DONE (3.3.185) — `'Inherit'` choices across `'Create calendar item'`, category defaults, and per-note Agenda/alert defaults now show their resolved value and source layer (`Inherit (3 days, from category Work)`, `Inherit (note Sprint Plan colour: green #4cc38a)`, `Inherit (Silent, from category Work)`, etc.) via pure `describeInheritance(kind, item, layers)` in `ZentralNotesCalendar.js`, updating live whenever Category or Linked note changes while keeping sparse item inheritance on save (`tests/notes-composer-inheritance.test.cjs`, `147/147` suite, `208/208` matrix).
- `OW-08a` DONE (3.3.186) — Stage 1 (`pre`) alerts render a non-modal live tabular-nums countdown pill (`.zn-reminder-countdown[aria-hidden="true"]`, e.g. `Due in 5:00` -> `Due in 0:01` -> `Due now`) driven by pure `reminderDueAt`, `reminderPreCountdownText` and `reminderCountdownDelayMs` with zero idle polling, and raise Stage 1 default sound from `"quiet"` to `"normal"` (two-note gentle chime while preserving quiet-hours suppression and `reminder > note > category > global` overrides; `tests/notes-reminder-stage1.test.cjs`, `148/148` suite, `212/212` matrix).
- `OW-08b` DONE (3.3.187) — Stage 2 (`due`) alerts render as larger persistent cards (`[data-layout="large"][data-persistent="true"]`, primary `Done` styling, no unrecorded local `Close` button when reminder actions exist, no auto-dismiss timer), pulse calmly via `zn-reminder-due-accent` (disabled under `prefers-reduced-motion: reduce`), default to `"loud"` sound (`0.35` gain, 3 urgent pulses), and cap mounted stack cards at `3` prioritized by stage urgency with a `+N more` / `Show fewer` overflow control (`tests/notes-reminder-stage2.test.cjs`, `149/149` suite, `216/216` matrix).
- `OW-08c` DONE (3.3.188) — Stage 3 (`followup`) alerts render as a centred viewport overlay with scrim (`[data-overlay="true"]` + `.zn-reminder-scrim`, `role="alertdialog"`, `aria-modal="true"`), large ordered `Done / Snooze / Open note / Dismiss` buttons (`orderOverlayAlertActions`), automatic focus on `Done` with focus restore on close, `Escape = Dismiss` (never `Done`), active-window preference + single-window `claimAlert` enforcement across browser windows, and per-stage `corner` / `large` / `centred` display selects in `'Reminder sounds & quiet hours'` (`tests/notes-reminder-stage3.test.cjs`, `150/150` suite, `220/220` matrix).
- `UI4.8` DONE (3.3.189) — `.bgalazka-triple-drag-handle` takes `pointer-events: none !important` under `:root[bgalazka-hover-panel-hidden]` so presses over the web page while the panel is slid away reach the page, and `ZentralSecondaryViews.uc.js` + `ZentralPanelHover.js` reposition the strip back onto the divider once the 0.2 s reveal slide finishes (`ctx.scheduleSecondaryGeometryFit`, `bgalazka-hover-panel-hidden` attribute observer, and `#zen-app-panel-root` `transform` `transitionend`; `tests/notes-triple-view-divider-autohide.test.cjs`, `151/151` suite, `220/220` matrix).
- `AU-B5` DONE (3.3.190) — `Tools -> Week start & numbers…` (`askCalendarWeekSettings`, persisted in `meta.calendarWeekStart` `1 | 0` default Monday `1` and `meta.calendarWeekNumbers` default `false`) configures Monday/Sunday week start and optional week numbers (`WEEK_START_DAYS`, `cleanWeekStart`, `cleanWeekNumbers`, `weekdayLabels`, DST-safe civil `weekNumber` for ISO 8601 Monday-first and Sunday-first weeks, and `weekText` `# Week N` heading) across Full Month, narrow Month heatmap picker (`OW-09`), Week/Day time grid (`.zn-cal-time-corner` `W#` badge + `patchCalendarItem`), shared mini date pickers (`buildDatePicker`), and week Markdown export (`tests/notes-calendar-week-start.test.cjs`, `152/152` suite, `224/224` matrix).
- `OW-25` DONE (3.3.191) — `.zn-calendar-days-select` in Week view exposes a live `1–14` slider + `Auto (fit width)` (`fitWeekDayCount` at `84 px` minimum readable column width after the `42 px` gutter) + `Start of range` (`Week start` honouring `AU-B5`, `Today`, `Selected day`), persisted per view in `meta.calendarWeekSpan = { days, anchor }` without affecting Day view (`1` day) or `Next days` (`calendarDaysForward`). Prev/Next step by the shown column count (`1` day with `Shift`), `refitCalendar` refits `Auto` columns on resize only when the fitted count changes, and the all-day strip, off-hours/busy shading, drag/drop geometry, `When am I free?` date range, and week Markdown export (`weekText(..., { days })`) all follow the shown days (`tests/notes-calendar-week-days.test.cjs`, `153/153` suite, `228/228` matrix).
- `OW-09` DONE — the narrow Month fallback is a six-week, date-only picker. `dayHeat(items, day)` and `pickerMonth` count live event/reminder occurrences per local day, including recurring and overnight items, with 0/1/2–3/4+ intensity and a deterministic dominant-category tint. Automatic width/height thresholds and manual picker/full-month modes plus count/category tint are stored in `meta.calendarPicker`; clicks select the date, the selected-day list stays below, low panes open Day view, and arrows/Home/End/PageUp/PageDown navigate with roving focus. Tests: `tests/notes-calendar-picker.test.cjs` (pure model/settings) and `tests/notes-calendar-scale.test.cjs` (responsive sheet widths/heights, cell content, tint, selection, keyboard and manual overrides). The headless fake DOM verifies DOM/CSS contracts; the dedicated Chromium audit (`--picker`) measured 12 cells across text sizes, heights and scrollbar styles with 0 findings at 3.3.179; the real-Gecko visual check remains an owner check.
- `OW-24` DONE (3.3.178; the row is archived) — a time or a date can be typed fast in every field. Times: `16`, `830`, `8.30`, `8,30`, `8 30`, `16h`, `9am`, `9:15pm`; never a guess (`25`, `860`, `13pm` are refused). Dates: `14` is that day of the month the field shows; `1411`, `14.11`, `14,11` are the next such day from today on; `14.11.2026`, `tomorrow`, `+3d` as before; the date format of the settings decides which of two numbers is the month. While a field is typed in, a line under it says how the text is read (`08:30`; the weekday and the date in the format of the settings). Enter, or leaving the field, writes the full form. A text that is no time or no date puts back what the field held and marks the field, and the Save that follows is held once and names the field, so nothing is saved with a value the person believed to have replaced. The text of a field is selected when the field gets the focus, by a click too, so that typing replaces the old value. The start time of an event takes both times at once (`8-16`). In the composer, the details of an item, `Change time…` and the custom snooze (the time has a field there now, beside the Clock), the reminder of a note, `Note for a date` and `When am I free?`. Pure readers in the calendar module: `parseClock`, `parseTimeRange`, `parseDateEntry`, `dateEntryOrder`, `clockOfMinutes`; in the sheet `bindEntry` (one field) and `settleEntries` (what a Save asks). Left as they were, on purpose: the text of a note (`- 3 apples` is no event at 03:00) and the titles of date notes (`parseDateKeyText`, which the row named, reads those: a note called `14` is no date note). `tests/notes-calendar-typing.test.cjs` is new (21 cases, in the time-zone matrix, all fail on 3.3.177). Looked at in a headless Chromium with real keys and real clicks; two faults were found that way and fixed (a click put the caret into the old value, `09:00830`; Chromium moves the selection after a click into a field that already had the focus).

Standing owner rules for chunks: commit to Git, no ZIPs; no conversational filler; production-ready code and test suites; tasks strictly in order (implementation, edge cases, unit tests). Owner 2026-11-14: no live-check items (owner tests in the app and reports); do NOT add low-priority polish that changes nothing noticeable; only fix what a person would notice. Owner 2026-11-15: Month does not use the visible hours of Week / Day ("there is barely space for visible items anyway there"); do not build it. One version everywhere: `node tools/sync-version.cjs` after `build-standalone.cjs --bump` (see "How to add a feature").

Known debts / owner requirements: `B3.3.50-6` (`SessionFile.write` snapshot isolation) remains `PARTIAL` (`OW-18` completed at `3.3.201`). LIMITS of `OW-04`: the pointer is held to the hours shown, so a new range or an edge cannot be dragged beyond them (show all 24 hours, or type the time); the layout was measured in Chromium, not in Gecko. LIMITS of `OW-03`: where the hours fit was measured in Chromium, not in Gecko (the fit itself is arithmetic on the measured height of the timeline; what differs between the engines is the height of a line of text, which moves the border between "fits" and "scrolls" by a px or two). At the default text size and with the panes side by side, 24 hours fit from a sheet about 710 px high; in a lower one they scroll at 18 px an hour (fewer hours fit earlier: `08–20` from about 500 px). In a pane too low for two and a half of the smallest hours the timeline scrolls inside a pane content that scrolls too. FOUND with it, not changed: Escape closes a menu of the sheet without giving the focus back to the button that opened it (`closeMenu`; every menu, not only `Size`). On the day the clocks go back an event that begins in the first pass of the repeated hour and ends in the second at an earlier clock time is drawn 20 px high (a clock grid has one place for 02:30). `OW-26` is shown in a fake layout only: remote browsers, native hit testing, pointer capture and real timing are not covered, and the owner's pair and settings are not known, so the owner checks the edge drag in Zen. `OW-28` likewise (fake layout only). Test noise: other test files that build fixtures around the real "now" may fail at hours nobody has run them at (`F0.14` fixed the one that did; the whole matrix passed at 23:10 UTC with that one exception). Not changed: `tests/notes-agenda-projection.test.cjs` measures a time budget inside the parallel batch (its name has no `perf`, so `run-all.cjs` does not isolate it); it failed once in five full runs of this session (75.6 ms against a ceiling of 55.7 ms, two cores and four workers) and passed alone three times. Accepted limits of `UI4.7` (not tasks): a foreign program writing between our compare and our write cannot be locked out; note file and `calendar.json` are ordered and repaired on start, not one transaction (details of a reminder that never reached `calendar.json` are lost if the browser dies between the two writes; date, time and title survive in the note line). FOUND while testing, needs an owner decision (nothing changed): once a calendar line has its hidden `%%zn-item-id%%`, retyping its date or time in the note text does not move the stored item (`syncNote` always keeps `old.start`); only the calendar UI moves it. Safe fix idea: remember the schedule parsed from each line and let the text win only when that parsed schedule changed in an edit. FOUND, not changed: for a skipped hour (clocks forward) an item with its own zone moves to 03:00, an item in the system zone to 03:30; both are pinned in the golden table. LIMITS of `OW-23`: the picker was looked at in Chromium, not in Gecko, and with a throwaway script (no audit tool was added for it). Its labels are English; the language of the browser is used for the names of countries in the search only. Abbreviations exist for the zones whose English long name is in `ZONE_ABBREVIATIONS` (Europe, Africa, North America, Australia, much of Asia); the others show their offset alone. Zone names without an area (`EST5EDT`, the zone `CET`) are not offered and cannot be typed: `cet` typed is the abbreviation and fits several zones (a stored one is kept as it is). An id with an area that the engine knows (`Etc/GMT-3`, `US/Pacific`) is not offered but is taken when typed in full. The zones chosen lately are kept per window. `UTC+3` is a fixed offset: an item in it does not follow a clock change (the list says so beside every offset). LIMITS of `OW-24`: a day and a month without a year are the next such day from today on, as in a note (`14.11` typed on 16 November is next year's; the line under the field shows the year); a day alone is a day of the month the field shows and may be past. The date parser supports English and Polish language tables; future interface-string translation remains `AU-B4b`. `24:00` and seconds are no times; quiet hours (the browser's own time fields) and Visible hours (whole hours) are as they were. Looked at in Chromium, not in Gecko: that a click leaves the text of a field selected rests on `focus`, `mousedown` and `mouseup` coming as the specification says. FOUND with it in Chromium only, nothing changed: the menu of a calendar item closes when its `Snooze` group is opened. The menu is filled anew, the button that had the focus is removed, and Chromium reports that as focus leaving the menu (`focusout`, then `closeMenu`). Gecko does not report a removed element that way and neither does the fake DOM, so Zen should not be affected; if the Snooze choices ever vanish in Zen, this is the place. FOUND while answering the review, nothing changed, ONE check in Zen asked of the owner (it cannot be reasoned out here): the Firefox source says a closed window runs no further promise step, and the save on closing a window first reads the note file (to notice a foreign change) before it writes, so the text typed since the last automatic save (0.8 s after the last key, at most the autosave interval while typing) is probably not written when the window is closed. Check: type a word in a note and close the window within half a second (not the last window: quitting may differ), open Notes in another window; if the word is missing, the fix is a row of its own: on `unload` copy the file to the recovery area and write the unsaved text in calls issued at once, which the I/O thread finishes without the window. The same applies to a calendar change made in the last 0.6 s (the note line then restores date, time and title, not the details). Since 3.3.170 the same applies to the settings file (it is read before it is written): a folder made in the last 0.6 s before a window is closed. OBSERVED with the `F0.13` fix, not changed: `addDays(dayStart, 1)` keeps the wall clock, so on a computer in a zone whose clocks go forward at midnight the day of the change ends at 01:00 of the next day wherever a day range is built that way (views not checked); one day a year, items between 00:00 and 00:59 only. LIMIT of the `T3.1` measurement of the settings dialogs: it ran in Chromium (Blink); Zen draws with Gecko, and no Gecko build can be fetched in the sandbox. The causes that were fixed (grid rows with a `min-height` in a grid that must scroll, a later rule with the same selector, loose items of a wrapping row) are behaviour both engines share by specification; the widths of text and form controls differ a little, which moves where a line wraps. If a settings row still looks wrong in Zen, the text size, the sheet width and the tab are enough to reproduce it. FOUND while measuring, nothing changed, each needs an owner decision before it becomes a row: (1) Chips, tabs and dialog buttons keep 12 px at every text size (`.zn-chip { font-size: 12px }`), so at 28 px the labels are large and the On / Off chips small. (2) The Settings card takes its size once, when it opens (from the Writing tab); it does not follow a later change of the text size or of the sheet, its body scrolls instead. (3) A slider value has no space before its unit (`7days`, `100000chars`). (4) Table creator: its two number fields do not shrink and its size grid grows with the width, so where the card has to be wider than the sheet it shows both scrollbars on systems with classic scrollbars (82 of the 120 measured cells with classic scrollbars; none with scrollbars that take no room; before 3.3.171, 171 of 240 cells). Fix idea: in `fitCard` measure the height again once the natural width is known.

Next action: continue the Master Order from row 1. Work on the Week / Day grid starts from `tests/notes-calendar-hours.test.cjs`; a time in the grid is a clock time, never minutes since midnight (run it under `TZ=Europe/Warsaw ZN_HOURS_WARSAW_RUN=1` to see a failure of the clock-change cases). Work on Notes inside Triple View starts from `tests/helpers/fake-triple-view.cjs` (its header says what it does and does not prove); a new case there must fail on the code before the change. After a change to the style of a Notes dialog run `tools/audit-notes-settings-layout.cjs` (setup in its header). Work on the size of the calendar starts from `tests/notes-calendar-scale.test.cjs` (the fake DOM has no layout: the test gives the timeline and the Month grid the heights the sheet measures; its header says how); after a change to the layout or the style of the calendar run `tools/audit-notes-calendar-fit.cjs` (same setup). Work on time zones starts from `tests/notes-calendar-zones.test.cjs` (its last part opens the real sheet and types into a dialog: the pattern for a test of a calendar dialog). Work on a field in which a time or a date is typed starts from `tests/notes-calendar-typing.test.cjs` and `bindEntry`; the text of a note is not read by those readers. Edit this file by hand or with a throwaway script; no helper script is kept in the repository.
