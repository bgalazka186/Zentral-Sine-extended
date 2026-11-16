"use strict";
/* H1.6 regression tests: write unsaved note text, calendar.json, reminder history, and meta.json when a window closes.
 * Simulates real Firefox `unload` semantics via `win.unload()`: synchronous IOUtils calls issued inside `unload`
 * complete on the I/O thread, while ZERO promise continuations execute in the closed window. */
const assert = require("node:assert/strict");
const { createPanelWorld, noteText, DIR } = require("./helpers/fake-panel-window.cjs");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const META = DIR + "/meta.json";
const CAL = DIR + "/calendar.json";
const HIST = DIR + "/reminder-history.json";
const UNLOAD_DIR = DIR + "/backup/unload";

function makeWorld(extraMeta = {}) {
  const w = createPanelWorld({ sharedGlobal: { Map, Object } });
  w.disk.set(DIR + "/n1.md", noteText("First", { body: "original line\n" }));
  w.disk.set(META, JSON.stringify({
    folders: [{ id: "work", label: "Work", order: 0, collapsed: false, uid: "fwork00001" }],
    mode: "edit",
    ...extraMeta,
  }));
  return w;
}

const unloadFiles = (w) => [...w.disk.keys()].filter((k) => k.startsWith(UNLOAD_DIR + "/")).sort();
const backupMdFiles = (w, id) =>
  [...w.disk.keys()].filter((k) => k.startsWith(DIR + "/backup/") && !k.startsWith(UNLOAD_DIR + "/") && k.endsWith("/" + id + ".md")).sort();

