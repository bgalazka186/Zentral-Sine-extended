"use strict";
const assert = require("node:assert/strict");
const { createFakeZen } = require("./helpers/fake-zen-browser.cjs");
const C = require("../additional/notes/calendar/ZentralNotesCalendar.js");

const SPACE_MODE = "zen.workspace.zentral.notes.space_mode";
const AGENDA = "zen.workspace.zentral.notes.agenda_folder";
const NOTES = "zen.workspace.zentral.notes.zen_folder";
const BASE_DIR = "/profile/zentral-notes";
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

function makeSharedObs() {
  const map = new Map();
  return {
    addObserver(observer, topic) {
      if (!map.has(topic)) map.set(topic, new Set());
      map.get(topic).add(observer);
    },
    removeObserver(observer, topic) {
      map.get(topic)?.delete(observer);
    },
    notifyObservers(subject, topic, data) {
      for (const observer of [...(map.get(topic) || [])]) observer.observe(subject, topic, data);
    },
  };
}

async function settle(turns = 6) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

const root = (space, attr) => space.querySelector(`zen-folder[${attr}]`);

async function testPureSpaceCore() {
  const h = createFakeZen();
  try {
    const core = h.window.__zentralNotesTestSeam.core;
    assert.deepEqual([...core.SPACE_MODES], ["shared", "space"]);
    assert.equal(core.cleanSpaceMode("space"), "space");
    assert.equal(core.cleanSpaceMode("shared"), "shared");
    assert.equal(core.cleanSpaceMode("bogus"), "shared");

    assert.equal(core.cleanWorkspaceId("  {1111-AAAA}  "), "{1111-AAAA}");
    assert.equal(core.cleanWorkspaceId("../escape"), "");
    assert.equal(core.cleanWorkspaceId("a/b"), "");
    assert.equal(core.cleanWorkspaceId(""), "");

    const k1 = core.workspaceDirKey("{1111-AAAA}");
    const k2 = core.workspaceDirKey("{1111-aaaa}");
    const k3 = core.workspaceDirKey("{1111-AAAA}");
    assert.match(k1, /^ws-[a-z0-9_-]+$/);
    assert.equal(k1, k3, "dir key is deterministic for one persistent UUID");
    assert.notEqual(k1, k2, "dir key preserves case distinction via hash");

    const readyTarget = core.resolveSpaceStorageTarget({
      baseDir: BASE_DIR,
      mode: "space",
      activeWorkspace: { uuid: "space-a", dirKey: core.workspaceDirKey("space-a"), ready: true },
      join: (...p) => p.join("/"),
    });
    assert.equal(readyTarget.ready, true);
    assert.equal(readyTarget.dir, BASE_DIR + "/spaces/" + core.workspaceDirKey("space-a"));

    const unreadyTarget = core.resolveSpaceStorageTarget({
      baseDir: BASE_DIR,
      mode: "space",
      activeWorkspace: { uuid: "", dirKey: "", ready: false },
      join: (...p) => p.join("/"),
    });
    assert.equal(unreadyTarget.ready, false);
    assert.equal(unreadyTarget.dir, "", "unready space-local mode never falls back to shared root");

    const sharedTarget = core.resolveSpaceStorageTarget({
      baseDir: BASE_DIR,
      mode: "shared",
      activeWorkspace: { uuid: "", dirKey: "", ready: false },
      join: (...p) => p.join("/"),
    });
    assert.equal(sharedTarget.ready, true);
    assert.equal(sharedTarget.dir, BASE_DIR);

    // Registry tracks renames without changing dirKey and marks removed spaces without deleting them.
    const r1 = core.reconcileSpaceRegistry(
      core.cleanSpaceRegistry(null),
      [{ uuid: "u-1", name: "Work" }, { uuid: "u-2", name: "Personal" }],
      { uuid: "u-1", name: "Work", dirKey: core.workspaceDirKey("u-1"), ready: true },
      1000,
    );
    assert.equal(r1.changed, true);
    const origDirKey = r1.registry.spaces["u-1"].dirKey;
    const r2 = core.reconcileSpaceRegistry(
      r1.registry,
      [{ uuid: "u-1", name: "Work Renamed" }],
      { uuid: "u-1", name: "Work Renamed", dirKey: origDirKey, ready: true },
      2000,
    );
    assert.equal(r2.registry.spaces["u-1"].dirKey, origDirKey, "rename never changes dirKey");
    assert.equal(r2.registry.spaces["u-1"].lastLabel, "Work Renamed");
    assert.equal(r2.registry.spaces["u-2"].removedAt, 2000, "absent workspace is marked removed, not deleted");

    // LWW share merge preserves both concurrent additions and tombstones.
    const baseShares = core.cleanSpaceShares({
      version: 1,
      notes: {
        n1: { id: "n1", ownerSpaceId: "u-1", ownerDirKey: origDirKey, spaces: ["u-2"], updated: 100, rev: 1 },
      },
      items: {},
    });
    const localShares = core.cleanSpaceShares({
      version: 1,
      notes: {
        n1: { id: "n1", ownerSpaceId: "u-1", ownerDirKey: origDirKey, spaces: [], deleted: true, updated: 200, rev: 2 },
        n2: { id: "n2", ownerSpaceId: "u-1", ownerDirKey: origDirKey, spaces: ["u-2"], updated: 150, rev: 1 },
      },
      items: {},
    });
    const remoteShares = core.cleanSpaceShares({
      version: 1,
      notes: {
        n1: { id: "n1", ownerSpaceId: "u-1", ownerDirKey: origDirKey, spaces: ["u-2"], updated: 100, rev: 1 },
        n3: { id: "n3", ownerSpaceId: "u-2", ownerDirKey: core.workspaceDirKey("u-2"), spaces: ["*"], updated: 160, rev: 1 },
      },
      items: {},
    });
    const merged = core.mergeSpaceShares(localShares, remoteShares);
    assert.equal(merged.notes.n1.deleted, true, "newer unshare tombstone wins over older share");
    assert.deepEqual([...merged.notes.n2.spaces], ["u-2"], "local new share kept");
    assert.deepEqual([...merged.notes.n3.spaces], ["*"], "remote new share kept");
    assert.equal(baseShares.notes.n1.spaces[0], "u-2");

    const planForU2 = core.planSpaceSharesForSpace(merged, "u-2");
    assert.equal(planForU2.sharedNotes.has("n1"), false);
    assert.equal(planForU2.sharedNotes.has("n2"), true);
    assert.equal(planForU2.sharedNotes.has("n3"), false, "owner does not mount its own note as foreign share");
  } finally {
    await h.destroy();
  }
}

