"use strict";

// T3.2: Multi-select notes & folders in tree view (Shift+Click range, Ctrl/Cmd+Click toggle,
// batch move, batch category/tag/label assignment, batch export, batch move to Trash).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createFakeDom = require("./helpers/fake-dom.cjs");

const ROOT = path.resolve(__dirname, "..");
const FLAVORS_MOD = require(path.join(ROOT, "additional", "notes", "flavors", "ZentralNotesFlavors.js"));
const CAL_MOD = require(path.join(ROOT, "additional", "notes", "calendar", "ZentralNotesCalendar.js"));
const NOTES_SRC = fs.readFileSync(path.join(ROOT, "additional", "notes", "ZentralNotes.uc.js"), "utf8");

function loadNotes() {
  const dom = createFakeDom();
  const { Ev, El, document, raf } = dom;
  const win = {
    document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    __zentralNotesParts: { "notes-calendar": CAL_MOD, "notes-flavors": FLAVORS_MOD },
    requestAnimationFrame: (fn) => raf.push(fn),
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    innerWidth: 1200,
    innerHeight: 900,
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;
  vm.runInNewContext(NOTES_SRC, {
    window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
    console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set,
    setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array,
    TextEncoder, TextDecoder, queueMicrotask,
  });
  return { seam: win.__zentralNotesTestSeam, core: win.__zentralNotesTestSeam.core, dom, win, document, Ev, El, raf };
}

function createMemoryStore(core) {
  const files = new Map();
  const dirs = new Set(["/n", "/n/assets", "/n/backup"]);
  const join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
  const parentOf = (p) => { const i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : "/"; };
  const io = {
    join,
    filename: (p) => p.split("/").pop(),
    exists: async (p) => dirs.has(p) || files.has(p),
    makeDir: async (p) => { let cur = ""; for (const s of p.split("/").filter(Boolean)) { cur += "/" + s; dirs.add(cur); } },
    children: async (p) => {
      const prefix = p.endsWith("/") ? p : p + "/";
      const out = new Set();
      for (const k of [...dirs, ...files.keys()]) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (rest) out.add(prefix + rest.split("/")[0]);
      }
      return [...out];
    },
    stat: async (p) => {
      if (dirs.has(p)) return { type: "directory", size: 0, lastModified: Date.now() };
      if (files.has(p)) return { type: "regular", size: files.get(p).length, lastModified: Date.now() };
      throw new Error("ENOENT: " + p);
    },
    read: async (p) => files.get(p),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); },
    write: async (p, text) => { dirs.add(parentOf(p)); files.set(p, String(text)); },
    writeUTF8: async (p, text) => { dirs.add(parentOf(p)); files.set(p, String(text)); },
    remove: async (p) => { files.delete(p); },
    copy: async (a, b) => { if (files.has(a)) { dirs.add(parentOf(b)); files.set(b, files.get(a)); } },
    restrict: async () => {},
  };
  let tick = 1700000000000;
  const nowFn = () => (tick += 1000);
  const store = core.createStore({
    io,
    getDir: async () => "/n",
    getMaxSaveMs: () => 5000,
    getHistory: () => ({ on: true, keep: 5, minutes: 1, capKB: 512, warnMB: 100 }),
    notify() {},
    windowId: "multiselect-test",
    now: nowFn,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    warn: () => {},
  });
  return { store, files };
}

