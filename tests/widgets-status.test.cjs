"use strict";
/* T3.9e tests: the Status widget (battery and memory) and the settings section it owns.
 * The readings are pure: the widget never touches `navigator.getBattery` or `Services.appinfo` itself, so the card
 * can be proven without a battery. What matters here: percentages are clamped, an unknown reading is dropped rather
 * than drawn as zero, memory prints a limit only when Firefox reports one, and a low battery is never silently green. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "additional/widgets/ZentralWidgets.uc.js"), "utf8");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(root, "additional/widgets/settings.json"), "utf8"));
const PREFS = JSON.parse(fs.readFileSync(path.join(root, "preferences.json"), "utf8"));
const seam = {};
const win = { __zentralWidgetsTestSeam: seam, ZentralRuntime: { register() {} } };
win.window = win;
vm.runInNewContext(SRC, { window: win, globalThis: { Services: {} }, URL, Date, JSON, Math, Promise, RegExp, Number, String, Array, Object, Map, Set, console });
const c = seam.core;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}
const json = (v) => JSON.parse(JSON.stringify(v));

test("a battery reading is a percentage with a state and a level", () => {
  assert.deepEqual(json(c.batteryParts({ level: 0.82, charging: false })), {
    percent: 82, charging: false, text: "82%", title: "82% — on battery", level: "ok",
  });
  assert.equal(c.batteryParts({ level: 0.5, charging: true }).title, "50% — charging");
  assert.equal(c.batteryParts({ level: 0.05 }).level, "critical");
  assert.equal(c.batteryParts({ level: 0.2 }).level, "low");
  assert.equal(c.batteryParts({ level: 1.7 }).percent, 100, "a value over one is clamped, never shown as 170%");
  assert.equal(c.batteryParts({ level: -3 }).percent, 0);
  assert.equal(c.batteryParts(null), null, "no reading is not 0%");
  assert.equal(c.batteryParts({ charging: true }), null);
});

test("memory prints a limit only when there is one", () => {
  const both = c.memoryParts({ used: 3.2 * 1024 ** 3, total: 8 * 1024 ** 3 });
  assert.equal(both.text, "3.2 / 8 GB");
  assert.equal(both.sharePercent, 40);
  const usedOnly = c.memoryParts({ usedSize: 1.5 * 1024 ** 3 });
  assert.equal(usedOnly.text, "1.5 GB", "no limit, no slash");
  assert.equal(usedOnly.sharePercent, 0);
  assert.equal(c.memoryParts({ used: 0 }), null);
  assert.equal(c.memoryParts(null), null);
});

test("the line holds only what was asked for, in a stable order", () => {
  const battery = { level: 0.3, charging: false };
  const memory = { used: 2 * 1024 ** 3, total: 4 * 1024 ** 3 };
  const parts = c.statusLineParts({ showBattery: true, showMemory: true }, battery, memory);
  assert.deepEqual(json(parts.map((p) => p.kind)), ["battery", "memory"]);
  assert.equal(parts[0].text, "30%");
  assert.equal(parts[0].level, "ok");
  assert.deepEqual(json(c.statusLineParts({ showBattery: true, showMemory: true }, { level: 0.05 }, null).map((p) => p.kind)), ["battery"]);
  assert.deepEqual(json(c.statusLineParts({ showBattery: false, showMemory: true }, battery, memory).map((p) => p.kind)), ["memory"]);
  assert.deepEqual(json(c.statusLineParts({ showBattery: false, showMemory: false }, battery, memory)), []);
  // Charging shows the plug, and a nearly full memory is flagged, never silently fine.
  assert.equal(c.statusLineParts({ showBattery: true }, { level: 0.9, charging: true }, null)[0].text, "90% \u26a1");
  assert.equal(c.statusLineParts({ showMemory: true }, null, { used: 95, total: 100 })[0].level, "critical");
});

test("memory is a slow reading, battery is quick while it charges", () => {
  assert.equal(c.nextStatusDelayMs({ charging: true }), 60000);
  assert.equal(c.nextStatusDelayMs({ charging: false }), 5 * 60000);
  assert.equal(c.nextStatusDelayMs(null), 5 * 60000);
});

test("the widget reads nothing from the machine and owns no timer", () => {
  const status = SRC.slice(SRC.indexOf('id: "status"'), SRC.indexOf('id: "status"') + 6000);
  assert.ok(status.length > 800, "the status widget exists");
  assert.ok(!/setInterval/.test(status), "no interval of its own");
  assert.ok(/nextStatusDelayMs/.test(status), "its cadence comes from the shared rule");
  assert.ok(/navigator\.getBattery/.test(SRC), "battery comes from the platform API");
  assert.ok(/levelchange/.test(SRC) && /chargingchange/.test(SRC), "and follows the platform's own change events");
  assert.ok(/Services\.appinfo\?\.getMemoryUsage/.test(SRC), "memory comes from the platform's own counters");
});

test("the settings section exists and every pref is declared", () => {
  const wanted = [
    c.WIDGET_PREFS.STATUS_ENABLED,
    c.WIDGET_PREFS.STATUS_SHOW_BATTERY,
    c.WIDGET_PREFS.STATUS_SHOW_MEMORY,
    c.WIDGET_PREFS.TIMER_ENABLED,
    c.WIDGET_PREFS.WEATHER_ENABLED,
  ];
  for (const property of wanted) {
    const item = SETTINGS.schema.find((x) => x.property === property);
    assert.ok(item, property + " is declared in settings.json");
    assert.ok(PREFS.some((p) => p.property === property), property + " reaches preferences.json");
  }
  assert.equal(SETTINGS.schema.find((x) => x.property === c.WIDGET_PREFS.STATUS_ENABLED).defaultValue, false, "status ships off");
  const sections = new Set(Object.values(SETTINGS.settings).map((s) => s.section));
  for (const section of ["Weather", "Timer", "Status"]) assert.ok(sections.has(section), "new section " + section);
});

console.log("\nPASS widgets-status (" + passed + " tests)");
