# zentral/groups/styles

Owner and local file guide for Extended 3.0.0. Original Zentral reference: 1.1.0.

| File                           | Responsibility                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `ZentralGroupMenus.css`        | Suppress replaced native group menus and style custom Close Group actions.        |
| `ZentralGroupPresentation.css` | Group headers/cards, initials, marquee, hover preview and tooltip presentation.   |
| `ZentralGroupStructure.css`    | Native group layout, keyboard focus and split-group header suppression.           |
| `ZentralGroupsInjected.css`    | Group enhancement rules injected by the Groups class into a chrome style element. |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.
