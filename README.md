<p align="center">
  <img src="assets/Zentral%20Logo.png" alt="Zentral Extended" width="140" height="140" />
</p>

<h1 align="center">Zentral Extended</h1>

<p align="center">
  <b>Web apps, floating panels, sidebar video and extra tweaks for Zen Browser.</b>
</p>

<p align="center">
  <a href="theme.json"><img src="https://img.shields.io/badge/Extended-v3.0.1-4A72FF.svg?style=flat-square" alt="Extended 3.0.1" /></a>
  <a href="https://github.com/Michele501st/Zentral-Sine"><img src="https://img.shields.io/badge/Zentral_Core-v1.1.0-9B51E0.svg?style=flat-square" alt="Zentral core 1.1.0" /></a>
  <a href="https://github.com/CosmoCreeper/Sine"><img src="https://img.shields.io/badge/Requires-Sine-00C853.svg?style=flat-square" alt="Requires Sine" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-CC_BY--NC--SA_4.0-FF9800.svg?style=flat-square" alt="License: CC BY-NC-SA 4.0" /></a>
</p>

<p align="center">
  <a href="#installation">Installation</a> ·
  <a href="#extra-features">Extra features</a> ·
  <a href="#settings">Settings</a> ·
  <a href="#compatibility">Compatibility</a>
</p>

