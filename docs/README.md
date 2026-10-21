# docs

Owner and local file guide for Extended 3.0.2. Original Zentral reference: 1.1.0.

| File                   | Responsibility                         |
| ---------------------- | -------------------------------------- |
| `BASE-PATCHES.md`      | Local documentation/reference artifact |
| `UPDATING-UPSTREAM.md` | Local documentation/reference artifact |
| `UPSTREAM-MAP.json`    | Local settings/schema metadata         |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.

`REQUEST-AUDIT.md` maps earlier user requests to current owners, distinguishes source implementation from live verification, and records remaining gaps.

`VIDEO-PREVIEW-REPAIR.md` records the current changed-files overlay, enlarged-player/resize fixes, portable recommendation policy, settings and verification limits. `REPAIR-FILES.json` lists the changed overlay files and hashes relative to the uploaded tree.

`VIDEO-PREVIEW-FOLLOWUP.md` supersedes the first video repair where live feedback exposed regressions. Its ZIP is an incremental overlay on the preceding changed-files package.

[Sidebar, player input and appearance audit](SIDEBAR-AND-PLAYER-INPUT.md) documents the 3.0.2 follow-up, settings and validation limits.
