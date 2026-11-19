"use strict";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const T = Date.parse("2026-11-13T12:00:00Z"), files = new Map(); let writes = 0;
const io = { join: (...x) => x.join("/"), exists: async (p) => files.has(p), readUTF8: async (p) => { if (!files.has(p)) throw new Error("not found"); return files.get(p); }, writeUTF8: async (p, text) => { writes++; files.set(p, text); } };
const create = () => C.createReminderHistoryStore({ io, getDir: () => "/n", now: () => T, setTimer: () => 1, clearTimer() {} });
const append = (history, id) => history.append({ id, itemId: id, action: "done", at: T });
(async () => {
  const a = create(), b = create(); await a.open(); await b.open();
  append(a, "from-a"); await a.flush(); const before = writes;
  assert.equal(await b.refresh(), 1); assert.equal(b.storageState().dirty, false, "merging saved remote records is not a local write");
  await b.flush(); assert.equal(writes, before, "pure refresh does not rewrite history");
  append(b, "local-b"); append(a, "remote-a"); await a.flush();
  assert.equal(await b.refresh(), 1); assert.equal(b.storageState().dirty, true, "refresh does not clear pending local work");
  await b.flush(); const reopened = create(); await reopened.open();
  assert.deepEqual(reopened.list().map((r) => r.id).sort(), ["from-a", "local-b", "remote-a"]);
  {
    const c = create(); await c.open(); append(c, "in-flight");
    const originalWrite = io.writeUTF8; let release, began;
    const started = new Promise((resolve) => { began = resolve; });
    io.writeUTF8 = async (path, text) => { began(); await new Promise((resolve) => { release = resolve; }); return originalWrite(path, text); };
    const pending = c.flush(); await started; assert.equal(c.storageState().dirty, true, "an in-flight local record is not yet saved");
    append(c, "during-write"); await c.open(); assert.ok(c.list().some((r) => r.id === "during-write"), "opening cannot discard pending work");
    release(); await pending; io.writeUTF8 = originalWrite;
    assert.equal(c.storageState().dirty, true, "changes made after the snapshot remain dirty"); await c.flush();
    const re = create(); await re.open(); assert.ok(re.list().some((r) => r.id === "during-write"));
  }
  console.log("history refresh dirty-state passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
