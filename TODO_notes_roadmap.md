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
| `OW-xx` | Owner request or bug report (stable IDs) |
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
10. **Finish every chunk the same way:** run the release loop, run `node tests/run-all.cjs`, update this file (rows, handoff, version), commit the changes to Git (owner now uses Git-based AIs; do NOT create or present ZIPs unless the owner asks in chat).

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
| 1 | `UI4.7` | `PARTIAL` | Med | M | H1.2, F0.1 | Multi-window and data-integrity edge tests |
| 3 | `F0.5` | `OPEN` | Med | S-M | F0.4 | Perf budgets relative to a baseline + serial perf group |
| 4 | `F0.6` | `OPEN` | Med | S | F0.4 | `standalone.test.cjs` must work on a temp copy, never edit the repo |
| 5 | `F0.7` | `OPEN` | Med-High | S | F0.4 | Time-zone matrix for the whole suite; fix UTC-only tests |
| 6 | `F0.8` | `OPEN` | Med | S | F0.7 | Readable DST/leap/month-end golden cases next to the recurrence hash fixture |
| 7 | `AU-B1` | `OPEN` | High | S-M | F0.8 | Recurring item loses its first occurrence in the repeated DST hour |
| 8 | `SB6.8` | `OPEN` | Med | S | F0.1 | Bind Agenda guards immediately; delay only the projection |
| 9 | `T3.1` | `OPEN` | High | S-M | — | Fix second panel startup initialization bug & settings font-scaling overlap |
| 10 | `OW-04` | `OPEN` | High | M | none | [new] Limit the visible hour range in Week/Day (e.g. 08-20) with automatic extension |
| 11 | `OW-03` | `OPEN` | High | M-L | OW-04 | [change] Calendar size: fit to the pane by default (no scrollbar) plus a size slider; replaces Comfortable/Compact/Extra compact |
| 12 | `OW-23` | `OPEN` | High | M | none | [new] Better time-zone selector: searchable list plus fixed offsets (UTC+3) |
| 13 | `OW-24` | `OPEN` | High | S-M | none | [new] Fast typing for hours and dates (16, 830, 8.30, 8,30, 14.11) |
| 14 | `OW-09` | `OPEN` | High | M | none (OW-06 DONE; reuse `pickerMonth`) | [new] Tiny calendar becomes a date picker coloured by item count |
| 15 | `OW-05` | `OPEN` | Med-High | S | none | [new] 'Add to Calendar…' in the note right-click menu (All notes view) |
| 16 | `OW-02` | `OPEN` | High | M | OW-05 (shared composer entry) | [new] Drag a note onto the calendar to create a reminder at that day and time |
| 17 | `OW-07` | `OPEN` | Med-High | S | OW-05 | [new] '+' button in All notes: also create reminder / event |
| 18 | `OW-10` | `OPEN` | High | M | none | [change] 'Create calendar item': smaller calendar, both calendar and a better clock visible, optional analog clock |
| 19 | `T3.6a` | `OPEN` | High | S-M | — | Accessible color-palette contrast across themes |
| 20 | `OW-11` | `OPEN` | Med-High | S-M | none | [issue] Composer 'Inherit' settings must show what they currently resolve to |
| 21 | `OW-08a` | `OPEN` | High | S-M | H1.5 | Alert stage 1: countdown chip and louder default |
| 22 | `OW-08b` | `OPEN` | High | S-M | OW-08a | Alert stage 2: large persistent card with accent |
| 23 | `OW-08c` | `OPEN` | High | M | OW-08b | Alert stage 3: centred overlay (single window) |
| 24 | `AU-B5` | `OPEN` | Med | S | none | [new] Week start day setting (Mon/Sun) + optional week numbers |
| 25 | `OW-25` | `OPEN` | High | S-M | AU-B5 | [new] Regulator: how many days Week view shows (1-14 or Auto) |
| 26 | `AU-B4a` | `OPEN` | High | M | OW-24 | [new] Notes language: dates, relative words (jutro, pojutrze) and Agenda labels |
| 27 | `AU-B4b` | `OPEN` | Med-High | L | AU-B4a | [new] Notes language: interface strings (English/Polish) |
| 28 | `T2.4c1` | `PARTIAL` | High | M | — | Week/day 24-hour grid, lanes and time shading |
| 29 | `T2.4c4` | `PARTIAL` | Med-High | M | — | Time-zone and DST correctness in time grid |
| 30 | `T2.5` | `PARTIAL` | Med-High | M | — | Drag, resize and create items in the calendar |
| 31 | `T2.6` | `OPEN` | Med | S-M | — | Big Picture popup for the calendar |
| 32 | `OW-18` | `OPEN` | High | L | ST7.1, UI4.7 | [new] Choose shared or separate Notes and Agenda per space |
| 33 | `SB6.1` | `OPEN` | Med-High | M | H1.1, F0.1 | Keep Agenda tab labels, favicons and type icons stable (with T2.8b) |
| 34 | `T2.8b` | `OPEN` | Med | S | none | Favicons and item-type icons on Zen Agenda pseudo-tabs |
| 35 | `T3.4` | `PARTIAL` | Med-High | S-M | — | Context menu on Notes & Agenda folders/pseudo-tabs in Zen tab bar |
| 36 | `SB6.2` | `OPEN` | Med | S | T3.4 | Agenda root folder right-click menu |
| 37 | `SB6.3` | `OPEN` | High | M | T3.4 | Run Agenda quick actions headlessly (no Notes sheet) |
| 38 | `T3.4a` | `OPEN` | High | M | T3.4 | RSS-style floating hover preview cards for Notes & Agenda tabs in Zen sidebar |
| 39 | `AU-B2` | `OPEN` | Med | S | none | Agenda hover card must not watch the whole chrome document |
| 40 | `T2.18` | `PARTIAL` | High | M | — | Right-click menus everywhere (consistent engine) |
| 41 | `T2.19` | `PARTIAL` | Med | S | — | Quick snooze on a reminder (+1 day / +3 days / next week) |
| 42 | `SB6.7` | `OPEN` | Med | S | UI4.7 | Items whose source note is in Trash |
| 43 | `SB6.4` | `OPEN` | Med | S | TM3.3 | Cap the number of Agenda tabs ('+N more') |
| 44 | `SB6.6` | `OPEN` | Low-Med | S | SB6.3 | Setting: what the X (close) button does on an Agenda tab |
| 45 | `SB6.5` | `OPEN` | Med | S-M | F0.1 | Agenda Doctor (diagnostics and repair) |
| 46 | `SB6.9` | `OPEN` | Low | S | TM3.1 | Agenda sidebar quiet hours and 'left' counts |
| 47 | `SB6.10` | `OPEN` | Med | M | PF2.3 | Incremental Agenda projection |
| 48 | `B3.3.50-6` | `PARTIAL` | — | — | — | Harden ZenSync & SessionStore isolation for Agenda and Notes pseudo-tabs |
| 49 | `ST7.3` | `OPEN` | Low-Med | S | none | Move calendar UI state out of notes metadata |
| 50 | `ST7.2` | `OPEN` | Med | M | H1.2, H1.3, PF2.1 | Reminder history compaction (or append-only segments) |
| 51 | `ST7.5` | `OPEN` | Low-Med | S-M | ST7.2 | Reminder history export, prune and inspect UI |
| 52 | `B3.3.32-7` | `PARTIAL` | Med-High | S | — | Protect Daily Notes and connect note-less reminders to an Agenda note |
| 53 | `T2.9` | `OPEN` | Med-High | M | none | Daily-note lifecycle and archive policy inside Agenda |
| 54 | `T2.10` | `OPEN` | Med | M | none | Work-free-day tint + selectable holiday calendars |
| 55 | `T2.11` | `OPEN` | Med | S-M | T3.4 | Exclude folders from the Zen NOTES sidebar |
| 56 | `T2.11a` | `OPEN` | High | S-M | T2.11 | Calendar-only notes (e.g. Birthdays) hidden from Zen NOTES |
| 57 | `T2.11b1` | `OPEN` | High | M | Track 1-2 UI done | Audit UI discoverability of all Notes functions |
| 58 | `T2.11b2` | `OPEN` | Med | M | T2.11b1 | Rebuild the Notes DEMO notes |
| 59 | `ST7.4` | `OPEN` | Low-Med (long term) | L | ST7.1 | Render Agenda rows without real tabs (research) |
| 60 | `T2.13` | `OPEN` | Med | M | all other Track 2 | ICS export/import and Google-sync groundwork (always last in Track 2) |
| 61 | `T1.18` | `PARTIAL` | Med-High | S | — | Export syntax-mismatch warning dialog |
| 62 | `T1.19a` | `OPEN` | High | M | T1.18 | Full ZIP backup of notes + assets |
| 63 | `T1.19b` | `OPEN` | Med-High | M | T1.19a | Obsidian vault export |
| 64 | `T1.19c` | `OPEN` | Med-High | M | T1.19b | Obsidian vault import |
| 65 | `T3.2` | `OPEN` | Med-High | M | — | Multi-select notes & folders in tree view |
| 66 | `T3.11` | `OPEN` | Med | S | — | Colorful Folders live checks and polish |
| 67 | `T3.3` | `OPEN` | Med | M | — | Drag-and-drop note tabs within Zen sidebar |
| 68 | `T3.5` | `OPEN` | Med | S | — | Split Callout toolbar button (quick insert + type/fold picker) |
| 69 | `T3.8` | `OPEN` | Med | M | — | Split View as an equal-sized companion window/pane |
| 70 | `T3.9a` | `OPEN` | Med | S-M | none | Widgets module shell, free-area measurement, video-player avoidance |
| 71 | `T3.9b` | `OPEN` | Med | S | T3.9a | Widgets: clock and date |
| 72 | `T3.9c` | `OPEN` | Med | M | T3.9a | Widgets: weather (cached, user refresh interval) |
| 73 | `T3.9d` | `OPEN` | Med | M | T3.9a | Widgets: timer, quick note, RSS headline |
| 74 | `T3.9e` | `OPEN` | Low-Med | S | T3.9a | Widgets: battery/system load + settings section |
| 75 | `T3.10` | `OPEN` | Med | S-M | — | Custom keyboard shortcut for opening a particular Zentral app or panel |
| 76 | `T4.1` | `OPEN` | High | S | — | Owner's comprehensive verification note (`Markdown & Extended Syntax Feature Showcase`) |
| 77 | `T4.2` | `OPEN` | Med-High | M | — | Performance audit & active timer/listener registry table |
| 78 | `T4.3a` | `OPEN` | Med | M | none | Extract calendar UI from `ZentralNotes.uc.js` |
| 79 | `T4.3b` | `OPEN` | Med | M | T4.3a | Extract parser/wiki graph and import/export |
| 80 | `T4.3c` | `OPEN` | Med | M | T4.3b | Extract Zen sidebar UI; single build entry |
| 81 | `OW-21` | `OPEN` | Med | M | — | [new, lower priority] Find and replace within Notes |
| 82 | `OW-22` | `OPEN` | Med | M | — | [new, lower priority] Find next/previous match outside the visible viewport |
| 83 | `T4.4` | `OPEN` | Low | S | — | Dead code removal (`stretched()`, legacy `quad` helpers) |
| 84 | `T4.5` | `OPEN` | Low | S | — | Standalone modules version alignment & release hygiene |

