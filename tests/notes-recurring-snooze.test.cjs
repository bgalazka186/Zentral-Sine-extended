"use strict";
/* T2.19: Quick snooze & custom snooze on recurring reminder occurrences, backed by
 * recurrenceExceptions + moveOccurrence + occurrence-scoped reminder history. */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const AGENDA_PREF = "zen.workspace.zentral.notes.agenda_folder";
const date = (days, hour = 9, min = 0) => C.addDays(C.dayStart(Date.now()), days) + hour * 3600000 + min * 60000;
const makeRecurring = (id, startMs, { allDay = false, rule = "RRULE:FREQ=DAILY;COUNT=5", tz = "" } = {}) => C.makeItem({
  id,
  summary: id,
  start: allDay ? { date: C.localDateKey(startMs) } : { dateTime: new Date(startMs).toISOString() },
  recurrence: [rule],
  x: { kind: "reminder", src: "manual", ...(tz ? { tz } : {}) },
}, Date.now());
const flat = (rows) => rows.flatMap((r) => (Array.isArray(r?.group) ? [r, ...r.group] : [r]));

async function flush(n = 8) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("pure: calendarItemMenuModel enables snooze for expanded recurring occurrences and blocks unexpanded masters or read-only history", () => {
    const timedMaster = makeRecurring("timed-rec", date(1, 9, 0));
    const timedOcc = C.expandItem(timedMaster, date(0, 0, 0), date(6, 23, 59))[0];
    assert.ok(timedOcc?.x?.series === "timed-rec" && timedOcc?.x?.recurrenceId);

    const occRows = flat(C.calendarItemMenuModel(timedOcc, { state: "pending", historyWritable: true, lang: "en" }));
    for (const cmd of ["snooze-1h", "snooze-1d", "snooze-3d", "snooze-monday", "snooze-custom"]) {
      assert.equal(occRows.find((r) => r.command === cmd)?.enabled, true, `timed occurrence enables ${cmd}`);
    }

    const masterRows = flat(C.calendarItemMenuModel(timedMaster, { state: "pending", historyWritable: true, lang: "en" }));
    for (const cmd of ["snooze-1h", "snooze-1d", "snooze-3d", "snooze-monday", "snooze-custom"]) {
      const row = masterRows.find((r) => r.command === cmd);
      assert.equal(row?.enabled, false, `unexpanded master disables ${cmd}`);
      assert.match(row.reason, /expanded recurrence occurrence/i);
    }

    const allDayMaster = makeRecurring("allday-rec", date(1, 0, 0), { allDay: true });
    const allDayOcc = C.expandItem(allDayMaster, date(0, 0, 0), date(6, 23, 59))[0];
    const allDayRows = flat(C.calendarItemMenuModel(allDayOcc, { state: "pending", historyWritable: true, lang: "en" }));
    assert.equal(allDayRows.find((r) => r.command === "snooze-1h")?.enabled, false, "all-day recurring disables +1h");
    for (const cmd of ["snooze-1d", "snooze-3d", "snooze-monday", "snooze-custom"]) {
      assert.equal(allDayRows.find((r) => r.command === cmd)?.enabled, true, `all-day recurring enables ${cmd}`);
    }

    const lockedRows = flat(C.calendarItemMenuModel(timedOcc, { state: "pending", historyWritable: false, lang: "en" }));
    for (const cmd of ["snooze-1h", "snooze-1d", "snooze-3d", "snooze-monday", "snooze-custom"]) {
      assert.equal(lockedRows.find((r) => r.command === cmd)?.enabled, false, `read-only history disables ${cmd}`);
    }
  });

  await test("headless: quick snooze (+1h, +1d, +3d, Monday), chained snooze, occurrence-scoped history, and safe Undo on recurring reminders", async () => {
    const h = createFakeZen({ prefs: { [AGENDA_PREF]: true } });
    try {
      await h.seam.ensureStore();
      const master = h.seam.store.items.upsert(makeRecurring("pills", date(1, 9, 0)));
      const occsBefore = C.expandItem(master, date(0, 0, 0), date(10, 23, 59));
      assert.equal(occsBefore.length, 5);
      const first = occsBefore[0], second = occsBefore[1];

      // Snooze first occurrence +1 day headlessly
      const r1 = h.seam.store.runAgendaCommand(first, "snooze-1d");
      assert.equal(r1.ok, true);
      const after1 = h.seam.store.items.get("pills");
      assert.equal(after1.x.recurrenceExceptions.length, 1);
      assert.equal(after1.x.recurrenceExceptions[0].scope, "this");
      const occs1 = C.expandItem(after1, date(0, 0, 0), date(10, 23, 59));
      const movedFirst = occs1.find((o) => o.x.recurrenceId === first.x.recurrenceId);
      const untouchedSecond = occs1.find((o) => o.x.recurrenceId === second.x.recurrenceId);
      assert.equal(C.localDateKey(C.itemRange(movedFirst)[0]), C.localDateKey(date(2, 9, 0)), "first occurrence shifted +1d");
      assert.equal(C.itemRange(untouchedSecond)[0], C.itemRange(second)[0], "sibling occurrence untouched");

      // Occurrence-scoped history recorded for first occurrence only
      const histEntries = h.seam.store.items.history.list({ itemId: "pills", occurrenceId: first.id });
      assert.ok(histEntries.some((e) => e.action === "snoozed" && e.occurrenceId === first.id), "occurrence-scoped snoozed history recorded");
      assert.equal(h.seam.store.items.history.list({ itemId: "pills", occurrenceId: second.id }).length, 0, "sibling occurrence history stays clean");

      // Chained snooze (+3d on already-moved first occurrence) updates the existing exception without duplicating
      const r2 = h.seam.store.runAgendaCommand(movedFirst, "snooze-3d");
      assert.equal(r2.ok, true);
      const after2 = h.seam.store.items.get("pills");
      assert.equal(after2.x.recurrenceExceptions.length, 1, "chained snooze replaces single exception rather than duplicating");
      const movedAgain = C.expandItem(after2, date(0, 0, 0), date(12, 23, 59)).find((o) => o.x.recurrenceId === first.x.recurrenceId);
      assert.equal(C.localDateKey(C.itemRange(movedAgain)[0]), C.localDateKey(date(5, 9, 0)), "chained snooze lands +3d after moved date");

      // Conflict check: r1.undo() must refuse because r2 changed rev/etag/head
      assert.equal(r1.undo().ok, false, "stale Undo blocked after subsequent edit");

      // Latest Undo (r2.undo()) cleanly restores the +1d state
      assert.equal(r2.undo().ok, true, "latest Undo succeeds");
      const restored = h.seam.store.items.get("pills");
      const restoredFirst = C.expandItem(restored, date(0, 0, 0), date(10, 23, 59)).find((o) => o.x.recurrenceId === first.x.recurrenceId);
      assert.equal(C.localDateKey(C.itemRange(restoredFirst)[0]), C.localDateKey(date(2, 9, 0)), "Undo restored prior moved date");

      // +1h and Monday on timed recurring occurrence
      const rHour = h.seam.store.runAgendaCommand(second, "snooze-1h");
      assert.equal(rHour.ok, true);
      const afterHour = C.expandItem(h.seam.store.items.get("pills"), date(0, 0, 0), date(10, 23, 59)).find((o) => o.x.recurrenceId === second.x.recurrenceId);
      assert.equal(C.itemRange(afterHour)[0], C.itemRange(second)[0] + 3600000, "+1h shifted second occurrence by 1 hour");
      assert.equal(rHour.undo().ok, true);

      const rMon = h.seam.store.runAgendaCommand(second, "snooze-monday");
      assert.equal(rMon.ok, true);
      const afterMon = C.expandItem(h.seam.store.items.get("pills"), date(0, 0, 0), date(20, 23, 59)).find((o) => o.x.recurrenceId === second.x.recurrenceId);
      assert.equal(new Date(C.itemRange(afterMon)[0]).getDay(), 1, "snooze-monday lands on Monday");

      // All-day recurring occurrence supports +1d & Undo, rejects +1h
      const adMaster = h.seam.store.items.upsert(makeRecurring("ad-rec", date(1, 0, 0), { allDay: true }));
      const adOcc = C.expandItem(adMaster, date(0, 0, 0), date(8, 23, 59))[0];
      assert.equal(h.seam.store.runAgendaCommand(adOcc, "snooze-1h").ok, false, "all-day recurring rejects +1h");
      const adRes = h.seam.store.runAgendaCommand(adOcc, "snooze-1d");
      assert.equal(adRes.ok, true);
      const adMoved = C.expandItem(h.seam.store.items.get("ad-rec"), date(0, 0, 0), date(8, 23, 59)).find((o) => o.x.recurrenceId === adOcc.x.recurrenceId);
      assert.equal(adMoved.start.date, C.localDateKey(date(2, 0, 0)));
      assert.equal(adRes.undo().ok, true);
      assert.equal(h.seam.store.items.get("ad-rec").x.recurrenceExceptions.length, 0);
    } finally {
      await h.destroy();
    }
  });

  await test("sheet UI: Custom snooze dialog offers recurrence scope chooser (this / following / series) and records occurrence-scoped history", async () => {
    const h = createFakeZen({ prefs: { [AGENDA_PREF]: true } });
    try {
      await h.seam.ensureStore();
      h.fireTimer(6500);
      await flush(4);
      const master = h.seam.store.items.upsert(makeRecurring("standup", date(1, 10, 0)));
      const occs = C.expandItem(master, date(0, 0, 0), date(10, 23, 59));
      const secondOcc = occs[1];
      h.seam.agendaController.runNow();

      const tabMenu = h.document.createXULElement("menupopup");
      tabMenu.id = "tabContextMenu";
      h.document.body.append(tabMenu);
      const openCustomSnoozeForOcc = async (targetOcc) => {
        const tabs = h.document.querySelectorAll('tab[bgalazka-notes-agenda-item-id="standup"]');
        const targetTab = tabs.find((tab) => tab.getAttribute("bgalazka-notes-agenda-day") === C.localDateKey(C.itemRange(targetOcc)[0]));
        assert.ok(targetTab, "Agenda sidebar tab for recurring occurrence exists");
        h.window.TabContextMenu = { contextTab: targetTab };
        h.emit("popupshowing", tabMenu);
        const snoozeMenu = tabMenu.querySelector('menu[zentral-agenda-own="snooze"]');
        assert.ok(snoozeMenu, "Snooze submenu present");
        const snoozeCustom = [...snoozeMenu.querySelectorAll("menuitem")].find((el) => /Custom date/i.test(el.getAttribute("label") || ""));
        assert.ok(snoozeCustom && !snoozeCustom.hasAttribute("disabled"), "Snooze -> Custom date and time… is enabled for recurring occurrence");
        snoozeCustom.dispatchEvent(new h.Ev("command", { bubbles: true }));
        h.emit("popuphidden", tabMenu);
        await flush(12);
      };

      // Trigger snooze-custom on the 2nd occurrence directly from the sidebar context menu
      await openCustomSnoozeForOcc(secondOcc);

      const card = h.document.querySelector(".zn-dialog-card");
      assert.ok(card, "Custom reminder snooze dialog opened");
      const scopeSelect = card.querySelector(".zn-cal-recurrence-scope select");
      assert.ok(scopeSelect, "Recurrence scope selector rendered in Custom snooze dialog");
      assert.equal(scopeSelect.value, "this", "Defaults to 'this' occurrence");
      const opts = [...scopeSelect.querySelectorAll("option")].map((o) => o.getAttribute("value") || o.value);
      assert.deepEqual(opts, ["this", "following", "series"]);

      // Choose "following" scope and move by +2 days
      scopeSelect.value = "following";
      const targetKey = C.localDateKey(date(4, 10, 0));
      const dateInput = card.querySelector(".zn-cal-snooze-date input");
      assert.ok(dateInput);
      dateInput.value = targetKey;
      dateInput.dispatchEvent(new h.Ev("input", { bubbles: true }));
      dateInput.dispatchEvent(new h.Ev("blur", { bubbles: true }));

      const submitBtn = [...card.querySelectorAll("button")].find((b) => /Snooze reminder/i.test(b.textContent));
      assert.ok(submitBtn);
      submitBtn.click();
      await flush(6);

      const updated = h.seam.store.items.get("standup");
      assert.equal(updated.x.recurrenceExceptions.length, 1);
      assert.equal(updated.x.recurrenceExceptions[0].scope, "following");
      const expanded = C.expandItem(updated, date(0, 0, 0), date(14, 23, 59));
      const firstAfter = expanded.find((o) => o.x.recurrenceId === occs[0].x.recurrenceId);
      const secondAfter = expanded.find((o) => o.x.recurrenceId === secondOcc.x.recurrenceId);
      const thirdAfter = expanded.find((o) => o.x.recurrenceId === occs[2].x.recurrenceId);
      assert.equal(C.localDateKey(C.itemRange(firstAfter)[0]), C.localDateKey(date(1, 10, 0)), "earlier occurrence untouched by 'following'");
      assert.equal(C.localDateKey(C.itemRange(secondAfter)[0]), targetKey, "selected occurrence shifted to target date");
      assert.equal(C.localDateKey(C.itemRange(thirdAfter)[0]), C.localDateKey(date(5, 10, 0)), "following occurrence shifted by same delta");

      const hist = h.seam.store.items.history.list({ itemId: "standup", occurrenceId: secondOcc.id });
      assert.ok(hist.some((e) => e.action === "snoozed" && e.occurrenceId === secondOcc.id), "occurrence-scoped snoozed history recorded for custom snooze");

      // Also test "series" scope via custom snooze on the 1st occurrence
      h.seam.agendaController.runNow();
      await openCustomSnoozeForOcc(firstAfter);
      const card2 = h.document.querySelector(".zn-dialog-card");
      assert.ok(card2, "Custom snooze dialog opened for 1st occurrence");
      const scope2 = card2.querySelector(".zn-cal-recurrence-scope select");
      scope2.value = "series";
      const dateInput2 = card2.querySelector(".zn-cal-snooze-date input");
      const seriesTarget = C.localDateKey(date(3, 10, 0));
      dateInput2.value = seriesTarget;
      dateInput2.dispatchEvent(new h.Ev("input", { bubbles: true }));
      dateInput2.dispatchEvent(new h.Ev("blur", { bubbles: true }));
      [...card2.querySelectorAll("button")].find((b) => /Snooze reminder/i.test(b.textContent)).click();
      await flush(6);

      const afterSeries = h.seam.store.items.get("standup");
      assert.ok(afterSeries.x.recurrenceExceptions.some((e) => e.scope === "series"), "series-scope exception recorded");
    } finally {
      await h.destroy();
    }
  });

  console.log(`\nPASS notes-recurring-snooze (${passed} tests)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