(async () => {
  // ---- 1. Pure helpers ----------------------------------------------------------------------------------------------
  {
    const w = makeWorld(), win = w.openWindow({ id: "pure" });
    const c = win.core;

    await test("pure: unloadEntryStem and parseUnloadEntryName round-trip and reject unsafe names", async () => {
      assert.equal(typeof c.unloadEntryStem, "function");
      assert.equal(typeof c.parseUnloadEntryName, "function");
      const stem = c.unloadEntryStem(1700000000123, 2, "winA", "note", "n1");
      const parsed = plain(c.parseUnloadEntryName(stem + ".json"));
      assert.equal(parsed.ms, 1700000000123);
      assert.equal(parsed.seq, 2);
      assert.equal(parsed.windowId, "winA");
      assert.equal(parsed.kind, "note");
      assert.equal(parsed.id, "n1");
      assert.equal(parsed.ext, "json");
      const prev = plain(c.parseUnloadEntryName(stem + ".prev"));
      assert.equal(prev.ext, "prev");
      for (const bad of ["", "x.json", "000000000000001-0001-a-note~../evil.json", "000000000000001-0001-a-evil~n1.json", "000000000000001-0001-a-meta~other.json"]) {
        assert.equal(c.parseUnloadEntryName(bad), null, "rejects " + bad);
      }
    });

    await test("pure: planUnloadWrites orders makeDir -> notes (copy before write) -> calendar -> history -> meta", async () => {
      assert.deepEqual(plain(c.planUnloadWrites({ dir: DIR, nowMs: 1000, windowId: "w1" })), [], "nothing dirty -> empty plan");
      const ops = plain(c.planUnloadWrites({
        dir: DIR,
        nowMs: 1000,
        windowId: "w1",
        notes: [
          { id: "n1", text: "edited", baseline: "orig", onDisk: true },
          { id: "n_new", text: "brand new", baseline: null, onDisk: false },
        ],
        calendar: { baseline: { items: [], categories: [] }, local: { items: [{ id: "cal1" }], categories: [] } },
        history: { records: [{ id: "h1" }] },
        meta: { base: { folders: [] }, mine: { folders: [{ id: "f1" }] } },
      }));
      assert.equal(ops[0].op, "makeDir");
      assert.equal(ops[0].path, UNLOAD_DIR);
      const copyN1 = ops.findIndex((o) => o.op === "copy" && o.kind === "note" && o.id === "n1");
      const writeN1 = ops.findIndex((o) => o.op === "write" && o.kind === "note" && o.id === "n1");
      const directNew = ops.findIndex((o) => o.op === "write" && o.kind === "note" && o.id === "n_new" && o.direct === true);
      const copyCal = ops.findIndex((o) => o.op === "copy" && o.kind === "calendar");
      const writeCal = ops.findIndex((o) => o.op === "write" && o.kind === "calendar");
      const writeHist = ops.findIndex((o) => o.op === "write" && o.kind === "history");
      const writeMeta = ops.findIndex((o) => o.op === "write" && o.kind === "meta");
      assert.ok(copyN1 > 0 && copyN1 < writeN1, "existing note is copied to recovery before unsaved text is written");
      assert.ok(directNew > 0 && ops[directNew].opts.mode === "create", "new note uses atomic mode:create");
      assert.ok(Math.max(writeN1, directNew) < copyCal && copyCal < writeCal, "all note writes precede calendar.json (UI4.7)");
      assert.ok(writeCal < writeHist && writeHist < writeMeta, "calendar -> history -> meta order preserved");
    });

    await test("pure: decideNoteRecovery never overwrites a foreign change", async () => {
      assert.equal(c.decideNoteRecovery({ entry: { onDisk: true, baseline: "v1", text: "v2" }, diskExists: true, diskText: "v2" }).action, "noop");
      assert.equal(c.decideNoteRecovery({ entry: { onDisk: true, baseline: "v1", text: "v2" }, diskExists: true, diskText: "v1" }).action, "apply");
      assert.equal(c.decideNoteRecovery({ entry: { onDisk: true, baseline: "v1", text: "v2" }, diskExists: true, diskText: "foreign" }).action, "conflict");
      assert.equal(c.decideNoteRecovery({ entry: { onDisk: true, baseline: "v1", text: "v2" }, diskExists: false, diskText: null }).action, "conflict");
      assert.equal(c.decideNoteRecovery({ entry: { onDisk: false, baseline: null, text: "new" }, diskExists: false, diskText: null }).action, "apply");
      assert.equal(c.decideNoteRecovery({ entry: { onDisk: false, baseline: null, text: "new" }, diskExists: true, diskText: "other" }).action, "conflict");
    });
  }

  // ---- 2. Single window closes between keystroke and autosave -------------------------------------------------------
  await test("single window closed before autosave: unsaved note, new note, calendar item, and folder survive via synchronous unload I/O", async () => {
    const w = makeWorld();
    const a = w.openWindow({ id: "a" });
    a.start();
    await a.seam.ensureStore();
    await w.advance(1000);
    await a.seam.store.flush();
    await w.settle();
    w.ioOps.length = 0;

    // Make unsaved edits inside the 0.6s / 0.8s debounce windows (do NOT flush or advance past debounce).
    a.seam.store.update("n1", "# First\ntyped 200ms before close\n", "edit");
    const created = a.seam.store.create("# Brand New\njust typed\n", "work");
    const addedItem = a.seam.store.items.upsert({
      summary: "Doctor visit",
      start: { date: "2026-11-20" },
      end: { date: "2026-11-21" },
      x: { kind: "reminder", noteId: "n1" },
    });
    a.seam.store.items.history.append({
      itemId: addedItem.id,
      occurrenceId: addedItem.id,
      noteId: "n1",
      summary: "Doctor visit",
      start: addedItem.start,
      action: "done",
      at: Date.UTC(2026, 10, 16, 12, 0, 0),
    });
    a.seam.store.addFolder("Travel");

    // Simulate closing the Firefox window 200ms later: zero promise continuations run in window `a`.
    await w.advance(200);
    assert.ok(!w.disk.get(DIR + "/n1.md").includes("typed 200ms before close"), "autosave has not fired yet");
    a.unload();
    await w.settle();

    // Immediately after unload (before any second window opens):
    const aOps = w.ioOps.filter((x) => x.window === "a");
    const noteWriteIdx = aOps.findIndex((x) => x.op === "write" && x.path.includes("-note~n1.json"));
    const noteCopyIdx = aOps.findIndex((x) => x.op === "copy" && x.path === DIR + "/n1.md");
    const calWriteIdx = aOps.findIndex((x) => x.op === "write" && x.path.includes("-calendar~calendar.json"));
    assert.ok(noteCopyIdx >= 0 && noteCopyIdx < noteWriteIdx, "existing note copied to recovery before unsaved text");
    assert.ok(calWriteIdx > noteWriteIdx, "note writes dispatched strictly before calendar.json (UI4.7)");
    assert.ok(w.disk.has(DIR + "/" + created.id + ".md"), "brand-new note created on disk atomically");
    assert.ok(unloadFiles(w).some((p) => p.includes("-note~n1.json")), "edited note staged in recovery");
    assert.ok(unloadFiles(w).some((p) => p.includes("-meta~meta.json")), "dirty folder staged in recovery");

    // Reopen in a fresh window: everything is reconciled cleanly onto live files and loaded.
    const b = w.openWindow({ id: "b" });
    b.start();
    await b.seam.ensureStore();
    await w.settle();

    assert.match(w.disk.get(DIR + "/n1.md"), /typed 200ms before close/, "edited note text promoted to disk");
    assert.match(b.seam.store.get("n1").body, /typed 200ms before close/, "edited note loaded in new window");
    assert.match(b.seam.store.get(created.id).body, /just typed/, "brand-new note loaded in new window");
    assert.ok(b.seam.store.items.list().some((it) => it.summary === "Doctor visit"), "unsaved calendar item survived");
    assert.ok(
      b.seam.store.items.history.stateFor(addedItem.id, addedItem.id) === "done",
      "unsaved reminder history transition survived",
    );
    assert.ok(b.seam.store.meta.folders.some((f) => f.label === "Travel"), "unsaved folder survived");
    assert.deepEqual(unloadFiles(w), [], "reconciled unload staging files are cleaned up");
  });

  // ---- 3. Foreign change case: NEVER overwrite foreign changes ------------------------------------------------------
  await test("foreign change before unload: live note and calendar are untouched, unsaved edits are preserved only in recovery", async () => {
    const w = makeWorld();
    const initialCal = {
      v: 2,
      items: [{
        id: "manual:r1",
        summary: "Initial reminder",
        start: { date: "2026-11-20" },
        end: { date: "2026-11-21" },
        status: "confirmed",
        updated: "2026-11-16T10:00:00.000Z",
        rev: 1,
        x: { kind: "reminder", src: "manual", noteId: "" },
      }],
      categories: [],
    };
    w.disk.set(CAL, JSON.stringify(initialCal));

    const a = w.openWindow({ id: "a" });
    a.start();
    await a.seam.ensureStore();
    await w.advance(1000);
    await a.seam.store.flush();
    await w.settle();

    // Window A edits n1 and changes the existing calendar item (still within debounce).
    a.seam.store.update("n1", "# First\nunsaved local version from A\n", "edit");
    const curItem = a.seam.store.items.list()[0];
    assert.ok(curItem, "initial calendar item loaded");
    a.seam.store.items.upsert({ ...curItem, summary: "Local edit from A" });

    // An external editor modifies BOTH n1.md and calendar.json before Window A closes!
    const foreignNote = noteText("First", { body: "FOREIGN EXTERNAL EDIT\n", updated: "2026-11-16T10:04:00.000Z" });
    w.disk.set(DIR + "/n1.md", foreignNote);
    w.disk.set(CAL, "{not valid json from foreign tool");

    a.unload();
    await w.settle();

    // Immediately after unload: foreign files are untouched!
    assert.equal(w.disk.get(DIR + "/n1.md"), foreignNote, "unload never overwrote foreign note on disk");
    assert.equal(w.disk.get(CAL), "{not valid json from foreign tool", "unload never overwrote foreign calendar.json");

    // Reopen in fresh window B: foreign note stays live, A's unsaved text lives ONLY in 48h recovery backup!
    const b = w.openWindow({ id: "b" });
    b.start();
    await b.seam.ensureStore();
    await w.settle();

    assert.equal(w.disk.get(DIR + "/n1.md"), foreignNote, "reconciliation kept foreign note untouched on disk");
    assert.match(b.seam.store.get("n1").body, /FOREIGN EXTERNAL EDIT/, "loaded note keeps foreign content");
    const backups = backupMdFiles(w, "n1");
    assert.equal(backups.length, 1, "unsaved text preserved as a 48h recovery copy");
    assert.match(w.disk.get(backups[0]), /unsaved local version from A/, "recovery copy holds Window A's unsaved text");
    const calBackups = [...w.disk.keys()].filter((k) => k.startsWith(DIR + "/calendar.conflict-"));
    assert.ok(calBackups.length >= 1, "unsaved calendar change preserved as conflict recovery backup");
    assert.equal(w.disk.get(CAL), "{not valid json from foreign tool", "damaged/foreign calendar file was not overwritten");
  });

  // ---- 4. Two windows: Window A closes mid-edit while Window B stays open -------------------------------------------
  await test("two windows: closing Window A delivers unsaved note, folder, and calendar changes to open Window B without losing B's edits", async () => {
    const w = makeWorld();
    const a = w.openWindow({ id: "a" }), b = w.openWindow({ id: "b" });
    a.start(); b.start();
    await Promise.all([a.seam.ensureStore(), b.seam.ensureStore()]);
    await w.advance(1000);
    await a.seam.store.flush(); await b.seam.store.flush();
    await w.settle();

    // Window B adds its own folder and saves it.
    b.seam.store.addFolder("Personal");
    await b.seam.store.flush();
    await w.settle();

    // Window A (before autosave/debounce) edits n1, adds folder "Travel", adds a reminder, then closes by unload.
    a.seam.store.update("n1", "# First\nfrom closing window A\n", "edit");
    a.seam.store.addFolder("Travel");
    a.seam.store.items.upsert({
      summary: "From closing window A",
      start: { date: "2026-11-22" },
      end: { date: "2026-11-23" },
      x: { kind: "reminder", noteId: "n1" },
    });

    a.unload();
    await w.advance(500);

    assert.match(w.disk.get(DIR + "/n1.md"), /from closing window A/, "Window B promoted Window A's unsaved note");
    assert.match(b.seam.store.get("n1").body, /from closing window A/, "Window B reloaded the promoted note");
    const bFolders = b.seam.store.meta.folders.map((f) => f.label).sort();
    assert.deepEqual(bFolders, ["Personal", "Travel", "Work"], "both Window A's and Window B's folders survive");
    assert.ok(b.seam.store.items.list().some((it) => it.summary === "From closing window A"), "Window B loaded Window A's calendar item");
    assert.deepEqual(unloadFiles(w), [], "unload staging cleared after live reconciliation");
  });

  await test("two windows conflicting note edit: Window B saved first, Window A closes mid-edit -> B stays live, A kept in recovery", async () => {
    const w = makeWorld();
    const a = w.openWindow({ id: "a" }), b = w.openWindow({ id: "b" });
    a.start(); b.start();
    await Promise.all([a.seam.ensureStore(), b.seam.ensureStore()]);
    await w.advance(1000);
    await a.seam.store.flush(); await b.seam.store.flush();
    await w.settle();

    // Window A starts editing n1 (now dirty, so it ignores B's remote reload notification).
    a.seam.store.update("n1", "# First\nunsaved edit in A\n", "edit");
    // Window B edits and saves n1 first.
    b.seam.store.update("n1", "# First\nsaved edit in B\n", "edit");
    await b.seam.store.flush();
    await w.settle();

    // Window A closes before autosave.
    a.unload();
    await w.advance(500);

    assert.match(w.disk.get(DIR + "/n1.md"), /saved edit in B/, "Window B's saved note is never overwritten");
    assert.match(b.seam.store.get("n1").body, /saved edit in B/, "Window B keeps its saved content");
    const backups = backupMdFiles(w, "n1");
    assert.equal(backups.length, 1, "Window A's conflicting unsaved text is kept in recovery");
    assert.match(w.disk.get(backups[0]), /unsaved edit in A/);
  });

  await test("idle window unload writes nothing and emits zero warnings", async () => {
    const w = makeWorld();
    const a = w.openWindow({ id: "a" });
    a.start();
    await a.seam.ensureStore();
    await w.advance(1000);
    await a.seam.store.flush();
    await w.settle();
    w.writes.length = 0;
    w.warnings.length = 0;

    a.unload();
    await w.settle();

    assert.equal(w.writes.length, 0, "no writes when nothing is dirty");
    assert.deepEqual(unloadFiles(w), [], "no unload staging files created");
    assert.deepEqual(w.warnings, [], "zero warnings");
  });

  console.log(`\n${passed} notes unload save tests passed`);
})().catch((error) => {
  console.error("FAIL", error);
  process.exit(1);
});