async function testIsolationRenameRemovedAndReversibleMode() {
  const files = new Map();
  const h = createFakeZen({ files, prefs: { [AGENDA]: true, [NOTES]: "all", [SPACE_MODE]: "shared" }, workspaceName: "Work" });
  const spaceAId = h.sidebar.ws.id;
  const spaceB = h.addWorkspace("space-b", { name: "Personal" });

  await h.seam.ensureStore();
  // Seed shared-mode dataset first.
  const sharedNote = h.seam.store.create("# Shared Handbook\nVisible in shared mode");
  const start = C.addDays(C.dayStart(Date.now()), 1) + 10 * 3600000;
  h.seam.store.items.upsert(C.makeItem({
    id: "rem-shared-root",
    summary: "Shared mode reminder",
    start: { dateTime: new Date(start).toISOString() },
    x: { src: "manual", kind: "reminder" },
  }));
  await h.seam.store.flush();
  assert.ok(files.has(`${BASE_DIR}/${sharedNote.id}.md`), "shared note stored in base dir");

  // Switch to space-local mode: existing shared data must stay intact and NOT leak into Space A.
  h.setPref(SPACE_MODE, "space");
  await settle(10);
  await h.seam.store.switchSpaceContext();
  assert.equal(h.seam.store.spaceMode(), "space");
  assert.equal(h.seam.store.spaceId(), spaceAId);
  assert.equal(h.seam.store.get(sharedNote.id), null, "shared-mode dataset does not silently merge into Space A");
  assert.equal(h.seam.store.items.get("rem-shared-root"), null, "shared-mode reminder does not leak into Space A");

  // Create Space A local note, folder, attachment, reminder, and note overrides.
  const fidA = h.seam.store.addFolder("Work Projects");
  const noteA = h.seam.store.create("# Space A Spec\nPrivate work plan", fidA);
  const assetA = await h.seam.store.saveAsset(noteA.id, TINY_PNG, "image/png");
  assert.equal(assetA.ok, true);
  h.seam.store.setMeta({
    calendarNoteAlertOverrides: { [noteA.id]: { pre: { sound: "silent" } } },
    calendarNoteAgendaOverrides: { [noteA.id]: { enabled: true, leadDays: 3 } },
  });
  h.seam.store.items.upsert(C.makeItem({
    id: "rem-a-only",
    summary: "Space A private reminder",
    start: { dateTime: new Date(start + 3600000).toISOString() },
    x: { src: "manual", kind: "reminder" },
  }));
  await h.seam.store.flush();
  const dirKeyA = h.window.__zentralNotesTestSeam.core.workspaceDirKey(spaceAId);
  assert.ok(files.has(`${BASE_DIR}/spaces/${dirKeyA}/${noteA.id}.md`), "Space A note written in Space A partition");
  assert.ok(files.has(`${BASE_DIR}/spaces/${dirKeyA}/${assetA.rel}`), "Space A asset written in Space A partition");

  h.seam.zen.runNow();
  h.seam.agendaController.invalidate();
  h.seam.agendaController.runNow();
  assert.ok(root(h.sidebar.ws, "bgalazka-notes-folder").querySelectorAll("tab").some((t) => (t.getAttribute("label") || "").includes("Space A Spec")));
  assert.ok(root(h.sidebar.ws, "bgalazka-notes-agenda-folder").querySelectorAll("tab").some((t) => (t.getAttribute("label") || "").includes("Space A private reminder")));

  // Switch to Space B: must be completely isolated from Space A.
  await h.switchWorkspace("space-b");
  await settle(10);
  await h.seam.store.switchSpaceContext();
  assert.equal(h.seam.store.spaceId(), "space-b");
  assert.equal(h.seam.store.get(noteA.id), null, "Space A note does not leak into Space B");
  assert.equal(h.seam.store.items.get("rem-a-only"), null, "Space A reminder does not leak into Space B");
  assert.equal(await h.seam.store.readAsset(assetA.rel), null, "Space A attachment does not leak into Space B");

  const noteB = h.seam.store.create("# Space B Journal\nPersonal journal");
  h.seam.store.items.upsert(C.makeItem({
    id: "rem-b-only",
    summary: "Space B private reminder",
    start: { dateTime: new Date(start + 7200000).toISOString() },
    x: { src: "manual", kind: "reminder" },
  }));
  await h.seam.store.flush();
  h.seam.zen.runNow();
  h.seam.agendaController.invalidate();
  h.seam.agendaController.runNow();
  const bNotesTabs = [...root(spaceB.element, "bgalazka-notes-folder").querySelectorAll("tab")].map((t) => t.getAttribute("label") || "");
  const bAgendaTabs = [...root(spaceB.element, "bgalazka-notes-agenda-folder").querySelectorAll("tab")].map((t) => t.getAttribute("label") || "");
  assert.ok(bNotesTabs.some((l) => l.includes("Space B Journal")), "Space B sidebar projects Space B note");
  assert.ok(!bNotesTabs.some((l) => l.includes("Space A Spec")), "Space B sidebar never retains Space A note");
  assert.ok(bAgendaTabs.some((l) => l.includes("Space B private reminder")), "Space B Agenda projects Space B reminder");
  assert.ok(!bAgendaTabs.some((l) => l.includes("Space A private reminder")), "Space B Agenda never retains Space A reminder");

  // Rename Space A -> identity is UUID, so switching back retains every Space A record.
  h.renameWorkspace(spaceAId, "Work Q4");
  await h.switchWorkspace(spaceAId);
  await settle(10);
  await h.seam.store.switchSpaceContext();
  assert.ok(h.seam.store.get(noteA.id), "renamed Space A keeps its notes");
  assert.ok(await h.seam.store.readAsset(assetA.rel), "renamed Space A keeps its attachments");
  assert.ok(h.seam.store.items.get("rem-a-only"), "renamed Space A keeps its calendar items");

  // Remove Space B and recreate a new space with Space B's old name -> files stay preserved, new space is isolated.
  const dirKeyB = h.window.__zentralNotesTestSeam.core.workspaceDirKey("space-b");
  h.removeWorkspace("space-b");
  h.addWorkspace("space-b-v2", { name: "Personal" });
  await h.switchWorkspace("space-b-v2");
  await settle(10);
  await h.seam.store.switchSpaceContext();
  assert.equal(h.seam.store.get(noteB.id), null, "recreated space with same name gets a fresh partition");
  assert.ok(files.has(`${BASE_DIR}/spaces/${dirKeyB}/${noteB.id}.md`), "removed space files are never deleted");
  const spacesList = h.seam.store.listSpaces();
  assert.equal(spacesList.find((s) => s.uuid === "space-b")?.removed, true, "removed space remains listed as archived/removed");

  // Reversible mode switch: space -> shared -> space retains both datasets cleanly.
  h.setPref(SPACE_MODE, "shared");
  await settle(10);
  await h.seam.store.switchSpaceContext();
  assert.equal(h.seam.store.spaceMode(), "shared");
  assert.ok(h.seam.store.get(sharedNote.id), "switching back to shared restores shared notes untouched");
  assert.ok(h.seam.store.items.get("rem-shared-root"), "switching back to shared restores shared items untouched");
  assert.equal(h.seam.store.get(noteA.id), null, "space-local notes never leak into shared mode");
  await h.destroy();

  // Restart in space-local mode on Space A -> both shared & space-local data survived on disk.
  const restarted = createFakeZen({ files, prefs: { [AGENDA]: true, [NOTES]: "all", [SPACE_MODE]: "space" }, workspaceName: "Work Q4" });
  try {
    restarted.addWorkspace("space-b-v2", { name: "Personal" });
    await restarted.seam.ensureStore();
    assert.ok(restarted.seam.store.get(noteA.id), "restart retains Space A note");
    assert.ok(
      restarted.seam.store.items.list().some((i) => i.id === "rem-a-only" || i.x?.historyId === "rem-a-only"),
      "restart retains Space A reminder",
    );
    assert.ok(files.has(`${BASE_DIR}/${sharedNote.id}.md`), "shared dataset remains preserved on disk across restart");
  } finally {
    await restarted.destroy();
  }
}

