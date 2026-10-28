"use strict";
/* Free numeric entry in Sine: the sync service (createNumericPrefSync from the runtime) and the
 * generated preference files. Uses an in-memory preference store and a manual clock. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "loader/ZentralRuntime.js"), "utf8");
const start = runtime.indexOf("function createNumericPrefSync(");
let depth = 0, end = -1;
for (let i = runtime.indexOf("(options) {", start) + 10; i < runtime.length; i++) {
  if (runtime[i] === "{") depth++;
  else if (runtime[i] === "}" && --depth === 0) { end = i + 1; break; }
}
const createNumericPrefSync = vm.runInNewContext("(" + runtime.slice(start, end) + ")", { setTimeout, clearTimeout });

function fakeServices() {
  const store = new Map(), observers = [], log = [];
  const INT = 64, STR = 32;
  const notify = (name) => observers.filter((o) => name.startsWith(o.prefix)).forEach((o) => o.obs.observe(null, "nsPref:changed", name));
  const prefs = {
    PREF_INT: INT, PREF_STRING: STR,
    getPrefType: (k) => store.get(k)?.type ?? 0,
    prefHasUserValue: (k) => store.has(k),
    getIntPref(k) { if (store.get(k)?.type !== INT) throw new Error("type mismatch " + k); return store.get(k).value; },
    getStringPref(k) { if (store.get(k)?.type !== STR) throw new Error("type mismatch " + k); return store.get(k).value; },
    setIntPref(k, v) { if (store.has(k) && store.get(k).type !== INT) throw new Error("cannot change type " + k); store.set(k, { type: INT, value: v }); log.push(["int", k, v]); notify(k); },
    setStringPref(k, v) { if (store.has(k) && store.get(k).type !== STR) throw new Error("cannot change type " + k); store.set(k, { type: STR, value: v }); log.push(["str", k, v]); notify(k); },
    clearUserPref(k) { store.delete(k); notify(k); },
    addObserver: (prefix, obs) => observers.push({ prefix, obs }),
    removeObserver: (prefix, obs) => { const i = observers.findIndex((o) => o.obs === obs); if (i >= 0) observers.splice(i, 1); },
  };
  return { Services: { prefs }, store, observers, log };
}
function clock() {
  let t = 0, id = 0; const timers = new Map();
  return {
    set: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id; },
    clear: (i) => timers.delete(i),
    advance(ms) { const end = t + ms; for (;;) { const n = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!n || n[1].at > end) break; t = n[1].at; timers.delete(n[0]); n[1].fn(); } t = end; },
    pending: () => timers.size,
  };
}
const ITEM = { key: "zen.workspace.t.width", text: "zen.workspace.t.width_text", min: 100, max: 2000, def: 350 };
const mk = (extra = {}) => { const f = fakeServices(), c = clock(); const svc = createNumericPrefSync({ Services: f.Services, items: [ITEM], setTimer: c.set, clearTimer: c.clear, ...extra }); return { f, c, svc, type: (v) => f.Services.prefs.setStringPref(ITEM.text, v), int: () => f.store.get(ITEM.key)?.value, text: () => f.store.get(ITEM.text)?.value }; };
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

test("typed text becomes the real integer preference after a short pause", () => {
  const t = mk();
  t.type("640"); assert.equal(t.int(), undefined, "not applied while still typing");
  t.c.advance(499); assert.equal(t.int(), undefined);
  t.c.advance(2); assert.equal(t.int(), 640);
  assert.equal(t.f.store.get(ITEM.key).type, 64, "stays an integer, never a string");
});
test("typing 3, 30, 300 applies only the final value", () => {
  const t = mk();
  for (const v of ["3", "30", "300"]) { t.type(v); t.c.advance(200); }
  t.c.advance(600);
  assert.equal(t.int(), 300);
  assert.equal(t.f.log.filter((l) => l[0] === "int").length, 1);
  assert.equal(t.text(), "300", "what the user typed is left alone");
});
test("units, decimals and clamping", () => {
  const t = mk();
  for (const [typed, want] of [["500px", 500], [" 720 ", 720], ["12.6", 100], ["99999", 2000], ["-40", 100], ["1,5", 100], ["250.4", 250]]) {
    t.type(typed); t.c.advance(600); assert.equal(t.int(), want, typed);
  }
});
test("invalid text never overwrites a good value", () => {
  const t = mk();
  t.type("800"); t.c.advance(600); assert.equal(t.int(), 800);
  for (const bad of ["", "abc", "1e9", "NaN", "12px34", "--5", "0x10"]) { t.type(bad); t.c.advance(600); assert.equal(t.int(), 800, JSON.stringify(bad)); }
});
test("changes made elsewhere (in-app slider, about:config) update the text field", () => {
  const t = mk();
  t.f.Services.prefs.setIntPref(ITEM.key, 420);
  assert.equal(t.text(), "420");
  t.f.Services.prefs.setIntPref(ITEM.key, 555);
  assert.equal(t.text(), "555");
  assert.equal(t.c.pending(), 0, "no echo timer left behind");
  assert.equal(t.f.log.length, 4, "two writes of each kind, no feedback loop");
});
test("startup reconcile: integer wins; text is used only when no integer was ever stored", () => {
  let f = fakeServices(); f.Services.prefs.setIntPref(ITEM.key, 700); f.Services.prefs.setStringPref(ITEM.text, "123");
  createNumericPrefSync({ Services: f.Services, items: [ITEM] });
  assert.equal(f.store.get(ITEM.text).value, "700");
  f = fakeServices(); f.Services.prefs.setStringPref(ITEM.text, "900");
  createNumericPrefSync({ Services: f.Services, items: [ITEM] });
  assert.equal(f.store.get(ITEM.key).value, 900);
  f = fakeServices(); createNumericPrefSync({ Services: f.Services, items: [ITEM] });
  assert.equal(f.store.size, 0, "untouched settings create no preferences");
});
test("a leftover string on the real preference is replaced by an integer", () => {
  const f = fakeServices(), c = clock();
  f.Services.prefs.setStringPref(ITEM.key, "oops");
  createNumericPrefSync({ Services: f.Services, items: [ITEM], setTimer: c.set, clearTimer: c.clear });
  f.Services.prefs.setStringPref(ITEM.text, "321"); c.advance(600);
  assert.equal(f.store.get(ITEM.key).type, 64);
  assert.equal(f.store.get(ITEM.key).value, 321);
});
test("destroy releases the observer and pending timers", () => {
  const t = mk();
  t.type("500"); assert.equal(t.c.pending(), 1);
  t.svc.destroy(); assert.equal(t.c.pending(), 0); assert.equal(t.f.observers.length, 0);
  t.c.advance(1000); assert.equal(t.int(), undefined);
});

// ---- generated files -------------------------------------------------------------------------------
const sine = JSON.parse(fs.readFileSync(path.join(root, "preferences.json"), "utf8"));
const list = JSON.parse(fs.readFileSync(path.join(root, "loader/numeric-prefs.json"), "utf8"));
test("Sine file: every numeric setting is a free text field; nothing numeric is left as a dropdown", () => {
  const props = sine.filter((x) => x.property);
  assert.equal(new Set(props.map((p) => p.property)).size, props.length, "unique properties");
  for (const item of list) {
    const entry = props.find((p) => p.property === item.text);
    assert.ok(entry, item.key + " has a text field");
    assert.equal(entry.type, "string");
    assert.ok(!props.some((p) => p.property === item.key), item.key + " dropdown replaced");
    assert.ok(item.min <= item.def && item.def <= item.max, `${item.key}: default ${item.def} outside ${item.min}..${item.max}`);
    assert.ok(item.max > item.min);
  }
  for (const p of props.filter((x) => x.type === "dropdown")) assert.ok(!p.options.every((o) => /^-?\d+(\.\d+)?$/.test(String(o.value))), p.property + " is still a number-only dropdown");
  assert.ok(!props.some((p) => "numeric" in p || p.type === "input"), "no internal-only fields leak into Sine");
});
test("ranges are wider than the old presets (e.g. RSS card can be much wider)", () => {
  const rss = list.find((i) => i.key.endsWith("rss_card_width"));
  assert.ok(rss.max >= 2000);
  const panel = list.find((i) => i.key === "zen.workspace.apps.sidebar.width");
  assert.ok(panel.max >= 1000 && panel.min <= 280);
});
test("old preset values are shown as hints in the label (thinned when long, never invented)", () => {
  const { presetHints, sineItem } = require("../tools/lib/sine-prefs.cjs");
  const few = { property: "x.y", label: "Opacity", defaultValue: 90, numeric: { min: 0, max: 100, unit: "%" }, options: [{ value: 100 }, { value: 90 }, { value: 80 }, { value: 90 }] };
  assert.deepEqual(presetHints(few), [80, 90, 100], "sorted and de-duplicated");
  assert.equal(sineItem(few).label, "Opacity [0 to 100 %; e.g. 80, 90, 100]");
  assert.equal(sineItem(few).placeholder, "90", "the placeholder still shows the default");
  const many = { options: Array.from({ length: 40 }, (_, i) => ({ value: i * 5 })) };
  const thin = presetHints(many);
  assert.ok(thin.length <= 8 && thin[0] === 0 && thin[thin.length - 1] === 195, "thinned, ends kept");
  assert.deepEqual(presetHints({ options: [{ value: "auto" }] }), [], "non-numeric options are ignored");
  assert.equal(sineItem({ property: "x.z", label: "Plain", defaultValue: 5, numeric: { min: 1, max: 9 } }).label, "Plain [1 to 9]");
  const hinted = sine.filter((p) => /_text$/.test(p.property || "") && /; e\.g\. /.test(p.label));
  assert.ok(hinted.length >= 80, "generated Sine file carries hints (" + hinted.length + ")");
});
console.log(`\n${passed} numeric preference tests passed`);
