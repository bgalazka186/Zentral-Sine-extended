"use strict";
// T2.11a: Per-note Calendar-only / Hide from Zen NOTES flag, coexistence with T2.11 folder exclusion,
// Birthday note preset/category with unlimited independent yearly birthday reminders, and EN/PL UI.
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const J = (v) => JSON.parse(JSON.stringify(v));
const MODE = "zen.workspace.zentral.notes.zen_folder";
const AGENDA = "zen.workspace.zentral.notes.agenda_folder";
const LANG = "zen.workspace.zentral.notes.language";

const settle = async (turns = 10) => {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
};
const flushUi = async (h, turns = 8) => {
  for (let i = 0; i < turns; i++) {
    h.fireTimer(16);
    await new Promise((resolve) => setImmediate(resolve));
  }
};

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("ok - " + name);
  } catch (err) {
    failed++;
    console.error("FAIL - " + name + ":\n", err && err.stack ? err.stack : err);
  }
}

async function bootZen(prefs = {}) {
  const h = createFakeZen({ prefs: { [MODE]: "all", ...prefs } });
  await h.seam.ensureStore();
  h.fireTimer(6000);
  await settle(4);
  return h;
}

const makeNote = (id, body, extra = {}) => ({
  id,
  body,
  created: 100,
  updated: 100,
  touched: true,
  color: "none",
  label: "",
  folder: "",
  pinned: false,
  calendarOnly: false,
  flavor: "",
  trashed: 0,
  remind: 0,
  reminded: 0,
  foreign: "",
  ...extra,
});

