# extension/panels/navigation/styles

Owner and local file guide for Extended 3.1.3. Original Zentral reference: 1.1.0.

| File                         | Responsibility                                                              |
| ---------------------------- | --------------------------------------------------------------------------- |
| `ZentralPanelBackground.css` | Toolbar-controlled panel black backing and related root attribute rules.    |
| `ZentralPanelToolbar.css`    | Panel URL/search/navigation controls and quick-switch/backing presentation. |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.