async function testSelectiveNoteSharingAndLinkedRecords() {
  const files = new Map();
  const h = createFakeZen({ files, prefs: { [AGENDA]: true, [NOTES]: "all", [SPACE_MODE]: "space" }, workspaceName: "Work" });
  const spaceAId = h.sidebar.ws.id;
  const spaceB = h.addWorkspace("space-b", { name: "Personal" });
  try {
    await h.seam.ensureStore();
    const fid = h.seam.store.addFolder("Secret Clients");
    const tomorrow = C.localDateKey(C.addDays(C.dayStart(Date.now()), 1));
    const note = h.seam.store.create(`# Shared Launch Plan\n\n%%calendar%%\n- [ ] ${tomorrow} 11:00 Ship launch announcement`, fid);
    const savedAsset = await h.seam.store.saveAsset(note.id, TINY_PNG, "image/png");
    assert.equal(savedAsset.ok, true);
    h.seam.store.update(note.id, note.body + `\n![img](${savedAsset.rel})`, "edit");
    h.seam.store.stabilizeItems(note.id);
    h.seam.store.setMeta({
      calendarNoteAlertOverrides: { [note.id]: { pre: { sound: "loud" } } },
      calendarNoteAgendaOverrides: { [note.id]: { enabled: true, leadDays: 5 } },
    });
    const linked = h.seam.store.items.list().find((it) => it.x?.noteId === note.id);
    assert.ok(linked, "linked calendar reminder created from note");
    await h.seam.store.flush();

    // Share Note with Space B.
    const sharedOk = await h.seam.store.shareNote(note.id, ["space-b"]);
    assert.equal(sharedOk, true);
    const infoA = h.seam.store.noteShareInfo(note.id);
    assert.equal(infoA.isOwner, true);
    assert.deepEqual([...infoA.spaces], ["space-b"]);

    // Switch to Space B.
    await h.switchWorkspace("space-b");
    await settle(10);
    await h.seam.store.switchSpaceContext();

    const mounted = h.seam.store.get(note.id);
    assert.ok(mounted, "shared note is visible in Space B");
    assert.equal(mounted._sharedFromOtherSpace, true);
    assert.equal(mounted._spaceOwner, spaceAId);
    const infoB = h.seam.store.noteShareInfo(note.id);
    assert.equal(infoB.isOwner, false);
    assert.equal(infoB.sharedFromOtherSpace, true);

    // Space A's private folder structure does NOT leak into Space B's Zen sidebar.
    h.seam.zen.runNow();
    h.seam.agendaController.invalidate();
    h.seam.agendaController.runNow();
    const bNotesRoot = root(spaceB.element, "bgalazka-notes-folder");
    const bSubfolders = [...bNotesRoot.querySelectorAll("zen-folder[bgalazka-notes-subfolder]")].map((f) => f.getAttribute("label") || "");
    assert.ok(!bSubfolders.some((l) => l.includes("Secret Clients")), "owner's private folder structure does not leak into Space B");
    assert.ok([...bNotesRoot.querySelectorAll("tab")].some((t) => (t.getAttribute("label") || "").includes("Shared Launch Plan")), "shared note appears in Space B sidebar");

    // Attachment resolves from Space A's canonical directory without duplication!
    const readInB = await h.seam.store.readAsset(savedAsset.rel);
    assert.ok(readInB && readInB.mime === "image/png" && readInB.bytes.length === TINY_PNG.length, "shared note attachment readable in Space B");
    const dirKeyB = h.window.__zentralNotesTestSeam.core.workspaceDirKey("space-b");
    assert.equal(files.has(`${BASE_DIR}/spaces/${dirKeyB}/${savedAsset.rel}`), false, "attachment is NOT duplicated into Space B");

    // Linked calendar reminder & owner overrides travel with the shared note!
    const linkedInB = h.seam.store.items.get(linked.id);
    assert.ok(linkedInB, "linked calendar reminder is shared with its source note");
    assert.equal(h.seam.store.noteAlertOverride(note.id)?.pre?.sound, "loud", "owner note alert override applies in Space B");
    assert.equal(h.seam.store.noteAgendaOverride(note.id)?.leadDays, 5, "owner note agenda override applies in Space B");

    // Editing shared note in Space B writes canonically to Space A and preserves Space A's folder!
    h.seam.store.update(note.id, mounted.body + "\nAdded from Space B", "edit");
    await h.seam.store.flush();
    const dirKeyA = h.window.__zentralNotesTestSeam.core.workspaceDirKey(spaceAId);
    const canonicalText = files.get(`${BASE_DIR}/spaces/${dirKeyA}/${note.id}.md`) || "";
    assert.ok(canonicalText.includes("Added from Space B"), "edit in Space B writes to canonical Space A file");
    assert.ok(canonicalText.includes("folder: " + fid), "edit in Space B preserves owner's folder metadata");
    assert.equal(files.has(`${BASE_DIR}/spaces/${dirKeyB}/${note.id}.md`), false, "shared note is NOT duplicated into Space B");

    // Marking linked reminder Done in Space B writes to canonical Space A reminder-history.json!
    const doneRes = h.seam.store.runAgendaCommand(linkedInB, "mark-done");
    assert.equal(doneRes.ok, true);
    await h.seam.store.flush();
    const ident = C.reminderIdentity(linkedInB);
    assert.equal(h.seam.store.items.history.stateFor(ident.itemId, ident.occurrenceId), "done");

    // Switch back to Space A and verify body edit, folder, and canonical Done history.
    await h.switchWorkspace(spaceAId);
    await settle(10);
    await h.seam.store.switchSpaceContext();
    assert.ok(h.seam.store.get(note.id).body.includes("Added from Space B"));
    assert.equal(h.seam.store.get(note.id).folder, fid);
    assert.equal(h.seam.store.items.history.stateFor(ident.itemId, ident.occurrenceId), "done", "Done recorded in Space B is canonical in Space A");

    // Recipient unshare removes note from Space B without deleting Space A's note.
    await h.switchWorkspace("space-b");
    await settle(10);
    await h.seam.store.switchSpaceContext();
    assert.equal(await h.seam.store.unshareNote(note.id), true);
    assert.equal(h.seam.store.get(note.id), null, "unshared note disappears from Space B");
    assert.equal(h.seam.store.items.get(linked.id), null, "linked item disappears when note is unshared");

    await h.switchWorkspace(spaceAId);
    await settle(10);
    await h.seam.store.switchSpaceContext();
    assert.ok(h.seam.store.get(note.id), "recipient unshare never deletes owner's note");

    // Share with All spaces ("*"), then owner Trash hides it in Space B; Restore brings it back.
    assert.equal(await h.seam.store.shareNote(note.id, ["*"]), true);
    h.seam.store.trash(note.id);
    await h.seam.store.flush();
    await h.switchWorkspace("space-b");
    await settle(10);
    await h.seam.store.switchSpaceContext();
    assert.equal(h.seam.store.get(note.id), null, "trashed shared note is hidden from recipient space");
    assert.equal(h.seam.store.items.get(linked.id), null, "trashed shared note's linked items are hidden from recipient space");

    await h.switchWorkspace(spaceAId);
    await settle(10);
    await h.seam.store.switchSpaceContext();
    h.seam.store.restore(note.id);
    await h.seam.store.flush();
    await h.switchWorkspace("space-b");
    await settle(10);
    await h.seam.store.switchSpaceContext();
    assert.ok(h.seam.store.get(note.id), "restored shared note reappears in recipient space");
  } finally {
    await h.destroy();
  }
}

