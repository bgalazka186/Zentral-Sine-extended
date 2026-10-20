# Zentral compatibility bridge — contract 1

`ZentralBaseBridge.js` starts after Apps and before the panel extension. It verifies the B001/B002/B004 entrypoints and publishes `runtime.baseBridge`.

- `snapshot()` resolves current base identity and presentation. The app record is a frozen copy; DOM/browser handles are live.
- `app(id)` resolves a normal or Essential record for identity checks.
- `updateStartURL` and `createApp` delegate to the validated base store.
- `on`/`emit` carry native navigation and secondary-shell lifecycle notifications.
- `wrap` installs owned method adaptations. Every extension also owns its release function; teardown never overwrites a newer wrapper and captured wrappers become inert.
- `hooks()` reports installed new adaptations for diagnostics.

This is a translation/ownership boundary, not another Apps implementation or an independent Sine mod. See `docs/BASE-PATCHES.md` for every new base edit and the inherited extension wrappers that remain outside this bridge.
