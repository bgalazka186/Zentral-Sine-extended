"use strict";
/* F0.13: the save queue of the note store keeps going after a step failed, even when reporting the failure failed too.
 * Before: a queued step whose report threw left the queue rejected; the step queued next was skipped without a word,
 * and the "note flush in progress" marker stayed on a rejected promise, so every later calendar write got that promise
 * instead of a fresh note flush (the note text was no longer written before calendar.json).
 * Uses the real createStore of additional/notes/ZentralNotes.uc.js with an in-memory folder and hand-driven timers. */
const assert = require("node:assert/strict");
const { createPanelWorld } = require("./helpers/fake-panel-window.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }
const rejections = [];
process.on("unhandledRejection", (error) => rejections.push(String(error?.message || error)));
const settle = async (turns = 6) => { for (let i = 0; i < turns; i++) await new Promise((r) => setImmediate(r)); };

function memoryFolder() {
  const files = new Map(), log = [];
  const io = {
    fail: null,
    join: (...parts) => parts.join("/"), filename: (p) => p.split("/").pop(),
    async readUTF8(p) { if (!files.has(p)) { const e = new Error("NotFound " + p); e.name = "NotFoundError"; throw e; } return files.get(p); },
    async writeUTF8(p, text) { if (io.fail?.(p)) throw new Error("injected write failure"); log.push(p); files.set(p, text); },
    async remove(p) { files.delete(p); },
    async exists(p) { return files.has(p) || [...files.keys()].some((k) => k.startsWith(p + "/")); },
    async children(dir) { return [...files.keys()].filter((p) => p.startsWith(dir + "/") && !p.slice(dir.length + 1).includes("/")); },
    async stat() { return { lastModified: 0 }; },
    async restrict() {}, async makeDir() {}, async removeTree() {}, async moveTree() {},
  };
  return { io, files, log };
}
function makeStore(core, folder, hooks) {
  const timers = new Map(); let nextId = 0;
  const store = core.createStore({
    io: folder.io, notify() {}, windowId: "queue-window", withHistoryLock: undefined, getDir: async () => "/notes", getMaxSaveMs: () => 5000,
    setTimer: (fn, ms) => { if (hooks.timerThrows?.(ms)) throw new Error("the timer could not be armed"); timers.set(++nextId, { fn, ms }); return nextId; },
    clearTimer: (id) => { timers.delete(id); },
    warn: (error) => { hooks.warned.push(String(error?.message || error)); if (hooks.warnThrows) throw new Error("the report failed too"); },
  });
  return { store, timers };
}
const noteOnDisk = (folder, id) => folder.files.get("/notes/" + id + ".md") || "";

(async () => {
  const core = createPanelWorld().openWindow({ id: "queue" }).core;

  await test("a failed save whose report fails too does not skip the saves queued after it", async () => {
    const folder = memoryFolder(), hooks = { warned: [], warnThrows: false, timerThrows: null };
    const { store } = makeStore(core, folder, hooks);
    await store.open();
    const note = store.create("# Queue\nfirst\n");
    await store.flush();
    assert.match(noteOnDisk(folder, note.id), /first/);
    // The write fails, arming the retry throws, and the report of that throws as well.
    folder.io.fail = (p) => p.endsWith(".md");
    hooks.timerThrows = (ms) => ms === 10000; hooks.warnThrows = true;
    store.update(note.id, "# Queue\nsecond, not written\n");
    await store.flush().catch(() => {});
    await settle();
    assert.ok(hooks.warned.some((text) => /injected write failure/.test(text)), "the failed write was reported");
    folder.io.fail = null; hooks.timerThrows = null; hooks.warnThrows = false;
    store.update(note.id, "# Queue\nthird\n");
    await store.flush();
    assert.match(noteOnDisk(folder, note.id), /third/, "the next save ran; before, it was skipped and the text stayed only in memory");
    assert.equal(store.state.save, "saved");
    assert.deepEqual(rejections, [], "no promise was left rejected without a handler");
    await store.close();
  });

  await test("after such a failure a calendar write still puts the note text on disk first", async () => {
    const folder = memoryFolder(), hooks = { warned: [], warnThrows: false, timerThrows: null };
    const { store } = makeStore(core, folder, hooks);
    await store.open();
    const day = C.localDateKey(C.addDays(C.dayStart(Date.now()), 2));
    const note = store.create("# Plan\n\n## Agenda\n%%calendar%%\n- [ ] " + day + " 09:00 First line\n");
    await store.flush();
    folder.io.fail = (p) => p.endsWith(".md");
    hooks.timerThrows = (ms) => ms === 10000; hooks.warnThrows = true;
    store.update(note.id, store.get(note.id).body + "- [ ] " + day + " 10:00 Second line\n");
    await store.flush().catch(() => {});
    await settle();
    folder.io.fail = null; hooks.timerThrows = null; hooks.warnThrows = false;
    // Only the calendar is asked to save now: its hook must start a fresh note flush.
    store.update(note.id, store.get(note.id).body + "- [ ] " + day + " 11:00 Third line\n");
    folder.log.length = 0;
    await store.items.flush();
    const noteAt = folder.log.findIndex((p) => p.endsWith("/" + note.id + ".md")), calendarAt = folder.log.lastIndexOf("/notes/" + C.ITEMS_FILE);
    assert.ok(noteAt >= 0, "the calendar write flushed the note; before, it was handed the old rejected flush and wrote alone");
    assert.ok(calendarAt > noteAt, "note first, then calendar.json");
    assert.match(noteOnDisk(folder, note.id), /Third line/);
    const saved = JSON.parse(folder.files.get("/notes/" + C.ITEMS_FILE)).items.map((item) => item.summary).sort();
    assert.deepEqual(saved, ["First line", "Second line", "Third line"]);
    assert.deepEqual(rejections, []);
    await store.close();
  });

  console.log(`\n${passed} save-queue tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
