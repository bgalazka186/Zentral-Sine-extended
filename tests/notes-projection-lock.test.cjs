"use strict";
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const NOTES_PREF = "zen.workspace.zentral.notes.zen_folder";
const AGENDA_PREF = "zen.workspace.zentral.notes.agenda_folder";
const NOTES_MARK = "bgalazka-notes-item";
const AGENDA_MARK = "bgalazka-notes-agenda-item";
const tab = (root, attr, value) => root.querySelectorAll("tab").find(node => node.getAttribute(attr) === value);
const root = (h, attr) => h.document.querySelector('zen-folder[' + attr + '="true"]');
const transfer = moved => ({
  dropEffect: "move",
  mozGetDataAt(type) { return type === "application/x-moz-tabbrowser-tab" ? moved : null; },
});

(async () => {
  const h = createFakeZen({ prefs: { [NOTES_PREF]: "all", [AGENDA_PREF]: true } });
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await Promise.resolve();

  const parentId = h.seam.store.addFolder("Projects");
  const nestedId = h.seam.store.addFolder("Nested", parentId);
  assert.ok(parentId && nestedId);
  const nestedKey = "f:" + h.seam.store.folderUid(nestedId);
  const note = h.seam.store.create("# Locked note", nestedId);
  const day1 = C.addDays(C.dayStart(Date.now()), 1);
  const day2 = C.addDays(day1, 1);
  h.seam.store.items.upsert(C.makeItem({ id: "locked-1", summary: "Locked reminder one", start: { dateTime: new Date(day1 + 12 * 3600000).toISOString() }, x: { kind: "reminder", src: "manual" } }));
  h.seam.store.items.upsert(C.makeItem({ id: "locked-2", summary: "Locked reminder two", start: { dateTime: new Date(day2 + 12 * 3600000).toISOString() }, x: { kind: "reminder", src: "manual" } }));
  await h.seam.store.flush();
  h.seam.zen.runNow();
  h.seam.agendaController.runNow();

  let notesRoot = root(h, "bgalazka-notes-folder");
  let agendaRoot = root(h, "bgalazka-notes-agenda-folder");
  assert.ok(notesRoot && agendaRoot);
  let noteTab = tab(notesRoot, NOTES_MARK, "n:" + note.id);
  let notesFolder = notesRoot.querySelectorAll("zen-folder").find(f => f.getAttribute("bgalazka-notes-subfolder") === nestedKey);
  let agendaTab = h.document.querySelectorAll("tab[" + AGENDA_MARK + "]").find(t => t.getAttribute(AGENDA_MARK).startsWith("item:"));
  let dayFolders = agendaRoot.querySelectorAll("zen-folder[bgalazka-notes-agenda-day]");
  assert.ok(noteTab && notesFolder && agendaTab && dayFolders.length >= 2);

  // Fake Notes tabs are inert pointers everywhere, not just while inside NOTES.
  const openedNotes = [];
  h.window.__zentralNotesTestSeam.onZenOpenNote = id => openedNotes.push(id);
  h.sidebar.pinned.append(noteTab);
  const movedClick = h.emit("mousedown", noteTab, { button: 0 });
  assert.equal(movedClick.defaultPrevented, true, "a misplaced Notes placeholder cannot navigate to about:blank");
  await Promise.resolve();
  assert.deepEqual(openedNotes, [note.id], "a moved marked tab still opens its model note");
  notesFolder.addTabs([noteTab]);

  const restoredUrl = "about:blank#zn-note:" + encodeURIComponent(note.id);
  const restoredCopy = h.window.gBrowser.addTab(restoredUrl);
  assert.equal(restoredCopy.isConnected, false, "a markerless zn-note URL tab is closed immediately on TabOpen");
  await Promise.resolve();
  assert.deepEqual(openedNotes, [note.id, note.id], "the markerless pseudo-URL resolves to its note id");
  delete h.window.__zentralNotesTestSeam.onZenOpenNote;

  const blocked = (type, target, moved = null, path = null) => {
    const event = h.emit(type, target, { dataTransfer: transfer(moved), ...(path ? { composedPath: () => path } : {}) });
    assert.equal(event.defaultPrevented, true, type + " must be cancelled");
    assert.equal(event.immediateStopped, true, type + " must not reach Zen's native move handler");
    if (type !== "dragstart") assert.equal(event.dataTransfer.dropEffect, "none");
    return event;
  };
  const foreign = h.window.gBrowser.addTab("https://outside.test/");
  for (const managed of [noteTab, notesRoot, notesFolder, agendaTab, agendaRoot, dayFolders[0]]) blocked("dragstart", managed);
  blocked("dragover", notesRoot);
  blocked("dragover", foreign, null, [foreign, notesRoot, h.document]);
  blocked("drop", notesFolder, foreign);
  blocked("drop", foreign, foreign, [foreign, notesFolder, notesRoot, h.document]);
  blocked("dragover", agendaRoot);
  blocked("drop", dayFolders[0], foreign);
  blocked("drop", foreign, noteTab);
  blocked("drop", foreign, agendaTab);
  foreign.multiselected = true;
  h.window.gBrowser.selectedTabs = [foreign, noteTab];
  blocked("dragstart", foreign);
  h.window.gBrowser.selectedTabs = [];
  foreign.multiselected = false;
  assert.equal(h.emit("dragstart", foreign, { dataTransfer: transfer(null) }).defaultPrevented, false, "ordinary tabs stay draggable");
  assert.equal(h.emit("drop", foreign, { dataTransfer: transfer(null) }).defaultPrevented, false, "ordinary drops outside managed folders stay untouched");

  // Reconciliation also repairs forced/native moves that bypass dragstart protection.
  const foreignInsideNotes = h.window.gBrowser.addTab("https://must-stay-out.test/");
  notesRoot.addTabs([foreignInsideNotes]);
  h.emit("TabMove", foreignInsideNotes);
  const foreignFolder = h.sidebar.folder("Foreign folder", { parent: notesRoot.querySelector(":scope > .tab-group-container") });
  const nestedForeignTab = h.window.gBrowser.addTab("https://nested-foreign.test/");
  foreignFolder.addTab(nestedForeignTab);
  h.emit("FolderGrouped", foreignFolder);
  h.seam.zen.runNow();
  assert.ok(!notesRoot.contains(foreignInsideNotes) && foreignInsideNotes.isConnected, "foreign tab is evacuated intact from NOTES");
  assert.ok(!notesRoot.contains(foreignFolder) && foreignFolder.isConnected && foreignFolder.contains(nestedForeignTab), "foreign folder subtree is evacuated intact from NOTES");

  const actualNoteText = h.seam.store.get(note.id).body;
  noteTab = tab(notesRoot, NOTES_MARK, "n:" + note.id);
  notesFolder = notesRoot.querySelectorAll("zen-folder").find(f => f.getAttribute("bgalazka-notes-subfolder") === nestedKey);
  assert.ok(noteTab && notesFolder);
  const otherNotesFolder = notesRoot.querySelectorAll("zen-folder").find(f => f !== notesFolder && f.hasAttribute("bgalazka-notes-subfolder"));
  if (otherNotesFolder) {
    otherNotesFolder.addTabs([noteTab]);
    h.emit("TabMove", noteTab);
    h.seam.zen.runNow();
    // A misplaced tab is retired immediately and recreated by the scheduled
    // reconciliation pass, matching Zen's async move/TabMove event ordering.
    h.fireTimer(0);
    await Promise.resolve();
    notesRoot = root(h, "bgalazka-notes-folder");
    noteTab = tab(notesRoot, NOTES_MARK, "n:" + note.id);
    notesFolder = notesRoot.querySelectorAll("zen-folder").find(f => f.getAttribute("bgalazka-notes-subfolder") === nestedKey);
    assert.ok(noteTab && noteTab.closest("zen-folder") === notesFolder, "a note tab moved to a different NOTES folder is rebuilt at its model parent");
  }

  // A folder dragged out of NOTES is retired as a projection and rebuilt from Notes metadata.
  notesFolder = notesRoot.querySelectorAll("zen-folder").find(f => f.getAttribute("bgalazka-notes-subfolder") === nestedKey);
  h.sidebar.pinned.append(notesFolder);
  h.emit("FolderUngrouped", notesFolder);
  h.seam.zen.runNow();
  notesRoot = root(h, "bgalazka-notes-folder");
  assert.ok(notesRoot.querySelectorAll("zen-folder").some(f => f.getAttribute("bgalazka-notes-subfolder") === nestedKey));
  assert.equal(h.seam.store.get(note.id).body, actualNoteText, "sidebar repair never changes note content");

  // A reminder tab moved out of Agenda is replaced from calendar.json.
  agendaRoot = root(h, "bgalazka-notes-agenda-folder");
  agendaTab = h.document.querySelectorAll("tab[" + AGENDA_MARK + "]").find(t => t.getAttribute("bgalazka-notes-agenda-item-id") === "locked-1");
  assert.ok(agendaTab);
  h.sidebar.pinned.append(agendaTab);
  h.emit("TabMove", agendaTab);
  h.seam.agendaController.runNow();
  agendaRoot = root(h, "bgalazka-notes-agenda-folder");
  assert.ok(agendaRoot.querySelectorAll("tab[" + AGENDA_MARK + "]").some(t => t.getAttribute("bgalazka-notes-agenda-item-id") === "locked-1"));

  // Day folders can never become one another's parents or escape the Agenda root.
  dayFolders = agendaRoot.querySelectorAll("zen-folder[bgalazka-notes-agenda-day]");
  const firstDay = dayFolders.find(f => f.getAttribute("bgalazka-notes-agenda-day") === C.localDateKey(day1));
  const secondDay = dayFolders.find(f => f.getAttribute("bgalazka-notes-agenda-day") === C.localDateKey(day2));
  assert.ok(firstDay && secondDay);
  secondDay.addFolder(firstDay);
  h.emit("FolderGrouped", firstDay);
  h.seam.agendaController.runNow();
  agendaRoot = root(h, "bgalazka-notes-agenda-folder");
  const repairedFirst = agendaRoot.querySelectorAll("zen-folder[bgalazka-notes-agenda-day]").find(f => f.getAttribute("bgalazka-notes-agenda-day") === C.localDateKey(day1));
  assert.ok(repairedFirst && repairedFirst.parentElement.closest("zen-folder") === agendaRoot, "day folder is restored as a direct child of Agenda");
  h.sidebar.pinned.append(repairedFirst);
  h.emit("FolderUngrouped", repairedFirst);
  h.seam.agendaController.runNow();
  agendaRoot = root(h, "bgalazka-notes-agenda-folder");
  assert.ok(agendaRoot.querySelectorAll("zen-folder[bgalazka-notes-agenda-day]").some(f => f.getAttribute("bgalazka-notes-agenda-day") === C.localDateKey(day1)), "day folder moved outside Agenda is recreated");

  h.resetOperations();
  h.seam.zen.runNow();
  h.seam.agendaController.runNow();
  assert.deepEqual(h.operations, [], "locked projections are idempotent after repair");
  await h.destroy();
  console.log("NOTES and AGENDA sidebar drag/move protection passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