---

## Phase 0 — Safety net: tests and measurement first

_Nothing below can be proven without these. They change no behaviour._


---

## Phase 1 — Stop loops and data loss

_Defects that can churn the sidebar forever, lose Done/Dismiss state or spam alerts. Highest risk per line of code._


---

## Phase 2 — Remove the big freezes (performance)

_Scheduler, projection and recurrence costs measured in `F0.2`. `PF2.1` before `PF2.2`; `PF2.4` before `PF2.5`._


---

## Phase 3 — Time correctness

_Stale 'Today', late alerts after sleep, overdue and missed reminders. Builds one shared tick service first._


---

## Phase 4 — Interaction safety and owner bugs

_Click/drag/keyboard behaviour in the Zen sidebar and Month view, plus the owner's bug reports._

#### `UI4.7` — Multi-window and data-integrity edge tests
**Status:** `PARTIAL` · **Impact:** Med · **Effort:** M · **Depends on:** H1.2, F0.1 · **Source:** Audit R2 E4-E8

**Problem:** Untested situations from the audit.

**Plan (do in this order):**
1. Done in window A and edit in window B of the same item (last-write-wins, `lwwPick`): loser is notified, not silent.
2. Two Zen windows: only one shows an alert banner (`claimAlert`); closing the window that alerted keeps pending stages in the other.
3. Category deleted or renamed: Agenda windows, colours and alerts fall back without `undefined` policies.
4. Source note moved to Trash then restored: no duplicate items and no duplicate `## Agenda` mirror lines (`mirrorItemToAgendaNote`).
5. Items whose note is trashed: either hidden from the Agenda or shown as 'source note in Trash' with Restore (see `SB6.7`).

