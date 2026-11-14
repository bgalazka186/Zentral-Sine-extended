"use strict";
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const PREF = "zen.workspace.zentral.notes.agenda_folder", MARK = "bgalazka-notes-agenda-item";
(async () => {
  const h = createFakeZen({ prefs: { [PREF]: true } });
  await h.seam.ensureStore(); h.fireTimer(6500); await Promise.resolve();
  const note = h.seam.store.create("Source note");
  h.seam.store.items.upsert(C.makeItem({ id: "click", summary: "Click test", start: { dateTime: new Date(C.addDays(C.dayStart(Date.now()), 1) + 12 * 3600000).toISOString() }, x: { src: "manual", kind: "reminder", noteId: note.id } }));
  h.seam.agendaController.runNow();
  const tab = h.document.querySelectorAll(`tab[${MARK}]`).find(t => t.getAttribute("bgalazka-notes-agenda-record-id") === "click"); assert.ok(tab);
  const other = h.window.gBrowser.addTab("https://example.test/"); h.window.gBrowser.selectedTab = other;
  let opens = 0; h.window.__zentralNotesTestSeam.onAgendaActivate = () => { opens++; };
  const ev = (type, target, extra = {}) => h.emit(type, target, { button: 0, clientX: 20, clientY: 20, ...extra });
  const press = ev("mousedown", tab); assert.equal(press.defaultPrevented, false, "press must not prevent native dragging"); assert.equal(opens, 0);
  // Native selection can occur on mousedown: it must not trigger early opening.
  h.window.gBrowser.selectedTab = tab; h.emit("TabSelect", tab, { detail: { previousTab: other } }); h.fireTimer(0); await Promise.resolve();
  assert.equal(opens, 0, "native selection during pointer gesture must not open on press");
  ev("mousemove", tab, { clientX: 45 }); ev("mouseup", other, { clientX: 45 }); ev("click", other, { clientX: 45 }); await Promise.resolve();
  assert.equal(opens, 0, "drag and release elsewhere cancel activation");
  ev("mousedown", tab); ev("mouseup", tab); ev("click", tab); await Promise.resolve(); await Promise.resolve();
  assert.equal(opens, 1, "plain click opens exactly once");
  for (const modifier of ["ctrlKey", "shiftKey", "altKey", "metaKey"]) {
    ev("mousedown", tab, { [modifier]: true }); ev("mouseup", tab, { [modifier]: true }); const click = ev("click", tab, { [modifier]: true });
    assert.equal(click.defaultPrevented, false, `${modifier} remains available to the browser`);
  }
  await Promise.resolve(); assert.equal(opens, 1);
  assert.equal(ev("mousedown", tab, { button: 1 }).defaultPrevented, true); const middle = ev("auxclick", tab, { button: 1 }); assert.equal(middle.defaultPrevented, true); await Promise.resolve(); assert.equal(opens, 1);
  ev("mousedown", tab); ev("mousemove", tab, { clientY: 26 }); ev("mouseup", tab, { clientY: 26 }); ev("click", tab, { clientY: 26 }); await Promise.resolve(); assert.equal(opens, 1, "movement exceeding 4px cancels even on same tab");
  ev("mousedown", tab); ev("dragstart", tab); ev("mouseup", tab); ev("click", tab); await Promise.resolve(); assert.equal(opens, 1, "native dragstart cancels activation");
  ev("mousedown", tab); ev("mouseup", tab); ev("click", tab, { ctrlKey: true }); await Promise.resolve(); assert.equal(opens, 1, "a modifier applied during the gesture cancels activation");
  ev("click", tab); await Promise.resolve(); assert.equal(opens, 1, "stray clicks cannot activate");
  // A release without click must not suppress a later keyboard activation.
  ev("mousedown", tab); ev("mouseup", tab); h.fireTimer(0);
  // UI4.2: tab cycling and programmatic selection bounce silently; only a
  // direct unmodified Enter or Space on the pseudo-tab is activation intent.
  h.window.gBrowser.selectedTab = tab; h.emit("TabSelect", tab, { detail: { previousTab: other } }); h.fireTimer(0); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.window.gBrowser.selectedTab, other); assert.equal(opens, 1, "tab cycling does not open Notes");
  const enter = ev("keydown", tab, { key: "Enter" }); await Promise.resolve(); assert.equal(enter.defaultPrevented, true); assert.equal(opens, 2, "Enter activates intentionally");
  const space = ev("keydown", tab, { key: " " }); await Promise.resolve(); assert.equal(space.defaultPrevented, true); assert.equal(opens, 3, "Space activates intentionally");
  const modifiedKey = ev("keydown", tab, { key: "Enter", ctrlKey: true }); await Promise.resolve(); assert.equal(modifiedKey.defaultPrevented, false); assert.equal(opens, 3);
  const repeatKey = ev("keydown", tab, { key: "Enter", repeat: true }); await Promise.resolve(); assert.equal(repeatKey.defaultPrevented, true); assert.equal(opens, 3, "held activation keys do not repeat");
  assert.equal(ev("keydown", other, { key: "Enter" }).defaultPrevented, false, "foreign tabs are untouched");
  h.setPref(PREF, false); assert.equal(ev("keydown", tab, { key: "Enter" }).defaultPrevented, false); await Promise.resolve(); assert.equal(opens, 3, "disabled Agenda does not activate");
  await h.destroy(); console.log("Agenda click release tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
