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
  assert.equal(h.window.gBrowser.selectedTab, other, "native selection of the Agenda tab is handed straight back to the site that was open");
  // The site being left is a pinned, unloaded tab (no \"safe content\" candidate exists): still never a blank page.
  other.setAttribute("pinned", "true"); other.setAttribute("pending", "true"); h.window.gBrowser.selectedTab = other; h.emit("TabSelect", other, {});
  ev("mousedown", tab); h.window.gBrowser.selectedTab = tab; h.emit("TabSelect", tab, { detail: { previousTab: null } }); h.fireTimer(0);
  assert.equal(h.window.gBrowser.selectedTab, other, "pointer origin wins even when it is a pinned or unloaded tab");
  other.removeAttribute("pinned"); other.removeAttribute("pending");
  ev("mousemove", tab, { clientX: 45 }); ev("mouseup", other, { clientX: 45 }); ev("click", other, { clientX: 45 }); await Promise.resolve();
  assert.equal(opens, 0, "drag and release elsewhere cancel activation");
  // Gecko/Zen can deliver the click after the mouseup task has returned.
  // A zero-delay gesture cleanup used to lose this first activation.
  ev("mousedown", tab);
  assert.equal(opens, 0, "Agenda does not open on press");
  ev("mouseup", tab);
  assert.equal(opens, 1, "the first physical release activates the Agenda entry");
  await new Promise(resolve => setImmediate(resolve));
  ev("click", tab); await Promise.resolve(); await Promise.resolve();
  assert.equal(opens, 1, "a late native click cannot activate the same entry twice");
  // A modified release is not an activation, and a delayed synthetic click
  // after the bounded cleanup must remain inert.
  ev("mousedown", tab); ev("mouseup", tab, { ctrlKey: true }); h.fireTimer(500); ev("click", tab);
  await Promise.resolve(); assert.equal(opens, 1, "a modified release cannot leak into a later stray click");
  const normalDown = ev("mousedown", other, { button: 1 });
  const normalUp = ev("mouseup", other, { button: 1 });
  const normalAux = ev("auxclick", other, { button: 1 });
  assert.equal(normalDown.defaultPrevented, false, "Agenda guards do not capture a normal tab's middle press");
  assert.equal(normalUp.defaultPrevented, false, "Agenda guards do not capture a normal tab's middle release");
  assert.equal(normalAux.defaultPrevented, false, "Agenda guards do not capture a normal tab's auxclick");
  const reused = h.window.gBrowser.addTab("https://reused.test/");
  reused.setAttribute(MARK, tab.getAttribute(MARK));
  reused._zentralNotesUrl = "about:blank#zn-agenda-" + encodeURIComponent(tab.getAttribute(MARK));
  for (const type of ["mousedown", "mouseup", "click"]) {
    const event = ev(type, reused);
    assert.equal(event.defaultPrevented, false, "a tab now showing a normal page is outside Agenda's pseudo-tab guards");
  }
  h.window.gBrowser.selectedTab = reused; h.emit("TabSelect", reused, { detail: { previousTab: other } });
  assert.equal(h.window.gBrowser.selectedTab, reused, "a normal tab carrying stale Agenda identity is not bounced");
  assert.equal(reused.hasAttribute(MARK), false, "stale Agenda marker is cleared from a reused normal tab");
  assert.equal(reused._zentralNotesUrl, undefined, "stale remembered Agenda URL is cleared from a reused normal tab");
  for (const modifier of ["ctrlKey", "shiftKey", "altKey", "metaKey"]) {
    ev("mousedown", tab, { [modifier]: true }); ev("mouseup", tab, { [modifier]: true }); const click = ev("click", tab, { [modifier]: true });
    assert.equal(click.defaultPrevented, false, `${modifier} remains available to the browser`);
  }
  await Promise.resolve(); assert.equal(opens, 1);
  assert.equal(ev("mousedown", tab, { button: 1 }).defaultPrevented, true); const middle = ev("auxclick", tab, { button: 1 }); assert.equal(middle.defaultPrevented, true); await Promise.resolve(); assert.equal(opens, 1);
  ev("mousedown", tab); ev("mousemove", tab, { clientY: 26 }); ev("mouseup", tab, { clientY: 26 }); ev("click", tab, { clientY: 26 }); await Promise.resolve(); assert.equal(opens, 1, "movement exceeding 4px cancels even on same tab");
  ev("mousedown", tab); ev("dragstart", tab); ev("mouseup", tab); ev("click", tab); await Promise.resolve(); assert.equal(opens, 1, "native dragstart cancels activation");
  ev("mousedown", tab); ev("mouseup", tab, { ctrlKey: true }); ev("click", tab); await Promise.resolve(); assert.equal(opens, 1, "a modifier applied before release cancels activation");
  ev("mousedown", tab, { ctrlKey: true }); ev("mouseup", tab); ev("click", tab); await Promise.resolve(); assert.equal(opens, 1, "a modifier applied on press cancels activation");
  ev("click", tab); await Promise.resolve(); assert.equal(opens, 1, "stray clicks cannot activate");
  // A modified release without click must not suppress a later keyboard activation.
  ev("mousedown", tab); ev("mouseup", tab, { ctrlKey: true }); h.fireTimer(500);
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
