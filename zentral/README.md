# Adapted Zentral base

Extended 3.0.0 integrates original Zentral 1.1.0 behavior while preserving the supplied Extended controllers and hardening. The exact original reference is under `zentral/upstream/1.1.0/`; only this directory's registered modules execute.

Read `docs/BASE-PATCHES.md` and `docs/UPDATING-UPSTREAM.md` before editing. Local B001/B002/B003/B004/B014 comments mark new zentral/extension boundaries. Existing controller headers describe preserved fork changes. The generated upstream-to-base patch includes extraction and refactoring; use the source map rather than assuming a small patch or a direct monolith replacement.

Apps owns browser and app identity. Groups owns group behavior. The pure math helper has no browser side effects. Common loader utilities remain in `loader/`. Extended UI, geometry policy, secondary views and independent tools remain in `extension/` or `additional/` according to their dependency. The bridge coordinates access; it does not create another base instance.
