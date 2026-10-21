# RSS folder display

Start at `ZentralRssDisplay.uc.js`. Independent RSS event-driven presentation. Its script, stylesheet and settings stay together. Shared settings can call its runtime service refresh.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                      | Responsibility                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `ZentralRssDisplay.css`   | RSS folder and badge display states.                                                           |
| `ZentralRssDisplay.uc.js` | Independent RSS folder badge/display refresh driven by relevant native events and preferences. |
| `settings.json`           | Settings schema and category/section metadata owned by rss.                                    |

Full installation uses root `theme.json` and `preferences.json`, plus `loader/`; Sine loads `loader/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.

## Reader card

Pref `zen.workspace.bgalazka.rss.reader_card` (default off). Hovering a live-folder article shows a card with the full text, URL and Open / Dismiss / Dismiss all buttons. Middle-click dismisses and the card re-targets the article now under the pointer. The native tab tooltip is suppressed for live-folder items only. Live-folder items are detected via `zen-live-folder-item-id` or a native live-folder parent.
