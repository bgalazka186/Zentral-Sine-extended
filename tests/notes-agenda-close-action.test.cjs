"use strict";
/* SB6.6: what the X on an Agenda tab does.
 *
 * Closing an Agenda row used to be a no-op: the next reconciliation put the tab straight back, which reads as a broken
 * close button. The preference picks between hiding that item for the rest of the local day (the default), running
 * Dismiss for a reminder, and the old "come back right away" behaviour.
 *
 * The hidden key carries the day it was hidden on, so a multi-day event keeps its other days and a repeating reminder is
 * back tomorrow without a timer; and a row removed by the projection itself is never mistaken for a person's close. */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const AGENDA = "zen.workspace.zentral.notes.agenda_folder";
const CLOSE = "zen.workspace.zentral.notes.agenda_close_action";
const MARK = "bgalazka-notes-agenda-item";
const date = (days, hour = 12) => C.addDays(C.dayStart(Date.now()), days) + hour * 3600000;
const make = (id, start, end, x = {}) => C.makeItem({ id, summary: id, start: { dateTime: new Date(start).toISOString() }, ...(end ? { end: { dateTime: new Date(end).toISOString() } } : {}), x: { kind: end ? "event" : "reminder", src: "manual", ...x } }, Date.now());
const projected = (host) => host.document.querySelectorAll(`tab[${MARK}]`).filter((tab) => !tab.getAttribute(MARK).startsWith("seed:"));
const keys = (host) => projected(host).map((tab) => tab.getAttribute(MARK)).sort();

async function host(prefs = {}) {
  const h = createFakeZen({ prefs: { [AGENDA]: true, ...prefs } });
  await h.seam.ensureStore();
  h.fireTimer(6500);
  await Promise.resolve();
  return h;
}
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok - " + name); }

