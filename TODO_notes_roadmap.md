# Notes roadmap: work split into coding cycles

Each cycle is one self-contained session. Start a cycle by reading only this file, the section of
`TODO_handoff.md` it names and the files it lists; do not reload earlier cycles. Verification is
targeted: run only the tests named in the cycle, then the full set once at the end of a cycle.
Everything stays standalone-capable (full mod + standalone bundle) and cheap at idle: no polling,
no full-document observers, timers only while a feature is visible or armed.

Owner decisions already taken: 3.1.3 confirmed; no encryption at rest; default sheet size stays
`peek`; numeric Sine fields show the old presets as hints. Done this session: the 29 schema/code
default mismatches (test `tests/defaults.test.cjs`), numeric hints, stale doc versions.

## PLAN v2 (takes precedence over the cycle blocks below; those stay as the task source)

Token rules for every session: read only this PLAN block, the handoff section named, then `grep -n` for
function names and `view` small line ranges of `ZentralNotes.uc.js` (200 KB: never load it whole).
Run only the tests named in the step; full verify loop (handoff section 5) once at the end of a step.
Mark the step DONE here and add 5 lines at most to the handoff. One step = one session.

| Step          | Content (source)                                                                                                                                                                                                                                                                        | Tests                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| C2.1 **DONE** | Bugs: toolbar button no icon / click does nothing / missing after restart; dock-to-sidebar ignores new features; H1-H5 look identical; icons readable active + inactive (C2)                                                                                                            | notes-window, notes-ui, notes-icon    |
| C2.2 **DONE** | Editor dialogs: image dialog like link dialog (clipboard prefill, explains accepted files/links, optional link on picture); code-block language dropdown; table column alignment picker; callout shortcuts (NOTE, WARNING + rest); option to hide toolbar items / shortcut actions (C2) | notes-ui, notes-markdown              |
| C2.3 **DONE** | Markdown: safe HTML subset (`<details>`, `<summary>`), minimal offline math (LaTeX subset to Unicode/sup/sub, no KaTeX bundle; low priority) (C2)                                                                                                                                       | notes-markdown                        |
| C3.1 **DONE** | Window options: #8 push page + reveal on hover over top edge, free-text per-note label (C leftovers)                                                                                                                                                                                    | notes-window, notes-bars              |
| C3.2 **DONE** | Split view as a second same-size window; #1 themes in Appearance menu (RSS-based theme as template for recomended) (C leftovers)                                                                                                                                                        | notes-window, notes-ui                |
| D1 **DONE**   | Capture: selection "Add to note" (new / existing / last open) with metadata settings (date, time, source, link with highlight, checkbox, style); #15 context menu; Inbox; page URL/title source snippet (C2 + D)                                                                        | notes-ui, new notes-capture           |
| D2            | #12 folders and trees, pin as independent shortcut; "recent" list polish                                                                                                                                                                                                                | new notes-tree                        |
| D3            | #16 `[[note]]` links, hub notes, backlinks, clickable footnotes; #11 search with "found in N other notes"                                                                                                                                                                               | new notes-links, notes-search         |
| D4            | #13 image paste + per-note asset folder + alignment/size; replaces click-to-load placeholder decision                                                                                                                                                                                   | notes-markdown, new notes-assets      |
| D5            | #17 reminders (one coarse timer), date notes, version history with size warning                                                                                                                                                                                                         | new notes-reminders, notes-history    |
| E1            | Audits: static ones now (dead CSS/attrs, duplicate IDs, README links); live-only ones get a debug `performance.now()` sampler (pref off by default) and an owner checklist in the handoff                                                                                               | defaults, z-heights, resize-perf, all |

Order is cheapest/highest-value first; D1 follows C because capture reuses the C2.2 dialogs. Nothing was deleted: every item from C, C2, D, E and "Owner-approved ideas" is in a row above.

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

## Cycle B2: Markdown follow-ups: CODE DONE, NEEDS LIVE TEST IN ZEN (see TODO_handoff.md section 10)

