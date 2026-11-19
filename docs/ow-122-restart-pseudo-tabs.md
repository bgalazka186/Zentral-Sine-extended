# OW-122 — post-restart duplicate Notes/Agenda seed tabs (version 3.4.0)

## Owner symptom

After restarting Zen, two tab-like entries appeared. The supplied inner
`<stack class="tab-stack">` had no Zentral-authored markup: it contained Zen's
native pending/reset-pin UI (`tab-reset-pin-button`, `tab-icon-pending`,
`tab-icon-image pending="true"`, `zen-media-notes`, `zen-tab-sublabel` with
`Back to pinned url`, and the reset buttons) plus a green note data-URI
favicon. The owner also reported that clicking / loading one closes it.

The earlier owner Browser Console JSON (`/tmp/arena-coding-uploads/...`, not a
repo deliverable) is an **expanded**-state capture despite its
`diagnosticLabel`; it shows `fxastatus="signedin"`, the Notes and Agenda roots,
and pinned/pending pseudo-tabs with `zen-pinned-changed="true"`,
`bgalazka-notes-item` / `bgalazka-notes-agenda-item` markers and static data-URI
icons. It is evidence that these pseudo-tabs can be native pinned tabs with a
static icon, not that the two post-restart entries were created by Zentral CSS.

## Evidence, not a guess

The upstream tag `1.24.3b` is commit
`300f9292ddbaaebf24626b4a7451e5426a11d3d8` (verified through
`gh api repos/zen-browser/desktop/git/matching-refs/tags/1.24.3b`). Its release
was published 2026-11-18 and explicitly contains the Spaces Sync fix for
built-in containers.

1. **The supplied stack is native Zen pinned-changed UI.**
   `locales/en-US/browser/browser/zen-vertical-tabs.ftl` maps
   `zen-default-pinned` → `Back to pinned url` and
   `tabbrowser-reset-pin-button` → `Reset and pin tab`.
   `src/browser/components/tabbrowser/content/tab-mjs.patch` adds
   `.tab-reset-pin-button`, `.zen-media-notes`, `.zen-tab-sublabel` and
   `.tab-reset-button`. `src/zen/tabs/ZenPinnedTabManager.mjs` sets
   `zen-pinned-changed` and `--zen-original-tab-icon` when the current location
   differs from `_zenPinnedInitialState.entry.url`. None of those strings or
   elements exist in this repository.

2. **Zentral creates exactly two untitled root seeds.** When the Notes or
   Agenda root folder is absent, `ensureRoot()` calls
   `zenNewTab(zenNewUrl(""), "root")` → `about:blank#zn-new:`, and
   `agendaEnsureRoot()` calls `agendaNewTab("seed:root")` →
   `about:blank#zn-agenda-seed%3Aroot`. `addManagedPseudoTab()` opens each with
   `skipSessionStore: true`, marks it `bgalazka-ephemeral-tab` /
   `skipSessionStore`, pins it, and parks it. `zenSettleSeed()` /
   `agendaSettleSeed()` normally remove it; if an empty Zen folder would
   vanish, the fallback keeps a labelled seed instead. These are the only
   pseudo-tabs whose synced `title` can be empty — every real Notes/Agenda
   projection row has a label. This explains the owner seeing **two untitled
   favicon-only** entries rather than a whole folder of notes.

3. **`skipSessionStore` is no longer a complete shield in Zen 1.24.3b.**
   `src/zen/sessionstore/ZenWindowSync.sys.mjs` `on_TabOpen()` assigns
   `tab.id = this.#newTabSyncId` to every opened tab before it checks whether
   the tab is pinned. `src/zen/sessionstore/ZenSessionManager.sys.mjs`
   `#shouldCollectTab()` keeps a blank stand-in whenever `zenSyncId` exists,
   and `saveState()` calls `#collectWindowData(windows)`, notifies
   `zen-sidebar-data-collected`, and exposes the collected sidebar via
   `getSidebarData()`. `src/browser/components/sessionstore/TabState-sys-mjs.patch`
   persists `zenSyncId`, `zenStaticLabel`, `zenHasStaticIcon`, `image` and
   `tabData._zenPinnedInitialState`. Therefore a transient Zentral seed can
   enter Zen's own sidebar/Spaces data even though Firefox's session store was
   asked to skip it.

4. **Spaces Sync can re-materialize that stale record after restart.**
   `src/zen/sync/ZenSpacesSyncModel.sys.mjs#tabIdentity()` prefers
   `_zenPinnedInitialState.entry.url` for pinned tabs and
   `syncableIconUrl()` accepts `data:` icons. `projections()` turns the tab
   into a `kind:"tab"` record. `src/zen/sync/ZenSpacesSync.sys.mjs` registers
   the engine with `super("Spaces", service)`, and `_reconcile()` always
   accepts incoming records. `src/zen/sync/ZenSpacesSyncApplier.sys.mjs#createTab()`
   calls `addTrustedTab(data.url, { createLazyBrowser:true,
   noInitialLabel:true, lazyTabTitle:data.title || undefined, ... })`, sets the
   static icon and `_zenPinnedInitialState`, pins the tab, and invokes
   `ZenWindowSync.on_TabOpen`. With an empty seed title and the stored data-URI
   icon, that is exactly a pending pinned tab with a favicon and no title.