**Tests / done when:** New `tests/notes-multiwindow.test.cjs`.

**DONE:** Calendar persistence uses three-way item/category merging under the same per-path process coordinator as history, preserving independent changes and uncontested deletions. Competing item edits use `lwwPick`; the losing calendar window is notified in the sheet and host toast. Unsafe delete/edit and category conflicts block writes and save a recovery snapshot; damaged/unreadable files are protected, with pending edits separately backed up when possible. Edits arriving during I/O remain pending. The 500/2000-item pure merges measured 2.4/6.5 ms (timings vary). Failed reminder claims roll back without discarding unrelated records and receive bounded retries; history opens, recovery, writes and claims serialize per path. Tests cover independent window claims and edits, conflict protection, Trash/restore without duplicate mirrors and external category-definition fallback. No category rename/delete operation exists.

**DONE:** Note writes now compare the exact last-read disk snapshot against the current file while holding the shared per-note path coordinator. A stale write preserves the displaced version in the existing 48-hour Notes recovery area before replacing it, emits a conflict event locally and via the remote notification payload, and displays a longer-lived toast in the receiving window. If a recovery copy cannot be written, the stale write is blocked instead of silently discarding the other version. The new Done-versus-stale-edit test passes in GitHub Actions and verifies the displaced Done version can be recovered after a later stale save. Existing multi-window tests cover a single persisted alert claim with a subsequent stage still claimable after the other window closes, Trash/restore without duplicate mirrors, and safe fallback after external category removal/rename.

**LEFT:** Validate the shared hidden-window coordinator and notification delivery in real Zen; the fallback remains module-local, external writers are not locked, and calendar plus note writes are not a cross-file transaction. Add a dedicated recovery test for later edits after a backup failure. The UI4.7 task remains PARTIAL until those environment/data-integrity cases are closed.


#### `F0.5` — Perf budgets relative to a baseline
**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M · **Depends on:** F0.4 · **Source:** Audit 2026-11-14

**Problem:** Absolute millisecond budgets fail under load (5 tests failed when all ran at once, all pass alone; the 5,000-item projection has a 50 ms budget against about 33 ms typical).
**Plan:** 1. Measure a fixed calibration loop and scale every ceiling by its ratio. 2. Retry a failed perf test once, alone. 3. Move perf tests to the serial group of `F0.4`.
**Done when:** the suite passes with all tests started in parallel.

#### `F0.6` — `standalone.test.cjs` must not touch the repo
**Status:** `DONE` · **Impact:** Med · **Effort:** S · **Depends on:** F0.4 · **Source:** Audit 2026-11-14

**Problem:** It appended a test comment to a real module source and created `additional/zz-test` inside the repo, risking checkout corruption and parallel-test races.
**Fix:** All build experiments now run against an OS-temp copy of `tools/`, `additional/`, `loader/`, plus the owner settings schemas required by the builder. The test edits only the copied source and removes the temporary tree in `finally`.
**Verification:** The regression test compares the checkout's file list, contents, and file mtimes before/after. CI passed with 121/121 test files and `git diff --check`.

#### `F0.7` — Time-zone matrix
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** S · **Depends on:** F0.4 · **Source:** Audit 2026-11-14

**Problem:** `notes-calendar-composer` fails in every non-UTC zone (expects local `09:00` to equal `09:00Z`); `notes-p2` fails in America/Los_Angeles (its start time is the US fall-back moment, see `AU-B1`). 38 files use the real `Date.now()`.
**Plan:** 1. `run-all.cjs --tz` runs the calendar/agenda/reminder tests in UTC, Europe/Warsaw, America/Los_Angeles, Pacific/Auckland. 2. Fix the composer test to compute expected values in local time.
**Done when:** all four zones are green (except `AU-B1` until it is fixed).

#### `F0.8` — Readable recurrence golden cases
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** F0.7 · **Source:** Audit 2026-11-14

**Problem:** `fixtures/notes-recurrence-hashes.json` is a sha256 of random cases; a failure shows no diff.
**Plan:** Add a test with explicit expected dates for DST fall-back and spring-forward, 29 Feb, the 31st of the month, in 2+ zones. Keep the hash fixture.

#### `AU-B1` — Recurring item loses its first occurrence in the repeated DST hour
**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Depends on:** F0.8 · **Source:** Audit 2026-11-14 (reproduced)

