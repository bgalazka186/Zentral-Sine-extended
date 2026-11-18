# Perf results (RAM plan `OW-87`–`OW-94`)

Source: `docs/PLAN_CODING_AGENT.md` (the owner's own measurements, 2026-11-18). One line per task, appended when the
task ships. **The owner measures effect on his machine; every figure here is "not measured" until he does.** The
point of this file is that a later session can see what changed and what it was expected to do — never a number
nobody took.

| Task | What changed | Expected effect | Measured |
| :--- | :----------- | :-------------- | :------- |
| `OW-87` | `zen.workspace.zentral.debug.core` defaults to `false` in the schema, the preset and Core's fallback table; the logger honours the pref instead of hardcoding the core category on; the settings switch reads and writes it | a fresh install collects no debug lines by default, so the logger does no string work for them | not measured |
