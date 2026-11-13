# tools

Owner and local file guide for Extended 3.3.82. Original Zentral reference: 1.1.0.

| File                    | Responsibility                        |
| ----------------------- | ------------------------------------- |
| `build-preferences.cjs` | Local source/contract; see its header |
| `update-provenance.py`  | Local source/contract; see its header |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.

## build-standalone.cjs

Builds the Sine-installable standalone packages (`additional/**/standalone.json`). `--check` fails if generated files are stale; `--bump` raises the patch version when content changed. Run `node tests/standalone.test.cjs` after. See `docs/SINE-MODULAR-INSTALL.md`.

## audit-standalone.cjs

Informational dependency report for standalone-capable modules (foreign prefs, attributes, CSS variables, other files styling a module's attributes). The build enforces the hard checks; run this when adding or changing a standalone module.
