# Perf results (RAM plan `OW-87`–`OW-94`)

Source: `docs/PLAN_CODING_AGENT.md` (the owner's own measurements, 2026-11-18). One line per task, appended when the
task ships. **The owner measures effect on his machine; every figure here is "not measured" until he does.** The
point of this file is that a later session can see what changed and what it was expected to do — never a number
nobody took.

| Task | What changed | Expected effect | Measured |
| :--- | :----------- | :-------------- | :------- |
| `OW-87` | `zen.workspace.zentral.debug.core` defaults to `false` in the schema, the preset and Core's fallback table; the logger honours the pref instead of hardcoding the core category on; the settings switch reads and writes it | a fresh install collects no debug lines by default, so the logger does no string work for them | not measured |
| `OW-88` | Notes/Agenda sidebar placeholders are discarded after creation, after a session restore and after a click is answered (`parkPseudoTab`, one draining task + a bounded 3-try retry), behind `zen.workspace.zentral.notes.park_pseudo_tabs` (default on) | each live placeholder stops holding a content process: the owner measured ~11 of them at 43-51 MB each (~0.5 GB), so this is the biggest item that lives in Zentral code; rows, labels, icons and clicks are unchanged | not measured |
| `OW-89` | new `additional/boost/` (feature `boost`, catalog beside `tab-unload`, settings category `boost` · `Memory`): `memoryMB()` sums parent + child processes from `ChromeUtils.requestProcInfo()`, `runLevel1()` = `minimizeMemoryUsage` → `forceGC` → `forceCC` with the after reading 3 s later, one quiet trim per start behind `zen.workspace.zentral.boost.startup_trim`; no `setInterval` | the reading is a real total instead of a guess, freeing memory closes nothing, and the single startup trim costs one GC/CC pass 90 s after input stops | not measured |
| `OW-90` | the sidebar cards: the `status` card (battery + memory, off by default) is removed and the new `boost` card replaces it — RAM number, click = Level 1, 4 s toast, inline menu; it reads nothing itself and has `refreshMs: 0` | one fewer card that sampled the platform on a five-minute cadence and, on a desktop, had no battery to show; the RAM number and the action that lowers it now sit in one card that is awake only while open | not measured |
