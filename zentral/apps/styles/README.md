# zentral/apps/styles

Owner and local file guide for Extended 3.0.0. Original Zentral reference: 1.1.0.

| File                                 | Responsibility                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `ZentralAppMenus.css`                | App context-menu empty-area filtering and destructive Remove action.                       |
| `ZentralAppTiles.css`                | App tile loaded/active states and compact/horizontal tile presentation.                    |
| `ZentralAppsInjected.css`            | Apps grid/bar, utility and panel base rules injected by the Apps class into a chrome style |
| `ZentralAutohideIndicators.css`      | Eye icon state for vertical-bar and utility autohide buttons.                              |
| `ZentralLauncherAutohide.css`        | Refresh-button animation and sidebar launcher collapsed/revealed grid states.              |
| `ZentralUtilityControls.css`         | Utility section reveal transition, dot triggers, slots, buttons and divider.               |
| `ZentralUtilityPlacement.css`        | Horizontal utility placement, reveal dimensions and permanent-hide policy.                 |
| `ZentralVerticalBarLayout.css`       | Vertical app bar docking, autohide frame, background, footer and geometry.                 |
| `ZentralVerticalBarPresentation.css` | Vertical-bar tile/icon states and panel hover/resize hit regions.                          |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.