5. **Local cleanup missed the new engine name.** Before this fix
   `additional/notes/ZentralNotes.uc.js` observed
   `weave:engine:sync:finish` but its allowlist was
   `/^(tabs|zen[-_]?pins|pinned[-_]?tabs)$/i`; a `Spaces` finish was ignored,
   so no post-Sync sweep or old-record prune ran. The older
   `ZenPinnedTabsStorage.sys.mjs` shield also cannot attach: that path does not
   exist anywhere in the `1.24.3b` tree. The existing
   `filterSessionStoreState()` / `SessionFile.write` shields are still correct,
   but they do not filter `getSidebarData()`, `ZenSpacesSyncModel.projections()`
   or `ZenSpacesSyncApplier.applyBatch()`.

6. **Why clicking / loading closes it.** `routePseudoTab()` treats a `zn-` URL
   outside its managed Notes/Agenda root as a transient navigation request: it
   calls `gBrowser.removeTab(tab, { animate:false })` before opening the note,
   sheet or calendar. Before this fix `pseudoUrlForTab()` did not read
   `_zenPinnedInitialState`, so a markerless restored seed with a live
   `about:blank` URL could sit there until Zen loaded its frozen pinned URL;
   then the existing router closed it. The native `Back to pinned url` UI is
   Zen's pinned-changed affordance, not a Zentral button.

The exact number of stale records on the owner's Firefox Account cannot be
read from this repository. The code-level explanation for **two** is the pair
of root seeds above; a live record dump would still be needed to prove that
the owner's server held exactly those two and no other stale pseudo records.
That live confirmation is part of the OWNER GATE.

## Narrow fix

`additional/notes/ZentralNotes.uc.js` now:

- recognizes a pending tab as Zentral's from `bgalazka-notes-*`, the ephemeral
  / skip-session markers, `_zentralNotesUrl`, a live `zn-` URL, **or**
  `_zenPinnedInitialState.entry.url` (`zenPinnedPseudoUrl()` /
  `isZentralPseudoTab()`), while a real live URL always wins over a stale pin
  record;
- feeds that canonical URL into `sweepRestoredPseudoTabs()`,
  `sessionCurrentTabUrl()` and `pseudoUrlForTab()` so a markerless restored
  seed is classified and routed correctly;
- wraps the current native singletons with reversible, reference-counted
  method shields: `ZenWindowSync.on_TabOpen/on_TabPinned/on_TabMove`,
  `ZenSessionStore.getSidebarData()`, `ZenSpacesSyncModel.projections()` and
  `ZenSpacesSyncApplier.applyBatch()`;
- filters pseudo tab records, their split/folder/layout references and empty
  managed folders out of outgoing Spaces projections **and** incoming Sync
  batches; clean payloads keep their identity and real tabs are untouched;
- adds `spaces` to the sync-finish allowlist, invalidates the model cache,
  and runs a `cleanStrayPseudoTabs()` sweep at startup, on `Spaces`/tabs/pins
  sync finish, on `SSTabRestored` and after the delayed projection boot. The
  sweep removes only a pending pseudo-tab outside its managed root and clears
  stale pseudo marks when a real page has taken over that sync id;
- preserves legitimate labelled seeds inside the Notes/Agenda roots and never
  changes compact-tabs CSS, broad `[pending]` selectors, visibility, owner
  folders or real tabs.

No CSS hiding, no blanket tab deletion and no version bump are involved.

## Tests

`tests/ow-122-restart-pseudo-tabs.test.cjs` is RED on the pre-fix `f4b6a51`
tree (`RED_EXIT=1`, `zenPinnedPseudoUrl` missing) and GREEN here (8 passed).
It covers native pin-state recognition, startup sweep, flat sidebar filtering,
Spaces projections and incoming batches, reversible shields, source wiring,
and the exact two untitled root-seed URLs. Adjacent pseudo-tab / session /
OW-88 / sidebar-part suites remain green. The generated Notes standalone
bundle and lock are rebuilt with `--keep-version`, never hand-edited.

## Validation

- Exact `--keep-version` chain: `CHAIN_GREEN` — 12 standalone packages,
  `599 Sine preferences (142 with free numeric entry)`, z-map `42/72/3`,
  `Standalone packages are up to date`, `defaults agree`,
  `catalog checks passed`.
- Docs-inclusive full suite: `287/287 passed; 0 failed` (`320.5 s` combined
  runtime / `118 s` wall), `0 TODO failing: none`,
  `DOCS_INCLUSIVE_SUITE_EXIT=0`, `git diff --check` clean.
- Version remains **3.4.0**; no `--bump`, `sync-version`, ZIP or `.git`
  archive.

## OWNER GATE

No live Zen/Sine runtime, Firefox Account record dump or post-restart
`<tab>` capture was available here. In live Zen, after installing this build:

1. restart with Firefox Account / Spaces Sync signed in and confirm that the
   two untitled favicon-only seeds do not return;
2. click any remaining pseudo-tab and confirm Notes/Agenda still open normally;
3. confirm ordinary pinned tabs, Notes/Agenda folders, compact tabs and
   multi-window tabs are unchanged;
4. if a diagnostic is still needed, provide only the outer attributes of the
   two `<tab>` elements and the IDs of any `kind:"tab"` records whose URL
   starts with `about:blank#zn-` — no full JSON dump.

Live disappearance and click behavior are not claimed as measured here.
