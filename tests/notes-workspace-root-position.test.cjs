"use strict";
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const AGENDA = "zen.workspace.zentral.notes.agenda_folder";
const AGENDA_POS = "zen.workspace.zentral.notes.agenda_position";
const NOTES = "zen.workspace.zentral.notes.zen_folder";
const ZEN_TOP = "zen.workspace.zentral.notes.zen_folder_top";
const SPACE_MODE = "zen.workspace.zentral.notes.space_mode";

const lastOf = (container) => container.children[container.children.length - 1] || null;
const assertEqualOrder = (actual, expected, msg) => assert.deepEqual(actual, expected, msg);

function itemOrder(container) {
  return [...container.children]
    .filter((c) => /^(zen-folder|tab)$/i.test(c.localName || ""))
    .map((c) => {
      if (c.getAttribute("bgalazka-notes-folder") === "true") return "NOTES";
      if (c.getAttribute("bgalazka-notes-agenda-folder") === "true") return "AGENDA";
      return c.getAttribute("label") || c.id || c.localName;
    });
}

function addUserPin(host, wsId, label, container) {
  const tab = host.sidebar.tab("https://example.test/" + label);
  tab.id = "user-pin-" + wsId + "-" + label;
  tab.setAttribute("label", label);
  tab.setAttribute("pinned", "true");
  tab.setAttribute("zen-workspace-id", wsId);
  tab.pinned = true;
  container.append(tab);
  return tab;
}

