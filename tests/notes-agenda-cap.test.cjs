"use strict";
/* SB6.4: Cap the number of Agenda sidebar tabs ('Max items in sidebar', default 40),
 * distributing budget earliest-first across day folders and rendering a single '+N more…'
 * node ('more:agenda') that opens Day/Agenda view on the first overflowed day. */
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const plTable = require("../additional/notes/i18n/pl.js");

const AGENDA_PREF = "zen.workspace.zentral.notes.agenda_folder";
const DAYS_PREF = "zen.workspace.zentral.notes.agenda_days";
const MAX_ITEMS_PREF = "zen.workspace.zentral.notes.agenda_max_items";
const LANG_PREF = "zen.workspace.zentral.notes.language";
const MARK = "bgalazka-notes-agenda-item";

const date = (days, hour = 9, min = 0) => C.addDays(C.dayStart(Date.now()), days) + hour * 3600000 + min * 60000;
const makeItem = (id, startMs) => C.makeItem({
  id,
  summary: id,
  start: { dateTime: new Date(startMs).toISOString() },
  x: { kind: "reminder", src: "manual" },
}, Date.now());
const allAgendaTabs = (h) => h.document.querySelectorAll(`tab[${MARK}]`).filter((tab) => !tab.getAttribute(MARK).startsWith("seed:"));

