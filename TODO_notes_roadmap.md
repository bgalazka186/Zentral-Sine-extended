# Notes roadmap: work split into coding cycles

Each cycle is one self-contained session. Start a cycle by reading only this file, the section of
`TODO_handoff.md` it names and the files it lists; do not reload earlier cycles. Verification is
targeted: run only the tests named in the cycle, then the full set once at the end of a cycle.
Everything stays standalone-capable (full mod + standalone bundle) and cheap at idle: no polling,
no full-document observers, timers only while a feature is visible or armed.

Owner decisions already taken: 3.1.3 confirmed; no encryption at rest; default sheet size stays
`peek`; numeric Sine fields show the old presets as hints. Done this session: the 29 schema/code
default mismatches (test `tests/defaults.test.cjs`), numeric hints, stale doc versions.

## Cycle A: small fixes and consistency (easiest)
- #21 one Notes icon everywhere (settings, GUI, toolbar): single SVG constant.
- #5 highlight picker: clamp inside the window, expose all colors.
- #9 toggle: wrap long lines vs horizontal scroll.
- #22 options for single blank lines (keep / collapse / paragraph), font size, line height.
- #26 Ctrl+Shift+N while a panel is open but hidden opens standalone Notes.
- #2 mirror every widened range into the Zentral settings window sliders/inputs
  (source of truth: `numeric` in the schema + `LOOK_RANGES`); add a test comparing both.
- Leftovers: pill drag flags without CSS; check Left/Right resize handle clipping.
- Tests: notes-ui, notes-bars, defaults, numeric-prefs.

## Cycle B: Markdown features
- #7 links with visible text, images, blockquotes (nested), horizontal rules, tables, strike,
  task lists, `---` shortcut, footnote-free GitHub-style subset. Renderer stays a small tokenizer.
- #10 and #25 split view: live read preview beside the editor, auto-widen when enabled
  (render preview on idle, debounced, only the changed block).
- #14 export (HTML, plain text, PDF via print) with a "what is lost" notice per format.
- Tests: notes, notes-ui (+ a markdown fixture test).

## Cycle C: window behavior and appearance
- #3 drag and resize; above Big Preview while Big Preview is not focused (needs the z-height
  decision: popover only while focused). Update `z-heights_map.md` and its test.
- #4 pin like a Zentral panel (close on outside click, remember last mode).
- #8 panel-like options: push page, appear on hover over the panel's top edge.
- #24 hold-to-act buttons (e.g. Larger = both panels' height in Triple View).
- #23 user-assignable shortcuts for any action.
- #6 toolbar icon in "Customize toolbar" (`CustomizableUI.createWidget`, unified icon from A).
- #1 themes in the Appearance menu, based on the recommended RSS style; full mod + standalone.
- Tests: resize-perf (drag/resize frame-throttled), z-heights, notes-bars.

## Cycle D: data model (hardest)
- #12 folders and trees; pin = independent shortcut shown at the top even inside a folder.
- #16 links between notes (`[[note]]`, hub notes with descriptions).
- #11 search (Ctrl+F while focused): "found in N other notes", next/previous, plus
  next/previous not fully visible in the current view.
- #13 image paste: per-note asset folder, link inserted into the .md; controls for alignment,
  centering and display size.
- #15 browser context menu: copy selection to current note / new note.
- #17 reminders: 5-minute granularity, one coarse timer armed to the next due time (no polling),
  sound plus text alert from the note.
- Tests: new tests per feature; keep fixtures small.

## Cycle E: remaining audits (run last, or any time between cycles)
- Position tracker rAF loop and `onPanelOutsideWindowReturn`: profile in Zen only, do not guess.
- Zen Performance panel while dragging panel / floating / Big Preview / Library.
- Everything in section 4 of `TODO_handoff.md` needs real Zen + Sine.

## Owner-approved ideas (scheduled with the cycle they fit)
- Inbox quick capture: appends a timestamped line to an "Inbox" note; right-click menu item plus a shortcut (cycle D, with #15).
- Date notes: today / tomorrow / next work day (date computed), filter and list by date, or all in one file (cycle D, with #17).
- Backlinks and unlinked mentions (cycle D, with #16).
- Per-note color/label and a "recent" list (cycle C).
- Page URL/title as a source snippet: right-click menu (cycle D, with #15).
- Version history: last N autosave snapshots per note, reliable restore, tunable options (N, interval, size cap) and a warning when the history/notes folder grows huge (cycle D).
- Import a folder of .md files; export all as a zip (cycle B, with #14).

## Cycle A status: DONE (see TODO_handoff.md)
Deferred on purpose: left/right resize-handle clipping (only affects grab area; revisit in cycle C with #3).
