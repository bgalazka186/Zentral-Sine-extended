"use strict";
/* SB6.11: a right-click on one of our own sidebar rows opens our own menu.
 *
 * Zen's tab menu is native, versioned, and shows "pinned tab" actions that mean nothing to a note or a reminder. Ours is
 * built from the same rows as the rest of Notes, so a click means the same thing here as in Zen's menu; the native
 * actions stay one submenu away, a foreign tab is untouched, and the row takes the focus back when the menu closes.
 */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const AGENDA = "zen.workspace.zentral.notes.agenda_folder";
const MODE = "zen.workspace.zentral.notes.zen_folder";
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const date = (days = 1, hour = 10) => { const d = new Date(); d.setHours(hour, 0, 0, 0); d.setDate(d.getDate() + days); return d.getTime(); };

async function host(prefs = { [AGENDA]: true, [MODE]: "all" }) {
  const h = createFakeZen({ prefs });
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await settle(3);
  return h;
}
const ownMenu = (h) => h.document.getElementById("zentral-notes-row-menu");
const noteTabOf = (h, id) => h.document.querySelectorAll("tab").find((t) => (t.linkedBrowser?.currentURI?.spec || "").endsWith("zn-note:" + id)) || null;
const agendaTabOf = (h, id) => h.document.querySelectorAll("tab[bgalazka-notes-agenda-item]").find((t) => t.getAttribute("bgalazka-notes-agenda-item-id") === id) || null;

