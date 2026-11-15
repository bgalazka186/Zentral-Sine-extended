"use strict";
/* The right-click menu of a note in the Zen sidebar folder: Open note, Remove from sidebar folder, Move note to trash.
 * "Move note to trash" called three names that only exist inside the Notes sheet, so it threw and did nothing.
 * It now follows the rule of the Notes list: a note without reminders goes to Trash at once, a note with reminders
 * asks first, and a sheet that is showing the note moves on to another one. */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const MODE = "zen.workspace.zentral.notes.zen_folder";
const settle = async (turns = 8) => { for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve)); };

(async () => {
  const h = createFakeZen({ prefs: { [MODE]: "all" } });
  await h.seam.ensureStore(); h.fireTimer(6000); await settle(2);
  const store = h.seam.store;
  const plain = store.create("Plain note"), linked = store.create("Note with a reminder"), shown = store.create("Shown note"), kept = store.create("Kept note");
  store.items.upsert(C.makeItem({ id: "linked-reminder", summary: "Linked", start: { dateTime: new Date(Date.now() + 86400000).toISOString() }, x: { src: "manual", kind: "reminder", noteId: linked.id } }));
  h.seam.zen.runNow();
  const entryOf = (note) => h.document.querySelectorAll("tab").find((tab) => (tab.linkedBrowser?.currentURI?.spec || "").endsWith("zn-note:" + note.id));
  const sheet = () => h.document.querySelector(".zentral-notes-sheet");
  const sheetOpen = () => !!sheet() && !sheet().hidden;
  const editorText = () => sheet().querySelector("textarea").value;
  const rows = (note) => {
    h.document.getElementById("tabContextMenu")?.remove();
    const menu = h.document.createXULElement("menupopup"); menu.id = "tabContextMenu"; h.document.body.append(menu);
    h.window.TabContextMenu = { contextTab: entryOf(note) }; h.emit("popupshowing", menu);
    return menu.querySelectorAll("[zentral-notes-own]");
  };
  const choose = async (note, id) => {
    const row = rows(note).find((entry) => entry.getAttribute("zentral-notes-own") === id);
    assert.ok(row, `the menu of "${note.body}" offers ${id}`);
    row.dispatchEvent(new h.Ev("command", { bubbles: true })); // an exception in the command fails the test here
    await settle();
  };
  for (const note of [plain, linked, shown, kept]) assert.ok(entryOf(note), `"${note.body}" has a sidebar entry`);
  assert.deepEqual(rows(plain).map((row) => row.getAttribute("label")), ["Open note", "Remove from sidebar folder", "Move note to trash"]);

  // A note without reminders: gone at once, restorable from Trash, and Notes does not open for it.
  await choose(plain, "trash");
  assert.ok(store.get(plain.id).trashed, "a note without reminders moves to Trash");
  assert.equal(sheetOpen(), false, "Notes stays closed: there was nothing to ask");
  h.fireTimer(250);
  assert.equal(entryOf(plain), undefined, "its sidebar entry is removed");
  assert.ok(entryOf(linked) && entryOf(shown) && entryOf(kept), "the other entries stay");

  // A note with reminders: the same question as in the Notes list, and nothing happens until it is answered.
  await choose(linked, "trash");
  assert.equal(sheetOpen(), true, "Notes opens to ask");
  let card = sheet().querySelector(".zn-dialog-card");
  assert.equal(card?.getAttribute("aria-label"), "Move note to Trash?");
  assert.match(card.textContent, /This note has 1 reminder\./);
  assert.ok(!store.get(linked.id).trashed, "the note is not moved before the answer");
  card.querySelectorAll("button").find((button) => button.textContent.trim() === "Cancel").click(); await settle();
  assert.ok(!store.get(linked.id).trashed, "Cancel keeps the note");
  assert.equal(sheet().querySelector(".zn-dialog-card"), null);
  await choose(linked, "trash");
  card = sheet().querySelector(".zn-dialog-card");
  card.querySelectorAll("button").find((button) => button.textContent.trim() === "Move to Trash").click(); await settle();
  assert.ok(store.get(linked.id).trashed, "the confirmed note moves to Trash");
  assert.equal(store.items.list({ noteId: linked.id }).length, 0, "its reminder is hidden with it");
  assert.equal(store.items.list({ noteId: linked.id, includeHidden: true }).length, 1, "and kept for a restore");

  // The open sheet is showing the note that the sidebar menu moves to Trash: it must not keep editing a trashed note.
  await choose(shown, "open");
  assert.equal(editorText(), "Shown note", "Open note shows the note");
  await choose(shown, "trash");
  assert.ok(store.get(shown.id).trashed);
  assert.equal(editorText(), "Kept note", "the sheet moves on to a note that still exists");
  assert.equal(sheet().querySelector(".zn-dialog-card"), null, "no question for a note without reminders");

  // A dialog that is open in the sheet survives an unrelated sidebar command.
  const second = store.create("Second plain note"); h.seam.zen.runNow();
  store.items.upsert(C.makeItem({ id: "kept-reminder", summary: "Kept", start: { dateTime: new Date(Date.now() + 2 * 86400000).toISOString() }, x: { src: "manual", kind: "reminder", noteId: kept.id } }));
  await choose(kept, "trash");
  assert.ok(sheet().querySelector(".zn-dialog-card"), "a question is open in the sheet");
  await choose(second, "trash");
  assert.ok(store.get(second.id).trashed, "another note without reminders still goes to Trash");
  assert.equal(sheet().querySelector(".zn-dialog-card")?.getAttribute("aria-label"), "Move note to Trash?", "the open question is left alone");
  assert.ok(!store.get(kept.id).trashed, "and the note it asks about is untouched");

  // A stale menu (the note is already in Trash) does nothing and does not throw.
  const stale = rows(kept).find((entry) => entry.getAttribute("zentral-notes-own") === "trash");
  sheet().querySelector(".zn-dialog-card").querySelectorAll("button").find((button) => button.textContent.trim() === "Move to Trash").click(); await settle();
  assert.ok(store.get(kept.id).trashed);
  stale.dispatchEvent(new h.Ev("command", { bubbles: true })); await settle();
  assert.equal(sheet().querySelector(".zn-dialog-card"), null, "a second command for a trashed note asks nothing");

  await h.destroy();
  console.log("sidebar note menu tests passed");
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
