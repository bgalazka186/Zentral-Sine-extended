"use strict";
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const AGENDA = "zen.workspace.zentral.notes.agenda_folder";
const ZEN_MODE = "zen.workspace.zentral.notes.zen_folder";
const MARK = "bgalazka-notes-agenda-item";
const date = (days, hour = 12) => C.addDays(C.dayStart(Date.now()), days) + hour * 3600000;
const make = (id, start, end, x = {}) => C.makeItem({ id, summary: id, start: { dateTime: new Date(start).toISOString() }, ...(end ? { end: { dateTime: new Date(end).toISOString() } } : {}), x: { kind: end ? "event" : "reminder", src: "manual", ...x } }, Date.now());
const projected = (host) => host.document.querySelectorAll(`tab[${MARK}]`).filter((tab) => !tab.getAttribute(MARK).startsWith("seed:"));
const root = (host) => host.document.querySelector('zen-folder[bgalazka-notes-agenda-folder="true"]');
const dayFolder = (host) => host.document.querySelector("zen-folder[bgalazka-notes-agenda-day]");
async function host(options = {}) {
  const h = createFakeZen({ ...options, prefs: { [AGENDA]: true, ...options.prefs } });
  assert.ok(h.seam?.agendaApi && h.seam.agendaController && h.seam.zenApi && h.seam.store);
  await h.seam.ensureStore();
  h.fireTimer(6500); // attach real production event listeners, without opening a sheet
  await Promise.resolve();
  return h;
}
async function test(name, fn) { await fn(); console.log("ok - " + name); }
(async () => {
  await test("real coordinator creates a single-day tab and is structurally idempotent", async () => {
    const h = await host();
    h.seam.store.items.upsert(make("single", date(1), date(1, 13)));
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 1);
    assert.ok(h.operations.some((op) => op.type === "add") && h.events.some((ev) => ev.type === "TabPinned"));
    h.resetOperations(); h.seam.agendaController.runNow();
    assert.deepEqual(h.operations, []);
    await h.destroy(); assert.equal(h.seam, undefined);
  });
  await test("fan-out keys are globally unique and all copies stay idempotent", async () => {
    const allDay = C.makeItem({ id: "all-day", summary: "all-day", start: { date: C.localDateKey(date(1)) }, end: { date: C.localDateKey(date(4)) }, x: { kind: "event", src: "manual" } });
    for (const [item, count] of [[make("overnight", date(1, 23), date(2, 1)), 2], [make("lead", date(2), null, { agendaWindow: { leadDays: 2 } }), 3], [allDay, 3]]) {
      const h = await host(); h.seam.store.items.upsert(item);
      const projection = h.seam.agendaController.runNow();
      const copies = projection.flatMap((day) => day.items).filter((entry) => entry.itemId === item.id);
      assert.equal(copies.length, count); assert.equal(new Set(copies.map((entry) => entry.key)).size, count);
      assert.equal(projected(h).length, count);
      for (const tab of projected(h)) {
        assert.equal(tab.getAttribute("bgalazka-notes-agenda-item-id"), item.id);
        assert.ok(tab.getAttribute(MARK).endsWith("@" + tab.closest("zen-folder").getAttribute("bgalazka-notes-agenda-day")));
      }
      for (let run = 0; run < 2; run++) { h.resetOperations(); h.seam.agendaController.runNow(); assert.deepEqual(h.operations, []); }
      await h.destroy();
    }
  });
  await test("real parent is used to repair a tab moved into the wrong day", async () => {
    const h = await host(); h.seam.store.items.upsert(make("move", date(1, 23), date(2, 1))); h.seam.agendaController.runNow();
    const tab = projected(h)[0], expected = tab.closest("zen-folder"), other = projected(h)[1].closest("zen-folder");
    other.addTabs([tab]);
    const listed = h.seam.agendaApi.list().find((entry) => entry.key === tab.getAttribute(MARK));
    assert.equal(listed.parent, "day:" + other.getAttribute("bgalazka-notes-agenda-day"));
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 2); assert.ok(expected.querySelector(`tab[${MARK}]`));
    h.resetOperations(); h.seam.agendaController.runNow(); assert.deepEqual(h.operations, []); await h.destroy();
  });
  await test("old undated keys migrate without touching foreign tabs", async () => {
    const h = await host(); h.seam.store.items.upsert(make("migrate", date(1), date(1, 13))); h.seam.agendaController.runNow();
    const old = projected(h)[0]; old.setAttribute(MARK, old.getAttribute(MARK).replace(/@\d{4}-\d{2}-\d{2}$/, ""));
    const foreign = h.window.gBrowser.addTab("https://example.test/"); dayFolder(h).addTabs([foreign]);
    h.seam.agendaController.runNow(); assert.equal(old.isConnected, false); assert.equal(foreign.isConnected, true);
    assert.match(projected(h)[0].getAttribute(MARK), /@\d{4}-\d{2}-\d{2}$/);
    h.resetOperations(); h.seam.agendaController.runNow(); assert.deepEqual(h.operations, []); await h.destroy();
  });
  await test("root positioning next to NOTES does not create repeat DOM moves", async () => {
    const h = await host({ prefs: { [ZEN_MODE]: "all" } }); h.seam.store.create("Note"); h.seam.zen.runNow();
    h.seam.store.items.upsert(make("both", date(1), date(1, 13))); h.seam.agendaController.runNow();
    h.resetOperations(); h.seam.agendaController.runNow(); assert.deepEqual(h.operations, []); await h.destroy();
  });
  await test("events caused by reconciliation do not schedule another run", async () => {
    const h = await host(); h.seam.store.items.upsert(make("event-loop", date(1), date(1, 13)));
    assert.equal(h.fireTimer(250), true); assert.ok(h.events.some((ev) => ev.type === "TabMove"));
    assert.equal([...h.timers.values()].some((timer) => timer.ms === 400), false); await h.destroy();
  });
  await test("foreign tabs survive disable; dragged-out virtual tabs are cleaned and rebuilt", async () => {
    const h = await host(); h.seam.store.items.upsert(make("event", date(1), date(1, 13))); h.seam.agendaController.runNow();
    const foreign = h.window.gBrowser.addTab("https://example.test/"); dayFolder(h).addTabs([foreign]);
    const tab = projected(h)[0]; h.sidebar.pinned.append(tab); h.emit("TabMove", tab);
    h.seam.agendaController.runNow();
    assert.equal(tab.isConnected, false); assert.equal(projected(h).length, 1); assert.equal(foreign.isConnected, true);
    h.window.gBrowser.removeTab(projected(h)[0]); h.emit("SSTabRestored", foreign); h.emit("TabAttrModified", foreign); h.emit("TabSelect", foreign);
    h.window.gBrowser.pinTab(foreign);
    h.setPref(AGENDA, false); h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 0); assert.equal(foreign.isConnected, true);
    h.setPref(AGENDA, true); h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 1); assert.equal(foreign.isConnected, true);
    await h.destroy();
  });
  await test("stale restored seeds are removed; empty-folder fallback keeps labelled seeds", async () => {
    const h = await host(); h.seam.store.items.upsert(make("seed", date(1), date(1, 13))); h.seam.agendaController.runNow();
    const stale = h.window.gBrowser.addTab("about:blank#zn-agenda-seed%3Aroot"); stale.setAttribute(MARK, "seed:root"); root(h).addTabs([stale]);
    h.emit("SSTabRestored", stale); h.seam.agendaController.runNow(); assert.equal(stale.isConnected, false);
    await h.destroy();
    const fallback = await host({ deleteEmptyFolders: true }); fallback.seam.store.items.upsert(make("fallback", date(1), date(1, 13))); fallback.seam.agendaController.runNow();
    const seeds = fallback.document.querySelectorAll(`tab[${MARK}]`).filter((tab) => tab.getAttribute(MARK).startsWith("seed:"));
    assert.equal(seeds.length, 2); assert.ok(seeds.every((seed) => seed.getAttribute("bgalazka-notes-agenda-fallback-seed") === "true"));
    fallback.resetOperations(); fallback.seam.agendaController.runNow(); assert.deepEqual(fallback.operations, []);
    await fallback.destroy();
  });
  await test("restored duplicate Agenda roots are retired without losing foreign contents", async () => {
    const h = await host(); h.seam.store.items.upsert(make("duplicate-root", date(1))); h.seam.agendaController.runNow();
    const canonical = root(h), dup = h.sidebar.folder("Agenda", { id: "old-agenda-copy", attrs: { "bgalazka-notes-agenda-folder": "true" } });
    const foreign = h.window.gBrowser.addTab("https://example.test/foreign"); dup.addTab(foreign);
    const nested = h.sidebar.folder("Personal", { parent: dup.querySelector(":scope > .tab-group-container") });
    const nestedTab = h.window.gBrowser.addTab("https://example.test/nested"); nested.addTab(nestedTab);
    h.seam.agendaController.runNow();
    assert.equal(h.document.querySelectorAll('zen-folder[bgalazka-notes-agenda-folder="true"]').length, 1, "one managed root");
    assert.ok(canonical.isConnected); assert.ok(foreign.isConnected && nested.isConnected && nestedTab.isConnected, "foreign tabs and folders survive");
    assert.ok(!dup.isConnected && !canonical.contains(foreign) && nested.contains(nestedTab), "foreign contents move out intact before retiring the duplicate");
    h.resetOperations(); h.seam.agendaController.runNow(); assert.deepEqual(h.operations, [], "deduplicated root is idempotent");
    h.seam.store.items.remove("duplicate-root"); h.seam.agendaController.runNow();
    h.seam.store.items.upsert(make("return", date(1))); h.seam.agendaController.runNow();
    assert.equal(h.document.querySelectorAll('zen-folder[bgalazka-notes-agenda-folder="true"]').length, 1, "empty then repopulated creates just one root");
    assert.ok(foreign.isConnected && nested.isConnected && nestedTab.isConnected); await h.destroy();
  });
  await test("restored empty roots with duplicate stable ids are reclaimed before projection", async () => {
    const h = await host(); h.seam.store.items.upsert(make("restore", date(1))); h.seam.agendaController.runNow();
    const first = root(h), duplicate = h.sidebar.folder("Agenda", { id: first.id });
    h.seam.agendaController.runNow();
    assert.equal(h.document.querySelectorAll("zen-folder").filter((f) => f.id === first.id).length, 1);
    assert.equal(duplicate.isConnected, false); h.resetOperations(); h.seam.agendaController.runNow(); assert.deepEqual(h.operations, []); await h.destroy();
  });
  await test("disabling removes all managed restored roots, never ordinary folders", async () => {
    const h = await host(); h.seam.store.items.upsert(make("disable-dupes", date(1))); h.seam.agendaController.runNow();
    const dup = h.sidebar.folder("Agenda", { id: "restored-second", attrs: { "bgalazka-notes-agenda-folder": "true" } });
    const ordinary = h.sidebar.folder("Agenda", { id: "user-owned" });
    const foreign = h.window.gBrowser.addTab("https://example.test/"); dup.addTab(foreign);
    const restored = h.window.gBrowser.addTab("about:blank#zn-agenda-seed%3Aroot"); dup.addTab(restored);
    h.setPref(AGENDA, false); h.seam.agendaController.runNow();
    assert.equal(h.document.querySelectorAll('zen-folder[bgalazka-notes-agenda-folder="true"]').length, 0);
    assert.ok(foreign.isConnected && ordinary.isConnected, "ordinary Agenda-labelled folders are not ours");
    assert.equal(restored.isConnected, false, "unmarked restored pseudo-tabs are retired, not treated as foreign");
    h.setPref(AGENDA, true); h.seam.agendaController.runNow();
    assert.equal(h.document.querySelectorAll('zen-folder[bgalazka-notes-agenda-folder="true"]').length, 1); await h.destroy();
  });
  await test("an immovable foreign folder is never destroyed when duplicate cleanup fails", async () => {
    const h = await host({ deleteEmptyFolders: true }); h.seam.store.items.upsert(make("protected-duplicate", date(1))); h.seam.agendaController.runNow();
    const dup = h.sidebar.folder("Agenda", { id: "immovable", attrs: { "bgalazka-notes-agenda-folder": "true" } });
    const nested = h.sidebar.folder("User folder", { parent: dup.querySelector(":scope > .tab-group-container") });
    const managed = h.window.gBrowser.addTab("about:blank#zn-agenda-seed%3Aroot"); managed.setAttribute(MARK, "seed:root"); dup.addTab(managed);
    const originalInsert = h.sidebar.pinned.insertBefore;
    h.sidebar.pinned.insertBefore = function(node, before) { if (node === nested) throw Error("native move unavailable"); return originalInsert.call(this, node, before); };
    h.seam.agendaController.runNow(); assert.ok(nested.isConnected, "foreign folder survives failed relocation");
    h.setPref(AGENDA, false); h.seam.agendaController.runNow(); assert.ok(nested.isConnected, "disable does not delete trapped user content");
    h.sidebar.pinned.insertBefore = originalInsert; h.seam.agendaController.runNow();
    assert.ok(nested.isConnected && !dup.isConnected, "cleanup retries after relocation becomes available"); await h.destroy();
  });
  await test("Agenda folder and tab menus use the real host handlers", async () => {
    const h = await host(); h.seam.store.items.upsert(make("menu", date(1), date(1, 13))); h.seam.agendaController.runNow();
    const folderMenu = h.document.createXULElement("menupopup"); folderMenu.id = "zenFolderActions"; folderMenu.triggerNode = dayFolder(h); h.document.body.append(folderMenu);
    h.emit("popupshowing", folderMenu); assert.equal(folderMenu.querySelectorAll("[zentral-agenda-folder-own]").length, 3);
    h.emit("popuphidden", folderMenu); assert.equal(h.document.documentElement.hasAttribute("zentral-agenda-folder-ctx"), false);
    const tabMenu = h.document.createXULElement("menupopup"); tabMenu.id = "tabContextMenu"; h.document.body.append(tabMenu);
    h.window.TabContextMenu = { contextTab: projected(h)[0] }; h.emit("popupshowing", tabMenu);
    assert.ok(tabMenu.querySelectorAll("[zentral-agenda-own]").length); h.emit("popuphidden", tabMenu);
    await h.destroy();
  });
  await test("two independent windows reconcile separately and preserve each other's DOM", async () => {
    const files = new Map(), a = await host({ id: "a", files });
    a.seam.store.items.upsert(make("shared", date(1), date(1, 13)));
    await a.seam.store.items.flush(); a.seam.agendaController.runNow();
    const b = await host({ id: "b", files }); b.seam.agendaController.runNow();
    assert.equal(projected(a).length, 1); assert.equal(projected(b).length, 1);
    b.resetOperations(); await a.destroy(); assert.equal(projected(b).length, 1); assert.deepEqual(b.operations, []);
    b.seam.agendaController.runNow(); assert.deepEqual(b.operations, []); await b.destroy();
  });
  await test("real Notes projection also creates and retains its own pseudo-tabs", async () => {
    const h = await host({ prefs: { [ZEN_MODE]: "all" } });
    h.seam.store.create("Sidebar note"); h.seam.zen.runNow();
    assert.equal(h.document.querySelectorAll("tab[bgalazka-notes-item]").length, 1);
    h.resetOperations(); h.seam.zen.runNow(); assert.deepEqual(h.operations, []);
    await h.destroy();
  });
})().catch((error) => { console.error(error); process.exitCode = 1; });
