"use strict";
const assert = require("node:assert/strict"), C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
function disk() {
  const files = new Map();
  const io = { files, join: (...p) => p.join("/"), exists: async p => files.has(p),
    readUTF8: async p => { if (!files.has(p)) { const e = Error("not found"); e.code = "ENOENT"; throw e; } return files.get(p); },
    writeUTF8: async (p, text) => files.set(p, text) };
  return io;
}
const start = 1700000000000;
function setup(io) {
  let now = start;
  const options = { io, getDir: () => "/n", now: () => now, setTimer: () => 1, clearTimer() {}, warn() {} };
  const create = () => C.createItemStore(options);
  const item = id => C.makeItem({ id, summary: id, start: { dateTime: new Date(start + 86400000).toISOString() }, x: { kind: "event", src: "manual" } }, now);
  return { create, item, tick: () => { now += 1000; } };
}
(async () => {
  {
    const io = disk(), f = setup(io), seed = f.create(); await seed.open();
    for (const id of ["a", "b", "delete"]) seed.upsert(f.item(id)); await seed.flush();
    const a = f.create(), b = f.create(); await a.open(); await b.open();
    f.tick(); a.upsert({ ...a.get("a"), summary: "A" }); a.remove("delete");
    f.tick(); b.upsert({ ...b.get("b"), summary: "B" });
    await Promise.all([a.flush(), b.flush()]);
    const read = f.create(); await read.open();
    assert.equal(read.get("a").summary, "A"); assert.equal(read.get("b").summary, "B");
    assert.equal(read.get("delete"), null, "an unrelated stale edit must not resurrect a deleted item");
  }
  {
    const io = disk(), f = setup(io), seed = f.create(); await seed.open(); seed.upsert(f.item("same")); await seed.flush();
    const a = f.create(), b = f.create(); await a.open(); await b.open(); const conflicts = [];
    a.on((type, id, detail) => { if (type === "conflict") conflicts.push({ id, ...detail }); });
    f.tick(); a.upsert({ ...a.get("same"), summary: "older" });
    f.tick(); b.upsert({ ...b.get("same"), summary: "newer" }); await b.flush(); await a.flush();
    const read = f.create(); await read.open(); assert.equal(read.get("same").summary, "newer", "same-record conflicts use lwwPick");
    assert.ok(conflicts.some(c => c.id === "same" && c.winner === "remote"), "the losing window is told about its overwritten edit");
  }
  {
    const io = disk(), f = setup(io), seed = f.create(); await seed.open(); seed.upsert(f.item("same")); await seed.flush();
    const a = f.create(), b = f.create(); await a.open(); await b.open();
    f.tick(); a.remove("same"); f.tick(); b.upsert({ ...b.get("same"), summary: "edited" }); await b.flush();
    await assert.rejects(a.flush(), /conflict/i, "delete/edit races must not silently destroy a version");
    assert.equal(JSON.parse(io.files.get("/n/calendar.json")).items[0].summary, "edited");
    const state = a.storageState(); assert.equal(state.dirty, true); assert.ok(state.backupPath && io.files.has(state.backupPath), "losing local snapshot is backed up for recovery");
  }
  {
    const io = disk(), f = setup(io), seed = f.create(); await seed.open(); seed.upsert(f.item("same")); seed.upsertCategory({ name: "Projects", color: "#111111" }); await seed.flush();
    const a = f.create(), b = f.create(); await a.open(); await b.open();
    f.tick(); a.upsert({ ...a.get("same"), summary: "edited" }); f.tick(); b.remove("same"); await b.flush();
    await assert.rejects(a.flush(), /conflict/i, "a remote delete versus a local edit requires explicit resolution");
    assert.equal(JSON.parse(io.files.get("/n/calendar.json")).items.length, 0, "the remote deletion remains intact");
    assert.equal(a.get("same").summary, "edited", "the local edit remains in memory");
    assert.ok(io.files.has(a.storageState().backupPath));
  }
  {
    const io = disk(), f = setup(io), seed = f.create(); await seed.open(); seed.upsertCategory({ name: "Projects", color: "#111111" }); await seed.flush();
    const a = f.create(), b = f.create(); await a.open(); await b.open();
    a.upsertCategory({ name: "Projects", color: "#222222" }); b.upsertCategory({ name: "Projects", color: "#333333" }); await b.flush();
    await assert.rejects(a.flush(), /conflict/i, "competing category settings have no timestamp and are not silently overwritten");
    assert.equal(JSON.parse(io.files.get("/n/calendar.json")).categories[0].color, "#333333");
    assert.equal(a.category("Projects").color, "#222222"); assert.ok(io.files.has(a.storageState().backupPath));
  }
  {
    const io = disk(), f = setup(io), seed = f.create(); await seed.open(); seed.upsert(f.item("a")); await seed.flush();
    const a = f.create(); await a.open(); f.tick(); a.upsert({ ...a.get("a"), summary: "first" });
    const read = io.readUTF8; let release, started, blocked = false;
    const reading = new Promise(resolve => { started = resolve; });
    io.readUTF8 = async path => { if (path === "/n/calendar.json" && !blocked) { blocked = true; started(); await new Promise(resolve => { release = resolve; }); } return read(path); };
    const writing = a.flush(); await reading; f.tick(); a.upsert({ ...a.get("a"), summary: "later" });
    await a.open(); assert.equal(a.get("a").summary, "later", "reopening cannot discard a pending in-flight edit");
    release(); await writing; io.readUTF8 = read; await a.flush();
    const reopened = f.create(); await reopened.open(); assert.equal(reopened.get("a").summary, "later");
  }
  {
    const io = disk(), f = setup(io), seed = f.create(); await seed.open(); seed.upsert(f.item("a")); await seed.flush();
    const a = f.create(); await a.open(); f.tick(); a.upsert({ ...a.get("a"), summary: "my edit" });
    io.files.set("/n/calendar.json", "{corrupt while open");
    await assert.rejects(a.flush()); assert.equal(io.files.get("/n/calendar.json"), "{corrupt while open");
    assert.equal(a.storageState().writeBlocked, true, "newly damaged storage is protected before overwrite");
    assert.equal(a.storageState().dirty, true);
    assert.ok(io.files.has(a.storageState().localBackupPath), "pending edits also have a recovery copy before the window closes");
    assert.match(io.files.get(a.storageState().localBackupPath), /my edit/);
  }
  {
    const io = disk(), f = setup(io), seed = f.create(); await seed.open(); seed.upsert(f.item("a")); await seed.flush();
    const a = f.create(); await a.open(); f.tick(); a.upsert({ ...a.get("a"), summary: "protected local" });
    const read = io.readUTF8; io.readUTF8 = async path => { if (path === "/n/calendar.json") throw Error("permission denied"); return read(path); };
    await assert.rejects(a.flush(), /unreadable/i); assert.equal(a.storageState().writeBlocked, true);
    assert.ok(io.files.has(a.storageState().localBackupPath)); assert.match(io.files.get(a.storageState().localBackupPath), /protected local/);
  }
  {
    const io = disk(), f = setup(io), seed = f.create(); await seed.open(); seed.upsert(f.item("a")); await seed.flush();
    const a = f.create(); await a.open(); a.upsert({ ...a.get("a"), summary: "pending during reload" });
    io.files.set("/n/calendar.json", "bad json"); await a.open();
    assert.ok(io.files.has(a.storageState().localBackupPath), "a dirty reload protects pending local edits too");
    assert.match(io.files.get(a.storageState().localBackupPath), /pending during reload/);
  }
  {
    const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
    const files = new Map(), a = createFakeZen({ files, id: "a" }), b = createFakeZen({ files, id: "b" });
    try {
      await a.seam.ensureStore(); await b.seam.ensureStore();
      const future = C.addDays(C.dayStart(Date.now()), 1) + 10 * 3600000;
      const source = a.seam.store.create(`# Linked\n\n%%calendar%%\n- [ ] ${C.localDateKey(future)} 10:00 remote note %%zn-item-id:remote1%%\n`);
      a.seam.store.stabilizeItems(source.id); await a.seam.store.flush();
      assert.equal(b.seam.store.get(source.id), null, "the source note has not been received by B yet");
      b.seam.store.items.upsert(C.makeItem({ id: "local", summary: "local", start: { dateTime: new Date(future).toISOString() }, x: { kind: "event", src: "manual" } }));
      await b.seam.store.items.flush();
      assert.ok(b.seam.store.items.list({ includeHidden: true }).some(it => it.x.noteId === source.id), "merge retains the other window's item");
      assert.ok(!b.seam.store.items.list().some(it => it.x.noteId === source.id), "a missing source stays hidden until the note is received");
    } finally { await a.destroy(); await b.destroy(); }
  }
  {
    const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
    const files = new Map(), a = createFakeZen({ files, id: "ui-a" }), b = createFakeZen({ files, id: "ui-b" }); let sheet;
    try {
      await a.seam.ensureStore();
      const date = new Date(Date.now() + 86400000).toISOString();
      a.seam.store.items.upsert({ id: "ui-conflict", summary: "initial", start: { dateTime: date }, x: { kind: "event", src: "manual" } });
      await a.seam.store.items.flush(); await b.seam.ensureStore();
      const parent = new a.El("div"); a.document.body.append(parent);
      const adapter = { position: "fixed", host: parent, attach: root => parent.append(root), getArea: () => ({ left: 0, top: 0, width: 900, height: 700 }), watch: () => () => {}, setActive() {}, rewatch() {} };
      sheet = a.window.__zentralNotesTestSeam.core.createSheet({ store: a.seam.store, adapter, env: { getPref: (_k, d) => d, setPref() {}, openLink() {}, copyText() {} }, ensureStore: a.seam.ensureStore });
      await sheet.open(); a.advanceClock(1000); a.seam.store.items.upsert({ ...a.seam.store.items.get("ui-conflict"), summary: "older" });
      b.advanceClock(2000); b.seam.store.items.upsert({ ...b.seam.store.items.get("ui-conflict"), summary: "newer" });
      await b.seam.store.items.flush(); await a.seam.store.items.flush();
      for (let i = 0; i < 10; i++) a.fireTimer(16);
      assert.match(sheet.root.querySelector(".zn-status").textContent, /another window|conflict/i, "the losing window shows a visible conflict notice");
      assert.match(a.document.querySelector(".zentral-notes-toast")?.textContent || "", /another window|conflict/i, "the host also announces the conflict when Notes is closed");
    } finally { sheet?.destroy(); await a.destroy(); await b.destroy(); }
  }
  console.log("Calendar multiwindow persistence tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
