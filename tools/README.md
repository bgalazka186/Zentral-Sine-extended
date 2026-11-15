# tools

Owner and local file guide for Extended 3.3.168. Original Zentral reference: 1.1.0.

| File                    | Responsibility                        |
| ----------------------- | ------------------------------------- |
| `build-preferences.cjs` | Local source/contract; see its header |
| `update-provenance.py`  | Local source/contract; see its header |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.

## build-standalone.cjs

Builds the Sine-installable standalone packages (`additional/**/standalone.json`). `--check` fails if generated files are stale; `--bump` raises the patch version when content changed. Run `node tests/standalone.test.cjs` after. See `docs/SINE-MODULAR-INSTALL.md`.

## sync-version.cjs

Keeps the main mod and every standalone module on one version (rule in `AGENTS.md`, "Version bumps"). Without arguments it raises every version marker (root `theme.json`, `UPSTREAM.json`, loader headers, the settings badge, `INSTALL.md`, `.github/README.md`, the local guide READMEs and every `additional/**/standalone.json`) to the highest version found; `--set X.Y.Z` picks the version; `--check` only reports drift. Run it between `build-standalone.cjs --bump` and a second `build-standalone.cjs`, which regenerates the bundles. `tests/version-sync.test.cjs` fails while anything lags behind.

## audit-standalone.cjs

Informational dependency report for standalone-capable modules (foreign prefs, attributes, CSS variables, other files styling a module's attributes). The build enforces the hard checks; run this when adding or changing a standalone module.