- Shortcuts and buttons for every syntax that has none yet (inline code, code block, link, image, numbered list, table), so people who do not know Markdown can learn it from the toolbar; **table creator** (pick rows x columns, inserts a ready table).
- Paste a URL over selected text (or anywhere) -> "create link" mini dialog like Reddit: text to show + address. Finish the "copy to highlight" link feature the same way (its link should offer the same dialog on paste).
- Linked scrolling by the **top visible line** (map the first visible source line to its rendered block) instead of the proportional position now used: the two panes have different line heights, so proportional scrolling ends on different lines.
- Switch (option): allow selecting and copying text in read-only mode.
- Syntax highlighting inside fenced code (```javascript etc.); small and offline, a handful of languages.
- Cheap extras that failed the live test: sub/superscript (`H~2~O`, `X^2^`), `<kbd>`, reference links (`[a][ref]` + `[ref]: url`), link tooltips from `"title"`, `mailto:` autolinks, Setext headings (decide: `text` over `---` is a rule today). Footnotes, math and raw HTML (`<details>`) stay unsupported on purpose.
- In-app **quick settings menu** (most options a user changes while writing: font size, line height, wrap, blank lines, linked scrolling, read-only copy...) and in-app shortcut assignment (shares the engine with cycle C #23).
- Tests: notes-markdown, notes-ui.

## Cycle C: window behavior and appearance

- #3 drag and resize; above Big Preview while Big Preview is not focused (needs the z-height
  decision: popover only while focused). Update `z-heights_map.md` and its test.
- #4 pin like a Zentral panel (close on outside click, remember last mode).
- #8 panel-like options: push page, appear on hover over the panel's top edge.
- #24 hold-to-act buttons (e.g. Larger = both panels' height in Triple View).
- #23 user-assignable shortcuts for any action.
- #6 toolbar icon in "Customize toolbar" (`CustomizableUI.createWidget`, unified icon from A).
- #1 themes in the Appearance menu, based on the recommended RSS style; full mod + standalone.
- Standalone Notes: the native Zen sidebar and the pill menu can end up **on top of** the notes sheet and catch the clicks, so the sheet seems frozen. Default the sheet to the side opposite the native sidebar and keep out of its space; make that an option (toggle).
- Split view as a second window (option): instead of halving the available space, open a second note of the **same size** beside the first. The Zentral pill menu must stay reachable and nothing may be covered.
- Tests: resize-perf (drag/resize frame-throttled), z-heights, notes-bars.

## Cycle C2: Things noticed after live Test

- complete half done Cycle C
- option for window wide shrocut on selected text "add to note" drop down menu new note/existing note/last open note, and configuration in settings what metadata to include in such quick note, like date,time,source,link to source with hilight,checkbox,style options and so on
- fix: Headers from H1 to H5 look exacly the same
- add more shortcuts and option to hide some options, features that do exist but have no proper shortcut are > [!NOTE] and > [!WARNING],
- Image import from link does not give same nice UI like link import, both should see if link is avalible in clipboard and if no other link is avalible paste it in to dialog box, import image should explain there what files/links it will work with, also option to add link to picture
- drop down menu for code so user can select also what should be hilighted
- when creating table there should be allign left centre right option for each collumn
- make sure that all icons are readable both in active and inactive state,
- LaTeX / KaTeX / MathJax (low priority)
- safe HTML tags like <details>
- Notes button in customize toolbar mode now appears but has no icon and clicking it does nothing, doesnt appear after restart untill customize toolbar mode is turned on and off
- bug: when dock notes to the sidebar is turned on features from last upadte do not apply

## Cycle D: data model (hardest)

- #12 folders and trees; pin = independent shortcut shown at the top even inside a folder.
- #16 links between notes and items inside notes (`[[note]]`, hub notes with descriptions), and clickable Footnotes.
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

## Cycle B status: DONE (see TODO_handoff.md sections 9, 9a, 9b)

Owner decision still open: images stay click-to-load placeholders until cycle D #13 adds per-note asset folders.

## Cycle B2 status: DONE

SHORTCUT_ACTIONS and the shortcut helpers in ZentralNotes.uc.js are meant to be reused for #23.

## Cycle C status: PARTLY DONE (see TODO_handoff.md section 11)

Done (code + tests, nothing run in real Zen): #3 drag and resize + above Big Preview while focused (z-height decision taken, `z-heights_map.md` and tests updated), #4 window pin with outside-click close and remembered state, #24 hold-to-act (Larger = fill, window pin = reset), #23 shortcuts for every action incl. two global ones, #6 Customize-toolbar button, standalone card keeps clear of the native sidebar (option `avoid_sidebar`), "recent" list, left/right panel resize-handle clipping NOT touched (it is in the panel suite, not Notes).

NOT done, still open for the next session: #8 panel-like options (push page, reveal on hover over the top edge), #1 themes in the Appearance menu (RSS-based), split view as a second window of the same size, free-text per-note label (color already existed). Reason: each needs live layout feedback from Zen (push page touches `bgalazka-push-page` geometry in the panel suite) and was not started rather than guessed.

## Other modules (not Notes)

- RSS card: long items are cut off, show the full text (expandable); links inside an RSS message must be clickable in the card.
