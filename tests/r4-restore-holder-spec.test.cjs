"use strict";
/* R4 — the plan's ten acceptance scenarios for "Restore must bring things back in the form they had".
 *
 * One test per numbered item of the follow-up plan, on real fixture tabs (`pinned`, `zen-essential`) and through the
 * real engine: `sleepPanelRecord()` → snapshot → `restoreSession()` / the legacy `restore()` door. Every one of these
 * fails on the pre-fix tree, where a page that lived in its ordinary loaded tab came back as a Zentral panel.
 */
const assert = require("node:assert/strict");
const { bootBoost, makeTab, makeRecord, read, BOOST_SRC } = require("./helpers/fake-boost-holders-harness.cjs");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const plain = (value) => JSON.parse(JSON.stringify(value));

const entries = (h) => plain(h.api.sessionEntries());
const logOf = (h) => plain(h.api.restoreState().log);

/* R4.1 — record with a LOADED pinned tab and no panel browser. */
test("R4.1 loaded pinned tab, no panel: one tab entry, zero panel entries, reload once, never wake a panel", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const arena = makeRecord("arena", { tabLoaded: true, panel: false });
  assert.equal(arena.tab.hasAttribute("pinned"), true);
  assert.equal(arena.tab.hasAttribute("zen-essential"), true);
  const h = bootBoost({ tabs: [selected, arena.tab], records: [arena] });

  await h.sleepGameMode();
  const snapshot = entries(h);
  assert.equal(snapshot.tabs.length, 1, "the loaded pinned tab is a tab entry");
  assert.equal(snapshot.panels.length, 0, "and never a panel entry");
  assert.equal(snapshot.tabs[0].wasPinned, true);
  assert.equal(snapshot.tabs[0].recordAppId, "arena");

  h.api.restoreSession();
  await h.flushAll();
  assert.equal(h.reloadCalls.length, 1, "the tab is reloaded in the background");
  assert.equal(h.wakeCalls.length, 0, "loadEssentialInBackground is never called");
  h.destroy();
});

/* R4.2 — live panel browser and a pending tab. */
test("R4.2 live panel with a pending tab: panel entry only, one panel wake, no tab reload", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const whatsapp = makeRecord("whatsapp", { tabLoaded: false, panel: true });
  const h = bootBoost({ tabs: [selected, whatsapp.tab], records: [whatsapp] });

  await h.sleepGameMode();
  const snapshot = entries(h);
  assert.equal(snapshot.panels.length, 1);
  assert.deepEqual(snapshot.panels[0].holders, { panel: true, tab: false });
  assert.equal(snapshot.tabs.length, 0);

  h.api.restoreSession();
  await h.flushAll();
  assert.deepEqual(h.wakeCalls.map((w) => w.id), ["whatsapp"]);
  assert.equal(h.wakeCalls[0].automatic, false);
  assert.equal(h.reloadCalls.length, 0);
  h.destroy();
});

/* R4.3 — both holders loaded. */
test("R4.3 both loaded: both entries and Restore wakes the panel and then the tab", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const messenger = makeRecord("messenger", { tabLoaded: true, panel: true });
  const h = bootBoost({ tabs: [selected, messenger.tab], records: [messenger] });

  await h.sleepGameMode();
  const snapshot = entries(h);
  assert.equal(snapshot.panels.length, 1);
  assert.deepEqual(snapshot.panels[0].holders, { panel: true, tab: true });
  assert.equal(snapshot.tabs.length, 1);

  h.api.restoreSession();
  await h.flushAll();
  assert.deepEqual(h.wakeCalls.map((w) => w.id), ["messenger"], "the panel holder");
  assert.equal(h.reloadCalls.length, 1, "and the tab holder");
  const order = logOf(h).filter((line) => line.startsWith("panel:") || line.startsWith("tab:"));
  assert.deepEqual(order, ["panel:messenger", "tab:https://messenger.example/"], "panel first, then the tab");
  h.destroy();
});

