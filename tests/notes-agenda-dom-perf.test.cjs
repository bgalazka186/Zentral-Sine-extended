"use strict";
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { scaleBudget } = require("./helpers/perf-budget.cjs");
(async () => {
  for (const n of [50, 150]) {
    const h = createFakeZen({ prefs: { "zen.workspace.zentral.notes.agenda_folder": true } }); await h.seam.ensureStore(); h.fireTimer(6500); await Promise.resolve();
    const start = C.addDays(C.dayStart(Date.now()), 1) + 12 * 3600000;
    for (let i = 0; i < n; i++) h.seam.store.items.upsert(C.makeItem({ id: "perf-" + i, summary: "Item " + i, start: { dateTime: new Date(start + i * 1000).toISOString() }, x: { src: "manual", kind: "reminder" } }));
    h.seam.agendaController.runNow(); h.seam.agendaApi.list();
    const t = performance.now(); const entries = h.seam.agendaApi.list(); const ms = performance.now() - t;
    assert.equal(entries.filter(e => e.kind === "item").length, n); assert.ok(ms < scaleBudget(n === 50 ? 2000 : 6000), `Agenda DOM list ${n} took ${ms.toFixed(1)}ms`);
    console.log(`Agenda DOM list ${n}: ${ms.toFixed(1)}ms`);
    const day = entries.find(e => e.kind === "day").key;
    const keys = Array.from(entries.filter(e => e.kind === "item" && e.parent === day), e => e.key).reverse();
    const reorderStart = performance.now(); assert.equal(h.seam.agendaApi.reorder(day, keys), true); const reorderMs = performance.now() - reorderStart;
    assert.ok(reorderMs < scaleBudget(n === 50 ? 2000 : 6000), `Agenda reorder ${n} took ${reorderMs.toFixed(1)}ms`);
    console.log(`Agenda reorder ${n}: ${reorderMs.toFixed(1)}ms`);
    const nextSpace = h.addWorkspace("perf-space");
    const beforeSwitch = performance.now(); await h.switchWorkspace("perf-space"); const switchMs = performance.now() - beforeSwitch;
    assert.ok(nextSpace.element.querySelector('zen-folder[bgalazka-notes-agenda-folder="true"]'));
    assert.ok(switchMs < scaleBudget(n === 50 ? 2000 : 6000), `Agenda space switch ${n} took ${switchMs.toFixed(1)}ms`);
    console.log(`Agenda space switch ${n}: ${switchMs.toFixed(1)}ms`); await h.destroy();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
