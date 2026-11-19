# Zentral Notes

Quick notes that open **over the panel you are looking at**, without touching its page. Several notes, highlights, checklists, search, trash and Save to file. Start at `ZentralNotes.uc.js`.

**Source layout (T4.3a–T4.3c):** `calendar/ZentralNotesCalendar.js` owns the pure item/date logic, `calendar/ZentralNotesCalendarUI.js` owns the calendar UI's pure geometry, label, colour, fit and drag decisions, `parser/ZentralNotesParserGraph.js` owns the pure parser / wiki-graph / import-export decisions, `zen/ZentralNotesZenSidebar.js` owns the Zen sidebar UI's pure projection, folder-id, favicon, URL, cleanup, drop and payload decisions, and `ZentralNotes.uc.js` remains the one build/loader entry, owning the DOM, store, listeners, full Markdown reader, live session traversal and lifecycle. All four parts are loaded by the full pack's module loader and embedded in the standalone bundle; `window.__zentralNotesTestSeam.core` still exposes the same names plus `CALENDAR_UI_PART` / `CALENDAR_UI`, `PARSER_PART` / `PARSER_UI` and `ZEN_SIDEBAR_PART` / `ZEN_UI`. A host that omits a part keeps the original inline answers, never a crash.

## Using it

- Press the **note button** at the far left of a panel's URL bar (also on the Triple View and Super Pin bars), or press **Alt+Shift+N**.
- The sheet covers the page area of the panel whose bar you used. In Triple View **both** bars open it between the two cards (the top bar's button shows that it is open). The page, its tab and the panel are never navigated, moved or unloaded.
- **Between the two cards of Triple View** the sheet has two edges of its own: the top edge (and the title bar) moves only the upper card's boundary, the bottom edge only the lower card's. Each card keeps at least 120 px (a quarter of the two cards when the panel is very low), so *Larger* takes at most what is left after that, and an edge stops when the card on its side has reached that height. *Swap top and bottom panels* leaves Notes as it is: the same note and caret, the same height, still folded away if it was. Notes that goes away and comes back leaves the cards where they were: the panel sliding away and returning with Notes open does not change how the two cards are divided, and a sheet folded to its thin strip opens again exactly where its edges had been dragged to. Closing Notes gives each card back what it gave, so the two cards are divided as they were before Notes opened; that also holds for an uneven pair in which one card was already at its smallest height. Only after you dragged an edge of Notes away from where it opened does each card get half of the height of Notes instead, which is what lets Notes come back at the place you dragged it to.
- **Notes lives inside the Zentral panel whenever one exists.** There is only one Notes at a time: pressing the button on another bar (or Super Pin) moves it there, and it is never open as the floating card next to a panel. If the panel is slid away by *autohide*, the button, the shortcut, a reminder or a click in the Zen sidebar folder first bring the panel back, then dock Notes in it. If a panel opens while the card is open, the card closes and Notes continues inside the panel.
- Two Zen windows stay in sync through the notes folder.
- The first line of a note is its title. Switch between **edit** and **read** with Ctrl+E.
- With no Zentral panel open (and in a standalone install without the panels) the shortcut opens the **standalone card**, which behaves like a Zentral panel:
  - It stays below the top bar and beside the native sidebar (never over either).
  - Drag it past a window edge and it **docks** there: full height, flush, with its own remembered width. Drag it away and it detaches. Hold the pill's move button to dock / detach without dragging.
  - Only while docked: **push the page** from that side (pill button or the setting) and **autohide** (the card folds into a thin strip at the edge and comes back on hover or a press on the strip). A detached card never pushes.
  - The **pill** beside the card has push, move / resize (tap: show handles on every side, drag: move), larger, autohide and close. A short click on autohide hides the docked card once even when the saved autohide preference is off; hold it for 550 ms to toggle that preference. A docked card resizes from its inner edge.
  - Split view only widens the card for display; the remembered width is never the widened one.

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
| Trash | Delete moves to Trash (kept 30 days, restorable); Empty trash is a two-click action. Notes deleted for good (or emptied from the Trash) are kept 48 hours in `backup/` inside the notes folder: right-click the Trash chip > Deleted notes backup to restore them |
| Close | Esc (first Esc steps back from menus and the list) |

Highlights are written as `==text==` (yellow) or `=={green}text==` (also `blue`, `pink`, `orange`). Links must be `http(s)`, and are opened in a new tab only when you click them in read mode. Markup in a note is never run as HTML.

### Reminder storage failures

Calendar reminder banners and missed-reminder digests are not displayed when their history claim cannot be saved. Unsaved claims are rolled back without discarding other pending history, and the scheduler makes up to three 30-second retries. A damaged or unreadable history file remains protected and requires attention before alerts can be saved. Notes windows in the same browser process coordinate note saves, history writes and claims through one shared registry. It lives on the global that the browser's system modules share, which exists on every platform; the hidden window (Firefox keeps one on macOS only) is the fallback. A step waits at most 8 seconds for the same step in another window (reading the whole folder at start-up: up to 2 minutes, because a cold disk or a large folder takes longer than one save). A window that was closed in the middle of its step is noticed at once, or within a second when another window is already waiting for it, so it cannot block the others and its unfinished step never makes a save of another window fail. External programs do not participate. Live Zen validation is still needed.

### Concurrent calendar edits

Windows that share the browser's process registry merge independent calendar changes before saving. Competing edits to the same calendar item use the latest revision; a losing window receives a notice. Conflicting deletions or category edits block saving rather than silently discarding a version. When possible a `calendar.conflict-*.bak` file in the Notes folder records the base, local and remote snapshots for manual recovery; a damaged original also gets a separate corrupt backup. If a backup fails, keep Notes open and resolve the storage problem before closing. Changes made after saving is blocked may not be in the backup. This coordination does not cover external programs or environments without the shared registry, and note-file edits are not yet protected by the calendar merge. Live Zen behavior remains unverified.

### Daily Note calendar categories

A calendar item in a Daily Note normally follows its `%%calendar%%` section. Choosing a category for that item in **Edit details** saves a per-item marker on its own line, for example `%%zn-item-category: Work%%`; an empty marker means **No category**. The marker is hidden in read view but visible in the Markdown editor. You can change its value in the note, or choose **Follow note section** in the editor to remove it and resume inheritance. Other lines and their categories are unchanged. Keep the separate `%%zn-item-id:...%%` identity marker intact.

### Calendar: the hours Week and Day show

Week and Day normally show all 24 hours. The **08–20** button in the calendar toolbar (Week and Day only) holds them to a part of the day; pressing it again shows all 24 hours. The hours themselves are whole hours and are set under **Tools → Visible hours…**, where the working hours can be taken as a starting point. Working hours remain a separate setting: they shade the grid and do not limit it. The choice is saved with the other calendar view settings.

While a day in view has a timed event or reminder outside the chosen hours, the grid is widened by whole hours on that side so that the item is shown. The added hours are hatched, their labels are in the accent colour, and a line above the timeline names the item that caused it, for example `Extended: 06:10 Early call`. The grid goes back to the chosen hours when no such item is in view any more: after moving to another week, or after the item is moved or deleted. What counts is the time of an item, not the size of its box: a reminder at 19:50 is drawn inside 08–20 (its box ends with the grid) and adds no hour, one at 20:00 does. All-day items never widen the grid, and neither does the time of day: when the current time is outside the hours shown, today's column has a dotted red mark on its top or bottom edge in place of the red line.

The grid does not change under a drag, or behind the dialog opened by dragging out a range; it is brought up to date when that ends. When the hours change, the time that was at the top of the timeline stays there; a timeline held to some hours that was at its very top stays at its top, so hours added above are in sight. A pointer cannot drag beyond the hours that are shown. To place something outside them, switch to all 24 hours first, or type the time in the item's dialog; the grid then widens for it.

**When am I free?** has an extra option while the hours are limited: **Only within the visible hours**, on by default. Combined with **Only working hours** it returns the times that lie in both.

On the two days a year when the clocks change, the grid follows the clock: an event at 08:00 is drawn at 08:00. Before 3.3.173, without a display time zone, everything after the change was drawn one hour too early (spring) or too late (autumn), and working hours were shaded and searched an hour off on those days.

### Calendar: size

The **Size** button in the calendar toolbar sets how high the calendar is drawn. It replaces the three steps Comfortable, Compact and Extra compact. Every view has its own size, saved with the other calendar view settings.

**Fit** is the default. Week and Day make the hours they show as high as the pane allows, so all of them are in sight and there is no scrollbar. Fewer hours get more height each: with **08–20** on, twelve hours share what 24 shared. The height follows everything that takes room above the timeline (all-day items, the line that names why the grid is widened, a toolbar that needs a second row) and every change of the window, the panel or the splitter. Month makes its six weeks fill the pane in the same way.

An hour is never fitted lower than can be read: 1.4 times the text size, which is 18 px at the default 13 px. In a pane too low for that the hours get this height and the timeline scrolls. A timeline that scrolls opens one hour before the current time when today is in view, and otherwise where the working day begins, or at the first item if that is earlier. It no longer opens at midnight.

Pressing **Size** in Week, Day or Month opens a slider: the height of an hour from 16 to 120 px, or of a week from 44 to 160 px. The calendar follows while the slider moves and the menu stays open; the arrow keys, Home and End work on the slider. **Fit to the pane** goes back to the automatic size. With a height set by hand the view scrolls when it has to, and the time at the top of the timeline stays the same when the height changes.

What changes with the size:

- **The look.** The paddings and text sizes of the three former steps are still there and follow the size: 54 px an hour (58 px a week) and more are drawn as Comfortable was, 44 px (52 px) and more as Compact, less as Extra compact. Fitted hours always have the comfortable look; a fitted Month takes the look that goes with the height its weeks get.
- **Short events.** An event whose box is too low for its time above its title shows the title alone; the time is in the tooltip and the hover card. The smallest box is 20 px down to 36 px an hour and gets lower with the hour below that, to 11 px, so that half-hour events one after another keep the whole width of the day at 18 px an hour.
- **Month cells.** A cell shows as many items as its height holds: all of them, or one fewer and `+3 more`. A cell with one line shows its item, or `5 items` when there are several. The line `All day` is only shown where a line is left over. Weeks are never fitted lower than 44 px (more at a large text size, so that the date and one line fit); below that the pane scrolls. The list of the selected day under the grid takes at most 40% of the pane (110 px where that is more), gives way to the grid in a low pane, and scrolls by itself.

**Next days** and **Agenda** are lists and have nothing to fit: there **Size** offers Comfortable, Compact and Extra compact as before, for each list separately. The same holds for Month in a pane under 470 px wide, where it is a list of days.

A setting from before 3.3.176 is converted once: Comfortable becomes Fit, Compact becomes 44 px an hour and 52 px a week, Extra compact 36 px and 44 px, and the lists keep their spacing.

Resizing no longer draws the calendar again with every px. Month fits its cells where they are, and Week and Day are drawn again only when the fitted height of an hour changes (it moves in quarter px).

Every menu the sheet opens (calendar View, Size, Snap, Days, Kind filter, Category filter, Tools, the month cell and the calendar item; the notes `+` menu, a note row) was measured the same way, by `tools/audit-notes-menus.cjs`: 11 menus across 3 text sizes, 2 sheet sizes, 2 sheet heights and both kinds of scrollbar — 264 measurements, 0 findings. It checks that a row is not shorter than its label, that a label is not cut, that a menu fits the window it opened into, that it does not cover the button that opened it, and that every submenu level offers a Back row. The numbers are kept in `docs/MENU_BASELINE.md`; `--compare docs/MENU_BASELINE.md` fails when one moves by more than 4 px. At 13 px text the calendar Tools menu is 196 px (6 rows) and the `+` menu 196 px (6 rows); at 28 px text in a narrow sheet they are 331 px, still inside the window.

A Notes or Agenda row in the Zen sidebar is an `about:blank` placeholder, and every live one used to hold its own content process (the owner measured about eleven of them, 43-51 MB each, ≈0.5 GB — the largest RAM item in Zentral's own code). `parkPseudoTab` now discards each placeholder (OW-88): the element, its label, icon, markers and private URL all stay, a click still opens the note because the guards read the marker and `_zentralNotesUrl` rather than the page, the previous tab stays selected, and the row goes back to sleep once the hand-back settles. Parking is deferred (never inside `addTab`/`TabOpen`/`SSTabRestored`), one task drains every placeholder a projection run created, its own `TabBrowserDiscarded` opens the usual quiet window so it cannot start a repair loop, and a bounded retry (three tries) covers a row asked to sleep while an activation is still in flight. A selected, busy, pending, disconnected or non-placeholder tab is never touched, and a real note tab never is. Switch: **Memory → Keep sidebar note/agenda placeholders unloaded (saves memory)**, `zen.workspace.zentral.notes.park_pseudo_tabs`, default on; off is exactly the old behaviour. `tests/ow-88-park-pseudo-tabs.test.cjs` drives the guards, the kill switch, the click path and an Agenda row.

Where the hours and the weeks fit, nothing scrolls and no room is left empty; where they cannot fit, they have their smallest height. Both were measured in a headless Chromium (`tools/audit-notes-calendar-fit.cjs`: text sizes 8 to 28 px, sheets 330 to 1000 px high, panes side by side and one above the other, both kinds of scrollbar). At the default text size, with the panes side by side and nothing in the all-day row, 24 hours fit from a sheet about 710 px high and 08–20 from about 500 px. Zen draws with Gecko; live behaviour in Zen is not verified.

### Markdown supported

Headings (`#` to `######`; seven `#` or `#tag` stay text), paragraphs, **bold** (`**x**` or `__x__`), *italic* (`*x*` or `_x_`), ***bold italic***, ~~strikethrough~~, any of these nested in each other, `code` and fenced code blocks (with colors for a handful of languages, see below), `[text](https://link)` and bare links, bullet / numbered lists, task lists (`- [ ]`, `- [x]`), ordered lists that number themselves (`1.` `2.` `1.` shows 1, 2, 3; a start such as `42.` is kept), list items with more paragraphs (blank line, then indented text), nested block quotes (`> > text`), callouts (`> [!NOTE] Title`, also tip, important, warning, caution, info), horizontal rules (`---`), **tables** and **images**. Backslash escapes work (`\\*` shows a star), `<https://...>` is a link and an image can be a link (`[![alt](img)](url)`). **Collapsible blocks** use `<details>` with an optional `<summary>` line and a closing `</details>` (add `open` to start expanded); the inside is normal Markdown, and no other HTML tag is understood. **Math** is a small offline LaTeX subset written as `$x^2$` inline or `$$ ... $$` as a block: Greek letters, operators and arrows, `^` / `_`, `\frac`, `\sqrt`, `\text`, `\mathbb{R}`, accents; it becomes plain text with superscripts and subscripts, and anything unknown stays visible as typed. `$5 and $10` is not math (no space just inside the dollar signs). This is a small GitHub-style subset; footnotes, matrices, other raw HTML and nested tables are not supported on purpose.

- Sub/superscript: `H~2~O`, `X^2^` (no spaces inside). Keys: `<kbd>Ctrl</kbd>`.
- **A small, safe subset of HTML** (so pasted READMEs and tables read properly): `<b> <strong> <i> <em> <u> <s> <del> <mark> <small> <sub> <sup> <kbd> <code> <br>`, `<a href="https://...">`, `<img src="https://..." alt="...">` (https only, loaded on click like any image), `<h1>`-`<h6>`, `<p>`, `<div>` and `<center>` (with `align="left|center|right"`; the inside of `<p>`/`<div>` is Markdown), `<hr>` and `<table>` with `<tr> <th> <td>` (`colspan`, `rowspan`, `align`, `bgcolor`, `width`, `height`; no nested tables). In a `style="..."` only `width, height, border, background-color, color, text-align, font-size` (plus padding, vertical-align, border-collapse, font-weight) are kept, and never `url()` or anything that could load or run something. Everything else, `<script>`, event attributes, unclosed tags, stays visible text. Markup is never run as HTML.
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
- **Quick settings** (the sliders button, or the `...` menu): text size, line height, wrap, blank lines, line breaks, linked scrolling, copy in read view, link on paste, Setext. Changes are saved at once and are the same preferences as in Zentral settings. Both this card and *All settings…* follow the text size (8–40 px) and the width of the sheet: a control that does not fit beside its label goes below it in one piece (minus, value and plus stay together), every row takes the height it needs, and what is taller than the card scrolls inside it.
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

### Media embeds

- **YouTube**: `![](https://youtu.be/VIDEO_ID)` or `![[https://www.youtube.com/watch?v=VIDEO_ID]]` renders a local poster prompt. No YouTube thumbnail, iframe, or remote media request is made when the note opens. Clicking the prompt creates an iframe on `www.youtube-nocookie.com` with a restrictive sandbox and the browser’s `strict-origin-when-cross-origin` referrer policy (origin only for cross-site requests).
- **Local video**: put a supported file in `zentral-notes/assets/<note-id>/` and use `![[clip.mp4]]` in that note, or use `![description](assets/<note-id>/clip.mp4)` for an explicit asset reference. Supported containers are MP4/M4V, WebM and Ogg/OGV. The asset path is allow-listed, container bytes are checked against the extension, and files larger than 200 MB are not loaded. Playback uses a native `<video controls>` element backed by a local blob URL; no remote host is contacted.
- **Dropped attachments**: drag up to 20 files onto the editable text area. Zentral copies them into that note's `assets/<note-id>/` folder (up to 100 MB per file and 200 assets per note), sanitizes their names, and adds a numeric suffix rather than overwriting an existing file. PNG/JPEG/GIF/WebP and MP4/M4V/WebM/Ogg/OGV are inserted as `![[filename]]` embeds only when their bytes match the extension. Other files are inserted as `[filename](assets/<note-id>/filename)` links; they are served as `application/octet-stream` and require an explicit download click, never rendered as active HTML or SVG. HTML/PDF exports replace these links with placeholders and do not bundle the attachment bytes.

Dropped files are saved with the note they were dropped onto. If you switch notes while a large drop is being copied, the files remain in the original note's assets folder and the editor asks you to reopen that note before inserting links.

## Export and import

- **Save as Markdown** writes the note text. **HTML** writes a self-contained page; **plain text** drops all formatting; **PDF** opens the note as a page and your browser's print dialog (choose "Save as PDF"). Each one except Markdown shows what it loses before anything is written.
- **Export all notes** writes one `.md` file per note to a folder (existing files are never overwritten); **Export all as zip** puts the same files in one archive and skips trashed notes. HTML/PDF exports show non-playing placeholders for YouTube and local video; local video files are not bundled.
- **Import .md folder** turns every `.md` file of a folder (not its subfolders, at most 500 files of up to 1 MB) into a new note and leaves the folder unchanged.

## Where notes are stored

Not in preferences. Each note is one plain **Markdown file** in `zentral-notes/` inside your Firefox profile (or the folder you set), with a small header (id, dates, color, pinned, trashed). A short `meta.json` remembers the last note and sheet size.

- Files are written atomically (temporary file, flush, replace). The previous version is kept once per session as `<id>.md.bak`, and a note whose file was emptied by a crash is restored from it.
- On Linux and macOS the files and folder are owner-only (0600 / 0700). Nothing is uploaded or logged anywhere, and note text never goes into the Logger.
- Because they are ordinary `.md` files you can open the folder in Obsidian, sync it with Syncthing, or drop in your own `.md` files; edits made outside Zen are picked up the next time the sheet opens.

### Saving behavior

A note saves **0.8 s after you stop typing**, and at least **every 5 seconds while you keep typing** (setting: 2-60 s), so a crash costs a few seconds at most. It also saves when you leave the editor, close the sheet, close the window and when Zen quits. If a write fails the note stays marked unsaved, the footer says so, and it retries every 10 seconds. A reminder whose line belongs to a note that is not saved yet is kept in `calendar.json` as a reminder of its own until the note is saved, so a crash in between does not lose it: after the restart it is shown and becomes a line of its date note again. An Agenda line that was only typed and never saved leaves no reminder behind.

### Starting up

Notes can be opened before its folder has been read (a large folder, a cold disk, a second window starting at the same moment). The sheet appears at once and says **Loading notes…**; until the notes are there the editor cannot be typed in and buttons do nothing, so nothing typed is lost when the note opens. Close and Esc work. If the folder cannot be reached the sheet says so and Notes tries again by itself (after 1.5, 4 and 10 seconds, then every 30 seconds); the open sheet, reminders, the Agenda folder and the Zen sidebar folder start when it succeeds, and what was asked for in the meantime from the sidebar menus (a new note, a link dropped on NOTES) is carried out then.

`meta.json` (folders, their colors and permanent ids, settings) is never replaced by defaults because it could not be read for a moment: Notes does not start from an empty folder tree and writes nothing to the file until it has read it. A damaged `meta.json` is copied to `meta.json.corrupt` before the settings start fresh.

With **Open on Startup** (a panel setting) Notes comes back in the bar it was in, whichever finishes first: reading the notes, building the second panel, or the start-up panel sliding away. It comes back folded when the panel has already slid away, does not take the keyboard focus, and never opens as the standalone card instead. A bar that is built late (Triple View) is waited for up to one minute; closing Notes or opening it yourself in that time ends the restore. Two windows that start together read the folder one after the other, so start-up work (permanent folder ids, the Agenda lines of older reminders) is done once. A panel that is switched on or rebuilt after start-up gets its Notes button too.

Two windows that are already running save `meta.json` one after the other, and each save first reads the file and keeps what the other window saved. Folders (names, colors, order, folded or not) and the reminder alert and Zen Agenda rules are the same in every window: a change made in one window shows in the others about a second later. Layout and view (size, mode, calendar view, the note opened last) stay each window's own; the file keeps the value of the window that changed it last, and the next start uses that. When two windows change the same folder in the same moment, different properties are both kept, the same property takes the value saved last, and a folder deleted in one window stays deleted. A `meta.json` that cannot be read at the moment of a save is not written over; the change is saved a few seconds later. Live Zen validation of this section is still needed.

## Settings

The Notes folder color editor mirrors the eight global **Colorful Folders → Behavior** switches, so the same options are available while editing a Notes folder. The folder-style dialog is up to 760px wide to give the Detailed mode opacity sliders enough room; it adapts to narrower windows. These switches are shared with Zen sidebar folders, not saved separately per Notes folder.

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

## Install as a standalone Sine feature

Notes works without the rest of Zentral. In Sine, add this folder as a mod using:

`https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/notes`

Enable `sine.allow-unsafe-js` and restart Zen after the first install. Sine pulls later updates from this folder. Standalone gives you the shortcut and floating note card; the Notes buttons on Zentral panel URL bars are a full-pack feature. If you later install the full pack, it takes over and this copy steps aside; your notes folder and preference keys stay the same.

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
- **Theme** (Quick settings or Zentral settings): Zentral (follows the Zen look), Recommended (like the RSS card), Light, Dark, Paper. Recommended uses a readable blue accent for links and active items, distinct from the popup's line and border colour; it adapts to the light or dark palette. An explicit Appearance accent still overrides it.

- **Hold in the editor toolbar**: holding *Quote* or the *More* caret lists the callout kinds (Note, Tip, Important, Warning, Caution, Info); a tap does what it always did.
- **Checkmarks in read view**: a click toggles done, a right click cycles the main states (`[?] [!] [/] [-]`), holding the left button lists the classic states and holding the right button lists the extra ones (`[f] [b] [i] [*]` ...). An extra state is a second kind of checkmark: a click or right click leaves it alone and only a hold changes it.

## Notes in the Zen sidebar (pinned NOTES folder)

- **Same order as Notes**: the entries in the sidebar folder follow the tree order you chose in Notes (*Folders first*, *Notes first*, *Mixed, by name*), inside every sub-folder. Notes are sorted like in the tree (pinned first, then by last change), so a note you just edited moves to the top of its folder.
- **A tab is only a pointer**: closing, unloading, unpinning or moving a Notes tab never changes a note. What happens instead:
  - closed (X, middle click, *Close all*, reopening a closed tab later): the entry comes back once; a reopened copy is removed. The X, the reset button and the middle click on a Notes tab do nothing;
  - unpinned, made an Essential, dragged out of the folder or into another folder or window: the stray is closed and a fresh entry appears where it belongs;
  - unloaded (by hand, by Zen's idle unload or by an add-on that unloads every tab): the label is repaired and a click still opens the note;
  - the whole NOTES folder (or a sub-folder) deleted: it is rebuilt once. Browser-side repairs are limited to 12 a minute, so an add-on that keeps touching the tabs cannot start a loop;
  - the note was trashed or deleted: the entry is dropped and a click opens nothing.
- **Right click** on a Notes tab only offers Notes' own actions; Zen's pin, move, container and unload entries are hidden for it.

### Agenda sidebar full titles

Hover or keyboard-focus an Agenda reminder or event to see its complete title in a tooltip beside the sidebar. Move the pointer onto the tooltip to keep it open; Escape dismisses it. The tooltip is scoped to Agenda items and adapts to either sidebar edge. On browsers without top-layer popovers it falls back to a positioned card; the native tooltip also contains the complete title.

Agenda sidebar items and day folders are managed projections: dragging them or dropping content into Agenda is disabled. If restored user tabs or folders appear inside Agenda, Notes attempts to move them out intact into the pinned area. A failed move leaves the original content in place for a later retry.

### Shared workspace projections

When Notes or Agenda sidebar folders are enabled, their shared data follows the active Zen workspace in each window. Switching workspaces does not create independent copies. Foreign tabs and folders found inside a projection are preserved in their original workspace; if they cannot be moved safely, the projection waits for a later retry. Separate per-space data is not yet available.

### Pasting flattened tables

If a copied Markdown table has lost its row breaks and its rows run together at `||`, Notes can restore the breaks when the result is a valid table in the note. Ambiguous or malformed text is left to the normal paste behavior; structured HTML still uses the existing HTML-to-Markdown conversion.

### Wide tables

Rendered Markdown and supported HTML tables scroll horizontally in their own region when wider than the note pane. Focus a table region and use the arrow keys to scroll it; the native scrollbar may follow your operating system’s overlay behavior.
