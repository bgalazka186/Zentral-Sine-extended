# Zentral Colorful Folders

Colorful Folders gives ordinary Zen sidebar folders independent colors and one shared style system for Notes-owned folders. Right-click any native Zen folder—including the NOTES root and Notes subfolders—to choose a shared preset, a saved quick theme, or the draggable detailed editor. The full Zentral settings page contains **Appearance → Colorful folders** with default color pickers, all seven layer opacity controls, a showcase gallery for every folder's default look, and a per-folder editor list.

## Install

- **With Zentral Extended:** enable **Load Colorful folders** in Modules & CSS Files. The loader owns the feature and waits for the registration pass; the source does not start itself at evaluation time.
- **Standalone with Sine:** add this folder as its own mod. Its generated `ZentralColorfulFolders.standalone.uc.js` checks for the full runtime and stands aside when Zentral is installed, so both installations cannot run two painters at once.

## Simple and Detailed

- **Simple** uses two colors: the *primary* color is the folder, the *secondary* color is its outline (stored as the outline layer). Back, front, label, accent line, soft tint and hover are derived from them. The editor warns when the two colors are too close.
- **Detailed** exposes seven layers, each with a color and its own opacity: icon back, icon front, icon outline and glyph, folder label, accent and group line, soft background tint, hover background. A layer left on Auto keeps following the primary color.
- **Simple overrides Detailed.** Picking a primary color or a look while in Simple drops the Detailed layers (keeping only the outline); switching to Detailed then fine tunes from there. The mode is saved only when you press **Apply**.
- **Apply** saves and keeps the editor open, **Apply and close** saves and closes, **Reset** returns the folder to the default look. The editor is draggable and opens beside the folder, not over it.
- **Ignore my folder label color** (checkbox in the editor and in Behavior settings, off by default) leaves the name color to the Zen theme. Use it if a theme makes names unreadable.

## Defaults, levels and collections

A folder with its own colors is never touched by a default. A folder without colors gets, in this order: the default of its nesting level (1 = top-level folder, the NOTES folder is level 1, up to 5), then the all-levels default, then Zen's own look. Settings > Appearance > Colorful folders > Defaults lets you pick *All levels* or one level, then click a look. **Spread over levels 1-5** gives level 1 the first look of a collection, level 2 the second and so on, so a root folder, a subfolder and a second subfolder look related but different.

Built-in collections: *Classic yellow folders* (Kraft paper, Honey, Manila, Butter, Lemon), *Dark glass*, *Sticky notes*, *Neon outline*, *Dark folders*, *High contrast*, *Colorful*. Saved quick themes appear in the right-click menu and the editor.

## Accent line, soft tint and hover

Zen draws folders from its own variables and hides the group line, so these three layers are drawn by rules of this module: the accent is a thin line on the folder's content area, the tint is a translucent background of the folder, the hover is the header background while the pointer is over it. A folder lists the layers it uses in the `bgalazka-fc-layers` attribute and an unstyled folder is left to Zen. These rules are written against Zen's `zen-folder > .tab-group-label-container / .tab-group-container` structure and have not been run in a real Zen window; if a layer still does nothing, please send a DOM dump of one folder.

## Ownership and storage

The module only writes inline folder color custom properties and its private `bgalazka-folder-colors` marker. It never creates, deletes, renames, moves, reparents or reorders folders or tabs. Per-folder records contain only a salted SHA-256 hash of the native folder ID plus color values. Folder IDs and names are not persisted, and no name-derived hash is stored (which avoids making names guessable from an exposed preference file). Records are bounded and validated before use. If Zen replaces a native folder ID, that folder needs to be colored again. This is privacy-conscious local preference storage, not encryption against someone who can already read the entire browser profile.

Notes remains the source of truth for Notes folder metadata: subfolder colors are written through its versioned bridge into Notes `meta.json`, and the NOTES root stays in its existing preferences. Colorful Folders exposes the same right-click palette/editor for Notes-owned folders but never paints over Notes; it asks the Notes bridge to refresh after edits. Notes' All notes tree rows use the same seven layer and opacity values as the Zen sidebar projection. Both editors share the same built-in presets and Simple/Detailed mode. This avoids two independent writers racing over a folder.

Built-in palette choices apply only to the selected folder unless chosen from the Defaults showcase. Saving a theme is an explicit action; merely applying a color does not add it to saved themes.
