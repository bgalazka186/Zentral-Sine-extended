# Twilight 1.25t readiness audit (OW-126)

Owner supplied the Twilight `1.25t` release-notes link. The current release
notes page says:

- **Little Zen**: a smaller/simpler Zen window for quick lookups and links,
  openable by a keyboard shortcut from any app even while Zen is unfocused,
  with an option for links from other apps to open in it.
- **Zen now has its own settings window** instead of Firefox's preferences page.

The GitHub repository currently has **no `1.25t` tag or release** (`gh api`
returned 404), so this is a readiness audit against the release-notes text and
the current Zentral source, not a claim about a shipped Twilight build.

## Settings-window assumptions

- Zentral already owns an in-chrome settings UI under `extension/settings/`
  (`ZentralSettingsShell.js`, `ZentralFeatureSettings.js`,
  `ZentralSettingsRows.js`, `layout.json`, `extension-settings.json`).
  `ZentralDeveloperSettings.js` has a “Feature settings” button that opens that
  UI; it does not open `about:preferences`.
- `ZentralNativeBrowserSettings.js` reads/writes selected native browser
  preferences, but its rows are Zentral-owned; it does not require Firefox's
  preferences page to be present.
- A repository-wide grep of `additional`, `extension`, `loader` and `zentral`
  found **no** `about:preferences`, `preferences.xhtml` or Firefox preferences
  window opener in runtime source. Per-feature `settings.json` files are
  metadata only.
- Therefore Zen moving to its own settings window does not, from static source,
  break Zentral's own settings shell. Live check: open Zentral settings from the
  new Zen settings window and from the mod's own triggers; confirm catalog,
  search, presets, backups and native-browser rows still render.

## Little Zen / window assumptions

- Zentral enumerates browser windows with
  `Services.wm.getEnumerator("navigator:browser")` in Notes, video scheduling
  and the stand-alone Notes bundle, and uses
  `Services.focus.activeWindow || Services.wm.getMostRecentWindow("navigator:browser")`
  for a focused-window fallback.
- Core startup is catalog/runtime driven and does not assume exactly one
  `navigator:browser` window; catalog parts activate per window through their
  lifecycle scopes. However, if Twilight's Little Zen uses the same
  `navigator:browser` window type with a reduced toolbox/sidebar, Zentral could
  try to draw widgets, panels or Notes projections into a window that has no
  room for them.
- Conversely, if Little Zen uses a **different** window type, the current
  enumerators will simply ignore it. Whether links from other apps should open
  Zentral panels in Little Zen is an owner product decision, not a static fix.
- The mod has no hard-coded global keyboard shortcut for its own settings, so
  Twilight's global Little Zen shortcut does not collide with a known Zentral
  shortcut. Live check: trigger Little Zen while Zen is unfocused and with a
  link from another app; confirm no Zentral panel/widget is duplicated or
  stretched.

## Actions / OWNER GATE

No code change is made from the release-notes text alone: the exact Little Zen
window type, DOM, toolbox, sidebar and settings entry points are not available
in a tagged build. Once a Twilight build is installed, the owner should provide
only targeted facts (not a full dump):

1. `document.documentElement.getAttribute("windowtype")` and whether
   `#navigator-toolbox`, `#tabbrowser-tabs` and `#zen-sidebar` (or equivalent)
   exist in Little Zen;
2. which Zentral catalog parts initialize there;
3. whether the new Zen settings window can open Zentral's own settings shell;
4. whether links from other apps open in Little Zen by preference.

If Little Zen reuses `navigator:browser` but lacks the Zentral hosts, a narrow
window-capability guard can then be written with a RED/GREEN test. Until then,
implementing such a guard would be a guess.
