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

| Step                                                | Content (source)                                                                                                                                                                                                                                                                        | Tests                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| C2.1 **DONE**                                       | Bugs: toolbar button no icon / click does nothing / missing after restart; dock-to-sidebar ignores new features; H1-H5 look identical; icons readable active + inactive (C2)                                                                                                            | notes-window, notes-ui, notes-icon    |
| C2.2 **DONE**                                       | Editor dialogs: image dialog like link dialog (clipboard prefill, explains accepted files/links, optional link on picture); code-block language dropdown; table column alignment picker; callout shortcuts (NOTE, WARNING + rest); option to hide toolbar items / shortcut actions (C2) | notes-ui, notes-markdown              |
| C2.3 **DONE**                                       | Markdown: safe HTML subset (`<details>`, `<summary>`), minimal offline math (LaTeX subset to Unicode/sup/sub, no KaTeX bundle; low priority) (C2)                                                                                                                                       | notes-markdown                        |
| C3.1 **DONE**                                       | Window options: #8 push page + reveal on hover over top edge, free-text per-note label (C leftovers)                                                                                                                                                                                    | notes-window, notes-bars              |
| C3.2 **DONE**                                       | Split view as a second same-size window; #1 themes in Appearance menu (RSS-based theme as template for recomended) (C leftovers)                                                                                                                                                        | notes-window, notes-ui                |
| D1 **DONE**                                         | Capture: selection "Add to note" (new / existing / last open) with metadata settings (date, time, source, link with highlight, checkbox, style); #15 context menu; Inbox; page URL/title source snippet (C2 + D)                                                                        | notes-ui, new notes-capture           |
| D2 **DONE** (see v4 D2a/D2b)                        | #12 folders and trees, pin as independent shortcut; "recent" list polish                                                                                                                                                                                                                | new notes-tree                        |
| D3 **CODE DONE** (Node only; live test pending)     | #16 `[[note]]` links + backlinks (P3, `notes-links`); #11 search with "found in N other notes" (P2, `notes-p2`). STILL OPEN: hub-note descriptions, clickable footnotes, unlinked mentions                                                                                              | new notes-links, notes-search         |
| D4 **CODE DONE** (Node only; live test pending)     | #13 image paste + per-note asset folder + alignment/size; replaces click-to-load placeholder decision                                                                                                                                                                                   | notes-markdown, new notes-assets      |
| D5 **PARTLY DONE** (reminders code done, Node only) | #17 reminders (one coarse timer) done in P2. STILL OPEN: date notes, version history with size warning                                                                                                                                                                                  | new notes-reminders, notes-history    |
| E1 **DONE**                                         | RSS card: expandable long items, clickable links (Other modules)                                                                                                                                                                                                                        | standalone, encoding                  |
| E2                                                  | Audits: static ones now (dead CSS/attrs, duplicate IDs, README links); live-only ones get a debug `performance.now()` sampler (pref off by default) and an owner checklist in the handoff                                                                                               | defaults, z-heights, resize-perf, all |

Order is cheapest/highest-value first; D1 follows C because capture reuses the C2.2 dialogs. Nothing was deleted: every item from C, C2, D, E and "Owner-approved ideas" is in a row above.

## PLAN v3 (replaces C3.1 / C3.2 and reworks D1 placement; takes precedence over v2 for these rows)

Owner answers: push in a panel = **shrink the panel's height** (website pushed as the panel does); reveal = the **full Notes sheet as an overlay** on the panel, opened from a strip on the panel's top edge, while the cursor going over the top edge must not make the top bar expand; wide sheet may **cover the page**, the pill menu must stay reachable; old keys (`split_window`, `look_shadow`, preset dropdowns) may be deleted once replaced.
Review that led here: `NOTES_C3-D1_review_and_rebuild_plan.md`.

