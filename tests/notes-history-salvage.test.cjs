"use strict";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const T = Date.parse("2026-11-13T12:00:00Z"), PATH = "/n/reminder-history.json";
const record = (id, at, seq, action = "done") => ({ id, itemId: "task", occurrenceId: "task", action, at, seq });
function fixture(text) {
  const files = new Map([[PATH, text]]);
  const io = { join: (...p) => p.join("/"), exists: async (p) => files.has(p), readUTF8: async (p) => { if (!files.has(p)) throw new Error("not found"); return files.get(p); }, writeUTF8: async (p, content) => files.set(p, content) };
  const store = C.createReminderHistoryStore({ io, getDir: () => "/n", now: () => T, setTimer: () => 1, clearTimer() {}, warn() {} });
  return { files, io, store };
}
(async () => {
  {
    const raw = JSON.stringify({ v: 1, records: [record("ok", T, 1), { id: "bad", action: "wat" }] });
    const f = fixture(raw), state = await f.store.open();
    assert.equal(state.writeBlocked, false); assert.equal(f.store.list().length, 1); assert.equal(f.store.stateFor("task"), "done");
    assert.equal(f.files.get(state.backupPath), raw); assert.equal(JSON.parse(f.files.get("/n/reminder-history.rejected.json")).records.length, 1);
    assert.equal(JSON.parse(f.files.get(PATH)).records.length, 1); assert.ok(f.store.append({ itemId: "x", action: "done", at: T })); await f.store.flush();
  }
  {
    const raw = JSON.stringify({ v: 1, records: [record("duplicate", T, 1, "done"), record("duplicate", T + 1, 2, "reopened"), record("other", T, 3)] });
    const f = fixture(raw), state = await f.store.open(); assert.equal(state.writeBlocked, false);
    assert.equal(f.store.list().length, 2); assert.equal(f.store.list().find((r) => r.id === "duplicate").action, "reopened");
    assert.equal(JSON.parse(f.files.get("/n/reminder-history.rejected.json")).records.length, 1);
  }
  {
    const raw = JSON.stringify({ v: 1, records: [record("ok", T, 1), null] }), f = fixture(raw);
    f.files.set("/n/reminder-history.rejected.json", "previous evidence"); const state = await f.store.open();
    assert.equal(state.writeBlocked, false); assert.equal(f.files.get("/n/reminder-history.rejected.json"), "previous evidence");
    assert.ok(state.rejectedPath.endsWith("-2.json"));
  }
  for (const raw of ['{"v":99,"records":[]}', '{"v":1,"records":[broken]']) {
    const f = fixture(raw), state = await f.store.open(); assert.equal(state.writeBlocked, true); assert.equal(f.files.get(state.backupPath), raw);
    assert.equal(await f.store.startFresh(), true); assert.deepEqual(JSON.parse(f.files.get(PATH)), { v: 1, records: [] }); assert.equal(f.store.storageState().writeBlocked, false);
  }
  {
    const raw = "{bad", f = fixture(raw); const state = await f.store.open(); f.files.set(PATH, "changed by another window");
    assert.equal(await f.store.startFresh(), false); assert.equal(f.files.get(PATH), "changed by another window"); assert.equal(f.store.storageState().writeBlocked, true); assert.ok(state.backupPath);
  }
  {
    const raw = JSON.stringify({ v: 1, records: [record("ok", T, 1), null] }), f = fixture(raw), write = f.io.writeUTF8;
    f.io.writeUTF8 = async (path, text) => { if (path.endsWith("rejected.json")) throw new Error("no space"); return write(path, text); };
    const state = await f.store.open(); assert.equal(state.writeBlocked, true); assert.equal(f.files.get(PATH), raw, "failure to preserve rejected data cannot overwrite the original");
  }
  {
    const f = fixture(JSON.stringify({ v: 1, records: [] })); await f.store.open();
    f.store.append({ id: "pending", itemId: "task", action: "done", at: T });
    f.files.set(PATH, JSON.stringify({ v: 1, records: [record("remote", T + 1, 1, "reopened"), null] }));
    await f.store.flush(); assert.equal(f.store.storageState().writeBlocked, false);
    assert.deepEqual(f.store.list().map((r) => r.id).sort(), ["pending", "remote"]);
    assert.equal(JSON.parse(f.files.get(PATH)).records.length, 2);
    assert.ok(f.files.has("/n/reminder-history.rejected.json"), "remote corruption is salvaged before merging local changes");
  }
  {
    const f = fixture(JSON.stringify({ v: 1, records: [] })); await f.store.open();
    f.store.append({ id: "pending", itemId: "task", action: "done", at: T }); f.files.set(PATH, "{damaged later");
    await assert.rejects(f.store.flush()); assert.equal(f.store.storageState().writeBlocked, true);
    assert.ok(f.store.storageState().backupPath); assert.equal(await f.store.startFresh(), true);
    assert.equal(f.store.list().find((entry) => entry.id === "pending").action, "done", "local pending history survives recovery");
    assert.equal(JSON.parse(f.files.get(PATH)).records.length, 1); await f.store.flush();
  }
  {
    const files = new Map([["/profile/zentral-notes/reminder-history.json", "{broken"]]);
    const h = createFakeZen({ files }); await h.seam.ensureStore();
    const parent = new h.El("div"); h.document.body.append(parent);
    const adapter = { position: "fixed", host: parent, attach: (root) => parent.append(root), getArea: () => ({ left: 0, top: 0, width: 900, height: 700 }), watch: () => () => {}, setActive() {}, rewatch() {} };
    const sheet = h.window.__zentralNotesTestSeam.core.createSheet({ store: h.seam.store, adapter, env: { getPref: (_k, d) => d, setPref() {}, openLink() {}, copyText() {} }, ensureStore: h.seam.ensureStore });
    await sheet.open(); const button = sheet.root.querySelectorAll("button").find((node) => node.textContent === "Start fresh history");
    assert.ok(button, "protected history presents an explicit recovery action"); button.click();
    for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.seam.store.items.history.storageState().writeBlocked, false); sheet.destroy(); await h.destroy();
  }
  {
    const path = "/profile/zentral-notes/reminder-history.json", files = new Map([[path, JSON.stringify({ v: 1, records: [] })]]);
    const h = createFakeZen({ files }); await h.seam.ensureStore();
    const parent = new h.El("div"); h.document.body.append(parent);
    const adapter = { position: "fixed", host: parent, attach: (root) => parent.append(root), getArea: () => ({ left: 0, top: 0, width: 900, height: 700 }), watch: () => () => {}, setActive() {}, rewatch() {} };
    const sheet = h.window.__zentralNotesTestSeam.core.createSheet({ store: h.seam.store, adapter, env: { getPref: (_k, d) => d, setPref() {}, openLink() {}, copyText() {} }, ensureStore: h.seam.ensureStore });
    await sheet.open(); h.seam.store.items.history.append({ itemId: "pending", action: "done", at: T }); files.set(path, "{bad after opening");
    await assert.rejects(h.seam.store.items.history.flush());
    assert.ok(sheet.root.querySelectorAll("button").some((node) => node.textContent === "Start fresh history"), "protection raised after open notifies the active sheet");
    sheet.destroy(); await h.destroy();
  }
  console.log("reminder history salvage passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