**Problem:** Daily reminder starting 2026-11-01 09:05Z in America/Los_Angeles (the second 01:05): `expandItem` returns Nov 2, 3, 4; the start occurrence is dropped, because the ambiguous wall time resolves to the earlier instant, which is before the series start.
**Plan:** 1. The occurrence equal to DTSTART must always be emitted at DTSTART's own instant. 2. Later occurrences in an ambiguous hour keep the earlier-instant rule. 3. Check `COUNT` is not consumed by the dropped occurrence.
**Done when:** `F0.8` cases and `notes-p2` pass in Los_Angeles.

#### `AU-B2` — Agenda hover card must not watch the whole chrome document
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** none · **Source:** Audit 2026-11-14 (`ZentralNotes.uc.js` ~19774)

**Problem:** A `MutationObserver` on `document.documentElement` (childList, subtree) is created on the first hover and stays connected while the card is hidden; it fires on every chrome DOM change and breaks the AGENTS.md rule.
**Plan:** Connect on show, disconnect on hide, observe only the tab's parent. Replaced anyway by `T3.4a`; do it only if `T3.4a` is not next.

#### `OW-23` — [new] Better time-zone selector: searchable list plus fixed offsets
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** none · **Source:** Owner 2026-11-14

**Problem:** Choosing a zone means knowing a city name (e.g. Berlin). The owner wants `UTC+3` as an alternative, and a list with find for someone who does not know the offset.
**Plan:** 1. Pure `zoneChoices(now)`: every IANA zone with city, country/region, current offset (`UTC+01:00`, DST-aware) and abbreviation, plus fixed offsets `UTC-12:00` to `UTC+14:00` (30-minute steps where real). 2. One shared searchable picker (type `berlin`, `+3`, `utc+3`, `gmt-5:30`, `cet`, `poland`), grouped, current system zone and recent zones on top. 3. `cleanZone` accepts and stores fixed offsets as `UTC+03:00`; day bounds, `zonedDateKey`, grid labels and free slots work for them (no DST). 4. Use the picker for the calendar display zone and the per-item zone in the composer; keep stored IANA ids working.
**Tests / done when:** Pure tests for search, offset parsing and fixed-offset day bounds; UI test selecting by typing `utc+3`.

#### `OW-24` — [new] Fast typing for hours and dates
**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Depends on:** none · **Source:** Owner 2026-11-14

**Problem:** In every field where time or date is typed, only strict forms work (`parseClock("9am")`, `"930"`, `"9:5"` all return invalid today).
**Plan:** 1. Time: `16` = 16:00, `8` = 08:00, `830` = 08:30, `0830`, `1630`, `8:30`, `8.30`, `8,30`, `8 30`, `16h`, `9am`, `9:15pm`; reject `25`, `860`. 2. Date: `14` = 14th of the shown month, `1411` / `14.11` / `14,11` / `14-11` = 14 Nov of the current or next year (existing date-format setting decides day-first or month-first), full forms stay. 3. One shared `parseClock`/`parseDateKeyText` used by the composer, the Clock, snooze custom time, event range text and date notes; show the interpreted value live under the field. 4. Enter or blur commits; invalid input keeps the old value and marks the field.
**Tests / done when:** Table of accepted/rejected strings; UI test typing `830` and `14,11` in the composer.

#### `AU-B4a` — [new] Notes language: dates, relative words and Agenda labels
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** OW-24 · **Source:** Owner 2026-11-14 (replaces the "Language of dates" idea)

**Problem:** Everything is English: Agenda day folders say `Today`/`Tomorrow` (`AGENDA_LABELS`, `agendaDayLabel`), snooze and date menus are English strings, and the date parser understands `tomorrow` but not `jutro`, `pojutrze`, `dziś`, `poniedziałek`, `za 3 dni`.
**Plan:** 1. Setting 'Language' (dropdown: English, Polish; table-driven so more languages are one file each). 2. Language table `{relative words (today/tomorrow/day after tomorrow/yesterday), weekdays, months (full+short), 'in N days', 'next week', ordinals}`; accent-insensitive matching (`dzis` = `dziś`). 3. Agenda day folders and pseudo-tab labels use the chosen language (`Dziś`, `Jutro`, `Pojutrze`, then weekday + date), also in the calendar day heads, Month/Week headers and the date chips. 4. Setting 'Also understand words from all available languages' (default on): typing `dzis` or `tomorrow` works in any language, display stays in the chosen language. 5. Existing date notes and stored items are untouched (keys stay ISO).
**Tests / done when:** Parser table per language; `agendaDayLabel` per language and offset; accept-all on/off; no stored data changes when switching language. No text expanding outside date fields (see Never build).

#### `AU-B4b` — [new] Notes language: interface strings
**Status:** `OPEN` · **Impact:** Med-High · **Effort:** L · **Depends on:** AU-B4a · **Source:** Owner 2026-11-14

**Problem:** All buttons, menus, dialogs, alerts and settings text of Notes and the calendar are hard-coded English literals in `ZentralNotes.uc.js` and the calendar module.
**Plan:** 1. One `t(key, params)` helper with the language table from `AU-B4a` and English fallback per key. 2. Convert area by area, one chunk each: calendar toolbar/views, composer, context menus, reminder alerts, Agenda/sidebar menus, All notes tree, settings. 3. A test that fails on a new hard-coded user-visible literal in converted areas and on a key missing from a language. 4. Polish translation for every converted area.
**Tests / done when:** Per converted area: renders in Polish and English, no `undefined` keys.

#### `OW-25` — [new] How many days Week view shows
**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Depends on:** AU-B5 · **Source:** Owner 2026-11-14

**Problem:** Week view is always seven day columns, which is too wide on a small panel and wastes space on a big screen.
**Plan:** 1. Setting 'Days shown in Week view': 1-14 (slider/dropdown) or `Auto` (fit as many columns as the width allows with a minimum readable column width). 2. Start of the range: week start (`AU-B5`), today, or the selected day; Prev/Next move by the shown count (or by 1 day with Shift). 3. Day view stays the 1-day case; all-day strip, shading, drag geometry, free-slot finder and week export use the shown days. 4. Persist per view; keyboard and context menus unchanged.
**Tests / done when:** Pure `visibleDays(start, count)` tests (DST weeks, month borders); UI at 1, 3, 5, 7, 10 days and Auto at three widths.

