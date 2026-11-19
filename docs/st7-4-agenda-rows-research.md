# ST7.4 — Agenda rows without real tabs: prototype report

**Date:** 2026-11-18 · **Research base:** `12be5b84` (`T4.3c`) · **Status:** research DONE, runtime prototype NOT shipped · **Version:** 3.4.0

> Verification limit: no live Zen/Sine runtime was available in this workspace. This report is a static source-and-test investigation of the checked-out repository. It makes **no claim** that a non-tab row has been rendered, hovered, dragged, restored or accepted by a real `zen-folder`. Interactive conclusions are design findings and require a live-Zen gate before any code ships.

## 1. Question and acceptance

`ST7.4` asks whether Zen's folder DOM can host Agenda rows that are **not real pinned `about:blank` tabs**, while keeping the same hover and drag behaviour. The roadmap's done condition is a **Prototype report**. That report is this document. The roadmap also says to prototype behind a flag and abandon the idea if Zen internals fight it; Section 5 gives the flag-gated prototype design and Section 6 records the static abandon decision.

## 2. What was examined

- `additional/notes/ZentralNotes.uc.js` — Agenda projection, pseudo-tab creation, hover-card wiring, mouse/drag guards, session filters and the pure sidebar plan functions.
- `loader/ZentralRuntime.js` — `createSidebarHoverCard()` and its `matchTarget` / `isValid` contract.
- `additional/notes/zen/ZentralNotesZenSidebar.js` — T4.3c's pure sidebar decisions.
- `tests/helpers/fake-zen-browser.cjs`, `tests/helpers/real-zen-sidebar-dom.cjs` and the 39 `notes-agenda*`, `notes-sidebar*`, `zen-sidebar*` suites — fake DOM regressions, not live Zen.
- `TODO_notes_roadmap.md` §`ST7.4` and the ST7.1 shared-projection guards.

## 3. Current architecture (static findings)

Agenda rows are real browser tabs:

1. `agendaNewTab(key)` creates `about:blank#zn-agenda-<key>` through `addManagedPseudoTab()`, sets `AGENDA_ATTR`, pins the tab with `gBrowser.pinTab()` and parks it (`ZentralNotes.uc.js:33192`).
2. `agendaEnsureRoot()` and `agendaMakeDay()` call `window.gZenFolders.createFolder([seed], …)` with a **pinned pseudo-tab as the seed** (`:33338`, `:33435`). Day folders and the root are therefore native Zen folders built from tab nodes.
3. Identity is a mix of `AGENDA_ATTR`, the pseudo-URL, `_zentralNotesUrl`, SessionStore entries and attributes such as `bgalazka-notes-agenda-item-id` / `record-id` / `start` / `end` (`agendaTabKey()`, `agendaTabIdentity()`).
4. Hover cards are target-agnostic in the runtime engine: `createSidebarHoverCard()` calls `matchTarget(event.target)`, `isValid(target)` and `position()` (`loader/ZentralRuntime.js:347`, `:359`, `:654`). Notes currently supplies `agendaTabFromNode = node.closest('tab[bgalazka-notes-agenda-item]')` and `agendaValidTab` (`ZentralNotes.uc.js:33509`, `:33512`).
5. Pointer activation and drag guards are tab-specific: `onAgendaMouse()` starts from `pseudoEventClosest(ev, "tab")`; `onAgendaDrag()` reads `dataTransfer.mozGetDataAt("application/x-moz-tabbrowser-tab", 0)` and calls `CALENDAR_PART.blockAgendaDrag()` (`:34980`, `:35043`). `ZEN_TAB_EVENTS` listens for `TabClose`, `TabUnpinned`, `TabPinned`, `TabMove`, `TabBrowserDiscarded`, `SSTabRestored` (`:35538`).
6. Session hygiene removes pseudo-tabs and managed folders from Zen/Firefox snapshots (`filterSessionStoreState()`, `STALE_PSEUDO_TAB_ATTRS`, `filterSessionFilePayload()`). That code exists precisely because real tabs leak into session, sync and tab-cycling state.
7. The pure `noteTabDropPlan()` / `noteDropTarget()` / `dropDecision()` decisions model a drop onto a tree row, but the roadmap's own handoff says the live Zen tab-drag gesture is still LEFT; no generic non-tab drag controller exists in the source.

## 4. Feasibility by capability

