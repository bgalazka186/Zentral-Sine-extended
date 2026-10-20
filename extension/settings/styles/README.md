# extension/settings/styles

Owner and local file guide for Extended 3.0.0. Original Zentral reference: 1.1.0.

| File                            | Responsibility                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `ZentralControls.css`           | Shared panel and settings control presentation.                                     |
| `ZentralSettings.css`           | Settings categories/navigation/search and content scrolling.                        |
| `ZentralSettingsFoundation.css` | Shared settings modal, app editor and base control presentation.                    |
| `ZentralSettingsInjected.css`   | Modal/base control rules injected by the SettingsShell into a chrome style element. |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.
