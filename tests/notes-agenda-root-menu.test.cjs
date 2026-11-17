"use strict";
/* SB6.2: Agenda root folder right-click menu ('Open calendar', 'Refresh Agenda', 'Agenda settings', 'Hide Agenda')
 * while keeping foreign items from other mods visible and leaving ordinary folders untouched. */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const enTable = require("../additional/notes/i18n/en.js");
const plTable = require("../additional/notes/i18n/pl.js");

const AGENDA_PREF = "zen.workspace.zentral.notes.agenda_folder";
const LANG_PREF = "zen.workspace.zentral.notes.language";
const MARK = "bgalazka-notes-agenda-item";
const date = (days, hour = 12) => C.addDays(C.dayStart(Date.now()), days) + hour * 3600000;
const makeItem = (id, start, end) => C.makeItem({
  id,
  summary: id,
  start: { dateTime: new Date(start).toISOString() },
  ...(end ? { end: { dateTime: new Date(end).toISOString() } } : {}),
  x: { kind: end ? "event" : "reminder", src: "manual" },
}, Date.now());
const rootEl = (h) => h.document.querySelector('zen-folder[bgalazka-notes-agenda-folder="true"]');
const projected = (h) => h.document.querySelectorAll(`tab[${MARK}]`).filter((tab) => !tab.getAttribute(MARK).startsWith("seed:"));

async function createHost(prefs = {}) {
  const h = createFakeZen({ prefs: { [AGENDA_PREF]: true, ...prefs } });
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await Promise.resolve();
  return h;
}

function makeFolderMenu(h) {
  const menu = h.document.createXULElement("menupopup");
  menu.id = "zenFolderActions";
  const nativeRename = h.document.createXULElement("menuitem");
  nativeRename.id = "context_zenFolderRename";
  nativeRename.setAttribute("label", "Rename");
  const foreignMod = h.document.createXULElement("menuitem");
  foreignMod.id = "other-mod-color-entry";
  foreignMod.setAttribute("label", "Other Mod Entry");
  menu.append(nativeRename, foreignMod);
  h.document.body.append(menu);
  return { menu, nativeRename, foreignMod };
}

