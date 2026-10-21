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

## Reader card appearance

The card is painted through CSS custom properties. The stylesheet owns the theme fallback, so the card follows the active Look palette (Atelier) or the native panel tokens (Classic) until a color is chosen.

| Preference                                 | Custom property          | Default |
| ------------------------------------------ | ------------------------ | ------- |
| `zen.workspace.bgalazka.rss.card_background`       | `--rss-card-bg`          | Theme   |
| `zen.workspace.bgalazka.rss.card_text`             | `--rss-card-text`        | Theme   |
| `zen.workspace.bgalazka.rss.card_url`              | `--rss-card-url`         | Theme   |
| `zen.workspace.bgalazka.rss.card_button_background` | `--rss-card-button-bg`   | Theme   |
| `zen.workspace.bgalazka.rss.card_button_text`      | `--rss-card-button-text` | Theme   |
| `zen.workspace.bgalazka.rss.card_width`            | `--rss-card-width`       | 340 px  |
| `zen.workspace.bgalazka.rss.card_max_height`       | `--rss-card-max-height`  | 60 %    |
| `zen.workspace.bgalazka.rss.card_radius`           | `--rss-card-radius`      | 10 px   |
| `zen.workspace.bgalazka.rss.card_opacity`          | `--rss-card-opacity`     | 100 %   |
| `zen.workspace.bgalazka.rss.card_font_size`        | `--rss-card-font-size`   | 13 px   |

A color preference stays empty until a value is picked; the script then removes the property instead of writing a hard-coded color, so the theme keeps control. Size and opacity are clamped to their limits, and the stylesheet keeps a minimum width, so a bad value can never collapse the card. The card background is the only translucent part: the text always stays readable. Settings live in RSS Folders → Reader card and are copied under New settings.
