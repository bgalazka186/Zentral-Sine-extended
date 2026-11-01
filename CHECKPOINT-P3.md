# CHECKPOINT P3 (for the next AI) - Notes: Zen folder, note links, writing-tool UI

Baseline = git HEAD `146f159` PLUS the uncommitted P2 work already in the supplied zip (search, pictures, reminders). This checkpoint's diff contains P2 + P3 together (`checkpoint-p3.diff`). Version in tree: 3.1.3 (unreleased). Nothing was run in real Zen; Node/fake-DOM only.

## Read first
`AGENTS.md`, `TODO_handoff.md` (P2 and P3 sections at the end), `docs/NOTES-FOLDERS-ZEN-SYNC-SPEC.md`, `docs/NOTES-ZEN-FOLDER-BLOCKER.md`.

## State
| Part | State | Where |
| --- | --- | --- |
| A Zen-native NOTES folder | **NOT shipped (blocked).** No pref, nothing wired. Inert pure groundwork only. | `projectNotesFolder`, `diffProjection`, `planCleanup`, `dropDecision`, `urlNoteBody`, `NOTES_ATTR` in `additional/notes/ZentralNotes.uc.js`; `tests/notes-zenfolder.test.cjs` |
| B Note links | Done (Node). | pure core "links between notes"; parser node `nl`; `renderInline`; `askNoteLink`, `showBacklinks`; `exportBody`; `tests/notes-links.test.cjs` |
| C Writing tools in UI | Done (Node). | toolbar `tNoteLink`; More menu entries; `showMenu` arrow keys + `disabled` heading rows; `tests/notes-writing-ui.test.cjs` (inventory `WRITING_UI`) |
| Cheap scan (drag/resize/z-index/timers) | **NOT started.** | |

## Decisions and contracts
- Note link = ordinary Markdown `[label](<encodeURIComponent(id)>.md)`; id = file name without `.md`; only relative, no scheme/slash/`..`. Anything else stays an ordinary link or text. Link nodes have NO href (no network, no navigation).
- `[[Title]]` / `[[Title|label]]` = editor shorthand: expanded at draw time (`readBody`) and on export; never written to files. Duplicate titles: newest `updated` wins, then smaller id. Code fences and inline code are skipped (`mapOutsideCode`; indented code blocks are NOT skipped).
- Export: single-note export keeps `id.md` links (notice says so); "Export all" / zip rewrite to exported file names (`exportBody` + `uniqueFileNames`).
- No default shortcut for `noteLink` (Ctrl+Shift+J is the Firefox Browser Console; Ctrl+Alt+letter is AltGr on Polish layouts: never default Alt).
- A tool hidden through Customize toolbar is fully gone (button, menu entry, shortcut) - existing behaviour kept; the brief asked hidden buttons to stay reachable through a menu: OWNER DECISION pending.
- Sheet `env` is `Object.create(callerEnv)` + `noteInfo`/`openNoteLink` (a copy broke live pref changes in tests).
- Folder ids are PATH based: renaming a folder changes its id. A stable folder uid is a prerequisite for a rename-proof Zen projection.
- "Zentral Video Fake ID" folder does not exist; the real mechanism is the add-on host folder (see blocker doc).

## Verification done (Node)
All suites pass: standalone, notes, notes-capture, notes-ui, notes-markdown, notes-bars, notes-window, notes-tree, notes-quick-settings, notes-docked-reserve, notes-gap-resize, notes-slot-geometry, notes-p2, notes-p2-ui, notes-links, notes-writing-ui, notes-zenfolder, numeric-prefs, encoding, z-heights, resize-perf, defaults, notes-decisions, notes-icon. `node tools/build-standalone.cjs` (lock reset to 3.1.2 first, rebuilt as 3.1.3), `--check` clean, `build-z-map.cjs` run, `git diff --check` clean. NOT run: `build-preferences`, `check-settings-consistency`, `check-default-drift` (no schema/pref change was made in P3).

## Still to do
1. Cheap scan (overlapping drag/resize targets, z-index/pointer-events, panel-switch restore, reserve release, stale gestures, timer/listener cleanup) with targeted greps; fix only confirmed bugs.
2. Part A only after the live facts in the blocker doc are verified (Sync exclusion, drop cancel, stable folder uid).
3. Optional: backlinks as a persistent panel; heading anchors in note links (`#h` is parsed and ignored); `[[` autocomplete while typing; note-link shortcut default.
4. Live Zen checklist: note-link picker, read-pane click opens exact note, missing/trashed styling, More menu items, menu arrow keys, toolbar wrapping in a narrow sheet; plus the P2 checklist (Ctrl+F, pictures, reminders) and the original acceptance list 1-4.
5. Never mark P3 DONE until the live checks pass.

## Apply
`git apply --check checkpoint-p3.diff` on a clean checkout of HEAD `146f159` plus the P2 uncommitted files is NOT needed: the diff already includes P2 against HEAD. Standalone bundles are generated: after any edit run `node tools/build-standalone.cjs` (reset lock version first, see handoff section 5).
