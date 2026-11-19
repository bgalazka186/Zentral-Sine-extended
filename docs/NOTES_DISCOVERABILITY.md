# Notes: where is a function?

One place per function. This audit lists every control of the Notes mod and the one place it lives, so two
features never compete for the same door. It is checked against the code by `tests/notes-discoverability.test.cjs`
and it is also available inside the app from **More → Where is a function?** (note id `zn-help-where`, a normal
note, re-created with the shipped text on every visit).

## 1. While writing a note

| Function | One place |
| --- | --- |
| Bold, italic, strike, highlight, inline code | Editor toolbar |
| Headings, lists, checklist, quote, callout, rule | Editor toolbar |
| Nest in / nest out | Editor toolbar |
| Link, image, table, table of contents | Editor toolbar |
| Pictures, callouts, more text styles, math, collapsible section, footnote, hub list, date and time | Caret menu at the end of the toolbar |
| Import and export, labels, reminder, templates, version history, calendar-only, birthday entries, duplicate, move to folder, Markdown mode of this note, window, settings and help | **More** (three dots) |
| Text size, line height, wrapping, blank lines, line breaks, scroll sync, copy format, Markdown mode, theme | Quick settings (sliders) |

Task states are a **hold** on the checklist button, not a second menu.

## 2. Settings (All settings)

There are **seven tabs**: **Writing**, **Markdown**, **Window**, **Appearance**, **Capture**, **Links & history**,
**Zen sidebar**.

The rows that people look for in a tab of their own are rows of **Links & history**: Reminders (missed-digest look-back
window, quiet hours, sound), version history, the Trash lifetime, find highlighting and spell check. The
Keyboard shortcuts dialog opens from the bottom of that tab. There is no separate Reminders tab, and the audit keeps it
that way on purpose: a seventh door would hide the other six.

## 3. All notes

- The `+` control creates a note, folder, reminder, event or date note; right-click it for the full menu.
- A row: right-click for rename, move, colour, label, exclusion, calendar-only, trash and share. Dragging a row onto a
  calendar day adds it to the calendar.
- Shift or Ctrl click rows for the batch bar (move, tag, label, category, export, trash).
- The tree order, the visible folders and the trash live in the tree header, never in the row menu.

## 4. Calendar

- **Toolbar**: view, Prev/Next/Today, size, visible hours, display zone, filters.
- **Tools**: create, Reminder history, sounds and quiet hours, Agenda visibility, Week start, Display time zone,
  Holidays & days off, Free slots, Big picture, week as Markdown, print.
- **A day**: a click selects it; right-click for Day view, create, and a personal day off.
- **An item**: a click opens it; right-click for edit, move, snooze, done, dismiss, colour, calendar note and delete.

Calendar settings live in `Tools`, not in All settings: they belong to the calendar and are undoable there.

## 5. Zen sidebar

- The Notes folder mirrors the tree; hovering a tab shows the note preview.
- The Agenda folder lists the items inside their display window, with hover actions and headless Done, Dismiss,
  Snooze and Open. The Agenda root menu holds Open calendar, Refresh, Agenda settings and Hide Agenda.

## 6. Holidays

`Tools → Holidays & days off` is the single door: any number of public holiday sets (independent of the interface
language), weekends, personal days off, and the newest year each set covers. A trading Sunday is drawn but is never a
day off. One switch turns every holiday feature off. Holidays have no second door, and this audit accepted that: a
settings row would only duplicate the switch.

## 7. Discoverability findings

1. **Two menus shared action names** (note row menu and the editor **More** menu both carried "Duplicate" and "Move to
   folder"). Fixed by wording: the editor menu names the note it acts on.
2. **Two Markdown-mode labels were indistinguishable.** Fixed: the default is "Markdown mode for every note (a single
   note sets its own in its More menu)", the per-note group keeps the short "Markdown mode".
3. **Holidays had no second door.** Accepted without a change, see above.
4. **`Reminders` is a group inside `Links & history`, not a tab.** Deferred: the document now says so; the tab split is
   a product decision, not a bug.
5. **Calendar settings live in `Tools`.** Accepted without a change.

The input this list feeds is **T2.11b2** (the rebuilt demo notes): the syntax tour, the calendar tour and this list are
one narrative, and every new control is added here first.

Re-run this audit after any new control, menu entry or Settings row lands. A function with two places is a bug; a
function with none is a discovery gap and belongs in this list before it is documented anywhere else.