async function flushMicrotasks(n = 6) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("pure: agendaRootMenuModel returns all 4 commands in English and Polish", () => {
    assert.deepEqual(C.AGENDA_ROOT_MENU_COMMANDS, ["open-calendar", "refresh-agenda", "agenda-settings", "hide-agenda"]);
    const en = C.agendaRootMenuModel({ lang: "en" });
    const pl = C.agendaRootMenuModel({ lang: "pl" });
    assert.deepEqual(en.map((x) => x.id), ["open-calendar", "refresh-agenda", "agenda-settings", "hide-agenda"]);
    assert.deepEqual(en.map((x) => x.label), [
      enTable.strings["sidebar.agenda.root.openCalendar"],
      enTable.strings["sidebar.agenda.root.refresh"],
      enTable.strings["sidebar.agenda.root.settings"],
      enTable.strings["sidebar.agenda.root.hide"],
    ]);
    assert.deepEqual(pl.map((x) => x.label), [
      plTable.strings["sidebar.agenda.root.openCalendar"],
      plTable.strings["sidebar.agenda.root.refresh"],
      plTable.strings["sidebar.agenda.root.settings"],
      plTable.strings["sidebar.agenda.root.hide"],
    ]);
  });

  await test("Agenda root menu populates all 4 owned items, keeps foreign mod items, and cleans up for ordinary folders", async () => {
    const h = await createHost();
    h.seam.store.items.upsert(makeItem("meeting", date(1), date(1, 13)));
    h.seam.agendaController.runNow();
    const agendaRoot = rootEl(h);
    assert.ok(agendaRoot, "Agenda root exists");

    const { menu, foreignMod } = makeFolderMenu(h);
    menu.triggerNode = agendaRoot;
    h.emit("popupshowing", menu);

    assert.equal(h.document.documentElement.getAttribute("zentral-agenda-folder-ctx"), "true");
    const ownItems = [...menu.querySelectorAll("[zentral-agenda-folder-own]")];
    assert.deepEqual(
      ownItems.map((el) => [el.getAttribute("zentral-agenda-folder-own"), el.getAttribute("label")]),
      [
        ["root:open-calendar", "Open calendar"],
        ["root:refresh-agenda", "Refresh Agenda"],
        ["root:agenda-settings", "Agenda settings"],
        ["root:hide-agenda", "Hide Agenda"],
      ],
    );
    assert.ok(menu.contains(foreignMod), "foreign mod menu item remains intact inside #zenFolderActions");
    assert.equal(foreignMod.hidden, false);

    // Closing clears context attribute; opening on a non-Agenda folder removes owned items and does not set context attr
    h.emit("popuphidden", menu);
    assert.equal(h.document.documentElement.hasAttribute("zentral-agenda-folder-ctx"), false);
    const foreignFolder = h.document.createXULElement("zen-folder");
    foreignFolder.id = "ordinary-user-folder";
    h.sidebar.pinned.append(foreignFolder);
    menu.triggerNode = foreignFolder;
    h.emit("popupshowing", menu);
    assert.equal(h.document.documentElement.hasAttribute("zentral-agenda-folder-ctx"), false);
    assert.equal(menu.querySelectorAll("[zentral-agenda-folder-own]").length, 0);
    assert.ok(menu.contains(foreignMod), "foreign mod item still intact");

    // Polish localization on Agenda root right-click
    h.setPref(LANG_PREF, "pl");
    menu.triggerNode = agendaRoot;
    h.emit("popupshowing", menu);
    const plLabels = [...menu.querySelectorAll("[zentral-agenda-folder-own]")].map((el) => el.getAttribute("label"));
    assert.deepEqual(plLabels, [
      plTable.strings["sidebar.agenda.root.openCalendar"],
      plTable.strings["sidebar.agenda.root.refresh"],
      plTable.strings["sidebar.agenda.root.settings"],
      plTable.strings["sidebar.agenda.root.hide"],
    ]);
    h.emit("popuphidden", menu);
    await h.destroy();
  });

  await test("Open calendar, Refresh Agenda, Agenda settings, and Hide Agenda execute cleanly", async () => {
    const h = await createHost();
    h.seam.store.items.upsert(makeItem("first", date(1), date(1, 13)));
    h.seam.agendaController.runNow();
    const agendaRoot = rootEl(h);
    const { menu } = makeFolderMenu(h);
    const triggerCommand = (cmdId) => {
      menu.triggerNode = agendaRoot;
      h.emit("popupshowing", menu);
      const item = menu.querySelector(`[zentral-agenda-folder-own="root:${cmdId}"]`);
      assert.ok(item, `menu item ${cmdId} exists`);
      item.dispatchEvent(new h.Ev("command", { bubbles: true }));
      h.emit("popuphidden", menu);
    };

    // 1. Open calendar opens Notes directly to the Calendar pane (preserving current view, e.g. Month)
    triggerCommand("open-calendar");
    await flushMicrotasks(10);
    const calPane = h.document.querySelector(".zn-calendar-pane");
    assert.ok(calPane && !calPane.hidden, "Open calendar opens Notes directly with the Calendar pane visible");

    // 2. Agenda settings opens Settings directly on the Zen / Agenda tab
    triggerCommand("agenda-settings");
    await flushMicrotasks(10);
    const dialogCard = h.document.querySelector(".zn-dialog-card");
    assert.ok(dialogCard, "Agenda settings opens Settings dialog");
    const activeTab = [...dialogCard.querySelectorAll(".zn-set-tabs button")].find((b) => b.getAttribute("aria-selected") === "true" || b.classList?.contains("is-on"));
    assert.ok(activeTab && /Zen/i.test(activeTab.textContent), `expected Zen/Agenda tab active, got ${activeTab?.textContent}`);

    // 3. Refresh Agenda immediately reconciles Agenda without waiting for debounce
    h.seam.store.items.upsert(makeItem("second", date(2), date(2, 14)));
    triggerCommand("refresh-agenda");
    await flushMicrotasks(6);
    assert.equal(projected(h).length, 2, "Refresh Agenda immediately reflects newly added item");

    // 4. Hide Agenda switches the pref off and removes the Agenda root cleanly
    const foreignTab = h.window.gBrowser.addTab("https://example.com/");
    agendaRoot.addTabs([foreignTab]);
    triggerCommand("hide-agenda");
    await flushMicrotasks(6);
    assert.equal(h.values.get(AGENDA_PREF), false, "Hide Agenda disables the Agenda folder pref");
    assert.equal(rootEl(h), null, "Agenda root folder is removed");
    assert.ok(h.document.body.contains(foreignTab) || h.sidebar.pinned.contains(foreignTab), "foreign tab inside Agenda root survives Hide Agenda");

    await h.destroy();
  });

  console.log(`\nPASS notes-agenda-root-menu (${passed} tests)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
