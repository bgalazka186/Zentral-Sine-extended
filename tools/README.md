# tools

Owner and local file guide for Extended 3.0.0. Original Zentral reference: 1.1.0.

| File                    | Responsibility                        |
| ----------------------- | ------------------------------------- |
| `build-preferences.cjs` | Local source/contract; see its header |
| `update-provenance.py`  | Local source/contract; see its header |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.
