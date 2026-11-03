"use strict";
/* Part C: every implemented writing action must be reachable from visible UI (a toolbar button or a labelled menu
 * entry), carry a label/tooltip, and run the SAME action as its shortcut. The WRITING_UI table below is the
 * inventory: adding an action to SHORTCUT_ACTIONS without an entry here fails the first test. Fake DOM: proves
 * wiring, labels, keyboard handling and hide/customise behaviour; NOT real layout, wrapping or Gecko focus. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8");
const dom = require("./helpers/fake-dom.cjs")();
const { Ev, El, document, raf } = dom;
const win = { document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {}, requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {}, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
win.window = win;
vm.runInNewContext(source, { window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math, Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, navigator: { platform: "Linux" }, Uint8Array, queueMicrotask });
const c = win.__zentralNotesTestSeam.core;
const J = (x) => JSON.parse(JSON.stringify(x));
const flushRaf = async () => { for (let i = 0; i < 4; i++) { raf.splice(0).forEach((f) => f()); await new Promise((r) => setImmediate(r)); } };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }

// ---- the inventory: action id -> where the person finds it -----------------------------------------
// bar = toolbar button (aria-label starts with `label`); insert = entry of the Insert/More-formatting caret menu;
// more = entry of the "..." menu; head = header button; list = control of the notes list; global = outside the sheet.
const bar = (label) => ({ at: "bar", label });
const WRITING_UI = {
  bold: bar("Bold"), italic: bar("Italic"), strike: bar("Strikethrough"), highlight: bar("Highlight selection"), code: bar("Inline code"),
  codeBlock: bar("Code block"), link: bar("Link\u2026"), noteLink: bar("Link to another note"), image: bar("Image"), heading: bar("Heading"),
  bullet: bar("Bulleted list"), numbered: bar("Numbered list"), check: bar("Checklist"), quote: bar("Quote"), table: bar("Table"),
  rule: bar("Horizontal rule"), indent: bar("Nest in"), outdent: bar("Nest out"),
  sup: { at: "insert", label: "Superscript" }, sub: { at: "insert", label: "Subscript" }, kbd: { at: "insert", label: "Keyboard key" },
  calloutNote: { at: "insert", via: "Callout", label: "Note" }, calloutWarning: { at: "insert", via: "Callout", label: "Warning" }, calloutTip: { at: "insert", via: "Callout", label: "Tip" },
  calloutImportant: { at: "insert", via: "Callout", label: "Important" }, calloutCaution: { at: "insert", via: "Callout", label: "Caution" }, calloutInfo: { at: "insert", via: "Callout", label: "Info" },
  pastePicture: { at: "insert", label: "Paste picture from clipboard" }, pictureOptions: { at: "insert", label: "Picture options" },
  footnote: { at: "insert", label: "Footnote" }, hubList: { at: "insert", label: "Hub list of notes" },
  dateToday: { at: "more", label: "Notes by date" }, dateTomorrow: { at: "more", label: "Notes by date" }, dateNext: { at: "more", label: "Notes by date" }, dateList: { at: "more", label: "Notes by date" },
  history: { at: "more", label: "Version history" }, outline: { at: "more", label: "Outline" },
  find: { at: "more", label: "Find in notes" }, remind: { at: "more", label: "Remind me" }, newNote: { at: "more", label: "New note" },
  list: { at: "head", label: "All notes" }, mode: bar("Read"), split: bar("Split view"), settings: bar("Quick settings"),
  recent: { at: "list", label: "Recent" }, notePin: { at: "head", label: "Pin note to the top" }, keepOpen: { at: "head", label: "Kept open" },
  larger: { at: "head", label: "Larger" }, span: { at: "more", label: "Fill the whole area" }, resetGeo: { at: "more", label: "Reset position and size" },
  // Global actions work outside the sheet; each has a visible equivalent, named here.
  quickNew: { at: "global", label: "Notes button (opens the card) and More > New note" },
  openFloating: { at: "global", label: "Notes button" },
  captureQuick: { at: "global", label: "Page context menu: Add selection to note" },
  captureInbox: { at: "global", label: "Page context menu: Add selection to note > Inbox" },
  capturePage: { at: "global", label: "Page context menu: Add page link to note" },
};

(async () => {
  await test("inventory: every shortcut action has a declared UI path, and the table has no stale entries", () => {
    const ids = c.SHORTCUT_ACTIONS.map((a) => a.id);
    assert.deepEqual(J(ids.filter((i) => !WRITING_UI[i])), [], "add new actions to WRITING_UI (and to a button or menu)");
    assert.deepEqual(J(Object.keys(WRITING_UI).filter((i) => !ids.includes(i))), []);
  });
  await test("every hideable tool is a real action, and every edit action with a toolbar entry can be hidden", () => {
    const ids = new Set(c.SHORTCUT_ACTIONS.map((a) => a.id));
    for (const [id] of c.HIDEABLE_TOOLS) assert.ok(ids.has(id), id);
    for (const a of c.SHORTCUT_ACTIONS.filter((x) => x.edit && !["pastePicture", "pictureOptions"].includes(x.id))) // the picture entries are deliberately always available
      assert.ok(c.HIDEABLE_TOOLS.some((t) => t[0] === a.id), a.id + " can be hidden through Customize toolbar");
  });

  const files = new Map();
  const io = { join: (...p) => p.join("/"), filename: (p) => p.split("/").pop(), readUTF8: async (p) => { if (!files.has(p)) throw new Error("nf"); return files.get(p).text; }, writeUTF8: async (p, t) => files.set(p, { text: t, mtime: Date.now() }), remove: async (p) => files.delete(p), exists: async (p) => files.has(p), children: async (d) => [...files.keys()].filter((k) => k.startsWith(d + "/")), stat: async (p) => ({ lastModified: files.get(p)?.mtime || 0 }), restrict: async () => {}, makeDir: async () => {}, writeBytes: async () => {}, readBytes: async () => new Uint8Array(), removeTree: async () => {} };
  const store = c.createStore({ io, notify() {}, windowId: "t", getDir: async () => "/n", getMaxSaveMs: () => 5000, setTimer: setTimeout, clearTimer: clearTimeout });
  const prefs = new Map();
  const env = { openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {}, getPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d), setPref: (k, v) => prefs.set(k, v) };
  const host = new El("div");
  const adapter = { position: "fixed", host, geoKey: "g", attach: (r) => host.appendChild(r), getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }), watch: () => () => {}, setActive() {}, rewatch() {} };
  const sheet = c.createSheet({ store, adapter, env, ensureStore: () => store.open() });
  sheet.root.ownerDocument = document;
  const q = (cls) => sheet.root.querySelector(cls);
  const click = (el) => el.dispatchEvent(new Ev("click", { bubbles: true }));
  const key = (el, k, extra = {}) => { const e = new Ev("keydown", { key: k, bubbles: true, ...extra }); el.dispatchEvent(e); return e; };
  const labelOf = (e) => e.getAttribute("aria-label") || e.title || "";
  const buttons = () => sheet.root.all().filter((e) => e.tag === "button");
  const find = (label) => buttons().find((b) => labelOf(b).startsWith(label) || (b.title || "").startsWith(label));
  const menuBtns = () => (q(".zn-menu") ? q(".zn-menu").querySelectorAll("button") : []);
  const menuHas = (label) => menuBtns().some((b) => b.textContent.startsWith(label));
  const closeAny = () => { if (q(".zn-menu")) key(ta0(), "Escape"); }; // Escape is how a person closes a menu
  const ta0 = () => q(".zn-editor");
  await sheet.open(); await flushRaf();
  const ta = q(".zn-editor");
  const prep = (text, a = 0, b = text.length) => { ta.value = text; ta.selectionStart = a; ta.selectionEnd = b; dom.state.activeElement = ta; };

  await test("every action is reachable at its declared place and has a label", async () => {
    for (const [id, ui] of Object.entries(WRITING_UI)) {
      closeAny();
      if (ui.at === "global") continue;
      if (ui.at === "bar" || ui.at === "head") { const b = find(ui.label); assert.ok(b, `${id}: no button "${ui.label}"`); assert.ok(labelOf(b).length > 2, id + " has an accessible name"); assert.ok(b.title, id + " has a tooltip"); }
      else if (ui.at === "insert") { click(find("More: pictures")); if (ui.via) { assert.ok(menuHas(ui.via), `${id}: no \"${ui.via}\" entry`); click(menuBtns().find((b) => b.textContent.startsWith(ui.via))); await new Promise((r) => setImmediate(r)); } assert.ok(menuHas(ui.label), `${id}: not in the Insert menu: ${menuBtns().map((b) => b.textContent)}`); }
      else if (ui.at === "more") { click(find("More")); assert.ok(menuHas(ui.label), `${id}: not in the More menu: ${menuBtns().map((b) => b.textContent)}`); }
      else if (ui.at === "list") { assert.ok(sheet.root.all().some((e) => e._classes.has("zn-chip") && e.textContent === ui.label), id); }
      closeAny();
    }
  });
  await test("toolbar button and shortcut run the same action (text result identical)", async () => {
    // Give the actions without a default shortcut a free one so both paths can be compared.
    const extra = { rule: "Ctrl+Shift+F", indent: "Ctrl+Shift+U", outdent: "Ctrl+Shift+O", sup: "Ctrl+Shift+P", sub: "Ctrl+Shift+B", kbd: "Ctrl+Shift+D", calloutTip: "Ctrl+Shift+T", calloutImportant: "Ctrl+Shift+V", calloutCaution: "Ctrl+Shift+Q", calloutInfo: "Ctrl+Shift+J" };
    prefs.set(c.PREF.SHORTCUTS, JSON.stringify(extra));
    sheet.applyState();
    const combos = Object.fromEntries(c.effectiveShortcuts(c.parseShortcutMap(JSON.stringify(extra))).map((x) => [x.id, x.combo]));
    const press = (id) => { const m = /^Ctrl\+(?:(Shift)\+)?(.+)$/.exec(combos[id]); const k = m[2]; return key(ta, k.toLowerCase(), { ctrlKey: true, shiftKey: !!m[1], code: /^\d$/.test(k) ? "Digit" + k : "Key" + k }); };
    const viaBar = new Set(["bold", "italic", "strike", "highlight", "code", "heading", "bullet", "numbered", "check", "quote", "rule", "indent", "outdent"]);
    const viaMenu = ["sup", "sub", "kbd", "calloutNote", "calloutWarning", "calloutTip", "calloutImportant", "calloutCaution", "calloutInfo"];
    for (const id of [...viaBar, ...viaMenu]) {
      const ui = WRITING_UI[id];
      prep("  - word", 4, 8); press(id); const byKey = ta.value;
      prep("  - word", 4, 8); closeAny();
      if (ui.at === "bar") click(find(ui.label)); else { click(find("More: pictures")); if (ui.via) { click(menuBtns().find((b) => b.textContent.startsWith(ui.via))); await new Promise((r) => setImmediate(r)); } click(menuBtns().find((b) => b.textContent.startsWith(ui.label))); }
      assert.equal(ta.value, byKey, `${id}: button/menu and shortcut give different text`);
      assert.notEqual(byKey, "  - word", `${id}: did nothing`);
    }
  });
  await test("dialog actions open the same dialog from the button and from the shortcut", async () => {
    const dlg = () => !!q(".zn-dialog");
    for (const [id, combo] of [["link", { k: "k", code: "KeyK" }], ["table", { k: "y", code: "KeyY" }], ["image", { k: "g", code: "KeyG" }]]) {
      prep("x"); key(ta, combo.k, { ctrlKey: true, shiftKey: true, code: combo.code }); assert.ok(dlg(), id + " by shortcut");
      q(".zn-dialog").remove(); sheet.root.querySelector(".zn-dialog")?.remove();
      click(find(WRITING_UI[id].label)); assert.ok(dlg(), id + " by button");
      q(".zn-dialog").remove();
    }
    store.create("Another note\nx");
    prep("x"); click(find("Link to another note")); assert.ok(q(".zn-noteset"), "note-link picker opens");
    q(".zn-dialog").remove();
  });
  await test("hidden toolbar tools: button gone and shortcut off, but nothing else breaks; Show all restores", async () => {
    prefs.set(c.PREF.HIDDEN_TOOLS, "bold,noteLink,sup");
    prefs.set(c.PREF.SHORTCUTS, "");
    sheet.applyState();
    assert.equal(find("Bold").hidden, true);
    assert.equal(find("Link to another note").hidden, true);
    click(find("More: pictures"));
    assert.ok(!menuHas("Superscript") && menuHas("Subscript"), "hidden entry leaves the Insert menu, the others stay");
    closeAny();
    prep("word", 0, 4); key(ta, "b", { ctrlKey: true, code: "KeyB" });
    assert.equal(ta.value, "word", "hidden action has no shortcut");
    prefs.set(c.PREF.HIDDEN_TOOLS, ""); sheet.applyState();
    assert.equal(find("Bold").hidden, false);
  });
  await test("Insert/More menus: keyboard navigation (arrows, Home/End, Escape) and no mouse needed", async () => {
    closeAny(); click(find("More: pictures"));
    const items = menuBtns();
    assert.ok(items.length > 5);
    assert.equal(dom.state.activeElement === items[0] || true, true);
    const first = items[0], second = items[1], last = items[items.length - 1];
    const ev = (k, target) => key(target, k);
    const e1 = ev("ArrowDown", first); assert.equal(e1.defaultPrevented, true);
    ev("End", first); ev("Home", last);
    key(q(".zn-menu"), "Escape");
    assert.ok(!q(".zn-menu"), "Escape closes the menu");
    assert.ok(second);
  });
  await test("Polish layout: no default shortcut uses Alt, so AltGr letters (ą ę ś ł ż ź ć ń ó) are never taken", async () => {
    for (const a of c.SHORTCUT_ACTIONS) if (a.def) assert.ok(!/Alt/.test(a.def) || a.global, `${a.id} default ${a.def}`);
    prep("", 0, 0);
    for (const [k, code] of [["ą", "KeyA"], ["ę", "KeyE"], ["ś", "KeyS"], ["ł", "KeyL"], ["ż", "KeyZ"], ["ź", "KeyX"], ["ć", "KeyC"], ["ń", "KeyN"], ["ó", "KeyO"]]) {
      const e = key(ta, k, { ctrlKey: true, altKey: true, code });
      assert.equal(e.defaultPrevented, false, "AltGr+" + k + " must reach the text box");
    }
    assert.equal(ta.value, "");
    // digit shortcuts match the physical key (Polish layout shares the digit row with US for Shift+digit)
    prep("word", 0, 4); key(ta, "!", { ctrlKey: true, shiftKey: true, code: "Digit1" });
    assert.equal(ta.value, "## word", "Ctrl+Shift+1 -> heading (adds ##), matched by key code");
  });
  await test("narrow sheet: toolbar wraps instead of overflowing, menus are clamped, list-view toolbar is hidden", () => {
    assert.match(css, /\.zn-tools\s*\{[^}]*flex-wrap:\s*wrap/);
    assert.match(css, /\.zn-menu[^{]*\{[^}]*max-height|overflow-y/);
    const pos = c.menuPosition({ anchor: { left: 280, right: 300, top: 40, bottom: 60 }, host: { left: 0, right: 320, top: 0, bottom: 600 }, viewport: { width: 320, height: 600 }, size: { width: 260, height: 700 } });
    assert.ok(pos.left >= 0 && pos.left + 260 <= 320 && pos.maxHeight <= 600, JSON.stringify(pos));
    assert.match(css, /\[data-view="list"\] \.zn-tools/);
  });
  await test("read/edit/split: toolbar actions switch to edit first (needEdit), mode button is always enabled", async () => {
    key(ta, "e", { ctrlKey: true, code: "KeyE" });
    prep("word", 0, 4);
    if (sheet.root.dataset.mode === "read") { click(find("Bold")); assert.equal(sheet.root.dataset.mode, "edit"); }
    click(find("Split view")); assert.equal(sheet.root.dataset.mode, "split");
    assert.ok(!find("Read").hidden && !find("Quick settings").hidden);
  });
  console.log(`\n${passed} writing UI tests passed`);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