function addTrailingSeparator(host, container) {
  const sep = host.document.createElement("box");
  sep.className = "pinned-tabs-container-separator";
  container.append(sep);
  return sep;
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

(async () => {
  try {
    const tomorrow = C.addDays(C.dayStart(Date.now()), 1) + 12 * 3600000;

    await test("1. zen_folder_top=true + agenda_position=above keeps [AGENDA, NOTES] at top across workspace switches", async () => {
      const h = createFakeZen({ prefs: { [NOTES]: "all", [AGENDA]: true, [ZEN_TOP]: true, [AGENDA_POS]: "above" } });
      const wsA = h.sidebar.ws;
      const wsB = h.addWorkspace("space-b");
      addUserPin(h, wsA.id, "A1", h.sidebar.pinned);
      addUserPin(h, wsA.id, "A2", h.sidebar.pinned);
      const sepA = addTrailingSeparator(h, h.sidebar.pinned);
      addUserPin(h, "space-b", "B1", wsB.pinnedTabsContainer);
      addUserPin(h, "space-b", "B2", wsB.pinnedTabsContainer);
      const sepB = addTrailingSeparator(h, wsB.pinnedTabsContainer);

      await h.seam.ensureStore();
      h.seam.store.create("Note 1");
      h.seam.store.items.upsert(C.makeItem({ id: "r1", summary: "Rem 1", start: { dateTime: new Date(tomorrow).toISOString() }, x: { src: "manual", kind: "reminder" } }));
      h.seam.zen.runNow();
      h.seam.agendaController.runNow();

      assert.deepEqual(itemOrder(h.sidebar.pinned), ["AGENDA", "NOTES", "A1", "A2"], "Space A initial order");
      assert.equal(lastOf(h.sidebar.pinned), sepA, "Space A trailing separator preserved");

      // Switch to Space B -> MUST stay at top of Space B pinned tabs, NOT jump to bottom!
      await h.switchWorkspace("space-b");
      await Promise.resolve();
      h.seam.zen.runNow();
      h.seam.agendaController.runNow();
      assert.deepEqual(itemOrder(wsB.pinnedTabsContainer), ["AGENDA", "NOTES", "B1", "B2"], "Space B order after switch");
      assert.equal(lastOf(wsB.pinnedTabsContainer), sepB, "Space B trailing separator preserved");

      // Switch back to Space A -> MUST stay at top of Space A pinned tabs!
      await h.switchWorkspace(wsA.id);
      await Promise.resolve();
      h.seam.zen.runNow();
      h.seam.agendaController.runNow();
      assert.deepEqual(itemOrder(h.sidebar.pinned), ["AGENDA", "NOTES", "A1", "A2"], "Space A order after switching back");

      // Stable projection has zero repeated DOM moves
      h.resetOperations();
      h.seam.zen.runNow();
      h.seam.agendaController.runNow();
      assert.deepEqual(h.operations, [], "stable after switch");
      await h.destroy();
    });

    await test("2. zen_folder_top=true + agenda_position=below keeps [NOTES, AGENDA] at top across switches", async () => {
      const h = createFakeZen({ prefs: { [NOTES]: "all", [AGENDA]: true, [ZEN_TOP]: true, [AGENDA_POS]: "below" } });
      const wsB = h.addWorkspace("space-b");
      addUserPin(h, h.sidebar.ws.id, "A1", h.sidebar.pinned);
      addUserPin(h, "space-b", "B1", wsB.pinnedTabsContainer);
      addUserPin(h, "space-b", "B2", wsB.pinnedTabsContainer);

      await h.seam.ensureStore();
      h.seam.store.create("Note 1");
      h.seam.store.items.upsert(C.makeItem({ id: "r1", summary: "Rem 1", start: { dateTime: new Date(tomorrow).toISOString() }, x: { src: "manual", kind: "reminder" } }));
      h.seam.zen.runNow();
      h.seam.agendaController.runNow();

      assert.deepEqual(itemOrder(h.sidebar.pinned), ["NOTES", "AGENDA", "A1"]);
      await h.switchWorkspace("space-b");
      await Promise.resolve();
      h.seam.zen.runNow();
      h.seam.agendaController.runNow();
      assert.deepEqual(itemOrder(wsB.pinnedTabsContainer), ["NOTES", "AGENDA", "B1", "B2"]);
      await h.destroy();
    });

    await test("3. zen_folder_top=false places roots at bottom (before trailing separator) respecting above/below", async () => {
      for (const pos of ["above", "below"]) {
        const h = createFakeZen({ prefs: { [NOTES]: "all", [AGENDA]: true, [ZEN_TOP]: false, [AGENDA_POS]: pos } });
        const wsB = h.addWorkspace("space-b");
        addUserPin(h, "space-b", "B1", wsB.pinnedTabsContainer);
        addUserPin(h, "space-b", "B2", wsB.pinnedTabsContainer);
        const sepB = addTrailingSeparator(h, wsB.pinnedTabsContainer);

        await h.seam.ensureStore();
        h.seam.store.create("Note 1");
        h.seam.store.items.upsert(C.makeItem({ id: "r1", summary: "Rem 1", start: { dateTime: new Date(tomorrow).toISOString() }, x: { src: "manual", kind: "reminder" } }));
        h.seam.zen.runNow();
        h.seam.agendaController.runNow();

        await h.switchWorkspace("space-b");
        await Promise.resolve();
        h.seam.zen.runNow();
        h.seam.agendaController.runNow();

        const expected = pos === "above" ? ["B1", "B2", "AGENDA", "NOTES"] : ["B1", "B2", "NOTES", "AGENDA"];
        assert.deepEqual(itemOrder(wsB.pinnedTabsContainer), expected, `bottom order with agenda ${pos}`);
        assert.equal(lastOf(wsB.pinnedTabsContainer), sepB, "trailing separator stays last");
        await h.destroy();
      }
    });

    await test("4. Single-root modes (NOTES only or Agenda only) and live zen_folder_top toggle work cleanly", async () => {
      // NOTES only with zen_folder_top=true
      const h1 = createFakeZen({ prefs: { [NOTES]: "all", [AGENDA]: false, [ZEN_TOP]: true } });
      const wsB1 = h1.addWorkspace("space-b");
      addUserPin(h1, "space-b", "B1", wsB1.pinnedTabsContainer);
      await h1.seam.ensureStore();
      h1.seam.store.create("Only notes");
      h1.seam.zen.runNow();
      await h1.switchWorkspace("space-b");
      await Promise.resolve();
      h1.seam.zen.runNow();
      assert.deepEqual(itemOrder(wsB1.pinnedTabsContainer), ["NOTES", "B1"]);

      // Live toggle zen_folder_top -> false moves NOTES to bottom, then true moves back to top!
      h1.setPref(ZEN_TOP, false);
      h1.seam.zen.runNow();
      assert.deepEqual(itemOrder(wsB1.pinnedTabsContainer), ["B1", "NOTES"]);
      h1.setPref(ZEN_TOP, true);
      h1.seam.zen.runNow();
      assert.deepEqual(itemOrder(wsB1.pinnedTabsContainer), ["NOTES", "B1"]);
      await h1.destroy();

      // Agenda only with zen_folder_top=true & agenda_position=below -> still top!
      const h2 = createFakeZen({ prefs: { [NOTES]: "off", [AGENDA]: true, [ZEN_TOP]: true, [AGENDA_POS]: "below" } });
      const wsB2 = h2.addWorkspace("space-b");
      addUserPin(h2, "space-b", "B1", wsB2.pinnedTabsContainer);
      await h2.seam.ensureStore();
      h2.seam.store.items.upsert(C.makeItem({ id: "r2", summary: "Only agenda", start: { dateTime: new Date(tomorrow).toISOString() }, x: { src: "manual", kind: "reminder" } }));
      h2.seam.agendaController.runNow();
      await h2.switchWorkspace("space-b");
      await Promise.resolve();
      h2.seam.agendaController.runNow();
      assert.deepEqual(itemOrder(wsB2.pinnedTabsContainer), ["AGENDA", "B1"]);
      await h2.destroy();
    });

    await test("5. Space-local mode (space_mode=space) preserves top placement across workspace switches", async () => {
      const h = createFakeZen({ prefs: { [SPACE_MODE]: "space", [NOTES]: "all", [AGENDA]: true, [ZEN_TOP]: true, [AGENDA_POS]: "above" } });
      const wsB = h.addWorkspace("space-b");
      addUserPin(h, "space-b", "B1", wsB.pinnedTabsContainer);
      addUserPin(h, "space-b", "B2", wsB.pinnedTabsContainer);

      await h.seam.ensureStore();
      h.seam.store.create("Space A note");
      h.seam.store.items.upsert(C.makeItem({ id: "ra", summary: "Space A rem", start: { dateTime: new Date(tomorrow).toISOString() }, x: { src: "manual", kind: "reminder" } }));
      h.seam.zen.runNow();
      h.seam.agendaController.runNow();

      await h.switchWorkspace("space-b");
      await new Promise((r) => setTimeout(r, 10));
      h.seam.store.items.upsert(C.makeItem({ id: "rb", summary: "Space B rem", start: { dateTime: new Date(tomorrow).toISOString() }, x: { src: "manual", kind: "reminder" } }));
      h.seam.zen.runNow();
      h.seam.agendaController.runNow();
      assert.deepEqual(itemOrder(wsB.pinnedTabsContainer), ["AGENDA", "NOTES", "B1", "B2"]);
      // Switch back to Space A -> Space A keeps [AGENDA, NOTES, ...] at top too!
      await h.switchWorkspace(h.sidebar.ws.id);
      await new Promise((r) => setTimeout(r, 10));
      h.seam.zen.runNow();
      h.seam.agendaController.runNow();
      assert.deepEqual(itemOrder(h.sidebar.pinned).slice(0, 2), ["AGENDA", "NOTES"]);
      await h.destroy();
    });

    console.log(`PASS notes-workspace-root-position (${passed} tests)`);
  } catch (error) {
    console.error("FAIL notes-workspace-root-position\n", error);
    process.exitCode = 1;
  }
})();
