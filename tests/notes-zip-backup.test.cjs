"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createFakeDom = require("./helpers/fake-dom.cjs");

const notesPath = path.join(__dirname, "..", "additional", "notes", "ZentralNotes.uc.js");
const calPath = path.join(__dirname, "..", "additional", "notes", "calendar", "ZentralNotesCalendar.js");
const flavorsPath = path.join(__dirname, "..", "additional", "notes", "flavors", "ZentralNotesFlavors.js");

function loadNotesCore() {
  const dom = createFakeDom();
  const { Ev, document, raf } = dom;
  const calMod = require(calPath);
  const flavorsMod = require(flavorsPath);
  const window = {
    document,
    __zentralNotesTestSeam: {},
    __zentralNotesParts: { "notes-calendar": calMod, "notes-flavors": flavorsMod },
    ZentralRuntime: { register() {} },
    requestAnimationFrame: (fn) => raf.push(fn),
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
  };
  window.window = window;
  const ctx = vm.createContext({
    window,
    document,
    Event: Ev,
    globalThis: { Services: {} },
    ChromeUtils: {},
    URL,
    Date,
    JSON,
    Math,
    Promise,
    RegExp,
    Number,
    Map,
    Set,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    navigator: { platform: "Linux" },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    requestAnimationFrame: (fn) => raf.push(fn),
    cancelAnimationFrame() {},
  });
  vm.runInContext(fs.readFileSync(notesPath, "utf8"), ctx, { filename: notesPath });
  const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
  return { core: window.__zentralNotesTestSeam.core, window, document, Ev, flushRaf, calMod };
}

function createMemoryIo() {
  const files = new Map();
  const dirs = new Set(["/vault"]);
  const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  const parentOf = (p) => { const n = norm(p); const i = n.lastIndexOf("/"); return i <= 0 ? "/" : n.slice(0, i); };
  const ensureParents = (p) => {
    let cur = parentOf(p);
    while (cur && !dirs.has(cur)) { dirs.add(cur); cur = parentOf(cur); }
  };
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return {
    files,
    dirs,
    join: (...parts) => norm(parts.filter(Boolean).join("/")),
    filename: (p) => norm(p).split("/").pop() || "",
    async exists(p) { const n = norm(p); return files.has(n) || dirs.has(n); },
    async makeDir(p) { const n = norm(p); ensureParents(n); dirs.add(n); },
    async stat(p) {
      const n = norm(p);
      if (files.has(n)) { const e = files.get(n); return { type: "regular", size: e.bytes.length, lastModified: e.mtime }; }
      if (dirs.has(n)) return { type: "directory", size: 0, lastModified: Date.now() };
      throw Object.assign(new Error("ENOENT: " + n), { code: "ENOENT" });
    },
    async children(p) {
      const prefix = norm(p) + "/";
      const found = new Set();
      for (const k of files.keys()) if (k.startsWith(prefix)) found.add(prefix + k.slice(prefix.length).split("/")[0]);
      for (const d of dirs) if (d.startsWith(prefix)) found.add(prefix + d.slice(prefix.length).split("/")[0]);
      return [...found].sort();
    },
    async readUTF8(p) {
      const n = norm(p);
      if (!files.has(n)) throw Object.assign(new Error("ENOENT: " + n), { code: "ENOENT" });
      return dec.decode(files.get(n).bytes);
    },
    async writeUTF8(p, text) {
      const n = norm(p);
      ensureParents(n);
      files.set(n, { bytes: enc.encode(String(text)), mtime: Date.now() });
    },
    async readBytes(p) {
      const n = norm(p);
      if (!files.has(n)) throw Object.assign(new Error("ENOENT: " + n), { code: "ENOENT" });
      return new Uint8Array(files.get(n).bytes);
    },
    async writeBytes(p, bytes) {
      const n = norm(p);
      ensureParents(n);
      files.set(n, { bytes: new Uint8Array(bytes), mtime: Date.now() });
    },
    async remove(p) { files.delete(norm(p)); },
    async removeTree(p) {
      const n = norm(p);
      files.delete(n); dirs.delete(n);
      for (const k of [...files.keys()]) if (k.startsWith(n + "/")) files.delete(k);
      for (const d of [...dirs]) if (d.startsWith(n + "/")) dirs.delete(d);
    },
    async moveTree(from, to) {
      const f = norm(from), t = norm(to);
      if (files.has(f)) { ensureParents(t); files.set(t, files.get(f)); files.delete(f); return; }
      ensureParents(t); dirs.add(t);
      for (const k of [...files.keys()]) if (k.startsWith(f + "/")) { ensureParents(t + k.slice(f.length)); files.set(t + k.slice(f.length), files.get(k)); files.delete(k); }
      for (const d of [...dirs]) if (d.startsWith(f + "/")) { dirs.add(t + d.slice(f.length)); dirs.delete(d); }
      dirs.delete(f);
    },
  };
}

