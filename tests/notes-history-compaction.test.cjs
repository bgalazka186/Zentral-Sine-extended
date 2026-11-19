"use strict";
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { scaleBudget } = require("./helpers/perf-budget.cjs");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");

const DAY = 86400000;
const NOW = Date.parse("2026-11-17T12:00:00Z");

function makeMemoryIO(initial = []) {
  const files = new Map(initial);
  let failPath = null;
  const writes = [];
  const io = {
    join: (...parts) => parts.join("/"),
    exists: async (p) => files.has(p),
    readUTF8: async (p) => {
      if (!files.has(p)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return files.get(p);
    },
    writeUTF8: async (p, text) => {
      if (failPath && p.includes(failPath)) throw new Error("Simulated write failure: " + p);
      writes.push({ path: p, bytes: Buffer.byteLength(text, "utf8") });
      files.set(p, String(text));
    },
  };
  return { io, files, writes, setFailPath(v) { failPath = v; } };
}

function makeYearWorkload(totalRecords, nowMs = NOW) {
  const records = [];
  let seq = 1;
  const occCount = Math.floor(totalRecords / 5);
  for (let i = 0; i < occCount; i++) {
    const daysAgo = Math.floor((i / occCount) * 365);
    const baseAt = nowMs - daysAgo * DAY - 3600000;
    const itemId = "rem-" + (i % 40);
    const occId = itemId + "@" + baseAt;
    const start = { dateTime: new Date(baseAt).toISOString() };
    records.push({ id: `r-${seq}`, seq: seq++, itemId, occurrenceId: occId, summary: "Daily standup " + i, start, action: "alerted", stage: "pre", at: baseAt - 300000 });
    records.push({ id: `r-${seq}`, seq: seq++, itemId, occurrenceId: occId, summary: "Daily standup " + i, start, action: "alerted", stage: "due", at: baseAt });
    records.push({ id: `r-${seq}`, seq: seq++, itemId, occurrenceId: occId, summary: "Daily standup " + i, start, action: "alerted", stage: "followup", at: baseAt + 600000 });
    records.push({ id: `r-${seq}`, seq: seq++, itemId, occurrenceId: occId, summary: "Daily standup " + i, start, action: "snoozed", stage: "", at: baseAt + 900000 });
    records.push({ id: `r-${seq}`, seq: seq++, itemId, occurrenceId: occId, summary: "Daily standup " + i, start, action: i % 3 === 0 ? "dismissed" : "done", stage: "", at: baseAt + 1200000 });
  }
  return records;
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

(async () => {
  try {
    await test("1. Pure compactReminderHistory preserves latest lifecycle transitions, recent alerts, future-start alerts, and archives old bloat", async () => {
      assert.equal(C.REMINDER_HISTORY_ARCHIVE_FILE, "reminder-history.archive.jsonl");
      assert.equal(C.REMINDER_HISTORY_RETENTION_DEFAULT, 30);
      assert.equal(typeof C.cleanReminderHistoryRetentionDays, "function");
      assert.equal(typeof C.compactReminderHistory, "function");
      assert.equal(typeof C.formatHistoryArchiveLines, "function");
      assert.equal(typeof C.parseHistoryArchiveLines, "function");

      assert.equal(C.cleanReminderHistoryRetentionDays(undefined), 30);
      assert.equal(C.cleanReminderHistoryRetentionDays(0), 1);
      assert.equal(C.cleanReminderHistoryRetentionDays(99999), 3650);
      assert.equal(C.cleanReminderHistoryRetentionDays(14), 14);

      const oldAt = NOW - 120 * DAY;
      const recentAt = NOW - 5 * DAY;
      const records = [
        // Old occurrence with superseded transitions -> keep ONLY latest ("done"), archive earlier 2
        { id: "old-t1", seq: 1, itemId: "a", occurrenceId: "a@1", action: "done", stage: "", at: oldAt, start: null },
        { id: "old-t2", seq: 2, itemId: "a", occurrenceId: "a@1", action: "reopened", stage: "", at: oldAt + 1000, start: null },
        { id: "old-t3", seq: 3, itemId: "a", occurrenceId: "a@1", action: "done", stage: "", at: oldAt + 2000, start: null },
        // Old occurrence with equal-timestamp seq tie-breaker -> keep higher seq ("reopened")
        { id: "eq-1", seq: 4, itemId: "b", occurrenceId: "b@1", action: "done", stage: "", at: oldAt, start: null },
        { id: "eq-2", seq: 5, itemId: "b", occurrenceId: "b@1", action: "reopened", stage: "", at: oldAt, start: null },
        // Old alerted & snoozed -> archived
        { id: "old-al", seq: 6, itemId: "c", occurrenceId: "c@1", action: "alerted", stage: "due", at: oldAt, start: { dateTime: new Date(oldAt).toISOString() } },
        { id: "old-sk", seq: 7, itemId: "c", occurrenceId: "c@1", action: "skipped", stage: "pre", at: oldAt, start: { dateTime: new Date(oldAt).toISOString() } },
        { id: "old-sn", seq: 8, itemId: "c", occurrenceId: "c@1", action: "snoozed", stage: "", at: oldAt, start: null },
        // Old alerted whose scheduled start is recent/future -> KEPT so pre-alert dedup is never lost!
        { id: "future-pre", seq: 9, itemId: "d", occurrenceId: "d@1", action: "alerted", stage: "pre", at: oldAt, start: { dateTime: new Date(NOW + 2 * DAY).toISOString() } },
        // Recent alerted, snoozed, and multiple recent transitions -> ALL KEPT
        { id: "rec-al", seq: 10, itemId: "e", occurrenceId: "e@1", action: "alerted", stage: "due", at: recentAt, start: { dateTime: new Date(recentAt).toISOString() } },
        { id: "rec-sn", seq: 11, itemId: "e", occurrenceId: "e@1", action: "snoozed", stage: "", at: recentAt + 100, start: null },
        { id: "rec-t1", seq: 12, itemId: "e", occurrenceId: "e@1", action: "dismissed", stage: "", at: recentAt + 200, start: null },
        { id: "rec-t2", seq: 13, itemId: "e", occurrenceId: "e@1", action: "reopened", stage: "", at: recentAt + 300, start: null },
      ];

      const { kept, archived } = C.compactReminderHistory(records, NOW, { retentionDays: 30 });
      assert.deepEqual(kept.map((r) => r.id), ["old-t3", "eq-2", "future-pre", "rec-al", "rec-sn", "rec-t1", "rec-t2"]);
      assert.deepEqual(archived.map((r) => r.id), ["old-t1", "old-t2", "eq-1", "old-al", "old-sk", "old-sn"]);
      assert.equal(kept.length + archived.length, records.length);

      // JSONL round-trip + malformed-line resilience
      const jsonl = C.formatHistoryArchiveLines(archived);
      assert.ok(jsonl.endsWith("\n"));
      const parsed = C.parseHistoryArchiveLines(jsonl + "{corrupt-line\n\n");
      assert.equal(parsed.records.length, archived.length);
      assert.equal(parsed.malformed, 1);
      assert.deepEqual(parsed.records.map((r) => r.id), archived.map((r) => r.id));
    });

    await test("2. Store compacts on open(), writes archive.jsonl first, preserves stateFor, and is idempotent across reloads", async () => {
      const initialRecords = makeYearWorkload(500, NOW);
      const mem = makeMemoryIO([["/n/reminder-history.json", JSON.stringify({ v: 1, records: initialRecords })]]);
      const events = [];
      const store = C.createReminderHistoryStore({
        io: mem.io, getDir: () => "/n", now: () => NOW, setTimer: () => 1, clearTimer() {},
        getRetentionDays: () => 30,
      });
      store.on((ev) => events.push(ev));

      // Compute ground-truth stateFor before compaction on raw records
      const expectedStates = new Map();
      for (const r of initialRecords) {
        if (["done", "dismissed", "reopened"].includes(r.action)) {
          const key = r.itemId + "\0" + r.occurrenceId;
          const prev = expectedStates.get(key);
          if (!prev || r.at > prev.at || (r.at === prev.at && r.seq > prev.seq)) expectedStates.set(key, r);
        }
      }

      const st = await store.open();
      assert.equal(st.state, "ready");
      assert.ok(st.archivedCount > 300, `expected >300 archived records, got ${st.archivedCount}`);
      assert.ok(mem.files.has("/n/reminder-history.archive.jsonl"), "archive jsonl written");
      assert.ok(events.some((ev) => ev.kind === "compact" && ev.archived === st.archivedCount));

      // Verify archive was written BEFORE compacted reminder-history.json!
      const archiveWriteIdx = mem.writes.findIndex((w) => w.path.endsWith("reminder-history.archive.jsonl"));
      const mainWriteIdx = mem.writes.findIndex((w) => w.path.endsWith("reminder-history.json"));
      assert.ok(archiveWriteIdx >= 0 && mainWriteIdx > archiveWriteIdx, "archive must be written durably before shrinking main history");

      // Every single occurrence's stateFor matches ground truth!
      for (const [key, rec] of expectedStates) {
        const [itemId, occId] = key.split("\0");
        assert.equal(store.stateFor(itemId, occId), C.reminderStateAfter(rec.action));
      }

      // Total conservation: active + archived === original
      const activeDisk = JSON.parse(mem.files.get("/n/reminder-history.json")).records;
      const archivedDisk = C.parseHistoryArchiveLines(mem.files.get("/n/reminder-history.archive.jsonl")).records;
      assert.equal(activeDisk.length + archivedDisk.length, initialRecords.length);

      // Re-opening is idempotent: zero writes & zero duplicate archive lines
      const writesBeforeReopen = mem.writes.length;
      const store2 = C.createReminderHistoryStore({
        io: mem.io, getDir: () => "/n", now: () => NOW, setTimer: () => 1, clearTimer() {},
        getRetentionDays: () => 30,
      });
      await store2.open();
      assert.equal(mem.writes.length, writesBeforeReopen, "re-open on already compacted history performs zero writes");
      assert.equal(C.parseHistoryArchiveLines(mem.files.get("/n/reminder-history.archive.jsonl")).records.length, archivedDisk.length);

      // Tightening retentionDays to 7 and calling explicit compact() appends ONLY newly archived records without duplicating earlier lines
      let retention = 7;
      const store3 = C.createReminderHistoryStore({
        io: mem.io, getDir: () => "/n", now: () => NOW, setTimer: () => 1, clearTimer() {},
        getRetentionDays: () => retention,
      });
      await store3.open();
      const archivedAfter7 = C.parseHistoryArchiveLines(mem.files.get("/n/reminder-history.archive.jsonl")).records;
      const activeAfter7 = JSON.parse(mem.files.get("/n/reminder-history.json")).records;
      assert.equal(activeAfter7.length + archivedAfter7.length, initialRecords.length);
      assert.equal(new Set(archivedAfter7.map((r) => r.id)).size, archivedAfter7.length, "no duplicate ids in archive");

      // Explicit compact() after advancing clock archives aged records safely
      let clock = NOW + 60 * DAY;
      const store4 = C.createReminderHistoryStore({
        io: mem.io, getDir: () => "/n", now: () => clock, setTimer: () => 1, clearTimer() {},
        getRetentionDays: () => 7,
      });
      await store4.open();
      const compactRes = await store4.compact();
      assert.equal(compactRes.archived, 0, "already compacted at new clock on open()");
      clock += 30 * DAY;
      store4.append({ itemId: "fresh-old", occurrenceId: "fresh-old@1", action: "alerted", stage: "due", at: clock - 15 * DAY, start: { dateTime: new Date(clock - 15 * DAY).toISOString() } });
      await store4.flush();
      const compactRes2 = await store4.compact();
      assert.equal(compactRes2.archived, 1);
    });

    await test("3. Crash safety: archive write failure or concurrent edit aborts compaction with zero data loss", async () => {
      const initialRecords = makeYearWorkload(100, NOW);
      const rawJson = JSON.stringify({ v: 1, records: initialRecords });

      // Case A: archive write throws -> main file MUST remain untouched, all records loaded!
      const memA = makeMemoryIO([["/n/reminder-history.json", rawJson]]);
      memA.setFailPath("reminder-history.archive.jsonl");
      const storeA = C.createReminderHistoryStore({
        io: memA.io, getDir: () => "/n", now: () => NOW, setTimer: () => 1, clearTimer() {}, warn() {},
      });
      const stA = await storeA.open();
      assert.equal(stA.state, "ready");
      assert.equal(memA.files.get("/n/reminder-history.json"), rawJson, "main history untouched when archive write fails");
      assert.equal(storeA.storageState().count, initialRecords.length, "all records preserved in memory");

      // Case B: main file changes concurrently while archive is being written -> compaction aborts!
      const memB = makeMemoryIO([["/n/reminder-history.json", rawJson]]);
      const origWrite = memB.io.writeUTF8;
      let mutated = false;
      memB.io.writeUTF8 = async (p, text) => {
        await origWrite(p, text);
        if (!mutated && p.endsWith("reminder-history.archive.jsonl")) {
          mutated = true;
          memB.files.set("/n/reminder-history.json", JSON.stringify({
            v: 1,
            records: [...initialRecords, { id: "remote-concurrent", seq: 9999, itemId: "rem-x", occurrenceId: "rem-x", action: "done", stage: "", at: NOW, start: null }],
          }));
        }
      };
      const storeB = C.createReminderHistoryStore({
        io: memB.io, getDir: () => "/n", now: () => NOW, setTimer: () => 1, clearTimer() {}, warn() {},
      });
      await storeB.open();
      const diskAfterB = JSON.parse(memB.files.get("/n/reminder-history.json")).records;
      assert.ok(diskAfterB.some((r) => r.id === "remote-concurrent"), "concurrent remote write never clobbered by compaction");
    });

    await test("4. Multi-window coordination stays exact with lastDiskText fast-path", async () => {
      const mem = makeMemoryIO();
      const lock = C.createHistoryCoordinator(new Map());
      const mk = () => C.createReminderHistoryStore({ io: mem.io, getDir: () => "/n", now: () => NOW, setTimer: () => 1, clearTimer() {}, withHistoryLock: lock });
      const winA = mk(), winB = mk();
      await winA.open();
      await winB.open();

      const c1 = await winA.claimAlert({ itemId: "shared-1", occurrenceId: "shared-1", stage: "due", start: { dateTime: new Date(NOW).toISOString() }, at: NOW });
      assert.ok(c1);
      // Window B must see Window A's write on disk even though Window B had empty lastDiskText
      const c2 = await winB.claimAlert({ itemId: "shared-1", occurrenceId: "shared-1", stage: "due", start: { dateTime: new Date(NOW).toISOString() }, at: NOW + 1 });
      assert.equal(c2, null, "Window B sees Window A claim");

      // Window B marks shared-2 done -> Window A must see it despite Window A having cached its own prior write!
      winB.append({ itemId: "shared-2", occurrenceId: "shared-2", action: "done", at: NOW + 2 });
      await winB.flush();
      const c3 = await winA.claimAlert({ itemId: "shared-2", occurrenceId: "shared-2", stage: "due", start: { dateTime: new Date(NOW).toISOString() }, at: NOW + 3, requirePending: true });
      assert.equal(c3, null, "Window A detects remote change on disk and honours remote Done");
    });

    await test("5. Size & production-shape performance budget: 5,000 and 20,000 records across 1 year", async () => {
      for (const n of [5000, 20000]) {
        const records = makeYearWorkload(n, NOW);
        const rawJson = JSON.stringify({ v: 1, records });
        const beforeBytes = Buffer.byteLength(rawJson, "utf8");
        const mem = makeMemoryIO([["/n/reminder-history.json", rawJson]]);
        const store = C.createReminderHistoryStore({
          io: mem.io, getDir: () => "/n", now: () => NOW, setTimer: () => 1, clearTimer() {},
          getRetentionDays: () => 30,
        });

        const tOpen0 = performance.now();
        await store.open();
        const openMs = performance.now() - tOpen0;

        const afterBytes = Buffer.byteLength(mem.files.get("/n/reminder-history.json"), "utf8");
        const ratio = afterBytes / beforeBytes;
        assert.ok(ratio < 0.35, `expected >=65% size reduction for ${n} records, got ${(ratio * 100).toFixed(1)}%`);

        const tClaim0 = performance.now();
        for (let k = 0; k < 5; k++) {
          const claimed = await store.claimAlert({
            itemId: `new-${n}-${k}`, occurrenceId: `new-${n}-${k}`, stage: "due",
            start: { dateTime: new Date(NOW + k * 1000).toISOString() }, at: NOW + k,
          });
          assert.ok(claimed);
        }
        const claimMs = (performance.now() - tClaim0) / 5;
        const claimCeiling = scaleBudget(n === 5000 ? 40 : 120);
        console.log(`  ST7.2 (n=${n}): ${(beforeBytes / 1024).toFixed(1)} KB -> ${(afterBytes / 1024).toFixed(1)} KB (${((1 - ratio) * 100).toFixed(1)}% smaller), open=${openMs.toFixed(1)} ms, claimAlert=${claimMs.toFixed(2)} ms/call (ceiling ${claimCeiling.toFixed(1)} ms)`);
        assert.ok(claimMs < claimCeiling, `claimAlert too slow for n=${n}: ${claimMs.toFixed(2)} ms`);
      }
    });

    await test("6. Live fake-Zen host wires reminder_history_days pref to history compaction", async () => {
      const records = makeYearWorkload(150, Date.now());
      const files = new Map([["/profile/zentral-notes/reminder-history.json", JSON.stringify({ v: 1, records })]]);
      const host = createFakeZen({
        files,
        prefs: { "zen.workspace.zentral.notes.reminder_history_days": 14 },
      });
      await host.seam.ensureStore();
      assert.ok(files.has("/profile/zentral-notes/reminder-history.archive.jsonl"), "host open() compacted history using reminder_history_days pref");
      const active = JSON.parse(files.get("/profile/zentral-notes/reminder-history.json")).records;
      const archived = C.parseHistoryArchiveLines(files.get("/profile/zentral-notes/reminder-history.archive.jsonl")).records;
      assert.equal(active.length + archived.length, records.length);
      assert.ok(archived.length > 90, "14-day retention archived older alerts/snoozes");
      assert.equal(typeof host.seam.store.items.history.compact, "function", "historyFacade exposes compact()");
      await host.destroy();
    });

    await test("7. Full ZIP backup and restore preserves compacted reminder-history.archive.jsonl with deduplication", async () => {
      const records = makeYearWorkload(120, Date.now());
      const srcFiles = new Map([["/profile/zentral-notes/reminder-history.json", JSON.stringify({ v: 1, records })]]);
      const srcHost = createFakeZen({
        files: srcFiles,
        prefs: { "zen.workspace.zentral.notes.reminder_history_days": 14 },
      });
      await srcHost.seam.ensureStore();
      const archivedBefore = C.parseHistoryArchiveLines(srcFiles.get("/profile/zentral-notes/reminder-history.archive.jsonl")).records;
      assert.ok(archivedBefore.length > 60);
      const backup = await srcHost.seam.store.buildBackupArchive();
      assert.ok(backup.entries.some((e) => e.path === "reminder-history.archive.jsonl"), "ZIP backup includes archive jsonl");

      const dstFiles = new Map();
      const dstHost = createFakeZen({ files: dstFiles });
      await dstHost.seam.ensureStore();
      const restored = await dstHost.seam.store.restoreBackupArchive(backup.entries, { mode: "merge" });
      assert.equal(restored.ok, true);
      const restoredArchive = C.parseHistoryArchiveLines(dstFiles.get("/profile/zentral-notes/reminder-history.archive.jsonl")).records;
      assert.equal(restoredArchive.length, archivedBefore.length, "restored archive has exact archived records");
      // Restoring a second time deduplicates archive lines cleanly!
      await dstHost.seam.store.restoreBackupArchive(backup.entries, { mode: "merge" });
      const afterSecondRestore = C.parseHistoryArchiveLines(dstFiles.get("/profile/zentral-notes/reminder-history.archive.jsonl")).records;
      assert.equal(afterSecondRestore.length, archivedBefore.length, "repeated restore does not duplicate archive lines");
      await srcHost.destroy();
      await dstHost.destroy();
    });

    console.log(`PASS notes-history-compaction (${passed} tests)`);
  } catch (error) {
    console.error("FAIL notes-history-compaction\n", error);
    process.exitCode = 1;
  }
})();