#### `AU-B5` — [new] Week start day setting
**Status:** `OPEN` · **Impact:** Med · **Effort:** S · **Depends on:** none · **Source:** Audit 2026-11-14

**Problem:** `ZentralNotes.uc.js:11184` hard-codes `weekStart = 1`; Month and Week assume Monday. The core already takes a `weekStart` argument.
**Plan:** Setting Monday/Sunday (default Monday) used by Month, Week, picker and week export; optional week numbers column.
**Tests / done when:** `monthGrid`/`weekDays` tests for both starts; UI header order.

#### `OW-08a` — Alert stage 1: countdown chip and louder default
**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Depends on:** H1.5 · **Source:** Owner 2026-11-14 (split of OW-08)

Stage 1 (pre): live countdown chip to the due time, slightly stronger default sound, still non-modal. Keep quiet-hours and one-alert-per-stage rules. Test: countdown tick, sound level default.

#### `OW-08b` — Alert stage 2: large persistent card
**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Depends on:** OW-08a · **Source:** Owner 2026-11-14

Stage 2 (due): larger card, stays until acted on, accent pulse (respect `prefers-reduced-motion`), louder default. Stack limit with '+N more'. Test: render, reduced motion, stack.

#### `OW-08c` — Alert stage 3: centred overlay
**Status:** `OPEN` · **Impact:** High · **Effort:** M · **Depends on:** OW-08b · **Source:** Owner 2026-11-14

Stage 3 (follow-up): centred overlay with scrim in the active window, large buttons Done / Snooze / Open note / Dismiss, focus on the primary action, Escape = Dismiss (not Done), only one window shows it (`claimAlert`). Setting per stage: corner / large / centred. Test: position, focus, Escape, cross-window single display.

#### `T2.11b1` / `T2.11b2` — Discoverability audit, then demo rebuild
**Status:** `OPEN` · **Impact:** High / Med · **Effort:** M each · **Depends on:** Track 1-2 UI done / T2.11b1 · **Source:** split of T2.11b

`T2.11b1`: list every implemented Notes function and where a person finds it; group related controls into menus; write the findings list. `T2.11b2`: rebuild the built-in DEMO notes to show every implemented function (after `T2.11b1`).

#### `T1.19a` / `T1.19b` / `T1.19c` — ZIP backup, Obsidian export, Obsidian import
**Status:** `OPEN` · **Impact:** High · **Effort:** M each · **Depends on:** T1.18 (a), then a to b to c · **Source:** split of T1.19 (must run last in Track 1)

`a`: bundle notes + `assets/` into a ZIP and restore it. `b`: export a vault folder mapping YAML front matter, `[[Note#Heading|alias]]`, `![[embeds]]`, callouts, tags. `c`: import such a vault, with a re-import that does not duplicate notes.

#### `T3.9a`..`T3.9e` — Sidebar widgets (split of T3.9)
**Status:** `OPEN` · **Impact:** Med · **Effort:** S-M each · **Source:** owner 2026-11-10

Standalone module `additional/widgets` (also in the full pack). Rules for all: study how new-tab-page widgets work and mimic them; never interact with the sidebar video player (free area about 179x426, about 179x301 while a 16:9 player shows; no fixed ratio); always leave room for tabs, folders and Essentials (setting: max share of free height, hide below a minimum); no permanent polling, per-widget refresh interval, pause when window or sidebar is hidden, cache last value. `a`: shell, free-area measurement, player avoidance, per-widget on/off. `b`: clock, date. `c`: weather. `d`: timer, quick note, RSS headline. `e`: battery/system load and the settings section.

#### `T4.3a`..`T4.3c` — Modularize `ZentralNotes.uc.js` (split of T4.3)
**Status:** `OPEN` · **Impact:** Med · **Effort:** M each · **Source:** previous roadmap

`a`: calendar UI out of the monolith (module `api`, test seam unchanged). `b`: parser/wiki graph and import/export. `c`: Zen sidebar UI and one build entry. After each step all tests and the standalone build must pass unchanged.


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

#### `T2.4c1` — Week/day 24-hour grid, lanes and time shading
**Status:** `PARTIAL` · **Impact:** High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Full specification (original row):** **PARTIAL.** Week view shows seven Monday-first day columns; Day view shows one day. Timed events are clipped into the visible day and laid out in side-by-side overlap lanes (no event hidden); all-day events and reminders have a separate strip; timed reminders are independent markers; configured work hours shade off-hours and merged busy ranges shade occupied time. Recurrences expand into the visible range. The saved IANA display zone drives day columns, labels and positioning; DST days use zoned elapsed bounds but the display still has 24 fixed wall-clock labels; skipped/repeated hours require further work in `T2.4c4`. UTC instants are unchanged and all-day items remain civil dates.

#### `T2.4c4` — Time-zone and DST correctness in time grid
**Status:** `PARTIAL` · **Impact:** Med-High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** DONE: display-zone selection and zoned day bounds. LEFT: real 23/25-hour timeline labels and ambiguous/skipped-hour rendering; live verification. Earlier claims about repeated/skipped labels were incorrect.

**Full specification (original row):** **PARTIAL.** Saved IANA display-zone selector drives Week/Day day columns, event clipping/positioning, grid labels, free-slot calculations and week export without changing stored UTC instants. Zoned day bounds handle 23-hour spring and 25-hour fall days; the UI currently draws 24 fixed wall-clock labels, so skipped/repeated hour display remains to be addressed; overnight and midnight-crossing events clip correctly; all-day items remain civil dates; recurring items retain their wall-clock time through DST. Core and view tests cover zone selection and cross-midnight behavior, but do not establish repeated/skipped labels in the UI. Live Firefox/Zen timezone UI verification remains manual.

