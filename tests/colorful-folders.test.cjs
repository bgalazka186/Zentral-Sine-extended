"use strict";
/* Pure data, hashing and packaging contracts for Colorful Folders. Gecko DOM
 * attachment is covered only by the runtime's simulated-window standalone suite. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "additional/folders/ZentralColorfulFolders.uc.js"), "utf8");
let registration;
const window = {
  ZentralRuntime: {
    register(definition) {
      assert.equal(registration, undefined, "feature registers once");
      registration = definition;
    },
  },
};
const Services = { prefs: {} };
vm.runInNewContext(source, {
  window,
  globalThis: { Services },
  ChromeUtils: {},
  TextEncoder,
  Uint8Array,
  Uint32Array,
  DataView,
  Object,
  Array,
  String,
  Number,
  Math,
  JSON,
  Date,
  Set,
  Map,
  RegExp,
  Error,
  TypeError,
  console,
});
const c = window.__zentralColorfulFoldersTestSeam;
assert.ok(c, "pure test seam exported");
assert.equal(registration.id, "colorful-folders");
assert.equal(typeof registration.init, "function");
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}
const J = (value) => JSON.parse(JSON.stringify(value));

test("SHA-256 matches standard vectors and persisted identity is an opaque salted ID hash", () => {
  assert.equal(c.sha256Hex("abc"), crypto.createHash("sha256").update("abc").digest("hex"));
  assert.equal(c.sha256Hex(""), crypto.createHash("sha256").update("").digest("hex"));
  const hash = c.hashKey("salt", "id", "a-native-folder-id");
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(!hash.includes("a-native-folder-id"));
  assert.notEqual(hash, c.hashKey("other-salt", "id", "a-native-folder-id"));
});
test("folder records validate hashes and hex colors and never retain plaintext names", () => {
  const valid = c.cleanRecord({ i: "a".repeat(64), l: "b".repeat(64), b: "#AABBCC", d: { back: "#112233", unknown: "#ffffff" }, u: 7 });
  assert.deepEqual(J(valid), { i: "a".repeat(64), b: "#aabbcc", d: { back: "#112233" }, o: {}, u: 7 });
  assert.equal(c.cleanRecord({ i: "folder-name", b: "#112233" }), null);
  assert.equal(c.cleanRecord({ l: "a".repeat(64), b: "red" }), null);
  assert.equal(c.cleanRecord({ i: "a".repeat(64), b: "#112233", d: { front: "#fff" } }).d.front, undefined);
});
test("data parsing is defensive, bounded, versioned and round-trips only hashed records", () => {
  const records = Array.from({ length: 405 }, (_, i) => ({ i: i.toString(16).padStart(64, "0"), b: "#123456", u: i }));
  const raw = c.serializeData(records);
  assert.equal(JSON.parse(raw).v, 2);
  assert.equal(c.parseData(raw).length, 400);
  const prototype = JSON.stringify({ v: 1, r: [{ i: "a".repeat(64), l: "b".repeat(64), b: "#123456" }] });
  const migrated = c.serializeData(c.parseData(prototype));
  assert.equal(JSON.parse(migrated).v, 2);
  assert.ok(!migrated.includes('"l"'), "prototype label hashes are stripped during migration");
  assert.equal(c.parseData("not-json").length, 0);
  assert.equal(c.parseData(JSON.stringify({ v: 9, r: records })).length, 0);
  assert.equal(c.parseData("x".repeat(1024 * 1024 + 1)).length, 0);
  assert.ok(!raw.includes("Folder Name"));
  assert.ok(!raw.includes('"l"'), "persisted records never contain label hashes");
});
test("opacity validates every layer, preserves 0%, and rejects null or out-of-range values", () => {
  assert.deepEqual(J(c.cleanOpacity({ back: 0, front: 35, stroke: 100, label: null, accent: -1, tint: 101, hover: "50", extra: 60 })), {
    back: 0, front: 35, stroke: 100, hover: 50,
  });
  const record = c.cleanRecord({ i: "a".repeat(64), d: { back: "#112233" }, o: { back: 0 }, u: 8 });
  assert.equal(record.o.back, 0, "a transparent layer is still a saved color record");
  assert.equal(c.cleanOpacity([0, 20]).back, undefined);
  const poisoned = [];
  poisoned.back = 80;
  assert.deepEqual(J(c.cleanOpacity(poisoned)), {}, "arrays are rejected even if given named properties");
});
test("quick themes validate, deduplicate case-insensitively and cap saved entries", () => {
  const parsed = c.parseThemes(JSON.stringify([
    { n: "Ocean", b: "#123456" },
    { n: "ocean", b: "#ffffff" },
    { n: "Bad", b: "not-a-color" },
    ...Array.from({ length: 40 }, (_, i) => ({ n: "Theme " + i, b: "#abcdef" })),
  ]));
  assert.equal(parsed[0].n, "Ocean");
  assert.equal(parsed.filter((t) => t.n.toLowerCase() === "ocean").length, 1);
  assert.equal(parsed.length, 24);
  assert.equal(c.cleanTheme({ n: "", b: "#112233" }), null);
});
test("simple and detailed modes produce seven independent color parts", () => {
  const base = c.partsFor({ b: "#336699", d: { front: "#ffffff" } }, "simple");
  const detailed = c.partsFor({ b: "#336699", d: { front: "#ffffff", hover: "#101010" } }, "detailed");
  for (const part of c.PARTS) assert.ok(base[part], "simple derives " + part);
  assert.notEqual(base.front, "#ffffff", "simple mode derives from base");
  assert.equal(detailed.front, "#ffffff", "detailed override applies");
  assert.equal(detailed.hover, "#101010");
  const css = c.declarations(detailed);
  for (const prop of ["--zen-folder-behind-bgcolor", "--zen-folder-front-bgcolor", "--zen-folder-stroke", "--bgalazka-fc-label", "--tab-group-color", "--tab-group-background-color", "--tab-group-color-pale", "--tab-group-background-color-hover"])
    assert.ok(css[prop], "mapped CSS property " + prop);
});
test("palette ships darker, contrasty and colorful quick themes", () => {
  const groups = c.BUILTIN_THEMES.map((group) => group.group);
  assert.deepEqual(J(groups), ["Dark folders", "High contrast", "Colorful"]);
  assert.ok(c.BUILTIN_THEMES.every((group) => group.items.length >= 3));
  assert.ok(c.BUILTIN_THEMES.flatMap((group) => group.items).every((theme) => c.cleanTheme(theme)));
});
test("source exposes default color controls, all-layer transparency, showcase presets and draggable editor", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, "additional/folders/settings.json"), "utf8"));
  const colorControls = schema.schema.filter((item) => item.property.includes("default_") && item.control === "color");
  const opacityControls = schema.schema.filter((item) => item.property.endsWith("_opacity"));
  assert.equal(colorControls.length, 8, "base plus seven independently editable colors");
  assert.equal(opacityControls.length, 7, "all seven layers expose transparency");
  for (const item of opacityControls) {
    assert.equal(item.defaultValue, -1, item.property + " uses inherit sentinel");
    assert.equal(item.numeric.min, -1, item.property + " keeps 0% selectable");
    assert.equal(item.numeric.max, 100);
  }
  assert.match(source, /Apply \${theme\.n} to all default folders/);
  assert.match(source, /pointerdown/);
  assert.match(source, /popuphidden/);
  assert.match(source, /removeEventListener\("popuphidden", afterHidden, true\)/);
  assert.match(source, /attempts\+\+ >= 120/);
  assert.match(source, /mainPopupSet/);
  assert.match(source, /openPopupAtScreen/);
  assert.match(source, /moveTo\(/);
  assert.match(source, /Customize all seven layers and transparency/);
  assert.match(source, /setIntPref\(P\.OPACITY_SCHEMA, 2\)/);
  assert.match(source, /clearUserPref\(key\)/);
  assert.match(source, /if \(previousOpacitySchema < 1\)/);
  assert.match(source, /prefHasUserValue\(P\.MODE\)/);
  assert.match(source, /if \(editor !== element\) return;/, "an older async Notes save cannot close a newer editor");
  assert.match(source, /getPropertyPriority\?\./, "folder painting tolerates hosts without the optional CSSStyleDeclaration method");
  assert.match(source, /yellow: "#f5c542"/);
  assert.match(source, /readNotesFolderFallback/);
});
test("editor placement avoids obscuring the folder when a side or vertical slot is available", () => {
  const right = c.placePanel({ left: 80, right: 140, top: 300, bottom: 340 }, 360, 500, 1200, 800);
  assert.equal(right.overlaps, false);
  assert.ok(right.left >= 152, "uses the free space right of the target");
  const centered = c.placePanel({ left: 540, right: 620, top: 300, bottom: 340 }, 360, 500, 800, 900);
  assert.equal(centered.overlaps, false);
  const tiny = c.placePanel({ left: 0, right: 150, top: 0, bottom: 450 }, 360, 500, 320, 480);
  assert.ok(Number.isFinite(tiny.left) && Number.isFinite(tiny.top), "tiny viewport still receives a bounded placement");
});
test("source uses the lifecycle settings hook and shares Notes ownership through the bridge", () => {
  assert.match(source, /registerSettingsHook\?/);
  assert.match(source, /ensureSettingsSection\?\.\(/);
  assert.match(source, /bgalazka-notes-folder/);
  assert.match(source, /bgalazka-notes-subfolder/);
  assert.match(source, /id === "bgalazka-zentral-notes"/, "the NOTES root is explicitly recognized as Notes-owned");
  assert.match(source, /zen_root_parts/);
  assert.match(source, /zen_root_part_opacity/);
  assert.match(source, /return !!notesBridge\(\) && \(/);
  assert.match(source, /zentral-notes-folder-color-bridge-gone/);
  assert.match(source, /bgalazka-notes-color/);
  assert.match(source, /notesBridge\(\)\?\.refresh/);
  assert.match(source, /lifecycle\.listen\(window, "zentral-notes-folder-color-bridge-ready"/);
  assert.match(source, /lifecycle\.listen\(window, "popupshowing"/);
  assert.match(source, /waitForNotesBridge/);
  assert.match(source, /readNotesFolderFallback/);
  assert.match(source, /zentral-notes-folder-style-changed/);
  assert.match(source, /bridge\?\.prepare/);
  assert.doesNotMatch(source, /createFolder\(|removeFolder\(|moveFolder\(/);
});
console.log(`\n${passed} Colorful Folders tests passed`);
