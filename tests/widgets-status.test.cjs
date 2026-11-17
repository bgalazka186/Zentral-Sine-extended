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

/* OW-52: the card showed nothing at all. Two platform facts broke it — the chrome window has no
 * `navigator.getBattery`, and `getMemoryUsage()` is not guaranteed to answer in the browser window — and either
 * missing half removed the whole card. These tests pin the repair: one missing reading never removes the other, and
 * a reading that cannot be taken is said out loud instead of vanishing. */
test("battery readings are normalised from either platform shape", () => {
  assert.deepEqual(json(c.readBatteryInfo({ level: 0.42, charging: true })), { level: 0.42, charging: true });
  const fromPowerManager = c.readBatteryInfo({ percent: 42, charging: false, dischargingTime: 3600 });
  assert.equal(fromPowerManager.level, 0.42, "the power manager reports 0-100, the card wants 0-1");
  assert.equal(fromPowerManager.charging, false);
  assert.equal(c.readBatteryInfo(null), null);
  assert.equal(c.readBatteryInfo(undefined), null);
});

test("one missing reading never removes the other", () => {
  const memory = { used: 2 * 1024 ** 3, total: 4 * 1024 ** 3 };
  const battery = { level: 0.5, charging: false };
  // No battery support, but memory works: the card still shows memory.
  const withoutBattery = c.composeStatusParts({ showBattery: true, showMemory: true }, null, memory, { battery: false, memory: true });
  assert.deepEqual(json(withoutBattery.map((p) => p.kind)), ["memory"], "a desktop's missing battery stays quiet");
  assert.equal(withoutBattery[0].text, "2 / 4 GB");
  // No memory support, but the battery answers: the card still shows the battery.
  const withoutMemory = c.composeStatusParts({ showBattery: true, showMemory: true }, battery, null, { battery: true, memory: false });
  assert.deepEqual(json(withoutMemory.map((p) => p.kind)), ["battery", "memory"], "the battery, then the memory dash");
  assert.equal(withoutMemory[0].text, "50%");
  assert.equal(withoutMemory[1].unavailable, true);
});

test("a reading that cannot be taken says so instead of vanishing", () => {
  // Neither half readable: the tray is never empty and silent.
  const none = c.composeStatusParts({ showBattery: true, showMemory: true }, null, null, { battery: false, memory: false });
  assert.equal(none.length, 1, "memory explains itself; a desktop's missing battery does not nag");
  assert.equal(none[0].kind, "memory");
  assert.equal(none[0].text, "\u2014");
  assert.equal(none[0].unavailable, true);
  // A battery-only card on a machine with no battery says why it is empty.
  const batteryOnly = c.composeStatusParts({ showBattery: true, showMemory: false }, null, null, { battery: false, memory: false });
  assert.equal(batteryOnly.length, 1);
  assert.equal(batteryOnly[0].text, "no battery");
  // A real reading is never replaced by a placeholder.
  const mixed = c.composeStatusParts({ showBattery: true, showMemory: true }, { level: 0.7 }, null, { battery: true, memory: false });
  assert.deepEqual(json(mixed.map((p) => p.kind)), ["battery", "memory"], "the reading, then the dash");
  assert.equal(mixed[0].text, "70%");
  assert.equal(mixed[1].unavailable, true);
  // Switching a half off means it is not mentioned at all.
  const off = c.composeStatusParts({ showBattery: false, showMemory: true }, null, null, { battery: false, memory: false });
  assert.deepEqual(json(off.map((p) => p.kind)), ["memory"]);
});

test("the live card reads the platform it actually runs in, and paints its first value", () => {
  // The chrome window has no navigator.getBattery: the power manager is the documented fallback.
  assert.ok(/navigator\.getBattery/.test(SRC), "the content-side API is still tried first");
  assert.ok(/powermanagerservice|Services\.power/.test(SRC), "and the browser window's power manager is the fallback");
  assert.ok(/Services\.appinfo\?\.getMemoryUsage\?/.test(SRC), "memory is guarded with a call, not just a name check");
  assert.ok(/memorySupport !== false/.test(SRC), "a memory read failure is remembered, not retried every paint");
  assert.ok(/composeStatusParts\(/.test(SRC), "the card paints the composed line, not the raw readings");
  // A mount must not wait a whole five-minute interval for its first paint.
  assert.ok(/batterySupport !== false/.test(SRC), "the battery state is tracked as unknown/yes/no");
  assert.ok(/scheduler\.refresh\("status", \{ force: true/.test(SRC), "a battery event forces an immediate repaint");
});

test("the settings section exists and every pref is declared", () => {
  // OW-60 retired the standalone Timer card, so `timer.enabled` is no longer a setting; the Timer FACE setting took
  // its place. Asserting the old pref here would pin the very thing the owner asked to be removed.
  const wanted = [
    c.WIDGET_PREFS.STATUS_ENABLED,
    c.WIDGET_PREFS.STATUS_SHOW_BATTERY,
    c.WIDGET_PREFS.STATUS_SHOW_MEMORY,
    c.WIDGET_PREFS.CLOCK_MODE,
    c.WIDGET_PREFS.WEATHER_ENABLED,
  ];
  assert.equal(SETTINGS.schema.some((x) => x.property === c.WIDGET_PREFS.TIMER_ENABLED), false,
    "the retired standalone Timer card pref is gone from settings");
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
