"use strict";
/* ST7.8: giving one reminder or event its own colour, from the Agenda row menu.
 *
 * The menu comes from the shared calendarItemMenuModel, so the same rows must appear for the calendar and for an Agenda
 * sidebar tab. A palette pick is a single store write with Undo, and "Use the note or category colour" clears it.
 */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const AGENDA = "zen.workspace.zentral.notes.agenda_folder";
const MARK = "bgalazka-notes-agenda-item";
const date = (days = 1, hour = 12) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
};
const makeEvent = (id, extra = {}) => C.makeItem({
  id,
  summary: extra.summary || id,
  start: { dateTime: new Date(date(1, 11)).toISOString() },
  end: { dateTime: new Date(date(1, 12)).toISOString() },
  x: { kind: "event", src: "manual", ...(extra.x || {}) },
}, Date.now());

const projected = (h) => h.document.querySelectorAll(`tab[${MARK}]`).filter((t) => !String(t.getAttribute(MARK)).startsWith("seed:"));
const tabFor = (h, id) => projected(h).find((t) => t.getAttribute("bgalazka-notes-agenda-item-id") === id) || null;
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

async function host() {
  const h = createFakeZen({ prefs: { [AGENDA]: true } });
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await Promise.resolve();
  return h;
}

function openTabMenu(h, tab) {
  let menu = h.document.getElementById("tabContextMenu");
  if (!menu) {
    menu = h.document.createXULElement("menupopup");
    menu.id = "tabContextMenu";
    h.document.body.append(menu);
  }
  h.window.TabContextMenu = { contextTab: tab };
  h.emit("popupshowing", menu);
  return menu;
}
const ownRows = (menu) => [...menu.querySelectorAll("[zentral-agenda-own]")];
const tagOf = (el) => (el.localName || el.tagName || "").toLowerCase();
const rowsWithLabel = (menu) => ownRows(menu).flatMap((el) => tagOf(el) === "menu"
  ? [el, ...el.querySelectorAll("menuitem")]
  : [el]);

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok - " + name); }

(async () => {
  await test("the open menu offers a Colour group with every palette entry, Custom and Inherit", async () => {
    const h = await host();
    try {
      h.seam.store.items.upsert(makeEvent("col1"));
      h.seam.agendaController.runNow();
      const menu = openTabMenu(h, tabFor(h, "col1"));
      const group = ownRows(menu).find((el) => tagOf(el) === "menu" && el.getAttribute("label") === "Colour");
      assert.ok(group, "a Colour submenu is present");
      const labels = [...group.querySelectorAll("menuitem")].map((el) => el.getAttribute("label"));
      for (const name of C.ITEM_COLOR_CHOICES) assert.ok(labels.includes(name), `${name} is offered`);
      assert.ok(labels.some((l) => /custom colour/i.test(l)), "custom colour is offered");
      assert.ok(labels.some((l) => /note or category/i.test(l)), "clearing back to inherit is offered");
    } finally {
      await h.destroy();
    }
  });

  await test("picking a colour is one headless write that shows on the row and can be undone", async () => {
    const h = await host();
    try {
      const item = h.seam.store.items.upsert(makeEvent("col2"));
      h.seam.agendaController.runNow();
      const menu = openTabMenu(h, tabFor(h, "col2"));
      const pink = rowsWithLabel(menu).find((el) => el.getAttribute("label") === "pink");
      assert.ok(pink && !pink.hasAttribute("disabled"), "pink is enabled");
      pink.dispatchEvent(new h.Ev("command"));
      await settle();

      assert.equal(h.seam.store.items.get(item.id).x.color, "pink", "the item carries its own colour");
      assert.equal(h.document.querySelectorAll(".zentral-notes-sheet").filter((s) => !s.hidden).length, 0, "no Notes sheet was opened");
      assert.equal(tabFor(h, "col2").getAttribute(MARK).includes("col2"), true, "the row is still there");

      // The row's own colour is what the projection reads.
      const projectedRow = C.agendaZenItem(h.seam.store.items.get(item.id), {});
      assert.equal(projectedRow.color, "pink");

      const toast = h.document.getElementById("bgalazka-notes-agenda-toast");
      const undo = [...toast.querySelectorAll("button")].find((b) => /undo/i.test(b.textContent || ""));
      assert.ok(undo, "the toast offers Undo");
      undo.dispatchEvent(new h.Ev("click"));
      await settle();
      assert.equal(h.seam.store.items.get(item.id).x.color ?? "", "", "Undo puts the colour back");
    } finally {
      await h.destroy();
    }
  });

  await test("Use the note or category colour clears the item's own colour", async () => {
    const h = await host();
    try {
      const item = h.seam.store.items.upsert(makeEvent("col3", { x: { color: "teal" } }));
      h.seam.agendaController.runNow();
      const menu = openTabMenu(h, tabFor(h, "col3"));
      const clear = rowsWithLabel(menu).find((el) => /note or category/i.test(el.getAttribute("label") || ""));
      assert.ok(clear && !clear.hasAttribute("disabled"), "the clear row is enabled");
      clear.dispatchEvent(new h.Ev("command"));
      await settle();
      assert.equal(h.seam.store.items.get(item.id).x.color ?? "", "", "the item's own colour is gone");
      // With a note colour underneath, the row falls back to it rather than going blank.
      assert.equal(C.resolveItemColor("", "blue", "green"), "blue");
    } finally {
      await h.destroy();
    }
  });

  await test("the palette tick marks the item's current colour", async () => {
    const h = await host();
    try {
      h.seam.store.items.upsert(makeEvent("col4", { x: { color: "blue" } }));
      h.seam.agendaController.runNow();
      const model = C.calendarItemMenuModel(h.seam.store.items.get("col4"), { lang: "en" });
      const group = model.find((r) => r.id === "color");
      assert.ok(group && Array.isArray(group.group), "the model carries the Colour group");
      assert.equal(group.group.find((r) => r.command === "color-blue").checked, true, "blue is checked");
      assert.equal(group.group.find((r) => r.command === "color-red").checked, false, "red is not");
    } finally {
      await h.destroy();
    }
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
