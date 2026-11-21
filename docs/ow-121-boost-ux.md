# OW-121 — Boost UX: responsive, readable widget

Date: 2026-11-19; narrow-sidebar readability follow-up: 2026-11-21. Current repository version is **3.4.3**.

The original OW-121 request was to add the four Boost actions without growing the old compact menu. A later owner-directed
readability pass replaces that one-row constraint at narrow widths: a 2×2 action grid and a readable value/label are
preferred over clipping or ellipses in the 170 px sidebar. The original language semantics, action IDs, level attributes,
click behavior, Restore details, seating, Widgets independence and Game Mode engine remain unchanged.

## 1. Responsive, readable action grid

The existing inline popup stays in normal flow. Under 280 px the four compact buttons use a **2×2 grid** with short
visible labels; at and above 280 px they use a one-row four-column layout. The header preserves the existing translated
`card.title` text beside the RAM value. Action labels use the existing short EN/PL strings; action titles and accessible
names keep the full translated descriptions and Restore counts. The old vertical "more actions" note and the OW-115
disabled explanation row are not appended.

## 2. Deep clean also does Light clean

`additional/boost/ZentralBoost.uc.js` now has one shared `lightClean()` action list: reporter-manager minimize + GC/CC, with a guarded 50 ms fallback and a cleanup hook. `runLevel1()` uses it for the existing light pass. **Every** `runLevel2()` now awaits it before the tab/panel sweep. There is no second 3 s settle and no second after-reading: the deep pass keeps its single honest `beforeMB → afterMB` result and adds `light: { by: "minimize" | "gc-cc-only" }`. The fallback build without an unload API still returns `runLevel1()`, which also performs the light clean.

## 3. Deterministic level descriptions

Both widget languages have one-line descriptions, shown in the buttons' `title` tooltips rather than as extra visible rows:

- **Light** — GC/CC + memory minimize. No tabs touched.
- **Deep** — Light clean first, then eligible tabs sleep. Restore available.
- **Game Mode** — pauses repeating features and idles non-essential browsers.
- **Restore** — reloads what was unloaded: panels as panels, tabs as tabs (updated by the Restore follow-up).

The Deep card's tooltip also folds in the OW-115 grouped skip reasons and pinned/unpinned loaded-tab counts. These are tooltips: they do not affect layout height.

## 4. Short post-run result line

`boostResultText()` now appends ` · skipped N protected tab(s)` to the **existing** toast when a run reports grouped `skippedCounts`. The count comes from the full grouped object, never OW-115's bounded five-entry sample. A result with no skip data keeps the old short line. No new result row was added under the card.

## Responsive layout, contrast and status

`additional/boost/ZentralBoostWidget.css` owns the responsive card: a 2×2 narrow action grid switches to four columns at
280 px, with no fixed 26 px row or forced text clipping. The translated card title and RAM value share the header; narrow actions use
short translated labels, and Restore shows a compact count badge while preserving the long title/ARIA count. Toasts are
multiline blocks with a full-width action when one is present. Game Mode ON retains its checked state and a visible marker.

The localized `card.title` and value share the header. The sidebar text color and text-derived translucent surfaces and
buttons are used throughout. Toast copy wraps in full without line clamping, and disabled action text is not dimmed. A
pure WCAG contrast helper composites ancestor alpha backgrounds for at most 12 levels; one-shot checks run at mount,
card paints/refreshes, workspace switches and dark-scheme changes. Below 4.5, a luminance-selected self-contained palette
is activated by `data-zbw-contrast="forced"`. There is no polling and no root-style observer. Hidden/compact and
`[hidden]` rules remain unchanged. Automated source/DOM checks and the shipped `docs/boost-widget-preview.html` are not
live browser evidence.

## Validation

- Historical OW-121 validation and suite totals remain above as a snapshot; the current responsive restyle is covered by `tests/boost-widget-look.test.cjs` (9/9), `tests/ow-121-boost-ux.test.cjs` (5/5), `tests/boost-standalone-widget.test.cjs` (15/15) and `tests/g7-game-mode-feedback.test.cjs` (9/9).
- The standalone source rebuild/check (`node tools/build-standalone.cjs --keep-version && node tools/build-standalone.cjs --check`) passes. The exact release/build/test chain for this follow-up is recorded in the current handoff; no generated bundle or lock is hand-edited.

*Historical snapshot:* the `599 Sine preferences` and `282/282` figures above belong to the OW-121 cycle. Later `OW-127` added two prefs (`601`) and the post-batch regression sweep raised the docs-inclusive suite to `294/294`; see `docs/bugfix-2026-11-18.md`.

## OWNER GATES — OPEN

No live Zen/Sine runtime or screenshot is available here. Inspect `docs/boost-widget-preview.html` at 170 px in its light,
dark, owner-like and deliberately low-contrast themes, confirming value/label, all four actions, Restore badge, Game Mode
ON and multiline toast are readable and unclipped. Then verify the real 170 px sidebar in light and dark, including the
value, four buttons, badge and Game Mode toast. Historical W1–W7 gates also remain open until their owner evidence arrives.
Real RAM figures, frame rate or live visual results are not claimed as measured here.
