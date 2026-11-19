"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const sourcePath = path.join(ROOT, "additional/notes/ZentralNotes.uc.js");
const source = fs.readFileSync(sourcePath, "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const win = { document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {} };
win.window = win;
vm.runInNewContext(source, {
  window: win,
  document: dom.document,
  globalThis: { window: win, document: dom.document, Services: {} },
  ChromeUtils: {},
  console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap, WeakSet, Symbol, Reflect,
  setTimeout, clearTimeout,
});
const c = win.__zentralNotesTestSeam.core;

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

function sameValues(actual, expected, message) {
  assert.equal(JSON.stringify(Array.from(actual)), JSON.stringify(expected), message);
}

function tab({ live = "about:blank", remembered = "", pinnedUrl = "", image = "", attrs = {} } = {}) {
  const el = dom.document.createElement("tab");
  el.linkedBrowser = { currentURI: { spec: live } };
  if (remembered) el._zentralNotesUrl = remembered;
  if (pinnedUrl) el._zenPinnedInitialState = { entry: { url: pinnedUrl, title: "" }, image };
  if (image) el.setAttribute("image", image);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const pseudoNote = "about:blank#zn-note:probe";
const pseudoAgenda = "about:blank#zn-agenda-seed%3Aroot";
const realUrl = "https://owner.example/work";

(async () => {
  try {
    await test("1. a pending Zen pin with only _zenPinnedInitialState evidence is recognized as our pseudo-tab", () => {
      assert.equal(typeof c.zenPinnedPseudoUrl, "function");
      assert.equal(typeof c.isZentralPseudoTab, "function");
      const restored = tab({ pinnedUrl: pseudoNote, image: c.noteFaviconUri(""), attrs: { pending: "true", pinned: "true" } });
      assert.equal(c.zenPinnedPseudoUrl(restored), pseudoNote);
      assert.equal(c.isZentralPseudoTab(restored), true);
      assert.equal(c.isZentralPseudoTab(tab({ live: realUrl, pinnedUrl: pseudoNote, attrs: { "bgalazka-ephemeral-tab": "true" } })), false, "a live real page wins over a stale pin record");
      assert.equal(c.isZentralPseudoTab(tab({ live: pseudoAgenda })), true, "a markerless live pseudo URL is ours");
      assert.equal(c.isZentralPseudoTab(tab({ attrs: { "bgalazka-notes-item": "n:probe" } })), true, "an owned pending projection is ours");
      assert.equal(c.isZentralPseudoTab(tab({ live: realUrl })), false, "an ordinary tab is never ours");
    });

    await test("2. startup sweeps remove a markerless pending pseudo-tab whose canonical URL is only in the Zen pin state", () => {
      const restored = tab({ pinnedUrl: pseudoNote, attrs: { pending: "true", pinned: "true" } });
      const real = tab({ live: realUrl, pinnedUrl: pseudoNote });
      const removed = [];
      const n = c.sweepRestoredPseudoTabs([restored, real], {
        notesEnabled: true,
        agendaEnabled: true,
        getTabState: () => JSON.stringify({ index: 1, entries: [{ url: "about:blank" }] }),
        removeTab: (t) => removed.push(t),
      });
      assert.deepEqual(removed, [restored]);
      assert.equal(n, 1);
    });

    await test("3. flat Zen sidebar data is filtered before Spaces Sync can project pseudo pins", () => {
      assert.equal(typeof c.filterZenSidebarState, "function");
      const state = {
        lastCollected: 1,
        spaces: [{ uuid: "space-1" }],
        tabs: [
          { zenSyncId: "pseudo-1", pinned: true, index: 1, entries: [{ url: "about:blank" }], _zenPinnedInitialState: { entry: { url: pseudoNote } } },
          { zenSyncId: "real-1", pinned: true, index: 1, entries: [{ url: realUrl }] },
        ],
        folders: [],
        groups: [],
      };
      const out = c.filterZenSidebarState(state);
      sameValues(out.tabs.map((t) => t.zenSyncId), ["real-1"]);
      assert.equal(state.tabs.length, 2, "input sidebar snapshot is never mutated");
    });

    await test("4. Spaces Sync projections drop pseudo tabs, their split/folder/layout references, and empty managed folders", () => {
      assert.equal(typeof c.filterSpacesSyncProjections, "function");
      const projections = new Map([
        ["pseudo-note", { kind: "tab", data: { tabId: "pseudo-note", url: pseudoNote, title: "" } }],
        ["pseudo-agenda", { kind: "tab", data: { tabId: "pseudo-agenda", url: pseudoAgenda, title: "" } }],
        ["real-1", { kind: "tab", data: { tabId: "real-1", url: realUrl, title: "Work" } }],
        ["bgalazka-zentral-notes", { kind: "folder", data: { folderId: "bgalazka-zentral-notes", children: ["pseudo-note", "split-bad", "real-1"] } }],
        ["zentral-notes-agenda", { kind: "folder", data: { folderId: "zentral-notes-agenda", children: ["pseudo-agenda"] } }],
        ["split-bad", { kind: "split", data: { splitId: "split-bad", tabs: ["pseudo-note", "real-1"] } }],
        ["layout", { kind: "layout", data: { spaces: ["space-1"], essentials: { default: ["pseudo-agenda", "real-1"] } } }],
      ]);
      const before = JSON.stringify([...projections]);
      const out = c.filterSpacesSyncProjections(projections);
      assert.equal(JSON.stringify([...projections]), before, "input projection map is not mutated");
      assert.equal(out.has("pseudo-note"), false);
      assert.equal(out.has("pseudo-agenda"), false);
      assert.equal(out.has("split-bad"), false, "a split left with one member is dropped");
      assert.equal(out.has("zentral-notes-agenda"), false, "an empty managed folder is dropped");
      assert.equal(out.get("real-1").data.url, realUrl);
      sameValues(out.get("bgalazka-zentral-notes").data.children, ["real-1"]);
      sameValues(out.get("layout").data.essentials.default, ["real-1"]);
      const clean = new Map([["real-1", { kind: "tab", data: { url: realUrl } }]]);
      assert.equal(c.filterSpacesSyncProjections(clean), clean, "a clean map keeps its identity");
    });

    await test("5. incoming Spaces Sync batches never materialize remote pseudo tabs", () => {
      assert.equal(typeof c.filterSpacesSyncIncomingRecords, "function");
      const records = [
        { id: "pseudo-note", cleartext: { kind: "tab", data: { url: pseudoNote, title: "" } } },
        { id: "pseudo-agenda", cleartext: { kind: "tab", data: { url: pseudoAgenda, title: "" } } },
        { id: "real-1", cleartext: { kind: "tab", data: { url: realUrl, title: "Work" } } },
        { id: "bgalazka-zentral-notes", cleartext: { kind: "folder", data: { folderId: "bgalazka-zentral-notes", children: ["pseudo-note", "split-bad", "real-1"] } } },
        { id: "split-bad", cleartext: { kind: "split", data: { splitId: "split-bad", tabs: ["pseudo-note", "real-1"] } } },
        { id: "layout", cleartext: { kind: "layout", data: { spaces: ["space-1"], essentials: { default: ["pseudo-agenda", "real-1"] } } } },
        { id: "tombstone", deleted: true },
      ];
      const before = JSON.stringify(records);
      const out = c.filterSpacesSyncIncomingRecords(records);
      assert.equal(JSON.stringify(records), before, "input batch is not mutated");
      assert.equal(JSON.stringify(out.map((r) => r.id)), JSON.stringify(["real-1", "bgalazka-zentral-notes", "layout", "tombstone"]));
      sameValues(out[1].cleartext.data.children, ["real-1"]);
      sameValues(out[2].cleartext.data.essentials.default, ["real-1"]);
      assert.equal(records[3].cleartext.data.children.length, 3, "original folder payload is untouched");
      const clean = [{ id: "real-1", cleartext: { kind: "tab", data: { url: realUrl } } }];
      assert.equal(c.filterSpacesSyncIncomingRecords(clean), clean, "a clean batch keeps its identity");
    });

    await test("6. native Window Sync / Spaces Sync shields are reference-counted and reversible", async () => {
      assert.equal(typeof c.acquireZenWindowSyncShield, "function");
      assert.equal(typeof c.acquireSpacesSyncModelShield, "function");
      assert.equal(typeof c.acquireSpacesSyncApplierShield, "function");
      assert.equal(typeof c.acquireZenSidebarDataShield, "function");

      const calls = [];
      const windowSync = {
        on_TabOpen(ev) { calls.push(["open", ev.target]); return Promise.resolve("open"); },
        on_TabPinned(ev) { calls.push(["pin", ev.target]); return Promise.resolve("pin"); },
        on_TabMove(ev) { calls.push(["move", ev.target]); return Promise.resolve("move"); },
      };
      const origOpen = windowSync.on_TabOpen;
      const releaseWindow = c.acquireZenWindowSyncShield(windowSync);
      assert.ok(releaseWindow && releaseWindow.isCurrent());
      const pseudo = tab({ pinnedUrl: pseudoNote, attrs: { "bgalazka-ephemeral-tab": "true" } });
      const real = tab({ live: realUrl });
      await windowSync.on_TabOpen({ target: pseudo });
      await windowSync.on_TabPinned({ target: pseudo });
      await windowSync.on_TabMove({ target: pseudo });
      await windowSync.on_TabOpen({ target: real });
      sameValues(calls.map(([kind]) => kind), ["open"], "only the real tab reaches Zen Window Sync");
      releaseWindow();
      assert.equal(windowSync.on_TabOpen, origOpen, "the original handler is restored");

      const model = {
        projections() {
          return new Map([
            ["pseudo", { kind: "tab", data: { url: pseudoNote } }],
            ["real", { kind: "tab", data: { url: realUrl } }],
          ]);
        },
      };
      const origProjections = model.projections;
      const releaseModel = c.acquireSpacesSyncModelShield(model);
      sameValues(model.projections().keys(), ["real"]);
      releaseModel();
      assert.equal(model.projections, origProjections);

      let seen = null;
      const applier = { applyBatch(records) { seen = records; return Promise.resolve([]); } };
      const origApply = applier.applyBatch;
      const releaseApplier = c.acquireSpacesSyncApplierShield(applier);
      await applier.applyBatch([
        { id: "pseudo", cleartext: { kind: "tab", data: { url: pseudoNote } } },
        { id: "real", cleartext: { kind: "tab", data: { url: realUrl } } },
      ]);
      sameValues(seen.map((r) => r.id), ["real"]);
      releaseApplier();
      assert.equal(applier.applyBatch, origApply);

      const sessionManager = { getSidebarData() { return { lastCollected: 1, tabs: [{ zenSyncId: "pseudo", index: 1, entries: [{ url: pseudoNote }] }, { zenSyncId: "real", index: 1, entries: [{ url: realUrl }] }] }; } };
      const origGet = sessionManager.getSidebarData;
      const releaseGet = c.acquireZenSidebarDataShield(sessionManager);
      sameValues(sessionManager.getSidebarData().tabs.map((t) => t.zenSyncId), ["real"]);
      releaseGet();
      assert.equal(sessionManager.getSidebarData, origGet);
    });

    await test("7. source wires the current Zen Spaces Sync APIs and the Spaces engine finish sweep", () => {
      assert.match(source, /resource:\/\/\/modules\/zen\/ZenWindowSync\.sys\.mjs/);
      assert.match(source, /resource:\/\/\/modules\/zen\/ZenSpacesSyncModel\.sys\.mjs/);
      assert.match(source, /resource:\/\/\/modules\/zen\/ZenSpacesSyncApplier\.sys\.mjs/);
      assert.match(source, /if \(engine && !\/\^\(tabs\|spaces\|zen\[-_\]\?pins\|pinned\[-_\]\?tabs\)\$\/i\.test\(engine\)\) return;/);
      assert.match(source, /cleanStrayPseudoTabs\(\)/);
      assert.match(source, /attachNativeShield\("notes-zen-window-sync-shield"/);
      assert.match(source, /attachNativeShield\("notes-zen-spaces-sync-model-shield"/);
      assert.match(source, /attachNativeShield\("notes-zen-spaces-sync-applier-shield"/);
      assert.match(source, /attachNativeShield\("notes-zen-sidebar-data-shield"/);
    });

    await test("8. the two untitled root seeds are isolated as a pair, not guessed from a title", () => {
      assert.equal(c.zenNewUrl(""), "about:blank#zn-new:");
      assert.match(source, /const agendaTabUrl = \(key\) => "about:blank#zn-agenda-" \+ encodeURIComponent\(String\(key \|\| ""\)\);/);
      assert.match(source, /const tab = zenNewTab\(zenNewUrl\(""\), "root"\);/);
      assert.match(source, /const seed = agendaNewTab\("seed:root"\);/);
      assert.match(source, /window\.gBrowser\.removeTab\(tab, \{ animate: false \}\);/, "routePseudoTab closes transient zn- URLs outside the managed roots");
      const roots = ["about:blank#zn-new:", "about:blank#zn-agenda-" + encodeURIComponent("seed:root")];
      for (const url of roots) {
        const restored = tab({ pinnedUrl: url, image: c.noteFaviconUri(""), attrs: { pending: "true", pinned: "true" } });
        assert.equal(c.isZentralPseudoTab(restored), true, url);
      }
      const projections = new Map(roots.map((url, i) => ["seed-" + i, { kind: "tab", data: { url, title: "" } }]));
      const filtered = c.filterSpacesSyncProjections(projections);
      assert.equal(filtered.size, 0, "both stale untitled root-seed records are dropped");
      assert.equal(c.filterSpacesSyncProjections(projections), filtered, "filtered projection identity is stable for Zen's digest cache");
      const records = roots.map((url, i) => ({ id: "seed-" + i, cleartext: { kind: "tab", data: { url, title: "" } } }));
      assert.equal(c.filterSpacesSyncIncomingRecords(records).length, 0, "neither stale seed is materialized");
    });

    console.log(`Restart pseudo-tab / Spaces Sync isolation tests passed (${passed})`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
