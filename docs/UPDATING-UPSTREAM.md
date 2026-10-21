# Updating the hybrid base after Zentral 1.1.0

The package version is Extended 3.0.2. The pinned original version and commit are in `UPSTREAM.json`. Keep these separate. A new Extended release does not imply every upstream source file is identical to that release.

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

## Zen browser release checks

A Zen browser update is separate from the Extended upstream pin. When Zen ships a new release, run this checklist before declaring the mod compatible. A Zen patch can rename private members, move modules or change event names without touching the Extended base.

1. **Zen version + build.** Record the new `application.ini` Version, BuildID and SourceStamp. Compare against the last validated baseline (see `docs/ZEN-1.23.4b-COMPAT.md` for the current one).
2. **Compact-mode member contract.** The compact-hover guard wraps Zen's private `gZenCompactModeManager` API. Verify every member the mod touches still exists with an unchanged contract: `_setElementExpandAttribute(element, value, attr = "zen-has-hover")`, `_collapseTrackedElement()`, `_clearAllHoverStates()`, `clearFlashTimeout(id)`, `_removeHoverFrames`, `_outsideTrackedElement`, `_stopTrackingMouseOutsideWindow()`, `canHideSidebar`, `sidebar`, `sidebarIsOnRight`, `preference`, `_ignoreNextHover`, `_hasHoveredUrlbar`, `_isTabBeingDragged`. If any is renamed or removed, the guard needs a shim or the feature must be retired.
3. **Folder / tab-group event names.** Group code listens for native folder/group animation completion events (e.g. `ZenFolderAnimationFinished` → `TabGroupAnimationComplete` in 1.23.4b). Recheck every listener against the current `src/zen/folders/` source.
4. **Media controller module path.** The video feature anchors on the DOM id `zen-media-controls-toolbar` and does not import the media controller module, but the module itself moved (`ZenMediaController.mjs` → `.sys.mjs`, ES-module class, `#sharingCard` → `#sharingCardForBrowser(browser)`, `window.gZenMediaController` removed). Recheck the anchor id and any future import path.
5. **Library CSS tokens.** The Library resize feature positions `zen-library` and does not override badge/gradient colors, but library CSS tokens changed (`currentColor` → `--border-color`, hover selectors relaxed). Recheck any geometry or color override.
6. **Boosts / zap-bar attributes.** New `<zen-zap-bar>` elements set `zen-zapping` on `.browserSidebarContainer` (+2px outline). The mod does not hook that attribute; confirm no geometry change and that the outline remains cosmetic.
7. **Session / space-routing APIs.** `ZenSessionManager.sys.mjs` (`__isNewZenWindow`) and `ZenSpaceRoutingManager.sys.mjs` (`routeStartupTab`, `getStartupUserContextId`) are unused by the mod. Recheck if a future feature adopts them.
8. **Never change `UPSTREAM.json.upstream_version` for a Zen update.** `upstream_version: 1.1.0` is the *Zentral* pin, not the Zen version. A Zen update does not change the Extended base, so do not bump the pin, regenerate the adapted-base patch or refresh the upstream snapshot for it. Record the Zen baseline in a compat doc instead.
9. **Re-scope, don't silently retire.** If a Zen fix removes the bug a feature worked around, re-scope the feature (opt-in tolerance, off by default, out of the Recommended preset) rather than retiring it in a silent patch. Keep preference keys stable.

## Follow-up video / loader repair

See [VIDEO-PREVIEW-REPAIR.md](VIDEO-PREVIEW-REPAIR.md). The upstream pin remains 1.1.0 at the same commit. Five archived reference files in the uploaded tree had diverged from their advertised hashes; they were restored from that exact commit, and the adapted-base patch was regenerated. Do not format or annotate the archived snapshot. Put commentary in this directory instead.

Keep new preview behavior in `additional/video/controllers/`; use the existing transport and capture owner rather than adding a second stream. Optional helpers must use both optional load and optional construction, with a safe caller fallback. Required-helper failures may disable the video feature; the runtime owns cleanup and keeps unrelated features independent. Source diagnostics distinguish evaluation from controller construction; an active feature has completed its synchronous initializer. The optional `verify` postcondition must return true before activation, and failures destroy the feature scope. Video currently uses this check; other features retain their existing activation and availability contracts.

A changed-files ZIP overlays the exact uploaded package, with repository-relative paths. It is not a standalone installation. Rebuild `preferences.json` after modifying owner schemas or layout. Keep the New settings mirrors on the same keys, group them by original section, and never put profile data in documentation or fixtures.

The generator now emits Git missing-final-newline markers. After regeneration, apply the patch to a throwaway pristine snapshot and compare the resulting adapted sources; checking only that a generated patch file matches itself will not detect malformed patch syntax. The follow-up patch passed this application and byte-comparison check.
