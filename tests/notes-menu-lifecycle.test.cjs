"use strict";
/* T2.12c1: exercise the real Notes menu controller through a fake DOM and tracked window listeners. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const winListeners = new Map();
const win = {
  document,
  ZentralRuntime: { register() {} },
  __zentralNotesTestSeam: {},
  innerWidth: 1200,
  innerHeight: 800,
  requestAnimationFrame: (fn) => raf.push(fn),
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  addEventListener(type, fn, options) {
    const rows = winListeners.get(type) || [];
    rows.push({ fn, capture: options === true || options?.capture === true });
    winListeners.set(type, rows);
  },
  removeEventListener(type, fn) {
    winListeners.set(type, (winListeners.get(type) || []).filter((row) => row.fn !== fn));
  },
  dispatchEvent(event) {
    event.target = event.target || win;
    for (const row of [...(winListeners.get(event.type) || [])]) row.fn(event);
    return !event.defaultPrevented;
  },
  listenerCount(type) { return (winListeners.get(type) || []).length; },
};
win.window = win;
vm.runInNewContext(source, {
  window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console,
  URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout,
  navigator: { platform: "Linux" },
});
const c = win.__zentralNotesTestSeam.core;
const flushRaf = async () => {
  for (let i = 0; i < 4; i++) {
    raf.splice(0).forEach((fn) => fn());
    await new Promise((resolve) => setImmediate(resolve));
  }
};
const files = new Map();
const io = {
  join: (...parts) => parts.join("/"),
  filename: (value) => value.split("/").pop(),
  readUTF8: async (value) => { if (!files.has(value)) throw new Error("not found"); return files.get(value).text; },
  writeUTF8: async (value, text) => files.set(value, { text, mtime: Date.now() }),
  remove: async (value) => files.delete(value),
  exists: async (value) => files.has(value),
  children: async (dir) => [...files.keys()].filter((value) => value.startsWith(dir + "/")),
  stat: async (value) => ({ lastModified: files.get(value)?.mtime || 0 }),
  restrict: async () => {},
};
const store = c.createStore({ io, notify() {}, windowId: "menu-test", getDir: async () => "/notes", getMaxSaveMs: () => 5000, setTimer: setTimeout, clearTimer: clearTimeout });
const env = { openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} };
const host = new El("div");
const adapter = {
  position: "fixed", host, attach: (root) => host.appendChild(root),
  getArea: () => ({ left: 0, top: 0, width: 500, height: 700, anchor: "top" }),
  watch: () => () => {}, setActive() {}, rewatch() {},
};
const dispatchWindow = (type, target = win, extra = {}) => win.dispatchEvent(new Ev(type, { target, ...extra }));
const query = (root, selector) => root.querySelector(selector);
const all = (root, selector) => root.querySelectorAll(selector);
const menuOpen = (root) => !!query(root, ".zn-menu");
const test = async (name, fn) => { await fn(); console.log("ok -", name); };

(async () => {
  await store.open();
  await test("menu model normalizes legacy and current actions, nested groups, stable IDs and disabled reasons", () => {
    const calls = [];
    const input = [
      { id: "save", label: "Save", enabled: true, run: () => calls.push("save") },
      { id: "save", label: "Unavailable", enabled: false, reason: "Requires a non-empty note", run: () => calls.push("bad") },
      { label: "Informational heading", disabled: true },
      { label: "Legacy action", action: () => calls.push("legacy") },
      { label: "More", group: [{ label: "Nested", action: () => calls.push("nested") }] },
      { label: "\u2003Linux", action: () => calls.push("linux") },
    ];
    const model = c.normalizeContextMenuItems(input, "test");
    assert.equal(model[0].id, "save");
    assert.equal(model[0].enabled, true);
    model[0].run();
    assert.equal(model[1].id, "save-2", "duplicate IDs are made unique without dropping either item");
    assert.equal(model[1].enabled, false);
    assert.equal(model[1].reason, "Requires a non-empty note");
    assert.equal(model[1].run, null, "a disabled action cannot be invoked by the renderer");
    assert.equal(model[2].heading, true);
    assert.equal(model[3].enabled, true, "legacy action descriptors remain compatible");
    model[3].run();
    assert.equal(model[4].group[0].enabled, true);
    model[4].group[0].run();
    assert.equal(model[5].label, "\u2003Linux", "intentional leading indentation is retained in outline labels");
    assert.deepEqual(calls, ["save", "legacy", "nested"]);
    assert.equal(input[0].enabled, true, "normalization leaves caller-owned properties unchanged");
    assert.equal(input[0].run instanceof Function, true);
    assert.equal(input[0].id, "save");
  });
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  sheet.root.ownerDocument = document;
  await sheet.open();
  await flushRaf();
  const more = sheet.root.all().find((element) => element.title === "More");
  assert.ok(more, "More menu trigger is available");

  await test("Enter activates a focused submenu action through the shared menu controller", () => {
    more.click();
    const first = query(sheet.root, ".zn-menu button");
    assert.ok(first);
    const event = new Ev("keydown", { key: "Enter", bubbles: true });
    first.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.match(query(sheet.root, ".zn-menu").textContent, /Save as Markdown/);
    assert.equal(menuOpen(sheet.root), true, "opening a submenu does not close the parent menu surface");
    dispatchWindow("pointerdown", sheet.root);
  });

  await test("disabled actions stay visible, non-focusable and explain why they are unavailable", async () => {
    const trash = sheet.root.all().find((element) => element.classList?.contains("zn-chip") && element.textContent === "Trash");
    assert.ok(trash, "Trash filter is available");
    const event = new Ev("contextmenu", { bubbles: true, clientX: 80, clientY: 80 });
    trash.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    const unavailable = all(sheet.root, ".zn-menu button").find((button) => button.textContent.includes("Empty trash now"));
    assert.ok(unavailable, "disabled action remains in the menu");
    assert.equal(unavailable.disabled, true);
    assert.equal(unavailable.getAttribute("aria-disabled"), "true");
    assert.match(unavailable.textContent, /Trash is empty/);
    assert.notEqual(dom.state.activeElement, unavailable, "the first enabled action receives focus instead");
    assert.match(dom.state.activeElement.textContent, /Deleted notes backup/);
    const firstEnabled = dom.state.activeElement;
    firstEnabled.dispatchEvent(new Ev("keydown", { key: "ArrowDown", bubbles: true }));
    assert.notEqual(dom.state.activeElement, firstEnabled, "ArrowDown skips the disabled action and advances");
    dom.state.activeElement.dispatchEvent(new Ev("keydown", { key: "Home", bubbles: true }));
    assert.equal(dom.state.activeElement, firstEnabled, "Home returns to the first enabled action");
    dispatchWindow("pointerdown", sheet.root);
  });

  await test("outside pointer press closes a menu anywhere in the window without requiring the sheet root", () => {
    more.click();
    assert.equal(menuOpen(sheet.root), true);
    assert.equal(win.listenerCount("pointerdown"), 1);
    assert.equal(win.listenerCount("blur"), 1);
    dispatchWindow("pointerdown", sheet.root);
    assert.equal(menuOpen(sheet.root), false);
    assert.equal(win.listenerCount("pointerdown"), 0, "outside listener is removed with the menu");
    assert.equal(win.listenerCount("blur"), 0, "focus listener is removed with the menu");
    assert.equal(sheet.isOpen(), true, "a press inside the sheet does not close the sheet itself");
    more.click();
    const browserChrome = new El("button");
    browserChrome.id = "navigator-toolbox";
    dispatchWindow("pointerdown", browserChrome);
    assert.equal(menuOpen(sheet.root), false, "a browser-chrome press dismisses the menu");
    assert.equal(sheet.isOpen(), true, "menu dismissal does not force-close the sheet");
  });

  await test("pointering inside the menu keeps it open; pressing its anchor toggles it closed", () => {
    more.click();
    const first = query(sheet.root, ".zn-menu button");
    assert.ok(first);
    dispatchWindow("pointerdown", first);
    assert.equal(menuOpen(sheet.root), true);
    dispatchWindow("pointerdown", more);
    first.dispatchEvent(new Ev("focusout", { bubbles: true, relatedTarget: more }));
    assert.equal(menuOpen(sheet.root), true, "focus returning to the anchor must not preempt its click cancellation");
    more.click();
    assert.equal(menuOpen(sheet.root), false, "the same anchor cancels its menu");
  });

  await test("Escape closes the menu and leaves Notes open", () => {
    more.click();
    const first = query(sheet.root, ".zn-menu button");
    const event = new Ev("keydown", { key: "Escape", bubbles: true });
    first.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(menuOpen(sheet.root), false);
    assert.equal(sheet.isOpen(), true);
  });

  await test("focus leaving a menu closes it, including a move to another control inside the sheet", () => {
    more.click();
    const first = query(sheet.root, ".zn-menu button");
    const otherControl = sheet.root.all().find((element) => element.title === "All notes (Ctrl+K)");
    const event = new Ev("focusout", { bubbles: true, relatedTarget: otherControl });
    first.dispatchEvent(event);
    assert.equal(menuOpen(sheet.root), false);
  });

  await test("window focus loss closes the active menu", () => {
    more.click();
    assert.equal(menuOpen(sheet.root), true);
    dispatchWindow("blur");
    assert.equal(menuOpen(sheet.root), false);
  });

  await test("switching from the editor to the list closes an open menu", () => {
    more.click();
    assert.equal(menuOpen(sheet.root), true);
    const allNotes = sheet.root.all().find((element) => element.title === "All notes (Ctrl+K)");
    allNotes.click();
    assert.equal(sheet.root.dataset.view, "list");
    assert.equal(menuOpen(sheet.root), false);
  });

  await test("switching between edit and read mode closes an open menu", () => {
    const note = store.create("A note for mode switching");
    sheet.openNoteById(note.id);
    more.click();
    const first = query(sheet.root, ".zn-menu button");
    first.dispatchEvent(new Ev("keydown", { key: "e", ctrlKey: true, bubbles: true }));
    assert.equal(sheet.root.dataset.mode, "read");
    assert.equal(menuOpen(sheet.root), false);
  });

  await test("opening another note closes a menu before switching the active note", async () => {
    const firstNote = store.create("First note in the navigation test");
    const secondNote = store.create("Second note in the navigation test");
    sheet.openNoteById(firstNote.id);
    await flushRaf();
    more.click();
    assert.equal(menuOpen(sheet.root), true);
    sheet.openNoteById(secondNote.id);
    assert.equal(query(sheet.root, ".zn-editor").value, "Second note in the navigation test");
    assert.equal(menuOpen(sheet.root), false);
  });

  await test("an explicit menu action runs once and removes the menu before changing notes", () => {
    const beforeId = store.latestId();
    more.click();
    const create = all(sheet.root, ".zn-menu-item").find((element) => element.textContent === "New note");
    assert.ok(create, "New note action is in the menu");
    create.click();
    assert.equal(menuOpen(sheet.root), false);
    assert.notEqual(store.latestId(), beforeId, "the action creates and opens exactly one new note");
  });

  await test("native context-menu handlers suppress the browser menu and stop propagation", async () => {
    const fixture = store.create("A note for the context-menu lifecycle test");
    sheet.openNoteById(fixture.id);
    await flushRaf();
    const allNotes = sheet.root.all().find((element) => element.title === "All notes (Ctrl+K)");
    allNotes.click();
    await flushRaf();
    const row = all(sheet.root, ".zn-item").find((element) => element.getAttribute("data-id"));
    assert.ok(row, "a note row exists");
    const event = new Ev("contextmenu", { bubbles: true, clientX: 120, clientY: 90 });
    row.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
    assert.equal(menuOpen(sheet.root), true);
    dispatchWindow("pointerdown", sheet.root);
    assert.equal(menuOpen(sheet.root), false, "point-anchored menus dismiss without requiring anchor.contains()");
  });

  await test("repeated cycles stay listener-stable; sheet close and destroy release open menus", async () => {
    const pointerBaseline = win.listenerCount("pointerdown");
    const blurBaseline = win.listenerCount("blur");
    for (let index = 0; index < 25; index++) {
      more.click();
      assert.equal(menuOpen(sheet.root), true);
      dispatchWindow("pointerdown", sheet.root);
      assert.equal(menuOpen(sheet.root), false);
    }
    assert.equal(win.listenerCount("pointerdown"), pointerBaseline);
    assert.equal(win.listenerCount("blur"), blurBaseline);

    more.click();
    assert.equal(menuOpen(sheet.root), true);
    sheet.close();
    assert.equal(menuOpen(sheet.root), false, "closing the sheet dismisses an active menu");
    assert.equal(win.listenerCount("pointerdown"), pointerBaseline);
    assert.equal(win.listenerCount("blur"), blurBaseline);

    await sheet.open();
    await flushRaf();
    more.click();
    assert.equal(menuOpen(sheet.root), true);
    sheet.destroy();
    assert.equal(menuOpen(sheet.root), false, "destroying the sheet dismisses an active menu");
    assert.equal(win.listenerCount("pointerdown"), 0);
    assert.equal(win.listenerCount("blur"), 0);
  });

  console.log("14 Notes menu lifecycle tests passed");
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
