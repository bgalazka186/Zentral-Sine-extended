"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createFakeDom = require("./helpers/fake-dom.cjs");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");

const notesPath = path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js");
const calPath = path.resolve(__dirname, "../additional/notes/calendar/ZentralNotesCalendar.js");
const flavorsPath = path.resolve(__dirname, "../additional/notes/flavors/ZentralNotesFlavors.js");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

function createSheetHarness() {
  const dom = createFakeDom();
  const { Ev, El, document, raf } = dom;
  const calMod = require(calPath);
  const flavorsMod = require(flavorsPath);
  const win = {
    document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    __zentralNotesParts: { "notes-calendar": calMod, "notes-flavors": flavorsMod },
    requestAnimationFrame: (fn) => raf.push(fn),
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;
  vm.runInNewContext(fs.readFileSync(notesPath, "utf8"), {
    window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
    console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set,
    setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array,
    TextEncoder, TextDecoder, queueMicrotask,
  });
  const c = win.__zentralNotesTestSeam.core;
  const files = new Map();
  const io = {
    makeDir: async () => {},
    stat: async (p) => ({ size: (files.get(p)?.text || "").length, lastModified: files.get(p)?.mtime || 0 }),
    removeTree: async (d) => { for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k); },
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; },
    writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }),
    remove: async (p) => files.delete(p),
    exists: async (p) => files.has(p),
    children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/")),
    restrict: async () => {},
  };
  const store = c.createStore({
    io,
    getHistory: () => ({ on: true, keep: 5, minutes: 1, capKB: 512, warnMB: 100 }),
    notify() {},
    windowId: "t34",
    getDir: async () => "/n",
    getMaxSaveMs: () => 5000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });
  const host = new El("div");
  const adapter = {
    position: "fixed",
    host,
    attach: (r) => host.appendChild(r),
    getArea: () => ({ left: 0, top: 0, width: 520, height: 700, anchor: "top" }),
    watch: () => () => {},
    setActive() {},
    rewatch() {},
  };
  const env = {
    readOpts: () => ({}),
    openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, exportZip: () => 0, revealFolder() {},
    getPref: (_k, d) => d, setPref() {},
  };
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  sheet.root.ownerDocument = document;
  const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
  const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
  return { store, sheet, flushRaf, click, q: (sel) => sheet.root.querySelector(sel) };
}