#### `T2.5` — Drag, resize and create items in the calendar
**Status:** `PARTIAL` · **Impact:** Med-High · **Effort:** M · **Source:** carried over from the previous roadmap (unchanged requirement)

**LEFT (only this):** pointer drag of recurring occurrences with a scope choice (this / this and following / all, as in `T2.5e`). Everything else (timed move/resize, reminder move, drag-create, undo, snap) is DONE; `T2.5a`-`T2.5d` are merged here.

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

#### `OW-18` — Shared versus independent Notes and Agenda per space
**Status:** `OPEN` · **Impact:** High · **Effort:** L · **Depends on:** ST7.1, UI4.7 · **Source:** Owner request

**Problem:** The owner wants a setting to choose whether NOTES/Agenda are duplicated between spaces or each space has its own Notes and Agenda.

**Plan:** Design and implement a clearly named setting for shared (same data in each space) versus independent space-local Notes and Agenda. Preserve existing shared data as the default; define stable workspace identities, data/history/scheduler isolation, workspace switching, creation/removal, multi-window behavior and safe reversible mode transitions without silently merging, deleting or leaking data. No cloud sync. Reuse `ST7.1` projection ownership and coordinate with `B3.3.50-6` SessionStore isolation.

**Tests / done when:** Two or more spaces and windows cover shared and isolated notes, calendar items, history, alerts and sidebar projections; switching setting and restarts retain both datasets without data loss or cross-space leakage; removed/recreated spaces and teardown are safe. Live-check native workspace identity if needed.

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

#### `OW-21` — Find and replace within Notes (lower priority)
**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Depends on:** none · **Source:** Owner request

**Plan:** Add discoverable find-and-replace to Notes with explicit single/all replacement, preview/count and safe editable-note behavior; preserve undo, read-only/trash protections, literal matching semantics, selections and existing find behavior. Define behavior for case/accent options and zero/overlapping matches; never silently replace across unrelated notes.

**Tests / done when:** Unit and real-sheet tests cover replace one/all, matching options, no matches, undo, read-only/trash and non-target notes; document keyboard/accessibility behavior.

#### `OW-22` — Find next or previous match outside the visible viewport (lower priority)
**Status:** `OPEN` · **Impact:** Med · **Effort:** M · **Depends on:** none · **Source:** Owner request

**Plan:** Extend Ctrl+F with next/previous actions that skip all matches currently visible in the note viewport and move to the next not-displayed match, letting the user read all visible matches at once. Preserve existing single-match navigation, wrap behavior, selection and scroll; handle partially visible matches, no offscreen match, both directions, editable/read/split layouts and resizing.

**Tests / done when:** Geometry and real-sheet tests include several visible matches, offscreen matches in both directions, wrap/no-offscreen cases and accessible controls; verify live layout where possible.


_Not blocked by the calendar work. `T3.1` and `T3.6a` are High impact and may be pulled earlier._

#### `T3.1` — Fix second panel startup initialization bug & settings font-scaling overlap
**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Resolve race condition when opening a second Zen window/panel on startup; adjust Settings and Quick Settings CSS so controls never obscure each other at larger font sizes.

**Full specification (original row):** **OPEN.** Resolve race condition when opening a second Zen window/panel on startup so state listeners, styles, and note trees initialize deterministically without blank/unresponsive UI, change settings in notes app so they dont obscure eachother if user selected bigger font.

#### `T3.6a` — Accessible color-palette contrast across themes
**Status:** `OPEN` · **Impact:** High · **Effort:** S-M · **Source:** carried over from the previous roadmap (unchanged requirement)

**Current state and what is LEFT:** Audit every saved/recommended/Zentral palette swatch and preview in light, dark, and system themes; derive readable foreground/outline/hover/selected/disabled colors from the actual surface and coordinate with `T2.3g`.

**Full specification (original row):** **OPEN.** Audit every saved/recommended/Zentral palette swatch and preview in light, dark and system themes. The Recommended and Zentral palettes currently produce unreadable text/labels in some modes (dark mode is the most reliable). Derive readable foreground, outline, hover, selected and disabled colors from the actual surface; ensure contrast without losing the palette hue. Add automated contrast fixtures for each preset/theme and a preview that uses the same resolved colors as the live UI. Coordinate with calendar/category and note-color inheritance (`T2.3g`) so colored reminders remain readable in Month, Next days, Agenda and Week/Day views.

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
3. Release loop: `node tools/build-standalone.cjs --bump`, `node tools/build-preferences.cjs`, `node tools/build-z-map.cjs`, `node tools/build-standalone.cjs --check`, then `node tests/run-all.cjs`.


---

## NEXT SESSION HANDOFF (version 3.3.156, edit in place, keep it short)

**Rule for every AI session: update State, Completed this session, Known debts, Next action and the version here in place. Move finished rows to `docs/LEGACY_done_rows.md`.**

State: **3.3.156.** `F0.1`–`F0.3`, `H1.1`, `H1.5`, `H1.2`–`H1.4`, `PF2.1`–`PF2.6` and `TM3.1`–`TM3.5` are DONE and archived. The fan-out idempotence gates are enforced and pass in the fake Zen harness; live Zen is unavailable.