| Step                              | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Tests                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| R1 **DONE**                       | Full mod: schema items with `control: "slider"/"color"` render as real sliders / colour pickers + Default button in the Zentral settings window (loader/ZentralRuntime.js `createSchemaControlRow`); standalone: same prefs as numeric text boxes in Sine (-1 = theme). Also an in-app **Settings** view (tabs Writing / Window / Appearance / Capture) with real sliders, an HSL colour picker (no native dialog), "Theme" reset per value; quick menu cut to 8 items + "All settings…"; numeric shadow (blur / offset / strength) replaces the 3 presets; ranges widened (opacity 0-100, radius 0-60...) | notes-ui, notes-capture, defaults   |
| R2 ~~DONE~~ SUPERSEDED by PLAN v4 | Push page on the panel contract (`#tabbrowser-tabbox`, panel attributes, transition, hover-hidden release); panel-hosted sheet shrinks the panel height                                                                                                                                                                                                                                                                                                                                                                                                                                                    | notes-window, notes-bars, z-heights |
| R3 ~~DONE~~ SUPERSEDED by PLAN v4 | Reveal strip at the top of an open panel opening the full sheet as an overlay; guard so the strip does not trigger the native top bar; drop the "tuck" behaviour or rename it                                                                                                                                                                                                                                                                                                                                                                                                                              | notes-bars, notes-window            |
| R4 ~~DONE~~ SUPERSEDED by PLAN v4 | Delete the companion window (`createCompanionAdapter`, `syncCompanion`, `companionRect`, `split_window`); split view widens the one sheet ~2x, bounded by the window, pill menu kept clear (`keepClear`)                                                                                                                                                                                                                                                                                                                                                                                                   | notes-window, notes-ui, resize-perf |
| R5                                | D1 rework: capture options move to Settings > Capture (done in R1), re-check menu/shortcut paths and the "where quick notes open" presentation option                                                                                                                                                                                                                                                                                                                                                                                                                                                      | notes-capture                       |
| D2 - D5, E2                       | unchanged from v2 (folders/trees, links/search, assets, reminders/history, audits); start after R2-R4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | as in v2                            |

## PLAN v4 (supersedes R2-R5 of PLAN v3; context in `TODO_handoff.md` section 19; spec in `docs/NOTES-FOLDERS-ZEN-SYNC-SPEC.md`)

One step = one session. Read only this block, handoff section 19, then `grep -n` the function names and `view` small ranges.

| Step                                                                                                            | Content                                                                                                                                                | Tests                                                                            |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| V4-R1+R4 **DONE**                                                                                               | Notes as a real slot: panel + Notes = Triple-like split; Triple + Notes = Quad; push on by default for panel-hosted Notes; remove `size==="peek"` gate | notes-bars, notes-window, z-heights, new notes-slots                             |
| V4-R3 **DONE**                                                                                                  | Wide/span sheet visually overflows the Zentral panel (re-attach fixed to root or unclip), pill menu clear                                              | notes-window                                                                     |
| V4-R2 **DONE**                                                                                                  | Hover/dock modes in the Notes top bar; between-URL-bars mode (default in Triple View); bottom bar icon = between-bars, top icon = overlay; icon states | notes-bars, notes-ui, notes-icon                                                 |
| V4-QS **DONE**                                                                                                  | Quick Settings container grows with font size (em sizing, wrap, re-position)                                                                           | notes-ui, new notes-quick-settings                                               |
| D2a/D2b **DONE**                                                                                                | Folders + tree data model and in-sheet UI (spec 1.1-1.2)                                                                                               | new notes-tree                                                                   |
| E-a..E-c **BLOCKED, not shipped** (pure groundwork + `notes-zenfolder`; see `docs/NOTES-ZEN-FOLDER-BLOCKER.md`) | Zen-native `NOTES` folder, activation over last Zentral panel, RMB menus (spec 1.3-1.5), off by default                                                | new notes-zenfolder                                                              |
| E-d                                                                                                             | Zen Sync short-note tier                                                                                                                               | REMOVED BY OWNER DECISION: never build (see docs spec section 4). Nothing to do. |
| R5 (old)                                                                                                        | D1 capture path re-check after V4 (open)                                                                                                               | notes-capture                                                                    |
| D3-D5, E2                                                                                                       | D3 + D4 code done, D5 reminders done (see v2 rows); E2 open                                                                                            | as in v2                                                                         |

