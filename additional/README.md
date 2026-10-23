# Features independent of Zentral Apps/Groups

The shared loader can activate these while Apps/Groups are unavailable or disabled. They use their own native browser requirements and settings. They do not start another Zentral instance.

| Part           | Purpose                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `video/`       | Sidebar video preview, capture/transport, source selection, subtitle presentation and playback UI. |
| `rss/`         | Native/live-folder display improvements.                                                           |
| `tabs/`        | Startup loading, background sorting, middle-click unloading and optional compact hover continuity. |
| `library/`     | Optional native Library geometry; external-layout compatibility can pause it.                      |
| `diagnostics/` | Logging and diagnostic export.                                                                     |
| `theme/`       | Light/dark policy and readable tooltips/control colors; no Zentral base imports.                   |

“Independent” means independent of the Apps/Groups base, not that every file is a standalone Sine script. Keep a feature's controllers, styles and metadata together and use its documented entrypoint. Video also retains its existing specialized standalone loader path. Source failures are isolated by the shared runtime; a missing base feature must not block this tree.

## Standalone install through Sine

Modules with a `standalone.json` can be installed on their own by pasting their folder URL into Sine. The full pack always takes precedence if both are installed. Generated files are produced by `node tools/build-standalone.cjs`; see `docs/SINE-MODULAR-INSTALL.md`.

| Module | Sine install URL |
| --- | --- |
| Zentral Logger | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/diagnostics` |
| Zentral Library Resize | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/library` |
| Zentral RSS Display | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/rss` |
| Zentral Compact Sidebar Hover | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/tabs/compact-hover` |
| Zentral Background Tab Drag | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/tabs/dragging` |
| Zentral Load Tab at Startup | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/tabs/startup` |
| Zentral Tab Unload | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/tabs/unloading` |

Full-pack only (not standalone-capable): `theme/` (service consumed by panels and settings, needs the module loader) and `video/` (about 14 files and content frames loaded through the module loader).
