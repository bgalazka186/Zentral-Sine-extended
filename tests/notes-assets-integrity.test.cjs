"use strict";
/* T1.17 asset inventory and cleanup safety: pure reference report + store filesystem seam. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, Uint8Array, console });
const c = seam.core;
const plain = (v) => JSON.parse(JSON.stringify(v));
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok -", name); };

function fakeIO() {
  const files = new Map(), dirs = new Set();
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  return {
    files, dirs,
    join: (...parts) => norm(parts.join("/")), filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("missing"); return files.get(p).text; },
    writeUTF8: async (p, text) => files.set(p, { text, mtime: Date.now() }),
    remove: async (p) => { if (!files.has(p)) throw new Error("missing"); files.delete(p); },
    exists: async (p) => files.has(p) || dirs.has(p),
    children: async (folder) => {
      if (!dirs.has(folder) && ![...dirs].some((d) => d.startsWith(folder + "/")) && ![...files.keys()].some((f) => f.startsWith(folder + "/"))) throw new Error("missing folder");
      const paths = [...dirs, ...files.keys()].filter((p) => p.startsWith(folder + "/"));
      return [...new Set(paths.filter((p) => !p.slice(folder.length + 1).includes("/")))];
    },
    stat: async (p) => files.has(p) ? { type: "regular", size: files.get(p).bytes?.length ?? 0, lastModified: files.get(p).mtime || 0 } : { type: "directory", size: 0, lastModified: 0 },
    restrict: async () => {}, makeDir: async (p) => { dirs.add(p); const parent = p.slice(0, p.lastIndexOf("/")); if (parent) dirs.add(parent); },
    writeBytes: async (p, bytes) => { if (files.has(p)) throw new Error("exists"); dirs.add(p.slice(0, p.lastIndexOf("/"))); files.set(p, { bytes: new Uint8Array(bytes), mtime: Date.now() }); },
    readBytes: async (p) => { if (!files.has(p)) throw new Error("missing"); return new Uint8Array(files.get(p).bytes); },
    removeTree: async (folder) => { for (const p of [...files.keys()]) if (p.startsWith(folder + "/")) files.delete(p); for (const p of [...dirs]) if (p === folder || p.startsWith(folder + "/")) dirs.delete(p); },
  };
}

(async () => {
  await test("assetRefs includes note-local image and video transclusions as well as Markdown and generic file links", () => {
    const refs = [...c.assetRefs([
      "![[cover.png]]",
      "![[clip.webm]]",
      "![caption](assets/note_b/photo.jpg)",
      "[Download](assets/note_c/plan.pdf)",
      "`![ignored](assets/note_d/ignored.png)`",
      "~~~markdown",
      "![fenced](assets/note_e/fenced.png)",
      "~~~",
      "````markdown",
      "```",
      "![inner fence](assets/note_f/inner.png)",
      "````",
      "%% ![hidden](assets/note_g/hidden.png) %%",
      "<!-- ![comment](assets/note_h/comment.png) -->",
    ].join("\n"), "note_a")].sort();
    assert.deepEqual(plain(refs), [
      "assets/note_a/clip.webm", "assets/note_a/cover.png", "assets/note_b/photo.jpg", "assets/note_c/plan.pdf",
    ]);
  });

  await test("assetIntegrityReport separates unique broken refs and unreferenced valid files without mutating inputs", () => {
    const notes = Object.freeze([
      Object.freeze({ id: "note_a", body: "![[cover.png]]\n[Other](assets/note_b/shared.pdf)\n[Missing](assets/note_b/gone.pdf)" }),
      Object.freeze({ id: "note_c", body: "[Cover](assets/note_a/cover.png)\n![[not-there.mp4]]", trashed: 1 }),
    ]);
    const paths = Object.freeze([
      "assets/note_a/cover.png", "assets/note_b/shared.pdf", "assets/note_b/orphan.svg", "assets/note_x/not-valid?.pdf",
    ]);
    const report = plain(c.assetIntegrityReport(notes, paths));
    assert.deepEqual(report, {
      missing: [
        { rel: "assets/note_b/gone.pdf", noteIds: ["note_a"] },
        { rel: "assets/note_c/not-there.mp4", noteIds: ["note_c"] },
      ],
      orphaned: ["assets/note_b/orphan.svg"],
      referenced: 4,
      present: 3,
    });
    assert.equal(notes[0].body.includes("gone.pdf"), true);
    assert.equal(paths[0], "assets/note_a/cover.png");
  });

  await test("store scanner walks only safe per-note asset folders and includes Trash references", async () => {
    const io = fakeIO();
    const store = c.createStore({ io, notify() {}, windowId: "asset-scan", getDir: async () => "/notes", getMaxSaveMs: () => 5000, setTimer: () => 1, clearTimer: () => {} });
    await store.open();
    const live = store.create("# Live\n![[live.png]]\n[Plan](assets/other_id/plan.pdf)");
    const trashed = store.create("# Trash\n![[old.png]]");
    store.trash(trashed.id);
    await io.makeDir("/notes/assets/" + live.id);
    await io.makeDir("/notes/assets/other_id");
    await io.makeDir("/notes/assets/" + trashed.id);
    await io.writeBytes("/notes/assets/" + live.id + "/live.png", Uint8Array.from([1]));
    await io.writeBytes("/notes/assets/other_id/plan.pdf", Uint8Array.from([2]));
    await io.writeBytes("/notes/assets/" + live.id + "/unused.dat", Uint8Array.from([3]));
    await io.writeBytes("/notes/assets/" + trashed.id + "/old.png", Uint8Array.from([4]));
    const report = plain(await store.scanAssetIntegrity());
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.orphaned, ["assets/" + live.id + "/unused.dat"]);
    assert.equal(report.referenced, 3);
    assert.equal(report.present, 4);
  });

  await test("asset inventory treats an absent root as empty but propagates an incomplete or unreadable scan", async () => {
    const io = fakeIO();
    const store = c.createStore({ io, notify() {}, windowId: "asset-scan-errors", getDir: async () => "/notes", getMaxSaveMs: () => 5000, setTimer: () => 1, clearTimer: () => {} });
    await store.open();
    assert.deepEqual(plain(await store.assetInventory()), [], "a new vault without assets is a valid empty inventory");

    const note = store.create("![[cover.png]]");
    const root = "/notes/assets", folder = root + "/" + note.id, file = folder + "/cover.png";
    await io.makeDir(folder);
    await io.writeBytes(file, Uint8Array.from([1]));
    const children = io.children;
    io.children = async (path) => {
      if (path === root) throw new Error("permission denied");
      return children(path);
    };
    await assert.rejects(store.assetInventory(), /permission denied/, "a readable root that cannot be enumerated must not appear clean");

    io.children = async (path) => {
      if (path === folder) throw new Error("folder unreadable");
      return children(path);
    };
    await assert.rejects(store.assetInventory(), /folder unreadable/, "a partially scanned note folder must fail the whole inventory");

    io.children = children;
    const stat = io.stat;
    io.stat = async (path) => path === root ? { type: "symlink" } : stat(path);
    await assert.rejects(store.assetInventory(), /not a regular folder/, "the assets root itself cannot redirect a scan through a symlink");
    io.stat = stat;
    io.stat = async (path) => {
      if (path === file) throw new Error("stat denied");
      return stat(path);
    };
    await assert.rejects(store.assetInventory(), /stat denied/, "a file whose type cannot be verified must not be silently skipped");
    io.stat = stat;
    io.stat = async (path) => path === folder ? { type: "symlink" } : stat(path);
    assert.deepEqual(plain(await store.assetInventory()), [], "symlinked note asset folders are ignored");
  });

  await test("store cleanup refuses referenced assets, deletes confirmed orphans only, and validates paths", async () => {
    const io = fakeIO();
    const store = c.createStore({ io, notify() {}, windowId: "asset-delete", getDir: async () => "/notes", getMaxSaveMs: () => 5000, setTimer: () => 1, clearTimer: () => {} });
    await store.open();
    const note = store.create("![[cover.png]]");
    await io.makeDir("/notes/assets/" + note.id);
    await io.writeBytes("/notes/assets/" + note.id + "/cover.png", Uint8Array.from([1]));
    await io.writeBytes("/notes/assets/" + note.id + "/orphan.dat", Uint8Array.from([2]));
    assert.deepEqual(plain(await store.removeAsset("assets/" + note.id + "/cover.png")), { ok: false, reason: "referenced" });
    assert.equal(await io.exists("/notes/assets/" + note.id + "/cover.png"), true);
    assert.deepEqual(plain(await store.removeAsset("assets/../escape")), { ok: false, reason: "invalid" });
    const originalStat = io.stat;
    io.stat = async (path) => path.endsWith("/orphan.dat") ? { type: "directory" } : originalStat(path);
    assert.deepEqual(plain(await store.removeAsset("assets/" + note.id + "/orphan.dat")), { ok: false, reason: "invalid" }, "directories and symlinks are never offered to file deletion");
    assert.equal(await io.exists("/notes/assets/" + note.id + "/orphan.dat"), true);
    io.stat = originalStat;
    assert.deepEqual(plain(await store.removeAsset("assets/" + note.id + "/orphan.dat")), { ok: true });
    assert.equal(await io.exists("/notes/assets/" + note.id + "/orphan.dat"), false);
    assert.deepEqual(plain(await store.removeAsset("assets/" + note.id + "/orphan.dat")), { ok: false, reason: "missing" });
  });

  console.log(`${passed} T1.17 asset integrity tests passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