async function testCalendarItemSharingWithoutSourceNote() {
  const files = new Map();
  const h = createFakeZen({ files, prefs: { [AGENDA]: true, [NOTES]: "all", [SPACE_MODE]: "space" }, workspaceName: "Work" });
  const spaceAId = h.sidebar.ws.id;
  h.addWorkspace("space-b", { name: "Personal" });
  try {
    await h.seam.ensureStore();
    const start = C.addDays(C.dayStart(Date.now()), 1) + 14 * 3600000;
    const privateNote = h.seam.store.create("# Secret Payroll\nConfidential numbers");
    h.seam.store.items.upsert(C.makeItem({
      id: "rem-standalone",
      summary: "Shared dentist appointment",
      start: { dateTime: new Date(start).toISOString() },
      x: { src: "manual", kind: "reminder" },
    }));
    h.seam.store.items.upsert(C.makeItem({
      id: "rem-linked-only",
      summary: "Run payroll check",
      start: { dateTime: new Date(start + 3600000).toISOString() },
      x: { src: "manual", kind: "reminder", noteId: privateNote.id },
    }));
    await h.seam.store.flush();

    assert.equal(await h.seam.store.shareItem("rem-standalone", ["space-b"]), true);
    assert.equal(await h.seam.store.shareItem("rem-linked-only", ["space-b"]), true);

    await h.switchWorkspace("space-b");
    await settle(10);
    await h.seam.store.switchSpaceContext();

    assert.equal(h.seam.store.get(privateNote.id), null, "source note stays private when only its calendar item is shared");
    const standaloneB = h.seam.store.items.get("rem-standalone");
    const linkedB = h.seam.store.items.get("rem-linked-only");
    assert.ok(standaloneB && linkedB, "both explicitly shared calendar items are visible in Space B");

    const openCheck = h.seam.store.canOpenSourceNote(linkedB);
    assert.equal(openCheck.allowed, false, "source note cannot be opened when not shared");
    assert.equal(openCheck.reason, "source-note-private");

    // Snoozing shared reminder in Space B updates canonical Space A schedule + history.
    const oldStart = standaloneB.start.dateTime;
    const snoozeRes = h.seam.store.runAgendaCommand(standaloneB, "snooze-1d");
    assert.equal(snoozeRes.ok, true);
    await h.seam.store.flush();
    const newStart = h.seam.store.items.get("rem-standalone").start.dateTime;
    assert.notEqual(newStart, oldStart);

    await h.switchWorkspace(spaceAId);
    await settle(10);
    await h.seam.store.switchSpaceContext();
    assert.equal(h.seam.store.items.get("rem-standalone").start.dateTime, newStart, "Space B snooze persists canonically in Space A");
  } finally {
    await h.destroy();
  }
}