function rightClick(h, node, extra = {}) {
  // One dispatch: the fake DOM runs the window's capture listeners and then the node's own, like a real event.
  const event = new h.Ev("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 240, ...extra });
  node.dispatchEvent(event);
  return event;
}

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok - " + name); }

(async () => {
  await test("right-clicking an Agenda row opens our own menu, not Zen's", async () => {
    const h = await host();
    try {
      h.seam.store.items.upsert(C.makeItem({ id: "ev1", summary: "Sync", start: { dateTime: new Date(date(1, 11)).toISOString() }, end: { dateTime: new Date(date(1, 12)).toISOString() }, x: { kind: "event", src: "manual" } }, Date.now()));
      h.seam.agendaController.runNow();
      const tab = agendaTabOf(h, "ev1");
      assert.ok(tab, "the row is projected");

      const event = rightClick(h, tab);
      assert.equal(event.defaultPrevented, true, "the native tab menu is suppressed for our row");

      const menu = ownMenu(h);
      assert.ok(menu, "our menu exists");
      assert.equal(menu.getAttribute("id"), "zentral-notes-row-menu");
      const labels = menu.querySelectorAll("menuitem").map((m) => m.getAttribute("label"));
      assert.ok(labels.includes("Edit details…"), "the item's own actions are there");
      assert.ok(menu.querySelectorAll("menu").some((m) => m.getAttribute("label") === "Colour"), "including the colour submenu");
      assert.ok(labels.some((l) => /Zen tab actions/.test(l)), "the native actions stay reachable");

      // The native menu is left alone: no item of ours is appended to it.
      const nativeMenu = h.document.getElementById("tabContextMenu");
      assert.equal(nativeMenu, null, "Zen's tab menu was never opened");
    } finally {
      await h.destroy();
    }
  });

  await test("a row action runs from our menu and the row takes the focus back", async () => {
    const h = await host();
    try {
      h.seam.store.items.upsert(C.makeItem({ id: "ev2", summary: "Sync", start: { dateTime: new Date(date(1, 11)).toISOString() }, end: { dateTime: new Date(date(1, 12)).toISOString() }, x: { kind: "event", src: "manual" } }, Date.now()));
      h.seam.agendaController.runNow();
      const tab = agendaTabOf(h, "ev2");
      rightClick(h, tab);

      const menu = ownMenu(h);
      const colour = menu.querySelectorAll("menu").find((m) => m.getAttribute("label") === "Colour");
      assert.ok(colour, "the Colour group is nested in our menu");
      const pink = colour.querySelectorAll("menuitem").find((m) => m.getAttribute("label") === "pink");
      assert.ok(pink, "the palette is there");
      pink.dispatchEvent(new h.Ev("command"));
      await settle();

      assert.equal(h.seam.store.items.get("ev2").x.color, "pink", "the action wrote the colour headlessly");
      assert.equal(h.document.querySelectorAll(".zentral-notes-sheet").filter((s) => !s.hidden).length, 0, "no sheet opened");

      // Closing the menu returns the focus to the row it belonged to.
      menu.dispatchEvent(new h.Ev("popuphidden"));
      await settle();
      h.fireTimer(16); h.fireTimer(16); // the focus is handed back on the next frame
      assert.equal(h.document.activeElement, tab, "the row has the focus again");
    } finally {
      await h.destroy();
    }
  });

  await test("Escape closes our menu and the row keeps the focus", async () => {
    const h = await host();
    try {
      const note = h.seam.store.create("Escape note");
      h.seam.zen.runNow();
      const tab = noteTabOf(h, note.id);
      assert.ok(tab, "the note has a sidebar row");
      rightClick(h, tab);
      const menu = ownMenu(h);
      assert.ok(menu, "our menu opened for a note row");
      const labels = menu.querySelectorAll("menuitem").map((m) => m.getAttribute("label"));
      assert.ok(labels.includes("Open note") && labels.includes("Move note to trash"), "the note's own actions are there");

      // Escape dismisses a popup: Gecko hides it, which is the same path a click outside takes.
      menu.dispatchEvent(new h.Ev("popuphidden"));
      await settle();
      h.fireTimer(16); h.fireTimer(16);
      assert.equal(ownMenu(h), null, "the menu is gone");
      assert.equal(h.document.activeElement, tab, "the focus is back on the row");
    } finally {
      await h.destroy();
    }
  });

  await test("OW-98: a contextmenu someone already cancelled still opens our menu", async () => {
    // The owner's report: a normal tab's right-click wins over ours on a row where a note lives. The cause was the
    // guard, not the row: `if (event.defaultPrevented) return` read Zen having cancelled the event as "someone else
    // owns this", and Zen's handler is older than ours, so that was every right-click on every one of our rows. A
    // cancelled contextmenu on one of OUR rows is exactly the case to take over.
    const h = await host();
    try {
      const note = h.seam.store.create("Prevented note");
      h.seam.zen.runNow();
      const tab = noteTabOf(h, note.id);
      assert.ok(tab, "the note has a sidebar row");

      // Cancelled before our listener is reached, which is what an older capture listener does.
      const event = new h.Ev("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 240 });
      event.preventDefault();
      assert.equal(event.defaultPrevented, true, "the event arrives already cancelled");
      tab.dispatchEvent(event);

      const menu = ownMenu(h);
      assert.ok(menu, "our menu opens anyway — this is the bug the owner reported");
      const labels = menu.querySelectorAll("menuitem").map((m) => m.getAttribute("label"));
      assert.ok(labels.includes("Open note"), "with the note's own actions");
      assert.equal(event.defaultPrevented, true, "and Zen's native menu stays suppressed");
    } finally {
      await h.destroy();
    }
  });

  await test("OW-98: a plain tab is still Zen's, even after our rows were used", async () => {
    // The fix must not spill: taking over a cancelled event is only ever for our own rows.
    const h = await host();
    try {
      const note = h.seam.store.create("Mine");
      h.seam.zen.runNow();
      const ourTab = noteTabOf(h, note.id);
      const press = new h.Ev("mousedown", { bubbles: true, cancelable: true, button: 2 });
      ourTab.dispatchEvent(press);

      h.window.gBrowser.addTab("https://example.com/", { deferTabOpen: true });
      const foreign = h.document.querySelectorAll("tab").find((t) => (t.linkedBrowser?.currentURI?.spec || "") === "https://example.com/");
      const event = rightClick(h, foreign);
      assert.equal(event.defaultPrevented, false, "the foreign tab keeps Zen's menu");
      assert.equal(ownMenu(h), null, "and ours never opens for it");
    } finally {
      await h.destroy();
    }
  });

  await test("OW-98: the press alone opens our menu, before any contextmenu arrives", async () => {
    // On a Zen that opens its tab menu from the button press, the contextmenu may never be ours to answer. The press
    // handler must therefore be enough on its own — but only on our rows.
    const h = await host();
    try {
      const note = h.seam.store.create("Press-only note");
      h.seam.zen.runNow();
      const tab = noteTabOf(h, note.id);
      assert.ok(tab);
      const press = new h.Ev("pointerdown", { bubbles: true, cancelable: true, button: 2, clientX: 120, clientY: 240 });
      tab.dispatchEvent(press);
      const event = rightClick(h, tab);
      assert.equal(event.defaultPrevented, true, "our row answers the right-click");
      assert.ok(ownMenu(h), "and the menu is ours");
    } finally {
      await h.destroy();
    }
  });

  await test("a foreign tab keeps Zen's native menu, ours never opens", async () => {
    const h = await host();
    try {
      h.window.gBrowser.addTab("https://example.com/", { deferTabOpen: true });
      const foreign = h.document.querySelectorAll("tab").find((t) => (t.linkedBrowser?.currentURI?.spec || "") === "https://example.com/");
      assert.ok(foreign, "a foreign tab exists");
      const event = rightClick(h, foreign);
      assert.equal(event.defaultPrevented, false, "nothing intercepted the native menu");
      assert.equal(ownMenu(h), null, "our menu did not open");
    } finally {
      await h.destroy();
    }
  });

  await test("Ctrl+right-click still reaches Zen's own menu for our rows", async () => {
    const h = await host();
    try {
      h.seam.store.items.upsert(C.makeItem({ id: "ev3", summary: "Sync", start: { dateTime: new Date(date(1, 11)).toISOString() }, end: { dateTime: new Date(date(1, 12)).toISOString() }, x: { kind: "event", src: "manual" } }, Date.now()));
      h.seam.agendaController.runNow();
      const tab = agendaTabOf(h, "ev3");
      const event = rightClick(h, tab, { ctrlKey: true });
      assert.equal(event.defaultPrevented, false, "the modifier leaves the native path alone");
      assert.equal(ownMenu(h), null, "our menu stays out of the way");
    } finally {
      await h.destroy();
    }
  });

  await test("a second right-click replaces our own menu; nothing is left behind", async () => {
    const h = await host();
    try {
      h.seam.store.items.upsert(C.makeItem({ id: "ev4", summary: "Sync", start: { dateTime: new Date(date(1, 11)).toISOString() }, end: { dateTime: new Date(date(1, 12)).toISOString() }, x: { kind: "event", src: "manual" } }, Date.now()));
      h.seam.agendaController.runNow();
      rightClick(h, agendaTabOf(h, "ev4"));
      assert.ok(ownMenu(h), "one menu is open");
      rightClick(h, agendaTabOf(h, "ev4"));
      assert.equal(h.document.querySelectorAll("#zentral-notes-row-menu").length, 1, "a second right-click replaces it, never stacks");
    } finally {
      await h.destroy();
    }
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
