# OW-121 — Boost UX: four propositions, no added height

Date: 2026-11-19. Version stays **3.4.0**. Branch: `arena/26d4c40b-zentral-sine-extended`.

The owner asked: “for bnoost feature do all 4, but dont make it any bigger in height”. The four propositions from the end of the OW-120 cycle were implemented together. No new pref, timer, listener, card row or setting was added.

## 1. Three clear level cards instead of a drop-down list

The arrow still opens the existing inline popup in normal flow, but it is now a **single horizontal group** of four compact buttons: **Light**, **Deep**, **Game** and **Restore**. The first three carry `data-zw-boost-level="light|deep|game"` and a small card border. The old long labels remain in `aria-label`, so the visible row stays narrow. The old vertical "more actions" note and the OW-115 disabled explanation row are no longer appended.

## 2. Deep clean also does Light clean

`additional/boost/ZentralBoost.uc.js` now has one shared `lightClean()` action list: reporter-manager minimize + GC/CC, with a guarded 50 ms fallback and a cleanup hook. `runLevel1()` uses it for the existing light pass. **Every** `runLevel2()` now awaits it before the tab/panel sweep. There is no second 3 s settle and no second after-reading: the deep pass keeps its single honest `beforeMB → afterMB` result and adds `light: { by: "minimize" | "gc-cc-only" }`. The fallback build without an unload API still returns `runLevel1()`, which also performs the light clean.

## 3. Deterministic level descriptions

Both widget languages have one-line descriptions, shown in the buttons' `title` tooltips rather than as extra visible rows:

- **Light** — GC/CC + memory minimize. No tabs touched.
- **Deep** — Light clean first, then eligible tabs sleep. Restore available.
- **Game Mode** — pauses repeating features and idles non-essential browsers.
- **Restore** — wakes sleeping panels; sleeping tabs reload on click.

The Deep card's tooltip also folds in the OW-115 grouped skip reasons and pinned/unpinned loaded-tab counts. These are tooltips: they do not affect layout height.

## 4. Short post-run result line

`boostResultText()` now appends ` · skipped N protected tab(s)` to the **existing** toast when a run reports grouped `skippedCounts`. The count comes from the full grouped object, never OW-115's bounded five-entry sample. A result with no skip data keeps the old short line. No new result row was added under the card.

## No added height

`additional/widgets/ZentralWidgets.css` pins the open popup to `height: 26px`, `max-height: 26px`, `flex-direction: row`, `flex-wrap: nowrap` and `overflow: hidden`. Each button is `height: 20px`, `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, with compact padding. The popup contains exactly four buttons; the note and skipped row are gone. The closed card's DOM is unchanged. This is a static CSS/DOM guarantee, **not** a live browser measurement.

## Validation

- New `tests/ow-121-boost-ux.test.cjs`: RED on the pre-OW-121 tree, GREEN here (6 passed). It drives the real widget core, a fake sidebar DOM and a fake Gecko Boost runtime; it checks light-before-deep order, the result suffix, one-row CSS, four-button DOM, both languages, docs and generated bundles.
- Updated `tests/widgets-boost-card.test.cjs` for the compact labels and accessible full Restore count; all existing Boost/widget/OW-89/OW-91/OW-110/OW-115/OW-118 suites stay green.
- Exact `--keep-version` chain: `CHAIN_GREEN` — 12 standalone packages, `599 Sine preferences`, z-map `42/72/3`, `catalog checks passed`, `defaults agree`, `Standalone packages are up to date`. Generated Boost/Widgets standalone scripts and locks were rebuilt by `tools/build-standalone.cjs`, never hand-edited.
- Docs-inclusive full suite: `282/282 passed; 0 failed` (`325.2 s` combined runtime / `120 s` wall), `0 TODO failing: none`, `DOCS_INCLUSIVE_SUITE_EXIT=0`. `git diff --check` clean.
- No `--bump` or version change; `tools/sync-version.cjs` is only the exact chain's no-op 3.4.0 check. No ZIP or `.git` archive.

*Historical snapshot:* the `599 Sine preferences` and `282/282` figures above belong to the OW-121 cycle. Later `OW-127` added two prefs (`601`) and the post-batch regression sweep raised the docs-inclusive suite to `294/294`; see `docs/bugfix-2026-11-18.md`.

## OWNER GATE

No live Zen/Sine runtime or screenshot is available here. OWNER GATE: open the Boost popup in the live sidebar and confirm the four cards fit on one row, the widget's height is unchanged or smaller, tooltips are readable in en/pl, Deep visibly reports the light clean + skipped tabs, and ordinary light/deep/Game Mode/Restore actions still behave. Real RAM figures, frame rate and live visual height are not claimed as measured here.
