"use strict";
/* Unit tests for the pure core and the file store of additional/notes/ZentralNotes.uc.js.
 * They use an in-memory file system and a manual clock. They prove the saving logic
 * (debounce + maximum wait, atomic write options, retry, backup fallback, trash, sync
 * between windows); they do NOT prove behavior inside Zen (UI, pickers, IOUtils). */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "additional/notes/ZentralNotes.uc.js"), "utf8");
const seam = {};
const win = { __zentralNotesTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(source, { window: win, globalThis: { Services: {} }, ChromeUtils: {}, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, console });
const c = seam.core;
const J = (v) => JSON.stringify(v);

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

function makeClock() {
  let t = 1_700_000_000_000,
    seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    set(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clear: (id) => timers.delete(id),
    pending: () => timers.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        t = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await settle();
      }
      t = end;
      await settle();
    },
  };
}
function makeFs(clock) {
  const files = new Map();
  const writes = [];
  const io = {
    fail: 0,
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    async readUTF8(p) {
      if (!files.has(p)) throw new Error("NotFound " + p);
      return files.get(p).text;
    },
    async writeUTF8(p, text, opts = {}) {
      if (io.fail > 0) {
        io.fail--;
        throw new Error("disk full");
      }
      if (opts.backupFile && files.has(p)) files.set(opts.backupFile, { text: files.get(p).text, mtime: clock.now() });
      files.set(p, { text, mtime: clock.now() });
      writes.push({ p, opts });
    },
    async remove(p) {
      files.delete(p);
    },
    async exists(p) {
      return files.has(p);
    },
    async children(dir) {
      return [...files.keys()].filter((k) => k.startsWith(dir + "/") && !k.slice(dir.length + 1).includes("/"));
    },
    async stat(p) {
      if (!files.has(p)) throw new Error("NotFound");
      return { lastModified: files.get(p).mtime };
    },
    async restrict() {},
  };
  return { files, writes, io };
}
function makeBus() {
  const stores = [];
  return {
    attach: (s) => stores.push(s),
    notify: (msg) => stores.forEach((s) => s.onRemoteMessage(JSON.stringify(msg))),
  };
}
async function newStore({ clock, fsys, bus, id = "w1", maxSec = 5 }) {
  const store = c.createStore({
    io: fsys.io,
    notify: (m) => bus?.notify(m),
    windowId: id,
    now: clock.now,
    getDir: async () => "/notes",
    getMaxSaveMs: () => maxSec * 1000,
    setTimer: clock.set,
    clearTimer: clock.clear,
  });
  bus?.attach(store);
  await store.open();
  return store;
}