async function testMultiWindowLiveSyncAndSingleFireAlerts() {
  const files = new Map();
  const sharedObs = makeSharedObs();
  const hiddenDOMWindow = { Map };
  const win1 = createFakeZen({ id: "w1", files, sharedObs, hiddenDOMWindow, prefs: { [AGENDA]: true, [NOTES]: "all", [SPACE_MODE]: "space" }, workspaceName: "Work" });
  const win2 = createFakeZen({ id: "w2", files, sharedObs, hiddenDOMWindow, prefs: { [AGENDA]: true, [NOTES]: "all", [SPACE_MODE]: "space" }, workspaceName: "Work" });
  const spaceAId = win1.sidebar.ws.id;
  win1.addWorkspace("space-b", { name: "Personal" });
  win2.addWorkspace("space-b", { name: "Personal" });
  await win2.switchWorkspace("space-b");

  try {
    await Promise.all([win1.seam.ensureStore(), win2.seam.ensureStore()]);
    assert.equal(win1.seam.store.spaceId(), spaceAId);
    assert.equal(win2.seam.store.spaceId(), "space-b");

    // Private note & future reminder in Window 1 (Space A) must NEVER leak or fire in Window 2 (Space B).
    const privateA = win1.seam.store.create("# Private A");
    const futureDueMs = Date.now() + 60 * 60000;
    win1.seam.store.items.upsert(C.makeItem({
      id: "rem-private-a",
      summary: "Private A alarm",
      start: { dateTime: new Date(futureDueMs).toISOString() },
      x: { src: "manual", kind: "reminder" },
    }));
    await win1.seam.store.flush();
    await settle(10);
    assert.equal(win2.seam.store.get(privateA.id), null, "Window 1 local note never leaks to Window 2");
    assert.equal(win2.seam.store.items.get("rem-private-a"), null, "Window 1 local reminder never leaks to Window 2");

    // Share a note + future reminder from Window 1 -> Window 2 receives live share notification!
    const sharedNote = win1.seam.store.create("# Live Shared Note\nv1");
    win1.seam.store.items.upsert(C.makeItem({
      id: "rem-shared-due",
      summary: "Shared alarm",
      start: { dateTime: new Date(futureDueMs).toISOString() },
      x: { src: "manual", kind: "reminder" },
    }));
    await win1.seam.store.flush();
    assert.equal(await win1.seam.store.shareNote(sharedNote.id, ["space-b"]), true);
    assert.equal(await win1.seam.store.shareItem("rem-shared-due", ["space-b"]), true);
    await settle(20);

    assert.ok(win2.seam.store.get(sharedNote.id), "Window 2 mounts newly shared note live");
    assert.ok(win2.seam.store.items.get("rem-shared-due"), "Window 2 mounts newly shared reminder live");

    // Edit shared note in Window 1 -> Window 2 reloads canonical edit live.
    win1.seam.store.update(sharedNote.id, "# Live Shared Note\nv2 from win1", "edit");
    await win1.seam.store.flush();
    await settle(20);
    assert.ok(win2.seam.store.get(sharedNote.id).body.includes("v2 from win1"), "Window 2 live-reloads shared note edits");

    // Canonical single-fire alerts: BOTH windows run schedulers at the due instant, shared reminder fires ONCE total,
    // and private Space A reminder fires ONLY in Window 1!
    const core1 = win1.window.__zentralNotesTestSeam.core;
    const core2 = win2.window.__zentralNotesTestSeam.core;
    const fired1 = [], fired2 = [];
    const atDue = futureDueMs + 1000;
    const s1 = core1.createReminderScheduler({
      store: win1.seam.store,
      now: () => atDue,
      setTimer: (fn, ms) => win1.window.setTimeout(fn, ms),
      clearTimer: (id) => win1.window.clearTimeout(id),
      onDue: (list) => { for (const x of list) fired1.push(x.__historyIdentity?.itemId || x.id); },
    });
    const s2 = core2.createReminderScheduler({
      store: win2.seam.store,
      now: () => atDue,
      setTimer: (fn, ms) => win2.window.setTimeout(fn, ms),
      clearTimer: (id) => win2.window.clearTimeout(id),
      onDue: (list) => { for (const x of list) fired2.push(x.__historyIdentity?.itemId || x.id); },
    });
    await Promise.all([s1.reschedule(), s2.reschedule()]);
    await settle(20);
    s1.destroy();
    s2.destroy();

    const sharedFireCount = fired1.filter((x) => x === "rem-shared-due").length + fired2.filter((x) => x === "rem-shared-due").length;
    assert.equal(sharedFireCount, 1, "shared reminder fires EXACTLY ONCE across two windows in different spaces");
    assert.equal(fired2.filter((x) => x === "rem-private-a").length, 0, "private Space A reminder NEVER fires in Space B window");
    assert.equal(fired1.filter((x) => x === "rem-private-a").length, 1, "private Space A reminder fires once in Space A window");
  } finally {
    await win1.destroy();
    await win2.destroy();
    assert.equal(win1.workspaceListenerCount(), 0, "win1 detaches workspace listener on destroy");
    assert.equal(win2.workspaceListenerCount(), 0, "win2 detaches workspace listener on destroy");
  }
}

