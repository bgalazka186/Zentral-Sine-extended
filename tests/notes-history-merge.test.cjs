"use strict";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const T = Date.parse("2026-11-13T12:00:00Z");
function memory() {
  const files = new Map();
  return { files, join: (...parts) => parts.join("/"), exists: async (p) => files.has(p),
    readUTF8: async (p) => { if (!files.has(p)) { const e = new Error("not found"); e.code = "ENOENT"; throw e; } return files.get(p); },
    writeUTF8: async (p, text) => files.set(p, text) };
}
const make = (io, onWrite = () => {}) => C.createReminderHistoryStore({ io, getDir: () => "/n", now: () => T, setTimer: () => 1, clearTimer() {}, onWrite });
const append = (store, id, action, at) => store.append({ id, itemId: "item", occurrenceId: "occ", action, at });
(async () => {
  for (const order of [[0, 1], [1, 0]]) {
    const io = memory(), notices = [], a = make(io, () => notices.push("a")), b = make(io, () => notices.push("b")); await a.open(); await b.open();
    append(a, "a-record", "done", T + 1); append(b, "b-record", "snoozed", T + 2);
    const stores = [a, b]; await stores[order[0]].flush(); await stores[order[1]].flush();
    const reopened = make(io); await reopened.open();
    assert.deepEqual(reopened.list().map((r) => r.id).sort(), ["a-record", "b-record"]);
    assert.equal(reopened.stateFor("item", "occ"), "done"); assert.equal(notices.length, 2);
    assert.deepEqual(stores[order[1]].list().map((r) => r.id).sort(), ["a-record", "b-record"]);
  }
  {
    const io = memory(), store = make(io); await store.open(); append(store, "local", "done", T);
    io.files.set("/n/reminder-history.json", "{bad json");
    await assert.rejects(store.flush()); assert.equal(io.files.get("/n/reminder-history.json"), "{bad json");
    assert.equal(store.storageState().dirty, true, "failed merge retains pending data");
  }
  {
    const io = memory(), store = make(io); await store.open(); append(store, "local", "done", T);
    io.files.set("/n/reminder-history.json", "unreadable"); io.readUTF8 = async () => { throw new Error("permission denied"); };
    await assert.rejects(store.flush()); assert.equal(io.files.get("/n/reminder-history.json"), "unreadable");
    assert.equal(store.storageState().dirty, true);
  }
  {
    const io = memory(), store = make(io); await store.open(); append(store, "first", "done", T);
    let release; const baseRead = io.readUTF8;
    io.readUTF8 = async (path) => { await new Promise((resolve) => { release = resolve; }); return baseRead(path); };
    const pending = store.flush(); await new Promise((resolve) => setImmediate(resolve)); append(store, "later", "reopened", T + 1); release(); await pending;
    io.readUTF8 = baseRead; await store.flush(); const re = make(io); await re.open();
    assert.deepEqual(re.list().map((r) => r.id).sort(), ["first", "later"]); assert.equal(re.stateFor("item", "occ"), "pending");
  }
  console.log("reminder history merge passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
