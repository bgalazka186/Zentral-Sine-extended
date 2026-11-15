"use strict";
/* T3.1: Settings and Quick settings at a larger text size (and in a narrow sheet).

   Node has no layout engine, so this file does not measure pixels. The pixels were measured in a headless Chromium
   (tools/audit-notes-settings-layout.cjs: every text size 8-40 px in sheets 240-700 px wide, no row over another,
   nothing outside its row or the card). What this file holds in place is what that result rests on:

   1. what the style sheet makes of the real elements of the real dialogs (tests/helpers/css-cascade.cjs works out the
      winning declaration for an element, so a second rule with the same selector further down the file, or a more
      specific one elsewhere, fails here as it would show in the browser), and
   2. the shape of a row: a label and one unit, so nothing can break apart in the middle of a control.

   The three defects this replaces, each with its case below:
   - the rows of the Settings body were squeezed to their 28px minimum as soon as a tab was taller than the card, so a
     two-line label, a dropdown under its label or any text above 18px lay over the next row;
   - `.zn-quick` was defined twice and the later rule (for the quick colours) made every list of setting rows run on
     like words: two short rows shared a line, a long one broke between its controls;
   - minus, value and plus were three loose items of a wrapping row. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { parseCss, cascade, matching } = require("./helpers/css-cascade.cjs");

const source = fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.uc.js"), "utf8");
const sheetCss = parseCss(fs.readFileSync(path.resolve(__dirname, "../additional/notes/ZentralNotes.css"), "utf8"));

const dom = require("./helpers/fake-dom.cjs")();
const { El, Ev, document, raf } = dom;
const observers = [];
const win = {
  document, ZentralRuntime: { register() {} }, __zentralNotesTestSeam: {},
  requestAnimationFrame: (fn) => raf.push(fn), cancelAnimationFrame() {},
  setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {},
  ResizeObserver: class { constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); } observe(el) { this.targets.push(el); } disconnect() { const i = observers.indexOf(this); if (i >= 0) observers.splice(i, 1); } },
};
win.window = win;
vm.runInNewContext(source, {
  window: win, document, Event: Ev, globalThis: { Services: {} }, ChromeUtils: {}, console, URL, Date, JSON, Math,
  Promise, RegExp, Number, Map, Set, setTimeout, clearTimeout, queueMicrotask, navigator: { platform: "Linux" },
});
const c = win.__zentralNotesTestSeam.core;
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    raf.splice(0).forEach((fn) => fn());
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// The size the fake layout reports for a dialog card. `natural` is what the content needs (padding included, border
// not: that is what scrollWidth / scrollHeight report); the sheet of the fake DOM is 400 x 600, so the overlay leaves
// the card 376 x 576. A card that needs more is held at that size by its max-height and scrolls: unless its overflow
// is hidden it then shows a scrollbar of 17px, which takes that much width, and the content beside it is 40px taller.
const BORDER = 1, SCROLLBAR = 17, TALLER_WHEN_NARROW = 40;
let natural = { width: 300, height: 300 };
const isCard = (el) => el.classList?.contains("zn-dialog-card");
const outer = (el, side, room) => (isCard(el) ? Math.min(natural[side] + 2 * BORDER, room) : 0);
const scrollbar = (el) => isCard(el) && el.style.overflow !== "hidden" && natural.height + 2 * BORDER > 576 && !el.style.height;
Object.defineProperties(El.prototype, {
  offsetWidth: { configurable: true, get() { return outer(this, "width", 376); } },
  clientWidth: { configurable: true, get() { return isCard(this) ? this.offsetWidth - 2 * BORDER - (scrollbar(this) ? SCROLLBAR : 0) : 0; } },
  scrollWidth: { configurable: true, get() { return isCard(this) ? Math.max(natural.width, this.clientWidth) : 0; } },
  offsetHeight: { configurable: true, get() { return outer(this, "height", 576); } },
  clientHeight: { configurable: true, get() { return isCard(this) ? this.offsetHeight - 2 * BORDER : 0; } },
  scrollHeight: { configurable: true, get() { return isCard(this) ? Math.max(natural.height + (scrollbar(this) ? TALLER_WHEN_NARROW : 0), this.clientHeight) : 0; } },
});

const files = new Map();
const io = {
  join: (...parts) => parts.join("/"), filename: (p) => p.split("/").pop(),
  async readUTF8(p) { if (!files.has(p)) throw new Error("NotFound " + p); return files.get(p).text; },
  async writeUTF8(p, text) { files.set(p, { text, mtime: Date.now() }); },
  async remove(p) { files.delete(p); }, async exists(p) { return files.has(p); },
  async children(dir) { return [...files.keys()].filter((p) => p.startsWith(dir + "/")); },
  async stat(p) { return { lastModified: files.get(p)?.mtime || 0 }; }, async restrict() {},
};
function adapter() {
  const host = new El("div");
  return { position: "fixed", host, attach: (root) => host.appendChild(root),
    getArea: () => ({ left: 0, top: 0, width: 400, height: 600, anchor: "top" }),
    watch: () => () => {}, setActive() {}, rewatch() {} };
}

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok -", name); }

(async () => {
  const prefs = new Map();
  const store = c.createStore({ io, notify() {}, windowId: "layout", getDir: async () => "/notes-layout",
    getMaxSaveMs: () => 1000, setTimer: setTimeout, clearTimer: clearTimeout });
  const sheet = c.createSheet({ store, adapter: adapter(),
    env: { getPref: (key, fallback) => (prefs.has(key) ? prefs.get(key) : fallback), setPref: (key, value) => prefs.set(key, value), openLink() {}, copyText() {}, exportNote() {}, exportAll() {}, revealFolder() {} },
    ensureStore: () => store.open() });
  await sheet.open();
  sheet.root.ownerDocument = document; // menus are placed against the document of the sheet
  await flush();

  // ---- finding things ---------------------------------------------------------------------------------------
  const all = () => sheet.root.all();
  const has = (el, cls) => el._classes.has(cls);
  const one = (cls) => all().find((el) => has(el, cls)) || null;
  const many = (cls) => all().filter((el) => has(el, cls));
  const elements = (el) => el.children.filter((k) => k.tag !== "#text");
  const titled = (title) => all().find((el) => el.tag === "button" && (el.title === title || el.title.startsWith(title + " (")));
  const chipNamed = (text) => all().find((el) => has(el, "zn-chip") && el.textContent === text);
  const dialog = () => one("zn-dialog");
  const card = () => one("zn-dialog-card");
  const press = async (el, what) => { assert.ok(el, what + " exists"); el.click(); await flush(); };
  const closeDialogs = async () => {
    for (let i = 0; i < 4 && dialog(); i++) {
      const b = ["Back", "Done", "Cancel"].map(chipNamed).find(Boolean);
      assert.ok(b, "an open dialog has a way out");
      b.click();
      await flush();
    }
    assert.equal(dialog(), null, "no dialog is left open");
  };
  const openQuick = async () => { await closeDialogs(); await press(all().find((el) => el.title.startsWith("Quick settings")), "the Quick settings button"); };
  const openSettings = async () => { await openQuick(); await press(chipNamed("All settings\u2026"), "All settings"); assert.ok(one("zn-set-body"), "the Settings card is open"); };
  const rowOf = (cls, label) => many(cls).find((el) => elements(el)[0]?.textContent === label);

  // What the style sheet makes of an element: { prop: value } must be the winning declarations.
  const style = (el) => cascade(sheetCss, el);
  function expectStyle(el, want, what) {
    const got = style(el);
    for (const [prop, value] of Object.entries(want)) {
      const ok = Array.isArray(value) ? value.includes(got.get(prop)) : got.get(prop) === value;
      assert.ok(ok, `${what}: wanted ${prop}: ${Array.isArray(value) ? value.join(" or ") : value}, the style sheet gives ${got.line(prop)}`);
    }
  }
  // The one thing after the label in a row.
  const UNIT = ["zn-ctl", "zn-set-chips", "zn-select", "zn-field", "zn-chip"];
  const unitKind = (el) => UNIT.find((cls) => has(el, cls)) || "";
  function expectRowShape(row, what) {
    const kids = elements(row);
    assert.equal(kids.length, 2, `${what}: a label and one unit, found ${kids.length} items (${kids.map((k) => k.className).join(" | ")})`);
    assert.ok(has(kids[0], "zn-quick-label"), `${what}: the label comes first`);
    assert.ok(unitKind(kids[1]), `${what}: the control is one unit, found "${kids[1].className}"`);
    return kids[1];
  }

  await test("the cascade helper: specificity, order, !important, child and descendant, :not, attributes, @media", () => {
    const css = parseCss(`
      /* .a .b { color: wrong } */
      .s .b { color: first; margin: 1px; }
      .s .b { color: second; }
      .s > .b { top: child; }
      .s .mid > .b { left: 3px !important; }
      .s .mid .b { left: 9px; flex: 1 1 40%; }
      .s .b:not(.on) { bottom: off; }
      .s .b[data-kind="x"] { right: attr; }
      .s .b:hover { color: hover; }
      .s .b::before { color: before; }
      :root[theme="dark"] .s .b { color: dark; }
      @media (max-width: 100px) { .s .b { color: narrow; } }
      .s .mid .b { flex-basis: 9em; }
    `);
    const s = new El("div"); s.className = "s";
    const mid = new El("div"); mid.className = "mid"; s.append(mid);
    const b = new El("span"); b.className = "b"; b.dataset.kind = "x"; mid.append(b);
    const got = cascade(css, b);
    assert.equal(got.get("color"), "second", "the later of two equal selectors wins; hover, ::before, a root attribute that is not set and @media do not apply");
    assert.equal(got.get("margin"), "1px", "an earlier rule still gives what the later one does not set");
    assert.equal(got.get("top"), "", "`>` needs a direct child");
    assert.equal(got.get("left"), "3px", "!important beats a later rule");
    assert.equal(got.get("bottom"), "off");
    assert.equal(got.get("right"), "attr", "data attributes are read from dataset");
    assert.deepEqual([got.get("flex-grow"), got.get("flex-shrink"), got.get("flex-basis")], ["1", "1", "9em"], "a later flex-basis replaces the basis of an earlier flex shorthand");
    assert.equal(cascade(css, b, { rootAttrs: { theme: "dark" } }).get("color"), "dark", "three classes and :root beat two classes");
    assert.equal(cascade(css, b, { media: () => true }).get("color"), "narrow");
    b.classList.add("on");
    assert.equal(cascade(css, b).get("bottom"), "");
    assert.deepEqual(matching(css, b).map((r) => r.selector), [".s .b", ".s .b", ".s .mid > .b", ".s .mid .b", '.s .b[data-kind="x"]', ".s .mid .b"], "the rules that match, weakest first, equal ones in file order");
  });

  await test("a list of setting rows is one row a line in every dialog; only loose items run on like words", async () => {
    let rows = 0, loose = 0;
    // Looked at while the dialog is open: a rule needs the element inside the sheet to match.
    const look = (name) => {
      const lists = many("zn-quick");
      assert.ok(lists.length, name + ": the dialog has a list");
      for (const el of lists) {
        const kids = elements(el);
        if (kids.some((k) => has(k, "zn-quick-row"))) {
          rows++;
          assert.ok(kids.every((k) => has(k, "zn-quick-row")), name + ": a list of rows holds rows only");
          expectStyle(el, { display: "grid", "grid-template-columns": "minmax(0, 1fr)", "flex-wrap": "" }, name + " (list of rows)");
          for (const row of kids) expectStyle(row, { display: "flex", "flex-wrap": "wrap" }, name + ", row " + elements(row)[0].textContent);
        } else {
          loose++;
          assert.ok(has(el, "zn-flow"), name + ": a list of loose items says so with zn-flow");
          expectStyle(el, { display: "flex", "flex-wrap": "wrap" }, name + " (loose items)");
        }
      }
    };
    await openQuick(); look("Quick settings");
    await openSettings(); await press(chipNamed("Toolbar buttons\u2026"), "Toolbar buttons"); look("Toolbar buttons");
    await openSettings(); await press(chipNamed("Keyboard shortcuts\u2026"), "Keyboard shortcuts"); look("Keyboard shortcuts");
    await closeDialogs(); await press(titled("Table\u2026"), "the Table button"); look("Insert table");
    await closeDialogs(); await press(titled("Code block"), "the Code block button"); look("Code block languages");
    await closeDialogs(); await press(titled("Highlight color"), "the highlight colour menu");
    await press(one("zn-swatch-add"), "Custom color"); assert.ok(one("zn-color-picker"), "the colour picker is open"); look("Quick colours");
    assert.equal(rows, 4, "Quick settings, Toolbar buttons, Keyboard shortcuts and the table columns are lists of rows");
    assert.equal(loose, 2, "the code languages and the quick colours are loose items");
    await closeDialogs();
  });

  await test("Quick settings: each row is a label and one unit; minus, value and plus stay together", async () => {
    await openQuick();
    const rows = many("zn-quick-row");
    assert.ok(rows.length >= 8, "the Quick settings rows are there");
    const kinds = new Set();
    for (const row of rows) {
      const label = elements(row)[0].textContent;
      const unit = expectRowShape(row, "Quick settings, " + label);
      kinds.add(unitKind(unit));
      // A dropdown always goes below its label (the label takes the whole line).
      expectStyle(elements(row)[0], { "flex-grow": "1", "flex-basis": unitKind(unit) === "zn-select" ? "100%" : "12em", "min-width": "0", "overflow-wrap": "anywhere" }, label + " (label)");
    }
    assert.deepEqual([...kinds].sort(), ["zn-chip", "zn-ctl", "zn-select", "zn-set-chips"], "on/off, stepper, dropdown and a short choice are all covered");

    const size = rowOf("zn-quick-row", "Text size");
    const group = elements(size)[1];
    const [minus, value, plus] = elements(group);
    assert.deepEqual([minus.title, has(value, "zn-quick-value"), plus.title], ["Smaller", true, "Larger"], "the stepper is minus, value, plus");
    expectStyle(group, { display: "flex", "flex-wrap": ["", "nowrap"], "flex-grow": "0", "flex-shrink": "1", "min-width": "0", "max-width": "100%" }, "stepper group");
    expectStyle(value, { width: "4.4em", "min-width": "min-content", "white-space": "nowrap", "flex-shrink": "1" }, "stepper value");
    expectStyle(minus, { "flex-shrink": "0" }, "stepper button");

    const choice = elements(rowOf("zn-quick-row", "Blank lines in read view"))[1];
    assert.deepEqual(elements(choice).map((b) => b.textContent), ["Collapse", "Keep"], "the choices of one setting are one unit");
    expectStyle(choice, { display: "flex", "flex-wrap": "wrap", "max-width": "100%", "min-width": "0" }, "choice group");

    // The controls still do their work through the group.
    prefs.set(c.PREF.FONT_SIZE, 13);
    await press(elements(elements(rowOf("zn-quick-row", "Text size"))[1])[2], "Larger");
    assert.equal(prefs.get(c.PREF.FONT_SIZE), 14);
    await press(elements(elements(rowOf("zn-quick-row", "Text size"))[1])[0], "Smaller");
    assert.equal(prefs.get(c.PREF.FONT_SIZE), 13);
    await press(elements(elements(rowOf("zn-quick-row", "Blank lines in read view"))[1])[1], "Keep");
    assert.equal(elements(elements(rowOf("zn-quick-row", "Blank lines in read view"))[1])[1].classList.contains("is-on"), true, "the choice is taken and drawn again");
    await closeDialogs();
  });

  await test("Settings: a row is as tall as what is in it, in every tab", async () => {
    await openSettings();
    const body = one("zn-set-body");
    // max-content rows: with `auto` rows and a min-height on the items, a body that scrolls gave every row its
    // min-height only (the minimum contribution of an item with a min-height is that min-height).
    expectStyle(body, { display: "grid", "grid-auto-rows": "max-content", "grid-template-columns": "minmax(0, 1fr)", "overflow-y": "auto", "min-height": "0" }, "Settings body");
    expectStyle(card(), { display: "flex", "flex-direction": "column" }, "Settings card");
    expectStyle(one("zn-set-tabs"), { display: "flex", "flex-wrap": "wrap" }, "Settings tabs");
    const tabs = elements(one("zn-set-tabs")).map((t) => t.textContent);
    assert.ok(tabs.length >= 6, "all tabs are there: " + tabs.join(", "));
    // Each kind of control, looked at the first time it turns up (a tab is drawn again when it is chosen, so an
    // element of another tab is no longer inside the sheet and no rule would match it).
    const checks = {
      "zn-chip": () => {},
      "zn-ctl slider": (unit) => {
        const [range, value, reset] = elements(unit);
        assert.deepEqual([has(range, "zn-range"), has(value, "zn-quick-value"), has(reset, "zn-chip")], [true, true, true], "a slider is slider, value, reset");
        expectStyle(unit, { display: "flex", "flex-grow": "1", "flex-shrink": "1", "flex-basis": "auto", "flex-wrap": "wrap", "min-width": "0", "max-width": "100%" }, "slider group");
        expectStyle(range, { "flex-grow": "1", "flex-basis": "60px", width: "60px", "min-width": "60px" }, "slider");
        // As wide as its text: a value such as "100000chars" was cut into a 3.6em box when the stepper's width won here.
        expectStyle(value, { width: "auto", "min-width": "3.6em", "white-space": "normal", "overflow-wrap": "anywhere" }, "slider value");
      },
      "zn-ctl stepper": (unit) => {
        const [minus, value, plus] = elements(unit);
        assert.deepEqual([minus.title, has(value, "zn-quick-value"), plus.title], ["Smaller", true, "Larger"], "a stepper is minus, value, plus");
        expectStyle(unit, { display: "flex", "flex-wrap": ["", "nowrap"], "flex-grow": "0", "flex-shrink": "1", "min-width": "0", "max-width": "100%" }, "stepper group");
        expectStyle(value, { width: "3.6em", "min-width": "min-content", "white-space": "nowrap" }, "stepper value in Settings");
      },
      "zn-ctl colour": (unit) => {
        assert.deepEqual(elements(unit).map((k) => unitKind(k) || "zn-swatch"), ["zn-swatch", "zn-chip"], "a colour is swatch, reset");
        expectStyle(one("zn-cpanel"), { display: "none" }, "colour panel, closed");
        elements(unit)[0].click(); // the swatch opens the panel of its colour
        const sub = one("zn-set-sub");
        assert.ok(sub, "the colour panel has its three sliders");
        expectStyle(sub, { display: "flex", "flex-wrap": "wrap" }, "colour panel line");
        expectStyle(elements(sub)[0], { "flex-grow": "0", "flex-shrink": "1", "flex-basis": "6em", "min-width": "0", "overflow-wrap": "anywhere" }, "colour panel label");
        expectStyle(one("zn-cpanel"), { display: "grid", "grid-template-columns": "minmax(0, 1fr)" }, "colour panel");
        expectStyle(one("zn-hex"), { "max-width": "min(9em, 100%)", "min-width": "0", "box-sizing": "border-box" }, "colour panel hex field");
        expectStyle(elements(sub)[1], { "flex-grow": "1", "flex-basis": "90px", "min-width": "60px" }, "colour panel slider");
      },
      "zn-field": (unit) => expectStyle(unit, { "flex-grow": "0", "flex-shrink": "1", "min-width": "0", "max-width": "100%", "box-sizing": "border-box" }, "text field"),
      "zn-set-chips": (unit) => expectStyle(unit, { display: "flex", "flex-wrap": "wrap", "min-width": "0", "max-width": "100%" }, "choice group"),
      "zn-select": (unit) => expectStyle(unit, { "flex-basis": "100%", "min-width": "0", "max-width": "100%", "box-sizing": "border-box" }, "dropdown"),
    };
    const seen = new Set();
    let rows = 0;
    for (const name of tabs) {
      await press(elements(one("zn-set-tabs")).find((t) => t.textContent === name), "tab " + name);
      for (const row of many("zn-set-row")) {
        rows++;
        const label = elements(row)[0].textContent;
        const what = `Settings, ${name}, ${label}`;
        const unit = expectRowShape(row, what);
        expectStyle(row, { display: "flex", "flex-wrap": "wrap", "align-items": "center", "min-height": "28px" }, what);
        expectStyle(elements(row)[0], { "flex-grow": "1", "flex-shrink": "1", "flex-basis": unitKind(unit) === "zn-select" ? "100%" : "9em", "min-width": "min(100%, 9em)", "overflow-wrap": "anywhere" }, what + " (label)");
        const kind = unitKind(unit) + (has(unit, "zn-ctl-fill") ? " slider" : has(unit, "zn-ctl") ? (elements(unit).some((k) => has(k, "zn-swatch")) ? " colour" : " stepper") : "");
        assert.ok(checks[kind], what + ": a known kind of control, found " + kind);
        if (!seen.has(kind)) { seen.add(kind); checks[kind](unit); }
      }
      for (const heading of many("zn-set-heading")) expectStyle(heading, { "overflow-wrap": "anywhere" }, `Settings, ${name}, heading ${heading.textContent}`);
    }
    assert.ok(rows > 80, "every setting was looked at: " + rows);
    assert.deepEqual([...seen].sort(), Object.keys(checks).sort(), "every kind of control is covered");

    for (const actions of many("zn-dialog-actions")) expectStyle(actions, { display: "flex", "flex-wrap": "wrap" }, "dialog buttons");
    expectStyle(elements(card())[0], { "overflow-wrap": "anywhere" }, "dialog title");
    await closeDialogs();
  });

  await test("the other lists: a shortcut and its Reset, the three alignments of a column are one unit each", async () => {
    await openSettings();
    await press(chipNamed("Keyboard shortcuts\u2026"), "Keyboard shortcuts");
    for (const row of many("zn-quick-row")) {
      const unit = expectRowShape(row, "Keyboard shortcuts, " + elements(row)[0].textContent);
      assert.deepEqual(elements(unit).map((k) => (has(k, "zn-keybtn") ? "keys" : k.textContent)), ["keys", "Reset"]);
    }
    expectStyle(one("zn-key-note"), { "overflow-wrap": "anywhere" }, "the note above the shortcuts");
    await openSettings();
    await press(chipNamed("Toolbar buttons\u2026"), "Toolbar buttons");
    for (const row of many("zn-quick-row")) expectRowShape(row, "Toolbar buttons, " + elements(row)[0].textContent);
    await closeDialogs();
    await press(titled("Table\u2026"), "the Table button");
    const columns = many("zn-quick-row");
    assert.equal(columns.length, 3, "three columns to start with");
    for (const row of columns) assert.deepEqual(elements(expectRowShape(row, "Insert table, " + elements(row)[0].textContent)).map((b) => b.textContent), ["Left", "Centre", "Right"]);
    await closeDialogs();
  });

  await test("a card that grows past the sheet has the size that was worked out: border counted, the share-of-the-overlay minimum off", async () => {
    // Needs 700px of height in a sheet that leaves 576: it grows past the sheet (the window is 800 high).
    natural = { width: 298, height: 700 };
    await openQuick();
    const quick = card();
    assert.equal(dialog().dataset.spill, "true", "the card grows past the sheet");
    assert.equal(quick.style.position, "absolute");
    // 700 is the content with its padding (scrollHeight); the card is that plus its two 1px borders. At 700 it scrolled by 2px.
    // Measured without the scrollbar the card shows while it is still held at the sheet's height: with it the fake
    // reports a narrower and taller content (742 high, 317 wide), a size that no longer fits once the scrollbar is gone.
    assert.equal(quick.style.height, "702px");
    assert.equal(quick.style.width, "300px");
    assert.equal(quick.style.overflow || "", "", "the card scrolls again after the measuring");
    // min-width: min(26em, 100%) is a share of the overlay. For a positioned card that is the overlay with its
    // padding, 24px more than the width measured above, so the card came out wider than `width` and off centre.
    assert.equal(quick.style.minWidth, "0");
    assert.equal(quick.style.maxWidth, "none");

    // The same card fits again (smaller text): every inline size goes, the style sheet rules again.
    natural = { width: 298, height: 300 };
    const resized = async () => {
      const watching = observers.filter((o) => o.targets.includes(card()));
      assert.equal(watching.length, 1, "the open card is watched for size changes");
      watching[0].cb();
      await flush();
    };
    await resized();
    assert.notEqual(dialog().dataset.spill, "true");
    for (const prop of ["position", "left", "top", "width", "height", "minWidth", "maxWidth", "maxHeight"]) assert.equal(quick.style[prop] || "", "", prop + " is cleared");

    // A card that fits is not touched at all, and its border is not counted twice.
    await closeDialogs();
    natural = { width: 298, height: 574 };
    await openQuick();
    assert.notEqual(dialog().dataset.spill, "true", "574 + 2 is exactly the room: it fits");
    natural = { width: 298, height: 575 };
    await resized();
    assert.equal(dialog().dataset.spill, "true", "one pixel more does not");
    assert.equal(card().style.height, "577px");
    await closeDialogs();
    natural = { width: 300, height: 300 };
  });

  sheet.destroy();
  await store.close();
  console.log(`\n${passed} settings layout tests passed`);
})().catch((error) => { console.error("FAIL", error); process.exit(1); });