(async () => {
  await test("the default hides the closed item for today, and only that item", async () => {
    const h = await host();
    h.seam.store.items.upsert(make("closed", date(1), date(1, 13)));
    h.seam.store.items.upsert(make("kept", date(1), null));
    h.seam.agendaController.runNow();
    const [victim] = projected(h).filter((tab) => tab.getAttribute("bgalazka-notes-agenda-item-id") === "closed");
    assert.ok(victim, "the item is projected");
    const victimKey = victim.getAttribute(MARK);
    h.window.gBrowser.removeTab(victim);
    h.seam.agendaController.runNow();
    assert.deepEqual(keys(h), [projected(h)[0].getAttribute(MARK)], "one row left");
    assert.equal(projected(h)[0].getAttribute("bgalazka-notes-agenda-item-id"), "kept");
    assert.ok(h.seam.agendaClosedSet().has(victimKey), "the key is remembered for today");
    // A second reconciliation does not resurrect it either.
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 1);
    await h.destroy();
  });

  await test("a closed multi-day event keeps its other days", async () => {
    const h = await host();
    h.seam.store.items.upsert(C.makeItem({ id: "span", summary: "span", start: { date: C.localDateKey(date(1)) }, end: { date: C.localDateKey(date(4)) }, x: { kind: "event", src: "manual" } }));
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 3);
    h.window.gBrowser.removeTab(projected(h)[0]);
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 2, "only the closed day is gone");
    const days = projected(h).map((tab) => tab.closest("zen-folder").getAttribute("bgalazka-notes-agenda-day")).sort();
    assert.deepEqual(days, [C.localDateKey(date(2)), C.localDateKey(date(3))]);
    await h.destroy();
  });

  await test("a day whose last row is closed loses its folder too", async () => {
    const h = await host();
    h.seam.store.items.upsert(make("only", date(1), date(1, 13)));
    h.seam.agendaController.runNow();
    const day = projected(h)[0].closest("zen-folder");
    h.window.gBrowser.removeTab(projected(h)[0]);
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 0);
    assert.equal(day.isConnected, false, "the empty day folder is retired");
    await h.destroy();
  });

  await test("'reappear' keeps the old behaviour: the row comes back", async () => {
    const h = await host({ [CLOSE]: "reappear" });
    h.seam.store.items.upsert(make("again", date(1), date(1, 13)));
    h.seam.agendaController.runNow();
    h.window.gBrowser.removeTab(projected(h)[0]);
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 1);
    assert.equal(h.seam.agendaClosedSet().size, 0, "nothing is remembered");
    await h.destroy();
  });

  await test("'dismiss' dismisses a reminder and remembers its state", async () => {
    const h = await host({ [CLOSE]: "dismiss" });
    const item = make("dismiss-me", date(1));
    h.seam.store.items.upsert(item);
    h.seam.agendaController.runNow();
    const tab = projected(h)[0];
    const identity = C.reminderIdentity(h.seam.store.items.get("dismiss-me"));
    h.window.gBrowser.removeTab(tab);
    await settle();
    h.seam.agendaController.runNow();
    assert.equal(h.seam.store.items.history.stateFor(identity.itemId, identity.occurrenceId), "dismissed");
    assert.equal(projected(h).length, 0, "a dismissed reminder is not projected again");
    await h.destroy();
  });

  await test("'dismiss' hides an event for today instead, because an event has no Dismiss", async () => {
    const h = await host({ [CLOSE]: "dismiss" });
    h.seam.store.items.upsert(make("event", date(1), date(1, 13)));
    h.seam.agendaController.runNow();
    const key = projected(h)[0].getAttribute(MARK);
    h.window.gBrowser.removeTab(projected(h)[0]);
    await settle();
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 0);
    assert.ok(h.seam.agendaClosedSet().has(key), "the fallback is the day hide");
    await h.destroy();
  });

  await test("a row the projection removes itself is not treated as a person's close", async () => {
    const h = await host();
    h.seam.store.items.upsert(make("snoozed", date(1)));
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 1);
    // Mark it done: the projection drops the row and closes its own tab. That must not hide anything for the day.
    h.seam.store.runAgendaCommand(h.seam.store.items.get("snoozed"), "mark-done");
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 0);
    assert.equal(h.seam.agendaClosedSet().size, 0, "our own removal leaves no trace");
    // Reopening it brings the row back the same day.
    h.seam.store.runAgendaCommand(h.seam.store.items.get("snoozed"), "reopen");
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 1);
    await h.destroy();
  });

  await test("closing the seed or a folder header is never a hide", async () => {
    const h = await host();
    h.seam.store.items.upsert(make("some", date(1), date(1, 13)));
    h.seam.agendaController.runNow();
    const root = h.document.querySelector('zen-folder[bgalazka-notes-agenda-folder="true"]');
    assert.equal(h.seam.agendaOnTabClosed(root), false, "a folder is not a tab");
    const seedUrl = "about:blank#zn-agenda-" + encodeURIComponent("seed:root");
    const seed = h.window.gBrowser.addTab(seedUrl);
    seed.setAttribute(MARK, "seed:root");
    seed._zentralNotesUrl = seedUrl;
    root.addTabs([seed]);
    assert.equal(h.seam.agendaOnTabClosed(seed), false, "a seed is never a hide");
    assert.equal(h.seam.agendaOnTabClosed(null), false);
    assert.equal(h.seam.agendaClosedSet().size, 0);
    await h.destroy();
  });

  await test("routing a transient pseudo-tab closes nothing of the person's", async () => {
    const h = await host();
    h.seam.store.items.upsert(make("existing", date(1), date(1, 13)));
    h.seam.agendaController.runNow();
    // A blank tab inside the Agenda root is routed (and closed) by the navigation handler, never by a person: the
    // item it points at must stay visible afterwards.
    const stray = h.window.gBrowser.addTab("about:blank#zn-agenda-" + encodeURIComponent("item:existing:existing@x"), { deferTabOpen: true });
    h.document.querySelector('zen-folder[bgalazka-notes-agenda-folder="true"]').append(stray);
    h.emit("TabOpen", stray);
    await settle();
    assert.equal(stray.isConnected, false, "the transient tab is gone");
    assert.equal(h.seam.agendaClosedSet().size, 0, "routing hid nothing for the day");
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 1, "the real row is still there");
    await h.destroy();
  });

  await test("the hidden set is per local day", async () => {
    const h = await host();
    h.seam.store.items.upsert(make("tomorrow", date(1), date(1, 13)));
    h.seam.agendaController.runNow();
    h.window.gBrowser.removeTab(projected(h)[0]);
    h.seam.agendaController.runNow();
    assert.equal(projected(h).length, 0);
    h.advanceClock(26 * 3600000);
    h.seam.agendaController.runNow();
    assert.equal(h.seam.agendaClosedSet().size, 0, "yesterday's hides are forgotten");
    await h.destroy();
  });

  await test("the preference value is read defensively", () => {
    assert.equal(C.cleanAgendaCloseAction("dismiss"), "dismiss");
    assert.equal(C.cleanAgendaCloseAction("reappear"), "reappear");
    assert.equal(C.cleanAgendaCloseAction("hide-today"), "hide-today");
    assert.equal(C.cleanAgendaCloseAction(""), "hide-today");
    assert.equal(C.cleanAgendaCloseAction("nonsense"), "hide-today");
    assert.equal(C.cleanAgendaCloseAction(undefined), "hide-today");
    assert.deepEqual([...C.AGENDA_CLOSE_ACTIONS], ["hide-today", "dismiss", "reappear"]);
  });

  await test("applyAgendaClosedDays keeps the shape of a projection", () => {
    const days = [
      { key: "day:2026-11-17", date: "2026-11-17", count: 2, items: [{ key: "a" }, { key: "b" }] },
      { key: "day:2026-11-18", date: "2026-11-18", count: 1, items: [{ key: "c" }] },
    ];
    const out = C.applyAgendaClosedDays(days, new Set(["a"]));
    assert.deepEqual(out.map((day) => day.items.map((item) => item.key)), [["b"], ["c"]]);
    assert.equal(out[0].count, 1, "the count follows the rows");
    assert.deepEqual(C.applyAgendaClosedDays(days, new Set(["a", "b"])).map((day) => day.date), ["2026-11-18"]);
    assert.equal(C.applyAgendaClosedDays(days, new Set()).length, 2, "an empty set changes nothing");
    assert.equal(C.applyAgendaClosedDays(days, new Set()) [0], days[0], "and returns the same objects");
    assert.deepEqual(C.applyAgendaClosedDays(null, new Set(["a"])), []);
  });

  console.log("\nPASS notes-agenda-close-action (" + passed + " tests)");
})().catch((error) => { console.error(error); process.exit(1); });