Completed this session: UI4.7 partial: integrated coordinated three-way calendar persistence, visible loser notices, and protected conflict/corruption backups; independent stale edits and deletes, pending I/O and linked-note visibility are tested. Note-file writes now compare disk snapshots under a shared per-note lock, save a displaced version into the 48-hour Notes recovery area before replacement, and send local/remote conflict notices; the focused Done-versus-stale-edit test passes in GitHub Actions. The full pre-runner suite still has a separate calendar-views failure at line 616 (expected only rescheduled history, but three skipped entries were also present); the loop stopped before the remaining tests. F0.4 adds a four-worker test runner, serial performance group, summary/TODO reporting, and a self-test proving a deliberately failing test makes the runner exit 1. F0.5 now applies calibration scaling to the remaining Agenda DOM timing ceilings; isolated retries and serial classification are already in the runner, pending a green full workflow. The sidebar protection regression was fixed: moved or restored Notes/Agenda pseudo-tabs are intercepted and still open their model targets, root-level Agenda drops are blocked, and native move/folder changes request immediate projection repair; regression tests cover the previously unguarded paths. Reminder-history open/recovery, writes, single and digest claims use one per-path process-shared queue, and normal due claims recheck remote Done state under the queue. Independent fake window modules share a hidden-window registry; close, failure, retry and concurrent writes are tested. The fallback is module-local and external processes are uncoordinated; live Zen remains unverified. Failed claims roll back without discarding other pending history and retry a bounded number of times. Two cross-window acceptance tests remain TODO. Production-shape scheduler 500/2000: 619/2448 ms before and 587/2278 ms after (timings vary), within budgets. OW-23 gives the Recommended Notes theme independent light/dark blue accents with contrasting selected-date text; explicit accent overrides and border colours remain independent. Tests check default palette contrast and override precedence; live Zen and unusual custom popup colours remain unverified. UI4.6 defers background calendar redraws while a drag, dialog or calendar menu is active, flushes on release, and restores timeline scroll, focused item and hover through full/affected-day redraws. Fake-host 50/150-item Day redraws measured 9.6/23.5 ms before and 10.7/34.4 ms after (timings vary). Live Zen gestures and layout remain unverified. OW-20 gives rendered Markdown and HTML tables a constrained, keyboard-focusable horizontal scroll region with a standard-width native scrollbar; fake layout and DOM tests pass, live Zen/OS overlay scrollbar behavior remains unverified. OW-19 conservatively repairs flattened pasted Markdown table rows only when validated in the destination note; plain text, code, malformed tables and rich HTML retain their normal paste paths. Lower-priority OW-21/OW-22 are queued. UI4.5 uses the native move helper for Agenda reorder, suppresses its own synchronous TabMove events, and verifies the result; fake-host 50/150-item reverse reorder measured 17.1/135.7 ms before and 17.3/140.5 ms after (timings vary). Live Zen native moves remain unverified. ST7.1 follow-up protects foreign tabs and empty folders during subfolder retirement, and prevents tight retries after a blocked move. ST7.1 moves shared Notes and Agenda projections to the active workspace, preserving foreign content and retrying safely; fake-host 50/150-item space switches measured 1.1/2.7 ms (timings vary), live Zen is unverified. Imported the new instructions, active roadmap and legacy archive. Added a production-host fake Zen harness with structural-operation recording, event dispatch, seed fallback, menus, foreign/dragged-out tabs, disable/re-enable, Notes and two isolated windows over shared persisted input. H1.1 makes per-day keys unique, migrates old keys, uses the real parent, suppresses self-generated events and backs off repeated reconciliation; overnight, leadDays=2 and three-day all-day projections perform zero structural operations on unchanged follow-up runs. F0.2 measured production-shape 500/2000 projection 31d at 428/1915 ms, scheduler at 2308/10776 ms, expansion 90d at 742/3188 ms and 45000 history queries at 967 ms; CI ceilings retain headroom. After H1.2: 31d projection 476/1811 ms, 90d expansion 708/3275 ms, scheduler 2366/10579 ms, history 1031 ms; timing fluctuates. F0.3 adds debug-only async write, bytes, Agenda, scheduler and calendar-render sampling. H1.5 coalesces missed reminder stages and records skipped stages for newly-created past reminders and independent copies; live notification verification remains pending. H1.2 merges stale-window history immediately before writes and protects unreadable/damaged files; simultaneous uncoordinated cross-window reads/writes remain a race. H1.3 preserves valid history and rejected raw records with backups, protects unreadable/unknown files and offers guarded explicit recovery in the sheet; live Zen recovery UI remains unverified. H1.4 tracks local unsaved records across I/O and no longer writes after pure refreshes. PF2.1 indexes history identities and claims: 20k-record/45k lookup baseline 7552→155 ms; 500/2000 scheduler 2366/10579→1029/4097 ms (timing varies). PF2.2 cached 500/2000 scheduler passes measured 454/2089 ms versus 969/4774 ms for their initial pass; the initial 2000 pass was slower than the pre-cache 4097 ms baseline. PF2.3 reuses master policies within a reconciliation, not across runs (policy revision counters are unavailable); production 4-day 500/2000 74/192 ms and 31-day 364/1665 ms including boundary scheduling, timings variable. PF2.4 recurrence expansion uses bounded rule caching, exception indexing and isolated in-memory copies; 90-day 500/2000 629/2488 ms versus 752/3143 ms pre-change. PF2.6 filters unrelated note changes while retaining linked, tree and reset notifications. PF2.5 pages Agenda over 90 days and patches Week/Day reminder-history updates or affected day columns; active-drag background protection is UI4.6. TM3.1 provides one tick queue for Agenda/reminder deadlines, wake, focus, visible-state, clock drift, zone changes and day rollover; live Zen wake validation remains pending. TM3.2 re-evaluates visible timed Agenda entries at their ends, including recurring/overnight events, using the existing projection. TM3.3 adds a configurable default-on Overdue folder with capped results, More navigation, legacy note reminders and midnight expiry. TM3.4 batches missed reminders into a paged digest on startup and wake; 500/2000 daily-series 7-day startup 704/2587 ms. TM3.5 adds DST, zones, duplicate/recurring identity, parser, long-distance move and 5000-series edge tests (31-day projection 1967 ms). UI4.4 prevents dragging managed Agenda tabs/folders or dropping content into Agenda, and evacuates foreign subtrees safely; 50/150-item host list measured 9.0/69.4 ms before and 9.9/70.8 ms after (timings vary). UI4.3 validates previous, last-focused and fallback tabs against the active Zen workspace, excludes pseudo, essential, unloaded and closed tabs, and revalidates deferred work; with no safe local tab it leaves selection alone. UI4.1 moves Agenda pointer activation to an unmodified click release within 4px, cancels drags and suppresses mousedown-driven TabSelect activation; UI4.2 bounces all TabSelect events silently and handles direct Enter/Space as explicit keyboard intent (avoiding stale pointer flags and double activation). OW-17 adds a scoped, focus-accessible full-title Agenda tooltip with top-layer fallback and teardown; richer T3.4a cards remain open and should extend it. OW-01 recognizes deterministically mirrored items and deletes the one matching Agenda line with guarded confirmation, preserving authored and ambiguous lines. OW-16 synchronizes per-line Daily Note category markers in both directions, including explicit empty, title preservation, inheritance, relocation and reload; 500/2000-item note sync measured 33.5/106.8 ms before and 33.8/103.5 ms after (timings vary). OW-12 fixes source-note category edits using explicit per-item overrides and a Follow note section option; real sheet and reload tests pass. OW-13 deduplicates marked/stable-ID restored Agenda roots while preserving foreign content and retrying failed moves; labels alone are not proof of ownership. OW-14 raises panel-hosted Calendar dialogs independently into the top layer, anchors them to the sheet and keeps a constrained fallback; real Zen compositing remains unverified. T2.4d’s previously implemented navigation and menu work is archived under the owner’s live-check assumption. OW-06 makes Month cell click/Enter/Space select and show the complete day without replacing the cell; badge, double-click and Shift+Enter still open Day. OW-15 positions Calendar context menus in viewport coordinates from pointer or keyboard target, with a scoped top layer and dismissal on scroll/resize; real Zen compositing and zoom remain unverified. Live UI unverified.

