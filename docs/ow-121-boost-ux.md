# OW-121 — Boost UX: responsive, readable widget

Date: 2026-11-19; narrow-sidebar readability and compact-color follow-ups: 2026-11-21. Current repository version is **3.4.3**.

The original OW-121 request was to add the four Boost actions without growing the old compact menu. The owner later
asked for readability at 170 px, then corrected the resulting card as too white and roughly three times too tall. The
current target is a compact single row of four readable actions at 170 px, matching the normal Widgets card palette
and mirroring its existing optional background/text overrides. Only genuinely narrower cards fall back to 2×2. The
original language semantics, action IDs, level attributes, click behavior, Restore details, seating, Widgets API
independence and Game Mode engine remain unchanged.

## 1. Responsive, readable action grid

The existing inline popup stays in normal flow. At a 170 px sidebar, about 150 px of card content uses a **single row
of four 24 px actions** with short visible labels. The 146 px card-content boundary uses the **2×2 grid** so every
label and the Restore badge fit inside their button; below 150 px the same readable fallback applies. At 280 px and
above, the header and four-action row use the wide container layout. The header preserves the
translated `card.title` beside the RAM value. Action labels use existing short EN/PL strings; action titles and
accessible names keep full descriptions and Restore counts. The old vertical "more actions" note and OW-115 disabled
explanation row are not appended.

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

`additional/boost/ZentralBoostWidget.css` owns the responsive card: 150–279 px uses one compact row of four actions,
under 150 px uses the 2×2 fallback, and at 280 px the header joins the action row. Action buttons are 24 px tall;
the 146 px boundary uses two columns so short labels and Restore's compact count badge fit without overflowing. Restore
preserves the long title/ARIA count.
Toasts are multiline blocks with a full-width action when one is present. Game Mode ON retains its checked state and
visible marker; the marker is CSS-drawn so it does not reduce the translated action label's width.

The default card surface, text token and neutral button treatments match the normal Widgets card: the background uses
the same `--zen-colors-tertiary` 78% blend rather than tinting with the text color. Boost reads the Widgets tray's
existing `--zw-card-bg` / `--zw-card-text` inline overrides and mirrors them to its own card. The existing two
appearance preferences are observed with one-shot, lifecycle-owned listeners; a 0 ms scoped callback lets Widgets
finish repainting its tray first. Reset removes the local copies and returns to the theme. This reads no
`ZentralWidgets` API and installs no polling or tray/root style observer.

Toast copy wraps in full without line clamping, and disabled action text is not dimmed. A pure WCAG contrast helper
composites ancestor alpha backgrounds for at most 12 levels; one-shot checks run at mount, card paints/refreshes,
workspace switches and dark-scheme changes. Below 4.5, a luminance-selected self-contained palette is activated by
`data-zbw-contrast="forced"`. Hidden/compact and `[hidden]` rules remain unchanged. Automated source/DOM checks and the
shipped `docs/boost-widget-preview.html` are not live browser evidence.

## Validation

- Current focused checks: `tests/boost-widget-look.test.cjs` 11/11, `tests/ow-121-boost-ux.test.cjs` 6/6, `tests/boost-standalone-widget.test.cjs` 16/16, `tests/boost-widget-coexistence.test.cjs` 13/13 and `tests/g7-game-mode-feedback.test.cjs` 9/9. The standalone fake-window case exercises initial override copy, both live preference updates, reset and listener teardown.
- Headless Chromium rendered the static preview in all four themes at 146 px host width and the 170 px target, and added an exact 146 px card-content clone in each theme. The host sample yields 130 px of content; both 146 px cases use 2×2, while the target retains one row. At every tested size, button labels and the Restore badge stay within the 24 px targets with no scroll overflow.
- The initial prescribed chain was inadvertently run with `--bump`, briefly advancing the version from 3.4.3 to 3.4.4 without owner authorization. The bump was restored through repository tooling: source version declarations returned to 3.4.3, `node tools/sync-version.cjs --set 3.4.3`, `node tools/build-standalone.cjs --keep-version`, then preferences/z-map generation and build/version checks. Final: 607 generated Sine preferences (144 with free numeric entry), z-map 42/72/3, standalone packages current and all version markers 3.4.3. `node tests/run-all.cjs`: **313/313 test files passed, 0 failed, 0 TODO failures**. No generated bundle or lock is hand-edited.

*Historical snapshot:* the `599 Sine preferences` and `282/282` figures above belong to the OW-121 cycle. Later `OW-127` added two prefs (`601`) and the post-batch regression sweep raised the docs-inclusive suite to `294/294`; see `docs/bugfix-2026-11-18.md`.

## OWNER GATES — OPEN

A headless Chromium render checked the static preview at 146 px host width, exact 146 px card content and the 170 px
target in its light, dark, owner-like and deliberately low-contrast themes. The host sample provides 130 px of card
content; both 146 px cases use 2×2, and all action labels and Restore badges fit inside their 24 px buttons. This is not
a live Zen/Sine sidebar result. Owner-check the 170 px
sidebar in light and dark, including value, four buttons, badge, Game Mode toast and live Widgets override change/reset.
Historical W1–W7 gates also remain open until their owner evidence arrives. Real RAM figures, frame rate or live sidebar
visual results are not claimed as measured here.
