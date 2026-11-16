"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cal = require("../additional/notes/calendar/ZentralNotesCalendar.js");
const makeDom = require("./helpers/fake-dom.cjs");

const notesSource = fs.readFileSync(
  path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"),
  "utf8"
);

function loadEnv(dom, extraWin = {}, services = {}) {
  dom.El.prototype.ownerDocument = dom.document;
  const win = {
    __zentralNotesParts: { "notes-calendar": cal },
    document: dom.document,
    ZentralRuntime: { register() {} },
    __zentralNotesTestSeam: {},
    requestAnimationFrame(fn) { fn(); return 1; },
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    setTimeout,
    clearTimeout,
    innerWidth: 1280,
    innerHeight: 820,
    ...extraWin,
  };
  win.window = win;
  vm.runInNewContext(notesSource, {
    window: win,
    document: dom.document,
    Event: dom.Ev,
    globalThis: { Services: services },
    Services: services,
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
  });
  return { win, seam: win.__zentralNotesTestSeam, core: win.__zentralNotesTestSeam.core };
}

function makeSharedDisk(nowFn) {
  const files = new Map();
  return {
    files,
    join: (...p) => p.join("/"),
    filename: (p) => p.split("/").pop(),
    readUTF8: async (p) => {
      if (!files.has(p)) {
        const err = new Error("ENOENT: " + p);
        err.code = "ENOENT";
        throw err;
      }
      return files.get(p).text;
    },
    writeUTF8: async (p, text) => {
      files.set(p, { text: String(text), mtime: nowFn() });
    },
    remove: async (p) => { files.delete(p); },
    exists: async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p + "/")),
    children: async (d) => [
      ...new Set(
        [...files.keys()]
          .filter((k) => k.startsWith(d + "/"))
          .map((k) => d + "/" + k.slice(d.length + 1).split("/")[0])
      ),
    ],
    stat: async (p) => ({
      size: (files.get(p)?.text || "").length,
      lastModified: files.get(p)?.mtime ?? 1,
    }),
    removeTree: async (d) => {
      for (const k of [...files.keys()]) if (k.startsWith(d + "/")) files.delete(k);
    },
    restrict: async () => {},
    makeDir: async () => {},
  };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("ok - " + name);
}