/* R4.4 — neither holder. */
test("R4.4 neither loaded: no entries and Restore does nothing", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const idle = makeRecord("idle", { tabLoaded: false, panel: false });
  const h = bootBoost({ tabs: [selected, idle.tab], records: [idle] });

  await h.sleepGameMode();
  const snapshot = entries(h);
  assert.equal(snapshot.panels.length, 0);
  assert.equal(snapshot.tabs.length, 0);
  assert.equal(h.api.gameModeState().kept.some((entry) => entry.id === "idle"), true);

  const started = h.api.restoreSession();
  await h.flushAll();
  assert.equal(started.started, false);
  assert.equal(h.wakeCalls.length, 0);
  assert.equal(h.reloadCalls.length, 0);
  h.destroy();
});

/* R4.5 — the owner's session: 39 pinned loaded tabs + 3 panel records with live panel browsers. */
test("R4.5 an owner-like session restores exactly 3 panel wakes and 39 tab wakes", async () => {
  const tabs = [makeTab({ url: "https://selected.example/", label: "selected" })];
  const records = [];
  for (let i = 0; i < 39; i++) {
    tabs.push(makeTab({ url: `https://pinned-${i}.example/`, label: `pinned-${i}`, pinned: true, attrs: [["zen-essential", "true"]], lastAccessed: 100 + i }));
  }
  for (const id of ["whatsapp", "messenger", "arena"]) {
    const r = makeRecord(id, { tabLoaded: false, panel: true });
    tabs.push(r.tab);
    records.push(r);
  }
  const h = bootBoost({ tabs, records });

  await h.sleepGameMode();
  assert.deepEqual(plain(h.api.gameModeState().unloaded), { tabs: 39, panels: 3 });

  h.api.restoreSession();
  await h.flushAll(60);
  assert.equal(h.wakeCalls.length, 3, "exactly the three real panels");
  assert.equal(h.reloadCalls.length, 39, "exactly the 39 tab-only pages");
  assert.deepEqual(h.wakeCalls.map((w) => w.id).sort(), ["arena", "messenger", "whatsapp"]);
  h.destroy();
});

