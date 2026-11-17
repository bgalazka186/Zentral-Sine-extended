"use strict";
/* AU-B4b: Comprehensive EN + PL UI internationalization tests across all 7 roadmap areas,
 * strict dictionary parity, static key scanning, plural rules, per-key fallback, and live language switching. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const enTable = require("../additional/notes/i18n/en.js");
const plTable = require("../additional/notes/i18n/pl.js");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const notesSource = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
const calSource = fs.readFileSync(path.join(ROOT, "additional/notes/calendar/ZentralNotesCalendar.js"), "utf8");
const standaloneManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "additional/notes/standalone.json"), "utf8"));

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok -", name);
}

function makeFakeNotesEnv({ withCalendar = true, initialLang = "en" } = {}) {
  const dom = require("./helpers/fake-dom.cjs")();
  const { El, Ev, document, raf } = dom;
  El.prototype.ownerDocument = document;
  const prefs = new Map([
    ["zen.workspace.zentral.notes.language", initialLang],
    ["zen.workspace.zentral.notes.language_accept_all", true],
  ]);
  const prefObservers = [];
  const Services = {
    prefs: {
      getBoolPref: (k, d) => (prefs.has(k) ? !!prefs.get(k) : d),
      getStringPref: (k, d) => (prefs.has(k) ? String(prefs.get(k)) : d),
      getIntPref: (k, d) => (prefs.has(k) ? Number(prefs.get(k)) : d),
      setBoolPref: (k, v) => { prefs.set(k, !!v); prefObservers.forEach((o) => o.observe?.(null, "nsPref:changed", k)); },
      setStringPref: (k, v) => { prefs.set(k, String(v)); prefObservers.forEach((o) => o.observe?.(null, "nsPref:changed", k)); },
      setIntPref: (k, v) => { prefs.set(k, Number(v)); prefObservers.forEach((o) => o.observe?.(null, "nsPref:changed", k)); },
      addObserver: (_b, o) => prefObservers.push(o),
      removeObserver: (_b, o) => { const i = prefObservers.indexOf(o); if (i >= 0) prefObservers.splice(i, 1); },
    },
    obs: { addObserver() {}, removeObserver() {}, notifyObservers() {} },
  };
  const win = {
    document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    __zentralNotesLangTables: { en: enTable, pl: plTable },
    __zentralNotesParts: withCalendar ? { "notes-calendar": cal } : {},
    requestAnimationFrame: (fn) => raf.push(fn),
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    innerWidth: 1280,
    innerHeight: 820,
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;
  vm.runInNewContext(notesSource, {
    window: win,
    document,
    Event: Ev,
    globalThis: { Services },
    Services,
    ChromeUtils: {},
    console,
    URL,
    Date,
    JSON,
    Math,
    Promise,
    RegExp,
    Number,
    Map,
    Set,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    navigator: { platform: "Linux" },
    Uint8Array,
  });
  const core = win.__zentralNotesTestSeam.core;
  const files = new Map();
  const dirs = new Set(["/n"]);
  const io = {
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => { if (!files.has(p)) { const e = new Error("nf"); e.code = "ENOENT"; throw e; } return files.get(p).text; },
    writeUTF8: async (p, text) => files.set(p, { text, mtime: Date.now() }),
    remove: async (p) => files.delete(p),
    exists: async (p) => files.has(p) || dirs.has(p),
    children: async (d) => [...new Set([...dirs, ...files.keys()])].filter((k) => k.startsWith(d + "/") && !k.slice(d.length + 1).includes("/")),
    stat: async (p) => files.has(p) ? { type: "regular", size: (files.get(p).text || "").length, lastModified: files.get(p).mtime } : { type: "directory", size: 0, lastModified: 0 },
    restrict: async () => {},
    makeDir: async (p) => { for (let x = p; x && x !== "/"; x = x.slice(0, x.lastIndexOf("/")) || "/") dirs.add(x); },
  };
  const store = core.createStore({
    io,
    notify() {},
    windowId: "i18n-test",
    getDir: async () => "/n",
    getMaxSaveMs: () => 5000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    warn() {},
  });
  const env = {
    openLink() {},
    copyText() {},
    exportNote() {},
    exportAll() {},
    revealFolder() {},
    getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d),
    setPref: (k, v) => {
      if (typeof v === "boolean") Services.prefs.setBoolPref(k, v);
      else if (typeof v === "number") Services.prefs.setIntPref(k, v);
      else Services.prefs.setStringPref(k, v);
    },
  };
  const host = new El("div");
  const adapter = {
    position: "fixed",
    host,
    attach: (r) => host.appendChild(r),
    getArea: () => ({ left: 0, top: 0, width: 960, height: 680, anchor: "top" }),
    watch: () => () => {},
    setActive() {},
    rewatch() {},
  };
  const flushRaf = async () => {
    for (let i = 0; i < 5; i++) {
      raf.splice(0).forEach((fn) => fn());
      await new Promise((r) => setImmediate(r));
    }
  };
  return { win, dom, El, Ev, document, core, store, env, adapter, prefs, Services, flushRaf };
}

function allText(node) {
  if (!node) return "";
  const parts = [];
  const walk = (el) => {
    if (!el) return;
    if (typeof el.textContent === "string" && !el.children?.length) parts.push(el.textContent);
    for (const c of el.children || []) walk(c);
  };
  walk(node);
  return parts.join(" ");
}

(async () => {
  await test("1. Strict bidirectional EN/PL dictionary parity, non-empty values, and placeholder match", () => {
    const enStr = enTable.strings || {};
    const plStr = plTable.strings || {};
    const enKeys = Object.keys(enStr).sort();
    const plKeys = Object.keys(plStr).sort();
    assert.ok(enKeys.length >= 500, `expected rich dictionary, got ${enKeys.length}`);
    assert.deepEqual(plKeys, enKeys, "EN and PL dictionaries must have identical key sets");
    assert.deepEqual(cal.missingTranslationKeys("pl"), [], "PL must have zero missing keys vs EN");
    assert.deepEqual(cal.translationKeys("pl"), cal.translationKeys("en"));

    const phRe = /\{([a-zA-Z0-9_]+)\}/g;
    for (const key of enKeys) {
      assert.equal(typeof enStr[key], "string", `en.${key} is string`);
      assert.equal(typeof plStr[key], "string", `pl.${key} is string`);
      assert.ok(enStr[key].length > 0, `en.${key} is non-empty`);
      assert.ok(plStr[key].length > 0, `pl.${key} is non-empty`);
      const enPh = [...enStr[key].matchAll(phRe)].map((m) => m[1]).sort();
      const plPh = [...plStr[key].matchAll(phRe)].map((m) => m[1]).sort();
      assert.deepEqual(plPh, enPh, `placeholder mismatch on key ${key}`);
    }
  });

  await test("2. Static scan: every t()/tCount()/i18nKey reference in Notes & Calendar resolves to real keys", () => {
    const enKeys = new Set(Object.keys(enTable.strings));
    for (const [name, src] of [
      ["ZentralNotesCalendar.js", calSource],
      ["ZentralNotes.uc.js", notesSource],
    ]) {
      const missing = [];
      for (const m of src.matchAll(/\b(?:t|tr|translate)\(\s*"([a-z0-9._-]+)"/g)) {
        const k = m[1];
        if (k.endsWith(".")) {
          if (![...enKeys].some((x) => x.startsWith(k))) missing.push(`prefix:${k}`);
        } else if (!enKeys.has(k)) {
          missing.push(`t:${k}`);
        }
      }
      for (const m of src.matchAll(/\btCount\(\s*"([a-z0-9._-]+)"/g)) {
        const base = m[1];
        for (const suffix of ["one", "few", "other"]) {
          if (!enKeys.has(`${base}.${suffix}`)) missing.push(`tCount:${base}.${suffix}`);
        }
      }
      for (const m of src.matchAll(/i18nKey:\s*"([^"]+)"/g)) {
        if (!enKeys.has(m[1])) missing.push(`i18nKey:${m[1]}`);
      }
      for (const m of src.matchAll(/"((?:sidebar|hover|compose|tree|settings|cal|menu|alert|toast|common)\.[a-zA-Z0-9._-]+)"/g)) {
        const k = m[1];
        if (k.endsWith(".")) {
          if (![...enKeys].some((x) => x.startsWith(k))) missing.push(`str-prefix:${k}`);
        } else if (!enKeys.has(k) && !enKeys.has(`${k}.one`)) {
          missing.push(`str:${k}`);
        }
      }
      assert.deepEqual([...new Set(missing)], [], `${name} has undefined i18n keys`);
    }
    // Standalone bundle loads en.js & pl.js before ZentralNotesCalendar.js.
    const inc = standaloneManifest.include || [];
    const enIdx = inc.indexOf("i18n/en.js");
    const plIdx = inc.indexOf("i18n/pl.js");
    const calIdx = inc.indexOf("calendar/ZentralNotesCalendar.js");
    assert.ok(enIdx >= 0 && plIdx >= 0 && calIdx > enIdx && calIdx > plIdx, "standalone.json embeds i18n tables before calendar");
  });

  await test("3. Pluralization rules (EN & PL) and per-key English fallback on partial custom language pack", () => {
    // English plural rules
    assert.equal(cal.pluralCategory(1, "en"), "one");
    for (const n of [0, 2, 3, 4, 5, 12, 22]) assert.equal(cal.pluralCategory(n, "en"), "other");
    // Polish plural rules (1 -> one; 2..4, 22..24 -> few; 0, 5..21, 25 -> other)
    assert.equal(cal.pluralCategory(1, "pl"), "one");
    for (const n of [2, 3, 4, 22, 23, 24, 102, 104]) assert.equal(cal.pluralCategory(n, "pl"), "few", `pl(${n})`);
    for (const n of [0, 5, 6, 11, 12, 13, 14, 15, 20, 21, 25, 100, 112]) assert.equal(cal.pluralCategory(n, "pl"), "other", `pl(${n})`);

    assert.equal(cal.tCount("cal.days", 1, null, "en"), "1 day");
    assert.equal(cal.tCount("cal.days", 3, null, "en"), "3 days");
    assert.equal(cal.tCount("cal.days", 1, null, "pl"), "1 dzień");
    assert.equal(cal.tCount("cal.days", 3, null, "pl"), "3 dni");
    assert.equal(cal.tCount("cal.items", 1, null, "pl"), "1 element");
    assert.equal(cal.tCount("cal.items", 2, null, "pl"), "2 elementy");
    assert.equal(cal.tCount("cal.items", 5, null, "pl"), "5 elementów");
    assert.equal(cal.tCount("cal.items", 12, null, "pl"), "12 elementów");
    assert.equal(cal.tCount("cal.items", 22, null, "pl"), "22 elementy");
    assert.equal(cal.tCount("tree.batch.notes", 1, null, "pl"), "1 notatka");
    assert.equal(cal.tCount("tree.batch.notes", 3, null, "pl"), "3 notatki");
    assert.equal(cal.tCount("tree.batch.notes", 5, null, "pl"), "5 notatek");

    // Partial custom language pack falls back to English per key
    cal.registerLanguage({
      code: "zz",
      locale: "en-GB",
      name: "Partial Test",
      strings: { "cal.heading": "Kalendarz-ZZ" },
    });
    assert.equal(cal.t("cal.heading", null, "zz"), "Kalendarz-ZZ");
    assert.equal(cal.t("common.cancel", null, "zz"), "Cancel", "missing key in partial pack falls back to English");
    assert.ok(cal.missingTranslationKeys("zz").includes("common.cancel"));

    // Fallback inside ZentralNotes.uc.js even when CALENDAR_PART is missing
    const noCal = makeFakeNotesEnv({ withCalendar: false, initialLang: "pl" });
    assert.equal(noCal.core.t("tree.chip.trash"), "Kosz");
    assert.equal(noCal.core.tCount("tree.batch.notes", 3), "3 notatki");
    assert.equal(noCal.core.t("cal.heading", null, "en"), "Calendar");
  });

  await test("4. Area 3 & Area 4 pure models: menus, action messages, alert cards, countdowns, and missed digest in EN & PL", () => {
    const reminder = { id: "r1", summary: "Pay bill", start: { dateTime: "2026-11-16T09:00:00.000Z" }, x: { kind: "reminder", src: "manual" } };
    const flat = (rows) => rows.flatMap((r) => (Array.isArray(r?.group) ? [r, ...r.group] : [r]));

    const enMenu = flat(cal.calendarItemMenuModel(reminder, { state: "pending", historyWritable: true, agendaWritable: true, lang: "en" }));
    const plMenu = flat(cal.calendarItemMenuModel(reminder, { state: "pending", historyWritable: true, agendaWritable: true, lang: "pl" }));
    assert.equal(enMenu.find((r) => r.command === "mark-done")?.label, enTable.strings["menu.markDone"]);
    assert.equal(plMenu.find((r) => r.command === "mark-done")?.label, plTable.strings["menu.markDone"]);
    assert.notEqual(plMenu.find((r) => r.command === "mark-done")?.label, enMenu.find((r) => r.command === "mark-done")?.label);
    assert.equal(plMenu.find((r) => r.command === "snooze-1d")?.label, plTable.strings["menu.snooze1d"]);
    assert.equal(plMenu.find((r) => r.command === "dismiss")?.label, plTable.strings["menu.dismiss"]);

    assert.equal(cal.agendaActionMessage("mark-done", { lang: "en" }), enTable.strings["toast.agenda.markDone"]);
    assert.equal(cal.agendaActionMessage("mark-done", { lang: "pl" }), plTable.strings["toast.agenda.markDone"]);
    assert.equal(cal.agendaActionMessage("snooze-1h", { lang: "pl" }), plTable.strings["toast.agenda.snooze1h"]);
    assert.equal(cal.agendaActionMessage("duplicate", { lang: "pl" }), plTable.strings["toast.agenda.duplicated"]);

    const preEn = cal.reminderAlertPresentation("pre", null, "en");
    const prePl = cal.reminderAlertPresentation("pre", null, "pl");
    assert.equal(preEn.stage, "pre");
    assert.equal(prePl.stage, "pre");
    assert.equal(preEn.label, enTable.strings["alert.stage.pre"]);
    assert.equal(prePl.label, plTable.strings["alert.stage.pre"]);

    const baseNow = 1794800000000;
    assert.equal(cal.reminderPreCountdownText(baseNow, baseNow, "en"), enTable.strings["alert.countdown.dueNow"]);
    assert.equal(cal.reminderPreCountdownText(baseNow, baseNow, "pl"), plTable.strings["alert.countdown.dueNow"]);
    assert.equal(cal.reminderPreCountdownText(baseNow + 120000, baseNow, "en"), cal.t("alert.countdown.minSec", { m: 2, s: "00" }, "en"));
    assert.equal(cal.reminderPreCountdownText(baseNow + 120000, baseNow, "pl"), cal.t("alert.countdown.minSec", { m: 2, s: "00" }, "pl"));
    assert.equal(cal.reminderStackMoreLabel(2, false, "pl"), cal.t("alert.stack.more", { count: 2 }, "pl"));
    assert.equal(cal.reminderStackMoreLabel(2, true, "pl"), plTable.strings["alert.stack.showFewer"]);

    // Alert stack & missed digest DOM in Polish
    const h = makeFakeNotesEnv({ initialLang: "pl" });
    const stack = h.core.createReminderAlertStack({
      document: h.document,
      history: { list: () => [], on: () => () => {} },
      listen: (t, type, fn) => { t.addEventListener(type, fn); return () => t.removeEventListener(type, fn); },
    });
    for (let i = 0; i < 4; i++) {
      stack.show({
        identity: { itemId: "id-" + i, occurrenceId: "occ-" + i },
        title: "Test " + i,
        stage: "pre",
        actions: [{ id: "done", label: h.core.t("alert.action.done"), callback: () => true }],
      });
    }
    const cards = h.document.documentElement.querySelectorAll(".zn-reminder-card");
    assert.equal(cards.length, 3, "stack caps visible cards at 3");
    assert.equal(cards[0].getAttribute("data-stage"), "pre", "canonical data-stage attribute preserved in Polish");
    assert.ok(allText(cards[0]).includes(plTable.strings["alert.stage.pre"]), "Stage 1 badge is translated to Polish");
    const overflowBtn = h.document.documentElement.querySelector(".zn-reminder-more");
    assert.ok(overflowBtn && overflowBtn.textContent.includes(cal.t("alert.stack.more", { count: 1 }, "pl")), `expected Polish overflow label, got ${overflowBtn?.textContent}`);
    stack.showDigest([{ identity: { itemId: "m1", occurrenceId: "m1" }, title: "Lekarz", open() {}, dismiss() { return true; }, snooze() { return true; } }]);
    const digestText = allText(h.document.documentElement.querySelector(".zn-reminder-stack"));
    assert.ok(digestText.includes(plTable.strings["alert.missed.stage"]), `expected Polish digest stage, got: ${digestText}`);
    assert.ok(digestText.includes(cal.tCount("alert.missed.title", 1, null, "pl")), `expected Polish digest title, got: ${digestText}`);
    assert.ok(digestText.includes(plTable.strings["alert.missed.dismissAll"]), `expected Polish Dismiss all, got: ${digestText}`);
    stack.destroy();
  });

  await test("5. Area 5: Note & Agenda hover models localize labels while preserving canonical data-status tokens", () => {
    const h = makeFakeNotesEnv({ initialLang: "pl" });
    const now = Date.parse("2026-11-16T12:00:00.000Z");
    const overdueItem = {
      id: "rem-1",
      summary: "Spotkanie",
      start: { dateTime: "2026-11-16T10:00:00.000Z" },
      x: { kind: "reminder", src: "manual" },
    };
    const agendaPl = h.core.buildAgendaHoverModel(overdueItem, { calendar: cal, now, lang: "pl" });
    assert.equal(agendaPl.status, "overdue", "canonical status token stays English for CSS/data-status");
    assert.equal(agendaPl.actions[0].label, plTable.strings["hover.open"]);
    assert.equal(h.core.t("hover.status." + agendaPl.status, null, "pl"), plTable.strings["hover.status.overdue"]);
    assert.equal(h.core.t("hover.status." + agendaPl.status, null, "en"), enTable.strings["hover.status.overdue"]);

    const noteModelPl = h.core.buildNoteHoverModel(
      { id: "n1", body: "", folder: "", remind: now - 60000 },
      { calendar: cal, now, lang: "pl" },
    );
    assert.equal(noteModelPl.title, plTable.strings["hover.untitled"]);
    assert.equal(noteModelPl.folder, plTable.strings["hover.notes"]);
    assert.ok(noteModelPl.reminder.text.includes(plTable.strings["hover.overduePrefix"].split("{")[0].trim()), `expected Polish overdue prefix, got ${noteModelPl.reminder.text}`);

    const noteModelEn = h.core.buildNoteHoverModel(
      { id: "n1", body: "", folder: "", remind: now - 60000 },
      { calendar: cal, now, lang: "en" },
    );
    assert.equal(noteModelEn.title, enTable.strings["hover.untitled"]);
    assert.equal(noteModelEn.folder, enTable.strings["hover.notes"]);
    assert.ok(noteModelEn.reminder.text.startsWith("Overdue"), `expected English overdue prefix, got ${noteModelEn.reminder.text}`);
  });

  await test("6. Areas 1, 2, 6, 7 in real sheet DOM: EN -> PL live switch updates Calendar, Tree, Composer, and Settings", async () => {
    const h = makeFakeNotesEnv({ initialLang: "en" });
    await h.store.open();
    const sheet = h.core.createSheet({
      store: h.store,
      adapter: h.adapter,
      env: h.env,
      ensureStore: () => h.store.open(),
    });
    await sheet.open();
    await h.flushRaf();

    // Switch to All Notes view (Area 1 + Area 6)
    const btnAll = h.adapter.host.querySelector(".zn-list-btn");
    btnAll.click();
    await h.flushRaf();

    const search = h.adapter.host.querySelector(".zn-search");
    const calHeading = h.adapter.host.querySelector(".zn-calendar-pane-head strong");
    const calToday = h.adapter.host.querySelector(".zn-calendar-today");
    const calTools = h.adapter.host.querySelector(".zn-calendar-tools");
    const chips = [...h.adapter.host.querySelectorAll(".zn-chips .zn-chip")];
    assert.equal(search.placeholder, enTable.strings["tree.searchPlaceholder"]);
    assert.equal(calHeading.textContent, enTable.strings["cal.heading"]);
    assert.equal(calToday.textContent, enTable.strings["cal.todayBtn"]);
    assert.equal(calTools.textContent, enTable.strings["cal.tools"]);
    assert.equal(chips[0].textContent, enTable.strings["tree.chip.notes"]);
    assert.equal(chips[1].textContent, enTable.strings["tree.chip.recent"]);

    // Area 7: Open Quick Settings -> All Settings -> switch language to Polish!
    const settingsBtn = h.adapter.host.querySelector('[aria-label^="Settings"], .zn-tbtn[title^="Settings"]')
      || [...h.adapter.host.querySelectorAll("button")].find((b) => /Settings/i.test(b.title || b.getAttribute("aria-label") || ""));
    assert.ok(settingsBtn, "Settings button exists");
    settingsBtn.click();
    await h.flushRaf();

    const quickTitle = h.adapter.host.querySelector(".zn-dialog-card strong")?.textContent;
    assert.equal(quickTitle, enTable.strings["settings.quickTitle"]);
    const allSettingsBtn = [...h.adapter.host.querySelectorAll(".zn-dialog-card button")].find((b) => b.textContent === enTable.strings["settings.allSettingsBtn"]);
    assert.ok(allSettingsBtn, "All settings button exists in Quick settings");
    allSettingsBtn.click();
    await h.flushRaf();

    assert.equal(h.adapter.host.querySelector(".zn-dialog-card strong")?.textContent, enTable.strings["settings.title"]);
    const linksTab = [...h.adapter.host.querySelectorAll(".zn-set-tabs button")].find((b) => b.textContent === enTable.strings["settings.tab.links"]);
    assert.ok(linksTab, "Links & history tab exists in Settings");
    linksTab.click();
    await h.flushRaf();

    // Find the Polish language chip in Settings -> Links & history and click it
    const plChip = [...h.adapter.host.querySelectorAll(".zn-dialog-card button")].find((b) =>
      b.textContent === enTable.strings["settings.choice.notesLanguage.pl"],
    );
    assert.ok(plChip, "Polski language choice button exists in Settings -> Links & history");
    plChip.click();
    await h.flushRaf();

    // Live refresh updated BOTH the open Settings dialog AND the underlying All notes + Calendar sheet!
    assert.equal(h.prefs.get("zen.workspace.zentral.notes.language"), "pl");
    assert.equal(h.adapter.host.querySelector(".zn-dialog-card strong")?.textContent, plTable.strings["settings.title"]);
    const plTabs = [...h.adapter.host.querySelectorAll(".zn-set-tabs button")].map((b) => b.textContent);
    assert.ok(plTabs.includes(plTable.strings["settings.tab.writing"]) && plTabs.includes(plTable.strings["settings.tab.links"]), `expected Polish Settings tabs, got ${plTabs.join(", ")}`);
    assert.equal(search.placeholder, plTable.strings["tree.searchPlaceholder"]);
    assert.equal(calHeading.textContent, plTable.strings["cal.heading"]);
    assert.equal(calToday.textContent, plTable.strings["cal.todayBtn"]);
    assert.equal(calTools.textContent, plTable.strings["cal.tools"]);
    assert.equal(chips[0].textContent, plTable.strings["tree.chip.notes"]);
    assert.equal(chips[1].textContent, plTable.strings["tree.chip.recent"]);

    // Close Settings dialog
    const doneBtn = [...h.adapter.host.querySelectorAll(".zn-dialog-card button")].find((b) => b.textContent === plTable.strings["settings.done"]);
    assert.ok(doneBtn, "Polish Done button exists in Settings");
    doneBtn.click();
    await h.flushRaf();

    // Area 2: Open Calendar Composer in Polish (via sidebarFolderReminder)
    sheet.sidebarFolderReminder?.("", "");
    await h.flushRaf();
    const composeCard = h.adapter.host.querySelector(".zn-cal-compose-card");
    assert.ok(composeCard, "Calendar composer opened");
    const composeHead = composeCard.querySelector("strong")?.textContent;
    assert.equal(composeHead, plTable.strings["compose.title.create"]);
    const composeText = allText(composeCard);
    assert.ok(composeText.includes(plTable.strings["compose.recur.heading"]), "Recurrence section translated to Polish");
    assert.ok(composeText.includes(plTable.strings["compose.alerts.heading"]), "Reminder alerts section translated to Polish");
    assert.ok(composeText.includes(plTable.strings["compose.btn.createReminder"]), "Create reminder button translated to Polish");

    // Area 3: Headless agenda command returns Polish message and Polish Undo label
    const created = h.store.items.upsert(cal.makeItem({
      summary: "Test PL",
      start: { dateTime: "2026-11-16T09:00:00.000Z" },
      x: { kind: "reminder", src: "manual" },
    }, Date.now()));
    const resPl = h.store.runAgendaCommand(created, "mark-done", { now: Date.now(), lang: "pl" });
    assert.equal(resPl.ok, true);
    assert.equal(resPl.message, plTable.strings["toast.agenda.markDone"]);
    assert.equal(resPl.undoLabel, plTable.strings["common.undo"]);

    const resEn = h.store.runAgendaCommand(created, "reopen", { now: Date.now(), lang: "en" });
    assert.equal(resEn.ok, true);
    assert.equal(resEn.message, enTable.strings["toast.agenda.reopen"]);
    assert.equal(resEn.undoLabel, enTable.strings["common.undo"]);

    sheet.destroy();
    await h.store.close();
  });

  console.log(`\nPASS notes-i18n-ui (${passed} tests)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