| Capability | Current tab contract | Non-tab row requirement | Static risk |
| --- | --- | --- | --- |
| Folder creation | `gZenFolders.createFolder([seedTab])` | Zen must accept a non-tab child or a folder created without a tab seed | **High.** No evidence in this checkout that Zen accepts arbitrary children. |
| Row identity | tab attributes + pseudo-URL + SessionStore | `data-agenda-key` and item/occurrence/record attributes on a custom element | Medium; identity model is portable, recovery paths are not. |
| Hover card | `closest('tab[AGENDA_ATTR]')` | `closest('[data-agenda-row]')` plus a new `isValid()` | **Low-Medium.** Runtime engine is target-agnostic, but tooltip suppression, focus and popup events assume a tab node. |
| Click / keyboard | `onAgendaMouse()`, `onAgendaKey()`, `TabSelect` | custom `click`, `keydown`, focus, `role="button"`, `tabindex` | Medium; stationary-press and single-fire click logic must be rewritten. |
| Drag | native tab drag + `application/x-moz-tabbrowser-tab` | custom HTML5 drag/drop inside `zen-folder` | **High.** Zen's own folder drag handling may reject or reparent unknown nodes. |
| Close action | `TabClose`, `agendaOnTabClosed()`, hide-today keys | custom close button + state removal | Medium. |
| Session / workspace | `TabAttrModified`, `SSTabRestored`, workspace-id on tab/section | custom persistence and workspace tagging | **High.** This is the root problem the research wanted to remove, but custom rows still need a persistence story. |
| Styling / density | tab selectors, pinned/pending CSS | new CSS for a custom row, compact mode, collapsed folder, space indicator | Medium; OW-114 owner gate already shows these visual claims cannot be verified here. |

## 5. Flag-gated prototype design (NOT shipped)

If a live-Zen experiment is authorised later, the smallest safe prototype is:

- **Flag:** `zen.workspace.zentral.notes.agenda_dom_rows`, default `false`, hidden from the settings UI, owned by `additional/notes/settings.json` and shipped to both full-pack and standalone catalogs. No new version bump until the owner says so.
- **Row:** `<div class="zn-agenda-row" data-agenda-key="…" data-agenda-day="…" role="button" tabindex="0">` with the same item/occurrence/record/start/end attributes the hover model already reads. Keep `AGENDA_ATTR` as a compatibility marker but do **not** create a `tab`.
- **Two projections behind one entry:** when the flag is off, use today's `agendaNewTab()` / `agendaMakeDay()` path unchanged; when on, render rows into the existing `zen-folder` and suppress pseudo-tab creation, pinning and parking. Turning the flag off removes rows, destroys their listeners and runs the tab projection once.
- **Hover:** extend `agendaTabFromNode()` to accept `[data-agenda-row]` and extend `agendaValidTab()` to accept a connected row inside `agendaRootEl()`. Reuse `createSidebarHoverCard()` unchanged otherwise.
- **Drag:** replace `onAgendaDrag()`'s tab `dataTransfer` read with a row key carried in `dataTransfer.setData("application/x-zentral-agenda-row", key)`; implement `dragstart` / `dragover` / `drop` on rows and `zen-folder`. Call the pure `dropDecision()` / `noteTabDropPlan()` plan only after a live DOM drop resolves a row key.
- **Tests before live Zen:** pure row-model tests, fake-DOM hover/focus/click/drag tests, flag-off fallback tests, session-filter tests that prove no pseudo-tab is created, and a leak audit for every new listener/timer. No screenshot or visual claim without a live browser.
- **Abort switch:** on any error, unknown folder child removal, missing `gZenFolders` contract, or failed drag/restore, set the flag back to `false`, remove all custom rows and fall back to real tabs in the same tick.

## 6. Abandon decision for this workspace

The roadmap says to abandon the prototype if Zen internals fight it. Static evidence already shows three tab-specific internals that a non-tab row cannot reuse here:

1. `gZenFolders.createFolder()` is called with a pinned tab seed for both root and day folders.
2. `onAgendaDrag()` depends on `application/x-moz-tabbrowser-tab` and native tab drag events.
3. `ZEN_TAB_EVENTS`, `TabSelect`, `TabAttrModified`, SessionStore filtering and workspace ownership are tab APIs.

The hover engine could be adapted, but hover alone is not the acceptance criterion. Without a live Zen DOM we cannot prove that `zen-folder` will host, persist, reorder or drag a custom row, and adding a speculative runtime path would create exactly the session/sync risk `ST7.4` is meant to remove. **Decision: no runtime prototype is shipped in 3.4.0. Keep real pinned pseudo-tabs as the only Agenda projection. This report is the prototype deliverable; a live-Zen spike is required before reopening the implementation question.** This is an abandonment of the runtime prototype, not a claim that Zen cannot ever do it.

## 7. Owner / live-Zen gate (unverified)

A future live spike must answer, in a real Zen window:

- Does `gZenFolders.createFolder()` accept a folder with no tab seed, or can an existing folder keep a non-tab child across a restart?
- Do `dragstart` / `dragover` / `drop` reach a custom row inside `zen-folder`, and does Zen's own drag handler reparent or delete it?
- Do hover cards, tooltips, focus, keyboard activation and compact density match a real tab row?
- Are custom rows excluded from session files, Sync, Ctrl-Tab, unload successors, workspace switching and folder collapse?
- Does turning the experimental flag off leave zero custom rows, zero listeners and the unchanged real-tab projection?

None of these were verified here. No live Zen/Sine runtime was used; no visual, drag or session-restore effect is claimed.

## 8. Result

`ST7.4` research is DONE: the current tab-based architecture is documented, a flag-gated prototype design is recorded, the tab-specific blockers are identified, and the runtime prototype is abandoned under the roadmap's own rule. The repository keeps 3.4.0, no new pref, no runtime code, no new timer/listener and no ZIP. Full suite and standalone checks remain the source of truth for the unchanged code.
