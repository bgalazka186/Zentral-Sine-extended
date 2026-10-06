# Look application and validation

Start at `ZentralAppearance.js`. Exports look defaults/themes/validation and applies root attributes/CSS variables. The local stylesheet consumes them; shared FeatureSettings supplies UI and Backup supplies optional import/export.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File | Responsibility |
| --- | --- |
| `ZentralAppearance.css` | Theme/look variables, colors and opacity rules driven by Appearance settings/root attributes. |
| `ZentralAppearance.js` | Look preference definitions/themes, color/bounds validation and root attribute/CSS-variable synchronization after edits/imports. |

## Outside collaborators

- `features/panels/ZentralPanels.uc.js`

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.
