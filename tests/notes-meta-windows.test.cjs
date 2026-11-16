"use strict";
/* T3.1 (b): the settings file (meta.json: folders with labels, colours and permanent ids, alert and Agenda settings,
 * layout) with two windows of one application running.
 * Before: every window kept the whole file in memory and wrote all of it. A folder added in window A was gone as soon
 * as window B saved anything (a note switch is enough), window B never showed the folder, and a setting changed in A
 * was put back by B's next save.
 * Now a save reads the file first and merges three ways (what this window last saw, what it has, what the file has),
 * windows take turns, and the other windows take over folders and the alert / Agenda settings at once. Layout and view
 * state stay per window: only the window that changed a value writes it.
 * Part 1: the pure merge. Part 2: the real start() in two fake windows on one disk and one virtual clock. */
const assert = require("node:assert/strict");
const { createPanelWorld, noteText, DIR } = require("./helpers/fake-panel-window.cjs");

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const plain = (v) => JSON.parse(JSON.stringify(v));
const META = DIR + "/meta.json";
const FOLDERS = [
  { id: "work", label: "Work projects", order: 0, collapsed: false, uid: "fwork00001", color: "blue" },
  { id: "home", label: "Home", order: 1, collapsed: true, uid: "fhome00001" },
];
function world(meta = {}) {
  const w = createPanelWorld({ sharedGlobal: { Map, Object } });
  w.disk.set(DIR + "/n1.md", noteText("One", { folder: "work" }));
  w.disk.set(DIR + "/n2.md", noteText("Two", { folder: "home", updated: "2026-11-02T10:00:00.000Z" }));
  w.disk.set(META, JSON.stringify({ folders: FOLDERS, calendarDaysForward: 14, mode: "edit", ...meta }));
  return w;
}
// Two windows that have been running for a while.
async function two(meta) {
  const w = world(meta), a = w.openWindow({ id: "a" }), b = w.openWindow({ id: "b" });
  a.start(); b.start();
  await Promise.all([a.seam.ensureStore(), b.seam.ensureStore()]);
  await w.advance(8000);
  await a.seam.store.flush(); await b.seam.store.flush(); await w.settle();
  w.writes.length = 0;
  return { w, a, b, A: a.seam.store, B: b.seam.store };
}
const labels = (store) => plain(store.meta.folders.map((f) => f.label)).sort();
const fileLabels = (w) => (w.meta().folders || []).map((f) => f.label).sort();
const folderOf = (list, id) => plain(list).find((f) => f.id === id) || null;
const metaWrites = (w, id) => w.writes.filter((x) => x.path === META && (!id || x.window === id)).length;
const SAVE = 1000; // longer than the 600 ms a settings change waits before it is written

