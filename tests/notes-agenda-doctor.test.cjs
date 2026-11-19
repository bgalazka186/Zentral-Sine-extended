"use strict";
/* SB6.5: Agenda Doctor — diagnostics, safe one-click repair, non-destructive safety
 * invariants (foreign tabs, released folders, corrupt/write-blocked history), and Settings UI. */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const AGENDA_PREF = "zen.workspace.zentral.notes.agenda_folder";
const LANG_PREF = "zen.workspace.zentral.notes.language";
const MARK = "bgalazka-notes-agenda-item";
const ROOT_ID = "zentral-notes-agenda";
const HISTORY_PATH = "/profile/zentral-notes/reminder-history.json";

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

async function createHost(options = {}) {
  const h = createFakeZen({ ...options, prefs: { [AGENDA_PREF]: true, ...options.prefs } });
  assert.ok(h.seam?.inspectAgenda && h.seam?.repairAgenda, "sidebar test seam exposes inspectAgenda & repairAgenda");
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await Promise.resolve();
  return h;
}

async function flushMicrotasks(n = 8) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

function makeAgendaPseudoTab(h, key, { label = key, fallbackSeed = false } = {}) {
  const url = "about:blank#zn-agenda-" + encodeURIComponent(key);
  const tab = h.window.gBrowser.addTab(url);
  tab.setAttribute(MARK, key);
  tab.setAttribute("label", label);
  tab.setAttribute("bgalazka-notes-label", label);
  if (fallbackSeed) tab.setAttribute("bgalazka-notes-agenda-fallback-seed", "true");
  tab._zentralNotesUrl = url;
  h.window.gBrowser.pinTab(tab);
  return tab;
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("pure: formatAgendaDoctorBytes, diagnoseAgenda, and planAgendaDoctorRepair classify every category accurately", () => {
    assert.equal(C.formatAgendaDoctorBytes(0), "0 B");
    assert.equal(C.formatAgendaDoctorBytes(512), "512 B");
    assert.equal(C.formatAgendaDoctorBytes(1536), "1.5 KB");
    assert.equal(C.formatAgendaDoctorBytes(2 * 1024 * 1024), "2 MB");
    assert.equal(C.formatAgendaDoctorBytes(2.5 * 1024 * 1024), "2.50 MB");

    const healthy = C.diagnoseAgenda({
      enabled: true,
      roots: [{ id: "root:0", label: "Agenda", canonical: true, foreignCount: 0 }],
      tabs: [
        { id: "t1", key: "item-1@2026-06-10", label: "Standup", insideRoot: true, isSeed: false },
        { id: "t-fb", key: "seed:day:2026-06-11", label: "Agenda items", insideRoot: true, isSeed: true, isFallbackSeed: true, parentId: "day:2026-06-11", parentHasNonSeed: false },
      ],
      foreignTabs: [],
      releasedFolders: [],
      history: { state: "ready", count: 3, bytes: 420, dirty: false, writeBlocked: false, retryCount: 0 },
    });
    assert.equal(healthy.healthy, true);
    assert.equal(healthy.counts.totalIssues, 0);
    assert.equal(healthy.orphanSeeds.length, 0, "valid fallback seed in an empty folder is not an orphan when enabled");
    assert.equal(healthy.history.stateKey, "ready");
    assert.equal(healthy.history.sizeText, "420 B");
    const healthyPlan = C.planAgendaDoctorRepair(healthy);
    assert.equal(healthyPlan.hasSafeRepairs, false);
    assert.equal(healthyPlan.safeCount, 0);

    const broken = C.diagnoseAgenda({
      enabled: true,
      roots: [
        { id: "root:0", label: "Agenda", canonical: true, foreignCount: 1 },
        { id: "root:1", label: "Agenda copy", canonical: false, foreignCount: 0 },
      ],
      tabs: [
        { id: "t-seed", key: "seed:root", label: "Seed", insideRoot: true, isSeed: true, parentId: ROOT_ID },
        { id: "t-fb-extra", key: "seed:day:2026-06-10", label: "Fallback", insideRoot: true, isSeed: true, isFallbackSeed: true, parentId: "day:2026-06-10", parentHasNonSeed: true },
        { id: "t-keep", key: "item-1@2026-06-10", label: "Standup", insideRoot: true, isSeed: false },
        { id: "t-dup-in", key: "item-1@2026-06-10", label: "Standup dup", insideRoot: true, isSeed: false },
        { id: "t-dup-out", key: "item-1@2026-06-10", label: "Standup outside", insideRoot: false, isSeed: false },
        { id: "t-outside", key: "item-2@2026-06-10", label: "Lonely outside", insideRoot: false, isSeed: false },
      ],
      foreignTabs: [{ id: "f1", kind: "tab", label: "User Docs", folderLabel: "Agenda", url: "https://example.org/" }],
      releasedFolders: [{ id: "zentral-released-1", label: "Old Notes", tabCount: 2 }],
      history: { state: "corrupt", count: 0, bytes: 0, dirty: false, writeBlocked: true, retryCount: 2, backupPath: "/profile/zentral-notes/reminder-history.corrupt.json", error: "JSON parse failed" },
    });
    assert.equal(broken.healthy, false);
    assert.equal(broken.orphanSeeds.length, 2);
    assert.equal(broken.duplicateRoots.length, 1);
    assert.equal(broken.duplicateKeys.length, 1);
    assert.equal(broken.duplicateKeys[0].keepId, "t-keep");
    assert.deepEqual(broken.duplicateKeys[0].extraIds, ["t-dup-in", "t-dup-out"]);
    assert.deepEqual(broken.duplicateKeys[0].extraInRootIds, ["t-dup-in"]);
    assert.equal(broken.tabsOutsideRoot.length, 2);
    assert.equal(broken.foreignTabs.length, 1);
    assert.equal(broken.releasedFolders.length, 1);
    assert.equal(broken.history.stateKey, "corrupt");
    assert.equal(broken.history.severity, "error");
    assert.equal(broken.history.writeBlocked, true);

    const plan = C.planAgendaDoctorRepair(broken);
    assert.equal(plan.hasSafeRepairs, true);
    assert.deepEqual(plan.actions.retireDuplicateRoots, ["root:1"]);
    assert.deepEqual(plan.actions.removeOrphanSeeds, ["t-seed", "t-fb-extra"]);
    assert.deepEqual(plan.actions.removeDuplicateTabs, ["t-dup-in"]);
    assert.deepEqual(plan.actions.removeTabsOutsideRoot, ["t-dup-out", "t-outside"]);
    assert.deepEqual(plan.actions.evacuateForeignTabs, ["f1"]);
    assert.equal(plan.safeCount, 7);
    assert.deepEqual(plan.manualOnly.releasedFolders, ["zentral-released-1"]);
    assert.equal(plan.manualOnly.historyBlocked, true);
  });

  await test("live repair: cleans orphan seeds, duplicate keys & roots, tabs outside root, and evacuates foreign tabs without deleting them", async () => {
    const h = await createHost();
    h.seam.store.items.upsert(makeItem("standup", date(1), date(1, 10)));
    h.seam.agendaController.runNow();

    const canonicalRoot = rootEl(h);
    assert.ok(canonicalRoot, "canonical Agenda root created");
    const canonicalTab = projected(h)[0];
    assert.ok(canonicalTab, "canonical Agenda item tab created");
    const canonicalKey = canonicalTab.getAttribute(MARK);
    const dayFolder = canonicalTab.closest("zen-folder");
    assert.ok(dayFolder && dayFolder !== canonicalRoot, "day folder exists inside canonical root");

    // 1. Inject orphan seeds (root + day folder)
    const rootSeed = makeAgendaPseudoTab(h, "seed:root", { label: "Agenda seed" });
    canonicalRoot.addTabs([rootSeed]);
    const daySeed = makeAgendaPseudoTab(h, "seed:day:orphan", { label: "Day seed", fallbackSeed: true });
    dayFolder.addTabs([daySeed]);

    // 2. Inject duplicate Agenda root carrying BOTH a foreign user tab and a duplicate pseudo-tab
    const dupForeign = h.window.gBrowser.addTab("https://example.org/from-dup-root");
    dupForeign.setAttribute("label", "Dup Root User Tab");
    const dupRootAgendaTab = makeAgendaPseudoTab(h, canonicalKey, { label: "Dup root copy" });
    const dupRoot = h.window.gZenFolders.createFolder([dupForeign, dupRootAgendaTab], {
      id: "zentral-notes-agenda-restored-copy",
      label: "Agenda (restored copy)",
    });
    dupRoot.setAttribute("bgalazka-notes-agenda-folder", "true");

    // 3. Inject a duplicate-key pseudo-tab inside canonical root
    const inRootDup = makeAgendaPseudoTab(h, canonicalKey, { label: "In-root duplicate" });
    dayFolder.addTabs([inRootDup]);

    // 4. Inject an Agenda pseudo-tab outside the canonical root
    const outsideTab = makeAgendaPseudoTab(h, "stray-item@2026-06-12", { label: "Stray Outside" });
    h.sidebar.pinned.append(outsideTab);

    // 5. Inject a direct foreign user tab AND a foreign user folder inside canonical Agenda root
    const directForeign = h.window.gBrowser.addTab("https://example.org/direct-user");
    directForeign.setAttribute("label", "Direct User Tab");
    canonicalRoot.addTabs([directForeign]);

    const nestedForeignTab = h.window.gBrowser.addTab("https://example.org/nested-user");
    nestedForeignTab.setAttribute("label", "Nested User Tab");
    const foreignFolder = h.window.gZenFolders.createFolder([nestedForeignTab], {
      id: "user-work-folder",
      label: "User Work",
    });
    canonicalRoot.append(foreignFolder);

    // Inspect MUST be strictly read-only
    h.resetOperations();
    const before = h.seam.inspectAgenda();
    assert.deepEqual(h.operations, [], "inspectAgenda performs zero DOM mutations");
    assert.equal(before.healthy, false);
    assert.equal(before.orphanSeeds.length, 2, "detects both orphan seeds");
    assert.equal(before.duplicateRoots.length, 1, "detects duplicate Agenda root");
    assert.equal(before.duplicateKeys.length, 1, "detects duplicated Agenda key");
    assert.equal(before.duplicateKeys[0].count, 3, "counts all 3 copies of duplicated key");
    assert.ok(before.tabsOutsideRoot.length >= 2, "detects stray outside tab + dup-root tab outside canonical root");
    assert.equal(before.foreignTabs.length, 3, "lists direct foreign tab, foreign folder, and duplicate-root foreign tab");

    // Run one-click safe repair
    const res = h.seam.repairAgenda();
    assert.equal(res.repaired.duplicateRoots, 1, "retired duplicate Agenda root");
    assert.equal(res.repaired.foreignEvacuated, 3, "evacuated all 3 foreign items (dup-root tab, direct tab, foreign folder)");
    assert.equal(res.repaired.orphanSeeds, 2, "removed both orphan seeds");
    assert.ok(res.repaired.duplicateTabs >= 1, "removed duplicate-key pseudo-tabs");
    assert.equal(res.repaired.tabsOutsideRoot, 1, "removed stray Agenda tab outside root");
    assert.equal(res.repaired.reconciled, true, "reconciled Agenda projection after repair");

    // Verify ALL foreign user content survived untouched and outside any Agenda root
    for (const userNode of [dupForeign, directForeign, foreignFolder, nestedForeignTab]) {
      assert.equal(userNode.isConnected, true, `user node ${userNode.getAttribute("label")} MUST remain connected (never deleted)`);
      assert.equal(canonicalRoot.contains(userNode), false, `user node ${userNode.getAttribute("label")} evacuated out of Agenda root`);
    }
    assert.equal(foreignFolder.contains(nestedForeignTab), true, "foreign folder kept its nested user tab intact");
    assert.equal(dupRoot.isConnected, false, "duplicate Agenda root was retired");

    // Post-repair check must be completely healthy with the canonical Agenda item intact
    assert.equal(res.after.healthy, true, "Agenda is completely healthy after repair");
    assert.equal(res.after.counts.totalIssues, 0);
    assert.equal(projected(h).length, 1, "canonical Agenda item tab remains intact");
    assert.equal(projected(h)[0].getAttribute(MARK), canonicalKey);

    await h.destroy();
  });

  await test("safety: released folders are listed but never deleted; immovable foreign tabs are skipped safely", async () => {
    const h = await createHost();
    h.seam.store.items.upsert(makeItem("review", date(1), date(1, 11)));
    h.seam.agendaController.runNow();

    // Add a released folder containing a user tab
    const releasedUserTab = h.window.gBrowser.addTab("https://example.org/released-note-tab");
    releasedUserTab.setAttribute("label", "Saved Tab");
    const releasedFolder = h.window.gZenFolders.createFolder([releasedUserTab], {
      id: "zentral-released-notes-99",
      label: "Released Notes",
    });
    releasedFolder.setAttribute("bgalazka-notes-released", "true");

    // Add a foreign tab inside canonical root and simulate native move failure
    const canonicalRoot = rootEl(h);
    const stuckForeign = h.window.gBrowser.addTab("https://example.org/immovable");
    stuckForeign.setAttribute("label", "Stuck User Tab");
    canonicalRoot.addTabs([stuckForeign]);

    const origInsertBefore = h.sidebar.pinned.insertBefore.bind(h.sidebar.pinned);
    h.sidebar.pinned.insertBefore = (node, before) => {
      if (node === stuckForeign) throw new Error("native move unavailable");
      return origInsertBefore(node, before);
    };

    const report = h.seam.inspectAgenda();
    assert.equal(report.releasedFolders.length, 1, "released folder is reported");
    assert.equal(report.releasedFolders[0].tabCount, 1);
    assert.equal(report.foreignTabs.length, 1, "foreign tab is reported");

    const res = h.seam.repairAgenda();
    assert.equal(releasedFolder.isConnected, true, "released folder is NEVER deleted by repair");
    assert.equal(releasedUserTab.isConnected, true, "tab inside released folder is NEVER deleted");
    assert.equal(stuckForeign.isConnected, true, "immovable foreign tab is NEVER deleted when move fails");
    assert.ok(res.repaired.skipped >= 1, "failed evacuation is counted as skipped");
    assert.equal(res.after.releasedFolders.length, 1, "released folder still listed after repair");

    await h.destroy();
  });

  await test("reminder history: reports live byte size & ready state, and preserves corrupt/write-blocked history without wiping", async () => {
    // Part A: healthy ready history with real records & non-zero size
    const hOk = await createHost();
    hOk.seam.store.items.history.append({
      itemId: "hist-1",
      occurrenceId: "hist-1@2026-06-10",
      action: "done",
      at: Date.now(),
      summary: "Pay invoice",
    });
    hOk.seam.store.items.history.append({
      itemId: "hist-2",
      occurrenceId: "hist-2@2026-06-11",
      action: "dismissed",
      at: Date.now() + 1000,
      summary: "Stretch break",
    });
    await hOk.seam.store.items.history.flush();

    const okReport = hOk.seam.inspectAgenda();
    assert.equal(okReport.history.stateKey, "ready");
    assert.equal(okReport.history.writeBlocked, false);
    assert.equal(okReport.history.count, 2);
    assert.ok(okReport.history.bytes > 0, "history byte size is positive");
    assert.notEqual(okReport.history.sizeText, "0 B");
    assert.equal(okReport.healthy, true);
    await hOk.destroy();

    // Part B: corrupt reminder-history.json on disk -> writeBlocked + backupPath, NEVER wiped by repair
    const files = new Map([[HISTORY_PATH, "{ this is corrupt json !!!"]]);
    const hBad = await createHost({ files });
    const badReport = hBad.seam.inspectAgenda();
    assert.equal(badReport.history.stateKey, "corrupt", "corrupt history state detected");
    assert.equal(badReport.history.writeBlocked, true, "write-blocked flag reported");
    assert.equal(badReport.history.severity, "error");
    assert.ok(badReport.history.backupPath, "quarantined backup path reported");
    assert.equal(badReport.healthy, false, "corrupt history marks Agenda unhealthy");

    const plan = C.planAgendaDoctorRepair(badReport);
    assert.equal(plan.hasSafeRepairs, false, "corrupt history is NOT treated as an auto-repairable item");
    assert.equal(plan.manualOnly.historyBlocked, true);

    const res = hBad.seam.repairAgenda();
    assert.equal(res.repaired.total, 0);
    assert.equal(res.after.history.stateKey, "corrupt", "repairAgenda leaves corrupt history intact");
    assert.equal(res.after.history.writeBlocked, true, "repairAgenda never unblocks or wipes corrupt history");
    assert.ok(files.has(badReport.history.backupPath), "quarantined backup file still exists on disk");
    await hBad.destroy();
  });

  await test("Settings UI: Zen tab 'Check Agenda' opens Agenda Doctor dialog, runs one-click repair, and localizes to Polish", async () => {
    const h = await createHost();
    h.seam.store.items.upsert(makeItem("ui-item", date(1), date(1, 15)));
    h.seam.agendaController.runNow();

    // Inject one orphan seed and one foreign tab so the doctor UI has safe repairs to show & run
    const canonicalRoot = rootEl(h);
    const seed = makeAgendaPseudoTab(h, "seed:root", { label: "Orphan Root Seed" });
    canonicalRoot.addTabs([seed]);
    const foreign = h.window.gBrowser.addTab("https://example.org/ui-user");
    foreign.setAttribute("label", "UI Foreign Tab");
    canonicalRoot.addTabs([foreign]);

    // Open Notes sheet and jump to Zen/Agenda settings via real Agenda root menu command
    const menu = h.document.createXULElement("menupopup");
    menu.id = "zenFolderActions";
    h.document.body.append(menu);
    menu.triggerNode = canonicalRoot;
    h.emit("popupshowing", menu);
    const settingsItem = menu.querySelector('[zentral-agenda-folder-own="root:agenda-settings"]');
    assert.ok(settingsItem, "Agenda settings command exists on Agenda root menu");
    settingsItem.dispatchEvent(new h.Ev("command", { bubbles: true }));
    h.emit("popuphidden", menu);
    await flushMicrotasks(10);

    // Verify Settings Zen tab renders the standard .zn-set-row with 'Check Agenda' button
    const entryRow = h.document.querySelector(".zn-doctor-entry-row");
    assert.ok(entryRow && entryRow.classList.contains("zn-set-row"), "Check Agenda entry uses standard .zn-set-row");
    assert.ok(entryRow.querySelector(".zn-quick-label"), "row contains .zn-quick-label");
    const checkBtn = entryRow.querySelector(".zn-doctor-check-btn");
    assert.ok(checkBtn, "Check Agenda button rendered inside Zen/Agenda settings tab");
    assert.equal(checkBtn.textContent, "Check Agenda");

    // Click 'Check Agenda' -> opens Agenda Doctor dialog with all 6 sections
    checkBtn.dispatchEvent(new h.Ev("click", { bubbles: true }));
    await flushMicrotasks(6);

    const card = h.document.querySelector(".zn-doctor-card");
    assert.ok(card, "Agenda Doctor dialog opened");
    for (const sec of ["orphanSeeds", "duplicateKeys", "tabsOutsideRoot", "foreignTabs", "releasedFolders", "history"]) {
      assert.ok(card.querySelector(`[data-doctor-section="${sec}"]`), `section ${sec} rendered`);
    }
    const orphanBadge = card.querySelector('[data-doctor-section="orphanSeeds"] .zn-doctor-badge');
    const foreignBadge = card.querySelector('[data-doctor-section="foreignTabs"] .zn-doctor-badge');
    assert.equal(orphanBadge.textContent, "1");
    assert.equal(foreignBadge.textContent, "1");

    const repairBtn = card.querySelector(".zn-doctor-repair-btn");
    assert.ok(repairBtn && !repairBtn.disabled, "Repair button is enabled when safe issues exist");
    assert.match(repairBtn.textContent, /Repair safe issues \(2\)/);

    // Click Repair -> cleans seed, evacuates foreign tab, updates UI to healthy
    repairBtn.dispatchEvent(new h.Ev("click", { bubbles: true }));
    await flushMicrotasks(6);

    assert.equal(seed.isConnected, false, "orphan seed removed via dialog button");
    assert.equal(foreign.isConnected, true, "foreign tab preserved (evacuated, not deleted)");
    assert.equal(canonicalRoot.contains(foreign), false, "foreign tab moved out of Agenda root");
    assert.equal(card.querySelector('[data-doctor-section="orphanSeeds"] .zn-doctor-badge').textContent, "0");
    assert.equal(card.querySelector('[data-doctor-section="foreignTabs"] .zn-doctor-badge').textContent, "0");
    assert.equal(repairBtn.disabled, true, "Repair button disables after all safe issues are resolved");
    const notice = card.querySelector(".zn-doctor-notice");
    assert.ok(notice && !notice.hidden && /Repaired 2 safe issues/i.test(notice.textContent), `repair notice shown: ${notice?.textContent}`);

    // Switch language to Polish and verify Polish UI strings in Agenda Doctor dialog
    h.setPref(LANG_PREF, "pl");
    await flushMicrotasks(6);
    const backBtn = [...card.querySelectorAll(".zn-dialog-actions button")].find((b) => b.textContent === "Back to settings");
    assert.ok(backBtn, "Back to settings button exists");
    backBtn.dispatchEvent(new h.Ev("click", { bubbles: true }));
    await flushMicrotasks(6);

    const plCheckBtn = h.document.querySelector(".zn-doctor-check-btn");
    assert.ok(plCheckBtn && plCheckBtn.textContent === "Sprawdź Agendę", `Polish settings button label: ${plCheckBtn?.textContent}`);
    plCheckBtn.dispatchEvent(new h.Ev("click", { bubbles: true }));
    await flushMicrotasks(6);
    const plCard = h.document.querySelector(".zn-doctor-card");
    assert.ok(plCard && /Doktor Agendy/.test(plCard.textContent), "Polish Agenda Doctor title rendered");
    assert.ok(/Agenda wygląda na zdrową/.test(plCard.querySelector(".zn-doctor-banner").textContent), "Polish healthy banner rendered");

    await h.destroy();
  });

  await test("deleteEmptyFolders fallback: preserves required labelled fallback seeds and removes extra orphan seeds", async () => {
    const h = await createHost({ deleteEmptyFolders: true });
    h.seam.store.items.upsert(makeItem("fallback-item", date(1), date(1, 13)));
    h.seam.agendaController.runNow();
    const canonicalRoot = rootEl(h);
    assert.ok(canonicalRoot, "canonical Agenda root created with deleteEmptyFolders");
    const fallbackSeeds = h.document.querySelectorAll('tab[bgalazka-notes-agenda-fallback-seed="true"]');
    assert.equal(fallbackSeeds.length, 2, "root and day folder keep their required labelled fallback seeds");

    // Healthy state: required single fallback seeds must NOT be flagged as orphans
    const healthyReport = h.seam.inspectAgenda();
    assert.equal(healthyReport.orphanSeeds.length, 0, "required fallback seeds are healthy");
    assert.equal(healthyReport.healthy, true);

    // Inject an extra stale seed next to them -> flagged and cleaned without killing the required fallback seeds
    const extraSeed = makeAgendaPseudoTab(h, "seed:stale", { label: "Stale Seed" });
    canonicalRoot.addTabs([extraSeed]);
    const before = h.seam.inspectAgenda();
    assert.equal(before.orphanSeeds.length, 1, "extra stale seed detected alongside valid fallback seeds");
    const res = h.seam.repairAgenda();
    assert.equal(res.repaired.orphanSeeds, 1, "only the extra orphan seed is removed");
    assert.equal(extraSeed.isConnected, false, "extra stale seed removed");
    assert.equal(res.after.healthy, true, "Agenda returns to healthy with required fallback seeds intact");
    assert.ok(rootEl(h), "canonical root stays alive");
    assert.equal(projected(h).length, 1, "Agenda item tab stays intact");

    await h.destroy();
  });

  console.log(`\nPASS notes-agenda-doctor (${passed} tests)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
