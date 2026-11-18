"use strict";
/* ST7.5: the reminder-history card (Calendar → Tools → Reminder history), now readable, filterable, exportable and
 * trimmable.
 *
 * The count, the copy and the save must all describe the same list, so one filter decides for all three; trimming asks
 * first, names real numbers, and only ever moves records into the archive.
 */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const btn = (root, text) => [...root.querySelectorAll("button")].find((b) => String(b.textContent || "").trim() === text) || null;
const byText = (root, re) => [...root.querySelectorAll("button")].find((b) => re.test(String(b.textContent || ""))) || null;

async function host() {
  const h = createFakeZen({ prefs: { "zen.workspace.zentral.notes.zen_folder": "all" } });
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await settle(3);
  return h;
}

// The card lives in the sheet, so the door is the sheet: show it, then open the card through the seam the calendar uses.
async function openCard(h) {
  const handle = await h.seam.showNotes("");
  await settle(6);
  assert.ok(handle, "the Notes sheet opened");
  assert.equal(typeof h.seam.openReminderHistory, "function", "the history card is reachable from the calendar tools");
  h.seam.openReminderHistory();
  await settle(6);
  return h.document.querySelector(".zn-dialog-card");
}

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok - " + name); }

(async () => {
  await test("the card lists the records, filters them by action and window, and clears again", async () => {
    const h = await host();
    try {
      const history = h.seam.store.items.history;
      assert.ok(history, "the store owns a reminder history");
      const recent = Date.now() - 2 * 86400000, older = Date.now() - 90 * 86400000;
      history.append({ itemId: "it-1", occurrenceId: "it-1", action: "done", at: recent, summary: "Pay rent", start: { dateTime: new Date(recent).toISOString() } });
      history.append({ itemId: "it-2", occurrenceId: "it-2", action: "alerted", at: older, summary: "Old alert", start: { dateTime: new Date(older).toISOString() } });
      await settle();

      const card = await openCard(h);
      assert.ok(card, "the history card is open");
      assert.equal(card.querySelectorAll(".zn-hist-row").length, 2, "both records are listed");
      assert.match(card.querySelector(".zn-empty").textContent, /2 of 2 records/);
      assert.match(card.querySelector(".zn-empty").textContent, /showing 2 of 2/);

      // Filtering by a window drops the old alert, and the summary says so.
      const dayPick = card.querySelector("select");
      dayPick.value = "30";
      dayPick.dispatchEvent(new h.Ev("change"));
      await settle(3);
      assert.equal(card.querySelectorAll(".zn-hist-row").length, 1, "only the recent record is left");
      assert.match(card.querySelector(".zn-empty").textContent, /last 30 days/);
      assert.match(card.querySelector(".zn-empty").textContent, /1 of 2 records/);

      // Clear filters brings both back.
      btn(card, "Clear filters").dispatchEvent(new h.Ev("click"));
      await settle(3);
      assert.equal(card.querySelectorAll(".zn-hist-row").length, 2);
    } finally {
      await h.destroy();
    }
  });

  await test("trimming asks first with real numbers, and Cancel changes nothing", async () => {
    const h = await host();
    try {
      const history = h.seam.store.items.history;
      const old = Date.now() - 90 * 86400000;
      history.append({ itemId: "old-1", occurrenceId: "old-1", action: "alerted", at: old, summary: "Old alert", start: { dateTime: new Date(old).toISOString() } });
      history.append({ itemId: "new-1", occurrenceId: "new-1", action: "done", at: Date.now() - 3600000, summary: "Fresh", start: { dateTime: new Date().toISOString() } });
      await settle();
      const card = await openCard(h);
      assert.ok(card, "the history card is open");
      const prune = byText(card, /Trim old records/);
      assert.ok(prune && !prune.disabled, "the trim button is available");
      prune.dispatchEvent(new h.Ev("click"));
      await settle(4);

      const texts = [...h.document.querySelectorAll(".zn-dialog-card")].map((c) => c.textContent).join(" ");
      assert.match(texts, /Move 1 old record/, "the confirmation names how many move");
      assert.match(texts, /archive/i, "and says where they go");
      assert.equal(h.seam.store.items.history.list({}).length, 2, "nothing moves before the answer");

      const cancel = byText(h.document, /^Cancel$/);
      assert.ok(cancel, "Cancel is offered");
      cancel.dispatchEvent(new h.Ev("click"));
      await settle(4);
      assert.equal(h.seam.store.items.history.list({}).length, 2, "Cancel leaves the history alone");
    } finally {
      await h.destroy();
    }
  });

  await test("the card's own helpers never invent a record or an action", () => {
    assert.deepEqual(C.REMINDER_HISTORY_ACTIONS, ["alerted", "skipped", "done", "dismissed", "reopened", "snoozed", "rescheduled"]);
    const text = C.exportHistoryLines([{ id: "x", itemId: "i", occurrenceId: "i", action: "done", at: Date.now(), seq: 1, summary: "s" }]);
    assert.equal(text.trimEnd().split("\n").length, 1);
    assert.match(text, /^\d{4}-\d{2}-\d{2}T/);
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
