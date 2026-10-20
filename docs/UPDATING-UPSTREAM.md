# Updating the hybrid base after Zentral 1.1.0

The package version is Extended 3.0.0. The pinned original version and commit are in `UPSTREAM.json`. Keep these separate. A new Extended release does not imply every upstream source file is identical to that release.

1. Keep a working package and settings backup. Work on a review branch; retain all uncommitted user changes.
2. Run `python3 tools/update-provenance.py --check`. If the pristine reference hashes differ, recover the original snapshot before trusting a diff.
3. Fetch the next original version in a separate checkout, identify its actual commit/version, and generate a diff against `0e18990c0bfa2563d22de8f5d04135da186ef1b0`. Do not assume the next tag exists or compare only release descriptions.
4. Read `docs/BASE-PATCHES.md`, `docs/UPSTREAM-MAP.json` and the existing controller contracts. Classify every change: new behavior, equivalent already present, upstream fix, structural-only change, conflict, or deliberate skip.
5. Port into the existing owner. Updates to Apps storage/browser identity go into `zentral/apps`; group changes go into `zentral/groups`; geometry math goes into the single math helper. Additive UI, floating behavior, theme policy and video remain features. If a new private-state operation is unavoidable, add one small documented base method and increment the bridge contract when incompatible.
6. Maintain one source of truth. Do not add upstream app.mobile, floatRects, show_navbar or duplicate zoom/loading stores when the hybrid already owns equivalent behavior. Do not register the archived upstream master script, logger, CSS or geometry singleton alongside the active base.
7. Recheck B001–B004/B014 against changed methods. Check every inherited wrapper in the coordinator and secondary views: a clean textual patch can still be semantically wrong. Update native API integrations independently of the upstream version change when possible.
8. Preserve choices. Prefer an implementation setting when two behaviors are useful. For clear supersets, retain the better-supported implementation and record the choice in the ledger. Compatibility switches pause the affected owner; never delete its user state or silently modify a different mod.
9. Regenerate preferences and check provenance with the commands below, then verify changed behavior in Zen. Record exact Zen/Sine/OS/configurations. In particular, verify both Apps enabled and disabled; missing optional parts must not prevent independent features starting.
10. After review, archive the next pristine snapshot separately, update the pin/hash manifest, update the semantic ledger/source map and regenerate the patches. Update Extended's version independently. Keep the old snapshot for the migration history if it is still needed for review.

## Development commands

Runtime installation has no npm dependency. This GitHub package omits internal tests, test dependencies, validation reports and changelogs.

```sh
node tools/build-preferences.cjs
python3 tools/update-provenance.py
python3 tools/update-provenance.py --check
```

`tools/build-preferences.cjs` builds the root declarative settings from owner schemas and curated order. Change the owner schema and matching layout metadata, then generate; do not maintain duplicate root preferences by hand.

`patches/1.1.0-to-adapted-base.patch` exactly transforms the archived upstream reference files into the adapted zentral/shared sources. It includes the structural extraction, so it is not a tiny runtime patch or the whole deployable package. It can be applied to a throwaway copy of the archived snapshot with `git apply`. Features, bridge, catalog and settings are additional package layers. The source map explains which owners replace upstream responsibilities.

`patches/extended-input-to-3.0.0.patch` records code/schema/README changes from the uploaded Extended input, including moved paths. It is a provenance/review artifact rather than a substitute for this complete ZIP. The original upstream 1.0.2 → 1.1.0 diff is retained separately.

When code changes after this build, regenerate its provenance and preferences. Do not edit generated patches to hide source changes. Runtime integrity checks use hashes; they do not prove behavioral equivalence or browser compatibility.

For the October repair, start with `REPAIR-HANDOFF-3.0.0.md` and the B001/B015 additions. The active base remains an adapted/extracted Extended implementation; do not mistake the archived original reference for an additional live module. The settings testing view mirrors real keys and must not register duplicate schemas.

The `extended-input-to-3.0.0.patch` file is the historical initial migration artifact, not an up-to-date deployable patch after subsequent repairs. Use the current adapted-base diff, actual feature sources and the repair file manifest when comparing a repaired installation.
