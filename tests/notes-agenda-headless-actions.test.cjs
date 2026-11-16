"use strict";
/* SB6.3: Agenda sidebar quick actions run headlessly without opening a Notes sheet,
 * write reminder history / store updates, show a small toast with Undo, and keep
 * the Notes sheet strictly for sheet-bound commands ('Edit details…', 'Change time…',
 * 'Open source note', 'Custom date and time…', 'Delete…'). */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const createZenHost = async (opts = {}) => {
  const h = createFakeZen({ ...opts, prefs: { "zen.workspace.zentral.notes.agenda_folder": true, ...(opts.prefs || {}) } });
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await Promise.resolve();
  return h;
};

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

const settle = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

const date = (days = 1, hour = 12, minute = 0) => {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
};

const makeReminder = (id, start, extra = {}) => ({
  id,
  summary: extra.summary || id,
  start: extra.allDay ? { date: C.localDateKey(start) } : { dateTime: new Date(start).toISOString() },
  x: { kind: "reminder", src: "manual", ...(extra.x || {}) },
  ...(extra.recurrence ? { recurrence: extra.recurrence } : {}),
});

const makeEvent = (id, start, end, extra = {}) => ({
  id,
  summary: extra.summary || id,
  start: { dateTime: new Date(start).toISOString() },
  end: { dateTime: new Date(end).toISOString() },
  x: { kind: "event", src: "manual", ...(extra.x || {}) },
});

function openTabMenu(h, tab) {
  let menu = h.document.getElementById("tabContextMenu");
  if (!menu) {
    menu = h.document.createXULElement("menupopup");
    menu.id = "tabContextMenu";
    h.document.body.append(menu);
  }
  h.window.TabContextMenu = { contextTab: tab };
  h.emit("popupshowing", menu);
  return menu;
}

function menuItem(menu, label) {
  return menu.querySelectorAll("menuitem").find((el) => el.getAttribute("label") === label) || null;
}

function sheetIsOpen(h) {
  return h.document.querySelectorAll(".zentral-notes-sheet").some((s) => !s.hidden);
}

function agendaToastEl(h) {
  return h.document.getElementById("bgalazka-notes-agenda-toast");
}

function projectedTabs(h) {
  return h.document.querySelectorAll("tab[bgalazka-notes-agenda-item]")
    .filter((t) => !String(t.getAttribute("bgalazka-notes-agenda-item") || "").startsWith("seed:"));
}

function tabForItem(h, itemId) {
  return projectedTabs(h).find((t) =>
    t.getAttribute("bgalazka-notes-agenda-item-id") === itemId ||
    t.getAttribute("bgalazka-notes-agenda-record-id") === itemId) || null;
}

