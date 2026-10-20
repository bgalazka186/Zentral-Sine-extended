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

Super Pin selects the side with more available space. Its destination shell is connected before invoking the existing native `_zentralMoveTo` owner (or a supported atomic move); returning uses the same owner. Never reappend a connected shell with a live browser just to set its position. Bounded shell-owned readiness work repairs geometry/activity and a cold blank initial navigation, and is cancelled with the shell.