Standing owner rules for chunks: commit to Git, no ZIPs; no conversational filler; production-ready code and test suites; tasks strictly in order (implementation, edge cases, unit tests). Owner 2026-11-14: no live-check items (owner tests in the app and reports); do NOT add low-priority polish that changes nothing noticeable; only fix what a person would notice.

Known debts / owner requirements: UI4.7's fake-host note conflict/recovery path passes; real Zen hidden-window coordination remains unverified, the fallback is module-local and external writers are not locked, calendar and note writes are not a cross-file transaction, and backup-failure recovery needs a dedicated later-edit test. The latest complete-suite attempt exposed an existing `notes-calendar-views.test.cjs:616` mismatch (one `rescheduled` record versus that plus three `skipped` records); use `node tests/run-all.cjs` to get the full failure list. Reminder-history coordination requires the browser hidden-window registry; fallback and external writers are not cross-window locked and real Zen remains unverified. OW-16 adds Daily Note per-item category markers and two-way synchronization; real Zen remains unverified. Dual calendar/note writes are not a cross-file transaction. Richer Agenda/Notes hover cards remain T3.4a; shared mode is ST7.1; isolated space mode remains OW-18. Earlier roadmap DONE claims for `T2.5a–d` were incorrect. Timed-event and timed/all-day reminder pointer moves, timed-event pointer/keyboard resizing, configurable timed snap, cancellation and guarded undo now exist; recurring pointer integration remains open; drag-to-create uses a validated, cancelable composer. Week/Day currently draws 24 fixed labels even on DST transition days; `T2.4c4` is reopened. `T2.6` Big Picture also has no implementation or test and has been reopened. **`B3.3.50-6` LEFT:** Firefox `SessionFile.write` receives the original snapshot separately and remains unprotected; deletion of previously synced records still needs verification. Zen upstream calls `ZenSessionStore.saveState(state)` before `SessionFile.write(state)`; do not mutate that shared state or set `zen-empty-tab` indiscriminately. A Firefox write-time prototype was not enabled: saved/closed groups, split-view trees, selection indexes, and last-window shutdown ownership need a demonstrably safe solution. Zen independently copies split-view metadata; its interaction with removed pseudo-tabs needs investigation. Test shutdown and multi-window ownership. Live Zen validation of all native hooks is required. Continue `T1.18` remaining syntax, ambiguous escaped/ignored script contents, nested-format fidelity and per-note flavor/ignore behavior for remaining syntax including ambiguous block ID locations, unsupported constructs and nested formatting while live validation is blocked; skip parked items and **Never build**.

Calendar density supports persisted Comfortable, Compact and Extra compact in all five views; timeline hour geometry and shading use a shared scale, while narrow Month keeps its list fallback. Live density readability and interaction checks are pending. Calendar/Agenda item menus share a per-item Zen Agenda visibility toggle; it preserves sparse lead/tail overrides, acts on the recurring series, and makes the legacy read-only note-reminder limitation explicit. Calendar remains available to restore an item hidden from the sidebar. Live Zen menu and projection checks remain open.

Audit 2026-11-14 added F0.4-F0.8, AU-B1, AU-B2, AU-B4a/b, AU-B5, OW-25, OW-23, OW-24 and split OW-08, T1.19, T3.9, T4.3, T2.11b; Live checklist removed; T2.4c/T2.4e/T2.5a-d merged. Next action: verify the full workflow for the sidebar-protection fix and F0.5; resolve any remaining suite failures (including the previously reported calendar-views mismatch), then close F0.5 and proceed to F0.6-F0.8 and AU-B1. Verify recovery of later edits after blocked calendar writes and coordination in real Zen; the hidden-window fallback is module-local and external writers are not locked. Category removal/rename is tested only as an external disk change; no UI operation exists. Note and calendar writes are not transactional. Finish all cases before archiving, then continue Master Order. `OW-21` and `OW-22` are lower priority; `OW-18` follows `UI4.7`. Live Zen remains unavailable in the sandbox.
