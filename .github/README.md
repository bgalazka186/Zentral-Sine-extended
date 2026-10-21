<p align="center">
  <img src="../assets/Zentral%20Logo.svg" alt="Zentral Extended" width="180" />
</p>

<h1 align="center">Zentral Extended</h1>

<p align="center">
  More ways to use panels, tabs and video in Zen Browser.
</p>

<p align="center">
  <strong>Extended 3.0.1</strong> · Based on <strong>Zentral 1.1.0</strong> · Requires <strong>Sine</strong>
</p>

Zentral Extended builds on [Zentral by Michele501st](https://github.com/Michele501st/Zentral-Sine), adding flexible panel layouts, sidebar integrations, video previews and appearance controls.

Keep your everyday sites close, arrange panels around your browsing, and choose how much of the interface you want to see.

## Features

### Panels and layouts

- **Move and resize panels:** resize from multiple sides, save per-app placement, or reset a panel’s position.
- **Opposite-side docking:** keep launchers in the sidebar while opening panels on the other side of the window.
- **Dual View, Triple View and SuperPin:** push the webpage aside, link panels, or keep a separate movable second panel.
- **Panel autohide:** keep an app loaded and reveal its panel when needed, with adjustable activation area and delays.
- **Customizable pill controls:** choose the layout, hide individual buttons, adjust positioning and opacity, or use a small idle indicator.
- **Panel navigation:** back/forward, Reload/Stop, an editable URL/search bar, quick-switch search targets and saved start URLs.
- **Saved zoom and workspace placement:** remember panel zoom and choose where each app appears.
- **Startup choices:** preload selected apps or open a panel or linked Triple View. Smart Sleep delays automatic preloading without clearing your selections.
- **Audio controls:** optional notification and audio indicators, with quick mute controls.
- **Containers and mobile mode:** choose a Firefox Container or request a mobile version of a site. Site support varies.

### Tabs and sidebar

- **Panels on Essential tabs:** optional corner launchers, hover-only tiles and notification badges.
- **Open tabs as panels:** optional favicon launchers open a tab’s page inside a panel.
- **Drag without activating:** reorder background tabs, folders and split-view groups while keeping the current tab active.
- **Middle-click to unload:** unload a loaded normal tab instead of closing it. An already unloaded tab retains the normal close behavior.
- **Native-tab startup loading:** opt-in loading for Essential and pinned browser tabs, separate from panel preloading.
- **Sidebar density:** adjust row heights, spacing, Essentials sizing, icons and smaller controls.
- **Optional integrations:** additional behavior for Arc 2.0, Zen Library and RSS live folders.

### Sidebar video and Big Preview

The video preview was inspired by [Zenslop](https://github.com/Firebolt9907/Zenslop). Credit to them for the idea.

<p align="center">
  <img src="../assets/compacttabsandvideointerface.png" alt="Compact sidebar with video preview" />
</p>

- **Sidebar playback:** choose or pin a video source from tabs or panels, play/pause, mute, seek and resize the preview.
- **Big Preview:** double-click the video to enlarge it, drag it around, and resize from any edge or corner. Double-click again, use the Return control, or press Escape to return to the sidebar.
- **Click to play/pause:** click the enlarged video once to toggle playback. A short delay distinguishes a single click from a double-click.
- **Video proportions:** keep the video’s aspect ratio while resizing, or disable the lock. Size is remembered; remembering the position is optional.
- **Workspace clearance:** the default enlarged position leaves room for the sidebar’s workspace controls.
- **Hover controls:** playback controls and the progress bar appear over the bottom of the video.
- **Compact sidebar controls:** keep controls close together in one row, with adjustable spacing and an option to allow a second row.
- **Appearance integration:** buttons follow the selected palette, button style, borders and opacity. The enlarged hover overlay has a separate opacity setting.
- **Insta Peek:** hold **Alt+Q** to temporarily hide Big Preview and interact with what is underneath. It shares the configurable panel shortcut.
- **Subtitles:** mirror supported captions below the image or over the video, with adjustable text size, line count and overflow behavior. Captions below the image add their own space.
- **Capture choices:** native visual cloning where supported, video frames, streams, canvas streams and page snapshots.
- **Fallback controls:** configure automatic fallback and protection for video that is still visible on its source page.
- **Performance controls:** choose capture resolution and frame rate, and reduce or suspend work while the preview is hidden or its source is visible.

#### Big Preview keyboard controls

These shortcuts apply while Big Preview has focus.

| Key | Action |
| --- | --- |
| Space / K | Play or pause |
| M | Mute or unmute |
| F | Toggle preview fullscreen |
| J / L | Seek backward / forward 10 seconds |
| Left / Right | Seek backward / forward 5 seconds |
| Up / Down | Increase / decrease volume |
| 0–9 | Seek to 0–90% of the video |
| Home / End | Seek to the beginning / end |
| < / > | Decrease / increase playback speed |
| C | Toggle mirrored preview captions |
| I / Escape | Return to the sidebar |

Keyboard shortcuts and image-click playback can be disabled separately. Text fields, buttons and the seek slider retain their own keyboard behavior.

Big Preview is an in-browser player. Capture support, captions and playback commands can vary by site and Zen version. It is still being refined.

### Appearance

- **Starting styles:** Default, Paper, Transparent, Tide and Blueprint, with additional variants where available.
- **Simple and Detailed palettes:** start with a small set of linked colors or fine-tune individual surfaces and controls.
- **Automatic or manual text colors:** use automatic contrast or choose your own colors in Detailed mode.
- **Control styling:** adjust button styles, borders, corner radius, spacing and size.
- **Dynamic translucency:** separate opacity for unpinned, pinned-and-focused, and pinned-but-unfocused panels.
- **Settings interface:** choose between the Atelier and Classic settings appearance.

Transparent surfaces reveal changing content behind them. If controls become difficult to read, increase their backing opacity or choose filled buttons.

## Installation

**Sine is required.** Install Extended as one mod.

1. Open **Zen Settings → Sine Mods**.
2. Add this repository:

   ```text
   https://github.com/bgalazka186/Zentral-Sine-extended
   ```

3. Install Zentral Extended.
4. Restart Zen.

Disable the separate original Zentral mod when using Extended, because both provide the core Zentral functionality.

When applying a changed-files ZIP, replace matching files in the existing mod folder and restart Zen. Follow the package’s installation notes, since some archives depend on earlier updates.

## Settings

Settings are grouped by the feature they affect.

- **Panels:** placement, resizing, navigation and behavior.
- **Tabs and sidebar:** launchers, density and optional integrations.
- **Video:** capture methods, playback, captions and Big Preview.
- **Appearance:** palettes, button styling, spacing and transparency.
- **New Settings:** grouped copies of recently added controls.

A setting and its copy in **New Settings** edit the same preference.

For sidebar video layout, open **Appearance → Sidebar video** in Detailed mode. Big Preview behavior is grouped with the video settings.

### Recommended setup

The Recommended setup provides a portable starting point. It is an explicit preset; installing an update does not require resetting your existing preferences.

Back up your configuration before applying a preset if you want to preserve your current setup.

Recommended settings exclude personal app lists, account details, custom URLs and machine-specific file paths.

## Compatibility

Extended includes optional integrations for other sidebar and layout mods.

When another mod manages tab grouping, disable Zentral’s overlapping grouping behavior. Enable individual compatibility options only when their corresponding integration is needed.

Compatibility depends on the versions and configuration of the installed mods. Avoid enabling multiple features that manage the same layout or interaction.

## Updates and architecture

Extended 3.0.1 uses Zentral 1.1.0 as its core reference.

Original-derived code, Extended integrations and independent features are kept in separate areas:

| Location | Purpose |
| --- | --- |
| `loader/` | Loading, lifecycle management and shared runtime services |
| `zentral/` | Original-derived Apps and Groups implementation |
| `extension/` | Zentral-dependent enhancements and settings |
| `additional/` | Independent features, including video and optional integrations |
| `zentral/upstream/1.1.0/` | Preserved upstream reference |
| `patches/` | Recorded changes from the upstream reference |

The preserved upstream snapshot is a reference and is not loaded as another copy of the mod.

Optional features are designed to fail independently. Missing files or initialization failures should be reported without taking down unrelated functionality.

For development and update notes, see:

- [Architecture](../ARCHITECTURE.md)
- [Base modifications](../docs/BASE-PATCHES.md)
- [Updating upstream](../docs/UPDATING-UPSTREAM.md)
- [Sidebar, player input and appearance notes](../docs/SIDEBAR-AND-PLAYER-INPUT.md)

## Reporting problems

Please include:

- Your Zen and Zentral Extended versions.
- The steps needed to reproduce the problem.
- Whether it happens in a fresh profile.
- Relevant appearance, video or compatibility settings.
- Any related errors from the Browser Console.

For sidebar resizing problems, mention whether the sidebar is on the left or right and whether Compact Mode is enabled.

For video problems, mention the site, capture method and whether the problem affects sidebar playback, Big Preview or both.

Remove personal URLs, account details and other private information before sharing logs or configuration files.

## Credits

- [Michele501st](https://github.com/Michele501st) for [Zentral](https://github.com/Michele501st/Zentral-Sine).
- [Zenslop](https://github.com/Firebolt9907/Zenslop) for the sidebar video preview inspiration.
- The Zen Browser and Sine projects.
- Everyone testing Extended and reporting problems.

See [LICENSE](../LICENSE) for licensing information.
