"use strict";
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
(async () => {
  const host = createFakeZen({ prefs: { "zen.workspace.zentral.notes.agenda_folder": true } });
  try {
    await host.seam.ensureStore(); const store = host.seam.store, controller = host.seam.agendaController;
    const original = controller.schedule; let calls = 0;
    controller.schedule = (...args) => { calls++; return original(...args); };
    const unrelated = store.create("Unrelated\nBody"); calls = 0;
    store.update(unrelated.id, "Unrelated\nChanged body");
    assert.equal(calls, 0, "unrelated note edits should not schedule the Agenda");
    store.trash(unrelated.id); assert.equal(calls, 0, "unrelated trash should not schedule the Agenda");
    const linked = store.create("Linked title\nBody");
    store.items.upsert(C.makeItem({ id: "linked-item", summary: "Event", start: { dateTime: new Date(Date.now() + 86400000).toISOString() }, x: { kind: "reminder", src: "manual", noteId: linked.id } }, Date.now()));
    calls = 0; store.update(linked.id, "New title\nBody"); assert.ok(calls > 0, "linked note title edits schedule the Agenda");
    calls = 0; store.trash(linked.id); assert.ok(calls > 0, "trash of a linked note schedules the Agenda");
    calls = 0; store.restore(linked.id); assert.ok(calls > 0, "restore of a linked note schedules the Agenda");
    calls = 0; store.addFolder("a-test-folder"); assert.ok(calls > 0, "tree events remain unconditional");
  } finally { await host.destroy(); }
  console.log("Agenda note filtering passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
