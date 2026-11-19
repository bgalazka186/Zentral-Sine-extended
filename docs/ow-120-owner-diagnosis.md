# OW-120 — owner Browser Console diagnosis (2026-11-18/19)

Source: `uiasdujiasduiuiasdsduji.txt` attached by the owner (5,461,918 bytes, 145,662 lines, valid JSON). It is the output of the temporary `owner-sidebar-console-diagnostics.md` Command 2; the owner ran it and then deleted that temporary file from GitHub in `13755e4` ("delete temp file"). No DOM, preference or stylesheet was changed by the diagnostic; it only read computed styles, rectangles, attributes, matched rules and prefs.

## Run identity / state

- `label`: `collapsed-broken` (owner-set label).
- `context.sidebarState`: **`expanded`** — `rootAttrs["zen-sidebar-expanded"] = "true"`.
- `context.url`: `chrome://browser/content/browser.xhtml`; `chromeDocument: true`.
- `zen-compact-mode = "false"`, but `bgalazka-tabbar-compact = "true"`, `bgalazka-corner-tiles = "true"`, `bgalazka-density-icons = "true"`.
- Arc 2.0 mirrors: `bgalazka-arc-gray-unloaded = "true"`, `bgalazka-arc-fade-unloaded = "true"`.
- Prefs: `arc-grayscale-unloaded-tabs = true`, `browser.tabs.fadeOutUnloadedTabs = true`, `browser.tabs.fadeOutExplicitlyUnloadedTabs = true`, `zen.workspace.zentral.notes.zen_note_favicons = true`, `agenda_position = "above"`, `park_pseudo_tabs` missing.
- Chrome geometry: `#navigator-toolbox` 180 px wide, `#tabbrowser-tabs` 170 px wide, pinned section 180 px wide.

The label says "collapsed", but the captured DOM is expanded. Therefore this is **not** evidence for a Zen-wide collapsed-sidebar override. The regression is in the Notes/Agenda `[pending]` pseudo-tab cascade while compact density/corner tiles are on.

## Exact computed geometry from the JSON

| Target | Rect / computed values |
| :-- | :-- |
| `folders.notesRoot.folder` | `zen-folder[bgalazka-notes-folder]`, width 170 px, `align-items: center`. |
| `folders.notesRoot.header` | width **12 px**, x=2464 inside a folder starting at x=2385 — centred; `justify-content: center`, `flex: 0 0 auto`. |
| `folders.notesRoot.label` | width 32 px, text `NOTES`, `padding-inline-start: 32px`. |
| `folders.agendaRoot` | `zen-folder[bgalazka-notes-agenda-folder]`, header 170 px. |
| `folders.agendaDay` | `zen-folder[bgalazka-notes-agenda-day]`, nested under the Agenda root, header 156 px. |
| `tabs.note.tab` | `tab[bgalazka-notes-item][pending][pinned]`, **26 x 22 px**, `margin-inline-start: 14px`, `opacity: 1`, `filter: none`. |
| `tabs.note.labelContainer` | **0 x 22 px**, `flex: 1 1 0%`, `overflow: hidden`, `contain: inline-size`. |
| `tabs.note.label` | `211.8 x 18.7 px`, text `Where is a function?`, `display: block`, `visibility: visible`. The title exists but is clipped by its zero-width container. |
| `tabs.note.iconImage` | 16 x 16 px, `opacity: 1`, `filter: none`. |
| `tabs.agenda.tab` | `tab[bgalazka-notes-agenda-item][pending][pinned]`, 142 x 22 px, `opacity: 0.69`, **`filter: grayscale(1)`**, `margin-inline-start: 14px`. |
| `tabs.agenda.iconImage` | 16 x 16 px, **`opacity: 0.5`**, `filter: none`. |
| `tabs.agenda.labelContainer` | 100.7 x 22 px, `overflow: hidden`. |
| `tabs.agenda.label` | 237.7 x 18.7 px, text `All day · Long weekend` — clipped by the container. |
| `tabs.normalPinnedLoaded` | 0 x 0, `aria-hidden="true"`, `opacity: 0`. |
| `tabs.normalPinnedPending` | 0 x 0, `opacity: 0.69`, `filter: grayscale(1)`. |

