# ZentralNotes — Master TODO & Roadmap

> **Read this first.** This file contains ONLY work that is still to do, in the order it should be done. Every finished (`DONE`) row lives in `docs/LEGACY_done_rows.md` and `docs/LEGACY_notes_roadmap.md`; never look there for work. Rebuilt 2026-11-14 from the old roadmap, two source-code audits (2026-11-13) and the owner's 2026-11-14 list.
>
> 1. **Do tasks in the order of the Master Order table.** Inside a phase go top to bottom; a task's `Depends on` must be `DONE` (removed from this file) first.
> 2. **Each task is a block** (`####`) with Problem, Plan (ordered sub-steps), Tests. Carried-over tasks keep their original wording under 'Current state' / 'Full specification'.
> 3. **When a task is finished: delete its block and its table row, renumber nothing (IDs are stable), append the finished row to `docs/LEGACY_done_rows.md`, and report it in the NEXT SESSION HANDOFF.** Partial work: keep the block, change `Status` to `PARTIAL` and write `DONE:` / `LEFT:`.
> 4. Owner decisions are binding (see 'Ground rules' and 'Track 2 design rules').

### ID prefixes

| Prefix | Meaning |
| :-- | :-- |
| `F0.x` | Test/measurement foundation |
| `H1.x` | Hardening: loops, data loss, alert storms |
| `PF2.x` | Performance |
| `TM3.x` | Time correctness (wake, DST, overdue, missed) |
| `UI4.x` | Interaction safety (click, drag, keyboard, re-render) |
| `OW-xx` | Owner request or bug report of 2026-11-14 |
| `SB6.x` | Zen sidebar polish |
| `ST7.x` | Structural changes |
| `T1.x`..`T4.x`, `B3.3.x` | Carried over from the previous roadmap |

## Ground rules

Finished work and the long history live in `docs/LEGACY_notes_roadmap.md` and `docs/LEGACY_done_rows.md` (both frozen; the second holds every row that was DONE on 2026-11-14). Row references like "Cycle G #26" or "S6 W4" point into that file.

- Ordered by **impact on the daily user experience**, biggest first; inside a similar impact the cheaper item goes first. Re-order when the owner's priorities change.
- Everything that was listed as "verify in a real Zen" is **assumed to work** (owner decision, 2026-11-04). Do not re-add live-check items; only add one when a new Zen-only change cannot be reasoned about.
- Effort: S = under one session slice, M = one session, L = several sessions or a new subsystem.
- Never build: cloud sync inside the mod (owner: NO until the whole mod is finished); a sandboxed iframe with user JS (unsafe in chrome context); the Zen-native "Notes" folder as a Sync-excluded object (blocked, `docs/NOTES-ZEN-FOLDER-BLOCKER.md`).
- Never build (added 2026-11-07, security): raw HTML from a note reaching the chrome document (`<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<video src>` or any attribute copied from the note: K12, B23); embeds from any host other than YouTube (and only through the player in row 22); code that runs inside a note (Templater-style `<% %>`, N10); text-expander words such as `;date` (N11); opening a dropped file from inside Notes (show it in the folder instead).
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
10. **Finish every chunk the same way:** run the release loop, run ALL `tests/*.test.cjs`, update this file (rows, handoff, version), zip only changed files without `.git`.

11. **Tests before changes.** No change to the Zen sidebar projections without a harness test (`F0.1`), no change to a hot path (projection, scheduler, recurrence, history) without a budget test in the production call shape (`F0.2`). Record before/after numbers in the handoff.
12. **Performance rules.** Never scan all records or all items per occurrence (use indexes, see `PF2.1`); never run heavy work directly in a handler that fires on every store event (debounce, filter by event kind and id); never deep-copy with JSON round trips in loops.
13. **Sidebar safety.** Touch only tabs/folders that carry our attributes; ignore events caused by our own operations; reconcile must be idempotent (a second run on an unchanged store performs zero DOM operations); a foreign tab/folder inside a managed folder is moved out, never destroyed.
14. **Alerts.** One alert per stage per occurrence and schedule; never fire several stages in one pass (`H1.5`); alerts must survive sleep/clock changes (`TM3.1`).
15. **Owner rule reversal 2026-11-14.** In Month view a click selects the day; it does not open Day view (`OW-06`). Do not re-add the old behaviour from old rows or tests.

---

## Master Order (all remaining work)

Impact and effort: S = under one session slice, M = one session, L = several sessions.

| Order | ID | Status | Impact | Effort | Depends on | Task |
| --: | :-- | :-- | :-- | :-- | :-- | :-- |
| 12 | `PF2.4` | `OPEN` | High | M | F0.2 | Recurrence core: memoise rules, index exceptions, cheap occurrence copies |
| 13 | `PF2.6` | `OPEN` | Med | S | PF2.3 | Agenda controller: ignore irrelevant note changes |
| 14 | `PF2.5` | `OPEN` | Med-High | M | PF2.4 | Calendar views: lazy per-day expansion and no full rebuild for background events |
| 15 | `TM3.1` | `OPEN` | High | M | F0.1 | One shared tick service: wake, focus, clock/time-zone change, day rollover |
| 16 | `TM3.2` | `OPEN` | Med | S | TM3.1 | Re-evaluate 'ended' (fade) when an event ends |
| 17 | `TM3.3` | `OPEN` | Med-High | M | H1.1 | Overdue bucket in the Agenda (reminders disappear at midnight) |
| 18 | `TM3.4` | `OPEN` | Med | M | H1.5, TM3.1 | Missed-reminders digest after sleep or long closure |
| 19 | `TM3.5` | `OPEN` | Med-High | M | F0.2 | Time edge-case test pack (DST, zones, duplicates, moved occurrences, parsers) |
| 20 | `T2.4d` | `PARTIAL` | High | M | `T2 | Calendar/Agenda click navigation and right-click menus |
| 21 | `OW-06` | `OPEN` | High | S-M | T2.4d (rule change) | [bug] Month view: a click should select the day, not jump to Day view |
| 22 | `OW-01` | `OPEN` | High | S | none | [issue] Deleting a note-less reminder asks to 'remove this item from its source note' |
| 23 | `UI4.1` | `OPEN` | High | S | F0.1 | Agenda tab activation on click release, with modifiers and drag threshold |
| 24 | `UI4.2` | `OPEN` | Med-High | S | UI4.1 | Tab cycling must not open Notes |
| 25 | `UI4.3` | `OPEN` | Med | S | UI4.2 | Choose the bounce-back tab safely |
| 26 | `UI4.4` | `OPEN` | High | M | H1.1, F0.1 | Guard dragging into and out of the Agenda folder; report the real DOM parent |
| 27 | `UI4.5` | `OPEN` | Med | S-M | F0.1 | Reorder Agenda tabs through Zen's API (live verification) |
| 28 | `UI4.6` | `OPEN` | High | M | PF2.5 | Calendar must not cancel drags or lose scroll/focus on background updates |
| 29 | `UI4.7` | `OPEN` | Med | M | H1.2, F0.1 | Multi-window and data-integrity edge tests |
| 30 | `OW-04` | `OPEN` | High | M | none | [new] Limit the visible hour range in Week/Day (e.g. 08-20) with automatic extension |
| 31 | `OW-03` | `OPEN` | High | M-L | OW-04 | [change] Calendar size: fit to the pane by default (no scrollbar) plus a size slider; replaces Comfortable/Compact/Extra compact |
| 32 | `T2.4e` | `PARTIAL` | Med-High | S-M | — | Compact and extra-compact calendar density |
| 33 | `OW-09` | `OPEN` | High | M | OW-06 | [new] Tiny calendar becomes a date picker coloured by item count |
| 34 | `OW-05` | `OPEN` | Med-High | S | none | [new] 'Add to Calendar…' in the note right-click menu (All notes view) |
| 35 | `OW-02` | `OPEN` | High | M | OW-05 (shared composer entry) | [new] Drag a note onto the calendar to create a reminder at that day and time |
| 36 | `OW-07` | `OPEN` | Med-High | S | OW-05 | [new] '+' button in All notes: also create reminder / event |
| 37 | `OW-10` | `OPEN` | High | M | none | [change] 'Create calendar item': smaller calendar, both calendar and a better clock visible, optional analog clock |
| 38 | `OW-11` | `OPEN` | Med-High | S-M | none | [issue] Composer 'Inherit' settings must show what they currently resolve to |
| 39 | `OW-08` | `OPEN` | High | M-L | H1.5, PF2.2 | [change] Three-stage alerts: countdown and louder first stage, harder-to-miss later stages, centred final stage |
| 40 | `T2.4c` | `PARTIAL` | High | L | — | Week/day calendar and details (parent) |
| 41 | `T2.4c1` | `PARTIAL` | High | M | — | Week/day 24-hour grid, lanes and time shading |
| 42 | `T2.4c4` | `PARTIAL` | Med-High | M | — | Time-zone and DST correctness in time grid |
| 43 | `T2.5` | `PARTIAL` | Med-High | M | — | Drag, resize and create items in the calendar |
| 44 | `T2.5a` | `PARTIAL` | Med | S | — | Move timed events |
| 45 | `T2.5b` | `PARTIAL` | Med | S-M | — | Resize timed event start/end |
| 46 | `T2.5c` | `PARTIAL` | Med | S | — | Move timed and all-day reminders |
| 47 | `T2.5d` | `PARTIAL` | Med | S-M | — | Drag an empty time slot to create an event |
| 48 | `T2.6` | `OPEN` | Med | S-M | — | Big Picture popup for the calendar |
| 49 | `SB6.8` | `OPEN` | Med | S | F0.1 | Bind Agenda guards immediately; delay only the projection |
| 50 | `SB6.1` | `OPEN` | Med-High | M | H1.1, F0.1 | Keep Agenda tab labels, favicons and type icons stable (with T2.8b) |
| 51 | `T2.8b` | `OPEN` | Med | S | `T2 | Favicons and item-type icons on Zen Agenda pseudo-tabs |
| 52 | `T3.4` | `PARTIAL` | Med-High | S-M | — | Context menu on Notes & Agenda folders/pseudo-tabs in Zen tab bar |
| 53 | `SB6.2` | `OPEN` | Med | S | T3.4 | Agenda root folder right-click menu |
| 54 | `SB6.3` | `OPEN` | High | M | T3.4 | Run Agenda quick actions headlessly (no Notes sheet) |
| 55 | `T3.4a` | `OPEN` | High | M | `T2 | RSS-style floating hover preview cards for Notes & Agenda tabs in Zen sidebar |
| 56 | `T2.18` | `PARTIAL` | High | M | — | Right-click menus everywhere (consistent engine) |
| 57 | `T2.19` | `PARTIAL` | Med | S | — | Quick snooze on a reminder (+1 day / +3 days / next week) |
| 58 | `SB6.7` | `OPEN` | Med | S | UI4.7 | Items whose source note is in Trash |
| 59 | `SB6.4` | `OPEN` | Med | S | TM3.3 | Cap the number of Agenda tabs ('+N more') |
| 60 | `SB6.6` | `OPEN` | Low-Med | S | SB6.3 | Setting: what the X (close) button does on an Agenda tab |
| 61 | `SB6.5` | `OPEN` | Med | S-M | F0.1 | Agenda Doctor (diagnostics and repair) |
| 62 | `SB6.9` | `OPEN` | Low | S | TM3.1 | Agenda sidebar quiet hours and 'left' counts |
| 63 | `SB6.10` | `OPEN` | Med | M | PF2.3 | Incremental Agenda projection |
| 64 | `B3.3.50-6` | `PARTIAL` | — | — | — | Harden ZenSync & SessionStore isolation for Agenda and Notes pseudo-tabs |
| 65 | `ST7.3` | `OPEN` | Low-Med | S | none | Move calendar UI state out of notes metadata |
| 66 | `ST7.1` | `OPEN` | Med | M | F0.1 | Agenda in every workspace (or follow the active workspace) |
| 67 | `ST7.2` | `OPEN` | Med | M | H1.2, H1.3, PF2.1 | Reminder history compaction (or append-only segments) |
| 68 | `ST7.5` | `OPEN` | Low-Med | S-M | ST7.2 | Reminder history export, prune and inspect UI |
| 69 | `B3.3.32-7` | `PARTIAL` | Med-High | S | — | Protect Daily Notes and connect note-less reminders to an Agenda note |
| 70 | `T2.9` | `OPEN` | Med-High | M | `T2 | Daily-note lifecycle and archive policy inside Agenda |
| 71 | `T2.10` | `OPEN` | Med | M | `T2 | Work-free-day tint + selectable holiday calendars |
| 72 | `T2.11` | `OPEN` | Med | S-M | `T2 | Exclude folders from the Zen NOTES sidebar |
| 73 | `T2.11a` | `OPEN` | High | S-M | `T2 | Calendar-only notes (e.g. Birthdays) hidden from Zen NOTES |
| 74 | `T2.11b` | `OPEN` | High | L | Track 1–2 UI completion | Audit UI discoverability and rebuild the Notes demo so it showcases every feature |
| 75 | `ST7.4` | `OPEN` | Low-Med (long term) | L | ST7.1 | Render Agenda rows without real tabs (research) |
| 76 | `T2.13` | `OPEN` | Med | M | all Track 2 item model, recurrence, reminder and calendar UI work | ICS export/import and Google-sync groundwork (always last in Track 2) |
| 77 | `T3.1` | `OPEN` | High | S-M | — | Fix second panel startup initialization bug & settings font-scaling overlap |
| 78 | `T3.6a` | `OPEN` | High | S-M | — | Accessible color-palette contrast across themes |
| 79 | `T1.19` | `OPEN` | High | M-L | `T1 | Full ZIP backup & Obsidian Vault Import/Export converter |
| 80 | `T1.18` | `PARTIAL` | Med-High | S | — | Export syntax-mismatch warning dialog |
| 81 | `T3.2` | `OPEN` | Med-High | M | — | Multi-select notes & folders in tree view |
| 82 | `T3.11` | `OPEN` | Med | S | — | Colorful Folders live checks and polish |
| 83 | `T3.3` | `OPEN` | Med | M | — | Drag-and-drop note tabs within Zen sidebar |
| 84 | `T3.5` | `OPEN` | Med | S | — | Split Callout toolbar button (quick insert + type/fold picker) |
| 85 | `T3.8` | `OPEN` | Med | M | — | Split View as an equal-sized companion window/pane |
| 86 | `T3.9` | `OPEN` | Med | L | — | Tab bar widgets in the free space at the bottom of the Zen sidebar |
| 87 | `T3.10` | `OPEN` | Med | S-M | — | Custom keyboard shortcut for opening a particular Zentral app or panel |
| 88 | `T4.1` | `OPEN` | High | S | — | Owner's comprehensive verification note (`Markdown & Extended Syntax Feature Showcase`) |
| 89 | `T4.2` | `OPEN` | Med-High | M | — | Performance audit & active timer/listener registry table |
| 90 | `T4.3` | `OPEN` | Med | M-L | — | Modularize `ZentralNotes.uc.js` into maintainable sub-modules |
| 91 | `T4.4` | `OPEN` | Low | S | — | Dead code removal (`stretched()`, legacy `quad` helpers) |
| 92 | `T4.5` | `OPEN` | Low | S | — | Standalone modules version alignment & release hygiene |