(async () => {
  await test("sheet.sidebarFolderReminder validates folder identity, creates note+reminder in folder, handles rename/delete and cancel cleanly", async () => {
    const { store, sheet, flushRaf, click, q } = createSheetHarness();
    await store.open();
    await sheet.open();
    await flushRaf();

    const folderId = store.addFolder("Projects");
    const folder = store.meta.folders.find((f) => f.id === folderId);
    assert.ok(folder?.uid);
    assert.equal(typeof sheet.sidebarFolderReminder, "function");
    const baseCount = store.list().length;

    // Stale/wrong uid rejected
    assert.equal(sheet.sidebarFolderReminder(folder.id, "wrong-uid"), false);
    assert.equal(sheet.sidebarFolderReminder("nonexistent", "x"), false);

    // Open for folder and Cancel -> 0 new notes, 0 calendar items created
    assert.equal(sheet.sidebarFolderReminder(folder.id, folder.uid), true);
    let dialog = q(".zn-dialog");
    assert.ok(dialog, "composer dialog opens");
    const noteSel = dialog.querySelectorAll("select").find((s) => s.getAttribute("aria-label") === "Linked note");
    assert.ok(noteSel, "Linked note select present");
    assert.ok(noteSel.querySelectorAll("option").some((o) => o.textContent.includes("New note in Projects")), "offers New note in Projects");
    const cancelBtn = dialog.querySelectorAll("button").find((b) => b.textContent === "Cancel");
    click(cancelBtn);
    assert.equal(store.list().length, baseCount, "cancel leaves zero orphan notes");
    assert.equal(store.items.list().length, 0, "cancel leaves zero calendar items");

    // Invalid time -> refuses and leaves zero orphan notes
    const findInput = (dlg, needle) => dlg.querySelectorAll("input").find((i) => (i.getAttribute("placeholder") || i.placeholder || "").includes(needle));
    assert.equal(sheet.sidebarFolderReminder(folder.id, folder.uid), true);
    dialog = q(".zn-dialog");
    const titleInput = findInput(dialog, "title");
    const timeInput = findInput(dialog, "9am");
    titleInput.value = "Bad time check";
    timeInput.value = "99:99";
    const saveBtn = dialog.querySelectorAll("button").find((b) => b.textContent === "Create reminder");
    click(saveBtn);
    assert.equal(store.list().length, baseCount, "validation error creates zero orphan notes");
    assert.equal(store.items.list().length, 0);

    // Fix time and submit -> creates note in Projects + reminder linked to that note
    timeInput.value = "10:30";
    titleInput.value = "Ship milestone";
    click(saveBtn);
    assert.equal(store.list().length, baseCount + 1, "created one note");
    const createdNote = store.list().find((n) => n.body.includes("# Ship milestone"));
    assert.ok(createdNote, "created note found");
    assert.equal(createdNote.folder, folder.id, "note placed in target folder");
    const createdItems = store.items.list({ noteId: createdNote.id, kind: "reminder" });
    assert.equal(createdItems.length, 1, "reminder linked to new folder note");
    assert.equal(createdItems[0].summary, "Ship milestone");

    // Moving/renaming the folder while composer is open still saves to the moved folder via stable uid
    const otherParentId = store.addFolder("Work");
    assert.equal(sheet.sidebarFolderReminder(folder.id, folder.uid), true);
    dialog = q(".zn-dialog");
    const titleMoved = findInput(dialog, "title");
    titleMoved.value = "Moved folder reminder";
    const movedId = store.moveFolder(folder.id, otherParentId);
    assert.ok(movedId && movedId !== folder.id, "folder moved to new path");
    click(dialog.querySelectorAll("button").find((b) => b.textContent === "Create reminder"));
    const movedNote = store.list().find((n) => n.body.includes("# Moved folder reminder"));
    assert.ok(movedNote, "note created after folder move");
    assert.equal(movedNote.folder, movedId, "note placed in the moved folder's new path via stable uid");

    // Deleting and recreating a folder at the same path while dialog is open -> refuses to save
    const movedFolder = store.meta.folders.find((f) => f.id === movedId);
    assert.equal(sheet.sidebarFolderReminder(movedFolder.id, movedFolder.uid), true);
    dialog = q(".zn-dialog");
    const title2 = findInput(dialog, "title");
    title2.value = "Stale folder reminder";
    const countBeforeStale = store.list().length;
    const itemsBeforeStale = store.items.list().length;
    store.removeFolder(movedFolder.id, "root");
    const replacementId = store.addFolder("Projects", otherParentId);
    assert.equal(replacementId, movedFolder.id);
    const save2 = dialog.querySelectorAll("button").find((b) => b.textContent === "Create reminder");
    click(save2);
    assert.equal(store.list().length, countBeforeStale, "deleted/replaced folder refuses to create note");
    assert.equal(store.items.list().length, itemsBeforeStale, "deleted/replaced folder refuses to create reminder");
    click(dialog.querySelectorAll("button").find((b) => b.textContent === "Cancel"));

    // Root folder ("", "") creates top-level note + linked reminder
    assert.equal(sheet.sidebarFolderReminder("", ""), true);
    dialog = q(".zn-dialog");
    const title3 = findInput(dialog, "title");
    title3.value = "Root reminder";
    click(dialog.querySelectorAll("button").find((b) => b.textContent === "Create reminder"));
    const rootNote = store.list().find((n) => n.body.includes("Root reminder"));
    assert.ok(rootNote, "root note created");
    assert.equal(rootNote.folder, "", "root note lives at top level");
    assert.equal(store.items.list({ noteId: rootNote.id, kind: "reminder" }).length, 1);

    sheet.destroy();
    await store.close();
  });

  await test("Zen sidebar folder context menu adds Create reminder in this folder ONLY on Notes folders, never normal or Agenda folders", async () => {
    const h = createFakeZen({
      prefs: {
        "zen.workspace.zentral.notes.zen_folder": "all",
        "zen.workspace.zentral.notes.agenda_folder": true,
      },
    });
    await h.seam.ensureStore();
    h.fireTimer(6000);
    h.fireTimer(6500);
    await Promise.resolve();

    const calMod = require(calPath);
    const todayKey = calMod.ymd(new Date());
    const subId = h.seam.store.addFolder("Clients");
    h.seam.store.create("# Client brief\n", subId);
    h.seam.store.items.upsert({
      summary: "Agenda item",
      start: { date: todayKey },
      x: { kind: "reminder" },
    });
    h.seam.zen.runNow();
    h.seam.agendaController.runNow();
    await Promise.resolve();

    const menu = h.document.createXULElement("menupopup");
    menu.id = "zenFolderActions";
    h.document.body.append(menu);

    const openMenuFor = (folder) => {
      menu.triggerNode = folder;
      h.emit("popupshowing", menu);
      return menu.querySelectorAll("[zentral-notes-folder-own]").map((el) => ({
        own: el.getAttribute("zentral-notes-folder-own"),
        label: el.getAttribute("label"),
        el,
      }));
    };

    // 1. Normal user Zen folder -> ZERO Notes items, ZERO zentral-notes-folder-ctx
    const normalFolder = h.sidebar.folder("Normal User Folder", { id: "user-normal-folder" });
    const normalItems = openMenuFor(normalFolder);
    assert.equal(normalItems.length, 0, "normal Zen folder gets zero Notes menu items");
    assert.equal(h.document.documentElement.hasAttribute("zentral-notes-folder-ctx"), false, "normal folder never gets Notes ctx attribute");

    // 2. Agenda root & day folder -> ZERO Notes folder menu items
    const agendaRoot = h.sidebar.ws.querySelector("[bgalazka-notes-agenda-folder]");
    assert.ok(agendaRoot, "Agenda root exists");
    assert.equal(openMenuFor(agendaRoot).length, 0, "Agenda root gets zero Notes folder menu items");
    assert.equal(h.document.documentElement.hasAttribute("zentral-notes-folder-ctx"), false);
    const agendaDay = h.sidebar.ws.querySelector("[bgalazka-notes-agenda-day]");
    assert.ok(agendaDay, "Agenda day folder exists");
    assert.equal(openMenuFor(agendaDay).length, 0, "Agenda day folder gets zero Notes folder menu items");
    assert.equal(h.document.documentElement.hasAttribute("zentral-notes-folder-ctx"), false);
    assert.equal(h.document.documentElement.getAttribute("zentral-agenda-folder-ctx"), "true");

    // 3. Notes root folder -> has Create reminder in this folder… (and no Delete folder)
    const notesRoot = h.sidebar.ws.querySelector("[bgalazka-notes-folder]");
    assert.ok(notesRoot, "NOTES root folder exists");
    const rootItems = openMenuFor(notesRoot);
    assert.ok(rootItems.some((x) => x.own === "reminder" && x.label === "Create reminder in this folder…"), "NOTES root has Create reminder in this folder…");
    assert.equal(rootItems.some((x) => x.own === "delete"), false, "NOTES root has no Delete folder");
    assert.equal(h.document.documentElement.getAttribute("zentral-notes-folder-ctx"), "true");

    // 4. Notes subfolder -> has Create reminder in this folder… alongside other actions
    const subFolder = h.sidebar.ws.querySelector("[bgalazka-notes-subfolder]");
    assert.ok(subFolder, "Notes subfolder exists in sidebar");
    const subItems = openMenuFor(subFolder);
    assert.ok(subItems.some((x) => x.own === "new"));
    assert.ok(subItems.some((x) => x.own === "subfolder"));
    assert.ok(subItems.some((x) => x.own === "reminder" && x.label === "Create reminder in this folder…"), "Notes subfolder has Create reminder in this folder…");
    assert.ok(subItems.some((x) => x.own === "style"));
    assert.ok(subItems.some((x) => x.own === "export"));
    assert.ok(subItems.some((x) => x.own === "delete"));

    // 5. Re-opening on normal folder cleans up prior Notes items and ctx attribute; popuphidden also clears ctx
    const afterNormal = openMenuFor(normalFolder);
    assert.equal(afterNormal.length, 0);
    assert.equal(h.document.documentElement.hasAttribute("zentral-notes-folder-ctx"), false);
    openMenuFor(notesRoot);
    assert.equal(h.document.documentElement.getAttribute("zentral-notes-folder-ctx"), "true");
    h.emit("popuphidden", menu);
    assert.equal(h.document.documentElement.hasAttribute("zentral-notes-folder-ctx"), false, "popuphidden clears zentral-notes-folder-ctx");

    await h.destroy();
  });

  console.log(`\nALL ${passed} SIDEBAR FOLDER REMINDER (T3.4) TESTS PASSED`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
