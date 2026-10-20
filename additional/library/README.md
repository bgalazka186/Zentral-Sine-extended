# Make Library behave more like Zentral panel

`ZentralLibraryResize.uc.js` is an independent feature in the shared catalog.
It activates after the shared SessionStore/workspace/Zen startup barrier.
It does not import or replace native Library methods or change native preferences.

Advanced → Experimental → Library layout contains:

- **Make Library behave more like Zentral panel**: off by default,
  on in Recommended. Keeps Library's own animation, suppresses native content,
  toast and toolbox translation/fading.
- **Layout mode**: Resize webpage is the default mode and reserves space inside
  the tabbox. Recommended selects Overlay webpage, which leaves its width unchanged and covers it.
  The minimum width and animation controls apply only to Resize mode.
- **Minimum webpage width**: 0–1000 px; default and Recommended 200. On narrow
  windows, Library may overlap content rather than reduce it below this width.
- **Resize continuously during Library animation**: off in both presets.
  When off, reserve final Library width on opening and release it on closing.
  When on, follow its animated visible edge; heavy sites may do more layout.

Library sits beside the native sidebar when it is visible, on either side.
A hidden compact sidebar stays hidden; hover/popup visibility and sidebar width
changes update Library's inset. Width is limited to the remaining window space.
Only actual top control rows intersecting Library add top clearance. Whole
TabsToolbar/titlebar containers and unrelated webpage offsets do not add gaps.
Its bottom edge stays anchored. These positions are measured automatically.

While Library is open, clicking the webpage or pressing Escape closes it via
its existing public close method. Inside clicks, sidebar/toolbar controls and
popup menus remain usable, matching unpinned panel outside-click exemptions.
Input handlers are removed when Library closes or the feature is disabled.

Padding preserves the existing tabbox padding and independent Zentral panel
push margins. Side is taken from Zen's native sidebar-side attributes.
Disabling/unloading removes the owned stylesheet, root attributes, variables,
observers and scheduled frame, restoring native Library behavior.

The disabled feature retains only its preference subscription and settings hook.
There are no timers or polling loops. Enabled discovery watches shallow chrome
containers; animation watches only Library attributes. Border-box size changes
and resize events coalesce to at most one update per animation frame. The normal
mode ignores animation-only style changes. No website document is observed.

Version: 3.0.0. This needs visual testing in Zen, including left/right
sidebar, compact mode, opposite-side panels and narrow windows.
