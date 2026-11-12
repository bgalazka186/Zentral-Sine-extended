# Diagnostic logging

Start at `ZentralLogger.uc.js`. Optional logger/console/native-event capture and export. Its settings are local; bootstrap source diagnostics also exist independently in core.

## Sharing this area for a review

Send this folder for a change confined to its behavior. Include the specific outside collaborator below only if the issue crosses that interface. Each source header explains its callers, contracts and cleanup. Folder ownership does not make every internal controller optional or independently installable.

| File                  | Responsibility                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ZentralLogger.uc.js` | Optional diagnostic logger with console capture/filtering, native event reports and export/report support. |
| `settings.json`       | Settings schema and category/section metadata owned by logger.                                             |

Full installation uses root `theme.json` and `preferences.json`, plus `loader/`; Sine loads `loader/Zentral.uc.js`; a stale main registration can forward through `JS/Zentral.uc.js`. Per-feature settings.json is metadata, not an activation script.


## Install as a standalone Sine feature

In Sine, add this folder as a mod using:

`https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/diagnostics`

Enable Sine's `sine.allow-unsafe-js` setting and restart Zen after the first install. Sine pulls later updates from this folder; the feature's settings appear in Sine's preferences for this mod. The full-pack root URL can be installed instead; when both are present, Zentral Extended owns the feature and the standalone copy stays inactive.

`ZentralLogger.standalone.uc.js`, `theme.json`, `preferences.json` and `standalone.lock.json` are **generated** by `node tools/build-standalone.cjs` from `ZentralLogger.uc.js`; edit the source and rebuild, never the generated files. Status: unit-tested with a simulated window only; not yet verified through a real Sine install (see `docs/SINE-MODULAR-INSTALL.md`, gates 6.1-6.6).
