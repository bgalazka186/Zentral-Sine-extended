"use strict";
/* OW-67..OW-72 — the owner's six widget reports of 2026-11-17:
 *   67 a card blanked while the sidebar was folded is painted again when it is shown (with pausing on AND off);
 *   68 the clock's quick note is one line and the Save button wins the space;
 *   69 the quick note is optional again, through one honest switch;
 *   70 memory is read from every shape the platform may return, and a desktop's missing battery is quiet;
 *   71 the person's order wins, drag and Alt+Arrow write the same thing, and a new widget is not lost;
 *   72 colours are validated, a pair that cannot be read is refused, and "follow the theme" writes nothing.
 * Does NOT prove real layout: the fake DOM's sizes are set by the test. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createFakeSidebarHarness, widgetSrc: SRC, widgetCss: CSS } = require("./helpers/fake-widgets-harness.cjs");

const root = path.resolve(__dirname, "..");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/settings.json"), "utf8"));
const PREFS = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/preferences.json"), "utf8"));
const LAYOUT = fs.readFileSync(path.join(root, "extension/settings/layout.json"), "utf8");
const STANDALONE = fs.readFileSync(path.join(root, "additional/widgets/standalone.json"), "utf8");

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok -", name); };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const BASE = {
  "zen.workspace.zentral.widgets.enabled": true,
  "zen.workspace.zentral.widgets.clock.enabled": true,
  "zen.workspace.zentral.widgets.date.enabled": false,
};

(async () => {
  // ---- OW-67 ---------------------------------------------------------------------------------------------
  for (const pause of [true, false]) {
    await test(`OW-67: a card blanked while folded is painted again on reveal (pause when hidden: ${pause})`, async () => {
      const h = createFakeSidebarHarness({ ...BASE, "zen.workspace.zentral.widgets.pause_when_hidden": pause });
      const { api } = h.start();
      await tick(40);
      const clock = () => api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "clock");
      const timeEl = clock().querySelector(".zw-clock-time");
      assert.ok(timeEl.textContent, "the clock drew itself first");
      // The card is emptied while the sidebar is folded away — a repaint while hidden, a folded pane, a lost frame.
      timeEl.textContent = "";
      h.docRoot.setAttribute("zen-compact-mode", "true");
      api.remeasure();
      await tick(20);
      assert.equal(api.getArea().visible, false, "the tray is out of sight");
      h.docRoot.setAttribute("zen-compact-sidebar-visible", "true");
      api.remeasure();
      await tick(30);
      assert.equal(api.getArea().visible, true, "and back");
      assert.ok(timeEl.textContent, "the clock is whole again, not left blank (owner: 'it stays not rendered')");
      api.destroy();
    });
  }

  await test("OW-67: the repaint is the cache, not a refetch, when the value is still fresh", async () => {
    const h = createFakeSidebarHarness({ ...BASE });
    const { api } = h.start();
    await tick(40);
    let fetches = 0;
    api.registerWidget({
      id: "probe", title: "Probe", refreshMs: 60000,
      create({ document }) {
        const el = document.createElement("div");
        return {
          element: el,
          fetch() { fetches++; return { n: fetches }; },
          render(v) { el.textContent = v ? "n" + v.n : ""; },
        };
      },
    });
    await tick(20);
    h.flushRaf();
    const before = fetches;
    h.docRoot.setAttribute("zen-compact-mode", "true"); api.remeasure(); await tick(20);
    h.docRoot.setAttribute("zen-compact-sidebar-visible", "true"); api.remeasure(); await tick(30);
    assert.equal(fetches, before, "a fresh cache is painted, never refetched");
    api.destroy();
  });

  // ---- OW-68 ---------------------------------------------------------------------------------------------
  await test("OW-68: the quick note is ONE line, and the Save button is the thing that keeps its size", () => {
    const row = CSS.slice(CSS.indexOf(".zw-clock-note-row {"), CSS.indexOf(".zw-clock-note-row[hidden]"));
    assert.match(row, /flex-wrap: nowrap !important/, "the row never wraps");
    assert.match(CSS, /\.zw-clock-note-row \.zw-clock-note-btn \{[^}]*flex: 0 0 auto !important/, "the button cannot shrink");
    assert.match(CSS, /\.zw-clock-note-row \.zw-clock-note-btn \{[^}]*white-space: nowrap !important/, "nor break its label");
    assert.match(CSS, /\.zw-clock-note-row \.zw-clock-note \{[^}]*flex: 1 1 0 !important/, "the field is what gives ground");
    // The old rule that stacked this row (and so pushed Save onto its own line) must be gone.
    const small = CSS.slice(CSS.indexOf("@media (max-width: 240px)"));
    const block = small.slice(0, small.indexOf("}}") + 2);
    assert.ok(!/zw-clock-note-row/.test(block), "no narrow-width rule stacks the note row");
  });

  // ---- OW-69 ---------------------------------------------------------------------------------------------
  await test("OW-69: the quick note has one switch, declared everywhere and live", async () => {
    const pref = "zen.workspace.zentral.widgets.clock.quick_note";
    const row = SETTINGS.schema.find((s) => s.property === pref);
    assert.ok(row, "the switch is in the schema");
    assert.equal(row.type, "checkbox");
    assert.equal(row.defaultValue, true, "on by default, as the owner wants it");
    assert.equal(SETTINGS.settings[pref].section, "Clock & Date", "it sits with the clock");
    assert.ok(PREFS.some((p) => p.property === pref), "it reaches preferences.json");
    assert.ok(LAYOUT.includes(pref), "it is in the layout order");
    assert.ok(STANDALONE.includes(pref), "and in the standalone list");
    assert.match(SRC, /WIDGET_PREFS\.CLOCK_QUICK_NOTE/, "the code reads it");
    assert.match(SRC, /WIDGET_PREFS\.CLOCK_QUICK_NOTE,\n\s+\],/, "and the clock watches it, so it is live");

    // Live: turn it off and the row leaves the layout (and takes its space with it).
    const h = createFakeSidebarHarness({ ...BASE }, { notes: true });
    const { api } = h.start();
    await tick(40);
    const body = api.getTray().children.find((el) => el.getAttribute("data-zw-widget") === "clock").querySelector(".zw-clock");
    const noteRow = body.querySelector(".zw-clock-note-row");
    assert.equal(noteRow.hidden, false, "shown while the switch is on and Notes can take a note");
    const setBool = (v) => { h.prefs.set(pref, v); h.Services.prefs.setBoolPref(pref, v); };
    setBool(false);
    await tick(60);
    h.flushRaf();
    assert.equal(noteRow.hidden, true, "off means gone from the face");
    assert.equal(noteRow.style.display, "none", "and taking no space");
    setBool(true);
    await tick(60);
    h.flushRaf();
    assert.equal(noteRow.hidden, false, "and back without a restart");
    api.destroy();
  });

  // ---- OW-70, as it stands after OW-90 ---------------------------------------------------------------
  // The Status card and its readings are gone: Boost owns the one memory number the browser can really report, and
  // `additional/boost/` owns the reading itself. What survives from OW-70 here is the card's own placement rule — a
  // widget that is switched off keeps its place for when it comes back — asserted in the OW-71 block below.
  await test("OW-71: the stored order keeps what exists, drops what does not, and never loses a widget", () => {
    const c = createFakeSidebarHarness().core;
    const defs = [{ id: "clock" }, { id: "date" }, { id: "weather" }, { id: "boost" }];
    assert.deepEqual(Array.from(c.orderedByIds(defs, ["boost", "clock"]), (d) => d.id), ["boost", "clock", "date", "weather"],
      "the chosen two first, the rest in their default order — a new widget appears, it is not hidden");
    assert.deepEqual(Array.from(c.orderedByIds(defs, ["nope", "weather"]), (d) => d.id), ["weather", "clock", "date", "boost"],
      "an id nobody recognises is ignored");
    assert.deepEqual(Array.from(c.orderedByIds(defs, []), (d) => d.id), ["clock", "date", "weather", "boost"],
      "no stored order means the default one");
    assert.deepEqual(Array.from(c.cleanWidgetOrder("clock, ,date;boost clock")), ["clock", "date", "boost"],
      "junk, repeats and separators are all handled");
    assert.deepEqual(Array.from(c.cleanWidgetOrder(null)), []);
  });

  await test("OW-71: moving one place, at the edges, and the same result from the keyboard", () => {
    const c = createFakeSidebarHarness().core;
    const ids = ["clock", "date", "weather"];
    assert.deepEqual(Array.from(c.moveInOrder(ids, "date", -1, ids)), ["date", "clock", "weather"], "up one");
    assert.deepEqual(Array.from(c.moveInOrder(ids, "date", 1, ids)), ["clock", "weather", "date"], "down one");
    assert.deepEqual(Array.from(c.moveInOrder(ids, "clock", -1, ids)), ["clock", "date", "weather"], "the first cannot go up");
    assert.deepEqual(Array.from(c.moveInOrder(ids, "weather", 1, ids)), ["clock", "date", "weather"], "the last cannot go down");
    assert.deepEqual(Array.from(c.moveInOrder(ids, "gone", 1, ids)), ["clock", "date", "weather"], "an unknown id moves nothing");
  });

  await test("OW-71: the cards carry a handle, and Alt+Arrow writes the pref", async () => {
    const h = createFakeSidebarHarness({
      ...BASE,
      "zen.workspace.zentral.widgets.date.enabled": true,
      "zen.workspace.zentral.widgets.weather.enabled": false,
      "zen.workspace.zentral.widgets.boost.enabled": false,
    });
    const { api } = h.start();
    await tick(50);
    const cards = () => [...api.getTray().children];
    const ids = () => cards().map((el) => el.getAttribute("data-zw-widget"));
    assert.deepEqual(ids(), ["clock", "date"], "the default order first");
    const grips = cards().map((c) => c.querySelector(".zw-grip"));
    assert.equal(grips.filter(Boolean).length, 2, "every card has a handle");
    // OW-100: the handle no longer advertises a drag. HTML5 drag on a button inside the sidebar did nothing, so the
    // handle is a plain button whose click opens a real Move menu; Alt+Arrow still works from it.
    assert.equal(grips[0].getAttribute("draggable"), null, "the handle no longer claims to be draggable");
    assert.equal(grips[0].tagName.toLowerCase(), "button", "and it is a real control, not a div");
    // Alt+Down on the clock's handle moves the clock below the date. (No `if`: a skipped assertion is not a test.)
    // The fake element records its listeners rather than dispatching: call them exactly as the engine would.
    const fire = (el, type, extra) => el._listeners.filter(([t]) => t === type).forEach(([, fn]) => fn(extra));
    fire(grips[0], "keydown", { key: "ArrowDown", altKey: true, preventDefault() {}, stopPropagation() {} });
    await tick(40); h.flushRaf();
    // The stored list is every REGISTERED widget (a widget switched off keeps its place for when it comes back), which
    // is what makes "turn it on again later" land where the person left it.
    assert.match(h.prefs.get("zen.workspace.zentral.widgets.order"), /^date,clock/, "one key press stores the order");
    assert.deepEqual(ids(), ["date", "clock"], "and the tray follows it");
    // The API door does the same thing, which is what a menu would call.
    api.moveWidget("clock", -1);
    await tick(40);
    assert.deepEqual(ids(), ["clock", "date"], "moving back up");
    api.destroy();
  });

  // ---- OW-72 ---------------------------------------------------------------------------------------------
  await test("OW-72: colours are validated, and a pair that cannot be read is refused", () => {
    const c = createFakeSidebarHarness().core;
    assert.equal(c.cleanWidgetColor("#FFF"), "#ffffff", "short hex is expanded");
    assert.equal(c.cleanWidgetColor("  #AABBCC "), "#aabbcc", "trimmed and lowercased");
    assert.equal(c.cleanWidgetColor("rgb(1,2,3)"), "", "only hex is stored: nothing half-typed reaches the sheet");
    assert.equal(c.cleanWidgetColor(""), "", "empty means follow the theme");
    assert.equal(c.cleanWidgetColor("nonsense"), "");
    // WCAG: black on white is 21:1, white on white is 1:1.
    assert.equal(Math.round(c.contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })), 21);
    const ok = c.widgetAppearanceVars("#101010", "#f0f0f0");
    assert.equal(ok.readable, true);
    assert.equal(ok.vars["--zw-card-bg"], "#101010");
    assert.equal(ok.vars["--zw-card-text"], "#f0f0f0");
    const bad = c.widgetAppearanceVars("#f0f0f0", "#ffffff");
    assert.equal(bad.refused, true, "white on nearly-white is refused, not written");
    assert.deepEqual(Object.keys(bad.vars), [], "and nothing is applied");
    assert.deepEqual(Object.keys(c.widgetAppearanceVars("", "").vars), [], "follow the theme writes nothing");
  });

  await test("OW-72: the look is written on the tray, once, so every card inherits it", async () => {
    const h = createFakeSidebarHarness({ ...BASE });
    const { api } = h.start();
    await tick(40);
    const tray = api.getTray();
    assert.equal(tray.getAttribute("data-zw-look"), "theme", "the default is the theme");
    h.Services.prefs.setStringPref("zen.workspace.zentral.widgets.appearance.background", "#101010");
    h.Services.prefs.setStringPref("zen.workspace.zentral.widgets.appearance.text", "#f0f0f0");
    await tick(40);
    h.flushRaf();
    assert.equal(tray.getAttribute("data-zw-look"), "custom");
    // The variable lives on the tray; a card must not carry its own copy (that would be a second truth).
    const card = tray.children[0];
    assert.ok(card, "there is a card to inherit it");
    assert.ok(!card.style.getPropertyValue("--zw-card-bg"), "the card does not duplicate the choice");
    // Back to the theme removes both.
    h.Services.prefs.setStringPref("zen.workspace.zentral.widgets.appearance.background", "");
    h.Services.prefs.setStringPref("zen.workspace.zentral.widgets.appearance.text", "");
    await tick(40);
    h.flushRaf();
    assert.equal(tray.getAttribute("data-zw-look"), "theme", "a reset really resets");
    api.destroy();
  });

  await test("OW-105: the effective card and hover rules honour forced colours", () => {
    const baseStart = CSS.indexOf("/* New-tab-page-style translucent widget card */");
    const hoverStart = CSS.indexOf("#zentral-sidebar-widgets .zw-card:hover", baseStart);
    const clickableHoverStart = CSS.indexOf('#zentral-sidebar-widgets .zw-card[data-zw-clickable="true"]:hover', hoverStart);
    assert.ok(baseStart >= 0 && hoverStart > baseStart && clickableHoverStart > hoverStart, "the real card rules are present in cascade order");
    const base = CSS.slice(baseStart, hoverStart);
    const hover = CSS.slice(hoverStart, clickableHoverStart);
    const clickableHover = CSS.slice(clickableHoverStart, CSS.indexOf("#zentral-sidebar-widgets .zw-card[data-zw-clickable=\"true\"]:active", clickableHoverStart));
    assert.match(base, /background:\s*var\(--zw-card-bg,/, "the final base-card background consumes the tray override");
    assert.match(base, /color:\s*var\(--zw-card-text,/, "the final base-card text consumes the tray override");
    assert.match(hover, /background:\s*var\(--zw-card-bg,/, "ordinary hover does not replace a forced background");
    assert.match(clickableHover, /background:\s*var\(--zw-card-bg,/, "clickable-card hover does not replace a forced background");
  });

  console.log(passed + " widget report tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
