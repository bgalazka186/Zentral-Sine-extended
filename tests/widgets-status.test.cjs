"use strict";
/* OW-90 tests: the Boost card, which replaced the Status card (the owner's words: "it replaces it").
 *
 * The card is a number and one action. What matters here:
 *   - the compact line formats a real reading and never draws a missing one as zero;
 *   - a click runs Level 1 exactly once, a second click while it runs does nothing;
 *   - the arrow opens a menu that shows the entries later parts add, greyed, so nobody thinks they shipped;
 *   - the retired Status card is really gone (no registration, no prefs, no words), and an owner who had it on gets
 *     Boost on rather than silently losing the card;
 *   - the card owns no timer: the number arrives through the module's `onChange`. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const CSS = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.css"), "utf8");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/settings.json"), "utf8"));
const PREFS = JSON.parse(fs.readFileSync(path.join(root, "preferences.json"), "utf8"));
const LAYOUT = JSON.parse(fs.readFileSync(path.join(root, "extension/settings/layout.json"), "utf8"));
const STANDALONE = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/standalone.json"), "utf8"));

function loadCore() {
  const seam = {};
  const win = { __zentralWidgetsTestSeam: seam, ZentralRuntime: { register() {} } };
  win.window = win;
  vm.runInNewContext(SRC, {
    window: win, globalThis: { Services: {} }, URL, Date, JSON, Math, Promise, RegExp, Number, String, Array,
    Object, Map, Set, console,
  });
  return seam.core;
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}
const json = (v) => JSON.parse(JSON.stringify(v));

const c = loadCore();

test("a reading is a short number, and a missing reading is a dash", () => {
  assert.deepEqual(json(c.boostParts(412)), { mb: 412, text: "412 MB", level: "ok" });
  assert.equal(c.boostParts(1410).text, "1.4 GB", "past a thousand it switches unit instead of showing 1410 MB");
  assert.equal(c.boostParts(999).text, "999 MB", "the switch is at the point the number stops being readable");
  assert.equal(c.boostParts(4096).level, "low", "a browser at four gigabytes is worth a colour");
  assert.equal(c.boostParts(null), null, "no reading is no reading");
  assert.equal(c.boostParts(undefined), null);
  assert.equal(c.boostParts(0), null, "0 MB is never drawn as a real browser");
  assert.equal(c.boostParts(NaN), null);
});

test("a click means one light pass, and nothing while one is running", () => {
  assert.deepEqual(json(c.resolveBoostClick({ available: true, running: false })), { action: "free", level: 1 });
  const busy = c.resolveBoostClick({ available: true, running: true });
  assert.equal(busy.action, "none", "a second click must not stack a second GC");
  assert.equal(busy.reason, "busy");
  const missing = c.resolveBoostClick({ available: false });
  assert.equal(missing.action, "none");
  assert.equal(missing.reason, "module-missing", "without the module the card does nothing rather than throwing");
  assert.equal(c.resolveBoostClick({ available: true, enabled: false }).action, "none", "the kill switch is honoured");
});

test("the menu greys only what the build cannot do, and explains why", () => {
  // OW-91 made the deep pass real, so `deep` is offered when the module has the shared tab policy ...
  const items = c.boostMenuItems({ running: false, canDeep: true });
  // OW-94 added the Level 3 switch, which sits before Restore because it is a state, not an undo.
  assert.deepEqual(json(items.map((i) => i.id)), ["free-light", "free-deep", "game-mode", "restore"]);
  assert.equal(items[0].available, true, "the light pass always works");
  assert.equal(items[1].available, true, "the deep pass works when the policy is there");
  assert.equal(items[1].hint, "", "and needs no excuse");
  // ... and greyed with the reason when it is not, which is what an older full pack looks like.
  const noPolicy = c.boostMenuItems({ running: false, canDeep: false });
  assert.equal(noPolicy[1].available, false, "no policy, no deep pass");
  assert.ok(noPolicy[1].hint, "and the entry says why it is grey");
  // Restore is offered exactly when something is asleep.
  assert.equal(items[3].available, false, "nothing to restore before a deep pass");
  const withUndo = c.boostMenuItems({ running: false, canDeep: true, undoSize: 4 });
  assert.equal(withUndo[3].available, true, "four things asleep is four to wake");
  assert.equal(withUndo[3].label, "Restore (4)", "and the count is in the entry");
  const busy = c.boostMenuItems({ running: true, canDeep: true, undoSize: 4 });
  assert.equal(busy[0].available, false, "while a pass runs the entry is disabled");
  assert.equal(busy[0].label, "Freeing memory\u2026", "and it says what is happening");
  assert.equal(busy[1].available, false, "a second pass cannot start either");
  assert.equal(busy[3].available, false, "and neither can a restore mid-pass");
  // OW-94: the Game Mode entry is greyed only when the module cannot run it, and it reports its own state.
  const noGameMode = c.boostMenuItems({ running: false, canDeep: true, canGameMode: false });
  assert.equal(noGameMode[2].available, false, "a module without Game Mode does not offer it");
  const on = c.boostMenuItems({ running: false, canDeep: true, canGameMode: true, gameMode: true });
  assert.equal(on[2].available, true, "and a running module does");
  assert.equal(on[2].checked, true, "the row carries the state, not only a label");
  assert.ok(on[2].hint, "and says what being on means");
  const off = c.boostMenuItems({ running: false, canDeep: true, canGameMode: true, gameMode: false });
  assert.equal(off[2].checked, false);
  assert.equal(off[2].hint, "", "nothing to explain while it is off");
});

test("a deep pass says what it put to sleep as well as what it freed", () => {
  const deep = c.boostResultText({ by: "level2", freedMB: 300, unloaded: { tabs: 7, panels: 2 } });
  assert.equal(deep, "Put 7 tab(s) and 2 panel(s) to sleep, freed 300 MB");
  assert.equal(c.boostResultText({ by: "level2", freedMB: 0, unloaded: { tabs: 0, panels: 0 } }),
    "Memory was already tidy", "a deep pass that found nothing to sleep falls back to the plain line");
  assert.equal(c.WIDGET_STRINGS.en["boost.restored"].replace("{count}", "3"), "Woke 3 panel(s)");
});

test("the toast line never invents a number", () => {
  assert.equal(c.boostResultText({ freedMB: 220, beforeMB: 900, afterMB: 680 }), "Freed 220 MB");
  assert.equal(c.boostResultText({ freedMB: 0 }), "Memory was already tidy", "nothing freed is a fact, not a failure");
  assert.equal(c.boostResultText({ freedMB: null }), "Memory freed. This build cannot measure it.",
    "an unmeasurable build still says the run happened");
  assert.equal(c.boostResultText(null), "Memory freed. This build cannot measure it.", "a failed run is never a crash");
  assert.equal(c.boostResultText({ freedMB: 18.7 }), "Freed 19 MB", "a fraction is rounded once, at the edge");
});

test("the card registers once and the Status card is gone", () => {
  const registrations = [...SRC.matchAll(/registerWidget\(\{\n\s+id: "([a-z-]+)",/g)].map((m) => m[1]);
  assert.equal(registrations.filter((id) => id === "boost").length, 1, "one Boost card");
  assert.equal(registrations.includes("status"), false, "the Status card is not registered at all");
  assert.equal(SRC.includes("id: \"status\""), false, "not even as a definition nobody mounts");
  assert.equal(registrations.filter((id) => id === "clock").length, 1, "the other cards are untouched");
});

test("the card reads the module, never the platform, and owns no timer", () => {
  const card = SRC.slice(SRC.indexOf("// ---- OW-90: the Boost card, which replaces the Status card"), SRC.indexOf("const onVisibilityOrResize"));
  assert.ok(card.length > 4000, "the card exists");
  for (const forbidden of ["setInterval", "getMemoryUsage", "requestProcInfo", "forceGC", "navigator.getBattery"]) {
    assert.equal(card.includes(forbidden), false, `${forbidden} belongs to additional/boost/, not to the card`);
  }
  assert.ok(/window\.ZentralBoost/.test(card), "the card calls the module's API");
  assert.ok(/runLevel1\(/.test(card), "a click is Level 1");
  assert.ok(/onChange\(/.test(card), "and the number arrives through the module's own callback");
});

test("a missing module disables the card instead of breaking the tray", () => {
  const card = SRC.slice(SRC.indexOf("// ---- OW-90: the Boost card, which replaces the Status card"), SRC.indexOf("const onVisibilityOrResize"));
  assert.ok(/return api && typeof api\.runLevel1 === "function" \? api : null/.test(SRC),
    "the module is looked up defensively");
  assert.ok(/if \(!boost\) return null;/.test(card), "and a run without it does nothing");
  const parts = c.boostParts(undefined);
  assert.equal(parts, null, "the card still draws itself, with a dash");
});

test("the card has one setting, it ships on, and it is placed like the one it replaced", () => {
  const pref = "zen.workspace.zentral.widgets.boost.enabled";
  const row = SETTINGS.schema.find((x) => x.property === pref);
  assert.ok(row, "the pref is declared");
  assert.equal(row.defaultValue, true, "Boost ships on — the plan's own default");
  assert.equal(row.type, "checkbox");
  assert.ok(PREFS.some((p) => p.property === pref), "it reaches preferences.json");
  assert.ok(LAYOUT.order.includes(pref), "it has a home in the settings dialog");
  assert.ok((STANDALONE.preferenceOrder || []).includes(pref), "and in the standalone package");
  // Nothing of the old card is offered any more.
  for (const dead of ["zen.workspace.zentral.widgets.status.enabled", "zen.workspace.zentral.widgets.status.show_battery", "zen.workspace.zentral.widgets.status.show_memory"]) {
    assert.equal(SETTINGS.schema.some((x) => x.property === dead), false, dead + " is not a setting any more");
    assert.equal(LAYOUT.order.includes(dead), false, dead + " is not on the page");
    assert.equal((STANDALONE.preferenceOrder || []).includes(dead), false, dead + " is not in the standalone page");
  }
  // The retired pref is read once (so an owner's choice survives) and declared external, exactly like OW-60's timer.
  assert.ok((STANDALONE.externalPrefs || []).includes("zen.workspace.zentral.widgets.status.enabled"),
    "the retired pref is declared external, so the build knows why the code still reads it");
  assert.ok(/LEGACY_STATUS_ENABLED/.test(SRC) && /adoptLegacyStatusCard/.test(SRC), "one migration step reads it");
});

test("the card's settings section is its own, not the retired one", () => {
  const meta = SETTINGS.settings["zen.workspace.zentral.widgets.boost.enabled"];
  assert.ok(meta, "the metadata exists");
  assert.equal(meta.section, "Boost", "the section names what it holds now");
  const sections = new Set(Object.values(SETTINGS.settings).map((s) => s.section));
  assert.equal(sections.has("Status"), false, "there is no Status section left to find");
  assert.ok(LAYOUT.categories.some((cat) => cat.id === meta.category && cat.sections.some((s) => s.label === "Boost")),
    "the layout really declares that section");
});

test("the card is styled with the theme's variables and can be disabled", () => {
  assert.ok(CSS.includes("#zentral-sidebar-widgets .zw-boost {"), "the card has its own block");
  assert.ok(/\.zw-boost-popup\b[\s\S]*\[hidden\]/.test(CSS) || CSS.includes(".zw-boost-popup[hidden]"), "hidden really hides");
  assert.ok(CSS.includes('.zw-boost-menu-item[disabled]'), "a greyed entry looks greyed");
  assert.equal(CSS.includes(".zw-status"), false, "the retired card's CSS is gone, not left to rot");
  // No scheme-local colours: everything is a variable with the theme as the fallback.
  const block = CSS.slice(CSS.indexOf(".zw-boost {"), CSS.indexOf("/* ---- Built-in Timer widget"));
  const colours = block.match(/#[0-9a-f]{3,6}/gi) || [];
  for (const colour of colours) {
    assert.ok(["#e5a04b"].includes(colour.toLowerCase()), colour + " has no variable to live in");
  }
});

console.log("\nPASS widgets-status (replaced by the Boost card, " + passed + " tests)");
