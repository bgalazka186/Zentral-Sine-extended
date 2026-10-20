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