The owner's earlier `0x22px` measurement is confirmed: it is the **`.tab-label-container` / tab row**, not a missing label node. Both the tab `label` attribute and the native `.tab-text.tab-label` value/text are present. The browser/Zen is collapsing the row's inline size and clipping the title.

## Root cause supported by the data

1. `OW-116`'s four Notes-owned `filter`/`opacity` CSS rules in `additional/notes/ZentralNotes.css` require `zen-folder[bgalazka-notes-folder]`. The Agenda rows in this capture live under `zen-folder[bgalazka-notes-agenda-folder]` / `zen-folder[bgalazka-notes-agenda-day]`, so those rules do **not** match the Agenda tab. That is why the Notes tab shows `filter: none; opacity: 1` but the Agenda tab still shows `filter: grayscale(1); opacity: 0.69` and a `0.5`-opacity favicon.
2. `OW-114`'s compact-density overrides in `additional/tabs/ZentralTabDensity.css` also require `zen-folder[bgalazka-notes-folder]`. They cannot protect Agenda rows from the compact pinned/pending geometry.
3. The Notes root header is a 12 px flex item inside a 170 px, `align-items: center` folder, so Zen's `justify-content: center` header is visibly centred. The note tab is a 26 px icon-only row with `margin-inline-start: 14px` and a zero-width label container. The bug appeared after the pseudo-tabs were made fully unloaded/pending to avoid ~50 MB blank content processes; the Arc 2.0 "grayscale unloaded tabs" preference then treats those rows like ordinary unloaded pages.
4. `arc-grayscale-unloaded-tabs` is a third-party preference. The diagnostic's matched-rule collector stops after 120 rules per element (`truncated: true` on every `matched` section), so the exact third-party selectors from late inline sheets are not in this JSON. The computed `filter`/`opacity` values are still enough to identify the affected properties. No custom-sheet follow-up is shipped: the owner deleted the temporary diagnostic after running it, and OW-120 does not re-add it or broaden the fix to unresolved third-party selectors.

## Fix scope (OW-120)

`additional/notes/ZentralNotes.css` now has a narrow `OW-120` block **before** the unchanged `OW-116` colour/opacity block. It uses `:root[lang][dir] #tabbrowser-tabs` plus the three owned folder markers (`bgalazka-notes-folder`, `bgalazka-notes-agenda-folder`, `bgalazka-notes-agenda-day`) and the two placeholder markers (`bgalazka-notes-item`, `bgalazka-notes-agenda-item`) with `[pending]`.

It restores, only for those rows and folder headers:

- `filter: none` / `opacity: 1` on the tab, content, icon stack/image/pending icon, label container and native label;
- full-width, left-aligned row geometry: `width: 100%`, `margin-inline: 0`, `flex: 0 0 auto`, `align-self: stretch`, `justify-content: flex-start`;
- a flexible title box: `width: auto`, `flex: 1 1 auto`, `contain: none`, `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`, `text-align: start`;
- full-width, left-aligned Notes/Agenda folder headers and labels: `align-items: stretch`, `justify-content: flex-start`, `text-align: start`.

It does **not** use `bgalazka-tabbar-compact`, `zen-sidebar-expanded`, `zen-compact-mode`, a blanket `[pending]` selector, `:is()`, `display: none`, `visibility: hidden`, zero width/height or zero font-size. `additional/tabs/ZentralTabDensity.css` and the compact-hover bundles remain byte-for-byte unchanged.

## Limits / OWNER GATE

- No live Zen/Sine runtime, screenshot or compositor frame is available in this repository. The JSON is real owner-browser evidence, but the visual result after OW-120 is **not** verified here.
- OWNER GATE: in live Zen/Sine, compare Notes folder alignment, Notes/Agenda row titles, Agenda favicon colour, grayscale/opacity and spacing with compact mode on, a collapsed folder and the space indicator. Also confirm ordinary compact tabs keep their clipping, icon visibility and row sizing after `OW-119`.
- `OW-117` (resize performance) and `OW-118` (Boost RAM reporting) are owner-accepted as fixed. Boost dropdown, deep-clean/light-clean behavior and boost-level descriptions are deferred; propositions are given only at the end of this cycle.
- The temporary Browser Console diagnostic file is intentionally not re-added after the owner's delete commit; exact custom-sheet selectors remain unresolved. Version stays `3.4.0`; no `--bump`, `sync-version` or ZIP.
