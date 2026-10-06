# Diagnostic logging

Start at `ZentralLogger.uc.js`. Optional logger/console/native-event capture and export. Its settings are local; bootstrap source diagnostics also exist independently in core.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File | Responsibility |
| --- | --- |
| `ZentralLogger.uc.js` | Optional diagnostic logger with console capture/filtering, native event reports and export/report support. |
| `settings.json` | Settings schema and category/section metadata owned by logger. |

Full installation uses root `theme.json` and `preferences.json`, plus `core/`; Sine loads `core/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.
