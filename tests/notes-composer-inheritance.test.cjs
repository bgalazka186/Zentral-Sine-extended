"use strict";
/* OW-11 / OW-131 — Composer 'Inherit' settings show their live resolved value and source layer
 * across Agenda window (enabled/lead/tail), item colour (now with an editable override),
 * category stage defaults, and reminder sound / quiet-hours bypass settings. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const notesSource = fs.readFileSync(path.join(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("pure describeInheritance resolves value, source layer, and Inherit label across agenda, color, notify, alert sound/quietAllow, and category", () => {
    assert.equal(typeof cal.describeInheritance, "function", "ZentralNotesCalendar exports describeInheritance");

    // 1. Agenda window: global -> category -> note -> item
    const baseLayers = {
      global: {
        agenda: { enabled: true, leadDays: 1 },
        alert: {
          stages: { pre: { sound: "quiet" }, due: { sound: "normal" }, followup: { sound: "loud" } },
          quietHours: { enabled: true, start: "22:00", end: "07:00", days: [1, 2, 3], allowed: { pre: [], due: ["loud"], followup: ["normal", "loud"] } },
        },
      },
    };
    assert.deepEqual(
      (({ value, source, label }) => ({ value, source, label }))(cal.describeInheritance("agenda.enabled", null, {})),
      { value: true, source: "global", label: "Inherit (Show in Agenda, from global defaults)" },
    );
    assert.deepEqual(
      (({ value, source, label }) => ({ value, source, label }))(cal.describeInheritance("agenda.leadDays", null, baseLayers)),
      { value: 1, source: "global", label: "Inherit (1 day, from global defaults)" },
    );
    assert.deepEqual(
      (({ value, source, label }) => ({ value, source, label }))(cal.describeInheritance("agenda.tailDays", null, baseLayers)),
      { value: 0, source: "global", label: "Inherit (Same day, from global defaults)" },
    );

    const withCat = {
      ...baseLayers,
      category: {
        name: "Work",
        color: "#4a90e2",
        agenda: { leadDays: 3, tailDays: 2 },
        notify: {
          pre: { enabled: true, leadMinutes: 7, sound: "silent", quietAllow: ["quiet", "loud"] },
          due: { enabled: false },
          followup: { enabled: true, delayMinutes: 15 },
        },
      },
    };
    assert.deepEqual(
      (({ value, source, sourceName, label }) => ({ value, source, sourceName, label }))(cal.describeInheritance("agenda.leadDays", null, withCat)),
      { value: 3, source: "category", sourceName: "Work", label: "Inherit (3 days, from category Work)" },
    );
    assert.deepEqual(
      (({ value, source, label }) => ({ value, source, label }))(cal.describeInheritance("agenda.enabled", null, withCat)),
      { value: true, source: "global", label: "Inherit (Show in Agenda, from global defaults)" },
    );

    const withNote = {
      ...withCat,
      note: {
        title: "Release Plan",
        color: "green",
        agenda: { enabled: false, leadDays: 5 },
        notify: { pre: { sound: "loud", quietAllow: ["normal"] } },
      },
    };
    assert.deepEqual(
      (({ value, source, sourceName, label }) => ({ value, source, sourceName, label }))(cal.describeInheritance("agenda.leadDays", null, withNote)),
      { value: 5, source: "note", sourceName: "Release Plan", label: "Inherit (5 days, from note Release Plan)" },
    );
    assert.deepEqual(
      (({ value, source, label }) => ({ value, source, label }))(cal.describeInheritance("agenda.tailDays", null, withNote)),
      { value: 2, source: "category", label: "Inherit (2 days, from category Work)" },
    );
    assert.deepEqual(
      (({ value, source, label }) => ({ value, source, label }))(cal.describeInheritance("agenda.enabled", null, withNote)),
      { value: false, source: "note", label: "Inherit (Hide from Agenda, from note Release Plan)" },
    );

    const overriddenItem = { x: { agendaWindow: { leadDays: 9 }, notify: { pre: { sound: "normal", leadMinutes: 2 } } } };
    const itemDesc = cal.describeInheritance("agenda.leadDays", overriddenItem, withNote);
    assert.equal(itemDesc.value, 9);
    assert.equal(itemDesc.source, "item");
    assert.equal(itemDesc.inherited.value, 5);
    assert.equal(itemDesc.inherited.source, "note");
    assert.equal(itemDesc.inherited.label, "Inherit (5 days, from note Release Plan)");

    // 2. Colour (T2.3g): note -> category -> none
    const noColor = cal.describeInheritance("color", null, {});
    assert.equal(noColor.value, "");
    assert.equal(noColor.source, "none");
    const catColor = cal.describeInheritance("color", null, { ...withCat, note: { title: "Plain", color: "none" } });
    assert.equal(catColor.value, "#4a90e2");
    assert.equal(catColor.source, "category");
    assert.match(catColor.label, /Inherit \(category Work colour: #4a90e2\)/);
    const noteColor = cal.describeInheritance("color", null, withNote);
    assert.equal(noteColor.value, "#4cc38a");
    assert.equal(noteColor.source, "note");
    assert.match(noteColor.label, /Inherit \(note Release Plan colour: green #4cc38a\)/);

    // 3. Category notify stage defaults
    const globalPre = cal.describeInheritance("notify.pre", null, {});
    assert.deepEqual(globalPre.value, { enabled: true, leadMinutes: 5 });
    assert.equal(globalPre.source, "global");
    assert.equal(globalPre.label, "Inherit (On, 5 min, from global defaults)");

    const catPre = cal.describeInheritance("notify.pre", null, withCat);
    assert.deepEqual(catPre.value, { enabled: true, leadMinutes: 7 });
    assert.equal(catPre.source, "category");
    assert.equal(catPre.label, "Inherit (On, 7 min, from category Work)");
    const catDue = cal.describeInheritance("notify.due", null, withCat);
    assert.deepEqual(catDue.value, { enabled: false });
    assert.equal(catDue.source, "category");
    assert.equal(catDue.label, "Inherit (Off, from category Work)");
    const catFollow = cal.describeInheritance("notify.followup", null, withCat);
    assert.deepEqual(catFollow.value, { enabled: true, delayMinutes: 15 });
    assert.equal(catFollow.label, "Inherit (On, 15 min, from category Work)");

    // 4. Alert sound & quietAllow: note -> category -> global
    assert.equal(cal.describeInheritance("alert.pre.sound", null, withNote).label, "Inherit (Loud, from note Release Plan)");
    assert.equal(cal.describeInheritance("alert.pre.sound", null, withCat).label, "Inherit (Silent, from category Work)");
    assert.equal(cal.describeInheritance("alert.due.sound", null, withNote).label, "Inherit (Normal, from global defaults)");
    assert.equal(cal.describeInheritance("alert.pre.quietAllow", null, withNote).label, "Inherit (normal, from note Release Plan)");
    assert.equal(cal.describeInheritance("alert.pre.quietAllow", null, withCat).label, "Inherit (quiet, loud, from category Work)");
    assert.equal(cal.describeInheritance("alert.due.quietAllow", null, withNote).label, "Inherit (loud, from global defaults)");
    assert.equal(cal.describeInheritance("alert.pre.quietAllow", null, {}).label, "Inherit (none, from global defaults)");

    // 5. Note-section category inheritance for list items
    const secCat = cal.describeInheritance("category", { x: { src: "list" } }, { sectionCategory: "Work", note: { title: "Roadmap" } });
    assert.equal(secCat.value, "Work");
    assert.equal(secCat.source, "note");
    assert.match(secCat.label, /Inherit \(Work, from note Roadmap section\)/);
  });

  await test("Create calendar item updates all Inherit labels live when Category or Linked note changes and preserves sparse inheritance on save", async () => {
    const dom = require("./helpers/fake-dom.cjs")();
    const { El, Ev, document, raf } = dom;
    El.prototype.ownerDocument = document;
    const files = new Map();
    const fixedNow = new Date(2026, 10, 16, 10, 0, 0).getTime();
    const win = {
      __zentralNotesParts: { "notes-calendar": cal }, document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {},
      requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, queueMicrotask,
      innerWidth: 1280, innerHeight: 860,
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    };
    win.window = win;
    vm.runInNewContext(notesSource, {
      window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {},
      console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" },
    });
    const core = win.__zentralNotesTestSeam.core;
    const flush = async () => { for (let i = 0; i < 6; i++) { raf.splice(0).forEach((fn) => fn()); await new Promise((r) => setImmediate(r)); } };

    const io = {
      join: (...parts) => parts.join("/"), filename: (v) => v.split("/").pop(),
      readUTF8: async (v) => { if (!files.has(v)) throw new Error("not found"); return files.get(v).text; },
      writeUTF8: async (v, text) => files.set(v, { text, mtime: fixedNow }),
      remove: async (v) => files.delete(v), exists: async (v) => files.has(v),
      children: async (dir) => [...files.keys()].filter((v) => v.startsWith(dir + "/") && !v.slice(dir.length + 1).includes("/")),
      stat: async (v) => ({ lastModified: files.get(v)?.mtime || 0 }), restrict: async () => {},
    };
    const store = core.createStore({
      io, notify() {}, windowId: "inherit-ui", now: () => fixedNow,
      getDir: async () => "/inherit-ui", getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout,
    });
    await store.open();

    const sprintNote = store.create("# Sprint Plan\n\nBody");
    store.setColor(sprintNote.id, "green");
    const plainNote = store.create("# Plain Inbox\n\nBody");
    store.setColor(plainNote.id, "none");

    store.items.upsertCategory({
      name: "Work",
      color: "#4a90e2",
      agenda: { leadDays: 3, tailDays: 2 },
      notify: {
        pre: { enabled: true, leadMinutes: 7, sound: "silent", quietAllow: ["quiet", "loud"] },
        due: { enabled: false },
        followup: { enabled: true, delayMinutes: 15 },
      },
    });
    store.items.upsertCategory({
      name: "Personal",
      color: "#d36aa6",
      agenda: { enabled: false },
      notify: {
        pre: { enabled: false, leadMinutes: 3 },
        due: { enabled: true, sound: "loud" },
        followup: { enabled: false, delayMinutes: 5 },
      },
    });

    store.setMeta({
      calendarCursor: "2026-11-16",
      calendarAgendaDefaults: { enabled: true, leadDays: 1, tailDays: 0 },
      calendarAlertSettings: {
        stages: { pre: { sound: "quiet" }, due: { sound: "normal" }, followup: { sound: "loud" } },
        quietHours: { enabled: true, start: "22:00", end: "07:00", days: [1, 2, 3], allowed: { pre: [], due: ["loud"], followup: [] } },
      },
      calendarNoteAgendaOverrides: { [sprintNote.id]: { leadDays: 5 } },
      calendarNoteAlertOverrides: { [sprintNote.id]: { pre: { sound: "loud", quietAllow: ["normal"] } } },
    });
    await store.flush();
    await store.items.flush();

    const host = document.createElement("div");
    document.body.append(host);
    const adapter = { position: "fixed", host, attach: (r) => host.append(r), getArea: () => ({ left: 0, top: 0, width: 1180, height: 780 }), watch: () => () => {}, setActive() {}, rewatch() {} };
    const env = {
      now: () => fixedNow,
      getPref: (_k, d) => d,
      setPref() {},
      openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {},
    };
    const sheet = core.createSheet({ store, adapter, env, ensureStore: () => Promise.resolve(store) });
    await sheet.open();
    await flush();

    // Open All notes -> '+' menu -> New reminder
    const titleBtn = sheet.root.querySelector(".zn-title");
    titleBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const newMenuBtn = sheet.root.querySelector(".zn-new-menu");
    newMenuBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    const newRemOpt = [...sheet.root.querySelectorAll(".zn-menu button")].find((b) => b.textContent.includes("New reminder"));
    assert.ok(newRemOpt, "New reminder option in '+' menu");
    newRemOpt.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();

    const card = sheet.root.querySelector(".zn-cal-compose-card");
    assert.ok(card, "Create calendar item composer opened");

    const inheritText = (ariaLabel) => {
      const sel = card.querySelector(`[aria-label="${ariaLabel}"]`);
      assert.ok(sel, `select ${ariaLabel}`);
      const opt = [...sel.querySelectorAll("option")].find((o) => o.getAttribute("value") === "");
      assert.ok(opt, `Inherit option on ${ariaLabel}`);
      return opt.textContent;
    };
    const colorLabel = card.querySelector(".zn-cal-compose-color-label");
    const notifyInherit = card.querySelector(".zn-cal-compose-notify-inherit");
    assert.ok(colorLabel, "composer colour label");
    assert.ok(notifyInherit, "composer reminder-alerts inheritance summary");

    // Initial state: no linked note, no category -> inherits from global defaults
    assert.equal(inheritText("Agenda inclusion"), "Inherit (Show in Agenda, from global defaults)");
    assert.equal(inheritText("Days before item to show in Agenda"), "Inherit (1 day, from global defaults)");
    assert.equal(inheritText("Days after item to keep in Agenda"), "Inherit (Same day, from global defaults)");
    assert.equal(inheritText("pre sound level"), "Inherit (Quiet, from global defaults)");
    assert.equal(inheritText("due sound level"), "Inherit (Normal, from global defaults)");
    assert.equal(inheritText("followup sound level"), "Inherit (Loud, from global defaults)");
    assert.match(colorLabel.textContent, /No inherited or category colour/);
    assert.match(notifyInherit.textContent, /from global defaults/);

    // Switch category -> Work (live update!)
    const catSelect = card.querySelector('[aria-label="Calendar category"]');
    catSelect.value = "Work";
    catSelect.dispatchEvent(new Ev("change", { bubbles: true }));
    await flush();

    assert.equal(inheritText("Agenda inclusion"), "Inherit (Show in Agenda, from global defaults)");
    assert.equal(inheritText("Days before item to show in Agenda"), "Inherit (3 days, from category Work)");
    assert.equal(inheritText("Days after item to keep in Agenda"), "Inherit (2 days, from category Work)");
    assert.equal(inheritText("pre sound level"), "Inherit (Silent, from category Work)");
    assert.equal(inheritText("due sound level"), "Inherit (Normal, from global defaults)");
    assert.match(colorLabel.textContent, /Inherit \(category Work colour: #4a90e2\)/);
    assert.match(notifyInherit.textContent, /from category Work/);
    assert.match(notifyInherit.textContent, /7 min/);
    assert.match(card.textContent, /Inherit \(quiet, loud, from category Work\)/);
    // OW-131: colour is now editable, not a read-only inheritance hint. The
    // override and Inherit control resolve against the same category layer.
    const colorInput = card.querySelector(".zn-cal-compose-color-input");
    const colorInheritBtn = card.querySelector(".zn-cal-compose-color-inherit");
    assert.ok(colorInput && colorInheritBtn, "the color input and Inherit control are present");
    colorInput.value = "#ff0000";
    colorInput.dispatchEvent(new Ev("change", { bubbles: true }));
    await flush();
    assert.match(colorLabel.textContent, /Custom item colour: #ff0000/);
    colorInheritBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();
    assert.match(colorLabel.textContent, /Effective item colour: Inherit \(category Work colour: #4a90e2\)/);

    // Switch category -> Personal (live update!)
    catSelect.value = "Personal";
    catSelect.dispatchEvent(new Ev("change", { bubbles: true }));
    await flush();

    assert.equal(inheritText("Agenda inclusion"), "Inherit (Hide from Agenda, from category Personal)");
    assert.equal(inheritText("Days before item to show in Agenda"), "Inherit (1 day, from global defaults)");
    assert.match(colorLabel.textContent, /Inherit \(category Personal colour: #d36aa6\)/);
    assert.match(notifyInherit.textContent, /from category Personal/);

    // Switch category back to Work and link Sprint Plan note (note layer beats category layer live!)
    catSelect.value = "Work";
    catSelect.dispatchEvent(new Ev("change", { bubbles: true }));
    const noteSelect = card.querySelector('[aria-label="Linked note"]');
    noteSelect.value = sprintNote.id;
    noteSelect.dispatchEvent(new Ev("change", { bubbles: true }));
    await flush();

    assert.equal(inheritText("Days before item to show in Agenda"), "Inherit (5 days, from note Sprint Plan)");
    assert.equal(inheritText("Days after item to keep in Agenda"), "Inherit (2 days, from category Work)");
    assert.equal(inheritText("pre sound level"), "Inherit (Loud, from note Sprint Plan)");
    assert.match(card.textContent, /Inherit \(normal, from note Sprint Plan\)/);
    assert.match(colorLabel.textContent, /Inherit \(note Sprint Plan colour: green #4cc38a\)/);

    // Switch linked note to Plain Inbox (color: none) -> colour falls back to category Work, agenda leadDays falls back to category Work
    noteSelect.value = plainNote.id;
    noteSelect.dispatchEvent(new Ev("change", { bubbles: true }));
    await flush();

    assert.equal(inheritText("Days before item to show in Agenda"), "Inherit (3 days, from category Work)");
    assert.match(colorLabel.textContent, /Inherit \(category Work colour: #4a90e2\)/);

    // Save reminder with Inherit left selected -> sparse persistence (no agendaWindow or sound overrides written)
    card.querySelector('[aria-label="Title"]').value = "Check inherited save";
    const saveBtn = [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === "Create reminder");
    saveBtn.dispatchEvent(new Ev("click", { bubbles: true }));
    await flush();

    const created = store.items.list().find((it) => it.summary === "Check inherited save");
    assert.ok(created, "reminder saved");
    assert.deepEqual(created.x.agendaWindow || {}, {}, "leaving Agenda controls on Inherit keeps item agendaWindow sparse");
    assert.equal(created.x.notify.pre.sound, undefined, "leaving sound on Inherit keeps item sound sparse");
  });

  console.log(`\n${passed} composer inheritance tests passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
