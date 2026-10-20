# docs

Owner and local file guide for Extended 3.0.0. Original Zentral reference: 1.1.0.

| File                   | Responsibility                         |
| ---------------------- | -------------------------------------- |
| `BASE-PATCHES.md`      | Local documentation/reference artifact |
| `UPDATING-UPSTREAM.md` | Local documentation/reference artifact |
| `UPSTREAM-MAP.json`    | Local settings/schema metadata         |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.

`REQUEST-AUDIT.md` maps earlier user requests to current owners, distinguishes source implementation from live verification, and records remaining gaps.
