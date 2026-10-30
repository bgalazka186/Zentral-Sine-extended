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

Headings (`#` to `######`; seven `#` or `#tag` stay text), paragraphs, **bold** (`**x**` or `__x__`), *italic* (`*x*` or `_x_`), ***bold italic***, ~~strikethrough~~, any of these nested in each other, `code` and fenced code blocks (with colors for a handful of languages, see below), `[text](https://link)` and bare links, bullet / numbered lists, task lists (`- [ ]`, `- [x]`), ordered lists that number themselves (`1.` `2.` `1.` shows 1, 2, 3; a start such as `42.` is kept), list items with more paragraphs (blank line, then indented text), nested block quotes (`> > text`), callouts (`> [!NOTE] Title`, also tip, important, warning, caution, info), horizontal rules (`---`), **tables** and **images**. Backslash escapes work (`\\*` shows a star), `<https://...>` is a link and an image can be a link (`[![alt](img)](url)`). **Collapsible blocks** use `<details>` with an optional `<summary>` line and a closing `</details>` (add `open` to start expanded); the inside is normal Markdown, and no other HTML tag is understood. **Math** is a small offline LaTeX subset written as `$x^2$` inline or `$$ ... $$` as a block: Greek letters, operators and arrows, `^` / `_`, `\frac`, `\sqrt`, `\text`, `\mathbb{R}`, accents; it becomes plain text with superscripts and subscripts, and anything unknown stays visible as typed. `$5 and $10` is not math (no space just inside the dollar signs). This is a small GitHub-style subset; footnotes, matrices, other raw HTML and nested tables are not supported on purpose.