// Valid minimal PNG (8-byte PNG signature + IHDR header) and minimal MP4 (ftyp box)
const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
const FAKE_MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
const FAKE_PDF = new TextEncoder().encode("%PDF-1.4\nhello attachment\n");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  const { core, window, document, Ev, flushRaf } = loadNotesCore();
  const enc = new TextEncoder();
  const makeStore = (io, clockRef, windowId = "w1") =>
    core.createStore({
      io,
      getDir: async () => "/vault",
      now: () => ++clockRef.now,
      notify() {},
      windowId,
      getMaxSaveMs: () => 5000,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      warn() {},
    });

  await test("pure path and entry classification rejects zip-slip, hidden junk, bad ids and spoofed media", async () => {
    assert.equal(typeof core.cleanBackupZipPath, "function");
    assert.equal(typeof core.classifyBackupEntry, "function");
    assert.equal(typeof core.inspectBackupEntries, "function");
    assert.equal(typeof core.planBackupRestore, "function");

    assert.equal(core.cleanBackupZipPath("../evil.md"), "");
    assert.equal(core.cleanBackupZipPath("notes/../../etc/passwd"), "");
    assert.equal(core.cleanBackupZipPath("/absolute/path.md"), "");
    assert.equal(core.cleanBackupZipPath("C:\\evil\\file.md"), "");
    assert.equal(core.cleanBackupZipPath("notes/ok_1.md"), "notes/ok_1.md");
    assert.equal(core.cleanBackupZipPath("assets\\n1\\pic.png"), "assets/n1/pic.png");

    assert.equal(core.classifyBackupEntry("manifest.json")?.kind, "manifest");
    assert.equal(core.classifyBackupEntry("meta.json")?.kind, "meta");
    assert.equal(core.classifyBackupEntry("calendar.json")?.kind, "calendar");
    assert.equal(core.classifyBackupEntry("reminder-history.json")?.kind, "history");
    assert.equal(core.classifyBackupEntry("notes/note_abc.md")?.kind, "note");
    assert.equal(core.classifyBackupEntry("assets/note_abc/img-1.png")?.kind, "asset");
    assert.equal(core.classifyBackupEntry("assets/note_abc/clip.mp4")?.kind, "asset");
    assert.equal(core.classifyBackupEntry("assets/note_abc/doc.pdf")?.kind, "asset");
    assert.equal(core.classifyBackupEntry("__MACOSX/notes/note_abc.md"), null);
    assert.equal(core.classifyBackupEntry(".DS_Store"), null);
    assert.equal(core.classifyBackupEntry("notes/bad name!.md"), null);
    assert.equal(core.classifyBackupEntry("evil.exe"), null);

    // Spoofed PNG bytes (HTML disguised as .png) must be skipped, never accepted as a valid asset
    const inspected = core.inspectBackupEntries([
      { path: "manifest.json", bytes: enc.encode(JSON.stringify({ format: "zentral-notes-backup", version: 1 })) },
      { path: "notes/n1.md", bytes: enc.encode("---\nid: n1\n---\n# Hello\n") },
      { path: "assets/n1/real.png", bytes: FAKE_PNG },
      { path: "assets/n1/spoof.png", bytes: enc.encode("<script>alert(1)</script>") },
      { path: "../escape.md", bytes: enc.encode("bad") },
    ]);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.notes.length, 1);
    assert.equal(inspected.assets.length, 1);
    assert.equal(inspected.assets[0].rel, "assets/n1/real.png");
    assert.ok(inspected.skipped.some((s) => s.path === "assets/n1/spoof.png"));
    assert.ok(inspected.skipped.some((s) => s.path === "../escape.md"));

    // Future unsupported version fails closed
    const future = core.inspectBackupEntries([
      { path: "manifest.json", bytes: enc.encode(JSON.stringify({ format: "zentral-notes-backup", version: 99 })) },
      { path: "notes/n1.md", bytes: enc.encode("# Hello\n") },
    ]);
    assert.equal(future.ok, false);
    assert.match(future.error, /version/i);

    // Empty/non-backup ZIP fails closed
    const empty = core.inspectBackupEntries([{ path: "readme.txt", bytes: enc.encode("unrelated") }]);
    assert.equal(empty.ok, false);
  });

  await test("full store round-trip backs up notes, trash, folders, PNG/MP4/PDF assets, calendar and history and restores cleanly", async () => {
    const ioA = createMemoryIo();
    const clockRef = { now: 1763337600000 };
    const storeA = makeStore(ioA, clockRef, "wA");
    await storeA.open();

    // Create folders with styles
    storeA.addFolder("Work");
    storeA.setFolderStyle("work", { color: "blue", icon: "📁" });
    storeA.addFolder("Specs", "work");

    // Create live note with front matter, wikilink, calendar marker, and attached PNG + MP4 + PDF
    const n1 = storeA.create("# Project Plan\n\n- [ ] 2026-11-20 10:00 Ship release\n", "work/specs");
    storeA.setColor(n1.id, "green");
    storeA.setLabel(n1.id, "important");
    storeA.setPinned(n1.id, true);
    storeA.setFlavor(n1.id, "obsidian");
    const savedPng = await storeA.saveAsset(n1.id, FAKE_PNG, "image/png");
    assert.equal(savedPng.ok, true);
    const savedMp4 = await storeA.saveFile(n1.id, "demo.mp4", FAKE_MP4);
    assert.equal(savedMp4.ok, true);
    const savedPdf = await storeA.saveFile(n1.id, "spec.pdf", FAKE_PDF);
    assert.equal(savedPdf.ok, true);
    storeA.update(n1.id, `# Project Plan\n\n![img](${savedPng.rel})\n![clip](${savedMp4.rel})\n[spec](${savedPdf.rel})\n\n%%calendar: Launch%%\n- [ ] 2026-11-20 10:00 Ship release\n`);

    // Create trashed note (with a calendar reminder that must stay hidden after restore)
    const nTrash = storeA.create("# Old Draft\n%%calendar%%\n- [ ] 2026-11-22 09:00 Trashed reminder\n", "work");
    await storeA.flush();
    assert.equal(storeA.items.list({ noteId: nTrash.id }).length, 1, "note reminder exists before trashing");
    storeA.trash(nTrash.id);

    // Add standalone calendar item, custom category, and history record
    storeA.items.upsertCategory({ name: "Launch", color: "#8b5cf6" });
    const standalone = storeA.items.upsert({ summary: "Release review", start: { date: "2026-11-21", time: "14:00" }, end: { date: "2026-11-21", time: "15:00" }, x: { kind: "event", category: "Launch" } });
    assert.ok(standalone?.id);
    storeA.items.history.append({ itemId: standalone.id, occurrenceId: standalone.id, summary: "Release review", start: standalone.start, action: "done", at: clockRef.now });

    const archive = await storeA.buildBackupArchive();
    assert.equal(archive.manifest.format, "zentral-notes-backup");
    assert.equal(archive.manifest.version, 1);
    assert.equal(archive.counts.notes, 1);
    assert.equal(archive.counts.trashed, 1);
    assert.equal(archive.counts.assets, 3);
    assert.equal(archive.counts.meta, true);
    assert.equal(archive.counts.calendar, true);
    assert.equal(archive.counts.history, true);
    const paths = new Set(archive.entries.map((e) => e.path));
    assert.ok(paths.has("manifest.json"));
    assert.ok(paths.has("meta.json"));
    assert.ok(paths.has("calendar.json"));
    assert.ok(paths.has("reminder-history.json"));
    assert.ok(paths.has(`notes/${n1.id}.md`));
    assert.ok(paths.has(`notes/${nTrash.id}.md`));
    assert.ok(paths.has(savedPng.rel));
    assert.ok(paths.has(savedMp4.rel));
    assert.ok(paths.has(savedPdf.rel));

    // Restore into a brand-new empty vault storeB
    const ioB = createMemoryIo();
    const storeB = makeStore(ioB, clockRef, "wB");
    await storeB.open();
    const res1 = await storeB.restoreBackupArchive(archive.entries, { mode: "merge" });
    assert.equal(res1.ok, true);
    assert.equal(res1.restoredNotes, 2);
    assert.equal(res1.restoredAssets, 3);
    assert.equal(res1.skippedNotes, 0);

    const restored1 = storeB.get(n1.id);
    assert.ok(restored1, "live note restored under original id");
    assert.equal(restored1.folder, "work/specs");
    assert.equal(restored1.color, "green");
    assert.equal(restored1.label, "important");
    assert.equal(restored1.pinned, true);
    assert.equal(restored1.flavor, "obsidian");
    assert.ok(restored1.body.includes(savedPng.rel));
    assert.equal(storeB.get(nTrash.id)?.trashed > 0, true, "trashed note preserved in Trash");
    assert.equal(storeB.items.list({ noteId: nTrash.id }).length, 0, "trashed note calendar reminders stay hidden in calendar views after restore");
    assert.equal(storeB.items.list({ noteId: nTrash.id, includeHidden: true }).length, 1, "trashed note calendar reminder is still preserved under Trash");

    // Verify all 3 binary assets round-trip byte-for-byte
    assert.deepEqual((await storeB.readAsset(savedPng.rel))?.bytes, FAKE_PNG);
    assert.deepEqual((await storeB.readAsset(savedMp4.rel))?.bytes, FAKE_MP4);
    assert.deepEqual((await storeB.readAsset(savedPdf.rel))?.bytes, FAKE_PDF);

    // Verify folder styles + calendar + history restored
    const workFolder = storeB.meta.folders.find((f) => f.id === "work");
    assert.equal(workFolder?.label, "Work");
    assert.equal(workFolder?.color, "blue");
    assert.equal(workFolder?.icon, "📁");
    assert.ok(storeB.items.get(standalone.id), "standalone calendar event restored");
    assert.equal(storeB.items.category("Launch")?.color, "#8b5cf6");
    assert.ok(storeB.items.history.list({ itemId: standalone.id }).some((r) => r.action === "done"));

    // Idempotent re-restore in merge mode creates ZERO duplicates
    const historyCountBefore = storeB.items.history.list().length;
    const res2 = await storeB.restoreBackupArchive(archive.entries, { mode: "merge" });
    assert.equal(res2.ok, true);
    assert.equal(res2.restoredNotes, 0);
    assert.equal(res2.skippedNotes, 2);
    assert.equal(res2.restoredAssets, 0);
    assert.equal(res2.skippedAssets, 3);
    assert.equal(storeB.list().length, 1);
    assert.equal(storeB.list({ trashed: true }).length, 1);
    assert.equal(storeB.items.history.list().length, historyCountBefore, "history is never duplicated on re-restore");

    // Edit note in storeB and add a brand-new local note
    storeB.update(n1.id, "# Project Plan (Edited Locally)\nKeep local edits\n");
    const localOnly = storeB.create("# Local Only Note\nCreated after backup\n");
    await storeB.flush();

    // Merge mode keeps local edits intact
    const resMerge = await storeB.restoreBackupArchive(archive.entries, { mode: "merge" });
    assert.equal(resMerge.ok, true);
    assert.equal(resMerge.overwrittenNotes, 0);
    assert.match(storeB.get(n1.id).body, /Edited Locally/);
    assert.ok(storeB.get(localOnly.id), "local-only note untouched");

    // Overwrite mode saves displaced edit in 48h recovery folder first, restores backup copy, AND preserves localOnly
    const resOver = await storeB.restoreBackupArchive(archive.entries, { mode: "overwrite" });
    assert.equal(resOver.ok, true);
    assert.equal(resOver.overwrittenNotes, 1);
    assert.match(storeB.get(n1.id).body, /Ship release/, "backed-up body restored");
    assert.ok(storeB.get(localOnly.id), "notes not in backup are preserved even in overwrite mode");
    const recoveryCopies = await storeB.listBackups();
    assert.ok(recoveryCopies.some((b) => b.id === n1.id), "displaced edit was copied to 48h recovery folder before overwrite");

    await storeA.close();
    await storeB.close();
  });

  await test("Import & export menu exposes Backup all (ZIP with assets) and Restore from ZIP backup dialog", async () => {
    const io = createMemoryIo();
    const clockRef = { now: 1763337600000 };
    const store = makeStore(io, clockRef, "wUI");
    await store.open();
    const n1 = store.create("# Demo\nHello\n");
    await store.flush();

    const calls = [];
    const fakeEntries = [
      { path: "manifest.json", bytes: enc.encode(JSON.stringify({ format: "zentral-notes-backup", version: 1 })) },
      { path: "notes/n_new.md", bytes: enc.encode("---\nid: n_new\n---\n# Restored\n") },
    ];
    const parsedFake = core.inspectBackupEntries(fakeEntries);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const adapter = { position: "fixed", host, attach: (r) => host.appendChild(r), getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
    const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
    const sheet = core.createSheet({
      store,
      adapter,
      ensureStore: () => store.open(),
      env: {
        openLink() {}, copyText() {}, revealFolder() {},
        exportNote() {}, exportAll() {}, exportZip() {}, importFolder: async () => 0, printNote() {},
        exportBackupZip: async () => { calls.push(["exportBackupZip"]); return { ok: true, counts: { notes: 1, trashed: 0, assets: 2 } }; },
        pickBackupZip: async () => { calls.push(["pickBackupZip"]); return { entries: fakeEntries, parsed: parsedFake }; },
        restoreBackupZip: async (entries, opts) => { calls.push(["restoreBackupZip", entries.length, opts.mode]); return { ok: true, restoredNotes: 1, overwrittenNotes: 0, skippedNotes: 0, restoredAssets: 0, skippedAssets: 0 }; },
        readOpts: () => ({ flavor: "mixed", tilde: "sub", ignore: "" }),
        getPref: (_k, d) => d, setPref() {}, loadAsset: async () => null, now: () => clockRef.now,
        storeWhenReady: () => Promise.resolve(), withStore: (fn) => fn(),
      },
    });
    sheet.root.ownerDocument = document;
    await sheet.open();
    sheet.openNoteById(n1.id);
    await flushRaf();

    const openImportExport = () => {
      const moreBtn = sheet.root.all().find((b) => b.title === "More" || b.getAttribute("aria-label") === "More");
      assert.ok(moreBtn, "More button exists");
      click(moreBtn);
      const group = sheet.root.querySelector(".zn-menu").querySelectorAll("button").find((b) => b.textContent.includes("Import & export"));
      assert.ok(group, "Import & export submenu exists");
      click(group);
    };
    const menuBtn = (label) => sheet.root.querySelector(".zn-menu").querySelectorAll("button").find((b) => b.textContent.includes(label));

    openImportExport();
    const backupBtn = menuBtn("Backup all (ZIP with assets)");
    const restoreBtn = menuBtn("Restore from ZIP backup");
    assert.ok(backupBtn, "Backup all (ZIP with assets) menu entry exists");
    assert.ok(restoreBtn, "Restore from ZIP backup menu entry exists");

    click(backupBtn);
    await flushRaf();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(calls[0], ["exportBackupZip"]);

    // Restore flow: Merge (keep existing)
    openImportExport();
    click(menuBtn("Restore from ZIP backup"));
    await flushRaf();
    await new Promise((r) => setTimeout(r, 10));
    const dialog = sheet.root.querySelector(".zn-dialog");
    assert.ok(dialog && dialog.all().some((e) => e.getAttribute("aria-label") === "Restore from ZIP backup"), "Restore confirmation dialog opened");
    const mergeBtn = dialog.querySelectorAll("button").find((b) => b.textContent === "Merge (keep existing)");
    assert.ok(mergeBtn, "Merge button present");
    click(mergeBtn);
    await flushRaf();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(calls.at(-1), ["restoreBackupZip", 2, "merge"]);

    // Restore flow: Overwrite matching
    openImportExport();
    click(menuBtn("Restore from ZIP backup"));
    await flushRaf();
    await new Promise((r) => setTimeout(r, 10));
    const dialog2 = sheet.root.querySelector(".zn-dialog");
    const overBtn = dialog2.querySelectorAll("button").find((b) => b.textContent === "Overwrite matching");
    assert.ok(overBtn, "Overwrite matching button present");
    click(overBtn);
    await flushRaf();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(calls.at(-1), ["restoreBackupZip", 2, "overwrite"]);

    sheet.destroy();
    await store.close();
  });

  await test("OW-18 space-local backups exclude foreign notes and corrupt optional JSON never blocks valid note restore", async () => {
    const io = createMemoryIo();
    const clockRef = { now: 1763337600000 };
    const wsA = { uuid: "spaceA", name: "Space A", icon: "", dirKey: "spaceA", ready: true };
    const wsB = { uuid: "spaceB", name: "Space B", icon: "", dirKey: "spaceB", ready: true };
    const storeA = core.createStore({
      io,
      getDir: async () => "/vault",
      getSpaceMode: () => "space",
      getWorkspaceIdentity: () => wsA,
      getWorkspaces: () => [wsA, wsB],
      now: () => ++clockRef.now,
      notify() {},
      windowId: "wSpaceA",
      getMaxSaveMs: () => 5000,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      warn() {},
    });
    const storeB = core.createStore({
      io,
      getDir: async () => "/vault",
      getSpaceMode: () => "space",
      getWorkspaceIdentity: () => wsB,
      getWorkspaces: () => [wsA, wsB],
      now: () => ++clockRef.now,
      notify() {},
      windowId: "wSpaceB",
      getMaxSaveMs: () => 5000,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      warn() {},
    });
    await storeB.open();
    const foreignNote = storeB.create("# Shared From Space B\nVisible across spaces\n");
    assert.equal(await storeB.shareNote(foreignNote.id, ["spaceA"]), true);
    await storeB.flush();

    await storeA.open();
    const localNote = storeA.create("# Local Space A\nMine\n");
    await storeA.flush();

    // storeA sees both localNote and foreignNote, but its backup MUST ONLY include localNote
    assert.ok(storeA.get(foreignNote.id)?._sharedFromOtherSpace, "spaceA sees foreign shared note");
    const archiveA = await storeA.buildBackupArchive();
    const notePaths = archiveA.entries.filter((e) => e.path.startsWith("notes/")).map((e) => e.path);
    assert.deepEqual([...notePaths], [`notes/${localNote.id}.md`]);

    // Corrupt meta.json / calendar.json are skipped cleanly while valid notes still restore
    const damaged = [
      { path: "manifest.json", bytes: enc.encode(JSON.stringify({ format: "zentral-notes-backup", version: 1 })) },
      { path: "meta.json", bytes: enc.encode("{broken json") },
      { path: "calendar.json", bytes: enc.encode("[]") },
      { path: "notes/n_salvaged.md", bytes: enc.encode("---\nid: n_salvaged\n---\n# Salvaged\nStill restores\n") },
    ];
    const inspectedDamaged = core.inspectBackupEntries(damaged);
    assert.equal(inspectedDamaged.ok, true);
    assert.equal(inspectedDamaged.notes.length, 1);
    assert.equal(inspectedDamaged.skipped.length, 2);

    // Over-entry-count zip bomb fails closed
    const tooMany = Array.from({ length: core.BACKUP_MAX_ENTRIES + 1 }, (_, i) => ({ path: `notes/n${i}.md`, bytes: enc.encode("x") }));
    const bomb = core.inspectBackupEntries(tooMany);
    assert.equal(bomb.ok, false);
    assert.match(bomb.error, /too many/i);

    await storeA.close();
    await storeB.close();
  });

  console.log(`\nALL ${passed} ZIP BACKUP & RESTORE TESTS PASSED`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
