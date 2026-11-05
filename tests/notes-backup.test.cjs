"use strict";
/* Deleted-note backup (roadmap rank 1): pure rules, and the store on a fake disk with a fake clock.
 * Node + fake IO only: it proves the logic, NOT IOUtils.move / real disk behaviour in Gecko. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const win = { document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame() {}, cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
win.window = win;
vm.runInNewContext(source, { window: win, document: dom.document, Event: dom.Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array });
const c = win.__zentralNotesTestSeam.core;
const J = (x) => JSON.parse(JSON.stringify(x));
const H = 3600000;
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; } catch (e) { failed++; console.error("FAIL " + name + "\n", e); }
}

function fakeIO({ moveTree = true, makeDir = true, failBackupWrite = false } = {}) {
  const files = new Map();
  const io = {
    files,
    join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf " + p); return files.get(p).text; },
    writeUTF8: async (p, text) => { if (failBackupWrite && p.includes("/backup/")) throw new Error("disk full"); files.set(p, { text, mtime: 1 }); },
    remove: async (p) => { files.delete(p); },
    exists: async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p + "/")),
    children: async (d) => [...new Set([...files.keys()].filter((k) => k.startsWith(d + "/")).map((k) => d + "/" + k.slice(d.length + 1).split("/")[0]))],
    stat: async (p) => ({ size: (files.get(p)?.text || "").length, lastModified: 1 }),
    removeTree: async (d) => { for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k); },
    restrict: async () => {},
  };
  if (makeDir) io.makeDir = async () => {};
  if (moveTree) io.moveTree = async (from, to) => {
    if ([...files.keys()].some((k) => k.startsWith(to + "/"))) throw new Error("target exists");
    for (const k of [...files.keys()]) if (k.startsWith(from + "/")) { files.set(to + k.slice(from.length), files.get(k)); files.delete(k); }
  };
  return io;
}
let clock;
const mk = (io, extra = {}) => c.createStore({ io, notify() {}, windowId: "t", now: () => clock, getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: () => 0, clearTimer() {}, warn() {}, ...extra });
const keys = (io, part) => [...io.files.keys()].filter((k) => k.includes(part));

(async () => {
  await test("pure: entry names round-trip, collide safely and reject foreign or unsafe names", () => {
    const ms = Date.UTC(2026, 10, 5, 12, 30, 15);
    const a = c.backupEntryName(ms, "abc_1");
    assert.equal(a, "20261105T123015~abc_1");
    assert.deepEqual(J(c.parseBackupName(a)), { ms, id: "abc_1" });
    const b = c.backupEntryName(ms, "abc_1", [a]);
    assert.notEqual(b, a);
    assert.equal(c.parseBackupName(b).id, "abc_1");
    for (const bad of ["", "x", "20261105T123015~", "20261105T123015~../x", "20261105T123015~a/b", "../20261105T123015~a", "20261105T123015_a", null, undefined])
      assert.equal(c.parseBackupName(bad), null, String(bad));
  });

  await test("pure: backupPlan expires at exactly 48 h, sorts newest first, never lists foreign names", () => {
    const now = Date.UTC(2026, 10, 5, 12, 0, 0);
    const old = c.backupEntryName(now - 48 * H, "old");
    const edge = c.backupEntryName(now - 48 * H + 1000, "edge");
    const fresh = c.backupEntryName(now - H, "fresh");
    const p = c.backupPlan([old, edge, fresh, "README.txt", "meta.json", ".DS_Store"], now);
    assert.deepEqual(J(p.expired), [old]);
    assert.deepEqual(J(p.kept.map((e) => e.id)), ["fresh", "edge"]);
    assert.equal(p.kept[0].expiresMs, now - H + 48 * H);
    assert.deepEqual(J(c.backupPlan([], now)), { expired: [], kept: [] });
    assert.deepEqual(J(c.backupPlan(null, now)), { expired: [], kept: [] });
    assert.equal(c.backupLeft(now + 30 * 60000, now), "30 min left");
    assert.equal(c.backupLeft(now + 5 * H, now), "5 h left");
    assert.equal(c.backupLeft(now - 5, now), "0 min left");
  });

  await test("deleteForever keeps the note for 48 h and restore brings it back under its own id, out of the Trash", async () => {
    clock = Date.UTC(2026, 10, 5, 8, 0, 0);
    const io = fakeIO(); const s = mk(io); await s.open();
    const n = s.create("# Plan\nbody text"); await s.flush();
    s.trash(n.id); await s.flush();
    await s.deleteForever(n.id);
    assert.equal(s.get(n.id), null);
    assert.equal(keys(io, "/n/" + n.id + ".md").length, 0, "the live file is gone");
    const list = await s.listBackups();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, "Plan");
    assert.equal(list[0].id, n.id);
    assert.equal(list[0].expiresMs, clock + 48 * H);
    clock += 2 * H;
    const id = await s.restoreBackup(list[0].name);
    assert.equal(id, n.id);
    assert.equal(s.get(id).body, "# Plan\nbody text");
    assert.equal(s.get(id).trashed, 0, "restored notes are not in the Trash");
    assert.ok(io.files.has("/n/" + id + ".md"), "file written back");
    assert.equal((await s.listBackups()).length, 0, "the entry is consumed");
    assert.equal(keys(io, "/backup/").length, 0);
  });

  await test("emptyTrash and auto-empty both go through the backup; live notes are untouched", async () => {
    clock = Date.UTC(2026, 10, 5, 8, 0, 0);
    const io = fakeIO(); const s = mk(io, { getTrashDays: () => 30 }); await s.open();
    const a = s.create("alpha"); const b = s.create("beta"); const keep = s.create("gamma"); await s.flush();
    s.trash(a.id); s.trash(b.id); await s.flush();
    await s.emptyTrash();
    assert.deepEqual(J((await s.listBackups()).map((x) => x.title).sort()), ["alpha", "beta"]);
    assert.ok(s.get(keep.id));
    // auto-empty: an old trashed note is backed up on the next open, then expires 48 h later
    const old = s.create("delta"); await s.flush(); s.trash(old.id); await s.flush();
    clock += 31 * 24 * H;
    const s2 = mk(io, { getTrashDays: () => 30 }); await s2.open();
    assert.equal(s2.get(old.id), null);
    assert.ok((await s2.listBackups()).some((x) => x.title === "delta"), "auto-emptied notes are backed up too");
  });

  await test("expired backups are purged on open, fresh and foreign entries stay", async () => {
    clock = Date.UTC(2026, 10, 5, 8, 0, 0);
    const io = fakeIO(); const s = mk(io); await s.open();
    const n = s.create("short lived"); await s.flush();
    await s.deleteForever(n.id);
    io.files.set("/n/backup/README.txt", { text: "mine", mtime: 1 });
    io.files.set("/n/backup/notes-by-hand/x.md", { text: "mine", mtime: 1 });
    clock += 47 * H;
    const s2 = mk(io); await s2.open();
    assert.equal((await s2.listBackups()).length, 1, "still inside 48 h");
    clock += 2 * H;
    const s3 = mk(io); await s3.open();
    assert.equal((await s3.listBackups()).length, 0);
    assert.equal(keys(io, "~" + n.id).length, 0, "entry files removed");
    assert.ok(io.files.has("/n/backup/README.txt") && io.files.has("/n/backup/notes-by-hand/x.md"), "foreign files are never deleted");
  });

  await test("pictures and history move into the entry and come back with the note", async () => {
    clock = Date.UTC(2026, 10, 5, 8, 0, 0);
    const io = fakeIO(); const s = mk(io); await s.open();
    const n = s.create("with picture"); await s.flush();
    io.files.set("/n/assets/" + n.id + "/p1.png", { text: "PNGDATA", mtime: 1 });
    await s.deleteForever(n.id);
    assert.equal(keys(io, "/n/assets/" + n.id).length, 0, "pictures left the live folder");
    assert.ok(keys(io, "/backup/").some((k) => k.endsWith("/assets/p1.png")), "pictures are inside the backup entry");
    assert.ok(keys(io, "/backup/").some((k) => k.includes("/history/")), "history is inside the backup entry");
    const [b] = await s.listBackups();
    await s.restoreBackup(b.name);
    assert.ok(io.files.has("/n/assets/" + n.id + "/p1.png"), "picture is back where the note text points");
    assert.ok(keys(io, "/n/history/" + n.id + "/").length >= 1, "history is back");
    assert.equal(keys(io, "/backup/").length, 0);
  });

  await test("a picture still shown by another note is not moved away", async () => {
    clock = Date.UTC(2026, 10, 5, 8, 0, 0);
    const io = fakeIO(); const s = mk(io); await s.open();
    const a = s.create("orig"); await s.flush();
    io.files.set("/n/assets/" + a.id + "/p1.png", { text: "PNGDATA", mtime: 1 });
    const b = s.create("copy ![x](assets/" + a.id + "/p1.png)"); await s.flush();
    await s.deleteForever(a.id);
    assert.ok(io.files.has("/n/assets/" + a.id + "/p1.png"), "the other note keeps its picture");
    assert.ok(s.get(b.id));
  });

  await test("restore when the id is taken creates a new note and never overwrites", async () => {
    clock = Date.UTC(2026, 10, 5, 8, 0, 0);
    const io = fakeIO(); const s = mk(io); await s.open();
    const n = s.create("first version"); await s.flush();
    await s.deleteForever(n.id);
    // the same id appears again (e.g. a sync tool put a file back)
    io.files.set("/n/" + n.id + ".md", { text: "---\nid: x\n---\nsynced copy", mtime: 5 });
    await s.refresh();
    const [b] = await s.listBackups();
    const id = await s.restoreBackup(b.name);
    assert.ok(id && id !== n.id);
    assert.equal(s.get(id).body, "first version");
    assert.ok(io.files.get("/n/" + n.id + ".md").text.includes("synced copy"), "the existing file is untouched");
  });

  await test("a failing backup disk never blocks the delete; without makeDir / moveTree it behaves as before", async () => {
    clock = Date.UTC(2026, 10, 5, 8, 0, 0);
    const io = fakeIO({ failBackupWrite: true }); const s = mk(io); await s.open();
    const n = s.create("will go"); await s.flush();
    await s.deleteForever(n.id);
    assert.equal(s.get(n.id), null);
    assert.equal(keys(io, "/n/" + n.id + ".md").length, 0, "still deleted");
    const plain = fakeIO({ makeDir: false, moveTree: false }); const s2 = mk(plain); await s2.open();
    const m = s2.create("old io"); await s2.flush();
    await s2.deleteForever(m.id);
    assert.equal(keys(plain, "backup").length, 0);
    assert.deepEqual(J(await s2.listBackups()), []);
    assert.equal(await s2.restoreBackup("nope"), null);
    assert.equal(await s2.restoreBackup("../../meta.json"), null, "only our entry names are read");
  });

  await test("an empty never-saved note leaves no backup; clearBackup wipes the folder", async () => {
    clock = Date.UTC(2026, 10, 5, 8, 0, 0);
    const io = fakeIO(); const s = mk(io); await s.open();
    const blank = s.create(""); s.trash(blank.id);
    assert.equal((await s.listBackups()).length, 0);
    const a = s.create("one"); const b = s.create("two"); await s.flush();
    await s.deleteForever(a.id); await s.deleteForever(b.id);
    assert.equal((await s.listBackups()).length, 2);
    assert.equal(await s.clearBackup(), 2);
    assert.equal((await s.listBackups()).length, 0);
    assert.equal(keys(io, "/backup").length, 0);
  });

  console.log(`notes-backup: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