## Cycle A: small fixes and consistency (easiest) **DONE**

- #21 one Notes icon everywhere (settings, GUI, toolbar): single SVG constant.
- #5 highlight picker: clamp inside the window, expose all colors.
- #9 toggle: wrap long lines vs horizontal scroll.
- #22 options for single blank lines (keep / collapse / paragraph), font size, line height.
- #26 Ctrl+Shift+N while a panel is open but hidden opens standalone Notes.
- #2 mirror every widened range into the Zentral settings window sliders/inputs
  (source of truth: `numeric` in the schema + `LOOK_RANGES`); add a test comparing both.
- Leftovers: pill drag flags without CSS; check Left/Right resize handle clipping.
- Tests: notes-ui, notes-bars, defaults, numeric-prefs.

## Cycle B: Markdown features **DONE**

- #7 links with visible text, images, blockquotes (nested), horizontal rules, tables, strike,
  task lists, `---` shortcut, footnote-free GitHub-style subset. Renderer stays a small tokenizer.
- #10 and #25 split view: live read preview beside the editor, auto-widen when enabled
  (render preview on idle, debounced, only the changed block).
- #14 export (HTML, plain text, PDF via print) with a "what is lost" notice per format.
- Tests: notes, notes-ui (+ a markdown fixture test).

## Cycle B2: Markdown follow-ups: CODE DONE, NEEDS LIVE TEST IN ZEN (see TODO_handoff.md section 10) **DONE**

