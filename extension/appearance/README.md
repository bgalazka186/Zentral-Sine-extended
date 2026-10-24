# Appearance

The shared palette styles Zentral settings (including header, navigation, footer, backup actions, reports and field states), panel toolbars and pill controls, sidebar video controls, app/group menus, tooltips and diagnostics. Website content and brand artwork keep their own colors.

## Simple and detailed colors

Settings → Appearance → Theme & Colors → Color controls offers:

- **Simple:** primary color, secondary color and primary transparency. Related surfaces are derived from the primary color; each text/surface pair automatically uses the higher-contrast black or white. Descriptions, highlights and semantic indicators are adjusted for readable contrast. Shape and layout settings remain independent.
- **Detailed:** independent settings shell, input, hover, selected-action, menu, status and backdrop colors, alongside the existing panel and video palette. Automatic text contrast can be changed to Manual to expose individual text colors. Switching between modes never overwrites the saved detailed palette.

All eight presets include the new color roles. Applying a preset preserves the chosen Simple/Detailed mode and sidebar density. Existing profiles seed missing new roles from their current palette once; selecting Paper also selects a dark web-content backing.

## Web panel backing

The web panel background color and transparency are separate from UI palette colors, whole-panel opacity, and the existing black-background toolbar button. Background transparency supports 0% (solid) through 100% (fully transparent). This is useful for Zen Internet's transparent website elements, which may retain light text even when the surrounding UI uses Paper. The black-background button continues to override the backing at its selected strength.

The chosen surface colors determine automatic text contrast. Fully transparent surfaces can reveal an arbitrary page or wallpaper; that underlying content is not sampled continuously. Settings actions and fields retain solid contrastable surfaces.

## Performance

Palette math runs only on appearance changes. Preference bursts from presets/imports coalesce into one scheduled update, and direct updates cancel queued duplicates. Static scoped CSS applies the result; there is no color polling, per-frame sampling or recurring DOM scan. Artwork sizing retains its existing coalesced resize/mutation handling.

## Reader card appearance

The RSS reader card is painted from root custom properties written here: `--bgalazka-look-rss-card-*` for size, padding, radius, border, opacity, gap, shadow, font and the optional colors. The stylesheet in `additional/rss/ZentralRssDisplay.css` owns the theme fallback, so an unset color keeps the active palette and Classic keeps the native panel tokens. The card's behavior belongs to the RSS owner; this owner only writes the properties.

## Video control appearance

The video look settings (`zen.workspace.bgalazka.look.video_*`) are owned by Video and live in **Settings → Video → Appearance & layout** (category `video-appearance`, declared in `extension/settings/layout.json` and `additional/video/settings.json`). They moved out of Appearance so that the standalone video mod, which only reads `additional/` paths and never the `extension-settings` categories, shows and applies them too. The preference names did not change, so existing profiles, backups and `recommended.json` keep working.

In the full pack this owner still paints them: the `bgalazka-look-video-selection` attribute and `--bgalazka-look-video-*` / `--zl-video-*` properties are written here, and `ZentralVideoSettings.js` builds the rows. Standalone has no Appearance owner, so `additional/video/standalone/ZentralVideoControlsLook.js` writes `--zvl-*` properties and the `zentral-video-source-style` attribute that `ZentralVideoPreview.css` reads. In standalone a value equal to its default sets nothing, so the card keeps following the Zen theme until a value is changed.

Sidebar and Big Preview buttons follow the shared button style, border, size, hover pair and video fill/text controls. Plain and outline styles retain transparent resting fills. Automatic text contrast uses the effective button surface; Manual retains the chosen icon color. Big Preview adds a small icon shadow over video pixels without adding a forced border or solid button fill.

Big Preview overlay opacity defaults to 40% and is separate from both video-button opacity and Simple palette opacity. Its color follows the video-control palette. See [input and appearance notes](../../docs/SIDEBAR-AND-PLAYER-INPUT.md).
