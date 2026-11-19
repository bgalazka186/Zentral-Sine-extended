"use strict";
/* SB6.7: Agenda items whose source note is in Trash:
 * - Default (agenda_hide_trashed = false): project with 'Source note in Trash' tooltip & hover card + Restore action,
 *   and show an informative toast with Restore when clicked.
 * - Setting (agenda_hide_trashed = true): hide those items from Agenda projection live. */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const plTable = require("../additional/notes/i18n/pl.js");

const AGENDA_PREF = "zen.workspace.zentral.notes.agenda_folder";
const HIDE_TRASHED_PREF = "zen.workspace.zentral.notes.agenda_hide_trashed";
const LANG_PREF = "zen.workspace.zentral.notes.language";
const MARK = "bgalazka-notes-agenda-item";
const date = (days, hour = 11) => C.addDays(C.dayStart(Date.now()), days) + hour * 3600000;
const projected = (h) => h.document.querySelectorAll(`tab[${MARK}]`).filter((tab) => !tab.getAttribute(MARK).startsWith("seed:"));

async function flush(n = 8) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

async function createHost(prefs = {}) {
  const h = createFakeZen({ prefs: { [AGENDA_PREF]: true, ...prefs } });
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await flush(4);
  return h;
}

function makeLinkedItem(id, noteId, startMs) {
  return C.makeItem({
    id,
    summary: "Review spec",
    start: { dateTime: new Date(startMs).toISOString() },
    x: { kind: "reminder", src: "manual", noteId },
  }, Date.now());
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("projection & setting: default hides trashed-source items; showing them renders tooltip/attr (EN & PL); permanently deleted notes stay gone", async () => {
    const h = await createHost();
    try {
      const store = h.seam.store;
      const note = store.create("# Launch Plan\nDetails here");
      store.items.upsert(makeLinkedItem("launch-rem", note.id, date(1, 11)));
      h.seam.agendaController.runNow();

      assert.equal(projected(h).length, 1);
      assert.equal(projected(h)[0].hasAttribute("bgalazka-notes-agenda-source-trashed"), false);
      assert.match(projected(h)[0].getAttribute("tooltiptext"), /Source note: Launch Plan/);

      // Move source note to Trash: default (agenda_hide_trashed=true) hides trashed-source items
      store.trash(note.id);
      h.seam.agendaController.runNow();
      assert.equal(projected(h).length, 0, "default agenda_hide_trashed=true hides trashed-source items");

      // Toggle setting OFF -> shows trashed-source item with explicit Trash notice
      h.setPref(HIDE_TRASHED_PREF, false);
      h.seam.agendaController.runNow();
      assert.equal(projected(h).length, 1, "agenda_hide_trashed=false shows trashed-source item with warning");
      const tab = projected(h)[0];
      assert.equal(tab.getAttribute("bgalazka-notes-agenda-source-trashed"), "true");
      assert.match(tab.getAttribute("tooltiptext"), /Source note in Trash: Launch Plan/);

      // Polish tooltip check
      h.setPref(LANG_PREF, "pl");
      h.seam.agendaController.invalidate();
      h.seam.agendaController.runNow();
      assert.ok(projected(h)[0].getAttribute("tooltiptext").includes(plTable.strings["hover.sourceInTrashNamed"].replace("{title}", "Launch Plan")), "Polish tooltip names trashed source note");
      h.setPref(LANG_PREF, "en");

      // Toggle setting ON again -> hides trashed-source items live
      h.setPref(HIDE_TRASHED_PREF, true);
      h.seam.agendaController.runNow();
      assert.equal(projected(h).length, 0, "toggling agenda_hide_trashed back to true hides trashed-source items");

      // Toggle setting OFF and permanently delete the note -> must NOT resurrect hidden items
      h.setPref(HIDE_TRASHED_PREF, false);
      h.seam.agendaController.runNow();
      assert.equal(projected(h).length, 1);
      await store.deleteForever(note.id);
      h.seam.agendaController.runNow();
      assert.equal(projected(h).length, 0, "permanently deleted note items are not projected");
    } finally {
      await h.destroy();
    }
  });

  await test("hover card shows 'Source note in Trash' notice + Restore note button, restores cleanly, and supports Undo", async () => {
    const h = await createHost({ [HIDE_TRASHED_PREF]: false });
    try {
      const store = h.seam.store;
      const note = store.create("# Project Alpha\nBody text");
      store.items.upsert(makeLinkedItem("alpha-rem", note.id, date(1, 14)));
      store.trash(note.id);
      h.seam.agendaController.runNow();

      const tab = projected(h)[0];
      assert.ok(tab);

      // Show hover card for the trashed-source Agenda tab
      h.seam.agendaHoverCard.show(tab);
      const card = h.document.querySelector(".zn-sidebar-hover-card");
      assert.ok(card && !card.hidden, "Agenda hover card opened");
      const trashedBanner = card.querySelector(".zn-hc-source-trashed");
      assert.ok(trashedBanner, "hover card displays .zn-hc-source-trashed notice");
      assert.match(trashedBanner.textContent, /Source note in Trash: Project Alpha/);
      assert.equal(card.querySelector(".zn-hc-source"), null, "trashed note is not rendered as an openable source link");

      const restoreBtn = card.querySelector('button[data-action="restore-source"]');
      assert.ok(restoreBtn, "hover card includes Restore note action button");
      restoreBtn.click();
      await flush(6);

      assert.equal(store.get(note.id).trashed, 0, "clicking Restore note restores the note from Trash");
      assert.equal(projected(h)[0].hasAttribute("bgalazka-notes-agenda-source-trashed"), false, "tab clears trashed marker after restore");

      // Hover card refreshed in place to show the restored source note link
      const restoredCard = h.document.querySelector(".zn-sidebar-hover-card");
      assert.equal(restoredCard.querySelector(".zn-hc-source-trashed"), null);
      assert.ok(restoredCard.querySelector(".zn-hc-source"), "restored source link appears on hover card");
      assert.equal(restoredCard.querySelector('button[data-action="restore-source"]'), null);

      // Undo button on toast moves the note back into Trash cleanly
      const toast = h.document.querySelector(".zn-agenda-toast");
      assert.ok(toast && !toast.hidden, "Restore confirmation toast shown");
      const undoBtn = toast.querySelector(".zn-agenda-toast-undo");
      assert.ok(undoBtn && !undoBtn.hidden, "Undo button visible on restore toast");
      undoBtn.click();
      await flush(6);
      assert.ok(store.get(note.id).trashed > 0, "Undo moves source note back to Trash");
      assert.equal(projected(h)[0].getAttribute("bgalazka-notes-agenda-source-trashed"), "true");
    } finally {
      await h.destroy();
    }
  });

  await test("clicking a trashed-source Agenda tab opens Day view and shows 'Source note is in Trash' toast with one-click Restore", async () => {
    const h = await createHost({ [HIDE_TRASHED_PREF]: false });
    try {
      const store = h.seam.store;
      const note = store.create("# Quarterly Budget\nNumbers");
      store.items.upsert(makeLinkedItem("budget-rem", note.id, date(1, 15)));
      store.trash(note.id);
      h.seam.agendaController.runNow();

      const tab = projected(h)[0];
      assert.ok(tab);

      // Click the Agenda tab (mousedown -> mouseup -> click sequence via host mouse handler)
      const fireMouse = (type) => h.seam.onAgendaMouse({
        type,
        button: 0,
        clientX: 20,
        clientY: 20,
        target: tab,
        composedPath: () => [tab],
        preventDefault() {},
        stopImmediatePropagation() {},
      });
      fireMouse("mousedown");
      fireMouse("mouseup");
      fireMouse("click");
      await flush(12);

      // Day view opened AND informative toast with Restore action is visible
      const calPane = h.document.querySelector(".zn-calendar-pane");
      assert.ok(calPane && !calPane.hidden, "clicking opens Day view");
      const toast = h.document.querySelector(".zn-agenda-toast");
      assert.ok(toast && !toast.hidden, "toast shown instead of silent fallback");
      assert.match(toast.textContent, /Source note is in Trash/);
      const restoreAction = toast.querySelector(".zn-agenda-toast-undo");
      assert.ok(restoreAction && !restoreAction.hidden && /Restore note/i.test(restoreAction.textContent), "toast offers one-click Restore note button");

      // Clicking Restore note on the toast restores the note and opens it
      restoreAction.click();
      await flush(12);
      assert.equal(store.get(note.id).trashed, 0, "toast Restore button restores the source note");
      assert.match(toast.textContent, /restored from Trash/i);
    } finally {
      await h.destroy();
    }
  });

  console.log(`\nPASS notes-agenda-trashed-source (${passed} tests)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
