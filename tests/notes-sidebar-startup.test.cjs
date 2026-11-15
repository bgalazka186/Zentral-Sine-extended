"use strict";
/* SB6.8: the guards of our sidebar placeholders exist from the first moment of a window.
 *
 * A Notes or Agenda entry in the Zen sidebar is a pinned `about:blank#zn-…` tab. Session restore brings those tabs back
 * before any timer of Notes has run, but the listeners that make a click open the note (and keep the tab from being
 * selected, dragged or closed) were bound by the boot timers, 6 and 6.5 seconds later. In between, a click showed a
 * blank page. A second fault sat next to it: an event on a restored tab asked for an immediate projection run, the notes
 * were not loaded yet, so "nothing loaded" was read as "nothing exists" and the restored entries were removed, to be
 * created again when the boot timer fired.
 *
 * Contract: guards at startup; projections never before the notes are loaded; writes wait for the store.
 */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const AGENDA = "zen.workspace.zentral.notes.agenda_folder", NOTES = "zen.workspace.zentral.notes.zen_folder";
const AGENDA_MARK = "bgalazka-notes-agenda-item", NOTES_MARK = "bgalazka-notes-item";
const settle = async (turns = 8) => { for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve)); };
const at = { button: 0, clientX: 20, clientY: 20 };
const urlOf = (tab) => tab.linkedBrowser?.currentURI?.spec || "";
// Compare elements with `same`, never with assert.equal: a failure would make Node print the whole fake DOM.
const same = (actual, expected, message) => assert.ok(actual === expected, message);
// Fires every pending timer of that delay. Bounded, so a timer that re-arms itself fails the test instead of hanging it.
async function drain(h, ms) {
  for (let fired = 0; h.fireTimer(ms); fired++) { assert.ok(fired < 50, `timers of ${ms} ms keep re-arming`); await settle(1); }
}
async function test(name, run) { await run(); console.log("ok - " + name); }

