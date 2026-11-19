"use strict";

// OW-29: Retyping a date or time in a calendar line moves the stored item,
// while unrelated text edits preserve calendar moves, with LWW conflict resolution,
// recurring support, DST wall-clock correctness, marker preservation, and two-window sync.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const cal = require(path.join(ROOT, "additional", "notes", "calendar", "ZentralNotesCalendar.js"));
const NOTES_SRC = fs.readFileSync(path.join(ROOT, "additional", "notes", "ZentralNotes.uc.js"), "utf8");

function loadNotesCore() {
  const win = {
    document: { documentElement: { style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, removeAttribute() {}, hasAttribute: () => false } },
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    __zentralNotesParts: { "notes-calendar": cal },
    addEventListener() {}, removeEventListener() {},
    setTimeout, clearTimeout,
  };
  win.window = win;
  vm.runInNewContext(NOTES_SRC, {
    window: win, document: win.document, Event: function () {}, globalThis: { Services: {} }, ChromeUtils: {},
    console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set,
    setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array, TextEncoder, TextDecoder, queueMicrotask,
  });
  return win.__zentralNotesTestSeam.core;
}

function makeSharedDisk() {
  const files = new Map();
  const dirs = new Set(["/n", "/n/backup"]);
  const join = (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
  const parentOf = (p) => { const i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : "/"; };
  const io = {
    join,
    filename: (p) => p.split("/").pop(),
    exists: async (p) => dirs.has(p) || files.has(p),
    makeDir: async (p) => { let cur = ""; for (const s of p.split("/").filter(Boolean)) { cur += "/" + s; dirs.add(cur); } },
    children: async (p) => {
      const prefix = p.endsWith("/") ? p : p + "/";
      const out = [];
      for (const k of files.keys()) {
        if (k.startsWith(prefix) && !k.slice(prefix.length).includes("/")) out.push(k);
      }
      return out;
    },
    stat: async (p) => {
      if (dirs.has(p)) return { type: "directory", size: 0, lastModified: Date.now() };
      if (files.has(p)) return { type: "regular", size: files.get(p).length, lastModified: Date.now() };
      throw new Error("ENOENT: " + p);
    },
    read: async (p) => files.get(p),
    readUTF8: async (p) => { if (!files.has(p)) throw new Error("ENOENT: " + p); return files.get(p); },
    write: async (p, text) => { dirs.add(parentOf(p)); files.set(p, String(text)); },
    writeUTF8: async (p, text) => { dirs.add(parentOf(p)); files.set(p, String(text)); },
    remove: async (p) => { files.delete(p); },
    copy: async (a, b) => { if (files.has(a)) { dirs.add(parentOf(b)); files.set(b, files.get(a)); } },
    restrict: async () => {},
  };
  return { io, files };
}

function makeItemStore(io, getNow) {
  return cal.createItemStore({
    io,
    getDir: () => "/n",
    now: getNow,
    setTimer: (fn) => setTimeout(fn, 0),
    clearTimer: (id) => clearTimeout(id),
  });
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("pure: lineScheduleSignature, cleanTextSchedule, and DST-safe scheduleFromParsedLine", () => {
    assert.equal(typeof cal.lineScheduleSignature, "function", "lineScheduleSignature exported");
    assert.equal(typeof cal.cleanTextSchedule, "function", "cleanTextSchedule exported");
    assert.equal(typeof cal.scheduleFromParsedLine, "function", "scheduleFromParsedLine exported");
    assert.equal(typeof cal.reconcileListItem, "function", "reconcileListItem exported");

    const dayMs = new Date(2026, 2, 29).getTime(); // 2026-03-29 (Europe/Warsaw spring forward!)
    const sig = cal.lineScheduleSignature({ day: dayMs, startMin: 9 * 60, endMin: 10 * 60 + 30, yearless: false });
    assert.equal(sig, "2026-03-29|540|630|0");
    assert.equal(cal.cleanTextSchedule(sig), sig);
    assert.equal(cal.cleanTextSchedule("bad"), "");

    // Europe/Warsaw spring forward (2026-03-29): 09:00-10:30 MUST be 09:00-10:30 CEST (+02:00), NOT shifted to 10:00!
    const springWaw = cal.scheduleFromParsedLine({ day: dayMs, startMin: 540, endMin: 630, yearless: false }, { tz: "Europe/Warsaw" });
    assert.equal(cal.clockIn(Date.parse(springWaw.start.dateTime), "Europe/Warsaw"), "09:00");
    assert.equal(cal.clockIn(Date.parse(springWaw.end.dateTime), "Europe/Warsaw"), "10:30");
    assert.equal(springWaw.kind, "event");

    // Europe/Warsaw fall back (2026-10-25): 09:00-10:30 MUST be 09:00-10:30 CET (+01:00), NOT shifted to 08:00!
    const fallDayMs = new Date(2026, 9, 25).getTime();
    const fallWaw = cal.scheduleFromParsedLine({ day: fallDayMs, startMin: 540, endMin: 630, yearless: false }, { tz: "Europe/Warsaw" });
    assert.equal(cal.clockIn(Date.parse(fallWaw.start.dateTime), "Europe/Warsaw"), "09:00");
    assert.equal(cal.clockIn(Date.parse(fallWaw.end.dateTime), "Europe/Warsaw"), "10:30");

    // America/New_York spring forward (2026-03-08) & fall back (2026-11-01)
    const nySpring = cal.scheduleFromParsedLine({ day: new Date(2026, 2, 8).getTime(), startMin: 570, endMin: -1, yearless: false }, { tz: "America/New_York" });
    assert.equal(cal.clockIn(Date.parse(nySpring.start.dateTime), "America/New_York"), "09:30");
    assert.equal(nySpring.kind, "reminder");
    const nyFall = cal.scheduleFromParsedLine({ day: new Date(2026, 10, 1).getTime(), startMin: 570, endMin: 630, yearless: false }, { tz: "America/New_York" });
    assert.equal(cal.clockIn(Date.parse(nyFall.start.dateTime), "America/New_York"), "09:30");
    assert.equal(cal.clockIn(Date.parse(nyFall.end.dateTime), "America/New_York"), "10:30");
  });

  await test("text edit with hidden %%zn-item-id%% moves stored item across time, date, event/reminder, and all-day while preserving markers & extras", async () => {
    const { io } = makeSharedDisk();
    let clock = Date.parse("2026-11-16T08:00:00.000Z");
    const st = makeItemStore(io, () => clock);
    await st.open();

    const raw = "## Plan\n%%calendar: Work%%\n- [ ] 2026-11-20 09:00 Dentist %%zn-item-category:Health%% <!-- r-id: 11111111-2222-3333-4444-555555555555 -->\n";
    const ensured = st.ensureNoteIds("n1", raw);
    assert.ok(ensured.changed);
    const idMatch = /%%zn-item-id:([a-z0-9_-]+)%%/i.exec(ensured.body);
    assert.ok(idMatch, "hidden zn-item-id inserted");
    assert.ok(ensured.body.includes("%%zn-item-category:Health%%"), "category marker kept");
    assert.ok(ensured.body.includes("<!-- r-id: 11111111-2222-3333-4444-555555555555 -->"), "r-id comment kept");

    st.syncNote("n1", ensured.body, { sourceEdit: true, updatedAt: clock });
    const [orig] = st.list({ noteId: "n1" });
    assert.ok(orig);
    assert.equal(orig.x.kind, "reminder");
    assert.equal(cal.clockIn(cal.itemRange(orig)[0]), "09:00");
    assert.equal(orig.x.textSchedule, "2026-11-20|540|-1|0");

    // Add calendar extras
    clock += 1000;
    st.upsert({ ...orig, x: { ...orig.x, calNote: "Bring x-ray", historyId: "hist-1" } });

    // 1. Retype time: 09:00 -> 11:30
    clock += 1000;
    const bodyTime = ensured.body.replace("2026-11-20 09:00", "2026-11-20 11:30");
    assert.equal(st.syncNote("n1", bodyTime, { sourceEdit: true, updatedAt: clock }), true);
    const afterTime = st.get(orig.id);
    assert.equal(afterTime.id, orig.id, "same item ID");
    assert.equal(cal.localDateKey(cal.itemRange(afterTime)[0]), "2026-11-20");
    assert.equal(cal.clockIn(cal.itemRange(afterTime)[0]), "11:30", "time moved to 11:30");
    assert.equal(afterTime.x.calNote, "Bring x-ray", "extras preserved");
    assert.equal(afterTime.x.historyId, "hist-1", "historyId preserved");
    assert.equal(afterTime.x.category, "Health", "category marker preserved");

    // 2. Retype date & add end time (reminder -> event): 2026-11-20 11:30 -> 2026-11-25 14:00-15:15
    clock += 1000;
    const bodyEvent = bodyTime.replace("2026-11-20 11:30", "2026-11-25 14:00-15:15");
    assert.equal(st.syncNote("n1", bodyEvent, { sourceEdit: true, updatedAt: clock }), true);
    const afterEvent = st.get(orig.id);
    assert.equal(afterEvent.x.kind, "event", "converted to event");
    assert.equal(cal.localDateKey(cal.itemRange(afterEvent)[0]), "2026-11-25");
    assert.equal(cal.clockIn(cal.itemRange(afterEvent)[0]), "14:00");
    assert.equal(cal.clockIn(cal.itemRange(afterEvent)[1]), "15:15");

    // 3. Remove time range (timed event -> all-day reminder): 2026-11-25 14:00-15:15 -> 2026-11-28
    clock += 1000;
    const bodyAllDay = bodyEvent.replace("2026-11-25 14:00-15:15", "2026-11-28");
    assert.equal(st.syncNote("n1", bodyAllDay, { sourceEdit: true, updatedAt: clock }), true);
    const afterAllDay = st.get(orig.id);
    assert.equal(afterAllDay.start.date, "2026-11-28");
    assert.equal(afterAllDay.end, undefined);
    assert.equal(afterAllDay.x.kind, "reminder");
    assert.equal(afterAllDay.x.calNote, "Bring x-ray");
  });

  await test("calendar move survives an unrelated text edit, then a subsequent retype of date/time moves the item", async () => {
    const { io } = makeSharedDisk();
    let clock = Date.parse("2026-11-16T08:00:00.000Z");
    const st = makeItemStore(io, () => clock);
    await st.open();

    const body0 = "## Tasks\n%%calendar%%\n- [ ] 2026-11-20 09:00 Call Alice %%zn-item-id:aaa111%%\n";
    st.syncNote("n1", body0, { sourceEdit: true, updatedAt: clock });
    const item0 = st.list({ noteId: "n1" })[0];

    // Calendar UI moves item from 09:00 to 16:30 WITHOUT rewriting the note line
    clock += 2000;
    const targetMs = new Date(2026, 10, 20, 16, 30).getTime();
    const moved = st.upsert({
      ...item0,
      start: { dateTime: new Date(targetMs).toISOString() },
      x: { ...item0.x, moved: "1", calNote: "moved on grid" },
      updated: new Date(clock).toISOString(),
    });
    assert.equal(cal.clockIn(cal.itemRange(moved)[0]), "16:30");

    // Unrelated text edit: title change + extra paragraph (09:00 in note text is untouched!)
    clock += 2000;
    const bodyUnrelated = body0.replace("Call Alice", "Call Alice about budget") + "\nExtra note paragraph\n";
    st.syncNote("n1", bodyUnrelated, { sourceEdit: true, updatedAt: clock });
    const afterUnrelated = st.get(item0.id);
    assert.equal(afterUnrelated.summary, "Call Alice about budget", "summary updated");
    assert.equal(cal.clockIn(cal.itemRange(afterUnrelated)[0]), "16:30", "calendar move survived unrelated edit");
    assert.equal(afterUnrelated.x.moved, "1");
    assert.equal(afterUnrelated.x.calNote, "moved on grid");

    // Now the user explicitly retypes the time in the note text: 09:00 -> 18:15
    clock += 2000;
    const bodyRetyped = bodyUnrelated.replace("2026-11-20 09:00", "2026-11-20 18:15");
    st.syncNote("n1", bodyRetyped, { sourceEdit: true, updatedAt: clock });
    const afterRetyped = st.get(item0.id);
    assert.equal(cal.clockIn(cal.itemRange(afterRetyped)[0]), "18:15", "retyped time moved the item");
    assert.equal(afterRetyped.x.moved, "", "moved flag cleared once text became authoritative again");
    assert.equal(afterRetyped.x.calNote, "moved on grid");
  });

  await test("recurring items & explicit DST zone survive unrelated edits and move cleanly when retyped", async () => {
    const { io } = makeSharedDisk();
    let clock = Date.parse("2026-03-01T08:00:00.000Z");
    const st = makeItemStore(io, () => clock);
    await st.open();

    // Yearless recurring birthday
    const bdayBody = "## Birthdays\n%%calendar: Birthdays%%\n- 15.05. Mom %%zn-item-id:bday01%%\n";
    st.syncNote("nb", bdayBody, { sourceEdit: true, updatedAt: clock });
    const bday0 = st.list({ noteId: "nb" })[0];
    assert.deepEqual(bday0.recurrence, ["RRULE:FREQ=YEARLY"]);

    clock += 1000;
    st.syncNote("nb", bdayBody.replace("15.05.", "16.05."), { sourceEdit: true, updatedAt: clock });
    const bday1 = st.get(bday0.id);
    assert.ok(bday1.start.date.endsWith("-05-16"), "yearless recurring date moved to 05-16");
    assert.deepEqual(bday1.recurrence, ["RRULE:FREQ=YEARLY"], "yearly recurrence preserved");

    // Weekly recurring item in Europe/Warsaw with a calendar 'series' shift + a 'this' cancellation
    const weeklyBody = "## Meetings\n%%calendar%%\n- [ ] 2026-03-22 09:00-10:00 Standup %%zn-item-id:wk0001%%\n";
    st.syncNote("nw", weeklyBody, { sourceEdit: true, updatedAt: clock });
    const wk0 = st.list({ noteId: "nw" })[0];
    clock += 1000;
    const startWaw = cal.zonedDateTimeToMs("2026-03-22", "09:00", "Europe/Warsaw");
    const endWaw = cal.zonedDateTimeToMs("2026-03-22", "10:00", "Europe/Warsaw");
    const wkRec = st.upsert({
      ...wk0,
      start: { dateTime: new Date(startWaw).toISOString() },
      end: { dateTime: new Date(endWaw).toISOString() },
      recurrence: ["RRULE:FREQ=WEEKLY"],
      x: {
        ...wk0.x,
        tz: "Europe/Warsaw",
        moved: "1",
        recurrenceExceptions: [
          { recurrenceId: { dateTime: new Date(startWaw).toISOString() }, scope: "series", shiftMs: 60 * 60000 },
          { recurrenceId: { dateTime: new Date(cal.zonedDateTimeToMs("2026-04-05", "09:00", "Europe/Warsaw")).toISOString() }, scope: "this", cancelled: true },
        ],
      },
      updated: new Date(clock).toISOString(),
    });
    assert.equal(wkRec.x.recurrenceExceptions.length, 2);

    // Unrelated edit keeps series shift + cancelled occurrence + tz
    clock += 1000;
    const wkRenamed = weeklyBody.replace("Standup", "Weekly Standup");
    st.syncNote("nw", wkRenamed, { sourceEdit: true, updatedAt: clock });
    const wkAfterRename = st.get(wk0.id);
    assert.equal(wkAfterRename.summary, "Weekly Standup");
    assert.equal(wkAfterRename.x.recurrenceExceptions.length, 2, "series shift survived unrelated edit");

    // Retype onto Europe/Warsaw spring-forward DST day (2026-03-29 11:00-12:00):
    // must move master to 11:00-12:00 CEST, drop stale 'series' shift, keep 'this' cancel & RRULE:FREQ=WEEKLY!
    clock += 1000;
    const wkDst = wkRenamed.replace("2026-03-22 09:00-10:00", "2026-03-29 11:00-12:00");
    st.syncNote("nw", wkDst, { sourceEdit: true, updatedAt: clock });
    const wkAfterDst = st.get(wk0.id);
    assert.equal(cal.clockIn(Date.parse(wkAfterDst.start.dateTime), "Europe/Warsaw"), "11:00", "DST spring-forward wall clock exact");
    assert.equal(cal.clockIn(Date.parse(wkAfterDst.end.dateTime), "Europe/Warsaw"), "12:00", "DST spring-forward end clock exact");
    assert.deepEqual(wkAfterDst.recurrence, ["RRULE:FREQ=WEEKLY"], "weekly RRULE preserved");
    assert.ok(!wkAfterDst.x.recurrenceExceptions.some((e) => e.scope === "series"), "stale series shift cleared after master retype");
    assert.ok(wkAfterDst.x.recurrenceExceptions.some((e) => e.scope === "this" && e.cancelled), "individual cancellation kept");

    // Verify expanded occurrences on DST day + next 2 weeks all land on exact 11:00 Europe/Warsaw (zero +1h series shift or DST drift!)
    const occs = cal.expandRange([wkAfterDst], cal.zonedDateTimeToMs("2026-03-28", "00:00", "Europe/Warsaw"), cal.zonedDateTimeToMs("2026-04-14", "00:00", "Europe/Warsaw"));
    assert.equal(occs.length, 3, "Mar 29 + Apr 5 + Apr 12 at newly retyped 11:00 series");
    for (const occ of occs) {
      assert.equal(cal.clockIn(Date.parse(occ.start.dateTime), "Europe/Warsaw"), "11:00");
      assert.equal(cal.clockIn(Date.parse(occ.end.dateTime), "Europe/Warsaw"), "12:00");
    }

    // Also verify retyping onto Europe/Warsaw fall-back DST day (2026-10-25 09:00-10:00 CET)
    clock += 1000;
    const wkFall = wkDst.replace("2026-03-29 11:00-12:00", "2026-10-25 09:00-10:00");
    st.syncNote("nw", wkFall, { sourceEdit: true, updatedAt: clock });
    const wkAfterFall = st.get(wk0.id);
    assert.equal(cal.clockIn(Date.parse(wkAfterFall.start.dateTime), "Europe/Warsaw"), "09:00", "DST fall-back wall clock exact");
    assert.equal(cal.clockIn(Date.parse(wkAfterFall.end.dateTime), "Europe/Warsaw"), "10:00", "DST fall-back end clock exact");
  });

  await test("two windows & LWW conflict: newer calendar move beats older text edit; newer text edit beats older calendar move; syncItemScheduleToNote stays in sync", async () => {
    const core = loadNotesCore();
    const { io } = makeSharedDisk();
    let clockA = Date.parse("2026-11-16T10:00:00.000Z");
    let clockB = Date.parse("2026-11-16T10:00:00.000Z");
    const mkNoteStore = (winId, getNow) => core.createStore({
      io,
      getDir: async () => "/n",
      getMaxSaveMs: () => 5000,
      getHistory: () => ({ on: false, keep: 1, minutes: 1, capKB: 64, warnMB: 100 }),
      notify() {},
      windowId: winId,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      now: getNow,
      warn: () => {},
    });

    const storeA = mkNoteStore("win-A", () => clockA);
    const storeB = mkNoteStore("win-B", () => clockB);
    await storeA.open();
    const note = storeA.create("## Plan\n%%calendar%%\n- [ ] 2026-11-20 09:00 Review\n");
    await storeA.flush();
    await storeB.open();

    const itemA0 = storeA.items.list({ noteId: note.id })[0];
    assert.ok(itemA0);

    // Case 1: Window B retypes time to 11:00 at T+10s; Window A moves in calendar to 15:00 at T+20s (newer!).
    clockB += 10000;
    const bodyB = storeB.get(note.id).body.replace("2026-11-20 09:00", "2026-11-20 11:00");
    storeB.update(note.id, bodyB);
    await storeB.flush();

    clockA += 20000;
    const move15 = new Date(2026, 10, 20, 15, 0).getTime();
    storeA.items.upsert({
      ...itemA0,
      start: { dateTime: new Date(move15).toISOString() },
      x: { ...itemA0.x, moved: "1" },
      updated: new Date(clockA).toISOString(),
    });
    // Now Window A reloads the older note text from disk (T+10s < T+20s) -> calendar move (15:00) MUST win LWW!
    const remoteReload = async (stObj, id) => {
      stObj.onRemoteMessage(JSON.stringify({ origin: "other", id }));
      for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    };
    await remoteReload(storeA, note.id);
    const afterStaleReload = storeA.items.get(itemA0.id);
    assert.equal(cal.clockIn(cal.itemRange(afterStaleReload)[0]), "15:00", "newer calendar move beat stale disk text edit");
    assert.equal(afterStaleReload.x.textSchedule, "2026-11-20|660|-1|0", "baseline textSchedule synced to disk line so later unrelated edits do not pull back");

    // Subsequent unrelated title edit in Window A at T+30s MUST STILL keep 15:00!
    clockA += 10000;
    storeA.update(note.id, storeA.get(note.id).body.replace("Review", "Quarterly Review"));
    const afterTitleEdit = storeA.items.get(itemA0.id);
    assert.equal(afterTitleEdit.summary, "Quarterly Review");
    assert.equal(cal.clockIn(cal.itemRange(afterTitleEdit)[0]), "15:00", "15:00 move survived later unrelated edit");
    await storeA.flush();

    // Case 2: Window B reloads, then retypes time to 17:30 at T+40s (newer than T+30s!) -> text edit wins in Window A!
    await remoteReload(storeB, note.id);
    await storeB.items.refresh();
    clockB = clockA + 10000;
    storeB.update(note.id, storeB.get(note.id).body.replace("2026-11-20 11:00", "2026-11-20 17:30"));
    await storeB.flush();
    await remoteReload(storeA, note.id);
    const afterNewerText = storeA.items.get(itemA0.id);
    assert.equal(cal.clockIn(cal.itemRange(afterNewerText)[0]), "17:30", "newer cross-window text retype won LWW");

    // Case 3: syncItemScheduleToNote rewrites the line cleanly and keeps item & textSchedule aligned
    clockA = clockB + 10000;
    const move19 = new Date(2026, 10, 20, 19, 0).getTime();
    const movedCal = storeA.items.upsert({
      ...afterNewerText,
      start: { dateTime: new Date(move19).toISOString() },
      x: { ...afterNewerText.x, moved: "1" },
      updated: new Date(clockA).toISOString(),
    });
    assert.equal(storeA.syncItemScheduleToNote(movedCal), true);
    assert.ok(storeA.get(note.id).body.includes("2026-11-20 19:00"));
    assert.equal(cal.clockIn(cal.itemRange(storeA.items.get(itemA0.id))[0]), "19:00");
    assert.equal(storeA.items.get(itemA0.id).x.textSchedule, "2026-11-20|1140|-1|0");

    await storeA.close();
    await storeB.close();
  });

  console.log(`notes-ow29-retype-schedule: ${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
