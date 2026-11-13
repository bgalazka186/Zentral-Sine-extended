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
  await test("fan-out exposes H1.1 key collision and structural churn rather than concealing it", async () => {
    for (const item of [make("overnight", date(1, 23), date(2, 1)), make("lead", date(2), null, { agendaWindow: { leadDays: 1 } })]) {
      const h = await host(); h.seam.store.items.upsert(item);
      const projection = h.seam.agendaController.runNow();
      const copies = projection.flatMap((day) => day.items).filter((entry) => entry.itemId === item.id);
      assert.equal(copies.length, 2); assert.equal(new Set(copies.map((entry) => entry.key)).size, 1, "H1.1: projected copies share a key");
      h.resetOperations(); h.seam.agendaController.runNow();
      assert.ok(h.operations.some((op) => op.type === "remove" || op.type === "move"), "H1.1: unchanged fan-out is not yet idempotent");
      await h.destroy();
    }
  });
  // The acceptance gate is deliberately visible as TODO until H1.1 is fixed.
  // node:test reports the failing assertion without turning the known bug into a false pass.
  for (const item of [make("gate-overnight", date(1, 23), date(2, 1)), make("gate-lead", date(2), null, { agendaWindow: { leadDays: 1 } })]) {
    require("node:test").test(`F0.1 idempotence gate: ${item.id}`, { todo: "H1.1 duplicate keys cause churn" }, async () => {
      const h = await host();
      try {
        h.seam.store.items.upsert(item); h.seam.agendaController.runNow();
        h.resetOperations(); h.seam.agendaController.runNow();
        assert.equal(h.operations.length, 0, "unchanged projection must perform zero structural operations");
      } finally { await h.destroy(); }
    });
  }
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
