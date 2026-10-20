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
