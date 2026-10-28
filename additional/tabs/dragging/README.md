# additional/tabs/dragging

Owner and local file guide for Extended 3.1.3. Original Zentral reference: 1.1.0.

| File                   | Responsibility                                               |
| ---------------------- | ------------------------------------------------------------ |
| `ZentralTabDrag.uc.js` | Sort native tabs without selecting or waking their browsers. |
| `settings.json`        | Local settings/schema metadata                               |

Entrypoints and dependencies are declared in `loader/ZentralCatalog.js`. Load registration-only sources through the loader, and keep cleanup in the owning feature. Read the nearest parent README and `docs/BASE-PATCHES.md` before changing cross-owner behavior.


## Install only this feature (standalone, via Sine)

In Sine, install from this folder URL:

`https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/tabs/dragging`

Requirements: Sine 2.3+, and Sine's setting for JavaScript from unofficial sources (`sine.allow-unsafe-js`) enabled; without it Sine downloads the mod but never runs the script. Restart Zen after the first install. Sine pulls later updates from this repository (the `version` in this folder's `theme.json` is raised on every change). Settings appear in Sine's preferences for this mod.

Using the full pack instead? Paste the repository root URL. If both are installed, the full pack owns the feature and the standalone copy releases itself, so nothing is hooked twice. Both use the same preference keys, so settings carry over.

`ZentralTabDrag.standalone.uc.js`, `theme.json`, `preferences.json` and `standalone.lock.json` are **generated** by `node tools/build-standalone.cjs` from `ZentralTabDrag.uc.js`; edit the source and rebuild, never the generated files. Status: unit-tested with a simulated window only; not yet verified through a real Sine install (see `docs/SINE-MODULAR-INSTALL.md`, gates 6.1-6.6).