(async () => {
  await test("Per-stage layout model defaults to corner / large / centred, cleans overrides, and orders overlay buttons", () => {
    assert.deepEqual([...cal.ALERT_LAYOUTS], ["corner", "large", "centred"]);
    assert.equal(cal.cleanAlertLayout("centered"), "centred");
    assert.equal(cal.cleanAlertLayout("LARGE"), "large");
    assert.equal(cal.cleanAlertLayout("bogus", "large"), "large");

    assert.equal(cal.DEFAULT_ALERT_SETTINGS.stages.pre.layout, "corner");
    assert.equal(cal.DEFAULT_ALERT_SETTINGS.stages.due.layout, "large");
    assert.equal(cal.DEFAULT_ALERT_SETTINGS.stages.followup.layout, "centred");

    const custom = cal.cleanAlertSettings({
      stages: {
        pre: { sound: "quiet", layout: "large" },
        due: { sound: "loud", layout: "centred" },
        followup: { sound: "normal", layout: "corner" },
      },
    });
    assert.equal(custom.stages.pre.layout, "large");
    assert.equal(custom.stages.due.layout, "centred");
    assert.equal(custom.stages.followup.layout, "corner");

    const defFollowup = cal.reminderAlertPresentation("followup");
    assert.equal(defFollowup.layout, "centred");
    assert.equal(defFollowup.overlay, true);
    assert.equal(defFollowup.persistent, true);

    const cornerFollowup = cal.reminderAlertPresentation("followup", custom);
    assert.equal(cornerFollowup.layout, "corner");
    assert.equal(cornerFollowup.overlay, false);

    const centredPre = cal.reminderAlertPresentation("pre", {
      stages: { pre: { layout: "centred" } },
    });
    assert.equal(centredPre.layout, "centred");
    assert.equal(centredPre.overlay, true);
    assert.equal(centredPre.persistent, true);

    // Overlay button order: Done -> Snooze -> Open note -> Dismiss.
    const rawActions = [
      { id: "open", label: "Open linked note", callback() {} },
      { id: "done", label: "Done", callback() {} },
      { id: "snooze-10", label: "Snooze 10 min", callback() {} },
      { id: "snooze-60", label: "Snooze 1 hour", callback() {} },
      { id: "snooze-tomorrow", label: "Tomorrow", callback() {} },
      { id: "dismiss", label: "Dismiss", callback() {} },
    ];
    assert.deepEqual(
      cal.orderOverlayAlertActions(rawActions).map((a) => a.id),
      ["done", "snooze-10", "snooze-60", "snooze-tomorrow", "open", "dismiss"]
    );
  });

  await test("Stage 3 centred overlay renders scrim, orders large Done/Snooze/Open/Dismiss buttons, focuses Done, and maps Escape to Dismiss (never Done)", async () => {
    const dom = makeDom();
    let nowMs = new Date(2026, 10, 16, 16, 0, 0).getTime();
    const io = makeSharedDisk(() => nowMs);
    const { core } = loadEnv(dom);
    const store = core.createStore({
      io,
      notify() {},
      windowId: "w-main",
      now: () => nowMs,
      getDir: async () => "/notes",
      getMaxSaveMs: () => 5000,
      setTimer: () => 0,
      clearTimer() {},
      warn(e) { throw e; },
    });
    await store.open();
    const note = store.create("# Sprint\n\n## Agenda\n%%calendar%%\n- [ ] 2026-11-16 15:30 Send contract\n");
    store.stabilizeItems(note.id);
    const item = store.items.list({ noteId: note.id })[0];
    assert.ok(item);
    const identity = cal.reminderIdentity(item);

    // Put initial focus on a page button before the Stage 3 overlay appears.
    const priorInput = dom.document.createElement("button");
    priorInput.textContent = "Web page control";
    dom.document.body.append(priorInput);
    priorInput.focus();
    assert.ok(dom.document.activeElement === priorInput);

    let listenerCount = 0;
    const listen = (target, type, fn) => {
      listenerCount++;
      target.addEventListener(type, fn);
      return () => {
        listenerCount--;
        target.removeEventListener(type, fn);
      };
    };
    const stack = core.createReminderAlertStack({
      document: dom.document,
      history: store.items.history,
      listen,
      now: () => nowMs,
      getAlertSettings: () => store.meta.calendarAlertSettings,
    });

    let openedCount = 0;
    const actions = core.createReminderAlertActions({
      store,
      note: { __calendarReminder: true, __calendarItem: item },
      openNote: () => { openedCount++; return true; },
      showNotes: () => true,
    });

    stack.show({
      identity,
      title: item.summary,
      stage: "followup",
      actions,
    });

    const q = (sel) => dom.document.documentElement.querySelector(sel);
    const qa = (sel) => dom.document.documentElement.querySelectorAll(sel);

    const host = q(".zn-reminder-stack");
    assert.equal(host.getAttribute("data-overlay"), "true", "host enters centred overlay mode");
    const scrim = q(".zn-reminder-stack > .zn-reminder-scrim");
    assert.ok(scrim, "scrim backdrop rendered inside overlay stack");
    assert.equal(scrim.getAttribute("aria-hidden"), "true");

    const card = q('.zn-reminder-card[data-stage="followup"]');
    assert.ok(card);
    assert.equal(card.getAttribute("data-layout"), "centred");
    assert.equal(card.getAttribute("role"), "alertdialog");
    assert.equal(card.getAttribute("aria-modal"), "true");
    assert.equal(card.querySelector('[data-action="close"]'), null, "persistent Stage 3 overlay omits unrecorded Close button");

    // Verify exact button order: Done -> Snooze -> Open note -> Dismiss.
    const btnIds = card.querySelectorAll("button[data-action]").map((b) => b.getAttribute("data-action"));
    assert.deepEqual(btnIds, ["done", "snooze-10", "snooze-60", "snooze-tomorrow", "open", "dismiss"]);

    // Verify primary action (Done) receives focus automatically!
    const doneBtn = card.querySelector('[data-action="done"]');
    assert.ok(dom.document.activeElement === doneBtn, "focus lands on primary Done button when Stage 3 overlay opens");

    // Clicking scrim does NOT dismiss or mark done.
    scrim.click();
    assert.equal(qa(".zn-reminder-card").length, 1, "scrim click does not accidentally dismiss Stage 3");

    // Pressing Escape triggers Dismiss (NOT Done!): history records 'dismissed', note checkbox stays '[ ]', focus restores!
    const escEvent = new dom.Ev("keydown", { key: "Escape", bubbles: true });
    doneBtn.dispatchEvent(escEvent);
    assert.equal(escEvent.defaultPrevented, true);
    assert.equal(qa(".zn-reminder-card").length, 0, "Escape closes the Stage 3 overlay");
    assert.equal(host.getAttribute("data-overlay"), null, "overlay mode cleared when closed");
    assert.equal(q(".zn-reminder-scrim"), null, "scrim removed when overlay closes");
    assert.equal(store.items.history.stateFor(identity.itemId, identity.occurrenceId), "dismissed", "Escape records Dismissed, NOT Done");
    assert.match(store.get(note.id).body, /- \[ \] 2026-11-16 15:30 Send contract/, "Escape never ticks the note checkbox as Done");
    assert.equal(openedCount, 0);
    assert.ok(dom.document.activeElement === priorInput, "focus restores to prior element after Escape dismisses overlay");

    // Per-stage layout override: setting followup -> 'corner' renders corner card without scrim or focus steal.
    store.setMeta({
      calendarAlertSettings: cal.cleanAlertSettings({
        stages: { followup: { sound: "normal", layout: "corner" } },
      }),
    });
    const note2 = store.create("# Note 2\n\n## Agenda\n%%calendar%%\n- [ ] 2026-11-16 15:40 Review PR\n");
    store.stabilizeItems(note2.id);
    const item2 = store.items.list({ noteId: note2.id })[0];
    priorInput.focus();
    stack.show({
      identity: cal.reminderIdentity(item2),
      title: item2.summary,
      stage: "followup",
      actions: core.createReminderAlertActions({
        store,
        note: { __calendarReminder: true, __calendarItem: item2 },
        openNote: () => true,
      }),
    });
    assert.equal(q('.zn-reminder-card[data-stage="followup"]').getAttribute("data-layout"), "corner");
    assert.equal(host.getAttribute("data-overlay"), null, "corner override skips overlay mode");
    assert.equal(q(".zn-reminder-scrim"), null, "corner override skips scrim");
    assert.ok(dom.document.activeElement === priorInput, "corner override does not steal focus");

    stack.destroy();
    assert.equal(listenerCount, 0, "all stack and keydown listeners cleaned up on destroy");

    // Check CSS contract for centred overlay, scrim, and large overlay buttons.
    const fullCss = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
    const css = fullCss.slice(fullCss.indexOf(".zn-reminder-stack {"));
    assert.match(css, /\.zn-reminder-stack\[data-overlay="true"\][\s\S]*?align-items:\s*center[\s\S]*?justify-content:\s*center/);
    assert.match(css, /\.zn-reminder-scrim\s*\{[\s\S]*?position:\s*fixed[\s\S]*?inset:\s*0/);
    assert.match(css, /\.zn-reminder-card\[data-layout="centred"\]\s+\.zn-reminder-actions\s+button\s*\{[\s\S]*?padding:\s*10px\s+16px/);
  });

  await test("Reminder alert settings dialog exposes per-stage layout selects (corner / large / centred) and persists them", async () => {
    const dom = makeDom();
    const nowMs = new Date(2026, 10, 16, 10, 0, 0).getTime();
    const io = makeSharedDisk(() => nowMs);
    const { seam, core } = loadEnv(dom);
    const store = core.createStore({
      io,
      notify() {},
      windowId: "w-settings",
      now: () => nowMs,
      getDir: async () => "/notes",
      getMaxSaveMs: () => 5000,
      setTimer: () => 0,
      clearTimer() {},
      warn(e) { throw e; },
    });
    await store.open();
    const hostEl = dom.document.createElement("div");
    dom.document.body.append(hostEl);
    const adapter = {
      position: "float",
      host: hostEl,
      attach: (el) => hostEl.append(el),
      getArea: () => ({ width: 920, height: 700 }),
      watch: () => () => {},
      setActive() {},
      rewatch() {},
    };
    const env = {
      now: () => nowMs,
      getPref: (_k, d) => d,
      setPref() {},
      openLink() {},
      copyText() {},
      exportNote() {},
      exportAll() {},
      revealFolder() {},
      setBadge() {},
      refreshAgenda() {},
    };
    const sheet = core.createSheet({
      store,
      adapter,
      env,
      ensureStore: async () => store,
    });
    await sheet.open();
    const flush = async () => {
      for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    };
    await flush();

    const root = sheet.root;
    const q = (sel) => root.querySelector(sel);
    const qa = (sel) => root.querySelectorAll(sel);

    // Open Calendar Tools -> Reminder sounds & quiet hours.
    const toolsBtn = q(".zn-calendar-tools");
    assert.ok(toolsBtn, "Calendar Tools button exists");
    toolsBtn.click();
    await flush();
    const alertMenuItem = qa(".zn-menu button, .zn-menu-item").find((b) => /Reminder sounds\s*(?:&|and)\s*quiet hours/i.test(b.textContent));
    assert.ok(alertMenuItem, "Reminder sounds & quiet hours menu item exists");
    alertMenuItem.click();
    await flush();

    const dialog = q('[aria-label="Reminder sounds and quiet hours"]');
    assert.ok(dialog);
    const preLayout = dialog.querySelector('[aria-label="pre alert layout"]');
    const dueLayout = dialog.querySelector('[aria-label="due alert layout"]');
    const followupLayout = dialog.querySelector('[aria-label="followup alert layout"]');
    assert.ok(preLayout && dueLayout && followupLayout, "all 3 stage layout selects exist");
    assert.equal(preLayout.value, "corner");
    assert.equal(dueLayout.value, "large");
    assert.equal(followupLayout.value, "centred");

    preLayout.value = "large";
    dueLayout.value = "centred";
    followupLayout.value = "corner";
    dialog.querySelectorAll("button").find((b) => b.textContent.trim() === "Save alert settings").click();
    await flush();
    await store.flush();

    assert.equal(store.meta.calendarAlertSettings.stages.pre.layout, "large");
    assert.equal(store.meta.calendarAlertSettings.stages.due.layout, "centred");
    assert.equal(store.meta.calendarAlertSettings.stages.followup.layout, "corner");

    sheet.destroy();
  });

  await test("Cross-window Stage 3 single display: active window claims and shows centred overlay; second window stays empty", async () => {
    let nowMs = new Date(2026, 10, 16, 12, 0, 0).getTime();
    const io = makeSharedDisk(() => nowMs);
    const sharedRegistry = new Map();

    function makeWindow(id, isActive) {
      const dom = makeDom();
      const timers = [];
      const { core } = loadEnv(dom);
      const withHistoryLock = cal.createHistoryCoordinator(sharedRegistry);
      const store = core.createStore({
        io,
        notify() {},
        windowId: id,
        now: () => nowMs,
        getDir: async () => "/shared-notes",
        getMaxSaveMs: () => 5000,
        setTimer: () => 0,
        clearTimer() {},
        withHistoryLock,
        warn(e) { throw e; },
      });
      const listen = (target, type, fn) => {
        target.addEventListener(type, fn);
        return () => target.removeEventListener(type, fn);
      };
      let stack = null;
      let scheduler = null;
      return {
        id,
        dom,
        core,
        store,
        timers,
        async boot() {
          await store.open();
          stack = core.createReminderAlertStack({
            document: dom.document,
            history: store.items.history,
            listen,
            now: () => nowMs,
            getAlertSettings: () => store.meta.calendarAlertSettings,
          });
          scheduler = core.createReminderScheduler({
            store,
            now: () => nowMs,
            isActiveWindow: isActive,
            activeYieldMs: 120,
            setTimer: (fn, ms) => {
              const entry = { id: timers.length + 1, fn, ms, at: nowMs + ms, cleared: false };
              timers.push(entry);
              return entry.id;
            },
            clearTimer: (tid) => {
              const found = timers.find((t) => t.id === tid);
              if (found) found.cleared = true;
            },
            onDue: (batch) => {
              for (const n of batch) {
                const item = n.__calendarItem;
                const pres = cal.reminderAlertPresentation(n.__stage, store.meta.calendarAlertSettings);
                stack.show({
                  identity: cal.reminderIdentity(item),
                  title: item.summary,
                  stage: n.__stage,
                  layout: pres.layout,
                  actions: core.createReminderAlertActions({
                    store,
                    note: n,
                    openNote: () => true,
                  }),
                });
              }
            },
            deferUntilStart: true,
          });
        },
        get stack() { return stack; },
        get scheduler() { return scheduler; },
        overlayCards() {
          return dom.document.documentElement.querySelectorAll('.zn-reminder-card[data-layout="centred"]');
        },
        destroy() {
          scheduler?.destroy();
          stack?.destroy();
        },
      };
    }

    // Window A is inactive (in background), Window B is the active window — even though Window A ticks FIRST!
    const winA = makeWindow("win-A-inactive", () => false);
    const winB = makeWindow("win-B-active", () => true);
    await winA.boot();

    // Seed reminder due at 12:10 -> Stage 3 followup fires at 12:12 (default +2 min delay).
    const note = winA.store.create("# Contract\n\n## Agenda\n%%calendar%%\n- [ ] 2026-11-16 12:10 Sign NDA\n");
    winA.store.stabilizeItems(note.id);
    const item = winA.store.items.list({ noteId: note.id })[0];
    const identity = cal.reminderIdentity(item);
    // Pre-claim Stage 1 and Stage 2 so at 12:12 Stage 3 ('followup') fires cleanly.
    await winA.store.items.history.claimAlert({
      itemId: identity.itemId, occurrenceId: identity.occurrenceId,
      start: item.start, stage: "pre", at: nowMs,
    });
    await winA.store.items.history.claimAlert({
      itemId: identity.itemId, occurrenceId: identity.occurrenceId,
      start: item.start, stage: "due", at: new Date(2026, 10, 16, 12, 10, 0).getTime(),
    });
    await winA.store.flush();
    await winA.store.items.history.flush();

    await winB.boot();
    winA.scheduler.start();
    winB.scheduler.start();
    await new Promise((r) => setImmediate(r));

    // Advance to Stage 3 followup time (12:12:05). Fire INACTIVE Window A's timer BEFORE active Window B!
    nowMs = new Date(2026, 10, 16, 12, 12, 5).getTime();
    const fireDueTimers = async (w) => {
      for (const t of [...w.timers]) {
        if (!t.cleared && t.at <= nowMs) {
          t.cleared = true;
          t.fn();
        }
      }
      await new Promise((r) => setTimeout(r, 15));
    };

    await fireDueTimers(winA);
    assert.equal(winA.overlayCards().length, 0, "inactive Window A yields briefly so active window can claim Stage 3");

    await fireDueTimers(winB);
    assert.equal(winB.overlayCards().length, 1, "active Window B claims and displays the Stage 3 centred overlay");
    assert.notEqual(winB.dom.document.documentElement.querySelector(".zn-reminder-scrim"), null);

    // Even after Window A's 120ms yield elapses, claimAlert sees Window B's persisted claim and keeps Window A empty!
    nowMs += 200;
    await fireDueTimers(winA);
    assert.equal(winA.overlayCards().length, 0, "inactive Window A never shows duplicate Stage 3 overlay");
    assert.equal(winB.overlayCards().length, 1, "exactly one window shows Stage 3 overlay");

    winA.destroy();
    winB.destroy();
  });

  console.log(`\n${passed} Stage 3 centred overlay tests passed`);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
