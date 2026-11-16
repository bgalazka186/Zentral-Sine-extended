"use strict";
/* T3.4a + AU-B2: shared top-layer sidebar hover preview cards for Notes, Agenda, and RSS
 * (including full-pack AND standalone-without-core-mod coexistence). */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const root = path.resolve(__dirname, "..");
const AGENDA_PREF = "zen.workspace.zentral.notes.agenda_folder";
const ZEN_MODE_PREF = "zen.workspace.zentral.notes.zen_folder";
const NOTES_MARK = "bgalazka-notes-item";
const AGENDA_MARK = "bgalazka-notes-agenda-item";

const agendaCard = (h) => h.document.getElementById("bgalazka-notes-agenda-card");
const notesCard = (h) => h.document.getElementById("bgalazka-notes-sidebar-card");
const agendaTabFor = (h, recordId) =>
  h.document.querySelectorAll(`tab[${AGENDA_MARK}]`).find((t) => t.getAttribute("bgalazka-notes-agenda-record-id") === recordId);
const noteTabFor = (h, noteId) =>
  h.document.querySelectorAll(`tab[${NOTES_MARK}]`).find((t) => t.getAttribute(NOTES_MARK) === "n:" + noteId);

async function flushMicrotasks(n = 6) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function clickEl(el) {
  const listeners = el.listeners || [];
  // Dispatch through fake-dom bubble chain up to card
  const chain = [];
  for (let p = el; p; p = p.parentElement) chain.push(p);
  const event = {
    type: "click",
    target: el,
    currentTarget: el,
    button: 0,
    defaultPrevented: false,
    stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  for (const node of chain) {
    event.currentTarget = node;
    for (const l of [...(node.listeners || [])]) {
      if (l.type === "click") l.fn(event);
      if (event.stopped) break;
    }
    if (event.stopped) break;
  }
  return event;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// 1. Shared engine contract & calendar snooze-1h capability
test("shared hover card engine exists on ZentralRuntime and snooze-1h is a headless command", () => {
  assert.equal(C.isHeadlessAgendaCommand("snooze-1h"), true, "snooze-1h must be headless");
  assert.match(C.agendaActionMessage("snooze-1h"), /1 hour/i);
  const timed = C.makeItem({
    id: "rem-1h",
    summary: "Call clinic",
    start: { dateTime: "2026-11-17T10:00:00.000Z" },
    x: { kind: "reminder", src: "manual" },
  });
  const model = C.calendarItemMenuModel(timed, { historyWritable: true });
  const flat = model.flatMap((r) => (r.group ? [r, ...r.group] : [r]));
  assert.equal(flat.find((r) => r.id === "snooze-1h")?.enabled, true, "timed reminder supports snooze-1h");
  const allDay = C.makeItem({
    id: "rem-ad",
    summary: "Renew passport",
    start: { date: "2026-11-17" },
    x: { kind: "reminder", src: "manual" },
  });
  const adFlat = C.calendarItemMenuModel(allDay, { historyWritable: true }).flatMap((r) => (r.group ? [r, ...r.group] : [r]));
  assert.equal(adFlat.find((r) => r.id === "snooze-1h")?.enabled, false, "all-day reminder disables snooze-1h");
});

// 2. Notes pseudo-tab card: content (title, breadcrumb, tags, 3-4 line snippet, active reminder) & quick actions
test("Notes pseudo-tab card shows rich preview and runs Open, New note in folder, and T2.3e-gated Trash", async () => {
  const h = createFakeZen({ prefs: { [ZEN_MODE_PREF]: "all", [AGENDA_PREF]: false } });
  await h.seam.ensureStore();
  h.fireTimer(6000);
  await flushMicrotasks();

  const store = h.seam.store;
  const work = store.addFolder("Work");
  const specs = store.addFolder("Specs", work);
  const plainNote = store.create(
    "# Architecture Plan\nLine one about #design and #zen\nLine two with details %%zn-item-id:hidden%%\nLine three summary\nLine four still visible\nLine five clipped out",
    specs,
  );
  const remindedNote = store.create("# Renew License\nBring documents #admin", work);
  store.setReminder(remindedNote.id, Date.now() + 2 * 3600000);
  h.seam.zen.runNow();
  h.seam.zen.runNow();
  await flushMicrotasks();

  const tabA = noteTabFor(h, plainNote.id);
  const tabB = noteTabFor(h, remindedNote.id);
  assert.ok(tabA && tabB, "both Notes pseudo-tabs projected");
  tabA.getBoundingClientRect = () => ({ left: 0, right: 200, top: 100, bottom: 124, width: 200, height: 24 });
  tabB.getBoundingClientRect = () => ({ left: 0, right: 200, top: 130, bottom: 154, width: 200, height: 24 });

  // AU-B2: zero hover-card observers before any hover (and never a document-wide observer for the card)
  const beforeObs = h.activeObservers();
  assert.ok(!beforeObs.some((o) => o.target === tabA.parentElement), "no hover observer on tab parent before hover");

  h.emit("mouseover", tabA);
  assert.ok(h.fireTimer(350), "Notes card respects 350ms hover delay");
  const card = notesCard(h);
  assert.ok(card && !card.hidden, "Notes hover card is open");
  assert.equal(card.getAttribute("popover"), "manual");
  assert.equal(card.querySelector(".zn-hc-title")?.textContent, "Architecture Plan");
  assert.match(card.querySelector(".zn-hc-folder")?.textContent || "", /Work\s*\/\s*Specs/);
  const tagTexts = [...card.querySelectorAll(".zn-hc-pill")].map((el) => el.textContent);
  assert.ok(tagTexts.some((t) => /design/i.test(t)) && tagTexts.some((t) => /zen/i.test(t)), "tags rendered as pills");
  const bodyLines = (card.querySelector(".zn-hc-body")?.textContent || "").split("\n").filter(Boolean);
  assert.ok(bodyLines.length >= 3 && bodyLines.length <= 4, `expected 3-4 preview lines, got ${bodyLines.length}`);
  assert.ok(!card.querySelector(".zn-hc-body").textContent.includes("%%zn-item-id"), "internal markers stripped");
  assert.ok(!card.querySelector(".zn-hc-body").textContent.includes("Line five clipped out"), "lines beyond 4 clipped");

  // AU-B2: hover-card observer is connected ONLY to tabA.parentElement with childList: true (NOT documentElement / subtree)
  const obsWhileOpen = h.activeObservers();
  assert.equal(obsWhileOpen.length, beforeObs.length + 1, "exactly one hover observer connected while card is visible");
  const hoverObs = obsWhileOpen.find((o) => o.target === tabA.parentElement);
  assert.ok(hoverObs, "observes only the hovered tab's parent");
  assert.equal(hoverObs.options?.childList, true);
  assert.ok(!hoverObs.options?.subtree, "never observes with subtree: true");

  // AU-B2: hiding the card (Escape) strictly disconnects the hover observer back to baseline
  h.emit("keydown", tabA, { key: "Escape" });
  assert.equal(card.hidden, true, "Escape hides the Notes hover card");
  assert.equal(h.activeObservers().length, beforeObs.length, "AU-B2: hover observer strictly disconnected on hide");

  // Re-open via hover and click Open
  h.emit("focusin", tabA);
  assert.equal(card.hidden, false);
  let openedId = "";
  h.window.__zentralNotesTestSeam.onZenOpenNote = (id) => { openedId = id; };
  const openBtn = card.querySelector('button[data-action="open"]');
  assert.ok(openBtn, "Open button present");
  clickEl(openBtn);
  await flushMicrotasks();
  assert.equal(openedId, plainNote.id, "Open button activates the hovered note");
  assert.equal(card.hidden, true, "Open hides the hover card");
  assert.ok(!h.activeObservers().some((o) => o.target === tabA.parentElement), "AU-B2: tab-parent observer disconnected after Open");

  // Hover tabA again -> New note in folder
  const countBeforeNew = store.list().length;
  h.emit("focusin", tabA);
  assert.equal(card.hidden, false);
  const newBtn = card.querySelector('button[data-action="new-in-folder"]');
  assert.ok(newBtn, "New note in folder button present");
  clickEl(newBtn);
  await flushMicrotasks();
  assert.equal(store.list().length, countBeforeNew + 1, "New note in folder creates a new note");
  const created = store.list().find((n) => n.id !== plainNote.id && n.id !== remindedNote.id);
  assert.equal(created.folder, specs, "new note lands in the hovered note's folder");

  // Hover plainNote (NO reminders) -> Trash moves straight to Trash
  h.emit("focusin", tabA);
  assert.equal(card.hidden, false);
  const trashBtn = card.querySelector('button[data-action="trash"]');
  assert.ok(trashBtn, "Trash button present");
  clickEl(trashBtn);
  await flushMicrotasks();
  assert.equal(Boolean(store.get(plainNote.id)?.trashed), true, "note without reminders goes straight to Trash");

  // Hover remindedNote (HAS active reminder) -> displays reminder badge AND routes Trash through T2.3e gate
  h.emit("focusin", tabB);
  assert.equal(card.hidden, false);
  assert.ok(card.querySelector(".zn-hc-reminder") && !card.querySelector(".zn-hc-reminder").hidden, "active reminder badge shown");
  const trashRemindedBtn = card.querySelector('button[data-action="trash"]');
  clickEl(trashRemindedBtn);
  await flushMicrotasks();
  assert.equal(Boolean(store.get(remindedNote.id)?.trashed), false, "T2.3e gate prevents silent Trash of a note with active reminders");
  assert.equal(card.hidden, true, "hover card closes while T2.3e confirmation opens");

  await h.destroy();
  assert.equal(notesCard(h), null, "card DOM removed on destroy");
  assert.equal(h.activeObservers().length, 0, "zero observers after destroy");
});

// 3. Agenda pseudo-tab card: rich metadata, headless quick actions (Done, Snooze +1h / +1d, Dismiss), nextAgendaItem retargeting
test("Agenda pseudo-tab card shows rich details, runs headless quick actions, and retargets cleanly with nextAgendaItem", async () => {
  const h = createFakeZen({ prefs: { [AGENDA_PREF]: true, [ZEN_MODE_PREF]: "all" } });
  await h.seam.ensureStore();
  h.fireTimer(6000);
  h.fireTimer(6500);
  await flushMicrotasks();

  const store = h.seam.store;
  const sourceNote = store.create("# Launch Checklist\nDetails about launch");
  const baseDay = C.addDays(C.dayStart(Date.now()), 1);
  const makeRem = (id, summary, hour, extra = {}) =>
    C.makeItem({
      id,
      summary,
      start: { dateTime: new Date(baseDay + hour * 3600000).toISOString() },
      end: { dateTime: new Date(baseDay + (hour + 1) * 3600000).toISOString() },
      description: extra.description || "",
      x: {
        src: extra.src || "manual",
        kind: extra.kind || "reminder",
        category: extra.category || "Work",
        calNote: extra.calNote || "",
        noteId: extra.noteId || "",
        heading: extra.heading || "",
      },
    });

  store.items.upsert(makeRem("a1", "Prepare release notes", 10, { calNote: "Check changelog links first", noteId: sourceNote.id, heading: "Launch Checklist" }));
  store.items.upsert(makeRem("a2", "Send build to QA", 11, { calNote: "Tag beta build" }));
  store.items.upsert(makeRem("a3", "Publish announcement", 12, { calNote: "Post in community" }));
  store.items.upsert(makeRem("ev1", "Team sync", 14, { kind: "event", category: "Team" }));
  h.seam.agendaController.runNow();
  await flushMicrotasks();

  const t1 = agendaTabFor(h, "a1"), t2 = agendaTabFor(h, "a2"), t3 = agendaTabFor(h, "a3"), tEv = agendaTabFor(h, "ev1");
  assert.ok(t1 && t2 && t3 && tEv, "all four Agenda tabs projected");
  for (const [i, t] of [t1, t2, t3, tEv].entries()) {
    t.getBoundingClientRect = () => ({ left: 0, right: 200, top: 80 + i * 26, bottom: 104 + i * 26, width: 200, height: 24 });
  }

  // Track top-layer showPopover / hidePopover re-entry on target switches
  let popoverOps = [];
  let popoverOpen = false;
  h.El.prototype.matches = function (sel) { return sel === ":popover-open" ? popoverOpen : false; };
  h.El.prototype.showPopover = function () { popoverOpen = true; popoverOps.push("show:" + this.id); };
  h.El.prototype.hidePopover = function () { popoverOpen = false; popoverOps.push("hide:" + this.id); };

  // Hover t1 -> verify rich fields
  h.emit("mouseover", t1);
  assert.ok(h.fireTimer(350), "350ms hover delay");
  const card = agendaCard(h);
  assert.ok(card && !card.hidden, "Agenda card shown");
  assert.equal(card.querySelector(".zn-hc-title")?.textContent, "Prepare release notes");
  assert.match(card.querySelector(".zn-hc-time")?.textContent || "", /\d{2}:\d{2}/, "formatted date + time rendered");
  assert.match(card.querySelector(".zn-hc-cat")?.textContent || "", /Work/, "category badge rendered");
  assert.match(card.querySelector(".zn-hc-source")?.textContent || "", /Launch Checklist/, "source note link rendered");
  assert.match(card.querySelector(".zn-hc-body")?.textContent || "", /Check changelog links first/, "calendar note text rendered");
  assert.ok(popoverOps.includes("show:bgalazka-notes-agenda-card"), "entered top layer via showPopover()");

  // Check buttons present on reminder
  assert.ok(card.querySelector('button[data-action="open"]'), "Open button present");
  assert.ok(card.querySelector('button[data-action="open-source"]'), "Source note link button present");
  assert.ok(card.querySelector('button[data-action="mark-done"]'), "Done button present");
  assert.ok(card.querySelector('button[data-action="snooze-1h"]'), "Snooze +1h button present");
  assert.ok(card.querySelector('button[data-action="snooze-1d"]'), "Snooze +1d button present");
  assert.ok(card.querySelector('button[data-action="dismiss"]'), "Dismiss button present");

  // Rapid triage #1: click Done on a1 -> headless (no sheet), toast shown, card retargets smoothly to a2 WITHOUT closing!
  const sheetCountBefore = h.document.querySelectorAll(".zentral-notes-sheet").length;
  popoverOps = [];
  clickEl(card.querySelector('button[data-action="mark-done"]'));
  await flushMicrotasks();
  assert.equal(h.document.querySelectorAll(".zentral-notes-sheet").length, sheetCountBefore, "Done stays headless (no Notes sheet)");
  assert.equal(store.items.history.stateFor("a1", "a1"), "done", "a1 marked done");
  assert.equal(card.hidden, false, "card stayed open during triage retargeting");
  assert.equal(card.querySelector(".zn-hc-title")?.textContent, "Send build to QA", "retargeted smoothly to nextAgendaItem (a2)");
  assert.ok(popoverOps.includes("hide:bgalazka-notes-agenda-card") && popoverOps.includes("show:bgalazka-notes-agenda-card"), "re-entered top layer on target switch");
  assert.ok(h.document.getElementById("bgalazka-notes-agenda-toast") && !h.document.getElementById("bgalazka-notes-agenda-toast").hidden, "SB6.3 Undo toast shown");

  // Rapid triage #2: click Snooze +1h on a2 -> time advances +1h headless, card stays open showing updated a2 time!
  const a2BeforeMs = Date.parse(store.items.get("a2").start.dateTime);
  clickEl(card.querySelector('button[data-action="snooze-1h"]'));
  await flushMicrotasks();
  const a2AfterMs = Date.parse(store.items.get("a2").start.dateTime);
  assert.equal(a2AfterMs - a2BeforeMs, 3600000, "Snooze +1h shifted a2 by exactly 1 hour");
  assert.equal(card.hidden, false, "card stayed open after Snooze +1h");

  // Rapid triage #3: click Snooze +1d on a2 -> moves to next day folder, card retargets smoothly to a3!
  const a2BeforeDayMs = Date.parse(store.items.get("a2").start.dateTime);
  clickEl(card.querySelector('button[data-action="snooze-1d"]'));
  await flushMicrotasks();
  const a2AfterDayMs = Date.parse(store.items.get("a2").start.dateTime);
  assert.ok(a2AfterDayMs - a2BeforeDayMs >= 23 * 3600000, "Snooze +1d moved a2 to the next day");
  assert.equal(card.hidden, false, "card stayed open and retargeted after Snooze +1d");
  assert.equal(card.querySelector(".zn-hc-title")?.textContent, "Publish announcement", "retargeted smoothly to a3");

  // Rapid triage #4: click Dismiss on a3 -> headless, retargets to ev1 (event, so reminder buttons hidden!)
  clickEl(card.querySelector('button[data-action="dismiss"]'));
  await flushMicrotasks();
  assert.equal(store.items.history.stateFor("a3", "a3"), "dismissed", "a3 dismissed");
  assert.equal(card.hidden, false, "card stayed open and retargeted to ev1");
  assert.equal(card.querySelector(".zn-hc-title")?.textContent, "Team sync");
  assert.equal(card.querySelector('button[data-action="mark-done"]'), null, "plain event hides reminder-only Done button");
  assert.equal(card.querySelector('button[data-action="snooze-1h"]'), null, "plain event hides reminder-only Snooze buttons");
  const evOpenBtn = card.querySelector('button[data-action="open"]');
  assert.ok(evOpenBtn, "plain event keeps Open button");
  clickEl(evOpenBtn);
  await flushMicrotasks();
  assert.equal(card.hidden, true, "clicking Open on Agenda card activates item and closes hover card");

  // Pointer retargeting via elementFromPoint (RSS dismiss(tab, true) parity):
  store.items.upsert(makeRem("p1", "Pointer first", 15));
  store.items.upsert(makeRem("p2", "Pointer second", 16));
  h.seam.agendaController.runNow();
  const p1 = agendaTabFor(h, "p1"), p2 = agendaTabFor(h, "p2");
  p1.getBoundingClientRect = () => ({ left: 0, right: 200, top: 200, bottom: 224, width: 200, height: 24 });
  p2.getBoundingClientRect = () => ({ left: 0, right: 200, top: 226, bottom: 250, width: 200, height: 24 });
  h.emit("mousemove", p1, { clientX: 80, clientY: 212 });
  h.emit("focusin", p1);
  assert.equal(card.querySelector(".zn-hc-title")?.textContent, "Pointer first");
  h.document.elementFromPoint = () => p2;
  h.seam.agendaHoverCard.retarget(p1, { viaPointer: true, nextTarget: p2 });
  h.fireTimer(16); // requestAnimationFrame in fake-zen-browser is 16ms timer
  assert.equal(card.hidden, false, "pointer retarget kept card open");
  assert.equal(card.querySelector(".zn-hc-title")?.textContent, "Pointer second", "pointer retarget switched to tab under pointer");

  // Cross-card coordination: hovering a Notes tab hides the open Agenda card immediately!
  h.seam.zen.runNow();
  const nTab = noteTabFor(h, sourceNote.id);
  assert.ok(nTab, "Notes tab projected");
  nTab.getBoundingClientRect = () => ({ left: 0, right: 200, top: 40, bottom: 64, width: 200, height: 24 });
  h.emit("focusin", nTab);
  assert.equal(notesCard(h).hidden, false, "Notes card opened");
  assert.equal(agendaCard(h).hidden, true, "Agenda card closed automatically when Notes card opened");

  await h.destroy();
  assert.equal(h.window.__zentralSidebarCardHost, undefined, "shared card host cleaned up when all cards destroy");
});

// 4. Standalone RSS + Standalone Notes WITHOUT core mod: both use the shared engine and coordinate cleanly!
test("standalone RSS and standalone Notes work together without core mod and share the hover card coordinator", async () => {
  const rssBundlePath = path.join(root, "additional/rss/ZentralRssDisplay.standalone.uc.js");
  const notesBundlePath = path.join(root, "additional/notes/ZentralNotes.standalone.uc.js");
  const rssBundle = fs.readFileSync(rssBundlePath, "utf8");
  const notesBundle = fs.readFileSync(notesBundlePath, "utf8");
  assert.match(rssBundle, /function createSidebarHoverCard\(/, "RSS standalone bundle ships createSidebarHoverCard");
  assert.match(notesBundle, /function createSidebarHoverCard\(/, "Notes standalone bundle ships createSidebarHoverCard");

  const dom = require("./helpers/fake-dom.cjs")();
  const { El, Ev, document } = dom;
  document.querySelector = (s) => document.querySelectorAll(s)[0] || null;
  document.createXULElement = (t) => document.createElement(t);
  document.documentElement.toggleAttribute = function (k, on) { if (on) this.setAttribute(k, ""); else this.removeAttribute(k); };
  const sidebar = dom.zenSidebar();
  const prefs = new Map([
    ["zen.workspace.bgalazka.rss.reader_card", true],
    ["zen.workspace.bgalazka.rss.card_hover_delay", 0],
    ["zen.workspace.bgalazka.rss.card_hide_delay", 100],
    ["zen.workspace.zentral.notes.agenda_folder", true],
  ]);
  const prefObs = new Map();
  const Services = {
    prefs: {
      PREF_STRING: 32, PREF_INT: 64, PREF_BOOL: 128,
      getPrefType(k) {
        if (!prefs.has(k)) return 0;
        const v = prefs.get(k);
        return typeof v === "boolean" ? 128 : typeof v === "number" ? 64 : 32;
      },
      getBoolPref: (k, d) => (prefs.has(k) ? !!prefs.get(k) : d),
      getIntPref: (k, d) => (prefs.has(k) ? Number(prefs.get(k)) : d),
      getStringPref: (k, d) => (prefs.has(k) ? String(prefs.get(k)) : d),
      prefHasUserValue: (k) => prefs.has(k),
      setBoolPref: (k, v) => prefs.set(k, !!v),
      setIntPref: (k, v) => prefs.set(k, Number(v)),
      setStringPref: (k, v) => prefs.set(k, String(v)),
      addObserver: (p, o) => { if (!prefObs.has(p)) prefObs.set(p, new Set()); prefObs.get(p).add(o); },
      removeObserver: (p, o) => prefObs.get(p)?.delete(o),
    },
    obs: { addObserver() {}, removeObserver() {}, notifyObservers() {} },
    sound: { beep() {} },
    scriptSecurityManager: { getSystemPrincipal: () => ({}) },
    wm: { getEnumerator: () => [] },
    io: { newURI: (u) => ({ spec: u }) },
  };
  const winListeners = new Map();
  const win = {
    document,
    innerWidth: 1200,
    innerHeight: 800,
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1", getPropertyValue: () => "" }),
    setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    addEventListener(t, fn) { if (!winListeners.has(t)) winListeners.set(t, new Set()); winListeners.get(t).add(fn); },
    removeEventListener(t, fn) { winListeners.get(t)?.delete(fn); },
    dispatchEvent(ev) { for (const fn of [...(winListeners.get(ev.type) || [])]) fn(ev); return true; },
    gZenWorkspaces: {
      activeWorkspace: sidebar.ws.id,
      workspaceElement: () => ({ element: sidebar.ws, pinnedTabsContainer: sidebar.pinned }),
      addChangeListeners() {}, removeChangeListeners() {},
      promiseInitialized: Promise.resolve(),
    },
    gZenStartup: { promiseInitialized: Promise.resolve() },
    SessionStore: { promiseAllWindowsRestored: Promise.resolve() },
    __zentralNotesTestSeam: {},
  };
  win.window = win;
  const tabContainer = document.createElement("tabs");
  sidebar.pinned.append(tabContainer);
  win.gBrowser = {
    tabContainer,
    get tabs() { return document.querySelectorAll("tab"); },
    selectedTab: null,
    addTab(url) { const t = sidebar.tab(url); t.linkedBrowser = { currentURI: { spec: url } }; sidebar.pinned.append(t); return t; },
    pinTab(t) { t.pinned = true; },
    removeTab(t) { t.remove(); },
    moveTabToExistingGroup(t, f) { f.append(t); },
    moveTabBefore(t, b) { b.parentElement?.insertBefore(t, b); },
  };
  const files = new Map();
  const IOUtils = {
    makeDirectory: async () => {}, setPermissions: async () => {}, exists: async (p) => files.has(p),
    readUTF8: async (p) => { if (!files.has(p)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } return files.get(p); },
    writeUTF8: async (p, d) => { files.set(p, d); }, getChildren: async () => [], stat: async () => ({ lastModified: Date.now() }), remove: async (p) => files.delete(p),
  };
  const PathUtils = { profileDir: "/profile", tempDir: "/tmp", join: (...p) => p.join("/"), filename: (p) => p.split("/").pop() };
  const activeObs = new Set();
  class MutationObserver {
    constructor(cb) { this.cb = cb; this.target = null; this.options = null; }
    observe(t, o) { this.target = t; this.options = o; activeObs.add(this); }
    disconnect() { this.target = null; this.options = null; activeObs.delete(this); }
  }
  const ctx = vm.createContext({
    window: win, document, getComputedStyle: win.getComputedStyle, globalThis: { Services }, ChromeUtils: { importESModule: () => ({ Services }) },
    Components: { stack: { filename: "chrome://sine/content/zentral-notes/ZentralNotes.standalone.uc.js" } },
    Services, IOUtils, PathUtils, MutationObserver, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    Event: Ev, navigator: { platform: "Linux" }, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, WeakMap,
    setTimeout, clearTimeout, queueMicrotask, DOMParser: class { parseFromString(s) { return { body: { textContent: s } }; } },
  });

  // Boot BOTH standalone bundles WITHOUT window.ZentralRuntime (no core mod!)
  try {
    assert.equal(win.ZentralRuntime, undefined, "core mod is NOT installed");
    vm.runInContext(rssBundle, ctx);
    vm.runInContext(notesBundle, ctx);
    await new Promise((r) => setTimeout(r, 60));

    assert.ok(win.__zentralStandalone?.rss, "standalone RSS active");
    assert.ok(win.__zentralStandalone?.notes, "standalone Notes active");
    assert.ok(win.__zentralSidebarCardHost, "shared window card host created across standalone mods");

    // Create an RSS live-folder item tab
    const rssFolder = sidebar.folder("Tech News", { parent: tabContainer });
    rssFolder.setAttribute("is-live-folder", "true");
    rssFolder.setAttribute("label", "Tech News");
    const rssTab = sidebar.tab("https://news.example/article-1");
    rssTab.setAttribute("zen-live-folder-item-id", "rss-1");
    rssTab.setAttribute("label", "Breaking standalone RSS story");
    rssTab.linkedBrowser = { currentURI: { spec: "https://news.example/article-1" } };
    rssTab.getBoundingClientRect = () => ({ left: 0, right: 200, top: 60, bottom: 84, width: 200, height: 24 });
    rssFolder.append(rssTab);

    // Trigger RSS hover -> RSS card opens
    const overEv = new Ev("mouseover", { target: rssTab, bubbles: true, clientX: 50, clientY: 70 });
    for (const l of tabContainer.listeners.filter((x) => x.type === "mouseover")) l.fn(overEv);
    const rssCard = document.getElementById("bgalazka-rss-card");
    assert.ok(rssCard && !rssCard.hidden, "standalone RSS hover card opened");
    assert.match(rssCard.textContent, /Breaking standalone RSS story/);

    // Now open an Agenda card directly from standalone Notes -> RSS card must auto-hide!
    const agendaFolder = sidebar.folder("Agenda", { parent: sidebar.pinned });
    agendaFolder.setAttribute("bgalazka-notes-agenda-folder", "true");
    const agTab = sidebar.tab("about:blank");
    agTab.setAttribute("bgalazka-notes-agenda-item", "item:x1:x1@2026-11-17");
    agTab.setAttribute("bgalazka-notes-agenda-summary", "Standalone Agenda Event");
    agTab.getBoundingClientRect = () => ({ left: 0, right: 200, top: 120, bottom: 144, width: 200, height: 24 });
    agendaFolder.append(agTab);

    win.__zentralNotesTestSeam.sidebar.agendaHoverCard.show(agTab);
    const agCard = document.getElementById("bgalazka-notes-agenda-card");
    assert.ok(agCard && !agCard.hidden, "standalone Notes Agenda hover card opened");
    assert.equal(rssCard.hidden, true, "opening standalone Notes/Agenda card automatically hid standalone RSS card");

    // Re-hover RSS -> Agenda card must auto-hide!
    for (const l of tabContainer.listeners.filter((x) => x.type === "mouseover")) l.fn(overEv);
    assert.equal(rssCard.hidden, false, "standalone RSS card re-opened");
    assert.equal(agCard.hidden, true, "opening standalone RSS card automatically hid standalone Notes/Agenda card");

    // Disposing standalone RSS leaves standalone Notes 100% functional!
    win.__zentralStandalone.rss.dispose();
    assert.equal(document.getElementById("bgalazka-rss-card"), null, "RSS card removed on dispose");
    win.__zentralNotesTestSeam.sidebar.agendaHoverCard.show(agTab);
    assert.equal(agCard.hidden, false, "standalone Notes hover card still works after RSS disposed");

    // Disposing standalone Notes cleans up everything including the shared host
    win.__zentralStandalone.notes.dispose();
    assert.equal(document.getElementById("bgalazka-notes-agenda-card"), null);
    assert.equal(win.__zentralSidebarCardHost, undefined, "shared host removed once all standalone mods dispose");
  } finally {
    try { win.__zentralStandalone?.rss?.dispose?.(); } catch (_) {}
    try { win.__zentralStandalone?.notes?.dispose?.(); } catch (_) {}
  }
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log("ok -", t.name);
    } catch (err) {
      failed++;
      console.error("FAIL -", t.name, "\n", err);
    }
  }
  if (failed) process.exitCode = 1;
  else console.log(`\n${tests.length} sidebar hover card tests passed`);
})();
