# Zentral Notes

Quick notes that open **over the panel you are looking at**, without touching its page. Several notes, highlights, checklists, search, trash and Save to file. Start at `ZentralNotes.uc.js`.

## Using it

- Press the **note button** at the far left of a panel's URL bar (also on the Triple View and Super Pin bars), or press **Alt+Shift+N**.
- The sheet covers the page area of the panel whose bar you used. In Triple View you can open a note from one bar and keep reading the other panel. The page, its tab and the panel are never navigated, moved or unloaded.
- Every sheet shows the **same notes**. Open the note from two bars at once and they follow each other live; two Zen windows stay in sync too.
- The first line of a note is its title. Switch between **edit** and **read** with Ctrl+E.
- In a standalone install (no Zentral panels) the shortcut opens a floating note card at the corner of the window.

| Action | How |
| --- | --- |
| New note / all notes | `+` button or Ctrl+N / list button or Ctrl+K |
| Bold, italic, strikethrough | Toolbar, Ctrl+B, Ctrl+I |
| **Highlight** | Select text, press the marker (Ctrl+Shift+H); the arrow beside it picks one of five colors |
| Headings, bullets, **checklists** | Toolbar. Enter continues a list; Enter on an empty item ends it |
| **Quote** and **nesting** | Quote button toggles `> ` on the selected lines. The two nest buttons next to it move list items or quotes one level in or out (`> > ` for quotes, two spaces for lists) |
| Tick a checklist item | Read mode or split view: click the box |
| **Split view** | Columns button beside the eye: the editor with a live preview next to it (below it when the sheet is narrow). The floating card widens while it is on. The preview redraws 0.25 s after you stop typing and only the changed blocks are redrawn. The **chain-link button** (split view only) links the two scroll positions; click it to unlink |
| Horizontal rule | Rule button in the toolbar (or type `---` on its own line) |
| Pin, color, bigger/smaller sheet | Header buttons |
| **Save as Markdown / HTML / plain text / PDF**, copy, duplicate, export all, zip, import, open folder | The `...` menu. HTML, text, PDF and zip show a short notice first about what that format loses |
| Trash | Delete moves to Trash (kept 30 days, restorable); Empty trash is a two-click action |
| Close | Esc (first Esc steps back from menus and the list) |

Highlights are written as `==text==` (yellow) or `=={green}text==` (also `blue`, `pink`, `orange`). Links must be `http(s)`, and are opened in a new tab only when you click them in read mode. Markup in a note is never run as HTML.

### Markdown supported

Headings (`#` to `######`; seven `#` or `#tag` stay text), paragraphs, **bold** (`**x**` or `__x__`), *italic* (`*x*` or `_x_`), ***bold italic***, ~~strikethrough~~, any of these nested in each other, `code` and fenced code blocks, `[text](https://link)` and bare links, bullet / numbered lists, task lists (`- [ ]`, `- [x]`), ordered lists that number themselves (`1.` `2.` `1.` shows 1, 2, 3; a start such as `42.` is kept), list items with more paragraphs (blank line, then indented text), nested block quotes (`> > text`), callouts (`> [!NOTE] Title`, also tip, important, warning, caution, info), horizontal rules (`---`), **tables** and **images**. Backslash escapes work (`\\*` shows a star), links accept a `"title"` (ignored), `<https://...>` is a link and an image can be a link (`[![alt](img)](url)`). This is a small GitHub-style subset; footnotes, raw HTML and nested tables are not supported.

- Tables: a header row, a delimiter row (`| --- | :-: | --: |` sets alignment), then rows. `\|` is a literal pipe. Up to 12 columns and 200 rows are shown.
- Images: `![description](https://...)`. In read view an image is a small placeholder that loads **only when you click it**, so opening a note never contacts a server. Only `http(s)` addresses work.

### Export and import

- **Save as Markdown** writes the note text. **HTML** writes a self-contained page; **plain text** drops all formatting; **PDF** opens the note as a page and your browser's print dialog (choose "Save as PDF"). Each one except Markdown shows what it loses before anything is written.
- **Export all notes** writes one `.md` file per note to a folder (existing files are never overwritten); **Export all as zip** puts the same files in one archive and skips trashed notes.
- **Import .md folder** turns every `.md` file of a folder (not its subfolders, at most 500 files of up to 1 MB) into a new note and leaves the folder unchanged.

## Where notes are stored

Not in preferences. Each note is one plain **Markdown file** in `zentral-notes/` inside your Firefox profile (or the folder you set), with a small header (id, dates, color, pinned, trashed). A short `meta.json` remembers the last note and sheet size.

- Files are written atomically (temporary file, flush, replace). The previous version is kept once per session as `<id>.md.bak`, and a note whose file was emptied by a crash is restored from it.
- On Linux and macOS the files and folder are owner-only (0600 / 0700). Nothing is uploaded or logged anywhere, and note text never goes into the Logger.
- Because they are ordinary `.md` files you can open the folder in Obsidian, sync it with Syncthing, or drop in your own `.md` files; edits made outside Zen are picked up the next time the sheet opens.

### Saving behavior

A note saves **0.8 s after you stop typing**, and at least **every 5 seconds while you keep typing** (setting: 2-60 s), so a crash costs a few seconds at most. It also saves when you leave the editor, close the sheet, close the window and when Zen quits. If a write fails the note stays marked unsaved, the footer says so, and it retries every 10 seconds.

## Settings

Notes → Quick notes (the main switch is also under Start here).

| Preference | Default | Effect |
| --- | --- | --- |
| `zen.workspace.zentral.notes.enabled` | on | Buttons and shortcut. |
| `zen.workspace.zentral.notes.show_button` | on | Show the button on panel bars (the shortcut keeps working). |
| `zen.workspace.zentral.notes.shortcut` | `Alt+Shift+N` | Needs Alt, Ctrl or Cmd; a bare key is refused. |
| `zen.workspace.zentral.notes.autosave_seconds` | 5 | Longest gap between saves while typing. |
| `zen.workspace.zentral.notes.folder` | empty | Absolute folder path. Empty means `zentral-notes` in the profile. An unusable path falls back to the profile folder. |

## Looks

The sheet uses the existing Look tokens (surface, text, accent and the panel corner radius) with fallbacks, and the **panel black backing** button also darkens the sheet's backdrop, so notes stay readable on translucent panels.

## Install only this feature

Notes works without the rest of Zentral. Add this folder URL in Sine (and enable JavaScript from unofficial sources) as described in the main README:

`https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/notes`

- **Standalone** gives you the shortcut and a floating note card in the corner of the window. The bar buttons live on the full pack's panel URL bars, so they are a full-pack feature.
- If you later install the full pack, it takes over and this copy steps aside. The notes folder and the settings are the same, so nothing is lost.

## Files

| File | Responsibility |
| --- | --- |
| `ZentralNotes.uc.js` | Note format, file store and autosave, Markdown dialect, sheet UI, bar bindings, shortcut. |
| `ZentralNotes.css` | Look of the button and sheet. |
| `settings.json` | Settings schema and category/section metadata owned by notes. |
| `standalone.json`, `theme.json`, `preferences.json`, `ZentralNotes.standalone.uc.js`, `standalone.lock.json` | Standalone package (generated by `tools/build-standalone.cjs`). |

Tests: `node tests/notes.test.cjs` (store, autosave, sync, recovery), `node tests/notes-ui.test.cjs` (sheet through a fake DOM, including split view), `node tests/notes-markdown.test.cjs` (Markdown fixtures, export), `node tests/notes-bars.test.cjs` (button placement, preferences, shortcut, cleanup).
