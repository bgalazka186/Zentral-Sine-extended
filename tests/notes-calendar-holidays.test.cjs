"use strict";

// T2.10: Work-free-day tint + selectable offline holiday calendars (PL/DE/GB/US/EG),
// region-aware weekends (Sat/Sun & Fri/Sat), personal days off, tooltips across all views,
// Tools dialog, day context menu toggle, persistence, and EN/PL localization.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const createFakeDom = require("./helpers/fake-dom.cjs");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.uc.js"), "utf8");
const CSS_SRC = fs.readFileSync(path.join(ROOT, "additional/notes/ZentralNotes.css"), "utf8");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const en = require("../additional/notes/i18n/en.js");
const pl = require("../additional/notes/i18n/pl.js");
cal.registerLanguage("en", en);
cal.registerLanguage("pl", pl);

function makeHarness({ files = new Map(), lang = "en", sheetW = 920, sheetH = 640, paneW = 620, paneH = 540 } = {}) {
  const dom = createFakeDom();
  const { document, Ev: Event, raf } = dom;
  document.documentElement.clientWidth = 1280;
  document.documentElement.clientHeight = 820;

  let curLang = lang;
  const prefStore = new Map();
  const Services = {
    obs: { addObserver() {}, removeObserver() {} },
    prefs: {
      getStringPref: (k, d) => (k === "zen.workspace.zentral.notes.language" ? curLang : (prefStore.has(k) ? String(prefStore.get(k)) : d)),
      getBoolPref: (k, d) => (prefStore.has(k) ? Boolean(prefStore.get(k)) : d),
      getIntPref: (k, d) => (prefStore.has(k) ? Number(prefStore.get(k)) : d),
    },
  };
  const win = {
    __zentralNotesParts: { "notes-calendar": cal },
    __zentralNotesLangTables: { en, pl },
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    document,
    navigator: { platform: "Linux" },
    Intl,
    innerWidth: 1280,
    innerHeight: 820,
    requestAnimationFrame: (fn) => { raf.push(fn); return raf.length; },
    cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ getPropertyValue: () => "", fontSize: "13px" }),
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  win.window = win;

  vm.runInNewContext(SRC, {
    window: win,
    document,
    Event,
    Services,
    globalThis: { Services },
    ChromeUtils: {},
    navigator: { platform: "Linux" },
    Intl,
    URL,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Promise,
    Map,
    Set,
    WeakMap,
    RegExp,
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    TypeError,
    Uint8Array,
    TextEncoder,
    TextDecoder,
  });

  const core = win.__zentralNotesTestSeam.core;
  const io = {
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    exists: async (p) => files.has(p),
    readUTF8: async (p) => { if (!files.has(p)) throw Error("missing"); return files.get(p); },
    writeUTF8: async (p, text) => { files.set(p, text); },
    remove: async (p) => { files.delete(p); },
    children: async (p) => [...files.keys()].filter((k) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")),
    stat: async () => ({ lastModified: 0 }),
    restrict: async () => {},
  };
  const store = core.createStore({
    io,
    notify() {},
    windowId: "holidays-test",
    getDir: async () => "/n",
    getMaxSaveMs: () => 1000,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  });
  const host = document.createElement("div");
  document.body.append(host);
  const adapter = {
    position: "fixed",
    attach(el) { host.append(el); },
    getArea() { return { left: 40, top: 40, width: sheetW, height: sheetH, right: 40 + sheetW, bottom: 40 + sheetH }; },
    rect() { return { left: 40, top: 40, width: sheetW, height: sheetH, right: 40 + sheetW, bottom: 40 + sheetH }; },
    watch() { return () => {}; },
    setActive() {},
    releaseSlot() {},
    isSuspended() { return false; },
  };
  const env = {
    getPref: (k, d) => (prefStore.has(k) ? prefStore.get(k) : d),
    setPref: (k, v) => { prefStore.set(k, v); },
    now: () => Date.UTC(2026, 4, 1, 10, 0, 0), // 2026-05-01
    openUrl() {},
    revealFolder() {},
  };
  const sheet = core.createSheet({ store, adapter, env, ensureStore: () => Promise.resolve() });
  sheet.root.ownerDocument = document;
  Object.defineProperty(sheet.root, "offsetParent", { get: () => host });
  sheet.root.getBoundingClientRect = () => ({ left: 40, top: 40, width: sheetW, height: sheetH, right: 40 + sheetW, bottom: 40 + sheetH });
  const allLayout = sheet.root.querySelector(".zn-all-layout");
  allLayout.getBoundingClientRect = () => ({ left: 40, top: 80, width: sheetW, height: sheetH - 40, right: 40 + sheetW, bottom: 40 + sheetH });
  const calPane = sheet.root.querySelector(".zn-calendar-pane");
  calPane.getBoundingClientRect = () => ({ left: 40, top: 80, width: paneW, height: paneH, right: 40 + paneW, bottom: 80 + paneH });
  calPane.clientWidth = paneW;
  calPane.clientHeight = paneH;

  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      raf.splice(0).forEach((fn) => fn());
      await new Promise((r) => setImmediate(r));
    }
  };
  return { win, document, Event, core, store, sheet, files, flush, setLang(l) { curLang = l; } };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