async function testCorruptSharesConflictFailureAndUnload() {
  // 1. Corrupt shares.json creates .corrupt backup and blocks overwrites without losing local notes.
  const files = new Map();
  files.set(`${BASE_DIR}/spaces/shares.json`, "{not valid json");
  const h = createFakeZen({ files, prefs: { [SPACE_MODE]: "space" }, workspaceName: "Work" });
  const spaceAId = h.sidebar.ws.id;
  h.addWorkspace("space-b", { name: "Personal" });
  try {
    await h.seam.ensureStore();
    assert.equal(files.get(`${BASE_DIR}/spaces/shares.json.corrupt`), "{not valid json", "corrupt shares.json is backed up");
    assert.equal(h.seam.store.spaceStorageState().sharesWriteBlocked, true, "writes to corrupt shares.json are blocked");
    const n = h.seam.store.create("# Local still works");
    assert.equal(await h.seam.store.shareNote(n.id, ["space-b"]), false, "share refuses to overwrite protected corrupt shares.json");
    assert.equal(files.get(`${BASE_DIR}/spaces/shares.json`), "{not valid json", "original corrupt shares.json untouched");
    await h.seam.store.flush();
    const dirKeyA = h.window.__zentralNotesTestSeam.core.workspaceDirKey(spaceAId);
    assert.ok(files.has(`${BASE_DIR}/spaces/${dirKeyA}/${n.id}.md`), "local note save still succeeds safely");
  } finally {
    await h.destroy();
  }

  // 2. Concurrent shares.json writes from two windows merge per-record via LWW without clobbering.
  const files2 = new Map();
  const sharedObs = makeSharedObs();
  const hiddenDOMWindow = { Map };
  const w1 = createFakeZen({ id: "c1", files: files2, sharedObs, hiddenDOMWindow, prefs: { [SPACE_MODE]: "space" }, workspaceName: "Work" });
  const w2 = createFakeZen({ id: "c2", files: files2, sharedObs, hiddenDOMWindow, prefs: { [SPACE_MODE]: "space" }, workspaceName: "Work" });
  w1.addWorkspace("space-b", { name: "Personal" });
  w2.addWorkspace("space-b", { name: "Personal" });
  await w2.switchWorkspace("space-b");
  try {
    await Promise.all([w1.seam.ensureStore(), w2.seam.ensureStore()]);
    const n1 = w1.seam.store.create("# From A");
    const n2 = w2.seam.store.create("# From B");
    await Promise.all([w1.seam.store.flush(), w2.seam.store.flush()]);
    await Promise.all([
      w1.seam.store.shareNote(n1.id, ["space-b"]),
      w2.seam.store.shareNote(n2.id, [w1.sidebar.ws.id]),
    ]);
    const savedShares = JSON.parse(files2.get(`${BASE_DIR}/spaces/shares.json`));
    assert.ok(savedShares.notes[n1.id] && !savedShares.notes[n1.id].deleted, "Window 1 share preserved");
    assert.ok(savedShares.notes[n2.id] && !savedShares.notes[n2.id].deleted, "Window 2 share preserved");

    // 3. Unload recovery stages dirty local note in Space B and dirty shared note in canonical Space A.
    await settle(15);
    assert.ok(w2.seam.store.get(n1.id), "Space B mounted shared note n1");
    w2.seam.store.update(n2.id, "# From B\nunsaved local on close", "edit");
    w2.seam.store.update(n1.id, "# From A\nunsaved shared edit from B on close", "edit");
    w2.seam.store.flushOnUnload();
    const dirKeyA = w1.window.__zentralNotesTestSeam.core.workspaceDirKey(w1.sidebar.ws.id);
    const dirKeyB = w1.window.__zentralNotesTestSeam.core.workspaceDirKey("space-b");
    assert.ok([...files2.keys()].some((k) => k.startsWith(`${BASE_DIR}/spaces/${dirKeyB}/backup/unload/`)), "local dirty note staged in Space B unload recovery");
    assert.ok([...files2.keys()].some((k) => k.startsWith(`${BASE_DIR}/spaces/${dirKeyA}/backup/unload/`)), "shared dirty note staged in canonical Space A unload recovery");
  } finally {
    await w1.destroy();
    await w2.destroy();
  }

  // 4. Unready workspace identity in space-local mode never writes to shared root.
  const files3 = new Map();
  const unready = createFakeZen({ files: files3, prefs: { [SPACE_MODE]: "space" } });
  unready.window.gZenWorkspaces.activeWorkspace = "";
  try {
    let threw = false;
    try { await unready.seam.ensureStore(); } catch (_) { threw = true; }
    assert.equal(threw, true, "open fails safely instead of falling back to shared root when workspace UUID is unavailable");
    assert.equal([...files3.keys()].filter((k) => k.startsWith(BASE_DIR + "/") && !k.includes("/spaces/")).length, 0, "zero files written to shared root");
  } finally {
    await unready.destroy();
  }
}

(async () => {
  await testPureSpaceCore();
  await testIsolationRenameRemovedAndReversibleMode();
  await testSelectiveNoteSharingAndLinkedRecords();
  await testCalendarItemSharingWithoutSourceNote();
  await testMultiWindowLiveSyncAndSingleFireAlerts();
  await testCorruptSharesConflictFailureAndUnload();
  console.log("6 space-isolation and selective-sharing (OW-18) tests passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
