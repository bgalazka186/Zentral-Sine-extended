"use strict";
/* T3.1: start-up of Notes does not depend on which of several things happens first.
 * Runs the REAL start() of additional/notes/ZentralNotes.uc.js in one or two fake windows with one virtual clock
 * (tests/helpers/fake-panel-window.cjs), so each test decides the order: the notes being read, the second panel
 * (Triple View) being built, the start-up panel sliding away, a second window starting, a file being held for a moment.
 * Covers: the start-up restore of Notes, a sheet opened before the notes are read, a notes folder that is not reachable
 * yet, a panel suite built or rebuilt later, two windows starting together, and the settings file (meta.json).
 * This does NOT prove real layout, real timing or Gecko behaviour: the owner checks those in the app. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPanelWorld, noteText, DIR } = require("./helpers/fake-panel-window.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const STARTUP = "zen.workspace.bgalazka.open_at_startup";
const META = DIR + "/meta.json";
const FOLDERS = [
  { id: "work", label: "Work projects", order: 0, collapsed: false, uid: "fwork00001", color: "blue" },
  { id: "home", label: "Home", order: 1, collapsed: true, uid: "fhome00001" },
];
// A world whose application was closed with Notes open in `openIn` and whose panel opens at start-up.
function world({ openIn = "primary", mode = "single", shared = true, meta = {} } = {}) {
  const w = createPanelWorld({ sharedGlobal: shared ? { Map, Object } : null });
  w.disk.set(DIR + "/n1.md", noteText("One", { folder: "work" }));
  w.disk.set(DIR + "/n2.md", noteText("Two", { folder: "home", updated: "2026-11-02T10:00:00.000Z" }));
  w.disk.set(META, JSON.stringify({ openIn, folders: FOLDERS, calendarDaysForward: 14, ...meta }));
  if (mode) w.prefs.set(STARTUP, JSON.stringify({ id: "app", mode }));
  return w;
}
const slowDisk = (w, id) => w.hold((op, p, win) => (!id || win === id) && (op === "makeDirectory" || op === "children" || op === "read"));
// Arrays made inside a window belong to that window's realm; compare plain copies.
const plain = (v) => JSON.parse(JSON.stringify(v));
const folderNames = (win) => plain(win.seam.store.meta.folders.map((f) => f.label)).sort();
const focusInside = (win, el) => { for (let x = win.dom.state.activeElement; x; x = x.parent) if (x === el) return true; return false; };
const statusOf = (sheet) => sheet.querySelector(".zn-status").textContent;
const editorOf = (sheet) => sheet.querySelector(".zn-editor");
// What a person would see of the restored Notes: where it is, folded or not, which note.
const seen = (win) => win.openSheets().map((s) => ({ slot: s.dataset.slot || "", folded: s.dataset.collapsed === "true", busy: s.dataset.loading || "", text: editorOf(s).value.trim() }));
const folderLabels = (w) => (w.meta().folders || []).map((f) => f.label + "/" + f.uid + "/" + (f.color || "")).sort();
const REAL_FOLDERS = ["Home/fhome00001/", "Work projects/fwork00001/blue"];

(async () => {
  // =====================================================================================================================
  // 1. The start-up restore
  // =====================================================================================================================
  // The panel code opens the start-up panel and slides it away 1.2 s later (hover-to-show is forced on).
  async function startupPanel(w, win, { storeMs, hideAt = 1200, triple = false } = {}) {
    const panel = win.buildPanel({ open: false });
    const release = storeMs ? slowDisk(w) : null;
    win.start();
    await w.advance(400);
    win.openPanel(panel);
    const tri = triple ? win.buildTriple(panel) : null;
    let t = 0;
    const until = async (ms) => { if (ms > t) { await w.advance(ms - t); t = ms; } };
    const events = [[hideAt, () => win.hidePanel(true)], ...(storeMs ? [[storeMs, release]] : [])].sort((a, b) => a[0] - b[0]);
    for (const [at, run] of events) { await until(at); run(); await w.flush(); }
    await until(Math.max(hideAt, storeMs || 0) + 3000);
    return { panel, tri };
  }

  let reference;
  await test("restore, notes read quickly: Notes is back in its bar, folded with the panel that slid away, and has not taken the keyboard", async () => {
    const w = world(), win = w.openWindow();
    await startupPanel(w, win, {});
    reference = seen(win);
    assert.deepEqual(reference, [{ slot: "", folded: true, busy: "", text: "# Two\ntext of Two" }], "open, folded with its panel (a folded sheet holds no room), the note used last");
    assert.equal(focusInside(win, win.openSheets()[0]), false, "the keyboard focus was never moved into Notes");
    assert.equal(w.meta().openIn, "primary");
    assert.deepEqual(w.warnings, []);
    await win.close();
  });

  await test("restore, notes read AFTER the panel slid away (a large folder, a cold disk): exactly the same result", async () => {
    for (const storeMs of [1300, 2500, 9000]) {
      const w = world(), win = w.openWindow();
      await startupPanel(w, win, { storeMs });
      assert.deepEqual(seen(win), reference, "notes ready " + storeMs + " ms after the panel opened");
      assert.equal(focusInside(win, win.openSheets()[0]), false);
      // Showing the panel again shows what a sheet folded with its panel always shows; nothing opens a second time.
      win.hidePanel(false); await w.advance(3000);
      assert.equal(win.openSheets().length, 1);
      assert.equal(win.sheets().length, 1, "one sheet object, never a second Notes");
      assert.deepEqual(w.warnings, []);
      await win.close();
    }
  });

  await test("restore, the panel never hides: Notes is open in its bar without the keyboard focus", async () => {
    const w = world(), win = w.openWindow();
    const panel = win.buildPanel({ open: false });
    const release = slowDisk(w);
    win.start(); await w.advance(400);
    win.openPanel(panel); await w.advance(2000);
    assert.deepEqual(seen(win), [], "nothing is shown before the notes are known");
    release(); await w.advance(1000);
    assert.deepEqual(seen(win), [{ slot: "dock", folded: false, busy: "", text: "# Two\ntext of Two" }]);
    assert.equal(focusInside(win, win.openSheets()[0]), false, "a restore is not a request: the keyboard stays where it is");
    assert.equal(win.html.all().filter((e) => e.dataset?.host === "float").length, 0, "never as the floating card");
    await win.close();
  });

  await test("restore into Triple View: the second panel is built late, or exists without a box yet", async () => {
    // (a) Triple View is being entered; the bar of the second panel appears three seconds after the notes were read
    {
      const w = world({ openIn: "triple", mode: "triple" }), win = w.openWindow();
      const panel = win.buildPanel({ open: true });
      win.html.setAttribute("bgalazka-triple-view", "true");
      win.start(); await w.advance(3000);
      assert.deepEqual(seen(win), [], "it waits for the bar it was in; it does not open somewhere else or as the card");
      const tri = win.buildTriple(panel); await w.advance(500);
      assert.deepEqual(seen(win).map((x) => x.slot), ["gap"], "between the two panels");
      assert.ok(win.isNotesButton(tri.bar.firstElementChild));
      assert.equal(win.html.getAttribute("bgalazka-notes-gap"), "true");
      await win.close();
    }
    // (b) the bar is in the document while the notes are read, but has no box until later, and nothing else changes
    {
      const w = world({ openIn: "triple", mode: "triple" }), win = w.openWindow();
      const panel = win.buildPanel({ open: true });
      const release = slowDisk(w);
      win.start(); await w.advance(500);
      const tri = win.buildTriple(panel);
      let laidOut = false; tri.bar.getClientRects = () => (laidOut ? [{}] : []);
      await w.advance(5000);
      release(); await w.advance(300);
      assert.deepEqual(seen(win), []);
      laidOut = true; // no mutation is reported for a layout that settles
      await w.advance(1000);
      assert.deepEqual(seen(win).map((x) => x.slot), ["gap"]);
      await win.close();
    }
    // (c) Triple View and the panel slid away before the notes were read
    {
      const w = world({ openIn: "triple", mode: "triple" }), win = w.openWindow();
      await startupPanel(w, win, { storeMs: 4000, triple: true });
      assert.deepEqual(seen(win).map((x) => [x.slot, x.folded]), [["", true]], "open, folded with the hidden panel (a folded sheet holds no room)");
      win.hidePanel(false); await w.advance(1000);
      assert.equal(win.openSheets().length, 1);
      await win.close();
    }
    // (d) Notes was between the panels, but this start shows one panel only: it comes back in the main bar
    {
      const w = world({ openIn: "triple", mode: "single" }), win = w.openWindow();
      win.buildPanel({ open: true });
      win.start(); await w.advance(2000);
      assert.deepEqual(seen(win).map((x) => x.slot), ["dock"]);
      await win.close();
    }
  });

  await test("restore is start-up only: closed by hand stays closed, a later request wins, and a bar that appears a minute later opens nothing", async () => {
    // Notes was closed by hand before the application was closed.
    {
      const w = world({ openIn: "" }), win = w.openWindow();
      win.buildPanel({ open: true }); win.start(); await w.advance(5000);
      assert.deepEqual(seen(win), []);
      await win.close();
    }
    // The person opens and closes Notes while the notes are still being read: it must not come back by itself.
    {
      const w = world(), win = w.openWindow();
      const panel = win.buildPanel({ open: true });
      const release = slowDisk(w);
      win.start(); await w.advance(300);
      const button = panel.toolbar.firstElementChild;
      button.click(); await w.advance(100);
      assert.equal(win.openSheets().length, 1);
      button.click(); await w.advance(100);
      assert.equal(win.openSheets().length, 0, "closed by hand");
      release(); await w.advance(5000);
      assert.equal(win.openSheets().length, 0, "the waiting restore does not undo that");
      await w.advance(1000);
      assert.equal(w.meta().openIn, "", "and the next start does not restore it either");
      await win.close();
    }
    // Triple View never comes; the person opens it a minute later.
    {
      const w = world({ openIn: "triple", mode: "triple" }), win = w.openWindow();
      const panel = win.buildPanel({ open: true });
      win.html.setAttribute("bgalazka-triple-view", "true"); // entering, the second panel never finishes
      win.start(); await w.advance(61000);
      assert.deepEqual(seen(win), []);
      win.buildTriple(panel); await w.advance(3000);
      assert.deepEqual(seen(win), [], "start-up is over: Notes does not appear by itself");
      assert.ok(win.isNotesButton(panel.toolbar.firstElementChild), "the buttons are there as usual");
      await win.close();
    }
    // No start-up panel configured: nothing is restored at all.
    {
      const w = world({ mode: "" }), win = w.openWindow();
      win.buildPanel({ open: true }); win.start(); await w.advance(5000);
      assert.deepEqual(seen(win), []);
      await win.close();
    }
  });

  // =====================================================================================================================
  // 2. A sheet opened before the notes are read
  // =====================================================================================================================
  await test("opened while the notes are being read: the sheet says so and nothing in it acts; afterwards the note is there and typing works", async () => {
    const w = world({ mode: "" }), win = w.openWindow();
    const panel = win.buildPanel({ open: true });
    const release = slowDisk(w);
    win.start(); await w.advance(200);
    panel.toolbar.firstElementChild.click(); await w.advance(100);
    const sheet = win.openSheets()[0];
    assert.ok(sheet, "the sheet is on screen at once");
    assert.equal(sheet.dataset.loading, "loading");
    assert.equal(sheet.getAttribute("aria-busy"), "true");
    assert.equal(statusOf(sheet), "Loading notes\u2026");
    const editor = editorOf(sheet);
    assert.equal(editor.readOnly, true, "nothing can be typed that would be replaced by the note that opens");
    // Presses and keys inside do nothing (a note created now would be dropped when the folder is read).
    const filesBefore = w.noteFiles().length;
    for (const el of sheet.querySelectorAll("button")) {
      if (el.getAttribute("aria-label") === "Close notes (Esc)" || el.title === "Close notes (Esc)") continue;
      el.dispatchEvent(new win.Ev("click", { bubbles: true }));
    }
    const key = new win.Ev("keydown", { bubbles: true, key: "n", ctrlKey: true });
    editor.dispatchEvent(key);
    assert.equal(key.defaultPrevented, true);
    const typed = new win.Ev("input", { bubbles: true });
    editor.dispatchEvent(typed);
    assert.equal(typed.stopped, true, "an input event does not reach the editor's handlers");
    await w.advance(1000);
    assert.equal(win.openSheets().length, 1, "still the one sheet, no menu or dialog opened");
    assert.equal(sheet.querySelectorAll(".zn-dialog, .zn-menu").length, 0);
    assert.equal(win.seam.store.list().length, 0, "no note was created in the empty store");

    release(); await w.advance(500);
    assert.equal(sheet.dataset.loading, undefined);
    assert.equal(sheet.hasAttribute("aria-busy"), false);
    assert.doesNotMatch(statusOf(sheet), /Loading|unavailable/);
    assert.equal(editor.readOnly, false);
    assert.equal(editor.value.trim(), "# Two\ntext of Two", "the note used last");
    win.dom.state.activeElement = editor; editor.value += "\ntyped after loading"; editor.dispatchEvent(new win.Ev("input", { bubbles: true }));
    await w.advance(8000);
    assert.match(w.disk.get(DIR + "/n2.md"), /typed after loading/, "and typing is saved");
    assert.equal(w.noteFiles().length, filesBefore, "no stray note file");
    await win.close();
  });

  await test("closing works while the notes are being read (the button and Esc), and nothing opens afterwards", async () => {
    for (const how of ["button", "escape"]) {
      const w = world({ mode: "" }), win = w.openWindow();
      const panel = win.buildPanel({ open: true });
      const release = slowDisk(w);
      win.start(); await w.advance(200);
      panel.toolbar.firstElementChild.click(); await w.advance(100);
      const sheet = win.openSheets()[0];
      if (how === "button") sheet.querySelectorAll("button").find((b) => b.title === "Close notes (Esc)").dispatchEvent(new win.Ev("click", { bubbles: true }));
      else sheet.dispatchEvent(new win.Ev("keydown", { bubbles: true, key: "Escape" }));
      await w.advance(100);
      assert.equal(win.openSheets().length, 0, how);
      assert.equal(win.html.style.getPropertyValue("--zentral-notes-panel-reserve"), "", "the panel has its room back");
      release(); await w.advance(3000);
      assert.equal(win.openSheets().length, 0);
      assert.equal(w.noteFiles().length, 2);
      await win.close();
    }
  });

  await test("the notes folder cannot be reached yet: the sheet says so, tries again, and comes alive without being reopened", async () => {
    const w = world({ mode: "" }), win = w.openWindow();
    const panel = win.buildPanel({ open: true });
    const down = w.failNext((op) => op === "makeDirectory", 3, "NS_ERROR_FILE_NOT_FOUND");
    win.start(); await w.advance(200);
    panel.toolbar.firstElementChild.click(); await w.advance(200);
    const sheet = win.openSheets()[0];
    assert.equal(sheet.dataset.loading, "unavailable");
    assert.match(statusOf(sheet), /^Notes folder unavailable\. Trying again/);
    assert.equal(editorOf(sheet).readOnly, true);
    // Another request to open Notes is not stuck behind the missing folder.
    panel.toolbar.firstElementChild.click(); await w.advance(50);
    assert.equal(win.openSheets().length, 0, "the button still closes it");
    panel.toolbar.firstElementChild.click(); await w.advance(50);
    assert.equal(win.openSheets().length, 1, "and opens it again");
    await w.advance(20000);
    assert.equal(down.times, 0, "it kept trying");
    assert.equal(sheet.dataset.loading, undefined);
    assert.equal(editorOf(sheet).value.trim(), "# Two\ntext of Two");
    assert.equal(w.warnings.filter((x) => /NS_ERROR_FILE_NOT_FOUND/.test(x.text)).length <= 4, true, "not a warning per consumer and attempt");
    await win.close();
  });

  await test("the folder is away at start-up: reminders and the restore of Notes start late instead of never", async () => {
    const w = world(), win = w.openWindow();
    const panel = win.buildPanel({ open: true });
    w.failNext((op) => op === "makeDirectory", 2, "NS_ERROR_FILE_NOT_FOUND");
    win.start();
    await w.advance(4500); // the reminder boot asked for the notes and was refused
    assert.deepEqual(seen(win), []);
    await w.advance(20000);
    assert.equal(seen(win).length, 1, "Notes is restored once the folder is there");
    assert.ok(win.isNotesButton(panel.toolbar.firstElementChild));
    assert.equal(typeof win.seam.reminders.start, "function");
    assert.ok(win.seam.store.list().length === 2, "the store is loaded for reminders and the Agenda");
    await win.close();
  });

  // =====================================================================================================================
  // 3. The panel suite is built, or rebuilt, later
  // =====================================================================================================================
  await test("an action asked for while the folder is away is carried out once when the folder is there, not dropped", async () => {
    const w = world({ mode: "" }), win = w.openWindow();
    w.failNext((op, p) => op === "read" && p === META, 8); // two whole attempts fail
    win.start(); await w.settle();
    // What the sidebar menus do ("New note" in a folder, a link dropped on NOTES): a write that waits for the notes.
    win.seam.withStore(() => win.seam.store.create("# Asked for while the folder was away\n", "work"));
    const made = () => plain(win.seam.store.list().map((n) => n.body)).filter((body) => /Asked for while/.test(body)).length;
    await w.advance(1000);
    assert.equal(made(), 0, "nothing is created before the folder is read (the read would drop it)");
    await w.advance(8000);
    assert.equal(made(), 1, "carried out once the folder could be read");
    await win.seam.store.flush();
    assert.equal(w.noteFiles().filter((p) => /Asked for while/.test(w.disk.get(p))).length, 1, "and saved");
    assert.equal(w.warnings.length, 1, "the unreadable folder is reported once, not per attempt or per action");
    await win.close();
  });

  await test("a panel root built two minutes after Notes started gets its button, and so does its Triple View bar", async () => {
    const w = world({ mode: "" }), win = w.openWindow();
    win.start(); await w.advance(120000);
    assert.ok(win.observes(win.html), "the document element is watched: that is where the panel suite puts its root");
    const panel = win.buildPanel({ open: true, announce: true });
    await w.advance(500);
    assert.ok(win.isNotesButton(panel.toolbar.firstElementChild), "button on the main bar");
    assert.ok(win.observes(panel.slider) && win.observes(panel.root), "the new slider and root are watched");
    const tri = win.buildTriple(panel); await w.advance(500);
    assert.ok(win.isNotesButton(tri.bar.firstElementChild), "button on the Triple View bar");
    await win.close();
  });

  await test("a panel root that is replaced (the panel suite restarted) is picked up: buttons, later bars and 'open'", async () => {
    const w = world({ mode: "" }), win = w.openWindow();
    const first = win.buildPanel({ open: true });
    win.start(); await w.advance(10000);
    assert.ok(win.isNotesButton(first.toolbar.firstElementChild));
    first.root.remove();
    const next = win.buildPanel({ open: false });
    win.mutate(win.html, [{ type: "childList", addedNodes: [next.root], removedNodes: [first.root] }]);
    await w.advance(500);
    assert.ok(win.isNotesButton(next.toolbar.firstElementChild), "button on the new bar");
    assert.ok(win.observes(next.slider) && win.observes(next.root));
    win.openPanel(next);
    const tri = win.buildTriple(next); await w.advance(500);
    assert.ok(win.isNotesButton(tri.bar.firstElementChild), "a bar added to the new slider gets its button");
    tri.bar.firstElementChild.click(); await w.advance(300);
    assert.deepEqual(seen(win).map((x) => x.slot), ["gap"], "and Notes opens there");
    await win.close();
    assert.equal(win.mutationObservers.length, 0, "nothing is left watching");
  });

  // =====================================================================================================================
  // 4. Two windows start together
  // =====================================================================================================================
  await test("two windows, older reminders without an Agenda line: one date note and each reminder once", async () => {
    const w = createPanelWorld({ sharedGlobal: { Map, Object } });
    // An earlier session left two reminders that are not written in any note.
    {
      const seed = w.openWindow({ id: "seed" }); seed.start();
      const store = seed.seam.store;
      await store.open(); // without the application start-up step, as an older version left the folder
      const start = C.addDays(C.dayStart(Date.now()), 1) + 10 * 3600000;
      for (const [id, summary] of [["r1", "Call the bank"], ["r2", "Water plants"]]) store.items.upsert(C.makeItem({ id, summary, start: { dateTime: new Date(start).toISOString() }, x: { kind: "reminder", src: "manual" } }));
      await store.flush(); await w.advance(1000); await store.flush();
      await seed.close();
      assert.equal(w.noteFiles().length, 0, "no note names them yet");
    }
    const a = w.openWindow({ id: "a" }), b = w.openWindow({ id: "b" });
    a.start(); b.start();
    await Promise.all([a.seam.ensureStore(), b.seam.ensureStore()]);
    await w.advance(8000);
    await a.seam.store.flush(); await b.seam.store.flush();
    assert.equal(w.noteFiles().length, 1, "one date note, not one per window");
    const text = w.disk.get(w.noteFiles()[0]);
    assert.equal((text.match(/Call the bank/g) || []).length, 1);
    assert.equal((text.match(/Water plants/g) || []).length, 1);
    for (const win of [a, b]) assert.deepEqual(plain(win.seam.store.items.list().map((i) => i.summary)).sort(), ["Call the bank", "Water plants"], "window " + win.id);
    const onDisk = JSON.parse(w.disk.get(DIR + "/calendar.json")).items.filter((i) => i.status !== "cancelled");
    assert.equal(onDisk.length, 2, "two reminders in the calendar file");
    assert.deepEqual(w.warnings, []);
    await a.close(); await b.close();
  });

  await test("two windows, folders without a permanent id (older data): both windows end with the same ids", async () => {
    const w = world({ mode: "", meta: { folders: [{ id: "work", label: "Work projects", order: 0 }, { id: "home", label: "Home", order: 1 }] } });
    const a = w.openWindow({ id: "a" }), b = w.openWindow({ id: "b" });
    a.start(); b.start();
    await Promise.all([a.seam.ensureStore(), b.seam.ensureStore()]);
    await w.advance(3000);
    const ids = (win) => plain(win.seam.store.meta.folders.map((f) => f.id + "=" + f.uid)).sort();
    assert.ok(ids(a).every((x) => /=\w{4,}$/.test(x)), "every folder has an id");
    assert.deepEqual(ids(a), ids(b), "the Zen sidebar folders of both windows are the same folders");
    assert.deepEqual((w.meta().folders || []).map((f) => f.id + "=" + f.uid).sort(), ids(a), "and so is the file");
    await a.close(); await b.close();
  });

  await test("two windows on a slow disk: the second waits for the first well beyond the wait of a save, and still loads the result", async () => {
    const w = world({ mode: "", meta: { folders: [{ id: "work", label: "Work projects", order: 0 }, { id: "home", label: "Home", order: 1 }] } });
    const a = w.openWindow({ id: "a" }), b = w.openWindow({ id: "b" });
    assert.ok(a.core.STARTUP_TURN_WAIT_MS >= 60000, "reading a folder may take much longer than one save");
    const release = w.hold((op, p, id) => id === "a" && op === "read" && p === META); // window a is in the middle of reading
    a.start(); await w.settle();
    const first = a.seam.ensureStore(); await w.settle();
    b.start();
    let second = false; b.seam.ensureStore().then(() => { second = true; });
    await w.advance(a.core.SHARED_TURN_WAIT_MS * 3); // 24 s: a save would have stopped waiting long ago
    assert.equal(second, false, "window b has not read the folder side by side with window a");
    assert.deepEqual(w.warnings, [], "and has not given up");
    release(); await first; await w.advance(2000);
    assert.equal(second, true);
    const ids = (win) => plain(win.seam.store.meta.folders.map((f) => f.id + "=" + f.uid)).sort();
    assert.ok(ids(a).every((x) => /=\w{4,}$/.test(x)));
    assert.deepEqual(ids(a), ids(b), "one set of permanent folder ids, although the first window took 24 s");
    await a.close(); await b.close();
  });

  await test("two windows, the first is closed while it reads the folder: the second starts within a second, not after the long wait", async () => {
    const w = world({ mode: "" });
    const a = w.openWindow({ id: "a" }), b = w.openWindow({ id: "b" });
    w.hold((op, p, id) => id === "a" && op === "read" && p === META); // never released: the browser stops a closed window's steps
    a.start(); await w.settle();
    a.seam.ensureStore(); await w.settle();
    b.start();
    let second = false; b.seam.ensureStore().then(() => { second = true; });
    await w.advance(3000);
    assert.equal(second, false, "window a is open: window b waits for it");
    for (const l of a.listeners.filter((x) => x.type === "unload")) l.fn(); // window a is closed
    await w.advance(1100);
    assert.equal(second, true, "window b reads the folder itself as soon as it finds window a gone");
    assert.deepEqual(plain(b.seam.store.list().map((n) => n.id)).sort(), ["n1", "n2"], "with every note of the folder");
    assert.deepEqual(w.warnings, [], "this is not reported as a window that stopped answering");
  });

  await test("the folder cannot be read twice, then it can: Notes starts once (one listener for other windows; one event and one write per change)", async () => {
    const w = world({ mode: "single" }), win = w.openWindow();
    win.buildPanel({ open: true });
    w.failNext((op, p) => op === "read" && p === META, 8); // two whole attempts fail (four tries each)
    win.start();
    await w.advance(1000);
    assert.equal(seen(win).length, 0, "not started yet");
    await w.advance(8000); // the retries at 1.5 s and 4 s
    assert.equal(seen(win).length, 1, "Notes is restored once the folder can be read");
    assert.equal(w.observerTopics(win.id).filter((topic) => topic === "zentral-notes-changed").length, 1, "one listener for the saves of other windows, not one per attempt");
    // One change is one event and one write.
    const events = []; win.seam.store.on((e) => { if (e.type === "change" || e.type === "saved") events.push(e.type + ":" + e.id); });
    const before = w.writes.filter((x) => x.path === DIR + "/n1.md").length;
    win.seam.store.update("n1", "# One\nedited after the late start\n");
    await win.seam.store.flush(); await w.advance(2000);
    assert.equal(w.writes.filter((x) => x.path === DIR + "/n1.md").length - before, 1, "the note is written once");
    assert.equal(events.filter((x) => x === "change:n1").length, 1, "and reported once");
    await win.close();
  });

  await test("a save in one window while the other is still reading the folder is not missed", async () => {
    const w = world({ mode: "" });
    const a = w.openWindow({ id: "a" }), b = w.openWindow({ id: "b" });
    a.start(); b.start();
    await a.seam.ensureStore();
    // Window b has read n1.md and is held at the settings file when window a saves n1.md.
    const release = w.hold((op, p, id) => id === "b" && op === "read" && p === META);
    const loading = b.seam.ensureStore();
    await w.settle();
    a.seam.store.update("n1", "# One\nchanged in window a while b was loading\n");
    await a.seam.store.flush();
    release(); await loading; await w.settle();
    assert.match(b.seam.store.get("n1").body, /changed in window a/, "window b shows the text that is in the file");
    // ...and its own next edit of that note is an ordinary save, not a conflict with a version it never saw.
    const conflicts = [];
    b.seam.store.on((e) => { if (e.type === "conflict") conflicts.push(e); });
    b.seam.store.update("n1", b.seam.store.get("n1").body + "more from b\n");
    await b.seam.store.flush();
    assert.equal(conflicts.length, 0);
    assert.match(w.disk.get(DIR + "/n1.md"), /changed in window a[\s\S]*more from b/);
    await a.close(); await b.close();
  });

  // =====================================================================================================================
  // 5. The settings file
  // =====================================================================================================================
  await test("meta.json held for a moment while a window starts: the folders, colours and ids are read, nothing is replaced", async () => {
    for (const times of [1, 2, 3]) {
      const w = world(), a = w.openWindow({ id: "a" }), b = w.openWindow({ id: "b" });
      a.buildPanel({ open: true }); b.buildPanel({ open: true });
      w.failNext((op, p, id) => id === "b" && op === "read" && p === META, times);
      a.start(); b.start();
      await w.advance(3000);
      assert.deepEqual(folderNames(b), ["Home", "Work projects"], "the tree of window b (" + times + " failed reads)");
      assert.equal(seen(b).length, 1, "window b restored Notes: it knows where it was");
      await a.close(); await b.close();
      assert.deepEqual(folderLabels(w), REAL_FOLDERS, "the file still has every folder with its colour and id");
      assert.equal(w.meta().calendarDaysForward, 14, "and the other settings");
    }
  });

  await test("meta.json stays unreadable: Notes does not start from an empty tree and never writes over the file; later it opens normally", async () => {
    const w = world({ mode: "" }), win = w.openWindow();
    const panel = win.buildPanel({ open: true });
    const before = w.disk.get(META);
    const held = w.failNext((op, p) => op === "read" && p === META, 1000);
    win.start(); await w.advance(200);
    panel.toolbar.firstElementChild.click(); await w.advance(300);
    const sheet = win.openSheets()[0];
    assert.equal(sheet.dataset.loading, "unavailable", "the sheet waits instead of showing notes without their folders");
    panel.toolbar.firstElementChild.click(); await w.advance(2000); // closing it writes nothing
    await w.advance(30000);
    assert.equal(w.disk.get(META), before, "byte for byte the same file");
    assert.equal(w.writes.filter((x) => x.path === META).length, 0);
    assert.ok(w.warnings.some((x) => /meta\.json/.test(x.text)), "the reason is reported");
    held.times = 0; // the other program lets go
    panel.toolbar.firstElementChild.click(); await w.advance(40000);
    assert.equal(win.openSheets()[0].dataset.loading, undefined);
    assert.deepEqual(folderNames(win), ["Home", "Work projects"]);
    await win.close();
    assert.deepEqual(folderLabels(w), REAL_FOLDERS);
  });

  await test("meta.json missing or damaged: a new folder starts clean; a damaged file is kept beside the new one", async () => {
    // New folder: no settings file at all (asked twice, then defaults).
    {
      const w = createPanelWorld(), win = w.openWindow();
      w.disk.set(DIR + "/n1.md", noteText("One", { folder: "work" }));
      win.start(); await win.seam.ensureStore();
      assert.deepEqual(plain(win.seam.store.meta.folders.map((f) => f.id)), ["work"], "the folder named by a note");
      win.seam.store.setMeta({ calendarDaysForward: 30 }); await w.advance(1000);
      assert.equal(w.meta().calendarDaysForward, 30, "and settings are saved");
      assert.equal(w.disk.has(META + ".corrupt"), false);
      await win.close();
    }
    // Damaged (not JSON, or JSON that is not an object).
    for (const damaged of ['{"folders": [{"id": "work", "label": "Work pro', "[1, 2, 3]"]) {
      const w = createPanelWorld(), win = w.openWindow();
      w.disk.set(DIR + "/n1.md", noteText("One", { folder: "work" }));
      w.disk.set(META, damaged);
      win.start(); await win.seam.ensureStore();
      assert.equal(w.disk.get(META + ".corrupt"), damaged, "what was there can still be looked at");
      assert.ok(w.warnings.some((x) => /damaged/.test(x.text)));
      win.seam.store.setMeta({ calendarDaysForward: 30 }); await w.advance(1000);
      assert.equal(w.meta().calendarDaysForward, 30, "Notes works and saves again");
      await win.close();
    }
    // An empty file is not worth keeping.
    {
      const w = createPanelWorld(), win = w.openWindow();
      w.disk.set(META, "");
      win.start(); await win.seam.ensureStore();
      assert.equal(w.disk.has(META + ".corrupt"), false);
      assert.deepEqual(w.warnings, []);
      await win.close();
    }
  });

  // =====================================================================================================================
  // 6. The waiting sheet looks like it is waiting (style source; real painting is checked in the app)
  // =====================================================================================================================
  await test("style: a waiting sheet is dimmed and shows the wait pointer, and is never made click-through", async () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] })).filter((r) => r.selector.includes("[data-loading]"));
    assert.ok(rules.length >= 2, "rules for the waiting state exist");
    assert.ok(rules.some((r) => /^\.zentral-notes-sheet\[data-loading\]$/.test(r.selector) && /cursor:\s*progress/.test(r.body)), "the wait pointer on the sheet");
    assert.ok(rules.some((r) => /\.zn-body/.test(r.selector) && /opacity:\s*0?\.\d+/.test(r.body)), "the content is dimmed");
    for (const r of rules) {
      assert.doesNotMatch(r.body, /pointer-events\s*:\s*none/, "Close and the resize grips must stay reachable: " + r.selector);
      assert.doesNotMatch(r.body, /display\s*:\s*none|visibility\s*:\s*hidden/, "nothing is hidden, the sheet keeps its place: " + r.selector);
      assert.doesNotMatch(r.selector, /\.zn-head|\.zn-foot|\.zn-status|\.zn-rz/, "header, status line and grips are left alone: " + r.selector);
    }
  });

  console.log(`\n${passed} start-up tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
