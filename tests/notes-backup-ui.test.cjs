"use strict";
/* Deleted-notes backup dialog on the real sheet code and a fake DOM: Trash right-click menu entry, listing, Restore,
 * two-step Clear. Proves logic only: NOT layout, NOT real Gecko. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { Ev, El, document, raf } = dom;
const win = { document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
win.window = win;
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array, queueMicrotask });
const c = win.__zentralNotesTestSeam.core;
const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
const tick = () => new Promise((r) => setImmediate(r));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }

(async () => {
  const files = new Map();
  const io = {
    join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; },
    writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }),
    remove: async (p) => files.delete(p),
    exists: async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p + "/")),
    children: async (d) => [...new Set([...files.keys()].filter((k) => k.startsWith(d + "/")).map((k) => d + "/" + k.slice(d.length + 1).split("/")[0]))],
    stat: async (p) => ({ size: (files.get(p)?.text || "").length, lastModified: files.get(p)?.mtime || 0 }),
    restrict: async () => {}, makeDir: async () => {},
    removeTree: async (d) => { for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k); },
    moveTree: async (from, to) => { for (const k of [...files.keys()]) if (k.startsWith(from + "/")) { files.set(to + k.slice(from.length), files.get(k)); files.delete(k); } },
  };
  const store = c.createStore({ io, notify() {}, windowId: "t", getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: setTimeout, clearTimer: clearTimeout, warn() {} });
  const prefs = new Map();
  const env = { openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {}, getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), setPref: (k, v) => prefs.set(k, v) };
  const host = new El("div");
  const adapter = { position: "fixed", host, attach: (r) => host.appendChild(r), getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  sheet.root.ownerDocument = document;
  const q = (cls) => sheet.root.querySelector(cls);
  const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
  const btn = (scope, label) => scope.querySelectorAll("button").find((b) => b.textContent.startsWith(label));
  await sheet.open(); await flushRaf();

  const openBackupDialog = async () => {
    const chip = sheet.root.all().find((e) => e._classes?.has("zn-chip") && /^Trash/.test(e.textContent));
    chip.dispatchEvent(new Ev("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    click(btn(q(".zn-menu"), "Deleted notes backup"));
    for (let i = 0; i < 4; i++) await tick();
  };

  await test("Trash menu: empty backup says so; a deleted note is listed with its time left and can be restored", async () => {
    await openBackupDialog();
    assert.match(q(".zn-dialog-card").textContent, /Nothing here/);
    assert.ok(!btn(q(".zn-dialog-card"), "Clear backup"), "nothing to clear: no clear button");
    click(btn(q(".zn-dialog-card"), "Close")); await tick();
    const note = store.create("# Lost idea\ntext"); await store.flush();
    await store.deleteForever(note.id);
    await openBackupDialog();
    const row = q(".zn-hist-row");
    assert.ok(row, "one row");
    assert.match(row.textContent, /Lost idea/);
    assert.match(row.textContent, /48 h left/);
    click(btn(row, "Restore"));
    for (let i = 0; i < 6; i++) await tick();
    await flushRaf();
    assert.equal(store.get(note.id).body, "# Lost idea\ntext");
    assert.equal(q(".zn-dialog-card"), null, "dialog closed");
    await openBackupDialog();
    assert.match(q(".zn-dialog-card").textContent, /Nothing here/, "the entry was consumed");
    click(btn(q(".zn-dialog-card"), "Close")); await tick();
  });

  await test("Clear backup needs two clicks and wipes every entry", async () => {
    const a = store.create("one"), b = store.create("two"); await store.flush();
    await store.deleteForever(a.id); await store.deleteForever(b.id);
    await openBackupDialog();
    assert.equal(sheet.root.querySelectorAll(".zn-hist-row").length, 2);
    const clear = btn(q(".zn-dialog-card"), "Clear backup");
    click(clear);
    assert.equal((await store.listBackups()).length, 2, "first click only asks");
    assert.match(clear.textContent, /Really clear/);
    click(clear);
    for (let i = 0; i < 4; i++) await tick();
    assert.equal((await store.listBackups()).length, 0);
    assert.equal(q(".zn-dialog-card"), null);
  });

  console.log(`notes-backup-ui: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
