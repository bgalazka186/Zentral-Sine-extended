# Markdown flavor compatibility table

Goal: copy a reply from Gemini / ChatGPT / Claude / a GitHub README / an Obsidian note / a Reddit post, paste it into Notes, and have it just work. This file lists EVERY syntax we know about (also ones none of the three apps supports and ones we do not have yet), what each app does with it, what Notes does today, and what a "mixed" mode should do.

Status: written 2026-11-07 against notes 3.1.29; GUI column added for notes 3.2.0; updated the same day for notes 3.1.30 (modes, typing shortcuts and the easy rows are built, see the Summary and the Work list). The "Notes today" column comes from running the real parser (`ZentralNotes.uc.js` core, 150+ probe inputs), not from memory. GitHub, Obsidian and Reddit columns come from their public documentation and known behaviour; entries marked ◐ or with a note should be re-checked in the real app before we depend on them.

## How to read it

**The three flavors**

- **GitHub**: GitHub Flavored Markdown on github.com (READMEs, issues, comments), with its HTML sanitizer, alerts, math, mermaid, footnotes.
- **Obsidian**: Obsidian's own Markdown (CommonMark + GFM parts + wikilinks, embeds, callouts, comments, tags, block ids, MathJax, front matter Properties). Core only; 🔌 = community plugin or theme needed.
- **Reddit**: new reddit's Markdown editor and old reddit (snudown). Reddit has the smallest feature set. No HTML at all, no task lists, no footnotes. Marked ◐ where only one of old/new reddit does it.

**Symbols in the three flavor columns**: ✅ works · ❌ not supported (shown as plain text or dropped) · ◐ partly / only in one variant (see note) · 🏷 works only when written as an HTML tag (not as Markdown symbols) · 🔌 only with a plugin or theme.

**Notes today** (what our parser does now): ✅ HAVE · ◐ PART (some forms work) · ⚠ BUG (we recognise it but the result is wrong or the block breaks) · ❌ NO (printed as plain text).

**GUI in Notes** (can a person make this without typing the symbols?): `toolbar: X` = a toolbar button (hold it for variants) · `Insert caret ▸ X` = the caret menu at the end of the toolbar (pictures, callouts, more text styles, math, blocks, date and time) · `More ▸ X` = the ⋯ menu · `settings: X` = a setting (Quick settings or All settings) · `via Xnn` = the same result is made by the button of row Xnn (this spelling is only read, or the button writes the other spelling) · `auto` = nothing to click, Notes recognises or converts it by itself (pasted text, auto links, suggestions while typing) · `typed` = no button, you type it · `—` = not implemented. The Table of contents button (D08) and the callout kinds are in the toolbar too. Rows with `typed` that matter are listed in "Typed-only syntax" below.

**Mixed mode** (what we propose): **ON** = no collision, accept it in every flavor · **ON+guard** = accept it, with a guard rule to avoid false hits (the note says which) · **PICK** = two flavors give the SAME symbols a DIFFERENT meaning, so it follows the chosen flavor (mixed picks the default written in the note) · **OFF** = not worth doing, or impossible without files/network.

## Summary

- Features listed: **236** in 15 groups (A to O).
- Notes today: ✅ HAVE **165** · ◐ PART **18** · ⚠ BUG **5** · ❌ NO **48**.
- Supported by GitHub **146**, Obsidian **187**, Reddit **66** (counting ✅ ◐ 🏷 🔌).
- Supported by ALL THREE (✅ or ◐ in each): **58**. So the shared core is 58 of 236; the other **178** are in at least one flavor only or in none.
- GUI in Notes (all 236 rows): toolbar **29** · Insert caret menu **29** · More menu **1** · settings **3** · same button as another row **44** · automatic **30** · typed only **47** · not implemented **53**.
- Which flavors support a feature (✅ ◐ 🏷 🔌 counted):

| Supported by | Features |
|---|---:|
| GitHub + Obsidian | 76 |
| GitHub + Obsidian + Reddit | 59 |
| Obsidian | 52 |
| none of the three (ours or extra) | 32 |
| GitHub | 10 |
| Reddit | 6 |
| GitHub + Reddit | 1 |

- Mixed mode: ON **177** · ON+guard **20** · PICK **7** · OFF **32**.
- Still to do for a complete mixed mode (Notes today is not HAVE, and mixed says ON or ON+guard): **42** features. See "Work list".
- Counts above were recomputed on 2026-11-07 (notes 3.1.30) by reading this table; `node tools/build-flavors-data.cjs` turns the table into the data the parser uses, and `--check` fails when the two differ.

## Modes: how the setting works

The pref `markdown_flavor` (Settings > Notes > Quick notes) has seven values. A note can carry its own value (note menu > "Markdown mode", stored as `flavor:` in its front matter); the note's value wins over the setting. The mode is for the whole note, never for single lines.

| Value | What the parser accepts |
|---|---|
| `mixed` (default) | Everything in the table whose Mixed column is ON or ON+guard. At each collision (the table below) the default written in the Mixed column wins. |
| `mixed+obsidian` `mixed+github` `mixed+reddit` | Like mixed, but each PICK row and each collision follows that flavor (for example `mixed+github` reads `~a~` as strike, `mixed+reddit` reads `^word` as superscript). |
| `obsidian` `github` `reddit` | That flavor only: a rule is on only when the flavor's own column says ✅ ◐ or 🏷. A plug symbol (🔌, community plugin) counts as NOT supported, because Obsidian "core only" is the line. What the app would show as plain text, Notes shows as plain text: `==a==` stays `==a==` in `github`, tasks `- [ ]` stay plain items in `reddit`. |

Two more settings sit next to it:

- `single_tilde`: in the mixed modes, `~a~` is subscript (default) or strikethrough (the GitHub meaning). The only collision a person can feel every day, so it has its own switch.
- `ignore_syntax`: a text field. Write pieces of syntax separated by spaces and they are shown as plain text: `>[!info]` (also finds `> [!info]`), `<mark>`, `==`. Write a rule id from this table (`A10`) and that whole rule is switched off. A piece of syntax works for symbols that can be escaped (`\ ` * _ { } [ ] ( ) # + - . ! | = ~ < > ^ $`); for things such as `:smile:` use the rule id (`L05`). Code is never touched.

Rules that stay on in every mode because they change nothing about the text: dates recognised as a chip (L07). Fences of diagrams Notes cannot draw (` ```mermaid `, plantuml, dot, geojson, stl, chart ...) show an error callout "Mermaid is not supported" above the code, which stays readable.

Where the code lives: `additional/notes/flavors/ZentralNotesFlavors.js` (modes, gate, callout kinds, emoji, ignore list; its data block is generated from this file) and `ZentralNotesShortcuts.js` (typing shortcuts). `tests/notes-flavors.test.cjs` has one case per feature id.

## Collisions: the same symbols, different meanings

These are the only places where a mixed mode cannot just say yes to everything.

| # | Symbols | GitHub | Obsidian | Reddit | Notes today | Mixed default |
|---|---|---|---|---|---|---|
| 1 | `~a~` | strikethrough (one tilde allowed) | literal (strike needs `~~`) | literal | subscript | subscript when no spaces inside; `~~` is strike. Reading GitHub text with `~a~` as strike is the price. |
| 2 | `^` | literal | `^id` at the end of a paragraph = block id | `^word` / `^(words)` = superscript | `X^2^` = superscript (Pandoc) | `X^2^` superscript; `^id` block id only at paragraph end; `^(..)` Reddit superscript only in Reddit flavor. |
| 3 | `>!a!<` | quote starting with `!` | quote starting with `!` | spoiler | literal | spoiler only when mid-line and closed with `!<`. |
| 4 | `#word`, `#123`, `#a` | `#123` = issue; `# a` heading | `#tag` = tag; `# a` heading | `#a` = heading (old reddit) | `# a` heading only | tag when a non-digit word follows with no space; `#123` stays text; heading needs a space unless Reddit flavor. |
| 5 | `:name:` | emoji from a fixed list | literal (plugin) | per-subreddit emoji | literal | only known names; never inside times like `10:30:45`. |
| 6 | `[[x]]` | wiki page link (wikis only) | note link | literal | note link by title | note link. |
| 7 | `$` | math `$x$` (needs no space inside) | math | literal | math, with money guard | math with money guard: `$5 and $10` stays text. |
| 8 | 4-space indent | code block | code block | code block (the ONLY block on old reddit) | list nesting / text | text; code only in Reddit flavor. |
| 9 | `[!type]` | 5 alert types | 13 types plus aliases, fold `+` `-`, custom titles | literal | 6 types | accept all 13 + aliases; unknown = note look. |
| 10 | `%%` | literal | comment | literal | literal | comment only when closed. |
| 11 | `\|\|a\|\|`, `[a](/spoiler)` | literal | literal | old reddit link spoiler | literal | OFF. |
| 12 | `![a\|100](url)` | alt text `a\|100` | image 100 px wide | literal | alt text `a\|100` | size. |

## A. Inline text styling

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| A01 | Bold | `**a**` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Bold (Ctrl+B) |  |
| A02 | Bold (underscores) | `__a__` | ✅ | ✅ | ✅ | ✅ HAVE | ON | via A01 |  |
| A03 | Italic | `*a*` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Italic (Ctrl+I) |  |
| A04 | Italic (underscore) | `_a_` | ✅ | ✅ | ✅ | ✅ HAVE | ON | via A03 | `a_b_c` stays literal in all three (intra-word underscore). |
| A05 | Italic/bold inside a word | `a*b*c`, `a**b**c` | ✅ | ✅ | ✅ | ✅ HAVE | ON | via A03 | CommonMark allows `*` inside a word; we leave it literal. Small parser change. |
| A06 | Bold + italic | `***a***`, `___a___` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Bold + Italic |  |
| A07 | Nested emphasis | `**a *b* c**` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Bold + Italic |  |
| A08 | Strikethrough | `~~a~~` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Strikethrough |  |
| A09 | Strikethrough, one tilde | `~a~` | ✅ | ❌ | ❌ | ✅ HAVE | PICK | settings: Markdown ▸ one tilde | COLLISION 1. GFM accepts one tilde as strike. We read `~a~` as SUBSCRIPT (Pandoc). Mixed rule: `~x~` without spaces = subscript, `~~x~~` = strike. GitHub texts using `~a~` as strike will show as subscript. Done 2026-11-07: setting `single_tilde` (subscript or strike); mixed+github and github read it as strike. |
| A10 | Highlight | `==a==` | ❌ | ✅ | ❌ | ✅ HAVE | ON | toolbar: Highlight | GitHub and Reddit show the `==` literally. |
| A11 | Highlight with colour | `=={red}a==` | ❌ | ❌ | ❌ | ✅ HAVE | ON | toolbar: Highlight colour caret | Our extension. Other apps show `{red}` literally, so export may need to drop the colour. |
| A12 | Inline code | `` `a` ``, ``` ``a`b`` ``` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Inline code |  |
| A13 | Subscript (Pandoc) | `H~2~O` | ❌ | 🔌 | ❌ | ✅ HAVE | ON | Insert caret ▸ More text styles ▸ Subscript | Plugin in Obsidian. Same symbol as one-tilde strike, see COLLISION 1. |
| A14 | Subscript (HTML) | `H<sub>2</sub>O` | 🏷 | 🏷 | ❌ | ✅ HAVE | ON | via A13 |  |
| A15 | Superscript (Pandoc) | `X^2^` | ❌ | 🔌 | ❌ | ✅ HAVE | ON | Insert caret ▸ More text styles ▸ Superscript | Plugin in Obsidian. |
| A16 | Superscript (HTML) | `X<sup>2</sup>` | 🏷 | 🏷 | ❌ | ✅ HAVE | ON | via A15 |  |
| A17 | Superscript (Reddit) | `a^b`, `a^(b c d)` | ❌ | ❌ | ✅ | ✅ HAVE | PICK | typed | COLLISION 2. In Reddit `^word` raises ONE word, `^(many words)` raises a group, and `^^` stacks. Elsewhere `2^3` is plain text and `^id` at the end of a line is an Obsidian block id. Mixed rule: only `^(...)` and `word^word` followed by a space in reddit flavor. |
| A18 | Underline | `<u>a</u>` | ❌ | 🏷 | ❌ | ✅ HAVE | ON | Insert caret ▸ More text styles ▸ Underline | GitHub strips `<u>`; `<ins>` is the GitHub way. |
| A19 | Underline / insert | `<ins>a</ins>` | 🏷 | 🏷 | ❌ | ✅ HAVE | ON | via A18 | We show it as literal text. Add as underline. |
| A20 | Underline (`++`) | `++a++` | ❌ | ❌ | ❌ | ✅ HAVE | ON | via A18 | Markdown-it (`++a++`), none of the three: harmless, no collision with our symbols. |
| A21 | Highlight (HTML) | `<mark>a</mark>` | ❌ | 🏷 | ❌ | ✅ HAVE | ON | via A10 | GitHub removes the tag and keeps the text. |
| A22 | Keyboard key | `<kbd>Ctrl</kbd>` | 🏷 | 🏷 | ❌ | ✅ HAVE | ON | Insert caret ▸ More text styles ▸ Keyboard key |  |
| A23 | HTML bold/italic/strike | `<b>` `<strong>` `<i>` `<em>` `<s>` `<del>` `<strike>` | 🏷 | 🏷 | ❌ | ✅ HAVE | ON | typed |  |
| A24 | Line break tag | `<br>`, `<br/>` | 🏷 | 🏷 | ❌ | ✅ HAVE | ON | typed |  |
| A25 | Coloured / styled text | `<span style="color:red">a</span>` | ❌ | 🏷 | ❌ | ✅ HAVE | ON+guard | typed | We print the tag as text. GitHub also drops `style`. Mixed rule: strip the tag, keep the text; maybe map known colours to our highlight colours. |
| A26 | Other presentational tags | `<small>` `<big>` `<font color>` `<abbr title>` `<q>` `<cite>` `<var>` `<samp>` `<tt>` | 🏷 | 🏷 | ❌ | ✅ HAVE | ON+guard | typed | Strip the tag, keep the text (abbr: keep the title as tooltip). |
| A27 | Spoiler (Reddit) | `>!a!<` | ❌ | ❌ | ✅ | ✅ HAVE | PICK | typed | COLLISION 3. At the start of a line `>!` is a blockquote that begins with `!` in the other two. Mixed rule: only mid-line `>!text!<` with a closing `!<` on the same paragraph. |
| A28 | Spoiler (Reddit link) | `[a](/spoiler)` | ❌ | ❌ | ✅ | ❌ NO | OFF | — | Old Reddit only. |
| A29 | Spoiler (Discord) | `\|\|a\|\|` | ❌ | ❌ | ❌ | ✅ HAVE | ON+guard | Insert caret ▸ More text styles ▸ Spoiler | Discord. Guard: a closed pair on one line, not next to other pipes, so `\|\|` empty table cells are not touched. |
| A30 | Inline footnote | `text^[note]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | typed | Numbered with the `[^1]` ones in order of first use; the same text twice is one note. In Reddit mode `^[word]` stays a superscript. |
| A31 | Comment (Obsidian) | `%%hidden%%`, block `%%` ... `%%` | ❌ | ✅ | ❌ | ✅ HAVE | ON+guard | Insert caret ▸ More text styles ▸ Hidden comment | Hidden in reading view, kept in the file. Guard: only a closed pair, `100%% sure` has no closing pair. |
| A32 | Comment (HTML) | `<!-- hidden -->` | ✅ | ✅ | ❌ | ✅ HAVE | ON | via A31 | Hidden in GitHub and Obsidian. We print it as text. Reddit prints it. |
| A33 | Emoji (Unicode) | `✅ 🚀` | ✅ | ✅ | ✅ | ✅ HAVE | ON | auto | Plain text, always works. |

## B. Links and images (standard Markdown)

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| B01 | Inline link | `[a](https://x.y)` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Link… |  |
| B02 | Link with title | `[a](url "title")`, `'title'`, `(title)` | ✅ | ✅ | ✅ | ◐ PART | ON | via B01 | Double quotes work. Single quotes and parentheses titles not verified. |
| B03 | Link, angle brackets | `[a](<url with spaces>)` | ✅ | ✅ | ❌ | ✅ HAVE | ON | via B01 | We split it into a broken link. Obsidian writes this for note names with spaces. |
| B04 | Link, parentheses in URL | `[a](https://x.y/a_(b))` | ✅ | ✅ | ✅ | ✅ HAVE | ON | via B01 | We cut the URL at the first `)`. Wikipedia URLs break. |
| B05 | Link to a note file | `[a](Note.md)`, `[a](folder/Note.md)` | ✅ | ✅ | ❌ | ✅ HAVE | ON | toolbar: Link to another note… | Ours resolves by our note id; other apps by file path. |
| B06 | Link to a heading | `[a](#Heading)`, `[a](Note.md#heading)` | ✅ | ✅ | ❌ | ◐ PART | ON | toolbar: Link to another note… (heading button) | Roadmap has heading anchors; same-note `#Heading` not verified. |
| B07 | Reference link | `[a][1]` + `[1]: url "t"` | ✅ | ✅ | ✅ | ✅ HAVE | ON | typed |  |
| B08 | Collapsed reference | `[a][]` + `[a]: url` | ✅ | ✅ | ✅ | ✅ HAVE | ON | typed |  |
| B09 | Shortcut reference | `[a]` + `[a]: url` | ✅ | ✅ | ✅ | ✅ HAVE | ON | typed | We leave `[a]` as text. |
| B10 | Bare URL autolink | `https://x.y` | ✅ | ✅ | ✅ | ✅ HAVE | ON | auto | Trailing `.` `,` `)` are not part of the link. |
| B11 | Angle autolink | `<https://x.y>` | ✅ | ✅ | ✅ | ✅ HAVE | ON | auto |  |
| B12 | www autolink | `www.x.com` | ✅ | ❌ | ◐ | ✅ HAVE | ON+guard | auto | Reddit links most bare domains. Guard: only `www.` prefix. |
| B13 | Email autolink | `<a@b.com>` | ✅ | ✅ | ❌ | ✅ HAVE | ON | auto |  |
| B14 | Bare email | `a@b.com` | ✅ | ❌ | ❌ | ❌ NO | OFF | — | Skip; collides with `@mention`. |
| B15 | Image | `![alt](https://x.y/a.png)` | ✅ | ✅ | ◐ | ✅ HAVE | ON | toolbar: Image | Reddit comments: only in some subreddits / the rich editor. We load images only on click (privacy) and only http(s). |
| B16 | Image with title | `![a](url "t")` | ✅ | ✅ | ❌ | ◐ PART | ON | via B15 | Title not shown. |
| B17 | Image size (Obsidian) | `![a\|100](url)`, `![a\|100x50](url)` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Picture options… | We keep `\|100` in the alt text. GitHub also shows it as text. Mixed rule: read `\|N` and `\|NxM` as size. |
| B18 | Image reference | `![a][1]` + `[1]: url` | ✅ | ✅ | ❌ | ✅ HAVE | ON | typed | We print `!` then a link. |
| B19 | Image inside link | `[![a](img)](url)` | ✅ | ✅ | ❌ | ✅ HAVE | ON | via B15 | Badges. |
| B20 | Image tag | `<img src=".." width="100" alt="..">` | 🏷 | 🏷 | ❌ | ◐ PART | ON | typed | We read src and alt; width/height ignored. |
| B21 | Local image / file path | `![a](img.png)`, `![a](./img.png)` | ✅ | ✅ | ❌ | ❌ NO | OFF | — | By design: notes have no files. Needs an attachment store. |
| B22 | Themed image | `<picture><source media=...>` | 🏷 | ❌ | ❌ | ❌ NO | OFF | — | GitHub only. |
| B23 | Video / audio / iframe (other than YouTube) | `<video>`, `<audio>`, `<iframe>` | ❌ | 🏷 | ❌ | ❌ NO | OFF | — | Not in notes: a page of someone else's HTML must never run inside the browser chrome. YouTube is the one exception, see B24. |
| B24 | YouTube embed | `![](https://www.youtube.com/watch?v=ID)`, `<iframe src="https://www.youtube.com/embed/ID">` | ❌ | ✅ | ❌ | ❌ NO | ON+guard | — | Only youtube.com / youtube-nocookie.com, only a validated 11-character id, drawn by OUR code as a click-to-load player (nothing is fetched before the click, like images) in a content browser, never as raw HTML. Roadmap rank 22 holds the details. |

## C. Note links, embeds, tags (Obsidian)

Our `[[` is an editor shorthand today: `[[Title]]` and `[[Title|alias]]` are looked up by note title, drawn as note links and written out as a normal `[alias](id.md)` link.

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| C01 | Wikilink | `[[Note]]` | ◐ | ✅ | ❌ | ✅ HAVE | ON | toolbar: Link to another note… (and [[ suggests titles) | GitHub: only inside a wiki. Reddit: literal text. Title lookup only, no folders. |
| C02 | Wikilink with alias | `[[Note\|shown text]]` | ◐ | ✅ | ❌ | ✅ HAVE | ON | typed |  |
| C03 | Link to heading | `[[Note#Heading]]` | ❌ | ✅ | ❌ | ❌ NO | ON | — | Your example. Target is the note title plus a heading, matched like Obsidian (case-insensitive, `#` nested for sub-headings: `[[Note#H1#H2]]`). |
| C04 | Link to heading in same note | `[[#Heading]]` | ❌ | ✅ | ❌ | ❌ NO | ON | — |  |
| C05 | Link to block | `[[Note#^abc123]]`, `[[#^abc123]]` | ❌ | ✅ | ❌ | ❌ NO | ON | — | Needs block ids, next row. |
| C06 | Heading link with alias | `[[Note#Heading\|alias]]` | ❌ | ✅ | ❌ | ❌ NO | ON | — |  |
| C07 | Block id | `paragraph text ^abc123` | ❌ | ✅ | ❌ | ❌ NO | ON+guard | — | COLLISION 2 (caret). Only at the very end of a paragraph or list item, letters/digits/dashes. |
| C08 | Link by path | `[[folder/Note]]` | ❌ | ✅ | ❌ | ❌ NO | ON+guard | — | We have no folders in the Obsidian sense (we have folders in the app; title lookup first). |
| C09 | Link to file with extension | `[[Note.md]]`, `[[img.png]]` | ❌ | ✅ | ❌ | ❌ NO | ON+guard | — |  |
| C10 | Embed note | `![[Note]]` | ❌ | ✅ | ❌ | ❌ NO | ON | — | Roadmap Cycle G. Shows the other note inline (read-only). |
| C11 | Embed heading / block | `![[Note#Heading]]`, `![[Note#^abc]]` | ❌ | ✅ | ❌ | ❌ NO | ON | — |  |
| C12 | Embed image | `![[img.png]]`, `![[img.png\|100]]`, `![[img.png\|100x50]]` | ❌ | ✅ | ❌ | ❌ NO | OFF | — | No attachment store. |
| C13 | Embed PDF / audio / video | `![[a.pdf#page=3]]` | ❌ | ✅ | ❌ | ❌ NO | OFF | — |  |
| C14 | Tag | `#tag`, `#nested/tag`, `#tag-with-dash` | ❌ | ✅ | ❌ | ✅ HAVE | ON+guard | typed | COLLISION 4 (hash). Obsidian: `#` plus letters, no space. GitHub: `#123` is an issue number. Heading needs `# ` with a space. Guard: tag needs at least one non-digit. Done 2026-11-07: drawn as a tag chip only; the tag list / filter is roadmap rank 32. |
| C15 | Tags in front matter | `tags: [a, b]` | ❌ | ✅ | ❌ | ❌ NO | ON | — | See section J. |
| C16 | Aliases in front matter | `aliases: [x]` | ❌ | ✅ | ❌ | ❌ NO | ON | — | Would give a note several titles for `[[ ]]` lookup. |
| C17 | Backlinks panel | (app feature) | ❌ | ✅ | ❌ | ◐ PART | ON | More ▸ Links & dates ▸ Notes that link here | We have a backlinks panel for our own note links. |
| C18 | `[[` completion | (editor feature) | ❌ | ✅ | ❌ | ✅ HAVE | ON | auto |  |

## D. Headings

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| D01 | ATX heading | `# a` ... `###### a` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Heading (hold: levels 1-6) |  |
| D02 | Heading without space | `#a` | ❌ | ❌ | ✅ | ✅ HAVE | PICK | typed | COLLISION 4. Old Reddit makes `#a` a heading. In Obsidian it is a tag. Reddit flavor only. |
| D03 | Closing hashes | `# a #` | ✅ | ✅ | ✅ | ✅ HAVE | ON | via D01 | We keep the trailing `#`. |
| D04 | Setext heading | `a` then `===` or `---` | ✅ | ✅ | ✅ | ◐ PART | ON | settings: Writing ▸ text over === or --- | Exists, off by default (setting). Mixed: on. |
| D05 | Seven hashes | `####### a` | ❌ | ❌ | ❌ | ✅ HAVE | ON | auto | Plain text everywhere. |
| D06 | Heading id | `# a {#id}` | ❌ | ❌ | ❌ | ❌ NO | OFF | — | Pandoc/kramdown. |
| D07 | Heading in list item | `- # a` | ✅ | ✅ | ❌ | ❌ NO | OFF | — | Rare. |
| D08 | Auto heading anchors | (`#heading-slug`) | ✅ | ✅ | ❌ | ◐ PART | ON | toolbar: Table of contents | See B. |
| D09 | Table of contents | `[TOC]`, `[[_TOC_]]`, `<!-- toc -->` | ❌ | ❌ | ❌ | ❌ NO | OFF | — | LLMs sometimes add `[TOC]`. We have an Outline panel instead. Could render as an inline outline. |

## E. Lists and tasks

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| E01 | Bullet list | `- a`, `* a`, `+ a` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Bulleted list |  |
| E02 | Numbered list | `1. a` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Numbered list | The start number is kept. |
| E03 | Numbered with paren | `1) a` | ✅ | ✅ | ❌ | ✅ HAVE | ON | via E02 |  |
| E04 | Nested list, 2 spaces | `- a` / `  - b` | ✅ | ✅ | ❌ | ✅ HAVE | ON | toolbar: Nest in / Nest out | Reddit needs 4 spaces. |
| E05 | Nested list, 4 spaces | `- a` / `    - b` | ✅ | ✅ | ✅ | ✅ HAVE | ON | via E04 | We jump to level 2 (a visible gap). Should be level 1. |
| E06 | Nested list, tab | `- a` / TAB `- b` | ✅ | ✅ | ✅ | ✅ HAVE | ON | via E04 |  |
| E07 | Nested numbered | `1. a` / `    1. b` | ✅ | ✅ | ✅ | ✅ HAVE | ON | via E04 | Same as 4 spaces. |
| E08 | Task | `- [ ] a`, `- [x] a`, `- [X] a` | ✅ | ✅ | ❌ | ✅ HAVE | ON | toolbar: Checklist |  |
| E09 | Task statuses | `- [-]` `- [/]` `- [?]` `- [!]` | ❌ | 🔌 | ❌ | ✅ HAVE | ON | toolbar: Checklist (hold: task states) | Obsidian needs a theme. We have these four. |
| E10 | Task statuses, more | `- [>]` `- [<]` `- [*]` `- [i]` `- [b]` `- ["]` `- [l]` `- [p]` `- [c]` `- [f]` `- [I]` `- [S]` `- [n]` | ❌ | 🔌 | ❌ | ✅ HAVE | ON | toolbar: Checklist (hold: task states) | Common Obsidian theme set. `- [>]` stays plain text today. |
| E11 | Task in table cell | `\| [ ] \|` | ❌ | ❌ | ❌ | ✅ HAVE | ON | typed | Our extension. |
| E12 | Task without list marker | `[ ] a` | ❌ | ❌ | ❌ | ✅ HAVE | ON+guard | typed | LLMs sometimes write it. Guard: only at the line start. |
| E13 | Lazy continuation | `- a` / `b` (no indent) | ✅ | ✅ | ✅ | ⚠ BUG | ON | — | We cut the list and start a paragraph. |
| E14 | Item, second paragraph | blank line + indented text | ✅ | ✅ | ◐ | ✅ HAVE | ON | typed |  |
| E15 | Code block in an item | `- a` / indented ``` fence | ✅ | ✅ | ◐ | ⚠ BUG | ON | — | The fence is shown as text. LLMs do this a lot. |
| E16 | Quote / table in an item | indented `>` or table | ✅ | ✅ | ❌ | ❌ NO | ON | — |  |
| E17 | Heading in an item | `- # a` | ✅ | ✅ | ❌ | ❌ NO | OFF | — |  |
| E18 | Definition list | `term` / `: definition` | ❌ | ❌ | ❌ | ❌ NO | OFF | — | Pandoc / PHP Markdown Extra. |
| E19 | Pasted bullet characters | `• a`, `– a`, `· a` | ❌ | ❌ | ❌ | ✅ HAVE | ON+guard | auto | Not Markdown, but copy-paste from chat UIs often has them. Convert to `-` on paste. |
| E20 | Loose / tight lists | blank line between items | ✅ | ✅ | ✅ | ◐ PART | ON | auto | We draw both the same. |

## F. Quotes and callouts

GitHub alerts and Obsidian callouts share the `> [!TYPE]` shape but have different type lists. Obsidian shows an unknown type like `note`; GitHub shows a normal quote.

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| F01 | Blockquote | `> a`, `>a` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Quote |  |
| F02 | Nested quote | `> > a` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Quote + Nest in |  |
| F03 | Lazy quote continuation | `> a` / `b` | ✅ | ✅ | ✅ | ⚠ BUG | ON | — | We end the quote. |
| F04 | Quote with list / code / table / rule | `> - a`, `> ``` ` | ✅ | ✅ | ◐ | ✅ HAVE | ON | typed |  |
| F05 | GitHub alert NOTE | `> [!NOTE]` | ✅ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Note (Ctrl+Shift+2) | Obsidian understands it as callout `note`. |
| F06 | GitHub alert TIP | `> [!TIP]` | ✅ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Tip |  |
| F07 | GitHub alert IMPORTANT | `> [!IMPORTANT]` | ✅ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Important | In Obsidian `important` is an alias of `tip`. |
| F08 | GitHub alert WARNING | `> [!WARNING]` | ✅ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Warning (Ctrl+Shift+3) |  |
| F09 | GitHub alert CAUTION | `> [!CAUTION]` | ✅ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Caution | In Obsidian an alias of `warning`. |
| F10 | Callout info | `> [!info]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Info |  |
| F11 | Callout abstract | `> [!abstract]`, `[!summary]`, `[!tldr]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Abstract | Shown as literal `[!abstract]` text. |
| F12 | Callout todo | `> [!todo]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Todo |  |
| F13 | Callout success | `> [!success]`, `[!check]`, `[!done]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Success |  |
| F14 | Callout question | `> [!question]`, `[!help]`, `[!faq]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Question |  |
| F15 | Callout failure | `> [!failure]`, `[!fail]`, `[!missing]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Failure |  |
| F16 | Callout danger | `> [!danger]`, `[!error]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Danger |  |
| F17 | Callout bug | `> [!bug]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Bug |  |
| F18 | Callout example | `> [!example]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Example |  |
| F19 | Callout quote | `> [!quote]`, `[!cite]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Quote |  |
| F20 | Callout hint / attention | `> [!hint]`, `[!attention]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | via F06 | Aliases of tip / warning. |
| F21 | Callout custom title | `> [!note] My title` | ❌ | ✅ | ❌ | ✅ HAVE | ON | typed | GitHub ignores custom titles. |
| F22 | Callout foldable | `> [!note]- closed`, `> [!note]+ open` | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Callout ▸ Foldable, closed / open | We put `- ` into the title and cannot fold. |
| F23 | Callout nested | `> [!a]` / `> > [!b]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | toolbar: Quote + Nest in |  |
| F24 | Callout custom type (CSS) | `> [!bingo]` | ❌ | 🔌 | ❌ | ✅ HAVE | ON+guard | typed | Obsidian needs a CSS snippet. Mixed: unknown type = `note` look with the type name as title. |
| F25 | Callout lower/upper case | `[!NOTE]` = `[!note]` | ✅ | ✅ | ❌ | ✅ HAVE | ON | auto |  |

## G. Code

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| G01 | Fenced block, backticks | ```` ```js ```` ... ```` ``` ```` | ✅ | ✅ | ◐ | ✅ HAVE | ON | toolbar: Code block | Reddit: new editor only. |
| G02 | Fence with 4+ backticks | ```` ```` ```` (to show ``` inside) | ✅ | ✅ | ❌ | ✅ HAVE | ON | via G01 | We break the block. LLMs use it when they show Markdown. |
| G03 | Fenced block, tildes | `~~~` | ✅ | ✅ | ❌ | ✅ HAVE | ON | via G01 |  |
| G04 | Info string with extras | ```` ```js title="a" ````, ```` ```js {1,3} ```` | ✅ | ◐ | ❌ | ✅ HAVE | ON | typed | First word is the language, the rest is ignored. We break the block. |
| G05 | Indented code | 4 spaces or a tab | ✅ | ✅ | ✅ | ✅ HAVE | PICK | typed | THE code block of old Reddit. In GitHub/Obsidian it also works, but pasted indented text is often NOT meant as code. Reddit flavor only; mixed: only after a blank line and when not inside a list. |
| G06 | Syntax colours | 14 languages: js ts py c cpp java cs go rust sh sql json css html | ✅ | ✅ | ❌ | ◐ PART | ON | toolbar: Code block (language list) | GitHub colours hundreds of languages. Others stay plain, which is fine. |
| G07 | `diff` block | ```` ```diff ```` with `+` `-` lines | ✅ | ✅ | ❌ | ✅ HAVE | ON | typed | Colour + and - lines. |
| G08 | `math` fence | ```` ```math ```` | ✅ | ❌ | ❌ | ✅ HAVE | ON | via I02 | Treat as a `$$` block. Done 2026-11-07. Fences of diagrams we cannot draw (mermaid, plantuml, dot, geojson ...) show an error callout above the code. |
| G09 | `mermaid` fence | ```` ```mermaid ```` | ✅ | ✅ | ❌ | ◐ PART | OFF | auto | Shown as code. Drawing diagrams needs a library. |
| G10 | `geojson` `topojson` `stl` | fences | ✅ | ❌ | ❌ | ❌ NO | OFF | — | GitHub only. |
| G11 | Code in quote | `> ``` ` | ✅ | ✅ | ❌ | ✅ HAVE | ON | typed |  |
| G12 | Code in list item | indented fence | ✅ | ✅ | ◐ | ⚠ BUG | ON | — | See E. |

## H. Tables

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| H01 | Pipe table | `\|a\|b\|` / `\|-\|-\|` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Table… |  |
| H02 | Alignment | `:--` `:-:` `--:` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Table… (alignment) |  |
| H03 | Without outer pipes | `a\|b` / `-\|-` | ✅ | ✅ | ❌ | ✅ HAVE | ON | via H01 |  |
| H04 | Escaped pipe | `\\|` | ✅ | ✅ | ✅ | ✅ HAVE | ON | auto | Also inside `code`. |
| H05 | Formatting in cells | bold, links, code | ✅ | ✅ | ✅ | ✅ HAVE | ON | auto |  |
| H06 | Line break in a cell | `<br>` | ✅ | ✅ | ❌ | ✅ HAVE | ON | typed |  |
| H07 | Ragged rows | fewer / more cells | ✅ | ✅ | ✅ | ✅ HAVE | ON | auto | Padded or cut. |
| H08 | Table in quote | `> \|a\|` | ✅ | ✅ | ❌ | ✅ HAVE | ON | typed |  |
| H09 | Checkbox in a cell | `\| [ ] \|` | ❌ | ❌ | ❌ | ✅ HAVE | ON | typed | Our extension. |
| H10 | Table without header |  | ❌ | ❌ | ❌ | ❌ NO | OFF | — | None of the three. |
| H11 | HTML table | `<table><tr><td colspan>` | 🏷 | 🏷 | ❌ | ✅ HAVE | ON | typed | colspan/rowspan read. |
| H12 | Cell with list or paragraphs |  | ❌ | ❌ | ❌ | ❌ NO | OFF | — | Use `<br>`. |

## I. Math and diagrams

Our math draws a subset of LaTeX (no matrices, aligned, over/under braces).

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| I01 | Inline math | `$x^2$` | ✅ | ✅ | ❌ | ◐ PART | ON | Insert caret ▸ Math ▸ Inline math | Subset only. Reddit prints it. |
| I02 | Block math | `$$` on its own lines, or `$$x$$` on one line | ✅ | ✅ | ❌ | ◐ PART | ON | Insert caret ▸ Math ▸ Math block |  |
| I03 | Inline math with double dollars | `a $$x$$ b` | ✅ | ✅ | ❌ | ✅ HAVE | ON | via I01 | We print it literally. |
| I04 | LaTeX parentheses | `\(x^2\)` | ❌ | ❌ | ❌ | ✅ HAVE | ON | via I01 | ChatGPT and Gemini write this. We delete the backslashes and print `(x^2)`. Mixed: accept as `$x^2$`. |
| I05 | LaTeX brackets | `\[ x \]` | ❌ | ❌ | ❌ | ✅ HAVE | ON | via I02 | Same. Accept as a `$$` block. |
| I06 | LaTeX environments | `\begin{align}`, `\begin{bmatrix}` | ✅ | ✅ | ❌ | ❌ NO | ON | — | Needs a bigger math renderer. |
| I07 | Money guard | `costs $5 and $10` | ✅ | ✅ | ❌ | ✅ HAVE | ON | auto | Stays text. Keep this. |
| I08 | Math fence | ```` ```math ```` | ✅ | ❌ | ❌ | ✅ HAVE | ON | via I02 | See G. |
| I09 | Chemistry | `\ce{H2O}` | ✅ | 🔌 | ❌ | ❌ NO | OFF | — |  |
| I10 | Mermaid / flowchart | see G | ✅ | ✅ | ❌ | ◐ PART | OFF | auto |  |

## J. Footnotes, references, metadata, breaks, rules

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| J01 | Footnote | `a[^1]` + `[^1]: text` | ✅ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Blocks and notes ▸ Footnote | Multi-line definitions with indent work. |
| J02 | Footnote, named label | `[^note]` | ✅ | ✅ | ❌ | ✅ HAVE | ON | via J01 |  |
| J03 | Inline footnote | `^[text]` | ❌ | ✅ | ❌ | ✅ HAVE | ON | typed | See A30. |
| J04 | Footnote with no definition | `[^1]` alone | ✅ | ✅ | ❌ | ✅ HAVE | ON | auto | Stays text. |
| J05 | Reference definition | `[1]: url "title"` | ✅ | ✅ | ✅ | ✅ HAVE | ON | typed |  |
| J06 | YAML front matter | `---` / `key: v` / `---` at the top | ✅ | ✅ | ❌ | ◐ PART | ON | auto | GitHub draws a table; Obsidian shows Properties. We use `remind:` and `color:`; other front matter shows as a rule + text. Mixed: hide or fold it. |
| J07 | Abbreviation | `*[HTML]: text` | ❌ | ❌ | ❌ | ❌ NO | OFF | — | PHP Markdown Extra. |
| J08 | Hard break, two spaces | `a␠␠` / `b` | ✅ | ✅ | ✅ | ✅ HAVE | ON | auto | We break on ANY newline by default (a setting joins lines). |
| J09 | Hard break, backslash | `a\` / `b` | ✅ | ✅ | ❌ | ✅ HAVE | ON | typed | We print the backslash. |
| J10 | Soft line break | single newline | ◐ | ◐ | ◐ | ✅ HAVE | ON | settings: Writing ▸ single line breaks | GitHub joins lines in files, but breaks them in comments. Obsidian can do either. |
| J11 | Horizontal rule | `---` `***` `___` `- - -` | ✅ | ✅ | ✅ | ✅ HAVE | ON | toolbar: Horizontal rule |  |
| J12 | Backslash escapes | `\*` `\#` `\_` `\[` | ✅ | ✅ | ✅ | ✅ HAVE | ON | auto |  |
| J13 | HTML entities | `&amp;` `&lt;` `&nbsp;` `&#169;` | ✅ | ✅ | ◐ | ✅ HAVE | ON | auto | We print the entity text. LLM output has them. |
| J14 | Obsidian properties types | dates, lists, checkboxes | ❌ | ✅ | ❌ | ❌ NO | OFF | — |  |

## K. HTML blocks

Tags we do not understand are printed as text (never run).

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| K01 | Collapsible | `<details><summary>..</summary>..</details>`, `<details open>` | ✅ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Blocks and notes ▸ Collapsible section | Reddit: use spoiler. |
| K02 | Aligned block | `<div align="center">`, `<center>`, `<p align>` | ✅ | ✅ | ❌ | ✅ HAVE | ON | typed |  |
| K03 | Div / p wrapper | `<div>`, `<p>` | ✅ | ✅ | ❌ | ✅ HAVE | ON | typed | Shown as a box. |
| K04 | Headings as HTML | `<h1>` ... `<h6>` | ✅ | ✅ | ❌ | ✅ HAVE | ON | via D01 |  |
| K05 | Link tag | `<a href="..">` | ✅ | ✅ | ❌ | ✅ HAVE | ON | via B01 |  |
| K06 | Horizontal rule tag | `<hr>` | ✅ | ✅ | ❌ | ✅ HAVE | ON | via J11 |  |
| K07 | HTML list | `<ul><li>`, `<ol>` | ✅ | ✅ | ❌ | ❌ NO | ON | — | Printed as text. |
| K08 | HTML quote | `<blockquote>` | ✅ | ✅ | ❌ | ❌ NO | ON | — |  |
| K09 | HTML code | `<pre><code>` | ✅ | ✅ | ❌ | ❌ NO | ON | — | Printed as text with an inline code in the middle. |
| K10 | Definition list tags | `<dl><dt><dd>` | ✅ | ✅ | ❌ | ❌ NO | ON | — |  |
| K11 | Ruby text | `<ruby><rt>` | ✅ | ✅ | ❌ | ❌ NO | OFF | — |  |
| K12 | Script / style / iframe |  | ❌ | ❌ | ❌ | ❌ NO | OFF | — | Never as written by the note: a note must not be able to bring its own `<script>`, `<style>` or `<iframe>` into the chrome. The YouTube player (B24) is built by us from a validated video id, not passed through. |

## L. Auto-recognised text (mentions, references, emoji)

None of these must be turned on for text that is only text. Each one only changes how a word looks (a link, an icon).

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| L01 | GitHub mention | `@user`, `@org/team` | ✅ | ❌ | ❌ | ❌ NO | OFF | — | Needs the site. Plain text. |
| L02 | GitHub issue / PR | `#123`, `owner/repo#123`, `GH-123` | ✅ | ❌ | ❌ | ❌ NO | OFF | — | COLLISION 4 with tags. |
| L03 | Commit hash | `a5c3785` | ✅ | ❌ | ❌ | ❌ NO | OFF | — |  |
| L04 | Reddit user / subreddit | `u/name`, `/u/name`, `r/sub`, `/r/sub` | ❌ | ❌ | ✅ | ✅ HAVE | PICK | typed | Link to reddit.com. Reddit flavor only. |
| L05 | Emoji shortcode | `:smile:` `:+1:` | ✅ | 🔌 | ◐ | ✅ HAVE | ON+guard | typed | COLLISION 5. GitHub knows a fixed set. Reddit shortcodes are per-subreddit. `10:30:45` must not match. Guard: known names only. |
| L06 | Color chip | `#ff0000` / `rgb(..)` / `hsl(..)` in backticks | ✅ | ❌ | ❌ | ❌ NO | OFF | — | GitHub only. |
| L07 | Date / time | `2026-11-07` | ❌ | ❌ | ❌ | ✅ HAVE | ON | Insert caret ▸ Date and time ▸ Today's date / The time | Owner decision 2026-11-07: recognise dates so the calendar view and several reminders (roadmap ranks 9 and 21) can use them. `2026-11-07` and `2026-11-07 14:30` become a date chip (`data-ymd`); the typing shortcuts in section N write exactly this form. Done 2026-11-07: drawn as a date chip (`data-ymd`, `data-time`); nothing uses it yet. |

## M. Things chat models (Gemini, ChatGPT, Claude) put in answers

Goal: copy a reply, paste it, it just works. This is the shortlist that matters most.

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| M01 | `**Label:** text` lines | bold label then text | ✅ | ✅ | ✅ | ✅ HAVE | ON | via A01 |  |
| M02 | Headings `##` and `###` |  | ✅ | ✅ | ✅ | ✅ HAVE | ON | via D01 |  |
| M03 | Bullets with 4-space nesting | `* a` / `    * b` | ✅ | ✅ | ✅ | ✅ HAVE | ON | via E04 | Gap in nesting level, see E. |
| M04 | Numbered steps with code blocks inside | `1. a` / indented fence | ✅ | ✅ | ◐ | ⚠ BUG | ON | — | Very common. Must fix. |
| M05 | Tables with `<br>` |  | ✅ | ✅ | ❌ | ✅ HAVE | ON | auto |  |
| M06 | LaTeX `\( \)` and `\[ \]` |  | ❌ | ❌ | ❌ | ✅ HAVE | ON | auto | Very common in Gemini and ChatGPT. |
| M07 | `$$ ... $$` blocks |  | ✅ | ✅ | ❌ | ✅ HAVE | ON | via I02 |  |
| M08 | Horizontal rules `---` between sections |  | ✅ | ✅ | ✅ | ✅ HAVE | ON | via J11 |  |
| M09 | Emoji in headings and bullets |  | ✅ | ✅ | ✅ | ✅ HAVE | ON | auto |  |
| M10 | Fenced code with language |  | ✅ | ✅ | ◐ | ✅ HAVE | ON | via G01 |  |
| M11 | ```` ```markdown ```` wrapper around the whole answer |  | ✅ | ✅ | ❌ | ✅ HAVE | ON | auto | Shows as code (correct). Maybe an option: unwrap on paste. |
| M12 | Citations `[1]`, `[cite: 1]`, `[[1]](url)` |  | ❌ | ❌ | ❌ | ◐ PART | ON+guard | auto | `[1]` stays text unless a definition exists. `[[1]](url)` may collide with `[[` link shorthand: guard. |
| M13 | Footnotes `[^1]` |  | ✅ | ✅ | ❌ | ✅ HAVE | ON | via J01 |  |
| M14 | GitHub alerts `> [!NOTE]` |  | ✅ | ✅ | ❌ | ✅ HAVE | ON | via F05 |  |
| M15 | Obsidian callouts all types |  | ❌ | ✅ | ❌ | ✅ HAVE | ON | via F10 | 6 of 13 types. |
| M16 | `<details>` collapsibles |  | ✅ | ✅ | ❌ | ✅ HAVE | ON | via K01 |  |
| M17 | Task lists `- [ ]` |  | ✅ | ✅ | ❌ | ✅ HAVE | ON | via E08 |  |
| M18 | Unicode arrows, bullets `•` |  | ✅ | ✅ | ✅ | ◐ PART | ON | auto | Text is fine; `•` at line start should become a list. |
| M19 | `&nbsp;` `&amp;` entities |  | ✅ | ✅ | ◐ | ✅ HAVE | ON | auto |  |
| M20 | Mermaid diagrams |  | ✅ | ✅ | ❌ | ◐ PART | OFF | auto | Code view only. |
| M21 | `<br>` for line breaks outside tables |  | ✅ | ✅ | ❌ | ✅ HAVE | ON | typed |  |
| M22 | Wikilinks `[[Note]]` (when you ask for Obsidian) |  | ❌ | ✅ | ❌ | ✅ HAVE | ON | via C01 | Heading and block forms missing, see C. |
| M23 | YAML front matter with title/tags |  | ✅ | ✅ | ❌ | ◐ PART | ON | auto | See J. |
| M24 | Reddit `>!spoiler!<` and `^(sup)` (when you ask for Reddit) |  | ❌ | ❌ | ✅ | ✅ HAVE | PICK | typed |  |

## N. Typing shortcuts (write a word, get a date)

You type the shortcut in the editor; Notes swaps it for plain text the moment you finish it (`}}` or a Space/Enter after the word). The note then holds ordinary text, so every other app reads it, and no flavor mode changes it. Setting `text_shortcuts` = all / braces only / off; formats are the settings `shortcut_date_format` (default `YYYY-MM-DD`) and `shortcut_time_format` (default `HH:mm`). Format tokens: `YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm m ss s A a`, `[text]` is copied as it is. A shortcut is never expanded inside a code fence or an inline code span, in a web address, or in an e-mail address.

Dates written this way are plain ISO text (`2026-11-07`, `2026-11-07 14:30`), and Notes now recognises that form as a date (row L07). That is the hook for the calendar view and several reminders in the roadmap.

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| N01 | Today / now / title variables | `{{date}}` `{{time}}` `{{title}}` | ❌ | ✅ | ❌ | ✅ HAVE | ON | typed | Obsidian Templates plugin (a core plugin). Ours expands when you type the closing `}}`; Obsidian only expands when a template is inserted. |
| N02 | Variables with your own format | `{{date:DD.MM.YYYY}}` `{{time:hh:mm A}}` | ❌ | ✅ | ❌ | ✅ HAVE | ON | typed | Obsidian syntax. |
| N03 | More variables | `{{datetime}}` `{{now}}` `{{today}}` `{{tomorrow}}` `{{yesterday}}` `{{weekday}}` | ❌ | ❌ | ❌ | ✅ HAVE | ON | typed | Ours. |
| N04 | At-words | `@today` `@date` `@now` `@datetime` `@time` `@tomorrow` `@yesterday` `@weekday` | ❌ | ❌ | ❌ | ✅ HAVE | ON+guard | typed | Notion. Guard: a whole word after Space, Enter or the start of the line; `me@today` is an e-mail, not a shortcut. |
| N05 | Slash-words | `/today` `/date` `/now` `/time` `/tomorrow` `/yesterday` `/weekday` | ❌ | ❌ | ❌ | ✅ HAVE | ON+guard | typed | Logseq. Guard: only after a space or at the start of a line, so `a/today` and web addresses stay as typed. |
| N06 | Date offsets | `@+3d` `@-2d` `@+1w` `@+2m` `@+1y` (also `/+3d`) | ❌ | ❌ | ❌ | ✅ HAVE | ON+guard | typed | Ours, made for reminders: a date that far from today. |
| N07 | Next weekday | `@monday` ... `@sunday`, `@mon` ... `@sun` (also `/monday`) | ❌ | ❌ | ❌ | ✅ HAVE | ON+guard | typed | Ours: the next such day after today (never today). |
| N08 | Insert-date hotkey | Ctrl+key: insert today's date / the time | ❌ | ✅ | ❌ | ✅ HAVE | ON | Insert caret ▸ Date and time ▸ Today's date / The time (or assign a key) | Obsidian command "Insert current date". Needs two assignable actions in the shortcut list. Done 2026-11-07 (3.2.0): "Insert today's date" and "Insert the time" are assignable actions (no default key, under Keyboard shortcuts) and entries of the Insert caret menu, in the format of the typing shortcuts. |
| N09 | Date picker after `@` | type `@`, pick a day in a small calendar | ❌ | ❌ | ❌ | ❌ NO | ON+guard | — | Notion. Waits for the calendar view (roadmap rank 21). |
| N10 | Templater code | `<% tp.date.now("YYYY-MM-DD") %>` | ❌ | 🔌 | ❌ | ❌ NO | OFF | — | Obsidian community plugin that runs JavaScript. Never: a note must not run code. `{{date}}` does the same. |
| N11 | Text-expander words | `;date` `;time` | ❌ | ❌ | ❌ | ❌ NO | OFF | — | System text expanders. Collides with ordinary text; `@` and `/` already cover it. |

## O. Syntax from other apps (Discord, markdown-it, Slack)

Not limited to GitHub, Obsidian and Reddit: anything that does not collide with our symbols is welcome in the mixed modes. In the "only" modes these stay plain text, because none of the three apps reads them. Spoilers (A29) and `++a++` (A20) in section A come from here too.

| ID | Feature | Symbols you can paste | GitHub | Obsidian | Reddit | Notes today | Mixed | GUI in Notes | Note |
|---|---|---|:-:|:-:|:-:|:-:|:-:|---|---|
| O01 | Small text line (Discord) | `-# small text` | ❌ | ❌ | ❌ | ✅ HAVE | ON | typed | Discord sub-text. A line that starts with `-# `. |
| O02 | Multi-line quote (Discord) | `>>> a` | ❌ | ❌ | ❌ | ❌ NO | OFF | — | Collides with three nested quotes written without spaces. |
| O03 | Underline by underscores (Discord) | `__a__` | ❌ | ❌ | ❌ | ✅ HAVE | OFF | typed | Collision: `__a__` is bold everywhere else; we keep bold. |
| O04 | Container blocks (markdown-it, VitePress, Docusaurus) | `::: warning` ... `:::` | ❌ | ❌ | ❌ | ✅ HAVE | ON | typed | Maps to the callout of the same name (`tip`, `info`, `warning`, `danger`, `details` = folded). Pasted documentation uses it. |
| O05 | Single-star bold (Slack) | `*a*` as bold, `~a~` as strike | ❌ | ❌ | ❌ | ✅ HAVE | OFF | typed | Collides with Markdown italic. We keep Markdown. |

## Typed-only syntax (implemented, no button)

These work when you type or paste them. None of them has a button on purpose: it is another app's spelling of something that has one (for example Reddit `^word` next to the Superscript entry), a short symbol that IS the feature (tags `#a`, aliases `[[a|b]]`, `@today`), or text that arrives by paste. If one of them should get a button, add it to the Insert caret menu, `SHORTCUT_ACTIONS`, `HIDEABLE_TOOLS` and the `WRITING_UI` table in `tests/notes-writing-ui.test.cjs`, which fails until every action has a place in the GUI.

- A17 Superscript (Reddit)
- A23 HTML bold/italic/strike
- A24 Line break tag
- A25 Coloured / styled text
- A26 Other presentational tags
- A27 Spoiler (Reddit)
- B07 Reference link
- B08 Collapsed reference
- B09 Shortcut reference
- B18 Image reference
- B20 Image tag
- C02 Wikilink with alias
- C14 Tag
- D02 Heading without space
- E11 Task in table cell
- E12 Task without list marker
- E14 Item, second paragraph
- F04 Quote with list / code / table / rule
- F21 Callout custom title
- F24 Callout custom type (CSS)
- G04 Info string with extras
- G05 Indented code
- G07 `diff` block
- G11 Code in quote
- H06 Line break in a cell
- H08 Table in quote
- H09 Checkbox in a cell
- H11 HTML table
- J05 Reference definition
- J09 Hard break, backslash
- K02 Aligned block
- K03 Div / p wrapper
- L04 Reddit user / subreddit
- L05 Emoji shortcode
- M21 `<br>` for line breaks outside tables
- M24 Reddit `>!spoiler!<` and `^(sup)` (when you ask for Reddit)
- N01 Today / now / title variables
- N02 Variables with your own format
- N03 More variables
- N04 At-words
- N05 Slash-words
- N06 Date offsets
- N07 Next weekday
- O01 Small text line (Discord)
- O03 Underline by underscores (Discord)
- O04 Container blocks (markdown-it, VitePress, Docusaurus)
- O05 Single-star bold (Slack)

## Work list: what is left (2026-11-07, notes 3.1.30)

Everything below is `Notes today` = NO / BUG / PART and `Mixed` = ON or ON+guard. The easy rows that were open on 2026-11-07 are done (B03 B04 B09 B12 B17 B18, A05 A19 A20 A25 A26 A31 A32, C14, D02 D03, E05 E07 E10 E12 E19, F11 to F20 F22 F24, G02 G03 G04 G05 G07 G08, I03 I04 I05 I08 M06, J09 J13 M19, L04 L05 L07, O01 O04, A09 A17 A27 A29 M24, N01 to N07). What remains is split in two:

**Small (one short cycle together)**

- B02 Link with title.
- B06 Link to a heading.
- B16 Image with title.
- B20 Image tag.
- D04 Setext heading.
- E20 Loose / tight lists.
- G06 Syntax colours.
- I01 Inline math.
- I02 Block math.
- M12 Citations `[1]`, `[cite: 1]`, `[[1]](url)`.
- M18 Unicode arrows, bullets `•`.

**Hard (each gets its own cycle; they are rows in `TODO_notes_roadmap.md`, in order of importance there)**

- A30 Inline footnote. Inline footnote `text^[note]`: needs footnote numbers made on the fly (J03 is the same row).
- B24 YouTube embed. YouTube only. See roadmap rank 22 for the security design.
- C03 Link to heading. Link to heading `[[Note#Heading]]`: match the note by title, then the heading by text (decision 2026-11-07), keep our id system underneath.
- C04 Link to heading in same note. `[[#Heading]]` in the same note.
- C05 Link to block. `[[Note#^abc123]]`: needs block ids (C07).
- C06 Heading link with alias. `[[Note#Heading|alias]]`.
- C07 Block id. Block id `^abc123` at the end of a paragraph (collision 2, the caret).
- C08 Link by path. `[[folder/Note]]`: title lookup first, folder second.
- C09 Link to file with extension. `[[Note.md]]`, `[[img.png]]`.
- C10 Embed note. `![[Note]]` embed: read-only, one level deep, no loops (decision 2026-11-07).
- C11 Embed heading / block. `![[Note#Heading]]` and `![[Note#^id]]`, same rules as C10.
- C15 Tags in front matter. Tags in front matter; needs the tag index (roadmap rank 32).
- C16 Aliases in front matter. Aliases in front matter: a note answers to several titles in `[[ ]]`.
- C17 Backlinks panel. Backlinks panel: exists for our own links; the Obsidian forms come with C03 to C11.
- D08 Auto heading anchors. Heading anchors for every heading.
- E13 Lazy continuation. Lazy continuation (`- a` then an unindented `b`): needs a structural list parser.
- E15 Code block in an item. Code block inside a list item: the fence now shows as a code block after the list, not inside the item.
- E16 Quote / table in an item. Quote or table inside a list item.
- F03 Lazy quote continuation. Lazy quote continuation (`> a` then an unquoted `b`).
- G12 Code in list item. See E15.
- I06 LaTeX environments. `\\begin{align}`, `\\begin{bmatrix}`: needs a bigger math renderer.
- J03 Inline footnote. See A30.
- J06 YAML front matter. Fold or hide YAML front matter.
- K07 HTML list. HTML `<ul><li>`.
- K08 HTML quote. HTML `<blockquote>`.
- K09 HTML code. HTML `<pre><code>`.
- K10 Definition list tags. HTML `<dl><dt><dd>`.
- M04 Numbered steps with code blocks inside. Numbered steps with code blocks inside: see E15. The most-pasted case of the group.
- M23 YAML front matter with title/tags. See J06.
- N09 Date picker after `@`. Date picker after `@`: waits for the calendar view (roadmap rank 21).

## Decisions (owner, 2026-11-07)

1. `~a~` default: no strong view, so a setting switches between subscript and strike (`single_tilde`). Default stays subscript.
2. The flavor is per note (the whole note, never per line); the setting is the default for notes that do not choose.
3. Export: when a note holds syntax the target app does not know (`==x==`, `X^2^`, `[!todo]`), Notes ASKS what to do with it (keep, rewrite to something the app knows, or drop). Roadmap row "Export asks about extensions".
4. `[[Note#Heading]]`: match the note by title, then the heading by text; our id system stays underneath (a link keeps working after a rename).
5. `![[Note]]` embeds: read-only, one level deep, no loops.
6. Dates are recognised (L07) so reminders and the calendar view can use them; the typing shortcuts (section N) write exactly that form.
7. Syntax the owner does not want can be listed under `ignore_syntax` and then shows as plain text; a fence of something we cannot draw shows an error callout.
8. We are not limited to GitHub, Obsidian and Reddit: Discord, markdown-it and similar syntax is welcome in the mixed modes when it does not collide with ours (section O).
9. Video: YouTube only (B24), never raw HTML or other hosts (B23). K12 (script / style / iframe written by a note) stays "never".

## How this was checked

Notes-today cells were produced by a throw-away script that loads `additional/notes/ZentralNotes.uc.js` in a sandbox (same way `tests/notes-markdown.test.cjs` does) and runs `core.parseBlocks` on one input per row. Things drawn later by the editor (the `[[` title lookup, images, math rendering, highlighting) are marked from the code comments and tests, not from rendering in Zen. Re-run the probe after any parser change; turning this into a test fixture (`tests/notes-flavors.test.cjs`, one line per row) is the natural next step.