async function flush(n = 8) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("pure: applyAgendaItemCap distributes earliest-first, collapses overflow into '+N more…', and localizes EN/PL", () => {
    const mkDay = (dateKey, count) => ({
      key: "day:" + dateKey,
      date: dateKey,
      label: dateKey,
      count,
      items: Array.from({ length: count }, (_, i) => ({ key: `item:${dateKey}-${i}@${dateKey}`, summary: `${dateKey}-${i}` })),
    });
    const days = [mkDay("2026-11-16", 3), mkDay("2026-11-17", 4), mkDay("2026-11-18", 5)];

    // Unlimited or within cap -> unchanged, no more node
    const uncapped = C.applyAgendaItemCap(days, 0);
    assert.equal(uncapped.days.length, 3);
    assert.equal(uncapped.hiddenCount, 0);
    assert.equal(uncapped.more, null);

    const exact = C.applyAgendaItemCap(days, 12);
    assert.equal(exact.hiddenCount, 0);
    assert.equal(exact.more, null);

    // Mid-day split (cap = 5): Day 1 gets 3, Day 2 gets 2, Day 3 omitted; hiddenCount = 7; openDate = Day 2
    const mid = C.applyAgendaItemCap(days, 5, { lang: "en" });
    assert.equal(mid.days.length, 2);
    assert.equal(mid.days[0].items.length, 3);
    assert.equal(mid.days[1].items.length, 2);
    assert.equal(mid.hiddenCount, 7);
    assert.ok(mid.more);
    assert.equal(mid.more.key, "more:agenda");
    assert.equal(mid.more.label, "+7 more\u2026");
    assert.equal(mid.more.openDate, "2026-11-17");

    // Exact day boundary (cap = 3): Day 1 gets 3, Day 2 & 3 omitted; openDate = Day 2
    const boundary = C.applyAgendaItemCap(days, 3, { lang: "pl" });
    assert.equal(boundary.days.length, 1);
    assert.equal(boundary.days[0].items.length, 3);
    assert.equal(boundary.hiddenCount, 9);
    assert.equal(boundary.more.openDate, "2026-11-17");
    assert.equal(boundary.more.label, plTable.strings["sidebar.agenda.moreLabel"].replace("{count}", "9"));
  });

  await test("host: default 40-item cap distributes earliest-first across days, stays structurally idempotent, and updates live on pref change", async () => {
    const h = createFakeZen({ prefs: { [AGENDA_PREF]: true, [DAYS_PREF]: 6 } });
    try {
      await h.seam.ensureStore();
      h.fireTimer(6500);
      await flush(4);

      // 50 items: 10 per day across 5 days (Today .. T+4)
      for (let d = 0; d < 5; d++) {
        for (let i = 0; i < 10; i++) {
          h.seam.store.items.upsert(makeItem(`d${d}-i${i}`, date(d, 9, i)));
        }
      }
      h.seam.agendaController.runNow();

      const tabs = allAgendaTabs(h);
      const itemTabs = tabs.filter((t) => t.getAttribute(MARK).startsWith("item:"));
      const moreTabs = tabs.filter((t) => t.getAttribute(MARK) === "more:agenda");
      assert.equal(itemTabs.length, 40, "default cap limits sidebar to 40 item tabs");
      assert.equal(moreTabs.length, 1, "single '+N more…' tab appended");
      assert.equal(moreTabs[0].getAttribute("label"), "+10 more\u2026");
      assert.equal(moreTabs[0].getAttribute("bgalazka-notes-agenda-kind"), "more");
      assert.equal(moreTabs[0].getAttribute("bgalazka-notes-agenda-day"), C.localDateKey(date(4, 9, 0)), "openDate points to the first hidden day (T+4)");

      // Earliest 4 days kept (Today..T+3 = 40 items); 5th day folder omitted
      const dayFolders = h.document.querySelectorAll("zen-folder[bgalazka-notes-agenda-day]");
      assert.equal(dayFolders.length, 4, "overflowed 5th day creates no empty day folder");

      // Structurally idempotent on subsequent runNow()
      h.resetOperations();
      h.seam.agendaController.runNow();
      assert.deepEqual(h.operations, [], "capped Agenda reconciliation is structurally idempotent");

      // Lower cap live to 15 -> Day 0 (10) + Day 1 (5) + '+35 more…' (openDate = Day 1)
      h.setPref(MAX_ITEMS_PREF, 15);
      h.seam.agendaController.runNow();
      const tabs15 = allAgendaTabs(h);
      assert.equal(tabs15.filter((t) => t.getAttribute(MARK).startsWith("item:")).length, 15);
      const more15 = tabs15.find((t) => t.getAttribute(MARK) === "more:agenda");
      assert.equal(more15.getAttribute("label"), "+35 more\u2026");
      assert.equal(more15.getAttribute("bgalazka-notes-agenda-day"), C.localDateKey(date(1, 9, 0)));

      // Polish label update
      h.setPref(LANG_PREF, "pl");
      h.seam.agendaController.runNow();
      assert.equal(allAgendaTabs(h).find((t) => t.getAttribute(MARK) === "more:agenda").getAttribute("label"), "+35 wi\u0119cej\u2026");
      h.setPref(LANG_PREF, "en");

      // Raise cap live to 60 -> all 50 items shown, '+N more…' removed
      h.setPref(MAX_ITEMS_PREF, 60);
      h.seam.agendaController.runNow();
      const tabs60 = allAgendaTabs(h);
      assert.equal(tabs60.filter((t) => t.getAttribute(MARK).startsWith("item:")).length, 50);
      assert.equal(tabs60.filter((t) => t.getAttribute(MARK) === "more:agenda").length, 0);
    } finally {
      await h.destroy();
    }
  });

  await test("clicking '+N more…' opens Day/Agenda view directly on the first overflowed day", async () => {
    const h = createFakeZen({ prefs: { [AGENDA_PREF]: true, [DAYS_PREF]: 5, [MAX_ITEMS_PREF]: 5 } });
    try {
      await h.seam.ensureStore();
      h.fireTimer(6500);
      await flush(4);
      for (let d = 0; d < 3; d++) {
        for (let i = 0; i < 3; i++) {
          h.seam.store.items.upsert(makeItem(`c${d}-${i}`, date(d, 10, i)));
        }
      }
      h.seam.agendaController.runNow();
      const moreTab = allAgendaTabs(h).find((t) => t.getAttribute(MARK) === "more:agenda");
      assert.ok(moreTab);
      const expectedDay = C.localDateKey(date(1, 10, 0));
      assert.equal(moreTab.getAttribute("bgalazka-notes-agenda-day"), expectedDay);

      const fireMouse = (type) => h.seam.onAgendaMouse({
        type,
        button: 0,
        clientX: 15,
        clientY: 15,
        target: moreTab,
        composedPath: () => [moreTab],
        preventDefault() {},
        stopImmediatePropagation() {},
      });
      fireMouse("mousedown");
      fireMouse("mouseup");
      fireMouse("click");
      await flush(12);

      const calPane = h.document.querySelector(".zn-calendar-pane");
      assert.ok(calPane && !calPane.hidden, "clicking '+N more…' opens Calendar/Day view");
      assert.equal(h.seam.store.meta.calendarView, "day");
      assert.equal(h.seam.store.meta.calendarCursor, expectedDay, "opens directly on the day of the first hidden item");
    } finally {
      await h.destroy();
    }
  });

  console.log(`\nPASS notes-agenda-cap (${passed} tests)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
