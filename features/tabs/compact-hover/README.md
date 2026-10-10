# Experimental compact sidebar hover

Enable **Zentral Settings → Advanced → Experimental → Stabilize compact tab sidebar hover (experimental)**. Default: off; changes apply live.

The guard prevents delayed native hover-removal callbacks from hiding an already hovered native tab sidebar while the pointer remains inside its visible bounds. Leaving the window from the sidebar preserves hover for up to 1500 ms, avoiding the close/reopen animation on quick returns. Native outside-tracker exit, window deactivation, resizing, compact-mode changes and drag start end protection. Longer absences can still hide normally.

This is independent of Zentral web panels. It does not register a mouse tracker, change CSS, suppress events, or pin the sidebar open. It only guards removal of the native `zen-has-hover` attribute. Missing native manager APIs leave this module unavailable. Disable the toggle to restore native behavior; module teardown restores method descriptors where still owned.

Manual validation in Zen: enable compact hide-tabs and this toggle; reveal the sidebar, leave the window and return within 1.5 seconds; move between tab/sidebar controls; move into page content; leave for longer; deactivate/minimize; switch compact mode; repeat with right-side tabs and with Zentral panel outside-window tracking enabled. Confirm context menus, dragging, toolbar hover and toggle-off behavior remain native.

Performance update: the main settings panel now has a live checkbox. Pointer handlers detach when disabled. Preference values are cached, geometry reads use Zen's non-flushing API when available and run at most once per animation frame. Returning to page content cancels the window-exit grace timer and uses the sidebar keep-hover delay. Live Zen performance has not been measured.

## Edge guard settings

Advanced → Experimental contains live sliders for edge tolerance (0–64 px, default 12) and exit grace (0–2000 ms, default 250). Defaults retain the existing behavior. Zen's sidebar keep-hover duration remains a minimum delay. Slider changes apply to the next hit-test or exit without resetting an active grace timer. Saved visible bounds are reused during the exit grace period. Native hover enablement, hide-tabbar and keep-hover duration changes are now observed. Pointer handlers still make no preference reads.