// A first session writes real note files and shows what the sidebar looked like when the browser was closed.
async function firstSession() {
  const files = new Map();
  const h = createFakeZen({ prefs: { [AGENDA]: true, [NOTES]: "all" }, files });
  await h.seam.ensureStore(); h.fireTimer(6000); h.fireTimer(6500); await settle(2);
  const note = h.seam.store.create("Source note"), other = h.seam.store.create("Other note");
  const start = C.addDays(C.dayStart(Date.now()), 1) + 12 * 3600000;
  h.seam.store.items.upsert(C.makeItem({ id: "call", summary: "Call back", start: { dateTime: new Date(start).toISOString() }, x: { src: "manual", kind: "reminder", noteId: note.id } }));
  h.seam.zen.runNow(); h.seam.agendaController.runNow();
  await h.seam.store.flush();
  const folder = (selector) => { const el = h.document.querySelector(selector); return { id: el.id, label: el.getAttribute("label") }; };
  const session = {
    files, noteId: note.id, otherId: other.id, dayKey: C.localDateKey(start),
    notesRoot: folder('zen-folder[bgalazka-notes-folder="true"]'),
    agendaRoot: folder('zen-folder[bgalazka-notes-agenda-folder="true"]'),
    agendaDay: folder("zen-folder[bgalazka-notes-agenda-day]"),
    noteUrls: h.document.querySelectorAll(`tab[${NOTES_MARK}]`).map(urlOf).filter((url) => /zn-note:/.test(url)),
    agendaUrl: urlOf(h.document.querySelectorAll(`tab[${AGENDA_MARK}]`).find((tab) => tab.getAttribute(AGENDA_MARK).startsWith("item:"))),
  };
  assert.equal(session.noteUrls.length, 2); assert.match(session.agendaUrl, /^about:blank#zn-agenda-item/);
  await h.destroy();
  return session;
}

// The next start of the browser: same files, and session restore rebuilds the folders (their ids persist) and the pinned
// placeholder tabs (their URL persists, none of our attributes do). Nothing of Notes has run except its start-up code.
function restoredWindow(session, prefs, { notes = true, agenda = true } = {}) {
  const h = createFakeZen({ prefs, files: session.files, id: "restored" });
  const site = h.window.gBrowser.addTab("https://example.test/"); h.window.gBrowser.selectedTab = site;
  const out = { h, site, noteTabs: [], agendaTab: null, notesRoot: null, agendaRoot: null, agendaDay: null };
  if (notes) {
    out.noteTabs = session.noteUrls.map((url) => h.window.gBrowser.addTab(url, { deferTabOpen: true }));
    out.notesRoot = h.window.gZenFolders.createFolder(out.noteTabs, { id: session.notesRoot.id, label: session.notesRoot.label });
  }
  if (agenda) {
    out.agendaTab = h.window.gBrowser.addTab(session.agendaUrl, { deferTabOpen: true });
    out.agendaDay = h.window.gZenFolders.createFolder([out.agendaTab], { id: session.agendaDay.id, label: session.agendaDay.label });
    const seed = h.window.gBrowser.addTab("about:blank", { deferTabOpen: true });
    out.agendaRoot = h.window.gZenFolders.createFolder([seed], { id: session.agendaRoot.id, label: session.agendaRoot.label });
    out.agendaRoot.addFolder(out.agendaDay); seed.remove();
  }
  for (const tab of [...out.noteTabs, out.agendaTab].filter(Boolean)) h.emit("SSTabRestored", tab);
  out.noteTab = out.noteTabs.find((tab) => urlOf(tab).endsWith(session.noteId)) || null;
  out.ev = (type, target, extra = {}) => h.emit(type, target, { ...at, ...extra });
  out.sheet = () => h.document.querySelector(".zentral-notes-sheet");
  out.editorText = () => out.sheet()?.querySelector("textarea")?.value;
  // The boot timers of this file, in their real order, then the debounced projection runs.
  out.boot = async () => {
    h.fireTimer(4000); await settle(); // reminders open the store
    h.fireTimer(6000); h.fireTimer(6500); await settle();
    await drain(h, 250);
  };
  return out;
}
const structural = (h) => h.operations.filter((op) => op.type === "add" || op.type === "remove");

(async () => {
  const session = await firstSession();

  await test("a click on a restored Agenda entry before the boot timer opens its note, never a blank page", async () => {
    const w = restoredWindow(session, { [AGENDA]: true }, { notes: false }), { h, agendaTab, site } = w;
    assert.deepEqual([...h.timers.values()].map((timer) => timer.ms).filter((ms) => ms === 6500), [6500], "the boot timer has not fired");
    let activations = 0; h.window.__zentralNotesTestSeam.onAgendaActivate = () => { activations++; };
    const down = w.ev("mousedown", agendaTab);
    assert.equal(down.defaultPrevented, false, "the press itself stays native (a drag may start from it)");
    const up = w.ev("mouseup", agendaTab);
    assert.equal(up.defaultPrevented, true, "the release is ours: the browser must not select the blank placeholder");
    assert.equal(activations, 1, "one activation");
    const click = w.ev("click", agendaTab);
    assert.equal(click.defaultPrevented, true, "the click that follows is swallowed");
    assert.equal(activations, 1, "and does not activate twice");
    same(h.window.gBrowser.selectedTab, site, "the site the person was on stays selected");
    await settle();
    assert.equal(w.sheet()?.hidden, false, "Notes opens: the activation loaded the notes itself, without waiting for a timer");
    assert.equal(w.editorText(), "Source note", "on the note of that reminder");
    await h.destroy();
  });

  await test("keyboard, selection, drag and right-click on a restored Agenda entry are guarded before the boot timer", async () => {
    const w = restoredWindow(session, { [AGENDA]: true }, { notes: false }), { h, agendaTab, site } = w;
    let activations = 0; h.window.__zentralNotesTestSeam.onAgendaActivate = () => { activations++; };
    const enter = h.emit("keydown", agendaTab, { key: "Enter" });
    assert.equal(enter.defaultPrevented, true, "Enter on the entry is ours");
    assert.equal(activations, 1);
    // Selection that did not come from the mouse (keyboard tab switching, a script) is handed straight back.
    h.window.gBrowser.selectedTab = agendaTab; h.emit("TabSelect", agendaTab, { detail: { previousTab: site } });
    await drain(h, 0);
    same(h.window.gBrowser.selectedTab, site, "the blank placeholder does not stay selected");
    const drag = h.emit("dragstart", agendaTab, { dataTransfer: { dropEffect: "move" } });
    assert.equal(drag.defaultPrevented, true, "the entry cannot be dragged out of the Agenda");
    const menu = h.document.createXULElement("menupopup"); menu.id = "tabContextMenu"; h.document.body.append(menu);
    h.window.TabContextMenu = { contextTab: agendaTab }; h.emit("popupshowing", menu);
    assert.equal(h.document.documentElement.getAttribute("zentral-agenda-ctx"), "item", "its right-click menu is ours, not the native tab menu");
    await h.destroy();
  });

  await test("restored Agenda entries stay in place until the notes are loaded, then the projection adopts them", async () => {
    const w = restoredWindow(session, { [AGENDA]: true }, { notes: false }), { h, agendaTab, agendaRoot, agendaDay } = w;
    // Browser-side events on the restored tab ask for an immediate repair run. The notes are not loaded.
    h.emit("TabMove", agendaTab); h.emit("TabPinned", agendaTab);
    h.resetOperations();
    await drain(h, 0);
    assert.equal(structural(h).length, 0, "nothing is removed or created while nothing is known");
    assert.ok(agendaTab.isConnected && agendaDay.isConnected && agendaRoot.isConnected, "the restored folder, day and entry are untouched");
    assert.equal(h.seam.store.list().length, 0, "the notes were indeed not loaded: nobody needed them yet");
    await w.boot();
    assert.ok(agendaTab.isConnected && agendaDay.isConnected && agendaRoot.isConnected, "the first real run keeps the restored elements");
    assert.deepEqual(structural(h).map((op) => op.type + " " + op.node.localName), [], "and performs no structural operation");
    assert.equal(h.document.querySelectorAll(`tab[${AGENDA_MARK}]`).length, 1, "one entry, no duplicate");
    assert.match(agendaTab.getAttribute("label"), /^12:00\s+Call back$/, "the entry has its label again");
    assert.equal(agendaDay.getAttribute("bgalazka-notes-agenda-day"), session.dayKey);
    await h.destroy();
  });

  await test("a click on a restored note entry before the boot timer opens the note", async () => {
    const w = restoredWindow(session, { [NOTES]: "all" }, { agenda: false }), { h, noteTab, site } = w;
    assert.deepEqual([...h.timers.values()].map((timer) => timer.ms).filter((ms) => ms === 6000), [6000], "the boot timer has not fired");
    const activated = [], opened = [];
    h.window.__zentralNotesTestSeam.onZenActivate = (tab) => activated.push(tab);
    h.window.__zentralNotesTestSeam.onZenOpenNote = (id) => opened.push(id);
    const down = w.ev("mousedown", noteTab);
    assert.equal(down.defaultPrevented, true, "the press is ours: the browser must not select the blank placeholder");
    assert.ok(activated.length === 1 && activated[0] === noteTab, "one activation, of that entry");
    for (const type of ["mouseup", "click"]) assert.equal(w.ev(type, noteTab).defaultPrevented, true, type + " is swallowed");
    assert.equal(w.ev("auxclick", noteTab, { button: 1 }).defaultPrevented, true, "a middle click cannot close the entry");
    assert.equal(activated.length, 1, "still one activation");
    same(h.window.gBrowser.selectedTab, site, "the site the person was on stays selected");
    await settle();
    assert.deepEqual(opened, [session.noteId], "the activation loaded the notes itself and opened the right one");
    assert.equal(w.editorText(), "Source note");
    await h.destroy();
  });

  await test("selection, drag and right-click on a restored note entry are guarded before the boot timer", async () => {
    const w = restoredWindow(session, { [NOTES]: "all" }, { agenda: false }), { h, noteTab, site } = w;
    h.window.gBrowser.selectedTab = noteTab; h.emit("TabSelect", noteTab, { detail: { previousTab: site } });
    await drain(h, 0);
    same(h.window.gBrowser.selectedTab, site, "the blank placeholder does not stay selected");
    const drag = h.emit("dragstart", noteTab, { dataTransfer: { dropEffect: "move" } });
    assert.equal(drag.defaultPrevented, true, "the entry cannot be dragged out of NOTES");
    const menu = h.document.createXULElement("menupopup"); menu.id = "tabContextMenu"; h.document.body.append(menu);
    h.window.TabContextMenu = { contextTab: noteTab }; h.emit("popupshowing", menu);
    assert.equal(h.document.documentElement.getAttribute("zentral-notes-ctx"), "item", "its right-click menu is ours");
    assert.deepEqual(menu.querySelectorAll("[zentral-notes-own]").map((row) => row.getAttribute("label")), ["Open note", "Remove from sidebar folder", "Move note to trash"]);
    await h.destroy();
  });

  await test("restored note entries stay in place until the notes are loaded, and early events do not use up the repair allowance", async () => {
    const w = restoredWindow(session, { [NOTES]: "all" }, { agenda: false }), { h, noteTabs, noteTab, notesRoot } = w;
    // Session restore moves and pins every tab; with many notes that is far more than the 12 repair requests a minute
    // that the projection accepts from the browser side.
    for (let i = 0; i < 10; i++) for (const tab of noteTabs) { h.emit("TabMove", tab); h.emit("TabPinned", tab); }
    h.resetOperations();
    await drain(h, 0);
    assert.equal(structural(h).length, 0, "nothing is removed or created while nothing is known");
    assert.ok(noteTabs.every((tab) => tab.isConnected) && notesRoot.isConnected, "the restored folder and entries are untouched");
    await w.boot();
    assert.ok(noteTabs.every((tab) => tab.isConnected) && notesRoot.isConnected, "the first real run keeps the restored elements");
    assert.deepEqual(structural(h).map((op) => op.type + " " + op.node.localName), [], "and performs no structural operation");
    assert.deepEqual(noteTabs.map((tab) => tab.getAttribute("label")).sort(), ["Other note", "Source note"], "the entries have their labels again");
    // Half a minute later the person closes an entry by accident: the repair request must still be honoured.
    h.advanceClock(30000);
    h.window.gBrowser.removeTab(noteTab);
    assert.equal(noteTab.isConnected, false);
    assert.equal(h.fireTimer(0), true, "the close asked for an immediate repair");
    const back = h.document.querySelectorAll(`tab[${NOTES_MARK}]`).find((tab) => tab.getAttribute(NOTES_MARK) === "n:" + session.noteId);
    assert.ok(back && back !== noteTab, "the entry is back");
    await h.destroy();
  });

  await test("anything that writes waits for the notes: a tab dropped on NOTES before they are loaded becomes a note that survives", async () => {
    const w = restoredWindow(session, { [NOTES]: "all" }, { agenda: false }), { h, notesRoot, site } = w;
    const dataTransfer = { dropEffect: "move", mozGetDataAt: (type) => (type === "application/x-moz-tabbrowser-tab" ? site : null) };
    site.label = "Example page"; site.setAttribute("label", "Example page");
    const drop = h.emit("drop", notesRoot, { dataTransfer });
    assert.equal(drop.defaultPrevented, true, "the drop is ours: the web tab must not be filed inside NOTES");
    assert.ok(!site.closest("zen-folder"), "the web tab stays where it was");
    // The same for "New note in this folder" in the right-click menu of the restored NOTES folder.
    const menu = h.document.createXULElement("menupopup"); menu.id = "zenFolderActions"; menu.triggerNode = notesRoot; h.document.body.append(menu);
    h.emit("popupshowing", menu);
    const newNote = menu.querySelectorAll("[zentral-notes-folder-own]").find((row) => row.getAttribute("zentral-notes-folder-own") === "new");
    assert.equal(newNote?.getAttribute("label"), "New note in this folder", "the folder menu is ours before the boot timer");
    newNote.dispatchEvent(new h.Ev("command", { bubbles: true }));
    assert.equal(h.seam.store.list().length, 0, "nothing is created in a store that has not read its folder yet");
    await w.boot();
    const bodies = h.seam.store.list().map((note) => note.body);
    assert.equal(bodies.filter((body) => body.includes("https://example.test/")).length, 1, "the captured page is a note after loading: " + JSON.stringify(bodies));
    assert.equal(bodies.filter((body) => body === "").length, 1, "and so is the new empty note: " + JSON.stringify(bodies));
    assert.ok(bodies.includes("Source note") && bodies.includes("Other note"), "next to the notes that were on disk");
    assert.equal(bodies.length, 4);
    await h.destroy();
  });

  await test("a menu command chosen before the notes are loaded is carried out once they are", async () => {
    // Mode "selected": only the notes of the sidebar folder are shown, and their menu can take one out again.
    const files = new Map();
    const first = createFakeZen({ prefs: { [NOTES]: "selected" }, files });
    await first.seam.ensureStore(); first.fireTimer(6000); await settle(2);
    const kept = first.seam.store.create("Stays in the sidebar", first.seam.store.ensureTabbarFolder());
    const leaving = first.seam.store.create("Leaves the sidebar", first.seam.store.ensureTabbarFolder());
    first.seam.zen.runNow(); await first.seam.store.flush();
    const urls = first.document.querySelectorAll(`tab[${NOTES_MARK}]`).map(urlOf).filter((url) => /zn-note:/.test(url));
    const rootEl = first.document.querySelector('zen-folder[bgalazka-notes-folder="true"]'), rootId = rootEl.id, rootLabel = rootEl.getAttribute("label");
    assert.equal(urls.length, 2);
    await first.destroy();

    const h = createFakeZen({ prefs: { [NOTES]: "selected" }, files, id: "restored-selected" });
    const tabs = urls.map((url) => h.window.gBrowser.addTab(url, { deferTabOpen: true }));
    h.window.gZenFolders.createFolder(tabs, { id: rootId, label: rootLabel });
    for (const tab of tabs) h.emit("SSTabRestored", tab);
    const menu = h.document.createXULElement("menupopup"); menu.id = "tabContextMenu"; h.document.body.append(menu);
    h.window.TabContextMenu = { contextTab: tabs.find((tab) => urlOf(tab).endsWith(leaving.id)) }; h.emit("popupshowing", menu);
    menu.querySelectorAll("[zentral-notes-own]").find((row) => row.getAttribute("zentral-notes-own") === "out").dispatchEvent(new h.Ev("command", { bubbles: true }));
    assert.equal(h.seam.store.list().length, 0, "the notes are not loaded yet");
    h.fireTimer(4000); await settle(); h.fireTimer(6000); await settle(); await drain(h, 0); await drain(h, 250);
    assert.equal(h.seam.store.get(leaving.id).folder, "", "the note left the sidebar folder");
    assert.notEqual(h.seam.store.get(kept.id).folder, "", "the other note stayed");
    const shown = h.document.querySelectorAll(`tab[${NOTES_MARK}]`).map((tab) => tab.getAttribute(NOTES_MARK));
    assert.ok(shown.includes("n:" + kept.id) && !shown.includes("n:" + leaving.id), "and the sidebar shows it: " + JSON.stringify(shown));
    await h.destroy();
  });

  await test("a feature that is off binds nothing; switching it on later binds once", async () => {
    const off = createFakeZen({ prefs: {} });
    const idle = Object.fromEntries(["dragover", "drop", "mousemove", "auxclick"].map((type) => [type, off.listenerCount(type)]));
    assert.deepEqual(idle, { dragover: 0, drop: 0, mousemove: 0, auxclick: 0 }, "no sidebar guard listens while both projections are off");
    const agendaOn = createFakeZen({ prefs: { [AGENDA]: true } });
    assert.equal(agendaOn.listenerCount("dragover"), 1, "Agenda on: its drag guard exists at startup");
    assert.equal(agendaOn.listenerCount("mousemove"), 1);
    const notesOn = createFakeZen({ prefs: { [NOTES]: "all" } });
    assert.equal(notesOn.listenerCount("dragover"), 1, "NOTES on: its drag guard exists at startup");
    assert.equal(notesOn.listenerCount("mousemove"), 0, "and only its own");
    const both = createFakeZen({ prefs: { [AGENDA]: true, [NOTES]: "all" } });
    assert.equal(both.listenerCount("dragover"), 2);
    // The boot timers and a later preference change go through the same idempotent bind.
    await both.seam.ensureStore(); both.fireTimer(6000); both.fireTimer(6500); await settle(2);
    assert.equal(both.listenerCount("dragover"), 2, "the boot timers do not bind a second time");
    off.setPref(AGENDA, true); await settle(2);
    assert.equal(off.listenerCount("dragover"), 1, "switching Agenda on binds it");
    off.setPref(AGENDA, false); await settle(2);
    assert.equal(off.listenerCount("dragover"), 0, "switching it off unbinds it");
    for (const h of [off, agendaOn, notesOn, both]) await h.destroy();
    assert.equal(both.listenerCount("dragover"), 0, "closing the window removes every guard");
  });

  console.log("sidebar startup guard tests passed");
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
