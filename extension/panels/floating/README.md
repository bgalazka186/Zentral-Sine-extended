# Floating panel extension

Extended 3.1.3; original Zentral reference 1.1.0. `ZentralPanelEnhancements.js` is the single geometry owner while Hybrid is selected. It uses base B001/B003/B004 and the compatibility bridge; Classic delegates to the original Extended engine.

- Docked hosts fill available height. Pushing hosts use the viewport edge/full height. Detached hosts keep their own rectangle; a move away from a dock shrinks to the selected height percentage and docking restores full height.
- The native/default side is supplied by the coordinator independently of a saved app's explicit side. The extension alone stores `customSide:true`; upstream math does not own that metadata. Hold Expand docks on the opposite side and makes it that app's default.
- Physical handle bounds determine resize direction once per gesture. Width drags use one calculation path even when all-sides handles are off. Pointer cancellation, blur, workspace changes and teardown release owned capture/shields/preview.
- Move/Resize is one button. The Hold Expand to attach/detach through the existing docking owner; there are no Mobile or Save pill shortcuts. Existing right-click UA switching is reused. Save remains on both URL bars; secondary Close is last. The primary URL bar has no Close button.
- The pill grabber previews vertical pill position while its horizontal delta resizes. Commit saves the pill preference; cancel does not. The mini pill scales toward its panel-facing edge, with an inset accessible fallback near screen limits.
- Effective page push is suppressed while detached without changing the saved choice. Its incompatibility X/reason is presentation only. Triple View retains its own push setting; Super Pin has an independent host.

`ZentralPillActions.js` owns close/unload and expand/side holds, control ordering and the optional B015 launcher placement policy. It never creates browser hosts or stores a second app list. The optional policy keeps launchers in the native sidebar by default and lets users restore the old compact-mode top-toolbar fallback.

Normal URL updates go through B002; Essential/tab-linked and secondary saves create independent normal app records. Container, mobile identity and unload operations remain with their existing owners. All timers/listeners are scoped to the feature lifecycle. With overflow disabled, attachment tests the unclamped proposed panel edge, including panel width and cursor grab offset. Push it 15 px past a safe boundary (configurable with `dock_push_px`) to commit an attachment; simply reaching the boundary stays floating. The old pointer-distance `snap_threshold` preference is inactive. With partial overflow enabled, the same distance is a magnetic zone around the normal safe edge; move farther past it to retain partial overflow.

See `docs/REPAIR-HANDOFF-3.0.0.md` for detailed behavior, validation and remaining live-browser limits.

Docking is shared by all registered primary hosts (normal apps, Essential/tab-linked and native-backed apps) and independent Super Pin hosts. Triple View's lower toolbar grip resolves to the combined primary host. All hosts use panel-edge penetration and shrink to the detached height percentage when moved away from a dock. Triple View does not own a separate docking algorithm.

Overflow docking uses the panel edge near the normal safe boundary, not the extended off-window clamp boundary. No extra push is required in this mode. Moving beyond the snap zone leaves the panel floating partly outside; the 15 px penetration policy remains for bounded panels. Both policies use the same host/gesture owner across panel types.
