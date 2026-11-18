"use strict";
/* ST7.3: the calendar's view state is not notes metadata. `meta.json` also holds every folder and up to five thousand
 * per-note alert/Agenda overrides, and it is rewritten as a whole; keeping the view cursor in it meant that pressing
 * "Next" in the calendar rewrote all of that 600 ms later. The view now lives in `ui.json`, next to `meta.json`.
 *
 * Part 1 is the pure split: which keys move, which never move, and how an old `meta.json` is read once so that nobody
 * loses the view they were looking at. Part 2 runs the real store on a fake disk and watches the writes: moving the
 * calendar must not write `meta.json` at all, and the view must survive a restart.
 */
const assert = require("node:assert/strict");
const { createPanelWorld, noteText, DIR } = require("./helpers/fake-panel-window.cjs");

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const plain = (v) => JSON.parse(JSON.stringify(v));
const META = DIR + "/meta.json";
const UI = DIR + "/ui.json";
const FOLDERS = [{ id: "work", label: "Work", order: 0, collapsed: false, uid: "fwork00001" }];
const START = 8_000;

async function boot(meta) {
  const w = createPanelWorld({ sharedGlobal: { Map, Object } });
  w.disk.set(DIR + "/n1.md", noteText("One", { folder: "work" }));
  w.disk.set(META, JSON.stringify(meta));
  const a = w.openWindow({ id: "a" });
  a.start();
  await a.seam.ensureStore();
  await w.advance(START);
  await a.seam.store.flush();
  await w.settle();
  return { w, a, A: a.seam.store };
}