(async () => {
  await test("pure: Easter algorithm, nthWeekday, region weekends, and offline holidaysFor across PL/DE/GB/US/EG & years", async () => {
    // Verified Gregorian Easter Sundays 2024–2028
    assert.equal(cal.easterSundayYmd(2024), "2024-03-31");
    assert.equal(cal.easterSundayYmd(2025), "2025-04-20");
    assert.equal(cal.easterSundayYmd(2026), "2026-04-05");
    assert.equal(cal.easterSundayYmd(2027), "2027-03-28");
    assert.equal(cal.easterSundayYmd(2028), "2028-04-16");

    assert.equal(cal.defaultHolidayRegion("pl-PL"), "PL");
    assert.equal(cal.defaultHolidayRegion("pl"), "PL");
    assert.equal(cal.defaultHolidayRegion("de-DE"), "DE");
    assert.equal(cal.defaultHolidayRegion("en-GB"), "GB");
    assert.equal(cal.defaultHolidayRegion("en-US"), "US");
    assert.equal(cal.defaultHolidayRegion("ar-EG"), "EG");
    assert.equal(cal.defaultHolidayRegion("de-AT"), "none", "unsupported country is not guessed from its language");
    assert.equal(cal.defaultHolidayRegion("fr-FR"), "none");
    assert.equal(cal.cleanCalendarHolidays(null, "pl-PL").region, "PL", "fresh profile picks the supported locale region");
    assert.equal(cal.cleanCalendarHolidays({ region: "none" }, "pl-PL").region, "PL", "legacy region:none defaults migrate to the app locale");
    assert.equal(cal.cleanCalendarHolidays({ region: "none", regionExplicit: true }, "pl-PL").region, "none", "a current explicit no-calendar choice is preserved");
    assert.equal(cal.cleanCalendarHolidays({ region: "DE" }, "pl-PL").region, "DE", "an existing selected region is retained");

    // Poland 2024 vs 2025/2026 (Wigilia Dec 24 added from 2025 onward; Corpus Christi = Easter + 60)
    const pl2024 = cal.holidaysFor("PL", 2024, "pl");
    const pl2026En = cal.holidaysFor("PL", 2026, "en");
    const pl2026Pl = cal.holidaysFor("PL", 2026, "pl");
    assert.equal(pl2024.some((h) => h.date === "2024-12-24"), false, "PL 2024 had no statutory Dec 24 holiday");
    assert.ok(pl2026Pl.some((h) => h.date === "2026-12-24" && /Wigilia/i.test(h.name)), "PL 2026 includes statutory Wigilia Dec 24");
    assert.ok(pl2026Pl.some((h) => h.date === "2026-06-04" && h.name === "Boże Ciało"), "PL 2026 Corpus Christi on 2026-06-04");
    assert.ok(pl2026En.some((h) => h.date === "2026-06-04" && h.name === "Corpus Christi"));
    assert.ok(pl2026En.some((h) => h.date === "2026-05-03" && h.name === "Constitution Day"));
    assert.ok(pl2026Pl.some((h) => h.date === "2026-11-11" && /Niepodległości/i.test(h.name)));

    // Germany 2026: Good Friday (Apr 3), Ascension (May 14), Whit Monday (May 25), Unity Day (Oct 3)
    const de2026 = cal.holidaysFor("DE", 2026, "en");
    assert.ok(de2026.some((h) => h.date === "2026-04-03" && h.name === "Good Friday"));
    assert.ok(de2026.some((h) => h.date === "2026-05-14" && h.name === "Ascension Day"));
    assert.ok(de2026.some((h) => h.date === "2026-05-25" && h.name === "Whit Monday"));
    assert.ok(de2026.some((h) => h.date === "2026-10-03" && h.name === "German Unity Day"));

    // UK (GB) 2026: Early May (May 4), Spring (May 25), Summer (Aug 31), Boxing Day on Sat Dec 26 -> Substitute Mon Dec 28
    const gb2026 = cal.holidaysFor("GB", 2026, "en");
    assert.ok(gb2026.some((h) => h.date === "2026-05-04" && h.name === "Early May Bank Holiday"));
    assert.ok(gb2026.some((h) => h.date === "2026-05-25" && h.name === "Spring Bank Holiday"));
    assert.ok(gb2026.some((h) => h.date === "2026-08-31" && h.name === "Summer Bank Holiday"));
    assert.ok(gb2026.some((h) => h.date === "2026-12-28" && /Boxing Day.*Substitute/i.test(h.name)));

    // US 2026: MLK (Jan 19), Memorial (May 25), Independence Day Sat Jul 4 -> Observed Fri Jul 3, Thanksgiving (Nov 26)
    const us2026 = cal.holidaysFor("US", 2026, "en");
    assert.ok(us2026.some((h) => h.date === "2026-01-19" && /Martin Luther King/i.test(h.name)));
    assert.ok(us2026.some((h) => h.date === "2026-05-25" && h.name === "Memorial Day"));
    assert.ok(us2026.some((h) => h.date === "2026-07-03" && /Independence Day.*Observed/i.test(h.name)));
    assert.ok(us2026.some((h) => h.date === "2026-11-26" && h.name === "Thanksgiving Day"));
    // US 2027: next year 2028-01-01 is Saturday -> 2027-12-31 is New Year's Day (Observed)
    const us2027 = cal.holidaysFor("US", 2027, "en");
    assert.ok(us2027.some((h) => h.date === "2027-12-31" && /New Year's Day.*Observed/i.test(h.name)));

    // Egypt (EG): Fri/Sat weekend [5, 6] + Jan 7 Coptic Christmas + Oct 6 Armed Forces Day
    assert.deepEqual(cal.regionWeekendDays("PL"), [6, 0]);
    assert.deepEqual(cal.regionWeekendDays("EG"), [5, 6]);
    const eg2026 = cal.holidaysFor("EG", 2026, "en");
    assert.ok(eg2026.some((h) => h.date === "2026-01-07" && /Coptic Christmas/i.test(h.name)));
    assert.ok(eg2026.some((h) => h.date === "2026-10-06" && /Armed Forces/i.test(h.name)));

    // isWorkFree: weekend per region, holiday, personal day off, and disabled flag
    // 2026-05-01 is Friday (PL Labour Day, EG Fri weekend + Labour Day), 2026-05-03 is Sunday (PL weekend + Constitution Day, EG regular workday!)
    const wfPlMay1 = cal.isWorkFree("2026-05-01", { enabled: true, region: "PL", weekend: "auto", personalDays: [] }, "pl");
    assert.equal(wfPlMay1.workFree, true);
    assert.equal(wfPlMay1.weekend, false);
    assert.equal(wfPlMay1.holiday?.name, "Święto Pracy");
    assert.equal(wfPlMay1.tooltip, "Święto Pracy");

    const wfEgSun = cal.isWorkFree("2026-05-03", { enabled: true, region: "EG", weekend: "auto", personalDays: [] }, "en");
    assert.equal(wfEgSun.workFree, false, "Sunday is a normal workday in EG (Fri/Sat weekend)");
    const wfEgFri = cal.isWorkFree("2026-05-08", { enabled: true, region: "EG", weekend: "auto", personalDays: [] }, "en");
    assert.equal(wfEgFri.workFree, true);
    assert.equal(wfEgFri.weekend, true, "Friday is weekend in EG");

    // Personal day off add/remove + tooltip
    let prefs = cal.cleanCalendarHolidays({ enabled: true, region: "PL", weekend: "auto", personalDays: [] });
    prefs = cal.addPersonalDayOff(prefs, "2026-05-04", "Long weekend bridge");
    const wfBridge = cal.isWorkFree("2026-05-04", prefs, "en");
    assert.equal(wfBridge.workFree, true);
    assert.equal(wfBridge.personal?.label, "Long weekend bridge");
    assert.equal(wfBridge.tooltip, "Long weekend bridge");
    prefs = cal.removePersonalDayOff(prefs, "2026-05-04");
    assert.equal(cal.isWorkFree("2026-05-04", prefs, "en").workFree, false);

    // Disabled tint returns workFree: false for everything
    assert.equal(cal.isWorkFree("2026-05-01", { enabled: false, region: "PL", weekend: "auto", personalDays: [{ date: "2026-05-01", label: "Off" }] }).workFree, false);
  });

  await test("live Calendar views: greenish tint & holiday tooltips across Month grid, compact picker (preserving Colour legend), Week, Upcoming, Agenda, day menu, Tools dialog, and persistence", async () => {
    const files = new Map();
    const h = makeHarness({ files, sheetW: 960, sheetH: 640, paneW: 640, paneH: 540 });
    await h.store.open();
    h.store.create("# Holidays test");
    // Put an event on 2026-05-01 (Friday, PL Labour Day) & 2026-05-02 (Saturday)
    const may1 = cal.parseYmd("2026-05-01").getTime() + 10 * 3600000;
    const may2 = cal.parseYmd("2026-05-02").getTime() + 10 * 3600000;
    h.store.items.upsert({ id: "hol-ev-1", summary: "May Day Picnic", start: { dateTime: new Date(may1).toISOString() }, end: { dateTime: new Date(may1 + 3600000).toISOString() }, x: { kind: "event", src: "manual" } });
    h.store.items.upsert({ id: "hol-ev-2", summary: "Saturday Hike", start: { dateTime: new Date(may2).toISOString() }, end: { dateTime: new Date(may2 + 3600000).toISOString() }, x: { kind: "event", src: "manual" } });

    h.store.setMeta({
      calendarCursor: "2026-05-01",
      calendarHolidays: { enabled: true, region: "PL", weekend: "auto", personalDays: [{ date: "2026-05-04", label: "Bridge day" }] },
    });
    await h.sheet.open();
    await h.flush();
    h.sheet.openCalendar();
    await h.flush();

    // 1. Month full grid
    const cellMay1 = h.sheet.root.querySelector('.zn-cal-month-cell[data-day="2026-05-01"]');
    const cellMay2 = h.sheet.root.querySelector('.zn-cal-month-cell[data-day="2026-05-02"]');
    const cellMay4 = h.sheet.root.querySelector('.zn-cal-month-cell[data-day="2026-05-04"]');
    const cellMay5 = h.sheet.root.querySelector('.zn-cal-month-cell[data-day="2026-05-05"]');
    assert.ok(cellMay1 && cellMay1.classList.contains("is-workfree") && cellMay1.classList.contains("is-holiday"));
    assert.equal(cellMay1.title, "Labour Day");
    assert.ok(cellMay1.querySelector(".zn-cal-month-holiday")?.textContent === "Labour Day");
    assert.ok(cellMay2 && cellMay2.classList.contains("is-workfree") && cellMay2.classList.contains("is-weekend"));
    assert.ok(cellMay4 && cellMay4.classList.contains("is-workfree") && cellMay4.classList.contains("is-personal-off"));
    assert.equal(cellMay4.title, "Bridge day");
    assert.ok(cellMay5 && !cellMay5.classList.contains("is-workfree"), "regular Tuesday is not tinted");

    // 2. Right-click day context menu toggles personal day off on Tuesday 2026-05-05
    const ctxEv = new h.Event("contextmenu", { bubbles: true, cancelable: true });
    ctxEv.clientX = 120; ctxEv.clientY = 120;
    cellMay5.dispatchEvent(ctxEv);
    const dayMenu = h.sheet.root.querySelector(".zn-menu");
    const markBtn = [...dayMenu.querySelectorAll(".zn-menu-item")].find((b) => /Mark as personal day off/i.test(b.textContent));
    assert.ok(markBtn, "day context menu offers Mark as personal day off");
    markBtn.click();
    await h.flush();
    const cellMay5After = h.sheet.root.querySelector('.zn-cal-month-cell[data-day="2026-05-05"]');
    assert.ok(cellMay5After.classList.contains("is-workfree") && cellMay5After.classList.contains("is-personal-off"));

    // 3. Week view tints columns, headers, and all-day cells
    const pickMenu = (label) => {
      const btn = [...h.sheet.root.querySelectorAll(".zn-menu-item")].find((b) => b.textContent.includes(label));
      assert.ok(btn, `menu item "${label}" exists`);
      btn.click();
    };
    const viewBtn = h.sheet.root.querySelector(".zn-calendar-view-select");
    viewBtn.click(); pickMenu("Week"); await h.flush();
    const wkAllDayMay1 = h.sheet.root.querySelector('.zn-cal-time-allday-cell[data-day="2026-05-01"]');
    assert.ok(wkAllDayMay1 && wkAllDayMay1.classList.contains("is-workfree") && wkAllDayMay1.classList.contains("is-holiday"));
    assert.ok([...h.sheet.root.querySelectorAll(".zn-cal-time-day-head")].some((el) => el.classList.contains("is-holiday") && el.title.includes("Labour Day")));

    // 4. Upcoming list view tints day groups and shows holiday pill
    viewBtn.click(); pickMenu("Next days"); await h.flush();
    const upHoliday = [...h.sheet.root.querySelectorAll(".zn-cal-day-group")].find((el) => el.classList.contains("is-holiday"));
    assert.ok(upHoliday && upHoliday.querySelector(".zn-cal-holiday-pill")?.textContent === "Labour Day");

    // 5. Agenda list view tints rows and shows holiday pill
    viewBtn.click(); pickMenu("Agenda"); await h.flush();
    const agHoliday = [...h.sheet.root.querySelectorAll(".zn-cal-agenda-row")].find((el) => el.classList.contains("is-holiday"));
    assert.ok(agHoliday && agHoliday.querySelector(".zn-cal-holiday-pill")?.textContent === "Labour Day");

    // 6. Compact Month date-picker preserves "Colour legend" AND appends holiday tooltip!
    h.store.setMeta({ calendarPicker: { mode: "picker", minWidth: 470, minHeight: 360, colorMode: "count" } });
    viewBtn.click(); pickMenu("Month"); await h.flush();
    const pickerMay1 = h.sheet.root.querySelector('.zn-cal-picker-day[data-day="2026-05-01"]');
    assert.ok(pickerMay1 && pickerMay1.classList.contains("is-workfree") && pickerMay1.classList.contains("is-holiday"));
    assert.match(pickerMay1.title, /Colour legend/, "compact picker keeps Colour legend title");
    assert.match(pickerMay1.title, /Labour Day/, "compact picker appends holiday name to title");

    // 7. Tools -> Holidays & days off dialog updates region & adds personal day off + persists across reload!
    const toolsBtn = h.sheet.root.querySelector(".zn-calendar-tools");
    toolsBtn.click();
    const holMenuItem = [...h.sheet.root.querySelectorAll(".zn-menu-item")].find((b) => /Holidays & days off/i.test(b.textContent));
    assert.ok(holMenuItem, "Tools menu includes Holidays & days off");
    holMenuItem.click();
    await h.flush();

    const regionSel = h.sheet.root.querySelector(".zn-cal-holidays-region");
    const dateIn = h.sheet.root.querySelector(".zn-cal-holidays-date");
    const labelIn = h.sheet.root.querySelector(".zn-cal-holidays-label");
    const addBtn = h.sheet.root.querySelector(".zn-cal-holidays-add");
    assert.ok(regionSel && dateIn && labelIn && addBtn, "Holidays dialog controls rendered");
    const regionStatus = h.sheet.root.querySelector(".zn-cal-holidays-region-status");
    assert.match(regionStatus?.textContent || "", /Showing public holidays for Poland/i, "selected public calendar is explained");
    regionSel.value = "DE";
    regionSel.dispatchEvent(new h.Event("change", { bubbles: true }));
    dateIn.value = "2026-05-15";
    labelIn.value = "Berlin trip";
    addBtn.click();
    await h.flush();

    assert.equal(h.store.meta.calendarHolidays.region, "DE");
    assert.equal(h.store.meta.calendarHolidays.regionExplicit, true, "manual selection is persisted as explicit");
    assert.match(regionStatus.textContent, /Germany/i, "region status follows a changed selection");
    assert.ok(h.store.meta.calendarHolidays.personalDays.some((p) => p.date === "2026-05-15" && p.label === "Berlin trip"));

    await h.store.flush();
    h.sheet.destroy();
    await h.store.close();

    // Reload fresh store from disk -> verify full persistence
    const h2 = makeHarness({ files, lang: "pl" });
    await h2.store.open();
    assert.equal(h2.store.meta.calendarHolidays.region, "DE");
    assert.ok(h2.store.meta.calendarHolidays.personalDays.some((p) => p.date === "2026-05-15" && p.label === "Berlin trip"));
    assert.ok(CSS_SRC.includes(".zn-cal-month-cell.is-workfree"), "work-free CSS tint rule present");
    assert.ok(CSS_SRC.includes(".zn-cal-picker-day.is-workfree"), "picker work-free CSS rule present");
    assert.ok(CSS_SRC.includes(".zn-cal-month-cell.is-weekend") && CSS_SRC.includes("#6ca8ff"), "weekends use a distinct cool tint");
    assert.ok(CSS_SRC.includes(".zn-cal-month-cell.is-holiday") && CSS_SRC.includes("#f0b85b"), "public holidays use a distinct warm tint");
    assert.ok(CSS_SRC.includes(".zn-cal-month-cell.is-personal-off") && CSS_SRC.includes("#b48bea"), "personal days off use a distinct violet tint");
    await h2.store.close();
  });

  console.log(`\nPASS notes-calendar-holidays (${passed} tests)`);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
