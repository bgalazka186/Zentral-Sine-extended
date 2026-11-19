"use strict";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const T = Date.parse("2026-11-13T12:00:00Z"), MIN = 60000;
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function fixture() {
  let time = T; const files = new Map();
  const io = { join: (...p) => p.join("/"), readUTF8: async (p) => { if (!files.has(p)) throw new Error("not found"); return files.get(p); }, exists: async (p) => files.has(p), writeUTF8: async (p, text) => files.set(p, text) };
  const items = C.createItemStore({ io, getDir: () => "/n", now: () => time, setTimer: () => 1, clearTimer() {} }); await items.open();
  const host = createFakeZen(), store = { items, list: () => [], get: () => null, on: () => () => {} }, fired = [];
  const scheduler = host.window.__zentralNotesTestSeam.core.createReminderScheduler({ store, now: () => time, setTimer: () => 1, clearTimer() {}, onDue: (values) => fired.push(...values) });
  const run = async () => { scheduler.reschedule(); for (let i = 0; i < 20; i++) await tick(); };
  return { items, files, fired, run, time(value) { time = value; }, async close() { scheduler.destroy(); await host.destroy(); } };
}
const item = (id, start) => ({ id, summary: id, start: { dateTime: new Date(start).toISOString() }, x: { kind: "reminder", src: "manual" } });
(async () => {
  {
    const f = await fixture(); f.items.upsert(item("sleep", T + 10 * MIN)); f.time(T + 2 * 60 * MIN); await f.run();
    assert.deepEqual(f.fired.map((x) => x.__stage), ["followup"], "sleep coalesces three due stages into the highest");
    const records = f.items.history.list({ itemId: "sleep" });
    assert.deepEqual(records.filter((x) => x.coalesced).map((x) => x.stage).sort(), ["due", "pre"]);
    assert.ok(records.some((x) => x.stage === "followup" && x.action === "alerted" && !x.coalesced));
    await f.run(); assert.equal(f.fired.length, 1); await f.items.flush();
    await f.items.open(); assert.equal(f.items.history.list({ itemId: "sleep" }).filter((r) => r.coalesced).length, 2, "coalesced flags survive reload");
    await f.run(); assert.equal(f.fired.length, 1); await f.close();
  }
  {
    const f = await fixture(); const past = f.items.upsert(item("created-past", T - 10 * MIN));
    assert.equal(f.items.history.list({ itemId: past.id }).filter((r) => r.action === "skipped").length, 3, "already-past stages are skipped immediately");
    assert.equal(C.fromGoogle(C.toGoogle(past)).created, past.created, "creation metadata survives Google-shaped round trips");
    await f.run(); assert.equal(f.fired.length, 0); await f.items.flush();
    assert.equal(JSON.parse(f.files.get("/n/reminder-history.json")).records.filter((r) => r.action === "skipped").length, 3);
    await f.close();
  }
  {
    const f = await fixture(); f.items.upsert(item("normal", T + 10 * MIN));
    await f.run(); f.time(T + 9 * MIN); await f.run(); f.time(T + 10 * MIN); await f.run(); f.time(T + 12 * MIN); await f.run();
    assert.deepEqual(f.fired.map((x) => x.__stage), ["pre", "due", "followup"], "on-time stages remain distinct"); await f.close();
  }
  {
    const f = await fixture(); const original = f.items.upsert(item("original", T + 10 * MIN));
    f.items.history.append({ itemId: original.id, action: "done", at: T }); f.time(T + 20 * MIN);
    const copy = f.items.upsert({ ...original, id: "copy", x: { ...original.x, historyId: "" } });
    assert.equal(f.items.history.stateFor(copy.id), "pending");
    assert.equal(f.items.history.list({ itemId: copy.id }).filter((r) => r.action === "skipped").length, 3);
    await f.run(); assert.equal(f.fired.length, 0); await f.close();
  }
  {
    const f = await fixture(); const one = f.items.upsert(item("near-past", T - MIN));
    assert.deepEqual(f.items.history.list({ itemId: one.id }).map((r) => r.stage).sort(), ["due", "pre"]);
    f.time(T + MIN); await f.run(); assert.deepEqual(f.fired.map((r) => r.__stage), ["followup"], "a stage that was future at creation remains eligible"); await f.close();
  }
  {
    const f = await fixture(); const past = f.items.upsert({ ...item("recurring", T - (24 * 60 + 30) * MIN), recurrence: ["RRULE:FREQ=DAILY;COUNT=3"] });
    assert.ok(f.items.history.list({ itemId: past.id }).some((r) => r.action === "skipped"));
    await f.run(); assert.equal(f.fired.length, 0, "old recurring occurrences do not alert immediately");
    f.time(T + (23 * 60 + 29) * MIN); await f.run();
    assert.ok(f.fired.some((r) => r.__stage === "pre"), "future occurrence retains independent alerts"); await f.close();
  }
  {
    const f = await fixture(); const old = item("legacy", T - 10 * MIN);
    f.files.set("/n/calendar.json", JSON.stringify({ v: 2, items: [old], categories: [] }));
    await f.items.open(); await f.run();
    assert.deepEqual(f.fired.map((r) => r.__stage), ["followup"], "legacy items without creation metadata coalesce rather than silently disappearing");
    await f.close();
  }
  {
    const h = createFakeZen(); await h.seam.ensureStore();
    const d = new Date(Date.now() - 30 * MIN), ymd = C.localDateKey(d.getTime()), hhmm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    const original = h.seam.store.create(`## Agenda\n%%calendar%%\n- [ ] ${ymd} ${hhmm} Old task\n`);
    const old = h.seam.store.items.list({ noteId: original.id })[0], oldId = C.reminderIdentity(old);
    h.seam.store.items.history.append({ ...oldId, action: "done", at: Date.now() });
    const copy = h.seam.store.create(h.seam.store.get(original.id).body);
    const fresh = h.seam.store.items.list({ noteId: copy.id })[0], identity = C.reminderIdentity(fresh);
    assert.notEqual(identity.itemId, oldId.itemId); assert.equal(h.seam.store.items.history.stateFor(identity.itemId, identity.occurrenceId), "pending");
    assert.equal(h.seam.store.items.history.list({ itemId: identity.itemId }).filter((r) => r.action === "skipped").length, 3, "copying a note skips its already-past reminder stages");
    await h.destroy();
  }
  {
    const f = await fixture(); f.items.upsert(item("claimed-top", T + 10 * MIN)); f.time(T + 120 * MIN);
    f.items.history.append({ itemId: "claimed-top", occurrenceId: "claimed-top", start: item("x", T + 10 * MIN).start, action: "alerted", stage: "followup", at: T + 119 * MIN });
    await f.run(); assert.equal(f.fired.length, 0, "lower unclaimed stages stay silent after a higher stage was claimed");
    assert.equal(f.items.history.list({ itemId: "claimed-top" }).filter((r) => r.coalesced).length, 2); await f.close();
  }
  console.log("reminder coalescing passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
