"use strict";
const assert = require("node:assert/strict");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const MIN = 60000, DAY = 86400000, START = Date.parse("2026-11-13T12:00:00Z");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const drain = async () => { for (let i = 0; i < 40; i++) await tick(); };
const reminder = (id, at) => ({ id, summary: id, created: new Date(START - 20 * DAY).toISOString(), start: { dateTime: new Date(at).toISOString() }, x: { kind: "reminder", src: "manual" } });
async function fixture() {
  let time = START;
  const files = new Map();
  const io = { join: (...p) => p.join("/"), readUTF8: async (p) => { if (!files.has(p)) throw Error("not found"); return files.get(p); }, exists: async (p) => files.has(p), writeUTF8: async (p, data) => files.set(p, data) };
  const items = C.createItemStore({ io, getDir: () => "/notes", now: () => time, setTimer: () => 1, clearTimer() {} }); await items.open();
  const host = createFakeZen();
  const store = { items, list: () => [], get: () => null, on: () => () => {} };
  const alerts = [], digests = [];
  const scheduler = host.window.__zentralNotesTestSeam.core.createReminderScheduler({ store, now: () => time, setTimer: () => 1, clearTimer() {}, onDue: (batch) => alerts.push(...batch), onDigest: (batch) => digests.push(batch), getDigestDays: () => 7 });
  return { items, files, alerts, digests, scheduler, setTime: (value) => { time = value; }, async close() { scheduler.destroy(); await host.destroy(); } };
}
(async () => {
  {
    const f = await fixture();
    // Saved while the app was running, then loaded after it was closed for five days.
    f.items.upsert(reminder("a", START + 10 * MIN));
    f.items.upsert(reminder("b", START + 1 * DAY));
    f.items.upsert(reminder("c", START + 3 * DAY));
    f.setTime(START + 5 * DAY); await f.scheduler.start(); await drain();
    assert.equal(f.digests.length, 1, "one digest after a long closure");
    assert.deepEqual(Array.from(f.digests[0], (v) => v.__historyIdentity.itemId).sort(), ["a", "b", "c"]);
    assert.equal(f.alerts.length, 0, "missed reminders do not also produce stage banners");
    await f.scheduler.reschedule(); await drain();
    assert.equal(f.digests.length, 1, "persisted claims prevent repeat digests"); await f.close();
  }
  {
    const f = await fixture();
    f.items.upsert(reminder("wake", START + 10 * MIN));
    await f.scheduler.start(); await drain(); f.setTime(START + 2 * 60 * MIN);
    await f.scheduler.wake(); await drain();
    assert.equal(f.digests.length, 1, "wake collects reminders missed since last scheduler pass");
    assert.equal(f.alerts.length, 0, "wake does not also show a stage banner"); await f.close();
  }
  {
    const f = await fixture();
    f.items.upsert(reminder("too-old", START + MIN));
    f.items.upsert(reminder("finished", START + MIN));
    f.items.history.append({ itemId: "finished", action: "done", at: START });
    f.setTime(START + 9 * DAY); await f.scheduler.start(); await drain();
    assert.equal(f.digests.length, 0, "done and reminders beyond the configured look-back are excluded"); await f.close();
  }
  {
    const f = await fixture();
    f.items.upsert({ ...reminder("lead", START + 5 * DAY), reminders: { overrides: [{ method: "popup", minutes: 4 * 24 * 60 }] } });
    f.setTime(START + 2 * DAY); await f.scheduler.start(); await drain();
    assert.equal(f.digests.length, 1, "last notification stage can be missed before a future reminder start");
    assert.equal(f.digests[0][0].__historyIdentity.itemId, "lead"); await f.close();
  }
  {
    const f = await fixture(); f.items.upsert(reminder("protected", START + MIN));
    f.files.set("/notes/reminder-history.json", "{broken"); await f.items.history.open();
    assert.equal(f.items.history.storageState().writeBlocked, true);
    f.setTime(START + DAY); await f.scheduler.start(); await drain();
    assert.equal(f.digests.length, 0); assert.equal(f.alerts.length, 0, "protected history never produces an unclaimed digest or stage banner");
    await f.close();
  }
  {
    const f = await fixture(); f.items.upsert(reminder("normal", START + 10 * MIN));
    await f.scheduler.start(); f.setTime(START + 9 * MIN); await f.scheduler.reschedule(); await drain();
    assert.equal(f.digests.length, 0); assert.equal(f.alerts.length, 1, "normal stage alerts remain distinct after startup"); await f.close();
  }
  {
    const h = createFakeZen(); let now = START, claims = 0;
    const note = { id: "legacy-done", body: "done note", remind: START - MIN, reminded: 0, trashed: false };
    const hist = { stateFor: () => "done", async refresh() {}, flush: async () => {} };
    const store = { items: { list: () => [], history: hist }, list: () => [note], get: () => note, on: () => () => {}, async claimReminder() { claims++; return true; } };
    const digests = [], scheduler = h.window.__zentralNotesTestSeam.core.createReminderScheduler({ store, now: () => now, setTimer: () => 1, clearTimer() {}, onDue() {}, onDigest: batch => digests.push(batch) });
    await scheduler.start(); await drain(); assert.equal(claims, 0, "legacy reminders completed in history are not claimed"); assert.equal(digests.length, 0);
    scheduler.destroy(); await h.destroy();
  }
  {
    const files = new Map(); const io = { join: (...p) => p.join("/"), exists: async (p) => files.has(p), readUTF8: async (p) => { if (!files.has(p)) throw Error("missing"); return files.get(p); }, writeUTF8: async (p, v) => files.set(p, v) };
    const opts = { io, getDir: () => "/shared", now: () => START, setTimer: () => 1, clearTimer() {} };
    const a = C.createReminderHistoryStore(opts), b = C.createReminderHistoryStore(opts); await a.open(); await b.open();
    a.append({ itemId: "shared", action: "done", at: START }); await a.flush();
    const result = await b.claimAlert({ itemId: "shared", occurrenceId: "shared", start: { dateTime: new Date(START).toISOString() }, stage: "followup", at: START, requirePending: true });
    assert.equal(result, null, "claim rechecks remotely completed occurrence after refreshing shared history");
    let writes = 0; const write = io.writeUTF8; io.writeUTF8 = async (...args) => { writes++; return write(...args); };
    const groups = ["one", "two", "three"].map((id) => ["followup", "pre", "due"].map((stage, i) => ({ itemId: id, occurrenceId: id, start: { dateTime: new Date(START).toISOString() }, stage, at: START, requirePending: true, coalesced: i > 0 })));
    const claimed = await b.claimAlertGroups(groups);
    assert.equal(claimed.length, 3); assert.equal(writes, 1, "one merged history write for a digest batch");
    assert.equal((await a.claimAlertGroups(groups)).length, 0, "other windows see the existing claims");
  }
  {
    const h = createFakeZen(); await h.seam.ensureStore();
    const now = Date.now();
    for (const id of ["host-a", "host-b", "host-c"]) h.seam.store.items.upsert(reminder(id, now + 10 * MIN));
    h.advanceClock(3 * DAY); assert.ok(h.fireTimer(4000)); await drain();
    const cards = h.document.querySelectorAll(".zn-reminder-card");
    assert.equal(cards.length, 1, "real host shows one digest, not three stage cards");
    assert.ok(cards[0].textContent.includes("3 reminders you missed"));
    cards[0].querySelector('[data-action="dismiss-all"]').click();
    for (const id of ["host-a", "host-b", "host-c"]) assert.equal(h.seam.store.items.history.stateFor(id), "dismissed");
    assert.equal(h.document.querySelectorAll(".zn-reminder-card").length, 0); await h.destroy();
  }
  {
    const h = createFakeZen(); await h.seam.ensureStore(); const now = Date.now();
    h.seam.store.items.upsert({ ...reminder("series", now + MIN), recurrence: ["RRULE:FREQ=DAILY;COUNT=4"] });
    h.seam.store.items.upsert({ id: "all-day", summary: "All day", start: { date: C.localDateKey(now + DAY) }, x: { kind: "reminder", src: "manual" } });
    const note = h.seam.store.create("# Missed legacy"); h.seam.store.setReminder(note.id, now + 10 * MIN);
    h.advanceClock(2 * DAY + 12 * 60 * MIN); assert.ok(h.fireTimer(4000)); await drain();
    const card = h.document.querySelector(".zn-reminder-card"); assert.ok(card && card.textContent.includes("5 reminders you missed"));
    card.querySelector('[data-action="snooze-all"]').click();
    assert.equal(h.document.querySelectorAll(".zn-reminder-card").length, 0, "bulk snooze handles recurring, all-day and legacy reminders");
    assert.ok(h.seam.store.get(note.id).remind > now + 2 * DAY);
    const master = h.seam.store.items.get("series"); assert.equal(master.x.recurrenceExceptions.length, 3);
    const history = h.seam.store.items.history.list({ itemId: "series" }); assert.equal(history.filter((r) => r.action === "snoozed").length, 3);
    assert.ok(h.seam.store.items.get("all-day").start.date > C.localDateKey(now + 2 * DAY)); await h.destroy();
  }
  {
    const dom = require("./helpers/fake-dom.cjs")(), h = createFakeZen(); let handler;
    const hist = { list: () => [], stateFor: () => "pending", on: (f) => { handler = f; return () => { handler = null; }; } };
    const stack = h.window.__zentralNotesTestSeam.core.createReminderAlertStack({ document: dom.document, history: hist, listen: (target, type, fn) => { target.addEventListener(type, fn); return () => target.removeEventListener(type, fn); } });
    let opened = 0, dismissed = 0, fail = true;
    stack.showDigest([{ identity: { itemId: "a", occurrenceId: "a" }, title: "Alpha", open: () => { opened++; }, dismiss: () => { dismissed++; return true; }, snooze: () => true }, { identity: { itemId: "b", occurrenceId: "b" }, title: "Beta", open: () => {}, dismiss: () => { dismissed++; return !fail; }, snooze: () => false }]);
    let card = dom.document.documentElement.querySelector(".zn-reminder-card"); assert.ok(card.textContent.includes("2 reminders you missed"));
    card.querySelector('[data-action="open-list"]').click(); card = dom.document.documentElement.querySelector(".zn-reminder-card"); assert.ok(card.textContent.includes("Alpha"));
    card.querySelector('[data-action="open-0"]').click(); assert.equal(opened, 1);
    card.querySelector('[data-action="dismiss-all"]').click();
    card = dom.document.documentElement.querySelector(".zn-reminder-card"); assert.ok(card && card.textContent.includes("1 reminder you missed"), "partial failure keeps the failed reminder visible");
    assert.ok(card.textContent.includes("could not"), "partial bulk failures are explained");
    assert.equal(dismissed, 2); fail = false; card.querySelector('[data-action="dismiss-all"]').click();
    assert.equal(dom.document.documentElement.querySelector(".zn-reminder-card"), null);
    stack.destroy(); assert.equal(handler, null); await h.destroy();
  }
  {
    const dom = require("./helpers/fake-dom.cjs")(), h = createFakeZen();
    const stack = h.window.__zentralNotesTestSeam.core.createReminderAlertStack({ document: dom.document, history: { list: () => [], on: () => () => {} }, listen: (target, type, fn) => { target.addEventListener(type, fn); return () => target.removeEventListener(type, fn); } });
    stack.showDigest(Array.from({ length: 250 }, (_, i) => ({ identity: { itemId: String(i), occurrenceId: String(i) }, title: "item " + i })));
    let card = dom.document.documentElement.querySelector(".zn-reminder-card"); card.querySelector('[data-action="open-list"]').click();
    card = dom.document.documentElement.querySelector(".zn-reminder-card");
    assert.ok(card.querySelectorAll("button").length < 110, "long digest lists render in bounded pages");
    assert.ok(card.querySelector('[data-action="more"]')); stack.destroy(); await h.destroy();
  }
  console.log("missed reminder digest passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