---

## Phase 0 — Safety net: tests and measurement first

_Nothing below can be proven without these. They change no behaviour._


---

## Phase 1 — Stop loops and data loss

_Defects that can churn the sidebar forever, lose Done/Dismiss state or spam alerts. Highest risk per line of code._


---

## Phase 2 — Remove the big freezes (performance)

_Scheduler, projection and recurrence costs measured in `F0.2`. `PF2.1` before `PF2.2`; `PF2.4` before `PF2.5`._

#### `PF2.4` — Recurrence core: memoise rules, index exceptions, cheap occurrence copies
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** F0.2 · **Source:** Audit R2 P3

**Problem:** `expandItem` (`ZentralNotesCalendar.js` ~line 1749) re-parses the rule on every call (`it.recurrence.map(parseRule)`), finds exceptions with a linear `exceptions.find` per candidate, and deep-copies each occurrence with `JSON.parse(JSON.stringify(it))`. Measured: 500 daily items, 90 days: 0.58 s; 2000 items: 2.5 s (UI thread, synchronous in `renderCalendar`).

**Plan (do in this order):**
1. Memoise `parseRule` by rule string (small LRU).
2. Build a `Map` of `scope:'this'` exceptions keyed by recurrence id once per `expandItem` call.
3. Replace the deep copy by a shallow copy that clones only `x`, `start`, `end` (and arrays that are mutated); freeze nothing else.
4. Keep occurrence ids and `x.series`/`x.recurrenceId` semantics byte-identical.

**Tests / done when:** Property test: new expansion equals old expansion for random rules/exceptions over DST boundaries; F0.2 budgets.

#### `PF2.6` — Agenda controller: ignore irrelevant note changes
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** PF2.3 · **Source:** Audit R1 B12

**Problem:** `agendaNoteUnsub = store.on(...)` calls `agendaController.schedule()` for every note `change`/`tree`/`remove`/`reset`, i.e. on autosaves of notes that have nothing to do with the Agenda. The Agenda only depends on calendar items, linked note titles and trashed state.

**Plan (do in this order):**
1. Schedule only when the changed note has calendar items (lookup by `noteId` in the item store), when a title changed for a linked note, or on trash/restore/remove of a linked note.
2. Keep `reset` and `tree` unconditional.

**Tests / done when:** Note edits without calendar items do not call `schedule` (spy).

#### `PF2.5` — Calendar views: lazy per-day expansion and no full rebuild for background events
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** M · **Depends on:** PF2.4 · **Source:** Audit R2 P3/E2

**Problem:** `renderCalendar()` clears `calendarContent` with `replaceChildren()` and rebuilds from `calendarFilteredItems()` on every change; Agenda view expands 90 days up front.

**Plan (do in this order):**
1. Expand only the visible range plus one page of lookahead; extend on scroll.
2. For history/store events that touch a few items, patch the affected nodes instead of rebuilding (keep a `data-item-key` map).
3. Keep rebuild for view/cursor/density/filter changes.

**Tests / done when:** UI regression for Week/Day: scroll offset, hover card and focus survive a background history event.

---

## Phase 3 — Time correctness

_Stale 'Today', late alerts after sleep, overdue and missed reminders. Builds one shared tick service first._

#### `TM3.1` — One shared tick service: wake, focus, clock/time-zone change, day rollover
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** F0.1 · **Source:** Audit R1 B11 + R2 R4/E7 + proposal S2

**Problem:** No code path handles system sleep, clock changes or time-zone changes (no `wake_notification`, `visibilitychange` or focus date check exists). Agenda boundary timers and the reminder timer are one-shot `setTimeout`s; after suspend they can fire late, so Today/Tomorrow labels stay stale and due reminders alert late (or not until another event). Three separate timer owners exist (Agenda controller, reminder scheduler, alert stack).

**Plan (do in this order):**
1. Create one small service: `nextDue` priority queue, `onWake` (Services.obs `wake_notification`), window `focus`/`visibilitychange`, periodic cheap drift check (compare `Date.now()` with last tick; a jump of more than 2 minutes means sleep or clock change).
2. On wake/jump/time-zone change (`Intl.DateTimeFormat().resolvedOptions().timeZone` changed): recompute day keys, re-run Agenda `runNow`, scheduler `pass`, calendar `renderCalendar`.
3. Emit a `dayRollover` event once when the local date changes.
4. Move Agenda boundary timer and scheduler timer onto the service; keep their public behaviour.

**Tests / done when:** Fake clock tests: sleep jump over a reminder time alerts once on wake; day rollover updates Today; time-zone change re-labels buckets.

#### `TM3.2` — Re-evaluate 'ended' (fade) when an event ends
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** TM3.1 · **Source:** Audit R1 A2 (confirmed)

**Problem:** `ended` is computed once per projection run; `nextAgendaVisibilityBoundary` only returns local midnight, so an event ending at 11:00 is not faded until some other event triggers a run.

**Plan (do in this order):**
1. In `nextAgendaVisibilityBoundary` also return the earliest `end` greater than now among visible timed events of today (and, if the owner wants reminders to fade, the start time).
2. Respect the per-item window (`range.to`).

**Tests / done when:** Fake clock: event 10:00-11:00 flips to ended at 11:00 without any store event.

#### `TM3.3` — Overdue bucket in the Agenda (reminders disappear at midnight)
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** M · **Depends on:** H1.1 · **Source:** Audit R1 A3 (confirmed)

**Problem:** A reminder from yesterday that is neither Done nor Dismissed is in no bucket (the projection only covers today and later; `tailDays` defaults to 0), so unfinished reminders silently vanish from the sidebar at midnight.

**Plan (do in this order):**
1. Optional setting 'Show overdue' (default ON): an `Overdue` day node above Today with a cap (default 10, then '+N more' opening Day view), listing pending reminders whose start is before today and within N days back (default 7).
2. Done/Dismiss remove them; Snooze moves them. Events are never listed as overdue.
3. Sidebar label and count pill follow the existing day-node rules; hidden when empty.

**Tests / done when:** Projection tests for overdue ordering/cap/window; DOM test for the extra root child (F0.1).

#### `TM3.4` — Missed-reminders digest after sleep or long closure
**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Depends on:** H1.5, TM3.1 · **Source:** Audit R2 R3

**Problem:** The scheduler scans from `now - 2 days`; anything older never alerts, and there is no list of reminders that were missed while the browser was closed or asleep.

**Plan (do in this order):**
1. On startup and wake, collect pending reminders whose last stage time passed while away and are not Done/Dismissed.
2. Show ONE digest banner ('3 reminders you missed') with Open list / Snooze all / Dismiss all, instead of individual stage alerts (uses H1.5 coalescing).
3. Setting for the look-back window (default 7 days, max 31).

**Tests / done when:** Fake clock: app closed across three reminders: one digest, no per-stage banners.

#### `TM3.5` — Time edge-case test pack (DST, zones, duplicates, moved occurrences, parsers)
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** M · **Depends on:** F0.2 · **Source:** Audit R1 C list

**Problem:** Edge cases listed in the audit but not covered by tests.

