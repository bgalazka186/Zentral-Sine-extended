"use strict";
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const NOTES_PREF = "zen.workspace.zentral.notes.zen_folder";
const AGENDA_PREF = "zen.workspace.zentral.notes.agenda_folder";

(async () => {
  const h = createFakeZen({ prefs: { [NOTES_PREF]: "all", [AGENDA_PREF]: true } });
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await Promise.resolve();

  const note = h.seam.store.create("# A linked reminder note", "");
  h.seam.zen.runNow(); // materialize the NOTES root before the inherited-folder routing case
  const routes = [], opened = [];
  h.window.__zentralNotesTestSeam.onPseudoNavigation = route => routes.push(route);
  h.window.__zentralNotesTestSeam.onAgendaOpenNote = (id, key) => opened.push({ id, key });

  const noteTab = h.window.gBrowser.addTab("about:blank#zn-note:" + encodeURIComponent(note.id));
  assert.equal(noteTab.isConnected, false, "zn-note navigation tab is closed during TabOpen");
  const inheritedFolderTab = h.window.gBrowser.addTab("about:blank#zn-note:" + encodeURIComponent(note.id), { deferTabOpen: true });
  const notesRoot = h.document.querySelector('zen-folder[bgalazka-notes-folder="true"]');
  assert.ok(notesRoot);
  notesRoot.addTabs([inheritedFolderTab]);
  h.emit("TabOpen", inheritedFolderTab);
  assert.equal(inheritedFolderTab.isConnected, false, "a new URL tab is routed even if Zen initially inserts it into NOTES");
  assert.equal(JSON.stringify(routes), JSON.stringify([{ kind: "note", noteId: note.id }]), "zn-note is routed to its note identity");

  const start = C.addDays(C.dayStart(Date.now()), 1) + 12 * 3600000;
  const item = h.seam.store.items.upsert(C.makeItem({
    id: "linked-reminder",
    summary: "Reminder with note",
    start: { dateTime: new Date(start).toISOString() },
    x: { src: "manual", kind: "reminder", noteId: note.id, heading: "Reminder heading" },
  }));
  assert.ok(item);
  await h.seam.store.items.flush();
  h.seam.agendaController.runNow();
  const entry = h.seam.agendaController.projection.flatMap(day => day.items || []).find(value => value.itemId === item.id);
  assert.ok(entry, "the linked reminder is projected into Agenda");

  const agendaUrl = "about:blank#zn-agenda-" + encodeURIComponent(entry.key);
  const agendaTab = h.window.gBrowser.addTab(agendaUrl);
  assert.equal(agendaTab.isConnected, false, "zn-agenda-item navigation tab is closed during TabOpen");
  assert.equal(JSON.stringify(routes[1]), JSON.stringify({ kind: "agenda", key: entry.key }), "Agenda URL is decoded as its item key");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(opened[0]), JSON.stringify({ id: note.id, key: entry.key }), "Agenda URL opens the note linked to the reminder");

  await h.destroy();
  console.log("pseudo-tab navigation routes zn-note and zn-agenda-item URLs to their model targets");
})().catch(error => { console.error(error); process.exitCode = 1; });
