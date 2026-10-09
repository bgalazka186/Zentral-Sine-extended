# RSS folder display

Start at `ZentralRssDisplay.uc.js`. Independent RSS event-driven presentation. Its script, stylesheet and settings stay together. Shared settings can call its runtime service refresh.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                      | Responsibility                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `ZentralRssDisplay.css`   | RSS folder and badge display states.                                                           |
| `ZentralRssDisplay.uc.js` | Independent RSS folder badge/display refresh driven by relevant native events and preferences. |
| `settings.json`           | Settings schema and category/section metadata owned by rss.                                    |

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.