/* R4.6 — legacy entries (no `holders`). */
test("R4.6 legacy entries: wasLoaded false creates no panel, wasLoaded true creates one", async () => {
  const h = bootBoost();
  const skipped = h.api.normalizePanelRestoreEntry({ appId: "never", wasLoaded: false, when: 1 });
  const kept = h.api.normalizePanelRestoreEntry({ appId: "once", wasLoaded: true, when: 2 });
  assert.equal(h.api.panelHadHolder(skipped), false, "no panel is created for wasLoaded:false");
  assert.equal(h.api.panelHadHolder(kept), true, "one panel is created for wasLoaded:true");
  assert.deepEqual(plain(skipped.holders), { panel: false, tab: false });
  assert.deepEqual(plain(kept.holders), { panel: true, tab: false });
  assert.match(BOOST_SRC, /undoState\.panels\.map\(\(entry\) => normalizePanelRestoreEntry\(\{/,
    "the legacy undo road uses the same normalizer");
  h.destroy();
});

/* R4.7 — deep pass (Level 2) then the legacy restore() door. */
test("R4.7 a deep pass then restore() never turns a tab-only record into a panel", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const tabOnly = makeRecord("library", { tabLoaded: true, panel: false });
  const panelOnly = makeRecord("whatsapp", { tabLoaded: false, panel: true });
  const h = bootBoost({ tabs: [selected, tabOnly.tab, panelOnly.tab], records: [tabOnly, panelOnly] });

  const pending = h.api.runLevel2({ allowModes: ["asleep-allowed"] });
  await h.flushTimers(3000);
  const result = await pending;
  assert.deepEqual(plain(result.unloaded), { tabs: 1, panels: 1 });

  const restored = h.api.restore();
  assert.equal(restored.panels, 1, "only the record that lived in a panel");
  assert.deepEqual(h.wakeCalls.map((w) => w.id), ["whatsapp"]);
  assert.equal(h.reloadCalls.length, 0, "the panels-only door reloads no tab");
  h.destroy();
});

/* R4.8 — Restore is idempotent. */
test("R4.8 a second restoreSession() finds an empty snapshot and creates nothing", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const arena = makeRecord("arena", { tabLoaded: true, panel: false });
  const h = bootBoost({ tabs: [selected, arena.tab], records: [arena] });

  await h.sleepGameMode();
  h.api.restoreSession();
  await h.flushAll();
  assert.equal(h.reloadCalls.length, 1);

  const again = h.api.restoreSession();
  await h.flushAll();
  assert.equal(again.started, false);
  assert.equal(h.reloadCalls.length, 1);
  assert.equal(h.wakeCalls.length, 0);
  h.destroy();
});

/* R4.9 — counts: the widget label and gameModeState().unloaded agree with the holders. */
test("R4.9 the label and gameModeState().unloaded show a tab-only record as a tab", async () => {
  const selected = makeTab({ url: "https://selected.example/", label: "selected" });
  const tabOnly = makeRecord("arena", { tabLoaded: true, panel: false });
  const panelOnly = makeRecord("whatsapp", { tabLoaded: false, panel: true });
  const h = bootBoost({ tabs: [selected, tabOnly.tab, panelOnly.tab], records: [tabOnly, panelOnly] });

  h.api.setGameMode(true);
  await h.flushTimers(0);
  const state = plain(h.api.gameModeState());
  assert.deepEqual(state.unloaded, { tabs: 1, panels: 1 });
  assert.deepEqual(state.snapshot, { panels: 1, tabs: 1, active: true, hasSelected: false, hasParking: false });
  assert.equal(h.api.widgetRestoreLabel(state.snapshot, "en"), "Restore (1 apps, 1 tabs)");
  assert.equal(h.api.widgetRestoreLabel(state.snapshot, "pl"), "Przywr\u00f3\u0107 (1 aplikacji, 1 kart)");
  assert.match(h.api.widgetOffText(state.snapshot, "en"), /Restore \(1 apps, 1 tabs\)/);
  h.api.setGameMode(false);
  await h.flushTimers(0);
  h.destroy();
});

/* R4.10 — profiles still behave as documented with the new entry types. */
test("R4.10 recent, panels, none and all keep their documented meaning", async () => {
  const build = async (profile, extra = {}) => {
    const selected = makeTab({ url: "https://selected.example/", label: "selected" });
    const old = makeRecord("tab-old", { tabLoaded: true, panel: false });
    old.tab.lastAccessed = 10;
    const fresh = makeRecord("tab-new", { tabLoaded: true, panel: false });
    fresh.tab.lastAccessed = 90;
    const panel = makeRecord("panel-app", { tabLoaded: false, panel: true });
    const h = bootBoost({ tabs: [selected, old.tab, fresh.tab, panel.tab], records: [old, fresh, panel] });
    await h.sleepGameMode();
    const started = h.api.restoreSession({ profile, ...extra });
    await h.flushAll(50);
    return { started, h };
  };

  const all = await build("all");
  assert.equal(all.started.panels, 1);
  assert.equal(all.started.tabTasks, 2);
  assert.equal(all.h.reloadCalls.length, 2);
  all.h.destroy();

  const limited = await build("recent", { recentN: 1 });
  assert.equal(limited.started.tabTasks, 1, "recent limits the tab list");
  assert.equal(limited.h.reloadCalls.length, 1);
  limited.h.destroy();

  const panelsOnly = await build("panels");
  assert.equal(panelsOnly.started.panels, 1);
  assert.equal(panelsOnly.started.tabTasks, 0, "a record tab belongs to the tab list");
  assert.equal(panelsOnly.h.reloadCalls.length, 0);
  panelsOnly.h.destroy();

  const none = await build("none");
  assert.equal(none.started.panels, 0);
  assert.equal(none.started.tabTasks, 0);
  assert.equal(none.h.wakeCalls.length, 0);
  assert.equal(none.h.reloadCalls.length, 0);
  none.h.destroy();
});

(async () => {
  for (const [name, fn] of tests) {
    await fn();
    passed += 1;
    console.log("ok -", name);
  }
  console.log(`\n${passed}/${tests.length} R4 Restore acceptance scenarios passed`);
})().catch((error) => {
  console.error("FAIL:", error?.message || error);
  console.error(error?.stack || "");
  process.exit(1);
});