(async () => {
  await test("pure helpers: headless vs sheet command partition, DST-safe snoozeMondayDays, undoLifecycleAction and labels", async () => {
    assert.equal(typeof C.isHeadlessAgendaCommand, "function", "isHeadlessAgendaCommand exported");
    assert.equal(typeof C.snoozeMondayDays, "function", "snoozeMondayDays exported");
    assert.equal(typeof C.undoLifecycleAction, "function", "undoLifecycleAction exported");
    assert.equal(typeof C.agendaActionMessage, "function", "agendaActionMessage exported");
    assert.ok(Array.isArray(C.HEADLESS_AGENDA_COMMANDS), "HEADLESS_AGENDA_COMMANDS exported");
    assert.ok(Array.isArray(C.SHEET_AGENDA_COMMANDS), "SHEET_AGENDA_COMMANDS exported");

    // Every menu command in calendarItemMenuModel is classified into exactly one bucket.
    const sample = makeReminder("r1", date(1));
    const model = C.calendarItemMenuModel(sample, { state: "pending", historyWritable: true, agendaVisible: true, agendaWritable: true });
    const cmds = [];
    const collect = (rows) => {
      for (const r of rows) {
        if (r.group) collect(r.group);
        else if (r.command) cmds.push(r.command);
      }
    };
    collect(model);
    for (const cmd of cmds) {
      const h = C.HEADLESS_AGENDA_COMMANDS.includes(cmd);
      const s = C.SHEET_AGENDA_COMMANDS.includes(cmd);
      assert.ok(h !== s, `command "${cmd}" must be exclusively headless or sheet-bound (headless=${h}, sheet=${s})`);
      assert.equal(C.isHeadlessAgendaCommand(cmd), h);
    }

    // Required headless quick actions:
    for (const cmd of ["mark-done", "dismiss", "reopen", "snooze-1d", "snooze-3d", "snooze-monday", "agenda-visibility", "convert", "duplicate"]) {
      assert.equal(C.isHeadlessAgendaCommand(cmd), true, `${cmd} is headless`);
    }
    // Required sheet-bound actions:
    for (const cmd of ["open", "edit", "change-time", "snooze-custom", "delete"]) {
      assert.equal(C.isHeadlessAgendaCommand(cmd), false, `${cmd} stays sheet-bound`);
    }

    // snoozeMondayDays computes 1..7 civil days to next Monday regardless of weekday or timezone.
    // 2026-11-16 is a Monday -> next Monday is +7 days; 2026-11-15 is Sunday -> +1 day; 2026-11-20 is Friday -> +3 days.
    assert.equal(C.snoozeMondayDays({ start: { date: "2026-11-16" } }), 7, "Monday -> +7 days");
    assert.equal(C.snoozeMondayDays({ start: { date: "2026-11-15" } }), 1, "Sunday -> +1 day");
    assert.equal(C.snoozeMondayDays({ start: { date: "2026-11-20" } }), 3, "Friday -> +3 days");
    assert.equal(C.snoozeMondayDays({ start: { date: "2026-11-17" } }), 6, "Tuesday -> +6 days");
    // Zoned instant: 2026-11-16T01:00:00Z is Sunday 2026-11-15 in America/Los_Angeles -> +1 day to Monday!
    assert.equal(C.snoozeMondayDays({ start: { dateTime: "2026-11-16T01:00:00.000Z" }, x: { tz: "America/Los_Angeles" } }), 1, "respects item timezone");

    // undoLifecycleAction maps prior state to the append-only restoring action.
    assert.equal(C.undoLifecycleAction("pending"), "reopened");
    assert.equal(C.undoLifecycleAction("done"), "done");
    assert.equal(C.undoLifecycleAction("dismissed"), "dismissed");
    assert.equal(C.undoLifecycleAction(""), "reopened");

    assert.match(C.agendaActionMessage("mark-done"), /done/i);
    assert.match(C.agendaActionMessage("snooze-1d"), /snooz/i);
  });

  await test("headless Done, Dismiss, Snooze (+1d/+3d/Monday) from sidebar menu write history, leave NO sheet open, and Undo cleanly", async () => {
    const h = await createZenHost();
    try {
      await h.seam.ensureStore();
      // Create a mirrored list reminder so checkbox sync + undo is also verified!
      const start = date(1, 10, 30);
      const startKey = C.localDateKey(start);
      const item = h.seam.store.items.upsert(makeReminder("m1", start, { summary: "Pay rent" }));
      assert.ok(item);
      const noteId = h.seam.store.mirrorItemToAgendaNote(item.id);
      assert.ok(noteId, "mirrored reminder into Agenda date note");
      const mirrored = h.seam.store.items.list().find((x) => x.summary === "Pay rent");
      assert.ok(mirrored);
      assert.match(h.seam.store.get(noteId).body, /- \[ \] \d{4}-\d{2}-\d{2} 10:30 Pay rent/);

      h.seam.agendaController.runNow();
      const tab = tabForItem(h, mirrored.id);
      assert.ok(tab, "reminder projected into Agenda sidebar");
      assert.equal(sheetIsOpen(h), false, "no sheet open before action");

      // --- 1. Mark as done headlessly ---
      const menu1 = openTabMenu(h, tab);
      const doneBtn = menuItem(menu1, "Mark as done");
      assert.ok(doneBtn && !doneBtn.hasAttribute("disabled"));
      doneBtn.dispatchEvent(new h.Ev("command"));
      await settle();

      assert.equal(sheetIsOpen(h), false, "Mark as done must NOT open the Notes sheet");
      const histId = C.reminderIdentity(mirrored);
      assert.equal(h.seam.store.items.history.stateFor(histId.itemId, histId.occurrenceId), "done", "history recorded done");
      assert.match(h.seam.store.get(noteId).body, /- \[x\] \d{4}-\d{2}-\d{2} 10:30 Pay rent/, "note checkbox checked headlessly");
      h.seam.agendaController.runNow();
      assert.equal(tabForItem(h, mirrored.id), null, "done item removed from Agenda sidebar");

      // Toast is shown with Undo button.
      const toast = agendaToastEl(h);
      assert.ok(toast && !toast.hidden, "small toast is visible");
      assert.equal(toast.getAttribute("role"), "status");
      assert.match(toast.querySelector(".zn-agenda-toast-msg").textContent, /done/i);
      const undoBtn = toast.querySelector(".zn-agenda-toast-undo");
      assert.ok(undoBtn && !undoBtn.hidden, "toast exposes Undo button");

      // Click Undo -> reopens reminder, unchecks note checkbox, restores sidebar tab, still NO sheet!
      undoBtn.click();
      await settle();
      assert.equal(sheetIsOpen(h), false, "Undo must NOT open the Notes sheet");
      assert.equal(h.seam.store.items.history.stateFor(histId.itemId, histId.occurrenceId), "pending", "Undo restored pending state");
      assert.equal(h.seam.store.items.history.list({ itemId: histId.itemId, occurrenceId: histId.occurrenceId }).map((r) => r.action).join(","), "reopened,done", "append-only history kept done + reopened");
      assert.match(h.seam.store.get(noteId).body, /- \[ \] \d{4}-\d{2}-\d{2} 10:30 Pay rent/, "Undo unchecked note checkbox");
      assert.equal(undoBtn.hidden, true, "Undo button hides after one use");
      h.seam.agendaController.runNow();
      assert.ok(tabForItem(h, mirrored.id), "Undo restored item to Agenda sidebar");

      // --- 2. Dismiss headlessly + Undo ---
      const tab2 = tabForItem(h, mirrored.id);
      const menu2 = openTabMenu(h, tab2);
      const dismissBtn = menuItem(menu2, "Dismiss");
      assert.ok(dismissBtn && !dismissBtn.hasAttribute("disabled"));
      dismissBtn.dispatchEvent(new h.Ev("command"));
      await settle();
      assert.equal(sheetIsOpen(h), false, "Dismiss must NOT open the Notes sheet");
      assert.equal(h.seam.store.items.history.stateFor(histId.itemId, histId.occurrenceId), "dismissed");
      h.seam.agendaController.runNow();
      assert.equal(tabForItem(h, mirrored.id), null, "dismissed item leaves Agenda sidebar");
      toast.querySelector(".zn-agenda-toast-undo").click();
      await settle();
      assert.equal(h.seam.store.items.history.stateFor(histId.itemId, histId.occurrenceId), "pending", "Undo reopened dismissed item");
      assert.equal(sheetIsOpen(h), false);
      h.seam.agendaController.runNow();
      assert.ok(tabForItem(h, mirrored.id));

      // --- 3. Snooze +1 day headlessly + Undo ---
      const beforeStartIso = h.seam.store.items.get(mirrored.id).start.dateTime;
      const tab3 = tabForItem(h, mirrored.id);
      const menu3 = openTabMenu(h, tab3);
      const snooze1 = menuItem(menu3, "Snooze +1 day");
      assert.ok(snooze1 && !snooze1.hasAttribute("disabled"));
      snooze1.dispatchEvent(new h.Ev("command"));
      await settle();
      assert.equal(sheetIsOpen(h), false, "Snooze +1 day must NOT open the Notes sheet");
      const snoozedStartIso = h.seam.store.items.get(mirrored.id).start.dateTime;
      assert.notEqual(snoozedStartIso, beforeStartIso, "start moved +1 day");
      assert.equal(h.seam.store.items.history.list({ itemId: histId.itemId, occurrenceId: histId.occurrenceId, limit: 1 })[0]?.action, "snoozed", "history recorded snoozed");
      assert.ok(!toast.hidden && !toast.querySelector(".zn-agenda-toast-undo").hidden);

      toast.querySelector(".zn-agenda-toast-undo").click();
      await settle();
      assert.equal(sheetIsOpen(h), false, "Undo Snooze must NOT open the Notes sheet");
      assert.equal(h.seam.store.items.get(mirrored.id).start.dateTime, beforeStartIso, "Undo restored exact original start");
      assert.equal(h.seam.store.items.history.list({ itemId: histId.itemId, occurrenceId: histId.occurrenceId, limit: 1 })[0]?.action, "rescheduled", "Undo appended rescheduled");

      // --- 4. Snooze +3 days & Snooze until next Monday headlessly ---
      h.seam.agendaController.runNow();
      for (const label of ["Snooze +3 days", "Snooze until next Monday"]) {
        const curStart = h.seam.store.items.get(mirrored.id).start.dateTime;
        const t = tabForItem(h, mirrored.id);
        assert.ok(t, `tab visible before ${label}`);
        const m = openTabMenu(h, t);
        const btn = menuItem(m, label);
        assert.ok(btn && !btn.hasAttribute("disabled"), `${label} enabled`);
        btn.dispatchEvent(new h.Ev("command"));
        await settle();
        assert.equal(sheetIsOpen(h), false, `${label} must NOT open the Notes sheet`);
        assert.notEqual(h.seam.store.items.get(mirrored.id).start.dateTime, curStart, `${label} moved start`);
        toast.querySelector(".zn-agenda-toast-undo").click();
        await settle();
        assert.equal(h.seam.store.items.get(mirrored.id).start.dateTime, curStart, `Undo ${label} restored start`);
        h.seam.agendaController.runNow();
      }
      assert.equal(startKey.length, 10);
    } finally {
      await h.destroy();
    }
  });

  await test("legacy note reminder Done and Snooze run headlessly with Undo", async () => {
    const h = await createZenHost();
    try {
      await h.seam.ensureStore();
      const note = h.seam.store.create("# Call dentist");
      const due = date(1, 14, 0);
      assert.ok(h.seam.store.setReminder(note.id, due));
      const cleanDue = h.seam.store.get(note.id).remind;
      h.seam.agendaController.runNow();

      const legacyId = "note-reminder:" + note.id;
      const tab = tabForItem(h, legacyId);
      assert.ok(tab, "legacy reminder projected");

      // Mark as done headlessly
      const m1 = openTabMenu(h, tab);
      menuItem(m1, "Mark as done").dispatchEvent(new h.Ev("command"));
      await settle();
      assert.equal(sheetIsOpen(h), false, "legacy Done leaves no sheet open");
      assert.equal(h.seam.store.get(note.id).remind, 0);
      assert.equal(h.seam.store.items.history.stateFor(legacyId, legacyId), "done");

      // Undo restores exact remind timestamp
      const toast = agendaToastEl(h);
      assert.ok(toast && !toast.hidden);
      toast.querySelector(".zn-agenda-toast-undo").click();
      await settle();
      assert.equal(sheetIsOpen(h), false);
      assert.equal(h.seam.store.get(note.id).remind, cleanDue, "Undo restored legacy note remind timestamp");
      assert.equal(h.seam.store.items.history.stateFor(legacyId, legacyId), "pending");

      // Snooze +1 day headlessly + Undo
      h.seam.agendaController.runNow();
      const tab2 = tabForItem(h, legacyId);
      assert.ok(tab2);
      const m2 = openTabMenu(h, tab2);
      menuItem(m2, "Snooze +1 day").dispatchEvent(new h.Ev("command"));
      await settle();
      assert.equal(sheetIsOpen(h), false, "legacy Snooze leaves no sheet open");
      assert.ok(h.seam.store.get(note.id).remind > cleanDue, "legacy remind moved ahead");
      toast.querySelector(".zn-agenda-toast-undo").click();
      await settle();
      assert.equal(h.seam.store.get(note.id).remind, cleanDue, "Undo restored legacy remind after snooze");
    } finally {
      await h.destroy();
    }
  });

  await test("Hide in Zen Agenda, Convert, and Duplicate run headlessly with Undo; conflict blocks unsafe Undo", async () => {
    const h = await createZenHost();
    try {
      await h.seam.ensureStore();
      const start = date(1, 15, 0);
      const item = h.seam.store.items.upsert(makeReminder("q1", start, { summary: "Standup" }));
      h.seam.agendaController.runNow();
      const toast = agendaToastEl(h);

      // 1. Convert to event + Undo
      const m1 = openTabMenu(h, tabForItem(h, item.id));
      menuItem(m1, "Convert to event").dispatchEvent(new h.Ev("command"));
      await settle();
      assert.equal(sheetIsOpen(h), false, "Convert leaves no sheet open");
      assert.equal(h.seam.store.items.get(item.id).x.kind, "event");
      assert.ok(h.seam.store.items.get(item.id).end?.dateTime);
      agendaToastEl(h).querySelector(".zn-agenda-toast-undo").click();
      await settle();
      assert.equal(h.seam.store.items.get(item.id).x.kind, "reminder", "Undo converted back to reminder");
      assert.equal(h.seam.store.items.get(item.id).end, undefined);

      // 2. Duplicate + Undo
      h.seam.agendaController.runNow();
      const beforeCount = h.seam.store.items.list().length;
      const m2 = openTabMenu(h, tabForItem(h, item.id));
      menuItem(m2, "Duplicate as independent item").dispatchEvent(new h.Ev("command"));
      await settle();
      assert.equal(sheetIsOpen(h), false, "Duplicate leaves no sheet open");
      assert.equal(h.seam.store.items.list().length, beforeCount + 1);
      agendaToastEl(h).querySelector(".zn-agenda-toast-undo").click();
      await settle();
      assert.equal(h.seam.store.items.list().length, beforeCount, "Undo removed duplicate copy");

      // 3. Hide in Zen Agenda + Undo
      h.seam.agendaController.runNow();
      const m3 = openTabMenu(h, tabForItem(h, item.id));
      menuItem(m3, "Hide in Zen Agenda").dispatchEvent(new h.Ev("command"));
      await settle();
      assert.equal(sheetIsOpen(h), false, "Hide in Zen Agenda leaves no sheet open");
      assert.equal(h.seam.store.items.get(item.id).x.agendaWindow?.enabled, false);
      h.seam.agendaController.runNow();
      assert.equal(tabForItem(h, item.id), null, "hidden item leaves Agenda sidebar");
      agendaToastEl(h).querySelector(".zn-agenda-toast-undo").click();
      await settle();
      assert.equal(h.seam.store.items.get(item.id).x.agendaWindow?.enabled, undefined, "Undo restored inherited visibility");
      h.seam.agendaController.runNow();
      assert.ok(tabForItem(h, item.id), "item reappears in Agenda sidebar");

      // 4. Conflict guard: external edit after Snooze prevents Undo from clobbering newer edit
      const m4 = openTabMenu(h, tabForItem(h, item.id));
      menuItem(m4, "Snooze +1 day").dispatchEvent(new h.Ev("command"));
      await settle();
      const snoozed = h.seam.store.items.get(item.id);
      h.seam.store.items.upsert({ ...snoozed, summary: "Edited concurrently" });
      agendaToastEl(h).querySelector(".zn-agenda-toast-undo").click();
      await settle();
      assert.equal(h.seam.store.items.get(item.id).summary, "Edited concurrently", "conflicting Undo does not clobber newer edit");
      assert.equal(h.seam.store.items.get(item.id).start.dateTime, snoozed.start.dateTime, "start stays at newer revision");
      assert.match(agendaToastEl(h).querySelector(".zn-agenda-toast-msg").textContent, /cannot undo/i);

      // 5. Escape dismisses toast cleanly, releases its keydown listener, and leaves no open sheet
      const beforeEscKeydown = h.listenerCount("keydown");
      h.emit("keydown", h.document.documentElement, { key: "Escape" });
      assert.equal(agendaToastEl(h).hidden, true, "Escape hides the toast");
      assert.equal(h.listenerCount("keydown"), beforeEscKeydown - 1, "hiding toast releases its Escape listener");
      assert.equal(sheetIsOpen(h), false);
      assert.equal(toast, null, "toast element is lazily created on first headless action");
    } finally {
      await h.destroy();
    }
    assert.equal(agendaToastEl(h), null, "destroy removes the toast element from DOM");
  });

  await test("Edit details… and Change time… still open the Notes sheet", async () => {
    for (const [label, expectedDialog] of [
      ["Edit details…", /edit calendar item/i],
      ["Change time…", /change calendar item time/i],
    ]) {
      const h = await createZenHost();
      try {
        await h.seam.ensureStore();
        const item = h.seam.store.items.upsert(makeEvent("ev1", date(1, 11, 0), date(1, 12, 0), { summary: "Sync" }));
        h.seam.agendaController.runNow();
        const tab = tabForItem(h, item.id);
        assert.ok(tab);
        assert.equal(sheetIsOpen(h), false);

        const menu = openTabMenu(h, tab);
        const btn = menuItem(menu, label);
        assert.ok(btn && !btn.hasAttribute("disabled"), `${label} is enabled`);
        btn.dispatchEvent(new h.Ev("command"));
        await settle(16);

        assert.equal(sheetIsOpen(h), true, `${label} opens the Notes sheet`);
        const heading = h.document.querySelector(".zn-dialog h3, .zn-dialog-title, .zn-dialog");
        assert.ok(heading && expectedDialog.test(heading.textContent || ""), `${label} opens its dialog`);
      } finally {
        await h.destroy();
      }
    }
  });

  await test("store.runAgendaCommand rejects disabled / recurring-snooze commands safely", async () => {
    const h = await createZenHost();
    try {
      await h.seam.ensureStore();
      const rec = h.seam.store.items.upsert(makeReminder("rec1", date(1, 9, 0), { summary: "Daily pills", recurrence: ["RRULE:FREQ=DAILY"] }));
      const res1 = h.seam.store.runAgendaCommand(rec, "snooze-1d");
      assert.equal(res1.ok, false, "recurring snooze rejected");
      const res2 = h.seam.store.runAgendaCommand(rec, "edit");
      assert.equal(res2.ok, false, "sheet-only command rejected by headless runner");
      assert.equal(sheetIsOpen(h), false);
    } finally {
      await h.destroy();
    }
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
