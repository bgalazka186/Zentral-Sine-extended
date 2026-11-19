"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");

const dom = require("./helpers/fake-dom.cjs")();
const win = { document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {} };
win.window = win;
vm.runInNewContext(
  fs.readFileSync(require.resolve("../additional/notes/ZentralNotes.uc.js"), "utf8"),
  { window: win, document: dom.document, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, WeakSet, setTimeout, clearTimeout }
);
const c = win.__zentralNotesTestSeam.core;

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

(async () => {
  try {
    await test("1. filterSessionStoreState strips pseudo-tabs, remaps selected index, cleans _closedTabs/_closedWindows, and preserves reused real tabs", async () => {
      assert.equal(typeof c.filterSessionStoreState, "function");
      const pseudoNote = { index: 1, entries: [{ url: "about:blank#zn-note:n1" }], pinned: true, zenSyncId: "sync-n1" };
      const pseudoAgenda = { index: 1, entries: [{ url: "about:blank#zn-agenda-item%3Aa1" }], pinned: true, zenSyncId: "sync-a1" };
      const ephemeralBlank = { index: 1, entries: [{ url: "about:blank" }], attributes: { "bgalazka-ephemeral-tab": "true" }, zenSyncId: "sync-eph" };
      const real1 = { index: 1, entries: [{ url: "https://example.org/one" }], zenSyncId: "sync-r1" };
      const reusedReal = {
        index: 2,
        entries: [{ url: "about:blank#zn-note:old" }, { url: "https://example.org/reused" }],
        attributes: { "bgalazka-notes-item": "n:old", "bgalazka-ephemeral-tab": "true", skipSessionStore: "true", "custom-keep": "yes" },
        zenSyncId: "sync-r2",
      };
      const snapshot = {
        windows: [
          {
            selected: 4, // 1-based: points to real1 (index 3)
            tabs: [pseudoNote, pseudoAgenda, ephemeralBlank, real1, reusedReal],
            _closedTabs: [
              { state: { index: 1, entries: [{ url: "about:blank#zn-agenda-seed%3Aroot" }] }, title: "Agenda" },
              { state: { index: 1, entries: [{ url: "https://example.org/closed-real" }] }, title: "Real Closed" },
            ],
            folders: [
              { id: "zentral-notes-agenda", parentId: null },
              { id: "zentral-notes-agenda-day-2026-11-17", parentId: "zentral-notes-agenda", emptyTabIds: ["sync-a1"] },
              { id: "user-folder", parentId: null, prevSiblingInfo: { type: "group", id: "zentral-notes-agenda" } },
            ],
            groups: [
              { id: "zentral-notes-agenda", name: "Agenda" },
              { id: "user-folder", name: "User" },
            ],
          },
          {
            // Selected tab itself was a pseudo-tab at index 1 -> must clamp cleanly to surviving tab 1
            selected: 1,
            tabs: [pseudoNote, real1],
          },
        ],
        _closedWindows: [
          {
            // Closed window with ONLY pseudo-tabs -> dropped cleanly
            selected: 1,
            tabs: [pseudoNote, pseudoAgenda],
            folders: [{ id: "bgalazka-zentral-notes", parentId: null }],
          },
          {
            // Closed window with real tab + pseudo tab -> real tab kept, selected remapped
            selected: 2,
            tabs: [pseudoNote, real1],
            folders: [{ id: "bgalazka-zentral-notes", parentId: null }],
          },
        ],
      };
      const before = JSON.stringify(snapshot);
      const out = c.filterSessionStoreState(snapshot);
      assert.equal(JSON.stringify(snapshot), before, "never mutate input snapshot");

      // Window 0 assertions
      assert.equal(out.windows[0].tabs.length, 2);
      assert.equal(out.windows[0].tabs[0], real1, "clean real tab kept by identity");
      assert.equal(out.windows[0].tabs[1].zenSyncId, "sync-r2");
      assert.equal(out.windows[0].tabs[1].attributes["custom-keep"], "yes", "non-Zentral attributes preserved");
      assert.equal("bgalazka-ephemeral-tab" in out.windows[0].tabs[1].attributes, false, "stale ephemeral attr stripped on reused real tab");
      assert.equal("bgalazka-notes-item" in out.windows[0].tabs[1].attributes, false, "stale notes attr stripped on reused real tab");
      assert.equal("skipSessionStore" in out.windows[0].tabs[1].attributes, false, "stale skipSessionStore attr stripped on reused real tab");
      assert.equal(out.windows[0].selected, 1, "selected remapped from 4 -> 1 to stay on real1");
      assert.equal(out.windows[0]._closedTabs.length, 1);
      assert.equal(out.windows[0]._closedTabs[0].title, "Real Closed");
      assert.deepEqual(Array.from(out.windows[0].folders, (f) => f.id), ["user-folder"]);
      assert.equal(out.windows[0].folders[0].prevSiblingInfo.type, "start");
      assert.deepEqual(Array.from(out.windows[0].groups, (g) => g.id), ["user-folder"]);

      // Window 1 selected clamp
      assert.equal(out.windows[1].tabs.length, 1);
      assert.equal(out.windows[1].selected, 1);

      // _closedWindows filtering
      assert.equal(out._closedWindows.length, 1, "pseudo-only closed window dropped");
      assert.equal(out._closedWindows[0].tabs.length, 1);
      assert.equal(out._closedWindows[0].selected, 1);
      assert.deepEqual(Array.from(out._closedWindows[0].folders), []);

      // Flat Zen payload (windowless)
      const flat = {
        tabs: [pseudoNote, real1],
        folders: [{ id: "bgalazka-zentral-notes" }, { id: "user-f" }],
        groups: [{ id: "bgalazka-zentral-notes" }, { id: "user-f" }],
      };
      const flatOut = c.filterSessionStoreState(flat);
      assert.deepEqual(Array.from(flatOut.tabs), [real1]);
      assert.deepEqual(Array.from(flatOut.folders, (f) => f.id), ["user-f"]);
      assert.deepEqual(Array.from(flatOut.groups, (g) => g.id), ["user-f"]);

      // Clean snapshot returns exact original identity (zero-clone)
      const clean = { windows: [{ selected: 1, tabs: [real1], folders: [{ id: "user-f" }] }] };
      assert.equal(c.filterSessionStoreState(clean), clean);
    });

    await test("2. filterSessionStoreState strips pseudo-tabs from splitViewData / splitViews and clears orphaned splitViewId", async () => {
      const p1 = { index: 1, entries: [{ url: "about:blank#zn-note:p1" }], zenSyncId: "sp-pseudo", splitViewId: "sv-degenerate" };
      const r1 = { index: 1, entries: [{ url: "https://a.example/" }], zenSyncId: "sp-r1", splitViewId: "sv-degenerate" };
      const r2 = { index: 1, entries: [{ url: "https://b.example/" }], zenSyncId: "sp-r2", splitViewId: "sv-triple" };
      const r3 = { index: 1, entries: [{ url: "https://c.example/" }], zenSyncId: "sp-r3", splitViewId: "sv-triple" };
      const p2 = { index: 1, entries: [{ url: "about:blank#zn-agenda-item%3A2" }], zenSyncId: "sp-pseudo-2", splitViewId: "sv-triple" };
      const r4 = { index: 1, entries: [{ url: "https://d.example/" }], zenSyncId: "sp-r4", splitViewId: "sv-pure" };
      const r5 = { index: 1, entries: [{ url: "https://e.example/" }], zenSyncId: "sp-r5", splitViewId: "sv-pure" };
      const pureSv = { id: "sv-pure", gridType: "hsep", tabs: ["sp-r4", "sp-r5"] };
      const state = {
        windows: [
          {
            selected: 2,
            tabs: [p1, r1, r2, p2, r3, r4, r5],
            splitViewData: [
              { id: "sv-degenerate", gridType: "hsep", tabs: ["sp-pseudo", "sp-r1"] },
              { id: "sv-triple", gridType: "grid", tabs: ["sp-r2", "sp-pseudo-2", "sp-r3"] },
              pureSv,
            ],
            // Also test index-based splitViews representation
            splitViews: [
              { id: "sv-idx-bad", tabs: [0, 1] }, // 0=p1 removed -> degenerate (only 1 tab left)
              { id: "sv-idx-ok", tabs: [2, 3, 4] }, // 3=p2 removed -> remaps [2, 4] -> [1, 2]!
            ],
          },
        ],
      };
      const before = JSON.stringify(state);
      const out = c.filterSessionStoreState(state);
      assert.equal(JSON.stringify(state), before, "never mutate splitView input");
      const w = out.windows[0];
      assert.deepEqual(Array.from(w.tabs, (t) => t.zenSyncId), ["sp-r1", "sp-r2", "sp-r3", "sp-r4", "sp-r5"]);
      // Degenerate split view dropped, triple reduced to 2 real tabs, pure kept verbatim
      assert.equal(w.splitViewData.length, 2);
      assert.deepEqual(Array.from(w.splitViewData[0].tabs), ["sp-r2", "sp-r3"]);
      assert.equal(w.splitViewData[1], pureSv, "pure user splitView untouched by reference");
      // Surviving r1 lost its orphaned splitViewId because sv-degenerate was dropped!
      assert.equal("splitViewId" in w.tabs[0], false, "orphaned splitViewId cleared on lone surviving tab");
      // Surviving r2/r3 keep sv-triple, r4/r5 keep sv-pure
      assert.equal(w.tabs[1].splitViewId, "sv-triple");
      assert.equal(w.tabs[3].splitViewId, "sv-pure");
      // Index-based splitViews remapped accurately: old idx 2 -> new idx 1 (sp-r2), old idx 4 -> new idx 2 (sp-r3)
      assert.equal(w.splitViews.length, 1);
      assert.equal(w.splitViews[0].id, "sv-idx-ok");
      assert.deepEqual(Array.from(w.splitViews[0].tabs), [1, 2]);
    });

    await test("3. filterSessionFilePayload & acquireSessionFileShield protect Firefox SessionFile.write (object + JSON string)", async () => {
      assert.equal(typeof c.filterSessionFilePayload, "function");
      assert.equal(typeof c.acquireSessionFileShield, "function");
      const cleanJson = JSON.stringify({ windows: [{ selected: 1, tabs: [{ index: 1, entries: [{ url: "https://example.org/" }] }] }] });
      assert.equal(c.filterSessionFilePayload(cleanJson), cleanJson, "clean JSON string takes zero-parse fast path");
      assert.equal(c.filterSessionFilePayload("{malformed"), "{malformed", "malformed string passes safely without throwing");

      const dirtyObj = {
        windows: [{
          selected: 2,
          tabs: [
            { index: 1, entries: [{ url: "about:blank#zn-note:x" }] },
            { index: 1, entries: [{ url: "https://example.org/keep" }] },
          ],
        }],
      };
      const dirtyJson = JSON.stringify(dirtyObj);
      const written = [];
      const fakeSessionFile = {
        write(data, opts) { written.push([this, data, opts]); return Promise.resolve("ok"); },
      };
      const originalWrite = fakeSessionFile.write;
      const r1 = c.acquireSessionFileShield(fakeSessionFile);
      const r2 = c.acquireSessionFileShield(fakeSessionFile);
      assert.ok(r1 && r2 && r1.isCurrent());

      await fakeSessionFile.write(dirtyObj, { performShutdownCleanup: true });
      assert.equal(written[0][0], fakeSessionFile);
      assert.equal(written[0][1].windows[0].tabs.length, 1);
      assert.equal(written[0][1].windows[0].selected, 1);
      assert.equal(dirtyObj.windows[0].tabs.length, 2, "caller object not mutated");

      await fakeSessionFile.write(dirtyJson);
      const parsedWritten = JSON.parse(written[1][1]);
      assert.equal(parsedWritten.windows[0].tabs.length, 1);
      assert.equal(parsedWritten.windows[0].tabs[0].entries[0].url, "https://example.org/keep");

      r1();
      await fakeSessionFile.write(dirtyObj);
      assert.equal(written[2][1].windows[0].tabs.length, 1, "second window keeps shield active");

      const captured = fakeSessionFile.write;
      r2();
      assert.equal(fakeSessionFile.write, originalWrite, "original write restored after last release");
      await captured.call(fakeSessionFile, dirtyObj);
      assert.equal(written[3][1], dirtyObj, "captured wrapper becomes inert after disposal");

      // Non-configurable target fails gracefully
      const frozen = Object.freeze({ write: originalWrite });
      assert.equal(c.acquireSessionFileShield(frozen), null);
    });

    await test("4. planSyncedPseudoRecordCleanup, prunePreviouslySyncedPseudoRecords & acquirePinnedTabsStorageShield", async () => {
      assert.equal(typeof c.isPseudoPinRecord, "function");
      assert.equal(typeof c.planSyncedPseudoRecordCleanup, "function");
      assert.equal(typeof c.prunePreviouslySyncedPseudoRecords, "function");
      assert.equal(typeof c.acquirePinnedTabsStorageShield, "function");

      const pins = [
        { uuid: "bgalazka-zentral-notes", isGroup: true, parentUuid: null, title: "NOTES" },
        { uuid: "bgalazka-zentral-notes-sub_empty", isGroup: true, parentUuid: "bgalazka-zentral-notes", title: "EmptySub" },
        { uuid: "bgalazka-zentral-notes-sub_used", isGroup: true, parentUuid: "bgalazka-zentral-notes", title: "UsedSub" },
        { uuid: "zentral-notes-agenda", isGroup: true, parentUuid: null, title: "Agenda" },
        { uuid: "zentral-notes-agenda-day-2026-11-17", isGroup: true, parentUuid: "zentral-notes-agenda", title: "Today" },
        { uuid: "pin-pseudo-note", isGroup: false, parentUuid: "bgalazka-zentral-notes-sub_empty", url: "about:blank#zn-note:abc" },
        { uuid: "pin-pseudo-new", isGroup: false, parentUuid: "bgalazka-zentral-notes", url: "about:blank#zn-new:" },
        { uuid: "pin-pseudo-agenda", isGroup: false, parentUuid: "zentral-notes-agenda-day-2026-11-17", url: "about:blank#zn-agenda-item%3A1" },
        { uuid: "pin-real-inside-notes", isGroup: false, parentUuid: "bgalazka-zentral-notes-sub_used", url: "https://user.example/important" },
        { uuid: "pin-real-normal", isGroup: false, parentUuid: null, url: "https://user.example/home" },
      ];
      const plan = c.planSyncedPseudoRecordCleanup(pins);
      assert.deepEqual(Array.from(plan.tabIds), ["pin-pseudo-note", "pin-pseudo-new", "pin-pseudo-agenda"]);
      // Empty sub-folders removed BEFORE their empty parents; bgalazka-zentral-notes & sub_used PRESERVED because pin-real-inside-notes lives there!
      assert.deepEqual(Array.from(plan.folderIds), ["bgalazka-zentral-notes-sub_empty", "zentral-notes-agenda-day-2026-11-17", "zentral-notes-agenda"]);
      assert.deepEqual(Array.from(plan.preservedFolderIds).sort(), ["bgalazka-zentral-notes", "bgalazka-zentral-notes-sub_used"]);

      const removedCalls = [];
      const savedPins = [];
      const storage = {
        async getPins() { return pins; },
        async removePin(uuid) { removedCalls.push(uuid); },
        async savePin(pin) { savedPins.push(pin); return pin; },
        async updatePin(pin) { savedPins.push({ ...pin, updated: true }); return pin; },
      };
      const res = await c.prunePreviouslySyncedPseudoRecords(storage);
      assert.equal(res.removedTabs, 3);
      assert.equal(res.removedFolders, 3);
      assert.deepEqual(removedCalls, [
        "pin-pseudo-note", "pin-pseudo-new", "pin-pseudo-agenda",
        "bgalazka-zentral-notes-sub_empty", "zentral-notes-agenda-day-2026-11-17", "zentral-notes-agenda",
      ]);

      // Write shield blocks pseudo-tab pins while allowing real pins
      const origSave = storage.savePin, origUpdate = storage.updatePin;
      const release = c.acquirePinnedTabsStorageShield(storage);
      assert.ok(release && release.isCurrent());
      assert.equal(await storage.savePin({ uuid: "p-new", url: "about:blank#zn-note:foo", isGroup: false }), null);
      assert.equal(await storage.updatePin({ uuid: "p-ag", url: "about:blank#zn-agenda-item%3Ax", isGroup: false }), null);
      assert.equal(savedPins.length, 0, "pseudo pins never written to ZenPinnedTabsStorage");
      await storage.savePin({ uuid: "r-new", url: "https://example.org/work", isGroup: false });
      assert.equal(savedPins.length, 1, "real user pins written normally");
      release();
      assert.equal(storage.savePin, origSave);
      assert.equal(storage.updatePin, origUpdate);
    });

    await test("5. Live fake-Zen host: ephemeral marking, SessionFile/ZenSessionStore/PinnedStorage shields, post-Sync prune, and disabled-mode sweep", async () => {
      const sessionWrites = [];
      const zenSaves = [];
      const savedPins = [];
      const removedPins = [];
      const syncedPins = [
        { uuid: "zentral-notes-agenda", isGroup: true, parentUuid: null },
        { uuid: "synced-stale-agenda", isGroup: false, parentUuid: "zentral-notes-agenda", url: "about:blank#zn-agenda-item%3Astale" },
        { uuid: "bgalazka-zentral-notes", isGroup: true, parentUuid: null },
        { uuid: "synced-user-in-notes", isGroup: false, parentUuid: "bgalazka-zentral-notes", url: "https://keep.example/" },
      ];
      const fakeSessionFile = { write(data) { sessionWrites.push(data); return Promise.resolve(); } };
      const fakeZenSessionStore = { saveState(data) { zenSaves.push(data); return true; } };
      const fakePinnedStorage = {
        async getPins() { return syncedPins.filter((p) => !removedPins.includes(p.uuid)); },
        async removePin(uuid) { removedPins.push(uuid); },
        async savePin(pin) { savedPins.push(pin); return pin; },
        async updatePin(pin) { savedPins.push(pin); return pin; },
      };
      const origSFWrite = fakeSessionFile.write;
      const origZSSave = fakeZenSessionStore.saveState;
      const origPinSave = fakePinnedStorage.savePin;

      const host = createFakeZen({
        prefs: {
          "zen.workspace.zentral.notes.zen_folder": "all",
          "zen.workspace.zentral.notes.agenda_folder": true,
        },
        esModules: {
          "resource:///modules/sessionstore/SessionFile.sys.mjs": { SessionFile: fakeSessionFile },
          "resource:///modules/zen/ZenSessionManager.sys.mjs": { ZenSessionStore: fakeZenSessionStore },
          "resource:///modules/zen/ZenPinnedTabsStorage.sys.mjs": { ZenPinnedTabsStorage: fakePinnedStorage },
        },
      });
      await host.seam.ensureStore();
      const t0 = Date.now();
      host.seam.store.items.upsert(C.makeItem({
        id: "ev-iso", summary: "Iso Event",
        start: { dateTime: new Date(C.dayStart(t0) + 14 * 3600000).toISOString() },
        x: { kind: "reminder", src: "manual" },
      }, t0));
      host.seam.agendaController.runNow();

      // Created Agenda pseudo-tabs must carry skipSessionStore + bgalazka-ephemeral-tab, NEVER zen-empty-tab
      const agendaTabs = host.document.querySelectorAll("tab[bgalazka-notes-agenda-item]");
      assert.ok(agendaTabs.length >= 1, "Agenda pseudo-tab created");
      for (const tab of agendaTabs) {
        assert.equal(tab._addTabOptions?.skipSessionStore, true, "addTab passed skipSessionStore: true");
        assert.equal(tab.getAttribute("bgalazka-ephemeral-tab"), "true");
        assert.equal(tab.getAttribute("skipSessionStore"), "true");
        assert.equal(tab.hasAttribute("zen-empty-tab"), false, "never hijack Zen's hidden zen-empty-tab attribute");
      }

      // SessionFile.write is shielded on live host
      const rawSession = {
        windows: [{
          selected: 2,
          tabs: [
            { index: 1, entries: [{ url: "about:blank#zn-agenda-item%3Aev-iso" }], zenSyncId: "a-1", splitViewId: "sv-1" },
            { index: 1, entries: [{ url: "https://real.example/" }], zenSyncId: "r-1", splitViewId: "sv-1" },
          ],
          splitViewData: [{ id: "sv-1", tabs: ["a-1", "r-1"] }],
        }],
      };
      await fakeSessionFile.write(rawSession);
      assert.equal(sessionWrites.length, 1);
      assert.equal(sessionWrites[0].windows[0].tabs.length, 1);
      assert.equal(sessionWrites[0].windows[0].selected, 1);
      assert.deepEqual(Array.from(sessionWrites[0].windows[0].splitViewData), []);
      assert.equal("splitViewId" in sessionWrites[0].windows[0].tabs[0], false);

      // ZenPinnedTabsStorage.savePin is shielded on live host
      await fakePinnedStorage.savePin({ uuid: "new-pseudo", url: "about:blank#zn-note:live", isGroup: false });
      assert.equal(savedPins.length, 0);
      await fakePinnedStorage.savePin({ uuid: "new-real", url: "https://real.example/pin", isGroup: false });
      assert.equal(savedPins.length, 1);

      // Trigger Sync completion notification -> prunes previously synced pseudo-tabs & empty Agenda folder, keeps NOTES folder with real user pin!
      host.obs.notifyObservers(null, "weave:engine:sync:finish", "zen-pins");
      await new Promise((r) => setTimeout(r, 15));
      assert.ok(removedPins.includes("synced-stale-agenda"), "previously synced pseudo-tab removed");
      assert.ok(removedPins.includes("zentral-notes-agenda"), "empty previously synced Agenda folder removed");
      assert.equal(removedPins.includes("bgalazka-zentral-notes"), false, "managed folder with user pin preserved");

      // Reused tab navigating to real page clears bgalazka-ephemeral-tab + skipSessionStore
      const reused = agendaTabs[0];
      reused.linkedBrowser.currentURI.spec = "https://navigated.example/";
      host.emit("SSTabRestored", reused);
      assert.equal(reused.hasAttribute("bgalazka-ephemeral-tab"), false);
      assert.equal(reused.hasAttribute("skipSessionStore"), false);
      assert.equal(reused.hasAttribute("bgalazka-notes-agenda-item"), false);

      // Destroy restores every native method cleanly
      await host.destroy();
      assert.equal(fakeSessionFile.write, origSFWrite, "SessionFile.write restored on destroy");
      assert.equal(fakeZenSessionStore.saveState, origZSSave, "ZenSessionStore.saveState restored on destroy");
      assert.equal(fakePinnedStorage.savePin, origPinSave, "ZenPinnedTabsStorage.savePin restored on destroy");
      assert.equal(host.observers.get("weave:engine:sync:finish")?.size || 0, 0, "Sync observer removed on destroy");
    });

    await test("6. Unconditional disabled-mode startup + SSTabRestored sweep cleans both Notes and Agenda pseudo-tabs/folders", async () => {
      const host = createFakeZen({
        prefs: {
          "zen.workspace.zentral.notes.zen_folder": "off",
          "zen.workspace.zentral.notes.agenda_folder": false,
        },
        SessionStore: {
          getTabState(tab) { return JSON.stringify(tab._ss || {}); },
        },
      });
      // Inject late SSTabRestored pseudo-tabs for BOTH Notes and Agenda while BOTH prefs are disabled!
      const restoredNote = host.sidebar.tab("about:blank");
      restoredNote.pinned = true;
      restoredNote._ss = { index: 1, entries: [{ url: "about:blank#zn-note:orphan" }] };
      const restoredAgenda = host.sidebar.tab("about:blank");
      restoredAgenda.pinned = true;
      restoredAgenda._ss = { index: 1, entries: [{ url: "about:blank#zn-agenda-item%3Aorphan" }] };
      const restoredReal = host.sidebar.tab("https://real.example/");
      restoredReal.pinned = true;
      restoredReal._ss = { index: 1, entries: [{ url: "https://real.example/" }] };

      const orphanNotesFolder = host.sidebar.folder("NOTES", { id: "bgalazka-zentral-notes" });
      orphanNotesFolder.delete = () => orphanNotesFolder.remove();
      orphanNotesFolder.childrenContainer = orphanNotesFolder.querySelector(":scope > .tab-group-container");
      orphanNotesFolder.childrenContainer.append(restoredNote);

      const orphanAgendaFolder = host.sidebar.folder("Agenda", { id: "zentral-notes-agenda" });
      orphanAgendaFolder.delete = () => orphanAgendaFolder.remove();
      orphanAgendaFolder.childrenContainer = orphanAgendaFolder.querySelector(":scope > .tab-group-container");
      orphanAgendaFolder.childrenContainer.append(restoredAgenda);

      host.sidebar.pinned.append(restoredReal);

      host.emit("SSTabRestored", restoredNote);
      host.emit("SSTabRestored", restoredAgenda);
      host.emit("SSTabRestored", restoredReal);

      assert.equal(restoredNote.isConnected, false, "disabled-mode SSTabRestored removes orphan Notes pseudo-tab");
      assert.equal(restoredAgenda.isConnected, false, "disabled-mode SSTabRestored removes orphan Agenda pseudo-tab");
      assert.equal(orphanNotesFolder.isConnected, false, "disabled-mode SSTabRestored removes empty Notes folder");
      assert.equal(orphanAgendaFolder.isConnected, false, "disabled-mode SSTabRestored removes empty Agenda folder");
      assert.equal(restoredReal.isConnected, true, "real user tab untouched");

      // Managed folder containing BOTH a restored pseudo-tab AND a real user tab: removes pseudo-tab, preserves folder & user tab!
      const mixedFolder = host.sidebar.folder("NOTES", { id: "bgalazka-zentral-notes" });
      mixedFolder.setAttribute("bgalazka-notes-folder", "true");
      mixedFolder.delete = () => mixedFolder.remove();
      mixedFolder.childrenContainer = mixedFolder.querySelector(":scope > .tab-group-container");
      const mixedPseudo = host.sidebar.tab("about:blank");
      mixedPseudo.pinned = true;
      mixedPseudo._ss = { index: 1, entries: [{ url: "about:blank#zn-new:" }] };
      const mixedReal = host.sidebar.tab("https://keep-me.example/");
      mixedReal.pinned = true;
      mixedReal._ss = { index: 1, entries: [{ url: "https://keep-me.example/" }] };
      mixedFolder.childrenContainer.append(mixedPseudo);
      mixedFolder.childrenContainer.append(mixedReal);
      host.emit("SSTabRestored", mixedPseudo);
      assert.equal(mixedPseudo.isConnected, false, "pseudo-tab inside mixed folder removed");
      assert.equal(mixedReal.isConnected, true, "real user tab inside mixed folder preserved");
      assert.equal(mixedFolder.isConnected, true, "mixed folder preserved for real user tab");
      assert.equal(mixedFolder.hasAttribute("bgalazka-notes-folder"), false, "Zentral folder attr stripped on release");
      assert.notEqual(mixedFolder.id, "bgalazka-zentral-notes", "Zentral folder id released");

      await host.destroy();
    });

    console.log(`PASS notes-session-isolation (${passed} tests)`);
  } catch (error) {
    console.error("FAIL notes-session-isolation\n", error);
    process.exitCode = 1;
  }
})();