(async () => {
  await test("autosaver: saves after a pause and at least every max wait while typing", async () => {
    const clock = makeClock();
    let flushes = 0;
    const a = c.createAutosaver({ idleMs: () => 800, maxMs: () => 5000, flush: () => flushes++, setTimer: clock.set, clearTimer: clock.clear });
    a.touch();
    await clock.advance(799);
    assert.equal(flushes, 0);
    await clock.advance(2);
    assert.equal(flushes, 1);
    // continuous typing: a keystroke every 300 ms for 12 s never lets the idle timer fire
    for (let i = 0; i < 40; i++) {
      a.touch();
      await clock.advance(300);
    }
    assert.ok(flushes >= 3, "max wait forced saves, got " + flushes);
    assert.ok(flushes <= 4, "but not on every keystroke, got " + flushes);
    await clock.advance(900);
    const done = flushes;
    await clock.advance(20000);
    assert.equal(flushes, done, "no work while nothing is pending");
    assert.equal(clock.pending(), 0);
  });

  await test("note file round trip, header rules and file-name guard", async () => {
    const n = { id: "n1-abcd", body: "# T\n---\nbody\n", created: 1, updated: 2, color: "pink", pinned: true, trashed: 5 };
    const back = c.noteFromFile("n1-abcd", c.serializeNote(n), 9);
    assert.equal(J([back.body, back.color, back.pinned, back.trashed]), J([n.body, "pink", true, new Date(5).getTime()]));
    assert.equal(c.noteFromFile("x", "---\ntags: a\n---\nhi", 7).body, "---\ntags: a\n---\nhi");
    assert.equal(c.noteFromFile("x", "\uFEFFplain\r\nline", 7).body, "plain\nline");
    for (const bad of ["../x.md", "a/b.md", ".md", "a\\b.md", "x.md.bak", "x.md.tmp", "meta.json"]) assert.ok(!c.FILE_RE.test(bad), bad);
    for (const good of ["n1-abcd.md", "My note.md", "a.b.md"]) assert.ok(c.FILE_RE.test(good), good);
  });

  await test("store: empty new notes leave no file; edits save atomically with a backup of older files", async () => {
    const clock = makeClock(),
      fsys = makeFs(clock);
    const s = await newStore({ clock, fsys });
    const empty = s.create("");
    s.discardIfEmpty(empty.id);
    await s.flush();
    assert.equal(fsys.writes.length, 0);
    const n = s.create("");
    s.update(n.id, "Hello\nworld", {});
    assert.equal(s.state.save, "dirty");
    await clock.advance(900);
    assert.equal(s.state.save, "saved");
    const file = "/notes/" + n.id + ".md";
    assert.equal(fsys.writes.length, 1);
    assert.equal(fsys.writes[0].opts.tmpPath, file + ".tmp");
    assert.equal(fsys.writes[0].opts.flush, true);
    assert.ok(!fsys.writes[0].opts.backupFile, "no backup for a brand-new file");
    assert.ok(fsys.files.get(file).text.startsWith("---\nid: " + n.id));
    s.update(n.id, "Hello\nworld 2", {});
    await s.flush();
    assert.equal(fsys.writes[1].opts.backupFile, file + ".bak");
    assert.ok(fsys.files.get(file + ".bak").text.includes("world"));
    s.update(n.id, "Hello\nworld 3", {});
    await s.flush();
    assert.ok(!fsys.writes[2].opts.backupFile, "backup only once per session");
  });

  await test("store: a second window reads the same notes; .bak rescues a corrupt file; stray files ignored", async () => {
    const clock = makeClock(),
      fsys = makeFs(clock);
    const a = await newStore({ clock, fsys });
    const n = a.create("First note");
    a.setColor(n.id, "green");
    await a.flush();
    a.update(n.id, "First note edited", {});
    await a.flush();
    fsys.files.set("/notes/stray.txt", { text: "x", mtime: 1 });
    fsys.files.set("/notes/" + n.id + ".md.tmp", { text: "half", mtime: 1 });
    const b = await newStore({ clock, fsys, id: "w2" });
    assert.equal(b.list().length, 1);
    assert.equal(b.get(n.id).color, "green");
    fsys.files.set("/notes/" + n.id + ".md", { text: "", mtime: 2 }); // crash left an empty file
    const d = await newStore({ clock, fsys, id: "w3" });
    assert.equal(d.get(n.id)?.body, "First note", "restored from the .bak copy");
  });

  await test("store: failed writes keep the note dirty and retry", async () => {
    const clock = makeClock(),
      fsys = makeFs(clock);
    const s = await newStore({ clock, fsys });
    const n = s.create("data");
    fsys.io.fail = 1;
    await s.flush();
    assert.equal(s.state.save, "error");
    assert.match(s.state.error, /disk full/);
    assert.equal(fsys.files.has("/notes/" + n.id + ".md"), false);
    await clock.advance(11000);
    assert.equal(s.state.save, "saved");
    assert.equal(fsys.files.has("/notes/" + n.id + ".md"), true);
  });

  await test("store: an edit made while a write is in flight is saved afterwards", async () => {
    const clock = makeClock(),
      fsys = makeFs(clock);
    const s = await newStore({ clock, fsys });
    const n = s.create("v1");
    const realWrite = fsys.io.writeUTF8;
    let once = true;
    fsys.io.writeUTF8 = async (p, t, o) => {
      if (once) {
        once = false;
        s.update(n.id, "v2", {}); // typing continues during the write
      }
      return realWrite(p, t, o);
    };
    await s.flush();
    assert.equal(s.state.save, "dirty", "still dirty: v2 is not on disk yet");
    await clock.advance(1000);
    assert.ok(fsys.files.get("/notes/" + n.id + ".md").text.endsWith("v2"));
    assert.equal(s.state.save, "saved");
  });

  await test("two windows stay in sync; local unsaved edits are never overwritten", async () => {
    const clock = makeClock(),
      fsys = makeFs(clock),
      bus = makeBus();
    const a = await newStore({ clock, fsys, bus, id: "A" });
    const b = await newStore({ clock, fsys, bus, id: "B" });
    const n = a.create("shared");
    await a.flush();
    await settle();
    assert.equal(b.get(n.id)?.body, "shared", "new note reached the other window");
    a.update(n.id, "shared v2", {});
    await a.flush();
    await settle();
    assert.equal(b.get(n.id).body, "shared v2");
    b.update(n.id, "B is typing", {}); // dirty in B
    a.update(n.id, "shared v3", {});
    await a.flush();
    await settle();
    assert.equal(b.get(n.id).body, "B is typing", "unsaved local text wins until saved");
    await b.flush();
    await settle();
    assert.ok(fsys.files.get("/notes/" + n.id + ".md").text.endsWith("B is typing"));
    await a.deleteForever(n.id);
    await settle();
    assert.equal(b.get(n.id), null, "deletion propagated");
  });

  await test("trash: restore, delete forever, purge after 30 days", async () => {
    const clock = makeClock(),
      fsys = makeFs(clock);
    const s = await newStore({ clock, fsys });
    const keep = s.create("keep"),
      gone = s.create("gone");
    await s.flush();
    s.trash(gone.id);
    await s.flush();
    assert.equal(s.list().length, 1);
    assert.equal(s.list({ trashed: true }).length, 1);
    s.restore(gone.id);
    s.trash(gone.id);
    await s.flush();
    await clock.advance(31 * 86400000);
    const later = await newStore({ clock, fsys, id: "w9" });
    assert.equal(later.get(gone.id), null, "purged");
    assert.equal(later.get(keep.id)?.body, "keep");
    assert.equal(fsys.files.has("/notes/" + gone.id + ".md"), false);
    assert.equal(fsys.files.has("/notes/" + gone.id + ".md.bak"), false);
  });

  await test("refresh picks up files added or changed by other apps", async () => {
    const clock = makeClock(),
      fsys = makeFs(clock);
    const s = await newStore({ clock, fsys });
    fsys.files.set("/notes/From Obsidian.md", { text: "# Dropped in\nbody", mtime: clock.now() });
    await s.refresh();
    assert.equal(s.get("From Obsidian")?.body, "# Dropped in\nbody");
    await clock.advance(10000);
    fsys.files.set("/notes/From Obsidian.md", { text: "# Dropped in\nedited elsewhere", mtime: clock.now() });
    await s.refresh();
    assert.equal(s.get("From Obsidian").body, "# Dropped in\nedited elsewhere");
    fsys.files.delete("/notes/From Obsidian.md");
    await s.refresh();
    assert.equal(s.get("From Obsidian"), null);
  });

  await test("search, pin ordering and metadata", async () => {
    const clock = makeClock(),
      fsys = makeFs(clock);
    const s = await newStore({ clock, fsys });
    const a = s.create("alpha one");
    await clock.advance(10);
    const b = s.create("beta two");
    s.setPinned(a.id, true);
    assert.equal(s.list()[0].id, a.id, "pinned first");
    assert.equal(s.list({ query: "BETA" }).length, 1);
    assert.equal(s.list({ query: "alpha two" }).length, 0, "every term must match");
    s.setMeta({ size: "full", mode: "read", highlight: "green", lastNoteId: b.id });
    await clock.advance(1000); // idle save (800 ms) and meta save (600 ms) have both run
    const again = await newStore({ clock, fsys, id: "w5" });
    assert.equal(J([again.meta.size, again.meta.mode, again.meta.highlight, again.latestId()]), J(["full", "read", "green", b.id]));
  });

  console.log(`\n${passed} notes tests passed`);
})().catch((error) => {
  console.error("FAIL", error);
  process.exit(1);
});
