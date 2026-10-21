# Experimental compact sidebar behavior

This catalog owner currently contains three independent behaviors:

| Behavior                             | Owner / preference                                                                       | Dependencies                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Extra sidebar edge tolerance (opt-in) | `attachStabilizer`; `zen.workspace.zentral.experimental.compact_sidebar_hover`           | Native compact sidebar hover                                               |
| Optional reveal on window entry      | `attachEntry`; the above prefix + `.window_entry_reveal`                                 | Native compact sidebar hover; does **not** require stabilization           |
| Startup sidebar layout recalculation | `start` / `syncRepair`; `zen.workspace.zentral.experimental.sidebar_startup_recalculate` | Its own setting; does **not** require stabilization or window-entry reveal |

Panel entry reveal is owned separately by `extension/panels/interaction/ZentralPanelHover.js`. It requires window-entry reveal, its `.panels` preference, and Autohide Panels. It does **not** require stabilization. The `.panels.only_when_not_pushing` restriction pauses enhancement while the effective `bgalazka-push-page` state is true, including Triple View; ordinary panel autohide remains available.

## Extra sidebar edge tolerance (opt-in)

**Keep compact tab sidebar open near its edge (experimental)** defaults to off. Zen 1.23.4b fixed the original native "sidebar hides while the mouse is still over it" bug (upstream gh-15995 / PR #16001), so this switch is no longer a workaround for that bug. It is an opt-in extra-tolerance layer over native behaviour: edge tolerance (0–64 px, default 12) protects an already visible sidebar, without enlarging the hidden reveal area, and exit grace (0–2000 ms, default 250) is bounded by Zen's keep-hover delay. Native tracker cleanup, deactivation, resizing and drag start release still apply. A side-window exit has a bounded 1500 ms grace.

Disabling this feature restores exact owned method descriptors and removes its listeners/timers. A newer third-party wrapper is preserved; any old Zentral wrapper captured by it becomes inert. The saved sliders and independent entry choices are retained. Disabling it must never disable entry reveal or startup recalculation.

### Zen 1.23.4b baseline

Zen 1.23.4b (BuildID 20261020090730, SourceStamp 541ee55) contains `zen-browser/desktop` PR #16001 / commit `b20e548` "gh-15995: Fix compact sidebar collapsing during hover", in `src/zen/compact-mode/ZenCompactMode.mjs`. It changes three things in the native hover flow:

1. `onEnter` now always calls `this.clearFlashTimeout("has-hover" + target.id)` **before** the "already expanded" early return.
2. the `pendingEnter` callback bails on `!isHovering` for any event type.
3. the deferred `onLeave` collapse bails when `isHovering || target.matches(":hover")`.

Native now handles "pointer still over the sidebar" itself and adds its own keep-hover duration and (Windows/macOS) outside-window tracking. This feature's remaining value over native is edge tolerance, exit grace and the 1500 ms window-exit grace.

## Window-entry reveal

**Reveal Compact Tab Sidebar on Window Entry (Experimental)** is independently off by default. A trusted boundary entry can arrive as root `mouseenter` or a window `mouseover` targeting a chrome child with no related target. The reported crossing must be within 10 px of the docked edge and within sidebar height, excluding top/bottom edges. Native drag, URL-bar and hover suppression remain respected.

A recent matching side exit may identify a return landing deeper in the same window half, for up to 1500 ms. This evidence is consumed on return; ordinary in-window movement never reveals a hidden sidebar. Entry has its own 250 ms bounded hold. A timeout rechecks the pointer position before releasing a reveal owned by this feature. Disabling the entry toggle cancels this work independently of stabilization.

## Startup and recovery

Core waits for browser/session/workspace/Zen startup barriers before activation. This feature retains specialized layout and hover reconciliation; it must not install its own top-level bootstrap or await core startup from `init`.

Native manager creation, capability initialization, manager replacement and same-object method replacement can happen after activation. Five bounded probes cover roughly the first 6.2 seconds. After that there is **no periodic readiness timer**. Native layout/lifecycle events still reconcile. When stabilization is enabled but native prerequisites are unavailable, a temporary pointer listener checks only native readiness; it performs no geometry reads, allocations, preference reads or timer scheduling while those prerequisites remain missing. Once readiness is detected, one coalesced task attaches the guard and primes the current pointer position. The temporary listener detaches once the guard is configured. The healthy guard's own movement listener detects manager or hook replacement.

This closes the case where a saved enabled setting appeared inactive until toggled off/on after late native initialization. Readiness recovery is removed on disable and teardown. Native hover visibility attributes are deliberately excluded from the outer layout observer, so hide/reveal cannot reset itself in a loop.

## Performance and ownership

No permanent polling, global mouse-tracker service or document subtree observer is added. Healthy pointer movement does not schedule readiness tasks. Sidebar geometry is cached once per animation frame and uses Zen's non-flushing API when available. Return protection updates stored coordinates rather than allocating per movement. Preference observers filter exact settings: panel-only choices and sliders must not restart active sidebar grace.

`attachStabilizer` owns native method wrappers and stabilization state. `attachEntry` owns entry-specific reveal state. `start` owns combined readiness events/probes and the independent startup layout repair. Do not move the workaround into core: core owns generic scheduling/lifecycle, while this adapter owns Zen-specific behavior.

## Retiring/restoring edge tolerance safely

Keep this feature in this patch. An upstream fix should first be tested with it **off**, while keeping entry reveal and startup recalculation independently selectable. Do not automatically disable it based only on a Zen version number; validate cold startup, fast edge crossings, page-content exit, both sidebar sides, compact-mode changes, sleep/wake and third-party themes. Check that off means native methods are unchanged.

Zen 1.23.4b already fixes the native collapse-while-hovering bug, so the remaining choice is product-level: keep this as an opt-in edge-tolerance feature or retire it entirely. The retirement procedure below still applies.

When it is confirmed unnecessary:

1. In a reversible commit, remove `attachStabilizer` and its `PREF`/`MARGIN_PREF`/`GRACE_PREF`-only constants, callbacks and guard branch in `attach`. Keep `attachEntry`, `ENTRY_PREF`, `REPAIR_PREF`, and `syncRepair` intact. Remove guard-only metadata (`guardOn`, `guardAwaitingNative`, hook-current checks and guard priming) together with their callers. Do not delete the entire `compact-hover` source or its catalog row.
2. Remove `syncReadinessMovement`, `onReadinessMovement` and their subscriptions because they exist only for stabilization. Make combined watching depend on the remaining entry feature, while leaving startup repair independent. Shared native layout events/probes may still be needed by entry reveal; remove shared infrastructure only after checking all remaining users. Master-off and unload must leave no guard hooks, observers, tasks or attributes.
3. Remove only the stabilization toggle and its two sliders from `ZentralFeatureSettings.js`, `compact-hover/settings.json`, `extension/settings/layout.json` and defaults/schema entries where present. Keep entry/panel preferences, including their historical `compact_sidebar_hover` prefix: a shared prefix does not imply a behavioral dependency. The panel code must continue checking the explicit entry/panel switches, never the retired guard master.
4. Leave existing saved user-pref values alone; retired keys are inert. Do not migrate/reset entry choices or substitute a native hover preference. Keep catalog/settings ownership for remaining behaviors. Update this file and tests together, and verify the delivered patch removes retired behavior from earlier installed versions.
5. Test guard-off/native descriptor identity; entry-only sidebar and panel reveal; startup-repair-only; both remaining features off; partial optional installations; cold startup, restart, second window and sleep/wake. Core/catalog dependency tests must still pass. The source is required while any remaining behavior uses it.

To restore some or all of the workaround later, restore the feature adapter and matching UI/default/schema entries from that reversible commit, retaining the same preference keys so saved choices survive. Recheck the **current** native method contracts first. Prefer an independent optional feature/adapter using the core `lifecycle.watchNative` contract for a future extraction; migrate atomically with callers and settings, not by adding a second initializer alongside this one. Restore only the behavior still needed, with exact descriptor ownership and inert retained wrappers. Never restore old core boot code or make entry reveal depend on stabilization again.

## Validation

Development tests cover late manager/capability arrival beyond the startup probe window, same-object hooks and manager replacement, third-party wrappers, disabling during readiness, pointer priming, no readiness timers on healthy movement, and independent entry-only operation. The broader suites cover settings sliders, panels, native suppression, startup loading and core lifecycle cleanup. Mocks cannot establish live Gecko event delivery or actual sleep/wake compositor behavior; perform the live checks above before deciding the native fix makes this workaround redundant.

## Native attachment recovery

Transient native-hook attachment errors are contained inside reconciliation instead of permanently failing feature initialization. Partial guard/entry attachment is rolled back atomically. Existing bounded startup probes and native/pointer readiness events retry attachment. `window.ZentralRuntime.compactHoverStatus` reports attachment/waiting state and the latest attachment error. This repair has not been tested in a live browser.

## Late-paint startup recovery

While stabilization is waiting, a temporary `MozAfterPaint` readiness listener detects native capabilities without requiring mouse movement. It is removed once the guard is configured and on disable/unload. Startup repair similarly waits for an available sidebar instead of permanently completing an unavailable attempt. Diagnostics expose `runtime.snapshot().compactHover`. This is not a periodic timer and must not be retained on a healthy guard.