(async () => {
  await test("pure: front-matter round-trip, resolveNoteZenSidebar coexistence, Birthday builders & Obsidian round-trip", async () => {
    const h = await bootZen({ [MODE]: "off" });
    try {
      const core = h.window.__zentralNotesTestSeam.core;

      // Front-matter serialization & parsing
      const calNote = makeNote("n-bday", "# Birthdays\n\n%%calendar: Birthdays%%\n- 14-05 Anna\n", { calendarOnly: true });
      const raw = core.serializeNote(calNote);
      assert.ok(raw.includes("calendar_only: true"), "serializeNote writes calendar_only: true");
      const parsed = core.noteFromFile("n-bday", raw, 200);
      assert.equal(parsed.calendarOnly, true, "noteFromFile parses calendar_only: true");

      const normalNote = makeNote("n-reg", "# Regular\n");
      const rawNormal = core.serializeNote(normalNote);
      assert.equal(rawNormal.includes("calendar_only"), false, "normal notes omit calendar_only");
      assert.equal(core.noteFromFile("n-reg", rawNormal, 200).calendarOnly, false);

      // Coexistence with T2.11 folder exclusion & child "show" override
      const folders = [
        { id: "private", label: "Private", uid: "f1111111111", zenSidebar: "hide" },
        { id: "private/sub", label: "Sub", uid: "f2222222222" },
        { id: "private/shown", label: "Shown", uid: "f3333333333", zenSidebar: "show" },
        { id: "work", label: "Work", uid: "f4444444444" },
      ];
      assert.deepEqual(J(core.resolveNoteZenSidebar(makeNote("a", "# A", { folder: "work" }), folders)), {
        hidden: false, ownHidden: false, folderHidden: false, reason: "visible",
      });
      assert.deepEqual(J(core.resolveNoteZenSidebar(makeNote("b", "# B", { folder: "work", calendarOnly: true }), folders)), {
        hidden: true, ownHidden: true, folderHidden: false, reason: "note",
      });
      assert.deepEqual(J(core.resolveNoteZenSidebar(makeNote("c", "# C", { folder: "private/sub" }), folders)), {
        hidden: true, ownHidden: false, folderHidden: true, reason: "folder",
      });
      assert.deepEqual(J(core.resolveNoteZenSidebar(makeNote("d", "# D", { folder: "private/sub", calendarOnly: true }), folders)), {
        hidden: true, ownHidden: true, folderHidden: true, reason: "both",
      });
      // Per-note calendarOnly STILL hides a note inside an explicitly "show"-overridden child folder
      assert.deepEqual(J(core.resolveNoteZenSidebar(makeNote("e", "# E", { folder: "private/shown", calendarOnly: true }), folders)), {
        hidden: true, ownHidden: true, folderHidden: false, reason: "note",
      });

      // Birthday date parsing & formatting (including leap day Feb 29 and validation)
      assert.deepEqual(J(core.parseBirthdayDate("14-05")), { day: 14, month: 5, birthYear: 0 });
      assert.deepEqual(J(core.parseBirthdayDate("29.02.")), { day: 29, month: 2, birthYear: 0 });
      assert.deepEqual(J(core.parseBirthdayDate("1992-05-14")), { day: 14, month: 5, birthYear: 1992 });
      assert.deepEqual(J(core.parseBirthdayDate("29-02-2000")), { day: 29, month: 2, birthYear: 2000 });
      assert.equal(core.parseBirthdayDate("29-02-1999"), null, "non-leap Feb 29 with year rejected");
      assert.equal(core.parseBirthdayDate("30-02"), null, "Feb 30 rejected");
      assert.equal(core.parseBirthdayDate("14-13"), null, "month 13 rejected");

      assert.equal(core.formatBirthdayLine({ name: "Anna Kowalska", date: "1992-05-14" }), "- 14-05 Anna Kowalska");
      assert.equal(core.formatBirthdayLine({ name: "Jan Nowak", date: "29-02", time: "9:00" }), "- 29-02 09:00 Jan Nowak");
      assert.equal(core.formatBirthdayLine({ name: "Bad Time", date: "14-05", time: "25:99" }), "");

      const bdayBody = core.buildBirthdayNoteBody({
        title: "Family Birthdays",
        entries: [
          { name: "Anna Kowalska", date: "14-05" },
          { name: "Piotr Kowalski", date: "14-05", time: "09:00" },
        ],
      });
      assert.equal(bdayBody, "# Family Birthdays\n\n%%calendar: Birthdays%%\n- 14-05 Anna Kowalska\n- 14-05 09:00 Piotr Kowalski\n");

      // Appending respects existing Birthdays marker and ignores code fences
      const fenced = "# Mixed\n\n```\n%%calendar: Birthdays%%\n- 01-01 Fake\n```\n\nSome text.\n";
      const appendedNew = core.appendBirthdayEntry(fenced, { name: "Maria", date: "24-12" });
      assert.equal(appendedNew.changed, true);
      assert.ok(appendedNew.body.endsWith("\n\n%%calendar: Birthdays%%\n- 24-12 Maria\n"), "does not insert inside code fence");

      const emptyPreset = core.buildBirthdayNoteBody({ title: "Birthdays" });
      const replaced = core.appendBirthdayEntry(emptyPreset, { name: "First Person", date: "03-07" });
      assert.equal(replaced.body, "# Birthdays\n\n%%calendar: Birthdays%%\n- 03-07 First Person\n");
      const second = core.appendBirthdayEntry(replaced.body, { name: "Second Person", date: "08-10" });
      assert.equal(second.body, "# Birthdays\n\n%%calendar: Birthdays%%\n- 03-07 First Person\n- 08-10 Second Person\n");

      // Extract items via calendar engine -> independent yearly reminders in Birthdays category
      const extracted = C.extractNoteItems(second.body, "n-bday", new Date(2026, 10, 16, 10, 0).getTime());
      assert.equal(extracted.length, 2);
      for (const item of extracted) {
        assert.equal(item.x.kind, "reminder");
        assert.equal(item.x.category, "Birthdays");
        assert.deepEqual(J(item.recurrence), ["RRULE:FREQ=YEARLY"]);
      }

      // Obsidian vault front-matter round-trip
      const obsFm = core.buildObsidianFrontMatter(calNote, "");
      assert.ok(obsFm.frontMatter.includes("zentral_calendar_only: true"), "Obsidian export preserves calendarOnly");
      const obsParsed = core.parseObsidianFrontMatter(obsFm.frontMatter + "# Birthdays\n", "Birthdays.md");
      assert.equal(obsParsed.meta.calendarOnly, true, "Obsidian import restores calendarOnly");
    } finally {
      await h.destroy();
    }
  });

  await test("pure projection: projectZen (all & selected) and projectNotesFolder omit calendarOnly notes and coexist with T2.11", async () => {
    const h = await bootZen({ [MODE]: "off" });
    try {
      const core = h.window.__zentralNotesTestSeam.core;
      const folders = [
        { id: "work", label: "Work", uid: "f1111111111" },
        { id: "private", label: "Private", uid: "f2222222222", zenSidebar: "hide" },
        { id: "private/shown", label: "Shown", uid: "f3333333333", zenSidebar: "show" },
        { id: core.TABBAR_FOLDER, label: "Notes (tabbar)", uid: "f4444444444" },
      ];
      const notes = [
        makeNote("n-root-ok", "# Root OK"),
        makeNote("n-root-cal", "# Root Birthday", { calendarOnly: true }),
        makeNote("n-work-ok", "# Work OK", { folder: "work" }),
        makeNote("n-work-cal", "# Work Birthday", { folder: "work", calendarOnly: true }),
        makeNote("n-priv-both", "# Private Birthday", { folder: "private", calendarOnly: true }),
        makeNote("n-shown-ok", "# Shown OK", { folder: "private/shown" }),
        makeNote("n-shown-cal", "# Shown Birthday", { folder: "private/shown", calendarOnly: true }),
        makeNote("n-tab-ok", "# Tabbar OK", { folder: core.TABBAR_FOLDER }),
        makeNote("n-tab-cal", "# Tabbar Birthday", { folder: core.TABBAR_FOLDER, calendarOnly: true }),
      ];

      const allKeys = core.projectZen(notes, folders, "all").map((e) => e.key);
      assert.ok(allKeys.includes("n:n-root-ok"));
      assert.ok(allKeys.includes("n:n-work-ok"));
      assert.ok(allKeys.includes("n:n-shown-ok"));
      assert.ok(allKeys.includes("n:n-tab-ok"));
      for (const hiddenId of ["n-root-cal", "n-work-cal", "n-priv-both", "n-shown-cal", "n-tab-cal"]) {
        assert.equal(allKeys.includes("n:" + hiddenId), false, `all mode excludes calendarOnly note ${hiddenId}`);
      }

      const selKeys = core.projectZen(notes, folders, "selected").map((e) => e.key);
      assert.deepEqual(J(selKeys), ["n:n-tab-ok"], "selected mode keeps normal tabbar note and omits calendarOnly note");

      const legacyKeys = core.projectNotesFolder(notes, folders).map((e) => e.key);
      assert.equal(legacyKeys.includes("n:n-root-cal"), false);
      assert.equal(legacyKeys.includes("n:n-shown-cal"), false);
      assert.ok(legacyKeys.includes("n:n-shown-ok"));

      // Coexistence check: unhiding "private" still keeps n-priv-both excluded because calendarOnly is true.
      const foldersUnhidden = folders.map((f) => (f.id === "private" ? { id: f.id, label: f.label, uid: f.uid } : f));
      const keysAfterFolderUnhide = core.projectZen(notes, foldersUnhidden, "all").map((e) => e.key);
      assert.equal(keysAfterFolderUnhide.includes("n:n-priv-both"), false, "unhiding folder does not leak calendarOnly note");

      // Clearing calendarOnly while "private" is STILL hidden keeps n-priv-both hidden via folder exclusion.
      const notesFlagCleared = notes.map((n) => (n.id === "n-priv-both" ? { ...n, calendarOnly: false } : n));
      const keysAfterNoteFlagClear = core.projectZen(notesFlagCleared, folders, "all").map((e) => e.key);
      assert.equal(keysAfterNoteFlagClear.includes("n:n-priv-both"), false, "clearing calendarOnly still obeys hidden folder");

      // Clearing BOTH lets it project.
      const keysBothCleared = core.projectZen(notesFlagCleared, foldersUnhidden, "all").map((e) => e.key);
      assert.ok(keysBothCleared.includes("n:n-priv-both"), "note projects only when both note and folder exclusions are cleared");
    } finally {
      await h.destroy();
    }
  });

  await test("live Zen sidebar: calendar-only notes never create tabs, context menu hides projected note, folder menu creates calendar-only note", async () => {
    const h = await bootZen({ [MODE]: "all", [AGENDA]: true });
    try {
      const { store, zen } = h.seam;
      const core = h.window.__zentralNotesTestSeam.core;
      const workId = store.addFolder("Work", "");
      const normal = store.create("# Project Alpha\nSee [[Anna Birthday]].\n", workId);
      const bday = store.create(
        core.buildBirthdayNoteBody({
          title: "Anna Birthday",
          entries: [{ name: "Anna Kowalska", date: "14-05" }],
        }),
        workId,
        { calendarOnly: true },
      );
      zen.runNow();
      await settle(4);

      const managedTabs = () => h.document.querySelectorAll("tab").filter((t) => t.hasAttribute("bgalazka-notes-item"));
      const tabIds = () => managedTabs().map((t) => t.getAttribute("bgalazka-notes-item"));
      assert.deepEqual(tabIds(), ["n:" + normal.id], "only normal note has a Zen NOTES tab; birthday note never projects");

      // Place a foreign user tab inside NOTES to verify hiding a note never touches foreign tabs
      const rootFolder = h.document.getElementById(core.NOTES_ZEN_ROOT_ID);
      assert.ok(rootFolder, "NOTES root folder exists");
      const foreign = h.window.gBrowser.addTab("https://example.com/user-tab", { pinned: true });
      rootFolder.append(foreign);

      // Right-click the normal note tab in Zen NOTES -> click "Hide from Zen NOTES"
      const tabMenu = h.document.createXULElement("menupopup");
      tabMenu.id = "tabContextMenu";
      h.document.body.append(tabMenu);
      const normalTab = managedTabs()[0];
      h.window.TabContextMenu = { contextTab: normalTab };
      h.emit("popupshowing", tabMenu);
      const hideItem = tabMenu.querySelector('[zentral-notes-own="zen-hide"]');
      assert.ok(hideItem, "Zen note tab context menu exposes Hide from Zen NOTES");
      assert.equal(hideItem.getAttribute("label"), "Hide from Zen NOTES");
      hideItem.dispatchEvent(new h.Ev("command", { bubbles: true }));
      await settle(4);
      while (h.fireTimer(250)) {}
      await settle(4);

      assert.equal(store.get(normal.id).calendarOnly, true, "note is now marked calendarOnly");
      assert.deepEqual(tabIds(), [], "Zen tab retired immediately");
      assert.equal(foreign.isConnected, true, "foreign user tab untouched");

      // Flush and confirm calendar_only: true is written to disk
      await store.flush();
      const onDisk = String(h.files.get("/profile/zentral-notes/" + normal.id + ".md") || "");
      assert.ok(onDisk.includes("calendar_only: true"), "calendar_only persisted to .md front matter");

      // Hidden calendar-only notes stay fully live in All notes, search, wiki links/backlinks, and Calendar items!
      assert.ok(store.list().some((n) => n.id === bday.id), "birthday note stays in All notes");
      assert.ok(store.list().some((n) => n.id === normal.id), "hidden note stays in All notes");
      const searchHits = core.searchOtherNotes(store.list(), "Anna Kowalska", normal.id);
      assert.equal(searchHits.count, 1);
      assert.equal(searchHits.ids[0], bday.id, "search still finds calendar-only birthday note");
      const resolved = core.resolveWikiTarget(store.list(), store.meta.folders, core.parseWikiTarget("Anna Birthday"));
      assert.equal(resolved?.id, bday.id, "wiki link resolves to calendar-only note");
      const backlinks = core.findBacklinks(store.list(), store.get(bday.id), store.meta.folders);
      assert.equal(backlinks.linked.length, 1);
      assert.equal(backlinks.linked[0].id, normal.id, "backlinks include calendar-only notes");
      const bdayItems = store.items.list({ noteId: bday.id });
      assert.equal(bdayItems.length, 1, "birthday reminder stays active on Calendar");
      assert.equal(bdayItems[0].x.category, "Birthdays");
      assert.deepEqual(J(bdayItems[0].recurrence), ["RRULE:FREQ=YEARLY"]);

      // Zen sidebar folder context menu: "New calendar-only note here" creates a calendar-only note & opens sheet without creating a Zen tab
      const folderMenu = h.document.createXULElement("menupopup");
      folderMenu.id = "zenFolderActions";
      h.document.body.append(folderMenu);
      const workFolderEl = h.document.querySelectorAll("zen-folder").find((el) => el.getAttribute("bgalazka-notes-label") === "Work");
      assert.ok(workFolderEl, "Work folder exists in Zen sidebar");
      folderMenu.triggerNode = workFolderEl;
      h.emit("popupshowing", folderMenu);
      const newCalOnlyItem = folderMenu.querySelector('[zentral-notes-folder-own="new-cal-only"]');
      assert.ok(newCalOnlyItem, "Zen folder context menu exposes New calendar-only note here");
      const countBefore = store.list().length;
      newCalOnlyItem.dispatchEvent(new h.Ev("command", { bubbles: true }));
      await settle(8);
      h.fireTimer(250);
      await settle(4);
      assert.equal(store.list().length, countBefore + 1);
      const createdFromZen = store.list().find((n) => n.id !== normal.id && n.id !== bday.id);
      assert.equal(createdFromZen.calendarOnly, true);
      assert.equal(createdFromZen.folder, workId);
      assert.deepEqual(tabIds(), [], "new calendar-only note from Zen folder menu never spawns a Zen tab");
    } finally {
      await h.destroy();
    }
  });

  await test("Sheet UI: Birthday note preset with unlimited independent yearly reminders, composer calendar-only creation, badges & Polish live switch", async () => {
    const h = await bootZen({ [MODE]: "all", [AGENDA]: true });
    try {
      const { store, zen } = h.seam;
      const folderId = store.addFolder("Personal", "");
      const seedNote = store.create("# Starter Note\nHello world\n", folderId);
      zen.runNow();
      await settle(4);

      // Open the Notes sheet via tab context menu on Starter Note
      const tabMenu = h.document.createXULElement("menupopup");
      tabMenu.id = "tabContextMenu";
      h.document.body.append(tabMenu);
      const starterTab = h.document.querySelectorAll("tab").find((t) => t.getAttribute("bgalazka-notes-item") === "n:" + seedNote.id);
      h.window.TabContextMenu = { contextTab: starterTab };
      h.emit("popupshowing", tabMenu);
      tabMenu.querySelector('[zentral-notes-own="open"]').dispatchEvent(new h.Ev("command", { bubbles: true }));
      await flushUi(h);

      const sheetEl = h.document.querySelector(".zentral-notes-sheet");
      assert.ok(sheetEl && !sheetEl.hidden, "Notes sheet opened");
      sheetEl.ownerDocument = h.document;
      const layoutRect = () => ({ left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700 });
      sheetEl.querySelector(".zn-all-layout").getBoundingClientRect = layoutRect;
      sheetEl.querySelector(".zn-all-panels").getBoundingClientRect = layoutRect;
      sheetEl.querySelector(".zn-calendar-pane").getBoundingClientRect = () => ({ left: 400, top: 0, right: 1100, bottom: 700, width: 700, height: 700 });

      // Switch to All notes view
      sheetEl.querySelector(".zn-list-btn").click();
      await flushUi(h);

      // Open folder menu on "Personal" -> pick "New birthday note…"
      const personalRow = sheetEl.querySelectorAll(".zn-frow").find((r) => r.getAttribute("data-fid") === folderId);
      assert.ok(personalRow, "Personal folder row visible");
      personalRow.querySelector(".zn-fmore").click();
      await flushUi(h);
      const newBdayBtn = sheetEl.querySelectorAll(".zn-menu .zn-menu-item").find((b) => b.textContent.trim() === "New birthday note…");
      assert.ok(newBdayBtn, "folder menu exposes New birthday note…");
      newBdayBtn.click();
      await flushUi(h);

      const bdayCard = sheetEl.querySelector(".zn-bday-dialog-card");
      assert.ok(bdayCard, "Birthday preset dialog opened");
      const titleInput = bdayCard.querySelector('input[placeholder*="Anna"]');
      const inputs = bdayCard.querySelectorAll('input[type="text"], input:not([type])');
      const [inTitle, inName, inDate, inTime] = inputs;
      assert.ok(inTitle && inName && inDate && inTime, "dialog fields present");
      const addAnotherBtn = bdayCard.querySelectorAll("button").find((b) => b.textContent.includes("Add birthday to list"));
      const folderSelect = bdayCard.querySelector("select");
      const calOnlyCheckbox = bdayCard.querySelector('input[type="checkbox"]');
      assert.equal(calOnlyCheckbox.checked, true, "Calendar-only checked by default for Birthday preset");

      // Stage 3 independent birthdays (including 2 on the SAME day + timed + leap day Feb 29)
      inTitle.value = "Family Birthdays";
      inName.value = "Anna Kowalska";
      inDate.value = "1992-05-14";
      addAnotherBtn.click();
      await flushUi(h);

      inName.value = "Piotr Kowalski";
      inDate.value = "14-05";
      inTime.value = "09:00";
      addAnotherBtn.click();
      await flushUi(h);

      // Leave 3rd entry in inputs to verify Create submits staged + current draft together
      inName.value = "Jan Leap";
      inDate.value = "29-02";

      // Select "Create \"Birthdays\" folder (excluded from Zen NOTES)"
      const createBdayFolderOpt = folderSelect.querySelectorAll("option").find((o) => o.getAttribute("value") === "__zentral_create_birthdays_folder__");
      assert.ok(createBdayFolderOpt, "folder selector offers creating hidden Birthdays folder");
      folderSelect.value = createBdayFolderOpt.getAttribute("value");

      const createBtn = bdayCard.querySelectorAll("button").find((b) => b.textContent.trim() === "Create birthday note");
      createBtn.click();
      await flushUi(h);
      zen.runNow();
      await settle(4);

      // Verify Birthdays folder was created AND excluded from Zen NOTES
      const bdaysFolder = store.meta.folders.find((f) => f.id === "birthdays");
      assert.ok(bdaysFolder, "Birthdays folder created");
      assert.equal(bdaysFolder.zenSidebar, "hide", "Birthdays folder excluded from Zen NOTES");

      // Verify created birthday note
      const bdayNote = store.list().find((n) => n.folder === "birthdays");
      assert.ok(bdayNote, "birthday note created in birthdays folder");
      assert.equal(bdayNote.calendarOnly, true, "birthday note marked calendarOnly");
      const zenTabIds = h.document.querySelectorAll("tab").filter((t) => t.hasAttribute("bgalazka-notes-item")).map((t) => t.getAttribute("bgalazka-notes-item"));
      assert.deepEqual(zenTabIds, ["n:" + seedNote.id], "birthday note did not create a Zen NOTES tab");

      // Verify 3 independent yearly recurring birthday reminders on the calendar
      let bdayReminders = store.items.list({ noteId: bdayNote.id, kind: "reminder" });
      assert.equal(bdayReminders.length, 3, "all 3 birthdays created independent reminders");
      assert.equal(new Set(bdayReminders.map((r) => r.id)).size, 3, "all 3 have distinct ids");
      for (const r of bdayReminders) {
        assert.equal(r.x.category, "Birthdays");
        assert.deepEqual(J(r.recurrence), ["RRULE:FREQ=YEARLY"]);
      }
      assert.ok(bdayReminders.some((r) => r.summary === "Anna Kowalska" && r.start.date));
      assert.ok(bdayReminders.some((r) => r.summary === "Piotr Kowalski" && r.start.dateTime));
      assert.ok(bdayReminders.some((r) => r.summary === "Jan Leap" && r.start.date && r.start.date.endsWith("-02-29")));

      // Verify editor header shows clickable "Calendar-only" chip and lets user add a 4th independent birthday reminder
      const calOnlyChip = sheetEl.querySelector(".zn-cal-only-chip");
      assert.ok(calOnlyChip && !calOnlyChip.hidden, "editor header shows Calendar-only chip");
      assert.equal(calOnlyChip.textContent.trim(), "Calendar-only");
      calOnlyChip.click();
      await flushUi(h);
      const addMoreBday = sheetEl.querySelectorAll(".zn-menu .zn-menu-item").find((b) => b.textContent.trim() === "Add birthday reminder…");
      assert.ok(addMoreBday, "Calendar-only chip menu offers Add birthday reminder…");
      addMoreBday.click();
      await flushUi(h);

      const addCard = sheetEl.querySelector(".zn-bday-add-card");
      assert.ok(addCard, "Add birthday reminder dialog opened");
      const [addName, addDate] = addCard.querySelectorAll('input[type="text"], input:not([type])');
      addName.value = "Zofia Nowak";
      addDate.value = "12-11";
      addCard.querySelectorAll("button").find((b) => b.textContent.trim() === "Add reminder").click();
      await flushUi(h);

      bdayReminders = store.items.list({ noteId: bdayNote.id, kind: "reminder" });
      assert.equal(bdayReminders.length, 4, "4th independent yearly birthday reminder added cleanly");
      assert.ok(bdayReminders.some((r) => r.summary === "Zofia Nowak" && r.x.category === "Birthdays"));

      // Verify Calendar / reminder navigation opens the calendar-only note cleanly (navigate away first)
      sheetEl.querySelector(".zn-list-btn").click();
      await flushUi(h);
      const bdayRow = sheetEl.querySelectorAll(".zn-item").find((el) => el.getAttribute("data-id") === bdayNote.id);
      assert.ok(bdayRow, "birthday note row rendered in All notes tree");
      assert.equal(bdayRow.getAttribute("data-calendar-only"), "true");
      assert.equal(bdayRow.getAttribute("data-zen-hidden"), "true");
      assert.equal(bdayRow.getAttribute("data-zen-hidden-reason"), "both", "coexistence reports both note and folder exclusion");
      const rowBadge = bdayRow.querySelector(".zn-item-cal-only");
      assert.ok(rowBadge && rowBadge.textContent.trim() === "Calendar-only", "All notes shows Calendar-only badge");

      // Test Calendar Composer "New calendar-only note" option
      const composer = h.seam.bindings?.size ? null : null;
      // Trigger composer via Calendar day menu ("New reminder…") on any day cell
      const dayCell = sheetEl.querySelector(".zn-cal-month-cell");
      assert.ok(dayCell, "calendar month cell present");
      dayCell.dispatchEvent(new h.Ev("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      await flushUi(h);
      assert.ok(sheetEl.querySelectorAll(".zn-menu .zn-menu-item").some((b) => b.textContent.trim() === "New birthday note…"), "calendar day menu offers New birthday note…");
      sheetEl.querySelectorAll(".zn-menu .zn-menu-item").find((b) => b.textContent.trim() === "New reminder…").click();
      await flushUi(h);

      const composeCard = sheetEl.querySelector(".zn-cal-compose-card");
      assert.ok(composeCard, "Calendar composer opened");
      const linkedSel = composeCard.querySelector('[aria-label="Linked note"]');
      const newCalOpt = linkedSel.querySelectorAll("option").find((o) => o.getAttribute("value") === "__zentral_new_calendar_only_note__");
      assert.ok(newCalOpt, "composer offers New calendar-only note");
      assert.equal(linkedSel.value, "", "composer default linked note remains blank");
      linkedSel.value = newCalOpt.getAttribute("value");
      composeCard.querySelector('input[aria-label="Title"]').value = "Dentist Follow-up";
      composeCard.querySelectorAll("button").find((b) => b.textContent.trim() === "Create reminder").click();
      await flushUi(h);
      zen.runNow();
      await settle(4);

      const dentistNote = store.list().find((n) => n.body.includes("Dentist Follow-up"));
      assert.ok(dentistNote, "composer created linked calendar-only note");
      assert.equal(dentistNote.calendarOnly, true, "composer-created note marked calendarOnly");
      assert.equal(store.items.list({ noteId: dentistNote.id }).length, 1, "reminder linked to calendar-only note");
      const zenTabIdsAfterCompose = h.document.querySelectorAll("tab").filter((t) => t.hasAttribute("bgalazka-notes-item")).map((t) => t.getAttribute("bgalazka-notes-item"));
      assert.deepEqual(zenTabIdsAfterCompose, ["n:" + seedNote.id], "composer-created calendar-only note never spawns a Zen tab");

      // Switch language live to Polish -> verify Calendar-only badge & menus localize cleanly
      h.setPref(LANG, "pl");
      await flushUi(h);
      const bdayRowPl = sheetEl.querySelectorAll(".zn-item").find((el) => el.getAttribute("data-id") === bdayNote.id);
      assert.equal(bdayRowPl?.querySelector(".zn-item-cal-only")?.textContent.trim(), "Tylko w Kalendarzu", "badge localizes to Polish");
      bdayRowPl.dispatchEvent(new h.Ev("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
      await flushUi(h);
      const plNoteMenu = sheetEl.querySelectorAll(".zn-menu .zn-menu-item").map((b) => b.textContent.trim());
      assert.ok(plNoteMenu.includes("Pokaż w Zen NOTES"), "Polish note menu shows Pokaż w Zen NOTES");
      assert.ok(plNoteMenu.includes("Dodaj przypomnienie urodzinowe…"), "Polish note menu shows Dodaj przypomnienie urodzinowe…");
      // Verify Zen tab context menu label also updates in Polish
      h.window.TabContextMenu = { contextTab: starterTab };
      h.emit("popupshowing", tabMenu);
      assert.equal(tabMenu.querySelector('[zentral-notes-own="zen-hide"]').getAttribute("label"), "Ukryj w Zen NOTES");
    } finally {
      await h.destroy();
    }
  });

  if (failed) {
    console.error(`\nFAIL notes-calendar-only (${failed} failed, ${passed} passed)`);
    process.exit(1);
  }
  console.log(`\nPASS notes-calendar-only (${passed} tests)`);
})();
