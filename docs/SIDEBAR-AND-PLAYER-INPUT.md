# Sidebar and player input — Extended 3.0.2

Core reference: Zentral 1.1.0. Apply this changed-files package over the preceding assembled 3.0.1 files and restart Zen.

## Sidebar and related audit

- Native sidebar detection works before tab reparenting and accepts wide vertical toolboxes. Bounds are clipped to the viewport; the previous 65% cutoff no longer causes a valid sidebar to disappear from width calculations.
- Empty native side attributes count as enabled; explicit `"false"` counts as disabled. The shared resolver is used by panel positioning, Library sizing and settings placement. Active App/Group/geometry CSS uses the same boolean semantics.
- The native divider retains a usable 6–12 CSS-pixel hit target, a content-facing edge and a non-draggable window region. Zen still owns resize events, collapse and saved width. No synthetic sidebar resizer or startup width write was added.
- Two inherited invalid `-moz-window-dragging: no` declarations are now `no-drag`.
- Native diagnostics are available through `window.ZentralRuntime.nativeSidebarDiagnostics()` and the runtime snapshot: side, clipped geometry, safe bounds, divider styles and midpoint hit testing. A false hit result can identify a covering element; diagnostics do not log source URLs or preferences.

## Big Preview input

Image clicks toggle playback after the system double-click interval (bounded to 250–1000 ms). This small delay preserves double-click return without also pausing the source. Dragging, control clicks, double-click, blur, source changes and close cancel pending playback toggles.

| Focused key  | Action                           |
| ------------ | -------------------------------- |
| Space / K    | Play or pause                    |
| M            | Mute or unmute                   |
| F            | Preview fullscreen               |
| J / L        | Seek −10 / +10 seconds           |
| Left / Right | Seek −5 / +5 seconds             |
| Up / Down    | Volume +5% / −5%                 |
| 0–9          | Seek to 0–90%                    |
| Home / End   | Start / end of finite video      |
| < / >        | Playback speed −0.25 / +0.25     |
| C            | Toggle mirrored preview captions |
| I            | Return to sidebar                |

Escape and double-click return retain the existing Enlarge behavior. These are preview commands over the existing transport, not synthesized YouTube page events; site playlist/chapter/frame commands are not implemented. Browser modifier shortcuts, editable fields, native button activation and range navigation keep their own handling. Keys apply only while Big Preview owns focus and is not hidden by Insta Peek.

New settings `enlarged_keyboard_controls` and `enlarged_click_toggle` default on in Video playback → Enlarged preview and have grouped New Settings copies. The optional input module can fail or be removed without disabling Enlarge layout/drag. Control actions validate source identity and bound volume, speed and finite-duration seeking across local, actor, frame and basic-frame transports.

## Appearance

Video buttons reuse Appearance's button style, border width/color, size, video fill opacity, video text, hover pair and automatic/manual contrast. The follow-up's fixed dark button backgrounds and forced borders were removed. Plain and outline styles have transparent resting fills; filled style uses the chosen palette. SVG play/pause/mute/volume icons inherit text color instead of using colored emoji.

Big Preview uses the selected video-control color for its hover backing. New `zen.workspace.bgalazka.look.video_overlay_opacity` defaults to 40%, independently of Simple palette opacity and button fills. It appears in Appearance → Sidebar video (Detailed palette), the appearance opacity controls, and New Settings. Starting themes reset this value to 40%; Recommended explicitly sets 40%, preserving its plain borderless buttons and automatic contrast. Palette colors already have individual controls. Theme text is paired with the painted fill; enlarged icons use a small contrasting shadow over moving pixels. Seek controls use the palette accent adjusted for visibility and a matching light/dark native scheme.

Automatic contrast checks modeled theme surfaces. Deliberately transparent or manual custom colors can still reduce contrast over arbitrary video pixels; increase overlay opacity or choose filled controls when desired. No per-frame video sampling or new resize polling was introduced.

## RSS reader card appearance

The RSS hover card is painted through CSS custom properties instead of inline colors. The stylesheet keeps the theme fallback: the card background and text use the Look popup surface and text, the link uses the muted color, and Classic falls back to the native panel tokens. A color preference is written only when a value is really picked; an unset or invalid value removes the property and the theme wins again.

New settings under RSS Folders → Reader card: `card_background`, `card_text`, `card_url`, `card_button_background`, `card_button_text`, `card_width`, `card_max_height`, `card_radius`, `card_opacity` and `card_font_size`. The five colors are empty by default, so the card follows the palette; the size values keep their documented defaults. Each new key has a grouped New Settings copy, and Recommended keeps the card on the current theme.

Size and opacity are clamped when the card is painted, and the stylesheet keeps a minimum width and a readable text color, so an extreme value can never produce the earlier transparent sliver. Only the backing becomes transparent; the article text stays opaque.

## Validation

26 local Node test groups cover geometry on both sides, wide/clipped/early startup sidebars, transparent divider bounds, focused keyboard scope, source-safe click/double-click/drag behavior, all four media transports, theme contrast and manual overrides, existing first drag/resize, Alt+Q, fullscreen, renderer fallback and resize throttling. Syntax/schema checks include all 359 preferences, new-setting mirrors, portable Recommended settings and applying the regenerated adapted-base patch byte-for-byte.

The reference native divider implementation was inspected in Zen desktop commit `c0dffc17681ac25b5dfcc8da0c3f238f384987a6`. No live Zen instance was available. These fixtures do not establish native compositor hit testing, final visual rendering or persisted-width behavior in a fresh real profile. Verify first-launch left/right dragging, restart width, a narrow sidebar, Paper/Transparent themes, fullscreen and focused playback on the target Zen release.
