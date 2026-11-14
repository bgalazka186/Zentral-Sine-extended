"use strict";
const assert = require("node:assert/strict"), C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const now = 1700000000000, entry = { itemId: "i", occurrenceId: "i", stage: "due", start: { dateTime: new Date(now).toISOString() }, at: now };
function fixture() {
  const files = new Map(); let failing = false;
  const io = { join: (...parts) => parts.join("/"), exists: async path => files.has(path),
    readUTF8: async path => { if (!files.has(path)) { const e = new Error("not found"); e.code = "ENOENT"; throw e; } return files.get(path); },
    writeUTF8: async (path, text) => { if (failing) throw Error("disk full"); files.set(path, text); } };
  const history = C.createReminderHistoryStore({ io, getDir: () => "/notes", now: () => now, setTimer: () => 1, clearTimer() {} });
  return { history, files, io, fail(value) { failing = value; } };
}
(async () => {
  {
    const f = fixture(); await f.history.open();
    f.history.append({ id: "pending-local", itemId: "other", action: "done", at: now });
    f.fail(true); assert.equal(await f.history.claimAlert(entry), null, "failed persistence must not announce a claim");
    assert.equal(f.history.list({ itemId: "i" }).length, 0, "failed claim is removed so the stage can be retried");
    assert.equal(f.history.list({ itemId: "other" }).length, 1, "unrelated pending history remains");
    assert.equal(f.history.storageState().dirty, true);
    f.fail(false); assert.ok(await f.history.claimAlert(entry), "same stage can claim after storage recovers");
    assert.equal(f.history.list({ itemId: "i" }).length, 1);
    assert.deepEqual(JSON.parse(f.files.get("/notes/reminder-history.json")).records.map(r => r.itemId).sort(), ["i", "other"]);
  }
  {
    const f = fixture(); await f.history.open();
    f.history.append({ id: "same-id", itemId: "untouched", action: "done", at: now });
    f.fail(true); assert.equal(await f.history.claimAlert({ ...entry, id: "same-id" }), null);
    assert.deepEqual(f.history.list().map(r => r.itemId), ["untouched"], "rollback uses record identity, not a reused id");
  }
  {
    const f = fixture(); await f.history.open(); let release, started;
    const writing = new Promise(resolve => { started = resolve; });
    f.io.writeUTF8 = async () => { started(); await new Promise(resolve => { release = resolve; }); throw Error("disk full"); };
    const claiming = f.history.claimAlert(entry); await writing;
    f.history.append({ id: "during", itemId: "other", action: "done", at: now });
    release(); assert.equal(await claiming, null);
    assert.deepEqual(f.history.list().map(r => r.id), ["during"], "rollback retains an action added while I/O was in flight");
    assert.equal(f.history.storageState().dirty, true);
  }
  {
    // A claim waits for an earlier flush, so it cannot be accidentally
    // included in the older snapshot before its own transaction runs.
    const f = fixture(); await f.history.open();
    f.history.append({ id: "prior", itemId: "other", action: "done", at: now });
    const originalRead = f.io.readUTF8, originalWrite = f.io.writeUTF8;
    let reads = 0, writes = 0, release, started;
    const reading = new Promise(resolve => { started = resolve; });
    f.io.readUTF8 = async path => { if (++reads === 1) { started(); await new Promise(resolve => { release = resolve; }); } return originalRead(path); };
    f.io.writeUTF8 = async (...args) => { if (++writes === 2) throw Error("disk full"); return originalWrite(...args); };
    const earlier = f.history.flush(); await reading;
    const claiming = f.history.claimAlert(entry); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.history.list({ itemId: "i" }).length, 0, "claim waits until the earlier flush completes");
    release(); await earlier; assert.equal(await claiming, null, "failed claim is not displayed");
    assert.ok(!JSON.parse(f.files.get("/notes/reminder-history.json")).records.some(r => r.itemId === "i"));
    assert.ok(await f.history.claimAlert(entry), "the stage can be retried after the failure");
  }
  {
    const f = fixture(); await f.history.open();
    f.history.append({ id: "prior", itemId: "other", action: "done", at: now });
    const originalRead = f.io.readUTF8, originalWrite = f.io.writeUTF8;
    let reads = 0, writes = 0, release, started;
    const reading = new Promise(resolve => { started = resolve; });
    f.io.readUTF8 = async path => { if (++reads === 1) { started(); await new Promise(resolve => { release = resolve; }); } return originalRead(path); };
    f.io.writeUTF8 = async (...args) => { if (++writes === 2) throw Error("disk full"); return originalWrite(...args); };
    const earlier = f.history.flush(); await reading;
    const claiming = f.history.claimAlertGroups([[entry, { ...entry, stage: "pre" }]]);
    await new Promise(resolve => setImmediate(resolve)); release(); await earlier;
    assert.deepEqual(await claiming, [], "failed digest transaction is not shown");
    assert.equal(JSON.parse(f.files.get("/notes/reminder-history.json")).records.filter(r => r.itemId === "i").length, 0);
    assert.deepEqual(await f.history.claimAlertGroups([[entry, { ...entry, stage: "pre" }]]), [0]);
  }
  {
    const f = fixture(); await f.history.open();
    f.files.set("/notes/reminder-history.json", "{damaged");
    assert.equal(await f.history.claimAlert(entry), null, "corrupt storage must not announce a claim");
    assert.equal(f.history.storageState().writeBlocked, true);
    assert.equal(f.history.list({ itemId: "i" }).length, 0);
    assert.equal(f.files.get("/notes/reminder-history.json"), "{damaged");
  }
  {
    const f = fixture(); await f.history.open(); f.fail(true);
    const groups = [[entry, { ...entry, stage: "pre" }]];
    assert.deepEqual(await f.history.claimAlertGroups(groups), [], "failed digest claims must not be displayed");
    assert.equal(f.history.list().length, 0);
    f.fail(false); assert.deepEqual(await f.history.claimAlertGroups(groups), [0], "digest can retry after recovery");
    assert.equal(f.history.list().length, 2);
  }
  {
    // Exercise the real scheduler after the final stage fails: it must retry
    // rather than silently losing the reminder until some unrelated wake.
    const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
    const f = fixture(); let clock = now, scheduled = null, alertCount = 0;
    const items = C.createItemStore({ io: f.io, getDir: () => "/notes", now: () => clock, setTimer: () => 1, clearTimer() {} }); await items.open();
    items.upsert({ id: "retry", summary: "Retry", start: { dateTime: new Date(now + 60000).toISOString() }, x: { kind: "reminder", src: "manual", notify: { pre: { enabled: false }, followup: { enabled: false } } } });
    clock += 60000; const host = createFakeZen();
    const scheduler = host.window.__zentralNotesTestSeam.core.createReminderScheduler({
      store: { items, list: () => [], on: () => () => {} }, now: () => clock,
      setTimer: (fn, ms) => { scheduled = { fn, ms }; return 1; }, clearTimer() { scheduled = null; },
      onDue: batch => { alertCount += batch.length; },
    });
    try {
      f.fail(true); await scheduler.start(); assert.equal(alertCount, 0);
      assert.ok(scheduled && scheduled.ms > 0 && scheduled.ms <= 30000, "a failed claim arms a bounded retry");
      f.fail(false); const run = scheduled.fn; scheduled = null; clock += 30000; await run();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(alertCount, 1, "the reminder is displayed after durable retry");
    } finally { scheduler.destroy(); await host.destroy(); }
  }
  {
    const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
    const f = fixture(); let clock = now, scheduled = null, alertCount = 0;
    const items = C.createItemStore({ io: f.io, getDir: () => "/notes", now: () => clock, setTimer: () => 1, clearTimer() {} }); await items.open();
    items.upsert({ id: "persistent-failure", summary: "Retry", start: { dateTime: new Date(now + 60000).toISOString() }, x: { kind: "reminder", src: "manual", notify: { pre: { enabled: false }, followup: { enabled: false } } } });
    clock += 60000; const host = createFakeZen();
    const scheduler = host.window.__zentralNotesTestSeam.core.createReminderScheduler({
      store: { items, list: () => [], on: () => () => {} }, now: () => clock,
      setTimer: (fn, ms) => { scheduled = { fn, ms }; return 1; }, clearTimer() { scheduled = null; },
      onDue: batch => { alertCount += batch.length; },
    });
    try {
      f.fail(true); await scheduler.start();
      for (let i = 0; i < 3; i++) {
        assert.ok(scheduled, "a bounded retry is scheduled");
        const run = scheduled.fn; scheduled = null; clock += 30000; run();
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(scheduled, null, "persistent failure stops retrying after the bounded attempts");
      assert.equal(alertCount, 0); assert.equal(items.history.list({ itemId: "persistent-failure" }).length, 0);
    } finally { scheduler.destroy(); await host.destroy(); }
  }
  console.log("Reminder claim persistence failure tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