- Shortcuts and buttons for every syntax that has none yet (inline code, code block, link, image, numbered list, table), so people who do not know Markdown can learn it from the toolbar; **table creator** (pick rows x columns, inserts a ready table).
- Paste a URL over selected text (or anywhere) -> "create link" mini dialog like Reddit: text to show + address. Finish the "copy to highlight" link feature the same way (its link should offer the same dialog on paste).
- Linked scrolling by the **top visible line** (map the first visible source line to its rendered block) instead of the proportional position now used: the two panes have different line heights, so proportional scrolling ends on different lines.
- Switch (option): allow selecting and copying text in read-only mode.
- Syntax highlighting inside fenced code (```javascript etc.); small and offline, a handful of languages.
- Cheap extras that failed the live test: sub/superscript (`H~2~O`, `X^2^`), `<kbd>`, reference links (`[a][ref]` + `[ref]: url`), link tooltips from `"title"`, `mailto:` autolinks, Setext headings (decide: `text` over `---` is a rule today). Footnotes, math and raw HTML (`<details>`) stay unsupported on purpose.
- In-app **quick settings menu** (most options a user changes while writing: font size, line height, wrap, blank lines, linked scrolling, read-only copy...) and in-app shortcut assignment (shares the engine with cycle C #23).
- Tests: notes-markdown, notes-ui.

## Cycle C: window behavior and appearance **DONE**

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

## Cycle C2: Things noticed after live Test (all items DONE in PLAN v2 C2.1-C2.3, Node only)

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

## Cycle D: data model (hardest) - status: see per-item marks

- **DONE (Node)** #12 folders and trees; pin = independent shortcut shown at the top even inside a folder.
- **PARTLY DONE (Node)** #16 links between notes: `[[note]]` shorthand + canonical `.md` links + backlinks done; hub notes with descriptions and clickable Footnotes still open.
- **DONE (Node, P2)** #11 search (Ctrl+F while focused): "found in N other notes", next/previous, plus
  next/previous not fully visible in the current view.
- **DONE (Node, P2)** #13 image paste: per-note asset folder, link inserted into the .md; controls for alignment,
  centering and display size.
- **DONE (D1)** #15 browser context menu: copy selection to current note / new note.
- **DONE (Node, P2)** #17 reminders: 5-minute granularity, one coarse timer armed to the next due time (no polling),
  sound plus text alert from the note.
- Tests: new tests per feature; keep fixtures small.

## Cycle E: remaining audits (run last, or any time between cycles)

- Position tracker rAF loop and `onPanelOutsideWindowReturn`: profile in Zen only, do not guess.
- Zen Performance panel while dragging panel / floating / Big Preview / Library.
- Everything in section 4 of `TODO_handoff.md` needs real Zen + Sine.

## Owner-approved ideas (scheduled with the cycle they fit)

- **DONE (D1)** Inbox quick capture: appends a timestamped line to an "Inbox" note; right-click menu item plus a shortcut (cycle D, with #15).
- Date notes: today / tomorrow / next work day (date computed), filter and list by date, or all in one file (cycle D, with #17).
- Backlinks **DONE (Node, P3)**; unlinked mentions still open (cycle D, with #16).
- **DONE** Per-note color/label and a "recent" list (cycle C).
- **DONE (D1)** Page URL/title as a source snippet: right-click menu (cycle D, with #15).
- Version history: last N autosave snapshots per note, reliable restore, tunable options (N, interval, size cap) and a warning when the history/notes folder grows huge (cycle D).
- **DONE (cycle B)** Import a folder of .md files; export all as a zip (cycle B, with #14).

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

## Priority 3 status (Node/fake-DOM only; NOT run in real Zen; do not mark fully DONE before the live checks)

- A Zen-native `Notes` folder: **BLOCKED, not shipped**, no pref. Needs live proof of Sync exclusion, drop cancel and a stable folder uid first (`docs/NOTES-ZEN-FOLDER-BLOCKER.md`).
- B note-to-note links: **CODE DONE** (`notes-links`). Open: heading anchors, persistent backlinks panel, unlinked mentions, `[[` autocomplete.
- C writing tools in the UI: **CODE DONE** (`notes-writing-ui`, inventory `WRITING_UI`). Owner decision pending: hidden toolbar tools stay reachable in a menu?
- Cheap scan: **DONE** (Empty-trash confirm timer now owned by the sheet, `notes-p3-scan`); gestures, hold buttons, reserve release and listener cleanup checked, no other confirmed bug.

## STATUS AFTER THE P4 SESSION (read this first; older rows above may still say OPEN)

DONE as Node-tested code, new behaviour on by default unless noted (all verified only with fake DOM / fake disk, not in a live Zen):

- D3: heading anchors in note links (`[x](id.md#slug)`, "#" button in the link dialog), clickable footnotes (`[^1]`), unlinked mentions (whole word, "click = turn into link"), hub notes (Insert > Hub list of notes, bare-link list items show the description, pref hub_descriptions), "Linked from" strip (pref backlinks_panel, off), `[[` autocomplete (pref wiki_complete).
- D5: date notes (More > Notes by date: today / tomorrow / next work day / other date, Daily folder or one Journal note), version history (history/<id>/, N / interval / size cap / warning prefs, dialog with restore, As new note, clear).
- Hidden toolbar tools reachable in More > Hidden tools (pref hidden_tools_menu, on).
- E2 static pieces: debug sampler (pref debug_perf, off; `__zentralNotesPerf.report()`).
- E-a..E-c Zen sidebar folder as EXPERIMENT, pref zen_folder = off (default) | selected (only the reserved "Notes (tabbar)" folder, like the bookmarks toolbar) | all (whole tree). Controller logic tested against a fake api; the REAL Zen API calls (createFolder options, putting a tab into a folder, nested folders, click/drag capture, tab context menu) are UNVERIFIED and fail closed (kill switch).
- E-d Zen Sync tier: REMOVED, never to be built.

NOT DONE / still to do: see the end of the chat summary of this session, copied here:

1. `additional/notes/ZentralNotes.standalone.uc.js` and its lock are out of date: run `node tools/build-standalone.cjs` after deciding the version (it refuses without a bump; `--bump` or edit additional/notes/standalone.json). `tests/standalone.test.cjs` fails until then.
2. `tests/notes-p4-ui.test.cjs`: last test (read view: footnote, hub description, Linked-from strip) fails because the test does not switch the sheet to read mode first (use `key(ta, "e", { ctrlKey: true })` as other tests do). Code not proven wrong.
3. Full suite was not re-run after the final edits; run all `tests/*.test.cjs` and fix fallout.
4. Not built: static audits (dead CSS/attrs, duplicate IDs, README links), the owner checklist for live-only audits in TODO_handoff.md, perf sampler for the panel position tracker (only Notes is wrapped), R5 D1 capture-path re-check, stable folder uid, user-facing docs/README for the new options, folder-level "Move to Notes (tabbar)" menu (notes only), live Zen verification of everything in E-a..E-c.

# PLAN 2026-11-03 (session "S5"): owner wishlist, grouped in cycles by token cost

Written for the next AI. Version in the tree: **3.1.4**. Read `AGENTS.md` (version bump rules) first.
Token rules: read only the function you change (`grep -n` first, then `sed -n a,bp`), never `cat` the 9.5k-line
`additional/notes/ZentralNotes.uc.js`. Run only the test file of the area you touched, the full suite once at the end
of a cycle. Tests use fake DOMs (`tests/helpers/fake-dom.cjs`); copy the nearest existing test as a template.
After each cycle: bump patch version everywhere (AGENTS.md), `node tools/build-preferences.cjs`,
`node tools/build-standalone.cjs`, `--check`, `node tests/standalone.test.cjs`.
"Stupidity" ratings are honest: 0 = obviously good, 5 = please talk the owner out of it.

## State at the start of this plan (done in S5)

- Fixed tests: `notes-p4-ui` (read mode via Ctrl+E), `notes-p4-recovery` (slug `plan-1`, strict anchors).
- More menu: "Import & export" submenu (`showMenu` supports `{group:[...]}` with a Back row).
- Reveal strip: one owner bar (`revealOwner()`), none while any sheet is open (Triple View bug).
- Panel reserve: Notes repeats `zentral-notes-reserve` after 1 frame + 300 ms; geometry module re-applies the reserve
  when the panel's style changes; the floating/docked panel (`ZentralPanelEnhancements.js`) now subtracts the reserve
  in `area()` and re-applies on the event. **All of it is unverified in real Zen.** If "panel does not shrink" still
  happens live, log `--zentral-notes-panel-reserve`, `root.style.marginBottom` and `ctx.floating.owns(root)` at open.
- Still open from the old list: Zen folder live test, folder-level Move-to-Tabbar, static audits, owner checklist,
  perf sampler gap (panel position tracker), D1 capture re-check, stable folder uid, README/user docs for the new options.

## Cycle F: cheap and fast (do first, one session, mostly UI wiring + prefs)

| #   | Item                                                                 | Stupidity | Notes / options                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | Date notes as a choice when creating a note                          | 0         | New note button opens a tiny popover: "Blank note" (default, focused, Enter) / "Today" / "Tomorrow" / "Pick date". Esc or any typing = blank note. Option: pref `new_note_chooser` (off = old behavior). Reuse the existing date-note functions (`showDateMenu`).                                                                                                                                                                              |
| 8   | Ctrl+F: highlight matches, next/prev arrows incl. off-screen matches | 0         | Today find has no visible highlight. Edit mode: a textarea cannot paint highlights; use a mirrored backdrop div (same font/padding) with `<mark>` spans, or only select the match (`setSelectionRange`) and scroll it into view. Cheapest correct: select + scroll + counter "3/17" + Up/Down arrows + Enter/Shift+Enter. Read mode: wrap matches in `<mark>` after render. Ask owner: backdrop (heavier, prettier) or selection only (cheap)? |
| 10  | Tree order: files before subfolders (or custom)                      | 0         | Pref `tree_order`: `folders-first` (today) / `notes-first` / `mixed-by-name`. One comparator in the tree builder (`notes-tree.test.cjs` covers it).                                                                                                                                                                                                                                                                                            |
| 11  | Callout dropdown                                                     | 0         | Replace the many callout buttons by one split button: click = last used, caret = menu with icon + name of every callout type (incl. Obsidian types, see Cycle G #1). Reuse `showMenu`.                                                                                                                                                                                                                                                         |
| 19  | Easier label management                                              | 1         | A "Labels" dialog: list, rename, recolor, merge, delete, count of notes. Today a label is a string on a note; keep it, add the dialog and a `store.renameLabel(old,new)` that rewrites notes in one pass.                                                                                                                                                                                                                                      |
| 24  | More colors (notes + highlight)                                      | 0         | Today `NOTE_COLORS` and `HIGHLIGHT_COLORS` are fixed lists. Add 4-6 more and a "custom hex" entry stored in meta; validate with the existing color cleaner (`/^#[0-9a-f]{6}$/`). Highlight syntax already `=={color}text==`: extend the allowed names AND keep unknown names as plain text.                                                                                                                                                    |
| 15  | Reminder time resolution                                             | 1         | Owner asked: force 5 min or not. Advice: do NOT snap to 5 min (typing 16:43 and getting 16:45 is a lie). A 30 s timer tick gives 1-minute resolution at no real cost; show "Will ring at 16:43 (in 12 min)" under the input. Round seconds to 0. Only recurring reminders may be snapped.                                                                                                                                                      |
| 6a  | Zen folder: no `about:blank#zn-new` tab                              | 2         | Creating the folder must not leave a placeholder tab. Make "New note in this folder" an opt-in pref `zen_folder_new_button` with a proper label ("New note"), default OFF. Find the code that creates the placeholder (`grep -n "zn-new"`). Needs live testing: say so in the final report.                                                                                                                                                    |
| 3   | Demo / showcase notes                                                | 0         | A "Help & syntax demo" set of 3-4 notes (syntax tour, links between notes, reminders, callouts) created on demand from Settings ("Install demo notes"), idempotent by fixed ids. They double as a manual bug-hunt fixture. Put the owner's torture test in there, with the unsupported parts labeled by compat mode.                                                                                                                           |
| 20  | Token saving                                                         | -         | This whole plan is ordered for it; keep every cycle to ~1 session.                                                                                                                                                                                                                                                                                                                                                                             |

Cycle F advice for the future AI: all of these are pref + one function + one test. Add the pref to the settings schema
(`settings.json`, `preferences.json` generated by `tools/build-preferences.cjs`), then the Notes quick/all settings
registration; mirror the pattern of `hub_descriptions` (grep it, it touches every place you need).

## Cycle G: medium (parser, menus, data model)

| #   | Item                                                  | Stupidity | Notes / options                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1/4 | Markdown compatibility mode                           | 1         | Pref `markdown_flavor`: `obsidian` / `github` / `reddit` / `mixed` (default: mixed = everything that does not collide). Collisions to resolve per flavor: `H~2~O` (GFM strikethrough vs Pandoc subscript), `^word` (Reddit superscript vs Obsidian block id at line end), `                                                                                                                                                           |                                                                                                                                                                                                                                                                                                   | x                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |     | `and`>!x!<`spoilers,`[!NOTE] Title`(Obsidian only),`[[wikilink]]`vs plain text,`==highlight==`(Obsidian) vs nothing (GFM),`:emoji:`, `$`math (GitHub and Obsidian yes, Reddit no),`%%comment%%`, task statuses `[-] [/] [?]`. Table in `docs/`of what each flavor does. **Round trip rule (#4):** the file on disk must stay valid for the source app: never rewrite`[[x]]`into`[x](x.md)`silently; keep the original text and render it. Wikilinks and`![[embed]]`become real features (resolve by title,` | alias`, `#heading`, `#^block`). |
| 5   | Click the tool first, then select                     | 2         | "Armed" tool: click Bold, button stays highlighted, the next selection gets bold when the mouse is released (`mouseup`/`selectionchange` once), Esc disarms. Pref `tool_arm_mode` (off/on). Caveat: for list/heading tools there is no selection, so they stay instant.                                                                                                                                                               |
| 9   | Context menu (RMB) in the notes tree                  | 1         | Items: open, rename, duplicate, move to folder, copy link, pin, color, label, trash, "new note here", for folders also new subfolder/rename/delete/move to Tabbar (closes old item 5). Multi-select (Ctrl/Shift click) then the same menu acts on all. Use `showMenu` anchored at the pointer (`placeMenu` takes an anchor rect: pass a 1x1 rect).                                                                                    |
| 12  | Hold LMB on a tool for its variants                   | 1         | Existing `holdButton`/`createHoldAction` already does long press. Use it for checkbox -> `[ ] [x] [-] [/] [?] [!]`, heading -> H1..H6, callout (see #11).                                                                                                                                                                                                                                                                             |
| 13  | Link to a heading + backlink under that heading       | 2         | Link dialog already picks `#heading` (strict slug). New: after inserting, offer "Add link back" which inserts `[Source title](source.md)` (or `[[wikilink]]` in obsidian flavor) as a line directly under the chosen heading in the target note, or at the top if it has no headings. Idempotent (do not add twice: search for the same link line). Pref for the default answer. Write through `store` so history/versioning sees it. |
| 14  | Several reminders per note, tuning, link to the place | 2         | Data: `remind` becomes `reminders: [{id, at, repeat, anchor:{slug                                                                                                                                                                                                                                                                                                                                                                     | line}, sound:{vol,ms}, flash:n, where}]`; migrate the old single `remind`. Notification placement/blink/sound are settings, test with a "Try it" button. The reminder row shows "from: ## Heading" and clicking opens the note scrolled there (`headingOffset`). Sound: Web Audio beep, no files. |
| 17  | Performance audit and perf settings                   | 1         | Finish the sampler (also wrap the panel position tracker), then list every timer/loop/observer with its interval in a table in Settings -> Performance with a toggle or interval where sensible (autosave debounce, reminder tick, bar sync 60 ms, layout rAF, hover grace). Rule: a setting only where the owner can notice a difference.                                                                                            |
| 26  | HTML compat subset                                    | 1         | Safe allow-list rendered by the existing parser, never `innerHTML`: `h1-h6`/`p`/`div` with `align=left                                                                                                                                                                                                                                                                                                                                | center                                                                                                                                                                                                                                                                                            | right`, `img`(https only,`alt`, `width`, `height`), `a href`(http/https/#anchor),`br`, `b i em strong u s sub sup kbd mark small code pre`, `details/summary`(exists),`hr`, `table/tr/td/th`. Everything else stays visible as text (README promise: "markup is never run as HTML"). Remote images: Notes currently only loads local assets; badges (`img.shields.io`) need a pref `allow_remote_images`(default off, with a placeholder box showing the alt text). Clickable anchors`#install-...` scroll in the note. Fenced ` ```text ` blocks must keep working. Owner's README snippet is the test fixture. |
| 22a | Prepare the split of `ZentralNotes.uc.js`             | 1         | See Cycle H #22. Only extract pure code now (it is already marked "Pure core").                                                                                                                                                                                                                                                                                                                                                       |

Cycle G advice: parser changes go in `parseBlocks`/inline parser; add the fixture to `tests/notes-markdown.test.cjs`
first, red, then implement. Keep exports (HTML/text) in step: `exportHtml`, `exportText`.

## Cycle H: expensive (new subsystems; one feature per session)

| #   | Item                                        | Stupidity | Notes / options                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6b  | Robust Zen folder identity                  | 2         | Problem: several "Notes" folders can appear and the wrong one may delete itself. Do: store a stable uid (pref + `data-zn-folder-uid` attribute / folder label suffix invisible char is a hack, avoid) and resolve the folder by uid, never by label; adopt the first match, never delete a folder that holds tabs the user added; on startup dedupe (merge tabs into the adopted one, remove only empty duplicates created by us). Kill switch stays. Not hidden like the addon-id folder: show a clear label. Needs live Zen: write the owner checklist first (`docs/NOTES-ZEN-FOLDER-BLOCKER.md`).                                                                                                                                                                                                                                                                                                                               |
| 16  | Calendar view                               | 2         | Month grid in the sheet: dot per day with notes (created/ date notes) and reminders; click a day = list + "new note for this day" + "remind me"; arrows for months. Data comes from existing date notes and reminders (needs #14). Option A: month only (recommended). Option B: week/agenda too (scope creep).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 25  | Interactive read-mode elements (bingo etc.) | 3         | Options: (1) extend Markdown with fenced blocks the app owns: ` ```bingo `, ` ```poll `, ` ```counter `; state saved in the note as a trailing comment line, so the file stays plain text; no HTML needed, fully safe, other apps just show a code block. **Recommended.** (2) Interactive checkboxes in task lists in read mode (cheap, do first: click toggles `[ ]`). (3) Safe-HTML `<input type=checkbox>`: poor round trip, skip. (4) Sandboxed iframe with user JS: powerful, dangerous in a chrome-privileged context: refuse. Bingo = a block type with `rows` text and a state bitmap.                                                                                                                                                                                                                                                                                                                                    |
| 21  | Standalone Notes with panel-like docking    | 3         | Copy only the geometry ideas (edge snap, push page, hover reveal) from the floating panel module into the standalone adapter (`createFloatingAdapter` already has `push`). Hard rule from owner: never open at the same time as the Zentral panel; when Zentral's panel is open, standalone Notes closes and re-opens as the panel-hosted sheet (use `bindings`/`followKind` that already moves Notes between bars). Detect with `#zen-app-panel-root[open]`. Test: both on/off orderings.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 22  | Split the big file                          | 2         | When: after Cycle G (parser and menu work are done), not before: every split costs tokens in rewiring. How: (a) pure core (parser, slugs, dates, history, tree, geometry math) -> `ZentralNotesCore.js`, no browser access, loaded by both the tests and the bundle; (b) store/IO -> `ZentralNotesStore.js`; (c) sheet UI -> `ZentralNotesSheet.js`; (d) bar bindings + startup -> `ZentralNotes.uc.js` (thin). Sine loads only `loader/Zentral.uc.js`: register the new files in `loader/ZentralCatalog.js` as `sources` of the notes feature (AGENTS.md rules 2 and 10), and make `tools/build-standalone.cjs` concatenate them (look at how `video` bundles `controllers/*.js`: copy that manifest style in `additional/notes/standalone.json`). Tests currently read the one file as text and run it in `vm`: update their loader helper once (`tests/helpers`) instead of per test. Keep the `__zentralNotesTestSeam` export. |

## Ideas from the AI (cheap to medium, owner may veto)

- "Quick capture" global shortcut that appends a line to today's note without opening the sheet (stupidity 1).> instead i think we could add something like that to RMB menu
- Templates for new notes (meeting, daily, checklist) chosen in the new-note chooser (Cycle F #7) (1). > few like that and ability for user defined one
- Note-wide outline panel from `headingsOf` with click-to-jump (0, nearly free). > sure
- Word/character/reading-time counter in the footer, off by default (0). > sure
- Pinned notes strip and recent notes list in the sheet header (1). > why not
- Trash auto-empty after N days (pref) with a warning (1). >sure also add it to RMB menu in notes tree, its a perfect place for it
- Link checker: "broken note links" list (uses the existing link parser) (1). > sure
- Tags: `#tag` index with filter in the list (Obsidian parity) (2). > not 100% sure but we can try it
- Export a folder as one zip keeping the tree, import Obsidian vault with `[[links]]` untouched (2, belongs with #1/#4). >sure
- Print stylesheet for PDF export (1). > okey decide if do it as option or make it default
- Spell-check toggle and language per note (1). >sure, add settings to performence settings too so user can tweak it
- Idea to refuse: syncing through a cloud service from inside the mod (4). Use the profile folder and let the user sync it. > for now NO, maybe after we finish whole mod we will do sync of everything, for now NOOOO

## Open questions for the owner (answer before the cycle that needs them)

1. Ctrl+F highlighting: backdrop mirror (pretty, heavier) or select-and-scroll (cheap)? (Cycle F #8) honestly let do both selectable in settings>performence
2. Reminder tick: 1-minute resolution with a live "rings at" preview OK? (Cycle F #15) Yes
3. Interactive blocks: go with owned fenced blocks (` ```bingo `)? (Cycle H #25) i let you decide on how to do it best, if possible i rather have this made by some recognized standard (maybe shortcut to it)
4. Is `about:blank#zn-new` really wanted as an opt-in "New note" row in the Zen folder, or drop it? (Cycle F #6a) let user decide, make it optional
