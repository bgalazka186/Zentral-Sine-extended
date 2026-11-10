# Zentral Colorful Folders

Colorful Folders gives ordinary Zen sidebar folders independent colors and one shared style system for Notes-owned folders. Right-click any native Zen folder—including the NOTES root and Notes subfolders—to choose a shared preset, a saved quick theme, or the draggable detailed editor. The full Zentral settings page contains **Appearance → Colorful folders** with default color pickers, all seven layer opacity controls, a showcase gallery for every folder's default look, and a per-folder editor list.

## Install

- **With Zentral Extended:** enable **Load Colorful folders** in Modules & CSS Files. The loader owns the feature and waits for the registration pass; the source does not start itself at evaluation time.
- **Standalone with Sine:** add this folder as its own mod. Its generated `ZentralColorfulFolders.standalone.uc.js` checks for the full runtime and stands aside when Zentral is installed, so both installations cannot run two painters at once.

## Simple and Detailed

- **Simple** uses two colors: the *primary* color is the folder, the *secondary* color is its outline (stored as the outline layer). Back, front, label, selection accent, soft tint and hover are derived from them. The native folder accent line uses the same full-strength accent color.
- **Detailed** exposes seven layers, each with a color and its own opacity: icon back, icon front, icon outline and glyph, folder label, folder/tab selection accent, soft background tint, and hover background. The native accent line always uses the resolved folder/tab selection accent; it is not a separate color layer and cannot drift out of sync with the folder.
- **Simple overrides Detailed.** Picking a primary color or a look while in Simple drops the Detailed layers (keeping only the outline); switching to Detailed then fine tunes from there. The mode is saved only when you press **Apply**.
- **Apply** saves and keeps the editor open, **Apply and close** saves and closes, **Reset** returns the folder to the default look. The editor is draggable, 760px wide so the Detailed opacity sliders have room, and opens beside the folder, not over it.
- **Ignore my folder label color** (checkbox in the editor and in Behavior settings, off by default) leaves the name color to the Zen theme. Use it if a theme makes names unreadable.

## Defaults, levels and collections

A folder with its own colors is never touched by a default. A folder without colors gets, in this order: the default of its nesting level (1 = top-level folder, the NOTES folder is level 1, up to 5), then the all-levels default, then Zen's own look. Settings > Appearance > Colorful folders > Defaults lets you pick *All levels* or one level, then click a look. **Spread over levels 1-5** gives level 1 the first look of a collection, level 2 the second and so on, so a root folder, a subfolder and a second subfolder look related but different.

Built-in collections: *Classic yellow folders* (Kraft paper, Honey, Manila, Butter, Lemon), *Dark glass*, *Sticky notes*, *Neon outline*, *Dark folders*, *High contrast*, *Colorful*. Saved quick themes appear in the right-click menu and the editor.

## Native accent line, soft tint and hover

Zen already provides the folder-tree geometry. Colorful Folders does not draw a replacement tree or inject synthetic line elements: it colors the existing 2px inset line on `.tab-group-container` and Zen's `.tab-group-line` with the folder's resolved Accent color. Zen remains responsible for the line's position, length, nesting, clipping and collapse animation. There are no generated SVG paths or measurements to become stale when folders expand or collapse.

The line uses the same accent as its folder. Simple mode derives it from the primary folder color; Detailed mode uses the explicit Folder/tab selection accent color and opacity. Collections remain distinguishable at each nesting level because each folder's accent is already resolved from its own folder record or depth-specific collection color.

Hovering the existing accent hit area widens the 2px stripe to 4px, adds an accent-colored inner glow, brightens the native group-line and changes the pointer cursor. Clicking the line—or the narrow 8px hit strip around the 2px inset—collapses or expands only its owning folder via Zen's native `collapsed` setter. The interaction is delegated from the tab tree, so no per-folder listeners or DOM nodes are injected, and it does not trigger a repaint or re-measure after collapse. The `line_click` and `line_hover` switches control these behaviors; `style_accent` controls whether the accent line is drawn.

The soft tint is a translucent background behind the folder and its tabs; hover is the folder header background. The `bgalazka-fc-layers` attribute records which layers are active, and an unstyled folder is left to Zen.

Settings > Colorful folders > Behavior has a checkbox per styling part, all on by default: folder icon colors, folder/tab accent line and selection colors, soft tint behind the folder name row, soft tint behind the tabs inside, hover background, click-to-collapse on the accent line, and accent-line hover highlight. *Ignore my folder label color* keeps controlling the name color. The switches apply to Zen folders, Notes folders and the All notes tree alike when Colorful Folders is loaded; the Notes-only fallback retains the native accent styling but does not add the click-to-collapse interaction.

## Whole tree

Right-click a folder that has subfolders > Folder colors > **Whole tree**: copy this folder's own colors to all subfolders, apply a palette or quick theme to the folder and all its subfolders, or **spread a collection over the tree** (the folder gets the collection's first look, its subfolders the second, theirs the third, cycling). The color editor has the same under **Whole tree**, using whatever is currently in the editor (Simple or Detailed), applied to the folder and its subfolders or to the subfolders only. Folders are written one at a time; folders and Notes subfolders are never created, removed or moved.

## Ownership and storage

The module only writes inline folder color custom properties and its private `bgalazka-folder-colors` marker. It never creates, deletes, renames, moves, reparents or reorders folders or tabs. Per-folder records contain only a salted SHA-256 hash of the native folder ID plus color values. Folder IDs and names are not persisted, and no name-derived hash is stored (which avoids making names guessable from an exposed preference file). Records are bounded and validated before use. If Zen replaces a native folder ID, that folder needs to be colored again. This is privacy-conscious local preference storage, not encryption against someone who can already read the entire browser profile.

Notes remains the source of truth for Notes folder metadata: subfolder colors are written through its versioned bridge into Notes `meta.json`, and the NOTES root stays in its existing preferences. Colorful Folders exposes the same right-click palette/editor for Notes-owned folders but never paints over Notes; it asks the Notes bridge to refresh after edits. Notes' Zen sidebar folders and All notes tree rows use the same seven layer and opacity values as the Zen sidebar projection. Both editors share the same built-in presets and Simple/Detailed mode. This avoids two independent writers racing over a folder.

Built-in palette choices apply only to the selected folder unless chosen from the Defaults showcase. Saving a theme is an explicit action; merely applying a color does not add it to saved themes.
