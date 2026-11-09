# Zentral Colorful Folders

Colorful Folders gives ordinary Zen sidebar folders independent colors and one shared style system for Notes-owned folders. Right-click any native Zen folder—including the NOTES root and Notes subfolders—to choose a shared preset, a saved quick theme, or the draggable detailed editor. The full Zentral settings page contains **Appearance → Colorful folders** with default color pickers, all seven layer opacity controls, a showcase gallery for every folder's default look, and a per-folder editor list.

## Install

- **With Zentral Extended:** enable **Load Colorful folders** in Modules & CSS Files. The loader owns the feature and waits for the registration pass; the source does not start itself at evaluation time.
- **Standalone with Sine:** add this folder as its own mod. Its generated `ZentralColorfulFolders.standalone.uc.js` checks for the full runtime and stands aside when Zentral is installed, so both installations cannot run two painters at once.

## Default appearance and presets

The Defaults section's showcase applies a style to all ordinary Zen folders and to Notes folders that do not have a saved per-folder override. The palette is shared with the Notes folder editor, so dark, high-contrast and colorful presets match in both places. The detailed editor exposes color and opacity for seven layers: icon back, icon front, icon outline/glyph, folder label, group accent/line, soft tint and hover background. Opacity is 0% (transparent) through 100% (solid); `-1` in the advanced settings fields means inherit. Editing an individual layer switches the shared mode to Detailed.

## Ownership and storage

The module only writes inline folder color custom properties and its private `bgalazka-folder-colors` marker. It never creates, deletes, renames, moves, reparents or reorders folders or tabs. Per-folder records contain only a salted SHA-256 hash of the native folder ID plus color values. Folder IDs and names are not persisted, and no name-derived hash is stored (which avoids making names guessable from an exposed preference file). Records are bounded and validated before use. If Zen replaces a native folder ID, that folder needs to be colored again. This is privacy-conscious local preference storage, not encryption against someone who can already read the entire browser profile.

Notes remains the source of truth for Notes folder metadata: subfolder colors are written through its versioned bridge into Notes `meta.json`, and the NOTES root stays in its existing preferences. Colorful Folders exposes the same right-click palette/editor for Notes-owned folders but never paints over Notes; it asks the Notes bridge to refresh after edits. Notes' All notes tree rows use the same seven layer and opacity values as the Zen sidebar projection. Both editors share the same built-in presets and Simple/Detailed mode. This avoids two independent writers racing over a folder.

Built-in palette choices apply only to the selected folder unless chosen from the Defaults showcase. Saving a theme is an explicit action; merely applying a color does not add it to saved themes.