**Plan (do in this order):**
1. DST: event 02:00-03:00 on a spring-forward day, 25-hour fall-back day, item with its own IANA zone different from local: check day bucket, Agenda label and `ended`.
2. Two identical reminders at the same minute: identity after deleting one.
3. Done/Dismiss on one occurrence of a recurring series while it is projected.
4. `dd-mm-yyyy` and ambiguous dates (`03-04-2026`) under each date-format setting (also the owner's old T2.12 observation).
5. 31-day Agenda window with 5000 items (production call shape).
6. A 'this occurrence' move of several weeks, viewed in each month it touches (`recurrenceSearchMargins`).

**Tests / done when:** New `tests/notes-time-edgecases.test.cjs`.

---

## Phase 4 — Interaction safety and owner bugs

_Click/drag/keyboard behaviour in the Zen sidebar and Month view, plus the owner's bug reports._

#### `T2.4d` — Calendar/Agenda click navigation and right-click menus
**Status:** `PARTIAL` · **Impact:** High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: Month cell and keyboard Day navigation, linked-item source navigation, keyboard/right-click day and item menus, date note and timed/all-day creation, previous/next day, plus Agenda sidebar item actions. DONE also: inherited-policy-aware per-item show/hide shared by Calendar and Agenda, with recurring changes explicitly applying to the series; legacy note reminders are read-only and not stored in the Agenda projection. LEFT: live Zen navigation/menu checks.

**Full specification (original row):** **OPEN.** Depends on `T2.4b` and the item editor (`T2.3f`). Left-clicking a day in Month switches to Day view focused on that exact date. Left-clicking a linked reminder/event in Calendar or Agenda opens its source note at the saved heading (or its calendar note when explicitly chosen). **This must work for every ordinary source note, not only when a Daily/date note is assigned; resolve the item's `noteId` directly and fall back gracefully if the heading is missing.** Right-click on a calendar day offers relevant actions: switch to Day, create timed/all-day event, create timed/all-day reminder, open/create date note and date navigation. Right-click on an item in Calendar and Agenda offers context-aware Open source note, Edit, reschedule/move, show details, show/hide in Agenda, duplicate and remove/delete; Done/Dismiss actions appear when `T2.7a` exists. Agenda linked-item RMB must expose the same source-note and edit actions. Keyboard/context-menu parity and no action on cancelled menus are required.

**Note (2026-11-14):** the rule 'left-click on a Month day opens Day view' is REVERSED by `OW-06`. Implement `OW-06` instead of that part.

#### `OW-06` — [bug] Month view: a click should select the day, not jump to Day view
**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Depends on:** T2.4d (rule change) · **Source:** Owner 2026-11-14 (reverses the 2026-11-11 rule)

**Problem:** Owner: in the normal full Month view a click on a day always switches to Day view; going back to Month shows the right day selected. He wants the click to select the day and show its items (as before), without leaving Month. This reverses the Track 2 rule 'left-clicking a day in Month switches to Day view' (also `T2.4d`, `B3.3.32-8` 'Month date badge opens Day view').

**Plan (do in this order):**
1. Single click / Enter on a day cell: select it and show its complete list (existing selected-day list + all-day strip) in Month.
2. Switching to Day view stays available through: the date badge/number click, double-click, context menu 'Open Day view', keyboard Shift+Enter, and the Agenda day folder action.
3. Update the track rule text and the `notes-calendar-views` and `notes-p4-ui` expectations; keep stored selected day semantics.
4. Small-calendar picker mode (`OW-09`) uses the same select-only behaviour.

**Tests / done when:** Month click does not change `store.meta.calendarView`; selection persists; Day opens only through the listed actions.

#### `OW-01` — [issue] Deleting a note-less reminder asks to 'remove this item from its source note'
**Status:** `OPEN` · **Impact:** High · **Effort:** S · **Depends on:** none · **Source:** Owner 2026-11-14

**Problem:** Owner has a reminder created without a note, yet Delete is disabled/rephrased with the reason 'Remove this item from its source note instead of deleting only its calendar copy'. `calendarItemMenuModel` (`ZentralNotesCalendar.js`) enables `delete` only when `x.src` is `manual`. Likely cause (to verify): `store.mirrorItemToAgendaNote` / `backfillAgendaLinks` (B3.3.32-7) mirror note-less items into a `## Agenda` `%%calendar%%` line of the date note and may change `x.src`/`x.noteId`, so the item stops counting as manual although the user never wrote a note.

**Plan (do in this order):**
1. Reproduce: create a note-less reminder, wait for the mirror, open its menu; log `x.src`, `x.noteId`, `mirroredItem(item)`.
2. Treat mirrored items as manual for deletion: delete removes the calendar item AND its mirrored line (marker-preserving, rule 3a), with one confirmation naming both.
3. Keep the 'remove from source note' rule only for items that really come from user-written note text.
4. Label the action by what it does ('Delete reminder' vs 'Delete reminder and its Agenda line').

**Tests / done when:** Calendar-menu tests for manual, mirrored and note-sourced items; delete leaves no orphan `%%calendar%%` line.

#### `UI4.1` — Agenda tab activation on click release, with modifiers and drag threshold
**Status:** `OPEN` · **Impact:** High · **Effort:** S · **Depends on:** F0.1 · **Source:** Audit R1 B1

**Problem:** `onAgendaMouse` (capture `mousedown`) calls `preventDefault`/`stopImmediatePropagation` and opens the note immediately. You cannot cancel by moving away, Ctrl/Shift-click is swallowed and drags that start on an Agenda tab are blocked.

**Plan (do in this order):**
1. Activate on `click` (or `mouseup` within 4 px of the press); ignore events with Ctrl/Shift/Alt/Meta unless a later feature maps them; keep middle-click inert.
2. Keep keyboard activation (Enter/Space through `TabSelect`).

**Tests / done when:** DOM harness: press-move-release elsewhere does not open; plain click opens once.

#### `UI4.2` — Tab cycling must not open Notes
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** S · **Depends on:** UI4.1 · **Source:** Audit R1 B2

**Problem:** `onAgendaSelect` bounces the selection back but still calls `activateAgendaTab`, so Ctrl+Tab, Alt+digit, tab search or Ctrl+PageDown through the Pinned area pops the Notes panel.

**Plan (do in this order):**
1. Set a short-lived `agendaPointerIntent` flag in the click/keyboard handler on the tab itself; in `onAgendaSelect` bounce silently unless that flag is set.

**Tests / done when:** TabSelect without a prior pointer intent: selection returns, `activateAgendaTab` not called.

#### `UI4.3` — Choose the bounce-back tab safely
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** UI4.2 · **Source:** Audit R1 B3

**Problem:** When `previousTab` is missing the bounce picks the first non-hidden non-Agenda tab: possibly an Essential or a tab from another workspace (workspace switch), or a discarded tab that then reloads. A Notes pseudo-tab can also be the previous tab.

**Plan (do in this order):**
1. Prefer, in order: previous tab if connected, not discarded, not a pseudo-tab, same workspace; last focused content tab of the active workspace; any loaded tab of the active workspace.
2. Never select a tab of another workspace.

**Tests / done when:** Harness with two workspaces and a discarded tab.

#### `UI4.4` — Guard dragging into and out of the Agenda folder; report the real DOM parent
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** H1.1, F0.1 · **Source:** Audit R1 B4

**Problem:** `agendaApi.list()` reports an item's parent from the `bgalazka-notes-agenda-day` attribute, not from where the tab really is. A dragged Agenda tab leaves the root and is deleted and recreated (flicker). A user tab dropped into a day folder makes `agendaRetireFolder` 'release' the folder, which then keeps a stale label such as 'Today'.

**Plan (do in this order):**
1. Capture `dragover`/`drop` on the Agenda root and day folders: reject drops of foreign tabs/folders; reject drags of Agenda tabs out of the root (or turn the drag into a no-op).
2. If a foreign item is already inside (restored session), move it out to the pinned root instead of releasing the folder.
3. Safeguard: never touch tabs/folders that are not ours (same rule as `T3.4`).

**Tests / done when:** Harness: foreign tab dropped in; Agenda tab dragged out; both end with unchanged user content.

#### `UI4.5` — Reorder Agenda tabs through Zen's API (live verification)
**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M · **Depends on:** F0.1 · **Source:** Audit R1 B6

**Problem:** `agendaApi.reorder` uses raw `host.insertBefore`, bypassing `gBrowser.moveTabTo` and Zen's pinned-tab manager, so Zen's internal order can drift from the DOM; each move also raises `TabMove`.

**Plan (do in this order):**
1. Use the same move helper as `zenPlace`/`zenNest` where available; fall back to `insertBefore` only if the API is missing.
2. Suppress own `TabMove` events (see `H1.1`).

**Tests / done when:** Harness: reorder performs only moves through the helper; live check on a disposable profile.

#### `UI4.6` — Calendar must not cancel drags or lose scroll/focus on background updates
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** PF2.5 · **Source:** Audit R2 E1/E2

**Problem:** `renderCalendar()` starts with `cancelCalendarDrag()` and rebuilds everything. History events (an alert firing, a cross-window write) re-render the calendar, so an alert that appears while you drag an event silently cancels the move. Week/Day scroll position, open hover card, keyboard focus and an open context menu may also be lost.

**Plan (do in this order):**
1. Defer background-triggered renders while a drag, composer or menu is active; apply once on release.
2. Preserve scroll offset (store `scrollTop` of the time grid) and re-focus the same `data-item-key` after a render.

**Tests / done when:** UI regression: history event during a pointer drag does not cancel it; scroll offset unchanged after a render.

#### `UI4.7` — Multi-window and data-integrity edge tests
**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Depends on:** H1.2, F0.1 · **Source:** Audit R2 E4-E8

**Problem:** Untested situations from the audit.

**Plan (do in this order):**
1. Done in window A and edit in window B of the same item (last-write-wins, `lwwPick`): loser is notified, not silent.
2. Two Zen windows: only one shows an alert banner (`claimAlert`); closing the window that alerted keeps pending stages in the other.
3. Category deleted or renamed: Agenda windows, colours and alerts fall back without `undefined` policies.
4. Source note moved to Trash then restored: no duplicate items and no duplicate `## Agenda` mirror lines (`mirrorItemToAgendaNote`).
5. Items whose note is trashed: either hidden from the Agenda or shown as 'source note in Trash' with Restore (see `SB6.7`).

**Tests / done when:** New `tests/notes-multiwindow.test.cjs`.

---

## Phase 5 — Calendar UX (owner requests 2026-11-14 and unfinished calendar work)

_Visible hours and sizing first (they change geometry every later feature uses), then entry points, composer, alerts, then unfinished drag/resize and Big Picture._

#### `OW-04` — [new] Limit the visible hour range in Week/Day (e.g. 08-20) with automatic extension
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** none · **Source:** Owner 2026-11-14

**Problem:** Week/Day always show the full 24-hour grid, wasting space. Owner wants a configurable visible range such as 8-20 that automatically widens when an event/reminder exists outside it. Month has no hour axis, so this applies to Week/Day (assumption; ask the owner if Month needs anything such as hiding out-of-range items in cell lists).

**Plan (do in this order):**
1. Pure function `visibleHourRange(settingRange, itemsInView, zone)` returning `{startMin,endMin,extendedTop,extendedBottom}`; the extension covers the union of the setting and every timed item/draft in the visible days (all-day strip unaffected; items crossing midnight clip to the day).
2. Settings: enable, start hour, end hour (default off = 0-24); quick toggle in the calendar toolbar. Work hours (`workRange`) stay a separate setting but can be offered as a preset.
3. Show extended parts with a subtle marker and a hint ('extended: 06:00 item'); no auto-shrink while a draft/drag is active.
4. Shading, free-slot finder, now-line and drag geometry use the displayed range, not 0-24 (`layoutDay`, `calendarMovePlacement`, `calendarResizePlacement` take the range).

**Tests / done when:** Pure tests for range union and DST days; UI tests for extension, drag inside a limited grid, now-line outside the range.

#### `OW-03` — [change] Calendar size: fit to the pane by default (no scrollbar) plus a size slider; replaces Comfortable/Compact/Extra compact
**Status:** `OPEN` · **Impact:** High · **Effort:** M-L · **Depends on:** OW-04 · **Source:** Owner 2026-11-14; supersedes T2.4e

**Problem:** Current density has three fixed steps (`CALENDAR_DENSITIES`, `calendarDensityHourHeight`). Owner wants the default to be 'as tall as fits without a scrollbar' and a slider to make it smaller or bigger.

**Plan (do in this order):**
1. New setting `calendarScale`: `auto` (default) or a number; `auto` computes hour height = available height / visible hours (from `OW-04`) with a readable minimum (below it a scrollbar appears or labels thin out); Month rows divide the pane height by the number of week rows.
2. Slider in the calendar toolbar/menu with reset-to-auto; persist per view type.
3. Migration: stored `comfortable`/`compact`/`extra-compact` map to fixed scales; keep `cleanCalendarDensity` readable for old data and remove the three-step selector UI.
4. Recompute on pane resize (ResizeObserver already used for split/compact) without re-rendering everything (`PF2.5`).

**Tests / done when:** Pure tests for `fitHourHeight`; UI: auto mode has no vertical scrollbar at several heights; slider persists; migration test.

#### `T2.4e` — Compact and extra-compact calendar density
**Status:** `PARTIAL` · **Impact:** Med-High · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: persisted Comfortable / Compact / Extra compact selector across Month, Next days, Agenda and Week/Day; timeline uses the selected scale for items, grid and shading, and narrow Month retains its list fallback. LEFT: live Zen readability, hit-target and layout validation.

**Full specification (original row):** **PARTIAL.** DONE: persisted density selector, progressively reduced spacing and labels, scaled Week/Day timelines, and preserved narrow-panel Month fallback and menu/keyboard behavior. LEFT: live Zen readability, hit-target and layout validation.

**Note (2026-11-14):** the three-step density selector is replaced by `OW-03` (fit-to-pane default + size slider). Do only what `OW-03` does not cover (live readability checks); keep stored density values readable for migration.

#### `OW-09` — [new] Tiny calendar becomes a date picker coloured by item count
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** OW-06 · **Source:** Owner 2026-11-14

**Problem:** When the calendar pane is too small, today's list fallback still shows items. Owner wants a smaller version that only selects dates, shows no items inside the day cells, and colours each day according to the items inside.

**Plan (do in this order):**
1. Add a size mode `picker` (width and/or height below a threshold, also a manual toggle): month grid with date numbers only.
2. Day colour: intensity by item count (steps 0/1/2-3/4+) and an optional tint from the dominant category colour; legend in a tooltip; accessible name includes the count.
3. Clicking a day selects it and shows the selected-day list below (or opens the Day view when there is no room); keyboard arrows navigate.
4. Thresholds and the colouring mode are settings; must respect `OW-06` select-only click.

**Tests / done when:** Pure `dayHeat(items, day)`; UI at 3 widths: cell content, colours, selection.

#### `OW-05` — [new] 'Add to Calendar…' in the note right-click menu (All notes view)
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** S · **Depends on:** none · **Source:** Owner 2026-11-14

**Problem:** No way to attach a reminder/event to a note from the tree's right-click menu. Owner links this with `OW-02`.

**Plan (do in this order):**
1. Add 'Add to Calendar…' to the shared note menu model (`T2.18` menu engine): opens the composer prefilled with the note (title, noteId), defaulting to the selected calendar day or today.
2. Same code path as `OW-02`: `composeFromNote(noteId, when?)`.
3. Disabled for trashed notes with the reason shown.

**Tests / done when:** Menu model test; composer receives the note link.

#### `OW-02` — [new] Drag a note onto the calendar to create a reminder at that day and time
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** OW-05 (shared composer entry) · **Source:** Owner 2026-11-14

**Problem:** Dragging a note from the All notes tree onto the calendar currently does nothing. Owner wants it to open 'create reminder' for the dropped day/time.

**Plan (do in this order):**
1. Define a note drag payload (`application/x-zentral-note-id`) in the tree; accept it on Month cells, Week/Day time slots, the all-day strip and the picker mode (`OW-09`).
2. On drop open the item composer (`T2.3f`) prefilled: linked note, summary = note title, date from the target, time from the slot (snapped with the snap setting), kind reminder by default with an event/reminder switch; all-day on Month cells.
3. Show a drop highlight with the computed date/time while dragging; Escape cancels; dropping several selected notes (`T3.2`) is out of scope until multi-select exists.
4. Never mutate the note body unless the user confirms the composer (mirror rules apply).

**Tests / done when:** Fake drag events: slot time computation, composer prefill, cancel leaves store unchanged.

#### `OW-07` — [new] '+' button in All notes: also create reminder / event
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** S · **Depends on:** OW-05 · **Source:** Owner 2026-11-14

**Problem:** The '+' icon in All notes only creates notes/folders.

**Plan (do in this order):**
1. Turn '+' into a small menu: New note, New folder, New reminder, New event (and Date note when Agenda is off).
2. Reminder/event open the composer defaulted to the selected calendar day; remember the last choice for a one-click default.

**Tests / done when:** UI test for the menu entries and composer defaults.

#### `OW-10` — [change] 'Create calendar item': smaller calendar, both calendar and a better clock visible, optional analog clock
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** none · **Source:** Owner 2026-11-14

**Problem:** In the composer the date picker is large and the clock is just a list of hours and minutes. Owner wants calendar and clock visible together, the calendar smaller, a clock that works better, possibly with an analog face.

**Plan (do in this order):**
1. Layout: compact month picker (smaller cells) beside/above the clock without scrolling in the default composer size.
2. Clock: keep typed input; add an analog face with a draggable/clickable hour hand then minute hand, AM/PM or 24-hour per locale, minute step follows the snap setting, wheel and arrow keys supported, accessible (`role=slider`).
3. Reuse the same Clock for event start/end and snooze custom time (`T2.12b1`).
4. Optional toggle 'Analog / digital / both'.

**Tests / done when:** Pure tests for angle<->time conversion and snapping; UI tests for hour then minute selection and keyboard.

#### `OW-11` — [issue] Composer 'Inherit' settings must show what they currently resolve to
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** S-M · **Depends on:** none · **Source:** Owner 2026-11-14

**Problem:** In 'Create calendar item' the 'Inherit' choices (agenda window lead/tail/enabled, colour, category defaults, alert/notify settings) do not say what value inheriting gives.

**Plan (do in this order):**
1. For every inheritable control compute the resolved value and its source layer with the existing resolvers (`resolveAgendaWindow`: item > note > category > global; colour inheritance `T2.3g`; category notify defaults).
2. Render 'Inherit (3 days, from category Work)' / 'Inherit (note colour)' etc.; update live when category or note changes in the composer.
3. Add a pure `describeInheritance(kind, item, layers)` returning `{value, source}`.

**Tests / done when:** Pure tests per setting; UI test that changing category updates the hint.

#### `OW-08` — [change] Three-stage alerts: countdown and louder first stage, harder-to-miss later stages, centred final stage
**Status:** `OPEN` · **Impact:** High · **Effort:** M-L · **Depends on:** H1.5, PF2.2 · **Source:** Owner 2026-11-14

**Problem:** Owner: the first alert is fine and may show a slight countdown to the due time and be a bit more noticeable/louder; the second and especially the third are easy to miss although their purpose is to be noticed; the third should appear in the middle of the screen. Existing: alert stack (`B3.3.50-4`, DONE), per-stage sounds and quiet hours (`T2.7c`, DONE).

**Plan (do in this order):**
1. Stage 1 (pre): live countdown chip to the due time, slightly stronger sound default, still non-modal.
2. Stage 2 (due): larger card, persistent until acted on, pulse/colour accent (respect `prefers-reduced-motion`), louder default sound.
3. Stage 3 (followup): centred overlay in the active window (scrim, large buttons Done / Snooze / Open note / Dismiss), keyboard focus on the primary action, Escape = Dismiss without marking Done; only one window shows it (`claimAlert`).
4. Keep quiet-hours rules per stage; keep 'one alert per stage' and the coalescing from `H1.5`; stack limit with a '+N more' chip.
5. Settings: per-stage visibility style (corner / large / centred) so the owner can tune it.

**Tests / done when:** Alert-stack UI tests for each stage render, countdown tick, centred position, reduced motion, cross-window single display.

#### `T2.4c` — Week/day calendar and details (parent)
**Status:** `PARTIAL` · **Impact:** High · **Effort:** L · **Source:** carried over from the previous roadmap (unchanged requirement)

**Full specification (original row):** **PARTIAL.** Week/day grid, overlap lanes, work-hour/busy shading, accessible hover/focus cards, recurrence-aware free-slot finder, week Markdown/print export and saved IANA timezone selection exist. DST-transition timeline presentation remains open in `T2.4c4`. Free-slot and time-grid drag creation open the full `T2.3f` composer; live drag validation remains under `T2.5d`. Automated calendar-core and Notes UI suites cover the implemented flows; live Zen/Sine verification remains manual.

**Note (2026-11-14):** visible-hour range and fit-to-pane scale are specified in `OW-04` and `OW-03`; implement those before DST presentation work in `T2.4c4`.

#### `T2.4c1` — Week/day 24-hour grid, lanes and time shading
**Status:** `PARTIAL` · **Impact:** High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Full specification (original row):** **PARTIAL.** Week view shows seven Monday-first day columns; Day view shows one day. Timed events are clipped into the visible day and laid out in side-by-side overlap lanes (no event hidden); all-day events and reminders have a separate strip; timed reminders are independent markers; configured work hours shade off-hours and merged busy ranges shade occupied time. Recurrences expand into the visible range. The saved IANA display zone drives day columns, labels and positioning; DST days use zoned elapsed bounds but the display still has 24 fixed wall-clock labels; skipped/repeated hours require further work in `T2.4c4`. UTC instants are unchanged and all-day items remain civil dates.

#### `T2.4c4` — Time-zone and DST correctness in time grid
**Status:** `PARTIAL` · **Impact:** Med-High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: display-zone selection and zoned day bounds. LEFT: real 23/25-hour timeline labels and ambiguous/skipped-hour rendering; live verification. Earlier claims about repeated/skipped labels were incorrect.

**Full specification (original row):** **PARTIAL.** Saved IANA display-zone selector drives Week/Day day columns, event clipping/positioning, grid labels, free-slot calculations and week export without changing stored UTC instants. Zoned day bounds handle 23-hour spring and 25-hour fall days; the UI currently draws 24 fixed wall-clock labels, so skipped/repeated hour display remains to be addressed; overnight and midnight-crossing events clip correctly; all-day items remain civil dates; recurring items retain their wall-clock time through DST. Core and view tests cover zone selection and cross-midnight behavior, but do not establish repeated/skipped labels in the UI. Live Firefox/Zen timezone UI verification remains manual.

#### `T2.5` — Drag, resize and create items in the calendar
**Status:** `PARTIAL` · **Impact:** Med-High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: non-recurring timed-event and timed/all-day reminder pointer moves with persisted selectable 5/10/15/30/60-minute timed snap, cancellation, guarded one-step undo, reminder history and source-note synchronization; timed-event edge resize by pointer or keyboard, drag-to-create with the event composer, and menu-driven recurring move scopes (`T2.5e`). LEFT: recurring pointer scope choice and live Zen checks.

**Full specification (original row):** **PARTIAL.** Non-recurring timed events and timed/all-day reminders support pointer movement; timed-event edges resize by pointer or keyboard. Gestures use scoped pointer capture/cancellation, source-note sync and revision/history-guarded one-step undo; timed moves and resizes use a persisted 5/10/15/30/60-minute snap. Empty-grid drag opens a prefilled event composer without saving until confirmation, and menu rescheduling remains the keyboard alternative. The composer supports four creation modes and recurrence scopes exist in the menu. **LEFT:** recurring pointer scope choice and live Zen verification.

#### `T2.5a` — Move timed events
**Status:** `PARTIAL` · **Impact:** Med · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Full specification (original row):** **PARTIAL.** DONE: Week/Day pointer drag of non-recurring timed events in the display zone, configurable snap, duration preservation, source-note synchronization, cancellation and revision/note-guarded one-step undo. The existing keyboard-accessible Change time menu is an alternative. LEFT: live Zen interaction/geometry verification.

#### `T2.5b` — Resize timed event start/end
**Status:** `PARTIAL` · **Impact:** Med · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Full specification (original row):** **PARTIAL.** DONE: independently accessible start/end handles for non-recurring timed events, pointer or Up/Down keyboard resizing with persisted snap and minimum duration, cancellation, guarded one-step undo and source-note sync. Reminders, all-day items and recurring occurrences receive no resize handles. LEFT: live Zen hit-target, keyboard, overlap and DST verification.

#### `T2.5c` — Move timed and all-day reminders
**Status:** `PARTIAL` · **Impact:** Med · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Full specification (original row):** **PARTIAL.** DONE: non-recurring timed reminders drag in Week/Day, all-day reminders move between Week day cells, cancellation and guarded one-step undo, source-note moved markers, and append-only reschedule history on move and undo. Protected history disables dragging; newer lifecycle records invalidate undo. LEFT: live Zen validation and recurring occurrence scopes.

#### `T2.5d` — Drag an empty time slot to create an event
**Status:** `PARTIAL` · **Impact:** Med · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Full specification (original row):** **PARTIAL.** DONE: empty Week/Day grid pointer selection with configurable snap, reverse/cross-day ranges, zoned DST resolution, cancellation and validated full event-composer prefill; storage changes only on confirmation. LEFT: live Zen pointer, scrolling, resize and compositor verification.

#### `T2.6` — Big Picture popup for the calendar
**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** **OPEN.** Source audit found no Big Picture popup or dedicated tests. LEFT: temporarily move the live calendar pane to a large viewport card, persist 70/80/90/95% sizes, and restore host, view, scroll and focus with Escape/outside/teardown cleanup.

---

## Phase 6 — Zen sidebar polish

_Labels, menus, quick actions, hover cards, caps and diagnostics for Agenda and Notes pseudo-tabs._

#### `SB6.8` — Bind Agenda guards immediately; delay only the projection
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** F0.1 · **Source:** Audit R1 B10

**Problem:** `bindAgenda` is only called from `agendaSoon` (6.5 s boot timer), so the click guard and restore listeners are missing for the first seconds; restored `about:blank` Agenda tabs can be clicked unguarded.

**Plan (do in this order):**
1. Call `bindAgenda(agendaEnabled())` at startup; keep the 6.5 s delay only for `runNow`.

**Tests / done when:** Harness: click before boot timer is guarded.

#### `SB6.1` — Keep Agenda tab labels, favicons and type icons stable (with T2.8b)
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** M · **Depends on:** H1.1, F0.1 · **Source:** Audit R1 B5

**Problem:** Notes tabs have a `TabAttrModified` handler for icons, Agenda tabs set `label`/`title` once. Zen or a session restore can reset an `about:blank#zn-agenda-...` tab label to its URL. Overlaps roadmap `T2.8b`.

**Plan (do in this order):**
1. Re-apply label/tooltip/icon in a loop-guarded `TabAttrModified` handler (like `zenIconBusy`).
2. Add the coloured category/note favicon and distinct event vs reminder badges (`T2.8b` spec).

**Tests / done when:** Harness: simulated label reset is repaired once, no loop.

#### `T2.8b` — Favicons and item-type icons on Zen Agenda pseudo-tabs
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Depends on `T2.8` (`DONE`), `B3.3.50-1`. Render colored note/category favicons (`noteFaviconUri` / category hex) and distinct event vs. reminder badges on Zen Agenda sidebar pseudo-tabs, persisting across `TabAttrModified` and session discards.

**Full specification (original row):** **OPEN.** Depends on `T2.8` (`DONE`), `B3.3.50-1`. Render colored note/category favicons (`noteFaviconUri` / category hex) and distinct event vs. reminder badges on Zen Agenda sidebar pseudo-tabs (`agendaApi.add` / `update`), persisting across `TabAttrModified` and session discards.

**Note:** implement together with `SB6.1` (same code path).

#### `T3.4` — Context menu on Notes & Agenda folders/pseudo-tabs in Zen tab bar
**Status:** `PARTIAL` · **Impact:** Med-High · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: _New note in this folder_, _New subfolder_, _Change color and icon_, _Export folder_ and guarded _Delete folder_ on Notes folders (dialogs check stable parent identity). DONE also: Agenda day folders expose _Create reminder_, _Create event_ and _Open Day view_; scoped native-folder filtering and teardown are in place. DONE also: Agenda pseudo-tab menus reuse the calendar action model, revalidate record/occurrence identity and respect disabled actions. LEFT: live-check all native menus, pseudo-tab actions and native-menu filtering; recurring snooze remains disabled until exception scopes are wired.

**Full specification (original row):** **PARTIAL.** Needs the folder uid and colour/icon fields that now exist (`store.folderUid`, `store.setFolderStyle`). DONE: _New note in this folder_ (Notes controller, `onFolderMenuShowing`) and colors/icon through the Colorful Folders menu. **LEFT:** (1) Notes folders: _Change Folder Color/Icon_ for a Notes-only install, _New subfolder_, _Export Folder_, _Delete_; (2) Agenda day folders (`bgalazka-notes-agenda-day`): _Create reminder for this day…_, _Create event for this day…_, _Open Day view_; (3) Agenda item pseudo-tabs (`bgalazka-notes-agenda-item`): hide irrelevant native tab items and expose _Open source note_, _Mark done_, _Dismiss_, _Snooze_, _Change time…_, _Edit details…_.

**Detailed proposal (owner-approved 2026-11-13, owner notes included):**

### 3. Clean Zen Sidebar Context Menus (`T3.4`) Without Native Clutter

Right-clicking an Agenda item tab or Agenda day folder currently exposes Firefox's native tab/folder actions (`Reload Tab`, `Mute Tab`, `Move Tab`, `Unload Tab`), which make no sense on virtual Agenda entries. Extending the existing `:root[zentral-notes-ctx="item"]` CSS hiding pattern to `tab[bgalazka-notes-agenda-item]` and `zen-folder[bgalazka-notes-agenda-day]` lets us present crisp, focused menus:

- **Agenda Item Tab RMB:** _Open source note_, _Mark done_, _Dismiss_, _Snooze (+1h / Tomorrow / Pick…)_, _Change time…_, _Edit details…_.
- **Agenda Day Folder RMB:** _Create reminder for this day…_, _Create event for this day…_, _Open Day view_.
- **Notes Folder RMB:** _New note in this folder_, _New subfolder…_, _Create reminder in this folder…_, _Folder color & icon…_, _Delete folder…_.

#### NOTE FROM OWNER:yes exacly what i meant but make sure it has safeguards so it wont affect normal folers and tabs

#### `SB6.2` — Agenda root folder right-click menu
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** T3.4 · **Source:** Audit R1 B8

**Problem:** CSS hides the native rename/delete/unpack items for the Agenda root and `onAgendaFolderMenuShowing` returns early for the root, so the menu is nearly empty.

**Plan (do in this order):**
1. Add 'Open calendar', 'Hide Agenda', 'Agenda settings', 'Refresh Agenda'; keep foreign items from other mods visible.

**Tests / done when:** Menu handler test with a fake menupopup.

#### `SB6.3` — Run Agenda quick actions headlessly (no Notes sheet)
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** T3.4 · **Source:** Audit R1 B9

**Problem:** Every Agenda item action (Done, Dismiss, Snooze, Change time) goes through `showNotes("")` then `runAgendaItemAction`, opening the Notes UI for a one-click triage.

**Plan (do in this order):**
1. Expose the lifecycle/snooze commands from the item and history stores without the sheet; show a small toast with Undo.
2. Keep the sheet only for 'Edit details…' and 'Change time…'.

**Tests / done when:** Done/Snooze from the sidebar menu write history and leave no sheet open.

#### `T3.4a` — RSS-style floating hover preview cards for Notes & Agenda tabs in Zen sidebar
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Depends on `T2.8`, `T3.4`. Port the `#bgalazka-rss-card` top-layer (`popover="manual"`) hover card pattern (`additional/rss/ZentralRssDisplay.uc.js`) to Zen sidebar Notes pseudo-tabs (title, folder, tags, snippet, due reminder, quick actions: _Open_, _New note_, _Trash_) and Agenda pseudo-tabs (item time, category, source note, calendar note, quick actions: _Open_, _Done_, _Snooze_, _Dismiss_) with hover/hide delays and pointer retargeting.

**Full specification (original row):** **OPEN.** Depends on `T2.8` (`DONE`), `T3.4`. Port the `#bgalazka-rss-card` top-layer (`popover="manual"`) hover card pattern (`additional/rss/ZentralRssDisplay.uc.js`) to Zen sidebar Notes pseudo-tabs and Agenda event/reminder pseudo-tabs, replacing the plain browser tooltip (`#tabbrowser-tab-tooltip`). Show note title, folder, tags, snippet, due reminder, and quick actions (_Open_, _New note_, _Trash_) for Notes tabs; show item time, category, source note, calendar note, and quick actions (_Open_, _Done_, _Snooze_, _Dismiss_) for Agenda tabs, with configurable hover/hide delays and pointer retargeting on dismiss/done.

**Detailed proposal (owner-approved 2026-11-13, owner notes included):**

### 1. Unified RSS-Style Top-Layer Hover Card Engine (`T3.4a`) for Notes & Agenda Sidebar Tabs

Your earlier request to mirror `additional/rss/ZentralRssDisplay.uc.js` (`#bgalazka-rss-card`) for Notes and Agenda pseudo-tabs was preserved only as an internal in-sheet tooltip (`T2.4c2`), leaving Zen sidebar hover interactions as plain native `title` tooltips. Rather than duplicating popover positioning, pointer-retarget, and hover/hide timers, extract a small shared helper (or mirror the exact `#bgalazka-rss-card` contract):

- **Top-Layer Popover (`popover="manual"`):** Re-call `showPopover()` on every target switch so the card always sits above Big Preview and Zentral panels without z-index wars, positioned to the left or right of `#navigator-toolbox` via `runtime.sidebarSafeBounds()`.
- **Notes Pseudo-Tab Card:** Displays note title, folder breadcrumb, tags/label pills, first 3–4 lines of body preview, and active reminder badge, with one-click buttons: **Open**, **New note in folder**, and **Trash** (routed through the `T2.3e` reminder-aware confirmation gate).
- **Agenda Pseudo-Tab Card:** Displays event/reminder title, formatted date + time range, category badge, source note link, calendar note text, and one-click buttons: **Open note**, **Done**, **Snooze (+1h / +1d)**, and **Dismiss** — using `nextAgendaItem` pointer-retargeting (just like RSS `dismiss(tab, true)`) so rapid triage in the sidebar moves smoothly to the next item without closing the card.

#### NOTE FROM OWNER: all standalone mods should still have all their standalone funcionality and work with eachother even without core mod but with rss and notes installed, obviusly haveing one engine that renders both would be great

#### `T2.18` — Right-click menus everywhere (consistent engine)
**Status:** `PARTIAL` · **Impact:** High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: shared menu engine on note/folder rows and calendar item controls. LEFT: attach to Zen Agenda day nodes (`T3.4`) and add the `T3.8` split-view action when implemented.

**Full specification (original row):** **PARTIAL in 3.3.28.** DONE: the shared menu engine normalizes legacy and `{ id, label, enabled, run }` actions, preserves disabled reasons, supports arrows/Enter/Escape/Home/End and submenu entry, and reliably dismisses on focus/anchor/window/sheet lifecycle changes. Note/folder rows and all calendar item controls (including Month marks) use one menu controller and `calendarItemMenuModel`; guarded actions include source-note/details, full `T2.3f` composer edit, reschedule, manual-only conversion/deletion, duplication, reminder lifecycle and quick snooze. ContextMenu/Shift+F10 parity and stale detached-row rejection are tested. **LEFT:** attach to Zen Agenda day nodes (`T3.4`), and add the `T3.8` split-view action when that feature exists.

#### `T2.19` — Quick snooze on a reminder (+1 day / +3 days / next week)
**Status:** `PARTIAL` · **Impact:** Med · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: calendar reminder buttons/marks and in-app calendar item context menus. LEFT: expose quick snooze on Zen Agenda sidebar item menus (`T3.4`) and wire recurring snooze to `T2.5e` exception scopes with occurrence-scoped history.

**Full specification (original row):** **PARTIAL in 3.3.31.** DONE: calendar reminder buttons/marks and all rendered calendar item context menus expose Snooze +1 day, +3 days, next Monday, and a custom date/time picker. Timed reminders preserve wall-clock time across DST; IANA item zones are honored for custom times; fall-back overlap chooses the earlier instant and spring-forward gaps advance to the first valid wall minute. All-day reminders remain date-only. Snooze appends a schedule-only history record and leaves source Markdown unchanged. **LEFT:** expose the same actions on Zen Agenda sidebar surfaces (`T3.4`), and wire recurring snooze to the new exception scopes with occurrence-scoped history; recurring Snooze remains visibly disabled meanwhile.

#### `SB6.7` — Items whose source note is in Trash
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** UI4.7 · **Source:** Audit R1 B13

**Problem:** `getItems` blanks the source title for a trashed note but still projects the item; clicking silently falls back to Day view.

**Plan (do in this order):**
1. Show 'source note in Trash' in the tooltip/card with a Restore action, or hide those items (setting).

**Tests / done when:** Projection + click tests.

#### `SB6.4` — Cap the number of Agenda tabs ('+N more')
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** TM3.3 · **Source:** Audit R2 P6

**Problem:** A 31-day window can create hundreds of real pinned `about:blank` tabs (each `addTab`/`pinTab` fires events and session work).

**Plan (do in this order):**
1. Setting 'Max items in sidebar' (default 40); beyond it show a single '+N more…' node that opens Day/Agenda view.
2. Distribute the cap by day, earliest first.

**Tests / done when:** Projection test for the cap and the extra node.

#### `SB6.6` — Setting: what the X (close) button does on an Agenda tab
**Status:** `OPEN` · **Impact:** Low-Med · **Effort:** S · **Depends on:** SB6.3 · **Source:** Proposal D5

**Problem:** Closing an Agenda tab makes it reappear (`TabClose` -> `schedule(400)`).

**Plan (do in this order):**
1. Options: hide this item today / dismiss / do nothing (default hide today).

**Tests / done when:** Harness test for each option.

#### `SB6.5` — Agenda Doctor (diagnostics and repair)
**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M · **Depends on:** F0.1 · **Source:** Proposal S1

**Problem:** Orphan seed tabs, duplicate keys, tabs outside the root, released folders and history state are only discoverable by reading the DOM.

**Plan (do in this order):**
1. Settings button 'Check Agenda': counts and lists orphan seeds, duplicate keys, foreign tabs, released folders, history size/write state; one-click repair for safe cases.

**Tests / done when:** Harness-based repair tests.

#### `SB6.9` — Agenda sidebar quiet hours and 'left' counts
**Status:** `OPEN` · **Impact:** Low · **Effort:** S · **Depends on:** TM3.1 · **Source:** Proposals S5/D3

**Problem:** Ideas from the audit.

**Plan (do in this order):**
1. Optional: collapse the Agenda folder outside work hours or when nothing is due within N hours.
2. Day pill and label show items 'left' (excludes ended and done).

**Tests / done when:** Projection tests.

#### `SB6.10` — Incremental Agenda projection
**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Depends on:** PF2.3 · **Source:** Proposal S3

**Problem:** Every run rebuilds all days.

**Plan (do in this order):**
1. Diff items by version and re-project only changed ids and affected days.

**Tests / done when:** Equality test with full projection on random edits.

#### `B3.3.50-6` — Harden ZenSync & SessionStore isolation for Agenda and Notes pseudo-tabs
**Status:** `PARTIAL` · **Impact:** — · **Effort:** — · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: stale restore cleanup and, when Zen’s `saveState` hook is available, non-mutating pseudo-tab/empty managed-folder and corresponding native-group filtering before sidebar/session and Sync projection, preserving foreign content across windows. LEFT: Firefox’s separate SessionStore snapshots, split-view metadata, previously synced records, and live Zen validation.

**Detailed proposal (owner-approved 2026-11-13, owner notes included):**

### 4. Zero-Leak ZenSync & SessionStore Shield (`B3.3.50-6`)

Zen's `gZenPinnedTabManager` and Firefox's `SessionStore` treat pinned tabs inside `zen-folder` elements as persistent workspace tabs that get serialized to `sessionstore.jsonlz4` and synced via ZenSync. To guarantee Notes and Agenda pseudo-tabs never pollute ZenSync or survive as broken `about:blank#zn-*` tabs:

- Mark every Notes and Agenda pseudo-tab with `skipSessionStore` (and `zen-empty-tab` / custom `bgalazka-ephemeral-tab` where safe) and intercept `gZenPinnedTabManager` / `SessionStore` tab-data hooks if exposed.
- Run an unconditional startup + `SSTabRestored` sweep for both `about:blank#zn-note:`/`#zn-new:` AND `about:blank#zn-agenda-` URLs/folders regardless of whether the corresponding preference is currently enabled or disabled.

---

## Phase 7 — Structural changes and the rest of Track 2

_Larger changes; do them with the Phase 0 harness in place. `T2.13` (ICS) is always last in Track 2._

#### `ST7.3` — Move calendar UI state out of notes metadata
**Status:** `OPEN` · **Impact:** Low-Med · **Effort:** S · **Depends on:** none · **Source:** Audit R2 P5

**Problem:** `setMeta` rewrites the whole meta file (folders, up to 5000 note agenda overrides) 600 ms after every view/cursor/density/filter change.

**Plan (do in this order):**
1. Store `calendarView`, `calendarCursor`, scale/range, filters in a small separate file or prefs; migrate once.

**Tests / done when:** Migration test; no meta write on Prev/Next.

#### `ST7.1` — Agenda in every workspace (or follow the active workspace)
**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Depends on:** F0.1 · **Source:** Audit R1 B7

**Problem:** The root is created with `workspaceId: gZenWorkspaces.activeWorkspace` and nothing handles workspace switches, so Agenda exists only where it was created.

**Plan (do in this order):**
1. Decide with the owner: one root per workspace or move the root on switch; handle Essentials and `agendaRootEl` lookups per workspace.
2. Teardown must remove every workspace's root.

**Tests / done when:** Harness with two workspaces.

#### `ST7.2` — Reminder history compaction (or append-only segments)
**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Depends on:** H1.2, H1.3, PF2.1 · **Source:** Audit R2 P4

**Problem:** `writeNow` rewrites every record on every change; each reminder adds up to 3 `alerted` records plus snooze/done/dismiss and nothing is pruned. 5000 records = about 1 MB per write, 20000 = about 4 MB; `claimAlert` re-reads and parses the whole file before each alert.

**Plan (do in this order):**
1. On load keep the latest transition per occurrence and `alerted` records only for the last 30 days (setting); archive the rest to `reminder-history.archive.jsonl`.
2. Or switch to monthly append-only JSONL segments; `claimAlert` reads only the current segment.

**Tests / done when:** Compaction preserves `stateFor` results; size test.

#### `ST7.5` — Reminder history export, prune and inspect UI
**Status:** `OPEN` · **Impact:** Low-Med · **Effort:** S-M · **Depends on:** ST7.2 · **Source:** Audit R1 S6

**Problem:** History is hard to inspect and trim.

**Plan (do in this order):**
1. List/filter/export/prune in the Notes settings next to ICS groundwork.

**Tests / done when:** UI test for prune with confirmation.

#### `B3.3.32-7` — Protect Daily Notes and connect note-less reminders to an Agenda note
**Status:** `PARTIAL` · **Impact:** Med-High · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: purge protects today/future Daily Notes and dates occupied by stored calendar items; `store.mirrorItemToAgendaNote` mirrors note-less non-recurring items into `## Agenda` `%%calendar%%` lines; `store.backfillAgendaLinks` mirrors at startup; date-note folder is labelled **Agenda**. LEFT: Date-Note archive lifecycle (`T2.9`).

#### `T2.9` — Daily-note lifecycle and archive policy inside Agenda
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Depends on `T2.2c` (`DONE`), `T2.8` (`DONE`). Migrate existing Daily notes/folder and preserve links. Past daily notes move to Trash the next day and stay 30 days, then live only in the 48-hour rolling backup; optional _always archive, never trash_ setting.

**Full specification (original row):** **OPEN.** Depends on `T2.2c`, `T2.8`. Migrate existing Daily notes/folder and preserve links. Past daily notes move to Trash the next day and stay 30 days, then live only in the 48-hour rolling backup. Setting _always archive, never trash_ keeps compressed copies in a separate archive folder. No duplicate Daily pseudo-folder beside Agenda.

#### `T2.10` — Work-free-day tint + selectable holiday calendars
**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Depends on `T2.1` (`DONE`), `T2.4b` (`DONE`). Greenish tint for weekends, public holidays and personal days off in month/week/list views with offline region rules (`holidaysFor(region, year)` / `isWorkFree(day, prefs)`).

**Full specification (original row):** **OPEN.** Depends on `T2.1`, `T2.4b`. Greenish tint for weekends, public holidays and personal days off in month/week/list views. Region selector (Polish, German, English, American, more later); offline fixed/Easter/weekday rules; pure `holidaysFor(region, year)` / `isWorkFree(day, prefs)` tested per year, tooltip names holiday, own extra days off. Decide weekend days per region (Sat/Sun or Fri/Sat).

#### `T2.11` — Exclude folders from the Zen NOTES sidebar
**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Depends on `T2.8` (`DONE`) and `T3.4`. Per-folder switch _Hide this folder from the Zen sidebar_ stored in `meta.json`; notes remain in All notes, search, calendar, and wiki links.

**Full specification (original row):** **OPEN.** Depends on shared Zen folder code in `T2.8` and `T3.4`. Per-folder switch _Hide this folder from the Zen sidebar_ in tree and Zen folder menus, stored in `meta.json`. Notes remain in All notes, search, calendar and wiki links; only tabs and folder disappear from Zen NOTES. Children inherit parent exclusion unless explicitly overridden.

#### `T2.11a` — Calendar-only notes (e.g. Birthdays) hidden from Zen NOTES
**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Depends on `T2.11`. Per-note _Calendar-only / Hide from Zen NOTES_ flag + Birthday note preset/category so birthday notes never clutter Zen NOTES tabs while remaining searchable and active on the calendar.

**Full specification (original row):** **OPEN.** Extend `T2.11` to a per-note _Calendar-only / Hide from Zen NOTES_ flag, available during note creation and later in note/folder menus. Such notes never become ordinary Zen NOTES tabs, but remain in All notes, search, backlinks, calendar and reminder navigation. Provide a practical Birthday note preset/category and allow any number of independent birthday reminders. Per-note exclusion must coexist with inherited folder exclusion and must not hide the note from the calendar.

#### `T2.11b` — Audit UI discoverability and rebuild the Notes demo so it showcases every feature
**Status:** `OPEN` · **Impact:** High · **Effort:** L · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Depends on Track 1–2 UI completion. Audit discoverability of all implemented functions, organize dropdown menus, and rebuild the built-in Notes DEMO notes.

**Full specification (original row):** **OPEN.** Audit whether every implemented function is discoverable through the UI; review which related controls belong together in dropdown menus and other navigation surfaces; rebuild the Notes DEMO so it accurately demonstrates all implemented functionality.

#### `ST7.4` — Render Agenda rows without real tabs (research)
**Status:** `OPEN` · **Impact:** Low-Med (long term) · **Effort:** L · **Depends on:** ST7.1 · **Source:** Audit R1 D6

**Problem:** Every item is a real pinned `about:blank` tab, which is the root of the session/sync/tab-cycling edge cases.

**Plan (do in this order):**
1. Investigate whether Zen's folder DOM can host non-tab rows with the same hover/drag behaviour; prototype behind a flag; abandon if Zen internals fight it.

**Tests / done when:** Prototype report.

#### `T2.13` — ICS export/import and Google-sync groundwork (always last in Track 2)
**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** **DO NOT BEGIN UNTIL EVERY OTHER TRACK 2 ROW IS `DONE`.** Local `.ics` export/import with stable `uid` / `etag` / `updated`, `syncState`, and RRULE serialization.

**Full specification (original row):** **OPEN — DO NOT BEGIN UNTIL EVERY OTHER T2 TASK IS COMPLETE.** Depends on all Track 2 item model, recurrence, reminder and calendar UI work. Export/import `.ics` locally (no network); stable `uid` / `etag` / `updated`, `syncState` per item, RRULE serialization and fixture coverage.

---

## Phase 8 — Independent tracks (may be interleaved from Phase 4 on, by impact)

_Not blocked by the calendar work. `T3.1` and `T3.6a` are High impact and may be pulled earlier._

#### `T3.1` — Fix second panel startup initialization bug & settings font-scaling overlap
**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Resolve race condition when opening a second Zen window/panel on startup; adjust Settings and Quick Settings CSS so controls never obscure each other at larger font sizes.

**Full specification (original row):** **OPEN.** Resolve race condition when opening a second Zen window/panel on startup so state listeners, styles, and note trees initialize deterministically without blank/unresponsive UI, change settings in notes app so they dont obscure eachother if user selected bigger font.

#### `T3.6a` — Accessible color-palette contrast across themes
**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Audit every saved/recommended/Zentral palette swatch and preview in light, dark, and system themes; derive readable foreground/outline/hover/selected/disabled colors from the actual surface and coordinate with `T2.3g`.

**Full specification (original row):** **OPEN.** Audit every saved/recommended/Zentral palette swatch and preview in light, dark and system themes. The Recommended and Zentral palettes currently produce unreadable text/labels in some modes (dark mode is the most reliable). Derive readable foreground, outline, hover, selected and disabled colors from the actual surface; ensure contrast without losing the palette hue. Add automated contrast fixtures for each preset/theme and a preview that uses the same resolved colors as the live UI. Coordinate with calendar/category and note-color inheritance (`T2.3g`) so colored reminders remain readable in Month, Next days, Agenda and Week/Day views.

#### `T1.19` — Full ZIP backup & Obsidian Vault Import/Export converter
**Status:** `OPEN` · **Impact:** High · **Effort:** M-L · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** **MUST RUN LAST IN TRACK 1.** Depends on `T1.18`. Bundle notes + `assets/` into ZIP; implement bidirectional Obsidian vault folder import/export mapping YAML front-matter, `[[Note#Heading\|alias]]`, `![[embeds]]`, callouts, and tags.

**Full specification (original row):** **OPEN — MUST RUN LAST IN TRACK 1.** Bundle notes + `assets/` into ZIP; implement bidirectional Obsidian vault folder import/export mapping YAML front-matter, `[[Note#Heading\|alias]]`, `![[embeds]]`, callouts, and tags in a single complete pass.

#### `T1.18` — Export syntax-mismatch warning dialog
**Status:** `PARTIAL` · **Impact:** Med-High · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: code-aware scan, portable conversion and raw/convert/cancel dialog for single, folder and ZIP Markdown exports covering ToC, blockquote and known closed `:::` container callouts (ambiguous or oversized recognized containers warn and stay raw), transclusions, hidden/calendar markers, extended tasks, highlights/underline, spoilers, subscript/superscript, inline footnotes and math-as-literal-code; warning and export use the same note snapshots; exported files retain note IDs, reminder metadata and foreign front matter; exact-length inline code spans, including spans across paragraph lines, link destinations and HTML attributes are protected from conversion; backtick runs are indexed to avoid quadratic lookahead. LEFT: audit other Zentral-only syntax and conversion fidelity; validate live exports and assets.

**Full specification (original row):** **PARTIAL.** DONE: code-aware scan, conservative portable conversion (including extended tasks, highlights, spoilers, subscript/superscript, inline footnotes and math-as-literal-code), snapshot-consistent raw/convert/cancel export dialogs, metadata-preserving Markdown files indexed exact-length multiline inline-code protection and safe link/attribute handling. LEFT: remaining Zentral syntax and conversion fidelity audit, per-note flavor/ignore semantics, live export/asset validation.

#### `T3.2` — Multi-select notes & folders in tree view
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Support `Shift+Click` (range) and `Ctrl/Cmd+Click` (toggle) in the note tree for batch move, batch category/tag assignment, batch export, and batch Trash.

**Full specification (original row):** **OPEN.** Support `Shift+Click` (range) and `Ctrl/Cmd+Click` (toggle) in the note tree for batch move, batch category/tag assignment, batch export, and batch move to Trash.

#### `T3.11` — Colorful Folders live checks and polish
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Live Zen checks for accent line, soft tint, hover rules, draggable editor at both sidebar edges, live preview in editor, drag-reorder saved quick themes, export/import quick themes, per-folder Simple/Detailed.

**Full specification (original row):** **OPEN.** Not run in a real Zen: accent line, soft tint and hover rules (written against `zen-folder > .tab-group-label-container / .tab-group-container`; if one still does nothing, take a DOM dump of a folder), draggable editor at both sidebar edges, Notes-first and Colorful-first startup, per-level defaults in Zen and All notes, collection spread. Polish: show a live preview in the editor, drag-reorder saved quick themes, export/import of quick themes, per-folder (not global) Simple/Detailed.

#### `T3.3` — Drag-and-drop note tabs within Zen sidebar
**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Hook into Zen sidebar drag events so reordering or dropping a note tab into a folder updates the underlying Notes tree order/parent folder smoothly.

**Full specification (original row):** **OPEN.** Hook into Zen sidebar drag events so reordering or dropping a note tab into a folder updates the underlying Notes tree order/parent folder smoothly.

#### `T3.5` — Split Callout toolbar button (quick insert + type/fold picker)
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Replace single callout button with a split button: primary click inserts default/last-used callout; dropdown chevron opens a picker for `[!note]`, `[!tip]`, `[!warning]`, `[!danger]`, `[!faq]-`, `[!bingo]`, `[!poll]`.

**Full specification (original row):** **OPEN.** Replace single callout button with a split button: primary click inserts the default/last-used callout; dropdown chevron opens a picker for `[!note]`, `[!tip]`, `[!warning]`, `[!danger]`, `[!faq]-`, `[!bingo]`, `[!poll]`.

#### `T3.8` — Split View as an equal-sized companion window/pane
**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Allow opening a second note side-by-side in an equal-dimension split pane (or synchronized companion panel) for reference reading and cross-note editing.

**Full specification (original row):** **OPEN.** Allow opening a second note side-by-side in an equal-dimension split pane (or synchronized companion panel) for reference reading and cross-note editing.

#### `T3.9` — Tab bar widgets in the free space at the bottom of the Zen sidebar
**Status:** `OPEN` · **Impact:** Med · **Effort:** L · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Standalone module (`additional/widgets`) with clock, weather, date, timer, quick note, RSS headline, battery/system load; pauses when hidden and avoids sidebar video player overlap.

**Full specification (original row):** **OPEN.** Own standalone module (`additional/widgets`, loaded by the Zentral loader or alone through Sine; no load race). First study how new-tab-page widgets work and mimic it. Must NOT interact with the sidebar video player (the free area shrinks when it plays: about 179x426 free, about 179x301 while a 16:9 player shows; width and height vary, widgets must not assume a ratio) and must always leave room for tabs, folders, Essentials and other Zen elements (settings: max share of the free height, hide when smaller than a minimum). Performance: no permanent polling, refresh per widget on a user interval (settings), pause while the window or the sidebar is hidden, cache the last value. Deliverables: widget list worth having (clock, weather, date, timer, quick note, RSS headline, battery, system load, ...), one settings section, a per-widget on/off and order.

#### `T3.10` — Custom keyboard shortcut for opening a particular Zentral app or panel
**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Right-click an app/panel > "Add custom keyboard shortcut" (at least 2 keys, collision-checked, toggles visibility).

**Full specification (original row):** **OPEN.** Right-click an app/panel (for example an Instagram panel) > "Add custom keyboard shortcut"; prompt records the combination (at least 2 keys, no single key, refuse combinations that collide with Zen/Firefox or another Zentral shortcut) and stores it per app. The shortcut reveals the app if hidden and hides it if shown. Show and remove the shortcut in the same context menu and in settings. Reuse the Notes assignable-keys code where possible.

#### `T4.1` — Owner's comprehensive verification note (`Markdown & Extended Syntax Feature Showcase`)
**Status:** `OPEN` · **Impact:** High · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Bundle/update the 12-section verification showcase note after Tracks 1–3 are feature-complete.

**Full specification (original row):** **OPEN.** Bundle/update the built-in showcase note covering all 12 verification sections: (1) Inline styles, `==highlight==`, `<kbd>`, `~sub~`/`^sup^`, dividers; (2) H1–H6 hierarchy & auto-updated `## Table of Contents`; (3) Multi-paragraph & nested blockquotes; (4) Obsidian callouts including foldable `[!faq]-`; (5) Unordered, ordered & interactive task lists (`[x]`, `[?]`, `[ ]`); (6) Aligned GFM tables with escaped pipes `\|`; (7) Highlighted code blocks (JS, Python, Rust, JSON); (8) Inline `$...$` & block `$$...$$` LaTeX matrices/equations; (9) Wikilinks (`[[Note\|Alias]]`, `#Heading`, `^block-id`), nested `#tags`, and `![[embeds\|450]]`; (10) Standard `[^1]` & inline `^[...]` footnotes; (11) Native HTML `<details>` accordions; (12) Mermaid diagrams (`flowchart`, `gitGraph`).

#### `T4.2` — Performance audit & active timer/listener registry table
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Profile parser, reminder scheduler, and DOM observers; document all active timers/listeners and verify rapid date-note switching returns listener count to baseline.

**Full specification (original row):** **OPEN.** Profile parser, reminder scheduler, and DOM observers; document all active `setInterval`/`setTimeout`/event listeners in a central registry to guarantee zero memory leaks on panel close. Include the rapid-switch case from the owner's second roadmap: open several date/day notes quickly and assert the listener count returns to its baseline (this mod has no `BroadcastChannel`/`WebSocket`; the leak risk is `addEventListener` and timers).

#### `T4.3` — Modularize `ZentralNotes.uc.js` into maintainable sub-modules
**Status:** `OPEN` · **Impact:** Med · **Effort:** M-L · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Split monolithic `ZentralNotes.uc.js` into domain modules (Parser, WikiGraph, Reminders/Calendar, ZenUI, ImportExport) with a single build/loader entry point.

**Full specification (original row):** **OPEN.** Split monolithic `ZentralNotes.uc.js` into clean domain modules (Parser, WikiGraph, Reminders/Calendar, ZenUI, ImportExport) with a single build/loader entry point.

#### `T4.4` — Dead code removal (`stretched()`, legacy `quad` helpers)
**Status:** `OPEN` · **Impact:** Low · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Remove unused legacy layout helpers confirmed dead after `T4.1` verification.

**Full specification (original row):** **OPEN.** Remove unused legacy layout functions (`stretched()`, obsolete `quad` math/positioning helpers) confirmed dead after `T4.1` verification.

#### `T4.5` — Standalone modules version alignment & release hygiene
**Status:** `OPEN` · **Impact:** Low · **Effort:** S · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Synchronize version strings, headers, and changelogs across all standalone and bundled scripts prior to release tag.

**Full specification (original row):** **OPEN.** Synchronize version strings, headers, and changelogs across all standalone and bundled scripts prior to release tag.

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
- Calendar UI must offer denser sizing than the current default: a fit-to-pane default with a size slider (`OW-03`; replaces the old Comfortable / Compact / Extra compact steps), with responsive reductions to cell padding, row heights, labels and markers while keeping keyboard/context actions accessible; very narrow panes still use the existing list fallback.
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
3. Release loop: `node tools/build-standalone.cjs --bump`, `node tools/build-preferences.cjs`, `node tools/build-z-map.cjs`, `node tools/build-standalone.cjs --check`, then `for t in tests/*.test.cjs; do node $t || echo FAIL $t; done`.


---

## Live test checklist

Use a disposable Zen profile and back up the profile and Sync data first. Do not rely on these checks as proof of zero leakage until Firefox session snapshots and prior Sync records are resolved.

- [ ] With Notes and Agenda enabled, create notes and reminders on several days; restart and confirm projections return without duplicate or broken virtual tabs. Repeat with each feature disabled before restart.
- [ ] Test normal pinned and unpinned tabs, native groups, split views, foreign folders and foreign content inside managed folders; confirm their contents, selection and order survive saves, restart and restore.
- [ ] Repeat with two windows, close each in either order, then quit and restart; verify native hook ownership and final shutdown save.
- [ ] Inspect Zen sidebar data, Firefox session files and closed-tab/window restore data for Notes/Agenda pseudo-tab URLs, including saved and closed groups. Check recovery after a simulated crash on a disposable profile.
- [ ] Sync two disposable devices, including records created before this fix; confirm whether old pseudo-tabs and folders are deleted remotely and do not reappear after repeated syncs.
- [ ] Check Agenda refresh after edits and cross-window Done/Dismiss, date labels across local midnight/DST, and the reminder stack at all three stages, including wrapping, reduced motion and cross-window dismissal.
- [ ] Open multiple Zen windows before the 90-second Day-Plan timer; confirm just one nonempty banner per local day, including after restart, and retry behavior if notification display fails.
- [ ] Open a headingless calendar/reminder item from read mode and confirm its source line is visible and selected in split view; test a missing marker and a heading link too.
- [ ] Toggle the RSS reader card off/on repeatedly and replace or restore the tab strip; verify hover, middle-click and tooltip behavior return exactly once and no card appears while disabled.
- [ ] In Week and Day calendar views, compare the header, all-day cells and hourly columns with classic and overlay scrollbars, including when all-day items overflow and after resizing the panel.
- [ ] Export notes with callouts, calendar markers, hidden comments, transclusions and `[TOC]` using raw, portable and Cancel choices; inspect single/folder/ZIP outputs and verify source notes and linked assets.
- [ ] Confirm portable Markdown exports make highlight/underline text legible, retain extended task labels and keep spoiler content concealed in viewers supporting HTML details; verify raw choice preserves the original syntax.
- [ ] While the Markdown compatibility dialog or file picker is open, edit the same note in another window; verify the exported content matches the snapshot reviewed in the dialog.
- [ ] Inspect raw and portable Markdown files containing legacy reminders and custom front matter for stored IDs, reminder timestamps, foreign properties and body. Check re-import separately: the existing importer may assign a new ID.
- [ ] Export syntax-like text inside inline code with differing backtick-run lengths; verify the code example stays unchanged while live syntax outside it converts.
- [ ] Export live syntax alongside a multiline inline-code example; confirm only live syntax is converted, including after unmatched backticks and fenced blocks.
- [ ] Export notes containing syntax-like characters in Markdown link URLs, link titles and HTML attributes; verify the URLs and attributes remain unchanged while visible Markdown labels are converted.
- [ ] Check exported subscript and superscript in an HTML-capable Markdown viewer, and verify ordinary strikethrough, code and links remain unchanged.
- [ ] Export inline footnotes beside existing numbered references; verify generated labels do not collide and unterminated code fences/comments preserve footnotes as literal text.
- [ ] Export inline and block math to portable Markdown; confirm literal formulas are preserved as code, prices stay unchanged and math characters do not become formatting.
- [ ] Export a long note with many unmatched backtick runs and verify the warning dialog and conversion remain responsive without changing code examples.
- [ ] Export known `::: warning` and `::: details` containers with fenced examples, comments, links and formatting; verify labelled blockquotes and note that folding is not preserved. Unclosed, nested, unknown and very long containers need separate fidelity review.
- [ ] Export Discord `-#` small-print lines with inline code, links and block-like text; verify the text stays inline and that its reduced sizing is not promised.
- [ ] Verify consecutive small-print blocks and surrounding paragraphs retain their boundaries; a `-#` marker inside a running paragraph must stay literal.
- [ ] Compare exports for the same extension syntax across per-note flavor and ignored-syntax settings; small-print, wiki links, callout/container, extended task, highlight/underline, hidden-comment, spoiler, script, inline-footnote and dollar-math detection honor these settings; other warning/conversion rules are not yet guaranteed to reflect a note’s configured flavor.
- [ ] Export `~text~` and `^text^` under mixed, GitHub, Reddit and ignored-syntax settings; verify strike/subscript choices and literal escaped delimiters. include Reddit `^word` / `^(words)` and `^[word]` versus inline footnotes; ambiguous escaped/ignored content and nested formatting need further review.
- [ ] Export highlights, underline and spoilers across Markdown modes and ignored or escaped delimiters; check concealed content and leading blockquotes in an HTML-capable viewer.
- [ ] Compare dollar math in mixed and Reddit modes, including ignored or escaped dollars and one-line/multiline blocks. The reader currently accepts block math in every mode; other math spellings still need review.
- [ ] Export hidden comments inside expandable spoilers and verify they stay concealed after expansion; confirm GitHub-mode literal `%%` text and calendar metadata handling.
- [ ] Compare blockquote/container callouts and extended task states across Markdown flavors and ignored rules; include custom callouts and the missing optional flavor module.
- [ ] Export balanced and malformed ToC markers and escaped/ignored transclusions, including CRLF notes; only valid unignored markers should convert.
- [ ] Compare single/folder/ZIP Markdown links across flavors and ignore settings, including same-note headings, unresolved and escaped links, front matter and code. HTML/text export uses its pre-existing path.
- [ ] Export inline `\(…\)` and one-line/multiline `\[…\]` math across flavors and ignore settings; compare code examples and dollar-containing formulas.
- [ ] Export `math` fences in each Markdown flavor, including longer and tilde fences and code/comment examples; active math fences stay as literal code.
- [ ] Export paragraph, list and quoted block IDs in multiple flavors, including IDs beside code and on continued lines; confirm comments stay hidden and warn that block links do not transfer. Nested quote/list IDs convert only when locations are unambiguous; ambiguous IDs still warn and remain raw.
- [ ] Live-check portable ToC with hidden HTML/Zentral comments and spoiler headings: concealed text must not appear in generated labels or links; verify remaining heading-anchor fidelity in other Markdown viewers.
- [ ] Live-check long and nested `:::` callouts: ambiguous or oversized recognized containers warn and keep their delimiters; inner syntax may still be converted. Folding and other ambiguous structure may not transfer.
- [ ] Verify `:::` closers inside code/comments in live Zen: portable conversion leaves them raw because the reader and export scanner disagree about the boundary. Also audit containers nested inside blockquotes for warning coverage.
- [ ] Live-check blockquote exports: nested blockquote callouts convert, nested `:::` callouts warn but stay raw, and fenced examples inside quotes stay untouched. Complex lazy quote continuations and disabled syntax should be checked in Zen.
- [ ] Live-check quote callout headers: only reader-recognized, unambiguous markers convert; repeated indistinguishable headers warn and remain raw. Recheck mixed nested quote/container boundaries and HTML comments.
- [ ] Live-check quoted `math` fences in each flavor: recognized math warns and remains literal code; examples nested inside quoted code stay untouched.
- [ ] In live Zen, right-click Notes root and nested folders in all/selected modes; create a subfolder, verify the correct parent and depth limit, and check removed/moved parents. Native context-menu cleanup and the remaining folder/Agenda actions are still incomplete.
- [ ] In live Zen, open Change color and icon from the NOTES root and a nested folder; confirm changes persist, repaint the right folder, and cannot apply to a deleted/replaced target.
- [ ] Live-check sidebar folder deletion: confirm top-level and Trash choices, reminder impact, folder changes during review, stale identities and the non-deletable NOTES root.
- [ ] Live-check timed-event and timed/all-day reminder pointer drag, timed-event resize handles/keyboard, empty-grid drag creation and undo across Week/Day, cross-day drops, scrolling, density modes, source-list notes, Escape/pointer cancellation and competing edits; recurring drags remain unavailable; all-day date changes use Week cells.
- [ ] Live-check Comfortable, Compact and Extra compact densities in Month, Next days, Agenda, Week and Day, including narrow-panel fallback, readable labels, click/keyboard/RMB targets and timeline/gutter alignment.
- [ ] Live-check sidebar folder Markdown export in all/selected modes, including nested folders, cancel/raw/portable choices, flattened names and missing linked assets; ZIP/vault backup remains the later T1.19 task.
- [ ] In live Zen, verify Notes folder popup hides only incompatible native Zen operations and their separators; ordinary folders and other mods’ items remain available, and nested popups/feature teardown clear state correctly.
- [ ] Live-check Agenda day-folder actions with Notes sidebar mode both off and on: open Day view, create reminder/event with the correct day, reject stale folders, preserve other extensions’ items and remove listeners/flags when disabled.
- [ ] Live-check Agenda item pseudo-tab context menus (including keyboard, disabled actions, recurring identity, stale or moved items, history read-only, and feature teardown). Actions currently open Notes to execute the shared calendar command; recurring snooze remains disabled.
- [ ] Live-check Month cell clicks and keyboard ContextMenu/Shift+F10 across Month, Next days and Week/Day; confirm item clicks open their source without navigating the parent day, date-note action works with Agenda enabled, and cancel causes no mutation.

---

## NEXT SESSION HANDOFF (version 3.3.123, edit in place, keep it short)

**Rule for every AI session: update State, Completed this session, Known debts, Next action and the version here in place. Move finished rows to `docs/LEGACY_done_rows.md`.**

State: **3.3.123.** `F0.1`–`F0.3`, `H1.1`, `H1.5`, `H1.2`–`H1.4` and `PF2.1`–`PF2.3` are DONE and archived. The fan-out idempotence gates are enforced and pass in the fake Zen harness; live Zen is unavailable.

Completed this session: imported the new instructions, active roadmap and legacy archive. Added a production-host fake Zen harness with structural-operation recording, event dispatch, seed fallback, menus, foreign/dragged-out tabs, disable/re-enable, Notes and two isolated windows over shared persisted input. H1.1 makes per-day keys unique, migrates old keys, uses the real parent, suppresses self-generated events and backs off repeated reconciliation; overnight, leadDays=2 and three-day all-day projections perform zero structural operations on unchanged follow-up runs. F0.2 measured production-shape 500/2000 projection 31d at 428/1915 ms, scheduler at 2308/10776 ms, expansion 90d at 742/3188 ms and 45000 history queries at 967 ms; CI ceilings retain headroom. After H1.2: 31d projection 476/1811 ms, 90d expansion 708/3275 ms, scheduler 2366/10579 ms, history 1031 ms; timing fluctuates. F0.3 adds debug-only async write, bytes, Agenda, scheduler and calendar-render sampling. H1.5 coalesces missed reminder stages and records skipped stages for newly-created past reminders and independent copies; live notification verification remains pending. H1.2 merges stale-window history immediately before writes and protects unreadable/damaged files; simultaneous uncoordinated cross-window reads/writes remain a race. H1.3 preserves valid history and rejected raw records with backups, protects unreadable/unknown files and offers guarded explicit recovery in the sheet; live Zen recovery UI remains unverified. H1.4 tracks local unsaved records across I/O and no longer writes after pure refreshes. PF2.1 indexes history identities and claims: 20k-record/45k lookup baseline 7552→155 ms; 500/2000 scheduler 2366/10579→1029/4097 ms (timing varies). PF2.2 cached 500/2000 scheduler passes measured 454/2089 ms versus 969/4774 ms for their initial pass; the initial 2000 pass was slower than the pre-cache 4097 ms baseline. PF2.3 reuses master policies within a reconciliation, not across runs (policy revision counters are unavailable); production 4-day 500/2000 74/192 ms and 31-day 364/1665 ms including boundary scheduling, timings variable.

Standing owner rules for chunks: no conversational filler; output production-ready code and test suites; process tasks strictly in order (implementation, edge cases, unit tests per task); stop cleanly before output limits so the zip is complete; deliver a zip of only changed files (no `.git`).

Known debts / owner requirements: Earlier roadmap DONE claims for `T2.5a–d` were incorrect. Timed-event and timed/all-day reminder pointer moves, timed-event pointer/keyboard resizing, configurable timed snap, cancellation and guarded undo now exist; recurring pointer integration remains open; drag-to-create uses a validated, cancelable composer. Week/Day currently draws 24 fixed labels even on DST transition days; `T2.4c4` is reopened. `T2.6` Big Picture also has no implementation or test and has been reopened. **`B3.3.50-6` LEFT:** Firefox `SessionFile.write` receives the original snapshot separately and remains unprotected; deletion of previously synced records still needs verification. Zen upstream calls `ZenSessionStore.saveState(state)` before `SessionFile.write(state)`; do not mutate that shared state or set `zen-empty-tab` indiscriminately. A Firefox write-time prototype was not enabled: saved/closed groups, split-view trees, selection indexes, and last-window shutdown ownership need a demonstrably safe solution. Zen independently copies split-view metadata; its interaction with removed pseudo-tabs needs investigation. Test shutdown and multi-window ownership. Live Zen validation of all native hooks is required. Continue `T1.18` remaining syntax, ambiguous escaped/ignored script contents, nested-format fidelity and per-note flavor/ignore behavior for remaining syntax including ambiguous block ID locations, unsupported constructs and nested formatting while live validation is blocked; skip parked items and **Never build**.

Calendar density supports persisted Comfortable, Compact and Extra compact in all five views; timeline hour geometry and shading use a shared scale, while narrow Month keeps its list fallback. Live density readability and interaction checks are pending. Calendar/Agenda item menus share a per-item Zen Agenda visibility toggle; it preserves sparse lead/tail overrides, acts on the recurring series, and makes the legacy read-only note-reminder limitation explicit. Calendar remains available to restore an item hidden from the sidebar. Live Zen menu and projection checks remain open.

Next action: implement `PF2.4`, then continue the Master Order. Live Zen remains unavailable in the sandbox.