(async () => {
  // =====================================================================================================================
  // 1. The pure split
  // =====================================================================================================================
  {
    const w = createPanelWorld({ sharedGlobal: { Map, Object } });
    const core = w.openWindow({ id: "pure" }).core;
    const { splitUiState, migrateUiState, UI_STATE_KEYS, isUiStateKey } = core.CALENDAR_PART;

    await test("the view moves and the content stays", async () => {
      const { ui, meta } = splitUiState({
        folders: [{ id: "work" }], lastNoteId: "n1", mode: "read",
        calendarView: "week", calendarCursor: "2026-11-17", calendarScale: { month: "auto" },
      });
      assert.deepEqual(Object.keys(ui).sort(), ["calendarCursor", "calendarScale", "calendarView"]);
      assert.deepEqual(Object.keys(meta).sort(), ["folders", "lastNoteId", "mode"]);
    });

    await test("the keys that are content never move, whatever else changes", async () => {
      // Every content key the metadata has: folders, the note opened last, alerts, per-note overrides, free/busy days.
      for (const key of ["folders", "lastNoteId", "recent", "calendarAlertSettings", "calendarNoteAlertOverrides",
        "calendarAgendaDefaults", "calendarAgendaOverrides", "calendarHolidays", "calendarClockMode", "spellLanguages"])
        assert.equal(isUiStateKey(key), false, key + " is content and must stay in meta.json");
      for (const key of ["calendarView", "calendarCursor", "calendarDaysForward", "calendarFilterKind", "calendarLayout"])
        assert.equal(isUiStateKey(key), true, key + " is view state and belongs in ui.json");
    });

    await test("an old meta.json hands its view over once, and only its view", async () => {
      const old = { calendarView: "week", calendarCursor: "2026-11-10", folders: [{ id: "work" }], lastNoteId: "n1" };
      const { ui, migrated, seen } = migrateUiState(null, splitUiState(old).ui);
      assert.deepEqual(plain(ui), { calendarView: "week", calendarCursor: "2026-11-10" });
      assert.equal(migrated, true, "the caller learns that a write is needed");
      assert.equal(seen, true);
      assert.equal(Object.hasOwn(ui, "folders"), false, "content is never carried into the view file");
      assert.equal(Object.hasOwn(ui, "lastNoteId"), false);
    });

    await test("a view file already on disk wins over the old copy in meta.json", async () => {
      const { ui, migrated } = migrateUiState({ calendarView: "month" }, { calendarView: "week" });
      assert.deepEqual(plain(ui), { calendarView: "month" });
      assert.equal(migrated, false, "nothing to write: the split already happened");
    });

    await test("nothing stored anywhere is not an error, and a junk view file is not a crash", async () => {
      assert.deepEqual(plain(migrateUiState(null, null)), { ui: {}, migrated: false, seen: false });
      assert.deepEqual(plain(migrateUiState("junk", [])), { ui: {}, migrated: false, seen: false });
    });

    await test("the view file is written as a bare object of the moved keys", async () => {
      assert.deepEqual(JSON.parse(core.uiFileText({ calendarView: "day", folders: [1], nope: 2 })), { v: 1, ui: { calendarView: "day" } });
      assert.deepEqual(plain(core.uiStateFromFile({ calendarView: "day", folders: [] })), { calendarView: "day" });
      assert.deepEqual(plain(core.uiStateFromFile({ v: 1, ui: { calendarCursor: "2026-11-17" } })), { calendarCursor: "2026-11-17" });
      assert.equal(core.uiStateFromFile({ folders: [] }), null, "a file with no view key is not a view");
      assert.equal(core.uiStateFromFile("x"), null);
    });

    await test("every key the store writes to the view is a key the split knows", async () => {
      const fs = require("node:fs");
      const src = fs.readFileSync("additional/notes/ZentralNotes.uc.js", "utf8");
      const keys = new Set([...src.matchAll(/setUiState\(\{\s*([A-Za-z]+):/g)].map((m) => m[1]));
      for (const key of keys) assert.ok(UI_STATE_KEYS.includes(key), "setUiState writes " + key + ", which must be in UI_STATE_KEYS");
    });

    // The notes module keeps its own copy of the list, because the store must still split a patch while the calendar
    // part is unloaded. Two lists are two chances to drift, and they had: `calendarBigPictureTreeCollapsed` was in the
    // fallback but not in the calendar's list, so collapsing the Big Picture tree wrote the whole meta.json — exactly
    // the rewrite the split exists to prevent.
    await test("the store's fallback list equals the calendar's own list", async () => {
      const fs = require("node:fs");
      const src = fs.readFileSync("additional/notes/ZentralNotes.uc.js", "utf8");
      const block = /const UI_KEYS_FALLBACK = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(src);
      assert.ok(block, "the fallback list is declared");
      const fallback = [...block[1].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
      assert.deepEqual(fallback.slice().sort(), [...UI_STATE_KEYS].sort(),
        "the two lists are the same keys, in whatever order each file reads best");
      // And every one of them is view state, or `splitUiState` is filing a content field into the view file.
      for (const key of fallback) assert.ok(UI_STATE_KEYS.includes(key));
    });
  }

  // =====================================================================================================================
  // 2. The real store on a disk
  // =====================================================================================================================
  await test("moving the calendar writes ui.json and never touches meta.json", async () => {
    const { w, a, A } = await boot({ folders: FOLDERS, calendarView: "month", calendarCursor: "", calendarDaysForward: 7 });
    w.writes.length = 0;
    A.setMeta({ calendarCursor: "2026-11-17" }); // what pressing Next does
    await w.advance(2000);
    await w.settle();
    const writes = w.writes.map((x) => x.path);
    assert.equal(writes.filter((p) => p === UI).length, 1, "the view is saved once");
    assert.equal(writes.filter((p) => p === META).length, 0, "and meta.json is not rewritten by moving the calendar");
    assert.equal(JSON.parse(w.disk.get(UI)).ui.calendarCursor, "2026-11-17");
    assert.equal(w.meta().calendarCursor, undefined, "meta.json does not hold the cursor any more");
    assert.equal(A.meta.calendarCursor, "2026-11-17", "but reading it through the store still works");
    await a.close();
  });

  await test("an old meta.json hands its view over once, and the next start reads it from ui.json", async () => {
    const { w, a, A } = await boot({
      folders: FOLDERS, calendarView: "week", calendarCursor: "2026-11-10", calendarDaysForward: 14, mode: "read",
    });
    // The view came across, nothing was lost, and the content is untouched.
    assert.deepEqual(plain([A.meta.calendarView, A.meta.calendarCursor, A.meta.calendarDaysForward]), ["week", "2026-11-10", 14]);
    assert.equal(A.meta.mode, "read");
    assert.equal(w.meta().calendarView, undefined, "meta.json was rewritten without the view");
    assert.equal(w.meta().mode, "read", "and kept what is content");
    assert.deepEqual(plain((w.meta().folders || []).map((f) => f.label)), ["Work"]);
    assert.equal(JSON.parse(w.disk.get(UI)).ui.calendarView, "week", "the view is in its own file now");
    await a.close();
    // A second window on the same disk: no migration, the view comes straight out of ui.json.
    w.writes.length = 0;
    const b = w.openWindow({ id: "b" });
    b.start();
    await b.seam.ensureStore();
    await w.advance(START);
    await w.settle();
    assert.deepEqual(plain([b.seam.store.meta.calendarView, b.seam.store.meta.calendarCursor]), ["week", "2026-11-10"]);
    assert.equal(w.writes.filter((x) => x.path === UI && x.op === "write").length, 0, "and nothing had to be written");
    await b.close();
  });

  await test("a change to the view and a change to a folder are saved in their own files", async () => {
    const { w, a, A } = await boot({ folders: FOLDERS, calendarView: "month" });
    w.writes.length = 0;
    A.setMeta({ calendarView: "day" });
    assert.ok(A.addFolder("Travel"), "a folder is added in the same 600 ms");
    await w.advance(2000);
    await w.settle();
    const ui = w.writes.filter((x) => x.path === UI).length, meta = w.writes.filter((x) => x.path === META).length;
    assert.ok(ui >= 1 && meta >= 1, "each file gets what belongs to it: ui " + ui + ", meta " + meta);
    assert.equal(w.meta().calendarView, undefined, "the folder's file still has no view");
    assert.deepEqual(plain((w.meta().folders || []).map((f) => f.label)).sort(), ["Travel", "Work"]);
    await a.close();
  });

  await test("a view changed in the last moment before the window closes is not lost", async () => {
    const { w, a, A } = await boot({ folders: FOLDERS, calendarView: "month", calendarCursor: "" });
    A.setMeta({ calendarView: "agenda", calendarCursor: "2026-12-01" });
    a.unload(); // a real window closing: no time passes, the 600 ms timer never fires
    await new Promise((r) => setTimeout(r, 60)); // the I/O thread finishes what `unload` issued
    const staged = [...w.disk.keys()].filter((k) => k.includes("unload"));
    assert.ok(staged.length > 0, "the change was staged on the way out");
    const recovered = [...staged].find((k) => k.endsWith(".json") && JSON.parse(w.disk.get(k)).kind === "ui");
    assert.ok(recovered, "and it is staged as a view entry");
    assert.equal(JSON.parse(w.disk.get(recovered)).ui.calendarView, "agenda");
  });

  await test("a view file that cannot be read is not written over", async () => {
    const w = createPanelWorld({ sharedGlobal: { Map, Object } });
    w.disk.set(DIR + "/n1.md", noteText("One", { folder: "work" }));
    w.disk.set(META, JSON.stringify({ folders: FOLDERS, calendarView: "week" }));
    w.disk.set(UI, "{ this is not JSON");
    const a = w.openWindow({ id: "a" });
    a.start();
    await a.seam.ensureStore();
    await w.advance(START);
    await w.settle();
    a.seam.store.setMeta({ calendarView: "day" });
    await w.advance(4000);
    await w.settle();
    assert.equal(w.disk.get(UI), "{ this is not JSON", "the damaged file is left as it is for a person to see");
    const warned = w.warnings.map((x) => (typeof x === "string" ? x : x.text || "")).join("\n");
    assert.match(warned, /ui\.json/, "and the window says so instead of failing silently");
    await a.close();
  });

  console.log("\nPASS notes-ui-state (" + passed + " tests)");
})().catch((error) => {
  console.error("\nFAIL notes-ui-state");
  console.error(error);
  process.exit(1);
});
