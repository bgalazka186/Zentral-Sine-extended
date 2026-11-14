"use strict";
// One shared lock registry models the browser-process owner. Each module is
// evaluated in its own VM to model independently loaded browser windows.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../additional/notes/calendar/ZentralNotesCalendar.js"), "utf8");
function load() { const module = { exports: {} }; vm.runInNewContext(source, { module, console, Date, Promise, Map, Set, JSON, Math, Intl, RegExp, Number }); return module.exports; }
function memory() {
  const files = new Map();
  return { files, join: (...p) => p.join("/"), exists: async p => files.has(p),
    readUTF8: async p => { if (!files.has(p)) { const e = new Error("not found"); e.code = "ENOENT"; throw e; } return files.get(p); },
    writeUTF8: async (p, data) => { files.set(p, data); } };
}
const now = 1700000000000;
const entry = { itemId: "item", occurrenceId: "occ", stage: "due", start: { dateTime: new Date(now).toISOString() }, at: now };
(async () => {
  const aMod = load(), bMod = load(), registry = new Map(), io = memory();
  assert.equal(typeof aMod.createHistoryCoordinator, "function");
  const aLock = aMod.createHistoryCoordinator(registry), bLock = bMod.createHistoryCoordinator(registry);
  const opts = withHistoryLock => ({ io, getDir: () => "/notes", now: () => now, setTimer: () => 1, clearTimer() {}, withHistoryLock });
  const a = aMod.createReminderHistoryStore(opts(aLock)), b = bMod.createReminderHistoryStore(opts(bLock)); await a.open(); await b.open();
  const claims = await Promise.all([a.claimAlert(entry), b.claimAlert(entry)]);
  assert.equal(claims.filter(Boolean).length, 1, "concurrent claims from independent windows produce only one winner");
  assert.equal(registry.size, 0, "settled locks leave no retained windows");
  const groups = [[{ ...entry, stage: "followup" }, { ...entry, stage: "pre" }]];
  const results = await Promise.all([a.claimAlertGroups(groups), b.claimAlert({ ...entry, stage: "followup" })]);
  assert.equal(results[0].length + Number(!!results[1]), 1, "digest and individual claims coordinate");
  a.append({ id: "a", itemId: "a", action: "done", at: now });
  b.append({ id: "b", itemId: "b", action: "done", at: now });
  await Promise.all([a.flush(), b.flush()]);
  const reopened = aMod.createReminderHistoryStore(opts(aLock)); await reopened.open();
  assert.ok(reopened.list().some(r => r.id === "a") && reopened.list().some(r => r.id === "b"), "concurrent history writes retain both records");
  assert.equal(registry.size, 0);
  {
    const finish = { ...entry, itemId: "finish", occurrenceId: "finish", requirePending: true };
    a.append({ itemId: "finish", occurrenceId: "finish", action: "done", at: now });
    const [saved, claimed] = await Promise.all([a.flush(), b.claimAlert(finish)]);
    assert.ok(saved); assert.equal(claimed, null, "a persisted Done wins over the following pending-only claim");
  }
  {
    const original = io.writeUTF8; let fail = true;
    io.writeUTF8 = async (...args) => { if (fail) { fail = false; throw Error("disk full"); } return original(...args); };
    const candidate = { ...entry, itemId: "failure", occurrenceId: "failure" };
    const [bad, winner] = await Promise.all([a.claimAlert(candidate), b.claimAlert(candidate)]);
    assert.equal(bad, null); assert.ok(winner, "failure releases the lock and another window can claim");
    assert.equal(registry.size, 0); io.writeUTF8 = original;
  }
  {
    const io2 = memory(), module = load(), local = module.createReminderHistoryStore({ ...opts(aLock), io: io2 });
    io2.files.set("/notes/reminder-history.json", JSON.stringify({ v: 1, records: [] }));
    const read = io2.readUTF8; let started, release;
    const reading = new Promise(resolve => { started = resolve; });
    io2.readUTF8 = async p => { started(); await new Promise(resolve => { release = resolve; }); return read(p); };
    const opening = local.open(); await reading;
    local.append({ id: "during-open", itemId: "during-open", action: "done", at: now });
    release(); await opening;
    assert.ok(local.list().some(r => r.id === "during-open"), "open never clears a record appended during its read");
    io2.readUTF8 = read; await local.flush();
    assert.ok(JSON.parse(io2.files.get("/notes/reminder-history.json")).records.some(r => r.id === "during-open"));
  }
  {
    let unblock; const gate = new Promise(resolve => { unblock = resolve; }); const order = [];
    const first = aLock("same", async () => { order.push("start-a"); await gate; order.push("end-a"); });
    const second = bLock("same", async () => { order.push("b"); throw Error("failure"); });
    const other = bLock("other", async () => { order.push("other"); });
    await other; assert.ok(order.includes("other") && !order.includes("b"), "unrelated paths proceed independently");
    unblock(); await first; await assert.rejects(second, /failure/);
    await aLock("same", async () => { order.push("after-failure"); });
    assert.deepEqual(order, ["start-a", "other", "end-a", "b", "after-failure"]);
    assert.equal(registry.size, 0, "failure releases lock and registry entry");
  }
  {
    const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
    const io2 = memory(), registry2 = new Map(); let time = now, alerts = 0;
    const options = lock => ({ io: io2, getDir: () => "/other", now: () => time, setTimer: () => 1, clearTimer() {}, withHistoryLock: lock });
    const otherHistory = aMod.createReminderHistoryStore(options(aMod.createHistoryCoordinator(registry2)));
    const items = bMod.createItemStore(options(bMod.createHistoryCoordinator(registry2)));
    await otherHistory.open(); await items.open();
    items.upsert({ id: "finished", summary: "Finished", start: { dateTime: new Date(now + 60000).toISOString() }, x: { kind: "reminder", src: "manual", notify: { pre: { enabled: false }, followup: { enabled: false } } } });
    time += 60000; otherHistory.append({ itemId: "finished", occurrenceId: "finished", action: "done", at: time }); await otherHistory.flush();
    assert.equal(items.history.stateFor("finished"), "pending", "the second window starts with stale lifecycle state");
    const host = createFakeZen(), scheduler = host.window.__zentralNotesTestSeam.core.createReminderScheduler({
      store: { items, list: () => [], on: () => () => {} }, now: () => time, setTimer: () => 1, clearTimer() {}, onDue: batch => { alerts += batch.length; },
    });
    try {
      await scheduler.start();
      assert.equal(alerts, 0, "a Done persisted in another window prevents a stale due alert");
    } finally { scheduler.destroy(); await host.destroy(); }
  }
  {
    const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
    const sharedWindow = { Map }, files = new Map();
    const first = createFakeZen({ id: "a", files, calendar: load(), hiddenDOMWindow: sharedWindow });
    const second = createFakeZen({ id: "b", files, calendar: load(), hiddenDOMWindow: sharedWindow });
    try {
      await first.seam.ensureStore(); await second.seam.ensureStore();
      const claims = await Promise.all([first.seam.store.items.history.claimAlert(entry), second.seam.store.items.history.claimAlert(entry)]);
      assert.equal(claims.filter(Boolean).length, 1, "separate browser-window modules use the shared process registry");
      assert.equal(sharedWindow.__zentralNotesHistoryLocksV1.size, 0, "process registry retains no idle work");
      await first.destroy();
      assert.ok(await second.seam.store.items.history.claimAlert({ ...entry, stage: "pre" }), "closing one window does not strand the shared lock");
    } finally { await first.destroy(); await second.destroy(); }
  }
  console.log("Shared reminder-history coordination tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