- Sub/superscript: `H~2~O`, `X^2^` (no spaces inside). Keys: `<kbd>Ctrl</kbd>` (the only HTML tag understood).
- Links: `[text](https://link "tooltip")`; reference links `[text][ref]` or `[ref][]` with a line `[ref]: https://link "title"` anywhere in the note (the definition line is not shown); `<me@host.org>` and `mailto:me@host.org` open the mail app. Links may be http, https or mailto; images only http(s).
- Setext headings (off by default): with *Treat text over === or --- as a heading* on, `Title` over `=====` is a heading 1 and over `-----` a heading 2. Off, `---` stays a horizontal rule and `===` stays text.
- Code colors: fenced blocks with a language (` ```js `, `ts`, `python`, `c`, `cpp`, `java`, `csharp`, `go`, `rust`, `bash`, `sql`, `json`, `css`, `html`/`xml`) get keyword, string, number, comment, function and tag colors. Small and offline; it is a tokenizer, not a parser, so unusual syntax may be colored plainly. Blocks over 20,000 characters, and unknown languages, stay plain. HTML export keeps the code text without colors.
- Tables: a header row, a delimiter row (`| --- | :-: | --: |` sets alignment), then rows. `\|` is a literal pipe. Up to 12 columns and 200 rows are shown.
- Images: `![description](https://...)`. In read view an image is a small placeholder that loads **only when you click it**, so opening a note never contacts a server. Only `http(s)` addresses work.

### Toolbar, link dialog, table creator, quick settings

- The toolbar has a button for every syntax (bold, italic, strikethrough, highlight, heading, bulleted / numbered list, checklist, quote, nesting, rule, inline code, code block, link, image, table, and a `▾` menu for superscript, subscript and keyboard key). Hover a button to see its shortcut.
- **Link**: select text and press the button (or paste an address) to get *Create link* with the text to show and the address. Pasting a web address asks by default; *Paste as text* keeps it plain. A "copy link to highlight" address (`#:~:text=`) offers the highlighted words as the label. Set the behavior with *Pasting a web address* (ask / only over selected text / plain).
- **Table**: the button opens a size grid (columns × rows, first row is the header) or two number boxes; pick Left / Centre / Right per column, then *Insert*.
- **Image**: a dialog like the link dialog; the address is taken from the selection or the clipboard (http/https only), with a description and an optional link around the picture (`[![alt](src)](link)`).
- **Code block**: a language list (JavaScript/TypeScript, Python, C, C++, Java, C#, Go, Rust, Shell, SQL, JSON, CSS, HTML, or plain text). A selected fenced block is unwrapped instead.
- **Callouts** (`> [!NOTE]`, tip, important, warning, caution, info): menu next to the insert caret; shortcuts Ctrl+Shift+2 (note) and Ctrl+Shift+3 (warning), the rest can be assigned in Keyboard shortcuts.
- **Toolbar buttons…** (Quick settings): hide editor actions you never use; a hidden action has no button, menu entry or shortcut.
- **Linked scrolling** (split view) keeps the same *source line* at the top of both panes, so a long wrapped paragraph in the editor and its rendered block stay level. Without layout information it falls back to the proportional position.
- **Quick settings** (the sliders button, or the `...` menu): text size, line height, wrap, blank lines, line breaks, linked scrolling, copy in read view, link on paste, Setext. Changes are saved at once and are the same preferences as in Zentral settings.
- **Keyboard shortcuts** (Quick settings → Keyboard shortcuts): click a shortcut and press the new keys; Backspace removes it, *Reset* restores the default. Every shortcut needs Ctrl, Alt or Cmd, and two actions cannot share one. Defaults: Bold Ctrl+B, Italic Ctrl+I, Strike Ctrl+Shift+X, Highlight Ctrl+Shift+H, Code Ctrl+Shift+C, Code block Ctrl+Shift+M, Link Ctrl+Shift+K, Image Ctrl+Shift+G, Heading Ctrl+Shift+1, Numbered Ctrl+Shift+7, Bulleted Ctrl+Shift+8, Quote Ctrl+Shift+9, Checklist Ctrl+Shift+L, Table Ctrl+Shift+Y, New note Ctrl+N, All notes Ctrl+K, Read/edit Ctrl+E, Quick settings Ctrl+,. Rule, nesting, super/subscript, key and split view start unassigned. Your changes are one JSON preference (`zen.workspace.zentral.notes.shortcuts`).

### The window: move, resize, pin, fill

- **Move and resize**: drag the title bar, or any edge or corner. The place is remembered separately for panel sheets and for the standalone card, kept inside its area when the window gets smaller, and a double click on the empty title bar (or holding the window pin, or the `...` menu) resets it. The card docked to the sidebar (*Dock Notes to the sidebar*) stays attached and cannot be moved.
- **Window pin** (the pin in the title bar; the note's own pin is now the bookmark): pinned (the default) stays open; unpinned closes when you press outside it, like a Zentral panel. The browser's sidebar and toolbars, the Notes buttons and Sine's own windows do not count as outside. The state is remembered.
- **Hold-to-act buttons**: a tap on *Larger* toggles larger / smaller; **holding** it fills the whole area (both views in Triple View, everything free in the standalone card). Holding the window pin resets the position.
- **Above Big Preview**: the standalone card enters the browser's top layer only while it has the focus, so it is above Big Preview; pressing Big Preview (or anything outside) drops it back below. Inside a panel it is never above the panel.
- **Standalone card and the sidebar**: *Keep the standalone Notes card clear of the native sidebar* (on by default) opens it on the side opposite the sidebar and keeps it out of its space.
- **Recent**: the list view has a *Recent* filter with the last 8 opened notes.
- **Customize toolbar**: a Notes button is available in Zen's *Customize toolbar* and opens or closes Notes in the window where it was pressed.
- **Shortcuts for every action**: the same shortcut editor now also lists Recent, Pin note, Keep open, Larger, Fill, Reset position, and two actions that work anywhere in the window even while Notes is closed: *New note from anywhere* and *Open or close the standalone card*. All start unassigned.

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
| `zen.workspace.zentral.notes.avoid_sidebar` | on | The standalone card opens opposite the native sidebar and cannot be dragged under it. |
| `zen.workspace.zentral.notes.read_copy` | off | Lets you select and copy text in the read view. |
| `zen.workspace.zentral.notes.setext` | off | Text over `===` / `---` is a heading. |
| `zen.workspace.zentral.notes.paste_link` | ask | Pasting a web address: `ask`, `selection` (only over selected text) or `off`. |
| `zen.workspace.zentral.notes.shortcuts` | empty | Changed editor shortcuts as JSON; set in Quick settings, empty = defaults. |
| `zen.workspace.zentral.notes.hidden_tools` | empty | Comma list of hidden editor buttons/shortcuts (e.g. `sup,sub,calloutInfo`); set in Quick settings → Toolbar buttons. |

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

## Window options, labels and themes

- **Label**: *More → Add label…* gives a note a short free-text label (40 characters), shown beside the title and in the list, and found by search.
- **Tuck away** (setting, off by default): with *Keep open* off, an outside click slides the card away instead of closing it; hover the thin strip on its top edge (or press the Notes button or shortcut) to bring it back.
- **Push the page aside** (setting, off by default, standalone card only): the page makes room instead of being covered.
- **Split view as a second window** (setting, off by default): *Split* opens another note in a second window of the same size beside the first, instead of halving one window. With no room beside it the second window is not shown.
- **Theme** (Quick settings or Zentral settings): Zentral (follows the Zen look), Recommended (like the RSS card), Light, Dark, Paper.

