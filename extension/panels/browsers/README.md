# Panel browser ownership and identity

Start at `ZentralBrowserIntegrations.uc.js`. Required panel generator part. Owns container/mobile identity and real-tab host bookkeeping/activity. Failed native removal must retain ownership. Its stylesheet and settings are beside the code.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                               | Responsibility                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ZentralBrowserIntegrations.css`   | Container/mobile-UA/add-on host controls and browser integration presentation.                                                        |
| `ZentralBrowserIntegrations.uc.js` | Owns containers/mobile user agent, add-on real-tab host records/folder, browser adoption/removal and docshell/render activity policy. |
| `settings.json`                    | Settings schema and category/section metadata owned by browser-integrations.                                                          |

## Outside collaborators

- `extension/panels/ZentralPanels.uc.js`
- `extension/panels/corner-tiles/ZentralCornerPanels.uc.js`
- `extension/panels/styling/ZentralPanelStyles.uc.js`

Full installation uses root `theme.json` and `preferences.json`, plus `loader/`; Sine loads `loader/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.

The repair keeps Super Pin in a modern flex column with a nonzero browser surface and independent input/activity policy. Native host progress filters are repaired on frame-loader creation and before native teardown; use the current progress owner and the existing native filter, never replace global native removal methods. These private Firefox APIs require live verification after browser updates.