(async () => {
  // =====================================================================================================================
  // 1. The pure merge
  // =====================================================================================================================
  {
    const w = world(), win = w.openWindow({ id: "pure" });
    const { mergeFolders, mergeMeta } = win.core;
    const base = [
      { id: "work", label: "Work", order: 0, collapsed: false, uid: "fwork00001", color: "blue" },
      { id: "home", label: "Home", order: 1, collapsed: true, uid: "fhome00001" },
    ];
    const edit = (list, id, patch) => list.map((f) => (f.id === id ? { ...f, ...patch } : f));
    const ids = (list) => plain(list).map((f) => f.id);

    await test("pure folders: one side unchanged gives the other side; both sides equal gives that", async () => {
      const renamed = edit(base, "work", { label: "Work 2026" });
      assert.deepEqual(plain(mergeFolders(base, base, renamed)), renamed, "nothing changed here: the file's folders");
      assert.deepEqual(plain(mergeFolders(base, renamed, base)), renamed, "nothing changed there: this window's folders");
      assert.deepEqual(plain(mergeFolders(base, renamed, renamed)), renamed);
      assert.deepEqual(plain(mergeFolders(base, base, base)), base);
      assert.deepEqual(plain(mergeFolders([], [], [])), []);
    });

    await test("pure folders: a folder added on each side is kept, and a change of one field does not undo another field", async () => {
      const travel = { id: "travel", label: "Travel", order: 2, collapsed: false, uid: "ftravel001" };
      const recipes = { id: "recipes", label: "Recipes", order: 2, collapsed: false, uid: "frecipes01" };
      const here = [...edit(base, "work", { color: "green" }), travel];
      const there = [...edit(edit(base, "work", { label: "Work 2026" }), "home", { collapsed: false }), recipes];
      const merged = plain(mergeFolders(base, here, there));
      assert.deepEqual(ids(merged).sort(), ["home", "recipes", "travel", "work"]);
      assert.deepEqual(folderOf(merged, "work"), { id: "work", label: "Work 2026", order: 0, collapsed: false, uid: "fwork00001", color: "green" });
      assert.equal(folderOf(merged, "home").collapsed, false, "the other side's change of a folder this side did not touch");
      // The same field changed on both sides: the side that saves now wins.
      assert.equal(folderOf(mergeFolders(base, edit(base, "work", { label: "Mine" }), edit(base, "work", { label: "Theirs" })), "work").label, "Mine");
      // A colour removed here is removed, not brought back by the file.
      assert.equal("color" in folderOf(mergeFolders(base, base.map(({ color, ...f }) => f), edit(base, "home", { label: "House" })), "work"), false);
    });

    await test("pure folders: a deleted folder stays deleted, whichever side deleted it and whatever the other side changed", async () => {
      const without = base.filter((f) => f.id !== "home");
      assert.deepEqual(ids(mergeFolders(base, without, edit(base, "home", { collapsed: false }))), ["work"], "deleted here, folded there");
      assert.deepEqual(ids(mergeFolders(base, edit(base, "home", { label: "House" }), without)), ["work"], "deleted there, renamed here");
      assert.deepEqual(ids(mergeFolders(base, without, without)), ["work"]);
    });

    await test("pure folders: a folder is the same folder by its permanent id; a moved folder keeps what the other side changed", async () => {
      const sub = [...base, { id: "work/plans", label: "Plans", order: 0, collapsed: false, uid: "fplans0001" }];
      const moved = edit(sub, "work/plans", { id: "home/plans" });          // moved under Home in this window
      const recoloured = edit(sub, "work/plans", { color: "red" });         // coloured in the other window
      const merged = plain(mergeFolders(sub, moved, recoloured));
      assert.deepEqual(merged.filter((f) => f.uid === "fplans0001"), [{ id: "home/plans", label: "Plans", order: 0, collapsed: false, uid: "fplans0001", color: "red" }]);
      // Two windows created the same folder independently (the date folder of the first reminder): one entry, the file's.
      const mine = [...base, { id: "daily", label: "Agenda", order: 2, collapsed: false, uid: "fmine00001" }];
      const theirs = [...base, { id: "daily", label: "Agenda", order: 2, collapsed: false, uid: "ftheirs001" }];
      assert.deepEqual(plain(mergeFolders(base, mine, theirs)).filter((f) => f.id === "daily").map((f) => f.uid), ["ftheirs001"]);
      // Older data without permanent ids is matched by folder id.
      const old = [{ id: "a", label: "A", order: 0, collapsed: false }];
      assert.deepEqual(plain(mergeFolders(old, edit(old, "a", { label: "A1" }), edit(old, "a", { collapsed: true }))), [{ id: "a", label: "A1", order: 0, collapsed: true }]);
    });

    await test("pure settings: each value is written by the window that changed it; per-note settings merge note by note", async () => {
      const b0 = { mode: "edit", size: "peek", calendarView: "month", folders: base, calendarAlertSettings: { v: 1 }, calendarAgendaDefaults: { lead: 0 },
        calendarNoteAlertOverrides: { n1: { sound: "a" }, n2: { sound: "b" } }, calendarNoteAgendaOverrides: {} };
      const here = { ...b0, size: "full", calendarNoteAlertOverrides: { n1: { sound: "a" }, n3: { sound: "c" } } };               // size changed, n2 removed, n3 added
      const there = { ...b0, mode: "read", calendarView: "week", calendarAlertSettings: { v: 2 }, calendarNoteAlertOverrides: { n1: { sound: "x" }, n2: { sound: "b" }, n4: { sound: "d" } } };
      const { file, taken } = mergeMeta(b0, here, there);
      assert.deepEqual(plain([file.mode, file.calendarView, file.size]), ["read", "week", "full"], "the file keeps the other window's view, and gets this window's size");
      assert.deepEqual(plain(file.calendarNoteAlertOverrides), { n1: { sound: "x" }, n4: { sound: "d" }, n3: { sound: "c" } });
      assert.deepEqual(plain(file.calendarAlertSettings), { v: 2 });
      assert.deepEqual(Object.keys(plain(taken)).sort(), ["calendarAlertSettings", "calendarNoteAlertOverrides"], "this window takes over shared settings only, never the other window's layout");
      assert.deepEqual(plain(taken.calendarNoteAlertOverrides), plain(file.calendarNoteAlertOverrides));
      // No file yet: everything this window has.
      assert.deepEqual(plain(mergeMeta(b0, here, null).file), plain(here));
      assert.deepEqual(plain(win.core.META_SHARED_KEYS), ["folders", "calendarAlertSettings", "calendarNoteAlertOverrides", "calendarAgendaDefaults", "calendarNoteAgendaOverrides"],
        "what a window takes over from another: folders and the alert / Agenda rules, never layout");
      // Key order inside a value is not a change.
      assert.deepEqual(plain(mergeMeta({ ...b0, calendarAgendaDefaults: { a: 1, b: 2 } }, { ...b0, calendarAgendaDefaults: { b: 2, a: 1 } }, { ...b0, calendarAgendaDefaults: { a: 9, b: 2 } }).file.calendarAgendaDefaults), { a: 9, b: 2 });
    });
  }

  // =====================================================================================================================
  // 2. Two running windows
  // =====================================================================================================================
  await test("a folder added in one window is in the other window's tree at once and survives the other window's next save", async () => {
    const { w, a, b, A, B } = await two();
    const trees = [];
    B.on((e) => { if (e.type === "tree") trees.push(e); });
    assert.ok(A.addFolder("Travel"));
    await w.advance(SAVE);
    assert.deepEqual(labels(B), ["Home", "Travel", "Work projects"], "window b has the folder without a restart");
    assert.ok(trees.length >= 1, "and its open folder trees are told to redraw");
    assert.equal(folderOf(B.meta.folders, "travel").uid, folderOf(A.meta.folders, "travel").uid, "the same permanent id in both windows");
    // Any save of window b: before, this wrote b's whole older copy and the folder was gone.
    B.setMeta({ calendarDaysForward: 30 });
    await w.advance(SAVE);
    assert.deepEqual(fileLabels(w), ["Home", "Travel", "Work projects"]);
    assert.equal(w.meta().calendarDaysForward, 30);
    await a.close(); await b.close();
    assert.deepEqual(fileLabels(w), ["Home", "Travel", "Work projects"], "also after both windows were closed");
    // The next start of the application.
    const c = w.openWindow({ id: "c" }); c.start(); await c.seam.ensureStore();
    assert.deepEqual(labels(c.seam.store), ["Home", "Travel", "Work projects"]);
    await c.close();
  });

  await test("both windows change folders in the same moment: every change is in the file and in both windows", async () => {
    const { w, a, b, A, B } = await two();
    // Nothing has been saved in between: each window still has the folders as they were.
    assert.ok(A.addFolder("Travel"));
    assert.ok(A.renameFolder("work", "Work 2026"));
    assert.ok(B.addFolder("Recipes"));
    assert.ok(B.setFolderStyle("work", { color: "green" }));
    assert.ok(B.setFolderCollapsed("home", false));
    B.setMeta({ calendarDaysForward: 30 }); // a setting of window b's own, not saved yet when window a's folders arrive
    await w.advance(SAVE); await w.advance(SAVE);
    const expected = ["Home", "Recipes", "Travel", "Work 2026"];
    assert.deepEqual(fileLabels(w), expected);
    assert.equal(w.meta().calendarDaysForward, 30);
    assert.deepEqual(labels(A), expected, "window a");
    assert.deepEqual(labels(B), expected, "window b");
    for (const list of [w.meta().folders, A.meta.folders, B.meta.folders]) {
      const work = folderOf(list, "work");
      assert.deepEqual([work.label, work.color, work.uid], ["Work 2026", "green", "fwork00001"]);
      assert.equal(folderOf(list, "home").collapsed, false);
    }
    assert.deepEqual(plain(A.meta.folders), plain(B.meta.folders), "both windows hold the same folders");
    assert.deepEqual(w.warnings, []);
    await a.close(); await b.close();
  });

  await test("both windows are closed in the same moment (quitting), each with a change it has not saved: both are in the file", async () => {
    const { w, a, b, A, B } = await two();
    assert.ok(A.addFolder("Travel"));
    A.setMeta({ mode: "read" });
    assert.ok(B.addFolder("Recipes"));
    B.setMeta({ calendarView: "week" });
    await Promise.all([a.close(), b.close()]); // no time passes: neither window has saved yet
    assert.deepEqual(fileLabels(w), ["Home", "Recipes", "Travel", "Work projects"]);
    assert.deepEqual([w.meta().mode, w.meta().calendarView], ["read", "week"]);
    assert.deepEqual(w.warnings, []);
  });

  await test("a folder deleted in one window stays deleted although the other window had just changed it", async () => {
    const { w, a, b, A, B } = await two();
    assert.ok(A.removeFolder("home", "toRoot"));
    assert.ok(B.setFolderCollapsed("home", false));
    await w.advance(SAVE); await w.advance(SAVE);
    assert.deepEqual(fileLabels(w), ["Work projects"]);
    assert.deepEqual(labels(A), ["Work projects"]);
    assert.deepEqual(labels(B), ["Work projects"], "window b drops it too");
    assert.equal(plain(B.get("n2").folder || ""), "", "and its note is at the top level in window b as well");
    await a.close(); await b.close();
  });

  await test("layout and view stay per window: the other window is not changed, and its next save does not put the old values back", async () => {
    const { w, a, b, A, B } = await two();
    A.setMeta({ mode: "read", calendarView: "week", size: "full" });
    await w.advance(SAVE);
    assert.deepEqual(plain([B.meta.mode, B.meta.calendarView, B.meta.size]), ["edit", "month", "peek"], "window b keeps its own view");
    B.setMeta({ lastNoteId: "n2" }); // window b opens another note: a save of something else
    await w.advance(SAVE);
    const file = w.meta();
    assert.deepEqual([file.mode, file.calendarView, file.size, file.lastNoteId], ["read", "week", "full", "n2"], "the file has what each window changed");
    // The window that changed a value last wins it.
    B.setMeta({ mode: "split" });
    await w.advance(SAVE);
    assert.equal(w.meta().mode, "split");
    assert.equal(plain(A.meta.mode), "read", "window a keeps showing what it shows");
    A.setMeta({ calendarDaysForward: 3 });
    await w.advance(SAVE);
    assert.deepEqual([w.meta().mode, w.meta().calendarDaysForward], ["split", 3]);
    await a.close(); await b.close();
    assert.deepEqual([w.meta().mode, w.meta().calendarView, w.meta().calendarDaysForward], ["split", "week", 3], "closing the windows changes nothing");
  });

  await test("alert and Agenda settings saved in one window apply in the other at once; per-note settings of different notes are both kept", async () => {
    const { w, a, b, A, B } = await two();
    const C = a.win.__zentralNotesParts["notes-calendar"];
    const alerts = C.cleanAlertSettings({ ...plain(A.meta.calendarAlertSettings), quietHours: { enabled: true, start: "22:00", end: "07:00", days: [1, 2, 3, 4, 5], allowed: {} } });
    assert.notDeepEqual(plain(alerts), plain(A.meta.calendarAlertSettings), "the test changes something");
    const trees = [];
    B.on((e) => { if (e.type === "tree") trees.push(e); });
    A.setMeta({ calendarAlertSettings: alerts, calendarAgendaDefaults: C.cleanAgendaWindow({ enabled: true, leadDays: 2, tailDays: 1 }) });
    A.setMeta({ calendarNoteAgendaOverrides: C.cleanNoteAgendaOverrides({ n1: { enabled: true, leadDays: 5, tailDays: 0 } }) });
    B.setMeta({ calendarNoteAgendaOverrides: C.cleanNoteAgendaOverrides({ n2: { enabled: false, leadDays: 0, tailDays: 0 } }) });
    await w.advance(SAVE); await w.advance(SAVE);
    assert.deepEqual(plain(B.meta.calendarAlertSettings), plain(alerts), "the reminder service of window b reads the new alert rules");
    assert.deepEqual(plain(B.meta.calendarAgendaDefaults), { enabled: true, leadDays: 2, tailDays: 1 });
    assert.ok(trees.length >= 1, "the Zen Agenda folder of window b is told to follow the new rule");
    for (const where of [w.meta(), A.meta, B.meta]) assert.deepEqual(Object.keys(plain(where.calendarNoteAgendaOverrides)).sort(), ["n1", "n2"]);
    await a.close(); await b.close();
  });

  await test("one save per change: a window that only took over the other's change writes nothing and sends nothing back", async () => {
    const { w, a, b, A } = await two();
    A.addFolder("Travel");
    await w.advance(SAVE); await w.advance(5000);
    assert.equal(metaWrites(w, "a"), 1, "window a wrote once");
    assert.equal(metaWrites(w, "b"), 0, "window b wrote nothing");
    // A save without any change of content does not rewrite the file.
    A.setMeta({ mode: "read" }); A.setMeta({ mode: "edit" });
    await w.advance(SAVE);
    assert.equal(metaWrites(w), 1);
    await a.close(); await b.close();
    assert.equal(metaWrites(w), 1, "closing writes nothing when nothing changed");
  });

  await test("the settings file cannot be read when a window wants to save: nothing is written over it, and the change is saved later", async () => {
    const { w, a, b, A, B } = await two();
    B.addFolder("Recipes");
    await w.advance(SAVE);
    w.writes.length = 0;
    // Another program holds the file for a while: every read of window a fails.
    const lock = w.failNext((op, p, id) => id === "a" && op === "read" && p === META, 8);
    A.addFolder("Travel");
    await w.advance(SAVE);
    assert.equal(metaWrites(w, "a"), 0, "window a did not write a file it could not read");
    assert.deepEqual(fileLabels(w), ["Home", "Recipes", "Work projects"], "the file is as it was");
    assert.deepEqual(labels(A), ["Home", "Recipes", "Travel", "Work projects"], "window a still has its folder");
    lock.times = 0; // the file can be read again
    await w.advance(5000);
    assert.deepEqual(fileLabels(w), ["Home", "Recipes", "Travel", "Work projects"], "saved by the retry, without another change");
    assert.deepEqual(labels(B), ["Home", "Recipes", "Travel", "Work projects"]);
    await a.close(); await b.close();
  });

  await test("a window that is still reading the folder when another window saves a folder does not miss it", async () => {
    const w = world(), a = w.openWindow({ id: "a" }), b = w.openWindow({ id: "b" });
    a.start(); b.start();
    await a.seam.ensureStore();
    // Window b has read the settings file and is held at the calendar file when window a saves a new folder.
    const release = w.hold((op, p, id) => id === "b" && p === DIR + "/calendar.json");
    const loading = b.seam.ensureStore();
    await w.settle();
    a.seam.store.addFolder("Travel");
    await w.advance(SAVE);
    release(); await loading; await w.advance(SAVE);
    assert.deepEqual(labels(b.seam.store), ["Home", "Travel", "Work projects"]);
    b.seam.store.setMeta({ calendarDaysForward: 30 });
    await w.advance(SAVE);
    assert.deepEqual(fileLabels(w), ["Home", "Travel", "Work projects"]);
    await a.close(); await b.close();
  });

  await test("a damaged settings file found at save time is kept beside the new one, and the window's settings are written", async () => {
    const { w, a, b, A } = await two();
    w.disk.set(META, "{ \"folders\": [ this is not JSON");
    A.addFolder("Travel");
    await w.advance(SAVE);
    assert.deepEqual(fileLabels(w), ["Home", "Travel", "Work projects"]);
    assert.equal(w.disk.get(META + ".corrupt"), "{ \"folders\": [ this is not JSON");
    await a.close(); await b.close();
  });

  console.log(`\n${passed} settings-file tests for several windows passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
