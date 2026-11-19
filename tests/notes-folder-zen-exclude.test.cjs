"use strict";
/* T2.11: Exclude folders from the Zen NOTES sidebar (per-folder meta.json switch,
 * child inheritance with explicit override, tree & Zen folder context menus,
 * while keeping notes visible in All notes, search, calendar/Agenda, and wiki links). */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const ZEN_MODE = "zen.workspace.zentral.notes.zen_folder";
const AGENDA_PREF = "zen.workspace.zentral.notes.agenda_folder";
const LANG_PREF = "zen.workspace.zentral.notes.language";
const NOTES_ATTR = "bgalazka-notes-item";

const date = (days, hour = 12) => C.addDays(C.dayStart(Date.now()), days) + hour * 3600000;
const makeItem = (id, noteId, start, end) => C.makeItem({
  id,
  summary: id,
  start: { dateTime: new Date(start).toISOString() },
  ...(end ? { end: { dateTime: new Date(end).toISOString() } } : {}),
  x: { kind: end ? "event" : "reminder", src: "manual", noteId },
}, Date.now());

async function createHost(options = {}) {
  const h = createFakeZen({ ...options, prefs: { [ZEN_MODE]: "all", ...options.prefs } });
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await Promise.resolve();
  return h;
}

async function flushMicrotasks(n = 8) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}
async function flushUi(h) {
  await flushMicrotasks(6);
  for (let i = 0; i < 8; i++) {
    if (!h.fireTimer(16) && !h.fireTimer(0)) break;
    await flushMicrotasks(4);
  }
}

const zenNoteTabs = (h) => h.document.querySelectorAll(`tab[${NOTES_ATTR}]`);
const zenSubfolders = (h) => h.document.querySelectorAll("zen-folder[bgalazka-notes-subfolder]");
const zenRoot = (h) => h.document.querySelector('zen-folder[bgalazka-notes-folder="true"]');