let passed = 0;
async function run(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  const { core, document, Ev, El, raf } = loadNotes();

  await run("pure: applyTreeSelection supports Ctrl/Cmd toggle, Shift range, Ctrl+Shift union, and plain reset", () => {
    assert.equal(typeof core.applyTreeSelection, "function", "applyTreeSelection exported on core");
    const order = ["f:work", "n:a", "n:b", "f:personal", "n:c"];
    let st = { selected: new Set(), anchor: "" };

    // Ctrl+Click selects a single item and sets anchor
    st = core.applyTreeSelection(st, "n:a", order, { toggle: true });
    assert.deepEqual([...st.selected], ["n:a"]);
    assert.equal(st.anchor, "n:a");

    // Shift+Click extends range forward across notes and folders
    st = core.applyTreeSelection(st, "f:personal", order, { shift: true });
    assert.deepEqual([...st.selected], ["n:a", "n:b", "f:personal"]);
    assert.equal(st.anchor, "n:a", "anchor remains stable during Shift range selection");

    // Shift+Click backward selects upward range
    st = core.applyTreeSelection(st, "f:work", order, { shift: true });
    assert.deepEqual([...st.selected], ["f:work", "n:a"]);

    // Ctrl+Click toggles an extra item on, then off
    st = core.applyTreeSelection(st, "n:c", order, { toggle: true });
    assert.deepEqual([...st.selected].sort(), ["f:work", "n:a", "n:c"]);
    st = core.applyTreeSelection(st, "n:a", order, { toggle: true });
    assert.deepEqual([...st.selected].sort(), ["f:work", "n:c"]);

    // Ctrl+Shift+Click unions range with existing selection
    st = core.applyTreeSelection(st, "f:personal", order, { toggle: true, shift: true });
    assert.ok(st.selected.has("f:work") && st.selected.has("n:a") && st.selected.has("n:b") && st.selected.has("f:personal") && st.selected.has("n:c"));

    // Plain click clears selection and sets new anchor
    st = core.applyTreeSelection(st, "n:b", order, {});
    assert.equal(st.selected.size, 0);
    assert.equal(st.anchor, "n:b");
  });

  await run("pure: resolveTreeSelection deduplicates folders/pinned rows, expands descendants, and skips foreign shared notes", () => {
    assert.equal(typeof core.resolveTreeSelection, "function", "resolveTreeSelection exported on core");
    const folders = [
      { id: "work", label: "Work" },
      { id: "work/sub", label: "Sub" },
      { id: "other", label: "Other" },
    ];
    const notes = [
      { id: "n1", folder: "work", body: "# N1", trashed: 0 },
      { id: "n2", folder: "work/sub", body: "# N2", trashed: 0 },
      { id: "n3", folder: "other", body: "# N3", trashed: 0 },
      { id: "n4", folder: "", body: "# Shared", trashed: 0, _sharedFromOtherSpace: true },
    ];
    const res = core.resolveTreeSelection(["f:work", "f:work/sub", "n:n2", "p:n3", "n:n3", "n:n4"], notes, folders);
    assert.deepEqual([...res.topFolderIds], ["work"], "descendant folder work/sub subsumed by selected parent work");
    assert.deepEqual([...res.directNoteIds].sort(), ["n2", "n3", "n4"]);
    assert.deepEqual([...res.movableNoteIds], ["n3"], "n2 moves with work folder; foreign shared n4 excluded");
    assert.deepEqual([...res.effectiveNotes].map((n) => n.id).sort(), ["n1", "n2", "n3", "n4"]);
    assert.deepEqual([...res.trashableNotes].map((n) => n.id).sort(), ["n1", "n2", "n3"], "foreign shared note excluded from trashableNotes");
    assert.equal(res.counts.sharedSkipped, 1);

    // Pure batch tag helpers
    assert.equal(core.cleanBatchTag("#Work/Q4"), "Work/Q4");
    assert.equal(core.cleanBatchTag("bad tag!"), "");
    const b1 = core.appendTagToBody({ body: "# Title\nHello" }, "Work/Q4");
    assert.equal(b1, "# Title\nHello\n\n#Work/Q4");
    assert.equal(core.appendTagToBody({ body: b1 }, "work/q4"), b1, "idempotent: does not duplicate existing tag");
    assert.equal(core.appendTagToBody({ body: b1 }, "urgent"), "# Title\nHello\n\n#Work/Q4 #urgent", "appends onto existing trailing tag line");
  });

  await run("UI: Ctrl/Cmd+Click, Shift+Click, Escape, batch Move, Tag/Label/Category, Export, and Trash in tree view", async () => {
    const { store } = createMemoryStore(core);
    await store.open();
    const archiveId = store.addFolder("Archive", "");
    const workId = store.addFolder("Work", "");
    const n2 = store.create("# Beta\nSecond note", workId);
    const n1 = store.create("# Alpha\nFirst note", workId);
    const n3 = store.create("# Gamma\nTop level note", "");
    // Add a calendar item linked to n1 so batch category assignment can be verified
    store.items.upsertCategory?.({ name: "Urgent", color: "#e5534b" });
    const calItem = store.items.create?.({
      kind: "event",
      title: "Alpha Sync",
      noteId: n1.id,
      start: Date.parse("2026-11-18T10:00:00.000Z"),
      end: Date.parse("2026-11-18T11:00:00.000Z"),
      category: "Personal",
    });

    const exportedAll = [], exportedZip = [], exportedVault = [];
    const host = new El("div");
    const adapter = {
      position: "fixed", host, attach: (r) => host.appendChild(r),
      getArea: () => ({ left: 0, top: 0, width: 900, height: 900, anchor: "top" }),
      watch: () => () => {}, setActive() {}, rewatch() {},
    };
    const env = {
      readOpts: () => ({}),
      openLink() {}, copyText() {}, exportNote() {},
      exportAll: (list) => { exportedAll.push(list.map((x) => x.id)); },
      exportZip: async (list) => { exportedZip.push(list.map((x) => x.id)); return list.length; },
      exportObsidianVault: async ({ notes }) => { exportedVault.push((notes || []).map((x) => x.id)); return { ok: true, counts: { notes: (notes || []).length } }; },
      revealFolder() {}, getPref: (_k, d) => d, setPref() {}, now: () => Date.now(),
    };
    await store.flush();
    const sheet = core.createSheet({ store, adapter, env, ensureStore: async () => true });
    sheet.root.ownerDocument = document;
    await sheet.open();
    const flush = async () => { for (let i = 0; i < 6; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
    // Switch to All notes view
    const listBtn = sheet.root.querySelector(".zn-list-btn");
    assert.ok(listBtn, "All notes button exists");
    listBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();

    const rowFor = (key) => sheet.root.querySelectorAll(".zn-item").find((el) => (el.dataset?.key || el.getAttribute?.("data-key")) === key);
    const batchBar = sheet.root.querySelector(".zn-batch-bar");
    assert.ok(batchBar, "batch action bar element exists");
    assert.equal(batchBar.hidden, true, "batch bar is hidden when nothing is multi-selected");

    // 1. Ctrl+Click selects Alpha without opening it
    const alphaRow = rowFor("n:" + n1.id);
    assert.ok(alphaRow, "Alpha row rendered in tree");
    alphaRow.dispatchEvent(new Ev("click", { bubbles: true, ctrlKey: true }));
    await flush();
    assert.equal(batchBar.hidden, false, "batch bar shown after Ctrl+Click");
    assert.equal(alphaRow.getAttribute("aria-selected"), "true");
    assert.ok(alphaRow.classList.contains("is-selected"));
    assert.match(batchBar.textContent, /1 selected/);

    // 2. Shift+Click on Gamma selects range from Alpha through Gamma
    const gammaRow = rowFor("n:" + n3.id);
    assert.ok(gammaRow, "Gamma row rendered in tree");
    gammaRow.dispatchEvent(new Ev("click", { bubbles: true, shiftKey: true }));
    await flush();
    assert.equal(rowFor("n:" + n1.id).getAttribute("aria-selected"), "true");
    assert.equal(rowFor("n:" + n2.id).getAttribute("aria-selected"), "true");
    assert.equal(rowFor("n:" + n3.id).getAttribute("aria-selected"), "true");

    // 3. Batch Export (as ZIP) exports exact selected notes
    const exportBtn = [...batchBar.querySelectorAll("button")].find((b) => /Export/i.test(b.textContent));
    assert.ok(exportBtn, "Export button in batch bar");
    exportBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const zipChoice = sheet.root.querySelectorAll(".zn-menu-item").find((el) => /ZIP/i.test(el.textContent));
    assert.ok(zipChoice, "Export as ZIP option in batch export menu");
    zipChoice.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    // Confirm export dialog if shown, else direct
    const confirmZipBtn = sheet.root.querySelectorAll(".zn-dialog button").find((b) => /Choose where to save|Export|Keep|Convert/i.test(b.textContent));
    if (confirmZipBtn) { confirmZipBtn.dispatchEvent(new Ev("click", { bubbles: true })); await flush(); }
    assert.equal(exportedZip.length, 1, "batch ZIP export invoked");
    assert.deepEqual([...exportedZip[0]].sort(), [n1.id, n2.id, n3.id].sort(), "batch export included all 3 selected notes");

    // 4. Batch Tag / Label / Category assignment
    const tagBtn = [...batchBar.querySelectorAll("button")].find((b) => /Tag|Label|Category/i.test(b.textContent));
    assert.ok(tagBtn, "Tag/Label/Category button in batch bar");
    tagBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const inputs = sheet.root.querySelectorAll(".zn-dialog input");
    assert.ok(inputs.length >= 2, "tag and label inputs present in batch assign dialog");
    inputs[0].value = "Q4/Release";
    inputs[1].value = "Priority";
    // Pick Urgent category chip if present
    const catChip = sheet.root.querySelectorAll(".zn-dialog button").find((b) => b.textContent.trim() === "Urgent");
    if (catChip) catChip.dispatchEvent(new Ev("click", { bubbles: true }));
    const applyAssign = sheet.root.querySelectorAll(".zn-dialog button").find((b) => /^Apply/i.test(b.textContent));
    assert.ok(applyAssign, "Apply button present in batch assign dialog");
    applyAssign.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();

    for (const id of [n1.id, n2.id, n3.id]) {
      const updated = store.get(id);
      assert.ok(core.noteTags(updated).includes("Q4/Release"), "tag assigned to " + id);
      assert.equal(updated.label, "Priority", "label assigned to " + id);
    }
    if (calItem) {
      assert.equal(store.items.get(calItem.id).category, "Urgent", "calendar category assigned to linked item");
    }

    // 5. Batch Move to Archive folder
    const moveBtn = [...batchBar.querySelectorAll("button")].find((b) => /Move/i.test(b.textContent));
    assert.ok(moveBtn, "Move button in batch bar");
    moveBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const archiveTarget = sheet.root.querySelectorAll(".zn-dialog button").find((b) => b.dataset?.fid === archiveId);
    assert.ok(archiveTarget, "Archive folder option in batch move picker");
    archiveTarget.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    for (const id of [n1.id, n2.id, n3.id]) {
      assert.equal(store.get(id).folder, archiveId, "note " + id + " moved to Archive");
    }

    // 6. Right-click on a selected folder (select Archive folder with Meta+Click -> right-click -> batch menu -> Move to Trash)
    const clearBtn = [...batchBar.querySelectorAll("button")].find((b) => /Clear/i.test(b.textContent || b.title || ""));
    assert.ok(clearBtn, "Clear button in batch bar");
    clearBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    assert.equal(batchBar.hidden, true, "Clear hides batch bar");

    const archiveRow = rowFor("f:" + archiveId);
    assert.ok(archiveRow, "Archive folder row exists");
    archiveRow.dispatchEvent(new Ev("click", { bubbles: true, metaKey: true }));
    await flush();
    assert.equal(batchBar.hidden, false, "Cmd/Meta+Click selects folder without collapsing it");
    assert.equal(store.meta.folders.find((f) => f.id === archiveId).collapsed, false, "Meta+Click did not toggle folder collapse");

    // Batch context menu on selected folder
    archiveRow.dispatchEvent(new Ev("contextmenu", { bubbles: true, clientX: 50, clientY: 50 }));
    await flush();
    const batchTrashMenu = sheet.root.querySelectorAll(".zn-menu-item").find((el) => /Move selected to trash/i.test(el.textContent));
    assert.ok(batchTrashMenu, "right-clicking a selected row opens batch context menu with Move selected to trash");
    batchTrashMenu.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    // If confirmation dialog opens (due to linked calendar item/bulk trash), confirm it
    const confirmTrash = sheet.root.querySelectorAll(".zn-dialog button").find((b) => /Move.*Trash/i.test(b.textContent));
    if (confirmTrash) { confirmTrash.dispatchEvent(new Ev("click", { bubbles: true })); await flush(); }
    assert.equal(store.get(n1.id).trashed > 0, true, "Alpha inside Archive moved to Trash");
    assert.equal(store.get(n2.id).trashed > 0, true, "Beta inside Archive moved to Trash");
    assert.equal(store.get(n3.id).trashed > 0, true, "Gamma inside Archive moved to Trash");
    assert.equal(batchBar.hidden, true, "batch bar clears after batch Trash");

    // 7. Escape clears multi-selection
    const workRow = rowFor("f:" + workId);
    workRow.dispatchEvent(new Ev("click", { bubbles: true, ctrlKey: true }));
    await flush();
    assert.equal(batchBar.hidden, false);
    sheet.root.dispatchEvent(new Ev("keydown", { key: "Escape", bubbles: true }));
    await flush();
    assert.equal(batchBar.hidden, true, "Escape clears active tree multi-selection");

    sheet.destroy();
  });

  console.log(`notes-tree-multiselect: ${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
