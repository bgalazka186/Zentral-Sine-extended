# Zentral — AI rules

## Version bumps

When the main mod version is bumped (in `theme.json`, `UPSTREAM.json` `extended_version`, `loader/Zentral.uc.js` `// @version`, `loader/ZentralRuntime.js` `VERSION`, and the `vX.Y.Z` settings badge in `ZentralSettingsShell.js`), every standalone sub-module under `additional/` must be bumped to the same version **even if it had no code changes**.

Reason: Sine installs each `additional/<module>/` folder as an independent mod. The end user sees the `version` in each standalone `theme.json`/`standalone.json`/`standalone.lock.json` and the `// @version` header in each `.standalone.uc.js`. If a standalone module lags behind the main mod version, the user cannot tell whether they have the most up-to-date code.

Files to update per standalone module (`additional/<module>/`):
- `theme.json` — `"version"`
- `standalone.json` — `"version"`
- `standalone.lock.json` — `"version"`
- `<Module>.standalone.uc.js` — `// @version`, `const __ZENTRAL_STANDALONE_VERSION__`, and the build placeholder comment `Placeholders replaced by the build: X.Y.Z.`

Also update:
- `loader/ZentralRuntime.js` — `// @version` and `const VERSION`
- Any `README.md`/`INSTALL.md`/`docs/*.md` that cite the old version

Never leave a standalone module at an older version than the main mod. Verify with `grep 3.0.2` (or whatever the prior version was) after a bump to confirm zero stale references remain.

## Feature lifecycle contract (instructions for future AI edits)

Source: `loader/README.md` — Core schedules and owns work; features own behavior. Do not add feature-specific preferences, DOM selectors, visual changes or native patches to the scheduler. Existing sidebar geometry/appearance code is legacy ownership, not a pattern for new features.

1. Sine loads only `loader/Zentral.uc.js`. Source loading must synchronously register definitions/factories; it must not start a feature, patch native objects or wait on a promise. Never register each `.uc.js` independently.
2. Catalog IDs are unique. `requires` lists services that must be active before initialization. `sources` lists panel parts that must be declared. `contextDependencies` documents the shared panel context and is not an ordering graph. Missing required dependencies block only their consumers; optional files must have optional callers.
3. Core completes the entire declaration pass before validating registrations, loads owned CSS in catalog order, then waits for native restoration. It re-reads live native promises after each barrier because managers can be created while another service restores. Rejected barriers are reported; closing the window cancels the wait. An unresolved native restoration promise remains a visible waiting state, not permission to mutate partially restored tabs.
4. `init({ shared, runtime, lifecycle })` is synchronous and runs once. Core marks it initializing before calling it and coalesces reentrant activation requests. Return a disposer or a service with `destroy()`. Register partial cleanup with `lifecycle.own()` **before** fallible work. A failed initializer is rolled back and reported, not blindly replayed. Existing legacy feature cleanup remains supported.
5. A preference being true does not prove its native hooks exist. Use `lifecycle.watchNative()` for lazy or replaceable browser APIs. Put availability probes and attachment behavior in the feature; the core watcher owns bounded startup checks, live preference subscriptions, event-driven recovery and rollback. `resolve` must be read-only and return a stable object identity or null. `attach` is synchronous and receives a fresh child scope. Return a disposer or service with an optional `isCurrent()` to detect same-object hook replacement. Never query properties with side effects just to test readiness.
6. Watchers make five startup checks over roughly 6.2 seconds, then stop scheduling checks. Native events or an explicit interaction can still recover a late API. Declare only relevant events/topics; do not add permanent polling or a full-document subtree observer. Synchronous capture recovery is appropriate only when hooks must exist before a native interaction. `onReadyEvent(event)` can prime that one interaction because listeners installed during dispatch may miss it.
7. `enabled` must read the saved preference live. False detaches the native attachment, cancels timers and removes its event/topic listeners; only its preference subscription remains. Do not reset user choices at startup. Native method restoration must compare exact descriptor ownership so another mod's newer hook is never overwritten. Captured old wrappers must become inert after disposal.
8. Use scope `listen`, `observe`, `preference`, `setTimeout`, `requestAnimationFrame`, and `own` rather than unowned work. Scope teardown is idempotent, reverse ordered and continues after cleanup errors. For async work, capture the child scope and check `child.active` after every await before touching DOM/native state. Aborting a request is preferable when supported. A feature-specific controller may keep its existing cancellation generation.
9. Create the coordinator cleanup array **before** publishing lazy context getters or calling `prepareParts(ctx, cleanupFns)`. Pass that array explicitly. Core must never invoke `ctx.cleanupFns` or other lazy getters during preparation: their backing lexical bindings may not yet exist. Descriptor snapshots must use `Object.getOwnPropertyDescriptors`, without reading property values. Optional panel preparation must publish reversible configurable context properties only, register cleanup immediately, and yield before activation. Core isolates preparation failures and restores context descriptors. Nested shared-object mutation during preparation is forbidden: core cannot infer how to reverse it. Required-part failure blocks its coordinator; optional-part failure must not break other parts. Parts activate once, in the coordinator's documented order.
10. Removing a feature means removing its catalog entry, owned CSS/settings metadata and optional callers together. Keep required dependency errors explicit. Do not delete shared controllers used by other owners. Test the installation both with and without optional files. Module-level developer switches remain restart-scoped; feature preferences can be live. Do not imply that a module toggle hot-unloads its dependents.

## Minimal native integration pattern

```js
ZentralRuntime.register({
  id: "my-feature", // same ID as the catalog
  init({ lifecycle }) {
    lifecycle.watchNative({
      name: "native-binding",
      prefs: [MY_PREF],
      enabled: () => Services.prefs.getBoolPref(MY_PREF, false),
      resolve: () => findReadyNativeObject(), // stable identity; no mutation
      events: ["activate", "aftercustomization"],
      attach(native, child) {
        const release = installOwnedBehavior(native);
        child.own(release); // register immediately, before the next operation
        return { isCurrent: () => stillOwnsNativeHooks(native) };
      },
    });
    // Core already owns lifecycle; returning a separate service is optional.
  },
});
```

`runtime.snapshot().features[].nativeBindings` reports waiting/active/disabled state, attachment attempts and the last error. A feature can be initialized while its native binding waits. Use this status when an enabled setting appears ineffective; do not suppress the error or force its preference off and on.

## Standalone bootstrap contract

The video standalone bootstrap mirrors source/construction contracts. Keep both implementations aligned when changing the loader. Never add guide headers or run formatters inside `zentral/upstream/1.1.0`.
