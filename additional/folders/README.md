# Zentral Colorful Folders

Colorful Folders gives ordinary native Zen folders independent colors. Right-click a folder to choose a built-in palette, a saved quick theme, or the detailed editor. The full Zentral settings page also contains **Colorful folders → Defaults** and **Your folders**.

## Install

- **With Zentral Extended:** enable **Load Colorful folders** in Modules & CSS Files. The loader owns the feature and waits for the rest of the registration pass; the source does not start itself at evaluation time.
- **Standalone with Sine:** add this folder as its own mod. Its generated `ZentralColorfulFolders.standalone.uc.js` checks for the full runtime and stands aside when Zentral is installed, so both installations cannot run two painters at once.

## Ownership and storage

The module only writes inline folder color custom properties and its private `bgalazka-folder-colors` marker. It never creates, deletes, renames, moves or reorders folders or tabs. Per-folder records contain only a salted SHA-256 hash of the native folder ID plus color values. Folder IDs and names are not persisted, and no name-derived hash is stored (which avoids making names guessable from an exposed preference file). Records are bounded and validated before use. If Zen replaces a native folder ID, that folder needs to be colored again. This is privacy-conscious local preference storage, not encryption against someone who can already read the entire browser profile.

Notes-owned folders are excluded using the `bgalazka-notes-*` ownership attributes. Notes continues to own the appearance of its own projected folders, including its note-folder colors and icons. Ordinary Zen folder defaults and per-folder palettes belong to this module; folder density and icon sizing remain in Appearance because they are layout options.

Built-in palette choices apply only to the selected folder. Saving a theme is an explicit action; merely applying a color does not add it to saved themes.
