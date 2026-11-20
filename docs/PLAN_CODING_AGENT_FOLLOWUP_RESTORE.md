# FOLLOW-UP 3 for the coding agent — Restore must bring things back in the form they had (Zentral 3.4.0)

Read first: `PLAN_CODING_AGENT.md` section 1 (rules). Same rules: one task per commit, tests required, locate code by symbol name (line numbers below are hints from this build), no new `setInterval`, update `docs/perf-results.md` and the handoff.

Scope of this review: only `additional/boost/` and `additional/widgets/` were read; the full test suite was not run for this review. The agent must run it.

## 0. Bug report (from the owner)

"The Restore button (Przywróć) opens everything in Zentral panels instead of tabs, if they were tabs in the first place."

## 1. Root cause (confirmed by reading the code)

1. `sleepPanelRecord(record, ctx)` in `additional/boost/ZentralBoost.uc.js` frees up to two holders of a page: (a) the panel's own app browser (`apps.closeApp`) and (b) the record's tab (`explicitUnloadTabs`). It returns `{ slept, how: "panel" | "tab" | "both" | "none", reason }`.
2. **Both callers throw `how` away.** The deep-pass panel loop in `runLevel2` and the Game Mode loop (the `for (const record of plan.sleepPanels)` block) compute only `wasLoaded = Boolean(livePanelBrowser(appId))` BEFORE sleeping, count the record as a panel (`unloaded.panels += 1`) and write a PANEL snapshot entry `{ appId, recordRef, wasLoaded, mode }` with `rememberSessionPanel`. Nothing records whether the record's TAB was loaded, and the tab itself is never written to the tab snapshot (the plan and the tab loop skip tabs that back panel records: `recordTabs.has(tab)`).
3. **Restore ignores `wasLoaded`.** `restoreSnapshotEntries()` builds one panel task for every panel entry. `panelNeedsWork(entry)` is true whenever no panel browser exists now (`!livePanelBrowser(appId)`), even if one never existed. `runPanelRestore(entry)` then calls `ctx.loadEssentialInBackground(record, false)`, which CREATES a panel app browser (`getOrCreateAppBrowser`) and loads the URL in it. The legacy fallback `undoState.panels.map(... wasLoaded: false ...)` has the same effect.
4. Result: every pinned/essential record that was slept while it lived as an ordinary loaded TAB comes back as a Zentral PANEL, and its tab is never reloaded. With the owner's 39 pinned tabs this looks like "everything opens in panels". The sleep itself is correct (G1); the memory of what existed is wrong (G3).

## 2. Required behavior

Restore must recreate exactly the holders that existed before the sleep and nothing else:

| Before sleep | After Restore |
|---|---|
| page lived only in the record's TAB (loaded tab, no panel browser) | the tab is reloaded in the background (same as the other tab restores); NO panel is created |
| page lived only in the PANEL app browser (tab was pending) | the panel is woken with `loadEssentialInBackground(record, false)`; the tab stays pending |
| both were loaded | both are restored (panel and tab), in that order |
| neither (nothing was freed) | nothing is restored |

Counts shown to the person ("N apps, M tabs") must follow the same rule: a record freed only as a tab is a tab, not an app.

## 3. Tasks

### R1 — Record what was actually freed, per record (core fix)

- Extend `sleepPanelRecord` to return the holders it found BEFORE it acted: `{ slept, how, reason, panelWas: boolean, tabWas: boolean }` where `panelWas = Boolean(livePanelBrowser(appId))` and `tabWas = !tabAlreadyAsleep(record.tab)` evaluated at the top of the function, before any change. `how` keeps its meaning (what was freed now).
- In BOTH callers (deep pass panel loop, Game Mode panel loop) stop computing `wasLoaded` separately and classify by the result:
  - `how` is `panel` or `both` → `unloaded.panels += 1` and `rememberSessionPanel({ appId, recordRef: record, mode, holders: { panel: true, tab: how === "both" }, when })`.
  - `how` is `tab` (or the tab part of `both`) → `unloaded.tabs += 1` and a TAB snapshot entry through `rememberSessionTab` and `rememberUndone("tabs", ...)` with the real element: `{ tab: record.tab, url, title, lastAccessed, wasPinned: true, recordAppId: appId, gameMode, when }`. For `how === "tab"` do NOT write a panel entry and do NOT increment `unloaded.panels`.
  - `how === "none"` → no entry (as today).
- Keep the old `wasLoaded` boolean on panel entries for back-compat with old tests only; the engine must not use it any more.

### R2 — Restore engine builds only the tasks that match

- `restoreSnapshotEntries()`: panel tasks only for entries with `holders.panel === true` (entries without `holders`, i.e. data written by an older build, are restored as panels only if `wasLoaded === true`). The legacy `undoState.panels` fallback must stop hard-coding `wasLoaded:false`; give those entries the same `holders` field and apply the same rule. Tab tasks come from the tab snapshot, which now also contains record-backed tabs (dedupe by tab element as today).
- `panelNeedsWork(entry)`: return false when `entry.holders?.panel` is not true. Keep the live-browser check as an additional skip.
- Tab tasks for tabs that carry `recordAppId`: before waking, skip the task if a live panel browser for that appId exists AND the entry had no panel holder (never create a second holder). Waking uses the existing `wakePendingTab(tab)` (background `linkedBrowser.reload()`, never selects).
- Order stays: selection first, panels (live-mode first), then tabs newest-first. Respect the existing profiles: `panels` restores panel entries only, `recent` limits the tab list, `none` restores nothing, `all` restores both lists. A record tab that was slept belongs to the TAB list, so the `panels` profile will not reload it (document this in the README: "panels" means apps that lived in panels).
- `restore()` (legacy immediate door used by Level 2 with profile `panels`) must apply the same filter, so a deep pass followed by Restore also leaves tab-only records alone.