This is my personal, heavily AI-assisted extended version of **[Zentral by Michele501st](https://github.com/Michele501st/Zentral-Sine)**. It started with a few tweaks and grew into the collection of things I wanted in my own setup. If you do not need the extras below, I recommend trying the original Zentral first.

Extended keeps Zentral's app launchers, web panels and optional tab groups, then adds more ways to arrange panels, control their behavior and customize the sidebar. The current version is **Extended 3.0.1**, based on **Zentral 1.1.0**.

<p align="center">
  <img src="assets/panelsinterface.png" alt="Zentral Extended panels and sidebar layout" />
</p>

## Extra features

Most features are configurable in **Zentral Settings**. Experimental options are marked separately, so you can keep the parts you want and leave the rest off.

### Panels, layout and navigation

- **Move, resize and dock panels:** drag panels in two dimensions, resize from multiple sides, save per-app placement, or reset a panel's position. Still no 3D, sorry.
- **Opposite-side docking:** keep launchers in the sidebar while opening panels on the other side of the window. Edge attachment, snapping, detachable panels and optional partial overflow give you more layout choices.
- **Dual View, Triple View and SuperPin:** push the webpage aside, link two panels, or keep a separate movable second panel. Triple View has its own divider, swap controls and webpage-push option.
- **Panel autohide:** keep an app loaded and reveal its panel when needed. Reveal delay, activation area and hide delay are adjustable.
- **Customizable pill controls:** choose the pill layout, hide individual buttons, adjust its position and opacity, or use a small idle indicator.
- **Navigation inside panels:** back/forward, Reload/Stop, an editable URL/search bar, quick-switch search targets and saved start URLs. Place the toolbar at the top or bottom, or show it on hover.
- **Saved zoom and workspace placement:** keep panel zoom between sessions and choose where each app appears.
- **Startup choices:** load selected apps in the background, or open a panel or linked Triple View with Autohide. Smart Sleep delays automatic preloading without clearing your selections.
- **Audio controls:** optional notification/audio indicators and quick mute controls.
- **Containers and mobile mode:** choose a Firefox Container or switch a panel's user agent to mobile. Mobile mode depends on the site. Clearing a panel site's cookies and cache can also affect other pages using that site in the same container.

### Tabs and sidebar

- **Panels on Essential tabs:** optional corner launchers, hover-only tiles and notification badges. I recommend arranging your panels to match your Essentials before enabling this.
- **Open tabs as panels:** optional favicon launchers open a tab's page in a panel.
- **Drag without activating tabs:** reorder background tabs, folders and split-view groups while keeping the current tab active and sleeping tabs asleep.
- **Middle-click to unload:** unload a loaded normal tab instead of closing it; an already unloaded tab keeps the normal close behavior.
- **Native-tab startup loading:** a separate, opt-in startup choice for Essential and pinned browser tabs, independent of panel preloading.
- **Sidebar density:** adjust row heights, spacing, Essentials sizing, icons and smaller controls. Optional appearance tweaks cover Arc 2.0, Zen Library and RSS live folders.

### Sidebar video and Big Preview

The video preview was inspired by **[Zenslop](https://github.com/Firebolt9907/Zenslop)**. Credit to them for the idea.

- **Sidebar playback:** choose or pin a video source from tabs or panels, play/pause, mute, seek, resize the preview or use a compact card.
- **Big Preview:** double-click the video to enlarge it, drag it around and resize from any edge or corner. Double-click again, use Return, or press Escape to go back. Fullscreen is available too.
- **Playback input:** click the image once to play/pause. With Big Preview focused, use Space/K, M, F, J/L and the arrow keys for playback, mute, fullscreen, seeking and volume. Double-click still returns to the sidebar. Keyboard and image-click controls can be disabled separately.
- **Video proportions:** keep the video's aspect ratio while resizing, or turn the lock off. Size is remembered; position remembering is optional. By default, the player opens at the sidebar's bottom corner with room for workspace buttons.
- **Hover controls:** playback controls and the progress bar appear over the bottom of the video. Buttons follow your Appearance palette, style, borders and opacity; the hover overlay has its own opacity setting. Automatic contrast chooses readable icon colors for the selected surfaces.
- **Insta Peek:** hold **Alt+Q** to temporarily hide the enlarged player and interact with what is underneath. It shares the existing configurable panel shortcut.
- **Subtitles:** mirror supported captions below the image or as an overlay, with adjustable text size, line count and overflow behavior. A subtitle band below the image adds its own space.
- **Capture choices:** native visual cloning where supported, video frames, streams, canvas streams and page snapshots. Automatic fallback and source-page protection are configurable.
- **Performance controls:** choose capture resolution and frame rate, and reduce or suspend work while the preview is hidden or its source is visible.

Big Preview is an in-browser player. Capture support, captions and input behavior can vary by site and Zen version; this part of the mod is still being refined.

<p align="center">
  <img src="assets/compacttabsandvideointerface.png" alt="Compact sidebar with video preview" />
</p>

### Appearance

- **Starting styles:** Default, Paper, Transparent, Tide and Blueprint, with additional variants where available.
- **Simple and Detailed palettes:** start with a palette, then fine-tune individual surfaces and controls. Layout and density stay separate from the theme.
- **Dynamic translucency:** separate opacity for unpinned, pinned-and-focused, and pinned-but-unfocused panels, with optional backing for readability.
- **Control styling:** adjust colors, borders, corner radius, spacing and the Atelier or Classic settings interface.

## Installation

**Sine is required.** Install Extended as one mod; do not enable the separate original Zentral alongside it.

1. Open **Zen Settings → Sine Mods**.
2. Add this repository:

   ```text
   https://github.com/bgalazka186/Zentral-Sine-extended
   ```

3. Install the mod and restart Zen.
4. Open **Zentral Settings** with **Ctrl+Alt+=**.

For a manual installation, place the complete repository in `chrome/sine-mods/zentral/` inside your Zen profile and enable it through Sine. `theme.json` should be directly inside that folder. Sine should register only `loader/Zentral.uc.js`.

Back up your existing mod folder before replacing files manually. A changed-files ZIP is an update to an existing installation, not a complete installation; follow the instructions supplied with that ZIP.

## Settings

Start with the features you need, then adjust their own sections. **New settings · 3.0+** groups copies of recently added settings; these change the same preferences as the controls in their usual sections.

- **Restore defaults** provides the general starting configuration, including automatic video fallback and periodic source discovery.
- **Apply recommended settings** applies my preferred portable setup, including appearance and more selective video settings. It is a personal preset, so it may not suit every setup.
- **Import/export** lets you save the appearance separately or back up all supported mod settings. Presets preserve saved apps, groups and panel assignments.
- **Native Browser Settings** exposes selected existing Zen/Firefox preferences. These change only when you edit them and have their own reset buttons. Mod presets and backups exclude them; uninstalling Zentral does not undo changes you make there.
- **Optional modules and diagnostics** are available in the developer settings for troubleshooting.

Restart Zen after changing module or behavior settings that request it.

### Useful controls

| Control                     | Action                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| **Ctrl+Alt+=**              | Open Zentral Settings, or bootstrap diagnostics if startup is unavailable.                     |
| Hold **Alt+Q**              | Temporarily hide open panels and Big Preview to interact underneath; configurable in settings. |
| Double-click the video      | Enlarge the preview or return it to the sidebar.                                               |
| **Escape** in Big Preview   | Exit preview fullscreen first, then return to the sidebar.                                     |
| Right-click an app launcher | Configure its app, workspace placement and available panel options.                            |
| **Alt+L**                   | Export a diagnostic log when the logger is enabled.                                            |

## Compatibility

I recommend and use **[Tab Groups by oom333](https://github.com/oom333/zen-tab-groups)** with Zentral Groups disabled. Zentral's own groups remain available if you prefer them.

The **external Tab Groups** and **external Library layout** switches are optional ways to pause conflicting Zentral behavior. You do not need them when the corresponding Zentral feature is already disabled.

Other mods I use include Arc 2.0, Better CtrlTab, Customize Font Size, Transparent Zen, Zen Folder Tree Connectors and ZenLibraryTweaks. This is my configuration list, not a guarantee that every version or combination works together.

Add-on integration options include real tab IDs for panels and an experimental Zen Internet CSS workaround. Favicon actions, Library geometry and similar features can overlap with other mods, so enable those options as needed.

### Experimental options

Advanced settings include outside-window panel reveal, compact-sidebar hover stabilization, reveal on cursor return, a temporary startup sidebar layout refresh and optional Library behavior. These depend more closely on browser internals and may need adjusting after a Zen update. They can be disabled independently.

## Issues and ideas

This fork follows what I want for my own setup, but suggestions and contributions are welcome. If a feature belongs specifically to Extended, open an issue here and I will see what I can do.

**Please report problems with this fork in [this repository's Issues](https://github.com/bgalazka186/Zentral-Sine-extended/issues), not in the original Zentral repository.** Include your Zen and Sine versions, the feature or setting involved, and steps to reproduce it. Check diagnostic logs for personal information before sharing them.

## For contributors

Extended separates its adapted Zentral base from the extra features so future upstream updates are easier to review.

| Folder                        | Purpose                                                             |
| ----------------------------- | ------------------------------------------------------------------- |
| `loader/`                     | Bootstrap, module lifecycle and shared services.                    |
| `zentral/`                    | Adapted Apps/Groups base and the retained original 1.1.0 reference. |
| `extension/`                  | Extended panels, navigation, appearance and settings.               |
| `additional/`                 | Video, tab tools, Library behavior, RSS and diagnostics.            |
| `docs/`, `patches/`, `tools/` | Architecture notes, upstream comparisons and maintenance tools.     |

See the [upstream update guide](docs/UPDATING-UPSTREAM.md), [base change ledger](docs/BASE-PATCHES.md) and [documentation index](docs/README.md) before changing shared behavior. The retained [original Zentral README](zentral/upstream/1.1.0/README.md) documents the upstream project. Recent implementation and repair notes live in `docs/`.

## Credits and license

**Zentral was created by [Michele501st](https://github.com/Michele501st).** This is an independent fork; credit for the original code, branding and foundation belongs to its original author. If you enjoy Zentral, please consider [supporting Michele501st on Ko-fi](https://ko-fi.com/michele501st).

Thanks also to **[Zenslop](https://github.com/Firebolt9907/Zenslop)** for the sidebar video inspiration.

Licensed under **[Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](LICENSE)**. Please preserve attribution, use it noncommercially and share adaptations under the same license.
