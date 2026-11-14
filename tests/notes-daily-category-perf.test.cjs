"use strict";
// Production-shaped note-to-calendar synchronization with an existing store;
// generous ceilings catch accidental per-item rescans in this hot path.
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const C = require(process.env.CALENDAR_BENCH_MODULE || "../additional/notes/calendar/ZentralNotesCalendar.js");
const now = Date.parse("2026-11-13T12:00:00Z");
const io = { join: (...p) => p.join("/"), exists: async () => false, readUTF8: async () => { throw Error("not found"); }, writeUTF8: async () => {} };
(async () => {
  for (const n of [500, 2000]) {
    const st = C.createItemStore({ io, getDir: () => "/n", now: () => now, setTimer: () => 1, clearTimer() {} });
    await st.open();
    const body = "# 2026-11-20\n## Agenda\n%%calendar: Work%%\n" + Array.from({ length: n }, (_, i) => `- [ ] 2026-11-20 09:00-10:00 Event ${i} %%zn-item-id:row${String(i).padStart(5, "0")}%%${i % 2 ? " %%zn-item-category: Personal%%" : ""}`).join("\n");
    st.syncNote("daily", body, { updatedAt: now });
    assert.equal(st.list({ noteId: "daily" }).length, n);
    const begin = performance.now(); st.syncNote("daily", body + "\nA harmless note edit\n", { sourceEdit: true, updatedAt: now + 1 });
    const ms = performance.now() - begin, ceiling = n === 500 ? 2000 : 7000;
    console.log(`dailySync${n}: ${ms.toFixed(1)} ms (ceiling ${ceiling} ms)`);
    assert.ok(ms < ceiling, `dailySync${n} exceeded budget`);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