### R3 — Honest counts and labels

- The widget label "Przywróć ({panels} aplikacji, {tabs} kart)" is built from `gameSession.panels.length` and `gameSession.tabs.length` in `ZentralWidgets.uc.js` (`restoreSnapshot`, ~line 2038). After R1 it is correct without changes; add a test that proves it.
- The Game Mode and Level 2 toasts ("freed X MB, N tabs, M apps") must use the new counts.
- Update the outdated string `boost.levelRestore` ("Przywróć: budzi uśpione panele; karty wczytują się po kliknięciu.", and its English equivalent) to describe the real behavior: Restore reloads the apps and the tabs that were unloaded, panels as panels and tabs as tabs. Keep `boost.later`/`boost.levels` consistent.
- Update `additional/boost/README.md` (Restore section and the holders table above).

### R4 — Tests (all must FAIL on the current code and pass after the fix)

Use real attributes on fixture tabs (`pinned`, `zen-essential`), unlike the earlier fixtures that used `attrs: []`.
1. Record with a LOADED pinned tab and no panel browser → Game Mode sleep → snapshot has one tab entry and ZERO panel entries → `restoreSession()` calls `wakePendingTab`/`linkedBrowser.reload` once and `loadEssentialInBackground` NEVER.
2. Record with a live panel browser and a pending tab → panel entry only → Restore calls `loadEssentialInBackground(record, false)` once and does not reload the tab.
3. Record with both loaded → both entries → Restore wakes the panel and the tab, in that order.
4. Record with neither loaded → no entries, Restore does nothing.
5. Owner-like session: 39 pinned loaded tabs (as tabs) + 3 panel records with live panel browsers → Game Mode → Restore: exactly 3 panel wakes and 39 tab wakes, no extra panels.
6. Legacy entries (no `holders`): `wasLoaded:false` → no panel is created; `wasLoaded:true` → one panel.
7. Deep pass (Level 2) then `restore()` (legacy door, panels profile): tab-only records are not turned into panels.
8. Restore is idempotent: a second `restoreSession()` finds an empty snapshot and creates nothing.
9. Counts: after the sleep, the widget label and `gameModeState().unloaded` show tab-only records as tabs.
10. Profiles `recent`, `panels`, `none`, `all` still behave as documented with the new entry types.

### R5 — Owner gates (put in the handoff)

Reproduce with a mixed session: one pinned page loaded as a TAB (for example arena.ai opened from the sidebar as a tab) and WhatsApp loaded in its PANEL.
1. Before pressing Restore, run in the Browser Console: `Services.wm.getMostRecentWindow("navigator:browser").ZentralBoost.gameModeState()` and send the `snapshot` counts.
2. Switch Game Mode on, then press Restore. Expected: arena.ai returns as a TAB (its tile shows no loaded panel), WhatsApp returns in its panel, the original tab is selected again, no other panels appeared.
3. Switch Game Mode on and press Restore within 5 seconds: no panel appears for any tab-only page.

## 4. Do NOT

- Do not change `sleepPanelRecord`'s sleeping behavior or its exemptions, the Game Mode planner, the parking logic or the stagger/concurrency limits.
- Do not make Restore force-create panels "to be safe" for records without a recorded holder.
- Do not add polling; the existing one-shot timer chain stays.

## 5. Definition of done

`node tests/run-all.cjs` green, build commands from `PLAN_CODING_AGENT.md` rule 5 green, the ten new tests fail on the old code, README and strings updated, `docs/perf-results.md` has a line, handoff lists the three owner gates.

## 6. Status tracker (updated by the coding agent)

| Task | Status | Evidence |
| :--- | :--- | :--- |
| `R1` — record what was actually freed, per record | **DONE** | `sleepPanelRecord()` returns `panelWas`/`tabWas` from the pre-sleep state; both callers classify through one `recordPanelSleepHolders()` recorder. `tests/r1-sleep-holders.test.cjs` (7 passed), strict RED on the pre-R1 tree. |
| `R2` — restore engine builds only the matching tasks | **DONE** | `panelHadHolder()` + `normalizePanelRestoreEntry()` gate every panel task, `hadPanelHolder` gates record tabs, the legacy `restore()` door inherits the filter. `tests/r2-restore-holders.test.cjs` (11 passed), strict RED on the R1 tree at the second-holder rule. |
| `R3` — honest counts and labels | **DONE** | Live snapshot counts drive the label and toasts; `boost.levelRestore` and the Boost README holders table rewritten in EN/PL. `tests/r3-restore-counts.test.cjs` (5 passed). |
| `R4` — the ten tests | **DONE** | `tests/r4-restore-holder-spec.test.cjs` (10 passed) with real `pinned`/`zen-essential` fixtures; 0/10 pass on the pre-fix tree `6d2e2934`. |
| `R5` — owner gates | **DONE (recorded, not measured)** | The three gates are in `TODO_notes_roadmap.md` under **Restore follow-up owner gates (R5)**; `tests/r5-restore-owner-gates.test.cjs` keeps them there. |

Full suite at this tree: `311/311 passed; 0 failed`, `0 TODO failing: none`. Exact no-bump chain green at
608 root settings / 608 Sine preferences and version 3.4.1. No live Zen/Sine runtime, toast, visual or RAM result is
claimed: gates A/B/C above remain owner work.
