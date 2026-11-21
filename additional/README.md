# Features independent of Zentral Apps/Groups

The shared loader can activate these while Apps/Groups are unavailable or disabled. They use their own native browser requirements and settings. They do not start another Zentral instance.

| Part           | Purpose                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `video/`       | Sidebar video preview, capture/transport, source selection, subtitle presentation and playback UI. |
| `notes/`       | Quick notes sheet (Markdown files), bar button and shortcut.                                       |
| `folders/`     | Native Zen folder palettes, per-folder colors and saved themes; yields to Notes-owned folders.       |
| `rss/`         | Native/live-folder display improvements.                                                           |
| `tabs/`        | Startup loading, background sorting, middle-click unloading and optional compact hover continuity. |
| `library/`     | Optional native Library geometry; external-layout compatibility can pause it.                      |
| `diagnostics/` | Logging and diagnostic export.                                                                     |
| `boost/`       | On-demand memory tools and the Boost-owned sidebar tile.                                           |
| `widgets/`     | Generic sidebar widget tray with free-area measurement and independent widget scheduling.           |
| `theme/`       | Light/dark policy and readable tooltips/control colors; no Zentral base imports.                   |

“Independent” means independent of the Apps/Groups base, not that every file is a standalone Sine script. Keep a feature's controllers, styles and metadata together and use its documented entrypoint. Video also retains its existing specialized standalone loader path. Source failures are isolated by the shared runtime; a missing base feature must not block this tree.

## Standalone install through Sine

Modules with a `standalone.json` can be installed on their own by pasting their folder URL into Sine. The full pack takes precedence over a standalone copy of the same feature. Boost and Widgets may also be installed together: the Boost tile is Boost-owned, and the generic Widgets tray accounts for in-flow sidebar siblings without a cross-module hand-off. Generated files are produced by `node tools/build-standalone.cjs` (development tooling kept in the local working copy).

| Module | Sine install URL |
| --- | --- |
| Zentral Sidebar Video Preview | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/video` |
| Zentral Notes | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/notes` |
| Zentral Colorful Folders | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/folders` |
| Zentral Logger | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/diagnostics` |
| Zentral Memory Boost | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/boost` |
| Zentral Sidebar Widgets | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/widgets` |
| Zentral Library Resize | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/library` |
| Zentral RSS Display | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/rss` |
| Zentral Compact Sidebar Hover | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/tabs/compact-hover` |
| Zentral Background Tab Drag | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/tabs/dragging` |
| Zentral Load Tab at Startup | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/tabs/startup` |
| Zentral Tab Unload | `https://github.com/bgalazka186/Zentral-Sine-extended/tree/main/additional/tabs/unloading` |

Full-pack only (not standalone-capable): `theme/` (a service consumed by panels and settings; it needs the module loader).
