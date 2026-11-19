"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const dom = require("./helpers/fake-dom.cjs")(), win = { document: dom.document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {} }; win.window = win;
vm.runInNewContext(fs.readFileSync(require.resolve("../additional/notes/ZentralNotes.uc.js"), "utf8"), { window: win, document: dom.document, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout });
const c = win.__zentralNotesTestSeam.core;
assert.equal(typeof c.filterZenSidebarState, "function");
assert.equal(typeof c.acquireZenSidebarShield, "function");
const pseudo = { index: 1, entries: [{ url: "about:blank#zn-note:abc" }], pinned: true };
const agenda = { index: 1, entries: [{ url: "about:blank#zn-agenda-item%3Aa" }], pinned: true };
const normal = { index: 2, entries: [{ url: "about:blank#zn-note:abc" }, { url: "https://example.org/" }] };
const pending = { entries: [{ url: "about:blank" }], _zenPinnedInitialState: { entry: { url: "about:blank#zn-new:" } } };
const state = { windows: [{ tabs: [pseudo, normal, agenda, pending], folders: [{ id: "normal" }], selected: 2 }], other: { safe: true } };
const before = JSON.stringify(state), filtered = c.filterZenSidebarState(state);
assert.equal(JSON.stringify(state), before, "never mutate native input");
assert.deepEqual(Array.from(filtered.windows[0].tabs), [normal]);
assert.equal(filtered.windows[0].folders, state.windows[0].folders, "folder metadata and user folders are not removed");
assert.equal(c.filterZenSidebarState({ windows: [{ tabs: [normal] }] }).windows[0].tabs[0], normal);
const folderState = { windows: [
  { tabs: [{ ...pseudo, zenSyncId: "pseudo" }, { ...agenda, zenSyncId: "agenda" }], folders: [
    { id: "bgalazka-zentral-notes", parentId: null },
    { id: "bgalazka-zentral-notes-sub_used", parentId: "bgalazka-zentral-notes" },
    { id: "zentral-notes-agenda", parentId: null },
    { id: "zentral-notes-agenda-day-2026-11-13", parentId: "zentral-notes-agenda", emptyTabIds: ["agenda"] },
    { id: "ordinary-folder", parentId: null, prevSiblingInfo: { type: "group", id: "zentral-notes-agenda" } },
  ] },
  { tabs: [{ ...normal, groupId: "bgalazka-zentral-notes-sub_used", zenSyncId: "normal-tab" }], folders: [] },
] };
const folderBefore = JSON.stringify(folderState), folderResult = c.filterZenSidebarState(folderState);
assert.equal(JSON.stringify(folderState), folderBefore);
assert.deepEqual(Array.from(folderResult.windows[0].folders, x => x.id), ["bgalazka-zentral-notes", "bgalazka-zentral-notes-sub_used", "ordinary-folder"], "empty managed folders are omitted, but parents containing user tabs in another window survive");
assert.equal(folderResult.windows[0].folders[2].prevSiblingInfo.type, "start", "removed previous sibling is not referenced");
const nativeGroups = { windows: [
  { tabs: [{ ...agenda, zenSyncId: "a" }], folders: [{ id: "zentral-notes-agenda" }, { id: "bgalazka-zentral-notes" }], groups: [{ id: "zentral-notes-agenda", label: "virtual" }, { id: "bgalazka-zentral-notes" }, { id: "ordinary", label: "Keep" }] },
  { tabs: [{ ...normal, groupId: "bgalazka-zentral-notes" }], folders: [] },
] };
const groupsBefore = JSON.stringify(nativeGroups), groupsResult = c.filterZenSidebarState(nativeGroups);
assert.equal(JSON.stringify(nativeGroups), groupsBefore);
assert.deepEqual(Array.from(groupsResult.windows[0].groups, g => g.id), ["bgalazka-zentral-notes", "ordinary"], "native group for removed virtual folder is not synced; groups needed by real tabs or owned by user are retained");
const foreignTree = { windows: [{ tabs: [pseudo], folders: [{ id: "zentral-notes-agenda" }, { id: "my-private-folder", parentId: "zentral-notes-agenda" }] }] };
assert.deepEqual(Array.from(c.filterZenSidebarState(foreignTree).windows[0].folders, f => f.id), ["zentral-notes-agenda", "my-private-folder"], "foreign child protects its managed ancestor");
const oddShape = { windows: [{ tabs: null, folders: {} }] };
assert.equal(c.filterZenSidebarState(oddShape), oddShape, "unknown state shapes are preserved without mutation");
let seen = [], native = { saveState(value, soon) { seen.push([this, value, soon]); return "saved"; } }, original = native.saveState;
const a = c.acquireZenSidebarShield(native), b = c.acquireZenSidebarShield(native);
assert.ok(a && b); assert.equal(a.isCurrent(), true);
assert.equal(native.saveState(state, true), "saved"); assert.equal(seen[0][0], native); assert.deepEqual(Array.from(seen[0][1].windows[0].tabs), [normal]); assert.equal(seen[0][2], true);
a(); native.saveState(state, false); assert.equal(seen[1][1].windows[0].tabs.length, 1, "second window retains protection");
const captured = native.saveState; b(); assert.equal(native.saveState, original); captured.call(native, state, false); assert.equal(seen[2][1], state, "captured wrappers are inert after disposal");
const first = c.acquireZenSidebarShield(native), wrapper = native.saveState, newer = function (...args) { return wrapper.apply(this, args); }; native.saveState = newer; first();
assert.equal(first.isCurrent(), false);
assert.equal(native.saveState, newer, "do not overwrite a newer wrapper"); native.saveState(state, false); assert.equal(seen.at(-1)[1], state, "old captured wrapper becomes inert");
const prototype = { saveState(x) { return x; } }, inherited = Object.create(prototype);
const releaseInherited = c.acquireZenSidebarShield(inherited);
assert.ok(Object.hasOwn(inherited, "saveState")); releaseInherited();
assert.equal(Object.hasOwn(inherited, "saveState"), false, "restore inherited native descriptor");
const locked = {}; Object.defineProperty(locked, "saveState", { value: original, configurable: false, writable: false });
assert.equal(c.acquireZenSidebarShield(locked), null); assert.equal(locked.saveState, original);
const normalWithOldPin = { entries: [{ url: "https://example.org" }], _zenPinnedInitialState: { entry: { url: "about:blank#zn-new:" } } };
const keep = { windows: [{ tabs: [normalWithOldPin] }] };
assert.equal(c.filterZenSidebarState(keep), keep, "normal active navigation is not dropped because of old pin data");
const source = fs.readFileSync(require.resolve("../additional/notes/ZentralNotes.uc.js"), "utf8");
assert.match(source, /ZenSessionManager\.sys\.mjs/);
assert.match(source, /notes-zen-sidebar-session-shield/);
console.log("Zen sidebar shield tests passed");