const J = (v) => JSON.parse(JSON.stringify(v));

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("pure: cleanFolderZenSidebar, resolveFolderZenSidebar, folderZenSidebarMenuAction, cleanFolders & mergeFolders", async () => {
    const h = await createHost();
    const core = h.window.__zentralNotesTestSeam.core;

    assert.equal(core.cleanFolderZenSidebar("hide"), "hide");
    assert.equal(core.cleanFolderZenSidebar("show"), "show");
    assert.equal(core.cleanFolderZenSidebar(""), "");
    assert.equal(core.cleanFolderZenSidebar("invalid"), "");
    assert.equal(core.cleanFolderZenSidebar(true), "");

    const folders = core.cleanFolders([
      { id: "work", label: "Work", uid: "uidwork1", zenSidebar: "hide" },
      { id: "work/clients", label: "Clients", uid: "uidcli01" },
      { id: "work/public", label: "Public", uid: "uidpub01", zenSidebar: "show" },
      { id: "work/public/docs", label: "Docs", uid: "uiddoc01" },
      { id: "work/public/secret", label: "Secret", uid: "uidsec01", zenSidebar: "hide" },
      { id: "personal", label: "Personal", uid: "uidper01", zenSidebar: "bogus" },
    ]);
    assert.equal(folders.find((f) => f.id === "work").zenSidebar, "hide");
    assert.equal(folders.find((f) => f.id === "work/public").zenSidebar, "show");
    assert.equal("zenSidebar" in folders.find((f) => f.id === "personal"), false, "invalid/default zenSidebar is omitted from meta.json");

    // Inheritance resolution across 3 nesting levels
    assert.deepEqual(J(core.resolveFolderZenSidebar("personal", folders)), { own: "", hidden: false, inherited: false, inheritedHidden: false, inheritedFrom: "" });
    assert.deepEqual(J(core.resolveFolderZenSidebar("work", folders)), { own: "hide", hidden: true, inherited: false, inheritedHidden: false, inheritedFrom: "" });
    assert.deepEqual(J(core.resolveFolderZenSidebar("work/clients", folders)), { own: "", hidden: true, inherited: true, inheritedHidden: true, inheritedFrom: "work" });
    assert.deepEqual(J(core.resolveFolderZenSidebar("work/public", folders)), { own: "show", hidden: false, inherited: false, inheritedHidden: true, inheritedFrom: "work" });
    assert.deepEqual(J(core.resolveFolderZenSidebar("work/public/docs", folders)), { own: "", hidden: false, inherited: true, inheritedHidden: false, inheritedFrom: "work/public" });
    assert.deepEqual(J(core.resolveFolderZenSidebar("work/public/secret", folders)), { own: "hide", hidden: true, inherited: false, inheritedHidden: false, inheritedFrom: "work/public" });

    // Menu action state machine guarantees one-click toggle without stale overrides
    const aPersonal = core.folderZenSidebarMenuAction("personal", folders);
    assert.equal(aPersonal.nextValue, "hide");
    assert.equal(aPersonal.labelKey, "tree.folder.hideFromZen");

    const aWork = core.folderZenSidebarMenuAction("work", folders);
    assert.equal(aWork.nextValue, "");
    assert.equal(aWork.labelKey, "tree.folder.showInZen");

    const aClients = core.folderZenSidebarMenuAction("work/clients", folders);
    assert.equal(aClients.nextValue, "show");
    assert.equal(aClients.labelKey, "tree.folder.overrideShowInZen");

    const aPublic = core.folderZenSidebarMenuAction("work/public", folders);
    assert.equal(aPublic.nextValue, "");
    assert.equal(aPublic.labelKey, "tree.folder.inheritHideFromZen");

    // Explicit hide under hidden parent must switch to "show" so clicking Show actually makes it visible
    const bothHidden = [...folders, { id: "work/double", label: "Double", uid: "uiddbl01", zenSidebar: "hide" }];
    const aDouble = core.folderZenSidebarMenuAction("work/double", bothHidden);
    assert.equal(aDouble.nextValue, "show");
    assert.equal(aDouble.labelKey, "tree.folder.showInZen");

    // 3-way mergeFolders preserves zenSidebar edited in window A alongside rename in window B
    const base = [{ id: "work", label: "Work", uid: "uidwork1", order: 0, collapsed: false }];
    const mine = [{ id: "work", label: "Work", uid: "uidwork1", order: 0, collapsed: false, zenSidebar: "hide" }];
    const theirs = [{ id: "work", label: "Work Renamed", uid: "uidwork1", order: 0, collapsed: false }];
    const merged = core.mergeFolders(base, mine, theirs);
    assert.equal(merged[0].label, "Work Renamed");
    assert.equal(merged[0].zenSidebar, "hide");

    await h.destroy();
  });

  await test("pure projection: projectZen (all & selected) and projectNotesFolder honour exclusion and child overrides", async () => {
    const h = await createHost();
    const core = h.window.__zentralNotesTestSeam.core;

    const folders = [
      { id: "work", label: "Work", uid: "u-work", order: 0, collapsed: false, zenSidebar: "hide" },
      { id: "work/clients", label: "Clients", uid: "u-clients", order: 0, collapsed: false },
      { id: "work/public", label: "Public", uid: "u-public", order: 1, collapsed: false, zenSidebar: "show" },
      { id: "work/public/docs", label: "Docs", uid: "u-docs", order: 0, collapsed: false },
      { id: "work/public/secret", label: "Secret", uid: "u-secret", order: 1, collapsed: false, zenSidebar: "hide" },
      { id: "inbox", label: "Inbox", uid: "u-inbox", order: 1, collapsed: false },
    ];
    const notes = [
      { id: "n-root", body: "# Root Note", folder: "", updated: 10 },
      { id: "n-work", body: "# Work Direct", folder: "work", updated: 9 },
      { id: "n-client", body: "# Client Note", folder: "work/clients", updated: 8 },
      { id: "n-public", body: "# Public Note", folder: "work/public", updated: 7 },
      { id: "n-docs", body: "# Public Doc", folder: "work/public/docs", updated: 6 },
      { id: "n-secret", body: "# Secret Note", folder: "work/public/secret", updated: 5 },
      { id: "n-inbox", body: "# Inbox Note", folder: "inbox", updated: 4 },
    ];

    const zenAll = core.projectZen(notes, folders, "all", "folders-first");
    const ids = zenAll.map((e) => e.id);
    assert.ok(!ids.includes("work"), "hidden parent folder omitted");
    assert.ok(!ids.includes("n-work"), "note directly inside hidden parent omitted");
    assert.ok(!ids.includes("work/clients"), "inheriting child folder omitted");
    assert.ok(!ids.includes("n-client"), "note inside inheriting child omitted");
    assert.ok(!ids.includes("work/public/secret"), "re-hidden grandchild omitted");
    assert.ok(!ids.includes("n-secret"), "note inside re-hidden grandchild omitted");

    assert.ok(ids.includes("work/public"), "explicitly shown child folder overrides hidden parent");
    assert.equal(zenAll.find((e) => e.id === "work/public").parent, "", "overriding child projects under nearest visible ancestor (root)");
    assert.ok(ids.includes("n-public"), "note inside overriding child is projected");
    assert.equal(zenAll.find((e) => e.id === "n-public").parent, "f:u-public");
    assert.ok(ids.includes("work/public/docs"), "grandchild inherits explicit show from parent");
    assert.ok(ids.includes("n-docs"), "note inside inheriting-show grandchild is projected");
    assert.ok(ids.includes("inbox") && ids.includes("n-inbox") && ids.includes("n-root"), "unrelated folders & root notes untouched");

    // Also verify projectNotesFolder matches the same exclusion semantics
    const pnf = core.projectNotesFolder(notes, folders);
    const pnfIds = pnf.map((e) => e.id);
    assert.ok(!pnfIds.includes("work") && !pnfIds.includes("n-work") && !pnfIds.includes("work/clients") && !pnfIds.includes("n-secret"));
    assert.ok(pnfIds.includes("work/public") && pnfIds.includes("n-public") && pnfIds.includes("work/public/docs"));

    // Verify "selected" mode (Only Notes (tabbar)) honours subfolder exclusion and tabbar exclusion + child override
    const tabbarFolders = [
      { id: "tabbar", label: "Notes (tabbar)", uid: "u-tb", order: 0, collapsed: false },
      { id: "tabbar/hidden", label: "Hidden Sub", uid: "u-tbh", order: 0, collapsed: false, zenSidebar: "hide" },
      { id: "tabbar/shown", label: "Shown Sub", uid: "u-tbs", order: 1, collapsed: false },
    ];
    const tabbarNotes = [
      { id: "tb-1", body: "# Direct Tabbar", folder: "tabbar", updated: 5 },
      { id: "tb-h", body: "# Hidden Tabbar", folder: "tabbar/hidden", updated: 4 },
      { id: "tb-s", body: "# Shown Tabbar", folder: "tabbar/shown", updated: 3 },
    ];
    const sel1 = core.projectZen(tabbarNotes, tabbarFolders, "selected").map((e) => e.id);
    assert.ok(sel1.includes("tb-1") && sel1.includes("tabbar/shown") && sel1.includes("tb-s"));
    assert.ok(!sel1.includes("tabbar/hidden") && !sel1.includes("tb-h"));

    // If tabbar itself is hidden, only explicitly "show"-overridden subfolders project
    const tabbarHiddenFolders = [
      { id: "tabbar", label: "Notes (tabbar)", uid: "u-tb", order: 0, collapsed: false, zenSidebar: "hide" },
      { id: "tabbar/shown", label: "Shown Sub", uid: "u-tbs", order: 0, collapsed: false, zenSidebar: "show" },
    ];
    const sel2 = core.projectZen(tabbarNotes, tabbarHiddenFolders, "selected").map((e) => e.id);
    assert.ok(!sel2.includes("tb-1"), "direct tabbar notes hidden when tabbar itself is excluded");
    assert.ok(sel2.includes("tabbar/shown") && sel2.includes("tb-s"), "overridden child under tabbar still projects");

    await h.destroy();
  });

  await test("live Zen sidebar: context menu hides folder, keeps foreign tabs safe, and leaves notes in All notes, search, calendar/Agenda, and wiki links", async () => {
    const h = await createHost({ prefs: { [AGENDA_PREF]: true } });
    const core = h.window.__zentralNotesTestSeam.core;
    const store = h.seam.store;

    const workId = store.addFolder("Work", "");
    const clientsId = store.addFolder("Clients", workId);
    const publicId = store.addFolder("Public", workId);
    const nWork = store.create("# Secret Roadmap\nLinked from [[Home Hub]].", workId);
    const nClient = store.create("# Client Contract", clientsId);
    const nPublic = store.create("# Public FAQ", publicId);
    const nRoot = store.create("# Home Hub\nSee [[Secret Roadmap]] for details.", "");
    store.items.upsert(makeItem("work-reminder", nWork.id, date(1), date(1, 14)));

    h.seam.zen.runNow();
    h.seam.agendaController.runNow();
    assert.equal(zenNoteTabs(h).length, 4, "all 4 notes start projected in Zen NOTES");
    assert.equal(zenSubfolders(h).length, 3, "all 3 subfolders start projected in Zen NOTES");

    // Put a foreign user tab inside Work folder in Zen sidebar to prove hiding NEVER deletes user tabs
    const workMeta = store.meta.folders.find((f) => f.id === workId);
    const workZenEl = zenSubfolders(h).find((el) => el.getAttribute("bgalazka-notes-subfolder") === "f:" + workMeta.uid);
    assert.ok(workZenEl, "Work folder exists in Zen sidebar");
    const foreignTab = h.window.gBrowser.addTab("https://example.org/user-doc");
    workZenEl.addTabs([foreignTab]);

    // Check Zen folder context menu placement: present on Notes subfolder, absent on root NOTES & ordinary folders
    const menu = h.document.createXULElement("menupopup");
    menu.id = "zenFolderActions";
    h.document.body.append(menu);

    // 1. Ordinary folder -> NO zentral-notes-folder-own items
    const ordinaryFolder = h.window.gZenFolders.createFolder([h.window.gBrowser.addTab("https://example.org/other")], { id: "ordinary-1", label: "Ordinary" });
    menu.triggerNode = ordinaryFolder;
    h.emit("popupshowing", menu);
    assert.equal(menu.querySelector('[zentral-notes-folder-own="zen-hide"]'), null, "ordinary folder gets no hide item");
    h.emit("popuphidden", menu);

    // 2. Root NOTES folder -> NO zen-hide item (Settings controls the whole NOTES root)
    menu.triggerNode = zenRoot(h);
    h.emit("popupshowing", menu);
    assert.equal(menu.querySelector('[zentral-notes-folder-own="zen-hide"]'), null, "root NOTES folder gets no per-folder hide item");
    h.emit("popuphidden", menu);

    // 3. Notes subfolder (Work) -> gets 'Hide from Zen sidebar'
    menu.triggerNode = workZenEl;
    h.emit("popupshowing", menu);
    const hideItem = menu.querySelector('[zentral-notes-folder-own="zen-hide"]');
    assert.ok(hideItem, "Notes subfolder menu includes Hide from Zen sidebar");
    assert.equal(hideItem.getAttribute("label"), "Hide from Zen sidebar");
    hideItem.dispatchEvent(new h.Ev("command", { bubbles: true }));
    h.emit("popuphidden", menu);
    await flushMicrotasks(6);
    h.seam.zen.runNow();

    // Verify Work, Clients, Public and their 3 tabs vanished from Zen NOTES, while Home Hub stayed
    assert.equal(zenNoteTabs(h).length, 1, "only root Home Hub note tab remains in Zen NOTES");
    assert.equal(zenSubfolders(h).length, 0, "Work and its inheriting subfolders disappeared from Zen NOTES");
    assert.equal(foreignTab.isConnected, true, "foreign user tab inside hidden Zen folder MUST survive (never deleted)");
    assert.equal(store.meta.folders.find((f) => f.id === workId).zenSidebar, "hide", "exclusion persisted in meta.json");

    // Verify notes in hidden folder remain fully intact in All notes, search, Calendar/Agenda, and wiki links!
    assert.equal(store.list().length, 4, "all 4 notes remain in All notes store");
    const tree = store.tree();
    assert.ok(tree.children.some((f) => f.id === workId), "Work remains in All notes tree");
    assert.ok(store.list().some((n) => n.id === nWork.id && /Secret Roadmap/i.test(n.body)), "hidden-folder note remains searchable");
    const agendaTabs = h.document.querySelectorAll('tab[bgalazka-notes-agenda-item]').filter((t) => !t.getAttribute("bgalazka-notes-agenda-item").startsWith("seed:"));
    assert.equal(agendaTabs.length, 1, "reminder linked to note in hidden folder stays visible in Zen Agenda");
    assert.equal(core.resolveWikiTarget(store.list(), store.meta.folders, core.parseWikiTarget("Secret Roadmap"))?.id, nWork.id, "wiki link still resolves to note in hidden folder");
    assert.equal(core.findBacklinks(store.list(), nWork, store.meta.folders).linked.length, 1, "backlinks to note in hidden folder remain intact");

    await h.destroy();
  });

  await test("Sheet All notes tree UI: badges, parent hide, child override, clear override, and Polish labels", async () => {
    const h = await createHost();
    const store = h.seam.store;

    const workId = store.addFolder("Work", "");
    const publicId = store.addFolder("Public", workId);
    store.create("# Work Note", workId);
    store.create("# Public Note", publicId);
    h.seam.zen.runNow();

    // Open real Notes sheet via Zen tab context menu -> Open note
    const tabMenu = h.document.createXULElement("menupopup");
    tabMenu.id = "tabContextMenu";
    h.document.body.append(tabMenu);
    h.window.TabContextMenu = { contextTab: zenNoteTabs(h)[0] };
    h.emit("popupshowing", tabMenu);
    const openItem = tabMenu.querySelector('[zentral-notes-own="open"]');
    assert.ok(openItem, "Open note item present on Zen note tab menu");
    openItem.dispatchEvent(new h.Ev("command", { bubbles: true }));
    h.emit("popuphidden", tabMenu);
    await flushMicrotasks(10);
    const sheetEl = h.document.querySelector(".zentral-notes-sheet");
    assert.ok(sheetEl, "Notes sheet mounted");
    sheetEl.ownerDocument = h.document;
    // Switch to All notes view so folder tree renders
    const allBtn = [...h.document.querySelectorAll(".zentral-notes-sheet button")].find((b) => /All notes/i.test(b.getAttribute("title") || b.getAttribute("aria-label") || b.textContent || ""));
    assert.ok(allBtn, "All notes button found in Notes sheet");
    allBtn.dispatchEvent(new h.Ev("click", { bubbles: true }));
    await flushMicrotasks(8);

    const openFolderMenu = (fid) => {
      const row = h.document.querySelector(`.zn-frow[data-fid="${fid}"]`);
      assert.ok(row, `tree row for folder ${fid} rendered`);
      const more = row.querySelector(".zn-fmore");
      assert.ok(more, `more button on folder ${fid}`);
      more.dispatchEvent(new h.Ev("click", { bubbles: true }));
      const menu = h.document.querySelector(".zn-menu");
      assert.ok(menu, "folder context menu opened");
      return { row, menu };
    };
    const clickMenuLabel = (menu, re) => {
      const btn = [...menu.querySelectorAll("button")].find((b) => re.test(b.textContent));
      assert.ok(btn, `menu item matching ${re} found (got: ${[...menu.querySelectorAll("button")].map((b) => b.textContent).join(" | ")})`);
      btn.dispatchEvent(new h.Ev("click", { bubbles: true }));
    };

    // 1. Hide Work from All notes tree menu
    const { menu: m1 } = openFolderMenu(workId);
    clickMenuLabel(m1, /^Hide from Zen sidebar$/);
    await flushUi(h);
    h.seam.zen.runNow();

    const workRowHidden = h.document.querySelector(`.zn-frow[data-fid="${workId}"]`);
    const pubRowInherited = h.document.querySelector(`.zn-frow[data-fid="${publicId}"]`);
    assert.equal(workRowHidden.getAttribute("data-zen-hidden"), "true", "Work row marked hidden");
    assert.ok(workRowHidden.querySelector(".zn-frow-zen-badge"), "Work row displays hidden badge");
    assert.equal(pubRowInherited.getAttribute("data-zen-hidden"), "true", "Public child marked hidden via inheritance");
    assert.equal(pubRowInherited.getAttribute("data-zen-hidden-inherited"), "true", "Public child marked inherited");
    assert.ok(pubRowInherited.querySelector(".zn-frow-zen-badge.is-inherited"), "Public child displays inherited dashed badge");
    assert.equal(zenNoteTabs(h).length, 0, "both tabs hidden in Zen NOTES");

    // 2. Override Public child -> Show in Zen sidebar (override parent)
    const { menu: m2 } = openFolderMenu(publicId);
    clickMenuLabel(m2, /^Show in Zen sidebar \(override parent\)$/);
    await flushUi(h);
    h.seam.zen.runNow();

    const pubRowOverridden = h.document.querySelector(`.zn-frow[data-fid="${publicId}"]`);
    assert.equal(pubRowOverridden.getAttribute("data-zen-hidden"), null, "overridden Public child no longer hidden");
    assert.equal(pubRowOverridden.getAttribute("data-zen-override"), "show", "overridden Public child marked data-zen-override=show");
    assert.equal(zenNoteTabs(h).length, 1, "Public note now projects into Zen NOTES while Work note stays hidden");
    assert.equal(zenSubfolders(h).length, 1, "Public folder projects under Zen NOTES root");

    // 3. Clear Public override -> Hide from Zen sidebar (inherit parent)
    const { menu: m3 } = openFolderMenu(publicId);
    clickMenuLabel(m3, /^Hide from Zen sidebar \(inherit parent\)$/);
    await flushUi(h);
    h.seam.zen.runNow();

    assert.equal("zenSidebar" in store.meta.folders.find((f) => f.id === publicId), false, "clearing override removes redundant zenSidebar field from meta.json");
    assert.equal(zenNoteTabs(h).length, 0, "Public inherits parent exclusion again");

    // 4. Switch language to Polish and verify Polish badge & menu label
    h.setPref(LANG_PREF, "pl");
    await flushUi(h);
    const workRowPl = h.document.querySelector(`.zn-frow[data-fid="${workId}"]`);
    assert.equal(workRowPl.querySelector(".zn-frow-zen-badge")?.textContent, "Bez paska", "Polish hidden badge rendered");
    const { menu: m4 } = openFolderMenu(workId);
    clickMenuLabel(m4, /^Pokaż na pasku bocznym Zen$/);
    await flushUi(h);
    h.seam.zen.runNow();

    assert.equal("zenSidebar" in store.meta.folders.find((f) => f.id === workId), false, "re-showing clears zenSidebar from meta.json");
    assert.equal(zenNoteTabs(h).length, 2, "both notes restored in Zen NOTES");

    await h.destroy();
  });

  console.log(`\nPASS notes-folder-zen-exclude (${passed} tests)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
