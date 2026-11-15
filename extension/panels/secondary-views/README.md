# Secondary views

Start at `ZentralSecondaryViews.uc.js`. Optional panel generator part for Triple View/Super Pin. The coordinator and required panel internals are prerequisites; settings.json describes its owned preferences.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                          | Responsibility                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ZentralSecondaryViews.uc.js` | Optional Triple View/Super Pin secondary browser shells and associated toolbar/geometry synchronization. |
| `settings.json`               | Settings schema and category/section metadata owned by secondary-views.                                  |

Full installation uses root `theme.json` and `preferences.json`, plus `loader/`; Sine loads `loader/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.

Triple swap changes slot roles and reconstructs only the secondary chrome. Neither remote browser is reopened or reparented; B016 synchronizes the base active identity and the floating owner transfers the combined host placement. Optional secondary toolbar tools scroll in their own flex group; URL, Save and Close remain separate.

Notes between the two panels (`additional/notes`) asks for a gap above the divider through `--zentral-notes-gap` and for the part of it the upper panel gives through `--zentral-notes-gap-up`. While the gap is held, each panel keeps a floor of 120 px, or a quarter of what the two share without Notes when that is less (`tripleFloor`; Notes applies the same rule, and `tests/notes-triple-view-startup.test.cjs` compares the two). The floor must not depend on the height of the gap: a panel resting on it would move with every px of the gap, and with it the edge of Notes that is not being dragged. When a floor holds a panel, `fitSecondaryBrowsers` writes the split it applied back to `--zentral-notes-gap-up`, because Notes starts its next edge drag from that variable. When the gap goes away each panel takes back half of it and the split is saved (`tripleShareAfterNotes`); the half is a whole px, rounded as Notes rounds the upper part of a new gap (`Math.round(px / 2)`), so a gap that closes and opens again is a round trip. With the exact half, a gap of an odd height moved the divider half a px at every round, and a panel that slides away and returns with Notes open is one round.

Super Pin selects the side with more available space. Its destination shell is connected before invoking the existing native `_zentralMoveTo` owner (or a supported atomic move); returning uses the same owner. Never reappend a connected shell with a live browser just to set its position. Bounded shell-owned readiness work repairs geometry/activity and a cold blank initial navigation, and is cancelled with the shell.
