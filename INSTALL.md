# Installing Zentral Extended 3.0.0 — complete package

Original Zentral reference: **1.1.0**. This archive contains the complete current mod, including all delivered fixes, the updated enlarged-video controls, overflow docking, recommendation wording and documentation. Earlier patch ZIPs are not required.

1. Close Zen completely.
2. Back up your existing `chrome/sine-mods/zentral/` folder outside `sine-mods`.
3. Replace it with this ZIP's `zentral/` folder, so `theme.json` is at `chrome/sine-mods/zentral/theme.json`.
4. Start Zen. Sine must load only `loader/Zentral.uc.js`; refresh its mod metadata if it has an older cached script path. Do not enable the separate original Zentral.

Existing profile preferences remain in place; no prefs.js or other mods are included or overwritten. Extended Settings opens with Ctrl+Alt+=. Look for **New settings · 3.0+** and **Video subtitles**.

Double-click the video image to enlarge it. Drag anywhere on the video to move it, and resize any edge/corner. Size and position are remembered; the default video area is 1280×720, scaled to fit, at the bottom corner on the sidebar side. Return and Fullscreen are in the bottom bar; there is no top bar. Double-click again or press Escape to return (Escape first exits preview fullscreen).

With partial overflow enabled, panels snap near the normal safe edge; move farther past that zone to leave them partly outside. With overflow disabled, docking requires the configured push distance, 15 px by default.

The Mobile UA pill shortcut is intentionally excluded. Use the existing RMB action. See `docs/REQUEST-AUDIT.md` for the request inventory, remaining architectural work and live-testing limits. Internal tests, logs and changelogs are excluded from this package.
