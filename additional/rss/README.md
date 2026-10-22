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

## Reader card behavior

Behavior belongs to the RSS owner and is applied without a folder rescan. The card's appearance belongs to the Look owner.

| Preference                                | Default | Effect                                                     |
| ----------------------------------------- | ------- | ---------------------------------------------------------- |
| `zen.workspace.bgalazka.rss.card_hover_delay` | 0 ms   | Wait before the card opens.                                |
| `zen.workspace.bgalazka.rss.card_hide_delay`  | 250 ms | Wait before the card closes after the pointer leaves.      |
| `zen.workspace.bgalazka.rss.card_side`        | auto   | auto, left or right of the article.                        |
| `zen.workspace.bgalazka.rss.card_show_folder` | on     | Show the live-folder name.                                 |
| `zen.workspace.bgalazka.rss.card_show_url`    | on     | Show the article URL.                                      |
| `zen.workspace.bgalazka.rss.card_show_buttons`| on     | Show Open, Dismiss and Dismiss all.                        |
| `zen.workspace.bgalazka.rss.card_mmb_dismiss` | on     | Middle-click dismisses an article.                         |
| `zen.workspace.bgalazka.rss.card_retarget`    | on     | The card follows the pointer after a dismiss.              |
| `zen.workspace.bgalazka.rss.card_confirm_all` | off    | Ask before every article in the folder is closed at once.  |
| `zen.workspace.bgalazka.rss.card_replace_tooltip` | on  | Hide Zen's own tooltip for live-folder items.              |

A dismiss never hides the card first: it continues with the next article in the folder, so the reader sees no flash of a closed card. Escape closes the card. Settings live in RSS Folders → Reader card and are copied under New settings.

## Reader card appearance

The card is painted through the Look custom properties that `extension/appearance/ZentralAppearance.js` writes on the root element. The stylesheet owns the theme fallback, so the card follows the active Look palette (Atelier) or the native panel tokens (Classic) until a color is chosen.

| Preference                                     | Custom property                          | Default |
| ---------------------------------------------- | ---------------------------------------- | ------- |
| `zen.workspace.bgalazka.look.rss_card_width`  | `--bgalazka-look-rss-card-width`         | 340 px  |
| `zen.workspace.bgalazka.look.rss_card_max_height` | `--bgalazka-look-rss-card-max-height` | 60 %    |
| `zen.workspace.bgalazka.look.rss_card_font_size`  | `--bgalazka-look-rss-card-font-size`  | 13 px   |
| `zen.workspace.bgalazka.look.rss_card_line_height`| `--bgalazka-look-rss-card-line-height`| 145 %   |
| `zen.workspace.bgalazka.look.rss_card_padding`    | `--bgalazka-look-rss-card-padding`    | 12 px   |
| `zen.workspace.bgalazka.look.rss_card_radius`     | `--bgalazka-look-rss-card-radius`     | 10 px   |
| `zen.workspace.bgalazka.look.rss_card_border`     | `--bgalazka-look-rss-card-border`     | 1 px    |
| `zen.workspace.bgalazka.look.rss_card_opacity`    | `--bgalazka-look-rss-card-opacity`    | 100 %   |
| `zen.workspace.bgalazka.look.rss_card_button_radius` | `--bgalazka-look-rss-card-button-radius` | 6 px |
| `zen.workspace.bgalazka.look.rss_card_gap`        | `--bgalazka-look-rss-card-gap`        | 6 px    |
| `zen.workspace.bgalazka.look.rss_card_shadow`     | `--bgalazka-look-rss-card-shadow`     | soft    |
| `zen.workspace.bgalazka.look.rss_card_font`       | `--bgalazka-look-rss-card-font`       | system  |
| `zen.workspace.bgalazka.look.rss_card_background` | `--bgalazka-look-rss-card-background` | Theme   |
| `zen.workspace.bgalazka.look.rss_card_text`       | `--bgalazka-look-rss-card-text`       | Theme   |
| `zen.workspace.bgalazka.look.rss_card_url`        | `--bgalazka-look-rss-card-url`        | Theme   |
| `zen.workspace.bgalazka.look.rss_card_border_color` | `--bgalazka-look-rss-card-border-color` | Theme |
| `zen.workspace.bgalazka.look.rss_card_button_background` | `--bgalazka-look-rss-card-button-background` | Theme |
| `zen.workspace.bgalazka.look.rss_card_button_text` | `--bgalazka-look-rss-card-button-text` | Theme   |

A color preference stays empty until a value is picked; the appearance owner then removes the property instead of writing a hard-coded color, so the theme keeps control. Numbers are clamped to their limits, and the stylesheet keeps a minimum width, so a bad value can never collapse the card. The card background is the only translucent part: the text always stays readable. Settings live in Detailed appearance → RSS reader card and are copied under New settings.
